'use client';

/**
 * 音乐小组件（主屏 4×2 通栏，iOS「音乐」小组件样式，用户参考图 1:1）：
 * - 左上专辑封面 + 歌名（粗体截断）/歌手 + 右上角声波装饰条；
 * - 真实进度条：已播时间 / 进度 / 剩余时间（-m:ss），直连音乐 store 的 position/duration
 *   （audio timeupdate 驱动，与播放页同一状态源，自动跟随）；
 * - 控制键：爱心收藏（Heart，红色实心=已喜欢）+ 上一首/播放暂停/下一首，直接调 useMusic 的
 *   toggle/next/prev/toggleLike（游客态红心走本地持久化，安全）；
 * - 无歌时显示空态（圆底音符 + 「尚未播放音乐」）；
 * - 点击小组件空白处打开音乐 App（HomeScreen 的 WIDGET_META.openApp 驱动）；
 *   控制键 pointerdown/click 双重 stopPropagation——既不触发开 App，也不参与主屏
 *   长按编辑/拖拽手势（与 MusicGlobalMini 的按钮拦截同思路）；
 * - 深浅主题自适应（dark: 变体；PhoneShell 壳上有 dark class）。
 */

import { Heart, Music2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useMusic } from '@/lib/ios/music-store';
import { songArtistText, songCover, songDurationMs } from '@/lib/ios/music-api';

/** 秒 → m:ss（进度条两侧时间） */
const fmt = (s: number) => {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

/** 声波装饰条高度序列（固定值，避免随机数导致水合不一致） */
const WAVE_BARS = [10, 16, 24, 18, 11];

export function MusicWidget() {
  const current = useMusic((s) => s.current);
  const playing = useMusic((s) => s.playing);
  const position = useMusic((s) => s.position);
  const duration = useMusic((s) => s.duration);
  const liked = useMusic((s) => (s.current ? s.likedIds.has(s.current.id) : false));

  /** 时长：engine durationchange 之前回退歌曲元数据时长 */
  const dur = duration > 0 ? duration : current ? songDurationMs(current) / 1000 : 0;
  const pos = Math.min(position, dur > 0 ? dur : position);
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  /** 控制键拦截：pointerdown 阻断主屏长按编辑/拖拽武装，click 阻断「点小组件开 App」 */
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      data-testid="music-widget"
      className="flex h-[168px] w-full select-none flex-col rounded-[24px] bg-white px-[15px] py-[12px] ring-1 ring-black/[0.05] dark:bg-[#232327] dark:ring-white/[0.08]"
    >
      {current ? (
        <>
          {/* 封面 + 歌名/歌手 + 声波装饰 */}
          <div className="flex items-center gap-[12px]">
            <img
              src={songCover(current)}
              alt={current.name}
              draggable={false}
              className="h-[64px] w-[64px] shrink-0 rounded-[12px] bg-black/[0.06] object-cover dark:bg-white/10"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold leading-[20px] tracking-tight text-[#0c0c0e] dark:text-[#f2f2f4]">
                {current.name}
              </p>
              <p className="mt-[3px] truncate text-[12.5px] leading-[16px] text-black/40 dark:text-white/45">
                {songArtistText(current)}
              </p>
            </div>
            <span aria-hidden="true" className="flex shrink-0 items-center gap-[2.5px]">
              {WAVE_BARS.map((h, i) => (
                <span
                  key={i}
                  className={`w-[3px] rounded-full transition-colors duration-300 ${
                    playing ? 'bg-black/30 dark:bg-white/40' : 'bg-black/[0.16] dark:bg-white/20'
                  }`}
                  style={{ height: `${h}px` }}
                />
              ))}
            </span>
          </div>

          {/* 进度条：已播 / 进度 / 剩余 */}
          <div className="mt-auto flex items-center gap-[10px]">
            <span className="w-[34px] shrink-0 text-right text-[12px] font-medium leading-none tabular-nums text-black/70 dark:text-white/70">
              {fmt(pos)}
            </span>
            <span className="relative h-[4px] flex-1 rounded-full bg-black/[0.12] dark:bg-white/[0.18]">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-black/45 dark:bg-white/70 transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="w-[42px] shrink-0 text-[12px] font-medium leading-none tabular-nums text-black/70 dark:text-white/70">
              -{fmt(Math.max(0, dur - pos))}
            </span>
          </div>

          {/* 控制键：爱心（左）+ 上一首/播放暂停/下一首（居中三连） */}
          <div className="mt-auto grid grid-cols-3 items-center">
            <button
              type="button"
              aria-label={liked ? '取消喜欢' : '喜欢'}
              data-testid="music-widget-like"
              onPointerDown={stop}
              onClick={(e) => {
                e.stopPropagation();
                void useMusic.getState().toggleLike(current);
              }}
              className={`-ml-[4px] flex h-[32px] w-[32px] items-center justify-center justify-self-start transition-transform active:scale-90 ${
                liked ? 'text-[#FF3B30] dark:text-[#FF453A]' : 'text-black/25 dark:text-white/30'
              }`}
            >
              <Heart className="h-[20px] w-[20px]" fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
            <div className="flex items-center justify-center gap-[30px]">
              <button
                type="button"
                aria-label="上一首"
                data-testid="music-widget-prev"
                onPointerDown={stop}
                onClick={(e) => {
                  e.stopPropagation();
                  void useMusic.getState().prev();
                }}
                className="flex h-[32px] w-[32px] items-center justify-center text-[#0c0c0e] transition-transform active:scale-90 dark:text-white"
              >
                <SkipBack className="h-[21px] w-[21px]" fill="currentColor" strokeWidth={0} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={playing ? '暂停' : '播放'}
                data-testid="music-widget-toggle"
                onPointerDown={stop}
                onClick={(e) => {
                  e.stopPropagation();
                  useMusic.getState().toggle();
                }}
                className="flex h-[36px] w-[36px] items-center justify-center text-[#0c0c0e] transition-transform active:scale-90 dark:text-white"
              >
                {playing ? (
                  <Pause className="h-[25px] w-[25px]" fill="currentColor" strokeWidth={0} aria-hidden="true" />
                ) : (
                  <Play className="ml-[2px] h-[25px] w-[25px]" fill="currentColor" strokeWidth={0} aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                aria-label="下一首"
                data-testid="music-widget-next"
                onPointerDown={stop}
                onClick={(e) => {
                  e.stopPropagation();
                  void useMusic.getState().next();
                }}
                className="flex h-[32px] w-[32px] items-center justify-center text-[#0c0c0e] transition-transform active:scale-90 dark:text-white"
              >
                <SkipForward className="h-[21px] w-[21px]" fill="currentColor" strokeWidth={0} aria-hidden="true" />
              </button>
            </div>
            <span aria-hidden="true" />
          </div>
        </>
      ) : (
        /* 空态：还没播过歌（快照为空） */
        <div className="flex flex-1 flex-col items-center justify-center gap-[10px]" data-testid="music-widget-empty">
          <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.08]">
            <Music2 className="h-[22px] w-[22px] text-black/30 dark:text-white/35" strokeWidth={2} aria-hidden="true" />
          </span>
          <p className="text-[12px] font-medium text-black/40 dark:text-white/40">尚未播放音乐</p>
        </div>
      )}
    </div>
  );
}
