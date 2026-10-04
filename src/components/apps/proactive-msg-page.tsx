'use client';

/**
 * 主动发消息设置页（Task 49）——聊天设置二级页（微信/QQ/信息三端共用）：
 * ① 定时触发：开关 + 间隔档位（30秒~24小时 + 自定义秒/分/时）
 * ② 事件触发：事件清单（名称 + 可选时间 HH:mm + 星期几 + 启用开关），增删改
 * ③ 自主触发：开关（AI 自己决定发不发/何时发/发什么）
 * ④ 定时提醒任务：自然语言解析产生的任务清单（到点 AI 自动发消息），可删除
 *
 * 自包含数据读写（@/lib/ios/proactive-msg 的 cfg/reminders API），宿主只需传 variant/contactId/contactName。
 */

import { useEffect, useMemo, useState } from 'react';
import { BellRing, CalendarClock, Check, ChevronLeft, Clock3, Plus, Sparkles, Timer, Trash2 } from 'lucide-react';
import { ChatToggle } from './chat-settings';
import {
  getProactiveCfg,
  setProactiveCfg,
  cfgHasActiveTrigger,
  intervalLabel,
  remindersFor,
  removeReminder,
  reminderLabel,
  dayLabel,
  type ProactiveApp,
  type ProactiveEvent,
  type ProactiveMsgConfig,
  type ProactiveReminder,
} from '@/lib/ios/proactive-msg';
import { genId } from '@/lib/ios/db';

/** 定时间隔档位（毫秒）；自定义走输入面板 */
const TIMER_PRESETS: number[] = [
  30_000,
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  3600_000,
  3 * 3600_000,
  6 * 3600_000,
  12 * 3600_000,
  24 * 3600_000,
];

const WEEK_CHIPS: { d: number; label: string }[] = [
  { d: 1, label: '一' },
  { d: 2, label: '二' },
  { d: 3, label: '三' },
  { d: 4, label: '四' },
  { d: 5, label: '五' },
  { d: 6, label: '六' },
  { d: 0, label: '日' },
];

/** 空事件草稿 */
function emptyEvent(): ProactiveEvent {
  return { id: genId(), name: '', time: '', days: [], enabled: true };
}

export function ProactiveMsgPage({
  variant,
  contactId,
  contactName,
  onBack,
}: {
  variant: 'wx' | 'qq' | 'sms';
  contactId: string;
  contactName: string;
  onBack: () => void;
}) {
  const wx = variant === 'wx';
  const app = variant as ProactiveApp;

  // 主题 token（与 ChatSettingsPage 一致）
  const pageCls = wx ? 'bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white' : 'bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white';
  const cardCls = wx ? 'rounded-[10px] bg-white dark:bg-[#1A1A1A]' : 'rounded-[14px] bg-white dark:bg-[#232529]';
  const dividerCls = wx ? 'border-black/5 dark:border-white/10' : 'border-black/[0.04] dark:border-white/[0.06]';
  const rowCls = wx
    ? 'flex w-full items-center justify-between px-4 py-3 text-left text-[16px] active:bg-black/[0.04] dark:active:bg-white/[0.06]'
    : 'flex w-full items-center justify-between px-4 min-h-[54px] text-left text-[15.5px] active:bg-black/[0.03] dark:active:bg-white/[0.05]';
  const accent = wx ? '#07C160' : variant === 'sms' ? '#34C759' : '#0099FF';
  const titleCls = wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold';
  const headerH = wx ? 'h-11' : 'h-12';
  const testPrefix = variant;

  // 配置状态（页面仅在用户交互后挂载 = 纯客户端渲染，直接惰性初始化避免 effect 内 setState；写穿持久化）
  const [cfg, setCfg] = useState<ProactiveMsgConfig | null>(() => {
    try {
      return getProactiveCfg(app, contactId);
    } catch {
      return null;
    }
  });
  const [reminders, setReminders] = useState<ProactiveReminder[]>(() => {
    try {
      return remindersFor(app, contactId);
    } catch {
      return [];
    }
  });
  /** 提醒清单轻轮询（NL 解析可能在本页打开时于聊天里创建任务；4s 刷新足够） */
  useEffect(() => {
    const t = window.setInterval(() => {
      setReminders(remindersFor(app, contactId));
    }, 4_000);
    return () => window.clearInterval(t);
  }, [app, contactId]);

  /** 写穿并同步本地态 */
  const update = (patch: Partial<ProactiveMsgConfig>): void => {
    setCfg((prev) => {
      const next = { ...(prev ?? { timerOn: false, timerMs: 300_000, events: [], autoOn: false }), ...patch };
      setProactiveCfg(app, contactId, next);
      return next;
    });
  };

  // 自定义间隔面板
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal] = useState('5');
  const [customUnit, setCustomUnit] = useState<'s' | 'm' | 'h'>('m');
  const isPreset = cfg ? TIMER_PRESETS.includes(cfg.timerMs) : true;

  // 事件编辑器
  const [evtDraft, setEvtDraft] = useState<ProactiveEvent | null>(null);
  const [evtIsNew, setEvtIsNew] = useState(false);

  const activeSummary = useMemo(() => {
    if (!cfg) return '';
    const parts: string[] = [];
    if (cfg.timerOn) parts.push('定时');
    if (cfg.events.some((e) => e.enabled)) parts.push('事件');
    if (cfg.autoOn) parts.push('自主');
    if (reminders.length > 0) parts.push(`提醒 ${reminders.length}`);
    return parts.join(' · ');
  }, [cfg, reminders.length]);

  const applyCustomInterval = (): void => {
    const n = Number(customVal);
    if (!Number.isFinite(n) || n <= 0) return;
    const ms = Math.max(15_000, Math.round(customUnit === 's' ? n * 1000 : customUnit === 'm' ? n * 60_000 : n * 3600_000));
    update({ timerMs: Math.min(ms, 7 * 24 * 3600_000) });
    setCustomOpen(false);
  };

  const saveEvent = (): void => {
    if (!cfg || !evtDraft) return;
    const name = evtDraft.name.trim();
    if (!name) return;
    const days = evtDraft.days.length === 7 ? [] : evtDraft.days; // 全选 = 每天（存空数组）
    const next = { ...cfg, events: [...cfg.events.filter((e) => e.id !== evtDraft.id), { ...evtDraft, name: name.slice(0, 120), days }] };
    setProactiveCfg(app, contactId, next);
    setCfg(next);
    setEvtDraft(null);
  };

  if (!cfg) {
    return (
      <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${pageCls}`}>
        <div className="shrink-0 pt-[54px]">
          <div className={`flex ${headerH} items-center px-2`}>
            <button type="button" aria-label="返回" data-testid={`${testPrefix}-proactive-back`} onClick={onBack} className={`flex items-center rounded-full px-1 active:opacity-50 ${wx ? '' : 'p-1'}`}>
              <ChevronLeft className={wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
            </button>
            <div className={`flex-1 pr-8 text-center ${titleCls}`}>主动发消息</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col ${pageCls}`}>
      {/* 顶栏 */}
      <div className="shrink-0 pt-[54px]">
        <div className={`flex ${headerH} items-center px-2`}>
          <button type="button" aria-label="返回" data-testid={`${testPrefix}-proactive-back`} onClick={onBack} className={`flex items-center rounded-full px-1 active:opacity-50 ${wx ? '' : 'p-1'}`}>
            <ChevronLeft className={wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${titleCls}`}>主动发消息</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10 pt-2">
        {/* 说明头 */}
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="text-[12.5px] text-black/40 dark:text-white/40">{contactName} · {activeSummary || '未开启'}</p>
          {cfgHasActiveTrigger(cfg) && (
            <button
              type="button"
              data-testid={`${testPrefix}-proactive-close-all`}
              className="text-[12.5px] active:opacity-50"
              style={{ color: accent }}
              onClick={() => {
                update({ timerOn: false, autoOn: false, events: cfg.events.map((e) => ({ ...e, enabled: false })) });
              }}
            >
              全部关闭
            </button>
          )}
        </div>

        {/* ① 定时触发 */}
        <div className={`${cardCls} overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span className="flex items-center gap-2">
              <Timer className="h-[18px] w-[18px] opacity-60" />
              定时发消息
            </span>
            <ChatToggle on={cfg.timerOn} onChange={(v) => update({ timerOn: v })} accent={accent} testId={`${testPrefix}-proactive-timer`} label="定时发消息" />
          </div>
          {cfg.timerOn && (
            <div className="border-t px-4 py-3" style={{ borderColor: 'inherit' }}>
              <div className={dividerCls ? '' : ''}>
                <p className="mb-2 text-[12.5px] text-black/40 dark:text-white/40">主动发消息间隔</p>
                <div className="flex flex-wrap gap-2">
                  {TIMER_PRESETS.map((ms) => (
                    <button
                      key={ms}
                      type="button"
                      data-testid={`${testPrefix}-proactive-timer-${ms}`}
                      onClick={() => update({ timerMs: ms })}
                      className="rounded-full px-3 py-1.5 text-[13px] transition-colors"
                      style={
                        cfg.timerMs === ms
                          ? { background: accent, color: '#fff' }
                          : { background: 'rgba(120,120,128,0.12)', color: 'inherit' }
                      }
                    >
                      {intervalLabel(ms)}
                    </button>
                  ))}
                  <button
                    type="button"
                    data-testid={`${testPrefix}-proactive-timer-custom`}
                    onClick={() => {
                      setCustomOpen(true);
                      setCustomVal(String(Math.round(cfg.timerMs / 60_000) || 5));
                      setCustomUnit('m');
                    }}
                    className="rounded-full px-3 py-1.5 text-[13px] transition-colors"
                    style={
                      !isPreset
                        ? { background: accent, color: '#fff' }
                        : { background: 'rgba(120,120,128,0.12)', color: 'inherit' }
                    }
                  >
                    自定义
                  </button>
                </div>
                <p className="mt-2 text-[12px] text-black/35 dark:text-white/35">当前：每隔{intervalLabel(cfg.timerMs)}，到点 {contactName} 会按人设和近况主动给你发消息</p>
              </div>
            </div>
          )}
        </div>

        {/* ② 事件触发 */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span className="flex items-center gap-2">
              <CalendarClock className="h-[18px] w-[18px] opacity-60" />
              事件触发
            </span>
            <button
              type="button"
              data-testid={`${testPrefix}-proactive-event-add`}
              className="flex items-center gap-1 rounded-full px-3 py-1 text-[13px]"
              style={{ background: 'rgba(120,120,128,0.12)', color: 'inherit' }}
              onClick={() => {
                setEvtDraft(emptyEvent());
                setEvtIsNew(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              添加
            </button>
          </div>
          {cfg.events.length > 0 && (
            <div className={`border-t ${dividerCls}`}>
              {cfg.events.map((e) => (
                <div key={e.id} className={`border-b last:border-b-0 ${dividerCls}`}>
                  <div className={rowCls}>
                    <button
                      type="button"
                      data-testid={`${testPrefix}-proactive-event-edit-${e.id}`}
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setEvtDraft({ ...e, days: e.days.length === 0 ? [] : [...e.days] });
                        setEvtIsNew(false);
                      }}
                    >
                      <span className="block truncate">{e.name || '未命名事件'}</span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-black/40 dark:text-white/40">
                        {e.time ? `${dayLabel(e.days)} ${e.time}` : dayLabel(e.days)}
                      </span>
                    </button>
                    <div className="ml-2 flex shrink-0 items-center gap-3">
                      <ChatToggle
                        on={e.enabled}
                        onChange={(v) => {
                          const next = { ...cfg, events: cfg.events.map((x) => (x.id === e.id ? { ...x, enabled: v } : x)) };
                          setProactiveCfg(app, contactId, next);
                          setCfg(next);
                        }}
                        accent={accent}
                        testId={`${testPrefix}-proactive-event-on-${e.id}`}
                        label="启用事件"
                      />
                      <button
                        type="button"
                        aria-label="删除事件"
                        data-testid={`${testPrefix}-proactive-event-del-${e.id}`}
                        className="text-red-500 active:opacity-50"
                        onClick={() => {
                          const next = { ...cfg, events: cfg.events.filter((x) => x.id !== e.id) };
                          setProactiveCfg(app, contactId, next);
                          setCfg(next);
                        }}
                      >
                        <Trash2 className="h-[17px] w-[17px]" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {cfg.events.length === 0 && (
            <p className="px-4 pb-3 pt-1 text-[12.5px] text-black/40 dark:text-white/40">如「下班路上」「午休结束」——到条件时间，{contactName} 会结合事件主动发消息</p>
          )}
        </div>

        {/* ③ 自主触发 */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span className="flex items-center gap-2">
              <Sparkles className="h-[18px] w-[18px] opacity-60" />
              AI 自主决定
            </span>
            <ChatToggle on={cfg.autoOn} onChange={(v) => update({ autoOn: v })} accent={accent} testId={`${testPrefix}-proactive-auto`} label="AI 自主决定" />
          </div>
          {cfg.autoOn && (
            <p className="border-t px-4 py-3 text-[12.5px] leading-[1.6] text-black/40 dark:text-white/40" style={{ borderColor: 'inherit' }}>
              不限定时间和事件：{contactName} 会根据 TA 的性格、你们的记忆、最近聊了什么和当前时间，自己决定要不要主动发消息、什么时候发、发什么（约每 5 分钟考虑一次，深夜不会打扰）。
            </p>
          )}
        </div>

        {/* ④ 定时提醒任务（自然语言解析产生） */}
        <div className={`${cardCls} mt-3 overflow-hidden`}>
          <div className={`flex items-center justify-between ${rowCls}`}>
            <span className="flex items-center gap-2">
              <BellRing className="h-[18px] w-[18px] opacity-60" />
              定时提醒任务
            </span>
            <span className="text-[12.5px] text-black/40 dark:text-white/40">{reminders.length > 0 ? `${reminders.length} 个` : ''}</span>
          </div>
          {reminders.length > 0 && (
            <div className={`border-t ${dividerCls}`}>
              {reminders.map((r) => (
                <div key={r.id} className={`flex items-center justify-between border-b px-4 py-3 last:border-b-0 ${dividerCls}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px]">
                      <span style={{ color: accent }}>{reminderLabel(r)}</span>
                      <span className="ml-2">{r.note}</span>
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-black/35 dark:text-white/35">
                      {r.kind === 'once' ? '一次性' : r.kind === 'daily' ? '每天重复' : '循环重复'}
                      {typeof r.lastFiredAt === 'number' ? ' · 已执行' : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="删除提醒任务"
                    data-testid={`${testPrefix}-proactive-rem-del-${r.id}`}
                    className="ml-2 shrink-0 text-red-500 active:opacity-50"
                    onClick={() => {
                      removeReminder(app, r.id);
                      setReminders(remindersFor(app, contactId));
                    }}
                  >
                    <Trash2 className="h-[17px] w-[17px]" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="px-4 pb-3 pt-1 text-[12.5px] text-black/40 dark:text-white/40">在聊天里对 {contactName} 说「10分钟后提醒我喝水」「每天晚上10点给我发消息」「每隔1小时发个消息」，会自动创建任务</p>
        </div>

        <p className="px-1 pt-3 text-[12px] leading-[1.6] text-black/35 dark:text-white/35">
          主动发的消息基于角色人设、记忆、最近聊天和当前时间生成，会像正常聊天一样进入聊天记录并写入记忆；每个角色的设置相互独立，可随时关闭。
        </p>
      </div>

      {/* 自定义间隔面板 */}
      {customOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-8" onClick={() => setCustomOpen(false)}>
          <div className={`${cardCls} w-full max-w-[300px] p-5`} onClick={(e) => e.stopPropagation()} data-testid={`${testPrefix}-proactive-custom-panel`}>
            <p className={`text-center ${titleCls}`}>自定义间隔</p>
            <div className="mt-4 flex items-center gap-2">
              <input
                type="number"
                min="0.1"
                step="any"
                value={customVal}
                onChange={(e) => setCustomVal(e.target.value)}
                data-testid={`${testPrefix}-proactive-custom-input`}
                className="h-10 w-full min-w-0 flex-1 rounded-[10px] border border-black/10 bg-transparent px-3 text-[15px] outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
                placeholder="如 45"
              />
              <div className="flex overflow-hidden rounded-[10px]" style={{ background: 'rgba(120,120,128,0.12)' }}>
                {(
                  [
                    ['s', '秒'],
                    ['m', '分'],
                    ['h', '时'],
                  ] as const
                ).map(([u, label]) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setCustomUnit(u)}
                    className="px-3 py-2 text-[13px]"
                    style={customUnit === u ? { background: accent, color: '#fff' } : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-4">
              <button type="button" className="text-[15px] text-black/50 active:opacity-50 dark:text-white/50" onClick={() => setCustomOpen(false)}>
                取消
              </button>
              <button type="button" data-testid={`${testPrefix}-proactive-custom-save`} className="text-[15px] font-medium active:opacity-50" style={{ color: accent }} onClick={applyCustomInterval}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 事件编辑器 */}
      {evtDraft && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-6" onClick={() => setEvtDraft(null)}>
          <div className={`${cardCls} w-full max-w-[320px] p-5`} onClick={(e) => e.stopPropagation()} data-testid={`${testPrefix}-proactive-event-panel`}>
            <p className={`text-center ${titleCls}`}>{evtIsNew ? '添加事件' : '编辑事件'}</p>
            <div className="mt-4">
              <p className="mb-1.5 text-[12.5px] text-black/40 dark:text-white/40">事件描述（什么时候/什么情境）</p>
              <input
                type="text"
                value={evtDraft.name}
                maxLength={120}
                onChange={(e) => setEvtDraft({ ...evtDraft, name: e.target.value })}
                data-testid={`${testPrefix}-proactive-event-name`}
                className="h-10 w-full rounded-[10px] border border-black/10 bg-transparent px-3 text-[15px] outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
                placeholder="例：下班路上 / 周五晚上 / 发工资日"
              />
            </div>
            <div className="mt-4">
              <p className="mb-1.5 text-[12.5px] text-black/40 dark:text-white/40">触发时间（可选，精确到分钟）</p>
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 opacity-40" />
                <input
                  type="time"
                  value={evtDraft.time}
                  onChange={(e) => setEvtDraft({ ...evtDraft, time: e.target.value })}
                  data-testid={`${testPrefix}-proactive-event-time`}
                  className="h-10 w-full min-w-0 flex-1 rounded-[10px] border border-black/10 bg-transparent px-3 text-[15px] outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
                />
                {evtDraft.time && (
                  <button type="button" className="text-[13px] text-black/40 active:opacity-50 dark:text-white/40" onClick={() => setEvtDraft({ ...evtDraft, time: '' })}>
                    清除
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4">
              <p className="mb-1.5 text-[12.5px] text-black/40 dark:text-white/40">重复（不选 = 每天）</p>
              <div className="flex gap-1.5">
                {WEEK_CHIPS.map((w) => {
                  const on = evtDraft.days.includes(w.d);
                  return (
                    <button
                      key={w.d}
                      type="button"
                      data-testid={`${testPrefix}-proactive-event-day-${w.d}`}
                      onClick={() =>
                        setEvtDraft({
                          ...evtDraft,
                          days: on ? evtDraft.days.filter((d) => d !== w.d) : [...evtDraft.days, w.d],
                        })
                      }
                      className="h-8 flex-1 rounded-full text-[13px]"
                      style={on ? { background: accent, color: '#fff' } : { background: 'rgba(120,120,128,0.12)', color: 'inherit' }}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-4">
              <button type="button" className="text-[15px] text-black/50 active:opacity-50 dark:text-white/50" onClick={() => setEvtDraft(null)}>
                取消
              </button>
              <button type="button" data-testid={`${testPrefix}-proactive-event-save`} className="text-[15px] font-medium active:opacity-50" style={{ color: accent }} onClick={saveEvent} disabled={!evtDraft.name.trim()}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 供设置页入口行展示的选中态小图标（未选中不渲染） */
export function ProactiveActiveDot({ accent }: { accent: string }) {
  return (
    <span className="grid place-items-center" style={{ color: accent }} aria-label="已开启">
      <Check className="h-4 w-4" strokeWidth={2.4} />
    </span>
  );
}
