'use client';

/**
 * 全局聊天流式请求总线（微信 / QQ / 信息 App 共用）。
 *
 * 把「发送消息 → 请求 AI 回复 → 接收流式数据 → 落盘聊天记录」的完整生命周期
 * 从聊天页组件中解耦出来，由本模块（页面之外的全局单例）管理：
 *
 * 1. 用户发送消息后，请求由 beginChatStream 在全局发起并接收流式数据；
 * 2. 退出聊天页 / 退出 App 不会中断请求（流与 React 组件生命周期完全解耦，
 *    读流循环跑在本模块的异步函数里，不依赖任何组件存活）；
 * 3. 重新进入聊天页时，useChatStream 读到该会话的实时流式内容继续渲染；
 * 4. 请求进行中（status==='streaming'）页面显示「正在输入…」（标题 + 空内容时的打字动画）；
 * 5. 请求完成或失败后，由发起方注册的 finalize 回调把最终消息【一次性】写入
 *    对应角色的聊天记录（各 App 自己的 loadMsgs/saveMsgs，消息类型与错误文案按 App 区分），
 *    并广播 chat-stream-finalized 事件供会话列表刷新预览；
 * 6. 角色隔离：以 sessionKey（如 wx:<contactId> / qq:<contactId> / sms:<storageKey>）为键，
 *    每个会话同一时刻最多一条流（isChatStreaming 防重入），不同角色 / 不同 App 的流互不影响；
 *    人设 system 消息仍由各 App 在发送时组装后随 messages 传入（本模块原样透传，不感知人设）。
 *
 * 响应格式：/api/chat 返回 text/plain 纯文本增量流（服务端已把上游 SSE 解析为纯文本），
 * 客户端按「字节累积 = 已收内容」处理；上游不可达 / directOnly 时回退浏览器直连
 * （directChatStream，SSE 解析），失败文案与各 App 原有错误处理保持一致。
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { ApiConfig } from '@/lib/ios/store';
import { directChatStream, isPrivateApiUrl } from '@/lib/ios/direct-api';
import { createReplyPacer } from '@/lib/reply-count';

// ---------------- 公开类型 ----------------

export type ChatStreamStatus = 'streaming' | 'done' | 'error';

/** 单条流的状态（不可变对象：每次更新都替换引用，可安全用作 useSyncExternalStore 快照） */
export interface ChatStreamState {
  /** 会话键：wx:<contactId> / qq:<contactId> / sms:<storageKey> */
  sessionKey: string;
  /** AI 回复消息 id（最终落盘沿用，页面渲染 key 用） */
  aiMsgId: string;
  /** 已接收的流式内容（增量累计） */
  content: string;
  status: ChatStreamStatus;
  /** status==='error' 时的友好错误文案（各 App 落盘时按自己的格式包裹） */
  error?: string;
  /** 流开始时间（= 用户消息发出时刻，落盘时作为消息时间） */
  startedAt: number;
}

export interface ChatPayloadMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** finalize 结果：流结束（成功/失败）后的最终数据 */
export interface ChatStreamResult {
  aiMsgId: string;
  /** 流式接收的完整内容（可能为空串：由各 App 决定空回复兜底文案） */
  content: string;
  /** 失败原因（status==='error' 时存在） */
  error?: string;
  /** 流开始时间（消息 time 字段用） */
  startedAt: number;
}

export interface BeginChatStreamOptions {
  sessionKey: string;
  aiMsgId: string;
  /** 完整请求消息（system 人设在最前 + 上下文），本模块原样透传给 /api/chat 与浏览器直连 */
  messages: ChatPayloadMessage[];
  apiConfig: ApiConfig;
  /**
   * 回复条数（>1 时启用）：本次要求 AI 连发多条消息，本模块会把流式增量经过
   * 连发节奏器（分隔标记后先停顿片刻再放出下一条）再更新 content，
   * 并抬高 max_tokens 下限防止多条被截断；条数切分与落盘由各 App 的 finalize 负责。
   */
  replyCount?: number;
  /**
   * 流结束（成功或失败，恰好一次）后把最终 AI 消息写入该角色的聊天记录。
   * 由各 App 在发起时提供：内部使用该 App 的 loadMsgs/saveMsgs 与消息类型，
   * 不依赖任何组件存活（页面已退出也能正确落盘）。
   */
  finalize: (result: ChatStreamResult) => void;
}

// ---------------- 内部状态 ----------------

interface StreamRuntime {
  state: ChatStreamState;
  /** finalize 是否已执行（防止重复落盘） */
  finalized: boolean;
}

/** 全部流（含已结束未清理的：留给页面重进时同步，超量后按时间淘汰） */
const streams = new Map<string, StreamRuntime>();
const subs = new Set<() => void>();
const finalizedSubs = new Set<(sessionKey: string) => void>();

function emit(): void {
  subs.forEach((fn) => fn());
}

function emitFinalized(sessionKey: string): void {
  finalizedSubs.forEach((fn) => {
    try {
      fn(sessionKey);
    } catch {
      // 监听器异常不影响其他监听器
    }
  });
}

/** 已结束的流最多保留 24 条（重进页面同步用），超出按开始时间淘汰最旧的 */
function evictFinished(): void {
  const finished = [...streams.entries()].filter(([, rt]) => rt.state.status !== 'streaming');
  const overflow = finished.length - 24;
  if (overflow <= 0) return;
  finished
    .sort((a, b) => a[1].state.startedAt - b[1].state.startedAt)
    .slice(0, overflow)
    .forEach(([key]) => streams.delete(key));
}

function patchState(rt: StreamRuntime, patch: Partial<ChatStreamState>): void {
  rt.state = { ...rt.state, ...patch };
  emit();
}

// ---------------- 流式请求执行（与页面生命周期无关） ----------------

async function runStream(rt: StreamRuntime, opts: BeginChatStreamOptions): Promise<void> {
  const { apiConfig, messages } = opts;
  const acc = () => rt.state.content;
  // 连发节奏器（回复条数 > 1 时启用）：分隔标记后先停顿再放出下一条，流结束立刻放出全部剩余
  const multi = typeof opts.replyCount === 'number' && opts.replyCount > 1;
  const pacer = multi ? createReplyPacer((shown) => patchState(rt, { content: shown })) : null;
  // 条数多时消息总长更长：抬高 max_tokens 下限，防止多条连发被截断（代理与浏览器直连共用该配置）
  const effConfig =
    multi && opts.replyCount
      ? { ...apiConfig, maxTokens: Math.max(apiConfig.maxTokens, opts.replyCount * 120) }
      : apiConfig;
  /** 增量统一入口：多条模式进节奏器，单条模式直接透传 */
  const onDelta = (delta: string): void => {
    if (pacer) pacer.push(delta);
    else patchState(rt, { content: acc() + delta });
  };
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, config: effConfig, ...(multi ? { replyCount: opts.replyCount } : {}) }),
    });
    if (!res.ok || !res.body) {
      let detail = '';
      let directOnly = false;
      try {
        const data: unknown = await res.json();
        if (data && typeof data === 'object') {
          const rec = data as { error?: unknown; directOnly?: unknown };
          if (typeof rec.error === 'string') detail = rec.error;
          directOnly = rec.directOnly === true;
        }
      } catch {
        // 忽略解析失败
      }
      if (directOnly || isPrivateApiUrl(apiConfig.baseUrl)) {
        // 内网地址 / 服务器建议直连：改用浏览器直连流式请求（SSE 解析）；
        // 空回复不在此处兜底：finalize 由各 App 写入自己的兜底文案
        try {
          await directChatStream(effConfig, messages, onDelta);
        } catch (directErr) {
          // 公网地址直连也失败：保留服务器侧原因，便于区分地区限制还是 CORS 问题
          const directMsg = directErr instanceof Error && directErr.message ? directErr.message : '';
          if (!isPrivateApiUrl(apiConfig.baseUrl) && detail) {
            throw new Error(`${detail}；浏览器直连也不可用${directMsg ? `：${directMsg}` : ''}`);
          }
          throw directErr;
        }
      } else {
        throw new Error(detail || `请求失败（${res.status}）`);
      }
    } else {
      // 纯文本流（text/plain）：字节增量统一交给 onDelta（多条模式经节奏器）
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onDelta(decoder.decode(value, { stream: true }));
      }
    }
    // 流结束：节奏器立刻放出全部剩余内容（finalize 拿到的是完整内容）
    pacer?.end();
    patchState(rt, { status: 'done' });
  } catch (err) {
    // 失败同样放出已收内容（各 App 错误时按自己的文案落盘，不丢已到手的正文）
    pacer?.end();
    patchState(rt, {
      status: 'error',
      error: err instanceof Error && err.message ? err.message : '消息没有送达，请稍后重试',
    });
  }
  // ---- 收尾（status 补丁与 finalize 在同一微任务里，订阅方重渲染时落盘已完成）----
  if (!rt.finalized) {
    rt.finalized = true;
    try {
      opts.finalize({
        aiMsgId: rt.state.aiMsgId,
        content: rt.state.content,
        error: rt.state.error,
        startedAt: rt.state.startedAt,
      });
    } catch {
      // 落盘失败不影响状态广播（与各 App 持久化失败静默的既有策略一致）
    }
  }
  emitFinalized(rt.state.sessionKey);
  emit();
}

// ---------------- 全局 API ----------------

/**
 * 发起一条流式请求（全局发起，与页面生命周期解耦）。
 * 同一会话已有进行中的流时拒绝并返回 false（调用方应回滚刚插入的用户消息）。
 */
export function beginChatStream(opts: BeginChatStreamOptions): boolean {
  const existing = streams.get(opts.sessionKey);
  if (existing && existing.state.status === 'streaming') return false;
  const rt: StreamRuntime = {
    state: {
      sessionKey: opts.sessionKey,
      aiMsgId: opts.aiMsgId,
      content: '',
      status: 'streaming',
      startedAt: Date.now(),
    },
    finalized: false,
  };
  streams.set(opts.sessionKey, rt);
  evictFinished();
  emit();
  void runStream(rt, opts);
  return true;
}

/** 读取某会话的流状态（引用稳定；无流返回 null） */
export function getChatStream(sessionKey: string): ChatStreamState | null {
  return streams.get(sessionKey)?.state ?? null;
}

/** 某会话是否正在流式接收中（发送按钮防重入；同步读取，无 stale closure 问题） */
export function isChatStreaming(sessionKey: string): boolean {
  return streams.get(sessionKey)?.state.status === 'streaming';
}

/** 清除某会话已结束的流状态（页面完成落盘同步后调用；进行中的流不可清除） */
export function clearChatStream(sessionKey: string): void {
  const rt = streams.get(sessionKey);
  if (!rt || rt.state.status === 'streaming') return;
  streams.delete(sessionKey);
  emit();
}

/** 订阅任意流状态变化（useChatStream 用） */
export function subscribeChatStreams(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** 订阅流结束（finalize 落盘后广播）：会话列表等非聊天页 UI 监听刷新预览 */
export function subscribeChatStreamFinalized(fn: (sessionKey: string) => void): () => void {
  finalizedSubs.add(fn);
  return () => {
    finalizedSubs.delete(fn);
  };
}

// ---------------- Hooks ----------------

const NO_STREAM: ChatStreamState | null = null;

/** 订阅某会话的实时流状态：页面组件用它渲染流式气泡 /「正在输入…」；
 *  卸载后流继续由本模块接收，重进页面重新订阅即可读到实时内容（SSR 快照为 null） */
export function useChatStream(sessionKey: string): ChatStreamState | null {
  const subscribe = useCallback((onStoreChange: () => void) => subscribeChatStreams(onStoreChange), []);
  const getSnapshot = useCallback(() => getChatStream(sessionKey), [sessionKey]);
  return useSyncExternalStore(subscribe, getSnapshot, () => NO_STREAM);
}

/** 订阅某前缀会话的流结束事件（会话列表刷新预览用，如 'wx:' / 'qq:' / 'sms:assistant'） */
export function useChatStreamFinalized(prefix: string, onFinalized: () => void): void {
  const cbRef = useRef(onFinalized);
  // ref 更新入 effect（react-hooks/refs：不在渲染期写 ref；store 事件为异步触发，回调读到的一定是新值）
  useEffect(() => {
    cbRef.current = onFinalized;
  });
  useEffect(() => {
    if (!prefix) return;
    return subscribeChatStreamFinalized((sessionKey) => {
      if (sessionKey.startsWith(prefix)) cbRef.current();
    });
  }, [prefix]);
}
