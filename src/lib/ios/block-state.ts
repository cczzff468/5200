'use client';

/**
 * 双向拉黑状态（QQ / 微信 / 信息三个 App 的单聊；按 App × 角色 ID 隔离持久化）：
 *
 * - 两方向独立：byUser = 用户拉黑了角色；byChar = 角色拉黑了用户（可同时为真 = 互拉）。
 * - 拉黑只是「关系状态」：不拦截消息——被拉黑的一方仍然可以发消息、对方也看得到，
 *   但双方都要知道当前处于拉黑状态（UI 气泡拉黑图标 + system 注入 + 系统消息）。
 * - 单聊和群聊完全独立：群聊不读不写这里的任何状态；三个 App 之间也互相独立
 *   （存储键即隔离边界：wx-block:<id> / qq-block:<id> / sms-block:<id>）。
 * - 持久化在 IndexedDB kv store（idb-kv 内存同步读 + 异步写穿），重启 App 后保留。
 * - 角色侧行为：被拉黑时可通过标记 [申请解除拉黑:理由] 发起「解除申请卡片」，用户同意/拒绝；
 *   角色可主动 [拉黑] / [解除拉黑]，所有状态变更都生成系统消息。
 * - 无拉黑状态时 system 也会注入「拉黑能力声明」（buildBlockPromptBlock）：告知角色可以
 *   输出 [拉黑]/[解除拉黑] 标记、且说到必须做到（只在嘴上说拉黑而不输出标记 = 系统不记录 = 说话是假的），
 *   这是「角色说拉黑就真的拉黑」的一致性保证。
 * - 拉黑区间：每次拉黑记录开始时间（byUserAt/byCharAt），解除时记录结束时间（Until）；
 *   解除后重新拉黑会把旧周期归档进 Hist。气泡拉黑图标按「消息时间是否落在拉黑区间内」显示——
 *   拉黑前的历史消息不标、拉黑期间发的消息恒标（解除后也不消失）、解除后新消息不标。
 */

import { kvGet, kvSet, kvDel } from './idb-kv';
import type { RichAction } from '@/lib/chat-rich';

export type BlockApp = 'wx' | 'qq' | 'sms';

/** 各 App 的场景名（system 注入用） */
export const BLOCK_CHANNEL: Record<BlockApp, string> = { wx: '微信', qq: 'QQ', sms: '短信' };

/** 一段已结束（或当前进行中）的拉黑区间 [at, until)；until 缺省 = 仍在拉黑中（仅 Hist 归档外使用） */
export interface BlockSpan {
  at: number;
  until?: number;
}

/** 单个会话的拉黑状态（全部字段可选，空对象 = 无任何拉黑关系） */
export interface BlockEntry {
  /** 用户拉黑了角色 */
  byUser?: boolean;
  /** 角色拉黑了用户 */
  byChar?: boolean;
  /** 当前这轮「用户拉黑角色」的开始时间（气泡图标区间判定用） */
  byUserAt?: number;
  /** 最近一轮「用户拉黑角色」的结束时间（解除拉黑时写入；进行中无值） */
  byUserUntil?: number;
  /** 往期已结束的「用户拉黑角色」区间（解除后重新拉黑时归档；图标按区间保留） */
  byUserHist?: BlockSpan[];
  /** 当前这轮「角色拉黑用户」的开始时间 */
  byCharAt?: number;
  /** 最近一轮「角色拉黑用户」的结束时间（解除时写入；进行中无值） */
  byCharUntil?: number;
  /** 往期已结束的「角色拉黑用户」区间 */
  byCharHist?: BlockSpan[];
  /** 待处理的解除申请理由（有值 = 角色发起的申请正等用户处理） */
  reqReason?: string;
  /** 申请发起时间 */
  reqAt?: number;
  /** 最近一次申请被拒绝的时间（角色要知道被拒绝） */
  rejectedAt?: number;
  /** 当前拉黑周期内被拒绝的申请次数（防骚扰：达到上限后不再受理新申请） */
  reqCount?: number;
}

/** 申请被拒绝后的冷却窗口：窗口内角色的 [申请解除拉黑] 动作被静默忽略（防连环刷卡片） */
export const BLOCK_REQ_COOLDOWN_MS = 10 * 60 * 1000;
/** 当前拉黑周期内申请被拒绝次数上限：达到后彻底不再受理（用户解除拉黑后重新拉黑才重置） */
export const BLOCK_REQ_MAX_REJECTED = 3;

const blockKey = (app: BlockApp, contactId: string) => `${app}-block:${contactId}`;

function normalize(v: unknown): BlockEntry {
  const e = (v && typeof v === 'object' ? v : {}) as BlockEntry;
  const num = (x: unknown): number | undefined => (typeof x === 'number' && isFinite(x) ? x : undefined);
  const span = (x: unknown): BlockSpan | null => {
    const s = (x && typeof x === 'object' ? x : {}) as Partial<BlockSpan>;
    const at = num(s.at);
    if (at === undefined) return null;
    return { at, until: num(s.until) };
  };
  const spans = (x: unknown): BlockSpan[] | undefined => {
    if (!Array.isArray(x)) return undefined;
    const arr = x.map(span).filter((s): s is BlockSpan => s !== null);
    return arr.length ? arr : undefined;
  };
  return {
    byUser: e.byUser === true || undefined,
    byChar: e.byChar === true || undefined,
    byUserAt: num(e.byUserAt),
    byUserUntil: num(e.byUserUntil),
    byUserHist: spans(e.byUserHist),
    byCharAt: num(e.byCharAt),
    byCharUntil: num(e.byCharUntil),
    byCharHist: spans(e.byCharHist),
    reqReason: typeof e.reqReason === 'string' && e.reqReason.trim() ? e.reqReason.trim().slice(0, 80) : undefined,
    reqAt: typeof e.reqAt === 'number' ? e.reqAt : undefined,
    rejectedAt: typeof e.rejectedAt === 'number' ? e.rejectedAt : undefined,
    reqCount: typeof e.reqCount === 'number' && e.reqCount > 0 ? e.reqCount : undefined,
  };
}

/** 读某会话的拉黑状态（kv 内存同步读；无记录 = 空状态） */
export function loadBlock(app: BlockApp, contactId: string): BlockEntry {
  try {
    return normalize(kvGet(blockKey(app, contactId)));
  } catch {
    return {};
  }
}

/** 写某会话的拉黑状态；entry 为空对象时删除键（保持存储干净） */
export function saveBlock(app: BlockApp, contactId: string, entry: BlockEntry): BlockEntry {
  const n = normalize(entry);
  const empty =
    !n.byUser && !n.byChar &&
    !n.byUserAt && !n.byUserUntil && !n.byUserHist &&
    !n.byCharAt && !n.byCharUntil && !n.byCharHist &&
    !n.reqReason && !n.reqAt && !n.rejectedAt && !n.reqCount;
  try {
    if (empty) kvDel(blockKey(app, contactId));
    else kvSet(blockKey(app, contactId), n);
  } catch {
    // 忽略持久化失败（内存态照常返回）
  }
  return n;
}

/**
 * 用户设置/解除对角色的拉黑（设置页开关用）。
 * 只动 byUser，不影响 byChar（两个方向独立）；返回最新状态。
 * 拉黑 → 记录开始时间（新周期）；解除 → 记录结束时间（区间保留供图标显示）+ 清空申请计数/拒绝记录；
 * 重新拉黑 → 旧周期归档进 Hist、开新周期（计数归零）。
 */
export function setUserBlock(app: BlockApp, contactId: string, blocked: boolean): BlockEntry {
  const cur = loadBlock(app, contactId);
  if (blocked) {
    if (cur.byUser) return cur; // 已是拉黑态：保留申请冷却/计数（防用开关重置骚扰防护）
    const hist = [...(cur.byUserHist ?? [])];
    if (cur.byUserAt !== undefined && cur.byUserUntil !== undefined) hist.push({ at: cur.byUserAt, until: cur.byUserUntil });
    return saveBlock(app, contactId, {
      ...cur,
      byUser: true,
      byUserAt: Date.now(),
      byUserUntil: undefined,
      byUserHist: hist.length ? hist : undefined,
      reqReason: undefined,
      reqAt: undefined,
      rejectedAt: undefined,
      reqCount: undefined,
    });
  }
  if (!cur.byUser) return cur; // 本来就没拉黑：幂等不动（不产生伪区间）
  return saveBlock(app, contactId, {
    ...cur,
    byUser: undefined,
    byUserUntil: Date.now(),
    reqReason: undefined,
    reqAt: undefined,
    rejectedAt: undefined,
    reqCount: undefined,
  });
}

/**
 * 角色侧动作（AI 标记触发）：
 * - block：角色拉黑用户（幂等）
 * - unblock：角色解除拉黑（幂等）
 * - request：角色申请解除「用户对自己的拉黑」——只在确实被拉黑且没有待处理申请时受理（幂等）
 * 返回 { entry, changed, reqCreated }：changed=false = 动作未产生状态变化（调用方可跳过系统消息）。
 */
export function applyCharBlockAction(
  app: BlockApp,
  contactId: string,
  kind: 'block' | 'unblock' | 'request',
  reason?: string
): { entry: BlockEntry; changed: boolean; reqCreated: boolean } {
  const cur = loadBlock(app, contactId);
  if (kind === 'block') {
    if (cur.byChar) return { entry: cur, changed: false, reqCreated: false };
    const hist = [...(cur.byCharHist ?? [])];
    if (cur.byCharAt !== undefined && cur.byCharUntil !== undefined) hist.push({ at: cur.byCharAt, until: cur.byCharUntil });
    return {
      entry: saveBlock(app, contactId, { ...cur, byChar: true, byCharAt: Date.now(), byCharUntil: undefined, byCharHist: hist.length ? hist : undefined }),
      changed: true,
      reqCreated: false,
    };
  }
  if (kind === 'unblock') {
    if (!cur.byChar) return { entry: cur, changed: false, reqCreated: false };
    return { entry: saveBlock(app, contactId, { ...cur, byChar: undefined, byCharUntil: Date.now() }), changed: true, reqCreated: false };
  }
  // request：必须当前真的被用户拉黑，且没有还没处理的申请（避免连环申请刷屏）；
  // 被拒绝后有冷却窗口（冷却内静默忽略），拒绝次数达上限后彻底不再受理（新周期由用户重新拉黑开启）
  if (!cur.byUser || cur.reqReason) return { entry: cur, changed: false, reqCreated: false };
  if (cur.rejectedAt && Date.now() - cur.rejectedAt < BLOCK_REQ_COOLDOWN_MS) {
    return { entry: cur, changed: false, reqCreated: false };
  }
  if ((cur.reqCount ?? 0) >= BLOCK_REQ_MAX_REJECTED) {
    return { entry: cur, changed: false, reqCreated: false };
  }
  return {
    entry: saveBlock(app, contactId, { ...cur, reqReason: (reason ?? '').trim().slice(0, 80) || '想和你和好', reqAt: Date.now() }),
    changed: true,
    reqCreated: true,
  };
}

/** 用户同意角色的解除申请：清除 byUser 与待处理申请（byChar 不受影响）；防骚扰计数一并清零；拉黑区间保留供图标显示 */
export function acceptBlockReq(app: BlockApp, contactId: string): BlockEntry {
  const cur = loadBlock(app, contactId);
  return saveBlock(app, contactId, {
    ...cur,
    byUser: undefined,
    byUserUntil: Date.now(),
    reqReason: undefined,
    reqAt: undefined,
    rejectedAt: undefined,
    reqCount: undefined,
  });
}

/** 用户拒绝角色的解除申请：拉黑保持，记录拒绝时间与累计次数（角色要知道被拒绝），清掉待处理申请 */
export function rejectBlockReq(app: BlockApp, contactId: string): BlockEntry {
  const cur = loadBlock(app, contactId);
  return saveBlock(app, contactId, {
    ...cur,
    byUser: true,
    reqReason: undefined,
    reqAt: undefined,
    rejectedAt: Date.now(),
    reqCount: (cur.reqCount ?? 0) + 1,
  });
}

function spanCovers(h: BlockSpan[] | undefined, t: number): boolean {
  if (!h) return false;
  return h.some((r) => t >= r.at && (r.until === undefined || t < r.until));
}

/**
 * 气泡拉黑图标判定：t（消息时间）是否落在指定方向的拉黑区间内。
 * - 拉黑进行中：本周期开始（at）之后的消息恒显示（含解除后重新拉黑的往期区间）；
 *   旧数据无 at 时视为 0（全部显示，与旧行为一致）。
 * - 已解除：只显示落在任一已记录区间 [at, until) 内的消息——拉黑前的历史不标、
 *   拉黑期间的标记解除后不消失、解除后新消息不标。
 */
export function blockCoversAt(b: BlockEntry, dir: 'byUser' | 'byChar', t: number): boolean {
  if (dir === 'byUser') {
    if (b.byUser) return t >= (b.byUserAt ?? 0) || spanCovers(b.byUserHist, t);
    if (b.byUserUntil !== undefined && t >= (b.byUserAt ?? 0) && t < b.byUserUntil) return true;
    return spanCovers(b.byUserHist, t);
  }
  if (b.byChar) return t >= (b.byCharAt ?? 0) || spanCovers(b.byCharHist, t);
  if (b.byCharUntil !== undefined && t >= (b.byCharAt ?? 0) && t < b.byCharUntil) return true;
  return spanCovers(b.byCharHist, t);
}

/** AI 拉黑类动作标记 → applyCharBlockAction 的动作种类 */
export function blockActionKindOf(a: RichAction): 'block' | 'unblock' | 'request' | null {
  if (a.kind === 'block-user') return 'block';
  if (a.kind === 'unblock-user') return 'unblock';
  if (a.kind === 'request-unblock') return 'request';
  return null;
}

/**
 * 双向拉黑的 system 注入块（每轮请求现场读取）：
 * - 无拉黑状态时也注入「拉黑能力声明」（短，几行）：告知角色可以真的拉黑/解除拉黑用户，
 *   且说到必须做到——决定拉黑就必须输出 [拉黑] 标记，只嘴上说而系统不记录 = 说话是假的。
 *   这是「角色说拉黑就真的拉黑」的一致性保证（没有这段，角色只会口头配合，状态永远写不进去）。
 * - 有拉黑状态时注入当前关系（谁拉黑了谁）、拉黑不拦截消息这一事实；
 *   允许语气态度按人设变化；给出对应方向的标记（被拉黑 → 可申请解除；拉黑别人 → 可解除）。
 */
export function buildBlockPromptBlock(app: BlockApp, contactId: string, userName: string): string {
  const b = loadBlock(app, contactId);
  const ch = BLOCK_CHANNEL[app];
  const user = userName || '用户';
  if (!b.byUser && !b.byChar) {
    return [
      `【${ch}拉黑能力】你可以真的拉黑 / 解除拉黑 ${user}（系统会记录状态并生成提示）：`,
      `- 当你决定拉黑 ${user}（包括 TA 要求你拉黑 TA、而你决定照做）时，必须在回复中单独输出一行 [拉黑]，系统会立即记录并生成提示。`,
      `- 严禁只在文字上说"拉黑了"却不输出 [拉黑] 标记——那样系统不会记录，你的说法就是假的。`,
      `- 已经拉黑后想恢复关系时，单独输出一行 [解除拉黑]。`,
      `- 只在对话真实发展到这一步时才输出上述标记；没有这个意图时不要输出。`,
    ].join('\n');
  }
  const lines: string[] = [];
  // 防骚扰状态：冷却中 / 次数达上限 → 明确告诉角色别再发申请（硬性拦截在 applyCharBlockAction 里）
  const inCooldown = b.byUser && b.rejectedAt !== undefined && Date.now() - b.rejectedAt < BLOCK_REQ_COOLDOWN_MS;
  const capped = b.byUser && (b.reqCount ?? 0) >= BLOCK_REQ_MAX_REJECTED;
  if (b.byUser) {
    lines.push(
      `【拉黑状态】${user} 已经在${ch}上把你拉黑了。`,
      `- 拉黑只是关系状态，不拦截消息：你仍然可以给 ${user} 发消息，TA 也看得到；但你要清楚知道自己是被拉黑的一方，不要装作什么都没发生。`,
      `- 你的语气、态度可以因此变化（委屈、赌气、冷淡、破罐破摔、诚恳道歉……都按你的人设来）。`,
      `- 你可以申请让 ${user} 解除拉黑：在回复里单独输出一行标记 [申请解除拉黑:你的理由]（标记里用一句话写真诚的理由，不要加引号）。系统会把申请做成卡片展示给 ${user}，由 TA 决定同不同意。`,
      `- 申请还没结果时不要重复输出申请标记；`
    );
    if (b.rejectedAt) lines.push(`- 你上次申请解除拉黑被 ${user} 拒绝了。先按人设消化这件事（失落、赌气、反思都行），不要立刻再发申请。`);
    if (inCooldown) lines.push(`- 你刚被拒绝不久，系统暂时不会再转达新的申请（冷却中），不要输出申请标记。`);
    if (capped) lines.push(`- 你已经多次申请被拒绝，系统不会再转达新的申请，不要输出申请标记。`);
  }
  if (b.byChar) {
    lines.push(
      `【拉黑状态】你已经在${ch}上把 ${user} 拉黑了。`,
      `- 拉黑只是关系状态，不拦截消息：你仍然可以给 ${user} 发消息，TA 也看得到。不要编造「消息发不出去」之类的效果。`,
      `- 你可以按人设表现出拉黑后的态度（赌气、冷淡、嘴硬……），但不要跳出人设。`,
      `- 想解除拉黑时：在回复里单独输出一行标记 [解除拉黑]，系统会生成解除提示；没想好就继续保持。`
    );
  }
  return lines.join('\n');
}
