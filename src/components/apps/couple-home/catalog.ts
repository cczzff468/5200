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
import type { CatalogEntry, FurnitureItem, FurnitureKind, HomeState, RoomId } from './types';

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

// ---------------- 厨房（v5.2 第三房间：卧室东侧） ----------------

/** 厨房西缘（= 卧室东墙，共墙） */
export const KTCH_X0 = BED_X1;
/** 厨房东缘 */
export const KTCH_X1 = 7.5;
/** 厨房北缘（= 客厅南墙延长线，带门洞通客厅） */
export const KTCH_Z0 = ROOM_Z;
/** 厨房南缘（= 卧室南墙齐平） */
export const KTCH_Z1 = BED_Z1;
export const KTCH_W = KTCH_X1 - KTCH_X0;
/** 厨房门洞中心（在厨房北墙上） */
export const KDOOR_X = 2.9;

// ---------------- 卫生间（v5.4：客厅东侧，推门而入） ----------------

/** 卫生间西缘（= 客厅东墙，共墙带门） */
export const BATH_X0 = ROOM_X;
/** 卫生间东缘 */
export const BATH_X1 = 8.5;
/** 卫生间北缘（= 客厅北墙延长线） */
export const BATH_Z0 = -ROOM_Z;
/** 卫生间南缘（= 客厅南墙延长线 / 厨房东侧延长） */
export const BATH_Z1 = ROOM_Z;
export const BATH_W = BATH_X1 - BATH_X0;
export const BATH_D = BATH_Z1 - BATH_Z0;
/** 卫生间门洞中心（在客厅东墙上，沿 z 滑动） */
export const BDOOR_Z = 0.3;

/** 四房间归属：客厅东墙以东且北排=卫生间；z<隔墙=客厅；隔墙南、卧室东墙西=卧室；再东=厨房 */
export function roomAt(x: number, z: number): RoomId {
  if (z < BED_Z0) return x >= BATH_X0 ? 'ba' : 'lr';
  if (x < BED_X1) return 'br';
  return 'kt';
}

/** 各房间随机落点范围（x0,x1,z0,z1，已内缩防贴墙） */
export const ROOM_SPANS: Record<RoomId, [number, number, number, number]> = {
  lr: [-ROOM_X + 0.5, ROOM_X - 0.5, -ROOM_Z + 0.5, BED_Z0 - 0.5],
  br: [-ROOM_X + 0.5, BED_X1 - 0.5, BED_Z0 + 0.5, BED_Z1 - 0.5],
  kt: [BED_X1 + 0.5, KTCH_X1 - 0.5, BED_Z0 + 0.5, BED_Z1 - 0.5],
  ba: [BATH_X0 + 0.5, BATH_X1 - 0.5, BATH_Z0 + 0.5, BATH_Z1 - 0.5],
};

export const ROOM_NAMES: Record<RoomId, string> = { lr: '客厅', br: '卧室', kt: '厨房', ba: '卫生间' };

/** 家具在任意水平角下的占地 AABB（fp 未旋转脚印 × 旋转） */
export function footprintOf(entry: CatalogEntry, ry: number): [number, number] {
  const [w, d] = entry.fp;
  const c = Math.abs(Math.cos(ry));
  const s = Math.abs(Math.sin(ry));
  return [w * c + d * s, w * s + d * c];
}

/** 家具四房间钳制：客厅/卧室/厨房/卫生间，不许骑墙 */
export function clampFurnToRooms(x: number, z: number, hw: number, hd: number): [number, number] {
  if (z < BED_Z0) {
    if (x >= BATH_X0) {
      // 卫生间（北排东段）
      return [
        Math.min(BATH_X1 - hw, Math.max(BATH_X0 + hw, x)),
        Math.min(BATH_Z1 - hd, Math.max(BATH_Z0 + hd, z)),
      ];
    }
    // 客厅
    return [
      Math.min(BATH_X0 - hw, Math.max(-ROOM_X + hw, x)),
      Math.min(BED_Z0 - hd, Math.max(-ROOM_Z + hd, z)),
    ];
  }
  if (x < BED_X1) {
    // 卧室
    return [
      Math.min(BED_X1 - hw, Math.max(-ROOM_X + hw, x)),
      Math.min(BED_Z1 - hd, Math.max(BED_Z0 + hd, z)),
    ];
  }
  // 厨房
  return [
    Math.min(KTCH_X1 - hw, Math.max(BED_X1 + hw, x)),
    Math.min(BED_Z1 - hd, Math.max(BED_Z0 + hd, z)),
  ];
}

// ---------------- 挂墙槽位（相框/电视等自动贴墙） ----------------

/** 一段可用墙面：axis='z' 墙沿 x 走（frame z=at，x 在 from~to）；axis='x' 反之 */
export interface WallSlot {
  room: RoomId;
  axis: 'x' | 'z';
  /** 挂件基准面（内墙脸 + 0.07 缝隙） */
  at: number;
  from: number;
  to: number;
  /** 朝向（面向屋内） */
  ry: number;
  /** 该墙上窗户/门洞的沿墙区间（高挂件避让） */
  avoid?: [number, number][];
}

/** 全屋可用墙面（avoid = 该墙上窗户/门洞的沿墙区间，高挂件避让） */
export const WALL_SLOTS: WallSlot[] = [
  // 客厅
  { room: 'lr', axis: 'z', at: -ROOM_Z + 0.07, from: -4.0, to: 4.0, ry: 0, avoid: [[-3.05, -1.35], [1.35, 3.05]] },
  { room: 'lr', axis: 'x', at: -ROOM_X + 0.07, from: -2.6, to: 2.6, ry: Math.PI / 2, avoid: [[-2.45, -0.75]] },
  { room: 'lr', axis: 'x', at: ROOM_X - 0.07, from: -2.6, to: 2.6, ry: -Math.PI / 2 },
  { room: 'lr', axis: 'z', at: BED_Z0 - 0.07, from: -1.5, to: 1.9, ry: Math.PI },
  // 卧室
  { room: 'br', axis: 'x', at: -ROOM_X + 0.07, from: 3.3, to: 4.5, ry: Math.PI / 2 },
  { room: 'br', axis: 'x', at: BED_X1 - 0.07, from: 3.5, to: 7.5, ry: -Math.PI / 2 },
  { room: 'br', axis: 'z', at: BED_Z1 - 0.07, from: -4.0, to: 0.9, ry: Math.PI, avoid: [[-2.05, -0.35]] },
  // 厨房（北墙避开门洞与灶台区）
  { room: 'kt', axis: 'z', at: BED_Z0 + 0.19, from: 3.7, to: 7.1, ry: 0 },
  { room: 'kt', axis: 'x', at: KTCH_X1 - 0.07, from: 3.5, to: 7.5, ry: -Math.PI / 2, avoid: [[4.55, 6.25], [6.35, 7.65]] },
  { room: 'kt', axis: 'z', at: BED_Z1 - 0.07, from: 1.9, to: 7.1, ry: Math.PI, avoid: [[3.75, 5.45]] },
  // 卫生间（v5.4：客厅东侧；北墙避窗、东墙避窗）
  { room: 'ba', axis: 'z', at: BATH_Z0 + 0.07, from: 4.9, to: 8.1, ry: 0, avoid: [[5.58, 7.22]] },
  { room: 'ba', axis: 'x', at: BATH_X1 - 0.07, from: -2.5, to: 2.5, ry: -Math.PI / 2, avoid: [[0.38, 2.02]] },
  { room: 'ba', axis: 'z', at: BATH_Z1 - 0.07, from: 4.9, to: 8.1, ry: Math.PI },
];

/** 找离 (x,z) 最近的挂墙槽位并投影到墙上（返回槽位 + 贴墙坐标） */
export function snapToWallSlot(
  x: number,
  z: number,
  room?: RoomId,
): { slot: WallSlot; x: number; z: number } {
  let best: { slot: WallSlot; x: number; z: number } | null = null;
  let bd = Infinity;
  for (const s of WALL_SLOTS) {
    if (room && s.room !== room) continue;
    const along = s.axis === 'z' ? x : z;
    const a = Math.max(s.from, Math.min(s.to, along));
    const px = s.axis === 'z' ? a : s.at;
    const pz = s.axis === 'z' ? s.at : a;
    const d = Math.hypot(px - x, pz - z);
    if (d < bd) {
      bd = d;
      best = { slot: s, x: px, z: pz };
    }
  }
  const s = best?.slot ?? WALL_SLOTS[0];
  const a = Math.max(s.from, Math.min(s.to, s.axis === 'z' ? x : z));
  return { slot: s, x: s.axis === 'z' ? a : s.at, z: s.axis === 'z' ? s.at : a };
}

// ---------------- 窗户 / 门（数据驱动：可选中、沿墙滑行） ----------------

/** 单扇窗定义：axis = 墙走向（'z' 墙沿 x 走），at = 墙内脸坐标，side = 窗组偏离内脸方向 */
export interface WinDef {
  room: RoomId;
  axis: 'x' | 'z';
  at: number;
  side: 1 | -1;
  ry: number;
  /** 默认沿墙坐标 */
  def: number;
  /** 沿墙可滑动范围 */
  min: number;
  max: number;
}

/** 九扇上悬窗（客厅北×2 / 客厅西 / 卧室西 / 卧室南 / 厨房东 / 厨房南 / 卫生间北 / 卫生间东） */
export const WINS: WinDef[] = [
  { room: 'lr', axis: 'z', at: -ROOM_Z, side: 1, ry: 0, def: -2.2, min: -3.6, max: 3.6 },
  { room: 'lr', axis: 'z', at: -ROOM_Z, side: 1, ry: 0, def: 2.2, min: -3.6, max: 3.6 },
  { room: 'lr', axis: 'x', at: -ROOM_X, side: 1, ry: Math.PI / 2, def: -1.6, min: -2.2, max: 2.2 },
  { room: 'br', axis: 'x', at: -ROOM_X, side: 1, ry: Math.PI / 2, def: 5.2, min: 3.7, max: 7.3 },
  { room: 'br', axis: 'z', at: BED_Z1, side: -1, ry: Math.PI, def: -1.2, min: -3.6, max: 0.8 },
  { room: 'kt', axis: 'x', at: KTCH_X1, side: -1, ry: -Math.PI / 2, def: 5.4, min: 3.7, max: 7.3 },
  { room: 'kt', axis: 'z', at: BED_Z1, side: -1, ry: Math.PI, def: 4.6, min: 2.4, max: 7.3 },
  // 卫生间（v5.4：客厅东侧；北窗在浴缸上方、东窗在马桶区上方）
  { room: 'ba', axis: 'z', at: BATH_Z0, side: 1, ry: 0, def: 6.4, min: 5.1, max: 7.7 },
  { room: 'ba', axis: 'x', at: BATH_X1, side: -1, ry: -Math.PI / 2, def: 1.2, min: -1.6, max: 2.0 },
];

/** 门定义：axis/at 同 WinDef（门组落在墙中心线上） */
export interface DoorDef {
  id: 'bed' | 'kt' | 'bath';
  name: string;
  axis: 'x' | 'z';
  at: number;
  ry: number;
  def: number;
  min: number;
  max: number;
}

/** 三扇门（卧室门 / 厨房门在 z=3 隔墙；卫生间门在客厅东墙 x=4.5） */
export const DOORS: DoorDef[] = [
  { id: 'bed', name: '卧室门', axis: 'z', at: BED_Z0, ry: 0, def: DOOR_X, min: -3.9, max: 0.9 },
  { id: 'kt', name: '厨房门', axis: 'z', at: BED_Z0, ry: 0, def: KDOOR_X, min: 2.1, max: 6.9 },
  { id: 'bath', name: '卫生间门', axis: 'x', at: ROOM_X, ry: Math.PI / 2, def: BDOOR_Z, min: -2.2, max: 2.2 },
];

/** 同墙滑行件的半宽（窗 1.5m 宽 / 门 0.94m 宽 + 富余） */
const WIN_HALF = 0.82;
const DOOR_HALF = 0.56;

/** 同墙邻居（用于滑行避让：同墙的窗与门互不重叠；用当前坐标，缺省用默认位） */
function wallNeighbors(
  selfId: string,
  axis: 'x' | 'z',
  at: number,
  winPos?: number[],
  doorPos?: { bed: number; kt: number; bath: number },
): { along: number; half: number }[] {
  const out: { along: number; half: number }[] = [];
  for (const [i, w] of WINS.entries()) {
    if (`win-${i}` === selfId || w.axis !== axis || Math.abs(w.at - at) > 0.01) continue;
    out.push({ along: winPos?.[i] ?? w.def, half: WIN_HALF });
  }
  for (const d of DOORS) {
    if (`door-${d.id}` === selfId || d.axis !== axis || Math.abs(d.at - at) > 0.01) continue;
    out.push({ along: doorPos?.[d.id] ?? d.def, half: DOOR_HALF });
  }
  return out;
}

/** 把沿墙坐标钳回滑行范围并避让同墙邻居（门/窗滑行共用） */
export function clampWallAlong(selfId: string, def: { axis: 'x' | 'z'; at: number; min: number; max: number }, along: number, neighbors: { along: number; half: number }[]): number {
  let a = Math.max(def.min, Math.min(def.max, along));
  for (const o of neighbors) {
    const need = o.half + (selfId.startsWith('door-') ? DOOR_HALF : WIN_HALF) + 0.12;
    if (Math.abs(a - o.along) < need) {
      a = o.along > a ? o.along - need : o.along + need;
    }
  }
  return Math.max(def.min, Math.min(def.max, a));
}

/** 编辑模式拖拽/微调一扇窗：返回沿墙钳制后的完整位置 */
export function resolveWinPos(i: number, along: number, winPos?: number[], doorPos?: { bed: number; kt: number; bath: number }): { x: number; z: number; along: number } {
  const w = WINS[i];
  const cur = winPos?.[i] ?? w.def;
  const others = wallNeighbors(`win-${i}`, w.axis, w.at, winPos, doorPos);
  const a = clampWallAlong(`win-${i}`, w, Number.isFinite(along) ? along : cur, others);
  const x = w.axis === 'z' ? a : w.at + w.side * 0.08;
  const z = w.axis === 'z' ? w.at + w.side * 0.08 : a;
  return { x, z, along: a };
}

/** 编辑模式拖拽/微调一扇门：返回沿墙钳制后的完整位置（门组在墙中心线上） */
export function resolveDoorPos(id: 'bed' | 'kt' | 'bath', along: number, winPos?: number[], doorPos?: { bed: number; kt: number; bath: number }): { x: number; z: number; along: number } {
  const d = DOORS.find((x) => x.id === id)!;
  const cur = doorPos?.[id] ?? d.def;
  const others = wallNeighbors(`door-${id}`, d.axis, d.at, winPos, doorPos);
  const a = clampWallAlong(`door-${id}`, d, Number.isFinite(along) ? along : cur, others);
  const x = d.axis === 'z' ? a : d.at;
  const z = d.axis === 'z' ? d.at : a;
  return { x, z, along: a };
}

// ---------------- 家具目录 ----------------

const G = (f: string) => `/models/furniture/${f}.glb`;

/** 家具目录：kind → 静态配置（fp 为实测占地，单位米） */
export const CATALOG: Record<string, CatalogEntry> = {
  // ---- 沙发区 ----
  sofa: {
    kind: 'sofa', glb: G('sofa'), name: '云白双人沙发', cat: 'sofa', fp: [1.96, 0.82],
    acts: { seat: { y: 0.45, dz: -0.05 } },
  },
  sofaLong: {
    kind: 'sofaLong', glb: G('sofaLong'), name: '云白贵妃沙发', cat: 'sofa', fp: [1.96, 1.64],
    acts: { seat: { y: 0.45, dz: -0.18 } },
  },
  loungeChair: {
    kind: 'loungeChair', glb: G('loungeChair'), name: '米白休闲椅', cat: 'sofa', fp: [0.98, 1.35],
    acts: { seat: { y: 0.42, dz: -0.2 } },
  },
  ottoman: {
    kind: 'ottoman', glb: G('ottoman'), name: '软软脚凳', cat: 'sofa', fp: [0.88, 0.9],
    acts: { seat: { y: 0.38 } },
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
    acts: { seat: { y: 0.45 } },
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
    acts: { sleep: { y: 0.47, dz: 0.1 } },
  },
  bedSingle: {
    kind: 'bedSingle', glb: G('bedSingle'), name: '单人小床', cat: 'bed', fp: [1.14, 2.25],
    acts: { sleep: { y: 0.47, dz: 0.1 } },
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
    kind: 'microwave', glb: G('microwave'), name: '小微波炉', cat: 'appliance', fp: [0.58, 0.46], h: 0.36,
    acts: { playful: true },
  },
  toaster: {
    kind: 'toaster', glb: G('toaster'), name: '烤面包机', cat: 'appliance', fp: [0.38, 0.2], h: 0.26,
    acts: { playful: true },
  },
  // ---- 灯具 ----
  lampFloor: {
    kind: 'lampFloor', glb: G('lampFloor'), name: '蘑菇落地灯', cat: 'lamp', fp: [0.3, 0.35], h: 1.72,
    acts: { toggle: true }, light: { y: 1.5, color: '#ffd9a0', intensity: 1.2 },
  },
  lampTable: {
    kind: 'lampTable', glb: G('lampTable'), name: '蘑菇小台灯', cat: 'lamp', fp: [0.3, 0.35],
    acts: { toggle: true }, light: { y: 0.5, color: '#ffd9a0', intensity: 0.9 },
  },
  // ---- 植物 ----
  plant: {
    kind: 'plant', glb: G('plant'), name: '大盆绿植', cat: 'plant', fp: [0.42, 0.48], h: 1.31,
    acts: { playful: true },
  },
  plantSmall: {
    kind: 'plantSmall', glb: G('plantSmall'), name: '小多肉', cat: 'plant', fp: [0.19, 0.19],
    acts: { playful: true },
  },
  // ---- 收纳 ----
  bookcase: {
    kind: 'bookcase', glb: G('bookcase'), name: '开放书架', cat: 'decor', fp: [0.8, 0.5], h: 1.76,
    acts: { playful: true },
  },
  wardrobe: {
    kind: 'wardrobe', glb: G('wardrobe'), name: '双门衣柜', cat: 'decor', fp: [0.8, 0.5], h: 1.7,
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
  // ---- 装饰·相框（程序化建模，点击上传照片；永久保存） ----
  photoFrame: {
    kind: 'photoFrame', name: '立式相框', cat: 'decor', fp: [0.52, 0.3],
    acts: { photo: true },
  },
  photoWall: {
    kind: 'photoWall', name: '挂墙相框', cat: 'decor', fp: [0.56, 0.1], wallMount: true,
    acts: { photo: true },
  },
  photoWallWide: {
    kind: 'photoWallWide', name: '挂墙横相框', cat: 'decor', fp: [1.1, 0.1], wallMount: true,
    acts: { photo: true },
  },
  polaroid: {
    kind: 'polaroid', name: '拍立得', cat: 'decor', fp: [0.34, 0.3],
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
    kind: 'coatRack', glb: G('coatRack'), name: '衣帽架', cat: 'decor', fp: [0.55, 0.55], h: 1.54,
    acts: { playful: true },
  },
  // ---- 厨卫家电（v5.2 厨房正式开放） ----
  fridge: {
    kind: 'fridge', glb: G('fridge'), name: '云白冰箱', cat: 'appliance', fp: [0.86, 0.58], h: 1.84,
    acts: { door: true },
  },
  stove: {
    kind: 'stove', glb: G('stove'), name: '复古灶台', cat: 'appliance', fp: [0.86, 0.9], h: 0.9,
    acts: { playful: true },
  },
  sink: {
    kind: 'sink', glb: G('sink'), name: '厨房水槽', cat: 'appliance', fp: [0.86, 0.9], h: 0.98,
    acts: { door: true },
  },
  kitchenBar: {
    kind: 'kitchenBar', glb: G('kitchenBar'), name: '小吧台', cat: 'table', fp: [0.86, 0.42], h: 0.84,
    acts: { playful: true },
  },
  washer: {
    kind: 'washer', glb: G('washer'), name: '滚筒洗衣机', cat: 'bathroom', fp: [0.78, 0.78], h: 0.85,
    acts: { door: true, washer: true },
  },
  bathtub: {
    kind: 'bathtub', glb: G('bathtub'), name: '泡泡浴缸', cat: 'bathroom', fp: [2.38, 1.12], h: 0.62,
    acts: { bath: { y: 0.1, dx: -0.35 } },
  },
  toilet: {
    kind: 'toilet', glb: G('toilet'), name: '小白马桶', cat: 'bathroom', fp: [0.63, 0.95], h: 0.72,
    acts: { seat: { y: 0.42, dz: -0.06 } },
  },
  // ---- 卫浴全套（v5.4：淋浴/浴室柜洗手台/挂壁镜/毛巾架） ----
  shower: {
    kind: 'shower', name: '玻璃淋浴房', cat: 'bathroom', fp: [1.02, 1.02], h: 2.05,
    acts: { toggle: true },
  },
  basin: {
    kind: 'basin', name: '浴室柜洗手台', cat: 'bathroom', fp: [0.96, 0.54], h: 0.86,
    acts: { playful: true },
  },
  mirror: {
    kind: 'mirror', name: '挂壁大镜子', cat: 'bathroom', fp: [0.66, 0.1], wallMount: true, wallY: 1.55, h: 0.86,
    acts: {},
  },
  towelRack: {
    kind: 'towelRack', name: '毛巾架', cat: 'bathroom', fp: [0.5, 0.1], wallMount: true, wallY: 1.35, h: 0.42,
    acts: {},
  },
  // ---- 宠物 ----
  bear: {
    kind: 'bear', name: '小熊「团团」', cat: 'decor', fp: [0.6, 0.46], h: 0.55,
    acts: { playful: true },
  },
  plushPanda: {
    kind: 'plushPanda', name: '熊猫玩偶「滚滚」', cat: 'decor', fp: [0.3, 0.3], h: 0.3,
    acts: { playful: true },
  },
  plushPig: {
    kind: 'plushPig', name: '小猪玩偶「呼噜」', cat: 'decor', fp: [0.3, 0.3], h: 0.28,
    acts: { playful: true },
  },
  plushCat: {
    kind: 'plushCat', name: '猫咪玩偶「咪咪」', cat: 'decor', fp: [0.3, 0.34], h: 0.3,
    acts: { playful: true },
  },
  // ---- 厨具小物（程序化建模，摆桌/摆灶台） ----
  pot: {
    kind: 'pot', name: '奶油汤锅', cat: 'kitchen', fp: [0.3, 0.3], h: 0.2,
    acts: { playful: true },
  },
  kettle: {
    kind: 'kettle', name: '鸣笛水壶', cat: 'kitchen', fp: [0.26, 0.26], h: 0.22,
    acts: { playful: true },
  },
  bowls: {
    kind: 'bowls', name: '叠叠小碗', cat: 'kitchen', fp: [0.24, 0.24], h: 0.14,
    acts: { playful: true },
  },
  plates: {
    kind: 'plates', name: '白瓷盘子', cat: 'kitchen', fp: [0.28, 0.28], h: 0.07,
    acts: { playful: true },
  },
  chopsticks: {
    kind: 'chopsticks', name: '筷子筒', cat: 'kitchen', fp: [0.14, 0.14], h: 0.24,
    acts: { playful: true },
  },
  spoons: {
    kind: 'spoons', name: '小勺子', cat: 'kitchen', fp: [0.14, 0.1], h: 0.12,
    acts: { playful: true },
  },
  cup: {
    kind: 'cup', name: '马克杯', cat: 'kitchen', fp: [0.2, 0.14], h: 0.12,
    acts: { playful: true },
  },
  juicer: {
    kind: 'juicer', name: '榨汁机', cat: 'appliance', fp: [0.24, 0.24], h: 0.3,
    acts: { playful: true },
  },
  // ---- 电器·风扇（程序化建模，点击开/关叶片旋转） ----
  fan: {
    kind: 'fan', name: '落地风扇', cat: 'appliance', fp: [0.34, 0.34], h: 1.1,
    acts: { toggle: true },
  },
  // ---- 电器·插座（程序化建模，挂墙低位） ----
  socket: {
    kind: 'socket', name: '墙壁插座', cat: 'appliance', fp: [0.14, 0.06], wallMount: true, wallY: 0.38, h: 0.1,
    acts: {},
  },
  // ---- 灯具·吊灯（程序化建模，挂在天花板；点击开/关） ----
  chandelier: {
    kind: 'chandelier', name: '奶油吊灯', cat: 'lamp', fp: [0.42, 0.42], h: 0.62,
    acts: { toggle: true },
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
  { key: 'kitchen', label: '厨具' },
  { key: 'bathroom', label: '卫浴' },
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
 * 初始 v5.4 四室：客厅 + 卧室 + 厨房 + 卫生间（客厅东侧，门开在客厅）
 * 客厅：北墙电视墙 + 沙发对坐 + 西侧工作角 + 玄关 + 风扇 + 吊灯
 * 卧室：双人床 + 床头柜×2 + 衣柜 + 梳妆台 + 空调 + 玩偶×3 + 挂墙相框 + 吊灯
 * 厨房：冰箱灶台水槽沿北墙 + 吧台 + 餐桌 + 锅碗筷盘勺杯榨汁机 + 吊灯
 * 卫生间：浴缸(北窗下) + 淋浴房 + 马桶 + 洗手台 + 大镜子 + 毛巾架 + 洗衣机 + 吊灯
 */
export function defaultHome(): HomeState {
  seq = 0;
  return {
    v: 5,
    night: false,
    win: [false, false, false, false, false, false, false, false, false],
    doorOpen: false,
    kitchenDoorOpen: false,
    bathDoorOpen: false,
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
      F('fan', 3.7, 1.75, { ry: -2.4 }), // 落地风扇
      F('chandelier', 0, 0.2, { y: WALL_H - 0.04 }), // 客厅吊灯
      F('socket', ROOM_X - 0.07, -0.9, { y: 0.38, ry: -Math.PI / 2 }), // 客厅东壁插座

      // —— 卧室（隔墙南侧，推门而入；家具齐备） ——
      F('bed', -3.32, 5.6, { ry: -Math.PI / 2 }), // 双人床靠西墙（床头朝西）
      F('plushBunny', -2.62, 5.12, { y: 0.42, ry: -2.3 }), // 毛绒兔坐在床上
      F('plushPig', -2.85, 5.95, { y: 0.42, ry: 2.2 }), // 小猪玩偶坐床上
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
      F('photoWall', 1.43, 4.6, { y: 1.45, ry: -Math.PI / 2 }), // 卧室东壁挂墙相框
      F('plushCat', -1.5, 0.45, { y: 0.4, ry: -0.7 }), // 猫咪玩偶坐脚凳 —— 改放客厅
      F('chandelier', -1.5, 5.5, { y: WALL_H - 0.04 }), // 卧室吊灯
      F('socket', -ROOM_X + 0.07, 3.7, { y: 0.38, ry: Math.PI / 2 }), // 卧室西壁插座

      // —— 厨房（卧室东侧，北墙开门洞通客厅） ——
      F('fridge', 7.0, 3.41), // 冰箱靠北墙
      F('stove', 6.0, 3.57), // 灶台
      F('pot', 5.82, 3.52, { y: 0.92 }), // 汤锅上灶
      F('kettle', 6.3, 3.35, { y: 0.92, ry: -0.5 }), // 水壶上灶
      F('sink', 5.0, 3.57), // 水槽
      F('kitchenBar', 7.2, 5.4, { ry: -Math.PI / 2 }), // 吧台靠东墙（窗下）
      F('chair', 6.55, 5.12, { ry: Math.PI / 2 }), // 吧台椅×2
      F('chair', 6.55, 5.68, { ry: Math.PI / 2 }),
      F('plantSmall', 7.2, 5.68, { y: 0.85 }), // 吧台小多肉
      F('cup', 7.2, 5.4, { y: 0.86, ry: 0.4 }), // 马克杯摆吧台
      F('polaroid', 7.2, 5.08, { y: 0.85, ry: -Math.PI / 2 + 0.2 }), // 拍立得摆吧台
      F('diningTable', 3.3, 6.5), // 餐桌
      F('chair', 2.2, 6.5, { ry: Math.PI / 2 }), // 餐椅×2
      F('chair', 4.4, 6.5, { ry: -Math.PI / 2 }),
      F('microwave', 3.0, 6.2, { y: 0.74, ry: 0.3 }), // 微波炉上桌
      F('toaster', 3.6, 6.75, { y: 0.74, ry: -0.2 }), // 烤面包机上桌
      F('bowls', 2.85, 6.62, { y: 0.74 }), // 碗上桌
      F('plates', 3.72, 6.32, { y: 0.74 }), // 盘子上桌
      F('chopsticks', 3.28, 6.78, { y: 0.74 }), // 筷子筒上桌
      F('juicer', 3.62, 6.6, { y: 0.74, ry: 0.5 }), // 榨汁机上桌
      F('doormat', KDOOR_X, 3.75), // 厨房门垫
      F('plant', 1.95, 7.5),
      F('photoWall', 6.4, BED_Z1 - 0.07, { y: 1.45, ry: Math.PI }), // 厨房南壁挂墙相框
      F('photoWallWide', -ROOM_X + 0.07, 1.7, { y: 1.5, ry: Math.PI / 2 }), // 客厅西墙横相框
      F('socket', 4.2, BED_Z0 + 0.19, { y: 0.38, ry: 0 }), // 厨房北壁插座
      F('chandelier', 4.5, 5.5, { y: WALL_H - 0.04 }), // 厨房吊灯

      // —— 卫生间（客厅东侧，v5.4；推门而入，门在客厅东墙） ——
      F('bathtub', 6.35, -2.28), // 泡泡浴缸靠北墙（窗下）
      F('shower', 7.98, 2.5), // 玻璃淋浴房东南角（贴墙）
      F('toilet', 4.98, 2.3, { ry: Math.PI / 2 }), // 小白马桶靠西墙
      F('basin', 6.3, 2.62, { ry: Math.PI }), // 浴室柜洗手台靠南墙
      F('mirror', 6.3, 2.93, { y: 1.55, ry: Math.PI }), // 大镜子挂洗手台上方
      F('towelRack', 8.43, -1.3, { y: 1.35, ry: -Math.PI / 2 }), // 毛巾架东墙
      F('washer', 8.02, 0.2, { ry: -Math.PI / 2 }), // 洗衣机靠东墙
      F('doormat', 5.2, 0.3, { ry: Math.PI / 2 }), // 卫生间门垫
      F('plant', 4.95, -2.5), // 绿植
      F('chandelier', 6.5, 0, { y: WALL_H - 0.04 }), // 卫生间吊灯
      F('socket', BATH_X0 + 0.07, -1.5, { y: 0.38, ry: Math.PI / 2 }), // 卫生间西壁插座

      // —— 客厅补充：熊猫玩偶坐沙发 ——
      F('plushPanda', 0.52, 1.32, { y: 0.47, ry: 2.9 }),
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

let migSeq2 = 0;

/**
 * v5.2 厨房开放迁移：老档案补插整套厨房家具 + 三款新相框（幂等，不动用户已有布置）。
 * 厨房区域（卧室东侧）老档必为空，直接按默认布局落位；拍立得跟随吧台有无决定上桌/落地。
 */
export function migrateKitchenV52(h: HomeState): HomeState {
  if (!h || h.v !== 5 || !Array.isArray(h.furniture)) return h;
  const furn = h.furniture.slice();
  const stamp = Date.now().toString(36);
  const add = (kind: FurnitureKind, x: number, z: number, y?: number, ry?: number) =>
    furn.push({ id: `${kind}-mig2-${stamp}-${++migSeq2}`, kind, x, z, y, ry, st: {} });

  const kinds = new Set(furn.map((f) => f.kind));
  const hasKitchen = kinds.has('fridge') || kinds.has('stove') || kinds.has('sink') || kinds.has('kitchenBar');

  if (!hasKitchen) {
    add('fridge', 7.0, 3.41, 0, 0);
    add('stove', 6.0, 3.57, 0, 0);
    add('sink', 5.0, 3.57, 0, 0);
    add('kitchenBar', 7.2, 5.4, 0, -Math.PI / 2);
    add('chair', 6.55, 5.12, 0, Math.PI / 2);
    add('chair', 6.55, 5.68, 0, Math.PI / 2);
    add('plantSmall', 7.2, 5.68, 0.85, 0);
    add('diningTable', 3.3, 6.5, 0, 0);
    add('chair', 2.2, 6.5, 0, Math.PI / 2);
    add('chair', 4.4, 6.5, 0, -Math.PI / 2);
    add('microwave', 3.0, 6.2, 0.74, 0.3);
    add('toaster', 3.6, 6.75, 0.74, -0.2);
    add('doormat', KDOOR_X, 3.75, 0, 0);
    add('plant', 1.95, 7.5, 0, 0);
  }
  // 拍立得：有吧台就上吧台，否则落地
  if (!kinds.has('polaroid')) {
    if (kinds.has('kitchenBar')) add('polaroid', 7.2, 5.08, 0.85, -Math.PI / 2 + 0.2);
    else add('polaroid', 6.6, 4.6, 0, -Math.PI / 2 + 0.2);
  }
  // 三款新相框：厨房南壁 / 客厅西墙横框（老档这两面墙均空余；厨房东壁留给卫生间门）
  if (!kinds.has('photoWall')) add('photoWall', 6.4, BED_Z1 - 0.07, 1.45, Math.PI);
  if (!kinds.has('photoWallWide')) add('photoWallWide', -ROOM_X + 0.07, 1.7, 1.5, Math.PI / 2);

  if (furn.length === h.furniture.length) return h;
  return { ...h, furniture: furn };
}

let migSeq3 = 0;

/**
 * v5.3 卫生间 + 小物全家桶迁移（幂等，不动用户已有布置）：
 * - 卫生间（厨房东侧）老档必空 → 补浴缸/马桶/洗衣机/门垫/绿植；
 * - 吊灯（四房间逐间检查）/ 插座（四房间）/ 落地风扇 / 厨具小物（跟随灶台/餐桌/吧台实际位置）；
 * - 新玩偶（滚滚/呼噜/咪咪）跟随沙发/床/脚凳实际位置；
 * - 旧档挂在厨房东壁的相框让位给卫生间门 → 挪到厨房南壁。
 */
export function migrateBathV53(h: HomeState): HomeState {
  if (!h || h.v !== 5 || !Array.isArray(h.furniture)) return h;
  const furn = h.furniture.slice();
  const stamp = Date.now().toString(36);
  const add = (kind: FurnitureKind, x: number, z: number, y?: number, ry?: number) =>
    furn.push({ id: `${kind}-mig3-${stamp}-${++migSeq3}`, kind, x, z, y, ry, st: {} });
  const kinds = new Set(furn.map((f) => f.kind));
  const inRoom = (kind: string, room: RoomId) =>
    furn.some((f) => f.kind === kind && roomAt(f.x, f.z) === room);

  // 旧档相框挂在厨房东壁（卫生间门的位置）→ 挪到厨房南壁
  const ktEastFrame = furn.find(
    (f) => f.kind === 'photoWall' && Math.abs(f.x - (KTCH_X1 - 0.07)) < 0.12,
  );
  if (ktEastFrame) {
    ktEastFrame.x = 6.4;
    ktEastFrame.z = BED_Z1 - 0.07;
    ktEastFrame.ry = Math.PI;
  }

  // 卫生间（老档必空：无任何家具落在卫生间区域）
  const hasBath = furn.some((f) => roomAt(f.x, f.z) === 'ba');
  if (!hasBath) {
    add('bathtub', 9.5, 3.7, 0, 0);
    add('toilet', 8.05, 3.62, 0, -Math.PI / 2);
    add('washer', 10.85, 7.3, 0, Math.PI);
    add('doormat', 8.35, 7.0, 0, Math.PI / 2);
    add('plant', 11.0, 3.45, 0, 0);
  }
  // 吊灯：逐间补
  for (const room of ['lr', 'br', 'kt', 'ba'] as RoomId[]) {
    if (!inRoom('chandelier', room)) {
      const spot: Record<RoomId, [number, number]> = {
        lr: [0, 0.2], br: [-1.5, 5.5], kt: [4.5, 5.5], ba: [9.5, 5.5],
      };
      add('chandelier', spot[room][0], spot[room][1], WALL_H - 0.04, 0);
    }
  }
  // 插座：逐间补
  for (const room of ['lr', 'br', 'kt', 'ba'] as RoomId[]) {
    if (!inRoom('socket', room)) {
      const spot: Record<RoomId, [number, number, number]> = {
        lr: [ROOM_X - 0.07, -0.9, -Math.PI / 2],
        br: [-ROOM_X + 0.07, 3.7, Math.PI / 2],
        kt: [4.2, BED_Z0 + 0.19, 0],
        ba: [KTCH_X1 + 0.07, 3.6, Math.PI / 2],
      };
      add('socket', spot[room][0], spot[room][1], 0.38, spot[room][2]);
    }
  }
  // 落地风扇
  if (!kinds.has('fan')) add('fan', 3.7, 1.75, 0, -2.4);
  // 厨具小物：跟随灶台/餐桌/吧台实际位置
  if (!kinds.has('pot')) {
    const stove = furn.find((f) => f.kind === 'stove');
    if (stove) {
      add('pot', stove.x - 0.18, stove.z - 0.05, 0.92, 0);
      add('kettle', stove.x + 0.3, stove.z - 0.22, 0.92, -0.5);
    }
  }
  if (!kinds.has('bowls')) {
    const dt = furn.find((f) => f.kind === 'diningTable');
    if (dt) {
      add('bowls', dt.x - 0.45, dt.z + 0.12, 0.74, 0);
      add('plates', dt.x + 0.42, dt.z - 0.18, 0.74, 0);
      add('chopsticks', dt.x - 0.02, dt.z + 0.28, 0.74, 0);
      add('juicer', dt.x + 0.32, dt.z + 0.1, 0.74, 0.5);
    }
  }
  if (!kinds.has('cup')) {
    const bar = furn.find((f) => f.kind === 'kitchenBar');
    if (bar) add('cup', bar.x, bar.z, 0.86, 0.4);
  }
  // 新玩偶：跟随沙发/床/脚凳
  if (!kinds.has('plushPanda')) {
    const sofa = furn.find((f) => f.kind === 'sofa');
    if (sofa) add('plushPanda', sofa.x + 0.37, sofa.z - 0.03, 0.47, (sofa.ry ?? 0) + 2.9);
    else add('plushPanda', 0.5, 2.0, 0, 2.9);
  }
  if (!kinds.has('plushPig')) {
    const bed = furn.find((f) => f.kind === 'bed');
    if (bed) add('plushPig', bed.x + 0.47, bed.z + 0.35, 0.42, (bed.ry ?? 0) + 2.2);
    else add('plushPig', -1.0, 5.8, 0, 2.2);
  }
  if (!kinds.has('plushCat')) {
    const ot = furn.find((f) => f.kind === 'ottoman');
    if (ot) add('plushCat', ot.x, ot.z, 0.4, -0.7);
    else add('plushCat', -1.5, 0.5, 0, -0.7);
  }

  if (furn.length === h.furniture.length && !ktEastFrame) return h;
  return { ...h, furniture: furn };
}

let migSeq4 = 0;

/**
 * v5.4 卫生间搬家迁移（幂等）：卫生间从厨房东侧（x 7.5~11.5, z 3~8）整体搬到客厅东侧
 * （x 4.5~8.5, z -3~3），门改开在客厅东墙；旧位默认洁具按新布局重摆，用户自买件钳进新浴室，
 * 并补齐淋浴房/洗手台/大镜子/毛巾架；旧门位/旧窗位越界自动复位到新默认。
 */
export function migrateBathV54(h: HomeState): HomeState {
  if (!h || h.v !== 5 || !Array.isArray(h.furniture)) return h;
  const OLD_BATH = (x: number, z: number) => x > 7.52 && z > 3.05;
  const NEW_BATH = (x: number, z: number) =>
    x >= BATH_X0 - 0.1 && x <= BATH_X1 + 0.1 && z >= BATH_Z0 - 0.1 && z <= BATH_Z1 + 0.1;
  const hadOld = h.furniture.some((f) => OLD_BATH(f.x, f.z));
  const hadNew = h.furniture.some((f) => NEW_BATH(f.x, f.z));
  const doorPos = h.doorPos ? { ...h.doorPos } : undefined;
  const winPos = h.winPos ? h.winPos.slice() : undefined;
  const bathDefaults: [FurnitureKind, number, number, number?, number?][] = [
    ['bathtub', 6.35, -2.28, 0, 0],
    ['shower', 7.98, 2.5, 0, 0],
    ['toilet', 4.98, 2.3, 0, Math.PI / 2],
    ['basin', 6.3, 2.62, 0, Math.PI],
    ['mirror', 6.3, 2.93, 1.55, Math.PI],
    ['towelRack', 8.43, -1.3, 1.35, -Math.PI / 2],
    ['washer', 8.02, 0.2, 0, -Math.PI / 2],
    ['doormat', 5.2, 0.3, 0, Math.PI / 2],
    ['plant', 4.95, -2.5, 0, 0],
    ['chandelier', 6.5, 0, WALL_H - 0.04, 0],
    ['socket', BATH_X0 + 0.07, -1.5, 0.38, Math.PI / 2],
  ];
  const doorReset = !!doorPos?.bath && (doorPos.bath < -2.2 || doorPos.bath > 2.2);
  const win7Reset = !!winPos && winPos[7] != null && (winPos[7] < 5.1 || winPos[7] > 7.7);
  const win8Reset = !!winPos && winPos[8] != null && (winPos[8] < -1.6 || winPos[8] > 2.0);
  if (!hadOld && hadNew && !doorReset && !win7Reset && !win8Reset) return h;

  const furn = h.furniture.slice();
  const stamp = Date.now().toString(36);
  const add = (kind: FurnitureKind, x: number, z: number, y?: number, ry?: number) =>
    furn.push({ id: `${kind}-mig4-${stamp}-${++migSeq4}`, kind, x, z, y, ry, st: {} });

  // 1) 旧浴室里的默认套装删除（按新布局重加），用户自买件平移进新浴室
  const defaultKinds = new Set(bathDefaults.map(([k]) => k));
  for (let i = furn.length - 1; i >= 0; i--) {
    const f = furn[i];
    if (!OLD_BATH(f.x, f.z)) continue;
    if (defaultKinds.has(f.kind)) {
      furn.splice(i, 1);
      continue;
    }
    f.x = Math.min(BATH_X1 - 0.4, Math.max(BATH_X0 + 0.4, f.x - 3));
    f.z = Math.min(BATH_Z1 - 0.4, Math.max(BATH_Z0 + 0.4, f.z - 6));
  }

  // 2) 新浴室缺的默认件补齐
  const inNew = (kind: string) => furn.some((f) => f.kind === kind && NEW_BATH(f.x, f.z));
  for (const [kind, x, z, y, ry] of bathDefaults) {
    if (!inNew(kind)) add(kind, x, z, y, ry);
  }

  // 3) 旧门位/旧窗位越界 → 复位到新默认
  if (doorPos && doorReset) doorPos.bath = BDOOR_Z;
  if (winPos) {
    if (win7Reset) winPos[7] = 6.4;
    if (win8Reset) winPos[8] = 1.2;
  }

  return { ...h, furniture: furn, doorPos, winPos };
}

/** 老档全量迁移链：卧室补全 → 厨房开放 → 卫生间+小物全家桶 → 卫生间搬家（v5.4 客厅东侧） */
export function migrateHome(h: HomeState): HomeState {
  return migrateBathV54(migrateBathV53(migrateKitchenV52(migrateBedroomV51(h))));
}

/** 同步读缓存（首屏即时渲染；无则 null） */
export function loadCache(): HomePersist | null {
  const saved = kvGet<HomePersist>(KEY);
  if (saved && valid(saved.home)) return { ...saved, home: migrateHome(saved.home) };
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
    return { home: migrateHome(json.data), rev: json.rev ?? 0 };
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
