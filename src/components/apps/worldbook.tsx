'use client';

/**
 * 世界书 App —— 给 AI 挂载静态设定和世界观（按关键词触发的设定库）。
 *
 * 页面结构（iOS 黑白灰风格：白 / 浅灰 / 深灰，深色模式自动适配）：
 * - 书库首页：大标题 + 统计卡（全局/局部/专属 三列可点按范围筛选 + 已启用计数）+ 底部范围
 *   筛选栏；右上角角色筛选（查看与某角色聊天时会生效的书：全局 + 已挂载局部 + 专属该角色）；
 *   书籍管理：新建（名字校验：非空 + 禁 emoji）、重命名、删除、导出、导入（.json）
 * - 书籍详情页：条目卡片列表，每条带启用开关（iOS 风格单色 Switch）、触发词预览、
 *   插入位置/生效范围徽章；点卡片进入编辑，长按条目或点右侧 ⋯ 弹出操作菜单（编辑/删除）
 * - 条目编辑页：开关 / 名字（仅本地显示）/ 触发词 / 内容 / 插入位置（6 选 1）/
 *   生效范围（全局·局部·专属，专属需指定联系人）/ 优先级（同位置多条命中时数字大的排前）/
 *   忽略大小写；右上角「保存」才写入，返回不保存，新建条目保存前不落盘
 *
 * 数据与触发逻辑在 @/lib/ios/worldbook（kv 存储 + 注入引擎）；聊天侧挂载入口在
 * 微信/QQ/信息的聊天设置 →「世界书」。
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  BookMarked,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ContactRecord } from '@/lib/contacts';
import { listContacts } from '@/lib/ios/contacts-store';
import { BackToHome } from '@/components/ios/BackToHome';
import { useLocalToast, LocalToast } from './page-toast';
import {
  WB_POSITIONS,
  WB_POSITION_LABELS,
  WB_SCOPES,
  WB_SCOPE_LABELS,
  buildExportPayload,
  createEntryDraft,
  getBoundBookIds,
  loadBooks,
  newWbId,
  parseKeywordsInput,
  parseWorldBookImport,
  pruneBookFromAllBindings,
  saveBooks,
  wbEntryCheck,
  wbNameCheck,
  type WorldBook,
  type WbEntry,
  type WbPosition,
  type WbScope,
} from '@/lib/ios/worldbook';

// ---------------- 主题 token（黑白灰，深色自动适配） ----------------

const PAGE_CLS = 'bg-[#F2F2F7] text-black dark:bg-black dark:text-white';
const CARD_CLS = 'overflow-hidden rounded-[14px] bg-white dark:bg-[#1C1C1E]';
const DIVIDER_CLS = 'border-black/[0.06] dark:border-white/[0.08]';
const SUB_CLS = 'text-black/45 dark:text-white/45';
const CAPTION_CLS = `px-1 pt-2 text-[12.5px] leading-[1.6] ${SUB_CLS}`;
const DESTRUCTIVE_CLS = 'text-[#FF3B30] dark:text-[#FF453A]';

/** 单色 iOS 开关：开 = 黑底白钮（深色模式白底黑钮），贴合黑白灰主色调 */
function MonoToggle({ on, onChange, label, testId }: { on: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 ${
        on ? 'bg-black dark:bg-white' : 'bg-black/[0.14] dark:bg-white/[0.24]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[26px] w-[26px] rounded-full shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-all duration-200 ${
          on ? 'left-[22px] bg-white dark:bg-black' : 'left-[2px] bg-white dark:bg-[#E9E9EB]'
        }`}
      />
    </button>
  );
}

// ---------------- 通用浮层 ----------------

interface SheetAction {
  /** 稳定唯一 key：label 可能重复（如两个同名 AI 角色），提供 id 时优先用 id 作 key */
  id?: string;
  label: string;
  destructive?: boolean;
  onSelect: () => void;
}

/** iOS 风格底部操作菜单 */
function ActionSheet({ title, actions, onClose }: { title: string; actions: SheetAction[]; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-[70]" role="dialog" aria-label={title}>
      <button type="button" aria-label="关闭菜单" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-x-3 bottom-4 flex flex-col gap-2">
        <div className={`${CARD_CLS} p-1.5`}>
          <p className={`px-3 py-2 text-center text-[12.5px] leading-[1.4] ${SUB_CLS}`}>{title}</p>
          {actions.map((a, ai) => (
            <button
              key={a.id ?? `${a.label}-${ai}`}
              type="button"
              onClick={() => {
                onClose();
                a.onSelect();
              }}
              className={`flex w-full items-center justify-center rounded-[10px] px-4 py-3 text-[16px] active:bg-black/[0.05] dark:active:bg-white/[0.08] ${
                a.destructive ? DESTRUCTIVE_CLS : ''
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`${CARD_CLS} flex items-center justify-center py-3 text-[16px] font-semibold active:bg-black/[0.05] dark:active:bg-white/[0.08]`}
        >
          取消
        </button>
      </div>
    </div>
  );
}

/** 名字输入弹层（新建/重命名世界书；emoji 校验在确认时进行，错误就地显示） */
function NameDialog({
  title,
  initial,
  confirmText,
  onConfirm,
  onClose,
}: {
  title: string;
  initial: string;
  confirmText: string;
  onConfirm: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  return (
    <div className="absolute inset-0 z-[70] grid place-items-center px-8" role="dialog" aria-label={title}>
      <button type="button" aria-label="取消" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className={`${CARD_CLS} relative w-full p-4`}>
        <p className="text-center text-[16px] font-semibold">{title}</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const check = wbNameCheck(value);
              if (!check.ok) setError(check.reason);
              else onConfirm(value);
            }
          }}
          placeholder="世界书名字"
          aria-label="世界书名字"
          maxLength={40}
          className="mt-3 h-10 w-full rounded-[10px] border border-black/10 bg-black/[0.03] px-3 text-[15px] outline-none focus:border-black/25 dark:border-white/15 dark:bg-white/[0.06] dark:focus:border-white/35"
        />
        {error && <p className={`mt-2 text-[12.5px] ${DESTRUCTIVE_CLS}`}>{error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-[10px] bg-black/[0.05] text-[15px] active:bg-black/[0.1] dark:bg-white/[0.08] dark:active:bg-white/[0.14]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              const check = wbNameCheck(value);
              if (!check.ok) {
                setError(check.reason);
                return;
              }
              onConfirm(value);
            }}
            className="h-10 flex-1 rounded-[10px] bg-black text-[15px] font-medium text-white active:opacity-80 dark:bg-white dark:text-black"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 通用确认弹层（删除等破坏性操作） */
function ConfirmDialog({
  title,
  message,
  confirmText,
  destructive,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmText: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[70] grid place-items-center px-8" role="dialog" aria-label={title}>
      <button type="button" aria-label="取消" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className={`${CARD_CLS} relative w-full p-4`}>
        <p className="text-center text-[16px] font-semibold">{title}</p>
        <p className={`mt-2 text-center text-[13.5px] leading-[1.55] ${SUB_CLS}`}>{message}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-[10px] bg-black/[0.05] text-[15px] active:bg-black/[0.1] dark:bg-white/[0.08] dark:active:bg-white/[0.14]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onConfirm();
            }}
            className={`h-10 flex-1 rounded-[10px] text-[15px] font-medium text-white active:opacity-80 ${
              destructive ? 'bg-[#FF3B30] dark:bg-[#FF453A]' : 'bg-black dark:bg-white dark:text-black'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 小工具 ----------------

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function kindLabel(kind: string | null | undefined): string {
  if (kind === 'user') return '用户自设';
  if (kind === 'npc') return '配角';
  return 'AI 角色';
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/** 书籍主范围归类：专属 > 局部 > 全局（混合范围的书按最具体范围归类，保证统计不重不漏） */
function primaryScopeOf(book: WorldBook): WbScope {
  if (book.entries.some((e) => e.scope === 'exclusive')) return 'exclusive';
  if (book.entries.some((e) => e.scope === 'local')) return 'local';
  return 'global';
}

/** 专属条目目标角色名字列表（去重，用于书籍徽章展示） */
function exclusiveNamesOf(book: WorldBook, contacts: ContactRecord[]): string[] {
  const ids = [
    ...new Set(book.entries.filter((e) => e.scope === 'exclusive' && e.targetContactId).map((e) => e.targetContactId as string)),
  ];
  return ids.map((id) => contacts.find((c) => c.id === id)?.name ?? '已删除角色');
}

type ScopeFilter = 'all' | WbScope;

interface WbStats {
  global: number;
  local: number;
  exclusive: number;
  enabled: number;
}

/** 长按手势（指针事件实现；移动超过阈值视为滚动，取消触发） */
function useLongPress(onLongPress: () => void, ms = 480) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      fired.current = false;
      startPoint.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, ms);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
      const s = startPoint.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    didFire: () => fired.current,
  };
}

// ---------------- 页面组件 ----------------

type Nav =
  | { name: 'list' }
  | { name: 'book'; bookId: string }
  | { name: 'entry'; bookId: string; entryId: string; isNew?: boolean };

/** 世界书 App 主组件 */
export default function WorldBookApp() {
  const [books, setBooks] = useState<WorldBook[]>([]);
  const [nav, setNav] = useState<Nav>({ name: 'list' });
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [nameDialog, setNameDialog] = useState<{ mode: 'create' } | { mode: 'rename'; bookId: string } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; confirmText: string; destructive?: boolean; action: () => void } | null>(null);
  const [sheetBookId, setSheetBookId] = useState<string | null>(null);
  const [toast, showToast] = useLocalToast();
  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<WbEntry | null>(null); // 新建条目的未保存草稿（保存才落盘，返回即放弃）
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [charFilterId, setCharFilterId] = useState<string | null>(null);
  const [charSheet, setCharSheet] = useState(false);
  const [sheetEntryId, setSheetEntryId] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Record<string, string[]>>({});
  const editorSaveRef = useRef<(() => void) | null>(null);

  // 开机门控保证 kv 已注水：挂载时同步读一次即可（书籍只在本 App 内修改）
  useEffect(() => {
    setBooks(loadBooks());
    void listContacts()
      .then(setContacts)
      .catch(() => undefined);
  }, []);

  // 角色筛选需要挂载关系：联系人与书籍变化时同步读一次 kv（内存读，开销可忽略）
  useEffect(() => {
    const map: Record<string, string[]> = {};
    for (const c of contacts) map[c.id] = getBoundBookIds(c.id);
    setBindings(map);
  }, [contacts, books]);

  /** 角色可选名单：只列 AI 角色/配角——user 是用户自己，不参与角色筛选与专属指定 */
  const aiContacts = useMemo(() => contacts.filter((c) => c.kind !== 'user'), [contacts]);

  const persist = (next: WorldBook[]) => {
    setBooks(next);
    saveBooks(next);
  };

  const bookNameOf = (id: string) => contacts.find((c) => c.id === id)?.name ?? '';
  const contactNameOf = (id: string | null | undefined) => (id ? bookNameOf(id) : '');

  const stats: WbStats = {
    global: books.filter((b) => primaryScopeOf(b) === 'global').length,
    local: books.filter((b) => primaryScopeOf(b) === 'local').length,
    exclusive: books.filter((b) => primaryScopeOf(b) === 'exclusive').length,
    enabled: books.filter((b) => b.entries.some((e) => e.enabled)).length,
  };

  const activeCharFilter =
    charFilterId && contacts.some((c) => c.id === charFilterId && c.kind !== 'user') ? charFilterId : null;
  const charFilterName = activeCharFilter ? contacts.find((c) => c.id === activeCharFilter)?.name ?? '' : '';

  // 角色筛选语义：与该角色聊天时会生效的书（启用中的 global + 已挂载到该角色的 local + 专属该角色）
  const filteredBooks = books.filter((b) => {
    if (scopeFilter !== 'all' && primaryScopeOf(b) !== scopeFilter) return false;
    if (activeCharFilter) {
      const bound = bindings[activeCharFilter] ?? [];
      const effective = b.entries.some((e) => {
        if (!e.enabled) return false;
        if (e.scope === 'global') return true;
        if (e.scope === 'local') return bound.includes(b.id);
        return e.targetContactId === activeCharFilter;
      });
      if (!effective) return false;
    }
    return true;
  });

  const lastUpdateText = books.length === 0 ? '—' : fmtTime(Math.max(...books.map((b) => b.updatedAt)));

  const createBook = (name: string) => {
    const trimmed = name.trim();
    const now = Date.now();
    const book: WorldBook = { id: newWbId('wb'), name: trimmed, entries: [], createdAt: now, updatedAt: now };
    setNameDialog(null);
    persist([...books, book]);
    showToast(`已创建「${trimmed}」`);
    setNav({ name: 'book', bookId: book.id });
  };

  const renameBook = (bookId: string, name: string) => {
    const trimmed = name.trim();
    setNameDialog(null);
    persist(books.map((b) => (b.id === bookId ? { ...b, name: trimmed, updatedAt: Date.now() } : b)));
    showToast('已重命名');
  };

  const deleteBook = (bookId: string) => {
    const target = books.find((b) => b.id === bookId);
    persist(books.filter((b) => b.id !== bookId));
    void pruneBookFromAllBindings(bookId);
    showToast(`已删除「${target?.name ?? ''}」`);
    if (nav.name !== 'list' && 'bookId' in nav && nav.bookId === bookId) setNav({ name: 'list' });
  };

  const exportBook = (bookId: string) => {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;
    const payload = buildExportPayload([book], (id) => contactNameOf(id));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFileName(book.name)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast('已导出 .json 文件');
  };

  const importFile = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const imported = parseWorldBookImport(parsed, (name) => contacts.find((c) => c.name === name)?.id ?? null);
      persist([...books, ...imported]);
      showToast(imported.length === 1 ? `已导入「${imported[0].name}」` : `已导入 ${imported.length} 本世界书`);
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : '导入失败：文件不是合法的 JSON');
    } finally {
      setImporting(false);
    }
  };

  const sheetBook = sheetBookId ? books.find((b) => b.id === sheetBookId) : null;
  const sheetEntryBook = nav.name === 'book' ? books.find((b) => b.id === nav.bookId) : null;
  const sheetEntry = sheetEntryBook && sheetEntryId ? sheetEntryBook.entries.find((e) => e.id === sheetEntryId) ?? null : null;

  return (
    <div className={`absolute inset-0 flex h-full w-full flex-col ${PAGE_CLS}`}>
      {/* 顶栏 */}
      <div className="shrink-0 pt-[54px]">
        <div className="relative flex h-11 items-center px-2">
          {nav.name !== 'list' ? (
            <button
              type="button"
              aria-label="返回"
              data-testid="wb-back"
              onClick={() => {
                if (nav.name === 'entry') {
                  if (nav.isNew) setPendingDraft(null); // 新建未保存：返回即放弃草稿
                  setNav({ name: 'book', bookId: nav.bookId });
                } else {
                  setNav({ name: 'list' });
                }
              }}
              className="flex items-center rounded-full px-1 active:opacity-50"
            >
              <ChevronLeft className="h-7 w-7" strokeWidth={2.2} />
            </button>
          ) : (
            <BackToHome className="static!" />
          )}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-semibold">
            {nav.name === 'book'
              ? books.find((b) => b.id === nav.bookId)?.name ?? ''
              : nav.name === 'entry'
                ? nav.isNew
                  ? '新建条目'
                  : '编辑条目'
                : ''}
          </div>
          <div className="ml-auto flex items-center gap-1 pr-1">
            {nav.name === 'list' && (
              <>
                <button
                  type="button"
                  aria-label="导入世界书"
                  data-testid="wb-import"
                  onClick={() => importRef.current?.click()}
                  disabled={importing}
                  className="grid h-9 w-9 place-items-center rounded-full active:bg-black/[0.06] dark:active:bg-white/[0.1] disabled:opacity-50"
                >
                  <Upload className="h-[21px] w-[21px]" strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="新建世界书"
                  data-testid="wb-create"
                  onClick={() => setNameDialog({ mode: 'create' })}
                  className="grid h-9 w-9 place-items-center rounded-full active:bg-black/[0.06] dark:active:bg-white/[0.1]"
                >
                  <Plus className="h-[23px] w-[23px]" strokeWidth={2.2} aria-hidden="true" />
                </button>
              </>
            )}
            {nav.name === 'book' && (
              <>
                <button
                  type="button"
                  aria-label="新建条目"
                  data-testid="wb-add-entry"
                  onClick={() => {
                    const draft = createEntryDraft();
                    setPendingDraft(draft); // 草稿不落盘，点右上角「保存」才创建
                    setNav({ name: 'entry', bookId: nav.bookId, entryId: draft.id, isNew: true });
                  }}
                  className="grid h-9 w-9 place-items-center rounded-full active:bg-black/[0.06] dark:active:bg-white/[0.1]"
                >
                  <Plus className="h-[23px] w-[23px]" strokeWidth={2.2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="更多操作"
                  data-testid="wb-book-more"
                  onClick={() => setSheetBookId(nav.bookId)}
                  className="grid h-9 w-9 place-items-center rounded-full active:bg-black/[0.06] dark:active:bg-white/[0.1]"
                >
                  <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />
                </button>
              </>
            )}
            {nav.name === 'entry' && (
              <button
                type="button"
                data-testid="wb-edit-save-top"
                onClick={() => editorSaveRef.current?.()}
                className="rounded-full px-2.5 py-1.5 text-[16px] font-semibold active:opacity-50"
              >
                保存
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-4 pb-10 pt-2">
        {nav.name === 'list' && (
          <BookListPage
            books={filteredBooks}
            totalCount={books.length}
            stats={stats}
            lastUpdateText={lastUpdateText}
            scopeFilter={scopeFilter}
            onScopeTab={(s) => setScopeFilter((prev) => (prev === s ? 'all' : s))}
            charFilterName={charFilterName}
            onOpenCharSheet={() => setCharSheet(true)}
            contacts={contacts}
            onOpen={(id) => setNav({ name: 'book', bookId: id })}
            onSheet={setSheetBookId}
          />
        )}
        {nav.name === 'book' && (() => {
          const book = books.find((b) => b.id === nav.bookId);
          if (!book) return <EmptyHint text="这本书不存在或已被删除" />;
          return (
            <BookDetailPage
              book={book}
              contacts={contacts}
              onToggleEntry={(entryId, v) =>
                persist(
                  books.map((b) =>
                    b.id === book.id
                      ? { ...b, updatedAt: Date.now(), entries: b.entries.map((e) => (e.id === entryId ? { ...e, enabled: v } : e)) }
                      : b,
                  ),
                )
              }
              onOpenEntry={(entryId) => setNav({ name: 'entry', bookId: book.id, entryId })}
              onEntrySheet={(entryId) => setSheetEntryId(entryId)}
            />
          );
        })()}
        {nav.name === 'entry' && (() => {
          const book = books.find((b) => b.id === nav.bookId);
          const entry = nav.isNew ? pendingDraft : book?.entries.find((e) => e.id === nav.entryId);
          if (!book || !entry) return <EmptyHint text="该条目不存在或已被放弃" />;
          return (
            <EntryEditorPage
              key={entry.id}
              entry={entry}
              isNew={nav.isNew === true}
              contacts={aiContacts}
              registerSave={(fn) => {
                editorSaveRef.current = fn;
              }}
              showToast={showToast}
              onSave={(next) => {
                if (nav.isNew) {
                  persist(books.map((b) => (b.id === book.id ? { ...b, updatedAt: Date.now(), entries: [...b.entries, next] } : b)));
                  setPendingDraft(null);
                  showToast('已创建条目');
                } else {
                  persist(books.map((b) => (b.id === book.id ? { ...b, updatedAt: Date.now(), entries: b.entries.map((e) => (e.id === entry.id ? next : e)) } : b)));
                  showToast('已保存');
                }
                setNav({ name: 'book', bookId: book.id });
              }}
              onDelete={() => {
                setConfirm({
                  title: '删除条目',
                  message: `「${entry.name || '未命名条目'}」删除后不可恢复。`,
                  confirmText: '删除',
                  destructive: true,
                  action: () => {
                    persist(books.map((b) => (b.id === book.id ? { ...b, entries: b.entries.filter((e) => e.id !== entry.id), updatedAt: Date.now() } : b)));
                    showToast('已删除条目');
                    setNav({ name: 'book', bookId: book.id });
                  },
                });
              }}
            />
          );
        })()}
      </div>

      {/* 底部范围筛选栏（书库首页） */}
      {nav.name === 'list' && (
        <div className="shrink-0 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-1" data-testid="wb-scope-bar">
          {/* iOS 分段控件样式：更矮更紧凑（激活段白底浮起，深色模式浅灰段） */}
          <div className="flex gap-[3px] rounded-[11px] bg-black/[0.06] p-[3px] dark:bg-white/[0.09]">
            {([
              ['all', '全部'],
              ['global', WB_SCOPE_LABELS.global],
              ['local', WB_SCOPE_LABELS.local],
              ['exclusive', WB_SCOPE_LABELS.exclusive],
            ] as const).map(([s, label]) => (
              <button
                key={s}
                type="button"
                data-testid={`wb-filter-${s}`}
                aria-pressed={scopeFilter === s}
                onClick={() => setScopeFilter(s)}
                className={`h-[30px] flex-1 rounded-[8px] text-[12.5px] font-medium transition-all ${
                  scopeFilter === s
                    ? 'bg-white text-black shadow-[0_1px_3px_rgba(0,0,0,0.14)] dark:bg-white/[0.22] dark:text-white dark:shadow-none'
                    : 'text-black/55 active:bg-black/[0.04] dark:text-white/55 dark:active:bg-white/[0.07]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 浮层 */}
      {nameDialog?.mode === 'create' && <NameDialog title="新建世界书" initial="" confirmText="创建" onConfirm={createBook} onClose={() => setNameDialog(null)} />}
      {nameDialog?.mode === 'rename' && (
        <NameDialog
          title="重命名世界书"
          initial={books.find((b) => b.id === nameDialog.bookId)?.name ?? ''}
          confirmText="保存"
          onConfirm={(name) => renameBook(nameDialog.bookId, name)}
          onClose={() => setNameDialog(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmText={confirm.confirmText}
          destructive={confirm.destructive}
          onConfirm={confirm.action}
          onClose={() => setConfirm(null)}
        />
      )}
      {sheetBook && (
        <ActionSheet
          title={sheetBook.name}
          onClose={() => setSheetBookId(null)}
          actions={[
            { label: '重命名', onSelect: () => setNameDialog({ mode: 'rename', bookId: sheetBook.id }) },
            { label: '导出', onSelect: () => exportBook(sheetBook.id) },
            {
              label: '删除世界书',
              destructive: true,
              onSelect: () =>
                setConfirm({
                  title: '删除世界书',
                  message: `「${sheetBook.name}」及其 ${sheetBook.entries.length} 个条目将被删除，且不再注入任何聊天。`,
                  confirmText: '删除',
                  destructive: true,
                  action: () => deleteBook(sheetBook.id),
                }),
            },
          ]}
        />
      )}
      {sheetEntry && (
        <ActionSheet
          title={sheetEntry.name || '未命名条目'}
          onClose={() => setSheetEntryId(null)}
          actions={[
            {
              label: '编辑条目',
              onSelect: () => {
                if (!sheetEntryBook) return;
                setNav({ name: 'entry', bookId: sheetEntryBook.id, entryId: sheetEntry.id });
              },
            },
            {
              label: '删除条目',
              destructive: true,
              onSelect: () => {
                const targetBook = sheetEntryBook;
                if (!targetBook) return;
                setConfirm({
                  title: '删除条目',
                  message: `「${sheetEntry.name || '未命名条目'}」删除后不可恢复。`,
                  confirmText: '删除',
                  destructive: true,
                  action: () => {
                    persist(
                      books.map((b) =>
                        b.id === targetBook.id ? { ...b, entries: b.entries.filter((e) => e.id !== sheetEntry.id), updatedAt: Date.now() } : b,
                      ),
                    );
                    showToast('已删除条目');
                  },
                });
              },
            },
          ]}
        />
      )}
      {charSheet && (
        <ActionSheet
          title="按角色查看会生效的世界书"
          onClose={() => setCharSheet(false)}
          actions={[
            { id: 'wb-char-all', label: '全部角色', onSelect: () => setCharFilterId(null) },
            // 只列 AI 角色/配角，不包括 user（用户自己）
            ...aiContacts.map((c) => ({
              id: c.id,
              label: `${c.name}（${kindLabel(c.kind)}）`,
              onSelect: () => setCharFilterId(c.id),
            })),
          ]}
        />
      )}
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="wb-import-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importFile(f);
        }}
      />
      <LocalToast msg={toast} />
    </div>
  );
}

/** 空态提示 */
function EmptyHint({ text }: { text: string }) {
  return (
    <div className="grid place-items-center pt-16 text-center">
      <BookMarked className="h-10 w-10 text-black/15 dark:text-white/15" strokeWidth={1.5} aria-hidden="true" />
      <p className={`mt-3 text-[14px] ${SUB_CLS}`}>{text}</p>
    </div>
  );
}

/** 书库首页：大标题 + 角色筛选 + 统计卡（可点筛选）+ 书籍卡片列表 + 空态 */
function BookListPage({
  books,
  totalCount,
  stats,
  lastUpdateText,
  scopeFilter,
  onScopeTab,
  charFilterName,
  onOpenCharSheet,
  contacts,
  onOpen,
  onSheet,
}: {
  books: WorldBook[]; // 已按范围/角色过滤后的书籍
  totalCount: number;
  stats: WbStats;
  lastUpdateText: string;
  scopeFilter: ScopeFilter;
  onScopeTab: (scope: WbScope) => void;
  charFilterName: string;
  onOpenCharSheet: () => void;
  contacts: ContactRecord[];
  onOpen: (bookId: string) => void;
  onSheet: (bookId: string) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight">我的世界书库</h1>
        <button
          type="button"
          data-testid="wb-char-filter"
          onClick={onOpenCharSheet}
          className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-black/[0.05] px-2.5 text-[12px] active:bg-black/[0.1] dark:bg-white/[0.1] dark:active:bg-white/[0.16]"
        >
          {charFilterName || '全部角色'}
          <ChevronDown className="h-3.5 w-3.5 opacity-50" strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
      <p className={`px-1 pt-1 text-[13px] ${SUB_CLS}`} data-testid="wb-library-sub">
        共 {totalCount} 个世界书 · 最后更新 {lastUpdateText}
      </p>

      {/* 统计卡（紧凑）：全局/局部/专属 三列可点（再点一次取消筛选），已启用为计数展示 */}
      <div className={`${CARD_CLS} mt-2.5 flex items-stretch`}>
        {(['global', 'local', 'exclusive'] as const).map((s, i) => (
          <button
            key={s}
            type="button"
            data-testid={`wb-scope-tab-${s}`}
            aria-pressed={scopeFilter === s}
            onClick={() => onScopeTab(s)}
            className={`relative flex-1 py-2 text-center transition-colors ${
              i > 0 ? `border-l ${DIVIDER_CLS}` : ''
            } ${scopeFilter === s ? 'bg-black/[0.04] dark:bg-white/[0.06]' : 'active:bg-black/[0.03] dark:active:bg-white/[0.04]'}`}
          >
            <span className="block text-[16px] font-bold leading-none tabular-nums">{stats[s]}</span>
            <span className={`mt-[3px] block text-[10.5px] ${scopeFilter === s ? 'font-medium' : SUB_CLS}`}>{WB_SCOPE_LABELS[s]}</span>
            {scopeFilter === s && (
              <span aria-hidden="true" className="absolute inset-x-9 bottom-0 h-[2px] rounded-t-full bg-black dark:bg-white" />
            )}
          </button>
        ))}
        <div className={`flex-1 border-l py-2 text-center ${DIVIDER_CLS}`}>
          <span className="block text-[16px] font-bold leading-none tabular-nums" data-testid="wb-stat-enabled">
            {stats.enabled}
          </span>
          <span className={`mt-[3px] block text-[10.5px] ${SUB_CLS}`}>已启用</span>
        </div>
      </div>
      {charFilterName && (
        <p className={CAPTION_CLS}>正在查看与「{charFilterName}」聊天时会生效的世界书：全局 + 已挂载到该角色的局部 + 专属该角色。</p>
      )}

      {totalCount === 0 ? (
        <EmptyHint text="还没有世界书，点右上角 + 新建" />
      ) : books.length === 0 ? (
        <div className="grid place-items-center pt-16 text-center">
          <Globe className="h-12 w-12 text-black/15 dark:text-white/15" strokeWidth={1.5} aria-hidden="true" />
          <p className="mt-3 text-[15px] font-medium text-black/35 dark:text-white/35">该范围下暂无世界书</p>
          <p className={`mt-1.5 text-[13px] ${SUB_CLS}`}>切换范围筛选，或点 + 新建一个</p>
        </div>
      ) : (
        <div className={`${CARD_CLS} mt-3`}>
          {books.map((book, i) => {
            const enabled = book.entries.filter((e) => e.enabled).length;
            const scope = primaryScopeOf(book);
            const exNames = scope === 'exclusive' ? exclusiveNamesOf(book, contacts).join('、') : '';
            return (
              <div key={book.id} className={i > 0 ? `border-t ${DIVIDER_CLS}` : ''}>
                <div className="flex items-center">
                  <button
                    type="button"
                    data-testid={`wb-book-${i}`}
                    onClick={() => onOpen(book.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-black/[0.05] dark:bg-white/[0.08]">
                      <BookMarked className="h-5 w-5 text-black/60 dark:text-white/60" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[16px]">
                        {book.name}
                        <span className="ml-1.5 inline-block rounded-[4px] bg-black/[0.05] px-1.5 py-0.5 align-middle text-[10.5px] leading-none text-black/55 dark:bg-white/[0.09] dark:text-white/55">
                          {WB_SCOPE_LABELS[scope]}
                          {exNames ? ` · ${exNames}` : ''}
                        </span>
                      </span>
                      <span className={`mt-0.5 block truncate text-[12.5px] ${SUB_CLS}`}>
                        {book.entries.length} 条目 · {enabled} 启用 · {fmtDate(book.updatedAt)}
                      </span>
                    </span>
                    <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25 dark:text-white/25" strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`${book.name} 更多操作`}
                    data-testid={`wb-book-more-${i}`}
                    onClick={() => onSheet(book.id)}
                    className="grid h-11 w-10 shrink-0 place-items-center rounded-full active:bg-black/[0.06] dark:active:bg-white/[0.1]"
                  >
                    <MoreHorizontal className="h-5 w-5 text-black/35 dark:text-white/35" strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** 位置/范围徽章 */
function EntryBadges({ entry, contactName }: { entry: WbEntry; contactName: string }) {
  const base = 'rounded-[4px] bg-black/[0.05] px-1.5 py-0.5 text-[11px] leading-none dark:bg-white/[0.09]';
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className={base}>{WB_POSITION_LABELS[entry.position]}</span>
      <span className={base}>
        {WB_SCOPE_LABELS[entry.scope]}
        {entry.scope === 'exclusive' ? ` · ${contactName || '未指定角色'}` : ''}
      </span>
      {entry.priority > 0 && <span className={base}>优先级 {entry.priority}</span>}
    </span>
  );
}

/** 单条条目行（点=编辑；长按或 ⋯=操作菜单，行尾不再放删除图标） */
function EntryRow({
  entry,
  index,
  contactName,
  onToggle,
  onOpen,
  onSheet,
}: {
  entry: WbEntry;
  index: number;
  contactName: string;
  onToggle: (v: boolean) => void;
  onOpen: () => void;
  onSheet: () => void;
}) {
  const lp = useLongPress(onSheet);
  return (
    <div className={index > 0 ? `border-t ${DIVIDER_CLS}` : ''}>
      <div className="flex items-center gap-2 pr-2">
        <button
          type="button"
          data-testid={`wb-entry-${index}`}
          onClick={() => {
            if (!lp.didFire()) onOpen(); // 长按已触发菜单时抑制紧随的 click
          }}
          onPointerDown={lp.onPointerDown}
          onPointerMove={lp.onPointerMove}
          onPointerUp={lp.onPointerUp}
          onPointerLeave={lp.onPointerLeave}
          onPointerCancel={lp.onPointerCancel}
          onContextMenu={(e) => e.preventDefault()}
          className="min-w-0 flex-1 select-none px-4 py-3 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06] [-webkit-touch-callout:none]"
        >
          <span className={`block truncate text-[15.5px] ${entry.enabled ? '' : SUB_CLS}`}>{entry.name || '未命名条目'}</span>
          <span className={`mt-0.5 block truncate text-[12.5px] ${SUB_CLS}`}>触发词：{entry.keywords.join('、')}</span>
          <EntryBadges entry={entry} contactName={contactName} />
        </button>
        <MonoToggle on={entry.enabled} onChange={onToggle} label={`启用${entry.name || '未命名条目'}`} testId={`wb-entry-toggle-${index}`} />
        <button
          type="button"
          aria-label={`${entry.name || '未命名条目'} 更多操作`}
          data-testid={`wb-entry-more-${index}`}
          onClick={onSheet}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/[0.06] dark:active:bg-white/[0.1]"
        >
          <MoreHorizontal className="h-5 w-5 text-black/35 dark:text-white/35" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** 书籍详情页（条目列表）：点条目编辑，长按 / ⋯ 打开操作菜单（编辑/删除） */
function BookDetailPage({
  book,
  contacts,
  onToggleEntry,
  onOpenEntry,
  onEntrySheet,
}: {
  book: WorldBook;
  contacts: ContactRecord[];
  onToggleEntry: (entryId: string, v: boolean) => void;
  onOpenEntry: (entryId: string) => void;
  onEntrySheet: (entryId: string) => void;
}) {
  const contactNameOf = (id: string | null | undefined) => (id ? contacts.find((c) => c.id === id)?.name ?? '已删除角色' : '');
  return (
    <>
      <p className={CAPTION_CLS}>
        {book.entries.length > 0
          ? '点条目编辑；长按条目或点右侧 ⋯ 可删除；开关关闭后该条目永不发送。'
          : '还没有条目，点右上角 + 新建第一条设定。'}
      </p>
      {book.entries.length > 0 && (
        <div className={`${CARD_CLS} mt-2`}>
          {book.entries.map((entry, i) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              index={i}
              contactName={contactNameOf(entry.targetContactId)}
              onToggle={(v) => onToggleEntry(entry.id, v)}
              onOpen={() => onOpenEntry(entry.id)}
              onSheet={() => onEntrySheet(entry.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** 设置组里的选项行（右侧勾） */
function OptionRow({
  label,
  note,
  selected,
  testId,
  onClick,
  first,
}: {
  label: string;
  note?: string;
  selected: boolean;
  testId: string;
  onClick: () => void;
  first?: boolean;
}) {
  return (
    <div className={first ? '' : `border-t ${DIVIDER_CLS}`}>
      <button type="button" data-testid={testId} onClick={onClick} className="flex w-full items-center justify-between px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]">
        <span className="min-w-0">
          <span className="block text-[15px]">{label}</span>
          {note && <span className={`mt-0.5 block text-[12px] leading-[1.4] ${SUB_CLS}`}>{note}</span>}
        </span>
        {selected && (
          <span className="grid shrink-0 place-items-center pl-2" aria-label="已选中">
            <Check className="h-5 w-5" strokeWidth={2.4} />
          </span>
        )}
      </button>
    </div>
  );
}

const POSITION_NOTES: Record<WbPosition, string> = {
  before_system: '插入整段系统提示词最前面',
  after_system: '插入整段系统提示词最后面',
  before_char: '插在角色人设定义之前',
  after_char: '插在角色人设定义之后',
  before_user: '包裹在最后一条用户消息之前',
  after_user: '包裹在最后一条用户消息之后',
};

const SCOPE_NOTES: Record<WbScope, string> = {
  global: '不绑定角色，所有聊天共享生效（无需挂载）',
  local: '仅当本书挂载到当前联系人生效',
  exclusive: '仅对下方指定的那个角色生效（无需挂载）',
};

/** 条目编辑页（本地草稿，点右上角「保存」才落盘；新建条目在保存前不落盘，返回即放弃） */
function EntryEditorPage({
  entry,
  isNew,
  contacts,
  registerSave,
  showToast,
  onSave,
  onDelete,
}: {
  entry: WbEntry;
  /** 新建未保存的条目：不渲染删除按钮，保存时才写入书籍 */
  isNew?: boolean;
  contacts: ContactRecord[];
  /** 把内部 save 暴露给顶栏（右上角「保存」按钮） */
  registerSave?: (fn: (() => void) | null) => void;
  showToast?: (msg: string) => void;
  onSave: (next: WbEntry) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<WbEntry>(entry);
  const [keywordsInput, setKeywordsInput] = useState(entry.keywords.join('，'));
  const [error, setError] = useState('');
  const keywords = useMemo(() => parseKeywordsInput(keywordsInput), [keywordsInput]);

  const save = () => {
    const check = wbEntryCheck({ keywords, content: draft.content });
    if (!check.ok) {
      setError(check.reason);
      showToast?.(check.reason);
      return;
    }
    onSave({
      ...draft,
      name: draft.name.trim() || '未命名条目',
      keywords,
      content: draft.content,
    });
  };

  // 草稿状态在本组件内：每次渲染把最新 save 暴露给顶栏右上角「保存」按钮
  useEffect(() => {
    registerSave?.(save);
    return () => registerSave?.(null);
  });

  return (
    <div className="pb-2">
      {/* 开关 + 条目名字 */}
      <div className={`${CARD_CLS}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[15.5px]">启用条目</span>
          <MonoToggle on={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} label="启用条目" testId="wb-edit-enabled" />
        </div>
        <div className={`border-t ${DIVIDER_CLS}`}>
          <label className="block px-4 pb-1 pt-2.5 text-[12.5px]">
            <span className={SUB_CLS}>条目名字（仅本地显示，不发送给 AI）</span>
          </label>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="如：魔法世界观"
            aria-label="条目名字"
            data-testid="wb-edit-name"
            className="h-10 w-full bg-transparent px-4 text-[15px] outline-none placeholder:text-black/25 dark:placeholder:text-white/25"
          />
        </div>
      </div>

      {/* 触发词 */}
      <p className="px-1 pb-1.5 pt-4 text-[13px] text-black/50 dark:text-white/50">触发词</p>
      <div className={`${CARD_CLS} p-3`}>
        <input
          value={keywordsInput}
          onChange={(e) => {
            setKeywordsInput(e.target.value);
            setError('');
          }}
          placeholder="多个触发词用逗号分隔，命中任一即激活"
          aria-label="触发词"
          data-testid="wb-edit-keywords"
          className="h-9 w-full rounded-[9px] bg-black/[0.04] px-3 text-[14.5px] outline-none placeholder:text-black/25 dark:bg-white/[0.07] dark:placeholder:text-white/25"
        />
        {keywords.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {keywords.map((kw) => (
              <button
                key={kw}
                type="button"
                aria-label={`删除触发词 ${kw}`}
                onClick={() => {
                  const rest = keywords.filter((k) => k !== kw);
                  setKeywordsInput(rest.join('，'));
                }}
                className="flex items-center gap-1 rounded-full bg-black/[0.06] py-1 pl-2.5 pr-1.5 text-[12.5px] active:opacity-60 dark:bg-white/[0.1]"
              >
                {kw}
                <span aria-hidden="true" className="grid h-3.5 w-3.5 place-items-center rounded-full bg-black/25 text-[9px] leading-none text-white dark:bg-white/30">
                  ×
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 内容 */}
      <p className="px-1 pb-1.5 pt-4 text-[13px] text-black/50 dark:text-white/50">内容（激活后插入的设定文本）</p>
      <div className={`${CARD_CLS} p-3`}>
        <textarea
          value={draft.content}
          onChange={(e) => {
            setDraft({ ...draft, content: e.target.value });
            setError('');
          }}
          placeholder="写给 AI 的设定文本，如：这个世界是一片魔法大陆，共有五大王国……"
          aria-label="条目内容"
          data-testid="wb-edit-content"
          rows={6}
          className="w-full resize-none rounded-[9px] bg-black/[0.04] px-3 py-2.5 text-[14.5px] leading-[1.6] outline-none placeholder:text-black/25 dark:bg-white/[0.07] dark:placeholder:text-white/25"
        />
      </div>

      {/* 插入位置 */}
      <p className="px-1 pb-1.5 pt-4 text-[13px] text-black/50 dark:text-white/50">插入位置</p>
      <div className={CARD_CLS}>
        {WB_POSITIONS.map((pos, i) => (
          <OptionRow
            key={pos}
            label={WB_POSITION_LABELS[pos]}
            note={POSITION_NOTES[pos]}
            selected={draft.position === pos}
            testId={`wb-edit-pos-${pos}`}
            first={i === 0}
            onClick={() => setDraft({ ...draft, position: pos })}
          />
        ))}
      </div>

      {/* 生效范围 */}
      <p className="px-1 pb-1.5 pt-4 text-[13px] text-black/50 dark:text-white/50">生效范围</p>
      <div className={CARD_CLS}>
        {WB_SCOPES.map((scope, i) => (
          <OptionRow
            key={scope}
            label={WB_SCOPE_LABELS[scope]}
            note={SCOPE_NOTES[scope]}
            selected={draft.scope === scope}
            testId={`wb-edit-scope-${scope}`}
            first={i === 0}
            onClick={() => setDraft({ ...draft, scope })}
          />
        ))}
      </div>

      {/* 专属目标角色 */}
      {draft.scope === 'exclusive' && (
        <>
          <p className="px-1 pb-1.5 pt-4 text-[13px] text-black/50 dark:text-white/50">指定角色（仅该角色的聊天生效）</p>
          <div className={`${CARD_CLS} max-h-72 overflow-y-auto`}>
            {contacts.length === 0 ? (
              <p className={`px-4 py-4 text-[13.5px] ${SUB_CLS}`}>暂无联系人，可先到「联系人」App 创建。</p>
            ) : (
              contacts.map((c, i) => (
                <OptionRow
                  key={c.id}
                  label={`${c.name}（${kindLabel(c.kind)}）`}
                  selected={draft.targetContactId === c.id}
                  testId={`wb-edit-target-${i}`}
                  first={i === 0}
                  onClick={() => setDraft({ ...draft, targetContactId: c.id })}
                />
              ))
            )}
          </div>
        </>
      )}

      {/* 优先级 + 忽略大小写 */}
      <p className="px-1 pb-1.5 pt-4 text-[13px] text-black/50 dark:text-white/50">排序与匹配</p>
      <div className={CARD_CLS}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="min-w-0">
            <span className="block text-[15px]">优先级</span>
            <span className={`mt-0.5 block text-[12px] leading-[1.4] ${SUB_CLS}`}>同一位置多条命中时，数字大的排前面</span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              aria-label="降低优先级"
              data-testid="wb-edit-priority-minus"
              onClick={() => setDraft({ ...draft, priority: Math.max(0, draft.priority - 1) })}
              className="grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] text-[18px] active:bg-black/[0.1] dark:bg-white/[0.09] dark:active:bg-white/[0.15]"
            >
              −
            </button>
            <span data-testid="wb-edit-priority-value" className="w-8 text-center text-[15.5px] tabular-nums">
              {draft.priority}
            </span>
            <button
              type="button"
              aria-label="提高优先级"
              data-testid="wb-edit-priority-plus"
              onClick={() => setDraft({ ...draft, priority: Math.min(9999, draft.priority + 1) })}
              className="grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] text-[18px] active:bg-black/[0.1] dark:bg-white/[0.09] dark:active:bg-white/[0.15]"
            >
              +
            </button>
          </span>
        </div>
        <div className={`border-t ${DIVIDER_CLS}`}>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="min-w-0">
              <span className="block text-[15px]">忽略大小写</span>
              <span className={`mt-0.5 block text-[12px] leading-[1.4] ${SUB_CLS}`}>触发词匹配时不区分英文字母大小写</span>
            </span>
            <MonoToggle on={draft.ignoreCase} onChange={(v) => setDraft({ ...draft, ignoreCase: v })} label="忽略大小写" testId="wb-edit-ignorecase" />
          </div>
        </div>
      </div>

      {error && <p className={`px-1 pt-2.5 text-[12.5px] ${DESTRUCTIVE_CLS}`}>{error}</p>}

      {/* 删除（仅已保存的条目；保存按钮在顶栏右上角） */}
      {!isNew && (
        <div className="mt-5">
          <button
            type="button"
            data-testid="wb-edit-delete"
            onClick={onDelete}
            className={`flex h-11 w-full items-center justify-center gap-1.5 rounded-[12px] bg-white text-[15.5px] active:bg-black/[0.04] dark:bg-[#1C1C1E] dark:active:bg-white/[0.08] ${DESTRUCTIVE_CLS}`}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            删除条目
          </button>
        </div>
      )}
      <p className={`pt-2 text-center text-[12px] ${SUB_CLS}`}>
        {isNew ? '点右上角「保存」创建条目；返回则放弃' : '点右上角「保存」才会生效；返回不保存修改'}
      </p>
    </div>
  );
}
