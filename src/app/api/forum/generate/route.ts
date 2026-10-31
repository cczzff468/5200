import { NextResponse } from 'next/server';

/**
 * X论坛 · AI 内容生成（服务端）。
 *
 * POST {
 *   config?: UpstreamConfig,             // 设置 App 的用户 API；缺省 SDK 兜底
 *   kind: 'posts' | 'reply' | 'dm' | 'comments' | 'subreplies',
 *   items?: { name, persona?, community? }[],          // posts：批量生成多位作者的帖子（一次最多 24 条）
 *   author?: { name, persona? },        // reply/dm：说话人
 *   parent?: { authorName, content },   // reply：被回复的帖子/评论
 *   postContent?: string,               // reply：所在主帖内容（多轮对话上下文）
 *   mediaDesc?: string,                 // reply/comments/subreplies：帖子配图的文字描述（识图模型产出）
 *   history?: { from: 'user' | 'peer', text }[],       // dm：对话上下文；reply：评论串最近几轮
 *   post?: { authorName, content, mediaDesc? },        // comments/subreplies：被评论的主帖
 *   count?: number,                     // comments：生成几条评论（10~30）
 *   threads?: { authorName, content }[],               // subreplies：被回复的评论列表（逐条对应输出）
 *   personas?: { name, persona? }[],    // comments/subreplies：每条对应的评论者（与输出行一一对应）
 *   userName?: string,                  // 机主名（称呼/被回复者）
 *   avoid?: string[],                   // 防重复：最近已出现过的内容
 * }
 * → { items: string[] }（posts/comments/subreplies 批量）；{ text: string }（reply/dm）
 *
 * 输出清洗：extractThinkBlocks 剥 [思考] 块；去引号/围栏/舞台指示；长度截断；
 * 时间感知注入与 moments/generate 同口径（北京时间 + 时段语境）。
 */

import { completeWithFallback, extractUpstreamConfig, type LLMMessage, type UpstreamConfig } from '@/lib/server-llm';
import { extractThinkBlocks } from '@/lib/think-filter';

function cleanText(raw: string, max: number): string {
  let t = extractThinkBlocks(raw ?? '').text;
  t = t.replace(/```(?:[\w-]+)?/gi, '').trim();
  t = t.replace(/^[「"'“"]+/, '').replace(/[」"'”"]+$/, '').trim();
  // 去掉编号前缀（批量输出时模型爱加 1. 2.）
  t = t.replace(/^\s*\d+\s*[.、)）]\s*/, '').trim();
  // 去掉开头的舞台指示；正文以 #话题 开头时除外
  if (!/^#/.test(t)) t = t.replace(/^[（(【\[][^）)】\]]{0,24}[）)】\]]/, '').trim();
  t = t.replace(/\n{2,}/g, '\n').trim();
  return t.slice(0, max);
}

/** 北京时间行（与 moments/generate 同口径） */
function bjTimeLine(): string {
  const d = new Date(Date.now() + 8 * 3600_000);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const period =
    hour >= 5 && hour < 8 ? '清晨'
    : hour >= 8 && hour < 11 ? '上午'
    : hour >= 11 && hour < 13 ? '中午'
    : hour >= 13 && hour < 17 ? '下午'
    : hour >= 17 && hour < 19 ? '傍晚'
    : hour >= 19 && hour < 23 ? '晚上'
    : '深夜';
  const hm = `${hour}:${String(minute).padStart(2, '0')}`;
  return `（现在是北京时间 ${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${hm}，${period}——发言要符合这个时间的语境：凌晨/深夜不说「早安」，早上别说「晚安，不要在正文里复述时间）`;
}

/** 批量拆条：模型按行输出多条时逐条校验 */
function splitItems(raw: string, expect: number, max: number): string[] {
  const lines = raw
    .split(/\n+/)
    .map((l) => cleanText(l, max))
    .filter((l) => l.length >= 4);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const k = l.slice(0, 24);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
    if (out.length >= expect) break;
  }
  return out;
}

/** 批量生成通用重试：不足一轮后再补一次 */
async function batchWithRetry(config: UpstreamConfig | null, messages: LLMMessage[], first: string, expect: number, max: number): Promise<string[]> {
  let list = splitItems(first, expect, max);
  if (list.length < expect) {
    const raw2 = (await completeWithFallback(config, [
      ...messages,
      { role: 'assistant', content: first.slice(0, 1200) },
      { role: 'user', content: `还差 ${expect - list.length} 条，继续按同样格式补齐（只输出缺的，不要重复已输出的）` },
    ])).text;
    list = splitItems(`${list.join('\n')}\n${raw2}`, expect, max);
  }
  return list;
}

/** 帖子/评论正文行（含配图描述时拼接） */
function postLine(post: { authorName?: string; content?: string; mediaDesc?: string } | undefined): string {
  const who = post?.authorName ?? '有人';
  const text = typeof post?.content === 'string' ? post.content.slice(0, 200) : '';
  const desc = typeof post?.mediaDesc === 'string' && post.mediaDesc.trim() ? `（帖子配图内容：${post.mediaDesc.slice(0, 160)}）` : '';
  return `${who}发的帖子：「${text}」${desc}`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const config = extractUpstreamConfig(body.config);
    const kind = typeof body.kind === 'string' ? body.kind : '';
    const userName = typeof body.userName === 'string' ? body.userName.slice(0, 20) : '你';
    const avoid = Array.isArray(body.avoid)
      ? body.avoid.filter((x): x is string => typeof x === 'string').slice(0, 12)
      : [];
    const avoidLine = avoid.length
      ? `\n\n这些内容最近已经出现过，不要重复、也不要撞车：\n${avoid.map((a) => `- ${a.slice(0, 60)}`).join('\n')}`
      : '';

    if (kind === 'posts') {
      const items = Array.isArray(body.items)
        ? (body.items as Record<string, unknown>[])
            .slice(0, 24)
            .map((it) => ({
              name: typeof it.name === 'string' ? it.name.slice(0, 24) : '网友',
              persona: typeof it.persona === 'string' ? it.persona.slice(0, 300) : '',
              community: typeof it.community === 'string' ? it.community.slice(0, 16) : '今日热议',
            }))
            .filter((it) => it.persona || it.name)
        : [];
      if (!items.length) return NextResponse.json({ error: 'items 为空' }, { status: 400 });
      const expect = items.length;
      const spec = items
        .map((it, i) => `${i + 1}. ${it.name}（人设：${it.persona || '普通论坛网友'}；发在「${it.community}」版块）`)
        .join('\n');
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            '你在为一个中文论坛（风格类似 X/Twitter 的公开广场）批量生成不同网友的帖子。' +
            '每条帖子必须严格符合该网友的人设口吻；内容是日常生活向（吐槽/感慨/分享/提问），真实自然像真人随手发的。' +
            '可以偶尔带一个 #话题 标签（最多一个，形如 #话题名#）。禁止出现任何人设说明、编号说明以外的格式；' +
            '每条一行，行数与作者数一致。每条 30~90 字。禁止 emoji。同一人设出现多次时，每条聊不同的事。',
        },
        {
          role: 'user',
          content: `请为下面 ${expect} 位论坛网友各写一条帖子（每人一条，输出 ${expect} 行，第 N 行对应第 N 位）：\n${spec}${avoidLine}\n${bjTimeLine()}`,
        },
      ];
      const raw = (await completeWithFallback(config, messages)).text;
      const list = await batchWithRetry(config, messages, raw, expect, 200);
      return NextResponse.json({ items: list });
    }

    if (kind === 'comments' || kind === 'subreplies') {
      const post = body.post as { authorName?: string; content?: string; mediaDesc?: string } | undefined;
      const personas = Array.isArray(body.personas)
        ? (body.personas as Record<string, unknown>[])
            .slice(0, 30)
            .map((p) => ({
              name: typeof p.name === 'string' ? p.name.slice(0, 24) : '网友',
              persona: typeof p.persona === 'string' ? p.persona.slice(0, 200) : '普通论坛网友',
            }))
        : [];
      if (!post || !personas.length) return NextResponse.json({ error: '参数为空' }, { status: 400 });
      const base = postLine(post);

      if (kind === 'comments') {
        const expect = personas.length;
        const spec = personas
          .map((p, i) => `${i + 1}. ${p.name}（人设：${p.persona}）`)
          .join('\n');
        const messages: LLMMessage[] = [
          {
            role: 'system',
            content:
              '你在为一个中文论坛（X/Twitter 风格广场）的帖子批量生成网友评论。' +
              '每条评论严格符合该网友的人设口吻；风格多样：有人共鸣、有人吐槽、有人接梗、有人认真讨论、有人跑题闲聊，像真实评论区。' +
              '每条 10~60 字，口语化，禁止 emoji 和任何格式标记。每条一行，行数与网友数一致，第 N 行对应第 N 位。',
          },
          {
            role: 'user',
            content: `论坛里有这么一条帖子——\n${base}\n\n请以这 ${expect} 位网友的口吻各写一条评论（输出 ${expect} 行）：\n${spec}${avoidLine}\n${bjTimeLine()}`,
          },
        ];
        const raw = (await completeWithFallback(config, messages)).text;
        const list = await batchWithRetry(config, messages, raw, expect, 120);
        return NextResponse.json({ items: list });
      }

      // subreplies：给threads 里的每条评论各写一条回复（来自 personas 对应网友）
      const threads = Array.isArray(body.threads)
        ? (body.threads as Record<string, unknown>[])
            .slice(0, 12)
            .map((h) => ({
              authorName: typeof h.authorName === 'string' ? h.authorName.slice(0, 24) : '网友',
              content: typeof h.content === 'string' ? h.content.slice(0, 120) : '',
            }))
            .filter((h) => h.content)
        : [];
      if (!threads.length) return NextResponse.json({ error: 'threads 为空' }, { status: 400 });
      const expect = threads.length;
      const spec = threads
        .map((h, i) => `${i + 1}. 评论（${h.authorName} 说：「${h.content}」）→ 由 ${personas[i % personas.length].name} 回复（人设：${personas[i % personas.length].persona}）`)
        .join('\n');
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            '你在为一个中文论坛（X/Twitter 风格广场）的帖子评论区生成楼中楼回复。' +
            '每条回复严格符合指定网友的人设口吻，要回应评论内容本身（接话/反驳/补充/玩梗），像真人在评论区聊天。' +
            '每条 10~50 字，口语化，禁止 emoji 和任何格式标记。每条一行，行数与评论数一致，第 N 行对应第 N 条评论的回复。',
        },
        {
          role: 'user',
          content: `论坛帖子：${base}\n\n评论区里有下面 ${expect} 条评论，请逐条写出对应的楼中楼回复（输出 ${expect} 行）：\n${spec}\n${bjTimeLine()}`,
        },
      ];
      const raw = (await completeWithFallback(config, messages)).text;
      const list = await batchWithRetry(config, messages, raw, expect, 100);
      return NextResponse.json({ items: list });
    }

    if (kind === 'reply' || kind === 'dm') {
      const authorRaw = body.author as { name?: unknown; persona?: unknown } | undefined;
      const name = typeof authorRaw?.name === 'string' ? authorRaw.name.slice(0, 24) : '网友';
      const persona = typeof authorRaw?.persona === 'string' ? authorRaw.persona.slice(0, 300) : '普通论坛网友';
      if (kind === 'reply') {
        const p = body.parent as { authorName?: string; content?: string } | undefined;
        const parentLine = p?.content ? `${p.authorName ?? '有人'}对你说：「${String(p.content).slice(0, 160)}」` : '一条帖子';
        // 多轮上下文：所在主帖 + 评论串最近几轮对话（用户在评论区与 AI 无限来回）
        const postContent = typeof body.postContent === 'string' ? body.postContent.slice(0, 200) : '';
        const history = Array.isArray(body.history)
          ? (body.history as Record<string, unknown>[])
              .slice(-8)
              .map((h) => `${h.from === 'user' ? userName : name}：${typeof h.text === 'string' ? h.text.slice(0, 100) : ''}`)
              .join('\n')
          : '';
        const mediaDesc = typeof body.mediaDesc === 'string' && body.mediaDesc.trim() ? `（主帖配图内容：${body.mediaDesc.slice(0, 160)}）` : '';
        const ctx = [
          postContent ? `你们正在评论这条帖子：${postContent}${mediaDesc}` : '',
          history ? `最近的对话：\n${history}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        const raw = (await completeWithFallback(config, [
          {
            role: 'system',
            content:
              `你是中文论坛（X/Twitter 风格广场）的网友「${name}」。人设：${persona}。` +
              '现在要以这个口吻回复评论。回复要短（10~50 字）、口语化、贴合对方说的内容和帖子语境，可以带一点自己的态度。禁止 emoji，禁止任何格式标记，只输出回复正文。',
          },
          { role: 'user', content: `${ctx ? ctx + '\n\n' : ''}${parentLine}\n请以「${name}」的口吻回复。${bjTimeLine()}` },
        ])).text;
        return NextResponse.json({ text: cleanText(raw, 120) });
      }
      const history = Array.isArray(body.history)
        ? (body.history as Record<string, unknown>[])
            .slice(-10)
            .map((h) => `${h.from === 'user' ? userName : name}：${typeof h.text === 'string' ? h.text.slice(0, 120) : ''}`)
            .join('\n')
        : '';
      const raw = (await completeWithFallback(config, [
        {
          role: 'system',
          content:
            `你是中文论坛（X/Twitter 风格广场）的用户「${name}」，正在论坛私信里和${userName}聊天。人设：${persona}。` +
            '回复要短（10~60 字）、自然口语，像真人打字。禁止 emoji，禁止任何格式标记，只输出回复正文。',
        },
        { role: 'user', content: `最近的对话：\n${history || '（刚开始聊）'}\n\n请以「${name}」的口吻接下一条私信。${bjTimeLine()}` },
      ])).text;
      return NextResponse.json({ text: cleanText(raw, 160) });
    }

    return NextResponse.json({ error: '未知 kind' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '生成失败' },
      { status: 500 },
    );
  }
}
