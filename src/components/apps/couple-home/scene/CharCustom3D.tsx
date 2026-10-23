'use client';

/* eslint-disable react-hooks/immutability -- R3F 动画需要每帧原地修改 three 对象 */

/**
 * 情侣小家 3D —— 自定义捏人角色（v7 专属小人）
 *
 * - 资产：用户照片 AI 生成的高精度雕塑 → 自动绑骨（scripts/rig-custom.mjs）→
 *   custom-nan.glb（男主）/ custom-nv.glb（女主）。骨架命名/层级与 KayKit Rig_Medium
 *   完全一致（23 骨），因此可直接播放 KayKit 动画库。
 * - 骨骼差异处理：
 *     1) 位移轨道重映射（rest 锚定 + 按骨长比缩放）；hips/root 定死 rest，
 *      姿势高度改由本组件按姿态程序化控制（坐/躺/泡澡锚点）。
 *   2) 大臂做「以 their-idle 为基准的世界增量重定向」：
 *      corrected = (curWorld · theirIdleWorld⁻¹) · myBindWorld —— KayKit idle 的
 *      39° 外张手臂恰好映射到绑定方向（idle 零蒙皮变形），走/跑/挥手围绕绑定自然摆动。
 *   3) 前臂/手保持 clip 原值（保留手肘自然弯曲）。
 * - 效果与 CharKit3D 对齐：睡觉 Zzz / 泡澡泡泡 / 化妆星星 / 手持咖啡果汁。
 */

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharPose, CharRT } from '../types';
import rigNan from './char-custom-rig-nan.json';
import rigNv from './char-custom-rig-nv.json';

interface RigJson {
  H: number;
  minY: number;
  anchors: Record<string, { hipY: number; hipZ: number; headZ: number; footY: number }>;
  remap: Record<string, { rest: number[]; kay: number[]; k: number }>;
  corr: Record<string, number[]>;
  hierarchy: { name: string; parent: string | null }[];
}
const RIG_JSON: Record<'me' | 'partner', RigJson> = {
  me: rigNv as unknown as RigJson,
  partner: rigNan as unknown as RigJson,
};

const MODEL_FILE: Record<'me' | 'partner', string> = { me: 'custom-nv', partner: 'custom-nan' };
const ANIM_FILES = ['anim-core', 'anim-movement', 'anim-sim', 'anim-tools', 'anim-ours'] as const;

/** 姿势 → clip（与 CharKit3D 语义一致） */
interface ClipRef { name: string; file: (typeof ANIM_FILES)[number]; timeScale?: number }
const CLIP = {
  idle: { name: 'Idle_A', file: 'anim-core' } as ClipRef,
  walk: { name: 'Walking_A', file: 'anim-movement', timeScale: 1.35 } as ClipRef,
  sit: { name: 'Sit_Chair_Idle', file: 'anim-sim' } as ClipRef,
  lie: { name: 'Lie_Idle', file: 'anim-sim' } as ClipRef,
  floorSit: { name: 'Sit_Floor_Idle', file: 'anim-sim' } as ClipRef,
  cook: { name: 'Working_B', file: 'anim-tools' } as ClipRef,
  drink: { name: 'Use_Item', file: 'anim-core' } as ClipRef,
  wave: { name: 'Waving', file: 'anim-sim' } as ClipRef,
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

/** KayKit idle 大臂的世界四元数（实测采样，重定向基准） */
const THEIR_IDLE: Record<string, [number, number, number, number]> = {
  upperarml: [-0.5099, -0.1255, -0.64, 0.5609],
  upperarmr: [-0.457, 0.0592, 0.6315, 0.6236],
};

/** GLTFLoader 会把节点名中的 . [ ] : / 空格去掉（upperarm.l → upperarml） */
const san = (s: string) => s.replace(/[\s.[\]:/]/g, '');

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

export interface CharCustom3DProps {
  rt: CharRT;
  who: 'me' | 'partner';
  hide?: boolean;
  style?: 'cartoon' | 'real';
  poseRef?: RefObject<{ pose: CharPose; y: number }>;
  /** 衣柜穿搭编号：自定义角色暂无换装，保留接口兼容 */
  outfit?: number;
  carryRef?: RefObject<{ cup: boolean; coffee?: boolean }>;
}

export default function CharCustom3D({ rt, who, hide, style = 'cartoon', poseRef, carryRef }: CharCustom3DProps) {
  const holder = useRef<THREE.Group>(null);
  const scaler = useRef<THREE.Group>(null);
  const rig = RIG_JSON[who];
  const H = rig.H;

  /* ---------- 资产加载 ---------- */
  const modelGltf = useGLTF(`/couple-home/${MODEL_FILE[who]}.glb`);
  const animGltfs = {
    'anim-core': useGLTF('/couple-home/kit/anim-core.glb'),
    'anim-movement': useGLTF('/couple-home/kit/anim-movement.glb'),
    'anim-sim': useGLTF('/couple-home/kit/anim-sim.glb'),
    'anim-tools': useGLTF('/couple-home/kit/anim-tools.glb'),
    'anim-ours': useGLTF('/couple-home/kit/anim-ours.glb'),
  };

  /** 组装：clone 模型 → 重映射动画 clip → 效果挂件 */
  const kit = useMemo(() => {
    const target = style === 'cartoon' ? 0.95 : 1.04;
    const scale = target / H;
    const root = new THREE.Group();
    const scal = new THREE.Group();
    scal.scale.setScalar(scale);
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

    // 骨骼索引
    const boneMap = new Map<string, THREE.Bone>();
    inst.traverse((o) => {
      if ((o as THREE.Bone).isBone) boneMap.set(o.name, o as THREE.Bone);
    });

    // 绑定姿态世界四元数（clone 刚出来 = rest，必须在任何动画更新前采样）
    inst.updateMatrixWorld(true);
    const myBind: Record<string, THREE.Quaternion> = {};
    for (const n of Object.keys(THEIR_IDLE)) {
      const b = boneMap.get(n);
      if (b) myBind[n] = b.getWorldQuaternion(new THREE.Quaternion());
    }
    const theirIdleQ: Record<string, THREE.Quaternion> = {};
    for (const [n, v] of Object.entries(THEIR_IDLE)) {
      theirIdleQ[n] = new THREE.Quaternion(...v).normalize();
    }

    // 手持杯挂右手（scale 抵消整体缩放，杯子物理尺寸恒定）
    const cup = buildCup();
    cup.group.scale.setScalar(1 / Math.max(scale, 0.0001));
    const handR = boneMap.get('handr') ?? boneMap.get('hand.r');
    if (handR) {
      cup.group.position.set(0, -0.02, 0.03);
      handR.add(cup.group);
    }

    // Zzz / 泡泡 / 星星（offs 空间 = 模型单位）
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

    // 重映射动画 clip：位移轨道 rest 锚定 + 骨长比缩放；hips/root 定死 rest
    const remap: Record<string, { rest: number[]; kay: number[]; k: number }> = {};
    for (const [k, v] of Object.entries(rig.remap)) remap[san(k)] = v;
    const clips: THREE.AnimationClip[] = [];
    for (const [, g] of Object.entries(animGltfs)) {
      for (const src of g.animations) {
        const c = src.clone();
        for (const tr of c.tracks) {
          if (!tr.name.endsWith('.position')) continue;
          const bn = tr.name.slice(0, -9);
          const r = remap[bn];
          if (!r) continue;
          const pinned = bn === 'hips' || bn === 'root';
          for (let i = 0; i < tr.times.length; i++) {
            if (pinned) {
              tr.values[i * 3] = r.rest[0];
              tr.values[i * 3 + 1] = r.rest[1];
              tr.values[i * 3 + 2] = r.rest[2];
            } else {
              tr.values[i * 3] = r.rest[0] + (tr.values[i * 3] - r.kay[0]) * r.k;
              tr.values[i * 3 + 1] = r.rest[1] + (tr.values[i * 3 + 1] - r.kay[1]) * r.k;
              tr.values[i * 3 + 2] = r.rest[2] + (tr.values[i * 3 + 2] - r.kay[2]) * r.k;
            }
          }
        }
        clips.push(c);
      }
    }

    const restHipsY = rig.remap['hips'] ? rig.remap['hips'].rest[1] : 0.617 * H;
    return {
      root, offs, inst, boneMap, myBind, theirIdleQ, cup, zzz, zzzSprites, bubbles, spark, sparkSprites,
      clips, mixer: new THREE.AnimationMixer(inst), scale, restHipsY,
    };
  }, [who, style]);

  const scene_ = useRef<{ clip: ClipRef | null }>({ clip: null });

  useEffect(() => {
    return () => {
      kit.mixer.stopAllAction();
    };
  }, [kit]);

  const switchClip = (clip: ClipRef) => {
    if (scene_.current.clip?.name === clip.name) return;
    scene_.current.clip = clip;
    const found = kit.clips.filter((c) => c.name === clip.name);
    if (!found.length) return;
    const next = kit.mixer.clipAction(found[0]);
    next.setEffectiveTimeScale(clip.timeScale ?? 1);
    next.setEffectiveWeight(1);
    kit.mixer.stopAllAction();
    next.reset().fadeIn(0.22).play();
  };

  /** 大臂重定向（以 their-idle 为基准的世界增量 → 我的绑定方向） */
  const _pq = new THREE.Quaternion();
  const _delta = new THREE.Quaternion();
  const rebase = (boneName: string) => {
    const bone = kit.boneMap.get(boneName);
    const bind = kit.myBind[boneName];
    const idle = kit.theirIdleQ[boneName];
    if (!bone || !bind || !idle) return;
    const parentW = bone.parent ? bone.parent.getWorldQuaternion(_pq.clone()) : new THREE.Quaternion();
    const curW = parentW.clone().multiply(bone.quaternion);
    const delta = curW.clone().multiply(idle.clone().invert());
    const newW = delta.multiply(bind.clone());
    bone.quaternion.copy(parentW.clone().invert().multiply(newW));
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
    const H = rig.H;

    // 动画切换 + 每帧驱动
    switchClip(poseToClip(pose, rt.moving));
    kit.mixer.update(dt);

    // 大臂重定向（躺姿身体水平，世界增量语义失效 → 跳过）
    if (pose !== 'lie') {
      rebase('upperarml');
      rebase('upperarmr');
    }

    // 姿势锚定：hips 骨位置 + 整体偏移
    const hips = kit.boneMap.get('hips');
    const seated = SEATED.includes(pose);
    let offY = 0;
    let offZ = 0;
    if (hips) {
      let hy = kit.restHipsY;
      let hz = 0;
      if (pose === 'lie') {
        hy = 0.068 * H;
        hz = 0.066 * H;
        offY = poseY + 0.005;
      } else if (pose === 'floorSit') {
        hy = 0.1 * H;
        offY = poseY;
      } else if (pose === 'bath') {
        hy = 0.1 * H;
        offY = Math.max(0.02, poseY - 0.05 * s);
      } else if (seated) {
        offY = Math.max(0.02, poseY - kit.restHipsY * s);
      } else if (rt.moving) {
        // 走路小起伏（程序化，弥补被定死的 hips 位移轨道）
        hy = kit.restHipsY + Math.abs(Math.sin(t * 7.5)) * 0.012 * H;
      }
      hips.position.y = THREE.MathUtils.damp(hips.position.y, hy, 10, dt);
      hips.position.z = THREE.MathUtils.damp(hips.position.z, hz, 10, dt);
    }
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

    // Zzz（躺床：头朝 -z，头部在 z≈-0.40H）
    kit.zzz.visible = pose === 'lie';
    if (pose === 'lie') {
      kit.zzzSprites.forEach((sp, i) => {
        const ph = (t * 0.42 + i * 0.34) % 1;
        sp.position.set(0.05 * i, 0.46 * H + i * 0.11 * H + ph * 0.24 * H, -0.44 * H - i * 0.035 * H);
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
useGLTF.preload('/couple-home/custom-nan.glb');
useGLTF.preload('/couple-home/custom-nv.glb');
for (const f of ANIM_FILES) useGLTF.preload(`/couple-home/kit/${f}.glb`);
