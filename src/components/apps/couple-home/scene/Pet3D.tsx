'use client';

/* eslint-disable react-hooks/immutability -- R3F/宠物 AI 需要每帧原地修改对象与运行时状态 */

/**
 * 情侣小家 3D —— 宠物系统（v5.7 F2 领养 → v5.8 美化 → v5.9 品种一比一复刻）
 *
 * - 11 个真实品种（../pet-breeds PET_BREEDS 驱动）：狗 柴犬/博美/金毛/哈士奇/柯基，
 *   猫 橘猫/布偶/三花/狸花/金渐层/奶牛猫；建模全部由 breedOf(sp, pet.breed).look 决定：
 *   毛色 hex / 花色六方案（solid·tabby·points·patches·saddle·blaze）/ 耳型三态
 *   （erect 立耳·erectBig 柯基大立耳·floppy 垂耳）/ 尾型五态（question·curl·plume·sickle·bob）/
 *   体型（scale·bodyLen·legLen·legR·headRound）/ 鼻色 / 虹膜色（哈士奇·布偶蓝眼）。
 * - AI：随机目标溜达（撞家具绕开）+ 时不时坐下歇会儿/打盹（头顶冒 💤）——v5.7 起逻辑零改动；
 * - 点击撸宠：爱心气泡上浮 + 开心转圈（冷却 2.5s 防连点）；
 * - 喂食：碗出现在宠物面前 → 跑过去低头吃（🍚 气泡），吃完碗消失（上层负责发碗/收碗）；
 * - 位置持久化由上层负责（petRT 随存档快照写入 HomeState.pet）。
 * - 性别配饰：boy 蓝项圈+金铃铛 / girl 粉项圈+头顶蝴蝶结（只由 gender 决定，与物种无关）。
 * - v5.8 美化全保留：大头 Q 版 + 双高光眨眼、腮红、粉内耳、胡须、呼吸 + 抖耳 + 久坐会坐下歇脚。
 * - 体型 scale 乘在 holder 内的视觉子 group 上（AI 逻辑坐标/持久化不受影响）；碰撞余量按
 *   scale 微调，长腿品种整体抬到爪底贴地防穿地。
 */

import { useEffect, useMemo, useRef } from 'react';
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
  /** 性别：boy 蓝项圈+金铃铛 / girl 粉项圈+头顶蝴蝶结；缺省按 boy */
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

/** 品种微调参数（look 之外的小个性化：口吻宽/耳大小/鬃毛/plume 尾弯曲方向与粗细） */
interface BreedExtras {
  muzzleW?: number; // 口吻宽度乘子（金毛宽吻）
  earK?: number; // 耳朵相对大小（博美小尖耳）
  mane?: boolean; // 博美颈部鬃毛
  plumeRoot?: number; // plume 尾：根段弯曲（rad，负=向后再向下/上）
  plumeMid?: number; // plume 尾：中段追加弯曲
  plumeR?: number; // plume 尾：蓬松粗细乘子
}
const EXTRAS: Record<string, BreedExtras> = {
  // 博美：尾羽翻卷贴背（后仰再向前上卷）+ 小尖耳 + 颈部鬃毛
  pomeranian: { earK: 0.82, mane: true, plumeRoot: -1.35, plumeMid: 1.7, plumeR: 1.15 },
  // 金毛：宽吻 + 自然下垂微翘的羽状尾
  golden: { muzzleW: 1.28, plumeRoot: -1.85, plumeMid: 0.4, plumeR: 1.0 },
  // 布偶：蓬松大尾松松上扬
  ragdoll: { plumeRoot: -0.85, plumeMid: 0.95, plumeR: 1.2 },
  // 哈士奇：略宽口吻 + 中等偏大立耳
  husky: { muzzleW: 1.08, earK: 1.06 },
};

/** patches 方案躯干斑块分布（c=0 → patchCols[0]，c=1 → patchCols[1]；p=位置 z 会按 bodyLen 拉伸） */
const BODY_PATCHES: Record<string, { c: 0 | 1; p: [number, number, number]; s: [number, number, number] }[]> = {
  // 三花：白底 + 后背黑大块 + 前肩橘块 + 颈侧小黑斑（橘黑斑块头背分布，俯视角清晰可读）
  calico: [
    { c: 1, p: [0.06, 0.27, -0.1], s: [0.1, 0.055, 0.12] },
    { c: 0, p: [-0.065, 0.26, 0.07], s: [0.085, 0.05, 0.105] },
    { c: 1, p: [0.085, 0.205, 0.13], s: [0.05, 0.045, 0.06] },
  ],
  // 奶牛猫：白底 + 背部大黑块 + 左胁黑斑 + 右肩小黑斑（奶牛式随机大块，v6.0 加三块不等形）
  tuxedo: [
    { c: 0, p: [0.01, 0.285, -0.06], s: [0.105, 0.052, 0.17] },
    { c: 0, p: [-0.095, 0.2, -0.1], s: [0.055, 0.05, 0.08] },
    { c: 0, p: [0.09, 0.215, 0.13], s: [0.05, 0.042, 0.06] },
  ],
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
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const legFL = useRef<THREE.Group>(null);
  const legFR = useRef<THREE.Group>(null);
  const legBL = useRef<THREE.Group>(null);
  const legBR = useRef<THREE.Group>(null);
  const hearts = useRef<(THREE.Sprite | null)[]>([]);
  const moodSprite = useRef<THREE.Sprite>(null);
  const bowl = useRef<THREE.Group>(null);
  // —— 美化用引用 ——
  const eyes = useRef<(THREE.Mesh | null)[]>([]);
  const ears = useRef<(THREE.Group | null)[]>([]);
  const tailMid = useRef<THREE.Group>(null);
  const tailTip = useRef<THREE.Group>(null);
  const bell = useRef<THREE.Group>(null);

  // —— 品种与性别（v5.9：全部外观由 look 驱动） ——
  const breed = breedOf(pet.sp, pet.breed);
  const look = breed.look;
  const isCat = pet.sp === 'cat';
  const gender: PetGender = pet.gender ?? 'boy';
  const ex = EXTRAS[breed.id] ?? {};
  const bl = look.bodyLen; // 身长乘子
  const ll = look.legLen; // 腿长乘子
  const lr = look.legR; // 腿粗乘子
  const hr = look.headRound; // 头圆度乘子
  const earK = ex.earK ?? (isCat ? 1 : 1.06);
  // 长腿品种整体抬升：爪底（0.12 + 0.02 - 0.14·ll - 0.032·lr）刚好贴地，防止放大后穿地
  const lift = Math.max(0, 0.14 * ll + 0.032 * lr - 0.155);

  const tex = useMemo(
    () => ({ heart: makeBubbleTexture('heart'), rice: makeBubbleTexture('rice'), zzz: makeBubbleTexture('zzz') }),
    [],
  );

  /** 共享材质池（每只宠物一份，mesh 间复用；品种/性别变化时重建并 dispose 旧材质） */
  const M = useMemo(() => {
    const std = (color: string, roughness = 0.9) => new THREE.MeshStandardMaterial({ color, roughness });
    const pc = look.patchCols ?? [look.dark, look.dark];
    // 耳朵外侧配色：垂耳金毛/布偶重点色/奶牛猫 → 深色；三花 → 左橘右黑；其余 = 主毛色
    const darkEar = look.ear === 'floppy' || breed.id === 'ragdoll' || breed.id === 'tuxedo';
    const earL = darkEar ? look.dark : breed.id === 'calico' ? pc[0] : look.fur;
    const earR = darkEar ? look.dark : breed.id === 'calico' ? pc[1] : look.fur;
    return {
      fur: std(look.fur),
      belly: std(look.belly),
      dark: std(look.dark),
      p1: std(pc[0]),
      p2: std(pc[1]),
      nose: std(look.nose, 0.4),
      iris: std(look.eye, 0.15),
      earIn: std(isCat ? '#f5b3bd' : '#e8c9a8'),
      earL: std(earL),
      earR: std(earR),
      blush: new THREE.MeshStandardMaterial({ color: '#f6a8b0', roughness: 0.9, transparent: true, opacity: 0.55, depthWrite: false }),
      collar: std(gender === 'girl' ? '#f28cb8' : '#5c8ae0', 0.6),
      bow: std('#f7a8c4', 0.7),
      bowKnot: std('#ef8fb2', 0.7),
      bell: new THREE.MeshStandardMaterial({ color: '#f3c34e', roughness: 0.3, metalness: 0.55 }),
      ring: new THREE.MeshStandardMaterial({ color: '#c89a2e', roughness: 0.4, metalness: 0.5 }),
      hi: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      whisker: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }),
    };
  }, [breed, isCat, gender]);

  useEffect(() => {
    const mats = Object.values(M);
    return () => mats.forEach((m) => m.dispose());
  }, [M]);

  // 尾巴链参数（question 猫问号尾 / sickle 哈士奇镰刀尾 / plume 羽状蓬松尾共用三节链）
  const TC =
    look.tail === 'question'
      ? { root: -0.15, mid: 0.55, tip: 1.35, r: 1, len: 1, tipR: 0.015 }
      : look.tail === 'sickle'
        ? { root: -0.62, mid: 1.15, tip: 0.12, r: 0.85, len: 1.15, tipR: 0.014 }
        : look.tail === 'plume'
          ? {
              root: ex.plumeRoot ?? -1.1,
              mid: ex.plumeMid ?? 0.9,
              tip: 0.12,
              r: (ex.plumeR ?? 1.05) * 1.5,
              len: 1.28,
              tipR: 0.03 * ((ex.plumeR ?? 1.05) * 1.5),
            }
          : null;
  const L1 = 0.12 * (TC?.len ?? 1);
  const L2 = 0.11 * (TC?.len ?? 1);
  const L3 = 0.085 * (TC?.len ?? 1);
  // 尾尖色：博美/哈士奇/金毛浅色尾尖，其余深色（问号的点/重点色/狸花环纹尾尖黑）
  const tipMat = breed.id === 'pomeranian' || breed.id === 'husky' || breed.id === 'golden' ? M.belly : M.dark;
  // 布偶重点色：尾巴整条深色
  const tailMat = look.pattern === 'points' ? M.dark : M.fur;
  // 布偶面具式口吻（深色），其余浅色口吻
  const muzzleMat = breed.id === 'ragdoll' ? M.dark : M.belly;
  // 爪尖：重点色深色靴子，其余浅色爪（blaze 品种即白爪尖）
  const pawMat = look.pattern === 'points' ? M.dark : M.belly;
  const patchMatOf = (c: 0 | 1) => (c === 0 ? M.p1 : M.p2);
  const bodyPatches =
    BODY_PATCHES[breed.id] ??
    (look.pattern === 'patches'
      ? ([
          { c: 0, p: [0.06, 0.27, -0.05], s: [0.09, 0.05, 0.11] },
          { c: 1, p: [-0.05, 0.26, 0.07], s: [0.08, 0.045, 0.09] },
        ] as { c: 0 | 1; p: [number, number, number]; s: [number, number, number] }[])
      : null);

  /** 撸宠爱心粒子（点击时触发，本地计时） */
  const petAt = useRef(0);
  const eatAt = useRef(0);
  const dozedOff = useRef(0);
  // 眨眼 / 抖耳（clock 秒节拍）与闲坐（performance.now 毫秒，跟 AI 时钟一致）计时
  const nextBlink = useRef(2);
  const blinkUntil = useRef(0);
  const nextTwitch = useRef(5);
  const twitchUntil = useRef(0);
  const twitchSide = useRef(0);
  const sitSt = useRef({ since: 0, sitAt: 0, until: 0 });
  const sitBlend = useRef(0);

  const heartMats = useMemo(
    () =>
      Array.from({ length: 5 }, () => {
        const m = new THREE.SpriteMaterial({ map: tex.heart, transparent: true, opacity: 0, depthWrite: false });
        return m;
      }),
    [tex],
  );

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
    const h = holder.current;
    if (!h) return;
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
        const sp = (eating ? 2.1 : 0.85) * dt;
        c.x += (dx / d) * sp;
        c.z += (dz / d) * sp;
        c.moving = true;
        let td = Math.atan2(dx, dz) - c.heading;
        while (td > Math.PI) td -= Math.PI * 2;
        while (td < -Math.PI) td += Math.PI * 2;
        c.heading += td * Math.min(1, dt * 9);
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
    clampPet(c, itemsRef.current ?? [], look.scale);
    h.position.set(c.x, 0, c.z);
    h.rotation.y = c.heading;

    // —— 动画 ——
    const eatingNow = !!eating || (eatAt.current > 0 && now - eatAt.current < 2600);
    if (eatingDone(now)) eatAt.current = 0;
    const walking = c.moving && !eatingNow;
    // —— 闲坐：静止（没在走/没在吃）超 6 秒 → 坐下歇 2-3 秒再起身；一有目标/移动即自然站起，不打断溜达 AI ——
    const idleNow = !c.moving && !eatingNow;
    if (!idleNow) {
      sitSt.current.since = 0;
      sitSt.current.sitAt = 0;
    } else {
      if (!sitSt.current.since) sitSt.current.since = now;
      if (!sitSt.current.sitAt && now - sitSt.current.since > 6000) {
        sitSt.current.sitAt = now;
        sitSt.current.until = now + 2000 + Math.random() * 1000;
      }
      if (sitSt.current.sitAt && now >= sitSt.current.until) {
        sitSt.current.sitAt = 0;
        sitSt.current.since = now;
      }
    }
    sitBlend.current = THREE.MathUtils.damp(sitBlend.current, idleNow && sitSt.current.sitAt > 0 ? 1 : 0, 5, dt);
    const sit = sitBlend.current;
    // 走路：身体起伏 + 四腿交替；坐下：上身向后仰 + 身体微沉（长身品种后仰角收敛防穿地）
    if (body.current) {
      body.current.position.y =
        lift + (walking ? Math.abs(Math.sin(t * 11)) * 0.02 * look.scale : 0) - sit * 0.042;
      body.current.rotation.z = walking ? Math.sin(t * 11) * 0.04 : 0;
      body.current.rotation.x = (-0.34 / Math.sqrt(bl)) * sit;
    }
    const legSwing = walking ? Math.sin(t * 11) * 0.5 : 0;
    if (legFL.current) legFL.current.rotation.x = legSwing + sit * 0.34;
    if (legBR.current) legBR.current.rotation.x = legSwing + sit * 0.34;
    if (legFR.current) legFR.current.rotation.x = -legSwing + sit * 0.34;
    if (legBL.current) legBL.current.rotation.x = -legSwing - sit * 0.95;
    // 吃饭：低头（坐下时微微仰头）
    if (head.current) {
      head.current.rotation.x = THREE.MathUtils.damp(
        head.current.rotation.x,
        eatingNow ? 0.55 : Math.sin(t * 0.8) * 0.05 - sit * 0.12,
        6,
        dt,
      );
    }
    // 尾巴：开心狂摇 / 平常慢摇
    if (tail.current) {
      tail.current.rotation.y = Math.sin(t * (petAt.current && now - petAt.current < 2600 ? 14 : 5)) * 0.5;
    }
    // —— 美化动画：呼吸 / 眨眼 / 抖耳 / 尾巴惯性 / 铃铛晃动 ——
    // 呼吸：待机时身体 y ±1.5% @1.6s（x/z 轻微反向，保持体积感）
    if (body.current) {
      const br = Math.sin((t * Math.PI * 2) / 1.6) * 0.015;
      body.current.scale.set(1 - br * 0.6, 1 + br, 1 - br * 0.6);
    }
    // 眨眼：每 4-6s 一次，压扁 120ms
    if (t >= nextBlink.current) {
      blinkUntil.current = t + 0.12;
      nextBlink.current = t + 4 + Math.random() * 2;
    }
    const blinking = t < blinkUntil.current;
    eyes.current.forEach((e) => {
      if (e) e.scale.y = blinking ? 0.1 : 1;
    });
    // 抖耳：每 ~5s 随机一边快速抖一下（垂耳改成整片大幅甩动 + 日常轻轻晃）
    if (t >= nextTwitch.current) {
      twitchUntil.current = t + 0.4;
      twitchSide.current = Math.random() < 0.5 ? 0 : 1;
      nextTwitch.current = t + 4.5 + Math.random() * 3;
    }
    const twk = t < twitchUntil.current ? Math.sin(t * 46) * 0.22 : 0;
    ears.current.forEach((e, i) => {
      if (!e) return;
      const sd = i === 0 ? -1 : 1;
      if (look.ear === 'floppy') {
        const sway = Math.sin(t * 2.6 + i * 1.3) * (walking ? 0.055 : 0.028);
        e.rotation.z = 0.95 * sd + sway + (i === twitchSide.current ? Math.sin(t * 46) * 0.3 : 0);
      } else {
        const base = look.ear === 'erectBig' ? -0.12 : isCat ? -0.22 : -0.15;
        e.rotation.z = base * sd + (i === twitchSide.current ? twk : 0);
      }
    });
    // 尾巴链惯性：中/末节带相位差的小幅摆动（开心时幅度变大）
    const happyNow = !!petAt.current && now - petAt.current < 2600;
    const tf = happyNow ? 14 : 5;
    if (tailMid.current) tailMid.current.rotation.z = Math.sin(t * tf + 0.7) * (happyNow ? 0.22 : 0.1);
    if (tailTip.current) tailTip.current.rotation.z = Math.sin(t * tf + 1.3) * (happyNow ? 0.3 : 0.14);
    // 铃铛：走路时叮当晃（girl 没有铃铛，ref 为空自动跳过）
    if (bell.current) bell.current.rotation.z = Math.sin(t * 9) * (walking ? 0.22 : 0.05);
    // 撸宠后开心转一小圈
    if (petAt.current && now - petAt.current < 900) {
      h.rotation.y = c.heading + Math.sin(((now - petAt.current) / 900) * Math.PI) * 1.4;
    }

    // —— 心情气泡（优先级：吃饭 > 打盹 > 撸宠爱心由粒子表达）；y 随耳型/头圆度抬高避免插进耳朵 ——
    if (moodSprite.current) {
      const showRice = eatingNow;
      const showZzz = !showRice && !!dozedOff.current && now - dozedOff.current < 3500 && !c.moving;
      moodSprite.current.visible = showRice || showZzz;
      moodSprite.current.material.map = showRice ? tex.rice : tex.zzz;
      moodSprite.current.material.needsUpdate = true;
      const moodY =
        (isCat ? 0.57 : 0.65) +
        (look.ear === 'erect' || look.ear === 'erectBig' ? 0.035 : 0) +
        (hr - 1) * 0.15;
      moodSprite.current.position.set(0.02, moodY + Math.sin(t * 2) * 0.02, 0);
    }
    // —— 爱心粒子（撸宠后 1.6 秒；在视觉子 group 内随体型自动缩放） ——
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
        Math.sin(i * 2.2 + petAt.current * 0.01) * 0.16,
        0.42 + ph * 0.4,
        Math.cos(i * 1.7) * 0.14,
      );
      m.opacity = Math.max(0, 0.95 * (1 - ph));
      sp.scale.setScalar(0.14 + ph * 0.06);
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
      {/* 宠物本体（holder = AI 坐标系；vis = 纯视觉，整体体型 scale 乘在这里） */}
      <group
        ref={holder}
        onClick={handleTap}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <group scale={look.scale}>
          <group ref={body}>
            {/* 躯干（胶囊感：椭球，bodyLen 沿 z 拉伸） */}
            <mesh position={[0, 0.2, 0]} scale={[0.16, 0.13, 0.24 * bl]} castShadow material={M.fur}>
              <sphereGeometry args={[1, 20, 16]} />
            </mesh>
            {/* 浅色肚皮 */}
            <mesh position={[0, 0.17, 0.055 * bl]} scale={[0.12, 0.09, 0.17 * bl]} material={M.belly}>
              <sphereGeometry args={[1, 14, 12]} />
            </mesh>
            {/* —— 花色（六方案） —— */}
            {/* tabby：背脊三道深色虎斑纹（橘猫/狸花，z 随身长铺开） */}
            {look.pattern === 'tabby' &&
              [0.1, 0, -0.09].map((z, i) => (
                <group key={i} position={[0, 0.185, z * bl]} scale={[0.72, 1, 1]}>
                  <mesh rotation={[0, 0, 1.05]} material={M.dark}>
                    <torusGeometry args={[0.148, 0.013, 8, 20, 1.05]} />
                  </mesh>
                </group>
              ))}
            {/* saddle：背脊鞍形深色块 + 浅色胸口（柴犬/金毛） */}
            {look.pattern === 'saddle' && (
              <>
                <mesh position={[0, 0.29, -0.03 * bl]} scale={[0.12, 0.055, 0.15 * bl]} material={M.dark}>
                  <sphereGeometry args={[1, 16, 12]} />
                </mesh>
                <mesh position={[0, 0.25, 0.135 * bl]} scale={[0.085, 0.08, 0.095]} material={M.belly}>
                  <sphereGeometry args={[1, 12, 10]} />
                </mesh>
              </>
            )}
            {/* solid：背部毛尖色渐层（博美暖影 / 金渐层毛尖黑渐层） */}
            {look.pattern === 'solid' && (
              <mesh position={[0, 0.29, -0.02 * bl]} scale={[0.11, 0.05, 0.16 * bl]} material={M.dark}>
                <sphereGeometry args={[1, 16, 12]} />
              </mesh>
            )}
            {/* blaze：背部大色块 + 白胸围脖（柯基红背白胸 / 哈士奇灰背白胸） */}
            {look.pattern === 'blaze' && (
              <>
                <mesh position={[0, 0.29, -0.03 * bl]} scale={[0.115, 0.05, 0.15 * bl]} material={M.dark}>
                  <sphereGeometry args={[1, 16, 12]} />
                </mesh>
                <mesh position={[0, 0.25, 0.135 * bl]} scale={[0.09, 0.085, 0.095]} material={M.belly}>
                  <sphereGeometry args={[1, 12, 10]} />
                </mesh>
              </>
            )}
            {/* patches：白底 + 橘/黑或黑/黑椭圆斑块（三花/奶牛猫，真实分布=头一块+背一两块） */}
            {bodyPatches?.map((pt, i) => (
              <mesh
                key={i}
                position={[pt.p[0], pt.p[1], pt.p[2] * bl]}
                scale={pt.s}
                material={patchMatOf(pt.c)}
              >
                <sphereGeometry args={[1, 14, 12]} />
              </mesh>
            ))}

            {/* 四条腿（legLen/legR 缩放，顶部髋关节固定；bodyLen 时前后腿外移） */}
            {(
              [
                [-0.08, 0.14, legFL],
                [0.08, 0.14, legFR],
                [-0.08, -0.13, legBL],
                [0.08, -0.13, legBR],
              ] as const
            ).map(([x, z, ref], i) => (
              <group key={i} ref={ref} position={[x, 0.12, z * bl]}>
                <mesh position={[0, 0.02 - 0.07 * ll, 0]} castShadow material={M.fur}>
                  <cylinderGeometry args={[0.032 * lr, 0.028 * lr, 0.14 * ll, 10]} />
                </mesh>
                {/* 重点色深色「袜子」（布偶四肢末端深色） */}
                {look.pattern === 'points' && (
                  <mesh position={[0, 0.02 - 0.105 * ll, 0]} material={M.dark}>
                    <cylinderGeometry args={[0.033 * lr, 0.0295 * lr, 0.07 * ll, 10]} />
                  </mesh>
                )}
                <mesh position={[0, 0.02 - 0.14 * ll, 0.012]} material={pawMat}>
                  <sphereGeometry args={[0.032 * lr, 10, 8]} />
                </mesh>
              </group>
            ))}

            {/* 头（更大更Q：headRound 整组缩放 = 头更圆且五官同步；frente +z） */}
            <group ref={head} position={[0, 0.34, 0.14 * bl]} scale={hr}>
              <mesh scale={[0.16, 0.142, 0.15]} castShadow material={M.fur}>
                <sphereGeometry args={[1, 24, 18]} />
              </mesh>
              {/* 口吻（浅色 / 布偶面具深色；金毛加宽） */}
              <mesh
                position={[0, -0.042, 0.115]}
                scale={[0.082 * (ex.muzzleW ?? 1), 0.062, 0.068]}
                material={muzzleMat}
              >
                <sphereGeometry args={[1, 16, 12]} />
              </mesh>
              {/* 鼻子（品种鼻色） */}
              <mesh position={[0, -0.026, 0.176]} scale={[1.15, 0.8, 0.8]} material={M.nose}>
                <sphereGeometry args={[0.02, 10, 8]} />
              </mesh>
              {/* 眼睛 ×2（虹膜=品种眼色，哈士奇/布偶蓝眼；双高光保留；眨眼时整体压扁；v6.0 加大更 Q） */}
              {[-0.062, 0.062].map((x, i) => (
                <mesh
                  key={i}
                  ref={(el) => {
                    eyes.current[i] = el;
                  }}
                  position={[x, 0.03, 0.12]}
                  material={M.iris}
                >
                  <sphereGeometry args={[0.026, 16, 12]} />
                  {/* 大高光（左上）+ 小高光（右下） */}
                  <mesh position={[-0.009, 0.01, 0.018]} scale={[1, 1, 0.55]} material={M.hi}>
                    <sphereGeometry args={[0.0078, 8, 8]} />
                  </mesh>
                  <mesh position={[0.008, -0.008, 0.02]} material={M.hi}>
                    <sphereGeometry args={[0.0038, 6, 6]} />
                  </mesh>
                </mesh>
              ))}
              {/* 腮红（软粉椭圆，半埋进脸颊） */}
              {[-1, 1].map((s) => (
                <mesh
                  key={s}
                  position={[s * 0.075, -0.026, 0.122]}
                  rotation={[0, s * 0.45, 0]}
                  scale={[0.032, 0.022, 0.015]}
                  material={M.blush}
                >
                  <sphereGeometry args={[1, 10, 8]} />
                </mesh>
              ))}
              {/* 胡须（猫：每侧 3 根细白须，向外前侧张开） */}
              {isCat &&
                [-1, 1].map((s) =>
                  [0.28, -0.02, -0.32].map((tilt, i) => (
                    <mesh
                      key={`${s}-${i}`}
                      position={[s * 0.158, -0.032 + (i - 1) * 0.01, 0.142]}
                      rotation={[tilt, -s * 0.4, -s * 1.4]}
                      material={M.whisker}
                    >
                      <cylinderGeometry args={[0.002, 0.002, 0.07, 5]} />
                    </mesh>
                  )),
                )}
              {/* blaze：面部鼻梁白纵纹（柯基/哈士奇） */}
              {look.pattern === 'blaze' && (
                <mesh position={[0, 0.018, 0.128]} scale={[0.03, 0.085, 0.03]} material={M.belly}>
                  <sphereGeometry args={[1, 10, 10]} />
                </mesh>
              )}
              {/* 哈士奇：额头灰斑（灰帽子 + 两道灰眉） */}
              {breed.id === 'husky' && (
                <>
                  <mesh position={[0, 0.112, -0.012]} scale={[0.105, 0.048, 0.105]} material={M.dark}>
                    <sphereGeometry args={[1, 14, 10]} />
                  </mesh>
                  {[-1, 1].map((s) => (
                    <mesh
                      key={s}
                      position={[s * 0.052, 0.08, 0.112]}
                      scale={[0.034, 0.026, 0.024]}
                      material={M.dark}
                    >
                      <sphereGeometry args={[1, 10, 8]} />
                    </mesh>
                  ))}
                </>
              )}
              {/* 布偶重点色：脸部深色面具 */}
              {look.pattern === 'points' && (
                <mesh position={[0, -0.012, 0.112]} scale={[0.086, 0.064, 0.058]} material={M.dark}>
                  <sphereGeometry args={[1, 14, 12]} />
                </mesh>
              )}
              {/* patches：品种级头部花纹（v6.0 重画：头顶后部大色帽 + 单侧眼罩，俯视/正视都读得出花色）
                  三花：右后黑帽 + 左眼橘罩（耳左橘右黑）；奶牛：右后黑帽 + 左眼黑罩（双耳黑） */}
              {look.pattern === 'patches' && (
                <>
                  <mesh
                    position={[0.05, 0.105, -0.05]}
                    rotation={[0.35, 0, 0.3]}
                    scale={[0.088, 0.055, 0.082]}
                    material={M.p2}
                  >
                    <sphereGeometry args={[1, 14, 12]} />
                  </mesh>
                  <mesh
                    position={[-0.062, 0.026, 0.104]}
                    scale={[0.043, 0.041, 0.038]}
                    material={breed.id === 'calico' ? M.p1 : M.p2}
                  >
                    <sphereGeometry args={[1, 12, 10]} />
                  </mesh>
                </>
              )}
              {/* 狸花猫：额头 M 形纹（三道深色竖纹，左右两道外撇） */}
              {breed.id === 'lihua' &&
                [-0.032, 0, 0.032].map((x) => (
                  <mesh
                    key={x}
                    position={[x, 0.095, 0.112]}
                    rotation={[0, 0, x === 0 ? 0 : x > 0 ? -0.55 : 0.55]}
                    material={M.dark}
                  >
                    <boxGeometry args={[0.011, 0.05, 0.014]} />
                  </mesh>
                ))}
              {/* 狗：白色腮点（布偶面具脸上不放） */}
              {!isCat && look.pattern !== 'points' &&
                [-1, 1].map((s) => (
                  <mesh key={s} position={[s * 0.095, -0.022, 0.112]} scale={[0.018, 0.022, 0.016]} material={M.belly}>
                    <sphereGeometry args={[1, 10, 8]} />
                  </mesh>
                ))}
              {/* —— 耳型三态（组包裹便于抖耳） —— */}
              {[-1, 1].map((s, i) => (
                <group
                  key={s}
                  ref={(el) => {
                    ears.current[i] = el;
                  }}
                  position={
                    look.ear === 'floppy'
                      ? [s * 0.128, 0.02, 0.005]
                      : look.ear === 'erectBig'
                        ? [s * 0.105, 0.1, 0.005]
                        : [s * (isCat ? 0.092 : 0.1), isCat ? 0.118 : 0.102, isCat ? 0 : -0.008]
                  }
                  rotation={
                    look.ear === 'floppy'
                      ? [0.12, 0, 0.95 * s]
                      : look.ear === 'erectBig'
                        ? [0.03, 0, -0.12 * s]
                        : [isCat ? 0.1 : 0.05, 0, (isCat ? -0.22 : -0.15) * s]
                  }
                >
                  {look.ear === 'floppy' ? (
                    // 垂耳（金毛）：头两侧偏下的圆角垂片 + 浅色内耳，useFrame 微微摆动
                    <>
                      <mesh position={[s * 0.01, -0.028, 0]} scale={[0.03, 0.078, 0.055]} material={i === 0 ? M.earL : M.earR}>
                        <sphereGeometry args={[1, 12, 10]} />
                      </mesh>
                      <mesh position={[s * 0.002, -0.026, 0.02]} scale={[0.017, 0.048, 0.032]} material={M.earIn}>
                        <sphereGeometry args={[1, 10, 8]} />
                      </mesh>
                    </>
                  ) : look.ear === 'erectBig' ? (
                    // 大立耳（柯基）：更大更圆的三角耳
                    <>
                      <mesh position={[0, 0.055, 0]} scale={[1, 1, 0.6]} material={i === 0 ? M.earL : M.earR}>
                        <coneGeometry args={[0.062, 0.13, 14]} />
                      </mesh>
                      <mesh position={[0, 0.048, 0.022]} scale={[1, 1, 0.6]} material={M.earIn}>
                        <coneGeometry args={[0.034, 0.075, 12]} />
                      </mesh>
                    </>
                  ) : (
                    // 立耳（猫锥耳 / 柴犬·哈士奇三角立耳）：含内耳
                    <>
                      <mesh position={[0, 0.048 * earK, 0]} scale={[1, 1, 0.72]} material={i === 0 ? M.earL : M.earR}>
                        <coneGeometry args={[(isCat ? 0.048 : 0.054) * earK, (isCat ? 0.1 : 0.108) * earK, 12]} />
                      </mesh>
                      <mesh position={[0, 0.042 * earK, 0.02]} scale={[1, 1, 0.72]} material={M.earIn}>
                        <coneGeometry args={[(isCat ? 0.026 : 0.03) * earK, (isCat ? 0.058 : 0.062) * earK, 10]} />
                      </mesh>
                    </>
                  )}
                </group>
              ))}
              {/* gender==='girl'：头顶蝴蝶结（两个锥形翼 + 中心结） */}
              {gender === 'girl' && (
                <group position={[0.075, 0.1, 0.03]} rotation={[0.15, 0.35, -0.45]}>
                  <mesh position={[-0.026, 0, 0]} rotation={[0, 0, -Math.PI / 2 + 0.35]} scale={[1, 1, 0.55]} material={M.bow}>
                    <coneGeometry args={[0.023, 0.05, 10]} />
                  </mesh>
                  <mesh position={[0.026, 0, 0]} rotation={[0, 0, Math.PI / 2 - 0.35]} scale={[1, 1, 0.55]} material={M.bow}>
                    <coneGeometry args={[0.023, 0.05, 10]} />
                  </mesh>
                  <mesh scale={[1, 1, 0.55]} material={M.bowKnot}>
                    <sphereGeometry args={[0.014, 10, 8]} />
                  </mesh>
                </group>
              )}
            </group>

            {/* —— 尾型五态 —— */}
            <group ref={tail} position={[0, 0.26, -0.22 * bl]} rotation={[TC?.root ?? 0, 0, 0]}>
              {TC ? (
                <>
                  {/* 第一节：粗根（问号尾/镰刀尾/羽状尾共用三节链，弯曲角与粗细按品种） */}
                  <mesh position={[0, L1 / 2, 0]} castShadow material={tailMat}>
                    <cylinderGeometry args={[0.017 * TC.r, 0.024 * TC.r, L1, 10]} />
                  </mesh>
                  {/* 第二节（带摆动惯性） */}
                  <group ref={tailMid} position={[0, L1, 0]} rotation={[TC.mid, 0, 0]}>
                    <mesh position={[0, L2 / 2, 0]} material={tailMat}>
                      <cylinderGeometry args={[0.014 * TC.r, 0.017 * TC.r, L2, 10]} />
                    </mesh>
                    {/* 狸花猫：尾部环状花纹 */}
                    {breed.id === 'lihua' &&
                      [0.035, 0.075].map((y, i) => (
                        <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={M.dark}>
                          <torusGeometry args={[0.0185, 0.0045, 6, 14]} />
                        </mesh>
                      ))}
                    {/* 第三节 + 尾尖圆球（问号的点 / 白尾尖 / 蓬松毛球） */}
                    <group ref={tailTip} position={[0, L2, 0]} rotation={[TC.tip, 0, 0]}>
                      <mesh position={[0, L3 / 2, 0]} material={tailMat}>
                        <cylinderGeometry args={[0.009 * TC.r, 0.014 * TC.r, L3, 10]} />
                      </mesh>
                      <mesh position={[0, L3 + TC.tipR * 0.85, 0]} material={tipMat}>
                        <sphereGeometry args={[TC.tipR, 10, 8]} />
                      </mesh>
                    </group>
                  </group>
                </>
              ) : look.tail === 'curl' ? (
                <>
                  {/* 柴犬：卷成 3.5rad 弧的粗卷尾（侧面可见的卷绒） */}
                  <mesh position={[0, 0.1, -0.02]} rotation={[0, Math.PI / 2, 0]} castShadow material={M.fur}>
                    <torusGeometry args={[0.06, 0.026, 10, 24, 3.5]} />
                  </mesh>
                  {/* 弧端封口球（尾根 / 奶油色尾尖） */}
                  <mesh position={[0, 0.1, -0.08]} material={M.fur}>
                    <sphereGeometry args={[0.026, 10, 8]} />
                  </mesh>
                  <mesh position={[0, 0.079, 0.036]} material={M.belly}>
                    <sphereGeometry args={[0.026, 10, 8]} />
                  </mesh>
                </>
              ) : (
                // 柯基：无尾/断尾 → 小圆凸
                <mesh position={[0, 0.035, -0.028]} scale={[1, 0.78, 1]} castShadow material={M.fur}>
                  <sphereGeometry args={[0.052, 12, 10]} />
                </mesh>
              )}
            </group>

            {/* 博美颈部鬃毛（项圈后侧的蓬松围毛） */}
            {ex.mane && (
              <mesh position={[0, 0.275, -0.01]} scale={[0.12, 0.085, 0.105]} material={M.fur}>
                <sphereGeometry args={[1, 14, 12]} />
              </mesh>
            )}

            {/* 项圈（色只由 gender 决定：boy 蓝 / girl 粉）+ boy 金铃铛 */}
            <group position={[0, 0.215, 0.11 * bl]}>
              <mesh rotation={[Math.PI / 2, 0, 0]} material={M.collar}>
                <torusGeometry args={[0.088, 0.014, 10, 24]} />
              </mesh>
              {gender === 'boy' && (
                <group ref={bell} position={[0, -0.012, 0.13]}>
                  <mesh position={[0, -0.012, 0.01]} material={M.bell}>
                    <sphereGeometry args={[0.017, 12, 10]} />
                  </mesh>
                  <mesh position={[0, -0.016, 0.01]} rotation={[Math.PI / 2, 0, 0]} material={M.ring}>
                    <torusGeometry args={[0.016, 0.002, 6, 14]} />
                  </mesh>
                </group>
              )}
            </group>
          </group>

          {/* 心情气泡（🍚 吃饭 / 💤 打盹；随体型自动缩放） */}
          <sprite ref={moodSprite} position={[0, 0.6, 0]} scale={[0.2, 0.2, 1]} visible={false}>
            <spriteMaterial map={tex.rice} transparent depthWrite={false} />
          </sprite>

          {/* 撸宠爱心 ×5 */}
          {heartMats.map((m, i) => (
            <sprite
              key={i}
              ref={(el) => {
                hearts.current[i] = el;
              }}
              position={[0, 0.5, 0]}
              scale={[0.14, 0.14, 1]}
              visible
            >
              <primitive object={m} attach="material" />
            </sprite>
          ))}
        </group>
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
