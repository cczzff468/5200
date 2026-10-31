import { NextResponse } from 'next/server';

/**
 * X论坛 · AI 内容生成（服务端）。
 *
 * POST {
 *   config?: UpstreamConfig,             // 设置 App 的用户 API；缺省 SDK 兜底
 *   kind: 'posts' | 'reply' | 'dm' | 'comments' | 'subreplies',
 *   items?: { name, persona?, community?, topic?, lang? }[],  // posts：批量生成多位作者的帖子（一次最多 24 条；lang = 惯用语言）
 *   author?: { name, persona?, lang? },  // reply/dm：说话人（lang = 惯用语言）
 *   parent?: { authorName, content },   // reply：被回复的帖子/评论
 *   postContent?: string,               // reply：所在主帖内容（多轮对话上下文）
 *   mediaDesc?: string,                 // reply/comments/subreplies：帖子配图的文字描述（识图模型产出）
 *   history?: { from: 'user' | 'peer', text }[],       // dm：对话上下文；reply：评论串最近几轮
 *   post?: { authorName, content, mediaDesc? },        // comments/subreplies：被评论的主帖
 *   count?: number,                     // comments：生成几条评论（10~30）
 *   threads?: { authorName, content }[],               // subreplies：被回复的评论列表（逐条对应输出）
 *   personas?: { name, persona?, lang? }[],  // comments/subreplies：每条对应的评论者（与输出行一一对应；lang = 该网友惯用语言）
 *   userName?: string,                  // 机主名（称呼/被回复者）
 *   avoid?: string[],                   // 防重复：最近已出现过的内容
 * }
 * → { items: string[] }（posts/comments/subreplies 批量）；{ text: string }（reply/dm）
 *
 * 输出清洗：extractThinkBlocks 剥 [思考] 块；去引号/围栏/舞台指示；长度截断；
 * 时间感知注入与 moments/generate 同口径（北京时间 + 时段语境）。
 * 用户要求：帖子/评论可多语言（英/韩/日/繁体等，由网友的 lang 决定）、
 * 内容偏「编事情」的明星八卦吃瓜叙事（谁和谁怎么样、今天碰见xxx了好帅）、字数不限。
 */

import { completeWithFallback, extractUpstreamConfig, type LLMMessage, type UpstreamConfig } from '@/lib/server-llm';
import { extractThinkBlocks } from '@/lib/think-filter';

/** 语言代码 → 中文名（与客户端 FORUM_LANG_LABELS 同口径） */
const LANG_LABELS: Record<string, string> = {
  'zh-Hans': '简体中文',
  'zh-Hant': '繁体中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
};

function langLabel(lang: unknown, def = '简体中文'): string {
  return typeof lang === 'string' && LANG_LABELS[lang] ? LANG_LABELS[lang] : def;
}

function cleanText(raw: string, max: number): string {
  let t = extractThinkBlocks(raw ?? '').text;
  t = t.replace(/```(?:[\w-]+)?/gi, '').trim();
  t = t.replace(/^[「"'“”]+/, '').replace(/[」"'”"]+$/, '').trim();
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
  return `（现在是北京时间 ${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${hm}，${period}——发言要符合这个时间的语境：凌晨/深夜不说「早安」，早上别说「晚安」，不要在正文里复述时间）`;
}

/** 批量拆条：模型按行输出多条时逐条校验（最短 2 字，兼容「草」「确实」类短评） */
function splitItems(raw: string, expect: number, max: number): string[] {
  const lines = raw
    .split(/\n+/)
    .map((l) => cleanText(l, max))
    .filter((l) => l.length >= 2);
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
  const text = typeof post?.content === 'string' ? post.content.slice(0, 400) : '';
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
              topic: typeof it.topic === 'string' ? it.topic.slice(0, 16) : '',
              lang: typeof it.lang === 'string' ? it.lang : 'zh-Hans',
            }))
            .filter((it) => it.persona || it.name)
        : [];
      if (!items.length) return NextResponse.json({ error: 'items 为空' }, { status: 400 });
      const expect = items.length;
      const spec = items
        .map((it, i) => `${i + 1}. ${it.name}（人设：${it.persona || '普通论坛网友'}；主题方向：${it.topic || '娱乐热点'}；发帖语言：${langLabel(it.lang)}；发在「${it.community}」版块）`)
        .join('\n');
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            '你在为一个国际化中文论坛（风格类似 X/Twitter 的公开广场）批量生成不同网友的帖子。' +
            '内容主题：明星八卦、吃瓜爆料、影视综艺、汽车、娱乐热点、日常吐槽。要会「编事情」——像讲一件真事：谁和谁被拍到深夜同框、某顶流和某女星疑似恋情、今天在商场碰见某男星本人真人比屏幕上还帅、剧组路透、演唱会现场偶遇、红毯造型翻车、邻居提了新车、同事追星追到倾家荡产……有细节、有画面、有起因经过，像当事人或目击者随手发出来的。' +
            '吃瓜要有「蹲后续」「瓜保熟」「让子弹飞一会儿」的口吻；吐槽要毒舌但有道理；追剧要有发疯文学味；车友要有圈内感。' +
            '语言：每条严格用该网友指定的「发帖语言」写，要地道得像母语者随手发的（英语帖就是真英语口吻、日语帖像日本网友、韩语帖像韩国网友、繁体帖像港台网友）；简体中文为主，其他语言自然穿插。' +
            '字数不限：一句话的短吐槽、两三句话的现场播报、几百字的长帖叙事都可以，长短错落才真实；长帖可以讲完一件事的来龙去脉。' +
            '涉及明星一律用模糊称呼（某顶流、某男团成员、某剧组、xxx），禁止使用真实存在的明星姓名；影视剧可用泛称（某悬疑剧、刚上映的那部）或虚构名。' +
            '每条必须严格符合该网友的人设口吻；可以偶尔带一个 #话题 标签（最多一个，形如 #话题名#）。' +
            '禁止出现任何人设说明、编号说明以外的格式；每条一行，行数与作者数一致。禁止 emoji。同一人设出现多次时，每条聊不同的事。',
        },
        {
          role: 'user',
          content: `请为下面 ${expect} 位论坛网友各写一条帖子（每人一条，输出 ${expect} 行，第 N 行对应第 N 位）：\n${spec}${avoidLine}\n${bjTimeLine()}`,
        },
      ];
      const raw = (await completeWithFallback(config, messages)).text;
      const list = await batchWithRetry(config, messages, raw, expect, 2000);
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
              lang: typeof p.lang === 'string' ? p.lang : 'zh-Hans',
            }))
        : [];
      if (!post || !personas.length) return NextResponse.json({ error: '参数为空' }, { status: 400 });
      const base = postLine(post);

      if (kind === 'comments') {
        const expect = personas.length;
        const spec = personas
          .map((p, i) => `${i + 1}. ${p.name}（人设：${p.persona}；评论语言：${langLabel(p.lang)}）`)
          .join('\n');
        const messages: LLMMessage[] = [
          {
            role: 'system',
            content:
              '你在为一个国际化中文论坛（X/Twitter 风格广场）的帖子批量生成网友评论。' +
              '每条评论严格用该网友指定的「评论语言」写，语言要地道像母语者（英语评论是真实英语口吻、日语像 それな/草 这类日本网友说话、韩语像 ㄹㅇㅋㅋ 这类韩国网友、繁体像港台网友）；多数简体中文，其他语言自然穿插。' +
              '每条评论严格符合该网友的人设口吻；风格多样：有人共鸣、有人吐槽、有人接梗、有人认真讨论、有人跑题闲聊、有人分享自己碰到的类似事，像真实评论区。' +
              '帖子主题多为吃瓜八卦、影视追剧、汽车、娱乐热点——评论者自然代入吃瓜群众/剧友/车友/路人的口吻即可；有人可以接着编：我也碰到过、我朋友就在现场、蹲一个后续。' +
              '字数不限：两三个字的短评（草、确实、蹲）、一两句话的接话、几十字的亲身经历都可以，长短错落。禁止 emoji 和任何格式标记。每条一行，行数与网友数一致，第 N 行对应第 N 位。',
          },
          {
            role: 'user',
            content: `论坛里有这么一条帖子——\n${base}\n\n请以这 ${expect} 位网友的口吻各写一条评论（输出 ${expect} 行）：\n${spec}${avoidLine}\n${bjTimeLine()}`,
          },
        ];
        const raw = (await completeWithFallback(config, messages)).text;
        const list = await batchWithRetry(config, messages, raw, expect, 1000);
        return NextResponse.json({ items: list });
      }

      // subreplies：给 threads 里的每条评论各写一条回复（来自 personas 对应网友）
      const threads = Array.isArray(body.threads)
        ? (body.threads as Record<string, unknown>[])
            .slice(0, 12)
            .map((h) => ({
              authorName: typeof h.authorName === 'string' ? h.authorName.slice(0, 24) : '网友',
              content: typeof h.content === 'string' ? h.content.slice(0, 160) : '',
            }))
            .filter((h) => h.content)
        : [];
      if (!threads.length) return NextResponse.json({ error: 'threads 为空' }, { status: 400 });
      const expect = threads.length;
      const spec = threads
        .map((h, i) => `${i + 1}. 评论（${h.authorName} 说：「${h.content}」）→ 由 ${personas[i % personas.length].name} 回复（人设：${personas[i % personas.length].persona}；语言：${langLabel(personas[i % personas.length].lang)}）`)
        .join('\n');
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            '你在为一个国际化中文论坛（X/Twitter 风格广场）的帖子评论区生成楼中楼回复。' +
            '每条回复严格用指定网友的「语言」写，地道像母语者；严格符合该网友的人设口吻，要回应评论内容本身（接话/反驳/补充/玩梗/分享自己的经历），像真人在评论区聊天。' +
            '字数不限：几个字的短接到几十字的展开都行，长短错落。禁止 emoji 和任何格式标记。每条一行，行数与评论数一致，第 N 行对应第 N 条评论的回复。',
        },
        {
          role: 'user',
          content: `论坛帖子：${base}\n\n评论区里有下面 ${expect} 条评论，请逐条写出对应的楼中楼回复（输出 ${expect} 行）：\n${spec}\n${bjTimeLine()}`,
        },
      ];
      const raw = (await completeWithFallback(config, messages)).text;
      const list = await batchWithRetry(config, messages, raw, expect, 600);
      return NextResponse.json({ items: list });
    }

    if (kind === 'reply' || kind === 'dm') {
      const authorRaw = body.author as { name?: unknown; persona?: unknown; lang?: unknown } | undefined;
      const name = typeof authorRaw?.name === 'string' ? authorRaw.name.slice(0, 24) : '网友';
      const persona = typeof authorRaw?.persona === 'string' ? authorRaw.persona.slice(0, 300) : '普通论坛网友';
      const myLang = typeof authorRaw?.lang === 'string' && LANG_LABELS[authorRaw.lang] ? authorRaw.lang : 'zh-Hans';
      if (kind === 'reply') {
        const p = body.parent as { authorName?: string; content?: string } | undefined;
        const parentLine = p?.content ? `${p.authorName ?? '有人'}对你说：「${String(p.content).slice(0, 300)}」` : '一条帖子';
        // 多轮上下文：所在主帖 + 评论串最近几轮对话（用户在评论区与 AI 无限来回）
        const postContent = typeof body.postContent === 'string' ? body.postContent.slice(0, 400) : '';
        const history = Array.isArray(body.history)
          ? (body.history as Record<string, unknown>[])
              .slice(-8)
              .map((h) => `${h.from === 'user' ? userName : name}：${typeof h.text === 'string' ? h.text.slice(0, 150) : ''}`)
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
              `你是国际化中文论坛（X/Twitter 风格广场）的网友「${name}」。人设：${persona}。` +
              `你平时发帖惯用${langLabel(myLang)}，这次回复也用${langLabel(myLang)}写，要地道得像母语者。` +
              '回复要贴合对方说的内容、帖子语境和你们之前的对话，可以带一点自己的态度，可以接梗、反问、分享经历。' +
              '字数不限：一两句短回到上百字的长回复都可以，像真人聊天。禁止 emoji，禁止任何格式标记，只输出回复正文。',
          },
          { role: 'user', content: `${ctx ? ctx + '\n\n' : ''}${parentLine}\n请以「${name}」的口吻回复。${bjTimeLine()}` },
        ])).text;
        return NextResponse.json({ text: cleanText(raw, 1000) });
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
            '私信用简体中文，自然口语，像真人打字。' +
            '字数不限：一两句到几十字都行。禁止 emoji，禁止任何格式标记，只输出回复正文。',
        },
        { role: 'user', content: `最近的对话：\n${history || '（刚开始聊）'}\n\n请以「${name}」的口吻接下一条私信。${bjTimeLine()}` },
      ])).text;
      return NextResponse.json({ text: cleanText(raw, 300) });
    }

    return NextResponse.json({ error: '未知 kind' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '生成失败' },
      { status: 500 },
    );
  }
}
