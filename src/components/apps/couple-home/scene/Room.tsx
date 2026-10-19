'use client';

/**
 * 情侣小家 3D —— 房屋外壳（v5 两室一厅）
 *
 * - 户型：客厅 9×6（北）+ 卧室 6×5（南），中间隔墙带门洞；
 * - 门：点击开合（向卧室内侧摆开），小人可穿过门洞进入卧室；门色可自定义（doorCol）；
 * - 窗户：五扇上悬窗（客厅北×2 / 客厅西 / 卧室西 / 卧室南），点击后窗扇绕顶部铰链
 *   向外上方打开，露出窗外风景（白天蓝天帆船 / 夜晚星空月亮）；窗框色可自定义（winCol）；
 * - 墙壁：按相机方位自动隐藏（洋房剖面效果）；地板/墙色用户自定义；
 * - 已移除旧版西墙浅粉护墙板（用户反馈像一块突兀的粉色）。
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BED_X0,
  BED_X1,
  BED_W,
  BED_Z0,
  BED_Z1,
  DOOR_H,
  DOOR_W,
  DOOR_X,
  ROOM_W,
  ROOM_D,
  WALL_H,
  WALL_T,
  ROOM_X,
  ROOM_Z,
} from '../catalog';

// ---------------- 木地板纹理 ----------------

function makeFloorTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  // 底色：云白（自定义颜色通过材质 color 与本纹理相乘生效）
  ctx.fillStyle = '#f4f2ed';
  ctx.fillRect(0, 0, S, S);
  // 拼板：横向 4 条，微差灰白
  const plank = S / 4;
  for (let i = 0; i < 4; i++) {
    const shade = i % 2 === 0 ? 'rgba(214,212,205,0.5)' : 'rgba(206,204,197,0.45)';
    ctx.fillStyle = shade;
    ctx.fillRect(0, i * plank, S, plank);
    // 板间缝（浅灰）
    ctx.fillStyle = 'rgba(178,175,167,0.4)';
    ctx.fillRect(0, i * plank - 1.5, S, 3);
    // 竖向接缝（错缝）
    const seamX = ((i * 137) % S) + 40;
    ctx.fillRect(seamX, i * plank + 2, 2.5, plank - 4);
  }
  // 极淡哑光纹理
  ctx.strokeStyle = 'rgba(180,177,170,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * S;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(S * 0.3, y + 5, S * 0.6, y - 5, S, y + 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------- 窗外风景纹理 ----------------

/** 白天：蓝天渐变 + 云朵 + 两只小帆船（呼应「拾光小屋」图标） */
function makeDaySkyTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 192;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#a7cfec');
  g.addColorStop(0.62, '#c8e4f4');
  g.addColorStop(1, '#eef7f2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 云
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (const [cx, cy, r] of [[52, 44, 16], [76, 50, 12], [186, 30, 13], [204, 36, 9]] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 海平线
  ctx.fillStyle = '#9fc6d8';
  ctx.fillRect(0, H * 0.72, W, H * 0.28);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  for (const y of [H * 0.78, H * 0.86, H * 0.93]) {
    ctx.beginPath();
    ctx.moveTo(W * 0.08, y);
    ctx.quadraticCurveTo(W * 0.5, y - 4, W * 0.92, y);
    ctx.stroke();
  }
  // 小帆船 ×2
  const boat = (bx: number, by: number, s: number) => {
    ctx.fillStyle = '#d97f6f';
    ctx.beginPath();
    ctx.moveTo(bx - 14 * s, by);
    ctx.lineTo(bx + 14 * s, by);
    ctx.lineTo(bx + 8 * s, by + 7 * s);
    ctx.lineTo(bx - 8 * s, by + 7 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f2e6c8';
    ctx.beginPath();
    ctx.moveTo(bx, by - 16 * s);
    ctx.lineTo(bx, by - 1 * s);
    ctx.lineTo(bx - 11 * s, by - 1 * s);
    ctx.closePath();
    ctx.fill();
  };
  boat(W * 0.3, H * 0.7, 1);
  boat(W * 0.74, H * 0.66, 0.8);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 夜晚：深蓝星空 + 月亮 */
function makeNightSkyTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 192;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1c2748');
  g.addColorStop(0.62, '#2c3a63');
  g.addColorStop(1, '#3d4a72');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 星星
  ctx.fillStyle = '#e8eeff';
  for (let i = 0; i < 42; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H * 0.68;
    const r = Math.random() * 1.4 + 0.4;
    ctx.globalAlpha = 0.4 + Math.random() * 0.6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 月亮
  ctx.fillStyle = '#f7f0d8';
  ctx.beginPath();
  ctx.arc(W * 0.72, H * 0.26, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(220,214,190,0.5)';
  for (const [mx, my, mr] of [[W * 0.69, H * 0.24, 3.4], [W * 0.75, H * 0.29, 2.4]] as const) {
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------- 单面墙 ----------------

interface WallDef {
  key: string;
  /** 墙中心位置 */
  pos: [number, number, number];
  /** 墙尺寸（含厚度） */
  size: [number, number, number];
  /** 朝室外的法线 */
  normal: THREE.Vector3;
  /** 隔墙标记：不按法线隐藏，改用「镜头与对焦物是否被隔墙隔开」规则（见 sharedWallVisible） */
  shared?: boolean;
  /** 是否画踢脚线（默认画） */
  baseboard?: boolean;
  /** 归属房间：客厅/卧室分开换色（wallCol / wallColBed） */
  room: 'lr' | 'br';
}

/**
 * 隔墙（客厅南墙 / 门 / 门头梁）可见性：
 * 只有当隔墙挡在「镜头」与「对焦物」（小人/轨道中心）之间时才隐藏 ——
 * 小人站在客厅门口看门时墙照常可见（能点门），走进卧室后墙自动消失形成剖面。
 */
function sharedWallVisible(cameraZ: number, focusZ: number): boolean {
  return (cameraZ - BED_Z0) * (focusZ - BED_Z0) >= 0;
}

/** 墙段定义：四面外围墙 + 隔墙两段（门洞两侧）+ 卧室三面墙；客厅/卧室分别归色 */
const WALLS: WallDef[] = [
  // —— 客厅 ——
  { key: 'back', pos: [0, WALL_H / 2, -ROOM_Z - WALL_T / 2], size: [ROOM_W + WALL_T * 2, WALL_H, WALL_T], normal: new THREE.Vector3(0, 0, -1), room: 'lr' },
  { key: 'frontEast', pos: [(DOOR_X + DOOR_W / 2 + ROOM_X + WALL_T) / 2, WALL_H / 2, BED_Z0 + WALL_T / 2], size: [ROOM_X + WALL_T - (DOOR_X + DOOR_W / 2), WALL_H, WALL_T], normal: new THREE.Vector3(0, 0, 1), shared: true, room: 'lr' },
  { key: 'frontWest', pos: [(-ROOM_X - WALL_T + DOOR_X - DOOR_W / 2) / 2, WALL_H / 2, BED_Z0 + WALL_T / 2], size: [DOOR_X - DOOR_W / 2 - (-ROOM_X - WALL_T), WALL_H, WALL_T], normal: new THREE.Vector3(0, 0, 1), shared: true, room: 'lr' },
  { key: 'left', pos: [-ROOM_X - WALL_T / 2, WALL_H / 2, 0], size: [WALL_T, WALL_H, ROOM_D], normal: new THREE.Vector3(-1, 0, 0), room: 'lr' },
  { key: 'right', pos: [ROOM_X + WALL_T / 2, WALL_H / 2, 0], size: [WALL_T, WALL_H, ROOM_D], normal: new THREE.Vector3(1, 0, 0), room: 'lr' },
  // —— 卧室（隔墙南侧） ——
  { key: 'bedLeft', pos: [-ROOM_X - WALL_T / 2, WALL_H / 2, (BED_Z0 + BED_Z1) / 2], size: [WALL_T, WALL_H, BED_Z1 - BED_Z0], normal: new THREE.Vector3(-1, 0, 0), room: 'br' },
  { key: 'bedRight', pos: [BED_X1 + WALL_T / 2, WALL_H / 2, (BED_Z0 + BED_Z1) / 2], size: [WALL_T, WALL_H, BED_Z1 - BED_Z0], normal: new THREE.Vector3(1, 0, 0), room: 'br' },
  { key: 'bedBack', pos: [(BED_X0 + BED_X1) / 2, WALL_H / 2, BED_Z1 + WALL_T / 2], size: [BED_X1 - BED_X0 + WALL_T * 2, WALL_H, WALL_T], normal: new THREE.Vector3(0, 0, 1), room: 'br' },
];

/** 门洞上方的门头梁（随隔墙同隐同现；无踢脚线） */
function DoorLintel({ wallCol, night, focusRef }: { wallCol?: string; night: boolean; focusRef?: RefObject<{ z: number }> }) {
  const ref = useRef<THREE.Group>(null);
  const { camera } = useThree();
  useFrame(() => {
    if (!ref.current) return;
    ref.current.visible = sharedWallVisible(camera.position.z, focusRef?.current?.z ?? BED_Z0 - 1);
  });
  return (
    <group ref={ref}>
      <mesh position={[DOOR_X, DOOR_H + (WALL_H - DOOR_H) / 2, BED_Z0 + WALL_T / 2]} castShadow receiveShadow>
        <boxGeometry args={[DOOR_W + 0.04, WALL_H - DOOR_H, WALL_T]} />
        <meshStandardMaterial color={wallCol ?? (night ? '#e9e4d8' : '#f7f3ec')} roughness={0.95} />
      </mesh>
    </group>
  );
}

function Wall({ def, night, wallCol, focusRef }: { def: WallDef; night: boolean; wallCol?: string; focusRef?: RefObject<{ z: number }> }) {
  const ref = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const center = useMemo(
    () => new THREE.Vector3(def.pos[0], def.pos[1], def.pos[2]),
    [def],
  );

  useFrame(() => {
    if (!ref.current) return;
    if (def.shared) {
      // 隔墙：只在挡住「镜头→对焦物」视线时隐藏（与门/门头梁同隐同现）
      ref.current.visible = sharedWallVisible(camera.position.z, focusRef?.current?.z ?? BED_Z0 - 1);
      return;
    }
    // 相机在该墙外侧（视向穿过墙体） → 隐藏，形成剖面屋
    const camDir = camera.position.clone().sub(center);
    ref.current.visible = camDir.dot(def.normal) < 0.6;
  });

  const hasBaseboard = def.baseboard !== false && !def.shared ? true : def.baseboard !== false;
  return (
    <group ref={ref}>
      {/* 墙体：暖白（支持用户自定义色） */}
      <mesh position={def.pos} castShadow receiveShadow>
        <boxGeometry args={def.size} />
        <meshStandardMaterial color={wallCol ?? (night ? '#e9e4d8' : '#f7f3ec')} roughness={0.95} />
      </mesh>
      {/* 踢脚线：浅灰（内侧面贴墙） */}
      {hasBaseboard && (
        <mesh
          position={[
            def.pos[0] - def.normal.x * (WALL_T / 2 + 0.012),
            0.055,
            def.pos[2] - def.normal.z * (WALL_T / 2 + 0.012),
          ]}
          castShadow
        >
          <boxGeometry
            args={[
              Math.max(def.size[0] * 0.998, 0.02),
              0.11,
              Math.max(def.size[2] * 0.998, 0.02),
            ]}
          />
          <meshStandardMaterial color="#e3e1da" roughness={0.9} />
        </mesh>
      )}
    </group>
  );
}

// ---------------- 门（卧室门，可开合可换色） ----------------

/**
 * 门：门框（三个边条，略压进门洞形成企口）+ 门板（左铰链 pivot，向卧室内侧摆开）+ 双面把手。
 * ⚑ v5.1 修漏缝：旧门板 0.87m 宽塞在 0.94m 门洞里，四边漏出 3.5~8.5cm 缝隙（窗外天光从缝里漏进来）。
 *   新尺寸：门板 0.90×2.03 填满门洞，门垛/门头梁加宽并各压进门洞 2~4.5cm 盖住板边 —— 四边全封闭。
 */
function HouseDoor({
  open,
  col,
  night,
  onToggle,
  focusRef,
}: {
  open: boolean;
  col?: string;
  night: boolean;
  onToggle: () => void;
  focusRef?: RefObject<{ z: number }>;
}) {
  const panel = useRef<THREE.Group>(null);
  const doorRoot = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const { camera } = useThree();

  // 门随隔墙同隐同现（隔墙可见时门也作为客厅南墙的一部分正常可见，走近就能点）
  useFrame(() => {
    if (doorRoot.current) doorRoot.current.visible = sharedWallVisible(camera.position.z, focusRef?.current?.z ?? BED_Z0 - 1);
  });

  useFrame((_, dt) => {
    if (!panel.current) return;
    // 关 = 与隔墙同面；开 = 向卧室内侧（+z）摆开约 100°
    panel.current.rotation.y = THREE.MathUtils.damp(panel.current.rotation.y, open ? -1.78 : 0, 6, dt);
  });

  const doorCol = col ?? '#f3efe6';
  const frameCol = useMemo(() => new THREE.Color(doorCol).multiplyScalar(0.86), [doorCol]);
  const frameStr = `#${frameCol.getHexString()}`;
  /** 门板宽/高：比门洞各边小 2cm（藏在门垛/门头梁企口后面，不露缝） */
  const PANEL_W = DOOR_W - 0.04;
  const PANEL_H = DOOR_H - 0.03;

  const toggle = (e: { delta: number; stopPropagation: () => void }) => {
    if (e.delta > 8) return; // 拖动视角不算点击
    e.stopPropagation();
    onToggle();
  };

  const hoverProps = {
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      setHovered(true);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      setHovered(false);
      document.body.style.cursor = 'auto';
    },
  };

  return (
    <group position={[DOOR_X, 0, BED_Z0]} ref={doorRoot}>
      {/* 门框：左右门垛（0.07 宽，压进门洞 2cm 盖住门板边）+ 门头梁包边（压下 4.5cm） */}
      <mesh position={[-DOOR_W / 2 - 0.015, DOOR_H / 2 + 0.005, WALL_T / 2]} castShadow>
        <boxGeometry args={[0.07, DOOR_H + 0.01, WALL_T + 0.03]} />
        <meshStandardMaterial color={frameStr} roughness={0.8} />
      </mesh>
      <mesh position={[DOOR_W / 2 + 0.015, DOOR_H / 2 + 0.005, WALL_T / 2]} castShadow>
        <boxGeometry args={[0.07, DOOR_H + 0.01, WALL_T + 0.03]} />
        <meshStandardMaterial color={frameStr} roughness={0.8} />
      </mesh>
      <mesh position={[0, DOOR_H, WALL_T / 2]} castShadow>
        <boxGeometry args={[DOOR_W + 0.16, 0.09, WALL_T + 0.03]} />
        <meshStandardMaterial color={frameStr} roughness={0.8} />
      </mesh>

      {/* 门板（铰链在左侧门垛，往卧室方向开；点击开合） */}
      <group
        ref={panel}
        position={[-DOOR_W / 2 + 0.02, 0, WALL_T / 2]}
        onClick={toggle}
        {...hoverProps}
      >
        <group position={[DOOR_W / 2 - 0.02, 0, 0]}>
          {/* 门板主体（填满门洞，边缝全部藏进门框企口） */}
          <mesh position={[0, PANEL_H / 2 + 0.005, 0]} castShadow receiveShadow>
            <boxGeometry args={[PANEL_W, PANEL_H, 0.045]} />
            <meshStandardMaterial color={doorCol} roughness={0.75} />
          </mesh>
          {/* 门板凹凸造型线（上下两块嵌板） */}
          <mesh position={[0, PANEL_H * 0.7, 0.026]}>
            <boxGeometry args={[PANEL_W - 0.18, 0.62, 0.012]} />
            <meshStandardMaterial color={frameStr} roughness={0.8} />
          </mesh>
          <mesh position={[0, PANEL_H * 0.28, 0.026]}>
            <boxGeometry args={[PANEL_W - 0.18, 0.5, 0.012]} />
            <meshStandardMaterial color={frameStr} roughness={0.8} />
          </mesh>
          {/* 把手（双面） */}
          <mesh position={[PANEL_W / 2 - 0.11, PANEL_H * 0.47, 0.045]}>
            <sphereGeometry args={[0.032, 12, 10]} />
            <meshStandardMaterial color="#d9cfb8" metalness={0.55} roughness={0.35} />
          </mesh>
          <mesh position={[PANEL_W / 2 - 0.11, PANEL_H * 0.47, -0.045]}>
            <sphereGeometry args={[0.032, 12, 10]} />
            <meshStandardMaterial color="#d9cfb8" metalness={0.55} roughness={0.35} />
          </mesh>
          {/* 夜里门缝透出的暖光提示 */}
          {!open && night && (
            <mesh position={[PANEL_W / 2 - 0.03, PANEL_H / 2, 0.026]}>
              <boxGeometry args={[0.012, PANEL_H - 0.2, 0.004]} />
              <meshBasicMaterial color="#ffd98f" transparent opacity={0.35} toneMapped={false} />
            </mesh>
          )}
          {/* hover 高亮 */}
          {hovered && (
            <mesh position={[0, PANEL_H / 2, 0.03]}>
              <planeGeometry args={[PANEL_W - 0.03, PANEL_H - 0.03]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.14} depthWrite={false} />
            </mesh>
          )}
        </group>
      </group>
    </group>
  );
}

// ---------------- 窗户（上悬窗，向外上方打开） ----------------

/** 窗：窗框（四边条，winCol 可自定义）+ 整扇上悬窗扇（顶部铰链，底部向外上翻），
 *  点击开合；打开露出窗外风景，夜里玻璃透暖光 */
function Window({
  position,
  rotationY,
  night,
  open,
  col,
  onToggle,
}: {
  position: [number, number, number];
  rotationY: number;
  night: boolean;
  open: boolean;
  col?: string;
  onToggle: () => void;
}) {
  const glow = useRef<THREE.PointLight>(null);
  const sashPivot = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const skyTex = useMemo(() => (night ? makeNightSkyTexture() : makeDaySkyTexture()), [night]);
  const frameCol = col ?? '#f0e7d4';

  useFrame((_, dt) => {
    if (!sashPivot.current) return;
    // 上悬窗：关 = 竖直贴合；开 = 底部向外（窗外方向）上翻约 32°
    const target = open ? 0.56 : 0;
    sashPivot.current.rotation.x = THREE.MathUtils.damp(sashPivot.current.rotation.x, target, 7, dt);
    if (glow.current) {
      glow.current.intensity = THREE.MathUtils.damp(
        glow.current.intensity,
        night ? (open ? 0.22 : 0.5) : 0,
        5,
        dt,
      );
    }
  });

  /** 玻璃材质（微透，能看见窗外风景；夜里关窗透暖光） */
  const glassProps = {
    color: night ? '#e8dfc8' : '#dfeef2',
    transparent: true,
    opacity: 0.42,
    roughness: 0.15,
    metalness: 0.05,
    emissive: night ? '#ffd98f' : '#000000',
    emissiveIntensity: night && !open ? 0.32 : 0,
  } as const;

  const toggle = (e: { delta: number; stopPropagation: () => void }) => {
    if (e.delta > 8) return; // 拖动视角不算点击
    e.stopPropagation();
    onToggle();
  };

  const hoverProps = {
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      setHovered(true);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      setHovered(false);
      document.body.style.cursor = 'auto';
    },
  };

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 窗外风景（凹进墙内，透过玻璃可见） */}
      <mesh position={[0, 0, -0.045]}>
        <planeGeometry args={[1.36, 1.14]} />
        <meshBasicMaterial map={skyTex} toneMapped={false} />
      </mesh>

      {/* 窗框（四边条，中空露出风景；winCol 自定义色） */}
      <mesh position={[0, 0.615, 0]} castShadow>
        <boxGeometry args={[1.5, 0.07, 0.1]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} />
      </mesh>
      <mesh position={[0, -0.615, 0]} castShadow>
        <boxGeometry args={[1.5, 0.07, 0.1]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} />
      </mesh>
      <mesh position={[-0.715, 0, 0]} castShadow>
        <boxGeometry args={[0.07, 1.3, 0.1]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} />
      </mesh>
      <mesh position={[0.715, 0, 0]} castShadow>
        <boxGeometry args={[0.07, 1.3, 0.1]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} />
      </mesh>

      {/* 上悬窗扇：铰链在顶部，整扇绕顶部向外上翻（点击开合） */}
      <group
        ref={sashPivot}
        position={[0, 0.57, 0.03]}
        onClick={toggle}
        {...hoverProps}
      >
        <group position={[0, -0.57, 0]}>
          {/* 玻璃 */}
          <mesh>
            <boxGeometry args={[1.3, 1.06, 0.035]} />
            <meshStandardMaterial {...glassProps} />
          </mesh>
          {/* 窗扇框（四边细条） */}
          <mesh position={[0, 0.55, 0]}>
            <boxGeometry args={[1.36, 0.05, 0.06]} />
            <meshStandardMaterial color={frameCol} />
          </mesh>
          <mesh position={[0, -0.55, 0]}>
            <boxGeometry args={[1.36, 0.05, 0.06]} />
            <meshStandardMaterial color={frameCol} />
          </mesh>
          <mesh position={[-0.66, 0, 0]}>
            <boxGeometry args={[0.05, 1.1, 0.06]} />
            <meshStandardMaterial color={frameCol} />
          </mesh>
          <mesh position={[0.66, 0, 0]}>
            <boxGeometry args={[0.05, 1.1, 0.06]} />
            <meshStandardMaterial color={frameCol} />
          </mesh>
          {/* 横棂（中分线） */}
          <mesh position={[0, 0, 0.012]}>
            <boxGeometry args={[1.3, 0.04, 0.03]} />
            <meshStandardMaterial color={frameCol} />
          </mesh>
          {/* 十字竖棂 */}
          <mesh position={[0, 0, 0.012]}>
            <boxGeometry args={[0.04, 1.06, 0.03]} />
            <meshStandardMaterial color={frameCol} />
          </mesh>
          {/* 下缘把手（开窗时随手扇外翻） */}
          <mesh position={[0.42, -0.6, 0.04]}>
            <boxGeometry args={[0.14, 0.035, 0.03]} />
            <meshStandardMaterial color="#cfc6b2" roughness={0.6} metalness={0.3} />
          </mesh>
          {/* hover 高亮描边 */}
          {hovered && (
            <mesh position={[0, 0, 0.03]}>
              <planeGeometry args={[1.42, 1.18]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.16} depthWrite={false} />
            </mesh>
          )}
        </group>
      </group>

      {/* 夜里窗边暖光（开窗后减弱，透进来的不是灯光而是夜色） */}
      <pointLight ref={glow} position={[0, 0, 0.45]} color="#ffd98f" intensity={0} distance={3.5} decay={2} />
    </group>
  );
}

// ---------------- 房间整体 ----------------

export interface RoomProps {
  night: boolean;
  onFloorTap?: () => void;
  /** 五扇窗开态（客厅北左 / 客厅北右 / 客厅西 / 卧室西 / 卧室南） */
  win?: boolean[];
  onToggleWin?: (i: number) => void;
  /** 客厅地板自定义色（#rrggbb；缺省云白） */
  floorCol?: string;
  /** 客厅墙坎自定义色（#rrggbb；缺省暖白） */
  wallCol?: string;
  /** 卧室地板自定义色（#rrggbb；缺省云白；客厅卧室分开换色） */
  floorColBed?: string;
  /** 卧室墙坎自定义色（#rrggbb；缺省暖白；客厅卧室分开换色） */
  wallColBed?: string;
  /** 门色（#rrggbb；缺省暖白） */
  doorCol?: string;
  /** 窗框色（#rrggbb；缺省浅木白） */
  winCol?: string;
  /** 卧室门开态 */
  doorOpen?: boolean;
  onToggleDoor?: () => void;
  /** 相机对焦物 z（生活模式=小人，编辑模式=轨道中心）；隔墙用它判断是否挡在镜头与对焦物之间 */
  focusRef?: RefObject<{ z: number }>;
}

export default function Room({
  night,
  onFloorTap,
  win,
  onToggleWin,
  floorCol,
  wallCol,
  floorColBed,
  wallColBed,
  doorCol,
  winCol,
  doorOpen,
  onToggleDoor,
  focusRef,
}: RoomProps) {
  const floorTex = useMemo(() => makeFloorTexture(), []);

  /** 客厅/卧室地板各自材质（共享同一张纹理，颜色独立） */
  const floorMat = (col?: string) => (
    <meshStandardMaterial
      map={floorTex}
      color={col ?? (night ? '#c9c5bb' : '#f5f2ec')}
      roughness={0.9}
    />
  );

  return (
    <group>
      {/* 客厅地板（接收阴影 + 点击空白处取消选择；滑动不算点击） */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(e) => {
          if (e.delta > 8) return;
          e.stopPropagation();
          onFloorTap?.();
        }}
      >
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        {floorMat(floorCol)}
      </mesh>

      {/* 卧室地板（颜色与客厅独立） */}
      <mesh
        position={[(BED_X0 + BED_X1) / 2, 0, (BED_Z0 + BED_Z1) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(e) => {
          if (e.delta > 8) return;
          e.stopPropagation();
          onFloorTap?.();
        }}
      >
        <planeGeometry args={[BED_W, BED_Z1 - BED_Z0]} />
        {floorMat(floorColBed)}
      </mesh>

      {/* 地板外沿：浅灰围边（剖面观感） */}
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM_W + 0.6, ROOM_D + 0.6]} />
        <meshStandardMaterial color="#d4d1c9" roughness={0.95} />
      </mesh>
      <mesh position={[(BED_X0 + BED_X1) / 2, -0.05, (BED_Z0 + BED_Z1) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[BED_W + 0.6, BED_Z1 - BED_Z0 + 0.6]} />
        <meshStandardMaterial color="#d4d1c9" roughness={0.95} />
      </mesh>

      {/* 各面墙（自动隐藏朝相机侧；客厅/卧室分开换色） */}
      {WALLS.map((def) => (
        <Wall
          key={def.key}
          def={def}
          night={night}
          wallCol={def.room === 'br' ? wallColBed : wallCol}
          focusRef={focusRef}
        />
      ))}

      {/* 门洞上方的门头梁 */}
      <DoorLintel wallCol={wallCol} night={night} focusRef={focusRef} />

      {/* 卧室门（点击开合，可换色） */}
      <HouseDoor open={!!doorOpen} col={doorCol} night={night} onToggle={() => onToggleDoor?.()} focusRef={focusRef} />

      {/* —— 窗：客厅北×2 + 客厅西 + 卧室西 + 卧室南（上悬窗，点击外翻打开） —— */}
      <Window
        position={[-2.2, 1.5, -ROOM_Z + 0.08]}
        rotationY={0}
        night={night}
        open={win?.[0] ?? false}
        col={winCol}
        onToggle={() => onToggleWin?.(0)}
      />
      <Window
        position={[2.2, 1.5, -ROOM_Z + 0.08]}
        rotationY={0}
        night={night}
        open={win?.[1] ?? false}
        col={winCol}
        onToggle={() => onToggleWin?.(1)}
      />
      <Window
        position={[-ROOM_X + 0.08, 1.5, -1.6]}
        rotationY={Math.PI / 2}
        night={night}
        open={win?.[2] ?? false}
        col={winCol}
        onToggle={() => onToggleWin?.(2)}
      />
      <Window
        position={[-ROOM_X + 0.08, 1.5, 5.2]}
        rotationY={Math.PI / 2}
        night={night}
        open={win?.[3] ?? false}
        col={winCol}
        onToggle={() => onToggleWin?.(3)}
      />
      <Window
        position={[-1.2, 1.5, BED_Z1 - 0.08]}
        rotationY={Math.PI}
        night={night}
        open={win?.[4] ?? false}
        col={winCol}
        onToggle={() => onToggleWin?.(4)}
      />
    </group>
  );
}
