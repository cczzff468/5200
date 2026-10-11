'use client';

/**
 * 音乐 App 心动模式页（底部 TabBar「心动」，第六十三轮）：
 * 根据平时喜欢听的（红心/最近播放/常听）与收藏的生成个性化推荐：
 * - 种子 = 最近红心的 3 首 + 本地最近播放 2 首 + 登录用户服务端听歌周榜（补位）
 * - 每个种子拉相似歌（游客 simiSong 返回空 → 兜底同歌手热门歌），交错合并去重
 *   （同一批不扎堆在一种口味，理由文案跟种子走：因为你收藏的/听过的/常听的《X》）
 * - 种子缺失或结果不足 8 首 → 新歌速递兜底 + 引导文案
 * - 顶部黑胶头卡（同款 netease-spin 旋转黑胶）：正在播心动队列时显示当前歌，
 *   否则显示队列首首「即将播放」；点播放按钮开播整个心动队列
 * - 下拉刷新重新生成一批（种子轮换）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  ChevronsDown,
  Heart,
  Loader2,
  Menu,
  Pause,
  Play,
  Sparkles,
} from 'lucide-react';
import {
  artistSongs,
  personalizedNewSongs,
  simiSong,
  songArtistText,
  songCover,
  userRecord,
  type NcmSong,
} from '@/lib/ios/music-api';
import { useMusic } from '@/lib/ios/music-store';
import { useUI } from '@/lib/ios/store';
import { CoverImg, EmptyBlock, fmtClock } from './music-shared';

/** 推荐结果项：歌 + 推荐理由（跟种子走） */
interface HeartSong {
  song: NcmSong;
  reason: string;
}

/** 洗牌（Fisher–Yates）——刷新时轮换种子与结果顺序 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function MusicHeart({ onSettings }: { onSettings: () => void }) {
  const loginUid = useMusic((s) => s.loginUid);
  const likedIds = useMusic((s) => s.likedIds);
  const likedSongs = useMusic((s) => s.likedSongs);
  const history = useMusic((s) => s.history);
  const playSong = useMusic((s) => s.playSong);
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const position = useMusic((s) => s.position);
  const duration = useMusic((s) => s.duration);
  const toggle = useMusic((s) => s.toggle);

  const [list, setList] = useState<HeartSong[] | null>(null);
  const [hasSeeds, setHasSeeds] = useState(false);
  /** 刷新代次：下拉刷新 +1（重拉并轮换种子） */
  const [nonce, setNonce] = useState(0);

  // 口味数据（红心/历史/登录态）用 ref 快照：只在进页/下拉刷新时取值。
  // 若直接作依赖，播放任一首歌都会写历史 → load 重建 → 列表被重新生成（头卡跳歌、滚动位置丢失）
  const tasteRef = useRef({ likedIds, likedSongs, history, loginUid });
  tasteRef.current = { likedIds, likedSongs, history, loginUid };

  // ---------------- 推荐生成 ----------------

  const load = useCallback(async () => {
    const { likedIds: lids, likedSongs: lSongs, history: hist, loginUid: uid } = tasteRef.current;
    setList(null);
    // 1. 收集种子（收藏优先，其次常听/最近播放）
    const seeds: { song: NcmSong; why: string }[] = [];
    const likedArr = shuffle([...lids]).slice(0, 3); // 每次刷新换一批红心种子
    for (const id of likedArr) {
      const s = lSongs[id];
      if (s) seeds.push({ song: s, why: `因为你收藏的《${s.name}》` });
    }
    for (const h of shuffle(hist).slice(0, 2)) {
      if (lids.has(h.song.id)) continue;
      if (seeds.some((x) => x.song.id === h.song.id)) continue;
      seeds.push({ song: h.song, why: `因为你听过《${h.song.name}》` });
    }
    if (uid && seeds.length < 3) {
      try {
        const rec = await userRecord(uid, 1); // 服务端周听歌榜
        for (const r of rec) {
          if (seeds.length >= 3) break;
          if (lids.has(r.song.id) || seeds.some((x) => x.song.id === r.song.id)) continue;
          seeds.push({ song: r.song, why: `因为你常听《${r.song.name}》` });
        }
      } catch {
        // 拉不到服务端记录就用本地种子
      }
    }
    setHasSeeds(seeds.length > 0);

    // 2. 每个种子拉相似歌（游客 simiSong 返回空 → 兜底同歌手热门歌）
    const groups = await Promise.all(
      seeds.map(async (sd) => {
        try {
          const simi = await simiSong(sd.song.id, 10);
          if (simi.length) {
            return simi.map((s) => ({ song: s, reason: sd.why }));
          }
          const artistId = sd.song.artists?.[0]?.id;
          if (artistId) {
            const r = await artistSongs(artistId, 12);
            // 理由跟种子动词走（收藏的/听过的/常听的），旧版写死「收藏的」与种子类型不符
            const verb = sd.why.includes('收藏') ? '收藏' : sd.why.includes('常听') ? '常听' : '听过';
            return r.songs
              .filter((s) => s.id !== sd.song.id)
              .slice(0, 10)
              .map((s) => ({ song: s, reason: `和你${verb}的《${sd.song.name}》是同一位歌手` }));
          }
          return [];
        } catch {
          return [];
        }
      }),
    );

    // 3. 交错合并去重（各种子轮流出歌，推荐不扎堆；红心已有的不再推）
    const out: HeartSong[] = [];
    const seen = new Set<number>();
    const push = (it: HeartSong) => {
      if (seen.has(it.song.id) || lids.has(it.song.id)) return;
      seen.add(it.song.id);
      out.push(it);
    };
    const maxLen = Math.max(0, ...groups.map((g) => g.length));
    for (let i = 0; i < maxLen && out.length < 30; i++) {
      for (const g of groups) {
        if (g[i]) push(g[i]);
        if (out.length >= 30) break;
      }
    }

    // 4. 兜底：无种子或结果不足 → 新歌速递
    if (out.length < 8) {
      try {
        const ns = await personalizedNewSongs(20);
        for (const s of shuffle(ns)) {
          if (out.length >= 12) break;
          push({ song: s, reason: '新歌速递 · 可能合你口味' });
        }
      } catch {
        // 空态由 EmptyBlock 处理
      }
    }
    setList(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  // ---------------- 下拉刷新（与首页同款手势：顶部下拉重生成一批） ----------------

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pullState, setPullState] = useState<'idle' | 'pulling' | 'ready' | 'loading' | 'done'>('idle');
  const [pullDist, setPullDist] = useState(0);
  const gestureRef = useRef<{ startY: number; fromTop: boolean; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const PULL_THRESHOLD = 64;

  const atTopNow = () => (scrollRef.current ? scrollRef.current.scrollTop <= 0 : false);

  const beginPull = (y: number) => {
    if (pullState === 'loading' || pullState === 'done') return;
    gestureRef.current = { startY: y, fromTop: atTopNow(), moved: false };
  };

  const movePull = (y: number) => {
    const g = gestureRef.current;
    if (!g || pullState === 'loading' || pullState === 'done' || !g.fromTop) return;
    const dist = y - g.startY;
    if (dist <= 0) {
      setPullDist(0);
      setPullState('idle');
      return;
    }
    if (dist > 12) g.moved = true;
    setPullDist(Math.min(dist, 120));
    setPullState(dist > PULL_THRESHOLD ? 'ready' : 'pulling');
  };

  const endPull = () => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (g?.moved) {
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 400);
    }
    if (!g || !g.fromTop) return;
    if (pullState !== 'ready') {
      setPullDist(0);
      setPullState('idle');
      return;
    }
    setPullState('loading');
    setPullDist(44);
    setNonce((n) => n + 1); // 触发重拉（种子轮换）
  };

  // 拉取中 → 完成 → 复位（nonce 驱动 load，这里只管指示器状态）
  useEffect(() => {
    if (pullState !== 'loading') return;
    if (list === null) return; // 还没拉完
    setPullState('done');
    setPullDist(0);
    const t = setTimeout(() => setPullState('idle'), 1200);
    return () => clearTimeout(t);
  }, [list, pullState]);

  const pullHintText =
    pullState === 'ready'
      ? '松开换一批'
      : pullState === 'loading'
        ? '正在生成心动歌单…'
        : pullState === 'done'
          ? '已更新 ✓'
          : '下拉换一批';

  // ---------------- 头卡当前歌 ----------------

  const songs = (list ?? []).map((x) => x.song);
  // 心动队列中的歌在播 → 头卡显示它；否则显示队列首（即将播放）
  const heroSong = current && songs.some((s) => s.id === current.id) ? current : songs[0];
  const heroPlaying = !!heroSong && playing && current?.id === heroSong.id;
  const heroProgress = heroPlaying && duration > 0 ? Math.min(1, position / duration) : 0;
  const playHero = () => {
    if (!songs.length) return;
    if (current && songs.some((s) => s.id === current.id)) toggle();
    else void playSong(songs[0], songs);
  };

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto overscroll-contain pb-[126px]"
      onClickCapture={(e) => {
        if (!suppressClickRef.current) return;
        e.stopPropagation();
        e.preventDefault();
        suppressClickRef.current = false;
      }}
      onTouchStart={(e) => beginPull(e.touches[0]?.clientY ?? 0)}
      onTouchMove={(e) => movePull(e.touches[0]?.clientY ?? 0)}
      onTouchEnd={endPull}
      onTouchCancel={endPull}
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
      {/* 顶栏：与首页同款（设置 + 标题 + 头像） */}
      <div className="sticky top-0 z-20 flex items-center gap-3 bg-[#F8F8F8]/90 px-4 pb-2 pt-[60px] backdrop-blur-xl dark:bg-black/90">
        <button
          type="button"
          onClick={onSettings}
          data-testid="music-heart-settings"
          className="text-zinc-600 active:scale-95 dark:text-zinc-300"
          aria-label="设置"
        >
          <Menu className="h-[22px] w-[22px]" />
        </button>
        <button
          type="button"
          onClick={() => useUI.getState().exitForegroundApp()}
          data-testid="music-heart-title"
          aria-label="返回主界面"
          className="active:scale-95"
        >
          <span className="text-[19px] font-bold text-zinc-900 dark:text-zinc-100">心动</span>
        </button>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-zinc-400">
          <Sparkles className="h-3.5 w-3.5 text-[#C20C0C]/70" />
          根据你的口味生成
        </span>
      </div>

      {/* 下拉刷新指示区 */}
      <div
        className="flex items-end justify-center gap-1.5 overflow-hidden text-[11px] text-zinc-400 transition-[height] duration-150"
        style={{
          height:
            pullState === 'loading' || pullState === 'done'
              ? 36
              : pullDist > 0
                ? Math.min(pullDist * 0.5, 56)
                : 0,
        }}
        data-testid="music-heart-pull-hint"
        aria-live="polite"
      >
        {pullState === 'loading' ? (
          <Loader2 className="mb-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <ChevronsDown className={`mb-2 h-3.5 w-3.5 ${pullState === 'ready' ? 'text-[#C20C0C]' : ''}`} />
        )}
        <span className={`mb-2 ${pullState === 'ready' ? 'font-medium text-[#C20C0C]' : ''}`}>{pullHintText}</span>
      </div>

      {/* 引导条（还没有任何口味数据时） */}
      {!hasSeeds && list !== null && list.length > 0 && (
        <div
          className="mx-4 mb-1 flex items-center gap-2 rounded-xl bg-[#C20C0C]/[0.06] px-3 py-2 text-[11px] leading-snug text-[#C20C0C] dark:bg-[#C20C0C]/[0.12]"
          data-testid="music-heart-hint"
        >
          <Heart className="h-3.5 w-3.5 shrink-0" fill="currentColor" />
          先去听听歌、给喜欢的歌点亮红心，心动模式会更懂你
        </div>
      )}

      {/* 黑胶头卡：有歌时显示（盘面播放中旋转；无歌/加载中不渲染） */}
      {heroSong && (
        <div className="relative mt-1 flex flex-col items-center px-4 pb-2 pt-3">
          {/* 黑胶唱片 */}
          <div className="relative h-[190px] w-[190px]">
            <div
              className="h-full w-full rounded-full bg-[#141416] shadow-[0_10px_30px_rgba(0,0,0,0.28)] animate-[netease-spin_16s_linear_infinite] dark:shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
              style={{ animationPlayState: heroPlaying ? 'running' : 'paused' }}
              data-testid="music-heart-vinyl"
            >
              <span className="absolute inset-[8px] rounded-full border border-white/[0.07]" />
              <span className="absolute inset-[15px] rounded-full border border-white/[0.06]" />
              <span className="absolute inset-[22px] rounded-full border border-white/[0.055]" />
              <span className="absolute inset-[29px] rounded-full border border-white/[0.05]" />
              <span className="absolute inset-[36px] rounded-full border border-white/[0.045]" />
              {/* 盘标 = 封面 + 中心孔 */}
              <span className="absolute left-1/2 top-1/2 h-[68px] w-[68px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-[#f0f0f2]">
                <CoverImg src={songCover(heroSong)} className="h-full w-full" rounded="rounded-full" alt={heroSong.name} />
              </span>
              <span className="absolute left-1/2 top-1/2 h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#141416] ring-2 ring-white/70" />
            </div>
            {/* 唱针：右上枢轴 → 弯臂落在盘面 */}
            <svg aria-hidden="true" viewBox="0 0 100 100" className="absolute -right-4 -top-6 h-[84px] w-[84px]">
              <circle cx="78" cy="14" r="7" fill="#e7e7ea" stroke="#c9c9cf" strokeWidth="1.5" />
              <circle cx="78" cy="14" r="2.6" fill="#8e8e93" />
              <path d="M74 18 C 58 34, 44 44, 34 58" stroke="#d7d7dc" strokeWidth="5" fill="none" strokeLinecap="round" />
              <rect x="27" y="55" width="14" height="8" rx="2.5" fill="#b9b9c0" transform="rotate(38 34 59)" />
            </svg>
          </div>
          {/* 歌名 + 歌手 + 播放按钮 */}
          <div className="mt-4 flex w-full items-center gap-3">
            <button
              type="button"
              onClick={() => current && songs.some((s) => s.id === current.id) && useMusic.getState().openPlayer()}
              data-testid="music-heart-hero-song"
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-[19px] font-bold text-zinc-900 dark:text-zinc-100">{heroSong.name}</p>
              <p className="mt-0.5 flex items-center gap-0.5 truncate text-[13px] text-zinc-500">
                {songArtistText(heroSong)}
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              </p>
            </button>
            <button
              type="button"
              onClick={playHero}
              data-testid="music-heart-play"
              aria-label={heroPlaying ? '暂停' : '播放心动歌单'}
              className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-zinc-900 active:scale-95 dark:bg-white/10 dark:text-white"
            >
              {heroPlaying ? (
                <Pause className="h-6 w-6" fill="currentColor" strokeWidth={0} />
              ) : (
                <Play className="ml-1 h-6 w-6" fill="currentColor" strokeWidth={0} />
              )}
            </button>
          </div>
          {/* 播放进度条（播心动队列中的歌才显示） */}
          {current && songs.some((s) => s.id === current.id) && (
            <div className="mt-3 w-full" data-testid="music-heart-progress">
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/15">
                <div
                  className="h-full rounded-full bg-zinc-500 transition-[width] duration-500 dark:bg-zinc-300"
                  style={{ width: `${heroProgress * 100}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] tabular-nums text-zinc-400">
                <span>{fmtClock(position)}</span>
                <span>{fmtClock(duration)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 推荐列表 */}
      {list === null ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在根据你的口味挑歌…
        </div>
      ) : list.length === 0 ? (
        <EmptyBlock text="暂时没挑出合心意的歌，下拉再试一次" />
      ) : (
        <>
          <div className="flex items-center justify-between px-4 pb-1 pt-4">
            <h2 className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">
              心动歌单 <span className="text-[12px] font-normal text-zinc-400">{list.length} 首</span>
            </h2>
            <button
              type="button"
              onClick={() => songs.length > 0 && void playSong(songs[0], songs)}
              data-testid="music-heart-play-all"
              className="flex items-center gap-1 rounded-full border border-black/10 px-3 py-1 text-[12px] text-zinc-600 active:scale-95 dark:border-white/15 dark:text-zinc-300"
            >
              <Play className="h-3 w-3" fill="currentColor" strokeWidth={0} />
              播放全部
            </button>
          </div>
          <div className="space-y-0.5 px-1 pb-2" data-testid="music-heart-list">
            {list.map((it, i) => (
              <button
                key={it.song.id}
                type="button"
                onClick={() => void playSong(it.song, songs)}
                data-testid={`music-heart-song-${it.song.id}`}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left active:bg-black/5 dark:active:bg-white/10"
              >
                <CoverImg src={songCover(it.song)} className="h-11 w-11 shrink-0" rounded="rounded-lg" alt={it.song.name} />
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-[14px] leading-tight ${
                      current?.id === it.song.id ? 'text-[#C20C0C]' : 'text-zinc-900 dark:text-zinc-100'
                    }`}
                  >
                    {it.song.name}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] leading-tight text-zinc-400">
                    {songArtistText(it.song)} · {it.reason}
                  </p>
                </div>
                {it.song.fee === 1 && (
                  <span className="shrink-0 rounded-[3px] border border-[#C20C0C]/50 px-1 text-[9px] leading-[14px] text-[#C20C0C]">
                    VIP
                  </span>
                )}
                <span className="w-6 shrink-0 text-center text-[13px] tabular-nums text-zinc-300 dark:text-zinc-600">
                  {i + 1}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
