'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import { cleanTextForTts, speakUserTts, stopSpeaking } from '@/lib/ios/tts-client';

/**
 * 聊天气泡「播放语音」按钮（微信 / QQ 单聊与群聊共用）：
 * - 点击：按消息发送者解析音色（角色 voiceId → 全局默认 → 程序安全默认）合成并播放；
 *   每次点击实时重读联系人 voiceId，切换角色/改音色后下一条立即生效
 * - 单例播放器：播新的自动停旧的；播放中/合成中再点即停
 * - 合成失败回调 onError（不影响文字聊天）；组件卸载不主动停全局播放（由聊天页统一释放）
 */
export function VoicePlayButton({
  contactId,
  text,
  onError,
  className = '',
}: {
  /** 消息发送者的联系人 ID（群聊传 senderId；空则只用全局默认/安全默认音色） */
  contactId: string | null;
  /** 要朗读的原文（内部会先剥离舞台动作与标记） */
  text: string;
  onError?: () => void;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const seqRef = useRef(0);

  // 卸载时作废未完成的序列（正在进行的合成结束后不再触碰状态）
  useEffect(
    () => () => {
      seqRef.current += 1;
    },
    []
  );

  const handleClick = useCallback(async () => {
    // 播放中/合成中再点：停止
    if (state !== 'idle') {
      seqRef.current += 1;
      stopSpeaking();
      setState('idle');
      return;
    }
    const seq = ++seqRef.current;
    setState('loading');
    try {
      await speakUserTts({
        text,
        contactId,
        onStart: () => {
          if (seq === seqRef.current) setState('playing');
        },
        onEnd: () => {
          if (seq === seqRef.current) setState('idle');
        },
      });
    } catch {
      if (seq === seqRef.current) {
        setState('idle');
        onError?.();
      }
      return;
    }
    // 被打断/播放结束的兜底归位（onEnd 已处理时不重复）
    if (seq === seqRef.current) setState('idle');
  }, [state, text, contactId, onError]);

  // 剔除舞台动作/表情标记后无可朗读内容（如纯表情消息）→ 不渲染按钮
  if (!cleanTextForTts(text)) return null;

  const label = state === 'loading' ? '合成中' : state === 'playing' ? '停止' : '播放语音';

  return (
    <button
      type="button"
      data-testid="chat-voice-play"
      onClick={(e) => {
        e.stopPropagation();
        void handleClick();
      }}
      aria-label={label}
      className={`flex w-fit items-center gap-1 rounded-full bg-black/[0.06] px-2 py-[3px] text-[11px] leading-none text-black/55 transition-colors active:bg-black/[0.12] dark:bg-white/[0.09] dark:text-white/60 dark:active:bg-white/[0.16] ${className}`}
    >
      {state === 'loading' ? (
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.2} aria-hidden="true" />
      ) : state === 'playing' ? (
        <Square className="h-3 w-3 animate-pulse" strokeWidth={2.4} aria-hidden="true" />
      ) : (
        <Play className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
      )}
      {label}
    </button>
  );
}
