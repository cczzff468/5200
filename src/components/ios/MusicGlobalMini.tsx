'use client';

/**
 * 全局迷你播放器（第十六轮反馈，第十八轮修订）：音乐在播时，主屏幕/其他 App 上悬浮的播放控件。
 *
 * 三种显示形态（可互相切换，选择持久化在 localStorage）：
 * - bar    迷你小条（第十八轮反馈：变小+可拖动）：封面 + 歌名 - 歌手 + 播放/暂停 + 列表 + 换样式，
 *          点按条身打开播放页；可在屏幕内任意拖动；右侧唱片图标按钮循环切换样式（条 → 唱片 → 隐藏 → 条）；
 * - record 悬浮圆形唱片：贴右边缘的旋转唱片，点按 = 换样式（切回底部条），
 *          右上角 ✕（第十八轮反馈：更小）点击 = 隐藏，可在屏幕内任意拖动；
 * - hidden 不显示：完全隐藏，可在音乐播放页右上角 ⋮ 面板的「迷你播放器」行重新开启。
 *
 * 显示条件：有正在播放/上次的歌 && 未锁屏 && 未熄屏 && 切换器未打开 && 音乐 App 不在前台
 * （音乐 App 内有自己的迷你条，避免双重显示）。离开显示条件后延迟 350ms 卸载：
 * 接住「点按开播放页→卸载→原生 click 落空穿透到底下 App」的竞态（第二十轮修复）。
 *
 * 层级 z-[55]：高于 App 窗口（z-40），低于多任务切换器（z-60）/锁屏（z-65）/状态栏（z-70），
 * 来电/通话等更高层级界面自然盖住。
 */

import { create } from 'zustand';
import { useEffect, useRef, useState } from 'react';
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

/** 内部小按钮的原生 pointer 拦截：阻止冒泡到父级 motion.div（否则按按钮会同时触发拖拽/换样式 tap）。
 *  与唱片 ✕ 同款方案；React onClick 不受影响（stopPropagation 只阻断冒泡，不取消本元素点击） */
function useStopPointerBubble(
  ref: React.RefObject<HTMLElement | null>,
  deps: unknown[],
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const buttons = Array.from(root.querySelectorAll('button'));
    const offs: Array<() => void> = [];
    for (const el of buttons) {
      const stop = (e: Event) => e.stopPropagation();
      el.addEventListener('pointerdown', stop);
      el.addEventListener('pointerup', stop);
      offs.push(() => {
        el.removeEventListener('pointerdown', stop);
        el.removeEventListener('pointerup', stop);
      });
    }
    return () => offs.forEach((f) => f());
  }, deps);
}

/** 点按判定（拖拽与点按共存的确定性方案）：pointerdown 记录起点，pointerup 位移 <6px 视为点按。
 *  不用 framer 的 onTap：拖拽结束的 pointerup 与 drag 完成标记存在竞态，拖拽后可能误触发点按 */
function useTapGuard(action: () => void) {
  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    down.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!down.current) return;
    const d = Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y);
    down.current = null;
    if (d < 6) action();
  };
  return { onPointerDown, onPointerUp };
}

/** 迷你小条形态（第十八轮反馈：变小 + 可在屏幕内任意拖动）：
 *  条身点按打开播放页（位移判定的 tap）；内部按钮原生拦截不参与拖拽/点按 */
function GlobalMiniBar({ layerRef }: { layerRef: React.RefObject<HTMLDivElement | null> }) {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const loginUid = useMusic((s) => s.loginUid);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const live = useTogetherLive();
  const cycle = useMiniPlayer((s) => s.cycle);
  const barRef = useRef<HTMLDivElement | null>(null);
  useStopPointerBubble(barRef, [current?.id, live]);
  const tap = useTapGuard(openPlayerGlobal);
  if (!current) return null;
  return (
    <motion.div
      ref={barRef}
      drag
      dragConstraints={layerRef}
      dragElastic={0.08}
      dragMomentum={false}
      onPointerDown={tap.onPointerDown}
      onPointerUp={tap.onPointerUp}
      className="pointer-events-auto absolute bottom-[36px] left-3 z-[55] flex h-[42px] touch-none select-none items-center gap-1.5 rounded-full bg-white pl-1 pr-1.5 shadow-[0_4px_18px_rgba(0,0,0,0.16)] dark:bg-zinc-800 dark:shadow-[0_4px_18px_rgba(0,0,0,0.6)]"
      data-testid="music-global-mini-bar"
    >
      {live ? (
        <span className="flex shrink-0 items-center">
          <img src={live.avatar} alt={live.name} className="h-[34px] w-[34px] rounded-full bg-muted object-cover" draggable={false} />
          <img
            src={loginUid ? loginAvatar : getGuestAvatar()}
            alt="我"
            className="-ml-2.5 h-[34px] w-[34px] rounded-full object-cover ring-2 ring-white dark:ring-zinc-800"
            draggable={false}
          />
        </span>
      ) : (
        <img
          src={songCover(current)}
          alt={current.name}
          className="h-[34px] w-[34px] shrink-0 rounded-full bg-muted object-cover"
          draggable={false}
        />
      )}
      <span
        className="min-w-0 max-w-[104px] truncate text-[12px] leading-none"
        data-testid="music-global-mini-open"
      >
        <span className="font-bold text-zinc-900 dark:text-zinc-100">{current.name}</span>
        <span className="text-zinc-400 dark:text-zinc-500"> - {songArtistText(current)}</span>
      </span>
      <button
        type="button"
        onClick={() => useMusic.getState().toggle()}
        data-testid="music-global-mini-toggle"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-zinc-300 text-zinc-800 active:scale-95 dark:border-zinc-600 dark:text-zinc-100"
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing ? <Pause className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="ml-0.5 h-3.5 w-3.5" fill="currentColor" />}
      </button>
      <button
        type="button"
        onClick={openPlayerGlobal}
        aria-label="播放列表"
        className="flex h-8 w-7 shrink-0 items-center justify-center text-zinc-800 active:scale-95 dark:text-zinc-100"
      >
        <ListMusic className="h-[18px] w-[18px]" />
      </button>
      {/* 形态切换：底部条 → 悬浮唱片 → 隐藏（点按即换样式） */}
      <button
        type="button"
        onClick={() => cycle()}
        data-testid="music-global-mini-mode"
        aria-label="切换迷你播放器样式"
        title="切换迷你播放器样式"
        className="flex h-8 w-7 shrink-0 items-center justify-center text-zinc-500 active:scale-95 dark:text-zinc-400"
      >
        <Disc3 className="h-[17px] w-[17px]" />
      </button>
    </motion.div>
  );
}

/** 悬浮唱片形态：点按 = 换样式（切回底部条），右上角 ✕（更小）点击隐藏，可在屏幕内任意拖动（第十八轮反馈） */
function GlobalMiniRecord({ layerRef }: { layerRef: React.RefObject<HTMLDivElement | null> }) {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const setMode = useMiniPlayer((s) => s.setMode);
  const tap = useTapGuard(() => setMode('bar'));
  // ✕ 按钮的原生拦截：条身/唱片身用 pointer 位移判定点按（useTapGuard），
  // 必须在 ✕ 的 target 阶段原生拦截 pointer 事件，否则点 ✕ 会同时触发唱片的换样式点按
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
      drag
      dragConstraints={layerRef}
      dragElastic={0.08}
      dragMomentum={false}
      onPointerDown={tap.onPointerDown}
      onPointerUp={tap.onPointerUp}
      className="pointer-events-auto absolute right-[10px] top-[38%] z-[55] touch-none select-none"
      data-testid="music-global-mini-record"
    >
      <div className="relative h-[56px] w-[56px]">
        <img
          src={songCover(current)}
          alt={current.name}
          draggable={false}
          className="h-full w-full rounded-full bg-muted object-cover shadow-[0_6px_20px_rgba(0,0,0,0.35)] ring-2 ring-white/70 dark:ring-white/20"
          style={{ animation: 'mini-spin 9s linear infinite', animationPlayState: playing ? 'running' : 'paused' }}
        />
        {/* 右上角 ✕（第十八轮反馈：更小）：点击隐藏迷你播放器（原生拦截 pointer 冒泡：不触发换样式/拖拽） */}
        <button
          ref={xRef}
          type="button"
          aria-label="隐藏迷你播放器"
          data-testid="music-global-mini-hide"
          onClick={(e) => {
            e.stopPropagation();
            setMode('hidden');
          }}
          className="absolute -right-[4px] -top-[4px] flex h-[15px] w-[15px] items-center justify-center rounded-full bg-black/75 text-white shadow ring-1 ring-white/30 active:scale-90"
        >
          <X className="h-[9px] w-[9px]" strokeWidth={3} />
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

  // 点击穿透修复（第二十轮反馈：点条身开播放页时，底下 App/图标也被打开）：
  // 点按 → 打开播放页 → activeApp='music' → visible 立即变 false；若此刻直接卸载，
  // 浏览器随后的原生 click 会「落空」重新命中当前位置下的 App 内容/图标（同一次点按穿透到底下 App）。
  // 延迟 350ms 再卸载：期间以透明层（opacity-0，条身仍 pointer-events-auto）留在原地接住这次 click，
  // click 落在条身/按钮上 = 无额外操作；350ms 后正常卸载。
  const [mounted, setMounted] = useState(visible);
  const [prevVisible, setPrevVisible] = useState(visible);
  // visible 变 true 时立即重新挂载（render 期 adjust-state 模式，规避 effect 内 setState）
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) setMounted(true);
  }
  useEffect(() => {
    if (visible) return;
    const t = setTimeout(() => setMounted(false), 350);
    return () => clearTimeout(t);
  }, [visible]);

  if (!mounted || !current) return null;

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 z-[55]"
      style={{ opacity: visible ? 1 : 0 }}
      data-testid="music-global-mini"
      data-suppress-edge-gesture
    >
      {mode === 'bar' ? (
        <GlobalMiniBar layerRef={layerRef} />
      ) : (
        <GlobalMiniRecord layerRef={layerRef} />
      )}
    </div>
  );
}
