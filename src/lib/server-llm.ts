import { NextRequest } from 'next/server';

/**
 * 服务端 LLM 调用工具（记忆提取/总结专用，与 /api/chat、/api/phone/turn 同一策略）：
 * 优先使用设置 App「API 设置」里配置的 OpenAI 兼容接口（非流式，服务端代理）；
 * 未配置 / 上游失败 → z-ai-web-dev-sdk 兜底（后端内置能力，无需用户配置）。
 */

export interface UpstreamConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 从请求体提取上游配置：必须有 baseUrl（反代/中转接口可能无需 Key）。
 *  优化：baseUrl 还是默认的 api.openai.com 且没填 Key——这是「从未配置」的状态，
 *  直接当没有配置处理（null）：省掉每次注定 401 的无效往返，尽快落到 SDK 队列。 */
export function extractUpstreamConfig(raw: unknown): UpstreamConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const baseUrl = typeof r.baseUrl === 'string' ? r.baseUrl.trim() : '';
  if (!baseUrl) return null;
  const apiKey = typeof r.apiKey === 'string' ? r.apiKey.trim() : '';
  // 默认 OpenAI 地址 + 空 Key = 未配置（撞 api.openai.com 必 401，纯粹浪费一圈）
  if (!apiKey && /(^|\.)api\.openai\.com$/i.test(safeHost(baseUrl))) return null;
  return {
    baseUrl,
    apiKey,
    model: typeof r.model === 'string' && r.model.trim() ? r.model.trim() : 'gpt-4o-mini',
    temperature: typeof r.temperature === 'number' ? r.temperature : 0.7,
    maxTokens: typeof r.maxTokens === 'number' && Number.isFinite(r.maxTokens) && r.maxTokens > 0 ? Math.floor(r.maxTokens) : 2048,
  };
}

/** 从 baseUrl 提取 hostname（解析失败返回空串——当未配置处理） */
function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    try {
      return new URL(/^https?:\/\//.test(baseUrl) ? baseUrl : `https://${baseUrl}`).hostname;
    } catch {
      return '';
    }
  }
}

/** baseUrl 候选端点（与 /api/chat 一致：自动补 /v1/chat/completions、修 /v1/v1） */
function buildChatCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/(\/v\d+)\/v\d+$/, '$1')
    .replace(/(\/v\d+)\/v\d+(?=\/chat\/completions)/, '$1');
  if (trimmed.endsWith('/chat/completions')) return [trimmed];
  if (/\/v\d+$/.test(trimmed)) return [`${trimmed}/chat/completions`];
  return [`${trimmed}/v1/chat/completions`, `${trimmed}/chat/completions`];
}

interface UpstreamChoice {
  message?: { content?: unknown };
  text?: unknown;
}

/** 用户上游非流式补全；失败抛错（由调用方兜底）。429 限流时退避重试一次。 */
async function upstreamComplete(config: UpstreamConfig, messages: LLMMessage[]): Promise<string> {
  const body = JSON.stringify({
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    stream: false,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };
  let lastErr = '';
  for (const url of buildChatCandidates(config.baseUrl)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(60_000) });
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        break; // 网络不通：换下一个候选端点
      }
      if (!res.ok) {
        if (res.status === 429 && attempt === 0) {
          // 429 限流：退避 2.5s 后同端点重试一次
          await new Promise((r) => setTimeout(r, 2500));
          continue;
        }
        lastErr = `上游 ${res.status}`;
        break; // 换下一个候选端点
      }
      const data: unknown = await res.json().catch(() => null);
      const choice = (data as { choices?: UpstreamChoice[] })?.choices?.[0];
      const content =
        (typeof choice?.message?.content === 'string' ? choice.message.content : '') ||
        (typeof choice?.text === 'string' ? choice.text : '');
      if (content.trim()) return content;
      lastErr = '上游返回空内容';
      break;
    }
  }
  throw new Error(lastErr || '上游不可用');
}

/** z-ai-web-dev-sdk 兜底（后端内置）。
 *  429/限流时指数退避重试（1.5s→3s→6s→12s）：SDK 在多模块并发下（朋友圈自动发帖/
 *  论坛生成/翻译）频繁限流，直接抛错会让论坛生成与翻译「一直失败」——
 *  重试后绝大多数能在几秒内拿到结果。
 *  所有实际 create 调用都走 runInSdkQueue 全局串行队列（见下）——
 *  并发打 SDK 是 429 的最大来源，串行后限流大幅下降。 */
async function sdkComplete(messages: LLMMessage[]): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  // ZAI.create() 放进重试循环：限流高峰期 create() 也会 429（放 try 外会绕过退避直接抛）
  let zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;
  let lastErr: unknown = null;
  const waits = [1500, 3000, 6000, 12000, 20000];
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    try {
      if (!zai) zai = await ZAI.create();
      const completion = await runInSdkQueue(() =>
        zai!.chat.completions.create({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          thinking: { type: 'disabled' },
        }),
      );
      const text = completion.choices[0]?.message?.content ?? '';
      if (!text.trim()) throw new Error('内置模型返回空内容');
      return text;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const rateLimited = /429|too many requests|rate.?limit/i.test(msg);
      const wait = waits[attempt];
      if (rateLimited && wait !== undefined) {
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('内置模型调用失败');
}

// ---------------- SDK 全局串行队列 ----------------

/** z-ai SDK 的 chat.completions.create 在并发调用时几乎必 429（论坛生成 +
 *  翻译 + 朋友圈等模块同时打 SDK 时互相挤兑——日志里「翻译一直失败」的主因）。
 *  把所有 SDK 调用排成一条队（并发 = 1）：后面的请求等前面的完成再发；
 *  队头失败不阻塞后续（fn 照常执行）。导出给 /api/translate 等共用。
 *
 *  双优先级（修复「翻译一直失败/排队饿死」）：论坛/朋友圈生成是后台批量任务，
 *  一次串一长队；用户手点「翻译」是交互请求，排在批量任务后面等几分钟必然超时。
 *  high = 交互请求（翻译），发车前先看高优队；normal = 后台生成——并发仍恒为 1
 *  （429 防护不变），只是取任务时高优先出队。 */
interface SdkQJob {
  fn: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}
const sdkHiQueue: SdkQJob[] = [];
const sdkLoQueue: SdkQJob[] = [];
let sdkQRunning = false;

function sdkQPump(): void {
  if (sdkQRunning) return;
  const job = sdkHiQueue.shift() ?? sdkLoQueue.shift();
  if (!job) return;
  sdkQRunning = true;
  void job
    .fn()
    .then(job.resolve, job.reject)
    .finally(() => {
      sdkQRunning = false;
      sdkQPump();
    });
}

/** 入队执行（priority='high' 时插到后台生成任务前面；默认 normal） */
export function runInSdkQueue<T>(fn: () => Promise<T>, opts?: { priority?: 'high' | 'normal' }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: SdkQJob = { fn: fn as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject };
    if (opts?.priority === 'high') sdkHiQueue.push(job);
    else sdkLoQueue.push(job);
    sdkQPump();
  });
}

/**
 * 统一补全入口：用户配置优先（一次尝试），失败/未配置 → SDK 兜底。
 * 返回文本；两个通道都失败抛错。
 */
export async function completeWithFallback(
  config: UpstreamConfig | null,
  messages: LLMMessage[]
): Promise<{ text: string; via: 'upstream' | 'sdk' }> {
  if (config) {
    try {
      return { text: await upstreamComplete(config, messages), via: 'upstream' };
    } catch {
      // 落到 SDK 兜底
    }
  }
  return { text: await sdkComplete(messages), via: 'sdk' };
}

/** 解析请求体 JSON（非法时返回 null） */
export async function readJsonBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 从模型回复中解析 JSON（容忍 ```json 围栏与前后杂文本） */
export function parseLooseJSON<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.search(/[[{]/);
  if (start < 0) return null;
  const open = cleaned[start];
  const close = open === '{' ? '}' : ']';
  const end = cleaned.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
