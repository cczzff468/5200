import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 朋友圈/QQ动态 · AI 内容生成（发动态 / 评论 / 回复评论 共用一个端点）。
 *
 * POST {
 *   config?: UpstreamConfig,           // 用户 API 配置（设置 App 里配的；缺省服务端 SDK 兜底）
 *   kind: 'post' | 'comment' | 'reply' | 'repost',
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
 *   ownRecentPosts?: string[],         // 该角色最近已发过的动态（发动态时防重复/防自相矛盾）
 *   avoid?: string[],                  // 禁复读名单：该角色最近说过的话（评论/回复/转发不与已说过的重复；
 *                                      //   微信/QQ 两平台各自独立生成，后生成方会读到先落盘方的同一角色发言）
 *   variation?: string,                // 随机切入角度（每次生成都不同——两平台/两次触发不再产出一字不差的内容）
 *   bilingual?: boolean,               // 48-3/53：是否启用双语规则（true 时返回 { content, contentZh }）
 *   bilingualPrompt?: string,          // 48-3/53：双语提示词（空则用 DEFAULT_BILINGUAL_PROMPT 新规则）
 * }
 * → { content: string, contentZh: string }（contentZh 为空串表示中文正文无译文；非中文时 LLM 按「原文|中文译文」格式输出，splitBilingual 按 | 拆分）
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

/**
 * 48-3 / 53 双语拆分：LLM 按「原文|简体中文译文」格式输出时，
 * 找最后一个 `|` 切分为原文与译文（译文是中文不会含 |，故取最后一个最安全）；
 * 无 `|` 视为中文正文无译文，contentZh='' 容错。
 * 注意：照片标签 [照片:...] 内的描述也可能含 |，但描述在 `]` 之内，
 *   且正文末尾的 | 才是原文/译文分隔符——取最后一个 | 能避开标签内的 |。
 */
function splitBilingual(raw: string): { content: string; contentZh: string } {
  const idx = raw.lastIndexOf('|');
  if (idx > 0) {
    const content = raw.slice(0, idx);
    const contentZh = raw.slice(idx + 1);
    // 译文必须非空且是中文才视为有效（避免正文里的 | 被误判）
    if (contentZh.trim() && /[\u4e00-\u9fa5]/.test(contentZh)) {
      return { content: content.trim(), contentZh: contentZh.trim() };
    }
  }
  return { content: raw, contentZh: '' };
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

  const kind =
    body.kind === 'comment' || body.kind === 'reply' || body.kind === 'repost'
      ? (body.kind as 'comment' | 'reply' | 'repost')
      : 'post';
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
  // 禁复读名单：该角色最近已说过的话（评论/回复/转发绝不重复自己——微信/QQ 独立生成的硬保证之一）
  const avoid = Array.isArray(body.avoid)
    ? (body.avoid as unknown[])
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(0, 8)
        .map((x) => x.trim().slice(0, 80))
    : [];
  // 该角色最近已发过的动态（发动态防重复/防自相矛盾：同一个人是连续的生活）
  const ownRecentPosts = Array.isArray(body.ownRecentPosts)
    ? (body.ownRecentPosts as unknown[])
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(0, 6)
        .map((x) => x.trim().slice(0, 100))
    : [];
  // 随机切入角度（引擎每次随机指定，同样的 prompt 基础产出不同方向）
  const variation = s(body.variation, 40);
  // 48-3 / 53：双语翻译支持（新规则：原文|中文译文，用 | 分隔；中文正文无译文）
  const bilingual = body.bilingual === true;
  const DEFAULT_BILINGUAL_PROMPT = `【朋友圈双语规则（仅非中文角色使用，中文角色忽略此规则）】
- **不改变协议头和结构标签**：只对你实际输出的正文内容使用双语格式，不要翻译或改动协议头和结构标签，不要改动 [回复 昵称]、[不回复]、[NPC点赞]、[NPC评论]、昵称、以及"昵称 回复 被回复者昵称:"这类结构。
- **中文正常输出无需译文**：如果正文是中文，直接正常输出，不要添加译文
- **非中文语言译文输出格式**：非中文语言，正文必须使用"原文|对应的简体中文译文"的格式输出，必须有|分割符号。
- **朋友圈正文双语补充**：如果朋友圈正文、评论正文或回复正文使用非中文，必须在同一段正文里写成"完整外文原文|完整简体中文译文"。
- **照片双语规则**：如果输出 [照片:使用参考图:描述] 或 [照片:不使用参考图:描述]，只允许描述部分使用双语格式，不要改动照片标签外层结构。`;
  const bilingualPrompt = s(body.bilingualPrompt, 1200) || DEFAULT_BILINGUAL_PROMPT;

  const user: string[] = [];
  if (kind === 'post') {
    user.push(`请以「${name}」的口吻，现在发一条${label}动态。`);
    user.push('- 第一人称、口语化，20~120 字；禁止使用任何 emoji 或表情符号（如 😀😂🎉✨🔥👍❤☀ 之类一律不用），正文一律纯文字；');
    user.push('- 内容是你自己的近况、心情、见闻或想法，要贴合你的身份、职业和生活；');
    user.push('- 这是你自己在发动态，不是去评论别人的动态、也不是回复谁的消息；');
    if (chat.length > 0) user.push('- 可以自然融入你们最近的相处与共同话题（下方素材），但绝不能逐字复述聊天记录，也不要写「你说过…」这种引用句式；');
    user.push(`- 这是发在动态广场的公开内容，不是发给某人的私聊，不要直接对${userName}说心里话式的称呼。`);
    if (ownRecentPosts.length > 0)
      user.push(
        `【你最近已经发过的动态（新动态绝不能与它们重复，也不能在事实/心情/境遇上前后矛盾——你始终是同一个连续生活的人）】\n${ownRecentPosts.map((p) => `- ${p}`).join('\n')}`
      );
    if (hint) user.push(`（本次灵感提示：${hint}）`);
    if (chat.length > 0) user.push(`【你们最近的聊天（素材，不必全用）】\n${chat.join('\n')}`);
    if (memories.length > 0) user.push(`【你记得的关于${userName}和你们之间的事（素材）】\n${memories.map((m) => `- ${m}`).join('\n')}`);
  } else {
    const postRaw = (body.post && typeof body.post === 'object' ? body.post : {}) as { authorName?: unknown; author?: unknown; content?: unknown };
    const postContent = s(postRaw.content, 200);
    if (!postContent) return NextResponse.json({ error: '缺少要评论的动态内容' }, { status: 400 });
    // 身份修复：动态作者是谁必须用传入的 authorName（角色动态的真实发帖人），
    // 绝不能用 name（那是本次要评论的评论人）——旧版把评论人当发帖人，导致「AI 自己给自己评论」。
    const postAuthorName = s(postRaw.authorName, 20);
    const postAuthor = postRaw.author === 'char' ? postAuthorName || '对方' : userName;
    // 服务端硬性守卫：发帖人不能「主动评论」自己的动态（旧版 bug 的直接根因，双保险）；
    // reply 放行——作者回复用户在自己动态下的评论是正常多轮互动（不能拦，否则用户评论 AI 动态后 AI 永远不回）
    if (kind !== 'reply' && postRaw.author === 'char' && postAuthorName && postAuthorName === name) {
      return NextResponse.json({ error: '发帖人不能评论自己的动态' }, { status: 400 });
    }
    // 评论区上下文（评论和回复都用：别人说过的话不能再重复/附和）
    const thread = Array.isArray(body.thread)
      ? (body.thread as unknown[])
          .filter((c): c is { authorName?: unknown; content?: unknown } => Boolean(c) && typeof c === 'object')
          .slice(-6)
          .map((c) => `${s(c.authorName, 20) || userName}：${s(c.content, 80)}`)
          .filter(Boolean)
      : [];
    if (kind === 'repost') {
      // 转发：把别人的动态转到自己空间，生成一句转发理由（正文短、不复述原文）
      const postRaw = (body.post && typeof body.post === 'object' ? body.post : {}) as { authorName?: unknown; author?: unknown; content?: unknown };
      const postContent = s(postRaw.content, 200);
      if (!postContent) return NextResponse.json({ error: '缺少要转发的动态内容' }, { status: 400 });
      const postAuthorName = s(postRaw.authorName, 20);
      const postAuthor = postRaw.author === 'char' ? postAuthorName || '对方' : userName;
      if (postRaw.author === 'char' && postAuthorName && postAuthorName === name) {
        return NextResponse.json({ error: '不能转发自己的动态' }, { status: 400 });
      }
      user.push(`${postAuthor}发了一条${label}动态：「${postContent}」。`);
      user.push(`请以「${name}」的身份把这条动态转发到你的${label}，写一句你转发时想说的话（转发理由）。`);
      user.push('- 8~30 字，口语化：可以感叹、安利、调侃、吐槽或补一句你的看法；不要复述原文内容；');
      user.push('- 只输出转发理由这句话本身，不要「转发：」之类前缀，不要话题标签，不要@任何人，不要 emoji；');
      if (memories.length > 0)
        user.push(
          `【你记得的关于${userName}和你们之间的事（理由不得与这些已知事实矛盾）】\n${memories.map((m) => `- ${m}`).join('\n')}`
        );
    } else if (kind === 'comment') {
      user.push(`${postAuthor}发了一条${label}动态：「${postContent}」。`);
      user.push(`请以「${name}」的身份（你是评论人，不是发帖人）给这条动态写一条评论。`);
      user.push(`- 身份提醒：这条动态是「${postAuthor}」发的，你不是TA——以你「${name}」自己的口吻回应TA的内容，不要模仿作者的口吻、不要替TA说话、不要自问自答；`);
      user.push('- 15~50 字，口语化，像熟人随手打的：接梗、调侃、吐槽、反问、拆台都行，也可以就一短句；');
      user.push('- 不要用「名字+语气词」开头喊人（如「XX啊，」「XX，」这种开头），直接说话；');
      user.push('- 必须扣住这条动态里的具体内容（事情/细节/情绪/人物），结合你和动态作者的关系，禁止空泛夸赞；');
      if (thread.length > 0) user.push(`【评论区已有的发言（这些话和类似的话术你都不能再说）】\n${thread.join('\n')}`);
      if (memories.length > 0)
        user.push(
          `【你记得的关于${userName}和其他好友的事（评论不得与这些已知事实矛盾；能自然顺带一句最好，但不能生硬复述）】\n${memories.map((m) => `- ${m}`).join('\n')}`
        );
      user.push('- 禁止客服腔和万能模板：不能出现「这话说得真好」「希望你能…」「祝你…」「为你感到开心」「加油」「永远支持你」这类套话，也不要纯夸奖；');
      user.push(`- 再次强调（最重要）：你要评论的动态是${postAuthor}发的「${postContent.slice(0, 80)}」，评论必须让人一眼看出你看懂了这条动态，与这条动态无关的话一句都不要说——跑题的评论是无效输出；`);
      user.push('- 只输出评论文本，不要任何解释。');
    } else {
      const replyRaw = (body.replyTo && typeof body.replyTo === 'object' ? body.replyTo : {}) as { authorName?: unknown; content?: unknown };
      const replyFrom = s(replyRaw.authorName, 20) || userName;
      const replyContent = s(replyRaw.content, 120);
      if (!replyContent) return NextResponse.json({ error: '缺少要回复的评论内容' }, { status: 400 });
      // 服务端硬性守卫：不能回复自己的评论（防「AI 自己回复自己」）
      if (replyFrom === name) {
        return NextResponse.json({ error: '不能回复自己的评论' }, { status: 400 });
      }
      // 回复的结构（修复「回复不搭/复读自己动态」）：被回复的评论是唯一话题中心，放最前面；
      // 动态原文降为末尾的背景参考。旧版把动态放开头最显眼处，模型顺势把动态改写一遍
      // 当回复（用户实锤：财评「辛苦你了」，陈回「财啊，项目算搞定了…」——整句复读动态）
      user.push(`你在一条${label}动态的评论区里，${replyFrom}对你说了一句话，你只回TA这一句（不是评论区里的其他人）。`);
      user.push(`【要回复的那句话（你唯一的话题中心，回复必须直接接住它的内容/情绪/问题）】${replyFrom}对你说：「${replyContent}」`);
      user.push('- 像聊天接话一样自然衔接：让人一眼看出你回的是上面那句话，而不是随便又说了段别的；');
      user.push('- 动态原文只是背景不是话题：动态里已经写过的内容、意思、句式一律不要再重复（再说一遍是复读机，不是回复）；');
      user.push('- 界面已显示「X 回复 Y：」前缀，正文里不要再喊对方的名字/昵称，也不要「XX啊，」「XX，」这类开头，直接说内容；');
      user.push('- 8~40 字，口语化短句，像真人随手回消息：可以接梗、调侃、反问、敷衍、装傻；禁止客套模板（「谢谢」「说得好」「祝你…」这类）；');
      user.push(`（背景，仅供理解语境，禁止复述：这条动态是${postAuthor}发的：「${postContent.slice(0, 60)}」）`);
      if (thread.length > 0) user.push(`【评论区最近的发言（按先后；里面已有的话和类似话术不要再重复）】\n${thread.join('\n')}`);
      if (memories.length > 0)
        user.push(
          `【你记得的关于${userName}和你们之间的事（回复不得与这些已知事实矛盾）】\n${memories.map((m) => `- ${m}`).join('\n')}`
        );
      user.push('- 只输出回复文本本身，不要任何解释。');
    }
  }

  // 禁复读名单（评论/回复/转发/发动态通用）：与已说过的话一字不差是硬性废品
  if (avoid.length > 0) {
    user.push(
      `【禁复读（硬性要求）：下面是你最近已经说过的话（可能在另一个 App 或别的动态下说的）。你这次输出的话必须换一个完全不同的角度和说法，与它们一个字都不能相同，意思和句式也不能雷同】\n${avoid.map((t) => `- ${t}`).join('\n')}`
    );
  }
  // 随机切入角度（引擎每次随机指定）：同样的素材也能产出不同方向的内容
  if (variation) {
    user.push(`（本次切入角度（内部指定，直接照此发挥即可，输出里不要出现“角度/要求”这类字眼）：${variation}）`);
  }

  // 48-3 / 53：bilingual=true 时直接追加双语规则全文（规则自含格式说明：原文|中文译文，用 | 分隔）
  if (bilingual) {
    user.push(bilingualPrompt);
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: sys.join('\n') },
    { role: 'user', content: user.join('\n') },
  ];

  try {
    const config = extractUpstreamConfig(body.config);
    // 动态/评论是创意短文本：温度过低（或上游缓存）会让同一角色在微信/QQ 两平台产出一字不差的内容，
    // 这里抬高到 ≥0.9 保证多样性（仅影响本端点，不改用户全局配置）
    if (config) config.temperature = Math.max(config.temperature, 0.9);
    const { text } = await completeWithFallback(config, messages);
    // #47：发动态 / 评论 / 回复统一硬性剥 emoji——朋友圈文字干净；提示词禁令之外再剥一次（模型偶尔无视禁令）
    // 48-3 / 53：bilingual=true 时 LLM 按「原文|中文译文」格式输出，splitBilingual 按 | 拆分；中文正文无 | 则 contentZh=''
    let rawContent = text;
    let rawZh = '';
    if (bilingual) {
      const parts = splitBilingual(text);
      rawContent = parts.content;
      rawZh = parts.contentZh;
    }
    const content = stripEmojiText(cleanContent(rawContent));
    const contentZh = cleanContent(rawZh);
    if (!content) return NextResponse.json({ error: '生成结果为空' }, { status: 502 });
    return NextResponse.json({ content, contentZh });
  } catch (err) {
    const msg = err instanceof Error && err.message ? err.message : '生成失败';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
