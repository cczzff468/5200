'use client';

/**
 * 情侣小屋 —— 交互音效（v8.1）
 *
 * - WebAudio 纯合成的轻量音效：零音频资产、零版权负担；
 *   撸宠咕噜泡泡 / 喂食 plop / 领养小 fanfare / 打盹下滑音 / 开心星星 / 通用点按；
 * - AudioContext 惰性创建（首次用户手势后），静音环境下静默失败绝不抛错；
 * - 偏好持久化 localStorage（key: ch-sfx，'0' = 关闭）；音量刻意压低，软萌不吵。
 */

type SfxName = 'tap' | 'feed' | 'adopt' | 'nap' | 'sparkle' | 'pop';

let ctx: AudioContext | null = null;
let muted: boolean | null = null;

function isMuted(): boolean {
  if (muted === null) {
    try {
      muted = localStorage.getItem('ch-sfx') === '0';
    } catch {
      muted = false;
    }
  }
  return muted;
}

/** 当前是否开启音效 */
export function sfxEnabled(): boolean {
  return !isMuted();
}

/** 开/关音效（持久化） */
export function setSfxEnabled(v: boolean) {
  muted = !v;
  try {
    localStorage.setItem('ch-sfx', v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function ac(): AudioContext | null {
  if (isMuted()) return null;
  if (!ctx) {
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

/** 一个音符：type 波形 / f0→f1 滑频 / t0 起始（秒，相对 now）/ dur 时长 / peak 峰值音量 */
function note(acx: AudioContext, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, peak: number) {
  const o = acx.createOscillator();
  const g = acx.createGain();
  o.type = type;
  const t = acx.currentTime + t0;
  o.frequency.setValueAtTime(Math.max(30, f0), t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(acx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** 播放交互音效（静音/异常时静默） */
export function playSfx(name: SfxName) {
  const acx = ac();
  if (!acx) return;
  try {
    switch (name) {
      case 'tap': // 撸宠：软软的咕噜泡泡
        note(acx, 'sine', 520, 780, 0, 0.1, 0.1);
        note(acx, 'sine', 660, 990, 0.07, 0.09, 0.07);
        break;
      case 'feed': // 喂食：饭碗落桌 plop
        note(acx, 'sine', 340, 170, 0, 0.14, 0.13);
        note(acx, 'triangle', 620, 880, 0.05, 0.08, 0.05);
        break;
      case 'adopt': // 领养：温暖小 fanfare
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(acx, 'triangle', f, f, i * 0.09, 0.22, 0.09));
        break;
      case 'nap': // 打盹：下滑小哈欠
        note(acx, 'sine', 420, 190, 0, 0.4, 0.07);
        break;
      case 'sparkle': // 开心小星星
        [1318.5, 1568, 2093].forEach((f, i) => note(acx, 'sine', f, f, i * 0.05, 0.12, 0.05));
        break;
      case 'pop': // 通用轻点
        note(acx, 'sine', 480, 620, 0, 0.07, 0.08);
        break;
    }
  } catch {
    /* 音频失败静默 */
  }
}
