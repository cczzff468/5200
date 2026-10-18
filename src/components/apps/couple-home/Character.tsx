'use client';

/**
 * 情侣小家 —— 小人（billboard 纸片人）
 *
 * - Kenney Toon Characters（男红衣 / 女蓝衣），idle + run 3 帧走路循环
 * - 左右移动翻转贴图；上下移动靠纵深缩放（上远小下近大）营造俯视透视
 * - 移动中 130ms/帧 播 run 序列，静止播 idle；脚下椭圆阴影贴地
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CharState } from './types';
import { CHAR_H, WORLD_H, WORLD_W, PIX } from './catalog';

const SHEET: Record<'me' | 'partner', { idle: string; run: [string, string, string] }> = {
  me: {
    idle: '/home/chars/character_malePerson_idle.png',
    run: [
      '/home/chars/character_malePerson_run0.png',
      '/home/chars/character_malePerson_run1.png',
      '/home/chars/character_malePerson_run2.png',
    ],
  },
  partner: {
    idle: '/home/chars/character_femalePerson_idle.png',
    run: [
      '/home/chars/character_femalePerson_run0.png',
      '/home/chars/character_femalePerson_run1.png',
      '/home/chars/character_femalePerson_run2.png',
    ],
  },
};

export interface CharacterProps {
  ch: CharState;
  /** 世界→视口换算由外层 transform 完成，这里只负责世界内定位 */
  scaleBase?: number;
}

function CharacterInner({ ch, scaleBase = 1 }: CharacterProps) {
  const [frame, setFrame] = useState(0);
  const raf = useRef<number>(0);

  // 走路帧动画（只在 moving 时推进；静止帧渲染时直接显示 idle 贴图）
  useEffect(() => {
    if (!ch.moving) return;
    let last = performance.now();
    const tick = (t: number) => {
      if (t - last > 130) {
        last = t;
        setFrame((f) => (f + 1) % 3);
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [ch.moving]);

  // 深度缩放：上(0)→0.84，下(WORLD_H)→1.05，配合 z 排序产生俯视纵深
  const depth = useMemo(() => {
    const t = Math.min(1, Math.max(0, ch.y / WORLD_H));
    return (0.84 + t * 0.21) * scaleBase;
  }, [ch.y, scaleBase]);

  const src = ch.moving ? SHEET[ch.id].run[frame] : SHEET[ch.id].idle;
  const h = Math.round(CHAR_H * depth);
  const w = Math.round((96 / 128) * h);

  return (
    <div
      aria-label={ch.id === 'me' ? '我' : 'TA'}
      className="absolute select-none"
      style={{
        left: ch.x,
        top: ch.y,
        transform: 'translate(-50%, -100%)',
        zIndex: Math.round(ch.y),
        width: w,
        height: h,
      }}
    >
      {/* 脚下阴影（贴地椭圆，不随走路帧抖） */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-[50%]"
        style={{
          bottom: -6,
          width: w * 0.52,
          height: w * 0.22,
          background: 'rgba(40,44,52,0.26)',
          filter: 'blur(2px)',
        }}
      />
      <img
        src={src}
        alt=""
        draggable={false}
        className="h-full w-full"
        style={{
          imageRendering: PIX,
          transform: ch.dir === 'left' ? 'scaleX(-1)' : undefined,
          // 上下移动的轻微摆动（走路弹性）
          animation: ch.moving ? 'char-bob 0.26s ease-in-out infinite' : undefined,
        }}
      />
    </div>
  );
}

/** 名牌（世界内跟随，配合 camera 一起被裁剪） */
export function CharBadge({ ch, label }: { ch: CharState; label: string }) {
  if (ch.x < -80 || ch.x > WORLD_W + 80) return null;
  return (
    <div
      className="pointer-events-none absolute select-none"
      style={{
        left: ch.x,
        top: ch.y,
        transform: 'translate(-50%, -100%)',
        zIndex: Math.round(ch.y) + 1,
      }}
    >
      <div
        className="mb-[104px] whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-semibold text-white"
        style={{
          background: ch.id === 'me' ? 'rgba(226,106,150,0.85)' : 'rgba(96,144,178,0.85)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        }}
      >
        {label}
      </div>
    </div>
  );
}

export default memo(CharacterInner);
