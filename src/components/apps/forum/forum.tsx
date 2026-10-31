'use client';

/**
 * X论坛 App · 主框架。
 *
 * - 主页顶栏（X 官方规格）：左 32px 头像（开侧边抽屉）/ 中 𝕏 Logo / 右「订阅」描边胶囊；
 *   下方独立 tab 行「为你推荐|关注|分类标签…」（左对齐 + 蓝色圆头下划线，可横滑）+
 *   右侧 + 号（添加/管理分类标签，勾选后作为附加 tab 筛选版块帖子）；
 *   sticky backdrop-blur 半透明（X header 观感）。
 * - 底部 5 tab（X 图标底栏，无文字标签）：主页/搜索/社区/通知/私信，选中品牌蓝实心、未选灰。
 * - 右下蓝色发布 FAB（X 圆形 #1d9bf0 + 白色编辑笔）。
 * - 页面栈：thread / profile / community / dm 整页层从右滑入（X push 观感），返回即 pop；
 *   主 tab 层保持挂载（返回后 feed 滚动位置不丢）。
 * - 抽屉（X 侧滑）：个人摘要 + 菜单（个人资料 / 去社区 / 重置论坛数据 / 关于）。
 * - 顶部 pt-[54px] 让出状态栏；底栏 pb-[16px] 让出 Home 横杠（与微信等 App 同口径）。
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Check } from 'lucide-react';
import {
  COMMUNITY_DEFS,
  communityName,
  countShort,
  forumData,
  forumSnapshot,
  followersOf,
  refreshForumAuthors,
  resolveAuthor,
  saveForum,
  subscribeForum,
  uid,
  type ForumPost,
  POST_MAX,
} from '@/lib/forum/core';
import { bootForum, queueUserPostInteractions } from '@/lib/forum/engine';
import { XAvatar, XIcons, XLogo, useXTheme } from './shared';
import { FeedList, FeedSkeleton, CommunityIcon } from './feed';
import { ComposeSheet } from './compose-sheet';
import { ThreadView } from './thread-view';
import { ProfileView } from './profile-view';
import { SearchView, CommunitiesView, CommunityPage, NotificationsView } from './extras';
import { DmsView, DmThread } from './dms';
import { ForumCtx, type ViewSpec } from './ctx';

type Tab = 'home' | 'search' | 'communities' | 'notifications' | 'dms';
const TABS: Tab[] = ['home', 'search', 'communities', 'notifications', 'dms'];

/** 动画 keyframes（推入页右滑入 / 遮罩淡入 / 抽屉左滑入） */
const KEYFRAMES = `
@keyframes forum-in { from { transform: translateX(60%); opacity: .4 } to { transform: translateX(0); opacity: 1 } }
@keyframes forum-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes forum-drawer { from { transform: translateX(-100%) } to { transform: translateX(0) } }
@keyframes forum-sheet { from { transform: translateY(100%) } to { transform: translateY(0) } }
.forum-hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.forum-hide-scrollbar::-webkit-scrollbar { display: none; }
`;

export default function ForumApp() {
  const t = useXTheme();
  const [authorsReady, setAuthorsReady] = useState(false);
  const [tab, setTabRaw] = useState<Tab>('home');
  const [views, setViews] = useState<ViewSpec[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [compose, setCompose] = useState(false);
  const [tagPicker, setTagPicker] = useState(false);
  const [homeTab, setHomeTab] = useState<string>('foryou');
  const [toastMsg, setToastMsg] = useState<{ id: number; text: string } | null>(null);

  // 数据订阅（rev 变化触发重渲）
  useSyncExternalStore(subscribeForum, forumSnapshot, forumSnapshot);

  // 启动：作者快照（联系人/机主名头像）→ 引擎（播种/补新帖/跑 pending）
  useEffect(() => {
    let alive = true;
    void (async () => {
      await refreshForumAuthors();
      if (!alive) return;
      setAuthorsReady(true);
      await bootForum();
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toast = useCallback((text: string) => {
    setToastMsg({ id: Date.now(), text });
  }, []);

  // toast 自动消隐（1.9s）
  useEffect(() => {
    if (!toastMsg) return;
    const h = window.setTimeout(() => setToastMsg(null), 1900);
    return () => window.clearTimeout(h);
  }, [toastMsg]);

  const push = useCallback((v: ViewSpec) => setViews((s) => [...s, v]), []);
  const pop = useCallback(() => setViews((s) => s.slice(0, -1)), []);
  const openThread = useCallback((postId: string) => push({ kind: 'thread', postId }), [push]);
  const openProfile = useCallback((key: string) => push({ kind: 'profile', key }), [push]);
  const openCommunity = useCallback((id: string) => push({ kind: 'community', id }), [push]);
  const openDm = useCallback((peerKey: string) => push({ kind: 'dm', peerKey }), [push]);
  const gotoTab = useCallback((i: number) => {
    setViews([]);
    setTabRaw(TABS[Math.max(0, Math.min(4, i))]);
  }, []);

  const likeToggle = useCallback((postId: string) => {
    const d = forumData();
    const p = d.posts.find((x) => x.id === postId);
    if (!p) return;
    if (p.likes.includes('user')) p.likes = p.likes.filter((k) => k !== 'user');
    else p.likes = [...p.likes, 'user'];
    saveForum({ ...d });
  }, []);

  const repostToggle = useCallback(
    (postId: string) => {
      const d = forumData();
      const p = d.posts.find((x) => x.id === postId);
      if (!p) return;
      if (p.reposted) {
        p.reposted = false;
        p.reposts = Math.max(0, p.reposts - 1);
        toast('已撤销转推');
      } else {
        p.reposted = true;
        p.reposts += 1;
        toast('已转推');
      }
      saveForum({ ...d });
    },
    [toast],
  );

  /** 发帖（compose 发布回调）：落库 + 触发 AI 互动 + 切回主页顶部 */
  const publish = useCallback(
    (text: string, community: string | null) => {
      const d = forumData();
      const post: ForumPost = {
        id: uid('p'),
        authorKey: 'user',
        content: text.slice(0, POST_MAX),
        community: community === 'hot' ? null : community,
        createdAt: Date.now(),
        likes: [],
        reposts: 0,
        views: 0,
        replyTo: null,
        replyToName: null,
      };
      d.posts.push(post);
      saveForum({ ...d });
      queueUserPostInteractions(post);
      setHomeTab('foryou');
      gotoTab(0);
      toast('已发布');
    },
    [gotoTab, toast],
  );

  /** 添加/移除主页分类标签（+ 号：勾选版块 → 作为附加 tab 显示在主页顶部） */
  const toggleTag = useCallback(
    (id: string) => {
      const nd = forumData();
      const cur = nd.pinnedTags ?? [];
      const def = COMMUNITY_DEFS.find((c) => c.id === id);
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      nd.pinnedTags = next;
      saveForum({ ...nd });
      setHomeTab((h) => (h === id && !next.includes(id) ? 'foryou' : h));
      toast(next.includes(id) ? `已添加「${def?.name ?? id}」标签` : `已移除「${def?.name ?? id}」标签`);
    },
    [toast],
  );

  const ui = useMemo(
    () => ({
      t,
      push,
      pop,
      openThread,
      openProfile,
      openCommunity,
      openDm,
      toast,
      likeToggle,
      repostToggle,
      gotoTab,
    }),
    [t, push, pop, openThread, openProfile, openCommunity, openDm, toast, likeToggle, repostToggle, gotoTab],
  );

  const d = forumData();
  const seeded = d.seeded && d.posts.length > 0;
  const pinnedTags = (d.pinnedTags ?? []).filter((id) => COMMUNITY_DEFS.some((c) => c.id === id));

  /** 主页 tab 集：为你推荐 | 关注 | 已添加的分类标签（按添加顺序） */
  const homeTabs: { key: string; label: string }[] = useMemo(
    () => [
      { key: 'foryou', label: '为你推荐' },
      { key: 'following', label: '关注' },
      ...pinnedTags.map((id) => ({ key: id, label: communityName(id) })),
    ],
    [pinnedTags],
  );

  // Feed 数据：为你推荐 = 全部主帖；关注 = 已关注作者的主帖；标签 tab = 对应版块主帖
  const feedPosts = useMemo(() => {
    const all = [...d.posts].sort((a, b) => b.createdAt - a.createdAt).filter((p) => p.replyTo === null);
    if (homeTab === 'following') {
      const followingSet = new Set(d.following);
      return all.filter((p) => followingSet.has(p.authorKey));
    }
    if (homeTab !== 'foryou') {
      return all.filter((p) => (p.community ?? 'hot') === homeTab);
    }
    return all;
  }, [d, homeTab]);

  const unread = d.notifications.filter((n) => !n.read).length;
  const topView = views.length ? views[views.length - 1] : null;

  return (
    <ForumCtx.Provider value={ui}>
      <style>{KEYFRAMES}</style>
      <div className="flex h-full w-full flex-col overflow-hidden" style={{ background: t.bg, color: t.text }}>
        {/* 内容层 */}
        <div className="relative min-h-0 flex-1">
          {/* 主 tab 层（推入页覆盖其上；保持挂载，返回不丢滚动位置） */}
          <div className={views.length ? 'invisible absolute inset-0' : 'absolute inset-0'}>
            {tab === 'home' && (
              <div className="flex h-full flex-col">
                {/* 顶栏（X：头像 | 𝕏 | 订阅）+ tab 行（为你推荐|关注 + +），sticky blur */}
                <div
                  className="sticky top-0 z-20 shrink-0"
                  style={{
                    background: t.dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.78)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                  }}
                >
                  {/* 主顶栏：头像 / 𝕏 / 订阅胶囊 */}
                  <div className="flex items-center justify-between px-4 pt-[54px]" style={{ height: 100 }}>
                    <XAvatar authorKey="user" size={36} onClick={() => setDrawer(true)} />
                    <span aria-hidden="true" style={{ color: t.text }}>
                      <XLogo size={26} />
                    </span>
                    <button
                      type="button"
                      aria-label="订阅"
                      onClick={() => toast('X Premium 订阅暂未开放，敬请期待')}
                      className="flex h-[32px] items-center rounded-full border px-4 text-[13px] font-semibold transition-opacity active:opacity-60"
                      style={{ borderColor: t.dark ? '#536471' : '#cfd9de', color: t.text }}
                    >
                      订阅
                    </button>
                  </div>
                  {/* tab 行：为你推荐 | 关注 | 分类标签… + ＋（添加分类标签），可横滑 */}
                  <div className="flex items-center border-b" style={{ borderColor: t.border, height: 46 }}>
                    <div className="forum-hide-scrollbar flex h-full min-w-0 flex-1 items-center overflow-x-auto">
                      {homeTabs.map(({ key: k, label }) => {
                        const active = homeTab === k;
                        return (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setHomeTab(k)}
                            className="relative flex h-full shrink-0 items-center px-5 text-[15px]"
                            style={{ color: active ? t.text : t.secondary, fontWeight: active ? 700 : 500 }}
                          >
                            {label}
                            {active && (
                              <span
                                className="absolute bottom-0 left-1/2 h-[4px] w-12 -translate-x-1/2 rounded-full"
                                style={{ background: t.blue }}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      aria-label="添加分类标签"
                      onClick={() => setTagPicker(true)}
                      className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors active:bg-black/10 dark:active:bg-white/10"
                      style={{ color: t.secondary }}
                    >
                      {XIcons.plus(22)}
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {authorsReady && seeded ? <FeedList posts={feedPosts} /> : <FeedSkeleton rows={7} />}
                </div>
              </div>
            )}
            {tab === 'search' && <SearchView />}
            {tab === 'communities' && <CommunitiesView />}
            {tab === 'notifications' && <NotificationsView />}
            {tab === 'dms' && <DmsView />}
          </div>

          {/* 推入页层（右滑入覆盖，整页含各自顶栏；底栏保留在下方） */}
          {topView && (
            <div
              key={views.length}
              className="absolute inset-0 z-30 animate-[forum-in_.26s_ease-out]"
              style={{ background: t.bg, overflowY: 'auto' }}
            >
              {topView.kind === 'thread' && <ThreadView postId={topView.postId} />}
              {topView.kind === 'profile' && <ProfileView authorKey={topView.key} />}
              {topView.kind === 'community' && <CommunityPage id={topView.id} />}
              {topView.kind === 'dm' && <DmThread peerKey={topView.peerKey} />}
            </div>
          )}

          {/* 发布 FAB（X：右下蓝圆 + 白编辑笔；所有主 tab 页都显示） */}
          {views.length === 0 && (
            <button
              type="button"
              aria-label="发布帖子"
              onClick={() => setCompose(true)}
              className="absolute bottom-4 right-4 z-40 flex h-[56px] w-[56px] items-center justify-center rounded-full text-white shadow-[0_4px_16px_rgba(0,0,0,0.25)] transition-transform active:scale-90"
              style={{ background: t.blue }}
            >
              {XIcons.compose(26)}
            </button>
          )}
        </div>

        {/* 底部 5 tab（X：纯图标无标签，选中品牌蓝实心） */}
        <nav
          aria-label="论坛主导航"
          className="flex shrink-0 items-stretch justify-around border-t pb-[16px]"
          style={{ borderColor: t.border, background: t.bg }}
        >
          {TABS.map((k) => {
            const active = tab === k && views.length === 0;
            const color = active ? t.blue : t.secondary;
            const icon =
              k === 'home' ? (
                XIcons.home(active)
              ) : k === 'search' ? (
                XIcons.search()
              ) : k === 'communities' ? (
                XIcons.spaces(active, 25, t.bg)
              ) : k === 'notifications' ? (
                XIcons.bell(active)
              ) : (
                XIcons.mail(active)
              );
            return (
              <button
                key={k}
                type="button"
                aria-label={
                  k === 'home'
                    ? '主页'
                    : k === 'search'
                      ? '搜索'
                      : k === 'communities'
                        ? '社区'
                        : k === 'notifications'
                          ? `通知${unread ? `（${unread} 条未读）` : ''}`
                          : '私信'
                }
                onClick={() => {
                  setViews([]);
                  setTabRaw(k);
                }}
                className="relative flex w-full items-center justify-center"
                style={{ color, height: 46 }}
              >
                {icon}
                {k === 'notifications' && unread > 0 && !active && (
                  <span
                    className="absolute left-[calc(50%+15px)] top-[7px] h-[8px] w-[8px] rounded-full"
                    style={{ background: t.blue, boxShadow: `0 0 0 2px ${t.bg}` }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* 侧边抽屉（X 侧滑菜单） */}
        {drawer && (
          <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="论坛菜单">
            <button
              type="button"
              aria-label="关闭菜单"
              className="absolute inset-0 animate-[forum-fade_.2s_ease-out]"
              style={{ background: 'rgba(0,0,0,0.45)' }}
              onClick={() => setDrawer(false)}
            />
            <div
              className="absolute inset-y-0 left-0 w-[78%] max-w-[320px] animate-[forum-drawer_.24s_ease-out] overflow-y-auto"
              style={{ background: t.bg, color: t.text }}
            >
              <div className="px-5 pt-[64px]">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-[22px] font-extrabold" style={{ color: t.text }}>
                    X论坛
                  </span>
                  <span style={{ color: t.text }}>
                    <XLogo size={22} />
                  </span>
                </div>
                {/* 个人摘要（点头像进主页） */}
                <button
                  type="button"
                  onClick={() => {
                    setDrawer(false);
                    openProfile('user');
                  }}
                  className="mt-2 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors active:opacity-70"
                  style={{ background: t.hover }}
                >
                  <XAvatar authorKey="user" size={44} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-bold">{resolveAuthor('user').name}</span>
                    <span className="block truncate text-[13px]" style={{ color: t.secondary }}>
                      @{resolveAuthor('user').handle}
                    </span>
                    <span className="mt-[2px] block text-[13px]" style={{ color: t.secondary }}>
                      <span style={{ color: t.text, fontWeight: 700 }}>{d.following.length}</span> 关注 ·{' '}
                      <span style={{ color: t.text, fontWeight: 700 }}>{followersOf('user')}</span> 粉丝
                    </span>
                  </div>
                </button>
                {/* 菜单 */}
                <div className="mt-4 border-t pt-3" style={{ borderColor: t.border }}>
                  {[
                    {
                      label: '个人资料',
                      hint: '主页与帖子',
                      onClick: () => {
                        setDrawer(false);
                        openProfile('user');
                      },
                    },
                    {
                      label: '去社区逛逛',
                      hint: '版块与广场',
                      onClick: () => {
                        setDrawer(false);
                        gotoTab(2);
                      },
                    },
                    {
                      label: '重置论坛数据',
                      hint: '清空帖子/通知/私信并重新开张',
                      onClick: () => {
                        setDrawer(false);
                        saveForum({
                          ...forumData(),
                          posts: [],
                          notifications: [],
                          dms: [],
                          following: [],
                          likesByMe: {},
                          seeded: false,
                          lastGenAt: 0,
                        });
                        void bootForum();
                        toast('论坛已重置，正在重新开张');
                      },
                    },
                    {
                      label: '关于X论坛',
                      hint: 'v1.0 · 界面 1:1 复刻 X',
                      onClick: () => {
                        setDrawer(false);
                        toast('X论坛 v1.0 —— 公开广场，什么都能聊');
                      },
                    },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.onClick}
                      className="flex w-full flex-col gap-[1px] rounded-xl px-3 py-[10px] text-left transition-colors active:opacity-60"
                    >
                      <span className="text-[15px] font-medium">{item.label}</span>
                      <span className="text-[12px]" style={{ color: t.secondary }}>
                        {item.hint}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="py-6 text-center text-[12px]" style={{ color: t.secondary }}>
                  于 {new Date(d.joinedAt).getMonth() + 1}月{new Date(d.joinedAt).getDate()}日 加入
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 发布弹层 */}
        {compose && <ComposeSheet onClose={() => setCompose(false)} onPublish={publish} />}

        {/* 添加分类标签弹层（+ 号：勾选版块作为主页附加 tab） */}
        {tagPicker && (
          <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="添加分类标签">
            <button
              type="button"
              aria-label="关闭"
              className="absolute inset-0 animate-[forum-fade_.18s_ease-out]"
              style={{ background: 'rgba(0,0,0,0.4)' }}
              onClick={() => setTagPicker(false)}
            />
            <div
              className="forum-hide-scrollbar absolute inset-x-0 bottom-0 max-h-[72%] animate-[forum-sheet_.24s_ease-out] overflow-y-auto rounded-t-2xl pb-[24px]"
              style={{ background: t.bg, color: t.text }}
            >
              <div className="sticky top-0 z-10 pb-1 pt-4" style={{ background: t.bg }}>
                <p className="px-5 text-[17px] font-bold">添加分类标签</p>
                <p className="mt-1 px-5 text-[13px] leading-relaxed" style={{ color: t.secondary }}>
                  勾选的版块会作为标签显示在主页顶部，点击标签即可只看该版块的帖子
                </p>
                <div className="mx-5 mt-3 border-t" style={{ borderColor: t.border }} />
              </div>
              {COMMUNITY_DEFS.map((c) => {
                const on = pinnedTags.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleTag(c.id)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors active:opacity-60"
                    style={{ background: on ? t.hover : 'transparent' }}
                    aria-pressed={on}
                  >
                    <CommunityIcon id={c.id} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold">{c.name}</span>
                      <span className="block truncate text-[13px]" style={{ color: t.secondary }}>
                        {countShort(c.members)} 成员 · {c.desc}
                      </span>
                    </span>
                    <span
                      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
                      style={
                        on
                          ? { background: t.blue, color: '#fff' }
                          : { border: `2px solid ${t.dark ? '#536471' : '#cfd9de'}` }
                      }
                      aria-hidden="true"
                    >
                      {on && <Check width={14} height={14} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
              <p className="px-5 pb-1 pt-3 text-center text-[12px]" style={{ color: t.secondary }}>
                再次点击已勾选的版块可移除标签
              </p>
            </div>
          </div>
        )}

        {/* 底部 toast（X 深色胶囊） */}
        {toastMsg && (
          <div
            role="status"
            className="pointer-events-none absolute inset-x-0 bottom-[86px] z-[60] mx-auto w-fit max-w-[80%] animate-[forum-fade_.18s_ease-out] rounded-full px-4 py-2 text-[14px] text-white shadow-lg"
            style={{ background: 'rgba(0,0,0,0.82)' }}
          >
            {toastMsg.text}
          </div>
        )}
      </div>
    </ForumCtx.Provider>
  );
}
