'use client';

/**
 * 商家中心共享 UI 件（无 emoji 原则）：
 * - mtDishIcon：菜名关键词 → Lucide 线条图标（奶茶→杯、咖啡→咖啡、炸鸡→鸡腿…）；
 * - DishImg / ShopImg：有图显示图，无图显示「暖沙色渐变 + 线条图标」占位，
 *   替代旧版 emoji 大字兜底，保证商家中心全部界面图标风格统一。
 */
import { createElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Apple,
  Banana,
  Beer,
  Beef,
  CakeSlice,
  Candy,
  Citrus,
  Coffee,
  Cookie,
  CookingPot,
  CupSoda,
  Donut,
  Drumstick,
  Egg,
  EggFried,
  Fish,
  Grape,
  IceCreamCone,
  Milk,
  Pizza,
  Salad,
  Sandwich,
  Soup,
  Store,
  Utensils,
  UtensilsCrossed,
  Wheat,
} from 'lucide-react';

/** 关键词 → 图标（按名称匹配，越靠前优先） */
const DISH_ICON_RULES: [RegExp, LucideIcon][] = [
  [/奶茶|柠檬茶|水果茶|茶$|茶饮|汽水|苏打|可乐|雪碧|果汁|饮料|椰汁|酸梅/, CupSoda],
  [/咖啡|拿铁|摩卡|美式|生椰/, Coffee],
  [/牛奶|豆奶|酸奶|乳酪|奶盖|奶昔|纯牛奶/, Milk],
  [/冰淇淋|雪糕|圣代|冰沙|刨冰/, IceCreamCone],
  [/蛋糕|慕斯|提拉米苏|千层/, CakeSlice],
  [/甜甜圈|多拿滋/, Donut],
  [/面包|可颂|欧包|吐司|三明治|贝果|烘焙/, Sandwich],
  [/饼干|曲奇|泡芙|麻薯/, Cookie],
  [/糖果|棉花糖|软糖/, Candy],
  [/披萨|比萨/, Pizza],
  [/炸鸡|鸡排|鸡腿|鸡翅|鸡米花|烤鸡/, Drumstick],
  [/鱼|虾|蟹|鳗|海鲜|三文鱼|金枪鱼/, Fish],
  [/牛肉|肥牛|牛排|羊肉|猪肉|卤肉|红烧肉|排骨/, Beef],
  [/煎蛋|荷包蛋|太阳蛋/, EggFried],
  [/蛋挞|鸡蛋|蒸蛋|茶叶蛋|温泉蛋/, Egg],
  [/沙拉|蔬菜|青菜|西兰花|生菜|凉拌/, Salad],
  [/麻辣烫|火锅|冒菜|炖|煲/, CookingPot],
  [/粥|汤|银耳羹|炖品/, Soup],
  [/面|粉|米线|意面|拉面/, Wheat],
  [/米饭|炒饭|盖浇|煲仔饭|套餐|便当/, Utensils],
  [/苹果/, Apple],
  [/香蕉/, Banana],
  [/葡萄|提子/, Grape],
  [/橙|橘|柠檬|柚|柑/, Citrus],
  [/鸡尾酒|啤酒|酒/, Beer],
];

/** 菜名 → 线条图标（未命中回退通用餐具） */
export function mtDishIcon(name: string): LucideIcon {
  const n = name.trim();
  for (const [re, icon] of DISH_ICON_RULES) {
    if (re.test(n)) return icon;
  }
  return UtensilsCrossed;
}

/** 菜品缩略图：有图显示图，无图显示「渐变 + 线条图标」占位（商家中心内替代 emoji 兜底） */
export function DishImg({ name, img, className = '' }: { name: string; img?: string; className?: string }) {
  if (img) {
    return <img src={img} alt={name} draggable={false} className={`shrink-0 bg-[#F5F6F7] object-cover ${className}`} />;
  }
  // 菜名关键词 → 静态图标映射（createElement 规避“渲染期创建组件”误报）
  const Icon = mtDishIcon(name);
  return createElement(
    'span',
    { className: `flex shrink-0 items-center justify-center bg-gradient-to-br from-[#FFF4D9] via-[#FFEBC2] to-[#FFDF9E] ${className}`, 'aria-hidden': 'true' },
    createElement(Icon, { className: 'h-[34%] w-[34%] text-[#C9932B]', strokeWidth: 1.6 })
  );
}

/** 店铺封面图：有图显示图，无图显示「渐变 + 店铺图标」占位 */
export function ShopImg({ name, cover, className = '' }: { name: string; cover?: string; className?: string }) {
  if (cover) {
    return <img src={cover} alt={name} draggable={false} className={`shrink-0 bg-[#F5F6F7] object-cover ${className}`} />;
  }
  return (
    <span className={`flex shrink-0 items-center justify-center bg-gradient-to-br from-[#FFF1C3] via-[#FFE59A] to-[#FFD100]/80 ${className}`} aria-hidden="true">
      <Store className="h-[36%] w-[36%] text-[#9A6B12]" strokeWidth={1.6} />
    </span>
  );
}
