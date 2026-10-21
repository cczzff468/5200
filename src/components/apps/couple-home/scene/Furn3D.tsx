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
import {
  Basin3D,
  Bear3D,
  Bowls3D,
  Chandelier3D,
  Chopsticks3D,
  Cup3D,
  Fan3D,
  Juicer3D,
  Kettle3D,
  Laptop3D,
  Mirror3D,
  Plates3D,
  PlushCat3D,
  PlushPanda3D,
  PlushPig3D,
  Pot3D,
  Shower3D,
  Socket3D,
  Spoons3D,
  TowelRack3D,
} from './Small3D';
import { COZY_PARTS } from './Cozy3D';
import { COZY_PLUS_PARTS } from './CozyPlus3D';

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
  /** 浴缸水龙头点击（放水/关水；仅生活模式） */
  onFaucetTap?: (item: FurnitureItem) => void;
  /** 灶台烹饪中（蒸汽） */
  cooking?: boolean;
  /** 餐桌：好菜已上桌 */
  meal?: boolean;
  /** 乐器演奏中（钢琴键位/音符） */
  playing?: boolean;
  /** 任一投影仪开着（幕布放下放电影） */
  projectorOn?: boolean;
  /** 有人坐在这件家具上（吊篮秋千摆幅加大） */
  sitting?: boolean;
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
  onFaucetTap,
  cooking,
  meal,
  playing,
  projectorOn,
  sitting,
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

  /** v5.6 温馨扩展组件（按 kind 取） */
  const CozyPart = COZY_PARTS[entry.kind];
  /** v5.7 拾光扩展组件（按 kind 取） */
  const PlusPart = COZY_PLUS_PARTS[entry.kind];

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
        {isTV && <TV3D on={!!item.st?.on} night={night} col={item.col} channel={item.st?.channel} />}

        {/* 立体壁挂空调（程序化建模：导风板摆动 + 冷风丝） */}
        {entry.kind === 'aircon' && <Aircon3D on={!!item.st?.on} night={night} col={item.col} />}

        {/* 立式相框（程序化建模：手机上传照片，永久保存） */}
        {entry.kind === 'photoFrame' && <PhotoFrame3D col={item.col} photo={item.st?.photo} />}

        {/* 挂墙相框（竖版/横版） + 拍立得 */}
        {entry.kind === 'photoWall' && <WallPhoto3D col={item.col} photo={item.st?.photo} />}
        {entry.kind === 'photoWallWide' && <WallPhoto3D col={item.col} photo={item.st?.photo} wide />}
        {entry.kind === 'polaroid' && <Polaroid3D col={item.col} photo={item.st?.photo} />}

        {/* 毛绒玩偶 + 梳妆台（程序化建模） */}
        {entry.kind === 'plushBunny' && <PlushBunny3D col={item.col} />}
        {entry.kind === 'plushDuck' && <PlushDuck3D col={item.col} />}
        {entry.kind === 'plushPanda' && <PlushPanda3D col={item.col} />}
        {entry.kind === 'plushPig' && <PlushPig3D col={item.col} />}
        {entry.kind === 'plushCat' && <PlushCat3D col={item.col} />}
        {entry.kind === 'vanity' && <Vanity3D col={item.col} />}
        {entry.kind === 'bear' && <Bear3D col={item.col} />}

        {/* 厨具小物（程序化建模） */}
        {entry.kind === 'pot' && <Pot3D col={item.col} />}
        {entry.kind === 'kettle' && <Kettle3D col={item.col} />}
        {entry.kind === 'bowls' && <Bowls3D col={item.col} />}
        {entry.kind === 'plates' && <Plates3D col={item.col} />}
        {entry.kind === 'chopsticks' && <Chopsticks3D col={item.col} />}
        {entry.kind === 'spoons' && <Spoons3D col={item.col} />}
        {entry.kind === 'cup' && <Cup3D col={item.col} />}
        {entry.kind === 'juicer' && <Juicer3D col={item.col} />}

        {/* 风扇（开 = 叶片旋转 + 摇头）/ 插座 / 吊灯（挂顶）/ 手提电脑（开 = 屏盖翻开 + 屏幕发光） */}
        {entry.kind === 'fan' && <Fan3D on={!!item.st?.on} col={item.col} />}
        {entry.kind === 'socket' && <Socket3D col={item.col} />}
        {entry.kind === 'chandelier' && <Chandelier3D on={!!item.st?.on} night={night} col={item.col} />}
        {entry.kind === 'laptop' && <Laptop3D on={!!item.st?.on} col={item.col} />}

        {/* 洗衣机状态灯 */}
        {entry.acts?.washer && modelSize && (
          <mesh ref={washDot} position={[modelSize.x * 0.32, modelSize.y * 0.78, modelSize.z / 2 + 0.01]}>
            <sphereGeometry args={[0.035, 10, 10]} />
            <meshStandardMaterial color="#d9d9d4" emissive="#7fd69a" emissiveIntensity={0} />
          </mesh>
        )}

        {/* 卫浴全套（v5.4：淋浴房/洗手台/镜子/毛巾架） */}
        {entry.kind === 'shower' && <Shower3D on={!!item.st?.on} col={item.col} />}
        {entry.kind === 'basin' && <Basin3D col={item.col} />}
        {entry.kind === 'mirror' && <Mirror3D col={item.col} />}
        {entry.kind === 'towelRack' && <TowelRack3D col={item.col} />}

        {/* 泡泡浴缸：水龙头（可点击放水）+ 水位上涨 + 泡泡 */}
        {entry.kind === 'bathtub' && (
          <TubExtras
            filling={!!item.st?.bathWater}
            interactive={mode === 'live'}
            onFaucet={() => onFaucetTap?.(item)}
          />
        )}

        {/* v5.6 温馨扩展（Cozy3D 程序化建模）：窗帘/壁炉/鱼缸/豆袋/钢琴/吉他/穿衣镜/星空灯/床幔/咖啡机/果盘/浴帘/洗漱/体重秤/置物架 */}
        {CozyPart && (
          <CozyPart
            col={item.col}
            on={!!item.st?.on}
            open={!!item.st?.on}
            playing={playing}
            brewing={!!item.st?.on}
            fedAt={item.st?.fedAt}
          />
        )}

        {/* v5.7 拾光扩展（CozyPlus3D 程序化建模）：投影仪/幕布/吊篮秋千/鞋柜/挂画组/加湿器/酒柜/棋盘桌/火锅桌/吊床/游戏机/花架 + v5.8 黑胶唱片机/八音盒 */}
        {PlusPart && (
          <PlusPart
            col={item.col}
            on={!!item.st?.on}
            open={!!item.st?.open}
            projectorOn={projectorOn}
            sat={sitting}
            touch={item.st?.lastTouch}
          />
        )}

        {/* 灶台烹饪：锅上蒸汽 */}
        {entry.kind === 'stove' && cooking && <StoveSteam />}

        {/* 餐桌：一桌好菜 */}
        {entry.kind === 'diningTable' && meal && <MealDish />}
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

// ---------------- 浴缸附属：水龙头 + 放水 + 水位 + 泡泡（程序化） ----------------

const BUBBLE_POS: [number, number, number][] = [
  [-0.7, 0, -0.18],
  [-0.35, 0, 0.22],
  [0.05, 0, -0.25],
  [0.3, 0, 0.12],
  [0.62, 0, -0.1],
  [-0.12, 0, 0.05],
  [0.82, 0, 0.24],
  [-0.85, 0, 0.16],
];

function TubExtras({
  filling,
  interactive,
  onFaucet,
}: {
  filling: boolean;
  interactive: boolean;
  onFaucet: () => void;
}) {
  const water = useRef<THREE.Mesh>(null);
  const bubbles = useRef<THREE.Group>(null);
  const stream = useRef<THREE.Mesh>(null);
  const knob = useRef<THREE.Mesh>(null);
  const level = useRef(0.1);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    // 水位：放水 → 涨到 0.42；关水 → 缓慢回落
    level.current = THREE.MathUtils.damp(level.current, filling ? 0.42 : 0.08, filling ? 0.9 : 1.6, d);
    if (water.current) {
      water.current.visible = level.current > 0.1;
      // 底部贴 0.05，顶部 ≈ 0.05 + level
      water.current.scale.y = Math.max(0.02, level.current);
      water.current.position.y = 0.05 + water.current.scale.y / 2;
    }
    if (bubbles.current) {
      bubbles.current.visible = filling && level.current > 0.24;
      const t = state.clock.elapsedTime;
      bubbles.current.children.forEach((b, i) => {
        b.position.y = 0.06 + Math.abs(Math.sin(t * 1.4 + i * 1.7)) * 0.05;
      });
    }
    if (stream.current) stream.current.visible = filling;
    if (knob.current) {
      const m = knob.current.material as THREE.MeshStandardMaterial;
      m.emissive = m.emissive ?? new THREE.Color();
      m.emissive.set(filling ? '#7fc3e8' : '#000000');
      m.emissiveIntensity = filling ? 0.9 : 0;
    }
  });

  const chrome = '#c9d2d8';
  return (
    <group>
      {/* 水龙头（立在浴缸 +x 端的外沿上） */}
      <group position={[1.0, 0.56, 0.18]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.03, 0.036, 0.3, 12]} />
          <meshStandardMaterial color={chrome} roughness={0.28} metalness={0.75} />
        </mesh>
        {/* 弯头出水嘴（朝浴缸内） */}
        <mesh position={[-0.11, 0.19, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.24, 10]} />
          <meshStandardMaterial color={chrome} roughness={0.28} metalness={0.75} />
        </mesh>
        {/* 旋钮（点击放水/关水；带放大的隐形热区方便手指点按） */}
        <mesh
          ref={knob}
          position={[0.02, 0.19, 0.05]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.032, 0.032, 0.024, 14]} />
          <meshStandardMaterial color={filling ? '#a8d4e6' : '#e8e4dc'} roughness={0.35} />
        </mesh>
        <mesh
          position={[0.02, 0.19, 0.03]}
          onClick={
            interactive
              ? (e) => {
                  e.stopPropagation();
                  onFaucet();
                }
              : undefined
          }
        >
          <boxGeometry args={[0.16, 0.16, 0.16]} />
          {/* 全透明热区（透明度 0 仍参与射线检测；visible=false 会被 raycaster 跳过） */}
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      {/* 出水水柱 */}
      <mesh ref={stream} position={[0.82, 0.28, 0.18]} visible={false}>
        <cylinderGeometry args={[0.02, 0.03, 0.5, 8]} />
        <meshStandardMaterial color="#bfe3f2" transparent opacity={0.5} roughness={0.15} />
      </mesh>
      {/* 缸内水体（水位随 useFrame 涨落；box 高 1，缩放后顶面 ≈ 0.05+level） */}
      <mesh ref={water} position={[-0.06, 0.1, 0]} scale={[1, 0.1, 1]} visible={false}>
        <boxGeometry args={[2.05, 1, 0.86]} />
        <meshStandardMaterial color="#cdeaf5" transparent opacity={0.55} roughness={0.2} />
      </mesh>
      {/* 泡泡群（放水时浮在水面） */}
      <group ref={bubbles} visible={false}>
        {BUBBLE_POS.map((p, i) => (
          <mesh key={i} position={p} scale={[1, 0.6, 1]}>
            <sphereGeometry args={[0.05 + (i % 3) * 0.018, 10, 8]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.85} roughness={0.3} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---------------- 灶台烹饪蒸汽（做饭时从锅口升腾） ----------------

function StoveSteam() {
  const group = useRef<THREE.Group>(null);
  const PUFFS = 4;
  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    group.current.children.forEach((c, i) => {
      const ph = ((t * 0.55 + i / PUFFS) % 1 + 1) % 1;
      c.position.y = 0.1 + ph * 0.42;
      c.position.x = Math.sin(ph * 5 + i * 2.1) * 0.05;
      const s = 0.07 + ph * 0.13;
      c.scale.set(s, s, s);
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
      m.opacity = Math.sin(ph * Math.PI) * 0.5;
    });
  });
  return (
    <group ref={group} position={[-0.18, 0.92, 0]}>
      {Array.from({ length: PUFFS }, (_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0} depthWrite={false} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------- 一桌好菜（做饭完成摆上餐桌） ----------------

function MealDish() {
  return (
    <group position={[0, 0.735, 0]}>
      {/* 大圆盘 */}
      <mesh position={[0, 0.015, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.22, 0.03, 24]} />
        <meshStandardMaterial color="#fdfbf6" roughness={0.35} />
      </mesh>
      {/* 红烧肉块 ×3 */}
      {[
        [-0.07, 0.05],
        [0.08, -0.03],
        [0.0, 0.1],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.055, z]} rotation={[0, i * 1.3, 0]} castShadow>
          <boxGeometry args={[0.09, 0.05, 0.09]} />
          <meshStandardMaterial color="#b4643c" roughness={0.55} />
        </mesh>
      ))}
      {/* 绿菜点缀 */}
      {[
        [0.13, 0.12],
        [-0.14, -0.08],
      ].map(([x, z], i) => (
        <mesh key={`g${i}`} position={[x, 0.045, z]} scale={[1, 0.5, 1]} castShadow>
          <sphereGeometry args={[0.035, 10, 8]} />
          <meshStandardMaterial color="#7fbf7a" roughness={0.7} />
        </mesh>
      ))}
      {/* 小碗汤 */}
      <mesh position={[0.3, 0.04, -0.18]} castShadow>
        <cylinderGeometry args={[0.07, 0.05, 0.06, 14]} />
        <meshStandardMaterial color="#fdfbf6" roughness={0.4} />
      </mesh>
      <mesh position={[0.3, 0.062, -0.18]}>
        <cylinderGeometry args={[0.06, 0.06, 0.012, 14]} />
        <meshStandardMaterial color="#e8b04c" roughness={0.3} />
      </mesh>
    </group>
  );
}
