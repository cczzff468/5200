'use client';

/**
 * AI 主动发消息调度（Task 49）——让 AI 在用户没说话时也能主动开口：
 *
 * 四种触发（每个角色独立设置，微信/QQ/信息三端 1:1 会话）：
 * ① 定时触发：用户为角色设置「主动发消息间隔」（30s~24h+自定义），到点 AI 按人设/记忆/上下文生成一条消息；
 * ② 事件触发：用户自定义事件（名称 + 可选时间 HH:mm + 星期几），到条件时间 AI 结合事件生成消息；
 * ③ 自主触发：不给时间不给事件，AI 按人设/记忆/上下文/当前时间自行决定 发不发/什么时候发/发什么；
 * ④ 定时提醒：用户在聊天里说「几分钟后给我发消息」「每天 8 点给我发消息」「每隔 1 小时发一次」，
 *    AI 解析成定时任务（reminder），到点执行（生成消息时以任务内容为指令上下文）。
 *
 * 调度引擎：ProactiveMsgWatcher（PhoneShell 挂载）每 10s 调 runProactiveMsgTick()：
 * 守卫（来电/通话/闹钟互斥）→ 枚举索引（配置过的 app×联系人）→ 逐条判定四类触发 → 生成 → 投递。
 *
 * 投递：复用 ai-delivery 管线（scheduleAiDelivery 逐条节奏）+ pushChatNotification（灵动岛/横幅/系统通知）
 * + 未读角标（wx/qq；用户正在该会话内不计数）+ memAfterAiTurn（主动消息同样写入记忆管线）。
 *
 * 多账号（Task 40-47 架构延续）：设置/执行记录/提醒任务全部经 scopedKvKey 按「对应 App 当前账号」隔离；
 * 引擎只对当前活跃账号的配置生效（切号后另一账号的主动消息自然停发）。
 */

import { genId } from './db';
import { kvGet, kvSet, kvDel, kvGetRaw, kvSetRaw } from './idb-kv';
import { getActiveAccountIdFor, scopedKvKey, type AccountApp } from './accounts';
import { listContacts, ownerProfileFor, cachedOwnerName } from './contacts-store';
import { avatarFor, type ContactRecord } from '@/lib/contacts';
import { buildPersonaSystemPrompt } from './persona';
import { buildNpcPromptExtra } from './npc-bond';
import { loadBlock } from './block-state';
import { getMemSettings, memChatRecallBlock, memAfterAiTurn, memConvoFromRaw } from '@/lib/memory';
import { buildTimeAwareBlock, getTimeAware } from '@/lib/time-aware';
import { scheduleAiDelivery } from './ai-delivery';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { useSettings, useUI } from './store';
import { useIncomingCall } from './incoming-call';
import { useGlobalCall } from './global-call';
import type { ApiConfig } from './store';

// ---------------- 类型与常量 ----------------

/** 主动发消息作用的聊天端（1:1 会话；群聊走各自管线不在本模块范围） */
export type ProactiveApp = 'wx' | 'qq' | 'sms';

/** 单条触发事件：名称 + 可选时间（HH:mm）+ 星期几（0=周日；空数组=每天） */
export interface ProactiveEvent {
  id: string;
  /** 事件描述（如「下班路上」「午休结束」），生成消息时作为情境注入 */
  name: string;
  /** 触发时间 'HH:mm'；空串 = 不按时间触发（仅展示，不自动发） */
  time: string;
  /** 生效星期（0~6）；空数组 = 每天 */
  days: number[];
  enabled: boolean;
}

/** 单个角色的主动发消息配置（三模式独立开关） */
export interface ProactiveMsgConfig {
  /** 定时触发 */
  timerOn: boolean;
  /** 定时模式：按间隔（默认）| 每天定时（对齐钟表时刻；Task 51 B3） */
  timerMode?: 'interval' | 'daily';
  /** 定时间隔（毫秒；最小 15s，UI 档位 30s~24h+自定义） */
  timerMs: number;
  /** timerMode=daily 时的每天发送时刻 'HH:mm' */
  timerDailyTime?: string;
  /** 事件清单 */
  events: ProactiveEvent[];
  /** 自主触发（AI 自己决定发不发/何时发/发什么） */
  autoOn: boolean;
  /** 自主决策节奏（分钟；Task 51 B4 可调，默认 5） */
  autoFreqMin?: number;
}

/** 定时提醒任务（自然语言解析产物） */
export interface ProactiveReminder {
  id: string;
  app: ProactiveApp;
  /** 目标联系人 id */
  cid: string;
  kind: 'once' | 'daily' | 'interval';
  /** once：绝对触发时间（epoch ms） */
  at?: number;
  /** daily：每天触发时刻 'HH:mm' */
  dailyTime?: string;
  /** interval：循环间隔毫秒 */
  intervalMs?: number;
  /** 用户原话（生成消息时的指令上下文，如「提醒我喝水」） */
  note: string;
  createdAt: number;
  /** 上次执行时间（daily/interval 防重；once 触发后任务删除） */
  lastFiredAt?: number;
  firedCount?: number;
}

const CFG_KEY_PREFIX = 'proactive-msg-cfg:';
const LAST_KEY_PREFIX = 'proactive-msg-last:';
const REMINDERS_KEY = 'proactive-msg-reminders';
/** 索引（设备级）：配置过的 {app, cid} 全集；引擎按当前账号读 scoped 配置，无配置自然跳过 */
const INDEX_KEY = 'proactive-msg-index';
/** 最近主动消息历史（按联系人，Task 51 C2） */
const HIST_KEY_PREFIX = 'proactive-msg-hist:';
/** 全局总开关（设备级，Task 51 B2）：true = 所有角色暂停主动发消息（一键全停） */
const MASTER_OFF_KEY = 'proactive-msg-master-off';

/** tick 周期（事件/提醒按分钟判定，10s 轮询足够；定时最细 30s 档误差 ≤10s 可接受） */
export const PROACTIVE_MSG_TICK_MS = 10_000;
/** 到期触发宽限：定时/事件错过 tick（浏览器休眠等）在宽限窗口内仍补发一次 */
const FIRE_GRACE_MS = 90_000;
/** 每日类触发（事件/daily 提醒/每天定时刻）宽限：错过精确分钟（页面没开/休眠）在 N 分钟内仍补发一次（Task 51 A1） */
const SCHEDULED_GRACE_MIN = 5;
/** 对话活跃守卫（Task 51 B1）：最近有消息往来时跳过定时/自主触发，避免打断正在进行的聊天 */
const CONVO_ACTIVE_MS = 120_000;
/** 自主决策间隔基准：每个开启自主模式的角色约每 5 分钟做一次「要不要主动发」决策（可经 autoFreqMin 调整） */
const AUTO_DECIDE_BASE_MS = 5 * 60_000;
/** 自主模式深夜静默：本地时间 [1, 7) 不自主发起（定时/事件/提醒是用户明确意图，不受此限） */
const AUTO_QUIET_START_HOUR = 1;
const AUTO_QUIET_END_HOUR = 7;
/** 自主 wait 建议的下次决策延迟上下限（分钟） */
const AUTO_WAIT_MIN_MINUTES = 5;
const AUTO_WAIT_MAX_MINUTES = 120;
/** 生成消息的最大长度（超出截断；主动消息就该短） */
const MAX_PROACTIVE_LEN = 220;

const DEFAULT_CFG: ProactiveMsgConfig = { timerOn: false, timerMode: 'interval', timerMs: 5 * 60_000, timerDailyTime: '', events: [], autoOn: false, autoFreqMin: 5 };

// ---------------- 全局总开关（Task 51 B2：设备级，一键全停所有角色） ----------------

/** 主动消息是否被全局暂停（设置页里的总开关；设备级，不分账号） */
export function isProactiveMasterOff(): boolean {
  try {
    return kvGetRaw(MASTER_OFF_KEY) === true;
  } catch {
    return false;
  }
}

/** 设置全局总开关（true=暂停全部主动发消息） */
export function setProactiveMasterOff(v: boolean): void {
  try {
    kvSetRaw(MASTER_OFF_KEY, v === true);
  } catch {
    /* 静默 */
  }
}

// ---------------- 配置存储（按 App 当前账号作用域） ----------------

function cfgKeyOf(app: ProactiveApp, cid: string): string {
  return scopedKvKey(`${CFG_KEY_PREFIX}${app}:${cid}`, app as AccountApp);
}

function sanitizeCfg(raw: unknown): ProactiveMsgConfig {
  const r = (raw ?? {}) as Partial<ProactiveMsgConfig>;
  const events = Array.isArray(r.events)
    ? r.events
        .filter((e): e is ProactiveEvent => Boolean(e) && typeof (e as ProactiveEvent).id === 'string')
        .map((e) => ({
          id: e.id,
          name: typeof e.name === 'string' ? e.name.slice(0, 120) : '',
          time: typeof e.time === 'string' && /^\d{2}:\d{2}$/.test(e.time) ? e.time : '',
          days: Array.isArray(e.days) ? e.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).slice(0, 7) : [],
          enabled: e.enabled === true,
        }))
        .slice(0, 20)
    : [];
  const timerMs = typeof r.timerMs === 'number' && Number.isFinite(r.timerMs) ? Math.max(15_000, Math.min(r.timerMs, 7 * 24 * 3600_000)) : DEFAULT_CFG.timerMs;
  const autoFreqMin = typeof r.autoFreqMin === 'number' && Number.isFinite(r.autoFreqMin) ? Math.max(2, Math.min(Math.round(r.autoFreqMin), 120)) : 5;
  return {
    timerOn: r.timerOn === true,
    timerMode: r.timerMode === 'daily' ? 'daily' : 'interval',
    timerMs,
    timerDailyTime: typeof r.timerDailyTime === 'string' && /^\d{2}:\d{2}$/.test(r.timerDailyTime) ? r.timerDailyTime : '',
    events,
    autoOn: r.autoOn === true,
    autoFreqMin,
  };
}

/** 读某角色当前账号下的主动发消息配置（无记录 = 全关默认值） */
export function getProactiveCfg(app: ProactiveApp, cid: string): ProactiveMsgConfig {
  return sanitizeCfg(kvGet<unknown>(cfgKeyOf(app, cid)));
}

/** 写配置（同时维护索引） */
export function setProactiveCfg(app: ProactiveApp, cid: string, cfg: ProactiveMsgConfig): void {
  kvSet(cfgKeyOf(app, cid), sanitizeCfg(cfg));
  upsertIndex(app, cid);
}

/** 配置是否有任何生效中的触发 */
export function cfgHasActiveTrigger(cfg: ProactiveMsgConfig): boolean {
  return cfg.timerOn || cfg.autoOn || cfg.events.some((e) => e.enabled);
}

/** 设置页入口行摘要（如「定时 5 分钟」「事件 2 · 自主」；全关 = 「未开启」） */
export function proactiveCfgSummary(app: ProactiveApp, cid: string): string {
  let cfg: ProactiveMsgConfig;
  try {
    cfg = getProactiveCfg(app, cid);
  } catch {
    return '未开启';
  }
  const parts: string[] = [];
  if (cfg.timerOn) parts.push(cfg.timerMode === 'daily' && cfg.timerDailyTime ? `每天 ${cfg.timerDailyTime}` : `定时${intervalLabel(cfg.timerMs)}`);
  const evtOn = cfg.events.filter((e) => e.enabled).length;
  if (evtOn > 0) parts.push(`事件 ${evtOn}`);
  if (cfg.autoOn) parts.push('自主');
  return parts.length > 0 ? parts.join(' · ') : '未开启';
}

/** 间隔毫秒 → 中文短标签（设置页/摘要共用） */
export function intervalLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}分钟`;
  const h = m / 60;
  if (h < 24 && Number.isInteger(h)) return `${h}小时`;
  if (h < 24) return `${(s / 3600).toFixed(1)}小时`;
  const d = h / 24;
  return Number.isInteger(d) ? `${d}天` : `${(h / 24).toFixed(1)}天`;
}

// ---------------- 索引（设备级 {app,cid} 全集） ----------------

interface IndexEntry {
  app: ProactiveApp;
  cid: string;
}

function readIndex(): IndexEntry[] {
  const raw = kvGet<IndexEntry[]>(INDEX_KEY);
  if (!Array.isArray(raw)) return [];
  const out: IndexEntry[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    if (!e || (e.app !== 'wx' && e.app !== 'qq' && e.app !== 'sms') || typeof e.cid !== 'string' || !e.cid) continue;
    const k = `${e.app}:${e.cid}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ app: e.app, cid: e.cid });
  }
  return out;
}

function upsertIndex(app: ProactiveApp, cid: string): void {
  const list = readIndex();
  if (list.some((e) => e.app === app && e.cid === cid)) return;
  list.push({ app, cid });
  kvSet(INDEX_KEY, list.slice(-200));
}

function removeFromIndex(app: ProactiveApp, cid: string): void {
  kvSet(INDEX_KEY, readIndex().filter((e) => !(e.app === app && e.cid === cid)));
}

// ---------------- 执行记录（防重复触发；按账号作用域） ----------------

interface LastFireRecord {
  /** 定时模式上次触发时间 */
  timerAt?: number;
  /** 事件模式上次触发（key=事件 id，value=触发的分钟戳 Math.floor(now/60000)） */
  evtAt?: Record<string, number>;
  /** 自主模式上次决策时间 */
  autoAt?: number;
  /** 最近一次主动消息正文（生成时防重复） */
  lastSentText?: string;
  /** 最近一次主动消息时间 */
  sentAt?: number;
}

function lastKeyOf(app: ProactiveApp, cid: string): string {
  return scopedKvKey(`${LAST_KEY_PREFIX}${app}:${cid}`, app as AccountApp);
}

function getLast(app: ProactiveApp, cid: string): LastFireRecord {
  const raw = kvGet<LastFireRecord>(lastKeyOf(app, cid));
  return raw && typeof raw === 'object' ? raw : {};
}

function setLast(app: ProactiveApp, cid: string, patch: LastFireRecord): void {
  kvSet(lastKeyOf(app, cid), { ...getLast(app, cid), ...patch });
}

// ---------------- 提醒任务（按 App 账号作用域存数组） ----------------

function remindersKeyOf(app: ProactiveApp): string {
  return scopedKvKey(REMINDERS_KEY, app as AccountApp);
}

function readReminders(app: ProactiveApp): ProactiveReminder[] {
  const raw = kvGet<ProactiveReminder[]>(remindersKeyOf(app));
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is ProactiveReminder =>
      Boolean(r) &&
      typeof (r as ProactiveReminder).id === 'string' &&
      typeof (r as ProactiveReminder).cid === 'string' &&
      ((r as ProactiveReminder).kind === 'once' || (r as ProactiveReminder).kind === 'daily' || (r as ProactiveReminder).kind === 'interval'),
  );
}

function writeReminders(app: ProactiveApp, list: ProactiveReminder[]): void {
  kvSet(remindersKeyOf(app), list.slice(-50));
}

/** 某角色的提醒任务清单（设置页展示/管理用） */
export function remindersFor(app: ProactiveApp, cid: string): ProactiveReminder[] {
  try {
    return readReminders(app)
      .filter((r) => r.cid === cid)
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export function addReminder(app: ProactiveApp, r: ProactiveReminder): void {
  const list = readReminders(app).filter((x) => x.id !== r.id);
  list.push(r);
  writeReminders(app, list);
  upsertIndex(app, r.cid);
}

export function removeReminder(app: ProactiveApp, id: string): void {
  writeReminders(
    app,
    readReminders(app).filter((r) => r.id !== id),
  );
}

/** 提醒任务摘要（设置页/系统行共用） */
export function reminderLabel(r: ProactiveReminder): string {
  if (r.kind === 'once' && typeof r.at === 'number') {
    const d = new Date(r.at);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const today = new Date().toDateString() === d.toDateString();
    return `${today ? '今天' : `${d.getMonth() + 1}月${d.getDate()}日`} ${hm}`;
  }
  if (r.kind === 'daily' && r.dailyTime) return `每天 ${r.dailyTime}`;
  if (r.kind === 'interval' && r.intervalMs) return `每隔${intervalLabel(r.intervalMs)}`;
  return '定时任务';
}

// ---------------- 自然语言 → 提醒任务（四、定时提醒） ----------------

/** 快速正则闸：命中才走 LLM 解析（其他消息零开销） */
const REMINDER_HINT_RE = /(分钟后|小时后|分之后|小时之后|每天|每日|每隔|每天几点|提醒我|叫我|喊我|给我发|发消息给我|发个消息|发条消息)/;
const REMINDER_ACTION_RE = /(发消息|发个消息|发条消息|消息|提醒|叫我|喊我|问候|说句话|聊天)/;

/** 用户这句话像不像「让 AI 定时发消息」的指令（≤60 字短句 + 提醒/发消息 + 时间词） */
export function reminderHintHit(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > 60) return false;
  return REMINDER_HINT_RE.test(t) && REMINDER_ACTION_RE.test(t);
}

interface ReminderParseResult {
  match: boolean;
  kind?: 'once' | 'daily' | 'interval';
  /** once：多少分钟后 */
  minutesLater?: number | null;
  /** daily：每天几点 'HH:mm' */
  dailyTime?: string | null;
  /** interval：每隔多少分钟 */
  intervalMinutes?: number | null;
  /** 任务内容摘要（如「提醒我喝水」；空 = 仅闲聊式问候） */
  note?: string | null;
}

const REMINDER_PARSE_SYSTEM = `你是一个定时任务解析器。用户正在和一个 AI 角色聊天，用户的话可能是「让 AI 在指定时间主动给我发消息」的指令。把它解析成结构化任务。

只输出一个 JSON 对象，格式：
{"match": true或false, "kind": "once"或"daily"或"interval", "minutesLater": 数字或null, "dailyTime": "HH:mm"或null, "intervalMinutes": 数字或null, "note": "任务内容摘要"}

判定规则：
1. match=false：不是定时发消息指令（普通聊天、问句、没有明确的时间意图）。
2. kind=once：一次性的（"3分钟后给我发消息"、"晚上8点提醒我……"、"20分钟以后叫我"）。minutesLater=从当前时间算起的分钟数：能精确到今天某时刻就换算成分钟差；如果那个时刻今天已经过了（如现在 21 点说"晚上8点提醒我"），按明天同一时刻换算（加 1440 分钟）；必须为正数，不允许负数或零。
3. kind=daily：每天重复（"以后每天早上8点给我发消息"、"每天晚上10点说晚安"）。dailyTime="HH:mm"（24小时制，"早上8点"="08:00"，"晚上10点"="22:00"，"中午12点半"="12:30"）。
4. kind=interval：按间隔循环（"每隔1小时给我发个消息"、"每30分钟发一次消息"）。intervalMinutes=分钟数。
5. note=用户想让消息带的内容/目的摘要（如"提醒我喝水""说晚安"）；没有具体目的就写"主动找我聊聊"。
6. 只依据对话里给到的时间信息换算，不要编造；表达含糊缺时间信息时 match=false。
7. 严禁输出 JSON 以外的任何文字。`;

/**
 * 解析用户消息里的定时提醒指令；成功则落任务并返回确认摘要（失败/不像指令返回 null）。
 * 三端聊天发送链路调用：命中正则闸 → LLM 解析 → 落任务 + sys 系统行反馈 + AI 本轮自然确认。
 */
export async function parseReminderInstruction(app: ProactiveApp, cid: string, text: string): Promise<string | null> {
  const t = (text ?? '').trim();
  if (!reminderHintHit(t)) return null;
  try {
    const nowStr = formatNowForPrompt();
    const raw = await callLlmTwoTier(
      REMINDER_PARSE_SYSTEM,
      `当前时间：${nowStr}\n用户对角色说：「${t}」\n请输出 JSON。`,
      useSettings.getState().apiConfig,
    );
    const parsed = extractJsonObjectSafely(raw) as ReminderParseResult | null;
    if (!parsed || parsed.match !== true) return null;
    const kind = parsed.kind;
    if (kind !== 'once' && kind !== 'daily' && kind !== 'interval') return null;

    const now = Date.now();
    let task: ProactiveReminder | null = null;
    if (kind === 'once') {
      const mins = Number(parsed.minutesLater);
      if (!Number.isFinite(mins) || mins <= 0 || mins > 60 * 24 * 30) return null;
      task = { id: genId(), app, cid, kind: 'once', at: now + Math.round(mins * 60_000), note: (parsed.note ?? '').slice(0, 80) || '按约定主动发消息', createdAt: now };
    } else if (kind === 'daily') {
      const hm = typeof parsed.dailyTime === 'string' ? parsed.dailyTime.trim() : '';
      if (!/^\d{2}:\d{2}$/.test(hm) || Number(hm.slice(0, 2)) > 23 || Number(hm.slice(3)) > 59) return null;
      task = { id: genId(), app, cid, kind: 'daily', dailyTime: hm, note: (parsed.note ?? '').slice(0, 80) || '按约定主动发消息', createdAt: now };
    } else {
      const mins = Number(parsed.intervalMinutes);
      if (!Number.isFinite(mins) || mins < 1 || mins > 60 * 24 * 7) return null;
      task = { id: genId(), app, cid, kind: 'interval', intervalMs: Math.round(mins * 60_000), note: (parsed.note ?? '').slice(0, 80) || '按约定主动发消息', createdAt: now };
    }
    addReminder(app, task);
    return `${reminderLabel(task)}｜${task.note}`;
  } catch {
    return null;
  }
}

// ---------------- 最近主动消息历史（Task 51 C2：设置页回看） ----------------

export interface ProactiveHistEntry {
  text: string;
  at: number;
  kind: 'timer' | 'event' | 'auto' | 'reminder';
  /** 迟到补发的提醒（Task 51 A2） */
  late?: boolean;
}

function histKeyOf(app: ProactiveApp, cid: string): string {
  return scopedKvKey(`${HIST_KEY_PREFIX}${app}:${cid}`, app as AccountApp);
}

function pushHist(app: ProactiveApp, cid: string, entry: ProactiveHistEntry): void {
  try {
    const list = kvGet<ProactiveHistEntry[]>(histKeyOf(app, cid));
    const next = Array.isArray(list) ? list : [];
    next.push(entry);
    kvSet(histKeyOf(app, cid), next.slice(-20));
  } catch {
    /* 静默 */
  }
}

/** 某角色最近主动消息（新的在前；设置页展示用） */
export function proactiveHistory(app: ProactiveApp, cid: string): ProactiveHistEntry[] {
  try {
    const list = kvGet<ProactiveHistEntry[]>(histKeyOf(app, cid));
    return Array.isArray(list) ? [...list].reverse().filter((e) => e && typeof e.text === 'string' && typeof e.at === 'number') : [];
  } catch {
    return [];
  }
}

/** 历史时间短标签：今天 HH:MM / 昨天 HH:MM / M月D日 */
export function histTimeLabel(at: number): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  const dayOf = (x: Date): number => Math.floor(x.getTime() / 86_400_000);
  const diff = dayOf(now) - dayOf(d);
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

// ---------------- 消息读取（三端 kv 键归一化；与 proactive-call 同口径） ----------------

const WX_MSGS_KEY = (id: string): string => `wx-chat-msgs:${id}`;
const QQ_MSGS_KEY = (id: string): string => `qq-chat-msgs:${id}`;
const SMS_MSGS_KEY = (id: string): string => `ios-chat-msgs:c:${id}`;

function msgsKeyOf(app: ProactiveApp, cid: string): string {
  return app === 'wx' ? WX_MSGS_KEY(cid) : app === 'qq' ? QQ_MSGS_KEY(cid) : SMS_MSGS_KEY(cid);
}

interface NormMsg {
  role: 'user' | 'assistant';
  text: string;
  time: number;
}

function extractMsgText(r: Record<string, unknown>): string {
  if (r.recalled === true || r.error === true) return '';
  if (r.sys || r.blkreq || r.notice) return '';
  const kind = typeof r.kind === 'string' ? r.kind : 'text';
  if (kind === 'call' || kind === 'redpacket' || kind === 'transfer' || kind === 'family' || kind === 'forward' || kind === 'groupcard' || kind === 'blockreq' || kind === 'sys' || kind === 'textcard') {
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
      return d ? `[图片] ${d}` : '[图片]';
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
      return content.startsWith('data:') ? '[图片]' : content;
  }
}

function readNormMsgs(app: ProactiveApp, cid: string): NormMsg[] {
  const raw = kvGet<unknown>(msgsKeyOf(app, cid));
  if (!Array.isArray(raw)) return [];
  const out: NormMsg[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const role = r.role === 'user' || r.role === 'me' ? ('user' as const) : r.role === 'assistant' || r.role === 'peer' ? ('assistant' as const) : null;
    if (!role || typeof r.time !== 'number') continue;
    const text = extractMsgText(r);
    if (!text.trim()) continue;
    out.push({ role, text, time: r.time });
  }
  return out.sort((a, b) => a.time - b.time);
}

// ---------------- 当前正在查看的会话登记（角标守卫） ----------------

const activeChats = new Map<string, true>();

/** 聊天页挂载/卸载时登记：用户正看着的会话收主动消息不涨角标（消息实时可见） */
export function setActiveProactiveChat(app: ProactiveApp, cid: string | null): void {
  const k = `${app}:${cid}`;
  for (const key of Array.from(activeChats.keys())) if (key.startsWith(`${app}:`)) activeChats.delete(key);
  if (cid) activeChats.set(k, true);
}

function isActiveChat(app: ProactiveApp, cid: string): boolean {
  return activeChats.has(`${app}:${cid}`);
}

// ---------------- LLM 调用（两级兜底：用户配置 → 内置模型；与 friend-state 同款） ----------------

async function callLlmTwoTier(system: string, userContent: string, apiConfig: ApiConfig): Promise<string> {
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }], ...extra }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  let raw = '';
  try {
    raw = await call({ config: apiConfig });
  } catch {
    raw = '';
  }
  if (!raw.trim()) {
    try {
      raw = await call({ forceSdk: true });
    } catch {
      raw = '';
    }
  }
  return raw;
}

/** 从 LLM 原文抠 JSON 对象（三级：整段 parse → 首个 {...} 块 → null） */
function extractJsonObjectSafely(raw: string): Record<string, unknown> | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as unknown;
    if (j && typeof j === 'object') return j as Record<string, unknown>;
  } catch {
    /* 继续兜底 */
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as unknown;
      if (j && typeof j === 'object') return j as Record<string, unknown>;
    } catch {
      /* 放弃 */
    }
  }
  return null;
}

// ---------------- 消息生成（五、消息内容生成） ----------------

function formatNowForPrompt(): string {
  const d = new Date();
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${week} ${hm}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** 触发原因 → 人类可读说明（进 prompt） */
function triggerDesc(trigger: FireTrigger): string {
  switch (trigger.kind) {
    case 'timer':
      return '定时触发：你之前和对方约好保持联系，现在到了你该主动发消息的时间（对方没有先说话，是你在主动开口）。';
    case 'event':
      return `事件触发：现在正是「${trigger.eventName ?? ''}」的时候，你因为这个事件想给对方发条消息。`;
    case 'reminder':
      return `定时提醒：对方之前请你「${trigger.note ?? '到点给 TA 发条消息'}」，现在到时间了，你要兑现这个约定${trigger.late ? '（这次提醒比约定时间晚到了——设备可能没开着，你要自然地带一句歉意，比如开头说「来晚了」，然后把该说的说完）' : ''}。`;
    case 'auto':
      return '自主触发：你自己决定此刻主动发一条消息（系统判断当前时机合适，你按自己的性格和心情自由发挥）。';
  }
}

/** 生成规则（人设 extraRules 追加） */
function genRules(trigger: FireTrigger, timeAware: boolean): string[] {
  const rules = [
    '【主动发消息场景】你现在要主动给对方发一条消息——不是回复，对方没有在等你说话，是你主动开口。',
    '像平时聊天一样自然口语化，一到两句就好（一般不超过 50 字），禁止标题、解释、括号说明、JSON、markdown，禁止用引号把整条消息包起来。',
    `触发情境：${triggerDesc(trigger)}`,
    '结合你们的关系、人设和最近聊过的内容：可以延续上次话题、分享你「刚发生/刚想到」的近况、问候、调侃、吐槽，像真人想到什么发什么。',
    '绝对不要重复你最近已经说过的话（尤其是你上一条主动消息和最近聊天里的内容），也不要复述对方的话。',
    '不要每次都用同一种开头（「在吗」「在干什么」不要连着用），内容要有新信息量。',
  ];
  if (timeAware) rules.push('内容必须符合当前真实时间（深夜别元气满满问吃了吗、早上适合问早、饭点可以聊吃的；节日节气可以自然提到）。');
  if (trigger.kind === 'reminder' && trigger.note) rules.push(`消息要贴合对方的请求「${trigger.note}」（该提醒就提醒、该说晚安就说晚安），用你自己的口吻说。`);
  return rules;
}

/** 近期对话 → prompt 文本（末尾若干条；含角色标签） */
function convoLines(norm: NormMsg[], count: number, peerName: string, userName: string): string {
  const lines: string[] = [];
  for (const m of norm.slice(-count)) {
    lines.push(`${m.role === 'user' ? userName : peerName}：${m.text}`);
  }
  return lines.join('\n');
}

interface FireTrigger {
  kind: 'timer' | 'event' | 'auto' | 'reminder';
  eventName?: string;
  note?: string;
  /** 提醒迟到补发（Task 51 A2）：生成时带歉意 */
  late?: boolean;
}

/**
 * 生成一条主动消息正文（失败返回空串）。
 * system = 人设（含生成规则）+ 记忆召回 + 时间感知；user = 触发情境 + 近期对话 + 防重复提示。
 */
async function generateProactiveText(app: ProactiveApp, contact: ContactRecord, trigger: FireTrigger, npcExtra: Record<string, unknown> | null): Promise<string> {
  const sessionKey = app === 'wx' ? `wx:${contact.id}` : app === 'qq' ? `qq:${contact.id}` : `sms:c:${contact.id}`;
  const norm = readNormMsgs(app, contact.id);
  const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
  const userName = owner?.realName || '用户';
  const last = getLast(app, contact.id);

  // 时间感知开关（会话级设置；自主触发永远注入——AI 要靠时间做决策）
  const timeAwareOn = trigger.kind === 'auto' ? true : getTimeAware(sessionKey);
  const timeBlock = timeAwareOn
    ? buildTimeAwareBlock({ lastMsgTime: norm.length > 0 ? norm[norm.length - 1].time : null, regionHint: contact.region || null })
    : '';

  // 人设（小号场景账号解析 + 大号记忆披露门控与三端聊天完全同源）
  const disclosureText = norm
    .filter((m) => m.role === 'user')
    .slice(-6)
    .map((m) => m.text)
    .join(' ');
  const persona = buildPersonaSystemPrompt(contact, {
    channel: app === 'wx' ? '微信' : app === 'qq' ? 'QQ' : '短信',
    userName: owner?.realName || null,
    userRealName: owner?.realName || null,
    userNickname: owner?.nickname || null,
    ownerName: owner?.realName || null,
    multiApp: getMemSettings(contact.id).share,
    accountId: getActiveAccountIdFor(app as AccountApp),
    extraRules: genRules(trigger, timeAwareOn),
    ...(npcExtra ?? {}),
  });
  const memoryBlock = memChatRecallBlock(contact.id, app, [trigger.note ?? '', trigger.eventName ?? '', disclosureText].filter(Boolean).join(' '), {
    disclosureText: disclosureText || undefined,
    altMainName: cachedOwnerName(),
    altMainRelation: contact.relation?.trim() || '',
  });

  const system = [persona, memoryBlock, timeBlock].filter(Boolean).join('\n\n');

  // user prompt：情境 + 最近对话 + 防重复
  const recent = convoLines(norm, 12, contact.name, userName);
  const parts: string[] = [];
  if (recent.trim()) parts.push(`【最近聊天】\n${recent}`);
  else parts.push('【最近聊天】\n（最近没有聊天记录，你们有一阵子没说话了）');
  if (last.lastSentText) parts.push(`【你最近一次主动发的消息（严禁重复类似内容）】\n${last.lastSentText}`);
  parts.push('【现在】\n请直接输出你要发给对方的消息正文（只有正文，一行，不要任何前后缀）。');
  const user = parts.join('\n\n');

  const raw = await callLlmTwoTier(system, user, useSettings.getState().apiConfig);
  // 清洗：去引号包裹/前缀说明/多余空白；主动消息必须短
  let text = (raw ?? '').trim();
  text = text.replace(/^[「"'『]+|[」"'』]+$/g, '').trim();
  text = text.replace(/^(好的[，,]?|以下是?我(要发|给对方)的?消息[：:]?)\s*/i, '').trim();
  const firstLine = text.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
  text = (firstLine || text).slice(0, MAX_PROACTIVE_LEN).trim();
  return text;
}

// ---------------- 自主决策（三、自主触发） ----------------

interface AutoDecision {
  action: 'send' | 'wait';
  message?: string;
  delayMinutes?: number;
}

function isAutoQuietHour(now: number): boolean {
  const h = new Date(now).getHours();
  return h >= AUTO_QUIET_START_HOUR && h < AUTO_QUIET_END_HOUR;
}

/** 自主模式决策 prompt 规则 */
function autoRules(): string[] {
  return [
    '【自主发消息决策】你正在决定要不要此刻主动给对方发一条消息。这不是必须发的任务——发不发完全由你根据人设、心情、你们的关系和当前时间自然决定。',
    '考虑因素：人设性格（高冷/慢热的人主动频率低）、你们的记忆和最近聊过什么、当前时间（深夜/清晨/工作时间的分寸）、距上次聊天过了多久（刚聊完没必要马上又发）。',
    '一般来说：有好玩的想分享、惦记对方、有正当由头（饭点/天气/对方提过的事）→ 可以发；刚聊完没多久、深夜、没什么想说的、对方可能不方便 → 选 wait。',
    '输出 JSON：{"action":"send"或"wait","message":"action=send 时要发的消息正文（一行，像平时聊天，1~2 句）","delayMinutes":数字（action=wait 时建议多久后再考虑，5~120）,"reason":"一句话理由"}',
    '严禁输出 JSON 以外的文字。send 的消息必须是有内容量的（不要空洞的「在吗」）。',
  ];
}

/** 自主决策（send=直接拿到消息正文，一次调用同时决策+生成） */
async function decideAutonomous(app: ProactiveApp, contact: ContactRecord, npcExtra: Record<string, unknown> | null): Promise<AutoDecision> {
  const norm = readNormMsgs(app, contact.id);
  const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
  const userName = owner?.realName || '用户';
  const last = getLast(app, contact.id);

  const persona = buildPersonaSystemPrompt(contact, {
    channel: app === 'wx' ? '微信' : app === 'qq' ? 'QQ' : '短信',
    userName: owner?.realName || null,
    userRealName: owner?.realName || null,
    userNickname: owner?.nickname || null,
    ownerName: owner?.realName || null,
    multiApp: getMemSettings(contact.id).share,
    accountId: getActiveAccountIdFor(app as AccountApp),
    extraRules: autoRules(),
    ...(npcExtra ?? {}),
  });
  const disclosureText = norm.filter((m) => m.role === 'user').slice(-6).map((m) => m.text).join(' ');
  const memoryBlock = memChatRecallBlock(contact.id, app, disclosureText, {
    disclosureText: disclosureText || undefined,
    altMainName: cachedOwnerName(),
    altMainRelation: contact.relation?.trim() || '',
  });
  const timeBlock = buildTimeAwareBlock({ lastMsgTime: norm.length > 0 ? norm[norm.length - 1].time : null, regionHint: contact.region || null });
  // Task 51 C1：启用中的事件（含未设时间的纯情境事件）作为自主决策的情境参考
  let eventsBlock = '';
  try {
    const evts = getProactiveCfg(app, contact.id).events.filter((e) => e.enabled);
    if (evts.length > 0) {
      eventsBlock = `【你生活中的事件安排（可作为自然的开场由头）】\n${evts.map((e) => `- ${e.name}${e.time ? `（${dayLabel(e.days)} ${e.time}）` : ''}`).join('\n')}`;
    }
  } catch {
    /* 忽略 */
  }
  const system = [persona, memoryBlock, timeBlock, eventsBlock].filter(Boolean).join('\n\n');

  const recent = convoLines(norm, 10, contact.name, userName);
  const gapDesc = (() => {
    const lastAt = norm.length > 0 ? norm[norm.length - 1].time : 0;
    if (!lastAt) return '从来没有聊过天（你们可能只是刚加上好友）';
    const gapMin = Math.round((Date.now() - lastAt) / 60_000);
    if (gapMin < 5) return '刚刚还在聊';
    if (gapMin < 120) return `距上一条消息约 ${gapMin} 分钟`;
    if (gapMin < 60 * 48) return `距上次聊天约 ${(gapMin / 60).toFixed(1)} 小时`;
    return `距上次聊天超过 ${(gapMin / 60 / 24).toFixed(1)} 天`;
  })();
  const parts = [`【当前时间】${formatNowForPrompt()}`, `【聊天状态】${gapDesc}`];
  if (recent.trim()) parts.push(`【最近聊天】\n${recent}`);
  if (last.lastSentText) parts.push(`【你最近一次主动发的消息（若决定 send，不要再发类似内容）】\n${last.lastSentText}`);
  parts.push('【任务】输出决策 JSON。');

  const raw = await callLlmTwoTier(system, parts.join('\n\n'), useSettings.getState().apiConfig);
  const parsed = extractJsonObjectSafely(raw) as Partial<AutoDecision> & { reason?: unknown } | null;
  if (!parsed) return { action: 'wait', delayMinutes: AUTO_WAIT_MIN_MINUTES };
  if (parsed.action === 'send' && typeof parsed.message === 'string' && parsed.message.trim()) {
    let msg = parsed.message.trim().replace(/^[「"'『]+|[」"'』]+$/g, '');
    msg = msg.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
    if (!msg) return { action: 'wait', delayMinutes: AUTO_WAIT_MIN_MINUTES };
    return { action: 'send', message: msg.slice(0, MAX_PROACTIVE_LEN) };
  }
  const d = Number(parsed.delayMinutes);
  const delay = Number.isFinite(d) ? Math.max(AUTO_WAIT_MIN_MINUTES, Math.min(Math.round(d), AUTO_WAIT_MAX_MINUTES)) : AUTO_WAIT_MIN_MINUTES;
  return { action: 'wait', delayMinutes: delay };
}

// ---------------- 投递（落库 + 通知 + 角标 + 记忆） ----------------

/** 主动消息投递：写三端消息记录 + pushChatNotification + wx/qq 未读角标（正在看不计数） */
async function deliverProactiveMsg(app: ProactiveApp, contact: ContactRecord, text: string, trigger: FireTrigger): Promise<void> {
  const cid = contact.id;
  const sessionKey = app === 'wx' ? `wx:${cid}` : app === 'qq' ? `qq:${cid}` : `sms:c:${cid}`;
  const notifyApp = app === 'wx' ? ('wechat' as const) : app === 'qq' ? ('qq' as const) : ('chat' as const);
  const avatarApp = app as AccountApp;
  const now = Date.now();
  const msg =
    app === 'sms'
      ? { id: genId(), role: 'assistant' as const, content: text, time: now, kind: 'text' as const }
      : { id: genId(), role: 'peer' as const, content: text, time: now, kind: 'text' as const };

  const saveOne = (m: typeof msg): void => {
    try {
      const key = msgsKeyOf(app, cid);
      const raw = kvGet<unknown[]>(key);
      const list = Array.isArray(raw) ? raw : [];
      kvSet(key, [...list, m].slice(-(app === 'sms' ? 100 : 200)));
    } catch {
      /* 落库失败静默 */
    }
  };

  await scheduleAiDelivery<typeof msg>(
    sessionKey,
    [msg],
    (m) => {
      saveOne(m);
      pushChatNotification({
        sessionKey,
        app: notifyApp,
        title: contact.name,
        avatar: avatarFor(contact, avatarApp),
        body: m.content,
        target: { app: notifyApp, contactId: cid },
      });
      if (!isActiveChat(app, cid)) {
        if (app === 'wx') wxUnreads.bump(cid, 1);
        else if (app === 'qq') qqUnreads.bump(cid, 1);
      }
    },
    { initialDelay: 0 },
  );

  setLast(app, cid, { lastSentText: text, sentAt: now });
  // 最近主动消息历史（Task 51 C2：设置页回看，每角色最近 20 条）
  pushHist(app, cid, { text, at: now, kind: trigger.kind, late: trigger.late });

  // 写记忆：主动消息同样进记忆管线（七.2）——与三端聊天 memAfterAiTurn 同口径
  try {
    const apiCfg = useSettings.getState().apiConfig;
    const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
    const getRaw = (): unknown[] => {
      const r = kvGet<unknown>(msgsKeyOf(app, cid));
      return Array.isArray(r) ? r : [];
    };
    memAfterAiTurn(
      cid,
      app as AccountApp,
      apiCfg,
      () => memConvoFromRaw(getRaw(), contact.name),
      getRaw,
      { user: owner?.realName || null, peer: contact.name },
      { scene: app === 'wx' ? '微信主动发消息' : app === 'qq' ? 'QQ主动发消息' : '短信主动发消息' },
    );
  } catch {
    /* 记忆失败不影响投递 */
  }
}

// ---------------- tick 主流程 ----------------

let tickRunning = false;

/** 测试/调试：tick 是否正在执行 */
export function isProactiveMsgTickRunning(): boolean {
  return tickRunning;
}

/** Watcher 取 tick 参数（预留：未来可加全局频率档） */
export function getProactiveMsgTickParams(): { interval: number } {
  return { interval: PROACTIVE_MSG_TICK_MS };
}

/**
 * 调度 tick（ProactiveMsgWatcher 每 10s 调用；任何失败静默——后台增强能力）。
 * 优先级：定时 > 事件 > 提醒 > 自主（同一角色一个 tick 最多发一条）。
 */
export async function runProactiveMsgTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await tickInner();
  } catch {
    /* 静默 */
  } finally {
    tickRunning = false;
  }
}

/** 同一自然日判定（daily 类触发的按天去重） */
function sameDay(a: number | undefined, b: number): boolean {
  if (typeof a !== 'number') return false;
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** 分钟数（自当日零点）→ 当日该时刻的分钟戳 */
function schedMinuteStamp(now: number, minutesOfDay: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() + minutesOfDay * 60_000) / 60_000);
}

/**
 * 事件此刻是否到期（Task 51 A1：宽限窗口 SCHEDULED_GRACE_MIN 分钟内错过仍补发；
 * 返回值 = 计划时刻的分钟戳（防重发去重键），null = 未到期）。
 */
function dueEventOf(e: ProactiveEvent, now: number, firedEvtAt: Record<string, number> | undefined): number | null {
  if (!e.enabled || !e.time) return null;
  const d = new Date(now);
  const [hh, mm] = e.time.split(':').map(Number);
  const dm = hh * 60 + mm;
  const cm = d.getHours() * 60 + d.getMinutes();
  if (cm < dm || cm - dm > SCHEDULED_GRACE_MIN) return null;
  if (e.days.length > 0 && !e.days.includes(d.getDay())) return null;
  const stamp = schedMinuteStamp(now, dm);
  return (firedEvtAt?.[e.id] ?? -1) !== stamp ? stamp : null;
}

/**
 * 到期的提醒任务（Task 51 A1/A2）：
 * once — 到点就发，不再静默丢弃：迟到也补发（late=超过宽限），任务触发后照常删除；
 * daily — 按天去重 + SCHEDULED_GRACE_MIN 分钟宽限（错过精确分钟仍补发）；
 * interval — 间隔到了就发（天然带宽限）。
 */
function dueReminderOf(app: ProactiveApp, cid: string, now: number): { r: ProactiveReminder; late: boolean } | null {
  const list = readReminders(app).filter((r) => r.cid === cid);
  const d = new Date(now);
  const cm = d.getHours() * 60 + d.getMinutes();
  for (const r of list) {
    if (r.kind === 'once' && typeof r.at === 'number' && !r.lastFiredAt) {
      if (r.at <= now) return { r, late: now - r.at > FIRE_GRACE_MS };
      continue;
    }
    if (r.kind === 'daily' && r.dailyTime) {
      const [hh, mm] = r.dailyTime.split(':').map(Number);
      const dm = hh * 60 + mm;
      if (cm >= dm && cm - dm <= SCHEDULED_GRACE_MIN && !sameDay(r.lastFiredAt, now)) return { r, late: cm - dm > 1 };
      continue;
    }
    if (r.kind === 'interval' && r.intervalMs) {
      if (now - (r.lastFiredAt ?? r.createdAt) >= r.intervalMs) return { r, late: false };
      continue;
    }
  }
  return null;
}

async function tickInner(): Promise<void> {
  const nowMs = Date.now();

  // 全局总开关（Task 51 B2）：一键暂停所有角色的主动发消息
  if (isProactiveMasterOff()) return;

  // 交互中守卫（与主动来电同口径）：来电响铃/通话进行中不主动发消息（真实手机语义：通话里不来新消息提示音轰炸）
  if (useIncomingCall.getState().call) return;
  if (useGlobalCall.getState().session) return;
  if (useUI.getState().callActive) return;
  if (useUI.getState().alarmRinging) return;

  const index = readIndex();
  if (index.length === 0) return;

  const allContacts = await listContacts().catch(() => [] as ContactRecord[]);
  if (allContacts.length === 0) return;

  for (const entry of index) {
    const { app, cid } = entry;
    // 账号隔离：配置/执行记录/提醒都按对应 App 当前账号读；其他账号的配置自然不可见
    const cfg = getProactiveCfg(app, cid);
    const contact = allContacts.find((c) => c.id === cid);
    if (!contact || contact.kind === 'user' || !contact.name?.trim() || !contact.persona?.trim()) continue;
    // 拉黑守卫：用户拉黑角色 / 角色拉黑用户 → 都不主动发
    const blk = loadBlock(app, cid);
    if (blk.byUser || blk.byChar) continue;

    // 对话活跃守卫（Task 51 B1）：最近 2 分钟内有消息往来时跳过定时/自主触发（不打断正在进行的聊天；
    // 事件/提醒是用户明确约定，不受此限）。10s tick 稍后再试。
    let convActive = false;
    try {
      const norm = readNormMsgs(app, cid);
      convActive = norm.length > 0 && nowMs - norm[norm.length - 1].time < CONVO_ACTIVE_MS;
    } catch {
      convActive = false;
    }

    const last = getLast(app, cid);
    const npcExtra = contact.kind === 'npc' ? (buildNpcPromptExtra(contact, allContacts) as unknown as Record<string, unknown> | null) : null;

    // ① 定时触发（interval=按间隔累计；daily=对齐钟表时刻，按天去重+宽限）
    if (cfg.timerOn && !convActive) {
      if (cfg.timerMode === 'daily' && cfg.timerDailyTime) {
        const [hh, mm] = cfg.timerDailyTime.split(':').map(Number);
        const dm = hh * 60 + mm;
        const d = new Date(nowMs);
        const cm = d.getHours() * 60 + d.getMinutes();
        if (cm >= dm && cm - dm <= SCHEDULED_GRACE_MIN && !sameDay(last.timerAt, nowMs)) {
          setLast(app, cid, { timerAt: nowMs });
          await fireProactive(app, contact, { kind: 'timer' }, npcExtra);
          continue;
        }
      } else if (nowMs - (last.timerAt ?? 0) >= cfg.timerMs) {
        setLast(app, cid, { timerAt: nowMs });
        await fireProactive(app, contact, { kind: 'timer' }, npcExtra);
        continue;
      }
    }

    // ② 事件触发（宽限窗口内错过仍补发；按计划时刻分钟戳去重）
    const firedEvt = last.evtAt ?? {};
    let evtFired = false;
    for (const e of cfg.events) {
      const stamp = dueEventOf(e, nowMs, firedEvt);
      if (stamp !== null) {
        setLast(app, cid, { evtAt: { ...firedEvt, [e.id]: stamp } });
        await fireProactive(app, contact, { kind: 'event', eventName: e.name }, npcExtra);
        evtFired = true;
        break;
      }
    }
    if (evtFired) continue;

    // ③ 定时提醒（自然语言任务；once 迟到也补发并标注 late）
    const due = dueReminderOf(app, cid, nowMs);
    if (due) {
      const rem = due.r;
      if (rem.kind === 'once') removeReminder(app, rem.id);
      else writeReminders(app, readReminders(app).map((r) => (r.id === rem.id ? { ...r, lastFiredAt: nowMs, firedCount: (r.firedCount ?? 0) + 1 } : r)));
      await fireProactive(app, contact, { kind: 'reminder', note: rem.note, late: due.late }, npcExtra);
      continue;
    }

    // ④ 自主触发（深夜静默；决策节奏可调 autoFreqMin，wait 决策会推迟下次决策点）
    if (cfg.autoOn && !convActive && !isAutoQuietHour(nowMs)) {
      const baseMs = Math.max(2, cfg.autoFreqMin ?? 5) * 60_000;
      if (nowMs - (last.autoAt ?? 0) >= baseMs) {
        setLast(app, cid, { autoAt: nowMs });
        await fireProactive(app, contact, { kind: 'auto' }, npcExtra);
      }
    }
  }
}

// ---------------- 统一触发入口（生成锁 + 去重 + 投递） ----------------

/** 联系人级生成锁：同一角色正在生成/投递时其他 tick 跳过（防短间隔下重叠生成重复消息） */
const generating = new Set<string>();

/**
 * 生成并投递一条主动消息（auto 触发先走决策；任何失败静默）。
 * 生成后与最近 AI 发言去重（完全相同 → 丢弃），避免「间隔 < 生成耗时」时的重复消息。
 */
async function fireProactive(app: ProactiveApp, contact: ContactRecord, trigger: FireTrigger, npcExtra: Record<string, unknown> | null): Promise<void> {
  const key = `${app}:${contact.id}`;
  if (generating.has(key)) return;
  generating.add(key);
  try {
    let text: string;
    if (trigger.kind === 'auto') {
      const decision = await decideAutonomous(app, contact, npcExtra);
      if (decision.action !== 'send' || !decision.message) {
        // wait：把下次决策推迟到建议时间（autoAt 后移，min 5min；基准用当前配置的决策节奏）
        const delayMs = (decision.delayMinutes ?? AUTO_WAIT_MIN_MINUTES) * 60_000;
        const baseMs = Math.max(2, getProactiveCfg(app, contact.id).autoFreqMin ?? AUTO_DECIDE_BASE_MS / 60_000) * 60_000;
        setLast(app, contact.id, { autoAt: Date.now() + Math.max(0, delayMs - baseMs) });
        return;
      }
      text = decision.message;
    } else {
      text = await generateProactiveText(app, contact, trigger, npcExtra);
    }
    if (!text) return;
    // 去重：与最近 6 条 AI 发言/上次主动消息完全相同 → 不投（LLM 在上下文未变时可能复述同一条）
    const recent = readNormMsgs(app, contact.id).slice(-6).filter((m) => m.role === 'assistant').map((m) => m.text.trim());
    const lastSent = getLast(app, contact.id).lastSentText?.trim();
    if (lastSent) recent.push(lastSent);
    if (recent.includes(text)) return;
    await deliverProactiveMsg(app, contact, text, trigger);
  } catch {
    /* 静默 */
  } finally {
    generating.delete(key);
  }
}

// ---------------- 聊天发送链路：提醒指令接线辅助 ----------------

/** AI 本轮回复的确认提示（宿主在提醒任务创建成功后作为 sysEvent 注入本轮上下文，AI 自然确认） */
export function reminderSysHint(label: string): string {
  return `【定时提醒已生效】系统已根据用户刚才的话创建定时任务（${label}），到点你会自动给用户发消息。你可以在这次回复里自然地向用户确认这件事（不要提"系统""JSON"或"任务"这类字眼）。`;
}

/**
 * 在聊天里落一条「任务已创建」系统行（居中灰字胶囊；三端 sys 消息形状对齐各自管线）。
 * 返回构造好的 sys 消息对象（宿主自行 setMsgs + saveMsgs）。
 */
export function buildReminderSysMsg(app: ProactiveApp, label: string): Record<string, unknown> {
  const now = Date.now();
  const text = `已设置定时提醒：${label}`;
  return app === 'sms'
    ? { id: genId(), role: 'assistant' as const, content: '', time: now, kind: 'sys' as const, sys: { text } }
    : { id: genId(), role: 'peer' as const, content: '', time: now, kind: 'sys' as const, sys: { text } };
}

// ---------------- 联系人删除清理 ----------------

/** 删除联系人时清扫主动发消息的全部痕迹（配置/执行记录/提醒任务/历史/索引） */
export function purgeProactiveForContact(cid: string): void {
  try {
    for (const app of ['wx', 'qq', 'sms'] as ProactiveApp[]) {
      kvDel(scopedKvKey(`${CFG_KEY_PREFIX}${app}:${cid}`, app as AccountApp));
      kvDel(scopedKvKey(`${LAST_KEY_PREFIX}${app}:${cid}`, app as AccountApp));
      kvDel(scopedKvKey(`${HIST_KEY_PREFIX}${app}:${cid}`, app as AccountApp));
      writeReminders(
        app,
        readReminders(app).filter((r) => r.cid !== cid),
      );
    }
    removeFromIndex('wx', cid);
    removeFromIndex('qq', cid);
    removeFromIndex('sms', cid);
  } catch {
    /* 清理失败静默 */
  }
}

// ---------------- 手动触发（Task 51 C1：事件行「立即发一条」） ----------------

/**
 * 立即按指定事件生成并发送一条主动消息（设置页手动触发；不走定时判定，不影响 evtAt 记录）。
 * 返回是否成功进入生成/投递（去重/锁/拉黑等与自动触发同口径）。
 */
export async function manuallyFireEvent(app: ProactiveApp, cid: string, eventId: string): Promise<boolean> {
  try {
    const cfg = getProactiveCfg(app, cid);
    const evt = cfg.events.find((e) => e.id === eventId);
    if (!evt) return false;
    const all = await listContacts().catch(() => [] as ContactRecord[]);
    const contact = all.find((c) => c.id === cid);
    if (!contact || contact.kind === 'user' || !contact.name?.trim() || !contact.persona?.trim()) return false;
    const blk = loadBlock(app, cid);
    if (blk.byUser || blk.byChar) return false;
    const npcExtra = contact.kind === 'npc' ? (buildNpcPromptExtra(contact, all) as unknown as Record<string, unknown> | null) : null;
    await fireProactive(app, contact, { kind: 'event', eventName: evt.name }, npcExtra);
    return true;
  } catch {
    return false;
  }
}

// ---------------- 导出：给设置页的小工具 ----------------

/** 星期数字 → 中文短标签 */
export function dayLabel(days: number[]): string {
  if (!days || days.length === 0 || days.length === 7) return '每天';
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const sorted = [...days].sort((a, b) => a - b);
  // 工作日/周末快捷判定
  if (sorted.join(',') === '1,2,3,4,5') return '工作日';
  if (sorted.join(',') === '0,6') return '周末';
  return sorted.map((d) => names[d]).join(' ');
}

/** 事件摘要（设置页行） */
export function eventLabel(e: ProactiveEvent): string {
  const when = e.time ? `${dayLabel(e.days)} ${e.time}` : dayLabel(e.days);
  return `${e.name || '未命名事件'}（${when}）`;
}
