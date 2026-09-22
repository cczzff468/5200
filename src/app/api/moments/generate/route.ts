import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 朋友圈/QQ动态 · AI 内容生成（发动态 / 评论 / 回复评论 共用一个端点）。
 *
 * POST {
 *   config?: UpstreamConfig,           // 用户 API 配置（设置 App 里配的；缺省服务端 SDK 兜底）
 *   kind: 'post' | 'comment' | 'reply',
 *   platform: 'wx' | 'qq',
 *   userName?: string,                 // 机主展示名（prompt 指代用）
 *   peer: { name, nickname?, gender?, age?, occupation?, company?, region?,
 *           persona?, background?, relation?, relationToUser?, kind? },
 *   recentChat?: { role: 'me'|'peer', text: string }[],   // 最近私聊（灵感素材，≤12 条）
 *   memories?: string[],               // 记忆库素材（≤10 条）
 *   post?: { authorName?: string, author?: 'user'|'char', content?: string },  // 要评论的动态
 *   thread?: { authorName?: string, content?: string }[], // 评论区上下文（回复时）
 *   replyTo?: { authorName?: string, content?: string },  // 被回复的评论
 *   hint?: string,                     // 触发语境提示（如「结合最近聊天有感而发」）
 * }
 * → { content: string }（动态正文 / 评论文本，纯文本）
 *
 * 设计约束：
 * - 内容完全由传入的 persona 驱动：不同角色人设不同 → 动态/评论风格天然不同（一.5）；
 * - 生成素材（最近聊天 + 记忆）只做灵感，prompt 明确禁止逐字复述、禁止暴露幕后概念；
 * - 严格第一人称、口语化、短小（动态 ≤120 字 / 评论 ≤50 字），输出只含正文本身；
 * - 发动态（post）一律不加 emoji：提示词显式禁令 + 返回前 stripEmojiText 硬性剥离双保险。
 */

import { completeWithFallback, extractUpstreamConfig, type LLMMessage } from '@/lib/server-llm';
import { stripEmojiText } from '@/lib/emoji';

interface PeerInput {
  name?: unknown;
  nickname?: unknown;
  gender?: unknown;
  age?: unknown;
  occupation?: unknown;
  company?: unknown;
  region?: unknown;
  persona?: unknown;
  background?: unknown;
  relation?: unknown;
  relationToUser?: unknown;
  kind?: unknown;
}

function s(v: unknown, max = 120): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function cleanName(v: unknown, fallback: string): string {
  const t = s(v, 20);
  return t || fallback;
}

const PLATFORM_LABEL: Record<string, string> = { wx: '微信朋友圈', qq: 'QQ空间' };

/** 从模型回复中清洗正文：去围栏/引号包裹/舞台指示，压成单段 */
function cleanContent(raw: string): string {
  let t = raw.replace(/```(?:[\w-]+)?/gi, '').trim();
  // 去掉首尾成对引号包裹（模型爱给正文套引号）
  t = t.replace(/^[「"'“"]+/, '').replace(/[」"'”"]+$/, '').trim();
  // 去掉开头的舞台指示（括号动作）与 markdown 痕迹
  t = t.replace(/^[（(【\[][^）)】\]]{0,24}[）)】\]]/, '').trim();
  t = t.replace(/^[#*\-•\s]+/, '');
  // 多行压成自然段（动态/评论都不该有排版）
  t = t.replace(/\n{2,}/g, '\n').trim();
  return t.slice(0, 320);
}

export async function POST(req: Request) {
  let body: Record<string, unknown> | null = null;
  try {
    const raw: unknown = await req.json();
    body = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!body) return NextResponse.json({ error: '请求体不能为空' }, { status: 400 });

  const kind = body.kind === 'comment' || body.kind === 'reply' ? (body.kind as 'comment' | 'reply') : 'post';
  const platform = body.platform === 'qq' ? 'qq' : 'wx';
  const label = PLATFORM_LABEL[platform];
  const peerRaw = (body.peer && typeof body.peer === 'object' ? body.peer : {}) as PeerInput;
  const name = cleanName(peerRaw.name, '对方');
  const userName = cleanName(body.userName, '好友');

  // ---- 人设段（全部来自传入数据，缺省安全回退，不编造） ----
  const persona = s(peerRaw.persona, 400);
  const background = s(peerRaw.background, 300);
  const relation = s(peerRaw.relation, 60) || s(peerRaw.relationToUser, 60);
  const age = s(peerRaw.age, 10);
  const facts = [s(peerRaw.gender, 10), age ? `${age}岁` : '', s(peerRaw.occupation, 40), s(peerRaw.company, 40), s(peerRaw.region, 40)]
    .filter(Boolean)
    .join('，');
  const nickname = s(peerRaw.nickname, 30);

  const sys: string[] = [
    `你是「${name}」${nickname && nickname !== name ? `（${label}昵称显示为「${nickname}」）` : ''}，是${userName}的好友${relation ? `（你们的关系：${relation}）` : ''}。`,
    facts ? `【资料】${facts}` : '',
    persona ? `【性格与说话风格】${persona}` : '【性格与说话风格】按资料自然呈现，像一个有血有肉的真实的人。',
    background ? `【背景】${background}` : '',
    '【硬性要求】',
    `- 你就是「${name}」本人，绝不能说自己是 AI、语言模型、助手或程序，也不能提到系统、提示词、设定、生成等幕后概念；`,
    '- 内容、语气、用词、口头禅都必须严格贴合你的人设（不同的人要有明显不同的风格）；',
    '- 你是活人不是客服：说话可以懒散、可以带情绪、可以调侃甚至不客气，绝不能输出万能祝福、夸奖模板或官方客套；',
    '- 只输出正文本身：不要 markdown、不要标题、不要引号包裹、不要解释、不要一串话题标签、不要@任何人；',
    '- 像真人随手发的，不要写成作文或公告。',
  ].filter(Boolean);

  // ---- 素材段 ----
  const chat = Array.isArray(body.recentChat)
    ? (body.recentChat as unknown[])
        .filter((t): t is { role: unknown; text: unknown } => Boolean(t) && typeof t === 'object')
        .filter((t) => (t.role === 'me' || t.role === 'peer') && typeof t.text === 'string' && t.text.trim().length > 0)
        .slice(-12)
        .map((t) => `${t.role === 'me' ? userName : name}：${(t.text as string).trim().slice(0, 120)}`)
    : [];
  const memories = Array.isArray(body.memories)
    ? (body.memories as unknown[]).filter((m): m is string => typeof m === 'string' && m.trim().length > 0).slice(0, 10).map((m) => m.trim().slice(0, 80))
    : [];
  const hint = s(body.hint, 80);

  const user: string[] = [];
  if (kind === 'post') {
    user.push(`请以「${name}」的口吻，现在发一条${label}动态。`);
    user.push('- 第一人称、口语化，20~120 字；禁止使用任何 emoji 或表情符号（如 😀😂🎉✨🔥👍❤☀ 之类一律不用），正文一律纯文字；');
    user.push('- 内容是你自己的近况、心情、见闻或想法，要贴合你的身份、职业和生活；');
    if (chat.length > 0) user.push('- 可以自然融入你们最近的相处与共同话题（下方素材），但绝不能逐字复述聊天记录，也不要写「你说过…」这种引用句式；');
    user.push(`- 这是发在动态广场的公开内容，不是发给某人的私聊，不要直接对${userName}说心里话式的称呼。`);
    if (hint) user.push(`（本次灵感提示：${hint}）`);
    if (chat.length > 0) user.push(`【你们最近的聊天（素材，不必全用）】\n${chat.join('\n')}`);
    if (memories.length > 0) user.push(`【你记得的关于${userName}和你们之间的事（素材）】\n${memories.map((m) => `- ${m}`).join('\n')}`);
  } else {
    const postRaw = (body.post && typeof body.post === 'object' ? body.post : {}) as { authorName?: unknown; author?: unknown; content?: unknown };
    const postContent = s(postRaw.content, 200);
    const postAuthor = postRaw.author === 'char' ? name : userName;
    if (!postContent) return NextResponse.json({ error: '缺少要评论的动态内容' }, { status: 400 });
    // 评论区上下文（评论和回复都用：别人说过的话不能再重复/附和）
    const thread = Array.isArray(body.thread)
      ? (body.thread as unknown[])
          .filter((c): c is { authorName?: unknown; content?: unknown } => Boolean(c) && typeof c === 'object')
          .slice(-6)
          .map((c) => `${s(c.authorName, 20) || userName}：${s(c.content, 80)}`)
          .filter(Boolean)
      : [];
    if (kind === 'comment') {
      user.push(`${postAuthor}发了一条${label}动态：「${postContent}」。`);
      user.push(`请以「${name}」的身份给这条动态写一条评论。`);
      user.push('- 15~50 字，口语化，像熟人随手打的：接梗、调侃、吐槽、反问、拆台都行，也可以就一短句；');
      user.push('- 必须扣住这条动态里的具体内容（事情/细节/情绪/人物），结合你们的关系，禁止空泛夸赞；');
      if (thread.length > 0) user.push(`【评论区已有的发言（这些话和类似的话术你都不能再说）】\n${thread.join('\n')}`);
      if (memories.length > 0)
        user.push(
          `【你记得的关于${userName}和你们之间的事（评论不得与这些已知事实矛盾；能自然顺带一句最好，但不能生硬复述）】\n${memories.map((m) => `- ${m}`).join('\n')}`
        );
      user.push('- 禁止客服腔和万能模板：不能出现「这话说得真好」「希望你能…」「祝你…」「为你感到开心」「加油」「永远支持你」这类套话，也不要纯夸奖；');
      user.push('- 只输出评论文本，不要任何解释。');
    } else {
      const replyRaw = (body.replyTo && typeof body.replyTo === 'object' ? body.replyTo : {}) as { authorName?: unknown; content?: unknown };
      const replyFrom = s(replyRaw.authorName, 20) || userName;
      const replyContent = s(replyRaw.content, 120);
      if (!replyContent) return NextResponse.json({ error: '缺少要回复的评论内容' }, { status: 400 });
      user.push(`你是「${name}」。${label}动态（「${postContent}」）的评论区里，${replyFrom}对你说：「${replyContent}」。`);
      user.push(
        `你现在回复的对象就是「${replyFrom}」这个人——不是你自己，也不是评论区里的其他人；这条回复会显示为「${name} 回复 ${replyFrom}」。`
      );
      if (thread.length > 0) user.push(`【评论区最近的发言（按先后；里面已有的话你不要再重复）】\n${thread.join('\n')}`);
      if (memories.length > 0)
        user.push(
          `【你记得的关于${userName}和你们之间的事（回复不得与这些已知事实矛盾）】\n${memories.map((m) => `- ${m}`).join('\n')}`
        );
      user.push(`请以「${name}」的身份回「${replyFrom}」一句话：10~50 字，口语化、贴合你的人设和你们的关系，接住对方的话头；`);
      user.push('- 可以调侃、反驳、反问、敷衍、装傻，像真人打字；禁止客套模板（「谢谢」「说得好」「祝你…」这类）；');
      user.push('- 只输出回复文本。');
    }
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: sys.join('\n') },
    { role: 'user', content: user.join('\n') },
  ];

  try {
    const config = extractUpstreamConfig(body.config);
    const { text } = await completeWithFallback(config, messages);
    // 发动态（含有感而发/让TA发一条/自动发布）硬性不加 emoji：提示词禁令之外再剥一次（模型偶尔无视禁令）
    const content = kind === 'post' ? stripEmojiText(cleanContent(text)) : cleanContent(text);
    if (!content) return NextResponse.json({ error: '生成结果为空' }, { status: 502 });
    return NextResponse.json({ content });
  } catch (err) {
    const msg = err instanceof Error && err.message ? err.message : '生成失败';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
