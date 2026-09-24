'use client';

/**
 * 语音消息气泡（微信 / QQ / 信息 / 两端群聊共用），样式对齐用户参考截图：
 * - 微信风（theme='wx'）：绿底白字，无播放按钮无波形条 —— 时长 + 喇叭图标（我方时长在左、
 *   喇叭在右；对方镜像：喇叭在左、时长在右）；播放中喇叭图标呼吸闪烁
 * - QQ / 信息风（theme='qq' | 'im'）：圆形播放钮（我方半透明白底、对方品牌蓝底）+ 白色波形条 +
 *   时长；播放中波形按进度填色（useVoicePlayback 全局进度，100ms 刷新）
 * - 点击气泡切换播放/暂停（全局单例：新播自动停旧，也停 TTS 朗读）
 * - 转文字结果（stt='done'）以小字显示在气泡下方；stt='pending' 显示「转文字中…」
 * - 长按菜单由外层 {...bubblePress} 提供，组件本身只处理点击播放
 */

import { Pause, Play, Volume2 } from 'lucide-react';
import { useVoicePlayback, voicePlayer } from '@/lib/ios/voice-player';
import { voiceDurationLabel } from '@/lib/ios/audio-utils';

/** 语音消息数据（各端消息结构统一挂 m.voice） */
export interface VoiceMsgData {
  /** 音频 dataURL（持久化在聊天记录里，重启后仍可播放） */
  url: string;
  /** 秒（≥1） */
  duration: number;
  /** 静态波形（0~1，约 20 根；微信风不展示，仍保留供 QQ 风使用） */
  wave: number[];
  /** 转文字结果（长按「转文字」后写入 / 文字转语音的原文） */
  transcript?: string;
  /** pending = 识别中；done = 有结果；failed = 识别失败（可长按重试） */
  stt?: 'pending' | 'done' | 'failed';
}

export type VoiceBubbleTheme = 'wx' | 'qq' | 'im';

/** 各端配色（own = 我方绿/蓝气泡；peer = 对方白/灰气泡） */
const THEME: Record<VoiceBubbleTheme, { own: string; peer: string; ownTranscript: string; peerTranscript: string }> = {
  wx: {
    own: 'bg-[#95EC69] text-white dark:bg-[#3EB575] dark:text-white',
    peer: 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white',
    ownTranscript: 'text-black/50 dark:text-white/55',
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

/** 波形条静态兜底（无采样数据时） */
const FALLBACK_BARS = [0.35, 0.55, 0.4, 0.75, 0.5, 0.85, 0.45, 0.65, 0.4, 0.8, 0.5, 0.7, 0.35, 0.75, 0.45, 0.65, 0.4, 0.7];

export function VoiceMsgBubble({
  msgId,
  voice,
  side,
  theme,
  style,
}: {
  msgId: string;
  voice: VoiceMsgData;
  /** 'me' | 'peer'：决定配色与图标方向 */
  side: 'me' | 'peer';
  theme: VoiceBubbleTheme;
  /** QQ/信息 我方气泡的底色等自定义样式（由调用方传 backgroundColor） */
  style?: React.CSSProperties;
}) {
  const { activeId, playing, progress } = useVoicePlayback();
  const mine = side === 'me';
  const t = THEME[theme];
  const isActive = activeId === msgId;
  const isPlaying = isActive && playing;
  const isWx = theme === 'wx';
  const bars = voice.wave.length > 0 ? voice.wave : FALLBACK_BARS;
  const label = voiceDurationLabel(voice.duration);
  /** 对方气泡的播放钮品牌蓝：QQ 蓝 / 信息蓝 */
  const peerCircleCls = theme === 'im' ? 'bg-[#007AFF]' : 'bg-[#0099FF]';

  const bubbleCls = isWx
    ? `rounded-[10px] ${mine ? t.own : t.peer}`
    : theme === 'qq' && mine
      ? 'rounded-[12px] text-white'
      : theme === 'im' && mine
        ? 'rounded-[18px] text-white'
        : `rounded-[12px] ${t.peer}`;

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
        className={`flex w-fit items-center transition-transform active:scale-[0.98] ${bubbleCls} ${
          isWx ? 'min-w-[86px] gap-2.5 px-3.5 py-[11px]' : 'gap-2.5 px-3 py-[10px]'
        }`}
        style={style}
      >
        {isWx ? (
          /* 微信风：时长 + 喇叭图标（对方镜像），播放中图标呼吸 */
          mine ? (
            <>
              <span className="shrink-0 text-[15px] leading-none">{label}</span>
              <Volume2
                className={`h-[19px] w-[19px] shrink-0 ${isPlaying ? 'animate-pulse' : ''}`}
                strokeWidth={2}
                aria-hidden="true"
              />
            </>
          ) : (
            <>
              <Volume2
                className={`h-[19px] w-[19px] shrink-0 -scale-x-100 ${isPlaying ? 'animate-pulse' : ''}`}
                strokeWidth={2}
                aria-hidden="true"
              />
              <span className="shrink-0 text-[15px] leading-none">{label}</span>
            </>
          )
        ) : (
          <>
            {/* QQ/信息风：圆形播放钮（我方半透明白底、对方品牌蓝底） */}
            <span
              className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full ${
                mine ? 'bg-white/25' : peerCircleCls
              }`}
              aria-hidden="true"
            >
              {isPlaying ? (
                <Pause className="h-[15px] w-[15px] text-white" fill="white" strokeWidth={0} />
              ) : (
                <Play className="h-[15px] w-[15px] translate-x-[1px] text-white" fill="white" strokeWidth={0} />
              )}
            </span>
            {/* 波形条：播放中按进度填色（未播段降透明度） */}
            <span className="flex h-[24px] items-center gap-[3px]" aria-hidden="true">
              {bars.map((h, i) => {
                const filled = isActive && progress * bars.length > i;
                return (
                  <span
                    key={i}
                    className={`w-[3px] rounded-full bg-current transition-opacity duration-100 ${
                      filled ? 'opacity-100' : 'opacity-45'
                    }`}
                    style={{ height: `${Math.max(5, Math.round(h * 24))}px` }}
                  />
                );
              })}
            </span>
            <span className="shrink-0 text-[15px] leading-none">{label}</span>
          </>
        )}
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
          className={`mt-[3px] w-fit min-w-[180px] max-w-full whitespace-pre-wrap break-words px-1 text-[12.5px] leading-[1.45] ${
            mine ? t.ownTranscript : t.peerTranscript
          }`}
        >
          {voice.transcript}
        </span>
      )}
    </div>
  );
}
