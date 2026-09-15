'use client';

/**
 * 转发内容选择弹层（微信 / QQ 聊天页共用，替代「只转发单条」）：
 * - 第一步「选择转发消息」：整段历史消息（我的 + 对方的）勾选，长按/多选进入时预选触发消息
 * - 第二步选择发送方式：逐条转发（每条克隆成独立消息） / 合并转发（合成一张「聊天记录」卡片）
 * - 第三步「转发给」：目标会话（好友 + 自己），点击即执行
 * - 点遮罩关闭不执行；消息列表与勾选状态都在弹层内部维护
 */

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';

/** 弹层里的消息条目（各 App 从自己的消息模型映射而来） */
export interface FwdSheetItem {
  id: string;
  role: 'me' | 'peer';
  /** 发送方显示名（我的消息 = 我的名，AI 消息 = 对方名） */
  name: string;
  time: number;
  /** 内容预览文本（文本原文 / [图片] / [表情] xx / [红包] …） */
  text: string;
  /** 图片消息缩略图 */
  imgSrc?: string;
  /** 表情消息缩略图 */
  stkUrl?: string;
}

/** 转发目标（好友 + 自己） */
export interface FwdSheetTarget {
  id: string;
  name: string;
  avatar: string | null;
  /** 目标是否为「我自己」（显示「我自己」角标） */
  self?: boolean;
}

export type FwdMode = 'each' | 'merge';

export function ForwardSheet({
  items,
  initialIds,
  targets,
  onExecute,
  onClose,
  testPrefix,
  renderAvatar,
}: {
  items: FwdSheetItem[];
  /** 预选中的消息 id（长按单条转发=该条；多选批量转发=勾选集合；不存在的 id 自动忽略） */
  initialIds: string[];
  targets: FwdSheetTarget[];
  onExecute: (mode: FwdMode, selectedIds: string[], target: FwdSheetTarget) => void;
  onClose: () => void;
  testPrefix: string;
  renderAvatar: (src: string | null, name: string, size: number) => React.ReactNode;
}) {
  const selectable = useMemo(() => items.filter((x) => x.id), [items]);
  const [selected, setSelected] = useState<string[]>(() => initialIds.filter((id) => selectable.some((x) => x.id === id)));
  const [step, setStep] = useState<'msgs' | 'target'>('msgs');
  const [mode, setMode] = useState<FwdMode>('each');

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const pickMode = (m: FwdMode) => {
    if (selected.length === 0) return;
    setMode(m);
    setStep('target');
  };

  return (
    <div
      className="absolute inset-0 z-[70] flex flex-col justify-end bg-black/40"
      data-testid={`${testPrefix}-layer`}
      onClick={onClose}
    >
      <div className="mx-2 mb-3 overflow-hidden rounded-[14px] bg-white shadow-2xl dark:bg-[#1E1E1E]" onClick={(e) => e.stopPropagation()}>
        {step === 'msgs' ? (
          <>
            <div className="flex items-baseline justify-center gap-2 border-b border-black/[0.06] py-3 dark:border-white/[0.08]">
              <p className="text-[15px] font-medium">选择转发消息</p>
              <span className="text-[12px] text-black/40 dark:text-white/40" data-testid={`${testPrefix}-count`}>
                已选 {selected.length} 条
              </span>
            </div>
            <div className="max-h-[44vh] overflow-y-auto" role="listbox" aria-label="选择要转发的消息">
              {selectable.length === 0 && <p className="py-8 text-center text-[13px] text-black/35 dark:text-white/35">暂无可转发的消息</p>}
              {selectable.map((it) => {
                const on = selected.includes(it.id);
                return (
                  <button
                    key={it.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    data-testid={`${testPrefix}-item-${it.id}`}
                    onClick={() => toggle(it.id)}
                    className="flex w-full items-center gap-2.5 px-4 py-2 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border ${
                        on ? 'border-[#07C160] bg-[#07C160] text-white' : 'border-black/25 dark:border-white/35'
                      }`}
                    >
                      {on && <Check className="h-[12px] w-[12px]" strokeWidth={3} />}
                    </span>
                    {(it.imgSrc || it.stkUrl) && (
                      <img src={(it.imgSrc || it.stkUrl) as string} alt="" className="h-9 w-9 shrink-0 rounded-[4px] object-cover" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="mb-0.5 block text-[11.5px] leading-none text-black/40 dark:text-white/40">{it.name}</span>
                      <span className="line-clamp-2 block whitespace-pre-wrap break-words text-[14px] leading-[1.35]">{it.text || '[消息]'}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex border-t border-black/[0.06] dark:border-white/[0.08]">
              <button
                type="button"
                data-testid={`${testPrefix}-each`}
                disabled={selected.length === 0}
                onClick={() => pickMode('each')}
                className={`flex-1 py-3 text-center text-[15px] ${
                  selected.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-black/80 active:bg-black/5 dark:text-white/85 dark:active:bg-white/10'
                }`}
              >
                逐条转发
              </button>
              <span aria-hidden="true" className="my-2 w-px bg-black/[0.08] dark:bg-white/10" />
              <button
                type="button"
                data-testid={`${testPrefix}-merge`}
                disabled={selected.length === 0}
                onClick={() => pickMode('merge')}
                className={`flex-1 py-3 text-center text-[15px] ${
                  selected.length === 0 ? 'text-black/25 dark:text-white/25' : 'text-black/80 active:bg-black/5 dark:text-white/85 dark:active:bg-white/10'
                }`}
              >
                合并转发
              </button>
            </div>
            <button
              type="button"
              data-testid={`${testPrefix}-cancel`}
              onClick={onClose}
              className="w-full border-t border-black/[0.06] py-3 text-center text-[15px] text-black/55 active:bg-black/5 dark:border-white/[0.08] dark:text-white/55 dark:active:bg-white/10"
            >
              取消
            </button>
          </>
        ) : (
          <>
            <p className="border-b border-black/[0.06] py-3 text-center text-[15px] font-medium dark:border-white/[0.08]">
              {mode === 'merge' ? '合并转发给' : '逐条转发给'}
            </p>
            <div className="max-h-[46vh] overflow-y-auto">
              {targets.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`${testPrefix}-target-${c.id}`}
                  onClick={() => onExecute(mode, selected, c)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-black/[0.04] dark:active:bg-white/[0.06]"
                >
                  {renderAvatar(c.avatar, c.name, 38)}
                  <span className="min-w-0 flex-1 truncate text-[15.5px]">{c.self ? `${c.name}（我自己）` : c.name}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              data-testid={`${testPrefix}-back`}
              onClick={() => setStep('msgs')}
              className="w-full border-t border-black/[0.06] py-3 text-center text-[15px] text-black/55 active:bg-black/5 dark:border-white/[0.08] dark:text-white/55 dark:active:bg-white/10"
            >
              上一步
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** 「聊天记录」合并卡片与详情页共用的记录结构（各 App 持久化进自己的消息字段） */
export interface FwdRecord {
  name: string;
  role: 'me' | 'peer';
  text: string;
  time: number;
}

/** 合并转发卡片标题：{我的名}与{对方名}的聊天记录 */
export function fwdRecordTitle(meName: string, peerName: string): string {
  return `${meName}与${peerName}的聊天记录`;
}

/** 详情页日期行：2026年9月15日 */
export function fwdRecordDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 详情页/记录行时间：18:29 */
export function fwdRecordTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
