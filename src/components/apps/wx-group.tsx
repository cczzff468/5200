'use client';

/**
 * 微信群聊（宿主：微信 App；会话身份 sessionKey = `wx:group:<groupId>`）。
 *
 * 组成：
 * - WxGroupCreatePage  建群：多选微信好友 + 群名（默认按成员名生成）；
 * - WxGroupListPage    群列表（通讯录 › 群聊入口）；
 * - WxGroupChatPage    群聊页：气泡（发言者名+头像）/ @某成员优先回复 / 长按菜单（复制/引用/撤回/删除）/
 *                      流式气泡（当前发言角色）/ 多角色逐个顺序回复；
 * - WxGroupInfoPage    群聊信息：成员管理（邀请/移出）、群名、群公告、群头像、
 *                      记忆与私聊互通开关（按群独立 + 按成员覆盖）、回复策略（全员/仅@/AI 自判）、
 *                      置顶/免打扰、时间感知、清空记录、解散并退出群聊。
 *
 * AI 管线（多角色，每个角色独立组装 system，绝不共用）：
 * - 用户发言后按「被 @ 成员优先，其余按成员顺序」逐个发起流式回合（单会话单流，队列串行）；
 * - 每个角色的 system = 七要素人设 + 群聊规则（当前是群聊/参与者名单/只代表自己/禁复读）+
 *   该角色自己的记忆召回（memRecallBlock mode='group'：本群记忆 + 互通开启时的自己私聊记忆）+
 *   时间感知（按群开关）+ 世界书；机主与其他成员的历史消息一律映射为「发言者：内容」的 user 消息；
 * - finalize：回复落盘（senderId 区分发言人）+ 未读 + memAfterAiTurn（roundScope 按群隔离，
 *   碎片带 source='group'/sourceGroupId/groupMembers 群来源标记）。
 * - 范围限定：群内不提供红包/转账/亲属卡等资金功能；表情包/识图等私聊特性不进入群聊管线。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AtSign,
  Check,
  ChevronLeft,
  ChevronRight,
  Minus,
  Pencil,
  Plus,
  SendHorizontal,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  BubbleActionMenu,
  computeBubbleMenuPos,
  useBubbleLongPress,
  type BubbleMenuItem,
} from '@/components/apps/bubble-menu';
import { DefaultAvatar } from '@/components/apps/default-avatar';
import { displayNameOf, isFriendIn, type ContactRecord } from '@/lib/contacts';
import { buildNpcPromptExtra } from '@/lib/ios/npc-bond';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import { contactRealName, ownerRealName } from '@/lib/ios/contacts-store';
import { genId } from '@/lib/ios/db';
import {
  addGroupMember,
  createGroup,
  dissolveGroup,
  effectiveInterop,
  getGroup,
  groupPreview,
  listGroups,
  loadGroupMsgs,
  removeGroupMember,
  saveGroupMsgs,
  updateGroup,
  type ChatGroup,
  type GroupReplyPolicy,
  type WxGroupMsg,
} from '@/lib/ios/groups';
import { wxChatFlags, useChatFlags, type ChatFlags } from '@/lib/chat-flags';
import { wxUnreads } from '@/lib/unread-store';
import { memAfterAiTurn, memRecallBlock } from '@/lib/memory';
import { getTimeAware, setTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import { applyWbUserBlocks, collectWbBlocks, wbRulesBlock, wbScanText } from '@/lib/ios/worldbook';
import { useSettings } from '@/lib/ios/store';
import {
  beginChatStream,
  clearChatStream,
  isChatStreaming,
  useChatStream,
  type ChatPayloadMessage,
} from '@/lib/chat-stream-store';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';

/** 群会话 id（未读/标志/隐藏等以字符串 id 为键的设施共用） */
export const groupRowId = (groupId: string) => `group:${groupId}`;
const sessionKeyOf = (groupId: string) => `wx:group:${groupId}`;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 回复策略的展示文案 */
const REPLY_POLICY_LABEL: Record<GroupReplyPolicy, string> = {
  all: '全员回复',
  mention: '仅被@成员',
  auto: 'AI 自判发言',
};

/** AI 自判跳过标记：整条回复只有这个标记时不落盘（不进消息、不提取记忆、不计未读） */
const SKIP_RE = /^\[?\s*(?:SKIP|跳过)\s*\]?$/i;

function memberNameOf(c: ContactRecord): string {
  return displayNameOf(c);
}

/** 剪贴板复制（clipboard API 不可用时回退 execCommand） */
function copyText(text: string, onToast: (m: string) => void): void {
  const done = () => onToast('已复制');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => onToast('复制失败'));
    return;
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    done();
  } catch {
    onToast('复制失败');
  }
}

/** 气泡上方时间分隔（间隔 >5 分钟才显示） */
function fmtGroupTime(ts: number): string {
  const d = new Date(ts);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hm;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/** 群头像：自定义头像优先；否则前 4 名成员头像拼贴（真微信同款风格） */
export function GroupAvatar({
  group,
  contacts,
  size = 48,
}: {
  group: ChatGroup;
  contacts: ContactRecord[];
  size?: number;
}) {
  const members = group.memberIds
    .map((id) => contacts.find((c) => c.id === id))
    .filter((c): c is ContactRecord => !!c)
    .slice(0, 4);
  if (group.avatar) {
    return (
      <img
        src={group.avatar}
        alt={`${group.name} 群头像`}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-[6px] object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="grid shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-[6px] bg-[#DCDCDC] dark:bg-[#3A3A3A]"
      aria-label={`${group.name} 群头像`}
    >
      {members.length === 0 ? (
        <div className="col-span-2 row-span-2 flex items-center justify-center">
          <Users style={{ width: size * 0.5, height: size * 0.5 }} className="text-white/80" />
        </div>
      ) : (
        <>
          {members.map((m) =>
            m.avatar ? (
              <img key={m.id} src={m.avatar} alt={m.name} className="h-full w-full object-cover" />
            ) : (
              <div key={m.id} className="flex h-full w-full items-center justify-center bg-[#C7C7C7] dark:bg-[#4A4A4A]">
                <DefaultAvatar size={size / 2.4} />
              </div>
            )
          )}
          {Array.from({ length: 4 - members.length }).map((_, i) => (
            <div key={`pad-${i}`} className="bg-[#E6E6E6] dark:bg-[#333333]" />
          ))}
        </>
      )}
    </div>
  );
}

// ---------------- 通用小件 ----------------

function GroupNavBar({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-20 shrink-0 border-b border-black/5 bg-[#EDEDED]/95 pt-[54px] backdrop-blur dark:border-white/10 dark:bg-[#111111]/95">
      <div className="flex h-11 items-center px-3">
        <button
          type="button"
          aria-label="返回"
          onClick={onBack}
          className="-ml-1 p-1 text-black/75 active:opacity-50 dark:text-white/75"
        >
          <ChevronLeft className="h-[23px] w-[23px]" strokeWidth={2.2} />
        </button>
        <div className="flex-1 truncate text-center text-[16px] font-medium">{title}</div>
        <div className="flex min-w-[32px] items-center justify-end">{right}</div>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  onClick,
  danger,
  testId,
}: {
  label: string;
  value?: string;
  onClick?: () => void;
  danger?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left ${onClick ? 'active:bg-black/5 dark:active:bg-white/5' : 'cursor-default'}`}
    >
      <span className={`text-[15px] ${danger ? 'text-[#FA5150]' : ''}`}>{label}</span>
      <span className="ml-auto flex items-center gap-1 text-[13px] text-black/40 dark:text-white/40">
        {value}
        {onClick && <ChevronRight className="h-4 w-4" />}
      </span>
    </button>
  );
}

function SwitchRow({
  label,
  caption,
  checked,
  onChange,
  testId,
}: {
  label: string;
  caption?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[15px]">{label}</div>
        {caption && <div className="mt-0.5 text-[11px] leading-snug text-black/40 dark:text-white/40">{caption}</div>}
      </div>
      <div className="shrink-0">
        <Switch checked={checked} onCheckedChange={onChange} aria-label={label} data-testid={testId} />
      </div>
    </div>
  );
}

function CenterDialog({
  title,
  placeholder,
  initial,
  onCancel,
  onSave,
}: {
  title: string;
  placeholder?: string;
  initial?: string;
  onCancel: () => void;
  onSave: (v: string) => void;
}) {
  const [val, setVal] = useState(initial ?? '');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8" onClick={onCancel}>
      <div className="w-full rounded-[12px] bg-white p-4 dark:bg-[#2C2C2C]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-center text-[15px] font-medium">{title}</div>
        <Input
          value={val}
          autoFocus
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          className="h-10 rounded-[10px] bg-black/5 text-[14px] dark:bg-white/10"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(val);
          }}
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 flex-1 rounded-[8px] bg-black/5 text-[14px] active:opacity-70 dark:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(val)}
            className="h-9 flex-1 rounded-[8px] bg-[#07C160] text-[14px] font-medium text-white active:opacity-80"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ text, onCancel, onConfirm }: { text: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-10" onClick={onCancel}>
      <div className="w-full rounded-[12px] bg-white dark:bg-[#2C2C2C]" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pb-5 pt-6 text-center text-[15px] leading-relaxed">{text}</div>
        <div className="flex border-t border-black/10 dark:border-white/10">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 text-[15px] active:bg-black/5 dark:active:bg-white/5"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 border-l border-black/10 py-3 text-[15px] font-medium text-[#FA5150] active:bg-black/5 dark:border-white/10 dark:active:bg-white/5"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 建群页 ----------------

/** 建群：多选微信好友（CHAR/NPC）+ 群名；至少 1 名成员 */
export function WxGroupCreatePage({
  contacts,
  onBack,
  onCreated,
}: {
  contacts: ContactRecord[];
  onBack: () => void;
  onCreated: (g: ChatGroup) => void;
}) {
  const candidates = useMemo(() => contacts.filter((c) => c.kind !== 'user' && isFriendIn(c, 'wx')), [contacts]);
  const [selected, setSelected] = useState<string[]>([]);
  const [nameDirty, setNameDirty] = useState(false);
  const [name, setName] = useState('');
  const suggested = useMemo(() => {
    const names = selected
      .map((id) => contacts.find((c) => c.id === id))
      .filter((c): c is ContactRecord => !!c)
      .map(memberNameOf);
    return names.length === 0 ? '' : `${names.slice(0, 3).join('、')}的群聊`;
  }, [selected, contacts]);
  const effName = (nameDirty ? name : suggested).trim();

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const create = () => {
    const me = contacts.find((c) => c.kind === 'user');
    if (!me || selected.length === 0) return;
    const g = createGroup({ name: effName || '未命名群聊', memberIds: selected, ownerId: me.id });
    onCreated(g);
  };

  return (
    <div className="flex h-full flex-col bg-[#EDEDED] dark:bg-[#111111]">
      <GroupNavBar title="发起群聊" onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="bg-white px-4 py-3 dark:bg-[#1A1A1A]">
          <Input
            value={effName}
            onChange={(e) => {
              setNameDirty(true);
              setName(e.target.value);
            }}
            placeholder="群聊名称（留空按成员名生成）"
            className="h-10 rounded-[10px] bg-black/5 text-[14px] dark:bg-white/10"
            data-testid="wx-group-name-input"
          />
        </div>
        <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
          <div className="border-b border-black/5 px-4 py-2.5 text-[12px] text-black/45 dark:border-white/10 dark:text-white/45">
            选择群成员（{selected.length} 人）
          </div>
          {candidates.length === 0 && (
            <div className="px-4 py-10 text-center text-[13px] text-black/40 dark:text-white/40">
              还没有微信好友，先去「添加朋友」吧
            </div>
          )}
          {candidates.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                data-testid={`wx-group-cand-${c.id}`}
                onClick={() => toggle(c.id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/5 dark:active:bg-white/5"
              >
                {c.avatar ? (
                  <img src={c.avatar} alt={c.name} className="h-10 w-10 shrink-0 rounded-[6px] object-cover" />
                ) : (
                  <DefaultAvatar size={40} className="shrink-0 rounded-[6px]" />
                )}
                <span className="min-w-0 flex-1 truncate text-[15px]">{memberNameOf(c)}</span>
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    on ? 'border-[#07C160] bg-[#07C160]' : 'border-black/20 dark:border-white/25'
                  }`}
                >
                  {on && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="shrink-0 border-t border-black/5 bg-white p-3 dark:border-white/10 dark:bg-[#1A1A1A]">
        <button
          type="button"
          data-testid="wx-group-create-btn"
          disabled={selected.length === 0}
          onClick={create}
          className="h-11 w-full rounded-[10px] bg-[#07C160] text-[15px] font-medium text-white active:opacity-80 disabled:opacity-40"
        >
          创建群聊
        </button>
      </div>
    </div>
  );
}

// ---------------- 群列表页（通讯录 › 群聊） ----------------

export function WxGroupListPage({
  contacts,
  onBack,
  onOpen,
  onCreate,
}: {
  contacts: ContactRecord[];
  onBack: () => void;
  onOpen: (g: ChatGroup) => void;
  onCreate: () => void;
}) {
  // 每次挂载（从建群/解散返回时父组件会 remount 本页）现场读取，天然最新
  const groups = useMemo(() => listGroups('wx'), []);
  return (
    <div className="flex h-full flex-col bg-[#EDEDED] dark:bg-[#111111]">
      <GroupNavBar
        title="群聊"
        onBack={onBack}
        right={
          <button
            type="button"
            aria-label="发起群聊"
            data-testid="wx-grouplist-add"
            onClick={onCreate}
            className="p-1 text-black/75 active:opacity-50 dark:text-white/75"
          >
            <UserPlus className="h-[20px] w-[20px]" strokeWidth={1.9} />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="px-8 py-20 text-center text-[13px] leading-relaxed text-black/40 dark:text-white/40">
            还没有群聊
            <br />
            点击右上角「+」发起群聊
          </div>
        ) : (
          <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
            {groups.map((g) => {
              const p = groupPreview(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  data-testid={`wx-grouplist-item-${g.id}`}
                  onClick={() => onOpen(g)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/5 dark:active:bg-white/5"
                >
                  <GroupAvatar group={g} contacts={contacts} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">{g.name}</span>
                    {p.text && (
                      <span className="block truncate text-[12px] text-black/40 dark:text-white/40">{p.text}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-[11px] text-black/35 dark:text-white/35">{g.memberIds.length + 1}人</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- 群聊信息页 ----------------

export function WxGroupInfoPage({
  group,
  contacts,
  onBack,
  onUpdate,
  onDissolve,
  onToast,
}: {
  group: ChatGroup;
  contacts: ContactRecord[];
  onBack: () => void;
  onUpdate: (patch: Partial<Pick<ChatGroup, 'name' | 'avatar' | 'announcement' | 'memoryInterop' | 'memberInterop' | 'replyPolicy' | 'memberIds'>>) => void;
  onDissolve: () => void;
  onToast: (m: string) => void;
}) {
  const [dialog, setDialog] = useState<null | { kind: 'name' | 'announcement' }>(null);
  const [memberSheet, setMemberSheet] = useState<ContactRecord | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDissolve, setConfirmDissolve] = useState(false);
  const gid = group.id;
  const [flags, setFlags] = useState<ChatFlags>(() => wxChatFlags.get());
  const [timeAwareOn, setTimeAwareOn] = useState(() => getTimeAware(sessionKeyOf(gid)));
  const fileRef = useRef<HTMLInputElement>(null);

  const members = useMemo(
    () => group.memberIds.map((id) => contacts.find((c) => c.id === id)).filter((c): c is ContactRecord => !!c),
    [group.memberIds, contacts]
  );
  const candidates = useMemo(
    () => contacts.filter((c) => c.kind !== 'user' && isFriendIn(c, 'wx') && !group.memberIds.includes(c.id)),
    [contacts, group.memberIds]
  );

  useEffect(() => wxChatFlags.subscribe(() => setFlags({ ...wxChatFlags.get() })), []);

  const pickAvatar = (file: File) => {
    const reader = new FileReader();
    reader.onerror = () => onToast('读取图片失败');
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => onToast('图片解析失败');
      img.onload = () => {
        const SIZE = 240;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const scale = Math.max(SIZE / img.width, SIZE / img.height);
        ctx.drawImage(img, (SIZE - img.width * scale) / 2, (SIZE - img.height * scale) / 2, img.width * scale, img.height * scale);
        onUpdate({ avatar: canvas.toDataURL('image/jpeg', 0.82) });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const removeMember = (c: ContactRecord) => {
    setMemberSheet(null);
    setRemoveOpen(false);
    if (members.length <= 1) {
      onToast('至少保留一名成员');
      return;
    }
    const next = removeGroupMember(gid, c.id);
    if (next) {
      onToast(`已移出 ${memberNameOf(c)}`);
      onUpdate({ memberIds: next.memberIds });
    }
  };

  /** 按成员覆盖互通的三态循环：跟随群聊 → 强制互通 → 强制隔离 → 跟随群聊 */
  const cycleMemberInterop = (cid: string) => {
    const cur = group.memberInterop?.[cid];
    const next: 'on' | 'off' | undefined = cur === undefined ? 'on' : cur === 'on' ? 'off' : undefined;
    const map = { ...(group.memberInterop ?? {}) };
    if (next === undefined) delete map[cid];
    else map[cid] = next;
    onUpdate({ memberInterop: Object.keys(map).length > 0 ? map : undefined });
    onToast(next === 'on' ? '已强制互通' : next === 'off' ? '已强制隔离' : '已恢复跟随群聊');
  };

  const memberInteropLabel = (cid: string): string => {
    const ov = group.memberInterop?.[cid];
    return ov === 'on' ? '强制互通' : ov === 'off' ? '强制隔离' : '跟随群聊';
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#EDEDED] dark:bg-[#111111]">
      <GroupNavBar title={`聊天信息(${members.length + 1})`} onBack={onBack} />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pickAvatar(f);
          e.target.value = '';
        }}
      />

      {/* 成员格点（对照真微信：成员头像瓦片 + 虚线 ＋/－ 按钮） */}
      <div className="bg-white px-4 py-4 dark:bg-[#1A1A1A]">
        <div className="grid grid-cols-5 gap-y-3">
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              className="flex flex-col items-center gap-1.5"
              onClick={() => setMemberSheet(m)}
              data-testid={`wx-groupinfo-member-${m.id}`}
            >
              {m.avatar ? (
                <img src={m.avatar} alt={m.name} className="h-11 w-11 rounded-[6px] object-cover" />
              ) : (
                <DefaultAvatar size={44} className="rounded-[6px]" />
              )}
              <span className="max-w-[56px] truncate text-[11px] leading-none text-black/50 dark:text-white/50">
                {memberNameOf(m)}
              </span>
            </button>
          ))}
          <button
            type="button"
            aria-label="邀请成员"
            className="flex flex-col items-center gap-1.5"
            onClick={() => setInviteOpen(true)}
            data-testid="wx-groupinfo-invite"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-[6px] border-[1.5px] border-dashed border-black/[0.18] dark:border-white/[0.25]">
              <Plus className="h-[22px] w-[22px] text-black/30 dark:text-white/35" strokeWidth={1.6} />
            </span>
          </button>
          {members.length > 0 && (
            <button
              type="button"
              aria-label="移除成员"
              className="flex flex-col items-center gap-1.5"
              onClick={() => setRemoveOpen(true)}
              data-testid="wx-groupinfo-remove"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-[6px] border-[1.5px] border-dashed border-black/[0.18] dark:border-white/[0.25]">
                <Minus className="h-[22px] w-[22px] text-black/30 dark:text-white/35" strokeWidth={1.6} />
              </span>
            </button>
          )}
        </div>
      </div>

      {/* 群资料 */}
      <div className="mt-2 divide-y divide-black/5 bg-white dark:divide-white/10 dark:bg-[#1A1A1A]">
        <InfoRow label="群聊名称" value={group.name} onClick={() => setDialog({ kind: 'name' })} testId="wx-groupinfo-name" />
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/5 dark:active:bg-white/5"
          onClick={() => fileRef.current?.click()}
          data-testid="wx-groupinfo-avatar"
        >
          <span className="text-[15px]">群头像</span>
          <span className="ml-auto flex items-center gap-2">
            <GroupAvatar group={group} contacts={contacts} size={40} />
            <ChevronRight className="h-4 w-4 text-black/30 dark:text-white/30" />
          </span>
        </button>
        <InfoRow
          label="群公告"
          value={group.announcement ? `${group.announcement.slice(0, 12)}…` : '未设置'}
          onClick={() => setDialog({ kind: 'announcement' })}
          testId="wx-groupinfo-notice"
        />
        <InfoRow
          label="回复策略"
          value={REPLY_POLICY_LABEL[group.replyPolicy ?? 'all']}
          onClick={() => setPolicyOpen(true)}
          testId="wx-groupinfo-policy"
        />
        <SwitchRow
          label="记忆与私聊互通"
          caption="开启后：群里发生的事，成员在私聊里也记得；成员的私聊记忆也会带进群聊。关闭则完全隔离（按群独立设置，下方可按成员覆盖）。"
          checked={group.memoryInterop}
          onChange={(v) => {
            onUpdate({ memoryInterop: v });
            onToast(v ? '已开启互通' : '已关闭互通');
          }}
          testId="wx-groupinfo-interop"
        />
        {/* 按成员覆盖互通（三态）：精确控制每个角色的群↔私聊记忆流向 */}
        {members.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-[13px] font-medium text-black/60 dark:text-white/60">按成员覆盖互通</div>
            <div className="mt-1 text-[11px] leading-snug text-black/40 dark:text-white/40">
              缺省跟随上方群开关；可对单个成员强制互通或强制隔离（只影响 TA 在本群与私聊之间的记忆，不影响成员之间）。
            </div>
            <div className="mt-2 space-y-1.5">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2.5">
                  {m.avatar ? (
                    <img src={m.avatar} alt={m.name} className="h-[30px] w-[30px] shrink-0 rounded-[6px] object-cover" />
                  ) : (
                    <DefaultAvatar size={30} className="shrink-0 rounded-[6px]" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[14px]">{memberNameOf(m)}</span>
                  <button
                    type="button"
                    data-testid={`wx-groupinfo-minterop-${m.id}`}
                    onClick={() => cycleMemberInterop(m.id)}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium active:opacity-70 ${
                      group.memberInterop?.[m.id] === 'on'
                        ? 'bg-[#07C160]/10 text-[#07C160]'
                        : group.memberInterop?.[m.id] === 'off'
                          ? 'bg-[#FA5150]/10 text-[#FA5150]'
                          : 'bg-black/[0.05] text-black/50 dark:bg-white/10 dark:text-white/55'
                    }`}
                  >
                    {memberInteropLabel(m.id)}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <SwitchRow
          label="时间感知"
          caption="让成员按当前时段与消息间隔感知时间（按群独立）"
          checked={timeAwareOn}
          onChange={(v) => {
            setTimeAware(sessionKeyOf(gid), v);
            setTimeAwareOn(v);
          }}
        />
        <SwitchRow
          label="置顶聊天"
          checked={flags[groupRowId(gid)]?.pinned === true}
          onChange={(v) => wxChatFlags.update(groupRowId(gid), { pinned: v })}
        />
        <SwitchRow
          label="消息免打扰"
          checked={flags[groupRowId(gid)]?.muted === true}
          onChange={(v) => wxChatFlags.update(groupRowId(gid), { muted: v })}
        />
      </div>

      <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
        <InfoRow label="清空聊天记录" danger onClick={() => setConfirmClear(true)} testId="wx-groupinfo-clear" />
      </div>
      <button
        type="button"
        data-testid="wx-groupinfo-dissolve"
        onClick={() => setConfirmDissolve(true)}
        className="mt-2 w-full bg-white py-[13px] text-center text-[15px] text-[#FA5150] active:bg-black/5 dark:bg-[#1A1A1A] dark:active:bg-white/5"
      >
        退出群聊
      </button>
      <div className="py-8 text-center text-[11px] text-black/30 dark:text-white/30">
        群聊为本地模拟，不含任何真实资金操作
      </div>

      {/* 成员操作 */}
      {memberSheet && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setMemberSheet(null)}>
          <div className="w-full rounded-t-[14px] bg-white p-2 pb-6 dark:bg-[#2C2C2C]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-3 py-2">
              {memberSheet.avatar ? (
                <img src={memberSheet.avatar} alt={memberSheet.name} className="h-10 w-10 rounded-[8px] object-cover" />
              ) : (
                <DefaultAvatar size={40} className="rounded-[8px]" />
              )}
              <div className="text-[15px]">{memberNameOf(memberSheet)}</div>
            </div>
            <button
              type="button"
              data-testid="wx-groupinfo-remove-member"
              onClick={() => removeMember(memberSheet)}
              className="mt-1 flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[15px] text-[#FA5150] active:bg-black/5 dark:active:bg-white/5"
            >
              <UserMinus className="h-4 w-4" />
              移出群聊
            </button>
          </div>
        </div>
      )}

      {/* 移除成员（虚线 － 入口） */}
      {removeOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#EDEDED] dark:bg-[#111111]">
          <GroupNavBar title="移除成员" onBack={() => setRemoveOpen(false)} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="bg-white dark:bg-[#1A1A1A]">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`wx-group-remove-${m.id}`}
                  onClick={() => removeMember(m)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/5 dark:active:bg-white/5"
                >
                  {m.avatar ? (
                    <img src={m.avatar} alt={m.name} className="h-10 w-10 shrink-0 rounded-[6px] object-cover" />
                  ) : (
                    <DefaultAvatar size={40} className="shrink-0 rounded-[6px]" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[15px]">{memberNameOf(m)}</span>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
                    <Minus className="h-4 w-4 text-black/45 dark:text-white/50" />
                  </span>
                </button>
              ))}
            </div>
            <div className="px-8 py-10 text-center text-[12px] text-black/35 dark:text-white/35">点击成员将其移出群聊（至少保留一名）</div>
          </div>
        </div>
      )}

      {/* 邀请成员 */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#EDEDED] dark:bg-[#111111]">
          <GroupNavBar title="邀请成员" onBack={() => setInviteOpen(false)} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {candidates.length === 0 ? (
              <div className="px-8 py-20 text-center text-[13px] text-black/40 dark:text-white/40">没有可邀请的微信好友</div>
            ) : (
              <div className="bg-white dark:bg-[#1A1A1A]">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-testid={`wx-group-invite-${c.id}`}
                    onClick={() => {
                      const next = addGroupMember(gid, c.id);
                      if (next) onUpdate({ memberIds: next.memberIds });
                      onToast(`已邀请 ${memberNameOf(c)}`);
                      setInviteOpen(false);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/5 dark:active:bg-white/5"
                  >
                    {c.avatar ? (
                      <img src={c.avatar} alt={c.name} className="h-10 w-10 shrink-0 rounded-[6px] object-cover" />
                    ) : (
                      <DefaultAvatar size={40} className="shrink-0 rounded-[6px]" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[15px]">{memberNameOf(c)}</span>
                    <UserPlus className="h-4 w-4 shrink-0 text-black/40 dark:text-white/40" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {dialog?.kind === 'name' && (
        <CenterDialog
          title="群聊名称"
          initial={group.name}
          onCancel={() => setDialog(null)}
          onSave={(v) => {
            const t = v.trim();
            if (t) onUpdate({ name: t });
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'announcement' && (
        <CenterDialog
          title="群公告"
          initial={group.announcement}
          placeholder="写入群公告，成员会在群聊语境里看到"
          onCancel={() => setDialog(null)}
          onSave={(v) => {
            onUpdate({ announcement: v.trim() });
            setDialog(null);
          }}
        />
      )}
      {/* 回复策略选择 */}
      {policyOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setPolicyOpen(false)}>
          <div className="w-full rounded-t-[14px] bg-white p-2 pb-6 dark:bg-[#2C2C2C]" onClick={(e) => e.stopPropagation()}>
            <div className="px-3 pb-1 pt-2 text-center text-[13px] text-black/45 dark:text-white/45">
              谁来回复（决定每个成员是否发言）
            </div>
            {(Object.keys(REPLY_POLICY_LABEL) as GroupReplyPolicy[]).map((p) => {
              const on = (group.replyPolicy ?? 'all') === p;
              const desc =
                p === 'all'
                  ? '所有成员按顺序逐个回复'
                  : p === 'mention'
                    ? '只有被 @ 的成员回复（没人被 @ 就没人说话）'
                    : '每个成员根据人设与消息内容自判要不要说话（无话可说就沉默）';
              return (
                <button
                  key={p}
                  type="button"
                  data-testid={`wx-groupinfo-policy-${p}`}
                  onClick={() => {
                    onUpdate({ replyPolicy: p });
                    setPolicyOpen(false);
                    onToast(`已设为${REPLY_POLICY_LABEL[p]}`);
                  }}
                  className="flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left active:bg-black/5 dark:active:bg-white/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px]">{REPLY_POLICY_LABEL[p]}</span>
                    <span className="block text-[11px] text-black/40 dark:text-white/40">{desc}</span>
                  </span>
                  {on && <Check className="h-4 w-4 shrink-0 text-[#07C160]" strokeWidth={2.5} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {confirmClear && (
        <ConfirmDialog
          text="确定清空该群的聊天记录？"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            saveGroupMsgs(gid, []);
            setConfirmClear(false);
            onToast('已清空');
            onUpdate({});
          }}
        />
      )}
      {confirmDissolve && (
        <ConfirmDialog
          text="退出后将解散该群并删除聊天记录，确定退出？"
          onCancel={() => setConfirmDissolve(false)}
          onConfirm={() => {
            setConfirmDissolve(false);
            onDissolve();
          }}
        />
      )}
    </div>
  );
}

// ---------------- 群聊页 ----------------

/**
 * 群聊页。群回合引擎（多角色顺序流式回复）：
 * - runningRef 防重入；每个角色 await 一次 beginChatStream→finalize 的完整回合；
 * - 流式气泡头像/名字由 groupSpeaker 模块级 map 提供（页面中途退出重进也能对上发言角色）；
 * - finalize 里 loadGroupMsgs→append→saveGroupMsgs（组件卸载后照样落盘）+ 未读 + 记忆提取。
 */
let activeGroupKey: string | null = null;
const groupSpeaker = new Map<string, string>();

export function WxGroupChatPage({
  group,
  me,
  contacts,
  ownerLabelOf,
  onBack,
  onUpdate,
  onOpenInfo,
  onDissolve,
  onToast,
}: {
  group: ChatGroup;
  me: { id: string; name: string; avatar: string | null };
  contacts: ContactRecord[];
  /** NPC 归属者名解析（人设 prompt 用） */
  ownerLabelOf: (peer: ContactRecord) => string | null;
  onBack: () => void;
  onUpdate: (patch: Partial<Pick<ChatGroup, 'name' | 'memberIds' | 'memoryInterop' | 'memberInterop' | 'replyPolicy'>>) => void;
  onOpenInfo: () => void;
  onDissolve: () => void;
  onToast: (m: string) => void;
}) {
  const gid = group.id;
  const sKey = sessionKeyOf(gid);
  const [msgs, setMsgs] = useState<WxGroupMsg[]>(() => loadGroupMsgs(gid));
  const [draft, setDraft] = useState('');
  const [quote, setQuote] = useState<{ name: string; content: string } | null>(null);
  const [atOpen, setAtOpen] = useState(false);
  const [speakerId, setSpeakerId] = useState<string | null>(() => groupSpeaker.get(sKey) ?? null);
  const stream = useChatStream(sKey);
  const apiConfig = useSettings((s) => s.apiConfig);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const groupRef = useRef(group);
  groupRef.current = group;

  // 长按菜单
  const [menu, setMenu] = useState<null | { mid: string }>(null);

  const members = useMemo(
    () =>
      groupRef.current.memberIds
        .map((id) => contacts.find((c) => c.id === id))
        .filter((c): c is ContactRecord => !!c),
    [contacts, group.memberIds]
  );
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  useEffect(() => {
    mountedRef.current = true;
    activeGroupKey = sKey;
    return () => {
      mountedRef.current = false;
      if (activeGroupKey === sKey) activeGroupKey = null;
    };
  }, [sKey]);

  /** 流结束后同步落盘消息并清流（与私聊同款：页面存活与否都正确） */
  useEffect(() => {
    if (stream && stream.status !== 'streaming') {
      const latest = loadGroupMsgs(gid);
      setMsgs(latest);
      const t = setTimeout(() => clearChatStream(sKey), 0);
      return () => clearTimeout(t);
    }
  }, [stream, gid, sKey]);

  /** 新消息滚动到底 */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, stream?.content]);

  /** 落盘一条消息（finalize 与本地发送共用；组件不在也正确写存储） */
  const appendMsg = useCallback(
    (m: WxGroupMsg) => {
      const next = [...loadGroupMsgs(gid), m];
      saveGroupMsgs(gid, next);
      if (mountedRef.current) setMsgs(next);
      if (activeGroupKey !== sKey && m.kind !== 'notice') {
        wxUnreads.bump(groupRowId(gid), 1);
      }
    },
    [gid, sKey]
  );

  /** @ 某成员：插入「@名字 」到草稿 */
  const insertMention = (c: ContactRecord) => {
    setAtOpen(false);
    setDraft((d) => `${d}${d && !d.endsWith(' ') ? ' ' : ''}@${memberNameOf(c)} `);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  /** 解析草稿里的 @（按成员显示名精确匹配） */
  const parseMentions = (text: string): ContactRecord[] =>
    members.filter((c) => text.includes(`@${memberNameOf(c)}`));

  /** 单个角色的一个回复回合：组装独立 system → 流式 → finalize 落盘/记忆 */
  const runCharTurn = useCallback(
    (char: ContactRecord) =>
      new Promise<void>((resolve) => {
        const g = getGroup(gid);
        if (!g) {
          resolve();
          return;
        }
        const charName = memberNameOf(char);
        const meName = me.name;
        const ctxMsgs = loadGroupMsgs(gid)
          .filter((m) => m.kind !== 'notice' && !m.recalled)
          .slice(-24);
        // 上下文映射：自己 → assistant；机主/其他成员 → 「发言者：内容」user 消息
        const history: ChatPayloadMessage[] = ctxMsgs.map((m): ChatPayloadMessage => {
          if (m.role === 'me') {
            const content = `${m.quote ? `（引用 ${m.quote.name}：「${m.quote.content}」）` : ''}${m.content}`;
            return { role: 'user', content: `${meName}：${content}` };
          }
          if (m.senderId === char.id) return { role: 'assistant', content: m.content };
          return { role: 'user', content: `${m.senderName || '成员'}：${m.content}` };
        });
        const lastUserText = [...ctxMsgs].reverse().find((m) => m.role === 'me')?.content ?? '';
        const memContext = [lastUserText, ...ctxMsgs.slice(-6).map((m) => m.content)].filter(Boolean).join(' ');

        // 群聊规则（每个角色独立声明：当前是群聊、参与者有谁、只代表自己、禁复读、可互相对话）
        const others = g.memberIds
          .map((id) => contactsRef.current.find((c) => c.id === id))
          .filter((c): c is ContactRecord => !!c)
          .filter((c) => c.id !== char.id);
        const groupRules = [
          `【群聊模式】当前是群聊「${g.name}」，不是一对一私聊。参与成员：${meName}（机主用户）${
            others.length ? '、' + others.map(memberNameOf).join('、') : ''
          }。你以「${charName}」的身份参与其中。`,
          '聊天记录里每条消息都以「发言者：内容」标注来源；以自己名字开头的是你自己说过的话。',
          '只以「' + charName + '」的身份和口吻发言，绝不替其他成员发言、代答或描写他们的言行。',
          '不复制、不复述、不换说法重复其他成员刚说过的内容（群里最忌跟风复读）。',
          '可以自然称呼、回应其他成员的观点，角色之间也能互相对话，不只是跟机主说话，像真实群聊那样互动，但始终保持自己的人设与语气（群聊语气可以比私聊随意，人设不能变）。',
          '把群里的每个成员都当作真实的群友，绝不出戏：不说「用户」「AI」「角色」「人设」这类幕后词汇，也不表现出「我知道谁在操作」。',
          '每次只发一条简短消息（一两句话），像真人在群里随手打字。',
        ];
        // 群成员速览（关系感知）：其他成员是谁、与机主的关系、性格速写（角色间相处按双方人设自然把握）
        const memberLines = others.map((c) => {
          const rel = (c.relation ?? '').trim();
          const ps = (c.persona ?? '').trim();
          const bits = [rel ? `与${meName}是${rel}` : '', ps ? ps.slice(0, 48) : ''].filter(Boolean);
          return `- ${memberNameOf(c)}${bits.length ? `（${bits.join('；')}）` : ''}`;
        });
        if (memberLines.length > 0) {
          groupRules.push('【群成员速览】群里其他成员的情况（你与他们的相处方式按你的人设与各自人设自然把握）：', ...memberLines);
        }
        if (g.announcement) groupRules.push(`【群公告】${g.announcement}`);
        // AI 自判发言：无话可说时只回 [SKIP]（finalize 阶段整条丢弃，不落盘）
        if (g.replyPolicy === 'auto') {
          groupRules.push('【发言判断】刚发出的这条消息如果与你无关、不需要你表态或你无话可说（比如别人在单独聊天），只回复 [SKIP] 两个词，不要说任何其他内容；有你要说的就正常回复。');
        }

        const npcExtra = buildNpcPromptExtra(char, contactsRef.current);
        const system = buildPersonaSystemPrompt(char, {
          channel: '微信',
          userName: meName,
          ownerName: ownerLabelOf(char),
          ...npcExtra,
          extraRules: groupRules,
        });
        // 记忆（按角色隔离 + 群互通开关 + 按成员覆盖）：mode='group' → 本群记忆 + 互通开启时的自己私聊记忆
        const memoryBlock = memRecallBlock(char.id, 'wx', memContext, {
          mode: 'group',
          groupId: gid,
          interopOn: (g2: string) => effectiveInterop(g2, char.id),
        });
        const wbBlocks = collectWbBlocks(char.id, wbScanText([lastUserText, memContext]));
        const timeBlock = getTimeAware(sKey)
          ? buildTimeAwareBlock({ lastMsgTime: ctxMsgs[ctxMsgs.length - 1]?.time ?? null, regionHint: char.region })
          : '';
        const systemFull = [
          wbBlocks.beforeSystem,
          [wbBlocks.beforeChar, system, wbBlocks.afterChar].filter(Boolean).join('\n\n'),
          memoryBlock,
          timeBlock,
          wbBlocks.afterSystem,
          wbRulesBlock(wbBlocks),
        ]
          .filter(Boolean)
          .join('\n\n');
        const payload: ChatPayloadMessage[] = [{ role: 'system', content: systemFull }, ...history];
        const messages = applyWbUserBlocks(payload, wbBlocks);

        const ok = beginChatStream({
          sessionKey: sKey,
          aiMsgId: genId(),
          messages,
          apiConfig,
          finalize: (result) => {
            const text = (result.content ?? '').trim();
            // AI 自判沉默：整条回复是 [SKIP] 标记 → 不落盘、不提取记忆（本轮对 TA 没有发生任何社交事件）
            if (g.replyPolicy === 'auto' && SKIP_RE.test(text)) {
              resolve();
              return;
            }
            const reply: WxGroupMsg = {
              id: result.aiMsgId,
              role: 'peer',
              senderId: char.id,
              senderName: charName,
              content: text || '（…）',
              time: Date.now(),
            };
            appendMsg(reply);
            // 群记忆提取（按角色 + 按群隔离轮次；碎片带群来源标记）
            void (async () => {
              try {
                const [u, p] = await Promise.all([ownerRealName(), contactRealName(char.id)]);
                memAfterAiTurn(
                  char.id,
                  'wx',
                  apiConfig,
                  () =>
                    loadGroupMsgs(gid)
                      .filter((m) => m.kind !== 'notice' && !m.recalled)
                      .slice(-30)
                      .map((m) =>
                        m.role === 'me'
                          ? { role: 'me' as const, text: m.content }
                          : { role: 'peer' as const, text: `${m.senderName}：${m.content}` }
                      ),
                  undefined,
                  { user: u, peer: p },
                  { roundScope: `group:${gid}`, group: { id: gid, members: [me.id, ...groupRef.current.memberIds] } }
                );
              } catch {
                // 名字解析失败不影响落盘
              }
            })();
            resolve();
          },
        });
        if (!ok) resolve(); // 会话流被占用（不应发生：队列串行 + 防重入）
      }),
    [apiConfig, appendMsg, gid, me.id, me.name, ownerLabelOf, sKey]
  );

  /** 一个群回合：按回复策略决定谁回复；@ 成员优先，其余按成员顺序逐个回复 */
  const runGroupTurn = useCallback(
    async (myMsg: WxGroupMsg) => {
      if (runningRef.current || isChatStreaming(sKey)) return;
      const g = getGroup(gid);
      if (!g || g.memberIds.length === 0) return;
      runningRef.current = true;
      try {
        const all = g.memberIds
          .map((id) => contactsRef.current.find((c) => c.id === id))
          .filter((c): c is ContactRecord => !!c);
        const mentioned = parseMentions(myMsg.content);
        const policy = g.replyPolicy ?? 'all';
        // 'mention'：只跑被 @ 成员；'all'/'auto'：全员（被 @ 优先），'auto' 由每轮 [SKIP] 自行沉默
        const ordered =
          policy === 'mention' ? mentioned : mentioned.length > 0 ? [...mentioned, ...all.filter((m) => !mentioned.includes(m))] : all;
        for (const char of ordered) {
          if (!getGroup(gid)) break; // 群已被解散
          groupSpeaker.set(sKey, char.id);
          if (mountedRef.current) setSpeakerId(char.id);
          await runCharTurn(char);
          await sleep(420);
        }
      } finally {
        runningRef.current = false;
        groupSpeaker.delete(sKey);
        if (mountedRef.current) setSpeakerId(null);
      }
    },
    [gid, runCharTurn, sKey]
  );

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (runningRef.current || isChatStreaming(sKey)) {
      onToast('成员们还在回复，稍等一下');
      return;
    }
    const msg: WxGroupMsg = {
      id: uid(),
      role: 'me',
      senderId: 'me',
      senderName: me.name,
      content: text,
      time: Date.now(),
      quote: quote ?? undefined,
    };
    setDraft('');
    setQuote(null);
    appendMsg(msg);
    void runGroupTurn(msg);
  };

  // 长按菜单动作
  const menuMsg = menu ? msgs.find((m) => m.id === menu.mid) ?? null : null;
  const menuItems: BubbleMenuItem[] = useMemo(() => {
    if (!menuMsg) return [];
    const items: BubbleMenuItem[] = [{ key: 'copy', label: '复制', icon: Pencil }];
    if (menuMsg.kind === 'text' && !menuMsg.recalled) items.push({ key: 'quote', label: '引用', icon: AtSign });
    if (!menuMsg.recalled) items.push({ key: 'recall', label: '撤回', icon: X });
    items.push({ key: 'del', label: '删除', icon: Trash2, danger: true });
    return items;
  }, [menuMsg]);

  const bubblePress = useBubbleLongPress((el) => {
    const host = el.closest('[data-mid]') as HTMLElement | null;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setMenuRect(computeBubbleMenuPos(rect, listRef.current?.getBoundingClientRect() ?? null, menuItems.length || 3));
    setMenu({ mid: host.dataset.mid ?? '' });
  });
  const [menuRect, setMenuRect] = useState<ReturnType<typeof computeBubbleMenuPos> | null>(null);

  const onMenuSelect = (key: string) => {
    if (!menuMsg) return;
    setMenu(null);
    setMenuRect(null);
    if (key === 'copy') {
      copyText(menuMsg.content, onToast);
    } else if (key === 'quote') {
      setQuote({ name: menuMsg.role === 'me' ? '我' : menuMsg.senderName, content: menuMsg.content });
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (key === 'recall') {
      setMsgs((prev) => {
        const next = prev.map((m) => (m.id === menuMsg.id ? { ...m, recalled: true } : m));
        saveGroupMsgs(gid, next);
        return next;
      });
      onToast('已撤回');
    } else if (key === 'del') {
      setMsgs((prev) => {
        const next = prev.filter((m) => m.id !== menuMsg.id);
        saveGroupMsgs(gid, next);
        return next;
      });
    }
  };

  const speaker = speakerId ? memberById.get(speakerId) ?? null : null;
  const streaming = stream?.status === 'streaming';

  return (
    <div className="relative flex h-full flex-col bg-[#EDEDED] dark:bg-[#111111]">
      {/* 顶栏 */}
      <div className="shrink-0 border-b border-black/5 bg-[#EDEDED] pt-[54px] dark:border-white/10 dark:bg-[#111111]">
        <div className="flex h-11 items-center px-3">
          <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 p-1 text-black/75 active:opacity-50 dark:text-white/75">
            <ChevronLeft className="h-[23px] w-[23px]" strokeWidth={2.2} />
          </button>
          <button type="button" onClick={onOpenInfo} data-testid="wx-groupchat-openinfo" className="flex min-w-0 flex-1 justify-center active:opacity-60">
            <span className="max-w-[210px] truncate text-[16px] font-medium">{group.name}({members.length + 1})</span>
          </button>
          <button
            type="button"
            aria-label="聊天信息"
            onClick={onOpenInfo}
            data-testid="wx-groupchat-info"
            className="-mr-1 ml-auto px-1.5 py-1 text-[20px] font-light leading-none text-black/70 active:opacity-50 dark:text-white/70"
          >
            …
          </button>
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2" data-testid="wx-groupchat-list">
        {msgs.length === 0 && (
          <div className="pt-16 text-center text-[12px] leading-relaxed text-black/35 dark:text-white/35">
            群聊已创建
            <br />
            发条消息打个招呼吧（@某位成员可让它优先回复）
          </div>
        )}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const showTime = !prev || m.time - prev.time > 5 * 60_000;
          if (m.kind === 'notice') {
            return (
              <div key={m.id} className="py-2 text-center">
                {showTime && <div className="pb-1 text-[11px] text-black/30 dark:text-white/30">{fmtGroupTime(m.time)}</div>}
                <span className="inline-block rounded-[4px] bg-black/5 px-2 py-0.5 text-[11px] text-black/45 dark:bg-white/10 dark:text-white/45">
                  {m.noticeText ?? m.content}
                </span>
              </div>
            );
          }
          const mine = m.role === 'me';
          const sender = mine ? null : m.senderId === 'unknown' ? null : memberById.get(m.senderId) ?? null;
          const senderAvatar = mine ? me.avatar : sender?.avatar ?? null;
          return (
            <div key={m.id} data-mid={m.id} {...bubblePress}>
              {showTime && <div className="py-2 text-center text-[11px] text-black/30 dark:text-white/30">{fmtGroupTime(m.time)}</div>}
              {m.recalled ? (
                <div className="py-1.5 text-center">
                  <span className="inline-block rounded-[4px] bg-black/5 px-2 py-0.5 text-[11px] text-black/45 dark:bg-white/10 dark:text-white/45">
                    {mine ? '你' : m.senderName || '有人'}撤回了一条消息
                  </span>
                </div>
              ) : (
                <div className={`mb-3 flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                  {senderAvatar ? (
                    <img src={senderAvatar} alt={mine ? me.name : m.senderName} className="h-9 w-9 shrink-0 rounded-[5px] object-cover" />
                  ) : (
                    <DefaultAvatar size={36} className="shrink-0 rounded-[5px]" />
                  )}
                  <div className={`flex min-w-0 max-w-[72%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    {!mine && <span className="mb-0.5 px-1 text-[12px] leading-none text-black/45 dark:text-white/45">{m.senderName}</span>}
                    <div
                      className={`relative ${mine ? 'rounded-[8px] bg-[#95EC69] dark:bg-[#3EB575]' : 'rounded-[8px] bg-white dark:bg-[#2C2C2C]'} px-3 py-2 text-[15px] leading-relaxed`}
                      data-testid={mine ? 'wx-groupmsg-me' : 'wx-groupmsg-peer'}
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute top-[13px] h-[6px] w-[6px] rotate-45 rounded-[1px] ${
                          mine ? '-right-[3px] bg-[#95EC69] dark:bg-[#3EB575]' : '-left-[3px] bg-white dark:bg-[#2C2C2C]'
                        }`}
                      />
                      {m.quote && (
                        <div className="mb-1 border-l-2 border-black/20 pl-2 text-[11px] leading-snug text-black/45 dark:border-white/25 dark:text-white/45">
                          引用 {m.quote.name}：{m.quote.content}
                        </div>
                      )}
                      <span className="whitespace-pre-wrap break-words">{m.content}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {/* 流式气泡（当前发言角色） */}
        {streaming && stream && (
          <div className="mb-3 flex gap-2" data-testid="wx-group-stream">
            {speaker?.avatar ? (
              <img src={speaker.avatar} alt={memberNameOf(speaker)} className="h-9 w-9 shrink-0 rounded-[5px] object-cover" />
            ) : (
              <DefaultAvatar size={36} className="shrink-0 rounded-[5px]" />
            )}
            <div className="flex min-w-0 max-w-[72%] flex-col items-start">
              <span className="mb-0.5 px-1 text-[12px] leading-none text-black/45 dark:text-white/45">
                {speaker ? memberNameOf(speaker) : '…'}
              </span>
              <div className="relative rounded-[8px] bg-white px-3 py-2 text-[15px] leading-relaxed dark:bg-[#2C2C2C]">
                <span aria-hidden="true" className="absolute -left-[3px] top-[13px] h-[6px] w-[6px] rotate-45 rounded-[1px] bg-white dark:bg-[#2C2C2C]" />
                <span className="whitespace-pre-wrap break-words">{stream.content || '…'}</span>
                <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-black/40 align-text-bottom dark:bg-white/40" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-black/5 bg-[#F7F7F7] dark:border-white/10 dark:bg-[#1A1A1A]">
        {quote && (
          <div className="flex items-center gap-2 border-b border-black/5 px-3 py-1.5 text-[12px] text-black/50 dark:border-white/10 dark:text-white/50">
            <span className="min-w-0 flex-1 truncate">引用 {quote.name}：{quote.content}</span>
            <button type="button" aria-label="取消引用" onClick={() => setQuote(null)} className="shrink-0 active:opacity-60">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            aria-label="提及成员"
            data-testid="wx-groupchat-at"
            onClick={() => setAtOpen((v) => !v)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/5 text-black/55 active:opacity-60 dark:bg-white/10 dark:text-white/55"
          >
            <AtSign className="h-[18px] w-[18px]" />
          </button>
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={streaming ? '成员回复中…' : '发消息…@ 可点名'}
            disabled={streaming || runningRef.current}
            className="h-9 flex-1 rounded-[8px] bg-white text-[15px] dark:bg-[#2C2C2C]"
            data-testid="wx-groupchat-input"
          />
          <button
            type="button"
            onClick={send}
            disabled={streaming || !draft.trim()}
            data-testid="wx-groupchat-send"
            aria-label="发送"
            className="flex h-9 shrink-0 items-center gap-1 rounded-[8px] bg-[#07C160] px-3.5 text-[14px] font-medium text-white active:opacity-80 disabled:opacity-40"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
        {/* @ 成员浮层 */}
        {atOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setAtOpen(false)} aria-hidden="true" />
            <div className="absolute bottom-[54px] left-3 z-40 w-[220px] overflow-hidden rounded-[10px] border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#2C2C2C]">
              <div className="border-b border-black/5 px-3 py-2 text-[11px] text-black/40 dark:border-white/10 dark:text-white/40">
                @ 群成员（被 @ 的优先回复）
              </div>
              <div className="max-h-[220px] overflow-y-auto">
                {members.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-black/40">群内还没有成员</div>}
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`wx-group-at-${m.id}`}
                    onClick={() => insertMention(m)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left active:bg-black/5 dark:active:bg-white/5"
                  >
                    {m.avatar ? (
                      <img src={m.avatar} alt={m.name} className="h-7 w-7 rounded-[5px] object-cover" />
                    ) : (
                      <DefaultAvatar size={28} className="rounded-[5px]" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[14px]">{memberNameOf(m)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 长按菜单 */}
      {menu && menuRect && menuMsg && (
        <BubbleActionMenu pos={menuRect} items={menuItems} onSelect={onMenuSelect} onClose={() => { setMenu(null); setMenuRect(null); }} testPrefix="wx-group" />
      )}
    </div>
  );
}
