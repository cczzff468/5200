'use client';

/**
 * 情侣小家 3D v4 —— 主组件（白色系·客厅篇）
 *
 * - 生活模式：摇杆/WASD 操控小人、镜头跟随、滑动全方位旋转视角、点家具交互、点窗户开合；
 * - 编辑模式：上帝视角、拖拽移动（0.25m 吸附）、移动方式双轨：四向按钮微调 + 按住拖动/移动模式搬运、
 *   四宫格旋转（左转/右转 + 上仰/下俯）、每件家具调色盘、地板/墙壁自定义颜色、画面缩放、家具商店、昼夜切换；
 * - 金币系统已移除；
 * - 持久化：IndexedDB 即时缓存 + Prisma 服务端（rev 乐观并发，409 采纳服务端）。
 * - v7.0 小屋 HUD 精简：全屏按钮移除；相机按钮移到左上返回键下方；
 *   宠物状态面板改为右上角头像唤出的毛玻璃卡片；抚摸/喂食/喂水/洗澡/抱抱/召唤六枚互动按钮独立到底部。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Armchair,
  Bath,
  BedDouble,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Circle,
  Clock,
  Coffee,
  CupSoda,
  Droplet,
  Eye,
  Flame,
  Gamepad2,
  Heart,
  HeartHandshake,
  Hand,
  ImagePlus,
  MessageCircle,
  Mic,
  SendHorizontal,
  ArrowDownToLine, // v7.2 抱抱→放下 图标
  Laptop,
  Loader2,
  Moon,
  MoreVertical,
  Move,
  Music,
  Paintbrush,
  PawPrint,
  Pencil,
  Puzzle,
  RefreshCw, // v8.3 宠物转圈把戏
  RotateCcw,
  RotateCw,
  Undo2,
  Redo2,
  Shirt,
  ShowerHead,
  Sparkles,
  Store,
  Sun,
  Trash2,
  Tv,
  Utensils,
  UtensilsCrossed,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
  Dog, // v8.3 第二只宠物
  Rabbit, // v8.3 第二只宠物
  Lock, // v8.3 未解锁把戏
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Joystick from './Joystick';
import InstrumentOverlay from './InstrumentOverlay';
import { SongSheet } from './SongSheet';
import { useMusic } from '@/lib/ios/music-store';
import { useMiniPlayer } from '@/components/ios/MusicGlobalMini';
import { localDB, genId } from '@/lib/ios/db';
import { useWeatherSnapshot } from '../weather-core';
import { addAlbum } from '@/lib/ios/album-store';
import { readInviteMeta } from '@/lib/ios/couple-invite';
import {
  BATH_X1,
  CATALOG,
  DOORS,
  FURN_SETS,
  PLAY_COOLDOWN,
  ROOM_SPANS,
  ROOM_NAMES,
  SEASONAL,
  SHOP_TABS,
  SNAP,
  TILT_LIMIT,
  WALL_H,
  WALL_SLOTS,
  WINS,
  WIN_NAMES,
  clampFurnToRooms,
  defaultHome,
  fetchRemote,
  footprintOf,
  loadCache,
  pushRemote,
  resetRemote,
  resolveDoorPos,
  resolveWinPos,
  roomAt,
  saveCache,
  saveCacheNow,
  snapToWallSlot,
  type HomePersist,
} from './catalog';
import { sfx } from './sfx';
import { getCachedThumb } from './scene/ShopThumbs';
import { useSettings } from '@/lib/ios/store';
import { type ContactRecord } from '@/lib/contacts';
import { listContacts, ownerRealName } from '@/lib/ios/contacts-store';
import { startWebSpeechSession, isWebSpeechSupported, type WebSpeechSession } from '@/lib/ios/web-speech';
import { speakUserTts, stopSpeaking } from '@/lib/ios/tts-client';
import { type MemConvoTurn } from '@/lib/memory';
import { buildCabinSystem, cabinChatTurn, parseAiReply, type CabinContext } from './companion-brain';
import {
  cabinAfterChatTurn,
  cabinBehaviorMemoryOncePerDay,
  cabinEventMemory,
  cabinMemoryBlock,
  setMemScopeForApp,
} from './companion-memory';
import type { CompanionCmd, CompanionEvent } from './scene/companion-rt';
import type { BubbleCmd } from './scene/HomeScene';
import type { BoyWear, CharAction, CharPose, CharRT, FurnitureItem, FurnitureKind, GirlWear, HomeMode, HomeState, LayoutSnap, NoteEntry, Pet2State, PetCareKind, PetCoat, PetState, PetWear, RoomId } from './types';
import { sanitizeBoyWear, sanitizeWear } from './types';
import Wardrobe from './Wardrobe';

/** 做饭小游戏（选菜谱→切菜/翻炒/装盘→上桌，v5.7 F5） */
const CookingGame = dynamic(() => import('./CookingGame'), { ssr: false });
/** 五子棋对弈（棋盘桌，v5.7 J7） */
const ChessOverlay = dynamic(() => import('./ChessOverlay'), { ssr: false });
/** 软木留言板（G8 共享留言板） */
const NotesOverlay = dynamic(() => import('./NotesOverlay'), { ssr: false });
/** 抓娃娃机（G10） */
const ClawMachineGame = dynamic(() => import('./games/ClawMachineGame'), { ssr: false });
/** 咖啡拉花（G10） */
const LatteArtGame = dynamic(() => import('./games/LatteArtGame'), { ssr: false });
/** 照片拼图（G10） */
const PuzzleGame = dynamic(() => import('./games/PuzzleGame'), { ssr: false });

const HomeScene = dynamic(() => import('./scene/HomeScene'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-[#f3f0e8]">
      <div className="flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-[13px] text-[#6b6b6b] shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-[#e8a3b3]" />
        小家布置中…
      </div>
    </div>
  ),
});

/** 商城缩略图工作室（隐藏离屏画布，商品 1:1 快照） */
const ShopThumbStudio = dynamic(() => import('./scene/ShopThumbs'), { ssr: false });

/** 洗衣一轮时长（秒） */
const WASH_SECONDS = 30;

/** 水平旋转步进（弧度，45°） */
const YAW_STEP = Math.PI / 4;
/** 俯仰旋转步进（弧度，15°） */
const TILT_STEP = Math.PI / 12;
/** 升降步进（米）：把小家具抬上桌 / 放回地面 */
const LIFT_STEP = 0.23;
const LIFT_MAX = 2.05;

/** 相片窗宽高比：按框型裁剪（立式/挂墙竖版 3:4 偏竖、横版 5:3、拍立得 1:1） */
const PHOTO_ASPECTS: Record<string, number> = {
  photoFrame: 0.4 / 0.56,
  photoWall: 0.46 / 0.6,
  photoWallWide: 1.0 / 0.6,
  polaroid: 1,
};

// ---------------- 宠物「团子」状态（v6.9） ----------------

const clamp01x = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/** 随真实时间衰减：体力 -4/h、清洁 -3/h、心情 -6/h（最多追算 48h，回访不会一贫如洗） */
function decayPet(p: PetState, now = Date.now()): PetState {
  const h = Math.max(0, Math.min(48, (now - p.ts) / 3.6e6));
  return {
    name: p.name,
    st: Math.round(clamp01x(p.st - h * 4)),
    cl: Math.round(clamp01x(p.cl - h * 3)),
    mo: Math.round(clamp01x(p.mo - h * 6)),
    ts: now,
    // v8.3 成长/毛色/装扮字段原样透传（衰减不丢档）
    since: p.since,
    care: p.care,
    coat: p.coat,
    wear: p.wear,
  };
}

/** 读档/默认清洗：缺省值 + 名字截断 + 按最后结算时间补衰减 */
function sanitizePet(raw?: PetState): PetState {
  const base: PetState = {
    name: (raw?.name || '团子').slice(0, 8),
    st: raw?.st ?? 88,
    cl: raw?.cl ?? 80,
    mo: raw?.mo ?? 90,
    ts: raw?.ts ?? Date.now(),
    since: raw?.since ?? Date.now(), // v8.3 成长系统：默认从现在开始陪伴
    care: raw?.care ?? 0,
    coat: raw?.coat,
    wear: raw?.wear,
  };
  return decayPet(base);
}

/** 宠物毛色清洗（白名单） */
function sanitizePet2(raw?: Pet2State): Pet2State | undefined {
  if (!raw || (raw.kind !== 'dog' && raw.kind !== 'rabbit')) return undefined;
  return { kind: raw.kind, name: raw.name?.slice(0, 8), since: raw.since ?? Date.now() };
}

// ---------------- v8.3 成长系统（F：陪伴天数 + 照顾次数 → 等级解锁小把戏） ----------------

/** 成长解锁的小把戏（达到 Lv 后出现在互动按钮里） */
const PET_TRICK_DEFS: { kind: PetCareKind; label: string; lvl: number; icon: LucideIcon }[] = [
  { kind: 'shake', label: '握手', lvl: 2, icon: Heart },
  { kind: 'spin', label: '转圈', lvl: 3, icon: RefreshCw },
  { kind: 'roll', label: '打滚', lvl: 5, icon: Circle },
];

/** 宠物等级：1 + 陪伴天数/2 + 累计照顾次数/6（封顶 Lv.9） */
function petLevelOf(p: PetState): number {
  const days = Math.max(0, Math.floor((Date.now() - (p.since ?? Date.now())) / 864e5));
  return Math.min(9, 1 + Math.floor(days / 2) + Math.floor((p.care ?? 0) / 6));
}

/** 当前等级到下一级还差几次照顾（升级进度用） */
function petLevelGap(p: PetState): { days: number; lvl: number; inLvl: number; need: number } {
  const days = Math.max(0, Math.floor((Date.now() - (p.since ?? Date.now())) / 864e5));
  const score = days / 2 + (p.care ?? 0) / 6;
  const lvl = Math.min(9, 1 + Math.floor(score));
  const inLvl = Math.min(1, score - Math.floor(score));
  return { days, lvl, inLvl, need: Math.max(1, Math.ceil((1 - inLvl) * 6)) };
}

/** 宠物互动按钮（v7.1 右侧竖条）：六种照顾动作（bg 已废弃 —— 按钮无彩色底，仅保留彩色图标） */
const PET_ACTIONS: { kind: PetCareKind; icon: LucideIcon; label: string; fg: string }[] = [
  { kind: 'pat', icon: PawPrint, label: '抚摸', fg: '#d96a86' },
  { kind: 'feed', icon: UtensilsCrossed, label: '喂食', fg: '#c98a3e' },
  { kind: 'water', icon: CupSoda, label: '喂水', fg: '#4a90c9' },
  { kind: 'bath', icon: Bath, label: '洗澡', fg: '#3e97b4' },
  { kind: 'hug', icon: HeartHandshake, label: '抱抱', fg: '#d96a86' },
  { kind: 'summon', icon: Sparkles, label: '召唤', fg: '#8a7ab0' },
];

/**
 * 猫头图标（v7.1 内联 SVG，替代 emoji）：奶油猫头 + 耳朵内廓 + 豆豆眼 + 粉鼻 + w 嘴 + 腮红 + 红项圈金铃铛，
 * 与 3D 小猫同款配色；HUD 头像与状态面板共用。
 */
function CatFaceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      {/* 耳朵（先画，压在头后） */}
      <path d="M10 20 Q6.5 8 8.5 6.5 Q10.5 5.5 19 12.5 Z" fill="#fdf8ee" stroke="#eadbc4" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M38 20 Q41.5 8 39.5 6.5 Q37.5 5.5 29 12.5 Z" fill="#fdf8ee" stroke="#eadbc4" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11 16.5 Q9.5 10 10.5 9 Q11.5 8.5 16 12.5 Z" fill="#f6c2ca" />
      <path d="M37 16.5 Q38.5 10 37.5 9 Q36.5 8.5 32 12.5 Z" fill="#f6c2ca" />
      {/* 脸（奶油圆） */}
      <ellipse cx="24" cy="26.5" rx="16" ry="13.5" fill="#fdf8ee" stroke="#eadbc4" strokeWidth="1.4" />
      {/* 豆豆眼 + 高光 */}
      <ellipse cx="17.5" cy="25" rx="2.1" ry="2.5" fill="#3a3230" />
      <ellipse cx="30.5" cy="25" rx="2.1" ry="2.5" fill="#3a3230" />
      <circle cx="18.2" cy="24.2" r="0.7" fill="#ffffff" />
      <circle cx="31.2" cy="24.2" r="0.7" fill="#ffffff" />
      {/* 粉鼻 + w 嘴 */}
      <path d="M22.4 30.4 L25.6 30.4 L24 32.2 Z" fill="#e89aa4" />
      <path d="M24 32.2 Q24 33.8 22.2 33.8 M24 32.2 Q24 33.8 25.8 33.8" fill="none" stroke="#c98d7e" strokeWidth="1.1" strokeLinecap="round" />
      {/* 腮红 */}
      <ellipse cx="12.5" cy="29.5" rx="2.6" ry="1.7" fill="#f6bfc6" opacity="0.8" />
      <ellipse cx="35.5" cy="29.5" rx="2.6" ry="1.7" fill="#f6bfc6" opacity="0.8" />
      {/* 胡须 */}
      <g stroke="#d9c9b4" strokeWidth="1" strokeLinecap="round">
        <path d="M7.5 24.5 L3.5 23.5" />
        <path d="M7.5 27.5 L3.5 28.5" />
        <path d="M40.5 24.5 L44.5 23.5" />
        <path d="M40.5 27.5 L44.5 28.5" />
      </g>
      {/* 红项圈 + 金铃铛（呼应 3D 小猫） */}
      <path d="M14 37.5 Q24 41.5 34 37.5" fill="none" stroke="#e46a6a" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="24" cy="40.5" r="2.1" fill="#f4c34e" stroke="#d9a13c" strokeWidth="0.7" />
    </svg>
  );
}

/**
 * 宠物互动按钮（v7.2 面板下方 & 右侧竖条共用）：白玻璃胶囊 + 彩色图标 + 小字标签（无彩色底）。
 * 抱抱按钮在「抱着」时变「放下」（图标 ArrowDownToLine），点一下即可把小猫放到地上。
 */
function PetActionButton({
  kind,
  icon: Icon,
  label,
  fg,
  carrying,
  disabled,
  onClick,
}: {
  kind: PetCareKind;
  icon: LucideIcon;
  label: string;
  fg: string;
  carrying: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const isHug = kind === 'hug';
  const dropped = isHug && carrying;
  const Icn = dropped ? ArrowDownToLine : Icon;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dropped ? '放下宠物' : `${label}宠物`}
      className={`flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-full bg-white/70 shadow-md ring-1 ring-white/70 backdrop-blur-md transition active:scale-90 disabled:cursor-not-allowed ${
        disabled && !dropped ? 'opacity-40' : ''
      }`}
    >
      <Icn className="h-[17px] w-[17px]" style={{ color: fg }} />
      <span className="text-[8.5px] font-bold leading-none" style={{ color: fg }}>
        {dropped ? '放下' : label}
      </span>
    </button>
  );
}

/**
 * 手机照片 → 居中裁到指定比例 → 压成 JPEG dataURL（几十 KB，可永久存在小家档案里）
 */
function compressPhoto(file: File, aspect: number, maxH = 520, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const finish = (fn: () => void) => {
      URL.revokeObjectURL(url);
      fn();
    };
    img.onload = () => {
      try {
        let cw = img.width;
        let ch = img.height;
        if (cw / ch > aspect) cw = Math.round(ch * aspect);
        else ch = Math.round(cw / aspect);
        const sx = (img.width - cw) / 2;
        const sy = (img.height - ch) / 2;
        const scale = Math.min(1, maxH / ch);
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(cw * scale));
        cv.height = Math.max(1, Math.round(ch * scale));
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(img, sx, sy, cw, ch, 0, 0, cv.width, cv.height);
        const data = cv.toDataURL('image/jpeg', quality);
        finish(() => resolve(data));
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error('compress-fail')));
      }
    };
    img.onerror = () => finish(() => reject(new Error('img-load-fail')));
    img.src = url;
  });
}

/** 调色盘预设（白色为主 + 可混搭的点缀色） */
const SWATCHES: { hex: string; name: string }[] = [
  { hex: '#ffffff', name: '云白' },
  { hex: '#f6f1e7', name: '奶油' },
  { hex: '#e3e1db', name: '浅灰' },
  { hex: '#43464b', name: '柔黑' },
  { hex: '#f6cdd6', name: '浅粉' },
  { hex: '#f2b3c2', name: '樱粉' },
  { hex: '#f9e6a6', name: '浅黄' },
  { hex: '#c9e3cf', name: '抹茶' },
  { hex: '#d9e0e6', name: '雾灰蓝' },
  { hex: '#dcd2ec', name: '雾紫' },
];

/** E7 灯光颜色预设（调色盘「灯光颜色」行：暖黄/奶白/玫粉/天青/星绿/梦紫） */
const LIGHT_SWATCHES: { hex: string; name: string }[] = [
  { hex: '#ffd9a0', name: '暖黄' },
  { hex: '#fff2dc', name: '奶白' },
  { hex: '#ffb3c6', name: '玫粉' },
  { hex: '#a8d8e8', name: '天青' },
  { hex: '#b8e6c9', name: '星绿' },
  { hex: '#d4b8e8', name: '梦紫' },
];

/** F3 套装卡片兜底线性图标（lucide；真实 3D 整组合成缩略图生成前的占位） */
const SET_FALLBACK: Record<string, LucideIcon> = {
  bedSet: BedDouble,
  sofaSet: Armchair,
  studySet: BookOpen,
  teaCorner: Coffee,
  balconySet: Flame,
};

const dirToHeading: Record<string, number> = { up: Math.PI, down: 0, left: -Math.PI / 2, right: Math.PI / 2 };

/** 装修面板单行选色（色卡 + 自定义 + 默认），地板/墙/门/窗共用 */
function ColorRow({
  label,
  value,
  onPick,
  fallback,
}: {
  label: string;
  value?: string;
  onPick: (hex: string | null) => void;
  fallback: string;
}) {
  const validHex = /^#[0-9a-fA-F]{6}$/.test(value ?? '');
  return (
    <div className="mb-3.5 last:mb-0">
      <div className="mb-1 text-[12.5px] font-medium text-[#6a6a6e]">{label}</div>
      <div className="mb-2 grid grid-cols-5 gap-2.5">
        {SWATCHES.map((s) => (
          <button
            key={s.hex}
            onClick={() => onPick(s.hex)}
            title={s.name}
            aria-label={`${label}选色 ${s.name}`}
            className="group flex flex-col items-center gap-1"
          >
            <span
              className={
                value === s.hex
                  ? 'h-9 w-9 rounded-full ring-2 ring-[#f2a9bc] ring-offset-2 shadow-md'
                  : 'h-9 w-9 rounded-full shadow-sm ring-1 ring-black/10 transition group-active:scale-90'
              }
              style={{ background: s.hex }}
            />
            <span className="text-[10px] text-[#8a8a86]">{s.name}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2.5">
        <label className="relative flex h-10 flex-1 cursor-pointer items-center gap-2.5 rounded-2xl bg-[#f6f4ef] px-3 ring-1 ring-[#eae7df]">
          <span
            className="h-6 w-6 rounded-lg shadow-inner ring-1 ring-black/10"
            style={{
              background: validHex
                ? value
                : 'conic-gradient(#f6cdd6,#f9e6a6,#c9e3cf,#dcd2ec,#f6cdd6)',
            }}
          />
          <span className="text-[12px] font-medium text-[#4a4a4e]">自定义{label}色</span>
          <input
            type="color"
            aria-label={`自定义${label}颜色`}
            className="absolute inset-0 cursor-pointer opacity-0"
            value={validHex ? value : fallback}
            onChange={(e) => onPick(e.target.value)}
          />
        </label>
        <button
          onClick={() => onPick(null)}
          className="flex h-10 items-center rounded-2xl bg-[#f1efe9] px-3.5 text-[12px] font-medium text-[#8a8a86] transition active:scale-95"
        >
          默认
        </button>
      </div>
    </div>
  );
}

function headingToDir(h: number): 'up' | 'down' | 'left' | 'right' {
  const deg = ((((h * 180) / Math.PI) % 360) + 360) % 360;
  if (deg >= 315 || deg < 45) return 'down';
  if (deg >= 45 && deg < 135) return 'right';
  if (deg >= 135 && deg < 225) return 'up';
  return 'left';
}

/** 角度归一到 [-π, π] */
function normAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/** 家具动作 → 小人姿势（watch/work/game 也是坐姿；play 按乐器分流，见 act.pose；coffee 复用喝姿；read 专门看书姿势） */
const POSE_OF_ACT: Record<CharAction['type'], CharPose> = {
  sit: 'sit',
  lie: 'lie',
  bath: 'bath',
  shower: 'shower',
  watch: 'sit',
  work: 'sit',
  cook: 'cook',
  eat: 'eat',
  drink: 'drink',
  play: 'sit',
  makeup: 'makeup',
  mirror: 'mirror',
  dress: 'stand',
  game: 'sit',
  hotpot: 'eat',
  coffee: 'drink',
  read: 'read',
};

/** 自动结束型动作（走到位后定时完成；退出重进时不恢复） */
const AUTO_ACTS: ReadonlySet<CharAction['type']> = new Set(['cook', 'drink', 'dress', 'coffee']);

/** 动作按钮文案：[待开始, 进行中] */
const ACT_LABELS: Record<CharAction['type'], [string, string]> = {
  sit: ['坐下', '站起来'],
  lie: ['睡觉', '起床'],
  bath: ['泡个澡', '出来啦'],
  shower: ['冲个澡', '出来啦'],
  watch: ['看电视', '关电视'],
  work: ['上网', '休息一下'],
  cook: ['做一顿饭', '不做了'],
  eat: ['开饭', '吃饱啦'],
  drink: ['喝一杯', '放下杯子'],
  dress: ['换套衣服', '换好啦'],
  play: ['演奏一曲', '演奏结束'],
  makeup: ['化个妆', '化好啦'],
  mirror: ['照照镜子', '照好啦'],
  game: ['打游戏', '不玩啦'],
  hotpot: ['开涮火锅', '吃饱啦'],
  coffee: ['端一杯咖啡', '放下杯子'],
  read: ['抽本书读', '合上书'],
};

/**
 * 由动作类型 + 家具实例算出完整动作参数（落点/朝向/支撑面/起身落点）。
 * 起身落点默认沿「背对所面对象」方向留出一步：躺床从床尾下、坐椅向房内跨一步、
 * 看电视/上网/做饭/喝东西等面向家具的动作向后离屏；目录锚点可用 out 显式指定。
 * ⚑ 面向家具型动作（watch/work/cook/…）小人朝向 = 家具朝向 + π（脸对着家具）。
 */
const FACE_ACTS: ReadonlySet<CharAction['type']> = new Set([
  'watch', 'work', 'cook', 'eat', 'drink', 'dress', 'play', 'makeup', 'mirror', 'coffee',
]);

function anchorOf(type: CharAction['type'], item: FurnitureItem): CharAction | null {
  const entry = CATALOG[item.kind];
  const a =
    type === 'sit'
      ? entry?.acts.seat
      : type === 'lie'
        ? entry?.acts.sleep
        : type === 'bath' || type === 'shower'
          ? entry?.acts.bath
          : type === 'watch'
            ? entry?.acts.watch
            : type === 'cook'
              ? entry?.acts.cook
              : type === 'eat'
                ? entry?.acts.eat
                : type === 'drink'
                  ? entry?.acts.drink
                  // read 的 itemId 是「沙发/椅子」本身：锚点复用 seat 配置
                  : type === 'read'
                    ? entry?.acts.seat
                    : type === 'coffee'
                      ? entry?.acts.coffee
                      : type === 'dress'
                        ? entry?.acts.dress
                        : type === 'play'
                          ? entry?.acts.play
                          : type === 'makeup'
                            ? entry?.acts.makeup
                            : type === 'mirror'
                              ? entry?.acts.mirror
                              : type === 'hotpot'
                                ? entry?.acts.hotpot
                                : type === 'game'
                                  ? entry?.acts.game
                                  : entry?.acts.work;
  if (!a) return null;
  // 目录锚点统一形状（各 act 是同一形状的子集，字段可选）
  const an = a as {
    y: number;
    dx?: number;
    dz?: number;
    ryOff?: number;
    out?: [number, number];
  };
  const ry0 = item.ry ?? 0;
  const ry = ry0 + (an.ryOff ?? 0) + (FACE_ACTS.has(type) ? Math.PI : 0);
  const cos = Math.cos(ry0);
  const sin = Math.sin(ry0);
  const lx = an.dx ?? 0;
  let lz = an.dz ?? 0;
  // 写实小人腿长（≈0.78×身高）：坐在座面锚点时大腿会伸进座垫深处。
  // 坐姿系（sit/read）把锚点夹到座面前缘内 0.16m，让大腿探出前缘、小腿自然垂在沙发外。
  if ((type === 'sit' || type === 'read') && !an.out) {
    const fpD = entry?.fp?.[1] ?? 0;
    lz = Math.min(lz, fpD / 2 - 0.16);
  }
  const back = type === 'lie' ? -1.45 : type === 'bath' ? 0.95 : 0.55;
  const out: [number, number] = an.out ?? [lx, lz + back];
  return {
    type,
    itemId: item.id,
    tx: item.x + lx * cos + lz * sin,
    tz: item.z - lx * sin + lz * cos,
    ry,
    y: a.y ?? 0,
    ox: item.x + out[0] * cos + out[1] * sin,
    oz: item.z - out[0] * sin + out[1] * cos,
    // play 按乐器分流姿势（钢琴坐姿 / 吉他站姿）；read 用专门的看书坐姿
    pose:
      type === 'play'
        ? item.kind === 'piano'
          ? 'piano'
          : 'guitar'
        : type === 'read'
          ? 'read'
          : undefined,
  };
}

interface Toast {
  id: number;
  msg: string;
}

let uid = 0;
/** 购买序号（同毫秒连点也保证 id 唯一 —— 商城无限添加不串档） */
let buySeq = 0;

/** 装修快照：一次装修操作（放置/收起/移动/旋转/升降/换色/门窗调整）前的完整可编辑状态 */
interface EditSnap {
  items: FurnitureItem[];
  winExist?: boolean[];
  winPos?: number[];
  doorPos?: { bed: number; kt: number; bath: number; bal?: number };
  winCol?: string;
  doorCol?: string;
  floorCol?: string;
  wallCol?: string;
  floorColBed?: string;
  wallColBed?: string;
  floorColK?: string;
  wallColK?: string;
  floorColB?: string;
  wallColB?: string;
  ceilCol?: string;
  ceilColBed?: string;
  ceilColK?: string;
  ceilColB?: string;
  floorColBal?: string;
  wallColBal?: string;
  floorTex: 'plain' | 'wood' | 'check';
  wallTex: 'plain' | 'dot' | 'stripe';
}

/** 撤销栈深度上限（步） */
const HIST_MAX = 60;
/** 连续手势合并时间窗（ms）：拖拽帧/快速连点并入栈顶同一步 */
const HIST_COALESCE = 900;

/** 编辑模式操作条：毛玻璃胶囊容器质感 */
const EDIT_GLASS =
  'border border-white/70 bg-white/55 shadow-[0_10px_28px_rgba(90,70,60,0.20)] backdrop-blur-2xl';
/** 毛玻璃方向盘小圆钮（移动 · 按下泛绿） */
const editDirBtn =
  'flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-[#77766e] shadow-sm ring-1 ring-white/60 transition active:scale-90 active:bg-[#dff0e2] active:text-[#3f9a58]';
/** 同上（升降 · 按下泛蓝） */
const editDirBtnBlue =
  'flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-[#77766e] shadow-sm ring-1 ring-white/60 transition active:scale-90 active:bg-[#e2edf3] active:text-[#4e7f95]';
/** 同上（旋转 · 按下泛暖沙） */
const editDirBtnAmber =
  'flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-[#77766e] shadow-sm ring-1 ring-white/60 transition active:scale-90 active:bg-[#f5efe2] active:text-[#8a7a54]';

// ---------------- v8.2 优化A：小屋聊天记录持久化（localStorage 按角色分档，退出重进上下文不丢） ----------------

/** 每个角色一份会话存档（LLM 上下文 + 记忆提取轮次） */
interface CabinConvoSave {
  convo: { role: 'user' | 'assistant'; content: string }[];
  turns: { role: 'me' | 'peer'; text: string }[];
  ts: number;
}

const CONVO_SAVE_LIMIT = 40;

function loadCabinConvo(id: string): CabinConvoSave {
  try {
    const raw = window.localStorage.getItem(`cabin-chat-${id}`);
    if (!raw) return { convo: [], turns: [], ts: 0 };
    const j = JSON.parse(raw) as Partial<CabinConvoSave>;
    const convo = Array.isArray(j.convo)
      ? j.convo
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-CONVO_SAVE_LIMIT)
      : [];
    const turns = Array.isArray(j.turns)
      ? j.turns.filter((m) => m && (m.role === 'me' || m.role === 'peer') && typeof m.text === 'string').slice(-CONVO_SAVE_LIMIT)
      : [];
    return { convo, turns, ts: typeof j.ts === 'number' ? j.ts : 0 };
  } catch {
    return { convo: [], turns: [], ts: 0 };
  }
}

function saveCabinConvo(
  id: string,
  convo: { role: 'user' | 'assistant'; content: string }[],
  turns: { role: 'me' | 'peer'; text: string }[],
): void {
  try {
    const data: CabinConvoSave = { convo: convo.slice(-CONVO_SAVE_LIMIT), turns: turns.slice(-CONVO_SAVE_LIMIT), ts: Date.now() };
    window.localStorage.setItem(`cabin-chat-${id}`, JSON.stringify(data));
  } catch {
    /* 写不进就算了（隐私模式） */
  }
}

export default function CoupleHome({ close }: { close: () => void }) {
  // ---------------- 持久化状态 ----------------
  const [pack] = useState<HomePersist>(() => loadCache() ?? { home: defaultHome(), rev: 0 });
  const [items, setItems] = useState<FurnitureItem[]>(pack.home.furniture);
  const [night, setNight] = useState<boolean>(pack.home.night);
  const [rev, setRev] = useState<number>(pack.rev);
  const [win, setWin] = useState<boolean[]>([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => !!pack.home.win?.[i]));
  const [floorCol, setFloorCol] = useState<string | undefined>(pack.home.floorCol);
  const [wallCol, setWallCol] = useState<string | undefined>(pack.home.wallCol);
  const [floorColBed, setFloorColBed] = useState<string | undefined>(pack.home.floorColBed);
  const [wallColBed, setWallColBed] = useState<string | undefined>(pack.home.wallColBed);
  const [doorOpen, setDoorOpen] = useState<boolean>(!!pack.home.doorOpen);
  const [kitchenDoorOpen, setKitchenDoorOpen] = useState<boolean>(!!pack.home.kitchenDoorOpen);
  const [doorCol, setDoorCol] = useState<string | undefined>(pack.home.doorCol);
  const [winCol, setWinCol] = useState<string | undefined>(pack.home.winCol);
  const [floorColK, setFloorColK] = useState<string | undefined>(pack.home.floorColK);
  const [wallColK, setWallColK] = useState<string | undefined>(pack.home.wallColK);
  const [floorColB, setFloorColB] = useState<string | undefined>(pack.home.floorColB);
  const [wallColB, setWallColB] = useState<string | undefined>(pack.home.wallColB);
  const [ceilCol, setCeilCol] = useState<string | undefined>(pack.home.ceilCol);
  const [ceilColBed, setCeilColBed] = useState<string | undefined>(pack.home.ceilColBed);
  const [ceilColK, setCeilColK] = useState<string | undefined>(pack.home.ceilColK);
  const [ceilColB, setCeilColB] = useState<string | undefined>(pack.home.ceilColB);
  const [bathDoorOpen, setBathDoorOpen] = useState<boolean>(!!pack.home.bathDoorOpen);
  const [winPos, setWinPos] = useState<number[] | undefined>(pack.home.winPos);
  const [doorPos, setDoorPos] = useState<{ bed: number; kt: number; bath: number; bal?: number } | undefined>(pack.home.doorPos);
  const [fp, setFp] = useState<boolean>(!!pack.home.fp);
  const [nightAuto, setNightAuto] = useState<boolean>(pack.home.nightAuto !== false);
  // v5.6：做饭一桌菜 / 地板墙面纹理；v6.2：衣柜穿搭（发型+连衣裙/分体+鞋）；v6.3 男生穿搭
  const [wear, setWear] = useState<GirlWear>(() => sanitizeWear(pack.home.wear));
  const [wear2, setWear2] = useState<BoyWear>(() => sanitizeBoyWear(pack.home.wear2));
  /** 衣柜弹窗（走到衣柜前弹出） */
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  /** 九扇窗是否存在（false = 已被收起；编辑模式可收起，商店可装回） */
  const [winExist, setWinExist] = useState<boolean[]>(() =>
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => pack.home.winExist?.[i] !== false),
  );
  const [mealReady, setMealReady] = useState<boolean>(!!pack.home.mealReady);
  const [floorTex, setFloorTex] = useState<'plain' | 'wood' | 'check'>(pack.home.floorTex ?? 'wood');
  const [wallTex, setWallTex] = useState<'plain' | 'dot' | 'stripe'>(pack.home.wallTex ?? 'plain');
  // v5.7 拾光扩展：阳台门/色 + 好菜名 + 宠物
  const [balconyDoorOpen, setBalconyDoorOpen] = useState<boolean>(!!pack.home.balconyDoorOpen);
  const [floorColBal, setFloorColBal] = useState<string | undefined>(pack.home.floorColBal);
  const [wallColBal, setWallColBal] = useState<string | undefined>(pack.home.wallColBal);
  const [mealName, setMealName] = useState<string | undefined>(pack.home.mealName);

  // ---------------- UI 状态 ----------------
  const [mode, setMode] = useState<HomeMode>('live');
  const [selId, setSelId] = useState<string | null>(null);
  const [moveOn, setMoveOn] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [roomStyleOpen, setRoomStyleOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopTab, setShopTab] = useState<string>('all');
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  /** v5.7 拾光扩展面板：点歌 / 五子棋 / 做饭小游戏 / 拍照模式 */
  const [musicSheet, setMusicSheet] = useState(false);
  /** 右上角 ⋮ 更多菜单：时间变化 / 声音开关 / 视角 */
  const [moreOpen, setMoreOpen] = useState(false);
  const [chess, setChess] = useState<{ itemId: string } | null>(null);
  const [cookingGame, setCookingGame] = useState(false);
  // —— v6.1 G 系列：装修方案 / 留言板 / 三连小游戏 ——
  /** G1 装修方案（最多 3 套整屋快照） */
  const [layouts, setLayouts] = useState<LayoutSnap[]>(pack.home.layouts ?? []);
  /** G8 留言板便签 */
  const [notes, setNotes] = useState<NoteEntry[]>(pack.home.notes ?? []);
  const [noteOpen, setNoteOpen] = useState(false);
  /** G8 各自未读提醒只弹一次 */
  const notesRemindRef = useRef(false);
  /** G8 我方已读时间戳（打开面板时刷新） */
  const notesSeenRef = useRef<{ me?: number; partner?: number }>(pack.home.notesSeen ?? {});
  /** G10 娃娃机：正在玩的机器家具 id */
  const [clawFor, setClawFor] = useState<string | null>(null);
  /** G10 咖啡拉花小游戏 */
  const [latteOpen, setLatteOpen] = useState(false);
  /** G10 相框菜单（换照片/拼图）与拼图会话 */
  const [photoMenuFor, setPhotoMenuFor] = useState<string | null>(null);
  const [puzzleFor, setPuzzleFor] = useState<{ photo?: string } | null>(null);
  const [photoMode, setPhotoMode] = useState(false);
  /** E3 音效开关（持久化在 sfx 模块内 localStorage，挂载时读回） */
  const [sfxOn, setSfxOn] = useState(true);
  /** 天气（与天气 App 共享缓存）：rain/snow/clear 驱动窗外特效 + 夜晚自动开灯 */
  const weather = useWeatherSnapshot();
  const weatherFx: 'rain' | 'snow' | 'clear' = useMemo(() => {
    const c = weather?.current.code ?? 0;
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || (c >= 95 && c <= 99)) return 'rain';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    return 'clear';
  }, [weather]);
  /** 音乐 App 正在放歌（音箱飘音符 + 黑胶/八音盒跟播联动） */
  const musicPlaying = useMusic((s) => s.playing);
  // 黑胶唱片机 / 八音盒随音乐播放自动转/停、开/合盖（v5.9 起跟播放态联动，八音盒 v6.0 加入）
  useEffect(() => {
    setItems((prev) => {
      let changed = false;
      const next = prev.map((f) => {
        if (f.kind !== 'vinyl' && f.kind !== 'musicBox') return f;
        if (!!f.st?.on === musicPlaying) return f;
        changed = true;
        return { ...f, st: { ...f.st, on: musicPlaying } };
      });
      return changed ? next : prev;
    });
  }, [musicPlaying]);
  /** 家具互动（生活模式）：点击可坐/睡/泡/淋浴/看电视/上网的家具后弹出确认按钮 */
  const [charAction, setCharAction] = useState<{
    type: CharAction['type'];
    itemId: string;
    active: boolean;
  } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoTargetRef = useRef<string | null>(null);

  // ---------------- 小人运行时（ref 高频更新，不走 React） ----------------
  const meRT = useRef<CharRT>({
    x: pack.home.chars.me.x,
    z: pack.home.chars.me.z,
    heading: dirToHeading[pack.home.chars.me.dir] ?? 0,
    moving: false,
    target: null,
    nextWander: 3,
  });
  const taRT = useRef<CharRT>({
    x: pack.home.chars.partner.x,
    z: pack.home.chars.partner.z,
    heading: dirToHeading[pack.home.chars.partner.dir] ?? 0,
    moving: false,
    target: null,
    nextWander: 5,
  });
  const joyRef = useRef({ dx: 0, dy: 0 });
  /** 小人姿势（stand/sit/lie/bath + 支撑面高度）：GameLoop / Char3D 每帧读取 */
  const poseRef = useRef<{ pose: CharPose; y: number }>({ pose: 'stand', y: 0 });
  /** 正在执行的家具动作（走向家具 → 摆姿势） */
  const actRef = useRef<CharAction | null>(null);
  /** 自动结束型动作的定时器（做饭/喝东西/换装） */
  const actTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 乐器弹奏特写（吉他/钢琴：镜头推近 + 可弹奏覆盖层；ref 给 GameLoop 高频读） */
  const instRef = useRef<{ kind: 'piano' | 'guitar'; itemId: string } | null>(null);
  const [inst, setInst] = useState<{ kind: 'piano' | 'guitar'; itemId: string } | null>(null);
  // 音乐家具（唱片机/八音盒/音箱点歌 + 钢琴/吉他弹奏）放歌时：压制全局迷你播放器（退出小屋自动复位）
  useEffect(() => {
    useMiniPlayer.getState().setSuppress(musicPlaying || !!inst);
    return () => useMiniPlayer.getState().setSuppress(false);
  }, [musicPlaying, inst]);
  /** 手持物（拿饮料/咖啡后杯子握在右手，可以端着到处逛；coffee = 咖啡冒热气款；pet = 怀里抱着小猫） */
  const carryRef = useRef({ cup: false, coffee: false, pet: false });
  const [carryCup, setCarryCup] = useState(false);
  /** 编辑模式缩放指令（HUD 按钮 → Canvas 内相机） */
  const zoomCmd = useRef({ v: 0, dir: 0 });
  /** 四向微调指令（HUD 方向按钮 → Canvas 内按视角方位换算） */
  const moveCmd = useRef({ v: 0, dir: 'up' as 'up' | 'down' | 'left' | 'right' });

  // ---------------- 宠物「团子」（v6.9：体力/清洁/心情 + 改名，持久化在 HomeState.pet） ----------------
  const [pet, setPet] = useState<PetState>(() => sanitizePet(pack.home.pet));
  const petRef = useRef(pet);
  /** v8.3 第二只宠物（小狗/小兔子；undefined = 还没领） */
  const [pet2, setPet2] = useState<Pet2State | undefined>(() => sanitizePet2(pack.home.pet2));
  const pet2Ref = useRef(pet2);
  useEffect(() => {
    pet2Ref.current = pet2;
  }, [pet2]);
  /** v8.3 领养弹窗 + 衣柜预设「宠物」栏 */
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [wardrobeChar, setWardrobeChar] = useState<'girl' | 'boy' | 'pet'>('girl');
  petRef.current = pet;
  /** 宠物照顾指令（面板按钮 → PetBuddy；seq 递增触发新指令；carry=true 抱起模式） */
  const petCmdRef = useRef<{ kind: PetCareKind; seq: number; carry?: boolean } | null>(null);
  const petSeq = useRef(0);
  /** 状态面板开关 / 正在进行的照顾动作 / 改名弹层 */
  const [petPanel, setPetPanel] = useState(false);
  /** v7.1 宠物互动竖条开关：点击宠物才出现，点击别处（地面/家具）或照顾完成后自动收起 */
  const [petBarOpen, setPetBarOpen] = useState(false);
  /** 最近一次点宠物的时刻（ms）：down 命中宠物后，同一次点击的 up 射线会落到地板/家具上，用它区分「真点别处」 */
  const petTapAtRef = useRef(0);
  /** v8.0 同款守卫：down 命中陪伴小人后，同一次点击的 up 射线不能当作「点别处」关菜单 */
  const partnerTapAtRef = useRef(0);
  const [petCare, setPetCare] = useState<PetCareKind | null>(null);
  /** 照顾中镜像（供 beginAction 等旧回调读取，不引入重依赖） */
  const petCareRef = useRef<PetCareKind | null>(null);
  useEffect(() => {
    petCareRef.current = petCare;
  }, [petCare]);
  // —— v7.2 抱抱 = 抱起/放下：抱着时可随意走动，按钮变「放下」 ——
  /** 正抱着宠物（UI 态：抱抱按钮变「放下」） */
  const [carrying, setCarrying] = useState(false);
  /** 抱着镜像（供旧回调同步读取，免 useEffect 延迟） */
  const carryPetRef = useRef(false);
  /** 抱抱指令通道（on=true 抱起 / on=false 放下；seq 递增触发） */
  const petCarryCmdRef = useRef({ on: false, seq: 0 });
  const petCarrySeq = useRef(0);
  /** v8.3 玩具球扔球指令（seq 递增 = 扔一次） */
  const petBallCmdRef = useRef({ seq: 0 });
  const petBallSeq = useRef(0);
  const [petRenaming, setPetRenaming] = useState(false);
  const [petNameDraft, setPetNameDraft] = useState('');
  /** 宠物在线缓慢衰减（每 30s 结算一次；离线衰减在 sanitizePet 一次性追算） */
  useEffect(() => {
    const iv = setInterval(() => {
      setPet((p) => {
        const next = decayPet(p);
        return next.st === p.st && next.cl === p.cl && next.mo === p.mo ? p : next;
      });
    }, 30000);
    return () => clearInterval(iv);
  }, []);

  // ---------------- 同步 refs（快照用） ----------------
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const nightRef = useRef(night);
  nightRef.current = night;
  const revRef = useRef(rev);
  revRef.current = rev;
  const winRef = useRef(win);
  winRef.current = win;
  const floorColRef = useRef(floorCol);
  floorColRef.current = floorCol;
  const wallColRef = useRef(wallCol);
  wallColRef.current = wallCol;
  const floorColBedRef = useRef(floorColBed);
  floorColBedRef.current = floorColBed;
  const wallColBedRef = useRef(wallColBed);
  wallColBedRef.current = wallColBed;
  const doorOpenRef = useRef(doorOpen);
  doorOpenRef.current = doorOpen;
  const kitchenDoorOpenRef = useRef(kitchenDoorOpen);
  kitchenDoorOpenRef.current = kitchenDoorOpen;
  const doorColRef = useRef(doorCol);
  doorColRef.current = doorCol;
  const winColRef = useRef(winCol);
  winColRef.current = winCol;
  const floorColKRef = useRef(floorColK);
  floorColKRef.current = floorColK;
  const wallColKRef = useRef(wallColK);
  wallColKRef.current = wallColK;
  const floorColBRef = useRef(floorColB);
  floorColBRef.current = floorColB;
  const wallColBRef = useRef(wallColB);
  wallColBRef.current = wallColB;
  const ceilColRef = useRef(ceilCol);
  ceilColRef.current = ceilCol;
  const ceilColBedRef = useRef(ceilColBed);
  ceilColBedRef.current = ceilColBed;
  const ceilColKRef = useRef(ceilColK);
  ceilColKRef.current = ceilColK;
  const ceilColBRef = useRef(ceilColB);
  ceilColBRef.current = ceilColB;
  const bathDoorOpenRef = useRef(bathDoorOpen);
  bathDoorOpenRef.current = bathDoorOpen;
  const winPosRef = useRef(winPos);
  winPosRef.current = winPos;
  const doorPosRef = useRef(doorPos);
  doorPosRef.current = doorPos;
  const fpRef = useRef({ on: fp });
  useEffect(() => {
    fpRef.current.on = fp;
  }, [fp]);
  const nightAutoRef = useRef(nightAuto);
  nightAutoRef.current = nightAuto;
  const wearRef = useRef(wear);
  wearRef.current = wear;
  const wear2Ref = useRef(wear2);
  wear2Ref.current = wear2;
  const winExistRef = useRef(winExist);
  winExistRef.current = winExist;
  const mealReadyRef = useRef(mealReady);
  mealReadyRef.current = mealReady;
  const floorTexRef = useRef(floorTex);
  floorTexRef.current = floorTex;
  const wallTexRef = useRef(wallTex);
  wallTexRef.current = wallTex;
  const balconyDoorOpenRef = useRef(balconyDoorOpen);
  balconyDoorOpenRef.current = balconyDoorOpen;
  const floorColBalRef = useRef(floorColBal);
  floorColBalRef.current = floorColBal;
  const wallColBalRef = useRef(wallColBal);
  wallColBalRef.current = wallColBal;
  const mealNameRef = useRef(mealName);
  mealNameRef.current = mealName;
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const sfxOnRef = useRef(sfxOn);
  sfxOnRef.current = sfxOn;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  /** F1 节日限定：用户收起过的节日 kind（当月不再自动补） */
  const seasonalDismissed = useRef<Set<string>>(new Set());
  // ---------------- 装修历史：撤销/重做快照栈 ----------------
  const undoStack = useRef<EditSnap[]>([]);
  const redoStack = useRef<EditSnap[]>([]);
  /** 连续手势合并标记（拖拽帧/快速连点在时间窗内并入栈顶同一步） */
  const histTagRef = useRef<{ tag: string | null; at: number }>({ tag: null, at: 0 });
  /** 栈长度（驱动撤销/重做按钮禁用态） */
  const [histLen, setHistLen] = useState({ u: 0, r: 0 });

  /** 抓取当前可编辑状态快照（浅拷贝，防后续原地修改串档） */
  const takeSnap = useCallback(
    (): EditSnap => ({
      items: itemsRef.current.map((f) => ({ ...f, st: { ...f.st } })),
      winExist: winExistRef.current.slice(),
      winPos: winPosRef.current ? winPosRef.current.slice() : undefined,
      doorPos: doorPosRef.current ? { ...doorPosRef.current } : undefined,
      winCol: winColRef.current,
      doorCol: doorColRef.current,
      floorCol: floorColRef.current,
      wallCol: wallColRef.current,
      floorColBed: floorColBedRef.current,
      wallColBed: wallColBedRef.current,
      floorColK: floorColKRef.current,
      wallColK: wallColKRef.current,
      floorColB: floorColBRef.current,
      wallColB: wallColBRef.current,
      ceilCol: ceilColRef.current,
      ceilColBed: ceilColBedRef.current,
      ceilColK: ceilColKRef.current,
      ceilColB: ceilColBRef.current,
      floorColBal: floorColBalRef.current,
      wallColBal: wallColBalRef.current,
      floorTex: floorTexRef.current,
      wallTex: wallTexRef.current,
    }),
    [],
  );

  /** 每次装修操作前调用：当前状态入撤销栈、清空重做栈（tag = 连续手势标记） */
  const pushHistory = useCallback(
    (tag?: string) => {
      const now = Date.now();
      if (tag && histTagRef.current.tag === tag && now - histTagRef.current.at < HIST_COALESCE) {
        histTagRef.current.at = now; // 同一连续手势：栈顶快照已是手势起点，不重复入栈
        return;
      }
      histTagRef.current = { tag: tag ?? null, at: now };
      undoStack.current.push(takeSnap());
      if (undoStack.current.length > HIST_MAX) undoStack.current.shift();
      redoStack.current = [];
      setHistLen({ u: undoStack.current.length, r: 0 });
    },
    [takeSnap],
  );

  /** 重置/采纳对方布置后清空历史（快照已失效） */
  const clearHistory = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    histTagRef.current = { tag: null, at: 0 };
    setHistLen({ u: 0, r: 0 });
  }, []);

  // ---------------- 提示 ----------------
  const toast = useCallback((msg: string) => {
    const id = ++uid;
    setToasts((t) => [...t.slice(-2), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  }, []);

  // ---------------- 快照与推送 ----------------
  const snap = useCallback((): HomePersist => {
    const home: HomeState = {
      v: 5,
      furniture: itemsRef.current,
      night: nightRef.current,
      win: winRef.current,
      winExist: winExistRef.current,
      winPos: winPosRef.current,
      doorPos: doorPosRef.current,
      floorCol: floorColRef.current,
      wallCol: wallColRef.current,
      floorColBed: floorColBedRef.current,
      wallColBed: wallColBedRef.current,
      floorColK: floorColKRef.current,
      wallColK: wallColKRef.current,
      floorColB: floorColBRef.current,
      wallColB: wallColBRef.current,
      ceilCol: ceilColRef.current,
      ceilColBed: ceilColBedRef.current,
      ceilColK: ceilColKRef.current,
      ceilColB: ceilColBRef.current,
      doorOpen: doorOpenRef.current,
      kitchenDoorOpen: kitchenDoorOpenRef.current,
      bathDoorOpen: bathDoorOpenRef.current,
      doorCol: doorColRef.current,
      winCol: winColRef.current,
      fp: fpRef.current.on,
      nightAuto: nightAutoRef.current,
      wear: wearRef.current,
      wear2: wear2Ref.current,
      mealReady: mealReadyRef.current,
      floorTex: floorTexRef.current,
      wallTex: wallTexRef.current,
      balconyDoorOpen: balconyDoorOpenRef.current,
      floorColBal: floorColBalRef.current,
      wallColBal: wallColBalRef.current,
      mealName: mealNameRef.current,
      layouts: layoutsRef.current,
      notes: notesRef.current,
      notesSeen: notesSeenRef.current,
      // 宠物状态（v6.9：名字 + 体力/清洁/心情，跨会话延续）
      pet: { ...petRef.current, ts: Date.now() },
      // v8.3 第二只宠物
      pet2: pet2Ref.current ? { ...pet2Ref.current } : undefined,
      // 正在进行的家具动作（已摆好姿势才存，重进页面接着坐/睡/泡/淋浴/看电视/上网；
      // 自动结束型不存 —— 重进后重新发起即可）
      act: (() => {
        const a = actRef.current;
        return a?.arrived && !AUTO_ACTS.has(a.type) ? { type: a.type, itemId: a.itemId } : undefined;
      })(),
      chars: {
        me: {
          x: Math.round(meRT.current.x * 100) / 100,
          z: Math.round(meRT.current.z * 100) / 100,
          dir: headingToDir(meRT.current.heading),
        },
        partner: {
          x: Math.round(taRT.current.x * 100) / 100,
          z: Math.round(taRT.current.z * 100) / 100,
          dir: headingToDir(taRT.current.heading),
        },
      },
    };
    return { home, rev: revRef.current };
  }, []);

  /** 采纳一份完整档案（远端冲突 / 初始化 / 重置共用） */
  const adoptHome = useCallback((h: HomeState) => {
    setItems(h.furniture);
    setNight(h.night);
    setWin([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => !!h.win?.[i]));
    setFloorCol(h.floorCol);
    setWallCol(h.wallCol);
    setFloorColBed(h.floorColBed);
    setWallColBed(h.wallColBed);
    setFloorColK(h.floorColK);
    setWallColK(h.wallColK);
    setFloorColB(h.floorColB);
    setWallColB(h.wallColB);
    setCeilCol(h.ceilCol);
    setCeilColBed(h.ceilColBed);
    setCeilColK(h.ceilColK);
    setCeilColB(h.ceilColB);
    setDoorOpen(!!h.doorOpen);
    setKitchenDoorOpen(!!h.kitchenDoorOpen);
    setBathDoorOpen(!!h.bathDoorOpen);
    setDoorCol(h.doorCol);
    setWinCol(h.winCol);
    setWinPos(h.winPos);
    setDoorPos(h.doorPos);
    setFp(!!h.fp);
    setNightAuto(h.nightAuto !== false);
    setWear(sanitizeWear(h.wear));
    setWear2(sanitizeBoyWear(h.wear2));
    setWinExist([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => h.winExist?.[i] !== false));
    // 宠物状态合并（v6.9）：照顾加成只增不减，取两侧较高值 ——
    // 避免在途旧档案的冲突采纳/延迟回滚把刚喂完的体力「弹回」旧值
    setPet((prev) => {
      const inc = sanitizePet(h.pet);
      return {
        name: prev.name && prev.name !== '团子' ? prev.name : inc.name || prev.name,
        st: Math.max(prev.st, inc.st),
        cl: Math.max(prev.cl, inc.cl),
        mo: Math.max(prev.mo, inc.mo),
        ts: Date.now(),
        // v8.3 成长/毛色/装扮：收养时间取更早（陪伴天数只多不少），照顾次数取较多，装扮/毛色远端有就用远端
        since: Math.min(prev.since ?? Date.now(), inc.since ?? Date.now()),
        care: Math.max(prev.care ?? 0, inc.care ?? 0),
        coat: inc.coat ?? prev.coat,
        wear: inc.wear ?? prev.wear,
      };
    });
    // v8.3 第二只宠物（远端有就用远端）
    setPet2((prev) => sanitizePet2(h.pet2) ?? prev);
    setMealReady(!!h.mealReady);
    setFloorTex(h.floorTex ?? 'wood');
    setWallTex(h.wallTex ?? 'plain');
    setBalconyDoorOpen(!!h.balconyDoorOpen);
    setFloorColBal(h.floorColBal);
    setWallColBal(h.wallColBal);
    setMealName(h.mealName);
    setLayouts(h.layouts ?? []);
    setNotes(h.notes ?? []);
    notesSeenRef.current = h.notesSeen ?? {};
    clearHistory();
    // 恢复「我」正在进行的家具动作（仅在当前没有进行中动作时：
    // 初始化/重置/409 采纳互不打架；家具已被删或自动结束型动作则忽略）
    if (!actRef.current && poseRef.current.pose === 'stand' && h.act && !AUTO_ACTS.has(h.act.type)) {
      const a = h.act;
      const it = h.furniture.find((f) => f.id === a.itemId);
      const full = it ? anchorOf(a.type, it) : null;
      if (full) {
        full.arrived = true;
        actRef.current = full;
        poseRef.current.pose = full.pose ?? POSE_OF_ACT[a.type];
        poseRef.current.y = full.y;
        setCharAction({ type: a.type, itemId: a.itemId, active: true });
      }
    }
  }, [clearHistory]);

  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushTick = useRef(0);
  const doPush = useCallback(
    async (p: HomePersist) => {
      const res = await pushRemote(p);
      if (res === 'offline') return; // 网络失败：保持本地，稍后重试
      if ('conflict' in res) {
        // 采纳服务端最新
        const s = res.conflict;
        adoptHome(s.home);
        setRev(s.rev);
        meRT.current.x = s.home.chars.me.x;
        meRT.current.z = s.home.chars.me.z;
        taRT.current.x = s.home.chars.partner.x;
        taRT.current.z = s.home.chars.partner.z;
        saveCacheNow(s);
        toast('已同步对方的最新布置');
        return;
      }
      setRev(res.rev);
    },
    [toast, adoptHome],
  );

  const schedulePush = useCallback(
    (_p?: HomePersist) => {
      // ⚑ 快照在推送定时器触发时才生成（ref 渲染后已最新）：
      //   旧版在 schedulePush 调用瞬间抓快照 —— 门刚点开时 ref 还是旧值，
      //   且 2.5s 内若有一笔在途旧 rev 推送落到服务端，409 采纳会把刚开
      //   的门「回滚关闭」。现在统一在触发时取最新 ref + 最新 rev。
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        const data = snap();
        saveCache(data); // idb 节流写
        void doPush(data);
      }, 2500);
      // 快速本地落盘（setState 渲染完成后 ref 已最新，~60ms 足够）
      setTimeout(() => saveCache(snap()), 60);
    },
    [snap, doPush],
  );

  const saveSoon = useCallback(() => schedulePush(), [schedulePush]);

  /** v8.3 领养第二只宠物（小狗/小兔子） */
  const adoptPet2 = useCallback(
    (kind: 'dog' | 'rabbit') => {
      setPet2({ kind, name: kind === 'dog' ? '旺财' : '雪球', since: Date.now() });
      setAdoptOpen(false);
      setPetPanel(false);
      sfx.pop();
      toast(kind === 'dog' ? '小狗摇着尾巴进家门啦，快去摸摸它～' : '小兔子一蹦一蹦地住进来啦，软软的～');
      saveSoon();
    },
    [toast, saveSoon],
  );
  /** v8.3 衣柜改宠物毛色/装扮（宠物栏） */
  const changePetLook = useCallback(
    (patch: { coat?: PetCoat; wear?: PetWear }) => {
      setPet((p) => ({ ...p, coat: patch.coat ?? p.coat, wear: patch.wear ?? p.wear }));
      saveSoon();
    },
    [saveSoon],
  );

  // ================================================================
  // v8.0 陪伴交互系统（拾光小屋 × AI 角色）：
  // 入口联系人选择 → 对话（头顶气泡 + TTS + 麦克风）→ 物理指令（A* 寻路）→
  // 拥抱/牵手 → 主动请求 → 自主行动 → 全事件记忆入库（见 companion-memory/brain）
  // ================================================================

  /** 选定的陪伴角色（联系人；null = 尚未选择 → 弹选择列表） */
  const [companion, setCompanion] = useState<ContactRecord | null>(null);
  /** 联系人列表（选择弹窗数据） */
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 机主真实名字（人设/记忆视角统一用） */
  const ownerNameRef = useRef('');
  /** 陪伴指令通道（UI → HomeScene 状态机；seq 递增触发） */
  const companionCmdRef = useRef<CompanionCmd | null>(null);
  const companionSeq = useRef(0);
  /** 多步动作队列（AI 输出 goto+sit 等序列：上一个 arrive 后接续下发） */
  const companionQueueRef = useRef<Omit<CompanionCmd, 'seq'>[]>([]);
  /** 陪伴小人当前状态（context/交互守卫用） */
  const companionStateRef = useRef<
    'idle' | 'walking' | 'near' | 'sitting' | 'lying' | 'watching' | 'hug' | 'hold' | 'playing' | 'cooking' | 'singing' | 'eating' | 'sleeping'
  >('idle');
  /** v8.1 陪伴小人正在弹奏的乐器（Furn3D 音符联动；null = 没在弹） */
  const [partnerPlaying, setPartnerPlaying] = useState<string | null>(null);
  /** 牵手进入的最近房间（空间记忆去重） */
  const holdRoomRef = useRef<RoomId | null>(null);
  /** 3D 头顶气泡队列（HomeScene.HeadBubbles 消费） */
  const bubbleRef = useRef<BubbleCmd[]>([]);
  /** 聊天输入框开合 / 文本 / 发送中 */
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  /** 麦克风（Web Speech 实时识别：开 = 说话中，再点 = 停止并自动发送） */
  const [micOn, setMicOn] = useState(false);
  const micSessionRef = useRef<WebSpeechSession | null>(null);
  /** 小人声音开关（⋮ 菜单；持久化 localStorage；关 = 只显示气泡不说话） */
  const [voiceOn, setVoiceOn] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('cabin-voice-on') === '1';
    } catch {
      return false;
    }
  });
  const voiceOnRef = useRef(voiceOn);
  useEffect(() => {
    voiceOnRef.current = voiceOn;
  }, [voiceOn]);
  /** 待发送照片（识图描述注入本轮情境） */
  const pendingPhotoRef = useRef<string | null>(null);
  const [photoChip, setPhotoChip] = useState(false);
  const chatPhotoInputRef = useRef<HTMLInputElement>(null);
  /** 会话上下文（LLM 消息）与记忆提取轮次 */
  const convoRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const convoTurnsRef = useRef<MemConvoTurn[]>([]);
  /** 点陪伴小人弹出的环形菜单（拥抱/牵手/松开） */
  const [partnerMenuOpen, setPartnerMenuOpen] = useState(false);
  /** 牵手中（UI 态：菜单变「松开」） */
  const [holdingUI, setHoldingUI] = useState(false);
  /** AI 主动请求弹窗（想要拥抱/牵手） */
  const [request, setRequest] = useState<{ kind: 'hug' | 'holdhand'; at: number } | null>(null);
  /** 上次主动请求处置时刻（冷却） */
  const requestCooldownRef = useRef(0);
  /** 自主行动调度（上次触发时刻） */
  const autoNextAtRef = useRef(Date.now() + 50_000);
  /** v8.2 优化D「一起做动作」：AI 回复带 watch/eat/play 且用户说了「一起/陪」→ 到位后招呼用户同步入座 */
  const togetherRef = useRef<'watch' | 'eat' | 'play' | null>(null);
  /** v8.2 优化C：陪伴小人夜里睡着（UI 态，驱动梦境气泡） */
  const [sleepingUi, setSleepingUi] = useState(false);
  /** beginAction 桥（定义在后文，事件回调先定义 → 用 ref 转发） */
  const beginActionRef = useRef<(type: CharAction['type'], item: FurnitureItem) => void>(() => {});

  /** 下发陪伴指令（seq 递增；状态机在 HomeScene.GameLoop 消费） */
  const issueCompanionCmd = useCallback((cmd: Omit<CompanionCmd, 'seq'>) => {
    companionSeq.current += 1;
    companionCmdRef.current = { ...cmd, seq: companionSeq.current };
    if (cmd.kind !== 'free') companionStateRef.current = 'walking';
    else companionStateRef.current = 'idle';
    setSleepingUi(false); // 任何新指令都会把睡着的小人叫醒
  }, []);

  /** 陪伴事件（状态机 → 宿主）：状态镜像 + 多步队列接续 + 全事件记忆入库 */
  const onCompanionEvent = useCallback(
    (e: CompanionEvent) => {
      if (e.ev === 'arrive') {
        if (e.kind === 'sit') companionStateRef.current = 'sitting';
        else if (e.kind === 'lie') {
          companionStateRef.current = e.memo === 'auto-night' ? 'sleeping' : 'lying';
          if (e.memo === 'auto-night') setSleepingUi(true);
        }
        else if (e.kind === 'watch') companionStateRef.current = 'watching';
        else if (e.kind === 'play') {
          companionStateRef.current = 'playing';
          setPartnerPlaying(e.itemId ?? null);
        } else if (e.kind === 'cook') companionStateRef.current = 'cooking';
        else if (e.kind === 'eat') companionStateRef.current = 'eating';
        else if (e.kind === 'lamp') {
          // 指令「打开灯」：小人走到灯旁 → 宿主点亮最近的落地灯/台灯
          const lamp = itemsRef.current.find((f) => CATALOG[f.kind]?.light && (f.y ?? 0) < 0.5 && !f.st?.on);
          if (lamp) {
            setItems((prev) => prev.map((f) => (f.id === lamp.id ? { ...f, st: { ...f.st, on: true } } : f)));
            toast('灯亮起来啦，暖暖的～');
            saveSoon();
          }
          companionStateRef.current = 'near';
        } else if (e.kind === 'door') {
          // 指令「开门」或走路被关着的门挡住（memo=auto-open 自救开门）→ 宿主把那扇门打开
          const did = e.itemId;
          if (did === 'bed') setDoorOpen(true);
          else if (did === 'kt') setKitchenDoorOpen(true);
          else if (did === 'bath') setBathDoorOpen(true);
          else if (did === 'bal') setBalconyDoorOpen(true);
          if (did) {
            sfx.door();
            if (e.memo === 'auto-open') {
              toast(`${companion?.name ?? 'TA'}把门推开，自己走进去了～`);
            } else {
              toast('门开啦～');
              saveSoon();
            }
          }
          // 自动开门发生在走路途中：不改变状态镜像（还是 walking）
          if (e.memo !== 'auto-open') companionStateRef.current = 'near';
        } else if (e.kind === 'music') {
          // 指令「放歌」：走到音箱/唱片机前 → 打开它（音符飘出），状态镜像为「唱歌」
          companionStateRef.current = 'singing';
          const box = itemsRef.current.find((f) => f.id === e.itemId);
          if (box && !box.st?.on) {
            setItems((prev) => prev.map((f) => (f.id === box.id ? { ...f, st: { ...f.st, on: true } } : f)));
            saveSoon();
          }
          sfx.tap();
        } else companionStateRef.current = 'near';
        // —— 记忆入库：用户指令成功执行（「用户让我去沙发上坐下」） ——
        if (companion && typeof e.memo === 'string' && e.memo.startsWith('cmd:')) {
          cabinEventMemory(companion.id, `${ownerNameRef.current || '主人'}让${companion.name}${e.memo.slice(4)}，TA 照做了。`, 'cabin-cmd', { dedupeSeconds: 120 });
        }
        // —— 自主行为记忆（同类一天只记一次，防刷屏） ——
        if (companion && e.memo === 'auto') {
          const room = roomAt(taRT.current.x, taRT.current.z);
          if (e.kind === 'sit') {
            cabinBehaviorMemoryOncePerDay(companion.id, 'sit', `${companion.name}自己在${ROOM_NAMES[room]}的椅子上坐了一会儿，放空休息。`);
          } else if (e.kind === 'watch') {
            cabinBehaviorMemoryOncePerDay(companion.id, 'watch', `${companion.name}打开电视，坐在电视前看了会儿节目。`);
          } else if (e.kind === 'play') {
            cabinBehaviorMemoryOncePerDay(companion.id, 'play', `${companion.name}走到乐器前，认认真真弹了一首曲子，屋里飘着音符。`);
          } else if (e.kind === 'cook') {
            cabinBehaviorMemoryOncePerDay(companion.id, 'cook', `${companion.name}系上围裙在灶台前忙活了一阵，给${ownerNameRef.current || '主人'}做了一顿饭。`);
          } else if (e.kind === 'music') {
            cabinBehaviorMemoryOncePerDay(companion.id, 'music', `${companion.name}打开音箱放了一首歌，跟着旋律轻轻哼了起来。`);
          } else if (e.kind === 'goto' && e.room) {
            cabinBehaviorMemoryOncePerDay(companion.id, `goto:${e.room}`, `${companion.name}自己溜达到了${ROOM_NAMES[e.room]}，看了看窗外的风景。`);
          }
        }
        // AI 多步动作队列：上一个到位 → 接续下发下一个
        const next = companionQueueRef.current.shift();
        if (next) setTimeout(() => issueCompanionCmd(next), 400);
        // —— v8.2 优化D「一起做动作」：AI 回应了「一起看电视/吃饭/弹琴」 → TA 到位后招呼用户同步入座 ——
        if (
          togetherRef.current &&
          (e.kind === togetherRef.current || (togetherRef.current === 'play' && e.kind === 'play')) &&
          (e.kind === 'watch' || e.kind === 'eat' || e.kind === 'play') &&
          e.itemId
        ) {
          const tk = togetherRef.current;
          togetherRef.current = null;
          const item = itemsRef.current.find((f) => f.id === e.itemId);
          if (item) {
            if (tk === 'eat' && !mealReadyRef.current) {
              toast('菜还没上桌，等做好了再一起吃呀～');
            } else if (tk === 'play') {
              // 弹琴：用户用「另一件」乐器（同一张琴凳坐不下）
              const other = itemsRef.current.find(
                (f) => f.id !== item.id && CATALOG[f.kind]?.acts?.play && (f.y ?? 0) < 0.45,
              );
              if (other && poseRef.current.pose === 'stand' && !actRef.current && !carryPetRef.current) {
                setTimeout(() => beginActionRef.current('play', other), 900);
              } else {
                toast(`${companion?.name ?? 'TA'}先为你弹一首，听完再点另一件乐器合奏吧～`);
              }
            } else if (poseRef.current.pose === 'stand' && !actRef.current && !carryPetRef.current) {
              setTimeout(() => {
                const it = itemsRef.current.find((f) => f.id === item.id);
                if (it) beginActionRef.current(tk, it);
              }, 900);
            } else {
              toast(`${companion?.name ?? 'TA'}已经入座啦，点同款家具加入 TA 吧～`);
            }
          }
        }
      } else if (e.ev === 'hugStart') {
        companionStateRef.current = 'hug';
        setHoldingUI(false);
        // —— 物理动作记忆（关键）：拥抱成功 ——
        if (companion && e.memo === 'user-hug') {
          cabinEventMemory(companion.id, `${ownerNameRef.current || '主人'}在拾光小屋里主动拥抱了${companion.name}，TA 感觉很温暖。`, 'cabin-hug-user', { dedupeSeconds: 120 });
        } else if (companion && e.memo === 'ai-hug-yes') {
          cabinEventMemory(companion.id, `${companion.name}主动求抱抱，${ownerNameRef.current || '主人'}答应了，TA 开心极了。`, 'cabin-hug-ai', { dedupeSeconds: 120 });
        }
        sfx.kiss();
      } else if (e.ev === 'holdStart') {
        companionStateRef.current = 'hold';
        setHoldingUI(true);
        holdRoomRef.current = roomAt(taRT.current.x, taRT.current.z);
        // —— 物理动作记忆：牵手成功 ——
        if (companion && e.memo === 'user-hold') {
          cabinEventMemory(companion.id, `${ownerNameRef.current || '主人'}在拾光小屋里牵起了${companion.name}的手，十指相扣。`, 'cabin-hold-user', { dedupeSeconds: 120 });
        } else if (companion && e.memo === 'ai-hold-yes') {
          cabinEventMemory(companion.id, `${companion.name}主动想牵手，${ownerNameRef.current || '主人'}答应了。`, 'cabin-hold-ai', { dedupeSeconds: 120 });
        }
        sfx.tap();
      } else if (e.ev === 'release' || e.ev === 'giveup') {
        // —— v8.1 完成时结算：做饭 → 一桌好菜上桌；放歌 → 关音箱；弹奏 → 清音符 ——
        if (e.ev === 'release' && e.memo === 'finish') {
          if (e.kind === 'cook') {
            setMealReady(true);
            toast(`${companion?.name ?? 'TA'}做好了饭，一桌好菜上桌啦，去餐桌「开饭」吧～`);
            if (companion) {
              cabinEventMemory(companion.id, `${companion.name}在灶台前做了一顿饭，把菜端上了餐桌。`, 'cabin-cook', { dedupeSeconds: 300 });
            }
          } else if (e.kind === 'music') {
            setItems((prev) =>
              prev.map((f) => ((f.kind === 'speaker' || f.kind === 'radio') && f.st?.on ? { ...f, st: { ...f.st, on: false } } : f)),
            );
            saveSoon();
          } else if (e.kind === 'lie' && e.memo === 'finish') {
            if (companion) {
              cabinBehaviorMemoryOncePerDay(companion.id, 'sleep-wake', `${companion.name}睡了一觉醒来，伸了个懒腰。`);
            }
          }
        }
        setPartnerPlaying(null);
        companionStateRef.current = 'idle';
        setHoldingUI(false);
        togetherRef.current = null;
        setSleepingUi(false);
        if (companionQueueRef.current.length > 0) companionQueueRef.current = [];
      } else if (e.ev === 'room') {
        // —— 空间记忆：用户牵着我的手，带我去了×× ——
        holdRoomRef.current = e.room ?? null;
        if (companion && e.room) {
          cabinEventMemory(companion.id, `${ownerNameRef.current || '主人'}牵着${companion.name}的手，把 TA 带到了${ROOM_NAMES[e.room]}。`, `cabin-hold-room:${e.room}`, { dedupeSeconds: 600 });
        }
      }
    },
    [issueCompanionCmd, toast, saveSoon, companion],
  );

  /** 进入小屋：拉联系人 + 恢复上次选定的陪伴角色（没有则弹选择列表） */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [all, myName] = await Promise.all([listContacts(), ownerRealName()]);
        if (!alive) return;
        setContacts(all);
        ownerNameRef.current = myName || useSettings.getState().profile.name || '主人';
        let savedId = '';
        try {
          savedId = window.localStorage.getItem('cabin-companion-id') ?? '';
        } catch {
          /* ignore */
        }
        const saved = savedId ? all.find((c) => c.id === savedId) : null;
        if (saved && saved.kind === 'char') {
          setCompanion(saved);
        } else {
          setPickerOpen(true);
        }
      } catch {
        if (alive) setPickerOpen(true);
      } finally {
        if (alive) setContacts((list) => list);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** 选定陪伴角色（记忆作用域按小屋账号落位） */
  const chooseCompanion = useCallback(
    (c: ContactRecord) => {
      setCompanion(c);
      setPickerOpen(false);
      // v8.2 优化A 聊天记录持久化：换人先封存上一任，再载入 TA 的历史会话（退出重进上下文不丢）
      if (companion) saveCabinConvo(companion.id, convoRef.current, convoTurnsRef.current);
      const saved = loadCabinConvo(c.id);
      convoRef.current = saved.convo;
      convoTurnsRef.current = saved.turns;
      try {
        window.localStorage.setItem('cabin-companion-id', c.id);
      } catch {
        /* ignore */
      }
      setMemScopeForApp('cabin');
      toast(
        saved.convo.length > 0
          ? `${c.name}回来了，还记得上次聊到哪儿～ 点击右上角 💬 继续聊`
          : `${c.name}走进了你搭的小家，点击右上角 💬 和 TA 说话吧～`,
      );
    },
    [toast, companion],
  );

  /** 切换角色（⋮ 菜单）：弹回选择列表并挂断当前语音 */
  const openPicker = useCallback(() => {
    stopSpeaking();
    setPickerOpen(true);
    setMoreOpen(false);
  }, []);

  /** 小人声音开关（⋮ 菜单） */
  const toggleVoice = useCallback(() => {
    setVoiceOn((on) => {
      const next = !on;
      voiceOnRef.current = next;
      try {
        window.localStorage.setItem('cabin-voice-on', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      if (!next) stopSpeaking();
      toast(next ? '小人声音已开，TA 会开口说话啦～' : '小人声音已关，只显示文字气泡');
      return next;
    });
  }, [toast]);

  /** 小人正在做的事（情境注入；pose/act/carry 镜像） */
  const myActivityText = useCallback((): string => {
    if (carryPetRef.current) return '怀里抱着小猫';
    const pose = poseRef.current.pose;
    if (actRef.current?.arrived) {
      const t = actRef.current.type;
      const label: Partial<Record<CharAction['type'], string>> = {
        sit: '坐着休息',
        lie: '躺在床上睡觉',
        bath: '在浴缸里泡澡',
        shower: '在淋浴',
        watch: '坐在电视前看电视',
        work: '用电脑上网',
        cook: '在灶台前做饭',
        eat: '在餐桌边吃饭',
        drink: '端着一杯冰饮',
        coffee: '端着一杯热咖啡',
        read: '坐着看书',
        play: actRef.current.pose === 'guitar' ? '抱着吉他弹奏' : '在弹钢琴',
        makeup: '在梳妆台前化妆',
        mirror: '在照镜子',
        game: '在打游戏',
        hotpot: '在吃火锅',
        dress: '在衣柜前换衣服',
      };
      if (label[t]) return label[t] as string;
    }
    if (meRT.current.moving) return '在屋里走来走去';
    if (pose === 'sit') return '坐着';
    return '站着放空';
  }, [meRT, poseRef, actRef]);

  /** 陪伴小人正在做的事（事件镜像 companionStateRef） */
  const charActivityText = useCallback((): string => {
    const s = companionStateRef.current;
    if (s === 'hug') return '正拥抱着你';
    if (s === 'hold') return '牵着你的手';
    if (s === 'sitting') return '坐在椅子上';
    if (s === 'sleeping') return '躺在床上睡得正香（做梦呢）';
    if (s === 'lying') return '躺在床上休息';
    if (s === 'watching') return '坐在电视前看电视';
    if (s === 'playing') return '正在弹奏乐器';
    if (s === 'cooking') return '正在灶台前做饭';
    if (s === 'singing') return '正在放歌听';
    if (s === 'eating') return '坐在餐桌边吃饭';
    if (s === 'walking') return '正在走路';
    if (s === 'near') return '站在你身边';
    return '在家里溜达';
  }, []);

  /** 采集实时情境（每轮对话现场组装 → AI 知道「我现在在干嘛」） */
  const collectContext = useCallback(
    (photoDesc?: string): CabinContext => {
      const meRoom = ROOM_NAMES[roomAt(meRT.current.x, meRT.current.z)];
      const taRoom = ROOM_NAMES[roomAt(taRT.current.x, taRT.current.z)];
      const nearby = itemsRef.current
        .filter((f) => (f.y ?? 0) < 0.9 && Math.hypot(f.x - taRT.current.x, f.z - taRT.current.z) < 1.35)
        .slice(0, 5)
        .map((f) => CATALOG[f.kind]?.name ?? f.kind);
      const now = new Date();
      return {
        userName: ownerNameRef.current || '主人',
        charName: companion?.name ?? 'TA',
        myRoom: meRoom,
        charRoom: taRoom,
        myActivity: myActivityText(),
        charActivity: charActivityText(),
        holdingHands: companionStateRef.current === 'hold',
        hugging: companionStateRef.current === 'hug',
        night: nightRef.current,
        weather: weatherFx === 'rain' ? '下雨' : weatherFx === 'snow' ? '下雪' : '晴',
        timeStr: now.toLocaleString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' }),
        nearby,
        photoDesc,
      };
    },
    [companion, meRT, taRT, myActivityText, charActivityText, weatherFx],
  );

  /** 发送聊天（文字 / 麦克风转写 / 附照片）→ 气泡 + TTS + 动作执行 + 记忆入库 */
  const sendChat = useCallback(async () => {
    const text = chatText.trim();
    if (!text || chatBusy || !companion) return;
    setChatText('');
    setChatBusy(true);
    const photoDesc = pendingPhotoRef.current;
    pendingPhotoRef.current = null;
    setPhotoChip(false);
    // ① 用户消息 → 我的小人头顶气泡（10 秒淡出）
    bubbleRef.current.push({ who: 'me', text, hold: 10 });
    try {
      // ② 记忆召回 + 情境 + 人设 → system
      const memCtx = [text, ...convoRef.current.slice(-4).map((m) => m.content)].join(' ');
      const memoryBlock = cabinMemoryBlock(companion.id, memCtx, {
        user: ownerNameRef.current || null,
        peer: companion.name || null,
      });
      const ctx = collectContext(photoDesc ?? undefined);
      const system = buildCabinSystem(companion, memoryBlock, ctx);
      // ③ 会话上下文（最近 12 条）
      const history = convoRef.current.slice(-12);
      const userContent = photoDesc ? `${text}\n（随消息发来一张照片：${photoDesc}）` : text;
      // ④ 请求 AI
      const reply = await cabinChatTurn([{ role: 'system', content: system }, ...history, { role: 'user', content: userContent }], useSettings.getState().apiConfig);
      const parsed = parseAiReply(reply);
      // v8.2 优化D：用户说了「一起/陪」且回复带 看电视/吃饭/弹琴 → TA 到位后同步招呼
      if (/一起|陪我|陪我一起/.test(text) && parsed.actions.some((a) => ['watch', 'eat', 'play'].includes(a.type))) {
        const first = parsed.actions.find((a) => ['watch', 'eat', 'play'].includes(a.type));
        togetherRef.current = first?.type as 'watch' | 'eat' | 'play';
      }
      // ⑤ 记录会话（LLM 上下文 + 记忆提取轮次）
      convoRef.current.push({ role: 'user', content: userContent }, { role: 'assistant', content: parsed.raw });
      convoRef.current = convoRef.current.slice(-40);
      convoTurnsRef.current.push(
        { role: 'me', text },
        ...(parsed.msgs.length > 0 ? [{ role: 'peer' as const, text: parsed.msgs.join(' / ') }] : [{ role: 'peer' as const, text: parsed.raw.replace(/<<[\s\S]*?>>/g, '').trim() || '（笑了笑）' }]),
      );
      convoTurnsRef.current = convoTurnsRef.current.slice(-40);
      // ⑥ AI 消息逐条：头顶气泡 + （开声音时）TTS 播报
      const msgs = parsed.msgs.length > 0 ? parsed.msgs : ['……'];
      for (const m of msgs) {
        const est = Math.min(14, 2.6 + m.replace(/\s/g, '').length / 3.2);
        bubbleRef.current.push({ who: 'ta', text: m, hold: voiceOnRef.current ? est + 1.2 : est });
        if (voiceOnRef.current) {
          try {
            await speakUserTts({ text: m, contactId: companion.id, volume: 1, speed: 1.02 });
          } catch {
            // TTS 失败静默（文字气泡已展示）
          }
        } else {
          await new Promise((r) => setTimeout(r, Math.min(3600, 900 + m.length * 70)));
        }
      }
      // ⑦ 拦截动作块 → 寻路执行（多步排队）
      if (parsed.actions.length > 0) {
        const acts = parsed.actions.slice(0, 3);
        companionQueueRef.current = acts.slice(1).map((a) => ({ kind: a.type as CompanionCmd['kind'], room: a.room, memo: 'ai-act' }));
        issueCompanionCmd({ kind: acts[0].type as CompanionCmd['kind'], room: acts[0].room, memo: 'ai-act' });
      }
      // ⑧ 对话记忆入库（标准管线：碎片 → 核心 → 长期；scene=拾光小屋）
      cabinAfterChatTurn(companion.id, useSettings.getState().apiConfig, convoTurnsRef.current.slice(-12), {
        user: ownerNameRef.current || null,
        peer: companion.name || null,
      });
      // v8.2 优化A：会话存档落盘（退出重进接着聊）
      saveCabinConvo(companion.id, convoRef.current, convoTurnsRef.current);
    } catch (err) {
      toast(err instanceof Error && err.message ? `TA 没能回话：${err.message}` : 'TA 没能回话，稍后再试试');
    } finally {
      setChatBusy(false);
    }
  }, [chatText, chatBusy, companion, collectContext, issueCompanionCmd, toast]);

  /** 麦克风开关：开 = Web Speech 实时转写进输入框；再点 = 停止并自动发送 */
  const toggleMic = useCallback(() => {
    if (micOn) {
      const s = micSessionRef.current;
      micSessionRef.current = null;
      setMicOn(false);
      if (s) {
        void s.stop().then((t) => {
          const text = t.trim();
          if (text) {
            setChatText(text);
            setTimeout(() => {
              // 复用 sendChat：直接带上转写文本再发一轮（chatText 闭包可能过期，走状态注入）
              setChatText('');
              void (async () => {
                if (!companion || chatBusy) return;
                setChatBusy(true);
                bubbleRef.current.push({ who: 'me', text, hold: 10 });
                try {
                  const memCtx = [text, ...convoRef.current.slice(-4).map((m) => m.content)].join(' ');
                  const memoryBlock = cabinMemoryBlock(companion.id, memCtx, { user: ownerNameRef.current || null, peer: companion.name || null });
                  const ctx = collectContext();
                  const system = buildCabinSystem(companion, memoryBlock, ctx);
                  const history = convoRef.current.slice(-12);
                  const reply = await cabinChatTurn([{ role: 'system', content: system }, ...history, { role: 'user', content: text }], useSettings.getState().apiConfig);
                  const parsed = parseAiReply(reply);
                  convoRef.current.push({ role: 'user', content: text }, { role: 'assistant', content: parsed.raw });
                  convoRef.current = convoRef.current.slice(-40);
                  convoTurnsRef.current.push({ role: 'me', text }, { role: 'peer', text: parsed.msgs.join(' / ') || parsed.raw.slice(0, 120) || '（嗯）' });
                  convoTurnsRef.current = convoTurnsRef.current.slice(-40);
                  const msgs = parsed.msgs.length > 0 ? parsed.msgs : ['……'];
                  for (const m of msgs) {
                    const est = Math.min(14, 2.6 + m.replace(/\s/g, '').length / 3.2);
                    bubbleRef.current.push({ who: 'ta', text: m, hold: voiceOnRef.current ? est + 1.2 : est });
                    if (voiceOnRef.current) {
                      try {
                        await speakUserTts({ text: m, contactId: companion.id, volume: 1, speed: 1.02 });
                      } catch {
                        /* 静默 */
                      }
                    } else {
                      await new Promise((r) => setTimeout(r, Math.min(3600, 900 + m.length * 70)));
                    }
                  }
                  if (parsed.actions.length > 0) {
                    const acts = parsed.actions.slice(0, 3);
                    companionQueueRef.current = acts.slice(1).map((a) => ({ kind: a.type as CompanionCmd['kind'], room: a.room, memo: 'ai-act' }));
                    issueCompanionCmd({ kind: acts[0].type as CompanionCmd['kind'], room: acts[0].room, memo: 'ai-act' });
                  }
                  cabinAfterChatTurn(companion.id, useSettings.getState().apiConfig, convoTurnsRef.current.slice(-12), {
                    user: ownerNameRef.current || null,
                    peer: companion.name || null,
                  });
                  saveCabinConvo(companion.id, convoRef.current, convoTurnsRef.current);
                } catch (err) {
                  toast(err instanceof Error && err.message ? `TA 没能回话：${err.message}` : 'TA 没能回话，稍后再试试');
                } finally {
                  setChatBusy(false);
                }
              })();
            }, 350);
          }
        });
      }
      return;
    }
    if (!isWebSpeechSupported()) {
      toast('当前浏览器不支持语音识别，打字告诉 TA 吧～');
      return;
    }
    const s = startWebSpeechSession({ onPartial: (t) => setChatText(t) });
    if (!s) {
      toast('麦克风启动失败，检查一下权限～');
      return;
    }
    micSessionRef.current = s;
    setMicOn(true);
    setChatText('');
  }, [micOn, companion, chatBusy, collectContext, issueCompanionCmd, toast]);

  /** 聊天输入附照片 → 识图模型转文字（「我现在在干嘛」的摄像头通道） */
  const onChatPhoto = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      const vc = useSettings.getState().visionConfig;
      if (!vc.baseUrl.trim()) {
        toast('先到「设置 › 识图模型」配好，TA 才能看懂照片～');
        return;
      }
      try {
        const dataUrl = await compressPhoto(f, 1, 640, 0.72);
        const res = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: [dataUrl], config: { baseUrl: vc.baseUrl, apiKey: vc.apiKey, model: vc.model } }),
          signal: AbortSignal.timeout(45_000),
        });
        if (!res.ok) throw new Error('识图失败');
        const j = (await res.json()) as { desc?: string };
        if (j.desc) {
          pendingPhotoRef.current = j.desc.trim().slice(0, 300);
          setPhotoChip(true);
          toast('照片看懂啦，发送消息时 TA 就知道了～');
        } else throw new Error('没看出内容');
      } catch {
        toast('照片没看懂，再试一次？');
      }
    },
    [toast],
  );

  // ---------------- v8.0 模块四：点击交互（拥抱 / 牵手 / 松开） ----------------

  /** 点陪伴小人 → 环形菜单（生活模式） */
  const openPartnerMenu = useCallback(() => {
    partnerTapAtRef.current = Date.now(); // 守卫：同一次点击的 up 射线会落到地板/家具上，不能当作「点别处」
    if (modeRef.current !== 'live' || !companion) return;
    setPartnerMenuOpen((v) => !v);
    setPetBarOpen(false);
    setPetPanel(false);
    sfx.tap();
  }, [companion]);

  /** 拥抱：小人走过来 → 双方拥抱（用户正坐着/躺着/抱着猫时先婉拒） */
  const startHug = useCallback(() => {
    setPartnerMenuOpen(false);
    if (!companion) return;
    if (poseRef.current.pose !== 'stand' || actRef.current) {
      toast('先站起来，才能好好抱抱呀～');
      return;
    }
    if (carryPetRef.current) {
      toast('怀里还抱着小家伙呢，先放它下来吧～');
      return;
    }
    issueCompanionCmd({ kind: 'hug', memo: 'user-hug' });
  }, [companion, issueCompanionCmd, toast]);

  /** 牵手：小人走过来牵起手 → 之后 0.5m 跟随移动 */
  const startHoldHand = useCallback(() => {
    setPartnerMenuOpen(false);
    if (!companion) return;
    if (poseRef.current.pose !== 'stand' || actRef.current) {
      toast('先站起来，才好牵手去散步呀～');
      return;
    }
    if (carryPetRef.current) {
      toast('先把小家伙放下来，再牵手吧～');
      return;
    }
    issueCompanionCmd({ kind: 'holdhand', memo: 'user-hold' });
  }, [companion, issueCompanionCmd, toast]);

  /** 松开手：解除跟随（环形菜单 / 牵手按钮） */
  const releaseHold = useCallback(() => {
    setPartnerMenuOpen(false);
    issueCompanionCmd({ kind: 'free', memo: 'release' });
    toast('松开了手，TA 又可以自由溜达啦～');
  }, [issueCompanionCmd, toast]);

  // ---------------- v8.0 模块五：AI 主动请求 + 自主行动 ----------------

  /** 同意 TA 的请求 → 拥抱/牵手动画（记忆在 hugStart/holdStart 事件里写） */
  const acceptRequest = useCallback(() => {
    if (!request || !companion) return;
    const kind = request.kind;
    setRequest(null);
    requestCooldownRef.current = Date.now() + 8 * 60_000;
    if (kind === 'hug') {
      // v9 拥抱不再因「坐着/躺着/在做事」而静默拒绝：TA 会走过来抱（坐着也抱得到）；只有抱着宠物时需要先放下
      if (carryPetRef.current) {
        toast('怀里还抱着小家伙呢，先放它下来再抱抱吧～');
        return;
      }
      issueCompanionCmd({ kind: 'hug', memo: 'ai-hug-yes' });
      return;
    }
    // 牵手需要一起走路：站不起来就温和提示（不记拒绝）
    if (poseRef.current.pose !== 'stand' || actRef.current || carryPetRef.current) {
      toast('先站起来，才好牵手去散步呀～');
      return;
    }
    issueCompanionCmd({ kind: 'holdhand', memo: 'ai-hold-yes' });
  }, [request, companion, issueCompanionCmd, toast]);

  /** 拒绝 TA 的请求 → 记忆「有点失落」 + 头顶小情绪 */
  const rejectRequest = useCallback(() => {
    if (!request || !companion) return;
    setRequest(null);
    requestCooldownRef.current = Date.now() + 8 * 60_000;
    if (request.kind === 'hug') {
      cabinEventMemory(companion.id, `${companion.name}想求个抱抱，但被${ownerNameRef.current || '主人'}拒绝了，有点失落。`, 'cabin-hug-reject', { dedupeSeconds: 600 });
      bubbleRef.current.push({ who: 'ta', text: '呜……那好吧。', hold: 4.5 });
    } else {
      cabinEventMemory(companion.id, `${companion.name}想牵${ownerNameRef.current || '主人'}的手，但被拒绝了，有点小委屈。`, 'cabin-hold-reject', { dedupeSeconds: 600 });
      bubbleRef.current.push({ who: 'ta', text: '哦…那算了。', hold: 4.5 });
    }
  }, [request, companion]);

  /** 主动请求调度：不操作时每 30s 评估一次（45% 机会，8 分钟冷却，45s 自动消失） */
  useEffect(() => {
    const iv = setInterval(() => {
      if (!companion || modeRef.current !== 'live' || pickerOpen) return;
      if (request || partnerMenuOpen || chatBusy) return;
      if (Date.now() < requestCooldownRef.current) return;
      const s = companionStateRef.current;
      // v8.3 修正：只有 TA 真的空闲（站着/刚走到身边）才会撒娇；弹琴/做饭/吃饭/睡觉/走路中不打扰
      if (s !== 'idle' && s !== 'near') return;
      if (petCareRef.current || carryPetRef.current) return;
      if (Math.random() < 0.45) {
        requestCooldownRef.current = Date.now() + 5 * 60_000;
        setRequest({ kind: Math.random() < 0.62 ? 'hug' : 'holdhand', at: Date.now() });
      }
    }, 30_000);
    return () => clearInterval(iv);
  }, [companion, request, partnerMenuOpen, chatBusy, pickerOpen]);

  /** 请求弹窗 45s 自动消失（不表态 → 不记拒绝，TA 自己收回） */
  useEffect(() => {
    if (!request) return;
    const t = setTimeout(() => setRequest(null), 45_000);
    return () => clearTimeout(t);
  }, [request]);

  /** 自主行动调度：空闲时按人设记忆走动/坐下/看电视/弹琴/做饭/放歌，夜里上床睡觉（已有 roam 漫游兜底） */
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      if (now < autoNextAtRef.current) return;
      autoNextAtRef.current = now + 40_000 + Math.random() * 40_000;
      if (!companion || modeRef.current !== 'live' || pickerOpen) return;
      if (request || partnerMenuOpen || chatBusy) return;
      const s = companionStateRef.current;
      if (s !== 'idle' || petCareRef.current || carryPetRef.current) return;
      const r = Math.random();
      if (nightRef.current) {
        // —— v8.1 夜深了：没有别的事就回床上睡觉（dur=0 一直睡到天亮/被叫起） ——
        if (r < 0.55) {
          const bed = itemsRef.current.find((f) => CATALOG[f.kind]?.acts?.sleep && (f.y ?? 0) < 0.45);
          if (bed) {
            issueCompanionCmd({ kind: 'lie', itemId: bed.id, memo: 'auto-night', dur: 0 });
            cabinBehaviorMemoryOncePerDay(companion.id, 'night-sleep', `夜深了，${companion.name}洗漱完上床睡觉，被子盖得严严实实的。`);
          }
        }
        return;
      }
      if (r < 0.24) {
        issueCompanionCmd({ kind: 'sit', memo: 'auto' });
      } else if (r < 0.38) {
        // 打开电视 + 坐到电视前（有电视才演这一出）
        const tv = itemsRef.current.find((f) => f.kind === 'tv');
        if (tv && !tv.st?.on) {
          setItems((prev) => prev.map((f) => (f.kind === 'tv' ? { ...f, st: { ...f.st, on: true } } : f)));
          saveSoon();
        }
        issueCompanionCmd({ kind: 'watch', memo: 'auto' });
      } else if (r < 0.52) {
        // v8.1 家里有乐器 → 兴致来了弹一曲
        const inst = itemsRef.current.find((f) => CATALOG[f.kind]?.acts?.play && (f.y ?? 0) < 0.45);
        if (inst) issueCompanionCmd({ kind: 'play', memo: 'auto' });
      } else if (r < 0.62) {
        // v8.1 还没做好的时候 → 主动做饭（做完菜上桌，记忆里会记一笔）
        if (!mealReadyRef.current && itemsRef.current.some((f) => CATALOG[f.kind]?.acts?.cook)) {
          issueCompanionCmd({ kind: 'cook', memo: 'auto' });
        }
      } else if (r < 0.7) {
        // v8.1 想听歌了 → 去音箱/唱片机前放歌
        if (itemsRef.current.some((f) => ['speaker', 'radio', 'vinyl', 'musicBox'].includes(f.kind))) {
          issueCompanionCmd({ kind: 'music', memo: 'auto' });
        }
      } else if (r < 0.84) {
        const rooms: RoomId[] = ['lr', 'br', 'kt', 'ba', 'bal'];
        issueCompanionCmd({ kind: 'goto', room: rooms[Math.floor(Math.random() * rooms.length)], memo: 'auto' });
      }
      // 其余：交给既有 roam 漫游（跨房间溜达）
    }, 5000);
    return () => clearInterval(iv);
  }, [companion, request, partnerMenuOpen, chatBusy, pickerOpen, issueCompanionCmd, saveSoon]);

  /** v8.1 天亮了：夜里长睡（dur=0）的陪伴小人自己醒来伸懒腰（切白天/昼夜自动都会触发） */
  useEffect(() => {
    if (night) return;
    if (companionStateRef.current !== 'sleeping') return;
    const t = setTimeout(() => {
      if (companionStateRef.current === 'sleeping') issueCompanionCmd({ kind: 'free', memo: 'wake-up' });
    }, 2200);
    return () => clearTimeout(t);
  }, [night, issueCompanionCmd]);

  /** v8.2 优化C 小人睡觉做梦：夜里 TA 睡着后，头顶隔一会儿冒一句梦话（点击 💬 回话，TA 会梦呓着接下去） */
  useEffect(() => {
    if (!sleepingUi || !companion) return;
    const dreams = [
      '唔……梦到我们一起去看海了，浪花凉凉的……',
      '（咂咂嘴）唔嘿嘿……这个梦里的蛋糕好好吃……',
      '（抱着被子蹭了蹭）唔……别走嘛，再陪我玩一会儿……',
      '（咿咿呀呀）梦到捡到一只小猫，它冲我喵喵叫……',
      '（翻了个身）明天……明天要一起去放风筝的……',
      '（嘴角上扬）唔……梦里你牵着我的手，走过好长一条街……',
      '（小声）枕头软软的……像云朵一样……',
    ];
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const dreamOnce = () => {
      if (!alive) return;
      bubbleRef.current.push({ who: 'ta', text: dreams[Math.floor(Math.random() * dreams.length)], hold: 6.5 });
      timer = setTimeout(dreamOnce, 24_000 + Math.random() * 26_000);
    };
    timer = setTimeout(dreamOnce, 9_000 + Math.random() * 8_000);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [sleepingUi, companion]);

  // ---------------- 初始化：拉远端（远端 rev 更新则采纳） ----------------
  useEffect(() => {
    let alive = true;
    (async () => {
      const remote = await fetchRemote();
      if (!alive) return;
      if (remote && remote.rev > pack.rev) {
        adoptHome(remote.home);
        setRev(remote.rev);
        meRT.current.x = remote.home.chars.me.x;
        meRT.current.z = remote.home.chars.me.z;
        taRT.current.x = remote.home.chars.partner.x;
        taRT.current.z = remote.home.chars.partner.z;
        saveCacheNow(remote);
      } else {
        // 无远端或本地更新：播种服务端
        schedulePush();
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 首屏恢复：上次退出时正在进行的家具动作（坐/睡/泡/淋浴/看电视/上网/吃饭等；
  // 自动结束型（做饭/喝东西/换装）不恢复；远端采纳会走 adoptHome 内的同名恢复，这里兜本地缓存路径）
  useEffect(() => {
    const a = pack.home.act;
    if (!a || actRef.current || poseRef.current.pose !== 'stand' || AUTO_ACTS.has(a.type)) return;
    const it = pack.home.furniture.find((f) => f.id === a.itemId);
    const full = it ? anchorOf(a.type, it) : null;
    if (!full) return;
    full.arrived = true;
    actRef.current = full;
    poseRef.current.pose = full.pose ?? POSE_OF_ACT[a.type];
    poseRef.current.y = full.y;
    setCharAction({ type: a.type, itemId: a.itemId, active: true });
    // 上次正在弹琴/弹吉他 → 直接回到弹奏特写模式
    if (a.type === 'play' && it) {
      const kind = it.kind === 'piano' ? 'piano' : 'guitar';
      instRef.current = { kind, itemId: a.itemId };
      setInst({ kind, itemId: a.itemId });
    }
  }, []);

  // 定期推送 + 卸载兜底
  useEffect(() => {
    const t = setInterval(() => {
      if (++pushTick.current % 12 === 0) schedulePush();
    }, 5000);
    const onHide = () => saveCacheNow(snap());
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(t);
      window.removeEventListener('pagehide', onHide);
      saveCacheNow(snap());
    };
  }, []);

  // ---------------- 洗衣机倒计时（无事可做时不 setState，避免每秒重渲染打断手势） ----------------
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      const finishing = itemsRef.current.some(
        (it) => it.st?.washing && it.st.washStart && now - it.st.washStart > WASH_SECONDS * 1000,
      );
      if (!finishing) return; // 没有到点的洗衣机 → 不触发渲染
      setItems((prev) =>
        prev.map((it) => {
          if (it.st?.washing && it.st.washStart && Date.now() - it.st.washStart > WASH_SECONDS * 1000) {
            return { ...it, st: { ...it.st, washing: false, washDone: true } };
          }
          return it;
        }),
      );
      toast('洗衣机：衣物洗好了');
      saveSoon();
    }, 1000);
    return () => clearInterval(t);
  }, [toast, saveSoon]);

  // ---------------- 宠物照顾流程（v6.9） ----------------
  /** 发起照顾：宠物走向小人 → 到位后互动（v7.2：抱抱 = 抱起怀抱随意走动，再点变「放下」；v8.3：扔球/小把戏） */
  const startPetCare = useCallback(
    (kind: PetCareKind) => {
      if (petCare) return; // 正在照顾中
      const nm = petRef.current.name ?? '团子';
      // —— 抱着态：抱抱按钮 = 放下；其他照顾动作先放下（扔球也不行，怀里的猫够不着地上的球） ——
      if (carryPetRef.current) {
        if (kind === 'hug') {
          petCarrySeq.current += 1;
          petCarryCmdRef.current = { on: false, seq: petCarrySeq.current };
          carryPetRef.current = false;
          carryRef.current.pet = false;
          setCarrying(false);
          toast(`${nm}乖乖落地，又要去溜达啦～`);
        } else {
          toast(`先把${nm}放下来，再照顾它吧～`);
        }
        return;
      }
      // —— v8.3 扔球（A）：独立指令通道（不走 care 走位管线；球出手后猫自己去追去叼） ——
      if (kind === 'ball') {
        petBallSeq.current += 1;
        petBallCmdRef.current = { seq: petBallSeq.current };
        toast(`把球扔出去啦，看${nm}冲鸭～`);
        return;
      }
      if (actRef.current) {
        toast('先把手头的事做完，再来照顾它吧');
        return;
      }
      if (kind === 'hug') {
        // 抱起流程：抱指令直接带 carry 标志 —— 宠物走到身边后纵身一跃进怀里（arrive 时正式抱起）
        petSeq.current += 1;
        petCmdRef.current = { kind, seq: petSeq.current, carry: true };
        setPetCare(kind);
        setPetPanel(false);
        toast(`${nm}张开小爪爪要抱抱举高高啦～`);
        return;
      }
      petSeq.current += 1;
      petCmdRef.current = { kind, seq: petSeq.current };
      setPetCare(kind);
      setPetPanel(false);
      const startMsg: Record<PetCareKind, string> = {
        pat: `${nm}屁颠屁颠跑过来了～`,
        feed: `盛好猫粮，等${nm}过来吃啦～`,
        water: `倒好清水，叫${nm}来喝咯～`,
        bath: `烧好洗澡水，给${nm}搓个泡泡浴～`,
        hug: `${nm}张开小爪爪要抱抱举高高啦～`,
        summon: `一声哨响，${nm}飞奔过来咯～`,
        shake: `伸手示意，${nm}跑过来要和你握手啦～`,
        spin: `打个转转的手势，${nm}准备表演啦～`,
        roll: `拍拍地板，${nm}跑来给你打个滚～`,
        ball: '',
      };
      toast(startMsg[kind]);
    },
    [petCare, toast],
  );

  /** 宠物事件：arrive 到位 / done 完成结算 / cancel 中断还原 / dropped 放下完成（v7.2 抱抱专用） */
  const onPetEvent = useCallback(
    (ev: 'arrive' | 'done' | 'cancel' | 'dropped', kind: PetCareKind) => {
      if (ev === 'arrive') {
        if (kind === 'hug') {
          // v7.2 抱起完成（抱抱 = 抱起模式）：站姿环抱（双臂收拢）+ 按钮解锁（抱抱变「放下」）+ 结算
          poseRef.current.pose = 'stand';
          poseRef.current.y = 0;
          carryRef.current.pet = true;
          carryPetRef.current = true;
          setCarrying(true);
          setPetCare(null);
          const bump = (v: number, d: number) => Math.min(100, Math.max(0, v + d));
          setPet((p) => ({ ...p, mo: bump(p.mo, 16), st: bump(p.st, 2), ts: Date.now() }));
          toast(`${petRef.current.name ?? '团子'}抱在怀里啦，想去哪就去哪；再点一下「放下」把它放下来～`);
          saveSoon();
          return;
        }
        poseRef.current.pose = 'petcare';
        poseRef.current.y = 0;
        return;
      }
      if (ev === 'dropped') {
        // 放下完成：复位照顾锁（抱着态的 UI 在 startPetCare 里已提前复位）
        setPetCare(null);
        return;
      }
      if (poseRef.current.pose === 'petcare') poseRef.current.pose = 'stand';
      setPetCare(null);
      setPetBarOpen(false); // v7.1：照顾完成/中断后互动竖条自动收起
      if (ev === 'cancel') {
        // 中断时若还处于抱着态（切装修等）→ 复位抱抱 UI
        carryPetRef.current = false;
        carryRef.current.pet = false;
        setCarrying(false);
      }
      if (ev !== 'done') return;
      // v8.3 成长系统：每次照顾/互动 +1 经验；升级时弹解锁提示（宠物玩具球也是一次开心互动）
      const lvlBefore = petLevelOf(petRef.current);
      setPet((p) => {
        const bump = (v: number, d: number) => Math.min(100, Math.max(0, v + d));
        const grown = { ...p, care: (p.care ?? 0) + 1, ts: Date.now() };
        if (kind === 'pat') return { ...grown, mo: bump(grown.mo, 12) };
        if (kind === 'feed') return { ...grown, st: bump(grown.st, 22), mo: bump(grown.mo, 4) };
        if (kind === 'bath') return { ...grown, cl: bump(grown.cl, 26), mo: bump(grown.mo, 6) };
        if (kind === 'hug') return { ...grown, mo: bump(grown.mo, 16), st: bump(grown.st, 2) };
        if (kind === 'summon') return { ...grown, mo: bump(grown.mo, 4) };
        if (kind === 'ball') return { ...grown, mo: bump(grown.mo, 8) };
        if (kind === 'shake' || kind === 'spin' || kind === 'roll') return { ...grown, mo: bump(grown.mo, 9) };
        return { ...grown, cl: bump(grown.cl, 18), st: bump(grown.st, 4) };
      });
      const lvlAfter = petLevelOf({ ...petRef.current, care: (petRef.current.care ?? 0) + 1 });
      if (lvlAfter > lvlBefore) {
        sfx.whistle();
        const unlocked = PET_TRICK_DEFS.filter((t) => t.lvl === lvlAfter).map((t) => t.label);
        toast(
          unlocked.length > 0
            ? `${petRef.current.name ?? '团子'}升到 Lv.${lvlAfter} 啦！解锁新动作：${unlocked.join('、')}～`
            : `${petRef.current.name ?? '团子'}升到 Lv.${lvlAfter} 啦，越来越有默契了～`,
        );
      }
      const doneMsg: Record<PetCareKind, string> = {
        pat: '摸得它咕噜咕噜，尾巴都要摇飞啦～',
        feed: '吃得肚皮圆滚滚，心满意足～',
        water: '咕咚咕咚喝饱水，精神满满～',
        bath: '洗得香喷喷，毛茸茸亮晶晶～',
        hug: '抱在怀里蹭蹭，它开心得直打呼噜～',
        summon: `一叫就到，真是乖${petRef.current.name ?? '团子'}～`,
        shake: '伸出小爪爪和你握手，太乖啦～',
        spin: '原地转了个圈圈，毛都转晕乎了～',
        roll: '咕噜噜打了个滚，露出软软的肚皮～',
        ball: '追着球跑了一圈又叼回来，玩得可开心啦～',
      };
      toast(doneMsg[kind]);
      saveSoon();
    },
    [toast, saveSoon],
  );

  /** 点宠物（v7.1）：开/关底部互动竖条（不再弹右上角状态面板 —— 面板只由宠物头像唤出） */
  const onPetTap = useCallback(() => {
    petTapAtRef.current = Date.now(); // 守卫：同一次点击的 up 阶段射线会落到地板/家具上，不能当作「点别处」关掉竖条
    setPetBarOpen((v) => !v);
    setPetPanel(false); // 点宠物出竖条，状态面板同时收起（互不叠影）
  }, []);

  /** 确认改名（最长 8 字） */
  const commitPetName = useCallback(() => {
    const name = petNameDraft.trim().slice(0, 8);
    if (name) {
      setPet((p) => ({ ...p, name }));
      toast(`它以后就叫「${name}」啦！`);
      saveSoon();
    }
    setPetRenaming(false);
  }, [petNameDraft, toast, saveSoon]);

  // ---------------- 家具交互（生活模式） ----------------

  /**
   * 结束当前动作：起身走下家具（落到预留的起身落点）；
   * 淋浴自动关花洒、看电视自动关电视、上网自动合电脑、泡澡自动关水（全部穿衣恢复原状）；
   * 吃饱收盘、做饭半途而废不端桌。
   */
  const endAction = useCallback(() => {
    const act = actRef.current;
    actRef.current = null;
    poseRef.current.pose = 'stand';
    poseRef.current.y = 0;
    setCharAction(null);
    if (actTimerRef.current) {
      clearTimeout(actTimerRef.current);
      actTimerRef.current = null;
    }
    if (!act) return;
    // 已摆好姿势才挪到起身落点（走到半路被替换时保持原地，由新动作接着寻路）
    if (act.arrived && act.ox != null && act.oz != null) {
      meRT.current.x = act.ox;
      meRT.current.z = act.oz;
    }
    const off = (id: string, patch: FurnitureItem['st']) =>
      setItems((prev) => prev.map((f) => (f.id === id ? { ...f, st: { ...f.st, ...patch } } : f)));
    if (act.type === 'bath') {
      const it = itemsRef.current.find((f) => f.id === act.itemId);
      if (it?.st?.bathWater) off(act.itemId, { bathWater: false });
      toast('洗得香香的，穿好衣服啦');
    } else if (act.type === 'shower') {
      off(act.itemId, { on: false });
      toast('冲干净啦，穿好衣服出来咯～');
    } else if (act.type === 'watch') {
      off(act.itemId, { on: false });
      toast('电视关掉啦，让眼睛歇一歇～');
    } else if (act.type === 'work') {
      off(act.itemId, { on: false });
      toast('合上电脑，起来走走～');
    } else if (act.type === 'eat') {
      setMealReady(false);
      setMealName(undefined);
      toast('吃饱啦，一桌好菜吃光光～');
    } else if (act.type === 'hotpot') {
      // 吃完火锅：炉火顺手关掉
      off(act.itemId, { on: false });
      toast('火锅吃到撑，满足～');
    } else if (act.type === 'game') {
      // 不玩啦：主机与电视一起关
      off(act.itemId, { on: false });
      setItems((prev) =>
        prev.map((f) => (f.kind === 'tv' && f.st?.on ? { ...f, st: { ...f.st, on: false } } : f)),
      );
      toast('手柄一放，眼睛休息一下～');
    } else if (act.type === 'dress') {
      // 换装结束：衣柜门关上
      off(act.itemId, { open: false });
    } else if (act.type === 'cook') {
      toast('好，先不做了～');
    } else if (act.type === 'play') {
      toast('演奏结束，掌声响起来～');
    } else if (act.type === 'read') {
      toast('合上书，回味一下～');
    } else if (act.type === 'makeup') {
      toast('化好啦，气色满满～');
    } else if (act.type === 'mirror') {
      toast('嗯，今天也是好看的一天～');
    }
    saveSoon();
  }, [meRT, saveSoon, toast]);

  /** 开始动作：小人走向家具落点 → 摆姿势（GameLoop 驱动）；
   *  淋浴/看电视/上网自动开水开机；躺床自动关灯；做饭/喝东西/换装定时自动完成。 */
  const beginAction = useCallback(
    (type: CharAction['type'], item: FurnitureItem) => {
      // 宠物照顾中：不接新动作（避免抱起的小猫悬空去坐沙发的穿帮）
      if (petCareRef.current) {
        toast('正陪着小家伙呢，先照顾完它吧～');
        return;
      }
      // v7.2 怀里还抱着小猫：先放下再干别的（坐下/躺床/泡澡都会穿帮）
      if (carryPetRef.current) {
        toast(`怀里还抱着${petRef.current.name ?? '团子'}呢，先把它放下来吧～`);
        return;
      }
      // B3 阅读：锚点不在书架本身（书架没有 seat），先找最近可坐家具再入座
      if (type === 'read') {
        const seats = itemsRef.current.filter((f) => {
          const e = CATALOG[f.kind];
          return !!e?.acts.seat && (f.y ?? 0) < 0.45;
        });
        if (seats.length === 0) {
          actRef.current = null;
          setCharAction(null);
          toast('先买张沙发或椅子，才能坐着看书呀');
          return;
        }
        const seat = seats.reduce((best, f) => {
          const db = Math.hypot(best.x - meRT.current.x, best.z - meRT.current.z);
          const df = Math.hypot(f.x - meRT.current.x, f.z - meRT.current.z);
          return df < db ? f : best;
        });
        const a = anchorOf('read', seat);
        if (!a) return;
        actRef.current = a;
        setCharAction((prev) => (prev ? { ...prev, active: true } : { type, itemId: seat.id, active: true }));
        toast(`抽了本书，坐到${CATALOG[seat.kind]?.name ?? '沙发'}上慢慢看～`);
        saveSoon();
        return;
      }
      const act = anchorOf(type, item);
      if (!act) return;
      actRef.current = act;
      setCharAction((prev) => (prev ? { ...prev, active: true } : { type, itemId: item.id, active: true }));
      const turnOn = (patch: FurnitureItem['st']) =>
        setItems((prev) => prev.map((f) => (f.id === item.id ? { ...f, st: { ...f.st, ...patch } } : f)));
      /** 自动结束定时（只保留最新一个） */
      const auto = (ms: number, fn: () => void) => {
        if (actTimerRef.current) clearTimeout(actTimerRef.current);
        actTimerRef.current = setTimeout(fn, ms);
      };
      if (type === 'sit') toast('走过去坐下咯～');
      else if (type === 'lie') {
        // C6 睡觉联动灯：全屋主灯自动关闭（小夜灯由场景侧亮起）
        setItems((prev) =>
          prev.map((f) => (CATALOG[f.kind]?.light && f.st?.on ? { ...f, st: { ...f.st, on: false } } : f)),
        );
        toast('关灯睡觉，晚安好梦～');
      } else if (type === 'bath') toast('脱掉衣服，泡澡泡起来～');
      else if (type === 'shower') {
        turnOn({ on: true });
        toast('打开花洒，冲个热水澡～');
      } else if (type === 'watch') {
        turnOn({ on: true });
        toast('打开电视，窝着看一会儿～');
      } else if (type === 'work') {
        turnOn({ on: true });
        toast('打开电脑，上网冲一下浪～');
      } else if (type === 'hotpot') {
        // 开涮火锅：炉火自动开（红汤翻滚），吃到饱手动起身
        turnOn({ on: true });
        toast('炉火开啦，今天的火锅局走起～');
      } else if (type === 'game') {
        // 打游戏：主机自动开机 + 电视自动亮（手柄已握在手里）
        turnOn({ on: true });
        setItems((prev) =>
          prev.map((f) => (f.kind === 'tv' && !f.st?.on ? { ...f, st: { ...f.st, on: true } } : f)),
        );
        toast('主机开机，电视亮啦，开玩～');
      } else if (type === 'cook') {
        // C2 做饭：站位煓勺 5 秒 → 一桌好菜自动上餐桌
        auto(5000, () => {
          setMealReady(true);
          toast('饭菜好啦，上桌开饭吧～');
          if (actRef.current?.type === 'cook') endAction();
        });
        toast('系上围裙，认真做饭中…');
      } else if (type === 'drink') {
        // 拿一杯冰饮：走到冰箱 → 自动开门 → 咕哚咕哚喝一口 → 杯子握在手里，
        // 之后小人完全自由（走动/坐下都可以），随时按「放下杯子」结束
        turnOn({ open: true });
        act.onArrive = () => {
          carryRef.current.cup = true;
          carryRef.current.coffee = false;
          setCarryCup(true);
          auto(900, () => {
            turnOn({ open: false });
            if (actRef.current?.type === 'drink') endAction();
            toast('拿好冰饮，端着慢慢逛～');
          });
        };
        toast('走到冰箱拿杯冰饮…');
      } else if (type === 'coffee') {
        // A3 端一杯咖啡：走到咖啡机 → 唌哚喏煮一杯（蒸汽升腾）→ 热咖啡握在手里端着逛
        turnOn({ on: true });
        act.onArrive = () => {
          carryRef.current.cup = true;
          carryRef.current.coffee = true;
          setCarryCup(true);
          auto(2000, () => {
            turnOn({ on: false });
            if (actRef.current?.type === 'coffee') endAction();
            toast('热咖啡到手，暖暖的～');
          });
        };
        toast('咖啡机喌哚喌哚煮咖啡…');
      } else if (type === 'dress') {
        turnOn({ open: true });
        auto(900, () => {
          if (actRef.current?.type === 'dress') setWardrobeOpen(true);
        });
        toast('衣柜门开啦，挑一身好看的～');
      } else if (type === 'eat') toast('开饭开饭，自己做的最香～');
      else if (type === 'play') {
        // 乐器弹奏：小人走向乐器摆姿势 + 镜头推近 + 可弹奏覆盖层（点弦/点键真实发声）
        const kind = item.kind === 'piano' ? 'piano' : 'guitar';
        instRef.current = { kind, itemId: item.id };
        setInst({ kind, itemId: item.id });
        toast(item.kind === 'piano' ? '坐上琴凳，弹一首小曲～' : '抱起吉他，来一段扫弦～');
      } else if (type === 'makeup') toast('坐下来补个妆，今天也要美美的～');
      else if (type === 'mirror') toast('照照镜子，今天状态不错嘛～');
      saveSoon();
    },
    [toast, saveSoon, endAction],
  );
  // v8.2 beginAction 桥赋值（onCompanionEvent 等先定义的回调经 beginActionRef 转发）
  beginActionRef.current = beginAction;

  /** v8.2 优化D「一起做动作」反向版：用户开始 看电视/开饭 时，空闲的 TA 过来一起（演奏是单人乐器，不凑） */
  useEffect(() => {
    if (!charAction || charAction.active) return;
    const type = charAction.type;
    if (type !== 'watch' && type !== 'eat') return;
    if (type === 'eat' && !mealReady) return;
    if (!companion || petCare || carrying || holdingUI) return;
    if (companionStateRef.current !== 'idle') return;
    const t = setTimeout(() => {
      if (companionStateRef.current !== 'idle') return;
      const it = itemsRef.current.find((f) => f.id === charAction.itemId);
      if (!it) return;
      if (type === 'eat') {
        const table = itemsRef.current.find((f) => f.kind === 'diningTable' && CATALOG[f.kind]?.acts?.eat);
        if (table) issueCompanionCmd({ kind: 'eat', itemId: table.id, memo: 'join' });
      } else {
        issueCompanionCmd({ kind: type, itemId: it.id, memo: 'join' });
      }
      toast(`${companion?.name ?? 'TA'}也凑过来一起啦～`);
    }, 1400);
    return () => clearTimeout(t);
  }, [charAction, companion, petCare, carrying, holdingUI, mealReady, issueCompanionCmd, toast]);

  /** 好菜所在餐桌（做饭完成后第一张餐桌；无餐桌则不上桌） */
  const mealTableId = useMemo(() => {
    if (!mealReady) return null;
    return items.find((f) => f.kind === 'diningTable')?.id ?? null;
  }, [mealReady, items]);

  // —— G8 留言板：打开并记已读（onFurnTap 之前声明） ——
  const openNotes = useCallback(() => {
    notesSeenRef.current = { ...notesSeenRef.current, me: Date.now() };
    setNoteOpen(true);
    sfx.tap();
    saveSoon();
  }, [saveSoon]);

  const onFurnTap = useCallback(
    (item: FurnitureItem) => {
      sfx.tap(); // E3：所有家具点按轻响（函数最前面，提前 return 分支也有声）
      const justPet = Date.now() - petTapAtRef.current < 450; // 刚点过宠物（up 配对落到家具上）
      const justPartner = Date.now() - partnerTapAtRef.current < 450; // v8.0：刚点过陪伴小人
      if (mode === 'live' && !justPet && !justPartner) {
        setPetBarOpen(false); // v7.1：点别处（家具）互动竖条消失
        setPetPanel(false); // v7.2：点别处状态面板也收起
        setPartnerMenuOpen(false); // v8.0：陪伴菜单也收起
      }
      const entry = CATALOG[item.kind];
      if (!entry) return;

      if (mode === 'edit') {
        // 选中（正在逛商店时点家具 → 收起抽屉露出操作栏）
        setShopOpen(false);
        setPaletteOpen(false);
        setSelId((s) => (s === item.id ? null : item.id));
        return;
      }

      // 电视：点击 = 开/关机（打开后小人自由走动，随时坐沙发上看看 —— 不再锁在电视前）
      if (entry.acts?.toggle && entry.acts?.watch) {
        const on = !item.st?.on;
        setItems((prev) => prev.map((f) => (f.id === item.id ? { ...f, st: { ...f.st, on } } : f)));
        toast(on ? '打开电视咯，随便逛，随时坐下看～' : '电视关掉啦，让眼睛歇一歇～');
        saveSoon();
        return;
      }

      // 游戏主机：点击 = 开/关机（开机自动亮电视，小人自由走动 —— v5.8 不再锁在主机前）
      if (item.kind === 'gameConsole') {
        const on = !item.st?.on;
        setItems((prev) =>
          prev.map((f) => {
            if (f.id === item.id) return { ...f, st: { ...f.st, on } };
            if (f.kind === 'tv') return { ...f, st: { ...f.st, on } }; // 电视跟主机同开同关
            return f;
          }),
        );
        toast(on ? '主机开机，电视亮啦，随便逛～' : '主机关掉啦，去干点别的吧～');
        saveSoon();
        return;
      }

      // 黑胶唱片机 / 八音盒：点击 = 弹出点歌面板（搜歌/我的歌单/队列；全屋响起，随播放自动旋转/开盖 —— v6.0）
      if (item.kind === 'vinyl' || item.kind === 'musicBox') {
        setMusicSheet(true);
        return;
      }

      // 弹奏中点别的家具/门窗：先收起乐器界面（动作由下方统一接管）
      if (instRef.current) {
        instRef.current = null;
        setInst(null);
      }

      // —— v5.7 拾光扩展特殊交互（优先于通用动作链） ——
      // 棋盘桌：开一局五子棋（不再走 playful 弹跳）
      if (item.kind === 'chessTable') {
        setChess({ itemId: item.id });
        return;
      }
      // 灶台：开做饭小游戏（选菜谱→切菜/翻炒/装盘→上桌）
      if (item.kind === 'stove' && entry.acts?.cook) {
        setCookingGame(true);
        return;
      }
      // G10 娃娃机：开一局抓娃娃（30 秒冷却）
      if (item.kind === 'clawMachine') {
        if (Date.now() - (item.st?.lastClaw ?? 0) < 30_000) {
          toast('娃娃机补货中，歇一会儿再来抓～');
          return;
        }
        setClawFor(item.id);
        return;
      }
      // G8 软木留言板：打开留言面板（顺便记已读）
      if (item.kind === 'noteBoard') {
        openNotes();
        return;
      }
      // G10 咖啡机：先玩拉花小游戏，拉好了再端走
      if (item.kind === 'coffeeMaker') {
        setLatteOpen(true);
        return;
      }
      // G10 立式相框：换照片 / 拼一拼 二选一
      if (item.kind === 'photoFrame' && entry.acts?.photo) {
        setPhotoMenuFor(item.id);
        return;
      }
      // 音箱：打开「小屋点歌」（用音乐 App 的歌，全屋响起）
      if (item.kind === 'speaker') {
        setMusicSheet(true);
        return;
      }
      // 幕布：点击 = 开关任意一台投影仪（联动幕布）
      if (item.kind === 'screen') {
        const proj = itemsRef.current.find((f) => f.kind === 'projector');
        const turningOn = !proj?.st?.on;
        setItems((prev) =>
          prev.map((f) =>
            f.kind === 'projector' ? { ...f, st: { ...f.st, on: turningOn } } : f,
          ),
        );
        toast(turningOn ? '投影仪开机，幕布放下咯～' : '投影仪关机，幕布收起啦');
        saveSoon();
        return;
      }

      // 生活模式：可互动的家具 → 弹出确认按钮（先结束当前姿势，
      //   小人自动从当前家具上下来，再走向新目标 —— 同一时刻只做一个动作）
      //   eat 仅在饭菜上桌时出现（否则落到 playful 弹跳）
      const acts = entry.acts;
      const actType: CharAction['type'] | null = acts?.bath
        ? acts.bath.stand
          ? 'shower'
          : 'bath'
        : acts?.sleep
          ? 'lie'
          : acts?.eat && mealReady
            ? 'eat'
            : acts?.cook
              ? 'cook'
              : acts?.drink
                ? 'drink'
                : acts?.coffee
                  ? 'coffee'
                  : acts?.read
                    ? 'read'
                    : acts?.dress
                      ? 'dress'
                      : acts?.play
                        ? 'play'
                        : acts?.makeup
                          ? 'makeup'
                          : acts?.mirror
                            ? 'mirror'
                            : acts?.seat
                              ? 'sit'
                              : acts?.watch
                                ? 'watch'
                                : acts?.work
                                  ? 'work'
                                  : acts?.hotpot
                                    ? 'hotpot'
                                    : null;
      if (actType) {
        if (poseRef.current.pose !== 'stand' || actRef.current) endAction();
        setCharAction({ type: actType, itemId: item.id, active: false });
        return;
      }

      // 生活模式：按能力交互
      const st = item.st ?? {};
      const patch = (next: FurnitureItem['st']) => {
        setItems((prev) => prev.map((f) => (f.id === item.id ? { ...f, st: { ...f.st, ...next } } : f)));
        saveSoon();
      };

      if (entry.acts?.washer) {
        if (st.washDone) {
          patch({ washDone: false, open: false });
          toast('衣物收好啦');
        } else if (st.washing) {
          const left = Math.max(1, Math.ceil(WASH_SECONDS - (Date.now() - (st.washStart ?? 0)) / 1000));
          toast(`洗衣机运转中…约 ${left} 秒`);
        } else {
          const now = Date.now();
          patch({ washing: true, washStart: now, open: false });
          toast('开始洗衣，去忙别的吧～');
        }
        return;
      }
      if (entry.acts?.feed) {
        // 鱼缸投喂：撒鱼食，6 秒鱼群聚食（Cozy3D 按 fedAt 判定）
        patch({ fedAt: Date.now() });
        toast('撒鱼食咯，鱼鱼冲鸭！');
        return;
      }
      if (entry.acts?.toggle) {
        patch({ on: !st.on });
        return;
      }
      if (entry.acts?.photo) {
        // 相框：唤起系统相册/相机选照片（生活模式）
        photoTargetRef.current = item.id;
        fileInputRef.current?.click();
        return;
      }
      if (entry.acts?.door) {
        patch({ open: !st.open });
        return;
      }
      if (entry.acts?.playful) {
        const now = Date.now();
        if (now - (st.lastTouch ?? 0) < PLAY_COOLDOWN * 1000) return;
        patch({ lastTouch: now });
        // 体重秤：踩上去称一称（随机可爱数字）
        if (item.kind === 'scale') {
          const w = (47 + Math.random() * 6).toFixed(1);
          toast(`叮——${w}kg，完美的数字～`);
        }
      }
    },
    [mode, saveSoon, toast, endAction, mealReady, openNotes],
  );

  /** 浴缸水龙头：放水 / 关水 */
  const onFaucetTap = useCallback(
    (item: FurnitureItem) => {
      const on = !item.st?.bathWater;
      setItems((prev) => prev.map((f) => (f.id === item.id ? { ...f, st: { ...f.st, bathWater: on } } : f)));
      toast(on ? '哗啦啦～热水放好咯' : '水龙头关上啦');
      saveSoon();
    },
    [saveSoon, toast],
  );

  /** 泡澡时的放水/关水按钮（浴缸 = 当前动作的家具） */
  const toggleBathWater = useCallback(() => {
    const id = charAction?.itemId;
    if (!id) return;
    setItems((prev) =>
      prev.map((f) => (f.id === id ? { ...f, st: { ...f.st, bathWater: !f.st?.bathWater } } : f)),
    );
    const on = !itemsRef.current.find((f) => f.id === id)?.st?.bathWater;
    toast(on ? '哗啦啦～热水放好咯' : '水龙头关上啦');
    saveSoon();
  }, [charAction, saveSoon, toast]);

  /** C1 换台（电视开着随时可按，不再依附「看电视」动作；频道 1→2→3 循环） */
  const cycleChannel = useCallback(() => {
    const tv = itemsRef.current.find((f) => f.kind === 'tv' && f.st?.on);
    if (!tv) return;
    const next = (((tv.st?.channel ?? 1) % 3) + 1) as 1 | 2 | 3;
    setItems((prev) =>
      prev.map((f) => (f.id === tv.id ? { ...f, st: { ...f.st, on: true, channel: next } } : f)),
    );
    toast(next === 1 ? '回到流光频道～' : next === 2 ? '换到啵啵新闻台～' : '换到拾光音乐台～');
    saveSoon();
  }, [saveSoon, toast]);

  /** 结束乐器弹奏（覆盖层「结束演奏」按钮）：收特写镜头 + 起身 */
  const closeInst = useCallback(() => {
    instRef.current = null;
    setInst(null);
    endAction();
  }, [endAction]);

  /** 放下杯子（端着饮料/咖啡逛时）：收杯子 */
  const dropCup = useCallback(() => {
    carryRef.current.cup = false;
    carryRef.current.coffee = false;
    setCarryCup(false);
    toast('放下杯子，满足～');
    saveSoon();
  }, [saveSoon, toast]);

  // ==================== v5.7 拾光扩展功能 ====================

  // —— F6 拍照模式：快门 → 存进情侣相册 ——
  const photoBusy = useRef(false);
  const takePhoto = useCallback(async () => {
    if (photoBusy.current) return;
    const canvas = rootRef.current?.querySelector('canvas');
    if (!canvas) {
      toast('找不到画面，稍后再试');
      return;
    }
    photoBusy.current = true;
    try {
      const raw = canvas.toDataURL('image/jpeg', 0.92);
      // 压缩到最长边 1280（相册同款压缩规格）
      const data = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(img.width * scale));
            cv.height = Math.max(1, Math.round(img.height * scale));
            cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
            resolve(cv.toDataURL('image/jpeg', 0.85));
          } catch (e) {
            reject(e instanceof Error ? e : new Error('compress-fail'));
          }
        };
        img.onerror = () => reject(new Error('img-load-fail'));
        img.src = raw;
      });
      const b64 = data.split(',')[1] ?? '';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const partnerId = readInviteMeta().partnerContactId;
      if (!partnerId) {
        // 没有恋人档案：落到手机「照片」相机胶卷（不丢照）
        await localDB.put('photos', { id: genId(), blob, name: `拾光小屋 ${new Date().toLocaleDateString('zh-CN')}.jpg`, createdAt: Date.now() });
        toast('📸 已存进照片 App');
        return;
      }
      await addAlbum(partnerId, data, {
        origin: 'user',
        name: `拾光小屋 · ${new Date().toLocaleDateString('zh-CN')}`,
      });
      toast('📸 已存进情侣相册');
    } catch {
      toast('拍照失败了，再试一次');
    } finally {
      photoBusy.current = false;
    }
  }, [toast]);

  // —— F5 做饭小游戏：完成 → 一桌好菜上桌 ——
  const onCookingDone = useCallback(
    (dish: string) => {
      setCookingGame(false);
      setMealReady(true);
      setMealName(dish);
      toast(`「${dish}」出锅啦，上桌开饭吧～`);
      saveSoon();
    },
    [saveSoon, toast],
  );

  // —— G8 进门未读便签提醒（首份带便签的档案到达时只弹一次） ——
  useEffect(() => {
    if (notesRemindRef.current || notes.length === 0) return;
    notesRemindRef.current = true;
    const seen = notesSeenRef.current.me ?? 0;
    const unread = notes.filter((n) => n.by === 'partner' && n.ts > seen).length;
    if (unread > 0) toast(`TA给你留了 ${unread} 条便签，点留言板看看～`);
  }, [notes, toast]);

  // —— G10 咖啡拉花：ok/perfect 才开煮（走既有「端一杯」动作链） ——
  const onLatteResult = useCallback(
    (r: 'miss' | 'ok' | 'perfect') => {
      setLatteOpen(false);
      if (r === 'miss') {
        toast('奶泡洒了…擦擦台面，再试一次？');
        return;
      }
      const machine = itemsRef.current.find((f) => f.kind === 'coffeeMaker');
      if (!machine) return;
      if (poseRef.current.pose !== 'stand' || actRef.current) endAction();
      setCharAction({ type: 'coffee', itemId: machine.id, active: false });
      toast(r === 'perfect' ? '完美爱心拉花！咖啡机喌哚喌哚煮咖啡…' : '不错的拉花！咖啡机喌哚喌哚煮咖啡…');
    },
    [toast, endAction],
  );

  // —— G1 装修方案：保存当前整屋快照到槽位（照片不随方案备份） ——
  const saveLayout = useCallback(
    (slot: number) => {
      const s = takeSnap();
      const strip = (f: FurnitureItem): FurnitureItem => {
        const clone = { ...f, st: { ...f.st } };
        delete clone.st.photo;
        return clone;
      };
      const snap: LayoutSnap = {
        name: `方案${['A', 'B', 'C'][slot]}`,
        ts: Date.now(),
        furniture: s.items.map(strip),
        floorCol: s.floorCol,
        wallCol: s.wallCol,
        floorColBed: s.floorColBed,
        wallColBed: s.wallColBed,
        floorColK: s.floorColK,
        wallColK: s.wallColK,
        floorColB: s.floorColB,
        wallColB: s.wallColB,
        floorColBal: s.floorColBal,
        wallColBal: s.wallColBal,
      };
      setLayouts((prev) => {
        const next = prev.slice();
        next[slot] = snap;
        return next;
      });
      sfx.tap();
      toast(`已存入${snap.name}（${snap.furniture.length} 件，不含照片）`);
      saveSoon();
    },
    [takeSnap, toast, saveSoon],
  );

  // —— G1 装修方案：整屋切换（一步入栈，撤销即回旧布置） ——
  const applyLayout = useCallback(
    (slot: number) => {
      const snap = layoutsRef.current[slot];
      if (!snap) return;
      pushHistory('layout');
      setItems(snap.furniture.map((f) => ({ ...f, st: { ...f.st } })));
      setFloorCol(snap.floorCol);
      setWallCol(snap.wallCol);
      setFloorColBed(snap.floorColBed);
      setWallColBed(snap.wallColBed);
      setFloorColK(snap.floorColK);
      setWallColK(snap.wallColK);
      setFloorColB(snap.floorColB);
      setWallColB(snap.wallColB);
      setFloorColBal(snap.floorColBal);
      setWallColBal(snap.wallColBal);
      setSelId(null);
      setMoveOn(false);
      setPaletteOpen(false);
      sfx.place();
      toast(`切换到${snap.name}，整屋 ${snap.furniture.length} 件（撤销可回旧布置）`);
      saveSoon();
    },
    [pushHistory, toast, saveSoon],
  );

  // —— F4 天气联动：雨声白噪音 + 夜晚自动开灯 ——
  const rainAudioRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  useEffect(() => {
    const raining = weatherFx === 'rain';
    if (raining && !rainAudioRef.current) {
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const len = ctx.sampleRate * 2;
          const buf = ctx.createBuffer(1, len, ctx.sampleRate);
          const ch = buf.getChannelData(0);
          for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * 0.55;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 900;
          const gain = ctx.createGain();
          gain.gain.value = 0.045;
          src.connect(filter).connect(gain).connect(ctx.destination);
          src.start();
          rainAudioRef.current = { ctx, gain };
        }
      } catch {
        /* 音频不可用静默忽略 */
      }
    } else if (!raining && rainAudioRef.current) {
      const { ctx, gain } = rainAudioRef.current;
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      setTimeout(() => {
        void ctx.close().catch(() => {});
      }, 800);
      rainAudioRef.current = null;
    }
    return () => {
      if (rainAudioRef.current) {
        void rainAudioRef.current.ctx.close().catch(() => {});
        rainAudioRef.current = null;
      }
    };
  }, [weatherFx]);

  // 卸载时停雨声
  useEffect(
    () => () => {
      if (rainAudioRef.current) {
        void rainAudioRef.current.ctx.close().catch(() => {});
        rainAudioRef.current = null;
      }
    },
    [],
  );

  /** 夜晚自动开灯：真实夜晚（19~6 点）第一次进入小屋 → 客厅/卧室主灯自动亮起 */
  const autoLightsDone = useRef(false);
  useEffect(() => {
    if (autoLightsDone.current || !nightAuto || !night) return;
    autoLightsDone.current = true;
    const hour = new Date().getHours();
    if (hour < 19 && hour >= 6) return; // 只在真实夜间生效
    const hadOn = itemsRef.current.some((f) => CATALOG[f.kind]?.light && f.st?.on);
    if (hadOn) return;
    setItems((prev) =>
      prev.map((f) => {
        const e = CATALOG[f.kind];
        if (!e?.light) return f;
        const room = roomAt(f.x, f.z);
        return room === 'lr' || room === 'br' ? { ...f, st: { ...f.st, on: true } } : f;
      }),
    );
    toast('天黑了，帮你把灯打开啦～');
  }, [night, nightAuto, toast]);

  // ==================== 编辑操作 ====================
  const rotateY = useCallback(
    (dir: 1 | -1) => {
      if (!selId) return;
      pushHistory(`rot-${selId}`);
      setItems((prev) => prev.map((f) => (f.id === selId ? { ...f, ry: normAngle((f.ry ?? 0) + dir * YAW_STEP) } : f)));
      saveSoon();
    },
    [selId, pushHistory, saveSoon],
  );

  const tilt = useCallback(
    (dir: 1 | -1) => {
      if (!selId) return;
      pushHistory(`tilt-${selId}`);
      setItems((prev) =>
        prev.map((f) =>
          f.id === selId
            ? { ...f, rx: Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, (f.rx ?? 0) + dir * TILT_STEP)) }
            : f,
        ),
      );
      saveSoon();
    },
    [selId, pushHistory, saveSoon],
  );

  const removeSel = useCallback(() => {
    if (!selId) return;
    const victim = itemsRef.current.find((f) => f.id === selId);
    pushHistory();
    // F1：用户亲手收起的节日家具当月不再自动补（下月/来年再见面）
    if (victim) seasonalDismissed.current.add(victim.kind);
    setItems((prev) => prev.filter((f) => f.id !== selId));
    sfx.remove(); // E3：收起 swoosh
    setSelId(null);
    setMoveOn(false);
    setPaletteOpen(false);
    saveSoon();
    toast(victim ? `已收起「${CATALOG[victim.kind]?.name ?? victim.kind}」，撤销可找回` : '已收起家具');
  }, [selId, pushHistory, saveSoon, toast]);

  /** 收起选中的窗户（编辑模式·门窗操作条；撤销可装回，商店「窗户」tab 也能再安装） */
  const removeWinSel = useCallback(() => {
    if (!selId?.startsWith('win-')) return;
    const i = Number(selId.slice(4));
    if (!Number.isInteger(i) || i < 0 || i >= WINS.length) return;
    pushHistory(`win-del-${i}`);
    setWinExist((prev) => {
      const next = prev.slice();
      next[i] = false;
      return next;
    });
    sfx.remove();
    setSelId(null);
    setPaletteOpen(false);
    saveSoon();
    toast(`已收起${WIN_NAMES[i] ?? '窗户'}，商店「窗户」可装回来`);
  }, [selId, pushHistory, saveSoon, toast]);

  /** 商店「窗户」tab：把收起的窗装回默认位（一步可撤销） */
  const installWin = useCallback(
    (i: number) => {
      if (i < 0 || i >= WINS.length) return;
      pushHistory(`win-add-${i}`);
      setWinExist((prev) => {
        const next = prev.slice();
        next[i] = true;
        return next;
      });
      // 装回默认位（旧滑行位可能已被别的门窗占用）
      setWinPos((prev) => {
        const next = prev ? prev.slice() : WINS.map((ww) => ww.def);
        next[i] = WINS[i].def;
        return next;
      });
      sfx.place();
      toast(`已安装${WIN_NAMES[i] ?? '窗户'}`);
    },
    [pushHistory, toast],
  );

  /** 应用一份快照（撤销/重做共用）：整体回滚可编辑状态并清选择 */
  const applySnap = useCallback(
    (s: EditSnap) => {
      setItems(s.items);
      setWinExist(s.winExist ? s.winExist.slice() : [0, 1, 2, 3, 4, 5, 6, 7, 8].map(() => true));
      setWinPos(s.winPos);
      setDoorPos(s.doorPos);
      setWinCol(s.winCol);
      setDoorCol(s.doorCol);
      setFloorCol(s.floorCol);
      setWallCol(s.wallCol);
      setFloorColBed(s.floorColBed);
      setWallColBed(s.wallColBed);
      setFloorColK(s.floorColK);
      setWallColK(s.wallColK);
      setFloorColB(s.floorColB);
      setWallColB(s.wallColB);
      setCeilCol(s.ceilCol);
      setCeilColBed(s.ceilColBed);
      setCeilColK(s.ceilColK);
      setCeilColB(s.ceilColB);
      setFloorColBal(s.floorColBal);
      setWallColBal(s.wallColBal);
      setFloorTex(s.floorTex);
      setWallTex(s.wallTex);
      setSelId(null);
      setMoveOn(false);
      setPaletteOpen(false);
      saveSoon();
    },
    [saveSoon],
  );

  /** 撤销上一步装修操作（Ctrl+Z / 撤销按钮）：覆盖放置/收起/移动/旋转/升降/换色/门窗调整 */
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) {
      toast('没有可撤销的操作啦');
      return;
    }
    redoStack.current.push(takeSnap());
    histTagRef.current = { tag: null, at: 0 };
    setHistLen({ u: undoStack.current.length, r: redoStack.current.length });
    applySnap(prev);
  }, [applySnap, takeSnap, toast]);

  /** 重做（取消上一次撤销）：Ctrl+Shift+Z / Ctrl+Y / 重做按钮 */
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) {
      toast('没有可重做的操作啦');
      return;
    }
    undoStack.current.push(takeSnap());
    histTagRef.current = { tag: null, at: 0 };
    setHistLen({ u: undoStack.current.length, r: redoStack.current.length });
    applySnap(next);
  }, [applySnap, takeSnap, toast]);

  // Ctrl+Z 撤销 / Ctrl+Shift+Z 或 Ctrl+Y 重做（输入框聚焦时不抢）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      if (k === 'z' && !e.shiftKey) undo();
      else redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  /** 四向微调：沿屏幕视觉方向移动选中目标（家具 = 一格；门窗 = 沿墙滑行） */
  const nudgeSel = useCallback(
    (dx: number, dz: number) => {
      if (!selId) return;
      // —— 门窗：沿墙滑行（只取切向分量） ——
      if (selId.startsWith('win-') || selId.startsWith('door-')) {
        const step = 0.25;
        if (selId.startsWith('win-')) {
          const i = Number(selId.slice(4));
          const w = WINS[i];
          if (!w) return;
          if (w.axis === 'z' && dx === 0) return;
          if (w.axis === 'x' && dz === 0) return;
          pushHistory(`move-${selId}`);
          const cur = winPosRef.current?.[i] ?? w.def;
          const along = cur + (w.axis === 'z' ? Math.sign(dx) : Math.sign(dz)) * step;
          const r = resolveWinPos(i, along, winPosRef.current, doorPosRef.current);
          setWinPos((prev) => {
            const next = prev ? prev.slice() : WINS.map((ww) => ww.def);
            next[i] = r.along;
            return next;
          });
        } else {
          const did = selId.slice(5) as 'bed' | 'kt' | 'bath' | 'bal';
          const d = DOORS.find((dd) => dd.id === did);
          if (!d) return;
          if (d.axis === 'z' && dx === 0) return;
          if (d.axis === 'x' && dz === 0) return;
          pushHistory(`move-${selId}`);
          const cur = doorPosRef.current?.[did] ?? d.def;
          const along = cur + (d.axis === 'z' ? Math.sign(dx) : Math.sign(dz)) * step;
          const r = resolveDoorPos(did, along, winPosRef.current, doorPosRef.current);
          setDoorPos((prev) => ({ bed: DOORS[0].def, kt: DOORS[1].def, bath: DOORS[2].def, bal: DOORS[3].def, ...prev, [did]: r.along }));
        }
        saveSoon();
        return;
      }
      // —— 家具：四房间钳位 + 吸附 ——
      pushHistory(`move-${selId}`);
      setItems((prev) =>
        prev.map((f) => {
          if (f.id !== selId) return f;
          const e = CATALOG[f.kind];
          const [w, d] = e ? footprintOf(e, f.ry ?? 0) : [0.5, 0.5];
          const hw = Math.max(w / 2, 0.18);
          const hd = Math.max(d / 2, 0.18);
          const [x, z] = clampFurnToRooms(f.x + dx * SNAP, f.z + dz * SNAP, hw, hd);
          return { ...f, x, z };
        }),
      );
      saveSoon();
    },
    [selId, pushHistory, saveSoon],
  );

  /** 升降选中家具：抬上桌面 / 放回地面（相框、小盆栽、书堆…） */
  const liftSel = useCallback(
    (dir: 1 | -1) => {
      if (!selId) return;
      pushHistory(`lift-${selId}`);
      setItems((prev) =>
        prev.map((f) => {
          if (f.id !== selId) return f;
          const y = Math.round(Math.min(LIFT_MAX, Math.max(0, (f.y ?? 0) + dir * LIFT_STEP)) * 100) / 100;
          return { ...f, y };
        }),
      );
      saveSoon();
    },
    [selId, pushHistory, saveSoon],
  );

  /** HUD 方向按钮 → 微调指令（Canvas 内按当前视角方位换算世界轴） */
  const issueMoveCmd = useCallback((dir: 'up' | 'down' | 'left' | 'right') => {
    moveCmd.current = { v: moveCmd.current.v + 1, dir };
  }, []);

  /** 调色盘：选中目标上色 / 恢复默认（门窗选中时改全屋门窗色） */
  const applyColor = useCallback(
    (hex: string | null) => {
      if (!selId) return;
      pushHistory();
      if (selId.startsWith('win-')) {
        setWinCol(hex ?? undefined);
        saveSoon();
        return;
      }
      if (selId.startsWith('door-')) {
        setDoorCol(hex ?? undefined);
        saveSoon();
        return;
      }
      setItems((prev) =>
        prev.map((f) => (f.id === selId ? { ...f, col: hex ?? undefined } : f)),
      );
      saveSoon();
    },
    [selId, pushHistory, saveSoon],
  );

  /** E7 灯光颜色：只改选中灯具的自选光色（null = 恢复目录默认暖光，不动其它状态） */
  const applyLightColor = useCallback(
    (hex: string | null) => {
      if (!selId) return;
      setItems((prev) =>
        prev.map((f) => (f.id === selId ? { ...f, st: { ...f.st, lc: hex ?? undefined } } : f)),
      );
      saveSoon();
    },
    [selId, saveSoon],
  );

  const toggleMove = useCallback(() => {
    setMoveOn((m) => {
      const next = !m;
      if (next) toast('移动模式：按住画面拖动搬运，或点方向按钮微调');
      return next;
    });
  }, [toast]);

  /** 窗户开合（生活/编辑模式均可点） */
  const toggleWin = useCallback(
    (i: number) => {
      setWin((prev) => {
        const next = prev.slice();
        next[i] = !next[i];
        return next;
      });
      saveSoon();
    },
    [saveSoon],
  );

  /** 地板/墙壁自定义色（null = 恢复默认） */
  const applyFloorCol = useCallback(
    (hex: string | null) => {
      pushHistory();
      setFloorCol(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyWallCol = useCallback(
    (hex: string | null) => {
      pushHistory();
      setWallCol(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  /** 卧室地板/墙壁自定义色（客厅卧室分开换色） */
  const applyFloorColBed = useCallback(
    (hex: string | null) => {
      pushHistory();
      setFloorColBed(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyWallColBed = useCallback(
    (hex: string | null) => {
      pushHistory();
      setWallColBed(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  /** 厨房地板/墙壁自定义色（三房间分开换色） */
  const applyFloorColK = useCallback(
    (hex: string | null) => {
      pushHistory();
      setFloorColK(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyWallColK = useCallback(
    (hex: string | null) => {
      pushHistory();
      setWallColK(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  /** 卫生间地板/墙壁自定义色（四房间分开换色） */
  const applyFloorColB = useCallback(
    (hex: string | null) => {
      pushHistory();
      setFloorColB(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyWallColB = useCallback(
    (hex: string | null) => {
      pushHistory();
      setWallColB(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyFloorColBal = useCallback(
    (hex: string | null) => {
      pushHistory();
      setFloorColBal(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyWallColBal = useCallback(
    (hex: string | null) => {
      pushHistory();
      setWallColBal(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  /** 天花板自定义色（四房间分开） */
  const applyCeilCol = useCallback(
    (hex: string | null) => {
      pushHistory();
      setCeilCol(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyCeilColBed = useCallback(
    (hex: string | null) => {
      pushHistory();
      setCeilColBed(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyCeilColK = useCallback(
    (hex: string | null) => {
      pushHistory();
      setCeilColK(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyCeilColB = useCallback(
    (hex: string | null) => {
      pushHistory();
      setCeilColB(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyDoorCol = useCallback(
    (hex: string | null) => {
      pushHistory();
      setDoorCol(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  const applyWinCol = useCallback(
    (hex: string | null) => {
      pushHistory();
      setWinCol(hex ?? undefined);
      saveSoon();
    },
    [pushHistory, saveSoon],
  );

  /** 卧室门开合（点击门本体） */
  const toggleDoor = useCallback(() => {
    sfx.door(); // E3：门轴轻响
    setDoorOpen((o) => {
      const next = !o;
      toast(next ? '门开啦，走进去就是卧室～' : '卧室门已关上');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** 厨房门开合（点击门本体） */
  const toggleKitchenDoor = useCallback(() => {
    sfx.door();
    setKitchenDoorOpen((o) => {
      const next = !o;
      toast(next ? '厨房门开啦，里面香喷喷～' : '厨房门已关上');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** 卫生间门开合（点击门本体） */
  const toggleBathDoor = useCallback(() => {
    sfx.door();
    setBathDoorOpen((o) => {
      const next = !o;
      toast(next ? '浴室门开啦，泡泡浴准备～' : '卫生间门已关上');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  const toggleBalconyDoor = useCallback(() => {
    sfx.door();
    setBalconyDoorOpen((o) => {
      const next = !o;
      toast(next ? '阳台门开啦，出去晒晒太阳～' : '阳台门已关上');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** 编辑模式点选门窗（选中而非开合） */
  const onWallTap = useCallback(
    (id: string) => {
      setShopOpen(false);
      setPaletteOpen(false);
      setSelId((s) => (s === id ? null : id));
    },
    [],
  );

  /** 第一/第三人称切换 */
  const toggleFp = useCallback(() => {
    setFp((v) => {
      const next = !v;
      toast(next ? '第一人称：你就是小人本人啦～' : '第三人称：跟随视角');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** E3 音效开关（生活/编辑模式两处按钮共用；持久化在 sfx 模块内） */
  const toggleSfx = useCallback(() => {
    setSfxOn((on) => {
      const next = !on;
      sfx.setEnabled(next);
      toast(next ? '音效已开' : '音效已关');
      return next;
    });
  }, [toast]);

  /** 相框选照片完成：按框型裁剪 → 压缩 → 写入家具状态（永久保存） */
  const onPickPhoto = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = ''; // 允许重复选同一张
      const id = photoTargetRef.current;
      photoTargetRef.current = null;
      if (!f || !id) return;
      const kind = itemsRef.current.find((it) => it.id === id)?.kind ?? 'photoFrame';
      try {
        const data = await compressPhoto(f, PHOTO_ASPECTS[kind] ?? 0.714);
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, st: { ...it.st, photo: data } } : it)));
        saveSoon();
        toast('照片装进相框啦，永久保存～');
      } catch {
        toast('照片读取失败，换一张试试？');
      }
    },
    [saveSoon, toast],
  );

  /** 编辑模式画面缩放 */
  const zoom = useCallback(
    (dir: 1 | -1) => {
      zoomCmd.current = { v: zoomCmd.current.v + 1, dir };
    },
    [],
  );

  const onDragMove = useCallback((id: string, x: number, z: number) => {
    // 门窗：沿墙滑行（写入 winPos/doorPos）
    if (id.startsWith('win-')) {
      const i = Number(id.slice(4));
      const w = WINS[i];
      if (!w) return;
      pushHistory(`drag-win-${i}`); // 首帧入栈，后续帧合入同一步
      const along = w.axis === 'z' ? x : z;
      setWinPos((prev) => {
        const next = prev ? prev.slice() : WINS.map((ww) => ww.def);
        next[i] = along;
        return next;
      });
      return;
    }
    if (id.startsWith('door-')) {
      const did = id.slice(5) as 'bed' | 'kt' | 'bath';
      const d = DOORS.find((dd) => dd.id === did);
      if (!d) return;
      pushHistory(`drag-door-${did}`);
      const along = d.axis === 'z' ? x : z;
      setDoorPos((prev) => ({ bed: DOORS[0].def, kt: DOORS[1].def, bath: DOORS[2].def, bal: DOORS[3].def, ...prev, [did]: along }));
      return;
    }
    pushHistory(`drag-${id}`); // 拖拽首帧入栈：整段拖拽合为一步
    // E2 拖拽吸附：x/z 先落到 0.25m 网格再写入（门窗分支有自己的沿墙吸附，不在此处理）
    const sx = Math.round(x * 4) / 4;
    const sz = Math.round(z * 4) / 4;
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, x: sx, z: sz } : f)));
  }, [pushHistory]);

  const onDragSelect = useCallback((id: string) => {
    setSelId(id);
  }, []);

  /** 拖拽结束：家具挂墙件自动贴墙；门窗吸附到 0.05m 网格 */
  const onDragEnd = useCallback(
    (id: string) => {
      if (id.startsWith('win-')) {
        const i = Number(id.slice(4));
        const w = WINS[i];
        if (w) {
          const cur = winPosRef.current?.[i] ?? w.def;
          const r = resolveWinPos(i, Math.round(cur * 20) / 20, winPosRef.current, doorPosRef.current);
          setWinPos((prev) => {
            const next = prev ? prev.slice() : WINS.map((ww) => ww.def);
            next[i] = r.along;
            return next;
          });
        }
        saveSoon();
        return;
      }
      if (id.startsWith('door-')) {
        const did = id.slice(5) as 'bed' | 'kt' | 'bath';
        const d = DOORS.find((dd) => dd.id === did);
        if (d) {
          const cur = doorPosRef.current?.[did] ?? d.def;
          const r = resolveDoorPos(did, Math.round(cur * 20) / 20, winPosRef.current, doorPosRef.current);
          setDoorPos((prev) => ({ bed: DOORS[0].def, kt: DOORS[1].def, bath: DOORS[2].def, bal: DOORS[3].def, ...prev, [did]: r.along }));
        }
        saveSoon();
        return;
      }
      const it = itemsRef.current.find((f) => f.id === id);
      if (it && CATALOG[it.kind]?.wallMount) {
        const s = snapToWallSlot(it.x, it.z);
        const nx = s.x + Math.sin(s.slot.ry) * 0.06;
        const nz = s.z + Math.cos(s.slot.ry) * 0.06;
        setItems((prev) => prev.map((f) => (f.id === id ? { ...f, x: nx, z: nz, ry: s.slot.ry } : f)));
      }
      saveSoon();
    },
    [saveSoon],
  );

  const onFloorTap = useCallback(() => {
    if (Date.now() - petTapAtRef.current < 450) return; // 刚点过宠物（up 配对落地），不算「点别处」
    if (Date.now() - partnerTapAtRef.current < 450) return; // v8.0：刚点过陪伴小人（up 配对落地），不算「点别处」
    setSelId(null);
    setMoveOn(false);
    setPaletteOpen(false);
    setPetBarOpen(false); // v7.1：点别处（地面）互动竖条消失
    setPetPanel(false); // v7.2：点别处状态面板也收起
    setPartnerMenuOpen(false); // v8.0：点别处陪伴菜单也收起
  }, []);

  // ---------------- 商店 ----------------
  const shopItems = useMemo(() => {
    const list = Object.values(CATALOG).filter(
      (e) => !e.hidden && (shopTab === 'all' ? true : e.cat === shopTab),
    );
    return list;
  }, [shopTab]);

  /** 缩略图待生成队列（undefined = 还没处理过；空串 = 失败已跳过；稳定引用，避免工作室重复重启）；套装 tab 追加 `set:${id}` 整组合成目标 */
  const thumbQueue = useMemo(() => {
    const kindQ = shopItems
      .filter((e) => thumbMap[e.kind] === undefined && !getCachedThumb(e.kind))
      .map((e) => e.kind);
    const setQ =
      shopTab === 'set'
        ? FURN_SETS.filter((s) => thumbMap[`set:${s.id}`] === undefined && !getCachedThumb(`set:${s.id}`)).map((s) => `set:${s.id}`)
        : [];
    return [...kindQ, ...setQ];
  }, [shopItems, thumbMap, shopTab]);

  /** 找个不太挤的落点（小人当前所在房间内） */
  const findSpot = useCallback((kind: FurnitureKind, room: RoomId): { x: number; z: number } => {
    const e = CATALOG[kind];
    const [w, d] = e.fp;
    const [x0, x1, z0, z1] = ROOM_SPANS[room];
    for (let i = 0; i < 40; i++) {
      const x = x0 + Math.random() * (x1 - x0);
      const z = z0 + Math.random() * (z1 - z0);
      const ok = itemsRef.current.every((it) => {
        const ce = CATALOG[it.kind];
        if (!ce || (it.y ?? 0) > 0.45) return true;
        const [cw, cd] = ce.fp;
        return Math.abs(it.x - x) > (w + cw) / 2 + 0.15 || Math.abs(it.z - z) > (d + cd) / 2 + 0.15;
      });
      if (ok) return { x: Math.round(x * 4) / 4, z: Math.round(z * 4) / 4 };
    }
    return { x: Math.round(((x0 + x1) / 2) * 4) / 4, z: Math.round(((z0 + z1) / 2) * 4) / 4 };
  }, []);

  // —— G10 娃娃机：抓中的毛绒直接摆进房间（一步可撤销；依赖 findSpot，故在其后声明） ——
  const onClawWin = useCallback(
    (plush: 'plushBunny' | 'plushDuck' | 'plushPanda' | 'plushPig' | 'plushCat' | 'bear') => {
      const machineId = clawFor;
      setClawFor(null);
      if (!machineId) return;
      pushHistory('claw');
      const room = roomAt(meRT.current.x, meRT.current.z);
      const spot = findSpot(plush, room);
      const id = `${plush}-${Date.now().toString(36)}-${++buySeq}`;
      const now = Date.now();
      setItems((prev) => [
        ...prev.map((f) => (f.id === machineId ? { ...f, st: { ...f.st, lastClaw: now } } : f)),
        { id, kind: plush, x: spot.x, z: spot.z, st: {} } as FurnitureItem,
      ]);
      sfx.place();
      toast(`抓到啦！${CATALOG[plush]?.name ?? '毛绒'}搬进了${ROOM_NAMES[room]}～`);
      saveSoon();
    },
    [clawFor, pushHistory, findSpot, toast, saveSoon],
  );

  // —— v7.1 宠物小窝：旧存档没有猫窝时自动补一个；已有的窝若被家具/墙夹住（缝隙太窄猫会卡死出不来）则挪到开阔点 ——
  useEffect(() => {
    const beds = itemsRef.current.filter((f) => f.kind === 'petBed' && (f.y ?? 0) < 0.45);
    /** 猫窝需要周围 0.35m 的「起身空间」，贴缝会导致宠物醒来后被钳制卡死 */
    const badSpot = (x: number, z: number, selfId: string | null) =>
      itemsRef.current.some((it) => {
        if (it.id === selfId || (it.y ?? 0) > 0.45) return false;
        const ce = CATALOG[it.kind];
        if (!ce) return false;
        const [w, d] = CATALOG['petBed'].fp;
        const [cw, cd] = footprintOf(ce, it.ry ?? 0);
        return Math.abs(it.x - x) < w / 2 + cw / 2 + 0.35 && Math.abs(it.z - z) < d / 2 + cd / 2 + 0.35;
      });
    /** 在客厅挑一个四周开阔的落点（随机重试，失败退回西北角固定点） */
    const pickSafe = (): { x: number; z: number } => {
      const [x0, x1, z0, z1] = ROOM_SPANS.lr;
      for (let i = 0; i < 60; i++) {
        const x = Math.round((x0 + Math.random() * (x1 - x0)) * 4) / 4;
        const z = Math.round((z0 + Math.random() * (z1 - z0)) * 4) / 4;
        if (!badSpot(x, z, null)) return { x, z };
      }
      return { x: -3.42, z: -1.42 };
    };
    const bed = beds[0];
    if (bed) {
      // 已有窝：夹缝里的窝 → 搬到开阔处（一次性迁移，保存后不再触发）
      if (badSpot(bed.x, bed.z, bed.id)) {
        const spot = pickSafe();
        setItems((prev) => prev.map((f) => (f.id === bed.id ? { ...f, x: spot.x, z: spot.z } : f)));
        saveSoon();
      }
      return;
    }
    // 没有窝：补植一个
    const spot = pickSafe();
    setItems((prev) => [
      ...prev,
      { id: `petBed-auto-${Date.now().toString(36)}-${++buySeq}`, kind: 'petBed', x: spot.x, z: spot.z, ry: 0.5, st: {} } as FurnitureItem,
    ]);
    saveSoon();
    // 仅挂载时检查一次（刻意不依赖外层状态，避免随 items 变化重复触发）
  }, []);

  /** 在指定房间找一段空墙面（避开已挂件/高家具/窗户门洞；返回贴墙坐标与朝向） */
  const findWallSpot = useCallback(
    (room: RoomId, kind: FurnitureKind): { x: number; z: number; ry: number } => {
      const e = CATALOG[kind];
      const w = e.fp[0];
      const high = (e.wallY ?? 1.45) > 0.9; // 高挂件（相框/电视）需要避让窗户/门洞
      const slots = WALL_SLOTS.filter((s) => s.room === room);
      outer: for (const s of slots.length ? slots : WALL_SLOTS) {
        for (let a = s.from + w / 2 + 0.15; a <= s.to - w / 2 - 0.15 + 0.001; a += 0.45) {
          if (high && s.avoid?.some(([a0, a1]) => a > a0 - w / 2 && a < a1 + w / 2)) continue;
          const px = s.axis === 'z' ? a : s.at;
          const pz = s.axis === 'z' ? s.at : a;
          const free = itemsRef.current.every((it) => {
            const ce = CATALOG[it.kind];
            if (!ce) return true;
            const ialong = s.axis === 'z' ? it.x : it.z;
            const idist = s.axis === 'z' ? Math.abs(it.z - s.at) : Math.abs(it.x - s.at);
            // 已挂件/高家具占位：同墙面且沿墙距离不够 → 避让
            const tallBlock = (ce.h ?? 0) > 1.05 && (it.y ?? 0) < 0.45 && idist < 0.9;
            const wallBlock = (it.y ?? 0) > 0.9 && idist < 0.55;
            if (!tallBlock && !wallBlock) return true;
            const [ow] = footprintOf(ce, it.ry ?? 0);
            return Math.abs(ialong - a) > (ow + w) / 2 + 0.25;
          });
          if (free) {
            return { x: px + Math.sin(s.ry) * 0.06, z: pz + Math.cos(s.ry) * 0.06, ry: s.ry };
          }
        }
      }
      const s = slots[0] ?? WALL_SLOTS[0];
      const a = (s.from + s.to) / 2;
      return {
        x: (s.axis === 'z' ? a : s.at) + Math.sin(s.ry) * 0.06,
        z: (s.axis === 'z' ? s.at : a) + Math.cos(s.ry) * 0.06,
        ry: s.ry,
      };
    },
    [],
  );

  /** 小人在哪个房间，新家具就添加到哪个房间（商城可无限重复购买） */
  const buy = useCallback(
    (kind: FurnitureKind) => {
      const e = CATALOG[kind];
      if (!e) return;
      pushHistory();
      const id = `${kind}-${Date.now().toString(36)}-${++buySeq}`;
      const room: RoomId = roomAt(meRT.current.x, meRT.current.z);

      if (kind === 'chandelier') {
        // 吊灯：挂当前房间天花板中央附近
        const spot = findSpot(kind, room);
        setItems((prev) => [...prev, { id, kind, x: spot.x, z: spot.z, y: WALL_H - 0.04, st: {} }]);
        toast(`吊灯挂到${ROOM_NAMES[room]}天花板啦`);
      } else if (e.wallMount || kind === 'tv') {
        // 挂墙件（相框/插座/电视）：挂到当前房间的空墙面
        const spot = findWallSpot(room, kind);
        const y = kind === 'tv' ? 1.19 : (e.wallY ?? 1.45);
        setItems((prev) => [...prev, { id, kind, x: spot.x, z: spot.z, y, ry: spot.ry, st: {} }]);
        toast(`已挂到${ROOM_NAMES[room]}墙上`);
      } else if (kind === 'aircon') {
        // 壁挂空调：挂当前房间东墙（1.85m 高，面朝西）
        const pos =
          room === 'lr'
            ? { x: 4.34, z: -1.6 }
            : room === 'br'
              ? { x: 1.39, z: 5.6 }
              : room === 'kt'
                ? { x: 7.38, z: 4.1 }
                : { x: BATH_X1 - 0.16, z: -0.8 };
        setItems((prev) => [...prev, { id, kind, x: pos.x, z: pos.z, y: 1.85, ry: -Math.PI / 2, st: {} }]);
        toast(`已挂到${ROOM_NAMES[room]}东墙`);
      } else {
        const spot = findSpot(kind, room);
        setItems((prev) => [...prev, { id, kind, x: spot.x, z: spot.z, ry: 0, st: {} }]);
        toast(`已添加「${e.name}」到${ROOM_NAMES[room]}`);
      }
      setSelId(id);
      sfx.place(); // E3：可爱 pop（在 setSelId 前后皆可，这里放成功路径末尾）
      saveSoon();
    },
    [findSpot, findWallSpot, pushHistory, saveSoon, toast],
  );

  /** F3 成套举放：锚点找位后整组落位（一次 pushHistory，整组一步撤销；不 setSelId 以免误导单件拖拽） */
  const placeSet = useCallback(
    (id: string) => {
      const set = FURN_SETS.find((s) => s.id === id);
      if (!set) return;
      pushHistory();
      const anchor = findSpot(set.anchor, roomAt(meRT.current.x, meRT.current.z));
      const newItems: FurnitureItem[] = set.items.map((it) => {
        const e = CATALOG[it.kind];
        const [w, d] = e ? footprintOf(e, it.ry ?? 0) : [0.5, 0.5];
        const hw = Math.max(w / 2, 0.18);
        const hd = Math.max(d / 2, 0.18);
        const [x, z] = clampFurnToRooms(anchor.x + it.dx, anchor.z + it.dz, hw, hd);
        const item: FurnitureItem = {
          id: `${it.kind}-${Date.now().toString(36)}-${++buySeq}`,
          kind: it.kind,
          x,
          z,
          st: {},
        };
        if (it.y != null) item.y = it.y;
        if (it.ry != null) item.ry = it.ry;
        return item;
      });
      setItems((prev) => [...prev, ...newItems]);
      toast(`已摆好「${set.name}」，共 ${newItems.length} 件`);
      sfx.place();
      saveSoon();
    },
    [findSpot, pushHistory, saveSoon, toast],
  );

  // F1 节日限定：当月节日家具自动悄悄出现在客厅（不 pushHistory —— 不算用户操作；
  // 用户收起过的 kind 记入 seasonalDismissed，当月不再补）
  useEffect(() => {
    const month = new Date().getMonth() + 1;
    const kinds = SEASONAL[month];
    if (!kinds || kinds.length === 0) return;
    const additions: FurnitureItem[] = [];
    for (const k of kinds) {
      if (seasonalDismissed.current.has(k)) continue;
      if (items.some((f) => f.kind === k)) continue;
      if (!CATALOG[k]) continue;
      const spot = findSpot(k, 'lr');
      additions.push({ id: `${k}-${Date.now().toString(36)}-${++buySeq}`, kind: k, x: spot.x, z: spot.z, st: {} });
    }
    if (additions.length === 0) return;
    setItems((prev) => [...prev, ...additions]);
    for (const it of additions) {
      toast(`${month} 月啦，${CATALOG[it.kind].name}悄悄出现在客厅～`);
    }
  }, [items, findSpot, toast]);

  const resetHome = useCallback(async () => {
    const fresh = await resetRemote();
    adoptHome(fresh.home);
    setRev(fresh.rev);
    meRT.current.x = fresh.home.chars.me.x;
    meRT.current.z = fresh.home.chars.me.z;
    taRT.current.x = fresh.home.chars.partner.x;
    taRT.current.z = fresh.home.chars.partner.z;
    setSelId(null);
    setMoveOn(false);
    setPaletteOpen(false);
    setRoomStyleOpen(false);
    toast('小家已重置');
  }, [toast, adoptHome]);

  // ---------------- 模式 / 昼夜 / 全屏 ----------------
  const switchMode = useCallback(
    (m: HomeMode) => {
      setMode(m);
      if (m === 'edit') {
        setShopOpen(true);
        // 进装修模式：结束进行中的坐/睡/泡动作（含自动结束型定时器）
        if (actRef.current || poseRef.current.pose !== 'stand') {
          actRef.current = null;
          poseRef.current.pose = 'stand';
          setCharAction(null);
        }
        if (actTimerRef.current) {
          clearTimeout(actTimerRef.current);
          actTimerRef.current = null;
        }
      } else {
        setShopOpen(false);
        setSelId(null);
        setMoveOn(false);
        setPaletteOpen(false);
        setRoomStyleOpen(false);
      }
      saveCacheNow(snap());
      schedulePush();
    },
    [snap, schedulePush],
  );

  const toggleNight = useCallback(() => {
    // 手动切换 → 脱离真实时间自动模式
    setNightAuto(false);
    setNight((n) => !n);
    saveSoon();
  }, [saveSoon]);

  /** 昼夜跟随真实时间（19:00~6:00 算夜晚，每 30s 校对） */
  const enableAutoNight = useCallback(() => {
    setNightAuto(true);
    saveSoon();
    toast('昼夜已跟随真实时间～');
  }, [saveSoon, toast]);

  useEffect(() => {
    if (!nightAuto) return;
    const compute = () => {
      const h = new Date().getHours();
      return h >= 19 || h < 6;
    };
    setNight(compute());
    const t = setInterval(() => setNight(compute()), 30000);
    return () => clearInterval(t);
  }, [nightAuto]);

  // 模式切换时收起右上角 ⋮ 菜单 / 宠物面板
  useEffect(() => {
    setMoreOpen(false);
    setPetPanel(false);
    setPetRenaming(false);
  }, [mode]);

  // 离开生活模式（进装修/商店全屏遮挡等）时收起乐器弹奏界面
  useEffect(() => {
    if (mode !== 'live' && instRef.current) {
      instRef.current = null;
      setInst(null);
    }
  }, [mode]);

  // E3 音效开关初始化：读 localStorage（缺省开）
  useEffect(() => {
    setSfxOn(sfx.isEnabled());
  }, []);

  // E3 脚步声：生活模式小人走动时每 380ms 一步（状态走 ref 读，interval 不重挂）
  useEffect(() => {
    const t = setInterval(() => {
      if (meRT.current.moving === true && modeRef.current === 'live' && sfxOnRef.current) sfx.step();
    }, 380);
    return () => clearInterval(t);
  }, []);

  // ---------------- 渲染 ----------------
  const selItem = selId && !selId.startsWith('win-') && !selId.startsWith('door-') ? items.find((f) => f.id === selId) : null;
  const selEntry = selItem ? CATALOG[selItem.kind] : null;
  const isWallSel = !!selId && (selId.startsWith('win-') || selId.startsWith('door-'));
  const selWallName = selId?.startsWith('win-')
    ? '窗户'
    : DOORS.find((d) => selId === `door-${d.id}`)?.name ?? '';
  /** 调色盘当前值（门窗选中时对应全局门窗色） */
  const paletteVal = selId?.startsWith('win-') ? winCol : selId?.startsWith('door-') ? doorCol : selItem?.col;

  /** 操作按钮通用样式 */
  const toolBtn = 'flex h-9 w-9 items-center justify-center rounded-full transition active:scale-90';

  /** 电视开着（生活模式随时换台，看电视不再锁人） */
  const tvOn = items.some((f) => f.kind === 'tv' && f.st?.on);
  // v8.3 成长系统：等级 + 升级进度（面板徽章 / 把戏按钮解锁门控）
  const petLv = petLevelOf(pet);
  const petGap = petLevelGap(pet);
  /** E7 点亮的灯具数（传给场景侧做环境光加成，灯越多屋里越暖） */
  const litLampCount = useMemo(
    () => items.reduce((n, f) => n + (CATALOG[f.kind]?.light && f.st?.on ? 1 : 0), 0),
    [items],
  );
  // 底部按钮堆叠位置：与动作栏/端杯按钮错开（v7.0 底部互动条常驻 → 各条整体上移 76px）
  const cupBarCls = charAction ? 'bottom-[330px]' : 'bottom-[272px]';

  // —— v6.8 进屋过场：白光过渡（遮住 Canvas 首帧 → 与场景内推镜同步淡出） ——
  const [whiteOn, setWhiteOn] = useState(true);
  const [whiteGone, setWhiteGone] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setWhiteOn(false), 450);
    const t2 = setTimeout(() => setWhiteGone(true), 2200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  const tvBarCls = charAction
    ? carryCup
      ? 'bottom-[388px]'
      : 'bottom-[330px]'
    : carryCup
      ? 'bottom-[330px]'
      : 'bottom-[272px]';

  return (
    <div ref={rootRef} className="absolute inset-0 select-none overflow-hidden bg-[#efece4]">
      {/* 照片选择（相框用；隐藏） */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickPhoto}
      />

      {/* 3D 场景 */}
      <HomeScene
        items={items}
        mode={mode}
        night={night}
        selId={selId}
        moveOn={moveOn}
        meRT={meRT.current}
        taRT={taRT.current}
        joyRef={joyRef}
        zoomCmd={zoomCmd}
        moveCmd={moveCmd}
        onNudge={nudgeSel}
        fp={fp}
        fpRef={fpRef}
        poseRef={poseRef}
        actRef={actRef}
        carryRef={carryRef}
        instRef={instRef}
        onFaucetTap={onFaucetTap}
        wear={wear}
        wear2={wear2}
        activeAct={charAction}
        mealTableId={mealTableId}
        floorTex={floorTex}
        wallTex={wallTex}
        win={win}
        winExist={winExist}
        onToggleWin={toggleWin}
        winPos={winPos}
        doorPos={doorPos}
        floorCol={floorCol}
        wallCol={wallCol}
        doorCol={doorCol}
        winCol={winCol}
        floorColBed={floorColBed}
        wallColBed={wallColBed}
        floorColK={floorColK}
        wallColK={wallColK}
        floorColB={floorColB}
        wallColB={wallColB}
        floorColBal={floorColBal}
        wallColBal={wallColBal}
        ceilCol={ceilCol}
        ceilColBed={ceilColBed}
        ceilColK={ceilColK}
        ceilColB={ceilColB}
        doorOpen={doorOpen}
        kitchenDoorOpen={kitchenDoorOpen}
        bathDoorOpen={bathDoorOpen}
        balconyDoorOpen={balconyDoorOpen}
        onToggleDoor={toggleDoor}
        onToggleKitchenDoor={toggleKitchenDoor}
        onToggleBathDoor={toggleBathDoor}
        onToggleBalconyDoor={toggleBalconyDoor}
        musicPlaying={musicPlaying}
        weatherFx={weatherFx}
        litLamps={litLampCount}
        petCmdRef={petCmdRef}
        petCarryCmdRef={petCarryCmdRef}
        onPetTap={onPetTap}
        onPetEvent={onPetEvent}
        petState={pet}
        onFloorTap={onFloorTap}
        onFurnTap={onFurnTap}
        companionCmdRef={companionCmdRef}
        onCompanionEvent={onCompanionEvent}
        onPartnerTap={openPartnerMenu}
        bubbleRef={bubbleRef}
        partnerPlayingId={partnerPlaying}
        petCoat={pet.coat}
        petWear={pet.wear}
        pet2={pet2}
        petBallCmdRef={petBallCmdRef}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragSelect={onDragSelect}
        onWallTap={onWallTap}
      />

      {/* ===== v8.3 第二只宠物领养弹窗（小狗 / 小兔子 二选一） ===== */}
      <AnimatePresence>
        {adoptOpen && (
          <motion.div
            key="pet2-adopt"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-auto absolute inset-0 z-[70] flex items-center justify-center bg-black/25 p-6"
            role="dialog"
            aria-label="领养新伙伴"
          >
            <motion.div
              initial={{ scale: 0.9, y: 14 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 10 }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              className="w-full max-w-[290px] rounded-3xl border border-white/60 bg-white/90 p-5 text-center shadow-2xl backdrop-blur-xl"
            >
              <p className="text-[15px] font-semibold text-[#3a3a3e]">带一只新伙伴回家？</p>
              <p className="mb-4 mt-1 text-[11.5px] text-[#9a9a96]">它会和小家伙一起追着玩～</p>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => adoptPet2('dog')}
                  className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/70 px-3 py-3.5 ring-1 ring-[#f0e2dc] transition active:scale-95"
                >
                  <Dog className="h-7 w-7 text-[#c99a5b]" />
                  <span className="text-[12.5px] font-semibold text-[#5a554e]">小狗</span>
                  <span className="text-[10px] text-[#b0a8a0]">摇尾巴·爱追球</span>
                </button>
                <button
                  onClick={() => adoptPet2('rabbit')}
                  className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/70 px-3 py-3.5 ring-1 ring-[#f0e2dc] transition active:scale-95"
                >
                  <Rabbit className="h-7 w-7 text-[#e8a3b3]" />
                  <span className="text-[12.5px] font-semibold text-[#5a554e]">小兔子</span>
                  <span className="text-[10px] text-[#b0a8a0]">蹦蹦跳·软软的</span>
                </button>
              </div>
              <button
                onClick={() => setAdoptOpen(false)}
                className="h-10 w-full rounded-full bg-[#f1efe9] text-[13px] font-semibold text-[#8a8a86] transition active:scale-95"
              >
                再想想
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== v8.0 陪伴角色选择（进入小屋弹联系人列表；⋮ 菜单「换个TA」再弹） ===== */}
      <AnimatePresence>
        {pickerOpen && (
          <motion.div
            key="companion-picker"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[80] flex items-center justify-center bg-black/35 p-6"
          >
            <motion.div
              initial={{ scale: 0.92, y: 14 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 8 }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              className="w-full max-w-[320px] rounded-3xl bg-white/95 p-4 shadow-2xl backdrop-blur-xl"
            >
              <div className="mb-1 text-center text-[15.5px] font-semibold text-[#3a3a3e]">谁陪你住进拾光小屋？</div>
              <p className="mb-3 text-center text-[11px] leading-snug text-[#9a9a96]">
                TA 会成为小家里的 3D 小人：陪你聊天散步、听你指挥、求抱抱，
                <br />
                还会用 TA 在设置里绑定的聊天 / 识图 / 语音模型
              </p>
              <div className="scrollbar-none flex max-h-[44vh] flex-col gap-2 overflow-y-auto">
                {contacts.filter((c) => c.kind === 'char').length === 0 && (
                  <p className="py-7 text-center text-[12px] leading-relaxed text-[#a8a8a4]">
                    还没有 AI 角色联系人
                    <br />
                    先去「联系人」App 创建一个吧
                  </p>
                )}
                {contacts
                  .filter((c) => c.kind === 'char')
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() => chooseCompanion(c)}
                      className="flex items-center gap-3 rounded-2xl bg-[#faf8f3] p-2.5 text-left ring-1 ring-[#efece2] transition active:scale-[0.98]"
                    >
                      {c.avatar ? (
                        <img src={c.avatar} alt={c.name} className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-black/5" />
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f6cdd6] to-[#dcd2ec] text-[15px] font-bold text-white">
                          {c.name.slice(0, 1)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-[#3a3a3e]">{c.name}</span>
                        <span className="block truncate text-[10.5px] text-[#a8a8a4]">{c.relation || 'AI 角色'}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[#d8cfc4]" />
                    </button>
                  ))}
              </div>
              {companion && (
                <button
                  onClick={() => setPickerOpen(false)}
                  className="mt-3 w-full rounded-full bg-[#f1efe9] py-2 text-[12.5px] font-medium text-[#8a8a86] transition active:scale-95"
                >
                  取消（继续和{companion.name}在一起）
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== v8.0 聊天附照（识图）隐藏文件选择 ===== */}
      <input ref={chatPhotoInputRef} type="file" accept="image/*" className="hidden" onChange={onChatPhoto} />

      {/* Toast（含拍照模式 —— 拍照时 HUD 隐藏，toast 仍需可见） */}
      <div className="pointer-events-none absolute left-1/2 top-24 z-40 flex -translate-x-1/2 flex-col items-center gap-1.5">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.95 }}
              className="rounded-full bg-[#3a3a3e]/85 px-3.5 py-1.5 text-[12px] text-white shadow-lg backdrop-blur-sm"
            >
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ===== HUD ===== */}
      {!photoMode && (
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
        {/* ⋮ 菜单打开时的空白关闭层（点菜单以外任意处收起） */}
        {moreOpen && (
          <div className="pointer-events-auto absolute inset-0 z-10" onClick={() => setMoreOpen(false)} aria-hidden="true" />
        )}

        {/* v9 信息图标（💬）移到右下角：点击弹出/收起下方聊天输入框（对话进头顶气泡 + TTS） */}
        {mode === 'live' && companion && !pickerOpen && (
          <button
            onClick={() => {
              setChatOpen((v) => !v);
              if (chatOpen && micOn) toggleMic();
            }}
            aria-label="和TA聊天"
            aria-expanded={chatOpen}
            title="和TA聊天"
            className={`pointer-events-auto absolute bottom-[74px] right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full shadow-lg backdrop-blur transition active:scale-95 ${
              chatOpen ? 'bg-[#3a3a3e]/85 text-white' : 'bg-white/80 text-[#5a5a5e]'
            }`}
          >
            <MessageCircle className="h-5 w-5" />
            {chatOpen && (
              <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#e46a6a] text-[9px] font-bold text-white ring-2 ring-white/80">
                <X className="h-2.5 w-2.5" />
              </span>
            )}
          </button>
        )}

        {/* ===== 宠物状态面板（v7.0：右上角头像唤出 · 毛玻璃胶囊风） ===== */}
        <AnimatePresence>
          {petPanel && mode === 'live' && (
            <motion.div
              key="pet-panel"
              initial={{ opacity: 0, y: -14, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ type: 'spring', damping: 26, stiffness: 340 }}
              className="pointer-events-auto absolute right-3 top-[104px] z-40 w-[min(78%,270px)] origin-top-right rounded-[26px] border border-white/60 bg-white/55 p-3.5 shadow-[0_16px_40px_rgba(90,60,50,0.18)] backdrop-blur-2xl"
              role="dialog"
              aria-label={`${pet.name ?? '团子'}状态面板`}
            >
              {/* 头部：头像（v7.1 SVG 猫头）+ 名字（可改） + 关闭 */}
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fdf6ec] shadow-inner ring-1 ring-[#eadbc4]/60">
                  <CatFaceIcon className="h-8 w-8" />
                </div>
                {petRenaming ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <input
                      autoFocus
                      value={petNameDraft}
                      onChange={(e) => setPetNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitPetName();
                        if (e.key === 'Escape') setPetRenaming(false);
                      }}
                      maxLength={8}
                      placeholder="给它起个名字"
                      aria-label="宠物名字"
                      className="h-8 min-w-0 flex-1 rounded-full border border-white/70 bg-white/75 px-3 text-[13px] font-semibold text-[#4a4a4e] outline-none placeholder:text-[#c9c2ba] focus:border-[#f4b3c2]"
                    />
                    <button
                      onClick={commitPetName}
                      aria-label="确认名字"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f4b3c2]/90 text-white shadow-sm transition active:scale-90"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[14.5px] font-bold leading-tight text-[#4a4a4e]">{pet.name ?? '团子'}</span>
                        {/* v8.3 成长徽章：Lv + 陪伴天数 */}
                        <span className="shrink-0 rounded-full bg-[#f7e8c8] px-1.5 py-0.5 text-[9px] font-bold leading-none text-[#a8762a] ring-1 ring-[#ecd9a8]">
                          Lv.{petLv}
                        </span>
                      </div>
                      <div className="text-[10.5px] leading-tight text-[#9a938a]">
                        陪伴第 {petGap.days + 1} 天
                      </div>
                    </div>
                    {/* v8.3 装扮（衣柜宠物栏） */}
                    <button
                      onClick={() => {
                        setWardrobeChar('pet');
                        setWardrobeOpen(true);
                        setPetPanel(false);
                        sfx.tap();
                      }}
                      aria-label="给宠物装扮"
                      title="毛色/围巾/蝴蝶结"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/60 text-[#c99a5b] shadow-sm ring-1 ring-white/70 transition hover:bg-white/85 active:scale-90"
                    >
                      <Paintbrush className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setPetNameDraft(pet.name ?? '团子');
                        setPetRenaming(true);
                      }}
                      aria-label="给宠物改名"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/60 text-[#a8927c] shadow-sm ring-1 ring-white/70 transition hover:bg-white/85 active:scale-90"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setPetPanel(false)}
                      aria-label="关闭面板"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/60 text-[#8a837a] shadow-sm ring-1 ring-white/70 transition hover:bg-white/85 active:scale-90"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>

              {/* 三条状态胶囊：体力（蓝）/ 清洁（绿）/ 心情（橙） */}
              <div className="flex flex-col gap-1.5">
                {(
                  [
                    { icon: Zap, label: '体力', val: pet.st, bar: '#4da3ff' },
                    { icon: Droplet, label: '清洁', val: pet.cl, bar: '#5ec269' },
                    { icon: Heart, label: '心情', val: pet.mo, bar: '#ff9f43' },
                  ] as { icon: LucideIcon; label: string; val: number; bar: string }[]
                ).map(({ icon: Icon, label, val, bar }) => (
                  <div key={label} className="flex items-center gap-2 rounded-full bg-white/60 px-2.5 py-1.5 ring-1 ring-white/70">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${bar}1f` }}>
                      <Icon className="h-3.5 w-3.5" style={{ color: bar }} />
                    </div>
                    <span className="w-7 shrink-0 text-[12px] font-semibold text-[#5a554e]">{label}</span>
                    <span className="w-6 shrink-0 text-right text-[13px] font-bold tabular-nums text-[#4a4a4e]">{val}</span>
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#eceae4]">
                      <motion.div
                        className="h-full rounded-full"
                        initial={false}
                        animate={{ width: `${val}%` }}
                        transition={{ type: 'spring', damping: 30, stiffness: 200 }}
                        style={{ backgroundColor: bar }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* v8.3 成长进度（到下一级还差几次照顾） + 领养第二只宠物 */}
              <div className="mt-2 flex items-center gap-2 rounded-full bg-white/60 px-2.5 py-1.5 ring-1 ring-white/70">
                <span className="shrink-0 text-[10.5px] font-semibold text-[#a8762a]">成长</span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#eceae4]">
                  <motion.div
                    className="h-full rounded-full bg-[#e8b06a]"
                    initial={false}
                    animate={{ width: `${Math.round(petGap.inLvl * 100)}%` }}
                    transition={{ type: 'spring', damping: 30, stiffness: 200 }}
                  />
                </div>
                <span className="shrink-0 text-[9.5px] text-[#b0a8a0]">再照顾 {petGap.need} 次升级</span>
                {!pet2 && (
                  <button
                    onClick={() => setAdoptOpen(true)}
                    aria-label="领养第二只宠物"
                    className="flex h-6 shrink-0 items-center gap-0.5 rounded-full bg-[#f4b3c2]/90 px-2 text-[9.5px] font-bold text-white shadow-sm transition active:scale-90"
                  >
                    <Heart className="h-2.5 w-2.5" />
                    领伙伴
                  </button>
                )}
              </div>

              {/* v7.2 互动按钮（面板下方）：六种照顾动作 + v8.3 扔球/成长把戏，抱抱抱着时变「放下」 */}
              <div className="mt-2.5 h-px bg-white/60" aria-hidden="true" />
              <div
                className="mt-2 grid grid-cols-3 justify-items-center gap-1"
                role="toolbar"
                aria-label={`${pet.name ?? '团子'}互动按钮`}
              >
                <PetActionButton kind="ball" icon={Circle} label="扔球" fg="#4a90c9" carrying={carrying} disabled={!!petCare} onClick={() => startPetCare('ball')} />
                {PET_ACTIONS.map(({ kind, icon: Icon, label, fg }) => (
                  <PetActionButton
                    key={kind}
                    kind={kind}
                    icon={Icon}
                    label={label}
                    fg={fg}
                    carrying={carrying}
                    disabled={!!petCare}
                    onClick={() => startPetCare(kind)}
                  />
                ))}
                {PET_TRICK_DEFS.map(({ kind, icon: Icon, label, lvl }) =>
                  petLv >= lvl ? (
                    <PetActionButton key={kind} kind={kind} icon={Icon} label={label} fg="#8a7ab0" carrying={carrying} disabled={!!petCare} onClick={() => startPetCare(kind)} />
                  ) : (
                    <button
                      key={kind}
                      disabled
                      aria-label={`${label}（Lv.${lvl} 解锁）`}
                      className="flex h-[52px] w-[52px] flex-col items-center justify-center gap-0.5 rounded-full bg-white/35 opacity-60 ring-1 ring-white/60"
                    >
                      <Lock className="h-4 w-4 text-[#b0a8a0]" />
                      <span className="text-[8.5px] leading-none text-[#b0a8a0]">Lv.{lvl}</span>
                    </button>
                  ),
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===== 宠物互动竖条（v7.1：点宠物才出现 · 点别处消失 · 右侧竖排 · 白玻璃圆钮无彩色底） ===== */}
        <AnimatePresence>
          {mode === 'live' && !wardrobeOpen && petBarOpen && (
            <div key="pet-bar-wrap" className="absolute right-3 top-1/2 z-30 -translate-y-1/2">
              <motion.div
                initial={{ opacity: 0, x: 24, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.92 }}
                transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              >
                <div
                  className="pointer-events-auto flex flex-col items-center gap-2"
                  role="toolbar"
                  aria-label={`${pet.name ?? '团子'}互动按钮`}
                >
                  <PetActionButton kind="ball" icon={Circle} label="扔球" fg="#4a90c9" carrying={carrying} disabled={!!petCare} onClick={() => startPetCare('ball')} />
                  {PET_ACTIONS.map(({ kind, icon: Icon, label, fg }) => (
                    <PetActionButton
                      key={kind}
                      kind={kind}
                      icon={Icon}
                      label={label}
                      fg={fg}
                      carrying={carrying}
                      disabled={!!petCare}
                      onClick={() => startPetCare(kind)}
                    />
                  ))}
                  {PET_TRICK_DEFS.filter((t) => petLv >= t.lvl).map(({ kind, icon: Icon, label }) => (
                    <PetActionButton key={kind} kind={kind} icon={Icon} label={label} fg="#8a7ab0" carrying={carrying} disabled={!!petCare} onClick={() => startPetCare(kind)} />
                  ))}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* 顶栏 */}
        <div className="relative z-20 flex items-start justify-between p-3 pt-11">
          {/* 左列：返回 + 拍照（v7.0 相机按钮移到返回键下方） */}
          <div className="pointer-events-auto flex flex-col gap-2">
            <button
              onClick={close}
              aria-label="返回"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#5a5a5e] shadow-sm backdrop-blur transition active:scale-95"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => setPhotoMode(true)}
              aria-label="拍照模式"
              title="拍照模式"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#5a5a5e] shadow-sm backdrop-blur transition active:scale-95"
            >
              <Camera className="h-[18px] w-[18px]" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* 宠物头像（v7.2 移到装修小家左侧 · 内联 SVG 猫头 · 白玻璃圆钮）：点击唤出/收起状态面板；状态偏低时亮提醒小红点 */}
            <button
              onClick={() => {
                setPetPanel((v) => !v);
                setPetBarOpen(false); // 面板与互动竖条互斥，不叠影
              }}
              aria-label={`${pet.name ?? '团子'}状态面板`}
              aria-expanded={petPanel}
              className={`pointer-events-auto relative flex h-10 w-10 items-center justify-center rounded-full bg-white/75 shadow-md ring-2 backdrop-blur transition active:scale-95 ${
                petPanel ? 'ring-[#e46a6a]' : 'ring-[#f4b3c2]'
              }`}
            >
              <CatFaceIcon className="h-7 w-7 drop-shadow-sm" />
              {(pet.st < 30 || pet.cl < 30 || pet.mo < 30) && (
                <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-[#ff7a59] ring-2 ring-white/90" />
              )}
            </button>
            {/* 装修小家 / 完成（右上角入口） */}
            <button
              onClick={() => switchMode(mode === 'live' ? 'edit' : 'live')}
              aria-label={mode === 'live' ? '装修小家' : '完成装修'}
              className={
                mode === 'live'
                  ? 'pointer-events-auto flex h-10 items-center gap-1.5 rounded-full bg-[#f4b3c2] px-3.5 text-[13px] font-semibold text-white shadow-md shadow-[#f4b3c2]/40 transition active:scale-95'
                  : 'pointer-events-auto flex h-10 items-center gap-1.5 rounded-full bg-[#8fce9e] px-3.5 text-[13px] font-semibold text-white shadow-md shadow-[#8fce9e]/40 transition active:scale-95'
              }
            >
              {mode === 'live' ? <Pencil className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {mode === 'live' ? '装修小家' : '完成'}
            </button>
            {/* ⋮ 更多菜单：时间变化 / 声音开关 / 视角 */}
            <div className="pointer-events-auto relative">
              <button
                onClick={() => setMoreOpen((o) => !o)}
                aria-label="更多设置"
                aria-expanded={moreOpen}
                title="更多设置"
                className={
                  moreOpen
                    ? 'flex h-10 w-10 items-center justify-center rounded-full bg-[#3a3a3e]/80 text-white shadow-sm backdrop-blur transition active:scale-95'
                    : 'flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#5a5a5e] shadow-sm backdrop-blur transition active:scale-95'
                }
              >
                <MoreVertical className="h-[18px] w-[18px]" />
              </button>
              <AnimatePresence>
                {moreOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ type: 'spring', damping: 28, stiffness: 400 }}
                    className="absolute right-0 top-12 z-50 w-[218px] origin-top-right overflow-hidden rounded-2xl bg-white/95 p-1.5 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl"
                  >
                    {/* 时间变化：手动切白天 / 夜晚 */}
                    <button
                      onClick={() => {
                        toggleNight();
                        setMoreOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                    >
                      {night ? <Moon className="h-4 w-4 shrink-0 text-[#8a7ab0]" /> : <Sun className="h-4 w-4 shrink-0 text-[#e0a458]" />}
                      <span className="flex-1 text-left">{night ? '切换到白天' : '切换到夜晚'}</span>
                      <span className="text-[11px] text-[#b0aeb4]">{night ? '夜晚' : '白天'}</span>
                    </button>
                    {/* 时间变化：昼夜跟随真实时间（19点~6点为夜晚） */}
                    <button
                      onClick={() => {
                        enableAutoNight();
                        setMoreOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                    >
                      <Clock className="h-4 w-4 shrink-0 text-[#7fa8c9]" />
                      <span className="flex-1 text-left">昼夜跟随现实</span>
                      {nightAuto ? (
                        <span className="rounded-full bg-[#dff0e2] px-2 py-0.5 text-[10px] font-semibold text-[#3f9a58]">已开启</span>
                      ) : (
                        <span className="text-[11px] text-[#b0aeb4]">关</span>
                      )}
                    </button>
                    <div className="mx-2.5 my-1 h-px bg-[#f0eeea]" />
                    {/* 声音开关 */}
                    <button
                      onClick={() => {
                        toggleSfx();
                        setMoreOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                    >
                      {sfxOn ? <Volume2 className="h-4 w-4 shrink-0 text-[#6a8a6a]" /> : <VolumeX className="h-4 w-4 shrink-0 text-[#b09a9a]" />}
                      <span className="flex-1 text-left">音效</span>
                      {sfxOn ? (
                        <span className="rounded-full bg-[#dff0e2] px-2 py-0.5 text-[10px] font-semibold text-[#3f9a58]">已开</span>
                      ) : (
                        <span className="rounded-full bg-[#f0eff1] px-2 py-0.5 text-[10px] font-semibold text-[#8a8a90]">已关</span>
                      )}
                    </button>
                    {/* 视角：第一 / 第三人称 */}
                    <button
                      onClick={() => {
                        toggleFp();
                        setMoreOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                    >
                      {fp ? <Eye className="h-4 w-4 shrink-0 text-[#c99a5b]" /> : <Users className="h-4 w-4 shrink-0 text-[#c99a5b]" />}
                      <span className="flex-1 text-left">视角</span>
                      <span className="text-[11px] text-[#b0aeb4]">{fp ? '第一人称' : '第三人称'}</span>
                    </button>
                    {/* v8.0 小人声音开关：开 = 男生小人开口说话（TTS 播报），关 = 只显示文字气泡 */}
                    <div className="mx-2.5 my-1 h-px bg-[#f0eeea]" />
                    <button
                      onClick={() => {
                        toggleVoice();
                        setMoreOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                    >
                      {voiceOn ? <Volume2 className="h-4 w-4 shrink-0 text-[#6a8a6a]" /> : <VolumeX className="h-4 w-4 shrink-0 text-[#b09a9a]" />}
                      <span className="flex-1 text-left">小人声音</span>
                      {voiceOn ? (
                        <span className="rounded-full bg-[#dff0e2] px-2 py-0.5 text-[10px] font-semibold text-[#3f9a58]">已开</span>
                      ) : (
                        <span className="rounded-full bg-[#f0eff1] px-2 py-0.5 text-[10px] font-semibold text-[#8a8a90]">已关</span>
                      )}
                    </button>
                    {/* v8.0 换个TA：重弹陪伴角色选择列表 */}
                    <button
                      onClick={openPicker}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#3a3a3e] transition active:bg-black/5"
                    >
                      <Heart className="h-4 w-4 shrink-0 text-[#e8a3b3]" />
                      <span className="flex-1 text-left">换个TA陪伴</span>
                      <span className="truncate text-[11px] text-[#b0aeb4]">{companion?.name ?? '未选择'}</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* 家具互动按钮（生活模式）：坐下/睡觉/泡澡 → 站起来/起床/出来；衣柜弹窗打开时隐藏避免压住抽屉 */}
        <AnimatePresence>
          {mode === 'live' && charAction && !wardrobeOpen && !(charAction.type === 'play' && inst) && (
            <motion.div
              key="action-bar"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-[272px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2"
            >
              {charAction.active && charAction.type === 'bath' && (
                <button
                  onClick={toggleBathWater}
                  aria-label="浴缸放水/关水"
                  className="pointer-events-auto flex h-12 items-center gap-2 whitespace-nowrap rounded-full bg-[#a8d4e6] px-5 text-[14px] font-semibold text-white shadow-lg transition active:scale-95"
                >
                  <Droplet className="h-[18px] w-[18px]" />
                  放水
                </button>
              )}
              <motion.button
                key={`${charAction.itemId}-${charAction.active}`}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ type: 'spring', damping: 24, stiffness: 340 }}
                onClick={() => {
                  if (!charAction.active) {
                    const it = itemsRef.current.find((f) => f.id === charAction.itemId);
                    if (it) beginAction(charAction.type, it);
                  } else {
                    endAction();
                  }
                }}
                className={
                  charAction.active
                    ? 'pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-[#3a3a3e]/85 px-6 text-[14px] font-semibold text-white shadow-xl backdrop-blur transition active:scale-95'
                    : 'pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-[#f4b3c2] px-6 text-[14px] font-semibold text-white shadow-lg shadow-[#f4b3c2]/40 transition active:scale-95'
                }
              >
                {charAction.type === 'sit' ? (
                  <Armchair className="h-[18px] w-[18px]" />
                ) : charAction.type === 'lie' ? (
                  <BedDouble className="h-[18px] w-[18px]" />
                ) : charAction.type === 'bath' ? (
                  <Bath className="h-[18px] w-[18px]" />
                ) : charAction.type === 'shower' ? (
                  <ShowerHead className="h-[18px] w-[18px]" />
                ) : charAction.type === 'watch' ? (
                  <Tv className="h-[18px] w-[18px]" />
                ) : charAction.type === 'cook' ? (
                  <UtensilsCrossed className="h-[18px] w-[18px]" />
                ) : charAction.type === 'eat' ? (
                  <Utensils className="h-[18px] w-[18px]" />
                ) : charAction.type === 'drink' ? (
                  <CupSoda className="h-[18px] w-[18px]" />
                ) : charAction.type === 'coffee' ? (
                  <Coffee className="h-[18px] w-[18px]" />
                ) : charAction.type === 'read' ? (
                  <BookOpen className="h-[18px] w-[18px]" />
                ) : charAction.type === 'dress' ? (
                  <Shirt className="h-[18px] w-[18px]" />
                ) : charAction.type === 'play' ? (
                  <Music className="h-[18px] w-[18px]" />
                ) : charAction.type === 'makeup' || charAction.type === 'mirror' ? (
                  <Sparkles className="h-[18px] w-[18px]" />
                ) : charAction.type === 'game' ? (
                  <Gamepad2 className="h-[18px] w-[18px]" />
                ) : charAction.type === 'hotpot' ? (
                  <UtensilsCrossed className="h-[18px] w-[18px]" />
                ) : (
                  <Laptop className="h-[18px] w-[18px]" />
                )}
                {ACT_LABELS[charAction.type][charAction.active ? 1 : 0]}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 电视开着：随时换台（看电视不再是动作，小人自由走动） */}
        <AnimatePresence>
          {mode === 'live' && tvOn && !inst && (
            <motion.div
              key="tv-bar"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className={`absolute left-1/2 z-20 -translate-x-1/2 ${tvBarCls}`}
            >
              <button
                onClick={cycleChannel}
                aria-label="电视换台"
                className="pointer-events-auto flex h-12 items-center gap-2 whitespace-nowrap rounded-full bg-[#f4b3c2] px-5 text-[14px] font-semibold text-white shadow-lg transition active:scale-95"
              >
                <Tv className="h-[18px] w-[18px]" />
                换台
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 端着饮料：随时放下（拿饮料不再锁人，杯子握在手里到处逛） */}
        <AnimatePresence>
          {mode === 'live' && carryCup && (
            <motion.div
              key="cup-bar"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className={`absolute left-1/2 z-20 -translate-x-1/2 ${cupBarCls}`}
            >
              <button
                onClick={dropCup}
                aria-label="放下杯子"
                className="pointer-events-auto flex h-12 items-center gap-2 whitespace-nowrap rounded-full bg-[#a8d4e6] px-5 text-[14px] font-semibold text-white shadow-lg transition active:scale-95"
              >
                <CupSoda className="h-[18px] w-[18px]" />
                放下杯子
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===== v8.0 聊天输入条（信息图标唤出：文字 / 麦克风 / 附照识图；消息进头顶气泡） ===== */}
        <AnimatePresence>
          {mode === 'live' && chatOpen && companion && !pickerOpen && (
            <motion.div
              key="chat-bar"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ type: 'spring', damping: 26, stiffness: 340 }}
              className="pointer-events-auto absolute bottom-[152px] left-1/2 z-30 w-[min(88%,352px)] -translate-x-1/2"
            >
              {photoChip && (
                <div className="mx-auto mb-1.5 w-fit rounded-full bg-white/80 px-3 py-1 text-[10.5px] text-[#b07193] shadow-sm ring-1 ring-white/70 backdrop-blur">
                  已附照片 · 发送时 TA 会看到照片内容
                </div>
              )}
              <div className="flex items-center gap-1.5 rounded-full border border-white/70 bg-white/75 p-1.5 pl-3.5 shadow-[0_10px_28px_rgba(90,70,60,0.22)] backdrop-blur-xl">
                <input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) void sendChat();
                  }}
                  placeholder={micOn ? '在听…请说话' : `跟${companion.name}说点什么…`}
                  disabled={chatBusy}
                  aria-label="和小屋里的TA聊天"
                  className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] text-[#3a3a3e] outline-none placeholder:text-[#b8b2aa] disabled:opacity-50"
                />
                {/* 附照片（识图模型转文字注入情境） */}
                <button
                  onClick={() => chatPhotoInputRef.current?.click()}
                  aria-label="发一张照片"
                  title="发一张照片（识图）"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#8a837a] transition active:scale-90"
                >
                  <ImagePlus className="h-[17px] w-[17px]" />
                </button>
                {/* 麦克风：点击说话，再点停止并自动发送 */}
                <button
                  onClick={toggleMic}
                  aria-label={micOn ? '停止说话' : '开始说话'}
                  aria-pressed={micOn}
                  className={
                    micOn
                      ? 'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e46a6a] text-white shadow transition active:scale-90'
                      : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#8a837a] transition active:scale-90'
                  }
                >
                  {micOn && <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-[#e46a6a]/35" />}
                  <Mic className="h-[17px] w-[17px]" />
                </button>
                {/* 发送 */}
                <button
                  onClick={() => void sendChat()}
                  disabled={!chatText.trim() || chatBusy}
                  aria-label="发送"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f4b3c2] text-white shadow transition active:scale-90 disabled:opacity-40"
                >
                  {chatBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===== v8.0 陪伴小人环形菜单（点小人弹出：拥抱 / 牵手（牵手中=松开）） ===== */}
        <AnimatePresence>
          {mode === 'live' && partnerMenuOpen && companion && (
            <motion.div
              key="partner-menu"
              initial={{ opacity: 0, scale: 0.9, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 6 }}
              transition={{ type: 'spring', damping: 26, stiffness: 340 }}
              className="pointer-events-auto absolute bottom-[224px] left-1/2 z-30 -translate-x-1/2"
              role="menu"
              aria-label={`${companion.name}互动菜单`}
            >
              <div className="flex items-center gap-2 rounded-full border border-white/70 bg-white/85 p-2 shadow-[0_12px_30px_rgba(90,70,60,0.24)] backdrop-blur-xl">
                {holdingUI ? (
                  <button
                    onClick={releaseHold}
                    role="menuitem"
                    className="flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#3a3a3e]/85 px-5 text-[13.5px] font-semibold text-white shadow transition active:scale-95"
                  >
                    <Hand className="h-[17px] w-[17px]" />
                    松开手
                  </button>
                ) : (
                  <>
                    <button
                      onClick={startHug}
                      role="menuitem"
                      className="flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#f4b3c2] px-5 text-[13.5px] font-semibold text-white shadow-md shadow-[#f4b3c2]/40 transition active:scale-95"
                    >
                      <Heart className="h-[17px] w-[17px]" />
                      拥抱
                    </button>
                    <button
                      onClick={startHoldHand}
                      role="menuitem"
                      className="flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#a8d4e6] px-5 text-[13.5px] font-semibold text-white shadow-md shadow-[#a8d4e6]/40 transition active:scale-95"
                    >
                      <Hand className="h-[17px] w-[17px]" />
                      牵手
                    </button>
                  </>
                )}
                <button
                  onClick={() => setPartnerMenuOpen(false)}
                  aria-label="关闭菜单"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/70 text-[#8a8a90] ring-1 ring-white/80 transition active:scale-90"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===== v8.0 AI 主动请求弹窗（「××想要拥抱你」：同意 / 拒绝） ===== */}
        <AnimatePresence>
          {request && companion && (
            <motion.div
              key="ai-request"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-auto absolute inset-0 z-[70] flex items-center justify-center bg-black/25 p-6"
              role="dialog"
              aria-label={`${companion.name}的请求`}
            >
              <motion.div
                initial={{ scale: 0.9, y: 14 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.94, y: 10 }}
                transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                className="w-full max-w-[290px] rounded-3xl bg-white/95 p-5 text-center shadow-2xl backdrop-blur-xl"
              >
                <div className="mx-auto mb-2.5 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#f6cdd6] to-[#dcd2ec] text-[20px] font-bold text-white shadow-inner">
                  {companion.name.slice(0, 1)}
                </div>
                <p className="text-[15px] font-semibold text-[#3a3a3e]">
                  {companion.name}
                  {request.kind === 'hug' ? '想要拥抱你' : '想牵牵你的手'}
                </p>
                <p className="mb-4 mt-1 text-[11.5px] text-[#9a9a96]">
                  {request.kind === 'hug' ? 'TA 张开了双臂，就站在你面前' : 'TA 朝你伸出了手'}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={rejectRequest}
                    className="h-11 flex-1 rounded-full bg-[#f1efe9] text-[13.5px] font-semibold text-[#8a8a86] transition active:scale-95"
                  >
                    拒绝
                  </button>
                  <button
                    onClick={acceptRequest}
                    className="h-11 flex-1 rounded-full bg-[#f4b3c2] text-[13.5px] font-semibold text-white shadow-md shadow-[#f4b3c2]/40 transition active:scale-95"
                  >
                    同意
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 乐器弹奏覆盖层（吉他弦/钢琴键，点按真实发声） */}
        {inst && <InstrumentOverlay kind={inst.kind} onClose={closeInst} />}

        {/* 编辑模式：缩放按钮（右缘中部） */}
        {mode === 'edit' && (
          <div className="pointer-events-auto absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-2">
            <button
              onClick={() => zoom(1)}
              aria-label="放大画面"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/85 text-[#5a5a5e] shadow-md backdrop-blur transition active:scale-95"
            >
              <ZoomIn className="h-5 w-5" />
            </button>
            <button
              onClick={() => zoom(-1)}
              aria-label="缩小画面"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/85 text-[#5a5a5e] shadow-md backdrop-blur transition active:scale-95"
            >
              <ZoomOut className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* 底部区 */}
        <div className="p-4 pb-6">
          {/* 选中操作条（编辑模式·门窗：毛玻璃胶囊 · 移动/换色/收起窗户，门不可收起） */}
          <AnimatePresence>
            {mode === 'edit' && isWallSel && !shopOpen && !paletteOpen && (
              <motion.div
                key={selId}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                className="pointer-events-auto mx-auto mb-3 w-fit"
              >
                {/* 名字小签（毛玻璃胶囊） */}
                <div className="mx-auto mb-2 w-fit rounded-full border border-white/40 bg-black/25 px-3.5 py-1 text-[11px] font-medium text-white/95 shadow-sm backdrop-blur-md">
                  {selWallName} · 拖动或方向键沿墙移动
                </div>
                <div className={`flex items-center gap-1.5 rounded-full p-2 ${EDIT_GLASS}`}>
                  {/* 四向微调（沿墙滑行）：毛玻璃圆形方向盘 */}
                  <div className="grid shrink-0 grid-cols-3 grid-rows-3 gap-0.5 rounded-full bg-white/40 p-1.5 ring-1 ring-white/70">
                    <span />
                    <button
                      onClick={() => issueMoveCmd('up')}
                      aria-label="上移"
                      className={editDirBtn}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <span />
                    <button
                      onClick={() => issueMoveCmd('left')}
                      aria-label="左移"
                      className={editDirBtn}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="flex h-9 w-9 items-center justify-center text-[9px] font-medium text-[#b8b5ac]">沿墙</span>
                    <button
                      onClick={() => issueMoveCmd('right')}
                      aria-label="右移"
                      className={editDirBtn}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <span />
                    <button
                      onClick={() => issueMoveCmd('down')}
                      aria-label="下移"
                      className={editDirBtn}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <span />
                  </div>
                  {/* 分隔点 */}
                  <span className="mx-0.5 h-1.5 w-1.5 rounded-full bg-[#d8cfc4]/80" />
                  {/* 换色 */}
                  <button
                    onClick={() => setPaletteOpen(true)}
                    aria-label="给门窗换色"
                    title="换颜色"
                    className={`${toolBtn} h-11 w-11 bg-[#f7e8f2]/85 text-[#b07193] ring-1 ring-white/80 hover:bg-[#f3dcea]/90`}
                  >
                    <Droplet className="h-[18px] w-[18px]" />
                  </button>
                  {/* 收起窗户（窗户可像家具一样删除；门不可） */}
                  {selId?.startsWith('win-') && (
                    <button
                      onClick={removeWinSel}
                      aria-label="收起窗户"
                      title="收起这扇窗（商店「窗户」可装回）"
                      className={`${toolBtn} h-11 w-11 bg-[#f9e3e8]/90 text-[#d4717f] ring-1 ring-white/80 hover:bg-[#f5d5dc]/95`}
                    >
                      <Trash2 className="h-[18px] w-[18px]" />
                    </button>
                  )}
                  {/* 取消选中 */}
                  <button
                    onClick={() => setSelId(null)}
                    aria-label="取消选中"
                    className={`${toolBtn} h-11 w-11 bg-[#efeef0]/85 text-[#8a8a90] ring-1 ring-white/80`}
                  >
                    <X className="h-[18px] w-[18px]" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 选中操作条（编辑模式·家具：毛玻璃胶囊 · 移动/升降/旋转/调色/收起） */}
          <AnimatePresence>
            {mode === 'edit' && selItem && selEntry && !shopOpen && !paletteOpen && (
              <motion.div
                key={selItem.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                className="pointer-events-auto mx-auto mb-3 w-fit"
              >
                {/* 家具名小签（毛玻璃胶囊） */}
                <div className="mx-auto mb-2 w-fit rounded-full border border-white/40 bg-black/25 px-3.5 py-1 text-[11px] font-medium text-white/95 shadow-sm backdrop-blur-md">
                  {selEntry.name}
                </div>
                {/* 双排布局（单排超出屏宽会被挤压重叠）：上排 = 移动/升降/旋转，下排 = 调色/收起/取消 */}
                <div className="flex flex-col items-center gap-1.5">
                  <div className={`flex items-center gap-2 rounded-full p-2 ${EDIT_GLASS}`}>
                    {/* 移动：四向方向盘 + 中央「移动模式」开关
                       （两种搬运方式：① 点上下左右逐步微调 ② 开移动模式后按住画面拖动） */}
                    <div className="grid shrink-0 grid-cols-3 grid-rows-3 gap-0.5 rounded-full bg-white/40 p-1.5 ring-1 ring-white/70">
                      <span />
                      <button
                        onClick={() => issueMoveCmd('up')}
                        aria-label="上移一格"
                        title="上移一格"
                        className={editDirBtn}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <span />
                      <button
                        onClick={() => issueMoveCmd('left')}
                        aria-label="左移一格"
                        title="左移一格"
                        className={editDirBtn}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        onClick={toggleMove}
                        aria-label="移动模式（按住画面拖动搬运）"
                        title="移动模式（按住画面拖动搬运）"
                        className={
                          moveOn
                            ? 'flex h-9 w-9 items-center justify-center rounded-full bg-[#cdeacd] text-[#2f7d4d] shadow-inner ring-1 ring-[#9ed4ae]'
                            : 'flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-[#77766e] shadow-sm ring-1 ring-white/60 transition active:scale-90'
                        }
                      >
                        <Move className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => issueMoveCmd('right')}
                        aria-label="右移一格"
                        title="右移一格"
                        className={editDirBtn}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <span />
                      <button
                        onClick={() => issueMoveCmd('down')}
                        aria-label="下移一格"
                        title="下移一格"
                        className={editDirBtn}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <span />
                    </div>

                    {/* 升降：抬上桌 / 放回地（相框、小盆栽…） */}
                    <div className="grid shrink-0 grid-rows-2 gap-0.5 rounded-full bg-white/40 p-1.5 ring-1 ring-white/70">
                      <button
                        onClick={() => liftSel(1)}
                        aria-label="抬高一层（可放上桌面）"
                        title="抬高一层"
                        className={editDirBtnBlue}
                      >
                        <ChevronsUp className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => liftSel(-1)}
                        aria-label="放低一层（放回地面）"
                        title="放低一层"
                        className={editDirBtnBlue}
                      >
                        <ChevronsDown className="h-4 w-4" />
                      </button>
                    </div>

                    {/* 旋转：四宫格（上排 左转/右转，下排 下俯/上仰） */}
                    <div className="grid shrink-0 grid-cols-2 grid-rows-2 gap-0.5 rounded-full bg-white/40 p-1.5 ring-1 ring-white/70">
                      <button
                        onClick={() => rotateY(-1)}
                        aria-label="向左旋转 45°"
                        title="向左旋转"
                        className={editDirBtnAmber}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => rotateY(1)}
                        aria-label="向右旋转 45°"
                        title="向右旋转"
                        className={editDirBtnAmber}
                      >
                        <RotateCw className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => tilt(-1)}
                        aria-label="向下旋转 15°"
                        title="向下旋转"
                        className={editDirBtnAmber}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => tilt(1)}
                        aria-label="向上旋转 15°"
                        title="向上旋转"
                        className={editDirBtnAmber}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* 下排：调色 / 收起 / 取消 */}
                  <div className={`flex items-center gap-1.5 rounded-full p-1.5 ${EDIT_GLASS}`}>
                    {/* 调色 */}
                    <button
                      onClick={() => setPaletteOpen(true)}
                      aria-label="调色盘"
                      title="调色盘"
                      className={`${toolBtn} h-10 w-10 bg-[#f7e8f2]/85 text-[#b07193] ring-1 ring-white/80 hover:bg-[#f3dcea]/90`}
                    >
                      <Droplet className="h-[17px] w-[17px]" />
                    </button>
                    {/* 收起 */}
                    <button
                      onClick={removeSel}
                      aria-label="收起家具"
                      title="收起"
                      className={`${toolBtn} h-10 w-10 bg-[#f9e3e8]/90 text-[#d4717f] ring-1 ring-white/80 hover:bg-[#f5d5dc]/95`}
                    >
                      <Trash2 className="h-[17px] w-[17px]" />
                    </button>
                    {/* 取消选中 */}
                    <button
                      onClick={() => setSelId(null)}
                      aria-label="取消选中"
                      className={`${toolBtn} h-10 w-10 bg-[#efeef0]/85 text-[#8a8a90] ring-1 ring-white/80`}
                    >
                      <X className="h-[17px] w-[17px]" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-end justify-between">
            {/* 摇杆（生活模式） */}
            <div className={mode === 'live' ? 'pointer-events-auto' : 'hidden'}>
              <Joystick onVec={(dx, dy) => (joyRef.current = { dx, dy })} size={124} />
            </div>
            <div className={mode === 'live' ? 'hidden' : 'flex-1'} />

            {/* 编辑工具（装修模式）：撤销 / 重做 / 地板墙色 / 商店（音效/视角已收进右上角 ⋮ 菜单） */}
            <div className="pointer-events-auto flex flex-col items-end gap-2">
              {mode === 'edit' && (
                <div className={`flex items-center gap-2 rounded-full p-1.5 ${EDIT_GLASS}`}>
                  {/* 撤销上一步装修操作（Ctrl+Z）：放置/收起/移动/旋转/升降/换色/门窗均可撤销 */}
                  <button
                    onClick={undo}
                    disabled={histLen.u === 0}
                    aria-label="撤销"
                    title="撤销上一步（Ctrl+Z）"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/70 text-[#6a7a8a] shadow-sm ring-1 ring-white/70 transition active:scale-95 disabled:opacity-40"
                  >
                    <Undo2 className="h-[18px] w-[18px]" />
                  </button>
                  {/* 重做（取消上一次撤销）：Ctrl+Shift+Z / Ctrl+Y */}
                  <button
                    onClick={redo}
                    disabled={histLen.r === 0}
                    aria-label="重做"
                    title="重做（Ctrl+Shift+Z / Ctrl+Y）"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/70 text-[#6a7a8a] shadow-sm ring-1 ring-white/70 transition active:scale-95 disabled:opacity-40"
                  >
                    <Redo2 className="h-[18px] w-[18px]" />
                  </button>
                  <span className="h-1.5 w-1.5 rounded-full bg-[#d8cfc4]/80" />
                  <button
                    onClick={() => setRoomStyleOpen((o) => !o)}
                    className={`flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition active:scale-95 ${
                      roomStyleOpen
                        ? 'bg-[#e8f2f7] text-[#4a7a95] shadow-inner ring-1 ring-[#bcdcea]'
                        : 'bg-white/70 text-[#4a4a4e] shadow-sm ring-1 ring-white/70'
                    }`}
                  >
                    <Paintbrush className="h-4 w-4 text-[#7fa8c9]" />
                    地板墙色
                  </button>
                  <button
                    onClick={() => setShopOpen((o) => !o)}
                    className={`flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition active:scale-95 ${
                      shopOpen
                        ? 'bg-[#fdeef3] text-[#c96a8c] shadow-inner ring-1 ring-[#f3c2d3]'
                        : 'bg-white/70 text-[#4a4a4e] shadow-sm ring-1 ring-white/70'
                    }`}
                  >
                    <Store className="h-4 w-4 text-[#c99a5b]" />
                    商店
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ===== 拍照模式（F6）：隐藏全部 UI，快门存情侣相册 ===== */}
      <AnimatePresence>
        {photoMode && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 z-30">
            <button
              onClick={() => setPhotoMode(false)}
              aria-label="退出拍照模式"
              className="pointer-events-auto absolute left-3 top-11 flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white shadow backdrop-blur transition active:scale-95"
            >
              <X className="h-5 w-5" />
            </button>
            <span className="absolute left-1/2 top-12 -translate-x-1/2 rounded-full bg-black/30 px-3 py-1 text-[11px] text-white/90 backdrop-blur">
              拍照模式 · 画面随你摆
            </span>
            <button
              onClick={takePhoto}
              aria-label="拍照"
              className="pointer-events-auto absolute bottom-8 left-1/2 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full border-4 border-white/90 bg-white/25 shadow-xl backdrop-blur transition active:scale-90"
            >
              <Camera className="h-7 w-7 text-white" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== 我的衣柜（走到衣柜前弹出；上半屏透出小人实时试穿；女生/男生都可换装） ===== */}
      <Wardrobe
        open={wardrobeOpen}
        wear={wear}
        wear2={wear2}
        initialChar={wardrobeChar}
        petCoat={pet.coat}
        petWear={pet.wear}
        onPetChange={changePetLook}
        onChange={(w) => {
          setWear(w);
          saveSoon();
        }}
        onChange2={(w) => {
          setWear2(w);
          saveSoon();
        }}
        onClose={() => {
          setWardrobeOpen(false);
          sfx.tap();
          if (actRef.current?.type === 'dress') endAction();
        }}
      />

      {/* ===== 五子棋对弈（棋盘桌 J7） ===== */}
      <AnimatePresence>
        {chess && <ChessOverlay onClose={() => setChess(null)} />}
      </AnimatePresence>

      {/* ===== 做饭小游戏（灶台 F5） ===== */}
      <AnimatePresence>
        {cookingGame && <CookingGame onComplete={onCookingDone} onClose={() => setCookingGame(false)} />}
      </AnimatePresence>

      {/* ===== G10 相框菜单：换照片 / 拼一拼 ===== */}
      <AnimatePresence>
        {photoMenuFor && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex items-end justify-center bg-black/25 p-6 pb-10"
            onClick={() => setPhotoMenuFor(null)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 340 }}
              className="pointer-events-auto w-full max-w-[260px] overflow-hidden rounded-3xl bg-white/95 shadow-2xl backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="pt-3.5 text-center text-[12px] text-[#9a9a96]">立式相框</p>
              <button
                onClick={() => {
                  photoTargetRef.current = photoMenuFor;
                  fileInputRef.current?.click();
                  setPhotoMenuFor(null);
                }}
                className="flex w-full items-center justify-center gap-1.5 px-5 py-3 text-[13.5px] font-medium text-[#4a4a4e] transition active:bg-black/5"
              >
                <ImagePlus className="h-4 w-4 text-[#e8a3b3]" /> 换一张照片
              </button>
              <div className="mx-5 h-px bg-[#f0eeea]" />
              <button
                onClick={() => {
                  const it = itemsRef.current.find((f) => f.id === photoMenuFor);
                  setPuzzleFor({ photo: it?.st?.photo });
                  setPhotoMenuFor(null);
                }}
                className="flex w-full items-center justify-center gap-1.5 px-5 py-3 text-[13.5px] font-medium text-[#4a4a4e] transition active:bg-black/5"
              >
                <Puzzle className="h-4 w-4 text-[#e8a3b3]" /> 用照片拼一拼
              </button>
              <div className="mx-5 h-px bg-[#f0eeea]" />
              <button
                onClick={() => setPhotoMenuFor(null)}
                className="w-full px-5 py-3 text-[13.5px] font-medium text-[#b8b4ae] transition active:bg-black/5"
              >
                取消
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== G8 软木留言板面板 ===== */}
      <AnimatePresence>
        {noteOpen && (
          <NotesOverlay
            notes={notes}
            onClose={() => setNoteOpen(false)}
            onPost={(text) => {
              setNotes((prev) => [
                ...prev.slice(-49),
                {
                  id: `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                  text,
                  ts: Date.now(),
                  by: 'me',
                },
              ]);
              sfx.tap();
              saveSoon();
            }}
            onDelete={(id) => {
              setNotes((prev) => prev.filter((n) => n.id !== id));
              saveSoon();
            }}
          />
        )}
      </AnimatePresence>

      {/* ===== G10 抓娃娃 / 咖啡拉花 / 照片拼图 ===== */}
      <ClawMachineGame open={!!clawFor} onClose={() => setClawFor(null)} onWin={onClawWin} />
      <LatteArtGame open={latteOpen} onClose={() => setLatteOpen(false)} onResult={onLatteResult} />
      <PuzzleGame open={!!puzzleFor} onClose={() => setPuzzleFor(null)} photo={puzzleFor?.photo} />

      {/* ===== 小屋点歌（F3：音箱/黑胶/八音盒共用；搜歌 · 我的歌单 · 队列 —— v6.0 重构） ===== */}
      <SongSheet open={musicSheet} onClose={() => setMusicSheet(false)} onToast={toast} />

      {/* ===== 调色盘面板（编辑模式：家具 / 门窗） ===== */}
      <AnimatePresence>
        {mode === 'edit' && paletteOpen && (isWallSel || (selItem && selEntry)) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/25 p-6"
            onClick={() => setPaletteOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.92, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 8 }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              className="pointer-events-auto w-full max-w-[320px] rounded-3xl bg-white/95 p-5 shadow-2xl backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[15px] font-semibold text-[#3a3a3e]">
                  {isWallSel ? `给「${selWallName}」换色` : `给「${selEntry!.name}」上色`}
                </span>
                <button
                  onClick={() => setPaletteOpen(false)}
                  aria-label="关闭调色盘"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mb-4 text-[11.5px] text-[#9a9a96]">
                {isWallSel ? '全屋门窗一起换色' : '白色为主，点缀色随心混搭'}
              </p>

              {/* 色卡网格 */}
              <div className="grid grid-cols-5 gap-2.5">
                {SWATCHES.map((s) => (
                  <button
                    key={s.hex}
                    onClick={() => applyColor(s.hex)}
                    title={s.name}
                    aria-label={`选色 ${s.name}`}
                    className="group flex flex-col items-center gap-1"
                  >
                    <span
                      className={
                        paletteVal === s.hex
                          ? 'h-10 w-10 rounded-full ring-2 ring-[#f2a9bc] ring-offset-2 shadow-md'
                          : 'h-10 w-10 rounded-full shadow-sm ring-1 ring-black/10 transition group-active:scale-90'
                      }
                      style={{ background: s.hex }}
                    />
                    <span className="text-[10px] text-[#8a8a86]">{s.name}</span>
                  </button>
                ))}
              </div>

              {/* 自定义 + 恢复默认 */}
              <div className="mt-4 flex items-center gap-2.5">
                <label className="relative flex h-11 flex-1 cursor-pointer items-center gap-2.5 rounded-2xl bg-[#f6f4ef] px-3 ring-1 ring-[#eae7df]">
                  <span
                    className="h-7 w-7 rounded-lg shadow-inner ring-1 ring-black/10"
                    style={{
                      background: /^#[0-9a-fA-F]{6}$/.test(paletteVal ?? '')
                        ? paletteVal
                        : 'conic-gradient(#f6cdd6,#f9e6a6,#c9e3cf,#dcd2ec,#f6cdd6)',
                    }}
                  />
                  <span className="text-[12px] font-medium text-[#4a4a4e]">自定义颜色</span>
                  <input
                    type="color"
                    aria-label="自定义颜色"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    value={/^#[0-9a-fA-F]{6}$/.test(paletteVal ?? '') ? paletteVal : '#ffffff'}
                    onChange={(e) => applyColor(e.target.value)}
                  />
                </label>
                <button
                  onClick={() => applyColor(null)}
                  className="flex h-11 items-center rounded-2xl bg-[#f1efe9] px-4 text-[12px] font-medium text-[#8a8a86] transition active:scale-95"
                >
                  原色
                </button>
              </div>

              {/* E7 灯光颜色（灯具专属：换的是灯光本身的颜色，非外观；选中 lc 高亮对应圆片） */}
              {selEntry?.light && (
                <div className="mt-4 border-t border-[#f0ede5] pt-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[12.5px] font-medium text-[#6a6a6e]">灯光颜色</span>
                    <span className="text-[10.5px] text-[#a8a8a4]">开灯后才看得到哦</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {LIGHT_SWATCHES.map((s) => (
                      <button
                        key={s.hex}
                        onClick={() => applyLightColor(s.hex)}
                        title={s.name}
                        aria-label={`灯光颜色 ${s.name}`}
                        className="group flex flex-col items-center"
                      >
                        <span
                          className={
                            selItem?.st?.lc === s.hex
                              ? 'h-8 w-8 rounded-full ring-2 ring-[#f2a9bc] ring-offset-2 shadow-md'
                              : 'h-8 w-8 rounded-full shadow-sm ring-1 ring-black/10 transition group-active:scale-90'
                          }
                          style={{ background: s.hex }}
                        />
                      </button>
                    ))}
                    <button
                      onClick={() => applyLightColor(null)}
                      aria-label="恢复默认灯光颜色"
                      className={
                        selItem?.st?.lc
                          ? 'ml-auto rounded-full bg-[#f1efe9] px-3 py-1.5 text-[11.5px] font-medium text-[#8a8a86] transition active:scale-95'
                          : 'ml-auto rounded-full bg-[#f2b3c2] px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm transition active:scale-95'
                      }
                    >
                      默认
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== 装修面板：地板 / 墙壁 / 门 / 窗 自定义颜色 ===== */}
      <AnimatePresence>
        {mode === 'edit' && roomStyleOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/25 p-6"
            onClick={() => setRoomStyleOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.92, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 8 }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              className="pointer-events-auto w-full max-w-[320px] rounded-3xl bg-white/95 p-5 shadow-2xl backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[15px] font-semibold text-[#3a3a3e]">装修 · 换颜色</span>
                <button
                  onClick={() => setRoomStyleOpen(false)}
                  aria-label="关闭装修面板"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mb-3 text-[11.5px] text-[#9a9a96]">四房间 + 天花板分开换色，门窗也能换</p>

              <div className="scrollbar-none max-h-[54vh] overflow-y-auto pr-0.5">
                {/* —— 客厅 —— */}
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#f2b3c2]" />
                  <span className="text-[12px] font-semibold text-[#8a8a90]">客厅</span>
                </div>
                <ColorRow label="地板" value={floorCol} onPick={applyFloorCol} fallback="#f5f2ec" />
                <ColorRow label="墙壁" value={wallCol} onPick={applyWallCol} fallback="#f7f3ec" />
                <ColorRow label="天花板" value={ceilCol} onPick={applyCeilCol} fallback="#fbf9f3" />

                {/* —— 卧室 —— */}
                <div className="mb-2 mt-4 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#c9a8dc]" />
                  <span className="text-[12px] font-semibold text-[#8a8a90]">卧室</span>
                </div>
                <ColorRow label="地板" value={floorColBed} onPick={applyFloorColBed} fallback="#f5f2ec" />
                <ColorRow label="墙壁" value={wallColBed} onPick={applyWallColBed} fallback="#f7f3ec" />
                <ColorRow label="天花板" value={ceilColBed} onPick={applyCeilColBed} fallback="#fbf9f3" />

                {/* —— 厨房 —— */}
                <div className="mb-2 mt-4 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#e8c9a0]" />
                  <span className="text-[12px] font-semibold text-[#8a8a90]">厨房</span>
                </div>
                <ColorRow label="地板" value={floorColK} onPick={applyFloorColK} fallback="#f5f2ec" />
                <ColorRow label="墙壁" value={wallColK} onPick={applyWallColK} fallback="#f7f3ec" />
                <ColorRow label="天花板" value={ceilColK} onPick={applyCeilColK} fallback="#fbf9f3" />

                {/* —— 卫生间 —— */}
                <div className="mb-2 mt-4 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#a8d8cf]" />
                  <span className="text-[12px] font-semibold text-[#8a8a90]">卫生间</span>
                </div>
                <ColorRow label="地板" value={floorColB} onPick={applyFloorColB} fallback="#f5f2ec" />
                <ColorRow label="墙壁" value={wallColB} onPick={applyWallColB} fallback="#f7f3ec" />
                <ColorRow label="天花板" value={ceilColB} onPick={applyCeilColB} fallback="#fbf9f3" />

                {/* —— 阳台（v5.7） —— */}
                <div className="mb-2 mt-4 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#d9c7a4]" />
                  <span className="text-[12px] font-semibold text-[#8a8a90]">阳台</span>
                </div>
                <ColorRow label="地板" value={floorColBal} onPick={applyFloorColBal} fallback="#e2d2b4" />
                <ColorRow label="墙壁" value={wallColBal} onPick={applyWallColBal} fallback="#f7f3ec" />

                {/* —— 门窗（全屋通用） —— */}
                <div className="mb-2 mt-4 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#a8c5e0]" />
                  <span className="text-[12px] font-semibold text-[#8a8a90]">门 · 窗</span>
                </div>
                <ColorRow label="门" value={doorCol} onPick={applyDoorCol} fallback="#f3efe6" />
                <ColorRow label="窗" value={winCol} onPick={applyWinCol} fallback="#f0e7d4" />

                {/* —— 纹理（全屋通用，颜色仍分房间） —— */}
                <div className="mb-2 mt-4 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#d9c7ae]" />
                  <span className="text-[12px] font-semibold text-[#8a8a90]">纹理</span>
                </div>
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <span className="text-[12.5px] text-[#6a6a6e]">地板花纹</span>
                  <div className="flex gap-1">
                    {(
                      [
                        ['wood', '木纹'],
                        ['plain', '素色'],
                        ['check', '瓷砖'],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => {
                          pushHistory();
                          setFloorTex(v);
                          saveSoon();
                        }}
                        className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition active:scale-95 ${
                          floorTex === v
                            ? 'bg-[#f2b3c2] text-white shadow-sm'
                            : 'bg-[#f0eff1] text-[#8a8a90]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between px-1">
                  <span className="text-[12.5px] text-[#6a6a6e]">墙纸花纹</span>
                  <div className="flex gap-1">
                    {(
                      [
                        ['plain', '素色'],
                        ['dot', '碎花'],
                        ['stripe', '条纹'],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        onClick={() => {
                          pushHistory();
                          setWallTex(v);
                          saveSoon();
                        }}
                        className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition active:scale-95 ${
                          wallTex === v
                            ? 'bg-[#f2b3c2] text-white shadow-sm'
                            : 'bg-[#f0eff1] text-[#8a8a90]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* —— G1 装修方案（整屋快照 A/B/C，应用一步可撤销） —— */}
                <div className="mb-2 mt-4 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#f2a9bc]" />
                  <span className="text-[12px] font-semibold text-[#8a8a90]">装修方案</span>
                </div>
                <p className="mb-2 text-[10.5px] leading-snug text-[#a8a8a4]">
                  整屋快照（家具+各房间地板墙色，不含照片），换季搬家一键切换，应用后可撤销
                </p>
                <div className="flex flex-col gap-2">
                  {[0, 1, 2].map((i) => {
                    const snap = layouts[i];
                    const tag = ['A', 'B', 'C'][i];
                    return (
                      <div key={i} className="flex items-center gap-2 rounded-2xl bg-[#faf8f3] p-2.5 ring-1 ring-[#efece2]">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f6cdd6] to-[#dcd2ec] text-[12px] font-bold text-white">
                          {tag}
                        </span>
                        {snap ? (
                          <>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12px] font-semibold text-[#3a3a3e]">
                                方案{tag} · {snap.furniture.length} 件
                              </div>
                              <div className="text-[10px] text-[#a8a8a4]">
                                {new Date(snap.ts).toLocaleDateString('zh-CN')} 保存
                              </div>
                            </div>
                            <button
                              onClick={() => applyLayout(i)}
                              className="shrink-0 rounded-full bg-[#f4b3c2] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition active:scale-95"
                            >
                              应用
                            </button>
                            <button
                              onClick={() => saveLayout(i)}
                              className="shrink-0 rounded-full bg-[#f0eff1] px-3 py-1.5 text-[11px] font-medium text-[#8a8a90] transition active:scale-95"
                            >
                              覆盖
                            </button>
                          </>
                        ) : (
                          <>
                            <div className="min-w-0 flex-1 text-[12px] text-[#a8a8a4]">方案{tag} · 空</div>
                            <button
                              onClick={() => saveLayout(i)}
                              className="shrink-0 rounded-full bg-[#f4b3c2] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition active:scale-95"
                            >
                              存入当前布置
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== 商店抽屉（编辑模式） ===== */}
      <AnimatePresence>
        {mode === 'edit' && shopOpen && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="absolute inset-x-0 bottom-0 z-10 flex max-h-[52%] flex-col rounded-t-3xl bg-white/95 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] backdrop-blur-xl"
          >
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <span className="text-[15px] font-semibold text-[#3a3a3e]">家具商店</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={resetHome}
                  className="rounded-full bg-[#f6eded] px-3 py-1 text-[11px] font-medium text-[#c26a6a] transition active:scale-95"
                >
                  重置
                </button>
                <button
                  onClick={() => setShopOpen(false)}
                  aria-label="关闭商店"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 分类 tab（纯文字；首个 = 窗户专项 tab，收起的窗在这里装回） */}
            <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 pb-2 pt-1">
              <button
                onClick={() => setShopTab('win')}
                className={
                  shopTab === 'win'
                    ? 'shrink-0 rounded-full bg-[#8fbfa8] px-3 py-1 text-[12px] font-medium text-white'
                    : 'shrink-0 rounded-full bg-[#f1efe9] px-3 py-1 text-[12px] text-[#8a8a86] transition active:scale-95'
                }
              >
                窗户
              </button>
              {SHOP_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setShopTab(t.key)}
                  className={
                    shopTab === t.key
                      ? 'shrink-0 rounded-full bg-[#f4b3c2] px-3 py-1 text-[12px] font-medium text-white'
                      : 'shrink-0 rounded-full bg-[#f1efe9] px-3 py-1 text-[12px] text-[#8a8a86] transition active:scale-95'
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* 窗户 tab：九扇窗安装位（收起的窗可装回；编辑模式点窗也能收起） */}
            {shopTab === 'win' && (
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto px-4 pb-5 pt-1">
                {WINS.map((w, i) => {
                  const here = winExist[i] !== false;
                  return (
                    <div
                      key={i}
                      className="relative flex flex-col items-start gap-1 rounded-2xl bg-[#faf8f3] p-2 text-left shadow-sm ring-1 ring-[#efece2]"
                    >
                      {here && (
                        <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-[#dff0e2] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-[#3f9a58]">
                          <Check className="h-2.5 w-2.5" strokeWidth={3} />
                          已装
                        </span>
                      )}
                      {/* 窗户示意图标 */}
                      <div
                        className="flex h-16 w-full items-center justify-center rounded-xl"
                        style={{ background: 'linear-gradient(180deg,#dff0f4 0%,#f2f7f4 100%)' }}
                      >
                        <svg viewBox="0 0 48 40" className="h-12 w-12" aria-hidden>
                          <rect x="4" y="4" width="40" height="32" rx="2.5" fill="none" stroke={winCol ?? '#f0e7d4'} strokeWidth="4" />
                          <rect x="8" y="8" width="32" height="24" rx="1.5" fill="#cde8f0" opacity={here ? 0.9 : 0.35} />
                          <line x1="24" y1="8" x2="24" y2="32" stroke={winCol ?? '#f0e7d4'} strokeWidth="2.5" />
                          <line x1="8" y1="20" x2="40" y2="20" stroke={winCol ?? '#f0e7d4'} strokeWidth="2.5" />
                        </svg>
                      </div>
                      <span className="w-full truncate text-[11.5px] font-medium leading-tight text-[#4a4a4e]">
                        {WIN_NAMES[i] ?? `窗户 ${i + 1}`}
                      </span>
                      {here ? (
                        <span className="w-full rounded-full bg-[#f1efe9] py-1 text-center text-[11px] text-[#a8a8a4]">
                          安装中
                        </span>
                      ) : (
                        <button
                          onClick={() => installWin(i)}
                          className="w-full rounded-full bg-[#8fbfa8] py-1 text-[12px] font-semibold text-white shadow-sm transition active:scale-95"
                        >
                          + 安装
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 套装 tab（F3 成套举放） / 商品网格（1:1 实物缩略图 + 已有数量角标；无限购买） */}
            {shopTab === 'set' ? (
              <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto px-4 pb-5 pt-1">
                {FURN_SETS.map((s) => {
                  const setThumb = thumbMap[`set:${s.id}`] ?? getCachedThumb(`set:${s.id}`);
                  const Fallback = SET_FALLBACK[s.id] ?? Armchair;
                  return (
                    <div
                      key={s.id}
                      className="flex flex-col rounded-2xl bg-[#faf8f3] p-2.5 text-left shadow-sm ring-1 ring-[#efece2]"
                    >
                      {setThumb ? (
                        <img
                          src={setThumb}
                          alt={s.name}
                          draggable={false}
                          className="h-20 w-full rounded-xl object-contain"
                        />
                      ) : (
                        <span className="flex h-20 w-full animate-pulse items-center justify-center rounded-xl bg-gradient-to-br from-[#f6cdd6] to-[#dcd2ec]">
                          <Fallback className="h-7 w-7 text-white/90" strokeWidth={1.75} aria-hidden />
                        </span>
                      )}
                      <div className="mt-1.5 flex items-center justify-between gap-1.5">
                        <span className="min-w-0 truncate text-[12.5px] font-semibold text-[#3a3a3e]">
                          {s.name}
                        </span>
                        <span className="shrink-0 rounded-full bg-[#f1efe9] px-1.5 py-0.5 text-[9.5px] leading-none text-[#8a8a86]">
                          {s.items.length} 件
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-[#8a8a86]">{s.desc}</p>
                      <p className="mt-0.5 text-[10px] text-[#a8a8a4]">整组一步撤销</p>
                      <button
                        onClick={() => placeSet(s.id)}
                        className="mt-2 rounded-full bg-[#f4b3c2] py-1.5 text-[12px] font-semibold text-white shadow-sm transition active:scale-95"
                      >
                        一键举放
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto px-4 pb-5 pt-1">
                {shopItems.map((e) => {
                  const owned = items.filter((it) => it.kind === e.kind).length;
                  const thumb = thumbMap[e.kind] || getCachedThumb(e.kind);
                  return (
                    <button
                      key={e.kind}
                      onClick={() => buy(e.kind)}
                      className="relative flex flex-col items-start gap-1 rounded-2xl bg-[#faf8f3] p-2 text-left shadow-sm ring-1 ring-[#efece2] transition active:scale-95"
                    >
                      {owned > 0 && (
                        <span className="absolute right-1.5 top-1.5 rounded-full bg-[#f4b3c2] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white shadow-sm">
                          ×{owned}
                        </span>
                      )}
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={e.name}
                          draggable={false}
                          className="h-16 w-full rounded-xl object-contain"
                        />
                      ) : (
                        <span
                          className="h-16 w-full animate-pulse rounded-xl shadow-inner"
                          style={{ background: `linear-gradient(135deg, ${catColor(e.cat)}, ${shade(e.cat)})` }}
                        />
                      )}
                      <span className="w-full truncate text-[11.5px] font-medium leading-tight text-[#4a4a4e]">
                        {e.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 商城 1:1 缩略图工作室（隐藏离屏画布，逐件快照） */}
      {shopOpen && thumbQueue[0] && (
        <ShopThumbStudio
          kind={thumbQueue[0]}
          onThumb={(kind, url) => {
            // 失败（空串）也标记，避免死循环重试
            setThumbMap((m) => (m[kind] === url ? m : { ...m, [kind]: url }));
          }}
        />
      )}

      {/* 进屋白光过渡（v6.8）：白屏遮首帧 → 淡出与开门推镜同步，纯视觉不拦截点击 */}
      {!whiteGone && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[90] bg-white transition-opacity duration-[1600ms] ease-out"
          style={{ opacity: whiteOn ? 1 : 0 }}
        />
      )}
    </div>
  );
}

// ---------------- 商店色卡 ----------------

const CAT_COLORS: Record<string, [string, string]> = {
  sofa: ['#f6cdd6', '#f0b3c2'],
  table: ['#efdbb2', '#e5c894'],
  bed: ['#f9e4ea', '#f2ccd8'],
  lamp: ['#ffefc0', '#ffe49a'],
  plant: ['#c3e5cf', '#a8d8bb'],
  appliance: ['#e8e9e6', '#dcdcd8'],
  bathroom: ['#e3e9e6', '#d5e0da'],
  kitchen: ['#fdeccd', '#f8dfae'],
  decor: ['#e6cfae', '#dbaf87'],
};

function catColor(cat: string): string {
  return (CAT_COLORS[cat] ?? CAT_COLORS.decor)[0];
}
function shade(cat: string): string {
  return (CAT_COLORS[cat] ?? CAT_COLORS.decor)[1];
}

