import { NextResponse } from 'next/server';

interface UpstreamErrorShape {
  error?: { message?: unknown } | string;
  message?: unknown;
}

/** 尽力提取上游错误原文（{error:{message}} / {error:"..."} / {message}） */
function extractUpstreamError(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as UpstreamErrorShape;
  if (typeof obj.error === 'string') return obj.error;
  if (obj.error && typeof obj.error === 'object' && typeof obj.error.message === 'string') {
    return obj.error.message;
  }
  if (typeof obj.message === 'string') return obj.message;
  return '';
}

/** 从错误响应体提取 message（先按 JSON 解析，失败则截取原文） */
async function readErrorMessage(res: Response): Promise<string> {
  const raw = await res.text().catch(() => '');
  if (!raw) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    const msg = extractUpstreamError(parsed);
    if (msg) return msg;
  } catch {
    // 非 JSON 错误体
  }
  return raw.slice(0, 160);
}

/** 修正重复的版本段（粘贴常见错误：/v1/v1 → /v1） */
function collapseVersions(u: string): string {
  return u.replace(/(\/v\d+)\/v\d+$/, '$1');
}

/** 私有/本机地址（云端服务器不可达，客户端应改用浏览器直连） */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

/**
 * 归一化出 chat/completions 端点候选：以版本段（/v1、/v4 等）结尾直接拼；
 * 否则先试 /v1/chat/completions 再试 /chat/completions（与 direct-api 客户端逻辑一致）。
 */
function buildChatCandidates(rawBaseUrl: string): string[] {
  let base = collapseVersions(rawBaseUrl.trim().replace(/\/+$/, ''));
  const marker = 'chat/completions';
  const idx = base.indexOf(marker);
  if (idx !== -1) base = collapseVersions(base.slice(0, idx).replace(/\/+$/, ''));
  if (base.endsWith(marker)) return [base];
  if (/\/v\d+$/.test(base)) return [`${base}/${marker}`];
  return [`${base}/v1/${marker}`, `${base}/${marker}`];
}

/**
 * 测试连接：向上游发一次极小请求，返回可达性与延迟。
 * 与 /api/settings/models 同一套约定：
 * - 私有/本机地址 → 立即返回 directOnly=true，客户端改用浏览器直连（同网才可达）；
 * - 公网地址 → 服务器端真实请求，透传上游具体错误；地区限制/网络不可达时同样返回
 *   directOnly=true，客户端会用「浏览器直连」再兜底一次（用户浏览器网络可能可达）。
 *
 * 参数兼容自动重试（拉取模型成功但测试失败的最常见原因）：
 * 新版 OpenAI 系模型（o1/o3/gpt-5 等）拒绝 max_tokens（要求 max_completion_tokens）、
 * 只支持默认温度；部分网关只支持流式。按上游 400 报错逐项调整后自动重试。
 */
export async function POST(request: Request) {
  let body: { baseUrl?: unknown; apiKey?: unknown; model?: unknown; temperature?: unknown; maxTokens?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: '请求体不是有效的 JSON' }, { status: 400 });
  }

  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gpt-4o-mini';
  const temperature = typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? body.temperature : 0.7;
  const maxTokens = typeof body.maxTokens === 'number' && Number.isFinite(body.maxTokens) ? Math.min(body.maxTokens, 16) : 16;

  if (!baseUrl) {
    return NextResponse.json({ ok: false, error: '请先填写 API 地址' }, { status: 400 });
  }

  // 内网地址：云端服务器必然不可达，立即返回 directOnly 标记让客户端改用浏览器直连
  try {
    if (isPrivateHost(new URL(baseUrl).hostname)) {
      return NextResponse.json(
        {
          ok: false,
          error: '该地址位于局域网/本机，云端服务器无法访问，已改用浏览器直连',
          directOnly: true,
          url: baseUrl,
        },
        { status: 502 }
      );
    }
  } catch {
    // URL 解析失败走正常流程
  }

  const candidates = buildChatCandidates(baseUrl);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  /** 可按上游 400 报错逐项调整的请求参数（对齐新模型约束） */
  let useMaxCompletion = false;
  let curTemperature: number | undefined = temperature;
  let curStream = false;

  const makeBody = (): string =>
    JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      ...(curTemperature === undefined ? {} : { temperature: curTemperature }),
      ...(useMaxCompletion ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
      stream: curStream,
    });

  let lastUrl = candidates[0];
  let lastMsg = '';
  let lastWasNetwork = true;

  for (const url of candidates) {
    lastUrl = url;
    // 参数兼容重试：最多 3 次尝试（原始 → 换 max_completion_tokens → 去掉 temperature → 流式）
    for (let attempt = 0; attempt < 3; attempt++) {
      const startedAt = Date.now();
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: makeBody(),
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        // 网络错误 / 超时：换下一个候选路径
        lastWasNetwork = true;
        break;
      }
      lastWasNetwork = false;

      if (res.ok) {
        // 读掉响应体（可能是 JSON 或 SSE，均只取可达性与延迟）
        await res.text().catch(() => '');
        return NextResponse.json({ ok: true, latencyMs: Date.now() - startedAt, model, url });
      }

      const msg = await readErrorMessage(res);

      if (res.status === 400) {
        // 按上游提示逐项调整参数后重试（max_tokens → max_completion_tokens → 去温度）
        if (!useMaxCompletion && /max_completion_tokens|unsupported parameter.{0,40}max_tokens/i.test(msg)) {
          useMaxCompletion = true;
          continue;
        }
        if (curTemperature !== undefined && /temperature/i.test(msg)) {
          curTemperature = undefined;
          continue;
        }
        if (!curStream && /stream/i.test(msg)) {
          curStream = true;
          continue;
        }
      }

      if (res.status === 401) {
        return NextResponse.json(
          { ok: false, error: 'API Key 无效或未授权（401）', url, latencyMs: Date.now() - startedAt },
          { status: 502 }
        );
      }
      if (res.status === 404) {
        lastMsg = '接口路径或模型不存在（404），请检查 API 地址与模型名';
        break; // 换下一个候选路径
      }
      if (res.status === 405 || res.status === 501) {
        lastMsg = `上游接口返回 ${res.status}`;
        break; // 路径不允许：换下一个候选
      }
      if (res.status === 403) {
        if (/country|region|territory|unsupported|blocked/i.test(msg)) {
          return NextResponse.json(
            {
              ok: false,
              error: `服务拒绝访问（403）：${msg} —— 该服务商对服务器所在地区限制`,
              directOnly: true,
              url,
              latencyMs: Date.now() - startedAt,
            },
            { status: 502 }
          );
        }
        return NextResponse.json(
          { ok: false, error: `服务拒绝访问（403）：${msg || '未说明原因'}`, url, latencyMs: Date.now() - startedAt },
          { status: 502 }
        );
      }
      if (res.status === 429) {
        return NextResponse.json(
          { ok: false, error: '请求频率超限（429），请稍后再试', directOnly: true, url, latencyMs: Date.now() - startedAt },
          { status: 502 }
        );
      }

      lastMsg = msg || `上游接口返回 ${res.status}`;
      return NextResponse.json(
        { ok: false, error: lastMsg, url, latencyMs: Date.now() - startedAt },
        { status: 502 }
      );
    }
  }

  // 所有候选都网络不可达：值得让客户端用浏览器直连再试一次
  if (lastWasNetwork) {
    return NextResponse.json(
      {
        ok: false,
        error: '无法连接到目标 API：地址不可达或服务商网络受限',
        directOnly: true,
        url: lastUrl,
      },
      { status: 502 }
    );
  }
  return NextResponse.json(
    { ok: false, error: lastMsg || '无法连接到目标 API', url: lastUrl },
    { status: 502 }
  );
}
