/**
 * 音频共享工具（语音消息 / 电话 / 语音备忘录共用）：
 * - 录音 MIME 选择与扩展名推断（MediaRecorder 能力探测）
 * - 录音 Blob → 16kHz 单声道 WAV base64（内置 ASR 要求的格式，与电话端同源）
 * - 波形处理：实时振幅采样降采样为气泡静态波形；文本哈希生成确定性伪波形（TTS 语音气泡用）
 * - Blob → dataURL（语音消息持久化进聊天记录，重启 App 后仍可播放）
 */

/** MediaRecorder 录音 MIME 依次尝试（webm/opus 优先，Safari 走 mp4） */
export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

export function recorderExtFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'm4a';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  return 'webm';
}

/**
 * 任意录音 Blob → 16kHz 单声道 PCM16 WAV 的 base64。
 * 用于内置语音识别（/api/stt builtin 分支）：与电话端 ASR 同一格式要求。
 */
export async function blobToWav16kBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctx = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctx) throw new Error('浏览器不支持音频解码');
  const ctx = new Ctx();
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(buf);
  } finally {
    void ctx.close();
  }
  const srcRate = audio.sampleRate;
  const dstRate = 16000;
  const len = Math.max(1, Math.ceil((audio.length * dstRate) / srcRate));
  const out = new Float32Array(len);
  const chans: Float32Array[] = [];
  for (let i = 0; i < audio.numberOfChannels; i++) chans.push(audio.getChannelData(i));
  for (let i = 0; i < len; i++) {
    const srcIdx = (i * srcRate) / dstRate;
    const i0 = Math.floor(srcIdx);
    const frac = srcIdx - i0;
    let s = 0;
    for (const ch of chans) {
      const a = ch[i0] ?? 0;
      const b = ch[i0 + 1] ?? a;
      s += a + (b - a) * frac;
    }
    out[i] = s / chans.length;
  }
  const wavBuf = new ArrayBuffer(44 + len * 2);
  const v = new DataView(wavBuf);
  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + len * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, dstRate, true);
  v.setUint32(28, dstRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, len * 2, true);
  let off = 44;
  for (let i = 0; i < len; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, out[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(wavBuf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

/** Blob → dataURL（语音消息把音频直接存进聊天记录，IndexedDB 持久化） */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      if (typeof fr.result === 'string') resolve(fr.result);
      else reject(new Error('音频编码失败'));
    };
    fr.onerror = () => reject(new Error('音频编码失败'));
    fr.readAsDataURL(blob);
  });
}

/**
 * 读取音频时长（秒）：加载元数据即可，不真正播放。
 * 失败返回 fallback（调用方传录音计时兜底）。
 */
export function measureAudioDuration(url: string, fallback: number): Promise<number> {
  return new Promise((resolve) => {
    try {
      const a = new Audio();
      const done = (d: number) => {
        a.src = '';
        resolve(Number.isFinite(d) && d > 0 ? d : fallback);
      };
      a.onloadedmetadata = () => done(a.duration);
      a.onerror = () => done(fallback);
      a.preload = 'metadata';
      a.src = url;
      // 某些 webm 无时长元数据：Infinity → 用兜底
      window.setTimeout(() => done(Number.isFinite(a.duration) ? a.duration : fallback), 2500);
    } catch {
      resolve(fallback);
    }
  });
}

/**
 * 录音期间采样的实时振幅（0~1，约每 100ms 一个）→ 气泡静态波形（bars 根，0~1）。
 * 采样不足时按均匀值填充，保证最短录音也有完整波形。
 */
export function downsampleWave(levels: number[], bars: number): number[] {
  const src = levels.filter((x) => Number.isFinite(x) && x >= 0);
  if (src.length === 0) return Array.from({ length: bars }, () => 0.35);
  if (src.length >= bars) {
    const step = src.length / bars;
    const out: number[] = [];
    for (let i = 0; i < bars; i++) {
      const a = Math.floor(i * step);
      const b = Math.min(src.length, Math.floor((i + 1) * step));
      let sum = 0;
      for (let k = a; k < b; k++) sum += src[k];
      out.push(Math.max(0.12, Math.min(1, sum / Math.max(1, b - a))));
    }
    return out;
  }
  // 采样点比目标条数少：线性插值展开
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const p = (i / (bars - 1)) * (src.length - 1);
    const i0 = Math.floor(p);
    const i1 = Math.min(src.length - 1, i0 + 1);
    const v = src[i0] + (src[i1] - src[i0]) * (p - i0);
    out.push(Math.max(0.12, Math.min(1, v)));
  }
  return out;
}

/**
 * 由文本生成确定性伪波形（0~1）：文字转语音的消息没有录音采样，
 * 用文本哈希做种子生成自然的随机高度，同一条消息波形稳定不变。
 */
export function hashWaveBars(seed: string, bars: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  let x = h >>> 0;
  for (let i = 0; i < bars; i++) {
    // xorshift32 伪随机 + 正弦包络，让波形中间高两端低更像语音
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    const env = 0.45 + 0.55 * Math.sin((i / Math.max(1, bars - 1)) * Math.PI);
    const v = (0.3 + 0.7 * (x / 4294967295)) * env;
    out.push(Math.max(0.14, Math.min(1, v)));
  }
  return out;
}

/** 气泡时长文案：59s 内「5″」，≥60s「1′05″」 */
export function voiceDurationLabel(sec: number): string {
  const s = Math.max(1, Math.round(sec));
  if (s < 60) return `${s}″`;
  return `${Math.floor(s / 60)}′${String(s % 60).padStart(2, '0')}″`;
}
