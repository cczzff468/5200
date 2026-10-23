'use client';

/**
 * 情侣小家 3D —— 小人（v6.2 立绘精灵版）
 *
 * - 用豆包 3D 风立绘（public/couple-home/char-*.png，已抠底）做始终朝向摄像机的
 *   billboard 纸片小人（相机可环绕，立绘永远正面示人）：
 *   me      = 女主：深棕长卷发 + 白背心 + 奶油开衫 + 喇叭牛仔裤 + 小白鞋；
 *   partner = 男主：蓬松黑发 + 黑皮夹克 + 黑T + 黑牛仔裤 + 小白鞋；
 *   style = 'real' 写实 3D 风 / 'cartoon' Q 版（同一对角色的两套画风，随全局小人画风切换）；
 * - 姿势适配（「我」专属）：坐姿类（sit/eat/piano/read/makeup）= 立绘下沉让髋部落到支撑面；
 *   躺床 = 立绘隐藏 + 头顶飘 Zzz；泡澡/淋浴 = 立绘隐藏 + 浮起泡泡团；
 *   做饭/喝东西/弹吉他/照镜子等站姿类保持站立微起伏；
 * - 走路上下颠 + 轻微左右摆，待机呼吸；拿饮料/咖啡后手边浮小杯子（咖啡冒热气）；
 * - 脚下软阴影贴片（姿势隐藏时同步缩小淡出）；访客仍用程序化 Char3D（头顶名牌）。
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { CharPose, CharRT, CharStyle } from '../types';

export interface CharSpriteProps {
  rt: CharRT;
  who: 'me' | 'partner';
  /** 隐藏（第一人称时隐藏「我」） */
  hide?: boolean;
  /** 画风：cartoon Q版立绘 / real 写实立绘 */
  style?: CharStyle;
  /** 姿势（「我」专属；partner 永远站立） */
  poseRef?: RefObject<{ pose: CharPose; y: number }>;
  /** 兼容 Char3D 签名（立绘不换色，忽略） */
  outfit?: number;
  /** 手持物（true = 手边浮小水杯；coffee = 咖啡款冒热气） */
  carryRef?: RefObject<{ cup: boolean; coffee?: boolean }>;
}

/** 立绘路径（me=女主 / partner=男主 × 两套画风） */
const CHAR_URL: Record<'me' | 'partner', Record<CharStyle, string>> = {
  me: { real: '/couple-home/char-me-real.png', cartoon: '/couple-home/char-me-cartoon.png' },
  partner: { real: '/couple-home/char-ta-real.png', cartoon: '/couple-home/char-ta-cartoon.png' },
};

/** 立绘世界高度（米，与原程序化小人身高一致）与髋部高度占比（坐姿对齐用） */
const CHAR_H: Record<CharStyle, number> = { real: 1.04, cartoon: 0.96 };
const HIP_FRAC: Record<CharStyle, number> = { real: 0.48, cartoon: 0.42 };

/** 坐姿类（立绘下沉）/ 隐藏类（躺床/泡澡/淋浴 → 立绘让位给特效） */
const SIT_LIKE = new Set<CharPose>(['sit', 'eat', 'piano', 'read', 'makeup']);
const HIDE_LIKE = new Set<CharPose>(['lie', 'bath', 'shower']);

/** 立绘纹理模块级缓存（画风来回切换不重复加载） */
const texCache = new Map<string, THREE.Texture>();

function useCharTex(url: string): THREE.Texture | null {
  // 渲染期直接读模块级缓存（同步拿到已加载纹理）；未命中时异步加载后 bump 触发重读
  const [, bump] = useState(0);
  const tex = texCache.get(url) ?? null;
  useEffect(() => {
    if (texCache.has(url)) return;
    let alive = true;
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      texCache.set(url, t);
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return tex;
}

/** Zzz 字贴图（躺床睡觉特效，白字 + 雾紫描边） */
function makeZzzTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d')!;
  ctx.font = '900 92px "PingFang SC", "Nunito", ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 16;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(179,168,204,0.95)';
  ctx.strokeText('Z', 64, 70);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Z', 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 热气/泡泡通用柔雾贴图（白雾团，中心实边缘散） */
function makePuffTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 96;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(48, 48, 4, 48, 48, 44);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 96, 96);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 脚下软阴影贴图（暖灰椭圆，中心深边缘散） */
function makeBlobTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
  g.addColorStop(0, 'rgba(58,44,40,0.6)');
  g.addColorStop(0.6, 'rgba(58,44,40,0.28)');
  g.addColorStop(1, 'rgba(58,44,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 泡泡团排布（泡澡/淋浴时顶替立绘） */
const FOAM_BITS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 0, 0.085],
  [0.1, 0.035, 0.03, 0.065],
  [-0.09, 0.02, -0.025, 0.07],
  [0.035, 0.065, -0.045, 0.055],
  [-0.05, -0.045, 0.05, 0.06],
  [0.115, -0.025, -0.04, 0.05],
];

export default function CharSprite({ rt, who, hide, style = 'cartoon', poseRef, carryRef }: CharSpriteProps) {
  const tex = useCharTex(CHAR_URL[who][style]);
  const holder = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const plane = useRef<THREE.Mesh>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const cup = useRef<THREE.Group>(null);
  const liquid = useRef<THREE.Mesh>(null);
  const straw = useRef<THREE.Mesh>(null);
  const steam = useRef<THREE.Sprite>(null);
  const zzz = useRef<THREE.Group>(null);
  const foam = useRef<THREE.Group>(null);
  /** 立绘底部高度偏移（坐姿下沉阻尼） */
  const yOff = useRef(0);

  const zzzTex = useMemo(() => makeZzzTexture(), []);
  const puffTex = useMemo(() => makePuffTexture(), []);
  const blobTex = useMemo(() => makeBlobTexture(), []);

  const aspect = useMemo(() => {
    const img = tex?.image as HTMLImageElement | undefined;
    return img && img.width > 0 ? img.width / img.height : 0.32;
  }, [tex]);
  const H = CHAR_H[style];
  const W = H * aspect;

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const h = holder.current;
    if (!h) return;
    const t = state.clock.elapsedTime;
    h.visible = !hide;
    h.position.set(rt.x, 0, rt.z);

    const pose: CharPose = who === 'me' ? (poseRef?.current?.pose ?? 'stand') : 'stand';
    const poseY = poseRef?.current?.y ?? 0;
    const carry = who === 'me' && carryRef?.current?.cup === true;
    const carryCoffee = carry && carryRef?.current?.coffee === true;

    // —— billboard：立绘组永远朝向摄像机 ——
    if (inner.current) inner.current.quaternion.copy(state.camera.quaternion);

    // —— 高度：坐姿类下沉到支撑面（髋对齐），站姿类贴地 ——
    if (!HIDE_LIKE.has(pose)) {
      const target = SIT_LIKE.has(pose) ? poseY - HIP_FRAC[style] * H : poseY;
      yOff.current = THREE.MathUtils.damp(yOff.current, target, 9, dt);
    }

    const gone = HIDE_LIKE.has(pose) || !tex;
    const walking = rt.moving && pose === 'stand';

    // —— 立绘本体：走路颠步/待机呼吸 + 轻微摇摆 ——
    if (plane.current) {
      plane.current.visible = !gone;
      const bob = walking ? Math.abs(Math.sin(t * 9.5)) * (style === 'cartoon' ? 0.034 : 0.024) : Math.sin(t * 2.2) * 0.006 + 0.004;
      plane.current.position.y = H / 2 + yOff.current + bob;
      plane.current.rotation.z = walking ? Math.sin(t * 9.5) * 0.045 : Math.sin(t * 1.6) * 0.012;
    }

    // —— 脚下软阴影：立绘隐藏时同步缩小淡出 ——
    if (shadow.current) {
      const s = THREE.MathUtils.damp(shadow.current.scale.x, gone ? 0.3 : 1, 8, dt);
      shadow.current.scale.setScalar(s);
      (shadow.current.material as THREE.MeshBasicMaterial).opacity = 0.3 * s;
      shadow.current.visible = s > 0.04;
    }

    // —— 手边小杯子（躺/泡澡/淋浴时收起） ——
    if (cup.current) {
      cup.current.visible = carry && !gone;
      cup.current.position.y = H * 0.52 + yOff.current + Math.sin(t * 2.2) * 0.008;
      if (liquid.current) {
        const m = liquid.current.material as THREE.MeshStandardMaterial;
        m.color.set(carryCoffee ? '#6b4a33' : '#f2a7b8');
      }
      if (straw.current) straw.current.visible = !carryCoffee;
      if (steam.current) {
        steam.current.visible = carryCoffee;
        if (carryCoffee) {
          const sm = steam.current.material as THREE.SpriteMaterial;
          const ph = (t * 0.55) % 1;
          steam.current.position.y = 0.09 + ph * 0.1;
          steam.current.scale.setScalar(0.05 + ph * 0.06);
          sm.opacity = Math.sin(ph * Math.PI) * 0.65;
        }
      }
    }

    // —— Zzz（躺床时从枕头上方飘起） ——
    if (zzz.current) {
      zzz.current.visible = pose === 'lie';
      if (pose === 'lie') {
        zzz.current.position.set(0.14, poseY + 0.58, -0.05);
        zzz.current.children.forEach((sp, i) => {
          const ph = (t * 0.42 + i * 0.34) % 1;
          sp.position.y = i * 0.13 + ph * 0.3;
          sp.scale.setScalar(0.1 + i * 0.02);
          (sp as THREE.Sprite).material.opacity = Math.sin(ph * Math.PI) * 0.9;
        });
      }
    }

    // —— 泡泡团（泡澡浮在浴缸水面 / 淋浴罩住身体） ——
    if (foam.current) {
      foam.current.visible = pose === 'bath' || pose === 'shower';
      if (pose === 'bath' || pose === 'shower') {
        foam.current.position.y = poseY + (pose === 'bath' ? 0.3 : 0.62);
        foam.current.children.forEach((f, i) => {
          f.position.y += Math.sin(t * 2.2 + i * 1.3) * 0.00035;
        });
      }
    }
  });

  return (
    <group ref={holder}>
      {/* 脚下软阴影（不随 billboard 旋转，平贴地面） */}
      <mesh ref={shadow} rotation-x={-Math.PI / 2} position-y={0.012}>
        <planeGeometry args={[W * 1.7, W * 1.7]} />
        <meshBasicMaterial map={blobTex} transparent opacity={0.3} depthWrite={false} />
      </mesh>

      {/* 立绘 billboard 组（含手边小杯） */}
      {tex && (
        <group ref={inner}>
          <mesh ref={plane}>
            <planeGeometry args={[W, H]} />
            <meshStandardMaterial map={tex} transparent alphaTest={0.15} depthWrite roughness={1} metalness={0} />
          </mesh>
          <group ref={cup} position={[W * 0.44, H * 0.52, 0.02]}>
            {/* 杯身 */}
            <mesh position-y={0.035}>
              <cylinderGeometry args={[0.03, 0.025, 0.07, 12]} />
              <meshStandardMaterial color="#f7f5f0" roughness={0.55} />
            </mesh>
            {/* 液体（咖啡棕 / 冰饮粉，随 carryRef 切换） */}
            <mesh ref={liquid} position-y={0.048}>
              <cylinderGeometry args={[0.023, 0.02, 0.042, 12]} />
              <meshStandardMaterial color="#f2a7b8" roughness={0.45} />
            </mesh>
            {/* 吸管（冰饮款） */}
            <mesh ref={straw} position={[0.014, 0.085, 0]} rotation-z={0.16}>
              <cylinderGeometry args={[0.004, 0.004, 0.075, 8]} />
              <meshStandardMaterial color="#e88aa0" roughness={0.5} />
            </mesh>
            {/* 咖啡热气 */}
            <sprite ref={steam} position={[0, 0.1, 0]} scale={0.05}>
              <spriteMaterial map={puffTex} transparent opacity={0} depthWrite={false} />
            </sprite>
          </group>
        </group>
      )}

      {/* Zzz（躺床） */}
      <group ref={zzz} visible={false}>
        {[0, 1, 2].map((i) => (
          <sprite key={i}>
            <spriteMaterial map={zzzTex} transparent depthWrite={false} />
          </sprite>
        ))}
      </group>

      {/* 泡泡团（泡澡/淋浴） */}
      <group ref={foam} visible={false}>
        {FOAM_BITS.map(([x, y, z, r], i) => (
          <mesh key={i} position={[x, y, z]}>
            <sphereGeometry args={[r, 12, 10]} />
            <meshStandardMaterial color="#ffffff" roughness={0.3} transparent opacity={0.92} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
