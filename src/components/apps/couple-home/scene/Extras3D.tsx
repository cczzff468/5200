'use client';

/**
 * 情侣小家 3D —— 程序化新家具（v5）
 *
 * - Aircon3D：立体壁挂空调（圆角机身 + 导风板摆动 + 运行冷风丝 + 指示灯 + 夜间冷光）；
 * - PhotoFrame3D：立式相框（木框 + 斜撑脚架），相片来自手机上传（st.photo dataURL），
 *   没有照片时显示「点我传合照」粉系占位画；照片永久保存在小家档案里。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

// ---------------- 立体壁挂空调 ----------------

export function Aircon3D({ on, night, col }: { on: boolean; night: boolean; col?: string }) {
  const flap = useRef<THREE.Group>(null);

  useFrame((state, dt) => {
    if (!flap.current) return;
    // 关 = 贴合机身；开 = 导风板张开并缓缓上下摆动送风
    const target = on ? 0.78 + Math.sin(state.clock.elapsedTime * 2.2) * 0.2 : 0.04;
    flap.current.rotation.x = THREE.MathUtils.damp(flap.current.rotation.x, target, 6, dt);
  });

  const body = col ?? '#fbfaf7';

  return (
    <group>
      {/* 主机身 */}
      <mesh position={[0, 0.16, 0]} castShadow>
        <boxGeometry args={[0.88, 0.32, 0.22]} />
        <meshStandardMaterial color={body} roughness={0.5} metalness={0.05} />
      </mesh>
      {/* 顶盖细腻亮条 */}
      <mesh position={[0, 0.325, 0]}>
        <boxGeometry args={[0.9, 0.018, 0.24]} />
        <meshStandardMaterial color="#ffffff" roughness={0.35} />
      </mesh>
      {/* 机身侧面装饰线 */}
      <mesh position={[0, 0.16, -0.108]}>
        <boxGeometry args={[0.82, 0.24, 0.008]} />
        <meshStandardMaterial color="#ecebe6" roughness={0.7} />
      </mesh>
      {/* 顶部进风格栅 */}
      <mesh position={[0, 0.318, -0.05]}>
        <boxGeometry args={[0.78, 0.006, 0.12]} />
        <meshStandardMaterial color="#dcdbd5" roughness={0.85} />
      </mesh>
      {/* 显示窗（开 = 柔绿呼吸灯感） */}
      <mesh position={[0.27, 0.14, 0.112]}>
        <boxGeometry args={[0.15, 0.05, 0.006]} />
        <meshStandardMaterial
          color={on ? '#b9ecd0' : '#e3e2dd'}
          emissive={on ? '#57d98a' : '#000000'}
          emissiveIntensity={on ? 0.85 : 0}
        />
      </mesh>
      {/* 品牌小圆点 */}
      <mesh position={[-0.3, 0.14, 0.112]}>
        <sphereGeometry args={[0.014, 8, 8]} />
        <meshStandardMaterial color="#cfcecb" metalness={0.4} roughness={0.4} />
      </mesh>

      {/* 导风板（铰链在机身下缘，绕 x 摆动） */}
      <group ref={flap} position={[0, 0.05, 0.1]}>
        <mesh position={[0, -0.05, 0.024]} castShadow>
          <boxGeometry args={[0.8, 0.016, 0.095]} />
          <meshStandardMaterial color="#f3f1eb" roughness={0.6} />
        </mesh>
      </group>

      {/* 冷风丝（开着才飘） */}
      {on && <Breeze />}

      {/* 夜晚送来一点冷色光 */}
      {on && (
        <pointLight
          position={[0, -0.35, 0.55]}
          color="#cfe8ff"
          intensity={night ? 0.5 : 0.2}
          distance={2.8}
          decay={2}
        />
      )}
    </group>
  );
}

/** 空调冷风丝：三缕淡蓝薄纱向左下飘，循环 */
function Breeze() {
  const g = useRef<THREE.Group>(null);
  useFrame((state) => {
    const grp = g.current;
    if (!grp) return;
    const t = state.clock.elapsedTime;
    grp.children.forEach((c, i) => {
      const m = c as THREE.Mesh;
      m.position.y = -0.16 - ((t * 0.55 + i * 0.37) % 0.62) * 0.75;
      m.position.x = (i - 1) * 0.24 + Math.sin(t * 2.4 + i * 1.7) * 0.05;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.2 + Math.sin(t * 5 + i * 1.3) * 0.09;
    });
  });
  return (
    <group ref={g}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, -0.3, 0.3]} rotation={[0.5, 0, 0]}>
          <planeGeometry args={[0.07, 0.4]} />
          <meshBasicMaterial color="#e3f2ff" transparent opacity={0.16} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 立式相框 ----------------

/** 无照片时的占位画（粉系渐变 + 爱心 + 提示字） */
function makePlaceholderTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 344;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#fdf4f5');
  g.addColorStop(1, '#f4dbe2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 爱心
  ctx.fillStyle = '#f2a9bc';
  const cx = W / 2;
  const cy = H * 0.4;
  const s = 34;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.9);
  ctx.bezierCurveTo(cx - s * 1.4, cy - s * 0.2, cx - s * 0.6, cy - s * 1.2, cx, cy - s * 0.4);
  ctx.bezierCurveTo(cx + s * 0.6, cy - s * 1.2, cx + s * 1.4, cy - s * 0.2, cx, cy + s * 0.9);
  ctx.fill();
  // 小爱心点缀
  ctx.fillStyle = 'rgba(242,169,188,0.45)';
  for (const [dx, dy, r] of [[-62, -70, 10], [58, -52, 8], [48, 66, 9], [-50, 78, 7]] as const) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 提示文字
  ctx.fillStyle = '#b07193';
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('点我传', cx, H * 0.68);
  ctx.fillText('合照哦', cx, H * 0.68 + 40);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function PhotoFrame3D({ col, photo }: { col?: string; photo?: string }) {
  const [texState, setTexState] = useState<{ photo: string; tex: THREE.Texture } | null>(null);

  // 照片 dataURL → texture（照片变化时重建；setState 只发生在异步回调里）
  useEffect(() => {
    if (!photo) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      t.needsUpdate = true;
      setTexState({ photo, tex: t });
    };
    img.src = photo;
    return () => {
      alive = false;
    };
  }, [photo]);

  const placeholder = useMemo(() => makePlaceholderTexture(), []);
  // 当前 photo 对不上已加载的纹理（无照片/刚换图）→ 回落占位画
  const photoTex = texState && texState.photo === photo ? texState.tex : null;
  const frameCol = col ?? '#f5f1e8';
  const frameDark = useMemo(() => new THREE.Color(frameCol).multiplyScalar(0.88), [frameCol]);

  return (
    <group>
      {/* 主背板（相片基底） */}
      <mesh position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[0.5, 0.72, 0.034]} />
        <meshStandardMaterial color={frameCol} roughness={0.8} />
      </mesh>

      {/* 相片窗（3:4 竖幅） */}
      <mesh position={[0, 0.44, 0.019]}>
        <planeGeometry args={[0.4, 0.56]} />
        <meshStandardMaterial map={photoTex ?? placeholder} roughness={0.55} />
      </mesh>

      {/* 内衬细边（略凸出，相片压边感） */}
      <mesh position={[0, 0.44 + 0.295, 0.016]}>
        <boxGeometry args={[0.43, 0.028, 0.04]} />
        <meshStandardMaterial color={frameDark} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.44 - 0.295, 0.016]}>
        <boxGeometry args={[0.43, 0.028, 0.04]} />
        <meshStandardMaterial color={frameDark} roughness={0.75} />
      </mesh>
      <mesh position={[-0.209, 0.44, 0.016]}>
        <boxGeometry args={[0.028, 0.62, 0.04]} />
        <meshStandardMaterial color={frameDark} roughness={0.75} />
      </mesh>
      <mesh position={[0.209, 0.44, 0.016]}>
        <boxGeometry args={[0.028, 0.62, 0.04]} />
        <meshStandardMaterial color={frameDark} roughness={0.75} />
      </mesh>

      {/* 顶部小蝴蝶结装饰 */}
      <mesh position={[0, 0.8, 0.02]}>
        <sphereGeometry args={[0.032, 10, 8]} />
        <meshStandardMaterial color="#f2b3c2" roughness={0.6} />
      </mesh>

      {/* 斜撑脚架（背后） */}
      <mesh position={[0, 0.34, -0.12]} rotation={[-0.42, 0, 0]} castShadow>
        <boxGeometry args={[0.4, 0.56, 0.02]} />
        <meshStandardMaterial color={frameDark} roughness={0.85} />
      </mesh>
    </group>
  );
}
