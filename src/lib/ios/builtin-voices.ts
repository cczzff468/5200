/**
 * 内置免费语音引擎（Web Speech API / speechSynthesis，纯浏览器本地合成）：
 * - 内置 6 个声线（3 女 + 3 男），零配置、免 API Key、离线可用；
 *   用「系统中文语音挑选 + 音高/语速塑形」让同一浏览器也能区分出不同声线
 * - 声线 id 以 builtin: 前缀持久化（defaultVoiceId / 联系人 voiceId），换浏览器仍语义成立：
 *   引擎按性别与声线特征就近挑系统语音，挑不到完全一致的也用音高塑形保证男女区分
 * - 单例播放：新播放自动停旧的；stopBuiltinSpeech() 供外部打断；
 *   注册到全局音频焦点（与语音消息气泡互斥）
 */

import { registerAudioSource, stopOtherAudio } from './audio-focus';

// ---------------- 声线预设 ----------------

export interface BuiltinVoicePreset {
  /** 持久化 id（defaultVoiceId / 联系人 voiceId 存这个） */
  id: string;
  /** 声线名（如 晓月） */
  name: string;
  gender: 'female' | 'male';
  /** 风格标签（如 温柔） */
  label: string;
  /** 音高塑形（1 = 系统默认；女声略高、男声明显低） */
  pitch: number;
  /** 语速（1 = 正常） */
  rate: number;
}

export const BUILTIN_TTS_VOICES: BuiltinVoicePreset[] = [
  { id: 'builtin:xiaoyue', name: '晓月', gender: 'female', label: '温柔女声', pitch: 1.15, rate: 0.95 },
  { id: 'builtin:xiaoxi', name: '小溪', gender: 'female', label: '活泼女声', pitch: 1.35, rate: 1.08 },
  { id: 'builtin:yunshu', name: '云舒', gender: 'female', label: '知性女声', pitch: 0.95, rate: 1 },
  { id: 'builtin:zichuan', name: '子川', gender: 'male', label: '清爽男声', pitch: 0.75, rate: 1 },
  { id: 'builtin:moyang', name: '墨阳', gender: 'male', label: '低沉男声', pitch: 0.5, rate: 0.92 },
  { id: 'builtin:chenfeng', name: '辰风', gender: 'male', label: '活力男声', pitch: 0.85, rate: 1.12 },
];

/** 无任何配置时的兜底声线（按性别：电话对端男/女默认不同声线） */
export const BUILTIN_DEFAULT_FEMALE = 'builtin:xiaoyue';
export const BUILTIN_DEFAULT_MALE = 'builtin:zichuan';

/** 设置页/联系人音色选择器用的展示列表（{id,name} 与 TtsVoiceOption 结构一致） */
export const BUILTIN_VOICE_OPTIONS: { id: string; name: string }[] = BUILTIN_TTS_VOICES.map((v) => ({
  id: v.id,
  name: `${v.name}（${v.label}）`,
}));

/** 是否含 builtin: 前缀 */
export function isBuiltinVoiceId(voiceId: string | null | undefined): boolean {
  return typeof voiceId === 'string' && voiceId.startsWith('builtin:');
}

/**
 * 解析应使用的内置声线：
 * 1) 精确匹配预设 id；
 * 2) 旧 API 音色名启发式映射（含 female/女 → 女声，含 male/男 → 男声），让历史角色配置也有合理声线；
 * 3) 显式 gender（联系人性别）兜底；
 * 4) 最终默认 晓月（女声）。
 */
export function resolveBuiltinPreset(
  voiceId?: string | null,
  gender?: 'male' | 'female' | null
): BuiltinVoicePreset {
  const v = voiceId?.trim() ?? '';
  if (v) {
    const exact = BUILTIN_TTS_VOICES.find((p) => p.id === v);
    if (exact) return exact;
    const lower = v.toLowerCase();
    if (/female|女/.test(lower)) return BUILTIN_TTS_VOICES[0];
    if (/male|男/.test(lower)) return BUILTIN_TTS_VOICES[3];
  }
  if (gender === 'male') return BUILTIN_TTS_VOICES.find((p) => p.id === BUILTIN_DEFAULT_MALE)!;
  if (gender === 'female') return BUILTIN_TTS_VOICES.find((p) => p.id === BUILTIN_DEFAULT_FEMALE)!;
  return BUILTIN_TTS_VOICES[0];
}

// ---------------- 系统语音挑选（zh 优先 + 性别启发式） ----------------

/** 已知常见中文系统音色的性别线索（覆盖 Win/Edge/macOS/Chrome/Android 主流引擎） */
const FEMALE_HINTS = /yaoyao|huihui|xiaoxiao|xiaoyi|xiaoyou|xiaohan|xiaomo|xiaqiao|xiaorui|tingting|ting-ting|mei-?jia|sin-?ji|google\s*(普通话|中文)|female|女|婷婷|美佳|晓(晓|伊|涵|秋|睿|墨|宇)/i;
const MALE_HINTS = /kangkang|yunxi|yunyang|yunjian|yunye|yunze|danny|zhiwei|yu-?shu|liang|\btao\b|tian-?qi|male|男|康康|云(希|野|健|枫|泽)|志威|雨叔/i;

let cachedVoices: SpeechSynthesisVoice[] = [];

function listSystemVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const all = window.speechSynthesis.getVoices() ?? [];
  if (all.length > 0) cachedVoices = all;
  return cachedVoices;
}

/** 按性别挑一支系统中文语音：性别线索命中 → 任意 zh → null（由音高塑形兜底） */
function pickSystemVoice(gender: 'female' | 'male'): SpeechSynthesisVoice | null {
  const voices = listSystemVoices();
  if (voices.length === 0) return null;
  const zh = voices.filter((v) => /^zh\b|^zh[-_]/i.test(v.lang) || /chinese|中文|普通话|粤语/i.test(v.name));
  const hint = gender === 'male' ? MALE_HINTS : FEMALE_HINTS;
  const anti = gender === 'male' ? FEMALE_HINTS : MALE_HINTS;
  const pool = zh.length > 0 ? zh : voices;
  return (
    pool.find((v) => hint.test(v.name) && !anti.test(v.name) && v.localService) ??
    pool.find((v) => hint.test(v.name) && !anti.test(v.name)) ??
    pool.find((v) => hint.test(v.name)) ??
    pool[0] ??
    null
  );
}

/** 浏览器是否支持内置语音（客户端调用；SSR 安全） */
export function isBuiltinVoiceSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// ---------------- 单例播放 ----------------

let speakToken = 0;
/** 当前在播的声线 id（设置页/测试用；无在播 = null） */
let activePresetId: string | null = null;
let activeFinish: (() => void) | null = null;

export function isBuiltinSpeaking(): boolean {
  return activePresetId !== null;
}

/** 停止当前内置朗读（页面卸载/外部打断） */
export function stopBuiltinSpeech(): void {
  speakToken += 1;
  activePresetId = null;
  const finish = activeFinish;
  activeFinish = null;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // 引擎不可用时静默
    }
  }
  finish?.();
}

export interface BuiltinSpeakOptions {
  /** 已清洗的文本（调用方先做 cleanTextForTts；这里只兜底去空白） */
  text: string;
  /** 声线 id（builtin:… 或可启发式映射的旧音色名；空 = 默认女声） */
  voiceId?: string | null;
  gender?: 'male' | 'female' | null;
  volume?: number;
  /** 额外语速倍率（叠加在声线语速上，电话快语速等场景用） */
  speed?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
  /** 出声前取消检查（电话挂断等）：返回 true 静默丢弃 */
  cancelled?: () => boolean;
}

/**
 * 用浏览器内置引擎朗读一段文本（单例）。
 * 不支持/无文本时走 onError 并抛错；正常结束走 onEnd；被打断（stopBuiltinSpeech）只 resolve 不回调。
 */
export async function speakBuiltin(opts: BuiltinSpeakOptions): Promise<void> {
  if (!isBuiltinVoiceSupported()) {
    const msg = '当前浏览器不支持内置语音';
    opts.onError?.(msg);
    throw new Error(msg);
  }
  const text = opts.text.trim();
  if (!text) {
    const msg = '没有可朗读的文本';
    opts.onError?.(msg);
    throw new Error(msg);
  }
  const preset = resolveBuiltinPreset(opts.voiceId, opts.gender);
  // 语音列表可能异步就绪：先 cancel 旧播放，再等一次 voices 就绪窗口
  stopOtherAudio('builtin-tts');
  stopBuiltinSpeech();
  const myToken = speakToken;

  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (activePresetId === preset.id) activePresetId = null;
      if (activeFinish === finish) activeFinish = null;
      resolve();
    };
    activeFinish = finish;
    activePresetId = preset.id;

    const start = () => {
      if (myToken !== speakToken || opts.cancelled?.()) {
        finish();
        return;
      }
      const utter = new SpeechSynthesisUtterance(text.slice(0, 900));
      const sysVoice = pickSystemVoice(preset.gender);
      if (sysVoice) utter.voice = sysVoice;
      utter.lang = sysVoice?.lang || 'zh-CN';
      utter.pitch = Math.min(2, Math.max(0, preset.pitch));
      utter.rate = Math.min(3, Math.max(0.5, preset.rate * (opts.speed ?? 1)));
      utter.volume = Math.min(1, Math.max(0, opts.volume ?? 1));
      utter.onstart = () => {
        if (myToken === speakToken && !opts.cancelled?.()) opts.onStart?.();
      };
      utter.onend = () => {
        if (myToken === speakToken) opts.onEnd?.();
        finish();
      };
      utter.onerror = () => {
        if (myToken === speakToken) opts.onError?.('内置语音播放失败');
        finish();
      };
      try {
        window.speechSynthesis.speak(utter);
      } catch {
        opts.onError?.('内置语音播放失败');
        finish();
      }
    };

    // voiceschanged 首次触发前 getVoices() 可能为空：最多等 600ms 再开播
    if (listSystemVoices().length > 0) {
      start();
    } else {
      const timer = window.setTimeout(() => {
        window.speechSynthesis.removeEventListener?.('voiceschanged', onVoices);
        start();
      }, 600);
      const onVoices = () => {
        if (listSystemVoices().length > 0) {
          window.clearTimeout(timer);
          window.speechSynthesis.removeEventListener?.('voiceschanged', onVoices);
          start();
        }
      };
      try {
        window.speechSynthesis.addEventListener('voiceschanged', onVoices);
      } catch {
        // addEventListener 不可用时靠 timer 兜底
      }
    }
  });
}

// 注册到全局音频焦点：语音消息气泡/其它 TTS 开播前会停掉这里
registerAudioSource('builtin-tts', () => stopBuiltinSpeech());
