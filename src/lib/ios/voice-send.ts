/**
 * 文字转语音发送（不想说话时：输入文字 → 发出语音气泡）共用链路：
 * - **无需配置语音 API**：使用浏览器内置语音合成（speechSynthesis）本地朗读，
 *   消息里持久化原文（localText），播放时即时合成，重启后仍可播放
 * - 时长按字数估算（约 4 字/秒）；波形由文本哈希生成（与语音气泡波形同款）
 * - 文本清洗后为空 → 抛「没有可转语音的内容」（调用方 toast，不影响文字聊天）
 */

import { hashWaveBars } from './audio-utils';
import { cleanTextForTts } from './tts-client';

export interface SelfVoiceClip {
  /** 本地合成无音频文件：url 恒为空字符串，播放器见到 localText 即走 speechSynthesis */
  dataUrl: string;
  /** 秒（≥1，按字数估算） */
  duration: number;
  /** 静态波形（0~1，22 根，文本哈希生成） */
  wave: number[];
  /** 本地朗读原文（持久化在消息里，播放/重启后仍可合成） */
  localText: string;
}

/** 本地朗读时长估算（约 4 字/秒，至少 1 秒）——消息里存的 duration 与播放进度共用同一公式 */
export function estimateSpeakDuration(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

export async function synthesizeSelfVoice(text: string): Promise<SelfVoiceClip> {
  const cleaned = cleanTextForTts(text).slice(0, 400);
  if (!cleaned) {
    throw new Error('没有可转语音的内容');
  }
  return {
    dataUrl: '',
    duration: estimateSpeakDuration(cleaned),
    wave: hashWaveBars(cleaned, 22),
    localText: cleaned,
  };
}
