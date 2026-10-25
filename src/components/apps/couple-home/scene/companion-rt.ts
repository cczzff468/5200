/**
 * 拾光小屋 · 陪伴小人（3D 恋人）运行时状态机（v8.0）
 *
 * 驱动「对方」小人执行用户的物理指令与陪伴交互：
 * - 指令：come 过来 / goto 去某房间 / sit 坐下 / lie 躺下 / watch 看电视 /
 *   lamp 开灯（走到灯旁由宿主点亮）/ free 自由活动；
 * - 陪伴：hug 拥抱（走过来 → 双方摆拥抱姿势 → 用户走动或超时自动松开）/
 *   holdhand 牵手（走过来 → 牵手姿势 → 0.5m 距离跟随移动，防穿模）。
 *
 * 移动全部走 A* 网格寻路（pathfind.findPath）+ 每帧 collideAndClamp（宿主注入），
 * 卡死自动重算路径一次、再失败放弃并回报 giveup —— 绝不穿墙、绝不卡进家具。
 *
 * 纯逻辑模块：不 import three / R3F，由 HomeScene.GameLoop 每帧调用 companionStep()。
 * 坐/躺为粘性姿势（保留 25~55s 后自行起身漫游），期间 roam 被接管不乱走。
 */

import { CATALOG } from '../catalog';
import type { CharPose, CharRT, FurnitureItem, RoomId } from '../types';
import { findPath, planRoute, randPointInRoomFree, roomOf, type BlockGrid, type DoorGate, type Pt } from './pathfind';

/** 陪伴指令（宿主 CoupleHome 发起；seq 递增触发） */
export interface CompanionCmd {
  seq: number;
  kind: 'come' | 'goto' | 'sit' | 'lie' | 'watch' | 'lamp' | 'hug' | 'holdhand' | 'free';
  /** goto 的目标房间 */
  room?: RoomId;
  /** sit/lie/watch/lamp 的家具 id（缺省 sit = 最近座位 / lie = 最近床 / lamp = 最近落地灯） */
  itemId?: string;
  /** 指令备注（事件回报时带回，宿主用于记忆/文案） */
  memo?: string;
}

/** 陪伴事件（状态机 → 宿主，用于记忆写入 / UI 提示 / 家具联动） */
export interface CompanionEvent {
  ev: 'arrive' | 'hugStart' | 'holdStart' | 'release' | 'giveup' | 'room';
  kind: CompanionCmd['kind'];
  /** 触发事件的家具 id（lamp 联动开关用） */
  itemId?: string;
  /** room 事件：牵手跟随进入的新房间 */
  room?: RoomId;
  /** 宿主下发指令时带的备注 */
  memo?: string;
}

/** 小人姿势槽（宿主持有 ref；本模块直接写入） */
export interface PoseSlot {
  pose: CharPose;
  y: number;
}

/** 动作锚点（走到哪里 / 坐多高 / 朝向） */
interface Anchor {
  tx: number;
  tz: number;
  ry: number;
  y: number;
}

/** 状态机内部状态（HomeScene 持有一个实例） */
export interface CompanionRT {
  /** 最近一次消费的指令 seq */
  lastSeq: number;
  phase: 'idle' | 'walk' | 'sit' | 'hug' | 'hold';
  /** 当前指令（消费后保留到阶段结束） */
  cmd: CompanionCmd | null;
  /** A* 路点（逐个消费） */
  path: Pt[];
  /** 最终目标点 */
  target: Pt | null;
  /** 当前动作的家具锚点 / 家具 id */
  anchor: Anchor | null;
  itemId: string | null;
  /** 卡死检测（0.9s 位移 < 0.05 → 重算一次路径，再卡 → giveup） */
  stuckT: number;
  stuckX: number;
  stuckZ: number;
  repathed: boolean;
  /** 计时器（hug 时长 / hold 重算节流 / 坐姿保持） */
  actT: number;
  /** sit 粘性姿势到点（clock 秒；到点自行起身） */
  sitUntil: number;
  /** hold 阶段最近一次 A* 重算时刻（actT 秒） */
  holdAt: number;
  /** hold 阶段最近回报过的房间（进入新房间回报 room 事件） */
  holdRoom: RoomId | null;
}

/** 新建状态机实例 */
export function createCompanionRT(): CompanionRT {
  return {
    lastSeq: 0,
    phase: 'idle',
    cmd: null,
    path: [],
    target: null,
    anchor: null,
    itemId: null,
    stuckT: 0,
    stuckX: 0,
    stuckZ: 0,
    repathed: false,
    actT: 0,
    sitUntil: 0,
    holdAt: 0,
    holdRoom: null,
  };
}

/** 行走速度（指令走动比漫游略快、比用户摇杆慢） */
const WALK_SPEED = 1.45;
/** 到位判定距离 */
const ARRIVE = 0.2;
/** 牵手保持距离（要求 0.5m） */
const HOLD_DIST = 0.5;
/** 拥抱贴合距离 */
const HUG_DIST = 0.42;
/** 拥抱自动松开（秒） */
const HUG_MAX = 6;
/** 坐/躺粘性姿势时长（秒，随机 25~55；到点自行起身漫游） */
const SIT_MIN = 25;
const SIT_MAX = 55;

/** 角度插值（归一 [-π,π]） */
function lerpAngle(cur: number, target: number, k: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * k;
}

/**
 * 家具动作锚点（sit/lie/watch/lamp 落点与朝向；与 CoupleHome.anchorOf 同口径的精简版 ——
 * 只服务陪伴小人，不需要 eat/cook 等宿主专属动作）。返回 null = 该家具不支持此动作。
 */
export function companionAnchor(
  kind: 'sit' | 'lie' | 'watch' | 'lamp',
  item: FurnitureItem,
): Anchor | null {
  const entry = CATALOG[item.kind];
  if (!entry) return null;
  const ry0 = item.ry ?? 0;
  if (kind === 'lamp') {
    // 走到灯旁半步距离，面向灯
    const dz = entry.fp[1] / 2 + 0.5;
    return {
      tx: item.x + dz * Math.sin(ry0),
      tz: item.z + dz * Math.cos(ry0),
      ry: ry0 + Math.PI,
      y: 0,
    };
  }
  const a = kind === 'sit' ? entry.acts.seat : kind === 'lie' ? entry.acts.sleep : entry.acts.watch;
  if (!a) return null;
  const an = a as { y: number; dx?: number; dz?: number; ryOff?: number };
  const ry = ry0 + (an.ryOff ?? 0) + (kind === 'watch' ? Math.PI : 0);
  const cos = Math.cos(ry0);
  const sin = Math.sin(ry0);
  const lx = an.dx ?? 0;
  let lz = an.dz ?? 0;
  if (kind === 'sit' && an.dz == null) {
    // 无锚点 dz 的坐具兜底：坐在家具中心偏前缘
    lz = entry.fp[1] / 2 - 0.12;
  }
  return {
    tx: item.x + lx * cos + lz * sin,
    tz: item.z - lx * sin + lz * cos,
    ry,
    y: a.y ?? 0,
  };
}

/** 找最近的可坐家具 */
function nearestSeat(items: FurnitureItem[], from: Pt): FurnitureItem | null {
  let best: FurnitureItem | null = null;
  let bd = Infinity;
  for (const it of items) {
    if ((it.y ?? 0) > 0.45) continue;
    const e = CATALOG[it.kind];
    if (!e?.acts?.seat) continue;
    const d = Math.hypot(it.x - from.x, it.z - from.z);
    if (d < bd) {
      bd = d;
      best = it;
    }
  }
  return best;
}

/** 找最近的床（lie） */
function nearestBed(items: FurnitureItem[], from: Pt): FurnitureItem | null {
  let best: FurnitureItem | null = null;
  let bd = Infinity;
  for (const it of items) {
    if ((it.y ?? 0) > 0.45) continue;
    const e = CATALOG[it.kind];
    if (!e?.acts?.sleep) continue;
    const d = Math.hypot(it.x - from.x, it.z - from.z);
    if (d < bd) {
      bd = d;
      best = it;
    }
  }
  return best;
}

/** 朝某点走一步（含碰撞回推；返回是否已到 stop 距离内） */
function stepToward(
  c: CharRT,
  tx: number,
  tz: number,
  stop: number,
  dt: number,
  speed: number,
  collide: (c: CharRT) => void,
): boolean {
  const dx = tx - c.x;
  const dz = tz - c.z;
  const d = Math.hypot(dx, dz);
  if (d <= stop) {
    c.moving = false;
    return true;
  }
  const sp = Math.min(speed * dt, d - stop);
  c.x += (dx / d) * sp;
  c.z += (dz / d) * sp;
  c.moving = true;
  c.heading = lerpAngle(c.heading, Math.atan2(dx, dz), Math.min(1, dt * 10));
  collide(c);
  return false;
}

/** 沿路点前进；返回是否已消费完路径 */
function followPath(c: CharRT, path: Pt[], dt: number, collide: (c: CharRT) => void): boolean {
  const wp = path[0];
  if (!wp) {
    c.moving = false;
    return true;
  }
  const dx = wp.x - c.x;
  const dz = wp.z - c.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.2) {
    path.shift();
    return path.length === 0;
  }
  const sp = Math.min(WALK_SPEED * dt, d);
  c.x += (dx / d) * sp;
  c.z += (dz / d) * sp;
  c.moving = true;
  c.heading = lerpAngle(c.heading, Math.atan2(dx, dz), Math.min(1, dt * 10));
  collide(c);
  return false;
}

/** 完全复位到 idle（姿势归站） */
function toIdle(rt: CompanionRT, partnerPose: PoseSlot): void {
  rt.phase = 'idle';
  rt.cmd = null;
  rt.path = [];
  rt.target = null;
  rt.anchor = null;
  rt.itemId = null;
  rt.stuckT = 0;
  rt.repathed = false;
  rt.sitUntil = 0;
  partnerPose.pose = 'stand';
  partnerPose.y = 0;
}

/** 用户姿势是否可被陪伴系统接管（正在坐/躺/泡澡时不打断用户自己的动作） */
function userPoseReleasable(poseRef: PoseSlot): boolean {
  return poseRef.pose === 'stand' || poseRef.pose === 'hug' || poseRef.pose === 'holdhand';
}

/**
 * 每帧推进陪伴状态机。
 * 返回 true = 本帧由陪伴逻辑接管（GameLoop 跳过 roam）。
 */
export function companionStep(
  ta: CharRT,
  me: CharRT,
  rt: CompanionRT,
  dt: number,
  items: FurnitureItem[],
  grid: BlockGrid,
  doors: Record<'bed' | 'kt' | 'bath' | 'bal', DoorGate>,
  partnerPose: PoseSlot,
  poseRef: PoseSlot,
  collide: (c: CharRT) => void,
  joyMag: number,
  onEvent: (e: CompanionEvent) => void,
): boolean {
  // —— 消费新指令（seq 变化即触发） ——
  if (rt.cmd && rt.cmd.seq !== rt.lastSeq) {
    rt.lastSeq = rt.cmd.seq;
    const cmd = rt.cmd;
    if (cmd.kind === 'free') {
      toIdle(rt, partnerPose);
      if (userPoseReleasable(poseRef)) poseRef.pose = 'stand';
      return true;
    }
    // 起手：起身（从坐/躺/牵手状态被叫起）
    partnerPose.pose = 'stand';
    partnerPose.y = 0;
    if (userPoseReleasable(poseRef) && cmd.kind !== 'hug') poseRef.pose = 'stand';
    rt.phase = 'walk';
    rt.actT = 0;
    rt.stuckT = 0;
    rt.repathed = false;
    rt.sitUntil = 0;
    rt.anchor = null;
    rt.itemId = null;
    // —— 计算目标与路径 ——
    if (cmd.kind === 'come' || cmd.kind === 'hug' || cmd.kind === 'holdhand') {
      const dx = ta.x - me.x;
      const dz = ta.z - me.z;
      const d = Math.max(0.001, Math.hypot(dx, dz));
      const target = { x: me.x + (dx / d) * 0.6, z: me.z + (dz / d) * 0.6 };
      rt.target = target;
      rt.path = findPath(grid, { x: ta.x, z: ta.z }, target) ?? [];
    } else if (cmd.kind === 'goto') {
      const room = cmd.room ?? 'lr';
      const dest = randPointInRoomFree(grid, room);
      const route = planRoute(roomOf(ta.x, ta.z), room, doors);
      rt.path = route ? [...route, dest] : (findPath(grid, { x: ta.x, z: ta.z }, dest) ?? []);
      rt.target = dest;
    } else {
      // sit/lie/watch/lamp：解析家具 + 锚点
      let item = cmd.itemId ? items.find((f) => f.id === cmd.itemId) ?? null : null;
      if (cmd.kind === 'sit' && !item) item = nearestSeat(items, { x: ta.x, z: ta.z });
      if (cmd.kind === 'lie' && !item) item = nearestBed(items, { x: ta.x, z: ta.z });
      if (cmd.kind === 'watch') item = items.find((f) => f.kind === 'tv') ?? item;
      if (cmd.kind === 'lamp' && !item) {
        item =
          items.find((f) => CATALOG[f.kind]?.light && (f.y ?? 0) < 0.5) ??
          items.find((f) => CATALOG[f.kind]?.light) ??
          null;
      }
      if (!item) {
        onEvent({ ev: 'giveup', kind: cmd.kind, memo: cmd.memo });
        toIdle(rt, partnerPose);
        return true;
      }
      const anchor = companionAnchor(
        cmd.kind === 'lie' ? 'lie' : cmd.kind === 'watch' ? 'watch' : cmd.kind === 'lamp' ? 'lamp' : 'sit',
        item,
      );
      if (!anchor) {
        onEvent({ ev: 'giveup', kind: cmd.kind, memo: cmd.memo });
        toIdle(rt, partnerPose);
        return true;
      }
      rt.anchor = anchor;
      rt.itemId = item.id;
      rt.target = { x: anchor.tx, z: anchor.tz };
      rt.path = findPath(grid, { x: ta.x, z: ta.z }, { x: anchor.tx, z: anchor.tz }) ?? [];
    }
    return true;
  }

  if (!rt.cmd || rt.phase === 'idle') return false;
  const cmd = rt.cmd;

  switch (rt.phase) {
    case 'walk': {
      const t0 = rt.target;
      if (!t0) {
        toIdle(rt, partnerPose);
        return true;
      }
      const done = followPath(ta, rt.path, dt, collide);
      if (!done) stepToward(ta, t0.x, t0.z, ARRIVE, dt, WALK_SPEED, collide);
      // —— 卡死检测：0.9s 位移 < 0.05 → 重算一次路径；再卡 → 放弃 ——
      const moved = Math.hypot(ta.x - rt.stuckX, ta.z - rt.stuckZ);
      if (moved > 0.05) {
        rt.stuckT = 0;
        rt.stuckX = ta.x;
        rt.stuckZ = ta.z;
      } else {
        rt.stuckT += dt;
        if (rt.stuckT > 0.9) {
          if (!rt.repathed) {
            rt.repathed = true;
            rt.stuckT = 0;
            rt.stuckX = ta.x;
            rt.stuckZ = ta.z;
            rt.path = findPath(grid, { x: ta.x, z: ta.z }, t0) ?? [];
          } else {
            onEvent({ ev: 'giveup', kind: cmd.kind, itemId: rt.itemId ?? undefined, memo: cmd.memo });
            toIdle(rt, partnerPose);
            return true;
          }
        }
      }
      const remain = Math.hypot(t0.x - ta.x, t0.z - ta.z);
      if (remain < ARRIVE + 0.06) {
        // —— 到位：按指令分流 ——
        ta.moving = false;
        rt.stuckT = 0;
        if (cmd.kind === 'sit' || cmd.kind === 'lie' || cmd.kind === 'watch') {
          const a = rt.anchor;
          if (a) {
            ta.x = a.tx;
            ta.z = a.tz;
            ta.heading = a.ry;
          }
          partnerPose.pose = cmd.kind === 'lie' ? 'lie' : 'sit';
          partnerPose.y = a?.y ?? 0;
          rt.phase = 'sit';
          rt.sitUntil = rt.actT + SIT_MIN + Math.random() * (SIT_MAX - SIT_MIN);
          rt.actT = 0;
          onEvent({ ev: 'arrive', kind: cmd.kind, itemId: rt.itemId ?? undefined, memo: cmd.memo });
        } else if (cmd.kind === 'lamp') {
          if (rt.anchor) ta.heading = rt.anchor.ry;
          onEvent({ ev: 'arrive', kind: 'lamp', itemId: rt.itemId ?? undefined, memo: cmd.memo });
          toIdle(rt, partnerPose);
        } else if (cmd.kind === 'come') {
          ta.heading = Math.atan2(me.x - ta.x, me.z - ta.z);
          onEvent({ ev: 'arrive', kind: 'come', memo: cmd.memo });
          toIdle(rt, partnerPose);
        } else if (cmd.kind === 'hug') {
          rt.phase = 'hug';
          rt.actT = 0;
          partnerPose.pose = 'hug';
          if (userPoseReleasable(poseRef)) poseRef.pose = 'hug';
          onEvent({ ev: 'hugStart', kind: 'hug', memo: cmd.memo });
        } else if (cmd.kind === 'holdhand') {
          rt.phase = 'hold';
          rt.actT = 0;
          rt.holdAt = 0;
          rt.holdRoom = null;
          partnerPose.pose = 'holdhand';
          onEvent({ ev: 'holdStart', kind: 'holdhand', memo: cmd.memo });
        } else {
          toIdle(rt, partnerPose);
        }
      }
      return true;
    }
    case 'sit': {
      // —— 粘性坐姿：到点自行起身；新指令在上方消费块里已处理 ——
      rt.actT += dt;
      if (rt.actT >= rt.sitUntil) {
        onEvent({ ev: 'release', kind: cmd.kind, memo: '起身' });
        toIdle(rt, partnerPose);
      }
      return true;
    }
    case 'hug': {
      // —— 拥抱保持：贴在用户身前；用户走动 → 自动松开 ——
      rt.actT += dt;
      const dx = me.x - ta.x;
      const dz = me.z - ta.z;
      const d = Math.hypot(dx, dz);
      if (d > HUG_DIST + 0.08) stepToward(ta, me.x, me.z, HUG_DIST, dt, WALK_SPEED * 1.2, collide);
      else ta.moving = false;
      ta.heading = Math.atan2(dx, dz);
      if (joyMag > 0.3 || rt.actT > HUG_MAX || d > 1.3) {
        partnerPose.pose = 'stand';
        if (poseRef.pose === 'hug') poseRef.pose = 'stand';
        onEvent({ ev: 'release', kind: 'hug', memo: cmd.memo });
        toIdle(rt, partnerPose);
      }
      return true;
    }
    case 'hold': {
      // —— 牵手跟随：保持 0.5m 距离 + 防穿模；进新房间回报 room 事件 ——
      rt.actT += dt;
      const dx = me.x - ta.x;
      const dz = me.z - ta.z;
      const d = Math.hypot(dx, dz);
      if (d > HOLD_DIST + 0.12) {
        if (d > 1.15) {
          // 较远（可能隔家具/门）：A* 绕障（节流 0.6s 重算）+ 直奔兜底
          if (!rt.path.length || rt.actT - rt.holdAt > 0.6) {
            rt.holdAt = rt.actT;
            rt.path = findPath(grid, { x: ta.x, z: ta.z }, { x: me.x, z: me.z }) ?? [];
          }
          followPath(ta, rt.path, dt, collide);
          if (Math.hypot(me.x - ta.x, me.z - ta.z) > HOLD_DIST + 0.1) {
            stepToward(ta, me.x, me.z, HOLD_DIST, dt, WALK_SPEED * 1.5, collide);
          }
        } else {
          stepToward(ta, me.x, me.z, HOLD_DIST, dt, WALK_SPEED * 1.5, collide);
        }
      } else if (d < HOLD_DIST - 0.14) {
        // 太近：退半步防穿模
        const inv = 1 / Math.max(0.001, d);
        ta.x -= dx * inv * dt * 0.9;
        ta.z -= dz * inv * dt * 0.9;
        ta.moving = false;
        collide(ta);
      } else {
        ta.moving = false;
      }
      ta.heading = lerpAngle(ta.heading, Math.atan2(me.x - ta.x, me.z - ta.z), Math.min(1, dt * (ta.moving ? 6 : 8)));
      const room = roomOf(ta.x, ta.z);
      if (rt.holdRoom === null) rt.holdRoom = room;
      else if (room !== rt.holdRoom) {
        rt.holdRoom = room;
        onEvent({ ev: 'room', kind: 'holdhand', room, memo: cmd.memo });
      }
      return true;
    }
    default:
      return false;
  }
}

/** 陪伴小人是否空闲（宿主自主行动调度用：无指令且不在坐姿/拥抱/牵手） */
export function companionIdle(rt: CompanionRT): boolean {
  return rt.phase === 'idle' && !rt.cmd;
}
