'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type TouchEvent } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  Image as ImageIcon,
  MoreHorizontal,
  Plus,
  Share2,
  Trash2,
  Wallpaper,
} from 'lucide-react';
import { genId, localDB, type PhotoRecord } from '@/lib/ios/db';
import { useSettings } from '@/lib/ios/store';
import { IOSNavBar, IOSTextButton } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';

/**
 * 相册 App（iOS 18 风格）：年/月/日分组图库 + 多选批量删除 + 全屏照片查看器。
 * 浅色模式下列表/网格为 bg-background 浅色；仅查看器内为黑底（图片查看场景）。
 */

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const;

interface DayGroup {
  key: string;
  label: string;
  photos: PhotoRecord[];
}

interface MonthGroup {
  key: string;
  label: string;
  days: DayGroup[];
}

interface YearGroup {
  key: string;
  label: string;
  months: MonthGroup[];
}

/** 按 年 → 月 → 日 分组（传入的照片需已按 createdAt 倒序） */
function buildYearGroups(photos: PhotoRecord[]): YearGroup[] {
  const years: YearGroup[] = [];
  const yearMap = new Map<number, YearGroup>();
  const monthMap = new Map<string, MonthGroup>();
  const dayMap = new Map<string, DayGroup>();

  for (const photo of photos) {
    const date = new Date(photo.createdAt);
    const y = date.getFullYear();
    const m = date.getMonth();
    const d = date.getDate();

    let yearGroup = yearMap.get(y);
    if (!yearGroup) {
      yearGroup = { key: `y-${y}`, label: `${y}年`, months: [] };
      yearMap.set(y, yearGroup);
      years.push(yearGroup);
    }

    const monthKey = `${y}-${m}`;
    let monthGroup = monthMap.get(monthKey);
    if (!monthGroup) {
      monthGroup = { key: `m-${monthKey}`, label: `${m + 1}月`, days: [] };
      monthMap.set(monthKey, monthGroup);
      yearGroup.months.push(monthGroup);
    }

    const dayKey = `${y}-${m}-${d}`;
    let dayGroup = dayMap.get(dayKey);
    if (!dayGroup) {
      dayGroup = {
        key: `d-${dayKey}`,
        label: `${m + 1}月${d}日 ${WEEKDAYS[date.getDay()]}`,
        photos: [],
      };
      dayMap.set(dayKey, dayGroup);
      monthGroup.days.push(dayGroup);
    }

    dayGroup.photos.push(photo);
  }

  return years;
}

function groupCount(months: MonthGroup[]): number {
  return months.reduce((sum, mg) => sum + mg.days.reduce((k, dg) => k + dg.photos.length, 0), 0);
}

/** 查看器顶部的照片日期：同年初省年份，如 "12月28日 星期六" */
function photoViewerDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const yearPart = d.getFullYear() !== now.getFullYear() ? `${d.getFullYear()}年` : '';
  return `${yearPart}${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`;
}

/** 相册 App：年/月/日分组图库 + 全屏照片查看器 */
export default function PhotosApp() {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [wallpaperOk, setWallpaperOk] = useState(false);

  // 多选模式
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 查看器视觉态：收藏心形（仅视觉）与"更多"菜单
  const [hearted, setHearted] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  /** 照片 id → ObjectURL（渲染用，随列表刷新整体更新） */
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  /** ObjectURL 回收登记（仅 effect/cleanup 读写，不参与渲染） */
  const urlsRef = useRef<Map<string, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastTapRef = useRef(0);
  const wallpaperTimerRef = useRef<number | null>(null);

  // 加载照片列表并同步管理 ObjectURL（await 之后再 setState）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all = await localDB.getAll('photos');
      if (cancelled) return;
      all.sort((a, b) => b.createdAt - a.createdAt);

      const prev = urlsRef.current;
      const next = new Map<string, string>();
      for (const p of all) {
        const reused = prev.get(p.id);
        next.set(p.id, reused ?? URL.createObjectURL(p.blob));
      }
      for (const [id, url] of prev) {
        if (!next.has(id)) URL.revokeObjectURL(url);
      }
      urlsRef.current = next;

      setUrls(next);
      setPhotos(all);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // 卸载时回收全部 ObjectURL 与定时器
  useEffect(() => {
    return () => {
      if (wallpaperTimerRef.current !== null) window.clearTimeout(wallpaperTimerRef.current);
      for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    };
  }, []);

  const yearGroups = useMemo(() => buildYearGroups(photos), [photos]);

  const viewerPhoto = viewerId ? (photos.find((p) => p.id === viewerId) ?? null) : null;
  const viewerIdx = viewerPhoto ? photos.findIndex((p) => p.id === viewerPhoto.id) : -1;

  // ---------------- 交互 ----------------

  const openViewer = (id: string) => {
    setViewerId(id);
    setZoomed(false);
    setHearted(false);
    setMoreOpen(false);
  };

  /** 查看器内左右切换（delta: +1 下一张 / -1 上一张，到头不动） */
  const stepViewer = (delta: number) => {
    if (viewerIdx < 0) return;
    const nextIdx = viewerIdx + delta;
    if (nextIdx < 0 || nextIdx >= photos.length) return;
    setViewerId(photos[nextIdx].id);
    setZoomed(false);
    setHearted(false);
    setMoreOpen(false);
  };

  const enterSelectMode = () => {
    setSelectedIds(new Set());
    setSelectMode(true);
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    for (const file of files) {
      await localDB.put('photos', { id: genId(), blob: file, name: file.name, createdAt: Date.now() });
    }
    setReloadKey((k) => k + 1);
  };

  /** 单张分享：优先系统分享面板，不支持时回退为下载 */
  const handleShare = async () => {
    const rec = viewerPhoto;
    if (!rec) return;
    const file = new File([rec.blob], rec.name || 'photo.jpg', { type: rec.blob.type || 'image/jpeg' });
    if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch {
        // 用户取消分享，忽略
      }
      return;
    }
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = rec.name || 'photo.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** 多选批量分享：系统面板一次带全部文件，不支持时逐张下载 */
  const handleBatchShare = async () => {
    const recs = photos.filter((p) => selectedIds.has(p.id));
    if (recs.length === 0) return;
    const files = recs.map((r) => new File([r.blob], r.name || 'photo.jpg', { type: r.blob.type || 'image/jpeg' }));
    if (typeof navigator.share === 'function' && navigator.canShare?.({ files })) {
      try {
        await navigator.share({ files });
      } catch {
        // 用户取消分享，忽略
      }
      return;
    }
    for (const f of files) {
      const url = URL.createObjectURL(f);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  const handleSetWallpaper = () => {
    const rec = viewerPhoto;
    if (!rec) return;
    useSettings.getState().setCustomWallpaper(rec.blob);
    setWallpaperOk(true);
    if (wallpaperTimerRef.current !== null) window.clearTimeout(wallpaperTimerRef.current);
    wallpaperTimerRef.current = window.setTimeout(() => setWallpaperOk(false), 1400);
  };

  const handleDelete = async () => {
    const rec = viewerPhoto;
    if (!rec) return;
    if (!window.confirm('确定删除这张照片？删除后无法恢复。')) return;
    const next = photos[viewerIdx + 1] ?? photos[viewerIdx - 1] ?? null;
    setViewerId(next ? next.id : null);
    await localDB.delete('photos', rec.id);
    setReloadKey((k) => k + 1);
  };

  /** 多选批量删除 */
  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`删除所选 ${ids.length} 张照片？删除后无法恢复。`)) return;
    setViewerId(null);
    setSelectMode(false);
    setSelectedIds(new Set());
    for (const id of ids) {
      try {
        await localDB.delete('photos', id);
      } catch {
        /* 忽略单条删除异常 */
      }
    }
    setReloadKey((k) => k + 1);
  };

  // 查看器手势：单击检测双击（放大/还原），横滑切换
  const handleStageTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const t = event.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleStageTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;

    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        setZoomed((z) => !z);
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
      return;
    }
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      stepViewer(dx < 0 ? 1 : -1);
    }
  };

  // ---------------- 渲染 ----------------

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div
        className={`flex h-full w-full flex-col overflow-y-auto overscroll-contain ${
          selectMode ? 'pb-[120px]' : ''
        }`}
      >
        {/* 大标题随内容滚动（static! 覆盖内置 sticky），分组头在状态栏下方吸顶 */}
        <IOSNavBar
          inline
          title="照片"
          className="static!"
          left={<BackToHome className="static!" />}
          right={
            selectMode ? (
              <IOSTextButton onClick={exitSelectMode}>完成</IOSTextButton>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="从本地上传照片"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-foreground transition-opacity active:opacity-50"
                >
                  <Plus className="h-6 w-6" strokeWidth={2.2} />
                </button>
                <IOSTextButton onClick={enterSelectMode} disabled={photos.length === 0}>
                  选择
                </IOSTextButton>
              </>
            )
          }
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => void handleUpload(e)}
        />

        {!loaded && (
          <div className="flex flex-1 items-center justify-center" aria-label="加载中">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground" />
          </div>
        )}

        {loaded && photos.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-10 pb-24 text-center">
            <ImageIcon className="h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-[17px] font-semibold">没有照片</p>
            <p className="text-[13px] text-muted-foreground">从本地上传或使用相机拍摄</p>
          </div>
        )}

        {yearGroups.map((yg) => (
          <section key={yg.key}>
            {/* 年份吸顶：20px 大字 + 数量副标题 */}
            <div className="sticky top-[54px] z-10 bg-background px-5 pb-1.5 pt-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[20px] font-bold leading-tight">{yg.label}</h2>
                <span className="text-[13px] tabular-nums text-muted-foreground">{groupCount(yg.months)}张</span>
              </div>
            </div>

            {yg.months.map((mg) => (
              <section key={mg.key}>
                {/* 月份吸顶（覆盖年份头，模拟 iOS 折叠效果） */}
                <div className="sticky top-[54px] z-20 bg-background px-5 pb-1.5 pt-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-[15px] font-semibold">{mg.label}</h3>
                    <span className="text-[12px] tabular-nums text-muted-foreground">
                      {mg.days.reduce((k, dg) => k + dg.photos.length, 0)}张
                    </span>
                  </div>
                </div>

                {mg.days.map((dg) => (
                  <div key={dg.key} className="pb-4">
                    <div className="px-5 pb-1.5 pt-1 text-[13px] text-muted-foreground">{dg.label}</div>
                    <div className="grid grid-cols-3 gap-[2px]">
                      {dg.photos.map((p) => {
                        const selected = selectedIds.has(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            aria-label={selectMode ? `${selected ? '取消选择' : '选择'}照片 ${p.name}` : `查看照片 ${p.name}`}
                            onClick={() => {
                              if (selectMode) toggleSelected(p.id);
                              else openViewer(p.id);
                            }}
                            className="relative block aspect-square w-full overflow-hidden bg-muted transition-opacity active:opacity-80"
                          >
                            <img
                              src={urls.get(p.id)}
                              alt={p.name}
                              loading="lazy"
                              draggable={false}
                              className="h-full w-full select-none object-cover"
                            />
                            {selectMode && (
                              <span
                                className={`absolute left-1 top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] backdrop-blur-sm transition-colors ${
                                  selected
                                    ? 'border-foreground bg-foreground'
                                    : 'border-white/90 bg-black/25'
                                }`}
                              >
                                {selected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3.5} />}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </section>
        ))}
      </div>

      {/* 状态栏底色遮罩：内容滚动时保持顶部 54px 干净 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[54px] bg-background" aria-hidden="true" />

      {/* 多选模式底部工具栏 */}
      {selectMode && (
        <div className="absolute inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/95 pb-[28px] backdrop-blur-xl">
          <div className="flex h-[60px] items-center justify-between px-8">
            <button
              type="button"
              aria-label="分享所选照片"
              disabled={selectedIds.size === 0}
              onClick={() => void handleBatchShare()}
              className="text-foreground transition-opacity active:opacity-50 disabled:opacity-30"
            >
              <Share2 className="h-[22px] w-[22px]" strokeWidth={1.9} />
            </button>
            <span className="text-[15px] tabular-nums text-muted-foreground">已选 {selectedIds.size} 项</span>
            <button
              type="button"
              aria-label="删除所选照片"
              disabled={selectedIds.size === 0}
              onClick={() => void handleBatchDelete()}
              className="text-[#FF453A] transition-opacity active:opacity-50 disabled:opacity-30"
            >
              <Trash2 className="h-[22px] w-[22px]" strokeWidth={1.9} />
            </button>
          </div>
        </div>
      )}

      {/* 全屏照片查看器（黑色背景，仅查看场景） */}
      {viewerPhoto && (
        <div className="absolute inset-0 z-40 flex flex-col bg-black" role="dialog" aria-label="照片查看器">
          {/* 图片舞台：滑动切换 / 双击缩放 */}
          <div
            className="absolute inset-0 touch-none select-none"
            onTouchStart={handleStageTouchStart}
            onTouchEnd={handleStageTouchEnd}
            onDoubleClick={() => setZoomed((z) => !z)}
          >
            <img
              key={viewerPhoto.id}
              src={urls.get(viewerPhoto.id)}
              alt={viewerPhoto.name}
              draggable={false}
              className={`h-full w-full object-contain transition-transform duration-300 ease-out ${
                zoomed ? 'scale-[2]' : 'scale-100'
              }`}
            />
          </div>

          {/* 顶部：返回 + 照片日期 */}
          <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 via-black/30 to-transparent pb-4">
            <div className="h-[54px]" />
            <div className="relative flex h-11 items-center px-2">
              <button
                type="button"
                aria-label="返回照片"
                onClick={() => setViewerId(null)}
                className="rounded-full p-1.5 text-white transition-opacity active:opacity-50"
              >
                <ChevronLeft className="h-7 w-7" strokeWidth={2.5} />
              </button>
              <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[15px] font-medium text-white">
                {photoViewerDate(viewerPhoto.createdAt)}
              </div>
              <div className="w-10" aria-hidden="true" />
            </div>
          </div>

          {/* 桌面端左右切换箭头 */}
          <button
            type="button"
            aria-label="上一张"
            disabled={viewerIdx <= 0}
            onClick={() => stepViewer(-1)}
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white backdrop-blur-sm transition-opacity active:opacity-50 disabled:opacity-20"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="下一张"
            disabled={viewerIdx >= photos.length - 1}
            onClick={() => stepViewer(1)}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white backdrop-blur-sm transition-opacity active:opacity-50 disabled:opacity-20"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {/* "更多"操作菜单（含设为壁纸） */}
          {moreOpen && (
            <>
              <div className="absolute inset-0 z-20" aria-hidden="true" onClick={() => setMoreOpen(false)} />
              <div className="absolute inset-x-0 bottom-[108px] z-30 flex justify-center px-10">
                <div className="w-full max-w-[260px] overflow-hidden rounded-[14px] border border-white/10 bg-[#2C2C2E]/95 shadow-2xl backdrop-blur-xl">
                  <button
                    type="button"
                    onClick={handleSetWallpaper}
                    className="flex h-12 w-full items-center gap-3 border-b border-white/10 px-4 text-[15px] text-white transition-colors active:bg-white/10"
                  >
                    <Wallpaper className="h-[18px] w-[18px] opacity-80" />
                    <span className="flex-1 text-left">设为壁纸</span>
                    {wallpaperOk && <Check className="h-4 w-4 text-[#30D158]" strokeWidth={3} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMoreOpen(false)}
                    className="flex h-12 w-full items-center justify-center text-[15px] text-white/90 transition-colors active:bg-white/10"
                  >
                    取消
                  </button>
                </div>
              </div>
            </>
          )}

          {/* 底部操作栏：分享/收藏/删除/更多 圆形按钮（避开 Home 热区） */}
          <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-6 pb-[44px]">
            <div className="flex items-center justify-around px-6">
              <button
                type="button"
                aria-label="分享照片"
                onClick={() => void handleShare()}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-opacity active:opacity-60"
              >
                <Share2 className="h-[21px] w-[21px]" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                aria-label={hearted ? '取消收藏' : '收藏照片'}
                onClick={() => setHearted((v) => !v)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-opacity active:opacity-60"
              >
                <Heart
                  className={`h-[21px] w-[21px] ${hearted ? 'fill-[#FF453A] text-[#FF453A]' : ''}`}
                  strokeWidth={1.9}
                />
              </button>
              <button
                type="button"
                aria-label="删除照片"
                onClick={() => void handleDelete()}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-opacity active:opacity-60"
              >
                <Trash2 className="h-[21px] w-[21px]" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                aria-label="更多操作"
                onClick={() => setMoreOpen((v) => !v)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-opacity active:opacity-60"
              >
                <MoreHorizontal className="h-[21px] w-[21px]" strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
