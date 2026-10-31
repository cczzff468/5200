'use client';

/**
 * X论坛 · 个人主页（X profile）。
 * 横幅（社区色系渐变）+ 72px 头像（-mt 叠压，X 经典错位）+ 名字/@handle/简介/加入时间 +
 * 关注·粉丝统计 + 操作排（他人：关注/发私信；自己：说明头像名字跟随系统资料）。
 * 帖子列表（含 TA 的回复，X 主 tab 行为）。
 */

import { useSyncExternalStore } from 'react';
import {
  followersOf,
  forumData,
  forumSnapshot,
  postsOf,
  resolveAuthor,
  saveForum,
  subscribeForum,
  type AuthorKey,
} from '@/lib/forum/core';
import { XAvatar, XButton, XIcons, VerifiedBadge } from './shared';
import { useForum } from './ctx';
import { PostCard, EmptyState } from './feed';

export function ProfileView({ authorKey }: { authorKey: AuthorKey }) {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();
  const a = resolveAuthor(authorKey);
  const isMe = authorKey === 'user';
  const followed = d.following.includes(authorKey);
  // 直算不 memo：数据对象会被引擎原位变更，memo 依赖不可靠（react-hooks 规则）
  const posts = postsOf(d, authorKey);
  const joined = new Date(d.joinedAt);
  const joinedLabel = `${joined.getFullYear()}年${joined.getMonth() + 1}月加入`;
  const bannerBg = a.npcAvatar?.bg ?? (a.key.startsWith('char:') ? '#5b7d9e' : '#657786');

  return (
    <div className="flex h-full flex-col" style={{ background: t.bg, color: t.text }}>
      {/* 顶栏（悬浮在横幅上，半透明） */}
      <div
        className="sticky top-0 z-20"
        style={{ background: t.dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)', backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-3 px-3 pt-[54px]" style={{ height: 104 }}>
          <button
            type="button"
            aria-label="返回"
            onClick={f.pop}
            className="flex h-9 w-9 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.back(20)}
          </button>
          <div className="min-w-0">
            <span className="block truncate text-[17px] font-bold">{a.name}</span>
            <span className="block text-[12px]" style={{ color: t.secondary }}>
              {posts.length} 条帖子
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 横幅 */}
        <div
          aria-hidden="true"
          className="h-[100px] w-full"
          style={{ background: `linear-gradient(135deg, ${bannerBg}, ${t.dark ? '#1b2733' : '#c9d6e2'})` }}
        />
        {/* 头像 + 操作排（X 错位叠加） */}
        <div className="px-4">
          <div className="-mt-[36px] flex items-end justify-between">
            <span className="rounded-full ring-4" style={{ boxShadow: `0 0 0 4px ${t.bg}`, borderRadius: 999 }}>
              <XAvatar authorKey={authorKey} size={72} />
            </span>
            <div className="mb-2 flex items-center gap-2">
              {!isMe && (
                <button
                  type="button"
                  aria-label="发私信"
                  onClick={() => f.openDm(authorKey)}
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-full border active:opacity-60"
                  style={{ borderColor: t.border, color: t.text, background: t.bg }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
              {!isMe && (
                <XButton
                  variant={followed ? 'outline' : 'dark'}
                  onClick={() => {
                    const nd = forumData();
                    if (followed) nd.following = nd.following.filter((k) => k !== authorKey);
                    else nd.following = [...nd.following, authorKey];
                    f.toast(followed ? `已取消关注 ${a.name}` : `已关注 ${a.name}，「关注」页将出现 TA 的帖子`);
                    saveForum({ ...nd });
                  }}
                >
                  {followed ? (
                    <span className="flex items-center gap-1">
                      {XIcons.following(14)}已关注
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">{XIcons.follow(14)}关注</span>
                  )}
                </XButton>
              )}
            </div>
          </div>

          {/* 名字 / 认证 / 简介 / 统计 */}
          <div className="mt-2">
            <div className="flex items-center gap-1">
              <h1 className="text-[21px] font-extrabold leading-tight">{a.name}</h1>
              {a.verified && <VerifiedBadge size={17} />}
            </div>
            <p className="text-[14px]" style={{ color: t.secondary }}>
              @{a.handle}
            </p>
            {a.bio && <p className="mt-2 text-[15px] leading-snug">{a.bio}</p>}
            <p className="mt-2 flex items-center gap-1 text-[13px]" style={{ color: t.secondary }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
              </svg>
              {joinedLabel}
            </p>
            <p className="mt-2 text-[14px]" style={{ color: t.secondary }}>
              <span style={{ color: t.text, fontWeight: 700 }}>{isMe ? d.following.length : 3 + (posts.length > 3 ? 2 : 0)}</span> 关注 ·{' '}
              <span style={{ color: t.text, fontWeight: 700 }}>{followersOf(authorKey)}</span> 粉丝
            </p>
            {isMe && (
              <p className="mt-2 text-[13px]" style={{ color: t.secondary }}>
                头像与名字跟随「主题 App › 专属资料」和联系人资料自动同步
              </p>
            )}
          </div>

          {/* 帖子列表 */}
          <div className="mt-3">
            {posts.length ? (
              posts.map((p) => <PostCard key={p.id} post={p} onOpen={() => f.openThread(p.id)} />)
            ) : (
              <EmptyState text={isMe ? '还没有发过帖子，点右下角蓝色按钮发一条吧' : 'TA 还没有发过帖子'} />
            )}
            <p className="py-6 text-center text-[13px]" style={{ color: t.secondary }}>
              已经到底啦
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
