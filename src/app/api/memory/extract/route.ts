import { NextResponse, NextRequest } from 'next/server';

export const runtime = 'nodejs';

/**
 * 记忆库 · 从对话提取记忆碎片
 * POST { conversation: { role: 'me'|'peer', text: string }[], app?: string, config?: UpstreamConfig }
 * 返回 { fragments: string[] }（0-6 条；用户 API 配置优先，失败回退内置 SDK）
 */

import { completeWithFallback, extractUpstreamConfig, parseLooseJSON, readJsonBody } from '@/lib/server-llm';

interface ConvoTurn {
  role: 'me' | 'peer';
  text: string;
}

function isConvoTurn(v: unknown): v is ConvoTurn {
  if (!v || typeof v !== 'object') return false;
  const r = v as { role?: unknown; text?: unknown };
  return (r.role === 'me' || r.role === 'peer') && typeof r.text === 'string' && r.text.trim().length > 0;
}

const SYSTEM = `你是聊天记忆整理助手。从一段聊天记录中提取值得长期记住的关键信息，形成「记忆碎片」。
提取范围（只提取这三类）：
- 事实：身份、职业、居住地、重要经历、确定的计划安排
- 偏好：喜好、厌恶、习惯、口味、作息
- 承诺：约定好的事、答应要做的事、欠的人情
规则：
- 每条一句话、30 字以内、具体明确（人名/数字/时间尽量保留）
- 只提取对话中明确出现的信息，禁止推测和编造
- 寒暄客套、当下情绪、不产生长期价值的内容不要
- 最多 6 条，没有值得记的就给空数组
只输出 JSON：{"fragments": ["...", "..."]}`;

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  const convo = Array.isArray(body.conversation) ? body.conversation.filter(isConvoTurn) : [];
  if (convo.length < 2) return NextResponse.json({ error: '对话内容太少，无法提取记忆' }, { status: 400 });

  const convoText = convo
    .slice(-60)
    .map((t) => `${t.role === 'me' ? '用户' : '对方'}：${t.text.slice(0, 400)}`)
    .join('\n');

  const messages = [
    { role: 'system' as const, content: SYSTEM },
    { role: 'user' as const, content: `聊天记录：\n${convoText}` },
  ];

  try {
    const { text } = await completeWithFallback(extractUpstreamConfig(body.config), messages);
    const parsed = parseLooseJSON<{ fragments?: unknown }>(text);
    let fragments: string[] = [];
    const parsedOk = Boolean(parsed) && Array.isArray(parsed?.fragments);
    if (parsedOk) {
      fragments = (parsed?.fragments as unknown[]).filter(
        (x): x is string => typeof x === 'string' && x.trim().length > 0
      );
    }
    // JSON 解析失败才按行兜底（解析成功但为空 = 没有值得记的，如实返回空）
    if (fragments.length === 0 && !parsedOk) {
      fragments = text
        .split('\n')
        .map((l) => l.replace(/^[-*\d.、\s]+/, '').trim())
        .filter((l) => l.length >= 4 && l.length <= 80 && !l.includes('"fragments"'))
        .slice(0, 6);
    }
    return NextResponse.json({ fragments: fragments.slice(0, 6).map((f) => f.slice(0, 120)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '提取失败' }, { status: 502 });
  }
}
