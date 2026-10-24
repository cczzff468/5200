'use client';

/* eslint-disable react-hooks/immutability -- R3F/游戏循环需要原地修改 three 对象与运行时小人状态 */

/**
 * 情侣小家 3D —— 场景主体（R3F Canvas 内核，v5 两室一厅）
 *
 * - 生活模式：镜头跟随小人（滑动全方位旋转视角：左右任意转 + 上下低角↔近俯瞰；
 *   拖拽时 1:1 直接控制，松手恢复平滑跟随）+ 摇杆/WASD 移动 + 碰撞；
 *   指针系统按 pointerId 跟踪（双指捏合在生活模式不再引发旋转/缩放混乱）；
 *   从装修模式退出时从当前相机位置反推球坐标无缝接管 + 缩短追赶窗口；
 * - 走出家门：点门开门后，小人可经门洞走进卧室（隔墙两侧行走钳制 + 门走廊判定）；
 * - 编辑模式：OrbitControls 上帝视角 + 家具拖拽（双房间钳制 + 0.25m 吸附）
 *   + 移动模式（选中后拖动画面任意位置搬运）+ 四向按钮微调 + 缩放按钮；
 *   拖拽辅助 DragAid：全屋对齐网格增亮 + 吸附底座 + 重叠红框警告（E2）；
 * - 昼夜灯光切换：白天暖阳光 + 夜晚冷月光 + 灯具/窗户点光；开灯越多环境光越亮越暖（E7）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, PerformanceMonitor } from '@react-three/drei';
import Room, { buildWallBoxes } from './Room';
import Furn3D from './Furn3D';
import CharChibi3D from './CharChibi3D';
import {
  BAL_X0,
  BAL_X1,
  BAL_Z0,
  BAL_Z1,
  BATH_X0,
  BATH_X1,
  BATH_Z0,
  BATH_Z1,
  BED_X1,
  BED_Z0,
  BED_Z1,
  CATALOG,
  clampFurnToRooms,
  DOOR_PASS,
  KTCH_X1,
  ROOM_SPANS,
  ROOM_X,
  ROOM_Z,
  SNAP,
  DOORS,
  WINS,
  footprintOf,
  resolveDoorPos,
  resolveWinPos,
} from '../catalog';
import type { BoyWear, CatalogEntry, CharAction, CharPose, CharRT, FurnitureItem, GirlWear, HomeMode } from '../types';

// ---------------- 对外 Props ----------------

export interface HomeSceneProps {
  items: FurnitureItem[];
  mode: HomeMode;
  night: boolean;
  selId: string | null;
  /** 移动模式：true = 拖动画面即可搬运选中家具 */
  moveOn: boolean;
  meRT: CharRT;
  taRT: CharRT;
  joyRef: RefObject<{ dx: number; dy: number }>;
  /** 缩放指令队列（HUD 按钮 → 场内相机） */
  zoomCmd: RefObject<{ v: number; dir: number }>;
  /** 四向微调指令（HUD 方向按钮 → 按当前视角方位换算世界轴） */
  moveCmd: RefObject<{ v: number; dir: 'up' | 'down' | 'left' | 'right' }>;
  onNudge: (dx: number, dz: number) => void;
  /** 第一人称视角（true = 小人就是「我」） */
  fp?: boolean;
  fpRef: RefObject<{ on: boolean }>;
  /** 「我」的姿势 + 支撑面高度（坐下/睡觉/泡澡） */
  poseRef: RefObject<{ pose: CharPose; y: number }>;
  /** 正在执行的家具动作 */
  actRef: RefObject<CharAction | null>;
  /** 手持物（true = 右手拿小水杯，拿饮料/咖啡后端着到处逛） */
  carryRef?: RefObject<{ cup: boolean; coffee?: boolean }>;
  /** 乐器弹奏特写（非 null = 镜头推近该乐器；覆盖层 UI 发声） */
  instRef?: RefObject<{ kind: 'piano' | 'guitar'; itemId: string } | null>;
  /** 浴缸水龙头点击（放水/关水） */
  onFaucetTap?: (item: FurnitureItem) => void;
  /** 九扇窗开态 + 切换回调 */
  win?: boolean[];
  onToggleWin?: (i: number) => void;
  /** 每扇窗是否存在（false = 已被收起不渲染） */
  winExist?: boolean[];
  /** 每扇窗沿墙坐标 / 三扇门沿墙坐标 */
  winPos?: number[];
  doorPos?: { bed: number; kt: number; bath: number; bal?: number };
  /** 用户自定义地板/墙/门/窗框颜色（客厅） */
  floorCol?: string;
  wallCol?: string;
  doorCol?: string;
  winCol?: string;
  /** 卧室/厨房/卫生间地板墙壁 + 四房间天花板自定义色 */
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
  /** 三/四扇门开态 + 切换 */
  doorOpen?: boolean;
  kitchenDoorOpen?: boolean;
  bathDoorOpen?: boolean;
  balconyDoorOpen?: boolean;
  onToggleDoor?: () => void;
  onToggleKitchenDoor?: () => void;
  onToggleBathDoor?: () => void;
  onToggleBalconyDoor?: () => void;
  /** 阳台地板/墙自定义色（v5.7） */
  floorColBal?: string;
  wallColBal?: string;
  onFloorTap: () => void;
  onFurnTap: (item: FurnitureItem) => void;
  onDragEnd: (id: string) => void;
  /** 拖拽中的实时移动（吸附/钳位在此做） */
  onDragMove: (id: string, x: number, z: number) => void;
  onDragSelect: (id: string) => void;
  /** 编辑模式点选门窗（不开合） */
  onWallTap?: (id: string) => void;
  /** 「我」的衣柜穿搭（发型 + 连衣裙/分体 + 鞋；v6.2） */
  wear?: GirlWear;
  /** 「对方」的衣柜穿搭（发型 + 上衣/裤子 + 鞋；v6.3 男生换装） */
  wear2?: BoyWear;
  /** 正在进行的家具动作（灶台蒸汽 / 乐器音符联动） */
  activeAct?: { type: CharAction['type']; itemId: string; active: boolean } | null;
  /** 音响放歌中（音箱上方飘音符） */
  musicPlaying?: boolean;
  /** 天气特效：rain 雨 / snow 雪 / clear 无（窗外粒子） */
  weatherFx?: 'rain' | 'snow' | 'clear';
  /** 好菜上桌的餐桌 id（null = 没有饭菜） */
  mealTableId?: string | null;
  /** 地板纹理（全屋通用）：wood 木纹（默认）/ plain 素色 / check 瓷砖 */
  floorTex?: 'plain' | 'wood' | 'check';
  /** 墙纸纹理（全屋通用）：plain 素色（默认）/ dot 碎花 / stripe 条纹 */
  wallTex?: 'plain' | 'dot' | 'stripe';
  /** E7 灯光氛围：当前亮着的灯具数量（开灯越多环境光越亮越暖；缺省 0） */
  litLamps?: number;
  /** G3 彩蛋小生物：点击惊飞回调（kind = 蝴蝶/小鸟） */
  onCritterTap?: (kind: 'butterfly' | 'bird') => void;
}

/** 生活模式视角俯仰范围：接近水平（低角仰视）↔ 近乎俯瞰（全方位拉动视角） */
const PITCH_MIN = 0.22;
const PITCH_MAX = 1.5;

/** 家具动作 → 小人姿势（watch/work/game 也是坐姿；play 按乐器分流，见 act.pose） */
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

// ---------------- 小工具 ----------------

const clamp = THREE.MathUtils.clamp;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function lerpAngle(cur: number, target: number, k: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * k;
}

/** 家具双房间钳制：见 catalog.clampFurnToRooms（z < 隔墙 → 客厅；否则卧室） */

/**
 * 方案 B 兕底：把点推出墙体 AABB（外扩 pad 余量，沿最小穿透轴推出）——
 * 低俯仰/近距离时相机不再钻进墙里（字面穿墙）。只处理墙段盒，门洞区域可自由穿过。
 */
function pushCameraOutWalls(p: THREE.Vector3, boxes: THREE.Box3[]) {
  const pad = 0.15;
  for (const b of boxes) {
    const x0 = b.min.x - pad;
    const x1 = b.max.x + pad;
    const y0 = b.min.y - pad;
    const y1 = b.max.y + pad;
    const z0 = b.min.z - pad;
    const z1 = b.max.z + pad;
    if (p.x <= x0 || p.x >= x1 || p.y <= y0 || p.y >= y1 || p.z <= z0 || p.z >= z1) continue;
    const dx0 = p.x - x0;
    const dx1 = x1 - p.x;
    const dy0 = p.y - y0;
    const dy1 = y1 - p.y;
    const dz0 = p.z - z0;
    const dz1 = z1 - p.z;
    const m = Math.min(dx0, dx1, dy0, dy1, dz0, dz1);
    if (m === dx0) p.x = x0;
    else if (m === dx1) p.x = x1;
    else if (m === dy0) p.y = Math.max(y0, 0.3);
    else if (m === dy1) p.y = y1;
    else if (m === dz0) p.z = z0;
    else p.z = z1;
  }
}

/** 门开态 + 沿墙坐标（碰撞走廊判定用；ref 高频读取） */
export interface DoorLive {
  open: boolean;
  /** axis 'z' 墙 → x 坐标；axis 'x' 墙 → z 坐标 */
  along: number;
}

/**
 * 小人 vs 家具 AABB（膨胀 0.2）推出 + 房间边界钳制（抬升家具不挡路）。
 * v5.7 五区：客厅（西北）/ 卫生间（客厅东侧）/ 卧室 / 厨房（南排）/ 阳台（卧室南侧）——
 * 隔墙挡路，只有「对应门开着且在门走廊内」才能穿过（partner 传全关门永远留在客厅）。
 */
function collideAndClamp(
  c: CharRT,
  items: FurnitureItem[],
  bedDoor: DoorLive,
  ktDoor: DoorLive,
  bathDoor: DoorLive,
  balDoor: DoorLive,
) {
  for (const it of items) {
    const e = CATALOG[it.kind];
    if (!e || e.flat) continue;
    if ((it.y ?? 0) > 0.45) continue; // 电视上墙 / 桌面小物不参与行走碰撞
    const [w, d] = footprintOf(e, it.ry ?? 0);
    const hw = w / 2 + 0.2;
    const hd = d / 2 + 0.2;
    const dx = c.x - it.x;
    const dz = c.z - it.z;
    if (Math.abs(dx) > hw || Math.abs(dz) > hd) continue;
    const penX = hw - Math.abs(dx);
    const penZ = hd - Math.abs(dz);
    if (penX < penZ) c.x = it.x + (dx >= 0 ? hw : -hw);
    else c.z = it.z + (dz >= 0 ? hd : -hd);
  }
  const m = 0.35;
  const inBedCorr = bedDoor.open && Math.abs(c.x - bedDoor.along) < DOOR_PASS;
  const inKtCorr = ktDoor.open && Math.abs(c.x - ktDoor.along) < DOOR_PASS;
  const inBathCorr = bathDoor.open && Math.abs(c.z - bathDoor.along) < DOOR_PASS;
  const inBalCorr = balDoor.open && Math.abs(c.x - balDoor.along) < DOOR_PASS;
  if (c.z < BED_Z0) {
    // —— 北排：客厅（西）+ 卫生间（客厅东墙以东） ——
    if (c.x >= BATH_X0) {
      // 卫生间：西墙只有门走廊可穿，东/北/南为外墙
      c.x = clamp(c.x, inBathCorr ? BATH_X0 - m : BATH_X0 + m, BATH_X1 - m);
      c.z = clamp(c.z, -ROOM_Z + m, ROOM_Z - m);
    } else {
      // 客厅：东墙只有门走廊可穿；南隔墙两门走廊
      c.x = clamp(c.x, -ROOM_X + m, inBathCorr ? BATH_X0 + m : BATH_X0 - m);
      const zMax = inBedCorr || inKtCorr ? BED_Z0 + m : BED_Z0 - m;
      c.z = clamp(c.z, -ROOM_Z + m, zMax);
    }
  } else if (c.x < BED_X1) {
    // —— 卧室/阳台侧 ——
    c.x = clamp(c.x, -ROOM_X + m, BED_X1 - m);
    if (c.z > BED_Z1) {
      // 阳台：南/东栏杆、西外墙；北墙只有门走廊可穿
      const zMin = inBalCorr ? BED_Z1 - m : BED_Z1 + m;
      c.z = clamp(c.z, zMin, BAL_Z1 - m);
    } else {
      const zMax = inBalCorr ? BAL_Z1 - m : BED_Z1 - m;
      c.z = inBedCorr ? clamp(c.z, BED_Z0 - m, zMax) : clamp(c.z, BED_Z0 + m, zMax);
    }
  } else {
    // —— 厨房侧（北门通客厅；东墙 v5.4 起封闭） ——
    c.x = clamp(c.x, BED_X1 + m, KTCH_X1 - m);
    c.z = inKtCorr ? clamp(c.z, BED_Z0 - m, BED_Z1 - m) : clamp(c.z, BED_Z0 + m, BED_Z1 - m);
  }
}

/** partner 漫游 AI（只待在客厅，不破门） */
const CLOSED_DOOR: DoorLive = { open: false, along: 0 };
function wander(c: CharRT, dt: number, items: FurnitureItem[]) {
  const now = performance.now() / 1000;
  if (c.target) {
    const dx = c.target.x - c.x;
    const dz = c.target.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.12) {
      c.target = null;
      c.moving = false;
      c.nextWander = now + 2.5 + Math.random() * 5;
    } else {
      const sp = 1.05 * dt;
      c.x += (dx / d) * sp;
      c.z += (dz / d) * sp;
      c.moving = true;
      c.heading = lerpAngle(c.heading, Math.atan2(dx, dz), Math.min(1, dt * 8));
    }
    collideAndClamp(c, items, CLOSED_DOOR, CLOSED_DOOR, CLOSED_DOOR, CLOSED_DOOR);
  } else if (now > c.nextWander) {
    c.target = { x: rand(-ROOM_X + 0.7, ROOM_X - 0.7), z: rand(-ROOM_Z + 0.7, ROOM_Z - 0.9) };
  }
}

// ---------------- 键盘（WASD/方向键，桌面端调试/操作） ----------------

function useKeys(keysRef: RefObject<Set<string>>) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        keysRef.current?.add(k);
      }
    };
    const up = (e: KeyboardEvent) => keysRef.current?.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [keysRef]);
}

// ---------------- 游戏主循环（移动 + 相机跟随） ----------------

function GameLoop({
  meRT,
  taRT,
  joyRef,
  keysRef,
  azRef,
  pitchRef,
  distRef,
  modeRef,
  itemsRef,
  doorRef,
  lookRef,
  focusRef,
  fpRef,
  poseRef,
  actRef,
  wallBoxes,
  instRef,
}: {
  meRT: CharRT;
  taRT: CharRT;
  joyRef: RefObject<{ dx: number; dy: number }>;
  keysRef: RefObject<Set<string>>;
  azRef: RefObject<{ az: number }>;
  pitchRef: RefObject<{ p: number }>;
  distRef: RefObject<{ d: number }>;
  modeRef: RefObject<HomeMode>;
  itemsRef: RefObject<FurnitureItem[]>;
  /** 每扇门开态 + 沿墙坐标（ref 高频读取；bal = 阳台门 v5.7） */
  doorRef: RefObject<{ bed: DoorLive; kt: DoorLive; bath: DoorLive; bal?: DoorLive }>;
  /** 拖拽中 1:1 直接控制镜头（true 时不做惯性 lerp） */
  lookRef: RefObject<{ on: boolean }>;
  /** 相机对焦物（隔墙可见性用） */
  focusRef: RefObject<{ x: number; z: number }>;
  /** 第一人称视角开关 */
  fpRef: RefObject<{ on: boolean }>;
  /** 「我」的姿势（stand/sit/lie/bath + 支撑面高度） */
  poseRef: RefObject<{ pose: CharPose; y: number }>;
  /** 正在执行的家具动作（走向家具 → 摆姿势） */
  actRef: RefObject<CharAction | null>;
  /** 乐器弹奏特写（非 null = 镜头推近该乐器） */
  instRef?: RefObject<{ kind: 'piano' | 'guitar'; itemId: string } | null>;
  /** 墙段碰撞盒（随门位重建；生活模式相机防钻墙钳制用） */
  wallBoxes: THREE.Box3[];
}) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3 } | null;
  const desired = useRef(new THREE.Vector3());
  const lookAt = useRef(new THREE.Vector3());
  const prevMode = useRef<HomeMode>('live');
  const catchUp = useRef(0);
  const clock = useRef(0);
  const lastFp = useRef(false);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);

    // 对焦物：生活=小人 / 编辑=轨道中心（墙体遮挡淡出判定用；两种模式都要刷新）
    const modeNow = modeRef.current as HomeMode;
    focusRef.current.z = modeNow === 'edit' ? controls?.target?.z ?? 2.4 : meRT.z;
    focusRef.current.x = modeNow === 'edit' ? controls?.target?.x ?? 0 : meRT.x;

    if (modeNow !== 'live') {
      prevMode.current = modeNow;
      return;
    }

    // —— 模式切换无缝接管：装修 → 生活时从当前相机位置反推球坐标，
    //    视角从用户离开的地方继续；拖拽/松手都立即回到 1:1 手感 ——
    //    （第一人称打开时跳过球坐标接管，直接从眼位开始）
    if (prevMode.current !== 'live') {
      if (!fpRef.current?.on) {
        const off = camera.position.clone().sub(new THREE.Vector3(meRT.x, 0, meRT.z));
        const len = Math.max(off.length(), 0.001);
        if (azRef.current) azRef.current.az = Math.atan2(off.x, off.z);
        if (pitchRef.current)
          pitchRef.current.p = clamp(Math.asin(clamp(off.y / len, -1, 1)), PITCH_MIN, PITCH_MAX);
        if (distRef.current) distRef.current.d = clamp(len, 4.5, 11);
      }
      lookRef.current.on = false;
      catchUp.current = 0.55; // 短暂收紧到跟随轨道（比旧版更短，退出即能跟手拖动）
    }
    prevMode.current = 'live';

    // —— 家具动作优先：走向目标 → 摆姿势（坐下/睡觉/泡澡） ——
    const act = actRef.current;
    if (act && !act.arrived) {
      const dx = act.tx - meRT.x;
      const dz = act.tz - meRT.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.1) {
        const sp = 1.7 * dt;
        meRT.x += (dx / d) * Math.min(sp, d);
        meRT.z += (dz / d) * Math.min(sp, d);
        meRT.moving = true;
        meRT.heading = lerpAngle(meRT.heading, Math.atan2(dx, dz), Math.min(1, dt * 12));
      } else {
        meRT.moving = false;
        act.arrived = true;
        poseRef.current.pose = act.pose ?? POSE_OF_ACT[act.type] ?? 'sit';
        poseRef.current.y = act.y;
        act.onArrive?.();
      }
    } else if (act) {
      // 已摆好姿势：锁输入（摇杆/WASD 忽略）、不碰撞（人在家具上），朝向缓转向家具朝向
      meRT.moving = false;
      meRT.heading = lerpAngle(meRT.heading, act.ry, Math.min(1, dt * 6));
    } else {
      // —— 常规输入合成（摇杆 + 键盘） ——
      const j = joyRef.current ?? { dx: 0, dy: 0 };
      let mx = j.dx;
      let mz = j.dy;
      const keys = keysRef.current;
      if (keys && keys.size) {
        if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
        if (keys.has('d') || keys.has('arrowright')) mx += 1;
        if (keys.has('w') || keys.has('arrowup')) mz -= 1;
        if (keys.has('s') || keys.has('arrowdown')) mz += 1;
      }
      mx = clamp(mx, -1, 1);
      mz = clamp(mz, -1, 1);

      const az0 = azRef.current?.az ?? 0;
      const fx = -Math.sin(az0);
      const fz = -Math.cos(az0);
      const rx = Math.cos(az0);
      const rz = -Math.sin(az0);
      let vx = fx * -mz + rx * mx;
      let vz = fz * -mz + rz * mx;
      const len = Math.hypot(vx, vz);

      if (len > 0.04) {
        const sp = Math.min(1, len) * 2.7;
        meRT.x += (vx / len) * sp * dt;
        meRT.z += (vz / len) * sp * dt;
        meRT.moving = true;
        meRT.heading = lerpAngle(meRT.heading, Math.atan2(vx, vz), Math.min(1, dt * 14));
      } else {
        meRT.moving = false;
      }
      collideAndClamp(
        meRT,
        itemsRef.current ?? [],
        doorRef.current?.bed ?? CLOSED_DOOR,
        doorRef.current?.kt ?? CLOSED_DOOR,
        doorRef.current?.bath ?? CLOSED_DOOR,
        doorRef.current?.bal ?? CLOSED_DOOR,
      );
    }

    // partner 漫游（客厅内）
    wander(taRT, dt, itemsRef.current ?? []);

    clock.current += dt;
    const fpOn = fpRef.current?.on === true;
    // 切入第一人称时重置俯仰为平视（轨道视角的俯瞰角对眼睛没意义）
    if (fpOn && !lastFp.current && pitchRef.current) pitchRef.current.p = 0.12;
    lastFp.current = fpOn;

    // 第一人称眼高：坐/躺/泡时贴姿势支撑面
    const poseNow = poseRef.current?.pose ?? 'stand';
    const poseYNow = poseRef.current?.y ?? 0;
    const az = azRef.current?.az ?? 0;
    const eyeH =
      poseNow === 'stand'
        ? 0.84
        : poseNow === 'sit'
          ? Math.max(0.62, poseYNow + 0.42)
          : poseNow === 'bath'
            ? Math.max(0.66, poseYNow + 0.66)
            : Math.max(0.35, poseYNow + 0.24); // 躺在床上侧目

    // —— 乐器弹奏特写：镜头推到乐器斜前方（越过小人肩膀看琴键/琴弦），覆盖层 UI 发声 ——
    const inst = instRef?.current;
    if (inst) {
      const it = (itemsRef.current ?? []).find((f) => f.id === inst.itemId);
      if (it) {
        const ry = it.ry ?? 0;
        const fx = Math.sin(ry);
        const fz = Math.cos(ry);
        const rx = Math.cos(ry);
        const rz = -Math.sin(ry);
        const isPiano = inst.kind === 'piano';
        // 竖屏水平 FOV 很窄，特写机位要留足距离才能框住整件乐器
        const near = isPiano ? 1.95 : 1.8; // 相机离乐器中心（琴凳/站位一侧）
        const side = isPiano ? 0.95 : 1.32; // 肩侧偏移加大：越过肩膀看琴，避免后脑勺挡镜头
        const camY = isPiano ? 1.66 : 1.6;
        const lookNear = isPiano ? 0.3 : 0.15;
        const lookY = isPiano ? 0.78 : 0.66;
        desired.current.set(
          it.x + fx * near + rx * side,
          camY,
          it.z + fz * near + rz * side,
        );
        // 方案 B 兜底：特写镜头也不许钻墙
        pushCameraOutWalls(desired.current, wallBoxes);
        camera.position.lerp(desired.current, 1 - Math.exp(-dt * 3.2));
        lookAt.current.set(it.x + fx * lookNear - rx * 0.3, lookY, it.z + fz * lookNear - rz * 0.3);
        camera.lookAt(lookAt.current);
        const cam = camera as THREE.PerspectiveCamera;
        if (cam.isPerspectiveCamera && cam.fov !== 52) {
          cam.fov = 52;
          cam.updateProjectionMatrix();
        }
        // 对焦物 = 乐器（隔墙淡出判定用，不然琴身随镜头位置闪隐）
        focusRef.current.x = it.x;
        focusRef.current.z = it.z;
        return;
      }
    }

    if (fpOn) {
      // —— 第一人称：相机就是小人的眼睛（走路轻微颠簸，视角 = az/pitch） ——
      const az = azRef.current?.az ?? 0;
      const pitch = clamp(pitchRef.current?.p ?? 0, -0.5, 1.3);
      const bob = meRT.moving ? Math.abs(Math.sin(clock.current * 9)) * 0.032 : 0;
      camera.position.set(meRT.x, eyeH + bob, meRT.z);
      const cp = Math.cos(pitch);
      lookAt.current.set(
        meRT.x - Math.sin(az) * cp * 8,
        eyeH + bob - Math.sin(pitch) * 8,
        meRT.z - Math.cos(az) * cp * 8,
      );
      camera.lookAt(lookAt.current);
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.isPerspectiveCamera && cam.fov !== 66) {
        cam.fov = 66;
        cam.updateProjectionMatrix();
      }
    } else {
      // —— 第三人称跟随（球坐标：方位角 az / 俯仰 pitch / 距离 dist） ——
      const pitch = pitchRef.current?.p ?? 0.92;
      const dist = distRef.current?.d ?? 8.8;
      const cy = Math.sin(pitch) * dist;
      const ch = Math.cos(pitch) * dist;
      desired.current.set(meRT.x + Math.sin(az) * ch, cy + 0.55, meRT.z + Math.cos(az) * ch);
      // 方案 B 兕底：轨道目标点先推出墙体盒，低俯仰/近距离不再字面穿墙
      pushCameraOutWalls(desired.current, wallBoxes);

      if (lookRef.current?.on) {
        // 拖拽中：1:1 直接控制（与装修模式轨道同样的跟手感，无惯性延迟）
        camera.position.copy(desired.current);
      } else {
        const rate = catchUp.current > 0 ? 9 : 5;
        if (catchUp.current > 0) catchUp.current -= dt;
        camera.position.lerp(desired.current, 1 - Math.exp(-dt * rate));
      }
      lookAt.current.set(meRT.x, 1.0, meRT.z);
      camera.lookAt(lookAt.current);
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.isPerspectiveCamera && cam.fov !== 48) {
        cam.fov = 48;
        cam.updateProjectionMatrix();
      }
    }
  });
  return null;
}

// ---------------- 指针系统（生活视角旋转 / 编辑拖拽 / 移动模式搬运） ----------------

interface DragInfo {
  id: string;
  active: boolean;
  startX: number;
  startY: number;
}

function PointerRig({
  mode,
  modeRef,
  azRef,
  pitchRef,
  distRef,
  dragRef,
  moveSelRef,
  itemsRef,
  lookRef,
  fpRef,
  onDragMove,
  onDragEnd,
  onDragSelect,
}: {
  /** 当前模式（真值）：模式切换时全量复位手势状态（退出装修立刻解绑拖拽语境） */
  mode: HomeMode;
  modeRef: RefObject<HomeMode>;
  azRef: RefObject<{ az: number }>;
  pitchRef: RefObject<{ p: number }>;
  distRef: RefObject<{ d: number }>;
  dragRef: RefObject<DragInfo | null>;
  moveSelRef: RefObject<{ id: string | null; on: boolean }>;
  itemsRef: RefObject<FurnitureItem[]>;
  lookRef: RefObject<{ on: boolean }>;
  fpRef: RefObject<{ on: boolean }>;
  onDragMove: HomeSceneProps['onDragMove'];
  onDragEnd: HomeSceneProps['onDragEnd'];
  onDragSelect: HomeSceneProps['onDragSelect'];
}) {
  const { camera, gl, raycaster } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;

  // 回调存 ref：父组件重渲染（回调身份变化）不会拆装监听
  const cbRef = useRef({ onDragMove, onDragEnd, onDragSelect });
  useEffect(() => {
    cbRef.current = { onDragMove, onDragEnd, onDragSelect };
  });
  // 手势状态存 ref：即便 effect 重建也不丢「按住中」状态
  // pid：只跟踪第一根落屏的手指，第二根手指（捏合/误触）完全忽略 —— 生活模式不再被捏合搞乱视角
  const gesture = useRef({ down: false, pid: -1, lastX: 0, lastY: 0, moved: 0 });

  /** 手势全量复位：视角滑动/拖拽/移动搬运统一解绑（模式切换 / 页面失焦 / 后台化兜底） */
  const resetGesture = useCallback(
    (fireDragEnd: boolean) => {
      const d = dragRef.current;
      if (fireDragEnd && d?.active) cbRef.current.onDragEnd(d.id);
      dragRef.current = null;
      gesture.current = { down: false, pid: -1, lastX: 0, lastY: 0, moved: 0 };
      lookRef.current.on = false;
    },
    [dragRef, lookRef],
  );

  // ⚑ 模式切换（尤其装修→生活）瞬间：立刻解绑一切拖拽/手势状态。
  // 旧版生活模式旋转分支被 !dragRef 拦住，装修残留的拖拽语境会「吃掉」滑动视角 ——
  // 现在退出装修的同时清空全部手势状态，双保险。
  useEffect(() => {
    resetGesture(false);
    if (controls) controls.enabled = mode === 'edit' && !moveSelRef.current?.on;
  }, [mode]);

  useEffect(() => {
    const el = gl.domElement;
    // 阻止浏览器把画布拖拽当成原生 drag/选区拖动（否则 dragstart+pointercancel 会吞掉后续 pointermove）
    el.draggable = false;
    el.style.userSelect = 'none';
    el.style.setProperty('-webkit-user-drag', 'none');
    // ⚑ 触摸加固：把 touch-action 直接钉在真正的命中目标（canvas 元素本体）上，
    //   并在 touchmove 里 preventDefault（passive:false）—— 从根源杜绝浏览器把「滑动视角」
    //   认领成原生滚动/捏合后回 pointercancel 掐断手势（真机连续滑动被截断的元凶）。
    //   只拦 touchmove，不拦 touchstart/touchend —— 点家具/门窗的 click 合成不受影响。
    el.style.touchAction = 'none';
    const preventNative = (e: Event) => e.preventDefault();
    el.addEventListener('touchmove', preventNative, { passive: false });
    el.addEventListener('gesturestart', preventNative); // iOS Safari 双指捏合
    el.addEventListener('gesturechange', preventNative);
    const blockDrag = (e: Event) => e.preventDefault();
    el.addEventListener('dragstart', blockDrag);
    /** 页面失焦/后台化：手指可能永远等不到 pointerup，强制解绑防止手势卡死 */
    const onGone = () => resetGesture(true);
    const onVis = () => {
      if (document.hidden) resetGesture(true);
    };
    window.addEventListener('blur', onGone);
    document.addEventListener('visibilitychange', onVis);
    /** 拖拽平面：随目标家具高度调整（墙挂电视在其高度平面上拖动） */
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();

    const setNDC = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };

    /** 把拖拽平面移到目标所在高度（贴地家具 y=0；抬升家具在其水平面；窗 1.5 / 门 1.0） */
    const alignPlane = (id: string) => {
      if (id.startsWith('win-')) {
        plane.constant = -1.5;
        return;
      }
      if (id.startsWith('door-')) {
        plane.constant = -1.0;
        return;
      }
      const it = itemsRef.current?.find((f) => f.id === id);
      plane.constant = -(it?.y ?? 0);
    };

    const onDown = (e: PointerEvent) => {
      // 已有手指在屏（旋转/拖拽中）→ 后续手指全部忽略（捏合不搞乱视角/不再误缩放）
      if (gesture.current.down && gesture.current.pid !== e.pointerId) return;
      gesture.current.down = true;
      gesture.current.pid = e.pointerId;
      gesture.current.lastX = e.clientX;
      gesture.current.lastY = e.clientY;
      gesture.current.moved = 0;
      lookRef.current.on = false;

      // —— 移动模式：按下画布任意处即搬运选中家具 ——
      const ms = moveSelRef.current;
      if (modeRef.current === 'edit' && ms?.on && ms.id) {
        dragRef.current = { id: ms.id, active: true, startX: e.clientX, startY: e.clientY };
        alignPlane(ms.id);
        if (controls) controls.enabled = false;
        cbRef.current.onDragSelect(ms.id);
      }
    };

    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g.down || e.pointerId !== g.pid) return;
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      g.moved += Math.abs(dx) + Math.abs(dy);

      // —— 编辑模式：家具拖拽 / 移动模式搬运（仅编辑模式认领；残留状态绝不影响生活模式） ——
      const d = dragRef.current;
      if (modeRef.current === 'edit' && d) {
        if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 8) {
          d.active = true;
          alignPlane(d.id);
          if (controls) controls.enabled = false;
          cbRef.current.onDragSelect(d.id);
        }
        if (d.active) {
          setNDC(e);
          raycaster.setFromCamera(ndc, camera);
          if (raycaster.ray.intersectPlane(plane, hit)) {
            cbRef.current.onDragMove(d.id, hit.x, hit.z);
          }
          return;
        }
      }

      // —— 生活模式：滑动全方位旋转视角（左右任意转 / 上下低角↔近俯瞰；第一人称上下可仰视） ——
      //    与 dragRef 完全解耦：无任何残留状态能拦截旋转；无节流/防抖，连续跟手 ——
      if (modeRef.current === 'live') {
        if (g.moved > 4) lookRef.current.on = true; // 超过轻点阈值 → 1:1 直接控制
        const fpOn = fpRef.current?.on === true;
        const az = azRef.current;
        if (az) az.az -= dx * 0.0075;
        const p = pitchRef.current;
        if (p) p.p = clamp(p.p + dy * 0.005, fpOn ? -0.5 : PITCH_MIN, fpOn ? 1.3 : PITCH_MAX);
      }
    };

    const onUp = (e: PointerEvent) => {
      // 不是跟踪中的那根手指抬起 → 不结束手势
      if (gesture.current.down && e.pointerId !== gesture.current.pid) return;
      resetGesture(true);
      // 移动模式保持占用相机；普通拖拽结束后归还 OrbitControls
      if (controls) controls.enabled = modeRef.current === 'edit' && !moveSelRef.current?.on;
    };

    const onWheel = (e: WheelEvent) => {
      if (modeRef.current !== 'live') return;
      const dd = distRef.current;
      if (dd) dd.d = clamp(dd.d + e.deltaY * 0.004, 4.5, 11);
    };

    el.addEventListener('pointerdown', onDown);
    // ⚑ 捕获阶段挂 window：任何子元素的 stopPropagation 都吃不掉 move/up，滑动事件永不截断
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', preventNative);
      el.removeEventListener('gesturestart', preventNative);
      el.removeEventListener('gesturechange', preventNative);
      el.removeEventListener('dragstart', blockDrag);
      window.removeEventListener('blur', onGone);
      document.removeEventListener('visibilitychange', onVis);
    };
    // 仅依赖 three 稳定对象与 ref —— 回调已走 cbRef，重渲染不拆装
  }, [camera, gl, raycaster, controls, modeRef, azRef, pitchRef, distRef, dragRef, moveSelRef, lookRef, itemsRef, resetGesture]);

  return null;
}

// ---------------- 编辑模式缩放（HUD 按钮 → 相机推拉） ----------------

function ZoomPoker({ zoomCmd }: { zoomCmd: RefObject<{ v: number; dir: number }> }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const last = useRef(0);
  useFrame(() => {
    const cmd = zoomCmd.current;
    if (!cmd || cmd.v === last.current) return;
    last.current = cmd.v;
    if (!controls) return;
    const off = camera.position.clone().sub(controls.target);
    const len = THREE.MathUtils.clamp(off.length() * (cmd.dir > 0 ? 0.8 : 1.25), 3.2, 23);
    camera.position.copy(controls.target).add(off.setLength(len));
    controls.update();
  });
  return null;
}

// ---------------- 编辑网格（四房间四块） ----------------

function EditGrid() {
  const geo = useMemo(() => {
    const pts: number[] = [];
    const span = (x0: number, x1: number, z0: number, z1: number) => {
      for (let x = x0; x <= x1 + 0.001; x += SNAP) pts.push(x, 0.015, z0, x, 0.015, z1);
      for (let z = z0; z <= z1 + 0.001; z += SNAP) pts.push(x0, 0.015, z, x1, 0.015, z);
    };
    span(-ROOM_X, ROOM_X, -ROOM_Z, BED_Z0); // 客厅（西段；卫生间在东段单独一块）
    span(BATH_X0, BATH_X1, BATH_Z0, BATH_Z1); // 卫生间（客厅东侧）
    span(-ROOM_X, BED_X1, BED_Z0, BED_Z1); // 卧室
    span(BED_X1, KTCH_X1, BED_Z0, BED_Z1); // 厨房
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geo} renderOrder={1}>
      <lineBasicMaterial color="#a89a78" transparent opacity={0.55} depthWrite={false} />
    </lineSegments>
  );
}

// ---------------- E2 拖拽对齐辅助（网格增亮 + 吸附底座 + 重叠红警告） ----------------

/** 吸附底座配色：普通淡粉 / 重叠红色 */
const AID_PINK = '#f2b3c2';
const AID_RED = '#e05a4e';

/**
 * DragAid —— 装修模式拖拽辅助（全部 useFrame 原地改对象，零 setState，非拖拽零开销）：
 * ① 一块覆盖全屋的大 gridHelper（0.25m 一格 = SNAP），edit 极淡常显、拖拽中增亮、live 隐藏；
 * ② 拖拽中家具脚下的吸附底座（淡粉半透明面 + 描边框），跟随家具 x/z/ry，尺寸 = footprint；
 * ③ 底座 AABB 与其他家具相交 → 底座变红（跳过 flat 地毯 / y>0.45 桌上物 / 自己）。
 */
function DragAid({
  modeRef,
  dragRef,
  itemsRef,
}: {
  modeRef: RefObject<HomeMode>;
  dragRef: RefObject<DragInfo | null>;
  itemsRef: RefObject<FurnitureItem[]>;
}) {
  const grid = useRef<THREE.GridHelper>(null);
  const base = useRef<THREE.Group>(null);
  const fill = useRef<THREE.Mesh>(null);
  const rim = useRef<THREE.LineSegments>(null);
  /** 单位平面描边框：每帧按 footprint scale，几何不重建 */
  const rimGeo = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), []);
  useEffect(() => () => rimGeo.dispose(), [rimGeo]);

  useFrame((_, dtRaw) => {
    const d = Math.min(dtRaw, 0.05);
    const edit = modeRef.current === 'edit';
    const drag = dragRef.current;

    // ① 编辑网格：live 模式 visible=false；拖拽中透明度 0.08 → 0.22（damp 平滑）
    const gh = grid.current;
    if (gh) {
      gh.visible = edit;
      const mats = Array.isArray(gh.material) ? gh.material : [gh.material];
      const target = edit && drag?.active ? 0.22 : 0.08;
      for (const m of mats) {
        m.transparent = true;
        m.depthWrite = false;
        m.opacity = THREE.MathUtils.damp(m.opacity, edit ? target : 0, 9, d);
      }
    }

    // ②③ 吸附底座 + 重叠红警告（仅拖拽家具时每帧 O(n) 扫 items；win-/door- 拖拽找不到 → 隐藏）
    const g = base.current;
    const f = fill.current;
    const r = rim.current;
    if (!g || !f || !r) return;
    const it = edit && drag?.active ? itemsRef.current.find((q) => q.id === drag.id) : undefined;
    const entry = it ? CATALOG[it.kind] : undefined;
    if (!it || !entry) {
      g.visible = false;
      return;
    }
    const [fw1, fd1] = footprintOf(entry, it.ry ?? 0);
    let overlap = false;
    if (!entry.flat && (it.y ?? 0) <= 0.45) {
      const list = itemsRef.current;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o.id === it.id) continue;
        const e2 = CATALOG[o.kind];
        if (!e2 || e2.flat || (o.y ?? 0) > 0.45) continue;
        const [w2, d2] = footprintOf(e2, o.ry ?? 0);
        if (Math.abs(o.x - it.x) < (fw1 + w2) / 2 && Math.abs(o.z - it.z) < (fd1 + d2) / 2) {
          overlap = true;
          break;
        }
      }
    }
    g.visible = true;
    g.position.set(it.x, 0.02, it.z);
    g.rotation.y = it.ry ?? 0;
    const [w0, d0] = entry.fp;
    f.scale.set(w0, d0, 1);
    r.scale.set(w0, d0, 1);
    const fm = f.material as THREE.MeshBasicMaterial;
    fm.color.set(overlap ? AID_RED : AID_PINK);
    fm.opacity = overlap ? 0.3 : 0.18;
    const rm = r.material as THREE.LineBasicMaterial;
    rm.color.set(overlap ? AID_RED : AID_PINK);
    rm.opacity = overlap ? 0.6 : 0.35;
  });

  return (
    <group>
      {/* 大网格：x∈[-4.5,8.5]（宽13）、z 中心 3.75，0.25m 一格 = 52 分割，盖住五房间地面 */}
      <gridHelper
        ref={grid}
        args={[13, 52, '#d8b0a8', '#a89a78']}
        position={[2, 0.012, 3.75]}
        material-transparent
        material-opacity={0.08}
        material-depthWrite={false}
        renderOrder={1}
        visible={false}
      />
      <group ref={base} visible={false}>
        <mesh ref={fill} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color={AID_PINK} transparent opacity={0.18} depthWrite={false} />
        </mesh>
        <lineSegments ref={rim} geometry={rimGeo} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
          <lineBasicMaterial color={AID_PINK} transparent opacity={0.35} depthWrite={false} />
        </lineSegments>
      </group>
    </group>
  );
}

// ---------------- 移动模式接管相机（激活时禁用轨道旋转） ----------------

function MoveModeGate({ moveOn, mode }: { moveOn: boolean; mode: HomeMode }) {
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  useEffect(() => {
    if (controls) controls.enabled = mode === 'edit' && !moveOn;
  }, [controls, moveOn, mode]);
  return null;
}

// ---------------- 四向微调（HUD 方向按钮 → 按当前视角方位换算世界轴） ----------------

function NudgePoker({
  moveCmd,
  onNudge,
}: {
  moveCmd: RefObject<{ v: number; dir: 'up' | 'down' | 'left' | 'right' }>;
  onNudge: (dx: number, dz: number) => void;
}) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  const last = useRef(0);
  useFrame(() => {
    const cmd = moveCmd.current;
    if (!cmd || cmd.v === last.current) return;
    last.current = cmd.v;
    // 相机方位角 → 吸附到最近的 90° 象限，方向按钮永远沿屏幕视觉方向移动
    const t = controls?.target;
    const az = Math.atan2(
      camera.position.x - (t?.x ?? 0),
      camera.position.z - (t?.z ?? 0),
    );
    const q = Math.round(az / (Math.PI / 2)) * (Math.PI / 2);
    const fx = -Math.sin(q);
    const fz = -Math.cos(q);
    let dx = 0;
    let dz = 0;
    if (cmd.dir === 'up') {
      dx = fx;
      dz = fz;
    } else if (cmd.dir === 'down') {
      dx = -fx;
      dz = -fz;
    } else if (cmd.dir === 'left') {
      dx = fz;
      dz = -fx;
    } else {
      dx = -fz;
      dz = fx;
    }
    onNudge(dx, dz);
  });
  return null;
}

// ---------------- 编辑相机（进入装修模式时拉到俯瞰位，罩住四室一厅） ----------------

function EditCameraKick({ mode }: { mode: HomeMode }) {
  const { camera } = useThree();
  const prev = useRef<HomeMode>(mode);
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (mode === 'edit' && prev.current !== 'edit') {
      // 东南斜上空俯瞰位（四室全罩住），竖屏窄视野也够广
      cam.position.set(12.6, 16.8, 17.4);
      if (cam.isPerspectiveCamera) {
        cam.fov = 55;
        cam.updateProjectionMatrix();
      }
      cam.lookAt(2.9, 0.3, 2.5);
    }
    prev.current = mode;
  }, [mode, camera]);
  return null;
}

// ---------------- 灯光（昼夜 mix 平滑过渡） ----------------

const DAY_BG = '#efe8da';
const NIGHT_BG = '#24272f';
const _TMP_C = /* @__PURE__ */ new THREE.Color();
const _WARM = /* @__PURE__ */ new THREE.Color(); // E7 夜晚开灯 → 环境光向暖色偏移的目标色
const _COOL_C = /* @__PURE__ */ new THREE.Color(); // G5 雨天阴沉 → 环境/半球光向冷灰偏移的目标色

/**
 * E2 昼夜平滑：mix 每帧向目标阻尼（0=白天 / 1=夜晚），驱动天空底色；
 * 全局灯照强度/颜色随 mix 渐变（见 Lights），窗内星空/墙色微差保持瞬切（感知权重低）。
 */
function NightBlend({ night, mixRef }: { night: boolean; mixRef: RefObject<{ v: number }> }) {
  const scene = useThree((s) => s.scene);
  const bg = useMemo(() => new THREE.Color(DAY_BG), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  useFrame((_, dt) => {
    mixRef.current.v = THREE.MathUtils.damp(mixRef.current.v, night ? 1 : 0, 2.2, Math.min(dt, 0.05));
    tmp.set(DAY_BG).lerp(_TMP_C.set(NIGHT_BG), mixRef.current.v);
    bg.copy(tmp);
    scene.background = bg;
  });
  return null;
}

/** D4 画质档位：FPS 自适应降级（dpr 钳制 + 阴影分辨率/开关） */
export type SceneQuality = 'high' | 'mid' | 'low';
/** 档位 → Canvas dpr 区间 */
const Q_DPR: Record<SceneQuality, [number, number]> = {
  high: [1, 1.75],
  mid: [1, 1.35],
  low: [0.85, 1],
};
/** 档位 → 主光阴影贴图边长（low = 整关阴影） */
const Q_SHADOW: Record<SceneQuality, number> = { high: 1024, mid: 512, low: 0 };

function Lights({
  night,
  mixRef,
  quality,
  litLamps = 0,
  gloomy = false,
}: {
  night: boolean;
  mixRef: RefObject<{ v: number }>;
  quality: SceneQuality;
  /** E7：亮着的灯具数量（越多环境光越亮越暖；夜晚全额生效，白天 ×0.3） */
  litLamps?: number;
  /** G5 雨天阴沉：环境/半球光变暗变冷（damp 平滑过渡，不瞬切；雪不动灯光） */
  gloomy?: boolean;
}) {
  const dir = useRef<THREE.DirectionalLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const tmp = useMemo(() => new THREE.Color(), []);
  /** G5 阴沉系数（0=晴 / 1=雨天全值），每帧 damp */
  const gloomRef = useRef(0);
  useEffect(() => {
    // 切换昼夜时重投阴影
    dir.current?.shadow?.camera?.updateProjectionMatrix();
  }, [night]);
  // D4：画质档位变化 → 重分配阴影贴图尺寸（dispose 旧贴图才会按新 mapSize 重建）
  useEffect(() => {
    const l = dir.current;
    if (!l) return;
    l.castShadow = quality !== 'low';
    const size = Q_SHADOW[quality];
    if (size > 0 && l.shadow.mapSize.width !== size) {
      l.shadow.mapSize.set(size, size);
      if (l.shadow.map) {
        l.shadow.map.dispose();
        l.shadow.map = null;
      }
      l.shadow.camera.updateProjectionMatrix();
    }
  }, [quality]);
  useFrame((_, dt) => {
    const k = mixRef.current.v;
    const d = Math.min(dt, 0.05);
    // E7 灯光氛围：亮着的灯具越多环境光越亮越暖（直接加进 damp 目标值，昼夜 damp 不受影响）
    const lit = Math.min(litLamps, 5);
    const dayK = night ? 1 : 0.3; // 夜晚全额生效，白天轻微
    // G5 雨天氛围：在昼夜 damp 目标上再让环境/半球光亮度 ×0.85 + 色调向冷灰偏移（平滑过渡）
    gloomRef.current = THREE.MathUtils.damp(gloomRef.current, gloomy ? 1 : 0, 2.2, d);
    const gloom = 1 - 0.15 * gloomRef.current;
    if (amb.current) {
      amb.current.intensity = THREE.MathUtils.damp(
        amb.current.intensity,
        ((night ? 0.55 : 0.95) + lit * 0.07 * dayK) * gloom,
        2.2,
        d,
      );
      // 昼夜 lerp 完成后再向暖色微调（tmp 是复用临时色，必须等 lerp 用完再叠加，且只在夜晚生效）
      amb.current.color
        .copy(tmp.set('#fff3e0').lerp(_TMP_C.set('#a8b4cd'), k))
        .lerp(_WARM.set('#ffdcb0'), lit * 0.06 * (night ? 1 : 0))
        .lerp(_COOL_C.set('#8d99ad'), gloomRef.current * 0.35);
    }
    if (hemi.current) {
      hemi.current.intensity = THREE.MathUtils.damp(
        hemi.current.intensity,
        ((night ? 0.5 : 0.55) + lit * 0.05 * dayK) * gloom,
        2.2,
        d,
      );
      hemi.current.color
        .copy(tmp.set('#fdf6e8').lerp(_TMP_C.set('#39415c'), k))
        .lerp(_COOL_C.set('#8d99ad'), gloomRef.current * 0.3);
      hemi.current.groundColor.copy(tmp.set('#e5d6b8').lerp(_TMP_C.set('#23252c'), k));
    }
    if (dir.current) {
      dir.current.intensity = THREE.MathUtils.damp(dir.current.intensity, night ? 0.35 : 1.55, 2.2, d);
      dir.current.color.copy(tmp.set('#ffe9c8').lerp(_TMP_C.set('#b9c8e2'), k));
      // 太阳/月亮方位也缓推
      dir.current.position.x = THREE.MathUtils.damp(dir.current.position.x, night ? -4 : 5, 2, d);
      dir.current.position.z = THREE.MathUtils.damp(dir.current.position.z, night ? -3 : 4, 2, d);
    }
  });
  return (
    <>
      <ambientLight ref={amb} intensity={0.95} color="#fff3e0" />
      <hemisphereLight ref={hemi} args={['#fdf6e8', '#e5d6b8', 0.55]} />
      <directionalLight
        ref={dir}
        castShadow
        position={[5, 7.5, 4]}
        intensity={1.55}
        color="#ffe9c8"
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-camera-near={0.5}
        shadow-camera-far={30}
        shadow-bias={-0.0006}
      />
    </>
  );
}

/**
 * C6 睡觉小夜灯：躺床时小人身边亮起一盏暖色小夜灯（全屋主灯已自动关闭），
 * 起床后缓缓熄灭。
 */
function BedNightLight({ poseRef, meRT }: { poseRef: RefObject<{ pose: CharPose; y: number }>; meRT: CharRT }) {
  const light = useRef<THREE.PointLight>(null);
  useFrame((_, dt) => {
    const l = light.current;
    if (!l) return;
    const on = poseRef.current?.pose === 'lie';
    l.intensity = THREE.MathUtils.damp(l.intensity, on ? 0.55 : 0, 3, Math.min(dt, 0.05));
    l.position.set(meRT.x, 0.85, meRT.z);
  });
  return <pointLight ref={light} color="#ffd9a0" intensity={0} distance={2.6} decay={2} />;
}

// ---------------- Canvas 主体 ----------------

export default function HomeScene(props: HomeSceneProps) {
  // D4：FPS 自适应画质（PerformanceMonitor 检测掉帧逐级降，恢复后逐级升；连续抖动 2 次锁最低）
  const [quality, setQuality] = useState<SceneQuality>('high');
  const {
    items, mode, night, selId, moveOn, meRT, taRT, joyRef, zoomCmd, moveCmd, onNudge, fp, fpRef,
    poseRef, actRef, carryRef, instRef, onFaucetTap, activeAct, mealTableId, floorTex, wallTex, wear, wear2,
    win, onToggleWin, winExist, winPos, doorPos,
    floorCol, wallCol, doorCol, winCol, floorColBed, wallColBed, floorColK, wallColK, floorColB, wallColB,
    floorColBal, wallColBal,
    ceilCol, ceilColBed, ceilColK, ceilColB,
    doorOpen, kitchenDoorOpen, bathDoorOpen, balconyDoorOpen, onToggleDoor, onToggleKitchenDoor, onToggleBathDoor, onToggleBalconyDoor,
    musicPlaying, weatherFx, litLamps, onCritterTap,
    onFloorTap, onFurnTap, onDragEnd, onDragMove, onDragSelect, onWallTap,
  } = props;

  const modeRef = useRef<HomeMode>(mode);
  const itemsRef = useRef<FurnitureItem[]>(items);
  /** E2 昼夜混合系数（0=白天 → 1=夜晚，每帧阻尼） */
  const nightMixRef = useRef({ v: night ? 1 : 0 });
  const winPosRef = useRef(winPos);
  const doorPosRef = useRef(doorPos);
  const doorRef = useRef({
    bed: { open: !!doorOpen, along: DOORS[0].def },
    kt: { open: !!kitchenDoorOpen, along: DOORS[1].def },
    bath: { open: !!bathDoorOpen, along: DOORS[2].def },
    bal: { open: !!balconyDoorOpen, along: DOORS[3].def },
  });
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    winPosRef.current = winPos;
    doorPosRef.current = doorPos;
  }, [winPos, doorPos]);
  useEffect(() => {
    doorRef.current.bed.open = !!doorOpen;
    doorRef.current.kt.open = !!kitchenDoorOpen;
    doorRef.current.bath.open = !!bathDoorOpen;
    doorRef.current.bal.open = !!balconyDoorOpen;
  }, [doorOpen, kitchenDoorOpen, bathDoorOpen, balconyDoorOpen]);
  useEffect(() => {
    doorRef.current.bed.along = doorPos?.bed ?? DOORS[0].def;
    doorRef.current.kt.along = doorPos?.kt ?? DOORS[1].def;
    doorRef.current.bath.along = doorPos?.bath ?? DOORS[2].def;
    doorRef.current.bal.along = doorPos?.bal ?? DOORS[3].def;
  }, [doorPos]);

  const azRef = useRef({ az: 0 });
  const pitchRef = useRef({ p: 0.92 });
  const distRef = useRef({ d: 8.8 });

  /** 墙段碰撞盒（随门位变化重建；生活模式相机防钻墙钳制用） */
  const wallBoxes = useMemo(
    () =>
      buildWallBoxes(
        doorPos?.bed ?? DOORS[0].def,
        doorPos?.kt ?? DOORS[1].def,
        doorPos?.bath ?? DOORS[2].def,
        doorPos?.bal ?? DOORS[3].def,
      ),
    [doorPos?.bed, doorPos?.kt, doorPos?.bath, doorPos?.bal],
  );

  /** 任一投影仪开着（幕布放下放电影） */
  const projectorOn = items.some((f) => f.kind === 'projector' && f.st?.on);
  /** G5 雨天氛围：rain 时环境光阴沉（内部换算传给 Lights，不进 Props 合同） */
  const gloomy = weatherFx === 'rain';
  /** 正坐着的家具（吊篮秋千摆幅加大） */
  const sittingId = activeAct?.active && activeAct.type === 'sit' ? activeAct.itemId : null;

  const dragRef = useRef<DragInfo | null>(null);
  const lookRef = useRef({ on: false });
  /** 相机对焦物（生活=小人 / 编辑=轨道中心）→ 隔墙判断是否挡在镜头与它之间 */
  const focusRef = useRef({ x: 0, z: 2.4 });
  const moveSelRef = useRef<{ id: string | null; on: boolean }>({ id: null, on: false });
  useEffect(() => {
    moveSelRef.current = { id: moveOn ? selId : null, on: moveOn && !!selId };
  }, [moveOn, selId]);
  const keysRef = useRef<Set<string>>(new Set());
  useKeys(keysRef);

  const onFurnPointerDown = (e: ThreeEvent<PointerEvent>, item: FurnitureItem) => {
    if (modeRef.current === 'edit') {
      dragRef.current = { id: item.id, active: false, startX: e.nativeEvent.clientX, startY: e.nativeEvent.clientY };
    }
  };

  /** 编辑模式：门窗按下 → 同家具一样进入拖拽语境（沿墙滑行） */
  const onWallPointerDown = (e: ThreeEvent<PointerEvent>, id: string) => {
    if (modeRef.current === 'edit') {
      dragRef.current = { id, active: false, startX: e.nativeEvent.clientX, startY: e.nativeEvent.clientY };
    }
  };

  /** 拖拽实时钳位 + 吸附（家具四房间钳制；门窗沿墙滑行 + 避让同墙邻居） */
  const handleDragMove = (id: string, x: number, z: number) => {
    if (id.startsWith('win-')) {
      const i = Number(id.slice(4));
      const w = WINS[i];
      if (!w) return;
      const r = resolveWinPos(i, w.axis === 'z' ? x : z, winPosRef.current, doorPosRef.current);
      onDragMove(id, r.x, r.z);
      return;
    }
    if (id.startsWith('door-')) {
      const did = id.slice(5) as 'bed' | 'kt' | 'bath' | 'bal';
      const d = DOORS.find((x) => x.id === did);
      if (!d) return;
      const r = resolveDoorPos(did, d.axis === 'z' ? x : z, winPosRef.current, doorPosRef.current);
      onDragMove(id, r.x, r.z);
      return;
    }
    const it = itemsRef.current.find((f) => f.id === id);
    if (it) {
      const e: CatalogEntry | undefined = CATALOG[it.kind];
      const [w, d] = e ? footprintOf(e, it.ry ?? 0) : [0.5, 0.5];
      const hw = Math.max(w / 2, 0.18);
      const hd = Math.max(d / 2, 0.18);
      const sx = Math.round(x / SNAP) * SNAP;
      const sz = Math.round(z / SNAP) * SNAP;
      const [cx, cz] = clampFurnToRooms(sx, sz, hw, hd);
      onDragMove(id, cx, cz);
    }
  };

  return (
    <Canvas
      gl={{ preserveDrawingBuffer: true }}
      shadows="soft"
      dpr={Q_DPR[quality]}
      camera={{ fov: 48, near: 0.1, far: 80, position: [0, 6.2, 7.4] }}
      style={{ touchAction: 'none' }}
      resize={{ offsetSize: true }}
      performance={{ min: 0.5 }}
    >
      <PerformanceMonitor
        onDecline={() => setQuality((q) => (q === 'high' ? 'mid' : 'low'))}
        onIncline={() => setQuality((q) => (q === 'low' ? 'mid' : 'high'))}
        flipflops={2}
        onFallback={() => setQuality('low')}
      />
      <NightBlend night={night} mixRef={nightMixRef} />
      <Lights night={night} mixRef={nightMixRef} quality={quality} litLamps={litLamps} gloomy={gloomy} />
      <Room
        night={night}
        onFloorTap={onFloorTap}
        editMode={mode === 'edit'}
        selWall={selId && (selId.startsWith('win-') || selId.startsWith('door-')) ? selId : null}
        onWallTap={onWallTap}
        onWallPointerDown={onWallPointerDown}
        win={win}
        onToggleWin={onToggleWin}
        winExist={winExist}
        winPos={winPos}
        doorPos={doorPos}
        floorCol={floorCol}
        wallCol={wallCol}
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
        doorCol={doorCol}
        winCol={winCol}
        doorOpen={doorOpen}
        kitchenDoorOpen={kitchenDoorOpen}
        bathDoorOpen={bathDoorOpen}
        balconyDoorOpen={balconyDoorOpen}
        onToggleDoor={onToggleDoor}
        onToggleKitchenDoor={onToggleKitchenDoor}
        onToggleBathDoor={onToggleBathDoor}
        onToggleBalconyDoor={onToggleBalconyDoor}
        focusRef={focusRef}
        floorTex={floorTex}
        wallTex={wallTex}
      />
      {mode === 'edit' && <EditGrid />}
      <DragAid modeRef={modeRef} dragRef={dragRef} itemsRef={itemsRef} />

      {items.map((item) => {
        const entry = CATALOG[item.kind];
        if (!entry) return null;
        return (
          <Furn3D
            key={item.id}
            item={item}
            entry={entry}
            night={night}
            mode={mode}
            selected={selId === item.id}
            moving={moveOn && selId === item.id}
            onPointerDown={onFurnPointerDown}
            onTap={onFurnTap}
            onFaucetTap={onFaucetTap}
            cooking={activeAct?.type === 'cook' && activeAct.active && activeAct.itemId === item.id}
            playing={activeAct?.type === 'play' && activeAct.active && activeAct.itemId === item.id}
            meal={!!mealTableId && mealTableId === item.id}
            projectorOn={projectorOn}
            sitting={sittingId === item.id}
          />
        );
      })}

      <CharChibi3D rt={meRT} who="me" hide={fp && mode === 'live'} poseRef={poseRef} carryRef={carryRef} wear={wear} />
      <CharChibi3D rt={taRT} who="partner" wear2={wear2} />
      <BedNightLight poseRef={poseRef} meRT={meRT} />
      <WeatherFX kind={weatherFx ?? 'clear'} win={win} winExist={winExist} winPos={winPos} />
      <GlassRain kind={weatherFx ?? 'clear'} winExist={winExist} winPos={winPos} />
      <SnowDeco kind={weatherFx ?? 'clear'} winExist={winExist} winPos={winPos} />
      <Critters mode={mode} items={items} onCritterTap={onCritterTap} />
      <SpeakerNotes items={items} active={!!musicPlaying} />
      <EditCameraKick mode={mode} />
      <ZoomPoker zoomCmd={zoomCmd} />
      <NudgePoker moveCmd={moveCmd} onNudge={onNudge} />
      <MoveModeGate moveOn={moveOn} mode={mode} />

      {mode === 'edit' && (
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={3.2}
          maxDistance={30}
          minPolarAngle={0.12}
          maxPolarAngle={1.32}
          target={[2.9, 0.4, 2.5]}
          screenSpacePanning={false}
        />
      )}

      <GameLoop
        meRT={meRT}
        taRT={taRT}
        joyRef={joyRef}
        keysRef={keysRef}
        azRef={azRef}
        pitchRef={pitchRef}
        distRef={distRef}
        modeRef={modeRef}
        itemsRef={itemsRef}
        doorRef={doorRef}
        lookRef={lookRef}
        focusRef={focusRef}
        fpRef={fpRef}
        poseRef={poseRef}
        actRef={actRef}
        wallBoxes={wallBoxes}
        instRef={instRef}
      />
      <PointerRig
        mode={mode}
        modeRef={modeRef}
        azRef={azRef}
        pitchRef={pitchRef}
        distRef={distRef}
        dragRef={dragRef}
        moveSelRef={moveSelRef}
        itemsRef={itemsRef}
        lookRef={lookRef}
        fpRef={fpRef}
        onDragMove={handleDragMove}
        onDragEnd={onDragEnd}
        onDragSelect={onDragSelect}
      />
    </Canvas>
  );
}

// ---------------- 天气特效：窗外雨/雪（v5.7 F4 真实天气联动） ----------------

/** 雨丝贴图（竖向细条纹，循环下滚） */
function makeRainTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 256;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 256);
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 256;
    const len = 10 + Math.random() * 16;
    ctx.strokeStyle = `rgba(190,214,235,${0.35 + Math.random() * 0.4})`;
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 2.5, y + len);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 雪点贴图（圆形柔边白点） */
function makeSnowTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 256;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 256);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 256;
    const r = 1.6 + Math.random() * 2.8;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 窗外天气幕帘：每扇窗户外侧挂一片循环滚动的雨/雪贴图（廉价高效，透过玻璃看雨最真）。
 * kind = 'clear' 时整组隐藏。
 */
function WeatherFX({
  kind,
  win,
  winExist,
  winPos,
}: {
  kind: 'rain' | 'snow' | 'clear';
  win?: boolean[];
  winExist?: boolean[];
  winPos?: number[];
}) {
  const rainTex = useMemo(() => makeRainTexture(), []);
  const snowTex = useMemo(() => makeSnowTexture(), []);
  useFrame((_, dt) => {
    if (kind === 'clear') return;
    const tex = kind === 'snow' ? snowTex : rainTex;
    const speed = kind === 'snow' ? 0.055 : 0.29;
    tex.offset.y = (tex.offset.y - dt * speed) % 1;
    tex.offset.x = kind === 'snow' ? Math.sin(performance.now() / 2600) * 0.06 : 0;
  });
  const activeTex = kind === 'snow' ? snowTex : kind === 'rain' ? rainTex : null;
  return (
    <group>
      {WINS.map((w, i) => {
        if (winExist && winExist[i] === false) return null; // 已收起的窗不挂雨雪
        const along = winPos?.[i] ?? w.def;
        const x = w.axis === 'z' ? along : w.at + w.side * 0.5;
        const z = w.axis === 'z' ? w.at + w.side * 0.5 : along;
        const ry = w.ry;
        return (
          <mesh key={i} position={[x, 1.55, z]} rotation={[0, ry, 0]} visible={kind !== 'clear'}>
            <planeGeometry args={[1.9, 2.5]} />
            {activeTex ? (
              <meshBasicMaterial
                map={activeTex}
                transparent
                opacity={kind === 'snow' ? 0.85 : 0.75}
                depthWrite={false}
                toneMapped={false}
              />
            ) : (
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            )}
          </mesh>
        );
      })}
    </group>
  );
}

// ---------------- G5 积雪/水珠 + G3 彩蛋小生物（v6.1；G2 远景幕帘已按需求移除） ----------------

/** G5 玻璃水珠贴图（圆珠 + 竖向水痕） */
function makeGlassRainTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 256;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 256);
  // 三道水痕
  for (let i = 0; i < 3; i++) {
    const x = 16 + Math.random() * 96;
    const y = Math.random() * 120;
    const h = 70 + Math.random() * 90;
    const lg = ctx.createLinearGradient(0, y, 0, y + h);
    lg.addColorStop(0, 'rgba(225,238,248,0.05)');
    lg.addColorStop(0.8, 'rgba(225,238,248,0.3)');
    lg.addColorStop(1, 'rgba(225,238,248,0.05)');
    ctx.strokeStyle = lg;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 1.5, y + h);
    ctx.stroke();
  }
  // 圆珠
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 256;
    const r = 1.2 + Math.random() * 2.6;
    const rg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,0.9)');
    rg.addColorStop(0.55, 'rgba(214,232,244,0.5)');
    rg.addColorStop(1, 'rgba(214,232,244,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.4, 1.6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** G5 雨天玻璃水珠层：贴在每扇窗玻璃外表面，极缓慢下滑 */
function GlassRain({ kind, winExist, winPos }: { kind: 'rain' | 'snow' | 'clear'; winExist?: boolean[]; winPos?: number[] }) {
  const tex = useMemo(() => makeGlassRainTexture(), []);
  useFrame((_, dt) => {
    if (kind !== 'rain') return;
    tex.offset.y = (tex.offset.y - dt * 0.016) % 1;
    tex.offset.x = Math.sin(performance.now() / 3400) * 0.01;
  });
  return (
    <group>
      {WINS.map((w, i) => {
        if (winExist && winExist[i] === false) return null; // 已收起的窗不挂水珠
        const along = winPos?.[i] ?? w.def;
        const x = w.axis === 'z' ? along : w.at + w.side * 0.44;
        const z = w.axis === 'z' ? w.at + w.side * 0.44 : along;
        return (
          <mesh key={i} position={[x, 1.52, z]} rotation={[0, w.ry, 0]} visible={kind === 'rain'}>
            <planeGeometry args={[1.7, 2.2]} />
            <meshBasicMaterial map={tex} transparent opacity={0.55} depthWrite={false} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}

/** G5 雪天积雪：窗外窗台白沿 + 阳台地面薄雪（仅 snow 可见） */
function SnowDeco({ kind, winExist, winPos }: { kind: 'rain' | 'snow' | 'clear'; winExist?: boolean[]; winPos?: number[] }) {
  return (
    <group visible={kind === 'snow'}>
      {WINS.map((w, i) => {
        if (winExist && winExist[i] === false) return null; // 已收起的窗不留雪沿
        const along = winPos?.[i] ?? w.def;
        const x = w.axis === 'z' ? along : w.at + w.side * 0.56;
        const z = w.axis === 'z' ? w.at + w.side * 0.56 : along;
        return (
          <mesh key={i} position={[x, 0.92, z]} rotation={[0, w.ry, 0]}>
            <boxGeometry args={[1.72, 0.055, 0.16]} />
            <meshStandardMaterial color="#f3f7fb" roughness={1} />
          </mesh>
        );
      })}
      <mesh
        position={[(BAL_X0 + BAL_X1) / 2, 0.014, (BAL_Z0 + BAL_Z1) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[BAL_X1 - BAL_X0 - 0.24, BAL_Z1 - BAL_Z0 - 0.24]} />
        <meshStandardMaterial color="#eef4f9" transparent opacity={0.55} roughness={1} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** 彩蛋小生物运行时状态（ref 内高频更新，不入 React state） */
interface CritterRT {
  active: boolean;
  kind: 'butterfly' | 'bird';
  ax: number;
  az: number;
  t0: number;
  life: number;
  fleeing: boolean;
  fx: number;
  fz: number;
  fy: number;
  seed: number;
}

const CRITTER_PLANTS = new Set(['plant', 'plantSmall', 'monstera', 'flowerBox', 'flowerStand', 'hydro', 'cactus']);

/** G3 彩蛋小生物：蝴蝶/小鸟在阳台花丛附近漫游，点击惊飞（仅 live 模式生成） */
function Critters({
  mode,
  items,
  onCritterTap,
}: {
  mode: HomeMode;
  items: FurnitureItem[];
  onCritterTap?: (kind: 'butterfly' | 'bird') => void;
}) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const tapRef = useRef(onCritterTap);
  tapRef.current = onCritterTap;

  const crits = useRef<CritterRT[]>(
    Array.from({ length: 2 }, (_, i) => ({
      active: false,
      kind: i === 0 ? 'butterfly' : 'bird',
      ax: 0,
      az: 0,
      t0: 0,
      life: 0,
      fleeing: false,
      fx: 0,
      fz: 0,
      fy: 0,
      seed: Math.random() * 10,
    })),
  );
  const groups = useRef<(THREE.Group | null)[]>([]);
  const wings = useRef<(THREE.Group | null)[][]>([[], []]);
  const prev = useRef<[number, number][]>([[0, 0], [0, 0]]);
  const nextSpawn = useRef(7 + Math.random() * 8); // 首次 7~15s 出现，后续 25~55s

  const startle = useCallback((c: CritterRT, kind: 'butterfly' | 'bird') => {
    if (!c.active || c.fleeing) return;
    c.fleeing = true;
    c.fx = (Math.random() - 0.5) * 3.2;
    c.fz = -2.4 - Math.random() * 1.6;
    c.fy = 3.4;
    tapRef.current?.(kind);
  }, []);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    // 生成调度（仅 live）
    if (modeRef.current === 'live') {
      if (t >= nextSpawn.current) {
        const c = crits.current.find((x) => !x.active);
        if (c) {
          const plants = itemsRef.current.filter((f) => CRITTER_PLANTS.has(f.kind));
          if (plants.length && Math.random() < 0.4) {
            const p = plants[Math.floor(Math.random() * plants.length)];
            c.ax = p.x + (Math.random() - 0.5) * 1.3;
            c.az = p.z + (Math.random() - 0.5) * 1.3;
          } else {
            c.ax = BAL_X0 + 0.7 + Math.random() * Math.max(0.4, BAL_X1 - BAL_X0 - 1.4);
            c.az = BAL_Z0 + 0.55 + Math.random() * Math.max(0.4, BAL_Z1 - BAL_Z0 - 1.1);
          }
          c.active = true;
          c.t0 = t;
          c.life = 15 + Math.random() * 10;
          c.fleeing = false;
          c.seed = Math.random() * 10;
          const g = groups.current[crits.current.indexOf(c)];
          if (g) {
            g.position.set(c.ax, c.kind === 'butterfly' ? 0.6 : 1.0, c.az);
            g.visible = true;
          }
          nextSpawn.current = t + 25 + Math.random() * 30;
        } else {
          nextSpawn.current = t + 8;
        }
      }
    } else {
      // 编辑模式：全部悄悄离场（不弹提示）
      crits.current.forEach((c) => {
        if (c.active && !c.fleeing) {
          c.fleeing = true;
          c.fy = 2.8;
        }
      });
    }

    crits.current.forEach((c, i) => {
      const g = groups.current[i];
      if (!g) return;
      if (!c.active) {
        g.visible = false;
        return;
      }
      const age = t - c.t0;
      if (!c.fleeing && age > c.life) {
        // 生命期到：自然飞走
        c.fleeing = true;
        const a = Math.random() * Math.PI * 2;
        c.fx = Math.cos(a) * 2.4;
        c.fz = Math.sin(a) * 2.4 - 1.6;
        c.fy = 2.8;
      }
      const px = prev.current[i][0];
      const pz = prev.current[i][1];
      if (c.fleeing) {
        g.position.x += c.fx * dt;
        g.position.y += c.fy * dt;
        g.position.z += c.fz * dt;
        if (g.position.y > 6.2) {
          c.active = false;
          g.visible = false;
          return;
        }
      } else {
        const s = c.seed;
        const bx = c.ax + Math.sin(t * 0.55 + s) * 0.72;
        const bz = c.az + Math.cos(t * 0.42 + s * 1.7) * 0.58;
        const by = c.kind === 'butterfly' ? 0.55 + Math.sin(t * 1.6 + s) * 0.3 : 0.95 + Math.sin(t * 1.1 + s) * 0.2;
        const k = Math.min(1, dt * 2.4);
        g.position.x += (bx - g.position.x) * k;
        g.position.y += (by - g.position.y) * k;
        g.position.z += (bz - g.position.z) * k;
      }
      // 朝向速度方向
      const dx = g.position.x - px;
      const dz = g.position.z - pz;
      if (Math.abs(dx) + Math.abs(dz) > 0.002) g.rotation.y = Math.atan2(dx, dz);
      prev.current[i][0] = g.position.x;
      prev.current[i][1] = g.position.z;
      // 翅膀扑扇（惊飞更快）
      const flapRate = c.kind === 'butterfly' ? 17 : 11;
      const flap = Math.sin(t * flapRate + c.seed * 3) * (c.fleeing ? 1.05 : 0.75);
      const wl = wings.current[i]?.[0];
      const wr = wings.current[i]?.[1];
      if (wl) wl.rotation.z = 0.3 + flap;
      if (wr) wr.rotation.z = -0.3 - flap;
    });
  });

  const handleDown = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const c = crits.current[i];
    if (modeRef.current !== 'live') return;
    startle(c, c.kind);
  };

  const setWing = (i: number, j: number) => (g: THREE.Group | null) => {
    if (wings.current[i]) wings.current[i][j] = g;
  };

  return (
    <group>
      {/* 蝴蝶 */}
      <group
        ref={(g) => {
          groups.current[0] = g;
        }}
        visible={false}
        onPointerDown={handleDown(0)}
      >
        <mesh scale={[0.045, 0.045, 0.1]}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color="#7a5a62" roughness={0.8} />
        </mesh>
        <group ref={setWing(0, 0)} position={[0.02, 0.02, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.09, 0, 0.01]}>
            <circleGeometry args={[0.11, 14]} />
            <meshStandardMaterial color="#f2a9c4" roughness={0.7} side={THREE.DoubleSide} />
          </mesh>
        </group>
        <group ref={setWing(0, 1)} position={[-0.02, 0.02, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.09, 0, 0.01]}>
            <circleGeometry args={[0.11, 14]} />
            <meshStandardMaterial color="#f2a9c4" roughness={0.7} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>
      {/* 小鸟 */}
      <group
        ref={(g) => {
          groups.current[1] = g;
        }}
        visible={false}
        onPointerDown={handleDown(1)}
      >
        <mesh scale={[0.075, 0.068, 0.098]}>
          <sphereGeometry args={[1, 12, 10]} />
          <meshStandardMaterial color="#c98a5e" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.055, 0.075]} scale={[0.05, 0.05, 0.05]}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color="#d49a6e" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.05, 0.125]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.016, 0.05, 8]} />
          <meshStandardMaterial color="#e8b04a" roughness={0.7} />
        </mesh>
        <group ref={setWing(1, 0)} position={[0.05, 0.03, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.055, 0, 0]}>
            <circleGeometry args={[0.062, 12]} />
            <meshStandardMaterial color="#a8703f" roughness={0.8} side={THREE.DoubleSide} />
          </mesh>
        </group>
        <group ref={setWing(1, 1)} position={[-0.05, 0.03, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.055, 0, 0]}>
            <circleGeometry args={[0.062, 12]} />
            <meshStandardMaterial color="#a8703f" roughness={0.8} side={THREE.DoubleSide} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// ---------------- 音响放歌：音箱上方飘音符（v5.7 F3） ----------------

/** 音符贴图（canvas 画 ♪♫） */
function makeNoteSprite(ch: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 96;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, 96, 96);
  ctx.fillStyle = '#c98a9e';
  ctx.font = '60px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, 48, 52);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function SpeakerNotes({ items, active }: { items: FurnitureItem[]; active: boolean }) {
  const speakers = useMemo(() => items.filter((f) => f.kind === 'speaker' || f.kind === 'radio'), [items]);
  const noteTex = useMemo(() => [makeNoteSprite('♪'), makeNoteSprite('♫')], []);
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const seeds = useMemo(() => [0, 0.3, 0.6, 0.15, 0.45, 0.8], []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    sprites.current.forEach((sp, i) => {
      if (!sp) return;
      const si = Math.floor(i / 3);
      const sp3 = i % 3;
      const host = speakers[si];
      if (!host || !active) {
        sp.visible = false;
        return;
      }
      const s = seeds[i % seeds.length];
      const life = (t * 0.55 + s) % 1;
      sp.visible = true;
      sp.position.set(
        host.x + Math.sin(s * 21 + t * 1.2) * 0.16,
        1.5 + sp3 * 0.25 + life * 0.55,
        host.z + Math.cos(s * 15 + t * 0.9) * 0.16,
      );
      sp.scale.setScalar(0.22 + life * 0.1);
      (sp.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.9 * (1 - life));
    });
  });
  return (
    <group>
      {Array.from({ length: speakers.length * 3 }, (_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            sprites.current[i] = el;
          }}
          visible={false}
        >
          <spriteMaterial map={noteTex[i % 2]} transparent depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}
