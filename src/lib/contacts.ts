/**
 * 联系人 App 共享工具：CHAR（AI 角色）/ USER（用户人设）/ NPC（配角）。
 * 生成函数同时供前端「生成」按钮与后端自动补全使用（纯函数，两端通用）。
 */

export type ContactKind = 'char' | 'user' | 'npc';

export const CONTACT_KINDS: ContactKind[] = ['char', 'user', 'npc'];

export function isContactKind(v: unknown): v is ContactKind {
  return typeof v === 'string' && (CONTACT_KINDS as string[]).includes(v);
}

/** 已保存的联系人记录（GET /api/contacts 返回的形状；createdAt 序列化为字符串） */
export interface ContactRecord {
  id: string;
  kind: ContactKind;
  ownerId: string | null;
  name: string;
  /** 昵称（QQ/微信等社交 App 显示的名字；空 = 显示真实名字） */
  nickname: string | null;
  gender: string | null;
  age: string | null;
  height: string | null;
  weight: string | null;
  persona: string | null;
  background: string | null;
  occupation: string | null;
  company: string | null;
  region: string | null;
  relation: string | null;
  phone: string | null;
  wechatId: string | null;
  wechatPassword: string | null;
  qqId: string | null;
  qqPassword: string | null;
  avatar: string | null;
  /** 是否已添加为好友（手机级状态：联系人/电话 App 用；CHAR/NPC 创建后默认 false；USER 恒为 true） */
  isFriend: boolean;
  /** 微信好友标记（QQ/微信/信息好友相互独立；缺省 = 沿用旧全局 isFriend） */
  friendWx?: boolean;
  /** QQ 好友标记（缺省 = 沿用旧全局 isFriend） */
  friendQq?: boolean;
  /** 信息 App 好友标记（缺省 = 沿用旧全局 isFriend） */
  friendSms?: boolean;
  createdAt: string;
}

/** 联系人（API 输入/输出通用形状，全部可选字段由调用方校验） */
export interface ContactPayload {
  id?: string;
  kind: ContactKind;
  ownerId?: string | null;
  name: string;
  nickname?: string | null;
  gender?: string | null;
  age?: string | null;
  height?: string | null;
  weight?: string | null;
  persona?: string | null;
  background?: string | null;
  occupation?: string | null;
  company?: string | null;
  region?: string | null;
  relation?: string | null;
  phone?: string | null;
  wechatId?: string | null;
  wechatPassword?: string | null;
  qqId?: string | null;
  qqPassword?: string | null;
  avatar?: string | null;
  isFriend?: boolean;
  friendWx?: boolean;
  friendQq?: boolean;
  friendSms?: boolean;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 昵称展示名：昵称非空用昵称，否则退回真实名字。
 * QQ/微信等社交 App 的联系人显示统一走这里（昵称不是真实名字）。
 */
export function displayNameOf(c: Pick<ContactRecord, 'name' | 'nickname'>): string {
  const nick = c.nickname?.trim();
  return nick ? nick : c.name;
}

/** 把一组联系人的 name 替换成昵称展示名（仅供 QQ/微信/信息等 App 内部显示用，真实名字不变） */
export function withDisplayNames(list: ContactRecord[]): ContactRecord[] {
  return list.map((c) => (c.nickname?.trim() ? { ...c, name: displayNameOf(c) } : c));
}

/** 拥有独立好友状态的社交 App（QQ / 微信 / 信息：一个 App 添加好友不影响其他 App） */
export type FriendApp = 'wx' | 'qq' | 'sms';

/**
 * 某 App 内是否已添加好友：
 * - USER 恒为好友（自己的账号）
 * - 分 App 标记（friendWx/friendQq/friendSms）已设置时以标记为准
 * - 标记缺省（历史数据）回退到全局 isFriend，老好友保持原状
 */
export function isFriendIn(
  c: Pick<ContactRecord, 'kind' | 'isFriend' | 'friendWx' | 'friendQq' | 'friendSms'>,
  app: FriendApp
): boolean {
  if (c.kind === 'user') return true;
  const v = app === 'wx' ? c.friendWx : app === 'qq' ? c.friendQq : c.friendSms;
  return typeof v === 'boolean' ? v : !!c.isFriend;
}

function pick(chars: string): string {
  return chars.charAt(randInt(0, chars.length - 1));
}

/** 手机号：1 + [3-9] + 9 位数字（符合大陆手机号格式） */
export function genPhone(): string {
  let rest = '';
  for (let i = 0; i < 9; i++) rest += String(randInt(0, 9));
  return `1${pick('3456789')}${rest}`;
}

/** 微信号：wxid_ + 8 位小写字母/数字（贴近真实 wxid 格式；字母开头段保证字母主导） */
export function genWechatId(): string {
  const pool = 'abcdefghjkmnpqrstuvwxyz23456789';
  let tail = '';
  for (let i = 0; i < 8; i++) tail += pick(pool);
  return `wxid_${tail}`;
}

/** QQ 号：5-10 位、首位非 0 */
export function genQQ(): string {
  const len = randInt(5, 10);
  let out = String(randInt(1, 9));
  for (let i = 1; i < len; i++) out += String(randInt(0, 9));
  return out;
}

const PWD_LOWER = 'abcdefghjkmnpqrstuvwxyz';
const PWD_UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const PWD_DIGIT = '23456789';
const PWD_SYMBOL = '!@#$%&*?';

/** 密码：10 位，保证含小写/大写/数字/符号各至少 1 个，其余随机 */
export function genPassword(length = 10): string {
  const all = PWD_LOWER + PWD_UPPER + PWD_DIGIT + PWD_SYMBOL;
  const chars = [
    pick(PWD_LOWER),
    pick(PWD_UPPER),
    pick(PWD_DIGIT),
    pick(PWD_SYMBOL),
  ];
  while (chars.length < Math.max(4, length)) chars.push(pick(all));
  // Fisher-Yates 洗牌打乱
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** 文本字段统一 trim；空串归一为 null */
export function normalizeText(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, maxLen);
}

/** 头像 data URL 校验（允许 png/jpeg/webp/gif，限制 400KB，防止把数据库撑爆） */
export function normalizeAvatar(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)) return null;
  if (v.length > 400 * 1024) return null;
  return v;
}
