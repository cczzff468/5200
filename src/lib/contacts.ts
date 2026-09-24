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
  /** 生日（几月几号，如「3月5日」；可不带年份） */
  birthday?: string | null;
  relation: string | null;
  /** 仅 NPC：对机主（USER）的关系（如 网友/同事/用户的朋友/情敌）；relation 是对归属者（CHAR/USER）的关系。
   *  可选字段：历史数据无此键，读取处一律用 ?./?? 兼容 */
  relationToUser?: string | null;
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
  /** 真实姓名（withDisplayNames 展示副本专用：昵称替换 name 时把原 name 存到这里；
   *  人设注入用——角色要知道自己的大名/真名，别人用真名叫 TA 时不能不承认） */
  realName?: string | null;
  /** 备注名（仅机主自己可见的显示名；设置后聊天界面/消息列表优先显示备注，AI 人设不变） */
  remark?: string | null;
  /** 语音音色（该角色在电话/微信/QQ 里说活用的 voiceId；空 = 用全局默认音色）。
   *  每次播放时实时重读，切角色/改音色后下一句即生效 */
  voiceId?: string | null;
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
  /** 生日（几月几号） */
  birthday?: string | null;
  relation?: string | null;
  /** 仅 NPC：对机主（USER）的关系 */
  relationToUser?: string | null;
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
  remark?: string | null;
  /** 语音音色（角色在电话/微信/QQ 里的说话音色；空 = 用全局默认） */
  voiceId?: string | null;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 展示名：备注 > 昵称 > 真实名字。
 * QQ/微信等社交 App 的联系人显示统一走这里（备注/昵称不是真实名字）。
 */
export function displayNameOf(c: Pick<ContactRecord, 'name' | 'nickname'> & { remark?: string | null }): string {
  const rk = c.remark?.trim();
  if (rk) return rk;
  const nick = c.nickname?.trim();
  return nick ? nick : c.name;
}

/** 把一组联系人的 name 替换成展示名（备注/昵称优先，仅供 QQ/微信/信息等 App 内部显示用，真实名字不变） */
export function withDisplayNames(list: ContactRecord[]): ContactRecord[] {
  return list.map((c) => (c.remark?.trim() || c.nickname?.trim() ? { ...c, name: displayNameOf(c), realName: c.realName ?? c.name } : c));
}

// ---------------- 名字 / 昵称区分（AI 称呼与成员解析共用） ----------------

/**
 * AI 对用户的称呼方式（全局设置；'name' = 用名字「凡凡」（默认），'nickname' = 用昵称「凑凑」）。
 * 持久化在设置 Store（settings store 'addressMode' 键）。
 */
export type AddressMode = 'name' | 'nickname';

/**
 * AI 称呼名：按称呼方式取「名字」或「昵称」。
 * 名字/昵称混淆修复的核心取值函数——原始记录（name=真名）与展示副本（name=昵称、realName=原真名）
 * 两种形状都能正确取到目标称呼：
 * - mode 'name'：真实姓名优先（副本 realName / 原始 name），无真名回退 name；
 * - mode 'nickname'：昵称存在时用昵称，否则回退真名。
 */
export function addressNameOf(c: { name: string; nickname?: string | null; realName?: string | null }, mode: AddressMode): string {
  const nick = c.nickname?.trim() ?? '';
  if (mode === 'nickname' && nick) return nick;
  const real = c.realName?.trim() ?? '';
  return real || c.name;
}

/**
 * 联系人的全部可识别名字（去重）：真名 / 展示名 / 昵称 / 备注。
 * AI 写成员名字时可能用其中任何一个（人设里教过大名、聊天里见过昵称）——
 * 群管理标记（禁言/踢人/设管理员）的目标解析全部按这套变体匹配，名字写错一个形式不再导致操作静默失败。
 */
export function contactNameVariants(c: { name: string; nickname?: string | null; realName?: string | null; remark?: string | null }): string[] {
  const out = new Set<string>();
  const push = (v?: string | null) => {
    const t = (v ?? '').trim();
    if (t) out.add(t);
  };
  push(c.realName);
  push(c.name);
  push(c.nickname);
  push(c.remark);
  return [...out];
}

/**
 * 名字变体里是否命中目标名（精确 → 互相包含逐级；n 为空永远不命中）。
 * 与群组件 resolveTarget 的「精确 → 包含」口径一致，供多变体匹配复用。
 */
export function nameVariantHit(variants: string[], n: string): boolean {
  const t = n.trim();
  if (!t) return false;
  if (variants.some((v) => v === t)) return true;
  return variants.some((v) => v.includes(t) || t.includes(v));
}

/**
 * 成员格点显示名（群聊设置页成员瓦片用）：有昵称时按用户设置显示
 * 「凡凡（凑凑）」（用名字模式，名字昵称都能对上号）或「凑凑」（用昵称模式）；无昵称显示名字。
 */
export function meTileLabel(c: { name: string; nickname?: string | null; realName?: string | null }, mode: AddressMode): string {
  const shown = addressNameOf(c, mode);
  const nick = c.nickname?.trim() ?? '';
  if (mode === 'name' && nick && nick !== shown) return `${shown}（${nick}）`;
  return shown;
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

/**
 * 生日归一化：把「6.20」「6/20」「6-20」「06.20」「1999.6.20」「6月20」「6月20日」「1999年6月20日」
 * 等常见写法统一转成「6月20日」/「1999年6月20日」，
 * 保证 AI 人设 system prompt 与详情页展示都能无歧义理解；无法解析的写法原样返回。
 */
export function formatBirthday(v?: string | null): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  // 带年份：1999年6月20日 / 1999.6.20 / 1999-6-20 / 1999/6/20
  const full = t.match(/^(\d{4})\s*[年.．/／\-]\s*(\d{1,2})\s*[月.．/／\-]\s*(\d{1,2})\s*日?号?$/);
  if (full) {
    const y = Number(full[1]);
    const mo = Number(full[2]);
    const d = Number(full[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}年${mo}月${d}日`;
  }
  // 不带年份：6月20日 / 6.20 / 6/20 / 6-20 / 06.20
  const short = t.match(/^(\d{1,2})\s*[月.．/／\-]\s*(\d{1,2})\s*日?号?$/);
  if (short) {
    const mo = Number(short[1]);
    const d = Number(short[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${mo}月${d}日`;
  }
  return t.slice(0, 30);
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
