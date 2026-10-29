'use client';

/**
 * 聊天显示设置（微信 / QQ）：头像样式 · 已读未读回执 · 时间显示 —— 按联系人隔离
 * ---------------------------------------------------------------------------
 * 本轮（用户指定）改造：
 *  - 入口从「我」页 / QQ 设置页移到**聊天设置界面**（聊天页右上角 ··· 打开）；
 *  - 配置**按联系人隔离**（每个角色一份，localStorage 持久化，键 wx-chat-display /
 *    qq-chat-display，值为 { [contactId]: ChatDisplayConfig }）；
 *  - 已读未读支持**自定义文字**（readLabel / unreadLabel，空 = 默认「已读」/「未读」）；
 *  - 未读颜色不再用品牌色，改**深灰**（比已读的浅灰深一档，双色阶都是灰色系）。
 *
 * 三个维度（沿袭上轮）：
 *  - avatarShape：rounded = 圆角方形（微信原生），circle = 圆形（QQ 原生）；
 *  - read：开关 + 位置（avatar = 头像下面 / bubble = 气泡下面）+ 自定义文字；
 *  - time：开关 + 格式（hhmm / hhmmss）+ 位置（同上）。
 *  位置为「气泡下面」时元信息靠气泡末尾（远离头像的一侧）；已读与时间同显时
 *  垂直堆叠（已读在上、时间在下）。
 *
 * 已读语义（双向回执，上轮建立）：我发的消息在 AI 回复落地时转已读；
 * AI 发的消息在我发消息时转已读；消息字段 unread?: boolean（undefined = 视为已读）。
 *
 * 订阅模式：对照 chat-flags 的外部存储总线 —— 模块级缓存 + listeners 广播，
 * useChatDisplay(app, contactId) 用 useSyncExternalStore 订阅，聊天页实时跟随。
 */

import { useSyncExternalStore } from 'react';

/** 宿主 App（显示设置只覆盖微信 / QQ；信息 App 不参与） */
export type ChatDisplayAppId = 'wx' | 'qq';

/** 头像形状：rounded = 圆角方形（微信原生）；circle = 圆形（QQ 原生） */
export type AvatarShape = 'rounded' | 'circle';

/** 元信息（已读/时间）显示位置：avatar = 头像下面；bubble = 气泡下面 */
export type MetaPosition = 'avatar' | 'bubble';

/** 时间格式：hhmm = HH:mm（14:30）；hhmmss = HH:mm:ss（14:30:45） */
export type TimeFormat = 'hhmm' | 'hhmmss';

/** 单联系人的显示配置（全部字段必有值，存取时经 normalize 兜底） */
export interface ChatDisplayConfig {
  avatarShape: AvatarShape;
  /** 已读未读回执：默认关 */
  readEnabled: boolean;
  readPosition: MetaPosition;
  /** 已读自定义文字（空串 = 默认「已读」） */
  readLabel: string;
  /** 未读自定义文字（空串 = 默认「未读」） */
  unreadLabel: string;
  /** 时间显示：默认关（保持原生「5 分钟间隔居中时间条」） */
  timeEnabled: boolean;
  timeFormat: TimeFormat;
  timePosition: MetaPosition;
}

/** 各 App 默认配置：微信 = 圆角方形头像（原生）；QQ = 圆形头像（原生）；回执与时间默认关闭 */
export const DEFAULT_CHAT_DISPLAY: Record<ChatDisplayAppId, ChatDisplayConfig> = {
  wx: {
    avatarShape: 'rounded',
    readEnabled: false,
    readPosition: 'bubble',
    readLabel: '',
    unreadLabel: '',
    timeEnabled: false,
    timeFormat: 'hhmm',
    timePosition: 'bubble',
  },
  qq: {
    avatarShape: 'circle',
    readEnabled: false,
    readPosition: 'bubble',
    readLabel: '',
    unreadLabel: '',
    timeEnabled: false,
    timeFormat: 'hhmm',
    timePosition: 'bubble',
  },
};

const SHAPES: AvatarShape[] = ['rounded', 'circle'];
const POSITIONS: MetaPosition[] = ['avatar', 'bubble'];
const FORMATS: TimeFormat[] = ['hhmm', 'hhmmss'];
const MAX_LABEL_LEN = 8;

/** 单份配置兜底：字段缺失/非法时回默认（解析 localStorage 与 patch 双入口共用） */
export function normalizeChatDisplay(raw: unknown, app: ChatDisplayAppId): ChatDisplayConfig {
  const def = DEFAULT_CHAT_DISPLAY[app];
  if (!raw || typeof raw !== 'object') return { ...def };
  const r = raw as Partial<Record<keyof ChatDisplayConfig, unknown>>;
  return {
    avatarShape: SHAPES.includes(r.avatarShape as AvatarShape) ? (r.avatarShape as AvatarShape) : def.avatarShape,
    readEnabled: typeof r.readEnabled === 'boolean' ? r.readEnabled : def.readEnabled,
    readPosition: POSITIONS.includes(r.readPosition as MetaPosition) ? (r.readPosition as MetaPosition) : def.readPosition,
    readLabel: typeof r.readLabel === 'string' ? r.readLabel.slice(0, MAX_LABEL_LEN) : def.readLabel,
    unreadLabel: typeof r.unreadLabel === 'string' ? r.unreadLabel : def.unreadLabel,
    timeEnabled: typeof r.timeEnabled === 'boolean' ? r.timeEnabled : def.timeEnabled,
    timeFormat: FORMATS.includes(r.timeFormat as TimeFormat) ? (r.timeFormat as TimeFormat) : def.timeFormat,
    timePosition: POSITIONS.includes(r.timePosition as MetaPosition) ? (r.timePosition as MetaPosition) : def.timePosition,
  };
}

/** 已读/未读的显示文字（空标签回退默认） */
export function readTextOf(cfg: ChatDisplayConfig, unread: boolean): string {
  return unread ? cfg.unreadLabel || '未读' : cfg.readLabel || '已读';
}

// ---------------- per-contact 存储总线（对照 chat-flags 模式） ----------------

/** localStorage 键（值 = { [contactId]: ChatDisplayConfig }；显示设置为视觉偏好，不按账号作用域） */
const STORAGE_KEY: Record<ChatDisplayAppId, string> = { wx: 'wx-chat-display', qq: 'qq-chat-display' };

type DisplayMap = Record<string, ChatDisplayConfig>;

const caches: Record<ChatDisplayAppId, DisplayMap> = { wx: {}, qq: {} };
const listeners = new Set<() => void>();
let loaded = false;

function persist(app: ChatDisplayAppId) {
  try {
    window.localStorage.setItem(STORAGE_KEY[app], JSON.stringify(caches[app]));
  } catch {
    /* 存储满/隐私模式：仅内存态 */
  }
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  for (const app of ['wx', 'qq'] as const) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY[app]);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const out: DisplayMap = {};
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
        const cfg = normalizeChatDisplay(v, app);
        // 与默认完全一致不占存储（也避免「存了一堆默认值」）
        if (JSON.stringify(cfg) !== JSON.stringify(DEFAULT_CHAT_DISPLAY[app])) out[id] = cfg;
      }
      caches[app] = out;
    } catch {
      /* 脏数据：该 App 回空表 */
    }
  }
}

function broadcast() {
  for (const fn of listeners) fn();
}

/** 读取某联系人的显示配置（无记录 = App 默认；引用稳定，可作 getSnapshot） */
export function getChatDisplay(app: ChatDisplayAppId, contactId: string): ChatDisplayConfig {
  ensureLoaded();
  return caches[app][contactId] ?? DEFAULT_CHAT_DISPLAY[app];
}

/** 浅合并更新某联系人的显示配置（立即持久化 + 广播，聊天页实时跟随） */
export function patchChatDisplay(app: ChatDisplayAppId, contactId: string, patch: Partial<ChatDisplayConfig>): void {
  ensureLoaded();
  const next = normalizeChatDisplay({ ...getChatDisplay(app, contactId), ...patch }, app);
  caches[app] = { ...caches[app], [contactId]: next };
  persist(app);
  broadcast();
}

/** 恢复某联系人的默认显示配置（删除记录 + 广播） */
export function resetChatDisplay(app: ChatDisplayAppId, contactId: string): void {
  ensureLoaded();
  if (!(contactId in caches[app])) return;
  const next = { ...caches[app] };
  delete next[contactId];
  caches[app] = next;
  persist(app);
  broadcast();
}

/** 订阅变更（useSyncExternalStore 用），返回退订函数 */
export function subscribeChatDisplay(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React 订阅 hook：聊天页 / 设置区实时跟随（getSnapshot 引用稳定） */
export function useChatDisplay(app: ChatDisplayAppId, contactId: string): ChatDisplayConfig {
  return useSyncExternalStore(
    subscribeChatDisplay,
    () => getChatDisplay(app, contactId),
    () => DEFAULT_CHAT_DISPLAY[app],
  );
}

/** 按所选格式格式化时间戳（仅时分 / 含秒；本地时区） */
export function fmtMsgTime(ts: number, format: TimeFormat): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return format === 'hhmmss' ? `${hm}:${p(d.getSeconds())}` : hm;
}

/** 配置摘要（聊天设置页折叠标题右侧的一行小字）：默认 / 圆形头像 / 已读 · 时间 … */
export function chatDisplaySummary(cfg: ChatDisplayConfig): string {
  const parts: string[] = [];
  if (cfg.readEnabled) parts.push('已读');
  if (cfg.timeEnabled) parts.push('时间');
  if (parts.length === 0) parts.push(cfg.avatarShape === 'circle' ? '圆形头像' : '默认');
  return parts.join(' · ');
}
