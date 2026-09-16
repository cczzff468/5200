import { NextResponse, NextRequest } from 'next/server';

export const runtime = 'nodejs';

/**
 * 记忆库 · 从对话提取记忆碎片
 * POST { conversation: { role: 'me'|'peer', text: string }[], app?: string,
 *        userName?: string, peerName?: string,
 *        existing?: { id: string, content: string }[], config?: UpstreamConfig }
 * 返回 { fragments: { text, weight, eventTime?, expiresAt?, supersedes? }[] }（0-6 条；
 *       模型未给权重 / 旧格式字符串时由关键词自动分类兜底，见 memory-core.autoWeight）
 * 视角统一：对话两侧用真实名字渲染，碎片必须用同一对名字指代（禁「对方/用户/我」混用）。
 * 时间感知：prompt 注入当前时间锚点；模型为含时间信息的碎片给出 eventTime/expiresAt（ISO 字符串，
 *       服务端校验范围 ±5 年、过期不得早于事件时间，非法一律置空——绝不让幻觉时间入库）；
 *       矛盾更新：模型对比 existing（已有记忆）给出 supersedes（被更正的旧记忆 id）。
 */

import { completeWithFallback, extractUpstreamConfig, parseLooseJSON, readJsonBody } from '@/lib/server-llm';
import { autoWeight, normalizeWeight, MEM_TIME_RANGE_YEARS } from '@/lib/memory-core';

interface ConvoTurn {
  role: 'me' | 'peer';
  text: string;
}

function isConvoTurn(v: unknown): v is ConvoTurn {
  if (!v || typeof v !== 'object') return false;
  const r = v as { role?: unknown; text?: unknown };
  return (r.role === 'me' || r.role === 'peer') && typeof r.text === 'string' && r.text.trim().length > 0;
}

/** 名字归一化：去空白、限长（prompt 注入保持紧凑）；空值回退固定称呼保证视角一致 */
function cleanName(v: unknown, fallback: string): string {
  const t = typeof v === 'string' ? v.trim().slice(0, 20) : '';
  return t || fallback;
}

/** 当前时间锚点（北京时间）：2026年9月16日 星期三 14:32 */
function nowAnchor(now: Date): string {
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const raw = fmt.format(now); // 形如 2026年9月16日星期三 14:32
  return raw.replace('星期', ' 星期');
}

/** 时间字符串合法性与范围校验（±MEM_TIME_RANGE_YEARS 年），非法返回 null */
function saneTimeStr(v: unknown, nowMs: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s === 'null' || s === 'undefined') return null;
  const t = Date.parse(s.replace(' ', 'T'));
  if (Number.isNaN(t)) return null;
  const span = MEM_TIME_RANGE_YEARS * 366 * 86_400_000;
  if (t < nowMs - span || t > nowMs + span) return null;
  return s;
}

function buildSystem(userName: string, peerName: string, nowLabel: string): string {
  return [
    '你是聊天记忆整理助手。从一段聊天记录中提取值得长期记住的关键信息，形成「记忆碎片」。',
    '【视角规则（最高优先级，违反即无效）】',
    `- 这段对话发生在两个人之间：「${userName}」（用户本人）和「${peerName}」（AI角色）。`,
    `- 每条碎片必须写明说的是谁：只允许用「${userName}」和「${peerName}」这两个名字指代两人。`,
    '- 严禁出现「用户」「对方」「我」「你」「他」「她」「TA」「彼此」等任何代称，严禁混用不同称呼。',
    `- 落笔前先判断这条信息是关于谁的（${userName} 还是 ${peerName}），再把名字写进碎片主语。`,
    `- 例：${userName}明天不上班、${peerName}喜欢打球、${peerName}称${userName}为唯一交心的朋友。`,
    '【时间规则（时间感知：记忆要与当前时间联动）】',
    `- 现在是：${nowLabel}（北京时间）。对话里的相对时间（明天/今晚/下周一/3天后/月底）必须按当前时间换算成绝对时间。`,
    '- eventTime：这条信息所指事件的发生时间。有明确或相对时间信息的都填（含日期即可）。',
    '- expiresAt：这条信息预计失效的时间。只有「一次性的安排/状态/临时偏好」才填（例：明天开会→会后失效；最近在减肥→1-2周后失效）；',
    '  身份、性格、长期事实、周期性习惯（每周三打球）一律 null（永不过期）。',
    '- 格式："YYYY-MM-DD"（仅日期）或 "YYYY-MM-DD HH:mm"（精确到时分）；判断不了就留 null，禁止编造。',
    '- supersedes：仅当本条与「已有记忆」中的某条矛盾（更正/状态变化，如旧记「爱吃辣」现在「不吃辣」）时，填被更正的旧记忆 id 数组；单纯重复提及不算矛盾。',
    '提取范围（只提取这三类）：',
    '- 事实：身份、职业、居住地、重要经历、确定的计划安排',
    '- 偏好：喜好、厌恶、习惯、口味、作息',
    '- 承诺：约定好的事、答应要做的事、欠的人情',
    '规则：',
    '- 每条一句话、30 字以内、具体明确（人名/数字/时间尽量保留）',
    '- 只提取对话中明确出现的信息，禁止推测和编造',
    '- 寒暄客套、当下情绪、不产生长期价值的内容不要',
    '- 每条标注 weight（重要程度）：',
    '  · high = 身份/姓名/亲缘关系、承诺约定、过敏忌口等健康禁忌、重大事实（长期稳定不变）',
    '  · low  = 临时安排（明天/下周去哪）、近期状态（最近在做什么）、可能很快过时的偏好',
    '  · normal = 其余一般事实与稳定偏好',
    '- 最多 6 条，没有值得记的就给空数组',
    '只输出 JSON：{"fragments": [{"text": "...", "weight": "high"|"normal"|"low", "eventTime": null|"YYYY-MM-DD HH:mm", "expiresAt": null|"YYYY-MM-DD HH:mm", "supersedes": []}, ...]}',
  ].join('\n');
}

interface OutItem {
  text: string;
  weight: 'high' | 'normal' | 'low';
  eventTime?: string;
  expiresAt?: string;
  supersedes?: string[];
}

function collect(parsedFragments: unknown[], nowMs: number, validIds: Set<string>): OutItem[] {
  const out: OutItem[] = [];
  for (const x of parsedFragments) {
    if (typeof x === 'string') {
      const t = x.trim();
      if (t) out.push({ text: t, weight: autoWeight(t) });
    } else if (x && typeof x === 'object') {
      const o = x as { text?: unknown; weight?: unknown; eventTime?: unknown; expiresAt?: unknown; supersedes?: unknown };
      if (typeof o.text === 'string' && o.text.trim()) {
        const item: OutItem = { text: o.text.trim(), weight: normalizeWeight(o.weight, o.text) };
        const et = saneTimeStr(o.eventTime, nowMs);
        const ex = saneTimeStr(o.expiresAt, nowMs);
        if (et) item.eventTime = et;
        if (ex) item.expiresAt = ex;
        if (Array.isArray(o.supersedes)) {
          const ids = o.supersedes
            .filter((id): id is string => typeof id === 'string' && validIds.has(id))
            .slice(0, 6);
          if (ids.length > 0) item.supersedes = ids;
        }
        out.push(item);
      }
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  const convo = Array.isArray(body.conversation) ? body.conversation.filter(isConvoTurn) : [];
  if (convo.length < 2) return NextResponse.json({ error: '对话内容太少，无法提取记忆' }, { status: 400 });

  // 视角统一：me=用户本人（真实名字优先），peer=AI 角色；缺省回退固定称呼且全批一致
  const userName = cleanName(body.userName, '用户');
  const peerName = cleanName(body.peerName, '对方');

  const nowMs = Date.now();
  const now = new Date();

  // 已有记忆（矛盾更新对比用）：只收 id+content，id 必须在列表内 supersedes 才会被采纳
  const existingRaw = Array.isArray(body.existing) ? body.existing : [];
  const existing = existingRaw
    .map((e: unknown) => {
      const o = e as { id?: unknown; content?: unknown };
      return o && typeof o.id === 'string' && typeof o.content === 'string'
        ? { id: o.id.slice(0, 40), content: o.content.slice(0, 80) }
        : null;
    })
    .filter((e: { id: string; content: string } | null): e is { id: string; content: string } => e !== null)
    .slice(0, 30);
  const validIds = new Set(existing.map((e: { id: string }) => e.id));

  const convoText = convo
    .slice(-60)
    .map((t) => `${t.role === 'me' ? userName : peerName}：${t.text.slice(0, 400)}`)
    .join('\n');

  const existingText =
    existing.length > 0
      ? `\n\n已有记忆（id：内容；仅当本条与其矛盾时才在 supersedes 里填对应 id）：\n${existing
          .map((e: { id: string; content: string }) => `${e.id}：${e.content}`)
          .join('\n')}`
      : '';

  const messages = [
    { role: 'system' as const, content: buildSystem(userName, peerName, nowAnchor(now)) },
    { role: 'user' as const, content: `聊天记录：\n${convoText}${existingText}` },
  ];

  try {
    const { text } = await completeWithFallback(extractUpstreamConfig(body.config), messages);
    const parsed = parseLooseJSON<{ fragments?: unknown }>(text);
    let items: OutItem[] = [];
    const parsedOk = Boolean(parsed) && Array.isArray(parsed?.fragments);
    if (parsedOk) {
      items = collect(parsed?.fragments as unknown[], nowMs, validIds);
    }
    // JSON 解析失败才按行兜底（解析成功但为空 = 没有值得记的，如实返回空）
    if (items.length === 0 && !parsedOk) {
      items = text
        .split('\n')
        .map((l) => l.replace(/^[-*\d.、\s]+/, '').trim())
        .filter((l) => l.length >= 4 && l.length <= 80 && !l.includes('"fragments"'))
        .slice(0, 6)
        .map((t) => ({ text: t, weight: autoWeight(t) }));
    }
    return NextResponse.json({
      fragments: items
        .slice(0, 6)
        .map((it) => ({
          text: it.text.slice(0, 120),
          weight: it.weight,
          eventTime: it.eventTime ?? null,
          expiresAt: it.expiresAt ?? null,
          supersedes: it.supersedes ?? [],
        })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '提取失败' }, { status: 502 });
  }
}
