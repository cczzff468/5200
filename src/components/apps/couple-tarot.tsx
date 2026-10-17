'use client';

/**
 * 恋人空间「爱情塔罗」· 浅色毛玻璃风 + 复古线稿塔罗牌面（第四十七轮）。
 *
 * 流程：选主题（预设 + 自定义问题）→ 洗牌（轻触一次 / 长按持续）→ 轻触牌堆三叠切牌（防抖，1.4s，
 * 左叠分出 → 右叠分出 → 停顿 → 合拢，完成后自动进入）→ 选牌阵（13 种经典牌阵，含牌位职责说明）→
 * 选牌（上方按牌阵动态生成小号虚线牌位框 + 右侧边缘 78 张大号扇形牌轮：上下滑动 / 双指缩放，
 * 点牌飞入第 1 个空牌位）→ 翻牌（牌位内逐张 3D 翻开，正/逆位 + 「第N张·牌位 / English」说明）→
 * AI 纯塔罗解读（第四十七轮去人设去记忆：只按牌位职责 + 正逆位牌意，不带入恋人语气与聊天记忆）→ 结果 / 历史。
 *
 * - 牌面：大阿尔卡那 22 张用 /tarot/majors.png（6×4 网格按格裁切）+ /tarot/patch.png（恋人/倒吊人），
 *   小阿尔卡那用 SVG pip 阵 + 花色线稿符号（SuitGlyph）；复古米色纸底 + 双线内框 + 罗马数字 + 底部牌名；
 * - 牌库与牌阵：src/lib/tarot-deck.ts（大阿尔卡那 22 + 小阿尔卡那 56，含正逆位牌意）；
 * - 持久化：state.tarotReadings[contactId]（按恋人联系人 ID 隔离，随 couple-space:state 落 IndexedDB，重启可查）；
 * - 记忆：解读完成后 coupleTarotRemember 写入恋人（AI）记忆（sourceTag='couple-tarot'，标记塔罗事件；仅记录事件，解读本身不用记忆）；
 * - 动画：globals.css tarot-* keyframes；牌轮用 CSS 变量（--wa 角度 / --ws 缩放）驱动，一次样式写全牌生效。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, Star, Trash2 } from 'lucide-react';
import {
  TAROT_FULL_DECK,
  TAROT_SPREADS,
  tarotCardById,
  tarotSpreadByKey,
  type SpreadPos,
  type TarotCardDef,
  type TarotReading,
  type TarotSpread,
  type TarotSuit,
  type TarotTheme,
} from '@/lib/tarot-deck';
import { aiTarotReading, coupleTarotRemember, type TarotAiCard } from '@/lib/ios/couple-ai';
import { readInviteMeta } from '@/lib/ios/couple-invite';
import type { CoupleState } from './couple-space';

// ---------------- 预设主题（问什么；牌阵洗牌后单独选） ----------------

const THEMES: TarotTheme[] = [
  { key: 'love', label: '恋爱运势', desc: '看看你们恋爱的整体能量' },
  { key: 'state', label: '当前状态', desc: '这段关系此刻的真实状况' },
  { key: 'hismind', label: 'TA 的想法', desc: 'TA 心里真实的念头' },
  { key: 'future', label: '关系走向', desc: '这段关系会往哪里去' },
  { key: 'custom', label: '自定义问题', desc: '写下你最想问的问题', custom: true },
];

// ---------------- 工具 ----------------

function cutText(s: string, max: number): string {
  const t = (s ?? '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function fmtTs(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return `${sameYear ? '' : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/** AI 失败时的本地兜底解读（牌位 + 牌意直出，语气平实） */
function fallbackReading(positions: SpreadPos[], cards: { def: TarotCardDef; reversed: boolean }[]): { per: string[]; overall: string } {
  const per = cards.map((c, i) => `【${positions[i]?.label ?? '牌面'}】${c.def.name}（${c.reversed ? '逆位' : '正位'}）——${c.reversed ? c.def.reversed : c.def.upright}`);
  const overall = `整副牌落在「${cards.map((c) => (c.reversed ? c.def.revKeys : c.def.upKeys).split(' · ')[0]).join('、')}」这些能量上。顺着牌面的提示走，答案已经在你手里了。`;
  return { per, overall };
}

// ---------------- 卡背 / 卡面 / 3D 翻牌（第四十七轮：复古线稿塔罗牌面） ----------------

const INK = '#43392b'; // 复古炭墨
const PAPER_BG = 'linear-gradient(168deg,#f9f4e7 0%,#f4edda 52%,#ece1c6 100%)';

/** 大阿尔卡那 → majors.png（6 列 × 4 行）网格位置；恋人 / 倒吊人走 patch.png 左右半（实际出图校对） */
const MAJOR_SPRITE: Record<number, [number, number]> = {
  0: [0, 0], 1: [1, 0], 2: [2, 0], 3: [3, 0], 4: [4, 0], 5: [5, 0],
  7: [1, 1], 8: [2, 1], 9: [3, 1], 10: [4, 1], 11: [5, 1],
  13: [1, 2], 14: [2, 2], 15: [3, 2], 16: [4, 2], 17: [5, 2],
  18: [5, 3], 19: [0, 3], 20: [1, 3], 21: [2, 3],
};

/** 大阿尔卡那中央插画：sprite 按格裁切 */
function MajorArt({ idx }: { idx: number }) {
  const cell = MAJOR_SPRITE[idx];
  const base: CSSProperties = { width: '100%', height: '100%', display: 'block' };
  if (cell) {
    const [c, r] = cell;
    return (
      <div
        style={{
          ...base,
          backgroundImage: 'url(/tarot/majors.png)',
          backgroundSize: '600% 400%',
          backgroundPosition: `${(c / 5) * 100}% ${(r / 3) * 100}%`,
        }}
      />
    );
  }
  // 恋人(6) / 倒吊人(12)：patch.png 左右两半
  return (
    <div
      style={{
        ...base,
        backgroundImage: 'url(/tarot/patch.png)',
        backgroundSize: '200% 100%',
        backgroundPosition: idx === 6 ? '0% 0%' : '100% 0%',
      }}
    />
  );
}

/** 小阿尔卡那花色线稿符号（权杖 / 圣杯 / 宝剑 / 星币） */
function SuitGlyph({ suit, size, stroke = 1.6 }: { suit: TarotSuit; size: number; stroke?: number }) {
  const s = { stroke: INK, strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block' }}>
      {suit === 'wands' && (
        <>
          <path d="M12 21V3.5" {...s} />
          <path d="M12 9C9.4 8.5 7.7 6.7 7.5 3.8c2.9.2 4.6 1.9 5 4.6" {...s} />
          <path d="M12 14c2.6-.5 4.3-2.3 4.5-5.2-2.9.2-4.6 1.9-5 4.6" {...s} />
          <path d="M9.2 21h5.6" {...s} />
        </>
      )}
      {suit === 'cups' && (
        <>
          <path d="M6.5 4h11c0 5-2.6 8-5.5 8S6.5 9 6.5 4z" {...s} />
          <path d="M12 12v6.2" {...s} />
          <path d="M9.4 18.2h5.2" {...s} />
          <path d="M7.8 21h8.4" {...s} />
        </>
      )}
      {suit === 'swords' && (
        <>
          <path d="M12 2.5 13.7 15h-3.4L12 2.5z" {...s} />
          <path d="M7 16.4h10" {...s} />
          <path d="M12 16.4V21" {...s} />
          <path d="M9.4 21h5.2" {...s} />
        </>
      )}
      {suit === 'pentacles' && (
        <>
          <circle cx="12" cy="12" r="8.4" {...s} />
          <path d="M12 6.6l1.7 3.5 3.8.5-2.8 2.6.8 3.8-3.5-2-3.5 2 .8-3.8-2.8-2.6 3.8-.5L12 6.6z" {...s} />
        </>
      )}
    </svg>
  );
}

/** 小阿尔卡那数字牌 pip 排布（经典扑克式阵位，0~1 单位坐标） */
const PIP_LAYOUT: Record<string, [number, number][]> = {
  A: [[0.5, 0.5]],
  '2': [[0.5, 0.17], [0.5, 0.83]],
  '3': [[0.5, 0.13], [0.5, 0.5], [0.5, 0.87]],
  '4': [[0.29, 0.17], [0.71, 0.17], [0.29, 0.83], [0.71, 0.83]],
  '5': [[0.29, 0.15], [0.71, 0.15], [0.5, 0.5], [0.29, 0.85], [0.71, 0.85]],
  '6': [[0.29, 0.13], [0.71, 0.13], [0.29, 0.5], [0.71, 0.5], [0.29, 0.87], [0.71, 0.87]],
  '7': [[0.29, 0.13], [0.71, 0.13], [0.5, 0.315], [0.29, 0.5], [0.71, 0.5], [0.29, 0.87], [0.71, 0.87]],
  '8': [[0.29, 0.11], [0.71, 0.11], [0.29, 0.37], [0.71, 0.37], [0.29, 0.63], [0.71, 0.63], [0.29, 0.89], [0.71, 0.89]],
  '9': [[0.29, 0.11], [0.71, 0.11], [0.29, 0.37], [0.71, 0.37], [0.5, 0.5], [0.29, 0.63], [0.71, 0.63], [0.29, 0.89], [0.71, 0.89]],
  '10': [[0.29, 0.1], [0.71, 0.1], [0.5, 0.24], [0.29, 0.38], [0.71, 0.38], [0.29, 0.62], [0.71, 0.62], [0.5, 0.76], [0.29, 0.9], [0.71, 0.9]],
};

/** 小阿尔卡那中央图形：数字牌 = pip 阵；宫廷牌 = 单个大花色符号 + 徽记 */
function MinorArt({ suit, numeral, w, h }: { suit: TarotSuit; numeral: string; w: number; h: number }) {
  const court = numeral === '侍从' || numeral === '骑士' || numeral === '王后' || numeral === '国王';
  if (court) {
    const mark = numeral === '侍从' ? '✦' : numeral === '骑士' ? '☾' : numeral === '王后' ? '☼' : '♛';
    return (
      <div className="relative flex h-full w-full items-center justify-center">
        <span className="absolute left-1/2 top-0 -translate-x-1/2 font-serif" style={{ color: INK, fontSize: Math.max(7, w * 0.13), lineHeight: 1.2 }}>{mark}</span>
        <SuitGlyph suit={suit} size={Math.min(w * 0.5, h * 0.4)} stroke={1.4} />
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 whitespace-nowrap font-serif" style={{ color: INK, fontSize: Math.max(5.5, w * 0.1), letterSpacing: '0.14em' }}>{numeral}</span>
        <span className="absolute left-1 top-0.5" style={{ color: INK, fontSize: Math.max(4, w * 0.07) }}>✦</span>
        <span className="absolute right-1 bottom-0.5" style={{ color: INK, fontSize: Math.max(4, w * 0.07) }}>✦</span>
      </div>
    );
  }
  const pips = PIP_LAYOUT[numeral] ?? PIP_LAYOUT.A;
  const glyphW = numeral === 'A' ? Math.min(w * 0.44, h * 0.34) : numeral === '10' ? Math.min(w * 0.2, h * 0.15) : Math.min(w * 0.24, h * 0.18);
  return (
    <div className="relative h-full w-full">
      {pips.map(([px, py], i) => (
        <span key={i} className="absolute" style={{ left: `${px * 100}%`, top: `${py * 100}%`, transform: 'translate(-50%,-50%)' }}>
          <SuitGlyph suit={suit} size={glyphW} stroke={numeral === 'A' ? 1.5 : 1.3} />
        </span>
      ))}
    </div>
  );
}

function CardBack({ w, h }: { w: number; h: number }) {
  return (
    <div
      className="relative overflow-hidden border shadow-[0_2px_10px_rgba(17,24,39,0.10)]"
      style={{ width: w, height: h, borderRadius: Math.max(6, w * 0.12), borderColor: 'rgba(67,57,43,0.4)', background: PAPER_BG }}
    >
      <div className="absolute inset-[2.5px] rounded-[6px] border" style={{ borderColor: 'rgba(67,57,43,0.55)' }} />
      <div className="absolute inset-[5px] rounded-[5px] border" style={{ borderColor: 'rgba(67,57,43,0.3)' }} />
      {/* 复古斜纹格底 */}
      <div
        className="absolute inset-[6px] opacity-25"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, rgba(67,57,43,0.7) 0 0.6px, transparent 0.6px 7px), repeating-linear-gradient(-45deg, rgba(67,57,43,0.7) 0 0.6px, transparent 0.6px 7px)',
        }}
      />
      {/* 中央月徽圆环 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="flex items-center justify-center rounded-full border bg-[#f7f1e0]"
          style={{ width: w * 0.38, height: w * 0.38, borderColor: 'rgba(67,57,43,0.55)' }}
        >
          <span className="font-serif" style={{ color: INK, fontSize: Math.max(8, w * 0.17), lineHeight: 1 }}>☾</span>
        </div>
      </div>
      <span className="absolute left-1.5 top-1.5" style={{ color: 'rgba(67,57,43,0.5)', fontSize: Math.max(5, w * 0.08) }}>✦</span>
      <span className="absolute right-1.5 bottom-1.5" style={{ color: 'rgba(67,57,43,0.5)', fontSize: Math.max(5, w * 0.08) }}>✦</span>
    </div>
  );
}

function CardFace({ def, reversed, w, h }: { def: TarotCardDef; reversed: boolean; w: number; h: number }) {
  const majorIdx = def.arcana === 'major' ? Number(def.id.slice(6)) : -1;
  return (
    <div
      className="relative overflow-hidden border shadow-[0_3px_14px_rgba(17,24,39,0.12)]"
      style={{ width: w, height: h, borderRadius: Math.max(6, w * 0.12), borderColor: 'rgba(67,57,43,0.4)', background: PAPER_BG }}
    >
      <div className="absolute inset-[2.5px] rounded-[6px] border" style={{ borderColor: 'rgba(67,57,43,0.55)' }} />
      <div className="absolute inset-[5px] rounded-[5px] border" style={{ borderColor: 'rgba(67,57,43,0.3)' }} />
      <div className={`flex h-full w-full flex-col items-center ${reversed ? 'rotate-180' : ''}`} style={{ padding: `${Math.max(4, h * 0.035)}px ${Math.max(4, w * 0.06)}px` }}>
        {/* 顶部：罗马数字 / 点数 + 花色 */}
        <div className="flex shrink-0 items-center gap-[3px] font-serif font-semibold" style={{ color: INK, fontSize: Math.max(6.5, w * 0.13), letterSpacing: '0.1em', lineHeight: 1.1 }}>
          <span>{def.numeral}</span>
          {def.suit && <SuitGlyph suit={def.suit} size={Math.max(7, w * 0.14)} stroke={2} />}
        </div>
        {/* 中央插画窗 */}
        <div
          className="relative mx-auto mt-[2px] mb-[2px] shrink-0 overflow-hidden"
          style={{ width: w - Math.max(8, w * 0.14), flex: 1, borderRadius: 4, border: '1px solid rgba(67,57,43,0.32)' }}
        >
          {def.arcana === 'major' ? (
            <MajorArt idx={majorIdx} />
          ) : (
            <MinorArt suit={def.suit!} numeral={def.numeral} w={w - Math.max(8, w * 0.14)} h={h - Math.max(14, h * 0.2)} />
          )}
        </div>
        {/* 底部：英文名 + 中文名 */}
        <div className="w-full shrink-0 text-center" style={{ color: INK }}>
          <div className="truncate font-serif uppercase" style={{ fontSize: Math.max(5, w * 0.082), letterSpacing: '0.07em', lineHeight: 1.25 }}>{def.nameEn}</div>
          <div className="truncate font-medium" style={{ fontSize: Math.max(6, w * 0.1), lineHeight: 1.3 }}>{def.name}</div>
        </div>
      </div>
      {reversed && <div className="absolute right-1 top-1 rounded-full bg-gray-900/85 px-1 py-[1px] text-[7px] font-bold text-white">逆位</div>}
    </div>
  );
}

/** 3D 翻牌：牌背 → 牌面（rot 为该牌位的角度，如凯尔特十字的横牌 / 脉轮的竖排牌） */
function FlipCard({ def, reversed, flipped, w, h, rot = 0 }: { def: TarotCardDef; reversed: boolean; flipped: boolean; w: number; h: number; rot?: number }) {
  return (
    <div className="h-full w-full" style={{ perspective: 900, transform: rot ? `rotate(${rot}deg)` : undefined }}>
      <div
        className="relative transition-transform duration-[560ms] ease-out"
        style={{ width: '100%', height: '100%', transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
      >
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
          <CardBack w={w} h={h} />
        </div>
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
          <CardFace def={def} reversed={reversed} w={w} h={h} />
        </div>
      </div>
    </div>
  );
}

// ---------------- 动态牌位框（按牌阵布局渲染） ----------------

/**
 * SpreadSlots：按牌阵 positions 的坐标把虚线牌位框 / 牌 / 标签摆成该牌阵的标准排版。
 * mode：pick = 选牌中（牌背 + 单行标签）；flip / done = 翻牌展示（3D 翻开 + 「第N张·牌位 / EN」两行说明）。
 */
function SpreadSlots({ spread, positions, slots, revsBySlot, flippedCount, mode, activeSlot, onSlotTap, slotRefCb }: {
  spread: TarotSpread;
  positions: SpreadPos[];
  slots: (number | null)[];
  revsBySlot: boolean[];
  flippedCount: number;
  mode: 'pick' | 'flip' | 'done';
  activeSlot?: number;
  onSlotTap?: (i: number) => void;
  slotRefCb?: (i: number, el: HTMLDivElement | null) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    if (size.w < 60 || size.h < 50) return null;
    const rotAll = positions.length > 0 && positions.every((p) => p.rot === 90);
    const leftW = spread.labelSide === 'left' ? 88 : 0;
    const labelH = spread.labelSide === 'left' ? 0 : mode === 'pick' ? 14 : 27;
    const padX = 3;
    const availW = size.w - padX * 2 - leftW;
    const availH = size.h - 2;
    const rowH = availH / spread.rows;
    const colW = availW / spread.cols;
    // 第四十七轮：选牌时牌位框更小（放大牌轮的视觉空间）
    const pickScale = mode === 'pick' ? 0.76 : 1;
    let cardW: number;
    let cardH: number;
    if (rotAll) {
      // 整阵横牌（脉轮竖列）：视觉高 = cardW
      cardW = Math.max(20, Math.min(rowH - 2, (colW - 6) / 1.58)) * pickScale;
      cardH = cardW * 1.58;
    } else {
      cardH = Math.max(30, rowH - labelH - 4) * pickScale;
      cardW = Math.min(cardH * 0.64, colW - 5) * pickScale;
      cardH = cardW / 0.64;
    }
    return { padX, leftW, labelH, cardW, cardH, rowH, colW };
  }, [size, spread, positions, mode]);

  return (
    <div ref={boxRef} className="relative h-full w-full">
      {geo &&
        positions.map((p, i) => {
          const deckIdx = slots[i] ?? null;
          const def = deckIdx != null ? TAROT_FULL_DECK[deckIdx] : null;
          const rev = revsBySlot[i] ?? false;
          const rot = p.rot ?? 0;
          const cellCx = geo.padX + geo.leftW + (p.x + 0.5) * geo.colW;
          const cellCy = (p.y + 0.5) * geo.rowH;
          // 视觉外包络（横牌时互换）
          const visW = rot === 90 ? geo.cardH : geo.cardW;
          const visH = rot === 90 ? geo.cardW : geo.cardH;
          const labelTop = cellCy + visH / 2 + 2 + (p.labelDy ?? 0);
          return (
            <div key={`${p.label}-${i}`} className="absolute" style={{ left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              {/* 牌位 */}
              <div
                data-slot-idx={i}
                ref={(el) => slotRefCb?.(i, el)}
                onClick={onSlotTap ? () => onSlotTap(i) : undefined}
                className="absolute"
                style={{
                  left: cellCx - geo.cardW / 2,
                  top: cellCy - geo.cardH / 2,
                  width: geo.cardW,
                  height: geo.cardH,
                  transform: rot ? `rotate(${rot}deg)` : undefined,
                  zIndex: rot ? 6 : 3,
                  cursor: onSlotTap ? 'pointer' : 'default',
                  pointerEvents: 'auto',
                }}
              >
                {def ? (
                  mode === 'pick' ? (
                    <div className="h-full w-full" style={{ animation: 'tarot-reveal-in 0.34s ease both' }}>
                      <CardBack w={geo.cardW} h={geo.cardH} />
                    </div>
                  ) : (
                    <FlipCard def={def} reversed={rev} flipped={flippedCount > i} w={geo.cardW} h={geo.cardH} rot={rot} />
                  )
                ) : (
                  <div
                    className={`absolute inset-0 rounded-[9px] border-[1.5px] border-dashed transition-colors ${
                      activeSlot === i ? 'border-gray-800/70 bg-white/60' : 'border-gray-300/90 bg-white/35'
                    }`}
                  >
                    {activeSlot === i && (
                      <div
                        className="absolute inset-0 rounded-[9px]"
                        style={{ animation: 'tarot-slot-pulse 1.5s ease-in-out infinite' }}
                      />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center font-semibold text-gray-300" style={{ fontSize: Math.max(8, geo.cardW * 0.22) }}>
                      {i + 1}
                    </span>
                  </div>
                )}
              </div>
              {/* 下方标签 */}
              {geo.labelH > 0 && (
                <div
                  className="absolute text-center"
                  style={{ left: cellCx - geo.colW / 2, top: labelTop, width: geo.colW, pointerEvents: 'none' }}
                >
                  {mode === 'pick' ? (
                    <div className="truncate text-[9px] leading-tight text-gray-500">{p.label}</div>
                  ) : (
                    <>
                      <div className="truncate text-[9.5px] font-semibold leading-tight text-gray-700">
                        第{i + 1}张 · {p.label}
                      </div>
                      {p.en && <div className="truncate text-[7.5px] uppercase tracking-[0.06em] leading-tight text-gray-400">{p.en}</div>}
                    </>
                  )}
                </div>
              )}
              {/* 左侧标签（脉轮竖列） */}
              {geo.leftW > 0 && (
                <div
                  className="absolute flex flex-col items-end justify-center text-right"
                  style={{ left: geo.padX, top: cellCy - 16, width: geo.leftW - 10, height: 32, pointerEvents: 'none' }}
                >
                  {mode === 'pick' ? (
                    <div className="text-[10px] font-medium text-gray-600">{p.label}</div>
                  ) : (
                    <>
                      <div className="text-[10px] font-semibold leading-tight text-gray-700">
                        第{i + 1}张 · {p.label}
                      </div>
                      {p.en && <div className="text-[7.5px] uppercase tracking-wide leading-tight text-gray-400">{p.en}</div>}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

// ---------------- 步骤指示（洗牌 → 牌阵 → 选牌 → 解读） ----------------

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-3">
      {['洗牌', '牌阵', '选牌', '解读'].map((s, i) => (
        <div key={s} className={`flex items-center gap-1 transition-colors ${i === step ? 'text-gray-900' : 'text-gray-400/80'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-gray-900' : 'bg-gray-300'}`} />
          <span className="text-[11.5px] font-medium">{s}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------- 主题选择（无图标，纯文字行） ----------------

function ThemeView({ themes, customQ, setCustomQ, onPick, historyCount, onHistory }: {
  themes: TarotTheme[];
  customQ: string;
  setCustomQ: (v: string) => void;
  onPick: (t: TarotTheme) => void;
  historyCount: number;
  onHistory: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  return (
    <div className="h-full overflow-y-auto overscroll-contain px-4 pb-6">
      <div className="pt-3 text-center">
        <div className="text-[22px] font-bold tracking-wide text-gray-900">选择占卜主题</div>
        <div className="mt-1 text-[12px] text-gray-500">静下心来，在心里默想你要问的事</div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {themes.map((t) =>
          t.custom ? (
            <div
              key={t.key}
              className={`overflow-hidden rounded-2xl border bg-white/60 backdrop-blur-xl shadow-[0_4px_18px_rgba(17,24,39,0.05)] transition-all ${
                customOpen ? 'border-gray-300 ring-1 ring-gray-900/10' : 'border-white/80'
              }`}
            >
              <button
                type="button"
                onClick={() => setCustomOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-opacity active:opacity-70"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-gray-900">{t.label}</span>
                  <span className="mt-0.5 block text-[12px] text-gray-500">{t.desc}</span>
                </span>
              </button>
              {customOpen && (
                <div className="px-4 pb-4" style={{ animation: 'tarot-text-in 0.28s ease both' }}>
                  <textarea
                    value={customQ}
                    onChange={(e) => setCustomQ(e.target.value)}
                    maxLength={60}
                    rows={2}
                    placeholder="例如：我们最近的关系会好吗？"
                    className="w-full resize-none rounded-xl border border-gray-200 bg-white/80 px-3 py-2.5 text-[13px] text-gray-900 outline-none placeholder:text-gray-300 focus:border-gray-400"
                    data-testid="tarot-custom-q"
                  />
                  <button
                    type="button"
                    disabled={customQ.trim().length < 2}
                    onClick={() => onPick(t)}
                    className="mt-2 h-10 w-full rounded-full bg-gray-900 text-[14px] font-semibold text-white shadow-[0_6px_18px_rgba(17,24,39,0.2)] transition-all active:scale-[0.98] active:opacity-90 disabled:opacity-35"
                  >
                    带着问题去洗牌
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              key={t.key}
              type="button"
              onClick={() => onPick(t)}
              className="flex w-full items-center justify-between rounded-2xl border border-white/80 bg-white/60 px-4 py-3.5 text-left backdrop-blur-xl shadow-[0_4px_18px_rgba(17,24,39,0.05)] transition-all active:scale-[0.98] active:bg-white/80"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-gray-900">{t.label}</span>
                <span className="mt-0.5 block text-[12px] text-gray-500">{t.desc}</span>
              </span>
            </button>
          ),
        )}
      </div>

      {historyCount > 0 && (
        <button
          type="button"
          onClick={onHistory}
          data-testid="tarot-history-entry"
          className="mt-4 w-full rounded-2xl border border-white/80 bg-white/45 py-3 text-[13px] text-gray-600 backdrop-blur-xl transition-opacity active:opacity-60"
        >
          占卜记录（{historyCount}）
        </button>
      )}
    </div>
  );
}

// ---------------- 洗牌（轻触一次 / 长按持续）+ 三叠切牌（第四十七轮重做） ----------------

const PILE = Array.from({ length: 16 }, (_, i) => ({
  x: Math.round(Math.sin(i * 2.7) * 9),
  y: Math.round(Math.cos(i * 1.9) * 7),
  r: ((i * 47) % 22) - 11,
  sx: ((i * 97) % 130) - 65,
  sy: -30 - ((i * 61) % 55),
  sr: ((i * 31) % 56) - 28,
  delay: ((i % 5) * 0.045).toFixed(2),
  dur: (0.72 + (i % 4) * 0.09).toFixed(2),
}));

/** 切牌阶段：idle → left（第一叠分到左）→ right（再从中间分一叠到右）→ hold（三叠停顿）→ merge（合拢） */
type CutPhase = 'idle' | 'left' | 'right' | 'hold' | 'merge';

// 切牌时间线：0 起 left，360ms 起 right，720ms 三叠停顿，960ms 合拢，1400ms 完成收尾（总计 1.4s）

/**
 * 牌堆里每张牌在三叠切牌中的目标状态：
 * cutFlip=false：左叠=顶部 6 张（i>=10），右叠=中间 5 张（5..9），中叠=底部 5 张（0..4）；
 * cutFlip=true 时各分界 -1。合拢顺序按真实切牌：右叠垫底、左叠其上、中叠在最顶。
 */
function pileCardState(o: (typeof PILE)[number], i: number, phase: CutPhase, cutFlip: boolean): {
  transform: string;
  zIndex: number;
  filter?: string;
  delay: number;
} {
  const leftFrom = cutFlip ? 11 : 10;
  const rightFrom = cutFlip ? 6 : 5;
  const inLeft = i >= leftFrom;
  const inRight = !inLeft && i >= rightFrom;
  const base = `translate(-50%,-50%) translate(${o.x}px,${o.y}px) rotate(${o.r}deg)`;
  const kl = i - leftFrom; // 组内序号（错峰用）
  const kr = i - rightFrom;
  if (inLeft) {
    if (phase === 'left' || phase === 'right' || phase === 'hold') {
      return {
        transform: `translate(-50%,-50%) translate(-104px, ${-3 - kl * 1.5}px) rotate(-7deg)`,
        zIndex: 40,
        filter: 'drop-shadow(0 12px 14px rgba(17,24,39,0.22))',
        delay: kl * 0.026,
      };
    }
    if (phase === 'merge') {
      return {
        transform: `translate(-50%,-50%) translate(${1 - kl * 0.3}px, ${-0.8 - kl * 0.35}px) rotate(-1.1deg)`,
        zIndex: 12,
        filter: 'drop-shadow(0 5px 8px rgba(17,24,39,0.15))',
        delay: 0.03 + kl * 0.018,
      };
    }
    return { transform: base, zIndex: 20, delay: 0 };
  }
  if (inRight) {
    if (phase === 'left') return { transform: base, zIndex: 14, delay: 0 };
    if (phase === 'right' || phase === 'hold') {
      return {
        transform: `translate(-50%,-50%) translate(104px, ${2 + kr * 1.4}px) rotate(6.5deg)`,
        zIndex: 30,
        filter: 'drop-shadow(0 12px 14px rgba(17,24,39,0.22))',
        delay: kr * 0.026,
      };
    }
    if (phase === 'merge') {
      return {
        transform: `translate(-50%,-50%) translate(${-0.8}px, ${0.5 + kr * 0.3}px) rotate(0.9deg)`,
        zIndex: 8,
        filter: 'drop-shadow(0 3px 6px rgba(17,24,39,0.1))',
        delay: kr * 0.018,
      };
    }
    return { transform: base, zIndex: 14, delay: 0 };
  }
  // 中叠（底部 5~6 张，合拢时在最顶）
  if (phase === 'merge') return { transform: base, zIndex: 20, filter: 'drop-shadow(0 6px 9px rgba(17,24,39,0.16))', delay: 0 };
  return { transform: base, zIndex: 10, delay: 0 };
}

function ShuffleView({ theme, question, tick, count, cutFlip, cutting, cutPhase, holding, onDown, onUp, onReshuffle }: {
  theme: TarotTheme;
  question: string;
  tick: number;
  count: number;
  cutFlip: boolean;
  cutting: boolean;
  cutPhase: CutPhase;
  holding: boolean;
  onDown: () => void;
  onUp: () => void;
  onReshuffle: () => void;
}) {
  const cutStage = count > 0; // 洗过一次即进入切牌阶段
  const hint = count === 0 ? '轻触牌堆洗一次 · 长按持续洗牌' : '请在牌堆处轻触，进行切牌';
  return (
    <div className="flex h-full flex-col items-center px-6">
      <div className="mt-2 text-center">
        <div className="text-[24px] font-bold tracking-wide text-gray-900">洗牌</div>
        <div className="mt-1 text-[12.5px] text-gray-500">
          {theme.label}
          {theme.custom && question ? ` · ${question}` : ''}
        </div>
      </div>

      {/* 牌堆（可按压：洗牌阶段轻触/长按洗牌，切牌阶段轻触切牌） */}
      <div
        className="relative mt-1 flex flex-1 items-center justify-center self-stretch touch-none select-none"
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onUp}
        data-testid="tarot-pile"
      >
        <div
          className="absolute h-44 w-44 rounded-full bg-white/90 blur-3xl"
          style={{ animation: 'tarot-pile-glow 2.6s ease-in-out infinite' }}
        />
        <div className="relative h-[172px] w-[110px]">
          {PILE.map((o, i) => {
            const st = cutting ? pileCardState(o, i, cutPhase, cutFlip) : null;
            return (
              <div
                key={i}
                className="absolute left-1/2 top-1/2"
                style={{
                  transform: st ? st.transform : `translate(-50%,-50%) translate(${o.x}px,${o.y}px) rotate(${o.r}deg)`,
                  zIndex: st ? st.zIndex : 10,
                  filter: st?.filter,
                  // delay 并入 shorthand（避免 transition/transitionDelay 混用告警）
                  transition: cutting ? `transform 340ms cubic-bezier(.4,.55,.3,1.04) ${(st?.delay ?? 0).toFixed(3)}s, filter 300ms ease ${(st?.delay ?? 0).toFixed(3)}s` : undefined,
                  willChange: cutting ? 'transform' : undefined,
                }}
              >
                {/* 洗牌层：key=tick 重挂载触发洗牌动画 */}
                <div
                  key={tick}
                  style={
                    tick > 0
                      ? ({ '--sx': `${o.sx}px`, '--sy': `${o.sy}px`, '--sr': `${o.sr}deg`, animation: `tarot-shuffle-card ${o.dur}s ease-in-out ${o.delay}s both`, willChange: 'transform' } as CSSProperties)
                      : undefined
                  }
                >
                  <CardBack w={110} h={172} />
                </div>
              </div>
            );
          })}
        </div>
        {holding && <div className="absolute bottom-1 text-[11.5px] text-gray-500" style={{ animation: 'tarot-star-pulse 1.2s ease-in-out infinite' }}>持续洗牌中…</div>}
        {cutting && <div className="absolute bottom-1 text-[11.5px] text-gray-500">切牌中…</div>}
      </div>

      {/* 提示 + 再洗一次（切牌动画完成后自动进入牌阵选择） */}
      <div className="flex w-full flex-col items-center gap-2.5 pb-6">
        <div className="text-[12px] text-gray-500">{hint}</div>
        {cutStage && !cutting && (
          <button
            type="button"
            onClick={onReshuffle}
            data-testid="tarot-reshuffle"
            className="h-9 rounded-full border border-white/90 bg-white/55 px-5 text-[12.5px] text-gray-500 backdrop-blur-xl transition-opacity active:opacity-60"
          >
            再洗一次
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------- 牌阵选择（图示 + 名称 + 简述 + 张数） ----------------

function SpreadGlyph({ spread }: { spread: TarotSpread }) {
  const W = 40;
  const H = 52;
  const maxN = spread.counts[spread.counts.length - 1];
  const pts = spread.positions(maxN);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden="true">
      <rect x="1" y="1" width={W - 2} height={H - 2} rx="7" className="fill-white/70 stroke-gray-200" />
      {pts.map((p, i) => {
        const cx = ((p.x + 0.5) / spread.cols) * (W - 10) + 5;
        const cy = ((p.y + 0.5) / spread.rows) * (H - 10) + 5;
        return p.rot ? (
          <rect key={i} x={cx - 2.4} y={cy - 3.8} width={4.8} height={7.6} rx={1.3} transform={`rotate(90 ${cx} ${cy})`} className="fill-gray-400" />
        ) : (
          <circle key={i} cx={cx} cy={cy} r={2.4} className="fill-gray-400" />
        );
      })}
    </svg>
  );
}

function SpreadView({ theme, question, onStart }: {
  theme: TarotTheme;
  question: string;
  onStart: (s: TarotSpread, n: number) => void;
}) {
  const [openVar, setOpenVar] = useState<string | null>(null);
  const groups: TarotSpread['group'][] = ['基础类', '主题类'];
  return (
    <div className="h-full overflow-y-auto overscroll-contain px-4 pb-6">
      <div className="pt-2 text-center">
        <div className="text-[21px] font-bold tracking-wide text-gray-900">选择牌阵</div>
        <div className="mt-1 truncate text-[12px] text-gray-500">
          {theme.label}
          {question ? ` · ${question}` : ''}
        </div>
      </div>

      {groups.map((g) => (
        <div key={g} className="mt-3">
          <div className="px-1 text-[11px] font-semibold text-gray-400">【{g}】</div>
          <div className="mt-1.5 flex flex-col gap-2">
            {TAROT_SPREADS.filter((s) => s.group === g).map((s) => {
              const variable = s.counts.length > 1;
              const open = openVar === s.key;
              return (
                <div
                  key={s.key}
                  className={`overflow-hidden rounded-2xl border bg-white/60 backdrop-blur-xl shadow-[0_4px_16px_rgba(17,24,39,0.05)] transition-all ${
                    open ? 'border-gray-300 ring-1 ring-gray-900/10' : 'border-white/80'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => (variable ? setOpenVar(open ? null : s.key) : onStart(s, s.counts[0]))}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-opacity active:opacity-70"
                    data-testid={`tarot-spread-${s.key}`}
                  >
                    <SpreadGlyph spread={s} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold text-gray-900">{s.name}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-gray-500">{s.desc}</span>
                    </span>
                    <span className="shrink-0 rounded-full border border-gray-200/90 bg-white/80 px-2 py-0.5 text-[10px] text-gray-600">
                      {variable ? `${s.counts[0]}-${s.counts[s.counts.length - 1]}张` : `${s.counts[0]}张`}
                    </span>
                  </button>
                  {open && variable && (
                    <div className="flex items-center gap-2 px-3 pb-3" style={{ animation: 'tarot-text-in 0.24s ease both' }}>
                      {s.counts.map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => onStart(s, n)}
                          className="h-9 flex-1 rounded-full border border-gray-200 bg-white/85 text-[13px] font-medium text-gray-800 transition-all active:scale-[0.97] active:opacity-70"
                        >
                          {n} 张牌
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- 右缘扇形牌轮（78 张，上下滑动 / 双指缩放 / 点选飞牌） ----------------

const WHEEL_STEP = 360 / 78;
const WHEEL_R = 400; // 第四十七轮：牌轮半径加大（扇形更高、更贴右缘展开）
const WHEEL_MIN_SCALE = 0.7;
const WHEEL_MAX_SCALE = 1.4;
const CARD_W = 88; // 第四十七轮：牌轮上的牌变大
const CARD_H = 137;

function CardWheel({ hidden, onTapCard, varRef }: { hidden: number[]; onTapCard: (idx: number, el: HTMLElement) => void; varRef?: React.MutableRefObject<string> }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(12); // 初始让第 1 张牌完整露出在屏底上方
  const scaleRef = useRef(1);
  const velRef = useRef(0);
  const rafRef = useRef(0);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const modeRef = useRef<'none' | 'drag' | 'pinch'>('none');
  const lastXRef = useRef(0);
  const lastYRef = useRef(0);
  const pinch0Ref = useRef({ dist: 0, scale: 1 });
  const movedRef = useRef(false);
  const downAtRef = useRef(0);

  const applyVars = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const wa = `${angleRef.current.toFixed(2)}deg`;
    el.style.setProperty('--wa', wa);
    el.style.setProperty('--ws', scaleRef.current.toFixed(3));
    if (varRef) varRef.current = wa;
  }, [varRef]);

  useEffect(() => {
    applyVars();
    return () => window.cancelAnimationFrame(rafRef.current);
  }, [applyVars]);

  /** 惯性旋转 */
  function spin() {
    rafRef.current = requestAnimationFrame(() => {
      angleRef.current += velRef.current;
      velRef.current *= 0.93;
      applyVars();
      if (Math.abs(velRef.current) > 0.04) spin();
    });
  }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    window.cancelAnimationFrame(rafRef.current);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    downAtRef.current = Date.now();
    movedRef.current = false;
    if (ptrs.current.size === 1) {
      modeRef.current = 'drag';
      lastXRef.current = e.clientX;
      lastYRef.current = e.clientY;
      velRef.current = 0;
    } else if (ptrs.current.size === 2) {
      modeRef.current = 'pinch';
      const [a, b] = Array.from(ptrs.current.values());
      pinch0Ref.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: scaleRef.current };
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const prev = ptrs.current.get(e.pointerId);
      if (!prev) return;
      ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (modeRef.current === 'drag' && ptrs.current.size === 1) {
        const dy = e.clientY - lastYRef.current;
        const dx = e.clientX - lastXRef.current;
        lastYRef.current = e.clientY;
        lastXRef.current = e.clientX;
        if (Math.abs(dy) > 2 || Math.abs(dx) > 2) movedRef.current = true;
        // 右缘牌轮：上下滑动为主（拖上=牌向上走），横向给一点辅助
        const delta = -dy * 0.34 + dx * 0.1;
        angleRef.current += delta;
        velRef.current = velRef.current * 0.7 + delta * 0.3;
        applyVars();
      } else if (modeRef.current === 'pinch' && ptrs.current.size === 2) {
        movedRef.current = true;
        const [a, b] = Array.from(ptrs.current.values());
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        scaleRef.current = Math.min(WHEEL_MAX_SCALE, Math.max(WHEEL_MIN_SCALE, pinch0Ref.current.scale * (dist / pinch0Ref.current.dist)));
        applyVars();
      }
    },
    [applyVars],
  );

  const endPtr = useCallback(
    (e: React.PointerEvent) => {
      ptrs.current.delete(e.pointerId);
      if (modeRef.current === 'pinch' && ptrs.current.size === 1) {
        modeRef.current = 'drag';
        const [a] = Array.from(ptrs.current.values());
        lastXRef.current = a.x;
        lastYRef.current = a.y;
      }
      if (ptrs.current.size === 0) {
        if (modeRef.current === 'drag' && Math.abs(velRef.current) > 0.35) spin();
        modeRef.current = 'none';
        // 点选（未拖动 + 快速点按）
        if (!movedRef.current && Date.now() - downAtRef.current < 420) {
          const el = e.target as HTMLElement | null;
          const card = el?.closest('[data-card-idx]') as HTMLElement | null;
          if (card) onTapCard(Number(card.dataset.cardIdx), card);
        }
      }
    },
    [onTapCard, spin],
  );

  return (
    <div
      ref={wrapRef}
      className="relative min-h-0 flex-1 touch-none select-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPtr}
      onPointerCancel={endPtr}
      onPointerLeave={endPtr}
      data-testid="tarot-wheel"
    >
      <div className="pointer-events-none absolute left-3 top-1.5 text-[10px] text-gray-400">上下滑动 · 双指缩放 · 点选牌背</div>
      {TAROT_FULL_DECK.map((c, i) => {
        const gone = hidden.includes(i);
        return (
          <div
            key={c.id}
            data-card-idx={i}
            className="absolute cursor-pointer"
            style={{
              left: 'calc(100% + 30px)',
              top: '100%',
              width: CARD_W,
              height: CARD_H,
              marginLeft: -CARD_W / 2,
              marginTop: -CARD_H / 2,
              transform: `rotate(calc(var(--wa, 0deg) + ${i * WHEEL_STEP}deg)) translateX(calc(${-WHEEL_R}px * var(--ws, 1)))`,
              willChange: 'transform',
              zIndex: 10,
              opacity: gone ? 0 : 1,
              pointerEvents: gone ? 'none' : 'auto',
              transition: gone ? 'opacity 0.16s ease' : undefined,
            }}
          >
            <CardBack w={CARD_W} h={CARD_H} />
          </div>
        );
      })}
    </div>
  );
}

// ---------------- 飞牌动画（牌轮 → 牌位） ----------------

interface FlyState {
  idx: number;
  slotIdx: number;
  gx: number; // 起点（页面容器内坐标）
  gy: number;
  tx: number; // 终点
  ty: number;
  rot: number; // 牌位角度
  theta: number; // 起飞时牌在轮上的倾角
  sx: number;
  sy: number;
  go: boolean;
}

function FlyGhost({ fly, onEnd }: { fly: FlyState; onEnd: () => void }) {
  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{
        left: fly.gx,
        top: fly.gy,
        width: CARD_W,
        height: CARD_H,
        marginLeft: -CARD_W / 2,
        marginTop: -CARD_H / 2,
        transform: fly.go
          ? `translate(${fly.tx - fly.gx}px, ${fly.ty - fly.gy}px) rotate(${fly.rot}deg) scale(${fly.sx.toFixed(3)}, ${fly.sy.toFixed(3)})`
          : `rotate(${fly.theta.toFixed(1)}deg)`,
        transition: fly.go ? 'transform 520ms cubic-bezier(.3,.75,.25,1)' : undefined,
        willChange: 'transform',
      }}
      onTransitionEnd={onEnd}
    >
      <CardBack w={CARD_W} h={CARD_H} />
    </div>
  );
}

// ---------------- 选牌视图（动态牌位框 + 右缘牌轮） ----------------

function pickSlotsH(spread: TarotSpread): string {
  return `${Math.min(46, 22 + spread.rows * 5)}%`;
}

function PickView({ theme, question, spread, positions, slots, revsBySlot, filledCount, fly, wheelVarRef, slotRefCb, onSlotTap, onCardTap, onFlip }: {
  theme: TarotTheme;
  question: string;
  spread: TarotSpread;
  positions: SpreadPos[];
  slots: (number | null)[];
  revsBySlot: boolean[];
  filledCount: number;
  fly: FlyState | null;
  wheelVarRef: React.MutableRefObject<string>;
  slotRefCb: (i: number, el: HTMLDivElement | null) => void;
  onSlotTap: (i: number) => void;
  onCardTap: (idx: number, el: HTMLElement) => void;
  onFlip: () => void;
}) {
  const need = positions.length;
  const full = filledCount >= need;
  const hidden = useMemo(() => {
    const arr = slots.filter((s): s is number => s !== null);
    if (fly) arr.push(fly.idx);
    return arr;
  }, [slots, fly]);

  return (
    <div className="relative flex h-full flex-col">
      <div className="shrink-0 px-5 pt-1 text-center">
        <div className="truncate text-[11px] text-gray-500">
          {spread.name} · {theme.label}
          {theme.custom && question ? ` · ${question}` : ''}
        </div>
        <div className="mt-0.5 text-[20px] font-bold tracking-wide text-gray-900">{full ? '选好了' : `选择第 ${filledCount + 1} 张牌`}</div>
        <div className="mt-0.5 truncate text-[11px] text-gray-500">
          {full ? '点击下方「翻牌」揭晓' : `牌位：${positions[filledCount]?.label ?? ''} · 已选 ${filledCount}/${need}${filledCount > 0 ? ' · 点牌位可收回' : ''}`}
        </div>
      </div>

      {/* 动态牌位框 */}
      <div className="shrink-0 px-2 pt-1.5" style={{ height: pickSlotsH(spread) }}>
        <SpreadSlots
          spread={spread}
          positions={positions}
          slots={slots}
          revsBySlot={revsBySlot}
          flippedCount={0}
          mode="pick"
          activeSlot={full ? undefined : filledCount}
          onSlotTap={onSlotTap}
          slotRefCb={slotRefCb}
        />
      </div>

      {/* 右缘扇形牌轮 */}
      <CardWheel hidden={hidden} onTapCard={onCardTap} varRef={wheelVarRef} />

      {/* 翻牌按钮（选满后浮在牌轮上方） */}
      {full && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
          <button
            type="button"
            onClick={onFlip}
            data-testid="tarot-flip"
            className="pointer-events-auto h-12 rounded-full bg-gray-900 px-14 text-[15px] font-semibold text-white shadow-[0_10px_26px_rgba(17,24,39,0.28)] transition-all active:scale-[0.97]"
          >
            翻牌
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------- 翻牌 / 解读 / 结果 ----------------

function revealSlotsH(rows: number): number {
  if (rows <= 1) return 225;
  if (rows === 2) return 262;
  if (rows === 3) return 302;
  if (rows === 4) return 342;
  return 380;
}

function ReadingCard({ reading, positions, drawnDefs }: {
  reading: { per: string[]; overall: string; aiUsed: boolean } | null;
  positions: SpreadPos[];
  drawnDefs: { def: TarotCardDef; reversed: boolean }[];
}) {
  return (
    <div className="mt-3 rounded-2xl border border-white/80 bg-white/65 p-4 backdrop-blur-xl shadow-[0_6px_22px_rgba(17,24,39,0.06)]" data-testid="tarot-reading">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full border font-serif text-[15px]"
          style={{ borderColor: 'rgba(67,57,43,0.35)', background: PAPER_BG, color: INK }}
        >
          ☾
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-gray-900">塔罗解读</div>
          <div className="text-[10.5px] text-gray-500">按牌位职责 · 按正逆位牌意</div>
        </div>
      </div>

      {!reading ? (
        <div className="mt-3.5 flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/90 px-3.5 py-3" data-testid="tarot-reading-loading">
          <span className="relative flex h-6 w-6 items-center justify-center">
            <span className="absolute inset-0 rounded-full border-2 border-gray-300 border-t-gray-800" style={{ animation: 'tarot-halo-spin 0.9s linear infinite' }} />
            <Star className="h-2.5 w-2.5 text-gray-700" />
          </span>
          <span className="text-[12.5px] text-gray-600">正在解读这副牌…</span>
        </div>
      ) : (
        <div className="mt-3.5 flex flex-col gap-3">
          {reading.per.map((t, i) => {
            const c = drawnDefs[i];
            return (
              <div key={i} className="rounded-xl border border-gray-100 bg-gray-50/90 px-3.5 py-3" style={{ animation: `tarot-text-in 0.45s ease ${i * 0.12}s both` }}>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[12px] font-semibold text-gray-900">{positions[i]?.label ?? ''}</span>
                  {c && <span className="text-[11px] text-gray-500">{c.def.name} · {c.reversed ? '逆位' : '正位'}</span>}
                </div>
                <p className="mt-1 text-[13.5px] leading-[1.75] text-gray-800">{t}</p>
              </div>
            );
          })}
          {reading.overall && (
            <div className="rounded-xl border border-gray-200 bg-white/90 px-3.5 py-3" style={{ animation: 'tarot-text-in 0.45s ease 0.2s both' }}>
              <p className="text-[13.5px] leading-[1.8] text-gray-900">{reading.overall}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RevealBody({ spread, positions, slots, revsBySlot, flippedCount, mode, theme, question, reading, footer }: {
  spread: TarotSpread;
  positions: SpreadPos[];
  slots: (number | null)[];
  revsBySlot: boolean[];
  flippedCount: number;
  mode: 'flip' | 'done';
  theme: { label: string };
  question: string;
  reading: { per: string[]; overall: string; aiUsed: boolean } | null;
  footer?: React.ReactNode;
}) {
  const drawnDefs = slots
    .map((s, i) => (s !== null ? { def: TAROT_FULL_DECK[s], reversed: revsBySlot[i] ?? false } : null))
    .filter((x): x is { def: TarotCardDef; reversed: boolean } => !!x);
  return (
    <div className="h-full overflow-y-auto overscroll-contain px-4 pb-5">
      <div className="pt-1 text-center">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-gray-400">{spread.name}</div>
        <div className="mt-0.5 text-[18px] font-bold text-gray-900">
          {theme.label}
          {question ? `：「${question}」` : ''}
        </div>
      </div>

      <div className="mx-auto mt-2 px-1" style={{ height: revealSlotsH(spread.rows) }}>
        <SpreadSlots spread={spread} positions={positions} slots={slots} revsBySlot={revsBySlot} flippedCount={flippedCount} mode={mode} />
      </div>

      <ReadingCard reading={reading} positions={positions} drawnDefs={drawnDefs} />
      {footer}
    </div>
  );
}

// ---------------- 历史记录 ----------------

/** 从持久化记录还原牌阵与牌位（旧记录无 spreadKey 时退化为横排） */
function spreadInfoOf(r: TarotReading): { spread: TarotSpread; positions: SpreadPos[] } {
  const n = Math.max(1, r.cards.length);
  const s = r.spreadKey ? tarotSpreadByKey(r.spreadKey) : undefined;
  if (s) return { spread: s, positions: s.positions(n) };
  const labels = r.spread?.length ? r.spread : Array.from({ length: n }, (_, i) => `第${i + 1}张`);
  const pseudo: TarotSpread = {
    key: 'row',
    name: r.spreadName || '牌阵',
    group: '基础类',
    desc: '',
    counts: [n],
    cols: n,
    rows: 1,
    positions: (m) => labels.slice(0, m).map((lb, i) => ({ label: lb, en: r.posEn?.[i] ?? '', hint: '', x: i, y: 0 })),
  };
  return { spread: pseudo, positions: pseudo.positions(n) };
}

function HistoryView({ readings, onBack, onOpen }: {
  readings: TarotReading[];
  onBack: () => void;
  onOpen: (r: TarotReading) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-5 pt-2 text-center">
        <div className="text-[20px] font-bold tracking-wide text-gray-900">占卜记录</div>
        <div className="mt-0.5 text-[12px] text-gray-500">每一次提问，牌都有回应</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-3">
        {readings.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-gray-400">
            <Star className="h-6 w-6" strokeWidth={1.5} />
            <span className="text-[13px]">还没有占卜记录</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {readings.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpen(r)}
                data-testid="tarot-history-item"
                className="rounded-2xl border border-white/80 bg-white/60 px-4 py-3.5 text-left backdrop-blur-xl shadow-[0_4px_16px_rgba(17,24,39,0.05)] transition-all active:scale-[0.98]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[14.5px] font-bold text-gray-900">{r.themeLabel}</span>
                  {r.spreadName && <span className="shrink-0 rounded-full border border-gray-200 bg-white/80 px-2 py-0.5 text-[10px] text-gray-600">{r.spreadName}</span>}
                  {r.question ? <span className="min-w-0 flex-1 truncate text-[11.5px] text-gray-500">「{r.question}」</span> : <span className="flex-1" />}
                  <span className="shrink-0 text-[10.5px] text-gray-400">{fmtTs(r.at)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.cards.map((c, i) => {
                    const def = tarotCardById(c.defId);
                    return (
                      <span key={i} className="rounded-full border border-gray-200/90 bg-gray-50 px-2 py-0.5 text-[10.5px] text-gray-700">
                        {r.spread?.[i] ? `${r.spread[i]}·` : ''}{def?.name ?? '?'} {c.reversed ? '· 逆' : ''}
                      </span>
                    );
                  })}
                </div>
                {r.overall && <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-gray-600">{r.overall}</p>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 px-4 pb-5">
        <button type="button" onClick={onBack} className="h-11 w-full rounded-full border border-white/90 bg-white/65 text-[14px] font-medium text-gray-800 backdrop-blur-xl transition-opacity active:opacity-60">
          返回
        </button>
      </div>
    </div>
  );
}

// ---------------- 主组件 ----------------

type View = 'theme' | 'shuffle' | 'spread' | 'pick' | 'reveal' | 'history' | 'detail';

export default function CoupleTarotPage({ state, patch, showToast, close }: {
  state: CoupleState;
  patch: (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void;
  showToast: (m: string) => void;
  close: () => void;
}) {
  const meta = readInviteMeta();
  const cid = meta.partnerContactId || 'default';
  const channel = meta.partnerApp ?? 'wx';
  const meName = (state.meName || '').trim() || '我';

  const [view, setView] = useState<View>('theme');
  const [theme, setTheme] = useState<TarotTheme | null>(null);
  const [customQ, setCustomQ] = useState('');
  const [shuffleTick, setShuffleTick] = useState(0);
  const [shuffleCount, setShuffleCount] = useState(0);
  const [cutCount, setCutCount] = useState(0);
  const [cutFlip, setCutFlip] = useState(false);
  const [cutting, setCutting] = useState(false);
  const [cutPhase, setCutPhase] = useState<CutPhase>('idle');
  const [holding, setHolding] = useState(false);
  const [spread, setSpread] = useState<TarotSpread | null>(null);
  const [spreadN, setSpreadN] = useState(1);
  const [slots, setSlots] = useState<(number | null)[]>([]);
  const [fly, setFly] = useState<FlyState | null>(null);
  const revsRef = useRef<boolean[]>([]); // 每张牌的正/逆位（进牌轮时预定，翻牌时揭晓）
  const [flipped, setFlipped] = useState(0);
  const [reading, setReading] = useState<{ per: string[]; overall: string; aiUsed: boolean } | null>(null);
  const [detail, setDetail] = useState<TarotReading | null>(null);

  const positions = useMemo(() => (spread ? spread.positions(spreadN) : []), [spread, spreadN]);
  const filledCount = useMemo(() => slots.reduce<number>((acc, s) => acc + (s !== null ? 1 : 0), 0), [slots]);
  const revsBySlot = useMemo(() => slots.map((idx) => (idx !== null ? revsRef.current[idx] ?? false : false)), [slots]);

  const readings = state.tarotReadings?.[cid] ?? [];

  // —— 洗牌：轻触一次 / 长按持续 ——
  const pressTimer = useRef<number | null>(null);
  const holdingRef = useRef(false);
  const cuttingRef = useRef(false);
  const doShuffle = useCallback(() => {
    if (cuttingRef.current) return;
    setShuffleTick((t) => t + 1);
    setShuffleCount((n) => n + 1);
  }, []);
  const cutStage = shuffleCount > 0; // 洗过一次即进入切牌阶段
  const cutStageRef = useRef(false);
  cutStageRef.current = cutStage;

  // —— 三叠切牌（1.4s）：左叠分出 → 右叠分出 → 三叠停顿 → 合拢（右垫底·左其上·中顶） → 自动进牌阵 ——
  const cutTimersRef = useRef<number[]>([]);
  const doCut = useCallback(() => {
    if (cuttingRef.current || shuffleCount === 0) return; // 防抖：动画中不重复触发
    cuttingRef.current = true;
    setCutting(true);
    setCutPhase('left');
    setCutCount((n) => n + 1);
    const t = cutTimersRef.current;
    t.push(window.setTimeout(() => setCutPhase('right'), 360));
    t.push(window.setTimeout(() => setCutPhase('hold'), 720));
    t.push(window.setTimeout(() => setCutPhase('merge'), 960));
    t.push(
      window.setTimeout(() => {
        cuttingRef.current = false;
        setCutting(false);
        setCutPhase('idle');
        setCutFlip((f) => !f); // 换一组切分，动画可重复
        setView('spread'); // 切牌完成，自动进入牌阵选择
      }, 1440),
    );
  }, [shuffleCount]);
  useEffect(
    () => () => {
      cutTimersRef.current.forEach((id) => window.clearTimeout(id));
      cutTimersRef.current = [];
    },
    [],
  );

  const pileDown = useCallback(() => {
    if (cuttingRef.current) return;
    if (cutStageRef.current) return; // 切牌阶段：按下不启动长按洗牌
    holdingRef.current = false;
    pressTimer.current = window.setTimeout(() => {
      holdingRef.current = true;
      setHolding(true);
      doShuffle();
    }, 380);
  }, [doShuffle]);
  const pileUp = useCallback(() => {
    if (cuttingRef.current) return;
    if (cutStageRef.current) {
      // 切牌阶段：轻触牌堆 = 切牌（cuttingRef 防抖，动画中不重复触发）
      doCut();
      return;
    }
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    if (holdingRef.current) {
      holdingRef.current = false;
      setHolding(false);
    } else {
      doShuffle();
    }
  }, [doShuffle, doCut]);
  useEffect(() => {
    if (!holding) return;
    const iv = window.setInterval(doShuffle, 1000);
    return () => window.clearInterval(iv);
  }, [holding, doShuffle]);
  useEffect(
    () => () => {
      if (pressTimer.current != null) window.clearTimeout(pressTimer.current);
    },
    [],
  );

  // —— 选定牌阵 → 进入选牌 ——
  const startSpread = useCallback((s: TarotSpread, n: number) => {
    revsRef.current = TAROT_FULL_DECK.map(() => Math.random() < 0.38);
    setSpread(s);
    setSpreadN(n);
    setSlots(Array(n).fill(null));
    setFlipped(0);
    setReading(null);
    setFly(null);
    flyRef.current = null;
    setView('pick');
  }, []);

  // —— 飞牌：点牌轮上的牌 → 飞入第 1 个空牌位 ——
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const flyRef = useRef<FlyState | null>(null);
  flyRef.current = fly;
  const slotEls = useRef<(HTMLDivElement | null)[]>([]);
  const pageRef = useRef<HTMLDivElement>(null);
  const slotRefCb = useCallback((i: number, el: HTMLDivElement | null) => {
    slotEls.current[i] = el;
  }, []);

  const handleCardTap = useCallback(
    (idx: number, el: HTMLElement) => {
      if (flyRef.current) return;
      const cur = slotsRef.current;
      const slotIdx = cur.findIndex((s) => s === null);
      if (slotIdx < 0) return;
      const slotEl = slotEls.current[slotIdx];
      const commit = () =>
        setSlots((prev) => {
          if (prev[slotIdx] != null) return prev;
          const n = [...prev];
          n[slotIdx] = idx;
          return n;
        });
      if (!slotEl || !pageRef.current) {
        commit();
        return;
      }
      const sr = el.getBoundingClientRect();
      const tr = slotEl.getBoundingClientRect();
      const cr = pageRef.current.getBoundingClientRect();
      const rot = positions[slotIdx]?.rot ?? 0;
      // 牌在轮上的当前倾角（取视觉连续的 -90~90 范围）
      const wa = parseFloat(wheelVarRef.current) || 0;
      let theta = (((wa + idx * WHEEL_STEP) % 360) + 360) % 360;
      if (theta > 180) theta -= 360;
      if (theta > 90) theta -= 180;
      if (theta < -90) theta += 180;
      const g: FlyState = {
        idx,
        slotIdx,
        gx: sr.left + sr.width / 2 - cr.left,
        gy: sr.top + sr.height / 2 - cr.top,
        tx: tr.left + tr.width / 2 - cr.left,
        ty: tr.top + tr.height / 2 - cr.top,
        rot,
        theta,
        sx: (rot === 90 ? tr.height : tr.width) / CARD_W,
        sy: (rot === 90 ? tr.width : tr.height) / CARD_H,
        go: false,
      };
      flyRef.current = g;
      setFly(g);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (flyRef.current !== g) return;
          const gg = { ...g, go: true };
          flyRef.current = gg;
          setFly(gg);
        }),
      );
    },
    [positions],
  );

  const onFlyEnd = useCallback(() => {
    const g = flyRef.current;
    if (!g) return;
    flyRef.current = null;
    setFly(null);
    setSlots((prev) => {
      if (prev[g.slotIdx] != null) return prev;
      const n = [...prev];
      n[g.slotIdx] = g.idx;
      return n;
    });
  }, []);

  const handleSlotTap = useCallback((i: number) => {
    if (flyRef.current) return;
    setSlots((prev) => {
      if (prev[i] == null) return prev;
      const n = [...prev];
      n[i] = null;
      return n;
    });
  }, []);

  // 牌轮当前角度（供飞牌取起飞倾角，CardWheel 每帧写入）
  const wheelVarRef = useRef('0');

  // —— 翻牌视图：逐张翻开 + AI 解读 ——
  const readingStarted = useRef(false);
  useEffect(() => {
    if (view !== 'reveal') return;
    const drawn = slots
      .filter((s): s is number => s !== null)
      .map((idx) => ({ def: TAROT_FULL_DECK[idx], reversed: revsRef.current[idx] ?? false }));
    if (drawn.length === 0) return;
    readingStarted.current = false;
    setFlipped(0);
    const timers: number[] = [];
    drawn.forEach((_, i) => {
      timers.push(window.setTimeout(() => setFlipped((f) => Math.max(f, i + 1)), 420 + i * 560));
    });
    timers.push(
      window.setTimeout(() => {
        if (readingStarted.current) return;
        readingStarted.current = true;
        const cards: TarotAiCard[] = drawn.map((c, i) => ({
          pos: positions[i]?.label ?? '牌面',
          posEn: positions[i]?.en,
          posHint: positions[i]?.hint,
          name: c.def.name,
          nameEn: c.def.nameEn,
          reversed: c.reversed,
          meaning: c.reversed ? c.def.reversed : c.def.upright,
          keys: c.reversed ? c.def.revKeys : c.def.upKeys,
        }));
        void (async () => {
          let res: { per: string[]; overall: string } | null = null;
          try {
            res = await aiTarotReading({
              themeLabel: theme?.label ?? '',
              question: theme?.custom ? customQ.trim() : undefined,
              spreadName: spread?.name ?? '',
              cards,
            });
          } catch {
            res = null;
          }
          const final = res ?? fallbackReading(positions, drawn);
          setReading({ ...final, aiUsed: !!res });
          // 持久化（按联系人隔离）+ 写记忆（塔罗事件）
          const record: TarotReading = {
            id: `tarot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            at: Date.now(),
            themeKey: theme?.key ?? 'custom',
            themeLabel: theme?.label ?? '',
            question: theme?.custom ? customQ.trim() : '',
            spreadKey: spread?.key ?? '',
            spreadName: spread?.name ?? '',
            spread: positions.map((p) => p.label),
            posEn: positions.map((p) => p.en),
            cards: drawn.map((c) => ({ defId: c.def.id, reversed: c.reversed })),
            per: final.per,
            overall: final.overall,
            aiUsed: !!res,
          };
          patch((prev) => ({
            tarotReadings: {
              ...(prev.tarotReadings ?? {}),
              [cid]: [record, ...((prev.tarotReadings ?? {})[cid] ?? [])].slice(0, 60),
            },
          }));
          const cardStr = drawn.map((c, i) => `${positions[i]?.label ?? ''}位-${c.def.name}${c.reversed ? '（逆位）' : ''}`).join('、');
          coupleTarotRemember(
            meta.partnerContactId ? cid : '',
            channel,
            `（塔罗事件）${meName}在恋人空间用塔罗牌以「${spread?.name ?? ''}」牌阵占卜「${theme?.label ?? ''}」${theme?.custom && customQ.trim() ? `（问题：${cutText(customQ.trim(), 24)}）` : ''}，抽到 ${cardStr}。${cutText(final.overall, 90)}`,
          );
          showToast('占卜完成，已写入你们的记忆');
        })();
      }, 420 + drawn.length * 560 + 340),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [view]);

  // —— 再来一次 ——
  const restart = useCallback(() => {
    setTheme(null);
    setCustomQ('');
    setSpread(null);
    setSpreadN(1);
    setSlots([]);
    setFlipped(0);
    setReading(null);
    setFly(null);
    flyRef.current = null;
    setShuffleCount(0);
    setShuffleTick(0);
    setCutCount(0);
    setCutFlip(false);
    setCutting(false);
    setCutPhase('idle');
    cuttingRef.current = false;
    setView('theme');
  }, []);

  const back = useCallback(() => {
    if (view === 'shuffle') setView('theme');
    else if (view === 'spread') setView('shuffle');
    else if (view === 'pick') {
      setSlots([]);
      setFly(null);
      flyRef.current = null;
      setView('spread');
    } else if (view === 'reveal') restart();
    else if (view === 'history' || view === 'detail') setView('theme');
    else close();
  }, [view, close, restart]);

  const step = view === 'shuffle' ? 0 : view === 'spread' ? 1 : view === 'pick' ? 2 : view === 'reveal' ? 3 : -1;

  return (
    <div ref={pageRef} className="relative flex h-full flex-col overflow-hidden bg-[#f1f2f4] text-gray-900">
      {/* 浅色氛围光斑 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-28 h-72 w-72 rounded-full bg-white/85 blur-3xl" />
        <div className="absolute -right-24 top-1/4 h-72 w-72 rounded-full bg-gray-300/40 blur-3xl" />
        <div className="absolute -bottom-20 left-1/5 h-64 w-64 rounded-full bg-white/80 blur-3xl" />
      </div>

      {/* 顶栏 */}
      <div className="relative z-10 shrink-0 pt-[54px]">
        <div className="relative flex h-11 items-center px-1.5">
          <button type="button" onClick={back} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-gray-800 transition-opacity active:opacity-50">
            <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[16px] font-bold tracking-wide">爱情塔罗</div>
          <div className="ml-auto pr-2">{step >= 0 && <StepBar step={step} />}</div>
        </div>
      </div>

      <div className="relative z-10 min-h-0 flex-1">
        {view === 'theme' && (
          <ThemeView
            themes={THEMES}
            customQ={customQ}
            setCustomQ={setCustomQ}
            onPick={(t) => {
              setTheme(t);
              setShuffleCount(0);
              setShuffleTick(0);
              setCutCount(0);
              setCutFlip(false);
              setView('shuffle');
            }}
            historyCount={readings.length}
            onHistory={() => setView('history')}
          />
        )}
        {view === 'shuffle' && theme && (
          <ShuffleView
            theme={theme}
            question={theme.custom ? customQ.trim() : ''}
            tick={shuffleTick}
            count={shuffleCount}
            cutFlip={cutFlip}
            cutting={cutting}
            cutPhase={cutPhase}
            holding={holding}
            onDown={pileDown}
            onUp={pileUp}
            onReshuffle={doShuffle}
          />
        )}
        {view === 'spread' && theme && (
          <SpreadView theme={theme} question={theme.custom ? customQ.trim() : ''} onStart={startSpread} />
        )}
        {view === 'pick' && theme && spread && (
          <PickView
            theme={theme}
            question={theme.custom ? customQ.trim() : ''}
            spread={spread}
            positions={positions}
            slots={slots}
            revsBySlot={revsBySlot}
            filledCount={filledCount}
            fly={fly}
            wheelVarRef={wheelVarRef}
            slotRefCb={slotRefCb}
            onSlotTap={handleSlotTap}
            onCardTap={handleCardTap}
            onFlip={() => setView('reveal')}
          />
        )}
        {view === 'reveal' && theme && spread && slots.length > 0 && (
          <RevealBody
            spread={spread}
            positions={positions}
            slots={slots}
            revsBySlot={revsBySlot}
            flippedCount={flipped}
            mode="flip"
            theme={{ label: theme.label }}
            question={theme.custom ? customQ.trim() : ''}
            reading={reading}
            footer={
              reading ? (
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setView('history')}
                    className="h-11 rounded-full border border-white/90 bg-white/65 text-[14px] font-medium text-gray-800 backdrop-blur-xl transition-opacity active:opacity-60"
                  >
                    占卜记录
                  </button>
                  <button
                    type="button"
                    onClick={restart}
                    data-testid="tarot-again"
                    className="h-11 rounded-full bg-gray-900 text-[14px] font-semibold text-white shadow-[0_6px_18px_rgba(17,24,39,0.22)] transition-all active:scale-[0.97] active:opacity-90"
                  >
                    再占一次
                  </button>
                </div>
              ) : null
            }
          />
        )}
        {view === 'history' && (
          <HistoryView
            readings={readings}
            onBack={back}
            onOpen={(r) => {
              setDetail(r);
              setView('detail');
            }}
          />
        )}
        {view === 'detail' && detail && (
          <DetailPage
            reading={detail}
            onBack={() => {
              setDetail(null);
              setView('history');
            }}
            onDelete={onDeleteDetail}
          />
        )}
      </div>

      {/* 飞牌幽灵（挂顶层，坐标相对页面容器） */}
      {fly && view === 'pick' && <FlyGhost fly={fly} onEnd={onFlyEnd} />}
    </div>
  );

  // —— 删除历史记录 ——
  function onDeleteDetail() {
    if (!detail) return;
    patch((prev) => ({
      tarotReadings: {
        ...(prev.tarotReadings ?? {}),
        [cid]: ((prev.tarotReadings ?? {})[cid] ?? []).filter((r) => r.id !== detail.id),
      },
    }));
    showToast('已删除这条占卜记录');
    setDetail(null);
    setView('history');
  }
}

// ---------------- 历史详情 ----------------

function DetailPage({ reading, onBack, onDelete }: {
  reading: TarotReading;
  onBack: () => void;
  onDelete: () => void;
}) {
  const { spread, positions } = spreadInfoOf(reading);
  const slots = reading.cards.map((c) => Math.max(0, TAROT_FULL_DECK.findIndex((d) => d.id === c.defId)));
  const revsBySlot = reading.cards.map((c) => c.reversed);
  return (
    <RevealBody
      spread={spread}
      positions={positions}
      slots={slots}
      revsBySlot={revsBySlot}
      flippedCount={slots.length}
      mode="done"
      theme={{ label: reading.themeLabel }}
      question={reading.question}
      reading={reading.per.length > 0 || reading.overall ? { per: reading.per, overall: reading.overall, aiUsed: reading.aiUsed } : null}
      footer={
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onDelete}
            className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-red-200 bg-red-50/80 text-[14px] font-medium text-red-600 transition-opacity active:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            删除
          </button>
          <button type="button" onClick={onBack} className="h-11 rounded-full border border-white/90 bg-white/65 text-[14px] font-medium text-gray-800 backdrop-blur-xl transition-opacity active:opacity-60">
            返回列表
          </button>
        </div>
      }
    />
  );
}
