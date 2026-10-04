'use client';

/**
 * 音乐 App 播放页（仿网易云黑胶）：
 * - 封面模糊背景 + 黑胶唱片（旋转动画）+ 唱针（播放贴合/暂停抬起）
 * - 封面区点击切换歌词视图（LRC 滚动 + 翻译，当前行高亮自动居中）
 * - 进度条拖拽 / 音量 / 循环模式 / 播放暂停 / 上下首 / 播放列表
 * - 红心 / 评论 / 更多（一起听邀请、下载、加入队列、清空队列）
 * - 一起听态：顶部双头像重叠 + 距离/时长 + 音乐/聊天胶囊切换
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ClipboardList,
  Download,
  Heart,
  ListMusic,
  Loader2,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  MoreVertical,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Trash2,
  TriangleAlert,
  UserPlus,
  UserRoundSearch,
  Volume2,
  X,
} from 'lucide-react';
import { songArtistText, songCover, type NcmSong } from '@/lib/ios/music-api';
import { useMusic, getGuestAvatar, type RepeatMode, type TogetherSessionLike, type TogetherMsgLike } from '@/lib/ios/music-store';
import {
  listTogetherCandidates,
  startTogether,
  stopTogether,
  togetherRecommend,
  useTogetherLive,
} from '@/lib/ios/music-ai';
import type { ContactRecord } from '@/lib/contacts';
import { CoverImg, fmtClock } from './music-shared';
import { TogetherChat } from './music-together';

export function MusicPlayer() {
  const close = useMusic((s) => s.closePlayer);
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const buffering = useMusic((s) => s.buffering);
  const position = useMusic((s) => s.position);
  const duration = useMusic((s) => s.duration);
  const mode = useMusic((s) => s.mode);
  const volume = useMusic((s) => s.volume);
  const playError = useMusic((s) => s.playError);
  const freeTrial = useMusic((s) => s.freeTrial);
  const together = useMusic((s) => s.together);
  const togetherMsgs = useMusic((s) => s.togetherMsgs);
  const likedIds = useMusic((s) => s.likedIds);
  const toggleLike = useMusic((s) => s.toggleLike);
  const toggle = useMusic((s) => s.toggle);
  const next = useMusic((s) => s.next);
  const prev = useMusic((s) => s.prev);
  const seek = useMusic((s) => s.seek);
  const setVolume = useMusic((s) => s.setVolume);
  const setMode = useMusic((s) => s.setMode);
  const openComments = useMusic((s) => s.openComments);
  const loadLyric = useMusic((s) => s.loadLyric);

  const [showLyric, setShowLyric] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // 一起听右上角 ⋮ 菜单（重新匹配/查看记录/匹配偏好/举报/退出一起听）
  const [showTgMenu, setShowTgMenu] = useState(false);
  const [showTgRecord, setShowTgRecord] = useState(false);
  // 重新匹配入口打开时，邀请面板标题切换
  const [inviteTitle, setInviteTitle] = useState('邀请一起听');
  // 一起听时默认聊天视图；用户手动切换后以手动值为准（chatOverride=null 表示跟随默认）
  const [chatOverride, setChatOverride] = useState<boolean | null>(null);
  const showChat = chatOverride ?? !!together;
  const [moreToast, setMoreToast] = useState('');
  // 对方信息跟随全局（联系人库里最新头像/昵称）
  const togetherLive = useTogetherLive();

  useEffect(() => {
    if (current) void loadLyric(current.id);
  }, [current, loadLyric]);

  if (!current) {
    return (
      <div className="relative flex h-full flex-col bg-[#101010]">
        <PlayerTopBar onClose={close} title="播放器" light />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
          <Music2 className="h-12 w-12 opacity-30" />
          <p className="text-[13px]">队列是空的，去挑几首歌吧</p>
          <button
            type="button"
            onClick={close}
            className="rounded-full bg-white/10 px-5 py-1.5 text-[12px] text-zinc-300"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  const liked = likedIds.has(current.id);
  const chatMode = !!(together && showChat);

  // 一起听底部胶囊（音乐/聊天切换）——两种模式共用
  const modeCapsule = together ? (
    <div className="flex shrink-0 justify-center pb-5 pt-1">
      <div className="flex rounded-full bg-white/10 p-0.5">
        <button
          type="button"
          onClick={() => setChatOverride(false)}
          className={`flex items-center gap-1 rounded-full px-5 py-1.5 text-[12px] ${
            !showChat ? 'bg-white/25 text-white' : 'text-white/60'
          }`}
        >
          <Music2 className="h-3.5 w-3.5" />
          音乐
        </button>
        <button
          type="button"
          onClick={() => setChatOverride(true)}
          data-testid="music-tg-open-chat"
          className={`flex items-center gap-1 rounded-full px-5 py-1.5 text-[12px] ${
            showChat ? 'bg-white/25 text-white' : 'text-white/60'
          }`}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          聊天
        </button>
      </div>
    </div>
  ) : null;

  const togetherHead = together ? (
    <TogetherHead session={togetherLive ?? together} />
  ) : null;

  // 结束一起听（⋮ 菜单内）
  const endTogether = () => {
    void (async () => {
      await stopTogether();
      setChatOverride(false);
    })();
  };

  // ⋮ 菜单动作
  const openTgMenu = () => setShowTgMenu(true);
  const menuRematch = () => {
    setShowTgMenu(false);
    setInviteTitle('重新匹配');
    setShowInvite(true);
  };
  const menuRecords = () => {
    setShowTgMenu(false);
    setShowTgRecord(true);
  };
  const menuPref = () => {
    setShowTgMenu(false);
    setMoreToast('已按你们的听歌口味自动匹配~');
  };
  const menuReport = () => {
    setShowTgMenu(false);
    if (confirm('确定举报 TA 在一起听中的行为吗？')) setMoreToast('已提交举报，感谢反馈');
  };
  const menuExit = () => {
    setShowTgMenu(false);
    endTogether();
  };

  // 聊天态：全屏独立布局（顶栏+双头像+聊天区+胶囊），不再与播放控制区堆叠
  if (chatMode) {
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-[#101010] text-white" data-testid="music-player">
        <div
          className="absolute inset-0 scale-150 bg-cover bg-center opacity-40 blur-3xl"
          style={{ backgroundImage: `url(${songCover(current)})` }}
        />
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
          <PlayerTopBar onClose={close} light onMenu={openTgMenu} />
          {togetherHead}
          <div className="min-h-0 flex-1" data-testid="music-player-chat-mode">
            <TogetherChat />
          </div>
          {modeCapsule}
        </div>
        {showMore && (
          <MoreSheet
            song={current}
            liked={liked}
            onClose={() => setShowMore(false)}
            onToast={(m) => setMoreToast(m)}
            onInvite={() => {
              setShowMore(false);
              setShowInvite(true);
            }}
            onShowQueue={() => {
              setShowMore(false);
              setShowQueue(true);
            }}
            onShowLyric={() => {
              setShowMore(false);
              setChatOverride(false);
            }}
          />
        )}
        {showQueue && <QueueSheet onClose={() => setShowQueue(false)} />}
        {showInvite && <InviteSheet title={inviteTitle} onClose={() => setShowInvite(false)} />}

        {/* 一起听 ⋮ 菜单（聊天态） */}
        {showTgMenu && (
          <TogetherMenu
            onClose={() => setShowTgMenu(false)}
            onRematch={menuRematch}
            onRecords={menuRecords}
            onPref={menuPref}
            onReport={menuReport}
            onExit={menuExit}
          />
        )}

        {/* 查看一起听记录（聊天态） */}
        {showTgRecord && (
          <TgRecordSheet session={together!} msgs={togetherMsgs} onClose={() => setShowTgRecord(false)} />
        )}

        {moreToast && (
          <div className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full bg-white/20 px-4 py-1.5 text-[12px] text-white backdrop-blur">
            {moreToast}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#101010] text-white" data-testid="music-player">
      {/* 背景：封面模糊 */}
      <div
        className="absolute inset-0 scale-150 bg-cover bg-center opacity-40 blur-3xl"
        style={{ backgroundImage: `url(${songCover(current)})` }}
      />
      <div className="absolute inset-0 bg-black/35" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
        <PlayerTopBar
          onClose={close}
          light
          onMore={together ? undefined : () => setShowMore(true)}
          onMenu={together ? openTgMenu : undefined}
        />

        {/* 歌词界面隐藏双头像；黑胶界面才展示 */}
        {!showLyric && togetherHead}

        {/* 封面/歌词切换区 */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center px-8">
          {showLyric ? (
            <LyricView onSwitch={() => setShowLyric(false)} />
          ) : (
            <VinylView
              song={current}
              playing={playing}
              onSwitch={() => setShowLyric(true)}
            />
          )}
        </div>

        {/* 歌名行 */}
        <div className="flex items-end gap-3 px-6 pb-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[19px] font-bold" data-testid="music-player-name">
                {current.name}
              </h2>
              {freeTrial && (
                <span className="shrink-0 rounded-[3px] border border-white/50 px-1 text-[9px] leading-[14px]">
                  试听
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-white/60" data-testid="music-player-artist">
              {songArtistText(current)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void toggleLike(current)}
            data-testid="music-player-like"
            aria-label="红心"
            className="p-1 active:scale-90"
          >
            <Heart
              className={`h-6 w-6 ${liked ? 'text-[#EC4141]' : 'text-white/70'}`}
              fill={liked ? 'currentColor' : 'none'}
            />
          </button>
          <button type="button" onClick={() => openComments(current)} aria-label="评论" className="p-1 active:scale-90">
            <MessageCircle className="h-6 w-6 text-white/70" />
          </button>
        </div>

        {/* 进度条 */}
        <div className="px-6 pt-2">
          <SeekBar position={position} duration={duration || 1} onSeek={seek} />
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-white/50">
            <span>{fmtClock(position)}</span>
            <span>{fmtClock(duration)}</span>
          </div>
          {playError && (
            <p className="mt-0.5 text-center text-[11px] text-red-300" data-testid="music-player-error">
              {playError}
            </p>
          )}
        </div>

        {/* 音量（一起听模式下隐藏） */}
        {!together && (
          <div className="flex items-center gap-2 px-6 pt-1">
            <Volume2 className="h-3.5 w-3.5 shrink-0 text-white/50" />
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              className="music-volume-slider h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/20"
              style={{ accentColor: '#EC4141' }}
              aria-label="音量"
            />
          </div>
        )}

        {/* 控制区 */}
        <div className="flex items-center justify-between px-8 pb-2 pt-3">
          <button
            type="button"
            onClick={() => {
              const order: RepeatMode[] = ['order', 'repeat', 'one', 'shuffle'];
              const idx = order.indexOf(mode);
              setMode(order[(idx + 1) % order.length]);
            }}
            data-testid="music-player-mode"
            aria-label="播放模式"
            className="p-1 text-white/80 active:scale-90"
          >
            {mode === 'order' && <Repeat className="h-[22px] w-[22px]" />}
            {mode === 'repeat' && <Repeat className="h-[22px] w-[22px] text-[#EC4141]" />}
            {mode === 'one' && <Repeat1 className="h-[22px] w-[22px] text-[#EC4141]" />}
            {mode === 'shuffle' && <Shuffle className="h-[22px] w-[22px] text-[#EC4141]" />}
          </button>
          <button type="button" onClick={() => void prev()} aria-label="上一首" className="p-1 active:scale-90">
            <SkipBack className="h-7 w-7" fill="currentColor" />
          </button>
          <button
            type="button"
            onClick={toggle}
            data-testid="music-player-toggle"
            aria-label={playing ? '暂停' : '播放'}
            className="flex h-[62px] w-[62px] items-center justify-center rounded-full border-2 border-white/80 active:scale-95"
          >
            {buffering ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : playing ? (
              <Pause className="h-8 w-8" fill="currentColor" />
            ) : (
              <Play className="ml-1 h-8 w-8" fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void next(false)}
            data-testid="music-player-next"
            aria-label="下一首"
            className="p-1 active:scale-90"
          >
            <SkipForward className="h-7 w-7" fill="currentColor" />
          </button>
          <button
            type="button"
            onClick={() => setShowQueue(true)}
            aria-label="播放列表"
            className="p-1 text-white/80 active:scale-90"
          >
            <ListMusic className="h-[22px] w-[22px]" />
          </button>
        </div>

        {/* 一起听底部胶囊 / 普通态底部留白 */}
        {modeCapsule}
        {!together && <div className="h-[34px] shrink-0" />}
      </div>

      {/* 更多面板 */}
      {showMore && (
        <MoreSheet
          song={current}
          liked={liked}
          onClose={() => setShowMore(false)}
          onToast={(m) => setMoreToast(m)}
          onInvite={() => {
            setShowMore(false);
            setShowInvite(true);
          }}
          onShowQueue={() => {
            setShowMore(false);
            setShowQueue(true);
          }}
          onShowLyric={() => {
            setShowMore(false);
            setShowLyric(true);
          }}
        />
      )}

      {/* 播放列表 */}
      {showQueue && <QueueSheet onClose={() => setShowQueue(false)} />}

      {/* 邀请/重新匹配一起听 */}
      {showInvite && <InviteSheet title={inviteTitle} onClose={() => setShowInvite(false)} />}

      {/* 一起听 ⋮ 菜单 */}
      {showTgMenu && together && (
        <TogetherMenu
          onClose={() => setShowTgMenu(false)}
          onRematch={menuRematch}
          onRecords={menuRecords}
          onPref={menuPref}
          onReport={menuReport}
          onExit={menuExit}
        />
      )}

      {/* 查看一起听记录 */}
      {showTgRecord && together && (
        <TgRecordSheet session={together} msgs={togetherMsgs} onClose={() => setShowTgRecord(false)} />
      )}

      {moreToast && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full bg-white/20 px-4 py-1.5 text-[12px] text-white backdrop-blur">
          {moreToast}
        </div>
      )}
    </div>
  );
}

// ---------------- 顶栏 ----------------

function PlayerTopBar({
  onClose,
  title,
  light,
  onMore,
  onMenu,
}: {
  onClose: () => void;
  /** 顶部标题（可选；一起听/播放模式默认不展示） */
  title?: string;
  light?: boolean;
  onMore?: () => void;
  /** 一起听态：右上角 ⋮ 菜单（重新匹配/查看记录/匹配偏好设置/举报/退出一起听） */
  onMenu?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-5 pb-1 pt-[58px]">
      <button type="button" onClick={onClose} aria-label="收起" data-testid="music-player-close">
        <ChevronDown className={`h-7 w-7 ${light ? 'text-white/85' : 'text-zinc-600'}`} />
      </button>
      <div className="min-w-0 flex-1 text-center">
        {title && <p className={`truncate text-[13px] ${light ? 'text-white/90' : 'text-zinc-700'}`}>{title}</p>}
      </div>
      {onMenu ? (
        <button
          type="button"
          onClick={onMenu}
          aria-label="一起听菜单"
          data-testid="music-tg-menu-btn"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/30 active:scale-95"
        >
          <MoreVertical className="h-[19px] w-[19px] text-white/90" />
        </button>
      ) : onMore ? (
        <button type="button" onClick={onMore} aria-label="更多" data-testid="music-player-more">
          <MoreHorizontal className={`h-6 w-6 ${light ? 'text-white/85' : 'text-zinc-600'}`} />
        </button>
      ) : (
        <span className="w-6" />
      )}
    </div>
  );
}

// ---------------- 黑胶视图 ----------------

function VinylView({
  song,
  playing,
  onSwitch,
}: {
  song: NcmSong;
  playing: boolean;
  onSwitch: () => void;
}) {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center">
      {/* 唱针 */}
      <div
        className="absolute left-1/2 top-[-6px] z-20 h-[120px] w-[120px] origin-[14px_14px] transition-transform duration-500"
        style={{ transform: playing ? 'rotate(0deg)' : 'rotate(-28deg)' }}
      >
        <div className="absolute left-[7px] top-[7px] h-3.5 w-3.5 rounded-full bg-zinc-200 shadow" />
        <div className="absolute left-[13px] top-[13px] h-[74px] w-[3px] origin-top rotate-[26deg] rounded-full bg-gradient-to-b from-zinc-200 to-zinc-400" />
        <div className="absolute left-[38px] top-[82px] h-4 w-2.5 rotate-[26deg] rounded-[2px] bg-zinc-300 shadow" />
      </div>

      {/* 黑胶 */}
      <button
        type="button"
        onClick={onSwitch}
        data-testid="music-vinyl"
        aria-label="切换到歌词"
        className="relative mt-6 aspect-square w-full max-w-[290px]"
      >
        <div
          className="absolute inset-0 animate-[spin_20s_linear_infinite] rounded-full bg-[radial-gradient(circle,#2a2a2a_28%,#181818_29%,#232323_42%,#151515_43%,#1f1f1f_58%,#121212_59%,#1c1c1c_72%,#141414_73%,#191919_100%)] shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
          style={playing ? undefined : { animationPlayState: 'paused' }}
        >
          {/* 高光 */}
          <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,rgba(255,255,255,0.07),transparent_18%,rgba(255,255,255,0.05)_30%,transparent_52%,rgba(255,255,255,0.06)_75%,transparent_92%)]" />
          {/* 封面 */}
          <div className="absolute inset-[27%] overflow-hidden rounded-full ring-[3px] ring-black/60">
            <CoverImg src={songCover(song)} className="h-full w-full" alt={song.name} />
          </div>
          {/* 中心孔 */}
          <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0a0a0a] ring-1 ring-white/20" />
        </div>
      </button>
      <p className="mt-4 text-[11px] text-white/40">点按封面查看歌词</p>
    </div>
  );
}

// ---------------- 歌词视图 ----------------

function LyricView({ onSwitch }: { onSwitch: () => void }) {
  const lyricLines = useMusic((s) => s.lyricLines);
  const loading = useMusic((s) => s.lyricLoading);
  const showTr = useMusic((s) => s.lyricShowTr);
  const setShowTr = useMusic((s) => s.setLyricShowTr);
  const position = useMusic((s) => s.position);
  const seek = useMusic((s) => s.seek);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const activeIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].t <= position + 0.2) idx = i;
      else break;
    }
    return idx;
  }, [lyricLines, position]);

  useEffect(() => {
    // 当前行滚动居中
    const el = activeRef.current;
    const box = containerRef.current;
    if (!el || !box) return;
    box.scrollTo({
      top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2,
      behavior: 'smooth',
    });
  }, [activeIdx]);

  return (
    <div className="relative h-full w-full" data-testid="music-lyric-view">
      <div className="absolute right-1 top-0 z-10 flex gap-2">
        <button
          type="button"
          onClick={() => setShowTr(!showTr)}
          className={`rounded-full px-2.5 py-1 text-[10px] ${
            showTr ? 'bg-white/20 text-white' : 'bg-white/5 text-white/40'
          }`}
        >
          译
        </button>
        <button type="button" onClick={onSwitch} aria-label="返回封面" className="rounded-full bg-white/5 p-1.5 text-white/50">
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      <div ref={containerRef} className="h-full overflow-y-auto py-[45%] no-scrollbar" data-testid="music-lyric-scroll">
        {loading && <p className="text-center text-[13px] text-white/40">歌词加载中…</p>}
        {!loading && lyricLines.length === 0 && (
          <p className="text-center text-[13px] text-white/40">暂无歌词</p>
        )}
        {lyricLines.map((l, i) => (
          <div
            key={`${i}-${l.t}`}
            ref={i === activeIdx ? activeRef : null}
            onClick={() => seek(Math.max(0, l.t - 0.3))}
            className={`cursor-pointer px-2 py-2.5 text-center transition-all duration-300 ${
              i === activeIdx ? 'scale-100' : 'opacity-45'
            }`}
          >
            <p
              className={`text-[15px] font-medium leading-relaxed ${
                i === activeIdx ? 'text-white' : 'text-white/70'
              }`}
            >
              {l.text}
            </p>
            {showTr && l.tr && (
              <p className={`mt-0.5 text-[12px] leading-relaxed ${i === activeIdx ? 'text-white/80' : 'text-white/40'}`}>
                {l.tr}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- 进度条 ----------------

function SeekBar({
  position,
  duration,
  onSeek,
}: {
  position: number;
  duration: number;
  onSeek: (t: number) => void;
}) {
  const pct = Math.min(100, Math.max(0, (position / (duration || 1)) * 100));
  return (
    <div className="relative h-5 w-full">
      <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/20" />
      <div
        className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[#EC4141]"
        style={{ width: `${pct}%` }}
      />
      <div
        className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
        style={{ left: `${pct}%` }}
      />
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.floor(duration))}
        step={1}
        value={Math.floor(position)}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="播放进度"
        data-testid="music-player-seek"
      />
    </div>
  );
}

// ---------------- 一起听头部 ----------------

function TogetherHead({ session }: { session: TogetherSessionLike }) {
  const loginUid = useMusic((s) => s.loginUid);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const myAvatar = loginUid ? loginAvatar : getGuestAvatar();
  const mins = Math.max(1, Math.floor((Date.now() - session.since) / 60_000));
  const durText = mins >= 60 ? `${Math.floor(mins / 60)}小时${mins % 60}分钟` : `${mins}分钟`;
  return (
    <div className="flex flex-col items-center pb-1 pt-1" data-testid="music-tg-head">
      {/* 双头像（挨近一点） */}
      <div className="flex items-center gap-2" data-testid="music-tg-avatars">
        <CoverImg src={session.avatar} className="h-12 w-12 ring-2 ring-white/70" rounded="rounded-full" alt={session.name} />
        <CoverImg src={myAvatar} className="h-12 w-12 ring-2 ring-white/70" rounded="rounded-full" alt="我" />
      </div>
      <p className="mt-1.5 text-[11px] text-white/70">
        相距 {session.distanceKm} 公里 · 一起听了 {durText}
      </p>
    </div>
  );
}

// ---------------- 一起听 ⋮ 菜单（仿网易云：右上角下拉） ----------------

function TogetherMenu({
  onClose,
  onRematch,
  onRecords,
  onPref,
  onReport,
  onExit,
}: {
  onClose: () => void;
  onRematch: () => void;
  onRecords: () => void;
  onPref: () => void;
  onReport: () => void;
  onExit: () => void;
}) {
  const rows = [
    { k: 'rematch', label: '重新匹配', icon: <UserRoundSearch className="h-[19px] w-[19px]" /> , on: onRematch },
    { k: 'records', label: '查看记录', icon: <ClipboardList className="h-[19px] w-[19px]" />, on: onRecords },
    { k: 'pref', label: '匹配偏好设置', icon: <SlidersHorizontal className="h-[19px] w-[19px]" />, on: onPref },
    { k: 'report', label: '举报', icon: <TriangleAlert className="h-[19px] w-[19px]" />, on: onReport },
    { k: 'exit', label: '退出一起听', icon: <LogOut className="h-[19px] w-[19px]" />, on: onExit },
  ];
  return (
    <div className="absolute inset-0 z-[62]" data-testid="music-tg-menu">
      <button type="button" aria-label="关闭菜单" onClick={onClose} className="absolute inset-0 bg-black/45" />
      <div className="absolute right-4 top-[102px] w-[188px]">
        {/* 指向右上角按钮的小箭头 */}
        <div className="absolute -top-[6px] right-[24px] h-3 w-3 rotate-45 rounded-[2px] bg-[#2b2b2d]" />
        <div className="relative overflow-hidden rounded-[16px] bg-[#2b2b2d]/95 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          {rows.map((r, i) => (
            <button
              key={r.k}
              type="button"
              onClick={r.on}
              data-testid={`music-tg-menu-${r.k}`}
              className={`flex w-full items-center gap-3.5 px-4 py-[14px] text-left text-[15px] text-white/95 active:bg-white/10 ${
                i > 0 ? 'border-t border-white/[0.07]' : ''
              }`}
            >
              {r.icon}
              {r.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- 查看一起听记录 ----------------

function TgRecordSheet({
  session,
  msgs,
  onClose,
}: {
  session: TogetherSessionLike;
  msgs: TogetherMsgLike[];
  onClose: () => void;
}) {
  const history = useMusic((s) => s.history);
  // 本次一起听（since 之后）听过的歌（去重、新在前）
  const songs = useMemo(() => {
    const seen = new Set<number>();
    const out: NcmSong[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h.playedAt >= session.since && !seen.has(h.song.id)) {
        seen.add(h.song.id);
        out.push(h.song);
      }
    }
    return out;
  }, [history, session.since]);
  const mins = Math.max(1, Math.floor((Date.now() - session.since) / 60_000));
  const durText = mins >= 60 ? `${Math.floor(mins / 60)}小时${mins % 60}分钟` : `${mins}分钟`;
  const chatCount = msgs.filter((m) => m.role !== 'recs').length;
  return (
    <div className="absolute inset-0 z-[63] flex items-end" data-testid="music-tg-record">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative flex max-h-[68%] w-full flex-col rounded-t-2xl bg-[#1c1c1e]/95 backdrop-blur-xl">
        <div className="flex items-center justify-between px-5 py-3.5">
          <p className="text-[15px] font-bold text-white">一起听记录</p>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X className="h-5 w-5 text-white/60" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          <div className="flex items-center gap-3 px-5 py-2">
            <CoverImg src={session.avatar} className="h-11 w-11" rounded="rounded-full" alt={session.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] text-white/95">和 {session.name} 一起听</p>
              <p className="text-[11px] text-white/45">
                已一起听 {durText} · 聊了 {chatCount} 条消息
              </p>
            </div>
          </div>
          <p className="px-5 pb-1 pt-3 text-[12px] text-white/40">这次一起听过的歌（{songs.length}）</p>
          {songs.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-white/40">还没一起听过歌</p>
          ) : (
            songs.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-2">
                <CoverImg src={songCover(s)} className="h-10 w-10" rounded="rounded-md" alt={s.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-white/90">{s.name}</p>
                  <p className="truncate text-[11px] text-white/40">{songArtistText(s)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- 更多面板 ----------------

function MoreSheet({
  song,
  liked,
  onClose,
  onToast,
  onInvite,
  onShowQueue,
  onShowLyric,
}: {
  song: NcmSong;
  liked: boolean;
  onClose: () => void;
  onToast: (m: string) => void;
  onInvite: () => void;
  onShowQueue: () => void;
  onShowLyric: () => void;
}) {
  const addToQueue = useMusic((s) => s.addToQueue);
  const clearQueue = useMusic((s) => s.clearQueue);
  const openComments = useMusic((s) => s.openComments);
  const queue = useMusic((s) => s.queue);

  const download = async () => {
    try {
      const { songUrl } = await import('@/lib/ios/music-api');
      const { mediaProxyUrl } = await import('@/lib/ios/music-store');
      const r = await songUrl(song.id);
      if (!r.url) throw new Error('no url');
      const a = document.createElement('a');
      a.href = mediaProxyUrl(r.url);
      a.download = `${song.name} - ${songArtistText(song)}.mp3`;
      a.target = '_blank';
      a.click();
      onToast('已开始下载');
    } catch {
      onToast('下载失败（可能需要 VIP）');
    }
  };

  const share = async () => {
    const text = `正在听《${song.name}》 ${songArtistText(song)}`;
    try {
      if (navigator.share) await navigator.share({ title: text, text });
      else {
        await navigator.clipboard.writeText(text);
        onToast('已复制到剪贴板');
      }
    } catch {
      // 取消
    }
  };

  return (
    <div className="absolute inset-0 z-[66] flex items-end" data-testid="music-player-more-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative w-full rounded-t-2xl bg-[#1c1c1e]/95 p-4 pb-9 backdrop-blur-xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
        <div className="grid grid-cols-4 gap-y-4">
          {[
            {
              k: 'queue',
              label: `播放列表(${queue.length})`,
              icon: <ListMusic className="h-5 w-5" />,
              on: onShowQueue,
            },
            { k: 'lyric', label: '歌词', icon: <Music2 className="h-5 w-5" />, on: onShowLyric },
            { k: 'comment', label: '评论', icon: <MessageCircle className="h-5 w-5" />, on: () => { onClose(); openComments(song); } },
            { k: 'invite', label: '一起听', icon: <UserPlus className="h-5 w-5" />, on: onInvite },
            { k: 'download', label: '下载', icon: <Download className="h-5 w-5" />, on: () => void download() },
            { k: 'share', label: '分享', icon: <ChevronDown className="h-5 w-5" />, on: () => void share() },
            { k: 'addq', label: '加入队列', icon: <Play className="h-5 w-5" />, on: () => { addToQueue([song]); onToast('已加入队列'); onClose(); } },
            {
              k: 'clear',
              label: '清空队列',
              icon: <Trash2 className="h-5 w-5" />,
              on: () => {
                clearQueue();
                onClose();
              },
            },
          ].map((it) => (
            <button
              key={it.k}
              type="button"
              onClick={it.on}
              data-testid={`music-more-${it.k}`}
              className="flex flex-col items-center gap-1.5 text-white/85 active:scale-95"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10">{it.icon}</span>
              <span className="text-[10px]">{it.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-white/40">
          <Heart className={`h-3.5 w-3.5 ${liked ? 'text-[#EC4141]' : ''}`} fill={liked ? 'currentColor' : 'none'} />
          {liked ? '已红心这首歌' : '红心在播放页右侧按钮'}
        </div>
      </div>
    </div>
  );
}

// ---------------- 播放列表 ----------------

function QueueSheet({ onClose }: { onClose: () => void }) {
  const queue = useMusic((s) => s.queue);
  const qIndex = useMusic((s) => s.qIndex);
  const playQueueAt = useMusic((s) => s.playQueueAt);
  const removeFromQueue = useMusic((s) => s.removeFromQueue);
  const clearQueue = useMusic((s) => s.clearQueue);
  return (
    <div className="absolute inset-0 z-[66] flex items-end" data-testid="music-queue-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative flex max-h-[65%] w-full flex-col rounded-t-2xl bg-[#1c1c1e]/95 backdrop-blur-xl">
        <div className="flex items-center justify-between px-5 py-3.5">
          <p className="text-[14px] font-bold text-white">
            当前播放 <span className="text-[11px] font-normal text-white/40">({queue.length})</span>
          </p>
          <div className="flex items-center gap-4">
            <button type="button" onClick={clearQueue} className="text-[12px] text-white/50">
              清空
            </button>
            <button type="button" onClick={onClose} aria-label="关闭">
              <X className="h-5 w-5 text-white/60" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          {queue.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-white/40">队列是空的</p>
          ) : (
            queue.map((s, i) => (
              <div
                key={`${s.id}-${i}`}
                className={`flex items-center gap-3 px-5 py-2 ${i === qIndex ? 'bg-white/5' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    void playQueueAt(i);
                    onClose();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <CoverImg src={songCover(s)} className="h-9 w-9" rounded="rounded-md" alt={s.name} />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[13px] ${i === qIndex ? 'text-[#EC4141]' : 'text-white/90'}`}>
                      {s.name}
                    </p>
                    <p className="truncate text-[11px] text-white/40">{songArtistText(s)}</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => removeFromQueue(i)}
                  aria-label="移除"
                  className="shrink-0 p-1 text-white/30 active:scale-90"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- 邀请一起听 ----------------

function InviteSheet({ title = '邀请一起听', onClose }: { title?: string; onClose: () => void }) {
  const [list, setList] = useState<ContactRecord[] | null>(null);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        setList(await listTogetherCandidates());
      } catch {
        setList([]);
      }
    })();
  }, []);

  const invite = (cid: string) => {
    setBusyId(cid);
    void (async () => {
      const candidates = (await listTogetherCandidates()) ?? [];
      const c = candidates.find((x) => x.id === cid);
      if (c) startTogether(c);
      onClose();
    })();
  };

  return (
    <div className="absolute inset-0 z-[67] flex items-end" data-testid="music-invite-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative flex max-h-[70%] w-full flex-col rounded-t-2xl bg-white dark:bg-zinc-900">
        <div className="flex items-center justify-between px-5 py-3.5">
          <div>
            <p className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">{title}</p>
            <p className="text-[11px] text-zinc-400">选一位 AI 好友，和 TA 实时听歌聊天</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X className="h-5 w-5 text-zinc-400" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          {list === null ? (
            <LoadingInline />
          ) : list.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-zinc-400">还没有 AI 角色，先去微信/QQ 创建一个</p>
          ) : (
            list.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => invite(c.id)}
                disabled={!!busyId}
                data-testid={`music-invite-${c.id}`}
                className="flex w-full items-center gap-3 px-5 py-2.5 text-left active:bg-black/5 disabled:opacity-50 dark:active:bg-white/10"
              >
                <CoverImg src={c.avatar ?? undefined} className="h-11 w-11" rounded="rounded-full" alt={c.nickname || c.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-zinc-900 dark:text-zinc-100">{c.nickname || c.name}</p>
                  <p className="truncate text-[11px] text-zinc-400">
                    {c.relation || '好友'} {c.region ? `· ${c.region}` : ''}
                  </p>
                </div>
                {busyId === c.id && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingInline() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
    </div>
  );
}

// AI 推荐入口（聊天视图里用，这里 re-export 保持依赖单向）
export { togetherRecommend };
