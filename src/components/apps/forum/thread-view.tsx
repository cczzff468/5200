'use client';

/**
 * X论坛 · 帖子详情页（X thread）。
 * 顶栏：返回 + 「帖子」；原帖放大（40 头像 / 17px 正文）；数据行 N 转推·N 点赞·N 浏览；
 * 粗分隔线下接回复流（PostCard）；底部回复输入条（头像 + input + 蓝色发送圆钮）。
 */

import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import { XAvatar, XIcons, VerifiedBadge } from './shared';
import { useForum } from './ctx';
import { PostCard } from './feed';

export function ThreadView({ postId }: { postId: string }) {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();
  const post = d.posts.find((p) => p.id === postId);
  const replies = useMemo(() => (post ? repliesOf(d, postId) : []), [d, postId, post]);
  const [draft, setDraft] = useState('');
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
        <div className="flex items-center gap-4 px-4 pt-[54px]" style={{ height: 106 }}>
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
        <div className="px-4 pt-3 pb-2">
          <div className="flex gap-3">
            <XAvatar authorKey={post.authorKey} size={40} onClick={() => f.openProfile(post.authorKey)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => f.openProfile(post.authorKey)}
                  className="max-w-[160px] truncate text-[16px] font-bold"
                  style={{ color: t.text }}
                >
                  {a.name}
                </button>
                {a.verified && <VerifiedBadge size={15} />}
              </div>
              <span className="block text-[14px]" style={{ color: t.secondary }}>
                @{a.handle}
              </span>
            </div>
            <button
              type="button"
              aria-label="更多"
              onClick={() => f.toast('已为你推荐同类帖子')}
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
              style={{ color: t.secondary }}
            >
              {XIcons.more(18)}
            </button>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-[17px] leading-[1.4]" style={{ color: t.text }}>
            {post.content}
          </p>
          {communityLabel && (
            <p className="mt-2 text-[13px]" style={{ color: t.secondary }}>
              发布于{' '}
              <button type="button" className="font-bold" style={{ color: t.blue }} onClick={() => post.community && f.openCommunity(post.community)}>
                {communityLabel}
              </button>{' '}
              · {relTime(post.createdAt)}
            </p>
          )}
          {!communityLabel && (
            <p className="mt-2 text-[13px]" style={{ color: t.secondary }}>
              {relTime(post.createdAt)}
            </p>
          )}
          {/* 数据行（X：转推 · 点赞 · 浏览） */}
          <div className="mt-3 flex flex-wrap items-center gap-x-2 border-y py-3 text-[14px]" style={{ borderColor: t.border, color: t.secondary }}>
            <span>
              <b style={{ color: t.text }}>{countShort(post.reposts)}</b> 转推
            </span>
            <span>
              <b style={{ color: t.text }}>{countShort(post.likes.length)}</b> 点赞
            </span>
            <span>
              <b style={{ color: t.text }}>{countShort(post.views)}</b> 浏览
            </span>
          </div>
          {/* 点赞头像排（有互动时展示，X 观感） */}
          {post.likes.length > 0 && (
            <div className="mt-2 flex items-center gap-[-6px] overflow-hidden">
              {post.likes.slice(0, 8).map((k) => (
                <span key={k} className="-ml-[6px] first:ml-0 rounded-full ring-2" style={{ boxShadow: `0 0 0 2px ${t.bg}` }}>
                  <XAvatar authorKey={k} size={22} />
                </span>
              ))}
              {post.likes.length > 8 && (
                <span className="ml-2 text-[13px]" style={{ color: t.secondary }}>
                  等 {post.likes.length} 人觉得不错
                </span>
              )}
            </div>
          )}
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
