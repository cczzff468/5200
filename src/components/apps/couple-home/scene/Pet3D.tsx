'use client';

/* eslint-disable react-hooks/immutability -- R3F/宠物 AI 需要每帧原地修改对象与运行时状态 */

/**
 * 情侣小家 3D —— 宠物系统（v5.7 领养 → v5.9 品种 → v6.1 立绘 → v6.2 真·3D 卡通手办）
 *
 * - 11 个真实品种（../pet-breeds PET_BREEDS look 参数驱动）：狗 柴犬/博美/金毛/哈士奇/柯基，
 *   猫 橘猫/布偶/三花/狸花/金渐层/奶牛猫；
 * - v6.2 渲染重构：AI 立绘面片 → 程序化 3D 卡通手办建模（对照用户参考图的 chibi 3D 渲染）：
 *   大圆头 + 超大果冻眼(双高光+眨眼) + 腮红 + 圆豆身 + 小短腿 + 品种耳型(立耳/大立耳/垂耳)
 *   + 品种尾型(卷尾/羽状尾/镰刀尾/问号尾/短尾) + 花色(纯色/虎斑/重点色/斑块/鞍纹/白眉纹)；
 *   真实 3D 体积 + 随移动转身（不再 billboard），与小人家具同一渲染管线；
 * - 动画：四腿对角步态 + 身体起伏 + 尾巴摇 + 待机呼吸 + 随机眨眼 + 低头吃饭 +
 *   打盹闭眼(💤) + 撸宠开心蹦跳(❤️)；
 * - AI 零改动：随机目标溜达（撞家具绕开）+ 时不时打盹；喂食跑过去低头吃（🍚 气泡）；
 * - 位置持久化由上层负责（petRT 随存档快照写入 HomeState.pet）；
 * - 性别：girl 头顶 3D 粉蝴蝶结；boy 无配饰。
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { CharRT, FurnitureItem } from '../types';
import { CATALOG, ROOM_X, ROOM_Z, BED_Z0, footprintOf } from '../catalog';
import { breedOf, type PetBreed, type PetGender } from '../pet-breeds';

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

/** 顶球冠几何（花色盖片：thetaLength 控制覆盖角， hug 住球体表面） */
const capGeo = (thetaLen: number) => new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, thetaLen);

interface PetRig {
  root: THREE.Group;
  /** 缩放包裹（look.scale） */
  model: THREE.Group;
  head: THREE.Group;
  earL: THREE.Group;
  earR: THREE.Group;
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  legs: THREE.Group[];
  tail: THREE.Group;
  bow: THREE.Group | null;
  /** 世界高度（含品种缩放） */
  hWorld: number;
  dispose: () => void;
}

/**
 * 组装一只 3D 卡通手办宠物（单位空间，朝 +z；root.scale 由 look.scale 决定）。
 * 结构：root(起伏) → model(缩放) → [腿×4(髋), 身体+花色, 尾, 头(耳/眼/口鼻/腮红/蝴蝶结)]
 */
function buildPet(breed: PetBreed, gender: PetGender): PetRig {
  const look = breed.look;
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const G = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };
  const M = <T extends THREE.Material>(m: T): T => {
    mats.push(m);
    return m;
  };
  const std = (c: string, rough = 0.95, extra?: Partial<THREE.MeshStandardMaterialParameters>) =>
    M(new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0, ...extra }));

  const furMat = std(look.fur, 0.96);
  const bellyMat = std(look.belly, 0.96);
  const darkMat = std(look.dark, 0.96);
  const noseMat = std(look.nose, 0.35);
  const eyeMat = std(look.eye, 0.12);
  const hiMat = std('#ffffff', 0.15);
  const pinkMat = std('#f2b0be', 0.8);
  const mouthMat = std('#8a5f4e', 0.6);
  const blushMat = std('#f6a8b4', 1, { transparent: true, opacity: 0.72 });
  const wiskMat = std('#f5efe2', 0.9, { transparent: true, opacity: 0.9 });

  const isDog = breed.sp === 'dog';
  const isCat = !isDog;

  const root = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(0.88 * look.scale);
  root.add(model);

  const sph = G(new THREE.SphereGeometry(1, 18, 14)); // 万能单位球（缩放成各种椭圆）
  const add = (
    geo: THREE.BufferGeometry,
    m: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D,
    sx = 1,
    sy = 1,
    sz = 1,
  ) => {
    const mm = new THREE.Mesh(geo, m);
    mm.position.set(x, y, z);
    mm.scale.set(sx, sy, sz);
    mm.castShadow = true;
    parent.add(mm);
    return mm;
  };

  // ==================== 身体（圆豆） ====================
  const bodyY = 0.175;
  const bodyZ = -0.05;
  const bodySX = 0.106;
  const bodySY = 0.101;
  const bodySZ = 0.15 * look.bodyLen;
  add(sph, furMat, 0, bodyY, bodyZ, model, bodySX, bodySY, bodySZ);
  // 胸口/肚皮浅色（从下巴一直软到肚子）
  add(sph, bellyMat, 0, bodyY - 0.018, bodyZ + bodySZ * 0.42, model, bodySX * 0.66, bodySY * 0.7, bodySZ * 0.62);

  // —— 花色：身体部分 ——
  if (look.pattern === 'saddle') {
    // 鞍纹（柴犬/金毛）：背脊深色顶冠
    const saddle = new THREE.Mesh(G(capGeo(Math.PI * 0.56)), darkMat);
    saddle.position.set(0, bodyY + 0.004, bodyZ - 0.006);
    saddle.scale.set(bodySX * 1.025, bodySY * 1.03, bodySZ * 1.02);
    saddle.rotation.x = -0.38;
    saddle.castShadow = true;
    model.add(saddle);
  } else if (look.pattern === 'tabby') {
    // 虎斑（橘猫/狸花）：背脊三条深纹 + 额头川纹
    for (const [bz, by, rot] of [
      [-0.035, 0.262, 0.1],
      [-0.105, 0.252, 0.22],
      [-0.168, 0.228, 0.38],
    ] as const) {
      const st = add(sph, darkMat, 0, by, bz * look.bodyLen, model, 0.082, 0.026, 0.052);
      st.rotation.x = rot;
    }
  } else if (look.pattern === 'patches') {
    // 斑块（三花/奶牛）：背部大色斑 + 胁侧小斑
    const p1 = look.patchCols?.[1] ?? look.dark;
    const back = new THREE.Mesh(G(capGeo(Math.PI * 0.62)), M(new THREE.MeshStandardMaterial({ color: p1, roughness: 0.96 })));
    back.position.set(0, bodyY + 0.002, bodyZ - 0.004);
    back.scale.set(bodySX * 1.02, bodySY * 1.025, bodySZ * 1.015);
    back.rotation.z = 0.38;
    back.rotation.x = -0.22;
    back.castShadow = true;
    model.add(back);
    const p0 = look.patchCols?.[0] ?? look.dark;
    add(sph, M(new THREE.MeshStandardMaterial({ color: p0, roughness: 0.96 })), 0.07, bodyY + 0.03, bodyZ + bodySZ * 0.3, model, 0.052, 0.028, 0.06);
  } else if (look.pattern === 'solid' && breed.id === 'goldenShaded') {
    // 金渐层：背部毛尖色薄冠
    const tip = new THREE.Mesh(G(capGeo(Math.PI * 0.5)), darkMat);
    tip.position.set(0, bodyY + 0.002, bodyZ);
    tip.scale.set(bodySX * 1.02, bodySY * 1.02, bodySZ * 1.01);
    tip.castShadow = true;
    model.add(tip);
  }

  // 博美：脖围奶白绒毛圈
  if (breed.id === 'pomeranian') {
    for (const [fx, fz, fr] of [
      [0, 0.05, 0.05],
      [-0.06, 0.02, 0.042],
      [0.06, 0.02, 0.042],
      [-0.075, -0.03, 0.036],
      [0.075, -0.03, 0.036],
    ] as const) {
      add(sph, bellyMat, fx, 0.235, fz, model, fr, fr * 0.85, fr);
    }
  }

  // ==================== 四条小短腿（髋 pivot） ====================
  const legR = 0.032 * look.legR;
  const legLen = 0.078 * look.legLen;
  const legGeo = G(new THREE.CapsuleGeometry(legR, legLen, 4, 10));
  const pawGeo = G(new THREE.SphereGeometry(legR * 1.16, 10, 8));
  const hipY = 0.126;
  const hipFX = 0.064;
  const hipFZ = bodyZ + bodySZ * 0.68;
  const hipBZ = bodyZ - bodySZ * 0.72;
  const legs: THREE.Group[] = [];
  const pawMat = look.pattern === 'points' ? darkMat : furMat;
  for (const [sx, fz] of [
    [-1, hipFZ],
    [1, hipFZ],
    [-1, hipBZ],
    [1, hipBZ],
  ] as const) {
    const hip = new THREE.Group();
    hip.position.set(sx * hipFX, hipY, fz);
    model.add(hip);
    const lm = new THREE.Mesh(legGeo, furMat);
    lm.position.y = -legLen / 2 - legR * 0.1;
    lm.castShadow = true;
    hip.add(lm);
    const paw = new THREE.Mesh(pawGeo, pawMat);
    paw.position.set(0, -legLen - legR * 0.42, legR * 0.3);
    paw.castShadow = true;
    hip.add(paw);
    legs.push(hip);
  }

  // ==================== 尾巴（pivot 挂 body 后上） ====================
  const tail = new THREE.Group();
  tail.position.set(0, 0.255, bodyZ - bodySZ * 0.86);
  model.add(tail);
  const tailMat =
    look.pattern === 'patches'
      ? M(new THREE.MeshStandardMaterial({ color: look.patchCols?.[1] ?? look.dark, roughness: 0.96 }))
      : furMat;
  if (look.tail === 'curl') {
    // 柴犬卷尾：背上绒球卷
    const tg = G(new THREE.TorusGeometry(0.05, 0.02, 8, 16, Math.PI * 1.5));
    const tm = new THREE.Mesh(tg, tailMat);
    tm.position.set(0, 0.02, -0.005);
    tm.rotation.x = Math.PI / 2 - 0.32;
    tm.rotation.y = Math.PI / 2;
    tm.castShadow = true;
    tail.add(tm);
  } else if (look.tail === 'plume') {
    // 羽状尾（金毛/博美/布偶）：蓬松上翘
    const up = new THREE.Mesh(G(new THREE.CapsuleGeometry(0.026, 0.11, 4, 10)), tailMat);
    up.position.set(0, 0.06, -0.028);
    up.rotation.x = -0.95;
    up.castShadow = true;
    tail.add(up);
    const tipMat = look.pattern === 'points' ? darkMat : tailMat;
    const tip = new THREE.Mesh(sph, tipMat);
    tip.position.set(0, 0.118, -0.075);
    tip.scale.setScalar(0.033);
    tip.castShadow = true;
    tail.add(tip);
    if (breed.id === 'pomeranian') {
      const f1 = new THREE.Mesh(sph, tailMat);
      f1.position.set(0, 0.085, -0.045);
      f1.scale.setScalar(0.036);
      tail.add(f1);
    }
  } else if (look.tail === 'sickle') {
    // 镰刀尾（哈士奇）：上翘前钩
    const up = new THREE.Mesh(G(new THREE.CapsuleGeometry(0.021, 0.1, 4, 10)), tailMat);
    up.position.set(0, 0.05, -0.012);
    up.rotation.x = -0.5;
    up.castShadow = true;
    tail.add(up);
    const hook = new THREE.Mesh(G(new THREE.CapsuleGeometry(0.015, 0.05, 4, 8)), tailMat);
    hook.position.set(0, 0.102, 0.014);
    hook.rotation.x = 0.7;
    hook.castShadow = true;
    tail.add(hook);
  } else if (look.tail === 'question') {
    // 问号尾（猫）：立起前卷
    const tg = G(new THREE.TorusGeometry(0.05, 0.015, 8, 16, Math.PI * 1.1));
    const tm = new THREE.Mesh(tg, tailMat);
    tm.position.set(0, 0.048, -0.004);
    tm.rotation.z = -0.55;
    tm.rotation.y = 0.22;
    tm.castShadow = true;
    tail.add(tm);
    const tip = new THREE.Mesh(sph, tailMat);
    tip.position.set(-0.028, 0.098, 0.012);
    tip.scale.setScalar(0.019);
    tail.add(tip);
  } else {
    // bob 柯基短尾：小圆球
    const tm = new THREE.Mesh(sph, tailMat);
    tm.position.set(0, 0.012, -0.01);
    tm.scale.set(0.03, 0.024, 0.03);
    tm.castShadow = true;
    tail.add(tm);
  }

  // ==================== 头（大头 chibi 比例） ====================
  const headR = 0.155 * look.headRound;
  const headY = 0.34;
  const headZ = 0.075;
  const head = new THREE.Group();
  head.position.set(0, headY, headZ);
  model.add(head);
  add(sph, furMat, 0, 0, 0, head, headR, headR, headR);

  // —— 花色：头部部分 ——
  if (look.pattern === 'patches') {
    // 三花：左耳橘色帽 + 右后黑斑；奶牛：黑帽
    const capCols = look.patchCols ?? [look.dark, look.dark];
    const capL = new THREE.Mesh(G(capGeo(Math.PI * 0.5)), M(new THREE.MeshStandardMaterial({ color: capCols[0], roughness: 0.96 })));
    capL.scale.setScalar(headR * 1.02);
    capL.rotation.z = 0.62;
    capL.rotation.x = -0.25;
    capL.castShadow = true;
    head.add(capL);
    if (breed.id === 'calico') {
      const capR = new THREE.Mesh(G(capGeo(Math.PI * 0.42)), M(new THREE.MeshStandardMaterial({ color: capCols[1], roughness: 0.96 })));
      capR.scale.setScalar(headR * 1.02);
      capR.rotation.z = -0.95;
      capR.rotation.x = -0.7;
      capR.castShadow = true;
      head.add(capR);
    }
  } else if (look.pattern === 'blaze') {
    // 哈士奇/柯基：头顶冠 + 白眉纹
    if (breed.id === 'husky') {
      const crown = new THREE.Mesh(G(capGeo(Math.PI * 0.55)), darkMat);
      crown.scale.setScalar(headR * 1.03);
      crown.rotation.x = -0.55;
      crown.castShadow = true;
      head.add(crown);
    }
    // 白色眉心纹（从额头拉到鼻梁）
    const blaze = add(sph, bellyMat, 0, headR * 0.34, headR * 0.72, head, headR * 0.3, headR * 0.62, headR * 0.26);
    blaze.rotation.x = -0.28;
  } else if (look.pattern === 'points') {
    // 布偶：深色面罩（口鼻一圈）
    add(sph, darkMat, 0, -headR * 0.3, headR * 0.56, head, headR * 0.52, headR * 0.38, headR * 0.4);
  } else if (look.pattern === 'tabby') {
    // 额头川字纹
    for (const fx of [-1, 0, 1]) {
      const st = add(sph, darkMat, fx * headR * 0.24, headR * 0.56, headR * 0.52, head, headR * 0.09, headR * 0.3, headR * 0.12);
      st.rotation.x = -0.35;
    }
  } else if (look.pattern === 'saddle' && breed.id === 'shiba') {
    // 柴犬白腮
    for (const sx of [-1, 1]) {
      add(sph, bellyMat, sx * headR * 0.52, -headR * 0.3, headR * 0.5, head, headR * 0.34, headR * 0.3, headR * 0.28);
    }
  }

  // —— 口鼻（狗大吻 / 猫小吻） ——
  const muzR = isDog ? 0.05 : 0.036;
  const muzY = -headR * 0.26;
  const muzZ = headR * 0.68;
  add(sph, bellyMat, 0, muzY, muzZ, head, muzR * 1.15, muzR * 0.82, muzR);
  // 鼻头
  add(sph, noseMat, 0, muzY + muzR * 0.5, muzZ + muzR * 0.82, head, 0.014, 0.011, 0.011);
  // 嘴（狗微笑弧 / 猫 ω 俩小弧）
  if (isDog) {
    const smile = new THREE.Mesh(G(new THREE.TorusGeometry(0.015, 0.0038, 6, 12, Math.PI * 0.8)), mouthMat);
    smile.position.set(0, muzY - muzR * 0.28, muzZ + muzR * 0.66);
    smile.rotation.x = 0.42;
    smile.rotation.z = Math.PI + Math.PI * 0.1;
    head.add(smile);
  } else {
    for (const sx of [-1, 1]) {
      const om = new THREE.Mesh(G(new THREE.TorusGeometry(0.01, 0.0032, 6, 10, Math.PI * 0.85)), mouthMat);
      om.position.set(sx * 0.011, muzY - muzR * 0.3, muzZ + muzR * 0.7);
      om.rotation.x = 0.42;
      om.rotation.z = Math.PI + Math.PI * 0.075;
      head.add(om);
    }
  }

  // —— 大果冻眼（双高光 + 眨眼） ——
  const eyeR0 = headR * 0.235;
  const eyeGeo = G(new THREE.SphereGeometry(eyeR0, 14, 12));
  const hiGeo = G(new THREE.SphereGeometry(eyeR0 * 0.34, 8, 8));
  const eyeL = new THREE.Group();
  const eyeR = new THREE.Group();
  const eyePivots = [
    [-1, eyeL],
    [1, eyeR],
  ] as const;
  for (const [sx, piv] of eyePivots) {
    piv.position.set(sx * headR * 0.44, headR * 0.03, headR * 0.78);
    head.add(piv);
    const ball = new THREE.Mesh(eyeGeo, eyeMat);
    ball.scale.set(1, 1.16, 0.62);
    ball.castShadow = false;
    piv.add(ball);
    const hi1 = new THREE.Mesh(hiGeo, hiMat);
    hi1.position.set(eyeR0 * 0.3, eyeR0 * 0.38, eyeR0 * 0.5);
    hi1.castShadow = false;
    piv.add(hi1);
    const hi2 = new THREE.Mesh(G(new THREE.SphereGeometry(eyeR0 * 0.17, 8, 8)), hiMat);
    hi2.position.set(-eyeR0 * 0.3, -eyeR0 * 0.32, eyeR0 * 0.52);
    hi2.castShadow = false;
    piv.add(hi2);
  }

  // —— 腮红 ——
  const blushGeo = G(new THREE.CircleGeometry(headR * 0.16, 14));
  for (const sx of [-1, 1]) {
    const bl = new THREE.Mesh(blushGeo, blushMat);
    bl.position.set(sx * headR * 0.66, -headR * 0.32, headR * 0.5);
    bl.rotation.y = sx * 0.55;
    bl.castShadow = false;
    head.add(bl);
  }

  // —— 猫胡须 ——
  if (isCat) {
    const wg = G(new THREE.CylinderGeometry(0.0014, 0.0014, 0.07, 4));
    for (const sx of [-1, 1]) {
      for (const ry of [-0.14, 0.1]) {
        const w = new THREE.Mesh(wg, wiskMat);
        w.position.set(sx * headR * 0.62, -headR * 0.24 + ry * 0.3, headR * 0.56);
        w.rotation.z = Math.PI / 2;
        w.rotation.y = sx * -0.4;
        w.rotation.x = ry;
        w.castShadow = false;
        head.add(w);
      }
    }
  }

  // —— 耳朵（pivot：erect 立耳 / erectBig 柯基大立耳 / floppy 金毛垂耳） ——
  const earL = new THREE.Group();
  const earR = new THREE.Group();
  const earMat = look.pattern === 'points' ? darkMat : furMat;
  const innerGeo = G(new THREE.SphereGeometry(1, 10, 8));
  for (const [sx, piv] of [
    [-1, earL],
    [1, earR],
  ] as const) {
    if (look.ear === 'floppy') {
      piv.position.set(sx * headR * 0.86, headR * 0.5, -headR * 0.04);
      piv.rotation.z = sx * 0.5;
      piv.rotation.x = 0.08;
      const fl = new THREE.Mesh(G(new THREE.CapsuleGeometry(headR * 0.3, headR * 0.72, 4, 10)), earMat);
      fl.position.y = -headR * 0.4;
      fl.castShadow = true;
      piv.add(fl);
    } else {
      const big = look.ear === 'erectBig';
      const ew = headR * (big ? 0.4 : 0.3);
      const eh = headR * (big ? 0.72 : 0.55);
      piv.position.set(sx * headR * (big ? 0.56 : 0.52), headR * 0.72, -headR * 0.06);
      piv.rotation.z = -sx * (big ? 0.12 : 0.18);
      piv.rotation.x = -0.08;
      const ear = new THREE.Mesh(innerGeo, earMat);
      ear.scale.set(ew, eh, ew * 0.55);
      ear.position.y = eh * 0.85;
      ear.castShadow = true;
      piv.add(ear);
      const inner = new THREE.Mesh(innerGeo, pinkMat);
      inner.scale.set(ew * 0.5, eh * 0.55, ew * 0.3);
      inner.position.set(0, eh * 0.78, ew * 0.42);
      inner.castShadow = false;
      piv.add(inner);
    }
    head.add(piv);
  }

  // —— girl 头顶 3D 粉蝴蝶结 ——
  let bow: THREE.Group | null = null;
  if (gender === 'girl') {
    bow = new THREE.Group();
    bow.position.set(headR * 0.34, headR * 0.95, -headR * 0.04);
    bow.rotation.z = -0.42;
    const wingGeo = G(new THREE.SphereGeometry(1, 10, 8));
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(wingGeo, M(new THREE.MeshStandardMaterial({ color: '#f7a8c4', roughness: 0.55 })));
      wing.position.set(sx * 0.036, 0, 0);
      wing.scale.set(0.04, 0.027, 0.018);
      wing.castShadow = false;
      bow.add(wing);
    }
    const knot = new THREE.Mesh(wingGeo, M(new THREE.MeshStandardMaterial({ color: '#ef8fb2', roughness: 0.5 })));
    knot.scale.setScalar(0.016);
    bow.add(knot);
    head.add(bow);
  }

  /** 世界高度（头顶，供气泡/爱心/阴影定位） */
  const hWorld = 0.88 * look.scale * (headY + headR * 1.15);

  const dispose = () => {
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
  };
  return { root, model, head, earL, earR, eyeL, eyeR, legs, tail, bow, hWorld, dispose };
}

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
  const hearts = useRef<(THREE.Sprite | null)[]>([]);
  const moodSprite = useRef<THREE.Sprite>(null);
  const bowl = useRef<THREE.Group>(null);

  // —— 品种与性别 ——
  const breed = breedOf(pet.sp, pet.breed);
  const gender: PetGender = pet.gender ?? 'boy';
  const rig = useMemo(() => buildPet(breed, gender), [breed, gender]);
  useEffect(() => () => rig.dispose(), [rig]);
  const h = rig.hWorld;

  const tex = useMemo(
    () => ({
      heart: makeBubbleTexture('heart'),
      rice: makeBubbleTexture('rice'),
      zzz: makeBubbleTexture('zzz'),
      shadow: makeShadowTexture(),
    }),
    [],
  );
  useEffect(() => () => Object.values(tex).forEach((t) => t.dispose()), [tex]);

  /** 撸宠爱心粒子（点击时触发，本地计时） */
  const petAt = useRef(0);
  const eatAt = useRef(0);
  const dozedOff = useRef(0);
  /** 眨眼调度 */
  const nextBlink = useRef(1200);

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

  const damp = THREE.MathUtils.damp;

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
    clampPet(c, itemsRef.current ?? [], breed.look.scale);
    hz.position.set(c.x, 0, c.z);
    hz.rotation.y = c.heading;

    // —— 手办动画：步态 / 呼吸 / 摇尾 / 眨眼 / 表情 ——
    const { root, model, head, earL, earR, eyeL, eyeR, legs, tail } = rig;
    const eatingNow = !!eating || (eatAt.current > 0 && now - eatAt.current < 2600);
    if (eatingDone(now)) eatAt.current = 0;
    const walking = c.moving && !eatingNow;
    const happyNow = !!petAt.current && now - petAt.current < 1200;
    const dozing = !!dozedOff.current && now - dozedOff.current < 3500 && !c.moving && !eatingNow;

    // 朝向由 AI heading 平滑，身体起伏 + 撸宠蹦跳
    const bob = walking ? Math.abs(Math.sin(t * 12)) * 0.016 : Math.sin(t * 2.1) * 0.005 + 0.004;
    let hop = 0;
    if (happyNow) {
      const ph = ((now - petAt.current) % 300) / 300;
      hop = Math.abs(Math.sin(ph * Math.PI)) * 0.05;
    }
    root.position.y = bob + hop - (eatingNow ? 0.012 : 0);
    // 呼吸：身体轻微缩放
    const br = !walking ? Math.sin((t * Math.PI * 2) / 1.7) * 0.012 : 0;
    model.scale.setScalar(0.88 * breed.look.scale);
    model.scale.y *= 1 + br;

    // 四腿对角步态
    for (let i = 0; i < legs.length; i++) {
      const phase = i === 0 || i === 3 ? 0 : Math.PI;
      const target = walking ? Math.sin(t * 12 + phase) * 0.5 : 0;
      legs[i].rotation.x = damp(legs[i].rotation.x, target, walking ? 26 : 9, dt);
    }

    // 尾巴摇（走路/开心快摇，待机慢摇，吃饭/打盹轻摇）
    const wagAmp = happyNow ? 0.45 : dozing || eatingNow ? 0.08 : walking ? 0.3 : 0.16;
    const wagSp = happyNow ? 17 : walking ? 10 : 4;
    tail.rotation.y = Math.sin(t * wagSp) * wagAmp;
    tail.rotation.x = dozing ? 0.1 : Math.sin(t * wagSp + 1) * wagAmp * 0.25;

    // 头：吃饭低头凑碗 / 打盹微垂 / 待机好奇轻晃 / 走路稳住
    const headTarget = eatingNow ? 0.52 : dozing ? 0.16 : walking ? 0 : Math.sin(t * 1.1) * 0.05;
    head.rotation.x = damp(head.rotation.x, headTarget, 7, dt);
    // 耳朵：走路/开心扑闪（erect 外撇 / floppy 外垂，与建模基底一致）
    const earWig = walking || happyNow ? Math.sin(t * (happyNow ? 15 : 10)) * 0.12 : Math.sin(t * 1.4) * 0.03;
    const floppyEar = breed.look.ear === 'floppy';
    const earBase = floppyEar ? 0.5 : 0.18;
    earL.rotation.z = (floppyEar ? -earBase : earBase) - earWig;
    earR.rotation.z = (floppyEar ? earBase : -earBase) + earWig;

    // 眨眼（周期 1.6–4.4s，闭眼 140ms）+ 打盹持续闭眼
    if (dozing) {
      nextBlink.current = now + 1800;
    } else if (now >= nextBlink.current + 140) {
      nextBlink.current = now + 1600 + Math.random() * 2800;
    }
    const blinkNow = !dozing && now >= nextBlink.current && now < nextBlink.current + 140;
    const eyeTarget = blinkNow || dozing ? 0.12 : 1;
    eyeL.scale.y = damp(eyeL.scale.y, eyeTarget, 26, dt);
    eyeR.scale.y = eyeL.scale.y;

    // —— 心情气泡（🍚 吃饭 / 💤 打盹；撸宠爱心由粒子表达） ——
    if (moodSprite.current) {
      const showRice = eatingNow;
      const showZzz = !showRice && dozing;
      moodSprite.current.visible = showRice || showZzz;
      moodSprite.current.material.map = showRice ? tex.rice : tex.zzz;
      moodSprite.current.material.needsUpdate = true;
      moodSprite.current.position.set(0.05, h + 0.13 + Math.sin(t * 2) * 0.02, 0);
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
      {/* 宠物本体（holder = AI 坐标系 + 朝向；内部 root 起伏 / model 缩放） */}
      <group
        ref={holder}
        onClick={handleTap}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 接地软阴影 */}
        <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[h * 1.3, h * 1.02]} />
          <meshBasicMaterial map={tex.shadow} transparent depthWrite={false} />
        </mesh>

        <primitive object={rig.root} />

        {/* 心情气泡（🍚 吃饭 / 💤 打盹） */}
        <sprite ref={moodSprite} position={[0, h + 0.13, 0]} scale={[0.2, 0.2, 1]} visible={false}>
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
