/**
 * 群聊数据层（当前宿主：微信）。
 *
 * 设计要点：
 * - 群 = ChatGroup：独立会话实体（非联系人），成员是 AI 角色（char/npc）联系人 ID，机主固定参与；
 * - 会话身份 sessionKey = `wx:group:<id>`（复用流总线/未读/标志/时间感知等按字符串键隔离的设施）；
 * - 消息 = WxGroupMsg：在私聊消息形状上增加 senderId/senderName（谁是发的），落 `wx-group-msgs:<id>`；
 * - 记忆互通开关 memoryInterop 按群独立：开启时群记忆参与成员角色的私聊召回、角色私聊记忆参与群聊召回；
 *   角色之间的隔离永远由记忆存储键（mem-frag:<contactId>）保证，与本开关无关；
 * - 群里不提供任何真实资金操作（无红包/转账/亲属卡），符合范围限定。
 */

import { kvDel, kvGet, kvSet } from './idb-kv';
import { genId } from './db';

// ---------------- 类型 ----------------

export interface ChatGroup {
  id: string;
  /** 宿主 App（当前仅微信） */
  app: 'wx';
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

const GROUPS_KEY = 'wx-chat-groups';
const MSGS_CAP = 200;

const groupMsgsKey = (groupId: string) => `wx-group-msgs:${groupId}`;

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

export function listGroups(): ChatGroup[] {
  const raw = readJSON<ChatGroup[]>(GROUPS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((g) => g && typeof g.id === 'string' && Array.isArray(g.memberIds));
}

export function getGroup(groupId: string): ChatGroup | null {
  return listGroups().find((g) => g.id === groupId) ?? null;
}

function writeGroups(list: ChatGroup[]): void {
  writeJSON(GROUPS_KEY, list);
}

export function createGroup(input: { name: string; memberIds: string[]; ownerId: string; avatar?: string | null; announcement?: string }): ChatGroup {
  const group: ChatGroup = {
    id: genId(),
    app: 'wx',
    name: input.name.trim() || '未命名群聊',
    avatar: input.avatar ?? null,
    ownerId: input.ownerId,
    memberIds: Array.from(new Set(input.memberIds)),
    announcement: input.announcement?.trim() ?? '',
    memoryInterop: false,
    createdAt: Date.now(),
  };
  writeGroups([...listGroups(), group]);
  return group;
}

/** 更新群（名字/头像/公告/互通开关等）；返回更新后的群（群不存在返回 null） */
export function updateGroup(groupId: string, patch: Partial<Pick<ChatGroup, 'name' | 'avatar' | 'announcement' | 'memoryInterop' | 'memberIds'>>): ChatGroup | null {
  const list = listGroups();
  const idx = list.findIndex((g) => g.id === groupId);
  if (idx === -1) return null;
  const next: ChatGroup = { ...list[idx], ...patch };
  if (patch.name !== undefined) next.name = patch.name.trim() || next.name;
  list[idx] = next;
  writeGroups(list);
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
  const list = listGroups();
  const g = list.find((x) => x.id === groupId);
  if (!g) return null;
  writeGroups(list.filter((x) => x.id !== groupId));
  try {
    kvDel(groupMsgsKey(groupId));
    // 未读/标志/隐藏为 localStorage JSON map（键 = 会话 id；群会话 id = `group:<gid>`）
    removeLocalMapKey('wx-chat-unreads', `group:${groupId}`);
    removeLocalMapKey('wx-chat-flags', `group:${groupId}`);
    removeLocalMapKey('wx-chat-hidden', `group:${groupId}`);
    // 时间感知开关（localStorage map 里的键）
    removeLocalMapKey('chat-time-aware', `wx:group:${groupId}`);
    // 每个成员的群记忆提取轮次计数（mem-round:<contactId>:wx:group:<gid>）
    for (const cid of g.memberIds) {
      kvDel(`mem-round:${cid}:wx:group:${groupId}`);
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
  const raw = readJSON<WxGroupMsg[]>(groupMsgsKey(groupId));
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeMsg).filter((m): m is WxGroupMsg => m != null);
}

/** 落盘（保留最后 200 条，与私聊同量级） */
export function saveGroupMsgs(groupId: string, msgs: WxGroupMsg[]): void {
  writeJSON(groupMsgsKey(groupId), msgs.slice(-MSGS_CAP));
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
