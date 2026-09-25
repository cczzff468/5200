'use client';

/**
 * 语音消息气泡（微信 / QQ / 信息 / 两端群聊共用），对齐微信 / QQ NT 原生样式：
 * - 微信风（theme='wx'）：绿/白圆角气泡 + 喇叭声波图标（我方喇叭朝左、对方镜像朝右）+
 *   微信同款小尾巴；时长在气泡外侧小灰字（我方在左、对方在右）；
 *   播放中声波双弧交替闪烁（globals.css 的 wx-voice-arc-a/b）
 * - QQ / 信息风（theme='qq' | 'im'）：对齐 QQ NT —— 圆形播放钮 + 均匀点串音波 + 时长；
 *   播放中点串按进度填色（useVoicePlayback 全局进度，100ms 刷新）
 * - 点击气泡切换播放/暂停（全局单例：新播自动停旧，也停 TTS 朗读）
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

/** QQ NT 均匀点串音波的点数 */
const WAVE_DOTS = 15;

/** 微信风声波图标：喇叭 + 双弧（播放中双弧交替闪烁；mirrored = 我方喇叭朝左） */
function WxVoiceIcon({ playing, mirrored }: { playing: boolean; mirrored?: boolean }) {
  return (
    <svg viewBox="0 0 26 20" className={`h-[19px] w-[24px] ${mirrored ? '-scale-x-100' : ''}`} aria-hidden="true">
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

  const bubbleCls = isWx
    ? `relative rounded-[8px] ${mine ? t.own : t.peer}`
    : theme === 'qq' && mine
      ? 'rounded-[14px] text-white'
      : theme === 'im' && mine
        ? 'rounded-[17px] text-white'
        : `rounded-[14px] ${t.peer}`;

  return (
    <div className={`flex min-w-0 max-w-[calc(100%-92px)] flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div className={`flex min-w-0 items-center ${isWx ? 'gap-[5px]' : ''} ${isWx && mine ? 'flex-row-reverse' : ''}`}>
        <button
          type="button"
          data-testid="voice-bubble"
          data-voice-active={isPlaying ? 'true' : 'false'}
          aria-label={isPlaying ? '暂停语音' : '播放语音'}
          onClick={(e) => {
            e.stopPropagation();
            voicePlayer.toggle(msgId, voice.url);
          }}
          className={`flex w-fit select-none items-center transition-transform active:scale-[0.98] ${bubbleCls} ${
            isWx ? 'px-3.5 py-[10px]' : 'gap-2.5 px-3 py-[8px]'
          }`}
          style={style}
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
              <WxVoiceIcon playing={isPlaying} mirrored={mine} />
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
              {/* QQ NT 均匀点串音波：播放中按进度填色（未播段降透明度） */}
              <span className="flex h-[18px] shrink-0 items-center gap-[3px]" aria-hidden="true">
                {Array.from({ length: WAVE_DOTS }, (_, i) => {
                  const filled = isActive && progress * WAVE_DOTS > i;
                  return (
                    <span
                      key={i}
                      className={`h-[3.5px] w-[3.5px] rounded-full bg-current transition-opacity duration-100 ${
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
        {/* 微信风：时长在气泡外侧小灰字（我方在左、对方在右，行容器已镜像） */}
        {isWx && <span className="shrink-0 text-[13px] leading-none text-black/35 dark:text-white/40">{label}</span>}
      </div>
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
