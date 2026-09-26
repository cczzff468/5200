/**
 * 语音识别（STT）客户端：语音消息「转文字」共用链路（微信/QQ/信息/群聊）。
 * - 配置来源：设置 App「语音 API › 语音识别 STT」（useSettings.sttConfig），每次调用现场读取
 *   → 保存即生效，无需重启；与 TTS 配置相互独立、互不覆盖
 * - builtin：录音 Blob 先转 16kHz WAV base64（与电话端 ASR 同格式），走 /api/stt 内置识别，免配置
 * - openai：原始录音 Blob 以 multipart 交给 /api/stt，由服务端转发到 OpenAI 兼容 /audio/transcriptions
 *   （Key 只随请求体/表单发给本站代理，不进日志、不出现在前端存储之外的任何地方）
 * - 失败抛错（中文文案），调用方决定提示方式——不影响文字聊天
 */

import { blobToWav16kBase64 } from './audio-utils';
import { useSettings, type SttConfig } from './store';

export type { SttConfig } from './store';

/** 语音识别是否开箱可用（builtin 恒可用；openai 需要地址 + Key） */
export function isSttReady(cfg?: SttConfig): boolean {
  const c = cfg ?? useSettings.getState().sttConfig;
  if (c.provider === 'builtin') return true;
  return Boolean(c.apiKey.trim() && c.baseUrl.trim());
}

/**
 * 把录音 Blob 转成文字。空结果返回 ''（调用方按失败处理）。
 * 失败抛 Error（中文文案，不回显 Key）。
 */
export async function transcribeAudioBlob(blob: Blob): Promise<string> {
  const cfg = useSettings.getState().sttConfig;
  if (!isSttReady(cfg)) {
    throw new Error('请先配置语音识别（STT）');
  }
  const configPart =
    cfg.provider === 'builtin'
      ? { provider: 'builtin' as const }
      : { provider: 'openai' as const, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model };

  let res: Response;
  if (cfg.provider === 'builtin') {
    // 内置识别：先转 16kHz 单声道 WAV（解码失败 = 录音数据损坏）
    let wavBase64: string;
    try {
      wavBase64 = await blobToWav16kBase64(blob);
    } catch {
      throw new Error('音频解码失败，无法识别');
    }
    res = await fetch('/api/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: configPart, audioBase64: wavBase64 }),
    });
  } else {
    // OpenAI 兼容：multipart 原样转发（webm/m4a whisper 系直接吃）
    const fd = new FormData();
    fd.append('config', JSON.stringify(configPart));
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    fd.append('audio', blob, `voice.${ext}`);
    res = await fetch('/api/stt', { method: 'POST', body: fd });
  }

  if (!res.ok) {
    let msg = '转文字失败，请重试';
    try {
      const j = (await res.json()) as { error?: string } | null;
      if (j?.error) msg = j.error;
    } catch {
      // 非 JSON 错误体用默认文案
    }
    throw new Error(msg);
  }
  const j = (await res.json()) as { text?: string };
  return typeof j.text === 'string' ? j.text.trim() : '';
}

/**
 * 直发语音的自动转写（AI 感知用，五端共用）：
 * 用户按住说话直接松手发出的语音没有转写文本，AI 历史里只剩「[语音]」占位——
 * 本函数在消息入列后补一次识别（成功 → 回填 transcript，AI 当轮就能读到内容；
 * 失败 / 超时 → 返回空串，AI 按「语音占位」防编造规则回应，绝不假装听过）。
 * 与长按「转文字」共用同一套 STT 配置；不抛错，调用方无需 try/catch。
 */
export async function autoTranscribeForAi(blob: Blob | undefined, timeoutMs = 20000): Promise<string> {
  if (!blob || !isSttReady()) return '';
  try {
    const text = await Promise.race([
      transcribeAudioBlob(blob),
      new Promise<string>((_, rej) => window.setTimeout(() => rej(new Error('转文字超时')), timeoutMs)),
    ]);
    const cleaned = text.trim();
    // 过滤 ASR 对静音/噪声的典型无意义输出（纯符号，如 "#"、"…"），避免当成有效转写
    if (!cleaned || /^[#\s*_\-.,!?~。？！，、…—·]+$/.test(cleaned)) return '';
    return cleaned;
  } catch {
    return '';
  }
}
