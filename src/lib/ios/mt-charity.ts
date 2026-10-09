'use client';

/**
 * 我的公益图片（「美团-我的-我的公益」弹层可选；「菜单图片样式」三源）：
 *
 * 1. default —— 内置默认公益图（/mt/charity-default.jpg，构建期静态资源，零配置可用）；
 * 2. local   —— 用户从手机上传的真实图片（file input → dataURL 压缩后存 kv 槽 local）；
 * 3. ai      —— 用「设置 → 图像生成」里配置的生图 API 按公益主题现场生成（存 kv 槽 ai）。
 *
 * 两个自定义图槽（local / ai）互相独立——切换样式 / 重新生成互不覆盖；
 * 选中样式持久化在 localStorage（小开关类，同步首帧读），图片 dataURL 存 kv（中大容量）。
 * 独立成模块与 mt-rider.ts 同构：App 内格子缩略图与弹层预览共用同一读取口径。
 */

import { kvDel, kvGet, kvSet } from '@/lib/ios/idb-kv';

export type MtCharityStyle = 'default' | 'local' | 'ai';

/** 内置默认公益图（静态资源） */
export const MT_CHARITY_DEFAULT_SRC = '/mt/charity-default.jpg';

const MT_CHARITY_STYLE_KEY = 'mt-charity-style';
const charityImgKeyOf = (kind: 'local' | 'ai') => `mt-charity-img:${kind}`;

/** 读当前选中样式（无/非法存档回退 default） */
export function mtGetCharityStyle(): MtCharityStyle {
  try {
    const v = localStorage.getItem(MT_CHARITY_STYLE_KEY);
    return v === 'local' || v === 'ai' ? v : 'default';
  } catch {
    return 'default';
  }
}

/** 写选中样式 */
export function mtSetCharityStyle(style: MtCharityStyle): void {
  try {
    localStorage.setItem(MT_CHARITY_STYLE_KEY, style);
  } catch {
    /* 隐私模式忽略 */
  }
}

/** 读自定义图槽 dataURL（无 / 坏数据 = 空串；弹层预览与格子缩略图共用） */
export function mtGetCharityImg(kind: 'local' | 'ai'): string {
  const v = kvGet(charityImgKeyOf(kind)) as unknown;
  return typeof v === 'string' && v.startsWith('data:image/') ? v : '';
}

/** 写 / 清除自定义图槽（src=null 删除） */
export function mtSetCharityImg(kind: 'local' | 'ai', src: string | null): void {
  if (src === null) {
    kvDel(charityImgKeyOf(kind));
    return;
  }
  kvSet(charityImgKeyOf(kind), src);
}

/** 当前样式应展示的图片 src（自定义槽为空时回退默认图，永不空白） */
export function mtCharitySrcOf(style: MtCharityStyle): string {
  if (style === 'local' || style === 'ai') {
    const img = mtGetCharityImg(style);
    if (img) return img;
  }
  return MT_CHARITY_DEFAULT_SRC;
}

// ---------------- AI 生成：公益主题场景池 ----------------

/** 公益场景池：每次 AI 生成随机挑一条（多次生成不重样；提示词要求无文字防乱码海报） */
export const MT_CHARITY_SCENES: string[] = [
  '绿色山坡上志愿者一起种树苗，阳光明媚',
  '志愿者在海边捡拾塑料垃圾，净滩行动，蓝天大海',
  '志愿者给山区孩子们捐书，孩子们开心阅读',
  '年轻人搀扶老奶奶过马路，温暖街景',
  '志愿者给流浪猫搭建小窝并喂食，温馨小巷',
  '志愿者在社区给老人理发量血压，敬老服务',
  '孩子们和志愿者一起给绿植浇水，社区花园',
  '志愿者骑共享单车宣传绿色出行，城市街道',
  '志愿者把食物装进爱心餐盒分发给需要的人',
  '志愿者在河边清理河道垃圾，守护绿水青山',
];

/** 随机挑一条公益场景描述（AI 生成的画面主体） */
export function mtRandomCharityScene(): string {
  return MT_CHARITY_SCENES[Math.floor(Math.random() * MT_CHARITY_SCENES.length)] ?? MT_CHARITY_SCENES[0];
}

/** AI 生成最终提示词拼装（画面场景 + 公益海报风格约束） */
export function mtCharityPrompt(scene: string): string {
  return `公益慈善海报插画：${scene}，扁平插画风格，明亮温暖的绿色与黄色调，画面干净无任何文字无水印，高质量`;
}
