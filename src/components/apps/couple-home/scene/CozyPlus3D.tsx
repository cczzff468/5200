'use client';

/* eslint-disable react-hooks/immutability -- R3F/家具动画需要每帧原地修改 three 对象（幕布/雾气/气泡） */

/**
 * 情侣小家 3D —— 拾光扩展家具「CozyPlus 系列」（12 件程序化模型，无 GLB，v5.7 用户选择清单）
 *
 * - Projector3D 迷你投影仪（开关 → 镜头亮起 + 蓝白光锥）/ Screen3D 高清幕布（挂墙，投影仪开着自动放下放电影）；
 * - SwingChair3D 吊篮秋千椅（永久轻摆 + 藤编吊篮）/ ShoeCabinet3D 玄关鞋柜（双开门 + 拖鞋 + 绿植）；
 * - WallArt3D 装饰挂画组（三联抽象画，程序化油画纹理）/ Humidifier3D 香薰加湿器（雾气袅袅 + 呼吸柔光）；
 * - WineCabinet3D 玻璃酒柜（开门见酒瓶酒杯 + 暖灯）/ ChessTable3D 棋盘桌（五子棋盘 + 棋子 + 双凳）；
 * - HotpotTable3D 火锅桌（开火红汤翻滚冒泡 + 蒸汽）/ Hammock3D 双人吊床（立柱吊床轻晃）；
 * - GameConsole3D 游戏主机（开机灯带 + 手柄）/ FlowerStand3D 开花花架（三层花架 + 花瓣微落）。
 *
 * 约定：原点 = 底部中心贴地 y=0（Screen3D/WallArt3D 挂墙件 = 挂点、背面贴墙朝 +z 伸向屋内）；
 * 配色全屋暖奶油系；动画一律 useFrame + THREE.MathUtils.damp / sin；
 * 尺寸单位 = 米（世界坐标，MODEL_SCALE 由接线方处理——本系列直接按世界尺寸建模）。
 */

import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/** 共享 props：接线方按家具类型透传 */
export interface CozyPlusProps {
  col?: string;      // 用户调色主色
  on?: boolean;      // 开关状态（projector/humidifier/gameConsole/hotpotTable 炉火）
  open?: boolean;    // 门开合（shoeCabinet/wineCabinet）/ 幕布放下（screen 跟随投影仪）
  projectorOn?: boolean; // 任一投影仪开着（screen 用）
  sat?: boolean;     // 有人坐在吊篮上（摆幅加大）
}

const mat = (c: string, rough = 0.85, extra?: Partial<THREE.MeshStandardMaterialParameters>) => (
  <meshStandardMaterial color={c} roughness={rough} metalness={0} {...extra} />
);

/** 同色系加深（制造凹陷/裙边阴影感） */
const shade = (hex: string, f: number) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();

/** 白色蒸汽雾贴图（径向渐变） */
function makeSteamTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 电影画面贴图：黄昏山谷（canvas 手绘静态帧 + 缓慢横移当运镜） */
function makeMovieTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 640;
  cv.height = 360;
  const ctx = cv.getContext('2d')!;
  // 天空渐变
  const sky = ctx.createLinearGradient(0, 0, 0, 250);
  sky.addColorStop(0, '#2a3a5e');
  sky.addColorStop(0.45, '#7a5a8e');
  sky.addColorStop(0.8, '#e8927c');
  sky.addColorStop(1, '#f7c48e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 640, 250);
  // 星星
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 640;
    const y = Math.random() * 110;
    const r = Math.random() * 1.6 + 0.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 太阳
  const sun = ctx.createRadialGradient(430, 208, 6, 430, 208, 52);
  sun.addColorStop(0, '#fff3d6');
  sun.addColorStop(0.4, '#ffd98f');
  sun.addColorStop(1, 'rgba(255,217,143,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(360, 140, 140, 120);
  // 远山两层
  ctx.fillStyle = '#5a4a72';
  ctx.beginPath();
  ctx.moveTo(0, 250);
  for (let x = 0; x <= 640; x += 32) ctx.lineTo(x, 190 + Math.sin(x * 0.017) * 34 + Math.cos(x * 0.041) * 14);
  ctx.lineTo(640, 250);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3a324e';
  ctx.beginPath();
  ctx.moveTo(0, 260);
  for (let x = 0; x <= 640; x += 28) ctx.lineTo(x, 226 + Math.sin(x * 0.023 + 2) * 24 + Math.cos(x * 0.055) * 9);
  ctx.lineTo(640, 260);
  ctx.closePath();
  ctx.fill();
  // 近景草地
  ctx.fillStyle = '#2c3040';
  ctx.fillRect(0, 250, 640, 110);
  // 云
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  for (const [cx, cy, cw] of [[120, 90, 130], [360, 60, 170], [560, 110, 110]] as const) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw / 2, 16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** 抽象油画贴图（三联画共用生成器：seed 决定构图） */
function makeArtTexture(seed: number): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  // 米白底
  ctx.fillStyle = '#f7f2e8';
  ctx.fillRect(0, 0, S, S);
  // 大色块弧形（粉/黄/绿/紫按 seed 轮换）
  const palette = [
    ['#f2b3c2', '#f9e6a6', '#c9e3cf'],
    ['#f6cdd6', '#dcd2ec', '#b8d9c9'],
    ['#f4d0a0', '#c5d6e8', '#eec9d8'],
  ][seed % 3];
  const rnd = (n: number) => {
    const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = palette[i % palette.length];
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(rnd(i) * S, rnd(i + 9) * S, S * (0.16 + rnd(i + 4) * 0.2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 一道弧线
  ctx.strokeStyle = '#3a3a3e';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(S * 0.5, S * 0.62, S * 0.3, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------- 1. 迷你投影仪 ----------------

export function Projector3D({ col, on }: CozyPlusProps) {
  const body = col ?? '#f4f1ea';
  const lens = useRef<THREE.Mesh>(null);
  const cone = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (lens.current) {
      const m = lens.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = on ? 2.2 + Math.sin(t * 7) * 0.35 : 0.08;
    }
    if (cone.current) {
      cone.current.visible = !!on;
      // 光锥微微浮动 + 尘埃感（透明度呼吸）
      cone.current.rotation.z = Math.sin(t * 0.7) * 0.012;
    }
  });
  return (
    <group>
      {/* 机身（圆角感：主体 + 顶盖） */}
      <mesh position={[0, 0.07, 0]} castShadow>
        <boxGeometry args={[0.36, 0.1, 0.28]} />
        {mat(body, 0.6)}
      </mesh>
      <mesh position={[0, 0.135, -0.01]} castShadow>
        <boxGeometry args={[0.3, 0.035, 0.22]} />
        {mat(shade(body, 0.92), 0.65)}
      </mesh>
      {/* 支脚 ×4 */}
      {[[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.1], [0.14, 0.1]].map((p, i) => (
        <mesh key={i} position={[p[0], 0.012, p[1]]}>
          <cylinderGeometry args={[0.018, 0.022, 0.024, 10]} />
          {mat('#4a4a50', 0.7)}
        </mesh>
      ))}
      {/* 镜头（面朝 +z） */}
      <mesh position={[0.06, 0.08, 0.145]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.055, 0.055, 0.03, 20]} />
        {mat('#2c2f36', 0.35, { metalness: 0.3 })}
      </mesh>
      <mesh ref={lens} position={[0.06, 0.08, 0.162]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.006, 20]} />
        <meshStandardMaterial color="#dceaff" emissive="#bcd6ff" emissiveIntensity={0.1} />
      </mesh>
      {/* 散热格栅 */}
      {[-0.03, 0.01, 0.05].map((x, i) => (
        <mesh key={i} position={[x, 0.09, -0.142]}>
          <boxGeometry args={[0.012, 0.05, 0.004]} />
          {mat('#c9c4b8', 0.7)}
        </mesh>
      ))}
      {/* 光锥（开机时投向前方） */}
      <group ref={cone} position={[0.06, 0.08, 0.17]} visible={false}>
        <mesh position={[0, 0, 1.1]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.72, 2.2, 24, 1, true]} />
          <meshBasicMaterial
            color="#cfe0ff"
            transparent
            opacity={0.09}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>
    </group>
  );
}

// ---------------- 2. 高清幕布（挂墙：投影仪开着自动放下放电影） ----------------

export function Screen3D({ col, projectorOn }: CozyPlusProps) {
  const casing = col ?? '#eae6dc';
  const drop = useRef<THREE.Group>(null);
  const movieTex = useMemo(() => makeMovieTexture(), []);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, dt) => {
    if (!drop.current) return;
    // 幕布放下/收起（y 缩放 0.04 ↔ 1）
    const target = projectorOn ? 1 : 0.04;
    const cur = drop.current.scale.y;
    const next = THREE.MathUtils.damp(cur, target, 4.2, dt);
    drop.current.scale.y = next;
    drop.current.position.y = -1.3 * (1 - next);
    drop.current.visible = next > 0.06;
    // 运镜：电影画面缓慢横移
    movieTex.offset.x = (movieTex.offset.x + dt * 0.008) % 1;
    if (matRef.current) {
      matRef.current.emissiveIntensity = projectorOn ? 0.62 : 0;
    }
  });
  return (
    <group>
      {/* 卷轴外壳（挂墙横杆） */}
      <mesh position={[0, 0.02, 0.06]} castShadow>
        <boxGeometry args={[2.3, 0.1, 0.12]} />
        {mat(casing, 0.7)}
      </mesh>
      <mesh position={[0, 0.02, 0.125]}>
        <boxGeometry args={[2.34, 0.04, 0.01]} />
        {mat(shade(casing, 0.88), 0.7)}
      </mesh>
      {/* 幕布（从卷轴向下展开；本地组 y=0 在卷轴下沿） */}
      <group ref={drop} position={[0, -1.3, 0]} scale={[1, 0.04, 1]}>
        <mesh position={[0, 1.3, 0.045]} castShadow>
          <boxGeometry args={[2.16, 2.6, 0.02]} />
          {mat('#fbfaf6', 0.9)}
        </mesh>
        {/* 电影画面（宽银幕 + 上下黑边） */}
        <mesh position={[0, 1.3, 0.058]}>
          <planeGeometry args={[2.02, 1.14]} />
          <meshStandardMaterial ref={matRef} map={movieTex} emissive="#ffffff" emissiveMap={movieTex} emissiveIntensity={0} toneMapped={false} />
        </mesh>
        {/* 黑边（2.35:1 电影感） */}
        <mesh position={[0, 1.3 + 0.66, 0.059]}>
          <planeGeometry args={[2.02, 0.19]} />
          <meshBasicMaterial color="#101014" toneMapped={false} />
        </mesh>
        <mesh position={[0, 1.3 - 0.66, 0.059]}>
          <planeGeometry args={[2.02, 0.19]} />
          <meshBasicMaterial color="#101014" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

// ---------------- 3. 吊篮秋千椅 ----------------

export function SwingChair3D({ col, sat }: CozyPlusProps) {
  const rattan = col ?? '#e2cba8';
  const basket = useRef<THREE.Group>(null);
  useFrame((state, dt) => {
    if (!basket.current) return;
    const t = state.clock.elapsedTime;
    // 坐上去摆幅加大（阻尼过渡），平时轻晃
    const amp = THREE.MathUtils.damp(basket.current.userData.amp ?? 0.045, sat ? 0.13 : 0.045, 2.2, dt);
    basket.current.userData.amp = amp;
    basket.current.rotation.x = Math.sin(t * 1.35) * amp;
  });
  return (
    <group>
      {/* C 形吊架 */}
      <mesh position={[-0.5, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.045, 1.9, 12]} />
        {mat('#d9cbb2', 0.7)}
      </mesh>
      <mesh position={[-0.24, 1.9, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 0.56, 12]} />
        {mat('#d9cbb2', 0.7)}
      </mesh>
      <mesh position={[-0.5, 0.03, 0]}>
        <cylinderGeometry args={[0.3, 0.34, 0.06, 18]} />
        {mat('#d9cbb2', 0.75)}
      </mesh>
      {/* 吊篮（挂点 = 横梁右端，绳 + 篮体一起摆） */}
      <group ref={basket} position={[0.02, 1.88, 0]}>
        {/* 吊绳 ×3 */}
        {[-0.26, 0.26].map((x, i) => (
          <mesh key={i} position={[x, -0.42, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.84, 8]} />
            {mat('#b09a7a', 0.8)}
          </mesh>
        ))}
        <mesh position={[0, -0.42, 0.24]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.011, 0.011, 0.48, 8]} />
          {mat('#b09a7a', 0.8)}
        </mesh>
        <mesh position={[0, -0.42, -0.24]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.011, 0.011, 0.48, 8]} />
          {mat('#b09a7a', 0.8)}
        </mesh>
        {/* 藤编吊篮：圆筒 + 内凹坐垫 + 靠背 */}
        <mesh position={[0, -1.06, 0]} castShadow>
          <cylinderGeometry args={[0.4, 0.34, 0.5, 20, 1, true]} />
          <meshStandardMaterial color={rattan} roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, -0.83, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.4, 0.03, 10, 24]} />
          {mat(shade(rattan, 0.85), 0.85)}
        </mesh>
        {/* 坐垫 */}
        <mesh position={[0, -0.92, 0.02]}>
          <cylinderGeometry args={[0.34, 0.3, 0.09, 20]} />
          {mat('#f6e8e2', 0.95)}
        </mesh>
        {/* 靠背垫（贴后侧） */}
        <mesh position={[0, -0.72, -0.3]} rotation={[-0.28, 0, 0]} castShadow>
          <boxGeometry args={[0.6, 0.5, 0.08]} />
          {mat('#f6e8e2', 0.95)}
        </mesh>
      </group>
    </group>
  );
}

// ---------------- 4. 玄关鞋柜 ----------------

export function ShoeCabinet3D({ col, open }: CozyPlusProps) {
  const body = col ?? '#efe9dd';
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const t = open ? -1.9 : 0;
    if (left.current) left.current.rotation.y = THREE.MathUtils.damp(left.current.rotation.y, t, 6, dt);
    if (right.current) right.current.rotation.y = THREE.MathUtils.damp(right.current.rotation.y, -t, 6, dt);
  });
  return (
    <group>
      {/* 柜体 */}
      <mesh position={[0, 0.62, 0.18]} castShadow receiveShadow>
        <boxGeometry args={[1.0, 1.1, 0.38]} />
        {mat(body, 0.8)}
      </mesh>
      <mesh position={[0, 1.185, 0.18]}>
        <boxGeometry args={[1.04, 0.04, 0.42]} />
        {mat(shade(body, 0.9), 0.75)}
      </mesh>
      {/* 双门（左右对开） */}
      <group ref={left} position={[-0.5, 0.62, 0.37]}>
        <mesh position={[0.24, 0, 0.01]} castShadow>
          <boxGeometry args={[0.47, 1.02, 0.025]} />
          {mat('#f6f1e7', 0.7)}
        </mesh>
        <mesh position={[0.44, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.014, 0.014, 0.1, 8]} />
          {mat('#c9a86c', 0.4, { metalness: 0.5 })}
        </mesh>
      </group>
      <group ref={right} position={[0.5, 0.62, 0.37]}>
        <mesh position={[-0.24, 0, 0.01]} castShadow>
          <boxGeometry args={[0.47, 1.02, 0.025]} />
          {mat('#f6f1e7', 0.7)}
        </mesh>
        <mesh position={[-0.44, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.014, 0.014, 0.1, 8]} />
          {mat('#c9a86c', 0.4, { metalness: 0.5 })}
        </mesh>
      </group>
      {/* 柜底拖鞋 ×2 */}
      <mesh position={[-0.24, 0.035, 0.3]} rotation={[0, 0.3, 0]}>
        <boxGeometry args={[0.1, 0.045, 0.24]} />
        {mat('#f2c1cd', 0.95)}
      </mesh>
      <mesh position={[-0.06, 0.035, 0.34]} rotation={[0, -0.2, 0]}>
        <boxGeometry args={[0.1, 0.045, 0.24]} />
        {mat('#f2c1cd', 0.95)}
      </mesh>
      {/* 柜顶小盆栽 + 钥匙盘 */}
      <mesh position={[0.32, 1.24, 0.16]}>
        <cylinderGeometry args={[0.06, 0.05, 0.08, 12]} />
        {mat('#d9a8a0', 0.8)}
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0.32 + (i - 1) * 0.03, 1.33, 0.16 + (i - 1) * 0.02]} rotation={[0.2 * (i - 1), 0, 0.15 * (i - 1)]}>
          <sphereGeometry args={[0.045, 8, 8]} />
          {mat('#8fbf9a', 0.9)}
        </mesh>
      ))}
      <mesh position={[-0.3, 1.21, 0.16]}>
        <cylinderGeometry args={[0.09, 0.08, 0.02, 16]} />
        {mat('#c9a86c', 0.5, { metalness: 0.4 })}
      </mesh>
    </group>
  );
}

// ---------------- 5. 装饰挂画组（三联，挂墙） ----------------

export function WallArt3D({ col }: CozyPlusProps) {
  const frame = col ?? '#e8e2d4';
  const texs = useMemo(() => [makeArtTexture(1), makeArtTexture(2), makeArtTexture(3)], []);
  return (
    <group>
      {/* 中幅（大） */}
      <mesh position={[0, 0.36, 0.02]} castShadow>
        <boxGeometry args={[0.62, 0.62, 0.03]} />
        {mat(frame, 0.75)}
      </mesh>
      <mesh position={[0, 0.36, 0.038]}>
        <planeGeometry args={[0.54, 0.54]} />
        <meshStandardMaterial map={texs[1]} roughness={0.7} />
      </mesh>
      {/* 左幅（小，略高） */}
      <mesh position={[-0.47, 0.4, 0.02]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.03]} />
        {mat(frame, 0.75)}
      </mesh>
      <mesh position={[-0.47, 0.4, 0.038]}>
        <planeGeometry args={[0.23, 0.33]} />
        <meshStandardMaterial map={texs[0]} roughness={0.7} />
      </mesh>
      {/* 右幅（小，略低） */}
      <mesh position={[0.47, 0.32, 0.02]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.03]} />
        {mat(frame, 0.75)}
      </mesh>
      <mesh position={[0.47, 0.32, 0.038]}>
        <planeGeometry args={[0.23, 0.33]} />
        <meshStandardMaterial map={texs[2]} roughness={0.7} />
      </mesh>
      {/* 底部细影线 */}
      <mesh position={[0, 0.015, 0.02]}>
        <boxGeometry args={[1.5, 0.03, 0.01]} />
        {mat(shade(frame, 0.85), 0.8)}
      </mesh>
    </group>
  );
}

// ---------------- 6. 香薰加湿器 ----------------

export function Humidifier3D({ col, on }: CozyPlusProps) {
  const body = col ?? '#e6efe9';
  const steamTex = useMemo(() => makeSteamTexture(), []);
  const puffs = useRef<(THREE.Sprite | null)[]>([]);
  const ring = useRef<THREE.Mesh>(null);
  const seeds = useMemo(() => [0, 0.33, 0.66, 0.5], []);
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    puffs.current.forEach((sp, i) => {
      if (!sp) return;
      sp.visible = !!on;
      if (!on) return;
      const s = seeds[i];
      const life = ((t * 0.5 + s) % 1);
      sp.position.set(Math.sin((t + s * 9) * 1.1) * 0.03, 0.3 + life * 0.55, Math.cos((t + s * 7) * 0.9) * 0.03);
      sp.scale.setScalar(0.1 + life * 0.3);
      (sp.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.55 * (1 - life));
    });
    if (ring.current) {
      const m = ring.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = on ? 0.9 + Math.sin(t * 2.4) * 0.4 : 0.06;
    }
  });
  return (
    <group>
      {/* 花瓶机身 */}
      <mesh position={[0, 0.14, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.13, 0.28, 20]} />
        {mat(body, 0.7)}
      </mesh>
      <mesh position={[0, 0.3, 0]} castShadow>
        <sphereGeometry args={[0.1, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        {mat(shade(body, 0.94), 0.65)}
      </mesh>
      {/* 出雾口 */}
      <mesh position={[0, 0.36, 0.04]} rotation={[0.35, 0, 0]}>
        <cylinderGeometry args={[0.035, 0.04, 0.05, 12]} />
        {mat('#f7f5ef', 0.6)}
      </mesh>
      {/* 呼吸灯环 */}
      <mesh ref={ring} position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.118, 0.008, 8, 32]} />
        <meshStandardMaterial color="#b8e6d9" emissive="#8fd9c4" emissiveIntensity={0.06} />
      </mesh>
      {/* 雾（sprite 升腾） */}
      {seeds.map((s, i) => (
        <sprite
          key={i}
          ref={(el) => {
            puffs.current[i] = el;
          }}
          position={[0, 0.4, 0]}
          visible={false}
        >
          <spriteMaterial map={steamTex} transparent opacity={0.5} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

// ---------------- 7. 玻璃酒柜 ----------------

export function WineCabinet3D({ col, open }: CozyPlusProps) {
  const body = col ?? '#efe9dd';
  const door = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (door.current) door.current.rotation.y = THREE.MathUtils.damp(door.current.rotation.y, open ? -1.9 : 0, 6, dt);
    if (glow.current) {
      (glow.current.material as THREE.MeshStandardMaterial).emissiveIntensity = THREE.MathUtils.damp(
        (glow.current.material as THREE.MeshStandardMaterial).emissiveIntensity,
        open ? 1.1 : 0.15,
        4,
        dt,
      );
    }
  });
  const bottles: [number, number, string][] = [
    [-0.28, 1.22, '#7a4a3a'],
    [-0.12, 1.22, '#3a5a4a'],
    [0.06, 1.22, '#8a5a4a'],
    [0.24, 1.22, '#5a3a5a'],
    [-0.2, 0.78, '#4a4a6a'],
    [0.0, 0.78, '#7a5a3a'],
    [0.2, 0.78, '#3a5a5a'],
  ];
  return (
    <group>
      {/* 柜体（左侧实板 + 右侧玻璃展示区） */}
      <mesh position={[0, 0.81, 0.2]} castShadow receiveShadow>
        <boxGeometry args={[0.92, 1.62, 0.44]} />
        {mat(body, 0.8)}
      </mesh>
      {/* 展示区开口（内嵌深色背板 + 暖灯） */}
      <mesh position={[0.1, 0.95, 0.2]}>
        <boxGeometry args={[0.62, 1.1, 0.4]} />
        {mat('#2e2a2e', 0.9)}
      </mesh>
      <mesh ref={glow} position={[0.1, 1.48, 0.32]}>
        <boxGeometry args={[0.5, 0.02, 0.02]} />
        <meshStandardMaterial color="#ffd9a0" emissive="#ffca7a" emissiveIntensity={0.15} />
      </mesh>
      {/* 层板 ×2 */}
      {[0.98, 0.52].map((y, i) => (
        <mesh key={i} position={[0.1, y, 0.2]}>
          <boxGeometry args={[0.62, 0.025, 0.4]} />
          {mat(shade(body, 0.88), 0.75)}
        </mesh>
      ))}
      {/* 酒瓶（躺在层板 + 站立） */}
      {bottles.map(([x, y, c], i) => (
        <group key={i} position={[x + 0.08, y + 0.09, 0.2]} rotation={[0, 0, Math.PI / 2 - (i % 2) * 0.06]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.038, 0.038, 0.17, 10]} />
            <meshStandardMaterial color={c} roughness={0.25} metalness={0.1} />
          </mesh>
          <mesh position={[0, 0.115, 0]}>
            <cylinderGeometry args={[0.012, 0.02, 0.08, 8]} />
            <meshStandardMaterial color={c} roughness={0.3} />
          </mesh>
        </group>
      ))}
      {/* 倒挂酒杯（顶层板下） */}
      {[-0.12, 0.04, 0.2].map((x, i) => (
        <group key={i} position={[x + 0.08, 0.92, 0.2]}>
          <mesh position={[0, -0.03, 0]}>
            <cylinderGeometry args={[0.028, 0.02, 0.05, 10, 1, true]} />
            <meshStandardMaterial color="#e8f2f5" roughness={0.1} transparent opacity={0.55} />
          </mesh>
          <mesh position={[0, -0.07, 0]}>
            <cylinderGeometry args={[0.006, 0.006, 0.04, 6]} />
            <meshStandardMaterial color="#e8f2f5" roughness={0.2} transparent opacity={0.6} />
          </mesh>
        </group>
      ))}
      {/* 玻璃门（右开合） */}
      <group ref={door} position={[-0.24, 0.95, 0.42]}>
        <mesh position={[0.34, 0, 0]} castShadow>
          <boxGeometry args={[0.66, 1.12, 0.02]} />
          <meshStandardMaterial color="#dceef2" roughness={0.08} metalness={0.1} transparent opacity={0.32} />
        </mesh>
        <mesh position={[0.66, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.1, 8]} />
          {mat('#c9a86c', 0.4, { metalness: 0.5 })}
        </mesh>
      </group>
      {/* 左侧门（实板装饰） */}
      <mesh position={[-0.33, 0.95, 0.43]} castShadow>
        <boxGeometry args={[0.2, 1.12, 0.025]} />
        {mat('#f6f1e7', 0.7)}
      </mesh>
      {/* 柜脚 */}
      {[[-0.38, 0.06], [0.38, 0.06]].map((p, i) => (
        <mesh key={i} position={[p[0], 0.03, 0.2]}>
          <cylinderGeometry args={[0.025, 0.03, 0.06, 8]} />
          {mat('#c9b89a', 0.8)}
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 8. 棋盘桌（五子棋） ----------------

export function ChessTable3D({ col }: CozyPlusProps) {
  const wood = col ?? '#e8d9be';
  const boardTex = useMemo(() => {
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#f0dfb8';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#8a6a48';
    ctx.lineWidth = 2;
    const N = 14;
    const pad = 34;
    const cell = (S - pad * 2) / N;
    for (let i = 0; i <= N; i++) {
      const p = pad + i * cell;
      ctx.beginPath();
      ctx.moveTo(pad, p);
      ctx.lineTo(S - pad, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, pad);
      ctx.lineTo(p, S - pad);
      ctx.stroke();
    }
    // 五个星位
    for (const [gx, gy] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) {
      ctx.fillStyle = '#8a6a48';
      ctx.beginPath();
      ctx.arc(pad + gx * cell, pad + gy * cell, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
  // 一局残局棋子（固定坐标 0~1 相对棋盘）
  const stones = useMemo<[number, number, 0 | 1][]>(
    () => [
      [0.5, 0.5, 0], [0.57, 0.5, 1], [0.5, 0.57, 0], [0.57, 0.57, 1], [0.43, 0.5, 0],
      [0.64, 0.57, 1], [0.5, 0.64, 0], [0.43, 0.64, 1], [0.36, 0.57, 0], [0.64, 0.43, 1],
    ],
    [],
  );
  return (
    <group>
      {/* 方桌 */}
      <mesh position={[0, 0.68, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.95, 0.06, 0.95]} />
        {mat(wood, 0.75)}
      </mesh>
      <mesh position={[0, 0.34, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.12, 0.64, 12]} />
        {mat(shade(wood, 0.9), 0.8)}
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.3, 0.34, 0.08, 18]} />
        {mat(shade(wood, 0.85), 0.8)}
      </mesh>
      {/* 棋盘 */}
      <mesh position={[0, 0.715, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.8, 0.8]} />
        <meshStandardMaterial map={boardTex} roughness={0.65} />
      </mesh>
      {/* 棋子 */}
      {stones.map(([gx, gz, black], i) => (
        <mesh key={i} position={[-0.4 + gx * 0.8, 0.728, -0.4 + gz * 0.8]} castShadow>
          <sphereGeometry args={[0.022, 12, 10]} />
          {black
            ? <meshStandardMaterial color="#2e2e34" roughness={0.3} />
            : <meshStandardMaterial color="#f7f5ef" roughness={0.35} />}
        </mesh>
      ))}
      {/* 双凳 */}
      {[-0.78, 0.78].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, 0.42, 0]} castShadow>
            <cylinderGeometry args={[0.19, 0.17, 0.07, 16]} />
            {mat('#f6ede0', 0.9)}
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.05, 0.07, 0.38, 10]} />
            {mat(shade(wood, 0.88), 0.8)}
          </mesh>
          <mesh position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.14, 0.16, 0.04, 14]} />
            {mat(shade(wood, 0.84), 0.85)}
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------- 9. 火锅桌 ----------------

export function HotpotTable3D({ col, on }: CozyPlusProps) {
  const wood = col ?? '#e8d9be';
  const soup = useRef<THREE.Mesh>(null);
  const bubblesRef = useRef<(THREE.Mesh | null)[]>([]);
  const steamTex = useMemo(() => makeSteamTexture(), []);
  const steams = useRef<(THREE.Sprite | null)[]>([]);
  const bubbleSeeds = useMemo(() => [0.1, 0.35, 0.55, 0.8, 0.22, 0.68], []);
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    if (soup.current) {
      const m = soup.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = THREE.MathUtils.damp(m.emissiveIntensity, on ? 0.5 : 0.02, 5, dt);
      if (on) soup.current.position.y = 0.66 + Math.sin(t * 5) * 0.002;
    }
    bubblesRef.current.forEach((b, i) => {
      if (!b) return;
      b.visible = !!on;
      if (!on) return;
      const s = bubbleSeeds[i];
      const life = (t * 0.9 + s) % 1;
      b.position.set(Math.sin(s * 40) * 0.07, 0.67 + life * 0.05, Math.cos(s * 31) * 0.07);
      b.scale.setScalar(1 - life * 0.5);
    });
    steams.current.forEach((sp, i) => {
      if (!sp) return;
      sp.visible = !!on;
      if (!on) return;
      const s = bubbleSeeds[i] + 0.5;
      const life = (t * 0.42 + s) % 1;
      sp.position.set(Math.sin((t + s * 8) * 1.2) * 0.04, 0.72 + life * 0.5, Math.cos((t + s * 6) * 0.9) * 0.04);
      sp.scale.setScalar(0.14 + life * 0.3);
      (sp.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.5 * (1 - life));
    });
  });
  return (
    <group>
      {/* 桌面（木纹方桌） */}
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.1, 0.07, 1.1]} />
        {mat(wood, 0.75)}
      </mesh>
      {/* 桌腿 ×4 */}
      {[[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]].map((p, i) => (
        <mesh key={i} position={[p[0], 0.35, p[1]]} castShadow>
          <cylinderGeometry args={[0.045, 0.05, 0.7, 10]} />
          {mat(shade(wood, 0.88), 0.8)}
        </mesh>
      ))}
      {/* 嵌入式电磁炉 + 鸳鸯锅 */}
      <mesh position={[0, 0.782, 0]}>
        <cylinderGeometry args={[0.26, 0.26, 0.03, 24]} />
        {mat('#33363c', 0.5)}
      </mesh>
      {/* 锅体 */}
      <mesh position={[0, 0.8, 0]} castShadow>
        <cylinderGeometry args={[0.21, 0.17, 0.09, 24]} />
        <meshStandardMaterial color="#c9c2b4" roughness={0.4} metalness={0.3} />
      </mesh>
      {/* 红汤（发光沸腾） */}
      <mesh ref={soup} position={[0, 0.83, 0]}>
        <cylinderGeometry args={[0.185, 0.185, 0.015, 24]} />
        <meshStandardMaterial color="#c2482e" emissive="#e05a34" emissiveIntensity={0.02} roughness={0.35} />
      </mesh>
      {/* 中隔板（小鸳鸯格） */}
      <mesh position={[0, 0.838, 0]}>
        <boxGeometry args={[0.37, 0.012, 0.05]} />
        <meshStandardMaterial color="#c9c2b4" roughness={0.4} metalness={0.3} />
      </mesh>
      {/* 气泡 */}
      {bubbleSeeds.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            bubblesRef.current[i] = el;
          }}
          position={[0, 0.85, 0]}
          visible={false}
        >
          <sphereGeometry args={[0.014, 8, 8]} />
          <meshStandardMaterial color="#f4b8a0" roughness={0.2} transparent opacity={0.85} />
        </mesh>
      ))}
      {/* 蒸汽 */}
      {[0, 1, 2].map((i) => (
        <sprite
          key={i}
          ref={(el) => {
            steams.current[i] = el;
          }}
          position={[0, 0.9, 0]}
          visible={false}
        >
          <spriteMaterial map={steamTex} transparent opacity={0.5} depthWrite={false} />
        </sprite>
      ))}
      {/* 配菜盘 ×2 + 筷子 */}
      <mesh position={[-0.38, 0.79, -0.2]}>
        <cylinderGeometry args={[0.11, 0.1, 0.03, 18]} />
        {mat('#f7f5ef', 0.5)}
      </mesh>
      <mesh position={[-0.38, 0.81, -0.2]}>
        <cylinderGeometry args={[0.07, 0.07, 0.02, 14]} />
        {mat('#9fbf8a', 0.8)}
      </mesh>
      <mesh position={[0.38, 0.79, 0.18]}>
        <cylinderGeometry args={[0.11, 0.1, 0.03, 18]} />
        {mat('#f7f5ef', 0.5)}
      </mesh>
      <mesh position={[0.38, 0.81, 0.18]}>
        <cylinderGeometry args={[0.07, 0.07, 0.02, 14]} />
        {mat('#e8b8a0', 0.8)}
      </mesh>
      <mesh position={[0.36, 0.785, -0.3]} rotation={[0, 0.4, 0]}>
        <boxGeometry args={[0.02, 0.015, 0.3]} />
        {mat('#c9a06a', 0.7)}
      </mesh>
      {/* 两侧餐凳 */}
      {[-0.85, 0.85].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, 0.42, 0]} castShadow>
            <boxGeometry args={[0.34, 0.06, 0.34]} />
            {mat('#f6ede0', 0.9)}
          </mesh>
          {[[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]].map((p, j) => (
            <mesh key={j} position={[p[0], 0.2, p[1]]}>
              <cylinderGeometry args={[0.022, 0.026, 0.4, 8]} />
              {mat(shade(wood, 0.86), 0.8)}
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ---------------- 10. 双人吊床 ----------------

export function Hammock3D({ col }: CozyPlusProps) {
  const cloth = col ?? '#f2c1cd';
  const bed = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!bed.current) return;
    const t = state.clock.elapsedTime;
    bed.current.rotation.z = Math.sin(t * 1.05) * 0.025;
  });
  return (
    <group>
      {/* 两端立柱（A 字支架） */}
      {[[-1.05, 0.18], [1.05, -0.18]].map(([x, tilt], i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, 0.75, -0.16]} rotation={[0, 0, tilt]} castShadow>
            <cylinderGeometry args={[0.045, 0.055, 1.5, 10]} />
            {mat('#d9cbb2', 0.75)}
          </mesh>
          <mesh position={[0, 0.75, 0.16]} rotation={[0, 0, -tilt]} castShadow>
            <cylinderGeometry args={[0.045, 0.055, 1.5, 10]} />
            {mat('#d9cbb2', 0.75)}
          </mesh>
          <mesh position={[0, 0.02, 0]}>
            <boxGeometry args={[0.14, 0.05, 0.6]} />
            {mat(shade('#d9cbb2', 0.88), 0.85)}
          </mesh>
        </group>
      ))}
      {/* 吊床（布面 + 两端系绳，整体轻晃） */}
      <group ref={bed}>
        {/* 布面：中间下垂的弧形（用弯曲的扁圆柱近似） */}
        <mesh position={[0, 0.52, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <torusGeometry args={[0.62, 0.14, 8, 28, Math.PI]} />
          <meshStandardMaterial color={cloth} roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
        {/* 枕区加厚 */}
        <mesh position={[-0.62, 0.66, 0]} rotation={[0, 0, 0.32]} castShadow>
          <boxGeometry args={[0.5, 0.09, 0.5]} />
          {mat('#f7f0ea', 0.95)}
        </mesh>
        {/* 系绳 */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.98, 0.98, 0]} rotation={[0, 0, s * 0.5]}>
            <cylinderGeometry args={[0.012, 0.012, 0.75, 8]} />
            {mat('#b09a7a', 0.85)}
          </mesh>
        ))}
        {/* 布面流苏边 */}
        {[-1, 1].map((s) => (
          <mesh key={`f${s}`} position={[s * 0.55, 0.52, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.145, 0.145, 0.015, 14]} />
            {mat(shade(cloth, 0.9), 0.95)}
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---------------- 11. 游戏主机 ----------------

export function GameConsole3D({ col, on }: CozyPlusProps) {
  const body = col ?? '#2f3138';
  const led = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!led.current) return;
    const m = led.current.material as THREE.MeshStandardMaterial;
    m.emissiveIntensity = on ? 1.6 + Math.sin(state.clock.elapsedTime * 4) * 0.5 : 0.05;
  });
  return (
    <group>
      {/* 主机（横卧长方体） */}
      <mesh position={[0, 0.045, 0]} castShadow>
        <boxGeometry args={[0.42, 0.09, 0.3]} />
        {mat(body, 0.5, { metalness: 0.2 })}
      </mesh>
      <mesh position={[0, 0.092, 0]}>
        <boxGeometry args={[0.4, 0.008, 0.28]} />
        {mat('#43464e', 0.45, { metalness: 0.3 })}
      </mesh>
      {/* 呼吸灯带 */}
      <mesh ref={led} position={[0, 0.05, 0.152]}>
        <boxGeometry args={[0.34, 0.012, 0.006]} />
        <meshStandardMaterial color="#7fe0b0" emissive="#4ecf96" emissiveIntensity={0.05} />
      </mesh>
      {/* 手柄 ×2（摆在主机前） */}
      {[-0.16, 0.16].map((x, i) => (
        <group key={i} position={[x, 0.03, 0.26]} rotation={[0, i === 0 ? 0.25 : -0.25, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.11, 0.03, 0.06]} />
            {mat(i === 0 ? '#f4b3c2' : '#8fd0e0', 0.6)}
          </mesh>
          <mesh position={[0, 0.02, -0.02]}>
            <cylinderGeometry args={[0.022, 0.022, 0.014, 12]} />
            {mat('#3a3a40', 0.5)}
          </mesh>
          {[-0.03, 0.03].map((bx, j) => (
            <mesh key={j} position={[bx, 0.02, 0.02]}>
              <sphereGeometry args={[0.009, 8, 8]} />
              {mat('#f7f5ef', 0.5)}
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ---------------- 12. 开花花架 ----------------

export function FlowerStand3D({ col }: CozyPlusProps) {
  const wood = col ?? '#d9c7ae';
  const petals = useRef<(THREE.Mesh | null)[]>([]);
  const petalSeeds = useMemo(() => [0.05, 0.3, 0.5, 0.72, 0.9], []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    petals.current.forEach((p, i) => {
      if (!p) return;
      const s = petalSeeds[i];
      const life = (t * 0.32 + s) % 1;
      p.position.set(
        Math.sin(s * 33 + t * 0.6) * 0.16,
        1.06 - life * 1.0,
        Math.cos(s * 21 + t * 0.4) * 0.1,
      );
      p.rotation.set(t * 1.4 + s * 6, s * 9, t * 0.8);
      (p.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.9 * (1 - life));
    });
  });
  return (
    <group>
      {/* 三层架（两侧立柱 + 三块搁板） */}
      {[-0.3, 0.3].map((x, i) => (
        <mesh key={i} position={[x, 0.54, 0]} castShadow>
          <boxGeometry args={[0.045, 1.08, 0.3]} />
          {mat(wood, 0.75)}
        </mesh>
      ))}
      {[0.12, 0.55, 0.98].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.72, 0.035, 0.32]} />
          {mat(shade(wood, 0.94), 0.75)}
        </mesh>
      ))}
      {/* 每层花盆 + 花（粉/黄/紫） */}
      {([0, 1, 2] as const).map((tier) => {
        const y = [0.14, 0.57, 1.0][tier] + 0.02;
        const cols = ['#f2b3c2', '#f9e6a6', '#dcd2ec'];
        return (
          <group key={tier} position={[(tier - 1) * 0.16, y, 0]}>
            <mesh position={[0, 0.06, 0]} castShadow>
              <cylinderGeometry args={[0.085, 0.07, 0.12, 14]} />
              {mat('#e8b8a8', 0.85)}
            </mesh>
            {/* 花簇 */}
            {[[0, 0.17, 0], [-0.05, 0.13, 0.03], [0.05, 0.14, -0.03], [0.02, 0.2, 0.02]].map((p, j) => (
              <mesh key={j} position={[p[0], p[1], p[2]]} castShadow>
                <sphereGeometry args={[j === 0 ? 0.05 : 0.035, 10, 8]} />
                <meshStandardMaterial color={cols[tier]} roughness={0.7} />
              </mesh>
            ))}
            {/* 叶子 */}
            {[-0.07, 0.07].map((ex, j) => (
              <mesh key={j} position={[ex, 0.1, 0.02]} rotation={[0, 0, ex > 0 ? -0.7 : 0.7]}>
                <sphereGeometry args={[0.035, 8, 6]} />
                {mat('#8fbf9a', 0.9)}
              </mesh>
            ))}
          </group>
        );
      })}
      {/* 飘落花瓣（常时微落） */}
      {petalSeeds.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            petals.current[i] = el;
          }}
          position={[0, 0.8, 0]}
        >
          <planeGeometry args={[0.035, 0.025]} />
          <meshStandardMaterial color="#f6c1cd" roughness={0.6} transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 注册表（接线方按 kind 取用） ----------------

export const COZY_PLUS_PARTS: Record<string, (p: CozyPlusProps) => ReactElement> = {
  projector: Projector3D,
  screen: Screen3D,
  swingChair: SwingChair3D,
  shoeCabinet: ShoeCabinet3D,
  wallArt: WallArt3D,
  humidifier: Humidifier3D,
  wineCabinet: WineCabinet3D,
  chessTable: ChessTable3D,
  hotpotTable: HotpotTable3D,
  hammock: Hammock3D,
  gameConsole: GameConsole3D,
  flowerStand: FlowerStand3D,
};
