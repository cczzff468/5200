'use client';

/**
 * 情侣小家 —— 家具组件
 *
 * 每件家具 = 一个绝对定位的「贴图+状态层」节点：
 * - 点击（短按）→ 触发交互（开灯/开门/开电视…），交由主组件的 onInteract
 * - 长按 350ms → 进入拖拽（跟手移动 + 16px 网格吸附），松手回调 onMove 保存
 * - 视觉反馈：
 *   灯（开）：径向光晕，夜晚模式下显著
 *   电视（开）：屏幕蓝光 + 周期性冒音符粒子（粒子由主组件发）
 *   洗衣机（运转）：wobble 抖动 + 进度徽标
 *   衣橱（开）：切换开门贴图
 *
 * 事件边界：所有 pointer 事件 stopPropagation，避免冒泡到场景层
 * 触发 pan（视角拖动）/ tap（寻路）手势。
 */

import { memo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { FurnitureItem } from './types';
import { CATALOG, furnSize, GRID, PIX } from './catalog';

export interface FurnitureProps {
  f: FurnitureItem;
  night: boolean;
  /** 世界坐标 ↔ 屏幕坐标换算（viewport 原点的世界坐标） */
  camRef: { current: { x: number; y: number } };
  /** 点击交互（开/关、开门、打开面板…由主组件裁决） */
  onInteract: (f: FurnitureItem) => void;
  /** 拖拽结束（新世界坐标，已网格吸附） */
  onMove: (f: FurnitureItem, x: number, y: number) => void;
  /** 粒子发射（交互反馈） */
  onEmit: (f: FurnitureItem, emoji: string) => void;
  /** 拖拽开始（主组件暂停 camera 跟随） */
  onDragStart: (f: FurnitureItem) => void;
}

const HOLD_MS = 350;

function FurnitureInner({
  f,
  night,
  camRef,
  onInteract,
  onMove,
  onEmit,
  onDragStart,
}: FurnitureProps) {
  const c = CATALOG[f.kind];
  const size = furnSize(f.kind);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [pressed, setPressed] = useState(false);
  const [bounce, setBounce] = useState(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const moved = useRef(false);

  const st = f.st ?? {};
  const lampOn = c.acts.toggle && c.glow != null && st.on;
  const tvOn = f.kind === 'tv' && st.on;
  const washing = f.kind === 'washer' && st.washing;
  const open = st.open && c.imgOpen;

  // ---- 指针手势：短按=交互，长按=拖拽 ----
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* 非活跃指针（合成事件）无 capture，安全忽略 */
    }
    startPos.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    setPressed(true);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      setDrag({ x: f.x, y: f.y });
      setPressed(false);
      onDragStart(f);
    }, HOLD_MS);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag) {
      e.stopPropagation();
      moved.current = true;
      // 世界坐标 = 屏幕坐标 + camera 原点；吸附 16px 网格
      const wx = Math.round((e.clientX + camRef.current.x - size.w / 2) / GRID) * GRID;
      const wy = Math.round((e.clientY + camRef.current.y) / GRID) * GRID;
      setDrag({ x: wx + size.w / 2, y: wy });
      return;
    }
    // 未进入拖拽前的轻微移动取消长按判定（防误触）
    const d = Math.hypot(e.clientX - startPos.current.x, e.clientY - startPos.current.y);
    if (d > 10 && holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
      setPressed(false);
    }
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* 非活跃指针（合成事件）无 capture，安全忽略 */
    }
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setPressed(false);
    if (drag) {
      const finalPos = { ...drag };
      setDrag(null);
      if (moved.current) {
        onMove(f, finalPos.x, finalPos.y);
      }
      return;
    }
    // 短按 = 交互点击（弹跳 + 回调）
    if (!moved.current) {
      setBounce((b) => b + 1);
      onEmit(f, ['💗', '✨', '💫'][bounce % 3]);
      onInteract(f);
    }
  };

  const imgSrc = open ? c.imgOpen! : c.img;
  const px = drag?.x ?? f.x;
  const py = drag?.y ?? f.y;

  return (
    <motion.div
      className="absolute touch-none"
      style={{
        left: px,
        top: py,
        transform: 'translate(-50%, -100%)',
        zIndex: Math.round(py) + (c.zBias ?? 0) + (drag ? 9000 : 0),
        width: size.w,
        height: size.h,
        cursor: 'grab',
      }}
      animate={
        washing
          ? { rotate: [0, -1.6, 1.6, 0] }
          : pressed
            ? { scale: 0.96 }
            : { scale: 1, rotate: 0 }
      }
      transition={
        washing
          ? { repeat: Infinity, duration: 0.42, ease: 'easeInOut' }
          : { type: 'spring', stiffness: 480, damping: 24 }
      }
      onPointerDown={onDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      role="button"
      aria-label={c.name}
    >
      {/* 家具贴图（bounce 计数变化时 remount 播放入场弹跳） */}
      <motion.img
        key={f.id + '-b' + bounce}
        src={imgSrc}
        alt={c.name}
        draggable={false}
        className="h-full w-full drop-shadow-[0_4px_6px_rgba(35,40,48,0.22)]"
        style={{
          imageRendering: PIX,
          opacity: drag ? 0.75 : 1,
          outline: drag ? '2px dashed rgba(226,106,150,0.9)' : undefined,
          outlineOffset: 4,
          borderRadius: 6,
        }}
        initial={{ y: 0 }}
        animate={{ y: [0, -9, 0] }}
        transition={
          bounce === 0
            ? { duration: 0 }
            : { duration: 0.36, ease: 'easeOut' }
        }
      />

      {/* 灯光晕（开灯时；夜晚更亮更暖） */}
      {lampOn && (
        <div
          className="pointer-events-none absolute left-1/2"
          style={{
            top: '38%',
            width: (c.glow ?? 200) * (night ? 1 : 0.78),
            height: (c.glow ?? 200) * (night ? 1 : 0.78),
            transform: 'translate(-50%,-50%)',
            background: `radial-gradient(circle, ${
              night ? 'rgba(255,214,102,0.5)' : 'rgba(255,236,170,0.3)'
            } 0%, rgba(255,214,102,0.15) 42%, rgba(255,214,102,0) 70%)`,
            zIndex: 9050,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* 电视播放特效：屏幕蓝光 + 「正在播放」气泡 */}
      {tvOn && (
        <>
          <div
            className="pointer-events-none absolute left-1/2 top-[30%]"
            style={{
              width: 190,
              height: 120,
              transform: 'translate(-50%,-50%)',
              background:
                'radial-gradient(ellipse, rgba(120,190,255,0.5) 0%, rgba(110,170,255,0.2) 45%, rgba(110,170,255,0) 72%)',
              mixBlendMode: 'screen',
              zIndex: 9050,
              animation: 'tv-flicker 1.8s ease-in-out infinite',
            }}
          />
          <div className="pointer-events-none absolute left-1/2 top-0 z-[9051] -translate-x-1/2 -translate-y-[150%] whitespace-nowrap rounded-full bg-[#2c3444]/92 px-3 py-1 text-[11px] font-medium text-[#cfe4ff] shadow-lg ring-1 ring-white/15">
            ▶ 正在播放…
          </div>
        </>
      )}

      {/* 洗衣机运转徽标 */}
      {washing && (
        <div className="pointer-events-none absolute left-1/2 top-0 z-[9051] -translate-x-1/2 -translate-y-[160%]">
          <div className="flex items-center gap-1.5 rounded-full bg-[#2c3444]/92 px-2.5 py-1 shadow-lg ring-1 ring-white/15">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <span className="text-[11px] font-medium text-[#cfe4ff]">洗衣中…</span>
          </div>
        </div>
      )}
      {/* 洗好待取提示 */}
      {!washing && st.washDone && (
        <div className="pointer-events-none absolute left-1/2 top-0 z-[9051] -translate-x-1/2 -translate-y-[160%] animate-bounce whitespace-nowrap rounded-full bg-[#e2a34f] px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg">
          ✨ 洗好了，取出来！
        </div>
      )}

      {/* 拖拽状态角标 */}
      {drag && (
        <div className="pointer-events-none absolute left-1/2 top-0 z-[9051] -translate-x-1/2 -translate-y-[170%] whitespace-nowrap rounded-full bg-[#e26a96] px-3 py-1 text-[11px] font-semibold text-white shadow-lg">
          ✋ {c.name} · 松手放下
        </div>
      )}
    </motion.div>
  );
}

export default memo(FurnitureInner);
