'use client';

/**
 * 音乐 App 全局 store + 播放引擎（网易云在线版）
 *
 * - 模块级 zustand `useMusic` + 惰性单例 HTMLAudioElement：App 组件卸载后音乐继续播。
 * - 媒体统一走同源代理 /api/music/stream?url=...（规避 http 直链混合内容拦截 + 补 Referer）。
 * - 持久化（IndexedDB kv，经 idb-kv）：
 *   · music-player        播放器快照（队列/当前歌/模式/音量），重启恢复队列不自动播
 *   · music-history:{uid} 最近播放（按网易云账号隔离，未登录 guest）
 *   · music-liked:{uid}   本地红心（登录态以云端 likelist 为准，此键为游客与镜像）
 *   · music-now           当前正在听的歌（供一起听/AI 上下文读取）
 * - 音频焦点：注册 'music'，开播前停掉语音/TTS 等其他音频。
 */

import { create } from 'zustand';
import {
  likeSong,
  likeList,
  songsDetail,
  songUrl,
  lyricOf,
  buildLyricLines,
  musicUid,
  getMusicLogin,
  type NcmSong,
  type NcmLyric,
} from './music-api';
import { kvGet, kvSet, isKvReady } from './idb-kv';
import { registerAudioSource, stopOtherAudio } from './audio-focus';

export type RepeatMode = 'order' | 'repeat' | 'one' | 'shuffle';

export interface HistoryItem {
  song: NcmSong;
  playedAt: number;
}

export interface LyricLine {
  t: number;
  text: string;
  tr: string;
}

/** 播放器快照（持久化） */
interface PlayerSnapshot {
  queue: NcmSong[];
  qIndex: number;
  mode: RepeatMode;
  volume: number;
}

const PLAYER_KEY = 'music-player';
const HISTORY_PREFIX = 'music-history:';
const LIKED_PREFIX = 'music-liked:';
const NOW_KEY = 'music-now';

/** 歌曲播放成功钩子（music-ai 注入：写一起听记忆等） */
type SongPlayedHook = (song: NcmSong) => void;
let songPlayedHook: SongPlayedHook | null = null;
export function setSongPlayedHook(fn: SongPlayedHook | null): void {
  songPlayedHook = fn;
}

// ---------------- audio 单例 ----------------

let audio: HTMLAudioElement | null = null;
let engineBound = false;

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  if (!engineBound) {
    engineBound = true;
    audio.addEventListener('timeupdate', () => {
      useMusic.setState({ position: audio?.currentTime ?? 0 });
    });
    audio.addEventListener('durationchange', () => {
      const d = audio?.duration;
      if (d && Number.isFinite(d)) useMusic.setState({ duration: d });
    });
    audio.addEventListener('play', () => useMusic.setState({ playing: true }));
    audio.addEventListener('pause', () => useMusic.setState({ playing: false }));
    audio.addEventListener('waiting', () => useMusic.setState({ buffering: true }));
    audio.addEventListener('playing', () => useMusic.setState({ buffering: false }));
    audio.addEventListener('ended', () => {
      useMusic.getState().next(true);
    });
    audio.addEventListener('error', () => {
      const s = useMusic.getState();
      if (s.current) s.failCurrent('播放失败：音频加载出错');
    });
  }
  return audio;
}

// 引擎停止回调（音频焦点：语音通话/语音消息/TTS 开播时停音乐）
function stopEngine(): void {
  if (audio) {
    audio.pause();
  }
}
registerAudioSource('music', stopEngine);

export function mediaProxyUrl(raw: string): string {
  return `/api/music/stream?url=${encodeURIComponent(raw)}`;
}

// ---------------- store ----------------

export interface MusicNav {
  view: 'tabs' | 'player' | 'playlist';
  tab: 'home' | 'search' | 'mine';
  /** 歌单详情参数 */
  playlistId: number | null;
  /** 特殊歌单：daily=每日推荐 liked=我的红心（云端） */
  playlistKind: 'normal' | 'daily' | 'liked';
}

/** 一起听会话/消息类型（具体逻辑在 music-ai.ts，状态放这里驱动 UI） */
export interface TogetherSessionLike {
  contactId: string;
  name: string;
  avatar: string;
  distanceKm: number;
  since: number;
  aiChatter: boolean;
}
export interface TogetherMsgLike {
  id: string;
  role: 'me' | 'peer' | 'recs';
  text: string;
  time: number;
  songs?: { id: number; name: string; artist: string; picUrl?: string }[];
  error?: boolean;
}

interface MusicState {
  booted: boolean;
  // 登录（music-api 持久层快照，驱动 UI 刷新）
  loginUid: number | null;
  loginNickname: string;
  loginAvatar: string;
  // 播放
  queue: NcmSong[];
  qIndex: number;
  current: NcmSong | null;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  mode: RepeatMode;
  volume: number;
  playError: string;
  freeTrial: boolean;
  // 歌词
  lyricLines: LyricLine[];
  lyricLoading: boolean;
  lyricFor: number | null;
  lyricShowTr: boolean;
  // 红心
  likedIds: Set<number>;
  likedSongs: Record<number, NcmSong>;
  // 历史
  history: HistoryItem[];
  // 导航
  nav: MusicNav;
  // 游客模式（未登录时「先逛逛」进入）
  guestMode: boolean;
  // 评论面板
  commentSong: NcmSong | null;
  // 一起听（活跃会话，由 music-ai 维护；状态放这里驱动播放页/聊天 UI）
  together: TogetherSessionLike | null;
  togetherMsgs: TogetherMsgLike[];

  boot: () => Promise<void>;
  openAppNow: () => void;
  setTab: (t: MusicNav['tab']) => void;
  openPlayer: () => void;
  closePlayer: () => void;
  openPlaylist: (id: number, kind?: MusicNav['playlistKind']) => void;
  closePlaylist: () => void;
  openComments: (s: NcmSong) => void;
  closeComments: () => void;

  playSong: (song: NcmSong, queue?: NcmSong[]) => Promise<void>;
  playQueueAt: (index: number) => Promise<void>;
  toggle: () => void;
  next: (auto?: boolean) => Promise<void>;
  prev: () => Promise<void>;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
  setMode: (m: RepeatMode) => void;
  addToQueue: (songs: NcmSong[]) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  failCurrent: (msg: string) => void;

  loadLyric: (songId: number) => Promise<void>;
  setLyricShowTr: (v: boolean) => void;

  initLiked: () => Promise<void>;
  toggleLike: (song: NcmSong) => Promise<void>;
  isLiked: (id: number) => boolean;

  refreshLoginUi: () => Promise<void>;
}

function saveSnapshot(s: MusicState): void {
  const snap: PlayerSnapshot = {
    queue: s.queue.slice(0, 200),
    qIndex: s.qIndex,
    mode: s.mode,
    volume: s.volume,
  };
  kvSet(PLAYER_KEY, snap);
}

export const useMusic = create<MusicState>((set, get) => ({
  booted: false,
  loginUid: null,
  loginNickname: '',
  loginAvatar: '',
  queue: [],
  qIndex: -1,
  current: null,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  mode: 'order',
  volume: 1,
  playError: '',
  freeTrial: false,
  lyricLines: [],
  lyricLoading: false,
  lyricFor: null,
  lyricShowTr: true,
  likedIds: new Set<number>(),
  likedSongs: {},
  history: [],
  nav: { view: 'tabs', tab: 'home', playlistId: null, playlistKind: 'normal' },
  guestMode: false,
  commentSong: null,
  together: null,
  togetherMsgs: [],

  boot: async () => {
    if (get().booted) return;
    set({ booted: true });
    ensureAudio();
    // 恢复快照
    const snap = kvGet<PlayerSnapshot>(PLAYER_KEY);
    if (snap && Array.isArray(snap.queue) && snap.queue.length) {
      const idx = Math.min(Math.max(0, snap.qIndex ?? 0), snap.queue.length - 1);
      set({
        queue: snap.queue,
        qIndex: idx,
        current: snap.queue[idx] ?? null,
        mode: snap.mode ?? 'order',
        volume: typeof snap.volume === 'number' ? snap.volume : 1,
      });
      if (audio) audio.volume = typeof snap.volume === 'number' ? snap.volume : 1;
    }
    // 恢复历史
    loadHistoryFor();
    // 登录态（异步校验）
    void get().refreshLoginUi();
  },

  openAppNow: () => {
    void get().boot();
  },

  setTab: (t) => set((s) => ({ nav: { ...s.nav, view: 'tabs', tab: t } })),
  openPlayer: () => set((s) => ({ nav: { ...s.nav, view: 'player' } })),
  closePlayer: () => set((s) => ({ nav: { ...s.nav, view: 'tabs' } })),
  openPlaylist: (id, kind = 'normal') =>
    set((s) => ({ nav: { ...s.nav, view: 'playlist', playlistId: id, playlistKind: kind } })),
  closePlaylist: () => set((s) => ({ nav: { ...s.nav, view: 'tabs' } })),
  openComments: (song) => set({ commentSong: song }),
  closeComments: () => set({ commentSong: null }),

  playSong: async (song, queue) => {
    const q = queue && queue.length ? queue.slice() : get().queue.length ? get().queue : [song];
    const idx = Math.max(0, q.findIndex((x) => x.id === song.id));
    set({ queue: q, qIndex: idx, current: song, playError: '', freeTrial: false });
    saveSnapshot(get());
    await get().playQueueAt(idx);
  },

  playQueueAt: async (index) => {
    const s = get();
    const song = s.queue[index];
    if (!song) return;
    const a = ensureAudio();
    stopOtherAudio('music'); // 音频焦点：停语音/TTS
    set({ qIndex: index, current: song, position: 0, duration: songDurationSec(song), playError: '', buffering: true });
    saveSnapshot(get());
    let url: string | null = null;
    let freeTrial = false;
    try {
      const r = await songUrl(song.id);
      url = r.url;
      freeTrial = r.freeTrial;
    } catch {
      url = null;
    }
    if (!url) {
      set({ buffering: false });
      get().failCurrent(
        get().loginUid
          ? '暂无播放链接：该歌曲可能需要 VIP 或已下架'
          : '游客暂不能播放该歌曲，登录网易云账号后可完整播放',
      );
      return;
    }
    a.src = mediaProxyUrl(url);
    a.volume = get().volume;
    try {
      await a.play();
      set({ playing: true, buffering: false, freeTrial });
      void onSongStarted(song);
    } catch {
      // 浏览器自动播放策略拦截：等待用户点击播放按钮
      set({ playing: false, buffering: false, freeTrial });
    }
  },

  toggle: () => {
    const a = ensureAudio();
    const s = get();
    if (!s.current) {
      if (s.queue.length) void s.playQueueAt(Math.max(0, s.qIndex));
      return;
    }
    if (s.playing) {
      a.pause();
    } else if (a.src) {
      stopOtherAudio('music');
      void a.play().catch(() => set({ playError: '播放失败，请重试' }));
    } else {
      void s.playQueueAt(Math.max(0, s.qIndex));
    }
  },

  next: async (auto = false) => {
    const s = get();
    if (!s.queue.length) return;
    if (s.mode === 'one' && auto) {
      const a = ensureAudio();
      a.currentTime = 0;
      void a.play().catch(() => {});
      return;
    }
    let idx: number;
    if (s.mode === 'shuffle') {
      idx = s.queue.length > 1 ? Math.floor(Math.random() * s.queue.length) : 0;
      if (s.queue.length > 1 && idx === s.qIndex) idx = (idx + 1) % s.queue.length;
    } else {
      idx = s.qIndex + 1;
      if (idx >= s.queue.length) {
        if (s.mode === 'repeat') idx = 0;
        else {
          // order 播完列表：停止（保留队列）
          set({ playing: false, position: 0 });
          if (auto) return;
          idx = 0;
        }
      }
    }
    await s.playQueueAt(idx);
  },

  prev: async () => {
    const s = get();
    if (!s.queue.length) return;
    const a = ensureAudio();
    if (a.currentTime > 3) {
      a.currentTime = 0;
      return;
    }
    const idx = s.qIndex - 1 < 0 ? s.queue.length - 1 : s.qIndex - 1;
    await s.playQueueAt(idx);
  },

  seek: (sec) => {
    const a = ensureAudio();
    if (Number.isFinite(sec)) {
      a.currentTime = sec;
      set({ position: sec });
    }
  },

  setVolume: (v) => {
    const a = ensureAudio();
    const vol = Math.min(1, Math.max(0, v));
    a.volume = vol;
    set({ volume: vol });
    saveSnapshot(get());
  },

  setMode: (m) => {
    set({ mode: m });
    saveSnapshot(get());
  },

  addToQueue: (songs) => {
    const s = get();
    const ids = new Set(s.queue.map((x) => x.id));
    const add = songs.filter((x) => !ids.has(x.id));
    const queue = [...s.queue, ...add];
    set({ queue });
    saveSnapshot(get());
  },

  removeFromQueue: (index) => {
    const s = get();
    const queue = s.queue.filter((_, i) => i !== index);
    let qIndex = s.qIndex;
    if (index < s.qIndex) qIndex -= 1;
    else if (index === s.qIndex) qIndex = Math.min(qIndex, queue.length - 1);
    set({ queue, qIndex });
    saveSnapshot(get());
  },

  clearQueue: () => {
    const a = ensureAudio();
    a.pause();
    a.removeAttribute('src');
    set({ queue: [], qIndex: -1, current: null, playing: false, position: 0, duration: 0 });
    saveSnapshot(get());
  },

  failCurrent: (msg) => set({ playError: msg, playing: false, buffering: false }),

  loadLyric: async (songId) => {
    if (get().lyricFor === songId && get().lyricLines.length) return;
    set({ lyricLoading: true, lyricFor: songId });
    try {
      const ly: NcmLyric = await lyricOf(songId);
      const lines = buildLyricLines(ly);
      set({ lyricLines: lines, lyricLoading: false });
    } catch {
      set({ lyricLines: [], lyricLoading: false });
    }
  },

  setLyricShowTr: (v) => set({ lyricShowTr: v }),

  initLiked: async () => {
    const s = get();
    if (s.loginUid) {
      try {
        const ids = await likeList(s.loginUid);
        set({ likedIds: new Set(ids) });
        // 拉详情补 likedSongs（分批 ≤500）
        const missing = ids.filter((id) => !s.likedSongs[id]).slice(0, 500);
        if (missing.length) {
          const songs = await songsDetail(missing);
          set((st) => {
            const m = { ...st.likedSongs };
            for (const sg of songs) m[sg.id] = sg;
            return { likedSongs: m };
          });
        }
      } catch {
        // 云端拉取失败保留现状
      }
    } else {
      const local = kvGet<{ song: NcmSong; at: number }[]>(`${LIKED_PREFIX}guest`);
      const ids = new Set<number>();
      const m: Record<number, NcmSong> = {};
      for (const it of local ?? []) {
        ids.add(it.song.id);
        m[it.song.id] = it.song;
      }
      set({ likedIds: ids, likedSongs: m });
    }
  },

  toggleLike: async (song) => {
    const s = get();
    const liked = s.likedIds.has(song.id);
    const nextLiked = new Set(s.likedIds);
    const nextSongs = { ...s.likedSongs };
    if (liked) {
      nextLiked.delete(song.id);
      delete nextSongs[song.id];
    } else {
      nextLiked.add(song.id);
      nextSongs[song.id] = song;
    }
    set({ likedIds: nextLiked, likedSongs: nextSongs });
    try {
      if (s.loginUid) {
        await likeSong(song.id, !liked);
      } else {
        const arr = [...nextLiked]
          .map((id) => nextSongs[id])
          .filter(Boolean)
          .map((sg) => ({ song: sg, at: Date.now() }));
        kvSet(`${LIKED_PREFIX}guest`, arr.slice(0, 500));
      }
    } catch {
      // 失败回滚
      const back = new Set(s.likedIds);
      set({ likedIds: back, likedSongs: s.likedSongs });
    }
  },

  isLiked: (id) => get().likedIds.has(id),

  refreshLoginUi: async () => {
    const { refreshLoginStatus } = await import('./music-api');
    const l = await refreshLoginStatus();
    if (l) {
      set({ loginUid: l.profile.userId, loginNickname: l.profile.nickname, loginAvatar: l.profile.avatarUrl, guestMode: false });
      void get().initLiked();
      loadHistoryFor();
    } else {
      set({ loginUid: null, loginNickname: '', loginAvatar: '', likedIds: new Set(), likedSongs: {}, guestMode: false });
      loadHistoryFor();
    }
  },
}));

// ---------------- 内部辅助 ----------------

function songDurationSec(s: NcmSong): number {
  const ms = s.duration ?? s.dt ?? 0;
  return ms > 0 ? ms / 1000 : 0;
}

function loadHistoryFor(): void {
  const uid = musicUid();
  const arr = kvGet<HistoryItem[]>(`${HISTORY_PREFIX}${uid}`);
  setHistory(arr ?? []);
}

function setHistory(arr: HistoryItem[]): void {
  useMusic.setState({ history: arr.slice(0, 100) });
}

async function onSongStarted(song: NcmSong): Promise<void> {
  // 最近播放
  const uid = musicUid();
  const key = `${HISTORY_PREFIX}${uid}`;
  const arr = (kvGet<HistoryItem[]>(key) ?? []).filter((x) => x.song.id !== song.id);
  arr.unshift({ song, playedAt: Date.now() });
  kvSet(key, arr.slice(0, 100));
  setHistory(arr.slice(0, 100));
  // 当前在听（跨模块可见）
  kvSet(NOW_KEY, { song, at: Date.now(), uid });
  // AI 钩子（一起听记忆等）
  if (songPlayedHook) {
    try {
      songPlayedHook(song);
    } catch {
      // 钩子失败不影响播放
    }
  }
}

/** 读取"当前在听"（一起听/AI 上下文用） */
export function nowPlayingSnapshot(): { song: NcmSong; at: number } | null {
  return kvGet<{ song: NcmSong; at: number }>(NOW_KEY);
}

export function musicEngineAudio(): HTMLAudioElement | null {
  return audio;
}

// ---------------- 模块加载即同步恢复 ----------------
// App 组件首帧渲染前 kv 已注水（PhoneShell 开机门控），这里同步读内存缓存即可
// 恢复登录态/播放快照/历史，避免首帧闪登录页；音频引擎等首次交互再惰性建。

if (typeof window !== 'undefined' && isKvReady()) {
  const l = getMusicLogin();
  if (l) {
    useMusic.setState({
      loginUid: l.profile.userId,
      loginNickname: l.profile.nickname,
      loginAvatar: l.profile.avatarUrl,
    });
  }
  const snap = kvGet<PlayerSnapshot>(PLAYER_KEY);
  if (snap && Array.isArray(snap.queue) && snap.queue.length) {
    const idx = Math.min(Math.max(0, snap.qIndex ?? 0), snap.queue.length - 1);
    useMusic.setState({
      queue: snap.queue,
      qIndex: idx,
      current: snap.queue[idx] ?? null,
      mode: snap.mode ?? 'order',
      volume: typeof snap.volume === 'number' ? snap.volume : 1,
    });
  }
  loadHistoryFor();
}
