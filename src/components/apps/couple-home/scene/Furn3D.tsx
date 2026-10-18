'use client';

/**
 * 情侣小家 3D —— 单件家具渲染
 *
 * - Kenney GLB 浅色系模型 + 旋转（r 步进 90°）；
 * - 门节点真实开合动画（wardrobe/fridge/washer/sink/nightstand/stove）；
 * - 纸箱类无门节点 → 开门态换模型（glbAlt）；
 * - 灯具/电视/收音机：开 = 灯罩发光 + 点光（夜晚更亮）；
 * - playful 点击弹跳；洗衣机运转轻微抖动 + 状态灯；
 * - 编辑模式选中光圈 + 拖拽（父组件接管指针）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { CatalogEntry, FurnitureItem, HomeMode } from '../types';
import { animateDoors, cloneFurniture, ensureModel, type FurnModel } from './model-kit';
import { PLAY_COOLDOWN } from '../catalog';

export interface Furn3DProps {
  item: FurnitureItem;
  entry: CatalogEntry;
  night: boolean;
  mode: HomeMode;
  selected: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>, item: FurnitureItem) => void;
  onTap: (item: FurnitureItem) => void;
}

/** useGLTF 之外的轻量加载钩子（不依赖 suspense） */
function useFurnModel(url: string | undefined, cloneMats: boolean, yaw?: number): FurnModel | null {
  const [model, setModel] = useState<FurnModel | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    ensureModel(url)
      .then(() => {
        if (alive) setModel(cloneFurniture(url, { cloneMats, yaw }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url, cloneMats, yaw]);
  return model;
}

export default function Furn3D({ item, entry, night, mode, selected, onPointerDown, onTap }: Furn3DProps) {
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const bounceAt = useRef(0);
  const [hovered, setHovered] = useState(false);

  const cloneMats = !!entry.acts?.toggle || !!entry.acts?.washer;
  const primary = useFurnModel(entry.glb, cloneMats, entry.yaw);
  const alt = useFurnModel(entry.glbAlt, cloneMats, entry.yaw);
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

  const ringR = Math.max(entry.fp[0], entry.fp[1]) / 2 + 0.16;

  // 电视屏幕（附加发光面板）
  const tvOn = entry.kind === 'tv' && !!item.st?.on;
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
      over: (e: ThreeEvent<PointerEvent>) => {
        // 不 stopPropagation：R3F 合成事件的 stopPropagation 会连带阻断原生事件冒泡，
        // 进而杀掉场景级拖拽/旋转视角的 pointermove 监听
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

  return (
    <group
      ref={group}
      position={[item.x, 0, item.z]}
      rotation={[0, ((item.r ?? 0) * Math.PI) / 2, 0]}
    >
      <group
        ref={inner}
        onPointerDown={handlers.down}
        onClick={handlers.click}
        onPointerOver={handlers.over}
        onPointerOut={handlers.out}
      >
        {model && <primitive object={model.root} />}

        {/* 电视屏幕面板 */}
        {entry.kind === 'tv' && modelSize && (
          <mesh position={[0, modelSize.y * 0.62, modelSize.z / 2 + 0.02]}>
            <planeGeometry args={[modelSize.x * 0.82, modelSize.y * 0.5]} />
            <meshStandardMaterial
              color={tvOn ? '#dceeff' : '#33363b'}
              emissive={tvOn ? '#bfe0ff' : '#000000'}
              emissiveIntensity={tvOn ? (night ? 1.6 : 1.0) : 0}
              roughness={0.3}
            />
          </mesh>
        )}

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

      {/* 选中光圈（编辑模式） */}
      {selected && (
        <mesh ref={ring} position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ringR - 0.06, ringR, 40]} />
          <meshStandardMaterial color="#f2a9bc" emissive="#f2a9bc" emissiveIntensity={0.9} transparent opacity={0.9} />
        </mesh>
      )}

      {/* hover 高亮圈（编辑模式非选中时） */}
      {mode === 'edit' && hovered && !selected && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ringR - 0.04, ringR - 0.01, 40]} />
          <meshStandardMaterial color="#e8e2d2" transparent opacity={0.6} />
        </mesh>
      )}
    </group>
  );
}

/** 交互冷却判断（父组件用） */
export function canPlay(item: FurnitureItem, now: number): boolean {
  return now - (item.st?.lastTouch ?? 0) > PLAY_COOLDOWN * 1000;
}
