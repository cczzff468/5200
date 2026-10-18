'use client';

/**
 * 情侣小家 3D —— 类型定义
 *
 * 真实 3D 场景（three.js / react-three-fiber）：
 *  - 房间为 9m × 6m 的开间，家具用 Kenney Furniture Kit（CC0）低多边形 GLB 模型；
 *  - 世界坐标：原点在房间中心地面，x 向右、z 向屏幕内、y 向上；
 *  - 家具 (x, z) 表示「底部中心」，r 为绕 Y 轴的旋转（0/1/2/3 → 0°/90°/180°/270°）；
 *  - 两个模式：live（生活：摇杆+跟随镜头+点家具交互）/ edit（装修：俯瞰+拖拽+旋转+商店）。
 */

/** 家具种类（catalog 的 key，对应 public/models/furniture/<kind>.glb） */
export type FurnitureKind =
  | 'sofa'
  | 'sofaLong'
  | 'loungeChair'
  | 'ottoman'
  | 'coffeeTable'
  | 'diningTable'
  | 'chair'
  | 'sideTable'
  | 'bed'
  | 'bedSingle'
  | 'nightstand'
  | 'rug'
  | 'rugRect'
  | 'doormat'
  | 'tv'
  | 'tvStand'
  | 'speaker'
  | 'radio'
  | 'lampFloor'
  | 'lampTable'
  | 'plant'
  | 'plantSmall'
  | 'bookcase'
  | 'wardrobe'
  | 'books'
  | 'bear'
  | 'box'
  | 'trashcan'
  | 'fridge'
  | 'stove'
  | 'sink'
  | 'kitchenBar'
  | 'washer'
  | 'bathtub'
  | 'toilet'
  | 'desk'
  | 'coatRack'
  | 'toaster'
  | 'microwave';

/** 家具分类（商店栏的 tab） */
export type FurnCategory =
  | 'all'
  | 'sofa'
  | 'table'
  | 'bed'
  | 'lamp'
  | 'plant'
  | 'appliance'
  | 'bathroom'
  | 'decor';

/** 单件家具实例（持久化最小单元） */
export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  /** 世界坐标：底部中心（地面） */
  x: number;
  z: number;
  /** 绕 Y 轴旋转步数：0/1/2/3 → 0°/90°/180°/270° */
  r?: number;
  /** 家具私有状态（开关/门/洗衣等） */
  st: FurnitureState;
}

/** 家具状态（按需可选字段） */
export interface FurnitureState {
  /** 灯 / 电视 / 收音机：开 = true */
  on?: boolean;
  /** 衣橱 / 冰箱 / 纸箱 / 洗衣机门：开 = true */
  open?: boolean;
  /** 洗衣机：运转中 */
  washing?: boolean;
  /** 洗衣机：洗好待取 */
  washDone?: boolean;
  /** 洗衣机：本次运转开始时间戳 */
  washStart?: number;
  /** playful 上次互动时间戳（金币冷却用，不持久化也可） */
  lastTouch?: number;
}

/** 小人身份 */
export type CharId = 'me' | 'partner';

/** 小人朝向（3D：heading 弧度也行，这里存 4 向便于持久化） */
export type CharDir = 'up' | 'down' | 'left' | 'right';

/** 小人持久化状态 */
export interface CharState {
  id: CharId;
  x: number;
  z: number;
  dir: CharDir;
}

/** 小家整体持久化数据（服务端 JSON 快照） */
export interface HomeState {
  /** 数据版本：3 = 3D 版；不匹配则重播种默认布局 */
  v: 3;
  furniture: FurnitureItem[];
  chars: Record<CharId, { x: number; z: number; dir: CharDir }>;
  /** 昼夜：true = 夜晚 */
  night: boolean;
}

/** 家具目录条目（静态配置，不持久化） */
export interface CatalogEntry {
  kind: FurnitureKind;
  /** GLB 路径 */
  glb: string;
  /** 开门态 GLB（纸箱这类无独立门节点的换模型） */
  glbAlt?: string;
  name: string;
  cat: FurnCategory;
  /** 商店售价（金币）；0 = 免费基础件 */
  price: number;
  /** 占位脚印（世界米，未旋转时 x×z），选中光圈/碰撞用 */
  fp: [number, number];
  /** 交互能力 */
  acts: {
    /** 点击开/关（灯、电视、收音机） */
    toggle?: boolean;
    /** 可开门（有 door 节点或 glbAlt） */
    door?: boolean;
    /** 洗衣机专属流程 */
    washer?: boolean;
    /** 点击弹跳 + 少量金币 */
    playful?: boolean;
  };
  /** 是灯具/屏幕：开着时附加点光（y 为灯高） */
  light?: { y: number; color?: string; intensity?: number };
  /** 模型朝向微调（弧度，绕 Y） */
  yaw?: number;
  /** 贴地物（地毯/地垫）：渲染在地面之上、无碰撞 */
  flat?: boolean;
}

/** 运行时小人（ref 中高频更新，不入 React state） */
export interface CharRT {
  x: number;
  z: number;
  /** 朝向弧度（atan2(vx, vz)，0 = 面 +z） */
  heading: number;
  moving: boolean;
  /** 漫游目标（partner 用） */
  target: { x: number; z: number } | null;
  nextWander: number;
}

/** 模式 */
export type HomeMode = 'live' | 'edit';
