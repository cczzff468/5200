'use client';

/**
 * X论坛 · 帖子详情页（X thread，评论流按用户参考图 1:1 精修）。
 * 顶栏：返回 + 「帖子」；主帖 48px 头像 / 名行右侧「关注」黑胶囊；
 * 官方元数据行「H:mm · 年月日 · N 次浏览」+ 蓝色「翻译」按钮
 * （X 官方行为：译文原位替换正文展示，下方标注「由 AI 翻译」，
 * 按钮可在 查看原文/查看译文 间切换）；
 * 互动栏（回复/转推/点赞/书签/分享，爱心归位第三，带数字）+ 分隔线下接评论流；
 * 打开帖子自动补评论到 10~30 条（engine.ensureThreadComments，静默浮现）；
 * 底部「显示更多评论」按钮 → 再生成 10~30 条；
 * 评论流按参考图：头像 + 名字(bold) + @账号 · 时间(灰) + 右侧「···」，
 * 子回复带「回复 @xx」蓝字行，操作行为六个空心线性图标
 * （回复/转推/爱心/浏览/书签/分享，图标+数字）；头像右缘细竖线贯穿到子回复；
 * 底部回复输入条（头像 + input + 蓝色发送圆钮），
 * 点击评论/子回复即定向回复（显示「回复 @xx」提示条，可取消）；
 * 用户回复 AI 评论 → AI 感觉主帖内容+用户评论内容再回一条，无限多轮（engine）。
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Languages } from 'lucide-react';
import {
  communityName,
  countShort,
  forumData,
  forumSnapshot,
  relTime,
  repliesOf,
  resolveAuthor,
  saveForum,
  subscribeForum,
  uid,
  REPLY_MAX,
  type ForumPost,
} from '@/lib/forum/core';
import { ensureThreadComments, generateMoreComments, queueAiReplyToUserReply } from '@/lib/forum/engine';
import { detectMessageLang, requestTranslation } from '@/lib/chat-translate';
import { useSettings } from '@/lib/ios/store';
import { XAvatar, XIcons, VerifiedBadge } from './shared';
import { useForum } from './ctx';
import { CommunityIcon, PostMedia, PollBlock, LocationLine } from './feed';

/** 详情页互动栏单个图标钮（X 官方：带数字，悬停浅色圆底 + 图标/数字同步变色） */
function ThreadAction({
  icon,
  count,
  color,
  hoverColor,
  hoverBg,
  onClick,
  label,
  size = 'md',
}: {
  icon: React.ReactNode;
  count?: number;
  color: string;
  hoverColor: string;
  hoverBg: string;
  onClick?: () => void;
  label: string;
  size?: 'md' | 'sm';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`flex items-center gap-[3px] rounded-full transition-colors active:opacity-60 ${
        size === 'sm' ? 'p-[4px]' : 'p-[6px]'
      }`}
      style={{ color }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = hoverColor;
        e.currentTarget.style.background = hoverBg;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = color;
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {icon}
      {typeof count === 'number' && count > 0 && (
        <span className={`pr-[3px] leading-none ${size === 'sm' ? 'text-[12px]' : 'text-[14px]'}`}>
          {countShort(count)}
        </span>
      )}
    </button>
  );
}

/** 评论操作行（参考图规格）：回复/转推/爱心/浏览/书签/分享 六个空心线性图标
 *  （未激活灰色；爱心激活粉色实心、转推激活绿色），图标+数字，悬停浅色圆底。 */
function CommentActions({
  post,
  subCount,
  compact,
  onReplyClick,
}: {
  post: ForumPost;
  subCount: number;
  compact?: boolean;
  onReplyClick: () => void;
}) {
  const f = useForum();
  const t = f.t;
  const liked = post.likes.includes('user');
  const reposted = post.reposted === true;
  const iconSize = compact ? 15 : 16;
  const size = compact ? 'sm' : 'md';
  const a = resolveAuthor(post.authorKey);
  const [bookmarked, setBookmarked] = useState(false);
  return (
    <div
      className={`mt-1.5 flex items-center ${compact ? 'gap-[2px] pr-4' : 'justify-between pr-6'}`}
      style={{ maxWidth: compact ? 340 : 430 }}
    >
      <ThreadAction
        icon={XIcons.reply(iconSize)}
        count={subCount}
        label="回复"
        size={size}
        color={t.secondary}
        hoverColor={t.blue}
        hoverBg="rgba(29,155,240,0.12)"
        onClick={onReplyClick}
      />
      <ThreadAction
        icon={XIcons.repost(iconSize)}
        count={post.reposts}
        label={reposted ? '撤销转推' : '转推'}
        size={size}
        color={reposted ? t.green : t.secondary}
        hoverColor={t.green}
        hoverBg="rgba(0,186,124,0.12)"
        onClick={() => f.repostToggle(post.id)}
      />
      <ThreadAction
        icon={XIcons.like(liked, iconSize)}
        count={post.likes.length}
        label={liked ? '取消点赞' : '点赞'}
        size={size}
        color={liked ? t.pink : t.secondary}
        hoverColor={t.pink}
        hoverBg="rgba(249,24,128,0.12)"
        onClick={() => f.likeToggle(post.id)}
      />
      <ThreadAction
        icon={XIcons.views(iconSize)}
        count={post.views}
        label="浏览量"
        size={size}
        color={t.secondary}
        hoverColor={t.blue}
        hoverBg="rgba(29,155,240,0.12)"
        onClick={() => f.toast(`这条回复已有 ${countShort(post.views)} 次浏览`)}
      />
      <ThreadAction
        icon={XIcons.bookmark(bookmarked, iconSize)}
        label={bookmarked ? '移除书签' : '添加书签'}
        size={size}
        color={bookmarked ? t.blue : t.secondary}
        hoverColor={t.blue}
        hoverBg="rgba(29,155,240,0.12)"
        onClick={() => {
          setBookmarked(!bookmarked);
          f.toast(bookmarked ? '已移除书签' : '已添加到书签');
        }}
      />
      <ThreadAction
        icon={XIcons.share(iconSize)}
        label="分享"
        size={size}
        color={t.secondary}
        hoverColor={t.blue}
        hoverBg="rgba(29,155,240,0.12)"
        onClick={() => {
          try {
            void navigator.clipboard?.writeText(`https://x.com/${a.handle}/status/${post.id}`);
          } catch {
            /* 剪贴板不可用无妨 */
          }
          f.toast('链接已复制');
        }}
      />
    </div>
  );
}

/** 评论名行（参考图规格）：名字(bold 黑) + 认证 + @账号 · 时间(灰) + 最右「···」 */
function CommentNameRow({
  authorKey,
  createdAt,
  onMore,
  nameMax,
}: {
  authorKey: string;
  createdAt: number;
  onMore: () => void;
  nameMax: number;
}) {
  const f = useForum();
  const t = f.t;
  const a = resolveAuthor(authorKey);
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => f.openProfile(authorKey)}
        className="shrink truncate text-[15px] font-bold"
        style={{ color: t.text, maxWidth: nameMax }}
      >
        {a.name}
      </button>
      {a.verified && <VerifiedBadge size={14} />}
      <span className="truncate text-[14px]" style={{ color: t.secondary }}>
        @{a.handle} · {relTime(createdAt)}
      </span>
      <button
        type="button"
        aria-label="更多"
        onClick={(e) => {
          e.stopPropagation();
          onMore();
        }}
        className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors active:bg-black/10 dark:active:bg-white/10"
        style={{ color: t.secondary }}
      >
        {XIcons.more(18)}
      </button>
    </div>
  );
}

/** 顶层评论（参考图规格）：头像 44px + 头像右缘竖线贯穿到子回复 +
 *  名行（名字bold + @账号·时间灰 + 右侧···）+ 正文 + 六图标操作行；
 *  子回复嵌套在正文列下方：头像 36px、「回复 @xx」蓝字行，
 *  样式与顶层一致（用户要求子回复也显示头像名字爱心）。
 *  点评论/子回复 → 定向回复（onReply 传 rootId=顶层评论 id + postId=精确被回复帖 + 名字，
 *  支持无限多轮：用户回复谁、谁的作者 AI 就接话）。 */
function CommentRow({
  comment,
  onReply,
}: {
  comment: ForumPost;
  onReply: (rootId: string, postId: string, name: string) => void;
}) {
  const f = useForum();
  const t = f.t;
  const a = resolveAuthor(comment.authorKey);
  // 直算不 memo：论坛数据对象会被引擎原位变更（saveForum 浅拷贝外壳、posts 原数组），
  // useMemo 依赖 [comment.id] 在新增子回复时不会重算 → 子回复列表滞留旧值（同 profile-view 的教训）。
  const subReplies = repliesOf(forumData(), comment.id);

  return (
    <div
      className="border-b px-4 py-3"
      style={{ borderColor: t.border }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        onReply(comment.id, comment.id, a.name); // X 行为：点评论即定向回复
      }}
    >
      <div className="flex gap-2.5">
        {/* 头像列：44px 头像 + 右缘细竖线贯穿到子回复（X 官方嵌套对话流连接线） */}
        <div className="flex shrink-0 flex-col items-center">
          <XAvatar authorKey={comment.authorKey} size={44} onClick={() => f.openProfile(comment.authorKey)} />
          {subReplies.length > 0 && (
            <span className="mt-1 w-[2px] flex-1" style={{ background: t.border }} aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {/* 名行：名字(bold) + @账号 · 时间(灰) + 最右「···」 */}
          <CommentNameRow
            authorKey={comment.authorKey}
            createdAt={comment.createdAt}
            onMore={() => f.openPostMenu(comment)}
            nameMax={110}
          />
          {/* 评论正文 */}
          <p className="mt-[2px] whitespace-pre-wrap break-words text-[15px] leading-[1.45]" style={{ color: t.text }}>
            {comment.content}
          </p>
          {/* 操作行：回复/转推/爱心/浏览/书签/分享（空心线性图标 + 数字） */}
          <CommentActions
            post={comment}
            subCount={subReplies.length}
            onReplyClick={() => onReply(comment.id, comment.id, a.name)}
          />
          {/* 子回复：头像+名行+「回复 @xx」蓝字+正文+小操作行（与顶层一致的完整样式） */}
          {subReplies.length > 0 && (
            <div className="mt-2 flex flex-col">
              {subReplies.map((s) => {
                const sa = resolveAuthor(s.authorKey);
                const replying = s.replyToName && s.replyToName !== sa.name ? s.replyToName : null;
                const sSubs = repliesOf(forumData(), s.id);
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`回复 ${sa.name} 的评论`}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button')) return;
                      onReply(comment.id, s.id, sa.name); // 点子回复 → 回复该作者（仍挂顶层评论下，多轮接话定位到 TA）
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onReply(comment.id, s.id, sa.name);
                    }}
                    className="cursor-pointer rounded-lg py-2 transition-colors active:opacity-60"
                  >
                    <div className="flex gap-2">
                      <XAvatar authorKey={s.authorKey} size={36} onClick={() => f.openProfile(s.authorKey)} />
                      <div className="min-w-0 flex-1">
                        {/* 名行：名字(bold) + @账号 · 时间(灰) + 最右「···」 */}
                        <CommentNameRow
                          authorKey={s.authorKey}
                          createdAt={s.createdAt}
                          onMore={() => f.openPostMenu(s)}
                          nameMax={90}
                        />
                        {/* 被回复人提示（参考图：「回复 @xx」@为品牌蓝） */}
                        {replying && (
                          <p className="text-[14px]" style={{ color: t.secondary }}>
                            回复 <span style={{ color: t.blue }}>@{replying}</span>
                          </p>
                        )}
                        {/* 子回复正文 */}
                        <p
                          className="mt-[1px] whitespace-pre-wrap break-words text-[15px] leading-[1.45]"
                          style={{ color: t.text }}
                        >
                          {s.content}
                        </p>
                        {/* 小操作行（与顶层一致的六图标，小一号） */}
                        <CommentActions
                          post={s}
                          subCount={sSubs.length}
                          compact
                          onReplyClick={() => onReply(comment.id, s.id, sa.name)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ThreadView({ postId }: { postId: string }) {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();
  const post = d.posts.find((p) => p.id === postId);
  /** 顶层评论（直接回复主帖）——直算不 memo：数据原位变更时 memo 依赖不可靠（同 profile-view 教训） */
  const replies = post ? repliesOf(d, postId) : [];
  /** 全部回复数（顶层 + 嵌套子回复） */
  const totalReplies = replies.reduce((n, r) => n + 1 + repliesOf(d, r.id).length, 0);
  const [draft, setDraft] = useState('');
  const [bookmarked, setBookmarked] = useState(false);
  /** 定向回复目标（null = 回复主帖作者）：commentId = 分组锚点（顶层评论 id），
 *  postId = 精确被回复的帖（多轮接话定位：AI 回应“我评论的那条”），name = 显示名 */
  const [replyTarget, setReplyTarget] = useState<{ commentId: string; postId: string; name: string } | null>(null);
  /** 「显示更多评论」生成中（engine 再生成 10~30 条） */
  const [moreLoading, setMoreLoading] = useState(false);
  /** 打开帖子自动补评论进行中（0 评论时显示「评论正在赶来」骨架提示；
 *  挂载时即为 true，effect 完成后置 false——不在 effect 里同步 setState） */
  const [initGen, setInitGen] = useState(true);
  /** AI 翻译：loading / 译文 / 是否展示 */
  const [tr, setTr] = useState<{ loading: boolean; text: string | null; shown: boolean }>({
    loading: false,
    text: null,
    shown: false,
  });
  const inputRef = useRef<HTMLInputElement | null>(null);

  /** 打开帖子：评论不足 10 条 → 自动补到 10~30 条（生成好后自动浮现）；
 *  每次进入只触发一次（engine 内部防并发）。 */
  useEffect(() => {
    let alive = true;
    void ensureThreadComments(postId).finally(() => {
      if (alive) setInitGen(false);
    });
    return () => {
      alive = false;
    };
  }, [postId]);

  if (!post) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-[15px]" style={{ color: t.secondary }}>
        帖子不存在或已被删除
      </div>
    );
  }

  const a = resolveAuthor(post.authorKey);
  const liked = post.likes.includes('user');
  const followed = d.following.includes(post.authorKey);
  const dt = new Date(post.createdAt);
  const dateStr = `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`;
  const communityLabel = post.community && post.community !== 'hot' ? communityName(post.community) : '';

  /** 发送回复：挂主帖（无目标）或顶层评论（微信式嵌套）；
   *  被回复对象作者是 AI 时，排一条 AI 再回复（带主帖+用户评论上下文，无限多轮）。 */
  const sendReply = () => {
    const text = draft.trim();
    if (!text) return;
    const nd = forumData();
    const groupId = replyTarget?.commentId ?? post.id;
    const exactId = replyTarget?.postId ?? post.id;
    const targetName = replyTarget?.name ?? a.name;
    const reply: ForumPost = {
      id: uid('p'),
      authorKey: 'user',
      content: text.slice(0, REPLY_MAX),
      community: post.community,
      createdAt: Date.now(),
      likes: [],
      reposts: 0,
      views: 0,
      replyTo: groupId,
      replyToName: targetName,
      replyToPost: exactId,
      reposted: false,
    };
    nd.posts.push(reply);
    saveForum({ ...nd });
    setDraft('');
    const targetPost = nd.posts.find((p) => p.id === exactId);
    if (targetPost && targetPost.authorKey !== 'user') queueAiReplyToUserReply(exactId, reply.id, groupId, post.id);
    setReplyTarget(null);
  };

  /** 点击评论/子回复：定向回复并聚焦输入框（rootId 分组 + postId 精确定位） */
  const startReply = (rootId: string, postId: string, name: string) => {
    setReplyTarget({ commentId: rootId, postId, name });
    inputRef.current?.focus();
  };

  /** AI 翻译正文：中文 → 英语，外语 → 中文（带缓存与内置模型兜底） */
  const runTranslate = () => {
    // 已有译文：切换展示/收起
    if (tr.text) {
      setTr((s) => ({ ...s, shown: !s.shown }));
      return;
    }
    const text = post.content.trim();
    if (!text || tr.loading) return;
    setTr({ loading: true, text: null, shown: false });
    const target = detectMessageLang(text) === 'zh-Hans' ? 'en' : 'zh-Hans';
    requestTranslation({ text, lang: target, apiConfig: useSettings.getState().apiConfig })
      .then((out) => setTr({ loading: false, text: out, shown: true }))
      .catch(() => {
        setTr({ loading: false, text: null, shown: false });
        f.toast('翻译失败，稍后再试');
      });
  };

  return (
    <div className="flex h-full flex-col" style={{ background: t.bg, color: t.text }}>
      {/* 顶栏 */}
      <div
        className="sticky top-0 z-20 shrink-0 border-b"
        style={{
          borderColor: t.border,
          background: t.dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.78)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex items-center gap-4 px-4 pt-[54px]" style={{ height: 100 }}>
          <button
            type="button"
            aria-label="返回"
            onClick={f.pop}
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.back(20)}
          </button>
          <span className="text-[17px] font-bold">帖子</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 原帖（X 放大规格） */}
        <div className="px-4 pt-3 pb-3">
          <div className="flex gap-3">
            <XAvatar authorKey={post.authorKey} size={48} onClick={() => f.openProfile(post.authorKey)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => f.openProfile(post.authorKey)}
                  className="max-w-[150px] truncate text-[16px] font-bold"
                  style={{ color: t.text }}
                >
                  {a.name}
                </button>
                {a.verified && <VerifiedBadge size={15} />}
                <span className="truncate text-[14px]" style={{ color: t.secondary }}>
                  @{a.handle}
                </span>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {post.authorKey !== 'user' && (
                    <button
                      type="button"
                      aria-label={followed ? '取消关注' : '关注'}
                      onClick={() => {
                        const nd = forumData();
                        if (followed) nd.following = nd.following.filter((k) => k !== post.authorKey);
                        else nd.following = [...nd.following, post.authorKey];
                        f.toast(followed ? `已取消关注 ${a.name}` : `已关注 ${a.name}，「关注」页将出现 TA 的帖子`);
                        saveForum({ ...nd });
                      }}
                      className="flex h-[30px] items-center rounded-full px-4 text-[14px] font-bold transition-opacity active:opacity-60"
                      style={
                        followed
                          ? { border: `1px solid ${t.dark ? '#536471' : '#cfd9de'}`, color: t.text, background: 'transparent' }
                          : { background: t.text, color: t.bg, border: 'none' }
                      }
                    >
                      {followed ? '已关注' : '关注'}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="更多"
                    onClick={() => f.openPostMenu(post)}
                    className="flex h-8 w-8 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
                    style={{ color: t.secondary }}
                  >
                    {XIcons.more(18)}
                  </button>
                </div>
              </div>
            </div>
          </div>
          {/* 正文：翻译激活时原位替换为译文（X 官方行为），未翻译/收起时显示原文 */}
          <p className="mt-2.5 whitespace-pre-wrap break-words text-[17px] leading-[1.42]" style={{ color: t.text }}>
            {tr.shown && tr.text ? tr.text : post.content}
          </p>
          {/* 翻译标注行（译文已原位替换正文） */}
          {tr.text && tr.shown && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[13px]" style={{ color: t.secondary }}>
              <Languages width={13} height={13} strokeWidth={1.9} aria-hidden="true" />
              由 AI 翻译
            </p>
          )}
          {/* 主帖附图 / 投票 / 位置（与帖子卡同规格） */}
          {(post.media ?? []).length > 0 && <PostMedia media={post.media!} />}
          {post.poll && <PollBlock post={post} />}
          {post.location && <div className="mt-1"><LocationLine name={post.location} /></div>}
          {/* 社区来源引用卡（X 引用块观感：圆角容器 + 版块入口） */}
          {communityLabel && post.community && (
            <button
              type="button"
              onClick={() => f.openCommunity(post.community!)}
              className="mt-2.5 flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors active:opacity-70"
              style={{ background: t.dark ? '#202327' : '#f7f9f9' }}
              aria-label={`进入${communityLabel}版块`}
            >
              <CommunityIcon id={post.community} size={38} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold" style={{ color: t.text }}>
                  {communityLabel}
                </span>
                <span className="block text-[13px]" style={{ color: t.secondary }}>
                  来自版块 · 点击进入逛逛
                </span>
              </span>
              <span style={{ color: t.secondary }}>{XIcons.back(14)}</span>
            </button>
          )}
          {/* 官方元数据行：H:mm · 年月日 · N 次浏览 + 蓝色「翻译」按钮 */}
          <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-[14px]" style={{ color: t.secondary }}>
            <span>
              {dt.getHours()}:{String(dt.getMinutes()).padStart(2, '0')} ·{' '}
              <b style={{ color: t.text, fontWeight: 700 }}>{dateStr}</b> ·{' '}
              <b style={{ color: t.text, fontWeight: 700 }}>{countShort(post.views)} 次浏览</b>
            </span>
            <button
              type="button"
              onClick={runTranslate}
              disabled={tr.loading}
              className="ml-1 text-[14px] font-bold transition-opacity active:opacity-50 disabled:opacity-60"
              style={{ color: t.blue }}
              aria-label={tr.text ? (tr.shown ? '查看原文' : '查看译文') : 'AI 翻译帖子'}
            >
              {tr.loading ? '翻译中…' : tr.text ? (tr.shown ? '查看原文' : '查看译文') : '翻译'}
            </button>
          </p>
          {/* 互动栏（X 官方顺序：回复/转推/点赞/书签/分享，爱心归位第三，在评论区上方，带数字） */}
          <div className="mt-1 flex items-center justify-between border-b py-3" style={{ borderColor: t.border }}>
            <ThreadAction
              icon={XIcons.reply(21)}
              count={totalReplies}
              label="回复"
              color={t.secondary}
              hoverColor={t.blue}
              hoverBg="rgba(29,155,240,0.12)"
              onClick={() => inputRef.current?.focus()}
            />
            <ThreadAction
              icon={XIcons.repost(21)}
              count={post.reposts}
              label={post.reposted ? '撤销转推' : '转推'}
              color={post.reposted ? t.green : t.secondary}
              hoverColor={t.green}
              hoverBg="rgba(0,186,124,0.12)"
              onClick={() => f.repostToggle(post.id)}
            />
            {/* 爱心归位：第三位（用户要求移回原位，与帖子卡操作行一致） */}
            <ThreadAction
              icon={XIcons.like(liked, 21)}
              count={post.likes.length}
              label={liked ? '取消点赞' : '点赞'}
              color={liked ? t.pink : t.secondary}
              hoverColor={t.pink}
              hoverBg="rgba(249,24,128,0.12)"
              onClick={() => f.likeToggle(post.id)}
            />
            <ThreadAction
              icon={XIcons.bookmark(bookmarked, 21)}
              label={bookmarked ? '移除书签' : '添加书签'}
              color={bookmarked ? t.blue : t.secondary}
              hoverColor={t.blue}
              hoverBg="rgba(29,155,240,0.12)"
              onClick={() => {
                setBookmarked(!bookmarked);
                f.toast(bookmarked ? '已移除书签' : '已添加到书签');
              }}
            />
            <ThreadAction
              icon={XIcons.share(21)}
              label="分享"
              color={t.secondary}
              hoverColor={t.blue}
              hoverBg="rgba(29,155,240,0.12)"
              onClick={() => {
                try {
                  void navigator.clipboard?.writeText(`https://x.com/${a.handle}/status/${post.id}`);
                } catch {
                  /* 剪贴板不可用无妨 */
                }
                f.toast('链接已复制');
              }}
            />
          </div>
        </div>

        {/* 评论流（参考图规格：X 官方回复卡 + 嵌套连接线） */}
        {replies.length === 0 ? (
          initGen || moreLoading ? (
            <div className="flex items-center justify-center gap-2 py-10" aria-live="polite">
              <span
                className="h-[16px] w-[16px] animate-spin rounded-full border-2"
                style={{ borderColor: t.blue, borderTopColor: 'transparent' }}
                aria-hidden="true"
              />
              <span className="text-[14px]" style={{ color: t.secondary }}>
                评论正在赶来…
              </span>
            </div>
          ) : (
            <p className="py-10 text-center text-[14px]" style={{ color: t.secondary }}>
              还没有回复，来抢沙发
            </p>
          )
        ) : (
          <div className="border-t" style={{ borderColor: t.border }}>
            {replies.map((r) => (
              <CommentRow key={r.id} comment={r} onReply={startReply} />
            ))}
          </div>
        )}
        {/* 「显示更多评论」按钮：点击再生成 10~30 条（含楼中楼）；生成中显示 loading */}
        <div className="px-4 py-4">
          <button
            type="button"
            disabled={moreLoading}
            onClick={() => {
              setMoreLoading(true);
              void generateMoreComments(post.id)
                .then((n) => {
                  if (n > 0) f.toast(`已生成 ${n} 条新评论`);
                  else f.toast('暂时没有更多评论，稍后再试');
                })
                .finally(() => setMoreLoading(false));
            }}
            className="flex h-[44px] w-full items-center justify-center gap-2 rounded-full border text-[15px] font-bold transition-opacity active:opacity-60 disabled:opacity-60"
            style={{ borderColor: t.dark ? '#536471' : '#cfd9de', color: t.blue }}
            aria-label="显示更多评论"
          >
            {moreLoading ? (
              <>
                <span
                  className="h-[16px] w-[16px] animate-spin rounded-full border-2"
                  style={{ borderColor: t.blue, borderTopColor: 'transparent' }}
                  aria-hidden="true"
                />
                正在生成更多评论…
              </>
            ) : (
              '显示更多评论'
            )}
          </button>
        </div>
      </div>

      {/* 底部回复输入条（X：头像 + 输入 + 蓝发送钮；微信式定向回复提示条） */}
      <div className="shrink-0 border-t" style={{ borderColor: t.border, background: t.bg }}>
        {replyTarget && (
          <div className="flex items-center justify-between px-4 pt-1.5">
            <span className="truncate text-[12px] font-medium" style={{ color: t.blue }}>
              回复 @{replyTarget.name}
            </span>
            <button
              type="button"
              aria-label="取消定向回复"
              onClick={() => setReplyTarget(null)}
              className="shrink-0 pl-2 text-[12px] font-medium active:opacity-50"
              style={{ color: t.secondary }}
            >
              取消
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2">
          <XAvatar authorKey="user" size={34} />
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full px-4 h-[40px]" style={{ background: t.dark ? '#202327' : '#eff3f4' }}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, REPLY_MAX))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendReply();
                }
              }}
              placeholder={replyTarget ? `回复 ${replyTarget.name}…` : `回复 ${a.name}…`}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              style={{ color: t.text, caretColor: t.blue }}
              aria-label={replyTarget ? `回复 ${replyTarget.name}` : `回复 ${a.name}`}
            />
          </div>
          <button
            type="button"
            aria-label="发送回复"
            disabled={!draft.trim()}
            onClick={sendReply}
            className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40 active:opacity-70"
            style={{ background: t.blue }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M22 2 11 13" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M22 2 15 22l-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
