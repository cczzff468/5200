/**
 * 语音 API 服务端共享层（/api/tts 与 /api/tts/voices 两个路由共用）：
 * - MiniMax（t2a_v2 合成 / get_voice 音色列表）与 OpenAI 兼容（audio/speech）两类服务商
 * - node:https 强制 IPv4：沙箱 undici 对含 AAAA 记录的主机有 IPv6 回退缺陷（同天气路由）
 * - 安全：API Key 只在内存里转发，绝不写日志；上游错误透出业务文案不透出 Key
 */

import http from 'node:http';
import https from 'node:https';

export type TtsProvider = 'minimax' | 'openai';

export interface TtsUpstreamConfig {
  provider: TtsProvider;
  baseUrl: string;
  apiKey: string;
  /** MiniMax 专属：账户 GroupId（get_voice / t2a_v2 都要求） */
  groupId?: string;
  model?: string;
}

/** 归一化 URL：去空白；非法/非 http(s) 返回 null（避免 SSRF 到 file: 等协议） */
export function normalizeTtsBaseUrl(raw: string): string | null {
  const t = raw.trim().replace(/\/+$/, '');
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

/**
 * OpenAI 兼容：拼 audio/speech 端点。
 * 用户可能填 https://api.openai.com/v1、https://xxx/v1 或完整端点——三种都兼容：
 * 已含 audio/speech 原样用；以 /v1 结尾追加 /audio/speech；否则追加 /v1/audio/speech。
 */
export function openaiSpeechUrl(base: string): string {
  if (/audio\/speech/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/audio/speech`;
  return `${base}/v1/audio/speech`;
}

/** OpenAI 兼容：音色列表端点（非标准，仅部分服务商提供；拉不到就手动填） */
export function openaiVoicesUrl(base: string): string {
  const stripped = /audio\/speech/i.test(base) ? base.replace(/\/audio\/speech.*$/i, '') : base;
  if (/\/audio\/voices$/i.test(stripped)) return stripped;
  if (/\/v1$/i.test(stripped)) return `${stripped}/audio/voices`;
  return `${stripped}/v1/audio/voices`;
}

/** MiniMax：拼 /v1 端点（用户填的 base 可能带 /v1 也可能不带） */
export function minimaxUrl(base: string, path: string): string {
  const stripped = /\/v1$/i.test(base) ? base.replace(/\/v1$/, '') : base;
  return `${stripped}/v1/${path}`;
}

// ---------------- node:https 强制 IPv4 请求 ----------------

interface HttpsOptions {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

/** 返回 {status, json} 或 {status, binary}；非 2xx 也返回（由调用方决定错误文案）。
 *  https 用 node:https 强制 IPv4；http（本地/局域网 TTS 服务器，如 GPT-SoVITS）走 node:http */
function httpsRequest(opts: HttpsOptions): Promise<{ status: number; json: unknown; binary: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(opts.url);
    const isHttps = u.protocol === 'https:';
    if (!isHttps && u.protocol !== 'http:') {
      reject(new Error('API 地址协议必须是 http(s)'));
      return;
    }
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        method: opts.method,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        // 统一强制 IPv4：部分环境 localhost 解析为 ::1 而上游只绑 IPv4（或 IPv6 不可达）时会拒连
        family: 4,
        headers: opts.headers,
        signal: AbortSignal.timeout(opts.timeoutMs),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const binary = Buffer.concat(chunks);
          const contentType = String(res.headers['content-type'] ?? '');
          let json: unknown = null;
          if (/json/i.test(contentType) || (!contentType && /^\s*[[{]/.test(binary.toString('utf8', 0, 32)))) {
            try {
              json = JSON.parse(binary.toString('utf8'));
            } catch {
              json = null;
            }
          }
          resolve({ status, json, binary, contentType });
        });
      }
    );
    req.on('error', (e) => {
      // Node 的连接类错误 message 常为空串，统一映射成可读中文文案
      const code = typeof (e as NodeJS.ErrnoException)?.code === 'string' ? (e as NodeJS.ErrnoException).code : '';
      let msg = e instanceof Error && e.message ? e.message : '';
      if (code === 'ECONNREFUSED') msg = '无法连接到服务商服务器，请检查 API 地址与端口';
      else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') msg = 'API 地址的域名无法解析，请检查拼写';
      else if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) msg = '连接服务商超时，请稍后重试';
      else if (!msg) msg = '网络请求失败';
      reject(new Error(msg));
    });
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** MiniMax t2a_v2 合成：返回 mp3 Buffer；失败抛中文错误 */
export async function minimaxSynthesize(cfg: TtsUpstreamConfig, text: string, voiceId: string, speed: number): Promise<Buffer> {
  const base = normalizeTtsBaseUrl(cfg.baseUrl);
  if (!base) throw new Error('API 地址无效');
  if (!cfg.apiKey.trim()) throw new Error('请先填写 API Key');
  if (!cfg.groupId?.trim()) throw new Error('MiniMax 需要填写 GroupId（在 MiniMax 控制台「账户管理」里查看）');
  const url = `${minimaxUrl(base, 't2a_v2')}?GroupId=${encodeURIComponent(cfg.groupId.trim())}`;
  const payload = {
    model: cfg.model?.trim() || 'speech-01-turbo',
    text,
    stream: false,
    voice_setting: { voice_id: voiceId, speed, vol: 1, pitch: 0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
  };
  const res = await httpsRequest({
    method: 'POST',
    url,
    headers: {
      Authorization: `Bearer ${cfg.apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    timeoutMs: 60_000,
  });
  const root = res.json as { data?: { audio?: unknown }; base_resp?: { status_code?: number; status_msg?: string } } | null;
  const status = root?.base_resp?.status_code;
  if (status !== undefined && status !== 0) {
    throw new Error(`MiniMax 合成失败（${status}）：${root?.base_resp?.status_msg || '未知错误'}`);
  }
  const audioRaw = root?.data?.audio;
  if (typeof audioRaw === 'string' && audioRaw.length > 0) {
    const buf = hexOrBase64ToBuffer(audioRaw);
    if (buf && buf.length > 0) return buf;
    throw new Error('MiniMax 返回了无法解析的音频数据');
  }
  if (res.status >= 400) throw new Error(upstreamStatusMessage(res.status));
  throw new Error('MiniMax 未返回音频数据');
}

/** MiniMax get_voice 音色列表：system_voice + voice_cloning 合并 */
export async function minimaxVoices(cfg: TtsUpstreamConfig): Promise<{ id: string; name: string }[]> {
  const base = normalizeTtsBaseUrl(cfg.baseUrl);
  if (!base) throw new Error('API 地址无效');
  if (!cfg.apiKey.trim()) throw new Error('请先填写 API Key');
  if (!cfg.groupId?.trim()) throw new Error('MiniMax 需要填写 GroupId（在 MiniMax 控制台「账户管理」里查看）');
  const url = `${minimaxUrl(base, 'get_voice')}?GroupId=${encodeURIComponent(cfg.groupId.trim())}`;
  const res = await httpsRequest({
    method: 'GET',
    url,
    headers: { Authorization: `Bearer ${cfg.apiKey.trim()}` },
    timeoutMs: 15_000,
  });
  const root = res.json as Record<string, unknown> | null;
  const status = (root?.base_resp as { status_code?: number } | undefined)?.status_code;
  if (status !== undefined && status !== 0) {
    const msg = (root?.base_resp as { status_msg?: string } | undefined)?.status_msg;
    throw new Error(`MiniMax 音色列表拉取失败（${status}）：${msg || '未知错误'}`);
  }
  if (!root || res.status >= 400) throw new Error(upstreamStatusMessage(res.status));
  const out: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const key of ['system_voice', 'voice_cloning', 'voices', 'data']) {
    const arr = root[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (typeof item === 'string') {
        if (item && !seen.has(item)) {
          seen.add(item);
          out.push({ id: item, name: item });
        }
      } else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const id = typeof o.voice_id === 'string' ? o.voice_id : typeof o.id === 'string' ? o.id : '';
        const name = typeof o.voice_name === 'string' ? o.voice_name : typeof o.name === 'string' ? o.name : id;
        if (id && !seen.has(id)) {
          seen.add(id);
          out.push({ id, name: name || id });
        }
      }
    }
  }
  return out;
}

/** OpenAI 兼容 audio/speech 合成：返回音频 Buffer（mp3） */
export async function openaiSynthesize(cfg: TtsUpstreamConfig, text: string, voiceId: string, speed: number): Promise<Buffer> {
  const base = normalizeTtsBaseUrl(cfg.baseUrl);
  if (!base) throw new Error('API 地址无效');
  if (!cfg.apiKey.trim()) throw new Error('请先填写 API Key');
  const res = await httpsRequest({
    method: 'POST',
    url: openaiSpeechUrl(base),
    headers: {
      Authorization: `Bearer ${cfg.apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: cfg.model?.trim() || 'tts-1', input: text, voice: voiceId, response_format: 'mp3', speed }),
    timeoutMs: 60_000,
  });
  if (res.status >= 400) {
    const err = res.json as { error?: { message?: string } | string } | null;
    const msg = typeof err?.error === 'string' ? err.error : err?.error?.message;
    throw new Error(msg ? `合成失败：${msg}` : upstreamStatusMessage(res.status));
  }
  if (res.binary.length === 0) throw new Error('服务商未返回音频数据');
  return res.binary;
}

/**
 * OpenAI 兼容音色列表（尽力而为）：标准 OpenAI 没有音色接口，返回空数组由用户手动填；
 * 官方域名回退内置六个标准音色；第三方兼容服务商若实现了 /audio/voices 则解析。
 */
export async function openaiVoices(cfg: TtsUpstreamConfig): Promise<{ id: string; name: string }[]> {
  const base = normalizeTtsBaseUrl(cfg.baseUrl);
  if (!base) throw new Error('API 地址无效');
  if (!cfg.apiKey.trim()) throw new Error('请先填写 API Key');
  const isOpenai = /(^|\.)openai\.com$/i.test(new URL(base).hostname);
  try {
    const res = await httpsRequest({
      method: 'GET',
      url: openaiVoicesUrl(base),
      headers: { Authorization: `Bearer ${cfg.apiKey.trim()}` },
      timeoutMs: 12_000,
    });
    const root = res.json as unknown;
    const voices = parseLooseVoiceList(root);
    if (voices.length > 0) return voices;
    if (res.status >= 400) throw new Error(upstreamStatusMessage(res.status));
  } catch {
    // 拉取失败不致命：官方域名回退标准音色，否则交手动
  }
  if (isOpenai) {
    return ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map((id) => ({ id, name: id }));
  }
  return [];
}

// ---------------- 工具 ----------------

/** 十六进制 / base64 自适应解码（MiniMax t2a_v2 历史上返回 hex，兼容个别 base64 返回） */
function hexOrBase64ToBuffer(s: string): Buffer | null {
  const t = s.trim();
  if (!t) return null;
  if (/^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0) {
    return Buffer.from(t, 'hex');
  }
  try {
    const b = Buffer.from(t, 'base64');
    return b.length > 0 ? b : null;
  } catch {
    return null;
  }
}

/** 宽松解析音色列表：裸字符串数组 / {voice_id,voice_name} / {id,name} / {voices:[...]} / data URL 声纹等 */
function parseLooseVoiceList(root: unknown): { id: string; name: string }[] {
  const collect = (arr: unknown[]): { id: string; name: string }[] => {
    const out: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const item of arr) {
      if (typeof item === 'string') {
        const t = item.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          out.push({ id: t, name: t });
        }
      } else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const id = [o.voice_id, o.id, o.voiceId, o.name, o.value].find((v): v is string => typeof v === 'string' && v.trim() !== '');
        if (id && !seen.has(id)) {
          seen.add(id);
          const name = [o.voice_name, o.name, o.displayName, o.display_name].find((v): v is string => typeof v === 'string' && v.trim() !== '');
          out.push({ id, name: name || id });
        }
      }
    }
    return out;
  };
  if (Array.isArray(root)) return collect(root);
  if (root && typeof root === 'object') {
    const o = root as Record<string, unknown>;
    for (const key of ['voices', 'data', 'list', 'items']) {
      if (Array.isArray(o[key])) return collect(o[key] as unknown[]);
    }
  }
  return [];
}

/** 上游 HTTP 状态 → 中文文案（不含任何 Key 信息） */
export function upstreamStatusMessage(status: number): string {
  if (status === 401 || status === 403) return 'API Key 无效或无权限';
  if (status === 404) return '接口路径不存在，请检查 API 地址';
  if (status === 429) return '请求频率超限，请稍后再试';
  if (status >= 500) return '服务商服务器暂时不可用';
  return `服务商返回错误（${status}）`;
}
