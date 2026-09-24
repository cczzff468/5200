/**
 * 语音消息播放器（单聊/群聊语音气泡共用，模块级单例）：
 * - 一条语音在播时再点其它语音 → 自动停旧的播新的；暂停/继续同一实例（进度保留）
 * - 进度 0~1 每 100ms 广播，气泡波形按进度填充
 * - 与 TTS 朗读（电话/微信/QQ「播放语音」按钮）互斥：播放前 stopOtherAudio 停掉对方
 * - stopVoicePlayback() 供聊天页卸载/切换会话时释放
 */

import { create } from 'zustand';
import { registerAudioSource, stopOtherAudio } from './audio-focus';

interface VoicePlayStore {
  /** 正在播放（或暂停挂起）的语音消息 id */
  activeId: string | null;
  /** 是否正在出声（false = 暂停或无播放） */
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
}

/** 停止当前语音播放并清空状态（页面卸载/切换会话/新播放前调用） */
export function stopVoicePlayback(): void {
  teardown();
  useVoicePlayback.setState({ activeId: null, playing: false, progress: 0 });
}

/** 开始/继续播放。src 为 dataURL（消息里持久化的音频） */
function startPlay(id: string, src: string, fromPause: boolean): void {
  const sameInstance = fromPause && audio !== null && currentId === id;
  if (!sameInstance) {
    // 新播放开始前停掉其它音频（TTS 朗读等）
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
  /** 点击语音气泡：空闲 → 播放；播放中 → 暂停；暂停中 → 继续 */
  toggle(id: string, src: string): void {
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

// 注册到全局音频焦点：TTS 朗读开始前会停掉这里的播放
registerAudioSource('voice-msg', () => stopVoicePlayback());
