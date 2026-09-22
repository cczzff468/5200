import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 电话 App · AI 通话对话轮次
 * POST { contact?: { name, kind, gender, age, occupation, region, relation, persona, background },
 *        number: string, greeting?: boolean,
 *        history: { role: 'user' | 'assistant', content: string }[],
 *        config: { baseUrl, apiKey, model, temperature, maxTokens } }
 * 返回 { reply, name } 或 { directOnly: true, messages, name }
 * 联系人资料由前端直传（联系人存浏览器本地 IndexedDB，服务端不查库）；不传则按陌生号码处理。
 *
 * 统一策略（只有一套逻辑，无内置模型）：
 * 永远使用设置 App「API 设置」里配置的 OpenAI 兼容接口；
 * - 公网地址 → 服务端代理转发（浏览器无感）；
 * - 内网 / 本机地址 → 返回 directOnly + 组装好的 messages，由浏览器直连
 *   （云端服务器不可达内网，见 src/lib/ios/direct-api.ts）。
 * 未配置 / 上游报错 → 返回友好错误，不再回退任何内置模型。
 */

import { buildPersonaSystemPrompt, type PersonaSource } from '@/lib/ios/persona';

interface TurnMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CallApiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface UpstreamConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

/** 从请求体提取上游配置：必须有 baseUrl（反代/中转接口可能无需 Key） */
function extractUpstreamConfig(raw: unknown): UpstreamConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const baseUrl = typeof r.baseUrl === 'string' ? r.baseUrl.trim() : '';
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: typeof r.apiKey === 'string' ? r.apiKey.trim() : '',
    model: typeof r.model === 'string' && r.model.trim() ? r.model.trim() : 'gpt-4o-mini',
    temperature: typeof r.temperature === 'number' ? r.temperature : 0.7,
    maxTokens: typeof r.maxTokens === 'number' ? r.maxTokens : 2048,
  };
}

/** 是否私有/本机地址（云端服务器大概率不可达，需浏览器直连） */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h.endsWith('.local') ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/** baseUrl 归一化候选：完整端点 / /v1 结尾 / 裸域名，自动修 /v1/v1（与 /api/chat 一致） */
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

/** 从任意形态的错误体提取 message（{error:{message}} / {error:"..."} / {message}） */
function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as { error?: unknown; message?: unknown };
  if (typeof obj.error === 'string') return obj.error;
  if (obj.error && typeof obj.error === 'object') {
    const msg = (obj.error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  if (typeof obj.message === 'string') return obj.message;
  return '';
}

/** 从上游响应体提取回复文本：兼容标准 choices / {message}/{content}/{response} / SSE 文本 / 纯文本 */
function extractReplyText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // 个别网关即使 stream:false 也返回 SSE 文本：拼接全部增量
  if (trimmed.startsWith('data:') || trimmed.startsWith('event:')) {
    let acc = '';
    for (const line of trimmed.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const p = t.slice(5).trim();
      if (!p || p === '[DONE]') continue;
      try {
        const chunk = JSON.parse(p) as Record<string, unknown>;
        const choices = Array.isArray(chunk.choices) ? (chunk.choices as unknown[]) : [];
        const first = choices[0] as { delta?: { content?: unknown }; message?: { content?: unknown } } | undefined;
        const d = first?.delta?.content ?? first?.message?.content;
        if (typeof d === 'string') acc += d;
      } catch {
        // 忽略无法解析的行
      }
    }
    return acc.trim();
  }
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed.slice(0, 2000);
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const choices = Array.isArray(parsed.choices) ? (parsed.choices as unknown[]) : [];
    const first = choices[0] as
      | { message?: { content?: unknown }; delta?: { content?: unknown }; text?: unknown }
      | undefined;
    const c = first?.message?.content ?? first?.delta?.content ?? first?.text;
    if (typeof c === 'string') return c.trim();
    if (Array.isArray(c)) {
      const joined = c
        .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
        .join('');
      if (joined.trim()) return joined.trim();
    }
    const msg = parsed.message as { content?: unknown } | undefined;
    if (msg && typeof msg.content === 'string') return msg.content.trim();
    if (typeof parsed.content === 'string') return parsed.content.trim();
    if (typeof parsed.response === 'string') return parsed.response.trim();
    return '';
  } catch {
    return '';
  }
}

/** 上游错误 → 通话场景友好文案 */
function friendlyUpstreamError(status: number, bodyText: string): string {
  let msg = '';
  if (bodyText.startsWith('{')) {
    try {
      msg = extractErrorMessage(JSON.parse(bodyText));
    } catch {
      // 非 JSON
    }
  }
  const REGION_BLOCKED = /country|region|territory|unsupported|blocked/i.test(msg) || /unsupported_country/i.test(bodyText);
  if (status === 401) return 'API Key 无效或未授权（401）';
  if (status === 403) {
    return REGION_BLOCKED
      ? `服务拒绝访问（403）：${msg}——请换用国内 API（DeepSeek / Kimi / 智谱 GLM）`
      : `服务拒绝访问（403）：${msg}`;
  }
  if (status === 404) return '接口路径或模型不存在（404），请到 设置 › API 设置 检查地址与模型名';
  if (status === 429) return `请求过于频繁或额度不足（429）${msg ? `：${msg}` : ''}`;
  return msg || bodyText.slice(0, 160) || `上游接口返回 ${status}`;
}

/**
 * 服务端代理调用用户自己的 API（非流式：通话需要整句文本再喂 TTS）。
 * 返回 { reply } 或 { error }。
 */
async function callUpstream(
  config: UpstreamConfig,
  messages: CallApiMessage[]
): Promise<{ reply?: string; error?: string }> {
  const candidates = buildChatCandidates(config.baseUrl);
  const payloadBody = JSON.stringify({
    model: config.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    stream: false,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };

  let lastErr: unknown = null;
  let lastEndpoint = candidates[candidates.length - 1];
  for (const endpoint of candidates) {
    lastEndpoint = endpoint;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: payloadBody,
        signal: AbortSignal.timeout(30000),
      });
    } catch (err) {
      lastErr = err;
      continue;
    }
    const raw = await res.text().catch(() => '');
    if (res.ok) {
      const reply = extractReplyText(raw);
      if (reply) return { reply };
      continue; // 200 但解析不出内容：试下一个候选端点
    }
    if (res.status === 404 && endpoint !== candidates[candidates.length - 1]) {
      continue; // 路径不存在：尝试下一个候选端点
    }
    return { error: friendlyUpstreamError(res.status, raw) };
  }
  const detail = lastErr instanceof Error && lastErr.message ? lastErr.message : '未知错误';
  return { error: `无法连接到目标 API：${detail}（实际请求端点：${lastEndpoint}）` };
}

/** 前端直传的对端联系人资料（联系人已本地化，服务端不再查库） */
interface InlineContact {
  name: string;
  kind: string;
  gender: string | null;
  age: string | null;
  occupation: string | null;
  region: string | null;
  persona: string | null;
  background: string | null;
  relation: string | null;
  /** 仅 NPC：对机主（USER）的关系 */
  relationToUser: string | null;
  /** 生日（几月几号，如 6.20 / 6月20日；注入人设前归一化） */
  birthday: string | null;
  /** 配角圈注入（由前端 npc-bond 组装）：认识的配角/归属者资料卡/背景近况 */
  ownerLabel?: string;
  npcCircle?: { name: string; relation: string; relationToUser: string; persona: string }[];
  ownerCard?: string[];
  backgroundNotes?: string[];
}

function parseInlineContact(raw: unknown): InlineContact | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.name !== 'string' || !c.name.trim()) return null;
  return {
    name: c.name.trim().slice(0, 60),
    kind: typeof c.kind === 'string' ? c.kind : 'char',
    gender: typeof c.gender === 'string' ? c.gender : null,
    age: typeof c.age === 'string' ? c.age : null,
    occupation: typeof c.occupation === 'string' ? c.occupation : null,
    region: typeof c.region === 'string' ? c.region : null,
    persona: typeof c.persona === 'string' ? c.persona : null,
    background: typeof c.background === 'string' ? c.background : null,
    relation: typeof c.relation === 'string' ? c.relation : null,
    relationToUser: typeof c.relationToUser === 'string' ? c.relationToUser : null,
    birthday: typeof c.birthday === 'string' ? c.birthday : null,
    ownerLabel: typeof c.ownerLabel === 'string' ? c.ownerLabel : undefined,
    npcCircle: parseNpcCircle(c.npcCircle),
    ownerCard: parseStrList(c.ownerCard),
    backgroundNotes: parseStrList(c.backgroundNotes),
  };
}

/** 前端直传的配角圈条目（宽松解析，非法条目丢弃，上限 6 条） */
function parseNpcCircle(raw: unknown): { name: string; relation: string; relationToUser: string; persona: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: { name: string; relation: string; relationToUser: string; persona: string }[] = [];
  for (const x of raw.slice(0, 6)) {
    if (!x || typeof x !== 'object') continue;
    const e = x as Record<string, unknown>;
    if (typeof e.name !== 'string' || !e.name.trim()) continue;
    out.push({
      name: e.name.trim().slice(0, 40),
      relation: typeof e.relation === 'string' ? e.relation.slice(0, 40) : '',
      relationToUser: typeof e.relationToUser === 'string' ? e.relationToUser.slice(0, 40) : '',
      persona: typeof e.persona === 'string' ? e.persona.slice(0, 60) : '',
    });
  }
  return out.length > 0 ? out : undefined;
}

/** 前端直传的字符串列表（宽松解析，去空，上限 4 条） */
function parseStrList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 120))
    .slice(0, 4);
  return out.length > 0 ? out : undefined;
}

/** 陌生号码的随机身份（按号码做种子，保证同人同号） */
function unknownPersona(number: string): { name: string; persona: string } {
  const seeds = [
    { name: '陌生号码', persona: '一个打错电话的普通市民，本来想找别人，发现打错后有点抱歉，但也会随和地聊几句' },
    { name: '外卖骑手', persona: '正在送餐的外卖骑手，风风火火，说话简短急促，电话是问地址的' },
    { name: '快递员', persona: '快递员，语气公事公办，通知取件相关的事情' },
    { name: '客服小妹', persona: '某公司客服，礼貌甜美的职业腔调，做满意度回访' },
    { name: '老同学', persona: '声称是用户多年没联系的老同学，热情自来熟，想约饭叙旧' },
  ];
  let hash = 0;
  for (const ch of number) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return seeds[hash % seeds.length];
}

/**
 * 组装通话场景 system prompt：七要素人设（名字/身份/性格/说话风格/背景/与用户的关系/禁止事项）
 * 由全 App 共用模块从联系人数据组装；这里只追加语音通话场景规则。
 */
function buildCallSystemPrompt(
  peer: PersonaSource,
  greeting: boolean,
  npcExtra?: { ownerLabel?: string; npcCircle?: InlineContact['npcCircle']; ownerCard?: string[]; backgroundNotes?: string[] }
): string {
  const base = buildPersonaSystemPrompt(peer, {
    channel: '语音通话',
    userName: null,
    ...npcExtra,
    extraRules: [
      '这是实时语音通话：用第一人称口语化说话，像真人打电话；每次只说 1-2 句（通常不超过 20 个字），一次只说一件事；',
      '禁止任何表情符号、emoji、引号、括号、列表；只输出要说出口的话；',
      '打电话会互相打招呼、寒暄、自然结束（如"那我先挂了啊"）；对方说的内容要自然回应。',
    ],
  });
  if (!greeting) return base;
  return base + '\n现在用户刚拨通电话，请你像接到电话一样先开口打招呼（先喂一声，再说一句自然的话）。';
}

function normalizeHistory(value: unknown): TurnMessage[] {
  if (!Array.isArray(value)) return [];
  const out: TurnMessage[] = [];
  for (const item of value.slice(-16)) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as { role?: unknown; content?: unknown };
    if ((rec.role === 'user' || rec.role === 'assistant') && typeof rec.content === 'string' && rec.content.trim()) {
      out.push({ role: rec.role, content: rec.content.trim().slice(0, 500) });
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const number = typeof root.number === 'string' ? root.number.trim() : '';
  if (!number) {
    return NextResponse.json({ error: '缺少号码' }, { status: 400 });
  }
  const greeting = root.greeting === true;
  const history = normalizeHistory(root.history);

  // 解析对端身份：前端直传的联系人资料 / 陌生号码（联系人存本地 IndexedDB，服务端不查库）
  const inline = parseInlineContact(root.contact);
  const peer: PersonaSource = inline
    ? {
        name: inline.name,
        kind: inline.kind,
        gender: inline.gender,
        age: inline.age,
        occupation: inline.occupation,
        region: inline.region,
        persona: inline.persona,
        background: inline.background,
        relation: inline.relation,
        relationToUser: inline.relationToUser,
        birthday: inline.birthday,
      }
    : (() => {
        const p = unknownPersona(number);
        return { name: p.name, persona: p.persona };
      })();
  const peerName = peer.name;

  const system = buildCallSystemPrompt(peer, greeting, {
    ownerLabel: inline?.ownerLabel,
    npcCircle: inline?.npcCircle,
    ownerCard: inline?.ownerCard,
    backgroundNotes: inline?.backgroundNotes,
  });
  // 记忆库：前端传入的跨 App 记忆块（互通开关范围已由前端过滤），附加在人设之后
  const memoryBlock = typeof root.memoryBlock === 'string' ? root.memoryBlock.trim() : '';
  // 社交动态块：前端按互通开关现场构建的「最近朋友圈/QQ动态 + 相关互动」（动态与聊天记忆双向打通）
  const momentsBlock = typeof root.momentsBlock === 'string' ? root.momentsBlock.trim() : '';
  // 时间感知块：前端按联系人开关现场构建（当前时间/季节/节日/事件时长/上次聊天间隔），附加在记忆之后
  const timeBlock = typeof root.timeBlock === 'string' ? root.timeBlock.trim() : '';
  const systemFull = [system, memoryBlock, momentsBlock, timeBlock].filter(Boolean).join('\n\n');

  // 上游要求 messages 必须以 user 消息收尾：
  // - 普通轮次：历史本身以用户刚说的话收尾，直接透传；
  // - 接通问候：补一条 user 消息触发开口。
  const messages: CallApiMessage[] = [{ role: 'system', content: systemFull }, ...history];
  if (greeting && (messages.length === 1 || messages[messages.length - 1].role !== 'user')) {
    messages.push({ role: 'user', content: '（电话已拨通，请先开口打招呼）' });
  } else if (!greeting && messages.length > 1 && messages[messages.length - 1].role === 'assistant') {
    // 兜底：正常轮次历史不该以 assistant 收尾，补一条 user 触发回应
    messages.push({ role: 'user', content: '（请继续用口语回应）' });
  }

  // ---------- 统一走用户自己的 API（设置 App › API 设置），无内置模型 ----------
  const config = extractUpstreamConfig(root.config);
  if (!config) {
    return NextResponse.json(
      { error: '尚未配置 API：请到 设置 › API 设置 填写接口地址后再拨打' },
      { status: 400 }
    );
  }
  let hostname = '';
  try {
    hostname = new URL(config.baseUrl).hostname;
  } catch {
    return NextResponse.json({ error: 'API 地址无法解析，请到 设置 › API 设置 检查' }, { status: 400 });
  }
  // 内网 / 本机地址：云端服务器必然不可达 → 交给浏览器直连（返回组装好的 messages）
  if (isPrivateHost(hostname)) {
    return NextResponse.json({ directOnly: true, messages, name: peerName });
  }
  // 公网地址：服务端代理转发（对浏览器透明，同一套逻辑）
  const result = await callUpstream(config, messages);
  if (result.reply) {
    // 去掉可能出现的 markdown 符号/首尾引号包裹
    const reply = result.reply
      .replace(/[*_`#>~[\]]/g, '')
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .trim();
    if (reply) return NextResponse.json({ reply, name: peerName });
    return NextResponse.json({ error: '对方没有回应，请稍后再试' }, { status: 502 });
  }
  return NextResponse.json({ error: result.error ?? '对方信号不好，稍后再试' }, { status: 502 });
}
