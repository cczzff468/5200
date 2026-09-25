'use client';

/**
 * AI 语音消息（AI 回复按频率用语音发送）+ AI 语音发送频率设置：
 *
 * 一、频率设置（按会话独立，localStorage 持久化；群聊按群保存）：
 *   off      关闭        —— AI 不发语音，只发文字
 *   always   每条都发语音 —— AI 每次回复的第一条消息都是语音
 *   often    经常        —— 每 3 条消息中，有 1 条是语音
 *   sometimes 偶尔       —— 每 7 条消息中，有 1 条是语音
 *   rarely   不经常      —— 每 12 条消息中，有 1 条是语音
 *
 * 二、计数规则（每个角色独立计数；每个会话独立计数）：
 *   - 计数器按 counterKey 隔离（单聊 = 会话键；群聊 = 「群会话键#角色 id」，群成员互不影响）；
 *   - 每次 AI 回复轮调用 decideAiVoiceTurn 推进一次：计数 +1，达到频率倍数 → 本轮发语音并把
 *     计数器清零（语音发送后计数器重置，重新开始计数）；
 *   - beginChatStream 拒绝（同会话已有流）时调用 rollback() 恢复计数，避免凭空消耗一次机会；
 *   - 切换角色/会话天然按 key 分别维护，无需手动重置。
 *
 * 三、语音合成 synthesizeAiVoice（用当前角色的音色）：
 *   - 文本清洗（剥离舞台动作/表情标记等不可朗读内容）后为空 → null（保持文字）；
 *   - 服务商 = 内置语音，或 API 未配置 → 内置引擎通道：不出音频文件，语音气泡点击时用
 *     浏览器本地引擎按存储的原文实时朗读（真实出声，synth='builtin'）；
 *   - MiniMax / OpenAI 兼容 → 调 /api/tts 合成真实音频 → dataURL 存进消息（synth='api'，
 *     重启后仍可播放）；时长读音频元数据，读不到按字数估算；
 *   - 任何失败 → 返回 null，调用方保留文字消息（自动降级为文字，不影响聊天）。
 */

import { hashWaveBars } from './audio-utils';
import { isBuiltinVoiceId, BUILTIN_DEFAULT_FEMALE, BUILTIN_DEFAULT_MALE } from './builtin-voices';
import { cleanTextForTts, isTtsConfigured, resolveVoiceForContact } from './tts-client';
import { SAFE_VOICE_BY_PROVIDER, useSettings } from './store';

// ---------------- 频率设置 ----------------

export type AiVoiceFreq = 'off' | 'always' | 'often' | 'sometimes' | 'rarely';

export interface AiVoiceFreqOption {
  value: AiVoiceFreq;
  label: string;
  desc: string;
}

export const AI_VOICE_FREQ_OPTIONS: readonly AiVoiceFreqOption[] = [
  { value: 'off', label: '关闭', desc: 'AI 不发语音，只发文字' },
  { value: 'always', label: '每条都发语音', desc: 'AI 每次回复都用语音发送' },
  { value: 'often', label: '经常', desc: '每 3 条消息中，有 1 条是语音' },
  { value: 'sometimes', label: '偶尔', desc: '每 7 条消息中，有 1 条是语音' },
  { value: 'rarely', label: '不经常', desc: '每 12 条消息中，有 1 条是语音' },
];

/** 非关闭/每条档位对应的频率倍数（每 N 条消息中 1 条语音） */
const FREQ_EVERY: Record<Exclude<AiVoiceFreq, 'off' | 'always'>, number> = {
  often: 3,
  sometimes: 7,
  rarely: 12,
};

const FREQ_STORE_KEY = 'ai-voice-freq';
const COUNTER_STORE_KEY = 'ai-voice-counters';

export function normalizeAiVoiceFreq(v: unknown): AiVoiceFreq {
  return v === 'always' || v === 'often' || v === 'sometimes' || v === 'rarely' ? v : 'off';
}

function loadFreqMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(FREQ_STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 读取某会话的 AI 语音频率（未设置时 = 关闭，AI 只发文字，与旧行为一致） */
export function getAiVoiceFreq(freqKey: string): AiVoiceFreq {
  return normalizeAiVoiceFreq(loadFreqMap()[freqKey]);
}

/** 保存某会话的 AI 语音频率（localStorage 持久化，按 freqKey 隔离） */
export function saveAiVoiceFreq(freqKey: string, freq: AiVoiceFreq): void {
  if (typeof window === 'undefined') return;
  const map = loadFreqMap();
  if (freq === 'off') delete map[freqKey];
  else map[freqKey] = freq;
  try {
    window.localStorage.setItem(FREQ_STORE_KEY, JSON.stringify(map));
  } catch {
    // 持久化失败忽略（本次会话内存态仍生效）
  }
}

/** 频率档位的展示名（入口行摘要用） */
export function aiVoiceFreqLabel(freq: AiVoiceFreq): string {
  return AI_VOICE_FREQ_OPTIONS.find((o) => o.value === freq)?.label ?? '关闭';
}

// ---------------- 计数器（按 counterKey 隔离） ----------------

function loadCounters(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(COUNTER_STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveCounters(map: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(COUNTER_STORE_KEY, JSON.stringify(map));
  } catch {
    // 持久化失败忽略
  }
}

export interface AiVoiceDecision {
  /** 本轮 AI 回复是否用语音发送 */
  speak: boolean;
  /** 撤销本次计数推进（beginChatStream 被拒绝/回滚时调用；正常发起则不要调用） */
  rollback: () => void;
}

/**
 * 决定本轮 AI 回复发文字还是语音（每次 AI 回复轮调用一次，副作用：推进计数器）：
 * - 关闭 → 永远文字；
 * - 每条都发 → 永远语音；
 * - 经常/偶尔/不经常 → 计数 +1，达到 N（3/7/12）→ 本轮语音且计数清零，否则文字。
 */
export function decideAiVoiceTurn(freqKey: string, counterKey: string = freqKey): AiVoiceDecision {
  const freq = getAiVoiceFreq(freqKey);
  if (freq === 'off') return { speak: false, rollback: () => {} };
  if (freq === 'always') return { speak: true, rollback: () => {} };
  const every = FREQ_EVERY[freq];
  const map = loadCounters();
  const prev = map[counterKey] ?? 0;
  const next = prev + 1;
  const speak = next >= every;
  map[counterKey] = speak ? 0 : next;
  saveCounters(map);
  return {
    speak,
    rollback: () => {
      const m = loadCounters();
      m[counterKey] = prev;
      saveCounters(m);
    },
  };
}

// ---------------- AI 语音合成 ----------------

/** AI 语音消息数据（落库时展开进消息的 voice 字段） */
export interface AiVoiceClip {
  /** 音频 dataURL（服务商 TTS）；内置引擎通道为空串（点击时实时朗读） */
  url: string;
  /** 秒（≥1） */
  duration: number;
  /** 静态波形（0~1，22 根，文本哈希） */
  wave: number[];
  /** 清洗后的朗读原文（内置引擎点击朗读 / 长按转文字直接用） */
  localText: string;
  /** 'builtin' = 点击时浏览器引擎实时朗读；'api' = 已存真实音频 dataURL */
  synth: 'builtin' | 'api';
}

/** 仿真朗读时长估算（约 4 字/秒，至少 1 秒）——与文字转语音消息同一公式 */
function estimateDuration(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('音频编码失败'));
    reader.readAsDataURL(blob);
  });
}

/** 读音频元数据拿真实时长；超时/解析失败回退估算值 */
function readAudioDuration(url: string, fallback: number): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(v);
    };
    const timer = window.setTimeout(() => done(fallback), 3000);
    try {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const d = audio.duration;
        done(Number.isFinite(d) && d > 0 ? Math.max(1, Math.ceil(d)) : fallback);
      };
      audio.onerror = () => done(fallback);
      audio.src = url;
    } catch {
      done(fallback);
    }
  });
}

/**
 * 解析「当前角色的音色」对应的 API voiceId（AI 语音消息服务商合成用）：
 * 角色独立 voiceId → 全局默认 → 服务商安全默认；角色/全局都没设时按联系人性别给内置默认声线；
 * 服务商 API 不认识内置声线 id（builtin:…）→ 替换为该服务商安全默认音色。
 */
export async function resolveAiVoiceIdForApi(contactId: string | null | undefined): Promise<string> {
  const cfg = useSettings.getState().ttsConfig;
  const rv = await resolveVoiceForContact(contactId ?? null);
  let voiceId = rv.voiceId;
  if (rv.source === 'builtin' && rv.gender) {
    voiceId = rv.gender === 'male' ? BUILTIN_DEFAULT_MALE : BUILTIN_DEFAULT_FEMALE;
  }
  if (cfg.provider !== 'builtin' && isBuiltinVoiceId(voiceId)) {
    voiceId = SAFE_VOICE_BY_PROVIDER[cfg.provider] ?? voiceId;
  }
  return voiceId;
}

/**
 * 把一段 AI 回复文本合成为语音消息数据（用当前角色的音色）：
 * 失败返回 null（调用方保留文字消息，自动降级，不影响聊天）。
 */
export async function synthesizeAiVoice(text: string, contactId: string | null | undefined): Promise<AiVoiceClip | null> {
  const cleaned = cleanTextForTts(text ?? '').slice(0, 400);
  if (!cleaned) return null;
  const cfg = useSettings.getState().ttsConfig;
  const useBuiltinEngine = cfg.provider === 'builtin' || !isTtsConfigured(cfg);
  const wave = hashWaveBars(cleaned, 22);

  // ① 内置引擎：不出音频文件，语音气泡点击时实时朗读（真实出声、零费用）
  if (useBuiltinEngine) {
    return { url: '', duration: estimateDuration(cleaned), wave, localText: cleaned, synth: 'builtin' };
  }

  // ② 用户语音 API（MiniMax / OpenAI 兼容）：合成真实音频 → dataURL 持久化
  try {
    const voiceId = await resolveAiVoiceIdForApi(contactId ?? null);
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg, voiceId, text: cleaned, speed: 1 }),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;
    const url = await blobToDataURL(blob);
    const duration = await readAudioDuration(url, estimateDuration(cleaned));
    return { url, duration, wave, localText: cleaned, synth: 'api' };
  } catch {
    return null;
  }
}
