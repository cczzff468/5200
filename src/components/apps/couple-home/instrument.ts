'use client';

/**
 * 情侣小家 —— 网页音频合成（零素材，纯 Web Audio）
 *
 * - 吉他拨弦：Karplus-Strong 物理建模（噪声激励 → 延迟环低通衰减），
 *   每根弦按频率预生成一次 AudioBuffer 缓存复用，音色接近真实木吉他；
 * - 钢琴：基频 + 2/3/4 次谐波叠加（高次谐波衰减更快）+ 快起音长衰减包络；
 * - AudioContext 懒创建 + 用户手势时 resume（iOS Safari 兼容）。
 */

let ctx: AudioContext | null = null;

/** 获取（并唤醒）全局 AudioContext；需要在用户手势事件里首次调用 */
export function ensureAudio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

// ---------------- 吉他 ----------------

/** 六弦标准调弦：E2 A2 D3 G3 B3 E4（低音弦在左，与抱着看琴面一致） */
export const GUITAR_STRINGS: { name: string; freq: number; wound: boolean }[] = [
  { name: 'E', freq: 82.41, wound: true },
  { name: 'A', freq: 110.0, wound: true },
  { name: 'D', freq: 146.83, wound: true },
  { name: 'G', freq: 196.0, wound: false },
  { name: 'B', freq: 246.94, wound: false },
  { name: 'e', freq: 329.63, wound: false },
];

/** 已生成的拨弦音色缓存（同弦不重复合成） */
const pluckCache = new Map<number, AudioBuffer>();

/**
 * Karplus-Strong 拨弦：环长 = 采样率/频率，环内初始填噪声，
 * 之后每样点 = 0.996 × (前环两样点均值)，2.6 秒自然衰减到静音。
 */
export function pluckString(freq: number, vol = 1): void {
  const ac = ensureAudio();
  if (!ac) return;
  const key = Math.round(freq * 10);
  let buf = pluckCache.get(key);
  if (!buf) {
    const sr = ac.sampleRate;
    const n = Math.max(2, Math.round(sr / freq));
    const len = Math.floor(sr * 2.6);
    const data = new Float32Array(len);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const damp = 0.996;
    for (let i = n; i < len; i++) data[i] = damp * 0.5 * (data[i - n] + data[i - n + 1]);
    // 轻微淡入避免咔哒声
    const fade = Math.min(n, 64);
    for (let i = 0; i < fade; i++) data[i] *= i / fade;
    buf = ac.createBuffer(1, len, sr);
    buf.copyToChannel(data, 0);
    pluckCache.set(key, buf);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = 0.42 * vol;
  src.connect(g);
  g.connect(ac.destination);
  src.start();
}

// ---------------- 钢琴 ----------------

/** 两组八度白键（C4 → C6，15 键） */
export const PIANO_WHITE: { name: string; freq: number; label?: boolean }[] = [
  { name: 'C4', freq: 261.63, label: true },
  { name: 'D4', freq: 293.66 },
  { name: 'E4', freq: 329.63 },
  { name: 'F4', freq: 349.23 },
  { name: 'G4', freq: 392.0 },
  { name: 'A4', freq: 440.0 },
  { name: 'B4', freq: 493.88 },
  { name: 'C5', freq: 523.25, label: true },
  { name: 'D5', freq: 587.33 },
  { name: 'E5', freq: 659.25 },
  { name: 'F5', freq: 698.46 },
  { name: 'G5', freq: 783.99 },
  { name: 'A5', freq: 880.0 },
  { name: 'B5', freq: 987.77 },
  { name: 'C6', freq: 1046.5, label: true },
];

/** 黑键：after = 夹在第几个白键之后（0 起） */
export const PIANO_BLACK: { after: number; name: string; freq: number }[] = [
  { after: 0, name: 'C#4', freq: 277.18 },
  { after: 1, name: 'D#4', freq: 311.13 },
  { after: 3, name: 'F#4', freq: 369.99 },
  { after: 4, name: 'G#4', freq: 415.3 },
  { after: 5, name: 'A#4', freq: 466.16 },
  { after: 7, name: 'C#5', freq: 554.37 },
  { after: 8, name: 'D#5', freq: 622.25 },
  { after: 10, name: 'F#5', freq: 739.99 },
  { after: 11, name: 'G#5', freq: 830.61 },
  { after: 12, name: 'A#5', freq: 932.33 },
];

/** 钢琴音：谐波叠加 + 指数衰减（每音独立节点，播完自动回收） */
export function pianoNote(freq: number, vol = 1): void {
  const ac = ensureAudio();
  if (!ac) return;
  const t0 = ac.currentTime;
  const master = ac.createGain();
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(0.5 * vol, t0 + 0.012);
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.9);
  master.connect(ac.destination);
  const partials: [number, number, OscillatorType][] = [
    [1, 1, 'triangle'],
    [2, 0.4, 'sine'],
    [3, 0.17, 'sine'],
    [4.01, 0.07, 'sine'],
  ];
  for (const [mult, amp, type] of partials) {
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.value = freq * mult;
    const og = ac.createGain();
    og.gain.setValueAtTime(amp, t0);
    // 高次谐波衰减更快（更像琴槌敲弦后的自然泛音收尾）
    og.gain.exponentialRampToValueAtTime(Math.max(0.0001, amp * 0.1), t0 + 1.0);
    osc.connect(og);
    og.connect(master);
    osc.start(t0);
    osc.stop(t0 + 2.0);
  }
}

/** 音名显示（黑键用 ♯ 更可爱） */
export function prettyNote(name: string): string {
  return name.replace('#', '♯');
}
