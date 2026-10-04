'use client';

/**
 * 音乐 App 播放页（仿网易云黑胶）：
 * - 封面模糊背景 + 黑胶唱片（旋转动画）+ 唱针（播放贴合/暂停抬起）
 * - 封面区点击切换歌词视图（LRC 滚动 + 翻译，当前行高亮自动居中；点空白处回唱片）
 * - 进度条拖拽 / 循环模式 / 播放暂停 / 上下首 / 播放列表
 * - 右上角更多：仿网易云歌曲面板（为TA心动/收藏/下载/分享/一起听/评论/相似漫游/音质）
 * - 一起听态：顶部双头像 + 累计时长（跨会话永久保存） + 音乐/聊天胶囊切换
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  ChevronDown,
  ClipboardList,
  Disc2,
  DiscAlbum,
  Disc3,
  Download,
  FolderPlus,
  Forward,
  Heart,
  Info,
  ListMusic,
  Loader2,
  LogOut,
  MessageCircle,
  MessageCircleMore,
  MessagesSquare,
  MicVocal,
  MoreHorizontal,
  MoreVertical,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Repeat,
  Repeat1,
  SendHorizonal,
  Shuffle,
  SlidersHorizontal,
  ShoppingCart,
  SkipBack,
  SkipForward,
  TriangleAlert,
  UserRound,
  UserRoundPlus,
  UserRoundSearch,
  X,
} from 'lucide-react';
import { artistSub, commentsOf, simiSong, songArtistText, songCover, type NcmSong } from '@/lib/ios/music-api';
import { useMusic, getGuestAvatar, type RepeatMode, type TogetherSessionLike, type TogetherMsgLike } from '@/lib/ios/music-store';
import {
  fmtTogetherDur,
  listTogetherCandidates,
  sendTogetherText,
  startTogether,
  stopTogether,
  togetherRecommend,
  useTogetherLive,
} from '@/lib/ios/music-ai';
import type { ContactRecord } from '@/lib/contacts';
import { AddToSongSheet, CoverImg, fmtClock } from './music-shared';
import { TogetherChat } from './music-together';

export function MusicPlayer() {
  const close = useMusic((s) => s.closePlayer);
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const buffering = useMusic((s) => s.buffering);
  const position = useMusic((s) => s.position);
  const duration = useMusic((s) => s.duration);
  const mode = useMusic((s) => s.mode);
  const playError = useMusic((s) => s.playError);
  const freeTrial = useMusic((s) => s.freeTrial);
  const together = useMusic((s) => s.together);
  const togetherMsgs = useMusic((s) => s.togetherMsgs);
  const loginUid = useMusic((s) => s.loginUid);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  const likedIds = useMusic((s) => s.likedIds);
  const toggleLike = useMusic((s) => s.toggleLike);
  const toggle = useMusic((s) => s.toggle);
  const next = useMusic((s) => s.next);
  const prev = useMusic((s) => s.prev);
  const seek = useMusic((s) => s.seek);
  const setMode = useMusic((s) => s.setMode);
  const openComments = useMusic((s) => s.openComments);
  const loadLyric = useMusic((s) => s.loadLyric);

  const [showLyric, setShowLyric] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // 一起听设置菜单（重新匹配/查看记录/匹配偏好/举报/退出一起听）——顶栏⋮入口
  const [showTgMenu, setShowTgMenu] = useState(false);
  // 音乐界面底部快聊输入条（点信息图标弹出，可直接打字发送，不切聊天视图）
  const [showQuickInput, setShowQuickInput] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [showTgRecord, setShowTgRecord] = useState(false);
  // 重新匹配入口打开时，邀请面板标题切换
  const [inviteTitle, setInviteTitle] = useState('邀请一起听');
  // 一起听进入时默认显示音乐界面；用户手动切换后以手动值为准（chatOverride=null 表示跟随默认）
  const [chatOverride, setChatOverride] = useState<boolean | null>(null);
  const showChat = chatOverride ?? false;
  // 新会话开始/换人时回到默认（音乐界面）——render 期派生重置（React 官方 adjust-state 模式）
  const tgKey = together ? `${together.contactId}:${together.since}` : '';
  const [prevTgKey, setPrevTgKey] = useState(tgKey);
  if (tgKey !== prevTgKey) {
    setPrevTgKey(tgKey);
    if (chatOverride !== null) setChatOverride(null);
  }
  const [moreToast, setMoreToast] = useState('');
  // 对方信息跟随全局（联系人库里最新头像/昵称）
  const togetherLive = useTogetherLive();

  useEffect(() => {
    if (current) void loadLyric(current.id);
  }, [current, loadLyric]);

  // 评论总数（真实接口，仅用于底部数字展示）——render 期派生重置避免 effect 同步 setState
  const curId = current?.id ?? 0;
  const [cmtState, setCmtState] = useState<{ id: number; total: number | null }>({ id: 0, total: null });
  if (cmtState.id !== curId) setCmtState({ id: curId, total: null });
  useEffect(() => {
    if (!curId) return;
    let on = true;
    void (async () => {
      try {
        const p = await commentsOf(curId, 1, 0);
        if (on) setCmtState((s) => (s.id === curId ? { id: curId, total: p.total } : s));
      } catch {
        // 数量获取失败不展示数字
      }
    })();
    return () => {
      on = false;
    };
  }, [curId]);

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

  // 快聊发送（不切视图，直接发 → 气泡显示在头像下 5 秒）
  const sendQuick = () => {
    const t = quickText.trim();
    if (!t || !together) return;
    sendTogetherText(t);
    setQuickText('');
  };

  // 设置菜单动作（顶栏⋮ / 底部三个点共用）
  const openTgMenu = () => {
    setShowTgMenu(true);
  };

  // 一起听底部（仅音乐唱片视图显示）：音乐/聊天方形圆角胶囊居中；三个点贴最右开歌曲操作面板；自己一个人时显示「邀请好友一起听」
  const modeCapsule = together ? (
    <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-1">
      <span className="h-8 w-8 shrink-0" aria-hidden />
      <div className="flex items-center gap-1 rounded-[14px] bg-white/10 p-1">
        <button
          type="button"
          onClick={() => setChatOverride(false)}
          data-testid="music-tg-tab-music"
          aria-label="音乐视图"
          className={`flex h-8 w-8 items-center justify-center rounded-[10px] ${
            !showChat ? 'bg-white/25 text-white' : 'text-white/55'
          }`}
        >
          <Music2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setChatOverride(true)}
          data-testid="music-tg-open-chat"
          aria-label="聊天视图"
          className={`flex h-8 w-8 items-center justify-center rounded-[10px] ${
            showChat ? 'bg-white/25 text-white' : 'text-white/55'
          }`}
        >
          <MessageCircle className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={() => setShowMore(true)}
        data-testid="music-tg-dots"
        aria-label="歌曲操作面板"
        className="flex h-8 w-8 shrink-0 items-center justify-center text-white/85 active:scale-95"
      >
        <MoreVertical className="h-[19px] w-[19px]" />
      </button>
    </div>
  ) : (
    <div className="flex shrink-0 justify-center pb-4 pt-1">
      <button
        type="button"
        onClick={() => setShowInvite(true)}
        data-testid="music-tg-invite-solo"
        className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-[13px] text-white/85 active:scale-95"
      >
        <UserRoundPlus className="h-4 w-4" />
        邀请好友一起听
      </button>
    </div>
  );

  const togetherHead = together ? (
    <TogetherHead session={togetherLive ?? together} msgs={togetherMsgs} showBubbles={!showChat} />
  ) : null;
  // 歌曲操作面板「正在一起听」格子展示的双头像（在一起听时才传）
  const tgAvatars = together
    ? { peer: (togetherLive ?? together).avatar, mine: myAvatarOf(loginUid, loginAvatar) }
    : null;

  // 结束一起听（⋮ 菜单内）
  const endTogether = () => {
    void (async () => {
      await stopTogether();
      setChatOverride(false);
    })();
  };

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
          <PlayerTopBar onClose={close} light onMenu={openTgMenu} onMusic={() => setChatOverride(false)} dense />
          {togetherHead}
          <div className="min-h-0 flex-1" data-testid="music-player-chat-mode">
            <TogetherChat />
          </div>
          {/* 聊天视图不再重复底部胶囊（只留输入区），顶部中央有切回音乐按钮 */}
        </div>
        {showQueue && <QueueSheet onClose={() => setShowQueue(false)} />}
        {showInvite && <InviteSheet title={inviteTitle} onClose={() => setShowInvite(false)} />}

        {/* 更多面板（聊天态也可用） */}
        {showMore && (
          <MoreSheet
            song={current}
            liked={liked}
            tg={tgAvatars}
            onClose={() => setShowMore(false)}
            onToast={(m) => setMoreToast(m)}
            onInvite={() => {
              setShowMore(false);
              setShowInvite(true);
            }}
          />
        )}

        {/* 一起听设置菜单（聊天态） */}
        {showTgMenu && (
          <TogetherMenu
            session={together!}
            myAvatar={myAvatarOf(loginUid, loginAvatar)}
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
          dense={!!together}
          onMore={together ? undefined : () => setShowMore(true)}
          onMenu={together ? openTgMenu : undefined}
        />

        {/* 歌词界面隐藏双头像；黑胶界面才展示 */}
        {!showLyric && togetherHead}

      {/* 封面/歌词切换区（留出顶部唱针空间） */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center px-8 pt-4">
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

        {/* 歌名行 + 操作图标（信息/爱心/评论；数字在各自图标正上方，等距排开不重叠） */}
        <div className="flex items-end justify-between gap-2 pl-5 pr-8 pb-1">
          <div className="min-w-0 flex-1 pb-0.5">
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
          {/* 信息图标：一起听时点击底部弹出输入框（气泡显示在头像下）；自己听不显示；纯图标无底色 */}
          <div className="flex shrink-0 items-center gap-7 pt-4">
            {together && (
              <button
                type="button"
                onClick={() => setShowQuickInput((v) => !v)}
                data-testid="music-player-chat"
                aria-label="发消息"
                className={`flex h-6 w-6 shrink-0 items-center justify-center active:scale-95 ${
                  showQuickInput ? 'text-white' : 'text-white/75'
                }`}
              >
                <MessagesSquare className="h-[22px] w-[22px]" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void toggleLike(current)}
              data-testid="music-player-like"
              aria-label="红心"
              className="relative shrink-0 p-0.5 active:scale-90"
            >
              <Heart
                className={`h-[25px] w-[25px] ${liked ? 'text-[#EC4141]' : 'text-white/75'}`}
                fill={liked ? 'currentColor' : 'none'}
              />
              <span className="absolute -top-[15px] left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium leading-none tabular-nums text-white/55">
                {fmtCountW(fakeHotCount(current.id))}
              </span>
            </button>
            <button
              type="button"
              onClick={() => openComments(current)}
              aria-label="评论"
              data-testid="music-player-comment"
              className="relative shrink-0 p-0.5 active:scale-90"
            >
              <MessageCircleMore className="h-[25px] w-[25px] text-white/75" />
              <span
                className="absolute -top-[15px] left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium leading-none tabular-nums text-white/55"
                data-testid="music-player-comment-count"
              >
                {cmtState.total === null ? '' : fmtCountW(cmtState.total)}
              </span>
            </button>
          </div>
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

        {/* 一起听底部胶囊只在音乐唱片视图显示（歌词/聊天视图不重复展示） */}
        {!showLyric && modeCapsule}

        {/* 音乐界面快聊输入条（一起听时点信息图标弹出；发送后气泡显示在头像下 5 秒） */}
        {together && showQuickInput && !showLyric && (
          <QuickInputBar
            value={quickText}
            onChange={setQuickText}
            onSend={sendQuick}
            onClose={() => setShowQuickInput(false)}
          />
        )}
      </div>

      {/* 更多面板（仿网易云歌曲操作面板；三个点入口，正在一起听格子显示双方头像） */}
      {showMore && (
        <MoreSheet
          song={current}
          liked={liked}
          tg={tgAvatars}
          onClose={() => setShowMore(false)}
          onToast={(m) => setMoreToast(m)}
          onInvite={() => {
            setShowMore(false);
            setShowInvite(true);
          }}
        />
      )}

      {/* 播放列表 */}
      {showQueue && <QueueSheet onClose={() => setShowQueue(false)} />}

      {/* 邀请/重新匹配一起听 */}
      {showInvite && <InviteSheet title={inviteTitle} onClose={() => setShowInvite(false)} />}

      {/* 一起听设置菜单（顶栏⋮ / 底部三点） */}
      {showTgMenu && together && (
        <TogetherMenu
          session={togetherLive ?? together}
          myAvatar={myAvatarOf(loginUid, loginAvatar)}
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
  onMusic,
  dense,
}: {
  onClose: () => void;
  /** 顶部标题（可选；一起听/播放模式默认不展示） */
  title?: string;
  light?: boolean;
  onMore?: () => void;
  /** 一起听态：右上角 ⋮ 菜单（重新匹配/查看记录/匹配偏好设置/举报/退出一起听） */
  onMenu?: () => void;
  /** 聊天视图：顶部中央切回音乐视图按钮（底部胶囊已不再在聊天视图重复展示） */
  onMusic?: () => void;
  /** 紧凑顶栏（一起听：双头像更贴顶） */
  dense?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-5 pb-1 ${dense ? 'pt-[46px]' : 'pt-[58px]'}`}>
      <button type="button" onClick={onClose} aria-label="收起" data-testid="music-player-close">
        <ChevronDown className={`h-7 w-7 ${light ? 'text-white/85' : 'text-zinc-600'}`} />
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-center">
        {onMusic ? (
          <button
            type="button"
            onClick={onMusic}
            data-testid="music-tg-back-music"
            aria-label="切回音乐界面"
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-[12px] text-white/85 active:scale-95"
          >
            <Music2 className="h-3.5 w-3.5" />
            音乐界面
          </button>
        ) : title ? (
          <p className={`truncate text-[13px] ${light ? 'text-white/90' : 'text-zinc-700'}`}>{title}</p>
        ) : null}
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
    <div className="relative flex h-full w-full flex-col items-center">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        {/* 黑胶（细密纹路 + 立体边缘 + 深色唱针，仿网易云；尺寸随空间自适应不溢出） */}
        <button
          type="button"
          onClick={onSwitch}
          data-testid="music-vinyl"
          aria-label="切换到歌词"
          className="relative aspect-square h-full max-h-[256px] max-w-full shrink-0"
        >
          {/* 唱针（深色金属风，右上角进入；播放贴盘 / 暂停抬起）——缩短后整体限制在唱片上缘，不再挡住上方的时长文字 */}
          <div
            className="absolute right-[5%] top-[-10px] z-20 h-[88px] w-[96px] origin-[10px_10px] transition-transform duration-500"
            style={{ transform: playing ? 'rotate(0deg)' : 'rotate(-26deg)' }}
          >
            {/* 轴承底座 */}
            <div className="absolute left-0 top-0 h-[18px] w-[18px] rounded-full bg-[#2c2c30] shadow-[0_2px_6px_rgba(0,0,0,0.55)] ring-1 ring-white/20" />
            <div className="absolute left-[4.5px] top-[4.5px] h-2 w-2 rounded-full bg-[#525257] ring-1 ring-black/60" />
            {/* 针杆（细金属臂，向下伸向盘面） */}
            <div className="absolute left-[8px] top-[8px] h-[64px] w-[2.5px] origin-top rotate-[26deg] rounded-full bg-gradient-to-b from-[#9a9aa2] via-[#5f5f66] to-[#38383d]" />
            {/* 针头（深色小唱头，落在盘缘） */}
            <div className="absolute left-[22px] top-[66px] h-[13px] w-[6.5px] rotate-[26deg] rounded-[3px] bg-[#3a3a40] shadow-[0_1px_3px_rgba(0,0,0,0.6)] ring-1 ring-white/10" />
          </div>

          {/* 外缘深黑圈（不随旋转，提供立体边缘） */}
          <div className="absolute inset-0 rounded-full bg-[#050505] shadow-[0_24px_64px_rgba(0,0,0,0.6),0_4px_14px_rgba(0,0,0,0.5)]" />
          {/* 胶片主体（旋转）：细密同心纹路 */}
          <div
            className="absolute inset-[2.5%] animate-[spin_20s_linear_infinite] overflow-hidden rounded-full"
            style={
              playing
                ? {
                    background:
                      'repeating-radial-gradient(circle at 50% 50%, #141414 0px, #232323 1.5px, #0d0d0d 3px, #1a1a1a 4.5px), radial-gradient(circle, #1e1e1e 0%, #161616 34%, #1b1b1b 58%, #111111 78%, #191919 100%)',
                    boxShadow:
                      'inset 0 2px 5px rgba(255,255,255,0.10), inset 0 -3px 8px rgba(0,0,0,0.85), inset 0 0 34px rgba(0,0,0,0.55)',
                  }
                : {
                    background:
                      'repeating-radial-gradient(circle at 50% 50%, #141414 0px, #232323 1.5px, #0d0d0d 3px, #1a1a1a 4.5px), radial-gradient(circle, #1e1e1e 0%, #161616 34%, #1b1b1b 58%, #111111 78%, #191919 100%)',
                    boxShadow:
                      'inset 0 2px 5px rgba(255,255,255,0.10), inset 0 -3px 8px rgba(0,0,0,0.85), inset 0 0 34px rgba(0,0,0,0.55)',
                    animationPlayState: 'paused',
                  }
            }
          >
            {/* 斜向高光 */}
            <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_210deg,rgba(255,255,255,0.09),transparent_16%,rgba(255,255,255,0.05)_32%,transparent_55%,rgba(255,255,255,0.07)_74%,transparent_93%)]" />
            {/* 封面（占比更大） */}
            <div className="absolute inset-[23.5%] overflow-hidden rounded-full ring-[3px] ring-black/70">
              <CoverImg src={songCover(song)} className="h-full w-full" alt={song.name} />
            </div>
            {/* 中心孔 */}
            <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0a0a0a] ring-1 ring-white/25" />
          </div>
        </button>
      </div>
      <p className="shrink-0 pb-1 pt-1.5 text-[11px] text-white/40">点按封面查看歌词</p>
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
      <div
        ref={containerRef}
        onClick={onSwitch}
        data-testid="music-lyric-backdrop"
        className="h-full overflow-y-auto py-[45%] no-scrollbar"
      >
        {loading && <p className="text-center text-[13px] text-white/40">歌词加载中…</p>}
        {!loading && lyricLines.length === 0 && (
          <p className="text-center text-[13px] text-white/40">暂无歌词</p>
        )}
        {lyricLines.map((l, i) => (
          <div
            key={`${i}-${l.t}`}
            ref={i === activeIdx ? activeRef : null}
            onClick={(e) => {
              e.stopPropagation(); // 点歌词行=跳播进度，不返回唱片
              seek(Math.max(0, l.t - 0.3));
            }}
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

// ---------------- 数字格式化（按截图：150w+ / 2w+） ----------------

/** 数量格式化：≥1w 显示「Nw+」，否则原数 */
function fmtCountW(n: number): string {
  if (n >= 10_000) return `${Math.floor(n / 10_000)}w+`;
  return `${n}`;
}

/** 歌曲热度（演示：按歌曲 id 稳定生成 40w~1100w+） */
function fakeHotCount(id: number): number {
  const n = Math.abs(id) || 1;
  return 400_000 + (n % 350) * 30_000 + (n % 13) * 5_000;
}

// ---------------- 一起听头部 ----------------

/** 气泡展示时长（毫秒）：超过后自动隐藏 */
const BUBBLE_TTL = 5000;

function TogetherHead({
  session,
  msgs,
  showBubbles = false,
}: {
  session: TogetherSessionLike;
  /** 一起听消息（音乐视图下取双方最新一条，显示为头像下气泡，5 秒后消失） */
  msgs?: TogetherMsgLike[];
  showBubbles?: boolean;
}) {
  const loginUid = useMusic((s) => s.loginUid);
  const loginAvatar = useMusic((s) => s.loginAvatar);
  // 双方最新一条消息（推荐卡取文字）
  let lastMine: TogetherMsgLike | undefined;
  let lastPeer: TogetherMsgLike | undefined;
  if (showBubbles && msgs) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!lastMine && m.role === 'me') lastMine = m;
      if (!lastPeer && (m.role === 'peer' || m.role === 'recs')) lastPeer = m;
      if (lastMine && lastPeer) break;
    }
  }
  // 气泡 5 秒自动消失：到期后触发一次重渲染抹掉
  const lastAt = Math.max(lastMine?.time ?? 0, lastPeer?.time ?? 0);
  const [, tickNow] = useState(0);
  useEffect(() => {
    if (!showBubbles || !lastAt) return;
    const remain = BUBBLE_TTL - (Date.now() - lastAt);
    if (remain <= 0) return;
    const t = setTimeout(() => tickNow((n) => n + 1), remain + 60);
    return () => clearTimeout(t);
  }, [lastAt, showBubbles]);
  const nowMs = Date.now();
  const visMine = !!lastMine && nowMs - lastMine.time < BUBBLE_TTL;
  const visPeer = !!lastPeer && nowMs - lastPeer.time < BUBBLE_TTL;
  const hasBubble = visMine || visPeer;
  // 累计时长（跨会话永久保存：since 锚点 = 现在 - 历史累计）
  const durText = fmtTogetherDur(nowMs - session.since);
  return (
    <div className="flex flex-col items-center pt-1 pb-0.5" data-testid="music-tg-head">
      {/* 双头像（变大，紧贴交叠，无边框/无徽章/无耳机线，干净利落） */}
      <div className="relative z-10 flex items-center" data-testid="music-tg-avatars">
        <CoverImg src={session.avatar} className="h-16 w-16" rounded="rounded-full" alt={session.name} />
        <CoverImg src={myAvatarOf(loginUid, loginAvatar)} className="relative -ml-2.5 h-16 w-16" rounded="rounded-full" alt="我" />
      </div>
      {/* 头像下气泡（音乐视图）：紧贴双头像正下方居中聚拢——对方在左、我在右，尾巴朝上各自指向头像，5 秒后消失；出现时隐藏时长行 */}
      {showBubbles && hasBubble && (
        <div className="mx-auto mt-1 flex w-full max-w-[300px] items-start justify-center gap-8 px-4">
          {visPeer && lastPeer && <HeadBubble text={lastPeer.text} mine={false} />}
          {visMine && lastMine && <HeadBubble text={lastMine.text} mine />}
        </div>
      )}
      {!hasBubble && (
        <p className="mt-1.5 text-[11px] text-white/70">
          相距 {session.distanceKm} 公里 · 一起听了 {durText}
        </p>
      )}
    </div>
  );
}

/** 我的头像（登录 > 游客自定义/全局） */
function myAvatarOf(loginUid: number | null, loginAvatar: string): string {
  return loginUid ? loginAvatar : getGuestAvatar();
}

// ---------------- 音乐界面底部快聊输入条（点信息图标弹出） ----------------

function QuickInputBar({
  value,
  onChange,
  onSend,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  // 键盘偏移只在输入框聚焦时计算，失焦立即归零（防止键盘已收起但 visualViewport 事件残留导致输入条浮顶）
  const [focused, setFocused] = useState(false);
  const [kb, setKb] = useState(0);
  useEffect(() => {
    if (!focused) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const upd = () => {
      // iOS overlay 键盘：布局视口不变、可视视口变小；overlap ≈ 键盘高度。Android resize 模式 overlap≈0 天然贴底
      setKb(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    };
    vv.addEventListener('resize', upd);
    vv.addEventListener('scroll', upd);
    upd();
    return () => {
      vv.removeEventListener('resize', upd);
      vv.removeEventListener('scroll', upd);
    };
  }, [focused]);
  // 聚焦时浏览器会把页面往上推（scrollIntoView）——立即滚回原位，保证界面不动，只有输入条跟键盘抬起
  const keepViewport = () => {
    const y = window.scrollY;
    requestAnimationFrame(() => window.scrollTo(0, y));
    setTimeout(() => window.scrollTo(0, y), 150);
  };
  return (
    <>
      {/* 点击输入条以外的任何地方 → 收起输入条（透明遮罩，不改变背景观感） */}
      <button
        type="button"
        aria-label="收起输入框"
        onClick={onClose}
        data-testid="music-quick-input-backdrop"
        className="absolute inset-0 z-[39] cursor-default"
        style={{ backgroundColor: 'transparent' }}
      />
      <div
        className="absolute inset-x-0 bottom-0 z-[40] flex items-center gap-2 bg-black/55 px-4 pb-7 pt-3 backdrop-blur-xl"
        data-testid="music-quick-input"
        style={{
          animation: 'quick-in-up 0.22s ease-out',
          transform: kb > 0 ? `translateY(-${kb}px)` : undefined,
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            setFocused(true);
            keepViewport();
          }}
          onBlur={() => {
            setFocused(false);
            setKb(0); // 失焦立即归零（键盘收起后不再保留上移偏移）
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSend();
          }}
          placeholder="和 TA 聊聊这首歌…"
          data-testid="music-quick-input-field"
          className="h-9 min-w-0 flex-1 rounded-full bg-white/12 px-4 text-[13px] text-white outline-none placeholder:text-white/35"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!value.trim()}
          data-testid="music-quick-input-send"
          aria-label="发送"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EC4141] text-white disabled:opacity-40 active:scale-95"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起输入框"
          data-testid="music-quick-input-close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 active:scale-95"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}

/** 头像下的小气泡（实色深灰，带朝向头像的小尾巴；紧凑宽度不遮挡唱片） */
function HeadBubble({ text, mine }: { text: string; mine: boolean }) {
  return (
    <div
      className="relative mt-2 max-w-[150px] rounded-[18px] bg-[#5a5a5f] px-3 py-1.5"
      data-testid={mine ? 'music-tg-bubble-me' : 'music-tg-bubble-peer'}
    >
      <span
        className={`absolute -top-[5px] h-3 w-3 rotate-45 rounded-[3px] bg-[#5a5a5f] ${mine ? 'right-5' : 'left-5'}`}
      />
      <p className="relative line-clamp-2 break-words text-[12px] leading-snug text-white/95">{text}</p>
    </div>
  );
}

// ---------------- 一起听设置菜单（仿网易云：顶栏⋮ / 底部三点两处入口；顶部显示双方头像） ----------------

function TogetherMenu({
  session,
  myAvatar,
  onClose,
  onRematch,
  onRecords,
  onPref,
  onReport,
  onExit,
}: {
  /** 当前一起听会话（顶部展示双方头像） */
  session: TogetherSessionLike;
  /** 我的头像（登录 > 游客） */
  myAvatar: string;
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
        {/* 指向入口按钮的小箭头 */}
        <div className="absolute right-[24px] h-3 w-3 rotate-45 rounded-[2px] bg-[#2b2b2d] -top-[6px]" />
        <div className="relative overflow-hidden rounded-[16px] bg-[#2b2b2d]/95 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          {/* 双方头像（一起听中） */}
          <div className="flex flex-col items-center gap-1.5 border-b border-white/[0.07] px-4 pb-3 pt-3.5">
            <div className="flex items-center">
              <CoverImg src={session.avatar} className="h-11 w-11" rounded="rounded-full" alt={session.name} />
              <CoverImg src={myAvatar} className="relative -ml-2 h-11 w-11" rounded="rounded-full" alt="我" />
            </div>
            <p className="max-w-full truncate text-[10px] text-white/55">正在和 {session.name} 一起听</p>
          </div>
          {rows.map((r, i) => (
            <button
              key={r.k}
              type="button"
              onClick={r.on}
              data-testid={`music-tg-menu-${r.k}`}
              className={`flex w-full items-center gap-3.5 px-4 py-[13px] text-left text-[15px] text-white/95 active:bg-white/10 ${
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
  // 本次一起听（segStart 之后）听过的歌（去重、新在前）；时长展示用累计锚点
  const segStart = session.segStart ?? session.since;
  const songs = useMemo(() => {
    const seen = new Set<number>();
    const out: NcmSong[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h.playedAt >= segStart && !seen.has(h.song.id)) {
        seen.add(h.song.id);
        out.push(h.song);
      }
    }
    return out;
  }, [history, segStart]);
  const durText = fmtTogetherDur(Date.now() - session.since);
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

// ---------------- 更多面板（仿网易云歌曲操作面板） ----------------

const MORE_QUALITIES = ['标准', '较高', '极高'];

function MoreSheet({
  song,
  liked,
  tg,
  onClose,
  onToast,
  onInvite,
}: {
  song: NcmSong;
  liked: boolean;
  /** 在一起听时「正在一起听」格子显示双方真实头像 */
  tg?: { peer: string; mine: string } | null;
  onClose: () => void;
  onToast: (m: string) => void;
  onInvite: () => void;
}) {
  const openComments = useMusic((s) => s.openComments);
  const toggleLike = useMusic((s) => s.toggleLike);
  const playSong = useMusic((s) => s.playSong);
  const [showAdd, setShowAdd] = useState(false);
  const [cmtTotal, setCmtTotal] = useState<number | null>(null);
  const [qIdx, setQIdx] = useState(2);

  // 评论数（真实接口，只取总数）
  useEffect(() => {
    let on = true;
    void (async () => {
      try {
        const p = await commentsOf(song.id, 1, 0);
        if (on) setCmtTotal(p.total);
      } catch {
        // 数量获取失败不影响面板
      }
    })();
    return () => {
      on = false;
    };
  }, [song.id]);

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

  // 关注歌手（真实接口；游客态会提示需登录）
  const followArtist = async () => {
    const artist = song.artists?.[0];
    if (!artist) return;
    try {
      await artistSub(artist.id, 1);
      onToast(`已关注 ${artist.name}`);
    } catch {
      onToast('登录网易云账号后才能关注歌手');
    }
  };

  // 相似歌曲漫游：以当前歌的相似歌开播
  const roam = async () => {
    try {
      const list = await simiSong(song.id, 20);
      if (!list.length) {
        onToast('暂时没有找到相似歌曲');
        return;
      }
      onClose();
      void playSong(list[0], list);
      onToast('已开始相似歌曲漫游');
    } catch {
      onToast('漫游启动失败，稍后再试');
    }
  };

  const artistName = songArtistText(song);

  return (
    <div className="absolute inset-0 z-[66] flex items-end" data-testid="music-player-more-sheet">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/45" />
      <div className="relative flex max-h-[82%] w-full flex-col rounded-t-2xl bg-white pb-6 dark:bg-zinc-900">
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
          {/* 歌曲信息 + 为TA心动 */}
          <div className="flex items-center gap-3 px-5 pt-4">
            <CoverImg src={songCover(song)} className="h-12 w-12 shrink-0" rounded="rounded-lg" alt={song.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-[16px] font-bold text-zinc-900 dark:text-zinc-100">{song.name}</p>
                {song.fee === 1 && (
                  <span className="shrink-0 rounded-[3px] border border-[#EC4141]/50 px-1 text-[9px] leading-[14px] text-[#EC4141]">
                    VIP
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-[12px] text-zinc-400">{artistName}</p>
            </div>
            <button
              type="button"
              onClick={() => void toggleLike(song)}
              data-testid="music-more-heart"
              className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] active:scale-95 ${
                liked
                  ? 'border-[#EC4141]/40 text-[#EC4141]'
                  : 'border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200'
              }`}
            >
              <Heart className="h-3.5 w-3.5" fill={liked ? 'currentColor' : 'none'} />
              {liked ? '已心动' : '为TA心动'}
            </button>
          </div>

          <div className="mx-5 mt-4 border-t border-black/5 dark:border-white/10" />

          {/* 收藏 / 下载 / 分享 / 正在一起听 */}
          <div className="grid grid-cols-4 gap-y-2 px-3 py-4">
            {[
              {
                k: 'collect',
                label: '收藏',
                icon: <FolderPlus className="h-[22px] w-[22px]" />,
                on: () => setShowAdd(true),
              },
              {
                k: 'download',
                label: '下载',
                icon: (
                  <span className="relative">
                    <Download className="h-[22px] w-[22px]" />
                    <span className="absolute -bottom-1.5 -right-2.5 rounded-full bg-zinc-800 px-[3px] text-[7px] font-bold leading-[10px] text-[#F0D9A6] dark:bg-zinc-600">
                      VIP
                    </span>
                  </span>
                ),
                on: () => void download(),
              },
              {
                k: 'share',
                label: '分享',
                icon: <Forward className="h-[22px] w-[22px]" />,
                on: () => void share(),
              },
              {
                k: 'together',
                label: '正在一起听',
                icon: tg ? (
                  // 在一起听：显示双方真实头像（交叠，仿网易云）
                  <span className="flex items-center" data-testid="music-more-tg-avatars">
                    <CoverImg src={tg.peer} className="h-[26px] w-[26px]" rounded="rounded-full" alt="TA" />
                    <CoverImg
                      src={tg.mine}
                      className="relative -ml-2 h-[26px] w-[26px] ring-2 ring-white dark:ring-zinc-900"
                      rounded="rounded-full"
                      alt="我"
                    />
                  </span>
                ) : (
                  <span className="relative flex h-[22px] w-[32px] items-center justify-center">
                    <span className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-zinc-300 ring-2 ring-white dark:bg-zinc-600 dark:ring-zinc-900">
                      <UserRound className="h-2.5 w-2.5 text-white dark:text-zinc-300" fill="currentColor" />
                    </span>
                    <span className="-ml-1.5 flex h-[17px] w-[17px] items-center justify-center rounded-full bg-zinc-800 ring-2 ring-white dark:bg-zinc-300 dark:ring-zinc-900">
                      <UserRound className="h-2.5 w-2.5 text-zinc-600" fill="currentColor" />
                    </span>
                  </span>
                ),
                on: onInvite,
              },
            ].map((it) => (
              <button
                key={it.k}
                type="button"
                onClick={it.on}
                data-testid={`music-more-${it.k}`}
                className="flex flex-col items-center gap-1.5 text-zinc-700 active:scale-95 dark:text-zinc-200"
              >
                {it.icon}
                <span className="text-[11px]">{it.label}</span>
              </button>
            ))}
          </div>

          {/* 信息与功能行 */}
          <div className="px-5">
            <MoreRow
              icon={<MessageCircle className="h-[19px] w-[19px]" />}
              testid="music-more-comment"
              onClick={() => {
                onClose();
                openComments(song);
              }}
            >
              {cmtTotal === null ? '评论' : `评论(${cmtTotal})`}
            </MoreRow>
            {song.album?.name && (
              <MoreRow icon={<DiscAlbum className="h-[19px] w-[19px]" />}>专辑：{song.album.name}</MoreRow>
            )}
            <MoreRow
              icon={<MicVocal className="h-[19px] w-[19px]" />}
              testid="music-more-follow"
              onClick={() => void followArtist()}
            >
              <span className="inline-flex items-center gap-2">
                歌手：{artistName}
                <span className="inline-flex items-center gap-0.5 rounded-full bg-[#EC4141] px-2 py-[3px] text-[10px] font-medium text-white">
                  <Plus className="h-3 w-3" />
                  关注
                </span>
              </span>
            </MoreRow>
            <MoreRow icon={<Info className="h-[19px] w-[19px]" />} onClick={() => onToast('暂未收录这首歌的百科')}>
              查看歌曲百科
            </MoreRow>
            <MoreRow icon={<Radio className="h-[19px] w-[19px]" />} testid="music-more-roam" onClick={() => void roam()}>
              开始相似歌曲漫游
            </MoreRow>
            <MoreRow icon={<ShoppingCart className="h-[19px] w-[19px]" />} onClick={() => onToast('演示环境暂不支持单曲购买')}>
              单曲购买
            </MoreRow>
          </div>

          <div className="mx-5 mt-2 border-t border-black/5 dark:border-white/10" />

          <div className="px-5">
            <MoreRow
              icon={<Disc3 className="h-[19px] w-[19px]" />}
              testid="music-more-quality"
              onClick={() => {
                const nx = (qIdx + 1) % MORE_QUALITIES.length;
                setQIdx(nx);
                onToast(`音质已切换为${MORE_QUALITIES[nx]}`);
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                音质：{MORE_QUALITIES[qIdx]}
                <VipChip />
              </span>
            </MoreRow>
            <MoreRow icon={<AudioLines className="h-[19px] w-[19px]" />} onClick={() => onToast('3D 环绕音效已开启（演示）')}>
              音效
            </MoreRow>
            <MoreRow icon={<Disc2 className="h-[19px] w-[19px]" />} onClick={() => onToast('当前播放器样式：黑胶唱片')}>
              播放器样式
            </MoreRow>
          </div>
        </div>

        {/* 收藏到歌单（复用全局组件） */}
        {showAdd && <AddToSongSheet song={song} onClose={() => setShowAdd(false)} />}
      </div>
    </div>
  );
}

/** 更多面板列表行（左侧图标 + 文案；无 onClick 时纯展示） */
function MoreRow({
  icon,
  children,
  onClick,
  testid,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  testid?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      disabled={!onClick}
      className={`flex w-full items-center gap-4 py-[13px] text-left ${
        onClick ? 'active:bg-black/5 dark:active:bg-white/10' : 'cursor-default'
      }`}
    >
      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[14px] text-zinc-800 dark:text-zinc-200">{children}</span>
    </button>
  );
}

/** 迷你 VIP 胶囊（音质行内，仿网易云黑胶小标） */
function VipChip() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-zinc-900 py-[2.5px] pl-[4px] pr-[6px] dark:bg-zinc-700">
      <span className="relative mr-[3px] flex h-[11px] w-[11px] items-center justify-center rounded-full bg-[#101010] ring-[1px] ring-white/40">
        <span className="h-[4.5px] w-[4.5px] rounded-full bg-[#EC4141]" />
      </span>
      <span className="text-[9px] font-semibold leading-none text-white">VIP</span>
    </span>
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
