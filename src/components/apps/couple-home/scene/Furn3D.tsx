'use client';

/**
 * 情侣小家 3D —— 单件家具渲染（v4）
 *
 * - Kenney GLB 白色系模型 + 任意角度水平旋转（ry）+ 俯仰（rx）+ 抬升（y）；
 * - tv：程序化美颜电视（TV3D）；
 * - 门节点真实开合动画（wardrobe/fridge/washer/sink/nightstand/stove）；
 * - 纸箱类无门节点 → 开门态换模型（glbAlt）；
 * - 灯具/收音机：开 = 灯罩发光 + 点光（夜晚更亮）；
 * - playful 点击弹跳；洗衣机运转轻微抖动 + 状态灯；
 * - 编辑模式：选中光圈（移动模式绿色）+ 拖拽（父组件接管指针）+ 用户调色 tint。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { CatalogEntry, FurnitureItem, HomeMode } from '../types';
import { animateDoors, cloneFurniture, ensureModel, type FurnModel } from './model-kit';
import TV3D from './TV3D';
import { Aircon3D, PhotoFrame3D, PlushBunny3D, PlushDuck3D, Polaroid3D, Vanity3D, WallPhoto3D } from './Extras3D';

export interface Furn3DProps {
  item: FurnitureItem;
  entry: CatalogEntry;
  night: boolean;
  mode: HomeMode;
  selected: boolean;
  /** 移动模式激活（选中光圈变绿，提示可拖动画面搬运） */
  moving?: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>, item: FurnitureItem) => void;
  onTap: (item: FurnitureItem) => void;
}

/** useGLTF 之外的轻量加载钩子（不依赖 suspense；tint 变化时重新克隆） */
function useFurnModel(
  url: string | undefined,
  cloneMats: boolean,
  yaw: number | undefined,
  tint: string | undefined,
  scale: [number, number, number] | undefined,
): FurnModel | null {
  const [model, setModel] = useState<FurnModel | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    ensureModel(url)
      .then(() => {
        if (alive) setModel(cloneFurniture(url, { cloneMats, yaw, tint, scale }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url, cloneMats, yaw, tint, scale]);
  return model;
}

export default function Furn3D({
  item,
  entry,
  night,
  mode,
  selected,
  moving,
  onPointerDown,
  onTap,
}: Furn3DProps) {
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const bounceAt = useRef(0);
  const [hovered, setHovered] = useState(false);

  const isTV = entry.kind === 'tv';
  const cloneMats = !!entry.acts?.toggle || !!entry.acts?.washer;
  const primary = useFurnModel(isTV ? undefined : entry.glb, cloneMats, entry.yaw, item.col, entry.scale);
  const alt = useFurnModel(isTV ? undefined : entry.glbAlt, cloneMats, entry.yaw, item.col, entry.scale);
  const useAlt = !!entry.glbAlt && !!item.st?.open;

  const model = useAlt ? alt ?? primary : primary;

  // 灯罩发光（toggle 家具材质已克隆，可独立调光）
  useEffect(() => {
    if (!model || !entry.acts?.toggle) return;
    const on = !!item.st?.on;
    model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats as THREE.MeshStandardMaterial[]) {
        if (mat.name === 'lamp' || mat.name === 'glass') {
          mat.emissive = new THREE.Color('#ffd98f');
          mat.emissiveIntensity = on ? (night ? 1.8 : 0.9) : 0;
        }
      }
    });
  }, [model, entry.acts?.toggle, item.st?.on, night]);

  // playful 点击 → 弹跳
  useEffect(() => {
    if (item.st?.lastTouch) bounceAt.current = performance.now();
  }, [item.st?.lastTouch]);

  // 洗衣机洗好提醒
  const washDot = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame((state, dt) => {
    if (!model) return;
    // 门动画
    animateDoors(model.doors, !!item.st?.open, dt);
    // 弹跳
    if (inner.current) {
      const since = (performance.now() - bounceAt.current) / 1000;
      if (since >= 0 && since < 0.55) {
        const k = Math.sin(since * 16) * Math.max(0, 1 - since / 0.55);
        inner.current.scale.set(1 + k * 0.06, 1 + k * 0.09, 1 + k * 0.06);
        inner.current.position.y = Math.abs(k) * 0.06;
      } else if (inner.current.scale.x !== 1) {
        inner.current.scale.set(1, 1, 1);
        inner.current.position.y = 0;
      }
    }
    // 洗衣机运转：轻微抖动 + 呼吸状态灯
    if (entry.acts?.washer && group.current) {
      if (item.st?.washing) {
        group.current.position.x = item.x + Math.sin(state.clock.elapsedTime * 30) * 0.004;
        if (washDot.current) {
          const m = washDot.current.material as THREE.MeshStandardMaterial;
          m.emissiveIntensity = 1.2 + Math.sin(state.clock.elapsedTime * 6) * 0.8;
        }
      } else {
        group.current.position.x = item.x;
        if (washDot.current) {
          const m = washDot.current.material as THREE.MeshStandardMaterial;
          m.color = new THREE.Color(item.st?.washDone ? '#9fdcae' : '#d9d9d4');
          m.emissive = new THREE.Color(item.st?.washDone ? '#7fd69a' : '#000000');
          m.emissiveIntensity = item.st?.washDone ? 1.2 : 0;
        }
      }
    }
    // 选中光圈呼吸
    if (ring.current) {
      ring.current.rotation.z = state.clock.elapsedTime * 0.8;
      const s = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.04;
      ring.current.scale.set(s, s, 1);
    }
  });

  const ringR = Math.max(entry.fp[0], entry.fp[1]) / 2 + 0.18;
  /** 选中圈贴地面（抬升家具的光圈投影到地板） */
  const ringY = -(item.y ?? 0) + 0.025;

  const modelSize = model?.size;

  const handlers = useMemo(
    () => ({
      down: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onPointerDown(e, item);
      },
      click: (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > 8) return; // 拖拽后不触发点击
        onTap(item);
      },
      over: () => {
        setHovered(true);
        document.body.style.cursor = mode === 'edit' ? 'grab' : 'pointer';
      },
      out: () => {
        setHovered(false);
        document.body.style.cursor = 'auto';
      },
    }),
    [item, onPointerDown, onTap, mode],
  );

  /**
   * ⚑ 悬停高亮只在「编辑模式 + 精细指针（鼠标）」下挂载。
   * R3F 对带 Over/Out 处理器的对象每次 pointermove 都会递归射线检测 ——
   * 生活模式（触屏）挂了全部家具 GLB，每帧滑动都要扫完整场景，真机上直接把滑动事件拖死。
   * 门控后生活/编辑触屏模式的 pointermove 射线开销归零，滑动视角恢复丝滑。
   */
  const finePointer = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches,
    [],
  );
  const hoverHandlers =
    mode === 'edit' && finePointer
      ? { onPointerOver: handlers.over, onPointerOut: handlers.out }
      : {};

  return (
    <group
      ref={group}
      position={[item.x, item.y ?? 0, item.z]}
      rotation={[item.rx ?? 0, item.ry ?? 0, 0]}
    >
      <group
        ref={inner}
        onPointerDown={handlers.down}
        onClick={handlers.click}
        {...hoverHandlers}
      >
        {model && <primitive object={model.root} />}

        {/* 电视（程序化美颜大屏） */}
        {isTV && <TV3D on={!!item.st?.on} night={night} col={item.col} />}

        {/* 立体壁挂空调（程序化建模：导风板摆动 + 冷风丝） */}
        {entry.kind === 'aircon' && <Aircon3D on={!!item.st?.on} night={night} col={item.col} />}

        {/* 立式相框（程序化建模：手机上传照片，永久保存） */}
        {entry.kind === 'photoFrame' && <PhotoFrame3D col={item.col} photo={item.st?.photo} />}

        {/* 挂墙相框（竖版/横版） + 拍立得 */}
        {entry.kind === 'photoWall' && <WallPhoto3D col={item.col} photo={item.st?.photo} />}
        {entry.kind === 'photoWallWide' && <WallPhoto3D col={item.col} photo={item.st?.photo} wide />}
        {entry.kind === 'polaroid' && <Polaroid3D col={item.col} photo={item.st?.photo} />}

        {/* 毛绒玩偶 ×2 + 梳妆台（程序化建模） */}
        {entry.kind === 'plushBunny' && <PlushBunny3D col={item.col} />}
        {entry.kind === 'plushDuck' && <PlushDuck3D col={item.col} />}
        {entry.kind === 'vanity' && <Vanity3D col={item.col} />}

        {/* 洗衣机状态灯 */}
        {entry.acts?.washer && modelSize && (
          <mesh ref={washDot} position={[modelSize.x * 0.32, modelSize.y * 0.78, modelSize.z / 2 + 0.01]}>
            <sphereGeometry args={[0.035, 10, 10]} />
            <meshStandardMaterial color="#d9d9d4" emissive="#7fd69a" emissiveIntensity={0} />
          </mesh>
        )}
      </group>

      {/* 灯光（开着才亮；夜晚更暖） */}
      {entry.light && item.st?.on && modelSize && (
        <pointLight
          position={[0, entry.light.y, 0]}
          color={entry.light.color ?? '#ffd9a0'}
          intensity={(entry.light.intensity ?? 1) * (night ? 1.5 : 0.55)}
          distance={5.5}
          decay={2}
        />
      )}

      {/* 选中光圈（编辑模式；移动模式变绿） */}
      {selected && (
        <mesh ref={ring} position={[0, ringY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ringR - 0.06, ringR, 40]} />
          <meshStandardMaterial
            color={moving ? '#7fc792' : '#f2a9bc'}
            emissive={moving ? '#7fc792' : '#f2a9bc'}
            emissiveIntensity={0.9}
            transparent
            opacity={0.9}
          />
        </mesh>
      )}

      {/* hover 高亮圈（编辑模式非选中时） */}
      {mode === 'edit' && hovered && !selected && (
        <mesh position={[0, ringY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ringR - 0.04, ringR - 0.01, 40]} />
          <meshStandardMaterial color="#e5e2d8" transparent opacity={0.6} />
        </mesh>
      )}
    </group>
  );
}
