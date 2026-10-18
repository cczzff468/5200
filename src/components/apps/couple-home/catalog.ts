'use client';

/**
 * 情侣小家 3D —— 家具目录 / 默认布局 / 持久化
 *
 * 模型：Kenney Furniture Kit 2.0（CC0，kenney.nl），浅色系重着色（白色/浅灰/浅粉/浅黄/蜂蜜木）。
 * 持久化：IndexedDB 即时缓存 + Prisma 服务端快照（rev 乐观并发）。
 */

import { kvGet, kvSet, kvSetDebounced } from '@/lib/ios/idb-kv';
import { getWorkspaceId } from '@/lib/ios/workspace';
import type { CatalogEntry, FurnitureItem, HomeState } from './types';

// ---------------- 世界常量 ----------------

/** 房间宽（米，x 轴） */
export const ROOM_W = 9;
/** 房间深（米，z 轴） */
export const ROOM_D = 6;
/** 墙高（米） */
export const WALL_H = 2.4;
/** 墙厚 */
export const WALL_T = 0.12;
/** 模型统一放大倍数（Kenney 原尺寸为真实家具比例，放大更 Q 萌饱满） */
export const MODEL_SCALE = 1.75;
/** 编辑模式拖拽吸附（米） */
export const SNAP = 0.25;
/** 小人行走边界内缩 */
export const WALK_MARGIN = 0.4;
/** 小人身高（米） */
export const CHAR_H = 0.95;

export const ROOM_X = ROOM_W / 2;
export const ROOM_Z = ROOM_D / 2;

// ---------------- 家具目录 ----------------

const G = (f: string) => `/models/furniture/${f}.glb`;

/** 家具目录：kind → 静态配置（价格单位：金币） */
export const CATALOG: Record<string, CatalogEntry> = {
  // ---- 沙发区 ----
  sofa: {
    kind: 'sofa', glb: G('sofa'), name: '奶油双人沙发', cat: 'sofa', price: 300, fp: [1.7, 0.75],
    acts: { playful: true },
  },
  sofaLong: {
    kind: 'sofaLong', glb: G('sofaLong'), name: '奶油三人沙发', cat: 'sofa', price: 420, fp: [1.7, 1.45],
    acts: { playful: true },
  },
  loungeChair: {
    kind: 'loungeChair', glb: G('loungeChair'), name: '米白躺椅', cat: 'sofa', price: 260, fp: [0.9, 1.2],
    acts: { playful: true },
  },
  ottoman: {
    kind: 'ottoman', glb: G('ottoman'), name: '软软脚凳', cat: 'sofa', price: 90, fp: [0.75, 0.8],
    acts: { playful: true },
  },
  // ---- 桌几 ----
  coffeeTable: {
    kind: 'coffeeTable', glb: G('coffeeTable'), name: '蜂蜜木茶几', cat: 'table', price: 120, fp: [1.15, 0.7],
    acts: { playful: true },
  },
  diningTable: {
    kind: 'diningTable', glb: G('diningTable'), name: '圆脚餐桌', cat: 'table', price: 160, fp: [1.2, 1.4],
    acts: { playful: true },
  },
  chair: {
    kind: 'chair', glb: G('chair'), name: '软垫椅', cat: 'table', price: 45, fp: [0.35, 0.35],
    acts: { playful: true },
  },
  sideTable: {
    kind: 'sideTable', glb: G('sideTable'), name: '抽屉边几', cat: 'table', price: 80, fp: [0.9, 0.4],
    acts: { door: true },
  },
  desk: {
    kind: 'desk', glb: G('desk'), name: '浅木书桌', cat: 'table', price: 220, fp: [1.3, 0.7],
    acts: { playful: true },
  },
  // ---- 床品 ----
  bed: {
    kind: 'bed', glb: G('bed'), name: '粉白双人床', cat: 'bed', price: 450, fp: [1.7, 2.0],
    acts: { playful: true },
  },
  bedSingle: {
    kind: 'bedSingle', glb: G('bedSingle'), name: '单人小床', cat: 'bed', price: 260, fp: [1.0, 2.0],
    acts: { playful: true },
  },
  nightstand: {
    kind: 'nightstand', glb: G('nightstand'), name: '小抽屉床头柜', cat: 'bed', price: 90, fp: [0.5, 0.4],
    acts: { door: true },
  },
  // ---- 地毯 ----
  rug: {
    kind: 'rug', glb: G('rug'), name: '浅粉圆地毯', cat: 'decor', price: 100, fp: [1.6, 1.6],
    acts: { playful: true }, flat: true,
  },
  rugRect: {
    kind: 'rugRect', glb: G('rugRect'), name: '米色长地毯', cat: 'decor', price: 130, fp: [2.75, 1.6],
    acts: { playful: true }, flat: true,
  },
  doormat: {
    kind: 'doormat', glb: G('doormat'), name: '进门地垫', cat: 'decor', price: 25, fp: [0.75, 0.4],
    acts: { playful: true }, flat: true,
  },
  // ---- 影音 ----
  tvStand: {
    kind: 'tvStand', glb: G('tvStand'), name: '原木电视柜', cat: 'table', price: 150, fp: [1.4, 0.45],
    acts: { playful: true },
  },
  tv: {
    kind: 'tv', glb: G('tv'), name: '智能电视', cat: 'appliance', price: 260, fp: [1.2, 0.25],
    acts: { toggle: true }, light: { y: 0.55, color: '#cfe6ff', intensity: 0.8 },
  },
  speaker: {
    kind: 'speaker', glb: G('speaker'), name: '小音箱', cat: 'appliance', price: 90, fp: [0.3, 0.3],
    acts: { playful: true },
  },
  radio: {
    kind: 'radio', glb: G('radio'), name: '复古收音机', cat: 'appliance', price: 200, fp: [0.55, 0.2],
    acts: { toggle: true }, light: { y: 0.28, color: '#ffd9a0', intensity: 0.4 },
  },
  microwave: {
    kind: 'microwave', glb: G('microwave'), name: '小微波炉', cat: 'appliance', price: 180, fp: [0.5, 0.4],
    acts: { playful: true },
  },
  toaster: {
    kind: 'toaster', glb: G('toaster'), name: '烤面包机', cat: 'appliance', price: 120, fp: [0.35, 0.2],
    acts: { playful: true },
  },
  // ---- 灯具 ----
  lampFloor: {
    kind: 'lampFloor', glb: G('lampFloor'), name: '蘑菇落地灯', cat: 'lamp', price: 110, fp: [0.3, 0.3],
    acts: { toggle: true }, light: { y: 1.45, color: '#ffd9a0', intensity: 1.2 },
  },
  lampTable: {
    kind: 'lampTable', glb: G('lampTable'), name: '蘑菇小台灯', cat: 'lamp', price: 70, fp: [0.3, 0.3],
    acts: { toggle: true }, light: { y: 0.48, color: '#ffd9a0', intensity: 0.9 },
  },
  // ---- 植物 ----
  plant: {
    kind: 'plant', glb: G('plant'), name: '大盆绿植', cat: 'plant', price: 60, fp: [0.4, 0.45],
    acts: { playful: true },
  },
  plantSmall: {
    kind: 'plantSmall', glb: G('plantSmall'), name: '小多肉', cat: 'plant', price: 30, fp: [0.2, 0.2],
    acts: { playful: true },
  },
  // ---- 收纳 ----
  bookcase: {
    kind: 'bookcase', glb: G('bookcase'), name: '开放书架', cat: 'decor', price: 140, fp: [0.7, 0.45],
    acts: { playful: true },
  },
  wardrobe: {
    kind: 'wardrobe', glb: G('wardrobe'), name: '双门衣柜', cat: 'decor', price: 320, fp: [0.7, 0.45],
    acts: { door: true },
  },
  box: {
    kind: 'box', glb: G('box'), glbAlt: G('boxOpen'), name: '收纳纸箱', cat: 'decor', price: 0, fp: [0.4, 0.4],
    acts: { door: true },
  },
  trashcan: {
    kind: 'trashcan', glb: G('trashcan'), name: '小垃圾桶', cat: 'decor', price: 20, fp: [0.35, 0.4],
    acts: { playful: true },
  },
  books: {
    kind: 'books', glb: G('books'), name: '书堆', cat: 'decor', price: 20, fp: [0.25, 0.15],
    acts: { playful: true },
  },
  coatRack: {
    kind: 'coatRack', glb: G('coatRack'), name: '衣帽架', cat: 'decor', price: 85, fp: [0.5, 0.5],
    acts: { playful: true },
  },
  // ---- 厨卫家电 ----
  fridge: {
    kind: 'fridge', glb: G('fridge'), name: '奶油冰箱', cat: 'appliance', price: 380, fp: [0.75, 0.5],
    acts: { door: true },
  },
  stove: {
    kind: 'stove', glb: G('stove'), name: '复古灶台', cat: 'appliance', price: 300, fp: [0.75, 0.8],
    acts: { playful: true },
  },
  sink: {
    kind: 'sink', glb: G('sink'), name: '厨房水槽', cat: 'appliance', price: 210, fp: [0.75, 0.8],
    acts: { door: true },
  },
  kitchenBar: {
    kind: 'kitchenBar', glb: G('kitchenBar'), name: '小吧台', cat: 'table', price: 240, fp: [0.75, 0.35],
    acts: { playful: true },
  },
  washer: {
    kind: 'washer', glb: G('washer'), name: '滚筒洗衣机', cat: 'appliance', price: 350, fp: [0.7, 0.7],
    acts: { door: true, washer: true },
  },
  bathtub: {
    kind: 'bathtub', glb: G('bathtub'), name: '泡泡浴缸', cat: 'bathroom', price: 400, fp: [2.1, 1.0],
    acts: { playful: true },
  },
  toilet: {
    kind: 'toilet', glb: G('toilet'), name: '小白马桶', cat: 'bathroom', price: 150, fp: [0.55, 0.85],
    acts: { playful: true },
  },
  // ---- 宠物 ----
  bear: {
    kind: 'bear', glb: G('bear'), name: '小熊「团团」', cat: 'decor', price: 500, fp: [0.7, 0.45],
    acts: { playful: true },
  },
};

/** 商店分类 tab 配置（编辑模式底部栏；纯文字，无图标） */
export const SHOP_TABS: { key: import('./types').FurnCategory; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'sofa', label: '沙发' },
  { key: 'table', label: '桌几' },
  { key: 'bed', label: '床品' },
  { key: 'lamp', label: '灯具' },
  { key: 'plant', label: '植物' },
  { key: 'appliance', label: '家电' },
  { key: 'bathroom', label: '卫浴' },
  { key: 'decor', label: '装饰' },
];

// ---------------- 默认布局 ----------------

let seq = 0;
const F = (
  kind: FurnitureItem['kind'],
  x: number,
  z: number,
  r = 0,
  st: FurnitureItem['st'] = {},
): FurnitureItem => ({ id: `${kind}-${Date.now().toString(36)}-${++seq}`, kind, x, z, r, st });

/**
 * 初始 9×6 开间布局：
 * 客厅（中北，电视墙+沙发对坐）· 餐厨（东侧）· 卧室（西南）· 洗衣角（东南）· 卫浴（西北）
 */
export function defaultHome(): HomeState {
  seq = 0;
  return {
    v: 3,
    night: false,
    furniture: [
      // —— 客厅（中北）：电视墙 + 沙发对坐 ——
      F('rugRect', 0, -0.6, 0),
      F('tvStand', 0, -2.55, 0),
      F('tv', 0, -2.35, 0),
      F('speaker', -1.15, -2.5, 0),
      F('sofa', 0, 1.0, 2), // 面向北（电视）
      F('coffeeTable', 0, -0.75, 0),
      F('ottoman', 1.35, 0.9, 0),
      F('lampFloor', -1.9, 0.4, 0),
      F('plant', 1.95, -2.4, 0),
      F('books', -0.85, -0.7, 0),

      // —— 餐厨（东侧）——
      F('fridge', 3.9, -2.3, 3, { open: false }),
      F('stove', 3.05, -2.62, 0),
      F('sink', 3.05, -1.7, 2),
      F('diningTable', 3.1, 0.6, 0),
      F('chair', 2.35, 0.15, 1),
      F('chair', 3.85, 0.15, 3),
      F('trashcan', 4.1, 1.6, 0),

      // —— 卧室（西南）——
      F('bed', -2.9, 1.7, 1), // 床头朝西墙
      F('nightstand', -1.95, 0.9, 3),
      F('lampTable', -1.95, 0.35, 3, { on: false }),
      F('wardrobe', -2.5, -2.5, 0, { open: false }),
      F('bookcase', -3.9, -1.3, 1),

      // —— 洗衣角（东南）——
      F('washer', 3.85, 2.3, 3, { open: false }),
      F('box', 3.0, 2.5, 0, { open: false }),

      // —— 卫浴（西北）——
      F('bathtub', -3.6, -0.4, 1),
      F('toilet', -1.35, -2.6, 2),

      // —— 散落的可爱 ——
      F('bear', 0.65, 1.55, 3),
      F('doormat', -0.4, 2.6, 2),
      F('plantSmall', 2.0, 2.6, 0),
      F('radio', 1.35, -2.55, 0),
    ],
    chars: {
      me: { x: 0, z: 1.9, dir: 'up' },
      partner: { x: 0.8, z: 2.2, dir: 'left' },
    },
  };
}

// ---------------- 持久化（idb 缓存 + Prisma 服务端） ----------------

/** 本地缓存（含 coins/rev 的完整包） */
export interface HomePersist {
  home: HomeState;
  coins: number;
  rev: number;
}

const KEY = 'couple-home:state3d';
const API = '/api/couple-home';

const valid = (h: HomeState | null | undefined): h is HomeState =>
  !!h && (h as HomeState).v === 3 && Array.isArray(h.furniture) && !!h.chars?.me && !!h.chars?.partner;

/** 同步读缓存（首屏即时渲染；无则 null） */
export function loadCache(): HomePersist | null {
  const saved = kvGet<HomePersist>(KEY);
  if (saved && valid(saved.home)) return saved;
  return null;
}

/** 写缓存（节流） */
export function saveCache(p: HomePersist): void {
  kvSetDebounced(KEY, p);
}

/** 立即写缓存（重要节点：进出编辑模式等） */
export function saveCacheNow(p: HomePersist): void {
  kvSet(KEY, p);
}

/** 拉服务端档案；返回 null = 无档案（客户端播种默认布局） */
export async function fetchRemote(): Promise<HomePersist | null> {
  try {
    const res = await fetch(API, { headers: { 'X-Workspace-Id': getWorkspaceId() }, cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: HomeState | null; coins: number | null; rev: number };
    if (!valid(json.data)) return null;
    return { home: json.data, coins: json.coins ?? 0, rev: json.rev ?? 0 };
  } catch {
    return null;
  }
}

/** 推服务端（防抖由调用方控制）；409 冲突时返回服务端最新档案供采纳 */
export async function pushRemote(p: HomePersist): Promise<HomePersist | 'conflict-none' | 'conflict'> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': getWorkspaceId() },
      body: JSON.stringify({ data: p.home, coins: p.coins, rev: p.rev }),
    });
    if (res.status === 409) {
      const json = (await res.json()) as { data: HomeState | null; coins: number; rev: number };
      if (!valid(json.data)) return 'conflict-none';
      return { home: json.data, coins: json.coins, rev: json.rev };
    }
    if (!res.ok) return 'conflict-none';
    const json = (await res.json()) as { rev: number };
    return { home: p.home, coins: p.coins, rev: json.rev ?? p.rev };
  } catch {
    return 'conflict-none'; // 网络失败：保持本地，下次再推
  }
}

/** 重置：服务端删档 + 清本地缓存，返回默认包 */
export async function resetRemote(): Promise<HomePersist> {
  try {
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': getWorkspaceId() },
      body: JSON.stringify({ action: 'reset' }),
    });
  } catch {
    /* 离线也照样本地重置 */
  }
  const fresh: HomePersist = { home: defaultHome(), coins: 600, rev: 0 };
  kvSet(KEY, fresh);
  return fresh;
}

// ---------------- 金币规则 ----------------

/** playful 家具点击冷却（秒） */
export const PLAY_COOLDOWN = 3;
/** playful 点击奖励区间 */
export const PLAY_REWARD: [number, number] = [1, 2];
/** 洗衣完成收取奖励 */
export const WASH_REWARD = 8;
/** 初始金币 */
export const INIT_COINS = 600;
