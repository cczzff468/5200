'use client';

/**
 * 记忆库（跨 App 共享记忆）：记忆碎片 / 长期记忆 / 每联系人设置。
 *
 * 设计要点（「记忆库 APP」需求）：
 * - 数据全部按【联系人 ID】隔离，localStorage 持久化（与聊天记录同层，重启保留）：
 *   · mem-frag:<contactId>   记忆碎片（每条带来源 App 标记）
 *   · mem-ltm:<contactId>    长期记忆（核心记忆，带来源碎片数量/来源 App 集合）
 *   · mem-settings:<contactId> 每联系人设置（提取频率/总结阈值/互通开关）
 *   · mem-round:<contactId>:<app>  各 App 会话的对话轮次计数（提取节奏用）
 * - 互通开关（默认开）：开 = 四个 App（QQ/微信/信息/电话）共享该联系人全部记忆；
 *   关 = 各 App 只召回自己来源的记忆（碎片按 app 标记过滤、长期记忆按来源 App 集合过滤）。
 *   存储始终单一池 + App 标记：切换开关无需迁移数据，UI 管理视图始终展示该联系人全部记忆。
 * - 不同联系人之间永远隔离：键即隔离边界，召回/提取都不跨联系人读取。
 * - 提取/总结调用 /api/memory/extract 与 /api/memory/summarize（用户 API 配置优先，
 *   服务端 SDK 兜底）；自动提取失败静默（下一窗口重试），手动「立即总结」失败给提示。
 * - 删除联系人时由 contacts-store.deleteContact 调 memPurgeContact 级联清理全部记忆。
 */

import type { ApiConfig } from '@/lib/ios/store';

// ---------------- 类型 ----------------

export type MemApp = 'wx' | 'qq' | 'sms' | 'phone';

export const MEM_APP_LABEL: Record<MemApp, string> = { wx: '微信', qq: 'QQ', sms: '信息', phone: '电话' };

/** 记忆碎片：每 N 轮对话（或手动总结）提取的一条「事实/偏好/承诺」 */
export interface MemFragment {
  id: string;
  contactId: string;
  /** 来源会话（哪个 App 的对话提取出来的） */
  app: MemApp;
  content: string;
  /** 来源时间：提取时对话最后一条消息的时间 */
  sourceTime: number;
  createdAt: number;
  /** 手动编辑过的时间（编辑后不再被自动流程改写） */
  editedAt?: number;
  /** 已被长期记忆总结消费（召回时由长期记忆代表，避免重复注入） */
  consumedAt?: number;
}

/** 长期记忆：M 条碎片自动总结出的一条核心记忆 */
export interface MemLongTerm {
  id: string;
  contactId: string;
  content: string;
  /** 来源碎片数量 */
  fragmentCount: number;
  /** 来源碎片 id（详情/审计用） */
  sourceIds: string[];
  /** 来源 App 集合（互通关闭时召回过滤用） */
  apps: MemApp[];
  createdAt: number;
  editedAt?: number;
}

/** 每联系人记忆设置 */
export interface MemSettings {
  /** 对话总结频率：每隔多少轮对话自动提取一次记忆碎片 */
  interval: 10 | 20 | 30 | 40 | 50;
  /** 长期记忆总结频率：积累多少个（未消费的）记忆碎片后自动触发核心总结 */
  threshold: 3 | 5 | 7 | 10;
  /** 跨 App 互通记忆（默认开）：开=四端共享，关=各 App 只用自己来源的记忆 */
  share: boolean;
}

export const DEFAULT_MEM_SETTINGS: MemSettings = { interval: 20, threshold: 5, share: true };

export const MEM_INTERVAL_OPTIONS: MemSettings['interval'][] = [10, 20, 30, 40, 50];
export const MEM_THRESHOLD_OPTIONS: MemSettings['threshold'][] = [3, 5, 7, 10];

/** 对话轮次（供提取器使用的一问一答文本） */
export interface MemConvoTurn {
  role: 'me' | 'peer';
  text: string;
}

// ---------------- localStorage 基础 ----------------

const fragKey = (contactId: string) => `mem-frag:${contactId}`;
const ltmKey = (contactId: string) => `mem-ltm:${contactId}`;
const settingsKey = (contactId: string) => `mem-settings:${contactId}`;
const roundKey = (contactId: string, app: MemApp) => `mem-round:${contactId}:${app}`;

function readJSON<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存储满等异常：静默（记忆是增强能力，不因存储失败打断聊天）
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------- 设置 ----------------

export function getMemSettings(contactId: string): MemSettings {
  const raw = readJSON<Partial<MemSettings>>(settingsKey(contactId));
  if (!raw) return { ...DEFAULT_MEM_SETTINGS };
  return {
    interval: MEM_INTERVAL_OPTIONS.includes(raw.interval as MemSettings['interval'])
      ? (raw.interval as MemSettings['interval'])
      : DEFAULT_MEM_SETTINGS.interval,
    threshold: MEM_THRESHOLD_OPTIONS.includes(raw.threshold as MemSettings['threshold'])
      ? (raw.threshold as MemSettings['threshold'])
      : DEFAULT_MEM_SETTINGS.threshold,
    share: raw.share !== false,
  };
}

export function saveMemSettings(contactId: string, patch: Partial<MemSettings>): MemSettings {
  const next = { ...getMemSettings(contactId), ...patch };
  writeJSON(settingsKey(contactId), next);
  return next;
}

// ---------------- 读取（联系人维度） ----------------

function readFragments(contactId: string): MemFragment[] {
  const raw = readJSON<MemFragment[]>(fragKey(contactId));
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f) => f && typeof f.id === 'string' && typeof f.content === 'string' && typeof f.app === 'string'
  );
}

function readLongTerm(contactId: string): MemLongTerm[] {
  const raw = readJSON<MemLongTerm[]>(ltmKey(contactId));
  if (!Array.isArray(raw)) return [];
  return raw.filter((m) => m && typeof m.id === 'string' && typeof m.content === 'string');
}

/** 该联系人的全部记忆碎片（管理视图用：跨 App 汇总，按创建时间倒序） */
export function listFragments(contactId: string): MemFragment[] {
  return readFragments(contactId).sort((a, b) => b.createdAt - a.createdAt);
}

/** 该联系人的全部长期记忆（管理视图用） */
export function listLongTerm(contactId: string): MemLongTerm[] {
  return readLongTerm(contactId).sort((a, b) => b.createdAt - a.createdAt);
}

/** 未被长期总结消费的碎片数（设置页展示/总结提示用） */
export function pendingFragmentCount(contactId: string): number {
  return readFragments(contactId).filter((f) => !f.consumedAt).length;
}

// ---------------- 编辑/删除（查看=列表，编辑=改内容，删除=单条移除） ----------------

export function updateFragment(contactId: string, id: string, content: string): boolean {
  const list = readFragments(contactId);
  const hit = list.find((f) => f.id === id);
  if (!hit) return false;
  hit.content = content.trim();
  hit.editedAt = Date.now();
  writeJSON(fragKey(contactId), list);
  return true;
}

export function deleteFragment(contactId: string, id: string): boolean {
  const list = readFragments(contactId);
  const next = list.filter((f) => f.id !== id);
  if (next.length === list.length) return false;
  writeJSON(fragKey(contactId), next);
  return true;
}

export function updateLongTerm(contactId: string, id: string, content: string): boolean {
  const list = readLongTerm(contactId);
  const hit = list.find((m) => m.id === id);
  if (!hit) return false;
  hit.content = content.trim();
  hit.editedAt = Date.now();
  writeJSON(ltmKey(contactId), list);
  return true;
}

export function deleteLongTerm(contactId: string, id: string): boolean {
  const list = readLongTerm(contactId);
  const next = list.filter((m) => m.id !== id);
  if (next.length === list.length) return false;
  writeJSON(ltmKey(contactId), next);
  return true;
}

/** 删除联系人时级联清理其全部记忆（碎片/长期/设置/轮次计数） */
export function memPurgeContact(contactId: string): void {
  try {
    window.localStorage.removeItem(fragKey(contactId));
    window.localStorage.removeItem(ltmKey(contactId));
    window.localStorage.removeItem(settingsKey(contactId));
    (['wx', 'qq', 'sms', 'phone'] as MemApp[]).forEach((app) => window.localStorage.removeItem(roundKey(contactId, app)));
  } catch {
    // 忽略
  }
}

// ---------------- 召回（AI 带着记忆聊天） ----------------

/** 字符 2-gram 集合（中文友好轻量相关性） */
function bigrams(s: string): Set<string> {
  const t = s.replace(/\s+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  a.forEach((g) => {
    if (b.has(g)) n++;
  });
  return n;
}

/** 相关性打分：内容与当前上下文的重叠 + 新近加成（长期/碎片各自组内排序用） */
function relevanceScore(content: string, createdAt: number, context: string): number {
  const ctx = contextGramsCache.get(context) ?? bigrams(context);
  contextGramsCache.set(context, ctx);
  if (contextGramsCache.size > 8) contextGramsCache.delete(contextGramsCache.keys().next().value as string);
  let score = overlap(bigrams(content), ctx) * 2;
  const age = Date.now() - createdAt;
  if (age < 86400_000) score += 3;
  else if (age < 7 * 86400_000) score += 2;
  else if (age < 30 * 86400_000) score += 1;
  return score;
}

/** 上下文文本的 gram 缓存（同一次召回内复用） */
const contextGramsCache = new Map<string, Set<string>>();

/**
 * 召回该联系人（互通开关限定范围）的记忆，组装为注入 system 的文本块。
 * 排序规则：优先长期记忆，其次记忆碎片；组内按相关性（重叠+新近）降序。
 * 该联系人没有记忆 / 互通关闭且当前 App 无来源记忆 → 返回空串（正常聊天，不报错）。
 */
export function memRecallBlock(contactId: string, app: MemApp, contextText: string): string {
  if (!contactId) return '';
  const { share } = getMemSettings(contactId);
  const ltm = listLongTerm(contactId)
    .filter((m) => share || m.apps.includes(app))
    .map((m) => ({ m, s: relevanceScore(m.content, m.createdAt, contextText) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 4);
  const frags = listFragments(contactId)
    .filter((f) => !f.consumedAt && (share || f.app === app))
    .map((f) => ({ f, s: relevanceScore(f.content, f.sourceTime, contextText) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 6);
  if (ltm.length === 0 && frags.length === 0) return '';
  const lines: string[] = ['【关于对方的记忆（跨应用记忆库自动整理；聊天时自然运用，不要逐条复述或主动承认看过记忆）】'];
  if (ltm.length > 0) {
    lines.push('◇ 核心记忆（长期）：');
    ltm.forEach(({ m }, i) => lines.push(`${i + 1}. ${m.content}`));
  }
  if (frags.length > 0) {
    lines.push('◇ 近期记忆碎片：');
    frags.forEach(({ f }, i) => {
      const d = new Date(f.sourceTime);
      const md = `${d.getMonth() + 1}月${d.getDate()}日`;
      lines.push(`${i + 1}. （${md}·${MEM_APP_LABEL[f.app]}）${f.content}`);
    });
  }
  return lines.join('\n');
}

// ---------------- 轮次计数 + 自动提取 ----------------

/** 防并发：同一联系人同一 App 正在提取/总结时跳过新触发 */
const inflight = new Set<string>();

interface ExtractApiResult {
  fragments?: string[];
  error?: string;
}
interface SummarizeApiResult {
  summary?: string;
  error?: string;
}

async function callMemoryApi<T extends ExtractApiResult & SummarizeApiResult>(
  op: 'extract' | 'summarize',
  body: Record<string, unknown>,
  apiConfig: ApiConfig
): Promise<T> {
  const res = await fetch(`/api/memory/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, config: apiConfig }),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error(data?.error || `请求失败（${res.status}）`);
  return data;
}

/** 追加碎片（去重：同联系人同内容归一化后已存在则跳过）；返回实际新增条数 */
function appendFragments(contactId: string, app: MemApp, contents: string[], sourceTime: number): MemFragment[] {
  const list = readFragments(contactId);
  const seen = new Set(list.map((f) => f.content.replace(/\s+/g, '')));
  const now = Date.now();
  const added: MemFragment[] = [];
  for (const raw of contents) {
    const content = raw.trim();
    if (!content || seen.has(content.replace(/\s+/g, ''))) continue;
    seen.add(content.replace(/\s+/g, ''));
    added.push({ id: uid(), contactId, app, content, sourceTime, createdAt: now });
  }
  if (added.length > 0) writeJSON(fragKey(contactId), [...list, ...added]);
  return added;
}

/** 检查未消费碎片是否达到阈值；达到则自动触发核心总结（长期记忆） */
async function maybeAutoSummarize(contactId: string, apiConfig: ApiConfig): Promise<MemLongTerm | null> {
  const { threshold } = getMemSettings(contactId);
  const pending = readFragments(contactId).filter((f) => !f.consumedAt);
  if (pending.length < threshold) return null;
  const res = await callMemoryApi<SummarizeApiResult>(
    'summarize',
    {
      fragments: pending.map((f) => f.content),
    },
    apiConfig
  );
  const summary = (res.summary || '').trim();
  if (!summary) throw new Error('总结结果为空');
  const ltm: MemLongTerm = {
    id: uid(),
    contactId,
    content: summary,
    fragmentCount: pending.length,
    sourceIds: pending.map((f) => f.id),
    apps: Array.from(new Set(pending.map((f) => f.app))),
    createdAt: Date.now(),
  };
  const all = readLongTerm(contactId);
  writeJSON(ltmKey(contactId), [...all, ltm]);
  // 标记来源碎片已消费
  const consumedIds = new Set(ltm.sourceIds);
  writeJSON(
    fragKey(contactId),
    readFragments(contactId).map((f) => (consumedIds.has(f.id) ? { ...f, consumedAt: Date.now() } : f))
  );
  return ltm;
}

/**
 * 一轮 AI 对话结束后的记忆管线（各聊天 App 的 finalize 成功分支调用）：
 * 1) 轮次 +1；2) 达到提取间隔 → 从最近对话提取记忆碎片（后台异步，不阻塞聊天）；
 * 3) 碎片积累达到阈值 → 自动总结长期记忆。失败静默（console.warn），不打断聊天。
 * buildConvo 惰性调用：只有真的需要提取时才读取/整理对话文本。
 */
export function memAfterAiTurn(
  contactId: string | null,
  app: MemApp,
  apiConfig: ApiConfig,
  buildConvo: () => MemConvoTurn[]
): void {
  if (!contactId) return;
  try {
    const key = roundKey(contactId, app);
    const count = (readJSON<number>(key) ?? 0) + 1;
    const { interval } = getMemSettings(contactId);
    if (count < interval) {
      writeJSON(key, count);
      return;
    }
    // 达到间隔：归零计数并异步提取（失败不重置→不，归零在先避免每轮重试轰炸；下个窗口自然重试）
    writeJSON(key, 0);
    const guard = `${contactId}:${app}`;
    if (inflight.has(guard)) return;
    inflight.add(guard);
    void (async () => {
      try {
        const convo = buildConvo();
        if (convo.length >= 4) {
          const res = await callMemoryApi<ExtractApiResult>(
            'extract',
            { conversation: convo, app },
            apiConfig
          );
          const contents = Array.isArray(res.fragments) ? res.fragments.filter((x) => typeof x === 'string') : [];
          appendFragments(contactId, app, contents, Date.now());
        }
        await maybeAutoSummarize(contactId, apiConfig);
      } catch (err) {
        console.warn('[memory] 自动提取失败（下个窗口重试）', err);
      } finally {
        inflight.delete(guard);
      }
    })();
  } catch {
    // 记忆是增强能力：任何异常都不影响聊天
  }
}

// ---------------- 手动「立即总结」 ----------------

export interface ManualSummarizeResult {
  fragments: number;
  longTerm: number;
}

/** 手动总结（设置页「立即总结」）：不等 N 轮，立刻整理当前对话并入库（碎片 + 可能触发的长期记忆） */
export async function memSummarizeNow(
  contactId: string,
  app: MemApp,
  apiConfig: ApiConfig,
  convo: MemConvoTurn[]
): Promise<ManualSummarizeResult> {
  const guard = `${contactId}:manual`;
  if (inflight.has(guard)) throw new Error('正在总结中，请稍候');
  inflight.add(guard);
  try {
    if (convo.length < 2) throw new Error('当前没有足够的对话内容可总结');
    const res = await callMemoryApi<ExtractApiResult>('extract', { conversation: convo, app }, apiConfig);
    const contents = Array.isArray(res.fragments) ? res.fragments.filter((x) => typeof x === 'string') : [];
    if (contents.length === 0) throw new Error('这次对话没有提炼出新的记忆');
    const added = appendFragments(contactId, app, contents, Date.now());
    if (added.length === 0) throw new Error('提炼出的记忆都已存在，没有新增');
    let ltmCreated = 0;
    const { threshold } = getMemSettings(contactId);
    if (pendingFragmentCount(contactId) >= threshold) {
      const ltm = await maybeAutoSummarize(contactId, apiConfig).catch(() => null);
      ltmCreated = ltm ? 1 : 0;
    }
    return { fragments: added.length, longTerm: ltmCreated };
  } finally {
    inflight.delete(guard);
  }
}

// ---------------- 对话文本整理（从各 App 的原始消息数组提取问答对） ----------------

/** 通用消息形状（各 App 消息的字段子集；卡片类映射为短标签，保证提取器可读） */
interface RawishMsg {
  role?: unknown;
  content?: unknown;
  kind?: unknown;
  text?: unknown;
  recalled?: unknown;
  error?: unknown;
}

function cardLabel(kind: unknown): string | null {
  if (kind === 'redpacket') return '[红包]';
  if (kind === 'transfer') return '[转账]';
  if (kind === 'family') return '[亲属卡]';
  if (kind === 'image') return '[图片]';
  if (kind === 'sticker') return '[表情]';
  if (kind === 'location') return '[位置]';
  return null;
}

/** 把任意 App 的消息数组整理成 {role, text} 问答对（撤回/失败/空消息剔除） */
export function memConvoFromRaw(msgs: unknown[], peerName: string): MemConvoTurn[] {
  const out: MemConvoTurn[] = [];
  for (const raw of msgs) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as RawishMsg;
    if (m.recalled === true || m.error === true) continue;
    const label = cardLabel(m.kind);
    const text =
      label ??
      ((typeof m.content === 'string' ? m.content.trim() : '') ||
        (typeof m.text === 'string' ? m.text.trim() : ''));
    if (!text) continue;
    const isMe = m.role === 'me' || m.role === 'user';
    out.push({ role: isMe ? 'me' : 'peer', text: text.slice(0, 400) });
  }
  void peerName;
  return out.slice(-60);
}

/** 读取某个联系人在指定 App 的最近对话（手动「立即总结」用；电话通话不留全文，返回空） */
export function memRecentConvo(contactId: string, app: MemApp): MemConvoTurn[] {
  try {
    if (app === 'phone') return [];
    const raw =
      app === 'wx'
        ? window.localStorage.getItem(`wx-chat-msgs:${contactId}`)
        : app === 'qq'
          ? window.localStorage.getItem(`qq-chat-msgs:${contactId}`)
          : window.localStorage.getItem(`ios-chat-msgs:c:${contactId}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return memConvoFromRaw(parsed, '');
  } catch {
    return [];
  }
}

/** 手动总结用：挑该联系人最近有对话的 App（wx/qq/sms 中最后一条消息时间最新者） */
export function memMostRecentApp(contactId: string): { app: MemApp; convo: MemConvoTurn[] } | null {
  let best: { app: MemApp; ts: number; convo: MemConvoTurn[] } | null = null;
  for (const app of ['wx', 'qq', 'sms'] as MemApp[]) {
    const key =
      app === 'wx'
        ? `wx-chat-msgs:${contactId}`
        : app === 'qq'
          ? `qq-chat-msgs:${contactId}`
          : `ios-chat-msgs:c:${contactId}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) continue;
      const last = parsed[parsed.length - 1] as { time?: unknown } | null;
      const ts = typeof last?.time === 'number' ? last.time : 0;
      if (!best || ts > best.ts) best = { app, ts, convo: memConvoFromRaw(parsed, '') };
    } catch {
      continue;
    }
  }
  return best ? { app: best.app, convo: best.convo } : null;
}
