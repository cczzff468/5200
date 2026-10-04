'use client';

/**
 * 音乐 App「我的」页：用户信息卡（头像/昵称/等级/听歌数）、快捷入口
 * （最近播放/听歌排行/我的红心/收藏歌手）、创建与收藏的歌单列表。
 */

import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Clock3,
  Heart,
  ListMusic,
  Loader2,
  Mic2,
  Plus,
  Star,
} from 'lucide-react';
import {
  getMusicLogin,
  musicUid,
  userDetail,
  userPlaylists,
  artistSublist,
  playlistCreate,
  type NcmPlaylist,
  type NcmUserDetail,
  type NcmArtist,
} from '@/lib/ios/music-api';
import { useMusic } from '@/lib/ios/music-store';
import {
  CoverImg,
  EmptyBlock,
  LoadingBlock,
  fmtPlayCount,
} from './music-shared';

type SheetKind = 'recent' | 'record' | 'liked' | 'artists' | null;

export function MusicMine() {
  const loginUid = useMusic((s) => s.loginUid);
  const loginNickname = useMusic((s) => s.loginNickname);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const openPlaylist = useMusic((s) => s.openPlaylist);
  const history = useMusic((s) => s.history);
  const [detail, setDetail] = useState<NcmUserDetail | null>(null);
  const [playlists, setPlaylists] = useState<NcmPlaylist[] | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loginUid) return;
    void (async () => {
      setDetail(await userDetail(loginUid));
      try {
        setPlaylists(await userPlaylists(loginUid));
      } catch {
        setPlaylists([]);
      }
    })();
  }, [loginUid]);

  const doCreate = async () => {
    const name = prompt('歌单名称');
    if (!name || !name.trim()) return;
    setCreating(true);
    try {
      const id = await playlistCreate(name.trim());
      setPlaylists(null);
      if (loginUid) setPlaylists(await userPlaylists(loginUid));
      void id;
    } catch {
      alert('创建失败');
    } finally {
      setCreating(false);
    }
  };

  if (!loginUid) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
          <Mic2 className="h-8 w-8 text-zinc-400" />
        </div>
        <p className="text-[16px] font-semibold text-zinc-800 dark:text-zinc-200">未登录</p>
        <p className="text-[12px] leading-relaxed text-zinc-400">
          登录网易云账号后，这里会展示你的歌单、收藏、红心歌曲与听歌排行
        </p>
        <button
          type="button"
          onClick={() => useMusic.getState().setTab('home')}
          className="mt-1 text-[12px] text-[#C20C0C] underline-offset-2 hover:underline"
        >
          去首页扫码登录 →
        </button>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setSheet('recent')}
            className="mt-3 rounded-full border border-zinc-300 px-4 py-1.5 text-[12px] text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
          >
            查看本地最近播放（{history.length}）
          </button>
        )}
      </div>
    );
  }

  const created = (playlists ?? []).filter((p) => p.creator?.userId === loginUid);
  const subscribed = (playlists ?? []).filter((p) => p.creator?.userId !== loginUid);

  return (
    <div className="h-full overflow-y-auto pb-4" data-testid="music-mine">
      {/* 顶栏 */}
      <div className="sticky top-0 z-20 flex items-center bg-[#F8F8F8]/90 px-4 pb-2 pt-[58px] backdrop-blur-xl dark:bg-black/90">
        <span className="text-[19px] font-bold text-zinc-900 dark:text-zinc-100">我的</span>
      </div>

      {/* 用户卡 */}
      <div className="mx-4 mt-1 rounded-2xl border border-black/5 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <div className="flex items-center gap-3.5">
          <CoverImg src={loginAvatar || detail?.profile.avatarUrl} className="h-14 w-14" rounded="rounded-full" alt={loginNickname} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-bold text-zinc-900 dark:text-zinc-100" data-testid="music-mine-nickname">
              {loginNickname || detail?.profile.nickname || '…'}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {detail ? `Lv.${detail.level} · 累计听歌 ${detail.listenSongs} 首` : '资料加载中…'}
            </p>
          </div>
        </div>
        {/* 快捷入口 */}
        <div className="mt-4 grid grid-cols-4 gap-1">
          {(
            [
              { k: 'recent', label: '最近播放', icon: <Clock3 className="h-5 w-5" /> },
              { k: 'record', label: '听歌排行', icon: <ListMusic className="h-5 w-5" /> },
              { k: 'liked', label: '我的红心', icon: <Heart className="h-5 w-5" /> },
              { k: 'artists', label: '收藏歌手', icon: <Star className="h-5 w-5" /> },
            ] as const
          ).map((it) => (
            <button
              key={it.k}
              type="button"
              onClick={() => setSheet(it.k)}
              data-testid={`music-mine-${it.k}`}
              className="flex flex-col items-center gap-1 rounded-xl py-2 text-zinc-700 active:bg-black/5 dark:text-zinc-200 dark:active:bg-white/10"
            >
              {it.icon}
              <span className="text-[10px]">{it.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 创建的歌单 */}
      <div className="mt-4 px-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[14px] font-bold text-zinc-900 dark:text-zinc-100">
            创建的歌单 <span className="text-[11px] font-normal text-zinc-400">{created.length}</span>
          </p>
          <button
            type="button"
            onClick={() => void doCreate()}
            disabled={creating}
            data-testid="music-mine-create-pl"
            className="flex items-center gap-1 text-[12px] text-[#C20C0C] disabled:opacity-40"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            新建
          </button>
        </div>
        {playlists === null ? (
          <LoadingBlock />
        ) : created.length === 0 ? (
          <EmptyBlock text="还没有创建歌单" />
        ) : (
          <PlaylistRows list={created} />
        )}
      </div>

      {/* 收藏的歌单 */}
      {subscribed.length > 0 && (
        <div className="mt-4 px-4">
          <p className="mb-2 text-[14px] font-bold text-zinc-900 dark:text-zinc-100">
            收藏的歌单 <span className="text-[11px] font-normal text-zinc-400">{subscribed.length}</span>
          </p>
          <PlaylistRows list={subscribed} />
        </div>
      )}

      {/* 各类半屏 */}
      {sheet && <MineSheet kind={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}

function PlaylistRows({ list }: { list: NcmPlaylist[] }) {
  const openPlaylist = useMusic((s) => s.openPlaylist);
  return (
    <div className="space-y-1">
      {list.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => openPlaylist(p.id)}
          className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left active:bg-black/5 dark:active:bg-white/10"
          data-testid={`music-mine-pl-${p.id}`}
        >
          <CoverImg src={p.coverImgUrl} className="h-12 w-12" rounded="rounded-lg" alt={p.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] text-zinc-900 dark:text-zinc-100">{p.name}</p>
            <p className="mt-0.5 truncate text-[11px] text-zinc-400">
              {p.trackCount}首 · {fmtPlayCount(p.playCount)}次播放
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />
        </button>
      ))}
    </div>
  );
}

// ---------------- 半屏面板 ----------------

function MineSheet({ kind, onClose }: { kind: Exclude<SheetKind, null>; onClose: () => void }) {
  const uid = useMusic((s) => s.loginUid) ?? 0;
  const [items, setItems] = useState<
    { key: string; title: string; subtitle: string; pic?: string; play?: () => void }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const playSong = useMusic((s) => s.playSong);
  const uidGuest = musicUid();

  useEffect(() => {
    void (async () => {
      try {
        if (kind === 'recent') {
          const st = useMusic.getState();
          setItems(
            st.history.map((h) => ({
              key: `h-${h.song.id}`,
              title: h.song.name,
              subtitle: h.song.artists?.map((a) => a.name).join('/') ?? '',
              pic: h.song.album?.picUrl,
              play: () => void playSong(h.song, st.history.map((x) => x.song)),
            })),
          );
        } else if (kind === 'record' && uid) {
          const { userRecord, songArtistText } = await import('@/lib/ios/music-api');
          const rec = await userRecord(uid, 0);
          setItems(
            rec.map((r) => ({
              key: `r-${r.song.id}`,
              title: r.song.name,
              subtitle: `${songArtistText(r.song)} · 播放${r.playCount}次`,
              pic: r.song.album?.picUrl,
              play: () => void playSong(r.song, rec.map((x) => x.song)),
            })),
          );
        } else if (kind === 'liked') {
          const st = useMusic.getState();
          await st.initLiked();
          const songs = [...st.likedIds].map((id) => st.likedSongs[id]).filter(Boolean);
          setItems(
            songs.map((s) => ({
              key: `l-${s.id}`,
              title: s.name,
              subtitle: s.artists?.map((a) => a.name).join('/') ?? '',
              pic: s.album?.picUrl,
              play: () => void playSong(s, songs),
            })),
          );
        } else if (kind === 'artists') {
          let list: NcmArtist[] = [];
          try {
            list = await artistSublist();
          } catch {
            list = [];
          }
          setItems(list.map((a) => ({ key: `a-${a.id}`, title: a.name, subtitle: '歌手', pic: a.img1v1Url || a.picUrl })));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [kind, uid, playSong, uidGuest]);

  const title =
    kind === 'recent' ? '最近播放' : kind === 'record' ? '听歌排行（所有时间）' : kind === 'liked' ? '我的红心歌曲' : '收藏的歌手';

  return (
    <div className="absolute inset-0 z-[65] flex items-end">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative flex max-h-[78%] w-full flex-col rounded-t-2xl bg-white dark:bg-zinc-900">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">{title}</p>
          <button type="button" onClick={onClose} className="text-[13px] text-zinc-400">
            关闭
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          {loading ? (
            <LoadingBlock />
          ) : items.length === 0 ? (
            <EmptyBlock text="这里还是空的" />
          ) : (
            items.map((it) => (
              <button
                key={it.key}
                type="button"
                onClick={it.play}
                className="flex w-full items-center gap-3 px-4 py-2 text-left active:bg-black/5 dark:active:bg-white/10"
              >
                <CoverImg src={it.pic} className="h-11 w-11" rounded="rounded-lg" alt={it.title} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-zinc-900 dark:text-zinc-100">{it.title}</p>
                  <p className="truncate text-[11px] text-zinc-400">{it.subtitle}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
