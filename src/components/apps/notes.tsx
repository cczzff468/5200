'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Bold,
  ChevronLeft,
  CircleCheck,
  Italic,
  List,
  ListOrdered,
  NotebookPen,
  Pin,
  Search,
  SquarePen,
  Underline,
} from 'lucide-react';
import { localDB, genId, type NoteRecord } from '@/lib/ios/db';
import { selectResolvedTheme, useSettings, useSystemDark } from '@/lib/ios/store';
import { BackToHome } from '@/components/ios/BackToHome';
import { useLongPress } from '@/hooks/use-long-press';
import { IOSActionSheet, type ActionSheetAction } from '@/components/ios/ActionSheet';

/**
 * 备忘录 App（金色/琥珀强调色版，对照用户截图）：
 * - 列表：大标题导航（左上返回主屏幕）、圆角搜索、金色分类筛选胶囊、
 *   「置顶」分组标头、独立白色圆角卡片（标题+金色图钉+时间 / 两行正文预览，长按卡片弹 iOS 动作表）、
 *   底部悬浮胶囊工具栏（金色 CircleCheck 清单 / SquarePen 新建）
 * - 编辑器：大号粗体标题输入、完整日期行、分类小胶囊、细分隔线、contentEditable 富文本正文、
 *   底部金色格式工具栏（待办/B/I/U/列表）、置顶开关、金色「完成」
 * - 数据持久化于 IndexedDB notes 表（content 为 HTML），600ms debounce 自动保存。
 */

/** 金色强调色：浅色深金/琥珀，深色微亮 */
const GOLD_LIGHT = '#A8720A';
const GOLD_DARK = '#C9971C';

type NoteCategory = NoteRecord['category'];
type FilterKey = 'all' | 'personal' | 'work' | 'pinned';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'personal', label: '个人' },
  { key: 'work', label: '工作' },
  { key: 'pinned', label: '置顶' },
];

const CATEGORY_OPTIONS: { key: Exclude<NoteCategory, undefined>; label: string }[] = [
  { key: '', label: '无' },
  { key: 'personal', label: '个人' },
  { key: 'work', label: '工作' },
];

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** HTML → 纯文本：块级元素/br 转换行（DOMParser 不触发脚本与资源加载，安全） */
function htmlToText(html: string): string {
  if (!html) return '';
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|blockquote)>/gi, '\n');
  if (typeof DOMParser === 'undefined') return withBreaks.replace(/<[^>]*>/g, '');
  return (new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent ?? '').replace(/\u00a0/g, ' ');
}

/** 列表显示标题：优先独立 title 字段，否则从正文首行推导 */
function displayTitle(n: NoteRecord): { title: string; derived: boolean } {
  const t = (n.title ?? '').trim();
  if (t) return { title: t, derived: false };
  const lines = htmlToText(n.content)
    .split('\n')
    .map((l) => l.trim());
  const first = lines.find((l) => l !== '') ?? '';
  return { title: first.replace(/^#+\s*/, '').slice(0, 50) || '新备忘录', derived: first !== '' };
}

/** 列表正文预览：标题为空时跳过被用作标题的首行 */
function displayPreview(n: NoteRecord): string {
  const lines = htmlToText(n.content)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (!(n.title ?? '').trim() && lines.length > 0) lines.shift();
  return lines.join(' ');
}

/** 列表第二行日期：今天 HH:mm / 昨天"昨天"/ 本周周X / 否则 M月d日 */
function noteDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();

  if (startOf(d) === startOf(now)) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 1) return '昨天';

  // 本周（周一为一周开始）
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  if (d.getTime() >= monday.getTime()) return `周${WEEKDAY_NAMES[d.getDay()]}`;

  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 编辑器顶部完整时间：2026年9月10日 20:23（24 小时制，对照截图） */
function formatFull(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 由旧记录派生更新记录：pinned/category 仅在真值时写入字段（否则从新记录中移除，
 * 避免写入 undefined 属性），并刷新 updatedAt。
 */
function withPatch(
  n: NoteRecord,
  patch: { pinned?: boolean; category?: Exclude<NoteCategory, undefined> }
): NoteRecord {
  const rec: NoteRecord = { ...n, updatedAt: Date.now() };
  if (patch.pinned === undefined ? n.pinned : patch.pinned) rec.pinned = true;
  else delete rec.pinned;
  const c = patch.category === undefined ? n.category : patch.category;
  if (c) rec.category = c;
  else delete rec.category;
  return rec;
}

/** 导出 TXT：标题 + 空行 + 纯文本正文（Blob 下载，1s 后释放 ObjectURL） */
function exportTxt(n: NoteRecord): void {
  const title = (n.title ?? '').trim();
  const text = `${title}\n\n${htmlToText(n.content)}`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title || '备忘录'}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 聚焦并把光标放到元素末尾（新建清单笔记聚焦正文） */
function focusEnd(el: HTMLElement): void {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ---------------- 编辑器 ----------------

function NoteEditor({
  note,
  gold,
  focusOn,
  onDone,
}: {
  note: NoteRecord;
  gold: string;
  focusOn: 'title' | 'body' | null;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(note.title ?? '');
  const [pinned, setPinned] = useState(note.pinned ?? false);
  const [category, setCategory] = useState<Exclude<NoteCategory, undefined>>(note.category ?? '');
  const [savedAt, setSavedAt] = useState(note.updatedAt);
  const [bodyEmpty, setBodyEmpty] = useState(() => htmlToText(note.content).trim() === '');

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef<NoteRecord | null>(null);
  const timerRef = useRef<number | null>(null);
  // 事件处理器里的最新值（避免闭包过期）
  const latestRef = useRef({
    title: note.title ?? '',
    pinned: note.pinned ?? false,
    category: (note.category ?? '') as Exclude<NoteCategory, undefined>,
  });

  // 挂载：注入初始 HTML（content 现为富文本）+ 按来源聚焦；卸载冲刷未落盘修改
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.innerHTML = note.content;
    if (focusOn === 'title') {
      titleRef.current?.focus();
    } else if (focusOn === 'body' && el) {
      focusEnd(el);
    }
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const rec = pendingRef.current;
      pendingRef.current = null;
      if (rec) void localDB.put('notes', rec).catch(() => undefined);
    };
  }, [note.content, focusOn]);

  function buildRec(override?: Partial<Pick<NoteRecord, 'title' | 'pinned' | 'category'>>): NoteRecord {
    const l = latestRef.current;
    const rec: NoteRecord = {
      id: note.id,
      title: (override?.title ?? l.title).trim(),
      content: bodyRef.current?.innerHTML ?? '',
      createdAt: note.createdAt,
      updatedAt: Date.now(),
    };
    const p = override?.pinned ?? l.pinned;
    const c = override?.category ?? l.category;
    if (p) rec.pinned = true;
    if (c) rec.category = c;
    return rec;
  }

  function scheduleSave(override?: Partial<Pick<NoteRecord, 'title' | 'pinned' | 'category'>>) {
    pendingRef.current = buildRec(override);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void flushSave();
    }, 600);
  }

  async function flushSave() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const rec = pendingRef.current;
    if (!rec) return;
    pendingRef.current = null;
    try {
      await localDB.put('notes', rec);
      setSavedAt(rec.updatedAt);
    } catch {
      /* 保存失败时静默，避免打断输入 */
    }
  }

  function handleTitle(v: string) {
    latestRef.current.title = v;
    setTitle(v);
    scheduleSave({ title: v });
  }

  function togglePinned() {
    const nv = !latestRef.current.pinned;
    latestRef.current.pinned = nv;
    setPinned(nv);
    scheduleSave({ pinned: nv });
  }

  function pickCategory(c: Exclude<NoteCategory, undefined>) {
    if (c === latestRef.current.category) return;
    latestRef.current.category = c;
    setCategory(c);
    scheduleSave({ category: c });
  }

  function handleBodyInput() {
    const el = bodyRef.current;
    if (!el) return;
    // 空正文归一化：浏览器可能残留 <br>/<div><br></div>，清掉以维持空态与 placeholder
    const html = el.innerHTML;
    if (html !== '' && htmlToText(html).trim() === '' && !/<(img|a)\b/i.test(html)) {
      el.innerHTML = '';
    }
    setBodyEmpty(el.innerHTML === '');
    scheduleSave();
  }

  /** 格式命令：先护住焦点再执行，随后同步空态并入队保存 */
  function exec(cmd: string, value?: string) {
    bodyRef.current?.focus();
    try {
      document.execCommand(cmd, false, value);
    } catch {
      /* 忽略不支持的命令 */
    }
    handleBodyInput();
  }

  function handleDone() {
    void (async () => {
      await flushSave();
      onDone();
    })();
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* 顶部导航：返回（黑白自适应）+ 置顶开关 + 金色「完成」灰胶囊 */}
      <div className="shrink-0 bg-background/80 pt-[54px] backdrop-blur-xl">
        <div className="flex h-11 items-center justify-between px-4">
          <button
            type="button"
            onClick={handleDone}
            aria-label="返回备忘录列表"
            className="-ml-1 flex items-center text-[17px] text-foreground transition-opacity active:opacity-50"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
            <span>备忘录</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePinned}
              aria-label={pinned ? '取消置顶' : '置顶'}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-opacity active:opacity-60"
            >
              <Pin
                className="h-[19px] w-[19px]"
                strokeWidth={1.9}
                style={pinned ? { color: gold, fill: 'currentColor' } : { color: 'var(--muted-foreground)' }}
              />
            </button>
            <button
              type="button"
              onClick={handleDone}
              className="rounded-full bg-muted px-4 py-1.5 text-[15px] font-medium transition-opacity active:opacity-60"
              style={{ color: gold }}
            >
              完成
            </button>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="no-scrollbar flex-1 overflow-y-auto">
        <div className="px-5 pb-[120px] pt-2">
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => handleTitle(e.target.value)}
            placeholder="标题"
            aria-label="备忘录标题"
            spellCheck={false}
            className="w-full border-none bg-transparent text-[24px] font-bold leading-snug text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <div className="mt-1 text-[12px] text-muted-foreground">{formatFull(savedAt)}</div>

          {/* 分类小胶囊（无/个人/工作，选中金色） */}
          <div className="mt-2 flex items-center gap-1.5">
            {CATEGORY_OPTIONS.map((c) => {
              const isActive = category === c.key;
              return (
                <button
                  key={c.key || 'none'}
                  type="button"
                  onClick={() => pickCategory(c.key)}
                  aria-pressed={isActive}
                  className={`rounded-full px-2.5 py-1 text-[11px] leading-none transition-colors ${
                    isActive ? 'font-medium text-white' : 'bg-muted text-muted-foreground'
                  }`}
                  style={isActive ? { backgroundColor: gold } : undefined}
                >
                  {c.label}
                </button>
              );
            })}
          </div>

          <div className="mb-3 mt-3 border-t border-border/60" />

          {/* 富文本正文 */}
          <div className="relative">
            {bodyEmpty && (
              <div className="pointer-events-none absolute inset-x-0 top-0 text-[17px] leading-[1.6] text-muted-foreground/50">
                输入正文…
              </div>
            )}
            <div
              ref={bodyRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="备忘录正文"
              spellCheck={false}
              onInput={handleBodyInput}
              className="min-h-[240px] break-words text-[17px] leading-[1.6] text-foreground outline-none"
            />
          </div>
        </div>
      </div>

      {/* 底部悬浮格式工具栏（金色） */}
      <div className="absolute inset-x-4 bottom-[calc(28px+env(safe-area-inset-bottom))] z-30">
        <div className="flex h-14 items-center justify-between rounded-full border border-border/50 bg-card/95 px-5 shadow-lg backdrop-blur">
          <FmtButton gold={gold} label="插入待办项" onClick={() => exec('insertHTML', '☐ ')}>
            <CircleCheck className="h-[22px] w-[22px]" strokeWidth={1.9} />
          </FmtButton>
          <span className="h-6 w-px bg-border" />
          <FmtButton gold={gold} label="粗体" onClick={() => exec('bold')}>
            <Bold className="h-5 w-5" strokeWidth={2} />
          </FmtButton>
          <FmtButton gold={gold} label="斜体" onClick={() => exec('italic')}>
            <Italic className="h-5 w-5" strokeWidth={2} />
          </FmtButton>
          <FmtButton gold={gold} label="下划线" onClick={() => exec('underline')}>
            <Underline className="h-5 w-5" strokeWidth={2} />
          </FmtButton>
          <span className="h-6 w-px bg-border" />
          <FmtButton gold={gold} label="项目符号列表" onClick={() => exec('insertUnorderedList')}>
            <List className="h-5 w-5" strokeWidth={2} />
          </FmtButton>
          <FmtButton gold={gold} label="编号列表" onClick={() => exec('insertOrderedList')}>
            <ListOrdered className="h-5 w-5" strokeWidth={2} />
          </FmtButton>
        </div>
      </div>
    </div>
  );
}

/** 格式工具栏按钮：onMouseDown 阻止默认，避免编辑器失焦 */
function FmtButton({
  gold,
  label,
  onClick,
  children,
}: {
  gold: string;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-opacity active:opacity-50"
      style={{ color: gold }}
    >
      {children}
    </button>
  );
}

/**
 * 列表卡片：白圆角卡（标题+金色图钉+时间 / 两行预览）。
 * 点击打开编辑器；长按弹出 iOS 动作表（每张卡片独立持有 useLongPress，回调可感知具体卡片）。
 */
function NoteCard({
  note,
  gold,
  onOpen,
  onLongPress,
}: {
  note: NoteRecord;
  gold: string;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const lp = useLongPress(onLongPress);
  const { title } = displayTitle(note);
  const preview = displayPreview(note);
  return (
    <div className="flex select-none items-center rounded-[16px] bg-card p-4">
      <button
        type="button"
        {...lp}
        onClick={onOpen}
        className="min-w-0 flex-1 select-none text-left transition-opacity active:opacity-70"
      >
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[16px] font-semibold leading-snug">{title}</span>
          {note.pinned && (
            <Pin
              className="h-3.5 w-3.5 shrink-0"
              strokeWidth={2}
              style={{ color: gold, fill: 'currentColor' }}
              aria-label="已置顶"
            />
          )}
          <span className="shrink-0 text-[13px] leading-snug text-muted-foreground">{noteDate(note.updatedAt)}</span>
        </div>
        {preview && (
          <div className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">{preview}</div>
        )}
      </button>
    </div>
  );
}

// ---------------- 列表页 ----------------

export default function NotesApp() {
  // 跟随应用内已解析主题（而非系统）选择金色深浅：浅色深金/琥珀，深色微亮
  const theme = useSettings((s) => s.theme);
  const dark = selectResolvedTheme(theme, useSystemDark()) === 'dark';
  const gold = dark ? GOLD_DARK : GOLD_LIGHT;

  const [loaded, setLoaded] = useState(false);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  // 长按卡片弹出的动作表目标笔记（null=关闭）
  const [sheetNote, setSheetNote] = useState<NoteRecord | null>(null);

  // 编辑器态
  const [active, setActive] = useState<NoteRecord | null>(null);
  const [focusOn, setFocusOn] = useState<'title' | 'body' | null>(null);

  // 初次加载（await 之后再 setState）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const all = await localDB.getAll('notes');
        all.sort((a, b) => b.updatedAt - a.updatedAt);
        if (alive) setNotes(all);
      } catch {
        /* IndexedDB 不可用时保持空列表 */
      }
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function reloadNotes() {
    try {
      const all = await localDB.getAll('notes');
      all.sort((a, b) => b.updatedAt - a.updatedAt);
      setNotes(all);
    } catch {
      /* 保持原列表 */
    }
  }

  function openNote(n: NoteRecord) {
    setActive(n);
    setFocusOn(null);
    setView('editor');
  }

  function createNote(withChecklist: boolean) {
    const now = Date.now();
    const rec: NoteRecord = {
      id: genId(),
      title: '',
      content: withChecklist ? '☐ ' : '',
      createdAt: now,
      updatedAt: now,
    };
    setActive(rec);
    setFocusOn(withChecklist ? 'body' : 'title');
    setView('editor');
    void localDB.put('notes', rec).catch(() => undefined);
  }

  /** 回到列表（编辑器已先冲刷保存），重新加载 */
  function backToList() {
    setView('list');
    setActive(null);
    void reloadNotes();
  }

  /** 写入更新后的记录并刷新列表 */
  function putNote(rec: NoteRecord) {
    void (async () => {
      try {
        await localDB.put('notes', rec);
        await reloadNotes();
      } catch {
        /* 忽略写入异常，保持原列表 */
      }
    })();
  }

  /** 置顶 / 取消置顶（pinned 仅在 true 时写入字段） */
  function togglePin(n: NoteRecord) {
    putNote(withPatch(n, { pinned: !n.pinned }));
  }

  /** 移动分类（动作表提供「个人/工作」两项） */
  function moveCategory(n: NoteRecord, c: Exclude<NoteCategory, undefined>) {
    putNote(withPatch(n, { category: c }));
  }

  /** 删除笔记：动作表本身即确认，直接删除（不再 window.confirm） */
  function deleteNote(n: NoteRecord) {
    void (async () => {
      try {
        await localDB.delete('notes', n.id);
      } catch {
        /* 忽略删除异常 */
      }
      setNotes((prev) => prev.filter((x) => x.id !== n.id));
    })();
  }

  const filtered = useMemo(() => {
    let list = notes;
    if (filter === 'personal') list = list.filter((n) => n.category === 'personal');
    else if (filter === 'work') list = list.filter((n) => n.category === 'work');
    else if (filter === 'pinned') list = list.filter((n) => n.pinned === true);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (n) =>
        displayTitle(n).title.toLowerCase().includes(q) || htmlToText(n.content).toLowerCase().includes(q)
    );
  }, [notes, query, filter]);

  if (view === 'editor' && active) {
    return <NoteEditor note={active} gold={gold} focusOn={focusOn} onDone={backToList} />;
  }

  // 置顶分组：仅「全部」筛选下展示「置顶」标头，其余为无标头卡片流
  const pinnedList = filter === 'all' ? filtered.filter((n) => n.pinned) : [];
  const normalList = filter === 'all' ? filtered.filter((n) => !n.pinned) : filtered;

  const renderCards = (list: NoteRecord[]) =>
    list.map((n) => (
      <NoteCard key={n.id} note={n} gold={gold} onOpen={() => openNote(n)} onLongPress={() => setSheetNote(n)} />
    ));

  /** 动作表动作项：置顶/取消置顶、移动分类（按当前分类过滤）、导出 TXT、删除（红色） */
  function sheetActionsFor(n: NoteRecord): ActionSheetAction[] {
    return [
      { label: n.pinned ? '取消置顶' : '置顶', onSelect: () => togglePin(n) },
      ...(n.category !== 'personal'
        ? [{ label: '移动到「个人」', onSelect: () => moveCategory(n, 'personal') }]
        : []),
      ...(n.category !== 'work' ? [{ label: '移动到「工作」', onSelect: () => moveCategory(n, 'work') }] : []),
      { label: '导出 TXT', onSelect: () => exportTxt(n) },
      { label: '删除', destructive: true, onSelect: () => deleteNote(n) },
    ];
  }

  // sheetNote 为 null 时返回 []（动作表关闭）
  const sheetActions: ActionSheetAction[] = sheetNote ? sheetActionsFor(sheetNote) : [];

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="no-scrollbar flex-1 overflow-y-auto">
        {/* 顶部导航：左=返回主屏幕，中=黑色大标题（右槽位留白保持居中） */}
        <div className="sticky top-0 z-20 bg-background/80 px-4 pt-[54px] backdrop-blur-xl">
          <div className="flex h-12 items-center justify-between">
            <div className="flex min-w-[64px]">
              <BackToHome className="static!" />
            </div>
            <div className="text-[30px] font-bold tracking-tight">备忘录</div>
            <div className="min-w-[64px]" />
          </div>
        </div>

        <div className="px-4 pb-[116px]">
          {/* 圆角搜索框 */}
          <div className="mt-1 flex h-9 items-center gap-1.5 rounded-full bg-muted px-3.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2.2} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索备忘录"
              aria-label="搜索备忘录"
              className="h-full w-full bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* 分类筛选胶囊：选中金底白字，未选中浅灰 */}
          <div className="no-scrollbar mt-2.5 flex items-center gap-2 overflow-x-auto pb-1">
            {FILTERS.map((f) => {
              const isActive = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  aria-pressed={isActive}
                  className={`shrink-0 rounded-full px-3.5 py-[7px] text-[13px] leading-none transition-colors ${
                    isActive ? 'font-medium text-white' : 'bg-muted text-foreground'
                  }`}
                  style={isActive ? { backgroundColor: gold } : undefined}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {loaded && filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 pt-20 text-muted-foreground">
              <NotebookPen className="h-12 w-12 opacity-40" strokeWidth={1.1} />
              <div className="text-[17px] font-medium text-foreground/70">
                {notes.length === 0 ? '没有备忘录' : '没有找到备忘录'}
              </div>
            </div>
          ) : (
            <>
              {pinnedList.length > 0 && (
                <>
                  <div className="mb-2 mt-4 px-1 text-[13px] text-muted-foreground">置顶</div>
                  <div className="flex flex-col gap-2.5">{renderCards(pinnedList)}</div>
                </>
              )}
              {normalList.length > 0 && (
                <div className={`flex flex-col gap-2.5 ${pinnedList.length > 0 ? 'mt-4' : 'mt-3'}`}>
                  {renderCards(normalList)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 底部悬浮胶囊工具栏：金色清单/新建 */}
      <div className="absolute inset-x-4 bottom-[calc(28px+env(safe-area-inset-bottom))] z-30">
        <div className="flex h-14 items-center justify-between rounded-full border border-border/50 bg-card/95 px-7 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => createNote(true)}
            aria-label="新建清单备忘录"
            className="flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-90"
            style={{ color: gold }}
          >
            <CircleCheck className="h-6 w-6" strokeWidth={1.9} />
          </button>
          <span className="h-6 w-px bg-border" />
          <button
            type="button"
            onClick={() => createNote(false)}
            aria-label="新建备忘录"
            className="flex h-10 w-10 items-center justify-center rounded-full transition-transform active:scale-90"
            style={{ color: gold }}
          >
            <SquarePen className="h-6 w-6" strokeWidth={1.9} />
          </button>
        </div>
      </div>

      {/* 长按卡片弹出的 iOS 底部动作表（大写别名引入：JSX 小写开头标签会被当作原生元素；渲染在 App 根 relative 容器内） */}
      <IOSActionSheet open={sheetNote !== null} actions={sheetActions} onCancel={() => setSheetNote(null)} />
    </div>
  );
}
