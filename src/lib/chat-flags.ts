'use client';

/**
 * 会话级聊天设置总线（微信 / QQ 共用，对照 unread-store 模式）：
 * - 每个联系人一份 ChatFlags：置顶 / 消息免打扰 / 聊天背景（纯色或图片）
 * - localStorage 持久化（wx-chat-flags / qq-chat-flags），变更即时广播
 *   （会话列表置顶排序、免打扰小铃铛、聊天页背景、聊天设置页开关实时同步）
 * - 聊天背景图片本体较大，存 IndexedDB settings store（见 @/lib/ios/contacts-store 的
 *   getChatBgImage/setChatBgImage），这里只存模式标记 + 版本号
 * - 创建时自动迁移旧版「置顶列表」（wx-chat-pins / qq-chat-pins）到 pinned 标记，
 *   旧键保留只读，不再写回
 */
import { useSyncExternalStore } from 'react';

/** 聊天背景模式：default = App 默认底色；color = 内置纯色壁纸；image = 从手机上传的图片（IndexedDB） */
export type ChatBgMode = 'default' | 'color' | 'image';

export interface ChatFlags {
  pinned?: boolean;
  muted?: boolean;
  bgMode?: ChatBgMode;
  /** bgMode = 'color' 时的纯色值（#RRGGBB） */
  bgColor?: string;
  /** 背景图片版本号（重新上传时更新，订阅方据此重载 IndexedDB 图片） */
  bgV?: number;
}

export type ChatFlagsMap = Record<string, ChatFlags>;

const EMPTY: ChatFlagsMap = {};
/** 空标志单例（组件侧缺省值，引用稳定） */
export const NO_FLAGS: ChatFlags = {};

function parseMap(raw: string | null): ChatFlagsMap {
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: ChatFlagsMap = {};
  for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const f = v as Record<string, unknown>;
    const flags: ChatFlags = {};
    if (f.pinned === true) flags.pinned = true;
    if (f.muted === true) flags.muted = true;
    if (f.bgMode === 'color' || f.bgMode === 'image') flags.bgMode = f.bgMode;
    if (typeof f.bgColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(f.bgColor)) flags.bgColor = f.bgColor;
    if (typeof f.bgV === 'number' && Number.isFinite(f.bgV)) flags.bgV = f.bgV;
    if (Object.keys(flags).length > 0) out[id] = flags;
  }
  return out;
}

function parseLegacyPins(raw: string | null): string[] {
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is string => typeof x === 'string' && Boolean(x));
}

export interface ChatFlagsStore {
  /** 当前标志表（引用稳定，仅在变更时更换，可安全用作 getSnapshot） */
  get: () => ChatFlagsMap;
  /** 订阅变更（useSyncExternalStore 用），返回退订函数 */
  subscribe: (fn: () => void) => () => void;
  /** 浅合并更新某联系人的标志（pinned/muted/bgMode/bgColor/bgV） */
  update: (id: string, patch: ChatFlags) => void;
  /** 切换置顶，返回切换后的值 */
  togglePinned: (id: string) => boolean;
  /** 清除某联系人的全部标志（删除会话时调用） */
  reset: (id: string) => void;
}

export function createChatFlagsStore(lsKey: string, legacyPinsKey?: string): ChatFlagsStore {
  let map: ChatFlagsMap = {};
  try {
    map = parseMap(window.localStorage.getItem(lsKey));
  } catch {
    map = {};
  }
  // 旧版置顶列表一次性迁移：列表里的会话写为 pinned 标记（flags 表为空或未含时）
  if (legacyPinsKey) {
    try {
      const legacy = parseLegacyPins(window.localStorage.getItem(legacyPinsKey));
      let changed = false;
      for (const id of legacy) {
        if (!map[id]) {
          map[id] = { pinned: true };
          changed = true;
        } else if (map[id].pinned !== true) {
          map[id] = { ...map[id], pinned: true };
          changed = true;
        }
      }
      if (changed) {
        try {
          window.localStorage.setItem(lsKey, JSON.stringify(map));
        } catch {
          // 持久化失败忽略
        }
      }
    } catch {
      // 迁移失败忽略
    }
  }

  const subs = new Set<() => void>();
  const persist = () => {
    try {
      window.localStorage.setItem(lsKey, JSON.stringify(map));
    } catch {
      // 持久化失败忽略
    }
  };
  const emit = () => subs.forEach((fn) => fn());
  return {
    get: () => map,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    update(id, patch) {
      const prev = map[id] ?? {};
      const next: ChatFlags = { ...prev, ...patch };
      // 与默认值相同的字段删除，保持表干净
      if (!next.pinned) delete next.pinned;
      if (!next.muted) delete next.muted;
      if (!next.bgMode || next.bgMode === 'default') {
        delete next.bgMode;
        delete next.bgColor;
      }
      if (next.bgMode === 'color' && !next.bgColor) delete next.bgMode;
      if (Object.keys(next).length === 0) {
        if (map[id] === undefined) return;
        const m = { ...map };
        delete m[id];
        map = m;
      } else {
        map = { ...map, [id]: next };
      }
      persist();
      emit();
    },
    togglePinned(id) {
      const next = !(map[id]?.pinned === true);
      this.update(id, { pinned: next });
      return next;
    },
    reset(id) {
      if (map[id] === undefined) return;
      const m = { ...map };
      delete m[id];
      map = m;
      persist();
      emit();
    },
  };
}

/** 组件侧订阅：SSR 用空表快照避免水合不一致，客户端挂载后即取真实数据 */
export function useChatFlags(store: ChatFlagsStore): ChatFlagsMap {
  return useSyncExternalStore(
    store.subscribe,
    store.get,
    () => EMPTY
  );
}

/** 微信会话设置单例（会话列表 / 聊天页 / 聊天设置页共用，实时同步；含旧 wx-chat-pins 迁移） */
export const wxChatFlags = createChatFlagsStore('wx-chat-flags', 'wx-chat-pins');
/** QQ 会话设置单例（含旧 qq-chat-pins 迁移） */
export const qqChatFlags = createChatFlagsStore('qq-chat-flags', 'qq-chat-pins');
