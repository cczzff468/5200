'use client';

/**
 * 宠物 3D 视图（v8.0）—— 精选 GLB 模型 + 双层动画系统
 *
 * - 模型层：GLTFLoader（useLoader 缓存）→ SkeletonUtils.clone →
 *   包围盒归一化（精确缩放到 targetH / 脚底贴地 / yawOffset 朝向修正）；
 *   材质贴图保持原样（手绘/毛绒质感是「不假」的关键，不做程序化替换）；
 * - 骨骼动画层（黑猫）：AnimationMixer 循环播放「坐姿舔毛/挠脸」待机动画，
 *   timeScale 随状态阻尼过渡：待机 0.9 / 移动 0.3 / 吃 0.15 / 打盹 0.06 / 开心 2.2；
 * - 刚体动画层（柴犬 + 黑猫通用）：坐姿「盲盒摆件」萌系动画 ——
 *   移动小蹦跳（正弦跳高 + 落地压扁 + 左右微摆）/ 待机呼吸 / 吃饭前倾点头 /
 *   打盹压扁 / 撸宠原地连蹦，目标权重由 Pet3D 写入、帧内阻尼收敛零突变；
 * - 静态柴犬没有骨骼动画，呼吸/蹦跳全靠本层，观感为「有生命的摆件」。
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { PetModel } from '../pet-models';

interface GLTFResult {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export interface PetViewState {
  walk: number;
  run: number;
  eat: number;
  nap: number;
  happy: number;
}

export interface PetViewHandle {
  tick: (t: number, dt: number, s: PetViewState) => void;
}

interface Props {
  model: PetModel;
  /** 就绪回调（模型挂载后触发一次，用于把精确高度带给气泡定位） */
  onReady?: (h: number) => void;
}

const damp = THREE.MathUtils.damp;

const PetModelView = forwardRef<PetViewHandle, Props>(function PetModelView({ model, onReady }, ref) {
  const gltf = useLoader(GLTFLoader, model.glb) as unknown as GLTFResult;

  const root = useRef<THREE.Group>(null);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const clipSpeed = useRef(0.9);
  /** Pet3D 写入的目标权重；useFrame 内阻尼收敛到 anim */
  const target = useRef<PetViewState>({ walk: 0, run: 0, eat: 0, nap: 0, happy: 0 });
  const anim = useRef({
    walk: 0, run: 0, eat: 0, nap: 0, happy: 0,
    phase: 0, hopY: 0, breathe: 0,
    lean: 0, squash: 0, sway: 0,
  });

  useImperativeHandle(ref, () => ({
    tick: (_t, _dt, s) => {
      target.current = s;
    },
  }), []);

  // —— 组装模型：clone → 归一化 → 骨骼动画（model 切换时重建；纯构建不碰 ref） ——
  const rig = useMemo(() => {
    const g = skeletonClone(gltfSafeScene(gltf)) as THREE.Group;
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.frustumCulled = false; // 蒙皮/缩放后包围盒易误剔除
    });

    // 归一化：整体缩放到 targetH、脚底贴地、朝向修正
    const box = new THREE.Box3().setFromObject(g);
    const h = Math.max(box.max.y - box.min.y, 1e-4);
    g.scale.setScalar(model.targetH / h);
    if (model.yawOffset) g.rotation.y = model.yawOffset;
    const box2 = new THREE.Box3().setFromObject(g);
    g.position.y = -box2.min.y;

    // 骨骼动画（黑猫 Take 001：坐姿舔毛/挠脸）
    let m: THREE.AnimationMixer | null = null;
    if (model.clip && gltf.animations?.length) {
      const clip = gltf.animations.find((c) => c.name === model.clip) ?? gltf.animations[0];
      m = new THREE.AnimationMixer(g);
      m.clipAction(clip).play();
    }
    return { g, mixer: m };
  }, [gltf, model.glb, model.targetH, model.yawOffset, model.clip]);

  const body = rig.g;

  // 把纯构建结果接入 ref + 生命周期（非 render 期）
  useEffect(() => {
    mixer.current = rig.mixer;
    clipSpeed.current = 0.9;
    return () => {
      rig.mixer?.stopAllAction();
      mixer.current = null;
    };
  }, [rig]);

  // 就绪回调（挂载后把精确高度带给气泡定位）
  useEffect(() => {
    onReady?.(model.targetH);
  }, [body]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    const g = root.current;
    if (!g) return;
    const A = anim.current;
    const T = target.current;

    // —— 骨骼动画 timeScale 阻尼过渡 ——
    const tgtClip =
      T.happy > 0.5 ? 2.2 : T.nap > 0.5 ? 0.06 : T.eat > 0.5 ? 0.15 : T.walk + T.run > 0.5 ? 0.3 : 0.9;
    clipSpeed.current = damp(clipSpeed.current, tgtClip, 4, dt);
    const mx = mixer.current;
    if (mx) mx.timeScale = clipSpeed.current;

    // —— 刚体动画层：权重阻尼 ——
    A.walk = damp(A.walk, T.walk, 6, dt);
    A.run = damp(A.run, T.run, 6, dt);
    A.eat = damp(A.eat, T.eat, 5, dt);
    A.nap = damp(A.nap, T.nap, 4, dt);
    A.happy = damp(A.happy, T.happy, 3.2, dt);

    const moving = Math.max(A.walk, A.run);
    const hop = model.hop ?? { freq: 7, height: 0.05 };

    // 蹦跳相位（跑 1.35 倍步频；开心连蹦更快）
    if (moving > 0.05 || A.happy > 0.05) A.phase += dt * hop.freq * (1 + A.run * 0.35 + A.happy * 0.55);
    const targetHopY =
      moving > 0.05
        ? Math.abs(Math.sin(A.phase)) * hop.height * (1 + A.run * 0.35)
        : 0;
    const happyHop = A.happy > 0.05 ? Math.abs(Math.sin(A.phase * 1.25)) * (hop.height + 0.02) * A.happy : 0;
    A.hopY = damp(A.hopY, targetHopY + happyHop, 26, dt);

    // 落地压扁（贴地时明显）+ 左右摇摆
    const hopN = Math.min(1, A.hopY / (hop.height + 0.02));
    const tgtSquash = -0.05 * (1 - hopN) * Math.min(1, moving + A.happy);
    A.squash = damp(A.squash, tgtSquash, 18, dt);
    const tgtSway = Math.sin(A.phase * 2) * 0.05 * Math.min(1, moving);
    A.sway = damp(A.sway, tgtSway, 16, dt);

    // 待机呼吸（打盹时更慢更深）
    const brSpd = A.nap > 0.5 ? 1.1 : 2.3;
    const brAmp = A.nap > 0.5 ? 0.02 : 0.011;
    A.breathe = Math.sin(t * brSpd) * brAmp;

    // 吃饭前倾 + 点头
    const tgtLean = A.eat * 0.32 + (A.eat > 0.05 ? Math.sin(t * 5.5) * 0.05 * A.eat : 0);
    A.lean = damp(A.lean, tgtLean, 7, dt);

    // —— 应用到根节点 ——
    const napSq = -0.07 * A.nap;
    const sy = 1 + A.breathe + A.squash + napSq;
    const sxz = 1 - (A.breathe + A.squash + napSq) * 0.62;
    g.scale.set(sxz, Math.max(0.55, sy), sxz);
    g.position.y = A.hopY;
    g.rotation.z = A.sway;
    g.rotation.x = A.lean + 0.05 * A.nap;
  });

  return (
    <group ref={root}>
      <primitive object={body} />
    </group>
  );
});

/** useLoader 结果兜底（理论上不会触发，防 gltf.scene 缺失时白屏） */
function gltfSafeScene(gltf: GLTFResult): THREE.Group {
  if (!gltf?.scene) {
    const fallback = new THREE.Group();
    return fallback;
  }
  return gltf.scene as THREE.Group;
}

export default PetModelView;
