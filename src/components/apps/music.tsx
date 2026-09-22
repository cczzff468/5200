'use client';

/**
 * 音乐播放器 App —— 仿 Apple Music（黑白灰风格）
 *
 * 全局播放引擎设计（关键）：
 * - 模块级 zustand store `usePlayer` + 惰性单例 HTMLAudioElement。
 * - 用户离开音乐 App（组件卸载）后引擎继续播放；重新打开 App 后，
 *   UI 通过订阅 engine 状态恢复同步（进度/播放状态由引擎驱动，组件只是视图）。
 * - ObjectURL 生命周期：音频 URL 在切换曲目/停止时 revoke；
 *   封面 URL 在 loadLibrary 刷新资料库时回收不在库中的项。
 */

import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Music,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
} from 'lucide-react';
import { formatDuration, genId, localDB, type MusicRecord } from '@/lib/ios/db';
import { IOSNavBar, IOSScreen } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import type { ReadTagsOptions } from 'jsmediatags';

type RepeatMode = 'off' | 'all' | 'one';

// ---------------- 全局播放引擎 ----------------

interface PlayerState {
  library: MusicRecord[];
  currentId: string | null;
  playing: boolean;
  /** 秒 */
  position: number;
  /** 秒 */
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** 自动播放被浏览器策略拦截（需要用户点击） */
  blocked: boolean;

  loadLibrary: () => Promise<void>;
  play: (id: string) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (t: number) => void;
  setShuffle: (v: boolean) => void;
  setRepeat: (v: RepeatMode) => void;
  /** 删除某曲目时若正在播放则停止 */
  stopIfPlaying: (id: string) => void;
}

let audio: HTMLAudioElement | null = null;
let audioUrl: string | null = null;

/** 封面 Blob → ObjectURL 缓存（loadLibrary 刷新时回收失效项） */
const coverUrls = new Map<Blob, string>();

function getCoverUrl(blob: Blob): string {
  const cached = coverUrls.get(blob);
  if (cached) return cached;
  const url = URL.createObjectURL(blob);
  coverUrls.set(blob, url);
  return url;
}

function pickNextId(library: MusicRecord[], currentId: string | null, shuffle: boolean): string | null {
  if (library.length === 0) return null;
  const idx = library.findIndex((t) => t.id === currentId);
  if (shuffle) {
    if (library.length === 1) return library[0].id;
    let r = idx;
    while (r === idx) r = Math.floor(Math.random() * library.length);
    return library[r].id;
  }
  return library[(idx + 1) % library.length].id;
}

/** 停止引擎并释放音频 ObjectURL */
function stopEngine() {
  const el = getAudio();
  try {
    el.pause();
  } catch {
    /* ignore */
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
  el.removeAttribute('src');
  try {
    el.load();
  } catch {
    /* ignore */
  }
  usePlayer.setState({ currentId: null, playing: false, position: 0, duration: 0, blocked: false });
}

/** 惰性单例 Audio + 引擎事件绑定（模块级，App 卸载后仍存活） */
function getAudio(): HTMLAudioElement {
  if (audio) return audio;
  const el = new Audio();
  el.preload = 'auto';

  el.addEventListener('timeupdate', () => {
    usePlayer.setState({ position: el.currentTime });
  });
  el.addEventListener('durationchange', () => {
    if (Number.isFinite(el.duration) && el.duration > 0) {
      usePlayer.setState({ duration: el.duration });
    }
  });
  el.addEventListener('play', () => {
    usePlayer.setState({ playing: true });
  });
  el.addEventListener('pause', () => {
    usePlayer.setState({ playing: false });
  });
  el.addEventListener('ended', () => {
    const s = usePlayer.getState();
    if (s.repeat === 'one' && el.loop) return; // 单曲循环由 audio.loop 处理
    if (s.library.length === 0) {
      usePlayer.setState({ playing: false });
      return;
    }
    // 顺序播放 + 不循环：整张列表播完即停止
    if (s.repeat === 'off' && !s.shuffle) {
      const idx = s.library.findIndex((t) => t.id === s.currentId);
      if (idx >= s.library.length - 1) {
        usePlayer.setState({ playing: false, position: s.duration > 0 ? s.duration : el.duration });
        return;
      }
    }
    const nextId = pickNextId(s.library, s.currentId, s.shuffle);
    if (nextId) {
      s.play(nextId);
    } else {
      usePlayer.setState({ playing: false });
    }
  });
  el.addEventListener('error', () => {
    usePlayer.setState({ playing: false });
  });

  audio = el;
  return el;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  library: [],
  currentId: null,
  playing: false,
  position: 0,
  duration: 0,
  shuffle: false,
  repeat: 'off',
  blocked: false,

  loadLibrary: async () => {
    const rows = (await localDB.getAll('music')).sort((a, b) => b.createdAt - a.createdAt);
    // 回收已不在资料库中的封面 ObjectURL（列表刷新）
    const alive = new Set<Blob>();
    for (const r of rows) {
      if (r.cover) alive.add(r.cover);
    }
    for (const [blob, url] of coverUrls) {
      if (!alive.has(blob)) {
        URL.revokeObjectURL(url);
        coverUrls.delete(blob);
      }
    }
    set({ library: rows });
    // 正在播放的曲目被从库中删除时，停止引擎
    const cur = get().currentId;
    if (cur && !rows.some((r) => r.id === cur)) {
      stopEngine();
    }
  },

  play: (id) => {
    const s = get();
    const record = s.library.find((t) => t.id === id);
    if (!record) return;
    if (s.currentId === id) {
      get().toggle();
      return;
    }
    const el = getAudio();
    // 释放上一首的 ObjectURL
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    const url = URL.createObjectURL(record.blob);
    audioUrl = url;
    el.loop = s.repeat === 'one';
    el.src = url;
    set({
      currentId: id,
      position: 0,
      duration: record.duration > 0 ? record.duration : 0,
      blocked: false,
    });
    el.play().then(
      () => set({ playing: true, blocked: false }),
      (err: unknown) => {
        const notAllowed = err instanceof DOMException && err.name === 'NotAllowedError';
        set({ playing: false, blocked: notAllowed });
      }
    );
  },

  toggle: () => {
    const s = get();
    if (!s.currentId) {
      const first = s.library[0];
      if (first) get().play(first.id);
      return;
    }
    const el = getAudio();
    if (el.paused) {
      el.play().then(
        () => set({ blocked: false }),
        (err: unknown) => {
          const notAllowed = err instanceof DOMException && err.name === 'NotAllowedError';
          set({ playing: false, blocked: notAllowed });
        }
      );
    } else {
      el.pause();
    }
  },

  next: () => {
    const s = get();
    if (s.library.length === 0) return;
    const nextId = pickNextId(s.library, s.currentId, s.shuffle);
    if (nextId) get().play(nextId);
  },

  prev: () => {
    const s = get();
    if (s.library.length === 0) return;
    const el = getAudio();
    // 播放超过 3 秒时先回到开头
    if (s.currentId && el.currentTime > 3) {
      get().seek(0);
      return;
    }
    if (s.shuffle) {
      const prevId = pickNextId(s.library, s.currentId, true);
      if (prevId) get().play(prevId);
      return;
    }
    const idx = s.library.findIndex((t) => t.id === s.currentId);
    const pidx = idx <= 0 ? s.library.length - 1 : idx - 1;
    get().play(s.library[pidx].id);
  },

  seek: (t) => {
    const s = get();
    if (!s.currentId) return;
    const el = getAudio();
    const total =
      s.duration > 0 ? s.duration : Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    const clamped = Math.max(0, Math.min(t, total || t));
    try {
      el.currentTime = clamped;
    } catch {
      /* 尚无可播放媒体 */
    }
    set({ position: clamped });
  },

  setShuffle: (v) => {
    set({ shuffle: v });
  },

  setRepeat: (v) => {
    set({ repeat: v });
    getAudio().loop = v === 'one';
  },

  stopIfPlaying: (id) => {
    if (get().currentId === id) stopEngine();
  },
}));

// ---------------- 导入工具 ----------------

interface ParsedTags {
  title?: string;
  artist?: string;
  album?: string;
  picture?: Blob;
}

function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** 用临时 Audio 元素读取时长 */
function readAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(0);
      return;
    }
    const url = URL.createObjectURL(blob);
    const el = new Audio();
    let settled = false;
    const finish = (d: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      el.removeAttribute('src');
      try {
        el.load();
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = window.setTimeout(() => finish(0), 10000);
    el.addEventListener('loadedmetadata', () => finish(Number.isFinite(el.duration) ? el.duration : 0));
    el.addEventListener('error', () => finish(0));
    el.src = url;
  });
}

/** 动态 import jsmediatags 读取 ID3 标签与封面
 *  注意：直接引用浏览器 dist 构建（无 Node/react-native 依赖，SSR 打包安全） */
async function readId3Tags(file: File): Promise<ParsedTags> {
  try {
    // 浏览器 dist 构建（allowJs 下 TS 可解析，运行时无 Node 依赖）
    const mod = await import('jsmediatags/dist/jsmediatags.min.js');
    const readFn = mod.default?.read ?? mod.read;
    if (typeof readFn !== 'function') return {};
    return await new Promise<ParsedTags>((resolve) => {
      const timer = window.setTimeout(() => resolve({}), 6000);
      const options: ReadTagsOptions = {
        file,
        onSuccess: (result) => {
          window.clearTimeout(timer);
          const tags = result.tags ?? {};
          let picture: Blob | undefined;
          const pic = tags.picture;
          if (pic && Array.isArray(pic.data) && pic.data.length > 0) {
            const bytes = new Uint8Array(pic.data);
            picture = new Blob([bytes], { type: pic.format || 'image/jpeg' });
          }
          resolve({ title: tags.title, artist: tags.artist, album: tags.album, picture });
        },
        onError: () => {
          window.clearTimeout(timer);
          resolve({});
        },
      };
      readFn(options);
    });
  } catch {
    return {};
  }
}

// ---------------- 播放中音波指示器 ----------------

const EQ_CSS =
  '@keyframes ios-eq{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}' +
  '.ios-eq-bar{transform-origin:bottom;animation:ios-eq .9s ease-in-out infinite}';

function EqBars({ playing }: { playing: boolean }) {
  return (
    <span className="flex h-3 w-[13px] shrink-0 items-end gap-[2px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="ios-eq-bar h-full w-[3px] rounded-full bg-foreground"
          style={{ animationDelay: `${i * 0.18}s`, animationPlayState: playing ? 'running' : 'paused' }}
        />
      ))}
    </span>
  );
}

// ---------------- 封面缩略图 ----------------

function CoverThumb({ record, className, iconClass }: { record: MusicRecord; className: string; iconClass: string }) {
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-md bg-muted ${className}`}>
      {record.cover ? (
        <img src={getCoverUrl(record.cover)} alt={`${record.title} 封面`} className="h-full w-full object-cover" />
      ) : (
        <Music className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-muted-foreground ${iconClass}`} />
      )}
    </div>
  );
}

// ---------------- 资料库视图 ----------------

function TrackRow({
  record,
  isCurrent,
  playing,
  onRowClick,
  onMenuPlay,
  onDelete,
}: {
  record: MusicRecord;
  isCurrent: boolean;
  playing: boolean;
  onRowClick: () => void;
  onMenuPlay: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onRowClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onRowClick();
        }
      }}
      className="flex w-full cursor-pointer items-center gap-3 px-4 py-1.5 text-left transition-colors active:bg-muted/60"
    >
      <CoverThumb record={record} className="h-14 w-14" iconClass="h-6 w-6" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {isCurrent && <EqBars playing={playing} />}
          <span className={`truncate text-[15px] leading-tight ${isCurrent ? 'font-semibold' : ''}`}>
            {record.title}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[13px] leading-tight text-muted-foreground">{record.artist}</div>
      </div>
      <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{formatDuration(record.duration)}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`「${record.title}」更多操作`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted active:bg-muted"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-44 p-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMenuPlay();
            }}
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-[14px] transition-colors hover:bg-accent"
          >
            <Play className="h-4 w-4" />
            播放
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-[14px] text-[#FF453A] transition-colors hover:bg-accent"
          >
            <Trash2 className="h-4 w-4" />
            从资料库删除
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** 底部迷你播放条：有正在播放的曲目时显示，点击进入播放器 */
function MiniPlayerBar({ record, playing, onOpen }: { record: MusicRecord; playing: boolean; onOpen: () => void }) {
  const toggle = usePlayer((s) => s.toggle);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="mx-3 flex shrink-0 cursor-pointer items-center gap-3 rounded-xl border border-border/70 bg-background/95 p-2 text-left shadow-sm backdrop-blur"
    >
      <CoverThumb record={record} className="h-10 w-10" iconClass="h-4 w-4" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium leading-tight">{record.title}</div>
        <div className="truncate text-[12px] leading-tight text-muted-foreground">{record.artist}</div>
      </div>
      <button
        type="button"
        aria-label={playing ? '暂停' : '播放'}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted active:bg-muted"
      >
        {playing ? (
          <Pause className="h-5 w-5" fill="currentColor" />
        ) : (
          <Play className="h-5 w-5 translate-x-[1px]" fill="currentColor" />
        )}
      </button>
    </div>
  );
}

function LibraryView({ onOpenPlayer }: { onOpenPlayer: () => void }) {
  const library = usePlayer((s) => s.library);
  const currentId = usePlayer((s) => s.currentId);
  const playing = usePlayer((s) => s.playing);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);

  const openPicker = () => fileInputRef.current?.click();

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setImporting({ done: 0, total: files.length });
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const [duration, tags] = await Promise.all([readAudioDuration(file), readId3Tags(file)]);
      const record: MusicRecord = {
        id: genId(),
        blob: file,
        name: file.name,
        title: tags.title?.trim() || stripExt(file.name),
        artist: tags.artist?.trim() || '未知歌手',
        album: tags.album?.trim() || '',
        cover: tags.picture ?? null,
        duration,
        createdAt: Date.now(),
      };
      await localDB.put('music', record);
      setImporting({ done: i + 1, total: files.length });
    }
    setImporting(null);
    await usePlayer.getState().loadLibrary();
  };

  const handleDelete = async (record: MusicRecord) => {
    usePlayer.getState().stopIfPlaying(record.id);
    await localDB.delete('music', record.id);
    await usePlayer.getState().loadLibrary();
  };

  const current = currentId ? library.find((t) => t.id === currentId) ?? null : null;

  return (
    <>
      <IOSNavBar
        inline
        title="资料库"
        left={<BackToHome className="static!" />}
        right={
          <button
            type="button"
            onClick={openPicker}
            aria-label="导入音频"
            className="transition-opacity active:opacity-50"
          >
            <Plus className="h-6 w-6" strokeWidth={2} />
          </button>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {importing && (
        <div className="flex shrink-0 items-center gap-2 px-5 pb-1 text-[13px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          导入中 {importing.done}/{importing.total}
        </div>
      )}

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto pb-1 pt-1">
        {library.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 pb-16 text-muted-foreground">
            <Music className="h-10 w-10 text-muted-foreground/50" />
            <div className="text-[15px] font-medium text-foreground">资料库为空</div>
            <div className="text-[13px]">点击右上角 + 导入音频文件</div>
          </div>
        ) : (
          library.map((record) => (
            <TrackRow
              key={record.id}
              record={record}
              isCurrent={record.id === currentId}
              playing={playing}
              onRowClick={() => {
                // 点击当前播放行仅进入播放器；点击其他行先播放再进入
                if (record.id !== currentId) usePlayer.getState().play(record.id);
                onOpenPlayer();
              }}
              onMenuPlay={() => usePlayer.getState().play(record.id)}
              onDelete={() => void handleDelete(record)}
            />
          ))
        )}
      </div>

      {current && <MiniPlayerBar record={current} playing={playing} onOpen={onOpenPlayer} />}
      <div className="h-[28px] shrink-0" />
    </>
  );
}

// ---------------- 播放器视图 ----------------

function PlayerView({ onBack }: { onBack: () => void }) {
  const track = usePlayer((s) => (s.currentId ? s.library.find((t) => t.id === s.currentId) ?? null : null));
  const playing = usePlayer((s) => s.playing);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const blocked = usePlayer((s) => s.blocked);
  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const seek = usePlayer((s) => s.seek);
  const setShuffle = usePlayer((s) => s.setShuffle);
  const setRepeat = usePlayer((s) => s.setRepeat);

  const total = duration > 0 ? duration : track?.duration ?? 0;
  const pos = total > 0 ? Math.min(position, total) : position;

  const cycleRepeat = () => {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const idx = order.indexOf(repeat);
    setRepeat(order[(idx + 1) % order.length]);
  };

  return (
    <div className="flex h-full w-full flex-col bg-gradient-to-b from-white to-[#ECECF1] text-black dark:from-[#1c1c1e] dark:to-black dark:text-white">
      {/* 顶部：返回 + 正在播放 */}
      <div className="shrink-0 pt-[54px]">
        <div className="relative flex h-11 items-center px-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回资料库"
            className="flex h-9 w-9 items-center justify-center rounded-full text-black/85 transition-colors hover:bg-black/10 active:bg-black/10 dark:text-white/85 dark:hover:bg-white/10 dark:active:bg-white/10"
          >
            <ChevronDown className="h-6 w-6" />
          </button>
          <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[12px] font-semibold uppercase tracking-[0.2em] text-black/50 dark:text-white/55">
            正在播放
          </span>
        </div>
      </div>

      {/* 封面大圆盘（黑胶唱片，旋转） */}
      <div className="flex min-h-0 flex-1 items-center justify-center py-2">
        <div className="relative h-[280px] w-[280px]">
          <div
            className="h-full w-full animate-[spin_16s_linear_infinite]"
            style={{ animationPlayState: playing ? 'running' : 'paused' }}
          >
            {track?.cover ? (
              <img
                src={getCoverUrl(track.cover)}
                alt={`${track.title} 封面`}
                className="h-full w-full rounded-full border-[6px] border-black/10 object-cover shadow-[0_18px_50px_rgba(0,0,0,0.25)] dark:border-white/10 dark:shadow-[0_18px_50px_rgba(0,0,0,0.65)]"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-full border-[6px] border-black/10 bg-[radial-gradient(circle_at_50%_35%,#3a3a3c_0%,#232325_55%,#0a0a0b_100%)] shadow-[0_18px_50px_rgba(0,0,0,0.25)] dark:border-white/10 dark:shadow-[0_18px_50px_rgba(0,0,0,0.65)]">
                <Music className="h-14 w-14 text-white/20" />
              </div>
            )}
            {/* 中心圆孔 */}
            <div className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black ring-1 ring-black/10 dark:ring-white/20" />
          </div>
        </div>
      </div>

      {/* 标题 + 歌手 */}
      <div className="shrink-0 px-8 pt-2 text-center">
        <div className="truncate text-[22px] font-semibold leading-tight">{track?.title ?? '未在播放'}</div>
        <div className="mt-0.5 truncate text-[15px] text-black/55 dark:text-white/55">{track?.artist || '未知歌手'}</div>
      </div>

      {/* 进度条 */}
      <div className="mt-5 shrink-0 px-7">
        <Slider
          value={[total > 0 ? Math.min(pos, total) : 0]}
          max={total > 0 ? total : 1}
          step={1}
          onValueChange={(v) => seek(v[0] ?? 0)}
          aria-label="播放进度"
          className="[&_[data-slot=slider-range]]:bg-black dark:[&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:border-none [&_[data-slot=slider-thumb]]:bg-black dark:[&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-track]]:bg-black/15 dark:[&_[data-slot=slider-track]]:bg-white/20"
        />
        <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-black/50 dark:text-white/50">
          <span>{formatDuration(pos)}</span>
          <span>-{formatDuration(Math.max(0, total - pos))}</span>
        </div>
      </div>

      {blocked && (
        <div className="shrink-0 px-8 pt-2 text-center text-[12px] text-black/45 dark:text-white/45">
          浏览器已拦截自动播放，请点击播放按钮开始
        </div>
      )}

      {/* 控制行 */}
      <div className="mt-2 flex shrink-0 items-center justify-between px-9">
        <button
          type="button"
          onClick={() => setShuffle(!shuffle)}
          aria-label="随机播放"
          aria-pressed={shuffle}
          className={`transition-colors active:opacity-60 ${shuffle ? 'text-black dark:text-white' : 'text-black/40 dark:text-white/40'}`}
        >
          <Shuffle className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={prev}
          aria-label="上一首"
          className="text-black transition-transform active:scale-90 dark:text-white"
        >
          <SkipBack className="h-9 w-9" fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? '暂停' : '播放'}
          className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-black text-white shadow-lg transition-transform active:scale-95 dark:bg-white dark:text-black"
        >
          {playing ? (
            <Pause className="h-9 w-9" fill="currentColor" />
          ) : (
            <Play className="ml-1 h-9 w-9" fill="currentColor" />
          )}
        </button>
        <button
          type="button"
          onClick={next}
          aria-label="下一首"
          className="text-black transition-transform active:scale-90 dark:text-white"
        >
          <SkipForward className="h-9 w-9" fill="currentColor" />
        </button>
        <button
          type="button"
          onClick={cycleRepeat}
          aria-label="循环模式"
          className={`transition-colors active:opacity-60 ${repeat === 'off' ? 'text-black/40 dark:text-white/40' : 'text-black dark:text-white'}`}
        >
          {repeat === 'one' ? <Repeat1 className="h-6 w-6" /> : <Repeat className="h-6 w-6" />}
        </button>
      </div>

      {/* 底部留白（含 Home 热区） */}
      <div className="h-[44px] shrink-0" />
    </div>
  );
}

// ---------------- App 入口 ----------------

export default function MusicApp() {
  const [view, setView] = useState<'library' | 'player'>('library');
  const currentId = usePlayer((s) => s.currentId);
  const library = usePlayer((s) => s.library);
  const current = currentId ? library.find((t) => t.id === currentId) ?? null : null;

  useEffect(() => {
    void usePlayer.getState().loadLibrary();
  }, []);

  const showPlayer = view === 'player' && current !== null;

  return (
    <IOSScreen>
      <style>{EQ_CSS}</style>
      {showPlayer ? (
        <PlayerView onBack={() => setView('library')} />
      ) : (
        <LibraryView onOpenPlayer={() => setView('player')} />
      )}
    </IOSScreen>
  );
}
