'use client';

/**
 * X论坛 · 时间线（帖子卡 / 列表 / 加载骨架）。
 * PostCard 严格按 X 卡片规格：40px 圆头像 + 名行（名字/认证/·时间/更多）+
 * 社区来源行 + 正文 15px + 操作行（回复/转推/点赞/浏览/分享）。
 */

import { memo } from 'react';
import {
  communityName,
  countShort,
  relTime,
  resolveAuthor,
  type ForumPost,
  COMMUNITY_DEFS,
} from '@/lib/forum/core';
import { CommunityTag, VerifiedBadge, XAvatar, XIcons, useXTheme } from './shared';
import { useForum } from './ctx';

/** 正文渲染：#话题# 染品牌蓝（X hashtag 观感） */
function PostText({ text }: { text: string }) {
  const t = useXTheme();
  const parts = text.split(/(#[^#\s]{1,12}#)/g);
  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.38]" style={{ color: t.text }}>
      {parts.map((p, i) =>
        /^#[^#\s]{1,12}#$/.test(p) ? (
          <span key={i} style={{ color: t.blue }}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

/** 操作行单个图标按钮（hover 变色由调用方 style 控制；移动端 active 变色） */
function ActionBtn({
  icon,
  count,
  color,
  hoverColor,
  onClick,
  label,
}: {
  icon: React.ReactNode;
  count?: number;
  color: string;
  hoverColor: string;
  onClick?: (e: React.MouseEvent) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="group flex items-center gap-1 transition-colors active:opacity-60"
      style={{ color }}
      onMouseEnter={(e) => (e.currentTarget.style.color = hoverColor)}
      onMouseLeave={(e) => (e.currentTarget.style.color = color)}
    >
      {icon}
      {typeof count === 'number' && count > 0 && (
        <span className="text-[13px] leading-none">{count < 10000 ? count : countShort(count)}</span>
      )}
    </button>
  );
}

/** X 帖子卡（时间线/回复列表通用） */
export const PostCard = memo(function PostCard({ post, onOpen }: { post: ForumPost; onOpen?: () => void }) {
  const f = useForum();
  const t = f.t;
  const a = resolveAuthor(post.authorKey);
  const liked = post.likes.includes('user');
  const repostedByMe = post.reposted === true;
  const communityLabel = post.community && post.community !== 'hot' ? communityName(post.community) : '';
  const time = relTime(post.createdAt);

  return (
    <article
      className="cursor-pointer border-b px-4 pt-3 transition-colors"
      style={{ borderColor: t.border, background: 'transparent' }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return; // 按钮点击不触发开帖
        onOpen?.();
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = t.hover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div className="flex gap-3">
        <XAvatar authorKey={post.authorKey} size={40} onClick={() => f.openProfile(post.authorKey)} />
        <div className="min-w-0 flex-1">
          {/* 名行：名字 + 认证 + @handle · 时间 + 更多 */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => f.openProfile(post.authorKey)}
              className="max-w-[150px] shrink truncate text-[15px] font-bold"
              style={{ color: t.text }}
            >
              {a.name}
            </button>
            {a.verified && <VerifiedBadge size={14} />}
            <span className="truncate text-[15px]" style={{ color: t.secondary }}>
              @{a.handle} · {time}
            </span>
            <button
              type="button"
              aria-label="更多"
              onClick={() => f.toast('已为你推荐同类帖子')}
              className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors active:bg-black/10 dark:active:bg-white/10"
              style={{ color: t.secondary }}
            >
              {XIcons.more(18)}
            </button>
          </div>
          {/* 回复对象（X：回复 @xx） */}
          {post.replyToName && (
            <p className="mb-[2px] text-[14px]" style={{ color: t.secondary }}>
              回复 <span style={{ color: t.blue }}>@{post.replyToName}</span>
            </p>
          )}
          {/* 社区来源（X Communities 帖子显示来自哪个社区） */}
          {communityLabel && (
            <div className="mb-[4px] mt-[2px]">
              <CommunityTag
                name={communityLabel}
                onClick={() => {
                  if (post.community) f.openCommunity(post.community);
                }}
              />
            </div>
          )}
          <PostText text={post.content} />
          {/* 操作行：X 顺序 回复/转推/点赞/浏览/分享 */}
          <div className="mt-2 mb-1 flex max-w-[330px] items-center justify-between">
            <ActionBtn
              icon={XIcons.reply()}
              count={0}
              label="回复"
              color={t.secondary}
              hoverColor={t.blue}
              onClick={() => f.openThread(post.id)}
            />
            <ActionBtn
              icon={XIcons.repost()}
              count={post.reposts}
              label="转推"
              color={repostedByMe ? t.green : t.secondary}
              hoverColor={t.green}
              onClick={() => f.repostToggle(post.id)}
            />
            <ActionBtn
              icon={XIcons.like(liked)}
              count={post.likes.length}
              label={liked ? '取消点赞' : '点赞'}
              color={liked ? t.pink : t.secondary}
              hoverColor={t.pink}
              onClick={() => f.likeToggle(post.id)}
            />
            <ActionBtn
              icon={XIcons.views()}
              count={post.views}
              label="浏览"
              color={t.secondary}
              hoverColor={t.blue}
              onClick={() => f.toast(`该帖已有 ${post.views} 次浏览`)}
            />
            <ActionBtn
              icon={XIcons.share()}
              label="分享"
              color={t.secondary}
              hoverColor={t.blue}
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
      </div>
    </article>
  );
});

/** 时间线列表（已过滤排序好的 posts）+ 到底提示 */
export function FeedList({ posts }: { posts: ForumPost[] }) {
  const t = useXTheme();
  const f = useForum();
  return (
    <div>
      {posts.map((p) => (
        <PostCard key={p.id} post={p} onOpen={() => f.openThread(p.id)} />
      ))}
      <p className="py-6 text-center text-[13px]" style={{ color: t.secondary }}>
        {posts.length ? '已经到底啦 · X论坛' : ''}
      </p>
    </div>
  );
}

/** X 风格加载骨架（灰圆 + 两灰条） */
export function FeedSkeleton({ rows = 6 }: { rows?: number }) {
  const t = useXTheme();
  return (
    <div aria-label="加载中">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 border-b px-4 pt-3 pb-4" style={{ borderColor: t.border }}>
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full" style={{ background: t.border }} />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-32 animate-pulse rounded-full" style={{ background: t.border }} />
            <div className="h-3 w-full animate-pulse rounded-full" style={{ background: t.border }} />
            <div className="h-3 w-2/3 animate-pulse rounded-full" style={{ background: t.border }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 空状态（X：居中灰字 + 行动按钮） */
export function EmptyState({ text, action, actionLabel }: { text: string; action?: () => void; actionLabel?: string }) {
  const t = useXTheme();
  return (
    <div className="flex flex-col items-center gap-4 px-10 pt-20 text-center">
      <p className="text-[15px] leading-relaxed" style={{ color: t.secondary }}>
        {text}
      </p>
      {action && actionLabel && (
        <button
          type="button"
          onClick={action}
          className="rounded-full px-5 h-[34px] text-[14px] font-bold text-white active:opacity-70"
          style={{ background: t.blue }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/** 社区色卡（社区页/列表共用） */
export function CommunityIcon({ id, size = 44 }: { id: string; size?: number }) {
  const def = COMMUNITY_DEFS.find((c) => c.id === id);
  const bg = def?.coverBg ?? '#1d9bf0';
  const ch = (def?.name ?? '论').slice(0, 1);
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[14px] font-bold text-white"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.4 }}
    >
      {ch}
    </div>
  );
}
