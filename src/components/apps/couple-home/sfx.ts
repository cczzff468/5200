/**
 * 拾光小屋 · 交互音效（E3）—— WebAudio 纯合成、零资产
 *
 * - 惰性 AudioContext：首次出声才创建；被浏览器自动挂起时自动 resume；
 * - 模块级单例：全屋共用一个 context + master gain（≈0.14，轻响不吵）；
 * - 开关持久化：localStorage key `ch-home-sfx`（'1'/'0'），缺省开；
 * - 每个音效函数都先查开关再出声，调用方无需重复判断。
 */

const STORE_KEY = 'ch-home-sfx';
/** 主音量（全部音效共用 master gain，控制在「轻响」级别） */
const MASTER_GAIN = 0.14;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = loadEnabled();

/** 读持久化开关（localStorage 不可用 / 隐私模式 → 缺省开） */
function loadEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

/** 惰性获取 AudioContext + master gain（首次调用才创建；suspended 时 resume） */
function getAudioContext(): { ctx: AudioContext; master: GainNode } | null {
  try {
    if (!ctx || !master) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return { ctx, master };
  } catch {
    return null; // 音频不可用（老设备/无 AudioContext）静默降级
  }
}

/** 写持久化开关（即时生效，不销毁 context） */
function setEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORE_KEY, on ? '1' : '0');
  } catch {
    /* 写不进就算了（隐私模式），会话内仍生效 */
  }
}

function isEnabled(): boolean {
  return enabled;
}

/** 短促软 click（sine 880→660 快速滑落 0.05s）——家具点按 */
function playTap(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(660, t + 0.05);
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.06);
}

/** 可爱 pop（triangle 320→520 上滑 0.09s + 轻微 thud）——放置/购买 */
function playPlace(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(320, t);
  osc.frequency.exponentialRampToValueAtTime(520, t + 0.09);
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.12);
  // 轻微 thud：低频短音收尾，像东西稳稳落地
  const thud = c.createOscillator();
  const tg = c.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(150, t + 0.02);
  thud.frequency.exponentialRampToValueAtTime(90, t + 0.1);
  tg.gain.setValueAtTime(0.5, t + 0.02);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  thud.connect(tg).connect(out);
  thud.start(t + 0.02);
  thud.stop(t + 0.13);
}

/** 收起 swoosh（filtered noise 短扫 0.18s 下滑）——收起家具 */
function playRemove(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const dur = 0.18;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(2600, t);
  filter.frequency.exponentialRampToValueAtTime(500, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** 门轴轻响（低频 sine 140Hz 短震 0.12s + 高频轻 tick）——门窗开合 */
function playDoor(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.linearRampToValueAtTime(128, t + 0.12);
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.13);
  // 短震：26Hz LFO 轻轻抖动门轴嗡鸣
  const lfo = c.createOscillator();
  const lfoG = c.createGain();
  lfo.frequency.value = 26;
  lfoG.gain.value = 0.22;
  lfo.connect(lfoG).connect(g.gain);
  lfo.start(t);
  lfo.stop(t + 0.13);
  // 高频轻 tick：门闩到位的一声
  const tick = c.createOscillator();
  const tg = c.createGain();
  tick.type = 'triangle';
  tick.frequency.setValueAtTime(2100, t + 0.1);
  tg.gain.setValueAtTime(0.35, t + 0.1);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  tick.connect(tg).connect(out);
  tick.start(t + 0.1);
  tick.stop(t + 0.17);
}

/** 脚步（极短噪声 tick 0.04s，低通 900Hz，音量更低）——小人走路 */
function playStep(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const dur = 0.04;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  const g = c.createGain();
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.01);
}

/** 音效单例（CoupleHome 全屋接线用；每个函数内部自带开关检查） */
export const sfx = {
  tap: playTap,
  place: playPlace,
  remove: playRemove,
  door: playDoor,
  step: playStep,
  setEnabled,
  isEnabled,
} as const;
