/**
 * 联系人本地存储（IndexedDB 'contacts' store）：
 * - 联系人 App / 电话 / 信息 / 微信 四 App 共享同一份本地数据（同一浏览器）
 * - 服务端不再存联系人：增删改查、编号自动生成、微信登录校验、NPC 级联删除全部在本地完成
 * - migrateFromServer()：旧版本把联系人存在服务端 SQLite（按浏览器工作区隔离），
 *   升级后首次加载把「本浏览器工作区」的服务端联系人 + 微信背景图一次性搬进本地，
 *   搬完（全部落库成功后）才通知服务端清空对应数据——先搬后删，中途失败下次重来（put 幂等）
 */
import { localDB, genId } from './db';
import { wsHeaders } from './workspace';
import {
  displayNameOf,
  genPhone,
  genQQ,
  genWechatId,
  isContactKind,
  normalizeAvatar,
  normalizeText,
  type ContactPayload,
  type ContactRecord,
} from '@/lib/contacts';

const MIGRATED_KEY = 'ios-contacts-migrated';

/**
 * 申请持久化存储权限：联系人/微信账号现在只存本地 IndexedDB，
 * 不申请的话浏览器在磁盘压力下可能不经询问清掉数据（eviction）。
 * 在启动时（首次用户手势前）调用通常拿不到 granted，但 Chrome 对「已安装/常用站点」
 * 会自动授予；失败静默忽略，不影响正常使用。
 */
async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // 不支持/被拒绝：静默忽略
  }
}

/** 微信背景图本地 settings 键（迁移时从服务端搬入） */
export const WX_BG_SETTING_PREFIX = 'wx-bg-';
export type WxBgKey = 'moments' | 'me';
export interface WxBgLocal {
  data: string;
  version: string;
}

function sortDesc(list: ContactRecord[]): ContactRecord[] {
  return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** 全量联系人（createdAt 倒序，与旧服务端 GET 顺序一致） */
export async function listContacts(): Promise<ContactRecord[]> {
  const all = await localDB.getAll('contacts');
  return sortDesc(all as ContactRecord[]);
}

export async function getContact(id: string): Promise<ContactRecord | null> {
  const rec = await localDB.get('contacts', id);
  return (rec as ContactRecord | undefined) ?? null;
}

/**
 * 新建联系人（行为与旧服务端 POST /api/contacts 一致）：
 * kind/name 校验 → NPC 归属必须存在且非 NPC → 编号留空自动生成 → USER 恒为好友
 */
export async function createContact(payload: ContactPayload): Promise<ContactRecord> {
  if (!isContactKind(payload.kind)) throw new Error('kind 必须是 char/user/npc');
  const name = normalizeText(payload.name, 60);
  if (!name) throw new Error('名字不能为空');

  let ownerId: string | null = null;
  if (payload.kind === 'npc') {
    ownerId = normalizeText(payload.ownerId, 64);
    if (!ownerId) throw new Error('请选择为谁添加 NPC');
    const owner = await getContact(ownerId);
    if (!owner || owner.kind === 'npc') throw new Error('归属对象不存在或类型无效');
  }

  const rec: ContactRecord = {
    id: genId(),
    kind: payload.kind,
    ownerId,
    name,
    nickname: normalizeText(payload.nickname, 60),
    gender: normalizeText(payload.gender, 12),
    age: normalizeText(payload.age, 12),
    height: normalizeText(payload.height, 12),
    weight: normalizeText(payload.weight, 12),
    persona: normalizeText(payload.persona, 5000),
    background: normalizeText(payload.background, 5000),
    occupation: normalizeText(payload.occupation, 40),
    company: normalizeText(payload.company, 60),
    region: normalizeText(payload.region, 40),
    relation: normalizeText(payload.relation, 60),
    phone: normalizeText(payload.phone, 20) ?? genPhone(),
    wechatId: normalizeText(payload.wechatId, 40) ?? genWechatId(),
    wechatPassword: normalizeText(payload.wechatPassword, 64),
    qqId: normalizeText(payload.qqId, 16) ?? genQQ(),
    qqPassword: normalizeText(payload.qqPassword, 64),
    avatar: normalizeAvatar(payload.avatar),
    isFriend: payload.kind === 'user',
    createdAt: new Date().toISOString(),
  };
  await localDB.put('contacts', rec);
  return rec;
}

/**
 * 编辑联系人 / 添加好友（行为与旧服务端 PATCH /api/contacts/[id] 一致）：
 * 只更新传入的键；名字不能清空；NPC 可改归属（须指向存在的非 NPC）；USER 恒为好友。
 * 联系人不存在返回 null；校验失败抛错（错误文案与旧服务端一致）。
 */
export async function updateContact(id: string, patch: Partial<ContactPayload>): Promise<ContactRecord | null> {
  const existing = await getContact(id);
  if (!existing) return null;
  const next: ContactRecord = { ...existing };

  if ('name' in patch) {
    const name = normalizeText(patch.name, 60);
    if (!name) throw new Error('名字不能为空');
    next.name = name;
  }
  if ('nickname' in patch) next.nickname = normalizeText(patch.nickname, 60);
  if ('gender' in patch) next.gender = normalizeText(patch.gender, 12);
  if ('age' in patch) next.age = normalizeText(patch.age, 12);
  if ('height' in patch) next.height = normalizeText(patch.height, 12);
  if ('weight' in patch) next.weight = normalizeText(patch.weight, 12);
  if ('persona' in patch) next.persona = normalizeText(patch.persona, 5000);
  if ('background' in patch) next.background = normalizeText(patch.background, 5000);
  if ('occupation' in patch) next.occupation = normalizeText(patch.occupation, 40);
  if ('company' in patch) next.company = normalizeText(patch.company, 60);
  if ('region' in patch) next.region = normalizeText(patch.region, 40);
  if ('relation' in patch) next.relation = normalizeText(patch.relation, 60);
  if ('wechatId' in patch) next.wechatId = normalizeText(patch.wechatId, 40);
  if ('wechatPassword' in patch) next.wechatPassword = normalizeText(patch.wechatPassword, 64);
  if ('qqId' in patch) next.qqId = normalizeText(patch.qqId, 16);
  if ('qqPassword' in patch) next.qqPassword = normalizeText(patch.qqPassword, 64);
  if ('avatar' in patch) next.avatar = normalizeAvatar(patch.avatar);
  // 手机号可编辑但留空不自动生成（避免编辑时悄悄换号）
  if ('phone' in patch) next.phone = normalizeText(patch.phone, 20);

  if ('ownerId' in patch && existing.kind === 'npc') {
    const ownerId = normalizeText(patch.ownerId, 64);
    if (ownerId) {
      const owner = await getContact(ownerId);
      if (!owner || owner.kind === 'npc') throw new Error('归属对象不存在或类型无效');
    }
    next.ownerId = ownerId;
  }

  if (typeof patch.isFriend === 'boolean') {
    next.isFriend = existing.kind === 'user' ? true : patch.isFriend;
  }

  await localDB.put('contacts', next);
  return next;
}

/** 删除联系人（归属对象被删时其名下 NPC 一并级联删除，同旧服务端 DELETE）；删除了返回 true */
export async function deleteContact(id: string): Promise<boolean> {
  const existing = await getContact(id);
  if (!existing) return false;
  if (existing.kind !== 'npc') {
    const all = await localDB.getAll('contacts');
    for (const c of all as ContactRecord[]) {
      if (c.kind === 'npc' && c.ownerId === id) await localDB.delete('contacts', c.id);
    }
  }
  await localDB.delete('contacts', id);
  return true;
}

export interface WxLoginSuccess {
  ok: true;
  user: {
    id: string;
    name: string;
    avatar: string | null;
    wechatId: string | null;
    phone: string | null;
    qqId: string | null;
    persona: string | null;
  };
}
export type WxLoginResult = WxLoginSuccess | { ok: false; error: string };

/**
 * 微信登录校验（本地版，行为与旧服务端 POST /api/wechat/login 一致）：
 * mode 'phone' 手机号+微信密码；'qq' QQ号+QQ密码；'wechat' 微信号优先、其次 QQ 号自动识别。
 * 仅允许 kind='user' 的联系人登录。
 */
export async function loginWechat(mode: 'phone' | 'wechat' | 'qq', rawAccount: string, password: string): Promise<WxLoginResult> {
  const account = typeof rawAccount === 'string' ? rawAccount.trim().slice(0, 120) : '';
  if (!account) return { ok: false, error: '请填写账号' };
  if (!password.trim()) return { ok: false, error: '请填写密码' };

  const all = await listContacts();
  const find = (m: 'phone' | 'wechat' | 'qq', acc: string) => {
    if (m === 'phone') return { hits: all.filter((c) => c.phone === acc), label: '手机号', pwdKind: 'wechat' as const };
    if (m === 'qq') return { hits: all.filter((c) => c.qqId === acc), label: 'QQ 号', pwdKind: 'qq' as const };
    const byWx = all.filter((c) => c.wechatId === acc);
    if (byWx.length > 0) return { hits: byWx, label: '微信号', pwdKind: 'wechat' as const };
    return { hits: all.filter((c) => c.qqId === acc), label: /^\d+$/.test(acc) ? 'QQ 号' : '账号', pwdKind: 'qq' as const };
  };

  const { hits, label, pwdKind } = find(mode, account);
  if (hits.length === 0) return { ok: false, error: `登录失败：该${label}尚未注册微信` };

  const hit = hits[0];
  if (hit.kind !== 'user') return { ok: false, error: '该账号类型暂不支持登录，请使用 user 账号' };

  const expect = pwdKind === 'qq' ? hit.qqPassword : hit.wechatPassword;
  if (!expect || expect !== password) return { ok: false, error: '账号或密码不正确，请重新输入' };

  return {
    ok: true,
    user: {
      id: hit.id,
      name: displayNameOf(hit),
      avatar: hit.avatar,
      wechatId: hit.wechatId,
      phone: hit.phone,
      qqId: hit.qqId,
      persona: hit.persona,
    },
  };
}

/**
 * QQ 登录校验（本地版，与微信登录同源同规则）：
 * mode 'account' QQ号/QID/邮箱 + QQ密码；'phone' 手机号 + QQ密码。
 * 仅允许 kind='user' 的联系人登录；char / npc 一律拦截（「该账号类型暂不支持登录」）。
 * 登录密码统一用联系人的 qqPassword 字段。
 */
export interface QQLoginSuccess {
  ok: true;
  user: {
    id: string;
    name: string;
    avatar: string | null;
    qqId: string | null;
    phone: string | null;
    persona: string | null;
  };
}
export type QQLoginResult = QQLoginSuccess | { ok: false; error: string };

export async function loginQQ(mode: 'phone' | 'account', rawAccount: string, password: string): Promise<QQLoginResult> {
  const account = typeof rawAccount === 'string' ? rawAccount.trim().slice(0, 120) : '';
  if (!account) return { ok: false, error: '请填写账号' };
  if (!password.trim()) return { ok: false, error: '请填写密码' };

  const all = await listContacts();
  let hits: ContactRecord[];
  let label: string;
  if (mode === 'phone') {
    hits = all.filter((c) => c.phone === account);
    label = '手机号';
  } else {
    // 账密登录：QQ号 / QID / 邮箱（联系人目前只有 qqId 字段，统一按 QQ 号匹配）
    hits = all.filter((c) => c.qqId === account);
    label = 'QQ 号';
  }
  if (hits.length === 0) return { ok: false, error: `登录失败：该${label}尚未注册QQ` };

  const hit = hits[0];
  // char / npc 账号暂不支持登录（与微信一致，只放行 user）
  if (hit.kind !== 'user') return { ok: false, error: '该账号类型暂不支持登录，请使用 user 账号' };

  if (!hit.qqPassword || hit.qqPassword !== password) return { ok: false, error: '账号或密码不正确，请重新输入' };

  return {
    ok: true,
    user: {
      id: hit.id,
      name: displayNameOf(hit),
      avatar: hit.avatar,
      qqId: hit.qqId,
      phone: hit.phone,
      persona: hit.persona,
    },
  };
}

/** 微信背景图（本地 settings store 存 data URL） */
export async function getWxBg(key: WxBgKey): Promise<WxBgLocal | null> {
  const rec = await localDB.get('settings', `${WX_BG_SETTING_PREFIX}${key}`);
  const value = (rec as { value?: unknown } | undefined)?.value as WxBgLocal | undefined;
  return value && typeof value.data === 'string' ? value : null;
}

export async function setWxBg(key: WxBgKey, data: string): Promise<WxBgLocal> {
  const rec: WxBgLocal = { data, version: String(Date.now()) };
  await localDB.put('settings', { key: `${WX_BG_SETTING_PREFIX}${key}`, value: rec });
  return rec;
}

/**
 * 聊天背景图（微信 / QQ 聊天设置页「从手机上传」；本地 settings store 存 data URL，永久保存）。
 * 图片本体较大不入 localStorage，chat-flags 表里只存 bgMode='image' 标记 + bgV 版本号。
 */
const CHAT_BG_PREFIX = 'chat-bg:';

export async function getChatBgImage(app: 'wx' | 'qq', contactId: string): Promise<string | null> {
  const rec = await localDB.get('settings', `${CHAT_BG_PREFIX}${app}:${contactId}`);
  const data = (rec as { value?: { data?: unknown } } | undefined)?.value?.data;
  return typeof data === 'string' && data ? data : null;
}

export async function setChatBgImage(app: 'wx' | 'qq', contactId: string, data: string): Promise<void> {
  await localDB.put('settings', { key: `${CHAT_BG_PREFIX}${app}:${contactId}`, value: { data, version: String(Date.now()) } });
}

export async function removeChatBgImage(app: 'wx' | 'qq', contactId: string): Promise<void> {
  await localDB.delete('settings', `${CHAT_BG_PREFIX}${app}:${contactId}`);
}

/** QQ 个人资料页背景图（本地 settings store 存 data URL，永久保存） */
const QQ_PROFILE_BG_KEY = 'qq-profile-bg';

export async function getQqProfileBg(): Promise<string | null> {
  const rec = await localDB.get('settings', QQ_PROFILE_BG_KEY);
  const data = (rec as { value?: { data?: unknown } } | undefined)?.value?.data;
  return typeof data === 'string' && data ? data : null;
}

export async function setQqProfileBg(data: string): Promise<void> {
  await localDB.put('settings', { key: QQ_PROFILE_BG_KEY, value: { data, version: String(Date.now()) } });
}

/**
 * 一次性迁移：服务端 SQLite → 本地 IndexedDB。
 * POST /api/contacts/migrate 返回本浏览器工作区的联系人 + 全局微信背景图；
 * 全部落库成功后 POST /api/contacts/migrate/done 通知服务端清空（数据不留）。
 * 任一步失败都不写 migrated 标记，下次启动自动重试（本地 put 按 id 幂等）。
 */
export async function migrateFromServer(): Promise<void> {
  if (typeof window === 'undefined') return;
  // 联系人/微信账号只存本地：启动即申请持久化存储（防浏览器磁盘压力下清除 IndexedDB），不阻塞迁移
  void requestPersistentStorage();
  try {
    if (window.localStorage.getItem(MIGRATED_KEY)) return;

    const res = await fetch('/api/contacts/migrate', { method: 'POST', headers: wsHeaders() }).catch(() => null);
    if (!res || !res.ok) return; // 服务暂不可用：下次启动重试
    const data = (await res.json().catch(() => null)) as
      | { contacts?: unknown; backgrounds?: unknown }
      | null;
    const rows = Array.isArray(data?.contacts) ? (data?.contacts as ContactRecord[]) : [];
    const bgs = (data?.backgrounds ?? {}) as Record<string, unknown>;

    for (const row of rows) {
      // 只收合法记录：必须有 id 且 kind 合法（字段原样保留，id 不变 → 聊天记录/收藏引用不断）
      if (!row || typeof row !== 'object') continue;
      const rec = row as ContactRecord;
      if (typeof rec.id !== 'string' || !rec.id || !isContactKind(rec.kind)) continue;
      await localDB.put('contacts', rec);
    }
    let bgCount = 0;
    for (const key of Object.keys(bgs) as WxBgKey[]) {
      const dataUrl = bgs[key];
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        await setWxBg(key, dataUrl);
        bgCount += 1;
      }
    }

    if (rows.length > 0 || bgCount > 0) {
      // 本地全部就绪 → 通知服务端清空对应数据（先搬后删）
      const done = await fetch('/api/contacts/migrate/done', { method: 'POST', headers: wsHeaders() }).catch(() => null);
      if (!done || !done.ok) return; // 清空失败：不写标记，下次重试（服务端数据还在，本地 put 幂等）
    }
    window.localStorage.setItem(MIGRATED_KEY, '1');
  } catch {
    // 迁移失败不阻塞使用；下次启动重试
  }
}
