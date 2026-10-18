'use client';

/**
 * 情侣小家（客厅篇）—— 类型定义
 *
 * 世界坐标：原点在房间左上，x 向右、y 向下；所有可摆放物（家具/小人）的 (x, y)
 * 一律表示「底部中心」（脚底/接地线），渲染层级 zIndex = round(y)，
 * 由此自然形成「越靠下越靠前」的俯视深度关系。
 */

/** 家具种类（对应 catalog 里的定义） */
export type FurnitureKind =
  | 'sofa'
  | 'sofaLong'
  | 'coffeeTable'
  | 'rug'
  | 'tvCabinet'
  | 'tv'
  | 'lampRound'
  | 'lampSquare'
  | 'wardrobe'
  | 'washer'
  | 'fridge'
  | 'plant'
  | 'plantSmall'
  | 'speaker'
  | 'sideTable'
  | 'trashcan'
  | 'tableRound'
  | 'chair'
  | 'box'
  | 'books'
  | 'pillow';

/** 单件家具实例（持久化的最小单元） */
export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  /** 世界坐标：底部中心 */
  x: number;
  y: number;
  /** 家具私有状态（开/关、衣物等） */
  st: FurnitureState;
}

/** 家具状态（按需可选字段） */
export interface FurnitureState {
  /** 灯 / 电视：开 = true */
  on?: boolean;
  /** 衣橱 / 纸箱：门开 = true */
  open?: boolean;
  /** 衣橱 / 洗衣机内的衣物 id 列表 */
  clothes?: string[];
  /** 洗衣机：运转中 */
  washing?: boolean;
  /** 洗衣机：洗好待取 */
  washDone?: boolean;
  /** 洗衣机：本次运转开始时间戳（算进度用） */
  washStart?: number;
}

/** 小人身份 */
export type CharId = 'me' | 'partner';

/** 小人状态 */
export interface CharState {
  id: CharId;
  x: number;
  y: number;
  /** 朝向（billboard 纸片人：翻转贴图即可） */
  dir: 'left' | 'right';
  moving?: boolean;
}

/** 小家整体持久化数据 */
export interface HomeState {
  furniture: FurnitureItem[];
  chars: Record<CharId, CharState>;
  /** 昼夜：true = 夜晚（夜晚房间变暗，灯具光晕更醒目） */
  night: boolean;
}

/** 衣物目录条目 */
export interface ClothDef {
  id: string;
  /** 展示 emoji（俯视小家里不画衣服贴图，用 emoji 徽章直观可爱） */
  emoji: string;
  name: string;
  color: string;
}

/** 家具目录条目（静态配置，不持久化） */
export interface CatalogEntry {
  kind: FurnitureKind;
  /** 贴图路径（关/默认态） */
  img: string;
  /** 贴图路径（开门态；无则为 null） */
  imgOpen?: string;
  /** 显示宽 px（世界坐标下）；高按贴图纵横比推算 */
  w: number;
  /** 名称（浮层/气泡用） */
  name: string;
  /** 交互能力 */
  acts: {
    /** 点击开/关（灯、电视等） */
    toggle?: boolean;
    /** 可开门（衣橱、纸箱） */
    door?: boolean;
    /** 洗衣机专用流程 */
    washer?: boolean;
    /** 点击仅弹跳+气泡反馈 */
    playful?: boolean;
  };
  /** 点击气泡文案（playful 家具） */
  quips?: string[];
  /** 深度层级偏移（地毯等贴地物需要压在所有家具之下） */
  zBias?: number;
  /** 灯具光晕半径（世界 px；仅灯类） */
  glow?: number;
}

/** 摇杆输出（归一化 -1~1） */
export interface JoyVec {
  dx: number;
  dy: number;
}

/** 粒子（音符/爱心/泡泡反馈） */
export interface Particle {
  id: number;
  /** 世界坐标 */
  x: number;
  y: number;
  emoji: string;
  /** 随机偏移相位（渲染时计算弧线） */
  seed: number;
}
