'use client';

/**
 * 情侣小家 3D v5 —— 家具目录 / 默认布局 / 持久化（两室一厅）
 *
 * - 模型：Kenney Furniture Kit 2.0（CC0）白色系重着色（云白主体 + 浅灰/浅粉/浅黄/柔黑点缀，无木色）；
 * - MODEL_SCALE = 2.0：家具更饱满大气；fp 脚印 = 实测包围盒（含缩放）；
 * - 户型：客厅 9×6（北）+ 卧室 6×5（南），中间隔墙带门（点击开门后小人可走进卧室）；
 * - 新增：立体壁挂空调（客厅/卧室）/ 立式相框（手机上传照片，永久保存）/ 毛绒玩偶 / 梳妆台；
 * - 金币系统已移除（家具随便买随便摆）；
 * - 持久化：IndexedDB 即时缓存 + Prisma 服务端快照（rev 乐观并发）。
 */

import { kvGet, kvSet, kvSetDebounced } from '@/lib/ios/idb-kv';
import { getWorkspaceId } from '@/lib/ios/workspace';
import type { CatalogEntry, FurnitureItem, FurnitureKind, HomeState } from './types';

// ---------------- 世界常量 ----------------

/** 房间宽（米，x 轴） */
export const ROOM_W = 9;
/** 房间深（米，z 轴） */
export const ROOM_D = 6;
/** 墙高（米） */
export const WALL_H = 2.4;
/** 墙厚 */
export const WALL_T = 0.12;
/** 模型统一放大倍数（v4：比 v3 再大一档，更饱满大气） */
export const MODEL_SCALE = 2.0;
/** 编辑模式拖拽吸附（米） */
export const SNAP = 0.25;
/** 小人行走边界内缩 */
export const WALK_MARGIN = 0.4;
/** 小人身高（米） */
export const CHAR_H = 0.95;
/** 家具俯仰旋转上限（弧度，≈±60°） */
export const TILT_LIMIT = 1.05;

export const ROOM_X = ROOM_W / 2;
export const ROOM_Z = ROOM_D / 2;

// ---------------- 卧室（v5 两室一厅） ----------------

/** 卧室西缘（与客厅西墙齐平） */
export const BED_X0 = -ROOM_X;
/** 卧室东缘 */
export const BED_X1 = 1.5;
/** 卧室北缘（= 客厅南墙，隔墙所在） */
export const BED_Z0 = ROOM_Z;
/** 卧室南缘 */
export const BED_Z1 = BED_Z0 + 5;
export const BED_W = BED_X1 - BED_X0;
export const BED_D = BED_Z1 - BED_Z0;
/** 卧室门洞中心（在隔墙上） */
export const DOOR_X = -2.5;
/** 门洞宽（米） */
export const DOOR_W = 0.94;
/** 门洞高（米） */
export const DOOR_H = 2.06;
/** 门走廊半宽（小人穿门判定，比门洞略窄） */
export const DOOR_PASS = 0.3;

/** 家具在任意水平角下的占地 AABB（fp 未旋转脚印 × 旋转） */
export function footprintOf(entry: CatalogEntry, ry: number): [number, number] {
  const [w, d] = entry.fp;
  const c = Math.abs(Math.cos(ry));
  const s = Math.abs(Math.sin(ry));
  return [w * c + d * s, w * s + d * c];
}

/** 家具双房间钳制：z < 隔墙 → 客厅；z ≥ 隔墙 → 卧室（不许跨墙骑墙） */
export function clampFurnToRooms(x: number, z: number, hw: number, hd: number): [number, number] {
  if (z < BED_Z0) {
    return [
      Math.min(ROOM_X - hw, Math.max(-ROOM_X + hw, x)),
      Math.min(BED_Z0 - hd, Math.max(-ROOM_Z + hd, z)),
    ];
  }
  return [
    Math.min(BED_X1 - hw, Math.max(-ROOM_X + hw, x)),
    Math.min(BED_Z1 - hd, Math.max(BED_Z0 + hd, z)),
  ];
}

// ---------------- 家具目录 ----------------

const G = (f: string) => `/models/furniture/${f}.glb`;

/** 家具目录：kind → 静态配置（fp 为实测占地，单位米） */
export const CATALOG: Record<string, CatalogEntry> = {
  // ---- 沙发区 ----
  sofa: {
    kind: 'sofa', glb: G('sofa'), name: '云白双人沙发', cat: 'sofa', fp: [1.96, 0.82],
    acts: { playful: true },
  },
  sofaLong: {
    kind: 'sofaLong', glb: G('sofaLong'), name: '云白贵妃沙发', cat: 'sofa', fp: [1.96, 1.64],
    acts: { playful: true },
  },
  loungeChair: {
    kind: 'loungeChair', glb: G('loungeChair'), name: '米白休闲椅', cat: 'sofa', fp: [0.98, 1.35],
    acts: { playful: true },
  },
  ottoman: {
    kind: 'ottoman', glb: G('ottoman'), name: '软软脚凳', cat: 'sofa', fp: [0.88, 0.9],
    acts: { playful: true },
  },
  // ---- 桌几 ----
  coffeeTable: {
    kind: 'coffeeTable', glb: G('coffeeTable'), name: '云白茶几', cat: 'table', fp: [1.32, 0.8],
    acts: { playful: true },
  },
  diningTable: {
    kind: 'diningTable', glb: G('diningTable'), name: '圆脚餐桌', cat: 'table', fp: [1.39, 1.6],
    acts: { playful: true },
  },
  chair: {
    kind: 'chair', glb: G('chair'), name: '软垫椅', cat: 'table', fp: [0.4, 0.4],
    acts: { playful: true },
  },
  sideTable: {
    kind: 'sideTable', glb: G('sideTable'), name: '简约边桌', cat: 'table', fp: [1.07, 0.44],
    acts: { door: true },
  },
  desk: {
    kind: 'desk', glb: G('desk'), name: '简约书桌', cat: 'table', fp: [1.47, 0.78],
    acts: { playful: true },
  },
  // ---- 床品（卧室篇正式开放） ----
  bed: {
    kind: 'bed', glb: G('bed'), name: '粉白双人床', cat: 'bed', fp: [1.91, 2.25],
    acts: { playful: true },
  },
  bedSingle: {
    kind: 'bedSingle', glb: G('bedSingle'), name: '单人小床', cat: 'bed', fp: [1.14, 2.25],
    acts: { playful: true },
  },
  nightstand: {
    kind: 'nightstand', glb: G('nightstand'), name: '小抽屉床头柜', cat: 'bed', fp: [0.53, 0.43],
    acts: { door: true },
  },
  // ---- 地毯 ----
  rug: {
    kind: 'rug', glb: G('rug'), name: '浅粉圆地毯', cat: 'decor', fp: [1.84, 1.84],
    acts: { playful: true }, flat: true,
  },
  rugRect: {
    kind: 'rugRect', glb: G('rugRect'), name: '云白长地毯', cat: 'decor', fp: [3.14, 1.84],
    acts: { playful: true }, flat: true,
  },
  doormat: {
    kind: 'doormat', glb: G('doormat'), name: '进门地垫', cat: 'decor', fp: [0.86, 0.47],
    acts: { playful: true }, flat: true,
  },
  // ---- 影音 ----
  tvStand: {
    kind: 'tvStand', glb: G('tvStand'), name: '简约电视柜', cat: 'table',
    // 非均匀放大：原宽 1.6m 承不住 1.8m 大屏电视（用户反馈不适配），拉宽至 2.08m 微抬柜体
    scale: [1.3, 1.06, 1.0], fp: [2.08, 0.5],
    acts: { playful: true },
  },
  tv: {
    kind: 'tv', name: '高清大屏电视', cat: 'appliance', fp: [1.8, 0.15],
    acts: { toggle: true },
  },
  speaker: {
    kind: 'speaker', glb: G('speaker'), name: '落地音箱', cat: 'appliance', fp: [0.3, 0.3],
    acts: { playful: true },
  },
  radio: {
    kind: 'radio', glb: G('radio'), name: '复古收音机', cat: 'appliance', fp: [0.63, 0.2],
    acts: { toggle: true }, light: { y: 0.25, color: '#ffd9a0', intensity: 0.4 },
  },
  microwave: {
    kind: 'microwave', glb: G('microwave'), name: '小微波炉', cat: 'appliance', fp: [0.58, 0.46], hidden: true,
    acts: { playful: true },
  },
  toaster: {
    kind: 'toaster', glb: G('toaster'), name: '烤面包机', cat: 'appliance', fp: [0.38, 0.2], hidden: true,
    acts: { playful: true },
  },
  // ---- 灯具 ----
  lampFloor: {
    kind: 'lampFloor', glb: G('lampFloor'), name: '蘑菇落地灯', cat: 'lamp', fp: [0.3, 0.35],
    acts: { toggle: true }, light: { y: 1.5, color: '#ffd9a0', intensity: 1.2 },
  },
  lampTable: {
    kind: 'lampTable', glb: G('lampTable'), name: '蘑菇小台灯', cat: 'lamp', fp: [0.3, 0.35],
    acts: { toggle: true }, light: { y: 0.5, color: '#ffd9a0', intensity: 0.9 },
  },
  // ---- 植物 ----
  plant: {
    kind: 'plant', glb: G('plant'), name: '大盆绿植', cat: 'plant', fp: [0.42, 0.48],
    acts: { playful: true },
  },
  plantSmall: {
    kind: 'plantSmall', glb: G('plantSmall'), name: '小多肉', cat: 'plant', fp: [0.19, 0.19],
    acts: { playful: true },
  },
  // ---- 收纳 ----
  bookcase: {
    kind: 'bookcase', glb: G('bookcase'), name: '开放书架', cat: 'decor', fp: [0.8, 0.5],
    acts: { playful: true },
  },
  wardrobe: {
    kind: 'wardrobe', glb: G('wardrobe'), name: '双门衣柜', cat: 'decor', fp: [0.8, 0.5],
    acts: { door: true },
  },
  box: {
    kind: 'box', glb: G('box'), glbAlt: G('boxOpen'), name: '收纳纸箱', cat: 'decor', fp: [0.42, 0.42],
    acts: { door: true },
  },
  trashcan: {
    kind: 'trashcan', glb: G('trashcan'), name: '小垃圾桶', cat: 'decor', fp: [0.42, 0.47],
    acts: { playful: true },
  },
  // ---- 家电·空调（程序化建模，壁挂式；客厅/卧室东墙均适用） ----
  aircon: {
    kind: 'aircon', name: '立体壁挂空调', cat: 'appliance', fp: [0.92, 0.28],
    acts: { toggle: true },
  },
  // ---- 装饰·相框（程序化建模，点击上传照片） ----
  photoFrame: {
    kind: 'photoFrame', name: '立式相框', cat: 'decor', fp: [0.52, 0.3],
    acts: { photo: true },
  },
  // ---- 玩偶（程序化毛绒建模，点击弹跳） ----
  plushBunny: {
    kind: 'plushBunny', name: '毛绒兔玩偶', cat: 'decor', fp: [0.32, 0.32],
    acts: { playful: true },
  },
  plushDuck: {
    kind: 'plushDuck', name: '小黄鸭玩偶', cat: 'decor', fp: [0.28, 0.28],
    acts: { playful: true },
  },
  // ---- 家具·梳妆台（程序化建模：桌面 + 椭圆镜 + 小圆凳） ----
  vanity: {
    kind: 'vanity', name: '粉白梳妆台', cat: 'table', fp: [1.3, 0.95],
    acts: { playful: true },
  },
  books: {
    kind: 'books', glb: G('books'), name: '书堆', cat: 'decor', fp: [0.3, 0.19],
    acts: { playful: true },
  },
  coatRack: {
    kind: 'coatRack', glb: G('coatRack'), name: '衣帽架', cat: 'decor', fp: [0.55, 0.55],
    acts: { playful: true },
  },
  // ---- 厨卫家电（后续开放） ----
  fridge: {
    kind: 'fridge', glb: G('fridge'), name: '云白冰箱', cat: 'appliance', fp: [0.86, 0.58], hidden: true,
    acts: { door: true },
  },
  stove: {
    kind: 'stove', glb: G('stove'), name: '复古灶台', cat: 'appliance', fp: [0.86, 0.9], hidden: true,
    acts: { playful: true },
  },
  sink: {
    kind: 'sink', glb: G('sink'), name: '厨房水槽', cat: 'appliance', fp: [0.86, 0.9], hidden: true,
    acts: { door: true },
  },
  kitchenBar: {
    kind: 'kitchenBar', glb: G('kitchenBar'), name: '小吧台', cat: 'table', fp: [0.86, 0.42], hidden: true,
    acts: { playful: true },
  },
  washer: {
    kind: 'washer', glb: G('washer'), name: '滚筒洗衣机', cat: 'appliance', fp: [0.78, 0.78], hidden: true,
    acts: { door: true, washer: true },
  },
  bathtub: {
    kind: 'bathtub', glb: G('bathtub'), name: '泡泡浴缸', cat: 'bathroom', fp: [2.38, 1.12], hidden: true,
    acts: { playful: true },
  },
  toilet: {
    kind: 'toilet', glb: G('toilet'), name: '小白马桶', cat: 'bathroom', fp: [0.63, 0.95], hidden: true,
    acts: { playful: true },
  },
  // ---- 宠物 ----
  bear: {
    kind: 'bear', glb: G('bear'), name: '小熊「团团」', cat: 'decor', fp: [0.78, 0.49],
    acts: { playful: true },
  },
};

/** 商店分类 tab 配置（编辑模式底部栏；纯文字，无图标；客厅篇分类） */
export const SHOP_TABS: { key: import('./types').FurnCategory; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'sofa', label: '沙发' },
  { key: 'table', label: '桌几' },
  { key: 'lamp', label: '灯具' },
  { key: 'plant', label: '植物' },
  { key: 'appliance', label: '家电' },
  { key: 'decor', label: '装饰' },
];

// ---------------- 默认布局（完整客厅） ----------------

let seq = 0;
const F = (
  kind: FurnitureItem['kind'],
  x: number,
  z: number,
  opts: { ry?: number; y?: number } = {},
): FurnitureItem => ({
  id: `${kind}-${Date.now().toString(36)}-${++seq}`,
  kind,
  x,
  z,
  ry: opts.ry ?? 0,
  y: opts.y,
  st: {},
});

/**
 * 初始 v5 两室一厅：
 * 客厅：北墙电视墙 + 沙发对坐 + 西侧工作角 + 东壁空调 + 玄关（门在隔墙）
 * 卧室：双人床 + 床头柜×2 + 衣柜 + 梳妆台 + 卧室空调 + 玩偶×2 + 圆地毯绿植相框
 */
export function defaultHome(): HomeState {
  seq = 0;
  return {
    v: 5,
    night: false,
    win: [false, false, false, false, false],
    doorOpen: false,
    furniture: [
      // —— 客厅·电视墙（北） ——
      F('tvStand', 0, -2.7),
      F('tv', 0, -2.88, { y: 1.19 }), // 挂墙：屏幕底缘恰在电视柜顶上方
      F('speaker', -1.55, -2.72),
      F('speaker', 1.55, -2.72),
      F('bookcase', -2.7, -2.7),
      F('plant', 2.62, -2.62),

      // —— 客厅·中心 ——
      F('rugRect', 0.15, -0.3),
      F('coffeeTable', 0.15, -0.35),
      F('books', 0.55, -0.3, { y: 0.46, ry: 0.4 }), // 摆上茶几
      F('sofa', 0.15, 1.35, { ry: Math.PI }), // 面向北（电视）
      F('loungeChair', 2.05, -0.2, { ry: -2.35 }), // 斜角面向电视
      F('ottoman', -1.5, 0.45),
      F('sideTable', 2.15, 1.2, { ry: -Math.PI / 2 }),
      F('lampTable', 2.28, 1.0, { y: 0.77 }), // 摆上边桌
      F('plantSmall', 1.98, 1.55, { y: 0.77 }), // 摆上边桌
      F('lampFloor', -1.95, 2.0),

      // —— 客厅·工作角（西） ——
      F('desk', -3.95, 0.3, { ry: Math.PI / 2 }),
      F('chair', -3.15, 0.3, { ry: -Math.PI / 2 }),
      F('radio', -3.9, 0.1, { y: 0.77, ry: Math.PI / 2 }), // 摆上书桌

      // —— 客厅·空调（东壁挂）+ 玄关（南，门旁） ——
      F('aircon', 4.34, -1.6, { y: 1.85, ry: -Math.PI / 2 }),
      F('photoFrame', 3.4, 2.45, { ry: Math.PI }), // 立式相框（东南角，不挡去卧室的门路）
      F('bear', 1.45, 2.35, { ry: -2.6 }),
      F('doormat', DOOR_X, 2.62),
      F('coatRack', -3.55, 2.5),
      F('trashcan', -3.62, -2.58),

      // —— 卧室（隔墙南侧，推门而入；家具齐备） ——
      F('bed', -3.32, 5.6, { ry: -Math.PI / 2 }), // 双人床靠西墙（床头朝西）
      F('plushBunny', -2.62, 5.12, { y: 0.42, ry: -2.3 }), // 毛绒兔坐在床上
      F('nightstand', -3.4, 4.25),
      F('plushDuck', -3.4, 4.25, { y: 0.53, ry: 0.5 }), // 小黄鸭摆上床头柜
      F('nightstand', -3.4, 6.95),
      F('lampTable', -3.4, 6.95, { y: 0.56 }), // 床头灯
      F('wardrobe', 0.95, 3.35), // 衣柜靠卧室北墙（隔墙）
      F('vanity', 0.95, 7.5, { ry: Math.PI }), // 梳妆台靠卧室南墙（凳子朝北）
      F('aircon', 1.4, 5.6, { y: 1.85, ry: -Math.PI / 2 }), // 卧室东壁空调
      F('lampFloor', -4.05, 7.3), // 卧室角落落地灯
      F('rug', -0.9, 5.5), // 圆地毯
      F('plant', -0.35, 7.55),
      F('photoFrame', -1.7, 7.45, { ry: Math.PI }), // 卧室相框
    ],
    chars: {
      me: { x: 0.15, z: 2.3, dir: 'up' },
      partner: { x: -0.9, z: 2.1, dir: 'right' },
    },
  };
}

// ---------------- 持久化（idb 缓存 + Prisma 服务端） ----------------

/** 本地缓存（含 rev 的完整包） */
export interface HomePersist {
  home: HomeState;
  rev: number;
}

const KEY = 'couple-home:state3d';
const API = '/api/couple-home';

const valid = (h: HomeState | null | undefined): h is HomeState =>
  !!h && (h as HomeState).v === 5 && Array.isArray(h.furniture) && !!h.chars?.me && !!h.chars?.partner;

// ---------------- v5.1 卧室家具补全迁移（老档案增量补插，不动用户已有布置） ----------------

/** 某个落点附近是否已有落地家具占位（flat 地毯/抬升摆件不算） */
function spotBusy(furn: FurnitureItem[], x: number, z: number, r = 0.55): boolean {
  return furn.some((f) => {
    const e = CATALOG[f.kind];
    if (!e || e.flat || (f.y ?? 0) > 0.45) return false;
    return Math.abs(f.x - x) < r && Math.abs(f.z - z) < r;
  });
}

let migSeq = 0;

/**
 * v5.1 卧室家具补全：老档案缺新家具（毛绒兔/小黄鸭/梳妆台/卧室空调/卧室落地灯）时
 * 按默认布局补插 —— 玩偶跟随床/床头柜的实际位置，其余在落点空闲时才补；幂等，可反复调用。
 */
export function migrateBedroomV51(h: HomeState): HomeState {
  if (!h || h.v !== 5 || !Array.isArray(h.furniture)) return h;
  const furn = h.furniture.slice();
  const stamp = Date.now().toString(36);
  const add = (kind: FurnitureKind, x: number, z: number, y?: number, ry?: number) =>
    furn.push({ id: `${kind}-mig-${stamp}-${++migSeq}`, kind, x, z, y, ry, st: {} });

  const kinds = new Set(furn.map((f) => f.kind));
  const inBedroom = (kind: string) => furn.some((f) => f.kind === kind && f.z >= BED_Z0 - 0.1);

  // 毛绒兔坐在床上（跟随床的位置与朝向；没有床就放地毯边）
  if (!kinds.has('plushBunny')) {
    const bed = furn.find((f) => f.kind === 'bed');
    if (bed) {
      // 默认：床 ry=-π/2、兔偏移 (+0.70, -0.48)；按用户床的实际朝向旋转变换偏移
      const a = (bed.ry ?? 0) + Math.PI / 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      add('plushBunny', bed.x + 0.7 * c - 0.48 * s, bed.z - 0.7 * s - 0.48 * c, 0.42, (bed.ry ?? 0) - 0.8);
    } else if (!spotBusy(furn, -0.2, 5.6, 0.4)) {
      add('plushBunny', -0.2, 5.6, 0, -2.3);
    }
  }
  // 小黄鸭摆上床头柜（跟随第一只床头柜实际位置）
  if (!kinds.has('plushDuck')) {
    const ns = furn.find((f) => f.kind === 'nightstand');
    if (ns) add('plushDuck', ns.x, ns.z, 0.53, 0.5);
  }
  // 梳妆台（卧室南墙东侧）：老档案的绿植常占着这个位（旧默认 (1.0,7.4)）→ 让位到新默认点再补
  if (!kinds.has('vanity')) {
    if (!spotBusy(furn, 0.95, 7.5, 0.85)) {
      add('vanity', 0.95, 7.5, 0, Math.PI);
    } else {
      const blocker = furn.find(
        (f) => f.kind === 'plant' && f.z >= BED_Z0 && Math.abs(f.x - 0.95) < 0.85 && Math.abs(f.z - 7.5) < 0.85 && (f.y ?? 0) <= 0.45,
      );
      if (blocker && !spotBusy(furn.filter((f) => f !== blocker), -0.35, 7.55, 0.6)) {
        blocker.x = -0.35;
        blocker.z = 7.55;
        add('vanity', 0.95, 7.5, 0, Math.PI);
      }
    }
  }
  // 卧室空调（全屋只有一台且卧室没有 → 补到卧室东墙）
  if (furn.filter((f) => f.kind === 'aircon').length === 1 && !inBedroom('aircon')) {
    add('aircon', 1.4, 5.6, 1.85, -Math.PI / 2);
  }
  // 卧室落地灯（西南角，空闲才补）
  if (!inBedroom('lampFloor') && !spotBusy(furn, -4.05, 7.3, 0.5)) add('lampFloor', -4.05, 7.3, 0, 0);

  if (furn.length === h.furniture.length) return h;
  return { ...h, furniture: furn };
}

/** 同步读缓存（首屏即时渲染；无则 null） */
export function loadCache(): HomePersist | null {
  const saved = kvGet<HomePersist>(KEY);
  if (saved && valid(saved.home)) return { ...saved, home: migrateBedroomV51(saved.home) };
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
    const json = (await res.json()) as { data: HomeState | null; rev: number };
    if (!valid(json.data)) return null;
    return { home: migrateBedroomV51(json.data), rev: json.rev ?? 0 };
  } catch {
    return null;
  }
}

/** 推送结果：成功（新 rev）/ 冲突（带服务端最新供采纳）/ 离线或服务端异常（保持本地稍后重试） */
export type PushResult = HomePersist | 'offline' | { conflict: HomePersist };

/** 推服务端（防抖由调用方控制）；409 冲突时返回服务端最新档案供采纳 */
export async function pushRemote(p: HomePersist): Promise<PushResult> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': getWorkspaceId() },
      body: JSON.stringify({ data: p.home, rev: p.rev }),
    });
    if (res.status === 409) {
      const json = (await res.json()) as { data: HomeState | null; rev: number };
      if (!valid(json.data)) return 'offline';
      return { conflict: { home: json.data, rev: json.rev } };
    }
    if (!res.ok) return 'offline';
    const json = (await res.json()) as { rev: number };
    return { home: p.home, rev: json.rev ?? p.rev };
  } catch {
    return 'offline'; // 网络失败：保持本地，下次再推
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
  const fresh: HomePersist = { home: defaultHome(), rev: 0 };
  kvSet(KEY, fresh);
  return fresh;
}

// ---------------- 交互节奏 ----------------

/** playful 家具点击弹跳冷却（秒） */
export const PLAY_COOLDOWN = 3;
