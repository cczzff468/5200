'use client';

/**
 * 情侣小家 —— 家具组件（2.5D 卡通写实版）
 *
 * 职责：
 *  - 渲染：宽 = catalog.w，高按贴图自然比例；底部中心锚定 (x,y)；zIndex = round(y) 深度排序
 *  - 生活模式：短按 = 交互（弹跳 + 粒子 + 回调）；长按 350ms = 拖拽换位（16px 网格吸附）
 *  - 编辑模式：短按 = 选中/取消（绿色虚线框 + 浮动操作按钮：翻转/删除）；按住即可拖
 *  - 状态层：开门换贴图（衣橱/冰箱/纸箱）、洗衣机运转 wobble、洗好徽标、拖拽角标
 *  - 夜光/电视屏幕发光由主组件的 LightingLayer 统一绘制（本组件只管贴图状态）
 */

import { memo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Trash2, RefreshCw } from 'lucide-react';
import type { FurnitureItem } from './types';
import { CATALOG, GRID, WALL_BOTTOM, WORLD_H, WORLD_W } from './catalog';
import { clientToWorld } from './camState';

export interface FurnitureProps {
  f: FurnitureItem;
  /** 编辑模式（上帝视角装修） */
  editMode: boolean;
  /** 编辑模式下被选中 */
  selected: boolean;
  /** 选中操作回调 */
  onSelect: (f: FurnitureItem | null) => void;
  onFlip: (f: FurnitureItem) => void;
  onDelete: (f: FurnitureItem) => void;
  /** 点击交互（生活模式） */
  onInteract: (f: FurnitureItem) => void;
  /** 拖拽结束（新世界坐标，已吸附） */
  onMove: (f: FurnitureItem, x: number, y: number) => void;
  /** 粒子发射 */
  onEmit: (f: FurnitureItem, emoji: string) => void;
  /** 拖拽开始（暂停镜头跟随） */
  onDragStart: (f: FurnitureItem) => void;
}

const HOLD_MS = 340;

function clampPos(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(30, Math.min(WORLD_W - 30, x)),
    y: Math.max(WALL_BOTTOM + 26, Math.min(WORLD_H - 14, y)),
  };
}

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

function FurnitureInner({
  f,
  editMode,
  selected,
  onSelect,
  onFlip,
  onDelete,
  onInteract,
  onMove,
  onEmit,
  onDragStart,
}: FurnitureProps) {
  const c = CATALOG[f.kind];
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [pressed, setPressed] = useState(false);
  const [bounce, setBounce] = useState(0);
  const [quip, setQuip] = useState<{ text: string; t: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const moved = useRef(false);
  const suppressTap = useRef(false);

  const st = f.st ?? {};
  const open = st.open && c.imgOpen;
  const washing = f.kind === 'washer' && st.washing;
  const imgSrc = open ? c.imgOpen! : c.img;

  const clearHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* 忽略 */
    }
    startPos.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    suppressTap.current = false;
    setPressed(true);
    // 编辑模式：立即进入「待拖」状态（按住即可拖走），同时选中
    if (editMode) {
      if (!selected) onSelect(f);
      setDrag({ x: f.x, y: f.y });
      return;
    }
    // 生活模式：长按 340ms 才进入拖拽
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      setDrag({ x: f.x, y: f.y });
      setPressed(false);
      onDragStart(f);
    }, HOLD_MS);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) {
      // 未进入拖拽前的轻微移动取消长按判定（防误触）
      const d = Math.hypot(e.clientX - startPos.current.x, e.clientY - startPos.current.y);
      if (d > 10 && holdTimer.current) {
        clearHold();
        setPressed(false);
      }
      return;
    }
    e.stopPropagation();
    moved.current = true;
    // 视口 → 世界坐标（clientToWorld 含 zoom 换算）
    const w = clientToWorld(e.clientX, e.clientY);
    const p = clampPos(snap(w.x), snap(w.y));
    setDrag(p);
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* 忽略 */
    }
    clearHold();
    setPressed(false);
    if (drag) {
      const finalPos = { ...drag };
      setDrag(null);
      if (moved.current) {
        onMove(f, finalPos.x, finalPos.y);
      } else if (editMode) {
        // 编辑模式下的「点按」：切换选中（已在 down 里选中，这里如果是点按就保持）
      }
      return;
    }
    if (moved.current || suppressTap.current) return;
    // 短按 = 交互（生活模式）；编辑模式点按不交互
    if (editMode) return;
    setBounce((b) => b + 1);
    if (c.quips?.length) {
      setQuip({ text: c.quips[Math.floor(Math.random() * c.quips.length)], t: Date.now() });
      window.setTimeout(() => setQuip(null), 2200);
    }
    onEmit(f, ['💗', '✨', '💫', '🐾', '🎵'][bounce % 5]);
    onInteract(f);
  };

  const px = drag?.x ?? f.x;
  const py = drag?.y ?? f.y;
  const flipped = f.flip === true;

  return (
    <motion.div
      className="absolute touch-none"
      style={{
        left: px,
        top: py,
        x: '-50%',
        y: '-100%',
        zIndex: Math.round(py) + (c.zBias ?? 0) + (drag ? 9000 : selected ? 600 : 0),
        width: c.w,
        cursor: editMode ? 'move' : 'grab',
      }}
      animate={washing ? { rotate: [0, -1.4, 1.4, 0] } : pressed ? { scale: 0.95 } : { scale: 1, rotate: 0 }}
      transition={
        washing
          ? { repeat: Infinity, duration: 0.5, ease: 'easeInOut' }
          : { type: 'spring', stiffness: 480, damping: 24 }
      }
      onPointerDown={onDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      role="button"
      aria-label={c.name}
    >
      {/* 家具贴图（bounce 变化时重播弹跳） */}
      <motion.img
        key={f.id + '-b' + String(bounce)}
        src={imgSrc}
        alt={c.name}
        draggable={false}
        className="block w-full"
        style={{
          height: 'auto',
          opacity: drag ? 0.85 : 1,
          transform: flipped ? 'scaleX(-1)' : undefined,
          filter: 'drop-shadow(0 10px 10px rgba(70,56,40,0.25))',
        }}
        initial={{ y: 0 }}
        animate={{ y: [0, -8, 0] }}
        transition={bounce === 0 ? { duration: 0 } : { duration: 0.4, ease: 'easeOut' }}
      />

      {/* 编辑模式：选中框（绿色虚线 + 锚点） */}
      {editMode && selected && (
        <>
          <div
            className="pointer-events-none absolute -inset-3 rounded-2xl"
            style={{
              border: '2.5px dashed #34c98e',
              boxShadow: '0 0 0 4px rgba(52,201,142,0.15)',
            }}
          />
          {/* 四角锚点 */}
          {[
            { top: -7, left: -7 },
            { top: -7, right: -7 },
            { bottom: -7, left: -7 },
            { bottom: -7, right: -7 },
          ].map((pos, i) => (
            <span
              key={i}
              className="pointer-events-none absolute h-[11px] w-[11px] rounded-[3px] bg-[#34c98e]"
              style={pos}
            />
          ))}
          {/* 浮动操作按钮（参考图5：确认/旋转/删除） */}
          <div className="absolute bottom-full left-1/2 mb-3 flex -translate-x-1/2 items-center gap-2">
            <button
              type="button"
              aria-label="完成"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(null);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#34c98e] text-white shadow-lg ring-2 ring-white/70 active:scale-90"
            >
              <Check className="h-5 w-5" strokeWidth={2.5} />
            </button>
            {c.flippable !== false && (
              <button
                type="button"
                aria-label="翻转方向"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onFlip(f);
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-[#3a3a40] shadow-lg ring-2 ring-white/40 active:scale-90"
              >
                <RefreshCw className="h-[18px] w-[18px]" strokeWidth={2.4} />
              </button>
            )}
            <button
              type="button"
              aria-label="删除"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(f);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f26d6d] text-white shadow-lg ring-2 ring-white/70 active:scale-90"
            >
              <Trash2 className="h-[18px] w-[18px]" strokeWidth={2.4} />
            </button>
          </div>
        </>
      )}

      {/* 洗衣机运转徽标 */}
      {washing && (
        <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-[170%]">
          <div className="flex items-center gap-1.5 rounded-full bg-[#2c3444]/92 px-2.5 py-1 shadow-lg ring-1 ring-white/15">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <span className="text-[11px] font-medium text-[#cfe4ff]">洗衣中…</span>
          </div>
        </div>
      )}
      {/* 洗好待取提示 */}
      {!washing && st.washDone && (
        <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-[170%] animate-bounce whitespace-nowrap rounded-full bg-[#e2a34f] px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg">
          ✨ 洗好了，取出来！
        </div>
      )}

      {/* 交互气泡（playful 文案） */}
      {quip && (
        <motion.div
          key={quip.t}
          initial={{ opacity: 0, y: 6, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/95 px-3 py-1.5 text-[12px] font-medium text-[#3a3a40] shadow-lg ring-1 ring-black/[0.06]"
        >
          {quip.text}
        </motion.div>
      )}

      {/* 拖拽状态角标 */}
      {drag && (
        <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-[60%] whitespace-nowrap rounded-full bg-[#e26a96] px-3 py-1 text-[11px] font-semibold text-white shadow-lg">
          ✋ {c.name} · 松手放下
        </div>
      )}
    </motion.div>
  );
}

export default memo(FurnitureInner);
