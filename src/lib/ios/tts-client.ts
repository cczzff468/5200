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

// 类型与默认值定义在 store（避免循环依赖），这里重导出供 UI 层使用
export type { TtsConfig, TtsVoiceOption } from './store';

/** 语音 API 是否已配置（有 Key 且有地址才走用户服务；否则用内置朗读兜底） */
export function isTtsConfigured(cfg?: TtsConfig): boolean {
  const c = cfg ?? useSettings.getState().ttsConfig;
  return Boolean(c.apiKey.trim() && c.baseUrl.trim());
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
  if (contactId) {
    try {
      const c = await getContact(contactId);
      const v = c?.voiceId?.trim();
      if (v) return { voiceId: v, source: 'contact' };
    } catch {
      // 联系人读取失败不阻塞：落到全局默认
    }
  }
  const global = cfg.defaultVoiceId.trim();
  if (global) return { voiceId: global, source: 'global' };
  return { voiceId: SAFE_VOICE_BY_PROVIDER[cfg.provider] ?? 'alloy', source: 'builtin' };
}

// ---------------- 单例播放器 ----------------

/** 播放令牌：每次新播放 +1；旧链路的收尾回调发现令牌对不上就不再触碰公共状态 */
let playToken = 0;
let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
/** 当前播放的收尾回调：stopSpeaking() 暂停音频时同步 resolve 等待中的调用方（防 await 永久悬挂） */
let currentFinish: (() => void) | null = null;

/** 停止当前播放并释放资源（页面销毁/切聊天/新一轮播放前调用） */
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
  /** 播放自然结束后的回调（被 stopSpeaking 打断时不触发）；失败仍会抛错不走这里 */
  onEnd?: () => void;
}

/**
 * 用用户配置的语音 API 播放一段文本（单例：自动停掉上一段）。
 * 失败抛错（含服务商中文文案）——调用方决定是否回退内置朗读；文字聊天不受影响。
 */
export async function speakUserTts(opts: SpeakOptions): Promise<void> {
  const cfg = useSettings.getState().ttsConfig;
  if (!isTtsConfigured(cfg)) {
    throw new Error('语音 API 未配置');
  }
  const cleaned = cleanTextForTts(opts.text);
  if (!cleaned) {
    throw new Error('没有可朗读的文本');
  }
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
    if (myToken === playToken && !opts.cancelled?.()) opts.onStart?.();
    audio.play().catch(finish); // 自动播放策略等导致的播放失败：静默结束
  });
  // 正常播完（未被 stopSpeaking 打断）才触发 onEnd；电话的「对方讲完→回到听」状态机依赖它
  if (myToken === playToken) opts.onEnd?.();
}

// 注册到全局音频焦点：语音消息气泡开始播放前会停掉这里的 TTS 朗读
registerAudioSource('tts', () => stopSpeaking());
