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

// ---------------- v7.1 宠物互动萌系音效（纯合成，同「轻响不吵」基调） ----------------

/** 复用噪声段工具：生成 dur 秒白噪声 buffer */
function noiseBuf(c: AudioContext, dur: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  return buf;
}

/** 呼噜声（摸头/进窝）：低频喉音 62Hz，24Hz LFO 振幅颤动 1.1s —— 猫咪咕噜咕噜 */
function playPurr(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const dur = 1.1;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(62, t);
  osc.frequency.linearRampToValueAtTime(55, t + dur);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 260;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.09);
  g.gain.setValueAtTime(0.5, t + dur - 0.14);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  // 24Hz 颤动：喉腔一震一震的咕噜感
  const lfo = c.createOscillator();
  lfo.frequency.value = 24;
  const lfoG = c.createGain();
  lfoG.gain.value = 0.3;
  lfo.connect(lfoG).connect(g.gain);
  osc.connect(lp).connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  lfo.start(t);
  lfo.stop(t + dur + 0.02);
}

/** 咔嚓声（吃猫粮）：两次极短高频噪声脆响（0.05s + 0.045s） */
function playCrunch(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  for (const [dt0, d] of [
    [0, 0.05],
    [0.085, 0.045],
  ] as [number, number][]) {
    const src = c.createBufferSource();
    src.buffer = noiseBuf(c, d);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.65, t + dt0);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt0 + d);
    src.connect(hp).connect(g).connect(out);
    src.start(t + dt0);
    src.stop(t + dt0 + d + 0.01);
  }
}

/** 咕咚声（喝水）：两声短促下滑水泡音 */
function playSip(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  for (const dt0 of [0, 0.14]) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, t + dt0);
    osc.frequency.exponentialRampToValueAtTime(170, t + dt0 + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0.6, t + dt0);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt0 + 0.1);
    osc.connect(g).connect(out);
    osc.start(t + dt0);
    osc.stop(t + dt0 + 0.11);
  }
}

/** 洗澡水声：2.2s 白噪声带通（900→1500Hz 波动）+ 音量起伏 —— 流水哗哗 */
function playBathWater(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const dur = 2.2;
  const src = c.createBufferSource();
  src.buffer = noiseBuf(c, dur);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(900, t);
  bp.frequency.linearRampToValueAtTime(1500, t + dur * 0.5);
  bp.frequency.linearRampToValueAtTime(1000, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.34, t + 0.25);
  g.gain.linearRampToValueAtTime(0.22, t + dur * 0.6);
  g.gain.linearRampToValueAtTime(0.3, t + dur * 0.8);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** 咂嘴声（抱抱）："mua~" 快速上滑再回落的圆润短音 */
function playKiss(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(340, t);
  osc.frequency.exponentialRampToValueAtTime(880, t + 0.05);
  osc.frequency.exponentialRampToValueAtTime(420, t + 0.13);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.7, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.16);
}

/** 召唤哨声：清亮两连上滑（950→1900Hz 短哨 + 1300→2100Hz 更高短哨） */
function playWhistle(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  for (const [dt0, f0, f1, d] of [
    [0, 950, 1900, 0.14],
    [0.17, 1300, 2100, 0.18],
  ] as [number, number, number, number][]) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t + dt0);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dt0 + d);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + dt0);
    g.gain.exponentialRampToValueAtTime(0.4, t + dt0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt0 + d + 0.04);
    osc.connect(g).connect(out);
    osc.start(t + dt0);
    osc.stop(t + dt0 + d + 0.05);
  }
}

/** 喵叫（到位反应）：短喵「miao」620→900→480Hz 滑音 + 轻微颤音 */
function playMeow(): void {
  if (!enabled) return;
  const a = getAudioContext();
  if (!a) return;
  const { ctx: c, master: out } = a;
  const t = c.currentTime;
  const dur = 0.38;
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(620, t);
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.09);
  osc.frequency.exponentialRampToValueAtTime(480, t + dur);
  const vib = c.createOscillator();
  vib.frequency.value = 13;
  const vibG = c.createGain();
  vibG.gain.value = 14;
  vib.connect(vibG).connect(osc.frequency);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
  g.gain.setValueAtTime(0.5, t + dur - 0.1);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  vib.start(t);
  vib.stop(t + dur + 0.02);
}

/** 音效单例（CoupleHome 全屋接线用；每个函数内部自带开关检查） */
export const sfx = {
  tap: playTap,
  place: playPlace,
  remove: playRemove,
  door: playDoor,
  step: playStep,
  // v7.1 宠物互动萌系音效
  purr: playPurr,
  crunch: playCrunch,
  sip: playSip,
  bathWater: playBathWater,
  kiss: playKiss,
  whistle: playWhistle,
  meow: playMeow,
  setEnabled,
  isEnabled,
} as const;
