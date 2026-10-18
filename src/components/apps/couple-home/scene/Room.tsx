'use client';

/**
 * 情侣小家 3D —— 房间外壳（v4 白色系）
 *
 * - 地板：云白微纹地板（canvas 程序化淡灰拼板缝，不再是木色）；
 * - 墙壁：暖白 + 浅灰踢脚线，浅粉点缀墙裙；四面墙按相机方位自动隐藏（洋房剖面效果）；
 * - 窗户：两面墙上装浅黄暖光窗（夜里发暖光）。
 */

import { useMemo, useRef } from 'react';
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
  // 底色：云白
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

function Wall({ def, night }: { def: WallDef; night: boolean }) {
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
      {/* 墙体：暖白 */}
      <mesh position={def.pos} castShadow receiveShadow>
        <boxGeometry args={def.size} />
        <meshStandardMaterial color={night ? '#e9e4d8' : '#f7f3ec'} roughness={0.95} />
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

// ---------------- 窗户 ----------------

/** 窗：浅木框 + 玻璃，白天透天光，夜里发暖黄光 */
function Window({
  position,
  rotationY,
  night,
}: {
  position: [number, number, number];
  rotationY: number;
  night: boolean;
}) {
  const glow = useRef<THREE.PointLight>(null);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 窗框 */}
      <mesh castShadow>
        <boxGeometry args={[1.5, 1.3, 0.1]} />
        <meshStandardMaterial color="#f0e7d4" roughness={0.8} />
      </mesh>
      {/* 玻璃面（外发光） */}
      <mesh position={[0, 0, 0.06]}>
        <boxGeometry args={[1.28, 1.08, 0.03]} />
        <meshStandardMaterial
          color={night ? '#ffdf9e' : '#eef4f2'}
          emissive={night ? '#ffd98f' : '#cfe0ea'}
          emissiveIntensity={night ? 1.4 : 0.12}
          roughness={0.25}
        />
      </mesh>
      {/* 十字窗棂 */}
      <mesh position={[0, 0, 0.08]}>
        <boxGeometry args={[0.05, 1.1, 0.03]} />
        <meshStandardMaterial color="#f0e7d4" />
      </mesh>
      <mesh position={[0, 0, 0.08]}>
        <boxGeometry args={[1.3, 0.05, 0.03]} />
        <meshStandardMaterial color="#f0e7d4" />
      </mesh>
      {/* 夜里窗边暖光 */}
      <pointLight
        ref={glow}
        position={[0, 0, 0.4]}
        color="#ffd98f"
        intensity={night ? 0.5 : 0}
        distance={3.5}
        decay={2}
      />
    </group>
  );
}

// ---------------- 房间整体 ----------------

export default function Room({ night, onFloorTap }: { night: boolean; onFloorTap?: () => void }) {
  const floorTex = useMemo(() => makeFloorTexture(), []);
  const floorRef = useRef<THREE.Mesh>(null);

  return (
    <group>
      {/* 地板（接收阴影 + 点击空白处取消选择；滑动不算点击） */}
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
        <meshStandardMaterial map={floorTex} color={night ? '#c9c5bb' : '#f5f2ec'} roughness={0.9} />
      </mesh>

      {/* 地板外沿：浅灰围边（剖面观感） */}
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM_W + 0.6, ROOM_D + 0.6]} />
        <meshStandardMaterial color="#d4d1c9" roughness={0.95} />
      </mesh>

      {/* 四面墙（自动隐藏朝相机侧） */}
      {WALLS.map((def) => (
        <Wall key={def.key} def={def} night={night} />
      ))}

      {/* 窗：北墙 × 2 + 西墙 × 1（贴内墙面） */}
      <Window position={[-2.2, 1.5, -ROOM_Z + 0.08]} rotationY={0} night={night} />
      <Window position={[2.2, 1.5, -ROOM_Z + 0.08]} rotationY={0} night={night} />
      <Window position={[-ROOM_X + 0.08, 1.5, -1.6]} rotationY={Math.PI / 2} night={night} />

      {/* 西墙浅粉护墙板点缀（下半墙） */}
      <mesh position={[-ROOM_X + 0.07, 0.55, 1.2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2.4, 1.1]} />
        <meshStandardMaterial color={night ? '#e8c3cd' : '#f6d9e0'} roughness={0.95} />
      </mesh>
    </group>
  );
}
