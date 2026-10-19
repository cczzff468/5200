'use client';

/**
 * 情侣小家 3D —— 「美颜电视」（程序化建模，不用 GLB）
 *
 * - 超窄柔黑边框 + 1.8m 大屏，简约大气；
 * - 上墙支架（默认布局挂在电视柜上方墙面）；
 * - 开机：动态彩屏（Canvas 渐变流动画面）+ 前场柔光 + 电视背后氛围背光
 *   （bias lighting，夜里在墙上映出柔光晕，非常出片）；
 * - 关机：深邃镜面黑屏；
 * - 开关带淡入淡出（damp 过渡），支架颜色跟随用户调色。
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

export interface TV3DProps {
  /** 开机 */
  on: boolean;
  /** 夜晚（夜里背光更浓） */
  night: boolean;
  /** 用户自选颜色（作用于支架与边框背面） */
  col?: string;
  /** 频道（1=流光云朵 / 2=啵啵新闻 / 3=音乐台；undefined = 流光） */
  channel?: number;
}

/** 屏幕动态画面：频道制（1 流光云朵 / 2 啵啵新闻 / 3 音乐台），换台即重建纹理 */
function makeScreenTexture(channel: number): { tex: THREE.CanvasTexture; draw: (t: number) => void } {
  const W = 256;
  const H = 152;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;

  const blobs = [
    { c: '244,182,198', r: 0.55, sx: 0.9, sy: 0.62, px: 0.0, py: 0.55 }, // 樱粉
    { c: '168,203,219', r: 0.62, sx: 0.55, sy: 0.9, px: 0.33, py: 0.25 }, // 天青
    { c: '243,214,150', r: 0.42, sx: 0.75, sy: 0.75, px: 0.75, py: 0.8 }, // 杏黄
  ];

  const draw = (t: number) => {
    // 深底
    ctx.fillStyle = '#101318';
    ctx.fillRect(0, 0, W, H);
    if (channel === 2) {
      // —— 频道 2「啵啵新闻」：深蓝演播室 + 旋转地球 + 底部滚动条 ——
      const g2 = ctx.createLinearGradient(0, 0, 0, H);
      g2.addColorStop(0, '#1b2c4a');
      g2.addColorStop(1, '#101a30');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, W, H);
      // 旋转地球（橙黄经纬线）
      const ex = W * 0.78;
      const ey = H * 0.4;
      const er = W * 0.13;
      ctx.strokeStyle = 'rgba(243,214,150,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.5 + i / 3) % 1;
        const rx = er * Math.abs(Math.cos(ph * Math.PI));
        ctx.beginPath();
        ctx.ellipse(ex, ey, Math.max(1.5, rx), er, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const lat = ey + (i - 1.5) * er * 0.45;
        ctx.beginPath();
        ctx.ellipse(ex, lat, er * Math.sqrt(Math.max(0.05, 1 - ((lat - ey) / er) ** 2)), er * 0.14, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(243,214,150,0.22)';
      ctx.beginPath();
      ctx.arc(ex, ey, er + 6, 0, Math.PI * 2);
      ctx.fill();
      // 标题条 + 滚动字幕
      ctx.fillStyle = '#f2a9bc';
      ctx.fillRect(0, H * 0.72, W, H * 0.14);
      ctx.fillStyle = '#fff7f9';
      ctx.font = '900 20px system-ui, sans-serif';
      ctx.fillText('LIVE', W * 0.05, H * 0.815);
      const scroll = ((t * 46) % (W + 190)) - 150;
      ctx.fillText('小家新闻：今天也是甜甜的一天', scroll, H * 0.815);
      // 台标
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '900 17px system-ui, sans-serif';
      ctx.fillText('啵啵台', W * 0.06, H * 0.2);
    } else if (channel === 3) {
      // —— 频道 3「音乐台」：暗紫底 + 跳动均衡器 ——
      const g3 = ctx.createLinearGradient(0, 0, 0, H);
      g3.addColorStop(0, '#241a38');
      g3.addColorStop(1, '#151024');
      ctx.fillStyle = g3;
      ctx.fillRect(0, 0, W, H);
      const bars = 14;
      const bw = W / (bars * 1.6);
      for (let i = 0; i < bars; i++) {
        const v = 0.22 + Math.abs(Math.sin(t * 2.6 + i * 0.9) * Math.cos(t * 1.3 + i * 0.4)) * 0.62;
        const bh = v * H * 0.62;
        const hue = 330 + Math.sin(i * 0.6 + t * 0.5) * 30;
        ctx.fillStyle = `hsl(${hue}, 62%, 68%)`;
        const x = (i + 0.3) * (W / bars) + bw * 0.2;
        ctx.fillRect(x, H * 0.82 - bh, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(x, H * 0.82 - bh - 5, bw, 3);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '900 17px system-ui, sans-serif';
      ctx.fillText('♪ 拾光电台', W * 0.06, H * 0.16);
    } else {
      // —— 频道 1「流光云朵」（默认）：三色流动光斑 + 弹跳小球 ——
      for (const b of blobs) {
        const x = (b.px + Math.sin(t * b.sx) * 0.18 + 1) * 0.5 * W;
        const y = (b.py + Math.cos(t * b.sy) * 0.16 + 1) * 0.5 * H;
        const r = b.r * W * 0.6;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${b.c},0.85)`);
        g.addColorStop(1, `rgba(${b.c},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      // 弹跳小球（影子 + 反弹）
      const bx = (0.5 + Math.sin(t * 0.7) * 0.32) * W;
      const bp = (t * 0.9) % 1;
      const by = H * 0.72 - Math.abs(Math.sin(bp * Math.PI)) * H * 0.34;
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(bx, H * 0.76, 14 - by / H * 4, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f7c66b';
      ctx.beginPath();
      ctx.arc(bx, by, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath();
      ctx.arc(bx - 3, by - 3, 4, 0, Math.PI * 2);
      ctx.fill();
      // 底部淡淡反光带（像画面里的地平线）
      const lg = ctx.createLinearGradient(0, H * 0.7, 0, H);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(1, 'rgba(255,255,255,0.10)');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, W, H);
    }
    tex.needsUpdate = true;
  };
  draw(0);
  return { tex, draw };
}

/** 电视几何（原点 = 屏幕中心） */
const PANEL_W = 1.8;
const PANEL_H = 1.05;
const PANEL_T = 0.05;

export default function TV3D({ on, night, col, channel = 1 }: TV3DProps) {
  const screen = useMemo(() => makeScreenTexture(channel), [channel]);
  const screenMat = useRef<THREE.MeshStandardMaterial>(null);
  const frontGlow = useRef<THREE.PointLight>(null);
  const backGlow = useRef<THREE.PointLight>(null);
  const lastDraw = useRef(0);

  useFrame((state, dt) => {
    // 开关淡入淡出
    if (screenMat.current) {
      const target = on ? (night ? 1.45 : 1.0) : 0;
      screenMat.current.emissiveIntensity = THREE.MathUtils.damp(
        screenMat.current.emissiveIntensity,
        target,
        5,
        dt,
      );
    }
    // 画面流动（开机时 ~12fps 重绘即可）
    if (on && screenMat.current && screenMat.current.emissiveIntensity > 0.05) {
      const now = state.clock.elapsedTime;
      if (now - lastDraw.current > 0.08) {
        lastDraw.current = now;
        screen.draw(now);
      }
    }
    if (frontGlow.current) {
      frontGlow.current.intensity = THREE.MathUtils.damp(
        frontGlow.current.intensity,
        on ? (night ? 1.5 : 0.8) : 0,
        5,
        dt,
      );
    }
    if (backGlow.current) {
      backGlow.current.intensity = THREE.MathUtils.damp(
        backGlow.current.intensity,
        on ? (night ? 2.0 : 0.55) : 0,
        5,
        dt,
      );
    }
  });

  const frameColor = col ?? '#eceae4'; // 支架 / 背板颜色（可调色）

  return (
    <group>
      {/* —— 上墙支架（贴墙暗藏） —— */}
      <mesh position={[0, -0.1, -0.055]} castShadow>
        <boxGeometry args={[0.52, 0.34, 0.05]} />
        <meshStandardMaterial color={frameColor} roughness={0.7} />
      </mesh>

      {/* —— 屏幕（柔黑超窄边框） —— */}
      <mesh castShadow>
        <boxGeometry args={[PANEL_W, PANEL_H, PANEL_T]} />
        <meshStandardMaterial color="#24262b" roughness={0.45} metalness={0.15} />
      </mesh>

      {/* —— 画面（镜面黑 → 开机流光） —— */}
      <mesh position={[0, 0.012, PANEL_T / 2 + 0.004]}>
        <planeGeometry args={[PANEL_W - 0.1, PANEL_H - 0.09]} />
        <meshStandardMaterial
          ref={screenMat}
          color="#0b0d11"
          emissive="#ffffff"
          emissiveMap={screen.tex}
          emissiveIntensity={0}
          roughness={0.08}
          metalness={0.2}
        />
      </mesh>

      {/* —— 底边品牌小灯点 —— */}
      <mesh position={[0, -PANEL_H / 2 + 0.028, PANEL_T / 2 + 0.004]}>
        <circleGeometry args={[0.016, 12]} />
        <meshStandardMaterial color="#d8d8dc" emissive="#cfd4e0" emissiveIntensity={on ? 1.2 : 0} />
      </mesh>

      {/* —— 前场柔光（照亮客厅 / 沙发方向） —— */}
      <pointLight
        ref={frontGlow}
        position={[0, 0, 0.9]}
        color="#cfe0ff"
        intensity={0}
        distance={4.6}
        decay={2}
      />
      {/* —— 氛围背光（电视与墙之间的光晕，夜里最美） —— */}
      <pointLight
        ref={backGlow}
        position={[0, 0, -0.22]}
        color="#b9c4e8"
        intensity={0}
        distance={2.6}
        decay={2}
      />
    </group>
  );
}
