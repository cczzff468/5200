'use client';

/**
 * 微信群聊（宿主：微信 App；会话身份 sessionKey = `wx:group:<groupId>`）。
 *
 * 组成：
 * - WxGroupCreatePage  建群：多选微信好友 + 群名（默认按成员名生成）；
 * - WxGroupListPage    群列表（通讯录 › 群聊入口）；
 * - WxGroupChatPage    群聊页：气泡（发言者名+头像）/ @某成员优先回复 / 长按菜单（复制/引用/撤回/删除）/
 *                      流式气泡（当前发言角色）/ 多角色逐个顺序回复；
 *                      输入功能与单聊完全对齐（共用同一套组件）：文字/表情包/加号菜单/图片/相机/位置/语音消息
 *                      （按住说话录音 + 语音气泡 + 长按转文字 + 文字转语音开关，转写文本进成员上下文）；
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
  Forward,
  Crown,
  Gift,
  Image as ImageIcon,
  MapPin,
  Mic,
  MicOff,
  Minus,
  Phone,
  Plus,
  Search,
  Shield,
  Smile,
  Star,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Video,
  X,
  AudioLines,
} from 'lucide-react';
import {
  BUBBLE_MENU_ICONS,
  BubbleActionMenu,
  computeBubbleMenuPos,
  useBubbleLongPress,
  type BubbleMenuItem,
} from '@/components/apps/bubble-menu';
import { DefaultAvatar } from '@/components/apps/default-avatar';
import { LocalToast, useLocalToast } from './page-toast';
import { stopSpeaking } from '@/lib/ios/tts-client';
import { VoicePlayButton } from '@/components/apps/voice-play';
import { VoiceMsgBubble, type VoiceMsgData } from '@/components/apps/voice-bubble';
import { RecordOverlay, VoiceHoldBar, useVoiceRecorder, type VoiceRecordResult, type VoiceRecordZone } from '@/components/apps/voice-input';
import { transcribeAudioBlob } from '@/lib/ios/stt-client';
import { synthesizeSelfVoice } from '@/lib/ios/voice-send';
import { blobToDataUrl } from '@/lib/ios/audio-utils';
import { stopVoicePlayback } from '@/lib/ios/voice-player';
import { addressNameOf, displayNameOf, isFriendIn, meTileLabel, nameVariantHit, contactNameVariants, type ContactRecord } from '@/lib/contacts';
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
  collectGroupEventLines,
  createGroup,
  dissolveGroup,
  effectiveInterop,
  GROUP_MEMBER_CAP,
  GROUP_MUTE_PRESETS,
  getGroup,
  groupDisplayName,
  groupMuteLeftText,
  groupPreview,
  groupRoleOf,
  isGroupMuted,
  kickGroupMember,
  kickOwnerFromGroup,
  listGroups,
  loadGroupMsgs,
  muteGroupMember,
  saveGroupMsgs,
  setGroupAdmin,
  transferGroupOwner,
  unmuteGroupMember,
  updateGroup,
  type ChatGroup,
  type GroupFwdRecord,
  type GroupMemberRole,
  type GroupRpData,
  type GroupTrData,
  type WxGroupMsg,
} from '@/lib/ios/groups';
import { loadStickers, type Sticker } from '@/lib/ios/stickers';
import { getStickersOn, STICKER_OFF_RULE } from '@/lib/sticker-toggle';
import { wxChatFlags, type ChatFlags } from '@/lib/chat-flags';
import { addFavorite, isMsgFavorited, unfavoriteMsg, type MsgFavorite } from '@/lib/msg-favorites';
import { buildGroupAdminRules, canEditGroupInfo, canModerateTarget, parseMuteDuration } from '@/lib/ios/group-admin';
import { applyGroupChatSocialAction, buildGroupInviteRules, kickNoticeOf } from '@/lib/ios/group-social';
import { isGroupChatSocialAction } from '@/lib/chat-rich';
import { fwdRecordDate, fwdRecordTime, fwdRecordTitle, type FwdMode, type FwdRecord, type FwdSheetTarget } from './forward-sheet';
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
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
import { getMemSettings, memAfterAiTurn, memRecallBlock } from '@/lib/memory';
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
  buildGroupRichRules,
  cleanBubbleText,
  extractRichActionParts,
  isGroupAdminAction,
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

/**
 * AI 成员发红包/转账节流（同一角色短时间不连续发多次；内存态，按群会话+角色隔离）：
 * ① 提示词层：冷却期内注入「你刚发过，这轮别再发」规则；② 落盘层：冷却期内/同一轮里多出的
 * 红包/转账卡片直接丢弃（文字部分照常落盘）。与群规则里的「发钱纪律」配套。 */
const AI_MONEY_COOLDOWN_MS = 3 * 60_000;
const aiMoneyAt = new Map<string, number>();
const moneyCooldownKey = (sKey: string, charId: string) => `${sKey}:${charId}`;

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

/** 语音声波图标（聊天输入栏左侧圆钮用，单色细线：一个点 + 三道声波弧；与微信单聊同款样式） */
function VoiceWaveGlyph({ size = 19 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6.2" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <path d="M10.3 9.3a5.2 5.2 0 0 1 0 5.4" />
      <path d="M13.5 7a8.8 8.8 0 0 1 0 10" />
      <path d="M16.7 4.7a12.6 12.6 0 0 1 0 14.6" />
    </svg>
  );
}

// ---------------- 群 → 单聊转发（与微信单聊同一套存储键 / 感知事件键，单聊 loadMsgs 打开即能读回） ----------------

/** 写入微信单聊消息库的最小消息形状（wechat.tsx 的 WxMsg 结构子集；loadMsgs 规范化时按字段兜底） */
export interface WxSingleMsgShape {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  kind?: 'text' | 'image' | 'sticker' | 'location' | 'forward';
  img?: { src: string };
  loc?: { name: string; address: string };
  stk?: { url: string; meaning: string };
  quote?: { name: string; content: string };
  fwd?: { from: string; merged?: boolean; title?: string; records?: GroupFwdRecord[] };
}

const wxSingleMsgsKey = (contactId: string) => `wx-chat-msgs:${contactId}`;

/** 读目标单聊消息库（转发落点；结构对齐 wechat.tsx loadMsgs 的宽松过滤） */
function loadWxSingleMsgs(contactId: string): WxSingleMsgShape[] {
  try {
    const raw = kvGet<WxSingleMsgShape[]>(wxSingleMsgsKey(contactId));
    if (!Array.isArray(raw)) return [];
    return raw.filter((m) => Boolean(m) && typeof m.content === 'string' && (m.role === 'me' || m.role === 'peer'));
  } catch {
    return [];
  }
}

/** 写目标单聊消息库（与 wechat.tsx saveMsgs 同键同封顶；顺带恢复被隐藏的会话行） */
function saveWxSingleMsgs(contactId: string, msgs: WxSingleMsgShape[]): void {
  try {
    kvSet(wxSingleMsgsKey(contactId), msgs.slice(-100));
  } catch {
    // 存储失败不中断
  }
  try {
    const raw = localStorage.getItem('wx-chat-hidden');
    const hid: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(hid) && hid.includes(contactId)) {
      localStorage.setItem('wx-chat-hidden', JSON.stringify(hid.filter((x: unknown) => x !== contactId)));
    }
  } catch {
    // 忽略
  }
}

const wxAiEventsKey = (contactId: string) => `wx-ai-events:${contactId}`;

/** 转发落到目标单聊时给目标 AI 排一条感知事件（打开会话即触发 AI 回应；与 wechat.tsx pushAiEvent 同键格式） */
function pushWxAiEvent(contactId: string, text: string): void {
  try {
    const parsed = kvGet<string[]>(wxAiEventsKey(contactId));
    const arr = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    arr.push(text);
    kvSet(wxAiEventsKey(contactId), arr.slice(-10));
  } catch {
    // 忽略
  }
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
  onToast,
}: {
  contacts: ContactRecord[];
  onBack: () => void;
  onCreated: (g: ChatGroup) => void;
  /** 页内提示（建群规则：成员至少一名、人数上限）；未接时静默 */
  onToast?: (m: string) => void;
}) {
  const toast = onToast ?? (() => {});
  const candidates = useMemo(() => contacts.filter((c) => c.kind !== 'user' && isFriendIn(c, 'wx')), [contacts]);
  const [selected, setSelected] = useState<string[]>([]);
  const [nameDirty, setNameDirty] = useState(false);
  const [name, setName] = useState('');
  const suggested = useMemo(() => {
    const names = selected
      .map((id) => contacts.find((c) => c.id === id))
      .filter((c): c is ContactRecord => !!c)
      .map(memberNameOf);
    if (names.length === 0) return '';
    // 默认群名 = 我的名字 + 成员名字（真实微信同款「谁和谁的群聊」语义；人多时截断）
    const meRec = contacts.find((c) => c.kind === 'user');
    const all = meRec ? [memberNameOf(meRec), ...names] : names;
    return all.length <= 4 ? all.join('、') : `${all.slice(0, 3).join('、')}等${all.length}人群聊`;
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
    const g = createGroup({ name: effName || '未命名群聊', memberIds: selected, ownerId: me.id, creatorName: memberNameOf(me) });
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
            placeholder="群聊名称（默认为我的名字+成员名字）"
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
  onQuit,
  onDissolve,
  onToast: onToastExternal,
}: {
  group: ChatGroup;
  contacts: ContactRecord[];
  onBack: () => void;
  onUpdate: (patch: Partial<Pick<ChatGroup, 'name' | 'remark' | 'avatar' | 'announcement' | 'memoryInterop' | 'memberIds'>>) => void;
  /** 退出群聊（仅机主本机移除；AI 成员的群记忆保留） */
  onQuit: () => void;
  /** 解散群聊（群对所有人消失；群聊记忆级联清理） */
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
  const [dialog, setDialog] = useState<{ kind: 'name' | 'remark' } | null>(null);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [noticeDraft, setNoticeDraft] = useState('');
  const [memberSheet, setMemberSheet] = useState<ContactRecord | null>(null);
  // 群管理页（置顶的集中管理入口）：管理员添加 / 取消管理员 / 禁言 / 转让群主
  const [mgmtOpen, setMgmtOpen] = useState<null | 'admin-add' | 'admin-remove' | 'mute' | 'transfer'>(null);
  // 禁言时长选择单（群主/管理员对目标成员发起）；转让群主确认弹窗
  const [muteSheet, setMuteSheet] = useState<ContactRecord | null>(null);
  const [transferConfirm, setTransferConfirm] = useState<ContactRecord | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
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

  // ---- 群角色 / 权限（六.权限规则）：群主全部权限；管理员可禁言/踢人（仅普通成员）；普通成员不能管理他人 ----
  const meRec = useMemo(() => contacts.find((c) => c.kind === 'user') ?? null, [contacts]);
  // 称呼方式（全局设置）：机主瓦片显示「凡凡（凑凑）」或「凑凑」
  const addressMode = useSettings((s) => s.addressMode);
  // 机主身份（兼容双键）：挽留流程旧版曾以字面量 'me' 写入 adminIds/ownerId，联系人 ID 查不到时回退 'me' 查一次
  const myRole: GroupMemberRole = meRec
    ? groupRoleOf(group, meRec.id) !== 'member'
      ? groupRoleOf(group, meRec.id)
      : groupRoleOf(group, 'me')
    : 'member';
  const amOwner = myRole === 'owner';
  const amAdmin = myRole === 'admin';
  const canManage = amOwner || amAdmin;
  /** 目标成员能否被我管理（管理员只能管普通成员；群主除自己外都能管） */
  const canManageTarget = (target: ContactRecord): boolean => {
    if (target.id === group.ownerId) return false; // 群主不可被管理
    return amOwner || (amAdmin && groupRoleOf(group, target.id) === 'member');
  };
  /** 群主身份标签（成员瓦片/操作单用） */
  const roleLabelOf = (id: string): string => (group.ownerId === id ? '群主' : group.adminIds.includes(id) ? '管理员' : '');

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
    // 踢人（三.3/六.3）：群主/管理员才可操作；群主不可被移出；成功后自动落「XX被移出群聊」系统消息
    if (!canManageTarget(c)) {
      onToast(amOwner ? '群主不可被移出' : '管理员只能移出普通成员');
      return;
    }
    const next = kickGroupMember(gid, c.id, { name: memberNameOf(c), actorName: meRec?.name || '机主' });
    if (next) {
      onToast(`已将 ${memberNameOf(c)} 移出群聊`);
      onUpdate({ memberIds: next.memberIds });
    }
  };

  /** 设为/取消管理员（仅群主；群主本人不可被设）：成功自动落系统消息（三.5） */
  const toggleAdmin = (c: ContactRecord, admin: boolean) => {
    setMemberSheet(null);
    if (!amOwner) return;
    const next = setGroupAdmin(gid, c.id, admin, { name: memberNameOf(c) });
    if (next) {
      onToast(admin ? `已将 ${memberNameOf(c)} 设为管理员` : `已取消 ${memberNameOf(c)} 的管理员`);
      onUpdate({}); // 空补丁：让宿主刷新群对象（adminIds 已在数据层落盘）
    }
  };

  /** 禁言（带时长；六.5 禁言期间不能发言）：成功自动落「XX被禁言 X」系统消息（三.4） */
  const applyMute = (c: ContactRecord, ms: number | null, label: string) => {
    setMuteSheet(null);
    setMemberSheet(null);
    const next = muteGroupMember(gid, c.id, ms, { name: memberNameOf(c) });
    if (next) {
      onToast(`已禁言 ${memberNameOf(c)} ${label}`);
      onUpdate({});
    }
  };

  /** 解除禁言：自动落「XX被解除禁言」系统消息（三.4） */
  const liftMute = (c: ContactRecord) => {
    setMemberSheet(null);
    const next = unmuteGroupMember(gid, c.id, { name: memberNameOf(c) });
    if (next) {
      onToast(`已解除 ${memberNameOf(c)} 的禁言`);
      onUpdate({});
    }
  };

  /** 转让群主（仅群主；六.2 谁都不能取消群主，只能转让）：自动落「群主转让给 XX」系统消息（三.6）；确认后返回设置页 */
  const doTransfer = (c: ContactRecord) => {
    setTransferConfirm(null);
    setMemberSheet(null);
    setMgmtOpen(null);
    const next = transferGroupOwner(gid, c.id, { name: memberNameOf(c) });
    if (next) {
      onToast(`群主已转让给 ${memberNameOf(c)}`);
      onUpdate({});
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

      {/* 成员格点（对照真微信：成员头像瓦片 + 虚线 ＋/－ 按钮；方形圆角头像与聊天页一致）。
          五.1 群成员列表：机主瓦片也在列；排序 = 群主 → 管理员 → 普通成员（机主按身份排位，不再恒居首位）；
          机主瓦片按称呼设置显示「凡凡（凑凑）」（用名字）或「凑凑」（用昵称），成员带群主/管理员身份徽标 */}
      <div className="bg-white px-4 py-4 dark:bg-[#1A1A1A]">
        <div className="grid grid-cols-5 gap-y-3">
          {[...(meRec ? [meRec] : []), ...members]
            .sort((a, b) => {
              // 群主在前、管理员其次、普通成员在后（同角色保持原序；机主按身份参与排序）
              const rank = (id: string) => (group.ownerId === id ? 0 : group.adminIds.includes(id) ? 1 : 2);
              return rank(a.id) - rank(b.id);
            })
            .map((m) => {
              const isMe = meRec != null && m.id === meRec.id;
              const rl = roleLabelOf(m.id);
              return (
                <div
                  key={m.id}
                  className="flex flex-col items-center gap-1.5"
                  data-testid={isMe ? 'wx-groupinfo-member-me' : `wx-groupinfo-member-${m.id}`}
                  onClick={isMe ? undefined : () => setMemberSheet(m)}
                  role={isMe ? undefined : 'button'}
                >
                  <WxAvatar src={m.avatar} alt={m.name} size={44} />
                  <span className="flex max-w-[64px] items-center gap-1 overflow-hidden">
                    <span className="truncate text-[11px] leading-none text-black/50 dark:text-white/50">
                      {isMe ? meTileLabel(m, addressMode) : memberNameOf(m)}
                    </span>
                    {rl && (
                      <span
                        className={`shrink-0 rounded-[3px] px-1 text-[9px] leading-[14px] ${
                          rl === '群主' ? 'bg-[#FA9D3B]/15 text-[#D07818]' : 'bg-[#07C160]/15 text-[#0C8B4D]'
                        }`}
                      >
                        {rl}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
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
          {canManage && members.length > 0 && (
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

      {/* 置顶 / 免打扰（上移至成员栏下方首屏；按群独立） */}
      <div className="mt-2 divide-y divide-black/5 bg-white dark:divide-white/10 dark:bg-[#1A1A1A]">
        <SwitchRow
          label="置顶聊天"
          checked={flags[groupRowId(gid)]?.pinned === true}
          onChange={(v) => wxChatFlags.update(groupRowId(gid), { pinned: v })}
          testId="wx-groupinfo-pin"
        />
        <SwitchRow
          label="消息免打扰"
          checked={flags[groupRowId(gid)]?.muted === true}
          onChange={(v) => wxChatFlags.update(groupRowId(gid), { muted: v })}
          testId="wx-groupinfo-mute-switch"
        />
      </div>

      {/* 群资料 */}
      <div className="mt-2 divide-y divide-black/5 bg-white dark:divide-white/10 dark:bg-[#1A1A1A]">
        <InfoRow label="群聊名称" value={group.name} onClick={() => setDialog({ kind: 'name' })} testId="wx-groupinfo-name" />
        <InfoRow
          label="备注"
          value={group.remark?.trim() || '未设置'}
          onClick={() => setDialog({ kind: 'remark' })}
          testId="wx-groupinfo-remark"
        />
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

      {/* 群管理（仅群主/管理员可见；管理员只能禁言，任命/转让仅群主；六.权限规则门控） */}
      {canManage && (
        <div className="mt-2 divide-y divide-black/5 bg-white dark:divide-white/10 dark:bg-[#1A1A1A]">
          <p className="px-4 pb-1 pt-3 text-[12px] text-black/40 dark:text-white/40">群管理</p>
          {amOwner && (
            <InfoRow
              label="管理员添加"
              value={group.adminIds.length > 0 ? `现有 ${group.adminIds.length} 名` : '未设置'}
              onClick={() => setMgmtOpen('admin-add')}
              testId="wx-groupinfo-mgmt-admin-add"
            />
          )}
          {amOwner && (
            <InfoRow
              label="取消管理员"
              value={group.adminIds.length > 0 ? `现有 ${group.adminIds.length} 名` : '无'}
              onClick={() => {
                if (group.adminIds.length === 0) {
                  onToast('当前没有管理员');
                  return;
                }
                setMgmtOpen('admin-remove');
              }}
              testId="wx-groupinfo-mgmt-admin-remove"
            />
          )}
          <InfoRow
            label="禁言"
            value="选成员禁言/解禁"
            onClick={() => setMgmtOpen('mute')}
            testId="wx-groupinfo-mgmt-mute"
          />
          {amOwner && (
            <InfoRow
              label="转让群主"
              value="选一位成员接任"
              onClick={() => setMgmtOpen('transfer')}
              testId="wx-groupinfo-mgmt-transfer"
            />
          )}
        </div>
      )}

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
      </div>

      <div className="mt-2 bg-white dark:bg-[#1A1A1A]">
        <InfoRow label="清空聊天记录" danger onClick={() => setConfirmClear(true)} testId="wx-groupinfo-clear" />
      </div>
      <button
        type="button"
        data-testid="wx-groupinfo-quit"
        onClick={() => setConfirmQuit(true)}
        className="mt-2 w-full bg-white py-[13px] text-center text-[16px] text-[#FA5150] active:bg-black/5 dark:bg-[#1A1A1A] dark:active:bg-white/5"
      >
        退出群聊
      </button>
      <button
        type="button"
        data-testid="wx-groupinfo-dissolve"
        onClick={() => setConfirmDissolve(true)}
        className="mt-2 w-full bg-white py-[13px] text-center text-[16px] text-[#FA5150] active:bg-black/5 dark:bg-[#1A1A1A] dark:active:bg-white/5"
      >
        解散群聊
      </button>
      <div className="py-8 text-center text-[11px] text-black/30 dark:text-white/30">
        群聊为本地模拟，不含任何真实资金操作
      </div>

      {/* 成员操作（五.2-6：管理员/禁言/解禁/踢人/转让群主，按身份出按钮；六.权限规则门控） */}
      {memberSheet && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setMemberSheet(null)}>
          <div className="w-full rounded-t-[14px] bg-white p-2 pb-6 dark:bg-[#2C2C2C]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-3 py-2">
              <WxAvatar src={memberSheet.avatar} alt={memberSheet.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[15px]">
                  <span className="truncate">{memberNameOf(memberSheet)}</span>
                  {roleLabelOf(memberSheet.id) && (
                    <span
                      className={`shrink-0 rounded-[3px] px-1 text-[10px] leading-[16px] ${
                        roleLabelOf(memberSheet.id) === '群主' ? 'bg-[#FA9D3B]/15 text-[#D07818]' : 'bg-[#07C160]/15 text-[#0C8B4D]'
                      }`}
                    >
                      {roleLabelOf(memberSheet.id)}
                    </span>
                  )}
                </div>
                {groupMuteLeftText(group, memberSheet.id) && (
                  <div className="mt-0.5 flex items-center gap-1 text-[12px] text-[#FA5150]" data-testid="wx-groupinfo-mute-status">
                    <MicOff className="h-3 w-3" />
                    禁言中：{groupMuteLeftText(group, memberSheet.id)}
                  </div>
                )}
              </div>
            </div>
            {/* 设为/取消管理员（仅群主；群主本人不可被设） */}
            {amOwner && memberSheet.id !== group.ownerId && (
              <button
                type="button"
                data-testid="wx-groupinfo-toggle-admin"
                onClick={() => toggleAdmin(memberSheet, !group.adminIds.includes(memberSheet.id))}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[15px] active:bg-black/5 dark:active:bg-white/5"
              >
                <Shield className="h-4 w-4" />
                {group.adminIds.includes(memberSheet.id) ? '取消管理员' : '设为管理员'}
              </button>
            )}
            {/* 禁言（群主：除自己外都能禁；管理员：仅普通成员） */}
            {canManageTarget(memberSheet) && !groupMuteLeftText(group, memberSheet.id) && (
              <button
                type="button"
                data-testid="wx-groupinfo-mute"
                onClick={() => setMuteSheet(memberSheet)}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[15px] text-[#D07818] active:bg-black/5 dark:active:bg-white/5"
              >
                <MicOff className="h-4 w-4" />
                禁言
              </button>
            )}
            {/* 解除禁言 */}
            {canManageTarget(memberSheet) && groupMuteLeftText(group, memberSheet.id) && (
              <button
                type="button"
                data-testid="wx-groupinfo-unmute"
                onClick={() => liftMute(memberSheet)}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[15px] text-[#0C8B4D] active:bg-black/5 dark:active:bg-white/5"
              >
                <Mic className="h-4 w-4" />
                解除禁言
              </button>
            )}
            {/* 转让群主（仅群主；六.2 只能转让不能取消） */}
            {amOwner && memberSheet.id !== group.ownerId && (
              <button
                type="button"
                data-testid="wx-groupinfo-transfer"
                onClick={() => {
                  setTransferConfirm(memberSheet);
                  setMemberSheet(null);
                }}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[15px] text-[#D07818] active:bg-black/5 dark:active:bg-white/5"
              >
                <Crown className="h-4 w-4" />
                转让群主
              </button>
            )}
            {/* 移出群聊（群主：除自己外；管理员：仅普通成员） */}
            {canManageTarget(memberSheet) && (
              <button
                type="button"
                data-testid="wx-groupinfo-remove-member"
                onClick={() => removeMember(memberSheet)}
                className="mt-1 flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[15px] text-[#FA5150] active:bg-black/5 dark:active:bg-white/5"
              >
                <UserMinus className="h-4 w-4" />
                移出群聊
              </button>
            )}
            {!canManageTarget(memberSheet) && !amOwner && (
              <p className="px-3 pb-1 pt-2 text-[12px] leading-relaxed text-black/35 dark:text-white/35">
                你是普通成员，不能管理其他成员
              </p>
            )}
          </div>
        </div>
      )}

      {/* 禁言时长选择单（10 分钟 / 1 小时 / 3 小时 / 1 天 / 永久）：z-[60] 保证在群管理选择页之上立即弹出 */}
      {muteSheet && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/40" onClick={() => setMuteSheet(null)}>
          <div className="w-full rounded-t-[14px] bg-white p-2 pb-6 dark:bg-[#2C2C2C]" onClick={(e) => e.stopPropagation()}>
            <p className="px-3 py-2 text-[13px] text-black/45 dark:text-white/45">
              禁言 {memberNameOf(muteSheet)}（禁言期间不能在群里发言）
            </p>
            {GROUP_MUTE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                data-testid={`wx-groupinfo-mute-${p.ms === null ? 'forever' : p.ms}`}
                onClick={() => applyMute(muteSheet, p.ms, p.label)}
                className="flex w-full items-center justify-between rounded-[10px] px-3 py-3 text-left text-[15px] active:bg-black/5 dark:active:bg-white/5"
              >
                <span>{p.label}</span>
                {p.ms === null && <span className="text-[12px] text-[#FA5150]">直到解除</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 转让群主确认：z-[60] 保证在群管理选择页之上立即弹出（与禁言时长单同款修复）；确认后返回设置页 */}
      {transferConfirm && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-8" onClick={() => setTransferConfirm(null)}>
          <div className="w-full max-w-[300px] rounded-[14px] bg-white p-5 dark:bg-[#2C2C2C]" onClick={(e) => e.stopPropagation()}>
            <p className="text-[16px] font-medium">转让群主</p>
            <p className="mt-2 text-[13px] leading-relaxed text-black/55 dark:text-white/55">
              确定把群主转让给「{memberNameOf(transferConfirm)}」吗？转让后你将成为普通成员。
            </p>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => setTransferConfirm(null)}
                className="h-10 flex-1 rounded-[8px] bg-black/5 text-[14px] dark:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="wx-groupinfo-transfer-confirm"
                onClick={() => doTransfer(transferConfirm)}
                className="h-10 flex-1 rounded-[8px] bg-[#07C160] text-[14px] font-medium text-white active:opacity-80"
              >
                确认转让
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 群管理选择页（集中管理入口）：管理员添加 / 取消管理员 / 禁言 / 转让群主；操作复用数据层同款函数（自动落系统消息） */}
      {mgmtOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#EDEDED] dark:bg-[#111111]">
          <GroupNavBar
            title={mgmtOpen === 'admin-add' ? '管理员添加' : mgmtOpen === 'admin-remove' ? '取消管理员' : mgmtOpen === 'mute' ? '禁言成员' : '转让群主'}
            onBack={() => setMgmtOpen(null)}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <p className="px-8 py-3 text-center text-[12px] leading-relaxed text-black/35 dark:text-white/35">
              {mgmtOpen === 'admin-add' && '点击普通成员将其设为管理员（仅群主）'}
              {mgmtOpen === 'admin-remove' && '点击管理员取消其管理员身份（仅群主）'}
              {mgmtOpen === 'mute' && '点击成员进行禁言（可选时长）；已禁言成员可直接解除'}
              {mgmtOpen === 'transfer' && '点击成员把群主转让给 TA，转让后你将成为普通成员'}
            </p>
            <div className="bg-white dark:bg-[#1A1A1A]">
              {(mgmtOpen === 'admin-add'
                ? members.filter((m) => groupRoleOf(group, m.id) === 'member')
                : mgmtOpen === 'admin-remove'
                  ? members.filter((m) => groupRoleOf(group, m.id) === 'admin')
                  : mgmtOpen === 'mute'
                    ? members.filter((m) => canManageTarget(m))
                    : members.filter((m) => m.id !== group.ownerId)
              ).map((m) => {
                const mutedLeft = groupMuteLeftText(group, m.id);
                return (
                  <div key={m.id} className="flex w-full items-center gap-3 px-4 py-2.5">
                    <WxAvatar src={m.avatar} alt={m.name} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px]">{memberNameOf(m)}</p>
                      {mgmtOpen === 'mute' && mutedLeft && (
                        <p className="mt-0.5 text-[12px] text-[#FA5150]">禁言中：{mutedLeft}</p>
                      )}
                    </div>
                    {mgmtOpen === 'admin-add' && (
                      <button
                        type="button"
                        data-testid={`wx-groupinfo-mgmt-add-${m.id}`}
                        onClick={() => toggleAdmin(m, true)}
                        className="shrink-0 rounded-[8px] bg-[#07C160]/10 px-3 py-1.5 text-[13px] text-[#0C8B4D] active:opacity-70"
                      >
                        设为管理员
                      </button>
                    )}
                    {mgmtOpen === 'admin-remove' && (
                      <button
                        type="button"
                        data-testid={`wx-groupinfo-mgmt-remove-${m.id}`}
                        onClick={() => toggleAdmin(m, false)}
                        className="shrink-0 rounded-[8px] bg-[#FA5150]/10 px-3 py-1.5 text-[13px] text-[#FA5150] active:opacity-70"
                      >
                        取消管理员
                      </button>
                    )}
                    {mgmtOpen === 'mute' && (
                      mutedLeft ? (
                        <button
                          type="button"
                          data-testid={`wx-groupinfo-mgmt-unmute-${m.id}`}
                          onClick={() => liftMute(m)}
                          className="shrink-0 rounded-[8px] bg-[#07C160]/10 px-3 py-1.5 text-[13px] text-[#0C8B4D] active:opacity-70"
                        >
                          解除禁言
                        </button>
                      ) : (
                        <button
                          type="button"
                          data-testid={`wx-groupinfo-mgmt-mute-${m.id}`}
                          onClick={() => setMuteSheet(m)}
                          className="shrink-0 rounded-[8px] bg-[#FA9D3B]/10 px-3 py-1.5 text-[13px] text-[#D07818] active:opacity-70"
                        >
                          禁言
                        </button>
                      )
                    )}
                    {mgmtOpen === 'transfer' && (
                      <button
                        type="button"
                        data-testid={`wx-groupinfo-mgmt-transfer-${m.id}`}
                        onClick={() => setTransferConfirm(m)}
                        className="shrink-0 rounded-[8px] bg-[#FA9D3B]/10 px-3 py-1.5 text-[13px] text-[#D07818] active:opacity-70"
                      >
                        转让给 TA
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
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
                      // 三.1：入群自动落「XX加入了群聊」系统消息（事件在数据层 addGroupMember 内生成）
                      const next = addGroupMember(gid, c.id, { name: memberNameOf(c) });
                      if (!next) {
                        onToast(`群成员已达上限（${GROUP_MEMBER_CAP} 人）`);
                        return;
                      }
                      onUpdate({ memberIds: next.memberIds });
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
      {dialog?.kind === 'remark' && (
        <CenterDialog
          title="群备注"
          initial={group.remark ?? ''}
          onCancel={() => setDialog(null)}
          onSave={(v) => {
            onUpdate({ remark: v.trim() });
            setDialog(null);
            onToast(v.trim() ? '备注已保存' : '备注已清除');
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
      {confirmQuit && (
        <ConfirmDialog
          text="退出后将删除本机的群聊记录，并不再接收此群消息，确定退出？"
          onCancel={() => setConfirmQuit(false)}
          onConfirm={() => {
            setConfirmQuit(false);
            onQuit();
          }}
        />
      )}
      {confirmDissolve && (
        <ConfirmDialog
          text="解散后所有成员都将退出该群，聊天记录与群聊记忆将被删除，确定解散？"
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

/** 群加号面板（与单聊 PlusPanel 同款布局与图标，共用同一套视觉；红包/转账为群内真实可用功能） */
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

/** 群转账详情页状态文案（收款人是机主时用「你」） */
function groupTrStatusText(tr: GroupTrData): string {
  if (tr.received) return tr.toId === 'me' ? '你已收款' : `${tr.toName}已收款`;
  const status = groupTrStateLabel(tr);
  if (status === '已退回' || status === '已拒收') return status;
  return tr.toId === 'me' ? '待你收款' : `待${tr.toName}收款`;
}

function GroupTrDetailPage({
  tr,
  fromName,
  onBack,
  /** 收款人是机主且待收款时开放「收款/退还」操作（成员转账给机主的场景） */
  canAct = false,
  onReceive,
  onReturn,
}: {
  tr: GroupTrData;
  fromName: string;
  onBack: () => void;
  canAct?: boolean;
  onReceive?: () => void;
  onReturn?: () => void;
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
                {groupTrStatusText(tr)}
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
          {canAct ? (
            <div className="mt-5 flex gap-3 border-t border-black/[0.06] pt-4 dark:border-white/[0.08]">
              <button
                type="button"
                data-testid="wx-grp-tr-detail-return"
                onClick={onReturn}
                className="h-10 flex-1 rounded-[6px] border border-black/15 text-[15px] text-black/75 active:bg-black/[0.04] dark:border-white/20 dark:text-white/75 dark:active:bg-white/[0.06]"
              >
                退还
              </button>
              <button
                type="button"
                data-testid="wx-grp-tr-detail-receive"
                onClick={onReceive}
                className="h-10 flex-1 rounded-[6px] bg-[#07C160] text-[15px] font-medium text-white active:brightness-95"
              >
                收款
              </button>
            </div>
          ) : null}
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
  onQuit,
  onDissolve,
  onToast: onToastExternal,
}: {
  group: ChatGroup;
  me: { id: string; name: string; realName?: string | null; nickname?: string | null; avatar: string | null };
  contacts: ContactRecord[];
  /** NPC 归属者名解析（人设 prompt 用） */
  ownerLabelOf: (peer: ContactRecord) => string | null;
  onBack: () => void;
  onUpdate: (patch: Partial<Pick<ChatGroup, 'name' | 'memberIds' | 'memoryInterop'>>) => void;
  onOpenInfo: () => void;
  /** 退出群聊（仅机主本机移除） */
  onQuit: () => void;
  /** 解散群聊（群对所有人消失） */
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
  // 退出群聊页/切群：停止语音播放与 TTS 朗读并释放播放器（单例，防跨群串音）
  useEffect(() => () => {
    stopSpeaking();
    stopVoicePlayback();
  }, [gid]);
  const [msgs, setMsgs] = useState<WxGroupMsg[]>(() => loadGroupMsgs(gid));
  // 存储侧追加（AI 开场白/卡片接受后的「XX加入了群聊」事件等后台落盘）→ 广播后即时重读，
  // 修掉「接受邀请进群但加入事件晚一拍落盘时页面看不到」的时序缺口
  useEffect(() => {
    const fn = (e: Event) => {
      const gid2 = (e as CustomEvent<{ gid?: string }>).detail?.gid;
      if (gid2 && gid2 !== gid) return;
      setMsgs(loadGroupMsgs(gid));
    };
    window.addEventListener('group-msgs:updated', fn);
    return () => window.removeEventListener('group-msgs:updated', fn);
  }, [gid]);
  const [draft, setDraft] = useState('');
  // 语音输入模式：输入框替换为「按住 说话」胶囊（左侧圆钮切换，与微信单聊同款）
  const [voiceMode, setVoiceMode] = useState(false);
  // 文字转语音发送：开启后输入框文字发出为语音气泡（不想说话时用）
  const [ttsSend, setTtsSend] = useState(false);
  const [quote, setQuote] = useState<{ name: string; content: string; id?: string; time?: number } | null>(null);
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
  /** 排队回复标记：回合进行中用户又发了消息 → 本回合结束后自动再起一轮 */
  const groupQueuedRef = useRef(false);
  const mountedRef = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const groupRef = useRef(group);
  groupRef.current = group;
  // 机主全部可识别名字（真名/展示名/昵称/「我」「机主」）：AI 管理标记与转账收款对象的目标解析共用
  const meVariants = useMemo(
    () => [...new Set([me.name, me.realName ?? '', me.nickname ?? '', '我', '机主'].map((v) => v.trim()).filter(Boolean))],
    [me.name, me.realName, me.nickname]
  );

  // 长按菜单
  const [menu, setMenu] = useState<null | { mid: string }>(null);
  // 编辑消息（长按菜单「编辑」）：弹窗改文本后写回该条消息并落盘
  const [editMsg, setEditMsg] = useState<WxGroupMsg | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // 多选模式：勾选消息批量删除/转发/收藏（与单聊同套交互）
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 转发流程：多选底栏「分享」→ 逐条/合并 → 选目标会话（微信好友/自己/其他微信群）
  const [fwdFlow, setFwdFlow] = useState<'choose' | 'target' | null>(null);
  const [fwdMode, setFwdMode] = useState<FwdMode>('each');
  // 合并转发「聊天记录」详情页（点卡片打开）
  const [fwdDetailId, setFwdDetailId] = useState<string | null>(null);
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

  // 六.5：机主被禁言时的输入阻断（当前权限体系下机主通常为群主，此处为防御性支持；禁言过期自动恢复）
  // 兼容双键：挽留流程旧版曾以字面量 'me' 写入禁言表，联系人 ID 与 'me' 任一命中即视为被禁
  const meMuted = isGroupMuted(group, me.id) || isGroupMuted(group, 'me');
  const meMuteLeft = meMuted ? groupMuteLeftText(group, me.id) ?? groupMuteLeftText(group, 'me') : null;

  /** 就地更新一条群消息的附加数据（红包/转账状态流转、语音转写结果用）：读改写存储 + 页面存活时同步 state */
  const patchGroupMsg = useCallback(
    (mid: string, patch: Partial<Pick<WxGroupMsg, 'rp' | 'tr' | 'recalled' | 'content' | 'voice'>>) => {
      const next = loadGroupMsgs(gid).map((m) => (m.id === mid ? { ...m, ...patch } : m));
      saveGroupMsgs(gid, next);
      if (mountedRef.current) setMsgs(next);
    },
    [gid]
  );

  /** 追加一条带图标的资金通知行（xx领取了你的红包 / 收下了你的转账；定义在 appendMsg 之后，见下方） */
  /** 收集该成员当前可处理的群红包/转账（生成 system 待处理清单）：
   *  红包：不是自己发的（机主或任何成员发的）、未过期、还有剩余份、自己没领过、（专属 → 只给被指定成员）；
   *  转账：只有被指定的收款成员能处理（机主发的或群内其他成员转给你的） */
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
        } else if (m.kind === 'transfer' && m.tr && m.tr.toId === charId && !m.tr.received && !m.tr.status) {
          const tr = m.tr;
          const from = m.role === 'me' ? '机主' : m.senderName || '群友';
          out.push({ id: tr.cid ?? m.id, kind: 'transfer', amount: tr.amount, label: tr.note ? `备注"${tr.note}"，${from}转给你的` : `${from}转给你的` });
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
        // 发起方称呼（机主发的 →「你」；其他成员发的 → 对方名字）；退款只退机主发的（成员无钱包）
        const fromMe = m.role === 'me';
        const fromLabel = fromMe ? '你发的' : `${m.senderName || '群友'}发的`;
        if (verb === 'claim') {
          patchGroupMsg(m.id, { tr: { ...tr, received: true, receivedAt: Date.now() } });
          appendFundNotice('tr', `${charName}收下了${fromLabel}`, '转账');
        } else if (verb === 'return') {
          patchGroupMsg(m.id, { tr: { ...tr, status: 'returned' } });
          if (fromMe) wxPatchBalance(tr.amount, { kind: '转账', amount: tr.amount });
          appendFundNotice('tr', `${charName}退回了${fromLabel}`, '转账');
        } else {
          patchGroupMsg(m.id, { tr: { ...tr, status: 'rejected' } });
          appendFundNotice('tr', `${charName}拒收了${fromLabel}`, '转账');
        }
      }
    },
    [appendFundNotice, gid, patchGroupMsg]
  );

  /** 应用 AI 成员的管理动作（需求一：AI 被设为群主/管理员时可用权限）：
   *  禁言/解禁/移出群聊/改群名/改公告。硬性权限校验（群主>管理员>成员，越权/对自己动手一律丢弃），
   *  实际落盘走 groups.ts 数据层（自动生成系统消息并持久化）；成功后让宿主刷新群对象。 */
  const applyGroupAdminAction = useCallback(
    (char: ContactRecord, action: RichAction) => {
      // 群社交动作（[邀请:名字] / [设管理员:名字]）：关系/冷却/拒绝表/权限在 group-social 执行器硬校验
      if (isGroupChatSocialAction(action)) {
        const gNow = getGroup(gid);
        if (gNow) applyGroupChatSocialAction(gNow, char, 'wx', action.kind, action.targetId);
        onUpdate({});
        return;
      }
      const g = getGroup(gid);
      if (!g) return;
      if (groupRoleOf(g, char.id) === 'member') return; // 普通成员没有管理权限：标记直接丢弃
      // 成员名字 → 联系人（机主 + 全部 AI 成员；真名/展示名/昵称多变体：精确 → 互相包含逐级匹配）
      // 机主统一用登录联系人 ID（me.id）：与 ownerId/adminIds/mutes 的键口径一致；字面量 'me' 仅作旧数据兼容
      const resolveTarget = (name: string): { id: string; name: string } | null => {
        const n = name.trim();
        if (!n) return null;
        // 机主：名字/真名/昵称/「我」「机主」都指向同一个人（me.id），事件文案仍用显示名 me.name
        if (nameVariantHit(meVariants, n)) return { id: me.id, name: me.name };
        const pool = g.memberIds
          .map((id) => contactsRef.current.find((c) => c.id === id))
          .filter((c): c is ContactRecord => !!c && c.id !== char.id);
        const exact = pool.find((c) => contactNameVariants(c).some((v) => v === n));
        if (exact) return { id: exact.id, name: memberNameOf(exact) };
        const partial = pool.find((c) => nameVariantHit(contactNameVariants(c), n));
        return partial ? { id: partial.id, name: memberNameOf(partial) } : null;
      };
      switch (action.kind) {
        case 'mute-member': {
          const t = resolveTarget(action.targetId);
          if (!t || !canModerateTarget(g, char.id, t.id)) return;
          muteGroupMember(gid, t.id, parseMuteDuration(action.arg ?? ''), { name: t.name });
          break;
        }
        case 'unmute-member': {
          const t = resolveTarget(action.targetId);
          if (!t || !canModerateTarget(g, char.id, t.id)) return;
          unmuteGroupMember(gid, t.id, { name: t.name });
          break;
        }
        case 'kick-member': {
          const t = resolveTarget(action.targetId);
          if (!t || !canModerateTarget(g, char.id, t.id)) return;
          if (t.id === me.id) {
            // AI 把机主移出群聊（五.4：被踢出后本机看不到该群）：先落踢出事件，再按退群口径
            // 本机移除（同时触发退群挽留快照，AI 事后可按人设私信道歉/邀请回群）；
            // kickOwnerFromGroup 同步删群，直接 return（后续 onUpdate 无意义，宿主靠 toast 提示）
            onToast(`你已被${memberNameOf(char)}移出群聊`);
            kickOwnerFromGroup(gid, { name: t.name });
            // 群已从本机移除：必须仍走 onUpdate 让宿主刷新（微信 setGroupPeer(null) 关页 / QQ 靠 groupVersion 重算回落列表）
            onUpdate({});
            return;
          }
          kickGroupMember(gid, t.id, { name: t.name, actorName: memberNameOf(char) });
          break;
        }
        case 'rename-group': {
          const n = action.targetId.trim().slice(0, 30);
          if (n && n !== g.name && canEditGroupInfo(g, char.id)) updateGroup(gid, { name: n });
          break;
        }
        case 'announce-group': {
          const n = action.targetId.trim().slice(0, 200);
          if (n && canEditGroupInfo(g, char.id)) updateGroup(gid, { announcement: n });
          break;
        }
        case 'grant-owner': {
          // AI（群主）在群里转让群主给指定成员（[转让群主:成员名字]）：此前该标记在群聊里被静默吞掉，
          // AI 会口头声称"已转让"而实际没执行——补真实执行：仅群主、要写名字、不能转给自己；
          // 转给机主也允许（机主不在 memberIds，resolveTarget 的 meVariants 分支可命中）。
          const t = resolveTarget(action.targetId);
          if (!t) return;
          if (groupRoleOf(g, char.id) !== 'owner') return; // 只有群主能转让（越权吞掉）
          if (t.id === char.id) return; // 不能转给自己
          if (t.id !== me.id && !g.memberIds.includes(t.id)) return; // 只能转给群内真实成员
          transferGroupOwner(gid, t.id, { name: t.name });
          break;
        }
        default:
          return;
      }
      onUpdate({}); // 成员/禁言/群名/公告可能变了：让宿主刷新群对象
    },
    [gid, me, onToast, onUpdate]
  );

  /** @ 某成员：插入「@名字 」到草稿（输入框以 @ 结尾时替换该 @，与键入 @ 唤起浮层无缝衔接） */
  const insertMention = (c: ContactRecord) => {
    setAtOpen(false);
    setDraft((d) => {
      const base = d.endsWith('@') ? d.slice(0, -1) : d;
      return `${base}${base && !base.endsWith(' ') ? ' ' : ''}@${memberNameOf(c)} `;
    });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  /** 解析草稿里的 @（按成员显示名精确匹配） */
  const parseMentions = (text: string): ContactRecord[] =>
    members.filter((c) => text.includes(`@${memberNameOf(c)}`));

  /** 消息进入 AI 上下文的文本快照（图片/位置/表情包/红包/转账/语音有占位描述，与单聊一致） */
  const msgTextOf = (m: WxGroupMsg): string => {
    if (m.kind === 'image') return '[图片]';
    // 语音消息：AI 直接读转写文本（自然对话）；识别失败/未识别时用占位
    if (m.kind === 'voice') return m.voice?.transcript || '[语音]';
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

  /** 消息的可复制/引用文本快照（长按菜单复制、引用、转发占位、收藏共用；语音→转写文本或占位，与单聊一致） */
  const msgSnapshotOf = (m: WxGroupMsg): string =>
    m.kind === 'image'
      ? '[图片]'
      : m.kind === 'voice'
        ? m.voice?.transcript
          ? `[语音] ${m.voice.transcript}`
          : '[语音]'
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
        // 名字/昵称区分：AI 侧统一用称呼名指代机主（默认真名「凡凡」；用户选了用昵称才是「凑凑」）
        const meName = addressNameOf(me, useSettings.getState().addressMode);
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
        // 最后一条机主消息的快照文本（走 msgTextOf：语音→转写文本、图片→[图片]，与历史构建同口径）
        const lastMeMsg = [...ctxMsgs].reverse().find((m) => m.role === 'me');
        const lastUserText = lastMeMsg ? msgTextOf(lastMeMsg) : '';
        const memContext = [lastUserText, ...ctxMsgs.slice(-6).map(msgTextOf)].filter(Boolean).join(' ');

        // 表情包（用户本地添加的收藏清单，与单聊同一套）：按本群表情开关下发（默认开）；
        // 关闭时不下发清单也不让 AI 发表情包卡片（与单聊同规则）
        const stickers = loadStickers('wx');
        const stickersOn = getStickersOn(sKey);

        // 群聊规则（每个角色独立声明：当前是群聊、参与者有谁、只代表自己、禁复读、可互相对话）
        const others = g.memberIds
          .map((id) => contactsRef.current.find((c) => c.id === id))
          .filter((c): c is ContactRecord => !!c)
          .filter((c) => c.id !== char.id);
        const groupRules = [
          // 名字/昵称区分（群聊版）：参与成员里机主用称呼名，并明确昵称只是同一个人的另一个叫法
          `【群聊模式】当前是群聊「${g.name}」，不是一对一私聊。参与成员：${meName}（机主用户${me.nickname?.trim() && me.nickname.trim() !== meName ? `，昵称「${me.nickname.trim()}」也是 TA` : ''}）${
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
          // 特殊消息标记（群聊格式：红包带个数、转账带收款对象；表情包清单按本群表情开关下发）
          ...buildGroupRichRules(stickersOn ? stickers : []),
          ...(stickersOn ? [] : [STICKER_OFF_RULE]),
        ];
        // 发钱节流（提示词层）：冷却期内提醒这轮不要再发红包/转账（落盘层另有硬节流兜底）
        const lastMoneyAt = aiMoneyAt.get(moneyCooldownKey(sKey, char.id)) ?? 0;
        if (Date.now() - lastMoneyAt < AI_MONEY_COOLDOWN_MS) {
          groupRules.push('【发钱节流】你刚刚才发过红包或转账，短时间内别再发了：这轮不要再输出任何红包/转账标记，正常聊天就好。');
        }
        // 群红包/转账待处理清单（每个成员独立视角）：是否抢/收完全按人设决定，不处理就不输出标记
        // （红包：机主或任何成员发的都可抢；转账：只有被指定的收款成员能处理——含其他成员转给你的）
        const pendingCards = collectGroupPending(char.id);
        if (pendingCards.length > 0) {
          groupRules.push(
            '【群红包/转账】下面的清单来自本群：红包由机主或群成员发出，多份红包每人限领一份；专属红包只有被指定的人能领；转账只有收款人能处理。抢不抢、收不收都按你的人设与当时的语境自然决定。',
            ...buildActionRules(pendingCards)
          );
        }
        // AI 管理权限（需求一）：被设为群主/管理员的成员可输出管理标记（禁言/解禁/移出/改群名/改公告），
        // 是否使用、分寸如何完全由人设决定；普通成员注入「无权限」说明（被要求执行时如实拒绝不假装成功）
        const groupNameOf = (id: string): string => {
          if (id === me.id) return meName; // AI 侧统一用称呼名（与参与成员名单一致）
          const c = contactsRef.current.find((x) => x.id === id);
          return c ? memberNameOf(c) : '群成员';
        };
        groupRules.push(...buildGroupAdminRules(g, char.id, groupNameOf));
        // 邀请能力（需求三）：群主/管理员可拉人进群（可拉名单=有关系 NPC/该 App 好友，冷却/拒绝表硬校验）；
        // 群主还能 [设管理员:名字] 任命管理员；普通成员不注入
        const inviteRules = buildGroupInviteRules(g, char, 'wx', contactsRef.current);
        if (inviteRules) groupRules.push(inviteRules);
        // 回群感知（需求一.5）：该角色被移出过本群又被拉回来 → 告知 TA（历史事件里也有被踢+回群记录）
        const kickNotice = kickNoticeOf(char.id);
        if (kickNotice && kickNotice.gid === gid && kickNotice.backAt) {
          groupRules.push(
            `【你回到了群聊】你之前被移出过群聊「${kickNotice.groupName}」，刚刚又被拉回来了。这段小插曲你记得，可以按人设自然提起，不要当成没发生过。`,
          );
        }
        // 群成员速览（关系感知）：其他成员是谁、与机主的关系、性格速写（角色间相处按双方人设自然把握）
        const memberLines = others.map((c) => {
          const rel = (c.relation ?? '').trim();
          const ps = (c.persona ?? '').trim();
          const shown = memberNameOf(c);
          const real = (c.realName ?? '').trim();
          const bits = [real && real !== shown ? `大名叫${real}` : '', rel ? `与${meName}是${rel}` : '', ps ? ps.slice(0, 48) : ''].filter(Boolean);
          return `- ${shown}${bits.length ? `（${bits.join('；')}）` : ''}`;
        });
        if (memberLines.length > 0) {
          groupRules.push('【群成员速览】群里其他成员的情况（你与他们的相处方式按你的人设与各自人设自然把握）：', ...memberLines);
        }
        if (g.announcement) groupRules.push(`【群公告】${g.announcement}`);
        // 群内事件感知（四.1/4.3）：系统事件（加入/退出/禁言/管理员/转让/改名/公告/建群）按时间排序注入 system。
        // 事件不参与正常回复（历史里没有），但成员都在场看到了，不能装作不知道（四.2/4.4）
        const evtLines = collectGroupEventLines(gid);
        if (evtLines.length > 0) {
          groupRules.push(
            '【群内事件】最近群里发生的这些事你都在场看到了（按时间先后）：',
            ...evtLines,
            '这些事件都是真实发生的，不要装作没看见：有新成员加入可以按人设自然打招呼，有人退群/被禁言/成为管理员/群主转让等也可以在合适的时机自然反应；但不必逐条点评事件，没有想说的就不用特意回应。'
          );
        }
        // 发言自判（按人设来）：未被 @ 的成员无话可说时只回 [SKIP]（finalize 阶段整条丢弃，不落盘）
        if (allowSkip) {
          groupRules.push('【发言判断】刚发出的这条消息如果与你无关、不需要你表态或你无话可说（比如别人在单独聊天），只回复 [SKIP] 两个词，不要说任何其他内容；有你要说的就正常回复。');
        }

        const npcExtra = buildNpcPromptExtra(char, contactsRef.current);
        const system = buildPersonaSystemPrompt(char, {
          channel: '微信',
          userName: meName,
          // 名字/昵称区分：群聊同样注入【用户的称呼】段（名字是凡凡，昵称是凑凑）
          userRealName: me.realName ?? me.name,
          userNickname: me.nickname ?? null,
          ownerName: ownerLabelOf(char),
          // 跨 App 身份感知：互通开关（每联系人设置，发送时现场读取；群聊同样告知多端身份）
          multiApp: getMemSettings(char.id).share,
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
            // 文字块按边界（标记/换行/句末标点，回复条数>1 时一句一条）切分后再解析群聊特殊标记 →
            // [红包:总金额:个数:祝福语] 群红包卡片 / [转账:对象:金额:备注] 指定成员转账 / [位置…] / [表情包:ID]
            // （渲染与交互复用用户手动发送的同款卡片组件；位置/表情包全群可见）
            const parts = extractRichActionParts(text);
            const all: WxGroupMsg[] = [];
            let t = result.startedAt;
            let idx = 0;
            // 发钱节流（落盘层）：同一轮最多一张红包/转账卡 + 冷却期内不再发（文字部分照常落盘）
            let moneySentThisTurn = false;
            const inMoneyCooldown = Date.now() - (aiMoneyAt.get(moneyCooldownKey(sKey, char.id)) ?? 0) < AI_MONEY_COOLDOWN_MS;
            // 群成员名字 → 成员解析（转账收款对象）：机主 + 全部 AI 成员（真名/展示名/昵称多变体匹配）
            const resolveMemberByName = (name: string): { id: string; name: string } | null => {
              const n = name.trim();
              if (!n) return null;
              if (nameVariantHit(meVariants, n)) return { id: 'me', name: me.name };
              const pool = (groupRef.current.memberIds ?? [])
                .map((id) => contactsRef.current.find((c) => c.id === id))
                .filter((c): c is ContactRecord => !!c && c.id !== char.id);
              const exact = pool.find((c) => contactNameVariants(c).some((v) => v === n));
              if (exact) return { id: exact.id, name: memberNameOf(exact) };
              const partial = pool.find((c) => nameVariantHit(contactNameVariants(c), n));
              return partial ? { id: partial.id, name: memberNameOf(partial) } : null;
            };
            for (const part of parts) {
              if (part.type === 'action') {
                // 管理标记（禁言/解禁/移出/改群名/改公告）与卡片处理标记（领红包/收转账）分流入各自的执行器
                if (isGroupAdminAction(part.action) || isGroupChatSocialAction(part.action)) applyGroupAdminAction(char, part.action);
                else applyGroupAiAction(char, part.action);
                continue;
              }
              const segs = mergeRichSegments(splitReplySegments(part.text, replyCount > 1));
              for (const seg of segs) {
                for (const p of parseRichParts(seg, stickersOn ? stickers : [], { group: true })) {
                  const id = idx === 0 ? result.aiMsgId : `${result.aiMsgId}-${idx}`;
                  if (p.type === 'rich') {
                    const isMoney = p.rich.kind === 'redpacket' || p.rich.kind === 'transfer';
                    // 表情包开关关闭：AI 发的表情包卡片直接丢弃（红包/转账/位置卡片不受影响，与单聊同规则）
                    if (!stickersOn && p.rich.kind === 'sticker') continue;
                    // 发钱节流：同一轮已发过或冷却期内 → 丢弃钱卡（不影响其他内容）
                    if (isMoney && (moneySentThisTurn || inMoneyCooldown)) continue;
                    if (p.rich.kind === 'redpacket') {
                      const count = p.rich.count ?? 1;
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
                          count,
                          // 多份红包按拼手气发进群（每人随机一份，与真人玩法一致）；单个 = 普通红包
                          mode: count > 1 ? 'lucky' : 'normal',
                          blessing: p.rich.blessing || '恭喜发财，大吉大利',
                          claims: [],
                          sentAt: Date.now(),
                          cid: nextGroupCid('rp'),
                        },
                      });
                      moneySentThisTurn = true;
                      aiMoneyAt.set(moneyCooldownKey(sKey, char.id), Date.now());
                    } else if (p.rich.kind === 'transfer') {
                      // 收款对象必须解析到群里真实成员（机主或 AI 成员），解析不到不成卡（资金真实性）
                      const target = resolveMemberByName(p.rich.target ?? '');
                      if (!target) continue;
                      all.push({
                        id,
                        role: 'peer',
                        senderId: char.id,
                        senderName: charName,
                        content: '',
                        time: t,
                        kind: 'transfer',
                        tr: { amount: p.rich.amount, note: p.rich.note, toId: target.id, toName: target.name, cid: nextGroupCid('tr') },
                      });
                      moneySentThisTurn = true;
                      aiMoneyAt.set(moneyCooldownKey(sKey, char.id), Date.now());
                    } else if (p.rich.kind === 'location') {
                      // 位置卡片（与用户手动发送同款渲染，全群可见）
                      all.push({
                        id,
                        role: 'peer',
                        senderId: char.id,
                        senderName: charName,
                        content: '',
                        time: t,
                        kind: 'location',
                        loc: { name: p.rich.name, address: p.rich.coords || '地图上的一个位置' },
                      });
                    } else if (p.rich.kind === 'sticker') {
                      // 表情包（从用户收藏清单按 ID 匹配；找不到时回退显示文字）
                      const sid = p.rich.stickerId;
                      const s = stickers.find((x) => x.id === sid);
                      if (s) {
                        all.push({ id, role: 'peer', senderId: char.id, senderName: charName, content: '', time: t, kind: 'sticker', stk: { url: s.url, meaning: s.meaning, sid: s.id } });
                      } else {
                        all.push({ id, role: 'peer', senderId: char.id, senderName: charName, content: '[表情包]', time: t });
                      }
                    }
                  } else {
                    // 首尾清洗：剥掉模型偶尔输出的零宽/盲文空格等「看不见的占位字符」，避免气泡开头出现空隙
                    const cleaned = cleanBubbleText(p.text);
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
                  // 消息计数锚点用：未 slice/map 的有效消息数组（群消息流，含其他成员的消息）
                  () => loadGroupMsgs(gid).filter((m) => m.kind !== 'notice' && !m.recalled),
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
     
    [apiConfig, appendMsg, applyGroupAdminAction, applyGroupAiAction, collectGroupPending, gid, me, ownerLabelOf, sKey]
  );

  /** 一个群回合：@ 成员必答优先，其余成员逐个按人设自判是否发言（无话可说 [SKIP] 沉默）。
   *  trigger 可省略（分句发送批次触发/红包/转账卡片入群时无文字可 @）：此时全员按人设自判。
   *  兜底约定（异常与边界）：全员都 [SKIP] 时不落盘不提示（真实群聊发消息也可能没人接）；
   *  单条回复为空时 finalize 已有「（…）」占位兜底；群已解散/无成员时静默返回。 */
  const runGroupTurn = useCallback(
    async (trigger?: WxGroupMsg) => {
      if (runningRef.current || isChatStreaming(sKey)) return;
      const g = getGroup(gid);
      if (!g || g.memberIds.length === 0) return;
      runningRef.current = true;
      try {
        expireStalePackets(); // 每轮开始前先清算过期红包（终态不可再改）
        // 六.5 禁言执行：被禁言的成员本轮不能发言（被 @ 也不行，物理禁言；禁言过期自动恢复）
        const fresh = getGroup(gid) ?? g;
        const all = fresh.memberIds
          .map((id) => contactsRef.current.find((c) => c.id === id))
          .filter((c): c is ContactRecord => !!c)
          .filter((c) => !isGroupMuted(fresh, c.id));
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
        // 排队补跑：回合进行中用户又发了消息 → 本回合结束后自动再起一轮（消息已在群消息库，成员都能看到）
        if (groupQueuedRef.current) {
          groupQueuedRef.current = false;
          const lastMe = [...loadGroupMsgs(gid)].reverse().find((m) => m.role === 'me');
          if (lastMe && getGroup(gid)) window.setTimeout(() => void runGroupTurn(lastMe), 500);
        }
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

  /** 文字转语音发送（定义在下方；send 在前引用 → 同 ref 模式，避免声明顺序问题） */
  const sendTextAsVoiceRef = useRef<(t: string) => void>(() => undefined);

  const send = () => {
    if (meMuted) {
      onToast('你已被禁言，暂时无法发言');
      return;
    }
    const text = draft.trim();
    // 空输入点「发送」= 触发分句发送批次回复（分句开启且有未回复的批次时）
    if (!text) {
      if (sentenceSend && pendingDispatch) dispatchBatch();
      return;
    }
    // 文字转语音发送：合成语音气泡（transcript 带原文，成员直接读得到内容）；失败只 toast 不发文字
    if (ttsSend) {
      sendTextAsVoiceRef.current(text);
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
    if (runningRef.current || isChatStreaming(sKey)) {
      // 成员们还在回复：消息照常发出并排队，本回合结束后自动再起一轮（不再拦截后让用户重发）
      appendMsg(msg);
      groupQueuedRef.current = true;
      onToast('消息已发出，成员们回完这轮就聊');
      return;
    }
    appendMsg(msg);
    // 分句发送开启：只入列不触发回复，等输入框为空再点一次「发送」统一触发（真人把几句话拆开发完）
    if (sentenceSend) {
      setPendingDispatch(true);
      markPendingBatch(sKey, true);
      return;
    }
    void runGroupTurn(msg);
  };

  // ---------------- 语音消息：按住说话录音 / 文字转语音 / 转文字（与微信单聊同链路，适配群聊 senderId） ----------------

  /** 语音片段统一形态（录音带 blob 供转文字；文字转语音只有 dataURL） */
  type VoiceClip = { blob?: Blob; dataUrl: string; duration: number; wave: number[] };

  /** 语音消息落库：入列（senderId='me'）→（录音）后台转文字 → 转写完触发群回合（成员都能读到转写）；
   *  回合进行中则只落库并排队（补跑读最新落盘，能读到转写） */
  const commitVoiceMsg = useCallback(
    (clip: VoiceClip, presetTranscript?: string) => {
      if (meMuted) {
        onToast('你已被禁言，暂时无法发言');
        return;
      }
      const hasText = typeof presetTranscript === 'string' && presetTranscript.length > 0;
      const voice: VoiceMsgData = hasText
        ? { url: clip.dataUrl, duration: clip.duration, wave: clip.wave, transcript: presetTranscript, stt: 'done' }
        : { url: clip.dataUrl, duration: clip.duration, wave: clip.wave, ...(clip.blob ? { stt: 'pending' as const } : { stt: 'done' as const }) };
      const msg: WxGroupMsg = { id: uid(), role: 'me', senderId: 'me', senderName: me.name, content: '', time: Date.now(), kind: 'voice', voice };
      appendMsg(msg);
      const selfId = msg.id;
      // 转写完成后：更新消息（含落盘）→ 触发群回合（runGroupTurn 内部从存储读最新消息，无闭包陈旧问题；
      // trigger 传更新后的消息对象，content 为空 → 无 @，全员按人设自判）
      const patchAndTrigger = (transcript: string) => {
        const next = loadGroupMsgs(gid).map((x) =>
          x.id === selfId && x.voice
            ? { ...x, voice: { ...x.voice, transcript: transcript || undefined, stt: transcript ? ('done' as const) : ('failed' as const) } }
            : x,
        );
        saveGroupMsgs(gid, next);
        if (mountedRef.current) setMsgs(next);
        const updated = next.find((x) => x.id === selfId);
        if (runningRef.current || isChatStreaming(sKey)) {
          groupQueuedRef.current = true; // 成员们还在回复：本回合结束后自动补跑（读最新落盘，能读到转写）
          return;
        }
        window.setTimeout(() => void runGroupTurn(updated), 80);
      };
      if (hasText || !clip.blob) {
        // 文字转语音（transcript 已带原文，无需识别）：消息已在列，直接触发
        if (runningRef.current || isChatStreaming(sKey)) {
          groupQueuedRef.current = true;
          return;
        }
        window.setTimeout(() => void runGroupTurn(msg), 80);
        return;
      }
      void transcribeAudioBlob(clip.blob)
        .then((text) => patchAndTrigger(text))
        .catch(() => patchAndTrigger(''));
    },
    [appendMsg, gid, me.name, meMuted, onToast, runGroupTurn, sKey],
  );

  /** 录音手势结果分发：松开=发语音；右滑=转文字发文本（失败回退语音）；取消/太短=丢弃 */
  const handleVoiceOutcome = useCallback(
    (result: VoiceRecordResult | null, zone: VoiceRecordZone) => {
      // 取消手势（哪怕录够了时长）与太短结果一律丢弃；仅「原松开未滑动」的太短给提示
      if (!result || zone === 'cancel') {
        if (!result && zone === null) onToast('说话时间太短');
        return;
      }
      if (meMuted) {
        onToast('你已被禁言，暂时无法发言');
        return;
      }
      if (zone === 'stt') {
        // 滑到「转文字」：识别成功发文字消息（与打字发送同链路，含排队/分句）；失败回退为语音气泡，不丢录音
        void transcribeAudioBlob(result.blob)
          .then((text) => {
            if (!text) throw new Error('empty');
            const msg: WxGroupMsg = { id: uid(), role: 'me', senderId: 'me', senderName: me.name, content: text, time: Date.now(), quote: quote ?? undefined };
            if (runningRef.current || isChatStreaming(sKey)) {
              appendMsg(msg);
              groupQueuedRef.current = true;
              onToast('消息已发出，成员们回完这轮就聊');
              return;
            }
            if (sentenceSend) {
              appendMsg(msg);
              setPendingDispatch(true);
              markPendingBatch(sKey, true);
              return;
            }
            appendMsg(msg);
            void runGroupTurn(msg);
          })
          .catch(() => {
            onToast('转文字失败，已按语音发送');
            void blobToDataUrl(result.blob).then((dataUrl) => commitVoiceMsg({ blob: result.blob, dataUrl, duration: result.duration, wave: result.wave }));
          });
        return;
      }
      // 原松开：语音气泡入列，后台转文字，转完触发群回合
      void blobToDataUrl(result.blob).then((dataUrl) => commitVoiceMsg({ blob: result.blob, dataUrl, duration: result.duration, wave: result.wave }));
    },
    [appendMsg, commitVoiceMsg, me.name, meMuted, onToast, quote, runGroupTurn, sentenceSend, sKey],
  );

  const rec = useVoiceRecorder({ onResult: handleVoiceOutcome, onStartError: (m) => onToast(m) });

  /** 文字转语音发送（不想说话时：输入文字 → 发出语音气泡）；失败只 toast，不当聊天内容 */
  const sendTextAsVoice = useCallback(
    (text: string) => {
      setDraft('');
      setQuote(null);
      void synthesizeSelfVoice(text)
        .then((clip) => commitVoiceMsg(clip, text))
        .catch((e: unknown) => onToast(e instanceof Error && e.message ? e.message : '语音生成失败，请重试'));
    },
    [commitVoiceMsg, onToast],
  );
  sendTextAsVoiceRef.current = sendTextAsVoice;

  /** 相机/相册图片发送（与单聊同一套 readImageFile 压缩；配置识图模型后触发群回合） */
  const sendImageFiles = async (files: FileList) => {
    if (meMuted) {
      onToast('你已被禁言，暂时无法发言');
      return;
    }
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
    if (meMuted) {
      onToast('你已被禁言，暂时无法发言');
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
    if (meMuted) {
      onToast('你已被禁言，暂时无法发言');
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
    if (meMuted) {
      onToast('你已被禁言，暂时无法发言');
      return;
    }
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
    if (meMuted) {
      onToast('你已被禁言，暂时无法发言');
      return;
    }
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

  /** 我收款：成员（AI）转账给我的卡片 → 状态已收款 + 金额入零钱（记账单）+ 通知行 → 发起成员按人设回应 */
  const receiveGroupTr = (m: WxGroupMsg) => {
    const tr = m.tr;
    if (!tr || tr.toId !== 'me' || tr.received || tr.status) return;
    patchGroupMsg(m.id, { tr: { ...tr, received: true, receivedAt: Date.now() } });
    wxPatchBalance(tr.amount, { kind: '转账', amount: tr.amount });
    appendFundNotice('tr', `你收下了${m.senderName || '群友'}发的`, '转账');
    setLayer(null);
    onToast(`已收款 ${fmtMoney(tr.amount)} 元`);
    nudgeAiSender(m.senderId);
  };

  /** 我退还：成员（AI）转账给我的卡片 → 终态已退回 + 通知行 → 发起成员按人设回应（纯本地模拟，不动钱包） */
  const returnGroupTr = (m: WxGroupMsg) => {
    const tr = m.tr;
    if (!tr || tr.toId !== 'me' || tr.received || tr.status) return;
    patchGroupMsg(m.id, { tr: { ...tr, status: 'returned' } });
    appendFundNotice('tr', `你退回了${m.senderName || '群友'}的`, '转账');
    setLayer(null);
    onToast('转账已退还');
    nudgeAiSender(m.senderId);
  };

  /** 我处理完成员发来的转账后，让发起成员按人设自然回应一轮（只叫 TA 一个人；红包领取回应同款节奏） */
  const nudgeAiSender = (senderId: string) => {
    if (runningRef.current || isChatStreaming(sKey)) return;
    const char = memberById.get(senderId) ?? contactsRef.current.find((c) => c.id === senderId) ?? null;
    if (!char) return;
    window.setTimeout(() => {
      if (runningRef.current || isChatStreaming(sKey)) return;
      groupSpeaker.set(sKey, char.id);
      if (mountedRef.current) setSpeakerId(char.id);
      void runCharTurn(char, false, []).finally(() => {
        groupSpeaker.delete(sKey);
        if (mountedRef.current) setSpeakerId(null);
      });
    }, 80);
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

  // ---------------- 长按气泡菜单：复制/删除/编辑/引用/多选/撤回/转发/收藏/重新生成（与单聊完全一致） ----------------

  /** 消息是否可长按弹菜单 / 多选勾选（通知行与已撤回行除外） */
  const isSelectable = (m: WxGroupMsg): boolean => m.kind !== 'notice' && !m.recalled;

  /** 按发送方与消息类型组装长按菜单项（与单聊同构：我的/AI 气泡都可 复制 删除 编辑 引用 多选 撤回 转发 收藏；
   *  AI 气泡多一个重新生成；已收藏的消息显示「已收藏」） */
  const buildMsgMenuItems = (m: WxGroupMsg): BubbleMenuItem[] => {
    const B = BUBBLE_MENU_ICONS;
    const isText = !m.kind || m.kind === 'text';
    const isVoice = m.kind === 'voice';
    const items: BubbleMenuItem[] = [];
    // 语音消息首项「转文字」（已有结果时点击提示；识别失败可重试），随后仍是复制（复制转写结果）
    if (isVoice) items.push({ key: 'stt', label: '转文字', icon: B.stt });
    items.push({ key: 'copy', label: '复制', icon: B.copy });
    items.push({ key: 'del', label: '删除', icon: B.del, danger: true });
    if (isText) items.push({ key: 'edit', label: '编辑', icon: B.edit });
    if (isText) items.push({ key: 'quote', label: '引用', icon: B.quote });
    items.push({ key: 'multi', label: '多选', icon: B.multi });
    items.push({ key: 'recall', label: '撤回', icon: B.recall });
    items.push({ key: 'forward', label: '转发', icon: B.forward });
    items.push({ key: 'fav', label: isMsgFavorited('wx', m.id) ? '已收藏' : '收藏', icon: B.fav, filled: isMsgFavorited('wx', m.id) });
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

  /** 转发目标：微信好友 + 自己（单聊目标）+ 其他微信群（同宿主 App；与单聊/其他群的数据隔离不变） */
  const forwardTargets = useMemo<Array<FwdSheetTarget & { kind: 'contact' | 'group' }>>(() => {
    const self = contacts.find((c) => c.id === me.id);
    const contactList: Array<FwdSheetTarget & { kind: 'contact' | 'group' }> = contacts
      .filter((c) => c.kind !== 'user' && c.id !== me.id && isFriendIn(c, 'wx'))
      .map((c) => ({ id: c.id, name: c.name, avatar: c.avatar, kind: 'contact' }));
    if (self) contactList.unshift({ id: self.id, name: self.name, avatar: self.avatar, self: true, kind: 'contact' });
    const groupList = listGroups('wx')
      .filter((g) => g.id !== gid)
      .map((g) => ({ id: g.id, name: g.name, avatar: g.avatar, kind: 'group' as const }));
    return [...contactList, ...groupList];
  }, [contacts, me.id, gid]);

  /** 群内克隆（转发到另一个群）：文本 → 转发卡片；表情/图片/位置 → 同类型消息；合并卡片原样保留；
   *  红包/转账 → 占位文本卡片（不克隆活卡，不动资金）；语音 → 占位文本卡片（转写文本或 [语音]） */
  const groupForwardClone = (m: WxGroupMsg): WxGroupMsg => {
    const base = { id: uid(), role: 'me' as const, senderId: 'me', senderName: me.name, time: Date.now() };
    if (m.fwd?.merged) return { ...base, content: m.content, kind: 'forward', fwd: { from: m.fwd.from, merged: true, title: m.fwd.title, records: m.fwd.records } };
    if (m.kind === 'sticker' && m.stk) return { ...base, content: '', kind: 'sticker', stk: { url: m.stk.url, meaning: m.stk.meaning } };
    if (m.kind === 'image' && m.img) return { ...base, content: '', kind: 'image', img: { ...m.img } };
    if (m.kind === 'location' && m.loc) return { ...base, content: '', kind: 'location', loc: { ...m.loc } };
    const isCard = m.kind === 'redpacket' || m.kind === 'transfer' || m.kind === 'voice';
    return { ...base, content: isCard ? msgSnapshotOf(m) : m.content, kind: 'forward', fwd: { from: group.name }, quote: m.quote };
  };

  /** 单聊克隆（转发到微信好友/自己）：产出 wechat.tsx WxMsg 兼容对象（新 id、role=me、保留引用）；
   *  语音 → 占位文本卡片（转写文本或 [语音]；WxSingleMsgShape 不含 voice 字段，不跨会话克隆音频） */
  const singleForwardClone = (m: WxGroupMsg): WxSingleMsgShape => {
    const base = { id: uid(), role: 'me' as const, time: Date.now() };
    if (m.fwd?.merged) return { ...base, content: m.content, kind: 'forward', fwd: { from: m.fwd.from, merged: true, title: m.fwd.title, records: m.fwd.records } };
    if (m.kind === 'sticker' && m.stk) return { ...base, content: '', kind: 'sticker', stk: { url: m.stk.url, meaning: m.stk.meaning } };
    if (m.kind === 'image' && m.img) return { ...base, content: '', kind: 'image', img: { ...m.img } };
    if (m.kind === 'location' && m.loc) return { ...base, content: '', kind: 'location', loc: { ...m.loc } };
    const isCard = m.kind === 'redpacket' || m.kind === 'transfer' || m.kind === 'voice';
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

  /** 执行转发（逐条/合并；目标 = 微信好友/自己 或 其他微信群）：
   *  单聊目标写 wx-chat-msgs 存储（与单聊同键）+ 未读角标 + AI 感知事件；群目标写目标群消息库 + 未读角标 */
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
      wxUnreads.bump(groupRowId(target.id), clones.length);
    } else {
      if (mode === 'each') {
        saveWxSingleMsgs(target.id, [...loadWxSingleMsgs(target.id), ...list.map(singleForwardClone)]);
      } else {
        const title = fwdRecordTitle(me.name, group.name);
        const card: WxSingleMsgShape = {
          id: uid(),
          role: 'me',
          content: title,
          time: Date.now(),
          kind: 'forward',
          fwd: { from: group.name, merged: true, title, records: mergedRecordsOf(list) },
        };
        saveWxSingleMsgs(target.id, [...loadWxSingleMsgs(target.id), card]);
      }
      wxUnreads.bump(target.id, mode === 'each' ? list.length : 1);
      if (target.id !== me.id) {
        const lines = list
          .slice(-8)
          .map((m) => `${m.role === 'me' ? me.name : m.senderName || '群友'}：${msgSnapshotOf(m)}`)
          .join(' ／ ')
          .slice(0, 240);
        pushWxAiEvent(
          target.id,
          `（系统事件：用户把来自「${group.name}」群聊的 ${list.length} 条消息${mode === 'merge' ? '合并转发' : '逐条转发'}给你了：${lines}。请用符合人设的一两句话自然回应这条转发。）`
        );
      }
    }
    setFwdFlow(null);
    exitSelect();
    onToast(target.self ? '已转发给自己' : `已转发给 ${target.name}`);
  };

  /** 从群记录里移除消息（单条删除/批量删除共用；只动选中的消息，不碰其他成员的消息）。
   *  一.5 引用联动：被删消息若被其他消息引用，引用内容改写为「原消息已删除」（引用关系用 quote.id 关联） */
  const removeMsgs = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const set = new Set(ids);
      const next = loadGroupMsgs(gid)
        .filter((m) => !set.has(m.id))
        .map((m) =>
          m.quote?.id && set.has(m.quote.id) ? { ...m, quote: { ...m.quote, content: '原消息已删除' } } : m
        );
      saveGroupMsgs(gid, next);
      if (mountedRef.current) setMsgs(next);
    },
    [gid]
  );

  /** 撤回消息的引用联动（一.5 同规则：撤回后原内容不再可见，引用显示「原消息已删除」） */
  const recallMsg = useCallback(
    (mid: string) => {
      const next = loadGroupMsgs(gid).map((m) => {
        if (m.id === mid) return { ...m, recalled: true };
        if (m.quote?.id && m.quote.id === mid && !m.recalled) return { ...m, quote: { ...m.quote, content: '原消息已删除' } };
        return m;
      });
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
      case 'stt': {
        // 语音消息「转文字」：已有结果 → 提示；否则现场识别，失败可重试（与单聊同文案）
        const v = m.voice;
        if (!v) break;
        if (v.stt === 'done' && v.transcript) {
          onToast('转文字结果已显示在气泡下方');
          break;
        }
        onToast('正在转文字…');
        void (async () => {
          try {
            const blob = await (await fetch(v.url)).blob();
            const text = await transcribeAudioBlob(blob);
            if (!text) {
              onToast('转文字失败，请重试');
              return;
            }
            patchGroupMsg(m.id, { voice: { ...v, transcript: text, stt: 'done' as const } });
            onToast('已转文字');
          } catch {
            onToast('转文字失败，请重试');
          }
        })();
        break;
      }
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
        // 群聊引用带发言人：显示引用的是谁的消息（id 带上源消息，删除/撤回后显示「原消息已删除」）
        setQuote({ name: m.role === 'me' ? '我' : m.senderName || '群友', content: msgSnapshotOf(m), id: m.id, time: m.time });
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
        // 二.3/二.5：撤回不删原始记录（标记 recalled 渲染为居中灰字「谁撤回了一条消息」）；引用联动改写
        recallMsg(m.id);
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
        if (isMsgFavorited('wx', m.id)) {
          unfavoriteMsg('wx', m.id);
          onToast('取消收藏');
          break;
        }
        addFavorite('wx', favOf(m));
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
    const fresh = list.filter((m) => !isMsgFavorited('wx', m.id));
    if (fresh.length === 0) {
      onToast('所选消息均已收藏');
      exitSelect();
      return;
    }
    for (const m of fresh) addFavorite('wx', favOf(m));
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
  const rpComposeLayer = layer?.view === 'rp-compose' ? layer : null;
  const layerMsg = layer && 'msgId' in layer ? msgs.find((m) => m.id === layer.msgId) ?? null : null;

  /** 消息行外层（头像 + 发言者名；文字与富媒体共用同一套行几何；多选模式下行首插入勾选圈） */
  /** 发言者身份徽标文案（群主/管理员；普通成员 null） */
  const roleLabelOfId = (id: string): string | null => {
    const role = groupRoleOf(group, id);
    return role === 'member' ? null : role === 'owner' ? '群主' : '管理员';
  };
  const renderMsgRow = (m: WxGroupMsg, media?: React.ReactNode) => {
    const mine = m.role === 'me';
    const sender = mine ? null : m.senderId === 'unknown' ? null : memberById.get(m.senderId) ?? null;
    const senderAvatar = mine ? me.avatar : sender?.avatar ?? null;
    const roleLabel = roleLabelOfId(mine ? me.id : m.senderId);
    return (
      <div className={`mb-3 flex items-start gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
        {selectMode && isSelectable(m) && (
          <span
            aria-hidden="true"
            data-testid={`wx-grp-select-${m.id}`}
            className={`mt-2 flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border ${
              fwdFlow === 'choose' && mine ? 'order-last' : ''
            } ${selectedIds.includes(m.id) ? 'border-[#07C160] bg-[#07C160] text-white' : 'border-black/25 dark:border-white/35'}`}
          >
            {selectedIds.includes(m.id) && <Check className="h-[13px] w-[13px]" strokeWidth={3} />}
          </span>
        )}
        <WxAvatar src={senderAvatar} alt={mine ? me.name : m.senderName} size={38} />
        <div className={`flex min-w-0 max-w-[calc(100%-92px)] flex-col ${mine ? 'items-end' : 'items-start'}`}>
          {/* 发言者名字（含机主自己）+ 群主/管理员徽标 */}
          <span className="mb-0.5 flex max-w-full items-center gap-1 px-1 text-[12px] leading-none text-black/40 dark:text-white/40">
            <span className="truncate">{mine ? me.name : m.senderName}</span>
            {roleLabel && (
              <span
                className={`shrink-0 rounded-[3px] px-1 text-[9px] leading-[14px] ${
                  roleLabel === '群主' ? 'bg-[#FA9D3B]/15 text-[#D07818]' : 'bg-[#07C160]/15 text-[#0C8B4D]'
                }`}
              >
                {roleLabel}
              </span>
            )}
          </span>
          {/* 引用块（截图样式）：独立半透明胶囊统一挂在气泡/卡片下方（「名字：内容」，小圆角 + 细黑边框）；
              文字/图片/红包等全部走这里（转发卡片自带引用展示，排除避免双渲染） */}
          {media}
          {m.quote && m.kind !== 'forward' && (
            <div
              data-testid="wx-grp-quote-block"
              className="mt-[3px] max-w-full overflow-hidden rounded-[4px] border border-black/25 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/25 dark:bg-white/[0.13] dark:text-white/60"
            >
              <p className="line-clamp-2 whitespace-pre-wrap break-all">
                {m.quote.name}：{m.quote.content}
              </p>
            </div>
          )}
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
      {/* 顶栏：与消息区/输入栏同色无边框（同私聊）；多选模式下变为「取消 + 已选计数」操作栏（与单聊一致） */}
      <div className="relative z-10 shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
        {selectMode ? (
          <div className="flex h-11 items-center px-2">
            <button type="button" data-testid="wx-grp-select-cancel" onClick={exitSelect} className="flex items-center px-1 text-[16px] active:opacity-50">
              取消
            </button>
            <div className="flex flex-1 items-center justify-center">
              <span data-testid="wx-grp-select-count" className="text-[17px] font-medium">
                {fwdFlow === 'choose' ? '已选择' : '已选'} {selectedIds.length} 条消息
              </span>
            </div>
            {fwdFlow === 'choose' ? (
              <button
                type="button"
                aria-label="搜索"
                data-testid="wx-grp-fwd-search"
                onClick={() => onToast('搜索转发消息暂未开放')}
                className="flex w-[68px] justify-end px-2 active:opacity-50"
              >
                <Search className="h-[19px] w-[19px]" strokeWidth={2} />
              </button>
            ) : (
              <div className="w-[68px]" />
            )}
          </div>
        ) : (
        <div className="flex h-11 items-center px-2">
          <button type="button" aria-label="返回" onClick={onBack} className="flex items-center px-1 active:opacity-50">
            <ChevronLeft className="h-7 w-7" strokeWidth={2} />
          </button>
          <button type="button" onClick={onOpenInfo} data-testid="wx-groupchat-openinfo" className="flex min-w-0 flex-1 items-center justify-center gap-1.5 active:opacity-60">
            <span className="max-w-[220px] truncate text-[17px] font-medium">{groupDisplayName(group)}({members.length + 1})</span>
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
        )}
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
                {showTime && (
                  <div className="pb-1.5">
                    <span className="inline-block rounded-[4px] border border-black/25 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/25 dark:bg-white/[0.13] dark:text-white/60">{fmtGroupTime(m.time)}</span>
                  </div>
                )}
                {m.notice ? (
                  <WxNoticeRow icon={m.notice.icon} pre={m.notice.pre} accent={m.notice.accent} />
                ) : (
                  <span className="inline-block max-w-[280px] truncate rounded-[4px] border border-black/25 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/25 dark:bg-white/[0.13] dark:text-white/60">
                    {m.noticeText ?? m.content}
                  </span>
                )}
              </div>
            );
          }
          const mine = m.role === 'me';
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
              {showTime && (
                <div className="py-2 text-center">
                  <span className="inline-block rounded-[4px] border border-black/25 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/25 dark:bg-white/[0.13] dark:text-white/60">{fmtGroupTime(m.time)}</span>
                </div>
              )}
              {m.recalled ? (
                <div className="py-1.5 text-center">
                  <span className="inline-block max-w-[280px] truncate rounded-[4px] border border-black/25 bg-white/75 px-2 py-[3px] text-[12px] leading-[1.4] text-black/50 dark:border-white/25 dark:bg-white/[0.13] dark:text-white/60">
                    {mine ? '你撤回了一条消息' : `"${m.senderName || '有人'}" 撤回了一条消息`}
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
                    status={groupTrStatusText(m.tr)}
                    received={m.tr.received === true}
                    refunded={m.tr.status === 'returned'}
                    fromMe={m.role === 'me'}
                    note={m.tr.note || undefined}
                    settled={Boolean(m.tr.received || m.tr.status)}
                    onClick={() => setLayer({ view: 'tr-detail', msgId: m.id })}
                  />
                )
              ) : m.kind === 'forward' && m.fwd?.merged ? (
                /* 合并转发「聊天记录」卡片（与单聊同款：标题 + 逐条预览 + 「聊天记录」脚注；点击进详情） */
                renderMsgRow(
                  m,
                  <div
                    data-testid="wx-grp-forward-bubble"
                    onClick={() => {
                      if (!selectMode) setFwdDetailId(m.id);
                    }}
                    className={`relative w-fit max-w-full select-none rounded-[5px] px-3 py-2 text-black dark:bg-[#1E1E1E] dark:text-white ${
                      mine ? 'bg-[#95EC69] dark:bg-[#3EB575]' : 'bg-white'
                    }`}
                  >
                    <p className="text-[15.5px] font-semibold leading-[1.35]">{m.fwd.title ?? m.content}</p>
                    <div className="mt-1 space-y-[1px] text-[13.5px] leading-[1.5] text-black/55 dark:text-white/60">
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
                    data-testid="wx-grp-forward-bubble"
                    className={`relative w-fit max-w-full select-none rounded-[5px] px-3 py-2 ${
                      mine ? 'bg-[#95EC69] text-black dark:bg-[#3EB575]' : 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white'
                    }`}
                  >
                    <div className="line-clamp-8 whitespace-pre-wrap break-words border-l-2 border-black/25 pl-2 text-[14px] leading-[1.4]">
                      {m.quote && (
                        <span className="mb-0.5 block text-[12px] text-black/50 dark:text-black/55">
                          {m.quote.name}：{m.quote.content}
                        </span>
                      )}
                      {m.content}
                    </div>
                  </div>
                )
              ) : m.kind === 'voice' && m.voice ? (
                /* 语音消息：播放/暂停 + 波形 + 时长（theme wx：我方绿/对方白，与单聊一致）；
                   长按菜单由外层行容器的 bubblePress 提供（转文字/复制/…），转写结果显示在气泡下方 */
                renderMsgRow(m, <VoiceMsgBubble msgId={m.id} voice={m.voice} side={mine ? 'me' : 'peer'} theme="wx" />)
              ) : (
                renderMsgRow(
                  m,
                  <>
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
                      <span className="whitespace-pre-wrap break-words">{cleanBubbleText(m.content)}</span>
                    </div>
                    {/* 语音播放：按发言人角色音色朗读（senderId 对应联系人 voiceId → 全局默认 → 安全默认） */}
                    {!mine && m.content && (
                      <VoicePlayButton
                        contactId={m.senderId === 'me' ? null : m.senderId}
                        text={m.content}
                        className="mt-[3px]"
                        onError={() => onToast('语音播放失败，请检查「语音 API」配置')}
                      />
                    )}
                  </>,
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
                        <span className="mb-0.5 flex max-w-full items-center gap-1 px-1 text-[12px] leading-none text-black/40 dark:text-white/40">
                          <span className="truncate">{speaker ? memberNameOf(speaker) : '…'}</span>
                          {speaker && roleLabelOfId(speaker.id) && (
                            <span
                              className={`shrink-0 rounded-[3px] px-1 text-[9px] leading-[14px] ${
                                roleLabelOfId(speaker.id) === '群主' ? 'bg-[#FA9D3B]/15 text-[#D07818]' : 'bg-[#07C160]/15 text-[#0C8B4D]'
                              }`}
                            >
                              {roleLabelOfId(speaker.id)}
                            </span>
                          )}
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
                        <span className="mb-0.5 flex max-w-full items-center gap-1 px-1 text-[12px] leading-none text-black/40 dark:text-white/40">
                          <span className="truncate">{speaker ? memberNameOf(speaker) : '…'}</span>
                          {speaker && roleLabelOfId(speaker.id) && (
                            <span
                              className={`shrink-0 rounded-[3px] px-1 text-[9px] leading-[14px] ${
                                roleLabelOfId(speaker.id) === '群主' ? 'bg-[#FA9D3B]/15 text-[#D07818]' : 'bg-[#07C160]/15 text-[#0C8B4D]'
                              }`}
                            >
                              {roleLabelOfId(speaker.id)}
                            </span>
                          )}
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

      {/* 输入区：与私聊同款灰底；@ 描边圆钮；表情/加号/图片/相机/位置与单聊完全对齐（共用同一套组件）；
          多选模式下变为批量删除/分享/收藏操作栏（与单聊一致） */}
      <div className="relative z-10 shrink-0 border-t border-black/[0.07] bg-[#EDEDED] dark:border-white/[0.06] dark:bg-[#111111]">
        {selectMode ? (
          <div className="flex items-center justify-around px-6 pb-[26px] pt-3" data-testid="wx-grp-select-bar">
            <button
              type="button"
              data-testid="wx-grp-select-del"
              disabled={selectedIds.length === 0}
              onClick={batchDelete}
              className="flex flex-col items-center gap-1 text-[12px] text-[#FA5151] disabled:opacity-35"
            >
              <Trash2 className="h-[21px] w-[21px]" strokeWidth={1.9} />
              删除
            </button>
            <button
              type="button"
              data-testid="wx-grp-select-forward"
              disabled={selectedIds.length === 0}
              onClick={batchForward}
              className="flex flex-col items-center gap-1 text-[12px] text-black/75 disabled:opacity-35 dark:text-white/75"
            >
              <Forward className="h-[21px] w-[21px]" strokeWidth={1.9} />
              分享
            </button>
            <button
              type="button"
              data-testid="wx-grp-select-fav"
              disabled={selectedIds.length === 0}
              onClick={batchFav}
              className="flex flex-col items-center gap-1 text-[12px] text-black/75 disabled:opacity-35 dark:text-white/75"
            >
              <Star className="h-[21px] w-[21px]" strokeWidth={1.9} />
              收藏
            </button>
          </div>
        ) : (
        <>
        {/* 六.5 禁言横幅：我被禁言时输入区上方提示（当前权限体系下机主通常为群主，此处为防御性支持） */}
        {meMuted && (
          <div className="px-2.5 pt-2" data-testid="wx-group-me-muted">
            <div className="flex items-center justify-center gap-1.5 rounded-[4px] border border-black/25 bg-white/75 px-2 py-1 text-[12px] text-black/50 dark:border-white/25 dark:bg-white/[0.13] dark:text-white/50">
              <MicOff className="h-3.5 w-3.5" />
              你已被禁言（{meMuteLeft ?? '永久'}），暂时无法发言
            </div>
          </div>
        )}
        {quote && (
          <div className="px-2.5 pt-2" data-testid="wx-group-quote-bar">
            <div className="flex items-start gap-2 rounded-[4px] border border-black/25 bg-white/75 px-2 py-1 dark:border-white/25 dark:bg-white/[0.13]">
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
                setVoiceMode(false);
                setAtOpen((v) => !v);
              }}
              className={`shrink-0 active:opacity-70 ${atOpen ? 'text-[#07C160]' : ''}`}
            >
              <span className="flex h-[35px] w-[35px] items-center justify-center rounded-full border-[1.5px] border-black/90 text-black/85 transition-colors active:bg-black/[0.06] dark:border-white/75 dark:text-white/85 dark:active:bg-white/10">
                <AtSign className="h-[19px] w-[19px]" strokeWidth={2} />
              </span>
            </button>
            {/* 语音输入切换（@ 旁边，与微信单聊同款声波圆钮）：语音模式下输入框替换为「按住 说话」胶囊 */}
            <button
              type="button"
              aria-label={voiceMode ? '切换到键盘输入' : '语音输入'}
              data-testid="wxg-voice-toggle"
              onClick={() => {
                setAtOpen(false);
                setStickerOpen(false);
                setPlusOpen(false);
                setVoiceMode((v) => !v);
              }}
              className="shrink-0 active:opacity-70"
            >
              <span
                className={`flex h-[35px] w-[35px] items-center justify-center rounded-full border-[1.5px] bg-transparent transition-colors active:bg-black/[0.06] dark:active:bg-white/10 ${
                  voiceMode
                    ? 'border-[#07C160] text-[#07C160]'
                    : 'border-black/90 text-black/85 dark:border-white/75 dark:text-white/85'
                }`}
              >
                <VoiceWaveGlyph size={20} />
              </span>
            </button>
            {voiceMode ? (
              /* 语音输入模式：按住说话（上滑/左滑取消，右滑转文字，松开发送；转写进群成员上下文） */
              <VoiceHoldBar rec={rec} testId="wxg-voice-hold" />
            ) : (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => {
                const v = e.target.value;
                setDraft(v);
                // 键入 @ 直接唤起成员浮层（微信/QQ 同款：点选后替换该 @ 并插入「@名字 」）
                if (v.endsWith('@')) {
                  setStickerOpen(false);
                  setPlusOpen(false);
                  setAtOpen(true);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder=""
              data-testid="wx-groupchat-input"
              className="h-[36px] min-w-0 flex-1 rounded-[5px] bg-white px-3 text-[16px] caret-[#07C160] outline-none ring-black/[0.06] transition-shadow focus-visible:ring-1 dark:bg-[#232323] dark:focus-visible:ring-white/[0.08]"
            />
            )}
            {draft.trim() || canDispatch ? (
              <>
                {/* 文字转语音开关（有文字时出现）：开启后发送的文字变为语音气泡（与单聊同款 AudioLines 图标） */}
                {draft.trim() ? (
                  <button
                    type="button"
                    aria-label={ttsSend ? '文字转语音发送：已开启，点击关闭' : '文字转语音发送：点击开启'}
                    data-testid="wxg-tts-toggle"
                    onClick={() => {
                      const nv = !ttsSend;
                      setTtsSend(nv);
                      onToast(nv ? '已开启文字转语音：发送后为语音气泡' : '已关闭文字转语音');
                    }}
                    className={`shrink-0 transition-colors active:opacity-60 ${ttsSend ? 'text-[#07C160]' : 'text-black/55 dark:text-white/55'}`}
                  >
                    <AudioLines className="h-[22px] w-[22px]" strokeWidth={ttsSend ? 2.1 : 1.7} />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={send}
                  disabled={streaming || runningRef.current}
                  data-testid="wx-groupchat-send"
                  aria-label="发送"
                  className="h-8 shrink-0 rounded-[4px] bg-[#07C160] px-4 text-[14px] font-medium text-white active:bg-[#06AD56] disabled:opacity-50"
                >
                  发送
                </button>
              </>
            ) : (
              <div className="flex shrink-0 items-center gap-4 text-black/80 dark:text-white/80">
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
            {/* @ 成员浮层（整屏宽：左右贴满屏幕、顶栏圆角贴住输入区） */}
            <div className="absolute bottom-full left-0 right-0 z-40 w-full overflow-hidden rounded-t-[14px] border-t border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#2C2C2C]">
              <div className="border-b border-black/5 px-4 py-2.5 text-[12px] text-black/40 dark:border-white/10 dark:text-white/40">
                @ 群成员（被 @ 的成员必答优先）
              </div>
              <div className="max-h-[280px] overflow-y-auto">
                {members.length === 0 && <div className="px-4 py-4 text-center text-[12px] text-black/40">群内还没有成员</div>}
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`wx-group-at-${m.id}`}
                    onClick={() => insertMention(m)}
                    className="flex w-full items-center gap-2.5 px-4 py-[9px] text-left active:bg-black/5 dark:active:bg-white/5"
                  >
                    <WxAvatar src={m.avatar} alt={m.name} size={32} />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{memberNameOf(m)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
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
        <GroupTrDetailPage
          tr={layerMsg.tr}
          fromName={layerMsg.role === 'me' ? me.name : layerMsg.senderName || '群友'}
          onBack={() => setLayer(null)}
          canAct={layerMsg.tr.toId === 'me' && !layerMsg.tr.received && !layerMsg.tr.status && layerMsg.senderId !== 'me'}
          onReceive={() => receiveGroupTr(layerMsg)}
          onReturn={() => returnGroupTr(layerMsg)}
        />
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

      {/* 编辑消息弹窗（长按菜单「编辑」；与单聊同款）：修改内容后更新该条消息并落盘 */}
      {editMsg && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 px-8" data-testid="wx-grp-edit-layer" onClick={() => setEditMsg(null)}>
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#2A2A2C]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pb-1 pt-4 text-center text-[16px] font-medium">编辑消息</p>
            <div className="px-4 pb-3 pt-2">
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={4}
                maxLength={2000}
                autoFocus
                data-testid="wx-grp-edit-input"
                className="w-full resize-none rounded-[8px] border border-black/10 bg-black/[0.03] px-2.5 py-2 text-[15px] leading-[1.45] outline-none focus:border-[#07C160] dark:border-white/15 dark:bg-white/[0.06]"
              />
            </div>
            <div className="flex border-t border-black/10 dark:border-white/10">
              <button
                type="button"
                onClick={() => setEditMsg(null)}
                className="h-11 flex-1 text-[16px] active:bg-black/5 dark:active:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="wx-grp-edit-save"
                onClick={saveEdit}
                className="h-11 flex-1 text-[16px] font-medium text-[#07C160] active:bg-black/5 dark:active:bg-white/10"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 转发方式弹层（多选底栏点「分享」图标才弹出：逐条转发 / 合并转发；与单聊同款） */}
      {selectMode && fwdFlow === 'choose' && (
        <div className="absolute inset-0 z-[60]" data-testid="wx-grp-fwd-choose-mask" onClick={() => setFwdFlow(null)}>
          <div
            className="absolute inset-x-3 bottom-[88px] overflow-hidden rounded-[14px] bg-white shadow-[0_8px_32px_rgba(0,0,0,0.20)] dark:bg-[#2C2C2C]"
            data-testid="wx-grp-fwd-choose-bar"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              data-testid="wx-grp-fwd-each"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setFwdMode('each');
                setFwdFlow('target');
              }}
              className={`w-full py-[15px] text-center text-[17px] ${
                selectedIds.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-black active:bg-black/[0.04] dark:text-white dark:active:bg-white/[0.06]'
              }`}
            >
              逐条转发
            </button>
            <button
              type="button"
              data-testid="wx-grp-fwd-merge"
              disabled={selectedIds.length === 0}
              onClick={() => {
                setFwdMode('merge');
                setFwdFlow('target');
              }}
              className={`w-full border-t border-black/[0.06] py-[15px] text-center text-[17px] dark:border-white/[0.08] ${
                selectedIds.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-black active:bg-black/[0.04] dark:text-white dark:active:bg-white/[0.06]'
              }`}
            >
              合并转发
            </button>
          </div>
        </div>
      )}

      {/* 转发目标选择（群聊特有：可选转发到微信好友/自己的单聊，或另一个微信群） */}
      {fwdFlow === 'target' && (
        <div
          className="absolute inset-0 z-[70] flex flex-col justify-end bg-black/40"
          data-testid="wx-grp-fwd-target-layer"
        >
          <div className="mx-2 mb-3 overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#1E1E1E]" onClick={(e) => e.stopPropagation()}>
            <p className="border-b border-black/[0.06] py-3 text-center text-[15px] font-medium dark:border-white/[0.08]">
              {fwdMode === 'merge' ? '合并转发给' : '逐条转发给'}
            </p>
            <div className="max-h-[46vh] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {forwardTargets.map((c) => (
                <button
                  key={`${c.kind}-${c.id}`}
                  type="button"
                  data-testid={`wx-grp-fwd-target-${c.id}`}
                  onClick={() => doForward(fwdMode, selectedIds, c)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  <WxAvatar src={c.avatar} alt={c.name} size={38} />
                  <span className="min-w-0 flex-1 truncate text-[15.5px]">
                    {c.id === me.id ? `${c.name}（我自己）` : c.name}
                    {c.kind === 'group' && <span className="ml-1.5 text-[11px] text-black/35 dark:text-white/40">群聊</span>}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              data-testid="wx-grp-fwd-back"
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
          <div className="absolute inset-0 z-[65] flex flex-col bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white" data-testid="wx-grp-fwd-detail">
            <div className="shrink-0 bg-[#EDEDED] pt-[54px] dark:bg-[#111111]">
              <div className="flex h-11 items-center px-2">
                <button type="button" aria-label="返回" data-testid="wx-grp-fwd-detail-back" onClick={() => setFwdDetailId(null)} className="active:opacity-60">
                  <ChevronLeft className="h-7 w-7" strokeWidth={2} />
                </button>
                <p className="min-w-0 flex-1 truncate pr-2 text-center text-[16px] font-medium">{d.fwd.title ?? '聊天记录'}</p>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
              <p className="py-3 text-center text-[13px] text-black/40 dark:text-white/40">{fwdRecordDate(records[0]?.time ?? d.time)}</p>
              <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
                {records.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 py-3">
                    <WxAvatar src={resolveAvatar(r)} alt={r.name} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[11.5px] text-black/40 dark:text-white/40">{r.name}</p>
                        <span className="shrink-0 text-[10.5px] text-black/30 dark:text-white/30">{fwdRecordTime(r.time)}</span>
                      </div>
                      {r.kind === 'sticker' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt={r.stkMeaning ? `表情：${r.stkMeaning}` : '表情'}
                          data-testid="wx-grp-fwd-detail-sticker"
                          className="mt-0.5 max-h-[96px] w-auto max-w-[110px] rounded-[8px] object-contain"
                          loading="lazy"
                        />
                      ) : r.kind === 'image' && r.imgSrc ? (
                        <img
                          src={r.imgSrc}
                          alt="图片消息"
                          data-testid="wx-grp-fwd-detail-image"
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

      {/* 按住说话全屏浮层（录音中显示：计时 + 实时波形 + 手势提示；与单聊同款） */}
      {rec.phase !== 'idle' && <RecordOverlay rec={rec} />}

      {/* 长按菜单（与单聊共用同一套组件，选项/样式/交互完全一致） */}
      {menu && menuRect && menuMsg && (
        <BubbleActionMenu pos={menuRect} items={buildMsgMenuItems(menuMsg)} onSelect={onMenuSelect} onClose={() => { setMenu(null); setMenuRect(null); }} testPrefix="wx-group" />
      )}
      {/* 页内 toast（微信根 toast 在群聊分支不渲染） */}
      <LocalToast msg={toastMsg} />
    </div>
  );
}
