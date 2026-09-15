'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, CircleCheck, Flag, Info, Plus, X } from 'lucide-react';
import { localDB, genId, type ReminderRecord } from '@/lib/ios/db';
import { IOSNavBar } from '@/components/ios/IOSNavBar';
import { BackToHome } from '@/components/ios/BackToHome';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

/**
 * 提醒事项 App：
 * - 未完成列表（createdAt 升序）+ 已完成折叠区（自动沉底）
 * - 行内圆圈完成切换（scale 过渡）+ Info 打开详情编辑底部 Sheet
 * - 底部圆角快速新建栏（Enter / 失焦非空即创建）
 * 数据持久化于 IndexedDB reminders 表。
 */

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 到期副标题：今天/过期红色，其他日期 muted；仅时间视为今天的提醒 */
function dueInfo(r: ReminderRecord): { text: string; red: boolean } | null {
  const today = todayKey();
  if (r.dueDate) {
    const timePart = r.dueTime ? ` ${r.dueTime}` : '';
    if (r.dueDate === today) return { text: `今天${timePart}`, red: true };
    const parts = r.dueDate.split('-').map((v) => parseInt(v, 10));
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return { text: `${parts[1]}月${parts[2]}日${timePart}`, red: r.dueDate < today };
    }
    return null;
  }
  if (r.dueTime) {
    const now = new Date();
    return { text: `今天 ${r.dueTime}`, red: r.dueTime < `${pad2(now.getHours())}:${pad2(now.getMinutes())}` };
  }
  return null;
}

/** 未完成在上（各自按 createdAt 升序） */
function sortReminders(list: ReminderRecord[]): ReminderRecord[] {
  return [...list].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return a.createdAt - b.createdAt;
  });
}

// ---------------- 行组件 ----------------

function CircleToggle({
  completed,
  onToggle,
  label,
}: {
  completed: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      className={`mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all duration-200 active:scale-90 ${
        completed ? 'border-foreground bg-foreground' : 'border-muted-foreground/40 bg-transparent'
      }`}
    >
      <Check
        className={`h-3 w-3 text-background transition-transform duration-200 ${
          completed ? 'scale-100' : 'scale-0'
        }`}
        strokeWidth={3.5}
      />
    </button>
  );
}

function ReminderRow({
  r,
  onToggle,
  onInfo,
}: {
  r: ReminderRecord;
  onToggle: (r: ReminderRecord) => void;
  onInfo: (r: ReminderRecord) => void;
}) {
  const due = dueInfo(r);
  return (
    <div className="flex items-start gap-3 py-2.5 pl-4 pr-3">
      <CircleToggle
        completed={r.completed}
        onToggle={() => onToggle(r)}
        label={r.completed ? '标记为未完成' : '标记为完成'}
      />
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[17px] leading-snug ${
            r.completed ? 'text-muted-foreground line-through' : ''
          }`}
        >
          {r.title}
        </div>
        {due && (
          <div
            className={`mt-0.5 truncate text-[13px] leading-snug ${
              due.red ? 'text-[#FF453A]' : 'text-muted-foreground'
            }`}
          >
            {due.text}
          </div>
        )}
        {r.notes && <div className="mt-0.5 truncate text-[13px] leading-snug text-muted-foreground/70">{r.notes}</div>}
      </div>
      {r.flagged && !r.completed && (
        <Flag className="mt-1 h-3.5 w-3.5 shrink-0 fill-[#FF9F0A] text-[#FF9F0A]" strokeWidth={1.8} />
      )}
      <button
        type="button"
        onClick={() => onInfo(r)}
        aria-label="详细信息"
        className="shrink-0 self-center p-1 transition-opacity active:opacity-50"
      >
        <Info className="h-5 w-5 text-muted-foreground/60" strokeWidth={1.8} />
      </button>
    </div>
  );
}

// ---------------- 详情编辑 Sheet ----------------

function ReminderSheet({
  reminder,
  onClose,
  onSave,
  onDelete,
}: {
  reminder: ReminderRecord;
  onClose: () => void;
  onSave: (r: ReminderRecord) => void;
  onDelete: (id: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const [title, setTitle] = useState(reminder.title);
  const [notes, setNotes] = useState(reminder.notes);
  const [dueDate, setDueDate] = useState(reminder.dueDate);
  const [dueTime, setDueTime] = useState(reminder.dueTime);
  const [flagged, setFlagged] = useState(reminder.flagged);

  // 双 rAF 触发上滑动画（setState 在 rAF 回调内）
  useEffect(() => {
    let alive = true;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (alive) setShown(true);
      });
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  const canSave = title.trim().length > 0;

  return (
    <div className="absolute inset-0 z-40">
      <button
        aria-label="关闭面板"
        onClick={onClose}
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`no-scrollbar absolute inset-x-0 bottom-0 max-h-[88%] overflow-y-auto rounded-t-[20px] border-t border-border/60 bg-background shadow-2xl transition-transform duration-300 ease-out ${
          shown ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="relative flex justify-center pt-2.5">
          <div className="h-1 w-9 rounded-full bg-muted-foreground/30" />
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭详情"
            className="absolute right-4 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-muted transition-opacity active:opacity-60"
          >
            <X className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>
        <div className="flex flex-col gap-3 px-5 pb-[34px] pt-4">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题"
            aria-label="提醒标题"
            className="h-11 rounded-[12px] border-none bg-muted text-[17px] placeholder:text-muted-foreground/60"
          />
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="备注"
            aria-label="备注"
            className="min-h-[76px] rounded-[12px] border-none bg-muted text-[15px] placeholder:text-muted-foreground/60"
          />
          <div className="flex gap-3">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-label="到期日期"
              className="h-11 min-w-0 flex-1 rounded-[12px] bg-muted px-3 text-[15px] text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark]"
            />
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              aria-label="到期时间"
              className="h-11 min-w-0 flex-1 rounded-[12px] bg-muted px-3 text-[15px] text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark]"
            />
          </div>
          <div className="flex h-11 items-center justify-between rounded-[12px] bg-muted px-4">
            <span className="text-[15px]">标记</span>
            <Switch checked={flagged} onCheckedChange={setFlagged} aria-label="标记提醒" />
          </div>
          <button
            type="button"
            onClick={() => onDelete(reminder.id)}
            className="h-11 rounded-[12px] bg-muted text-[17px] text-[#FF453A] transition-opacity active:opacity-60"
          >
            删除提醒
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() =>
              onSave({ ...reminder, title: title.trim(), notes: notes.trim(), dueDate, dueTime, flagged })
            }
            className="mt-1 h-11 rounded-full bg-foreground text-[17px] font-medium text-background transition-opacity active:opacity-80 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 主应用 ----------------

export default function RemindersApp() {
  const [loaded, setLoaded] = useState(false);
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [draft, setDraft] = useState('');
  const [showCompleted, setShowCompleted] = useState(true);
  const [editing, setEditing] = useState<ReminderRecord | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 初次加载（await 之后再 setState）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const all = await localDB.getAll('reminders');
        if (alive) setReminders(sortReminders(all));
      } catch {
        /* IndexedDB 不可用时保持空列表 */
      }
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pending = reminders.filter((r) => !r.completed);
  const completed = reminders.filter((r) => r.completed);

  function createFromDraft() {
    const title = draft.trim();
    if (!title) return;
    const rec: ReminderRecord = {
      id: genId(),
      title,
      notes: '',
      completed: false,
      flagged: false,
      dueDate: '',
      dueTime: '',
      createdAt: Date.now(),
      completedAt: null,
    };
    setDraft('');
    setReminders((prev) => sortReminders([...prev, rec]));
    void localDB.put('reminders', rec).catch(() => undefined);
  }

  function toggleDone(r: ReminderRecord) {
    const updated: ReminderRecord = {
      ...r,
      completed: !r.completed,
      completedAt: !r.completed ? Date.now() : null,
    };
    setReminders((prev) => sortReminders(prev.map((x) => (x.id === r.id ? updated : x))));
    void localDB.put('reminders', updated).catch(() => undefined);
  }

  function saveFromSheet(rec: ReminderRecord) {
    setReminders((prev) => sortReminders(prev.map((x) => (x.id === rec.id ? rec : x))));
    void localDB.put('reminders', rec).catch(() => undefined);
    setEditing(null);
  }

  function deleteFromSheet(id: string) {
    setReminders((prev) => prev.filter((x) => x.id !== id));
    void localDB.delete('reminders', id).catch(() => undefined);
    setEditing(null);
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div className="no-scrollbar flex-1 overflow-y-auto">
        <IOSNavBar inline title="提醒事项" left={<BackToHome className="static!" />} />

        {reminders.length > 0 && (
          <div className="px-5 pb-1 pt-0.5 text-[13px] text-muted-foreground">{pending.length} 项未完成</div>
        )}

        <div className="px-4 pb-[124px] pt-1">
          {loaded && reminders.length === 0 ? (
            <div className="flex flex-col items-center gap-3 pt-24 text-muted-foreground">
              <CircleCheck className="h-14 w-14 opacity-40" strokeWidth={1.1} />
              <div className="text-[17px] font-medium text-foreground/70">没有提醒事项</div>
            </div>
          ) : (
            reminders.length > 0 && (
              <div className="divide-y divide-border/60 overflow-hidden rounded-[16px] bg-card">
                {pending.map((r) => (
                  <ReminderRow key={r.id} r={r} onToggle={toggleDone} onInfo={setEditing} />
                ))}

                {completed.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowCompleted((v) => !v)}
                      className="flex w-full items-center gap-1 px-4 py-2.5 text-left"
                      aria-expanded={showCompleted}
                    >
                      <ChevronRight
                        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                          showCompleted ? 'rotate-90' : ''
                        }`}
                        strokeWidth={2.2}
                      />
                      <span className="text-[17px] font-medium text-muted-foreground">已完成</span>
                      <span className="ml-auto text-[13px] text-muted-foreground">{completed.length}</span>
                    </button>
                    {showCompleted &&
                      completed.map((r) => <ReminderRow key={r.id} r={r} onToggle={toggleDone} onInfo={setEditing} />)}
                  </>
                )}
              </div>
            )
          )}
        </div>
      </div>

      {/* 底部快速新建栏（避开 28px Home 热区） */}
      <div className="absolute inset-x-4 bottom-[34px] z-30">
        <div className="flex items-center gap-3 rounded-full border border-border/60 bg-card px-4 py-3 shadow-lg">
          <Plus className="h-6 w-6 shrink-0 text-muted-foreground/70" strokeWidth={2} />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                createFromDraft();
              }
            }}
            onBlur={() => createFromDraft()}
            placeholder="新提醒"
            aria-label="新提醒"
            className="h-6 w-full bg-transparent text-[17px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      {editing && (
        <ReminderSheet
          key={editing.id}
          reminder={editing}
          onClose={() => setEditing(null)}
          onSave={saveFromSheet}
          onDelete={deleteFromSheet}
        />
      )}
    </div>
  );
}
