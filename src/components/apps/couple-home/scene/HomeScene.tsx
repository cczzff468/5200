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
 * - 昼夜灯光切换：白天暖阳光 + 夜晚冷月光 + 灯具/窗户点光。
 */

import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import Room, { buildWallBoxes } from './Room';
import Furn3D from './Furn3D';
import Char3D from './Char3D';
import {
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
  ROOM_X,
  ROOM_Z,
  SNAP,
  DOORS,
  WINS,
  footprintOf,
  resolveDoorPos,
  resolveWinPos,
} from '../catalog';
import type { CatalogEntry, CharAction, CharPose, CharRT, FurnitureItem, HomeMode } from '../types';

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
  /** 小人画风（cartoon Q版 / real 拟真） */
  charStyle?: 'cartoon' | 'real';
  /** 「我」的姿势 + 支撑面高度（坐下/睡觉/泡澡） */
  poseRef: RefObject<{ pose: CharPose; y: number }>;
  /** 正在执行的家具动作 */
  actRef: RefObject<CharAction | null>;
  /** 浴缸水龙头点击（放水/关水） */
  onFaucetTap?: (item: FurnitureItem) => void;
  /** 九扇窗开态 + 切换回调 */
  win?: boolean[];
  onToggleWin?: (i: number) => void;
  /** 每扇窗沿墙坐标 / 三扇门沿墙坐标 */
  winPos?: number[];
  doorPos?: { bed: number; kt: number; bath: number };
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
  /** 三扇门开态 + 切换 */
  doorOpen?: boolean;
  kitchenDoorOpen?: boolean;
  bathDoorOpen?: boolean;
  onToggleDoor?: () => void;
  onToggleKitchenDoor?: () => void;
  onToggleBathDoor?: () => void;
  onFloorTap: () => void;
  onFurnTap: (item: FurnitureItem) => void;
  onDragEnd: (id: string) => void;
  /** 拖拽中的实时移动（吸附/钳位在此做） */
  onDragMove: (id: string, x: number, z: number) => void;
  onDragSelect: (id: string) => void;
  /** 编辑模式点选门窗（不开合） */
  onWallTap?: (id: string) => void;
}

/** 生活模式视角俯仰范围：接近水平（低角仰视）↔ 近乎俯瞰（全方位拉动视角） */
const PITCH_MIN = 0.22;
const PITCH_MAX = 1.5;

/** 家具动作 → 小人姿势（watch/work 也是坐姿） */
const POSE_OF_ACT: Record<CharAction['type'], CharPose> = {
  sit: 'sit',
  lie: 'lie',
  bath: 'bath',
  shower: 'shower',
  watch: 'sit',
  work: 'sit',
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
 * 小人 vs 家具 AABB（膨胀 0.2）推出 + 四房间边界钳制（抬升家具不挡路）。
 * v5.4 四室：客厅（西北）/ 卫生间（客厅东侧）/ 卧室 / 厨房（南排）——
 * 隔墙挡路，只有「对应门开着且在门走廊内」才能穿过（partner 传全关门永远留在客厅）。
 */
function collideAndClamp(c: CharRT, items: FurnitureItem[], bedDoor: DoorLive, ktDoor: DoorLive, bathDoor: DoorLive) {
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
    // —— 卧室侧 ——
    c.x = clamp(c.x, -ROOM_X + m, BED_X1 - m);
    c.z = inBedCorr ? clamp(c.z, BED_Z0 - m, BED_Z1 - m) : clamp(c.z, BED_Z0 + m, BED_Z1 - m);
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
    collideAndClamp(c, items, CLOSED_DOOR, CLOSED_DOOR, CLOSED_DOOR);
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
  /** 三扇门开态 + 沿墙坐标（ref 高频读取） */
  doorRef: RefObject<{ bed: DoorLive; kt: DoorLive; bath: DoorLive }>;
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
        poseRef.current.pose = POSE_OF_ACT[act.type] ?? 'sit';
        poseRef.current.y = act.y;
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

// ---------------- 灯光 ----------------

function Lights({ night }: { night: boolean }) {
  const dir = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    // 切换昼夜时重投阴影
    dir.current?.shadow?.camera?.updateProjectionMatrix();
  }, [night]);
  return (
    <>
      <ambientLight intensity={night ? 0.55 : 0.95} color={night ? '#a8b4cd' : '#fff3e0'} />
      <hemisphereLight
        args={[night ? '#39415c' : '#fdf6e8', night ? '#23252c' : '#e5d6b8', night ? 0.5 : 0.55]}
      />
      <directionalLight
        ref={dir}
        castShadow
        position={night ? [-4, 6, -3] : [5, 7.5, 4]}
        intensity={night ? 0.35 : 1.55}
        color={night ? '#b9c8e2' : '#ffe9c8'}
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

// ---------------- Canvas 主体 ----------------

export default function HomeScene(props: HomeSceneProps) {
  const {
    items, mode, night, selId, moveOn, meRT, taRT, joyRef, zoomCmd, moveCmd, onNudge, fp, fpRef,
    charStyle, poseRef, actRef, onFaucetTap,
    win, onToggleWin, winPos, doorPos,
    floorCol, wallCol, doorCol, winCol, floorColBed, wallColBed, floorColK, wallColK, floorColB, wallColB,
    ceilCol, ceilColBed, ceilColK, ceilColB,
    doorOpen, kitchenDoorOpen, bathDoorOpen, onToggleDoor, onToggleKitchenDoor, onToggleBathDoor,
    onFloorTap, onFurnTap, onDragEnd, onDragMove, onDragSelect, onWallTap,
  } = props;

  const modeRef = useRef<HomeMode>(mode);
  const itemsRef = useRef<FurnitureItem[]>(items);
  const winPosRef = useRef(winPos);
  const doorPosRef = useRef(doorPos);
  const doorRef = useRef({
    bed: { open: !!doorOpen, along: DOORS[0].def },
    kt: { open: !!kitchenDoorOpen, along: DOORS[1].def },
    bath: { open: !!bathDoorOpen, along: DOORS[2].def },
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
  }, [doorOpen, kitchenDoorOpen, bathDoorOpen]);
  useEffect(() => {
    doorRef.current.bed.along = doorPos?.bed ?? DOORS[0].def;
    doorRef.current.kt.along = doorPos?.kt ?? DOORS[1].def;
    doorRef.current.bath.along = doorPos?.bath ?? DOORS[2].def;
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
      ),
    [doorPos?.bed, doorPos?.kt, doorPos?.bath],
  );

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
      const did = id.slice(5) as 'bed' | 'kt' | 'bath';
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
      shadows="soft"
      dpr={[1, 2]}
      camera={{ fov: 48, near: 0.1, far: 80, position: [0, 6.2, 7.4] }}
      style={{ touchAction: 'none' }}
      resize={{ offsetSize: true }}
    >
      <color attach="background" args={[night ? '#24272f' : '#efe8da']} />
      <Lights night={night} />
      <Room
        night={night}
        onFloorTap={onFloorTap}
        editMode={mode === 'edit'}
        selWall={selId && (selId.startsWith('win-') || selId.startsWith('door-')) ? selId : null}
        onWallTap={onWallTap}
        onWallPointerDown={onWallPointerDown}
        win={win}
        onToggleWin={onToggleWin}
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
        ceilCol={ceilCol}
        ceilColBed={ceilColBed}
        ceilColK={ceilColK}
        ceilColB={ceilColB}
        doorCol={doorCol}
        winCol={winCol}
        doorOpen={doorOpen}
        kitchenDoorOpen={kitchenDoorOpen}
        bathDoorOpen={bathDoorOpen}
        onToggleDoor={onToggleDoor}
        onToggleKitchenDoor={onToggleKitchenDoor}
        onToggleBathDoor={onToggleBathDoor}
        focusRef={focusRef}
      />
      {mode === 'edit' && <EditGrid />}

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
          />
        );
      })}

      <Char3D rt={meRT} who="me" hide={fp && mode === 'live'} style={charStyle} poseRef={poseRef} />
      <Char3D rt={taRT} who="partner" style={charStyle} />
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
