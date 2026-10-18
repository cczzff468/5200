'use client';

/* eslint-disable react-hooks/immutability -- R3F/游戏循环需要原地修改 three 对象与运行时小人状态 */

/**
 * 情侣小家 3D —— 场景主体（R3F Canvas 内核，v4）
 *
 * - 生活模式：镜头跟随小人（滑动旋转视角 / 滚轮缩放 / 俯仰微调）+ 摇杆/WASD 移动 + 碰撞；
 * - 编辑模式：OrbitControls 上帝视角 + 家具拖拽（射线投到家具所在高度平面，0.25m 吸附）
 *   + 移动模式（选中后拖动画面任意位置搬运）+ 缩放按钮；
 * - 昼夜灯光切换：白天暖阳光 + 夜晚冷月光 + 灯具/窗户点光。
 */

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import Room from './Room';
import Furn3D from './Furn3D';
import Char3D from './Char3D';
import { CATALOG, ROOM_X, ROOM_Z, SNAP, footprintOf } from '../catalog';
import type { CatalogEntry, CharRT, FurnitureItem, HomeMode } from '../types';

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
  onFloorTap: () => void;
  onFurnTap: (item: FurnitureItem) => void;
  onDragEnd: (id: string) => void;
  /** 拖拽中的实时移动（吸附/钳位在此做） */
  onDragMove: (id: string, x: number, z: number) => void;
  onDragSelect: (id: string) => void;
}

// ---------------- 小工具 ----------------

const clamp = THREE.MathUtils.clamp;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function lerpAngle(cur: number, target: number, k: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * k;
}

/** 小人 vs 家具 AABB（膨胀 0.2）推出 + 房间边界钳位（抬升家具不挡路） */
function collideAndClamp(c: CharRT, items: FurnitureItem[]) {
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
  c.x = clamp(c.x, -ROOM_X + 0.35, ROOM_X - 0.35);
  c.z = clamp(c.z, -ROOM_Z + 0.35, ROOM_Z - 0.35);
}

/** partner 漫游 AI */
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
    collideAndClamp(c, items);
  } else if (now > c.nextWander) {
    c.target = { x: rand(-ROOM_X + 0.7, ROOM_X - 0.7), z: rand(-ROOM_Z + 0.7, ROOM_Z - 0.7) };
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
}) {
  const { camera } = useThree();
  const desired = useRef(new THREE.Vector3());
  const lookAt = useRef(new THREE.Vector3());

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    if (modeRef.current !== 'live') return;

    // —— 输入合成（摇杆 + 键盘） ——
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

    const az = azRef.current?.az ?? 0;
    const fx = -Math.sin(az);
    const fz = -Math.cos(az);
    const rx = Math.cos(az);
    const rz = -Math.sin(az);
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
    collideAndClamp(meRT, itemsRef.current ?? []);

    // partner 漫游
    wander(taRT, dt, itemsRef.current ?? []);

    // —— 相机跟随（球坐标：方位角 az / 俯仰 pitch / 距离 dist） ——
    const pitch = pitchRef.current?.p ?? 0.92;
    const dist = distRef.current?.d ?? 8.8;
    const cy = Math.sin(pitch) * dist;
    const ch = Math.cos(pitch) * dist;
    desired.current.set(meRT.x + Math.sin(az) * ch, cy + 0.55, meRT.z + Math.cos(az) * ch);
    camera.position.lerp(desired.current, 1 - Math.exp(-dt * 5));
    lookAt.current.set(meRT.x, 1.0, meRT.z);
    camera.lookAt(lookAt.current);
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
  modeRef,
  azRef,
  pitchRef,
  distRef,
  dragRef,
  moveSelRef,
  itemsRef,
  onDragMove,
  onDragEnd,
  onDragSelect,
}: {
  modeRef: RefObject<HomeMode>;
  azRef: RefObject<{ az: number }>;
  pitchRef: RefObject<{ p: number }>;
  distRef: RefObject<{ d: number }>;
  dragRef: RefObject<DragInfo | null>;
  moveSelRef: RefObject<{ id: string | null; on: boolean }>;
  itemsRef: RefObject<FurnitureItem[]>;
  onDragMove: HomeSceneProps['onDragMove'];
  onDragEnd: HomeSceneProps['onDragEnd'];
  onDragSelect: HomeSceneProps['onDragSelect'];
}) {
  const { camera, gl, raycaster } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const itemsRefP = itemsRef;

  // 回调存 ref：父组件重渲染（回调身份变化）不会拆装监听
  const cbRef = useRef({ onDragMove, onDragEnd, onDragSelect });
  useEffect(() => {
    cbRef.current = { onDragMove, onDragEnd, onDragSelect };
  });
  // 手势状态存 ref：即便 effect 重建也不丢「按住中」状态
  const gesture = useRef({ down: false, lastX: 0, lastY: 0 });

  useEffect(() => {
    const el = gl.domElement;
    // 阻止浏览器把画布拖拽当成原生 drag/选区拖动（否则 dragstart+pointercancel 会吞掉后续 pointermove）
    el.draggable = false;
    el.style.userSelect = 'none';
    el.style.setProperty('-webkit-user-drag', 'none');
    const blockDrag = (e: Event) => e.preventDefault();
    el.addEventListener('dragstart', blockDrag);
    /** 拖拽平面：随目标家具高度调整（墙挂电视在其高度平面上拖动） */
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();

    const setNDC = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };

    /** 把拖拽平面移到家具所在高度（贴地家具 y=0；抬升家具在其水平面） */
    const alignPlane = (id: string) => {
      const it = itemsRefP.current?.find((f) => f.id === id);
      plane.constant = -(it?.y ?? 0);
    };

    const onDown = (e: PointerEvent) => {
      gesture.current.down = true;
      gesture.current.lastX = e.clientX;
      gesture.current.lastY = e.clientY;

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
      if (!g.down) return;
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      g.lastX = e.clientX;
      g.lastY = e.clientY;

      // —— 编辑模式：家具拖拽 ——
      const d = dragRef.current;
      if (d) {
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

      // —— 生活模式：滑动旋转视角 / 微调俯仰 ——
      if (modeRef.current === 'live' && !dragRef.current) {
        const az = azRef.current;
        if (az) az.az -= dx * 0.006;
        const p = pitchRef.current;
        if (p) p.p = clamp(p.p + dy * 0.004, 0.45, 1.25);
      }
    };

    const onUp = () => {
      gesture.current.down = false;
      const d = dragRef.current;
      if (d?.active) {
        cbRef.current.onDragEnd(d.id);
      }
      // 移动模式保持占用相机；普通拖拽结束后归还 OrbitControls
      if (controls) controls.enabled = !moveSelRef.current?.on;
      dragRef.current = null;
    };

    const onWheel = (e: WheelEvent) => {
      if (modeRef.current !== 'live') return;
      const dd = distRef.current;
      if (dd) dd.d = clamp(dd.d + e.deltaY * 0.004, 4.5, 11);
    };

    el.addEventListener('pointerdown', onDown);
    // ⚠ 捕获阶段挂 window：避免任何元素 stopPropagation 吞掉 move/up
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('dragstart', blockDrag);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dragstart', blockDrag);
    };
    // 仅依赖 three 稳定对象与 ref —— 回调已走 cbRef，重渲染不拆装
  }, [camera, gl, raycaster, controls, modeRef, azRef, pitchRef, distRef, dragRef, moveSelRef]);

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

// ---------------- 编辑网格 ----------------

function EditGrid() {
  const geo = useMemo(() => {
    const pts: number[] = [];
    for (let x = -ROOM_X; x <= ROOM_X + 0.001; x += SNAP) pts.push(x, 0.015, -ROOM_Z, x, 0.015, ROOM_Z);
    for (let z = -ROOM_Z; z <= ROOM_Z + 0.001; z += SNAP) pts.push(-ROOM_X, 0.015, z, ROOM_X, 0.015, z);
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

// ---------------- 编辑相机（进入装修模式时拉到俯瞰位） ----------------

function EditCameraKick({ mode }: { mode: HomeMode }) {
  const { camera } = useThree();
  const prev = useRef<HomeMode>(mode);
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (mode === 'edit' && prev.current !== 'edit') {
      // 对角俯瞰位 + 广角，竖屏窄视野也能罩住全屋
      cam.position.set(5.6, 11, 4.6);
      if (cam.isPerspectiveCamera) {
        cam.fov = 55;
        cam.updateProjectionMatrix();
      }
      cam.lookAt(0, 0.3, 0);
    } else if (mode === 'live' && prev.current !== 'live') {
      if (cam.isPerspectiveCamera && cam.fov !== 48) {
        cam.fov = 48;
        cam.updateProjectionMatrix();
      }
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
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-camera-near={0.5}
        shadow-camera-far={25}
        shadow-bias={-0.0006}
      />
    </>
  );
}

// ---------------- Canvas 主体 ----------------

export default function HomeScene(props: HomeSceneProps) {
  const {
    items, mode, night, selId, moveOn, meRT, taRT, joyRef, zoomCmd,
    onFloorTap, onFurnTap, onDragEnd, onDragMove, onDragSelect,
  } = props;

  const modeRef = useRef<HomeMode>(mode);
  const itemsRef = useRef<FurnitureItem[]>(items);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const azRef = useRef({ az: 0 });
  const pitchRef = useRef({ p: 0.92 });
  const distRef = useRef({ d: 8.8 });
  const dragRef = useRef<DragInfo | null>(null);
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

  /** 拖拽实时钳位 + 吸附（拖拽平面 = 家具自身高度） */
  const handleDragMove = (id: string, x: number, z: number) => {
    const it = itemsRef.current.find((f) => f.id === id);
    if (it) {
      const e: CatalogEntry | undefined = CATALOG[it.kind];
      const [w, d] = e ? footprintOf(e, it.ry ?? 0) : [0.5, 0.5];
      const hw = Math.max(w / 2, 0.18);
      const hd = Math.max(d / 2, 0.18);
      const sx = Math.round(x / SNAP) * SNAP;
      const sz = Math.round(z / SNAP) * SNAP;
      onDragMove(id, clamp(sx, -ROOM_X + hw, ROOM_X - hw), clamp(sz, -ROOM_Z + hd, ROOM_Z - hd));
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
      <Room night={night} onFloorTap={onFloorTap} />
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
          />
        );
      })}

      <Char3D rt={meRT} who="me" />
      <Char3D rt={taRT} who="partner" />
      <EditCameraKick mode={mode} />
      <ZoomPoker zoomCmd={zoomCmd} />
      <MoveModeGate moveOn={moveOn} mode={mode} />

      {mode === 'edit' && (
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={3.2}
          maxDistance={23}
          minPolarAngle={0.12}
          maxPolarAngle={1.32}
          target={[0, 0.5, 0]}
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
      />
      <PointerRig
        modeRef={modeRef}
        azRef={azRef}
        pitchRef={pitchRef}
        distRef={distRef}
        dragRef={dragRef}
        moveSelRef={moveSelRef}
        itemsRef={itemsRef}
        onDragMove={handleDragMove}
        onDragEnd={onDragEnd}
        onDragSelect={onDragSelect}
      />
    </Canvas>
  );
}
