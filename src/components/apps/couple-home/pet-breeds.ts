'use client';

/**
 * 情侣小家 —— 宠物品种库（v5.9 毛孩子扩展）
 *
 * - 11 个真实品种：5 狗（柴犬/博美/金毛/哈士奇/柯基）+ 6 猫（橘猫/布偶/三花/狸花/金渐层/奶牛猫）；
 * - look 为 Pet3D 程序化建模参数：毛色 / 花色方案 / 耳型 / 尾型 / 体型修正 / 鼻色 / 眼睛颜色；
 * - 老档兼容：HomeState.pet.breed 缺省时按 species 兜底（cat→orange，dog→shiba）。
 */

/** 宠物性别（领养时可选；影响 3D 配饰：男生蓝项圈 / 女生粉项圈+蝴蝶结） */
export type PetGender = 'boy' | 'girl';

/** 花色方案（Pet3D 按 pattern 分支渲染花纹网格） */
export type PetPattern =
  | 'solid' // 纯色（博美/金渐层近纯色+浅纹）
  | 'tabby' // 条纹（橘猫/狸花/柴犬鞍纹走 saddle，这里指背脊条纹）
  | 'points' // 重点色（布偶：脸耳尾爪深色，身体奶油）
  | 'patches' // 双色斑块（三花 橘+黑 / 奶牛 黑白）
  | 'saddle' // 鞍纹（柴犬/金毛背脊深色区）
  | 'blaze'; // 白底+大色块+白 blaze（柯基/哈士奇式面部白纹）

/** 耳型 */
export type PetEarStyle = 'erect' | 'erectBig' | 'floppy';
/** 尾型 */
export type PetTailStyle = 'question' | 'curl' | 'plume' | 'sickle' | 'bob';

/** Pet3D 程序化建模参数（一比一还原品种特征） */
export interface PetBreedLook {
  /** 整体体型缩放（金毛 1.25 大型犬 / 博美 0.85 小型） */
  scale: number;
  /** 身长乘子（柯基 1.35 小腿长身） */
  bodyLen: number;
  /** 腿长乘子（柯基 0.55 小短腿） */
  legLen: number;
  /** 腿粗乘子（金毛粗壮 / 博美纤细藏在毛里） */
  legR: number;
  /** 头圆度乘子（博美/金渐层头圆 1.15） */
  headRound: number;
  /** 主毛色 */
  fur: string;
  /** 肚皮/口吻浅色 */
  belly: string;
  /** 深色（纹/鞍/重点色） */
  dark: string;
  /** 花色方案 */
  pattern: PetPattern;
  /** patches 方案的两块斑块色（三花 [橘,黑] / 奶牛 [黑,黑]） */
  patchCols?: [string, string];
  /** 耳型 */
  ear: PetEarStyle;
  /** 尾型 */
  tail: PetTailStyle;
  /** 鼻色 */
  nose: string;
  /** 虹膜颜色（哈士奇蓝眼/布偶蓝眼/狸花金绿眼…黑默认 #3a3a3e） */
  eye: string;
}

/** 品种（UI 元数据 + 3D 外观参数） */
export interface PetBreed {
  id: string;
  sp: 'cat' | 'dog';
  name: string;
  /** 领养面板一句话人设 */
  blurb: string;
  /** 面板大 emoji */
  emoji: string;
  /** 领养面板真实品种照（public/pets/<id>.png，AI 生成一比一复刻） */
  img: string;
  /** 领养时建议名（可改名） */
  suggest: string;
  look: PetBreedLook;
}

export const PET_BREEDS: PetBreed[] = [
  // ==================== 狗 ====================
  {
    id: 'shiba',
    sp: 'dog',
    name: '柴犬',
    blurb: '爱微笑也会冷脸',
    emoji: '🐕',
    img: '/pets/shiba.png',
    suggest: '布丁',
    look: {
      // scale 1.16 = v5.8 时代狗体型（Pet3D 旧版 dog S=1.16），保持柴犬现状大小
      scale: 1.16, bodyLen: 1, legLen: 1, legR: 1, headRound: 1,
      fur: '#e0a860', belly: '#f9efe0', dark: '#b8823e',
      pattern: 'saddle', ear: 'erect', tail: 'curl', nose: '#4a3b30', eye: '#3a3a3e',
    },
  },
  {
    id: 'pomeranian',
    sp: 'dog',
    name: '博美',
    blurb: '一小团会跑的棉花糖',
    emoji: '🐶',
    img: '/pets/pomeranian.png',
    suggest: '毛球',
    look: {
      scale: 0.82, bodyLen: 0.92, legLen: 0.82, legR: 0.85, headRound: 1.16,
      fur: '#f0c98a', belly: '#fbf3e2', dark: '#d9a55e',
      pattern: 'solid', ear: 'erect', tail: 'plume', nose: '#3f322a', eye: '#4a3b30',
    },
  },
  {
    id: 'golden',
    sp: 'dog',
    name: '金毛',
    blurb: '大暖男，谁都能摸',
    emoji: '🦮',
    img: '/pets/golden.png',
    suggest: '暖宝',
    look: {
      scale: 1.24, bodyLen: 1.12, legLen: 1.14, legR: 1.18, headRound: 1.04,
      fur: '#e6c17e', belly: '#f7ecd4', dark: '#c79a52',
      pattern: 'saddle', ear: 'floppy', tail: 'plume', nose: '#3f322a', eye: '#5a4632',
    },
  },
  {
    id: 'husky',
    sp: 'dog',
    name: '哈士奇',
    blurb: '戏精附体，家拆不停',
    emoji: '🐺',
    img: '/pets/husky.png',
    suggest: '二哈',
    look: {
      scale: 1.18, bodyLen: 1.08, legLen: 1.1, legR: 1.05, headRound: 1.02,
      fur: '#aeb8c4', belly: '#f7f8fa', dark: '#5d6874',
      pattern: 'blaze', patchCols: ['#5d6874', '#5d6874'],
      ear: 'erect', tail: 'sickle', nose: '#3a3a3e', eye: '#5b9bd5',
    },
  },
  {
    id: 'corgi',
    sp: 'dog',
    name: '柯基',
    blurb: '小短腿电蜜臀',
    emoji: '🐶',
    img: '/pets/corgi.png',
    suggest: '短腿',
    look: {
      scale: 0.95, bodyLen: 1.32, legLen: 0.56, legR: 1.15, headRound: 1.1,
      fur: '#e89a4a', belly: '#fbf6ec', dark: '#c67c34',
      pattern: 'blaze', patchCols: ['#e89a4a', '#e89a4a'],
      ear: 'erectBig', tail: 'bob', nose: '#3f322a', eye: '#4a3b30',
    },
  },
  // ==================== 猫 ====================
  {
    id: 'orange',
    sp: 'cat',
    name: '橘猫',
    blurb: '十个橘猫九个胖',
    emoji: '🐱',
    img: '/pets/orange.png',
    suggest: '团子',
    look: {
      scale: 1.0, bodyLen: 1, legLen: 1, legR: 1, headRound: 1,
      fur: '#e8a05c', belly: '#fbf3e4', dark: '#c47f3e',
      pattern: 'tabby', ear: 'erect', tail: 'question', nose: '#e5808e', eye: '#3a3a3e',
    },
  },
  {
    id: 'ragdoll',
    sp: 'cat',
    name: '布偶猫',
    blurb: '黏人小仙女，抱不腻',
    emoji: '😸',
    img: '/pets/ragdoll.png',
    suggest: '仙仙',
    look: {
      scale: 1.12, bodyLen: 1.14, legLen: 1.08, legR: 1.1, headRound: 1.06,
      fur: '#f3e9da', belly: '#faf6ee', dark: '#6b584a',
      pattern: 'points', ear: 'erect', tail: 'plume', nose: '#e5a0aa', eye: '#6fa8dc',
    },
  },
  {
    id: 'calico',
    sp: 'cat',
    name: '三花猫',
    blurb: '招财锦鲤本鲤',
    emoji: '🐈',
    img: '/pets/calico.png',
    suggest: '花花',
    look: {
      scale: 0.98, bodyLen: 1, legLen: 1, legR: 0.98, headRound: 1.04,
      fur: '#f7f4ec', belly: '#ffffff', dark: '#4a423c',
      pattern: 'patches', patchCols: ['#e8a05c', '#4a423c'],
      ear: 'erect', tail: 'question', nose: '#e88a96', eye: '#c9a227',
    },
  },
  {
    id: 'lihua',
    sp: 'cat',
    name: '狸花猫',
    blurb: '中华田园猫之王',
    emoji: '🐈',
    img: '/pets/lihua.png',
    suggest: '阿狸',
    look: {
      scale: 1.02, bodyLen: 1.04, legLen: 1.04, legR: 0.96, headRound: 1.0,
      fur: '#a89468', belly: '#d9cdb2', dark: '#4f4434',
      pattern: 'tabby', ear: 'erect', tail: 'question', nose: '#b07a72', eye: '#8aa356',
    },
  },
  {
    id: 'goldenShaded',
    sp: 'cat',
    name: '金渐层',
    blurb: '行走的金元宝',
    emoji: '🐱',
    img: '/pets/goldenShaded.png',
    suggest: '金金',
    look: {
      scale: 1.04, bodyLen: 1, legLen: 0.96, legR: 1.12, headRound: 1.16,
      // dark 加深到 #ad8752：毛尖黑渐层在背脊更明显（底层杏金 + 背部毛尖色）
      fur: '#e8c78a', belly: '#f7ecd2', dark: '#ad8752',
      pattern: 'solid', ear: 'erect', tail: 'question', nose: '#d98a8a', eye: '#7fa87f',
    },
  },
  {
    id: 'tuxedo',
    sp: 'cat',
    name: '奶牛猫',
    blurb: '液体猫，上蹿下跳',
    emoji: '🐈‍⬛',
    img: '/pets/tuxedo.png',
    suggest: '奶牛',
    look: {
      scale: 1.0, bodyLen: 1.02, legLen: 1.02, legR: 1.0, headRound: 1.02,
      fur: '#f7f5f0', belly: '#ffffff', dark: '#35322f',
      pattern: 'patches', patchCols: ['#35322f', '#35322f'],
      ear: 'erect', tail: 'question', nose: '#e58a96', eye: '#c9a227',
    },
  },
];

/** 按 species + breed id 找品种（老档 breed 缺省 / 未知 id → species 默认款） */
export function breedOf(sp: 'cat' | 'dog', breed?: string): PetBreed {
  const fallbackId = sp === 'cat' ? 'orange' : 'shiba';
  return (
    PET_BREEDS.find((b) => b.id === breed && b.sp === sp) ??
    PET_BREEDS.find((b) => b.id === fallbackId)!
  );
}
