'use client';

/**
 * 主动发消息设置页（Task 49 / Task 50 毛玻璃 / Task 51 规则完善+二次美化）——聊天设置二级页（微信/QQ/信息三端共用）：
 * ① 定时触发：开关 + 双模式（按间隔 30秒~24小时+自定义 ｜ 每天定时=钟表时刻滚轮），到点 AI 按人设/近况发消息
 * ② 事件触发：事件清单（名称 + 准时触发/仅情境 + 星期几 + 启用开关 + 立即发一条），增删改 + 同名查重
 * ③ 自主触发：开关（AI 自己决定发不发/何时发/发什么）+ 决策频率档位
 * ④ 定时提醒任务：自然语言解析产生的任务清单（到点 AI 自动发消息；迟到也补发并标注「来晚了」）
 * ⑤ 最近主动消息：每角色最近 20 条主动发送记录回看
 *
 * 视觉：iOS 毛玻璃胶囊风·简约——玻璃卡片、彩色渐变图标瓷砖、胶囊 chips/按钮、状态呼吸灯、
 * 时/分滚轮选择器（iOS picker 风）、弹窗毛玻璃卡 + rAF 进出场动画（与 IOSActionSheet 同一套曲线）。
 *
 * 自包含数据读写（@/lib/ios/proactive-msg 的 cfg/reminders/hist API），宿主只需传 variant/contactId/contactName。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BellRing, CalendarClock, Check, ChevronLeft, History, Plus, Send, Sparkles, Timer, Trash2, Zap } from 'lucide-react';
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
  histTimeLabel,
  proactiveHistory,
  manuallyFireEvent,
  isProactiveMasterOff,
  setProactiveMasterOff,
  type ProactiveApp,
  type ProactiveEvent,
  type ProactiveMsgConfig,
  type ProactiveReminder,
  type ProactiveHistEntry,
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

/** 自主决策频率档位（分钟） */
const AUTO_FREQ_PRESETS: number[] = [3, 5, 10, 15, 30];

const WEEK_CHIPS: { d: number; label: string }[] = [
  { d: 1, label: '一' },
  { d: 2, label: '二' },
  { d: 3, label: '三' },
  { d: 4, label: '四' },
  { d: 5, label: '五' },
  { d: 6, label: '六' },
  { d: 0, label: '日' },
];

const HOURS: number[] = Array.from({ length: 24 }, (_, i) => i);
const MINUTES: number[] = Array.from({ length: 60 }, (_, i) => i);

/** iOS 弹层曲线（与 IOSActionSheet 一致） */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** 空事件草稿 */
function emptyEvent(): ProactiveEvent {
  return { id: genId(), name: '', time: '12:00', days: [], enabled: true };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

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
 * 毛玻璃居中弹窗：半透明玻璃卡 + backdrop-blur + rAF 驱动进出场（scale 0.95→1 + fade，
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
          className="overflow-hidden rounded-[26px] border border-white/60 bg-white/80 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur-2xl dark:border-white/[0.09] dark:bg-[#232529]/85 dark:shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** iOS picker 风滚轮列（时/分）：scroll-snap + 滚动选中 + 中心毛玻璃选中胶囊 + 上下渐隐 */
function WheelColumn({
  values,
  value,
  onChange,
  unit,
  testId,
}: {
  values: number[];
  value: number;
  onChange: (v: number) => void;
  unit: string;
  testId?: string;
}) {
  const ITEM_H = 40;
  const ref = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState(() => Math.max(0, values.indexOf(value)));
  const selRef = useRef(sel);

  // 挂载时定位到当前值
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = selRef.current * ITEM_H;
  }, []);

  const handleScroll = (): void => {
    const el = ref.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / ITEM_H)));
    if (idx !== selRef.current) {
      selRef.current = idx;
      setSel(idx);
      onChange(values[idx]);
    }
  };

  return (
    <div className="relative h-[136px] min-w-0 flex-1 overflow-hidden rounded-[18px] border border-black/[0.05] bg-white/50 dark:border-white/[0.08] dark:bg-white/[0.045]">
      {/* 中心选中胶囊（垫底，文字浮在上面 = iOS picker 观感） */}
      <div
        aria-hidden
        className="absolute inset-x-1.5 top-1/2 z-0 h-[40px] -translate-y-1/2 rounded-[12px] border border-black/[0.06] bg-white/70 shadow-[0_1px_6px_rgba(0,0,0,0.05)] dark:border-white/10 dark:bg-white/[0.09]"
      />
      <div
        ref={ref}
        onScroll={handleScroll}
        data-testid={testId}
        className="relative z-10 h-full snap-y snap-mandatory overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div style={{ height: (136 - ITEM_H) / 2 }} aria-hidden />
        {values.map((v, i) => (
          <button
            key={v}
            type="button"
            data-v={v}
            aria-label={`${v}${unit}`}
            onClick={() => {
              const el = ref.current;
              if (el) el.scrollTo({ top: i * ITEM_H, behavior: 'smooth' });
            }}
            className={`flex h-[40px] w-full snap-center items-center justify-center text-[17px] tabular-nums transition-opacity duration-150 ${
              i === sel ? 'font-semibold opacity-100' : 'opacity-30'
            }`}
          >
            {pad2(v)}
            <span className="ml-0.5 text-[10.5px] font-normal opacity-70">{unit}</span>
          </button>
        ))}
        <div style={{ height: (136 - ITEM_H) / 2 }} aria-hidden />
      </div>
      {/* 上下渐隐 */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[28px] bg-gradient-to-b from-white/90 to-transparent dark:from-[#202226]/95" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[28px] bg-gradient-to-t from-white/90 to-transparent dark:to-[#202226]/95" />
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

  // 主题 token（与 ChatSettingsPage 一致 + 玻璃 tokens）
  const pageCls = wx ? 'bg-[#EDEDED] text-black dark:bg-[#111111] dark:text-white' : 'bg-[#F5F6F8] text-[#1F2329] dark:bg-[#16171A] dark:text-white';
  const titleCls = wx ? 'text-[17px] font-medium' : 'text-[17px] font-semibold';
  const headerH = wx ? 'h-11' : 'h-12';
  const testPrefix = variant;
  const accent = wx ? '#07C160' : variant === 'sms' ? '#34C759' : '#0099FF';

  // 毛玻璃 tokens（Task 51 二次美化：更轻的阴影与边框，更简约）
  const glassCard =
    'rounded-[18px] border border-white/55 bg-white/65 shadow-[0_6px_22px_rgba(0,0,0,0.05)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.05] dark:shadow-[0_8px_28px_rgba(0,0,0,0.3)]';
  const chipIdle = 'bg-black/[0.055] dark:bg-white/[0.09]';
  const fieldCls =
    'h-11 w-full min-w-0 rounded-full border border-black/[0.06] bg-white/65 px-4 text-[15px] outline-none backdrop-blur placeholder:text-black/25 focus:border-black/25 dark:border-white/[0.1] dark:bg-white/[0.065] dark:placeholder:text-white/25 dark:focus:border-white/35';
  const rowCls = 'flex w-full items-center justify-between px-4 py-3 text-left text-[15.5px]';
  const chipCls = 'rounded-full px-3.5 py-1.5 text-[13px] transition-all duration-200 active:scale-95';
  const miniCard = 'rounded-[14px] bg-black/[0.032] px-3 py-2.5 dark:bg-white/[0.05]';

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
  const [hist, setHist] = useState<ProactiveHistEntry[]>(() => {
    try {
      return proactiveHistory(app, contactId);
    } catch {
      return [];
    }
  });
  /** 提醒/历史清单轻轮询（NL 解析可能在本页打开时于聊天里创建任务；4s 刷新足够） */
  useEffect(() => {
    const t = window.setInterval(() => {
      setReminders(remindersFor(app, contactId));
      setHist(proactiveHistory(app, contactId));
    }, 4_000);
    return () => window.clearInterval(t);
  }, [app, contactId]);

  /** 写穿并同步本地态 */
  const update = (patch: Partial<ProactiveMsgConfig>): void => {
    setCfg((prev) => {
      const next = {
        ...(prev ?? { timerOn: false, timerMode: 'interval' as const, timerMs: 300_000, timerDailyTime: '', events: [], autoOn: false, autoFreqMin: 5 }),
        ...patch,
      };
      setProactiveCfg(app, contactId, next);
      return next;
    });
  };

  // 自定义间隔面板
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal] = useState('5');
  const [customUnit, setCustomUnit] = useState<'s' | 'm' | 'h'>('m');
  const isPreset = cfg ? TIMER_PRESETS.includes(cfg.timerMs) : true;

  // 每天定时时刻拨盘
  const [dialOpen, setDialOpen] = useState(false);
  const [dialH, setDialH] = useState(9);
  const [dialM, setDialM] = useState(0);

  // 事件编辑器
  const [evtDraft, setEvtDraft] = useState<ProactiveEvent | null>(null);
  const [evtIsNew, setEvtIsNew] = useState(false);
  const [evtErr, setEvtErr] = useState('');

  const activeSummary = useMemo(() => {
    if (!cfg) return '';
    const parts: string[] = [];
    if (cfg.timerOn) parts.push(cfg.timerMode === 'daily' && cfg.timerDailyTime ? `每天 ${cfg.timerDailyTime}` : '定时');
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
    update({ timerMs: Math.min(ms, 7 * 24 * 3600_000), timerMode: 'interval' });
    setCustomOpen(false);
  };

  const saveEvent = (): void => {
    if (!cfg || !evtDraft) return;
    const name = evtDraft.name.trim();
    if (!name) return;
    if (cfg.events.some((x) => x.id !== evtDraft.id && x.name.trim() === name)) {
      setEvtErr('已有同名事件，换一个名字吧');
      return;
    }
    const days = evtDraft.days.length === 7 ? [] : evtDraft.days; // 全选 = 每天（存空数组）
    const next = { ...cfg, events: [...cfg.events.filter((e) => e.id !== evtDraft.id), { ...evtDraft, name: name.slice(0, 120), days }] };
    setProactiveCfg(app, contactId, next);
    setCfg(next);
    setEvtDraft(null);
  };

  const kindLabel = (k: ProactiveHistEntry['kind']): string => (k === 'timer' ? '定时' : k === 'event' ? '事件' : k === 'reminder' ? '提醒' : '自主');

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

  const timerMode = cfg.timerMode === 'daily' ? 'daily' : 'interval';
  const evtTimeOn = !!evtDraft?.time;
  const evtH = evtDraft?.time ? Number(evtDraft.time.slice(0, 2)) : 12;
  const evtM = evtDraft?.time ? Number(evtDraft.time.slice(3)) : 0;

  return (
    <div className={`absolute inset-0 z-50 flex h-full w-full flex-col overflow-hidden ${pageCls}`}>
      {/* 背景装饰光斑（让毛玻璃有内容可透；低饱和更简约） */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-14 -top-8 h-48 w-48 rounded-full blur-3xl" style={{ background: `${accent}26` }} />
        <div className="absolute -left-20 top-48 h-52 w-52 rounded-full blur-3xl" style={{ background: '#AF52DE17' }} />
        <div className="absolute -right-10 bottom-16 h-44 w-44 rounded-full blur-3xl" style={{ background: '#FF950019' }} />
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
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white"
            style={{ background: `linear-gradient(135deg, ${accent}, ${accent}b3)`, boxShadow: `0 4px 14px ${accent}3d` }}
          >
            <Zap className="h-5 w-5" strokeWidth={2.1} />
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
              <IconTile gradient={`linear-gradient(135deg, ${accent}, ${accent}c4)`} glow={`${accent}4d`}>
                <Timer className="h-[15px] w-[15px]" strokeWidth={2.4} />
              </IconTile>
              <span>
                <span className="block text-[15.5px] leading-tight">定时发消息</span>
                <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">按间隔或每天固定时刻主动找你</span>
              </span>
            </span>
            <ChatToggle on={cfg.timerOn} onChange={(v) => update({ timerOn: v })} accent={accent} testId={`${testPrefix}-proactive-timer`} label="定时发消息" />
          </div>
          {cfg.timerOn && (
            <div className="border-t px-4 py-3.5" style={{ borderColor: 'inherit' }}>
              {/* 模式切换（胶囊分段） */}
              <div className={`mb-3 flex rounded-full p-0.5 ${chipIdle}`}>
                {(
                  [
                    ['interval', '按间隔'],
                    ['daily', '每天定时'],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    data-testid={`${testPrefix}-proactive-timermode-${m}`}
                    aria-pressed={timerMode === m}
                    onClick={() => update({ timerMode: m })}
                    className={`flex-1 rounded-full py-1.5 text-[13px] transition-all ${timerMode === m ? 'shadow-sm' : 'opacity-55'}`}
                    style={timerMode === m ? { background: accent, color: '#fff' } : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {timerMode === 'interval' ? (
                <>
                  <p className="mb-2.5 text-[12px] text-black/40 dark:text-white/40">主动发消息间隔</p>
                  <div className="flex flex-wrap gap-2">
                    {TIMER_PRESETS.map((ms) => (
                      <button
                        key={ms}
                        type="button"
                        data-testid={`${testPrefix}-proactive-timer-${ms}`}
                        onClick={() => update({ timerMs: ms })}
                        className={`${chipCls} ${cfg.timerMs === ms ? '' : chipIdle}`}
                        style={cfg.timerMs === ms ? { background: accent, color: '#fff', boxShadow: `0 3px 12px ${accent}4d` } : undefined}
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
                      style={!isPreset ? { background: accent, color: '#fff', boxShadow: `0 3px 12px ${accent}4d` } : undefined}
                    >
                      自定义
                    </button>
                  </div>
                  <p className="mt-2.5 text-[12px] leading-relaxed text-black/35 dark:text-white/35">
                    当前：每隔{intervalLabel(cfg.timerMs)}，到点 {contactName} 会按人设和近况主动给你发消息
                  </p>
                </>
              ) : (
                <>
                  <p className="mb-2 text-[12px] text-black/40 dark:text-white/40">每天在这个时刻给你发一条</p>
                  <button
                    type="button"
                    data-testid={`${testPrefix}-proactive-timer-dailytime`}
                    onClick={() => {
                      const t = cfg.timerDailyTime || '09:00';
                      setDialH(Number(t.slice(0, 2)));
                      setDialM(Number(t.slice(3)));
                      setDialOpen(true);
                    }}
                    className="flex w-full items-center justify-between rounded-[14px] bg-black/[0.032] px-3.5 py-3 transition-all active:scale-[0.99] dark:bg-white/[0.05]"
                  >
                    <span className="text-[13.5px] text-black/55 dark:text-white/55">{cfg.timerDailyTime ? '发送时刻' : '选择时刻'}</span>
                    <span className="text-[22px] font-semibold tabular-nums leading-none" style={{ color: cfg.timerDailyTime ? accent : undefined, opacity: cfg.timerDailyTime ? 1 : 0.35 }}>
                      {cfg.timerDailyTime || '--:--'}
                    </span>
                  </button>
                  <p className="mt-2 text-[12px] leading-relaxed text-black/35 dark:text-white/35">
                    对齐钟表时间（错过几分钟内仍会补发）；{cfg.timerDailyTime ? `每天 ${cfg.timerDailyTime} ${contactName} 会主动给你发消息` : `选好时刻后，${contactName} 每天都会准时报到`}
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/* ② 事件触发 */}
        <div className={`${glassCard} mt-3 overflow-hidden`}>
          <div className={rowCls}>
            <span className="flex items-center gap-2.5">
              <IconTile gradient="linear-gradient(135deg, #FF9500, #FF6A00)" glow="rgba(255,149,0,0.35)">
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
              style={{ background: `${accent}1a`, color: accent }}
              onClick={() => {
                setEvtDraft(emptyEvent());
                setEvtIsNew(true);
                setEvtErr('');
              }}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
              添加
            </button>
          </div>
          {cfg.events.length > 0 && (
            <div className="flex flex-col gap-2 px-3 pb-3">
              {cfg.events.map((e) => (
                <div key={e.id} className={miniCard}>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      data-testid={`${testPrefix}-proactive-event-edit-${e.id}`}
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setEvtDraft({ ...e, days: [...e.days] });
                        setEvtIsNew(false);
                        setEvtErr('');
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`truncate text-[15px] ${e.enabled ? '' : 'opacity-40'}`}>{e.name || '未命名事件'}</span>
                        {!e.enabled && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${chipIdle}`}>已停用</span>}
                      </span>
                      <span className="mt-1.5 inline-block truncate rounded-full px-2 py-0.5 text-[11px]" style={{ background: `${accent}15`, color: accent }}>
                        {e.time ? `${dayLabel(e.days)} ${e.time}` : `${dayLabel(e.days)} · 仅情境`}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        aria-label="立即发一条"
                        data-testid={`${testPrefix}-proactive-event-fire-${e.id}`}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full transition-all active:scale-90"
                        style={{ background: `${accent}15`, color: accent }}
                        onClick={() => {
                          void manuallyFireEvent(app, contactId, e.id).then(() => setHist(proactiveHistory(app, contactId)));
                        }}
                      >
                        <Send className="h-[13.5px] w-[13.5px]" strokeWidth={2.2} />
                      </button>
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
                        className="shrink-0 text-red-500 transition-all active:scale-90 active:opacity-60"
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
              <IconTile gradient="linear-gradient(135deg, #AF52DE, #8B2FC9)" glow="rgba(175,82,222,0.35)">
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
            <div className="border-t px-4 py-3.5" style={{ borderColor: 'inherit' }}>
              <p className="text-[12px] leading-[1.7] text-black/40 dark:text-white/40">
                不限定时间和事件：{contactName} 会根据 TA 的性格、你们的记忆、最近聊了什么和当前时间，自己决定要不要主动发消息、什么时候发、发什么（深夜不会打扰）。
              </p>
              <p className="mb-2 mt-3 text-[12px] text-black/40 dark:text-white/40">考虑频率（多久琢磨一次要不要找你）</p>
              <div className="flex flex-wrap gap-2">
                {AUTO_FREQ_PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    data-testid={`${testPrefix}-proactive-autofreq-${m}`}
                    onClick={() => update({ autoFreqMin: m })}
                    className={`${chipCls} ${(cfg.autoFreqMin ?? 5) === m ? '' : chipIdle}`}
                    style={(cfg.autoFreqMin ?? 5) === m ? { background: accent, color: '#fff', boxShadow: `0 3px 12px ${accent}4d` } : undefined}
                  >
                    {m}分钟
                  </button>
                ))}
              </div>
              <p className="mt-2.5 text-[12px] leading-relaxed text-black/35 dark:text-white/35">
                当前：约每 {cfg.autoFreqMin ?? 5} 分钟考虑一次（正在聊天时不打扰）
              </p>
            </div>
          )}
        </div>

        {/* ④ 定时提醒任务（自然语言解析产生） */}
        <div className={`${glassCard} mt-3 overflow-hidden`}>
          <div className={rowCls}>
            <span className="flex items-center gap-2.5">
              <IconTile gradient="linear-gradient(135deg, #FF2D55, #FF5E7A)" glow="rgba(255,45,85,0.3)">
                <BellRing className="h-[15px] w-[15px]" strokeWidth={2.4} />
              </IconTile>
              <span>
                <span className="block text-[15.5px] leading-tight">定时提醒任务</span>
                <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">聊天里说一句就能创建</span>
              </span>
            </span>
            {reminders.length > 0 && (
              <span className="shrink-0 rounded-full px-2.5 py-1 text-[11.5px]" style={{ background: `${accent}15`, color: accent }}>
                {reminders.length} 个
              </span>
            )}
          </div>
          {reminders.length > 0 && (
            <div className="flex flex-col gap-2 px-3 pb-3">
              {reminders.map((r) => (
                <div key={r.id} className={miniCard}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: `${accent}15`, color: accent }}>
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
            在聊天里对 {contactName} 说「10分钟后提醒我喝水」「每天晚上10点给我发消息」「每隔1小时发个消息」，会自动创建任务（错过了也会补发）
          </p>
        </div>

        {/* ⑤ 最近主动消息（Task 51 C2） */}
        {hist.length > 0 && (
          <div className={`${glassCard} mt-3 overflow-hidden`}>
            <div className={rowCls}>
              <span className="flex items-center gap-2.5">
                <IconTile gradient="linear-gradient(135deg, #8E8E93, #63666B)">
                  <History className="h-[15px] w-[15px]" strokeWidth={2.4} />
                </IconTile>
                <span>
                  <span className="block text-[15.5px] leading-tight">最近主动消息</span>
                  <span className="mt-0.5 block text-[11.5px] leading-tight text-black/40 dark:text-white/40">TA 最近主动发过什么</span>
                </span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] ${chipIdle}`}>{hist.length} 条</span>
            </div>
            <div className="flex flex-col gap-2 px-3 pb-3">
              {hist.map((h, i) => (
                <div key={`${h.at}-${i}`} className={miniCard}>
                  <p className="text-[14px] leading-snug">{h.text}</p>
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-black/40 dark:text-white/40">
                    <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: `${accent}15`, color: accent }}>
                      {kindLabel(h.kind)}
                    </span>
                    {h.late && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">来晚了</span>}
                    <span className="truncate">{histTimeLabel(h.at)}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={`${glassCard} mt-3 rounded-[16px] px-4 py-3`}>
          <p className="text-[11.5px] leading-[1.7] text-black/40 dark:text-white/40">
            主动发的消息基于角色人设、记忆、最近聊天和当前时间生成，会像正常聊天一样进入聊天记录并写入记忆；每个角色的设置相互独立，可随时关闭。
          </p>
        </div>
      </div>

      {/* 自定义间隔面板（毛玻璃胶囊弹窗） */}
      <GlassModal open={customOpen} onClose={() => setCustomOpen(false)} label="自定义间隔">
        <div data-testid={`${testPrefix}-proactive-custom-panel`}>
          <p className={`text-center ${titleCls}`}>自定义间隔</p>
          <p className="mt-1 text-center text-[12px] text-black/40 dark:text-white/40">每隔多久主动给你发一条</p>
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
              style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, boxShadow: `0 5px 16px ${accent}45` }}
              onClick={applyCustomInterval}
            >
              保存
            </button>
          </div>
        </div>
      </GlassModal>

      {/* 每天定时时刻拨盘（Task 51 B3） */}
      <GlassModal open={dialOpen} onClose={() => setDialOpen(false)} label="每天发送时刻">
        <div data-testid={`${testPrefix}-proactive-timerdial`}>
          <p className={`text-center ${titleCls}`}>每天发送时刻</p>
          <p className="mt-1 text-center text-[12px] text-black/40 dark:text-white/40">
            {contactName} 每天这个时候主动给你发消息
          </p>
          <div className="mt-4 flex gap-2.5">
            <WheelColumn values={HOURS} value={dialH} onChange={setDialH} unit="时" testId={`${testPrefix}-proactive-timerdial-hour`} />
            <WheelColumn values={MINUTES} value={dialM} onChange={setDialM} unit="分" testId={`${testPrefix}-proactive-timerdial-minute`} />
          </div>
          <div className="mt-5 flex gap-2.5">
            <button
              type="button"
              className={`h-10 flex-1 rounded-full text-[14.5px] transition-all active:scale-95 ${chipIdle} text-black/55 dark:text-white/60`}
              onClick={() => setDialOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              data-testid={`${testPrefix}-proactive-timerdial-save`}
              className="h-10 flex-1 rounded-full text-[14.5px] font-medium text-white transition-all active:scale-95"
              style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, boxShadow: `0 5px 16px ${accent}45` }}
              onClick={() => {
                update({ timerMode: 'daily', timerDailyTime: `${pad2(dialH)}:${pad2(dialM)}` });
                setDialOpen(false);
              }}
            >
              保存
            </button>
          </div>
        </div>
      </GlassModal>

      {/* 事件编辑器（毛玻璃胶囊弹窗 + 时/分滚轮） */}
      <GlassModal open={!!evtDraft} onClose={() => setEvtDraft(null)} label="编辑事件">
        {evtDraft && (
          <div data-testid={`${testPrefix}-proactive-event-panel`}>
            <p className={`text-center ${titleCls}`}>{evtIsNew ? '添加事件' : '编辑事件'}</p>
            <div className="mt-3.5">
              <p className="mb-1.5 text-[12px] text-black/40 dark:text-white/40">事件描述（什么时候 / 什么情境）</p>
              <input
                type="text"
                value={evtDraft.name}
                maxLength={120}
                onChange={(e) => {
                  setEvtDraft({ ...evtDraft, name: e.target.value });
                  setEvtErr('');
                }}
                data-testid={`${testPrefix}-proactive-event-name`}
                className={fieldCls}
                placeholder="例：下班路上 / 周五晚上 / 发工资日"
              />
              {evtErr && <p className="mt-1.5 px-1 text-[12px] text-red-500">{evtErr}</p>}
            </div>
            <div className="mt-3.5">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[12px] text-black/40 dark:text-white/40">触发时间</p>
                <div className={`flex rounded-full p-0.5 ${chipIdle}`}>
                  {(
                    [
                      [true, '准时触发'],
                      [false, '仅情境'],
                    ] as const
                  ).map(([on, label]) => (
                    <button
                      key={label}
                      type="button"
                      data-testid={`${testPrefix}-proactive-event-tmode-${on ? 'on' : 'off'}`}
                      aria-pressed={evtTimeOn === on}
                      onClick={() => setEvtDraft({ ...evtDraft, time: on ? evtDraft.time || '12:00' : '' })}
                      className={`rounded-full px-2.5 py-1 text-[11.5px] transition-all ${evtTimeOn === on ? 'shadow-sm' : 'opacity-55'}`}
                      style={evtTimeOn === on ? { background: accent, color: '#fff' } : undefined}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {evtTimeOn ? (
                <div className="flex gap-2.5">
                  <WheelColumn
                    values={HOURS}
                    value={evtH}
                    onChange={(h) => setEvtDraft({ ...evtDraft, time: `${pad2(h)}:${pad2(evtM)}` })}
                    unit="时"
                    testId={`${testPrefix}-proactive-event-hour`}
                  />
                  <WheelColumn
                    values={MINUTES}
                    value={evtM}
                    onChange={(m) => setEvtDraft({ ...evtDraft, time: `${pad2(evtH)}:${pad2(m)}` })}
                    unit="分"
                    testId={`${testPrefix}-proactive-event-minute`}
                  />
                </div>
              ) : (
                <p className="rounded-[14px] bg-black/[0.032] px-3.5 py-2.5 text-[12px] leading-relaxed text-black/40 dark:bg-white/[0.05] dark:text-white/40">
                  不设具体时间：不会自动触发，仅作为情境记录；开启「AI 自主决定」后，TA 会把它当作生活里的安排作参考。
                </p>
              )}
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
                      style={on ? { background: accent, color: '#fff', boxShadow: `0 3px 10px ${accent}45` } : undefined}
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
                style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, boxShadow: `0 5px 16px ${accent}45` }}
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

/**
 * 全局总开关行（Task 51 B2：三端设置页共用）——一键暂停/恢复所有角色的主动发消息。
 * 行容器不带内边距，由宿主用自身 row 样式包裹。
 */
export function ProactiveMasterRow({
  accent,
  testId,
  className,
  label = 'AI 主动消息',
  sub = '关闭后，所有角色暂停主动给你发消息',
}: {
  accent: string;
  testId: string;
  /** 宿主行样式（如微信设置行的 px-4 py-3） */
  className?: string;
  label?: string;
  sub?: string;
}) {
  const [off, setOff] = useState<boolean>(() => {
    try {
      return isProactiveMasterOff();
    } catch {
      return false;
    }
  });
  return (
    <div className={`flex items-center justify-between ${className ?? 'px-4 py-3'}`}>
      <span className="min-w-0">
        <span className="block truncate text-[16px] leading-tight">{label}</span>
        {sub ? <span className="mt-0.5 block truncate text-[12px] leading-tight text-black/40 dark:text-white/40">{sub}</span> : null}
      </span>
      <span className="shrink-0 pl-3">
        <ChatToggle
          on={!off}
          onChange={(v) => {
            setProactiveMasterOff(!v);
            setOff(!v);
          }}
          accent={accent}
          testId={testId}
          label={label}
        />
      </span>
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
