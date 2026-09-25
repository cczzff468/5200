'use client';

/**
 * 语音消息气泡（微信 / QQ / 信息 / 两端群聊共用），微信与 QQ 统一同款结构：
 * - 圆形播放钮（**三角/暂停图标，与 QQ 一致**）+ **随宽度伸缩的录音波形条**（voice.wave，
 *   播放中按进度逐根点亮，播放完成恢复默认）+ **固定在气泡右侧的时长**
 * - 圆角与各端文本气泡同规格（微信 5px / QQ 12px / 信息 18px）
 * - 气泡宽度**随时长动态变化**：宽度 = 60 基础 + 时长 × 3px/秒（线性平滑不跳变），
 *   1s → 63px、60s → 240px 封顶，超过 60s 不再增长；波形条数随宽度增减（1→约 32 根）
 * - 点击气泡切换播放/暂停（全局单例：新播自动停旧，也停 TTS 朗读）
 * - 转文字结果（stt='done'）以**白色圆角小面板**显示在气泡下方（微信原生同款）；
 *   stt='pending' 显示「转文字中…」
 * - 长按菜单由外层 {...bubblePress} 提供，组件本身只处理点击播放
 */

import { Pause, Play } from 'lucide-react';
import { useVoicePlayback, voicePlayer } from '@/lib/ios/voice-player';
import { voiceDurationLabel } from '@/lib/ios/audio-utils';

/** 语音消息数据（各端消息结构统一挂 m.voice） */
export interface VoiceMsgData {
  /** 音频 dataURL（持久化在聊天记录里，重启后仍可播放）；文字转语音消息为空串 */
  url: string;
  /** 秒（≥1） */
  duration: number;
  /** 静态波形（0~1，约 20 根；录音时真实振幅采样） */
  wave: number[];
  /** 本地合成朗读原文（文字转语音消息；播放时走浏览器 speechSynthesis，无需语音 API） */
  localText?: string;
  /** 转文字结果（长按「转文字」后写入 / 文字转语音的原文） */
  transcript?: string;
  /** pending = 识别中；done = 有结果；failed = 识别失败（可长按重试） */
  stt?: 'pending' | 'done' | 'failed';
}

export type VoiceBubbleTheme = 'wx' | 'qq' | 'im';

/** 各端配色（own = 我方绿/蓝气泡；peer = 对方白/灰气泡）；dark = 我方为彩色/深底（白色钮与图标） */
const THEME: Record<VoiceBubbleTheme, { own: string; peer: string; dark: boolean; ownTranscript: string; peerTranscript: string }> = {
  wx: {
    own: 'bg-[#95EC69] text-black/[0.78] dark:bg-[#3EB575] dark:text-black/80',
    peer: 'bg-white text-black/[0.78] dark:bg-[#1E1E1E] dark:text-white/90',
    dark: false,
    ownTranscript: 'text-black/50 dark:text-white/55',
    peerTranscript: 'text-black/50 dark:text-white/55',
  },
  qq: {
    own: 'text-white',
    peer: 'bg-white text-[#1F2329] dark:bg-[#2A2C31] dark:text-white',
    dark: true,
    ownTranscript: 'text-black/50 dark:text-white/55',
    peerTranscript: 'text-black/50 dark:text-white/55',
  },
  im: {
    own: 'text-white',
    peer: 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white',
    dark: true,
    ownTranscript: 'text-black/50 dark:text-white/55',
    peerTranscript: 'text-black/50 dark:text-white/55',
  },
};

/* ───────── 宽度与波形几何（两端统一） ───────── */

/** 基础宽度 60 + 时长 × 3px/秒，封顶 240：1s→63px、10s→90px、60s→240px（超出不再增长） */
function bubbleWidth(duration: number): number {
  const d = Math.max(1, Math.round(duration));
  return Math.min(240, 60 + d * 3);
}

const BAR_W = 2.5;
const BAR_GAP = 3;
const BAR_STRIDE = BAR_W + BAR_GAP;
const PAD_X = 12; // 气泡水平内边距（px-[6px]）
const GAP_X = 8; // 两处 item 间距（gap-[4px] × 2）
const CIRCLE = 20; // 播放钮直径

/** 波形条数随气泡宽度伸缩（时长文本按字符宽估算、宁多留空不裁切）：1s→1~2 根 … 60s→约 32 根 */
function barCountFor(width: number, label: string): number {
  const labelW = Math.round(label.length * 6.5);
  const avail = width - PAD_X - GAP_X - CIRCLE - labelW - 2;
  return Math.max(1, Math.min(34, Math.floor((avail + BAR_GAP) / BAR_STRIDE)));
}

/** 语音波形 → count 根展示条（0~1，线性插值——宽度连续变化时波形平滑不跳变）；旧数据无 wave 用固定美观波形兜底 */
function waveBarsOf(wave: number[] | undefined, count: number): number[] {
  const src = wave && wave.length > 0 ? wave : DEFAULT_WAVE;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const pos = count === 1 ? (src.length - 1) / 2 : (i / (count - 1)) * (src.length - 1);
    const a = Math.floor(pos);
    const b = Math.ceil(pos);
    const v = a === b ? src[a] : src[a] + ((src[b] ?? src[a]) - src[a]) * (pos - a);
    out.push(Math.max(0.12, Math.min(1, v)));
  }
  return out;
}

const DEFAULT_WAVE = [0.55, 0.85, 0.4, 0.95, 0.6, 0.78, 0.42, 0.9, 0.58, 0.72, 0.46, 0.8, 0.62, 0.88, 0.5, 0.75, 0.42, 0.9, 0.55, 0.7, 0.48, 0.82];

/** 波形条：随气泡宽度伸缩；播放中按进度逐根点亮（bg-current 自适应两端配色），播完恢复默认 */
function VoiceWaveBars({ wave, active, playing, progress, count }: { wave: number[]; active: boolean; playing: boolean; progress: number; count: number }) {
  const bars = waveBarsOf(wave, count);
  return (
    <span className="flex h-[18px] min-w-0 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden="true">
      {bars.map((v, i) => {
        const filled = active && playing && progress * bars.length > i;
        return (
          <span
            key={i}
            className="w-[2.5px] shrink-0 rounded-full bg-current transition-opacity duration-150"
            style={{ height: `${Math.round(4 + v * 14)}px`, opacity: filled ? 0.9 : 0.35 }}
          />
        );
      })}
    </span>
  );
}

export function VoiceMsgBubble({
  msgId,
  voice,
  side,
  theme,
  style,
}: {
  msgId: string;
  voice: VoiceMsgData;
  /** 'me' | 'peer'：决定配色 */
  side: 'me' | 'peer';
  theme: VoiceBubbleTheme;
  /** QQ/信息 我方气泡的底色等自定义样式（由调用方传 backgroundColor） */
  style?: React.CSSProperties;
}) {
  const { activeId, playing, progress } = useVoicePlayback();
  const mine = side === 'me';
  const t = THEME[theme];
  const isWx = theme === 'wx';
  const isActive = activeId === msgId;
  const isPlaying = isActive && playing;
  const label = voiceDurationLabel(voice.duration);
  /** 气泡宽度随时长动态变化：60 基础 + 3px/秒，封顶 240 */
  const width = bubbleWidth(voice.duration);
  /** 波形条数随宽度伸缩 */
  const bars = barCountFor(width, label);
  /** 彩色/深底（QQ/信息我方）→ 白钮白图标；浅底（微信两端、各端对方）→ 黑系 */
  const darkSide = mine ? t.dark : false;
  /** 播放钮配色：微信两端浅底黑系；信息对方品牌蓝；QQ 对方蓝、我方半透明白 */
  const circleCls =
    theme === 'wx'
      ? 'bg-black/[0.08] text-black/75 dark:bg-white/15 dark:text-white/90'
      : mine
        ? 'bg-white/25 text-white'
        : theme === 'im'
          ? 'bg-[#007AFF] text-white'
          : 'bg-[#0099FF] text-white';

  /** 圆角与各端文本气泡同规格：微信 5px（绿/白气泡同款）、QQ 12px、信息 18px（iOS 圆气泡） */
  const bubbleCls = isWx
    ? `relative rounded-[5px] ${mine ? t.own : t.peer}`
    : theme === 'im'
      ? `rounded-[18px] ${mine ? 'text-white' : t.peer}`
      : `rounded-[12px] ${mine ? 'text-white' : t.peer}`;

  return (
    <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <button
        type="button"
        data-testid="voice-bubble"
        data-voice-active={isPlaying ? 'true' : 'false'}
        aria-label={isPlaying ? '暂停语音' : '播放语音'}
        onClick={(e) => {
          e.stopPropagation();
          voicePlayer.toggle(msgId, voice.url, voice.localText);
        }}
        className={`flex select-none items-center transition-transform active:scale-[0.98] ${bubbleCls} ${
          isWx ? 'h-[44px] gap-[4px] px-[6px]' : 'h-[40px] gap-[4px] px-[6px]'
        }`}
        style={{ width, ...style }}
      >
        {/* 微信同款小尾巴（指向发送者一侧，与文本气泡同规格） */}
        {isWx && (
          <span
            aria-hidden="true"
            className={`absolute top-[13px] h-[8px] w-[8px] rotate-45 ${
              mine ? '-right-[3px] bg-[#95EC69] dark:bg-[#3EB575]' : '-left-[3px] bg-white dark:bg-[#1E1E1E]'
            }`}
          />
        )}
        {/* 圆形播放钮（三角/暂停，与 QQ 一致） */}
        <span
          className={`grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full ${circleCls}`}
          aria-hidden="true"
        >
          {isPlaying ? (
            <Pause className="h-[9px] w-[9px]" fill="currentColor" strokeWidth={0} />
          ) : (
            <Play className="h-[9px] w-[9px] translate-x-[0.5px]" fill="currentColor" strokeWidth={0} />
          )}
        </span>
        {/* 实时录音波形条：随气泡宽度伸缩；播放中按进度点亮 */}
        <VoiceWaveBars wave={voice.wave} active={isActive} playing={isPlaying} progress={progress} count={bars} />
        {/* 时长固定显示在气泡右侧 */}
        <span className="shrink-0 text-[12.5px] leading-none tabular-nums">{label}</span>
      </button>
      {/* 转文字结果（气泡下方白色小面板）：识别中提示 / 已完成的结果（长按菜单「复制」可复制） */}
      {voice.stt === 'pending' && (
        <span className="mt-[3px] px-1 text-[12px] leading-[1.4] opacity-50" data-testid="voice-stt-pending">
          转文字中…
        </span>
      )}
      {voice.stt === 'done' && voice.transcript && (
        <span
          data-testid="voice-transcript"
          className={`mt-[5px] w-fit max-w-full whitespace-pre-wrap break-words rounded-[10px] bg-white px-2.5 py-[7px] text-[12.5px] leading-[1.5] shadow-[0_1px_4px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.05] dark:bg-[#2C2E33] dark:ring-white/[0.07] ${
            mine ? t.ownTranscript : t.peerTranscript
          }`}
        >
          {voice.transcript}
        </span>
      )}
    </div>
  );
}
