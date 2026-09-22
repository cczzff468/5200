'use client';

/**
 * QQ 群聊（宿主：QQ App；会话身份 sessionKey = `qq:group:<groupId>`）。
 *
 * 组成：
 * - QqGroupCreatePage  建群：多选 QQ 好友 + 群名（默认按成员名生成）；
 * - QqGroupChatPage    群聊页：气泡（发言者名+头像）/ @某成员优先回复 / 长按菜单（复制/引用/撤回/删除）/
 *                      流式气泡（当前发言角色）/ 多角色逐个顺序回复；
 *                      输入与单聊完全对齐（表情包/加号面板/图片/相机/位置，共用同一套组件）；
 *                      聊天背景按群独立（入口在聊天信息页，与单聊同款 ChatBgPage）；
 * - QqGroupInfoPage    群聊信息：成员管理（邀请/移出）、群名、群公告、群头像、
 *                      记忆与私聊互通开关（按群独立）、置顶/免打扰、时间感知、清空记录、解散并退出群聊。
 *
 * AI 管线（多角色，每个角色独立组装 system，绝不共用）：
 * - 用户发言后按「被 @ 成员必答优先，其余成员按人设自判（[SKIP] 不落盘）」逐个发起流式回合（单会话单流，队列串行）；
 * - 每个角色的 system = 七要素人设（含自己与机主的关系）+ 群聊规则（当前是群聊/参与者名单与成员速览/
 *   只代表自己/禁复读/可以互相对话）+ 该角色自己的记忆召回（memRecallBlock mode='group'：
 *   本群记忆 + 互通开启时的自己私聊记忆；interopOn 只跟群级开关）+ 时间感知（按群开关）+ 世界书；
 *   机主与其他成员的历史消息一律映射为「发言者：内容」的 user 消息；
 * - finalize：回复落盘（senderId 区分发言人）+ 未读 + memAfterAiTurn（roundScope 按群隔离，
 *   碎片带 source='group'/sourceGroupId/groupMembers 群来源标记）。
 * - 群红包（普通/拼手气/专属）与指定成员转账：复用单聊同一套卡片/页面组件（RedPacketBubble/RedPacketCompose 等），
 *   消息落本群消息库按群隔离持久化；成员按人设领取/收款/退回，纯本地模拟不涉及真实资金。
 * - 回复条数（按群独立连发多条）与分句发送（连发不触发回复，空输入点发送统一触发）与单聊同套逻辑。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  AtSign,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Forward,
  Image as ImageIcon,
  Lock,
  MapPin,
  Mic,
  Minus,
  Phone,
  Plus,
  Search,
  Sparkles,
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
  BUBBLE_MENU_ICONS,
  BubbleActionMenu,
  computeBubbleMenuPos,
  useBubbleLongPress,
  type BubbleMenuItem,
} from '@/components/apps/bubble-menu';
import { displayNameOf, isFriendIn, type ContactRecord } from '@/lib/contacts';
import { buildNpcPromptExtra } from '@/lib/ios/npc-bond';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import { contactRealName, getChatBgImage, ownerRealName, removeChatBgImage, setChatBgImage } from '@/lib/ios/contacts-store';
import { genId } from '@/lib/ios/db';
import {
  addGroupMember,
  GROUP_MEMBER_CAP,
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
  type GroupFwdRecord,
  type GroupRpData,
  type GroupTrData,
  type WxGroupMsg,
} from '@/lib/ios/groups';
import { addFavorite, isMsgFavorited, unfavoriteMsg, type MsgFavorite } from '@/lib/msg-favorites';
import { fwdRecordDate, fwdRecordTime, fwdRecordTitle, type FwdMode, type FwdRecord, type FwdSheetTarget } from './forward-sheet';
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { qqChatFlags, useChatFlags, type ChatFlags } from '@/lib/chat-flags';
import { ChatBgPage, ChatReplyCountPage, ChatToggle, chatBgLayerStyle, type ChatSettingsBg } from '@/components/apps/chat-settings';
import type { Sticker } from '@/lib/ios/stickers';
import { readImageFile } from './wechat';
import {
  LocationBubble,
  LocationPickerPage,
  QqImageBubble,
  QqPlusGrid,
  QqStickerBubble,
  QqStickerPanel,
  RedPacketBubble,
  RedPacketCompose,
  RedPacketOpenModal,
  RpIcon,
  QQNoticeRow,
  TransferBubble,
  TransferCompose,
  PayPwdGate,
  fmtMoney,
  type MsgPacket,
} from './qq';
import { canPay, executePayment, gainToWallet, loadBankCards, loadPayPwd, loadWallet, round2 } from './qq';
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
import { qqUnreads } from '@/lib/unread-store';
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

/** 群会话 id（未读/标志/隐藏等以字符串 id 为键的设施共用，与微信群同构） */
export const qqGroupRowId = (groupId: string) => `group:${groupId}`;
const sessionKeyOf = (groupId: string) => `qq:group:${groupId}`;

// ---------------- 群红包/转账（纯本地模拟；按群 ID 隔离，与单聊互不相通） ----------------

/** 机主发的红包/转账短 ID（AI 动作标记里引用；格式如 grp-x7k2） */
function nextGroupCid(prefix: 'rp' | 'tr'): string {
  return `grp-${prefix === 'rp' ? 'r' : 't'}-${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-3)}`;
}

/** 群红包状态标签：待领取 → 部分领取 → 已抢完 / 已过期（与微信侧同规则） */
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

/** 群红包总额：普通 = 单个金额×个数；拼手气 = 总金额；专属 = 单个金额 */
export function groupRpTotal(mode: GroupRpData['mode'], amount: number, count: number): number {
  return mode === 'normal' ? round2(amount * count) : round2(amount);
}

/** 完整时间：2026年9月19日 20:32:08（群红包/转账详情页领取时间用） */
function fmtGrpFullTime(ts: number): string {
  const d = new Date(ts);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function memberNameOf(c: ContactRecord): string {
  return displayNameOf(c);
}

/** AI 自判跳过标记：整条回复只有这个标记时不落盘（不进消息、不提取记忆、不计未读） */
const SKIP_RE = /^\[?\s*(?:SKIP|跳过)\s*\]?$/i;

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

// ---------------- 群 → 单聊转发（与 QQ 单聊同一套存储键 / 感知事件键，单聊 loadMsgs 打开即能读回） ----------------

/** 写入 QQ 单聊消息库的最小消息形状（qq.tsx 的 QQMsg 结构子集；loadMsgs 规范化时按字段兜底） */
export interface QqSingleMsgShape {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  kind?: 'text' | 'image' | 'sticker' | 'location' | 'forward';
  img?: { src: string };
  loc?: { name: string; addr: string };
  stk?: { url: string; meaning: string };
  quote?: { name: string; content: string };
  fwd?: { from: string; merged?: boolean; title?: string; records?: GroupFwdRecord[] };
}

const qqSingleMsgsKey = (contactId: string) => `qq-chat-msgs:${contactId}`;

/** 读目标单聊消息库（转发落点；结构对齐 qq.tsx loadMsgs 的宽松过滤） */
function loadQqSingleMsgs(contactId: string): QqSingleMsgShape[] {
  try {
    const raw = kvGet<QqSingleMsgShape[]>(qqSingleMsgsKey(contactId));
    if (!Array.isArray(raw)) return [];
    return raw.filter((m) => Boolean(m) && typeof m.content === 'string' && (m.role === 'me' || m.role === 'peer'));
  } catch {
    return [];
  }
}

/** 写目标单聊消息库（与 qq.tsx saveMsgs 同键同封顶） */
function saveQqSingleMsgs(contactId: string, msgs: QqSingleMsgShape[]): void {
  try {
    kvSet(qqSingleMsgsKey(contactId), msgs.slice(-200));
  } catch {
    // 存储失败不中断
  }
}

const qqAiEventsKey = (contactId: string) => `qq-ai-events:${contactId}`;

/** 转发落到目标单聊时给目标 AI 排一条感知事件（打开会话即触发 AI 回应；与 qq.tsx pushAiEvent 同键格式） */
function pushQqAiEvent(contactId: string, text: string): void {
  try {
    const parsed = kvGet<string[]>(qqAiEventsKey(contactId));
    const arr = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    arr.push(text);
    kvSet(qqAiEventsKey(contactId), arr.slice(-10));
  } catch {
    // 忽略
  }
}

/** QQ 头像（圆形；无头像时蓝色 Q 占位） */
function QqAvatar({ src, alt, size = 40 }: { src: string | null; alt: string; size?: number }) {
  const style: React.CSSProperties = { width: size, height: size };
  if (src) {
    return <img src={src} alt={alt} draggable={false} className="shrink-0 rounded-full object-cover" style={style} />;
  }
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-[#B9D9F3] font-semibold text-white"
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
    >
      {alt.slice(0, 1) || 'Q'}
    </div>
  );
}

/** 群头像：自定义头像优先；否则前 4 名成员头像拼贴（QQ 圆角方形同款风格） */
export function QqGroupAvatar({
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
        className="shrink-0 rounded-[10px] object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="grid shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-[10px] bg-[#E3E6EB] dark:bg-[#3A3A3A]"
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
              <div key={m.id} className="flex h-full w-full items-center justify-center bg-[#C9D6E4] dark:bg-[#4A4A4A]">
                <span className="text-[10px] font-semibold text-white">{memberNameOf(m).slice(0, 1)}</span>
              </div>
            )
          )}
          {Array.from({ length: 4 - members.length }).map((_, i) => (
            <div key={`pad-${i}`} className="bg-[#EBEEF2] dark:bg-[#333333]" />
          ))}
        </>
      )}
    </div>
  );
}

// ---------------- 通用小件 ----------------

function GroupNavBar({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-20 shrink-0 border-b border-black/[0.05] bg-[#F5F6F7]/95 pt-[54px] backdrop-blur dark:border-white/[0.06] dark:bg-[#111214]/95">
      <div className="flex h-12 items-center px-3">
        <button
          type="button"
          aria-label="返回"
          onClick={onBack}
          className="-ml-1 rounded-full p-1.5 active:bg-black/5 dark:active:bg-white/10"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
        </button>
        <div className="flex-1 truncate text-center text-[17px] font-semibold">{title}</div>
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
      className={`flex w-full items-center gap-3 px-4 py-3 text-left ${onClick ? 'active:bg-black/[0.04] dark:active:bg-white/[0.05]' : 'cursor-default'}`}
    >
      <span className={`text-[15px] ${danger ? 'text-[#F5455C]' : ''}`}>{label}</span>
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
        <ChatToggle on={checked} onChange={onChange} accent="#0099FF" testId={testId} label={label} />
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
      <div className="w-full rounded-[14px] bg-white p-4 dark:bg-[#2A2C31]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-center text-[15px] font-medium">{title}</div>
        <Input
          value={val}
          autoFocus
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          className="h-10 rounded-[10px] bg-black/[0.05] text-[14px] dark:bg-white/10"
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(val);
          }}
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 flex-1 rounded-[8px] bg-black/[0.05] text-[14px] active:opacity-70 dark:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(val)}
            className="h-9 flex-1 rounded-[8px] bg-[#0099FF] text-[14px] font-medium text-white active:opacity-80"
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
      <div className="w-full rounded-[14px] bg-white dark:bg-[#2A2C31]" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pb-5 pt-6 text-center text-[15px] leading-relaxed">{text}</div>
        <div className="flex border-t border-black/10 dark:border-white/10">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 text-[15px] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 border-l border-black/10 py-3 text-[15px] font-medium text-[#F5455C] active:bg-black/[0.04] dark:border-white/10 dark:active:bg-white/[0.06]"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 建群页 ----------------

/** 建群：多选 QQ 好友（CHAR/NPC）+ 群名；至少 1 名成员；人数上限 GROUP_MEMBER_CAP */
export function QqGroupCreatePage({
  contacts,
  onBack,
  onCreated,
  onToast,
}: {
  contacts: ContactRecord[];
  onBack: () => void;
  onCreated: (g: ChatGroup) => void;
  /** 页内提示（建群规则：成员至少一名、人数上限）；未接时静默 */
  onToast?: (m: string) => void;
}) {
  const toast = onToast ?? (() => {});
  const candidates = useMemo(() => contacts.filter((c) => c.kind !== 'user' && isFriendIn(c, 'qq')), [contacts]);
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

  const toggle = (id: string) =>
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // 群人数上限（与邀请浮层同一规则）：超出后不可再勾选
      if (prev.length >= GROUP_MEMBER_CAP) {
        toast(`群成员最多 ${GROUP_MEMBER_CAP} 人`);
        return prev;
      }
      return [...prev, id];
    });

  const create = () => {
    const me = contacts.find((c) => c.kind === 'user');
    if (!me || selected.length === 0) {
      toast('至少选择一名成员');
      return;
    }
    const g = createGroup({ app: 'qq', name: effName || '未命名群聊', memberIds: selected, ownerId: me.id });
    onCreated(g);
  };

  return (
    <div className="flex h-full flex-col bg-[#F5F6F7] dark:bg-[#111214]">
      <GroupNavBar title="发起群聊" onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="bg-white px-4 py-3 dark:bg-[#1B1C1F]">
          <Input
            value={effName}
            onChange={(e) => {
              setNameDirty(true);
              setName(e.target.value);
            }}
            placeholder="群聊名称（留空按成员名生成）"
            className="h-10 rounded-[10px] bg-black/[0.05] text-[14px] dark:bg-white/10"
            data-testid="qq-group-name-input"
          />
        </div>
        <div className="mt-2 bg-white dark:bg-[#1B1C1F]">
          <div className="border-b border-black/[0.05] px-4 py-2.5 text-[12px] text-black/45 dark:border-white/[0.06] dark:text-white/45">
            选择群成员（{selected.length} 人）
          </div>
          {candidates.length === 0 && (
            <div className="px-4 py-10 text-center text-[13px] text-black/40 dark:text-white/40">
              还没有 QQ 好友，先去「加好友」吧
            </div>
          )}
          {candidates.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                data-testid={`qq-group-cand-${c.id}`}
                onClick={() => toggle(c.id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05]"
              >
                <QqAvatar src={c.avatar} alt={memberNameOf(c)} size={40} />
                <span className="min-w-0 flex-1 truncate text-[15px]">{memberNameOf(c)}</span>
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    on ? 'border-[#0099FF] bg-[#0099FF]' : 'border-black/20 dark:border-white/25'
                  }`}
                >
                  {on && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="shrink-0 border-t border-black/[0.05] bg-white p-3 dark:border-white/[0.06] dark:bg-[#1B1C1F]">
        <button
          type="button"
          data-testid="qq-group-create-btn"
          disabled={selected.length === 0}
          onClick={create}
          className="h-11 w-full rounded-[10px] bg-[#0099FF] text-[15px] font-medium text-white active:opacity-80 disabled:opacity-40"
        >
          创建群聊
        </button>
      </div>
    </div>
  );
}

// ---------------- 群聊信息页 ----------------

export function QqGroupInfoPage({
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
  onUpdate: (patch: Partial<Pick<ChatGroup, 'name' | 'avatar' | 'announcement' | 'memoryInterop' | 'memberIds'>>) => void;
  onDissolve: () => void;
  onToast: (m: string) => void;
}) {
  const [dialog, setDialog] = useState<null | { kind: 'name' | 'announcement' }>(null);
  const [memberSheet, setMemberSheet] = useState<ContactRecord | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDissolve, setConfirmDissolve] = useState(false);
  const [replyCountOpen, setReplyCountOpen] = useState(false);
  const [replyCount, setReplyCount] = useState(() => getReplyCount(sessionKeyOf(group.id)));
  const [sentenceOn, setSentenceOn] = useState(() => getSentenceSend(sessionKeyOf(group.id)));
  const gid = group.id;
  /** 稳定伪群号（仅展示用途，由群 id 哈希生成，同群恒定） */
  const groupNo = useMemo(() => {
    let h = 0;
    for (const ch of group.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return String(100000000 + (h % 900000000));
  }, [group.id]);
  const [flags, setFlags] = useState<ChatFlags>(() => qqChatFlags.get());
  const [timeAwareOn, setTimeAwareOn] = useState(() => getTimeAware(sessionKeyOf(gid)));
  const fileRef = useRef<HTMLInputElement>(null);
  const [bgOpen, setBgOpen] = useState(false);

  // ---- 聊天背景（按群独立：标志在 qqChatFlags 的 group:<gid> 键，图片本体在 IndexedDB；与单聊互不影响） ----
  const rowFlags = flags[qqGroupRowId(gid)];
  const bgMode = rowFlags?.bgMode ?? 'default';
  const bg: ChatSettingsBg = { mode: bgMode, color: rowFlags?.bgColor ?? '' };
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [uploadingBg, setUploadingBg] = useState(false);

  useEffect(() => {
    let alive = true;
    if (bgMode === 'image') {
      void getChatBgImage('qq', `group:${gid}`).then((d) => {
        if (alive) setBgImageUrl(d);
      });
    }
    return () => {
      alive = false;
    };
  }, [bgMode, rowFlags?.bgV, gid]);

  const handlePickBgColor = (c: string) => {
    qqChatFlags.update(qqGroupRowId(gid), { bgMode: 'color', bgColor: c, bgV: Date.now() });
  };
  const handleResetBg = () => {
    void removeChatBgImage('qq', `group:${gid}`).catch(() => undefined);
    qqChatFlags.update(qqGroupRowId(gid), { bgMode: 'default', bgV: Date.now() });
  };
  const handleUploadBg = async (file: File) => {
    setUploadingBg(true);
    try {
      const data = await readImageFile(file, 1280);
      await setChatBgImage('qq', `group:${gid}`, data);
      qqChatFlags.update(qqGroupRowId(gid), { bgMode: 'image', bgV: Date.now() });
      onToast('聊天背景已更新');
    } catch {
      onToast('图片处理失败，请重试');
    } finally {
      setUploadingBg(false);
    }
  };

  const members = useMemo(
    () => group.memberIds.map((id) => contacts.find((c) => c.id === id)).filter((c): c is ContactRecord => !!c),
    [group.memberIds, contacts]
  );
  const candidates = useMemo(
    () => contacts.filter((c) => c.kind !== 'user' && isFriendIn(c, 'qq') && !group.memberIds.includes(c.id)),
    [contacts, group.memberIds]
  );

  useEffect(() => qqChatFlags.subscribe(() => setFlags({ ...qqChatFlags.get() })), []);

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

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#F5F6F7] dark:bg-[#111214]">
      <GroupNavBar title="聊天信息" onBack={onBack} />
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

      {/* 群资料头部卡片（对照真 QQ：大头像 + 群名 + 群号 + 锁定标签） */}
      <div className="mx-3 mt-2 rounded-[12px] bg-white dark:bg-[#1B1C1F]">
        <button
          type="button"
          className="flex w-full items-center gap-3.5 px-4 py-4 text-left active:opacity-70"
          onClick={() => fileRef.current?.click()}
          data-testid="qq-groupinfo-avatar"
        >
          <QqGroupAvatar group={group} contacts={contacts} size={64} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[19px] font-semibold leading-snug">{group.name}</span>
            <span className="mt-1 flex items-center gap-1.5 text-[13px] text-black/45 dark:text-white/45">
              <span className="shrink-0">群号：{groupNo}</span>
              <span className="flex shrink-0 items-center gap-1 rounded-[4px] bg-black/[0.05] px-1.5 py-[2px] text-[10px] text-black/45 dark:bg-white/10 dark:text-white/50">
                <Lock className="h-2.5 w-2.5" />
                不允许被搜索
              </span>
            </span>
          </span>
          <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" />
        </button>
      </div>

      {/* 群成员卡片（对照真 QQ：圆头像瓦片 + 邀请/移除圆形按钮） */}
      <div className="mx-3 mt-2.5 rounded-[12px] bg-white px-4 py-3.5 dark:bg-[#1B1C1F]">
        <div className="mb-3 flex items-center">
          <span className="text-[16px] font-semibold">群成员</span>
          <span className="ml-auto text-[13px] text-black/35 dark:text-white/35">{members.length + 1}人</span>
        </div>
        <div className="flex flex-wrap gap-x-[13px] gap-y-3">
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              className="flex w-[52px] flex-col items-center gap-1"
              onClick={() => setMemberSheet(m)}
              data-testid={`qq-groupinfo-member-${m.id}`}
            >
              <QqAvatar src={m.avatar} alt={memberNameOf(m)} size={48} />
              <span className="max-w-[52px] truncate text-[11px] leading-none text-black/50 dark:text-white/50">
                {memberNameOf(m)}
              </span>
            </button>
          ))}
          <button
            type="button"
            className="flex w-[52px] flex-col items-center gap-1"
            onClick={() => setInviteOpen(true)}
            data-testid="qq-groupinfo-invite"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F0F1F2] dark:bg-white/10">
              <Plus className="h-6 w-6 text-black/45 dark:text-white/50" strokeWidth={1.8} />
            </span>
            <span className="text-[11px] leading-none text-black/50 dark:text-white/50">邀请</span>
          </button>
          {members.length > 0 && (
            <button
              type="button"
              className="flex w-[52px] flex-col items-center gap-1"
              onClick={() => setRemoveOpen(true)}
              data-testid="qq-groupinfo-remove"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F0F1F2] dark:bg-white/10">
                <Minus className="h-6 w-6 text-black/45 dark:text-white/50" strokeWidth={1.8} />
              </span>
              <span className="text-[11px] leading-none text-black/50 dark:text-white/50">移除</span>
            </button>
          )}
        </div>
      </div>

      {/* 群设置 */}
      <div className="mx-3 mt-2.5 divide-y divide-black/[0.05] rounded-[12px] bg-white dark:divide-white/[0.06] dark:bg-[#1B1C1F]">
        <InfoRow label="群聊名称" value={group.name} onClick={() => setDialog({ kind: 'name' })} testId="qq-groupinfo-name" />
        <InfoRow
          label="群公告"
          value={group.announcement ? `${group.announcement.slice(0, 12)}…` : '未设置'}
          onClick={() => setDialog({ kind: 'announcement' })}
          testId="qq-groupinfo-notice"
        />
        <button
          type="button"
          data-testid="qq-groupinfo-bg"
          onClick={() => setBgOpen(true)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05]"
        >
          <span className="shrink-0 text-[15px]">聊天背景</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-[22px] w-[22px] rounded-[5px] border border-black/10 bg-cover bg-center dark:border-white/15"
              style={chatBgLayerStyle(bg, bgImageUrl) ?? { backgroundColor: '#F5F6F7' }}
            />
            <ChevronRight className="h-4 w-4" />
          </span>
        </button>
        <SwitchRow
          label="记忆与私聊互通"
          caption="开启后：群里发生的事，成员在私聊里也记得；成员的私聊记忆也会带进群聊。关闭则完全隔离（按群独立设置）。"
          checked={group.memoryInterop}
          onChange={(v) => {
            onUpdate({ memoryInterop: v });
            onToast(v ? '已开启互通' : '已关闭互通');
          }}
          testId="qq-groupinfo-interop"
        />
      </div>

      {/* 通用开关卡片（回复条数/分句发送/时间感知/置顶/免打扰；均按群独立） */}
      <div className="mx-3 mt-2.5 divide-y divide-black/[0.05] rounded-[12px] bg-white dark:divide-white/[0.06] dark:bg-[#1B1C1F]">
        <InfoRow
          label="回复条数"
          value={`${replyCount} 条`}
          onClick={() => setReplyCountOpen(true)}
          testId="qq-groupinfo-replycount"
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
          testId="qq-groupinfo-sentence"
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
          label="设为置顶"
          checked={flags[qqGroupRowId(gid)]?.pinned === true}
          onChange={(v) => qqChatFlags.update(qqGroupRowId(gid), { pinned: v })}
        />
        <SwitchRow
          label="消息免打扰"
          checked={flags[qqGroupRowId(gid)]?.muted === true}
          onChange={(v) => qqChatFlags.update(qqGroupRowId(gid), { muted: v })}
        />
      </div>

      {/* 危险操作（对照真 QQ：删除聊天记录=蓝、解散群聊=红） */}
      <div className="mx-3 mt-2.5 rounded-[12px] bg-white dark:bg-[#1B1C1F]">
        <button
          type="button"
          data-testid="qq-groupinfo-clear"
          onClick={() => setConfirmClear(true)}
          className="w-full rounded-[12px] px-4 py-[13px] text-left text-[15px] text-[#0099FF] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
        >
          清空聊天记录
        </button>
      </div>
      <div className="mx-3 mt-2.5 rounded-[12px] bg-white dark:bg-[#1B1C1F]">
        <button
          type="button"
          data-testid="qq-groupinfo-dissolve"
          onClick={() => setConfirmDissolve(true)}
          className="w-full rounded-[12px] px-4 py-[13px] text-left text-[15px] text-[#F5455C] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
        >
          解散群聊
        </button>
      </div>
      <div className="py-7 text-center text-[11px] text-black/30 dark:text-white/30">
        群聊为本地模拟，不含任何真实资金操作
      </div>

      {/* 成员操作 */}
      {memberSheet && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setMemberSheet(null)}>
          <div className="w-full rounded-t-[14px] bg-white p-2 pb-6 dark:bg-[#2A2C31]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-3 py-2">
              <QqAvatar src={memberSheet.avatar} alt={memberNameOf(memberSheet)} size={40} />
              <div className="text-[15px]">{memberNameOf(memberSheet)}</div>
            </div>
            <button
              type="button"
              data-testid="qq-groupinfo-remove-member"
              onClick={() => removeMember(memberSheet)}
              className="mt-1 flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[15px] text-[#F5455C] active:bg-black/[0.04] dark:active:bg-white/[0.06]"
            >
              <UserMinus className="h-4 w-4" />
              移出群聊
            </button>
          </div>
        </div>
      )}

      {/* 移除成员（－ 入口） */}
      {removeOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#F5F6F7] dark:bg-[#111214]">
          <GroupNavBar title="移除成员" onBack={() => setRemoveOpen(false)} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-3 mt-2 divide-y divide-black/[0.05] rounded-[12px] bg-white dark:divide-white/[0.06] dark:bg-[#1B1C1F]">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`qq-group-remove-${m.id}`}
                  onClick={() => removeMember(m)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  <QqAvatar src={m.avatar} alt={memberNameOf(m)} size={40} />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{memberNameOf(m)}</span>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/10">
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
        <div className="fixed inset-0 z-50 flex flex-col bg-[#F5F6F7] dark:bg-[#111214]">
          <GroupNavBar title="邀请成员" onBack={() => setInviteOpen(false)} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {candidates.length === 0 ? (
              <div className="px-8 py-20 text-center text-[13px] text-black/40 dark:text-white/40">没有可邀请的 QQ 好友</div>
            ) : (
              <div className="bg-white dark:bg-[#1B1C1F]">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    data-testid={`qq-group-invite-${c.id}`}
                    onClick={() => {
                      const next = addGroupMember(gid, c.id);
                      if (!next) {
                        onToast(`群成员已达上限（${GROUP_MEMBER_CAP} 人）`);
                        return;
                      }
                      onUpdate({ memberIds: next.memberIds });
                      onToast(`已邀请 ${memberNameOf(c)}`);
                      setInviteOpen(false);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.05]"
                  >
                    <QqAvatar src={c.avatar} alt={memberNameOf(c)} size={40} />
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
          text="解散后群聊、聊天记录与群聊记忆将删除，确定解散并退出？"
          onCancel={() => setConfirmDissolve(false)}
          onConfirm={() => {
            setConfirmDissolve(false);
            onDissolve();
          }}
        />
      )}

      {/* 聊天背景页（与单聊同一套 ChatBgPage；按群隔离持久化，与单聊背景互不影响） */}
      {bgOpen && (
        <div className="fixed inset-0 z-50">
          <ChatBgPage
            variant="qq"
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
            variant="qq"
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
    </div>
  );
}

// ---------------- 群聊页 ----------------

/** QQ 风格群红包详情页：红色头 + 领取列表（谁领了多少、手气）+ 过期/专属状态（复用单聊详情页视觉语言） */
function GroupRpDetailPage({
  senderName,
  senderAvatar,
  rp,
  onBack,
  onToast,
}: {
  senderName: string;
  senderAvatar: string | null;
  rp: GroupRpData;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  const claimedSum = round2(rp.claims.reduce((s, c) => s + c.amount, 0));
  const best = rp.claims.length > 1 ? rp.claims.reduce((a, b) => (b.amount > a.amount ? b : a)) : null;
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white" data-testid="qq-grp-rp-detail">
      <div className="relative shrink-0 bg-[#F5455C] pt-[54px] text-white">
        <div className="relative flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="qq-grp-rp-detail-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <div className="flex-1 pr-8 text-center text-[16px] font-medium">红包详情</div>
        </div>
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-full h-[26px] w-[140%] -translate-x-1/2 rounded-[50%] bg-[#F5F6F8] dark:bg-[#16171A]"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto pt-12">
        <div className="flex items-center gap-2.5">
          <span className="rounded-full border-2 border-[#F0C87E]/85 p-[2px]">
            <QqAvatar src={senderAvatar} alt={senderName} size={40} />
          </span>
          <span className="text-[19px] font-medium" data-testid="qq-grp-rp-detail-title">
            {senderName}的红包
          </span>
        </div>
        <p className="mt-2 text-[14px] text-black/45 dark:text-white/45">{rp.blessing}</p>
        <p className="mt-1.5 text-[13px] text-[#D8A244]" data-testid="qq-grp-rp-detail-status">
          {rp.mode === 'exclusive' && rp.targetName ? `专属红包 · 只给${rp.targetName} · ` : ''}
          {groupRpStateLabel(rp)}
        </p>
        <p className="mt-7 font-semibold text-[#D8A244]" data-testid="qq-grp-rp-detail-amount">
          <span className="text-[44px] leading-none">{fmtMoney(groupRpTotal(rp.mode, rp.amount, rp.count))}</span>
          <span className="ml-1.5 text-[19px]">元</span>
        </p>

        <div className="mt-8 w-[88%] max-w-[360px] rounded-[12px] bg-white dark:bg-[#232529]" data-testid="qq-grp-rp-claim">
          <p className="px-4 pb-2 pt-3.5 text-[12px] text-black/40 dark:text-white/40" data-testid="qq-grp-rp-claim-caption">
            {rp.count}个红包共{fmtMoney(groupRpTotal(rp.mode, rp.amount, rp.count))}元，已领取{rp.claims.length}/{rp.count}
            {rp.expired ? `，已退回${fmtMoney(round2(groupRpTotal(rp.mode, rp.amount, rp.count) - claimedSum))}元` : ''}
          </p>
          {rp.claims.length > 0 ? (
            <div className="pb-2">
              {rp.claims.map((c, i) => (
                <div key={`${c.contactId}-${i}`} className="flex items-center gap-3 border-t border-black/[0.05] px-4 py-3 dark:border-white/[0.06]">
                  <QqAvatar src={c.avatar} alt={c.name} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">
                      {c.name}
                      {best && best.amount === c.amount && best.ts === c.ts ? <span className="ml-1 text-[11px] text-[#D8A244]">手气最佳</span> : null}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-black/35 dark:text-white/35">{fmtGrpFullTime(c.ts || Date.now())}</span>
                  </span>
                  <span className="shrink-0 text-[15px] font-medium text-[#D8A244]">¥{fmtMoney(c.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 pb-8 pt-6 text-center text-[13px] text-black/30 dark:text-white/30">
              {rp.expired ? '红包已过期，未领取金额已退回发起人' : '等待领取…'}
            </p>
          )}
        </div>
        <button type="button" onClick={() => onToast('红包记录暂未开放')} className="mt-5 text-[13px] text-[#0099FF] active:opacity-60">
          查看领取记录 &gt;
        </button>
      </div>
    </div>
  );
}

/** QQ 风格群转账详情页：转账给群里某位成员 + 收款/退回/拒收状态（复用单聊详情页视觉语言） */
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
    <div className="absolute inset-0 z-50 flex flex-col bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white" data-testid="qq-grp-tr-detail">
      <div className="shrink-0 bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]">
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" data-testid="qq-grp-tr-detail-back" onClick={onBack} className="active:opacity-60">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <div className="flex-1 pr-8 text-center text-[16px] font-medium">转账详情</div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pt-8">
        <div className="w-full max-w-[380px] rounded-[16px] bg-white px-5 py-6 dark:bg-[#232529]" data-testid="qq-grp-tr-detail-card">
          <div className="flex items-center gap-3.5">
            <span
              className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full"
              style={{ background: 'linear-gradient(135deg, #29ABF2, #0099FF)' }}
              aria-hidden="true"
            >
              <ArrowLeftRight className="h-6 w-6 text-white" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[25px] font-semibold leading-tight" data-testid="qq-grp-tr-detail-amount">¥{fmtMoney(tr.amount)}</p>
              <p className="mt-0.5 truncate text-[13px] text-black/45 dark:text-white/45" data-testid="qq-grp-tr-detail-status">
                {tr.received ? `${tr.toName}已收款` : status === '已退回' ? '已退回' : status === '已拒收' ? '已拒收' : `待${tr.toName}收款`}
              </p>
            </div>
          </div>
          {tr.note ? <p className="mt-4 border-t border-black/[0.05] pt-3 text-[14px] text-black/70 dark:border-white/[0.06] dark:text-white/70">留言：{tr.note}</p> : null}
          <div className="mt-4 space-y-2.5 border-t border-black/[0.05] pt-3 text-[13px] dark:border-white/[0.06]">
            <p className="flex justify-between">
              <span className="text-black/40 dark:text-white/40">转账人</span>
              <span>{fromName}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-black/40 dark:text-white/40">收款成员</span>
              <span data-testid="qq-grp-tr-detail-to">{tr.toName}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-black/40 dark:text-white/40">状态</span>
              <span>{status}</span>
            </p>
          </div>
        </div>
        <p className="pt-6 text-center text-[12px] text-black/35 dark:text-white/35">群里其他成员只看到转账卡片，无法操作这笔转账</p>
      </div>
    </div>
  );
}

/**
 * 群聊页。群回合引擎（多角色顺序流式回复）：
 * - runningRef 防重入；每个角色 await 一次 beginChatStream→finalize 的完整回合；
 * - 流式气泡头像/名字由 groupSpeaker 模块级 map 提供（页面中途退出重进也能对上发言角色）；
 * - finalize 里 loadGroupMsgs→append→saveGroupMsgs（组件卸载后照样落盘）+ 未读 + 记忆提取；
 * - 谁来回复按人设自判：被 @ 成员必答优先，其余成员逐个自判（[SKIP] 回复不落盘）；
 */
let activeGroupKey: string | null = null;
const groupSpeaker = new Map<string, string>();

export function QqGroupChatPage({
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
  onUpdate: (patch: Partial<Pick<ChatGroup, 'name' | 'memberIds' | 'memoryInterop'>>) => void;
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
  const [stickerOpen, setStickerOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [compose, setCompose] = useState<'location' | null>(null);
  // 群红包/转账浮层流程：发红包页（复用单聊 RedPacketCompose）/ 转账选人页→转账页（复用单聊 TransferCompose）/ 开箱 / 详情
  const [layer, setLayer] = useState<
    | null
    | { view: 'rp-compose' }
    | { view: 'tr-pick' }
    | { view: 'tr-compose'; member: ContactRecord }
    | { view: 'rp-open'; msgId: string }
    | { view: 'rp-detail'; msgId: string }
    | { view: 'tr-detail'; msgId: string }
  >(null);
  // 支付密码验证中的支付（与单聊同规则）
  const [gate, setGate] = useState<null | { kind: 'redpacket' | 'transfer'; label: string; amount: number; methodId: string; packet?: MsgPacket; tr?: { member: ContactRecord; amount: number; note: string } }>(null);
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
  // 编辑消息（长按菜单「编辑」）：弹窗改文本后写回该条消息并落盘
  const [editMsg, setEditMsg] = useState<WxGroupMsg | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // 多选模式：勾选消息批量删除/转发/收藏（与单聊同套交互）
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 转发流程：多选底栏「分享」→ 逐条/合并 → 选目标会话（QQ 好友/自己/其他 QQ 群）
  const [fwdFlow, setFwdFlow] = useState<'choose' | 'target' | null>(null);
  const [fwdMode, setFwdMode] = useState<FwdMode>('each');
  // 合并转发「聊天记录」详情页（点卡片打开）
  const [fwdDetailId, setFwdDetailId] = useState<string | null>(null);
  // 聊天背景（按群独立：标志在 qqChatFlags 的 group:<gid> 键，图片本体在 IndexedDB；与单聊互不影响）
  const [flags, setFlags] = useState<ChatFlags>(() => qqChatFlags.get());
  useEffect(() => qqChatFlags.subscribe(() => setFlags({ ...qqChatFlags.get() })), []);
  const bgMode = flags[qqGroupRowId(gid)]?.bgMode ?? 'default';
  const bg: ChatSettingsBg = { mode: bgMode, color: flags[qqGroupRowId(gid)]?.bgColor ?? '' };
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (bgMode === 'image') {
      void getChatBgImage('qq', `group:${gid}`).then((d) => {
        if (alive) setBgImageUrl(d);
      });
    }
    return () => {
      alive = false;
    };
  }, [bgMode, flags[qqGroupRowId(gid)]?.bgV, gid]);

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
        qqUnreads.bump(qqGroupRowId(gid), 1);
      }
    },
    [gid, sKey]
  );

  /** 就地更新一条群消息的附加数据（红包/转账状态流转用）：读改写存储 + 页面存活时同步 state */
  const patchGroupMsg = useCallback(
    (mid: string, patch: Partial<Pick<WxGroupMsg, 'rp' | 'tr' | 'recalled' | 'content'>>) => {
      const next = loadGroupMsgs(gid).map((m) => (m.id === mid ? { ...m, ...patch } : m));
      saveGroupMsgs(gid, next);
      if (mountedRef.current) setMsgs(next);
    },
    [gid]
  );

  /** 过期清算：发出超 24h 仍有剩余的红包 → 标记已过期（终态），剩余金额退回发起人（机主发起 → 退回钱包+写账单） */
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
        gainToWallet(remaining, '红包过期退回');
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
    if (m.kind === 'forward') {
      return m.fwd?.merged
        ? `[聊天记录：${(m.fwd.records ?? []).slice(-8).map((r) => `${r.name}：${r.text}`).join(' ／ ')}]`
        : `[转发] ${m.content}`;
    }
    return m.content;
  };

  /** 消息的可复制/引用文本快照（长按菜单复制、引用、转发占位、收藏共用） */
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
              : m.kind === 'forward'
                ? m.fwd?.merged
                  ? `[聊天记录] ${m.fwd.title ?? m.content}`
                  : `[转发] ${m.content}`
                : m.content;

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

  /** 应用成员对群红包/转账的处理动作（领取/收款/退回/拒收；幂等，状态流转后不可重复处理） */
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
          gainToWallet(tr.amount, '转账退回');
          appendFundNotice('tr', `${charName}退回了你的`, '转账');
        } else {
          patchGroupMsg(m.id, { tr: { ...tr, status: 'rejected' } });
          appendFundNotice('tr', `${charName}拒收了你的`, '转账');
        }
      }
    },
    [appendFundNotice, gid, patchGroupMsg]
  );

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
        // 上下文映射：自己 → assistant；机主/其他成员 → 「发言者：内容」user 消息（富媒体按占位文本；
        // 任何成员引用了别的消息都带「（引用 名字：「内容」）」前缀，群里 AI 也能理解引用关系）
        const history: ChatPayloadMessage[] = ctxMsgs.map((m): ChatPayloadMessage => {
          const quoted = m.quote ? `（引用 ${m.quote.name}：「${m.quote.content}」）` : '';
          if (m.role === 'me') {
            return { role: 'user', content: `${meName}：${quoted}${msgTextOf(m)}` };
          }
          if (m.senderId === char.id) return { role: 'assistant', content: `${quoted}${msgTextOf(m)}` };
          return { role: 'user', content: `${m.senderName || '成员'}：${quoted}${msgTextOf(m)}` };
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
          '不要刷屏：每个话题只说一两句就够，没新内容不要为了说话而说话；需要连发多条时也只说值得说的话，绝不硬凑条数，更不要在别人正在说话时抢话打断。',
          '【隐私边界】其他成员私下告诉你的事、或你只在私聊里知道的私密内容，绝不在群里说出去；同理不替其他成员公开他们的秘密；别人之间有分歧时不搬弄是非、不传话挑事。',
          '群里的红包、转账都是真实卡片：谁发了什么、谁领了/收了，以卡片和系统通知为准；没有对应卡片或通知时，绝不凭空说自己发过或收到过钱。',
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
          channel: 'QQ',
          userName: meName,
          ownerName: ownerLabelOf(char),
          ...npcExtra,
          extraRules: groupRules,
        });
        // 记忆（按角色隔离 + 群级互通开关）：mode='group' → 本群记忆 + 互通开启时的自己私聊记忆
        const memoryBlock = memRecallBlock(char.id, 'qq', memContext, {
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
            // 文字块按边界切分（回复条数>1 时一句一条）后再解析 [红包:…] 标记 → 群红包卡片消息
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
                        blessing: p.rich.blessing || '恭喜发财',
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
                  'qq',
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
   *  trigger 可省略（分句发送批次触发/红包/转账卡片入群时无文字可 @）：此时全员按人设自判。
   *  兜底约定（异常与边界）：全员都 [SKIP] 时不落盘不提示（真实群聊发消息也可能没人接）；
   *  单条回复为空时 finalize 已有占位兜底；群已解散/无成员时静默返回。 */
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
    // 分句发送开启：只入列不触发回复，等输入框为空再点一次「发送」统一触发
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
    // 分句发送开启：只入列不触发回复（与文字消息同规则）
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

  /** 发送位置卡片消息（内置地点/自定义位置；群里所有角色都能看到） */
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

  // ---------------- 群红包/转账（纯本地模拟，不涉及真实资金；复用单聊同一套页面/卡片组件） ----------------

  /** 群红包提交（单聊 RedPacketCompose 群模式产出 MsgPacket）：换算成群红包数据 → 预检/验证/扣款 → 落卡消息 → 群回合 */
  const submitGroupRp = (p: MsgPacket, methodId: string) => {
    if (p.type !== 'redpacket') return;
    const mode: GroupRpData['mode'] = p.mode === 'dedicated' ? 'exclusive' : p.mode ?? 'normal';
    const total = groupRpTotal(mode, p.amount, p.count ?? 1);
    if (!canPay(methodId, total)) {
      onToast(methodId === 'balance' ? '钱包余额不足，请先充值' : '卡内余额不足，请更换支付方式');
      return;
    }
    const pp = loadPayPwd();
    if (pp.enabled && pp.pwd) {
      setGate({ kind: 'redpacket', label: '发红包', amount: total, methodId, packet: p });
      return;
    }
    execGroupRp(p, methodId);
  };

  const execGroupRp = (p: MsgPacket, methodId: string) => {
    if (p.type !== 'redpacket') return;
    const mode: GroupRpData['mode'] = p.mode === 'dedicated' ? 'exclusive' : p.mode ?? 'normal';
    const total = groupRpTotal(mode, p.amount, p.count ?? 1);
    if (!executePayment(methodId, total, '红包')) {
      onToast(methodId === 'balance' ? '钱包余额不足，请先充值' : '余额不足，请更换支付方式');
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
        count: mode === 'exclusive' ? 1 : p.count ?? 1,
        mode,
        blessing: p.note || '恭喜发财',
        targetId: mode === 'exclusive' ? p.toId : undefined,
        targetName: mode === 'exclusive' ? p.toName : undefined,
        claims: [],
        sentAt: Date.now(),
        cid: nextGroupCid('rp'),
      },
    };
    setLayer(null);
    appendMsg(msg);
    onToast(mode === 'exclusive' && p.toName ? `专属红包已发给${p.toName}` : `红包已发出 ${fmtMoney(total)} 元`);
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    void runGroupTurn(msg);
  };

  const execGroupTr = (amount: number, note: string, member: ContactRecord, methodId: string) => {
    if (!executePayment(methodId, amount, '转账')) {
      onToast(methodId === 'balance' ? '钱包余额不足，请先充值' : '余额不足，请更换支付方式');
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

  /** 我领取成员发的红包（开箱「開」）：金额入钱包+记账单+领取记录+通知行 → 进详情；专属红包只给被指定成员 */
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
    gainToWallet(amt, '红包');
    appendFundNotice('rp', `你领取了${m.senderId === 'me' ? '自己发的' : m.senderName || '群友'}的`, '红包');
    setLayer({ view: 'rp-detail', msgId });
  };

  /** 红包卡片点击：成员发的未领完且我能领 → 先开箱；其余直接进详情 */
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

  // 加号面板五宫格（与单聊完全一致的入口与配色；红包/转账 → 群级流程：发红包页 / 先选收款成员）
  const plusItems: Array<{ key: string; label: string; color: string; icon: React.ReactNode; onClick: () => void }> = [
    { key: 'call', label: '语音通话', color: '#2FBF71', icon: <Phone className="h-[26px] w-[26px]" strokeWidth={1.9} />, onClick: () => onToast('语音通话暂未开放') },
    { key: 'video', label: '视频通话', color: '#1B9FF0', icon: <Video className="h-[26px] w-[26px]" strokeWidth={1.9} />, onClick: () => onToast('视频通话暂未开放') },
    {
      key: 'rp',
      label: '红包',
      color: '#F5455C',
      icon: <RpIcon className="h-[26px] w-[26px]" />,
      onClick: () => {
        setStickerOpen(false);
        setAtOpen(false);
        setPlusOpen(false);
        setLayer({ view: 'rp-compose' });
      },
    },
    {
      key: 'transfer',
      label: '转账',
      color: '#12B7F5',
      icon: <ArrowLeftRight className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      onClick: () => {
        setStickerOpen(false);
        setAtOpen(false);
        setPlusOpen(false);
        if (members.length === 0) {
          onToast('群里还没有成员');
          return;
        }
        setLayer({ view: 'tr-pick' });
      },
    },
    {
      key: 'loc',
      label: '位置',
      color: '#F0605C',
      icon: <MapPin className="h-[26px] w-[26px]" strokeWidth={1.9} />,
      onClick: () => {
        setStickerOpen(false);
        setAtOpen(false);
        setPlusOpen(false);
        setCompose('location');
      },
    },
  ];

  // ---------------- 长按气泡菜单：复制/删除/编辑/引用/多选/撤回/转发/收藏/重新生成（与单聊完全一致） ----------------

  /** 消息是否可长按弹菜单 / 多选勾选（通知行与已撤回行除外） */
  const isSelectable = (m: WxGroupMsg): boolean => m.kind !== 'notice' && !m.recalled;

  /** 按发送方与消息类型组装长按菜单项（与单聊同构：我的/AI 气泡都可 复制 删除 编辑 引用 多选 撤回 转发 收藏；
   *  AI 气泡多一个重新生成；已收藏的消息显示「已收藏」） */
  const buildMsgMenuItems = (m: WxGroupMsg): BubbleMenuItem[] => {
    const B = BUBBLE_MENU_ICONS;
    const isText = !m.kind || m.kind === 'text';
    const items: BubbleMenuItem[] = [{ key: 'copy', label: '复制', icon: B.copy }];
    items.push({ key: 'del', label: '删除', icon: B.del, danger: true });
    if (isText) items.push({ key: 'edit', label: '编辑', icon: B.edit });
    if (isText) items.push({ key: 'quote', label: '引用', icon: B.quote });
    items.push({ key: 'multi', label: '多选', icon: B.multi });
    items.push({ key: 'recall', label: '撤回', icon: B.recall });
    items.push({ key: 'forward', label: '转发', icon: B.forward });
    items.push({ key: 'fav', label: isMsgFavorited('qq', m.id) ? '已收藏' : '收藏', icon: B.fav, filled: isMsgFavorited('qq', m.id) });
    if (m.role === 'peer') items.push({ key: 'regen', label: '重新生成', icon: B.regen });
    return items;
  };

  const menuMsg = menu ? msgs.find((m) => m.id === menu.mid) ?? null : null;

  /** 气泡长按手势（fire 里用 data-mid 反查消息并现场组装菜单项；多选模式下不弹菜单改为点选勾选）。
   *  onClickCapture 单独解出：多选模式下行级勾选拦截优先，普通模式沿用长按的点击拦截 */
  const { onClickCapture: pressClickCapture, ...pressHandlers } = useBubbleLongPress((el) => {
    const mid = el.closest('[data-mid]')?.getAttribute('data-mid') ?? null;
    const msg = mid ? msgs.find((x) => x.id === mid) ?? null : null;
    if (!msg || !isSelectable(msg)) return;
    const items = buildMsgMenuItems(msg);
    if (items.length === 0) return;
    setMenuRect(computeBubbleMenuPos(el.getBoundingClientRect(), listRef.current?.getBoundingClientRect() ?? null, items.length));
    setMenu({ mid: msg.id });
  }, !selectMode);
  const bubblePress = pressHandlers;
  const [menuRect, setMenuRect] = useState<ReturnType<typeof computeBubbleMenuPos> | null>(null);

  /** 退出多选模式（同时退出转发流程） */
  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelectedIds([]);
    setFwdFlow(null);
  }, []);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** 收藏项快照（单条收藏/批量收藏共用；msgId 用于「每条消息只能收藏一次」去重）：
   *  来源会话 = 群本身（contactId = 群 id / 名字 = 群名），内容带发言人前缀保留「谁说的」 */
  const favOf = (m: WxGroupMsg): Omit<MsgFavorite, 'id' | 'app' | 'savedAt'> => ({
    contactId: gid,
    contactName: group.name,
    contactAvatar: group.avatar,
    msgRole: m.role,
    kind: m.kind ?? 'text',
    content: `${m.role === 'me' ? me.name : m.senderName || '群友'}：${msgSnapshotOf(m)}`,
    msgId: m.id,
    imgSrc: m.kind === 'image' ? m.img?.src : undefined,
    stkUrl: m.kind === 'sticker' ? m.stk?.url : undefined,
    time: m.time,
  });

  /** 重新生成（仅 AI 气泡）：只删除该条成员回复（不影响其他成员的消息），以剩余历史重新请求该角色生成 */
  const regenerate = (m: WxGroupMsg) => {
    if (runningRef.current || isChatStreaming(sKey)) {
      onToast('成员们还在回复，稍等一下');
      return;
    }
    const char = memberById.get(m.senderId) ?? contactsRef.current.find((c) => c.id === m.senderId) ?? null;
    if (!char) {
      onToast('该成员已不在群里');
      return;
    }
    const next = loadGroupMsgs(gid).filter((x) => x.id !== m.id);
    saveGroupMsgs(gid, next);
    if (mountedRef.current) setMsgs(next);
    window.setTimeout(() => {
      groupSpeaker.set(sKey, char.id);
      if (mountedRef.current) setSpeakerId(char.id);
      void runCharTurn(char, false, []).finally(() => {
        groupSpeaker.delete(sKey);
        if (mountedRef.current) setSpeakerId(null);
      });
    }, 80);
  };

  // ---------------- 转发（与单聊同流程：多选勾选 → 逐条/合并 → 选目标会话） ----------------

  /** 转发目标：QQ 好友 + 自己（单聊目标）+ 其他 QQ 群（同宿主 App；与单聊/其他群的数据隔离不变） */
  const forwardTargets = useMemo<Array<FwdSheetTarget & { kind: 'contact' | 'group' }>>(() => {
    const self = contacts.find((c) => c.id === me.id);
    const contactList: Array<FwdSheetTarget & { kind: 'contact' | 'group' }> = contacts
      .filter((c) => c.kind !== 'user' && c.id !== me.id && isFriendIn(c, 'qq'))
      .map((c) => ({ id: c.id, name: displayNameOf(c), avatar: c.avatar, kind: 'contact' }));
    if (self) contactList.unshift({ id: self.id, name: displayNameOf(self), avatar: self.avatar, self: true, kind: 'contact' });
    const groupList = listGroups('qq')
      .filter((g) => g.id !== gid)
      .map((g) => ({ id: g.id, name: g.name, avatar: g.avatar, kind: 'group' as const }));
    return [...contactList, ...groupList];
  }, [contacts, me.id, gid]);

  /** 群内克隆（转发到另一个群）：文本 → 转发卡片；表情/图片/位置 → 同类型消息；合并卡片原样保留；红包/转账 → 占位文本卡片（不克隆活卡，不动资金） */
  const groupForwardClone = (m: WxGroupMsg): WxGroupMsg => {
    const base = { id: uid(), role: 'me' as const, senderId: 'me', senderName: me.name, time: Date.now() };
    if (m.fwd?.merged) return { ...base, content: m.content, kind: 'forward', fwd: { from: m.fwd.from, merged: true, title: m.fwd.title, records: m.fwd.records } };
    if (m.kind === 'sticker' && m.stk) return { ...base, content: '', kind: 'sticker', stk: { url: m.stk.url, meaning: m.stk.meaning } };
    if (m.kind === 'image' && m.img) return { ...base, content: '', kind: 'image', img: { ...m.img } };
    if (m.kind === 'location' && m.loc) return { ...base, content: '', kind: 'location', loc: { ...m.loc } };
    const isCard = m.kind === 'redpacket' || m.kind === 'transfer';
    return { ...base, content: isCard ? msgSnapshotOf(m) : m.content, kind: 'forward', fwd: { from: group.name }, quote: m.quote };
  };

  /** 单聊克隆（转发到 QQ 好友/自己）：产出 qq.tsx QQMsg 兼容对象（新 id、role=me、保留引用；QQ 位置字段为 addr） */
  const singleForwardClone = (m: WxGroupMsg): QqSingleMsgShape => {
    const base = { id: uid(), role: 'me' as const, time: Date.now() };
    if (m.fwd?.merged) return { ...base, content: m.content, kind: 'forward', fwd: { from: m.fwd.from, merged: true, title: m.fwd.title, records: m.fwd.records } };
    if (m.kind === 'sticker' && m.stk) return { ...base, content: '', kind: 'sticker', stk: { url: m.stk.url, meaning: m.stk.meaning } };
    if (m.kind === 'image' && m.img) return { ...base, content: m.img.src, kind: 'image' };
    if (m.kind === 'location' && m.loc) return { ...base, content: '', kind: 'location', loc: { name: m.loc.name, addr: m.loc.address } };
    const isCard = m.kind === 'redpacket' || m.kind === 'transfer';
    return { ...base, content: isCard ? msgSnapshotOf(m) : m.content, kind: 'forward', fwd: { from: group.name }, quote: m.quote };
  };

  /** 合并转发的对话快照（群内/单聊目标共用；记录定格原说话人头像与富媒体） */
  const mergedRecordsOf = (list: WxGroupMsg[]): GroupFwdRecord[] =>
    list.map((m) => ({
      name: m.role === 'me' ? me.name : m.senderName || '群友',
      role: m.role,
      text: msgSnapshotOf(m),
      quote: m.quote ? `${m.quote.name}：${m.quote.content}` : undefined,
      time: m.time,
      avatar: m.role === 'me' ? me.avatar : memberById.get(m.senderId)?.avatar ?? null,
      kind: m.kind === 'sticker' ? ('sticker' as const) : m.kind === 'image' ? ('image' as const) : ('text' as const),
      imgSrc: m.kind === 'sticker' ? m.stk?.url : m.kind === 'image' ? m.img?.src : undefined,
      stkMeaning: m.kind === 'sticker' ? m.stk?.meaning : undefined,
    }));

  /** 执行转发（逐条/合并；目标 = QQ 好友/自己 或 其他 QQ 群）：
   *  单聊目标写 qq-chat-msgs 存储（与单聊同键）+ 未读角标 + AI 感知事件；群目标写目标群消息库 + 未读角标 */
  const doForward = (mode: FwdMode, ids: string[], target: FwdSheetTarget & { kind: 'contact' | 'group' }) => {
    const list = msgs.filter((m) => ids.includes(m.id));
    if (list.length === 0) return;
    if (target.kind === 'group') {
      if (target.id === gid) return;
      const title = fwdRecordTitle(me.name, group.name);
      const clones =
        mode === 'each'
          ? list.map(groupForwardClone)
          : [
              {
                id: uid(),
                role: 'me' as const,
                senderId: 'me',
                senderName: me.name,
                content: title,
                time: Date.now(),
                kind: 'forward' as const,
                fwd: { from: group.name, merged: true, title, records: mergedRecordsOf(list) },
              },
            ];
      saveGroupMsgs(target.id, [...loadGroupMsgs(target.id), ...clones]);
      qqUnreads.bump(qqGroupRowId(target.id), clones.length);
    } else {
      if (mode === 'each') {
        saveQqSingleMsgs(target.id, [...loadQqSingleMsgs(target.id), ...list.map(singleForwardClone)]);
      } else {
        const title = fwdRecordTitle(me.name, group.name);
        const card: QqSingleMsgShape = {
          id: uid(),
          role: 'me',
          content: title,
          time: Date.now(),
          kind: 'forward',
          fwd: { from: group.name, merged: true, title, records: mergedRecordsOf(list) },
        };
        saveQqSingleMsgs(target.id, [...loadQqSingleMsgs(target.id), card]);
      }
      qqUnreads.bump(target.id, mode === 'each' ? list.length : 1);
      if (target.id !== me.id) {
        const lines = list
          .slice(-8)
          .map((m) => `${m.role === 'me' ? me.name : m.senderName || '群友'}：${msgSnapshotOf(m)}`)
          .join(' ／ ')
          .slice(0, 240);
        pushQqAiEvent(
          target.id,
          `（系统事件：用户把来自「${group.name}」群聊的 ${list.length} 条消息${mode === 'merge' ? '合并转发' : '逐条转发'}给你了：${lines}。请用符合人设的一两句话自然回应这条转发。）`
        );
      }
    }
    setFwdFlow(null);
    exitSelect();
    onToast(target.self ? '已转发给自己' : `已转发给 ${target.name}`);
  };

  /** 从群记录里移除消息（单条删除/批量删除共用；只动选中的消息，不碰其他成员的消息） */
  const removeMsgs = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const set = new Set(ids);
      const next = loadGroupMsgs(gid).filter((m) => !set.has(m.id));
      saveGroupMsgs(gid, next);
      if (mountedRef.current) setMsgs(next);
    },
    [gid]
  );

  /** 长按菜单动作分发（执行后关闭菜单；与单聊 handleMenuAction 同构） */
  const onMenuSelect = (key: string) => {
    const m = menuMsg;
    setMenu(null);
    setMenuRect(null);
    if (!m) return;
    switch (key) {
      case 'copy':
        copyText(msgSnapshotOf(m), onToast);
        break;
      case 'del': {
        if (runningRef.current || isChatStreaming(sKey)) {
          onToast('成员们还在回复，稍等一下');
          return;
        }
        removeMsgs([m.id]);
        onToast('已删除');
        break;
      }
      case 'edit':
        setEditMsg(m);
        setEditDraft(m.content);
        break;
      case 'quote':
        // 群聊引用带发言人：显示引用的是谁的消息
        setQuote({ name: m.role === 'me' ? '我' : m.senderName || '群友', content: msgSnapshotOf(m) });
        requestAnimationFrame(() => inputRef.current?.focus());
        break;
      case 'multi':
        setAtOpen(false);
        setStickerOpen(false);
        setPlusOpen(false);
        setSelectMode(true);
        setSelectedIds([m.id]);
        break;
      case 'recall': {
        if (runningRef.current || isChatStreaming(sKey)) {
          onToast('成员们还在回复，稍等一下');
          return;
        }
        patchGroupMsg(m.id, { recalled: true });
        onToast('已撤回');
        break;
      }
      case 'forward':
        // 转发 → 进入聊天内多选勾选（该条预选）；点底栏「分享」图标后才弹出 逐条/合并 转发方式（与单聊一致）
        setAtOpen(false);
        setStickerOpen(false);
        setPlusOpen(false);
        setSelectMode(true);
        setSelectedIds([m.id]);
        break;
      case 'fav':
        // 收藏 toggle：首点收藏（toast 收藏成功）；已收藏再点 → 取消收藏（收藏页同步移除）
        if (isMsgFavorited('qq', m.id)) {
          unfavoriteMsg('qq', m.id);
          onToast('取消收藏');
          break;
        }
        addFavorite('qq', favOf(m));
        onToast('收藏成功');
        break;
      case 'regen':
        regenerate(m);
        break;
    }
  };

  /** 编辑保存：更新该条消息内容（quote 等字段保留），自动落盘 */
  const saveEdit = () => {
    const t = editDraft.trim();
    if (!editMsg) return;
    if (!t) {
      onToast('内容不能为空');
      return;
    }
    if (runningRef.current || isChatStreaming(sKey)) {
      onToast('成员们还在回复，稍等一下');
      return;
    }
    patchGroupMsg(editMsg.id, { content: t });
    setEditMsg(null);
    onToast('已修改');
  };

  /** 多选批量删除 */
  const batchDelete = () => {
    if (selectedIds.length === 0) return;
    if (runningRef.current || isChatStreaming(sKey)) {
      onToast('成员们还在回复，稍等一下');
      return;
    }
    removeMsgs(selectedIds);
    onToast(`已删除 ${selectedIds.length} 条消息`);
    exitSelect();
  };

  /** 多选批量收藏（已收藏过的消息自动跳过） */
  const batchFav = () => {
    const list = msgs.filter((x) => selectedIds.includes(x.id));
    if (list.length === 0) return;
    const fresh = list.filter((m) => !isMsgFavorited('qq', m.id));
    if (fresh.length === 0) {
      onToast('所选消息均已收藏');
      exitSelect();
      return;
    }
    for (const m of fresh) addFavorite('qq', favOf(m));
    onToast(fresh.length === list.length ? `已收藏 ${fresh.length} 条消息` : `已收藏 ${fresh.length} 条（${list.length - fresh.length} 条已收藏过）`);
    exitSelect();
  };

  /** 多选批量转发（进入聊天内勾选模式，可继续增删、选逐条/合并） */
  const batchForward = () => {
    if (selectedIds.length === 0) return;
    setFwdFlow('choose');
  };

  const speaker = speakerId ? memberById.get(speakerId) ?? null : null;
  const streaming = stream?.status === 'streaming';

  /** 空输入时可点「发送」触发批次回复（分句发送开启且有未回复的批次） */
  const canDispatch = sentenceSend && pendingDispatch && !streaming && !runningRef.current;
  const layerMsg = layer && 'msgId' in layer ? msgs.find((m) => m.id === layer.msgId) ?? null : null;

  /** 富媒体消息行（图片/位置/表情包）：与文字行同一套头像/名字/宽度几何；多选模式下行首插入勾选圈 */
  const renderMsgRow = (m: WxGroupMsg, media: React.ReactNode) => {
    const mine = m.role === 'me';
    const sender = mine ? null : m.senderId === 'unknown' ? null : memberById.get(m.senderId) ?? null;
    const senderAvatar = mine ? me.avatar : sender?.avatar ?? null;
    return (
      <div className={`mb-3 flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
        {selectMode && isSelectable(m) && (
          <span
            aria-hidden="true"
            data-testid={`qq-grp-select-${m.id}`}
            className={`mt-2.5 flex h-[20px] w-[20px] shrink-0 self-start items-center justify-center rounded-full border ${
              fwdFlow === 'choose' && mine ? 'order-last' : ''
            } ${selectedIds.includes(m.id) ? 'border-[#0099FF] bg-[#0099FF] text-white' : 'border-black/25 dark:border-white/35'}`}
          >
            {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
          </span>
        )}
        <QqAvatar src={senderAvatar} alt={mine ? me.name : m.senderName} size={40} />
        <div className={`flex min-w-0 max-w-[72%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
          {!mine && <span className="mb-0.5 px-1 text-[12px] leading-none text-black/45 dark:text-white/45">{m.senderName}</span>}
          {media}
        </div>
      </div>
    );
  };

  return (
    <div className="relative flex h-full flex-col bg-[#F5F6F7] dark:bg-[#111214]">
      {/* 面板上浮动画（加号/表情面板，与单聊共用同一套 keyframes） */}
      <style>{'@keyframes qqPanelIn{from{transform:translateY(65%);opacity:.35}to{transform:translateY(0);opacity:1}}'}</style>
      {/* 聊天背景层（聊天信息页设置：纯色/图片；顶栏与输入栏自身有底色，不受影响；按群独立，与单聊互不影响） */}
      {bg.mode !== 'default' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0" style={chatBgLayerStyle(bg, bgImageUrl)} />
      )}
      {/* 顶栏（对照 QQ 私聊同款：返回 + 群名/人数 + 菜单）；多选模式下变为「取消 + 已选计数」操作栏（与单聊一致） */}
      <div className="relative z-10 shrink-0 bg-[#F5F6F7] pt-[54px] dark:bg-[#111214]">
        {selectMode ? (
          <div className="flex h-12 items-center px-2">
            <button type="button" data-testid="qq-grp-select-cancel" onClick={exitSelect} className="flex items-center px-1 text-[16px] active:opacity-50">
              取消
            </button>
            <div className="flex flex-1 items-center justify-center">
              <span data-testid="qq-grp-select-count" className="text-[17px] font-semibold">
                {fwdFlow === 'choose' ? '已选择' : '已选'} {selectedIds.length} 条消息
              </span>
            </div>
            {fwdFlow === 'choose' ? (
              <button
                type="button"
                aria-label="搜索"
                data-testid="qq-grp-fwd-search"
                onClick={() => onToast('搜索转发消息暂未开放')}
                className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5 dark:active:bg-white/10"
              >
                <Search className="h-[19px] w-[19px] text-black/70 dark:text-white/70" strokeWidth={2} />
              </button>
            ) : (
              <div className="w-9" />
            )}
          </div>
        ) : (
        <div className="flex h-12 items-center gap-1 px-3">
          <button type="button" aria-label="返回" onClick={onBack} className="-ml-1 rounded-full p-1.5 active:bg-black/5 dark:active:bg-white/10">
            <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <button type="button" onClick={onOpenInfo} data-testid="qq-groupchat-openinfo" className="ml-1 flex min-w-0 flex-1 flex-col items-start active:opacity-60">
            <span className="max-w-[220px] truncate text-[17px] font-semibold leading-tight">{group.name}</span>
            <span className="text-[11px] text-black/40 dark:text-white/40">{members.length + 1} 人</span>
          </button>
          <button
            type="button"
            aria-label="群聊设置"
            onClick={onOpenInfo}
            data-testid="qq-groupchat-info"
            className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5 dark:active:bg-white/10"
          >
            <Users className="h-[20px] w-[20px] text-black/70 dark:text-white/70" strokeWidth={2} />
          </button>
        </div>
        )}
      </div>

      {/* 消息列表：自定义聊天背景时透出背景层 */}
      <div ref={listRef} className="relative z-10 min-h-0 flex-1 overflow-y-auto px-3.5 py-3" data-testid="qq-groupchat-list">
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
                {m.notice ? (
                  <QQNoticeRow icon={m.notice.icon} pre={m.notice.pre} accent={m.notice.accent} />
                ) : (
                  <span className="inline-block rounded-[4px] bg-black/[0.05] px-2 py-0.5 text-[11px] text-black/45 dark:bg-white/10 dark:text-white/45">
                    {m.noticeText ?? m.content}
                  </span>
                )}
              </div>
            );
          }
          const mine = m.role === 'me';
          const sender = mine ? null : m.senderId === 'unknown' ? null : memberById.get(m.senderId) ?? null;
          const senderName = mine ? me.name : sender ? memberNameOf(sender) : m.senderName;
          const senderAvatar = mine ? me.avatar : sender?.avatar ?? null;
          return (
            <div
              key={m.id}
              data-mid={m.id}
              onClickCapture={
                selectMode && isSelectable(m)
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleSelect(m.id);
                    }
                  : pressClickCapture
              }
              {...bubblePress}
            >
              {showTime && <div className="py-2 text-center text-[11px] text-black/30 dark:text-white/30">{fmtGroupTime(m.time)}</div>}
              {m.recalled ? (
                <div className="py-1.5 text-center">
                  <span className="inline-block rounded-[4px] bg-black/[0.05] px-2 py-0.5 text-[11px] text-black/45 dark:bg-white/10 dark:text-white/45">
                    {mine ? '你' : m.senderName || '有人'}撤回了一条消息
                  </span>
                </div>
              ) : m.kind === 'image' && m.img ? (
                renderMsgRow(
                  m,
                  <div className="min-w-0">
                    <QqImageBubble src={m.img.src} testId="qq-groupmsg-image" />
                  </div>
                )
              ) : m.kind === 'location' && m.loc ? (
                renderMsgRow(
                  m,
                  <LocationBubble
                    loc={{ name: m.loc.name, addr: m.loc.address }}
                    onClick={() => onToast('位置详情暂未开放')}
                  />
                )
              ) : m.kind === 'sticker' && m.stk ? (
                renderMsgRow(
                  m,
                  <QqStickerBubble
                    testId="qq-groupmsg-sticker"
                    url={m.stk.url}
                    meaning={m.stk.meaning}
                    onClick={() => onToast(m.stk?.meaning ? `表情：${m.stk.meaning}` : '表情')}
                  />
                )
              ) : m.kind === 'redpacket' && m.rp ? (
                renderMsgRow(
                  m,
                  <RedPacketBubble
                    packet={{
                      type: 'redpacket',
                      amount: m.rp.amount,
                      note: m.rp.blessing,
                      count: m.rp.count,
                      mode: m.rp.mode === 'exclusive' ? 'dedicated' : m.rp.mode,
                      claims: m.rp.claims.map((c) => ({ name: c.name, avatar: c.avatar, amount: c.amount, ts: c.ts })),
                    }}
                    showOpen={m.senderId !== 'me' && !m.rp.expired && m.rp.claims.length < m.rp.count && !m.rp.claims.some((c) => c.contactId === 'me') && m.rp.mode !== 'exclusive'}
                    onClick={() => openRpMsg(m)}
                  />
                )
              ) : m.kind === 'transfer' && m.tr ? (
                renderMsgRow(
                  m,
                  <TransferBubble
                    packet={{ type: 'transfer', amount: m.tr.amount, note: m.tr.note }}
                    mine={m.role === 'me'}
                    received={m.tr.received === true}
                    onClick={() => setLayer({ view: 'tr-detail', msgId: m.id })}
                  />
                )
              ) : m.kind === 'forward' && m.fwd?.merged ? (
                /* 合并转发「聊天记录」卡片（与单聊同款：标题 + 逐条预览 + 「聊天记录」脚注；点击进详情） */
                renderMsgRow(
                  m,
                  <div
                    data-testid="qq-grp-forward-bubble"
                    onClick={() => {
                      if (!selectMode) setFwdDetailId(m.id);
                    }}
                    className="w-fit max-w-full select-none rounded-[18px] bg-white px-3.5 py-[9px] text-[#1F2329] shadow-sm dark:bg-[#2A2C31] dark:text-white"
                  >
                    <p className="text-[15.5px] font-semibold leading-[1.35]">{m.fwd.title ?? m.content}</p>
                    <div className="mt-1 space-y-[1px] text-[13.5px] leading-[1.5] text-[#1F2329]/55 dark:text-white/60">
                      {(m.fwd.records ?? []).slice(0, 4).map((r, i) => (
                        <p key={i} className="break-all">
                          {r.name}：{r.text}
                        </p>
                      ))}
                      {(m.fwd.records?.length ?? 0) > 4 && <p>…</p>}
                    </div>
                    <p className="mt-2 border-t border-black/10 pt-1.5 text-[11px] text-black/40 dark:border-white/15 dark:text-white/45">聊天记录</p>
                  </div>
                )
              ) : m.kind === 'forward' && m.fwd ? (
                /* 转发卡片：内嵌原消息内容（来源说明与单聊一致省略） */
                renderMsgRow(
                  m,
                  <div
                    data-testid="qq-grp-forward-bubble"
                    className={`w-fit max-w-full select-none rounded-[18px] px-3.5 py-[9px] ${
                      mine ? 'text-white' : 'bg-white text-[#1F2329] dark:bg-[#2A2C31] dark:text-white'
                    }`}
                    style={mine ? { backgroundColor: '#0099FF' } : undefined}
                  >
                    <div className={`line-clamp-8 whitespace-pre-wrap break-words border-l-2 pl-2 text-[14px] leading-[1.4] ${mine ? 'border-white/40' : 'border-black/25'}`}>
                      {m.quote && (
                        <span className={`mb-0.5 block text-[12px] ${mine ? 'text-white/75' : 'text-black/50 dark:text-black/55'}`}>
                          {m.quote.name}：{m.quote.content}
                        </span>
                      )}
                      {m.content}
                    </div>
                  </div>
                )
              ) : (
                <div className={`mb-3 flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                  {selectMode && isSelectable(m) && (
                    <span
                      aria-hidden="true"
                      data-testid={`qq-grp-select-${m.id}`}
                      className={`mt-2.5 flex h-[20px] w-[20px] shrink-0 self-start items-center justify-center rounded-full border ${
                        fwdFlow === 'choose' && mine ? 'order-last' : ''
                      } ${selectedIds.includes(m.id) ? 'border-[#0099FF] bg-[#0099FF] text-white' : 'border-black/25 dark:border-white/35'}`}
                    >
                      {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
                    </span>
                  )}
                  <QqAvatar src={senderAvatar} alt={senderName} size={40} />
                  <div className={`flex min-w-0 max-w-[72%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                    {!mine && <span className="mb-0.5 px-1 text-[12px] leading-none text-black/45 dark:text-white/45">{m.senderName}</span>}
                    <div
                      className={`w-fit max-w-full select-none whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-[9px] text-[16px] leading-[1.5] ${
                        mine ? 'text-white' : 'bg-white text-[#1F2329] dark:bg-[#2A2C31] dark:text-white'
                      }`}
                      style={mine ? { backgroundColor: '#0099FF' } : undefined}
                      data-testid={mine ? 'qq-groupmsg-me' : 'qq-groupmsg-peer'}
                    >
                      {m.quote && (
                        <div
                          className={`mb-1 max-w-full overflow-hidden rounded-[6px] px-2 py-1 text-[12.5px] leading-[1.35] ${
                            mine
                              ? 'bg-white/20 text-white/85'
                              : 'bg-black/[0.05] text-black/50 dark:bg-white/10 dark:text-white/60'
                          }`}
                        >
                          <p className="line-clamp-2 whitespace-pre-wrap break-all">
                            {m.quote.name}：{m.quote.content}
                          </p>
                        </div>
                      )}
                      <span>{m.content}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {/* 流式气泡（当前发言角色）：回复条数>1 时按边界实时切成多个气泡，下一句没打完时显示打字中 */}
        {streaming && stream && (
          <div data-testid="qq-group-stream">
            {(() => {
              const split = splitReplyRender(stream.content, (stream.replyCount ?? 1) > 1);
              return (
                <>
                  {split.texts.map((t, i) => (
                    <div key={i} className="mb-3 flex gap-2">
                      <QqAvatar src={speaker?.avatar ?? null} alt={speaker ? memberNameOf(speaker) : '…'} size={40} />
                      <div className="flex min-w-0 max-w-[72%] flex-col items-start">
                        <span className="mb-0.5 px-1 text-[12px] leading-none text-black/45 dark:text-white/45">
                          {speaker ? memberNameOf(speaker) : '…'}
                        </span>
                        <div className="w-fit max-w-full whitespace-pre-wrap break-words rounded-[18px] bg-white px-3.5 py-[9px] text-[16px] leading-[1.5] text-[#1F2329] dark:bg-[#2A2C31] dark:text-white">
                          {prettifyRichText(t)}
                          {i === split.texts.length - 1 && <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-black/40 align-text-bottom dark:bg-white/40" />}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(split.pending || split.texts.length === 0) && (
                    <div className="mb-3 flex gap-2">
                      <QqAvatar src={speaker?.avatar ?? null} alt={speaker ? memberNameOf(speaker) : '…'} size={40} />
                      <div className="flex min-w-0 max-w-[72%] flex-col items-start">
                        <span className="mb-0.5 px-1 text-[12px] leading-none text-black/45 dark:text-white/45">
                          {speaker ? memberNameOf(speaker) : '…'}
                        </span>
                        <div className="w-fit rounded-[18px] bg-white px-3.5 py-[9px] dark:bg-[#2A2C31]">
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

      {/* 输入区：与单聊同款几何（输入行 + 六图标工具栏）；@ 钮为群聊专属；表情/加号/图片/相机/位置与单聊完全对齐（共用同一套组件）；
          多选模式下变为批量删除/分享/收藏操作栏（与单聊一致） */}
      <div className="relative z-10 shrink-0 bg-white dark:bg-[#1B1C1F]">
        {selectMode ? (
          <div className="flex items-center justify-around px-6 pb-[22px] pt-3" data-testid="qq-grp-select-bar">
            <button
              type="button"
              data-testid="qq-grp-select-del"
              disabled={selectedIds.length === 0}
              onClick={batchDelete}
              className="flex flex-col items-center gap-1 text-[12px] text-[#F5455C] disabled:opacity-35"
            >
              <Trash2 className="h-[21px] w-[21px]" strokeWidth={1.9} />
              删除
            </button>
            <button
              type="button"
              data-testid="qq-grp-select-forward"
              disabled={selectedIds.length === 0}
              onClick={batchForward}
              className="flex flex-col items-center gap-1 text-[12px] text-[#1F2329] disabled:opacity-35 dark:text-white/85"
            >
              <Forward className="h-[21px] w-[21px]" strokeWidth={1.9} />
              分享
            </button>
            <button
              type="button"
              data-testid="qq-grp-select-fav"
              disabled={selectedIds.length === 0}
              onClick={batchFav}
              className="flex flex-col items-center gap-1 text-[12px] text-[#1F2329] disabled:opacity-35 dark:text-white/85"
            >
              <Star className="h-[21px] w-[21px]" strokeWidth={1.9} />
              收藏
            </button>
          </div>
        ) : (
        <>
        {quote && (
          <div className="flex items-center gap-2 border-b border-black/[0.05] px-3 py-1.5 text-[12px] text-black/50 dark:border-white/[0.06] dark:text-white/50">
            <span className="min-w-0 flex-1 truncate">引用 {quote.name}：{quote.content}</span>
            <button type="button" aria-label="取消引用" onClick={() => setQuote(null)} className="shrink-0 active:opacity-60">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 px-3 pb-1 pt-3">
          <button
            type="button"
            aria-label="提及成员"
            data-testid="qq-groupchat-at"
            aria-expanded={atOpen}
            onClick={() => {
              setStickerOpen(false);
              setPlusOpen(false);
              setAtOpen((v) => !v);
            }}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors active:opacity-60 ${
              atOpen ? 'bg-[#0099FF] text-white' : 'bg-black/[0.05] text-black/55 dark:bg-white/10 dark:text-white/55'
            }`}
          >
            <AtSign className="h-[18px] w-[18px]" />
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
            aria-label="发送群聊消息"
            data-testid="qq-groupchat-input"
            className="h-[40px] min-w-0 flex-1 rounded-[10px] border border-black/[0.07] bg-[#F6F7F8] px-3.5 text-[15px] outline-none placeholder:text-black/25 dark:border-white/[0.08] dark:bg-white/[0.07] dark:placeholder:text-white/25"
          />
          <button
            type="button"
            onClick={send}
            disabled={streaming || runningRef.current || (!draft.trim() && !canDispatch)}
            data-testid="qq-groupchat-send"
            aria-label="发送"
            className={`h-[40px] shrink-0 rounded-[12px] px-5 text-[16px] font-medium text-white transition-all duration-150 ${
              (draft.trim() || canDispatch) && !streaming && !runningRef.current ? 'shadow-[0_2px_10px_rgba(0,153,255,0.30)] active:scale-[0.97] active:brightness-95' : 'opacity-90'
            }`}
            style={{ backgroundColor: (draft.trim() || canDispatch) && !streaming && !runningRef.current ? '#0099FF' : '#8AD4F7' }}
          >
            发送
          </button>
        </div>
        {/* 工具栏（与单聊同款六图标：语音/图片/拍摄/点缀/表情/加号） */}
        <div className="flex items-center justify-between px-7 pb-[18px] pt-2 text-black/80 dark:text-white/80">
          <button type="button" aria-label="语音" onClick={() => onToast('语音通话暂未开放')} className="p-2 -m-2 active:opacity-60">
            <Mic className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" aria-label="图片" data-testid="qq-groupchat-tool-image" onClick={() => photoInputRef.current?.click()} className="p-2 -m-2 active:opacity-60">
            <ImageIcon className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" aria-label="拍摄" data-testid="qq-groupchat-tool-camera" onClick={() => cameraInputRef.current?.click()} className="p-2 -m-2 active:opacity-60">
            <Camera className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" aria-label="点缀" onClick={() => onToast('点缀暂未开放')} className="p-2 -m-2 active:opacity-60">
            <Sparkles className="h-[25px] w-[25px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="表情"
            data-testid="qq-groupchat-sticker"
            aria-expanded={stickerOpen}
            onClick={() => {
              setPlusOpen(false);
              setAtOpen(false);
              setStickerOpen((v) => !v);
            }}
            className="p-2 -m-2 active:opacity-60"
          >
            <Smile className={`h-[25px] w-[25px] ${stickerOpen ? 'text-[#0099FF]' : ''}`} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="更多功能"
            data-testid="qq-groupchat-plus"
            aria-expanded={plusOpen}
            onClick={() => {
              setStickerOpen(false);
              setAtOpen(false);
              setPlusOpen((v) => !v);
            }}
            className="p-2 -m-2 active:opacity-60"
          >
            <Plus className={`h-[26px] w-[26px] transition-transform duration-200 ${plusOpen ? 'rotate-45' : ''}`} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        {/* 加号面板（与单聊共用同一套宫格；红包/转账按群范围限定提示不支持） */}
        {plusOpen && (
          <div
            data-testid="qq-group-plus-panel"
            className="border-t border-black/[0.05] px-5 pb-6 pt-5 dark:border-white/[0.06]"
            style={{ animation: 'qqPanelIn 0.24s ease-out' }}
          >
            <QqPlusGrid items={plusItems} />
          </div>
        )}
        {/* 表情面板（与单聊共用同一套组件；表情包按群会话独立保存） */}
        {stickerOpen && <QqStickerPanel onPick={sendSticker} onClose={() => setStickerOpen(false)} onToast={onToast} />}
        {/* @ 成员浮层：锚定输入区容器上方（含面板与引用条也不遮挡） */}
        {atOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setAtOpen(false)} aria-hidden="true" />
            <div className="absolute bottom-full left-3 z-40 mb-1 w-[220px] overflow-hidden rounded-[12px] border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#2A2C31]">
              <div className="border-b border-black/[0.05] px-3 py-2 text-[11px] text-black/40 dark:border-white/[0.06] dark:text-white/40">
                @ 群成员（被 @ 的优先回复）
              </div>
              <div className="max-h-[220px] overflow-y-auto">
                {members.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-black/40">群内还没有成员</div>}
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`qq-group-at-${m.id}`}
                    onClick={() => insertMention(m)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <QqAvatar src={m.avatar} alt={memberNameOf(m)} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[14px]">{memberNameOf(m)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        </>
        )}
      </div>

      {/* 位置页（与单聊共用同一套组件；位置卡片群里所有角色可见） */}
      {compose === 'location' && (
        <LocationPickerPage onClose={() => setCompose(null)} onSend={(loc) => sendLocation(loc.name, loc.addr)} />
      )}

      {/* 群红包/转账浮层流程（发红包页[复用单聊 RedPacketCompose 群模式] / 选人页 / 转账页[复用单聊 TransferCompose] / 开箱 / 详情） */}
      {layer?.view === 'rp-compose' && (
        <RedPacketCompose
          wallet={loadWallet()}
          cards={loadBankCards()}
          members={members}
          onToast={onToast}
          onClose={() => setLayer(null)}
          onSend={submitGroupRp}
        />
      )}
      {layer?.view === 'tr-pick' && (
        <div className="absolute inset-0 z-40 flex flex-col bg-[#F5F6F8] pt-[54px] dark:bg-[#16171A]" data-testid="qq-grp-tr-pick">
          <div className="flex h-11 shrink-0 items-center px-2">
            <button
              type="button"
              aria-label="返回"
              data-testid="qq-grp-tr-pick-back"
              onClick={() => setLayer(null)}
              className="rounded-full p-1.5 active:bg-black/5 dark:active:bg-white/10"
            >
              <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
            </button>
            <div className="flex-1 pr-8 text-center text-[16px] font-medium text-[#1F2329] dark:text-white">选择收款成员</div>
          </div>
          <p className="px-5 pb-2 pt-3 text-[12.5px] text-black/40 dark:text-white/40">转账给「{group.name}」中的一位成员，只有 TA 能收款</p>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8">
            <div className="overflow-hidden rounded-[12px] bg-white dark:bg-[#1B1C1F]">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`qq-grp-tr-pick-${m.id}`}
                  onClick={() => setLayer({ view: 'tr-compose', member: m })}
                  className="flex w-full items-center gap-3 border-b border-black/[0.04] px-4 py-2.5 text-left last:border-b-0 active:bg-black/[0.04] dark:border-white/[0.05] dark:active:bg-white/[0.06]"
                >
                  <QqAvatar src={m.avatar} alt={memberNameOf(m)} size={40} />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-[#1F2329] dark:text-white">{memberNameOf(m)}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-black/25 dark:text-white/25" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {layer?.view === 'tr-compose' && (
        <TransferCompose
          peer={layer.member}
          wallet={loadWallet()}
          cards={loadBankCards()}
          onToast={onToast}
          onClose={() => setLayer(null)}
          onSend={(p, methodId) => {
            if (p.type !== 'transfer') return;
            const pp = loadPayPwd();
            if (pp.enabled && pp.pwd) {
              setGate({ kind: 'transfer', label: '转账', amount: p.amount, methodId, tr: { member: layer.member, amount: p.amount, note: p.note } });
              return;
            }
            execGroupTr(p.amount, p.note, layer.member, methodId);
          }}
        />
      )}
      {layer?.view === 'rp-open' && layerMsg?.rp && (
        <RedPacketOpenModal
          senderName={layerMsg.senderId === 'me' ? '我' : layerMsg.senderName || '群友'}
          avatar={layerMsg.senderId === 'me' ? me.avatar : memberById.get(layerMsg.senderId)?.avatar ?? null}
          note={layerMsg.rp.blessing}
          onOpen={() => claimGroupRp(layer.msgId)}
          onClose={() => setLayer(null)}
        />
      )}
      {layer?.view === 'rp-detail' && layerMsg?.rp && (
        <GroupRpDetailPage
          senderName={layerMsg.senderId === 'me' ? '我' : layerMsg.senderName || '群友'}
          senderAvatar={layerMsg.senderId === 'me' ? me.avatar : memberById.get(layerMsg.senderId)?.avatar ?? null}
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
        <PayPwdGate
          label={`${gate.label} ¥${fmtMoney(gate.amount)} 元`}
          onOk={() => {
            const g = gate;
            setGate(null);
            if (g.kind === 'redpacket' && g.packet) execGroupRp(g.packet, g.methodId);
            else if (g.kind === 'transfer' && g.tr) execGroupTr(g.tr.amount, g.tr.note, g.tr.member, g.methodId);
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
        data-testid="qq-groupchat-camera"
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
        data-testid="qq-groupchat-photo"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void sendImageFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* 编辑消息弹窗（长按菜单「编辑」；与单聊同款）：修改内容后更新该条消息并落盘 */}
      {editMsg && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 px-8" data-testid="qq-grp-edit-layer" onClick={() => setEditMsg(null)}>
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#2A2A2C]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pb-1 pt-4 text-center text-[16px] font-medium text-[#1F2329] dark:text-white">编辑消息</p>
            <div className="px-4 pb-3 pt-2">
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={4}
                maxLength={2000}
                autoFocus
                data-testid="qq-grp-edit-input"
                className="w-full resize-none rounded-[8px] border border-black/10 bg-black/[0.03] px-2.5 py-2 text-[15px] leading-[1.45] text-[#1F2329] outline-none focus:border-[#0099FF] dark:border-white/15 dark:bg-white/[0.06] dark:text-white"
              />
            </div>
            <div className="flex border-t border-black/10 dark:border-white/10">
              <button
                type="button"
                onClick={() => setEditMsg(null)}
                className="h-11 flex-1 text-[16px] text-[#1F2329] active:bg-black/5 dark:text-white dark:active:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="qq-grp-edit-save"
                onClick={saveEdit}
                className="h-11 flex-1 text-[16px] font-medium text-[#0099FF] active:bg-black/5 dark:active:bg-white/10"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 转发方式弹层（多选底栏点「分享」图标才弹出：逐条转发 / 合并转发；与单聊同款） */}
      {selectMode && fwdFlow === 'choose' && (
        <div className="absolute inset-0 z-[60]" data-testid="qq-grp-fwd-choose-mask" onClick={() => setFwdFlow(null)}>
          <div
            className="absolute inset-x-3 bottom-[88px] overflow-hidden rounded-[14px] bg-white shadow-[0_8px_32px_rgba(0,0,0,0.20)] dark:bg-[#2C2C2C]"
            data-testid="qq-grp-fwd-choose-bar"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              data-testid="qq-grp-fwd-each"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setFwdMode('each');
                setFwdFlow('target');
              }}
              className={`w-full py-[15px] text-center text-[17px] ${
                selectedIds.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-[#1F2329] active:bg-black/[0.04] dark:text-white dark:active:bg-white/[0.06]'
              }`}
            >
              逐条转发
            </button>
            <button
              type="button"
              data-testid="qq-grp-fwd-merge"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setFwdMode('merge');
                setFwdFlow('target');
              }}
              className={`w-full border-t border-black/[0.06] py-[15px] text-center text-[17px] dark:border-white/[0.08] ${
                selectedIds.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-[#1F2329] active:bg-black/[0.04] dark:text-white dark:active:bg-white/[0.06]'
              }`}
            >
              合并转发
            </button>
          </div>
        </div>
      )}

      {/* 转发目标选择（群聊特有：可选转发到 QQ 好友/自己的单聊，或另一个 QQ 群） */}
      {fwdFlow === 'target' && (
        <div
          className="absolute inset-0 z-[70] flex flex-col justify-end bg-black/40"
          data-testid="qq-grp-fwd-target-layer"
        >
          <div className="mx-2 mb-3 overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#1B1C1F]" onClick={(e) => e.stopPropagation()}>
            <p className="border-b border-black/[0.06] py-3 text-center text-[15px] font-medium text-[#1F2329] dark:border-white/[0.08] dark:text-white">
              {fwdMode === 'merge' ? '合并转发给' : '逐条转发给'}
            </p>
            <div className="max-h-[46vh] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {forwardTargets.map((c) => (
                <button
                  key={`${c.kind}-${c.id}`}
                  type="button"
                  data-testid={`qq-grp-fwd-target-${c.id}`}
                  onClick={() => doForward(fwdMode, selectedIds, c)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  <QqAvatar src={c.avatar} alt={c.name} size={38} />
                  <span className="min-w-0 flex-1 truncate text-[15.5px] text-[#1F2329] dark:text-white">
                    {c.id === me.id ? `${c.name}（我自己）` : c.name}
                    {c.kind === 'group' && <span className="ml-1.5 text-[11px] text-black/35 dark:text-white/40">群聊</span>}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              data-testid="qq-grp-fwd-back"
              onClick={() => setFwdFlow('choose')}
              className="w-full border-t border-black/[0.06] py-3 text-center text-[15px] text-black/55 active:bg-black/5 dark:border-white/[0.08] dark:text-white/55 dark:active:bg-white/10"
            >
              上一步
            </button>
          </div>
        </div>
      )}

      {/* 合并转发「聊天记录」详情页（点卡片打开；与单聊同款布局，头像按群成员/机主解析） */}
      {(() => {
        const d = fwdDetailId ? msgs.find((x) => x.id === fwdDetailId) ?? null : null;
        if (!d || d.kind !== 'forward' || !d.fwd?.merged) return null;
        const records = d.fwd.records ?? [];
        const resolveAvatar = (r: FwdRecord): string | null => {
          if (r.avatar !== undefined) return r.avatar;
          if (r.name === me.name) return me.avatar;
          const hit = members.find((c) => memberNameOf(c) === r.name);
          if (hit) return hit.avatar;
          return r.role === 'me' ? me.avatar : null;
        };
        return (
          <div className="absolute inset-0 z-[65] flex flex-col bg-white text-[#1F2329] dark:bg-[#16171A] dark:text-white" data-testid="qq-grp-fwd-detail">
            <div className="shrink-0 bg-white pt-[54px] dark:bg-[#16171A]">
              <div className="flex h-12 items-center px-2">
                <button type="button" aria-label="返回" data-testid="qq-grp-fwd-detail-back" onClick={() => setFwdDetailId(null)} className="rounded-full p-1.5 active:bg-black/5 dark:active:bg-white/10">
                  <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
                </button>
                <p className="min-w-0 flex-1 truncate pr-2 text-center text-[16px] font-medium">{d.fwd.title ?? '聊天记录'}</p>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6">
              <p className="py-3 text-center text-[13px] text-black/40 dark:text-white/40">{fwdRecordDate(records[0]?.time ?? d.time)}</p>
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
                {records.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 py-3">
                    <QqAvatar src={resolveAvatar(r)} alt={r.name} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[11.5px] text-black/40 dark:text-white/40">{r.name}</p>
                        <span className="shrink-0 text-[10.5px] text-black/30 dark:text-white/30">{fwdRecordTime(r.time)}</span>
                      </div>
                      {r.kind === 'sticker' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt={r.stkMeaning ? `表情：${r.stkMeaning}` : '表情'}
                          data-testid="qq-grp-fwd-detail-sticker"
                          className="mt-0.5 max-h-[96px] w-auto max-w-[110px] rounded-[8px] object-contain"
                          loading="lazy"
                        />
                      ) : r.kind === 'image' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt="图片消息"
                          data-testid="qq-grp-fwd-detail-image"
                          className="mt-0.5 max-h-[190px] w-auto max-w-[210px] rounded-[8px] object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.4]">{r.text}</p>
                      )}
                      {r.quote && (
                        <p className="mt-0.5 line-clamp-2 border-l-2 border-black/15 pl-1.5 text-[12px] leading-[1.35] text-black/45 dark:border-white/20 dark:text-white/50">{r.quote}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="pt-8 text-center text-[12px] text-black/35 dark:text-white/35">聊天记录</p>
            </div>
          </div>
        );
      })()}

      {/* 长按菜单（与单聊共用同一套组件，选项/样式/交互完全一致） */}
      {menu && menuRect && menuMsg && (
        <BubbleActionMenu pos={menuRect} items={buildMsgMenuItems(menuMsg)} onSelect={onMenuSelect} onClose={() => { setMenu(null); setMenuRect(null); }} testPrefix="qq-group" />
      )}
    </div>
  );
}
