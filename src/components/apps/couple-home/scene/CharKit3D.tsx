'use client';

/* eslint-disable react-hooks/immutability -- R3F 动画需要每帧原地修改 three 对象 */

/**
 * 情侣小家 3D —— Kit 小人（v6.4 模块化 GLB 角色）
 *
 * - 资产来源：NoLimitNexus/game-models（GitHub 公开仓库，作者声明 CC0）+
 *   KayKit Rig_Medium 动画库（Kay Lousberg，CC0）；23 骨骼统一骨架。
 * - 身体 = 素体 Body.glb + 可换部件（发型/上衣/裤子/鞋），部件共享同一骨架，
 *   每个部件独立 clone + 独立 mixer，全部同步播放同一 clip。
 * - 材质按名换色（skin/hair/shirt/linen/trousers/belt/boots），衣柜三套穿搭沿用
 *   v5.4 Char3D 的配色故事（白背心奶油开衫 / 樱粉家居服 / 薄荷慵懒 …）。
 * - 动画：Idle_A 待机 / Walking_A 走路 / Sit_Chair_Idle 坐姿（含吃/弹琴/读书等）
 *   / Lie_Idle 躺床（头朝 -z 与 Char3D 一致）/ Sit_Floor_Idle 泡澡 / Working_B 做饭
 *   / Use_Item 喝东西；睡觉 Zzz、泡澡泡泡、化妆星星为程序化点缀。
 * - Q版/拟真 = 整体缩放 + 头骨放大（头发/帽子刚体绑在头骨上会跟随）。
 * - 朝向与移动由 GameLoop 每帧写 rt（与 Char3D/CharSprite 同接口）。
 */

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharPose, CharRT } from '../types';

const KIT = '/couple-home/kit';

/** 穿搭（沿用 v5.4 色板故事；部件换型 + 材质换色双通道） */
interface KitOutfit {
  hair: string;
  top: string;
  bottom: string;
  boots: string;
  colors: Partial<Record<'skin' | 'hair' | 'shirt' | 'linen' | 'trousers' | 'belt' | 'boots' | 'eyes' | 'mouth', string>>;
}

const OUTFITS: Record<'me' | 'partner', KitOutfit[]> = {
  me: [
    {
      // 默认：深棕长发 + 白背心奶油领 + 深蓝牛仔裤 + 小白鞋
      hair: 'hair_long',
      top: 'top_tee',
      bottom: 'bottom_trousers',
      boots: 'boots_low',
      colors: { skin: '#ffe3cd', hair: '#4a342a', shirt: '#f7f5f1', linen: '#efe8da', trousers: '#3e4d5c', belt: '#8a6f4d', boots: '#f4f2ee' },
    },
    {
      // 樱粉家居服：丸子头 + 奶白衫粉领 + 米色阔腿裤
      hair: 'hair_bun',
      top: 'top_tunic',
      bottom: 'bottom_trousers',
      boots: 'boots_low',
      colors: { skin: '#ffe3cd', hair: '#4a342a', shirt: '#fbf6ee', linen: '#f2c1cd', trousers: '#dcc9b0', belt: '#d9a8a0', boots: '#f4ede4' },
    },
    {
      // 薄荷慵懒：侧马尾 + 白衫薄荷领 + 焦糖短裤
      hair: 'hair_ponytail',
      top: 'top_tee',
      bottom: 'bottom_shorts',
      boots: 'boots_tall',
      colors: { skin: '#ffe3cd', hair: '#4a342a', shirt: '#f9f7f2', linen: '#bcdcc8', trousers: '#b08968', belt: '#8a6f4d', boots: '#efe8dc' },
    },
  ],
  partner: [
    {
      // 默认：黑蓬松短发 + 黑夹克黑T + 黑牛仔裤 + 小白鞋
      hair: 'hair_tousled',
      top: 'top_long',
      bottom: 'bottom_trousers',
      boots: 'boots_low',
      colors: { skin: '#ffdfc6', hair: '#26262c', shirt: '#2c2c33', linen: '#1e1e24', trousers: '#33333b', belt: '#1a1a20', boots: '#f6f5f2' },
    },
    {
      // 燕麦暖男：利落短发 + 燕麦衫白领 + 灰棕牛仔裤
      hair: 'hair_short',
      top: 'top_tunic',
      bottom: 'bottom_trousers',
      boots: 'boots_low',
      colors: { skin: '#ffdfc6', hair: '#26262c', shirt: '#8a7563', linen: '#f5f2ec', trousers: '#5a544c', belt: '#3a332c', boots: '#f6f5f2' },
    },
    {
      // 雾蓝清爽：蓬松短发 + 雾蓝夹克杏色T + 深蓝牛仔裤
      hair: 'hair_tousled',
      top: 'top_long',
      bottom: 'bottom_trousers',
      boots: 'boots_low',
      colors: { skin: '#ffdfc6', hair: '#26262c', shirt: '#6d7f8c', linen: '#f2e8d8', trousers: '#3e4d5c', belt: '#2a3540', boots: '#f6f5f2' },
    },
  ],
};

/** 部件隐藏的身体区域（manifest.json 的 hides 语义） */
const HIDES: Record<string, string[]> = {
  top_tee: ['skin_torso', 'skin_armUpperL', 'skin_armUpperR'],
  top_long: ['skin_torso', 'skin_armUpperL', 'skin_armUpperR', 'skin_armLowerL', 'skin_armLowerR'],
  top_tunic: ['skin_torso', 'skin_armUpperL', 'skin_armUpperR', 'skin_armLowerL', 'skin_armLowerR'],
  bottom_trousers: ['skin_legUpperL', 'skin_legUpperR', 'skin_legLowerL', 'skin_legLowerR'],
  bottom_shorts: ['skin_legUpperL', 'skin_legUpperR'],
  boots_low: ['skin_footL', 'skin_footR'],
  boots_tall: ['skin_footL', 'skin_footR'],
};

/** T-pose 身高（模型单位）→ 场景缩放系数 */
const MODEL_H = 2.155;
const SCALE_OF = { cartoon: 0.95 / MODEL_H, real: 1.04 / MODEL_H };
/** 关键动画锚点（离线 FK 采样所得，模型单位） */
const SIT_HIP_Y = 0.481;
const SIT_HIP_Z = -0.397;
const FLOOR_SIT_Z = 0.119;

interface KitClip {
  name: string;
  file: 'movement' | 'core' | 'sim' | 'tools' | 'ours';
  timeScale?: number;
}

const CLIP = {
  idle: { name: 'Idle_A', file: 'core' } as KitClip,
  walk: { name: 'Walking_A', file: 'movement', timeScale: 1.35 } as KitClip,
  sit: { name: 'Sit_Chair_Idle', file: 'sim' } as KitClip,
  lie: { name: 'Lie_Idle', file: 'sim' } as KitClip,
  floorSit: { name: 'Sit_Floor_Idle', file: 'sim' } as KitClip,
  cook: { name: 'Working_B', file: 'tools' } as KitClip,
  drink: { name: 'Use_Item', file: 'core' } as KitClip,
  wave: { name: 'Waving', file: 'sim' } as KitClip,
};

/** 姿势 → 动画 clip + 坐姿族判定（与 Char3D 语义对齐） */
function poseToClip(pose: CharPose, moving: boolean): KitClip {
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
      return CLIP.lie;
    case 'bath':
      return CLIP.floorSit;
    case 'shower':
      return CLIP.idle;
    case 'cook':
      return CLIP.cook;
    case 'drink':
      return CLIP.drink;
    default:
      return moving ? CLIP.walk : CLIP.idle;
  }
}

const SEATED: CharPose[] = ['sit', 'eat', 'piano', 'guitar', 'makeup', 'mirror', 'read'];

export interface CharKit3DProps {
  rt: CharRT;
  who: 'me' | 'partner';
  hide?: boolean;
  style?: 'cartoon' | 'real';
  poseRef?: RefObject<{ pose: CharPose; y: number }>;
  outfit?: number;
  carryRef?: RefObject<{ cup: boolean; coffee?: boolean }>;
}

/** 手持小杯（咖啡带热气 / 冰饮带吸管），挂在 handslotr 骨上 */
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
  // 热气 sprite
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

/** 睡觉 Zzz 贴图 */
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

/** 泡泡材质（共享） */
function bubbleMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: '#eaf6ff', transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.05 });
}

export default function CharKit3D({ rt, who, hide, style = 'cartoon', poseRef, outfit = 0, carryRef }: CharKit3DProps) {
  const holder = useRef<THREE.Group>(null);
  const scaler = useRef<THREE.Group>(null);
  const effOutfit = ((outfit % OUTFITS[who].length) + OUTFITS[who].length) % OUTFITS[who].length;
  const conf = OUTFITS[who][effOutfit];
  const confKey = `${conf.hair}|${conf.top}|${conf.bottom}|${conf.boots}|${Object.entries(conf.colors).map(([k, v]) => `${k}:${v}`).join(';')}`;

  /* ---------- 资产加载（useGLTF 共享缓存 + 按实例 clone） ---------- */
  const bodyGltf = useGLTF(`${KIT}/body.glb`);
  const hairGltf = useGLTF(`${KIT}/${conf.hair}.glb`);
  const topGltf = useGLTF(`${KIT}/${conf.top}.glb`);
  const bottomGltf = useGLTF(`${KIT}/${conf.bottom}.glb`);
  const bootsGltf = useGLTF(`${KIT}/${conf.boots}.glb`);
  const animGltfs = {
    movement: useGLTF(`${KIT}/anim-movement.glb`),
    core: useGLTF(`${KIT}/anim-core.glb`),
    sim: useGLTF(`${KIT}/anim-sim.glb`),
    tools: useGLTF(`${KIT}/anim-tools.glb`),
    ours: useGLTF(`${KIT}/anim-ours.glb`),
  };

  /** 组装：clone 各部件 → 材质独立 + 换色 → 隐藏被覆盖区域 → 收集骨架根 */
  const kit = useMemo(() => {
    const scale = SCALE_OF[style];
    const root = new THREE.Group();
    const scal = new THREE.Group();
    scal.scale.setScalar(scale);
    root.add(scal);
    const offs = new THREE.Group();
    scal.add(offs);

    const hideSet = new Set<string>([...(HIDES[conf.top] ?? []), ...(HIDES[conf.bottom] ?? []), ...(HIDES[conf.boots] ?? [])]);
    const heads: THREE.Bone[] = [];
    const handR: THREE.Bone[] = [];
    const mixers: THREE.AnimationMixer[] = [];

    const addPart = (gltf: { scene: THREE.Group }) => {
      const inst = skeletonClone(gltf.scene) as THREE.Group;
      // 材质独立 + 按名换色
      const matMap = new Map<THREE.Material, THREE.Material>();
      inst.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const orig = mesh.material as THREE.MeshStandardMaterial;
        let mat = matMap.get(orig);
        if (!mat) {
          mat = orig.clone();
          matMap.set(orig, mat);
          const hex = conf.colors[orig.name as keyof typeof conf.colors];
          if (orig.name && hex && (mat as THREE.MeshStandardMaterial).color) (mat as THREE.MeshStandardMaterial).color.set(hex);
        }
        mesh.material = mat;
        mesh.castShadow = true;
        mesh.frustumCulled = false;
      });
      inst.traverse((o) => {
        const b = o as THREE.Bone;
        if (!b.isBone) return;
        const n = b.name.toLowerCase();
        if (n === 'head') heads.push(b);
        if (n === 'handslotr') handR.push(b);
      });
      // 部件自己的骨架根：找到带骨骼的顶层挂点（SkinnedMesh 的骨架 root）
      let armRoot: THREE.Object3D | null = null;
      inst.traverse((o) => {
        const sm = o as THREE.SkinnedMesh;
        if (!armRoot && sm.isSkinnedMesh && sm.skeleton) armRoot = sm.skeleton.bones[0]?.parent ?? inst;
      });
      if (!armRoot) armRoot = inst;
      const mixer = new THREE.AnimationMixer(inst);
      mixers.push(mixer);
      offs.add(inst);
      return { inst, mixer, armRoot };
    };

    const bodyPart = addPart(bodyGltf);
    addPart(hairGltf);
    addPart(topGltf);
    addPart(bottomGltf);
    addPart(bootsGltf);

    // 隐藏被衣物覆盖的素体区域
    bodyPart.inst.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && hideSet.has(mesh.name)) mesh.visible = false;
    });

    // Q版大头：头骨放大（头发刚体绑定会跟随）
    const headScale = style === 'cartoon' ? 1.22 : 1;
    for (const h of heads) h.scale.setScalar(headScale);

    // 手持杯挂右手 slot
    const cup = buildCup();
    cup.group.scale.setScalar(1 / Math.max(scale, 0.0001)); // 抵消整体缩放，杯子物理尺寸恒定
    if (handR[0]) handR[0].add(cup.group);

    // Zzz（躺床）与泡泡（泡澡/淋浴）
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
      const r = 0.018 + (i % 3) * 0.008;
      b.scale.setScalar(r);
      bubbles.add(b);
    }
    offs.add(bubbles);

    // 化妆星星
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

    const clipIndex = new Map<string, THREE.AnimationClip[]>();
    for (const [, g] of Object.entries(animGltfs)) {
      for (const c of g.animations) {
        const arr = clipIndex.get(c.name) ?? [];
        arr.push(c);
        clipIndex.set(c.name, arr);
      }
    }

    return { root, offs, mixers, clipIndex, cup, zzz, zzzSprites, bubbles, spark, sparkSprites, scale };
  }, [who, confKey, style]);

  /* ---------- 动作状态机 ---------- */
  const scene_ = useRef<{ clip: KitClip | null }>({ clip: null });

  useEffect(() => {
    return () => {
      for (const m of kit.mixers) m.stopAllAction();
    };
  }, [kit]);

  const switchClip = (clip: KitClip) => {
    if (scene_.current.clip?.name === clip.name) return;
    scene_.current.clip = clip;
    const clips = kit.clipIndex.get(clip.name) ?? [];
    if (!clips.length) return;
    for (const m of kit.mixers) {
      const next = m.clipAction(clips[0]);
      next.setEffectiveTimeScale(clip.timeScale ?? 1);
      next.setEffectiveWeight(1);
      m.stopAllAction();
      next.reset().fadeIn(0.22).play();
    }
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

    // 动画切换 + 每帧驱动
    switchClip(poseToClip(pose, rt.moving));
    for (const m of kit.mixers) m.update(dt);

    // 垂直/前后锚定：坐姿族落在座位上（臀部对齐 Char3D 的 hips=poseY 语义）
    const seated = SEATED.includes(pose);
    const targetOffY = seated ? Math.max(0.02, poseY - SIT_HIP_Y * s) : 0;
    const targetOffZ = seated ? -SIT_HIP_Z * s : 0;
    kit.offs.position.y = THREE.MathUtils.damp(kit.offs.position.y, targetOffY, 9, dt);
    kit.offs.position.z = THREE.MathUtils.damp(kit.offs.position.z, targetOffZ, 9, dt);

    if (pose === 'lie') {
      // 躺床：动画自带躺平（头朝 -z），整体抬到床面
      kit.offs.position.y = THREE.MathUtils.damp(kit.offs.position.y, poseY + 0.012 * s, 9, dt);
    } else if (pose === 'bath') {
      // 泡澡：坐进浴缸（下沉让水位盖过大腿），衣服由 undressed 隐藏
      kit.offs.position.y = THREE.MathUtils.damp(kit.offs.position.y, Math.max(0.02, poseY - 0.16 * s), 9, dt);
    } else if (pose === 'shower') {
      kit.offs.position.y = THREE.MathUtils.damp(kit.offs.position.y, Math.max(0.02, poseY), 9, dt);
    }

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

    // Zzz（offs 空间即模型单位，scal 统一缩放；躺姿头部在 z≈-0.7）
    kit.zzz.visible = pose === 'lie';
    if (pose === 'lie') {
      kit.zzzSprites.forEach((sp, i) => {
        const ph = (t * 0.42 + i * 0.34) % 1;
        sp.position.set(0.05 * i, 0.46 + i * 0.13 + ph * 0.28, -0.72 - i * 0.04);
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
        b.position.set(Math.cos(a) * rad * (0.7 + (i % 3) * 0.18), 0.42 + Math.sin(t * 1.6 + i * 1.7) * 0.09 + (i % 4) * 0.07, Math.sin(a) * rad * (0.7 + ((i + 1) % 3) * 0.18));
      });
    }

    // 化妆星星
    kit.spark.visible = pose === 'makeup';
    if (pose === 'makeup') {
      kit.sparkSprites.forEach((sp, i) => {
        const a = t * 1.25 + (i / kit.sparkSprites.length) * Math.PI * 2;
        sp.position.set(Math.cos(a) * 0.3, 1.05 + Math.sin(t * 2.1 + i * 1.4) * 0.055, Math.sin(a) * 0.3);
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
for (const f of ['body', 'hair_long', 'hair_bun', 'hair_ponytail', 'hair_short', 'hair_tousled', 'top_tee', 'top_long', 'top_tunic', 'bottom_trousers', 'bottom_shorts', 'boots_low', 'boots_tall']) {
  useGLTF.preload(`${KIT}/${f}.glb`);
}
for (const f of ['anim-movement', 'anim-core', 'anim-sim', 'anim-tools', 'anim-ours']) {
  useGLTF.preload(`${KIT}/${f}.glb`);
}
