/**
 * 聊天显示设置（微信 / QQ）：头像样式 · 已读未读回执 · 时间显示
 * ---------------------------------------------------------------------------
 * 归属：每 App 独立配置（wx / qq 完全隔离，与 bubbleStyle 同模式），
 * 持久化 settings.chatDisplay（zustand useSettings，IndexedDB kv）。
 *
 * 三个维度：
 *  - avatarShape：头像形状（rounded = 圆角方形（微信原生），circle = 圆形（QQ 原生））；
 *  - read：已读未读回执开关 + 位置（avatar = 头像下面 / bubble = 气泡下面）；
 *  - time：时间显示开关 + 格式（hhmm = HH:mm / hhmmss = HH:mm:ss）+ 位置（同上）。
 *
 * 已读语义（用户指定）：双向回执——
 *  - 我发出的消息默认「未读」，AI 发来消息（回复落地）时全部转「已读」；
 *  - AI 发来的消息默认「未读」，我发消息时全部转「已读」。
 *  - 消息字段 unread?: boolean（undefined = 旧数据，视为已读，不显示成满屏未读）。
 *
 * 位置语义：
 *  - avatar：元信息（已读/时间）小字显示在头像正下方（与头像同宽居中）；
 *  - bubble：元信息显示在气泡下方、靠「气泡末尾」（远离头像的那一侧；
 *    我的消息 = 气泡左下，TA 的消息 = 气泡右下）。
 *  - 已读与时间同时开启且同位置时垂直堆叠：已读在上、时间在下（用户指定）。
 */

/** 宿主 App（显示设置只覆盖微信 / QQ；信息 App 不参与） */
export type ChatDisplayAppId = 'wx' | 'qq';

/** 头像形状：rounded = 圆角方形（微信原生）；circle = 圆形（QQ 原生） */
export type AvatarShape = 'rounded' | 'circle';

/** 元信息（已读/时间）显示位置：avatar = 头像下面；bubble = 气泡下面 */
export type MetaPosition = 'avatar' | 'bubble';

/** 时间格式：hhmm = HH:mm（14:30）；hhmmss = HH:mm:ss（14:30:45） */
export type TimeFormat = 'hhmm' | 'hhmmss';

/** 单 App 显示配置 */
export interface ChatDisplayConfig {
  avatarShape: AvatarShape;
  /** 已读未读回执：默认关（原生微信/QQ 无此功能，用户按需开启） */
  readEnabled: boolean;
  readPosition: MetaPosition;
  /** 时间显示：默认关（保持原生「5 分钟间隔居中时间条」，开启后每条消息单独显示） */
  timeEnabled: boolean;
  timeFormat: TimeFormat;
  timePosition: MetaPosition;
}

/** 全量配置（两 App 隔离） */
export type ChatDisplayAll = Record<ChatDisplayAppId, ChatDisplayConfig>;

/** 默认值：微信 = 圆角方形头像（原生）；QQ = 圆形头像（原生）；回执与时间默认关闭 */
export const DEFAULT_CHAT_DISPLAY: ChatDisplayAll = {
  wx: {
    avatarShape: 'rounded',
    readEnabled: false,
    readPosition: 'bubble',
    timeEnabled: false,
    timeFormat: 'hhmm',
    timePosition: 'bubble',
  },
  qq: {
    avatarShape: 'circle',
    readEnabled: false,
    readPosition: 'bubble',
    timeEnabled: false,
    timeFormat: 'hhmm',
    timePosition: 'bubble',
  },
};

const SHAPES: AvatarShape[] = ['rounded', 'circle'];
const POSITIONS: MetaPosition[] = ['avatar', 'bubble'];
const FORMATS: TimeFormat[] = ['hhmm', 'hhmmss'];

/** 单 App 配置兜底：字段缺失/非法时回默认（load 与 set 双入口共用） */
export function normalizeChatDisplayForApp(raw: unknown, app: ChatDisplayAppId): ChatDisplayConfig {
  const def = DEFAULT_CHAT_DISPLAY[app];
  if (!raw || typeof raw !== 'object') return { ...def };
  const r = raw as Partial<Record<keyof ChatDisplayConfig, unknown>>;
  return {
    avatarShape: SHAPES.includes(r.avatarShape as AvatarShape) ? (r.avatarShape as AvatarShape) : def.avatarShape,
    readEnabled: typeof r.readEnabled === 'boolean' ? r.readEnabled : def.readEnabled,
    readPosition: POSITIONS.includes(r.readPosition as MetaPosition) ? (r.readPosition as MetaPosition) : def.readPosition,
    timeEnabled: typeof r.timeEnabled === 'boolean' ? r.timeEnabled : def.timeEnabled,
    timeFormat: FORMATS.includes(r.timeFormat as TimeFormat) ? (r.timeFormat as TimeFormat) : def.timeFormat,
    timePosition: POSITIONS.includes(r.timePosition as MetaPosition) ? (r.timePosition as MetaPosition) : def.timePosition,
  };
}

/** 全量配置兜底：脏数据整体回默认（load 入口） */
export function normalizeChatDisplay(raw: unknown): ChatDisplayAll {
  const src = raw && typeof raw === 'object' ? (raw as Partial<Record<ChatDisplayAppId, unknown>>) : {};
  return {
    wx: normalizeChatDisplayForApp(src.wx, 'wx'),
    qq: normalizeChatDisplayForApp(src.qq, 'qq'),
  };
}

/** 按所选格式格式化时间戳（仅时分 / 含秒；本地时区） */
export function fmtMsgTime(ts: number, format: TimeFormat): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return format === 'hhmmss' ? `${hm}:${p(d.getSeconds())}` : hm;
}

/** 已读回执文案颜色：未读 = App 品牌色（醒目提示待读），已读 = 中性灰 */
export const READ_ACCENT: Record<ChatDisplayAppId, string> = {
  wx: '#07C160',
  qq: '#0099FF',
};

/** 元信息小字统一样式（聊天页内联使用；颜色由调用方按已读/时间覆盖） */
export const META_TEXT_CLASS =
  'whitespace-nowrap text-[10px] leading-[1.35] text-black/40 dark:text-white/40';
