'use client';

/* eslint-disable react-hooks/immutability -- R3F/宠物 AI 需要每帧原地修改对象与运行时状态 */

/**
 * 情侣小家 3D —— 宠物系统（v5.7 领养 → v5.9 品种 → v6.1 真实立绘精灵）
 *
 * - 11 个真实品种（../pet-breeds PET_BREEDS 驱动）：狗 柴犬/博美/金毛/哈士奇/柯基，
 *   猫 橘猫/布偶/三花/狸花/金渐层/奶牛猫；
 * - v6.1 渲染重构：程序化卡通建模 → AI 一比一立绘精灵（public/pets/sprite-<id>.png，
 *   按用户参考图软萌蓬松插画风格生成、真实品种毛色花纹），单面片 + Y 轴 billboard 朝向相机
 *   + 屏幕空间移动方向左右翻转 + 接地软阴影；
 * - AI 零改动：随机目标溜达（撞家具绕开）+ 时不时打盹（头顶冒 💤）；
 * - 点击撸宠：爱心气泡上浮 + 开心原地蹦跳（冷却 2.5s 防连点）；
 * - 喂食：碗出现在宠物面前 → 跑过去低头吃（🍚 气泡），吃完碗消失（上层负责发碗/收碗）；
 * - 位置持久化由上层负责（petRT 随存档快照写入 HomeState.pet）；
 * - 性别：girl 头顶粉蝴蝶结（每品种头部锚点表）；boy 无配饰（性别在领养/档案卡展示）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { CharRT, FurnitureItem } from '../types';
import { CATALOG, ROOM_X, ROOM_Z, BED_Z0, footprintOf } from '../catalog';
import { breedOf, type PetGender } from '../pet-breeds';

export interface PetData {
  sp: 'cat' | 'dog';
  name: string;
  /** 品种 id（PET_BREEDS；缺省/未知时按 species 兜底：cat→橘猫 dog→柴犬） */
  breed?: string;
  /** 性别：boy / girl（girl 头顶蝴蝶结）；缺省按 boy */
  gender?: PetGender;
}

export interface Pet3DProps {
  pet: PetData;
  /** 宠物运行时（上层持久化用） */
  rt: React.RefObject<CharRT>;
  /** 家具列表（避障） */
  itemsRef: React.RefObject<FurnitureItem[]>;
  /** 喂食目标（null = 没有碗；at 为投放时间戳） */
  feedRef: React.RefObject<{ x: number; z: number; at: number } | null>;
  /** 点击撸宠回调（上层弹 toast） */
  onTap?: () => void;
}

/** 爱心/饭粒/瞌睡气泡贴图（canvas 手绘） */
function makeBubbleTexture(kind: 'heart' | 'rice' | 'zzz'): THREE.CanvasTexture {
  const S = 96;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  if (kind === 'heart') {
    ctx.fillStyle = '#f26d8d';
    ctx.beginPath();
    ctx.moveTo(48, 78);
    ctx.bezierCurveTo(10, 50, 18, 16, 48, 34);
    ctx.bezierCurveTo(78, 16, 86, 50, 48, 78);
    ctx.fill();
  } else if (kind === 'rice') {
    // 小饭碗
    ctx.fillStyle = '#f7f5ef';
    ctx.beginPath();
    ctx.arc(48, 52, 26, 0, Math.PI);
    ctx.fill();
    ctx.fillRect(22, 52, 52, 8);
    ctx.fillStyle = '#f7f5ef';
    ctx.beginPath();
    ctx.ellipse(48, 34, 22, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8fbf9a';
    for (const [x, y] of [[38, 30], [50, 28], [58, 32]]) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = '#8a9ab8';
    ctx.font = 'bold 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Z', 34, 40);
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText('Z', 62, 56);
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('Z', 80, 68);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 粉色蝴蝶结贴图（girl 头顶配饰，两个圆角翼 + 中心结） */
function makeBowTexture(): THREE.CanvasTexture {
  const S = 96;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  const wing = (dir: number) => {
    ctx.fillStyle = '#f7a8c4';
    ctx.beginPath();
    ctx.moveTo(48, 48);
    ctx.quadraticCurveTo(48 + dir * 20, 26, 48 + dir * 36, 34);
    ctx.quadraticCurveTo(48 + dir * 42, 48, 48 + dir * 36, 62);
    ctx.quadraticCurveTo(48 + dir * 20, 70, 48, 48);
    ctx.fill();
  };
  wing(-1);
  wing(1);
  ctx.fillStyle = '#ef8fb2';
  ctx.beginPath();
  ctx.arc(48, 48, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(45, 45, 3.2, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 接地软阴影贴图（径向渐变圆） */
function makeShadowTexture(): THREE.CanvasTexture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(60,50,44,0.5)');
  g.addColorStop(0.6, 'rgba(60,50,44,0.22)');
  g.addColorStop(1, 'rgba(60,50,44,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}

/**
 * girl 蝴蝶结锚点（scripts/bow-anchors.ts 按各品种立绘头部位置自动测得；+0.05 顶在头顶。
 * x 右正 / y 上正，单位 = 精灵世界高度 h）
 */
const BOW_ANCHOR: Record<string, [number, number]> = {
  shiba: [-0.1, 0.41],
  pomeranian: [0.03, 0.4],
  golden: [-0.13, 0.41],
  husky: [-0.07, 0.41],
  corgi: [-0.09, 0.41],
  orange: [-0.13, 0.41],
  ragdoll: [-0.07, 0.38],
  calico: [-0.16, 0.41],
  lihua: [-0.12, 0.42],
  goldenShaded: [-0.19, 0.41],
  tuxedo: [-0.13, 0.42],
};

/** 宠物 Living-room 边界 + 家具避障（简化版碰撞）；margin 随体型 scale 微调 */
function clampPet(c: CharRT, items: FurnitureItem[], scale = 1) {
  const m = 0.14 * scale;
  for (const it of items) {
    const e = CATALOG[it.kind];
    if (!e || e.flat || (it.y ?? 0) > 0.45) continue;
    const [w, d] = footprintOf(e, it.ry ?? 0);
    const hw = w / 2 + m;
    const hd = d / 2 + m;
    const dx = c.x - it.x;
    const dz = c.z - it.z;
    if (Math.abs(dx) > hw || Math.abs(dz) > hd) continue;
    const penX = hw - Math.abs(dx);
    const penZ = hd - Math.abs(dz);
    if (penX < penZ) c.x = it.x + (dx >= 0 ? hw : -hw);
    else c.z = it.z + (dz >= 0 ? hd : -hd);
  }
  c.x = THREE.MathUtils.clamp(c.x, -ROOM_X + 0.32, ROOM_X - 0.32);
  c.z = THREE.MathUtils.clamp(c.z, -ROOM_Z + 0.32, BED_Z0 - 0.32);
}

export default function Pet3D({ pet, rt, itemsRef, feedRef, onTap }: Pet3DProps) {
  const holder = useRef<THREE.Group>(null);
  const bill = useRef<THREE.Group>(null);
  const petPlane = useRef<THREE.Mesh>(null);
  const bowMesh = useRef<THREE.Mesh>(null);
  const hearts = useRef<(THREE.Sprite | null)[]>([]);
  const moodSprite = useRef<THREE.Sprite>(null);
  const bowl = useRef<THREE.Group>(null);

  // —— 品种与性别 ——
  const breed = breedOf(pet.sp, pet.breed);
  const gender: PetGender = pet.gender ?? 'boy';
  /** 精灵世界高度（狗 0.46–0.57 / 猫 0.38–0.43，随品种体型缩放） */
  const h = 0.44 * breed.look.scale;

  const tex = useMemo(
    () => ({
      heart: makeBubbleTexture('heart'),
      rice: makeBubbleTexture('rice'),
      zzz: makeBubbleTexture('zzz'),
      bow: makeBowTexture(),
      shadow: makeShadowTexture(),
    }),
    [],
  );
  useEffect(() => () => Object.values(tex).forEach((t) => t.dispose()), [tex]);

  // 品种立绘异步加载
  const [sprite, setSprite] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let dead = false;
    let loaded: THREE.Texture | null = null;
    new THREE.TextureLoader().load(`/pets/sprite-${breed.id}.png`, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      if (dead) {
        t.dispose();
        return;
      }
      loaded = t;
      setSprite(t);
    });
    return () => {
      dead = true;
      loaded?.dispose();
    };
  }, [breed.id]);

  /** 撸宠爱心粒子（点击时触发，本地计时） */
  const petAt = useRef(0);
  const eatAt = useRef(0);
  const dozedOff = useRef(0);
  /** 屏幕空间朝向：1 = 立绘原方向（朝左），-1 = 翻转（朝右） */
  const faceDir = useRef(1);

  const heartMats = useMemo(
    () =>
      Array.from({ length: 5 }, () => {
        const m = new THREE.SpriteMaterial({ map: tex.heart, transparent: true, opacity: 0, depthWrite: false });
        return m;
      }),
    [tex],
  );
  useEffect(() => () => heartMats.forEach((m) => m.dispose()), [heartMats]);

  const handleTap = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 8) return;
    const now = performance.now();
    if (now - petAt.current < 2500) return;
    petAt.current = now;
    onTap?.();
  };

  /** 投喂是否已吃完（开吃满 2.6 秒即吃完） */
  const eatingDone = (now: number) =>
    !feedRef.current || (eatAt.current > 0 && now - eatAt.current > 2600);

  // 屏幕空间投影用的临时向量
  const v0 = useMemo(() => new THREE.Vector3(), []);
  const v1 = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, rawDt) => {
    void rawDt;
    const hz = holder.current;
    if (!hz) return;
    const t = state.clock.elapsedTime;
    const c = rt.current;
    if (!c) return;

    // —— AI：喂食优先 → 溜达 → 打盹（v5.7 原逻辑，零改动） ——
    const feed = feedRef.current;
    const now = performance.now();
    const eating = feed && now - feed.at < 9000 && Math.hypot(c.x - feed.x, c.z - feed.z) < 0.22;
    if (eating && eatAt.current === 0) eatAt.current = now;

    if (c.target) {
      const dx = c.target.x - c.x;
      const dz = c.target.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.1) {
        if (feed && Math.hypot(c.x - feed.x, c.z - feed.z) < 0.35) {
          c.target = null;
          c.moving = false;
          eatAt.current = now;
        } else {
          c.target = null;
          c.moving = false;
          c.nextWander = now / 1000 + 2 + Math.random() * 4.5;
          // 偶尔打盹
          if (Math.random() < 0.3) dozedOff.current = now;
        }
      } else {
        const sp = (eating ? 2.1 : 0.85) * Math.min(rawDt, 0.05);
        c.x += (dx / d) * sp;
        c.z += (dz / d) * sp;
        c.moving = true;
        let td = Math.atan2(dx, dz) - c.heading;
        while (td > Math.PI) td -= Math.PI * 2;
        while (td < -Math.PI) td += Math.PI * 2;
        c.heading += td * Math.min(1, Math.min(rawDt, 0.05) * 9);
      }
    } else {
      c.moving = false;
      if (feed && now - feed.at < 9000 && eatAt.current === 0) {
        c.target = { x: feed.x, z: feed.z };
      } else if (now / 1000 > c.nextWander) {
        if (dozedOff.current && now - dozedOff.current < 3500) {
          // 打盹中：不动
        } else {
          dozedOff.current = 0;
          c.target = {
            x: -ROOM_X + 0.6 + Math.random() * (ROOM_X * 2 - 1.2),
            z: -ROOM_Z + 0.6 + Math.random() * (BED_Z0 - ROOM_Z - 1.2),
          };
        }
      }
    }
    clampPet(c, itemsRef.current ?? [], breed.look.scale);
    hz.position.set(c.x, 0, c.z);

    // —— 精灵渲染：billboard + 翻转 + 动画 ——
    const bb = bill.current;
    if (!bb) return;
    const cam = state.camera;
    // Y 轴 billboard：面片 +z 转向相机
    bb.rotation.y = Math.atan2(cam.position.x - c.x, cam.position.z - c.z);

    const eatingNow = !!eating || (eatAt.current > 0 && now - eatAt.current < 2600);
    if (eatingDone(now)) eatAt.current = 0;
    const walking = c.moving && !eatingNow;
    const happyNow = !!petAt.current && now - petAt.current < 1200;

    // 翻转：把移动方向投影到屏幕 x（立绘默认朝左）；加死区防抖
    if (walking) {
      v0.set(c.x, 0, c.z).project(cam);
      v1.set(c.x + Math.sin(c.heading) * 0.25, 0, c.z + Math.cos(c.heading) * 0.25).project(cam);
      const sdx = v1.x - v0.x;
      if (Math.abs(sdx) > 0.004) faceDir.current = sdx < 0 ? 1 : -1;
    }

    // 走路小颠簸 + 左右轻摆；撸宠后开心原地蹦跳；吃饭低头凑碗
    const bob = walking ? Math.abs(Math.sin(t * 11)) * 0.02 : 0;
    let hop = 0;
    if (happyNow) {
      const ph = ((now - petAt.current) % 300) / 300;
      hop = Math.abs(Math.sin(ph * Math.PI)) * 0.055;
    }
    bb.position.y = h / 2 + bob + hop - (eatingNow ? 0.035 : 0);
    bb.rotation.z = walking ? Math.sin(t * 11) * 0.05 : happyNow ? Math.sin(t * 20) * 0.09 : 0;
    if (petPlane.current) {
      petPlane.current.rotation.x = eatingNow ? 0.16 : 0;
      // 待机呼吸：高度 ±1.2%
      const br = !walking && !eatingNow ? Math.sin((t * Math.PI * 2) / 1.6) * 0.012 : 0;
      petPlane.current.scale.set(h, h * (1 + br), 1);
    }
    // 蝴蝶结随朝向镜像（立绘默认朝左，向右移动翻转后头顶也换边）
    if (bowMesh.current) bowMesh.current.position.x = bowA[0] * h * faceDir.current;

    // —— 心情气泡（🍚 吃饭 / 💤 打盹；撸宠爱心由粒子表达） ——
    if (moodSprite.current) {
      const showRice = eatingNow;
      const showZzz = !showRice && !!dozedOff.current && now - dozedOff.current < 3500 && !c.moving;
      moodSprite.current.visible = showRice || showZzz;
      moodSprite.current.material.map = showRice ? tex.rice : tex.zzz;
      moodSprite.current.material.needsUpdate = true;
      moodSprite.current.position.set(0.03, h + 0.14 + Math.sin(t * 2) * 0.02, 0);
    }
    // —— 爱心粒子（撸宠后 1.6 秒） ——
    const heartAge = petAt.current ? (now - petAt.current) / 1000 : -1;
    hearts.current.forEach((sp, i) => {
      if (!sp) return;
      const m = sp.material as THREE.SpriteMaterial;
      if (heartAge < 0 || heartAge > 1.6) {
        m.opacity = 0;
        return;
      }
      const ph = (heartAge * 1.4 + i * 0.18) % 1;
      sp.position.set(
        Math.sin(i * 2.2 + petAt.current * 0.01) * 0.17,
        h * 0.55 + ph * 0.42,
        Math.cos(i * 1.7) * 0.14,
      );
      m.opacity = Math.max(0, 0.95 * (1 - ph));
      sp.scale.setScalar(0.13 + ph * 0.06);
    });

    // —— 饭碗（有未吃完的投喂才显示） ——
    if (bowl.current) {
      const show = !!feed && now - feed.at < 9000 && !eatingDone(now);
      bowl.current.visible = show;
      if (feed && show) bowl.current.position.set(feed.x, 0.045, feed.z);
    }
  });

  const bowA = BOW_ANCHOR[breed.id] ?? [-0.1, 0.41];

  return (
    <group>
      {/* 宠物本体（holder = AI 坐标系；bill = billboard + 翻转） */}
      <group
        ref={holder}
        onClick={handleTap}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 接地软阴影 */}
        <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[h * 1.15, h * 0.92]} />
          <meshBasicMaterial map={tex.shadow} transparent depthWrite={false} />
        </mesh>

        <group ref={bill} position={[0, h / 2, 0]}>
          {sprite && (
            <>
              {/* 品种立绘面片（DoubleSide 承受 scale.x=-1 翻转） */}
              <mesh ref={petPlane}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial
                  map={sprite}
                  transparent
                  alphaTest={0.02}
                  depthWrite={false}
                  side={THREE.DoubleSide}
                  toneMapped={false}
                />
              </mesh>
              {/* girl 头顶粉蝴蝶结（随面片翻转镜像，蝴蝶结对称无碍） */}
              {gender === 'girl' && (
                <mesh
                  ref={bowMesh}
                  position={[bowA[0] * h, bowA[1] * h, 0.014]}
                  scale={[0.2 * h, 0.2 * h, 1]}
                >
                  <planeGeometry args={[1, 1]} />
                  <meshBasicMaterial map={tex.bow} transparent depthWrite={false} toneMapped={false} />
                </mesh>
              )}
            </>
          )}
        </group>

        {/* 心情气泡（🍚 吃饭 / 💤 打盹） */}
        <sprite ref={moodSprite} position={[0, h + 0.14, 0]} scale={[0.2, 0.2, 1]} visible={false}>
          <spriteMaterial map={tex.rice} transparent depthWrite={false} />
        </sprite>

        {/* 撸宠爱心 ×5 */}
        {heartMats.map((m, i) => (
          <sprite
            key={i}
            ref={(el) => {
              hearts.current[i] = el;
            }}
            position={[0, 0.4, 0]}
            scale={[0.13, 0.13, 1]}
            visible
          >
            <primitive object={m} attach="material" />
          </sprite>
        ))}
      </group>

      {/* 饭碗（世界坐标，跟喂食点走） */}
      <group ref={bowl} visible={false}>
        <mesh castShadow>
          <cylinderGeometry args={[0.11, 0.08, 0.055, 16]} />
          <meshStandardMaterial color="#e07a6a" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.032, 0]}>
          <cylinderGeometry args={[0.085, 0.085, 0.014, 16]} />
          <meshStandardMaterial color="#c98a4e" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}
