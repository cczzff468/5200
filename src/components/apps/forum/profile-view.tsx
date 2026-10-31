'use client';

/**
 * X论坛 · 个人主页（X profile，按官方截图精修）。
 * 顶栏：返回 + 名字(bold) + 蓝V + 「N 帖子」副标题 + 右侧探索/搜索图标；
 * 横幅 150px（自己可从手机上传背景图，右上相机按钮）+ 80px 头像半嵌（4px 底色描边）+
 * 按钮排（他人：…/信封/关注黑胶囊；自己：编辑资料描边胶囊 → 编辑资料弹层）+ 名字区 +
 * 「获得认证」浅蓝胶囊（未认证）+ Joined 行 + 「N 正在关注 N 关注者」统计
 * （自己可自定义展示数）+ 四 tab（帖子▼/回复/转推/媒体，蓝下划线；
 * 自己的「回复」= 别人回复我的，非我评论别人的）。
 */

import { useRef, useState, useSyncExternalStore } from 'react';
import { Camera, ChevronDown } from 'lucide-react';
import {
  followersOf,
  forumData,
  forumSnapshot,
  myFollowingCount,
  postsOf,
  resolveAuthor,
  saveForum,
  saveForumProfile,
  subscribeForum,
  type AuthorKey,
} from '@/lib/forum/core';
import { XAvatar, XIcons, VerifiedBadge } from './shared';
import { useForum } from './ctx';
import { PostCard, EmptyState } from './feed';
import { EditProfileSheet, fileToBannerDataUrl } from './profile-edit';

type PTab = 'posts' | 'replies' | 'reposts' | 'media';
const PTABS: [PTab, string][] = [
  ['posts', '帖子'],
  ['replies', '回复'],
  ['reposts', '转推'],
  ['media', '媒体'],
];

export function ProfileView({ authorKey }: { authorKey: AuthorKey }) {
  const f = useForum();
  const t = f.t;
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);
  const d = forumData();
  const a = resolveAuthor(authorKey);
  const isMe = authorKey === 'user';
  const followed = d.following.includes(authorKey);
  const [pTab, setPTab] = useState<PTab>('posts');
  const [editing, setEditing] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);
  // 直算不 memo：数据对象会被引擎原位变更，memo 依赖不可靠（react-hooks 规则）
  const all = postsOf(d, authorKey);
  const ownPosts = all.filter((p) => p.replyTo === null);
  const replyPosts = all.filter((p) => p.replyTo !== null);
  // 「回复」tab（自己的主页）：别人回复我的（回复我任何帖/评论的），非我评论别人的
  const myPostIdSet = new Set(d.posts.filter((p) => p.authorKey === 'user').map((p) => p.id));
  const repliesToMe = d.posts
    .filter((p) => p.authorKey !== 'user' && p.replyTo !== null && myPostIdSet.has(p.replyTo))
    .sort((x, y) => y.createdAt - x.createdAt);
  const joined = new Date(d.joinedAt);
  const joinedLabel = `${joined.getFullYear()}年${joined.getMonth() + 1}月加入`;
  const myBanner = isMe ? d.profile?.banner : undefined;
  const bannerBg = a.npcAvatar?.bg ?? (a.key.startsWith('char:') ? '#5b7d9e' : '#657786');
  const followingCount = isMe ? myFollowingCount(d) : 3 + (all.length > 3 ? 2 : 0);

  /** 当前 tab 的列表内容 */
  const list = ownPosts.map((p) => (
    <PostCard key={p.id} post={p} onOpen={() => f.openThread(p.id)} />
  ));
  const repliesList = (isMe ? repliesToMe : replyPosts).map((p) => (
    <PostCard key={p.id} post={p} onOpen={() => f.openThread(p.id)} />
  ));

  /** 横幅快捷上传（仅自己）：选图 → 3:1 裁剪 → 直接落库 */
  const onBannerQuickUpload = (file: File | undefined) => {
    if (!file) return;
    fileToBannerDataUrl(file)
      .then((dataUrl) => {
        saveForumProfile({ banner: dataUrl });
        f.toast('背景图已更新');
      })
      .catch(() => f.toast('图片处理失败，换一张试试'));
  };

  const toggleFollow = () => {
    const nd = forumData();
    if (followed) nd.following = nd.following.filter((k) => k !== authorKey);
    else nd.following = [...nd.following, authorKey];
    f.toast(followed ? `已取消关注 ${a.name}` : `已关注 ${a.name}，「关注」页将出现 TA 的帖子`);
    saveForum({ ...nd });
  };

  return (
    <div className="flex h-full flex-col" style={{ background: t.bg, color: t.text }}>
      {/* 顶栏：返回 + 名字/帖子数 + 右侧图标（半透明悬浮在横幅上） */}
      <div
        className="sticky top-0 z-20"
        style={{ background: t.dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)', backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-3 px-3 pt-[54px]" style={{ height: 100 }}>
          <button
            type="button"
            aria-label="返回"
            onClick={f.pop}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.back(20)}
          </button>
          <div className="min-w-0 flex-1">
            <span className="flex items-center gap-1 truncate text-[17px] font-bold">
              <span className="truncate">{a.name}</span>
              {a.verified && <VerifiedBadge size={15} />}
            </span>
            <span className="block text-[13px]" style={{ color: t.secondary }}>
              {ownPosts.length} 帖子
            </span>
          </div>
          <button
            type="button"
            aria-label="去社区探索"
            onClick={() => f.gotoTab(2)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.compass(21)}
          </button>
          <button
            type="button"
            aria-label="去搜索"
            onClick={() => f.gotoTab(1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:bg-black/10 dark:active:bg-white/10"
            style={{ color: t.text }}
          >
            {XIcons.search(21)}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 横幅（150px，X 官方比例；自己可上传手机相册图片作背景） */}
        <div
          className="relative h-[150px] w-full shrink-0 overflow-hidden"
          style={myBanner ? undefined : { background: `linear-gradient(135deg, ${bannerBg}, ${t.dark ? '#1b2733' : '#c9d6e2'})` }}
        >
          {myBanner && <img src={myBanner} alt="主页背景图" className="h-full w-full object-cover" />}
          {isMe && (
            <button
              type="button"
              onClick={() => bannerInputRef.current?.click()}
              className="absolute right-3 top-3 flex h-[30px] items-center gap-1.5 rounded-full bg-black/50 px-3 text-[12px] font-semibold text-white backdrop-blur-sm transition-opacity active:opacity-70"
              style={{ color: '#fff' }}
            >
              <Camera width={14} height={14} strokeWidth={2} aria-hidden="true" />
              {myBanner ? '更换背景' : '上传背景'}
            </button>
          )}
        </div>
        {/* 头像 + 操作排（X：80px 半嵌横幅，4px 底色描边） */}
        <div className="px-4">
          <div className="-mt-[40px] flex items-end justify-between">
            <span className="rounded-full" style={{ boxShadow: `0 0 0 4px ${t.bg}`, borderRadius: 999 }}>
              <XAvatar authorKey={authorKey} size={80} />
            </span>
            <div className="mb-[24px] flex items-center gap-2">
              {isMe ? (
                <button
                  type="button"
                  aria-label="编辑资料"
                  onClick={() => setEditing(true)}
                  className="flex h-[34px] items-center rounded-full border px-4 text-[14px] font-bold transition-opacity active:opacity-60"
                  style={{ borderColor: t.dark ? '#536471' : '#cfd9de', color: t.text }}
                >
                  编辑资料
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label="更多操作"
                    onClick={() => f.toast('已收到反馈，感谢让论坛更好')}
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-full border transition-colors active:opacity-60"
                    style={{ borderColor: t.dark ? '#536471' : '#cfd9de', color: t.text }}
                  >
                    {XIcons.more(18)}
                  </button>
                  <button
                    type="button"
                    aria-label="发私信"
                    onClick={() => f.openDm(authorKey)}
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-full border transition-colors active:opacity-60"
                    style={{ borderColor: t.dark ? '#536471' : '#cfd9de', color: t.text }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label={followed ? '取消关注' : '关注'}
                    onClick={toggleFollow}
                    className="flex h-[34px] items-center rounded-full px-5 text-[14px] font-bold transition-opacity active:opacity-60"
                    style={
                      followed
                        ? { border: `1px solid ${t.dark ? '#536471' : '#cfd9de'}`, color: t.text, background: 'transparent' }
                        : { background: t.text, color: t.bg, border: 'none' }
                    }
                  >
                    {followed ? '已关注' : '关注'}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 名字 / 认证 / 简介 / 统计 */}
          <div className="mt-3">
            <div className="flex items-center gap-1">
              <h1 className="text-[20px] font-extrabold leading-tight">{a.name}</h1>
              {a.verified && <VerifiedBadge size={16} />}
            </div>
            <p className="text-[14px]" style={{ color: t.secondary }}>
              @{a.handle}
            </p>
            {/* 获得认证胶囊（X 官方「Get verified」样式，未认证账号展示） */}
            {!a.verified && (
              <button
                type="button"
                aria-label="获得认证"
                onClick={() => f.toast('认证功能即将开放，敬请期待')}
                className="mt-2 flex h-[28px] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-opacity active:opacity-60"
                style={{ background: 'rgba(29,155,240,0.12)', color: t.blue }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                获得认证
              </button>
            )}
            {a.bio && <p className="mt-2 text-[15px] leading-snug">{a.bio}</p>}
            <p className="mt-2 flex items-center gap-1 text-[14px]" style={{ color: t.secondary }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
              </svg>
              {joinedLabel}
            </p>
            <p className="mt-2 flex items-center gap-3 text-[14px]" style={{ color: t.secondary }}>
              <span>
                <span style={{ color: t.text, fontWeight: 700 }}>{followingCount.toLocaleString()}</span> 正在关注
              </span>
              <span>
                <span style={{ color: t.text, fontWeight: 700 }}>{followersOf(authorKey).toLocaleString()}</span> 关注者
              </span>
            </p>
          </div>

          {/* 四 tab（X：帖子▼/回复/转推/媒体，蓝下划线） */}
          <div className="mt-3 flex items-stretch border-b" style={{ borderColor: t.border }}>
            {PTABS.map(([k, label]) => {
              const active = pTab === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPTab(k)}
                  className="relative flex h-[44px] flex-1 items-center justify-center gap-1 text-[15px]"
                  style={{ color: active ? t.text : t.secondary, fontWeight: active ? 800 : 500 }}
                  aria-current={active ? 'page' : undefined}
                >
                  {label}
                  {k === 'posts' && <ChevronDown width={14} height={14} strokeWidth={2} aria-hidden="true" />}
                  {active && (
                    <span
                      className="absolute bottom-0 left-1/2 h-[4px] w-14 -translate-x-1/2 rounded-full"
                      style={{ background: t.blue }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* tab 内容 */}
          {pTab === 'posts' &&
            (ownPosts.length ? (
              list
            ) : (
              <EmptyState text={isMe ? '还没有发过帖子，点右下角蓝色按钮发一条吧' : 'TA 还没有发过帖子'} />
            ))}
          {pTab === 'replies' &&
            (repliesList.length ? (
              repliesList
            ) : (
              <EmptyState
                text={
                  isMe
                    ? '别人回复你的内容会出现在这里，多发帖和大家聊聊吧'
                    : 'TA 还没有回复过别人'
                }
              />
            ))}
          {pTab === 'reposts' && <EmptyState text={isMe ? '转推过的帖子会出现在这里' : 'TA 还没有转推'} />}
          {pTab === 'media' && <EmptyState text={isMe ? '帖子附带的图片会出现在这里' : 'TA 还没有媒体内容'} />}
          <p className="py-6 text-center text-[13px]" style={{ color: t.secondary }}>
            已经到底啦
          </p>
        </div>
      </div>

      {/* 隐藏文件选择器（横幅快捷上传，仅自己） */}
      {isMe && (
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            onBannerQuickUpload(e.target.files?.[0]);
            e.currentTarget.value = '';
          }}
        />
      )}

      {/* 编辑资料弹层 */}
      {editing && <EditProfileSheet onClose={() => setEditing(false)} />}
    </div>
  );
}
