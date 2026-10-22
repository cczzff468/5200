'use client';

/**
 * 情侣小家 —— 宠物模型库（v7.0 程序化 Q 版盲盒风）
 *
 * - 用户嫌 Quaternius 低多边形不够可爱，发来三张参考图（Q 版大头柴犬插画 /
 *   六连萌猫插画 / 3D 盲盒垂耳狗），要求按图做「大头圆润盲盒风」；
 * - 现成模型站没有免费同款风格，改为 **纯 three.js 程序化建模**（QPet.tsx）：
 *   超大圆头（≈55% 身高）+ 黑豆大眼高光 + 腮红 + 奶白肚皮口鼻 + 小短腿 +
 *   卷尾/长尾 + 头部色斑，MeshStandardMaterial 盲盒光滑质感；
 * - 品种按参考图扩展为 8 只：黑柴 / 奶油柴 / 哈士奇 / 小狐狸 /
 *   白奶猫 / 橘猫 / 三花猫 / 奶牛猫（QPetSpec 控制配色与耳尾形）；
 * - 老档兼容：HomeState.pet.breed 旧 id（orange/ragdoll/calico/lihua/…）
 *   由 modelOf() 统一映射到新品种；未知/缺省 → 黑柴兜底。
 */

/** Q 版宠物造型规格（QPet.tsx 按 spec 程序化拼装） */
export interface QPetSpec {
  /** 主毛色（头身） */
  main: string;
  /** 奶白色（肚皮 / 口鼻 / 爪 / 高光底） */
  belly: string;
  /** 深色（耳背 / 尾 / 斑块） */
  dark: string;
  /** 焦糖橘斑色（眉点 / 颊斑 / 三花橘斑） */
  tan: string;
  /** 腮红 */
  blush: string;
  /** 内耳 / 鼻 */
  innerEar: string;
  nose: string;
  /** 耳型：立耳(柴犬/哈士奇/狐) | 圆耳(猫) */
  ear: 'pointy' | 'round';
  /** 尾型：柴犬卷尾 | 狐狸蓬尾 | 猫长尾 */
  tail: 'curl' | 'up' | 'long';
  /** 头/背斑块：眉颊点 | 头顶帽 | 三花斑 | 奶牛斑 | 虎斑纹 | 无 */
  patch: 'brows' | 'cap' | 'calico' | 'tux' | 'tabby' | 'none';
}

/** 宠物模型（UI 元数据 + Q 版造型规格） */
export interface PetModel {
  id: string;
  /** 存档里的物种字段（老 schema 兼容用；fox 归 dog） */
  sp: 'cat' | 'dog';
  name: string;
  blurb: string;
  emoji: string;
  /** 领养卡片渐变（tailwind from-/to- 色值） */
  tint: [string, string];
  spec: QPetSpec;
  /** 目标站立世界高度（米，含耳尖）——QPet 按此精确建模 */
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
    name: '黑柴',
    blurb: '参考图同款，冷酷小炭球',
    emoji: '🖤',
    tint: ['#efece6', '#ddd8d0'],
    spec: {
      main: '#3a3330',
      belly: '#f6ecd9',
      dark: '#2c2624',
      tan: '#dfa15e',
      blush: '#f0a3a0',
      innerEar: '#e8b39a',
      nose: '#262019',
      ear: 'pointy',
      tail: 'curl',
      patch: 'brows',
    },
    targetH: 0.52,
    speed: 1,
    suggest: '炭炭',
  },
  {
    id: 'cream',
    sp: 'dog',
    name: '奶油柴',
    blurb: '奶呼呼微笑天使',
    emoji: '🍞',
    tint: ['#fdf3e4', '#f9e5c8'],
    spec: {
      main: '#f0b168',
      belly: '#fdf6e8',
      dark: '#d9984e',
      tan: '#e8b06a',
      blush: '#f29e98',
      innerEar: '#f0bfa8',
      nose: '#5a4032',
      ear: 'pointy',
      tail: 'curl',
      patch: 'none',
    },
    targetH: 0.52,
    speed: 1,
    suggest: '布丁',
  },
  {
    id: 'husky',
    sp: 'dog',
    name: '哈士奇',
    blurb: '戏精附体，家拆不停',
    emoji: '🐺',
    tint: ['#eef2f5', '#dde5ec'],
    spec: {
      main: '#98a1ad',
      belly: '#fbfaf7',
      dark: '#6f7885',
      tan: '#c9cfd8',
      blush: '#f2a8a4',
      innerEar: '#e8c0b4',
      nose: '#3a3532',
      ear: 'pointy',
      tail: 'up',
      patch: 'cap',
    },
    targetH: 0.53,
    speed: 1.05,
    suggest: '二哈',
  },
  {
    id: 'fox',
    sp: 'dog',
    name: '小狐狸',
    blurb: '毛茸茸的小机灵鬼',
    emoji: '🦊',
    tint: ['#fdeada', '#fbdcc0'],
    spec: {
      main: '#ef9a4f',
      belly: '#fdf6ea',
      dark: '#d97f36',
      tan: '#f4b26a',
      blush: '#f4a29c',
      innerEar: '#4a3f38',
      nose: '#4a3527',
      ear: 'pointy',
      tail: 'up',
      patch: 'none',
    },
    targetH: 0.5,
    speed: 1.08,
    suggest: '橘橘',
  },
  {
    id: 'cat-white',
    sp: 'cat',
    name: '白奶猫',
    blurb: '圆滚滚呼噜黏人精',
    emoji: '🐱',
    tint: ['#fdfaf4', '#f7efe2'],
    spec: {
      main: '#fdfaf4',
      belly: '#fffdfa',
      dark: '#efe6d8',
      tan: '#f3e8d8',
      blush: '#f7a6a2',
      innerEar: '#f5bcb2',
      nose: '#e8938c',
      ear: 'round',
      tail: 'long',
      patch: 'none',
    },
    targetH: 0.45,
    speed: 0.92,
    suggest: '汤圆',
  },
  {
    id: 'cat-orange',
    sp: 'cat',
    name: '橘猫',
    blurb: '十个橘猫九个胖',
    emoji: '🍊',
    tint: ['#fdf3e0', '#fbe7c4'],
    spec: {
      main: '#f2b25c',
      belly: '#fdf6e8',
      dark: '#d8933c',
      tan: '#e09b45',
      blush: '#f49e96',
      innerEar: '#f2b8a8',
      nose: '#d97f6e',
      ear: 'round',
      tail: 'long',
      patch: 'tabby',
    },
    targetH: 0.45,
    speed: 0.9,
    suggest: '蛋黄',
  },
  {
    id: 'cat-calico',
    sp: 'cat',
    name: '三花猫',
    blurb: '好运锦鲤，揉揉有福',
    emoji: '🍀',
    tint: ['#fdf3ea', '#fbeadd'],
    spec: {
      main: '#fdfaf3',
      belly: '#fffdfa',
      dark: '#3f3a38',
      tan: '#eda54e',
      blush: '#f7a6a2',
      innerEar: '#f5bcb2',
      nose: '#e8938c',
      ear: 'round',
      tail: 'long',
      patch: 'calico',
    },
    targetH: 0.45,
    speed: 0.95,
    suggest: '福福',
  },
  {
    id: 'cat-tux',
    sp: 'cat',
    name: '奶牛猫',
    blurb: '黑白花，精力无限小疯子',
    emoji: '🐮',
    tint: ['#f5f5f4', '#e4e4e6'],
    spec: {
      main: '#fbfaf8',
      belly: '#fffdfa',
      dark: '#35312f',
      tan: '#cfcac4',
      blush: '#f49e9a',
      innerEar: '#eeb4ac',
      nose: '#e09088',
      ear: 'round',
      tail: 'long',
      patch: 'tux',
    },
    targetH: 0.45,
    speed: 1,
    suggest: '团子',
  },
];

/** 旧品种 id → 新模型 id（老档兼容；husky 同名直通） */
const LEGACY_MAP: Record<string, string> = {
  shiba: 'shiba',
  husky: 'husky',
  fox: 'fox',
  cream: 'cream',
  'cat-white': 'cat-white',
  'cat-orange': 'cat-orange',
  'cat-calico': 'cat-calico',
  'cat-tux': 'cat-tux',
  pomeranian: 'cream',
  golden: 'cream',
  corgi: 'shiba',
  orange: 'cat-orange',
  ragdoll: 'cat-white',
  calico: 'cat-calico',
  lihua: 'cat-tux',
  tuxedo: 'cat-tux',
  goldenShaded: 'cat-orange',
  cat: 'cat-white',
};

/** 按存档 breed id 找模型（新 id 直查；老档旧 id 走 LEGACY_MAP；未知/缺省 → 黑柴兜底） */
export function modelOf(breed?: string): PetModel {
  if (breed) {
    const direct = PET_MODELS.find((m) => m.id === breed);
    if (direct) return direct;
    const mapped = LEGACY_MAP[breed];
    if (mapped) return PET_MODELS.find((m) => m.id === mapped) ?? PET_MODELS[0];
  }
  return PET_MODELS[0];
}
