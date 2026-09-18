/**
 * 群聊数据层（宿主：微信 / QQ 双 App）。
 *
 * 设计要点：
 * - 群 = ChatGroup：独立会话实体（非联系人），成员是 AI 角色（char/npc）联系人 ID，机主固定参与；
 * - 会话身份 sessionKey = `<app>:group:<id>`（复用流总线/未读/标志/时间感知等按字符串键隔离的设施）；
 * - 存储：微信群 `wx-chat-groups`（历史数据兼容）、QQ 群 `qq-chat-groups` 两池分开，群 id 全局唯一，
 *   getGroup 双池查找；消息落 `<app>-group-msgs:<id>`（微信群沿用历史 wx-group-msgs 前缀）；
 * - 记忆互通开关 memoryInterop 按群独立：开启时群记忆参与成员角色的私聊召回、角色私聊记忆参与群聊召回；
 *   memberInterop 可按成员覆盖（'on' 强制互通 / 'off' 强制隔离，缺省跟随群开关）——「开关按群或按角色设置」；
 *   effectiveInterop 统一解析，聊天页把结果以 interopOn 回调传给记忆召回；
 *   角色之间的隔离永远由记忆存储键（mem-frag:<contactId>）保证，与开关无关；
 * - replyPolicy 决定谁来回复（决定是否回复的需求）：'all' 全员按顺序回复（默认，兼容旧行为）/
 *   'mention' 仅被 @ 成员回复 / 'auto' 每个角色自判是否发言（返回 [SKIP] 的回复不落盘）；
 * - 群里不提供任何真实资金操作（无红包/转账/亲属卡），符合范围限定。
 */

import { kvDel, kvGet, kvSet } from './idb-kv';
import { genId } from './db';

// ---------------- 类型 ----------------

export type GroupApp = 'wx' | 'qq';

/** 谁来回复：'all' 全员按顺序回复（默认）/'mention' 仅被 @ 成员/'auto' AI 自判（无话可说返回 [SKIP]） */
export type GroupReplyPolicy = 'all' | 'mention' | 'auto';

export interface ChatGroup {
  id: string;
  /** 宿主 App（微信 / QQ） */
  app: GroupApp;
  name: string;
  /** 群头像 dataURL；空 = 用成员头像拼贴渲染 */
  avatar: string | null;
  /** 创建者（机主）联系人 ID */
  ownerId: string;
  /** AI 角色成员联系人 ID（不含机主；机主恒为群成员） */
  memberIds: string[];
  announcement: string;
  /** 记忆与私聊互通（按群独立；默认关闭 = 群记忆与私聊完全隔离） */
  memoryInterop: boolean;
  /** 按成员覆盖互通：'on' 强制互通 / 'off' 强制隔离；缺省 = 跟随 memoryInterop（按角色设置开关） */
  memberInterop?: Record<string, 'on' | 'off'>;
  /** 谁来回复（缺省 'all'） */
  replyPolicy?: GroupReplyPolicy;
  createdAt: number;
}

/** 群消息：role 沿用 me/peer 语义，senderId 区分具体发言人（'me' = 机主，否则为角色联系人 ID） */
export interface WxGroupMsg {
  id: string;
  role: 'me' | 'peer';
  senderId: string;
  senderName: string;
  content: string;
  time: number;
  kind?: 'text' | 'notice' | 'image';
  /** 系统通知行（进群/退出等），居中灰字渲染 */
  noticeText?: string;
  img?: { src: string };
  quote?: { name: string; content: string };
  recalled?: boolean;
}

// ---------------- 存储（IndexedDB kv 写穿层，与消息/记忆同款） ----------------

/** 两个宿主各自的群池（微信群沿用历史键，QQ 独立新键） */
const POOLS: Record<GroupApp, string> = { wx: 'wx-chat-groups', qq: 'qq-chat-groups' };
const MSGS_CAP = 200;

/** 会话级 localStorage map 键（未读/标志/隐藏）：按宿主区分，解散群时同构清理 */
const LS_MAPS: Record<GroupApp, { unreads: string; flags: string; hidden: string }> = {
  wx: { unreads: 'wx-chat-unreads', flags: 'wx-chat-flags', hidden: 'wx-chat-hidden' },
  qq: { unreads: 'qq-chat-unreads', flags: 'qq-chat-flags', hidden: 'qq-chat-hidden' },
};

const groupMsgsKey = (app: GroupApp, groupId: string) => `${app}-group-msgs:${groupId}`;

function readJSON<T>(key: string): T | null {
  try {
    return kvGet<T>(key);
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    kvSet(key, value);
  } catch {
    // 存储失败不中断（群是增强能力）
  }
}

// ---------------- 群 CRUD ----------------

function normalizeGroup(g: unknown): ChatGroup | null {
  if (!g || typeof g !== 'object') return null;
  const r = g as Partial<ChatGroup>;
  if (typeof r.id !== 'string' || !Array.isArray(r.memberIds)) return null;
  return {
    id: r.id,
    app: r.app === 'qq' ? 'qq' : 'wx',
    name: typeof r.name === 'string' ? r.name : '未命名群聊',
    avatar: typeof r.avatar === 'string' ? r.avatar : null,
    ownerId: typeof r.ownerId === 'string' ? r.ownerId : '',
    memberIds: r.memberIds.filter((x): x is string => typeof x === 'string'),
    announcement: typeof r.announcement === 'string' ? r.announcement : '',
    memoryInterop: r.memoryInterop === true,
    memberInterop: r.memberInterop && typeof r.memberInterop === 'object' ? r.memberInterop : undefined,
    replyPolicy: r.replyPolicy === 'mention' || r.replyPolicy === 'auto' ? r.replyPolicy : undefined,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
  };
}

function readPool(app: GroupApp): ChatGroup[] {
  const raw = readJSON<ChatGroup[]>(POOLS[app]);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeGroup).filter((g): g is ChatGroup => g != null);
}

function writePool(app: GroupApp, list: ChatGroup[]): void {
  writeJSON(POOLS[app], list);
}

/** 全部群（双宿主；app 传参时只看该宿主） */
export function listGroups(app?: GroupApp): ChatGroup[] {
  if (app) return readPool(app);
  return [...readPool('wx'), ...readPool('qq')];
}

export function getGroup(groupId: string): ChatGroup | null {
  return listGroups().find((g) => g.id === groupId) ?? null;
}

export function createGroup(input: {
  name: string;
  memberIds: string[];
  ownerId: string;
  /** 宿主 App（缺省 wx，兼容旧调用） */
  app?: GroupApp;
  avatar?: string | null;
  announcement?: string;
}): ChatGroup {
  const app: GroupApp = input.app ?? 'wx';
  const group: ChatGroup = {
    id: genId(),
    app,
    name: input.name.trim() || '未命名群聊',
    avatar: input.avatar ?? null,
    ownerId: input.ownerId,
    memberIds: Array.from(new Set(input.memberIds)),
    announcement: input.announcement?.trim() ?? '',
    memoryInterop: false,
    createdAt: Date.now(),
  };
  writePool(app, [...readPool(app), group]);
  return group;
}

/** 更新群（名字/头像/公告/互通开关/按成员覆盖/回复策略/成员等）；返回更新后的群（群不存在返回 null） */
export function updateGroup(
  groupId: string,
  patch: Partial<Pick<ChatGroup, 'name' | 'avatar' | 'announcement' | 'memoryInterop' | 'memberInterop' | 'replyPolicy' | 'memberIds'>>
): ChatGroup | null {
  const app = getGroup(groupId)?.app;
  if (!app) return null;
  const list = readPool(app);
  const idx = list.findIndex((g) => g.id === groupId);
  if (idx === -1) return null;
  const next: ChatGroup = { ...list[idx], ...patch };
  if (patch.name !== undefined) next.name = patch.name.trim() || next.name;
  list[idx] = next;
  writePool(app, list);
  return next;
}

export function addGroupMember(groupId: string, contactId: string): ChatGroup | null {
  const g = getGroup(groupId);
  if (!g || g.memberIds.includes(contactId)) return g ?? null;
  return updateGroup(groupId, { memberIds: [...g.memberIds, contactId] });
}

export function removeGroupMember(groupId: string, contactId: string): ChatGroup | null {
  const g = getGroup(groupId);
  if (!g) return null;
  return updateGroup(groupId, { memberIds: g.memberIds.filter((id) => id !== contactId) });
}

/**
 * 该群该成员的记忆互通最终生效值：memberInterop 覆盖优先，缺省跟随群开关。
 * （「开关按群或按角色设置」的统一解析；群不存在一律视为隔离。）
 */
export function effectiveInterop(groupId: string, contactId: string): boolean {
  const g = getGroup(groupId);
  if (!g) return false;
  const ov = g.memberInterop?.[contactId];
  if (ov === 'on') return true;
  if (ov === 'off') return false;
  return g.memoryInterop === true;
}

/** 该群的回复策略（缺省 'all'，与旧行为一致） */
export function groupReplyPolicy(groupId: string): GroupReplyPolicy {
  return getGroup(groupId)?.replyPolicy ?? 'all';
}

/** 从 localStorage JSON map 里删掉一个键（unreads/flags/hidden/time-aware 同构清理用） */
function removeLocalMapKey(lsKey: string, id: string): void {
  try {
    const raw = localStorage.getItem(lsKey);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, unknown>;
    if (!(id in map)) return;
    delete map[id];
    localStorage.setItem(lsKey, JSON.stringify(map));
  } catch {
    // 忽略
  }
}

/**
 * 解散群聊：删除群 + 群消息 + 会话级附属数据（未读/标志/隐藏/时间感知/每成员的群记忆提取轮次计数）。
 * 返回被解散的群（供 UI 提示），群不存在返回 null。
 */
export function dissolveGroup(groupId: string): ChatGroup | null {
  const g = getGroup(groupId);
  if (!g) return null;
  writePool(g.app, readPool(g.app).filter((x) => x.id !== groupId));
  try {
    kvDel(groupMsgsKey(g.app, groupId));
    // 未读/标志/隐藏为 localStorage JSON map（键 = 会话 id；群会话 id = `group:<gid>`）
    const maps = LS_MAPS[g.app];
    removeLocalMapKey(maps.unreads, `group:${groupId}`);
    removeLocalMapKey(maps.flags, `group:${groupId}`);
    removeLocalMapKey(maps.hidden, `group:${groupId}`);
    // 时间感知开关（localStorage map 里的键）
    removeLocalMapKey('chat-time-aware', `${g.app}:group:${groupId}`);
    // 每个成员的群记忆提取轮次计数（mem-round:<contactId>:<app>:group:<gid>）
    for (const cid of g.memberIds) {
      kvDel(`mem-round:${cid}:${g.app}:group:${groupId}`);
    }
  } catch {
    // 清理失败不阻塞解散
  }
  return g;
}

/** 从所有群中移除某联系人（删除联系人级联）；成员清空的群自动解散。返回受影响的群名（toast 汇总用） */
export function purgeContactFromGroups(contactId: string): string[] {
  const affected: string[] = [];
  for (const g of listGroups()) {
    if (!g.memberIds.includes(contactId)) continue;
    affected.push(g.name);
    const next = g.memberIds.filter((id) => id !== contactId);
    if (next.length === 0) dissolveGroup(g.id);
    else updateGroup(g.id, { memberIds: next });
  }
  return affected;
}

// ---------------- 群消息存取 ----------------

function normalizeMsg(m: unknown): WxGroupMsg | null {
  if (!m || typeof m !== 'object') return null;
  const r = m as Partial<WxGroupMsg>;
  if (typeof r.id !== 'string' || typeof r.content !== 'string' || typeof r.time !== 'number') return null;
  return {
    id: r.id,
    role: r.role === 'me' ? 'me' : 'peer',
    senderId: typeof r.senderId === 'string' ? r.senderId : 'unknown',
    senderName: typeof r.senderName === 'string' ? r.senderName : '',
    content: r.content,
    time: r.time,
    kind: r.kind === 'notice' || r.kind === 'image' ? r.kind : 'text',
    noticeText: typeof r.noticeText === 'string' ? r.noticeText : undefined,
    img: r.img && typeof r.img.src === 'string' ? { src: r.img.src } : undefined,
    quote: r.quote && typeof r.quote.name === 'string' && typeof r.quote.content === 'string' ? { name: r.quote.name, content: r.quote.content } : undefined,
    recalled: r.recalled === true,
  };
}

export function loadGroupMsgs(groupId: string): WxGroupMsg[] {
  const app = getGroup(groupId)?.app ?? 'wx';
  const raw = readJSON<WxGroupMsg[]>(groupMsgsKey(app, groupId));
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeMsg).filter((m): m is WxGroupMsg => m != null);
}

/** 落盘（保留最后 200 条，与私聊同量级） */
export function saveGroupMsgs(groupId: string, msgs: WxGroupMsg[]): void {
  const app = getGroup(groupId)?.app ?? 'wx';
  writeJSON(groupMsgsKey(app, groupId), msgs.slice(-MSGS_CAP));
}

/** 该群最后一条非通知消息（会话列表预览用） */
export function groupPreview(groupId: string): { text: string; time: number } {
  const msgs = loadGroupMsgs(groupId);
  const last = [...msgs].reverse().find((m) => m.kind !== 'notice');
  if (!last) return { text: '', time: 0 };
  if (last.recalled) return { text: `${last.role === 'me' ? '你' : last.senderName || '有人'}撤回了一条消息`, time: last.time };
  if (last.kind === 'image') return { text: '[图片]', time: last.time };
  const prefix = last.role === 'me' ? '我' : last.senderName;
  return { text: `${prefix}：${last.content}`, time: last.time };
}
