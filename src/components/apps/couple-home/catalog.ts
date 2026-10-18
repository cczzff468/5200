'use client';

/**
 * 情侣小家（客厅篇）—— 家具目录 / 衣物目录 / 默认布局 / 常量
 *
 * 贴图全部来自 Kenney（CC0 公共领域，可免费商用）：
 *   - 家具：Furniture Kit（Topdown）
 *   - 小人：Toon Characters（Male/Female person）
 * 小尺寸原版贴图 + CSS 放大 + image-rendering: pixelated = 经典 Kenney 像素卡通风。
 */

import { kvGet, kvSetDebounced } from '@/lib/ios/idb-kv';
import type { CatalogEntry, ClothDef, FurnitureItem, HomeState } from './types';

// ---------------- 世界常量 ----------------

/** 世界（房间）尺寸：横向约 2.6 屏、纵向约 1.9 屏，留足滑动/跟随空间 */
export const WORLD_W = 1080;
export const WORLD_H = 1400;
/** 墙厚（顶墙 + 左右墙），房间地板可行走区 */
export const WALL = 44;
/** 顶部墙条更高（有墙裙视觉） */
export const WALL_TOP = 96;
/** 小人活动范围（地板区内再留一点边距） */
export const WALK_MARGIN = 14;

/** 家具拖拽网格吸附（世界 px） */
export const GRID = 16;

/** 小人显示高度（贴图 96x128，显示 92 高即可，宽按比例） */
export const CHAR_H = 96;

/** 贴图统一缩放倍率（Kenney 原图很小，放大保持像素锐利） */
export const PIX = 'pixelated' as const;

// ---------------- 家具目录 ----------------

/** 家具目录：kind → 静态配置 */
export const CATALOG: Record<string, CatalogEntry> = {
  sofa: {
    kind: 'sofa',
    img: '/home/furniture/loungeSofa.png',
    w: 151,
    name: '双人沙发',
    acts: { playful: true },
    quips: ['窝在沙发里最舒服啦～', '一起看会儿电视？', '沙发上还有咱俩的位置'],
  },
  sofaLong: {
    kind: 'sofaLong',
    img: '/home/furniture/loungeSofaLong.png',
    w: 196,
    name: '长沙发',
    acts: { playful: true },
    quips: ['躺平～', '长沙发是我们的地盘', '再铺条毯子就完美了'],
  },
  coffeeTable: {
    kind: 'coffeeTable',
    img: '/home/furniture/tableCoffee.png',
    w: 101,
    name: '茶几',
    acts: { playful: true },
    quips: ['茶几上放着两杯热可可 ☕', '遥控器就在这儿～', '小心别踢到桌角'],
  },
  rug: {
    kind: 'rug',
    img: '/home/furniture/rugRectangle.png',
    w: 242,
    name: '地毯',
    acts: { playful: true },
    quips: ['踩上去软软的', '地毯很干净哦', '光脚踩踩超舒服'],
    zBias: -2000,
  },
  tvCabinet: {
    kind: 'tvCabinet',
    img: '/home/furniture/cabinetTelevision.png',
    w: 158,
    name: '电视柜',
    acts: { playful: true },
    quips: ['柜子里塞满了零食', '理理线…算了', '遥控器八成又掉后面了'],
  },
  tv: {
    kind: 'tv',
    img: '/home/furniture/televisionModern.png',
    w: 106,
    name: '电视',
    acts: { toggle: true },
  },
  lampRound: {
    kind: 'lampRound',
    img: '/home/furniture/lampRoundFloor.png',
    w: 38,
    name: '落地灯',
    acts: { toggle: true },
    glow: 210,
  },
  lampSquare: {
    kind: 'lampSquare',
    img: '/home/furniture/lampSquareFloor.png',
    w: 38,
    name: '落地灯',
    acts: { toggle: true },
    glow: 210,
  },
  wardrobe: {
    kind: 'wardrobe',
    img: '/home/furniture/bookcaseClosedDoors.png',
    imgOpen: '/home/furniture/bookcaseOpen.png',
    w: 62,
    name: '衣橱',
    acts: { door: true },
  },
  washer: {
    kind: 'washer',
    img: '/home/furniture/washer.png',
    w: 62,
    name: '洗衣机',
    acts: { washer: true },
  },
  fridge: {
    kind: 'fridge',
    img: '/home/furniture/kitchenFridge.png',
    w: 67,
    name: '冰箱',
    acts: { playful: true },
    quips: ['咕嘟咕嘟…有冰淇淋！', '冰箱贴是我们的合照', '拿瓶冰可乐？'],
  },
  plant: {
    kind: 'plant',
    img: '/home/furniture/pottedPlant.png',
    w: 39,
    name: '绿植',
    acts: { playful: true },
    quips: ['浇点水吧 💧', '它今天也很精神', '叶子又长新芽了'],
  },
  plantSmall: {
    kind: 'plantSmall',
    img: '/home/furniture/plantSmall1.png',
    w: 33,
    name: '小盆栽',
    acts: { playful: true },
    quips: ['小小一盆超可爱', '晒晒太阳～', '它说今天也要加油'],
  },
  speaker: {
    kind: 'speaker',
    img: '/home/furniture/speakerSmall.png',
    w: 42,
    name: '音箱',
    acts: { playful: true },
    quips: ['放首我们喜欢的歌 🎵', '低音炮轰隆隆', '今晚来点爵士？'],
  },
  sideTable: {
    kind: 'sideTable',
    img: '/home/furniture/sideTableDrawers.png',
    w: 58,
    name: '边柜',
    acts: { playful: true },
    quips: ['抽屉里有小秘密', '摆着我们的合照相框', '杂物收纳担当'],
  },
  trashcan: {
    kind: 'trashcan',
    img: '/home/furniture/trashcan.png',
    w: 36,
    name: '垃圾桶',
    acts: { playful: true },
    quips: ['今天也要垃圾分类', '咦，有张电影票根', '空的，很干净'],
  },
  tableRound: {
    kind: 'tableRound',
    img: '/home/furniture/tableRound.png',
    w: 82,
    name: '圆桌',
    acts: { playful: true },
    quips: ['桌上的花是你买的', '晚上一起吃火锅？', '作业…啊不，工作还没做完'],
  },
  chair: {
    kind: 'chair',
    img: '/home/furniture/chairRounded.png',
    w: 46,
    name: '椅子',
    acts: { playful: true },
    quips: ['拉开坐坐', '你先坐', '椅子腿有点晃'],
  },
  box: {
    kind: 'box',
    img: '/home/furniture/cardboardBoxClosed.png',
    imgOpen: '/home/furniture/cardboardBoxOpen.png',
    w: 50,
    name: '纸箱',
    acts: { door: true },
  },
  books: {
    kind: 'books',
    img: '/home/furniture/books.png',
    w: 41,
    name: '书堆',
    acts: { playful: true },
    quips: ['睡前读物～', '你折页角的习惯还没改', '下次去书展吧'],
  },
  pillow: {
    kind: 'pillow',
    img: '/home/furniture/pillow.png',
    w: 36,
    name: '抱枕',
    acts: { playful: true },
    quips: ['软乎乎', '打枕头战！', '抱着它看剧最舒服'],
  },
};

// ---------------- 衣物目录 ----------------

/** 衣物目录（衣橱/洗衣机共用；emoji 徽章直观呈现） */
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

export const CLOTH_MAP: Record<string, ClothDef> = Object.fromEntries(
  CLOTHES.map((c) => [c.id, c]),
);

// ---------------- 默认布局（客厅） ----------------

let seq = 0;
const F = (
  kind: FurnitureItem['kind'],
  x: number,
  y: number,
  st: FurnitureItem['st'] = {},
): FurnitureItem => ({ id: `${kind}-${++seq}`, kind, x, y, st });

/** 初始客厅布局（首次进入写入 idb；之后完全跟随用户拖拽后的位置） */
export function defaultHome(): HomeState {
  seq = 0;
  return {
    night: false,
    furniture: [
      // 顶墙一排：电视柜 + 电视 + 音箱 + 冰箱
      F('tvCabinet', 460, 130),
      F('tv', 460, 122),
      F('speaker', 620, 118),
      F('fridge', 960, 170),
      // 沙发区（上中部）：长沙发 + 单人沙发 + 茶几 + 地毯（贴地 zBias 压底）
      F('rug', 470, 420, {}),
      F('sofaLong', 380, 268),
      F('sofa', 705, 280),
      F('coffeeTable', 470, 420),
      F('pillow', 350, 320),
      // 左墙：衣橱 + 洗衣机
      F('wardrobe', 88, 430, { open: false, clothes: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] }),
      F('washer', 92, 640, { open: false, clothes: [] }),
      // 右侧：绿植 + 垃圾桶
      F('plant', 996, 400),
      F('plantSmall', 1000, 640),
      F('trashcan', 990, 540),
      // 中下：圆桌 + 椅子 x2
      F('tableRound', 560, 760),
      F('chair', 480, 740),
      F('chair', 640, 780),
      // 右下：边柜 + 书堆 + 盆栽
      F('sideTable', 940, 950),
      F('books', 250, 980),
      F('box', 180, 1160, { open: false }),
      F('lampRound', 210, 230),
      F('lampSquare', 900, 300),
    ],
    chars: {
      me: { id: 'me', x: 520, y: 900, dir: 'left' },
      partner: { id: 'partner', x: 610, y: 960, dir: 'right' },
    },
  };
}

/** 家具显示高度（按贴图纵横比推算；导入尺寸表） */
export const IMG_SIZE: Record<string, { w: number; h: number }> = {
  'loungeSofa.png': { w: 63, h: 27 },
  'loungeSofaLong.png': { w: 80, h: 27 },
  'tableCoffee.png': { w: 42, h: 26 },
  'rugRectangle.png': { w: 101, h: 59 },
  'cabinetTelevision.png': { w: 64, h: 20 },
  'televisionModern.png': { w: 44, h: 9 },
  'lampRoundFloor.png': { w: 10, h: 12 },
  'lampSquareFloor.png': { w: 10, h: 12 },
  'bookcaseClosedDoors.png': { w: 26, h: 16 },
  'bookcaseOpen.png': { w: 26, h: 16 },
  'washer.png': { w: 25, h: 26 },
  'kitchenFridge.png': { w: 28, h: 20 },
  'pottedPlant.png': { w: 13, h: 15 },
  'plantSmall1.png': { w: 11, h: 13 },
  'speakerSmall.png': { w: 16, h: 21 },
  'sideTableDrawers.png': { w: 23, h: 22 },
  'trashcan.png': { w: 14, h: 19 },
  'tableRound.png': { w: 32, h: 31 },
  'chairRounded.png': { w: 18, h: 18 },
  'cardboardBoxClosed.png': { w: 20, h: 20 },
  'cardboardBoxOpen.png': { w: 20, h: 20 },
  'books.png': { w: 17, h: 9 },
  'pillow.png': { w: 15, h: 15 },
};

/** 由 kind 取显示尺寸 {w, h}（世界 px） */
export function furnSize(kind: string): { w: number; h: number } {
  const c = CATALOG[kind];
  const key = c.img.split('/').pop() ?? '';
  const raw = IMG_SIZE[key] ?? { w: 40, h: 40 };
  const scale = c.w / raw.w;
  return { w: c.w, h: Math.round(raw.h * scale) };
}

/** 家具占位矩形（碰撞/点击热区用；以 (x,y)=底部中心，向上展开） */
export function furnRect(f: FurnitureItem): { x: number; y: number; w: number; h: number } {
  const { w, h } = furnSize(f.kind);
  return { x: f.x - w / 2, y: f.y - h, w, h };
}

// ---------------- 持久化 ----------------

const KEY = 'couple-home:state';

export function loadHome(): HomeState {
  const saved = kvGet<HomeState>(KEY);
  if (saved && Array.isArray(saved.furniture) && saved.chars?.me && saved.chars?.partner) {
    return saved;
  }
  const fresh = defaultHome();
  kvSetDebounced(KEY, fresh);
  return fresh;
}

export function saveHome(s: HomeState): void {
  kvSetDebounced(KEY, s);
}
