/**
 * 离线神经网络 TTS Worker（sherpa-onnx WASM + vits-zh-aishell3 多说话人模型）：
 *
 * 协议（主线程 ↔ 本 Worker）：
 * - → { type: 'init', files: [{ name, data(Uint8Array) }] }   注入模型文件（MEMFS）并创建引擎
 *   ← { type: 'ready', sampleRate, numSpeakers }
 * - → { type: 'generate', id, text, sid, speed }
 *   ← { type: 'result', id, samples: Float32Array, sampleRate }（transfer 零拷贝）
 *   ← { type: 'error',  id, message }
 *
 * wasm 引擎 /tts/sherpa-onnx-tts-engine.js + 同目录 .wasm 随部署分发；
 * 模型文件（约 40MB int8 + 词库）由主线程从 Cache API 读出后 transfer 进来注入 MEMFS。
 */

let wasmReady = false;
let handle = 0;
let sampleRate = 22050;
let numSpeakers = 1;
let genSeq = 0;

self.Module = {
  locateFile: (f) => '/tts/' + f,
  print: () => {},
  printErr: () => {},
  onRuntimeInitialized: () => {
    wasmReady = true;
  },
};

importScripts('/tts/sherpa-onnx-tts-engine.js');

function waitEngine(timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = () => {
      const M = self.Module;
      if (M && (wasmReady || M.calledRun) && M._SherpaOnnxCreateOfflineTts && M.FS_createDataFile && M.HEAPU8) {
        resolve();
        return;
      }
      if (Date.now() - t0 > timeoutMs) {
        reject(new Error('语音引擎初始化超时'));
        return;
      }
      setTimeout(poll, 120);
    };
    poll();
  });
}

/**
 * vits 配置结构（与 sherpa-onnx wasm ABI 对齐）：
 * 关键：wasm 是新版构建（还支持 matcha/kokoro 等），结构体比旧版大 ——
 * 必须 malloc 足够大的块并【清零】再写已知字段，未写部分读出全 0（合法的空配置），
 * 否则堆上残留脏数据会被当成野指针，直接 memory access out of bounds。
 */
function allocStruct(bytes) {
  const M = self.Module;
  const ptr = M._malloc(bytes);
  M.HEAPU8.fill(0, ptr, ptr + bytes);
  return ptr;
}

function allocStr(s) {
  const M = self.Module;
  const len = M.lengthBytesUTF8(s) + 1;
  const p = M._malloc(len);
  M.stringToUTF8(s, p, len);
  return p;
}

function buildConfig(model, lexicon, tokens, ruleFsts) {
  const M = self.Module;
  const modelP = allocStr(model);
  const lexiconP = allocStr(lexicon);
  const tokensP = allocStr(tokens);
  const dataDirP = allocStr('');
  const dictDirP = allocStr('');
  // VitsModelConfig：model/lexicon/tokens/dataDir 指针 + noiseScale/noiseScaleW/lengthScale float + dictDir 指针
  const vitsPtr = allocStruct(256);
  M.setValue(vitsPtr + 0, modelP, 'i8*');
  M.setValue(vitsPtr + 4, lexiconP, 'i8*');
  M.setValue(vitsPtr + 8, tokensP, 'i8*');
  M.setValue(vitsPtr + 12, dataDirP, 'i8*');
  M.setValue(vitsPtr + 16, 0.667, 'float');
  M.setValue(vitsPtr + 20, 0.8, 'float');
  M.setValue(vitsPtr + 24, 1.0, 'float');
  M.setValue(vitsPtr + 28, dictDirP, 'i8*');

  const providerP = allocStr('cpu');
  const ruleFstsP = allocStr(ruleFsts);
  const ruleFarsP = allocStr('');
  // 关键（与官方 wrapper 对齐）：ModelConfig 与 TtsConfig 都是【内联结构】而非指针 ——
  // cfg+0..31 = VitsModelConfig，+32 numThreads，+36 debug，+40 provider，
  // +44 ruleFsts，+48 maxNumSentences，+52 ruleFars；照指针写会全盘错位（C 侧读到野指针）
  const cfgPtr = allocStruct(256);
  M._CopyHeap(vitsPtr, 32, cfgPtr);
  M.setValue(cfgPtr + 32, 1, 'i32'); // numThreads
  M.setValue(cfgPtr + 36, 1, 'i32'); // debug
  M.setValue(cfgPtr + 40, providerP, 'i8*');
  M.setValue(cfgPtr + 44, ruleFstsP, 'i8*');
  M.setValue(cfgPtr + 48, 1, 'i32'); // maxNumSentences
  M.setValue(cfgPtr + 52, ruleFarsP, 'i8*');
  return cfgPtr;
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'init') {
      await waitEngine(60_000);
      const M = self.Module;
      // 注入模型文件（MEMFS 根目录；FS_createDataFile(parent, name, data, canRead, canWrite, canOwn)）
      for (const f of msg.files || []) {
        if (!f || typeof f.name !== 'string' || !(f.data instanceof Uint8Array)) continue;
        M.FS_createDataFile('/', f.name, f.data, true, true, true);
      }
      const cfgPtr = buildConfig(
        msg.model || 'model.int8.onnx',
        msg.lexicon || 'lexicon.txt',
        msg.tokens || 'tokens.txt',
        msg.ruleFsts || 'date.fst,number.fst,phone.fst',
      );
      handle = M._SherpaOnnxCreateOfflineTts(cfgPtr);
      if (!handle) {
        self.postMessage({ type: 'error', id: 0, message: '语音引擎创建失败（模型文件可能不完整）' });
        return;
      }
      sampleRate = M._SherpaOnnxOfflineTtsSampleRate(handle) || 22050;
      numSpeakers = M._SherpaOnnxOfflineTtsNumSpeakers(handle) || 1;
      self.postMessage({ type: 'ready', sampleRate, numSpeakers });
      return;
    }

    if (msg.type === 'generate') {
      if (!handle) {
        self.postMessage({ type: 'error', id: msg.id, message: '引擎未就绪' });
        return;
      }
      const M = self.Module;
      const id = ++genSeq;
      const text = String(msg.text || '').slice(0, 300);
      const textP = allocStr(text);
      const sid = Number.isFinite(msg.sid) ? Math.max(0, Math.min(numSpeakers - 1, msg.sid | 0)) : 0;
      const speed = Number.isFinite(msg.speed) && msg.speed > 0 ? msg.speed : 1;
      const h = M._SherpaOnnxOfflineTtsGenerate(handle, textP, sid, speed);
      M._free(textP);
      if (!h) {
        self.postMessage({ type: 'error', id: msg.id, message: '语音合成失败' });
        return;
      }
      const numSamples = M.HEAP32[h / 4 + 1];
      const genRate = M.HEAP32[h / 4 + 2];
      const samplesPtr = M.HEAP32[h / 4] / 4;
      const samples = new Float32Array(numSamples);
      samples.set(M.HEAPF32.subarray(samplesPtr, samplesPtr + numSamples));
      M._SherpaOnnxDestroyOfflineTtsGeneratedAudio(h);
      self.postMessage({ type: 'result', id: msg.id, genId: id, samples, sampleRate: genRate || sampleRate }, [
        samples.buffer,
      ]);
      return;
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: msg.id ?? 0,
      message: err instanceof Error ? err.message : String(err ?? '未知错误'),
    });
  }
};
