/**
 * 拾光小屋 —— 女主衣柜数据表（v6.2）
 *
 * CharChibi3D（3D 渲染取色）与 Wardrobe.tsx（弹窗图标取色）共用，
 * 数组顺序即衣柜弹窗展示顺序，索引持久化在 HomeState.wear。
 */

/** 连衣裙：c 主体色 / trim 装饰白边&腰线&胸饰 / bow 发饰蝴蝶结 */
export const DRESSES: { name: string; c: string; trim: string; bow: string }[] = [
  { name: '樱粉连衣裙', c: '#f7c6d2', trim: '#ffffff', bow: '#f591ac' },
  { name: '薄荷奶昔裙', c: '#c2e4d2', trim: '#ffffff', bow: '#8fd0b4' },
  { name: '奶油杏子裙', c: '#f6dfb2', trim: '#fff8ee', bow: '#f0b45c' },
  { name: '香芋奶紫裙', c: '#dcc8ec', trim: '#ffffff', bow: '#bb9fd9' },
];

/** 分体上衣：c 主体色 / bow 发饰蝴蝶结配色 */
export const TOPS: { name: string; c: string; bow: string }[] = [
  { name: '奶白卫衣', c: '#f7f1e3', bow: '#f591ac' },
  { name: '樱粉针织衫', c: '#f4c3cf', bow: '#e87f9c' },
  { name: '薄荷T恤', c: '#c9e8da', bow: '#8fd0b4' },
  { name: '鹅黄毛衣', c: '#f5d98f', bow: '#e8b45c' },
];

/** 分体下装：skirt 裙子（保留过膝袜）/ short 短裤（大腿裤色+小腿袜）/ long 长裤（全腿裤色） */
export const BOTTOMS: { name: string; c: string; kind: 'skirt' | 'short' | 'long' }[] = [
  { name: '白色百褶裙', c: '#ffffff', kind: 'skirt' },
  { name: '樱粉短裙', c: '#f4b3c2', kind: 'skirt' },
  { name: '藏蓝短裤', c: '#46536b', kind: 'short' },
  { name: '牛仔长裤', c: '#7d94ad', kind: 'long' },
];

/** 鞋子：c 鞋面色 / trim 配件色（帆布鞋包边 / 玛丽珍袢带 / 短靴翻边） */
export const SHOES: { name: string; c: string; trim: string }[] = [
  { name: '棕色小皮鞋', c: '#b06a5a', trim: '#8a4f42' },
  { name: '白色帆布鞋', c: '#fbfaf7', trim: '#e8e2d8' },
  { name: '粉色玛丽珍', c: '#e88ca4', trim: '#c96a84' },
  { name: '米色小短靴', c: '#c9a886', trim: '#ab8a68' },
];

/** 发型名（与 GirlHairStyle 一一对应） */
export const HAIR_NAMES: Record<string, string> = {
  twin: '双马尾',
  high: '高马尾',
  bob: '短发',
  straight: '长直发',
  wave: '大波浪',
};
