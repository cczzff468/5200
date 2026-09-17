'use client';

/**
 * 记忆库（跨 App 共享记忆）：记忆碎片 / 核心记忆 / 长期记忆 / 每联系人设置。
 *
 * 设计要点（「记忆库 APP」需求）：
 * - 数据全部按【联系人 ID】隔离，localStorage 持久化（与聊天记录同层，重启保留）：
 *   · mem-frag:<contactId>   记忆碎片（每条带来源 App/时间/消息 ID/权重/加强时间）
 *   · mem-ltm:<contactId>    核心记忆（M 条碎片总结；键名沿用历史 ltm，语义=核心层）
 *   · mem-long:<contactId>   长期记忆（K 条核心记忆总结出的最稳定画像，层级顶层）
 *   · mem-settings:<contactId> 每联系人设置（提取频率/核心阈值/长期阈值/互通开关/失忆程度）
 *   · mem-round:<contactId>:<app>  各 App 会话的对话轮次计数（提取节奏用）
 * - 三层管线：碎片（每 N 轮提取）→ 核心记忆（积累 M 条碎片总结一条）→ 长期记忆（积累 K 条
 *   未归档核心总结一条，默认 K=5）；核心被长期收编后标记 archivedAt（方案A：不再参与后续
 *   总结与召回，由长期记忆代表，避免重复总结/重复注入）。
 * - 互通开关（默认开）：开 = 四个 App（QQ/微信/信息/电话）共享该联系人全部记忆；
 *   关 = 各 App 只召回自己来源的记忆（碎片/核心/长期均按来源 App 过滤）。
 *   存储始终单一池 + App 标记：切换开关无需迁移数据，UI 管理视图始终展示该联系人全部记忆。
 * - 不同联系人之间永远隔离：键即隔离边界，召回/提取都不跨联系人读取。
 * - 【视角统一】提取/总结 prompt 一律用「用户真实名字 + 角色名字」指代双方，禁混用
 *   「对方/用户/我」；memRepairPerspectiveNow 可把旧版「对方/用户」代称修复为真实名字。
 * - 【过期淡化】失忆程度（快≈3天/中≈2周/慢≈2个月/从不）：超过有效期一半「淡化中」召回降权，
 *   超过有效期「已归档」不再参与召回与总结；低权重记忆先淡化、高权重更持久；
 *   重复提及/合并相似/手动「回忆一下」都会刷新淡化计时。
 * - 【去重合并】同一事实的不同说法（相似度 ≥0.6）自动合并为一条：重复提取=加强而非重复占位；
 *   设置页可手动「整理重复记忆」一次性清理；召回时跨层去重（长期→核心→碎片顺序，后层与已选
 *   内容相似则跳过）。
 * - 【权重优先级】姓名/关系/承诺/健康禁忌 → 高权重（自动分类 + 手动可调）；召回按权重×相关性排序。
 * - 【时间感知】记忆与当前时间联动：碎片可带 eventTime（事件发生时间）/ expiresAt（过期时间，
 *   空=永不过期）；提取时由模型按当前时间锚点判断（服务端校验 ±5 年防幻觉）；注入时头部带当前
 *   时间、层内按有效时间从新到旧、每条带时间标签，并提示优先参考更近的记忆；过期碎片自动归档
 *   （expiredAt）不再召回；新旧矛盾时模型标注 supersedes，旧记忆标记「已更新」不再召回。
 *   核心/长期默认永不过期，可被用户手动设置过期；用户手动编辑过的时间（timeEditedAt）以用户
 *   设置为准，自动流程（提取合并/去重/总结）一律不得覆盖。
 * - 【来源追溯】每条碎片记录来源 App / 来源时间 / 来源消息 ID，回答「你怎么知道的」。
 * - 提取/总结调用 /api/memory/extract 与 /api/memory/summarize（用户 API 配置优先，
 *   服务端 SDK 兜底）；自动提取失败静默（下一窗口重试），手动「立即总结」失败给提示；
 *   手动入口共四个且互斥：碎片页右上角（仅提取碎片）、核心页右上角（碎片→核心）、
 *   长期页右上角（核心→长期）、设置页（按所选粒度执行）。
 * - 删除联系人时由 contacts-store.deleteContact 调 memPurgeContact 级联清理全部记忆。
 */

import type { ApiConfig } from '@/lib/ios/store';
import { kvGet, kvSet, kvDel } from '@/lib/ios/idb-kv';
import {
  DEFAULT_MEM_SETTINGS,
  MEM_APP_LABEL,
  MEM_INTERVAL_OPTIONS,
  MEM_LONG_OPTIONS,
  MEM_STALE_PAT,
  MEM_THRESHOLD_OPTIONS,
  MEM_TIME_RANGE_YEARS,
  SIMILAR_MERGE_THRESHOLD,
  autoWeight,
  bigrams,
  fadeState,
  higherWeight,
  isMemExpired,
  memEffectiveTime,
  memNowLabel,
  memTimeLabel,
  normalizeWeight,
  similarity,
  weightFactor,
  type FadeInput,
  type MemApp,
  type MemConvoTurn,
  type MemCore,
  type MemForget,
  type MemFragment,
  type MemLongTerm,
  type MemNames,
  type MemSettings,
  type MemWeight,
} from './memory-core';

export {
  DEFAULT_MEM_SETTINGS,
  MEM_APP_LABEL,
  MEM_FORGET_DAYS,
  MEM_FORGET_LABEL,
  MEM_FORGET_OPTIONS,
  MEM_INTERVAL_OPTIONS,
  MEM_LONG_OPTIONS,
  MEM_THRESHOLD_OPTIONS,
  MEM_TIME_RANGE_YEARS,
  SIMILAR_MERGE_THRESHOLD,
  autoWeight,
  bigrams,
  fadeState,
  higherWeight,
  isMemExpired,
  memEffectiveTime,
  memNowLabel,
  memTimeLabel,
  normalizeWeight,
  similarity,
  weightFactor,
  type FadeInput,
  type FadeState,
  type MemApp,
  type MemConvoTurn,
  type MemCore,
  type MemForget,
  type MemFragment,
  type MemLongTerm,
  type MemNames,
  type MemSettings,
  type MemWeight,
} from './memory-core';

// ---------------- 持久化基础（IndexedDB kv store，启动时由 idb-kv 从 localStorage 迁移） ----------------

const fragKey = (contactId: string) => `mem-frag:${contactId}`;
/** 核心记忆存储键（沿用历史 ltm 键名，语义为核心层，避免旧数据迁移） */
const coreKey = (contactId: string) => `mem-ltm:${contactId}`;
const longKey = (contactId: string) => `mem-long:${contactId}`;
const settingsKey = (contactId: string) => `mem-settings:${contactId}`;
const roundKey = (contactId: string, app: MemApp) => `mem-round:${contactId}:${app}`;

function readJSON<T>(key: string): T | null {
  try {
    return kvGet<T>(key);
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    // 内存同步 + 异步写穿 IndexedDB；存储失败不中断聊天（记忆是增强能力）
    kvSet(key, value);
  } catch {
    // 忽略
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 名字归一化：提取/总结请求统一携带，缺省回退固定称呼（同一联系人恒定，保证视角一致） */
function namesOf(names?: MemNames | null): { userName: string; peerName: string } {
  return {
    userName: (names?.user ?? '').trim().slice(0, 20) || '用户',
    peerName: (names?.peer ?? '').trim().slice(0, 20) || '对方',
  };
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
    longThreshold: MEM_LONG_OPTIONS.includes(raw.longThreshold as MemSettings['longThreshold'])
      ? (raw.longThreshold as MemSettings['longThreshold'])
      : DEFAULT_MEM_SETTINGS.longThreshold,
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

function readCores(contactId: string): MemCore[] {
  const raw = readJSON<MemCore[]>(coreKey(contactId));
  if (!Array.isArray(raw)) return [];
  return raw.filter((m) => m && typeof m.id === 'string' && typeof m.content === 'string');
}

function readLongTerm(contactId: string): MemLongTerm[] {
  const raw = readJSON<MemLongTerm[]>(longKey(contactId));
  if (!Array.isArray(raw)) return [];
  return raw.filter((m) => m && typeof m.id === 'string' && typeof m.content === 'string');
}

/** 该联系人的全部记忆碎片（管理视图用：跨 App 汇总，按创建时间倒序） */
export function listFragments(contactId: string): MemFragment[] {
  return readFragments(contactId).sort((a, b) => b.createdAt - a.createdAt);
}

/** 该联系人的全部核心记忆（管理视图用，含已入长期的归档项） */
export function listCores(contactId: string): MemCore[] {
  return readCores(contactId).sort((a, b) => b.createdAt - a.createdAt);
}

/** 该联系人的全部长期记忆（管理视图用） */
export function listLongTerm(contactId: string): MemLongTerm[] {
  return readLongTerm(contactId).sort((a, b) => b.createdAt - a.createdAt);
}

/** 未被核心总结消费、且未被更新/过期/归档的碎片数（设置页展示/总结触发判断用） */
export function pendingFragmentCount(contactId: string): number {
  const { forget } = getMemSettings(contactId);
  const now = Date.now();
  return readFragments(contactId).filter(
    (f) =>
      !f.consumedAt &&
      !f.supersededAt &&
      !isMemExpired(f, now) &&
      fadeState(f as FadeInput, forget, now) !== 'faded'
  ).length;
}

/** 已归档（淡化到期，完全失效）的碎片数（数据说明展示用） */
export function archivedFragmentCount(contactId: string): number {
  const { forget } = getMemSettings(contactId);
  const now = Date.now();
  return readFragments(contactId).filter(
    (f) => !f.supersededAt && !isMemExpired(f, now) && fadeState(f as FadeInput, forget, now) === 'faded'
  ).length;
}

/** 已过期（时间感知到期自动归档）的碎片数（数据说明展示用） */
export function expiredFragmentCount(contactId: string): number {
  const now = Date.now();
  return readFragments(contactId).filter((f) => !f.supersededAt && isMemExpired(f, now)).length;
}

/** 已更新（被矛盾新记忆替代，不再召回）的碎片数（数据说明展示用） */
export function supersededFragmentCount(contactId: string): number {
  return readFragments(contactId).filter((f) => f.supersededAt != null).length;
}

/**
 * 时间感知过期清扫：把 expiresAt 已到期的碎片标记 expiredAt（自动归档）。
 * 惰性执行：召回（memRecallBlock）、一轮对话结束（memAfterAiTurn）、记忆库刷新时调用；
 * 召回/总结的过滤都按 isMemExpired 实时判断，本清扫只负责落库标记与 UI 展示。
 * 返回本次标记的条数。
 */
export function memSweepExpiry(contactId: string): number {
  const now = Date.now();
  const list = readFragments(contactId);
  let changed = 0;
  const next = list.map((f) => {
    if (f.expiresAt != null && now > f.expiresAt && !f.expiredAt && !f.supersededAt) {
      changed++;
      return { ...f, expiredAt: now };
    }
    return f;
  });
  if (changed > 0) writeJSON(fragKey(contactId), next);
  return changed;
}

/**
 * 矛盾更新对比用：当前待总结（未消费/未更新/未过期/未淡化）碎片的 id+内容，最近 30 条。
 * 随提取请求发给模型，让它判断新信息是否与已有记忆矛盾（supersedes 只接受这些 id）。
 */
function existingForConflict(contactId: string): { id: string; content: string }[] {
  const { forget } = getMemSettings(contactId);
  const now = Date.now();
  return readFragments(contactId)
    .filter(
      (f) =>
        !f.consumedAt &&
        !f.supersededAt &&
        !isMemExpired(f, now) &&
        fadeState(f as FadeInput, forget, now) !== 'faded'
    )
    .slice(-30)
    .map((f) => ({ id: f.id, content: f.content }));
}

/** 未被长期记忆收编且未过期的核心记忆数（长期总结触发判断用；手动设过期的核心不再参与总结） */
export function pendingCoreCount(contactId: string): number {
  const now = Date.now();
  return readCores(contactId).filter((m) => !m.archivedAt && !isMemExpired(m, now)).length;
}

// ---------------- 编辑/删除/回忆（查看=列表，编辑=改内容与权重，删除=单条移除） ----------------

/**
 * 手动时间编辑入参（时间感知：用户在记忆库手动修改事件/过期时间）：
 * - eventTime/expiresAt 传 null 表示清除（事件时间清空 / 恢复永不过期），传时间戳表示设置；
 * - undefined 表示不改动该字段。
 */
export interface MemTimePatch {
  eventTime?: number | null;
  expiresAt?: number | null;
}

/**
 * 三层通用：应用手动时间补丁。被手动编辑过的记忆会带上 timeEditedAt 标记，
 * 此后自动流程（提取合并/去重/总结）一律以用户设置为准，不得改写其 eventTime/expiresAt。
 */
function applyTimePatch<
  T extends { eventTime?: number; expiresAt?: number; expiredAt?: number; timeEditedAt?: number; editedAt?: number }
>(rec: T, patch: MemTimePatch, now: number): T {
  const next = { ...rec };
  if (patch.eventTime !== undefined) {
    if (patch.eventTime == null) delete next.eventTime;
    else if (Number.isFinite(patch.eventTime)) next.eventTime = patch.eventTime;
  }
  if (patch.expiresAt !== undefined) {
    if (patch.expiresAt == null) delete next.expiresAt;
    else if (Number.isFinite(patch.expiresAt)) next.expiresAt = patch.expiresAt;
  }
  next.timeEditedAt = now;
  next.editedAt = now;
  // 手动把过期时间改到未来或清除 → 救回已过期归档的碎片（用户意图明确：重新有效）
  if (next.expiresAt == null || next.expiresAt > now) delete next.expiredAt;
  return next;
}

/** 手动修改碎片的事件/过期时间（设置 timeEditedAt，自动流程不再覆盖） */
export function updateFragmentTime(contactId: string, id: string, patch: MemTimePatch): boolean {
  const list = readFragments(contactId);
  const idx = list.findIndex((f) => f.id === id);
  if (idx < 0) return false;
  list[idx] = applyTimePatch(list[idx], patch, Date.now());
  writeJSON(fragKey(contactId), list);
  return true;
}

/** 手动修改核心记忆的事件/过期时间（默认永不过期，设置后同样受保护） */
export function updateCoreTime(contactId: string, id: string, patch: MemTimePatch): boolean {
  const list = readCores(contactId);
  const idx = list.findIndex((m) => m.id === id);
  if (idx < 0) return false;
  list[idx] = applyTimePatch(list[idx], patch, Date.now());
  writeJSON(coreKey(contactId), list);
  return true;
}

/** 手动修改长期记忆的事件/过期时间（默认永不过期，设置后同样受保护） */
export function updateLongTermTime(contactId: string, id: string, patch: MemTimePatch): boolean {
  const list = readLongTerm(contactId);
  const idx = list.findIndex((m) => m.id === id);
  if (idx < 0) return false;
  list[idx] = applyTimePatch(list[idx], patch, Date.now());
  writeJSON(longKey(contactId), list);
  return true;
}

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

export function updateCore(contactId: string, id: string, content: string): boolean {
  const list = readCores(contactId);
  const hit = list.find((m) => m.id === id);
  if (!hit) return false;
  hit.content = content.trim();
  hit.editedAt = Date.now();
  writeJSON(coreKey(contactId), list);
  return true;
}

export function deleteCore(contactId: string, id: string): boolean {
  const list = readCores(contactId);
  const next = list.filter((m) => m.id !== id);
  if (next.length === list.length) return false;
  writeJSON(coreKey(contactId), next);
  return true;
}

export function updateLongTerm(contactId: string, id: string, content: string): boolean {
  const list = readLongTerm(contactId);
  const hit = list.find((m) => m.id === id);
  if (!hit) return false;
  hit.content = content.trim();
  hit.editedAt = Date.now();
  writeJSON(longKey(contactId), list);
  return true;
}

export function deleteLongTerm(contactId: string, id: string): boolean {
  const list = readLongTerm(contactId);
  const next = list.filter((m) => m.id !== id);
  if (next.length === list.length) return false;
  writeJSON(longKey(contactId), next);
  return true;
}

/** 删除联系人时级联清理其全部记忆（碎片/核心/长期/设置/轮次计数） */
export function memPurgeContact(contactId: string): void {
  try {
    // IndexedDB kv（内存+库同步删）+ localStorage 旧键兼容清扫（防历史残留复活）
    for (const k of [
      fragKey(contactId),
      coreKey(contactId),
      longKey(contactId),
      settingsKey(contactId),
      ...(['wx', 'qq', 'sms', 'phone'] as MemApp[]).map((app) => roundKey(contactId, app)),
    ]) {
      kvDel(k);
      window.localStorage.removeItem(k);
    }
  } catch {
    // 忽略
  }
}

// ---------------- 召回（AI 带着记忆聊天） ----------------

/** 相关性打分：内容与当前上下文的重叠 + 新近加成（长期/核心/碎片各自组内排序用） */
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
 * 注入顺序（层级从高到低）：长期记忆 → 核心记忆 → 近期碎片；跨层去重：与已选内容相似（≥0.6）
 * 的低层记忆不再重复注入（长期已收编的由长期代表、核心已收编碎片的由核心代表）。
 * 容量上限：长期 8 条、核心 12 条、碎片 5 条（各按 权重×相关性×淡化 降序截断）；
 * 已入长期（archivedAt）的核心、已入核心（consumedAt）与已归档的碎片不再召回。
 * 该联系人没有记忆 / 互通关闭且当前 App 无来源记忆 → 返回空串（正常聊天，不报错）。
 */
export function memRecallBlock(contactId: string, app: MemApp, contextText: string): string {
  if (!contactId) return '';
  memSweepExpiry(contactId);
  const { share, forget } = getMemSettings(contactId);
  const now = Date.now();
  // 长期记忆（顶层画像）：全量注入（安全上限 8 条防失控）；用户手动设置过期的长期不再注入
  const longs = listLongTerm(contactId)
    .filter((m) => !isMemExpired(m, now) && (share || m.apps.includes(app)))
    .map((m) => ({ m, s: relevanceScore(m.content, m.createdAt, contextText) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 8);
  // 核心记忆：全量注入（安全上限 12 条）；已被长期收编的不再注入（由长期记忆代表）；
  // 用户手动设置过期的核心不再注入（默认永不过期不受影响）
  const cores = listCores(contactId)
    .filter((m) => !m.archivedAt && !isMemExpired(m, now) && (share || m.apps.includes(app)))
    .map((m) => ({ m, s: relevanceScore(m.content, m.createdAt, contextText) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 12);
  // 近期记忆碎片：按相关性取前 5 条；已消费的由核心记忆代表，已更新/已过期的不召回
  const frags = listFragments(contactId)
    .filter((f) => !f.consumedAt && !f.supersededAt && !isMemExpired(f, now) && (share || f.app === app))
    .map((f) => ({ f, ...fragRecallScore(f, forget, contextText, now) }))
    .filter((x) => x.st !== 'faded')
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);
  if (longs.length === 0 && cores.length === 0 && frags.length === 0) return '';
  // 跨层去重：按注入顺序遍历，与已选内容相似（≥0.6）的条目跳过（信息已由高层代表）
  const accepted: string[] = [];
  const isDup = (content: string) => accepted.some((a) => similarity(a, content) >= SIMILAR_MERGE_THRESHOLD);
  const keepLongs = longs.filter(({ m }) => {
    if (isDup(m.content)) return false;
    accepted.push(m.content);
    return true;
  });
  const keepCores = cores.filter(({ m }) => {
    if (isDup(m.content)) return false;
    accepted.push(m.content);
    return true;
  });
  const keepFrags = frags.filter(({ f }) => {
    if (isDup(f.content)) return false;
    accepted.push(f.content);
    return true;
  });
  if (keepLongs.length === 0 && keepCores.length === 0 && keepFrags.length === 0) return '';
  // 时间感知：层内按有效时间（事件时间优先，其次加强/来源/创建时间）从新到旧排序
  keepLongs.sort((a, b) => memEffectiveTime(b.m) - memEffectiveTime(a.m));
  keepCores.sort((a, b) => memEffectiveTime(b.m) - memEffectiveTime(a.m));
  keepFrags.sort((a, b) => memEffectiveTime(b.f) - memEffectiveTime(a.f));
  const lines: string[] = [
    `【关于对方的记忆（跨应用记忆库自动整理；当前时间：${memNowLabel(now)}；聊天时自然运用，不要逐条复述或主动承认看过记忆）】`,
    '（时间越近的记忆越可信：优先参考时间更近的；同一事实新旧矛盾时，以时间更近的为准）',
  ];
  if (keepLongs.length > 0) {
    lines.push('◇ 长期记忆（最稳定的画像；回复时应始终符合这些事实）：');
    keepLongs.forEach(({ m }, i) => lines.push(`${i + 1}. （${memTimeLabel(memEffectiveTime(m), now)}）${m.content}`));
  }
  if (keepCores.length > 0) {
    lines.push('◇ 核心记忆（长期事实；回复时应优先参考这些核心事实，保持前后一致）：');
    keepCores.forEach(({ m }, i) => lines.push(`${i + 1}. （${memTimeLabel(memEffectiveTime(m), now)}）${m.content}`));
  }
  if (keepFrags.length > 0) {
    lines.push('◇ 近期记忆碎片：');
    keepFrags.forEach(({ f }, i) => {
      // 事件时间优先（内容所指的时间），否则用来源对话时间；碎片额外带来源 App 标注
      const t = f.eventTime != null ? memTimeLabel(f.eventTime, now) : `${memTimeLabel(f.sourceTime, now)}·${MEM_APP_LABEL[f.app]}`;
      lines.push(`${i + 1}. （${t}）${f.content}`);
    });
  }
  return lines.join('\n');
}

/** 召回预览（设置页）：与 memRecallBlock 同一套层级与排序，返回排序后的记忆对象 */
export function memRecallPreview(contactId: string): { longs: MemLongTerm[]; cores: MemCore[]; frags: MemFragment[] } {
  const { forget } = getMemSettings(contactId);
  const now = Date.now();
  const longs = listLongTerm(contactId)
    .filter((m) => !isMemExpired(m, now))
    .map((m) => ({ m, s: relevanceScore(m.content, m.createdAt, '') }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.m);
  const cores = listCores(contactId)
    .filter((m) => !m.archivedAt && !isMemExpired(m, now))
    .map((m) => ({ m, s: relevanceScore(m.content, m.createdAt, '') }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.m);
  const frags = listFragments(contactId)
    .filter((f) => !f.consumedAt && !f.supersededAt && !isMemExpired(f, now))
    .map((f) => ({ f, ...fragRecallScore(f, forget, '', now) }))
    .filter((x) => x.st !== 'faded')
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => x.f);
  return { longs, cores, frags };
}

// ---------------- 轮次计数 + 自动提取 ----------------

/** 防并发：同一联系人同一 App 正在提取/总结时跳过新触发 */
const inflight = new Set<string>();

/** extract 接口返回的单条碎片：文本 + 可选权重 + 时间感知（事件/过期时间）+ 矛盾更新目标 */
interface ExtractItem {
  text: string;
  weight?: MemWeight;
  eventTime?: number | null;
  expiresAt?: number | null;
  supersedes?: string[];
}

interface ExtractApiResult {
  fragments?: (string | { text?: unknown; weight?: unknown })[];
  error?: string;
}
interface SummarizeApiResult {
  summary?: string;
  error?: string;
}

/**
 * 模型时间字符串 → 时间戳（无时区字符串按北京时间解析，与提取锚点/注入标签一致）：
 * - "YYYY-MM-DD" → 北京时间 0 点（仅日期事件，标签不带出无意义的 00:00）
 * - "YYYY-MM-DD HH:mm" → 北京时间该时刻
 * - 其余（含完整 ISO/带偏移）→ Date.parse 兜底
 * 范围距当前 ±MEM_TIME_RANGE_YEARS 年，超出/解析失败返回 null（绝不让幻觉时间入库）。
 */
function parseMemTime(v: unknown, now: number): number | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s === 'null' || s === 'undefined') return null;
  let d: Date | null = null;
  const md = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const mdt = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  // 无时区字符串统一按北京时间（UTC+8）解析 —— 与提取锚点（Asia/Shanghai）、注入标签（bjParts）
  // 一致，与设备时区无关；带时区/ISO 带偏移的字符串走 Date.parse 原语义
  if (md) d = new Date(Date.UTC(Number(md[1]), Number(md[2]) - 1, Number(md[3])) - 8 * 3_600_000);
  else if (mdt)
    d = new Date(
      Date.UTC(Number(mdt[1]), Number(mdt[2]) - 1, Number(mdt[3]), Number(mdt[4]), Number(mdt[5])) - 8 * 3_600_000
    );
  else {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) d = new Date(t);
  }
  if (!d) return null;
  const t = d.getTime();
  const span = MEM_TIME_RANGE_YEARS * 366 * 86_400_000;
  if (t < now - span || t > now + span) return null;
  return t;
}

/** 把 extract 接口返回的碎片归一化（字符串/对象混合兼容 + 非法值兜底自动分类 + 时间解析/防幻觉） */
function normalizeExtract(res: ExtractApiResult): ExtractItem[] {
  const raw = Array.isArray(res.fragments) ? res.fragments : [];
  const now = Date.now();
  const out: ExtractItem[] = [];
  for (const x of raw) {
    if (typeof x === 'string') {
      const t = x.trim();
      if (t) out.push({ text: t, weight: autoWeight(t) });
    } else if (x && typeof x === 'object' && typeof x.text === 'string' && x.text.trim()) {
      const o = x as { text: string; weight?: unknown; eventTime?: unknown; expiresAt?: unknown; supersedes?: unknown };
      const item: ExtractItem = { text: o.text.trim(), weight: normalizeWeight(o.weight, o.text) };
      const et = parseMemTime(o.eventTime, now);
      const ex = parseMemTime(o.expiresAt, now);
      // 双保险：过期时间不得早于事件时间（服务端已校验一次，这里兜底防历史残留/异常数据）
      if (et != null) item.eventTime = et;
      if (ex != null && (et == null || ex >= et)) item.expiresAt = ex;
      if (Array.isArray(o.supersedes)) {
        const ids = o.supersedes
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => id.trim())
          .slice(0, 6);
        if (ids.length > 0) item.supersedes = ids;
      }
      out.push(item);
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
 * 追加碎片（矛盾更新优先，其次三层去重）：
 * 0) 矛盾更新（模型标注 supersedes 且目标存在）：旧记忆标记 supersededAt/supersededBy（「已更新」，
 *    不再参与召回/总结），本条直接新增（事件/过期时间一并入库）；矛盾条目不走相似合并
 *    （「不吃辣」绝不能被合并进「爱吃辣」）；
 * 1) 精确重复 → 记一次「加强」（reinforcedAt/次数刷新），不新增；
 * 2) 相似（2-gram ≥0.6，同一事实的不同说法）→ 合并进已有条目：内容取更完整的、权重取更高、
 *    加强计时刷新、计数 +1，不新增占位（已更新/已过期/已消费的旧记忆不作为合并目标）；
 * 3) 全新 → 新建（权重：LLM 判定优先，缺省按关键词自动分类）。
 * 返回 { added: 新增条目; merged: 合并/加强次数; superseded: 矛盾更新条数 }
 */
function appendFragments(
  contactId: string,
  app: MemApp,
  items: ExtractItem[],
  sourceTime: number,
  sourceMsgId?: string
): { added: MemFragment[]; merged: number; superseded: number } {
  const list = readFragments(contactId);
  const now = Date.now();
  const seen = new Set(list.filter((f) => !f.supersededAt && !isMemExpired(f, now)).map((f) => normText(f.content)));
  const added: MemFragment[] = [];
  let merged = 0;
  let superseded = 0;
  const newItem = (content: string, item: ExtractItem, id?: string): MemFragment => ({
    id: id ?? uid(),
    contactId,
    app,
    content,
    sourceTime,
    createdAt: now,
    eventTime: item.eventTime ?? undefined,
    expiresAt: item.expiresAt ?? undefined,
    weight: item.weight ?? autoWeight(content),
    reinforcedAt: now,
    reinforceCount: 0,
    sourceMsgId,
  });
  for (const item of items) {
    const content = item.text.trim();
    if (!content) continue;
    const key = normText(content);
    // 0) 矛盾更新：标记被更正的旧记忆为「已更新」，本条直接新增
    const targets = (item.supersedes ?? [])
      .map((id) => list.find((f) => f.id === id))
      .filter((f): f is MemFragment => f != null && f.supersededAt == null);
    if (targets.length > 0) {
      const newId = uid();
      for (const t of targets) {
        t.supersededAt = now;
        t.supersededBy = newId;
      }
      superseded += targets.length;
      seen.add(key);
      added.push(newItem(content, item, newId));
      continue;
    }
    // 1) 精确重复 → 加强已有记忆（已更新/已过期的旧条目不是目标）
    if (seen.has(key)) {
      const hit = list.find((f) => normText(f.content) === key && !f.supersededAt && !isMemExpired(f, now));
      if (hit) {
        hit.reinforcedAt = now;
        hit.reinforceCount = (hit.reinforceCount ?? 0) + 1;
        hit.weight = higherWeight(hit.weight, item.weight);
        // 时间感知：未手动编辑过的记忆，重复提及且本次提取带新时间时刷新（事件时间保鲜）；
        // 用户手动设置过（timeEditedAt）的一律以用户为准，绝不覆盖
        if (!hit.timeEditedAt) {
          if (item.eventTime != null) hit.eventTime = item.eventTime;
          if (item.expiresAt != null) hit.expiresAt = item.expiresAt;
        }
        merged++;
        continue;
      }
      // 命中的只是已更新/已过期的旧条目 → 落到下面按新增处理
    }
    // 2) 相似说法 → 合并进已有记忆（优先未消费的；内容保留更完整的一条）
    const simHit = list
      .filter((f) => !f.supersededAt && !isMemExpired(f, now) && f.content.length >= 4 && content.length >= 4)
      .sort((a, b) => Number(Boolean(a.consumedAt)) - Number(Boolean(b.consumedAt)) || a.createdAt - b.createdAt)
      .find((f) => similarity(f.content, content) >= SIMILAR_MERGE_THRESHOLD);
    if (simHit) {
      if (content.length > simHit.content.length) simHit.content = content;
      simHit.reinforcedAt = now;
      simHit.reinforceCount = (simHit.reinforceCount ?? 0) + 1;
      simHit.weight = higherWeight(simHit.weight, item.weight);
      // 时间感知（与精确重复同规则）：未手动编辑过 → 新时间保鲜；手动设置过 → 用户优先不覆盖
      if (!simHit.timeEditedAt) {
        if (item.eventTime != null) simHit.eventTime = item.eventTime;
        if (item.expiresAt != null) simHit.expiresAt = item.expiresAt;
      }
      if (!simHit.sourceMsgId && sourceMsgId) simHit.sourceMsgId = sourceMsgId;
      seen.add(normText(simHit.content));
      merged++;
      continue;
    }
    // 3) 全新记忆
    seen.add(key);
    added.push(newItem(content, item));
  }
  if (added.length > 0 || merged > 0 || superseded > 0) writeJSON(fragKey(contactId), [...list, ...added]);
  return { added, merged, superseded };
}

/** 把当前待总结（未被更新/未过期/未消费/未归档）的碎片总结为核心记忆，并标记来源碎片已消费（阈值判断由调用方负责） */
async function summarizePendingIntoCore(contactId: string, apiConfig: ApiConfig, names?: MemNames | null): Promise<MemCore> {
  const { forget } = getMemSettings(contactId);
  const now = Date.now();
  const pending = readFragments(contactId).filter(
    (f) =>
      !f.consumedAt &&
      !f.supersededAt &&
      !isMemExpired(f, now) &&
      fadeState(f as FadeInput, forget, now) !== 'faded'
  );
  const { userName, peerName } = namesOf(names);
  const res = await callMemoryApi<SummarizeApiResult>(
    'summarize',
    {
      level: 'core',
      fragments: pending.map((f) => f.content),
      userName,
      peerName,
    },
    apiConfig
  );
  const summary = (res.summary || '').trim();
  if (!summary) throw new Error('总结结果为空');
  const core: MemCore = {
    id: uid(),
    contactId,
    content: summary,
    fragmentCount: pending.length,
    sourceIds: pending.map((f) => f.id),
    apps: Array.from(new Set(pending.map((f) => f.app))),
    createdAt: Date.now(),
    // 时间感知：来源碎片中带事件时间的，取最早一条作为核心的事件时间（可选，仅标注用）
    eventTime: (() => {
      const ets = pending.map((f) => f.eventTime).filter((t): t is number => t != null);
      return ets.length > 0 ? Math.min(...ets) : undefined;
    })(),
  };
  const all = readCores(contactId);
  writeJSON(coreKey(contactId), [...all, core]);
  // 标记来源碎片已消费
  const consumedIds = new Set(core.sourceIds);
  writeJSON(
    fragKey(contactId),
    readFragments(contactId).map((f) => (consumedIds.has(f.id) ? { ...f, consumedAt: Date.now() } : f))
  );
  return core;
}

/** 把当前未归档且未过期的核心记忆总结为一条长期记忆，并标记来源核心已归档（方案A：不重复总结） */
async function summarizeCoresIntoLong(contactId: string, apiConfig: ApiConfig, names?: MemNames | null): Promise<MemLongTerm> {
  const now = Date.now();
  const pending = readCores(contactId).filter((m) => !m.archivedAt && !isMemExpired(m, now));
  const { userName, peerName } = namesOf(names);
  const res = await callMemoryApi<SummarizeApiResult>(
    'summarize',
    {
      level: 'long',
      fragments: pending.map((m) => m.content),
      userName,
      peerName,
    },
    apiConfig
  );
  const summary = (res.summary || '').trim();
  if (!summary) throw new Error('总结结果为空');
  const long: MemLongTerm = {
    id: uid(),
    contactId,
    content: summary,
    coreCount: pending.length,
    sourceIds: pending.map((m) => m.id),
    apps: Array.from(new Set(pending.flatMap((m) => m.apps))),
    createdAt: Date.now(),
  };
  const all = readLongTerm(contactId);
  writeJSON(longKey(contactId), [...all, long]);
  // 标记来源核心已归档（archivedAt）：召回由长期记忆代表，不再参与后续总结
  const archivedIds = new Set(long.sourceIds);
  writeJSON(
    coreKey(contactId),
    readCores(contactId).map((m) => (archivedIds.has(m.id) ? { ...m, archivedAt: Date.now() } : m))
  );
  return long;
}

/** 检查未消费且未归档的碎片是否达到核心阈值；达到则自动触发核心总结 */
async function maybeAutoSummarize(contactId: string, apiConfig: ApiConfig, names?: MemNames | null): Promise<MemCore | null> {
  if (pendingFragmentCount(contactId) < getMemSettings(contactId).threshold) return null;
  return summarizePendingIntoCore(contactId, apiConfig, names);
}

/** 检查未归档的核心记忆是否达到长期阈值；达到则自动触发长期记忆总结 */
async function maybeAutoLongSummarize(contactId: string, apiConfig: ApiConfig, names?: MemNames | null): Promise<MemLongTerm | null> {
  const { longThreshold } = getMemSettings(contactId);
  if (pendingCoreCount(contactId) < longThreshold) return null;
  return summarizeCoresIntoLong(contactId, apiConfig, names);
}

/**
 * 一轮 AI 对话结束后的记忆管线（各聊天 App 的 finalize 成功分支调用）：
 * 1) 轮次 +1；2) 达到提取间隔 → 从最近对话提取记忆碎片（后台异步，不阻塞聊天）；
 * 3) 碎片积累达到核心阈值 → 自动总结核心记忆；4) 核心积累达到长期阈值 → 自动总结长期记忆。
 * 失败静默（console.warn），不打断聊天。
 * buildConvo 惰性调用：只有真的需要提取时才读取/整理对话文本。
 * getSourceMsgId 惰性调用：提取时取来源消息 ID（追溯用，可省略）。
 * names：用户真实名字 + 角色名字（视角统一注入提取/总结 prompt；缺省回退固定称呼）。
 */
export function memAfterAiTurn(
  contactId: string | null,
  app: MemApp,
  apiConfig: ApiConfig,
  buildConvo: () => MemConvoTurn[],
  getSourceMsgId?: () => string | undefined,
  names?: MemNames | null
): void {
  if (!contactId) return;
  try {
    // 时间感知：先把已到期的碎片标记归档（惰性清扫，召回/总结另有实时过滤兜底）
    memSweepExpiry(contactId);
    const key = roundKey(contactId, app);
    const count = (readJSON<number>(key) ?? 0) + 1;
    const { interval } = getMemSettings(contactId);
    if (count < interval) {
      writeJSON(key, count);
      return;
    }
    // 达到间隔：归零计数并异步提取（归零在先避免每轮重试轰炸；下个窗口自然重试）
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
            { conversation: convo, app, existing: existingForConflict(contactId), ...namesOf(names) },
            apiConfig
          );
          const items = normalizeExtract(res);
          if (items.length > 0) appendFragments(contactId, app, items, Date.now(), getSourceMsgId?.());
        }
      } catch (err) {
        console.warn('[memory] 自动提取失败（下个窗口重试）', err);
      }
      // 核心总结与提取相互独立：即使本轮提取失败，只要已积累的未消费碎片达到阈值，
      // 仍应尝试凝结核心记忆（否则一次提取故障会连带把总结也卡到下个窗口）
      try {
        await maybeAutoSummarize(contactId, apiConfig, names);
      } catch (err) {
        console.warn('[memory] 自动总结核心记忆失败（下个窗口重试）', err);
      }
      // 长期总结与核心总结相互独立：核心达到长期阈值即触发（失败下个窗口重试）
      try {
        await maybeAutoLongSummarize(contactId, apiConfig, names);
      } catch (err) {
        console.warn('[memory] 自动总结长期记忆失败（下个窗口重试）', err);
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
  /** 新增碎片数 */
  fragments: number;
  /** 新增核心记忆数 */
  cores: number;
  /** 新增长期记忆数 */
  longs: number;
  /** 相似记忆被合并/加强的次数 */
  merged: number;
}

/** 手动总结（设置页「全部执行」）：不等 N 轮，立刻整理当前对话并入库（碎片 + 达阈值的核心 + 达阈值的长期） */
export async function memSummarizeNow(
  contactId: string,
  app: MemApp,
  apiConfig: ApiConfig,
  convo: MemConvoTurn[],
  names?: MemNames | null
): Promise<ManualSummarizeResult> {
  const guard = `${contactId}:manual`;
  if (inflight.has(guard)) throw new Error('正在总结中，请稍候');
  inflight.add(guard);
  try {
    if (convo.length < 2) throw new Error('当前没有足够的对话内容可总结');
    const res = await callMemoryApi<ExtractApiResult>(
      'extract',
      { conversation: convo, app, existing: existingForConflict(contactId), ...namesOf(names) },
      apiConfig
    );
    const items = normalizeExtract(res);
    if (items.length === 0) throw new Error('这次对话没有提炼出新的记忆');
    const { added, merged } = appendFragments(contactId, app, items, Date.now());
    if (added.length === 0 && merged === 0) throw new Error('提炼出的记忆都已存在，没有新增');
    let coresCreated = 0;
    let longsCreated = 0;
    const core = await maybeAutoSummarize(contactId, apiConfig, names).catch(() => null);
    coresCreated = core ? 1 : 0;
    const long = await maybeAutoLongSummarize(contactId, apiConfig, names).catch(() => null);
    longsCreated = long ? 1 : 0;
    return { fragments: added.length, cores: coresCreated, longs: longsCreated, merged };
  } finally {
    inflight.delete(guard);
  }
}

// ---------------- 手动「立即总结」（碎片页 / 核心页 / 长期页右上角各自独立入口） ----------------

/** 手动提取碎片（碎片页右上角「立即总结」）：只把最近对话整理为记忆碎片入库，不触发核心记忆总结 */
export async function memExtractNow(contactId: string, apiConfig: ApiConfig, names?: MemNames | null): Promise<{ added: number; merged: number }> {
  const guard = `${contactId}:manual`;
  if (inflight.has(guard)) throw new Error('正在总结中，请稍候');
  inflight.add(guard);
  try {
    const recent = memMostRecentApp(contactId);
    if (!recent || recent.convo.length < 2) throw new Error('当前没有可总结的对话，先去和TA聊聊吧');
    const res = await callMemoryApi<ExtractApiResult>(
      'extract',
      { conversation: recent.convo, app: recent.app, existing: existingForConflict(contactId), ...namesOf(names) },
      apiConfig
    );
    const items = normalizeExtract(res);
    if (items.length === 0) throw new Error('这次对话没有提炼出新的记忆');
    const { added, merged } = appendFragments(contactId, recent.app, items, Date.now());
    if (added.length === 0 && merged === 0) throw new Error('提炼出的记忆都已存在，没有新增');
    return { added: added.length, merged };
  } finally {
    inflight.delete(guard);
  }
}

/** 手动凝结核心记忆（核心记忆页右上角「立即总结」）：不等阈值，把当前待总结碎片立即总结为核心记忆 */
export async function memSummarizeCoreNow(contactId: string, apiConfig: ApiConfig, names?: MemNames | null): Promise<{ consumed: number }> {
  const guard = `${contactId}:manual`;
  if (inflight.has(guard)) throw new Error('正在总结中，请稍候');
  inflight.add(guard);
  try {
    const { forget } = getMemSettings(contactId);
    const now = Date.now();
    const pending = readFragments(contactId).filter(
      (f) => !f.consumedAt && fadeState(f as FadeInput, forget, now) !== 'faded'
    );
    if (pending.length < 2) throw new Error('待总结的记忆碎片不足 2 条，先去和TA聊聊吧');
    const core = await summarizePendingIntoCore(contactId, apiConfig, names);
    return { consumed: core.fragmentCount };
  } finally {
    inflight.delete(guard);
  }
}

/** 手动总结长期记忆（长期记忆页右上角「立即总结」）：不等阈值，把当前未归档核心立即总结为长期记忆 */
export async function memSummarizeLongNow(contactId: string, apiConfig: ApiConfig, names?: MemNames | null): Promise<{ consumed: number }> {
  const guard = `${contactId}:manual`;
  if (inflight.has(guard)) throw new Error('正在总结中，请稍候');
  inflight.add(guard);
  try {
    const now = Date.now();
    const pending = readCores(contactId).filter((m) => !m.archivedAt && !isMemExpired(m, now));
    if (pending.length < 2) throw new Error('待总结的核心记忆不足 2 条，先积累一些碎片吧');
    const long = await summarizeCoresIntoLong(contactId, apiConfig, names);
    return { consumed: long.coreCount };
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
        // 时间感知（手动优先）：正本未被手动编辑时从副本补齐缺失的时间字段；
        // 副本被手动编辑过则把时间连同标记一并继承（合并体继续受用户设置保护）
        if (!keep.timeEditedAt) {
          if (keep.eventTime == null && drop.eventTime != null) keep.eventTime = drop.eventTime;
          if (keep.expiresAt == null && drop.expiresAt != null) keep.expiresAt = drop.expiresAt;
          if (drop.timeEditedAt) keep.timeEditedAt = drop.timeEditedAt;
        }
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

// ---------------- 视角修复（旧版「对方/用户」代称 → 真实名字） ----------------

/** 同义反复短语：「小晨叫小晨 / 小晨名叫小晨 / 小晨的名字是小晨」等（名字身份事实无信息量） */
function tautologyClause(name: string): RegExp {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${n}(?:叫|名叫|名字叫|的名字是|名字是)${n}[，,、]?`, 'g');
}

/**
 * 修复旧记忆的视角混乱（设置页按钮）：把碎片/核心/长期里「对方」替换为角色名字、「用户」
 * 替换为用户真实名字（旧版提取器固定用这两个代称，语义明确可安全替换）。
 * 只替换提供了对应名字的代称（名字缺失时代称保留，避免产生无主语碎片）；
 * 「我/你/TA」等代称语义不明不自动替换（可手动编辑）。
 * 同义反复清理：「用户叫小晨」→「小晨叫小晨」这类名字身份短语直接剥掉（已由全库用名隐含），
 * 剥完为空的条目删除。返回各层修复条数（含删除）。
 */
export function memRepairPerspectiveNow(
  contactId: string,
  names?: MemNames | null
): { frags: number; cores: number; longs: number } {
  const { userName, peerName } = namesOf(names);
  const hasUser = Boolean((names?.user ?? '').trim());
  const hasPeer = Boolean((names?.peer ?? '').trim());
  if (!hasUser && !hasPeer) return { frags: 0, cores: 0, longs: 0 };
  const fix = (content: string): string => {
    let out = content;
    if (hasPeer) out = out.replace(/对方/g, peerName);
    if (hasUser) out = out.replace(/用户/g, userName);
    // 同义反复清理：「用户叫小晨」替换后变成「小晨叫小晨」，名字身份事实已由全库用名隐含，
    // 直接剥掉该短语（拆不出有效内容则整条删除）
    out = out
      .replace(tautologyClause(userName), '')
      .replace(tautologyClause(peerName), '')
      .replace(/^[，,。、；;\s]+/, '')
      .replace(/[，,\s]+$/, '');
    return out;
  };
  /** 三层通用：替换 + 剥掉清空后为空的条目（返回修复条数） */
  const fixLayer = <T extends { content: string }>(list: T[]): { next: T[]; fixed: number } => {
    let fixed = 0;
    const out: T[] = [];
    for (const item of list) {
      const repaired = fix(item.content);
      if (repaired !== item.content) {
        fixed++;
        if (repaired) out.push({ ...item, content: repaired, editedAt: Date.now() });
      } else {
        out.push(item);
      }
    }
    return { next: out, fixed };
  };
  // 碎片
  const fragRes = fixLayer(readFragments(contactId));
  if (fragRes.fixed > 0) writeJSON(fragKey(contactId), fragRes.next);
  // 核心
  const coreRes = fixLayer(readCores(contactId));
  if (coreRes.fixed > 0) writeJSON(coreKey(contactId), coreRes.next);
  // 长期
  const longRes = fixLayer(readLongTerm(contactId));
  if (longRes.fixed > 0) writeJSON(longKey(contactId), longRes.next);
  return { frags: fragRes.fixed, cores: coreRes.fixed, longs: longRes.fixed };
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
    // 聊天记录已迁 IndexedDB kv store（内存同步读，启动时由 idb-kv 迁移）
    const parsed: unknown = kvGet(
      app === 'wx'
        ? `wx-chat-msgs:${contactId}`
        : app === 'qq'
          ? `qq-chat-msgs:${contactId}`
          : `ios-chat-msgs:c:${contactId}`
    );
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
      const parsed: unknown = kvGet(key);
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
