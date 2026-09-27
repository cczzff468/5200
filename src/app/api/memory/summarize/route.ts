import { NextResponse, NextRequest } from 'next/server';

export const runtime = 'nodejs';

/**
 * 记忆库 · 总结为更高一层记忆
 * POST { fragments: string[], level?: 'core'|'long', userName?: string, peerName?: string, config?: UpstreamConfig }
 * - level='core'（默认）：多条「记忆碎片」→ 一条「核心记忆」
 * - level='long'：多条「核心记忆」→ 一条「长期记忆」（记忆层级顶层，最稳定画像）
 * 返回 { summary: string }（用户 API 配置优先，失败回退内置 SDK）
 * 视角统一：只允许用双方真实名字指代（禁「对方/用户/我」混用）。
 */

import { completeWithFallback, extractUpstreamConfig, parseLooseJSON, readJsonBody } from '@/lib/server-llm';

/** 名字归一化：去空白、限长；空值回退固定称呼保证视角一致 */
function cleanName(v: unknown, fallback: string): string {
  const t = typeof v === 'string' ? v.trim().slice(0, 20) : '';
  return t || fallback;
}

function perspectiveRules(userName: string, peerName: string, participants: string[] = []): string[] {
  if (participants.length) {
    return [
      '【视角规则（最高优先级，违反即无效）】',
      `- 这些记忆来自群聊场景，涉及的人物可能不止两位：除了「${userName}」（用户本人）与「${peerName}」（AI角色），还可能提到这些群成员：${participants.slice(0, 12).join('、')}（或记忆原文里已出现的其他具体成员名字）。`,
      '- 指代人物只允许用具体名字（上面列出的成员名或原文里已有的名字），严禁出现「用户」「对方」「我」「你」「他」「她」「TA」「彼此」等代称。',
      '- 每条信息必须保留原文的归属：谁的事就写谁的名字，严禁把其他成员的事改写成「' + userName + '」或「' + peerName + '」的事。',
    ];
  }
  return [
    '【视角规则（最高优先级，违反即无效）】',
    `- 只允许用「${userName}」（用户本人）和「${peerName}」（AI角色）这两个名字指代两人。`,
    '- 严禁出现「用户」「对方」「我」「你」「他」「她」「TA」「彼此」等任何代称。',
    '- 每条信息必须写明属于谁：先判断说的是谁的事，再把名字写进主语。',
    `- 若原文里出现这两人之外的其他具体人名，保留原名字、照实归因，不要改写成两人的事。`,
    `- 例：${userName}明天不上班、${peerName}喜欢打球、${peerName}称${userName}为唯一交心的朋友。`,
  ];
}

function buildSystem(level: 'core' | 'long', userName: string, peerName: string, participants: string[] = []): string {
  if (level === 'long') {
    return [
      '你是记忆总结助手。把多条「核心记忆」浓缩成一条「长期记忆」（最稳定的人物画像）。',
      ...perspectiveRules(userName, peerName, participants),
      '要求：',
      '- 一段话，120 字以内，只保留长期稳定的事实、偏好、承诺与关系本质，省略已经过时的临时细节',
      '- 信息冲突时以更晚的核心记忆为准；禁止推测和编造',
      '- 语言自然、第三人称叙述，不要罗列条目',
      '只输出 JSON：{"summary": "..."}',
    ].join('\n');
  }
  return [
    '你是记忆总结助手。把关于同两个人的多条「记忆碎片」浓缩成一条「核心记忆」。',
    ...perspectiveRules(userName, peerName),
    '要求：',
    '- 一段话，80 字以内，覆盖最重要的长期事实、偏好、承诺与关系进展',
    '- 信息冲突时以更晚的碎片为准；禁止推测和编造',
    '- 语言自然、第三人称叙述，不要罗列条目',
    '只输出 JSON：{"summary": "..."}',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  const level: 'core' | 'long' = body.level === 'long' ? 'long' : 'core';
  const userName = cleanName(body.userName, '用户');
  const peerName = cleanName(body.peerName, '对方');
  // 群聊来源：成员显示名（有名单时按实际人物归因，不强制二人视角）
  const participants = Array.isArray(body.participants)
    ? body.participants
        .map((v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 20) : ''))
        .filter((v: string) => v.length > 0)
        .slice(0, 20)
    : [];
  const items = Array.isArray(body.fragments)
    ? body.fragments.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  if (items.length < 2) return NextResponse.json({ error: '数量太少，无需总结' }, { status: 400 });

  const messages = [
    { role: 'system' as const, content: buildSystem(level, userName, peerName, participants) },
    {
      role: 'user' as const,
      content: `${level === 'long' ? '核心记忆' : '记忆碎片'}：\n${items
        .slice(0, 40)
        .map((f: string, i: number) => `${i + 1}. ${f}`)
        .join('\n')}`,
    },
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
    return NextResponse.json({ summary: summary.slice(0, level === 'long' ? 400 : 300) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '总结失败' }, { status: 502 });
  }
}
