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

/** 从请求体提取上游配置：必须有 baseUrl（反代/中转接口可能无需 Key） */
export function extractUpstreamConfig(raw: unknown): UpstreamConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const baseUrl = typeof r.baseUrl === 'string' ? r.baseUrl.trim() : '';
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: typeof r.apiKey === 'string' ? r.apiKey.trim() : '',
    model: typeof r.model === 'string' && r.model.trim() ? r.model.trim() : 'gpt-4o-mini',
    temperature: typeof r.temperature === 'number' ? r.temperature : 0.7,
    maxTokens: typeof r.maxTokens === 'number' && Number.isFinite(r.maxTokens) && r.maxTokens > 0 ? Math.floor(r.maxTokens) : 2048,
  };
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

/** 用户上游非流式补全；失败抛错（由调用方兜底） */
async function upstreamComplete(config: UpstreamConfig, messages: LLMMessage[]): Promise<string> {
  const body = JSON.stringify({
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    stream: false,
  });
  let lastErr = '';
  for (const url of buildChatCandidates(config.baseUrl)) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body,
      });
      if (!res.ok) {
        lastErr = `上游 ${res.status}`;
        continue;
      }
      const data: unknown = await res.json().catch(() => null);
      const choice = (data as { choices?: UpstreamChoice[] })?.choices?.[0];
      const content =
        (typeof choice?.message?.content === 'string' ? choice.message.content : '') ||
        (typeof choice?.text === 'string' ? choice.text : '');
      if (content.trim()) return content;
      lastErr = '上游返回空内容';
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastErr || '上游不可用');
}

/** z-ai-web-dev-sdk 兜底（后端内置） */
async function sdkComplete(messages: LLMMessage[]): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: messages.map((m) => ({ role: m.role === 'system' ? 'assistant' : m.role, content: m.content })),
    thinking: { type: 'disabled' },
  });
  const text = completion.choices[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('内置模型返回空内容');
  return text;
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
