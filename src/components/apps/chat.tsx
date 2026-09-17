'use client';

import { useLayoutEffect, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUp,
  ChevronRight,
  CircleCheck,
  EyeOff,
  Loader2,
  Mail,
  MailOpen,
  MessageCircle,
  Mic,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import { IOSBackButton, IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import { GlassButton } from '@/components/ios/GlassButton';
import { DefaultAvatar } from '@/components/apps/default-avatar';
import { useSettings, useUI } from '@/lib/ios/store';
import {
  beginChatStream,
  clearChatStream,
  isChatStreaming,
  useChatStream,
  useChatStreamFinalized,
  type ChatPayloadMessage,
} from '@/lib/chat-stream-store';
import { buildPersonaSystemPrompt } from '@/lib/ios/persona';
import { buildNpcPromptExtra, type NpcPromptExtra } from '@/lib/ios/npc-bond';
import { getReplyCount, buildReplyCountPrompt, splitReplySegments, splitReplyRender } from '@/lib/reply-count';
import { getTranslateCfg, saveTranslateCfg, requestTranslation, translateLangLabel, normalizeTranslateCfg, detectTranslateTarget, type ChatTranslateCfg } from '@/lib/chat-translate';
import { getSentenceSend, saveSentenceSend, hasPendingBatch, markPendingBatch } from '@/lib/sentence-send';
import { getStickersOn, saveStickersOn, STICKER_OFF_RULE } from '@/lib/sticker-toggle';
import { stripEmojiText } from '@/lib/emoji';
import { getTimeAware, setTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { memAfterAiTurn, memConvoFromRaw, memLastMsgId, memRecallBlock } from '@/lib/memory';
import { buildMomentsChatBlock } from '@/lib/moments';
import { ChatTranslatePage, SmsChatSettingsPage, WorldBookPickerPage } from './chat-settings';
import {
  WB_EMPTY_BLOCKS,
  applyWbUserBlocks,
  collectWbBlocks,
  getBoundBookIds,
  loadBooks,
  setBoundBookIds,
  wbScanText,
} from '@/lib/ios/worldbook';
import { deleteContact, listContacts, ownerRealName, contactRealName, updateContact } from '@/lib/ios/contacts-store';
import { displayNameOf, isFriendIn, withDisplayNames, type ContactRecord } from '@/lib/contacts';
import { chatBadge } from '@/lib/unread-store';
import { BUBBLE_MENU_ICONS, BubbleActionMenu, computeBubbleMenuPos, useBubbleLongPress, type BubbleMenuItem, type BubbleMenuPos } from './bubble-menu';

// ---------------- 类型与常量 ----------------

type TabKey = 'chats' | 'contacts';
type View = 'main' | 'add' | 'chat';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: number;
  /** 请求失败的消息（不参与上下文、红字显示） */
  error?: boolean;
  /** 引用回复（长按菜单「引用」后发送时带上；气泡内嵌小引用块；AI 上下文带引用前缀） */
  quote?: { name: string; content: string };
  /** 已撤回（渲染为居中灰字「你撤回一条消息 / 对方撤回一条消息」，不再参与上下文） */
  recalled?: boolean;
}

/** 小助手（内置 AI 联系人，回复由 /api/chat 按用户配置的 OpenAI 兼容接口流式提供） */
const ASSISTANT = {
  name: '小助手',
  phone: '10086',
  desc: 'AI 智能助理 · 随时在线',
} as const;

/** iMessage 己方气泡蓝（用户指定参考 iMessage 截图） */
const SELF_BLUE = '#007AFF';

const SEED_MSGS: ChatMsg[] = [
  {
    id: 'seed-1',
    role: 'assistant',
    content: '你好，欢迎来到Cove，我是你的AI小助手。聊天解闷、头脑风暴、算数查资料…有什么想问的随时发消息给我',
    time: 0,
  },
];

/** 本地持久化：小助手沿用旧 key 兼容历史记录；联系人会话按 id 分 key */
const LS_READ_KEY = 'ios-chat-assistant-read';
/** 小助手会话未读条数（AI 发了几条消息，主屏角标/会话行角标就是几；0 = 已读） */
const LS_UNREAD_N_KEY = 'ios-chat-assistant-unread-n';
const LS_HIDDEN_KEY = 'ios-chat-assistant-hidden';
const LS_PIN_KEY = 'ios-chat-assistant-pin';

function lsMsgsKey(sessionKey: string): string {
  return sessionKey === 'assistant' ? 'ios-chat-assistant-msgs' : `ios-chat-msgs:${sessionKey}`;
}

function loadMsgs(sessionKey: string): ChatMsg[] | null {
  try {
    // 持久化在 IndexedDB kv store（启动时由 idb-kv 从 localStorage 迁移，内存同步读）
    const parsed: unknown = kvGet<ChatMsg[]>(lsMsgsKey(sessionKey));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const ok = parsed.every(
      (m) =>
        m &&
        typeof m === 'object' &&
        typeof (m as ChatMsg).content === 'string' &&
        ((m as ChatMsg).role === 'user' || (m as ChatMsg).role === 'assistant')
    );
    if (!ok) return null;
    const msgs = (parsed as ChatMsg[]).slice(-100);
    // 欢迎语文案迁移：种子消息按固定 id 识别，旧文案就地替换为最新文案（用户消息不动）
    if (sessionKey === 'assistant' && msgs[0]?.id === SEED_MSGS[0].id && msgs[0].content !== SEED_MSGS[0].content) {
      msgs[0] = { ...msgs[0], content: SEED_MSGS[0].content };
    }
    return msgs;
  } catch {
    return null;
  }
}

function saveMsgs(sessionKey: string, msgs: ChatMsg[]): void {
  // 持久化写穿到 IndexedDB（内存同步，异步落盘）；旧 localStorage 键已由迁移器删除
  kvSet(lsMsgsKey(sessionKey), msgs.slice(-100));
}

/** 由联系人资料拼 AI 扮演人设（system prompt）：七要素结构化人设由全 App 共用模块组装；NPC 的归属者即聊天中用户扮演的对象；
 *  npcExtra：配角圈注入（CHAR=认识的配角/背景近况，NPC=归属者资料卡/背景近况），由 npc-bond 组装 */
function buildPersonaPrompt(c: ContactRecord, ownerName: string | null, npcExtra?: NpcPromptExtra | null): string {
  return buildPersonaSystemPrompt(c, {
    channel: '短信',
    userName: null,
    ownerName,
    ...npcExtra,
  });
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fmtTime(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDay(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 会话列表时间：今天显示 HH:MM，跨天显示 M月D日 */
function fmtListTime(t: number): string {
  if (!t) return '';
  return dayKey(t) === dayKey(Date.now()) ? fmtTime(t) : fmtDay(t);
}

/** 聊天日期分隔行文案（与微信聊天时间规则一致）：今天只显 HH:MM（不加日期）；
 *  昨天「昨天 HH:MM」；一周内（含前天）「星期X HH:MM」；一周前「M月D日 HH:MM」 */
function fmtChatStamp(t: number): string {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(t);
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `昨天 ${fmtTime(t)}`;
  if (now.getTime() - t < 7 * 86400000) return `星期${'日一二三四五六'[d.getDay()]} ${fmtTime(t)}`;
  return `${fmtDay(t)} ${fmtTime(t)}`;
}

// ---------------- 长按（微信风格菜单：记录触点与行位置） ----------------

/** 长按触发时的触点信息（x=视口横坐标，rowBottom=会话行底部视口纵坐标） */
interface LongPressPos {
  x: number;
  rowBottom: number;
}

function useLongPress(onFire: (pos: LongPressPos) => void, ms = 500) {
  const timer = useRef(0);
  const fired = useRef(false);
  const pos = useRef<LongPressPos>({ x: 0, rowBottom: 0 });
  const stop = () => window.clearTimeout(timer.current);
  useEffect(() => stop, []);
  return {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      fired.current = false;
      // rect 需在事件同步阶段捕获（timeout 里 currentTarget 已为 null）
      pos.current = { x: e.clientX, rowBottom: e.currentTarget.getBoundingClientRect().bottom };
      stop();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10);
        onFire(pos.current);
      }, ms);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    /** 长按已触发时拦截随后的 click（不打开会话） */
    onClickCapture: (e: MouseEvent) => {
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}

// ---------------- 日期分隔行（iMessage 风格） ----------------

function DaySeparator({ time }: { time: number }) {
  return (
    <div className="my-3.5 flex flex-col items-center gap-[3px]">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">iMessage</span>
      <span className="text-[11px] text-muted-foreground/80">{fmtChatStamp(time)}</span>
    </div>
  );
}

// ---------------- 气泡尾巴（与气泡同色的弧形小尾巴） ----------------

const TAIL_CLIP_LEFT = 'path("M12 0 L12 6 C11 12 7 16 0 18 C4 13 6 8 6 2 L6 0 Z")';
const TAIL_CLIP_RIGHT = 'path("M2 0 L2 6 C3 12 7 16 14 18 C10 13 8 8 8 2 L8 0 Z")';

// ---------------- 会话行 ----------------

function AssistantRow({
  preview,
  time,
  unreadCount,
  pinned,
  onOpen,
  onLongPress,
}: {
  preview: string;
  time: string;
  unreadCount: number;
  pinned: boolean;
  onOpen: () => void;
  onLongPress: (pos: LongPressPos) => void;
}) {
  const press = useLongPress(onLongPress);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="和小助手聊天"
      {...press}
      // 微信样式：置顶 = 整行灰底；按下高亮 = 同款灰色（按下瞬间像临时置顶）
      className={`relative flex w-full select-none items-center gap-3 px-4 py-2.5 text-left transition-colors ${
        pinned ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''
      } active:bg-black/[0.06] dark:active:bg-white/[0.08]`}
    >
      <DefaultAvatar size={52} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[15px] font-semibold">{ASSISTANT.name}</span>
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{time}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-[13px] leading-snug text-muted-foreground">{preview}</p>
          {unreadCount > 0 && (
            <span
              data-testid="sms-unread-badge"
              aria-label={`${unreadCount} 条未读`}
              className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#FF3B30] px-1 text-[11px] font-semibold leading-none text-white"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </div>
      {/* iOS 内缩式发丝分隔线 */}
      <span aria-hidden="true" className="absolute bottom-0 left-[76px] right-0 h-px bg-border/50" />
    </button>
  );
}

// ---------------- 微信风格长按菜单（深色浮层，横向图标+文字，锚定在会话卡片下方） ----------------

interface WxMenuItem {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}

/** 估算菜单总宽（CJK 字宽 ≈ 字号，每项左右 px-[13px]） */
function wxMenuWidth(labels: string[]): number {
  return labels.reduce((acc, l) => acc + l.length * 10.5 + 26, 0);
}

function WxLongPressMenu({
  pos,
  items,
  onClose,
}: {
  pos: { top: number; left: number; arrowX: number };
  items: WxMenuItem[];
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[70]" role="dialog" aria-label="会话操作菜单" aria-modal="true">
      {/* 透明遮罩：点击空白处关闭 */}
      <button type="button" aria-label="关闭菜单" onClick={onClose} className="absolute inset-0 cursor-default" />
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        className="absolute"
        style={{ top: pos.top, left: pos.left, transformOrigin: `${pos.arrowX + 5}px 0` }}
      >
        {/* 指向会话卡片的小箭头（与菜单同色） */}
        <span
          aria-hidden="true"
          className="absolute -top-[4.5px] z-10 h-[11px] w-[11px] rotate-45 rounded-[2px]"
          style={{ left: pos.arrowX, backgroundColor: 'rgba(44,44,46,0.97)' }}
        />
        <div
          className="relative flex items-stretch overflow-hidden rounded-[10px] shadow-2xl"
          style={{ backgroundColor: 'rgba(44,44,46,0.97)', backdropFilter: 'blur(20px)' }}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className={`flex flex-col items-center gap-[5px] px-[13px] pb-2 pt-[9px] text-white transition-colors active:bg-white/15 ${
                i > 0 ? 'border-l border-white/10' : ''
              }`}
            >
              <item.icon className="h-[19px] w-[19px]" strokeWidth={1.7} aria-hidden="true" />
              <span className="whitespace-nowrap text-[10.5px] leading-none">{item.label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ---------------- iOS 风格确认弹窗（App 容器内绝对定位，弹簧动画） ----------------

function IOSConfirmDialog({
  open,
  title,
  desc,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  desc?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="absolute inset-0 z-[80] flex items-center justify-center px-10"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <button type="button" aria-label="取消" onClick={onCancel} className="absolute inset-0 cursor-default bg-black/35" />
      <motion.div
        initial={{ opacity: 0, scale: 1.1 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 480, damping: 30 }}
        className="relative w-full max-w-[270px] overflow-hidden rounded-[14px] bg-[#f4f4f6]/95 text-center shadow-2xl backdrop-blur-2xl dark:bg-[#2a2a2c]/95"
      >
        <div className="px-4 pb-4 pt-[18px]">
          <p className="text-[16px] font-semibold leading-snug">{title}</p>
          {desc && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{desc}</p>}
        </div>
        <div className="flex border-t border-black/10 dark:border-white/10">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-[44px] flex-1 items-center justify-center border-r border-black/10 text-[16px] transition-colors active:bg-black/5 dark:border-white/10 dark:active:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex h-[44px] flex-1 items-center justify-center text-[16px] font-semibold text-[#FF3B30] transition-colors active:bg-black/5 dark:text-[#FF453A] dark:active:bg-white/10"
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ---------------- 聊天视图（iMessage 风格） ----------------

/** 聊天对端信息：顶栏标题（手机号）与头像 */
interface ChatPeer {
  title: string;
  avatarSrc: string | null;
  /** 对方名字（聊天设置页信息卡用；信息 App 内为昵称） */
  name?: string;
}

/** 当前聊天会话：'assistant' | 'c:<contactId>' */
interface ChatSession {
  key: string;
  peer: ChatPeer;
  systemPrompt: string | null;
}

function ChatView({
  storageKey,
  initialMsgs,
  onMsgsChange,
  peer,
  systemPrompt,
  onBack,
}: {
  /** 会话存储键：'assistant' | 'c:<contactId>'（key 变化 = 组件重挂载，互不串扰） */
  storageKey: string;
  initialMsgs: ChatMsg[];
  /** 消息变化回传父级（小助手会话用于列表预览；联系人会话不传） */
  onMsgsChange?: (msgs: ChatMsg[]) => void;
  peer: ChatPeer;
  /** 联系人聊天的 AI 人设（system 消息，随请求发送） */
  systemPrompt: string | null;
  onBack: () => void;
}) {
  const [input, setInput] = useState('');
  // 挂载时读本地记录；无记录（或被清空）则回落 initialMsgs
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => {
    const saved = loadMsgs(storageKey);
    return saved && saved.length ? saved : initialMsgs;
  });
  /** 全局流式回复状态（请求由 chat-stream-store 发起并接收，退出聊天页/退出 App 不中断） */
  const sessionKey = `sms:${storageKey}`;
  const stream = useChatStream(sessionKey);
  const streaming = stream?.status === 'streaming';
  const scrollRef = useRef<HTMLDivElement>(null);
  // 用户自己的 OpenAI 兼容接口配置（设置 › API 配置），聊天全部走该配置
  const apiConfig = useSettings((s) => s.apiConfig);
  /** 机主名字（记忆提取视角统一用：碎片一律用真实名字指代用户；设置 › Apple 账户可改） */
  const profileName = useSettings((s) => s.profile.name);
  /** 聊天设置页（顶栏摄像机图标进入）：翻译入口 + 分句发送开关 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 翻译页（设置页「翻译」进入的独立二级页，按会话隔离） */
  const [translateOpen, setTranslateOpen] = useState(false);
  /** 当前会话的翻译配置（开启后文字消息气泡下方显示所选语言的译文） */
  const [transCfg, setTransCfgState] = useState<ChatTranslateCfg>(() => getTranslateCfg(sessionKey));
  useEffect(() => {
    setTransCfgState(getTranslateCfg(sessionKey));
  }, [sessionKey]);
  /** 译文缓存（key = `${msgId}|${langCode}`）与失败标记（避免每帧重试） */
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [trFailed, setTrFailed] = useState<Record<string, boolean>>({});
  /** 分句发送开关（开启后连续发消息 AI 不回复，输入框为空再点一次发送才触发回复） */
  const [sentenceSend, setSentenceSendState] = useState(() => getSentenceSend(sessionKey));
  useEffect(() => {
    setSentenceSendState(getSentenceSend(sessionKey));
  }, [sessionKey]);
  /** 时间感知开关（本会话独立，发送时现场读取；见 @/lib/time-aware） */
  const [timeAware, setTimeAwareState] = useState(() => getTimeAware(sessionKey));
  useEffect(() => {
    setTimeAwareState(getTimeAware(sessionKey));
  }, [sessionKey]);
  /** 表情包开关（本会话独立，发送时现场读取；关闭后 AI 不发表情包也不发 emoji，见 @/lib/sticker-toggle；信息端无表情包，只约束 emoji） */
  const [stickersOn, setStickersOnState] = useState(() => getStickersOn(sessionKey));
  useEffect(() => {
    setStickersOnState(getStickersOn(sessionKey));
  }, [sessionKey]);
  /** 世界书挂载（仅联系人会话参与；AI 助手会话无人设不注入，见 @/lib/ios/worldbook） */
  const wbContactId = storageKey.startsWith('c:') ? storageKey.slice(2) : null;
  const [wbOpen, setWbOpen] = useState(false);
  const [wbBound, setWbBound] = useState<string[]>(() => (wbContactId ? getBoundBookIds(wbContactId) : []));
  useEffect(() => {
    setWbBound(wbContactId ? getBoundBookIds(wbContactId) : []);
  }, [wbContactId]);
  /** 分句发送批次「待 AI 回复」标记（跨页面切换持久，见 @/lib/sentence-send） */
  const [pendingDispatch, setPendingDispatch] = useState(() => hasPendingBatch(sessionKey));
  useEffect(() => {
    setPendingDispatch(hasPendingBatch(sessionKey));
  }, [sessionKey]);
  const onMsgsChangeRef = useRef(onMsgsChange);
  // ref 更新入 effect（react-hooks/refs：不在渲染期写 ref）
  useEffect(() => {
    onMsgsChangeRef.current = onMsgsChange;
  });

  // 消息回传父级（小助手会话列表预览）
  useEffect(() => {
    onMsgsChangeRef.current?.(msgs);
  }, [msgs]);

  // 本地持久化：流式中的 AI 回复不进本地 msgs（在全局 store 里），msgs 只含已落盘内容，直接保存
  useEffect(() => {
    saveMsgs(storageKey, msgs);
  }, [msgs, storageKey]);

  // 新消息/流式输出时自动滚到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, stream]);

  // 翻译：开启后把文字消息（最近 60 条，排除错误/兑底文案）按检测到的语言双向翻译成另一侧
  // （左侧语言的消息译成右侧，右侧语言的消息译成左侧）。缓存、并发闸、在途去重都在
  // @/lib/chat-translate 内部，这里只负责把结果写入组件状态
  useEffect(() => {
    if (!transCfg.on) return;
    const targets = msgs
      .filter((m) => !m.error && m.content.trim() && !m.content.startsWith('（AI'))
      .slice(-60);
    if (targets.length === 0) return;
    let alive = true;
    for (const m of targets) {
      const code = detectTranslateTarget(m.content, transCfg.left, transCfg.right);
      const key = `${m.id}|${code}`;
      if (translations[key] !== undefined || trFailed[key]) continue;
      requestTranslation({ text: m.content, lang: code, apiConfig })
        .then((text) => {
          if (alive) setTranslations((prev) => (prev[key] === text ? prev : { ...prev, [key]: text }));
        })
        .catch(() => {
          if (alive) setTrFailed((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
        });
    }
    return () => {
      alive = false;
    };
  }, [msgs, transCfg, translations, trFailed, apiConfig]);

  /** 气泡下方译文行（翻译开启时按消息语言显示对侧语言的译文，带语言名前缀） */
  const renderTranslations = (msgId: string, content: string, error?: boolean) => {
    if (error || !transCfg.on) return null;
    if (!content.trim() || content.startsWith('（AI')) return null;
    const code = detectTranslateTarget(content, transCfg.left, transCfg.right);
    const text = translations[`${msgId}|${code}`];
    if (typeof text !== 'string' || !text) return null;
    return (
      <p
        data-testid="sms-translate-row"
        className="mt-1 max-w-full whitespace-pre-wrap break-words text-[12.5px] leading-[1.45] text-muted-foreground"
      >
        {`${translateLangLabel(code)}：${text}`}
      </p>
    );
  };

  /** 全局流结束（成功/失败）：finalize 已把最终消息落盘，把落盘后的完整记录并回本地并清理流状态。
   *  useLayoutEffect + 微任务：渲染帧内完成同步避免气泡闪断；页面不在时流自然由 store 收尾，重进后走同逻辑 */
  useLayoutEffect(() => {
    if (!stream || stream.status === 'streaming') return;
    void Promise.resolve().then(() => {
      setMsgs((prev) => {
        const saved = loadMsgs(storageKey);
        if (!saved || saved.length === 0) return prev;
        // 按 id 合并：本地消息优先，落盘新增的只会是 AI 回复
        const ids = new Set(prev.map((m) => m.id));
        return [...prev, ...saved.filter((m) => !ids.has(m.id))];
      });
      clearChatStream(sessionKey);
    });
  }, [stream, sessionKey, storageKey]);

  /** AI 回合：把整轮流式请求交给全局 store（userMsg 为 null = 分句发送批次触发，消息早已入列）。
   *  流式接收、超时、错误处理、落盘全部在 chat-stream-store 内完成：退出聊天页不中断，重进从 store 读实时内容 */
  const startAiTurn = (userMsg: ChatMsg | null) => {
    const base = userMsg ? [...msgs, userMsg] : msgs;
    // 上下文：只带有效消息最近 20 条（已撤回的消息不再进入上下文；引用消息带引用前缀让 AI 感知）
    const history = base
      .filter((m) => !m.error && m.content && !m.recalled)
      .slice(-20)
      .map((m) => ({
        role: m.role,
        content: `${m.quote ? `（引用 ${m.quote.name}：「${m.quote.content}」）` : ''}${m.content}`,
      }));

    const aiId = uid();
    // 用户消息立即入列并落盘；AI 回复交给全局 store 流式接收（退出聊天页不中断），
    // 结束/失败后由 finalize 写入本会话聊天记录（与页面是否存活无关）
    if (userMsg) setMsgs((prev) => [...prev, userMsg]);

    // 联系人聊天：人设作为 system 消息插在上下文最前（/api/chat 支持 system 透传）
    // 回复条数（本会话独立设置；信息端未提供设置入口，未设置时保持 1 条的现状）
    const replyCount = systemPrompt ? getReplyCount(sessionKey, 1) : 1;
    // 记忆库：联系人会话召回记忆（storageKey 形如 c:<contactId>；AI 助手会话无联系人 → 不注入）
    const memContactId = storageKey.startsWith('c:') ? storageKey.slice(2) : null;
    const memoryBlock = memContactId
      ? memRecallBlock(
          memContactId,
          'sms',
          [userMsg?.content ?? '', ...base.slice(-6).map((m) => m.content)].filter(Boolean).join(' ')
        )
      : '';
    // 社交动态感知（四）：互通开关打开时把朋友圈/QQ动态注入 system（信息 App 无自有平台，
    // 关闭时不注入——动态属于社交平台，不属于短信）；用户广播动态首次被看到时懒写入该角色记忆
    const momentsBlock = memContactId
      ? buildMomentsChatBlock({
          contactId: memContactId,
          app: 'sms',
          userName: profileName,
          peer: { id: memContactId, name: peer.name ?? peer.title, nickname: null },
        })
      : '';
    // 时间感知（本会话独立开关，发送时现场读取；关闭时不注入任何时间信息，恢复普通聊天）：
    // 上次聊天间隔 = 该会话上一条消息时间戳（不含本轮刚发的消息）与当前时间的差值；
    // AI 助手会话（无人设）也注入时间块，让「现在几点」这类问题能答准
    const timeBlock = getTimeAware(sessionKey)
      ? buildTimeAwareBlock({ lastMsgTime: msgs.length > 0 ? msgs[msgs.length - 1].time : null })
      : '';
    // 世界书：仅联系人会话参与（AI 助手会话无联系人角色）；命中触发词条目按插入位置注入
    const wbBlocks = wbContactId
      ? collectWbBlocks(wbContactId, wbScanText([userMsg?.content, ...base.slice(-8).map((m) => m.content)]))
      : null;
    const charBlock =
      wbBlocks && systemPrompt
        ? [wbBlocks.beforeChar, systemPrompt, wbBlocks.afterChar].filter(Boolean).join('\n\n')
        : systemPrompt ?? '';
    const baseSys = [
      ...(wbBlocks ? [wbBlocks.beforeSystem] : []),
      charBlock,
      memoryBlock,
      momentsBlock,
      timeBlock,
      stickersOn ? '' : STICKER_OFF_RULE,
      ...(wbBlocks ? [wbBlocks.afterSystem] : []),
    ]
      .filter(Boolean)
      .join('\n\n');
    const sysContent = baseSys
      ? replyCount > 1
        ? `${baseSys}\n\n${buildReplyCountPrompt(replyCount)}`
        : baseSys
      : null;
    const payload: ChatPayloadMessage[] = applyWbUserBlocks(
      sysContent ? [{ role: 'system' as const, content: sysContent }, ...history] : history,
      wbBlocks ?? WB_EMPTY_BLOCKS,
    );
    const started = beginChatStream({
      sessionKey,
      aiMsgId: aiId,
      messages: payload,
      apiConfig,
      replyCount,
      finalize: ({ aiMsgId, content, error, startedAt }) => {
        if (error) {
          saveMsgs(storageKey, [
            ...(loadMsgs(storageKey) ?? []),
            { id: aiMsgId, role: 'assistant', content: error, time: startedAt, error: true },
          ]);
          return;
        }
        // 按边界（分隔标记/换行/句末标点，一句一条）切成多条消息：一条消息一个气泡、一条记录，各自带 createdAt（像真人连发）
        // 表情包开关关闭时：先去掉表情包类标记残留（信息端本就不解析标记），再硬性剥除 emoji（prompt 禁令之外的双保险）
        const segs = splitReplySegments(content, replyCount > 1).map((seg) =>
          stickersOn ? seg : stripEmojiText(seg.replace(/[[【]\s*(?:发送了表情包?|表情包?)(?:[:：][^\]】]*)?[\]】]/g, ' '))
        );
        let t = startedAt;
        const saved: ChatMsg[] = segs.map((seg, i) => {
          const msg: ChatMsg = {
            id: i === 0 ? aiMsgId : `${aiMsgId}-${i}`,
            role: 'assistant',
            content: seg || '（AI 暂时没有返回内容，稍后再试一次吧）',
            time: t,
          };
          t += 600 + Math.floor(Math.random() * 600);
          return msg;
        });
        saveMsgs(storageKey, [...(loadMsgs(storageKey) ?? []), ...saved]);
        // 记忆库：一轮对话结束 → 轮次计数与自动提取记忆碎片（AI 助手会话不参与；后台异步，失败静默）；
        // names：双方真实名字（与机主同源同规则：机主取 user 联系人 name，AI 取该联系人 name，均非昵称——
        // 展示层 withDisplayNames 会用昵称替换 name，不能进记忆），提取/总结 prompt 视角统一用（禁「对方/用户/我」混用）
        if (memContactId) {
          void Promise.all([ownerRealName(), contactRealName(memContactId)]).then(([owner, peerReal]) =>
            memAfterAiTurn(
              memContactId,
              'sms',
              apiConfig,
              () => memConvoFromRaw(loadMsgs(storageKey) ?? [], ''),
              () => memLastMsgId(loadMsgs(storageKey) ?? []),
              { user: owner || profileName, peer: peerReal || (peer.name ?? peer.title) }
            )
          );
        }
      },
    });
    // 极端竞态防御（同会话已有流在接收）：回滚这条用户消息，避免有去无回
    if (!started && userMsg) setMsgs((prev) => prev.filter((m) => m.id !== userMsg.id));
  };

  const send = () => {
    const text = input.trim();
    if (!text || isChatStreaming(sessionKey)) return;

    const userMsg: ChatMsg = { id: uid(), role: 'user', content: text, time: Date.now(), quote: quote ?? undefined };
    setInput('');
    setQuote(null);
    // 分句发送开启：只入列不触发回复，等输入框为空再点一次「发送」统一触发（真人把几句话拆开发完）
    if (sentenceSend) {
      setMsgs((prev) => [...prev, userMsg]);
      setPendingDispatch(true);
      markPendingBatch(sessionKey, true);
      return;
    }
    startAiTurn(userMsg);
  };

  /** 分句发送批次触发：把已发出的整批消息交给 AI 统一回复（输入框为空时点「发送」） */
  const dispatchBatch = () => {
    if (!pendingDispatch || isChatStreaming(sessionKey)) return;
    setPendingDispatch(false);
    markPendingBatch(sessionKey, false);
    startAiTurn(null);
  };

  /** 空输入时可点「发送」触发批次回复（分句发送开启且有未回复的批次） */
  const canDispatch = sentenceSend && pendingDispatch && !streaming;

  // ---------------- 气泡长按菜单：复制/删除/编辑/引用/多选/撤回（信息端无转发/收藏/重新生成） ----------------

  /** 轻量提示（复制/删除等动作反馈；信息端无全局 toast） */
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((m: string) => {
    setToastMsg(m);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 1500);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    []
  );

  /** 气泡长按菜单（横向弹窗）：消息 + 容器内坐标 */
  const [msgMenu, setMsgMenu] = useState<null | { msg: ChatMsg; pos: BubbleMenuPos }>(null);
  /** 编辑消息弹窗（菜单「编辑」）：原消息 + 草稿 */
  const [editMsg, setEditMsg] = useState<ChatMsg | null>(null);
  const [editDraft, setEditDraft] = useState('');
  /** 引用回复（输入框上方条；发送时挂到新消息上） */
  const [quote, setQuote] = useState<null | { name: string; content: string }>(null);
  /** 多选模式：勾选消息批量删除 */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** 聊天页根元素（长按菜单定位参照） */
  const pageRef = useRef<HTMLDivElement>(null);

  /** 引用人名：我的消息 → 「我」；对方 → 联系人名/手机号 */
  const quoteNameOf = (m: ChatMsg): string => (m.role === 'user' ? '我' : peer.name || peer.title);

  /** 按发送方组装长按菜单项（复制 删除 编辑 引用 多选 撤回） */
  const buildMsgMenuItems = (_m: ChatMsg): BubbleMenuItem[] => {
    const B = BUBBLE_MENU_ICONS;
    return [
      { key: 'copy', label: '复制', icon: B.copy },
      { key: 'del', label: '删除', icon: B.del, danger: true },
      { key: 'edit', label: '编辑', icon: B.edit },
      { key: 'quote', label: '引用', icon: B.quote },
      { key: 'multi', label: '多选', icon: B.multi },
      { key: 'recall', label: '撤回', icon: B.recall },
    ];
  };

  /** 气泡长按手势（fire 里用 data-mid 反查消息；多选模式下不弹菜单改为点选勾选） */
  const bubblePress = useBubbleLongPress((el) => {
    const mid = el.closest('[data-mid]')?.getAttribute('data-mid') ?? null;
    const msg = mid ? msgs.find((x) => x.id === mid) ?? null : null;
    if (!msg || msg.recalled) return;
    setMsgMenu({ msg, pos: computeBubbleMenuPos(el.getBoundingClientRect(), pageRef.current?.getBoundingClientRect() ?? null, 6) });
  }, !selectMode);

  /** 退出多选模式 */
  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelectedIds([]);
  }, []);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** 长按菜单动作分发（执行后关闭菜单） */
  const handleMenuAction = (key: string) => {
    const m = msgMenu?.msg ?? null;
    setMsgMenu(null);
    if (!m) return;
    switch (key) {
      case 'copy': {
        const t = m.content;
        const done = () => showToast('已拷贝');
        const fallback = () => {
          try {
            const ta = document.createElement('textarea');
            ta.value = t;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            done();
          } catch {
            showToast('拷贝失败');
          }
        };
        try {
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(t).then(done).catch(fallback);
          } else {
            fallback();
          }
        } catch {
          fallback();
        }
        break;
      }
      case 'del': {
        if (isChatStreaming(sessionKey)) {
          showToast('对方正在回复，请稍后再试');
          return;
        }
        setMsgs((prev) => prev.filter((x) => x.id !== m.id));
        showToast('已删除');
        break;
      }
      case 'edit':
        setEditMsg(m);
        setEditDraft(m.content);
        break;
      case 'quote':
        setQuote({ name: quoteNameOf(m), content: m.content });
        break;
      case 'multi':
        setSelectMode(true);
        setSelectedIds([m.id]);
        break;
      case 'recall': {
        if (isChatStreaming(sessionKey)) {
          showToast('对方正在回复，请稍后再试');
          return;
        }
        setMsgs((prev) => prev.map((x) => (x.id === m.id ? { ...x, recalled: true } : x)));
        showToast('已撤回');
        break;
      }
    }
  };

  /** 编辑保存：更新该条消息内容（quote 等字段保留），自动落盘 */
  const saveEdit = () => {
    const t = editDraft.trim();
    if (!editMsg) return;
    if (!t) {
      showToast('内容不能为空');
      return;
    }
    if (isChatStreaming(sessionKey)) {
      showToast('对方正在回复，请稍后再试');
      return;
    }
    setMsgs((prev) => prev.map((x) => (x.id === editMsg.id ? { ...x, content: t } : x)));
    setEditMsg(null);
    showToast('已修改');
  };

  /** 多选批量删除 */
  const batchDelete = () => {
    if (selectedIds.length === 0) return;
    if (isChatStreaming(sessionKey)) {
      showToast('对方正在回复，请稍后再试');
      return;
    }
    const ids = new Set(selectedIds);
    setMsgs((prev) => prev.filter((x) => !ids.has(x.id)));
    showToast(`已删除 ${selectedIds.length} 条消息`);
    exitSelect();
  };

  // iMessage 语义：「已送达」挂在最后一条己方消息下方
  const lastUserIdx = msgs.reduce((acc, m, idx) => (m.role === 'user' ? idx : acc), -1);

  return (
    <div ref={pageRef} className="relative flex h-full min-h-0 flex-col">
      {/* 顶栏：返回箭头 + 居中头像/手机号（不显示名字）+ 摄像机图标（聊天设置入口） */}
      <div className="z-20 shrink-0 border-b border-border/50 bg-background/80 pt-[54px] backdrop-blur-xl">
        <div className="relative flex h-[64px] items-center px-3">
          <IOSBackButton label="" onClick={onBack} />
          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
            {peer.avatarSrc ? (
              <img src={peer.avatarSrc} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <DefaultAvatar size={40} />
            )}
            <div className="mt-0.5 flex items-center gap-0.5 leading-none">
              <span className="text-[13px] font-semibold tabular-nums">{peer.title}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground/70" strokeWidth={2.5} aria-hidden="true" />
            </div>
          </div>
          <div className="ml-auto flex items-center">
            <button
              type="button"
              aria-label="聊天设置"
              data-testid="sms-chat-settings-entry"
              onClick={() => setSettingsOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-foreground active:bg-black/5"
            >
              <Video className="h-[22px] w-[22px]" strokeWidth={1.8} />
            </button>
          </div>
        </div>
      </div>

      {/* 消息流 */}
      <div
        ref={scrollRef}
        role="log"
        aria-label="聊天消息"
        aria-live="polite"
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-2 pt-1"
      >
        {msgs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2.5 pb-10">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
              <MessageCircle className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <p className="text-[14px] font-medium text-muted-foreground">发条短信打个招呼吧</p>
          </div>
        )}
        {msgs.map((m, i) => {
          const prev = i > 0 ? msgs[i - 1] : undefined;
          const next = i < msgs.length - 1 ? msgs[i + 1] : undefined;
          const newDay = prev === undefined || dayKey(prev.time) !== dayKey(m.time);
          const grouped = prev !== undefined && !newDay && prev.role === m.role;
          const lastOfGroup = next === undefined || next.role !== m.role;
          const mine = m.role === 'user';
          const text = m.content.trim();
          return (
            <div
              key={m.id}
              data-mid={m.id}
              onClickCapture={
                selectMode && !m.recalled
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleSelect(m.id);
                    }
                  : undefined
              }
            >
              {newDay && <DaySeparator time={m.time} />}
              {m.recalled ? (
                /* 已撤回：居中灰字胶囊（你撤回一条消息 / 对方撤回一条消息） */
                <div className="mt-2.5 flex justify-center" data-testid="sms-recall-row">
                  <span className="rounded-full bg-black/[0.06] px-3 py-1 text-[12px] text-muted-foreground dark:bg-white/[0.08]">
                    {mine ? '你撤回一条消息' : '对方撤回一条消息'}
                  </span>
                </div>
              ) : (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                className={`flex ${mine ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-[3px]' : 'mt-2.5'}`}
              >
                {selectMode && !mine && (
                  <span
                    aria-hidden="true"
                    data-testid={`sms-select-${m.id}`}
                    className={`mr-2 grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                      selectedIds.includes(m.id) ? 'border-[#007AFF] bg-[#007AFF] text-white' : 'border-black/25 dark:border-white/35'
                    }`}
                  >
                    {selectedIds.includes(m.id) && <CircleCheck className="h-[14px] w-[14px]" strokeWidth={2.2} />}
                  </span>
                )}
                {/* 内层收缩为气泡宽度（上限76%），让「已送达」能对齐气泡左缘 */}
                <div className={`flex max-w-[76%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <div
                      {...bubblePress}
                      className={`relative w-fit max-w-full select-none whitespace-pre-wrap break-words rounded-[18px] px-3.5 py-2 text-[15px] leading-[1.45] ${
                        mine
                          ? `bg-[#007AFF] text-white ${lastOfGroup ? 'rounded-br-[5px]' : ''}`
                          : `bg-muted text-foreground ${lastOfGroup ? 'rounded-bl-[5px]' : ''}`
                      }`}
                    >
                      {!mine && lastOfGroup && (
                        <span
                          aria-hidden="true"
                          className="absolute -left-[6px] bottom-0 h-[18px] w-[14px] bg-muted"
                          style={{ clipPath: TAIL_CLIP_LEFT }}
                        />
                      )}
                      {mine && lastOfGroup && (
                        <span
                          aria-hidden="true"
                          className="absolute -right-[6px] bottom-0 h-[18px] w-[14px] bg-[#007AFF]"
                          style={{ clipPath: TAIL_CLIP_RIGHT }}
                        />
                      )}
                      {/* 引用块（菜单「引用」发送的消息）：名字 + 内容小字嵌在气泡顶部 */}
                      {m.quote && (
                        <div
                          data-testid="sms-quote-block"
                          className={`mb-1 max-w-full overflow-hidden rounded-[8px] px-2 py-1 text-[12px] leading-[1.35] ${
                            mine ? 'bg-white/20 text-white/85' : 'bg-black/[0.06] text-black/55 dark:bg-white/10 dark:text-white/60'
                          }`}
                        >
                          <p className="line-clamp-2 whitespace-pre-wrap break-all">
                            {m.quote.name}：{m.quote.content}
                          </p>
                        </div>
                      )}
                      <span className={`relative ${m.error && !mine ? 'text-[#FF3B30]' : ''}`}>{text}</span>
                    </div>
                  {/* 翻译开启时在气泡下方显示所选语言的译文 */}
                  {renderTranslations(m.id, m.content, m.error && !mine)}
                  {/* iMessage：已送达挂在气泡下沿、小尾巴另一侧（气泡左下角，与气泡左缘对齐） */}
                  {mine && i === lastUserIdx && !m.error && (
                    <p className="mt-1 self-stretch pl-1 text-left text-[11px] leading-none text-muted-foreground">已送达</p>
                  )}
                </div>
                {selectMode && mine && (
                  <span
                    aria-hidden="true"
                    data-testid={`sms-select-${m.id}`}
                    className={`ml-2 grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full border ${
                      selectedIds.includes(m.id) ? 'border-[#007AFF] bg-[#007AFF] text-white' : 'border-black/25 dark:border-white/35'
                    }`}
                  >
                    {selectedIds.includes(m.id) && <CircleCheck className="h-[14px] w-[14px]" strokeWidth={2.2} />}
                  </span>
                )}
              </motion.div>
              )}
            </div>
          );
        })}
        {/* 全局流式回复气泡（聊天页外发起的流 / 退出后重进同样从这里实时渲染；
            iMessage 语义：未收到内容时显示打字中动画，收到后变为流式文本气泡）。
            回复条数 > 1 时按边界（标记/换行/句末标点，一句一条）实时切成多个气泡，下一句没打完时显示打字中动画（一句一句连发节奏） */}
        {stream && stream.status === 'streaming' &&
          (() => {
            const split = splitReplyRender(stream.content, (stream.replyCount ?? 1) > 1);
            const dots = (
              <div className="relative rounded-[18px] rounded-bl-[5px] bg-muted px-4 py-3.5">
                <span
                  aria-hidden="true"
                  className="absolute -left-[6px] bottom-0 h-[18px] w-[14px] bg-muted"
                  style={{ clipPath: TAIL_CLIP_LEFT }}
                />
                <div className="flex items-center gap-1">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70"
                      style={{ animationDelay: `${d * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            );
            return (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                className="mt-2.5 flex justify-start"
                data-testid="sms-stream-bubble"
              >
                <div className="flex max-w-[76%] flex-col items-start">
                  {split.texts.map((t, i) => {
                    const lastOfGroup = i === split.texts.length - 1 && !split.pending;
                    return (
                      <div
                        key={i}
                        data-testid={`sms-stream-bubble-${i}`}
                        className="relative mb-[3px] w-fit max-w-full whitespace-pre-wrap break-words rounded-[18px] bg-muted px-3.5 py-2 text-[15px] leading-[1.45] text-foreground last:mb-0"
                      >
                        {lastOfGroup && (
                          <span
                            aria-hidden="true"
                            className="absolute -left-[6px] bottom-0 h-[18px] w-[14px] bg-muted"
                            style={{ clipPath: TAIL_CLIP_LEFT }}
                          />
                        )}
                        <span className="relative">{stickersOn ? t : stripEmojiText(t)}</span>
                      </div>
                    );
                  })}
                  {(split.pending || split.texts.length === 0) && (
                    <div data-testid="sms-stream-typing">{dots}</div>
                  )}
                </div>
              </motion.div>
            );
          })()}
        <div aria-hidden="true" className="h-1" />
      </div>

      {/* 输入栏（多选模式下变为批量删除操作栏）：引用条 + 圆钮 / iMessage输入框（麦克风↔发送） */}
      {selectMode ? (
        <div
          className="z-20 flex shrink-0 items-center justify-between border-t border-border/50 bg-background/85 px-6 pb-[30px] pt-2 backdrop-blur-xl"
          data-testid="sms-select-bar"
        >
          <button type="button" data-testid="sms-select-cancel" onClick={exitSelect} className="text-[15px] text-muted-foreground">
            取消
          </button>
          <span className="text-[13px] text-muted-foreground">已选 {selectedIds.length} 条</span>
          <button
            type="button"
            data-testid="sms-select-del"
            disabled={selectedIds.length === 0}
            onClick={batchDelete}
            className="text-[15px] font-medium text-[#FF3B30] disabled:opacity-40"
          >
            删除{selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
          </button>
        </div>
      ) : (
      <>
      {/* 引用条（长按菜单「引用」后显示在输入栏上方；发送时挂到新消息上） */}
      {quote && (
        <div
          className="z-20 flex shrink-0 items-start gap-2 border-t border-border/50 bg-background/85 px-3 py-1.5 backdrop-blur-xl"
          data-testid="sms-quote-bar"
        >
          <p className="min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-muted-foreground">
            引用 {quote.name}：{quote.content}
          </p>
          <button
            type="button"
            aria-label="取消引用"
            data-testid="sms-quote-cancel"
            onClick={() => setQuote(null)}
            className="shrink-0 text-muted-foreground/70"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      )}
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (input.trim()) void send();
          else dispatchBatch();
        }}
        className="z-20 flex shrink-0 items-center gap-2 border-t border-border/50 bg-background/85 px-2.5 pb-[30px] pt-2 backdrop-blur-xl"
      >
        <div
          aria-hidden="true"
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-border/50 bg-card/60 text-muted-foreground backdrop-blur-xl"
        >
          <Plus className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="flex h-[36px] min-w-0 flex-1 items-center rounded-full border border-border/70 bg-background pl-3.5 pr-1.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="iMessage信息"
            aria-label="消息输入框"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/50"
          />
          {(input.trim() || canDispatch) ? (
            <button
              type="submit"
              aria-label={input.trim() ? '发送' : '发送（让对方回复）'}
              disabled={streaming}
              className="flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full text-white transition active:scale-90 disabled:opacity-40"
              style={{ backgroundColor: SELF_BLUE }}
            >
              {streaming ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} aria-hidden="true" />
              ) : (
                <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.6} aria-hidden="true" />
              )}
            </button>
          ) : (
            <Mic aria-hidden="true" className="mx-1.5 h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.8} />
          )}
        </div>
      </form>
      </>
      )}

      {/* 聊天设置页（顶栏摄像机图标进入）：翻译入口 + 分句发送开关 */}
      {settingsOpen && (
        <SmsChatSettingsPage
          peerName={peer.name ?? peer.title}
          peerAvatar={peer.avatarSrc}
          phone={peer.title}
          translateSummary={
            transCfg.on
              ? `${translateLangLabel(transCfg.left)} ⇄ ${translateLangLabel(transCfg.right)}`
              : '未开启'
          }
          sentenceSend={sentenceSend}
          timeAware={timeAware}
          stickersOn={stickersOn}
          worldBooksSummary={
            wbContactId
              ? loadBooks()
                  .filter((b) => wbBound.includes(b.id))
                  .map((b) => b.name)
                  .join('、') || '未选择'
              : '未选择'
          }
          onBack={() => setSettingsOpen(false)}
          onOpenTranslate={() => setTranslateOpen(true)}
          onToggleSentenceSend={(v) => {
            saveSentenceSend(sessionKey, v);
            setSentenceSendState(v);
            if (!v) {
              // 关闭分句发送：清除待回复批次标记，后续发送恢复原有的即时回复行为
              markPendingBatch(sessionKey, false);
              setPendingDispatch(false);
            }
          }}
          onToggleTimeAware={(v) => {
            // 立即持久化并生效（下一次请求现场读取，无需重启）
            setTimeAware(sessionKey, v);
            setTimeAwareState(v);
          }}
          onToggleStickers={(v) => {
            // 立即持久化并生效（下一次请求现场读取，无需重启）：关闭后 AI 不发表情包也不发 emoji
            saveStickersOn(sessionKey, v);
            setStickersOnState(v);
          }}
          onOpenWorldBooks={wbContactId ? () => setWbOpen(true) : undefined}
        />
      )}

      {/* 世界书挂载页（聊天设置二级页，仅联系人会话）：为联系人勾选挂载的书籍 */}
      {wbOpen && wbContactId && (
        <WorldBookPickerPage
          variant="sms"
          books={loadBooks().map((b) => ({
            id: b.id,
            name: b.name,
            entryCount: b.entries.length,
            enabledCount: b.entries.filter((e) => e.enabled).length,
          }))}
          boundIds={wbBound}
          onBack={() => setWbOpen(false)}
          onChange={(ids) => {
            setBoundBookIds(wbContactId, ids);
            setWbBound(ids);
          }}
        />
      )}

      {/* 翻译语言页（聊天设置二级页）：总开关 + 语言对双侧选择（按会话隔离保存） */}
      {translateOpen && (
        <ChatTranslatePage
          variant="sms"
          cfg={transCfg}
          onBack={() => setTranslateOpen(false)}
          onChange={(next) => {
            const n = normalizeTranslateCfg(next);
            saveTranslateCfg(sessionKey, n);
            setTransCfgState(n);
          }}
        />
      )}

      {/* 编辑消息弹窗（长按菜单「编辑」）：修改内容后更新该条消息并落盘 */}
      {editMsg && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/35 px-8" data-testid="sms-edit-layer" onClick={() => setEditMsg(null)}>
          <div
            className="w-full max-w-[280px] overflow-hidden rounded-[14px] bg-[#f4f4f6]/95 shadow-2xl backdrop-blur-2xl dark:bg-[#2a2a2c]/95"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pb-1 pt-4 text-center text-[16px] font-semibold">编辑消息</p>
            <div className="px-4 pb-3 pt-2">
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={4}
                maxLength={2000}
                autoFocus
                data-testid="sms-edit-input"
                className="w-full resize-none rounded-[10px] bg-white px-2.5 py-2 text-[15px] leading-[1.45] outline-none dark:bg-black/30"
              />
            </div>
            <div className="flex border-t border-black/10 dark:border-white/10">
              <button
                type="button"
                onClick={() => setEditMsg(null)}
                className="h-[44px] flex-1 border-r border-black/10 text-[16px] active:bg-black/5 dark:border-white/10 dark:active:bg-white/10"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="sms-edit-save"
                onClick={saveEdit}
                className="h-[44px] flex-1 text-[16px] font-semibold text-[#007AFF] active:bg-black/5 dark:active:bg-white/10"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 气泡长按横向菜单（横向深色卡片；点菜单项执行动作，点空白处关闭） */}
      {msgMenu && (
        <BubbleActionMenu
          pos={msgMenu.pos}
          items={buildMsgMenuItems(msgMenu.msg)}
          onSelect={handleMenuAction}
          onClose={() => setMsgMenu(null)}
          testPrefix="sms-menu"
        />
      )}

      {/* 轻量提示（复制/删除等动作反馈） */}
      {toastMsg && (
        <div className="pointer-events-none absolute bottom-28 left-1/2 z-[90] -translate-x-1/2" data-testid="sms-toast">
          <span className="rounded-full bg-black/75 px-3.5 py-1.5 text-[13px] text-white shadow-lg dark:bg-white/85 dark:text-black">{toastMsg}</span>
        </div>
      )}
    </div>
  );
}

// ---------------- 添加好友（连接联系人 App：把创建好的 CHAR/NPC 加为好友） ----------------

/**
 * 添加好友页（「未添加好友」只能在这里添加/删除）：
 * - 「联系人」App 里创建了但尚未添加为好友的 CHAR/NPC，需输入 TA 的手机号搜索到后才能添加；
 *   也可以在这里直接删除这些未添加好友（二次确认，删除后联系人一并移除）
 * - 添加成功后：出现在联系人 App 主列表与信息 App（联系人面板 + 可发起聊天）
 */
function AddFriendView({
  contacts,
  onBack,
  onAddFriend,
  onDeleted,
}: {
  contacts: ContactRecord[];
  onBack: () => void;
  onAddFriend: (c: ContactRecord) => void;
  /** 删除成功：把该联系人（及其名下级联 NPC）从本地列表移除 */
  onDeleted: (c: ContactRecord) => void;
}) {
  const [query, setQuery] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  /** 刚添加成功的联系人名字（顶部成功提示条，2 秒后消失） */
  const [justAdded, setJustAdded] = useState<string | null>(null);
  /** 删除二次确认：当前处于「确认删除」状态的联系人 id（3 秒不点自动退回） */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** 刚删除成功的联系人名字（顶部提示条，2.4 秒后消失） */
  const [justDeleted, setJustDeleted] = useState<string | null>(null);

  const pending = useMemo(
    () => contacts.filter((c) => c.kind !== 'user' && !isFriendIn(c, 'sms')),
    [contacts]
  );
  /** 只有输入手机号才搜索（名字搜不到）：必须凭手机号才能找到待添加的好友 */
  const q = query.trim().toLowerCase();
  const filtered = q ? pending.filter((c) => (c.phone ?? '').toLowerCase().includes(q)) : [];

  // 成功提示自动消失 + 删除确认自动退回
  useEffect(() => {
    if (!justAdded) return;
    const t = window.setTimeout(() => setJustAdded(null), 2200);
    return () => window.clearTimeout(t);
  }, [justAdded]);
  useEffect(() => {
    if (!justDeleted) return;
    const t = window.setTimeout(() => setJustDeleted(null), 2400);
    return () => window.clearTimeout(t);
  }, [justDeleted]);
  useEffect(() => {
    if (!confirmId) return;
    const t = window.setTimeout(() => setConfirmId(null), 3000);
    return () => window.clearTimeout(t);
  }, [confirmId]);

  const add = async (c: ContactRecord) => {
    if (addingId) return;
    setAddingId(c.id);
    setError('');
    try {
      const updated = await updateContact(c.id, { friendSms: true });
      if (!updated) throw new Error('联系人不存在');
      onAddFriend(updated);
      setJustAdded(displayNameOf(updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败，请重试');
    } finally {
      setAddingId(null);
    }
  };

  /** 删除未添加好友（名下 NPC 级联删，本地完成），成功后同步本地列表 */
  const del = async (c: ContactRecord) => {
    if (deletingId) return;
    setDeletingId(c.id);
    setError('');
    try {
      const removed = await deleteContact(c.id);
      if (!removed) throw new Error('删除失败');
      onDeleted(c);
      setJustDeleted(c.name);
      setConfirmId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败，请重试');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <IOSNavBar
        large={false}
        title="添加好友"
        left={<IOSBackButton label="信息" onClick={onBack} />}
        right={<span className="min-w-[40px]" />}
      />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        {/* 搜索：长方形边框输入框，必须输入手机号才能找到待添加的好友 */}
        <div
          className={`mt-1 flex h-[46px] items-center gap-2 rounded-[12px] border bg-background px-3.5 transition-colors focus-within:border-foreground/45 focus-within:ring-4 focus-within:ring-foreground/[0.07] ${
            error ? 'border-[#FF3B30]/60' : 'border-border/80'
          }`}
        >
          <Search className="h-[17px] w-[17px] shrink-0 text-muted-foreground/60" strokeWidth={2} aria-hidden="true" />
          <input
            id="add-friend-query"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (error) setError('');
            }}
            placeholder="输入手机号查找好友"
            aria-label="输入手机号搜索好友"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/40"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="清空搜索"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted-foreground/30 text-background transition active:opacity-60"
            >
              <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
            </button>
          )}
        </div>
        {error && (
          <p className="mt-1.5 px-1 text-[12px] leading-none text-[#FF3B30]" role="alert">
            {error}
          </p>
        )}
        <p className="mt-2 px-1 text-[12px] leading-[17px] text-muted-foreground">
          在「联系人」App 创建的联系人，需输入 TA 的手机号搜索到后才能添加；未添加好友也只能在这里删除
        </p>

        {/* 刚添加/删除成功提示 */}
        {justAdded && (
          <div
            className="mt-3 flex items-start gap-2 rounded-[12px] bg-[#34C759]/12 px-3.5 py-2.5 text-[13px] leading-snug text-[#248A3D] dark:text-[#30D158]"
            role="status"
          >
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span>已添加「{justAdded}」为好友，现在可以在「信息」App 和 TA 聊天了</span>
          </div>
        )}
        {justDeleted && (
          <div
            className="mt-3 flex items-start gap-2 rounded-[12px] bg-[#FF453A]/12 px-3.5 py-2.5 text-[13px] leading-snug text-[#D70015] dark:text-[#FF453A]"
            role="status"
          >
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span>已删除未添加好友「{justDeleted}」</span>
          </div>
        )}

        {/* 搜索结果：必须输入手机号才会出现待添加的好友 */}
        {!q ? (
          <div className="mt-3 rounded-[14px] border-[1.5px] border-dashed border-border/70 bg-muted/25 px-4 py-8 text-center">
            <p className="text-[14px] font-medium text-muted-foreground">输入手机号查找好友</p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground/70">
              到「联系人」App 创建联系人后，凭手机号来这里添加
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-3 rounded-[14px] bg-muted/40 px-4 py-8 text-center">
            <p className="text-[14px] font-medium text-muted-foreground">没有找到该手机号</p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground/70">
              检查号码是否正确，或到「联系人」App 查看手机号
            </p>
          </div>
        ) : (
          <ul className="mt-3 overflow-hidden rounded-[14px] bg-muted/45" aria-label="待添加好友列表">
            {filtered.map((c) => (
              <li key={c.id} className="border-b border-border/50 last:border-b-0">
                <div className="flex w-full items-center gap-3 px-3.5 py-2.5">
                  {c.avatar ? (
                    <img
                      src={c.avatar}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <DefaultAvatar size={48} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold leading-tight">{c.name}</span>
                    <span className="mt-0.5 block truncate text-[12px] tabular-nums text-muted-foreground">
                      {c.kind.toUpperCase()} · {c.phone ?? '未设置手机号'}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <GlassButton
                      type="button"
                      onClick={() => void add(c)}
                      disabled={addingId === c.id || deletingId === c.id}
                      aria-label={`添加${c.name}为好友`}
                      className="flex h-[32px] items-center gap-1 rounded-full px-4 text-[13px] font-semibold"
                    >
                      {addingId === c.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <UserPlus className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                      )}
                      {addingId === c.id ? '添加中' : '添加'}
                    </GlassButton>
                    {confirmId === c.id ? (
                      <GlassButton
                        variant="danger"
                        type="button"
                        onClick={() => void del(c)}
                        disabled={deletingId === c.id}
                        aria-label={`确认删除${c.name}`}
                        data-testid={`confirm-delete-${c.id}`}
                        className="flex h-[32px] items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold"
                      >
                        {deletingId === c.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                        )}
                        {deletingId === c.id ? '删除中' : '确认删除'}
                      </GlassButton>
                    ) : (
                      <GlassButton
                        variant="danger"
                        type="button"
                        onClick={() => setConfirmId(c.id)}
                        disabled={deletingId === c.id}
                        aria-label={`删除${c.name}`}
                        data-testid={`delete-pending-${c.id}`}
                        className="flex h-[32px] items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
                        删除
                      </GlassButton>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ---------------- 联系人面板（连接联系人 App：只显示 CHAR 与 NPC，USER 不出现） ----------------

function ContactRow({ contact, onOpen }: { contact: ContactRecord; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`和${contact.name}聊天`}
      className="relative flex w-full select-none items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-muted/60"
    >
      {contact.avatar ? (
        <img src={contact.avatar} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
      ) : (
        <DefaultAvatar size={44} />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-tight">{contact.name}</span>
        <span className="mt-0.5 block truncate text-[12px] tabular-nums text-muted-foreground">
          {contact.phone ?? '未设置手机号'}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={2} aria-hidden="true" />
      <span aria-hidden="true" className="absolute bottom-0 left-[72px] right-0 h-px bg-border/50" />
    </button>
  );
}

/** 单个分组（CHAR / NPC）：空组整块隐藏 */
function ContactGroup({
  label,
  list,
  emptyHint,
  onOpenContact,
}: {
  label: string;
  list: ContactRecord[];
  emptyHint: string;
  onOpenContact: (c: ContactRecord) => void;
}) {
  if (list.length === 0) {
    return (
      <>
        <p className="px-4 pb-1 pt-4 text-[12px] font-medium tracking-wide text-muted-foreground">{label}</p>
        <p className="px-4 pb-1 text-[13px] leading-snug text-muted-foreground/55">{emptyHint}</p>
      </>
    );
  }
  return (
    <>
      <p className="px-4 pb-1 pt-4 text-[12px] font-medium tracking-wide text-muted-foreground">{label}</p>
      <ul aria-label={`${label}联系人列表`}>
        {list.map((c) => (
          <li key={c.id}>
            <ContactRow contact={c} onOpen={() => onOpenContact(c)} />
          </li>
        ))}
      </ul>
    </>
  );
}

function ContactsPanel({
  contacts,
  state,
  query,
  onQuery,
  onRetry,
  onOpenAssistant,
  onOpenContact,
}: {
  contacts: ContactRecord[];
  state: 'loading' | 'error' | 'ready';
  query: string;
  onQuery: (v: string) => void;
  onRetry: () => void;
  onOpenAssistant: () => void;
  onOpenContact: (c: ContactRecord) => void;
}) {
  const q = query.trim().toLowerCase();
  /** 搜索：名字/手机号/微信号/职业/地区/关系；USER 与未添加好友的不出现 */
  const match = (c: ContactRecord) =>
    !q ||
    [c.name, c.phone, c.wechatId, c.occupation, c.region, c.relation].some(
      (v) => typeof v === 'string' && v.toLowerCase().includes(q)
    );
  const charList = contacts.filter((c) => c.kind === 'char' && isFriendIn(c, 'sms') && match(c));
  const npcList = contacts.filter((c) => c.kind === 'npc' && isFriendIn(c, 'sms') && match(c));
  const friendList = [...charList, ...npcList];

  return (
    <>
      {/* 搜索框 */}
      <div className="px-4 pb-1 pt-2">
        <div className="flex h-[36px] items-center gap-1.5 rounded-[11px] bg-muted px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground/60" strokeWidth={2} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="搜索"
            aria-label="搜索联系人"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQuery('')}
              aria-label="清空搜索"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted-foreground/30 text-background transition active:opacity-60"
            >
              <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* 智能助理 */}
      <p className="px-4 pb-1 pt-3 text-[12px] font-medium tracking-wide text-muted-foreground">智能助理</p>
      <button
        type="button"
        onClick={onOpenAssistant}
        aria-label="查看小助手资料"
        className="relative flex w-full select-none items-center gap-3 px-4 py-2.5 text-left transition active:bg-muted/60"
      >
        <DefaultAvatar size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{ASSISTANT.name}</div>
          <div className="mt-0.5 truncate text-[12px] tabular-nums text-muted-foreground">{ASSISTANT.phone}</div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" strokeWidth={2} aria-hidden="true" />
        <span aria-hidden="true" className="absolute bottom-0 left-[72px] right-0 h-px bg-border/50" />
      </button>

      {/* 联系人数据（来自联系人 App） */}
      {state === 'loading' && (
        <div className="flex h-28 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="加载联系人" />
        </div>
      )}
      {state === 'error' && (
        <div className="px-6 py-8 text-center text-[14px] text-muted-foreground">
          联系人读取失败
          <button type="button" onClick={onRetry} className="ml-2 text-foreground underline">
            重试
          </button>
        </div>
      )}
      {state === 'ready' && (
        <>
          <ContactGroup
            label="联系人"
            list={friendList}
            emptyHint={q ? '没有匹配的联系人' : '还没有好友，点右上角「+」添加好友'}
            onOpenContact={onOpenContact}
          />
          <div aria-hidden="true" className="h-6" />
        </>
      )}
    </>
  );
}

// ---------------- 联系人会话行（信息列表：和好友的聊天记录预览） ----------------

/** 联系人会话预览 */
interface ContactSessionPreview {
  contact: ContactRecord;
  preview: string;
  time: number;
}

/** 扫描本地聊天记录：已添加好友的 CHAR/NPC 中有消息记录的进会话列表（按最后消息时间倒序；撤回的消息预览显示撤回文案） */
function scanContactSessions(contacts: ContactRecord[]): ContactSessionPreview[] {
  const out: ContactSessionPreview[] = [];
  for (const c of contacts) {
    if (c.kind === 'user' || !isFriendIn(c, 'sms')) continue;
    const msgs = loadMsgs(`c:${c.id}`);
    if (!msgs || msgs.length === 0) continue;
    const last = msgs[msgs.length - 1];
    out.push({
      contact: c,
      preview: last?.recalled
        ? last.role === 'user'
          ? '你撤回一条消息'
          : '对方撤回一条消息'
        : (last?.content ?? '').trim() || '…',
      time: last?.time ?? 0,
    });
  }
  return out.sort((a, b) => b.time - a.time);
}

/** 联系人会话行：头像 + 名字 + 最后一条消息预览 + 时间（点击进入聊天） */
function ContactSessionRow({
  contact,
  preview,
  time,
  onOpen,
}: {
  contact: ContactRecord;
  preview: string;
  time: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`和${contact.name}聊天`}
      className="relative flex w-full select-none items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-black/[0.06] dark:active:bg-white/[0.08]"
    >
      {contact.avatar ? (
        <img src={contact.avatar} alt="" className="h-[52px] w-[52px] shrink-0 rounded-full object-cover" />
      ) : (
        <DefaultAvatar size={52} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-semibold">{contact.name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{fmtListTime(time)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-[13px] leading-snug text-muted-foreground">{preview}</p>
        </div>
      </div>
      {/* iOS 内缩式发丝分隔线 */}
      <span aria-hidden="true" className="absolute bottom-0 left-[76px] right-0 h-px bg-border/50" />
    </button>
  );
}

// ---------------- 底部椭圆分段控件（信息 / 联系人） ----------------

function BottomTabBar({ tab, onChange }: { tab: TabKey; onChange: (t: TabKey) => void }) {
  const items = [
    { key: 'chats', label: '信息' },
    { key: 'contacts', label: '联系人' },
  ] as const;
  return (
    <nav className="z-20 shrink-0 bg-background/85 pb-[30px] pt-2.5 backdrop-blur-xl">
      <div role="tablist" aria-label="信息分组" className="mx-auto flex w-[220px] rounded-full bg-muted p-[2px]">
        {items.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => onChange(key)}
            className="relative flex-1 rounded-full py-[7px] text-[13px] font-medium transition-colors"
          >
            {tab === key && (
              <motion.span
                layoutId="msg-tab-thumb"
                className="absolute inset-0 rounded-full bg-background shadow-sm"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            <span className={`relative z-10 transition-colors ${tab === key ? 'text-foreground' : 'text-muted-foreground'}`}>
              {label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

// ---------------- 主视图 ----------------

export default function ChatApp() {
  const [view, setView] = useState<View>('main');
  const [tab, setTab] = useState<TabKey>('chats');
  /** 跨 App 跳转：电话 App 联系人详情点「信息」带来的联系人 id（挂载时消费，等联系人载入后自动进会话） */
  const [pendingJump, setPendingJump] = useState<string | null>(() => useUI.getState().pendingChatContact);
  /** 小助手会话未读条数（AI 发了几条消息角标就是几；0 = 已读） */
  const [unreadN, setUnreadN] = useState(0);
  const unread = unreadN > 0;
  /** 已读水位：最后一次「已见」的小助手消息条数（AI 回复落盘时按增量累计未读） */
  const seenLenRef = useRef(0);
  /** 会话被删除后隐藏（从联系人重新进入聊天即恢复） */
  const [hidden, setHidden] = useState(false);
  /** 置顶 */
  const [pinned, setPinned] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** 微信菜单位置（相对 App 容器） */
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, arrowX: 0 });
  /** 删除确认弹窗 */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  /** 小助手会话消息（父级持有：会话行预览用；聊天内状态在 ChatView 内部） */
  const [assistantMsgs, setAssistantMsgs] = useState<ChatMsg[]>(SEED_MSGS);
  const [mounted, setMounted] = useState(false);

  // 联系人数据（连接联系人 App）
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [contactState, setContactState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [query, setQuery] = useState('');
  /** 当前聊天会话（null = 未在聊天中） */
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  /** 好友会话预览（信息列表：有聊天记录的好友 CHAR/NPC） */
  const [contactSessions, setContactSessions] = useState<ContactSessionPreview[]>([]);

  // 挂载后载入小助手本地状态（已读/置顶/删除标记 + 预览消息；异步微任务：保持水合安全）
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setHidden(window.localStorage.getItem(LS_HIDDEN_KEY) === '1');
      setPinned(window.localStorage.getItem(LS_PIN_KEY) === '1');
      // 未读条数：优先读计数（AI 发了几条就是几）；旧数据只有已读布尔 → 未读时至少 1
      let n = 0;
      try {
        const raw = Number(window.localStorage.getItem(LS_UNREAD_N_KEY));
        if (Number.isFinite(raw) && raw > 0) n = Math.min(Math.floor(raw), 99);
        if (window.localStorage.getItem(LS_READ_KEY) !== '1') n = Math.max(n, 1);
      } catch {
        // 读取失败按 0
      }
      setUnreadN(n);
      const saved = loadMsgs('assistant');
      if (saved && saved.length) setAssistantMsgs(saved);
      seenLenRef.current = saved ? saved.length : 0;
      setMounted(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 未读条数变化 → 落盘（同时同步旧版已读布尔键，兼容旧逻辑）
  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(LS_UNREAD_N_KEY, String(unreadN));
      if (unreadN > 0) window.localStorage.removeItem(LS_READ_KEY);
      else window.localStorage.setItem(LS_READ_KEY, '1');
    } catch {
      // 持久化失败忽略
    }
  }, [unreadN, mounted]);

  // 全局流式回复落盘：小助手会话在聊天页外收到 AI 回复时，从存储刷新列表预览并按条数累计未读
  // （联系人会话预览由 contactSessions 在进入列表时重算，无需额外订阅）
  useChatStreamFinalized('sms:assistant', () => {
    const saved = loadMsgs('assistant');
    if (!saved || !saved.length) return;
    setAssistantMsgs(saved);
    const prevLen = seenLenRef.current;
    if (view === 'chat' && chatSession?.key === 'assistant') {
      // 小助手聊天页正开着：消息实时可见，不计未读，只推进已读水位
      seenLenRef.current = Math.max(prevLen, saved.length);
      return;
    }
    // AI 在聊天页外回复：未读条数按本轮 AI 实际发来的消息条数累加（进聊天即清零）
    if (saved.length > prevLen) {
      const fresh = saved.slice(prevLen).filter((m) => m.role === 'assistant').length;
      seenLenRef.current = saved.length;
      if (fresh > 0) setUnreadN((n) => Math.min(n + fresh, 99));
    }
  });

  // 置顶 / 删除标记持久化
  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(LS_PIN_KEY, pinned ? '1' : '0');
      window.localStorage.setItem(LS_HIDDEN_KEY, hidden ? '1' : '0');
    } catch {
      // 持久化失败忽略
    }
  }, [pinned, hidden, mounted]);

  /** 和小助手聊天（空记录时 ChatView 内部重新播种欢迎语） */
  const openAssistantChat = () => {
    setUnreadN(0);
    const cur = loadMsgs('assistant');
    if (cur) seenLenRef.current = cur.length;
    // 已删除/隐藏的会话重新进入即恢复显示
    setHidden(false);
    setChatSession({ key: 'assistant', peer: { title: ASSISTANT.phone, avatarSrc: null, name: ASSISTANT.name }, systemPrompt: null });
    setView('chat');
  };

  /** 和联系人（CHAR/NPC）聊天：AI 按人设扮演（含配角圈/归属者了解注入） */
  const openContactChat = (c: ContactRecord) => {
    const owner = c.ownerId ? contacts.find((o) => o.id === c.ownerId) : undefined;
    setChatSession({
      key: `c:${c.id}`,
      peer: { title: c.phone || c.name, avatarSrc: c.avatar, name: displayNameOf(c) || c.name },
      systemPrompt: buildPersonaPrompt(c, owner?.name ?? null, buildNpcPromptExtra(c, contacts)),
    });
    setView('chat');
  };

  // 挂载即消费跨 App 请求（避免失败时残留导致以后误跳）
  useEffect(() => {
    if (useUI.getState().pendingChatContact) useUI.getState().setPendingChatContact(null);
  }, []);

  // 电话 App 跳转过来的：联系人载入后自动打开对应会话（相当于添加好友直达聊天）；
  // 找不到（已被删）或载入失败则静默留在信息主界面
  useEffect(() => {
    if (!pendingJump || contactState === 'loading') return;
    const c = contacts.find((x) => x.id === pendingJump);
    setPendingJump(null);
    if (c && c.kind !== 'user') openContactChat(c);
  }, [pendingJump, contactState, contacts]);

  // 拉取联系人（CHAR/NPC 进信息 App，USER 不出现；本地 IndexedDB）
  const loadContacts = useCallback(async () => {
    setContactState('loading');
    try {
      // 信息 App 内显示昵称（昵称优先于真实名字，与 QQ/微信一致）
      setContacts(withDisplayNames(await listContacts()));
      setContactState('ready');
    } catch {
      setContactState('error');
    }
  }, []);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  /** 添加好友后同步联系人数据（列表/面板/会话即时生效；落库记录带真实名字，展示层统一换成昵称） */
  const upsertContact = useCallback((c: ContactRecord) => {
    const shown = withDisplayNames([c])[0];
    setContacts((prev) => {
      const i = prev.findIndex((x) => x.id === c.id);
      if (i === -1) return [shown, ...prev];
      const next = [...prev];
      next[i] = shown;
      return next;
    });
  }, []);

  // 会话列表预览：回到主视图时重扫本地聊天记录（从聊天返回也能刷新预览）
  useEffect(() => {
    if (view !== 'main') return;
    setContactSessions(scanContactSessions(contacts));
  }, [contacts, view]);

  // 进入添加好友页时刷新联系人：同步「联系人」App 里新建的 CHAR/NPC（新的朋友列表保持最新）
  useEffect(() => {
    if (view === 'add') void loadContacts();
  }, [view, loadContacts]);

  const togglePin = () => setPinned((v) => !v);

  /** 标为未读/已读（微信语义：会话行红点，未读条数同步持久化；标为未读 = 1 条起计） */
  const markUnread = () => {
    setUnreadN(1);
  };

  const markRead = () => {
    setUnreadN(0);
  };

  /** 不显示该聊天：隐藏会话行但保留聊天记录（从联系人重新进入即恢复）；隐藏后未读无处展示，一并清为已读避免主屏角标卡死 */
  const hideChat = () => {
    setHidden(true);
    markRead();
  };

  /** 删除该聊天：清空记录并隐藏（重新进入重新播种欢迎语） */
  const deleteChat = () => {
    setAssistantMsgs([]);
    saveMsgs('assistant', []);
    setHidden(true);
    seenLenRef.current = 0;
    setUnreadN(0);
  };

  // 主屏图标红点同步：小助手会话未读 → unread-store 总线（与微信/QQ 主屏角标同款，实时+持久化）
  useEffect(() => {
    if (!mounted) return; // 等本地已读状态载入后再同步，避免默认 true 造成误闪
    chatBadge.set(unreadN > 0 && !hidden ? Math.min(unreadN, 99) : 0);
  }, [unreadN, hidden, mounted]);

  /** 打开微信风格长按菜单：锚定在会话行下方、水平对齐触点 */
  const openMenuAt = (x: number, rowBottom: number) => {
    const screen = screenRef.current?.getBoundingClientRect();
    const w = wxMenuWidth(menuItems.map((it) => it.label));
    const sw = screen?.width ?? 390;
    const top = Math.max(rowBottom - (screen?.top ?? 0) + 8, 8);
    const left = Math.min(Math.max(x - w / 2, 10), Math.max(sw - w - 10, 10));
    const arrowX = Math.min(Math.max(x - left - 6, 10), Math.max(w - 22, 10));
    setMenuPos({ top, left, arrowX });
    setMenuOpen(true);
  };

  const menuItems: WxMenuItem[] = [
    unread
      ? { icon: MailOpen, label: '标为已读', onSelect: markRead }
      : { icon: Mail, label: '标为未读', onSelect: markUnread },
    pinned
      ? { icon: PinOff, label: '取消置顶', onSelect: togglePin }
      : { icon: Pin, label: '置顶该聊天', onSelect: togglePin },
    { icon: EyeOff, label: '不显示该聊天', onSelect: hideChat },
    { icon: Trash2, label: '删除该聊天', onSelect: () => setConfirmDelete(true) },
  ];

  const last = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1] : undefined;
  // 撤回的消息在会话列表预览显示「你/对方撤回一条消息」
  const preview = last?.recalled
    ? last.role === 'user'
      ? '你撤回一条消息'
      : '对方撤回一条消息'
    : last?.content || SEED_MSGS[0].content;
  const listTime = mounted ? (last && last.time > 0 ? fmtTime(last.time) : '现在') : '';

  // 跨 App 跳转中（等联系人载入）：先不渲染主界面，避免闪一下会话列表
  if (pendingJump) {
    return (
      <IOSScreen className="items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </IOSScreen>
    );
  }

  if (view === 'add') {
    return (
      <IOSScreen>
        <AddFriendView
          contacts={contacts}
          onBack={() => setView('main')}
          onAddFriend={upsertContact}
          onDeleted={(c) => setContacts((prev) => prev.filter((x) => x.id !== c.id && x.ownerId !== c.id))}
        />
      </IOSScreen>
    );
  }

  if (view === 'chat' && chatSession) {
    const isAssistant = chatSession.key === 'assistant';
    return (
      <IOSScreen>
        <ChatView
          key={chatSession.key}
          storageKey={chatSession.key}
          initialMsgs={isAssistant ? SEED_MSGS.map((m) => ({ ...m, time: Date.now() })) : []}
          onMsgsChange={isAssistant ? setAssistantMsgs : undefined}
          peer={chatSession.peer}
          systemPrompt={chatSession.systemPrompt}
          onBack={() => setView('main')}
        />
      </IOSScreen>
    );
  }

  return (
    <IOSScreen className="relative">
      {/* 导航栏：返回主屏 + 标题 + 右上角加号（添加好友） */}
      <IOSNavBar
        inline
        title="信息"
        className="shrink-0"
        left={<BackToHome className="static!" />}
        right={
          <GlassButton
            type="button"
            onClick={() => setView('add')}
            aria-label="添加好友"
            className="flex h-9 w-9 items-center justify-center rounded-full"
          >
            <Plus className="h-[20px] w-[20px]" strokeWidth={2} aria-hidden="true" />
          </GlassButton>
        }
      />

      {/* Tab 内容 */}
      {tab === 'chats' ? (
        <div role="tabpanel" aria-label="信息" className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
          {!hidden && (
            <AssistantRow
              preview={preview}
              time={listTime}
              unreadCount={unreadN}
              pinned={pinned}
              onOpen={openAssistantChat}
              onLongPress={({ x, rowBottom }) => openMenuAt(x, rowBottom)}
            />
          )}
          {/* 与好友（CHAR/NPC）的会话：聊过天即出现在列表，按最后消息时间排序 */}
          {contactSessions.map((s) => (
            <ContactSessionRow
              key={s.contact.id}
              contact={s.contact}
              preview={s.preview}
              time={s.time}
              onOpen={() => openContactChat(s.contact)}
            />
          ))}
          {hidden && contactSessions.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 pb-14">
              <div className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-black/5 text-muted-foreground dark:bg-white/10">
                <MessageCircle className="h-9 w-9" strokeWidth={1.5} aria-hidden="true" />
              </div>
              <div className="text-[16px] font-medium">暂无会话</div>
              <div className="max-w-[240px] text-center text-[13px] leading-snug text-muted-foreground">
                会话已删除或不显示，可从联系人重新发起聊天
              </div>
              <GlassButton
                type="button"
                onClick={() => setTab('contacts')}
                aria-label="去联系人"
                className="mt-1 rounded-full px-5 py-2 text-[14px] font-medium"
              >
                去联系人
              </GlassButton>
            </div>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label="联系人" className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
          <ContactsPanel
            contacts={contacts}
            state={contactState}
            query={query}
            onQuery={setQuery}
            onRetry={() => void loadContacts()}
            onOpenAssistant={openAssistantChat}
            onOpenContact={openContactChat}
          />
        </div>
      )}

      {/* 底部椭圆分段控件 */}
      <BottomTabBar tab={tab} onChange={setTab} />

      {/* 微信风格长按菜单：标为(已)未读 / (取消)置顶 / 不显示 / 删除 */}
      {menuOpen && <WxLongPressMenu pos={menuPos} items={menuItems} onClose={() => setMenuOpen(false)} />}

      {/* 删除该聊天：iOS 风格确认弹窗 */}
      <IOSConfirmDialog
        open={confirmDelete}
        title="删除该聊天？"
        desc={`与「${ASSISTANT.name}」的聊天记录将被删除。`}
        confirmLabel="删除"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          deleteChat();
        }}
      />

      {/* 坐标参照层：铺满 App 容器用于菜单定位（不拦截事件） */}
      <div ref={screenRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />
    </IOSScreen>
  );
}
