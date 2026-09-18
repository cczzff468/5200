'use client';

/**
 * 朋友圈 / QQ动态 统一引擎（AI 发动态 × 动态互动 × 动态与记忆双向打通）。
 *
 * 设计要点：
 * - 数据继续存在各自 App 的既有键里（wx-moments / qq-zone-posts + qq-zone-comments，IndexedDB kv），
 *   本模块把它们归一化为统一的 MomentPostView（平台无关），UI 与 AI 流程只面向统一视图；
 *   旧数据原位兼容读取：author 用显式字段，缺省按「authorName 是否等于机主名」推断；
 *   新写入一律带显式 author/peerId/parentId/createdAt 字段（无损往返）。
 * - 每条动态/评论带 peerId（AI 角色联系人 id）：不同角色的动态与记忆按联系人 ID 隔离（六.2）；
 *   用户广播动态 peerId=null（朋友圈语义：所有好友可见）。
 * - 动态 → 记忆（三）：角色发动态/点赞/评论/回复时，立即给「该角色」写一条 source='moments'
 *   的记忆碎片（带 sourcePostId 追溯，走 appendFragments 同款去重合并管线）；
 *   用户广播动态由「看到它的角色」入记忆：互动发生时写入 + 聊天注入块懒写入（见 buildMomentsChatBlock），
 *   避免把每条动态复制进所有角色的记忆库（记忆去重/权重不受污染）。
 * - 视角统一：记忆碎片一律用「机主真实名字 + 角色真实名字」指代（动态展示名可以用昵称，
 *   写记忆前异步换回真实名字，与聊天记忆同规则）。
 * - 记忆 → 动态（一.4）：AI 发动态/评论的内容基于 persona + 最近聊天（memRecentConvo）+ 记忆库
 *   （listFragments）生成，不同角色人设不同 → 风格天然不同（一.5）。
 * - 聊天 → 动态感知（四）：buildMomentsChatBlock 组装「最近发过的动态 + 相关互动」注入私聊 system，
 *   标注「这是动态内容不是私聊」；互通开关关闭时只注入当前 App 对应平台的动态（六.3）。
 * - AI 自动发布三种触发（一.6）：定时（每天 HH:mm）/ 频率（每隔 N 小时）/ 聊天灵感（累计聊天轮次
 *   达阈值且冷却期已过），由全局调度（MomentsScheduler 每 5s tick）驱动，漏检自动补发；
 *   失败按 10 分钟退避重试，绝不阻塞 UI。
 * - AI 互动（二）：用户发动态后进延迟队列（8~18s 后由调度结算：1-2 位平台好友点赞+评论）；
 *   用户回复 AI 评论 → 延迟 3~8s 生成 AI 的再回复（多轮，parentId 串链）；
 *   队列持久化在 kv，重启后仍会结算（二.5 持久化）。
 */

import { kvGet, kvSet, kvDel } from '@/lib/ios/idb-kv';
import { displayNameOf, isFriendIn, type ContactRecord } from '@/lib/contacts';
import type { ApiConfig } from '@/lib/ios/store';
import { contactRealName, listContacts, ownerRealName } from '@/lib/ios/contacts-store';
import {
  getMemSettings,
  listFragments,
  memAddMomentFragment,
  memHasMomentFragment,
  memPurgeMomentSources,
  memRecentConvo,
  type MemApp,
} from '@/lib/memory';

// ---------------- 统一数据模型（视图层） ----------------

export type MomentPlatform = 'wx' | 'qq';
export type MomentAuthor = 'user' | 'char';

export interface MomentLikeView {
  name: string;
  author: MomentAuthor;
  /** char 点赞时 = 该角色联系人 id（legacy 数据可能为 null） */
  peerId: string | null;
  time: number;
}

export interface MomentCommentView {
  id: string;
  author: MomentAuthor;
  authorName: string;
  /** char 评论时 = 该角色联系人 id（legacy 数据可能为 null） */
  peerId: string | null;
  content: string;
  createdAt: number;
  /** 多轮回复：父评论 id（根评论为 null） */
  parentId: string | null;
  /** 展示用「回复@某人」的名字 */
  replyToName: string | null;
}

export interface MomentPostView {
  id: string;
  platform: MomentPlatform;
  author: MomentAuthor;
  authorName: string;
  avatar: string | null;
  /** char 发的动态 = 该角色联系人 id；用户广播动态 = null */
  peerId: string | null;
  content: string;
  images: string[];
  createdAt: number;
  likes: MomentLikeView[];
  comments: MomentCommentView[];
}

/** 平台中文标签（prompt/记忆标注用） */
export const MOMENT_PLATFORM_LABEL: Record<MomentPlatform, string> = { wx: '朋友圈', qq: 'QQ动态' };

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function isMomentPlatform(v: unknown): v is MomentPlatform {
  return v === 'wx' || v === 'qq';
}

// ---------------- 底层存储适配（保持旧键旧形状，原位兼容） ----------------

const WX_MOMENTS_KEY = 'wx-moments';
const QQ_POSTS_KEY = 'qq-zone-posts';
const QQ_COMMENTS_KEY = 'qq-zone-comments';
/** 各平台机主展示名（写入时记住，legacy 数据作者推断用） */
const USER_NAMES_KEY = 'moments-user-names';
/** 互动/回复延迟队列 */
const QUEUE_KEY = 'moments-queue';
/** 每角色×平台自动发布设置 */
const AUTO_CFG_KEY = 'moments-auto-cfg';
/** 自动发布失败退避 */
const attemptKey = (contactId: string, platform: MomentPlatform) => `moments-auto-attempt:${contactId}:${platform}`;

/** 动态变更事件：引擎每次落盘后广播，动态页监听刷新（调度器在页面外写数据也能实时同步 UI） */
export function emitMomentsChanged(platform?: MomentPlatform): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('moments-changed', { detail: { platform: platform ?? null } }));
    }
  } catch {
    // 忽略
  }
}

/** 订阅动态变更（返回退订函数） */
export function subscribeMomentsChanged(fn: (platform: MomentPlatform | null) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (e: Event) => {
    const d = (e as CustomEvent).detail as { platform?: MomentPlatform | null } | null;
    fn(d && isMomentPlatform(d.platform) ? d.platform : null);
  };
  window.addEventListener('moments-changed', handler);
  return () => window.removeEventListener('moments-changed', handler);
}

// 旧形状（微信 WxMoment / QQ ZonePost+ZoneComment 的最小读取形状，全部宽容可选）

interface WxRawComment {
  id?: unknown;
  author?: unknown;
  text?: unknown;
  time?: unknown;
  replyTo?: unknown;
  authorKind?: unknown;
  peerId?: unknown;
  parentId?: unknown;
  createdAt?: unknown;
}
interface WxRawPost {
  id?: unknown;
  authorName?: unknown;
  avatar?: unknown;
  text?: unknown;
  images?: unknown;
  time?: unknown;
  likes?: unknown;
  comments?: unknown;
  author?: unknown;
  peerId?: unknown;
}
interface QqRawComment {
  id?: unknown;
  author?: unknown;
  content?: unknown;
  time?: unknown;
  replyTo?: unknown;
  authorKind?: unknown;
  peerId?: unknown;
  parentId?: unknown;
  createdAt?: unknown;
}
interface QqRawPost {
  id?: unknown;
  authorName?: unknown;
  avatar?: unknown;
  content?: unknown;
  time?: unknown;
  likedBy?: unknown;
  images?: unknown;
  author?: unknown;
  peerId?: unknown;
  createdAt?: unknown;
}

const PLATFORM_USER_NAMES: Record<MomentPlatform, string> = { wx: '', qq: '' };

let userNamesLoaded = false;

function loadUserNames(): void {
  if (userNamesLoaded) return;
  userNamesLoaded = true;
  try {
    const raw = kvGet<Partial<Record<MomentPlatform, string>>>(USER_NAMES_KEY);
    if (raw && typeof raw === 'object') {
      if (typeof raw.wx === 'string') PLATFORM_USER_NAMES.wx = raw.wx;
      if (typeof raw.qq === 'string') PLATFORM_USER_NAMES.qq = raw.qq;
    }
  } catch {
    // 忽略
  }
}

/** 记住机主在某平台的展示名（写操作时调用；legacy 数据作者推断用，读操作不回写） */
export function rememberMomentUserName(platform: MomentPlatform, name: string): void {
  if (!name || PLATFORM_USER_NAMES[platform] === name) return;
  loadUserNames();
  PLATFORM_USER_NAMES[platform] = name;
  try {
    kvSet(USER_NAMES_KEY, { wx: PLATFORM_USER_NAMES.wx, qq: PLATFORM_USER_NAMES.qq });
  } catch {
    // 忽略
  }
}

/** 作者类型：显式字段优先；缺省按名字推断（机主名命中 = user，否则 char） */
function authorOf(name: string, explicit: unknown, userNames: string[]): MomentAuthor {
  if (explicit === 'user' || explicit === 'char') return explicit;
  return userNames.includes(name) ? 'user' : 'char';
}

/** QQ 空间旧数据的 "MM-DD HH:mm" 展示串 → 时间戳（本年；解析失败 null） */
function qqTimeToTs(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = new Date().getFullYear();
  return new Date(y, Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4])).getTime();
}

/** 时间戳 → QQ 空间展示串 */
function qqTsToTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * 读某平台全部动态（统一视图）。
 * userName = 机主展示名（作者推断候选之一；与记住的各平台机主名一起参与 legacy 推断）。
 * contacts 用于把 legacy 数据的 char 名字解析成 peerId（可省，省时 peerId 可能 null）。
 */
export function listMomentPosts(
  platform: MomentPlatform,
  userName?: string,
  contacts?: Pick<ContactRecord, 'id' | 'name' | 'nickname'>[]
): MomentPostView[] {
  loadUserNames();
  const userNames = Array.from(new Set([userName ?? '', PLATFORM_USER_NAMES[platform]].filter(Boolean)));
  /** legacy char 名字 → 联系人 id（展示名/真名都认） */
  const peerIdByName = (name: string): string | null => {
    if (!contacts) return null;
    const hit = contacts.find((c) => displayNameOf(c) === name || c.name === name);
    return hit?.id ?? null;
  };
  try {
    if (platform === 'wx') {
      const raw = kvGet<WxRawPost[]>(WX_MOMENTS_KEY);
      if (!Array.isArray(raw)) return [];
      const out: MomentPostView[] = [];
      for (const p of raw) {
        if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.time !== 'number') continue;
        const createdAt: number = p.time;
        const authorName = str(p.authorName, '微信用户');
        const author = authorOf(authorName, p.author, userNames);
        const commentsRaw = Array.isArray(p.comments) ? p.comments : [];
        out.push({
          id: p.id,
          platform,
          author,
          authorName,
          avatar: typeof p.avatar === 'string' ? p.avatar : null,
          peerId: typeof p.peerId === 'string' ? p.peerId : author === 'char' ? peerIdByName(authorName) : null,
          content: str(p.text),
          images: strArr(p.images),
          createdAt,
          likes: strArr(p.likes).map((name) => ({
            name,
            author: authorOf(name, undefined, userNames),
            peerId: peerIdByName(name),
            time: createdAt,
          })),
          comments: commentsRaw
            .filter((c): c is WxRawComment => Boolean(c) && typeof c === 'object')
            .map((c) => {
              const nm = str(c.author);
              const kind = authorOf(nm, c.authorKind, userNames);
              const rawReplyTo = typeof c.replyTo === 'string' ? c.replyTo : null;
              // 旧版遗留修复（一.1）：AI「回复自己」（replyTo 是自己的名字）是历史 bug 数据，读出来时摘掉错误指向，降为独立评论
              const selfReply = kind === 'char' && rawReplyTo !== null && rawReplyTo === nm;
              return {
                id: str(c.id) || uid(),
                author: kind,
                authorName: nm,
                peerId: typeof c.peerId === 'string' ? c.peerId : kind === 'char' ? peerIdByName(nm) : null,
                content: str(c.text),
                createdAt:
                  typeof c.createdAt === 'number' ? c.createdAt : typeof c.time === 'number' ? c.time : createdAt,
                parentId: selfReply ? null : typeof c.parentId === 'string' ? c.parentId : null,
                replyToName: selfReply ? null : rawReplyTo,
              };
            }),
        });
      }
      return out.sort((a, b) => b.createdAt - a.createdAt);
    }
    const raw = kvGet<QqRawPost[]>(QQ_POSTS_KEY);
    if (!Array.isArray(raw)) return [];
    const rawComments = kvGet<Record<string, QqRawComment[]>>(QQ_COMMENTS_KEY);
    const cmap: Record<string, QqRawComment[]> =
      rawComments && typeof rawComments === 'object' && !Array.isArray(rawComments) ? rawComments : {};
    const out: MomentPostView[] = [];
    for (const p of raw) {
      if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.content !== 'string') continue;
      const authorName = str(p.authorName, 'QQ用户');
      const author = authorOf(authorName, p.author, userNames);
      const createdAt = typeof p.createdAt === 'number' ? p.createdAt : (qqTimeToTs(p.time) ?? Date.now());
      const comments = (Array.isArray(cmap[p.id]) ? cmap[p.id] : [])
        .filter((c): c is QqRawComment => Boolean(c) && typeof c === 'object')
        .map((c) => {
          const nm = str(c.author);
          const kind = authorOf(nm, c.authorKind, userNames);
          const rawReplyTo = typeof c.replyTo === 'string' ? c.replyTo : null;
          // 同微信分支：AI「回复自己」的历史 bug 数据读时修复
          const selfReply = kind === 'char' && rawReplyTo !== null && rawReplyTo === nm;
          return {
            id: str(c.id) || uid(),
            author: kind,
            authorName: nm,
            peerId: typeof c.peerId === 'string' ? c.peerId : kind === 'char' ? peerIdByName(nm) : null,
            content: str(c.content),
            createdAt: typeof c.createdAt === 'number' ? c.createdAt : (qqTimeToTs(c.time) ?? createdAt),
            parentId: selfReply ? null : typeof c.parentId === 'string' ? c.parentId : null,
            replyToName: selfReply ? null : rawReplyTo,
          };
        });
      out.push({
        id: p.id,
        platform,
        author,
        authorName,
        avatar: typeof p.avatar === 'string' ? p.avatar : null,
        peerId: typeof p.peerId === 'string' ? p.peerId : author === 'char' ? peerIdByName(authorName) : null,
        content: p.content,
        images: strArr(p.images),
        createdAt,
        likes: strArr(p.likedBy).map((name) => ({
          name,
          author: authorOf(name, undefined, userNames),
          peerId: peerIdByName(name),
          time: createdAt,
        })),
        comments,
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** 写回某平台全部动态（旧形状 + 引擎扩展字段，无损往返） */
function persistMomentPosts(platform: MomentPlatform, posts: MomentPostView[]): void {
  try {
    if (platform === 'wx') {
      const raw = posts.slice(0, 200).map((p) => ({
        id: p.id,
        authorName: p.authorName,
        avatar: p.avatar,
        text: p.content,
        images: p.images,
        time: p.createdAt,
        author: p.author,
        peerId: p.peerId ?? undefined,
        likes: p.likes.map((l) => l.name),
        comments: p.comments.map((c) => ({
          id: c.id,
          author: c.authorName,
          text: c.content,
          time: c.createdAt,
          replyTo: c.replyToName,
          authorKind: c.author,
          peerId: c.peerId ?? undefined,
          parentId: c.parentId ?? undefined,
          createdAt: c.createdAt,
        })),
      }));
      kvSet(WX_MOMENTS_KEY, raw);
    } else {
      const cmap: Record<string, unknown[]> = {};
      const raw = posts.slice(0, 200).map((p) => {
        cmap[p.id] = p.comments.map((c) => ({
          id: c.id,
          author: c.authorName,
          content: c.content,
          time: qqTsToTime(c.createdAt),
          replyTo: c.replyToName ?? undefined,
          authorKind: c.author,
          peerId: c.peerId ?? undefined,
          parentId: c.parentId ?? undefined,
          createdAt: c.createdAt,
        }));
        return {
          id: p.id,
          authorName: p.authorName,
          avatar: p.avatar,
          content: p.content,
          time: qqTsToTime(p.createdAt),
          likedBy: p.likes.map((l) => l.name),
          images: p.images,
          author: p.author,
          peerId: p.peerId ?? undefined,
          createdAt: p.createdAt,
        };
      });
      kvSet(QQ_POSTS_KEY, raw);
      kvSet(QQ_COMMENTS_KEY, cmap);
    }
    emitMomentsChanged(platform);
  } catch {
    // 存储失败静默（动态是增强能力）
  }
}

// ---------------- 角色匹配小工具 ----------------

/** 该动态是否由这个联系人发布（peerId 优先，legacy 数据按展示名/真名兜底） */
export function isPostByPeer(
  post: Pick<MomentPostView, 'author' | 'peerId' | 'authorName'>,
  peer: Pick<ContactRecord, 'id' | 'name' | 'nickname'>
): boolean {
  if (post.author !== 'char') return false;
  if (post.peerId && post.peerId === peer.id) return true;
  return post.authorName === displayNameOf(peer) || post.authorName === peer.name;
}

/** 该互动（点赞/评论）是否由这个联系人发出 */
function isInteractionByPeer(
  x: { author: MomentAuthor; peerId: string | null; authorName?: string; name?: string },
  peer: Pick<ContactRecord, 'id' | 'name' | 'nickname'>
): boolean {
  if (x.author !== 'char') return false;
  if (x.peerId && x.peerId === peer.id) return true;
  const nm = x.authorName ?? x.name ?? '';
  return nm === displayNameOf(peer) || nm === peer.name;
}

/** 平台 → 记忆 App 标记（动态来源记忆的 app 字段：互通关闭时按平台过滤召回） */
function platformApp(platform: MomentPlatform): MemApp {
  return platform === 'wx' ? 'wx' : 'qq';
}

// ---------------- 动态 → 记忆（异步解析真实名字后入库，fire-and-forget） ----------------

/**
 * 记忆事实（展示名传入，真实名字在入库前解析替换——与聊天记忆的视角统一规则一致）。
 * shape 决定记忆句式：
 * - char-post：{peer}发了一条{平台}：「detail」
 * - user-post：{user}发了一条{平台}：「detail」{extra（该角色的互动摘要）}
 * - like：{peer}给{user}的{平台}动态点了赞（动态：「postDetail」）
 * - char-comment：{peer}评论了{user}的{平台}动态：「detail」（动态：「postDetail」）
 * - char-reply：{peer}回复了{user}的评论：「detail」（动态：「postDetail」）
 * - user-comment：{user}评论了{peer}的{平台}动态：「detail」
 * - user-reply：{user}回复了{peer}的评论：「detail」（动态：「postDetail」）
 */
interface MomentMemoryFact {
  peerId: string;
  platform: MomentPlatform;
  postId: string;
  commentId?: string;
  sourceTime?: number;
  shape: 'char-post' | 'user-post' | 'like' | 'char-comment' | 'char-reply' | 'user-comment' | 'user-reply';
  peerDisplay: string;
  userName: string;
  detail: string;
  postDetail?: string;
  extra?: string;
}

function memoryContentOf(f: MomentMemoryFact, peerReal: string, userReal: string): string {
  const peer = peerReal || f.peerDisplay || '对方';
  const user = userReal || f.userName || '用户';
  const label = MOMENT_PLATFORM_LABEL[f.platform];
  switch (f.shape) {
    case 'char-post':
      return `${peer}发了一条${label}：「${f.detail}」`;
    case 'user-post':
      return `${user}发了一条${label}：「${f.detail}」${f.extra ?? ''}`;
    case 'like':
      return `${peer}给${user}的${label}动态点了赞（动态：「${f.postDetail ?? f.detail}」）`;
    case 'char-comment':
      return `${peer}评论了${user}的${label}动态：「${f.detail}」${f.postDetail ? `（动态：「${f.postDetail}」）` : ''}`;
    case 'char-reply':
      return `${peer}回复了${user}的评论：「${f.detail}」${f.postDetail ? `（动态：「${f.postDetail}」）` : ''}`;
    case 'user-comment':
      return `${user}评论了${peer}的${label}动态：「${f.detail}」`;
    case 'user-reply':
      return `${user}回复了${peer}的评论：「${f.detail}」${f.postDetail ? `（动态：「${f.postDetail}」）` : ''}`;
  }
}

/** 写入该角色的动态记忆：真实名字异步解析 → memAddMomentFragment（失败静默，不阻塞 UI） */
function writeMomentMemory(fact: MomentMemoryFact): void {
  if (!fact.peerId) return;
  void (async () => {
    try {
      const [peerReal, userReal] = await Promise.all([contactRealName(fact.peerId), ownerRealName()]);
      const content = memoryContentOf(fact, peerReal, userReal);
      memAddMomentFragment(
        fact.peerId,
        platformApp(fact.platform),
        content,
        { postId: fact.postId, kind: fact.shape === 'like' ? 'like' : fact.shape === 'char-post' || fact.shape === 'user-post' ? 'post' : 'comment', commentId: fact.commentId },
        fact.sourceTime
      );
    } catch {
      // 记忆是增强能力，失败静默
    }
  })();
}

// ---------------- 读写操作（UI 与调度器统一入口；每次变更后广播 moments-changed） ----------------

/** 用户发一条动态（广播：peerId=null；记忆由「看到它的角色」在互动/聊天时入库，见 buildMomentsChatBlock） */
export function addUserMomentPost(
  platform: MomentPlatform,
  args: { userName: string; avatar: string | null; content: string; images?: string[] }
): MomentPostView {
  rememberMomentUserName(platform, args.userName);
  const post: MomentPostView = {
    id: uid(),
    platform,
    author: 'user',
    authorName: args.userName,
    avatar: args.avatar,
    peerId: null,
    content: args.content,
    images: args.images ?? [],
    createdAt: Date.now(),
    likes: [],
    comments: [],
  };
  const list = listMomentPosts(platform, args.userName);
  persistMomentPosts(platform, [post, ...list]);
  return post;
}

/**
 * 角色发一条动态（手动「让TA发一条」/ 自动发布共用；发布即写该角色记忆——三.3）。
 * writeMemory=false 用于示例动态补齐（不是真实的「TA 发了」，不入记忆）。
 */
export function addCharMomentPost(
  platform: MomentPlatform,
  args: {
    peer: Pick<ContactRecord, 'id' | 'name' | 'nickname' | 'avatar'>;
    userName: string;
    content: string;
    images?: string[];
    /** 补示例动态时传（不入记忆） */
    writeMemory?: boolean;
    /** 示例动态的回溯时间 */
    createdAt?: number;
  }
): MomentPostView {
  rememberMomentUserName(platform, args.userName);
  const createdAt = args.createdAt ?? Date.now();
  const post: MomentPostView = {
    id: uid(),
    platform,
    author: 'char',
    authorName: displayNameOf(args.peer),
    avatar: args.peer.avatar,
    peerId: args.peer.id,
    content: args.content,
    images: args.images ?? [],
    createdAt,
    likes: [],
    comments: [],
  };
  const list = listMomentPosts(platform, args.userName);
  persistMomentPosts(platform, [post, ...list]);
  if (args.writeMemory !== false) {
    writeMomentMemory({
      peerId: args.peer.id,
      platform,
      postId: post.id,
      sourceTime: createdAt,
      shape: 'char-post',
      peerDisplay: displayNameOf(args.peer),
      userName: args.userName,
      detail: args.content.slice(0, 80),
    });
  }
  return post;
}

/** 编辑动态内容（用户改动态；自己的和 AI 的都允许改——手机是用户的） */
export function updateMomentPostContent(platform: MomentPlatform, postId: string, userName: string, content: string): boolean {
  const list = listMomentPosts(platform, userName);
  const hit = list.find((p) => p.id === postId);
  const text = content.trim();
  if (!hit || !text) return false;
  persistMomentPosts(platform, list.map((p) => (p.id === postId ? { ...p, content: text } : p)));
  return true;
}

/**
 * 级联清理该动态/评论在各角色记忆里留下的「动态来源」碎片（六.3：删了动态/评论，
 * AI 不该再在聊天里记得「你发过那条/我评论过那条」）。异步批量执行，不阻塞 UI。
 */
function purgeMomentMemories(filter: { postId: string; commentId?: string }): void {
  void (async () => {
    try {
      const contacts = await listContacts();
      for (const c of contacts) memPurgeMomentSources(c.id, filter);
    } catch {
      // 记忆清理是增强能力，失败静默
    }
  })();
}

/** 删除动态（含评论/点赞、队列里的相关待处理项与各角色记忆里的相关碎片） */
export function deleteMomentPost(platform: MomentPlatform, postId: string, userName: string): boolean {
  const list = listMomentPosts(platform, userName);
  if (!list.some((p) => p.id === postId)) return false;
  persistMomentPosts(platform, list.filter((p) => p.id !== postId));
  try {
    const q = loadQueueSafe().filter((item) => item.postId !== postId);
    saveQueue(q);
  } catch {
    // 忽略
  }
  purgeMomentMemories({ postId });
  return true;
}

/** 用户点赞/取消点赞（自己的点赞行为，不入角色记忆） */
export function toggleUserMomentLike(platform: MomentPlatform, postId: string, userName: string): void {
  rememberMomentUserName(platform, userName);
  const list = listMomentPosts(platform, userName);
  persistMomentPosts(
    platform,
    list.map((p) => {
      if (p.id !== postId) return p;
      const liked = p.likes.some((l) => l.name === userName);
      return {
        ...p,
        likes: liked
          ? p.likes.filter((l) => l.name !== userName)
          : [...p.likes, { name: userName, author: 'user' as const, peerId: null, time: Date.now() }],
      };
    })
  );
}

/** 角色点赞（调度器 AI 互动用；写入该角色记忆——三.4） */
export function addCharMomentLike(
  platform: MomentPlatform,
  postId: string,
  args: { peer: Pick<ContactRecord, 'id' | 'name' | 'nickname' | 'avatar'>; userName: string }
): boolean {
  rememberMomentUserName(platform, args.userName);
  const list = listMomentPosts(platform, args.userName);
  const post = list.find((p) => p.id === postId);
  if (!post || post.likes.some((l) => l.peerId === args.peer.id || l.name === displayNameOf(args.peer))) return false;
  persistMomentPosts(
    platform,
    list.map((p) =>
      p.id === postId
        ? { ...p, likes: [...p.likes, { name: displayNameOf(args.peer), author: 'char' as const, peerId: args.peer.id, time: Date.now() }] }
        : p
    )
  );
  writeMomentMemory({
    peerId: args.peer.id,
    platform,
    postId,
    sourceTime: post.createdAt,
    shape: 'like',
    peerDisplay: displayNameOf(args.peer),
    userName: args.userName,
    detail: post.content.slice(0, 40),
    postDetail: post.content.slice(0, 40),
  });
  return true;
}

/**
 * 用户评论（replyTo 传被回复评论的 id+名字，可多轮）。
 * 记忆写入规则（三.2）：评论对象能落到具体角色时（评论的是角色的动态 / 回复的是角色的评论），
 * 给该角色写一条 source='moments' 的记忆；纯广播动态下的独立评论没有唯一受众，不入库
 * （聊天时由注入块兜底呈现）。若被回复方是 AI 角色，自动排一条 AI 回复进队列（二.3 多轮）。
 * 返回新评论（未找到目标动态返回 null）。
 */
export function addUserMomentComment(
  platform: MomentPlatform,
  postId: string,
  args: { userName: string; content: string; replyTo?: { commentId?: string | null; name?: string | null } }
): MomentCommentView | null {
  rememberMomentUserName(platform, args.userName);
  const text = args.content.trim();
  if (!text) return null;
  const list = listMomentPosts(platform, args.userName);
  const post = list.find((p) => p.id === postId);
  if (!post) return null;
  const parent = args.replyTo?.commentId ? (post.comments.find((c) => c.id === args.replyTo?.commentId) ?? null) : null;
  const replyToName = parent ? parent.authorName : (args.replyTo?.name ?? null);
  const comment: MomentCommentView = {
    id: uid(),
    author: 'user',
    authorName: args.userName,
    peerId: null,
    content: text,
    createdAt: Date.now(),
    parentId: parent ? parent.id : null,
    replyToName,
  };
  persistMomentPosts(
    platform,
    list.map((p) => (p.id === postId ? { ...p, comments: [...p.comments, comment] } : p))
  );
  // 记忆对象：回复的角色评论 → 那个角色；评论角色本人的动态 → 那个角色
  const targetPeerId = parent?.peerId ?? (post.author === 'char' ? post.peerId : null);
  if (targetPeerId) {
    writeMomentMemory({
      peerId: targetPeerId,
      platform,
      postId,
      commentId: comment.id,
      sourceTime: post.createdAt,
      shape: parent ? 'user-reply' : 'user-comment',
      peerDisplay: parent?.authorName ?? post.authorName,
      userName: args.userName,
      detail: text.slice(0, 40),
      postDetail: post.content.slice(0, 40),
    });
  }
  // AI 回复排队（二.1/二.3）：回复的是 AI 的评论 → 那个 AI 来回（多轮）；
  // 顶层评论的是角色本人的动态 → 动态作者也来回复用户（AI 发的动态，用户评论后 TA 会回）。
  // 队列里带「用户的这条评论」id（不是 AI 的父评论）：AI 的是在回复用户这句话，
  // replyTo 展示名/prompt 指代才会是用户（而非 AI 自己），parentId 也串在用户评论下
  const replyPeerId = parent
    ? parent.author === 'char'
      ? parent.peerId
      : null
    : post.author === 'char'
      ? post.peerId
      : null;
  if (replyPeerId) {
    enqueueCharReply(platform, postId, replyPeerId, comment.id, args.userName);
  }
  return comment;
}

/**
 * 角色评论/回复（AI 互动与 AI 回复共用；写入该角色记忆——三.4）。
 * 防重复（一.4）：同一条动态下已有一模一样的内容（任何人发的）→ 拒绝写入，
 * 保证「不同角色内容互异 / 同角色不重复」在数据层硬性成立（生成撞车/重试也不会出现重复评论）。
 */
export function addCharMomentComment(
  platform: MomentPlatform,
  postId: string,
  args: {
    peer: Pick<ContactRecord, 'id' | 'name' | 'nickname' | 'avatar'>;
    userName: string;
    content: string;
    /** 回复目标（用户或角色的评论 id+名字） */
    replyTo?: { commentId: string; name: string } | null;
    writeMemory?: boolean;
  }
): MomentCommentView | null {
  rememberMomentUserName(platform, args.userName);
  const text = args.content.trim();
  if (!text) return null;
  const list = listMomentPosts(platform, args.userName);
  const post = list.find((p) => p.id === postId);
  if (!post) return null;
  if (post.comments.some((c) => c.content.trim() === text)) return null; // 已有一模一样的内容 → 不重复写入
  const comment: MomentCommentView = {
    id: uid(),
    author: 'char',
    authorName: displayNameOf(args.peer),
    peerId: args.peer.id,
    content: text,
    createdAt: Date.now(),
    parentId: args.replyTo?.commentId ?? null,
    replyToName: args.replyTo?.name ?? null,
  };
  persistMomentPosts(
    platform,
    list.map((p) => (p.id === postId ? { ...p, comments: [...p.comments, comment] } : p))
  );
  if (args.writeMemory !== false) {
    writeMomentMemory({
      peerId: args.peer.id,
      platform,
      postId,
      commentId: comment.id,
      sourceTime: post.createdAt,
      shape: args.replyTo ? 'char-reply' : 'char-comment',
      peerDisplay: displayNameOf(args.peer),
      userName: args.userName,
      detail: text.slice(0, 40),
      postDetail: post.content.slice(0, 40),
    });
  }
  return comment;
}

/** 删除一条评论（长按删除；任何人的评论都可删——手机是用户的。其下全部后代回复、相关队列回复与记忆碎片一并清掉） */
export function deleteMomentComment(platform: MomentPlatform, postId: string, commentId: string, userName: string): boolean {
  const list = listMomentPosts(platform, userName);
  const post = list.find((p) => p.id === postId);
  if (!post || !post.comments.some((c) => c.id === commentId)) return false;
  // 递归收集全部后代评论（回复的回复…）一并删除
  const removed = new Set<string>([commentId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of post.comments) {
      if (c.parentId && removed.has(c.parentId) && !removed.has(c.id)) {
        removed.add(c.id);
        grew = true;
      }
    }
  }
  persistMomentPosts(
    platform,
    list.map((p) => (p.id === postId ? { ...p, comments: p.comments.filter((c) => !removed.has(c.id)) } : p))
  );
  try {
    const q = loadQueueSafe().filter((item) => item.type !== 'reply' || !removed.has(item.parentCommentId));
    saveQueue(q);
  } catch {
    // 忽略
  }
  purgeMomentMemories({ postId, commentId });
  return true;
}

// ---------------- 延迟队列（AI 互动 / AI 回复；持久化，重启不丢） ----------------

interface MomentQueueInteract {
  type: 'interact';
  id: string;
  platform: MomentPlatform;
  postId: string;
  fireAt: number;
  tries: number;
}
interface MomentQueueReply {
  type: 'reply';
  id: string;
  platform: MomentPlatform;
  postId: string;
  peerId: string;
  parentCommentId: string;
  /** 触发本次回复的机主展示名（生成 prompt 用） */
  userName: string;
  fireAt: number;
  tries: number;
}
type MomentQueueItem = MomentQueueInteract | MomentQueueReply;

function loadQueueSafe(): MomentQueueItem[] {
  try {
    const raw = kvGet<MomentQueueItem[]>(QUEUE_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (x): x is MomentQueueItem =>
        Boolean(x) &&
        typeof x === 'object' &&
        (x.type === 'interact' || x.type === 'reply') &&
        typeof x.postId === 'string' &&
        isMomentPlatform(x.platform)
    );
  } catch {
    return [];
  }
}

function saveQueue(list: MomentQueueItem[]): void {
  try {
    kvSet(QUEUE_KEY, list.slice(-40));
  } catch {
    // 忽略
  }
}

/** 用户发了新动态：8~18 秒后由调度结算（1-2 位平台好友来点赞/评论，像真人刷到） */
export function enqueuePostInteractions(platform: MomentPlatform, postId: string): void {
  const q = loadQueueSafe();
  if (q.some((x) => x.type === 'interact' && x.postId === postId)) return;
  q.push({
    type: 'interact',
    id: uid(),
    platform,
    postId,
    fireAt: Date.now() + 8_000 + Math.floor(Math.random() * 10_000),
    tries: 0,
  });
  saveQueue(q);
}

/** 用户回复了 AI 的评论：3~8 秒后生成 AI 的再回复（多轮互动） */
export function enqueueCharReply(
  platform: MomentPlatform,
  postId: string,
  peerId: string,
  parentCommentId: string,
  userName: string
): void {
  const q = loadQueueSafe();
  if (q.some((x) => x.type === 'reply' && x.parentCommentId === parentCommentId)) return;
  q.push({
    type: 'reply',
    id: uid(),
    platform,
    postId,
    peerId,
    parentCommentId,
    userName,
    fireAt: Date.now() + 3_000 + Math.floor(Math.random() * 5_000),
    tries: 0,
  });
  saveQueue(q);
}

// ---------------- 自动发布设置（每角色 × 每平台） ----------------

export interface MomentAutoCfg {
  /** 自动发动态总开关 */
  enabled: boolean;
  /** 触发方式（一.6 三选一）：定时 / 频率 / 聊天灵感（基于最近聊天和记忆有感而发） */
  trigger: 'schedule' | 'interval' | 'chat';
  /** schedule 模式：每天 HH:mm */
  hh: number;
  mm: number;
  /** interval 模式：每隔 N 小时 */
  intervalHours: number;
}

export const DEFAULT_MOMENT_AUTO_CFG: MomentAutoCfg = {
  enabled: false,
  trigger: 'schedule',
  hh: 21,
  mm: 0,
  intervalHours: 24,
};

export const MOMENT_INTERVAL_OPTIONS = [1, 2, 3, 6, 12, 24, 48, 72];

function loadAutoCfgMap(): Record<string, MomentAutoCfg> {
  try {
    const raw = kvGet<Record<string, MomentAutoCfg>>(AUTO_CFG_KEY);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw;
  } catch {
    return {};
  }
}

const cfgKeyOf = (contactId: string, platform: MomentPlatform) => `${contactId}:${platform}`;

export function getMomentAutoCfg(contactId: string, platform: MomentPlatform): MomentAutoCfg {
  const raw = loadAutoCfgMap()[cfgKeyOf(contactId, platform)];
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MOMENT_AUTO_CFG };
  return {
    enabled: raw.enabled === true,
    trigger: raw.trigger === 'interval' || raw.trigger === 'chat' ? raw.trigger : 'schedule',
    hh: typeof raw.hh === 'number' && raw.hh >= 0 && raw.hh <= 23 ? Math.floor(raw.hh) : DEFAULT_MOMENT_AUTO_CFG.hh,
    mm: typeof raw.mm === 'number' && raw.mm >= 0 && raw.mm <= 59 ? Math.floor(raw.mm) : DEFAULT_MOMENT_AUTO_CFG.mm,
    intervalHours: MOMENT_INTERVAL_OPTIONS.includes(raw.intervalHours)
      ? raw.intervalHours
      : DEFAULT_MOMENT_AUTO_CFG.intervalHours,
  };
}

export function saveMomentAutoCfg(contactId: string, platform: MomentPlatform, patch: Partial<MomentAutoCfg>): MomentAutoCfg {
  const map = loadAutoCfgMap();
  const next: MomentAutoCfg = { ...getMomentAutoCfg(contactId, platform), ...patch };
  map[cfgKeyOf(contactId, platform)] = next;
  try {
    kvSet(AUTO_CFG_KEY, map);
  } catch {
    // 忽略
  }
  return next;
}

// ---------------- AI 生成（走 /api/moments/generate；用户 API 配置优先，服务端 SDK 兜底） ----------------

function personaOf(peer: ContactRecord): Record<string, string | null> {
  return {
    name: peer.name,
    nickname: peer.nickname ?? null,
    gender: peer.gender ?? null,
    age: peer.age ?? null,
    occupation: peer.occupation ?? null,
    company: peer.company ?? null,
    region: peer.region ?? null,
    persona: peer.persona ?? null,
    background: peer.background ?? null,
    relation: peer.relation ?? null,
    relationToUser: peer.relationToUser ?? null,
    kind: peer.kind ?? null,
  };
}

async function callGenerateApi(apiConfig: ApiConfig, payload: Record<string, unknown>): Promise<string> {
  const res = await fetch('/api/moments/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, config: apiConfig }),
  });
  const data = (await res.json().catch(() => ({}))) as { content?: unknown; error?: unknown };
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `请求失败（${res.status}）`);
  if (typeof data.content !== 'string' || !data.content.trim()) throw new Error('生成结果为空');
  return data.content.trim().slice(0, 500);
}

/** 记忆素材：该角色最近的活跃记忆（截短，喂给生成 prompt） */
function memorySnippets(contactId: string, limit = 8): string[] {
  return listFragments(contactId)
    .filter((f) => !f.supersededAt && !f.expiredAt)
    .slice(0, limit)
    .map((f) => f.content.replace(/\s+/g, ' ').slice(0, 60));
}

/**
 * AI 以该角色人设发一条动态（一.1/一.4/一.5：内容基于 persona + 最近聊天 + 记忆，随角色风格变化）。
 * 失败抛错（调用方 toast / 调度器退避）。
 */
export async function aiPostMoment(args: {
  apiConfig: ApiConfig;
  platform: MomentPlatform;
  peer: ContactRecord;
  userName: string;
  /** 聊天灵感触发时带的提示（让内容与最近话题呼应） */
  hint?: string;
}): Promise<MomentPostView> {
  const { apiConfig, platform, peer, userName, hint } = args;
  const recentChat = memRecentConvo(peer.id, platformApp(platform))
    .slice(-10)
    .map((t) => ({ role: t.role, text: t.text }));
  const content = await callGenerateApi(apiConfig, {
    kind: 'post',
    platform,
    userName,
    peer: personaOf(peer),
    recentChat,
    memories: memorySnippets(peer.id),
    hint: hint ?? null,
  });
  return addCharMomentPost(platform, { peer, userName, content });
}

/** AI 给用户的动态写一条评论/回复（二.1/二.3；内容贴合人设、动态内容与记忆——不与已知事实矛盾） */
export async function aiCommentOnMoment(args: {
  apiConfig: ApiConfig;
  platform: MomentPlatform;
  peer: ContactRecord;
  post: MomentPostView;
  userName: string;
  /** 回复目标（多轮回复时传） */
  replyTo?: { commentId: string; name: string; content: string } | null;
}): Promise<MomentCommentView> {
  const { apiConfig, platform, peer, post, userName, replyTo } = args;
  // 评论串（回复时带上下文，让 AI 接得住多轮）
  const thread = post.comments.slice(-6).map((c) => ({ authorName: c.authorName, content: c.content }));
  // 记忆素材（四.1）：评论/回复也参考记忆库，避免评论内容与已知事实矛盾
  const content = await callGenerateApi(apiConfig, {
    kind: replyTo ? 'reply' : 'comment',
    platform,
    userName,
    peer: personaOf(peer),
    post: { authorName: post.authorName, author: post.author, content: post.content.slice(0, 200) },
    thread,
    replyTo: replyTo ? { authorName: replyTo.name, content: replyTo.content } : null,
    memories: memorySnippets(peer.id),
  });
  const added = addCharMomentComment(platform, post.id, {
    peer,
    userName,
    content,
    replyTo: replyTo ? { commentId: replyTo.commentId, name: replyTo.name } : null,
  });
  if (!added) throw new Error('评论未写入（动态可能已删除或内容重复）');
  return added;
}

// ---------------- 调度结算（MomentsScheduler 每 5s 调一次） ----------------

export interface MomentTickDeps {
  apiConfig: ApiConfig;
  /** 全部联系人（真实名字；调度器异步加载传入） */
  contacts: ContactRecord[];
  /** 机主展示名（wx/qq 平台各一个；空串跳过对应平台） */
  wxUserName: string;
  qqUserName: string;
}

let ticking = false;

function lastCharPostAt(platform: MomentPlatform, userName: string, peer: ContactRecord): number {
  const hit = listMomentPosts(platform, userName)
    .filter((p) => isPostByPeer(p, peer))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return hit?.createdAt ?? 0;
}

function peersForPlatform(contacts: ContactRecord[], platform: MomentPlatform): ContactRecord[] {
  return contacts.filter((c) => (c.kind === 'char' || c.kind === 'npc') && isFriendIn(c, platform));
}

/** 结算到期的 AI 回复（用户评论/回复了 AI → AI 再回复）；未到期/未处理的项原样保留 */
async function drainReplies(queue: MomentQueueItem[], now: number, deps: MomentTickDeps): Promise<MomentQueueItem[]> {
  const keep: MomentQueueItem[] = [];
  for (const item of queue) {
    if (item.type !== 'reply') {
      keep.push(item); // 互动项透传给下一步
      continue;
    }
    if (item.fireAt > now) {
      keep.push(item);
      continue;
    }
    try {
      const peer = deps.contacts.find((c) => c.id === item.peerId);
      const post = listMomentPosts(item.platform, item.userName).find((p) => p.id === item.postId);
      const parent = post?.comments.find((c) => c.id === item.parentCommentId);
      if (!peer || !post || !parent) continue; // 动态/评论已被删 → 丢弃
      // 防串台（一.1）：AI 只回「用户发的评论」。旧版本遗留的队列项指向 AI 自己/别人的评论
      // （会生成「乐乐 回复 乐乐」这种错误指向），直接丢弃不生成
      if (parent.author !== 'user') continue;
      // 该角色已经回复过这条评论（重试/遗留重复）→ 不再生成
      if (post.comments.some((c) => c.peerId === item.peerId && c.parentId === parent.id)) continue;
      await aiCommentOnMoment({
        apiConfig: deps.apiConfig,
        platform: item.platform,
        peer,
        post,
        userName: item.userName,
        replyTo: { commentId: parent.id, name: parent.authorName, content: parent.content },
      });
      emitMomentsChanged(item.platform);
    } catch {
      // 失败重试：最多 3 次，每次顺延 90s
      if (item.tries < 2) keep.push({ ...item, tries: item.tries + 1, fireAt: now + 90_000 });
    }
  }
  return keep;
}

/** 结算到期的用户动态互动（1-2 位平台好友点赞 + 可能评论） */
async function drainInteractions(queue: MomentQueueItem[], now: number, deps: MomentTickDeps): Promise<MomentQueueItem[]> {
  const keep: MomentQueueItem[] = [];
  for (const item of queue) {
    if (item.type !== 'interact') {
      keep.push(item);
      continue;
    }
    if (item.fireAt > now) {
      keep.push(item);
      continue;
    }
    try {
      const userName = item.platform === 'wx' ? deps.wxUserName : deps.qqUserName;
      const post = listMomentPosts(item.platform, userName).find((p) => p.id === item.postId);
      if (!post) continue; // 已删除
      const candidates = peersForPlatform(deps.contacts, item.platform).filter(
        (p) => !post.likes.some((l) => isInteractionByPeer(l, p)) && !post.comments.some((c) => isInteractionByPeer(c, p))
      );
      // 随机挑 1-2 位（动态像真人刷到一样陆续有互动）
      const shuffled = [...candidates].sort(() => Math.random() - 0.5);
      const picked = shuffled.slice(0, Math.random() < 0.5 ? 1 : 2);
      for (const peer of picked) {
        try {
          addCharMomentLike(item.platform, post.id, { peer, userName });
          // 70% 概率附一条评论（不是每个好友都爱说话）
          if (Math.random() < 0.7) {
            await aiCommentOnMoment({ apiConfig: deps.apiConfig, platform: item.platform, peer, post, userName });
          }
        } catch {
          // 单个角色失败不影响其他角色
        }
      }
      if (picked.length > 0) emitMomentsChanged(item.platform);
    } catch {
      // 队列项整体失败：不重试（互动是锦上添花）
    }
  }
  return keep;
}

/** 到点检查自动发布（定时 / 频率 / 聊天灵感；一次 tick 最多发 1 条，防突发轰炸） */
async function runAutoPosts(deps: MomentTickDeps, now: number): Promise<void> {
  const plan: { peer: ContactRecord; platform: MomentPlatform; cfg: MomentAutoCfg; hint?: string }[] = [];
  for (const platform of ['wx', 'qq'] as MomentPlatform[]) {
    const userName = platform === 'wx' ? deps.wxUserName : deps.qqUserName;
    if (!userName) continue;
    for (const peer of peersForPlatform(deps.contacts, platform)) {
      const cfg = getMomentAutoCfg(peer.id, platform);
      if (!cfg.enabled) continue;
      const last = lastCharPostAt(platform, userName, peer);
      if (cfg.trigger === 'schedule') {
        // 定时：今天 HH:mm 已到且那之后没发过 → 到点（App 当时没开也补发）
        const due = new Date(now);
        due.setHours(cfg.hh, cfg.mm, 0, 0);
        if (now >= due.getTime() && last < due.getTime()) plan.push({ peer, platform, cfg });
      } else if (cfg.trigger === 'interval') {
        if (now - last >= cfg.intervalHours * 3_600_000) plan.push({ peer, platform, cfg });
      } else {
        // 聊天灵感（有感而发）：不攒轮次、不设时间门槛——AI 心血来潮想发就发。
        // 实现为每次 tick 小概率触发（期望约 20 分钟一次）；下面的 15 分钟最小间隔只是防连发刷屏的保险，不是触发条件
        if (now - last >= 15 * 60_000 && Math.random() < 1 / 240) {
          plan.push({ peer, platform, cfg, hint: '结合你们最近聊过的话题和你的近况，有感而发' });
        }
      }
    }
  }
  if (plan.length === 0) return;
  // 一次只发一条（其余下个 tick 再发）；失败退避 10 分钟
  const pick = plan[Math.floor(Math.random() * plan.length)];
  const aKey = attemptKey(pick.peer.id, pick.platform);
  try {
    const lastTry = kvGet<number>(aKey) ?? 0;
    if (now - lastTry < 10 * 60_000) return;
  } catch {
    // 忽略
  }
  const userName = pick.platform === 'wx' ? deps.wxUserName : deps.qqUserName;
  try {
    kvSet(aKey, now);
    await aiPostMoment({
      apiConfig: deps.apiConfig,
      platform: pick.platform,
      peer: pick.peer,
      userName,
      hint: pick.hint,
    });
    emitMomentsChanged(pick.platform);
  } catch {
    // 保留退避标记（10 分钟后重试）
  }
}

/**
 * 调度 tick（全局唯一入口，MomentsScheduler 每 5s 调用）：
 * 1) 结算到期的 AI 回复（多轮互动）；2) 结算用户动态的 AI 互动；3) 检查自动发布三种触发。
 * 串行防重入；任何失败不外抛（动态是增强能力）。
 */
export async function runMomentsTick(deps: MomentTickDeps): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    const queue = loadQueueSafe();
    const afterReplies = await drainReplies(queue, now, deps);
    const remaining = await drainInteractions(afterReplies, now, deps);
    if (remaining.length !== queue.length) saveQueue(remaining);
    await runAutoPosts(deps, now);
  } catch {
    // 静默
  } finally {
    ticking = false;
  }
}

// ---------------- 聊天感知注入（四：私聊 system 带「最近动态 + 相关互动」） ----------------

function momentTimeLabel(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 组装「最近的社交动态」注入块（各聊天 App 的 system 消息追加）。
 * - 好友能看到彼此的动态：用户广播动态 + 该角色自己的动态 + 相关评论都会列出；
 * - 用户广播动态首次被「看到」时懒写入该角色记忆（三.1：用户发动态 → 写入该角色记忆；
 *   只写真正聊得起来的角色，避免把每条动态复制进所有联系人的记忆库）；
 * - 互通开关关闭时只注入当前 App 对应平台的动态（六.3：sms/phone 无自有平台 → 不注入）；
 * - 与记忆召回互相独立：没动态返回空串，注入块不存在也不影响原有 prompt。
 */
export function buildMomentsChatBlock(args: {
  contactId: string;
  app: MemApp;
  /** 机主展示名（动态作者匹配用；读操作不改写平台机主名） */
  userName: string;
  peer: Pick<ContactRecord, 'id' | 'name' | 'nickname'>;
}): string {
  const { contactId, app, userName, peer } = args;
  if (!contactId || !peer?.id) return '';
  let allowed: MomentPlatform[] = [];
  try {
    const { share } = getMemSettings(contactId);
    allowed = share ? ['wx', 'qq'] : app === 'wx' ? ['wx'] : app === 'qq' ? ['qq'] : [];
  } catch {
    allowed = ['wx', 'qq'];
  }
  if (allowed.length === 0) return '';
  const posts: MomentPostView[] = [];
  for (const platform of allowed) {
    posts.push(...listMomentPosts(platform, userName));
  }
  // 取最近 6 条：该角色相关的（TA 的动态 / 有 TA 的互动）优先，再补用户最近的广播动态
  const relevant = posts.filter(
    (p) => isPostByPeer(p, peer) || p.likes.some((l) => isInteractionByPeer(l, peer)) || p.comments.some((c) => isInteractionByPeer(c, peer))
  );
  const relevantIds = new Set(relevant.map((p) => p.id));
  const rest = posts.filter((p) => !relevantIds.has(p.id) && p.author === 'user');
  const picked = [...relevant, ...rest].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  if (picked.length === 0) return '';

  const peerDisplay = displayNameOf(peer);
  const lines: string[] = [
    `【最近的社交动态（${allowed.map((p) => MOMENT_PLATFORM_LABEL[p]).join('/')}；这些是动态广场内容，不是你们私聊的消息）】`,
  ];
  for (const p of picked) {
    const who = p.author === 'user' ? userName : p.authorName;
    lines.push(
      `- ${momentTimeLabel(p.createdAt)} ${who}发了一条${MOMENT_PLATFORM_LABEL[p.platform]}：「${p.content.slice(0, 60)}」`
    );
    // 相关互动：该角色的点赞 + 最近的评论（最多 3 条，多轮回复按顺序）
    if (p.likes.some((l) => isInteractionByPeer(l, peer))) lines.push('  （你赞过这条动态）');
    for (const c of p.comments.slice(-3)) {
      const cWho = c.author === 'user' ? userName : c.authorName;
      const arrow = c.replyToName ? ` 回复 ${c.replyToName}` : '';
      lines.push(`  （评论：${cWho}${arrow}：「${c.content.slice(0, 50)}」）`);
    }
  }
  lines.push(
    `（这些是你们在${allowed.map((p) => MOMENT_PLATFORM_LABEL[p]).join('/')}里的公开动态与互动，聊天时可以像真人一样自然提起（关心、调侃、接着聊都行），但不要把它们当成私聊内容，也不要生硬复述。）`
  );

  // 懒写入记忆：这次「被看到」的用户广播动态写进该角色记忆（去重：已入过库的动态跳过）
  for (const p of picked) {
    if (p.author !== 'user') continue;
    if (memHasMomentFragment(contactId, p.id)) continue;
    const peerComments = p.comments.filter((c) => isInteractionByPeer(c, peer));
    const extra = peerComments.length > 0
      ? `，${peer.name || peerDisplay}评论过：「${peerComments[peerComments.length - 1].content.slice(0, 30)}」`
      : p.likes.some((l) => isInteractionByPeer(l, peer))
        ? `，${peer.name || peerDisplay}赞过`
        : '';
    writeMomentMemory({
      peerId: contactId,
      platform: p.platform,
      postId: p.id,
      sourceTime: p.createdAt,
      shape: 'user-post',
      peerDisplay,
      userName,
      detail: p.content.slice(0, 60),
      extra,
    });
  }

  return lines.join('\n');
}

// ---------------- 旧版本遗留数据修复（MomentsScheduler 启动时执行一次） ----------------

/** 原始存储里是否存在「AI 回复自己」的历史 bug 数据（replyTo 是自己的名字且作者为 char） */
function hasLegacySelfReplyRaw(platform: MomentPlatform): boolean {
  try {
    if (platform === 'wx') {
      const raw = kvGet<WxRawPost[]>(WX_MOMENTS_KEY);
      if (!Array.isArray(raw)) return false;
      return raw.some(
        (p) =>
          Array.isArray(p?.comments) &&
          p.comments.some(
            (c) =>
              Boolean(c) &&
              typeof c === 'object' &&
              (c as WxRawComment).authorKind === 'char' &&
              typeof (c as WxRawComment).author === 'string' &&
              (c as WxRawComment).replyTo === (c as WxRawComment).author
          )
      );
    }
    const raw = kvGet<Record<string, QqRawComment[]>>(QQ_COMMENTS_KEY);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    return Object.values(raw).some(
      (arr) =>
        Array.isArray(arr) &&
        arr.some(
          (c) =>
            Boolean(c) &&
            typeof c === 'object' &&
            (c as QqRawComment).authorKind === 'char' &&
            typeof (c as QqRawComment).author === 'string' &&
            (c as QqRawComment).replyTo === (c as QqRawComment).author
        )
    );
  } catch {
    return false;
  }
}

/**
 * 一次性修复旧版本遗留数据：AI「回复自己」的错误指向（listMomentPosts 视图层已兼容修复，
 * 这里再把修复结果写回存储，让 App 内的原始读取也能显示正确）。
 */
export function repairLegacyMomentData(): void {
  try {
    for (const platform of ['wx', 'qq'] as MomentPlatform[]) {
      if (!hasLegacySelfReplyRaw(platform)) continue;
      persistMomentPosts(platform, listMomentPosts(platform));
    }
  } catch {
    // 忽略（修复失败不影响功能，视图层读取时仍会兜底修复）
  }
}

// ---------------- 联系人删除级联清理（contacts-store.deleteContact 动态引入调用） ----------------

/** 删除该联系人的全部动态痕迹：TA 的动态、TA 的点赞/评论、队列里的待回复项与计数器 */
export function purgeMomentsForContact(contactId: string): void {
  if (!contactId) return;
  try {
    for (const platform of ['wx', 'qq'] as MomentPlatform[]) {
      const list = listMomentPosts(platform);
      const hadPost = list.some((p) => p.author === 'char' && p.peerId === contactId);
      const hadInteraction = list.some((p) => p.likes.some((l) => l.peerId === contactId) || p.comments.some((c) => c.peerId === contactId));
      if (!hadPost && !hadInteraction) continue;
      const next = list
        .map((p) => ({
          ...p,
          likes: p.likes.filter((l) => l.peerId !== contactId),
          comments: p.comments.filter((c) => c.peerId !== contactId),
        }))
        .filter((p) => !(p.author === 'char' && p.peerId === contactId));
      persistMomentPosts(platform, next);
    }
    const q = loadQueueSafe().filter((x) => x.type !== 'reply' || x.peerId !== contactId);
    saveQueue(q);
    kvDel(attemptKey(contactId, 'wx'));
    kvDel(attemptKey(contactId, 'qq'));
  } catch {
    // 忽略
  }
}
