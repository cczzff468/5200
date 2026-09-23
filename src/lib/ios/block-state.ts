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
 */

import { kvGet, kvSet, kvDel } from './idb-kv';
import type { RichAction } from '@/lib/chat-rich';

export type BlockApp = 'wx' | 'qq' | 'sms';

/** 各 App 的场景名（system 注入用） */
export const BLOCK_CHANNEL: Record<BlockApp, string> = { wx: '微信', qq: 'QQ', sms: '短信' };

/** 单个会话的拉黑状态（全部字段可选，空对象 = 无任何拉黑关系） */
export interface BlockEntry {
  /** 用户拉黑了角色 */
  byUser?: boolean;
  /** 角色拉黑了用户 */
  byChar?: boolean;
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
  return {
    byUser: e.byUser === true || undefined,
    byChar: e.byChar === true || undefined,
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
  const empty = !n.byUser && !n.byChar && !n.reqReason && !n.reqAt && !n.rejectedAt && !n.reqCount;
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
 * 解除拉黑 → 清空申请计数/拒绝记录；重新拉黑 → 新的防骚扰周期（计数归零）。
 */
export function setUserBlock(app: BlockApp, contactId: string, blocked: boolean): BlockEntry {
  const cur = loadBlock(app, contactId);
  if (blocked) {
    if (cur.byUser) return cur; // 已是拉黑态：保留申请冷却/计数（防用开关重置骚扰防护）
    return saveBlock(app, contactId, { byUser: true, byChar: cur.byChar });
  }
  return saveBlock(app, contactId, { byChar: cur.byChar });
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
    return { entry: saveBlock(app, contactId, { ...cur, byChar: true }), changed: true, reqCreated: false };
  }
  if (kind === 'unblock') {
    if (!cur.byChar) return { entry: cur, changed: false, reqCreated: false };
    return { entry: saveBlock(app, contactId, { ...cur, byChar: undefined }), changed: true, reqCreated: false };
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

/** 用户同意角色的解除申请：清除 byUser 与待处理申请（byChar 不受影响）；防骚扰计数一并清零 */
export function acceptBlockReq(app: BlockApp, contactId: string): BlockEntry {
  const cur = loadBlock(app, contactId);
  return saveBlock(app, contactId, { byChar: cur.byChar });
}

/** 用户拒绝角色的解除申请：拉黑保持，记录拒绝时间与累计次数（角色要知道被拒绝），清掉待处理申请 */
export function rejectBlockReq(app: BlockApp, contactId: string): BlockEntry {
  const cur = loadBlock(app, contactId);
  return saveBlock(app, contactId, {
    byUser: true,
    byChar: cur.byChar,
    rejectedAt: Date.now(),
    reqCount: (cur.reqCount ?? 0) + 1,
  });
}

/** AI 拉黑类动作标记 → applyCharBlockAction 的动作种类 */
export function blockActionKindOf(a: RichAction): 'block' | 'unblock' | 'request' | null {
  if (a.kind === 'block-user') return 'block';
  if (a.kind === 'unblock-user') return 'unblock';
  if (a.kind === 'request-unblock') return 'request';
  return null;
}

/**
 * 双向拉黑的 system 注入块（每轮请求现场读取，无任何拉黑状态时返回空串不占 token）：
 * - 告知角色当前的拉黑关系（谁拉黑了谁）、拉黑不拦截消息这一事实；
 * - 允许语气态度按人设变化；给出对应方向的标记（被拉黑 → 可申请解除；拉黑别人 → 可解除）。
 */
export function buildBlockPromptBlock(app: BlockApp, contactId: string, userName: string): string {
  const b = loadBlock(app, contactId);
  if (!b.byUser && !b.byChar) return '';
  const ch = BLOCK_CHANNEL[app];
  const user = userName || '用户';
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
