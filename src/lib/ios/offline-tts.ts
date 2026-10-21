'use client';

/**
 * 离线神经网络语音包（免费声音 · sherpa-onnx WASM + vits-zh-aishell3 多说话人模型）：
 *
 * - 来源（用户需求「去 GitHub 和别的网站找免费的声音」）：
 *   · 引擎：sherpa-onnx 官方 WASM TTS（Apache-2.0，k2-fsa/sherpa-onnx），随部署分发在 /tts/；
 *   · 模型：vits-zh-aishell3（icefall 训练、Apache-2.0），中文多说话人 VITS——
 *     int8 量化 39.9MB + 词库，一次下载（约 42MB）后永久缓存（Cache API），断网可用；
 * - 声线：174 个说话人可选（sid），我们预设 4 个代表声线（见 builtin-voices NEURAL_TTS_VOICES），
 *   质量远超 Web Speech 变调，男女声线丰富；
 * - 下载：HF 镜像 hf-mirror.com 主源 + huggingface.co 备源，流式读取 + 实时进度；
 * - 合成：模型字节经 Worker 注入 MEMFS，synthesize 输出 WAV Blob（22050Hz 16bit mono），
 *   由 tts-client 的 playTtsAudioBlob 播放（与云端兜底同一条播放管线）；
 * - 失败语义：未下载/失败时调用方（tts-client）自动回退 Web Speech / 云端兜底，不影响出声。
 */

import { create } from 'zustand';

// ---------------- 模型源 ----------------

/** 主源：hf-mirror.com（国内可达的 HuggingFace 镜像，直链 + CORS 开放） */
const PRIMARY_BASE = 'https://hf-mirror.com/csukuangfj/vits-zh-aishell3/resolve/main/';
/** 备源：HuggingFace 原站（海外/代理环境） */
const BACKUP_BASE = 'https://huggingface.co/csukuangfj/vits-zh-aishell3/resolve/main/';

const SOURCES = [PRIMARY_BASE, BACKUP_BASE];

/** 模型文件（knownSize 用于进度兜底与完整性校验；与 HF 仓库实测字节一致） */
const MODEL_FILES: { name: string; knownSize: number }[] = [
  { name: 'vits-aishell3.int8.onnx', knownSize: 39_870_124 },
  { name: 'lexicon.txt', knownSize: 2_042_943 },
  { name: 'tokens.txt', knownSize: 1_671 },
  { name: 'date.fst', knownSize: 59_154 },
  { name: 'number.fst', knownSize: 64_482 },
  { name: 'phone.fst', knownSize: 88_630 },
];

/** 全部文件总字节（下载进度分母） */
export const OFFLINE_TTS_TOTAL_BYTES = MODEL_FILES.reduce((s, f) => s + f.knownSize, 0);

const CACHE_NAME = 'sherpa-tts-v1';
const STATUS_KEY = 'tts-offline-ready';
/** Cache API 键前缀（必须是 http(s) 同源路径，Request 构造不接受自定义 scheme） */
const cacheKeyOf = (name: string): string => `/tts-models/${name}`;

// ---------------- 状态（设置页订阅渲染） ----------------

export interface OfflineTtsProgress {
  loaded: number;
  total: number;
  /** 0~100 */
  pct: number;
}

export type OfflineTtsStatus = 'checking' | 'not-downloaded' | 'downloading' | 'ready' | 'error';

interface OfflineTtsState {
  status: OfflineTtsStatus;
  progress: OfflineTtsProgress | null;
  /** 当前下载源序号（0=主源 1=备源；仅下载中有意义） */
  sourceIndex: number;
  error: string | null;
  set: (patch: Partial<Omit<OfflineTtsState, 'set'>>) => void;
}

export const useOfflineTts = create<OfflineTtsState>((set) => ({
  status: 'checking',
  progress: null,
  sourceIndex: 0,
  error: null,
  set: (patch) => set(patch),
}));

// ---------------- Worker 桥 ----------------

interface TtsWorkerRefs {
  worker: Worker | null;
  ready: boolean;
  initPromise: Promise<void> | null;
  seq: number;
  pending: Map<number, { resolve: (r: { blob: Blob; sampleRate: number }) => void; reject: (err: Error) => void }>;
}

const w: TtsWorkerRefs = { worker: null, ready: false, initPromise: null, seq: 0, pending: new Map() };

/** 离线语音包是否已就绪（模型已下载 + Worker 已初始化） */
export function isOfflineTtsReady(): boolean {
  return w.ready;
}

/** 就绪状态（未初始化时读 localStorage 兜底：刷新后 worker 未起但模型已下载） */
export function offlineTtsCached(): boolean {
  try {
    return window.localStorage.getItem(STATUS_KEY) === '1';
  } catch {
    return false;
  }
}

function handleWorkerMessage(ev: MessageEvent): void {
  const data = (ev.data || {}) as { type?: string; id?: number; message?: string; sampleRate?: number; numSpeakers?: number; samples?: Float32Array };
  if (data.type === 'ready') {
    w.ready = true;
    useOfflineTts.getState().set({ status: 'ready', progress: null, error: null });
    try {
      window.localStorage.setItem(STATUS_KEY, '1');
    } catch {
      // 存储不可用忽略
    }
    return;
  }
  if (data.type === 'error' && data.id === 0) {
    // init 阶段错误（id=0）
    w.ready = false;
    useOfflineTts.getState().set({ status: 'error', error: data.message || '离线语音引擎初始化失败' });
    w.initPromise = null;
    return;
  }
  if (data.type === 'result' || data.type === 'error') {
    const job = data.id != null ? w.pending.get(data.id) : undefined;
    if (!job) return;
    if (data.id != null) w.pending.delete(data.id);
    if (data.type === 'result' && data.samples instanceof Float32Array) {
      const sr = typeof data.sampleRate === 'number' && data.sampleRate > 0 ? data.sampleRate : 22050;
      job.resolve({ blob: encodeWav(data.samples, sr), sampleRate: sr });
    } else {
      job.reject(new Error(data.message || '离线语音合成失败'));
    }
  }
}

/** Float32 PCM → WAV Blob（16bit 单声道） */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

async function readCachedBytes(name: string): Promise<Uint8Array | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(cacheKeyOf(name));
    if (!hit) return null;
    const buf = await hit.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function putCachedBytes(name: string, data: Uint8Array): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      cacheKeyOf(name),
      new Response(data.buffer as ArrayBuffer, { headers: { 'Content-Type': 'application/octet-stream' } }),
    );
  } catch {
    // 缓存写失败：本次会话仍可用（字节已在内存），下次刷新需重新下载
  }
}

/** 下载单个文件：主备源自动切换，流式读取 + 进度回调 */
async function downloadFile(
  name: string,
  knownSize: number,
  onProgress: (delta: number) => void,
  sourceStartIndex = 0,
): Promise<Uint8Array> {
  let lastErr: unknown = null;
  for (let si = 0; si < SOURCES.length; si++) {
    const idx = (sourceStartIndex + si) % SOURCES.length;
    try {
      const res = await fetch(SOURCES[idx] + name, { signal: AbortSignal.timeout(600_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length') || 0) || knownSize;
      let loaded = 0;
      const chunks: Uint8Array[] = [];
      const reader = res.body?.getReader();
      if (!reader) {
        const buf = new Uint8Array(await res.arrayBuffer());
        onProgress(buf.length);
        return buf;
      }
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.length;
          onProgress(value.length);
          const pct = total > 0 ? Math.min(99, (loaded / total) * 100) : 0;
          useOfflineTts.getState().set({ progress: { loaded, total, pct } });
        }
      }
      const out = new Uint8Array(loaded);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.length;
      }
      if (out.length < 1024) throw new Error(`文件过小（${out.length}B，可能被网关拦截）`);
      return out;
    } catch (err) {
      lastErr = err;
      // 换下一个源
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('下载失败');
}

/** 初始化 Worker（注入缓存中的模型字节）；模型未下载时抛错 */
async function initWorker(): Promise<void> {
  const files: { name: string; data: Uint8Array }[] = [];
  for (const f of MODEL_FILES) {
    const bytes = await readCachedBytes(f.name);
    if (!bytes || bytes.length < 1024) {
      throw new Error('语音包文件缺失或不完整，请删除后重新下载');
    }
    files.push({ name: f.name, data: bytes });
  }
  const worker = new Worker('/tts/offline-tts-worker.js');
  w.worker = worker;
  worker.onmessage = handleWorkerMessage;
  worker.onerror = () => {
    w.ready = false;
    useOfflineTts.getState().set({ status: 'error', error: '离线语音 Worker 异常' });
  };
  const done = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('语音引擎初始化超时')), 90_000);
    const onMsg = (ev: MessageEvent) => {
      const d = (ev.data || {}) as { type?: string; message?: string };
      if (d.type === 'ready') {
        window.clearTimeout(timer);
        worker.removeEventListener('message', onMsg);
        resolve();
      } else if (d.type === 'error' && d.message) {
        window.clearTimeout(timer);
        worker.removeEventListener('message', onMsg);
        reject(new Error(d.message));
      }
    };
    worker.addEventListener('message', onMsg);
  });
  worker.postMessage({
    type: 'init',
    files: files.map((f) => ({ name: f.name, data: f.data })),
    // MEMFS 中的实际文件名（MODEL_FILES 用 HF 原名；引擎 config 按这些名字加载）
    model: 'vits-aishell3.int8.onnx',
    lexicon: 'lexicon.txt',
    tokens: 'tokens.txt',
    ruleFsts: 'date.fst,number.fst,phone.fst',
  });
  await done;
  w.ready = true;
  useOfflineTts.getState().set({ status: 'ready', progress: null, error: null });
  try {
    window.localStorage.setItem(STATUS_KEY, '1');
  } catch {
    // 忽略
  }
}

/**
 * 确保离线语音包可用：已就绪直接返回；缓存完整则只初始化 Worker；
 * 缓存缺失则下载（实时进度）→ 写缓存 → 初始化 Worker。
 */
export async function ensureOfflineTts(): Promise<void> {
  if (w.ready) return;
  if (w.initPromise) return w.initPromise;
  const task = (async () => {
    const st = useOfflineTts.getState();
    if (st.status === 'ready') return;
    // ① 检查缓存完整性
    useOfflineTts.getState().set({ status: 'checking', error: null });
    let missing = false;
    for (const f of MODEL_FILES) {
      const bytes = await readCachedBytes(f.name);
      if (!bytes || Math.abs(bytes.length - f.knownSize) > 4096) {
        missing = true;
        break;
      }
    }
    if (missing) {
      // ② 下载（进度实时写 store；断点不续传——单文件流式完整下载后一次性落缓存）
      useOfflineTts.getState().set({ status: 'downloading', progress: { loaded: 0, total: OFFLINE_TTS_TOTAL_BYTES, pct: 0 } });
      let loadedTotal = 0;
      // 校验过的文件不再重下：逐个补齐
      for (let i = 0; i < MODEL_FILES.length; i++) {
        const f = MODEL_FILES[i];
        const cached = await readCachedBytes(f.name);
        if (cached && Math.abs(cached.length - f.knownSize) <= 4096) {
          loadedTotal += cached.length;
          useOfflineTts.getState().set({ progress: { loaded: loadedTotal, total: OFFLINE_TTS_TOTAL_BYTES, pct: (loadedTotal / OFFLINE_TTS_TOTAL_BYTES) * 100 } });
          continue;
        }
        const si = useOfflineTts.getState().sourceIndex;
        const data = await downloadFile(f.name, f.knownSize, (delta) => {
          loadedTotal += delta;
          useOfflineTts.getState().set({
            progress: { loaded: Math.min(loadedTotal, OFFLINE_TTS_TOTAL_BYTES), total: OFFLINE_TTS_TOTAL_BYTES, pct: Math.min(99, (loadedTotal / OFFLINE_TTS_TOTAL_BYTES) * 100) },
          });
        }, si);
        if (Math.abs(data.length - f.knownSize) > 65536) {
          throw new Error(`${f.name} 大小异常（${data.length}B ≠ ${f.knownSize}B）`);
        }
        await putCachedBytes(f.name, data);
      }
      useOfflineTts.getState().set({ progress: { loaded: OFFLINE_TTS_TOTAL_BYTES, total: OFFLINE_TTS_TOTAL_BYTES, pct: 100 } });
    }
    // ③ 初始化 Worker
    await initWorker();
  })();
  w.initPromise = task
    .catch((err) => {
      w.ready = false;
      useOfflineTts.getState().set({
        status: 'error',
        error: err instanceof Error ? err.message : '离线语音包下载失败',
      });
      throw err;
    })
    .finally(() => {
      w.initPromise = null;
    });
  return w.initPromise;
}

/** 合成一段文本（必须先 ensureOfflineTts 成功）；返回 WAV Blob */
export async function synthesizeOfflineTts(text: string, sid: number, speed = 1): Promise<Blob> {
  if (!w.ready || !w.worker) throw new Error('离线语音包未就绪');
  const id = ++w.seq;
  const done = new Promise<{ blob: Blob; sampleRate: number }>((resolve, reject) => {
    w.pending.set(id, { resolve, reject });
    // 120s 看门狗：长句推理卡死不再无限等待
    window.setTimeout(() => {
      if (w.pending.has(id)) {
        w.pending.delete(id);
        reject(new Error('离线语音合成超时'));
      }
    }, 120_000);
  });
  w.worker.postMessage({ type: 'generate', id, text, sid, speed });
  const r = await done;
  return r.blob;
}

/** 删除语音包（设置页入口）：清缓存 + 终止 Worker + 清状态 */
export async function deleteOfflineTtsModel(): Promise<void> {
  try {
    if (w.worker) {
      w.worker.terminate();
      w.worker = null;
    }
  } catch {
    // 忽略
  }
  w.ready = false;
  w.initPromise = null;
  w.pending.clear();
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // 忽略
  }
  try {
    window.localStorage.removeItem(STATUS_KEY);
  } catch {
    // 忽略
  }
  useOfflineTts.getState().set({ status: 'not-downloaded', progress: null, error: null });
}

/** 页面加载时恢复已下载状态（不自动初始化 Worker——首次合成时才拉起，省内存）。
 *  store 初始 status='checking' 只是占位（没有自动检查任务），这里无条件落定为真实状态；
 *  仅「真实下载中」不干预（其它页面正在下载时不能把状态改回 not-downloaded）。 */
export function restoreOfflineTtsStatus(): void {
  if (w.ready) return;
  const st = useOfflineTts.getState();
  if (st.status === 'downloading') return;
  useOfflineTts.getState().set({ status: offlineTtsCached() ? 'ready' : 'not-downloaded' });
}

// 调试钩子（与 offline-asr 同款）：window.__offlineTts.synthesize('你好', 2)
if (typeof window !== 'undefined') {
  (window as unknown as { __offlineTts?: unknown }).__offlineTts = {
    ensure: ensureOfflineTts,
    synthesize: synthesizeOfflineTts,
    delete: deleteOfflineTtsModel,
  };
}
