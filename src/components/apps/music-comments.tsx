'use client';

/**
 * 音乐 App 评论半屏面板：热门评论 + 最新评论、点赞（登录）、发表/回复（登录）。
 * 游客可浏览；点赞/发表引导登录（toast 提示）。
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Heart, Loader2, Send } from 'lucide-react';
import {
  commentLike,
  commentsOf,
  getMusicLogin,
  postComment,
  type NcmComment,
} from '@/lib/ios/music-api';
import { useMusic } from '@/lib/ios/music-store';
import { CoverImg, EmptyBlock, LoadingBlock, fmtPlayCount } from './music-shared';

export function CommentsSheet() {
  const song = useMusic((s) => s.commentSong)!;
  const close = useMusic((s) => s.closeComments);
  const [data, setData] = useState<{ hot: NcmComment[]; comments: NcmComment[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<NcmComment | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1600);
  };

  const load = async (offset: number) => {
    try {
      const page = await commentsOf(song.id, 20, offset);
      setData((d) =>
        d && offset > 0
          ? { hot: d.hot, comments: [...d.comments, ...page.comments], total: page.total }
          : { hot: page.hot, comments: page.comments, total: page.total },
      );
      setMore(page.hasMore);
    } catch {
      showToast('评论加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(0);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
     
  }, [song.id]);

  const like = async (c: NcmComment) => {
    if (!getMusicLogin()) {
      showToast('登录后才能点赞');
      return;
    }
    try {
      await commentLike(song.id, c.commentId, c.liked ? 2 : 1);
      setData((d) =>
        d
          ? {
              ...d,
              hot: d.hot.map((x) =>
                x.commentId === c.commentId ? { ...x, liked: !x.liked, likedCount: x.likedCount + (x.liked ? -1 : 1) } : x,
              ),
              comments: d.comments.map((x) =>
                x.commentId === c.commentId ? { ...x, liked: !x.liked, likedCount: x.likedCount + (x.liked ? -1 : 1) } : x,
              ),
            }
          : d,
      );
    } catch {
      showToast('点赞失败');
    }
  };

  const send = async () => {
    if (!text.trim()) return;
    if (!getMusicLogin()) {
      showToast('登录后才能评论');
      return;
    }
    setSending(true);
    try {
      await postComment(song.id, text.trim(), replyTo?.commentId);
      setText('');
      setReplyTo(null);
      showToast('已发布');
      setLoading(true);
      setData(null);
      await load(0);
    } catch {
      showToast('发布失败（可能需要实名/VIP）');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[68] flex items-end" data-testid="music-comments">
      <button type="button" aria-label="关闭" onClick={close} className="absolute inset-0 bg-black/45" />
      <div className="relative flex h-[82%] w-full flex-col rounded-t-2xl bg-white dark:bg-zinc-900">
        {/* 头部 */}
        <div className="flex items-center gap-3 border-b border-black/5 px-4 py-3 dark:border-white/10">
          <button type="button" onClick={close} aria-label="收起">
            <ChevronDown className="h-5 w-5 text-zinc-500" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">
              评论 ({data ? fmtPlayCount(data.total) : '…'})
            </p>
            <p className="truncate text-[11px] text-zinc-400">
              {song.name} - {song.artists?.map((a) => a.name).join('/')}
            </p>
          </div>
          <CoverImg src={song.album?.picUrl} className="h-9 w-9" rounded="rounded-md" alt={song.name} />
        </div>

        {/* 列表 */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          {loading && !data ? (
            <LoadingBlock />
          ) : !data || (data.hot.length === 0 && data.comments.length === 0) ? (
            <EmptyBlock text="还没有评论，来抢沙发" />
          ) : (
            <>
              {data.hot.length > 0 && (
                <>
                  <p className="pb-1 pt-3 text-[12px] font-bold text-zinc-500">热门评论</p>
                  {data.hot.map((c) => (
                    <CommentRow key={c.commentId} c={c} onLike={() => void like(c)} onReply={() => setReplyTo(c)} />
                  ))}
                </>
              )}
              <p className="pb-1 pt-3 text-[12px] font-bold text-zinc-500">最新评论</p>
              {data.comments.map((c) => (
                <CommentRow key={c.commentId} c={c} onLike={() => void like(c)} onReply={() => setReplyTo(c)} />
              ))}
              {more && (
                <button
                  type="button"
                  onClick={() => void load(data.comments.length)}
                  className="mx-auto my-3 block rounded-full border border-zinc-300 px-4 py-1.5 text-[12px] text-zinc-500 dark:border-zinc-600"
                >
                  加载更多
                </button>
              )}
            </>
          )}
        </div>

        {/* 回复引用条 */}
        {replyTo && (
          <div className="flex items-center gap-2 border-t border-black/5 px-4 py-1.5 text-[11px] text-zinc-400 dark:border-white/10">
            <span className="truncate">
              回复 {replyTo.user.nickname}：{replyTo.content}
            </span>
            <button type="button" onClick={() => setReplyTo(null)} className="ml-auto shrink-0 text-zinc-400">
              取消
            </button>
          </div>
        )}

        {/* 输入区 */}
        <div className="flex items-center gap-2 px-4 pb-8 pt-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
            placeholder={getMusicLogin() ? '说点什么…' : '登录后可评论（可先浏览）'}
            data-testid="music-comment-input"
            className="h-10 min-w-0 flex-1 rounded-full bg-black/5 px-4 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:bg-white/10 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !text.trim()}
            data-testid="music-comment-send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#C20C0C] text-white disabled:opacity-40 active:scale-95"
            aria-label="发送"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>

        {toast && (
          <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1.5 text-[12px] text-white">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentRow({ c, onLike, onReply }: { c: NcmComment; onLike: () => void; onReply: () => void }) {
  return (
    <div className="flex gap-2.5 py-2.5">
      <CoverImg src={c.user?.avatarUrl} className="h-8 w-8 shrink-0" rounded="rounded-full" alt={c.user?.nickname} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[12px] font-medium text-zinc-500">{c.user?.nickname}</p>
          <span className="ml-auto shrink-0 text-[10px] text-zinc-300">
            {new Date(c.time).toLocaleDateString('zh-CN')}
          </span>
        </div>
        {c.beRepliedComment && (
          <p className="mt-0.5 truncate rounded bg-black/5 px-2 py-1 text-[11px] text-zinc-400 dark:bg-white/10">
            @{c.beRepliedComment.user?.nickname}：{c.beRepliedComment.content}
          </p>
        )}
        <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200">
          {c.content}
        </p>
        <div className="mt-1 flex items-center gap-4 text-[11px] text-zinc-400">
          <button
            type="button"
            onClick={onLike}
            data-testid={`music-comment-like-${c.commentId}`}
            className="flex items-center gap-1 active:scale-95"
          >
            <Heart
              className={`h-3.5 w-3.5 ${c.liked ? 'text-[#C20C0C]' : ''}`}
              fill={c.liked ? 'currentColor' : 'none'}
            />
            {fmtPlayCount(c.likedCount) || '赞'}
          </button>
          <button type="button" onClick={onReply} className="active:scale-95">
            回复
          </button>
        </div>
      </div>
    </div>
  );
}
