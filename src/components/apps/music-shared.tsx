'use client';

/**
 * 音乐 App 共用 UI 小件：封面图（http 直链走同源代理）、歌曲行、格式化、
 * 底部 TabBar、迷你播放条、区块标题、加载/空态。
 */

import { useEffect, useState } from 'react';
import {
  Disc3,
  Heart,
  ListMusic,
  Pause,
  Play,
  Search,
  UserRound,
} from 'lucide-react';
import {
  mediaProxyUrl,
  useMusic,
  type MusicNav,
} from '@/lib/ios/music-store';
import { songAlbumText, songArtistText, songCover, type NcmSong } from '@/lib/ios/music-api';

// ---------------- 格式化 ----------------

export function fmtPlayCount(n?: number): string {
  if (!n || n <= 0) return '';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}万`;
  return `${n}`;
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// ---------------- 封面 ----------------

export function coverSrc(picUrl?: string): string {
  if (!picUrl) return '';
  if (picUrl.startsWith('http://')) return mediaProxyUrl(picUrl);
  return picUrl;
}

export function CoverImg({
  src,
  className = '',
  rounded = '',
  alt = '',
}: {
  src?: string;
  className?: string;
  rounded?: string;
  alt?: string;
}) {
  const url = coverSrc(src);
  if (!url) {
    return (
      <div
        className={`flex items-center justify-center bg-zinc-200 dark:bg-zinc-800 ${rounded} ${className}`}
      >
        <Disc3 className="h-5 w-5 text-zinc-400 dark:text-zinc-600" />
      </div>
    );
  }
  return (
     
    <img
      src={url}
      alt={alt || '封面'}
      loading="lazy"
      className={`object-cover bg-zinc-200 dark:bg-zinc-800 ${rounded} ${className}`}
      draggable={false}
    />
  );
}

// ---------------- 歌曲行 ----------------

export function SongRow({
  song,
  queue,
  index,
  showAlbum = false,
  onMore,
}: {
  song: NcmSong;
  queue: NcmSong[];
  index?: number;
  showAlbum?: boolean;
  onMore?: (song: NcmSong) => void;
}) {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const playSong = useMusic((s) => s.playSong);
  const active = current?.id === song.id;
  return (
    <button
      type="button"
      onClick={() => void playSong(song, queue)}
      className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-black/5 dark:active:bg-white/10"
    >
      {typeof index === 'number' && (
        <span
          className={`w-6 shrink-0 text-center text-[15px] tabular-nums ${
            active ? 'text-[#C20C0C]' : 'text-zinc-400'
          }`}
        >
          {index + 1}
        </span>
      )}
      <div className="relative shrink-0">
        <CoverImg src={songCover(song)} className="h-11 w-11" rounded="rounded-lg" alt={song.name} />
        {active && (
          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/35">
            {playing ? (
              <Pause className="h-4 w-4 text-white" fill="currentColor" />
            ) : (
              <Play className="h-4 w-4 text-white" fill="currentColor" />
            )}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[15px] leading-tight ${active ? 'text-[#C20C0C]' : 'text-zinc-900 dark:text-zinc-100'}`}
        >
          {song.name}
        </div>
        <div className="mt-0.5 truncate text-[12px] leading-tight text-zinc-500">
          {songArtistText(song)}
          {showAlbum && songAlbumText(song) ? ` · ${songAlbumText(song)}` : ''}
        </div>
      </div>
      {song.fee === 1 && (
        <span className="shrink-0 rounded-[3px] border border-[#C20C0C]/50 px-1 text-[9px] leading-[14px] text-[#C20C0C]">
          VIP
        </span>
      )}
      {onMore && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onMore(song);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              onMore(song);
            }
          }}
          className="shrink-0 px-2 py-1 text-zinc-400"
        >
          ⋯
        </span>
      )}
    </button>
  );
}

// ---------------- 区块标题 ----------------

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pb-2 pt-5">
      <h2 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-100">{children}</h2>
      {right}
    </div>
  );
}

// ---------------- 加载/空态 ----------------

export function LoadingBlock({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-zinc-400">
      <Disc3 className="h-4 w-4 animate-spin" />
      {text}
    </div>
  );
}

export function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-zinc-400">
      <Disc3 className="h-8 w-8 opacity-40" />
      <p className="text-[13px]">{text}</p>
    </div>
  );
}

// ---------------- 底部 TabBar ----------------

const TABS: { key: MusicNav['tab']; label: string; icon: React.ReactNode }[] = [
  { key: 'home', label: '首页', icon: <Disc3 className="h-[22px] w-[22px]" /> },
  { key: 'search', label: '搜索', icon: <Search className="h-[22px] w-[22px]" /> },
  { key: 'mine', label: '我的', icon: <UserRound className="h-[22px] w-[22px]" /> },
];

export function MusicTabBar() {
  const tab = useMusic((s) => s.nav.tab);
  const setTab = useMusic((s) => s.setTab);
  return (
    <nav
      className="flex h-[52px] shrink-0 items-stretch border-t border-black/5 bg-white/85 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/85"
      data-testid="music-tabbar"
    >
      {TABS.map((t) => {
        const active = tab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            data-testid={`music-tab-${t.key}`}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 ${
              active ? 'text-[#C20C0C]' : 'text-zinc-400 dark:text-zinc-500'
            }`}
          >
            {t.icon}
            <span className="text-[10px] leading-none">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ---------------- 迷你播放条 ----------------

export function MiniBar() {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const toggle = useMusic((s) => s.toggle);
  const openPlayer = useMusic((s) => s.openPlayer);
  if (!current) return null;
  return (
    <div
      className="mx-3 mb-1 flex h-[52px] shrink-0 items-center gap-2.5 rounded-full border border-black/5 bg-white/95 pl-1.5 pr-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/95"
      data-testid="music-minibar"
    >
      <button
        type="button"
        onClick={openPlayer}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <span className="relative shrink-0">
          <CoverImg src={songCover(current)} className="h-10 w-10" rounded="rounded-full" alt={current.name} />
          <ListMusic
            className={`absolute -right-0.5 -bottom-0.5 h-4 w-4 rounded-full bg-white p-0.5 text-zinc-500 dark:bg-zinc-800 ${
              playing ? 'text-[#C20C0C]' : ''
            }`}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
            {current.name}
          </span>
          <span className="block truncate text-[11px] text-zinc-500">
            {songArtistText(current)}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={toggle}
        data-testid="music-minibar-toggle"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/5 text-zinc-800 active:scale-95 dark:bg-white/10 dark:text-zinc-100"
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing ? (
          <Pause className="h-[18px] w-[18px]" fill="currentColor" />
        ) : (
          <Play className="ml-0.5 h-[18px] w-[18px]" fill="currentColor" />
        )}
      </button>
    </div>
  );
}

// ---------------- 时间轴 hook（一起听时长等用） ----------------

export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function LikeIcon({ liked, className = '' }: { liked: boolean; className?: string }) {
  return (
    <Heart
      className={`${className} ${liked ? 'text-[#C20C0C]' : 'text-zinc-400 dark:text-zinc-500'}`}
      fill={liked ? 'currentColor' : 'none'}
    />
  );
}
