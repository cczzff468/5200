'use client';

/**
 * 聊天输入框自定义 · 设置面板（本轮新增）
 * ---------------------------------------------------------------------------
 * 位置：主题页 › 主题 Tab ›「输入框」区块（液态玻璃设置下方，两种界面主题下都显示——
 *       用户指定「默认主题也可以添加」）。
 * 形态：与液态玻璃设置同款收缩面板，两段可收缩区块（点标题行展开/收起，默认收起，简约）——
 *  1. 输入框文字：自定义不打字时输入框里显示的灰色占位文字（如「♡*·☆ 1314 day with U·+°♡」），
 *     带实时小预览；留空 = App 原生默认。
 *  2. 加号面板功能：勾选「+」面板里显示哪些功能、按什么顺序显示；
 *     支持上移/下移排序与恢复默认。
 *
 * 修改即时写入 useSettings.setChatDecor（App 隔离）并持久化，聊天页实时跟随。
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, ArrowUp, Check, ChevronRight, Keyboard, LayoutGrid, RotateCcw, Type } from 'lucide-react';
import { useSettings } from '@/lib/ios/store';
import {
  DEFAULT_PLUS_KEYS,
  PLUS_FEATURE_LABELS,
  resolvePlusKeys,
  type ChatDecorSettings,
} from '@/lib/ios/chat-decor';
import type { BubbleAppId } from '@/lib/ios/bubble-style';

const PLATFORM_META: Record<BubbleAppId, { name: string; accent: string; inputShape: string }> = {
  wx: { name: '微信', accent: '#07C160', inputShape: 'rounded-[5px]' },
  qq: { name: 'QQ', accent: '#0099FF', inputShape: 'rounded-full' },
  sms: { name: '信息', accent: '#007AFF', inputShape: 'rounded-[18px]' },
};

// ---------------- 收缩区块（与液态玻璃设置同款结构） ----------------

function CollapseSection({
  icon,
  title,
  summary,
  accent,
  open,
  onToggle,
  testId,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  accent: string;
  open: boolean;
  onToggle: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className={open ? 'border-t border-black/[0.05] first:border-t-0 dark:border-white/[0.07]' : 'first:border-t-0'}>
      <button
        type="button"
        data-testid={testId}
        aria-expanded={open}
        onClick={() => {
          onToggle();
          navigator.vibrate?.(6);
        }}
        className="flex w-full items-center gap-2.5 px-4 py-[13px] text-left transition-colors active:bg-black/[0.03] dark:active:bg-white/[0.05]"
      >
        <span
          className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[9px]"
          style={{ backgroundColor: `${accent}1F` }}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-medium leading-tight text-black/85 dark:text-white/90">{title}</span>
          <span className="mt-[2px] block truncate text-[11.5px] leading-tight text-black/40 dark:text-white/40">{summary}</span>
        </span>
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-black/25 transition-transform duration-300 dark:text-white/25 ${open ? 'rotate-90' : ''}`}
          strokeWidth={2.4}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 输入框占位文字实时小预览（一条仿真输入条，灰字实时跟随） */
function PlaceholderPreview({ app, text }: { app: BubbleAppId; text: string }) {
  const meta = PLATFORM_META[app];
  const ph = text.trim();
  return (
    <div className="mt-3 flex h-[38px] items-center rounded-[12px] bg-[#F1F2F6] px-3 dark:bg-[#1B1D22]" data-testid="decor-placeholder-preview">
      <span
        className={`flex h-[28px] min-w-0 flex-1 items-center bg-white px-3 text-[12.5px] leading-none shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:bg-[#2A2C31] dark:shadow-none ${meta.inputShape}`}
      >
        <span className={`truncate ${ph ? 'text-black/35 dark:text-white/35' : 'text-black/25 dark:text-white/25'}`}>
          {ph || (app === 'sms' ? 'iMessage信息' : '未设置（默认空）')}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="ml-2 flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: meta.accent }}
      >
        <span className="h-[7px] w-[7px] rotate-45 border-l-[1.8px] border-t-[1.8px] border-white/95" />
      </span>
    </div>
  );
}

// ================= 主面板 =================

export interface ChatDecorPanelProps {
  /** 宿主 App（自定义完全隔离：本页所有修改只写入 chatDecor[app]） */
  app: BubbleAppId;
  /** 弹一条本地提示 */
  onToast: (m: string) => void;
}

/** 输入框设置 · 收缩面板（嵌在主题页主题 Tab 内，默认/液态两种主题都显示） */
export function ChatDecorPanel({ app, onToast }: ChatDecorPanelProps) {
  const meta = PLATFORM_META[app];
  const chatDecor = useSettings((s) => s.chatDecor);
  const setChatDecor = useSettings((s) => s.setChatDecor);

  const decor: ChatDecorSettings = chatDecor[app];
  /** 两段区块独立收缩（默认全收起，简约） */
  const [sec, setSec] = useState<'placeholder' | 'plus' | null>(null);
  const toggle = (k: 'placeholder' | 'plus') => setSec((v) => (v === k ? null : k));

  const patch = (p: Partial<ChatDecorSettings>) => setChatDecor(app, p);

  /** 加号面板功能：全部功能（默认顺序）+ 是否自定义过 */
  const allKeys = DEFAULT_PLUS_KEYS[app];
  const labels = PLUS_FEATURE_LABELS[app];
  /** 已选顺序（resolvePlusKeys 处理空/脏数据 → 永不为空） */
  const activeKeys = resolvePlusKeys(app, decor.plusKeys);
  const isCustomPlus = decor.plusKeys.length > 0;

  /** 切换一个功能：已选 → 移除；未选 → 追加到末尾（至少保留一项） */
  const togglePlusKey = (key: string) => {
    const has = activeKeys.includes(key);
    if (has && activeKeys.length <= 1) {
      onToast('至少保留一项功能');
      return;
    }
    const next = has ? activeKeys.filter((k) => k !== key) : [...activeKeys, key];
    patch({ plusKeys: next });
    navigator.vibrate?.(6);
  };

  /** 上移/下移已选功能（与相邻项交换位置） */
  const moveKey = (key: string, dir: -1 | 1) => {
    const idx = activeKeys.indexOf(key);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= activeKeys.length) return;
    const next = [...activeKeys];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    patch({ plusKeys: next });
    navigator.vibrate?.(6);
  };

  const placeholderText = decor.inputPlaceholder.trim();

  return (
    <div
      className="overflow-hidden rounded-[18px] bg-white ring-1 ring-black/[0.05] dark:bg-[#1C1E23] dark:ring-white/[0.08]"
      data-testid="chat-decor-panel"
    >
      {/* ---------- 1. 输入框文字 ---------- */}
      <CollapseSection
        testId="decor-sec-placeholder"
        accent={meta.accent}
        icon={<Type className="h-[15px] w-[15px]" style={{ color: meta.accent }} strokeWidth={2.1} aria-hidden="true" />}
        title="输入框文字"
        summary={placeholderText ? `「${placeholderText}」` : '默认'}
        open={sec === 'placeholder'}
        onToggle={() => toggle('placeholder')}
      >
        <label className="block px-1 text-[12px] font-medium text-black/55 dark:text-white/55" htmlFor="decor-placeholder-input">
          不打字时输入框里显示的灰色文字（留空 = 默认）
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            id="decor-placeholder-input"
            data-testid="decor-placeholder-input"
            value={decor.inputPlaceholder}
            onChange={(e) => patch({ inputPlaceholder: e.target.value.slice(0, 30) })}
            placeholder="如 ♡*·☆ 1314 day with U"
            className="h-9 min-w-0 flex-1 rounded-[10px] bg-black/[0.04] px-3 text-[14px] text-black/85 outline-none placeholder:text-black/25 focus:ring-2 focus:ring-black/[0.08] dark:bg-white/[0.08] dark:text-white/90 dark:placeholder:text-white/25 dark:focus:ring-white/[0.12]"
          />
          {decor.inputPlaceholder.length > 0 && (
            <button
              type="button"
              aria-label="恢复默认文字"
              onClick={() => {
                patch({ inputPlaceholder: '' });
                navigator.vibrate?.(6);
              }}
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-black/45 transition active:bg-black/[0.12] dark:bg-white/[0.1] dark:text-white/50 dark:active:bg-white/[0.18]"
            >
              <RotateCcw className="h-[12px] w-[12px]" strokeWidth={2.6} />
            </button>
          )}
        </div>
        <PlaceholderPreview app={app} text={decor.inputPlaceholder} />
        <p className="mt-1.5 px-1 text-[11px] leading-tight text-black/35 dark:text-white/35">
          开启「文字转语音」时优先显示语音提示；{app === 'sms' ? `${meta.name}内同步生效` : `${meta.name}与群聊同步生效`}。
        </p>
      </CollapseSection>

      {/* ---------- 2. 加号面板功能 ---------- */}
      <CollapseSection
        testId="decor-sec-plus"
        accent={meta.accent}
        icon={<LayoutGrid className="h-[15px] w-[15px]" style={{ color: meta.accent }} strokeWidth={2.1} aria-hidden="true" />}
        title="加号面板功能"
        summary={isCustomPlus ? `已选 ${activeKeys.length} / ${allKeys.length} 项` : '默认全部'}
        open={sec === 'plus'}
        onToggle={() => toggle('plus')}
      >
        {/* 已选列表（可排序）：↑ ↓ 调顺序，点名称行取消勾选 */}
        <p className="px-1 text-[12px] font-medium text-black/55 dark:text-white/55">已选功能（点行可移除，箭头调顺序）</p>
        <div className="mt-1.5 overflow-hidden rounded-[12px] bg-black/[0.02] ring-1 ring-black/[0.05] dark:bg-white/[0.04] dark:ring-white/[0.08]" data-testid="decor-plus-active">
          {activeKeys.map((key, i) => (
            <div
              key={key}
              className={`flex items-center gap-2 px-3 py-[9px] ${i > 0 ? 'border-t border-black/[0.04] dark:border-white/[0.06]' : ''}`}
            >
              <button
                type="button"
                aria-label={`移除${labels[key] ?? key}`}
                onClick={() => togglePlusKey(key)}
                className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-white transition active:scale-90"
                style={{ backgroundColor: meta.accent }}
              >
                <Check className="h-[11px] w-[11px]" strokeWidth={3.2} />
              </button>
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/80 dark:text-white/85">{labels[key] ?? key}</span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`${labels[key] ?? key}上移`}
                  disabled={i === 0}
                  onClick={() => moveKey(key, -1)}
                  className="flex h-[24px] w-[24px] items-center justify-center rounded-full bg-black/[0.05] text-black/50 transition active:bg-black/[0.12] disabled:opacity-25 dark:bg-white/[0.08] dark:text-white/55 dark:active:bg-white/[0.16]"
                >
                  <ArrowUp className="h-[13px] w-[13px]" strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  aria-label={`${labels[key] ?? key}下移`}
                  disabled={i === activeKeys.length - 1}
                  onClick={() => moveKey(key, 1)}
                  className="flex h-[24px] w-[24px] items-center justify-center rounded-full bg-black/[0.05] text-black/50 transition active:bg-black/[0.12] disabled:opacity-25 dark:bg-white/[0.08] dark:text-white/55 dark:active:bg-white/[0.16]"
                >
                  <ArrowDown className="h-[13px] w-[13px]" strokeWidth={2.4} />
                </button>
              </span>
            </div>
          ))}
        </div>

        {/* 未选功能：点加回 */}
        {activeKeys.length < allKeys.length && (
          <>
            <p className="mt-2.5 px-1 text-[12px] font-medium text-black/55 dark:text-white/55">未选功能（点加回）</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5 px-1" data-testid="decor-plus-inactive">
              {allKeys.filter((k) => !activeKeys.includes(k)).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => togglePlusKey(key)}
                  className="rounded-full bg-black/[0.04] px-3 py-[6px] text-[12.5px] text-black/55 transition active:bg-black/[0.1] dark:bg-white/[0.07] dark:text-white/60 dark:active:bg-white/[0.14]"
                >
                  + {labels[key] ?? key}
                </button>
              ))}
            </div>
          </>
        )}

        {isCustomPlus && (
          <button
            type="button"
            data-testid="decor-plus-reset"
            onClick={() => {
              patch({ plusKeys: [] });
              onToast('已恢复默认功能');
            }}
            className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] bg-black/[0.04] text-[13px] font-medium text-black/55 transition active:bg-black/[0.09] dark:bg-white/[0.07] dark:text-white/60 dark:active:bg-white/[0.13]"
          >
            <RotateCcw className="h-[13px] w-[13px]" strokeWidth={2.4} aria-hidden="true" />
            恢复默认功能
          </button>
        )}
        <p className="mt-1.5 px-1 text-[11px] leading-tight text-black/35 dark:text-white/35">
          设置输入栏「+」面板里显示哪些功能；至少保留一项。
        </p>
      </CollapseSection>
    </div>
  );
}
