'use client';

/**
 * 语音消息气泡（微信 / QQ / 信息 / 两端群聊共用），对齐微信 / QQ NT 原生样式：
 * - 微信风（theme='wx'）：绿/白圆角气泡 + 时长 + **实时录音波形条**（voice.wave，播放中按进度
 *   点亮）+ 喇叭声波图标（我方 [4″ ▂▅▇ 🔊]、对方镜像），微信同款小尾巴；播放中声波双弧
 *   交替闪烁（globals.css 的 wx-voice-arc-a/b）
 * - QQ / 信息风（theme='qq' | 'im'）：对齐 QQ NT —— 圆形播放钮 + 均匀点串音波 + 时长；
 *   播放中点串按进度填色（useVoicePlayback 全局进度，100ms 刷新）
 * - 气泡宽度**随时长伸缩**（1s → 60s 线性变宽，两端钳制）：微信 148→238px、
 *   QQ/信息 132→242px；QQ/信息点串点数也随时长增多（8→22 点），长语音更宽
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
  /** 音频 dataURL（持久化在聊天记录里，重启后仍可播放） */
  url: string;
  /** 秒（≥1） */
  duration: number;
  /** 静态波形（0~1，约 20 根；保留字段兼容旧数据，当前两种风格均以装饰性音波呈现） */
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
    own: 'bg-[#95EC69] text-black/[0.78] dark:bg-[#3EB575] dark:text-black/80',
    peer: 'bg-white text-black/[0.78] dark:bg-[#1E1E1E] dark:text-white/90',
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

/** 时长 → 气泡宽度（px）：1s → min，60s → max 线性伸缩（两端钳制），气泡随语音长短变宽变窄 */
function bubbleWidth(duration: number, min: number, max: number): number {
  const d = Math.max(1, Math.min(60, Math.round(duration)));
  return Math.round(min + ((d - 1) / 59) * (max - min));
}

/** 波形条数（微信气泡内）：12 根，2px 宽 + 2px 间隔 ≈ 46px，与时长标签/喇叭图标同排 */
const WX_WAVE_BARS = 12;

/** 语音波形 → 气泡内 N 根展示条（0~1）；旧数据无 wave 时用固定美观波形兑底 */
function waveBarsOf(wave: number[] | undefined, count: number): number[] {
  if (wave && wave.length > 0) {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const a = Math.floor((i * wave.length) / count);
      const b = Math.max(a + 1, Math.floor(((i + 1) * wave.length) / count));
      let sum = 0;
      for (let j = a; j < b; j++) sum += wave[j] ?? 0.2;
      out.push(Math.max(0.12, Math.min(1, sum / (b - a))));
    }
    return out;
  }
  return [0.55, 0.85, 0.4, 0.95, 0.6, 0.78, 0.42, 0.9, 0.58, 0.72, 0.46, 0.8];
}

/** QQ/信息 点串点数随时长增多：1s → 8 点 … 60s → 22 点（与宽度增长同步，长语音不显空旷） */
function dotCountFor(duration: number): number {
  const d = Math.max(1, Math.min(60, Math.round(duration)));
  return Math.max(8, Math.min(22, Math.round(8 + ((d - 1) / 59) * 14)));
}

/** 微信风波形条：录音真实振幅（播放中按进度逐根点亮，未播段半透明；bg-current 自适应两端配色） */
function WxWaveBars({ wave, active, playing, progress }: { wave: number[]; active: boolean; playing: boolean; progress: number }) {
  const bars = waveBarsOf(wave, WX_WAVE_BARS);
  return (
    <span className="flex h-[18px] shrink-0 items-center gap-[2px]" aria-hidden="true">
      {bars.map((v, i) => {
        const filled = active && playing && progress * bars.length > i;
        return (
          <span
            key={i}
            className="w-[2px] rounded-full bg-current transition-opacity duration-150"
            style={{ height: `${Math.round(4 + v * 14)}px`, opacity: filled ? 0.9 : 0.38 }}
          />
        );
      })}
    </span>
  );
}

/** 微信风声波图标：喇叭 + 双弧（播放中双弧交替闪烁；mirrored = 我方喇叭朝左） */
function WxVoiceIcon({ playing, mirrored }: { playing: boolean; mirrored?: boolean }) {
  return (
    <svg viewBox="0 0 26 20" className={`h-[20px] w-[26px] shrink-0 ${mirrored ? '-scale-x-100' : ''}`} aria-hidden="true">
      <path
        d="M1.5 7.2h3.4L9.2 3.5a.95.95 0 0 1 1.55.74v11.5a.95.95 0 0 1-1.55.74L4.9 12.8H1.5a1 1 0 0 1-1-1v-3.6a1 1 0 0 1 1-1Z"
        fill="currentColor"
      />
      <path
        d="M14.8 6.4a5.2 5.2 0 0 1 0 7.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        className={playing ? 'wx-voice-arc-a' : ''}
      />
      <path
        d="M17.9 3.9a9.2 9.2 0 0 1 0 12.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        className={playing ? 'wx-voice-arc-b' : ''}
      />
    </svg>
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
  const label = voiceDurationLabel(voice.duration);
  /** 对方气泡的播放钮品牌蓝：QQ 蓝 / 信息蓝 */
  const peerCircleCls = theme === 'im' ? 'bg-[#007AFF]' : 'bg-[#0099FF]';
  /** 气泡宽度随时长伸缩（微信含波形条 148→238；QQ/信息 132→242） */
  const width = isWx ? bubbleWidth(voice.duration, 148, 238) : bubbleWidth(voice.duration, 132, 242);
  /** QQ/信息 点串点数随时长增多 */
  const dots = isWx ? 0 : dotCountFor(voice.duration);

  const bubbleCls = isWx
    ? `relative rounded-[10px] ${mine ? t.own : t.peer}`
    : theme === 'qq' && mine
      ? 'rounded-[14px] text-white'
      : theme === 'im' && mine
        ? 'rounded-[17px] text-white'
        : `rounded-[14px] ${t.peer}`;

  return (
    <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <button
        type="button"
        data-testid="voice-bubble"
        data-voice-active={isPlaying ? 'true' : 'false'}
        aria-label={isPlaying ? '暂停语音' : '播放语音'}
        onClick={(e) => {
          e.stopPropagation();
          voicePlayer.toggle(msgId, voice.url);
        }}
        className={`flex select-none items-center justify-center transition-transform active:scale-[0.98] ${bubbleCls} ${
          isWx ? 'h-[48px] gap-2 px-4' : 'h-[42px] gap-2 px-3'
        }`}
        style={{ width, ...style }}
      >
        {isWx ? (
          <>
            {/* 微信同款小尾巴（指向发送者一侧，与文本气泡同规格） */}
            <span
              aria-hidden="true"
              className={`absolute top-[13px] h-[8px] w-[8px] rotate-45 ${
                mine ? '-right-[3px] bg-[#95EC69] dark:bg-[#3EB575]' : '-left-[3px] bg-white dark:bg-[#1E1E1E]'
              }`}
            />
            {/* 时长+波形+喇叭都在气泡内部：我方 [4″ ▂▅▇ 🔊]、对方镜像 [🔊 ▂▅▇ 4″] */}
            {mine ? (
              <>
                <span className="shrink-0 text-[16px] font-medium leading-none tabular-nums">{label}</span>
                <WxWaveBars wave={voice.wave} active={isActive} playing={isPlaying} progress={progress} />
                <WxVoiceIcon playing={isPlaying} mirrored />
              </>
            ) : (
              <>
                <WxVoiceIcon playing={isPlaying} />
                <WxWaveBars wave={voice.wave} active={isActive} playing={isPlaying} progress={progress} />
                <span className="shrink-0 text-[16px] font-medium leading-none tabular-nums">{label}</span>
              </>
            )}
          </>
        ) : (
          <>
            {/* 圆形播放钮（我方半透明白底、对方品牌蓝底） */}
            <span
              className={`grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full ${
                mine ? 'bg-white/25' : peerCircleCls
              }`}
              aria-hidden="true"
            >
              {isPlaying ? (
                <Pause className="h-[13px] w-[13px] text-white" fill="white" strokeWidth={0} />
              ) : (
                <Play className="h-[13px] w-[13px] translate-x-[1px] text-white" fill="white" strokeWidth={0} />
              )}
            </span>
            {/* QQ NT 均匀点串音波：点数随时长增多；播放中按进度填色（未播段降透明度） */}
            <span className="flex h-4 shrink-0 items-center gap-[2.5px]" aria-hidden="true">
              {Array.from({ length: dots }, (_, i) => {
                const filled = isActive && progress * dots > i;
                return (
                  <span
                    key={i}
                    className={`h-[3px] w-[3px] rounded-full bg-current transition-opacity duration-100 ${
                      filled ? 'opacity-100' : 'opacity-40'
                    }`}
                  />
                );
              })}
            </span>
            <span className="shrink-0 text-[14px] leading-none">{label}</span>
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
