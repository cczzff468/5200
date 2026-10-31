'use client';

/**
 * X论坛 · 帖子详情页（X thread + 微信式嵌套评论）。
 * 顶栏：返回 + 「帖子」；主帖 48px 头像 / 名行右侧「关注」黑胶囊；
 * 官方元数据行「H:mm · 年月日 · N 次浏览」+ 蓝色「翻译」按钮
 * （X 官方行为：译文原位替换正文展示，下方标注「由 AI 翻译」，
 * 按钮可在 查看原文/查看译文 间切换）；
 * 互动栏（回复/转推/书签/分享/点赞，爱心置最右，带数字）+ 分隔线下接评论流；
 * 评论流为微信式嵌套：顶层评论（头像+名字+内容+回复/赞），
 * 子回复同样带头像+名字+时间+回复/爱心（与顶层评论一致的完整样式）；
 * 底部回复输入条（头像 + input + 蓝色发送圆钮），
 * 点击评论/子回复即定向回复（显示「回复 @xx」提示条，可取消）。
 */

import { useRef, useState, useSyncExternalStore } from 'react';
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
import { queueAiReplyToUserReply } from '@/lib/forum/engine';
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
}: {
  icon: React.ReactNode;
  count?: number;
  color: string;
  hoverColor: string;
  hoverBg: string;
  onClick?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex items-center gap-[3px] rounded-full p-[6px] transition-colors active:opacity-60"
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
        <span className="pr-[3px] text-[14px] leading-none">{countShort(count)}</span>
      )}
    </button>
  );
}

/** 微信式嵌套评论行：顶层评论 = 头像 + 蓝名 + 内容 + （回复/赞）；
 *  子回复同样带头像 + 蓝名 + 时间 + 内容 + （回复/赞），收在灰色圆角盒里
 *  （与顶层评论一致的完整样式，用户要求子回复也显示头像名字爱心）。
 *  点评论/子回复 → 定向回复（onReply 传顶层评论 id + 被回复者名字）。 */
function CommentRow({
  comment,
  onReply,
}: {
  comment: ForumPost;
  onReply: (commentId: string, name: string) => void;
}) {
  const f = useForum();
  const t = f.t;
  const a = resolveAuthor(comment.authorKey);
  // 直算不 memo：论坛数据对象会被引擎原位变更（saveForum 浅拷贝外壳、posts 原数组），
  // useMemo 依赖 [comment.id] 在新增子回复时不会重算 → 子回复列表滞留旧值（同 profile-view 的教训）。
  const subReplies = repliesOf(forumData(), comment.id);
  const liked = comment.likes.includes('user');

  return (
    <div
      className="border-b px-4 py-3"
      style={{ borderColor: t.border }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        onReply(comment.id, a.name); // 微信行为：点评论即回复
      }}
    >
      <div className="flex gap-2.5">
        <XAvatar authorKey={comment.authorKey} size={38} onClick={() => f.openProfile(comment.authorKey)} />
        <div className="min-w-0 flex-1">
          {/* 名行：蓝名 + 时间 */}
          <p className="flex items-baseline gap-2">
            <button
              type="button"
              onClick={() => f.openProfile(comment.authorKey)}
              className="max-w-[160px] truncate text-[15px] font-bold"
              style={{ color: t.blue }}
            >
              {a.name}
            </button>
            <span className="shrink-0 text-[12px]" style={{ color: t.secondary }}>
              {relTime(comment.createdAt)}
            </span>
          </p>
          {/* 评论正文 */}
          <p className="mt-[2px] whitespace-pre-wrap break-words text-[15px] leading-[1.45]" style={{ color: t.text }}>
            {comment.content}
          </p>
          {/* 子回复（微信式嵌套：灰盒内每条子回复也是 头像+名字+时间+内容+回复/爱心 完整样式） */}
          {subReplies.length > 0 && (
            <div className="mt-2 rounded-xl px-3 py-1" style={{ background: t.dark ? '#202327' : '#f7f9f9' }}>
              {subReplies.map((s) => {
                const sa = resolveAuthor(s.authorKey);
                const sLiked = s.likes.includes('user');
                const replying = s.replyToName && s.replyToName !== sa.name ? s.replyToName : null;
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`回复 ${sa.name} 的评论`}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button')) return;
                      onReply(comment.id, sa.name); // 点子回复 → 回复该作者（仍挂顶层评论下）
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onReply(comment.id, sa.name);
                    }}
                    className="cursor-pointer rounded-lg py-2 transition-colors active:opacity-60"
                  >
                    <div className="flex gap-2">
                      <XAvatar authorKey={s.authorKey} size={28} onClick={() => f.openProfile(s.authorKey)} />
                      <div className="min-w-0 flex-1">
                        {/* 名行：蓝名 + 时间 */}
                        <p className="flex items-baseline gap-2">
                          <button
                            type="button"
                            onClick={() => f.openProfile(s.authorKey)}
                            className="max-w-[130px] truncate text-[14px] font-bold"
                            style={{ color: t.blue }}
                          >
                            {sa.name}
                          </button>
                          <span className="shrink-0 text-[11px]" style={{ color: t.secondary }}>
                            {relTime(s.createdAt)}
                          </span>
                        </p>
                        {/* 被回复人提示（非顶层作者时） */}
                        {replying && (
                          <p className="text-[12px]" style={{ color: t.secondary }}>
                            回复 <span style={{ color: t.blue }}>@{replying}</span>
                          </p>
                        )}
                        {/* 子回复正文 */}
                        <p className="mt-[1px] whitespace-pre-wrap break-words text-[14px] leading-[1.45]" style={{ color: t.text }}>
                          {s.content}
                        </p>
                        {/* 操作行：回复 / 爱心（与顶层评论一致） */}
                        <div className="mt-1 flex items-center gap-4">
                          <button
                            type="button"
                            onClick={() => onReply(comment.id, sa.name)}
                            className="text-[12px] font-medium active:opacity-50"
                            style={{ color: t.secondary }}
                          >
                            回复
                          </button>
                          <button
                            type="button"
                            aria-label={sLiked ? '取消点赞' : '点赞'}
                            onClick={() => f.likeToggle(s.id)}
                            className="flex items-center gap-1 rounded-full py-[2px] text-[12px] font-medium transition-colors active:opacity-50"
                            style={{ color: sLiked ? t.pink : t.secondary }}
                          >
                            {XIcons.like(sLiked, 13)}
                            {s.likes.length > 0 && <span>{s.likes.length}</span>}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* 操作行：回复 / 赞（微信式小字操作） */}
          <div className="mt-1.5 flex items-center gap-5">
            <button
              type="button"
              onClick={() => onReply(comment.id, a.name)}
              className="text-[13px] font-medium active:opacity-50"
              style={{ color: t.secondary }}
            >
              回复
            </button>
            <button
              type="button"
              aria-label={liked ? '取消点赞' : '点赞'}
              onClick={() => f.likeToggle(comment.id)}
              className="flex items-center gap-1 rounded-full py-[2px] text-[13px] font-medium transition-colors active:opacity-50"
              style={{ color: liked ? t.pink : t.secondary }}
            >
              {XIcons.like(liked, 14)}
              {comment.likes.length > 0 && <span>{comment.likes.length}</span>}
            </button>
          </div>
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
  /** 定向回复目标（null = 回复主帖作者）：commentId = 挂载的顶层评论 id */
  const [replyTarget, setReplyTarget] = useState<{ commentId: string; name: string } | null>(null);
  /** AI 翻译：loading / 译文 / 是否展示 */
  const [tr, setTr] = useState<{ loading: boolean; text: string | null; shown: boolean }>({
    loading: false,
    text: null,
    shown: false,
  });
  const inputRef = useRef<HTMLInputElement | null>(null);

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
   *  被回复对象作者是 AI 时，排一条 AI 嵌套再回复。 */
  const sendReply = () => {
    const text = draft.trim();
    if (!text) return;
    const nd = forumData();
    const targetId = replyTarget?.commentId ?? post.id;
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
      replyTo: targetId,
      replyToName: targetName,
      reposted: false,
    };
    nd.posts.push(reply);
    saveForum({ ...nd });
    setDraft('');
    const targetPost = nd.posts.find((p) => p.id === targetId);
    if (targetPost && targetPost.authorKey !== 'user') queueAiReplyToUserReply(targetId, reply.id);
    setReplyTarget(null);
  };

  /** 点击评论/子回复：定向回复并聚焦输入框 */
  const startReply = (commentId: string, name: string) => {
    setReplyTarget({ commentId, name });
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
          {/* 互动栏（X 官方：回复/转推/书签/分享/点赞，爱心置最右在评论区上方，带数字） */}
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
            {/* 爱心移到最右面（用户要求，位于评论区上方互动栏最右端） */}
            <ThreadAction
              icon={XIcons.like(liked, 21)}
              count={post.likes.length}
              label={liked ? '取消点赞' : '点赞'}
              color={liked ? t.pink : t.secondary}
              hoverColor={t.pink}
              hoverBg="rgba(249,24,128,0.12)"
              onClick={() => f.likeToggle(post.id)}
            />
          </div>
        </div>

        {/* 评论流（微信式嵌套） */}
        {replies.length === 0 ? (
          <p className="py-10 text-center text-[14px]" style={{ color: t.secondary }}>
            还没有回复，来抢沙发
          </p>
        ) : (
          replies.map((r) => <CommentRow key={r.id} comment={r} onReply={startReply} />)
        )}
        <p className="py-6 text-center text-[13px]" style={{ color: t.secondary }}>
          已经到底啦
        </p>
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
