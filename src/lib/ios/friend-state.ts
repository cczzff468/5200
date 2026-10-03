'use client';

/**
 * 删好友状态机 + AI 主动申请加回（微信 / QQ 两端共用一套逻辑）：
 *
 * 【删好友 ≠ 删联系人】
 * - 旧的 deleteContact（contacts-store）是「从联系人 App 里删人」：聊天记录/记忆/朋友圈/互动痕迹
 *   全部清除。本模块是社交 App 内的「删除好友」（删除好友关系）：
 *   联系人本体保留，聊天记录、记忆、朋友圈动态与互动、通话记录一律保留，只是不可见；
 *   重新加回好友（手动搜索添加 / 同意对方的加回申请）后全部恢复可见。
 *
 * 【存储】
 * - 删除状态：IndexedDB kv `friend-del:<app>:<contactId>` = FriendDelState
 *   （at=删除时间，rejected=用户拒绝过 AI 申请——拒绝后停止申请，
 *   重新加回好友清空整个状态，再次删除才重新开始）。
 *   kvGet 同步读（内存缓存）+ 异步写穿，重启保留；与 block-state 同款模式。
 * - 好友申请列表：localStorage `wx-friend-reqs`（沿用微信既有键，旧数据天然兼容——
 *   旧条目无 status 归一化为 accepted）/ `qq-friend-reqs`。
 *
 * 【可见性门控（删好友后数据不可见）】
 * - 微信/QQ 会话列表：isFriendIn(app) 已排除非好友（删除即 friendWx/friendQq=false，天然生效）；
 * - 朋友圈/空间动态、互动消息：渲染前按 isFriendDeleted 过滤被删好友的动态/互动；
 * - 通话记录（电话 App）、记忆库（全局面）：isPersonGoneEverywhere —— 删过好友且微信/QQ 两端
 *   都不是好友才隐藏（只删了微信、QQ 还是好友时记忆/通话照旧可见）；重新加回自动恢复。
 * - 记忆数据本体从不删除：AI（主动来电/加回申请生成）仍可引用（TA 还记得你们的事，只是被你删了）。
 *
 * 【AI 主动申请加回】
 * - 确认删除后立刻，AI 以「好友申请」形式出现在 新的朋友/好友通知 列表（status='pending'；
 *   无冷却——同一联系人同时只保留一条待处理申请，同意/拒绝后不再重复发）。
 * - 留言按人设 + 记忆生成（如「怎么把我删了」），两级生成兜底与跨 App 找同款（/api/chat → forceSdk）；
 * - 用户拒绝（rejected=true）后彻底停止；重新加回好友清空状态，再次删除才重新开始；
 * - 用户同意：恢复好友关系 + 清除删除状态（历史数据恢复可见）。
 * - 刷新页面丢失的定时器由 runFriendReqCatchUp（微信/QQ 挂载时调用）立刻补跑。
 */

import { kvGet, kvSet, kvDel } from './idb-kv';
import { genId } from './db';
import { getContact, ownerProfileFor, setAppFriendFlag } from './contacts-store';
import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import { useSettings } from './store';
import { BLOCK_CHANNEL } from './block-state';
import { buildPersonaSystemPrompt } from './persona';
import { getMemSettings, memRecallBlock } from '@/lib/memory';
import { buildTimeAwareBlock } from '@/lib/time-aware';
import { cleanBubbleText } from '@/lib/chat-rich';

/** 拥有「删除好友」能力的 App（微信 / QQ；信息 App 无好友概念） */
export type FriendDelApp = 'wx' | 'qq';

/** 删除状态（有键 = 已删除好友；字段全部可选向后兼容） */
export interface FriendDelState {
  /** 删除时间 */
  at: number;
  /** @deprecated AI 最近一次申请加回的时间（冷却已按用户要求移除，仅兼容旧存量数据，不再读写） */
  lastReqAt?: number;
  /** 用户拒绝过 AI 的申请（拒绝后停止申请；重新加回好友清空） */
  rejected?: boolean;
}

const delKey = (app: FriendDelApp, contactId: string) => `friend-del:${app}:${contactId}`;

/** 该联系人是否已被我在此 App 删除好友（同步读，渲染/门控随时可调） */
export function isFriendDeleted(app: FriendDelApp, contactId: string): boolean {
  if (!contactId) return false;
  return kvGet<FriendDelState>(delKey(app, contactId)) != null;
}

/** 删除状态详情（无 = 未删除） */
export function friendDelStateOf(app: FriendDelApp, contactId: string): FriendDelState | null {
  if (!contactId) return null;
  const v = kvGet<FriendDelState>(delKey(app, contactId));
  return v && typeof v === 'object' && typeof v.at === 'number' ? v : null;
}

/** 删除状态索引（idb-kv 不提供键枚举；这里维护一份按 App 分组的 id 索引，扫描/补跑用） */
const DEL_INDEX_KEY = 'friend-del-index';

function readDelIndex(): Record<FriendDelApp, string[]> {
  const raw = kvGet<Partial<Record<FriendDelApp, string[]>>>(DEL_INDEX_KEY);
  return {
    wx: Array.isArray(raw?.wx) ? raw.wx.filter((x) => typeof x === 'string') : [],
    qq: Array.isArray(raw?.qq) ? raw.qq.filter((x) => typeof x === 'string') : [],
  };
}

function writeDelIndex(app: FriendDelApp, contactId: string, present: boolean): void {
  const idx = readDelIndex();
  const list = idx[app];
  const has = list.includes(contactId);
  if (present && !has) idx[app] = [...list, contactId];
  else if (!present && has) idx[app] = list.filter((x) => x !== contactId);
  else return;
  kvSet(DEL_INDEX_KEY, idx);
}

/** 此 App 内处于「已删除好友」状态的联系人 id 列表 */
export function deletedFriendIds(app: FriendDelApp): string[] {
  return readDelIndex()[app].filter((id) => friendDelStateOf(app, id) != null);
}

/**
 * 删除好友（由 UI 二次确认后调用）：
 * - 写入删除状态（at=删除时间）；
 * - 关闭好友关系（friendWx/friendQq=false；会话列表/通讯录即时消失）；
 * - 立刻调度 AI 主动申请加回（无冷却；留言生成完成即出现在 新的朋友/好友通知）。
 * 不清理任何数据（聊天记录/记忆/朋友圈/通话记录全部保留）。
 */
export async function removeFriendByUser(app: FriendDelApp, contactId: string): Promise<boolean> {
  const c = await getContact(contactId).catch(() => null);
  if (!c || c.kind === 'user') return false;
  kvSet(delKey(app, contactId), { at: Date.now() } satisfies FriendDelState);
  writeDelIndex(app, contactId, true);
  try {
    // 多账号 Task 41：删除标记落当前账号作用域（大号同步旧标记），不影响其他账号的好友关系
    await setAppFriendFlag(app, contactId, false);
  } catch {
    // 联系人更新失败不阻塞状态标记（下次删除重写）
  }
  scheduleCharReAddReq(app, contactId);
  return true;
}

/** 重新加回好友（手动搜索添加 / 同意 AI 申请共用）：清除删除状态 → 历史数据恢复可见 */
export async function restoreFriendship(app: FriendDelApp, contactId: string): Promise<void> {
  kvDel(delKey(app, contactId));
  writeDelIndex(app, contactId, false);
  try {
    // 多账号 Task 41：好友标记落当前账号作用域（大号同步旧标记）
    await setAppFriendFlag(app, contactId, true);
  } catch {
    // 联系人可能已被从联系人 App 彻底删除：申请状态仍流转，UI 层提示
  }
}

/**
 * 删过好友且微信/QQ 两端都不再是好友 = 该联系人对用户「整体不可见」：
 * 电话通话记录 / 记忆库等全局面用这个口径隐藏；重新加回任一端即恢复。
 * 从未删过好友的联系人恒为 false（不打扰既有效果）。
 */
export async function isPersonGoneEverywhere(contactId: string): Promise<boolean> {
  if (!contactId) return false;
  const wx = friendDelStateOf('wx', contactId);
  const qq = friendDelStateOf('qq', contactId);
  if (!wx && !qq) return false;
  const c = await getContact(contactId).catch(() => null);
  if (!c || c.kind === 'user') return false;
  const friendWx = c.friendWx === true || (c.friendWx === undefined && c.isFriend === true);
  const friendQq = c.friendQq === true || (c.friendQq === undefined && c.isFriend === true);
  return !friendWx && !friendQq;
}

// ---------------- 好友申请列表（新的朋友 / 好友通知共用数据源） ----------------

/** 申请条目（wx-friend-reqs / qq-friend-reqs；旧微信条目无 status/contactId 归一化兼容） */
export interface FriendReqEntry {
  /** 申请 id（新条目 genId；微信旧数据沿用联系人 id 作条目 id，避免破坏既有 testid） */
  id: string;
  /** 联系人 id（旧微信条目缺省 = 同 id 字段） */
  contactId?: string;
  /** 展示名快照（申请时刻的备注/昵称/名字） */
  name: string;
  /** 头像快照（渲染端可再实时解析） */
  avatar: string | null;
  /** 验证消息 / 对方留言 */
  message: string;
  /** 申请时间 */
  time: number;
  /** 状态：pending=待处理 accepted=已同意 rejected=已拒绝；旧数据无此字段 = accepted */
  status?: 'pending' | 'accepted' | 'rejected';
  /** 来源：朋友验证消息 / 搜索账号添加 / 手机联系人 / QQ号查找 等 */
  source?: string;
  /** true = AI（对方）主动发起的加回申请 */
  fromChar?: boolean;
  /** 申请附加信息（申请添加朋友页收集：图片/标签/备忘/照片/朋友权限/朋友圈可见性） */
  extras?: FriendReqExtras;
  /** 验证消息多轮对话（我/对方 交替；详情页展示与「回复」续写；旧数据无此字段 = 单条 message） */
  thread?: FriendReqThreadMsg[];
}

/** 验证消息线程里的一条发言（who=me 用户发 / who=peer 对方发） */
export interface FriendReqThreadMsg {
  who: 'me' | 'peer';
  text: string;
  time: number;
}

export interface FriendReqExtras {
  /** 打招呼附图（data URL，压缩后 ≤200KB） */
  image?: string | null;
  /** 申请时设置的对方备注 */
  remark?: string | null;
  /** 标签 */
  tags?: string[];
  /** 备忘 */
  memo?: string | null;
  /** 照片（对方资料照片，data URL，≤4 张） */
  photos?: string[];
  /** 朋友权限：聊天 */
  permChat?: boolean;
  /** 朋友权限：朋友圈 */
  permMoments?: boolean;
  /** 朋友权限：微信运动 */
  permExercise?: boolean;
  /** 不让他看我的朋友圈和状态 */
  hideMine?: boolean;
  /** 不看他(她)的朋友圈和状态 */
  hideTheirs?: boolean;
}

const REQ_LS_KEY: Record<FriendDelApp, string> = { wx: 'wx-friend-reqs', qq: 'qq-friend-reqs' };
export const SOURCE_CHAR_REQ = '朋友验证消息';
export const SOURCE_SEARCH_WX = '搜索账号添加';
export const SOURCE_SEARCH_QQ = 'QQ号查找';

function normalizeReq(r: Partial<FriendReqEntry>): FriendReqEntry | null {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.time !== 'number' || !isFinite(r.time)) return null;
  const status = r.status === 'pending' || r.status === 'rejected' ? r.status : 'accepted';
  const contactId = typeof r.contactId === 'string' && r.contactId ? r.contactId : r.id;
  return {
    id: r.id,
    contactId,
    name: typeof r.name === 'string' ? r.name : '对方',
    avatar: typeof r.avatar === 'string' ? r.avatar : null,
    message: typeof r.message === 'string' ? r.message : '',
    time: r.time,
    status,
    source: typeof r.source === 'string' && r.source ? r.source : status === 'accepted' ? undefined : SOURCE_CHAR_REQ,
    fromChar: r.fromChar === true,
    extras:
      r.extras && typeof r.extras === 'object'
        ? {
            image: typeof r.extras.image === 'string' ? r.extras.image : null,
            remark: typeof r.extras.remark === 'string' ? r.extras.remark : null,
            tags: Array.isArray(r.extras.tags) ? r.extras.tags.filter((t) => typeof t === 'string').slice(0, 6) : [],
            memo: typeof r.extras.memo === 'string' ? r.extras.memo : null,
            photos: Array.isArray(r.extras.photos) ? r.extras.photos.filter((t) => typeof t === 'string').slice(0, 4) : [],
            permChat: r.extras.permChat !== false,
            permMoments: r.extras.permMoments !== false,
            permExercise: r.extras.permExercise !== false,
            hideMine: r.extras.hideMine === true,
            hideTheirs: r.extras.hideTheirs === true,
          }
        : undefined,
    thread: normalizeThread(r.thread),
  };
}

function normalizeThread(raw: unknown): FriendReqThreadMsg[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list: FriendReqThreadMsg[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const m = x as Partial<FriendReqThreadMsg>;
    if (typeof m.text !== 'string' || !m.text.trim()) continue;
    list.push({
      who: m.who === 'me' ? 'me' : 'peer',
      text: m.text,
      time: typeof m.time === 'number' && isFinite(m.time) ? m.time : Date.now(),
    });
  }
  return list.length > 0 ? list.slice(-30) : undefined;
}

export function loadFriendReqs(app: FriendDelApp): FriendReqEntry[] {
  // 存储层与微信既有 loadReqs 同源：IndexedDB kv（wx-friend-reqs 原本就在 idb-kv 迁移清单里，
  // 写 localStorage 会在下次启动被迁移器搬进 kv 并清键——必须直接走 kvGet/kvSet）
  const raw = kvGet<unknown>(REQ_LS_KEY[app]);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => normalizeReq(x as Partial<FriendReqEntry>))
    .filter((x): x is FriendReqEntry => x !== null)
    .sort((a, b) => b.time - a.time)
    .slice(0, 100);
}

export function saveFriendReqs(app: FriendDelApp, list: FriendReqEntry[]): void {
  kvSet(REQ_LS_KEY[app], list.slice(0, 100));
  try {
    window.dispatchEvent(new CustomEvent(FRIEND_REQS_EVENT, { detail: { app } }));
  } catch {
    // 忽略
  }
}

/** 追加一条申请（去重：同一联系人同一时刻只留一条 pending 的 AI 申请） */
export function addFriendReq(app: FriendDelApp, entry: FriendReqEntry): void {
  const list = loadFriendReqs(app);
  if (entry.fromChar) {
    const dup = list.find((r) => r.contactId === entry.contactId && r.status === 'pending');
    if (dup) return;
  }
  saveFriendReqs(app, [entry, ...list.filter((r) => !(entry.fromChar && r.id === entry.id))]);
}

/** 按条目 id 局部更新申请（thread 回复/欢迎回复等；变更广播给订阅方） */
export function updateFriendReq(app: FriendDelApp, reqId: string, patch: Partial<FriendReqEntry>): void {
  const list = loadFriendReqs(app);
  if (!list.some((r) => r.id === reqId)) return;
  saveFriendReqs(
    app,
    list.map((r) => (r.id === reqId ? { ...r, ...patch } : r)),
  );
}

/** 往验证消息线程追加一条发言（thread 不存在时自动以 message 起始建线程） */
export function appendReqThread(app: FriendDelApp, reqId: string, msg: FriendReqThreadMsg): void {
  const list = loadFriendReqs(app);
  const hit = list.find((r) => r.id === reqId);
  if (!hit) return;
  const base: FriendReqThreadMsg[] =
    hit.thread && hit.thread.length > 0
      ? hit.thread
      : hit.message.trim()
        ? [{ who: hit.fromChar ? 'peer' : 'me', text: hit.message, time: hit.time }]
        : [];
  updateFriendReq(app, reqId, { thread: [...base, msg].slice(-30) });
}

/** 更新申请状态 */
export function setFriendReqStatus(app: FriendDelApp, reqId: string, status: 'pending' | 'accepted' | 'rejected'): void {
  const list = loadFriendReqs(app);
  const hit = list.find((r) => r.id === reqId);
  if (!hit || hit.status === status) return;
  saveFriendReqs(
    app,
    list.map((r) => (r.id === reqId ? { ...r, status } : r)),
  );
}

/** 拒绝 AI 的加回申请：条目置 rejected + 删除状态标记 rejected（AI 彻底停止申请，
 *  重新加回好友时状态被 restoreFriendship 清除才会重新开始） */
export function rejectFriendReq(app: FriendDelApp, reqId: string): void {
  const list = loadFriendReqs(app);
  const hit = list.find((r) => r.id === reqId);
  setFriendReqStatus(app, reqId, 'rejected');
  if (!hit) return;
  const cid = hit.contactId ?? hit.id;
  const st = friendDelStateOf(app, cid);
  if (st && !st.rejected) kvSet(delKey(app, cid), { ...st, rejected: true } satisfies FriendDelState);
}

/** 同联系人是否存在待处理的申请 */
export function hasPendingReqFor(app: FriendDelApp, contactId: string): boolean {
  return loadFriendReqs(app).some((r) => r.contactId === contactId && r.status === 'pending');
}

/** 申请列表变更事件（微信/QQ 页面订阅后重读列表） */
export const FRIEND_REQS_EVENT = 'friend-reqs-changed';

export function subscribeFriendReqs(fn: () => void): () => void {
  const handler = () => fn();
  window.addEventListener(FRIEND_REQS_EVENT, handler);
  return () => window.removeEventListener(FRIEND_REQS_EVENT, handler);
}

// ---------------- AI 主动申请加回 ----------------

/** 删除后第一次申请的延迟：0 = 确认删除后立刻发起（无冷却；留言生成完成即出现在列表） */
export const FIRST_REQ_DELAY_MS = 0;

const reqTimers = new Map<string, number>();

/** 调度一次 AI 申请检查（删除后调用；刷新后由 runFriendReqCatchUp 补跑） */
export function scheduleCharReAddReq(app: FriendDelApp, contactId: string, delayMs = FIRST_REQ_DELAY_MS): void {
  if (typeof window === 'undefined') return;
  const key = `${app}:${contactId}`;
  const prev = reqTimers.get(key);
  if (prev) window.clearTimeout(prev);
  const timer = window.setTimeout(() => {
    reqTimers.delete(key);
    void maybeCharReAddReq(app, contactId);
  }, Math.max(0, delayMs));
  reqTimers.set(key, timer);
}

/** 启动补跑：微信/QQ 挂载时调用——扫描全部删除状态，无待处理申请的立刻补跑（定时器不跨刷新） */
export function runFriendReqCatchUp(): void {
  for (const app of ['wx', 'qq'] as FriendDelApp[]) {
    for (const id of deletedFriendIds(app)) {
      const st = friendDelStateOf(app, id);
      if (!st || st.rejected) continue; // 用户拒绝过：彻底不再申请
      // 无冷却：已删除好友且无待处理申请就立刻补发（maybeCharReAddReq 内有 pending 去重守卫）
      scheduleCharReAddReq(app, id, 0);
    }
  }
}

/** 按状态检查并生成一条 AI 加回申请（全部守卫通过才生成；无冷却，pending 去重防重复） */
export async function maybeCharReAddReq(app: FriendDelApp, contactId: string): Promise<void> {
  const st = friendDelStateOf(app, contactId);
  if (!st) return; // 已重新加回（状态清空）
  if (st.rejected) return; // 用户拒绝过：停止申请
  if (hasPendingReqFor(app, contactId)) return; // 已有待处理申请（同一联系人同时只一条）
  const contact = await getContact(contactId).catch(() => null);
  if (!contact || contact.kind === 'user') return;
  if (!(contact.persona ?? '').trim()) return; // 没人设的角色不生成（与主动来电候选同口径）

  const message = await genCharReqMessage(app, contact);
  if (!message) return;

  // 生成期间用户可能已重新加回（状态被清）→ 复核
  if (!friendDelStateOf(app, contactId)) return;
  addFriendReq(app, {
    id: genId(),
    contactId,
    name: displayNameOf(contact),
    avatar: contact.avatar,
    message,
    time: Date.now(),
    status: 'pending',
    source: SOURCE_CHAR_REQ,
    fromChar: true,
  });

  // AI 验证消息同步落聊天记录（kind=text + fr='greet'）：聊天界面渲染「以上是打招呼的内容」标注，
  // 用户同意后进入聊天可见（验证消息持久保留，重启不丢）；写入失败不影响申请本身
  try {
    const chatKey = `${app === 'wx' ? 'wx-chat-msgs:' : 'qq-chat-msgs:'}${contactId}`;
    const existing = kvGet<unknown[]>(chatKey);
    const list = Array.isArray(existing) ? [...existing] : [];
    list.push({ id: genId(), role: 'peer', content: message, time: Date.now(), kind: 'text', fr: 'greet' });
    kvSet(chatKey, list.slice(app === 'wx' ? -100 : -200));
  } catch {
    // 忽略：聊天记录不可写时申请仍有效
  }
}

/** 组 system prompt：人设 + 记忆 + 时间感知（与聊天/跨 App 找同源模块）；scene = 场景附加规则 */
async function buildReqSystem(
  app: FriendDelApp,
  contact: ContactRecord,
  userName: string,
  userRealName: string | null,
  userNickname: string | null,
  scene: 'apply' | 'reply' | 'welcome' = 'apply',
): Promise<string> {
  const sceneRules: Record<'apply' | 'reply' | 'welcome', string[]> = {
    apply: ['你要输出一条好友申请的验证留言，不是聊天消息。'],
    reply: ['你们正在「好友申请的验证消息」里对话（还不是好友/刚恢复好友），你要回复对方刚发的验证消息，不是聊天消息。'],
    welcome: ['对方刚通过了你的好友申请并打了一句招呼，你在「好友申请的验证消息」里回一句，不是聊天消息。'],
  };
  const persona = buildPersonaSystemPrompt(contact, {
    channel: BLOCK_CHANNEL[app],
    userName: userName || null,
    userRealName,
    userNickname,
    multiApp: getMemSettings(contact.id).share,
    extraRules: sceneRules[scene],
  });
  const memoryBlock = memRecallBlock(contact.id, app, '');
  const timeBlock = buildTimeAwareBlock({ lastMsgTime: null, regionHint: contact.region || null });
  return [persona, memoryBlock, timeBlock].filter(Boolean).join('\n\n');
}

/** 生成申请留言清洗：剥标记/动作/多行，验证留言要短（≤60 字） */
function cleanReqMessage(raw: string): string {
  let t = (raw ?? '').replace(/\[[^\][]*\]/g, ' ');
  t = cleanBubbleText(t).trim();
  t = t.replace(/\s*\n+\s*/g, ' ').trim();
  return t.slice(0, 60);
}

/** 两级兜底 LLM 调用（用户配置链路 → 内置模型；与跨 App 找同款） */
async function callLlmTwoTier(system: string, userContent: string): Promise<string> {
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        ...extra,
      }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  let raw = '';
  try {
    raw = await call({ config: useSettings.getState().apiConfig });
    if (!raw.trim()) {
      try {
        raw = await call({ forceSdk: true });
      } catch {
        raw = '';
      }
    }
  } catch {
    return '';
  }
  return raw;
}

/** 按人设 + 记忆生成一条「被删好友想加回来」的验证留言 */
async function genCharReqMessage(app: FriendDelApp, contact: ContactRecord): Promise<string | null> {
  // 多账号 v2：机主资料按删除事件所属 App（wx/qq）的当前账号取
  const owner = await ownerProfileFor(app).catch(() => null);
  const userRealName = owner?.realName?.trim() || null;
  const userNickname = owner?.nickname?.trim() || null;
  const userName = userNickname || userRealName || '用户';
  const channel = BLOCK_CHANNEL[app];

  const system = await buildReqSystem(app, contact, userName, userRealName, userNickname);
  const userContent = [
    `【重要情境】你发现你被「${userName}」删除了好友（${channel}上你们已经不是好友了）。`,
    `- 你很难过/意外/生气（按你的人设和你们的关系来），你决定发一条好友申请把 TA 加回来。`,
    `- 写这条申请的验证留言：一句话，30 字以内，符合你的人设和说话风格（质问「怎么把我删了」、委屈、赌气、装作若无其事、撒娇都可以）。`,
    `- 可以结合你们之间真实发生过的事（记忆），让这句话有来处。`,
    `只输出这条留言本身：不要任何 [标记]、不要动作描写、不要括号说明、不要分多条。`,
  ].join('\n');

  const text = cleanReqMessage(await callLlmTwoTier(system, userContent));
  return text || null;
}

/** 取机主称呼三元组（线程回复生成共用；v2 多账号：按所属 App 当前账号取「我」的资料） */
async function ownerTriplet(
  app: FriendDelApp,
): Promise<{ userName: string; userRealName: string | null; userNickname: string | null }> {
  const owner = await ownerProfileFor(app).catch(() => null);
  const userRealName = owner?.realName?.trim() || null;
  const userNickname = owner?.nickname?.trim() || null;
  const userName = userNickname || userRealName || '用户';
  return { userName, userRealName, userNickname };
}

/**
 * 验证消息线程里生成对方的回复（人设 + 记忆 + 时间感知）：
 * - 场景 reply：用户在待处理申请的验证消息里回复了 AI（如「你谁？」）；
 * - 场景 welcome：用户申请加好友被通过后（本应用即通），AI 在验证消息里回一句欢迎/回应。
 * 返回清洗后的回复文本（失败返回 null，调用方静默跳过——用户消息已在线程里，不丢）。
 */
export async function genCharThreadReply(
  app: FriendDelApp,
  contact: ContactRecord,
  thread: FriendReqThreadMsg[],
  scene: 'reply' | 'welcome',
): Promise<string | null> {
  if (!(contact.persona ?? '').trim()) return null;
  const { userName, userRealName, userNickname } = await ownerTriplet(app);
  const system = await buildReqSystem(app, contact, userName, userRealName, userNickname, scene);
  const lines = thread.slice(-8).map((m) => `${m.who === 'me' ? userName : contactRealNameSafe(contact)}：${m.text}`);
  const ask =
    scene === 'reply'
      ? [
        `【重要情境】你向「${userName}」发了一条好友申请，你们现在还不是好友，正在申请的验证消息里对话。`,
        `以下是目前的对话记录：`,
        ...lines,
        ``,
        `请以你的身份回复最后一条「${userName}」的话：一句话，30 字以内，符合你的人设和说话风格。`,
        `只输出这句回复本身：不要任何 [标记]、不要动作描写、不要括号说明、不要分多条。`,
      ].join('\n')
      : [
        `【重要情境】「${userName}」刚刚加你为好友（${BLOCK_CHANNEL[app]}），验证消息是：`,
        ...lines,
        ``,
        `请以你的身份回一句（像通过好友后第一句打招呼）：一句话，30 字以内，符合你的人设和说话风格。`,
        `只输出这句回复本身：不要任何 [标记]、不要动作描写、不要括号说明、不要分多条。`,
      ].join('\n');
  const text = cleanReqMessage(await callLlmTwoTier(system, ask));
  return text || null;
}

/** 线程展示用对方名字（备注/昵称优先，联系人在册才用真实名字；此函数不落记忆，无污染面） */
function contactRealNameSafe(contact: ContactRecord): string {
  return displayNameOf(contact) || contact.name || '对方';
}

/**
 * 用户申请加为好友（发送即通过）后，AI 在验证消息线程里回一句欢迎（一次性）：
 * 线程里已有对方发言则跳过；无人设/生成失败静默；由 UI fire-and-forget 调用。
 */
export async function charWelcomeReplyToApply(app: FriendDelApp, reqId: string, contactId: string, greeting: string): Promise<void> {
  const list = loadFriendReqs(app);
  const hit = list.find((r) => r.id === reqId);
  if (!hit) return;
  const base: FriendReqThreadMsg[] =
    hit.thread && hit.thread.length > 0
      ? hit.thread
      : [{ who: 'me', text: greeting, time: hit.time }];
  if (base.some((m) => m.who === 'peer')) return; // 已回过（一次性）
  const contact = await getContact(contactId).catch(() => null);
  if (!contact || contact.kind === 'user') return;
  const reply = await genCharThreadReply(app, contact, base, 'welcome');
  if (!reply) return;
  // 生成期间条目可能已被替换/删除 → 复核仍在且仍无对方发言
  const fresh = loadFriendReqs(app).find((r) => r.id === reqId);
  if (!fresh) return;
  const cur: FriendReqThreadMsg[] = fresh.thread && fresh.thread.length > 0 ? fresh.thread : base;
  if (cur.some((m) => m.who === 'peer')) return;
  updateFriendReq(app, reqId, { thread: [...cur, { who: 'peer' as const, text: reply, time: Date.now() }].slice(-30) });
}
