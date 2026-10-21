'use client';

/* eslint-disable react-hooks/immutability -- R3F/宠物 AI 需要每帧原地修改对象与运行时状态 */

/**
 * 情侣小家 3D —— 宠物系统（v5.7 F2：领养猫/狗，在客厅溜达）
 *
 * - 两种宠物：cat 橘白猫「团子」/ dog 柴犬「布丁」（纯几何程序化建模，Q 版体型）；
 * - AI：随机目标溜达（撞家具绕开）+ 时不时坐下歇会儿/打盹（头顶冒 💤）；
 * - 点击撸宠：爱心气泡上浮 + 开心转圈（冷却 2.5s 防连点）；
 * - 喂食：碗出现在宠物面前 → 跑过去低头吃（🍚 气泡），吃完碗消失（上层负责发碗/收碗）；
 * - 位置持久化由上层负责（petRT 随存档快照写入 HomeState.pet）。
 * - v5.8 美化：大头 Q 版 + 双高光眨眼、腮红、粉内耳、虎斑纹/柴犬花色、胡须、项圈铃铛、
 *   三节问号卷尾（猫）/ 柴犬卷绒尾（狗）、待机呼吸 + 偶尔抖耳 + 久坐会坐下歇脚（纯视觉增强，AI 不变）。
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { CharRT, FurnitureItem } from '../types';
import { CATALOG, ROOM_X, ROOM_Z, BED_Z0, footprintOf } from '../catalog';

export interface PetData {
  sp: 'cat' | 'dog';
  name: string;
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

/** 宠物配色 */
const PET_COLORS: Record<'cat' | 'dog', { fur: string; belly: string; dark: string }> = {
  cat: { fur: '#e8a05c', belly: '#fbf3e4', dark: '#c47f3e' },
  dog: { fur: '#e0a860', belly: '#f9efe0', dark: '#b8823e' },
};

/** 宠物 Living-room 边界 + 家具避障（简化版碰撞） */
function clampPet(c: CharRT, items: FurnitureItem[]) {
  for (const it of items) {
    const e = CATALOG[it.kind];
    if (!e || e.flat || (it.y ?? 0) > 0.45) continue;
    const [w, d] = footprintOf(e, it.ry ?? 0);
    const hw = w / 2 + 0.14;
    const hd = d / 2 + 0.14;
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

  const C = PET_COLORS[pet.sp];
  const isCat = pet.sp === 'cat';
  /** 体型：狗比猫大一号 */
  const S = isCat ? 1 : 1.16;

  const tex = useMemo(
    () => ({ heart: makeBubbleTexture('heart'), rice: makeBubbleTexture('rice'), zzz: makeBubbleTexture('zzz') }),
    [],
  );
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

    // —— AI：喂食优先 → 溜达 → 打盹 ——
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
    clampPet(c, itemsRef.current ?? []);
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
    // 走路：身体起伏 + 四腿交替；坐下：上身向后仰 + 身体微沉（后腿在下面折叠）
    if (body.current) {
      body.current.position.y = (walking ? Math.abs(Math.sin(t * 11)) * 0.02 * S : 0) - sit * 0.042;
      body.current.rotation.z = walking ? Math.sin(t * 11) * 0.04 : 0;
      body.current.rotation.x = -0.34 * sit;
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
      body.current.scale.set(S * (1 - br * 0.6), S * (1 + br), S * (1 - br * 0.6));
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
    // 抖耳：每 ~5s 随机一边快速抖一下
    if (t >= nextTwitch.current) {
      twitchUntil.current = t + 0.4;
      twitchSide.current = Math.random() < 0.5 ? 0 : 1;
      nextTwitch.current = t + 4.5 + Math.random() * 3;
    }
    const twk = t < twitchUntil.current ? Math.sin(t * 46) * 0.22 : 0;
    ears.current.forEach((e, i) => {
      if (!e) return;
      const sd = i === 0 ? -1 : 1;
      e.rotation.z = (isCat ? -0.22 * sd : 0.5 * sd) + (i === twitchSide.current ? twk : 0);
    });
    // 尾巴链惯性：中/末节带相位差的小幅摆动（开心时幅度变大）
    const happyNow = !!petAt.current && now - petAt.current < 2600;
    const tf = happyNow ? 14 : 5;
    if (tailMid.current) tailMid.current.rotation.z = Math.sin(t * tf + 0.7) * (happyNow ? 0.22 : 0.1);
    if (tailTip.current) tailTip.current.rotation.z = Math.sin(t * tf + 1.3) * (happyNow ? 0.3 : 0.14);
    // 铃铛：走路时叮当晃
    if (bell.current) bell.current.rotation.z = Math.sin(t * 9) * (walking ? 0.22 : 0.05);
    // 撸宠后开心转一小圈
    if (petAt.current && now - petAt.current < 900) {
      h.rotation.y = c.heading + Math.sin(((now - petAt.current) / 900) * Math.PI) * 1.4;
    }

    // —— 心情气泡（优先级：吃饭 > 打盹 > 撸宠爱心由粒子表达） ——
    if (moodSprite.current) {
      const showRice = eatingNow;
      const showZzz = !showRice && !!dozedOff.current && now - dozedOff.current < 3500 && !c.moving;
      moodSprite.current.visible = showRice || showZzz;
      moodSprite.current.material.map = showRice ? tex.rice : tex.zzz;
      moodSprite.current.material.needsUpdate = true;
      moodSprite.current.position.set(0.02, (isCat ? 0.57 : 0.65) + Math.sin(t * 2) * 0.02, 0);
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
      {/* 宠物本体 */}
      <group
        ref={holder}
        onClick={handleTap}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <group ref={body} scale={S}>
          {/* 躯干（胶囊感：椭球） */}
          <mesh position={[0, 0.2, 0]} scale={[0.16, 0.13, 0.24]} castShadow>
            <sphereGeometry args={[1, 20, 16]} />
            <meshStandardMaterial color={C.fur} roughness={0.9} />
          </mesh>
          {/* 白肚皮 */}
          <mesh position={[0, 0.17, 0.06]} scale={[0.12, 0.09, 0.18]}>
            <sphereGeometry args={[1, 14, 12]} />
            <meshStandardMaterial color={C.belly} roughness={0.9} />
          </mesh>
          {/* 猫：背上 3 道橘色虎斑纹（局部环面弧段，两端没入毛里） */}
          {isCat &&
            [0.1, 0, -0.09].map((z, i) => (
              <group key={i} position={[0, 0.185, z]} scale={[0.72, 1, 1]}>
                <mesh rotation={[0, 0, 1.05]}>
                  <torusGeometry args={[0.148, 0.013, 8, 20, 1.05]} />
                  <meshStandardMaterial color={C.dark} roughness={0.9} />
                </mesh>
              </group>
            ))}
          {/* 狗：柴犬花色——深棕背块 + 奶油胸 */}
          {!isCat && (
            <>
              <mesh position={[0, 0.29, -0.03]} scale={[0.12, 0.055, 0.15]}>
                <sphereGeometry args={[1, 16, 12]} />
                <meshStandardMaterial color={C.dark} roughness={0.9} />
              </mesh>
              <mesh position={[0, 0.25, 0.135]} scale={[0.085, 0.08, 0.095]}>
                <sphereGeometry args={[1, 12, 10]} />
                <meshStandardMaterial color={C.belly} roughness={0.9} />
              </mesh>
            </>
          )}

          {/* 四条腿 */}
          {(
            [
              [-0.08, 0.14, legFL],
              [0.08, 0.14, legFR],
              [-0.08, -0.13, legBL],
              [0.08, -0.13, legBR],
            ] as const
          ).map(([x, z, ref], i) => (
            <group key={i} ref={ref} position={[x, 0.12, z]}>
              <mesh position={[0, -0.05, 0]} castShadow>
                <cylinderGeometry args={[0.032, 0.028, 0.14, 10]} />
                <meshStandardMaterial color={C.fur} roughness={0.9} />
              </mesh>
              <mesh position={[0, -0.12, 0.012]}>
                <sphereGeometry args={[0.032, 10, 8]} />
                <meshStandardMaterial color={C.belly} roughness={0.9} />
              </mesh>
            </group>
          ))}

          {/* 头（更大更Q：24x18 扁圆、底部略平；frente +z） */}
          <group ref={head} position={[0, 0.34, 0.14]}>
            <mesh scale={[0.16, 0.142, 0.15]} castShadow>
              <sphereGeometry args={[1, 24, 18]} />
              <meshStandardMaterial color={C.fur} roughness={0.9} />
            </mesh>
            {/* 口吻（白） */}
            <mesh position={[0, -0.042, 0.115]} scale={[0.082, 0.062, 0.068]}>
              <sphereGeometry args={[1, 16, 12]} />
              <meshStandardMaterial color={C.belly} roughness={0.9} />
            </mesh>
            {/* 鼻子（猫粉鼻 / 狗深棕鼻） */}
            <mesh position={[0, -0.026, 0.176]} scale={[1.15, 0.8, 0.8]}>
              <sphereGeometry args={[0.02, 10, 8]} />
              <meshStandardMaterial color={isCat ? '#e5808e' : '#4a3b30'} roughness={0.4} />
            </mesh>
            {/* 眼睛 ×2（大而亮 + 双高光；眨眼时整体压扁） */}
            {[-0.06, 0.06].map((x, i) => (
              <mesh
                key={i}
                ref={(el) => {
                  eyes.current[i] = el;
                }}
                position={[x, 0.03, 0.12]}
              >
                <sphereGeometry args={[0.023, 16, 12]} />
                <meshStandardMaterial color="#332b26" roughness={0.15} />
                {/* 大高光（左上）+ 小高光（右下） */}
                <mesh position={[-0.008, 0.009, 0.016]} scale={[1, 1, 0.55]}>
                  <sphereGeometry args={[0.0068, 8, 8]} />
                  <meshBasicMaterial color="#ffffff" />
                </mesh>
                <mesh position={[0.007, -0.007, 0.018]}>
                  <sphereGeometry args={[0.0034, 6, 6]} />
                  <meshBasicMaterial color="#ffffff" />
                </mesh>
              </mesh>
            ))}
            {/* 腮红（软粉椭圆，半埋进脸颊） */}
            {[-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.075, -0.026, 0.122]} rotation={[0, s * 0.45, 0]} scale={[0.032, 0.022, 0.015]}>
                <sphereGeometry args={[1, 10, 8]} />
                <meshStandardMaterial color="#f6a8b0" roughness={0.9} transparent opacity={0.55} depthWrite={false} />
              </mesh>
            ))}
            {/* 胡须（猫：每侧 3 根细白须，向外前侧张开） */}
            {isCat &&
              [-1, 1].map((s) =>
                [0.28, -0.02, -0.32].map((tilt, i) => (
                  <mesh key={`${s}-${i}`} position={[s * 0.158, -0.032 + (i - 1) * 0.01, 0.142]} rotation={[tilt, -s * 0.4, -s * 1.4]}>
                    <cylinderGeometry args={[0.002, 0.002, 0.07, 5]} />
                    <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
                  </mesh>
                )),
              )}
            {/* 猫三角耳（含粉内耳）/ 狗垂耳（含浅色内耳）——组包裹便于抖耳 */}
            {[-1, 1].map((s, i) => (
              <group
                key={s}
                ref={(el) => {
                  ears.current[i] = el;
                }}
                position={[s * (isCat ? 0.092 : 0.1), isCat ? 0.118 : 0.02, 0]}
                rotation={[isCat ? 0.1 : 0, 0, isCat ? -0.22 * s : 0.5 * s]}
              >
                {isCat ? (
                  <>
                    <mesh position={[0, 0.048, 0]} scale={[1, 1, 0.72]}>
                      <coneGeometry args={[0.048, 0.1, 12]} />
                      <meshStandardMaterial color={C.fur} roughness={0.9} />
                    </mesh>
                    <mesh position={[0, 0.042, 0.02]} scale={[1, 1, 0.72]}>
                      <coneGeometry args={[0.026, 0.058, 10]} />
                      <meshStandardMaterial color="#f5b3bd" roughness={0.9} />
                    </mesh>
                  </>
                ) : (
                  <>
                    <mesh position={[0, 0, -0.008]} scale={[0.05, 0.095, 0.06]}>
                      <sphereGeometry args={[1, 12, 10]} />
                      <meshStandardMaterial color={C.dark} roughness={0.9} />
                    </mesh>
                    <mesh position={[s * -0.014, 0.005, 0.026]} scale={[0.026, 0.058, 0.032]}>
                      <sphereGeometry args={[1, 10, 8]} />
                      <meshStandardMaterial color="#f0dcbd" roughness={0.9} />
                    </mesh>
                  </>
                )}
              </group>
            ))}
            {/* 狗：白色腮点 */}
            {!isCat &&
              [-1, 1].map((s) => (
                <mesh key={s} position={[s * 0.095, -0.022, 0.112]} scale={[0.018, 0.022, 0.016]}>
                  <sphereGeometry args={[1, 10, 8]} />
                  <meshStandardMaterial color={C.belly} roughness={0.9} />
                </mesh>
              ))}
          </group>

          {/* 尾巴（猫：三节问号卷尾 / 狗：柴犬卷绒尾） */}
          <group ref={tail} position={[0, 0.26, -0.22]} rotation={isCat ? [-0.15, 0, 0] : [0, 0, 0]}>
            {isCat ? (
              <>
                {/* 第一节：微微后仰的粗根 */}
                <mesh position={[0, 0.06, 0]} castShadow>
                  <cylinderGeometry args={[0.017, 0.024, 0.12, 10]} />
                  <meshStandardMaterial color={C.fur} roughness={0.9} />
                </mesh>
                {/* 第二节（带摆动惯性） */}
                <group ref={tailMid} position={[0, 0.12, 0]} rotation={[0.55, 0, 0]}>
                  <mesh position={[0, 0.055, 0]}>
                    <cylinderGeometry args={[0.014, 0.017, 0.11, 10]} />
                    <meshStandardMaterial color={C.fur} roughness={0.9} />
                  </mesh>
                  {/* 第三节 + 深色尾尖圆球（问号的「点」） */}
                  <group ref={tailTip} position={[0, 0.11, 0]} rotation={[1.35, 0, 0]}>
                    <mesh position={[0, 0.0425, 0]}>
                      <cylinderGeometry args={[0.009, 0.014, 0.085, 10]} />
                      <meshStandardMaterial color={C.fur} roughness={0.9} />
                    </mesh>
                    <mesh position={[0, 0.098, 0]}>
                      <sphereGeometry args={[0.015, 10, 8]} />
                      <meshStandardMaterial color={C.dark} roughness={0.9} />
                    </mesh>
                  </group>
                </group>
              </>
            ) : (
              <>
                {/* 卷成 3.5rad 弧的粗环尾（侧面可见的柴犬卷） */}
                <mesh position={[0, 0.1, -0.02]} rotation={[0, Math.PI / 2, 0]} castShadow>
                  <torusGeometry args={[0.06, 0.026, 10, 24, 3.5]} />
                  <meshStandardMaterial color={C.fur} roughness={0.9} />
                </mesh>
                {/* 弧端封口球（尾根 / 奶油色尾尖） */}
                <mesh position={[0, 0.1, -0.08]}>
                  <sphereGeometry args={[0.026, 10, 8]} />
                  <meshStandardMaterial color={C.fur} roughness={0.9} />
                </mesh>
                <mesh position={[0, 0.079, 0.036]}>
                  <sphereGeometry args={[0.026, 10, 8]} />
                  <meshStandardMaterial color={C.belly} roughness={0.9} />
                </mesh>
              </>
            )}
          </group>

          {/* 项圈 + 铃铛（猫粉红 / 狗蓝） */}
          <group position={[0, 0.215, 0.11]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.088, 0.014, 10, 24]} />
              <meshStandardMaterial color={isCat ? '#e05c6e' : '#5c8ae0'} roughness={0.6} />
            </mesh>
            <group ref={bell} position={[0, -0.012, 0.13]}>
              <mesh position={[0, -0.012, 0.01]}>
                <sphereGeometry args={[0.017, 12, 10]} />
                <meshStandardMaterial color="#f3c34e" roughness={0.3} metalness={0.55} />
              </mesh>
              <mesh position={[0, -0.016, 0.01]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.016, 0.002, 6, 14]} />
                <meshStandardMaterial color="#c89a2e" roughness={0.4} metalness={0.5} />
              </mesh>
            </group>
          </group>
        </group>

        {/* 心情气泡（🍚 吃饭 / 💤 打盹） */}
        <sprite ref={moodSprite} position={[0, 0.57, 0]} scale={[0.2, 0.2, 1]} visible={false}>
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
