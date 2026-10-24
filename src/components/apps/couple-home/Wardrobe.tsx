'use client';

/**
 * 拾光小屋 —— 我的衣柜弹窗（v6.3：女生/男生双衣柜 + 调色盘）
 *
 * 走到衣柜前自动弹出（点家具「换套衣服」）。底部抽屉式：
 * 上半屏透出 3D 场景 → 小人实时试穿；下半屏顶部分角色切换（女生/男生），分类挑款：
 *   女生：发型（双马尾/高马尾/短发/长直发/大波浪） · 连衣裙 ×4 · 上衣 ×4 · 下装 · 鞋 ×4
 *   男生：发型（顺滑/蓬松/中分/刺猬） · 上衣 ×4 · 裤子 ×4 · 鞋 ×4
 * 「调色盘」行可给当前分类的服饰自选颜色（tints.*，默认色可一键还原）。
 * 女生选上衣/下装自动切成「分体穿搭」，选连衣裙切回「连衣裙穿搭」。
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Shirt, X } from 'lucide-react';
import type { BoyHairStyle, GirlHairStyle, GirlWear, BoyWear, WearTints } from './types';
import {
  BOY_BOTTOMS,
  BOY_HAIR_NAMES,
  BOY_SHOES,
  BOY_TOPS,
  BOTTOMS,
  CLOTH_COLORS,
  DRESSES,
  HAIR_COLORS,
  HAIR_NAMES,
  SHOES,
  TOPS,
} from './wardrobe-data';
import { sfx } from './sfx';

type WardTab = 'hair' | 'dress' | 'top' | 'bottom' | 'shoes';

/** 当前分类对应的调色盘槽位 */
const TINT_SLOT: Record<WardTab, keyof WearTints> = {
  hair: 'hair',
  dress: 'dress',
  top: 'top',
  bottom: 'bottom',
  shoes: 'shoes',
};

const TABS_GIRL: { key: WardTab; label: string }[] = [
  { key: 'hair', label: '发型' },
  { key: 'dress', label: '连衣裙' },
  { key: 'top', label: '上衣' },
  { key: 'bottom', label: '下装' },
  { key: 'shoes', label: '鞋子' },
];

const TABS_BOY: { key: WardTab; label: string }[] = [
  { key: 'hair', label: '发型' },
  { key: 'top', label: '上衣' },
  { key: 'bottom', label: '裤子' },
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

/** 男生小脸（碎刘海 + 眼嘴 + 腮红，无八字刘海） */
function BoyFace({ hair }: { hair: string }) {
  return (
    <g>
      <circle cx="19.8" cy="27.4" r="1.5" fill="#3a3230" />
      <circle cx="28.2" cy="27.4" r="1.5" fill="#3a3230" />
      <path d="M22.6 31.2 q1.4 1.4 2.8 0" stroke="#c98a80" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <circle cx="17.2" cy="30" r="1.7" fill="#f4b3aa" opacity="0.5" />
      <circle cx="30.8" cy="30" r="1.7" fill="#f4b3aa" opacity="0.5" />
      <circle cx="0" cy="0" r="0" fill={hair} />
    </g>
  );
}

/** 发型缩略图标（女生） */
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

/** 发型缩略图标（男生）：顺滑 / 蓬松 / 中分 / 刺猬 */
function BoyHairIcon({ kind }: { kind: BoyHairStyle }) {
  const hair = '#2f2b29';
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full">
      {kind === 'smooth' && (
        <>
          <ellipse cx="24" cy="23.5" rx="13.4" ry="13.4" fill={hair} />
          <path d="M26 9.2 q2.6 -4.4 6 -3.6 q-3 1.8 -3.2 4.8 q-1.4 -0.9 -2.8 -1.2 z" fill={hair} />
        </>
      )}
      {kind === 'fluffy' && (
        <>
          <circle cx="15.8" cy="20.5" r="5.4" fill={hair} />
          <circle cx="21.4" cy="15.4" r="5.6" fill={hair} />
          <circle cx="28" cy="15.8" r="5.6" fill={hair} />
          <circle cx="33" cy="21" r="5" fill={hair} />
          <ellipse cx="24" cy="23" rx="13" ry="12" fill={hair} />
        </>
      )}
      {kind === 'middle' && (
        <>
          <ellipse cx="24" cy="23.5" rx="13.4" ry="13.4" fill={hair} />
        </>
      )}
      {kind === 'spiky' && (
        <>
          <path d="M11.5 26 l2 -8.5 3.4 3.2 1.8 -7.4 3.2 4.4 2 -7.5 2.6 6.2 2.6 -5.4 1.4 6.8 3.4 -3.4 0.6 8.6 q-11.5 -4 -23 3 z" fill={hair} />
        </>
      )}
      {/* 脸 */}
      <circle cx="24" cy="26.5" r="11" fill="#ffe4cf" />
      {/* 前发 */}
      {kind === 'smooth' && (
        <path d="M13.2 24.5 q1.5 -7.5 10.8 -8.5 q9.3 1 10.8 8.5 l-2.6 -1.4 -2.9 1.9 -3.2 -1.9 -3.3 2 -3.3 -2 -3.2 1.9 -2.9 -1.9 z" fill={hair} />
      )}
      {kind === 'fluffy' && (
        <>
          <circle cx="18" cy="17.6" r="3.6" fill={hair} />
          <circle cx="24.6" cy="15.8" r="3.8" fill={hair} />
          <circle cx="30.6" cy="18.2" r="3.4" fill={hair} />
        </>
      )}
      {kind === 'middle' && (
        <>
          <path d="M23.4 15 q-8.6 0.6 -10.4 9.6 q3.2 -4.6 6.8 -4.4 q-1.2 3.4 -0.4 6.2 q2.8 -6.2 4 -11.4 z" fill={hair} />
          <path d="M24.6 15 q8.6 0.6 10.4 9.6 q-3.2 -4.6 -6.8 -4.4 q1.2 3.4 0.4 6.2 q-2.8 -6.2 -4 -11.4 z" fill={hair} />
        </>
      )}
      <BoyFace hair={hair} />
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

/** 上衣缩略图标（女生） */
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

/** 上衣缩略图标（男生）：T恤/针织/polos + 连帽款脑后兜帽 */
function BoyTopIcon({ i }: { i: number }) {
  const t = BOY_TOPS[i];
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full">
      {t.hood && <path d="M16.5 13.8 q7.5 -7.2 15 0 q-1.6 5.6 -7.5 5.6 q-5.9 0 -7.5 -5.6 z" fill={t.c} stroke="#e3d9c4" strokeWidth="1" />}
      <path d="M16.5 9.5 l6.5 -3 q1 2.4 3 2.4 q2 0 3 -2.4 l6.5 3 4.5 6.5 -5.5 3.5 -1.5 -2.5 v19.5 h-19 v-19.5 l-1.5 2.5 -5.5 -3.5 z" fill={t.c} />
      {t.hood && (
        <>
          <path d="M19.5 11 q4.5 5.2 9 0" stroke="#e3d9c4" strokeWidth="1.6" fill="none" />
          <path d="M20 27.5 h8.5 a1.5 1.5 0 0 1 1.5 1.5 v4.5 h-11.5 v-4.5 a1.5 1.5 0 0 1 1.5 -1.5 z" fill="#e9dfc8" opacity="0.8" />
        </>
      )}
      {i === 1 && <path d="M17.5 22 q6.5 3.4 13 0 M19 27 h10" stroke="#b7a181" strokeWidth="1.5" fill="none" strokeLinecap="round" />}
      {i === 2 && <path d="M20.5 12.5 q3.5 2.6 7 0" stroke="#ffffff" strokeWidth="1.6" fill="none" strokeLinecap="round" />}
      {i === 3 && (
        <>
          <path d="M20.5 10.5 h7 l-1 2.8 h-5 z" fill="#87a68f" />
          <path d="M24 13.5 v5" stroke="#87a68f" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** 下装缩略图标（女生） */
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

/** 裤子缩略图标（男生）：短裤 / 长裤 */
function BoyBottomIcon({ i }: { i: number }) {
  const b = BOY_BOTTOMS[i];
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full">
      {b.kind === 'short' ? (
        <>
          <path d="M14.5 13.5 h19 v3 h-19 z" fill={b.c} opacity="0.72" />
          <path d="M14.5 16 h19 l2.6 15 h-8.1 l-4 -8.8 -4 8.8 h-8.1 z" fill={b.c} />
        </>
      ) : (
        <>
          <path d="M14.5 13.5 h19 v3 h-19 z" fill={b.c} opacity="0.72" />
          <path d="M14.5 16 h19 v4.5 l-1.6 16.5 h-6.6 l-1.4 -14.5 -1.4 14.5 h-6.6 l-1.6 -16.5 z" fill={b.c} />
        </>
      )}
      <path d="M22 16.5 h4 v2 h-4 z" fill="#ffffff" opacity="0.65" />
    </svg>
  );
}

/** 鞋子缩略图标（女生） */
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

/** 鞋子缩略图标（男生）：运动鞋剪影 + 鞋底/鞋带配色 */
function BoyShoeIcon({ i }: { i: number }) {
  const s = BOY_SHOES[i];
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full">
      <path d="M8 30.5 q11 -1.5 17.5 -9.5 q3.5 4.5 9 6 q5.5 1.5 5.5 5 v3 h-32 z" fill={s.c} />
      <path d="M8 35 h32 v2.6 h-32 z" fill={s.trim} />
      <path d="M25 22 l4.6 4.6 M28.6 19.8 l4.2 4.2" stroke={s.trim} strokeWidth="1.7" strokeLinecap="round" />
      {i === 3 && <path d="M15 21 h9" stroke={s.trim} strokeWidth="2.4" strokeLinecap="round" />}
      {i === 1 && <path d="M10 33.8 h28" stroke={s.trim} strokeWidth="1.2" opacity="0.7" />}
    </svg>
  );
}

const HAIR_ORDER: GirlHairStyle[] = ['twin', 'high', 'bob', 'straight', 'wave'];
const BOY_HAIR_ORDER: BoyHairStyle[] = ['smooth', 'fluffy', 'middle', 'spiky'];

export interface WardrobeProps {
  open: boolean;
  wear: GirlWear;
  wear2: BoyWear;
  onChange: (w: GirlWear) => void;
  onChange2: (w: BoyWear) => void;
  onClose: () => void;
}

export default function Wardrobe({ open, wear, wear2, onChange, onChange2, onClose }: WardrobeProps) {
  const [char, setChar] = useState<'girl' | 'boy'>('girl');
  const [tab, setTab] = useState<WardTab>('hair');
  const inDressMode = wear.dress >= 0;
  const tabs = char === 'girl' ? TABS_GIRL : TABS_BOY;

  /** 切换角色：保留当前分类（女生专属的连衣裙在男生侧回落到上衣） */
  const switchChar = (c: 'girl' | 'boy') => {
    if (c === char) return;
    sfx.tap();
    setChar(c);
    if (c === 'boy' && tab === 'dress') setTab('top');
  };

  const items = useMemo(() => {
    if (char === 'boy') {
      if (tab === 'hair') return BOY_HAIR_ORDER.map((h) => ({ key: h, name: BOY_HAIR_NAMES[h] ?? h }));
      if (tab === 'top') return BOY_TOPS.map((t, i) => ({ key: String(i), name: t.name }));
      if (tab === 'bottom') return BOY_BOTTOMS.map((b, i) => ({ key: String(i), name: b.name }));
      return BOY_SHOES.map((s, i) => ({ key: String(i), name: s.name }));
    }
    if (tab === 'hair') return HAIR_ORDER.map((h) => ({ key: h, name: HAIR_NAMES[h] ?? h }));
    if (tab === 'dress') return DRESSES.map((d, i) => ({ key: String(i), name: d.name }));
    if (tab === 'top') return TOPS.map((t, i) => ({ key: String(i), name: t.name }));
    if (tab === 'bottom') return BOTTOMS.map((b, i) => ({ key: String(i), name: b.name }));
    return SHOES.map((s, i) => ({ key: String(i), name: s.name }));
  }, [char, tab]);

  const isSel = (key: string) => {
    if (char === 'boy') {
      if (tab === 'hair') return wear2.hair === key;
      if (tab === 'top') return wear2.top === Number(key);
      if (tab === 'bottom') return wear2.bottom === Number(key);
      return wear2.shoes === Number(key);
    }
    if (tab === 'hair') return wear.hair === key;
    if (tab === 'dress') return inDressMode && wear.dress === Number(key);
    if (tab === 'top') return !inDressMode && wear.top === Number(key);
    if (tab === 'bottom') return !inDressMode && wear.bottom === Number(key);
    return wear.shoes === Number(key);
  };

  const pick = (key: string) => {
    sfx.tap();
    if (char === 'boy') {
      if (tab === 'hair') onChange2({ ...wear2, hair: key as BoyHairStyle });
      else if (tab === 'top') onChange2({ ...wear2, top: Number(key) });
      else if (tab === 'bottom') onChange2({ ...wear2, bottom: Number(key) });
      else onChange2({ ...wear2, shoes: Number(key) });
      return;
    }
    if (tab === 'hair') onChange({ ...wear, hair: key as GirlHairStyle });
    else if (tab === 'dress') onChange({ ...wear, dress: Number(key) });
    else if (tab === 'top') onChange({ ...wear, dress: -1, top: Number(key) });
    else if (tab === 'bottom') onChange({ ...wear, dress: -1, bottom: Number(key) });
    else onChange({ ...wear, shoes: Number(key) });
  };

  // —— 调色盘（当前角色 + 当前分类的槽位；null = 还原默认款色） ——
  const slot = TINT_SLOT[tab];
  const curTint = (char === 'girl' ? wear.tints?.[slot] : wear2.tints?.[slot]) ?? null;
  const paletteColors = tab === 'hair' ? HAIR_COLORS : CLOTH_COLORS;

  const setTint = (col: string | null) => {
    sfx.tap();
    if (char === 'girl') {
      const t: WearTints = { ...(wear.tints ?? {}) };
      if (col) t[slot] = col;
      else delete t[slot];
      onChange({ ...wear, tints: Object.keys(t).length > 0 ? t : undefined });
    } else {
      const t: WearTints = { ...(wear2.tints ?? {}) };
      if (col) t[slot] = col;
      else delete t[slot];
      onChange2({ ...wear2, tints: Object.keys(t).length > 0 ? t : undefined });
    }
  };

  // 当前角色穿搭摘要
  const summary =
    char === 'girl'
      ? inDressMode
        ? `连衣裙 · ${DRESSES[wear.dress]?.name ?? ''}`
        : `分体 · ${TOPS[wear.top]?.name ?? ''} + ${BOTTOMS[wear.bottom]?.name ?? ''}`
      : `${BOY_TOPS[wear2.top]?.name ?? ''} + ${BOY_BOTTOMS[wear2.bottom]?.name ?? ''}`;

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
            className="relative flex max-h-[58%] flex-col overflow-hidden rounded-t-[26px] bg-gradient-to-b from-[#fff7f3] via-white to-[#fdf3ee] shadow-[0_-8px_40px_rgba(120,70,80,0.25)]"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          >
            {/* 把手 */}
            <div className="flex items-center justify-center pt-2.5">
              <div className="h-1.5 w-10 rounded-full bg-[#e8d5cd]" />
            </div>

            {/* 标题 + 关闭 */}
            <div className="flex items-center justify-between px-4 pb-1.5 pt-1.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#f9b8ca] to-[#f28aa8] shadow-sm shadow-[#f4a7bc]/40">
                  <Shirt className="h-4 w-4 text-white" />
                </span>
                <div className="flex flex-col">
                  <span className="text-[16px] font-bold leading-tight text-[#4a3f3d]">我的衣柜</span>
                  <span className="max-w-[220px] truncate text-[10.5px] leading-tight text-[#b09a92]">{summary}</span>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="关闭"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3e7e2] text-[#8a726c] transition active:scale-90"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 角色切换（女生粉 / 男生青） */}
            <div className="px-4 pb-1.5">
              <div className="flex w-fit rounded-full bg-[#f6ebe6] p-0.5 shadow-inner">
                {(
                  [
                    ['girl', '女生'],
                    ['boy', '男生'],
                  ] as const
                ).map(([c, label]) => {
                  const on = char === c;
                  return (
                    <button
                      key={c}
                      onClick={() => switchChar(c)}
                      className={`flex h-7 items-center rounded-full px-4 text-[12px] font-bold transition active:scale-95 ${
                        on
                          ? c === 'girl'
                            ? 'bg-[#f4a7bc] text-white shadow-md shadow-[#f4a7bc]/40'
                            : 'bg-[#7fc8ae] text-white shadow-md shadow-[#7fc8ae]/40'
                          : 'text-[#a08a84]'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 分类 Tab */}
            <div className="flex gap-1.5 overflow-x-auto px-4 pb-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tabs.map((t) => {
                const on = t.key === tab;
                const dim = char === 'girl' && (t.key === 'top' || t.key === 'bottom') && inDressMode;
                return (
                  <button
                    key={t.key}
                    onClick={() => {
                      sfx.tap();
                      setTab(t.key);
                    }}
                    className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-3.5 text-[12.5px] font-semibold transition active:scale-95 ${
                      on
                        ? char === 'girl'
                          ? 'bg-[#f4a7bc] text-white shadow-md shadow-[#f4a7bc]/40'
                          : 'bg-[#7fc8ae] text-white shadow-md shadow-[#7fc8ae]/40'
                        : 'bg-white text-[#8a726c] shadow-sm ring-1 ring-[#f0e2dc]'
                    } ${dim && !on ? 'opacity-60' : ''}`}
                  >
                    {t.key !== 'hair' && <Shirt className="h-3 w-3" />}
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* 调色盘（当前分类槽位自选色；首格 = 还原默认） */}
            <div className="flex items-center gap-2 px-4 pb-1">
              <span className="shrink-0 text-[11px] font-semibold text-[#b09a92]">调色盘</span>
              <div className="flex items-center gap-1.5 overflow-x-auto py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button
                  onClick={() => setTint(null)}
                  aria-label="默认色"
                  className={`relative h-6 w-6 shrink-0 rounded-full transition active:scale-90 ${
                    curTint ? '' : 'ring-2 ring-[#f4a7bc] ring-offset-1'
                  }`}
                  style={{ background: 'conic-gradient(#f6a5b8,#f6d78a,#a7dcb8,#9cc7ee,#c9a8e8,#f6a5b8)' }}
                >
                  <span className="absolute inset-[3px] flex items-center justify-center rounded-full bg-white text-[8px] font-bold text-[#b09a92]">
                    A
                  </span>
                </button>
                {paletteColors.map((c) => (
                  <button
                    key={c}
                    onClick={() => setTint(c)}
                    aria-label={c}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${
                      curTint === c ? 'ring-2 ring-[#e06a8c] ring-offset-1' : 'ring-1 ring-black/10'
                    }`}
                    style={{ backgroundColor: c }}
                  >
                    {curTint === c && <Check className="h-3 w-3 text-white drop-shadow" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>

            {/* 款式网格 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 [scrollbar-width:thin]">
              {char === 'girl' && tab === 'dress' && (
                <p className="pb-1 pt-0.5 text-[11px] text-[#c2aca4]">穿上连衣裙会收起分体上衣和下装～</p>
              )}
              {char === 'girl' && (tab === 'top' || tab === 'bottom') && inDressMode && (
                <p className="pb-1 pt-0.5 text-[11px] text-[#c2aca4]">当前穿着连衣裙，挑选后会自动换成上下分体穿搭～</p>
              )}
              {char === 'girl' && tab === 'dress' && !inDressMode && (
                <p className="pb-1 pt-0.5 text-[11px] text-[#c2aca4]">当前穿分体，连衣裙配色在穿上连衣裙后生效～</p>
              )}
              <div className="grid grid-cols-4 gap-2.5">
                {items.map((it) => {
                  const sel = isSel(it.key);
                  return (
                    <button
                      key={it.key}
                      onClick={() => pick(it.key)}
                      className={`relative flex flex-col items-center gap-1 rounded-2xl px-1 pb-1.5 pt-2 transition active:scale-95 ${
                        sel ? 'bg-[#ffeef3] ring-2 ring-[#f4a7bc]' : 'bg-[#fffdf9] ring-1 ring-[#f0e4de]'
                      }`}
                    >
                      <div className="h-12 w-12">
                        {char === 'girl' && tab === 'hair' && <HairIcon kind={it.key as GirlHairStyle} />}
                        {char === 'girl' && tab === 'dress' && <DressIcon i={Number(it.key)} />}
                        {char === 'girl' && tab === 'top' && <TopIcon i={Number(it.key)} />}
                        {char === 'girl' && tab === 'bottom' && <BottomIcon i={Number(it.key)} />}
                        {char === 'girl' && tab === 'shoes' && <ShoeIcon i={Number(it.key)} />}
                        {char === 'boy' && tab === 'hair' && <BoyHairIcon kind={it.key as BoyHairStyle} />}
                        {char === 'boy' && tab === 'top' && <BoyTopIcon i={Number(it.key)} />}
                        {char === 'boy' && tab === 'bottom' && <BoyBottomIcon i={Number(it.key)} />}
                        {char === 'boy' && tab === 'shoes' && <BoyShoeIcon i={Number(it.key)} />}
                      </div>
                      <span
                        className={`text-[10.5px] leading-tight ${
                          sel ? (char === 'girl' ? 'font-bold text-[#e06a8c]' : 'font-bold text-[#3f9b7e]') : 'text-[#8a726c]'
                        }`}
                      >
                        {it.name}
                      </span>
                      {sel && (
                        <span
                          className={`absolute -right-1 -top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full text-white shadow ${
                            char === 'girl' ? 'bg-[#f4a7bc]' : 'bg-[#7fc8ae]'
                          }`}
                        >
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
