'use client';

/**
 * 情侣小家 —— 类型定义（2.5D 卡通写实版）
 *
 * 视角模型（Adorable Home 式正面 2.5D）：
 *  - 房间 = 背景墙（上）+ 大地板（下），玩家以「正面微俯视」观看；
 *  - 世界坐标：原点在房间左上，x 向右、y 向下；
 *  - 所有可摆放物（家具/小人）的 (x, y) 一律表示「底部中心」（贴地线）；
 *  - 渲染层级 zIndex = round(y)：越靠下（离镜头越近）越靠前，天然 2.5D 深度。
 *
 * 两个模式：
 *  - live（生活模式）：摇杆操控小人 + 镜头跟随小人 + 点家具交互；
 *  - edit（编辑/装修模式）：上帝视角看全屋、拖拽家具、商店购买、翻转/删除、昼夜切换。
 */

/** 家具种类（catalog 的 key） */
export type FurnitureKind =
  | 'sofa'
  | 'sofaLong'
  | 'coffeeTable'
  | 'rug'
  | 'tvStand'
  | 'tv'
  | 'recordPlayer'
  | 'speaker'
  | 'sideTable'
  | 'lampFloor'
  | 'lampTable'
  | 'plantMonstera'
  | 'plantSmall'
  | 'pillow'
  | 'cat'
  | 'trashcan'
  | 'books'
  | 'box'
  | 'bed'
  | 'nightstand'
  | 'wardrobe'
  | 'tableDining'
  | 'chair'
  | 'fridge'
  | 'stove'
  | 'washer';

/** 家具分类（商店栏的 tab） */
export type FurnCategory = 'all' | 'sofa' | 'table' | 'bed' | 'lamp' | 'plant' | 'appliance' | 'decor';

/** 单件家具实例（持久化最小单元） */
export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  /** 世界坐标：底部中心 */
  x: number;
  y: number;
  /** 翻转（镜像朝向） */
  flip?: boolean;
  /** 家具私有状态（开关/门/衣物等） */
  st: FurnitureState;
}

/** 家具状态（按需可选字段） */
export interface FurnitureState {
  /** 灯 / 电视 / 唱机：开 = true */
  on?: boolean;
  /** 衣橱 / 冰箱 / 纸箱：门开 = true */
  open?: boolean;
  /** 衣橱 / 洗衣机内的衣物 id 列表 */
  clothes?: string[];
  /** 洗衣机：运转中 */
  washing?: boolean;
  /** 洗衣机：洗好待取 */
  washDone?: boolean;
  /** 洗衣机：本次运转开始时间戳 */
  washStart?: number;
}

/** 小人身份 */
export type CharId = 'me' | 'partner';

/** 小人朝向（决定贴图：背面=向上走远离镜头 / 正面=向下走朝镜头 / 侧向=左右） */
export type CharDir = 'up' | 'down' | 'left' | 'right';

/** 小人运行时状态 */
export interface CharState {
  id: CharId;
  x: number;
  y: number;
  dir: CharDir;
  moving?: boolean;
}

/** 小家整体持久化数据（服务端 JSON 快照） */
export interface HomeState {
  furniture: FurnitureItem[];
  chars: Record<CharId, { x: number; y: number; dir: CharDir }>;
  /** 昼夜：true = 夜晚 */
  night: boolean;
}

/** 衣物目录条目（衣橱/洗衣机流程用） */
export interface ClothDef {
  id: string;
  emoji: string;
  name: string;
  color: string;
}

/** 家具目录条目（静态配置，不持久化） */
export interface CatalogEntry {
  kind: FurnitureKind;
  /** 贴图路径（关/默认态） */
  img: string;
  /** 贴图路径（开门态；无则 null） */
  imgOpen?: string;
  /** 显示宽（世界 px）；高按贴图纵横比推算 */
  w: number;
  name: string;
  /** 商店分类 */
  cat: FurnCategory;
  /** 商店售价（金币）；0 = 免费的基础件 */
  price: number;
  /** 交互能力 */
  acts: {
    /** 点击开/关（灯、电视、唱机） */
    toggle?: boolean;
    /** 可开门（衣橱、冰箱、纸箱） */
    door?: boolean;
    /** 洗衣机专属流程 */
    washer?: boolean;
    /** 点击弹跳+气泡+少量金币 */
    playful?: boolean;
  };
  /** playful 家具的点击气泡文案 */
  quips?: string[];
  /** 深度偏移（地毯等贴地物压在一切之下） */
  zBias?: number;
  /** 灯具光晕半径（世界 px，仅灯类/电视夜光） */
  glow?: number;
  /** 夜晚自发光强度 0~1（灯罩/屏幕，越大夜光越亮） */
  emissive?: number;
  /** 是否可翻转（多数可；地毯/电视等对称物关闭以省 UI） */
  flippable?: boolean;
}

/** 摇杆输出（归一化 -1~1） */
export interface JoyVec {
  dx: number;
  dy: number;
}

/** 粒子（爱心/音符/泡泡/金币反馈） */
export interface Particle {
  id: number;
  x: number;
  y: number;
  emoji: string;
  seed: number;
}

/** 编辑模式选中操作 */
export type EditAction = 'rotate' | 'delete';
