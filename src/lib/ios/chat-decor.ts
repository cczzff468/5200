/**
 * 聊天输入框自定义（默认主题 / 液态玻璃主题通用）——核心库
 * ---------------------------------------------------------------------------
 *
 * 宿主 App：wx 微信 / qq QQ / sms 信息（三 App 完全隔离，各持一份互不影响）。
 *
 * 两项自定义（两种界面主题下都生效——用户指定「默认主题也可以添加」）：
 *   1. 输入框占位文字（inputPlaceholder）：不打字时输入框里显示的灰色文字，
 *     如参考图「♡*·☆ 1314 day with U·+°♡」；空串 = App 原生默认（微信/QQ 空、信息 iMessage信息）。
 *     文字转语音开启时仍优先显示「输入文字，发送后转为语音」。
 *  2. 加号面板功能（plusKeys）：输入栏上方「+」展开面板里显示哪些功能、按什么顺序显示；
 *     空数组 = 默认全部功能（与原生一致）；支持增删与排序（只保留认识的功能 key）。
 *
 * 持久化：zustand useSettings → IndexedDB settings.chatDecor（与 bubbleStyle / liquidSkin 分键互不影响）。
 */
import type { BubbleAppId } from './bubble-style';

/** 单个 App 的输入框自定义 */
export interface ChatDecorSettings {
  /** 输入框占位文字（空 = 原生默认；最长 30 字） */
  inputPlaceholder: string;
  /** 加号面板功能 key 列表（按显示顺序；空 = 默认全部功能） */
  plusKeys: string[];
}

/** 各 App 加号面板默认功能（与各端 PlusPanel 原生渲染顺序一致） */
export const DEFAULT_PLUS_KEYS: Record<BubbleAppId, readonly string[]> = {
  wx: ['camera', 'image', 'voicecall', 'videocall', 'redpacket', 'transfer', 'location', 'offline', 'textcard', 'together', 'gift'],
  qq: ['call', 'video', 'rp', 'transfer', 'loc', 'textcard', 'together', 'express'],
  sms: ['camera', 'image', 'textcard'],
};

/** 各 App 加号面板功能中文名（设置页勾选格展示用；也是合法 key 的权威清单） */
export const PLUS_FEATURE_LABELS: Record<BubbleAppId, Record<string, string>> = {
  wx: {
    camera: '相机',
    image: '图片',
    voicecall: '语音通话',
    videocall: '视频通话',
    redpacket: '红包',
    transfer: '转账',
    location: '位置',
    offline: '线下',
    textcard: '文字图片',
    together: '一起听',
    gift: '礼物',
  },
  qq: {
    call: '语音通话',
    video: '视频通话',
    rp: '红包',
    transfer: '转账',
    loc: '位置',
    textcard: '文字图片',
    together: '一起听',
    express: '快递',
  },
  sms: {
    camera: '相机',
    image: '图片',
    textcard: '文字图片',
  },
};

export const DEFAULT_CHAT_DECOR: ChatDecorSettings = {
  inputPlaceholder: '',
  plusKeys: [],
};

/** 任意来源（IndexedDB 旧档/脏数据）→ 合法设置；不合法回默认 */
export function normalizeChatDecor(v: unknown): ChatDecorSettings {
  const o = (v ?? {}) as Partial<ChatDecorSettings>;
  return {
    inputPlaceholder: typeof o.inputPlaceholder === 'string' ? o.inputPlaceholder.slice(0, 30) : '',
    plusKeys: Array.isArray(o.plusKeys) ? o.plusKeys.filter((k): k is string => typeof k === 'string').slice(0, 24) : [],
  };
}

/** 三 App 全量 */
export type ChatDecorConfig = Record<BubbleAppId, ChatDecorSettings>;

export function defaultChatDecorConfig(): ChatDecorConfig {
  return {
    wx: { ...DEFAULT_CHAT_DECOR, plusKeys: [] },
    qq: { ...DEFAULT_CHAT_DECOR, plusKeys: [] },
    sms: { ...DEFAULT_CHAT_DECOR, plusKeys: [] },
  };
}

export function normalizeChatDecorConfig(v: unknown): ChatDecorConfig {
  if (!v || typeof v !== 'object') return defaultChatDecorConfig();
  const o = v as Record<string, unknown>;
  return {
    wx: normalizeChatDecor(o.wx),
    qq: normalizeChatDecor(o.qq),
    sms: normalizeChatDecor(o.sms),
  };
}

/** 加号面板最终渲染顺序（过滤未知 key；空 = 默认全部）——聊天页直接消费 */
export function resolvePlusKeys(app: BubbleAppId, keys: readonly string[]): string[] {
  if (!keys.length) return [...DEFAULT_PLUS_KEYS[app]];
  const known = PLUS_FEATURE_LABELS[app];
  const out = keys.filter((k) => typeof k === 'string' && k in known);
  // 全部被过滤掉（脏数据）时回默认，保证面板永不空白
  return out.length ? out : [...DEFAULT_PLUS_KEYS[app]];
}

/** 输入框占位文字最终值（空 = 原生默认由调用方处理） */
export function chatPlaceholder(decor: ChatDecorSettings | undefined): string {
  return (decor?.inputPlaceholder ?? '').trim();
}
