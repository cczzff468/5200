'use client';

/**
 * 拾光小屋 —— 我的衣柜弹窗（v6.2）
 *
 * 走到衣柜前自动弹出（点家具「换套衣服」）。底部抽屉式：
 * 上半屏透出 3D 场景 → 小人实时试穿；下半屏分类挑款：
 *   发型（双马尾/高马尾/短发/长直发/大波浪）
 *   连衣裙 ×4 · 上衣 ×4 · 下装（裙×2/短裤/长裤） · 鞋 ×4
 * 选上衣/下装自动切成「分体穿搭」，选连衣裙切回「连衣裙穿搭」。
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Shirt, X } from 'lucide-react';
import type { GirlHairStyle, GirlWear } from './types';
import { BOTTOMS, DRESSES, HAIR_NAMES, SHOES, TOPS } from './wardrobe-data';
import { sfx } from './sfx';

type WardTab = 'hair' | 'dress' | 'top' | 'bottom' | 'shoes';

const TABS: { key: WardTab; label: string }[] = [
  { key: 'hair', label: '发型' },
  { key: 'dress', label: '连衣裙' },
  { key: 'top', label: '上衣' },
  { key: 'bottom', label: '下装' },
  { key: 'shoes', label: '鞋子' },
];

/** 通用小脸（八字刘海 + 眉眼 + 微笑），叠各发型特征 */
function FaceBase({ hair, bow }: { hair: string; bow: string }) {
  return (
    <g>
      {/* 八字刘海（中分两撇斜下扫） */}
      <path d="M24 13.5 q-9.5 1 -10.5 11.5 q3 -5.5 6.5 -6.5 q-1.5 4.5 -0.5 8 q2.5 -7.5 4.5 -13 z" fill={hair} />
      <path d="M24 13.5 q9.5 1 10.5 11.5 q-3 -5.5 -6.5 -6.5 q1.5 4.5 0.5 8 q-2.5 -7.5 -4.5 -13 z" fill={hair} />
      {/* 眉眼嘴 */}
      <circle cx="19.6" cy="27.2" r="1.5" fill="#4a3a30" />
      <circle cx="28.4" cy="27.2" r="1.5" fill="#4a3a30" />
      <path d="M22.6 31.2 q1.4 1.4 2.8 0" stroke="#e08e8e" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      {/* 腮红 */}
      <circle cx="17.4" cy="29.8" r="1.7" fill="#f7a8b4" opacity="0.55" />
      <circle cx="30.6" cy="29.8" r="1.7" fill="#f7a8b4" opacity="0.55" />
      <circle cx="0" cy="0" r="0" fill={bow} />
    </g>
  );
}

/** 发型缩略图标 */
function HairIcon({ kind }: { kind: GirlHairStyle }) {
  const hair = '#6b4a38';
  const tip = '#a97a5c';
  const bow = '#f591ac';
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full">
      {kind === 'high' && (
        <>
          <ellipse cx="27" cy="7.5" rx="5" ry="6.5" fill={hair} />
          <ellipse cx="27.6" cy="4.5" rx="3.4" ry="3" fill={tip} />
          <rect x="22.6" y="12.2" width="8.8" height="3.4" rx="1.7" fill={bow} />
        </>
      )}
      {/* 后发基底 */}
      {kind === 'twin' && (
        <>
          <ellipse cx="24" cy="24" rx="14" ry="14" fill={hair} />
          <ellipse cx="9.2" cy="28" rx="4.6" ry="9.5" fill={hair} />
          <ellipse cx="38.8" cy="28" rx="4.6" ry="9.5" fill={hair} />
          <ellipse cx="9.2" cy="35" rx="3" ry="2.4" fill={tip} />
          <ellipse cx="38.8" cy="35" rx="3" ry="2.4" fill={tip} />
          <circle cx="12.6" cy="19.5" r="2.5" fill={bow} />
          <circle cx="35.4" cy="19.5" r="2.5" fill={bow} />
        </>
      )}
      {kind === 'high' && <ellipse cx="24" cy="24" rx="13" ry="13" fill={hair} />}
      {kind === 'bob' && (
        <>
          <ellipse cx="24" cy="26" rx="14.6" ry="14.6" fill={hair} />
          <ellipse cx="24" cy="38.5" rx="12.4" ry="3" fill={hair} />
          <ellipse cx="15" cy="37.5" rx="2.6" ry="2.1" fill={tip} />
          <ellipse cx="33" cy="37.5" rx="2.6" ry="2.1" fill={tip} />
        </>
      )}
      {kind === 'straight' && (
        <>
          <ellipse cx="24" cy="24" rx="14" ry="14" fill={hair} />
          <path d="M11.5 22 q-3.5 14 -0.5 21 q4.5 1.6 6.5 -1 q-2.5 -11 -1.5 -19 z" fill={hair} />
          <path d="M36.5 22 q3.5 14 0.5 21 q-4.5 1.6 -6.5 -1 q2.5 -11 1.5 -19 z" fill={hair} />
          <ellipse cx="14.2" cy="42" rx="3.4" ry="1.8" fill={tip} />
          <ellipse cx="33.8" cy="42" rx="3.4" ry="1.8" fill={tip} />
        </>
      )}
      {kind === 'wave' && (
        <>
          <ellipse cx="24" cy="24" rx="14.2" ry="14.2" fill={hair} />
          <circle cx="11" cy="27" r="4.6" fill={hair} />
          <circle cx="12.6" cy="34.5" r="4.2" fill={hair} />
          <circle cx="15.5" cy="40.5" r="3.6" fill={hair} />
          <circle cx="37" cy="27" r="4.6" fill={hair} />
          <circle cx="35.4" cy="34.5" r="4.2" fill={hair} />
          <circle cx="32.5" cy="40.5" r="3.6" fill={hair} />
          <circle cx="15.5" cy="41.5" r="1.8" fill={tip} />
          <circle cx="32.5" cy="41.5" r="1.8" fill={tip} />
        </>
      )}
      {/* 脸 */}
      <circle cx="24" cy="26.5" r="11" fill="#ffe9dc" />
      <FaceBase hair={hair} bow={bow} />
    </svg>
  );
}

/** 连衣裙缩略图标 */
function DressIcon({ i }: { i: number }) {
  const d = DRESSES[i];
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full">
      <path d="M19.5 7.5 h9 l2.2 7 q4 2.2 4 6.5 l4.3 15.5 c-10 4.2 -19.8 4.2 -30 0 l4.3 -15.5 q0 -4.3 4 -6.5 z" fill={d.c} />
      <path d="M13.6 35.6 c10.4 4 10.4 4 20.8 0" stroke={d.trim} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M20.6 20.5 q3.4 2.2 6.8 0" stroke={d.trim} strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="24" cy="27" r="2" fill={d.trim} />
    </svg>
  );
}

/** 上衣缩略图标 */
function TopIcon({ i }: { i: number }) {
  const t = TOPS[i];
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full">
      <path d="M16.5 9.5 l6.5 -3 q1 2.4 3 2.4 q2 0 3 -2.4 l6.5 3 4.5 6.5 -5.5 3.5 -1.5 -2.5 v19.5 h-19 v-19.5 l-1.5 2.5 -5.5 -3.5 z" fill={t.c} />
      {i === 0 && <path d="M19 10.5 q5 6.5 10 0" stroke="#e2d9c2" strokeWidth="1.8" fill="none" />}
      {i === 1 && <path d="M20 25 h8 M20 29 h8" stroke="#e8a9ba" strokeWidth="1.6" strokeLinecap="round" />}
      {i === 2 && <circle cx="29.5" cy="20" r="2.4" fill="#ffffff" opacity="0.85" />}
      {i === 3 && <path d="M14.5 17 l3 -1.6 M33.5 17 l-3 -1.6 M17 33 v3 M24 34 v3 M31 33 v3" stroke="#e3bd6d" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

/** 下装缩略图标 */
function BottomIcon({ i }: { i: number }) {
  const b = BOTTOMS[i];
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full">
      {i === 0 && (
        <>
          <path d="M16 13 h16 l1.5 4 h-19 z" fill="#f0f0f0" />
          <path d="M14.5 17 h19 l5 17 c-9.5 4 -19.5 4 -29 0 z" fill={b.c} stroke="#ececec" strokeWidth="1" />
          <path d="M20 17.5 l-2.5 16 M24 17.5 v16.5 M28 17.5 l2.5 16" stroke="#e8e8e8" strokeWidth="1.4" />
        </>
      )}
      {i === 1 && (
        <>
          <path d="M16 13 h16 l1.5 4 h-19 z" fill="#eebfc9" />
          <path d="M14.5 17 h19 l5 17 c-9.5 4 -19.5 4 -29 0 z" fill={b.c} />
          <path d="M14 30.5 c10 3.8 10 3.8 20 0" stroke="#ffffff" strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      )}
      {i === 2 && <path d="M14.5 15 h19 l2.5 14.5 h-8 l-4 -8.5 -4 8.5 h-8 z" fill={b.c} />}
      {i === 3 && <path d="M14.5 13 h19 v6 l-1.5 17 h-6.5 l-1.5 -14 -1.5 14 h-6.5 l-1.5 -17 z" fill={b.c} />}
    </svg>
  );
}

/** 鞋子缩略图标 */
function ShoeIcon({ i }: { i: number }) {
  const s = SHOES[i];
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full">
      {i !== 3 && (
        <>
          <path d="M8 31 q11 -1.5 17.5 -9.5 q3.5 4.5 9 6 q5.5 1.5 5.5 5 v2.5 h-32 z" fill={s.c} />
          <path d="M8 35 h32 v2.6 h-32 z" fill={s.trim} opacity="0.9" />
        </>
      )}
      {i === 1 && <circle cx="38" cy="31.5" r="3.4" fill={s.trim} />}
      {i === 2 && <path d="M27.5 24.5 q4 1.8 8 2.6" stroke={s.trim} strokeWidth="2" fill="none" strokeLinecap="round" />}
      {i === 3 && (
        <>
          <path d="M17 12 h11 v15.5 q7 1.5 9 5.5 v2 h-22 q-2 -12 2 -23 z" fill={s.c} />
          <path d="M15.5 20.5 h14" stroke={s.trim} strokeWidth="2.4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

const HAIR_ORDER: GirlHairStyle[] = ['twin', 'high', 'bob', 'straight', 'wave'];

export interface WardrobeProps {
  open: boolean;
  wear: GirlWear;
  onChange: (w: GirlWear) => void;
  onClose: () => void;
}

export default function Wardrobe({ open, wear, onChange, onClose }: WardrobeProps) {
  const [tab, setTab] = useState<WardTab>('hair');
  const inDressMode = wear.dress >= 0;

  const items = useMemo(() => {
    if (tab === 'hair') return HAIR_ORDER.map((h) => ({ key: h, name: HAIR_NAMES[h] ?? h }));
    if (tab === 'dress') return DRESSES.map((d, i) => ({ key: String(i), name: d.name }));
    if (tab === 'top') return TOPS.map((t, i) => ({ key: String(i), name: t.name }));
    if (tab === 'bottom') return BOTTOMS.map((b, i) => ({ key: String(i), name: b.name }));
    return SHOES.map((s, i) => ({ key: String(i), name: s.name }));
  }, [tab]);

  const isSel = (key: string) => {
    if (tab === 'hair') return wear.hair === key;
    if (tab === 'dress') return inDressMode && wear.dress === Number(key);
    if (tab === 'top') return !inDressMode && wear.top === Number(key);
    if (tab === 'bottom') return !inDressMode && wear.bottom === Number(key);
    return wear.shoes === Number(key);
  };

  const pick = (key: string) => {
    sfx.tap();
    if (tab === 'hair') onChange({ ...wear, hair: key as GirlHairStyle });
    else if (tab === 'dress') onChange({ ...wear, dress: Number(key) });
    else if (tab === 'top') onChange({ ...wear, dress: -1, top: Number(key) });
    else if (tab === 'bottom') onChange({ ...wear, dress: -1, bottom: Number(key) });
    else onChange({ ...wear, shoes: Number(key) });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="wardrobe"
          className="absolute inset-0 z-40 flex flex-col justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* 背景半透明（点空白收起） */}
          <button aria-label="关闭衣柜" className="absolute inset-0 cursor-default bg-black/25" onClick={onClose} />

          <motion.div
            className="relative flex max-h-[58%] flex-col overflow-hidden rounded-t-[26px] bg-gradient-to-b from-[#fff7f3] to-[#ffffff] shadow-[0_-8px_40px_rgba(120,70,80,0.25)]"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          >
            {/* 把手 + 标题 */}
            <div className="flex items-center justify-center pt-2.5">
              <div className="h-1.5 w-10 rounded-full bg-[#e8d5cd]" />
            </div>
            <div className="flex items-center justify-between px-5 pb-2 pt-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-[17px] font-bold text-[#4a3f3d]">我的衣柜</span>
                <span className="text-[11px] text-[#b09a92]">
                  {inDressMode ? `连衣裙 · ${DRESSES[wear.dress]?.name ?? ''}` : `分体 · ${TOPS[wear.top]?.name ?? ''} + ${BOTTOMS[wear.bottom]?.name ?? ''}`}
                </span>
              </div>
              <button
                onClick={onClose}
                aria-label="关闭"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3e7e2] text-[#8a726c] transition active:scale-90"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 分类 Tab */}
            <div className="flex gap-1.5 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {TABS.map((t) => {
                const on = t.key === tab;
                const dim = (t.key === 'top' || t.key === 'bottom') && inDressMode;
                return (
                  <button
                    key={t.key}
                    onClick={() => {
                      sfx.tap();
                      setTab(t.key);
                    }}
                    className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-3.5 text-[12.5px] font-semibold transition active:scale-95 ${
                      on ? 'bg-[#f4a7bc] text-white shadow-md shadow-[#f4a7bc]/40' : 'bg-white text-[#8a726c] shadow-sm ring-1 ring-[#f0e2dc]'
                    } ${dim && !on ? 'opacity-60' : ''}`}
                  >
                    {t.key !== 'hair' && <Shirt className="h-3 w-3" />}
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* 款式网格 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 [scrollbar-width:thin]">
              {tab === 'dress' && (
                <p className="pb-1.5 pt-0.5 text-[11px] text-[#c2aca4]">穿上连衣裙会收起分体上衣和下装～</p>
              )}
              {(tab === 'top' || tab === 'bottom') && inDressMode && (
                <p className="pb-1.5 pt-0.5 text-[11px] text-[#c2aca4]">当前穿着连衣裙，挑选后会自动换成上下分体穿搭～</p>
              )}
              <div className="grid grid-cols-4 gap-2.5">
                {items.map((it) => {
                  const sel = isSel(it.key);
                  return (
                    <button
                      key={it.key}
                      onClick={() => pick(it.key)}
                      className={`relative flex flex-col items-center gap-1 rounded-2xl px-1 pb-1.5 pt-2 transition active:scale-95 ${
                        sel ? 'bg-[#ffeef3] ring-2 ring-[#f4a7bc]' : 'bg-white ring-1 ring-[#f0e4de]'
                      }`}
                    >
                      <div className="h-11 w-11">
                        {tab === 'hair' && <HairIcon kind={it.key as GirlHairStyle} />}
                        {tab === 'dress' && <DressIcon i={Number(it.key)} />}
                        {tab === 'top' && <TopIcon i={Number(it.key)} />}
                        {tab === 'bottom' && <BottomIcon i={Number(it.key)} />}
                        {tab === 'shoes' && <ShoeIcon i={Number(it.key)} />}
                      </div>
                      <span className={`text-[10.5px] leading-tight ${sel ? 'font-bold text-[#e06a8c]' : 'text-[#8a726c]'}`}>{it.name}</span>
                      {sel && (
                        <span className="absolute -right-1 -top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#f4a7bc] text-white shadow">
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
