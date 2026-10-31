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
 * 4. queueAiReplyToUserReply：用户回复了 AI 的帖 → 该作者延迟再回一条。
 * 5. queueDmReply：用户私信发消息 → 对方延迟回复（LLM，失败通用兜底句）。
 */

import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import {
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

/** NPC → 默认版块 */
function defaultCommunityFor(npcId: string): string | null {
  const map: Record<string, string> = {
    wang: 'digital',
    canteen: 'food',
    kitty: 'work',
    iron: 'fit',
    boat: 'travel',
    abacus: 'work',
    kai: 'game',
  };
  const v = map[npcId];
  return v === undefined ? null : v;
}

/** 池内 #话题# → 版块 id */
const NPC_COMMUNITY_MAP: Record<string, string> = {
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
    const r = (await callApi({ kind: 'posts', items: items.map(({ name, persona, community }) => ({ name, persona, community })), avoid, userName: resolveAuthor('user').name })) as { items?: string[] };
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
 *  postId 传主帖 id → AI 的回复挂主帖下（顶层评论）；
 *  传评论 id → 挂在该评论下（微信式嵌套子回复）。 */
export function queueAiReplyToUserReply(postId: string, userReplyId: string): void {
  const d = forumData();
  const parent = d.posts.find((p) => p.id === postId);
  if (!parent || parent.authorKey === 'user') return;
  if (!d.posts.find((p) => p.id === userReplyId)) return;
  addPending({
    id: uid('j'),
    due: Date.now() + 6000 + Math.random() * 9000,
    kind: 'aiReplyBack',
    postKey: postId,
    meta: { authorKey: parent.authorKey, parentContent: parent.content },
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
      let text = '';
      try {
        const r = (await callApi({
          kind: 'reply',
          author: { name: author.name, persona: author.persona || '' },
          parent: { authorName: resolveAuthor(target.authorKey).name, content: target.content },
          userName: resolveAuthor('user').name,
        })) as { text?: string };
        text = typeof r.text === 'string' ? r.text.trim() : '';
      } catch {
        text = '';
      }
      if (!text) {
        const npc = NPC_DEFS.find((n) => `npc:${n.id}` === authorKey);
        const pool = npc ? npc.replies : ['有意思，蹲一个后续。', '这条我认可。', '顶上去让更多人看到。'];
        text = pool[Math.floor(Math.random() * pool.length)];
      }
      const next = { ...forumData() };
      // aiReplyBack：AI 回复的是「用户」的评论，replyToName 用用户名（微信式「A 回复 用户：…」）；
      // replyToUserPost：NPC 回复用户的新帖，replyToName 取被回帖作者（即用户）。
      const replyName =
        job.kind === 'aiReplyBack' ? resolveAuthor('user').name : resolveAuthor(target.authorKey).name;
      const replyPost = basePost(authorKey, text.slice(0, REPLY_MAX), target.community, Date.now(), target.id, replyName);
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

export async function bootForum(): Promise<void> {
  if (booting) return;
  booting = true;
  try {
    await ensureSeed();
    await ensureFresh();
    runPending();
  } catch {
    /* 引擎失败不拦 UI */
  } finally {
    booting = false;
  }
}
