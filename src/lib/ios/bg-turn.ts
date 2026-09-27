'use client';

/**
 * 退出网页后续复（服务端接力）的客户端接线：
 *
 * 一、上报（页面关闭时）：
 *   pagehide 时遍历「还在流式接收」的会话（chat-stream-store 活跃 payload）与「还在逐条投递」
 *   的会话（ai-delivery 未落盘尾部），用 sendBeacon 上报 /api/chat/bg：
 *   - 流没跑完（mode=generate）→ 服务端用同一套生成链路把回复生成出来；
 *   - 投递没落盘完（mode=deliver）→ 现成消息文本直接入服务端 pending 队列。
 *   服务端完成后尽力发 Web Push（每条消息一条系统通知）；重开网页后从 pending 拉取。
 *
 * 二、拉取（页面打开后）：
 *   - 聊天页挂载 / 回前台：pullBgPending(sessionKey) 拉取本会话待达消息（服务端即清除），
 *     由各 App 走原有投递管线（buildReplyMsgs → enqueueBatch → 逐条落盘+灵动岛弹窗+未读角标）；
 *   - 会话列表页挂载：peekBgBadgeCounts() 拉各会话待达条数 → 未读角标（同一批条目只提示一次，
 *     localStorage 去重；拉取投递后自动解除）。
 *
 * 会话显示名由聊天页挂载时 registerBgSession 注册（beacon 携带，Web Push 标题用联系人名；
 * 未注册时服务端回退为 App 名）。
 */

import { getActiveStreamPayloads } from '../chat-stream-store';
import { getDeliveringSessionKeys, peekPendingMsgs } from './ai-delivery';

export interface BgSessionMeta {
  title: string;
  app: 'wechat' | 'qq' | 'chat';
}

/** 待拉取的接力消息（服务端 pending 项） */
export interface BgPendingItem {
  id: string;
  /** 消息文本数组：single=true 时 texts[0] 是一次完整回复原文（可能含 &&& 分段/动作标记）；
   *  single=false 时每项就是一条独立消息文本 */
  texts: string[];
  single: boolean;
  createdAt: number;
}

// ---------------- 会话元数据（beacon 携带显示名，Web Push 标题用） ----------------

const sessionMetas = new Map<string, BgSessionMeta>();

export function registerBgSession(sessionKey: string, meta: BgSessionMeta): void {
  sessionMetas.set(sessionKey, meta);
}

export function unregisterBgSession(sessionKey: string): void {
  sessionMetas.delete(sessionKey);
}

// ---------------- pagehide 上报（页面关闭瞬间的接力请求） ----------------

function sendBgBeacon(body: Record<string, unknown>): void {
  try {
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
    navigator.sendBeacon('/api/chat/bg', blob);
  } catch {
    // sendBeacon 不可用/被拦截 → 放弃接力（与旧行为一致：关页即丢）
  }
}

/** 未投递消息的文本（从 ai-delivery 的已调度未落盘队列里取正文） */
function undeliveredTexts(sessionKey: string): string[] {
  return peekPendingMsgs<{ content?: unknown }>(sessionKey)
    .map((m) => (m && typeof m === 'object' && typeof m.content === 'string' ? m.content : ''))
    .filter((t) => t.trim().length > 0);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    try {
      const streams = getActiveStreamPayloads();
      // ① 流没跑完：上报 payload 让服务端接管生成（现成消息不重复上报，由新回复整体替代）
      for (const s of streams) {
        sendBgBeacon({
          mode: 'generate',
          sessionKey: s.sessionKey,
          payload: { messages: s.messages, config: s.config },
          meta: sessionMetas.get(s.sessionKey),
        });
      }
      // ② 流已结束但逐条投递没落盘完：现成消息文本直接入队（重开后原样送达）
      for (const key of getDeliveringSessionKeys()) {
        if (streams.some((s) => s.sessionKey === key)) continue;
        const texts = undeliveredTexts(key);
        if (texts.length === 0) continue;
        sendBgBeacon({ mode: 'deliver', sessionKey: key, texts, meta: sessionMetas.get(key) });
      }
    } catch {
      // pagehide 里任何异常都吞掉（不影响卸载）
    }
  });
}

// ---------------- 拉取 ----------------

/**
 * 拉取本会话的接力消息（服务端即清除；调用方走各自投递管线）。
 * 聊天页挂载与回前台时调用；会话正有活跃流/投递时跳过（等下一轮回前台再拉，避免与新回复交错）。
 */
export async function pullBgPending(sessionKey: string): Promise<BgPendingItem[]> {
  try {
    const { isChatStreaming } = await import('../chat-stream-store');
    const { isAiDelivering } = await import('./ai-delivery');
    if (isChatStreaming(sessionKey) || isAiDelivering(sessionKey)) return [];
    const res = await fetch(`/api/chat/bg?sessionKey=${encodeURIComponent(sessionKey)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: unknown };
    if (!Array.isArray(data.items)) return [];
    const items: BgPendingItem[] = [];
    for (const raw of data.items) {
      if (!raw || typeof raw !== 'object') continue;
      const rec = raw as { id?: unknown; texts?: unknown; single?: unknown; createdAt?: unknown };
      const texts = Array.isArray(rec.texts)
        ? rec.texts.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : [];
      if (texts.length === 0) continue;
      items.push({
        id: typeof rec.id === 'string' ? rec.id : `bg-${Math.random().toString(36).slice(2)}`,
        texts,
        single: rec.single === true,
        createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : Date.now(),
      });
    }
    markPeekedConsumed(sessionKey);
    return items;
  } catch {
    return [];
  }
}

/** 回前台/重新聚焦时回调（聊天页用它再次 pullBgPending） */
export function onBgPageVisible(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => {
    if (document.visibilityState === 'visible') cb();
  };
  document.addEventListener('visibilitychange', handler);
  window.addEventListener('focus', handler);
  return () => {
    document.removeEventListener('visibilitychange', handler);
    window.removeEventListener('focus', handler);
  };
}

// ---------------- 会话列表角标（peek + localStorage 去重，同一批条目只提示一次） ----------------

const PEEKED_KEY = 'bg-peeked-ids';

function loadPeeked(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PEEKED_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function savePeeked(set: Set<string>): void {
  try {
    const arr = [...set].slice(-200);
    window.localStorage.setItem(PEEKED_KEY, JSON.stringify(arr));
  } catch {
    // 持久化失败忽略（内存态去重仍生效）
  }
}

function markPeeked(ids: string[]): void {
  const set = loadPeeked();
  for (const id of ids) set.add(id);
  savePeeked(set);
}

/** 拉取后解除该会话的「已提示」标记（已正式送达，之后新的接力到达才会再次提示） */
function markPeekedConsumed(sessionKey: string): void {
  const set = loadPeeked();
  const prefix = `${sessionKey}#`;
  const next = [...set].filter((k) => !k.startsWith(prefix));
  if (next.length === set.size) return;
  savePeeked(new Set(next));
}

/**
 * 各会话「接力消息待达条数」（仅返回新出现的：同一批条目只在第一次查询时返回，
 * 正式拉取投递后解除标记；会话列表挂载时调用 → 未读角标）。
 * 返回 { sessionKey: 条数 }，只含有待达消息的会话。
 */
export async function peekBgBadgeCounts(): Promise<Record<string, number>> {
  try {
    const res = await fetch('/api/chat/bg?peekAll=1');
    if (!res.ok) return {};
    const data = (await res.json()) as { counts?: Record<string, unknown> };
    if (!data.counts || typeof data.counts !== 'object') return {};
    const peeked = loadPeeked();
    const out: Record<string, number> = {};
    const newIds: string[] = [];
    for (const [key, n] of Object.entries(data.counts)) {
      const count = typeof n === 'number' && n > 0 ? Math.floor(n) : 0;
      if (count <= 0) continue;
      // 服务端 pending 里没有逐条 id（peekAll 不清除），以「会话+数量」作为提示批次键去重：
      // 数量变化（新接力到达）才会再次提示
      const batchKey = `${key}#${count}`;
      if (peeked.has(batchKey)) continue;
      peeked.add(batchKey);
      newIds.push(batchKey);
      out[key] = count;
    }
    if (newIds.length > 0) savePeeked(peeked);
    return out;
  } catch {
    return {};
  }
}
