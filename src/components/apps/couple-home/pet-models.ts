'use client';

/**
 * 情侣小家 —— 宠物模型库（v8.0 精选高质量现成模型）
 *
 * - 用户此前反馈「程序化盲盒宠物跟假的一样」→ v8 放弃几何体拼装，
 *   全面换装两款 **高精度现成 3D 模型**（有雕刻感的真实建模 + 手绘贴图）：
 *   ① 柴犬（Q 版盲盒手办风：大头圆眼白眉点红项圈，静态模型 → 程序化蹦跳/呼吸动画）
 *   ② 小黑猫（写实毛绒质感：完整骨骼 + 舔毛动画 Take 001，来自 Moonwave Studios 开源 MIT 游戏《Rooms》）
 * - 老档兼容：HomeState.pet.breed 旧 id（orange/ragdoll/calico/fox/husky/…）
 *   由 modelOf() 统一映射（狗类→shiba，猫类→cat）；未知/缺省 → 柴犬兜底。
 */

/** 毛色变体（v8.1）：shader mix 调色 —— color 目标色，strength 混合强度（0 原色 → 1 纯色） */
export interface PetVariant {
  id: string;
  name: string;
  color: string;
  strength: number;
}

/** 宠物模型（UI 元数据 + GLB 资产 + 动画适配参数） */
export interface PetModel {
  id: string;
  /** 存档里的物种字段（老 schema 兼容用） */
  sp: 'cat' | 'dog';
  name: string;
  blurb: string;
  emoji: string;
  /** 领养卡片渐变（tailwind from-/to- 色值） */
  tint: [string, string];
  /** 模型资产路径（public 下） */
  glb: string;
  /** 目标坐姿世界高度（米，含耳尖）——加载后按包围盒精确缩放 */
  targetH: number;
  /** 移动速度乘子 */
  speed: number;
  /** 领养时建议名 */
  suggest: string;
  /** 骨骼动画 clip 名（黑猫的舔毛/挠脸待机动画；柴犬为静态模型无 clip） */
  clip?: string;
  /** 模型原生朝向修正（弧度）：加载后绕 Y 旋转，使 heading=0 时面向 +Z */
  yawOffset?: number;
  /** 蹦跳参数：步频 & 跳高 */
  hop?: { freq: number; height: number };
  /** 毛色变体（v8.1：shader mix 调色；缺省 = 仅原色） */
  variants?: PetVariant[];
}

export const PET_MODELS: PetModel[] = [
  {
    id: 'shiba',
    sp: 'dog',
    name: '柴犬',
    blurb: '盲盒手办同款，微笑小天使',
    emoji: '🐕',
    tint: ['#fdeee0', '#f9dfc8'],
    glb: '/pets3d/shiba.glb',
    targetH: 0.34,
    speed: 1,
    suggest: '炭团',
    hop: { freq: 7.2, height: 0.055 },
    variants: [
      { id: 'cream', name: '奶油', color: '#f3e7d3', strength: 0.5 },
      { id: 'sesame', name: '胡麻', color: '#6f5642', strength: 0.45 },
    ],
  },
  {
    id: 'puppy',
    sp: 'dog',
    name: '垂耳幼犬',
    blurb: '奶油色小软毛，站着也会东张西望',
    emoji: '🐶',
    tint: ['#fbf3e4', '#f3e4c8'],
    glb: '/pets3d/puppy.glb',
    targetH: 0.3,
    speed: 0.95,
    suggest: '布丁',
    clip: 'Animation',
    hop: { freq: 6.8, height: 0.05 },
    variants: [
      { id: 'honey', name: '蜜棕', color: '#c98d5a', strength: 0.4 },
      { id: 'smoke', name: '烟灰', color: '#9aa0a8', strength: 0.5 },
    ],
  },
  {
    id: 'cat',
    sp: 'cat',
    name: '小黑猫',
    blurb: '毛绒绒小煤球，会自己舔毛',
    emoji: '🐈‍⬛',
    tint: ['#efeaf2', '#d8d3e0'],
    glb: '/pets3d/cat.glb',
    targetH: 0.29,
    speed: 0.92,
    suggest: '煤球',
    clip: 'Take 001',
    yawOffset: -Math.PI / 2,
    hop: { freq: 6.4, height: 0.045 },
    variants: [
      { id: 'blue', name: '蓝灰', color: '#8e9aae', strength: 0.55 },
      { id: 'milk', name: '奶白', color: '#ece4d6', strength: 0.78 },
    ],
  },
];

/** 旧品种 id → 新模型 id（老档兼容；v6.4 模型 id 直通映射） */
const LEGACY_MAP: Record<string, string> = {
  shiba: 'shiba',
  cat: 'cat',
  // v7.0 程序化 8 品种
  cream: 'shiba',
  husky: 'shiba',
  fox: 'shiba',
  'cat-white': 'cat',
  'cat-orange': 'cat',
  'cat-calico': 'cat',
  'cat-tux': 'cat',
  // v6.3 及更早的 11 品种
  pomeranian: 'shiba',
  golden: 'shiba',
  corgi: 'shiba',
  orange: 'cat',
  ragdoll: 'cat',
  calico: 'cat',
  lihua: 'cat',
  tuxedo: 'cat',
  goldenShaded: 'cat',
};

/** 按存档 breed id 找模型（新 id 直查；老档旧 id 走 LEGACY_MAP；未知/缺省 → 柴犬兜底） */
export function modelOf(breed?: string): PetModel {
  if (breed) {
    const direct = PET_MODELS.find((m) => m.id === breed);
    if (direct) return direct;
    const mapped = LEGACY_MAP[breed];
    if (mapped) return PET_MODELS.find((m) => m.id === mapped) ?? PET_MODELS[0];
  }
  return PET_MODELS[0];
}

/** 找毛色变体（id 为空/未命中 → undefined = 原色） */
export function variantOf(model: PetModel, vtId?: string): PetVariant | undefined {
  if (!vtId) return undefined;
  return model.variants?.find((v) => v.id === vtId);
}
