'use client';

/**
 * 主动发消息设置页（Task 49 / Task 50 美化）——聊天设置二级页（微信/QQ/信息三端共用）：
 * ① 定时触发：开关 + 间隔档位（30秒~24小时 + 自定义秒/分/时）
 * ② 事件触发：事件清单（名称 + 可选时间 HH:mm + 星期几 + 启用开关），增删改
 * ③ 自主触发：开关（AI 自己决定发不发/何时发/发什么）
 * ④ 定时提醒任务：自然语言解析产生的任务清单（到点 AI 自动发消息），可删除
 *
 * 视觉（Task 50）：iOS 毛玻璃胶囊风——玻璃卡片（backdrop-blur + 半透明白）、彩色渐变图标瓷砖、
 * 胶囊 chips/按钮、状态呼吸灯、弹窗毛玻璃卡 + rAF 进出场动画（与 IOSActionSheet 同一套曲线）。
 *
 * 自包含数据读写（@/lib/ios/proactive-msg 的 cfg/reminders API），宿主只需传 variant/contactId/contactName。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BellRing, CalendarClock, Check, ChevronLeft, Clock3, Plus, Sparkles, Timer, Trash2, Zap } from 'lucide-react';
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

/** iOS 弹层曲线（与 IOSActionSheet 一致） */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** 空事件草稿 */
function emptyEvent(): ProactiveEvent {
  return { id: genId(), name: '', time: '', days: [], enabled: true };
}

/** iOS 设置风彩色渐变图标瓷砖 */
function IconTile({ children, gradient, glow }: { children: ReactNode; gradient: string; glow?: string }) {
  return (
    <span
      aria-hidden
      className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8.5px] text-white"
      style={{ background: gradient, boxShadow: glow ? `0 3px 10px ${glow}` : undefined }}
    >
      {children}
    </span>
  );
}

/**
 * 毛玻璃居中弹窗：半透明玻璃卡 + backdrop-blur + rAF 驱动进出场（scale 0.92→1 + fade，
 * 260ms iOS 曲线）；遮罩带轻模糊，点击遮罩关闭。
 */
function GlassModal({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    let timer = 0;
    if (open) {
      raf1 = requestAnimationFrame(() => {
        setMounted(true);
        raf2 = requestAnimationFrame(() => setShown(true));
      });
    } else {
      raf1 = requestAnimationFrame(() => {
        setShown(false);
        timer = window.setTimeout(() => setMounted(false), 230);
      });
    }
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(timer);
    };
  }, [open]);

  if (!mounted) return null;
  return (
    <div className="absolute inset-0 z-[60] grid place-items-center p-6" role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        aria-label="关闭弹窗"
        onClick={onClose}
        className={`absolute inset-0 cursor-default bg-black/40 backdrop-blur-[3px] transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        className={`relative w-full max-w-[322px] transition-all duration-[260ms] ${shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-95 opacity-0'}`}
        style={{ transitionTimingFunction: EASE }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="overflow-hidden rounded-[26px] border border-white/60 bg-white/80 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-[#232529]/85 dark:shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        >
          {children}
        </div>
      </div>
    </div>
  );
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

  // 主题 token（与 ChatSettingsPage 一致 + Task 50 玻璃 tokens）
  const pageCls = wx ? 'bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white' : 'bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white';
  const titleCls = wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold';
  const headerH = wx ? 'h-11' : 'h-12';
  const testPrefix = variant;
  const accent = wx ? '#07C160' : variant === 'sms' ? '#34C759' : '#0099FF';

  // 毛玻璃 tokens
  const glassCard =
    'rounded-[18px] border border-white/60 bg-white/70 shadow-[0_10px_34px_rgba(0,0,0,0.07)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.055] dark:shadow-[0_10px_34px_rgba(0,0,0,0.35)]';
  const chipIdle = 'bg-black/[0.06] dark:bg-white/[0.1]';
  const fieldCls =
    'h-11 w-full min-w-0 rounded-full border border-black/[0.07] bg-white/70 px-4 text-[15px] shadow-inner outline-none backdrop-blur placeholder:text-black/25 focus:border-black/25 dark:border-white/[0.1] dark:bg-white/[0.07] dark:placeholder:text-white/25 dark:focus:border-white/35';
  const rowCls = 'flex w-full items-center justify-between px-4 py-3 text-left text-[15.5px]';

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

  const isActive = cfg ? cfgHasActiveTrigger(cfg) || reminders.length > 0 : false;

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

  /** 胶囊 chip 公共样式 */
  const chipCls = 'rounded-full px-3.5 py-1.5 text-[13px] transition-all duration-200 active:scale-95';

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
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col overflow-hidden ${pageCls}`}>
      {/* 背景装饰光斑（让毛玻璃有内容可透） */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-14 -top-8 h-48 w-48 rounded-full blur-3xl" style={{ background: `${accent}30` }} />
        <div className="absolute -left-20 top-48 h-52 w-52 rounded-full blur-3xl" style={{ background: '#AF52DE1c' }} />
        <div className="absolute -right-10 bottom-16 h-44 w-44 rounded-full blur-3xl" style={{ background: '#FF95001f' }} />
        <div className="absolute -left-12 bottom-48 h-40 w-40 rounded-full blur-3xl" style={{ background: `${accent}18` }} />
      </div>

      {/* 顶栏 */}
      <div className="relative z-10 shrink-0 pt-[54px]">
        <div className={`flex ${headerH} items-center px-2`}>
          <button type="button" aria-label="返回" data-testid={`${testPrefix}-proactive-back`} onClick={onBack} className={`flex items-center rounded-full px-1 active:opacity-50 ${wx ? '' : 'p-1'}`}>
            <ChevronLeft className={wx ? 'h-7 w-7' : 'h-6 w-6'} strokeWidth={2.2} />
          </button>
          <div className={`flex-1 pr-8 text-center ${titleCls}`}>主动发消息</div>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-10 pt-2">
        {/* 状态头（毛玻璃胶囊） */}
        <div className={`${glassCard} mb-3.5 flex items-center gap-3 rounded-[20px] px-4 py-3`}>
          <span
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white"
            style={{ background: `linear-gradient(135deg, ${accent}, ${accent}b3)`, boxShadow: `0 6px 18px ${accent}45` }}
          >
            <Zap className="h-[22px] w-[22px]" strokeWidth={2.1} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium leading-tight">{contactName}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[12px] leading-tight text-black/45 dark:text-white/45">
              {isActive ? (
                <span aria-hidden className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: accent }} />
                  <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: accent }} />
                </span>
              ) : (
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-black/20 dark:bg-white/25" />
              )}
              <span className="truncate">{activeSummary || '未开启，选择下方的触发方式'}</span>
            </p>
          </div>
          {cfgHasActiveTrigger(cfg) && (
            <button
              type="button"
              data-testid={`${testPrefix}-proactive-close-all`}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12.5px] transition-all active:scale-95 ${chipIdle}`}
              onClick={() => {
                update({ timerOn: false, autoOn: false, events: cfg.events.map((e) => ({ ...e, enabled: false })) });
              }}
            >
              全部关闭
            </button>
          )}
        </div>

        {/* ① 定时触发 */}
        <div className={`${glassCard} overflow-hidden`}>
          <div className={rowCls}>
            <span className="flex items-center gap-2.5">
              <IconTile gradient={`linear-gradient(135deg, ${accent}, ${accent}c4)`} glow={`${accent}55`}>
                <Timer className="h-[15px] w-[15px]" strokeWidth={2.4} />
              </IconTile>
              <span>
                <span className="block text-[15.5px] leading-tight">定时发消息</span>
                <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">每隔一段时间主动找你</span>
              </span>
            </span>
            <ChatToggle on={cfg.timerOn} onChange={(v) => update({ timerOn: v })} accent={accent} testId={`${testPrefix}-proactive-timer`} label="定时发消息" />
          </div>
          {cfg.timerOn && (
            <div className="border-t px-4 py-3.5" style={{ borderColor: 'inherit' }}>
              <p className="mb-2.5 text-[12px] text-black/40 dark:text-white/40">主动发消息间隔</p>
              <div className="flex flex-wrap gap-2">
                {TIMER_PRESETS.map((ms) => (
                  <button
                    key={ms}
                    type="button"
                    data-testid={`${testPrefix}-proactive-timer-${ms}`}
                    onClick={() => update({ timerMs: ms })}
                    className={`${chipCls} ${cfg.timerMs === ms ? '' : chipIdle}`}
                    style={
                      cfg.timerMs === ms
                        ? { background: accent, color: '#fff', boxShadow: `0 4px 14px ${accent}55` }
                        : undefined
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
                  className={`${chipCls} ${!isPreset ? '' : chipIdle}`}
                  style={!isPreset ? { background: accent, color: '#fff', boxShadow: `0 4px 14px ${accent}55` } : undefined}
                >
                  自定义
                </button>
              </div>
              <p className="mt-2.5 text-[12px] leading-relaxed text-black/35 dark:text-white/35">
                当前：每隔{intervalLabel(cfg.timerMs)}，到点 {contactName} 会按人设和近况主动给你发消息
              </p>
            </div>
          )}
        </div>

        {/* ② 事件触发 */}
        <div className={`${glassCard} mt-3 overflow-hidden`}>
          <div className={rowCls}>
            <span className="flex items-center gap-2.5">
              <IconTile gradient="linear-gradient(135deg, #FF9500, #FF6A00)" glow="rgba(255,149,0,0.4)">
                <CalendarClock className="h-[15px] w-[15px]" strokeWidth={2.4} />
              </IconTile>
              <span>
                <span className="block text-[15.5px] leading-tight">事件触发</span>
                <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">到条件时间结合事件开口</span>
              </span>
            </span>
            <button
              type="button"
              data-testid={`${testPrefix}-proactive-event-add`}
              className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] transition-all active:scale-95"
              style={{ background: `${accent}1c`, color: accent }}
              onClick={() => {
                setEvtDraft(emptyEvent());
                setEvtIsNew(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
              添加
            </button>
          </div>
          {cfg.events.length > 0 && (
            <div className="flex flex-col gap-2 px-3 pb-3">
              {cfg.events.map((e) => (
                <div key={e.id} className="rounded-[14px] bg-black/[0.035] px-3 py-2.5 dark:bg-white/[0.055]">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      data-testid={`${testPrefix}-proactive-event-edit-${e.id}`}
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setEvtDraft({ ...e, days: [...e.days] });
                        setEvtIsNew(false);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`truncate text-[15px] ${e.enabled ? '' : 'opacity-40'}`}>{e.name || '未命名事件'}</span>
                        {!e.enabled && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${chipIdle}`}>已停用</span>}
                      </span>
                      <span
                        className="mt-1.5 inline-block truncate rounded-full px-2 py-0.5 text-[11px]"
                        style={{ background: `${accent}17`, color: accent }}
                      >
                        {e.time ? `${dayLabel(e.days)} ${e.time}` : dayLabel(e.days)}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-2.5">
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
                        className="text-red-500 transition-all active:scale-90 active:opacity-60"
                        onClick={() => {
                          const next = { ...cfg, events: cfg.events.filter((x) => x.id !== e.id) };
                          setProactiveCfg(app, contactId, next);
                          setCfg(next);
                        }}
                      >
                        <Trash2 className="h-[16px] w-[16px]" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {cfg.events.length === 0 && (
            <p className="px-4 pb-3.5 pt-0.5 text-[12px] leading-relaxed text-black/40 dark:text-white/40">
              如「下班路上」「午休结束」——到条件时间，{contactName} 会结合事件主动发消息
            </p>
          )}
        </div>

        {/* ③ 自主触发 */}
        <div className={`${glassCard} mt-3 overflow-hidden`}>
          <div className={rowCls}>
            <span className="flex items-center gap-2.5">
              <IconTile gradient="linear-gradient(135deg, #AF52DE, #8B2FC9)" glow="rgba(175,82,222,0.4)">
                <Sparkles className="h-[15px] w-[15px]" strokeWidth={2.4} />
              </IconTile>
              <span>
                <span className="block text-[15.5px] leading-tight">AI 自主决定</span>
                <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">想你了就找你，全凭 TA 的心情</span>
              </span>
            </span>
            <ChatToggle on={cfg.autoOn} onChange={(v) => update({ autoOn: v })} accent={accent} testId={`${testPrefix}-proactive-auto`} label="AI 自主决定" />
          </div>
          {cfg.autoOn && (
            <p className="border-t px-4 py-3.5 text-[12px] leading-[1.7] text-black/40 dark:text-white/40" style={{ borderColor: 'inherit' }}>
              不限定时间和事件：{contactName} 会根据 TA 的性格、你们的记忆、最近聊了什么和当前时间，自己决定要不要主动发消息、什么时候发、发什么（约每 5 分钟考虑一次，深夜不会打扰）。
            </p>
          )}
        </div>

        {/* ④ 定时提醒任务（自然语言解析产生） */}
        <div className={`${glassCard} mt-3 overflow-hidden`}>
          <div className={rowCls}>
            <span className="flex items-center gap-2.5">
              <IconTile gradient="linear-gradient(135deg, #FF2D55, #FF5E7A)" glow="rgba(255,45,85,0.35)">
                <BellRing className="h-[15px] w-[15px]" strokeWidth={2.4} />
              </IconTile>
              <span>
                <span className="block text-[15.5px] leading-tight">定时提醒任务</span>
                <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">聊天里说一句就能创建</span>
              </span>
            </span>
            {reminders.length > 0 && (
              <span className="shrink-0 rounded-full px-2.5 py-1 text-[11.5px]" style={{ background: `${accent}17`, color: accent }}>
                {reminders.length} 个
              </span>
            )}
          </div>
          {reminders.length > 0 && (
            <div className="flex flex-col gap-2 px-3 pb-3">
              {reminders.map((r) => (
                <div key={r.id} className="rounded-[14px] bg-black/[0.035] px-3 py-2.5 dark:bg-white/[0.055]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: `${accent}17`, color: accent }}>
                          {r.kind === 'once' ? '一次性' : r.kind === 'daily' ? '每天' : '循环'}
                        </span>
                        <span className="truncate text-[14.5px]">{r.note}</span>
                      </p>
                      <p className="mt-1 truncate text-[12px] text-black/40 dark:text-white/40">
                        {reminderLabel(r)}
                        {typeof r.lastFiredAt === 'number' ? ' · 已执行' : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="删除提醒任务"
                      data-testid={`${testPrefix}-proactive-rem-del-${r.id}`}
                      className="shrink-0 text-red-500 transition-all active:scale-90 active:opacity-60"
                      onClick={() => {
                        removeReminder(app, r.id);
                        setReminders(remindersFor(app, contactId));
                      }}
                    >
                      <Trash2 className="h-[16px] w-[16px]" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="px-4 pb-3.5 pt-0.5 text-[12px] leading-relaxed text-black/40 dark:text-white/40">
            在聊天里对 {contactName} 说「10分钟后提醒我喝水」「每天晚上10点给我发消息」「每隔1小时发个消息」，会自动创建任务
          </p>
        </div>

        <div className={`${glassCard} mt-3 rounded-[16px] px-4 py-3`}>
          <p className="text-[11.5px] leading-[1.7] text-black/40 dark:text-white/40">
            主动发的消息基于角色人设、记忆、最近聊天和当前时间生成，会像正常聊天一样进入聊天记录并写入记忆；每个角色的设置相互独立，可随时关闭。
          </p>
        </div>
      </div>

      {/* 自定义间隔面板（毛玻璃胶囊弹窗） */}
      <GlassModal open={customOpen} onClose={() => setCustomOpen(false)} label="自定义间隔">
        <div data-testid={`${testPrefix}-proactive-custom-panel`}>
          <div className="flex flex-col items-center">
            <IconTile gradient={`linear-gradient(135deg, ${accent}, ${accent}c4)`} glow={`${accent}55`}>
              <Timer className="h-[15px] w-[15px]" strokeWidth={2.4} />
            </IconTile>
            <p className={`mt-2 ${titleCls}`}>自定义间隔</p>
          </div>
          <div className="mt-4 flex items-center gap-2.5">
            <input
              type="number"
              min="0.1"
              step="any"
              value={customVal}
              onChange={(e) => setCustomVal(e.target.value)}
              data-testid={`${testPrefix}-proactive-custom-input`}
              className={fieldCls}
              placeholder="如 45"
              aria-label="间隔数值"
            />
            <div className={`flex shrink-0 overflow-hidden rounded-full p-0.5 ${chipIdle}`}>
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
                  aria-pressed={customUnit === u}
                  className={`rounded-full px-3 py-1.5 text-[13px] transition-all ${customUnit === u ? 'shadow-sm' : 'opacity-60'}`}
                  style={customUnit === u ? { background: accent, color: '#fff' } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-5 flex gap-2.5">
            <button
              type="button"
              className={`h-10 flex-1 rounded-full text-[14.5px] transition-all active:scale-95 ${chipIdle} text-black/55 dark:text-white/60`}
              onClick={() => setCustomOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              data-testid={`${testPrefix}-proactive-custom-save`}
              className="h-10 flex-1 rounded-full text-[14.5px] font-medium text-white transition-all active:scale-95"
              style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, boxShadow: `0 6px 18px ${accent}4d` }}
              onClick={applyCustomInterval}
            >
              保存
            </button>
          </div>
        </div>
      </GlassModal>

      {/* 事件编辑器（毛玻璃胶囊弹窗） */}
      <GlassModal open={!!evtDraft} onClose={() => setEvtDraft(null)} label="编辑事件">
        {evtDraft && (
          <div data-testid={`${testPrefix}-proactive-event-panel`}>
            <div className="flex flex-col items-center">
              <IconTile gradient="linear-gradient(135deg, #FF9500, #FF6A00)" glow="rgba(255,149,0,0.4)">
                <CalendarClock className="h-[15px] w-[15px]" strokeWidth={2.4} />
              </IconTile>
              <p className={`mt-2 ${titleCls}`}>{evtIsNew ? '添加事件' : '编辑事件'}</p>
            </div>
            <div className="mt-4">
              <p className="mb-1.5 text-[12px] text-black/40 dark:text-white/40">事件描述（什么时候 / 什么情境）</p>
              <input
                type="text"
                value={evtDraft.name}
                maxLength={120}
                onChange={(e) => setEvtDraft({ ...evtDraft, name: e.target.value })}
                data-testid={`${testPrefix}-proactive-event-name`}
                className={fieldCls}
                placeholder="例：下班路上 / 周五晚上 / 发工资日"
              />
            </div>
            <div className="mt-3.5">
              <p className="mb-1.5 text-[12px] text-black/40 dark:text-white/40">触发时间（可选，不填不会自动触发）</p>
              <div className="flex items-center gap-2">
                <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/[0.05] dark:bg-white/[0.08]">
                  <Clock3 className="h-[17px] w-[17px] opacity-45" />
                </span>
                <input
                  type="time"
                  value={evtDraft.time}
                  onChange={(e) => setEvtDraft({ ...evtDraft, time: e.target.value })}
                  data-testid={`${testPrefix}-proactive-event-time`}
                  className={fieldCls}
                  aria-label="触发时间"
                />
                {evtDraft.time && (
                  <button
                    type="button"
                    className={`shrink-0 rounded-full px-3 py-2 text-[12.5px] transition-all active:scale-95 ${chipIdle} text-black/45 dark:text-white/45`}
                    onClick={() => setEvtDraft({ ...evtDraft, time: '' })}
                  >
                    清除
                  </button>
                )}
              </div>
            </div>
            <div className="mt-3.5">
              <p className="mb-1.5 text-[12px] text-black/40 dark:text-white/40">重复（不选 = 每天）</p>
              <div className="flex gap-1.5">
                {WEEK_CHIPS.map((w) => {
                  const on = evtDraft.days.includes(w.d);
                  return (
                    <button
                      key={w.d}
                      type="button"
                      data-testid={`${testPrefix}-proactive-event-day-${w.d}`}
                      aria-pressed={on}
                      onClick={() =>
                        setEvtDraft({
                          ...evtDraft,
                          days: on ? evtDraft.days.filter((d) => d !== w.d) : [...evtDraft.days, w.d],
                        })
                      }
                      className={`h-9 flex-1 rounded-full text-[13px] transition-all active:scale-95 ${on ? '' : chipIdle}`}
                      style={on ? { background: accent, color: '#fff', boxShadow: `0 3px 10px ${accent}4d` } : undefined}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                className={`h-10 flex-1 rounded-full text-[14.5px] transition-all active:scale-95 ${chipIdle} text-black/55 dark:text-white/60`}
                onClick={() => setEvtDraft(null)}
              >
                取消
              </button>
              <button
                type="button"
                data-testid={`${testPrefix}-proactive-event-save`}
                className="h-10 flex-1 rounded-full text-[14.5px] font-medium text-white transition-all active:scale-95 disabled:opacity-40"
                style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, boxShadow: `0 6px 18px ${accent}4d` }}
                onClick={saveEvent}
                disabled={!evtDraft.name.trim()}
              >
                保存
              </button>
            </div>
          </div>
        )}
      </GlassModal>
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
