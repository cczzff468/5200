/**
 * 情侣小家 3D —— Kenney GLB 模型加工工具
 *
 * 1) 浅色系重着色：Kenney 模型材质命名全 kit 统一（wood/carpet/metal/...），
 *    按材质名映射到「白色 / 浅灰 / 浅粉 / 浅黄 / 蜂蜜木 / 柔黑」浅色系调色板；
 * 2) 归一化：按包围盒把模型放到「底部贴地、XZ 居中」并统一放大 MODEL_SCALE；
 * 3) 门轴装配：doorLeft/doorRight/door… 等独立门节点包进 pivot 组放在铰链边，
 *    旋转 pivot 即可做真实开门动画。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODEL_SCALE } from '../catalog';

// ---------------- 浅色系调色板 ----------------

/** 材质名 → 浅色系颜色（用户指定：白、黑、浅黄、浅灰、浅粉等浅色系） */
const PALETTE: Record<string, number> = {
  wood: 0xe9cb9c, // 蜂蜜浅木
  woodDark: 0xd6af7f, // 深一档木色
  carpet: 0xf4b9c4, // 浅粉
  carpetDarker: 0xe7a4b1, // 玫瑰粉
  carpetWhite: 0xfaf9f4, // 暖白
  metal: 0xdcdcd8, // 浅暖灰（去蓝）
  metalDark: 0x57585c, // 柔黑
  metalMedium: 0x9c9ea1, // 中灰
  metalLight: 0xf5f2eb, // 暖白
  plant: 0xa8d8bb, // 柔和鼠尾草绿
  lamp: 0xffe9ac, // 浅黄（灯罩）
  glass: 0xdfe6e1, // 雾白
  fur: 0xdbaf87, // 焦糖（小熊）
};

/** 兜底：未知材质 → 原色降饱和提亮 */
function fallbackLighten(c: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(hsl.s, 0.18), THREE.MathUtils.lerp(hsl.l, 0.86, 0.55));
  return c;
}

/** 共享调色板材质缓存（同材质名全屋共享；toggle 家具由调用方 clone） */
const sharedMats = new Map<string, THREE.MeshStandardMaterial>();

export function paletteMaterial(name: string, baseColor?: THREE.Color): THREE.MeshStandardMaterial {
  const cached = sharedMats.get(name);
  if (cached) return cached;
  const hex = PALETTE[name];
  const color =
    hex !== undefined ? new THREE.Color(hex) : fallbackLighten((baseColor ?? new THREE.Color(0xeceae2)).clone());
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
  mat.name = name; // 克隆后仍可按名识别（灯罩发光用）
  sharedMats.set(name, mat);
  return mat;
}

/** 材质是否为灯罩/屏幕（toggle 家具要克隆它以便单独发光） */
export function isGlowMaterial(name: string): boolean {
  return name === 'lamp' || name === 'glass';
}

// ---------------- GLB 加载器 ----------------

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();
/** 原始场景缓存（loadModel 后写入，供 cloneFurniture 同步取用） */
const protoMap = new Map<string, THREE.Group>();

/** 加载并缓存原始场景（共享，禁止直接挂树；用 cloneFurniture 复制实例） */
export function loadModel(url: string): Promise<THREE.Group> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise<THREE.Group>((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          const scene = gltf.scene as unknown as THREE.Group;
          protoMap.set(url, scene);
          resolve(scene);
        },
        undefined,
        reject,
      );
    });
    cache.set(url, p);
  }
  return p;
}

/** 预加载（商店等提前暖缓存） */
export function preloadModel(url: string): void {
  loadModel(url).catch(() => {});
}

/** 加载并登记 proto（cloneFurniture 前必须先调用） */
export function ensureModel(url: string): Promise<THREE.Group> {
  return loadModel(url);
}

// ---------------- 归一化与克隆 ----------------

export interface FurnModel {
  /** 模型根（已贴地居中，直接挂到家具组即可） */
  root: THREE.Group;
  /** 归一化后的包围盒尺寸（米） */
  size: THREE.Vector3;
  /** 门轴 pivot 列表（已 attach 门节点） */
  doors: DoorPivot[];
}

export interface DoorPivot {
  /** 基础名（doorLeft / doorRight / door / doorFridge / doorFreezer / washerDoor…） */
  base: string;
  pivot: THREE.Group;
  /** 目标开角（弧度，含正负） */
  swing: number;
}

/**
 * 克隆 + 归一化一个家具模型（须先 await loadModel(url)）：
 * - scale = MODEL_SCALE；底部贴地（minY → 0）、XZ 居中；
 * - 材质替换为浅色系（cloneMats=true 时每实例独立材质，供发光调光）；
 * - 门节点装配 pivot。
 */
export function cloneFurniture(url: string, opts: { cloneMats?: boolean; yaw?: number } = {}): FurnModel {
  const proto = protoMap.get(url);
  if (!proto) throw new Error(`model not loaded: ${url}`);

  const root = new THREE.Group();
  const inner = proto.clone(true);

  // 归一化：贴地 + XZ 居中 + 放大
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(MODEL_SCALE);
  const center = box.getCenter(new THREE.Vector3());
  inner.position.set(-center.x, -box.min.y, -center.z);
  inner.scale.setScalar(MODEL_SCALE);
  root.add(inner);

  // 材质替换（浅色系）
  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const src = m.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
    const mapOne = (mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
      const base = paletteMaterial(mat.name || 'default', mat.color);
      return opts.cloneMats ? base.clone() : base;
    };
    m.material = Array.isArray(src) ? src.map(mapOne) : mapOne(src);
  });

  if (opts.yaw) inner.rotation.y = opts.yaw;

  // 门轴装配
  const doors = buildDoorPivots(root);

  return { root, size, doors };
}

// ---------------- 门轴装配 ----------------

const DOOR_SWING = 1.85; // ~106° 开角

/** mesh 名 → 门基础名（Mesh_doorLeft_1 → doorLeft；Mesh_door → door） */
function doorBase(name: string): string | null {
  const m = /^Mesh_(door[A-Za-z]*)(?:_\d+)?$/.exec(name);
  if (!m) return null;
  return m[1] || 'door';
}

/** 把模型里名字含 door 的 mesh 按基础名分组，包进铰链 pivot */
function buildDoorPivots(root: THREE.Group): DoorPivot[] {
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const base = doorBase(mesh.name);
    if (!base) return;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base)!.push(mesh);
  });

  const doors: DoorPivot[] = [];
  for (const [base, meshes] of groups) {
    if (meshes.length === 0) continue;
    // 合并包围盒（root 本地坐标；先更新世界矩阵保证 expandByObject 准确）
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const mesh of meshes) box.expandByObject(mesh);
    if (box.isEmpty()) continue;

    const hingeLeft = !/right/i.test(base);
    const pivot = new THREE.Group();
    pivot.position.set(hingeLeft ? box.min.x : box.max.x, 0, (box.min.z + box.max.z) / 2);
    root.add(pivot);
    for (const mesh of meshes) pivot.attach(mesh);

    // 左铰链门向外开（+角），右铰链门对称（-角）
    const swing = (hingeLeft ? 1 : -1) * DOOR_SWING;
    doors.push({ base, pivot, swing });
  }
  return doors;
}

/** 门轴开合动画（useFrame 里调用；返回是否仍在动画中） */
export function animateDoors(doors: DoorPivot[], open: boolean, dt: number): boolean {
  let busy = false;
  for (const d of doors) {
    const target = open ? d.swing : 0;
    const cur = d.pivot.rotation.y;
    const next = THREE.MathUtils.damp(cur, target, 8, dt);
    if (Math.abs(next - cur) > 1e-4) busy = true;
    d.pivot.rotation.y = next;
  }
  return busy;
}
