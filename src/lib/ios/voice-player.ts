/**
 * 语音消息播放器（单聊/群聊语音气泡共用，模块级单例）：
 * - 一条语音在播时再点其它语音 → 自动停旧的播新的；暂停/继续同一实例（进度保留）
 * - 进度 0~1 每 100ms 广播，气泡波形按进度填充
 * - 双通道：普通语音 = 音频文件（dataURL，真实出声）；文字转语音消息（带 localText）=
 *   **静音模拟播放**——不出声、不需要语音 API，点击只按估算时长推进波形进度动画
 * - 与 TTS 朗读（电话/微信/QQ「播放语音」按钮）互斥：播放前 stopOtherAudio 停掉对方
 * - stopVoicePlayback() 供聊天页卸载/切换会话/开录前释放
 */

import { create } from 'zustand';
import { registerAudioSource, stopOtherAudio } from './audio-focus';
import { estimateSpeakDuration } from './voice-send';

interface VoicePlayStore {
  /** 正在播放（或暂停挂起）的语音消息 id */
  activeId: string | null;
  /** 是否正在播放（false = 暂停或无播放） */
  playing: boolean;
  /** 播放进度 0~1 */
  progress: number;
}

export const useVoicePlayback = create<VoicePlayStore>(() => ({
  activeId: null,
  playing: false,
  progress: 0,
}));

let audio: HTMLAudioElement | null = null;
let currentId: string | null = null;
let currentUrl: string | null = null;
let timer: number | null = null;

/** 静音模拟播放状态（文字转语音消息）：进度 = offset + 本次起点以来经过的时间 */
interface SimState {
  id: string;
  dur: number;
  offset: number;
  startedAt: number;
}
let simState: SimState | null = null;

function clearTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function teardown(): void {
  clearTimer();
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    try {
      audio.pause();
    } catch {
      // 已释放的 Audio 再 pause 不抛错
    }
    audio.src = '';
    audio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  currentId = null;
  simState = null;
}

/** 停止当前语音播放并清空状态（页面卸载/切换会话/新播放前调用；含静音模拟） */
export function stopVoicePlayback(): void {
  teardown();
  useVoicePlayback.setState({ activeId: null, playing: false, progress: 0 });
}

/** 静音模拟进度计时：按估算时长推进 0~1（暂停时不推进，到点自动结束） */
function startSimTimer(id: string): void {
  clearTimer();
  timer = window.setInterval(() => {
    if (!simState || simState.id !== id) return;
    if (!useVoicePlayback.getState().playing) return;
    const elapsed = simState.offset + (performance.now() - simState.startedAt) / 1000;
    if (elapsed >= simState.dur) {
      stopVoicePlayback();
      return;
    }
    useVoicePlayback.setState({ progress: Math.min(1, elapsed / simState.dur) });
  }, 100);
}

/** 静音模拟路径（文字转语音消息）：点击切换 播放/暂停/继续，全程不出声 */
function toggleSim(id: string, dur: number): void {
  const st = useVoicePlayback.getState();
  if (st.activeId === id) {
    if (st.playing) {
      // 暂停：记录已走秒数
      if (simState && simState.id === id) {
        simState.offset += (performance.now() - simState.startedAt) / 1000;
      }
      useVoicePlayback.setState({ playing: false });
    } else {
      // 继续
      if (simState && simState.id === id) simState.startedAt = performance.now();
      useVoicePlayback.setState({ playing: true });
      startSimTimer(id);
    }
    return;
  }
  // 新播放：停掉其它音频/模拟播放（单实例）
  stopOtherAudio('voice-msg');
  teardown();
  simState = { id, dur, offset: 0, startedAt: performance.now() };
  useVoicePlayback.setState({ activeId: id, playing: true, progress: 0 });
  startSimTimer(id);
}

/** 开始/继续播放。src 为 dataURL（消息里持久化的音频） */
function startPlay(id: string, src: string, fromPause: boolean): void {
  const sameInstance = fromPause && audio !== null && currentId === id;
  if (!sameInstance) {
    // 新播放开始前停掉其它音频（TTS 朗读/静音模拟等）
    stopOtherAudio('voice-msg');
    teardown();
    audio = new Audio(src);
    currentId = id;
    currentUrl = src.startsWith('blob:') ? src : null; // dataURL 不需要 revoke
    useVoicePlayback.setState({ activeId: id, playing: true, progress: 0 });
  } else {
    useVoicePlayback.setState({ activeId: id, playing: true });
  }
  if (!audio) return;
  const a: HTMLAudioElement = audio;
  a.onended = () => stopVoicePlayback();
  a.onerror = () => stopVoicePlayback();
  clearTimer();
  timer = window.setInterval(() => {
    if (!audio || audio.paused || audio.ended) return;
    const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    useVoicePlayback.setState({ progress: d > 0 ? Math.min(1, audio.currentTime / d) : 0 });
  }, 100);
  void a.play().catch(() => stopVoicePlayback());
}

export const voicePlayer = {
  /** 点击语音气泡：空闲 → 播放；播放中 → 暂停；暂停中 → 继续。
   *  localText 非空（文字转语音消息）→ 静音模拟播放：不出声、无需语音 API，只走进度动画 */
  toggle(id: string, src: string, localText?: string | null): void {
    if (localText && localText.trim() && !src) {
      toggleSim(id, estimateSpeakDuration(localText));
      return;
    }
    const { activeId, playing } = useVoicePlayback.getState();
    if (activeId === id) {
      if (playing) {
        audio?.pause();
        useVoicePlayback.setState({ playing: false });
      } else {
        startPlay(id, src, true);
      }
      return;
    }
    startPlay(id, src, false);
  },
  /** 外部强停（如长按菜单动作时） */
  stop(): void {
    stopVoicePlayback();
  },
};

// 注册到全局音频焦点：TTS 朗读开始前会停掉这里的播放（含静音模拟）
registerAudioSource('voice-msg', () => stopVoicePlayback());
