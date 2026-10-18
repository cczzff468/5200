'use client';

/**
 * 情侣小家 3D —— 房间外壳（v4 白色系）
 *
 * - 地板：云白微纹地板（canvas 程序化淡灰拼板缝），支持用户自定义颜色（floorCol 与纹理相乘）；
 * - 墙壁：暖白 + 浅灰踢脚线，浅粉点缀墙裙；四面墙按相机方位自动隐藏（洋房剖面效果）；支持用户自定义颜色；
 * - 窗户：三扇推拉窗（北墙×2 + 西墙×1），点击开/关——活动扇玻璃带阻尼滑移动画，
 *   打开后露出窗外风景（白天蓝天白云小帆船 / 夜晚星空月亮），夜里关窗仍透暖黄光。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { ROOM_W, ROOM_D, WALL_H, WALL_T, ROOM_X, ROOM_Z } from '../catalog';

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
}

const WALLS: WallDef[] = [
  { key: 'back', pos: [0, WALL_H / 2, -ROOM_Z - WALL_T / 2], size: [ROOM_W + WALL_T * 2, WALL_H, WALL_T], normal: new THREE.Vector3(0, 0, -1) },
  { key: 'front', pos: [0, WALL_H / 2, ROOM_Z + WALL_T / 2], size: [ROOM_W + WALL_T * 2, WALL_H, WALL_T], normal: new THREE.Vector3(0, 0, 1) },
  { key: 'left', pos: [-ROOM_X - WALL_T / 2, WALL_H / 2, 0], size: [WALL_T, WALL_H, ROOM_D], normal: new THREE.Vector3(-1, 0, 0) },
  { key: 'right', pos: [ROOM_X + WALL_T / 2, WALL_H / 2, 0], size: [WALL_T, WALL_H, ROOM_D], normal: new THREE.Vector3(1, 0, 0) },
];

function Wall({ def, night, wallCol }: { def: WallDef; night: boolean; wallCol?: string }) {
  const ref = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const center = useMemo(
    () => new THREE.Vector3(def.pos[0], def.pos[1], def.pos[2]),
    [def],
  );

  useFrame(() => {
    if (!ref.current) return;
    // 相机在该墙外侧（视向穿过墙体） → 隐藏，形成剖面屋
    const camDir = camera.position.clone().sub(center);
    ref.current.visible = camDir.dot(def.normal) < 0.6;
  });

  return (
    <group ref={ref}>
      {/* 墙体：暖白（支持用户自定义色） */}
      <mesh position={def.pos} castShadow receiveShadow>
        <boxGeometry args={def.size} />
        <meshStandardMaterial color={wallCol ?? (night ? '#e9e4d8' : '#f7f3ec')} roughness={0.95} />
      </mesh>
      {/* 踢脚线：浅灰（内侧面贴墙） */}
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
    </group>
  );
}

// ---------------- 窗户（推拉窗，可开合） ----------------

/** 窗：浅木框 + 双扇玻璃（左扇固定 / 右扇可推拉），点击开合；
 *  打开露出窗外风景，夜里玻璃透暖光 */
function Window({
  position,
  rotationY,
  night,
  open,
  onToggle,
}: {
  position: [number, number, number];
  rotationY: number;
  night: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const glow = useRef<THREE.PointLight>(null);
  const sash = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const skyTex = useMemo(() => (night ? makeNightSkyTexture() : makeDaySkyTexture()), [night]);

  useFrame((_, dt) => {
    if (!sash.current) return;
    // 活动扇：关 = 右半（x=+0.335），开 = 滑到左半与固定扇重叠（x=-0.335）
    const targetX = open ? -0.335 : 0.335;
    sash.current.position.x = THREE.MathUtils.damp(sash.current.position.x, targetX, 7, dt);
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

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 窗外风景（凹进墙内，透过玻璃可见） */}
      <mesh position={[0, 0, -0.045]}>
        <planeGeometry args={[1.36, 1.14]} />
        <meshBasicMaterial map={skyTex} toneMapped={false} />
      </mesh>

      {/* 窗框（四边条，中空露出风景） */}
      <mesh position={[0, 0.615, 0]} castShadow>
        <boxGeometry args={[1.5, 0.07, 0.1]} />
        <meshStandardMaterial color="#f0e7d4" roughness={0.8} />
      </mesh>
      <mesh position={[0, -0.615, 0]} castShadow>
        <boxGeometry args={[1.5, 0.07, 0.1]} />
        <meshStandardMaterial color="#f0e7d4" roughness={0.8} />
      </mesh>
      <mesh position={[-0.715, 0, 0]} castShadow>
        <boxGeometry args={[0.07, 1.3, 0.1]} />
        <meshStandardMaterial color="#f0e7d4" roughness={0.8} />
      </mesh>
      <mesh position={[0.715, 0, 0]} castShadow>
        <boxGeometry args={[0.07, 1.3, 0.1]} />
        <meshStandardMaterial color="#f0e7d4" roughness={0.8} />
      </mesh>

      {/* 固定扇（左半：玻璃 + 竖棂） */}
      <group
        position={[-0.335, 0, 0.01]}
        onClick={toggle}
        onPointerOver={(e) => {
          void e;
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = 'auto';
        }}
      >
        <mesh>
          <boxGeometry args={[0.6, 1.1, 0.035]} />
          <meshStandardMaterial {...glassProps} />
        </mesh>
        {/* 扇框边（细） */}
        <mesh position={[0.31, 0, 0]}>
          <boxGeometry args={[0.045, 1.16, 0.06]} />
          <meshStandardMaterial color="#f0e7d4" />
        </mesh>
        <mesh position={[-0.31, 0, 0]}>
          <boxGeometry args={[0.045, 1.16, 0.06]} />
          <meshStandardMaterial color="#f0e7d4" />
        </mesh>
        {/* 横棂 */}
        <mesh position={[0, 0, 0.012]}>
          <boxGeometry args={[0.6, 0.04, 0.03]} />
          <meshStandardMaterial color="#f0e7d4" />
        </mesh>
      </group>

      {/* 活动扇（右半，可推拉；hover 提示可点） */}
      <group
        ref={sash}
        position={[0.335, 0, 0.045]}
        onClick={toggle}
        onPointerOver={(e) => {
          void e;
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = 'auto';
        }}
      >
        <mesh>
          <boxGeometry args={[0.6, 1.1, 0.035]} />
          <meshStandardMaterial {...glassProps} />
        </mesh>
        <mesh position={[0.31, 0, 0]}>
          <boxGeometry args={[0.045, 1.16, 0.06]} />
          <meshStandardMaterial color="#f0e7d4" />
        </mesh>
        <mesh position={[-0.31, 0, 0]}>
          <boxGeometry args={[0.045, 1.16, 0.06]} />
          <meshStandardMaterial color="#f0e7d4" />
        </mesh>
        <mesh position={[0, 0.58, 0]}>
          <boxGeometry args={[0.67, 0.045, 0.06]} />
          <meshStandardMaterial color="#f0e7d4" />
        </mesh>
        <mesh position={[0, -0.58, 0]}>
          <boxGeometry args={[0.67, 0.045, 0.06]} />
          <meshStandardMaterial color="#f0e7d4" />
        </mesh>
        <mesh position={[0, 0, 0.012]}>
          <boxGeometry args={[0.6, 0.04, 0.03]} />
          <meshStandardMaterial color="#f0e7d4" />
        </mesh>
        {/* 把手 */}
        <mesh position={[-0.2, 0, 0.045]}>
          <boxGeometry args={[0.035, 0.14, 0.03]} />
          <meshStandardMaterial color="#cfc6b2" roughness={0.6} metalness={0.3} />
        </mesh>
        {/* hover 高亮描边 */}
        {hovered && (
          <mesh position={[0, 0, 0.03]}>
            <ringGeometry args={[0.52, 0.55, 4, 1]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.35} />
          </mesh>
        )}
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
  /** 三扇窗开态（北墙左 / 北墙右 / 西墙） */
  win?: boolean[];
  onToggleWin?: (i: number) => void;
  /** 用户自定义地板色（#rrggbb；缺省云白） */
  floorCol?: string;
  /** 用户自定义墙色（#rrggbb；缺省暖白） */
  wallCol?: string;
}

export default function Room({ night, onFloorTap, win, onToggleWin, floorCol, wallCol }: RoomProps) {
  const floorTex = useMemo(() => makeFloorTexture(), []);
  const floorRef = useRef<THREE.Mesh>(null);

  return (
    <group>
      {/* 地板（接收阴影 + 点击空白处取消选择；滑动不算点击；支持自定义色） */}
      <mesh
        ref={floorRef}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(e) => {
          if (e.delta > 8) return;
          e.stopPropagation();
          onFloorTap?.();
        }}
      >
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial map={floorTex} color={floorCol ?? (night ? '#c9c5bb' : '#f5f2ec')} roughness={0.9} />
      </mesh>

      {/* 地板外沿：浅灰围边（剖面观感） */}
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM_W + 0.6, ROOM_D + 0.6]} />
        <meshStandardMaterial color="#d4d1c9" roughness={0.95} />
      </mesh>

      {/* 四面墙（自动隐藏朝相机侧；支持自定义色） */}
      {WALLS.map((def) => (
        <Wall key={def.key} def={def} night={night} wallCol={wallCol} />
      ))}

      {/* 窗：北墙 × 2 + 西墙 × 1（贴内墙面；可点击推拉开合） */}
      <Window
        position={[-2.2, 1.5, -ROOM_Z + 0.08]}
        rotationY={0}
        night={night}
        open={win?.[0] ?? false}
        onToggle={() => onToggleWin?.(0)}
      />
      <Window
        position={[2.2, 1.5, -ROOM_Z + 0.08]}
        rotationY={0}
        night={night}
        open={win?.[1] ?? false}
        onToggle={() => onToggleWin?.(1)}
      />
      <Window
        position={[-ROOM_X + 0.08, 1.5, -1.6]}
        rotationY={Math.PI / 2}
        night={night}
        open={win?.[2] ?? false}
        onToggle={() => onToggleWin?.(2)}
      />

      {/* 西墙浅粉护墙板点缀（下半墙） */}
      <mesh position={[-ROOM_X + 0.07, 0.55, 1.2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2.4, 1.1]} />
        <meshStandardMaterial color={night ? '#e8c3cd' : '#f6d9e0'} roughness={0.95} />
      </mesh>
    </group>
  );
}
