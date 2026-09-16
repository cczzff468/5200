'use client';

/**
 * 记忆库（跨 App 共享记忆）：记忆碎片 / 长期记忆 / 每联系人设置。
 *
 * 设计要点（「记忆库 APP」需求）：
 * - 数据全部按【联系人 ID】隔离，localStorage 持久化（与聊天记录同层，重启保留）：
 *   · mem-frag:<contactId>   记忆碎片（每条带来源 App/时间/消息 ID/权重/加强时间）
 *   · mem-ltm:<contactId>    长期记忆（核心记忆，带来源碎片数量/来源 App 集合）
 *   · mem-settings:<contactId> 每联系人设置（提取频率/总结阈值/互通开关/失忆程度）
 *   · mem-round:<contactId>:<app>  各 App 会话的对话轮次计数（提取节奏用）
 * - 互通开关（默认开）：开 = 四个 App（QQ/微信/信息/电话）共享该联系人全部记忆；
 *   关 = 各 App 只召回自己来源的记忆（碎片按 app 标记过滤、长期记忆按来源 App 集合过滤）。
 *   存储始终单一池 + App 标记：切换开关无需迁移数据，UI 管理视图始终展示该联系人全部记忆。
 * - 不同联系人之间永远隔离：键即隔离边界，召回/提取都不跨联系人读取。
 * - 【过期淡化】失忆程度（快≈3天/中≈2周/慢≈2个月/从不）：超过有效期一半「淡化中」召回降权，
 *   超过有效期「已归档」不再参与召回与总结；低权重记忆先淡化、高权重更持久；
 *   重复提及/合并相似/手动「回忆一下」都会刷新淡化计时。
 * - 【去重合并】同一事实的不同说法（相似度 ≥0.6）自动合并为一条：重复提取=加强而非重复占位；
 *   设置页可手动「整理重复记忆」一次性清理。
 * - 【权重优先级】姓名/关系/承诺/健康禁忌 → 高权重（自动分类 + 手动可调）；召回按权重×相关性排序。
 * - 【来源追溯】每条碎片记录来源 App / 来源时间 / 来源消息 ID，回答「你怎么知道的」。
 * - 提取/总结调用 /api/memory/extract 与 /api/memory/summarize（用户 API 配置优先，
 *   服务端 SDK 兜底）；自动提取失败静默（下一窗口重试），手动「立即总结」失败给提示。
 * - 删除联系人时由 contacts-store.deleteContact 调 memPurgeContact 级联清理全部记忆。
 */

import type { ApiConfig } from '@/lib/ios/store';
import {
  DEFAULT_MEM_SETTINGS,
  MEM_APP_LABEL,
  MEM_INTERVAL_OPTIONS,
  MEM_THRESHOLD_OPTIONS,
  SIMILAR_MERGE_THRESHOLD,
  autoWeight,
  bigrams,
  fadeState,
  higherWeight,
  normalizeWeight,
  similarity,
  weightFactor,
  type FadeInput,
  type MemApp,
  type MemConvoTurn,
  type MemForget,
  type MemFragment,
  type MemLongTerm,
  type MemSettings,
  type MemWeight,
} from './memory-core';

// 类型与纯逻辑全部来自 memory-core（此处转出，保持既有 import 路径兼容）
export {
  DEFAULT_MEM_SETTINGS,
  MEM_APP_LABEL,
  MEM_FORGET_DAYS,
  MEM_FORGET_LABEL,
  MEM_FORGET_OPTIONS,
  MEM_INTERVAL_OPTIONS,
  MEM_THRESHOLD_OPTIONS,
  SIMILAR_MERGE_THRESHOLD,
  autoWeight,
  bigrams,
  fadeState,
  higherWeight,
  normalizeWeight,
  similarity,
  weightFactor,
  type FadeInput,
  type FadeState,
  type MemApp,
  type MemConvoTurn,
  type MemForget,
  type MemFragment,
  type MemLongTerm,
  type MemSettings,
  type MemWeight,
} from './memory-core';

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
    forget: raw.forget === 'fast' || raw.forget === 'medium' || raw.forget === 'slow' || raw.forget === 'never'
      ? raw.forget
      : DEFAULT_MEM_SETTINGS.forget,
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

/** 未被长期总结消费、且未归档的碎片数（设置页展示/总结触发判断用） */
export function pendingFragmentCount(contactId: string): number {
  const { forget } = getMemSettings(contactId);
  const now = Date.now();
  return readFragments(contactId).filter(
    (f) => !f.consumedAt && fadeState(f as FadeInput, forget, now) !== 'faded'
  ).length;
}

/** 已归档（完全失效）的碎片数（数据说明展示用） */
export function archivedFragmentCount(contactId: string): number {
  const { forget } = getMemSettings(contactId);
  const now = Date.now();
  return readFragments(contactId).filter((f) => fadeState(f as FadeInput, forget, now) === 'faded').length;
}

// ---------------- 编辑/删除/回忆（查看=列表，编辑=改内容与权重，删除=单条移除） ----------------

export function updateFragment(contactId: string, id: string, content: string, weight?: MemWeight): boolean {
  const list = readFragments(contactId);
  const hit = list.find((f) => f.id === id);
  if (!hit) return false;
  hit.content = content.trim();
  hit.editedAt = Date.now();
  if (weight === 'high' || weight === 'normal' || weight === 'low') hit.weight = weight;
  writeJSON(fragKey(contactId), list);
  return true;
}

/** 「回忆一下」：手动救回淡化/归档的记忆（重置淡化计时，标记一次加强） */
export function reinforceFragment(contactId: string, id: string): boolean {
  const list = readFragments(contactId);
  const hit = list.find((f) => f.id === id);
  if (!hit) return false;
  hit.reinforcedAt = Date.now();
  hit.reinforceCount = (hit.reinforceCount ?? 0) + 1;
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

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  a.forEach((g) => {
    if (b.has(g)) n++;
  });
  return n;
}

/** 上下文文本的 gram 缓存（同一次召回内复用） */
const contextGramsCache = new Map<string, Set<string>>();

/** 碎片召回得分：相关性 × 权重系数（高权重优先）× 淡化系数（淡化中 0.4；已归档直接不参与） */
function fragRecallScore(f: MemFragment, forget: MemForget, context: string, now: number): { s: number; st: ReturnType<typeof fadeState> } {
  const st = fadeState(f as FadeInput, forget, now);
  const s =
    relevanceScore(f.content, f.reinforcedAt ?? f.sourceTime, context) *
    weightFactor(f.weight) *
    (st === 'fading' ? 0.4 : 1);
  return { s, st };
}

/**
 * 召回该联系人（互通开关限定范围）的记忆，组装为注入 system 的文本块。
 * 排序规则：优先长期记忆，其次记忆碎片；组内按 权重×相关性×淡化 降序；
 * 已归档（过期失效）的碎片不召回，淡化中的降权。
 * 该联系人没有记忆 / 互通关闭且当前 App 无来源记忆 → 返回空串（正常聊天，不报错）。
 */
export function memRecallBlock(contactId: string, app: MemApp, contextText: string): string {
  if (!contactId) return '';
  const { share, forget } = getMemSettings(contactId);
  const now = Date.now();
  const ltm = listLongTerm(contactId)
    .filter((m) => share || m.apps.includes(app))
    .map((m) => ({ m, s: relevanceScore(m.content, m.createdAt, contextText) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 4);
  const frags = listFragments(contactId)
    .filter((f) => !f.consumedAt && (share || f.app === app))
    .map((f) => ({ f, ...fragRecallScore(f, forget, contextText, now) }))
    .filter((x) => x.st !== 'faded')
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

/** 召回预览（设置页）：与 memRecallBlock 同一套 权重×相关性×淡化 排序，返回排序后的记忆对象 */
export function memRecallPreview(contactId: string): { ltm: MemLongTerm[]; frags: MemFragment[] } {
  const { forget } = getMemSettings(contactId);
  const now = Date.now();
  const ltm = listLongTerm(contactId)
    .map((m) => ({ m, s: relevanceScore(m.content, m.createdAt, '') }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.m);
  const frags = listFragments(contactId)
    .filter((f) => !f.consumedAt)
    .map((f) => ({ f, ...fragRecallScore(f, forget, '', now) }))
    .filter((x) => x.st !== 'faded')
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => x.f);
  return { ltm, frags };
}

// ---------------- 轮次计数 + 自动提取 ----------------

/** 防并发：同一联系人同一 App 正在提取/总结时跳过新触发 */
const inflight = new Set<string>();

/** extract 接口返回的单条碎片：文本 + 可选权重（LLM 判定，缺失时客户端自动分类兜底） */
interface ExtractItem {
  text: string;
  weight?: MemWeight;
}

interface ExtractApiResult {
  fragments?: (string | { text?: unknown; weight?: unknown })[];
  error?: string;
}
interface SummarizeApiResult {
  summary?: string;
  error?: string;
}

/** 把 extract 接口返回的碎片归一化（字符串/对象混合兼容 + 非法值兜底自动分类） */
function normalizeExtract(res: ExtractApiResult): ExtractItem[] {
  const raw = Array.isArray(res.fragments) ? res.fragments : [];
  const out: ExtractItem[] = [];
  for (const x of raw) {
    if (typeof x === 'string') {
      const t = x.trim();
      if (t) out.push({ text: t, weight: autoWeight(t) });
    } else if (x && typeof x === 'object' && typeof x.text === 'string' && x.text.trim()) {
      out.push({ text: x.text.trim(), weight: normalizeWeight(x.weight, x.text) });
    }
  }
  return out.slice(0, 6);
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

/** 归一化文本（去空白）——精确去重键 */
const normText = (s: string) => s.replace(/\s+/g, '');

/**
 * 追加碎片（三层去重）：
 * 1) 精确重复 → 记一次「加强」（reinforcedAt/次数刷新），不新增；
 * 2) 相似（2-gram ≥0.6，同一事实的不同说法）→ 合并进已有条目：内容取更完整的、权重取更高、
 *    加强计时刷新、计数 +1，不新增占位；
 * 3) 全新 → 新建（权重：LLM 判定优先，缺省按关键词自动分类）。
 * 返回 { added: 新增条目; merged: 合并/加强次数 }
 */
function appendFragments(
  contactId: string,
  app: MemApp,
  items: ExtractItem[],
  sourceTime: number,
  sourceMsgId?: string
): { added: MemFragment[]; merged: number } {
  const list = readFragments(contactId);
  const now = Date.now();
  const seen = new Set(list.map((f) => normText(f.content)));
  const added: MemFragment[] = [];
  let merged = 0;
  for (const item of items) {
    const content = item.text.trim();
    if (!content) continue;
    const key = normText(content);
    // 1) 精确重复 → 加强已有记忆
    if (seen.has(key)) {
      const hit = list.find((f) => normText(f.content) === key);
      if (hit) {
        hit.reinforcedAt = now;
        hit.reinforceCount = (hit.reinforceCount ?? 0) + 1;
        hit.weight = higherWeight(hit.weight, item.weight);
        merged++;
      }
      continue;
    }
    // 2) 相似说法 → 合并进已有记忆（优先未消费的；内容保留更完整的一条）
    const simHit = list
      .filter((f) => f.content.length >= 4 && content.length >= 4)
      .sort((a, b) => Number(Boolean(a.consumedAt)) - Number(Boolean(b.consumedAt)) || a.createdAt - b.createdAt)
      .find((f) => similarity(f.content, content) >= SIMILAR_MERGE_THRESHOLD);
    if (simHit) {
      if (content.length > simHit.content.length) simHit.content = content;
      simHit.reinforcedAt = now;
      simHit.reinforceCount = (simHit.reinforceCount ?? 0) + 1;
      simHit.weight = higherWeight(simHit.weight, item.weight);
      if (!simHit.sourceMsgId && sourceMsgId) simHit.sourceMsgId = sourceMsgId;
      seen.add(normText(simHit.content));
      merged++;
      continue;
    }
    // 3) 全新记忆
    seen.add(key);
    added.push({
      id: uid(),
      contactId,
      app,
      content,
      sourceTime,
      createdAt: now,
      weight: item.weight ?? autoWeight(content),
      reinforcedAt: now,
      reinforceCount: 0,
      sourceMsgId,
    });
  }
  if (added.length > 0 || merged > 0) writeJSON(fragKey(contactId), [...list, ...added]);
  return { added, merged };
}

/** 检查未消费且未归档的碎片是否达到阈值；达到则自动触发核心总结（长期记忆） */
async function maybeAutoSummarize(contactId: string, apiConfig: ApiConfig): Promise<MemLongTerm | null> {
  const { threshold, forget } = getMemSettings(contactId);
  const now = Date.now();
  const pending = readFragments(contactId).filter(
    (f) => !f.consumedAt && fadeState(f as FadeInput, forget, now) !== 'faded'
  );
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
 * getSourceMsgId 惰性调用：提取时取来源消息 ID（追溯用，可省略）。
 */
export function memAfterAiTurn(
  contactId: string | null,
  app: MemApp,
  apiConfig: ApiConfig,
  buildConvo: () => MemConvoTurn[],
  getSourceMsgId?: () => string | undefined
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
          const items = normalizeExtract(res);
          if (items.length > 0) appendFragments(contactId, app, items, Date.now(), getSourceMsgId?.());
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
  /** 相似记忆被合并/加强的次数 */
  merged: number;
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
    const items = normalizeExtract(res);
    if (items.length === 0) throw new Error('这次对话没有提炼出新的记忆');
    const { added, merged } = appendFragments(contactId, app, items, Date.now());
    if (added.length === 0 && merged === 0) throw new Error('提炼出的记忆都已存在，没有新增');
    let ltmCreated = 0;
    if (pendingFragmentCount(contactId) >= getMemSettings(contactId).threshold) {
      const ltm = await maybeAutoSummarize(contactId, apiConfig).catch(() => null);
      ltmCreated = ltm ? 1 : 0;
    }
    return { fragments: added.length, longTerm: ltmCreated, merged };
  } finally {
    inflight.delete(guard);
  }
}

// ---------------- 手动「整理重复记忆」 ----------------

/**
 * 全库去重整理（设置页按钮）：两两扫描该联系人全部碎片，相似（≥0.6）的合并为一条。
 * 保留更早创建的为正本（若另一条已入核心则保留已入核心者），内容取更完整的、
 * 权重取更高、加强次数累加、加强时间取较新。返回合并掉的条数。
 */
export function memDedupeNow(contactId: string): number {
  let list = readFragments(contactId);
  const before = list.length;
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!a.content || !b.content || a.content.length < 4 || b.content.length < 4) continue;
        if (similarity(a.content, b.content) < SIMILAR_MERGE_THRESHOLD) continue;
        // 正本：已入核心者优先，其次更早创建者
        const keep = Number(Boolean(a.consumedAt)) - Number(Boolean(b.consumedAt)) !== 0
          ? (a.consumedAt ? a : b)
          : (a.createdAt <= b.createdAt ? a : b);
        const drop = keep === a ? b : a;
        if (drop.content.length > keep.content.length) keep.content = drop.content;
        keep.weight = higherWeight(keep.weight, drop.weight);
        keep.reinforceCount = (keep.reinforceCount ?? 0) + 1 + (drop.reinforceCount ?? 0);
        keep.reinforcedAt = Math.max(keep.reinforcedAt ?? 0, drop.reinforcedAt ?? 0);
        keep.sourceMsgId = keep.sourceMsgId ?? drop.sourceMsgId;
        keep.consumedAt = keep.consumedAt ?? drop.consumedAt;
        list = list.filter((f) => f.id !== drop.id);
        changed = true;
        break outer;
      }
    }
  }
  if (list.length !== before) writeJSON(fragKey(contactId), list);
  return before - list.length;
}

// ---------------- 来源追溯 ----------------

/** 从原始消息数组取最后一条有效消息的 id（来源追溯用；拿不到返回 undefined） */
export function memLastMsgId(msgs: unknown[]): string | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i] as { id?: unknown; recalled?: unknown; error?: unknown } | null;
    if (!m || typeof m !== 'object') continue;
    if (m.recalled === true || m.error === true) continue;
    if (typeof m.id === 'string' && m.id) return m.id;
    if (typeof m.id === 'number') return String(m.id);
  }
  return undefined;
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
