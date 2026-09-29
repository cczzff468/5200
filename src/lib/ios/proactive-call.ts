'use client';

/**
 * AI 主动来电调度（Task 40-d）——让 AI 真正「自主决定 + 定时拨打」语音电话：
 *
 * ProactiveCallWatcher（PhoneShell 挂载）定期调 runProactiveCallTick()：
 * ① 总开关（设置 › 通知「AI 主动来电」，kv 'proactive-call-enabled'，默认开）关闭 → 返回；
 * ② 深夜硬闸（本地时间 0~8 点不打；23 点后的晚间分寸交给决策 API 按人设判断）；
 * ③ 已有来电响铃（useIncomingCall.call）或全局通话进行中（useGlobalCall.session）→ 返回；
 *    页面切后台（document.hidden）不拦——真实手机来电不看屏幕（本模块不做可见性检查）；
 * ④ 候选筛选：有「人设」的联系人（persona 非空；USER/无名排除）中，取 48h 内有互动且
 *    距上次互动 ≥2h（刚聊完不马上打）、且不在冷却期（call/wait 冷却 6h、skip 冷却 24h）
 *    的联系人里「最久没聊」的一位；
 * ⑤ 组三端最近聊天摘要（微信/QQ/信息各取最近 4 条文本/转写，单条截 60 字）POST
 *    /api/phone/proactive 决策 → 落冷却 kv → action='call' 时经 triggerIncomingCall
 *    真正发起 iOS 全屏来电（接听/拒绝/超时回调与信息 App AI 来电同一套链路）。
 *
 * 接听 → setPendingPhoneAnswer(含 proactiveContext=决策 reason 作为开场情境) + 切电话 App
 * （照抄 chat.tsx onAnswer 做法）；拒绝/超时 → recordMissedPhoneCall 落未接记录 + AI 语音留言
 * （照抄 chat.tsx 同名函数的落库模式）。通话内容/挂断收尾/记忆沉淀由电话 App 既有引擎承担。
 */

import { localDB, genId, type CallLogRecord } from './db';
import { kvGet, kvSet } from './idb-kv';
import { listContacts, ownerProfile } from './contacts-store';
import { requestCallFollowup } from './call-followup';
import { setPendingPhoneAnswer, triggerIncomingCall, useIncomingCall } from './incoming-call';
import { useGlobalCall } from './global-call';
import { useSettings, useUI } from './store';
import { buildNpcPromptExtra } from './npc-bond';
import { loadBlock } from './block-state';
import { getMemSettings, memRecallBlock } from '@/lib/memory';
import { buildTimeAwareBlock } from '@/lib/time-aware';
import { getReplyCount } from '@/lib/reply-count';
import type { ContactRecord } from '@/lib/contacts';

// ---------------- 常量与档位（调参集中在这里） ----------------

/** 总开关 kv 键（与设置 › 通知「AI 主动来电」开关共用；值 { value: boolean }，缺省=开） */
const ENABLED_KEY = 'proactive-call-enabled';
/** 频率档位 kv 键（值 { level: ProactiveLevel }，缺省='standard'）；设置页可切换 4 档 */
const LEVEL_KEY = 'proactive-call-level';
/** 单联系人冷却 kv 键前缀（值 { at: number, action: string, window?: number }） */
const COOLDOWN_PREFIX = 'proactive-call:';

/** 频率档位（设置页「主动来电频率」4 档）：
 *  - conservative 保守：冷却长，几乎不主动打（6h/24h，最小间隔 2h，tick 120s）
 *  - standard 标准（缺省，体验优先）：30min 最小间隔、1h 冷却、tick 60s——AI 主动但不暴走
 *  - eager 积极：10min 最小间隔、15min 冷却、tick 45s——AI 非常主动
 *  - off 无冷却：仅留 10min per-contact 自然冷却 + 60s tick 全局节流（防 90s 内连拨同一人）
 */
export type ProactiveLevel = 'conservative' | 'standard' | 'eager' | 'off';

interface ProactiveLevelPreset {
  /** 资格窗口：48h 内有互动才考虑（各档一致，不动） */
  activeWindowMs: number;
  /** 最小间隔：距上次互动不足此时长不打（per-contact 自然冷却底线，去冷却方案唯一保护） */
  minGapMs: number;
  /** 决策为 call / wait 后的冷却 */
  cooldownActiveMs: number;
  /** 决策为 skip 后的冷却 */
  cooldownSkipMs: number;
  /** 深夜硬闸终点小时（0~N 点不打） */
  nightEndHour: number;
  /** Watcher 首次 tick 延迟 */
  firstTickDelayMs: number;
  /** Watcher 基础轮询间隔 */
  tickIntervalMs: number;
  /** 每次 tick 的随机抖动上限 */
  tickJitterMs: number;
  /** 决策为 call 但触发前已有通话/闹钟时的短冷却 */
  shortCooldownMs: number;
}

const LEVEL_PRESETS: Record<ProactiveLevel, ProactiveLevelPreset> = {
  conservative: {
    activeWindowMs: 48 * 60 * 60_000,
    minGapMs: 2 * 60 * 60_000, // 2h
    cooldownActiveMs: 6 * 60 * 60_000, // 6h
    cooldownSkipMs: 24 * 60 * 60_000, // 24h
    nightEndHour: 8,
    firstTickDelayMs: 60_000,
    tickIntervalMs: 120_000,
    tickJitterMs: 30_000,
    shortCooldownMs: 5 * 60 * 1000,
  },
  standard: {
    activeWindowMs: 48 * 60 * 60_000,
    minGapMs: 30 * 60_000, // 30min（刚聊完 30min 内不打）
    cooldownActiveMs: 60 * 60_000, // 1h
    cooldownSkipMs: 60 * 60_000, // 1h
    nightEndHour: 8,
    firstTickDelayMs: 20_000, // 20s
    tickIntervalMs: 60_000, // 60s
    tickJitterMs: 30_000,
    shortCooldownMs: 120_000, // 2min
  },
  eager: {
    activeWindowMs: 48 * 60 * 60_000,
    minGapMs: 10 * 60_000, // 10min
    cooldownActiveMs: 15 * 60_000, // 15min
    cooldownSkipMs: 15 * 60_000, // 15min
    nightEndHour: 8,
    firstTickDelayMs: 15_000, // 15s
    tickIntervalMs: 45_000, // 45s
    tickJitterMs: 15_000,
    shortCooldownMs: 60_000, // 1min
  },
  off: {
    activeWindowMs: 48 * 60 * 60_000,
    minGapMs: 10 * 60_000, // 10min（per-contact 自然冷却底线——防 90s 内连拨同一人）
    cooldownActiveMs: 0, // 无冷却
    cooldownSkipMs: 0, // 无冷却
    nightEndHour: 8, // 深夜硬闸仍保留（防吵醒）
    firstTickDelayMs: 15_000,
    tickIntervalMs: 60_000, // 60s（全局节流）
    tickJitterMs: 15_000,
    shortCooldownMs: 120_000, // #101 2min（> tickInterval 60s，防触发被阻后 60s 后又选同候选重击决策 API）
  },
};

/** 读取当前档位（kv 'proactive-call-level'，缺省='standard' 体验优先） */
export function getProactiveLevel(): ProactiveLevel {
  const v = kvGet<{ level?: unknown }>(LEVEL_KEY);
  const lv = v?.level;
  if (lv === 'conservative' || lv === 'standard' || lv === 'eager' || lv === 'off') return lv;
  return 'standard';
}

/** 写入当前档位（设置页切换时调用） */
export function setProactiveLevel(level: ProactiveLevel): void {
  kvSet(LEVEL_KEY, { level });
}

/** 取当前档位预设（运行时所有常量从这里读，切档即时生效——下次 tick 即用新值） */
function preset(): ProactiveLevelPreset {
  return LEVEL_PRESETS[getProactiveLevel()];
}

/** 动态读取档位的 tick 调度参数（切档后下次 tick 即用新值）——ProactiveCallWatcher 用 */
export function getProactiveTickParams(): { firstDelay: number; interval: number; jitter: number } {
  const p = preset();
  return { firstDelay: p.firstTickDelayMs, interval: p.tickIntervalMs, jitter: p.tickJitterMs };
}

/** 决策 API 返回（与 /api/phone/proactive 契约一致） */
interface ProactiveDecision {
  action: 'call' | 'wait' | 'skip';
  reason: string;
}

// ---------------- 开关（settings.tsx 共用） ----------------

/** AI 主动来电总开关（kv 'proactive-call-enabled'，无记录/非法值=默认开） */
export function isProactiveCallEnabled(): boolean {
  const v = kvGet<{ value?: unknown }>(ENABLED_KEY);
  return typeof v?.value === 'boolean' ? v.value : true;
}

/** 写入 AI 主动来电总开关（设置页切换时调用） */
export function setProactiveCallEnabled(value: boolean): void {
  kvSet(ENABLED_KEY, { value });
}

// ---------------- 消息读取（wx / qq / 信息三端 kv 键；数组按时间升序，末条=最新） ----------------

const WX_MSGS_KEY = (id: string): string => `wx-chat-msgs:${id}`;
const QQ_MSGS_KEY = (id: string): string => `qq-chat-msgs:${id}`;
/** 信息 App 会话键：storageKey = `c:<contactId>`（AI 助手会话不在候选范围，无需处理） */
const SMS_MSGS_KEY = (id: string): string => `ios-chat-msgs:c:${id}`;

/** 三端消息归一化后的最小形状 */
interface NormMsg {
  role: 'user' | 'assistant';
  text: string;
  time: number;
}

function readKvMsgs(key: string): unknown[] {
  const raw = kvGet<unknown>(key);
  return Array.isArray(raw) ? raw : [];
}

/** 末条时间戳（数组按时间升序持久化，末条=最新；空会话返回 0） */
function lastTimeOf(list: unknown[]): number {
  const last = list[list.length - 1] as { time?: unknown } | undefined;
  return last && typeof last.time === 'number' ? last.time : 0;
}

/** 单条消息 → 可读文本（转写/描述优先；撤回/系统行/卡片类返回空串 = 不进摘要） */
function extractMsgText(r: Record<string, unknown>): string {
  if (r.recalled === true || r.error === true) return '';
  if (r.sys || r.blkreq || r.notice) return '';
  const kind = typeof r.kind === 'string' ? r.kind : 'text';
  // 卡片类（红包/转账/通话卡/转发/群邀请）不产生可聊文本
  if (
    kind === 'call' ||
    kind === 'redpacket' ||
    kind === 'transfer' ||
    kind === 'family' ||
    kind === 'forward' ||
    kind === 'groupcard' ||
    kind === 'blockreq' ||
    kind === 'sys'
  ) {
    return '';
  }
  const content = typeof r.content === 'string' ? r.content.trim() : '';
  const voice = r.voice as { transcript?: unknown; localText?: unknown } | undefined;
  const voiceText = (): string => {
    const t = typeof voice?.transcript === 'string' ? voice.transcript.trim() : '';
    if (t) return t;
    const l = typeof voice?.localText === 'string' ? voice.localText.trim() : '';
    if (l) return l;
    return content && !content.startsWith('data:') ? content : '[语音]';
  };
  switch (kind) {
    case 'voice':
      return voiceText();
    case 'image': {
      const img = r.img as { desc?: unknown } | undefined;
      const d = typeof img?.desc === 'string' ? img.desc.trim() : '';
      if (d) return `[图片] ${d}`;
      return content && !content.startsWith('data:') ? `[图片] ${content}` : '[图片]';
    }
    case 'sticker': {
      const stk = r.stk as { meaning?: unknown } | undefined;
      const d = typeof stk?.meaning === 'string' ? stk.meaning.trim() : '';
      return d ? `[表情包] ${d}` : '[表情]';
    }
    case 'location': {
      const loc = r.loc as { name?: unknown } | undefined;
      const d = typeof loc?.name === 'string' ? loc.name.trim() : '';
      return d ? `[位置] ${d}` : '[位置]';
    }
    default:
      if (!content) return '';
      return content.startsWith('data:') ? '[图片]' : content; // 旧图片消息 content 直接存 dataURL
  }
}

function toNormMsg(m: unknown): NormMsg | null {
  if (!m || typeof m !== 'object') return null;
  const r = m as Record<string, unknown>;
  // 微信/QQ 用 me/peer，信息用 user/assistant
  const role =
    r.role === 'user' || r.role === 'me'
      ? ('user' as const)
      : r.role === 'assistant' || r.role === 'peer'
        ? ('assistant' as const)
        : null;
  if (!role || typeof r.time !== 'number') return null;
  const text = extractMsgText(r);
  if (!text.trim()) return null;
  return { role, text, time: r.time };
}

function readNormMsgs(key: string): NormMsg[] {
  return readKvMsgs(key)
    .map(toNormMsg)
    .filter((m): m is NormMsg => m !== null)
    .sort((a, b) => a.time - b.time); // 防御性排序（投递尾巴可能轻微乱序），slice(-N) 才是真正的「最近」
}

// ---------------- 展示格式化 ----------------

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** 摘要条目时间：今天 HH:MM，跨天 M月D日 HH:MM */
function fmtChatTime(t: number, nowMs: number): string {
  const d = new Date(t);
  const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return new Date(nowMs).toDateString() === d.toDateString() ? hhmm : `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
}

/** 距上次互动的人类口径（「约 N 小时」，决策 prompt 用） */
function gapLabel(gapMs: number): string {
  const mins = Math.max(1, Math.round(gapMs / 60000));
  if (mins < 60) return `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 当前时间完整表述（决策 prompt 用：年月日+星期+时刻） */
function fmtNow(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK_CN[d.getDay()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 联系人无手机号时的稳定占位号（与 chat.tsx derivePlaceholderNumber 同算法：同一联系人恒定同号） */
function derivePlaceholderNumber(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `1${String(h % 10000000000).padStart(10, '0')}`;
}

// ---------------- 冷却 kv ----------------

function cooldownKey(contactId: string): string {
  return `${COOLDOWN_PREFIX}${contactId}`;
}

function isCoolingDown(contactId: string, nowMs: number): boolean {
  const c = kvGet<{ at?: unknown; action?: unknown; window?: unknown }>(cooldownKey(contactId));
  if (!c || typeof c.at !== 'number') return false;
  // #103 优先用 record 内固化的 window（setCooldown/setShortCooldown 写入），跨档切换语义清晰：
  //   conservative 设的 6h 冷却不会被切到 standard 后缩短为 1h；off 档设的 0 不会被切到 conservative 后变长
  if (typeof c.window === 'number' && c.window > 0) return nowMs - c.at < c.window;
  if (typeof c.window === 'number' && c.window === 0) return false; // off 档固化 0=无冷却
  // 兜底：旧 record 无 window 字段，按当前档位 action 推导（向后兼容）
  const p = preset();
  const window = c.action === 'skip' ? p.cooldownSkipMs : p.cooldownActiveMs;
  return nowMs - c.at < window;
}

/** #103 setCooldown 固化当前档位的冷却时长到 record.window，跨档切换不改变已有冷却的剩余时长 */
function setCooldown(contactId: string, at: number, action: ProactiveDecision['action']): void {
  const p = preset();
  const window = action === 'skip' ? p.cooldownSkipMs : p.cooldownActiveMs;
  kvSet(cooldownKey(contactId), { at, action, window });
}

/** #52 短冷却（5min）：决策为 call 但触发前发现已有通话/闹钟时使用——
 *  联系人未被真拨打不应被记 6h 冷却，但完全无冷却会 90s 后又选到同一联系人再次决策浪费一次 API 调用。 */
function setShortCooldown(contactId: string, at: number): void {
  kvSet(cooldownKey(contactId), { at, action: 'wait', window: preset().shortCooldownMs });
}

// ---------------- 决策请求 ----------------

/** 决策失败（网络/超时/非 200）返回 null，由调用方按 wait 口径落冷却 */
async function requestProactiveDecision(args: {
  contact: Record<string, unknown>;
  // fix3-1 摘要条目带 role：决策端渲染「机主：/你：」前缀，防把机主说的话当成 AI 自己说的
  recentChats: { app: string; text: string; time: string; role: 'user' | 'assistant' }[];
  lastChatAt: number;
  lastInteractionLabel: string;
  now: string;
}): Promise<ProactiveDecision | null> {
  try {
    const res = await fetch('/api/phone/proactive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...args, config: useSettings.getState().apiConfig }),
      // 看门狗：决策卡死 75s 必失败（覆盖上游 30s + 内置模型 60s 的最坏组合不再拖住调度）
      signal: AbortSignal.timeout(75_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { action?: unknown; reason?: unknown };
    const action =
      data.action === 'call' || data.action === 'wait' || data.action === 'skip' ? data.action : 'skip';
    const reason = typeof data.reason === 'string' && data.reason.trim() ? data.reason.trim().slice(0, 120) : '';
    return { action, reason };
  } catch {
    return null;
  }
}

// ---------------- 未接留言（照抄 chat.tsx recordMissedPhoneCall 的落库模式） ----------------

/** AI 主动打来的电话被拒接 / 响铃超时未接：落「未接来电」记录 + AI 语音留言（失败静默） */
async function recordMissedPhoneCall(
  contact: ContactRecord,
  number: string,
  fallbackName: string,
  reason: 'declined' | 'timeout'
): Promise<void> {
  const contactId = contact.id;
  const displayName = contact.name || fallbackName;
  // #17 拉黑守卫：用户在「信息」App 拉黑了该角色 → 仍落 call-logs 留历史记录，但 voicemails（AI 留言）不写
  // （避免「我已把你拉黑，你却还在给我语音留言」的体验断裂；call-logs 保留以便用户回看未接来电历史）
  const blockedByUser = loadBlock('sms', contactId).byUser === true;
  try {
    await localDB.put('call-logs', {
      id: genId(),
      number,
      contactId,
      displayName,
      peerKind: (contact.kind as CallLogRecord['peerKind']) ?? 'unknown',
      avatar: contact.avatar ?? null,
      direction: 'missed',
      duration: 0,
      createdAt: Date.now(),
    });
  } catch {
    // 记录落盘失败静默
  }
  if (blockedByUser) return; // 用户拉黑了角色：不写语音留言（call-logs 已留历史记录）
  try {
    const [owner, recent] = await Promise.all([
      ownerProfile().catch(() => null),
      Promise.resolve(readNormMsgs(SMS_MSGS_KEY(contact.id))),
    ]);
    const recentChat = recent.slice(-6).map((m) => ({ role: m.role, content: m.text }));
    const texts = await requestCallFollowup({
      contact: {
        name: contact.name,
        kind: contact.kind,
        gender: contact.gender || null,
        age: contact.age || null,
        occupation: contact.occupation || null,
        region: contact.region || null,
        relation: contact.relation || null,
        relationToUser: contact.relationToUser || null,
        birthday: contact.birthday || null,
        persona: contact.persona || null,
        background: contact.background || null,
        nickname: contact.nickname || null,
        // 真实姓名用 realName 字段（name 在展示层可能已被昵称/备注替换，注入人设必须是真名）
        realName: contact.realName ?? null,
      },
      // AI 是主叫（direction='out'）；被拒接 = reject、响铃超时 = missed-in（与现有场景文案语义一致）
      direction: 'out',
      endReason: reason === 'declined' ? 'reject' : 'missed-in',
      connected: false,
      duration: 0,
      transcript: [],
      recentChat,
      // #78 电话通话的 missed 留言记忆召回 app 应是 'phone'（与 phone.tsx:1089 挂断续聊一致），原 'sms' 误写
      memoryBlock: memRecallBlock(contact.id, 'phone', recentChat.map((m) => m.content).join(' ')) || undefined,
      timeBlock: buildTimeAwareBlock({
        lastMsgTime: recent.length > 0 ? recent[recent.length - 1].time : null,
        regionHint: contact.region || null,
      }),
      multiApp: getMemSettings(contact.id).share,
      // 留言条数 = 该联系人在信息聊天设置页选定的回复条数（与信息 App 来电留言同口径）
      replyCount: getReplyCount(`sms:c:${contact.id}`),
      userRealName: owner?.realName || undefined,
      userNickname: owner?.nickname || undefined,
    });
    for (const text of texts) {
      await localDB.put('voicemails', {
        id: genId(),
        number,
        contactId,
        displayName,
        peerKind: (contact.kind as CallLogRecord['peerKind']) ?? 'unknown',
        avatar: contact.avatar ?? null,
        text,
        kind: 'voicemail',
        read: false,
        duration: Math.max(1, Math.ceil(text.length / 4)),
        createdAt: Date.now(),
      });
    }
  } catch {
    // 留言失败静默（记录已落，留言缺失可接受）
  }
}

// ---------------- 决策 prompt 的联系人资料（与 chat.tsx 同字段口径） ----------------

/** #79 NPC 配角圈/归属者资料卡（与 phone.tsx:847 同款 `...(npcExtra ?? {})` 模式）。
 *  npcExtra 由调用方现场构建（需要全部联系人列表，调用方在 tickInner 已加载） */
function contactPayloadOf(
  c: ContactRecord,
  npcExtra: ReturnType<typeof buildNpcPromptExtra> = null,
): Record<string, unknown> {
  return {
    name: c.name,
    kind: c.kind,
    gender: c.gender || null,
    age: c.age || null,
    occupation: c.occupation || null,
    region: c.region || null,
    relation: c.relation || null,
    relationToUser: c.relationToUser || null,
    birthday: c.birthday || null,
    persona: c.persona || null,
    background: c.background || null,
    nickname: c.nickname || null,
    realName: c.realName ?? null,
    // NPC 字段（ownerLabel/npcCircle/ownerCard/backgroundNotes）：NPC 角色的归属者/配角圈上下文
    // 在主动来电决策里与电话 App 通话 turn 同款注入（与 phone.tsx:847 `...(npcExtra ?? {})` 同模式）
    ...(npcExtra ?? {}),
  };
}

// ---------------- tick 主流程 ----------------

/** 模块级防重入：tick 进行中（含决策请求期间）再次调用直接返回 */
let tickRunning = false;

/** 测试/调试辅助：tick 是否正在执行 */
export function isProactiveCallTickRunning(): boolean {
  return tickRunning;
}

/**
 * 调度 tick（ProactiveCallWatcher 定期调用；决策到 call 才真正响铃，全链路失败静默）。
 * 时序：守卫 → 选人 → 决策 → 落冷却 → 发起来电（接听/未接回调与既有链路对接）。
 */
export async function runProactiveCallTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await tickInner();
  } catch {
    // 后台增强能力：任何异常静默（IndexedDB/网络故障不影响正常使用）
  } finally {
    tickRunning = false;
  }
}

async function tickInner(): Promise<void> {
  const nowMs = Date.now();

  // ① 总开关
  if (!isProactiveCallEnabled()) return;

  // ② 深夜硬闸：本地时间 [0, 8) 不打（23 点后的晚间分寸交给决策 API 按人设/时间判断）
  if (new Date(nowMs).getHours() < preset().nightEndHour) return;

  // ③ 交互中守卫：已有来电响铃或通话进行中不发起（页面后台 document.hidden 照常——真实手机行为）
  if (useIncomingCall.getState().call) return;
  if (useGlobalCall.getState().session) return;
  // #8 电话 App 通话全屏层进行中（CallScreen 拨出/接听中）同样不打：来电叠加会双音频抢麦克风
  if (useUI.getState().callActive) return;
  // #34 闹钟响铃中不主动拨出：闹钟铃声与通话音频重叠体验差，等闹钟被处理后再考虑
  if (useUI.getState().alarmRinging) return;

  // ④ 候选：有人设的联系人（persona 非空；USER/无名排除；#16 任一 App 被 byUser 拉黑即跳过；
  // fix4 L16 byChar 同款排除——角色已拉黑用户还主动打来，只会撞上电话引擎 #40 守卫变成
  //「来电即被拦+静默挂断」的怪链路，候选阶段直接剔除。requestOnly 仅由 byUser 派生、属聊天
  // 回合入口的放行语义，来电候选没有该放行需求，byChar 从严过滤无碍）
  const allContacts = await listContacts();
  const contacts = allContacts.filter(
    (c) =>
      c.kind !== 'user' &&
      !!c.name?.trim() &&
      !!c.persona?.trim() &&
      !loadBlock('wx', c.id).byUser &&
      !loadBlock('wx', c.id).byChar &&
      !loadBlock('qq', c.id).byUser &&
      !loadBlock('qq', c.id).byChar &&
      !loadBlock('sms', c.id).byUser &&
      !loadBlock('sms', c.id).byChar
  );
  if (contacts.length === 0) return;

  // 各联系人最近一通电话时间（IndexedDB 一次 getAll，按联系人取 max createdAt）
  const lastCallAtByContact = new Map<string, number>();
  try {
    for (const log of await localDB.getAll('call-logs')) {
      if (!log || typeof log.contactId !== 'string' || typeof log.createdAt !== 'number') continue;
      const prev = lastCallAtByContact.get(log.contactId) ?? 0;
      if (log.createdAt > prev) lastCallAtByContact.set(log.contactId, log.createdAt);
    }
  } catch {
    // 通话记录读不到时仅按三端消息判互动
  }

  // 资格筛选（#53 满足条件的联系人为候选；按「最久没聊」加权随机选取，
  // 避免同一最久者每 90s 被反复占用直到进入冷却，其余合格者饿死）
  // #104 preset() hoist 到循环外（避免每个候选调一次；isCoolingDown 内部仍会调但属必要读取）
  const p = preset();
  const candidates: { contact: ContactRecord; lastInteractionAt: number; weight: number }[] = [];
  for (const c of contacts) {
    const lastInteractionAt = Math.max(
      lastTimeOf(readKvMsgs(WX_MSGS_KEY(c.id))),
      lastTimeOf(readKvMsgs(QQ_MSGS_KEY(c.id))),
      lastTimeOf(readKvMsgs(SMS_MSGS_KEY(c.id))),
      lastCallAtByContact.get(c.id) ?? 0
    );
    if (lastInteractionAt <= 0) continue; // 从未互动（新联系人先聊过天再说）
    const gap = nowMs - lastInteractionAt;
    if (gap > p.activeWindowMs) continue; // 48h 内无互动
    if (gap < p.minGapMs) continue; // 刚聊完不久
    if (isCoolingDown(c.id, nowMs)) continue; // 冷却中
    // 权重 = sqrt(gap)（#94 收敛偏度）：最久者与次久者权重差距从线性 24:1 缩到 √24:1 ≈ 5:1，让次久没聊者也有合理机会
    candidates.push({ contact: c, lastInteractionAt, weight: Math.sqrt(gap) });
  }
  if (candidates.length === 0) return;
  // 加权随机：累计权重 + 随机落点（权重越大越可能命中，最久者最可能但不独占）
  const totalWeight = candidates.reduce((s, c) => s + c.weight, 0);
  let best = candidates[0];
  if (totalWeight > 0) {
    let r = Math.random() * totalWeight;
    for (const cand of candidates) {
      r -= cand.weight;
      if (r <= 0) {
        best = cand;
        break;
      }
    }
  }

  const contact = best.contact;

  // ⑤ 三端最近聊天摘要（各取最近 4 条，单条截 60 字，带 App 标签与时间）
  const recentChats = (
    [
      { key: WX_MSGS_KEY(contact.id), app: '微信' },
      { key: QQ_MSGS_KEY(contact.id), app: 'QQ' },
      { key: SMS_MSGS_KEY(contact.id), app: '信息' },
    ] as const
  ).flatMap(({ key, app }) =>
    readNormMsgs(key)
      .slice(-4)
      // fix3-1 归属修复：NormMsg 已解析出 role（wx/qq 的 me/peer 与信息的 user/assistant 已归一），
      // 随摘要一起传给决策 API——「谁说的」不能在拼装摘要时丢掉
      .map((m) => ({ app, text: m.text.slice(0, 60), time: fmtChatTime(m.time, nowMs), role: m.role }))
  );

  const decision = await requestProactiveDecision({
    contact: contactPayloadOf(contact, buildNpcPromptExtra(contact, allContacts)),
    recentChats,
    lastChatAt: best.lastInteractionAt,
    lastInteractionLabel: gapLabel(nowMs - best.lastInteractionAt),
    now: fmtNow(nowMs),
  });

  // 决策失败（null）：按 wait 口径落 6h 冷却，防止 90s 重试上游轰炸
  if (!decision) {
    setCooldown(contact.id, nowMs, 'wait');
    return;
  }
  // wait/skip：落对应冷却（6h/24h），不发起来电
  if (decision.action !== 'call') {
    setCooldown(contact.id, nowMs, decision.action);
    return;
  }

  // ⑥ 发起真来电（决策期间可能刚出现通话/来电，触发前再守卫一次）
  // #52 修复：决策为 call 但触发前发现已有通话/闹钟 → 联系人未被真拨打，不应被记 6h 冷却。
  //   落 5min 短冷却（避免 90s 重试又命中同一联系人浪费一次决策 API；足够下一 tick 选到其他候选）。
  //   真拨打才落 6h call 冷却。
  if (useIncomingCall.getState().call) {
    setShortCooldown(contact.id, nowMs);
    return;
  }
  if (useGlobalCall.getState().session) {
    setShortCooldown(contact.id, nowMs);
    return;
  }
  // 闹钟响铃中也不拨出（与③守卫同款，#34；决策期间可能刚响起来）
  if (useUI.getState().alarmRinging) {
    setShortCooldown(contact.id, nowMs);
    return;
  }
  // #8 电话 App 通话中也不拨出（与③守卫同款；决策期间可能刚开始通话）
  if (useUI.getState().callActive) {
    setShortCooldown(contact.id, nowMs);
    return;
  }
  // 真拨打：落 6h 冷却（call action）
  setCooldown(contact.id, nowMs, 'call');
  const number = contact.phone || derivePlaceholderNumber(contact.id);
  const name = contact.name;
  triggerIncomingCall({
    source: 'phone',
    bannerStage: 'pill',
    name,
    avatar: contact.avatar ?? null,
    number,
    contact,
    // 接听：写 pending（带 proactiveContext=决策 reason 作为开场情境，电话 App 消费端透传通话引擎）
    // + 切到电话 App 进「来电方向」通话界面（照抄 chat.tsx onAnswer；接听交接兜底由 IncomingCallLayer 承担）
    onAnswer: () => {
      setPendingPhoneAnswer({ contact, number, name, proactiveContext: decision.reason });
      useUI.getState().switchToApp('phone');
    },
    // 拒绝 / 响铃 25 秒超时：落未接记录 + AI 语音留言（人设化解释，照抄 chat.tsx 同款链路）
    onMissed: (reason) => {
      void recordMissedPhoneCall(contact, number, name, reason);
    },
  });
}
