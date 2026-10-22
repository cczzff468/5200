'use client';

/**
 * 情侣小家 —— 宠物模型库（v6.4 现成 3D 模型版）
 *
 * - 全部换成 **Quaternius Ultimate Animated Animals** 现成 Q 版卡通 3D 模型
 *   （CC0 公有领域，自带骨骼动画，见 public/pets3d/CREDITS.md）；
 * - 用户指定：不再做 11 品种系统，「有什么用什么」——4 只现成的：柴犬 / 哈士奇 / 小狐狸 / 奶猫；
 * - 动画映射（GLB 内骨骼动画 clip，按 clip 名后缀查找，cat 是另一套命名）：
 *   溜达 Walk / 冲饭 Gallop|Run / 待机 Idle / 吃饭 Eating|Idle_Eating /
 *   打盹 Idle_2_HeadLow|Idle / 撸宠开心 Gallop_Jump|Jump_Loop；
 * - 老档兼容：HomeState.pet.breed 存的是旧品种 id 或新模型 id，
 *   modelOf() 统一兜底映射（husky 保留，其余狗→shiba，猫→cat，缺省→shiba）。
 */

/** 动画 clip 后缀组（按 GLB 实际 clip 名后缀查找；run/eat/nap/happy 均带 cat 备选） */
export interface PetClips {
  idle: string;
  walk: string;
  run: string;
  eat: string;
  nap: string;
  happy: string;
}

/** 通用 Quaternius 动物包 clip 后缀 */
const QUAT_CLIPS: PetClips = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Gallop',
  eat: 'Eating',
  nap: 'Idle_2_HeadLow',
  happy: 'Gallop_Jump',
};

/** 猫（Knight-of-the-Garden 镜像版）clip 后缀 */
const CAT_CLIPS: PetClips = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  eat: 'Idle_Eating',
  nap: 'Idle',
  happy: 'Jump_Loop',
};

/** 宠物模型（UI 元数据 + GLB 路径 + 动画映射） */
export interface PetModel {
  id: string;
  /** 存档里的物种字段（老 schema 兼容用；fox 归 dog） */
  sp: 'cat' | 'dog';
  name: string;
  blurb: string;
  emoji: string;
  /** 领养卡片渐变（tailwind from-/to- 色值） */
  tint: [string, string];
  glb: string;
  clips: PetClips;
  /** 目标站立世界高度（米）——首帧按包围盒自校准 */
  targetH: number;
  /** 移动速度乘子 */
  speed: number;
  /** 领养时建议名 */
  suggest: string;
}

export const PET_MODELS: PetModel[] = [
  {
    id: 'shiba',
    sp: 'dog',
    name: '柴犬',
    blurb: '爱微笑也会冷脸',
    emoji: '🐕',
    tint: ['#fdeee6', '#fde3e0'],
    glb: '/pets3d/ShibaInu.glb',
    clips: QUAT_CLIPS,
    targetH: 0.44,
    speed: 1,
    suggest: '布丁',
  },
  {
    id: 'husky',
    sp: 'dog',
    name: '哈士奇',
    blurb: '戏精附体，家拆不停',
    emoji: '🐺',
    tint: ['#eef2f7', '#dfe7f0'],
    glb: '/pets3d/Husky.glb',
    clips: QUAT_CLIPS,
    targetH: 0.46,
    speed: 1.05,
    suggest: '二哈',
  },
  {
    id: 'fox',
    sp: 'dog',
    name: '小狐狸',
    blurb: '毛茸茸的小机灵鬼',
    emoji: '🦊',
    tint: ['#fdeada', '#fbdcc8'],
    glb: '/pets3d/Fox.glb',
    clips: QUAT_CLIPS,
    targetH: 0.42,
    speed: 1.08,
    suggest: '橘橘',
  },
  {
    id: 'cat',
    sp: 'cat',
    name: '奶猫',
    blurb: '呼噜呼噜黏人精',
    emoji: '🐱',
    tint: ['#fdf3e4', '#fbeada'],
    glb: '/pets3d/Cat.glb',
    clips: CAT_CLIPS,
    targetH: 0.36,
    speed: 0.92,
    suggest: '团子',
  },
];

/** 旧品种 id → 新模型 id（老档兼容；husky 同名直通） */
const LEGACY_MAP: Record<string, string> = {
  shiba: 'shiba',
  husky: 'husky',
  pomeranian: 'shiba',
  golden: 'shiba',
  corgi: 'shiba',
  orange: 'cat',
  ragdoll: 'cat',
  calico: 'cat',
  lihua: 'cat',
  goldenShaded: 'cat',
  tuxedo: 'cat',
};

/** 按存档 breed id 找模型（新模型 id 直查；老档旧品种 id 走 LEGACY_MAP；未知/缺省 → 柴犬兜底） */
export function modelOf(breed?: string): PetModel {
  if (breed) {
    const direct = PET_MODELS.find((m) => m.id === breed);
    if (direct) return direct;
    const mapped = LEGACY_MAP[breed];
    if (mapped) return PET_MODELS.find((m) => m.id === mapped) ?? PET_MODELS[0];
  }
  return PET_MODELS[0];
}
