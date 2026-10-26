'use client';

/**
 * 语音消息气泡（微信 / QQ / 信息 / 两端群聊共用）：
 * - 微信（theme='wx'）：**真机同款「时长 + 喇叭」气泡**——无圆形播放钮、无波形条，
 *   我方绿气泡「5″ 喇叭」（时长在左、喇叭口朝左对着时长）/ 对方白气泡「喇叭 5″」（镜像）；
 *   气泡宽度随时长伸缩（1s→80px、每秒 +4px、60s 封顶约 300px）；播放中喇叭的两道声波
 *   弧线交替闪动（约 420ms 互换，播完恢复静态常亮）；点击气泡任意处播放/暂停
 *   （全局单例：新播自动停旧，也停 TTS 朗读）
 * - QQ / 信息：圆形播放钮（**三角/暂停图标，与 QQ 一致**）+ **随宽度伸缩的录音波形条**
 *   （voice.wave，播放中按进度逐根点亮，播放完成恢复默认）+ **固定在气泡右侧的时长**；
 *   宽度 = 60 基础 + 时长 × 3px/秒（1s→63px、60s→240px 封顶）
 * - 圆角与各端文本气泡同规格（微信 5px / QQ 12px / 信息 18px）；微信气泡带同色小尾巴
 *   （rotate-45 小三角靠头像一侧，与文本气泡同款）
 * - 转文字结果（stt='done'）以**白色圆角小面板**显示在气泡下方（微信原生同款：浅色
 *   bg-white / 深色 #2C2C2C，三端通用，紧贴气泡下方 5px）；stt='pending' 显示「转文字中…」
 * - 长按菜单由外层 {...bubblePress} 提供，组件本身只处理点击播放
 */

import { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useVoicePlayback, voicePlayer } from '@/lib/ios/voice-player';
import { voiceDurationLabel } from '@/lib/ios/audio-utils';

/** 语音消息数据（各端消息结构统一挂 m.voice） */
export interface VoiceMsgData {
  /** 音频 dataURL（持久化在聊天记录里，重启后仍可播放）；文字转语音/内置引擎 AI 语音消息为空串 */
  url: string;
  /** 秒（≥1） */
  duration: number;
  /** 静态波形（0~1，约 20 根；录音时真实振幅采样）。微信端不展示波形（真机无波形），仅 QQ/信息气泡使用 */
  wave: number[];
  /** 仿真朗读原文（文字转语音消息/AI 静音语音条）。点击气泡：我方消息（无 contactId）走静音
   *  进度动画；AI 语音消息（带 contactId）按角色音色实时朗读真实出声（Task 33）；仅历史存量
   *  synth='builtin' 旧消息同样实时朗读 */
  localText?: string;
  /** AI 语音消息合成通道：'api' = 已存真实音频 dataURL；'builtin' = 内置引擎实时朗读，
   *  仅存在于历史存量旧消息（新版内置通道不发该标记，留空 = 静音语音条，点击由
   *  voice-player 按 contactId 走角色音色实时朗读，配置了声音即出声） */
  synth?: 'builtin' | 'api';
  /** 发送该语音的联系人 id（AI 语音消息实时朗读时解析角色音色用） */
  contactId?: string;
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
    // 转文字白面板文字色（微信参考截图：近黑大字；深色面板上 85% 白），三端一致
    ownTranscript: 'text-black/[0.82] dark:text-white/85',
    peerTranscript: 'text-black/[0.82] dark:text-white/85',
  },
  qq: {
    own: 'text-white',
    peer: 'bg-white text-[#1F2329] dark:bg-[#2A2C31] dark:text-white',
    dark: true,
    ownTranscript: 'text-black/70 dark:text-white/80',
    peerTranscript: 'text-black/70 dark:text-white/80',
  },
  im: {
    own: 'text-white',
    peer: 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white',
    dark: true,
    ownTranscript: 'text-black/70 dark:text-white/80',
    peerTranscript: 'text-black/70 dark:text-white/80',
  },
};

/* ───────── 宽度与波形几何（QQ / 信息端） ───────── */

/** QQ/信息：基础宽度 60 + 时长 × 3px/秒，封顶 240：1s→63px、10s→90px、60s→240px（超出不再增长） */
function bubbleWidth(duration: number): number {
  const d = Math.max(1, Math.round(duration));
  return Math.min(240, 60 + d * 3);
}

/** 微信：1s→86px，每秒 +4px，60s 封顶约 300px（真机 3″≈90px 同比例，宽度即时长感） */
function wxBubbleWidth(duration: number): number {
  const d = Math.max(1, Math.round(duration));
  return Math.min(300, 86 + (d - 1) * 4);
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

/** 波形条：随气泡宽度伸缩；播放中按进度逐根点亮（bg-current 自适应两端配色），播完恢复默认（QQ/信息端用） */
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

/**
 * 微信语音喇叭图标（真机同款：实心小喇叭 + 两道声波弧线，单色跟随气泡文字色）。
 * flip = true 水平镜像（我方绿气泡：喇叭口朝左、朝向左侧的时长文字；对方气泡口朝右）。
 * playing 时两道弧线 opacity 交替闪动（interval 驱动，~420ms 互换一次），停止恢复静态常亮。
 */
function WxVoiceGlyph({ size = 18, flip = false, playing = false }: { size?: number; flip?: boolean; playing?: boolean }) {
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    if (!playing) return; // 停止时不读 alt（静态常亮），无需复位
    const timer = window.setInterval(() => setAlt((v) => !v), 420);
    return () => window.clearInterval(timer);
  }, [playing]);
  // 播放中两道弧交替闪（一亮一暗互换）；静止时常亮且比喇叭主体淡一档（真机声波弧更浅）
  const near = playing ? (alt ? 1 : 0.15) : 0.8;
  const far = playing ? (alt ? 0.15 : 1) : 0.62;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      style={{ transform: flip ? 'scaleX(-1)' : undefined }}
      className="shrink-0"
    >
      {/* 实心喇叭主体（口朝右；flip 后朝左对着时长文字） */}
      <path
        d="M5.2 9.3 h2.5 l3.7 -3.15 a0.72 0.72 0 0 1 1.2 0.55 v10.6 a0.72 0.72 0 0 1 -1.2 0.55 l-3.7 -3.15 H5.2 a0.85 0.85 0 0 1 -0.85 -0.85 v-3.7 a0.85 0.85 0 0 1 0.85 -0.85 Z"
        fill="currentColor"
        stroke="none"
      />
      {/* 两道声波弧线（播放中交替闪动） */}
      <path d="M15.5 9.4 a3.9 3.9 0 0 1 0 5.2" style={{ opacity: near }} className="transition-opacity duration-150" />
      <path d="M18 7.4 a6 6 0 0 1 0 9.2" style={{ opacity: far }} className="transition-opacity duration-150" />
    </svg>
  );
}

/**
 * 微信真机同款时长文字：数字 17px，后缀 ′/″ 上标小字（真机「3″」撇号悬在数字肩部）。
 * voiceDurationLabel 返回如 3″ / 1′05″，逐字符拆分：数字正常大小，撇号缩小上提。
 */
function WxDuration({ label }: { label: string }) {
  return (
    <span className="shrink-0 whitespace-nowrap text-[17px] leading-none tabular-nums">
      {[...label].map((ch, i) =>
        ch === '′' || ch === '″' ? (
          <span key={i} className="ml-[1px] text-[11.5px] leading-none" style={{ verticalAlign: '0.42em' }}>
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        )
      )}
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
  /** 气泡宽度随时长动态变化：微信 80 基础 + 4px/秒封顶 300；QQ/信息 60 基础 + 3px/秒封顶 240 */
  const width = isWx ? wxBubbleWidth(voice.duration) : bubbleWidth(voice.duration);
  /** 波形条数随宽度伸缩（仅 QQ/信息端有波形） */
  const bars = isWx ? 0 : barCountFor(bubbleWidth(voice.duration), label);
  /** 播放钮配色：信息对方品牌蓝；QQ 对方蓝、我方半透明白（微信端不渲染播放钮） */
  const circleCls = mine
    ? 'bg-white/25 text-white'
    : theme === 'im'
      ? 'bg-[#007AFF] text-white'
      : 'bg-[#0099FF] text-white';

  /** 圆角与各端文本气泡同规格：微信 12px（真机绿/白气泡同款圆角）、QQ 12px、信息 18px（iOS 圆气泡） */
  const bubbleCls = isWx
    ? `relative rounded-[12px] ${mine ? t.own : t.peer}`
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
          voicePlayer.toggle(msgId, voice.url, voice.localText, { synth: voice.synth, contactId: voice.contactId });
        }}
        className={`flex select-none items-center transition-transform active:scale-[0.98] ${bubbleCls} ${
          isWx ? 'h-[44px] gap-[5px] px-[10px]' : 'h-[40px] gap-[4px] px-[6px]'
        }`}
        style={{ width, ...style }}
      >
        {/* 微信同款小尾巴（指向发送者一侧，带圆角的斜切三角，真机弧形尾） */}
        {isWx && (
          <span
            aria-hidden="true"
            className={`absolute top-[14px] h-[10px] w-[10px] rotate-45 rounded-[2px] ${
              mine ? '-right-[3.5px] bg-[#95EC69] dark:bg-[#3EB575]' : '-left-[3.5px] bg-white dark:bg-[#1E1E1E]'
            }`}
          />
        )}
        {isWx ? (
          /* 微信真机同款：时长 + 喇叭（我方「时长在左、喇叭口朝左」；对方镜像）——无播放钮无波形 */
          mine ? (
            <>
              <WxDuration label={label} />
              <WxVoiceGlyph size={20} playing={isPlaying} flip />
            </>
          ) : (
            <>
              <WxVoiceGlyph size={20} playing={isPlaying} />
              <WxDuration label={label} />
            </>
          )
        ) : (
          <>
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
          </>
        )}
      </button>
      {/* 转文字结果：识别中提示 / 已完成的结果（长按菜单「复制」可复制）。微信端为真机同款
          「气泡下方白色圆角大气泡」——扁平纯白、大字号、无描边阴影（用户参考截图样式）；
          QQ / 信息端维持此前的轻量小面板 */}
      {voice.stt === 'pending' && (
        <span className="mt-[3px] px-1 text-[12px] leading-[1.4] opacity-50" data-testid="voice-stt-pending">
          转文字中…
        </span>
      )}
      {voice.stt === 'done' && voice.transcript && (
        <span
          data-testid="voice-transcript"
          className={
            isWx
              ? `mt-[8px] w-fit max-w-full whitespace-pre-wrap break-words rounded-[12px] bg-white px-[14px] py-[10px] text-[16px] leading-[1.55] dark:bg-[#2C2C2C] ${
                  mine ? t.ownTranscript : t.peerTranscript
                }`
              : `mt-[5px] w-fit max-w-full whitespace-pre-wrap break-words rounded-[8px] bg-white px-[12px] py-[10px] text-[12.5px] leading-[1.55] shadow-[0_1px_4px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.05] dark:bg-[#2C2C2C] dark:ring-white/[0.07] ${
                  mine ? t.ownTranscript : t.peerTranscript
                }`
          }
        >
          {voice.transcript}
        </span>
      )}
    </div>
  );
}
