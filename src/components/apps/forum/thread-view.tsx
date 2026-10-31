'use client';

/**
 * X论坛 · 帖子详情页（X thread）。
 * 顶栏：返回 + 「帖子」；主帖 48px 头像 / 名行右侧「关注」黑胶囊；
 * 官方元数据行「H:mm · 年月日 · N 次浏览」（日期与浏览加粗）；统计行（N 转推·N 点赞·N 浏览）；
 * 互动栏（回复/转推/点赞/分享带数字）+ 分隔线下接回复流（PostCard）；
 * 底部回复输入条（头像 + input + 蓝色发送圆钮）。
 */

import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  communityName,
  countShort,
  forumData,
  forumSnapshot,
  repliesOf,
  resolveAuthor,
  saveForum,
  subscribeForum,
  uid,
  REPLY_MAX,
  type ForumPost,
} from '@/lib/forum/core';
import { queueAiReplyToUserReply } from '@/lib/forum/engine';
import { XAvatar, XIcons, VerifiedBadge } from './shared';
import { useForum } from './ctx';
import { PostCard, CommunityIcon, PostMedia, PollBlock, LocationLine } from './feed';

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

export function ThreadView({ postId }: { postId: string }) {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();
  const post = d.posts.find((p) => p.id === postId);
  const replies = useMemo(() => (post ? repliesOf(d, postId) : []), [d, postId, post]);
  const [draft, setDraft] = useState('');
  const [bookmarked, setBookmarked] = useState(false);
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

  /** 发送回复：落为一条帖（replyTo=本帖）+ 原帖作者是 AI 时排再回复 */
  const sendReply = () => {
    const text = draft.trim();
    if (!text) return;
    const nd = forumData();
    const reply: ForumPost = {
      id: uid('p'),
      authorKey: 'user',
      content: text.slice(0, REPLY_MAX),
      community: post.community,
      createdAt: Date.now(),
      likes: [],
      reposts: 0,
      views: 0,
      replyTo: post.id,
      replyToName: a.name,
      reposted: false,
    };
    nd.posts.push(reply);
    saveForum({ ...nd });
    setDraft('');
    queueAiReplyToUserReply(post.id, reply.id);
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
          <p className="mt-2.5 whitespace-pre-wrap break-words text-[17px] leading-[1.42]" style={{ color: t.text }}>
            {post.content}
          </p>
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
          {/* 官方元数据行：H:mm · 年月日 · N 次浏览（日期与浏览加粗） */}
          <p className="mt-2.5 text-[14px]" style={{ color: t.secondary }}>
            {dt.getHours()}:{String(dt.getMinutes()).padStart(2, '0')} ·{' '}
            <b style={{ color: t.text, fontWeight: 700 }}>{dateStr}</b> ·{' '}
            <b style={{ color: t.text, fontWeight: 700 }}>{countShort(post.views)} 次浏览</b>
          </p>
          {/* 互动栏（X 官方：回复/转推/点赞/书签/分享，带数字） */}
          <div className="mt-1 flex items-center justify-between border-b py-3" style={{ borderColor: t.border }}>
            <ThreadAction
              icon={XIcons.reply(21)}
              count={replies.length}
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

        {/* 回复流 */}
        {replies.length === 0 ? (
          <p className="py-10 text-center text-[14px]" style={{ color: t.secondary }}>
            还没有回复，来抢沙发
          </p>
        ) : (
          replies.map((r) => <PostCard key={r.id} post={r} onOpen={() => f.openThread(r.id)} />)
        )}
        <p className="py-6 text-center text-[13px]" style={{ color: t.secondary }}>
          已经到底啦
        </p>
      </div>

      {/* 底部回复输入条（X：头像 + 输入 + 蓝发送钮） */}
      <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2" style={{ borderColor: t.border, background: t.bg }}>
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
            placeholder={`回复 ${a.name}…`}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            style={{ color: t.text, caretColor: t.blue }}
            aria-label={`回复 ${a.name}`}
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
  );
}
