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
 * 3. 重新进入聊天页时，useChatStream 读到该会话的流状态继续渲染（流式期间只显示「正在输入」，
 *    已收到的分段消息由各 App 经 onSegment 解析成真实消息逐条投递落盘，与页面是否存活无关）；
 * 4. 回复条数 >1 时按「边接收边逐条显示」分段：分段器每凑齐一条完整消息立刻回调 onSegment
 *    投递上屏（N 为上限不是任务），最后一条经 finalize 的 result.tail 交付；
 * 5. 请求完成或失败后，由发起方注册的 finalize 回调把剩余消息写入
 *    对应角色的聊天记录（各 App 自己的 loadMsgs/saveMsgs，消息类型与错误文案按 App 区分），
 *    并广播 chat-stream-finalized 事件供会话列表刷新预览；
 * 6. 角色隔离：以 sessionKey（如 wx:<contactId> / qq:<contactId> / sms:<storageKey>）为键，
 *    每个会话同一时刻最多一条流（isChatStreaming 防重入），不同角色 / 不同 App 的流互不影响；
 *    人设 system 消息仍由各 App 在发送时组装后随 messages 传入（本模块原样透传，不感知人设）。
 * 7. 回复条数：条数指令（N 条上限）由各 App 注入人设 system 消息，一轮发完、不做补发；
 *
 * 响应格式：/api/chat 返回 text/plain 纯文本增量流（服务端已把上游 SSE 解析为纯文本），
 * 客户端按「字节累积 = 已收内容」处理；上游不可达 / directOnly 时回退浏览器直连
 * （directChatStream，SSE 解析），失败文案与各 App 原有错误处理保持一致。
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { ApiConfig } from '@/lib/ios/store';
import { useSettings } from '@/lib/ios/store';
import { directChatStream, isPrivateApiUrl } from '@/lib/ios/direct-api';
import { createReplySegmentScanner } from '@/lib/reply-count';
import { describeImages } from '@/lib/vision-client';
// ---------------- 公开类型 ----------------

export type ChatStreamStatus = 'streaming' | 'done' | 'error';

/** 单条流的状态（不可变对象：每次更新都替换引用，可安全用作 useSyncExternalStore 快照） */
export interface ChatStreamState {
  /** 会话键：wx:<contactId> / qq:<contactId> / sms:<storageKey> */
  sessionKey: string;
  /** AI 回复消息 id（最终落盘沿用，页面渲染 key 用） */
  aiMsgId: string;
  /** 已接收的完整内容（流进行中不更新、结束时一次性写入；不再用于流式气泡展示） */
  content: string;
  status: ChatStreamStatus;
  /** status==='error' 时的友好错误文案（各 App 落盘时按自己的格式包裹） */
  error?: string;
  /** 流开始时间（= 用户消息发出时刻，落盘时作为消息时间） */
  startedAt: number;
  /** 本次流请求的回复条数（>1 时按「边接收边逐条显示」分段投递，N 为上限） */
  replyCount?: number;
  /**
   * 识图失败提示（本轮图片交给识图模型失败时展示；只作系统提示，
   * 不进对话上下文、不当角色台词、不影响本轮之后的聊天）
   */
  visionNotice?: string;
}

export interface ChatPayloadMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 本轮识图输入：用户随消息发送的图片（data URL）+ 随图文字（可为空） */
export interface ChatVisionInput {
  images: string[];
  text: string;
}

/** finalize 结果：流结束（成功/失败）后的最终数据 */
export interface ChatStreamResult {
  aiMsgId: string;
  /** 流式接收的完整内容（可能为空串：由各 App 决定空回复兜底文案） */
  content: string;
  /**
   * 未随 onSegment 放出的最后一段：回复条数 >1 时 = 第 N 条（分段器已按上限留出，
   * 可能包含溢出合并的后续句子；空串 = 流中分段已全部投递）；单条模式 = 完整 content。
   * 各 App 的 finalize 只处理 tail（多条模式）/ content（单条模式），与流中已投递分段不重不漏。
   */
  tail: string;
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
   * 回复条数（>1 时启用）：本次要求 AI 连发多条消息（N 是上限不是任务），
   * 本模块按「边接收边逐条显示」处理——每凑齐一条完整消息立刻回调 onSegment，
   * 并抬高 max_tokens 下限防止多条被截断；最后一条经 finalize 的 result.tail 交付。
   */
  replyCount?: number;
  /**
   * 流中分段回调（回复条数 >1 时启用）：分段器每凑齐一条完整消息（边界出现、标记闭合）
   * 立刻回调一次，各 App 在此把该段解析成真实消息排队逐条投递上屏（边接收边逐条显示，
   * 不存在先全文后消失的流式气泡）；退出页面后本回调照常触发（模块层运行）。
   */
  onSegment?: (segment: string) => void;
  /**
   * 本轮识图输入（可选）：用户在聊天里发送的图片。提供时先用「设置 › 识图模型」
   * 把图片转成文字描述，再作为上下文交给聊天模型；识图模型只负责看图，
   * 最终回复由聊天模型生成；未配置识图模型 / 识图失败不影响文字聊天。
   */
  vision?: ChatVisionInput;
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
  // 流式分段器（回复条数 > 1 时启用）：边接收边切分，每凑齐一条完整消息立刻经 onSegment
  // 投递上屏；原文只在本模块累计（raw），不写入展示状态 —— 流式期间页面只显示「正在输入」，
  // 不再有「先全文后消失」的流式气泡；分段与展示状态完全分离（流式和分条不改同一块状态）
  const multi = typeof opts.replyCount === 'number' && opts.replyCount > 1;
  const scanner =
    multi && opts.onSegment ? createReplySegmentScanner(opts.onSegment, opts.replyCount ?? 1) : null;
  // 条数多时消息总长更长：抬高 max_tokens 下限，防止多条连发被截断（代理与浏览器直连共用该配置）
  const effConfig =
    multi && opts.replyCount
      ? { ...apiConfig, maxTokens: Math.max(apiConfig.maxTokens, opts.replyCount * 120) }
      : apiConfig;
  /** 增量统一入口：原文累计 + 多条模式进分段器（立刻放出已凑齐的完整消息） */
  let raw = '';
  const onDelta = (delta: string): void => {
    raw += delta;
    scanner?.push(delta);
  };
  /**
   * 发起一轮流式请求并读完整条流（增量统一交给 onDelta）。
   * 服务器代理失败 / directOnly / 内网地址时回退浏览器直连（SSE 解析）；抛错交给调用方。
   */
  const streamOnce = async (roundMessages: ChatPayloadMessage[]): Promise<void> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: roundMessages,
        config: effConfig,
      }),
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
          await directChatStream(effConfig, roundMessages, onDelta);
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
      // 纯文本流（text/plain）：字节增量统一交给 onDelta（多条模式进分段器）
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onDelta(decoder.decode(value, { stream: true }));
      }
    }
  };

  /**
   * 最终兜底：代理 + 浏览器直连都失败后，请求服务端内置模型（forceSdk）生成回复；
   * 成功把全量文本交给 onDelta 返回 true，失败（含非 200 / 空文本）返回 false 保留原错误。
   */
  const sdkFallbackOnce = async (roundMessages: ChatPayloadMessage[]): Promise<boolean> => {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: roundMessages, forceSdk: true }),
      });
      if (!res.ok) return false;
      const text = await res.text();
      if (!text.trim()) return false;
      onDelta(text);
      return true;
    } catch {
      return false;
    }
  };

  /** 本轮实际发送的消息（识图成功后会被替换为「原图消息 + 图片描述」的组合） */
  let workMessages: ChatPayloadMessage[] = messages;

  try {
    // 识图前置步骤（设置 › 识图模型；未配置 / 本轮无图片时跳过，文字聊天零影响）：
    // 识图模型只负责「看」——把图片转成描述，追加为一条 user 上下文消息；
    // 最终回复仍由聊天模型生成；识图失败展示系统提示（不进上下文、不当角色台词），本轮按无图片继续
    if (opts.vision && opts.vision.images.length > 0) {
      const visionConfig = useSettings.getState().visionConfig;
      if (visionConfig.baseUrl.trim()) {
        try {
          const desc = await describeImages(visionConfig, { images: opts.vision.images, text: opts.vision.text });
          if (desc) {
            const n = opts.vision.images.length;
            const prefix = n > 1 ? `（我发了 ${n} 张图片，图片内容分别是：` : '（我发了一张图片，图片内容是：';
            workMessages = [...messages, { role: 'user' as const, content: `${prefix}${desc}）` }];
          }
        } catch (err) {
          const detail = err instanceof Error && err.message ? err.message : '未知原因';
          patchState(rt, { visionNotice: `图片识别失败，本次回复未结合图片（${detail}）` });
        }
      }
    }
    // 按各 App 组装的消息发起请求（条数指令已注入人设 system 消息，一轮发完、不做补发）
    await streamOnce(workMessages);
    patchState(rt, { status: 'done' });
  } catch (err) {
    // 代理与浏览器直连都失败：最后用服务端内置模型兜底一次（forceSdk），救回本轮回复；
    // 兜底成功按正常完成收尾，失败才落错误文案（保留最先的代理侧错误，便于区分原因）；
    // 流中已凑齐的分段已经过 onSegment 逐条投递上屏，出错不影响它们（不丢已到手的正文）
    const viaSdk = await sdkFallbackOnce(workMessages);
    if (viaSdk) {
      patchState(rt, { status: 'done' });
    } else {
      patchState(rt, {
        status: 'error',
        error: err instanceof Error && err.message ? err.message : '消息没有送达，请稍后重试',
      });
    }
  }
  // ---- 收尾（status 补丁与 finalize 在同一微任务里，订阅方重渲染时落盘已完成）----
  if (!rt.finalized) {
    rt.finalized = true;
    try {
      opts.finalize({
        aiMsgId: rt.state.aiMsgId,
        content: raw,
        // 多条模式：tail = 分段器剩余的最后一条（第 N 条，可能含溢出合并的句子）；
        // 单条模式：tail = 完整内容（finalize 按旧管线处理，行为与旧版一致）
        tail: scanner ? scanner.finish() : raw,
        error: rt.state.error,
        startedAt: rt.state.startedAt,
      });
      patchState(rt, { content: raw });
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
      replyCount: opts.replyCount,
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
