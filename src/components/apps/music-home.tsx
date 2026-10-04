'use client';

/**
 * 音乐 App 首页：每日推荐大卡、排行榜横滑、推荐歌单网格、新歌速递。
 * 未登录（游客）：推荐歌单/排行榜/新歌仍可用（公开接口），每日推荐引导登录。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronRight,
  ChevronsUp,
  Heart,
  Loader2,
  Menu,
  Play,
  Signal,
  TrendingUp,
} from 'lucide-react';
import {
  artistSongs,
  dailyRecommendSongs,
  personalizedNewSongs,
  personalizedPlaylists,
  simiSong,
  toplist,
  type NcmPlaylist,
  type NcmSong,
  type NcmToplist,
} from '@/lib/ios/music-api';
import { useMusic, getGuestProfile, getGuestAvatar, exitGuestMode } from '@/lib/ios/music-store';
import { useUI } from '@/lib/ios/store';
import { CoverImg, EmptyBlock, LoadingBlock, SectionTitle, fmtPlayCount } from './music-shared';

export function MusicHome({ onSettings }: { onSettings: () => void }) {
  const loginUid = useMusic((s) => s.loginUid);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const loginNickname = useMusic((s) => s.loginNickname);
  const openPlaylist = useMusic((s) => s.openPlaylist);
  const playSong = useMusic((s) => s.playSong);
  const [avatarSheet, setAvatarSheet] = useState(false);
  const guest = getGuestProfile();
  const headAvatar = loginUid ? loginAvatar : getGuestAvatar();
  const headName = loginUid ? loginNickname || '网易云用户' : guest.nickname;
  const [recPlaylists, setRecPlaylists] = useState<NcmPlaylist[] | null>(null);
  const [tops, setTops] = useState<NcmToplist[] | null>(null);
  const [newSongs, setNewSongs] = useState<NcmSong[] | null>(null);
  const [daily, setDaily] = useState<NcmSong[] | null>(null);
  // 根据你喜爱的歌曲推荐（取最近一首红心歌的相似歌）
  const likedIds = useMusic((s) => s.likedIds);
  const [simiSongs, setSimiSongs] = useState<NcmSong[]>([]);
  const simiSeedRef = useRef<number | null>(null);
  // 上滑刷新（第十六轮反馈）：nonce 变化强制重拉相似歌
  const [simiNonce, setSimiNonce] = useState(0);

  // 首页各区块数据加载拆成可重复调用的函数（上滑刷新时全部重拉）
  const loadStatic = useCallback(async () => {
    try {
      setRecPlaylists(await personalizedPlaylists(9));
    } catch {
      setRecPlaylists([]);
    }
    try {
      const t = await toplist();
      setTops(t.slice(0, 6));
    } catch {
      setTops([]);
    }
    try {
      setNewSongs(await personalizedNewSongs(6));
    } catch {
      setNewSongs([]);
    }
  }, []);

  const loadDaily = useCallback(async () => {
    if (!loginUid) return;
    try {
      setDaily(await dailyRecommendSongs());
    } catch {
      setDaily([]);
    }
  }, [loginUid]);

  useEffect(() => {
    void (async () => {
      await loadStatic();
    })();
  }, [loadStatic]);

  useEffect(() => {
    void (async () => {
      await loadDaily();
    })();
  }, [loadDaily]);

  // 根据红心歌推荐：红心变化时以「最近红心的一首」为种子拉相似歌（去掉已红心的）
  // simi/song 需登录（游客返回空）→ 游客兜底用种子歌手的热门歌曲（去掉种子自身）
  // 无红心时不在 effect 里 setState（渲染层直接隐藏区块）
  const likedSongs = useMusic((s) => s.likedSongs);
  useEffect(() => {
    const ids = [...likedIds];
    if (!ids.length) return;
    const seed = ids[ids.length - 1];
    if (simiSeedRef.current === seed) return;
    simiSeedRef.current = seed;
    let on = true;
    void (async () => {
      try {
        let list = await simiSong(seed, 8);
        if (!list.length) {
          const seedSong = likedSongs[seed];
          const artistId = seedSong?.artists?.[0]?.id;
          if (artistId) {
            const r = await artistSongs(artistId, 12);
            list = r.songs.filter((x) => x.id !== seed);
          }
        }
        if (on && simiSeedRef.current === seed) {
          setSimiSongs(list.filter((s) => !likedIds.has(s.id)).slice(0, 6));
        }
      } catch {
        // 拉取失败保持现状（区块不展示）
      }
    })();
    return () => {
      on = false;
    };
  }, [likedIds, likedSongs, simiNonce]);

  // ---------------- 上滑刷新（第十六轮反馈：滑到底部继续上滑 → 重拉首页全部内容） ----------------

  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** idle=未在拉取 pulling=上滑中 ready=超过阈值可松手 loading=刷新中 done=刚完成 */
  const [pullState, setPullState] = useState<'idle' | 'pulling' | 'ready' | 'loading' | 'done'>('idle');
  const [pullDist, setPullDist] = useState(0);
  const gestureRef = useRef<{ startY: number; fromBottom: boolean } | null>(null);
  const PULL_THRESHOLD = 64;

  const atBottomNow = () => {
    const el = scrollRef.current;
    if (!el) return false;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 6;
  };

  const beginPull = (y: number) => {
    if (pullState === 'loading') return;
    gestureRef.current = { startY: y, fromBottom: atBottomNow() };
  };

  const movePull = (y: number) => {
    const g = gestureRef.current;
    if (!g || pullState === 'loading' || pullState === 'done') return;
    if (!g.fromBottom) return;
    const dist = g.startY - y; // 手指向上为正
    if (dist <= 0) {
      setPullDist(0);
      setPullState('idle');
      return;
    }
    setPullDist(Math.min(dist, 120));
    setPullState(dist > PULL_THRESHOLD ? 'ready' : 'pulling');
  };

  const endPull = () => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g || !g.fromBottom) return;
    if (pullState !== 'ready') {
      setPullDist(0);
      setPullState('idle');
      return;
    }
    // 触发刷新：首页所有区块（推荐歌单/排行榜/新歌/每日推荐/相似推荐）全部重拉
    setPullState('loading');
    setPullDist(44);
    simiSeedRef.current = null;
    setSimiNonce((n) => n + 1);
    void Promise.all([loadStatic(), loadDaily()]).finally(() => {
      setPullState('done');
      setPullDist(0);
      setTimeout(() => setPullState('idle'), 1200);
    });
  };

  const today = new Date();

  /** 上滑刷新指示区文案 */
  const pullHintText =
    pullState === 'ready'
      ? '松开立即刷新'
      : pullState === 'loading'
        ? '刷新中…'
        : pullState === 'done'
          ? '已更新 ✓'
          : '上滑刷新';

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto overscroll-contain pb-[126px]"
      onTouchStart={(e) => beginPull(e.touches[0]?.clientY ?? 0)}
      onTouchMove={(e) => movePull(e.touches[0]?.clientY ?? 0)}
      onTouchEnd={endPull}
      onTouchCancel={endPull}
      // 桌面鼠标也能拖拽刷新（E2E/桌面体验）；触摸设备走上面的 touch 事件（滚动接管后 pointercancel 不影响）
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') beginPull(e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') movePull(e.clientY);
      }}
      onPointerUp={(e) => {
        if (e.pointerType === 'mouse') endPull();
      }}
      onPointerCancel={(e) => {
        if (e.pointerType === 'mouse') endPull();
      }}
    >
      {/* 顶栏：设置 + 标题 + 右上角头像（游客/登录都可点） */}
      <div className="sticky top-0 z-20 flex items-center gap-3 bg-[#F8F8F8]/90 px-4 pb-2 pt-[60px] backdrop-blur-xl dark:bg-black/90">
        <button
          type="button"
          onClick={onSettings}
          data-testid="music-home-settings"
          className="text-zinc-600 active:scale-95 dark:text-zinc-300"
          aria-label="设置"
        >
          <Menu className="h-[22px] w-[22px]" />
        </button>
        {/* 点「音乐」两字退出到手机主界面（第十四轮反馈） */}
        <button
          type="button"
          onClick={() => useUI.getState().exitForegroundApp()}
          data-testid="music-home-title"
          aria-label="返回主界面"
          className="active:scale-95"
        >
          <span className="text-[19px] font-bold text-zinc-900 dark:text-zinc-100">音乐</span>
        </button>
        <button
          type="button"
          onClick={() => setAvatarSheet(true)}
          data-testid="music-home-avatar"
          className="ml-auto flex items-center gap-2 active:scale-95"
          aria-label="账号"
        >
          <CoverImg src={headAvatar} className="h-8 w-8" rounded="rounded-full" alt={headName} />
        </button>
      </div>

      {/* 账号快开面板（z-80：必须盖住全局迷你播放条 z-70，否则迷你条悬浮在弹窗中间挡住内容） */}
      {avatarSheet && (
        <div className="absolute inset-0 z-[80] flex items-end">
          <button type="button" aria-label="关闭" onClick={() => setAvatarSheet(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full rounded-t-2xl bg-white p-5 pb-9 dark:bg-zinc-900" data-testid="music-avatar-sheet">
            <div className="mb-4 flex items-center gap-3">
              <CoverImg src={headAvatar} className="h-12 w-12" rounded="rounded-full" alt={headName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-zinc-900 dark:text-zinc-100">{headName}</p>
                <p className="text-[11px] text-zinc-400">{loginUid ? '网易云账号已登录' : '游客模式 · 数据仅保存在本机'}</p>
              </div>
            </div>
            {loginUid ? (
              <button
                type="button"
                onClick={() => {
                  setAvatarSheet(false);
                  onSettings();
                }}
                className="h-11 w-full rounded-full border border-zinc-300 text-[14px] text-zinc-700 active:scale-[0.98] dark:border-zinc-600 dark:text-zinc-200"
              >
                账号与设置
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAvatarSheet(false);
                  exitGuestMode(); // 回登录页（清除游客持久标记）
                }}
                data-testid="music-avatar-login"
                className="h-11 w-full rounded-full bg-[#C20C0C] text-[14px] font-medium text-white active:scale-[0.98]"
              >
                登录网易云账号
              </button>
            )}
            <button
              type="button"
              onClick={() => setAvatarSheet(false)}
              className="mt-2.5 h-11 w-full rounded-full text-[13px] text-zinc-400"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 每日推荐 / 游客引导 */}
      {loginUid ? (
        <button
          type="button"
          onClick={() => openPlaylist(0, 'daily')}
          data-testid="music-home-daily"
          className="relative mx-4 mt-1 flex w-[calc(100%-32px)] items-center gap-4 overflow-hidden rounded-2xl p-4 text-left active:scale-[0.99]"
        >
          {/* 毛玻璃风格（第十六轮反馈；第十七轮修订：删除红色底层，纯磨砂玻璃） */}
          <span aria-hidden="true" className="absolute inset-0 bg-white/60 backdrop-blur-2xl dark:bg-zinc-800/55" />
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-2xl ring-1 ring-white/80 ring-inset dark:ring-white/10"
          />
          <div className="relative flex flex-col items-center rounded-xl bg-white/60 px-3 py-2 ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
            <CalendarDays className="h-5 w-5 text-zinc-800 dark:text-zinc-100" />
            <span className="mt-0.5 text-[10px] text-zinc-700 dark:text-zinc-200">{today.getMonth() + 1}月</span>
            <span className="text-[18px] font-bold leading-none text-zinc-900 dark:text-white">{today.getDate()}</span>
          </div>
          <div className="relative min-w-0 flex-1">
            <p className="text-[17px] font-bold text-zinc-900 dark:text-white">每日推荐</p>
            <p className="mt-0.5 truncate text-[12px] text-zinc-600 dark:text-zinc-300">
              {daily ? `今日限定好歌推荐 · ${daily.length} 首` : '根据你的口味生成个性化歌单'}
            </p>
          </div>
          <Play className="relative h-6 w-6 shrink-0 text-zinc-900 dark:text-white" fill="currentColor" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => useMusic.getState().setTab('mine')}
          className="mx-4 mt-1 flex w-[calc(100%-32px)] items-center gap-4 rounded-2xl bg-gradient-to-r from-zinc-700 to-zinc-900 p-4 text-left text-white active:scale-[0.99]"
          data-testid="music-home-guest-card"
        >
          <Signal className="h-8 w-8 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-bold">游客模式</p>
            <p className="mt-0.5 truncate text-[12px] text-white/70">
              登录网易云账号后可听每日推荐与你的歌单
            </p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </button>
      )}

      {/* 排行榜 */}
      <SectionTitle
        right={
          <TrendingUp className="h-4 w-4 text-zinc-400" />
        }
      >
        排行榜
      </SectionTitle>
      {tops === null ? (
        <LoadingBlock />
      ) : tops.length === 0 ? (
        <EmptyBlock text="榜单获取失败，检查 API 设置" />
      ) : (
        <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1">
          {tops.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => openPlaylist(t.id)}
              className="w-[150px] shrink-0 text-left active:scale-[0.98]"
              data-testid={`music-toplist-${t.id}`}
            >
              <div className="relative">
                <CoverImg src={t.coverImgUrl} className="h-[150px] w-[150px]" rounded="rounded-xl" alt={t.name} />
                <span className="absolute bottom-1.5 left-2 rounded-full bg-black/45 px-2 py-0.5 text-[9px] text-white">
                  {t.updateFrequency}
                </span>
              </div>
              <p className="mt-1.5 truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{t.name}</p>
              {t.tracks?.[0] && (
                <p className="mt-0.5 truncate text-[10px] text-zinc-400">
                  {t.tracks[0].first} - {t.tracks[0].second}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 推荐歌单 */}
      <SectionTitle>推荐歌单</SectionTitle>
      {recPlaylists === null ? (
        <LoadingBlock />
      ) : recPlaylists.length === 0 ? (
        <EmptyBlock text="推荐获取失败" />
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-3 px-4">
          {recPlaylists.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openPlaylist(p.id)}
              className="text-left active:scale-[0.98]"
              data-testid={`music-rec-pl-${p.id}`}
            >
              <div className="relative">
                <CoverImg src={p.picUrl || p.coverImgUrl} className="aspect-square w-full" rounded="rounded-xl" alt={p.name} />
                <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-black/40 px-1.5 py-0.5 text-[9px] text-white">
                  <Play className="h-2.5 w-2.5" fill="currentColor" />
                  {fmtPlayCount(p.playCount)}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-zinc-700 dark:text-zinc-300">
                {p.name}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* 根据你喜爱的歌曲推荐（有红心歌才展示） */}
      {likedIds.size > 0 && simiSongs.length > 0 && (
        <>
          <SectionTitle
            right={
              <Heart className="h-4 w-4 text-zinc-400" />
            }
          >
            根据你喜爱的歌曲推荐
          </SectionTitle>
          <div className="space-y-0.5 px-1" data-testid="music-home-simi">
            {simiSongs.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void playSong(s, simiSongs)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left active:bg-black/5 dark:active:bg-white/10"
              >
                <CoverImg src={s.album?.picUrl} className="h-11 w-11" rounded="rounded-lg" alt={s.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-zinc-900 dark:text-zinc-100">{s.name}</p>
                  <p className="truncate text-[11px] text-zinc-400">
                    {s.artists?.map((a) => a.name).join('/')}
                  </p>
                </div>
                {s.fee === 1 && (
                  <span className="shrink-0 rounded-[3px] border border-[#C20C0C]/50 px-1 text-[9px] leading-[14px] text-[#C20C0C]">
                    VIP
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* 新歌速递 */}
      <SectionTitle>新歌速递</SectionTitle>
      {newSongs === null ? (
        <LoadingBlock />
      ) : newSongs.length === 0 ? (
        <EmptyBlock text="暂无新歌" />
      ) : (
        <div className="space-y-0.5 px-1">
          {newSongs.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => void playSong(s, newSongs)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left active:bg-black/5 dark:active:bg-white/10"
            >
              <CoverImg src={s.album?.picUrl} className="h-11 w-11" rounded="rounded-lg" alt={s.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-zinc-900 dark:text-zinc-100">{s.name}</p>
                <p className="truncate text-[11px] text-zinc-400">
                  {s.artists?.map((a) => a.name).join('/')}
                </p>
              </div>
              {s.fee === 1 && (
                <span className="shrink-0 rounded-[3px] border border-[#C20C0C]/50 px-1 text-[9px] leading-[14px] text-[#C20C0C]">
                  VIP
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 上滑刷新指示区（第十六轮反馈）：随上滑距离展开，松手刷新/刷新中/已更新 */}
      <div
        className="flex items-center justify-center gap-1.5 overflow-hidden text-[11px] text-zinc-400 transition-[height] duration-150"
        style={{
          height:
            pullState === 'loading' || pullState === 'done'
              ? 36
              : pullDist > 0
                ? Math.min(pullDist * 0.5, 56)
                : 0,
        }}
        data-testid="music-home-pull-hint"
        aria-live="polite"
      >
        {pullState === 'loading' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ChevronsUp className={`h-3.5 w-3.5 ${pullState === 'ready' ? 'text-[#C20C0C]' : ''}`} />
        )}
        <span className={pullState === 'ready' ? 'font-medium text-[#C20C0C]' : ''}>{pullHintText}</span>
      </div>
    </div>
  );
}
