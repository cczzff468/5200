/**
 * 语音消息播放器（单聊/群聊语音气泡共用，模块级单例）：
 * - 一条语音在播时再点其它语音 → 自动停旧的播新的；暂停/继续同一实例（进度保留）
 * - 进度 0~1 每 100ms 广播，气泡波形按进度填充
 * - 双通道：普通语音 = 音频文件（dataURL）；文字转语音消息（带 localText）= 浏览器内置
 *   speechSynthesis 本地合成朗读（无需音频文件、无需配置语音 API，暂停/继续/进度模拟）
 * - 与 TTS 朗读（电话/微信/QQ「播放语音」按钮）互斥：播放前 stopOtherAudio 停掉对方
 * - stopVoicePlayback() 供聊天页卸载/切换会话/开录前释放（含取消本地合成）
 */

import { create } from 'zustand';
import { registerAudioSource, stopOtherAudio } from './audio-focus';
import { estimateSpeakDuration } from './voice-send';

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

/** 本地合成（speechSynthesis）播放状态：进度 = offset + 本次起点以来经过的时间 */
interface SpeakState {
  id: string;
  dur: number;
  offset: number;
  startedAt: number;
}
let speakState: SpeakState | null = null;

function speechOk(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** 取消本地合成（排队/暂停中的朗读一并丢弃） */
function cancelSpeech(): void {
  if (!speechOk()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // 引擎异常不阻断音频通道清理
  }
  speakState = null;
}

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
  cancelSpeech();
}

/** 停止当前语音播放并清空状态（页面卸载/切换会话/新播放前调用；含本地合成） */
export function stopVoicePlayback(): void {
  teardown();
  useVoicePlayback.setState({ activeId: null, playing: false, progress: 0 });
}

/** 本地合成进度计时：按估算时长推进 0~1（暂停时不推进） */
function startSpeechTimer(id: string): void {
  clearTimer();
  timer = window.setInterval(() => {
    if (!speakState || speakState.id !== id) return;
    if (!useVoicePlayback.getState().playing) return;
    const elapsed = speakState.offset + (performance.now() - speakState.startedAt) / 1000;
    useVoicePlayback.setState({ progress: Math.min(1, elapsed / speakState.dur) });
  }, 100);
}

/** 本地合成路径（文字转语音消息）：点击切换 播放/暂停/继续 */
function toggleSpeech(id: string, text: string): void {
  if (!speechOk()) {
    stopVoicePlayback();
    return;
  }
  const st = useVoicePlayback.getState();
  if (st.activeId === id) {
    if (st.playing) {
      // 暂停：记录已读秒数，引擎挂起
      if (speakState && speakState.id === id) {
        speakState.offset += (performance.now() - speakState.startedAt) / 1000;
      }
      try {
        window.speechSynthesis.pause();
      } catch {
        // 引擎不支持暂停时仅停进度
      }
      useVoicePlayback.setState({ playing: false });
    } else {
      // 继续
      try {
        window.speechSynthesis.resume();
      } catch {
        // 引擎不支持时静默
      }
      if (speakState && speakState.id === id) speakState.startedAt = performance.now();
      useVoicePlayback.setState({ playing: true });
      startSpeechTimer(id);
    }
    return;
  }
  // 新播放：先停其它音频（电话/TTS 朗读）与旧语音
  stopOtherAudio('voice-msg');
  teardown();
  // 优先中文音色（拿不到就用引擎默认 + lang 提示）
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = 1;
  u.pitch = 1;
  try {
    const voices = window.speechSynthesis.getVoices();
    const zh = voices.find((v) => /^zh([-_]cn)?$/i.test(v.lang)) ?? voices.find((v) => v.lang.toLowerCase().startsWith('zh'));
    if (zh) u.voice = zh;
  } catch {
    // 音色枚举失败用默认音色
  }
  speakState = { id, dur: estimateSpeakDuration(text), offset: 0, startedAt: performance.now() };
  u.onend = () => {
    if (speakState && speakState.id === id) stopVoicePlayback();
  };
  u.onerror = () => {
    if (speakState && speakState.id === id) stopVoicePlayback();
  };
  useVoicePlayback.setState({ activeId: id, playing: true, progress: 0 });
  cancelSpeech(); // 清掉排队中的旧朗读，避免连播
  window.speechSynthesis.speak(u);
  startSpeechTimer(id);
}

/** 开始/继续播放。src 为 dataURL（消息里持久化的音频） */
function startPlay(id: string, src: string, fromPause: boolean): void {
  const sameInstance = fromPause && audio !== null && currentId === id;
  if (!sameInstance) {
    // 新播放开始前停掉其它音频（TTS 朗读/本地合成等）
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
   *  localText 非空（文字转语音消息）走浏览器本地合成，不读音频文件 */
  toggle(id: string, src: string, localText?: string | null): void {
    if (localText && localText.trim()) {
      toggleSpeech(id, localText);
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

// 预热音色枚举（Chrome 首次 getVoices 返回空列表，触发异步加载）
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  try {
    window.speechSynthesis.getVoices();
  } catch {
    // ignore
  }
}

// 注册到全局音频焦点：TTS 朗读开始前会停掉这里的播放（含本地合成）
registerAudioSource('voice-msg', () => stopVoicePlayback());
