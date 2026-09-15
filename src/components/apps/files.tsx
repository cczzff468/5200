'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CalendarDays,
  ChevronRight,
  CircleCheck,
  FileText,
  HardDrive,
  Image as ImageIcon,
  Mic,
  Music2,
  Pause,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import {
  localDB,
  formatDuration,
  type PhotoRecord,
  type RecordingRecord,
  type MusicRecord,
  type NoteRecord,
  type CalendarEventRecord,
  type ReminderRecord,
} from '@/lib/ios/db';
import { IOSNavBar, IOSBackButton } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';

/**
 * 文件 App：
 * - 根级页：我的 iPhone / 存储空间卡（navigator.storage.estimate）/ 6 个资料库统计
 * - 二级页：各资料库条目列表（照片缩略图+大图预览、录音/音乐点按播放、备忘录只读全文、事件/提醒标题+日期）
 * - 数据只读统计 + 单条删除经 localDB.delete，不写其他任何 store
 */

type LibKey = 'photos' | 'recordings' | 'music' | 'notes' | 'events' | 'reminders';

const LIBS: { key: LibKey; name: string; icon: typeof ImageIcon; empty: string }[] = [
  { key: 'photos', name: '照片', icon: ImageIcon, empty: '没有照片' },
  { key: 'recordings', name: '录音', icon: Mic, empty: '没有录音' },
  { key: 'music', name: '音乐', icon: Music2, empty: '没有音乐' },
  { key: 'notes', name: '备忘录', icon: FileText, empty: '没有备忘录' },
  { key: 'events', name: '日历事件', icon: CalendarDays, empty: '没有事件' },
  { key: 'reminders', name: '提醒', icon: CircleCheck, empty: '没有提醒' },
];

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** 字节数 → "N KB" / "x.x MB" */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 字节数 → GB 保留两位 */
function formatGB(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatPct(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '0';
  if (p < 0.1) return '<0.1';
  return String(parseFloat(p.toFixed(1)));
}

function dateLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/** 备忘录阅读页顶部完整时间：2025年12月28日 下午3:45 */
function formatFull(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const ampm = h < 12 ? '上午' : '下午';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${ampm}${h12}:${pad2(d.getMinutes())}`;
}

function eventSub(e: CalendarEventRecord): string {
  const parts = e.date.split('-').map((v) => parseInt(v, 10));
  const base =
    parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? `${parts[1]}月${parts[2]}日` : e.date;
  if (!e.startTime) return `${base} 全天`;
  return `${base} ${e.startTime}${e.endTime ? `–${e.endTime}` : ''}`;
}

function reminderSub(r: ReminderRecord): string {
  if (r.dueDate) {
    const parts = r.dueDate.split('-').map((v) => parseInt(v, 10));
    const base =
      parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? `${parts[1]}月${parts[2]}日` : r.dueDate;
    return r.dueTime ? `${base} ${r.dueTime}` : base;
  }
  return dateLabel(r.createdAt);
}

/** 备忘录 content 现为 HTML：剥标签取纯文本（块级元素/br 转换行，DOMParser 不执行脚本不加载资源） */
function notePlainText(content: string): string {
  if (!content) return '';
  const withBreaks = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|blockquote)>/gi, '\n');
  if (typeof DOMParser === 'undefined') return withBreaks.replace(/<[^>]*>/g, '');
  return (new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent ?? '').replace(/\u00a0/g, ' ');
}

function notePreviewLine(content: string): string {
  return notePlainText(content).replace(/\s+/g, ' ').trim().slice(0, 40);
}

// 模块级单例 Audio（同一时刻至多一个资料库在播，切歌/卸载时回收 ObjectURL）
let libAudio: HTMLAudioElement | null = null;
let libAudioUrl: string | null = null;
let libAudioEnded: (() => void) | null = null;

function getLibAudio(): HTMLAudioElement {
  if (!libAudio) {
    libAudio = new Audio();
    libAudio.addEventListener('ended', () => {
      if (libAudioUrl) {
        URL.revokeObjectURL(libAudioUrl);
        libAudioUrl = null;
      }
      libAudioEnded?.();
    });
  }
  return libAudio;
}

function stopLibAudio(): void {
  if (libAudio) libAudio.pause();
  if (libAudioUrl) {
    URL.revokeObjectURL(libAudioUrl);
    libAudioUrl = null;
  }
}

function resetLibAudio(): void {
  stopLibAudio();
  libAudioEnded = null;
}

/** 播放一段音频：先停旧源再换新 ObjectURL，结束/失败时回调 onEnded */
function playLibAudio(blob: Blob, onEnded: () => void): void {
  stopLibAudio();
  const a = getLibAudio();
  const url = URL.createObjectURL(blob);
  libAudioUrl = url;
  libAudioEnded = onEnded;
  a.src = url;
  void a.play().catch(() => {
    /* 自动播放被拦截或解码失败：回收并回调 */
    if (libAudioUrl) {
      URL.revokeObjectURL(libAudioUrl);
      libAudioUrl = null;
    }
    onEnded();
  });
}

interface LibStats {
  photos: number;
  recordings: number;
  musicCount: number;
  musicBytes: number;
  notes: number;
  events: number;
  reminders: number;
}

async function computeStats(): Promise<LibStats> {
  const [photos, recordings, music, notes, events, reminders] = await Promise.all([
    localDB.count('photos'),
    localDB.count('recordings'),
    localDB.getAll('music'),
    localDB.count('notes'),
    localDB.count('events'),
    localDB.count('reminders'),
  ]);
  return {
    photos,
    recordings,
    musicCount: music.length,
    musicBytes: music.reduce((sum, m) => sum + (m.blob?.size ?? 0), 0),
    notes,
    events,
    reminders,
  };
}

function statText(key: LibKey, stats: LibStats | null): string {
  if (!stats) return '';
  switch (key) {
    case 'photos':
      return `${stats.photos} 项`;
    case 'recordings':
      return `${stats.recordings} 项`;
    case 'music':
      return `${stats.musicCount} 项 · ${formatBytes(stats.musicBytes)}`;
    case 'notes':
      return `${stats.notes} 项`;
    case 'events':
      return `${stats.events} 项`;
    case 'reminders':
      return `${stats.reminders} 项`;
  }
}

// ---------------- 通用条目行 ----------------

function ItemRow({
  title,
  sub,
  leading,
  stateIcon,
  onTap,
  onDelete,
  deleteLabel,
}: {
  title: string;
  sub: string;
  leading?: ReactNode;
  stateIcon?: ReactNode;
  onTap?: () => void;
  onDelete: () => void;
  deleteLabel: string;
}) {
  return (
    <div className="flex items-stretch">
      <button
        type="button"
        onClick={onTap}
        disabled={!onTap}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-2 text-left transition-colors active:bg-muted/50 disabled:active:bg-transparent"
      >
        {leading}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] leading-snug">{title}</span>
          {sub && (
            <span className="mt-0.5 block truncate text-[13px] leading-snug text-muted-foreground">{sub}</span>
          )}
        </span>
        {stateIcon}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={deleteLabel}
        className="flex w-11 shrink-0 items-center justify-center"
      >
        <Trash2 className="h-[18px] w-[18px] text-[#FF453A]/80" strokeWidth={1.9} />
      </button>
    </div>
  );
}

// ---------------- 二级资料库页 ----------------

function LibraryView({
  lib,
  name,
  onBack,
  onChanged,
}: {
  lib: LibKey;
  name: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [recordings, setRecordings] = useState<RecordingRecord[]>([]);
  const [music, setMusic] = useState<MusicRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const urlMapRef = useRef<Record<string, string>>({});

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const meta = LIBS.find((l) => l.key === lib) ?? LIBS[0];
  const count =
    lib === 'photos'
      ? photos.length
      : lib === 'recordings'
        ? recordings.length
        : lib === 'music'
          ? music.length
          : lib === 'notes'
            ? notes.length
            : lib === 'events'
              ? events.length
              : reminders.length;

  // 初次加载（await 之后再 setState），照片同时生成 ObjectURL
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        switch (lib) {
          case 'photos': {
            const list = await localDB.getAll('photos');
            list.sort((a, b) => b.createdAt - a.createdAt);
            const map: Record<string, string> = {};
            for (const p of list) map[p.id] = URL.createObjectURL(p.blob);
            urlMapRef.current = map;
            if (alive) {
              setPhotos(list);
              setPhotoUrls(map);
            }
            break;
          }
          case 'recordings': {
            const list = await localDB.getAll('recordings');
            list.sort((a, b) => b.createdAt - a.createdAt);
            if (alive) setRecordings(list);
            break;
          }
          case 'music': {
            const list = await localDB.getAll('music');
            list.sort((a, b) => b.createdAt - a.createdAt);
            if (alive) setMusic(list);
            break;
          }
          case 'notes': {
            const list = await localDB.getAll('notes');
            list.sort((a, b) => b.updatedAt - a.updatedAt);
            if (alive) setNotes(list);
            break;
          }
          case 'events': {
            const list = await localDB.getAll('events');
            list.sort((a, b) => {
              if (a.date !== b.date) return a.date < b.date ? -1 : 1;
              return a.startTime < b.startTime ? -1 : 1;
            });
            if (alive) setEvents(list);
            break;
          }
          case 'reminders': {
            const list = await localDB.getAll('reminders');
            list.sort((a, b) => {
              if (a.completed !== b.completed) return a.completed ? 1 : -1;
              return a.createdAt - b.createdAt;
            });
            if (alive) setReminders(list);
            break;
          }
        }
      } catch {
        /* IndexedDB 不可用时保持空列表 */
      }
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [lib]);

  // 卸载清理：回收全部照片 ObjectURL 并停止播放
  useEffect(() => {
    return () => {
      for (const url of Object.values(urlMapRef.current)) URL.revokeObjectURL(url);
      urlMapRef.current = {};
      resetLibAudio();
    };
  }, []);

  function stopPlayback() {
    stopLibAudio();
    setPlayingId(null);
  }

  /** 单例 Audio 点按播放/暂停（录音/音乐共用） */
  function togglePlay(blob: Blob, id: string) {
    if (playingId === id) {
      stopPlayback();
      return;
    }
    setPlayingId(id);
    playLibAudio(blob, () => setPlayingId(null));
  }

  function deleteById(id: string, label: string) {
    if (!window.confirm(`确定删除"${label}"吗？`)) return;
    if (lib === 'photos') {
      const url = urlMapRef.current[id];
      if (url) {
        URL.revokeObjectURL(url);
        delete urlMapRef.current[id];
        setPhotoUrls((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
      setPhotos((prev) => prev.filter((x) => x.id !== id));
      if (previewId === id) setPreviewId(null);
    } else if (lib === 'recordings') {
      if (playingId === id) stopPlayback();
      setRecordings((prev) => prev.filter((x) => x.id !== id));
    } else if (lib === 'music') {
      if (playingId === id) stopPlayback();
      setMusic((prev) => prev.filter((x) => x.id !== id));
    } else if (lib === 'notes') {
      setNotes((prev) => prev.filter((x) => x.id !== id));
      if (openNoteId === id) setOpenNoteId(null);
    } else if (lib === 'events') {
      setEvents((prev) => prev.filter((x) => x.id !== id));
    } else {
      setReminders((prev) => prev.filter((x) => x.id !== id));
    }
    void localDB.delete(lib, id).catch(() => undefined);
    onChanged();
  }

  const openNote = openNoteId ? (notes.find((n) => n.id === openNoteId) ?? null) : null;
  const previewUrl = previewId ? (photoUrls[previewId] ?? null) : null;
  const previewName = previewId ? (photos.find((p) => p.id === previewId)?.name ?? '照片') : '';

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="no-scrollbar flex-1 overflow-y-auto">
        <IOSNavBar title={name} large={false} left={<IOSBackButton label="文件" onClick={onBack} />} />

        <div className="px-4 pb-[40px] pt-1">
          {loaded && count === 0 ? (
            <div className="flex flex-col items-center gap-3 pt-24 text-muted-foreground">
              <meta.icon className="h-12 w-12 opacity-40" strokeWidth={1.1} />
              <div className="text-[17px] font-medium text-foreground/70">{meta.empty}</div>
            </div>
          ) : (
            <div className="divide-y divide-border/60 overflow-hidden rounded-[16px] bg-card">
              {lib === 'photos' &&
                photos.map((p) => (
                  <ItemRow
                    key={p.id}
                    title={p.name || '未命名照片'}
                    sub={`${dateLabel(p.createdAt)} · ${formatBytes(p.blob.size)}`}
                    leading={
                      photoUrls[p.id] ? (
                        <img
                          src={photoUrls[p.id]}
                          alt={p.name || '照片'}
                          className="h-11 w-11 shrink-0 rounded-[8px] object-cover"
                        />
                      ) : (
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-muted">
                          <ImageIcon className="h-5 w-5 text-muted-foreground" strokeWidth={1.8} />
                        </span>
                      )
                    }
                    onTap={() => setPreviewId(p.id)}
                    onDelete={() => deleteById(p.id, p.name || '未命名照片')}
                    deleteLabel="删除照片"
                  />
                ))}

              {lib === 'recordings' &&
                recordings.map((r) => (
                  <ItemRow
                    key={r.id}
                    title={r.name || '未命名录音'}
                    sub={`${dateLabel(r.createdAt)} · ${formatDuration(r.duration)}`}
                    stateIcon={
                      playingId === r.id ? (
                        <Pause className="h-5 w-5 shrink-0 text-foreground" strokeWidth={1.9} />
                      ) : (
                        <Play className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.9} />
                      )
                    }
                    onTap={() => togglePlay(r.blob, r.id)}
                    onDelete={() => deleteById(r.id, r.name || '未命名录音')}
                    deleteLabel="删除录音"
                  />
                ))}

              {lib === 'music' &&
                music.map((m) => (
                  <ItemRow
                    key={m.id}
                    title={m.title || m.name || '未命名音乐'}
                    sub={`${m.artist ? `${m.artist} · ` : ''}${dateLabel(m.createdAt)} · ${formatDuration(
                      m.duration
                    )} · ${formatBytes(m.blob.size)}`}
                    stateIcon={
                      playingId === m.id ? (
                        <Pause className="h-5 w-5 shrink-0 text-foreground" strokeWidth={1.9} />
                      ) : (
                        <Play className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.9} />
                      )
                    }
                    onTap={() => togglePlay(m.blob, m.id)}
                    onDelete={() => deleteById(m.id, m.title || m.name || '未命名音乐')}
                    deleteLabel="删除音乐"
                  />
                ))}

              {lib === 'notes' &&
                notes.map((n) => {
                  const preview = notePreviewLine(n.content);
                  return (
                    <ItemRow
                      key={n.id}
                      title={n.title || '新备忘录'}
                      sub={`${dateLabel(n.updatedAt)}${preview ? ` · ${preview}` : ''}`}
                      onTap={() => setOpenNoteId(n.id)}
                      onDelete={() => deleteById(n.id, n.title || '新备忘录')}
                      deleteLabel="删除备忘录"
                    />
                  );
                })}

              {lib === 'events' &&
                events.map((e) => (
                  <ItemRow
                    key={e.id}
                    title={e.title || '无标题事件'}
                    sub={eventSub(e)}
                    stateIcon={<CalendarDays className="h-5 w-5 shrink-0 text-muted-foreground/60" strokeWidth={1.8} />}
                    onDelete={() => deleteById(e.id, e.title || '无标题事件')}
                    deleteLabel="删除事件"
                  />
                ))}

              {lib === 'reminders' &&
                reminders.map((r) => (
                  <ItemRow
                    key={r.id}
                    title={r.title || '未命名提醒'}
                    sub={r.completed ? `已完成 · ${reminderSub(r)}` : reminderSub(r)}
                    stateIcon={
                      <CircleCheck
                        className={`h-5 w-5 shrink-0 ${r.completed ? 'text-muted-foreground' : 'text-muted-foreground/40'}`}
                        strokeWidth={1.8}
                      />
                    }
                    onDelete={() => deleteById(r.id, r.title || '未命名提醒')}
                    deleteLabel="删除提醒"
                  />
                ))}
            </div>
          )}
        </div>
      </div>

      {/* 照片大图预览层（点击任意处关闭） */}
      {previewUrl && (
        <div className="absolute inset-0 z-50 flex flex-col bg-black" onClick={() => setPreviewId(null)}>
          <div className="flex h-[54px] shrink-0 items-center justify-end px-4">
            <button aria-label="关闭预览" className="rounded-full p-1.5 transition-opacity active:opacity-60">
              <X className="h-6 w-6 text-white/90" strokeWidth={2} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 pb-10">
            <img src={previewUrl} alt={previewName} className="max-h-full max-w-full object-contain" />
          </div>
        </div>
      )}

      {/* 备忘录只读全文层 */}
      {openNote && (
        <div className="absolute inset-0 z-40 flex flex-col bg-background">
          <IOSNavBar
            title={openNote.title || '备忘录'}
            large={false}
            left={<IOSBackButton label="完成" onClick={() => setOpenNoteId(null)} />}
          />
          <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-10">
            <div className="pb-3 pt-1 text-center text-[12px] text-muted-foreground">
              {formatFull(openNote.updatedAt)}
            </div>
            <div className="whitespace-pre-wrap break-words text-[17px] leading-[1.6] text-foreground">
              {notePlainText(openNote.content) || '（空备忘录）'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 根级页 ----------------

export default function FilesApp() {
  const [view, setView] = useState<LibKey | 'root'>('root');
  const [stats, setStats] = useState<LibStats | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  const refreshStats = useCallback(() => {
    void (async () => {
      try {
        setStats(await computeStats());
      } catch {
        /* IndexedDB 不可用时保持空统计 */
      }
    })();
  }, []);

  // 挂载：统计 + 存储估算（setState 均在 await 之后的异步回调内）
  useEffect(() => {
    refreshStats();
    let alive = true;
    void (async () => {
      try {
        if (typeof navigator.storage?.estimate === 'function') {
          const est = await navigator.storage.estimate();
          if (alive) setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
        }
      } catch {
        /* 忽略存储估算失败 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshStats]);

  // 从二级页返回：刷新统计（可能存在删除）
  const handleBack = useCallback(() => {
    setView('root');
    refreshStats();
  }, [refreshStats]);

  if (view !== 'root') {
    const lib = LIBS.find((l) => l.key === view);
    return <LibraryView key={view} lib={view} name={lib?.name ?? ''} onBack={handleBack} onChanged={refreshStats} />;
  }

  const pct = storage && storage.quota > 0 ? (storage.usage / storage.quota) * 100 : 0;
  const barWidth = pct > 0 ? Math.min(100, Math.max(1.5, pct)) : 0;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="no-scrollbar flex-1 overflow-y-auto">
        <IOSNavBar inline title="文件" left={<BackToHome className="static!" />} />

        {/* 位置头：我的 iPhone（纯展示，无跳转故不加箭头） */}
        <div className="flex items-center gap-3 px-5 pb-2 pt-1">
          <HardDrive className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.8} />
          <span className="flex-1 text-[17px]">我的 iPhone</span>
        </div>

        {/* 存储空间卡 */}
        <div className="mx-4 mt-1 rounded-[16px] bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[16px] font-semibold">存储空间</span>
            <span className="text-[13px] text-muted-foreground">
              {storage ? `${formatBytes(storage.usage)} / ${formatGB(storage.quota)}` : '计算中…'}
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground transition-[width] duration-500"
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <div className="mt-2 text-[12px] text-muted-foreground">
            {storage ? `${formatPct(pct)}% 已使用` : ''}
          </div>
        </div>

        {/* 资料库列表卡 */}
        <div className="mx-4 mt-4 divide-y divide-border/60 overflow-hidden rounded-[16px] bg-card">
          {LIBS.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => setView(l.key)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted/50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-b from-[#C8C8CD] to-[#8E8E93] dark:from-[#5A5A5F] dark:to-[#3A3A3E]">
                <l.icon className="h-5 w-5 text-white" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[17px]">{l.name}</span>
              <span className="shrink-0 text-[15px] text-muted-foreground">{statText(l.key, stats)}</span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" strokeWidth={2} />
            </button>
          ))}
        </div>

        <div className="px-8 pb-[40px] pt-4 text-center text-[12px] leading-relaxed text-muted-foreground">
          文件应用展示所有本地数据，由各应用创建并存储于 IndexedDB。
        </div>
      </div>
    </div>
  );
}
