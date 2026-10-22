'use client';

/* eslint-disable react-hooks/immutability -- 宠物 AI 需要每帧原地修改 runtime 对象（与 Char3D 同模式） */

/**
 * 情侣小屋 3D —— 宠物系统（v5.7 领养 → v6.2 3D建模 → v6.4 现成模型 → v7.0 程序化 Q 版）
 *
 * - v7.0：用户嫌 Quaternius 低多边形不好看，发来 Q 版大头参考图；现成模型站无同款
 *   免费风格，改为纯 three.js 程序化盲盒风建模（QPet.tsx，见 pet-models 8 品种）；
 * - 渲染：QPet（大头圆身豆眼腮红 + 程序化动画），本组件只负责 AI 与状态权重；
 * - 状态机（权重传给 QPet，阻尼混合）：
 *   溜达 walk / 冲饭 run（靠近饭碗 1.6m 内加速冲刺）/ 待机 idle（呼吸+眨眼）/ 吃饭 eat /
 *   打盹 nap（压扁耷耳）/ 撸宠开心 happy（连蹦 squash&stretch）；
 * - AI 零改动：随机目标溜达（撞家具绕开 + 卡死换目标）+ 时不时打盹；
 *   喂食跑过去低头吃（🍚 气泡）；点击撸宠开心蹦跳（❤️ 粒子 + 💤 打盹气泡保留）；
 * - 朝向：heading 由移动方向实时阻尼写入（与 Char3D 同一坐标系，绕 Y 轴转身）；
 * - 位置持久化由上层负责（petRT 随存档快照写入 HomeState.pet）。
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { CharRT, FurnitureItem } from '../types';
import { CATALOG, ROOM_X, ROOM_Z, BED_Z0, footprintOf } from '../catalog';
import { modelOf } from '../pet-models';
import QPet, { type QPetHandle } from './QPet';

export interface PetData {
  sp: 'cat' | 'dog';
  name: string;
  /** 模型 id（pet-models PET_MODELS；老档旧品种 id 由 modelOf 兜底映射） */
  breed?: string;
  /** 性别（保留字段；Q 版模型不区分配饰） */
  gender?: 'boy' | 'girl';
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

/** 宠物 Living-room 边界 + 家具避障（简化版碰撞） */
function clampPet(c: CharRT, items: FurnitureItem[]) {
  const m = 0.14;
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
  const qRef = useRef<QPetHandle>(null);
  const hearts = useRef<(THREE.Sprite | null)[]>([]);
  const moodSprite = useRef<THREE.Sprite>(null);
  const bowl = useRef<THREE.Group>(null);

  // —— 模型（pet-models 注册表；老档旧品种 id 自动兜底） ——
  const model = modelOf(pet.breed);

  const bubbleTex = useMemo(
    () => ({
      heart: makeBubbleTexture('heart'),
      rice: makeBubbleTexture('rice'),
      zzz: makeBubbleTexture('zzz'),
      shadow: makeShadowTexture(),
    }),
    [],
  );
  useEffect(() => () => Object.values(bubbleTex).forEach((t) => t.dispose()), [bubbleTex]);

  /** 模型头顶世界高度（QPet 按比例精确建模 ≈ model.targetH），供气泡/爱心定位 */
  const hRef = useRef(model.targetH);

  /** 撸宠爱心粒子（点击时触发，本地计时） */
  const petAt = useRef(0);
  const eatAt = useRef(0);
  const dozedOff = useRef(0);
  /** 卡死检测：目标点被夹进家具内永远到不了 → 超时主动换目标 */
  const stuckPrev = useRef({ x: 0, z: 0 });
  const stuckSince = useRef(0);

  const heartMats = useMemo(
    () =>
      Array.from({ length: 5 }, () => {
        const m = new THREE.SpriteMaterial({ map: bubbleTex.heart, transparent: true, opacity: 0, depthWrite: false });
        return m;
      }),
    [bubbleTex],
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

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const hz = holder.current;
    if (!hz) return;
    const t = state.clock.elapsedTime;
    const c = rt.current;
    if (!c) return;

    // —— AI：喂食优先 → 溜达 → 打盹（v5.7 原逻辑，零改动） ——
    const feed = feedRef.current;
    const now = performance.now();
    const atBowl = feed && Math.hypot(c.x - feed.x, c.z - feed.z) < 0.22;
    const eating = feed && now - feed.at < 9000 && atBowl;
    if (eating && eatAt.current === 0) eatAt.current = now;

    /** 冲饭冲刺：碗还在且没吃完、正在赶路、距碗 1.6m 内 */
    const rushing =
      !!feed && !eatingDone(now) && !eating && !!c.target && Math.hypot(c.x - feed.x, c.z - feed.z) < 1.6;

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
        stuckPrev.current = { x: c.x, z: c.z };
        stuckSince.current = now;
      } else {
        const sp = (rushing ? 2.1 : 0.85) * model.speed * dt;
        c.x += (dx / d) * sp;
        c.z += (dz / d) * sp;
        c.moving = true;
        let td = Math.atan2(dx, dz) - c.heading;
        while (td > Math.PI) td -= Math.PI * 2;
        while (td < -Math.PI) td += Math.PI * 2;
        c.heading += td * Math.min(1, dt * 9);
        // 卡死检测：1.3s 内几乎没前进（目标被家具挡住）→ 弃目标重选
        if (Math.hypot(c.x - stuckPrev.current.x, c.z - stuckPrev.current.z) > 0.06) {
          stuckPrev.current = { x: c.x, z: c.z };
          stuckSince.current = now;
        } else if (now - stuckSince.current > 1300 && !eating) {
          c.target = null;
          c.moving = false;
          c.nextWander = now / 1000; // 立即挑一个新目标
          stuckPrev.current = { x: c.x, z: c.z };
          stuckSince.current = now;
        }
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
    clampPet(c, itemsRef.current ?? []);
    hz.position.set(c.x, 0, c.z);
    hz.rotation.y = c.heading;

    // —— 状态权重 → QPet 程序化动画 ——
    const eatingNow = !!eating || (eatAt.current > 0 && now - eatAt.current < 2600);
    if (eatingDone(now)) eatAt.current = 0;
    const walking = c.moving && !eatingNow && !rushing;
    const happyNow = !!petAt.current && now - petAt.current < 1200;
    const dozing = !!dozedOff.current && now - dozedOff.current < 3500 && !c.moving && !eatingNow;

    qRef.current?.tick(t, dt, {
      walk: walking ? 1 : 0,
      run: rushing && c.moving ? 1 : 0,
      eat: eatingNow ? 1 : 0,
      nap: dozing ? 1 : 0,
      happy: happyNow ? 1 : 0,
    });

    const h = hRef.current;

    // —— 心情气泡（🍚 吃饭 / 💤 打盹；撸宠爱心由粒子表达） ——
    if (moodSprite.current) {
      const showRice = eatingNow;
      const showZzz = !showRice && dozing;
      moodSprite.current.visible = showRice || showZzz;
      moodSprite.current.material.map = showRice ? bubbleTex.rice : bubbleTex.zzz;
      moodSprite.current.material.needsUpdate = true;
      moodSprite.current.position.set(0, h + 0.13 + Math.sin(t * 2) * 0.02, 0);
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

  return (
    <group>
      {/* 宠物本体（holder = AI 坐标系；QPet 内部自带弹跳/摇摆动画层） */}
      <group
        ref={holder}
        onClick={handleTap}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 接地软阴影 */}
        <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.46, 0.38]} />
          <meshBasicMaterial map={bubbleTex.shadow} transparent depthWrite={false} />
        </mesh>

        {/* 程序化 Q 版盲盒风宠物（v7.0） */}
        <QPet ref={qRef} spec={model.spec} targetH={model.targetH} />

        {/* 心情气泡（🍚 吃饭 / 💤 打盹） */}
        <sprite ref={moodSprite} position={[0, 0.5, 0]} scale={[0.2, 0.2, 1]} visible={false}>
          <spriteMaterial map={bubbleTex.rice} transparent depthWrite={false} />
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
