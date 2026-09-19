'use client';

/**
 * 微信群聊（宿主：微信 App；会话身份 sessionKey = `wx:group:<groupId>`）。
 *
 * 组成：
 * - WxGroupCreatePage  建群：多选微信好友 + 群名（默认按成员名生成）；
 * - WxGroupListPage    群列表（通讯录 › 群聊入口）；
 * - WxGroupChatPage    群聊页：气泡（发言者名+头像）/ @某成员优先回复 / 长按菜单（复制/引用/撤回/删除）/
 *                      流式气泡（当前发言角色）/ 多角色逐个顺序回复；
 *                      输入功能与单聊完全对齐（共用同一套组件）：文字/表情包/加号菜单/图片/相机/位置；
 *                      聊天背景按群独立（入口在聊天信息页，与单聊同款 ChatBgPage）；
 * - WxGroupInfoPage    群聊信息：成员管理（邀请/移出）、群名、群公告（独立编辑页）、群头像、聊天背景、
 *                      记忆与私聊互通开关（按群独立）、时间感知、置顶/免打扰、清空记录、退出群聊。
 *
 * AI 管线（多角色，每个角色独立组装 system，绝不共用）：
 * - 谁来回复按人设自判：用户发言后被 @ 成员必答，其余成员逐个自判（无话可说只回 [SKIP]，整条丢弃不落盘）；
 * - 每个角色的 system = 七要素人设 + 群聊规则（当前是群聊/参与者名单/只代表自己/禁复读）+
 *   该角色自己的记忆召回（memRecallBlock mode='group'：本群记忆 + 互通开启时的自己私聊记忆）+
 *   时间感知（按群开关）+ 世界书；机主与其他成员的历史消息一律映射为「发言者：内容」的 user 消息
 *   （图片→[图片]、位置→[位置] 地点名、表情包→[发送了表情：意思]，与单聊占位一致）；
 * - 配置识图模型后，群里发的图片先经识图模型描述，每个成员再结合图片按人设回复（与单聊同管线）；
 * - finalize：回复落盘（senderId 区分发言人）+ 未读 + memAfterAiTurn（roundScope 按群隔离，
 *   碎片带 source='group'/sourceGroupId/groupMembers 群来源标记）。
 * - 范围限定：群内不提供红包/转账等资金功能（加号面板保留入口，点击提示不支持）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  AtSign,
  BellOff,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Gift,
  Image as ImageIcon,
  MapPin,
  Minus,
  Pencil,
  Phone,
  Plus,
  Smile,
  Star,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import {
  BubbleActionMenu,
  computeBubbleMenuPos,
  useBubbleLongPress,
  type BubbleMenuItem,
} from '@/components/apps/bubble-menu';
import { DefaultAvatar } from '@/components/apps/default-avatar';
import { LocalToast, useLocalToast } from './page-toast';
import { displayNameOf, isFriendIn, type ContactRecord } from '@/lib/contacts';
import { buildNpcPromptExtra } from '@/lib/ios/npc-bond';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import {
  contactRealName,
  getChatBgImage,
  ownerRealName,
  removeChatBgImage,
  setChatBgImage,
} from '@/lib/ios/contacts-store';
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
  type GroupRpData,
  type GroupTrData,
  type WxGroupMsg,
} from '@/lib/ios/groups';
import type { Sticker } from '@/lib/ios/stickers';
import { wxChatFlags, type ChatFlags } from '@/lib/chat-flags';
import {
  ChatBgPage,
  ChatReplyCountPage,
  ChatToggle,
  chatBgLayerStyle,
  WX_CHAT_BG_DEFAULT,
  type ChatSettingsBg,
} from '@/components/apps/chat-settings';
import {
  ImageMsgBubble,
  LocBubble,
  LocViewLayer,
  LocationPickerPage,
  readImageFile,
  RpBubble,
  RpOpenLayer,
  StickerMsgBubble,
  TransferCompose,
  TrBubble,
  WxAvatar,
  WxNoticeRow,
  WxPayMethodSheet,
  WxStickerPanel,
  sanitizeAmount,
  wxCanPay,
  wxExecutePayment,
  wxMethodLabel,
  wxPatchBalance,
} from './wechat';
import { fmtMoney, wxLoadPayPwd, WxPayPwdGate, loadCards, loadFamilyCardsIn } from './wechat-wallet';
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
import { Input } from '@/components/ui/input';
import { getReplyCount, saveReplyCount, buildReplyCountPrompt, splitReplyRender, splitReplySegments } from '@/lib/reply-count';
import { getSentenceSend, hasPendingBatch, markPendingBatch, saveSentenceSend } from '@/lib/sentence-send';
import {
  actionVerb,
  buildActionRules,
  extractRichActionParts,
  mergeRichSegments,
  parseRichParts,
  prettifyRichText,
  type PendingCardInfo,
  type RichAction,
} from '@/lib/chat-rich';

// ---------------- 群红包/转账（纯本地模拟；按群 ID 隔离，与单聊互不相通） ----------------

/** 金额四舍五入到分 */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 机主发的红包/转账短 ID（AI 动作标记里引用；格式如 grp-x7k2） */
function nextGroupCid(prefix: 'rp' | 'tr'): string {
  return `grp-${prefix === 'rp' ? 'r' : 't'}-${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-3)}`;
}

/** 群红包状态标签（卡片副标题/详情页/AI 上下文共用）：待领取 → 部分领取 → 已抢完 / 已过期 */
function groupRpStateLabel(rp: GroupRpData): string {
  if (rp.expired) return '已过期';
  if (rp.claims.length >= rp.count) return '已抢完';
  if (rp.claims.length > 0) return `已领取 ${rp.claims.length}/${rp.count}`;
  return '待领取';
}

/** 群转账状态标签 */
function groupTrStateLabel(tr: GroupTrData): string {
  if (tr.received) return '已收款';
  if (tr.status === 'returned') return '已退回';
  if (tr.status === 'rejected') return '已拒收';
  return '待收款';
}

/** 拼手气随机拆一份：前 n-1 份在「剩余÷份数×2」内随机（保底 0.01，给后面每份留 0.01），最后一份拿剩余全部 */
function splitLuckyAmount(remaining: number, leftCount: number): number {
  if (leftCount <= 1) return round2(remaining);
  const max = Math.max(0.01, round2(remaining - 0.01 * (leftCount - 1)));
  const amt = round2((remaining * Math.random() * 2) / leftCount);
  return Math.min(max, Math.max(0.01, amt));
}

/** 群会话 id（未读/标志/隐藏/聊天背景等以字符串 id 为键的设施共用） */
export const groupRowId = (groupId: string) => `group:${groupId}`;
const sessionKeyOf = (groupId: string) => `wx:group:${groupId}`;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
                <DefaultAvatar size={size / 2.4} shape="square" className="rounded-[3px]" />
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
          className="-ml-1 flex items-center p-1 text-black/75 active:opacity-50 dark:text-white/75"
        >
          <ChevronLeft className="h-7 w-7" strokeWidth={2} />
        </button>
        <div className="flex-1 truncate text-center text-[17px] font-medium">{title}</div>
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
      className={`flex w-full items-center gap-3 px-4 py-[11px] text-left ${onClick ? 'active:bg-black/[0.04] dark:active:bg-white/[0.06]' : 'cursor-default'}`}
    >
      <span className={`shrink-0 text-[16px] ${danger ? 'text-[#FA5150]' : ''}`}>{label}</span>
      <span className="ml-auto flex min-w-0 max-w-[60%] items-center gap-1 text-[14px] text-black/40 dark:text-white/40">
        <span className="truncate">{value}</span>
        {onClick && <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />}
      </span>
    </button>
  );
}

/** 开关行：微信绿大号开关（与私聊设置页同一套 ChatToggle，30×50） */
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
    <div className="flex items-center gap-3 px-4 py-[11px]">
      <div className="min-w-0 flex-1">
        <div className="text-[16px]">{label}</div>
        {caption && <div className="mt-0.5 text-[12px] leading-snug text-black/40 dark:text-white/40">{caption}</div>}
      </div>
      <div className="shrink-0">
        <ChatToggle on={checked} onChange={onChange} accent="#07C160" testId={testId} label={label} />
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
                <WxAvatar src={c.avatar} alt={c.name} size={40} />
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
  onToast: onToastExternal,
}: {
  group: ChatGroup;
  contacts: ContactRecord[];
  onBack: () => void;
  onUpdate: (patch: Partial<Pick<ChatGroup, 'name' | 'avatar' | 'announcement' | 'memoryInterop' | 'memberIds'>>) => void;
  onDissolve: () => void;
  onToast: (m: string) => void;
}) {
  // 微信 App 主屏的根 toast 在群聊分支不渲染（提前 return）→ 群页自带页内 toast（与私聊页同方案）
  const [toastMsg, emitToast] = useLocalToast();
  const onToast = useCallback(
    (m: string) => {
      emitToast(m);
      onToastExternal(m);
    },
    [emitToast, onToastExternal]
  );
  const [dialog, setDialog] = useState<{ kind: 'name' } | null>(null);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [noticeDraft, setNoticeDraft] = useState('');
  const [memberSheet, setMemberSheet] = useState<ContactRecord | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDissolve, setConfirmDissolve] = useState(false);
  const [replyCountOpen, setReplyCountOpen] = useState(false);
  const [replyCount, setReplyCount] = useState(() => getReplyCount(sessionKeyOf(group.id)));
  const [sentenceOn, setSentenceOn] = useState(() => getSentenceSend(sessionKeyOf(group.id)));
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

  // ---- 聊天背景（按群独立：标志在 wxChatFlags 的 group:<gid> 键，图片本体在 IndexedDB；与单聊互不影响） ----
  const rowFlags = flags[groupRowId(gid)];
  const bgMode = rowFlags?.bgMode ?? 'default';
  const bgColor = rowFlags?.bgColor ?? '';
  const bg: ChatSettingsBg = { mode: bgMode, color: bgColor };
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [uploadingBg, setUploadingBg] = useState(false);

  useEffect(() => {
    let alive = true;
    if (bgMode === 'image') {
      void getChatBgImage('wx', `group:${gid}`).then((d) => {
        if (alive) setBgImageUrl(d);
      });
    }
    return () => {
      alive = false;
    };
  }, [bgMode, rowFlags?.bgV, gid]);

  const handlePickBgColor = (c: string) => {
    wxChatFlags.update(groupRowId(gid), { bgMode: 'color', bgColor: c, bgV: Date.now() });
  };
  const handleResetBg = () => {
    void removeChatBgImage('wx', `group:${gid}`).catch(() => undefined);
    wxChatFlags.update(groupRowId(gid), { bgMode: 'default', bgV: Date.now() });
  };
  const handleUploadBg = async (file: File) => {
    setUploadingBg(true);
    try {
      const data = await readImageFile(file, 1280);
      await setChatBgImage('wx', `group:${gid}`, data);
      wxChatFlags.update(groupRowId(gid), { bgMode: 'image', bgV: Date.now() });
      onToast('聊天背景已更新');
    } catch {
      onToast('图片处理失败，请重试');
    } finally {
      setUploadingBg(false);
    }
  };

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

  const saveNotice = () => {
    onUpdate({ announcement: noticeDraft.trim() });
    setAnnounceOpen(false);
    onToast('群公告已更新');
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

      {/* 成员格点（对照真微信：成员头像瓦片 + 虚线 ＋/－ 按钮；方形圆角头像与聊天页一致） */}
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
              <WxAvatar src={m.avatar} alt={m.name} size={44} />
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
          <span className="text-[16px]">群头像</span>
          <span className="ml-auto flex items-center gap-2">
            <GroupAvatar group={group} contacts={contacts} size={40} />
            <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
          </span>
        </button>
        <InfoRow
          label="群公告"
          value={group.announcement ? (group.announcement.length > 12 ? `${group.announcement.slice(0, 12)}…` : group.announcement) : '未设置'}
          onClick={() => {
            setNoticeDraft(group.announcement);
            setAnnounceOpen(true);
          }}
          testId="wx-groupinfo-notice"
        />
        <button
          type="button"
          data-testid="wx-groupinfo-bg"
          onClick={() => setBgOpen(true)}
          className="flex w-full items-center gap-3 px-4 py-[11px] text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
        >
          <span className="shrink-0 text-[16px]">聊天背景</span>
          <span className="ml-auto flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-[22px] w-[22px] rounded-[5px] border border-black/10 bg-cover bg-center dark:border-white/15"
              style={chatBgLayerStyle(bg, bgImageUrl) ?? { backgroundColor: WX_CHAT_BG_DEFAULT }}
            />
            <ChevronRight className="h-[18px] w-[18px] text-black/25 dark:text-white/25" strokeWidth={2} />
          </span>
        </button>
      </div>

      {/* 记忆互通（按群开关） */}
      <div className="mt-2 divide-y divide-black/5 bg-white dark:divide-white/10 dark:bg-[#1A1A1A]">
        <SwitchRow
          label="记忆与私聊互通"
          caption="开启后：群里发生的事，成员在私聊里也记得；成员的私聊记忆也会带进群聊。关闭则完全隔离（按群独立设置）。"
          checked={group.memoryInterop}
          onChange={(v) => {
            onUpdate({ memoryInterop: v });
            onToast(v ? '已开启互通' : '已关闭互通');
          }}
          testId="wx-groupinfo-interop"
        />
      </div>

      {/* 通用开关（回复条数/分句发送/时间感知/置顶/免打扰；均按群独立） */}
      <div className="mt-2 divide-y divide-black/5 bg-white dark:divide-white/10 dark:bg-[#1A1A1A]">
        <InfoRow
          label="回复条数"
          value={`${replyCount} 条`}
          onClick={() => setReplyCountOpen(true)}
          testId="wx-groupinfo-replycount"
        />
        <SwitchRow
          label="分句发送"
          caption="开启后：你连续发的多条消息成员都不回复，把想说的话发完、输入框为空时再点一次「发送」，成员才统一回复"
          checked={sentenceOn}
          onChange={(v) => {
            saveSentenceSend(sessionKeyOf(gid), v);
            setSentenceOn(v);
            if (!v) {
              markPendingBatch(sessionKeyOf(gid), false);
            }
          }}
          testId="wx-groupinfo-sentence"
        />
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
        className="mt-2 w-full bg-white py-[13px] text-center text-[16px] text-[#FA5150] active:bg-black/5 dark:bg-[#1A1A1A] dark:active:bg-white/5"
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
              <WxAvatar src={memberSheet.avatar} alt={memberSheet.name} size={40} />
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
                  <WxAvatar src={m.avatar} alt={m.name} size={40} />
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
                    <WxAvatar src={c.avatar} alt={c.name} size={40} />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{memberNameOf(c)}</span>
                    <UserPlus className="h-4 w-4 shrink-0 text-black/40 dark:text-white/40" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 群公告编辑页（独立整页：多行文本 + 字数 + 保存，替代原单行弹窗） */}
      {announceOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#EDEDED] dark:bg-[#111111]" data-testid="wx-group-notice-page">
          <div className="shrink-0 border-b border-black/5 bg-[#EDEDED]/95 pt-[54px] backdrop-blur dark:border-white/10 dark:bg-[#111111]/95">
            <div className="flex h-11 items-center px-2">
              <button
                type="button"
                aria-label="返回"
                data-testid="wx-group-notice-back"
                onClick={() => setAnnounceOpen(false)}
                className="flex items-center px-1 active:opacity-50"
              >
                <ChevronLeft className="h-7 w-7" strokeWidth={2} />
              </button>
              <div className="flex-1 text-center text-[17px] font-medium">群公告</div>
              <button
                type="button"
                data-testid="wx-group-notice-save"
                onClick={saveNotice}
                className="px-2 text-[15px] font-medium text-[#07C160] active:opacity-60"
              >
                保存
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 px-3 pt-3">
            <div className="rounded-[10px] bg-white p-3.5 dark:bg-[#1A1A1A]">
              <textarea
                data-testid="wx-group-notice-input"
                value={noticeDraft}
                maxLength={300}
                onChange={(e) => setNoticeDraft(e.target.value)}
                rows={9}
                placeholder="写入群公告：置顶须知、群规、本周安排…成员会在群聊语境里看到（AI 回复时也会参考）"
                className="w-full resize-none bg-transparent text-[15.5px] leading-[1.7] outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
              />
            </div>
            <p className="px-1 pt-2 text-right text-[12px] text-black/35 dark:text-white/35">{noticeDraft.length}/300</p>
            <p className="px-1 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40">
              群公告会注入每个成员的聊天语境，让群聊更有真实感；清空内容并保存即可删除公告。
            </p>
          </div>
        </div>
      )}

      {/* 聊天背景页（与单聊同一套 ChatBgPage；按群隔离持久化） */}
      {bgOpen && (
        <div className="fixed inset-0 z-50">
          <ChatBgPage
            variant="wx"
            bg={bg}
            bgImageUrl={bgImageUrl}
            uploading={uploadingBg}
            onBack={() => setBgOpen(false)}
            onPickColor={handlePickBgColor}
            onPickImageFile={(f) => void handleUploadBg(f)}
            onResetBg={handleResetBg}
          />
        </div>
      )}

      {/* 回复条数页（聊天信息二级页；按群独立，与单聊互不影响） */}
      {replyCountOpen && (
        <div className="fixed inset-0 z-50">
          <ChatReplyCountPage
            variant="wx"
            value={replyCount}
            onBack={() => setReplyCountOpen(false)}
            onSelect={(n) => {
              saveReplyCount(sessionKeyOf(gid), n);
              setReplyCount(n);
              setReplyCountOpen(false);
              onToast(`回复条数已设为 ${n} 条`);
            }}
          />
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
      {/* 页内 toast（微信根 toast 在群聊分支不渲染） */}
      <LocalToast msg={toastMsg} />
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

/** 群加号面板动作（与单聊加号面板同一组入口；红包/转账按群范围限定仅入口） */
type GroupPlusAction = 'camera' | 'image' | 'voicecall' | 'videocall' | 'redpacket' | 'transfer' | 'location' | 'favorite';

/** 群加号面板（与单聊 PlusPanel 同款布局与图标，共用同一套视觉；群聊不含资金功能） */
function WxGroupPlusPanel({ onAction }: { onAction: (a: GroupPlusAction) => void }) {
  const items: Array<{ key: GroupPlusAction; label: string; icon: React.ReactNode }> = [
    { key: 'camera', label: '相机', icon: <Camera className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { key: 'image', label: '图片', icon: <ImageIcon className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { key: 'voicecall', label: '语音通话', icon: <Phone className="h-[25px] w-[25px]" strokeWidth={1.6} /> },
    { key: 'videocall', label: '视频通话', icon: <Video className="h-[25px] w-[25px]" strokeWidth={1.6} /> },
    { key: 'redpacket', label: '红包', icon: <Gift className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { key: 'transfer', label: '转账', icon: <ArrowLeftRight className="h-[25px] w-[25px]" strokeWidth={1.6} /> },
    { key: 'location', label: '位置', icon: <MapPin className="h-[26px] w-[26px]" strokeWidth={1.6} /> },
    { key: 'favorite', label: '收藏', icon: <Star className="h-[25px] w-[25px]" strokeWidth={1.6} /> },
  ];
  return (
    <div
      className="shrink-0 border-t border-black/[0.05] bg-[#F7F7F7] px-2 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 dark:border-white/[0.06] dark:bg-[#161616]"
      data-testid="wx-group-plus-panel"
    >
      <div className="grid grid-cols-4">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            data-testid={`wx-group-plus-${it.key}`}
            onClick={() => onAction(it.key)}
            className="flex flex-col items-center gap-[7px] py-2 active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          >
            <span className="flex h-[57px] w-[57px] items-center justify-center rounded-[14px] bg-white text-black/70 shadow-[0_1px_5px_rgba(0,0,0,0.05)] dark:bg-[#242428] dark:text-white/75">
              {it.icon}
            </span>
            <span className="text-[12px] text-black/60 dark:text-white/60">{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- 群红包/转账页面组件（微信风格；纯本地模拟） ----------------

/** 完整时间：2026年9月19日 20:32:08（群红包/转账详情页领取时间用） */
function fmtGrpFullTime(ts: number): string {
  const d = new Date(ts);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** 群红包总额：普通 = 单个金额×个数；拼手气 = 总金额；专属 = 单个金额 */
export function groupRpTotal(mode: GroupRpData['mode'], amount: number, count: number): number {
  return mode === 'normal' ? round2(amount * count) : round2(amount);
}

/**
 * 群发红包页（微信风格；与单聊发红包页同一套视觉，字段按群场景扩展）：
 * 普通（单个金额×个数）/ 拼手气（总金额+个数）/ 专属（单个金额 + 指定群成员领取）+ 祝福语 + 支付方式。
 * 支付方式 sheet 与单聊共用 WxPayMethodSheet。
 */
function GroupRpCompose({
  members,
  meBalanceLabel,
  onBack,
  onSubmit,
  onToast,
}: {
  members: ContactRecord[];
  meBalanceLabel: string;
  onBack: () => void;
  onSubmit: (p: { mode: GroupRpData['mode']; amount: number; count: number; blessing: string; target: ContactRecord | null }, methodId: string) => void;
  onToast: (m: string) => void;
}) {
  const [tab, setTab] = useState<GroupRpData['mode']>('normal');
  const [val, setVal] = useState('');
  const [count, setCount] = useState('1');
  const [blessing, setBlessing] = useState('');
  const [methodId, setMethodId] = useState('balance');
  const [methodOpen, setMethodOpen] = useState(false);
  const [target, setTarget] = useState<ContactRecord | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const num = parseFloat(val || '0');
  const cnt = Math.min(100, Math.max(1, Math.round(parseFloat(count) || 1)));
  const ok = num >= 0.01 && (tab !== 'exclusive' || target != null);
  const total = groupRpTotal(tab, num, cnt);
  const submit = () => {
    if (!ok) {
      onToast('请输入金额');
      return;
    }
    if (total > 2000) {
      onToast('红包总额不可超过 2000 元');
      return;
    }
    onSubmit({ mode: tab, amount: num, count: tab === 'lucky' ? cnt : tab === 'normal' ? cnt : 1, blessing: blessing.trim() || '恭喜发财，大吉大利', target }, methodId);
  };
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-grp-rp-compose">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-grp-rp-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">发红包</div>
        </div>
      </div>
      {/* tab 行 */}
      <div className="flex shrink-0 items-center gap-7 bg-[#EDEDED] px-5 pt-1 dark:bg-[#111111]">
        {([['normal', '普通红包'], ['lucky', '拼手气红包'], ['exclusive', '专属红包']] as const).map(([t, label]) => (
          <button key={t} type="button" data-testid={`wx-grp-rp-tab-${t}`} onClick={() => setTab(t)} className="relative pb-2.5">
            <span className={`text-[15px] ${tab === t ? 'font-medium text-black dark:text-white' : 'text-black/45 dark:text-white/45'}`}>{label}</span>
            {tab === t ? <span className="absolute inset-x-1.5 bottom-0 h-[3px] rounded-full bg-[#F04A3A]" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
        <div className="flex items-center justify-between rounded-[10px] bg-white px-4 py-[13px] dark:bg-[#1A1A1A]">
          <span className="text-[16px]">{tab === 'lucky' ? '总金额' : '单个金额'}</span>
          <span className="flex items-center gap-1 text-[15px]">
            <span className="text-black/50 dark:text-white/50">¥</span>
            <input
              value={val}
              inputMode="decimal"
              onChange={(e) => setVal(sanitizeAmount(e.target.value))}
              placeholder="0.00"
              aria-label="红包金额"
              data-testid="wx-grp-rp-amount"
              className="w-[96px] bg-transparent text-right text-[15px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
            />
          </span>
        </div>
        {tab !== 'exclusive' ? (
          <div className="mt-3 flex items-center justify-between rounded-[10px] bg-white px-4 py-[13px] dark:bg-[#1A1A1A]">
            <span className="text-[16px]">红包个数</span>
            <span className="flex items-center gap-2">
              <input
                value={count}
                inputMode="numeric"
                onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
                aria-label="红包个数"
                data-testid="wx-grp-rp-count"
                className="w-[72px] bg-transparent text-right text-[15px] outline-none"
              />
              <span className="text-[15px] text-black/50 dark:text-white/50">个</span>
            </span>
          </div>
        ) : (
          <button
            type="button"
            data-testid="wx-grp-rp-target"
            onClick={() => setPickOpen(true)}
            className="mt-3 flex w-full items-center justify-between rounded-[10px] bg-white px-4 py-[13px] text-left active:bg-black/[0.03] dark:bg-[#1A1A1A] dark:active:bg-white/[0.06]"
          >
            <span className="text-[16px]">指定成员</span>
            <span className="ml-auto flex items-center gap-2">
              {target ? (
                <>
                  <WxAvatar src={target.avatar} alt={memberNameOf(target)} size={26} />
                  <span className="text-[15px]">{memberNameOf(target)}</span>
                </>
              ) : (
                <span className="text-[14px] text-black/35 dark:text-white/35">选择群成员</span>
              )}
              <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
            </span>
          </button>
        )}
        <div className="mt-3 flex items-center gap-2 rounded-[10px] bg-white px-4 py-[14px] dark:bg-[#1A1A1A]">
          <input
            value={blessing}
            onChange={(e) => setBlessing(e.target.value.slice(0, 25))}
            placeholder="恭喜发财，大吉大利"
            data-testid="wx-grp-rp-blessing"
            className="h-8 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
          />
        </div>
        {/* 支付方式（与单聊共用同一套 sheet） */}
        <div className="mt-3 overflow-hidden rounded-[10px] bg-white dark:bg-[#1A1A1A]">
          <button
            type="button"
            data-testid="wx-grp-rp-method"
            onClick={() => setMethodOpen(true)}
            className="flex w-full items-center px-4 py-[14px] text-left active:bg-black/[0.03] dark:active:bg-white/[0.06]"
          >
            <span className="flex-1 text-[16px]">支付方式</span>
            <span className="mr-1 max-w-[58%] truncate text-[14px] text-black/45 dark:text-white/45">{meBalanceLabel}</span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
          </button>
        </div>

        <div className="mt-10 text-center">
          <p className="font-semibold" data-testid="wx-grp-rp-big">
            <span className="text-[28px]">¥</span>
            <span className="ml-2 text-[48px] leading-none">{val || '0.00'}</span>
            {tab === 'normal' && cnt > 1 ? <span className="ml-2 text-[15px] font-normal text-black/45 dark:text-white/45">× {cnt} 个</span> : null}
          </p>
          <button
            type="button"
            data-testid="wx-grp-rp-send"
            onClick={submit}
            className={`mt-8 h-[46px] w-[230px] rounded-[8px] text-[17px] font-medium text-white active:brightness-95 ${
              ok ? 'bg-[#F04A3A]' : 'bg-[#F04A3A]/45'
            }`}
          >
            塞钱进红包
          </button>
        </div>
      </div>
      <p className="shrink-0 pb-6 pt-4 text-center text-[12px] text-black/35 dark:text-white/35">未领取的红包，将于24小时后发起退款（群成员按人设领取）</p>
      {methodOpen ? (
        <WxPayMethodSheet
          cards={loadCards()}
          familyIn={loadFamilyCardsIn()}
          selectedId={methodId}
          onClose={() => setMethodOpen(false)}
          onPick={(id) => {
            setMethodId(id);
            setMethodOpen(false);
          }}
        />
      ) : null}
      {pickOpen ? (
        <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" onClick={() => setPickOpen(false)} data-testid="wx-grp-rp-target-sheet">
          <div className="max-h-[62%] overflow-hidden rounded-t-[14px] bg-white pb-4 dark:bg-[#2C2C2C]" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 pb-1 pt-4 text-[15px] font-medium">选择指定成员（只有 TA 能领这个红包）</div>
            <div className="max-h-[52vh] overflow-y-auto">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`wx-grp-rp-target-${m.id}`}
                  onClick={() => {
                    setTarget(m);
                    setPickOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/5 dark:active:bg-white/5"
                >
                  <WxAvatar src={m.avatar} alt={memberNameOf(m)} size={38} />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{memberNameOf(m)}</span>
                  {target?.id === m.id ? <Check className="h-5 w-5 shrink-0 text-[#07C160]" aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 群转账选人页：先从群成员里选一个收款人，再进与单聊同款的 TransferCompose（共用同一套组件） */
function GroupTrPickPage({
  members,
  groupName,
  onBack,
  onPick,
}: {
  members: ContactRecord[];
  groupName: string;
  onBack: () => void;
  onPick: (c: ContactRecord) => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-grp-tr-pick">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-grp-tr-pick-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">选择收款成员</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        <p className="px-4 pb-2 pt-3 text-[12.5px] text-black/40 dark:text-white/40">转账给「{groupName}」中的一位成员，只有 TA 能收款</p>
        <div className="bg-white dark:bg-[#1A1A1A]">
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              data-testid={`wx-grp-tr-pick-${m.id}`}
              onClick={() => onPick(m)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/5 dark:active:bg-white/5"
            >
              <WxAvatar src={m.avatar} alt={memberNameOf(m)} size={40} />
              <span className="min-w-0 flex-1 truncate text-[15px]">{memberNameOf(m)}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 群红包详情页（红色弧形头 + 领取列表；普通/拼手气/专属/过期共用；与单聊详情页同一套视觉） */
function GroupRpDetailPage({
  senderName,
  senderAvatar,
  blessing,
  rp,
  onBack,
  onToast,
}: {
  senderName: string;
  senderAvatar: string | null;
  blessing: string;
  rp: GroupRpData;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  const claimedSum = round2(rp.claims.reduce((s, c) => s + c.amount, 0));
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white text-black dark:bg-[#111111] dark:text-white" data-testid="wx-grp-rp-detail">
      <div className="relative shrink-0 bg-[#F25844] pt-[54px]">
        <div className="relative flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-grp-rp-detail-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-7 w-7 text-[#F6CE93]" strokeWidth={2.2} />
          </button>
          <button type="button" aria-label="更多" onClick={() => onToast('更多暂未开放')} className="ml-auto px-2 active:opacity-60">
            <span className="flex items-center gap-[3px]" aria-hidden="true">
              <span className="h-[4px] w-[4px] rounded-full bg-[#F6CE93]" />
              <span className="h-[4px] w-[4px] rounded-full bg-[#F6CE93]" />
              <span className="h-[4px] w-[4px] rounded-full bg-[#F6CE93]" />
            </span>
          </button>
        </div>
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-full h-[30px] w-[140%] -translate-x-1/2 rounded-[50%] bg-white dark:bg-[#111111]"
          style={{ boxShadow: '0 -3px 0 #E9C880' }}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto pt-[8vh]">
        <div className="flex items-center gap-2.5">
          <WxAvatar src={senderAvatar} alt={senderName} size={36} />
          <span className="text-[20px] font-medium" data-testid="wx-grp-rp-detail-title">
            {senderName}的红包
          </span>
        </div>
        <p className="mt-2.5 text-[15px] text-black/40 dark:text-white/40">{blessing}</p>
        <p className="mt-2 text-[13px] text-[#D8A244]" data-testid="wx-grp-rp-detail-status">
          {rp.mode === 'exclusive' && rp.targetName ? `专属红包 · 只给${rp.targetName} · ` : ''}
          {groupRpStateLabel(rp)}
        </p>
        <p className="mt-8 font-semibold text-[#D8A244]" data-testid="wx-grp-rp-detail-amount">
          <span className="text-[46px] leading-none">{fmtMoney(rp.mode === 'lucky' ? rp.amount : groupRpTotal(rp.mode, rp.amount, rp.count))}</span>
          <span className="ml-1.5 text-[20px]">元</span>
        </p>

        {/* 领取详情（谁领取了、领了多少；群里所有成员的领取记录） */}
        <div className="mt-9 w-[87%] max-w-[350px]" data-testid="wx-grp-rp-claim">
          <p className="text-[12px] text-black/35 dark:text-white/35" data-testid="wx-grp-rp-claim-caption">
            {rp.count}个红包共{fmtMoney(groupRpTotal(rp.mode, rp.amount, rp.count))}元，已领取{rp.claims.length}/{rp.count}
            {rp.expired ? `，已退回${fmtMoney(round2(groupRpTotal(rp.mode, rp.amount, rp.count) - claimedSum))}元` : ''}
          </p>
          {rp.claims.length > 0 ? (
            <div className="mt-1.5">
              {rp.claims.map((c, i) => (
                <div key={`${c.contactId}-${i}`} className="flex items-center gap-3 border-t border-black/[0.06] py-3.5 first:border-t-0 dark:border-white/[0.08]">
                  <WxAvatar src={c.avatar} alt={c.name} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">{c.name}</span>
                    <span className="mt-0.5 block text-[11px] text-black/35 dark:text-white/35">{fmtGrpFullTime(c.ts || Date.now())}</span>
                  </span>
                  <span className="shrink-0 text-[15px] font-medium text-[#D8A244]">¥{fmtMoney(c.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-7 text-center text-[13px] text-black/30 dark:text-white/30">
              {rp.expired ? '红包已过期，未领取金额已退回' : '等待领取…'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** 群转账详情页（转账给群里某位成员；收款/退回/拒收状态 + 时间行；与单聊详情页同一套视觉语言） */
function GroupTrDetailPage({
  tr,
  fromName,
  onBack,
}: {
  tr: GroupTrData;
  fromName: string;
  onBack: () => void;
}) {
  const status = groupTrStateLabel(tr);
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-grp-tr-detail">
      <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="wx-grp-tr-detail-back" onClick={onBack} className="active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <div className="flex-1 pr-8 text-center text-[17px] font-medium">转账详情</div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pt-10">
        <div className="w-full max-w-[380px] rounded-[10px] bg-white px-5 py-6 dark:bg-[#1A1A1A]" data-testid="wx-grp-tr-detail-card">
          <div className="flex items-center gap-3.5">
            <span
              className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full"
              style={{ background: 'linear-gradient(135deg, #F6AC3D, #EF9A2E)' }}
              aria-hidden="true"
            >
              <ArrowLeftRight className="h-6 w-6 text-white" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[26px] font-semibold leading-tight" data-testid="wx-grp-tr-detail-amount">¥{fmtMoney(tr.amount)}</p>
              <p className="mt-0.5 truncate text-[13px] text-black/45 dark:text-white/45" data-testid="wx-grp-tr-detail-status">
                {tr.received ? `${tr.toName}已收款` : status === '已退回' ? '已退回' : status === '已拒收' ? '已拒收' : `待${tr.toName}收款`}
              </p>
            </div>
          </div>
          {tr.note ? <p className="mt-4 border-t border-black/[0.06] pt-3 text-[14px] text-black/70 dark:border-white/[0.08] dark:text-white/70">留言：{tr.note}</p> : null}
          <div className="mt-4 space-y-2.5 border-t border-black/[0.06] pt-3 text-[13px] dark:border-white/[0.08]">
            <p className="flex justify-between">
              <span className="text-black/40 dark:text-white/40">转账人</span>
              <span>{fromName}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-black/40 dark:text-white/40">收款成员</span>
              <span data-testid="wx-grp-tr-detail-to">{tr.toName}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-black/40 dark:text-white/40">状态</span>
              <span>{status}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-black/40 dark:text-white/40">当前状态说明</span>
              <span className="text-black/55 dark:text-white/55">群聊转账 · 只有被选中的成员能收款</span>
            </p>
          </div>
        </div>
        <p className="pt-6 text-center text-[12px] text-black/35 dark:text-white/35">群里其他成员只看到转账卡片，无法操作这笔转账</p>
      </div>
    </div>
  );
}

export function WxGroupChatPage({
  group,
  me,
  contacts,
  ownerLabelOf,
  onBack,
  onUpdate,
  onOpenInfo,
  onDissolve,
  onToast: onToastExternal,
}: {
  group: ChatGroup;
  me: { id: string; name: string; avatar: string | null };
  contacts: ContactRecord[];
  /** NPC 归属者名解析（人设 prompt 用） */
  ownerLabelOf: (peer: ContactRecord) => string | null;
  onBack: () => void;
  onUpdate: (patch: Partial<Pick<ChatGroup, 'name' | 'memberIds' | 'memoryInterop'>>) => void;
  onOpenInfo: () => void;
  onDissolve: () => void;
  onToast: (m: string) => void;
}) {
  // 微信 App 主屏的根 toast 在群聊分支不渲染（提前 return）→ 群页自带页内 toast（与私聊页同方案）
  const [toastMsg, emitToast] = useLocalToast();
  const onToast = useCallback(
    (m: string) => {
      emitToast(m);
      onToastExternal(m);
    },
    [emitToast, onToastExternal]
  );
  const gid = group.id;
  const sKey = sessionKeyOf(gid);
  const [msgs, setMsgs] = useState<WxGroupMsg[]>(() => loadGroupMsgs(gid));
  const [draft, setDraft] = useState('');
  const [quote, setQuote] = useState<{ name: string; content: string } | null>(null);
  const [atOpen, setAtOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [compose, setCompose] = useState<'location' | null>(null);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const [locView, setLocView] = useState<{ name: string; address: string } | null>(null);
  // 群红包/转账浮层流程：发红包页 / 转账选人页→转账页 / 红包开箱 / 红包详情 / 转账详情
  const [layer, setLayer] = useState<
    | null
    | { view: 'rp-compose' }
    | { view: 'tr-pick' }
    | { view: 'tr-compose'; member: ContactRecord }
    | { view: 'rp-open'; msgId: string }
    | { view: 'rp-detail'; msgId: string }
    | { view: 'tr-detail'; msgId: string }
  >(null);
  // 转账页提交后待验证的支付（开启支付密码时先弹自绘键盘，与单聊同规则）
  const [gate, setGate] = useState<null | { kind: 'redpacket' | 'transfer'; amount: number; methodId: string; rp?: { mode: GroupRpData['mode']; amount: number; count: number; blessing: string; target: ContactRecord | null }; tr?: { member: ContactRecord; note: string } }>(null);
  // 分句发送（按群独立；开启后连发消息不触发回复，空输入点「发送」统一触发）
  const [sentenceSend, setSentenceSend] = useState(() => getSentenceSend(sKey));
  const [pendingDispatch, setPendingDispatch] = useState(() => hasPendingBatch(sKey));
  const [speakerId, setSpeakerId] = useState<string | null>(() => groupSpeaker.get(sKey) ?? null);
  const stream = useChatStream(sKey);
  const apiConfig = useSettings((s) => s.apiConfig);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const groupRef = useRef(group);
  groupRef.current = group;

  // 长按菜单
  const [menu, setMenu] = useState<null | { mid: string }>(null);
  // 免打扰角标（标题旁 BellOff，与私聊一致）+ 聊天背景（按群独立，wxChatFlags 的 group:<gid> 键）
  const [flags, setFlags] = useState<ChatFlags>(() => wxChatFlags.get());
  useEffect(() => wxChatFlags.subscribe(() => setFlags({ ...wxChatFlags.get() })), []);
  const rowFlags = flags[groupRowId(gid)];
  const bgMode = rowFlags?.bgMode ?? 'default';
  const bg: ChatSettingsBg = { mode: bgMode, color: rowFlags?.bgColor ?? '' };
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (bgMode === 'image') {
      void getChatBgImage('wx', `group:${gid}`).then((d) => {
        if (alive) setBgImageUrl(d);
      });
    }
    return () => {
      alive = false;
    };
  }, [bgMode, rowFlags?.bgV, gid]);

  const members = useMemo(
    () =>
      groupRef.current.memberIds
        .map((id) => contacts.find((c) => c.id === id))
        .filter((c): c is ContactRecord => !!c),
    [contacts, group.memberIds]
  );
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  /** 就地更新一条群消息的附加数据（红包/转账状态流转用）：读改写存储 + 页面存活时同步 state */
  const patchGroupMsg = useCallback(
    (mid: string, patch: Partial<Pick<WxGroupMsg, 'rp' | 'tr' | 'recalled' | 'content'>>) => {
      const next = loadGroupMsgs(gid).map((m) => (m.id === mid ? { ...m, ...patch } : m));
      saveGroupMsgs(gid, next);
      if (mountedRef.current) setMsgs(next);
    },
    [gid]
  );

  /** 追加一条带图标的资金通知行（xx领取了你的红包 / 收下了你的转账；定义在 appendMsg 之后，见下方） */
  /** 收集该成员当前可处理的群红包/转账（生成 system 待处理清单）：
   *  红包：不是自己发的、未过期、还有剩余份、自己没领过、（专属 → 只给被指定成员）；
   *  转账：只有被指定的收款成员能处理 */
  const collectGroupPending = useCallback(
    (charId: string): PendingCardInfo[] => {
      const out: PendingCardInfo[] = [];
      for (const m of loadGroupMsgs(gid)) {
        if (m.recalled) continue;
        if (m.kind === 'redpacket' && m.rp && m.senderId !== charId) {
          const rp = m.rp;
          if (rp.expired || rp.claims.length >= rp.count) continue;
          if (rp.claims.some((c) => c.contactId === charId)) continue;
          if (rp.mode === 'exclusive' && rp.targetId !== charId) continue;
          const bits = [
            `祝福语"${rp.blessing}"`,
            rp.count > 1 ? `共${rp.count}份剩${rp.count - rp.claims.length}份` : '',
            rp.mode === 'exclusive' ? '专属发给你一个人的' : rp.mode === 'lucky' ? '拼手气' : '',
            m.senderId === 'me' ? '来自机主' : `来自${m.senderName}`,
          ].filter(Boolean);
          out.push({ id: rp.cid ?? m.id, kind: 'redpacket', amount: rp.count > 1 && rp.mode === 'normal' ? round2(rp.amount) : rp.amount, label: bits.join('，') });
        } else if (m.kind === 'transfer' && m.tr && m.role === 'me' && m.tr.toId === charId && !m.tr.received && !m.tr.status) {
          const tr = m.tr;
          out.push({ id: tr.cid ?? m.id, kind: 'transfer', amount: tr.amount, label: tr.note ? `备注"${tr.note}"，机主转给你的` : '机主转给你的' });
        }
      }
      return out;
    },
    [gid]
  );

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

  /** 过期清算：发出超 24h 仍有剩余的红包 → 标记已过期（终态），剩余金额退回发起人（机主发起 → 退回零钱+写账单） */
  const expireStalePackets = useCallback(() => {
    const now = Date.now();
    for (const m of loadGroupMsgs(gid)) {
      if (m.kind !== 'redpacket' || !m.rp) continue;
      const rp = m.rp;
      if (rp.expired || rp.claims.length >= rp.count) continue;
      if (now - rp.sentAt < 24 * 3600_000) continue;
      const remaining = round2(groupRpTotal(rp.mode, rp.amount, rp.count) - rp.claims.reduce((s, c) => s + c.amount, 0));
      patchGroupMsg(m.id, { rp: { ...rp, expired: true, expiredAt: now } });
      if (m.senderId === 'me' && remaining > 0) {
        wxPatchBalance(remaining, { kind: '红包', amount: remaining });
      }
      appendMsg({
        id: uid(),
        role: 'me',
        senderId: 'me',
        senderName: '',
        content: '',
        time: now,
        kind: 'notice',
        noticeText: `${m.senderId === 'me' ? '你' : m.senderName || '有人'}的红包已过期${remaining > 0 ? `，${fmtMoney(remaining)}元已退回` : ''}`,
      });
    }
  }, [appendMsg, gid, patchGroupMsg]);

  useEffect(() => {
    expireStalePackets();
  }, [expireStalePackets]);

  /** 追加一条带图标的资金通知行（xx领取了你的红包 / 收下了你的转账） */
  const appendFundNotice = useCallback(
    (icon: 'rp' | 'tr', pre: string, accent: string) => {
      appendMsg({ id: uid(), role: 'me', senderId: 'me', senderName: '', content: '', time: Date.now(), kind: 'notice', notice: { icon, pre, accent } });
    },
    [appendMsg]
  );

  /** 应用成员对群红包/转账的处理动作（领取/收款/退回/拒收；幂等，状态流转后不可重复处理）：
   *  红包领取：每份金额按类型计算（普通=单个金额/拼手气=随机拆一份/专属=单个金额），写入领取记录（剩余份数减少）；
   *  转账：收款 → 状态已收款；退回 → 原路退回零钱（写账单）；拒收 → 终态。 */
  const applyGroupAiAction = useCallback(
    (char: ContactRecord, action: RichAction) => {
      const verb = actionVerb(action.kind);
      const all = loadGroupMsgs(gid);
      const m = all.find(
        (x) =>
          !x.recalled &&
          ((x.kind === 'redpacket' && x.rp && (x.rp.cid === action.targetId || x.id === action.targetId)) ||
            (x.kind === 'transfer' && x.tr && (x.tr.cid === action.targetId || x.id === action.targetId)))
      );
      if (!m) return;
      const charName = memberNameOf(char);
      if (m.kind === 'redpacket' && m.rp) {
        const rp = m.rp;
        if (verb !== 'claim') return; // 群红包没有退回/拒收语义（未领完 24h 自动过期退回）
        if (rp.expired || rp.claims.length >= rp.count || rp.claims.some((c) => c.contactId === char.id)) return;
        if (rp.mode === 'exclusive' && rp.targetId !== char.id) return;
        const remaining = round2(groupRpTotal(rp.mode, rp.amount, rp.count) - rp.claims.reduce((s, c) => s + c.amount, 0));
        const left = rp.count - rp.claims.length;
        const amt = rp.mode === 'lucky' && left > 1 ? splitLuckyAmount(remaining, left) : remaining;
        patchGroupMsg(m.id, { rp: { ...rp, claims: [...rp.claims, { contactId: char.id, name: charName, avatar: char.avatar, amount: amt, ts: Date.now() }] } });
        appendFundNotice('rp', `${charName}领取了${m.senderId === 'me' ? '你' : m.senderName || '群友'}的`, rp.mode === 'exclusive' ? '专属红包' : '红包');
        return;
      }
      if (m.kind === 'transfer' && m.tr) {
        const tr = m.tr;
        if (tr.toId !== char.id) return; // 只有被选中的收款成员能处理
        if (tr.received || tr.status) return;
        if (verb === 'claim') {
          patchGroupMsg(m.id, { tr: { ...tr, received: true, receivedAt: Date.now() } });
          appendFundNotice('tr', `${charName}收下了你发的`, '转账');
        } else if (verb === 'return') {
          patchGroupMsg(m.id, { tr: { ...tr, status: 'returned' } });
          wxPatchBalance(tr.amount, { kind: '转账', amount: tr.amount });
          appendFundNotice('tr', `${charName}退回了你的`, '转账');
        } else {
          patchGroupMsg(m.id, { tr: { ...tr, status: 'rejected' } });
          appendFundNotice('tr', `${charName}拒收了你的`, '转账');
        }
      }
    },
    [appendFundNotice, gid, patchGroupMsg]
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

  /** 消息进入 AI 上下文的文本快照（图片/位置/表情包/红包/转账有占位描述，与单聊一致） */
  const msgTextOf = (m: WxGroupMsg): string => {
    if (m.kind === 'image') return '[图片]';
    if (m.kind === 'sticker' && m.stk) {
      return m.role === 'me'
        ? `[发送了表情：${m.stk.meaning || '无描述'}]`
        : `[表情]${m.stk.meaning ? ` ${m.stk.meaning}` : ''}`;
    }
    if (m.kind === 'location' && m.loc) return `[位置] ${m.loc.name}${m.loc.address ? ` ${m.loc.address}` : ''}`;
    if (m.kind === 'redpacket' && m.rp) {
      const rp = m.rp;
      return `[红包 ID:${rp.cid ?? m.id} ¥${rp.amount}${rp.count > 1 ? `x${rp.count}` : ''} "${rp.blessing}"，${groupRpStateLabel(rp)}]`;
    }
    if (m.kind === 'transfer' && m.tr) {
      const tr = m.tr;
      return `[转账 ID:${tr.cid ?? m.id} ¥${tr.amount}${tr.note ? ` "${tr.note}"` : ''}，发给${tr.toName}，${groupTrStateLabel(tr)}]`;
    }
    return m.content;
  };

  /** 消息的可复制文本快照（长按菜单复制用） */
  const msgSnapshotOf = (m: WxGroupMsg): string =>
    m.kind === 'image'
      ? '[图片]'
      : m.kind === 'sticker' && m.stk
        ? m.stk.meaning
          ? `[表情] ${m.stk.meaning}`
          : '[表情]'
        : m.kind === 'location' && m.loc
          ? `[位置] ${m.loc.name}${m.loc.address ? ` ${m.loc.address}` : ''}`
          : m.kind === 'redpacket' && m.rp
            ? `[红包] ¥${m.rp.amount} ${m.rp.blessing}`
            : m.kind === 'transfer' && m.tr
              ? `[转账] ¥${m.tr.amount}${m.tr.note ? ` ${m.tr.note}` : ''}`
              : m.content;

  /** 单个角色的一个回复回合：组装独立 system → 流式 → finalize 落盘/记忆。
   *  allowSkip=false 的角色（被 @ 成员）必答；其余成员按人设自判（[SKIP] 整条丢弃不落盘）。 */
  const runCharTurn = useCallback(
    (char: ContactRecord, allowSkip: boolean, turnImages: string[]) =>
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
        // 上下文映射：自己 → assistant；机主/其他成员 → 「发言者：内容」user 消息（富媒体按占位文本）
        const history: ChatPayloadMessage[] = ctxMsgs.map((m): ChatPayloadMessage => {
          if (m.role === 'me') {
            const content = `${m.quote ? `（引用 ${m.quote.name}：「${m.quote.content}」）` : ''}${msgTextOf(m)}`;
            return { role: 'user', content: `${meName}：${content}` };
          }
          if (m.senderId === char.id) return { role: 'assistant', content: msgTextOf(m) };
          return { role: 'user', content: `${m.senderName || '成员'}：${msgTextOf(m)}` };
        });
        const lastUserText = [...ctxMsgs].reverse().find((m) => m.role === 'me')?.content ?? '';
        const memContext = [lastUserText, ...ctxMsgs.slice(-6).map(msgTextOf)].filter(Boolean).join(' ');

        // 群聊规则（每个角色独立声明：当前是群聊、参与者有谁、只代表自己、禁复读、可互相对话）
        const others = g.memberIds
          .map((id) => contactsRef.current.find((c) => c.id === id))
          .filter((c): c is ContactRecord => !!c)
          .filter((c) => c.id !== char.id);
        const groupRules = [
          `【群聊模式】当前是群聊「${g.name}」，不是一对一私聊。参与成员：${meName}（机主用户）${
            others.length ? '、' + others.map(memberNameOf).join('、') : ''
          }。你以「${charName}」的身份参与其中。`,
          '聊天记录里每条消息都以「发言者：内容」标注来源；以自己名字开头的是你自己说过的话。「[图片]」「[位置] …」「[发送了表情：…]」「[红包 …]」「[转账 …]」是图片/位置/表情包/红包/转账卡片消息，请自然理解并回应。',
          '只以「' + charName + '」的身份和口吻发言，绝不替其他成员发言、代答或描写他们的言行。',
          '不复制、不复述、不换说法重复其他成员刚说过的内容（群里最忌跟风复读）。',
          '可以自然称呼、回应其他成员的观点，角色之间也能互相对话，不只是跟机主说话，像真实群聊那样互动，但始终保持自己的人设与语气（群聊语气可以比私聊随意，人设不能变）。',
          '把群里的每个成员都当作真实的群友，绝不出戏：不说「用户」「AI」「角色」「人设」这类幕后词汇，也不表现出「我知道谁在操作」。',
          '每次只发一条简短消息（一两句话），像真人在群里随手打字。',
          '【发红包】想给群里发红包时，在回复里输出 [红包:金额:祝福语]（如 [红包:8.88:恭喜发财]），红包会以你的名义发进群里，大家都能抢；金额量力而行、符合你的人设与场合，不要频繁发。',
        ];
        // 群红包/转账待处理清单（每个成员独立视角）：是否抢/收完全按人设决定，不处理就不输出标记
        const pendingCards = collectGroupPending(char.id);
        if (pendingCards.length > 0) {
          groupRules.push(
            '【群红包/转账】下面的清单来自本群：红包由机主或群成员发出，多份红包每人限领一份；专属红包只有被指定的人能领；转账只有收款人能处理。抢不抢、收不收都按你的人设与当时的语境自然决定。',
            ...buildActionRules(pendingCards)
          );
        }
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
        // 发言自判（按人设来）：未被 @ 的成员无话可说时只回 [SKIP]（finalize 阶段整条丢弃，不落盘）
        if (allowSkip) {
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
        // 记忆（按角色隔离 + 群级互通开关）：mode='group' → 本群记忆 + 互通开启时的自己私聊记忆
        const memoryBlock = memRecallBlock(char.id, 'wx', memContext, {
          mode: 'group',
          groupId: gid,
          interopOn: effectiveInterop,
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
        // 回复条数（按群独立，发送时现场读取）：>1 时连发多条（一句一条），成员们像真人一样逐条刷屏
        const replyCount = getReplyCount(sKey);
        const payload: ChatPayloadMessage[] = [
          { role: 'system', content: replyCount > 1 ? `${systemFull}\n\n${buildReplyCountPrompt(replyCount)}` : systemFull },
          ...history,
        ];
        const messages = applyWbUserBlocks(payload, wbBlocks);

        const ok = beginChatStream({
          sessionKey: sKey,
          aiMsgId: genId(),
          messages,
          apiConfig,
          replyCount,
          // 配置识图模型后：群里发的图片先识图，成员结合图片按人设回复（与单聊同管线）
          ...(turnImages.length > 0 ? { vision: { images: turnImages, text: lastUserText } } : {}),
          finalize: (result) => {
            const text = (result.content ?? '').trim();
            // 人设自判沉默：整条回复是 [SKIP] 标记 → 不落盘、不提取记忆（本轮对 TA 没有发生任何社交事件）
            if (allowSkip && SKIP_RE.test(text)) {
              resolve();
              return;
            }
            // 回复按出现顺序切「文字块 + 处理动作」：动作标记就地应用（红包领取/转账状态流转 + 通知行跟随动作位置落盘），
            // 文字块按边界（标记/换行/句末标点，回复条数>1 时一句一条）切分后再解析 [红包:…] 标记 → 群红包卡片消息
            const parts = extractRichActionParts(text);
            const all: WxGroupMsg[] = [];
            let t = result.startedAt;
            let idx = 0;
            for (const part of parts) {
              if (part.type === 'action') {
                applyGroupAiAction(char, part.action);
                continue;
              }
              const segs = mergeRichSegments(splitReplySegments(part.text, replyCount > 1));
              for (const seg of segs) {
                for (const p of parseRichParts(seg, [])) {
                  const id = idx === 0 ? result.aiMsgId : `${result.aiMsgId}-${idx}`;
                  if (p.type === 'rich') {
                    // 群里成员只发红包卡片（转账/亲属卡需要指定收款人，群规则不下发；位置/表情包富标记忽略）
                    if (p.rich.kind !== 'redpacket') continue;
                    all.push({
                      id,
                      role: 'peer',
                      senderId: char.id,
                      senderName: charName,
                      content: '',
                      time: t,
                      kind: 'redpacket',
                      rp: {
                        amount: p.rich.amount,
                        count: 1,
                        mode: 'normal',
                        blessing: p.rich.blessing || '恭喜发财，大吉大利',
                        claims: [],
                        sentAt: Date.now(),
                      },
                    });
                  } else {
                    const cleaned = p.text.trim();
                    if (!cleaned) continue;
                    all.push({ id, role: 'peer', senderId: char.id, senderName: charName, content: cleaned, time: t });
                  }
                  idx += 1;
                  t += 600 + Math.floor(Math.random() * 600);
                }
              }
            }
            if (all.length === 0) {
              all.push({ id: result.aiMsgId, role: 'peer', senderId: char.id, senderName: charName, content: '（…）', time: result.startedAt });
            }
            for (const m of all) appendMsg(m);
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
                          ? { role: 'me' as const, text: msgTextOf(m) }
                          : { role: 'peer' as const, text: `${m.senderName}：${msgTextOf(m)}` }
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
     
    [apiConfig, appendMsg, applyGroupAiAction, collectGroupPending, gid, me.id, me.name, ownerLabelOf, sKey]
  );

  /** 一个群回合：@ 成员必答优先，其余成员逐个按人设自判是否发言（无话可说 [SKIP] 沉默）。
   *  trigger 可省略（分句发送批次触发/红包/转账卡片入群时无文字可 @）：此时全员按人设自判。 */
  const runGroupTurn = useCallback(
    async (trigger?: WxGroupMsg) => {
      if (runningRef.current || isChatStreaming(sKey)) return;
      const g = getGroup(gid);
      if (!g || g.memberIds.length === 0) return;
      runningRef.current = true;
      try {
        expireStalePackets(); // 每轮开始前先清算过期红包（终态不可再改）
        const all = g.memberIds
          .map((id) => contactsRef.current.find((c) => c.id === id))
          .filter((c): c is ContactRecord => !!c);
        const mentioned = trigger ? parseMentions(trigger.content) : [];
        const ordered =
          mentioned.length > 0 ? [...mentioned, ...all.filter((m) => !mentioned.includes(m))] : all;
        // 识图输入：从末尾向前收集连续「我」发的图片（最多 3 张，与单聊同规则）
        const turnImages: string[] = [];
        const persisted = loadGroupMsgs(gid);
        for (let i = persisted.length - 1; i >= 0 && turnImages.length < 3; i--) {
          const m = persisted[i];
          if (m.role !== 'me') break;
          if (m.kind === 'image' && m.img?.src) turnImages.unshift(m.img.src);
        }
        for (const char of ordered) {
          if (!getGroup(gid)) break; // 群已被解散
          groupSpeaker.set(sKey, char.id);
          if (mountedRef.current) setSpeakerId(char.id);
          await runCharTurn(char, !mentioned.includes(char), turnImages);
          await sleep(420);
        }
      } finally {
        runningRef.current = false;
        groupSpeaker.delete(sKey);
        if (mountedRef.current) setSpeakerId(null);
      }
    },
     
    [expireStalePackets, gid, runCharTurn, sKey]
  );

  /** 分句发送批次触发：把已发出的整批消息交给成员统一回复（输入框为空时点「发送」） */
  const dispatchBatch = () => {
    if (!pendingDispatch || runningRef.current || isChatStreaming(sKey)) return;
    setPendingDispatch(false);
    markPendingBatch(sKey, false);
    const persisted = loadGroupMsgs(gid);
    const lastMe = [...persisted].reverse().find((m) => m.role === 'me');
    void runGroupTurn(lastMe);
  };

  const send = () => {
    const text = draft.trim();
    // 空输入点「发送」= 触发分句发送批次回复（分句开启且有未回复的批次时）
    if (!text) {
      if (sentenceSend && pendingDispatch) dispatchBatch();
      return;
    }
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
    // 分句发送开启：只入列不触发回复，等输入框为空再点一次「发送」统一触发（真人把几句话拆开发完）
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    void runGroupTurn(msg);
  };

  /** 相机/相册图片发送（与单聊同一套 readImageFile 压缩；配置识图模型后触发群回合） */
  const sendImageFiles = async (files: FileList) => {
    if (runningRef.current || isChatStreaming(sKey)) {
      onToast('成员们还在回复，稍等一下');
      return;
    }
    const created: WxGroupMsg[] = [];
    for (const f of Array.from(files).slice(0, 9)) {
      try {
        const d = await readImageFile(f);
        created.push({
          id: uid(),
          role: 'me',
          senderId: 'me',
          senderName: me.name,
          content: '',
          time: Date.now(),
          kind: 'image',
          img: { src: d },
        });
      } catch {
        onToast('图片发送失败');
      }
    }
    for (const m of created) appendMsg(m);
    if (created.length === 0) return;
    // 分句发送开启：只入列不触发回复（与文字消息同规则，空输入点「发送」统一触发）
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    if (useSettings.getState().visionConfig.baseUrl.trim()) {
      void runGroupTurn(created[created.length - 1]);
    }
  };

  /** 表情面板点选发送（表情包消息按群聊会话独立保存；成员结合表情含义按人设回应） */
  const sendSticker = (s: Sticker) => {
    setStickerOpen(false);
    if (runningRef.current || isChatStreaming(sKey)) {
      onToast('成员们还在回复，稍等一下');
      return;
    }
    const msg: WxGroupMsg = {
      id: uid(),
      role: 'me',
      senderId: 'me',
      senderName: me.name,
      content: '',
      time: Date.now(),
      kind: 'sticker',
      stk: { url: s.url, meaning: s.meaning },
    };
    appendMsg(msg);
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    void runGroupTurn(msg);
  };

  /** 发送位置卡片消息（内置地点 / 自定义位置；群里所有角色都能看到） */
  const sendLocation = (name: string, address: string) => {
    setPlusOpen(false);
    setCompose(null);
    if (runningRef.current || isChatStreaming(sKey)) {
      onToast('成员们还在回复，稍等一下');
      return;
    }
    const msg: WxGroupMsg = {
      id: uid(),
      role: 'me',
      senderId: 'me',
      senderName: me.name,
      content: '',
      time: Date.now(),
      kind: 'location',
      loc: { name, address },
    };
    appendMsg(msg);
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    void runGroupTurn(msg);
  };

  // ---------------- 群红包/转账（纯本地模拟，不涉及真实资金） ----------------

  /** 群红包/转账提交：余额预检 → 开启支付密码先验证 → 扣款并插卡片消息 → 触发群回合（成员按人设领取/收款） */
  const submitGroupRp = (p: { mode: GroupRpData['mode']; amount: number; count: number; blessing: string; target: ContactRecord | null }, methodId: string) => {
    const total = groupRpTotal(p.mode, p.amount, p.count);
    if (!wxCanPay(methodId, total)) {
      onToast(methodId === 'balance' ? '零钱不足，请先充值' : methodId.startsWith('fcin-') ? '亲属卡本月额度不足' : '卡内余额不足，请更换支付方式');
      return;
    }
    const pp = wxLoadPayPwd();
    if (pp.enabled && pp.pwd) {
      setGate({ kind: 'redpacket', amount: total, methodId, rp: p });
      return;
    }
    execGroupRp(p, methodId);
  };

  const execGroupRp = (p: { mode: GroupRpData['mode']; amount: number; count: number; blessing: string; target: ContactRecord | null }, methodId: string) => {
    const total = groupRpTotal(p.mode, p.amount, p.count);
    if (!wxExecutePayment(methodId, total, '红包')) {
      onToast(methodId === 'balance' ? '零钱不足，请先充值' : '余额不足，请更换支付方式');
      return;
    }
    const msg: WxGroupMsg = {
      id: uid(),
      role: 'me',
      senderId: 'me',
      senderName: me.name,
      content: '',
      time: Date.now(),
      kind: 'redpacket',
      rp: {
        amount: p.amount,
        count: p.mode === 'exclusive' ? 1 : p.count,
        mode: p.mode,
        blessing: p.blessing,
        targetId: p.mode === 'exclusive' && p.target ? p.target.id : undefined,
        targetName: p.mode === 'exclusive' && p.target ? memberNameOf(p.target) : undefined,
        claims: [],
        sentAt: Date.now(),
        cid: nextGroupCid('rp'),
      },
    };
    setLayer(null);
    appendMsg(msg);
    onToast(p.mode === 'exclusive' && p.target ? `专属红包已发给${memberNameOf(p.target)}` : `红包已发出 ${fmtMoney(total)} 元`);
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    void runGroupTurn(msg);
  };

  const submitGroupTr = (amount: number, note: string, member: ContactRecord, methodId: string) => {
    if (!wxCanPay(methodId, amount)) {
      onToast(methodId === 'balance' ? '零钱不足，请先充值' : methodId.startsWith('fcin-') ? '亲属卡本月额度不足' : '卡内余额不足，请更换支付方式');
      return;
    }
    const pp = wxLoadPayPwd();
    if (pp.enabled && pp.pwd) {
      setGate({ kind: 'transfer', amount, methodId, tr: { member, note } });
      return;
    }
    execGroupTr(amount, note, member, methodId);
  };

  const execGroupTr = (amount: number, note: string, member: ContactRecord, methodId: string) => {
    if (!wxExecutePayment(methodId, amount, '转账')) {
      onToast(methodId === 'balance' ? '零钱不足，请先充值' : '余额不足，请更换支付方式');
      return;
    }
    const msg: WxGroupMsg = {
      id: uid(),
      role: 'me',
      senderId: 'me',
      senderName: me.name,
      content: '',
      time: Date.now(),
      kind: 'transfer',
      tr: { amount, note, toId: member.id, toName: memberNameOf(member), cid: nextGroupCid('tr') },
    };
    setLayer(null);
    appendMsg(msg);
    onToast(`已向 ${memberNameOf(member)} 转账 ${fmtMoney(amount)} 元`);
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    void runGroupTurn(msg);
  };

  /** 我领取成员发的红包（开箱「開」）：金额入零钱+记账单+领取记录+通知行 → 进详情；
   *  专属红包只给被指定成员，其他人点击提示不能领 */
  const claimGroupRp = (msgId: string) => {
    const m = loadGroupMsgs(gid).find((x) => x.id === msgId);
    if (!m?.rp) return;
    const rp = m.rp;
    if (rp.mode === 'exclusive' && rp.targetId) {
      onToast(`这是发给${rp.targetName}的专属红包`);
      setLayer({ view: 'rp-detail', msgId });
      return;
    }
    if (rp.expired || rp.claims.length >= rp.count || rp.claims.some((c) => c.contactId === 'me')) {
      setLayer({ view: 'rp-detail', msgId });
      return;
    }
    const remaining = round2(groupRpTotal(rp.mode, rp.amount, rp.count) - rp.claims.reduce((s, c) => s + c.amount, 0));
    const left = rp.count - rp.claims.length;
    const amt = rp.mode === 'lucky' && left > 1 ? splitLuckyAmount(remaining, left) : remaining;
    patchGroupMsg(msgId, { rp: { ...rp, claims: [...rp.claims, { contactId: 'me', name: me.name, avatar: me.avatar, amount: amt, ts: Date.now() }] } });
    wxPatchBalance(amt, { kind: '红包', amount: amt });
    appendFundNotice('rp', `你领取了${m.senderId === 'me' ? '自己发的' : m.senderName || '群友'}的`, '红包');
    setLayer({ view: 'rp-detail', msgId });
  };

  /** 红包卡片点击：成员发的未领完且我能领 → 先开箱；其余（自己发的/已领/已完/已过期）直接进详情 */
  const openRpMsg = (m: WxGroupMsg) => {
    const rp = m.rp;
    if (!rp) return;
    const claimable = m.senderId !== 'me' && !rp.expired && rp.claims.length < rp.count && !rp.claims.some((c) => c.contactId === 'me') && rp.mode !== 'exclusive';
    if (claimable) {
      setLayer({ view: 'rp-open', msgId: m.id });
      return;
    }
    if (rp.mode === 'exclusive' && m.senderId !== 'me' && !rp.claims.some((c) => c.contactId === 'me') && !rp.expired && rp.claims.length < rp.count) {
      onToast(`这是发给${rp.targetName}的专属红包`);
    }
    setLayer({ view: 'rp-detail', msgId: m.id });
  };

  /** 加号面板动作（图片/相机/位置同前；红包/转账 → 群级流程：发红包页 / 先选收款成员） */
  const handlePlusAction = (a: GroupPlusAction) => {
    if (a === 'image') {
      setPlusOpen(false);
      setStickerOpen(false);
      photoInputRef.current?.click();
      return;
    }
    if (a === 'camera') {
      setPlusOpen(false);
      setStickerOpen(false);
      cameraInputRef.current?.click();
      return;
    }
    if (a === 'location') {
      setPlusOpen(false);
      setStickerOpen(false);
      setCompose('location');
      return;
    }
    if (a === 'redpacket') {
      setPlusOpen(false);
      setStickerOpen(false);
      setLayer({ view: 'rp-compose' });
      return;
    }
    if (a === 'transfer') {
      setPlusOpen(false);
      setStickerOpen(false);
      if (members.length === 0) {
        onToast('群里还没有成员');
        return;
      }
      setLayer({ view: 'tr-pick' });
      return;
    }
    const label: Record<string, string> = { voicecall: '语音通话', videocall: '视频通话', favorite: '收藏' };
    onToast(`${label[a] ?? '该功能'}暂未开放`);
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
      copyText(msgSnapshotOf(menuMsg), onToast);
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

  /** 空输入时可点「发送」触发批次回复（分句发送开启且有未回复的批次） */
  const canDispatch = sentenceSend && pendingDispatch && !streaming && !runningRef.current;
  const rpComposeLayer = layer?.view === 'rp-compose' ? layer : null;
  const layerMsg = layer && 'msgId' in layer ? msgs.find((m) => m.id === layer.msgId) ?? null : null;

  /** 消息行外层（头像 + 发言者名；文字与富媒体共用同一套行几何） */
  const renderMsgRow = (m: WxGroupMsg, media?: React.ReactNode) => {
    const mine = m.role === 'me';
    const sender = mine ? null : m.senderId === 'unknown' ? null : memberById.get(m.senderId) ?? null;
    const senderAvatar = mine ? me.avatar : sender?.avatar ?? null;
    return (
      <div className={`mb-3 flex items-start gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
        <WxAvatar src={senderAvatar} alt={mine ? me.name : m.senderName} size={38} />
        <div className={`flex min-w-0 max-w-[calc(100%-92px)] flex-col ${mine ? 'items-end' : 'items-start'}`}>
          {!mine && <span className="mb-0.5 px-1 text-[12px] leading-none text-black/40 dark:text-white/40">{m.senderName}</span>}
          {media}
        </div>
      </div>
    );
  };

  return (
    <div className="relative flex h-full flex-col bg-[#EDEDED] dark:bg-[#111111]">
      {/* 聊天背景层（聊天信息页设置：纯色/图片；顶栏与输入栏自身有底色，不受影响；按群独立） */}
      {bg.mode !== 'default' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0" style={chatBgLayerStyle(bg, bgImageUrl)} />
      )}
      {/* 顶栏：与消息区/输入栏同色无边框（同私聊） */}
      <div className="relative z-10 shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" onClick={onBack} className="flex items-center px-1 active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <button type="button" onClick={onOpenInfo} data-testid="wx-groupchat-openinfo" className="flex min-w-0 flex-1 items-center justify-center gap-1.5 active:opacity-60">
            <span className="max-w-[220px] truncate text-[17px] font-medium">{group.name}({members.length + 1})</span>
            {flags[groupRowId(gid)]?.muted === true && (
              <BellOff className="h-4 w-4 shrink-0 text-black/30 dark:text-white/30" strokeWidth={2} aria-label="消息免打扰" />
            )}
          </button>
          <button
            type="button"
            aria-label="聊天信息"
            onClick={onOpenInfo}
            data-testid="wx-groupchat-info"
            className="px-2 active:opacity-50"
          >
            {/* 微信同款「···」三点图标 */}
            <span className="flex items-center gap-[3px]" aria-hidden="true">
              <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
              <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
              <span className="h-[4px] w-[4px] rounded-full bg-current opacity-70" />
            </span>
          </button>
        </div>
      </div>

      {/* 消息列表：自定义聊天背景时透出背景层 */}
      <div ref={listRef} className="relative z-10 min-h-0 flex-1 overflow-y-auto px-3 py-2" data-testid="wx-groupchat-list">
        {msgs.length === 0 && (
          <div className="pt-16 text-center text-[13px] leading-relaxed text-black/35 dark:text-white/35">
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
                {showTime && <div className="pb-1 text-[12px] text-black/35 dark:text-white/35">{fmtGroupTime(m.time)}</div>}
                {m.notice ? (
                  <WxNoticeRow icon={m.notice.icon} pre={m.notice.pre} accent={m.notice.accent} />
                ) : (
                  <span className="inline-block rounded-[4px] bg-black/5 px-2 py-0.5 text-[12px] text-black/45 dark:bg-white/10 dark:text-white/45">
                    {m.noticeText ?? m.content}
                  </span>
                )}
              </div>
            );
          }
          const mine = m.role === 'me';
          return (
            <div key={m.id} data-mid={m.id} {...bubblePress}>
              {showTime && <div className="py-2 text-center text-[12px] text-black/35 dark:text-white/35">{fmtGroupTime(m.time)}</div>}
              {m.recalled ? (
                <div className="py-1.5 text-center">
                  <span className="inline-block rounded-[4px] bg-black/5 px-2 py-0.5 text-[12px] text-black/45 dark:bg-white/10 dark:text-white/45">
                    {mine ? '你' : m.senderName || '有人'}撤回了一条消息
                  </span>
                </div>
              ) : m.kind === 'image' && m.img ? (
                renderMsgRow(
                  m,
                  <ImageMsgBubble src={m.img.src} onClick={() => setViewerSrc(m.img?.src ?? null)} />
                )
              ) : m.kind === 'location' && m.loc ? (
                renderMsgRow(
                  m,
                  <LocBubble
                    name={m.loc.name}
                    address={m.loc.address}
                    onClick={() => setLocView({ name: m.loc?.name ?? '', address: m.loc?.address ?? '' })}
                  />
                )
              ) : m.kind === 'sticker' && m.stk ? (
                renderMsgRow(
                  m,
                  <StickerMsgBubble
                    src={m.stk.url}
                    meaning={m.stk.meaning}
                    onClick={() => {
                      setViewerSrc(m.stk?.url ?? null);
                      if (m.stk?.meaning) onToast(`表情：${m.stk.meaning}`);
                    }}
                  />
                )
              ) : m.kind === 'redpacket' && m.rp ? (
                renderMsgRow(
                  m,
                  <RpBubble
                    blessing={m.rp.blessing}
                    sub={
                      m.rp.expired
                        ? '已过期'
                        : m.rp.claims.length >= m.rp.count
                          ? `已领取 ${m.rp.claims.length}/${m.rp.count}`
                          : m.rp.claims.length > 0
                            ? `已领取 ${m.rp.claims.length}/${m.rp.count}`
                            : m.rp.mode === 'exclusive'
                              ? `专属红包 · 给${m.rp.targetName ?? '群友'}`
                              : m.rp.count > 1
                                ? `${m.rp.count} 个红包待领取`
                                : '待领取'
                    }
                    settled={m.rp.expired || m.rp.claims.length >= m.rp.count}
                    onClick={() => openRpMsg(m)}
                  />
                )
              ) : m.kind === 'transfer' && m.tr ? (
                renderMsgRow(
                  m,
                  <TrBubble
                    amount={m.tr.amount}
                    status={m.tr.received ? `${m.tr.toName}已收款` : m.tr.status === 'returned' ? '已退回' : m.tr.status === 'rejected' ? '已拒收' : `待${m.tr.toName}收款`}
                    received={m.tr.received === true}
                    refunded={m.tr.status === 'returned'}
                    fromMe={m.role === 'me'}
                    note={m.tr.note || undefined}
                    settled={Boolean(m.tr.received || m.tr.status)}
                    onClick={() => setLayer({ view: 'tr-detail', msgId: m.id })}
                  />
                )
              ) : (
                renderMsgRow(
                  m,
                  <div
                    className={`relative w-fit max-w-full select-none rounded-[5px] px-3 py-2 text-[16px] leading-[1.45] ${
                      mine
                        ? 'bg-[#95EC69] text-black dark:bg-[#3EB575] dark:text-black'
                        : 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white'
                    }`}
                    data-testid={mine ? 'wx-groupmsg-me' : 'wx-groupmsg-peer'}
                  >
                    {/* 气泡小三角（微信同款，与私聊同规格） */}
                    <span
                      aria-hidden="true"
                      className={`absolute top-[11px] h-[8px] w-[8px] rotate-45 ${
                        mine ? '-right-[3px] bg-[#95EC69] dark:bg-[#3EB575]' : '-left-[3px] bg-white dark:bg-[#1E1E1E]'
                      }`}
                    />
                    {m.quote && (
                      <div
                        className={`mb-1 max-w-full overflow-hidden rounded-[4px] px-2 py-1 text-[12.5px] leading-[1.35] ${
                          mine ? 'bg-black/[0.08] text-black/60' : 'bg-black/[0.05] text-black/50 dark:bg-white/10 dark:text-white/60'
                        }`}
                      >
                        <p className="line-clamp-2 whitespace-pre-wrap break-all">引用 {m.quote.name}：{m.quote.content}</p>
                      </div>
                    )}
                    <span className="whitespace-pre-wrap break-words">{m.content}</span>
                  </div>
                )
              )}
            </div>
          );
        })}
        {/* 流式气泡（当前发言角色）：回复条数>1 时按边界实时切成多个气泡，下一句没打完时显示打字中（与私聊同节奏） */}
        {streaming && stream && (
          <div data-testid="wx-group-stream">
            {(() => {
              const split = splitReplyRender(stream.content, (stream.replyCount ?? 1) > 1);
              return (
                <>
                  {split.texts.map((t, i) => (
                    <div key={i} className="mb-3 flex items-start gap-2">
                      <WxAvatar src={speaker?.avatar ?? null} alt={speaker ? memberNameOf(speaker) : '…'} size={38} />
                      <div className="flex min-w-0 max-w-[calc(100%-92px)] flex-col items-start">
                        <span className="mb-0.5 px-1 text-[12px] leading-none text-black/40 dark:text-white/40">
                          {speaker ? memberNameOf(speaker) : '…'}
                        </span>
                        <div className="relative rounded-[5px] bg-white px-3 py-2 text-[16px] leading-[1.45] dark:bg-[#1E1E1E]">
                          <span aria-hidden="true" className="absolute -left-[3px] top-[11px] h-[8px] w-[8px] rotate-45 bg-white dark:bg-[#1E1E1E]" />
                          <span className="whitespace-pre-wrap break-words">
                            {prettifyRichText(t)}
                            {i === split.texts.length - 1 && <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-black/40 align-text-bottom dark:bg-white/40" />}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {/* 首句未凑齐 / 下一句还没出现 → 打字中气泡（与私聊一句一句连发节奏一致） */}
                  {(split.pending || split.texts.length === 0) && (
                    <div className="mb-3 flex items-start gap-2">
                      <WxAvatar src={speaker?.avatar ?? null} alt={speaker ? memberNameOf(speaker) : '…'} size={38} />
                      <div className="flex min-w-0 max-w-[calc(100%-92px)] flex-col items-start">
                        <span className="mb-0.5 px-1 text-[12px] leading-none text-black/40 dark:text-white/40">
                          {speaker ? memberNameOf(speaker) : '…'}
                        </span>
                        <div className="relative rounded-[5px] bg-white px-3 py-2 dark:bg-[#1E1E1E]">
                          <span aria-hidden="true" className="absolute -left-[3px] top-[11px] h-[8px] w-[8px] rotate-45 bg-white dark:bg-[#1E1E1E]" />
                          <span className="flex h-[23px] items-center gap-1" aria-label="正在输入">
                            <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-black/25 dark:bg-white/35" />
                            <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-black/25 [animation-delay:150ms] dark:bg-white/35" />
                            <span className="h-[6px] w-[6px] animate-bounce rounded-full bg-black/25 [animation-delay:300ms] dark:bg-white/35" />
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* 输入区：与私聊同款灰底无边框；@ 描边圆钮；表情/加号/图片/相机/位置与单聊完全对齐（共用同一套组件） */}
      <div className="relative z-10 shrink-0 bg-[#EDEDED] dark:bg-[#111111]">
        {quote && (
          <div className="px-2.5 pt-2" data-testid="wx-group-quote-bar">
            <div className="flex items-start gap-2 rounded-[6px] bg-black/[0.05] px-2.5 py-1.5 dark:bg-white/[0.08]">
              <p className="min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-black/55 dark:text-white/55">
                引用 {quote.name}：{quote.content}
              </p>
              <button type="button" aria-label="取消引用" onClick={() => setQuote(null)} className="shrink-0 text-black/35 active:opacity-60 dark:text-white/35">
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
        <div className="px-2.5 pb-[18px] pt-2">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              aria-label="提及成员"
              data-testid="wx-groupchat-at"
              aria-expanded={atOpen}
              onClick={() => {
                setStickerOpen(false);
                setPlusOpen(false);
                setAtOpen((v) => !v);
              }}
              className={`shrink-0 active:opacity-70 ${atOpen ? 'text-[#07C160]' : ''}`}
            >
              <span className="flex h-[35px] w-[35px] items-center justify-center rounded-full border-[1.7px] border-black/75 text-black/85 transition-colors active:bg-black/[0.06] dark:border-white/70 dark:text-white/85 dark:active:bg-white/10">
                <AtSign className="h-[19px] w-[19px]" strokeWidth={2} />
              </span>
            </button>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder=""
              data-testid="wx-groupchat-input"
              className="h-9 min-w-0 flex-1 rounded-[6px] border border-black/10 bg-white px-3 text-[16px] outline-none dark:border-white/15 dark:bg-[#1A1A1A]"
            />
            {draft.trim() || canDispatch ? (
              <button
                type="button"
                onClick={send}
                disabled={streaming || runningRef.current}
                data-testid="wx-groupchat-send"
                aria-label="发送"
                className="shrink-0 rounded-[5px] bg-[#07C160] px-3.5 py-1.5 text-[14px] font-medium text-white active:bg-[#06AD56] disabled:opacity-50"
              >
                发送
              </button>
            ) : (
              <div className="flex shrink-0 items-center gap-[13px] text-black/80 dark:text-white/80">
                <button
                  type="button"
                  aria-label="表情"
                  data-testid="wx-groupchat-sticker"
                  aria-expanded={stickerOpen}
                  onClick={() => {
                    setPlusOpen(false);
                    setAtOpen(false);
                    setStickerOpen((v) => !v);
                  }}
                  className={`active:opacity-60 ${stickerOpen ? 'text-[#07C160]' : ''}`}
                >
                  <Smile className="h-[25px] w-[25px]" strokeWidth={1.7} />
                </button>
                <button
                  type="button"
                  aria-label="更多功能"
                  data-testid="wx-groupchat-plus"
                  onClick={() => {
                    setStickerOpen(false);
                    setAtOpen(false);
                    setPlusOpen((v) => !v);
                  }}
                  className="active:opacity-60"
                >
                  <CirclePlus className={`h-[26px] w-[26px] transition-transform duration-200 ${plusOpen ? 'rotate-45' : ''}`} strokeWidth={1.5} />
                </button>
              </div>
            )}
          </div>
        </div>
        {/* 表情面板 / 加号面板（与单聊共用同一套组件与布局） */}
        {stickerOpen && <WxStickerPanel onPick={sendSticker} onClose={() => setStickerOpen(false)} onToast={onToast} />}
        {plusOpen && <WxGroupPlusPanel onAction={handlePlusAction} />}
        {/* @ 成员浮层：锚定输入区容器上方（含面板与引用条也不遮挡） */}
        {atOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setAtOpen(false)} aria-hidden="true" />
            <div className="absolute bottom-full left-3 z-40 mb-1 w-[220px] overflow-hidden rounded-[10px] border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#2C2C2C]">
              <div className="border-b border-black/5 px-3 py-2 text-[11px] text-black/40 dark:border-white/10 dark:text-white/40">
                @ 群成员（被 @ 的成员必答优先）
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
                    <WxAvatar src={m.avatar} alt={m.name} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[14px]">{memberNameOf(m)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 位置页（与单聊共用同一套组件） */}
      {compose === 'location' && <LocationPickerPage onClose={() => setCompose(null)} onSend={sendLocation} onToast={onToast} />}

      {/* 群红包/转账浮层流程（发红包页 / 选人页 / 转账页[共用单聊组件] / 开箱 / 详情） */}
      {rpComposeLayer && (
        <GroupRpCompose
          members={members}
          meBalanceLabel={wxMethodLabel('balance')}
          onBack={() => setLayer(null)}
          onSubmit={submitGroupRp}
          onToast={onToast}
        />
      )}
      {layer?.view === 'tr-pick' && (
        <GroupTrPickPage
          members={members}
          groupName={group.name}
          onBack={() => setLayer(null)}
          onPick={(c) => setLayer({ view: 'tr-compose', member: c })}
        />
      )}
      {layer?.view === 'tr-compose' && (
        <TransferCompose
          peer={layer.member}
          onBack={() => setLayer(null)}
          onSubmit={(amount, note, methodId) => submitGroupTr(amount, note, layer.member, methodId)}
          onToast={onToast}
        />
      )}
      {layer?.view === 'rp-open' && layerMsg?.rp && (
        <RpOpenLayer
          senderName={layerMsg.senderId === 'me' ? '我' : layerMsg.senderName || '群友'}
          senderAvatar={layerMsg.senderId === 'me' ? me.avatar : memberById.get(layerMsg.senderId)?.avatar ?? null}
          blessing={layerMsg.rp.blessing}
          onOpen={() => claimGroupRp(layer.msgId)}
          onClose={() => setLayer(null)}
        />
      )}
      {layer?.view === 'rp-detail' && layerMsg?.rp && (
        <GroupRpDetailPage
          senderName={layerMsg.senderId === 'me' ? '我' : layerMsg.senderName || '群友'}
          senderAvatar={layerMsg.senderId === 'me' ? me.avatar : memberById.get(layerMsg.senderId)?.avatar ?? null}
          blessing={layerMsg.rp.blessing}
          rp={layerMsg.rp}
          onBack={() => setLayer(null)}
          onToast={onToast}
        />
      )}
      {layer?.view === 'tr-detail' && layerMsg?.tr && (
        <GroupTrDetailPage tr={layerMsg.tr} fromName={layerMsg.role === 'me' ? me.name : layerMsg.senderName || '群友'} onBack={() => setLayer(null)} />
      )}

      {/* 支付密码验证浮层（开启支付密码后群红包/群转账发送前弹出自绘键盘，与单聊同规则） */}
      {gate && (
        <WxPayPwdGate
          label={`${gate.kind === 'redpacket' ? '发红包' : '转账'} ¥${fmtMoney(gate.amount)} 元`}
          onOk={() => {
            const g = gate;
            setGate(null);
            if (g.kind === 'redpacket' && g.rp) execGroupRp(g.rp, g.methodId);
            else if (g.kind === 'transfer' && g.tr) execGroupTr(g.amount, g.tr.note, g.tr.member, g.methodId);
          }}
          onClose={() => setGate(null)}
        />
      )}
      {/* 原生相机/相册隐藏 input：相机单张（capture 调起后置摄像头）、图片可多选（与单聊同款） */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void sendImageFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void sendImageFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {/* 图片/表情全屏预览 */}
      {viewerSrc && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black" data-testid="wx-group-img-view" onClick={() => setViewerSrc(null)}>
          <img src={viewerSrc} alt="图片预览" className="max-h-full max-w-full object-contain" />
        </div>
      )}
      {/* 位置详情页（点位置卡片进入；与单聊共用同一套组件） */}
      {locView && <LocViewLayer name={locView.name} address={locView.address} onClose={() => setLocView(null)} />}

      {/* 长按菜单 */}
      {menu && menuRect && menuMsg && (
        <BubbleActionMenu pos={menuRect} items={menuItems} onSelect={onMenuSelect} onClose={() => { setMenu(null); setMenuRect(null); }} testPrefix="wx-group" />
      )}
      {/* 页内 toast（微信根 toast 在群聊分支不渲染） */}
      <LocalToast msg={toastMsg} />
    </div>
  );
}
