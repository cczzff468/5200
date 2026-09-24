'use client';

/**
 * 语音消息气泡（微信 / QQ / 信息 / 两端群聊共用）：
 * - 播放按钮 + 波形条 + 时长；点击切换播放/暂停（全局单例：新播自动停旧，也停 TTS 朗读）
 * - 播放中波形按进度填色（useVoicePlayback 全局进度，100ms 刷新）
 * - 转文字结果（stt='done'）以小字显示在气泡下方；stt='pending' 显示「转文字中…」
 * - 长按菜单由外层 {...bubblePress} 提供，组件本身只处理点击播放
 */

import { Pause, Play } from 'lucide-react';
import { useVoicePlayback, voicePlayer } from '@/lib/ios/voice-player';
import { voiceDurationLabel } from '@/lib/ios/audio-utils';

/** 语音消息数据（各端消息结构统一挂 m.voice） */
export interface VoiceMsgData {
  /** 音频 dataURL（持久化在聊天记录里，重启后仍可播放） */
  url: string;
  /** 秒（≥1） */
  duration: number;
  /** 静态波形（0~1，约 20 根） */
  wave: number[];
  /** 转文字结果（语音录制自动识别 / 长按转文字 / 文字转语音的原文） */
  transcript?: string;
  /** pending = 识别中；done = 有结果；failed = 识别失败（可长按重试） */
  stt?: 'pending' | 'done' | 'failed';
}

export type VoiceBubbleTheme = 'wx' | 'qq' | 'im';

/** 各端配色（own = 我方绿/蓝气泡；peer = 对方白/灰气泡） */
const THEME: Record<VoiceBubbleTheme, { own: string; peer: string; ownTranscript: string; peerTranscript: string }> = {
  wx: {
    own: 'bg-[#95EC69] text-black dark:bg-[#3EB575] dark:text-black',
    peer: 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white',
    ownTranscript: 'text-black/50 dark:text-black/60',
    peerTranscript: 'text-black/50 dark:text-white/55',
  },
  qq: {
    own: 'text-white',
    peer: 'bg-white text-[#1F2329] dark:bg-[#2A2C31] dark:text-white',
    ownTranscript: 'text-black/50 dark:text-white/55',
    peerTranscript: 'text-black/50 dark:text-white/55',
  },
  im: {
    own: 'text-white',
    peer: 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white',
    ownTranscript: 'text-black/50 dark:text-white/55',
    peerTranscript: 'text-black/50 dark:text-white/55',
  },
};

export function VoiceMsgBubble({
  msgId,
  voice,
  side,
  theme,
  style,
}: {
  msgId: string;
  voice: VoiceMsgData;
  /** 'me' | 'peer'：决定配色与播放图标方向 */
  side: 'me' | 'peer';
  theme: VoiceBubbleTheme;
  /** QQ 我方气泡的底色等自定义样式（theme='qq' && side='me' 时由调用方传 backgroundColor） */
  style?: React.CSSProperties;
}) {
  const { activeId, playing, progress } = useVoicePlayback();
  const mine = side === 'me';
  const t = THEME[theme];
  const isActive = activeId === msgId;
  const isPlaying = isActive && playing;
  const bars = voice.wave.length > 0 ? voice.wave : [0.3, 0.5, 0.4, 0.7, 0.5, 0.8, 0.4, 0.6, 0.35, 0.7, 0.45, 0.6, 0.3, 0.65, 0.4, 0.55];

  const bubbleCls =
    theme === 'qq' && mine
      ? 'rounded-[10px] text-white'
      : theme === 'im' && mine
        ? 'rounded-[18px] text-white'
        : `rounded-[10px] ${mine ? t.own : t.peer}`;

  return (
    <div className={`flex min-w-0 max-w-[calc(100%-92px)] flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <button
        type="button"
        data-testid="voice-bubble"
        data-voice-active={isPlaying ? 'true' : 'false'}
        aria-label={isPlaying ? '暂停语音' : '播放语音'}
        onClick={(e) => {
          e.stopPropagation();
          voicePlayer.toggle(msgId, voice.url);
        }}
        className={`flex w-fit min-w-[96px] items-center gap-2 px-3 py-[9px] transition-transform active:scale-[0.98] ${bubbleCls}`}
        style={style}
      >
        {isPlaying ? (
          <Pause className="h-[17px] w-[17px] shrink-0" strokeWidth={2.2} aria-hidden="true" />
        ) : (
          <Play className="h-[17px] w-[17px] shrink-0" strokeWidth={2.2} aria-hidden="true" />
        )}
        {/* 波形：播放中按进度填色；QQ/信息 我方白条，微信黑条 */}
        <span className="flex h-[18px] items-center gap-[2.5px]" aria-hidden="true">
          {bars.map((h, i) => {
            const filled = isActive && progress * bars.length > i;
            return (
              <span
                key={i}
                className={`w-[2.5px] rounded-full transition-colors duration-100 ${
                  filled ? 'bg-current' : 'bg-current opacity-40'
                }`}
                style={{ height: `${Math.max(3, Math.round(h * 18))}px` }}
              />
            );
          })}
        </span>
        <span className="shrink-0 text-[13px] leading-none opacity-80">{voiceDurationLabel(voice.duration)}</span>
      </button>
      {/* 转文字结果（气泡下方小字）：识别中提示 / 已完成的结果（长按菜单「复制」可复制） */}
      {voice.stt === 'pending' && (
        <span className="mt-[3px] px-1 text-[12px] leading-[1.4] opacity-50" data-testid="voice-stt-pending">
          转文字中…
        </span>
      )}
      {voice.stt === 'done' && voice.transcript && (
        <span
          data-testid="voice-transcript"
          className={`mt-[3px] max-w-full whitespace-pre-wrap break-words px-1 text-[12.5px] leading-[1.45] ${
            mine ? t.ownTranscript : t.peerTranscript
          }`}
        >
          {voice.transcript}
        </span>
      )}
    </div>
  );
}
