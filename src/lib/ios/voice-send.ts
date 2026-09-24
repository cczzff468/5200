/**
 * 文字转语音发送（不想说话时：输入文字 → 发出语音气泡）共用链路：
 * - 音色：全局默认音色（defaultVoiceId）→ 服务商安全默认音色（「我」的声音，不用角色 voiceId）
 * - TTS 配置未配置 → 抛「请先配置语音 API」（调用方 toast，不影响文字聊天）
 * - 成功返回 dataURL + 时长 + 波形；失败抛中文错误（不回显 Key）
 */

import { blobToDataUrl, hashWaveBars, measureAudioDuration } from './audio-utils';
import { cleanTextForTts, isTtsConfigured } from './tts-client';
import { SAFE_VOICE_BY_PROVIDER, useSettings } from './store';

export interface SelfVoiceClip {
  dataUrl: string;
  duration: number;
  wave: number[];
}

export async function synthesizeSelfVoice(text: string): Promise<SelfVoiceClip> {
  const cfg = useSettings.getState().ttsConfig;
  if (!isTtsConfigured(cfg)) {
    throw new Error('请先配置语音 API');
  }
  const cleaned = cleanTextForTts(text);
  if (!cleaned) {
    throw new Error('没有可转语音的内容');
  }
  const voiceId = cfg.defaultVoiceId.trim() || SAFE_VOICE_BY_PROVIDER[cfg.provider] || 'alloy';
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: cfg, voiceId, text: cleaned.slice(0, 900), speed: 1 }),
  });
  if (!res.ok) {
    let msg = '语音生成失败';
    try {
      const j = (await res.json()) as { error?: string } | null;
      if (j?.error) msg = j.error;
    } catch {
      // 非 JSON 错误体用默认文案
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const dataUrl = await blobToDataUrl(blob);
  // 时长：优先读音频元数据；拿不到按字数估算（约 4 字/秒）
  const duration = await measureAudioDuration(dataUrl, Math.max(1, Math.round(cleaned.length / 4)));
  const wave = hashWaveBars(cleaned, 22);
  return { dataUrl, duration, wave };
}
