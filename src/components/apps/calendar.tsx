'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { localDB, genId, type CalendarEventRecord } from '@/lib/ios/db';
import { BackToHome } from '@/components/ios/BackToHome';
import { Switch } from '@/components/ui/switch';

/**
 * 日历 App：月视图（周一为一周开始）+ 选中日事件区 + 底部滑出新建/编辑表单。
 * 数据持久化于 IndexedDB events 表；startTime/endTime 为空字符串表示全天。
 */

// ---------------- 日期工具 ----------------

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function keyToParts(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map((v) => parseInt(v, 10));
  return { y, m: (m || 1) - 1, d: d || 1 };
}

function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const t = y * 12 + m + delta;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

/** 周一头开始的星期表头 */
const WEEKDAY_HEADER = ['一', '二', '三', '四', '五', '六', '日'];
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

function weekdayCN(key: string): string {
  const { y, m, d } = keyToParts(key);
  return WEEKDAY_CN[new Date(y, m, d).getDay()] ?? '';
}

/** "12月28日 星期日" */
function formatDayHeader(key: string): string {
  const { m, d } = keyToParts(key);
  return `${m + 1}月${d}日 星期${weekdayCN(key)}`;
}

/** 字符串哈希 → 事件色条深浅 */
function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const BAR_SHADES = ['bg-foreground', 'bg-foreground/60', 'bg-foreground/35'] as const;

interface Cell {
  key: string;
  day: number;
  inMonth: boolean;
}

interface EventFormState {
  id: string | null;
  createdAt: number;
  title: string;
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  note: string;
}

const FIELD_CLASS =
  'mt-1 h-10 w-full rounded-[10px] border border-input bg-transparent px-3 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/50 [color-scheme:light] dark:[color-scheme:dark]';

export default function CalendarApp() {
  const [loaded, setLoaded] = useState(false);
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [viewYM, setViewYM] = useState<{ y: number; m: number }>(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [selectedKey, setSelectedKey] = useState<string>(() => {
    const n = new Date();
    return dateKey(n.getFullYear(), n.getMonth(), n.getDate());
  });

  // 表单 sheet
  const [form, setForm] = useState<EventFormState | null>(null);
  const [formShown, setFormShown] = useState(false);
  const [formError, setFormError] = useState('');
  /** 月网格左右滑动起点 / 切月方向（用于进场动画） */
  const touchX = useRef<number | null>(null);
  const [slideDir, setSlideDir] = useState(1);

  const reloadEvents = useCallback(async () => {
    try {
      const all = await localDB.getAll('events');
      setEvents(all);
    } catch {
      /* IndexedDB 不可用时保持空列表 */
    }
    setLoaded(true);
  }, []);

  // 初次加载（await 之后再 setState）
  useEffect(() => {
    void (async () => {
      await reloadEvents();
    })();
  }, [reloadEvents]);

  const todayKey = useMemo(() => {
    const n = new Date();
    return dateKey(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  /** date → events 有序映射（全天在前，其余按开始时间） */
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventRecord[]>();
    for (const ev of events) {
      const list = map.get(ev.date);
      if (list) list.push(ev);
      else map.set(ev.date, [ev]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.startTime === '' && b.startTime !== '') return -1;
        if (b.startTime === '' && a.startTime !== '') return 1;
        if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
        return a.createdAt - b.createdAt;
      });
    }
    return map;
  }, [events]);

  /** 42 格月网格（固定 6 周，含前后月补位） */
  const cells = useMemo<Cell[]>(() => {
    const first = new Date(viewYM.y, viewYM.m, 1);
    const lead = (first.getDay() + 6) % 7; // 周一为一周开始
    const total = daysInMonth(viewYM.y, viewYM.m);
    const prev = addMonths(viewYM.y, viewYM.m, -1);
    const prevTotal = daysInMonth(prev.y, prev.m);
    const next = addMonths(viewYM.y, viewYM.m, 1);
    const out: Cell[] = [];
    for (let i = lead - 1; i >= 0; i--) {
      out.push({ key: dateKey(prev.y, prev.m, prevTotal - i), day: prevTotal - i, inMonth: false });
    }
    for (let d = 1; d <= total; d++) out.push({ key: dateKey(viewYM.y, viewYM.m, d), day: d, inMonth: true });
    let nd = 1;
    while (out.length < 42) {
      out.push({ key: dateKey(next.y, next.m, nd), day: nd, inMonth: false });
      nd++;
    }
    return out;
  }, [viewYM]);

  const selectedDayEvents = eventsByDate.get(selectedKey) ?? [];

  function shiftMonth(delta: number) {
    setSlideDir(delta);
    setViewYM((v) => addMonths(v.y, v.m, delta));
  }

  function goToday() {
    const n = new Date();
    setViewYM({ y: n.getFullYear(), m: n.getMonth() });
    setSelectedKey(dateKey(n.getFullYear(), n.getMonth(), n.getDate()));
  }

  function selectCell(c: Cell) {
    setSelectedKey(c.key);
    if (!c.inMonth) {
      const { y, m } = keyToParts(c.key);
      setViewYM({ y, m });
    }
  }

  // ---------------- 表单 ----------------

  const patchForm = (p: Partial<EventFormState>) => setForm((f) => (f ? { ...f, ...p } : f));

  function openForm(ev: CalendarEventRecord | null) {
    const base: EventFormState = ev
      ? {
          id: ev.id,
          createdAt: ev.createdAt,
          title: ev.title,
          date: ev.date,
          allDay: ev.startTime === '',
          start: ev.startTime || '09:00',
          end: ev.endTime || '10:00',
          note: ev.note,
        }
      : {
          id: null,
          createdAt: Date.now(),
          title: '',
          date: selectedKey,
          allDay: false,
          start: '09:00',
          end: '10:00',
          note: '',
        };
    setFormError('');
    setForm(base);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setFormShown(true));
    });
  }

  function closeForm() {
    setFormShown(false);
    window.setTimeout(() => {
      setForm(null);
      setFormError('');
    }, 280);
  }

  function saveForm() {
    if (!form) return;
    const title = form.title.trim();
    if (!title) {
      setFormError('请输入事件标题');
      return;
    }
    if (!form.date) {
      setFormError('请选择日期');
      return;
    }
    if (!form.allDay && form.start && form.end && form.end <= form.start) {
      setFormError('结束时间需晚于开始时间');
      return;
    }
    const rec: CalendarEventRecord = {
      id: form.id ?? genId(),
      title,
      date: form.date,
      startTime: form.allDay ? '' : form.start,
      endTime: form.allDay ? '' : form.end,
      note: form.note.trim(),
      createdAt: form.createdAt,
    };
    void (async () => {
      try {
        await localDB.put('events', rec);
      } catch {
        /* 忽略保存异常 */
      }
      closeForm();
      await reloadEvents();
    })();
  }

  function deleteForm() {
    if (!form?.id) return;
    if (!window.confirm(`确定删除"${form.title || '该事件'}"吗？`)) return;
    const id = form.id;
    void (async () => {
      try {
        await localDB.delete('events', id);
      } catch {
        /* 忽略删除异常 */
      }
      closeForm();
      await reloadEvents();
    })();
  }

  // ---------------- 渲染 ----------------

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* 顶部：‹ 年月 › + 今天 */}
      <div className="shrink-0 px-4 pt-[54px]">
        <div className="flex items-center justify-between gap-2 pb-2 pt-1">
          <div className="flex items-center gap-0.5">
            <BackToHome className="static! mr-1" />
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="上个月"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-muted active:text-foreground"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
            </button>
            <div className="min-w-[112px] text-center text-[22px] font-bold leading-none tabular-nums tracking-tight">
              {viewYM.y}年{viewYM.m + 1}月
            </div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="下个月"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-muted active:text-foreground"
            >
              <ChevronRight className="h-5 w-5" strokeWidth={2.2} />
            </button>
          </div>
          <button
            type="button"
            onClick={goToday}
            className="rounded-full bg-muted px-4 py-1.5 text-[13px] font-medium text-foreground transition active:scale-95"
          >
            今天
          </button>
        </div>

        {/* 星期头 */}
        <div className="grid grid-cols-7 pb-1">
          {WEEKDAY_HEADER.map((w) => (
            <div key={w} className="text-center text-[11px] font-medium leading-5 text-muted-foreground">
              {w}
            </div>
          ))}
        </div>
      </div>

      {/* 月网格（42 格固定高度，支持左右滑动切月） */}
      <div
        key={`${viewYM.y}-${viewYM.m}`}
        className={`grid shrink-0 grid-cols-7 px-2 ${
          slideDir >= 0
            ? 'animate-in fade-in slide-in-from-right-3 duration-200'
            : 'animate-in fade-in slide-in-from-left-3 duration-200'
        }`}
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const start = touchX.current;
          touchX.current = null;
          if (start === null) return;
          const dx = (e.changedTouches[0]?.clientX ?? 0) - start;
          if (Math.abs(dx) >= 56) shiftMonth(dx < 0 ? 1 : -1);
        }}
      >
        {cells.map((c) => {
          const isToday = c.key === todayKey;
          const isSelected = c.key === selectedKey && !isToday;
          const dayEvents = eventsByDate.get(c.key) ?? [];
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => selectCell(c)}
              aria-label={`${c.key}${c.inMonth ? '' : '（非本月）'}`}
              aria-pressed={c.key === selectedKey}
              className="flex h-14 w-full flex-col items-center justify-center gap-[3px] transition-opacity active:opacity-60"
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[16px] tabular-nums ${
                  isToday
                    ? 'bg-[#FF453A] font-medium text-white'
                    : isSelected
                      ? 'text-foreground ring-[1.5px] ring-inset ring-foreground'
                      : c.inMonth
                        ? 'text-foreground'
                        : 'text-muted-foreground/50'
                }`}
              >
                {c.day}
              </span>
              <span className="flex h-1 items-center gap-[3px]">
                {dayEvents.slice(0, 3).map((ev) => (
                  <span
                    key={ev.id}
                    className={`h-1 w-1 rounded-full ${
                      c.inMonth ? BAR_SHADES[hashId(ev.id) % BAR_SHADES.length] : 'bg-muted-foreground/40'
                    }`}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {/* 事件区 */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-border/60">
        <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3">
          <div className="text-[17px] font-semibold">{formatDayHeader(selectedKey)}</div>
          <button
            type="button"
            onClick={() => openForm(null)}
            aria-label="新建事件"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-muted transition-opacity active:opacity-60"
          >
            <Plus className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto pb-8">
          {loaded && selectedDayEvents.length === 0 ? (
            <div className="flex h-28 flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <CalendarDays className="h-6 w-6 text-muted-foreground/45" strokeWidth={1.5} />
              <div className="text-[15px]">无事件</div>
            </div>
          ) : (
            <div className="mx-4 divide-y divide-border/40 overflow-hidden rounded-[16px] bg-card">
              {selectedDayEvents.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => openForm(ev)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-muted/50"
                >
                  <span className="flex w-[64px] shrink-0 flex-col leading-tight tabular-nums">
                    {ev.startTime === '' ? (
                      <span className="text-[13px] font-medium text-muted-foreground">全天</span>
                    ) : (
                      <>
                        <span className="text-[15px]">{ev.startTime}</span>
                        <span className="mt-0.5 text-[12px] text-muted-foreground">{ev.endTime}</span>
                      </>
                    )}
                  </span>
                  <span
                    className={`h-10 w-[3px] shrink-0 rounded-full ${
                      BAR_SHADES[hashId(ev.id) % BAR_SHADES.length]
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-medium leading-tight">{ev.title}</span>
                    {ev.note && (
                      <span className="mt-0.5 block truncate text-[13px] leading-tight text-muted-foreground">
                        {ev.note}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 新建/编辑事件 Sheet */}
      {form && (
        <div className="absolute inset-0 z-30">
          <div
            className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${
              formShown ? 'opacity-100' : 'opacity-0'
            }`}
            onClick={closeForm}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={form.id ? '编辑事件' : '新建事件'}
            className={`absolute inset-x-0 bottom-0 max-h-[85%] overflow-y-auto rounded-t-[16px] bg-background p-5 pb-12 shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
              formShown ? 'translate-y-0' : 'translate-y-full'
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[17px] font-semibold">{form.id ? '编辑事件' : '新建事件'}</div>
              <button
                type="button"
                onClick={closeForm}
                aria-label="关闭"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-muted transition-opacity active:opacity-60"
              >
                <X className="h-4 w-4" strokeWidth={2.4} />
              </button>
            </div>

            {formError && (
              <div className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                {formError}
              </div>
            )}

            <label htmlFor="ev-title" className="text-[13px] font-medium text-muted-foreground">
              标题
            </label>
            <input
              id="ev-title"
              value={form.title}
              onChange={(e) => patchForm({ title: e.target.value })}
              placeholder="事件标题"
              className={FIELD_CLASS}
            />

            <label htmlFor="ev-date" className="mt-3 block text-[13px] font-medium text-muted-foreground">
              日期
            </label>
            <input
              id="ev-date"
              type="date"
              value={form.date}
              onChange={(e) => patchForm({ date: e.target.value })}
              className={FIELD_CLASS}
            />

            <div className="mt-3 flex items-center justify-between rounded-[10px] border border-input px-3 py-2">
              <span className="text-[15px]">全天</span>
              <Switch checked={form.allDay} onCheckedChange={(v) => patchForm({ allDay: v })} aria-label="全天" />
            </div>

            {!form.allDay && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ev-start" className="text-[13px] font-medium text-muted-foreground">
                    开始
                  </label>
                  <input
                    id="ev-start"
                    type="time"
                    value={form.start}
                    onChange={(e) => patchForm({ start: e.target.value })}
                    className={FIELD_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="ev-end" className="text-[13px] font-medium text-muted-foreground">
                    结束
                  </label>
                  <input
                    id="ev-end"
                    type="time"
                    value={form.end}
                    onChange={(e) => patchForm({ end: e.target.value })}
                    className={FIELD_CLASS}
                  />
                </div>
              </div>
            )}

            <label htmlFor="ev-note" className="mt-3 block text-[13px] font-medium text-muted-foreground">
              备注
            </label>
            <textarea
              id="ev-note"
              value={form.note}
              onChange={(e) => patchForm({ note: e.target.value })}
              rows={3}
              placeholder="备注（可选）"
              className="mt-1 w-full resize-none rounded-[10px] border border-input bg-transparent px-3 py-2 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/50"
            />

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={saveForm}
                className="h-11 w-full rounded-[12px] bg-foreground text-[16px] font-semibold text-background transition-opacity active:opacity-80"
              >
                保存
              </button>
              {form.id && (
                <button
                  type="button"
                  onClick={deleteForm}
                  className="h-11 w-full rounded-[12px] text-[16px] font-semibold text-[#FF453A] transition-opacity active:opacity-60"
                >
                  删除事件
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
