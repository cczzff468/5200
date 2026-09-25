/**
 * 语音消息播放器（单聊/群聊语音气泡共用，模块级单例）：
 * - 一条语音在播时再点其它语音 → 自动停旧的播新的；暂停/继续同一实例（进度保留）
 * - 进度 0~1 每 100ms 广播，气泡波形按进度填充
 * - 三通道：普通语音 = 音频文件（dataURL，真实出声）；文字转语音消息（带 localText）=
 *   **静音模拟播放**——不出声、不需要语音 API，点击只按估算时长推进波形进度动画；
 *   AI 语音消息（synth='builtin'，内置引擎）= **实时朗读**——点击时用浏览器引擎按角色
 *   音色把 localText 真实读出来（进度按估算推进，真实播完自动收尾，引擎失败降级静音模拟）
 * - 与 TTS 朗读（电话等）互斥：播放前 stopOtherAudio 停掉对方
 * - stopVoicePlayback() 供聊天页卸载/切换会话/开录前释放（同时会停掉 AI 语音的实时朗读）
 */

import { create } from 'zustand';
import { registerAudioSource, stopOtherAudio } from './audio-focus';
import { BUILTIN_DEFAULT_FEMALE, BUILTIN_DEFAULT_MALE, speakBuiltin, stopBuiltinSpeech } from './builtin-voices';
import { resolveVoiceForContact } from './tts-client';
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
/** 当前在播的语音是否走内置引擎实时朗读（stopVoicePlayback 时要同步停掉语音引擎） */
let activeBuiltinTts = false;

/** 静音模拟播放状态（文字转语音消息 / AI 语音进度动画）：进度 = offset + 本次起点以来经过的时间 */
interface SimState {
  id: string;
  dur: number;
  offset: number;
  startedAt: number;
  /** true = 有真实播放挂在后面（AI 语音实时朗读）：到点后悬在 98% 等真实结束，不自行收尾 */
  hold?: boolean;
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
  if (activeBuiltinTts) {
    activeBuiltinTts = false;
    stopBuiltinSpeech();
  }
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

/** 静音模拟进度计时：按估算时长推进 0~1（暂停时不推进；hold=true 时到点后悬在 98% 等真实播放收尾） */
function startSimTimer(id: string): void {
  clearTimer();
  timer = window.setInterval(() => {
    if (!simState || simState.id !== id) return;
    if (!useVoicePlayback.getState().playing) return;
    const elapsed = simState.offset + (performance.now() - simState.startedAt) / 1000;
    if (elapsed >= simState.dur) {
      // hold（AI 语音实时朗读）：估算时长已走完但真实语音可能还没读完 → 悬在 98% 等真实播放结束；
      // 超过估算 3 倍仍没结束视为引擎卡死，强制收尾
      if (simState.hold && elapsed < simState.dur * 3) {
        useVoicePlayback.setState({ progress: 0.98 });
        return;
      }
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

/**
 * AI 语音消息（内置引擎通道）：点击 → 用角色音色把 localText 实时朗读出来（真实出声）。
 * - 再次点击 = 停止（TTS 无法真暂停，再次点击从头播）；
 * - 进度按估算时长推进（hold：到点悬在 98% 等真实播完收尾）；
 * - 引擎不可用/播放失败 → simState 保留，进度动画按静音模拟继续走完（不打断 UI）。
 */
function toggleBuiltinTts(id: string, text: string, contactId: string | null): void {
  const st = useVoicePlayback.getState();
  if (st.activeId === id) {
    // 播放中/暂停挂起 → 停止（含语音引擎）
    stopVoicePlayback();
    return;
  }
  // 新播放：停掉其它音频（电话 TTS / 录音气泡 / 其它模拟播放）
  stopOtherAudio('voice-msg');
  stopVoicePlayback();
  activeBuiltinTts = true;
  simState = { id, dur: estimateSpeakDuration(text), offset: 0, startedAt: performance.now(), hold: true };
  useVoicePlayback.setState({ activeId: id, playing: true, progress: 0 });
  startSimTimer(id);
  void (async () => {
    try {
      // 每次点击现场重读角色音色：切音色/改配置后对历史语音气泡也立即生效
      const rv = await resolveVoiceForContact(contactId);
      let voiceId = rv.voiceId;
      if (rv.source === 'builtin' && rv.gender) {
        voiceId = rv.gender === 'male' ? BUILTIN_DEFAULT_MALE : BUILTIN_DEFAULT_FEMALE;
      }
      await speakBuiltin({
        text,
        voiceId,
        keepOthers: true, // 播放状态归本播放器管，不能被互斥逻辑清掉
        onEnd: () => stopVoicePlayback(),
        onError: () => {
          // 播放失败：进度动画按静音模拟继续走完（simState 仍在，无需处理）
        },
      });
    } catch {
      // 引擎不可用：保留已启动的进度动画（静音模拟兜底）
    }
  })();
}

/** 点击语音气泡的额外信息（AI 语音消息用） */
export interface VoiceToggleOptions {
  /** 'builtin' = 内置引擎实时朗读通道（AI 语音消息） */
  synth?: 'builtin' | 'api';
  /** 发送该语音的联系人 id（实时朗读时解析角色音色用） */
  contactId?: string | null;
}

export const voicePlayer = {
  /** 点击语音气泡：空闲 → 播放；播放中 → 暂停；暂停中 → 继续。
   *  - localText 非空（文字转语音消息）→ 静音模拟播放：不出声、无需语音 API，只走进度动画；
   *  - synth==='builtin'（AI 语音消息）→ 内置引擎实时朗读：按角色音色真实出声 */
  toggle(id: string, src: string, localText?: string | null, opts?: VoiceToggleOptions): void {
    if (localText && localText.trim() && !src) {
      const text = localText.trim();
      if (opts?.synth === 'builtin') {
        toggleBuiltinTts(id, text, opts.contactId ?? null);
        return;
      }
      toggleSim(id, estimateSpeakDuration(text));
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
