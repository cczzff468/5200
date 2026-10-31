import { NextResponse } from 'next/server';

/**
 * X论坛 · AI 内容生成（服务端）。
 *
 * POST {
 *   config?: UpstreamConfig,             // 设置 App 的用户 API；缺省 SDK 兜底
 *   kind: 'posts' | 'reply' | 'dm' | 'comments' | 'subreplies' | 'names',
 *   items?: { name, persona?, community?, topic?, lang? }[],  // posts：批量生成多位作者的帖子（一次最多 24 条；lang = 惯用语言）
 *   count?: number,                     // names：生成几个网名（1~30）；comments：生成几条评论（10~30）
 *   author?: { name, persona?, lang? },  // reply/dm：说话人（lang = 惯用语言）
 *   parent?: { authorName, content },   // reply：被回复的帖子/评论
 *   postContent?: string,               // reply：所在主帖内容（多轮对话上下文）
 *   mediaDesc?: string,                 // reply/comments/subreplies：帖子配图的文字描述（识图模型产出）
 *   history?: { from: 'user' | 'peer', text }[],       // dm：对话上下文；reply：评论串最近几轮
 *   post?: { authorName, content, mediaDesc? },        // comments/subreplies：被评论的主帖
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

/** 剥离回复对象前缀（v7 修复：评论正文绝不携带「回复 @某某：」「@某某 」字样——
 *  回复对象由前端根据真实 parentId 动态渲染；旧 prompt 让 LLM 自己写 @前缀，
 *  批量生成时行序错位会把从没出现过的人写进评论里） */
function stripReplyPrefix(raw: string): string {
  let t = raw.trim();
  // 循环处理多种写法：「回复 @xx：」「回复@xx:」「@xx 」「回复 xx：」
  for (let i = 0; i < 3; i++) {
    const next = t
      .replace(/^[回复回覆]?\s*[@＠]\S{1,24}\s*[:：，,\s]\s*/, '')
      .replace(/^回复\s*[^@\s：:，,]{1,24}\s*[:：]\s*/, '')
      .trim();
    if (next === t) break;
    t = next;
  }
  return t;
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
              recent: Array.isArray(it.recent)
                ? (it.recent as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 3)
                : [],
            }))
            .filter((it) => it.persona || it.name)
        : [];
      if (!items.length) return NextResponse.json({ error: 'items 为空' }, { status: 400 });
      const expect = items.length;
      const spec = items
        .map((it, i) => {
          const mem = it.recent.length
            ? `；TA最近发过：${it.recent.map((r) => `「${r.slice(0, 40)}」`).join('、')}——这次可以接上之前的话疸（比如上次抱怨没买、这次晒到手；上次说瓜没意思、这次说看吧我早说了）`
            : '';
          return `${i + 1}. ${it.name}（人设：${it.persona || '普通论坛网友'}；主题方向：${it.topic || '娱乐热点'}；发帖语言：${langLabel(it.lang)}；发在「${it.community}」版块${mem}）`;
        })
        .join('\n');
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            '你在为一个国际化中文论坛（风格类似 X/Twitter 的公开广场）批量生成不同网友的帖子。' +
            '【最重要】每条帖子必须像真实网民随手发的，不是写作文。硬性要求：' +
            '\n- 口吻：碎碎念、带情绪、想哪说明，可以没头没尾；可以不用标点或全用感叹号/问号；可以有错别字和拼音缩写（u1s1、xswl、真下头）；短句为主，别写长难句。' +
            '\n- 严禁新闻稿腔/官方腔/作文腔：「今天看了个新闻感觉非常震惊」「我们要保持理智」「不得不说」「总的来说」「首先其次最后」这类全部禁止。' +
            '\n- 内容要会「编事情」——像讲一件真事：谁和谁被拍到深夜同框、今天在商场碰见某男星本人真人比屏幕帅、同事追星追到吃土、邻居提了新车全楼道都听说了、剧组路透、演唱会门口的黄牛、红毯造型翻车……有细节、有画面、有起因经过，像当事人或目击者随手发出来的。' +
            '\n- 话题标签要像真热搜：长句式、带情绪，如 #内娱今天又发什么疯# #这车油耗高得离谱# #某某新剧难看到让人弃剧# #又是为别人爱情流泪的一天#；每条最多一个。' +
            '\n- 对比参考——差（AI味）：今天看了个新闻，感觉非常震惊，我们要保持理智。好（真人味）：救命啊，热搜那个瓜到底是不是真的啊？？？我吃到现在都没吃明白，有没有课代表总结一下！' +
            '\n- 吃瓜要有「蹲后续」「瓜保熟」「让子弹飞一会儿」的口吻；吐槽要毒舌；追剧要发疯文学；车友要有圈内感；打工人要摆烂感。' +
            '\n- 语言：每条严格用该网友指定的「发帖语言」写，要地道得像母语者随手发的（英语帖是真英语网络口吻、日语帖像日本网友、韩语帖像韩国网友、繁体帖像港台网友）；简体中文为主，其他语言自然穿插。' +
            '\n- 字数不限：一句话的短吐槽、两三句话的现场播报、几百字的长帖叙事都可以，长短错落才真实。' +
            '\n- 涉及明星一律用模糊称呼（某顶流、某男团成员、某剧组、xxx），禁止使用真实明星姓名；影视剧可用泛称或虚构名。' +
            '\n- 每条必须严格符合该网友的人设口吻；同一人设带「最近发过」记忆时，内容要有连贯性（接着上次的事说）。' +
            '\n- 每条一行，行数与作者数一致。禁止 emoji、禁止任何格式标记。同一人设出现多次时，每条聊不同的事。',
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

    if (kind === 'names') {
      // LLM 生成真实感网名（用户要求：网名不要内置池子，让 AI 起名；
      // v5：网名与帖子/兴趣领域彻底解绑——真实网名和这人爱聊什么毫无关系）。
      // count = 需要几个；avoid = 已用网名（防撞）。
      const count = Math.min(Math.max(Math.floor(Number(body.count) || 0), 1), 30);
      const avoidNames = Array.isArray(body.avoid)
        ? body.avoid.filter((x): x is string => typeof x === 'string').slice(-60)
        : [];
      const avoidLine = avoidNames.length
        ? `\n\n这些网名已经有人用了，不要重复、也不要高度相似：\n${avoidNames.map((a) => a.slice(0, 20)).join('、')}`
        : '';
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content:
            '你在为中文论坛批量生成新网友的网名（用户 ID）。' +
            '【最重要】网名必须像真人随手取的——真实网名和这个人爱聊什么毫无关系：叫 momo 的人照样聊车，叫 阿茶 的人照样发电影帖，没人会给自己取名「电影院常驻嘉宾」。' +
            '\n【严禁】身份描述型网名——像「电影院常驻嘉宾」「课代表本表」「追剧上头患者」「省钱达人」「吃瓜第一线」「娱乐圈观察员」这种「自我介绍我是谁/我爱什么」的名字一眼假，全部禁止；' +
            '也禁止「xx用户」「xx网友」「XX爱好者」官方模板名和真实明星名。' +
            '\n真人取名的真实路数（混搭着来，每批风格尽量散开）：' +
            '\n- 随手敲的：Asdfgh / Zzzz_ / qwe123 / auoh / dddd' +
            '\n- 小名昵称：阿茶 / momo / Nana想吃火锅 / 阿泽 / Yuki / Lynn不在线' +
            '\n- 带点小情绪：今天也要好好吃饭 / hhh别骂了 / 不瘦十斤不改名 / 那咋了 / 在人间凑数的日子' +
            '\n- 食物动物：芋泥啵啵 / 半糖去冰 / 薯条蘸冰淇淋 / 一只废柴猫 / 卡皮巴拉本人' +
            '\n- 文艺挂：北纬三十度 / 晚风电台 / 凌晨四点的海 / 未命名文件夹' +
            '\n- 中英混合：Kiko不睡觉 / Vivi要暴富 / Momo是也 / Sam的深夜食堂' +
            '\n- 日系韩系繁体：抹茶大福 / 深夜三点の猫 / 하늘별 / 치즈볼 / 不吃香菜的傑森' +
            '\n硬性要求：每个 2~16 个字符；可中英数下划线混合；可带下划线/数字但别全是数字；' +
            '每行一个，只输出网名本身；禁止编号、引号、解释、空行；网名互相不要相似（不要同一个模板改两个字），更不要往任何兴趣领域上靠。',
        },
        { role: 'user', content: `请生成 ${count} 个网名，每行一个（输出 ${count} 行）。${avoidLine}` },
      ];
      const raw = (await completeWithFallback(config, messages)).text;
      const list = splitItems(raw, count, 24)
        .map((n) => n.replace(/^@/, '').trim())
        .filter((n) => n.length >= 2 && n.length <= 16);
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
              recent: Array.isArray(p.recent)
                ? (p.recent as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 3)
                : [],
            }))
        : [];
      if (!post || !personas.length) return NextResponse.json({ error: '参数为空' }, { status: 400 });
      const base = postLine(post);

      if (kind === 'comments') {
        const expect = personas.length;
        const spec = personas
          .map((p, i) => {
            const mem = p.recent.length
              ? `；TA最近在别的帖子里说过：${p.recent.map((r) => `「${r.slice(0, 30)}」`).join('、')}——如果对得上这个帖子的事，可以顺嘴接一句（你看，我早就说过了吧）`
              : '';
            return `${i + 1}. ${p.name}（人设：${p.persona}；评论语言：${langLabel(p.lang)}${mem}）`;
          })
          .join('\n');
        const messages: LLMMessage[] = [
          {
            role: 'system',
            content:
              '你在为一个国际化中文论坛（X/Twitter 风格广场）的帖子批量生成网友评论。' +
              '【最重要】每条评论必须回应帖子里讲的具体那件事——帖子说某顶流被拍到深夜同框，评论就聊这个同框；帖子说车油耗高想卖车，评论就聊这车。禁止答非所问的万金油。' +
              '\n【看帖作答铁律】先读懂原帖在问什么/求什么，再开口：' +
              '\n- 求推荐帖（求剧/求歌/求店/求攻略）：必须正面回答——要么真心推荐（说出具体名字+一句真实理由，如「去看XXX吧，三集一个案子不虐不烧脑」）、要么同求（「同求！也想要这种的」）、要么避雷（「别看XXX，开头甜后面刀」）。绝对禁止答非所问——人家求不烧脑不虐心的甜剧，你不能回「中间注水、结局烂尾」这种没头没尾的评价，更不能推荐相反的东西；' +
              '\n- 求助/提问帖：必须给出具体建议或直接回答问题；' +
              '\n- 分享/吐槽帖：共鸣、补充细节、抬杠都可以，但必须围绕帖子那件事。' +
              '\n【格式铁律】这是直接评论帖子的一级评论，不是回复某个人：绝对禁止以「@任何人」开头，绝对禁止带「回复」「回复 @某某：」字样（回复对象由系统自动标注，你写了就是画蛇添足）。' +
              '\n评论区六种人（按人设自然落位，有好有坏、有捧有踩，必须各占一定比例）：' +
              '\n- 共鸣党（顺着楼主发泄情绪）：「太懂了，我今天也是」「真的，谁懂啊！」「家人们谁懂，我也是」' +
              '\n- 无脑杠精（为抬杠而抬杠）：「只有我一个人觉得这很无聊吗？」「自己没钱买在这酸什么？」「就这也好意思发出来？」' +
              '\n- 课代表（整理信息/指出漏洞）：「课代表来了：博主说的是xx，别搞混了。」「省流：就是那么回事」' +
              '\n- 理中客（看似客观实则让人烦）：「大家理智吃瓜，等官方通报吧。」「不知道全貌不予评价」' +
              '\n- 乐子人（纯发疯凑热闹）：「打起来打起来！」「前排售卖瓜子花生矿泉水」「搬好小板凳了」' +
              '\n- 地域/身份暴击（结合IP属地或身份说话）：「沪爷就是有钱啊」「这在我们广东叫白切鸡」「北方人直接看傻」' +
              '\n【禁用词库——出现即废稿】：' +
              '\n-「总的来说」「不可否认」「确实如此」「在这个事件中」「我们应该」绝对禁止；' +
              '\n-「首先、其次、最后」的结构化长篇大论绝对禁止——网友只发一两句话，最多不超过三句；' +
              '\n-「支持」「说得对」「有道理」「深有体会」「说得真好」「感谢分享」「学到了」这类客套话绝对禁止——真实评论区没人这么说话。' +
              '\n【网感文字（大量使用）】：' +
              '\n- 梗与缩写：绝绝子（反讽用）、乐、笑死、一整个无语住、破防了、你小子、xswl、u1s1、真下头、蚌埠住了；' +
              '\n- 允许极端情绪词（符合社区规范、不真辱骂）：卧槽、妈呀、离谱、恶心、救命；' +
              '\n- 可以没头没尾、可以不用标点或全用感叹号/问号、可以有错别字。' +
              '\n【对比参考——帖子：「这车油耗真受不了，想卖了。」' +
              '\n- 好（真人味）：「这啥车啊避个雷。」「买的时候不看油耗吗？笑死。」「50包邮解君愁。」' +
              '\n- 差（AI味，禁止）：「确实，汽车的油耗对日常开销有很大影响，建议您在购车时多了解相关信息。」】' +
              '\n【人设一致性】每条严格符合该网友的人设口吻：给 TA 定了暴躁老哥，TA 的每条评论都得带点火气；定了乐子人，条条都在整活；定了饭圈女孩，满口磕到了/塌房/姐姐好美。' +
              '\n硬性要求：每条评论一两句话为主、长短错落；每条严格用该网友指定的「评论语言」写，地道得像母语者（日语像 それな/草、韩语像 ㄹㅇㅋㅋ、繁体像港台、英语是真网络英语）；多数简体中文，其他语言自然穿插；带「最近说过」记忆且与帖子相关时顺嘴接上（表现出连贯记忆）；每条一行，行数与网友数一致，第 N 行对应第 N 位。禁止 emoji 和任何格式标记。',
          },
          {
            role: 'user',
            content: `论坛里有这么一条帖子——\n${base}\n\n请以这 ${expect} 位网友的口吻各写一条一级评论（都是直接评论帖子本身，不是回复别人；输出 ${expect} 行）：\n${spec}${avoidLine}\n${bjTimeLine()}`,
          },
        ];
        const raw = (await completeWithFallback(config, messages)).text;
        const list = (await batchWithRetry(config, messages, raw, expect, 1000))
          .map(stripReplyPrefix)
          .filter((s) => s.length >= 2);
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
            '你在为一个国际化中文论坛（X/Twitter 风格广场）的帖子评论区生成楼中楼回复（回复评论区里某条评论）。' +
            '【格式铁律】直接写回复正文本身：绝对禁止以「@任何人」开头，绝对禁止带「回复」「回复 @某某：」字样——系统会根据真实回复关系自动在前面标注「回复 @被回复者：」，你自己写@会和系统标注重复甚至错位到别人头上。' +
            '【楼中楼铁律】每条回复必须针对对应那条评论里说的话——他说得对就附和补充，说得不对比回去，他问了就回答他；禁止无视对方自说自话，禁止绕开对方硬聊主帖。' +
            '\n【看帖作答】对方在求推荐/求助时，直接给出具体答案（名字+理由/具体做法），不能答非所问。' +
            '\n【禁用词库】「总的来说」「不可否认」「确实如此」「在这个事件中」「我们应该」「首先其次最后」「支持」「说得对」「有道理」绝对禁止；' +
            '一两句话为主，禁止长篇大论。' +
            '\n【网感】笑死、乐、破防了、你小子、一整个无语住、绝绝子（反讽）、卧槽、妈呀、离谱；可以没头没尾、可以不用标点、可以有错别字。' +
            '\n【人设一致性】严格符合该网友的人设口吻（暴躁老哥条条带火气，乐子人条条在整活）。' +
            '每条回复严格用指定网友的「语言」写，地道得像母语者。' +
            '几个字的短接到几十字的展开都行，长短错落。禁止 emoji 和任何格式标记。每条一行，行数与评论数一致，第 N 行对应第 N 条评论的回复。',
        },
        {
          role: 'user',
          content: `论坛帖子：${base}\n\n评论区里有下面 ${expect} 条评论，请逐条写出对应的楼中楼回复（每条直接写正文，针对那条评论说的话回应，不要带任何@或「回复」前缀；输出 ${expect} 行）：\n${spec}\n${bjTimeLine()}`,
        },
      ];
      const raw = (await completeWithFallback(config, messages)).text;
      const list = (await batchWithRetry(config, messages, raw, expect, 600))
        .map(stripReplyPrefix)
        .filter((s) => s.length >= 2);
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
              '回复必须贴合对方说的内容、帖子语境和你们之前的对话，可以带一点自己的态度，可以接梗、反问、分享经历、反驳。' +
              '【看帖作答】对方问了什么就答什么：求推荐就给出具体推荐（说出名字和理由），求助就给具体建议，绝不能答非所问。' +
              '【格式铁律】直接写回复正文：绝对禁止以「@任何人」开头，绝对禁止带「回复 @某某：」字样（系统会自动标注回复对象）。' +
              '【禁用】「总的来说」「不可否认」「确实如此」「在这个事件中」「我们应该」「首先其次最后」这类 AI 套话；「支持」「说得对」「有道理」这类客套话也禁止；一两句话为主。' +
              '口吻像真人聊天：口语化、带情绪、可以不用标点或全用感叹号、可以有错别字和缩写（xswl、u1s1、笑死、破防了）。' +
              '字数不限：一两句短回到上百字的长回复都可以。禁止 emoji，禁止任何格式标记，只输出回复正文。',
          },
          { role: 'user', content: `${ctx ? ctx + '\n\n' : ''}${parentLine}\n请以「${name}」的口吻回复（直接写正文，不要带@或「回复」前缀）。${bjTimeLine()}` },
        ])).text;
        return NextResponse.json({ text: cleanText(stripReplyPrefix(raw), 1000) });
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
