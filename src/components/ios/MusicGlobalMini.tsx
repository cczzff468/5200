'use client';

/**
 * 全局迷你播放器（第十六轮反馈，第十七轮修订）：音乐在播时，主屏幕/其他 App 上悬浮的播放控件。
 *
 * 三种显示形态（可互相切换，选择持久化在 localStorage）：
 * - bar    底部迷你条：与音乐 App 内底部迷你播放条同款样式（封面 + 歌名 - 歌手 + 播放/暂停 + 列表），
 *          点按条身打开播放页；右侧唱片图标按钮循环切换样式（条 → 唱片 → 隐藏 → 条）；
 * - record 悬浮圆形唱片：贴右边缘的旋转唱片，点按 = 换样式（切回底部条），
 *          右上角 ✕ 点击 = 隐藏，沿右边缘可上下拖动；
 * - hidden 不显示：完全隐藏，可在音乐播放页右上角 ⋮ 面板的「迷你播放器」行重新开启。
 *
 * 显示条件：有正在播放/上次的歌 && 未锁屏 && 未熄屏 && 切换器未打开 && 音乐 App 不在前台
 * （音乐 App 内有自己的迷你条，避免双重显示）。
 *
 * 层级 z-[55]：高于 App 窗口（z-40），低于多任务切换器（z-60）/锁屏（z-65）/状态栏（z-70），
 * 来电/通话等更高层级界面自然盖住。
 */

import { create } from 'zustand';
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Disc3, ListMusic, Pause, Play, X } from 'lucide-react';
import { useUI } from '@/lib/ios/store';
import { useMusic, getGuestAvatar } from '@/lib/ios/music-store';
import { useTogetherLive } from '@/lib/ios/music-ai';
import { songArtistText, songCover } from '@/lib/ios/music-api';

// ---------------- 形态状态（模块级 store：悬浮组件与播放页 ⋮ 面板共用） ----------------

export type MiniMode = 'bar' | 'record' | 'hidden';

const MODE_KEY = 'music-mini-mode';
const MODE_ORDER: MiniMode[] = ['bar', 'record', 'hidden'];

export const MINI_MODE_LABELS: Record<MiniMode, string> = {
  bar: '底部迷你条',
  record: '悬浮唱片',
  hidden: '不显示',
};

function readModeFromStorage(): MiniMode {
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    return v === 'record' || v === 'hidden' ? v : 'bar';
  } catch {
    return 'bar';
  }
}

interface MiniPlayerUiState {
  mode: MiniMode;
  setMode: (m: MiniMode) => void;
  /** 循环切换：底部条 → 悬浮唱片 → 隐藏 → 底部条 */
  cycle: () => MiniMode;
}

export const useMiniPlayer = create<MiniPlayerUiState>((set, get) => ({
  mode: 'bar',
  setMode: (m) => {
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      /* 存储不可用仅本次会话生效 */
    }
    set({ mode: m });
  },
  cycle: () => {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(get().mode) + 1) % MODE_ORDER.length];
    get().setMode(next);
    return next;
  },
}));

if (typeof window !== 'undefined') {
  useMiniPlayer.setState({ mode: readModeFromStorage() });
}

// ---------------- 组件 ----------------

/** 全局打开播放页：先把音乐 App 切到前台，再把导航置为播放页（两步都是同步 store 写入，挂载后直接渲染播放页） */
function openPlayerGlobal() {
  useMusic.getState().openPlayer();
  useUI.getState().switchToApp('music');
}

/** 底部迷你条形态：与音乐 App 内 MiniBar 同款（一起听时左侧双头像） */
function GlobalMiniBar() {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const loginUid = useMusic((s) => s.loginUid);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const live = useTogetherLive();
  const cycle = useMiniPlayer((s) => s.cycle);
  if (!current) return null;
  return (
    <div
      className="pointer-events-auto mx-3 flex h-[52px] items-center rounded-full bg-white pl-[5px] pr-2 shadow-[0_4px_18px_rgba(0,0,0,0.16)] dark:bg-zinc-800 dark:shadow-[0_4px_18px_rgba(0,0,0,0.6)]"
      data-testid="music-global-mini-bar"
    >
      <button
        type="button"
        onClick={openPlayerGlobal}
        data-testid="music-global-mini-open"
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        aria-label="打开播放页"
      >
        {live ? (
          <span className="flex shrink-0 items-center">
            <img src={live.avatar} alt={live.name} className="h-[42px] w-[42px] rounded-full bg-muted object-cover" draggable={false} />
            <img
              src={loginUid ? loginAvatar : getGuestAvatar()}
              alt="我"
              className="-ml-3 h-[42px] w-[42px] rounded-full object-cover ring-2 ring-white dark:ring-zinc-800"
              draggable={false}
            />
          </span>
        ) : (
          <img
            src={songCover(current)}
            alt={current.name}
            className="h-[42px] w-[42px] rounded-full bg-muted object-cover"
            draggable={false}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-[14px] leading-none">
          <span className="font-bold text-zinc-900 dark:text-zinc-100">{current.name}</span>
          <span className="text-zinc-400 dark:text-zinc-500"> - {songArtistText(current)}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => useMusic.getState().toggle()}
        data-testid="music-global-mini-toggle"
        className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[2.5px] border-zinc-300 text-zinc-800 active:scale-95 dark:border-zinc-600 dark:text-zinc-100"
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
      </button>
      <button
        type="button"
        onClick={openPlayerGlobal}
        aria-label="播放列表"
        className="flex h-9 w-8 shrink-0 items-center justify-center text-zinc-800 active:scale-95 dark:text-zinc-100"
      >
        <ListMusic className="h-[22px] w-[22px]" />
      </button>
      {/* 形态切换：底部条 → 悬浮唱片 → 隐藏（第十七轮反馈：点按即换样式） */}
      <button
        type="button"
        onClick={() => cycle()}
        data-testid="music-global-mini-mode"
        aria-label="切换迷你播放器样式"
        title="切换迷你播放器样式"
        className="flex h-9 w-8 shrink-0 items-center justify-center text-zinc-500 active:scale-95 dark:text-zinc-400"
      >
        <Disc3 className="h-[19px] w-[19px]" />
      </button>
    </div>
  );
}

/** 悬浮唱片形态：点按 = 换样式（切回底部条，第十七轮反馈），右上角 ✕ 点击隐藏，沿右边缘可上下拖动 */
function GlobalMiniRecord({ layerRef }: { layerRef: React.RefObject<HTMLDivElement | null> }) {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const setMode = useMiniPlayer((s) => s.setMode);
  // ✕ 按钮的原生拦截：framer-motion 的 tap 手势直接在 motion.div 上挂原生 pointer 监听
  // （先于 React 合成事件触发），必须在 ✕ 的 target 阶段原生拦截 pointer 事件，
  // 否则点 ✕ 会同时触发唱片的换样式 onTap
  const xRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = xRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('pointerdown', stop);
    el.addEventListener('pointerup', stop);
    return () => {
      el.removeEventListener('pointerdown', stop);
      el.removeEventListener('pointerup', stop);
    };
  }, []);

  if (!current) return null;
  return (
    <motion.div
      drag="y"
      dragConstraints={layerRef}
      dragElastic={0.08}
      dragMomentum={false}
      className="pointer-events-auto absolute right-[10px] top-[38%] z-[55] touch-none select-none"
      data-testid="music-global-mini-record"
      onTap={() => setMode('bar')}
    >
      <div className="relative h-[56px] w-[56px]">
        <img
          src={songCover(current)}
          alt={current.name}
          draggable={false}
          className="h-full w-full rounded-full bg-muted object-cover shadow-[0_6px_20px_rgba(0,0,0,0.35)] ring-2 ring-white/70 dark:ring-white/20"
          style={{ animation: 'mini-spin 9s linear infinite', animationPlayState: playing ? 'running' : 'paused' }}
        />
        {/* 右上角 ✕：点击隐藏迷你播放器（原生拦截 pointer 冒泡：不触发换样式/拖拽） */}
        <button
          ref={xRef}
          type="button"
          aria-label="隐藏迷你播放器"
          data-testid="music-global-mini-hide"
          onClick={(e) => {
            e.stopPropagation();
            setMode('hidden');
          }}
          className="absolute -right-[6px] -top-[6px] flex h-[20px] w-[20px] items-center justify-center rounded-full bg-black/75 text-white shadow ring-1 ring-white/30 active:scale-90"
        >
          <X className="h-[11px] w-[11px]" strokeWidth={3} />
        </button>
      </div>
    </motion.div>
  );
}

export default function MusicGlobalMini() {
  const current = useMusic((s) => s.current);
  const mode = useMiniPlayer((s) => s.mode);
  const activeApp = useUI((s) => s.activeApp);
  const locked = useUI((s) => s.locked);
  const screenOff = useUI((s) => s.screenOff);
  const switcherOpen = useUI((s) => s.switcherOpen);
  // 拖动约束参照层：整个手机壳内域（唱片只能在本屏内上下拖）
  const layerRef = useRef<HTMLDivElement | null>(null);

  const visible = !!current && mode !== 'hidden' && !locked && !screenOff && !switcherOpen && activeApp !== 'music';
  if (!visible) return null;

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-[55]" data-testid="music-global-mini">
      {mode === 'bar' ? (
        <div className="absolute inset-x-0 bottom-[36px]">
          <GlobalMiniBar />
        </div>
      ) : (
        <GlobalMiniRecord layerRef={layerRef} />
      )}
    </div>
  );
}
