/**
 * 语音 API 共享客户端（电话 / 微信 / QQ 三端共用的 TTS 播放链路）：
 * - 配置来源：设置 App「语音 API」（useSettings.ttsConfig），每次播放现场读取 → 保存即生效，无需重启
 * - 音色优先级：当前角色 voiceId（每次播放实时从联系人库重读，切角色不沿用缓存）
 *   → 全局默认音色 → 服务商安全默认音色
 * - 文本清理：剥离舞台动作（*…*、（…）、【…】）与 Markdown/表情等不可朗读标记
 * - 播放器：模块级单例，新播放开始前自动停止旧音频；stopSpeaking() 供页面销毁时释放
 * - 安全：API Key 只随请求体发给本站代理 /api/tts，不在任何日志中出现
 */

import { stopOtherAudio, registerAudioSource } from './audio-focus';
import { getContact } from './contacts-store';
import { SAFE_VOICE_BY_PROVIDER, type TtsConfig, useSettings } from './store';
import {
  isBuiltinVoiceSupported,
  speakBuiltin,
  stopBuiltinSpeech,
  BUILTIN_DEFAULT_FEMALE,
  BUILTIN_DEFAULT_MALE,
} from './builtin-voices';

// 类型与默认值定义在 store（避免循环依赖），这里重导出供 UI 层使用
export type { TtsConfig, TtsVoiceOption } from './store';

/** 语音 API 是否已配置：内置语音免配置恒可用；其余服务商有 Key 且有地址才走用户服务 */
export function isTtsConfigured(cfg?: TtsConfig): boolean {
  const c = cfg ?? useSettings.getState().ttsConfig;
  if (c.provider === 'builtin') return true;
  return Boolean(c.apiKey.trim() && c.baseUrl.trim());
}

/**
 * 用户是否「配置了语音 API」（设置 App「语音 API」里选了服务商并填了 Key+地址）。
 * 与 isTtsConfigured 的区别：内置语音引擎免配置恒可用（isTtsConfigured 恒 true），
 * 而通话文字聊天用它判定「AI 是否设置语音 API」——配了第三方 API 才语音回复，没配则文字回复。
 */
export function hasCustomTtsApi(cfg?: TtsConfig): boolean {
  const c = cfg ?? useSettings.getState().ttsConfig;
  return c.provider !== 'builtin' && Boolean(c.apiKey.trim() && c.baseUrl.trim());
}

// ---------------- 文本清理（剥离不可朗读的舞台动作与标记） ----------------

/** 依次剥离：代码块/行内代码、舞台动作（*…* ＊…＊）、括号旁白（（…）(…)）、【…】标签、
 *  引用块/标题/链接的 Markdown 残留、[表情包]/[表情]/[图片] 等方括号标记、URL、emoji 符号 */
export function cleanTextForTts(raw: string): string {
  let t = raw ?? '';
  if (!t) return '';
  t = t.replace(/```[\s\S]*?```/g, ' '); // 代码块整体去掉
  t = t.replace(/`([^`]*)`/g, '$1'); // 行内代码保留内容
  // 舞台动作：*摸摸头* ＊微笑＊（含加粗 **…** 一并处理：先去加粗再去单星动作）
  t = t.replace(/\*\*([^*]*)\*\*/g, '$1');
  t = t.replace(/\*([^*\n]{0,80})\*/g, ' ');
  t = t.replace(/＊([^＊\n]{0,80})＊/g, ' ');
  // 括号旁白：（轻笑）(低头) 等
  t = t.replace(/（([^（）\n]{0,60})）/g, ' ');
  t = t.replace(/\(([^()\n]{0,60})\)/g, ' ');
  // 【系统提示】等标签段
  t = t.replace(/【([^【】\n]{0,40})】/g, ' ');
  // 方括号标记：[表情包] [表情] [图片] [语音] 等
  t = t.replace(/\[[^\]\n]{0,20}\]/g, ' ');
  // Markdown 残留：标题/引用/加粗斜体/分隔线
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/^>\s?/gm, '');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/(^|\s)\*([^*\s][^*]*)\*(?=\s|$)/g, '$1$2');
  t = t.replace(/~~([^~]+)~~/g, '$1');
  t = t.replace(/^[-—_=]{3,}\s*$/gm, ' ');
  // 链接只留文字
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  // URL
  t = t.replace(/https?:\/\/\S+/g, ' ');
  // emoji / 装饰符号（保留中日韩、字母数字、常用标点与空格）
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu,
    ' '
  );
  // 压缩空白（换行变空格，多空格合一）
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

// ---------------- 音色解析（角色优先，现场重读不缓存） ----------------

export interface ResolvedVoice {
  voiceId: string;
  /** 'contact' = 角色独立音色；'global' = 全局默认；'builtin' = 程序安全默认 */
  source: 'contact' | 'global' | 'builtin';
  /** 联系人性别（男/女；未知为 null）——内置声线兜底时按性别选默认声线用 */
  gender?: 'male' | 'female' | null;
}

/**
 * 解析某联系人应使用的音色：
 * 1) 联系人 voiceId（每次实时 getContact 重读——切换角色/改音色后立刻生效，绝不沿用上一角色缓存）
 * 2) 全局默认 defaultVoiceId
 * 3) 服务商安全默认音色
 * contactId 为空（陌生来电等）直接从 2) 开始。
 */
export async function resolveVoiceForContact(contactId: string | null | undefined): Promise<ResolvedVoice> {
  const cfg = useSettings.getState().ttsConfig;
  let gender: 'male' | 'female' | null = null;
  if (contactId) {
    try {
      const c = await getContact(contactId);
      const v = c?.voiceId?.trim();
      const g = c?.gender?.trim() ?? '';
      gender = g.includes('男') ? 'male' : g.includes('女') ? 'female' : null;
      if (v) return { voiceId: v, source: 'contact', gender };
    } catch {
      // 联系人读取失败不阻塞：落到全局默认
    }
  }
  const global = cfg.defaultVoiceId.trim();
  if (global) return { voiceId: global, source: 'global', gender };
  return { voiceId: SAFE_VOICE_BY_PROVIDER[cfg.provider] ?? 'alloy', source: 'builtin', gender };
}

// ---------------- 单例播放器 ----------------

/** 播放令牌：每次新播放 +1；旧链路的收尾回调发现令牌对不上就不再触碰公共状态 */
let playToken = 0;
let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
/** 当前播放的收尾回调：stopSpeaking() 暂停音频时同步 resolve 等待中的调用方（防 await 永久悬挂） */
let currentFinish: (() => void) | null = null;

/**
 * 停止当前播放并释放资源（页面销毁/挂断/切聊天/新一轮播放前调用）。
 * API 音频与内置朗读引擎（speechSynthesis）一并【立刻】截断——挂断电话后声音必须立即停止（用户反馈），
 * 内置引擎此前只被各播放函数自行管理、挂断时漏停，这里统一收口。
 */
export function stopSpeaking(): void {
  playToken += 1;
  const audio = currentAudio;
  currentAudio = null;
  const finish = currentFinish;
  currentFinish = null;
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    try {
      audio.pause();
    } catch {
      // 已释放的 Audio 再 pause 不抛错，这里兜住
    }
    audio.src = '';
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  finish?.();
  stopBuiltinSpeech();
}

export function isSpeaking(): boolean {
  return currentAudio !== null;
}

export interface SpeakOptions {
  /** 原始文本（内部会先 cleanTextForTts） */
  text: string;
  /** 角色联系人 ID：决定用谁的音色（角色 voiceId → 全局默认 → 安全默认） */
  contactId?: string | null;
  /** 显式指定音色（优先于联系人解析；设置页试听用） */
  voiceId?: string;
  volume?: number;
  speed?: number;
  /** 播放取消检查：合成返回后、真正出声前调用；返回 true 则静默丢弃（电话挂断等场景） */
  cancelled?: () => boolean;
  /** 真正开始出声前的回调（UI 置为「播放中」用）；播放失败不触发 */
  onStart?: () => void;
  /** 播放进度回调（0~1，逐字字幕同步用）：API 音频走 timeupdate，内置引擎走 boundary 事件；
   *  引擎不报进度时由内置估算兑底（按字数×语速推算），不触发则调用方自行处理 */
  onProgress?: (ratio: number) => void;
  /** 播放自然结束后的回调（被 stopSpeaking 打断时不触发）；失败仍会抛错不走这里 */
  onEnd?: () => void;
}

/**
 * 播放一段文本（单例：自动停掉上一段）：
 * - 服务商 = 内置语音，或 API 未配置 → 浏览器本地引擎（免费、零配置）；
 * - 否则走用户语音 API（经本站代理 /api/tts）。
 * 失败抛错（含服务商中文文案）——调用方决定是否回退服务端兜底；文字聊天不受影响。
 */
export async function speakUserTts(opts: SpeakOptions): Promise<void> {
  const cfg = useSettings.getState().ttsConfig;
  const useBuiltinEngine = cfg.provider === 'builtin' || !isTtsConfigured(cfg);
  const cleaned = cleanTextForTts(opts.text);
  if (!cleaned) {
    throw new Error('没有可朗读的文本');
  }

  // ---- 进度包装：真实进度（timeupdate / boundary）优先；启动后 600ms 仍无真实进度则按字数×语速估算兑底 ----
  const estDurationMs = Math.max(600, (cleaned.length / (3.8 * (opts.speed ?? 1))) * 1000);
  let realProgress = false;
  let fallbackTimer: number | null = null;
  let startedAt = 0;
  const emitReal = (r: number) => {
    realProgress = true;
    opts.onProgress?.(r);
  };
  const startFallback = () => {
    startedAt = Date.now();
    if (fallbackTimer !== null) return;
    fallbackTimer = window.setInterval(() => {
      if (realProgress || opts.cancelled?.()) return;
      const r = (Date.now() - startedAt) / estDurationMs;
      if (r > 0.02 && r < 0.98) opts.onProgress?.(Math.min(0.95, r));
    }, 120);
  };
  const stopFallback = () => {
    if (fallbackTimer !== null) {
      window.clearInterval(fallbackTimer);
      fallbackTimer = null;
    }
  };
  const wrapped = {
    ...opts,
    onProgress: emitReal,
    onStart: () => {
      startFallback();
      opts.onStart?.();
    },
    onEnd: () => {
      stopFallback();
      opts.onEnd?.();
    },
  };

  try {
  // ① 内置语音（浏览器本地引擎）：男女声线免配置
  if (useBuiltinEngine) {
    if (!isBuiltinVoiceSupported()) {
      throw new Error('当前浏览器不支持内置语音');
    }
    const rv = await resolveVoiceForContact(opts.contactId ?? null);
    const explicit = opts.voiceId?.trim() ?? '';
    let voiceId = explicit || rv.voiceId;
    // 角色与全局都没设音色时，按联系人性别给默认声线（男→子川，女→晓月）
    if (!explicit && rv.source === 'builtin' && rv.gender) {
      voiceId = rv.gender === 'male' ? BUILTIN_DEFAULT_MALE : BUILTIN_DEFAULT_FEMALE;
    }
    let errorMessage: string | null = null;
    await speakBuiltin({
      text: cleaned,
      voiceId,
      volume: opts.volume,
      speed: opts.speed,
      onStart: wrapped.onStart,
      onEnd: wrapped.onEnd,
      onProgress: wrapped.onProgress,
      onError: (m) => {
        errorMessage = m;
      },
      cancelled: opts.cancelled,
    });
    if (errorMessage) throw new Error(errorMessage);
    return;
  }

  // ② 用户语音 API（MiniMax / OpenAI 兼容）
  const voiceId =
    opts.voiceId?.trim() || (await resolveVoiceForContact(opts.contactId ?? null)).voiceId;

  stopSpeaking();
  // 与语音消息气泡播放互斥：开始 TTS 朗读前停掉在播的语音气泡
  stopOtherAudio('tts');
  const myToken = playToken;

  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: cfg, voiceId, text: cleaned.slice(0, 900), speed: opts.speed ?? 1 }),
  });
  if (!res.ok) {
    let msg = '语音生成失败';
    try {
      const j = (await res.json()) as { error?: string } | null;
      if (j?.error) msg = j.error;
    } catch {
      // 非 JSON 错误体（网关页等）用默认文案
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  if (myToken !== playToken || opts.cancelled?.()) {
    return; // 期间已有新播放/已取消：直接丢弃这段音频
  }

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.volume = opts.volume ?? 1;
  currentAudio = audio;
  currentUrl = url;

  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      audio.ontimeupdate = null;
      if (currentUrl === url) {
        URL.revokeObjectURL(url);
        currentUrl = null;
      }
      if (currentAudio === audio) currentAudio = null;
      if (currentFinish === finish) currentFinish = null;
      resolve();
    };
    currentFinish = finish;
    audio.onended = finish;
    audio.onerror = finish;
    if (myToken === playToken && !opts.cancelled?.()) wrapped.onStart?.();
    // timeupdate → 真实播放进度（逐字字幕同步）
    audio.ontimeupdate = () => {
      const d = audio.duration;
      if (myToken === playToken && Number.isFinite(d) && d > 0) {
        emitReal(Math.min(0.98, audio.currentTime / d));
      }
    };
    audio.play().catch(finish); // 自动播放策略等导致的播放失败：静默结束
  });
  // 正常播完（未被 stopSpeaking 打断）才触发 onEnd；电话的「对方讲完→回到听」状态机依赖它
  if (myToken === playToken) wrapped.onEnd?.();
  } finally {
    stopFallback();
  }
}

// 注册到全局音频焦点：语音消息气泡开始播放前会停掉这里的 TTS 朗读
registerAudioSource('tts', () => stopSpeaking());
