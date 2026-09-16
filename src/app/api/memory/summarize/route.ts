import { NextResponse, NextRequest } from 'next/server';

export const runtime = 'nodejs';

/**
 * 记忆库 · 多条记忆碎片总结为一条长期记忆（核心记忆）
 * POST { fragments: string[], config?: UpstreamConfig }
 * 返回 { summary: string }（用户 API 配置优先，失败回退内置 SDK）
 */

import { completeWithFallback, extractUpstreamConfig, parseLooseJSON, readJsonBody } from '@/lib/server-llm';

const SYSTEM = `你是记忆总结助手。把关于同一个人的多条「记忆碎片」浓缩成一条「核心记忆」。
要求：
- 一段话，80 字以内，覆盖最重要的长期事实、偏好、承诺与关系进展
- 信息冲突时以更晚的碎片为准；禁止推测和编造
- 语言自然、第三人称（用「对方/用户」指代），不要罗列条目
只输出 JSON：{"summary": "..."}`;

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  const fragments = Array.isArray(body.fragments)
    ? body.fragments.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  if (fragments.length < 2) return NextResponse.json({ error: '碎片数量太少，无需总结' }, { status: 400 });

  const messages = [
    { role: 'system' as const, content: SYSTEM },
    { role: 'user' as const, content: `记忆碎片：\n${fragments.slice(0, 40).map((f, i) => `${i + 1}. ${f}`).join('\n')}` },
  ];

  try {
    const { text } = await completeWithFallback(extractUpstreamConfig(body.config), messages);
    const parsed = parseLooseJSON<{ summary?: unknown }>(text);
    let summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
    const parsedOk = Boolean(parsed);
    if (!summary && !parsedOk) {
      // JSON 解析失败才取第一段有效文本（解析成功但空 = 上游异常，如实报错）
      summary =
        text
          .split('\n')
          .map((l) => l.replace(/^[-*\d.、\s]+/, '').trim())
          .find((l) => l.length >= 8) ?? '';
    }
    if (!summary) return NextResponse.json({ error: '总结结果为空' }, { status: 502 });
    return NextResponse.json({ summary: summary.slice(0, 300) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '总结失败' }, { status: 502 });
  }
}
