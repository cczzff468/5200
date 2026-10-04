'use client';

/**
 * 音乐 App 搜索页：热搜词 + 四类结果 tab（单曲/歌手/歌单/专辑）。
 * 歌手/专辑点开半屏面板（热门歌曲/专辑曲目 + 收藏）。
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Loader2, Search, X } from 'lucide-react';
import {
  artistSongs,
  artistSub,
  albumDetail,
  albumSub,
  hotSearch,
  search,
  getMusicLogin,
  type HotSearchItem,
  type NcmAlbum,
  type NcmArtist,
  type NcmSong,
  type SearchType,
} from '@/lib/ios/music-api';
import { useMusic } from '@/lib/ios/music-store';
import {
  CoverImg,
  EmptyBlock,
  LoadingBlock,
  SongRow,
  fmtPlayCount,
} from './music-shared';

type ResultTab = 'song' | 'artist' | 'playlist' | 'album';

const TABS: { key: ResultTab; label: string; type: SearchType }[] = [
  { key: 'song', label: '单曲', type: 1 },
  { key: 'artist', label: '歌手', type: 10 },
  { key: 'playlist', label: '歌单', type: 1000 },
  { key: 'album', label: '专辑', type: 100 },
];

export function MusicSearch() {
  const [input, setInput] = useState('');
  const [hot, setHot] = useState<HotSearchItem[]>([]);
  const [tab, setTab] = useState<ResultTab>('song');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{
    songs: NcmSong[];
    artists: NcmArtist[];
    playlists: { id: number; name: string; coverImgUrl: string; playCount?: number }[];
    albums: NcmAlbum[];
  } | null>(null);
  const [sheet, setSheet] = useState<
    | { kind: 'artist'; artist: NcmArtist; songs: NcmSong[]; subed: boolean }
    | { kind: 'album'; album: NcmAlbum; songs: NcmSong[]; subed: boolean }
    | null
  >(null);
  const lastQueryRef = useRef('');
  const openPlaylist = useMusic((s) => s.openPlaylist);

  useEffect(() => {
    void (async () => {
      try {
        setHot((await hotSearch()).slice(0, 10));
      } catch {
        setHot([]);
      }
    })();
  }, []);

  const doSearch = async (kw: string, t: ResultTab) => {
    if (!kw.trim()) return;
    lastQueryRef.current = kw;
    setLoading(true);
    setResults(null);
    try {
      const conf = TABS.find((x) => x.key === t)!;
      const r = await search(kw, conf.type, 30);
      setResults({ songs: r.songs, artists: r.artists, playlists: r.playlists, albums: r.albums });
    } catch {
      setResults({ songs: [], artists: [], playlists: [], albums: [] });
    } finally {
      setLoading(false);
    }
  };

  const submit = (kw?: string) => {
    const q = (kw ?? input).trim();
    if (!q) return;
    setInput(q);
    void doSearch(q, tab);
  };

  const changeTab = (t: ResultTab) => {
    setTab(t);
    if (lastQueryRef.current) void doSearch(lastQueryRef.current, t);
  };

  const openArtist = async (a: NcmArtist) => {
    setSheet({ kind: 'artist', artist: a, songs: [], subed: false });
    try {
      const r = await artistSongs(a.id);
      setSheet({ kind: 'artist', artist: r.artist, songs: r.songs, subed: false });
    } catch {
      setSheet((s) => (s && s.kind === 'artist' ? { ...s, songs: [] } : s));
    }
  };

  const openAlbum = async (a: NcmAlbum) => {
    setSheet({ kind: 'album', album: a, songs: [], subed: false });
    try {
      const r = await albumDetail(a.id);
      setSheet({ kind: 'album', album: r.album, songs: r.songs, subed: false });
    } catch {
      setSheet((s) => (s && s.kind === 'album' ? { ...s, songs: [] } : s));
    }
  };

  const toggleSub = async () => {
    if (!sheet) return;
    if (!getMusicLogin()) {
      // 游客：仅本地切换（不持久化到云端）
      setSheet((s) => (s ? { ...s, subed: !s.subed } : s));
      return;
    }
    try {
      if (sheet.kind === 'artist') {
        await artistSub(sheet.artist.id, sheet.subed ? 2 : 1);
      } else {
        await albumSub(sheet.album.id, sheet.subed ? 2 : 1);
      }
      setSheet((s) => (s ? { ...s, subed: !s.subed } : s));
    } catch {
      // 失败保持
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 搜索栏 */}
      <div className="sticky top-0 z-20 bg-[#F8F8F8]/95 px-4 pb-2 pt-[58px] backdrop-blur-xl dark:bg-black/95">
        <div className="flex items-center gap-2">
          <div className="flex h-9 flex-1 items-center gap-2 rounded-full bg-black/5 px-3 dark:bg-white/10">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="搜索歌曲、歌手、歌单、专辑"
              data-testid="music-search-input"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
            />
            {input && (
              <button type="button" onClick={() => setInput('')} aria-label="清空">
                <X className="h-4 w-4 text-zinc-400" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => submit()}
            data-testid="music-search-go"
            className="shrink-0 text-[14px] font-medium text-[#C20C0C] active:scale-95"
          >
            搜索
          </button>
        </div>
        {/* 结果 tab */}
        {results && (
          <div className="mt-2 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => changeTab(t.key)}
                className={`rounded-full px-3.5 py-1 text-[12px] ${
                  tab === t.key
                    ? 'bg-[#C20C0C] text-white'
                    : 'bg-black/5 text-zinc-500 dark:bg-white/10 dark:text-zinc-400'
                }`}
                data-testid={`music-search-tab-${t.key}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[126px]">
        {/* 热搜 */}
        {!results && !loading && (
          <div className="px-4 pt-3">
            <p className="mb-2.5 text-[13px] font-semibold text-zinc-500">热搜榜</p>
            <div className="flex flex-wrap gap-2" data-testid="music-hot-list">
              {hot.map((h, i) => (
                <button
                  key={h.searchWord}
                  type="button"
                  onClick={() => submit(h.searchWord)}
                  className="flex items-center gap-1 rounded-full bg-black/5 px-3 py-1.5 text-[12px] text-zinc-700 active:scale-95 dark:bg-white/10 dark:text-zinc-300"
                >
                  <span className={i < 3 ? 'font-bold text-[#C20C0C]' : 'text-zinc-400'}>{i + 1}</span>
                  {h.searchWord}
                </button>
              ))}
              {hot.length === 0 && <p className="text-[12px] text-zinc-400">热搜获取失败</p>}
            </div>
          </div>
        )}

        {loading && <LoadingBlock />}

        {/* 单曲 */}
        {results && tab === 'song' && (
          <div className="pt-1" data-testid="music-search-songs">
            {results.songs.length === 0 ? <EmptyBlock text="没有找到相关歌曲" /> : results.songs.map((s, i) => <SongRow key={s.id} song={s} queue={results.songs} index={i} showAlbum />)}
          </div>
        )}

        {/* 歌手 */}
        {results && tab === 'artist' && (
          <div className="px-4 pt-2" data-testid="music-search-artists">
            {results.artists.length === 0 ? (
              <EmptyBlock text="没有找到相关歌手" />
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {results.artists.map((a) => (
                  <button key={a.id} type="button" onClick={() => void openArtist(a)} className="text-left active:scale-[0.98]">
                    <CoverImg src={a.img1v1Url || a.picUrl} className="aspect-square w-full" rounded="rounded-full" alt={a.name} />
                    <p className="mt-1 truncate text-center text-[12px] text-zinc-800 dark:text-zinc-200">{a.name}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 歌单 */}
        {results && tab === 'playlist' && (
          <div className="px-4 pt-2" data-testid="music-search-playlists">
            {results.playlists.length === 0 ? (
              <EmptyBlock text="没有找到相关歌单" />
            ) : (
              <div className="space-y-2.5">
                {results.playlists.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openPlaylist(p.id)}
                    className="flex w-full items-center gap-3 text-left active:opacity-80"
                  >
                    <CoverImg src={p.coverImgUrl} className="h-14 w-14" rounded="rounded-lg" alt={p.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] text-zinc-900 dark:text-zinc-100">{p.name}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        {fmtPlayCount(p.playCount)}次播放
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 专辑 */}
        {results && tab === 'album' && (
          <div className="px-4 pt-2" data-testid="music-search-albums">
            {results.albums.length === 0 ? (
              <EmptyBlock text="没有找到相关专辑" />
            ) : (
              <div className="space-y-2.5">
                {results.albums.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => void openAlbum(a)}
                    className="flex w-full items-center gap-3 text-left active:opacity-80"
                  >
                    <CoverImg src={a.picUrl} className="h-14 w-14" rounded="rounded-lg" alt={a.name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] text-zinc-900 dark:text-zinc-100">{a.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                        {a.artist?.name ?? ''}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 歌手/专辑半屏面板 */}
      {sheet && (
        <div className="absolute inset-0 z-[65] flex items-end">
          <button type="button" aria-label="关闭" onClick={() => setSheet(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative flex max-h-[75%] w-full flex-col rounded-t-2xl bg-white dark:bg-zinc-900">
            <div className="flex items-center gap-3 p-4 pb-2">
              <button type="button" onClick={() => setSheet(null)} aria-label="返回">
                <ChevronLeft className="h-5 w-5 text-zinc-500" />
              </button>
              <CoverImg
                src={sheet.kind === 'artist' ? sheet.artist.img1v1Url || sheet.artist.picUrl : sheet.album.picUrl}
                className="h-12 w-12"
                rounded={sheet.kind === 'artist' ? 'rounded-full' : 'rounded-lg'}
                alt={sheet.kind === 'artist' ? sheet.artist.name : sheet.album.name}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">
                  {sheet.kind === 'artist' ? sheet.artist.name : sheet.album.name}
                </p>
                <p className="truncate text-[11px] text-zinc-400">
                  {sheet.kind === 'artist' ? '歌手' : sheet.album.artist?.name ?? '专辑'} · {sheet.songs.length} 首
                </p>
              </div>
              <button
                type="button"
                onClick={() => void toggleSub()}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] ${
                  sheet.subed
                    ? 'border-zinc-300 text-zinc-500'
                    : 'border-[#C20C0C] text-[#C20C0C]'
                }`}
              >
                {sheet.subed ? '已收藏' : '收藏'}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-6">
              {sheet.songs.length === 0 ? (
                <LoadingBlock />
              ) : (
                sheet.songs.map((s, i) => (
                  <SongRow key={`${s.id}-${i}`} song={s} queue={sheet.songs} index={i} onMore={() => {}} />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 加载中遮罩 */}
      {loading && (
        <div className="pointer-events-none absolute right-4 top-[120px]">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        </div>
      )}
    </div>
  );
}
