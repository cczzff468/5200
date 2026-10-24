'use client';

/* eslint-disable react-hooks/immutability -- R3F 动画需要每帧原地修改 three 对象 */

/**
 * 拾光小屋 3D —— 写实小人（一男一女 · 亚洲面孔）
 *
 * - 资产来源：Ara 3D Gen（github.com/olatunde85/3d-gen，MIT 代码 + CC0 资产），
 *   基于 MakeHuman（CC0）生成写实人体：亚洲面孔混合 + 照片级皮肤贴图，
 *   game rig（Mixamo 命名骨骼）+ 内嵌动画（Idle/Walk/Run/Wave/Crouch/Sit/Laugh/Cheer，
 *   CMU 动捕（免费使用）与关键帧，已烘焙进 GLB）。
 * - real-nan.glb 男主（休闲套装黑短发）/ real-nv.glb 女主（休闲套装高马尾）。
 * - 姿势映射：stand→Idle · 走路→Walk · 坐姿系→Sit · 躺床→Idle+整体放倒（头朝 -z）·
 *   泡澡→Crouch · 做饭/淋浴/喝水→Idle；睡觉 Zzz / 泡澡泡泡 / 化妆星星 / 手持咖啡果汁
 *   为程序化点缀。
 * - 朝向与移动由 GameLoop 每帧写 rt（与 Char3D 同接口）。
 */

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharPose, CharRT } from '../types';

const MODEL_FILE: Record<'me' | 'partner', string> = { me: 'real-nv', partner: 'real-nan' };

/** 场景内目标身高（米）——沿用 v5.4 以来的小人尺度（卡通 0.95 / 拟真 1.04） */
const TARGET_H: Record<'me' | 'partner', number> = { me: 0.97, partner: 1.06 };

/** 姿势 → 动画名（对导出 GLB 内 clip 名做小写包含匹配） */
interface ClipRef { key: 'idle' | 'walk' | 'sit' | 'crouch' | 'wave' | 'laugh'; timeScale?: number }
const CLIP: Record<ClipRef['key'], ClipRef> = {
  idle: { key: 'idle' },
  walk: { key: 'walk', timeScale: 1.15 },
  sit: { key: 'sit' },
  crouch: { key: 'crouch' },
  wave: { key: 'wave' },
  laugh: { key: 'laugh' },
};

function poseToClip(pose: CharPose, moving: boolean): ClipRef {
  switch (pose) {
    case 'sit':
    case 'eat':
    case 'piano':
    case 'guitar':
    case 'makeup':
    case 'mirror':
    case 'read':
      return CLIP.sit;
    case 'lie':
      return CLIP.idle;
    case 'bath':
    case 'shower':
      return CLIP.crouch;
    case 'cook':
    case 'drink':
      return CLIP.idle;
    default:
      return moving ? CLIP.walk : CLIP.idle;
  }
}

const SEATED: CharPose[] = ['sit', 'eat', 'piano', 'guitar', 'makeup', 'mirror', 'read'];

/** 手持小杯（咖啡带热气 / 果汁带吸管） */
function buildCup(): { group: THREE.Group; coffee: THREE.Group; juice: THREE.Group; steam: THREE.Sprite } {
  const group = new THREE.Group();
  const coffee = new THREE.Group();
  const cupBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.022, 0.05, 12),
    new THREE.MeshStandardMaterial({ color: '#f4f0ea', roughness: 0.7 }),
  );
  cupBody.position.y = 0.03;
  const liquid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.024, 0.02, 0.012, 12),
    new THREE.MeshStandardMaterial({ color: '#6b4226', roughness: 0.4 }),
  );
  liquid.position.y = 0.052;
  coffee.add(cupBody, liquid);
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const steam = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0, depthWrite: false }));
  steam.scale.setScalar(0.05);
  steam.position.y = 0.09;
  coffee.add(steam);
  const juice = new THREE.Group();
  const juiceCup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.022, 0.055, 12),
    new THREE.MeshStandardMaterial({ color: '#f8e8ee', roughness: 0.5 }),
  );
  juiceCup.position.y = 0.032;
  const juiceLiquid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.023, 0.019, 0.02, 12),
    new THREE.MeshStandardMaterial({ color: '#f2a7bc', roughness: 0.35 }),
  );
  juiceLiquid.position.y = 0.05;
  const straw = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, 0.085, 8),
    new THREE.MeshStandardMaterial({ color: '#f6f5f2', roughness: 0.6 }),
  );
  straw.position.set(0.012, 0.075, 0);
  straw.rotation.z = -0.18;
  juice.add(juiceCup, juiceLiquid, straw);
  group.add(coffee, juice);
  return { group, coffee, juice, steam };
}

function makeZTex(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.font = 'bold 44px sans-serif';
  ctx.fillStyle = '#8fa8c8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Z', 32, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function bubbleMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#eaf6ff', transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.05 });
}

export interface CharRealistic3DProps {
  rt: CharRT;
  who: 'me' | 'partner';
  hide?: boolean;
  poseRef?: RefObject<{ pose: CharPose; y: number }>;
  /** 衣柜穿搭编号：写实模型自带服装，保留接口兼容 */
  outfit?: number;
  carryRef?: RefObject<{ cup: boolean; coffee?: boolean }>;
}

/** 写实模型是米制 A-pose；以下锚点按「模型身高比例」标定（实测导出 GLB 的 hips 烘焙值） */
const ANCHOR = {
  /** 站立 hips 高 / 身高（Idle clip 实测 0.955/1.76） */
  hipsY: 0.545,
  /** 坐姿 clip 的 hips 高 / 身高（Sit (passenger) 实测 0.499/1.76） */
  sitHipsY: 0.284,
  /** 蹲姿 clip 的 hips 高 / 身高（Crouch idle 实测 0.450/1.76） */
  crouchHipsY: 0.256,
  /** 躺倒时身体半厚（抬高避免穿模）/ 身高 */
  lieLift: 0.07,
};

export default function CharRealistic3D({ rt, who, hide, poseRef, carryRef }: CharRealistic3DProps) {
  const holder = useRef<THREE.Group>(null);
  const scaler = useRef<THREE.Group>(null);

  const modelGltf = useGLTF(`/couple-home/${MODEL_FILE[who]}.glb`);

  /** 组装：clone 模型 → 索引骨骼/clip → 效果挂件 */
  const kit = useMemo(() => {
    const root = new THREE.Group();
    const scal = new THREE.Group();
    root.add(scal);
    const offs = new THREE.Group();
    scal.add(offs);

    const inst = skeletonClone(modelGltf.scene) as THREE.Group;
    inst.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.frustumCulled = false;
      }
    });
    offs.add(inst);

    // 身高测量与整体缩放（模型为米制 ≈1.6-1.8m）
    inst.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(inst);
    const H = Math.max(bbox.max.y - bbox.min.y, 0.5);
    const scale = TARGET_H[who] / H;
    scal.scale.setScalar(scale);

    // 骨骼索引（Mixamo 命名，GLTFLoader 保留原冒号名）
    const boneMap = new Map<string, THREE.Bone>();
    inst.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        const n = o.name.replace(/^mixamorig:?/i, '').toLowerCase();
        if (!boneMap.has(n)) boneMap.set(n, o as THREE.Bone);
      }
    });

    // 手持杯挂右手（scale 抵消整体缩放，杯子物理尺寸恒定）
    const cup = buildCup();
    cup.group.scale.setScalar(1 / Math.max(scale, 0.0001));
    const handR = boneMap.get('righthand');
    if (handR) {
      cup.group.position.set(0, -0.02, 0.03);
      handR.add(cup.group);
    }

    // Zzz / 泡泡 / 星星（offs 空间 = 模型单位，米）
    const zTex = makeZTex();
    const zzz = new THREE.Group();
    const zzzSprites: THREE.Sprite[] = [];
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, opacity: 0, depthWrite: false }));
      sp.scale.setScalar(0.085);
      zzz.add(sp);
      zzzSprites.push(sp);
    }
    offs.add(zzz);

    const bubbles = new THREE.Group();
    const bMat = bubbleMat();
    const bGeo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 10; i++) {
      const b = new THREE.Mesh(bGeo, bMat);
      b.scale.setScalar(0.018 + (i % 3) * 0.008);
      bubbles.add(b);
    }
    offs.add(bubbles);

    const sparkTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 64;
      const ctx = cv.getContext('2d')!;
      ctx.font = 'bold 40px sans-serif';
      ctx.fillStyle = '#f6c1c9';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✦', 32, 34);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const spark = new THREE.Group();
    const sparkSprites: THREE.Sprite[] = [];
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, transparent: true, opacity: 0, depthWrite: false }));
      sp.scale.setScalar(0.075);
      spark.add(sp);
      sparkSprites.push(sp);
    }
    offs.add(spark);

    // 动画 clip 索引（小写包含匹配，取时长最长的避免 「walk」 匹配到 walk_back 等）
    const findClip = (kw: string, exclude: string[] = []): THREE.AnimationClip | null => {
      const hits = modelGltf.animations.filter((c) => {
        const n = c.name.toLowerCase();
        return n.includes(kw) && !exclude.some((e) => n.includes(e));
      });
      return hits.length ? hits.reduce((a, b) => (b.duration > a.duration ? b : a)) : null;
    };
    const clips: Partial<Record<ClipRef['key'], THREE.AnimationClip>> = {
      idle: findClip('idle', ['crouch']) ?? findClip('idle') ?? undefined,
      walk: findClip('walk', ['back']) ?? undefined,
      sit: findClip('sit', ['seat', 'situp']) ?? findClip('sit') ?? undefined,
      crouch: findClip('crouch') ?? undefined,
      wave: findClip('wave') ?? undefined,
      laugh: findClip('laugh') ?? undefined,
    };

    return { root, offs, inst, boneMap, cup, zzz, zzzSprites, bubbles, spark, sparkSprites, clips, mixer: new THREE.AnimationMixer(inst), scale, H };
  }, [who, modelGltf]);

  const scene_ = useRef<{ clip: ClipRef | null }>({ clip: null });

  useEffect(() => {
    return () => {
      kit.mixer.stopAllAction();
    };
  }, [kit]);

  const switchClip = (clip: ClipRef) => {
    if (scene_.current.clip?.key === clip.key) return;
    scene_.current.clip = clip;
    const found = kit.clips[clip.key];
    if (!found) return;
    const next = kit.mixer.clipAction(found);
    next.setEffectiveTimeScale(clip.timeScale ?? 1);
    next.setEffectiveWeight(1);
    kit.mixer.stopAllAction();
    next.reset().fadeIn(0.22).play();
  };

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const h = holder.current;
    if (!h) return;
    h.visible = !hide;
    h.position.set(rt.x, 0, rt.z);
    h.rotation.y = rt.heading;

    const t = state.clock.elapsedTime;
    const pose: CharPose = poseRef?.current?.pose ?? 'stand';
    const poseY = poseRef?.current?.y ?? 0;
    const s = kit.scale;
    const H = kit.H;

    // 动画切换 + 每帧驱动
    switchClip(poseToClip(pose, rt.moving));
    kit.mixer.update(dt);

    // 姿势锚定：offs 位移（躺姿整体放倒 + 髋部回位）
    const seated = SEATED.includes(pose);
    let offY = 0;
    let offZ = 0;
    let rotX = 0;
    if (pose === 'lie') {
      rotX = -Math.PI / 2;
      offY = poseY + ANCHOR.lieLift * H * s;
      offZ = ANCHOR.hipsY * H * s;
    } else if (pose === 'bath') {
      offY = Math.max(0.02, poseY - ANCHOR.crouchHipsY * H * s);
    } else if (pose === 'shower') {
      offY = Math.max(0.02, poseY);
    } else if (seated) {
      offY = Math.max(0.02, poseY - ANCHOR.sitHipsY * H * s);
    }
    kit.offs.rotation.x = THREE.MathUtils.damp(kit.offs.rotation.x, rotX, 10, dt);
    kit.offs.position.y = THREE.MathUtils.damp(kit.offs.position.y, offY, 9, dt);
    kit.offs.position.z = THREE.MathUtils.damp(kit.offs.position.z, offZ, 9, dt);

    // 手持杯
    const carry = who === 'me' && carryRef?.current?.cup === true;
    const carryCoffee = carry && carryRef?.current?.coffee === true;
    kit.cup.group.visible = carry && pose !== 'lie' && pose !== 'bath' && pose !== 'shower';
    kit.cup.coffee.visible = carryCoffee;
    kit.cup.juice.visible = carry && !carryCoffee;
    if (carryCoffee) {
      const ph = (t * 0.55) % 1;
      kit.cup.steam.position.y = 0.09 + ph * 0.05;
      kit.cup.steam.scale.setScalar(0.04 + ph * 0.04);
      (kit.cup.steam.material as THREE.SpriteMaterial).opacity = Math.sin(ph * Math.PI) * 0.6;
    }

    // Zzz（躺床：offs 已放倒回位，头部朝 -z ≈ -0.86H）
    kit.zzz.visible = pose === 'lie';
    if (pose === 'lie') {
      kit.zzzSprites.forEach((sp, i) => {
        const ph = (t * 0.42 + i * 0.34) % 1;
        sp.position.set(0.05 * i, 0.52 * H + i * 0.11 * H + ph * 0.24 * H, -0.88 * H - i * 0.035 * H);
        (sp.material as THREE.SpriteMaterial).opacity = Math.sin(ph * Math.PI) * 0.9;
      });
    }

    // 泡泡
    const undressed = pose === 'bath' || pose === 'shower';
    kit.bubbles.visible = undressed;
    if (undressed) {
      kit.bubbles.children.forEach((b, i) => {
        const a = t * 0.9 + (i / kit.bubbles.children.length) * Math.PI * 2;
        const rad = pose === 'bath' ? 0.26 : 0.3;
        b.position.set(Math.cos(a) * rad * (0.7 + (i % 3) * 0.18), 0.42 * H + Math.sin(t * 1.6 + i * 1.7) * 0.09 + (i % 4) * 0.07, Math.sin(a) * rad * (0.7 + ((i + 1) % 3) * 0.18));
      });
    }

    // 化妆星星
    kit.spark.visible = pose === 'makeup';
    if (pose === 'makeup') {
      kit.sparkSprites.forEach((sp, i) => {
        const a = t * 1.25 + (i / kit.sparkSprites.length) * Math.PI * 2;
        sp.position.set(Math.cos(a) * 0.3, 1.02 * H + Math.sin(t * 2.1 + i * 1.4) * 0.055, Math.sin(a) * 0.3);
        (sp.material as THREE.SpriteMaterial).opacity = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3.2 + i * 1.9));
      });
    }
  });

  return (
    <group ref={holder}>
      <group ref={scaler}>
        <primitive object={kit.root} />
      </group>
    </group>
  );
}

// 预加载
useGLTF.preload('/couple-home/real-nan.glb');
useGLTF.preload('/couple-home/real-nv.glb');
