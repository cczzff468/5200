'use client';

/**
 * 语音消息气泡（微信 / QQ / 信息 / 两端群聊共用），第三十三轮按用户参考截图重做（与真机微信一致）：
 * - 结构只有两样：**时长文本（5″ / 1′05″）+ 黑色声波图标（喇叭 + 双弧）**——
 *   去掉旧版的圆形播放钮与波形条；微信端再去掉小尾巴、圆角放大到 10px
 * - 我方消息：时长在左、图标在右（声波朝右）；对方消息：镜像（图标在左、声波朝左、时长在右）
 * - 气泡宽度**随时长动态变化**：88 基础 + 时长 × 3px/秒（1s→91px、5s→103px、60s→240px 封顶）
 * - 点击气泡切换播放/暂停（全局单例：新播自动停旧，也停 TTS 朗读）；
 *   播放中两道声波弧按播放进度先后点亮，播完恢复常亮
 * - 转文字结果（stt='done'）以**白色圆角小面板**显示在气泡下方（微信原生同款）；
 *   stt='pending' 显示「转文字中…」
 * - 长按菜单由外层 {...bubblePress} 提供，组件本身只处理点击播放
 */

import { useVoicePlayback, voicePlayer } from '@/lib/ios/voice-player';
import { voiceDurationLabel } from '@/lib/ios/audio-utils';

/** 语音消息数据（各端消息结构统一挂 m.voice） */
export interface VoiceMsgData {
  /** 音频 dataURL（持久化在聊天记录里，重启后仍可播放）；文字转语音/内置引擎 AI 语音消息为空串 */
  url: string;
  /** 秒（≥1） */
  duration: number;
  /** 静态波形（0~1，约 20 根；录音时真实振幅采样）——第三十三轮 UI 改版后不再上屏，字段保留兼容旧数据 */
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

/** 各端配色（own = 我方绿/蓝气泡；peer = 对方白/灰气泡）；dark = 我方为彩色/深底（白钮与图标） */
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

/* ───────── 宽度（随时长伸缩） ───────── */

/** 基础宽度 88 + 时长 × 3px/秒，封顶 240：1s→91px、5s→103px、10s→118px、60s→240px（超出不再增长） */
function bubbleWidth(duration: number): number {
  const d = Math.max(1, Math.round(duration));
  return Math.min(240, 88 + d * 3);
}

/**
 * 声波图标（参考截图同款：实心喇叭 + 双弧）。own 消息声波朝右；peer 消息整只镜像（声波朝左）。
 * 播放中两道弧按播放进度先后点亮（未点亮压暗），非播放态全部常亮。
 */
function VoiceSoundIcon({ playing, progress, mirror }: { playing: boolean; progress: number; mirror: boolean }) {
  const arc1 = !playing || progress > 0.18;
  const arc2 = !playing || progress > 0.55;
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-[17px] w-[17px] shrink-0 ${mirror ? '-scale-x-100' : ''}`}
      aria-hidden="true"
    >
      {/* 喇叭（实心） */}
      <path d="M4.6 9.4v5.2h3.1l4.5 3.9a.7.7 0 0 0 1.16-.53V6.03a.7.7 0 0 0-1.16-.53L7.7 9.4H4.6z" fill="currentColor" />
      {/* 双弧（播放中按进度点亮） */}
      <path
        d="M16.2 9.2a4.4 4.4 0 0 1 0 5.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity={arc1 ? 0.92 : 0.28}
        style={{ transition: 'opacity 180ms ease' }}
      />
      <path
        d="M18.9 6.6a8.2 8.2 0 0 1 0 10.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity={arc2 ? 0.92 : 0.28}
        style={{ transition: 'opacity 180ms ease' }}
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
  const isWx = theme === 'wx';
  const isActive = activeId === msgId;
  const isPlaying = isActive && playing;
  const label = voiceDurationLabel(voice.duration);
  /** 气泡宽度随时长动态变化：88 基础 + 3px/秒，封顶 240 */
  const width = bubbleWidth(voice.duration);

  /** 圆角与高度：微信 10px/42px（参考截图同款，无尾巴）；QQ 12px、信息 18px（iOS 圆气泡）保持原规格 */
  const bubbleCls = isWx
    ? 'rounded-[10px] h-[42px]'
    : theme === 'im'
      ? 'rounded-[18px] h-[40px]'
      : 'rounded-[12px] h-[40px]';

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
        className={`flex select-none items-center justify-center gap-[7px] px-4 transition-transform active:scale-[0.98] ${bubbleCls} ${
          mine ? t.own : t.peer
        }`}
        style={{ width, ...style }}
      >
        {/* 我方：时长在左、声波在右（朝右）；对方：镜像（声波朝左、时长在右）——真机微信同款 */}
        {mine ? (
          <>
            <span className="shrink-0 text-[13.5px] leading-none tabular-nums">{label}</span>
            <VoiceSoundIcon playing={isPlaying} progress={progress} mirror={false} />
          </>
        ) : (
          <>
            <VoiceSoundIcon playing={isPlaying} progress={progress} mirror />
            <span className="shrink-0 text-[13.5px] leading-none tabular-nums">{label}</span>
          </>
        )}
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
          className={`mt-[5px] w-fit max-w-full whitespace-pre-wrap break-words rounded-[4px] bg-white px-2.5 py-[7px] text-[12.5px] leading-[1.5] shadow-[0_1px_4px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.05] dark:bg-[#2C2E33] dark:ring-white/[0.07] ${
            mine ? t.ownTranscript : t.peerTranscript
          }`}
        >
          {voice.transcript}
        </span>
      )}
    </div>
  );
}
