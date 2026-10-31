'use client';

/**
 * X论坛 · 行为引擎。
 *
 * 职责（全部非阻塞、失败静默、绝不抛错到 UI）：
 * 1. ensureSeed：首次打开 → NPC 文案池先落盘（论坛立刻有内容）+ 系统通知 + 欢迎私信；
 *    再异步 LLM 精修（NPC 新帖 + char 好友按人设发帖，LLM 失败仅跳过该条——NPC 池已保底）。
 * 2. ensureFresh：feed 最新帖超过 STALE_MS 视为「凉了」，打开时补 2~4 条
 *    （文案池即刻 + LLM 追加一条）。
 * 3. queueUserPostInteractions：用户发帖后延迟点赞（1~3 位 NPC + 好友），
 *    0~2 条 AI 回复（持久 pending 队列，重启不丢）。
 * 4. queueAiReplyToUserReply：用户回复了 AI 的帖/评论 → 该作者延迟再回一条
 *    （带完整上下文：主帖 + 被回复评论 + 用户评论 + 最近对话链，可无限多轮）。
 * 5. queueDmReply：用户私信发消息 → 对方延迟回复（LLM，失败通用兜底句）。
 * 6. generateMoreFeedPosts：主页滑到底 → 无限生成一批帖子（7~20 条，时间戳向前排，
 *    旧帖永不消失）；LLM 批量失败时 NPC 文案池兜底。
 * 7. ensureThreadComments / generateMoreComments：打开帖子自动把评论补到 10~30 条；
 *    「更多评论」按钮再生成 10~30 条（含楼中楼子回复）。
 *
 * 模型连接（设置 App）：
 * - API 模型（apiConfig）：所有 LLM 生成（帖子/评论/回复/私信）；
 * - 识图模型（visionConfig）：帖子带图时先把配图转成文字描述再喂给 LLM，
 *   让 AI「看得到」图（未配置时降级内置识图，再失败跳过）。
 */

import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import {
  COMMUNITY_DEFS,
  NPC_DEFS,
  POST_MAX,
  REPLY_MAX,
  STALE_MS,
  type AuthorKey,
  type ForumData,
  type ForumPost,
  forumContactsSnap,
  forumData,
  resolveAuthor,
  saveForum,
  uid,
} from './core';
import { describeImagesAuto } from '@/lib/vision-client';

// ---------------- pending 队列（跨刷新持久） ----------------

interface PendingJob {
  id: string;
  /** 到期时间戳 */
  due: number;
  kind: 'replyToUserPost' | 'aiReplyBack' | 'dmReply';
  /** 相关帖子 id（reply 类）/ dm 对方 key（dmReply） */
  postKey: string;
  meta: {
    authorKey?: AuthorKey;
    parentContent?: string;
    /** aiReplyBack 增强：分组锚点（顶层评论/主帖 id） */
    rootId?: string;
    /** aiReplyBack 增强：主帖 id（上下文用） */
    mainPostId?: string;
    /** aiReplyBack 增强：用户刚发的回复 id（AI 据此接话） */
    userReplyId?: string;
  };
}

const PENDING_KEY = 'forum-pending-v1';
/** 本会话已挂 timer 的任务 id（防重复挂；持久队列里任务保留到执行完才删） */
const scheduled = new Set<string>();

function loadPending(): Record<string, PendingJob> {
  const raw = kvGet(PENDING_KEY);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, PendingJob>;
  return {};
}

function savePending(p: Record<string, PendingJob>): void {
  void kvSet(PENDING_KEY, p);
}

function addPending(job: PendingJob): void {
  const p = loadPending();
  p[job.id] = job;
  savePending(p);
}

function dropPending(id: string): void {
  const p = loadPending();
  delete p[id];
  savePending(p);
  scheduled.delete(id);
}

// ---------------- LLM 调用 ----------------

async function callApi(payload: Record<string, unknown>): Promise<unknown> {
  const { useSettings } = await import('@/lib/ios/store');
  const res = await fetch('/api/forum/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, config: useSettings.getState().apiConfig }),
  });
  if (!res.ok) throw new Error(`请求失败 ${res.status}`);
  return res.json();
}

// ---------------- 识图（设置 › 识图模型） ----------------

/** 帖子配图 → 文字描述（识图模型优先、内置识图兜底；无图/失败返回空串）。
 *  连接设置里的识图模型：AI 评论/回复带图帖子时能「看到」图片内容。 */
async function describePostMedia(media: string[] | undefined): Promise<string> {
  if (!media?.length) return '';
  const imgs = media.filter((u) => typeof u === 'string' && u.startsWith('data:image/')).slice(0, 2);
  if (!imgs.length) return '';
  try {
    const { useSettings } = await import('@/lib/ios/store');
    const desc = await describeImagesAuto(useSettings.getState().visionConfig, {
      images: imgs,
      text: '这是论坛帖子的配图，请描述图片里有什么',
    });
    return desc.trim().slice(0, 200);
  } catch {
    return '';
  }
}

// ---------------- 帖子构造 ----------------

function basePost(authorKey: AuthorKey, content: string, community: string | null, at: number, replyTo?: string, replyToName?: string | null, organic = true): ForumPost {
  const npcKeys = NPC_DEFS.map((n) => `npc:${n.id}` as AuthorKey);
  const likes: AuthorKey[] =
    organic && authorKey !== 'user'
      ? npcKeys
          .slice()
          .sort(() => Math.random() - 0.5)
          .slice(0, Math.floor(Math.random() * 5))
          .filter(() => Math.random() < 0.85)
      : [];
  return {
    id: uid('p'),
    authorKey,
    content: content.slice(0, POST_MAX),
    community,
    createdAt: at,
    likes,
    reposts: organic ? Math.floor(Math.random() * 60) : 0,
    views: organic ? 300 + Math.floor(Math.random() * 3000) : 40 + Math.floor(Math.random() * 900),
    replyTo: replyTo ?? null,
    replyToName: replyToName ?? null,
  };
}

/** NPC → 默认版块（主题化：吃瓜/明星→娱乐八卦，影视→影视片单，车→汽车俱乐部，吐槽→吐槽大会） */
function defaultCommunityFor(npcId: string): string | null {
  const map: Record<string, string> = {
    wang: 'gossip',
    canteen: 'gossip',
    kitty: 'rant',
    iron: 'car',
    boat: 'movie',
    abacus: 'movie',
    kai: 'car',
    candy: 'gossip',
    liang: 'rant',
    sunny: 'gossip',
    gua: 'gossip',
    ju: 'movie',
    che: 'car',
    bao: 'gossip',
  };
  const v = map[npcId];
  return v === undefined ? null : v;
}

/** 池内 #话题# → 版块 id（null = 广场/今日热议）。新主题话题 + 旧话题兼容（历史帖归位） */
const NPC_COMMUNITY_MAP: Record<string, string | null> = {
  吃瓜现场: 'gossip',
  热搜围观: 'gossip',
  明星动态: 'gossip',
  追剧日常: 'movie',
  剧荒互助: 'movie',
  电影短评: 'movie',
  汽车俱乐部: 'car',
  提车日记: 'car',
  老司机日常: 'car',
  今日吐槽: 'rant',
  数码圈: 'digital',
  吃货联盟: 'food',
  职场摸鱼: 'work',
  健身打卡: 'fit',
  旅行摄影: 'travel',
  游戏玩家: 'game',
  深夜树洞: 'night',
  下班后的生活: null,
};

function communityOfPoolText(npcId: string, text: string): string | null {
  const tag = /#([^#\s]+)#/.exec(text)?.[1];
  if (tag && NPC_COMMUNITY_MAP[tag] !== undefined) return NPC_COMMUNITY_MAP[tag];
  const def = defaultCommunityFor(npcId);
  return def;
}

// ---------------- 播种 ----------------

let seeding = false;

/** 首次打开：池子同步落盘（立即有内容），LLM 精修异步追加。幂等。 */
export async function ensureSeed(): Promise<void> {
  const d = forumData();
  if (d.seeded || seeding) return;
  seeding = true;
  try {
    const now = Date.now();
    const seedPosts: ForumPost[] = [];
    for (const npc of NPC_DEFS) {
      const n = 1 + Math.floor(Math.random() * 2);
      const pool = [...npc.pool];
      for (let i = 0; i < n && pool.length; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        const text = pool.splice(idx, 1)[0];
        const at = now - Math.floor(Math.random() * 26 * 3600_000) - 600_000;
        seedPosts.push(basePost(`npc:${npc.id}`, text, communityOfPoolText(npc.id, text), at));
      }
    }
    const next: ForumData = {
      ...d,
      posts: [...d.posts, ...seedPosts],
      // char 好友自动关注（X：好友互关，「关注」页能刷到 TA 的帖子）
      following: [...new Set([...d.following, ...forumContactsSnap().filter((c) => c.kind === 'char').map((c) => `char:${c.id}` as AuthorKey)])],
      notifications: [
        ...d.notifications,
        {
          id: uid('n'),
          type: 'system',
          fromKey: 'official',
          postId: null,
          text: '欢迎加入X论坛！发一条帖子，让广场认识你。',
          createdAt: now - 300_000,
          read: false,
        },
      ],
      dms: d.dms.some((x) => x.peerKey === 'official')
        ? d.dms
        : [
            ...d.dms,
            {
              peerKey: 'official',
              messages: [
                { id: uid('m'), from: 'official', text: '欢迎加入X论坛！我是论坛小助手。', at: now - 300_000 },
                { id: uid('m'), from: 'official', text: '小技巧：点右下角蓝色按钮就能发帖；帖子带 #话题# 更容易被大家刷到哦。', at: now - 299_000 },
              ],
            },
          ],
      seeded: true,
      lastGenAt: now,
    };
    saveForum(next);
    // 异步 LLM 精修（NPC 3 条新帖 + char 好友各一条人设帖；失败静默跳过）
    void llmPolish();
  } finally {
    seeding = false;
  }
}

/** LLM 生成追加（失败静默——池子内容已保证不空） */
async function llmPolish(): Promise<void> {
  try {
    const d = forumData();
    const npcPicks = NPC_DEFS.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    // char 好友：各生成一条人设帖（最多 2 位，避免首批请求过重）
    const charPicks = forumContactsSnap()
      .filter((c) => c.kind === 'char' && (c.persona || c.background))
      .slice(0, 2)
      .map((c) => {
        const name = c.nickname || c.name;
        return { name, persona: [c.persona, c.background, c.expressStyle].filter(Boolean).join('；'), isChar: true, id: c.id };
      });
    const items = [
      ...npcPicks.map((n) => ({ name: n.name, persona: n.persona, community: defaultCommunityFor(n.id) ?? '今日热议', isChar: false, id: n.id })),
      ...charPicks.map((c) => ({ name: c.name, persona: c.persona, community: '今日热议', isChar: true, id: c.id })),
    ].slice(0, 5);
    if (!items.length) return;
    const avoid = d.posts.slice(-8).map((p) => p.content.slice(0, 60));
    const topics = FEED_TOPICS.slice().sort(() => Math.random() - 0.5);
    const r = (await callApi({
      kind: 'posts',
      items: items.map(({ name, persona, community }, i) => ({ name, persona, community, topic: topics[i % topics.length] })),
      avoid,
      userName: resolveAuthor('user').name,
    })) as { items?: string[] };
    const texts = Array.isArray(r.items) ? r.items.filter((x) => typeof x === 'string' && x.trim().length > 5) : [];
    if (!texts.length) return;
    const now = Date.now();
    const next: ForumData = { ...forumData() };
    texts.forEach((t, i) => {
      const spec = items[i] ?? items[items.length - 1];
      const authorKey: AuthorKey = spec.isChar ? `char:${spec.id}` : `npc:${spec.id}`;
      // LLM 帖不带 #话题 时，按默认版块归位
      const tag = /#([^#\s]+)#/.exec(t)?.[1];
      const cid = spec.isChar ? (tag ? NPC_COMMUNITY_MAP[tag] ?? null : null) : communityOfPoolText(spec.id, t);
      next.posts.push(basePost(authorKey, t, cid, now - (i + 1) * 420_000));
    });
    saveForum(next);
  } catch {
    /* LLM 失败：池子内容已够看 */
  }
}

// ---------------- 补新帖 ----------------

let refreshing = false;

/** feed 凉了（最新帖 > STALE_MS）→ 补 2~4 条（池子即刻 + LLM 追加异步）。幂等。 */
export async function ensureFresh(): Promise<void> {
  if (refreshing) return;
  const d = forumData();
  if (!d.seeded) return;
  const newest = d.posts.reduce((m, p) => Math.max(m, p.createdAt), 0);
  if (newest && Date.now() - newest < STALE_MS) return;
  refreshing = true;
  try {
    const n = 2 + Math.floor(Math.random() * 3);
    const now = Date.now();
    const next: ForumData = { ...forumData() };
    const used = new Set(next.posts.map((p) => p.content.slice(0, 20)));
    let added = 0;
    for (const npc of NPC_DEFS.slice().sort(() => Math.random() - 0.5)) {
      if (added >= n) break;
      const cand = npc.pool.find((x) => !used.has(x.slice(0, 20)));
      if (!cand) continue;
      used.add(cand.slice(0, 20));
      next.posts.push(basePost(`npc:${npc.id}`, cand, communityOfPoolText(npc.id, cand), now - Math.floor(Math.random() * 900_000) - 60_000));
      added += 1;
    }
    next.lastGenAt = now;
    saveForum(next);
    void llmPolish();
  } finally {
    refreshing = false;
  }
}

// ---------------- 主页无限生成（底部上拉松开 / 顶部下拉松开 → 过界手势触发） ----------------

let feedGenerating = false;

/** 通用评论池（LLM 失败时的兜底扩充：与 NPC 池合计保证任何帖子都能补满 10~30 条不重样评论；
 *  去重只在本帖内——不同帖子评论区出现相似短评很正常） */
const GENERIC_COMMENTS = [
  '哈哈哈哈太真实了',
  '这条必须顶上去，说得太对了',
  '同感同感，深有体会',
  '前排围观，楼主说得好',
  '看完沉默了，想想还真是这样',
  '每天刷论坛就为了等这种帖子',
  '理性讨论，这条我站楼主',
  '泪目了，突然想家了',
  '有点东西，已经收藏了',
  '这波总结到位，一个字都没多说',
  '蹲一个后续，别断更啊',
  '评论区比帖子还精彩，哈哈',
  '楼主是懂生活的',
  '说实话，看饿了',
  '半夜看到这条，直接破防',
  '人间清醒，就是这么回事',
  '这就是生活啊，平平常常的才是真',
  '太治愈了，谢谢分享',
  '有用，马克一下回头细看',
  '好家伙，直接说进心坎里了',
  '有点意思，已关注',
  '笑死，段子手果然在民间',
  '支持支持，让更多人看到',
  '路过留个爪，明天再来看',
  '这就是普通人的浪漫吧',
  '确实，没毛病',
  '看得出来很用心，赞一个',
  '学到了学到了，受教',
  '突然被这句话安慰到了',
  '已转给我朋友看，她说太像了',
  '一整个共鸣住了',
  '楼主文笔可以啊，多写点',
  '认真看完，值得细品',
  '这么好的帖子不能沉',
  '是本人了，别念了别念了',
  '哈哈哈评论区都是人才',
  '说出了我不敢说的',
  '这个观点我保留，但尊重',
  '细想还真是这个理',
  '先赞后看，习惯了',
  '前排吃瓜，瓜子已备好',
  '这瓜太大了，先马后看',
  '蹲一个后续，别断更',
  '车主路过，确实是这样',
  '这剧我也在追，上头了',
  '反转了反转了，快看最新',
  '让子弹再飞一会儿',
  '课代表什么时候来总结',
  '追星女孩路过，理智看待',
  '这瓜保熟吗',
  '老司机看不下去了，说两句',
  '省流：就是那么回事',
  '已经开始二刷了，别拦我',
  '这车我也试驾过，感觉还行',
  '热搜挂一整天了，看疲劳了',
];

/** 生成主题池（用户指定内容方向：八卦/明星/吐槽/车/影视/娱乐/吃瓜）——
 *  LLM 按主题方向生成；兜底组合池同主题，保证无 LLM 也是对味内容 */
export const FEED_TOPICS = ['明星八卦', '吃瓜现场', '影视综艺', '汽车圈', '娱乐热点', '今日吐槽'];

/** 组合式帖子兜底（NPC 池耗尽 + LLM 失败时：话题×开头×正文×结尾 组合出近乎无限的帖子，
 *  保证「下滑无限生成」在任何情况下都有新内容；主题与 FEED_TOPICS 同向） */
const GEN_TOPICS = ['明星塌房', '恋情官宣', '热搜第一', '大结局烂尾', '新剧上头', '电影彩蛋', '提车第一天', '油价', '早高峰堵车', '司机加塞', '综艺名场面', '红毯造型', '剧组路透', '新车发布', '试驾感受', '二手车避坑', '追星开销', '剧荒求推', '瓜反转', '代拍乱象'];
const GEN_MOODS = [
  '刚刷到{t}，先蹲一个后续：',
  '关于{t}，说点个人看法：',
  '{t}这事儿，懂的都懂。',
  '不是，{t}都能上热搜？',
  '{t}，建议全体围观：',
  '一觉醒来又被{t}刷屏了。',
  '有人聊{t}吗，在线等。',
  '今日份{t}，瓜保熟：',
];
const GEN_BODIES = [
  '前排吃瓜，目前信息还很乱，先别急着站队',
  '瓜越吃越大，反转比剧还精彩，我已经搬好小板凳了',
  '追了三季，这个走向我直接傻眼，编剧你出来',
  '红毯造型一出，评论区已经吵了八百楼',
  '试驾了一圈，动力是真好，价格也是真硬',
  '早高峰被加塞三次，血压和油门一起踩到底了',
  '路透看着还行，正片出来之前保持冷静',
  '官宣文案我都能背了，就等一个后续',
  '粉丝说是状态问题，路人说是审美问题，我说都有问题',
  '第二集开始封神，安利给所有还没看的人',
  '剧组宣发真会玩，预告剪得比正片好看',
  '朋友提了新车，我把副驾坐出包浆了',
  '黄牛加价三倍，官方声明管用吗，蹲一个结果',
  '这瓜保熟吗，先让子弹飞一会儿',
];
const GEN_TAILS = ['评论区蹲一个真相。', '有懂哥出来讲讲吗？', '理性讨论，别吵架。', '先吃瓜，后负责。', '就问还有谁。', '懂的都懂。', '让我看看谁的DNA动了。', ''];

/** 从组合池里抽一条不重复的帖子文案（used = 已用内容前缀指纹；80 次抽不到就放弃） */
function comboPostText(used: Set<string>): string | null {
  for (let i = 0; i < 80; i++) {
    const t = GEN_TOPICS[Math.floor(Math.random() * GEN_TOPICS.length)];
    const m = GEN_MOODS[Math.floor(Math.random() * GEN_MOODS.length)].replace('{t}', t);
    const b = GEN_BODIES[Math.floor(Math.random() * GEN_BODIES.length)];
    const tail = GEN_TAILS[Math.floor(Math.random() * GEN_TAILS.length)];
    const s = `${m}${b}。${tail}`.slice(0, POST_MAX);
    const k = s.slice(0, 20);
    if (!used.has(k)) {
      used.add(k);
      return s;
    }
  }
  return null;
}

/** 批量生成一批 feed 帖子（作者池 = 主题 NPC 轮换 + 偶尔 char 好友 15%；每人带主题方向）。
 *  LLM 批量（设置›API 模型）→ NPC 文案池补齐 → 组合式兜底，任何情况下都有内容。
 *  used = 全局内容前缀指纹（跨调用累积去重）。 */
async function buildFeedBatch(
  n: number,
  used: Set<string>,
  avoid: string[],
): Promise<{ key: AuthorKey; text: string }[]> {
  const chars = forumContactsSnap().filter((c) => c.kind === 'char' && (c.persona || c.background));
  const shuffledNpcs = NPC_DEFS.slice().sort(() => Math.random() - 0.5);
  const topics = FEED_TOPICS.slice().sort(() => Math.random() - 0.5);
  const specs: { key: AuthorKey; name: string; persona: string; community: string | null; topic: string }[] = [];
  for (let i = 0; i < n; i++) {
    const ch = chars.length && Math.random() < 0.15 ? chars[Math.floor(Math.random() * chars.length)] : null;
    const topic = topics[i % topics.length];
    if (ch) {
      specs.push({
        key: `char:${ch.id}`,
        name: ch.nickname || ch.name,
        persona: [ch.persona, ch.background, ch.expressStyle].filter(Boolean).join('；'),
        community: null,
        topic,
      });
    } else {
      const nd = shuffledNpcs[i % shuffledNpcs.length];
      specs.push({ key: `npc:${nd.id}`, name: nd.name, persona: nd.persona, community: defaultCommunityFor(nd.id), topic });
    }
  }

  // LLM 批量生成（一次 7~20 条；失败静默走池子）
  const results: { key: AuthorKey; text: string }[] = [];
  try {
    const r = (await callApi({
      kind: 'posts',
      items: specs.map(({ name, persona, community, topic }) => ({ name, persona, community: community ?? '今日热议', topic })),
      avoid,
      userName: resolveAuthor('user').name,
    })) as { items?: string[] };
    const texts = Array.isArray(r.items) ? r.items.filter((x) => typeof x === 'string' && x.trim().length > 5) : [];
    texts.forEach((t, i) => {
      if (used.has(t.slice(0, 20))) return;
      used.add(t.slice(0, 20));
      results.push({ key: specs[i]?.key ?? `npc:${NPC_DEFS[0].id}`, text: t });
    });
  } catch {
    /* 走池子兜底 */
  }
  // NPC 文案池补齐（LLM 失败/条数不足；全局去重——同一帖子不应重复出现）
  if (results.length < n) {
    for (const npc of NPC_DEFS.slice().sort(() => Math.random() - 0.5)) {
      if (results.length >= n) break;
      for (const cand of npc.pool) {
        if (results.length >= n) break;
        if (used.has(cand.slice(0, 20))) continue;
        used.add(cand.slice(0, 20));
        results.push({ key: `npc:${npc.id}`, text: cand });
      }
    }
  }
  // NPC 池也耗尽 → 组合式生成兜底（话题×开头×正文×结尾，近乎无限，下滑永远有新帖）
  while (results.length < n) {
    const t = comboPostText(used);
    if (!t) break;
    const npc = NPC_DEFS[Math.floor(Math.random() * NPC_DEFS.length)];
    results.push({ key: `npc:${npc.id}`, text: t });
  }
  return results;
}

/** 主页滑到最后一个帖子、继续上滑并松开 → 无限生成一批新帖子（过界手势触发）。
 *  - 一次 7~20 条（LLM 批量，设置里的 API 模型，主题：八卦/明星/吐槽/车/影视/娱乐/吃瓜）；
 *  - 时间戳排在现有最老主帖之前（信息流向下无限延伸，上面已生成的帖子永不消失）；
 *  - LLM 失败/不足时 NPC 文案池兜底，永远有内容。
 *  返回本次新增条数。 */
export async function generateMoreFeedPosts(): Promise<number> {
  if (feedGenerating) return 0;
  feedGenerating = true;
  try {
    const d = forumData();
    if (!d.seeded) return 0;
    const n = 7 + Math.floor(Math.random() * 14); // 7~20 条
    // 时间边界：全部主帖里最老的时间，新帖排在它之前（feed 下方）
    let frontier = Date.now();
    for (const p of d.posts) {
      if (p.replyTo === null && p.createdAt < frontier) frontier = p.createdAt;
    }
    // 防重复：取现有全部帖子的前缀指纹
    const used = new Set(d.posts.map((p) => p.content.slice(0, 20)));
    const avoid = [...d.posts]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 12)
      .map((p) => p.content.slice(0, 60));

    const results = await buildFeedBatch(n, used, avoid);
    if (!results.length) return 0;

    // 落库：时间戳自 frontier 向前递减（20~120 分钟一档），旧帖永在上方
    const next = { ...forumData() };
    let at = frontier - (20 + Math.random() * 40) * 60_000;
    for (const { key, text } of results) {
      const tag = /#([^#\s]+)#/.exec(text)?.[1];
      const cid = key.startsWith('npc:')
        ? communityOfPoolText(key.slice(4), text)
        : tag
          ? NPC_COMMUNITY_MAP[tag] ?? null
          : null;
      next.posts.push(basePost(key, text, cid, at));
      at -= (20 + Math.random() * 100) * 60_000;
    }
    next.lastGenAt = Date.now();
    saveForum(next);
    return results.length;
  } catch {
    return 0;
  } finally {
    feedGenerating = false;
  }
}

/** 主页滑到最顶部、下拉并松开 → 生成一批全新内容（过界手势触发）。
 *  - 一次 7~20 条，时间戳全部晚于现有最新帖（新内容整批插入信息流最上方）；
 *  - 与底部生成共用互斥锁与批量生成器（主题同向），旧帖永不消失。 */
export async function generateNewFeedPosts(): Promise<number> {
  if (feedGenerating) return 0;
  const d0 = forumData();
  if (!d0.seeded) return 0;
  feedGenerating = true;
  try {
    const n = 7 + Math.floor(Math.random() * 14); // 7~20 条
    const used = new Set(d0.posts.map((p) => p.content.slice(0, 20)));
    const avoid = [...d0.posts]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 12)
      .map((p) => p.content.slice(0, 60));

    const results = await buildFeedBatch(n, used, avoid);
    if (!results.length) return 0;

    // 落库：时间戳从「现在」向前铺（40s~3.4min 一档递减），最新在最上、整批压过现有 feed
    const next = { ...forumData() };
    let at = Date.now() - 20_000;
    for (const { key, text } of results) {
      const tag = /#([^#\s]+)#/.exec(text)?.[1];
      const cid = key.startsWith('npc:')
        ? communityOfPoolText(key.slice(4), text)
        : tag
          ? NPC_COMMUNITY_MAP[tag] ?? null
          : null;
      next.posts.push(basePost(key, text, cid, at));
      at -= (40 + Math.random() * 160) * 1000;
    }
    next.lastGenAt = Date.now();
    saveForum(next);
    return results.length;
  } catch {
    return 0;
  } finally {
    feedGenerating = false;
  }
}

// ---------------- 帖子评论区批量生成（10~30 条 + 楼中楼） ----------------

/** 正在生成评论的帖子 id（防并发重复） */
const threadGen = new Set<string>();

/** 帖子评论总数（顶层 + 楼中楼） */
function countThreadComments(d: ForumData, postId: string): number {
  const top = d.posts.filter((p) => p.replyTo === postId);
  let n = top.length;
  for (const c of top) n += d.posts.filter((p) => p.replyTo === c.id).length;
  return n;
}

/** 随机挑评论者（NPC 轮换 + char 好友穿插），count 个 */
function pickCommenters(count: number): AuthorKey[] {
  const chars = forumContactsSnap().filter((c) => c.kind === 'char' && (c.persona || c.background));
  const npcs = NPC_DEFS.slice().sort(() => Math.random() - 0.5);
  const out: AuthorKey[] = [];
  for (let i = 0; i < count; i++) {
    if (chars.length && Math.random() < 0.12) {
      out.push(`char:${chars[Math.floor(Math.random() * chars.length)].id}`);
    } else {
      out.push(`npc:${npcs[i % npcs.length].id}`);
    }
  }
  return out;
}

/** 生成一批评论并落库（LLM 批量 + 池子兜底 + 楼中楼子回复）。
 *  mode='ensure'：评论不足 10 条时补到 10~30（打开帖子自动触发）；
 *  mode='more'：直接追加 10~30 条（「更多评论」按钮）。
 *  返回新增评论数（含子回复）。 */
async function genCommentBatch(postId: string, mode: 'ensure' | 'more'): Promise<number> {
  if (threadGen.has(postId)) return 0;
  const d0 = forumData();
  const post = d0.posts.find((p) => p.id === postId);
  if (!post) return 0;
  const cur = countThreadComments(d0, postId);
  let want: number;
  if (mode === 'ensure') {
    if (cur >= 10) return 0;
    want = Math.max(0, 10 - cur) + Math.floor(Math.random() * 21); // 补到 10~30
  } else {
    want = 10 + Math.floor(Math.random() * 21); // 10~30
  }
  if (want <= 0) return 0;
  threadGen.add(postId);
  try {
    const d = forumData();
    const postAuthor = resolveAuthor(post.authorKey);
    // 本帖现有评论（顶层 + 楼中楼）——去重与 avoid 只看本帖：
    // 不同帖子评论区出现相似短评很正常，全局去重会把池子过早耗尽
    const threadReplies = d.posts.filter(
      (p) => p.replyTo === postId || d.posts.some((c) => c.id === p.replyTo && c.replyTo === postId),
    );
    // 识图模型：帖子带图先「看图」，AI 评论才有画面感
    const mediaDesc = await describePostMedia(post.media);
    const commenterKeys = pickCommenters(want);
    const avoid = threadReplies.slice(-10).map((p) => p.content.slice(0, 40));

    // ---- 顶层评论（LLM 批量，池子兜底） ----
    let texts: string[] = [];
    try {
      const r = (await callApi({
        kind: 'comments',
        post: { authorName: postAuthor.name, content: post.content, mediaDesc },
        count: want,
        personas: commenterKeys.map((k) => {
          const a = resolveAuthor(k);
          return { name: a.name, persona: a.persona || '普通论坛网友' };
        }),
        avoid,
        userName: resolveAuthor('user').name,
      })) as { items?: string[] };
      texts = Array.isArray(r.items) ? r.items.filter((x) => typeof x === 'string' && x.trim().length >= 4) : [];
    } catch {
      texts = [];
    }
    if (texts.length < want) {
      // 池子兜底：NPC replies 池 + 通用评论池轮换（去重仅限本帖，保证任何帖子都能补满）
      const usedCt = new Set<string>([
        ...texts.map((t) => t.slice(0, 16)),
        ...threadReplies.map((p) => p.content.slice(0, 16)),
      ]);
      const npcRing = NPC_DEFS.slice().sort(() => Math.random() - 0.5);
      let ni = 0;
      while (texts.length < want && ni < 400) {
        const npc = npcRing[ni % npcRing.length];
        // NPC 池扫过几轮后切通用池，两个池子交替抽
        const useGeneric = ni >= 36 || Math.random() < 0.35;
        const cand = useGeneric
          ? GENERIC_COMMENTS[Math.floor(Math.random() * GENERIC_COMMENTS.length)]
          : npc.replies[Math.floor(Math.random() * npc.replies.length)];
        const k = cand.slice(0, 16);
        if (!usedCt.has(k)) {
          usedCt.add(k);
          texts.push(cand);
          commenterKeys[texts.length - 1] = `npc:${npc.id}`;
        }
        ni += 1;
      }
    }
    if (!texts.length) return 0;

    // 时间戳：在（发帖时间、现在］内升序铺开；已有评论则从最后一条之后接
    const lastAt = threadReplies.reduce((m, p) => Math.max(m, p.createdAt), 0);
    const start = Math.max(post.createdAt + 60_000, lastAt + 60_000);
    const end = Math.max(start + texts.length * 90_000, Date.now());
    const step = Math.max(45_000, (end - start) / texts.length);

    const next: ForumData = { ...forumData() };
    const newComments: ForumPost[] = [];
    let at = start;
    texts.forEach((t, i) => {
      at += step * (0.5 + Math.random() * 0.7);
      const authorKey = commenterKeys[i] ?? commenterKeys[commenterKeys.length - 1];
      const c = basePost(authorKey, t.slice(0, REPLY_MAX), post.community, at, postId, postAuthor.name);
      newComments.push(c);
      next.posts.push(c);
    });

    // ---- 楼中楼：约 1/3 的新评论各来 1 条子回复（其他网友/楼主接话） ----
    try {
      const subTargets = newComments
        .slice()
        .sort(() => Math.random() - 0.5)
        .slice(0, Math.max(1, Math.floor(newComments.length / 3)));
      if (subTargets.length) {
        // 子回复作者：其他 NPC（偶尔楼主本人回评，很 X）
        const subKeys = subTargets.map((c) => {
          if (post.authorKey !== 'user' && Math.random() < 0.3) return post.authorKey;
          return pickCommenters(1)[0];
        });
        let subTexts: string[] = [];
        try {
          const r = (await callApi({
            kind: 'subreplies',
            post: { authorName: postAuthor.name, content: post.content, mediaDesc },
            threads: subTargets.map((c) => ({ authorName: resolveAuthor(c.authorKey).name, content: c.content })),
            personas: subKeys.map((k) => {
              const a = resolveAuthor(k);
              return { name: a.name, persona: a.persona || '普通论坛网友' };
            }),
            userName: resolveAuthor('user').name,
          })) as { items?: string[] };
          subTexts = Array.isArray(r.items) ? r.items.filter((x) => typeof x === 'string' && x.trim().length >= 4) : [];
        } catch {
          subTexts = [];
        }
        subTargets.forEach((c, i) => {
          let text = subTexts[i];
          if (!text) {
            // 池子兜底：NPC replies + 通用评论各半
            const npc = NPC_DEFS[Math.floor(Math.random() * NPC_DEFS.length)];
            text =
              Math.random() < 0.5
                ? npc.replies[Math.floor(Math.random() * npc.replies.length)]
                : GENERIC_COMMENTS[Math.floor(Math.random() * GENERIC_COMMENTS.length)];
            subKeys[i] = `npc:${npc.id}`;
          }
          const subAt = Math.min(Date.now() - Math.floor(Math.random() * 60_000), c.createdAt + (2 + Math.random() * 30) * 60_000);
          const sub = basePost(subKeys[i], text.slice(0, REPLY_MAX), post.community, Math.max(subAt, c.createdAt + 60_000), c.id, resolveAuthor(c.authorKey).name);
          sub.replyToPost = c.id;
          next.posts.push(sub);
        });
      }
    } catch {
      /* 子回复失败不影响主评论 */
    }

    // 楼主是用户 → 前 3 条评论发通知（X：别人回复了你的帖子）
    if (post.authorKey === 'user') {
      next.notifications = [
        ...newComments.slice(0, 3).map((c) => ({
          id: uid('n'),
          type: 'reply' as const,
          fromKey: c.authorKey,
          postId: c.id,
          createdAt: c.createdAt,
          read: false,
        })),
        ...next.notifications,
      ];
    }
    saveForum(next);
    const subs = next.posts.filter((p) => newComments.some((c) => c.id === p.replyTo)).length;
    return newComments.length + subs;
  } catch {
    return 0;
  } finally {
    threadGen.delete(postId);
  }
}

/** 打开帖子详情页时调用：评论不足 10 条 → 自动补到 10~30 条（静默，评论生成好后自动浮现）。 */
export async function ensureThreadComments(postId: string): Promise<void> {
  try {
    await genCommentBatch(postId, 'ensure');
  } catch {
    /* 静默 */
  }
}

/** 「更多评论」按钮：再生成 10~30 条（含楼中楼）。返回新增数。 */
export async function generateMoreComments(postId: string): Promise<number> {
  return genCommentBatch(postId, 'more');
}

// ---------------- 用户发帖 → NPC/char 互动 ----------------

/** 用户发布帖子后调用：延迟点赞 + 0~2 条 AI 回复（持久 pending） */
export function queueUserPostInteractions(post: ForumPost): void {
  const next0 = forumData();
  const likers = NPC_DEFS.slice().sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 3));
  // char 好友优先来点赞
  const charLiker = next0.posts
    .filter((p) => p.authorKey.startsWith('char:'))
    .map((p) => p.authorKey)[0];
  window.setTimeout(() => {
    try {
      const next = { ...forumData() };
      const p = next.posts.find((x) => x.id === post.id);
      if (!p) return;
      const likers2 = likers.map((l) => `npc:${l.id}` as AuthorKey);
      p.likes = [...new Set([...p.likes, ...likers2, ...(charLiker ? [charLiker] : [])])];
      // 点赞也发通知（X：有人赞了你的帖子）
      next.notifications = [
        {
          id: uid('n'),
          type: 'like' as const,
          fromKey: likers2[0] ?? (charLiker ?? 'npc:wang'),
          postId: post.id,
          createdAt: Date.now(),
          read: false,
        },
        ...next.notifications,
      ];
      saveForum(next);
    } catch {
      /* 静默 */
    }
  }, 3000 + Math.random() * 6000);
  const replyCount = Math.random() < 0.75 ? 1 + (Math.random() < 0.35 ? 1 : 0) : 0;
  for (let i = 0; i < replyCount; i++) {
    const npc = likers[i % likers.length];
    addPending({
      id: uid('j'),
      due: Date.now() + 8000 + Math.random() * 12000 + i * (5000 + Math.random() * 8000),
      kind: 'replyToUserPost',
      postKey: post.id,
      meta: { authorKey: `npc:${npc.id}`, parentContent: post.content },
    });
  }
  runPending();
}

/** 用户回复某帖/某条评论（thread 页）后调用：若被回复对象作者是 AI，排一条再回复。
 *  targetPostId = 实际被回复的那条（主帖或某条评论/子回复）→ 其作者来接话；
 *  rootId = 分组锚点（顶层评论 id 或主帖 id）→ AI 的回复挂在这一层显示；
 *  mainPostId = 主帖 id（LLM 上下文用）。
 *  每次用户回复都排一条 → 我再回复他、他还能再回复我（无限多轮）。 */
export function queueAiReplyToUserReply(targetPostId: string, userReplyId: string, rootId?: string, mainPostId?: string): void {
  const d = forumData();
  const target = d.posts.find((p) => p.id === targetPostId);
  if (!target || target.authorKey === 'user') return;
  if (!d.posts.find((p) => p.id === userReplyId)) return;
  addPending({
    id: uid('j'),
    due: Date.now() + 5000 + Math.random() * 8000,
    kind: 'aiReplyBack',
    postKey: targetPostId,
    meta: {
      authorKey: target.authorKey,
      parentContent: target.content,
      rootId: rootId ?? targetPostId,
      mainPostId: mainPostId ?? (rootId && rootId !== targetPostId ? rootId : targetPostId),
      userReplyId,
    },
  });
  runPending();
}

// ---------------- 私信 ----------------

/** 用户在私信发消息后调用：对方延迟回复（官方小助手不聊天） */
export function queueDmReply(peerKey: AuthorKey): void {
  if (peerKey === 'official') return;
  addPending({
    id: uid('j'),
    due: Date.now() + 5000 + Math.random() * 7000,
    kind: 'dmReply',
    postKey: peerKey,
    meta: { authorKey: peerKey },
  });
  runPending();
}

// ---------------- pending 执行器 ----------------

/** 把任务挂上 timer（App 打开时 + 新任务入队时调用）。
 *  已挂 timer 的任务保留在持久队列（执行完才删）——App 中途关闭后下次打开会重新挂。 */
export function runPending(): void {
  const p = loadPending();
  const now = Date.now();
  for (const job of Object.values(p)) {
    if (scheduled.has(job.id)) continue;
    const wait = Math.max(0, job.due - now);
    if (wait > 90_000) continue; // 远期任务等下次触发点再挂
    scheduled.add(job.id);
    window.setTimeout(() => {
      void execJob(job).finally(() => dropPending(job.id));
    }, wait);
  }
}

async function execJob(job: PendingJob): Promise<void> {
  try {
    if (job.kind === 'replyToUserPost' || job.kind === 'aiReplyBack') {
      const d = forumData();
      const target = d.posts.find((x) => x.id === job.postKey);
      if (!target) return;
      const authorKey = job.meta.authorKey ?? 'npc:wang';
      const author = resolveAuthor(authorKey);
      const userName = resolveAuthor('user').name;

      // ---- 组装 LLM 上下文（感觉帖子内容 + 用户评论内容 + 最近对话链） ----
      let postContent = '';
      let history: { from: 'user' | 'peer'; text: string }[] = [];
      let groupId = target.id; // AI 回复挂载的分组锚点
      let replyName = resolveAuthor(target.authorKey).name;
      let parentContent = target.content; // 被回复的内容（默认=目标帖本身）

      if (job.kind === 'aiReplyBack') {
        // 用户在评论区回复了 AI：AI 回应用户的评论
        const mainId = job.meta.mainPostId ?? job.meta.rootId ?? target.id;
        const mainPost = d.posts.find((p) => p.id === mainId);
        postContent = mainPost?.content ?? '';
        groupId = job.meta.rootId ?? target.id;
        // 被回复对象 = 用户刚发的回复（AI 回应「我评论的内容」）
        const userReply = job.meta.userReplyId ? d.posts.find((p) => p.id === job.meta.userReplyId) : null;
        parentContent = userReply?.content ?? target.content;
        replyName = userName;
        // 最近对话链：分组锚点下「该 AI ↔ 用户」的最近几轮（多轮来回的上下文；
        // 排除用户刚发的这条——它已作为 parent 单独传，避免重复）
        history = d.posts
          .filter((p) => p.replyTo === groupId && (p.authorKey === authorKey || p.authorKey === 'user') && p.id !== job.meta.userReplyId)
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(-6)
          .map((p) => ({ from: p.authorKey === 'user' ? ('user' as const) : ('peer' as const), text: p.content }));
      } else {
        // NPC 回复用户的新帖
        postContent = target.content;
        parentContent = target.content;
        groupId = target.id;
        replyName = userName;
      }

      // 识图模型：帖子带图时先「看图」再回复
      const mainForMedia = d.posts.find((p) => p.id === (job.kind === 'aiReplyBack' ? (job.meta.mainPostId ?? job.meta.rootId ?? target.id) : target.id));
      const mediaDesc = await describePostMedia(mainForMedia?.media ?? target.media);

      let text = '';
      try {
        const r = (await callApi({
          kind: 'reply',
          author: { name: author.name, persona: author.persona || '' },
          parent: { authorName: replyName, content: parentContent },
          postContent,
          mediaDesc,
          history,
          userName,
        })) as { text?: string };
        text = typeof r.text === 'string' ? r.text.trim() : '';
      } catch {
        text = '';
      }
      if (!text) {
        const npc = NPC_DEFS.find((n) => `npc:${n.id}` === authorKey);
        const pool = npc ? npc.replies : ['有意思，蹲一个后续。', '这条我认可。', '顶上去让更多人看到。', '哈哈你这么一说我竟无法反驳。', '有道理，学到了。'];
        text = pool[Math.floor(Math.random() * pool.length)];
      }
      const next = { ...forumData() };
      const replyPost = basePost(authorKey, text.slice(0, REPLY_MAX), target.community, Date.now(), groupId, replyName);
      // 精确被回复对象 = 用户的回复（多轮接话定位）
      if (job.kind === 'aiReplyBack' && job.meta.userReplyId) replyPost.replyToPost = job.meta.userReplyId;
      next.posts.push(replyPost);
      next.notifications = [
        {
          id: uid('n'),
          type: 'reply',
          fromKey: authorKey,
          postId: replyPost.id,
          createdAt: replyPost.createdAt,
          read: false,
        },
        ...next.notifications,
      ];
      saveForum(next);
      return;
    }
    if (job.kind === 'dmReply') {
      const peerKey = job.postKey as AuthorKey;
      const d = forumData();
      const dm = d.dms.find((x) => x.peerKey === peerKey);
      if (!dm) return;
      const peer = resolveAuthor(peerKey);
      const history = dm.messages.slice(-8).map((m) => ({ from: m.from === 'user' ? ('user' as const) : ('peer' as const), text: m.text }));
      let text = '';
      try {
        const r = (await callApi({
          kind: 'dm',
          author: { name: peer.name, persona: peer.persona || '' },
          history,
          userName: resolveAuthor('user').name,
        })) as { text?: string };
        text = typeof r.text === 'string' ? r.text.trim() : '';
      } catch {
        text = '';
      }
      if (!text) text = ['刚看到私信，在呢在呢', '哈哈你说得对', '嗯嗯，我也是这么想的', '等我想想再回你'][Math.floor(Math.random() * 4)];
      const next = { ...forumData() };
      const target = next.dms.find((x) => x.peerKey === peerKey);
      if (!target) return;
      target.messages.push({ id: uid('m'), from: peerKey, text: text.slice(0, 160), at: Date.now() });
      saveForum(next);
      return;
    }
  } catch {
    /* 单任务失败静默 */
  }
}

// ---------------- 启动入口（App 挂载/重置后调用；幂等可重入） ----------------

let booting = false;

/** 版块同步：COMMUNITY_DEFS 新增的主题版块（娱乐八卦/影视片单/汽车俱乐部/吐槽大会）
 *  补进老数据（不动已加入状态）——存量用户不清数据也能看到新板块。 */
function syncCommunities(): void {
  try {
    const d = forumData();
    const missing = COMMUNITY_DEFS.filter((c) => !d.communities.some((x) => x.id === c.id));
    if (!missing.length) return;
    d.communities = [...d.communities, ...missing.map((c) => ({ ...c, joined: false }))];
    saveForum({ ...d });
  } catch {
    /* 静默 */
  }
}

export async function bootForum(): Promise<void> {
  if (booting) return;
  booting = true;
  try {
    await ensureSeed();
    await ensureFresh();
    syncCommunities();
    runPending();
  } catch {
    /* 引擎失败不拦 UI */
  } finally {
    booting = false;
  }
}
