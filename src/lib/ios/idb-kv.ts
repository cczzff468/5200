'use client';

/**
 * localStorage → IndexedDB 迁移与统一读写层（中大容量模块专用）：
 *
 * 背景：聊天消息 / 记忆 / 表情包（含 dataURL）/ 朋友圈 / 钱包等模块原先持久化在 localStorage，
 * 数据量随会话与图片增长（表情包 dataURL 尤甚），逼近 5MB 配额上限。本模块把这些模块统一
 * 搬到 ios-phone-db 的 kv store（{ key, value }，key = 原 localStorage 键名）。
 *
 * - 迁移（migrateLsToKv）：每次启动幂等执行 —— 扫描 localStorage 命中管理清单的键 →
 *   JSON.parse 后写入 kv → 读回校验一致 → 才删除 localStorage 旧键（防中断丢数据）。
 *   校验失败保留旧键，下次启动重试。
 * - 读写统一：迁移后的模块运行期只走 kvGet/kvSet/kvDel（内存缓存同步读 + 异步写穿 IndexedDB），
 *   不再写 localStorage；localStorage 仅在「IndexedDB 完全不可用」的极端环境降级回用（保命兜底）。
 * - 时序安全：ensureKvReady()（迁移 + 全量注水）在 PhoneShell 开机门控（loaded）之前 await，
 *   开机屏结束前所有模块的同步读（kvGet）都能拿到数据，无需改动各组件的同步调用方式。
 * - 小开关/状态/缓存类（时间感知/回复条数/分句/置顶/未读角标/天气电量缓存等）数据量小且
 *   需要同步首帧读，保留 localStorage，不在此清单（杀鸡不 用牛刀）。
 */

import { localDB } from './db';

// ---------------- 迁移清单（A 级模块的键） ----------------

/** 精确键（全局单份数据） */
const MIGRATE_EXACT = new Set<string>([
  // 微信
  'wx-moments',
  'wx-friend-reqs',
  'wx-wallet',
  'wx-wallet-cards',
  'wx-change-bills',
  'wx-lcq',
  'wx-family-cards',
  'wx-family-cards-in',
  'wx-pay-pwd',
  'wx-favorites',
  'wx-stickers',
  // QQ
  'qq-zone-posts',
  'qq-zone-likes',
  'qq-zone-comments',
  'qq-checkin',
  'qq-wallet',
  'qq-wallet-cards',
  'qq-wallet-bills',
  'qq-pay-pwd',
  'qq-vault-earn',
  'qq-stickers',
  'qq-favorites',
  // 信息（AI 助手会话）
  'ios-chat-assistant-msgs',
  // 翻译译文缓存（可达数百 KB）
  'chat-translate-cache',
]);

/** 前缀模式（按联系人/会话隔离的多份数据） */
const MIGRATE_PREFIXES = [
  'wx-chat-msgs:', // 微信聊天记录（遗留 sms-chat-msgs: 一并清扫，见 contacts-store 清理逻辑兼容）
  'qq-chat-msgs:',
  'ios-chat-msgs:',
  'sms-chat-msgs:', // 信息 App 更早版本的遗留键
  'wx-ai-events:',
  'qq-ai-events:',
  'qq-bond:',
  'qq-friend-likes:',
  'mem-frag:',
  'mem-ltm:',
  'mem-long:',
  'mem-settings:',
  'mem-round:',
  'mem-msgcount:',
  'mem-anchor:',
];

function isMigratableKey(key: string): boolean {
  if (MIGRATE_EXACT.has(key)) return true;
  return MIGRATE_PREFIXES.some((p) => key.startsWith(p));
}

// ---------------- 内存写穿层 ----------------

const memStore = new Map<string, unknown>();

/** IndexedDB 是否可用（打不开时自动降级回 localStorage，保命） */
let idbAvailable = true;
/** ensureKvReady 是否已完成（迁移 + 注水） */
let readyDone = false;

/**
 * 同步读（内存缓存）。开机门控保证 ready 后内存里已有全量数据；
 * ready 之前的读取（理论上只发生在极早期渲染）返回 null，与旧代码 localStorage 无键时行为一致。
 */
export function kvGet<T = unknown>(key: string): T | null {
  if (memStore.has(key)) return (memStore.get(key) ?? null) as T | null;
  if (!readyDone && idbAvailable) {
    // 极早期同步读（未注水）：回退读 localStorage（此时迁移未删键或已删但内存应有——两种情况都覆盖）
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return null;
      const parsed: unknown = JSON.parse(raw);
      return parsed as T;
    } catch {
      return null;
    }
  }
  return null;
}

/** 同步写内存 + 异步写穿 IndexedDB（运行期唯一持久化写入口） */
export function kvSet(key: string, value: unknown): void {
  memStore.set(key, value);
  if (!idbAvailable) {
    // 降级：IndexedDB 不可用时写回 localStorage（保持旧行为）
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 配额满等失败忽略（与旧代码一致）
    }
    return;
  }
  void localDB.put('kv', { key, value }).catch(() => {
    // 单次写失败不中断 UI（下次写入重试；内存值始终最新）
  });
}

/** 同步删内存 + 异步删 IndexedDB */
export function kvDel(key: string): void {
  memStore.delete(key);
  if (!idbAvailable) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // 忽略
    }
    return;
  }
  void localDB.delete('kv', key).catch(() => {});
}

/** 按前缀批量删（联系人删除时清记忆/聊天键） */
export function kvDelByPrefix(prefix: string): void {
  const keys = [...memStore.keys()].filter((k) => k.startsWith(prefix));
  for (const k of keys) kvDel(k);
}

// ---------------- 迁移与注水 ----------------

/**
 * 把 localStorage 命中清单的键迁移到 kv（幂等）：
 * 写入 → 读回校验（JSON 序列化对比）→ 一致才删旧键；失败保留旧键下次重试。
 * 返回迁移的键数（用于日志/验证）。
 */
async function migrateLsToKv(): Promise<number> {
  if (typeof window === 'undefined') return 0;
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && isMigratableKey(k)) keys.push(k);
  }
  let migrated = 0;
  for (const key of keys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) continue;
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw; // 非 JSON 字符串原样存
      }
      // 已有键则不覆盖：说明上次迁移 put 已成功（可能后续运行期已被 kvSet 更新过）。
      // 防止极端窗口（put 成功后、删旧键前页面被杀）下，下次启动用 localStorage
      // 旧值覆盖运行期新值。kv 存的是 JSON.parse 结果（可结构化克隆），不存在
      // 「上次写坏」需要 LS 修复的场景，直接以 kv 为准并清掉 LS 旧键。
      const existing = await localDB.get('kv', key);
      if (existing == null) {
        await localDB.put('kv', { key, value });
        // 校验：读回并对比序列化结果，一致才算迁移成功
        const back = await localDB.get('kv', key);
        const ok =
          back != null &&
          JSON.stringify(back.value) === JSON.stringify(value);
        if (!ok) continue; // 保留旧键，下次启动重试
      }
      window.localStorage.removeItem(key);
      migrated++;
    } catch {
      // 单键失败不阻塞其余迁移
    }
  }
  return migrated;
}

/** kv store 全量注水到内存（键数量有限且值为中小 JSON，一次性 getAll 开销可接受） */
async function hydrateAll(): Promise<void> {
  const all = await localDB.getAll('kv');
  for (const rec of all) {
    if (rec && typeof rec.key === 'string') memStore.set(rec.key, rec.value);
  }
}

/**
 * 启动入口（幂等）：迁移 localStorage → 注水 IndexedDB → ready。
 * PhoneShell 开机门控在 loaded 前 await 本函数；完成后各模块同步读全部命中内存。
 */
export function ensureKvReady(): Promise<void> {
  if (readyDone) return Promise.resolve();
  return (async () => {
    try {
      await migrateLsToKv();
      await hydrateAll();
      readyDone = true;
    } catch {
      // IndexedDB 打不开（极端环境，如隐私模式禁用存储）：降级回 localStorage 读写，聊天/记忆等不中断。
      // 同时把 localStorage 里的管理键注水进内存 —— 降级模式下 kvSet 也会写 localStorage，
      // 同一隐私会话刷新后 localStorage 数据还在，必须注水才能读到（否则刷新即丢）。
      idbAvailable = false;
      readyDone = true;
      if (typeof window !== 'undefined') {
        try {
          for (let i = 0; i < window.localStorage.length; i++) {
            const k = window.localStorage.key(i);
            if (!k || !isMigratableKey(k) || memStore.has(k)) continue;
            const raw = window.localStorage.getItem(k);
            if (raw == null) continue;
            try {
              memStore.set(k, JSON.parse(raw));
            } catch {
              memStore.set(k, raw);
            }
          }
        } catch {
          // 注水失败忽略（与旧代码无键时行为一致）
        }
      }
      console.warn('[idb-kv] IndexedDB 不可用，已降级回 localStorage 持久化');
    }
  })();
}

/** 测试/验证辅助：迁移与注水是否已完成 */
export function isKvReady(): boolean {
  return readyDone;
}

/** 测试/验证辅助：某键是否仍在 localStorage（迁移后应为 false） */
export function lsHas(key: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(key) != null;
}
