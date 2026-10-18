'use client';

/* eslint-disable react-hooks/immutability -- R3F 动画需要每帧原地修改 three 对象 */

/**
 * 情侣小家 3D —— Q 版小人（程序化几何，非 GLB）
 *
 * - 大头身 Q 萌比例：圆胶囊身体 + 大圆头 + 黑豆眼 + 腮红；
 * - me：浅粉穿搭 + 棕发；ta：浅黄穿搭 + 柔黑发；
 * - 走路弹跳 + 身体微倾；朝向由 GameLoop 每帧写入 ref 并贴到 mesh。
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { CharRT } from '../types';

export interface Char3DProps {
  rt: CharRT;
  who: 'me' | 'partner';
}

const OUTFIT: Record<'me' | 'partner', { cloth: string; hair: string; skin: string }> = {
  me: { cloth: '#f4b3c2', hair: '#6b4a38', skin: '#ffe1cb' }, // 浅粉裙
  partner: { cloth: '#f3d489', hair: '#3c3c40', skin: '#ffdfc8' }, // 浅黄衫
};

function buildChar(who: 'me' | 'partner'): THREE.Group {
  const { cloth, hair, skin } = OUTFIT[who];
  const g = new THREE.Group();

  const mat = (c: string, extra?: Partial<THREE.MeshStandardMaterialParameters>) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, ...extra });

  // 身体（胶囊）
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.3, 8, 16), mat(cloth));
  body.position.y = 0.36;
  body.castShadow = true;
  g.add(body);

  // 头
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 20), mat(skin));
  head.position.y = 0.74;
  head.castShadow = true;
  g.add(head);

  // 头发（帽型半球，罩住后脑勺和头顶）
  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.208, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.62), mat(hair));
  hairMesh.position.set(0, 0.755, -0.022);
  hairMesh.rotation.x = -0.28; // 后仰盖后脑
  hairMesh.castShadow = true;
  g.add(hairMesh);

  // 眼睛（黑豆）
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.023, 10, 10), mat('#2f2f33', { roughness: 0.35 }));
    eye.position.set(sx * 0.072, 0.745, 0.178);
    g.add(eye);
  }
  // 腮红
  for (const sx of [-1, 1]) {
    const blush = new THREE.Mesh(
      new THREE.CircleGeometry(0.024, 12),
      new THREE.MeshStandardMaterial({ color: '#f6b1b8', roughness: 1, transparent: true, opacity: 0.85 }),
    );
    blush.position.set(sx * 0.125, 0.706, 0.16);
    blush.rotation.y = sx * 0.35;
    g.add(blush);
  }

  // 手臂（小胶囊）
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.14, 6, 10), mat(skin));
    arm.position.set(sx * 0.195, 0.4, 0);
    arm.rotation.z = sx * 0.32;
    arm.castShadow = true;
    g.add(arm);
  }

  // 腿（小圆柱）
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.1, 6, 10), mat('#8a8781'));
    leg.position.set(sx * 0.075, 0.1, 0);
    g.add(leg);
  }

  return g;
}

export default function Char3D({ rt, who }: Char3DProps) {
  const root = useMemo(() => buildChar(who), [who]);
  const holder = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!holder.current) return;
    holder.current.position.set(rt.x, 0, rt.z);
    holder.current.rotation.y = rt.heading;
    const t = state.clock.elapsedTime;
    if (rt.moving) {
      // 走路弹跳 + 微倾
      root.position.y = Math.abs(Math.sin(t * 9)) * 0.045;
      root.rotation.x = 0.06;
      root.rotation.z = Math.sin(t * 9) * 0.04;
    } else {
      // 呼吸待机
      root.position.y = Math.sin(t * 2.2) * 0.008 + 0.004;
      root.rotation.x = 0;
      root.rotation.z = 0;
    }
  });

  return <group ref={holder} scale={1}><primitive object={root} /></group>;
}
