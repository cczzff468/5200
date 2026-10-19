'use client';

/**
 * 情侣小家 3D —— 类型定义（v5·两室一厅）
 *
 * - 客厅 9m × 6m + 卧室 6m × 5m（南侧推门相通），家具 MODEL_SCALE=2.0；
 * - 家具 (x, z) 底部中心，y 为抬升（电视上墙 / 空调上墙 / 物件上桌）；
 * - ry = 任意角度水平旋转（弧度），rx = 俯仰旋转（弧度，钳 ±1.05）；
 * - col = 用户自选主色（编辑模式调色盘）；
 * - 两个模式：live（摇杆+跟随镜头+家具交互）/ edit（俯瞰+拖拽+旋转+调色+商店）。
 */

/** 家具种类（catalog 的 key） */
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
  | 'aircon'
  | 'photoFrame'
  | 'photoWall'
  | 'photoWallWide'
  | 'polaroid'
  | 'plushBunny'
  | 'plushDuck'
  | 'vanity'
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
  /** 世界坐标：底部中心 */
  x: number;
  z: number;
  /** 抬升（米）：电视上墙 / 小物件放上桌面；默认 0 贴地 */
  y?: number;
  /** 水平旋转（弧度，任意角度；π = 面向北） */
  ry?: number;
  /** 俯仰旋转（弧度，钳 ±1.05 ≈ ±60°） */
  rx?: number;
  /** 用户自选主色（#rrggbb；undefined = 目录默认白色系） */
  col?: string;
  /** 家具私有状态（开关/门/洗衣等） */
  st: FurnitureState;
}

/** 房间标识（小人在哪个房间，商店家具就添到哪个房间） */
export type RoomId = 'lr' | 'br' | 'kt';

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
  /** playful 上次互动时间戳（弹跳冷却） */
  lastTouch?: number;
  /** 相框照片（压缩后 dataURL，永久保存在档案里） */
  photo?: string;
}

/** 小人身份 */
export type CharId = 'me' | 'partner';

/** 小人朝向（持久化 4 向） */
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
  /** 数据版本：5 = 两室一厅（客厅+卧室+门+空调+相框）；不匹配则重播种默认布局 */
  v: 5;
  furniture: FurnitureItem[];
  chars: Record<CharId, { x: number; z: number; dir: CharDir }>;
  /** 昼夜：true = 夜晚 */
  night: boolean;
  /** 窗户开态（5 扇：客厅北×2 / 客厅西 / 卧室西 / 卧室南；缺省全关） */
  win?: boolean[];
  /** 地板自定义色（#rrggbb；缺省 = 默认云白；客厅） */
  floorCol?: string;
  /** 墙壁自定义色（#rrggbb；缺省 = 默认暖白；客厅） */
  wallCol?: string;
  /** 卧室地板自定义色（#rrggbb；缺省 = 默认云白；客厅卧室分开换色） */
  floorColBed?: string;
  /** 卧室墙壁自定义色（#rrggbb；缺省 = 默认暖白；客厅卧室分开换色） */
  wallColBed?: string;
  /** 卧室门开态（开 = 小人可以穿过门洞进出卧室） */
  doorOpen?: boolean;
  /** 门自定义色（#rrggbb；缺省 = 默认暖白） */
  doorCol?: string;
  /** 窗框自定义色（#rrggbb；缺省 = 默认浅木白） */
  winCol?: string;
  /** 厨房门开态（开 = 小人可以穿过门洞进出厨房） */
  kitchenDoorOpen?: boolean;
  /** 厨房地板自定义色（#rrggbb；缺省 = 默认云白；三房间分开换色） */
  floorColK?: string;
  /** 厨房墙壁自定义色（#rrggbb；缺省 = 默认暖白；三房间分开换色） */
  wallColK?: string;
}

/** 家具目录条目（静态配置，不持久化） */
export interface CatalogEntry {
  kind: FurnitureKind;
  /** GLB 路径（tv 为程序化建模，无 GLB） */
  glb?: string;
  /** 开门态 GLB（纸箱这类无独立门节点的换模型） */
  glbAlt?: string;
  name: string;
  cat: FurnCategory;
  /** 占位脚印（世界米，未旋转时 x×z，已含 MODEL_SCALE 与 scale） */
  fp: [number, number];
  /** 非均匀缩放（xyz 各轴乘子，在 MODEL_SCALE 之上；用于拉宽电视柜等单件适配） */
  scale?: [number, number, number];
  /** 卧室/厨卫等非客厅家具：商店暂不展示（客厅完成后陆续开放） */
  hidden?: boolean;
  /** 挂墙件（相框/电视）：购买/拖拽后自动吸附到最近的墙，y 即挂高 */
  wallMount?: boolean;
  /** 家具实测高度（米，用于挂墙件避让高家具） */
  h?: number;
  /** 交互能力 */
  acts: {
    /** 点击开/关（灯、电视、收音机、空调） */
    toggle?: boolean;
    /** 可开门（有 door 节点或 glbAlt） */
    door?: boolean;
    /** 洗衣机专属流程 */
    washer?: boolean;
    /** 点击弹跳 */
    playful?: boolean;
    /** 相框：点击从手机上传照片 */
    photo?: boolean;
  };
  /** 是灯具：开着时附加点光（y 为灯高） */
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
