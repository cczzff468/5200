'use client';

/**
 * AI 接听决策（前端封装，三端共用）：
 * 机主打给 AI 联系人时，响铃期间调 /api/phone/answer——AI 基于
 * 人设 / 关系 / 当前时间状态 / 最近聊天决定 接听(answer) / 拒绝(reject) / 不接(miss)。
 *
 * 时序契约：
 * - 请求在响铃开始时立即发出（不阻塞响铃 UI）；
 * - 超时 ANSWER_DECISION_TIMEOUT_MS 内未返回 → 兜底 answer（宁可多接，不让用户白等）；
 * - 任何网络/解析错误 → 兜底 answer。
 * 返回 Promise 只 settle 一次，宿主可安全 await。
 */

export type AnswerDecision = 'answer' | 'reject' | 'miss';

export interface AnswerDecisionResult {
  decision: AnswerDecision;
  /** 拒绝/不接后 AI 稍后发的解释文字（宿主：微信/QQ 插聊天消息；电话 App 落语音留言） */
  afterText?: string;
}

/** 决策等待上限：超过视为「接听」（响铃体验不能被决策拖太久） */
export const ANSWER_DECISION_TIMEOUT_MS = 9000;

export interface AnswerDecisionArgs {
  number: string;
  /** 对端联系人资料（与 /api/phone/turn 的 contact 同构，前端直传） */
  contact: Record<string, unknown> | null;
  /** 最近聊天上下文（user=机主 / assistant=对端；电话 App 无聊天流传 []） */
  recentChat: { role: 'user' | 'assistant'; content: string }[];
  /** 时间感知块（有开关时传；决策需要知道现在几点） */
  timeBlock?: string;
  /** 机主身份（真实名字 + 昵称）：AI 知道软件上显示的名字只是昵称，被问是谁报真名 */
  userRealName?: string;
  userNickname?: string;
  config: unknown;
}

export function requestAnswerDecision(args: AnswerDecisionArgs): Promise<AnswerDecisionResult> {
  const fallback: AnswerDecisionResult = { decision: 'answer' };
  return fetch('/api/phone/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(ANSWER_DECISION_TIMEOUT_MS),
  })
    .then(async (res): Promise<AnswerDecisionResult> => {
      if (!res.ok) return fallback;
      const data = (await res.json()) as { decision?: string; afterText?: string };
      if (data.decision !== 'reject' && data.decision !== 'miss') return fallback;
      return {
        decision: data.decision,
        ...(data.afterText ? { afterText: data.afterText } : {}),
      };
    })
    .catch(() => fallback);
}
