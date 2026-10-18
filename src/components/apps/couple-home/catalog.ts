'use client';

/**
 * 情侣小家 —— 目录 / 默认布局 / 常量 / 持久化（Prisma + IndexedDB 双层）
 *
 * 素材：AI 生成「Adorable Home 式 2.5D 卡通写实」贴图（奶油+蜂蜜木色系），洋红抠图透明 PNG。
 * 贴图纵横比无需手写：容器宽固定、高由 img 自然比例撑开（CSS auto 高 + translateY(-100%) 锚底）。
 */

import { kvGet, kvSet, kvSetDebounced } from '@/lib/ios/idb-kv';
import { getWorkspaceId } from '@/lib/ios/workspace';
import type { ClothDef, FurnitureItem, HomeState } from './types';

// ---------------- 世界常量 ----------------

/** 世界宽（横向约 2.9 屏，滑动/跟随留足空间） */
export const WORLD_W = 1120;
/** 世界高（墙 + 进深很深的大开间：客厅/餐厨/卧室/洗衣角分区） */
export const WORLD_H = 1640;
/** 背景墙底边（含踢脚线）的世界 y；之下全是地板 */
export const WALL_BOTTOM = 300;
/** 小人行走区边界（地板内缩） */
export const WALK_MARGIN = 46;
/** 编辑模式拖拽网格吸附（世界 px） */
export const GRID = 16;
/** 小人显示高（世界 px） */
export const CHAR_H = 130;

// ---------------- 家具目录 ----------------

const IMG = (f: string) => `/home/furniture/${f}`;

/** 家具目录：kind → 静态配置（价格单位：金币） */
export const CATALOG: Record<string, import('./types').CatalogEntry> = {
  // ---- 沙发区 ----
  sofa: {
    kind: 'sofa', img: IMG('sofa.webp'), w: 250, name: '奶油双人沙发', cat: 'sofa', price: 300,
    acts: { playful: true },
    quips: ['窝在沙发里最舒服啦～', '一起看会儿电视？', '毯子还留着你的温度'],
  },
  sofaLong: {
    kind: 'sofaLong', img: IMG('sofaLong.webp'), w: 330, name: '奶油三人沙发', cat: 'sofa', price: 420,
    acts: { playful: true },
    quips: ['躺平～', '三人位我们的地盘', '中间的位置留给抱枕'],
  },
  pillow: {
    kind: 'pillow', img: IMG('pillow.webp'), w: 60, name: '爱心抱枕', cat: 'decor', price: 25,
    acts: { playful: true },
    quips: ['软乎乎', '打枕头战！', '抱着它看剧最舒服'],
  },
  // ---- 桌几 ----
  coffeeTable: {
    kind: 'coffeeTable', img: IMG('coffeeTable.webp'), w: 160, name: '原木茶几', cat: 'table', price: 120,
    acts: { playful: true },
    quips: ['两杯热可可还冒着气 ☕', '遥控器就在这儿～', '小心别踢到桌角'],
  },
  tableDining: {
    kind: 'tableDining', img: IMG('tableDining.webp'), w: 190, name: '双人餐桌', cat: 'table', price: 160,
    acts: { playful: true },
    quips: ['桌上的郁金香是你买的', '晚上一起吃火锅？', '烛光晚餐预定中'],
  },
  chair: {
    kind: 'chair', img: IMG('chair.webp'), w: 95, name: '软垫餐椅', cat: 'table', price: 45,
    acts: { playful: true },
    quips: ['拉开坐坐', '你先坐', '椅垫是新换的'],
  },
  sideTable: {
    kind: 'sideTable', img: IMG('sideTable.webp'), w: 110, name: '照片边几', cat: 'table', price: 80,
    acts: { playful: true },
    quips: ['相框里是那年海边', '抽屉里有小秘密', '咖啡杯还没收'],
  },
  nightstand: {
    kind: 'nightstand', img: IMG('nightstand.webp'), w: 110, name: '床头柜', cat: 'bed', price: 90,
    acts: { playful: true },
    quips: ['闹钟再睡五分钟', '柜里有睡前故事书', '放着一杯温水'],
  },
  // ---- 床品 ----
  bed: {
    kind: 'bed', img: IMG('bed.webp'), w: 310, name: '软软双人床', cat: 'bed', price: 450,
    acts: { playful: true },
    quips: ['被窝已预热 🔥', '今晚几点睡？', '枕头大战输的人铺床'],
  },
  // ---- 地毯 ----
  rug: {
    kind: 'rug', img: IMG('rug.webp'), w: 330, name: '粉粉圆地毯', cat: 'decor', price: 100,
    acts: { playful: true },
    quips: ['踩上去软软的', '光脚踩踩超舒服', '刚吸过尘哦'],
    zBias: -3000, flippable: false,
  },
  // ---- 影音 ----
  tvStand: {
    kind: 'tvStand', img: IMG('tvStand.webp'), w: 235, name: '原木电视柜', cat: 'table', price: 150,
    acts: { playful: true },
    quips: ['柜子里塞满了零食', '理线…算了明天再理', '遥控器八成又掉后面了'],
  },
  tv: {
    kind: 'tv', img: IMG('tv.webp'), w: 185, name: '智能电视', cat: 'appliance', price: 260,
    acts: { toggle: true }, glow: 240, emissive: 0.9, flippable: false,
  },
  recordPlayer: {
    kind: 'recordPlayer', img: IMG('recordPlayer.webp'), w: 115, name: '复古唱机', cat: 'appliance', price: 200,
    acts: { toggle: true }, glow: 120, emissive: 0.3,
    quips: [' ♪ 咔哒——放上一张黑胶'],
  },
  speaker: {
    kind: 'speaker', img: IMG('speaker.webp'), w: 75, name: '小音箱', cat: 'appliance', price: 90,
    acts: { playful: true },
    quips: ['低音炮轰隆隆', '连上蓝牙放歌吧', '今晚来点爵士？'],
  },
  // ---- 灯具 ----
  lampFloor: {
    kind: 'lampFloor', img: IMG('lampFloor.webp'), w: 100, name: '纸灯落地灯', cat: 'lamp', price: 110,
    acts: { toggle: true }, glow: 230, emissive: 0.85,
  },
  lampTable: {
    kind: 'lampTable', img: IMG('lampTable.webp'), w: 70, name: '蘑菇小台灯', cat: 'lamp', price: 70,
    acts: { toggle: true }, glow: 170, emissive: 0.8,
  },
  // ---- 植物/宠物/装饰 ----
  plantMonstera: {
    kind: 'plantMonstera', img: IMG('plantMonstera.webp'), w: 110, name: '龟背竹', cat: 'plant', price: 60,
    acts: { playful: true },
    quips: ['浇点水吧 💧', '它今天也很精神', '新叶子又展开一片'],
  },
  plantSmall: {
    kind: 'plantSmall', img: IMG('plantSmall.webp'), w: 60, name: '小多肉', cat: 'plant', price: 30,
    acts: { playful: true },
    quips: ['小小一盆超可爱', '晒晒太阳～', '它说今天也要加油'],
  },
  cat: {
    kind: 'cat', img: IMG('cat.webp'), w: 100, name: '橘猫「团团」', cat: 'decor', price: 500,
    acts: { playful: true },
    quips: ['喵呜～ 🐾', '呼噜呼噜…别吵醒它', '团团今天占了晒太阳位'],
  },
  books: {
    kind: 'books', img: IMG('books.webp'), w: 65, name: '书堆', cat: 'decor', price: 20,
    acts: { playful: true },
    quips: ['睡前读物～', '你折页角的习惯还没改', '下次去书展吧'],
  },
  box: {
    kind: 'box', img: IMG('box.webp'), imgOpen: IMG('boxOpen.webp'), w: 90, name: '收纳纸箱', cat: 'decor', price: 0,
    acts: { door: true },
  },
  trashcan: {
    kind: 'trashcan', img: IMG('trashcan.webp'), w: 65, name: '小垃圾桶', cat: 'decor', price: 20,
    acts: { playful: true },
    quips: ['今天也要垃圾分类', '咦，有张电影票根', '空的，很干净'],
  },
  // ---- 大家电 ----
  wardrobe: {
    kind: 'wardrobe', img: IMG('wardrobe.webp'), imgOpen: IMG('wardrobeOpen.webp'), w: 140, name: '双开门衣橱', cat: 'appliance', price: 320,
    acts: { door: true },
  },
  fridge: {
    kind: 'fridge', img: IMG('fridge.webp'), imgOpen: IMG('fridgeOpen.webp'), w: 130, name: '奶油小冰箱', cat: 'appliance', price: 380,
    acts: { door: true },
  },
  stove: {
    kind: 'stove', img: IMG('stove.webp'), w: 155, name: '复古灶台', cat: 'appliance', price: 300,
    acts: { playful: true },
    quips: ['今晚吃什么呢', '咕嘟咕嘟炖着汤', '刚擦过灶台'],
  },
  washer: {
    kind: 'washer', img: IMG('washer.webp'), w: 110, name: '滚筒洗衣机', cat: 'appliance', price: 350,
    acts: { washer: true },
  },
};

/** 商店分类 tab 配置（编辑模式底部栏） */
export const SHOP_TABS: { key: import('./types').FurnCategory; label: string; emoji: string }[] = [
  { key: 'all', label: '全部', emoji: '🏠' },
  { key: 'sofa', label: '沙发', emoji: '🛋️' },
  { key: 'table', label: '桌几', emoji: '🪑' },
  { key: 'bed', label: '床品', emoji: '🛏️' },
  { key: 'lamp', label: '灯具', emoji: '💡' },
  { key: 'plant', label: '植物', emoji: '🪴' },
  { key: 'appliance', label: '家电', emoji: '🧺' },
  { key: 'decor', label: '装饰', emoji: '🧸' },
];

// ---------------- 衣物目录 ----------------

export const CLOTHES: ClothDef[] = [
  { id: 'c1', emoji: '👕', name: '白T恤', color: '#e8ecef' },
  { id: 'c2', emoji: '👗', name: '碎花裙', color: '#f2b8c6' },
  { id: 'c3', emoji: '🧥', name: '牛仔外套', color: '#7d9bd1' },
  { id: 'c4', emoji: '🧶', name: '米色毛衣', color: '#e5d3b3' },
  { id: 'c5', emoji: '👖', name: '牛仔裤', color: '#6f87a8' },
  { id: 'c6', emoji: '🧣', name: '红围巾', color: '#e07a7a' },
  { id: 'c7', emoji: '👕', name: '条纹衫', color: '#b9d0cf' },
  { id: 'c8', emoji: '🩳', name: '运动短裤', color: '#a7b6d9' },
];

export const CLOTH_MAP: Record<string, ClothDef> = Object.fromEntries(CLOTHES.map((c) => [c.id, c]));

// ---------------- 默认布局 ----------------

let seq = 0;
const F = (
  kind: FurnitureItem['kind'],
  x: number,
  y: number,
  st: FurnitureItem['st'] = {},
  flip = false,
): FurnitureItem => ({ id: `${kind}-${++seq}`, kind, x, y, st, flip });

/** 初始大开间布局：客厅（中上）· 餐厨角（右上）· 卧室角（左下）· 洗衣角（右下） */
export function defaultHome(): HomeState {
  seq = 0;
  return {
    night: false,
    furniture: [
      // —— 客厅（中上）：电视墙 + 沙发对坐 ——
      F('tvStand', 430, 430),
      F('tv', 430, 386), // 电视摆在柜面上（y 略高于柜底线）
      F('speaker', 590, 436),
      F('rug', 430, 720),
      F('sofa', 430, 690),
      F('coffeeTable', 430, 540),
      F('pillow', 350, 640),
      F('lampFloor', 235, 500),
      F('recordPlayer', 240, 690),
      F('plantMonstera', 635, 490),

      // —— 餐厨角（右上）：冰箱+灶台贴墙，餐桌在其下方 ——
      F('fridge', 990, 430, { open: false }),
      F('stove', 855, 425),
      F('tableDining', 900, 650),
      F('chair', 805, 625),
      F('chair', 995, 675),
      F('trashcan', 1048, 780),

      // —— 卧室角（左下；整体右移避开摇杆遮挡区，世界 x<210 且靠下会被左下摇杆挡住）——
      F('bed', 340, 1280),
      F('nightstand', 190, 1170),
      F('lampTable', 190, 1120),
      F('wardrobe', 262, 1450, { open: false, clothes: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] }),
      F('books', 545, 1150),

      // —— 洗衣角（右下）——
      F('washer', 960, 1300, { open: false, clothes: [] }),
      F('box', 840, 1430, { open: false }),

      // —— 散落各处的可爱 ——
      F('cat', 630, 1450),
      F('plantSmall', 1010, 1000),
    ],
    chars: {
      me: { id: 'me', x: 560, y: 1020, dir: 'down' },
      partner: { id: 'partner', x: 650, y: 1070, dir: 'left' },
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

const KEY = 'couple-home:state';
const API = '/api/couple-home';

/** 同步读缓存（首屏即时渲染；无则 null） */
export function loadCache(): HomePersist | null {
  const saved = kvGet<HomePersist>(KEY);
  if (saved && Array.isArray(saved.home?.furniture) && saved.home.chars?.me && saved.home.chars?.partner) {
    return saved;
  }
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
    if (!json.data || !json.data.chars?.me || !json.data.chars?.partner) return null;
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
      if (!json.data) return 'conflict-none';
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
