'use client';

/**
 * 情侣小家 —— 衣橱 / 洗衣机面板（底部抽屉式浮层）
 *
 * 衣橱：网格展示衣物（emoji 徽章），可单件「送洗」（转存洗衣机）；
 * 洗衣机：查看筒内衣物 → 启动（8s）→ 洗好 → 全部取回衣橱。
 */

import { motion, AnimatePresence } from 'framer-motion';
import type { FurnitureItem } from './types';
import { CLOTH_MAP } from './catalog';

export interface WardrobePanelProps {
  f: FurnitureItem;
  onClose: () => void;
  /** 送一件去洗衣机 */
  onSendWash: (clothId: string) => void;
}

export function WardrobePanel({ f, onClose, onSendWash }: WardrobePanelProps) {
  const clothes = f.st.clothes ?? [];
  return (
    <PanelShell title="🚪 衣橱 · 我们的衣柜" onClose={onClose}>
      {clothes.length === 0 ? (
        <div className="py-8 text-center text-[14px] text-[#9a9aa2]">
          衣橱空空的…衣服都送去洗了吗？
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2.5">
          {clothes.map((cid) => {
            const c = CLOTH_MAP[cid];
            if (!c) return null;
            return (
              <div
                key={cid}
                className="flex flex-col items-center rounded-2xl bg-white px-1.5 py-2.5 shadow-sm ring-1 ring-black/[0.04]"
              >
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-full text-[22px]"
                  style={{ background: `${c.color}` }}
                >
                  {c.emoji}
                </div>
                <div className="mt-1.5 text-[12px] font-medium text-[#3a3a40]">{c.name}</div>
                <button
                  type="button"
                  onClick={() => onSendWash(cid)}
                  className="mt-1.5 rounded-full bg-[#7ec3e8]/18 px-3 py-[3px] text-[11px] font-semibold text-[#4a94bc] transition-colors active:bg-[#7ec3e8]/30"
                >
                  送洗 🫧
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 text-center text-[12px] text-[#a6a6ad]">
        点击「送洗」把衣服放进洗衣机～
      </div>
    </PanelShell>
  );
}

export interface WasherPanelProps {
  f: FurnitureItem;
  onClose: () => void;
  /** 启动洗衣 */
  onStart: () => void;
  /** 取出全部洗好的衣服 → 放回衣橱 */
  onTake: () => void;
}

export function WasherPanel({ f, onClose, onStart, onTake }: WasherPanelProps) {
  const clothes = f.st.clothes ?? [];
  const washing = !!f.st.washing;
  const done = !!f.st.washDone;
  return (
    <PanelShell title="🫧 洗衣机" onClose={onClose}>
      {clothes.length === 0 ? (
        <div className="py-6 text-center text-[14px] text-[#9a9aa2]">
          筒里是空的～去衣橱挑几件「送洗」吧
        </div>
      ) : (
        <>
          <div className="flex flex-wrap justify-center gap-2 py-1">
            {clothes.map((cid) => {
              const c = CLOTH_MAP[cid];
              if (!c) return null;
              return (
                <div
                  key={cid}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-[#3a3a40] shadow-sm ring-1 ring-black/[0.04]"
                  style={{ background: done ? '#eaf7f0' : '#ffffff' }}
                >
                  <span className="text-[16px]">{c.emoji}</span>
                  {c.name}
                  {done && <span>✨</span>}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-center">
            {washing ? (
              <button
                type="button"
                disabled
                className="flex items-center gap-2 rounded-full bg-[#dfeef7] px-6 py-2.5 text-[14px] font-semibold text-[#4a94bc]"
              >
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#7ec3e8]/40 border-t-[#4a94bc]" />
                咕嘟咕嘟洗着呢…
              </button>
            ) : done ? (
              <button
                type="button"
                onClick={onTake}
                className="rounded-full bg-gradient-to-r from-[#6fca8f] to-[#4faf78] px-6 py-2.5 text-[14px] font-semibold text-white shadow-md transition-transform active:scale-95"
              >
                ✨ 洗好啦！取回衣橱
              </button>
            ) : (
              <button
                type="button"
                onClick={onStart}
                className="rounded-full bg-gradient-to-r from-[#6cb8e8] to-[#4a94bc] px-8 py-2.5 text-[14px] font-semibold text-white shadow-md transition-transform active:scale-95"
              >
                ▶ 启动洗衣（8 秒快洗）
              </button>
            )}
          </div>
        </>
      )}
    </PanelShell>
  );
}

function PanelShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      <motion.div
        key="panel"
        className="absolute inset-x-0 bottom-0 z-[9510]"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        initial={{ y: 260, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 260, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
        style={{ pointerEvents: 'auto' }}
      >
        <div className="rounded-t-3xl bg-[#f7f7f9]/97 px-4 pb-5 pt-3 shadow-[0_-10px_30px_rgba(0,0,0,0.14)] backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[15px] font-bold text-[#2c2c30]">{title}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-[#6a6a72] transition-colors active:bg-black/0.1"
            >
              ✕
            </button>
          </div>
          {children}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
