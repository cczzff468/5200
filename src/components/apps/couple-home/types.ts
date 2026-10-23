'use client';

/**
 * 情侣小家 3D —— 类型定义（v5.3 四室一厅）
 *
 * - 客厅 9m × 6m + 卧室 6×5 + 厨房 6×5 + 卫生间 4×5，家具 MODEL_SCALE=2.0；
 * - 家具 (x, z) 底部中心，y 为抬升（电视上墙 / 空调上墙 / 物件上桌 / 吊灯挂顶）；
 * - ry = 任意角度水平旋转（弧度），rx = 俯仰旋转（弧度，钳 ±1.05）；
 * - col = 用户自选主色（编辑模式调色盘）；
 * - 窗户/门可编辑：winPos（每扇沿墙滑行坐标）/ doorPos（每扇门沿墙坐标）；
 * - 天花板四房间分开换色；fp = 第一人称视角；
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
  | 'plushPanda'
  | 'plushPig'
  | 'plushCat'
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
  | 'microwave'
  | 'pot'
  | 'kettle'
  | 'bowls'
  | 'plates'
  | 'chopsticks'
  | 'spoons'
  | 'cup'
  | 'juicer'
  | 'fan'
  | 'socket'
  | 'chandelier'
  | 'shower'
  | 'basin'
  | 'mirror'
  | 'towelRack'
  | 'laptop'
  | 'curtain'
  | 'fireplace'
  | 'fishtank'
  | 'beanbag'
  | 'piano'
  | 'guitar'
  | 'standingMirror'
  | 'starLamp'
  | 'canopy'
  | 'coffeeMaker'
  | 'fruitBasket'
  | 'wallShelf'
  | 'bathCurtain'
  | 'toiletries'
  | 'scale'
  // ---- v5.7 拾光扩展（用户选择清单 J1~J11） ----
  | 'projector'
  | 'screen'
  | 'swingChair'
  | 'shoeCabinet'
  | 'wallArt'
  | 'humidifier'
  | 'wineCabinet'
  | 'chessTable'
  | 'hotpotTable'
  | 'gameConsole'
  | 'flowerStand'
  // ---- v5.8 旋律扩展（B1 黑胶唱片机/八音盒） ----
  | 'vinyl'
  | 'musicBox'
  // ---- v5.9 节日限定（F1：按月份自动出现，商店不售） ----
  | 'xmasTree'
  | 'giftPile'
  | 'lantern'
  | 'springCouplet'
  | 'pumpkin'
  // ---- v5.9 阳台扩充（F4） ----
  | 'hammock'
  | 'bbq'
  | 'loungeOutdoor'
  | 'flowerBox'
  // ---- v5.9 墙面装饰（F5） ----
  | 'wallClock'
  | 'worldMap'
  | 'photoWallLove'
  // ---- v5.9 绿植系列（F6） ----
  | 'monstera'
  | 'cactus'
  | 'hydro'
  // ---- v5.9 毛绒伙伴（F7） ----
  | 'teddyBig'
  | 'pillowPile'
  | 'beanbagBlanket'
  // ---- v5.9 下午茶角（F8） ----
  | 'teaSet'
  | 'cakeStand';

/** 家具分类（商店栏的 tab；set = 成套摆放 F3） */
export type FurnCategory =
  | 'all'
  | 'sofa'
  | 'table'
  | 'bed'
  | 'lamp'
  | 'plant'
  | 'appliance'
  | 'bathroom'
  | 'kitchen'
  | 'decor'
  | 'set';

/** 单件家具实例（持久化最小单元） */
export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  /** 世界坐标：底部中心 */
  x: number;
  z: number;
  /** 抬升（米）：电视上墙 / 小物件放上桌面 / 吊灯挂顶；默认 0 贴地 */
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

/** 房间标识（小人在哪个房间，商店家具就添到哪个房间；bal = 阳台 v5.7） */
export type RoomId = 'lr' | 'br' | 'kt' | 'ba' | 'bal';

/** 家具状态（按需可选字段） */
export interface FurnitureState {
  /** 灯 / 电视 / 收音机 / 空调 / 风扇 / 吊灯：开 = true */
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
  /** 浴缸/淋浴：水龙头放水中 */
  bathWater?: boolean;
  /** 电视频道（0=关机不算，1..N 频道） */
  channel?: number;
  /** 鱼缸：上次投喂时间戳（Date.now()，6 秒内鱼加速聚食） */
  fedAt?: number;
  /** 咖啡机：煮咖啡中 */
  brewing?: boolean;
  /** 火锅桌：炉火开着（汤底沸腾冒泡）——复用 on 亦可，此字段预留 */
  simmer?: boolean;
  /** 棋盘桌：上一局的残局（编辑模式存档不丢） */
  chess?: number[];
  /** 灯具自选光色（#rrggbb；E7 灯光氛围：台灯/落地灯/星空灯可调，undefined = 目录默认暖光） */
  lc?: string;
}

/** 小人身份（guest = 邀请来做客的 AI 联系人，v5.7） */
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

/** 三/四扇门沿墙坐标（卧室门/厨房门在 z=3 隔墙上沿 x 滑动；卫生间门在 x=7.5 墙上沿 z 滑动；bal = 阳台门 v5.7） */
export interface DoorPos {
  bed: number;
  kt: number;
  bath: number;
  bal?: number;
}

/** 小家整体持久化数据（服务端 JSON 快照） */
export interface HomeState {
  /** 数据版本：5 = 3D 时代（四室一厅靠增量迁移，不换版本号） */
  v: 5;
  furniture: FurnitureItem[];
  chars: Record<CharId, { x: number; z: number; dir: CharDir }>;
  /** 昼夜：true = 夜晚 */
  night: boolean;
  /** 窗户开态（9 扇：客厅北×2 / 客厅西 / 卧室西 / 卧室南 / 厨房东 / 厨房南 / 卫生间北 / 卫生间东） */
  win?: boolean[];
  /** 每扇窗沿墙滑行坐标（undefined = 默认位） */
  winPos?: number[];
  /** 三扇门沿墙坐标（undefined = 默认位） */
  doorPos?: DoorPos;
  /** 地板自定义色（#rrggbb；缺省 = 默认云白；客厅） */
  floorCol?: string;
  /** 墙壁自定义色（#rrggbb；缺省 = 默认暖白；客厅） */
  wallCol?: string;
  /** 卧室地板自定义色 */
  floorColBed?: string;
  /** 卧室墙壁自定义色 */
  wallColBed?: string;
  /** 厨房地板自定义色 */
  floorColK?: string;
  /** 厨房墙壁自定义色 */
  wallColK?: string;
  /** 卫生间地板自定义色 */
  floorColB?: string;
  /** 卫生间墙壁自定义色 */
  wallColB?: string;
  /** 天花板自定义色（客厅/卧室/厨房/卫生间 分开换色） */
  ceilCol?: string;
  ceilColBed?: string;
  ceilColK?: string;
  ceilColB?: string;
  /** 卧室门开态（开 = 小人可以穿过门洞进出卧室） */
  doorOpen?: boolean;
  /** 厨房门开态 */
  kitchenDoorOpen?: boolean;
  /** 卫生间门开态 */
  bathDoorOpen?: boolean;
  /** 门自定义色（#rrggbb；缺省 = 默认暖白；全屋通用） */
  doorCol?: string;
  /** 窗框自定义色（#rrggbb；缺省 = 默认浅木白） */
  winCol?: string;
  /** 第一人称视角（true = 小人就是「我」） */
  fp?: boolean;
  /** 小人画风：cartoon = Q版卡通 / real = 拟真（默认 cartoon） */
  charStyle?: 'cartoon' | 'real';
  /** 昼夜跟随真实时间（手动点太阳/月亮后变 false） */
  nightAuto?: boolean;
  /** 「我」正在进行的家具动作（重进页面恢复姿势；家具被删则忽略） */
  act?: { type: CharAction['type']; itemId: string };
  /** 「我」的穿搭编号（衣柜换装；0=默认，1/2=换色套装） */
  outfit?: number;
  /** 地板纹理：wood = 木纹条（默认）/ plain = 素色 / check = 大格瓷砖（全屋通用、颜色仍分房间） */
  floorTex?: 'plain' | 'wood' | 'check';
  /** 墙面纹理：dot = 碎花 / stripe = 细条纹（缺省素色，全屋通用、颜色仍分房间） */
  wallTex?: 'plain' | 'dot' | 'stripe';
  /** 做饭系统：一桌好菜已上桌（去餐桌「开饭」） */
  mealReady?: boolean;
  /** 做饭小游戏：本次上桌的菜名（端上桌显示 + 开饭 toast） */
  mealName?: string;
  /** 阳台门开态（v5.7 阳台房间） */
  balconyDoorOpen?: boolean;
  /** 阳台地板/墙自定义色 */
  floorColBal?: string;
  wallColBal?: string;
}

/** 家具目录条目（静态配置，不持久化） */
export interface CatalogEntry {
  kind: FurnitureKind;
  /** GLB 路径（程序化建模的没有） */
  glb?: string;
  /** 开门态 GLB（纸箱这类无独立门节点的换模型） */
  glbAlt?: string;
  name: string;
  cat: FurnCategory;
  /** 占位脚印（世界米，未旋转时 x×z，已含 MODEL_SCALE 与 scale） */
  fp: [number, number];
  /** 非均匀缩放（xyz 各轴乘子，在 MODEL_SCALE 之上；用于拉宽电视柜等单件适配） */
  scale?: [number, number, number];
  /** 非客厅家具：商店暂不展示 */
  hidden?: boolean;
  /** 挂墙件（相框/插座/电视）：购买/拖拽后自动吸附到最近的墙 */
  wallMount?: boolean;
  /** 挂墙件的默认挂高（米；缺省 1.45） */
  wallY?: number;
  /** 家具实测高度（米，用于挂墙件避让高家具） */
  h?: number;
  /** 交互能力 */
  acts: {
    /** 点击开/关（灯、电视、收音机、空调、风扇、吊灯、淋浴、壁炉、星空灯） */
    toggle?: boolean;
    /** 可开门（有 door 节点或 glbAlt） */
    door?: boolean;
    /** 洗衣机专属流程 */
    washer?: boolean;
    /** 点击弹跳 */
    playful?: boolean;
    /** 相框：点击从手机上传照片 */
    photo?: boolean;
    /** 投喂（鱼缸）：点一下撒鱼食，6 秒鱼群聚食 */
    feed?: boolean;
    /** 照镜子：小人走过去对镜自照（微微摆 pose） */
    mirror?: { y?: number; dx?: number; dz?: number; out?: [number, number] };
    /** 做饭：小人走到灶台前颠勺，数秒后一桌好菜上餐桌 */
    cook?: { y: number; dx?: number; dz?: number; out?: [number, number] };
    /** 开饭：饭菜已上桌，小人坐到餐桌边吃饭（按钮变「吃饱啦」）；ryOff = 朝向偏移（坐东缘面朝桌心） */
    eat?: { y: number; dx?: number; dz?: number; ryOff?: number; out?: [number, number] };
    /** 喝东西：小人走到冰箱前拿杯喝的（自动开门，喝完自动结束） */
    drink?: { y: number; dx?: number; dz?: number; out?: [number, number] };
    /** 换装：小人走到衣柜前换一套穿搭（自动开门，换完自动结束） */
    dress?: { y?: number; dx?: number; dz?: number; out?: [number, number] };
    /** 演奏乐器：piano 坐琴凳弹 / guitar 站着抱琴弹（音符飘出） */
    play?: { y: number; dx?: number; dz?: number; ryOff?: number; out?: [number, number] };
    /** 化妆：小人坐到梳妆台前补妆（星星特效） */
    makeup?: { y: number; dx?: number; dz?: number; out?: [number, number] };
    /** 可坐：点击出「坐下」按钮，小人走过去坐下（按钮变「站起来」） */
    seat?: { y: number; dx?: number; dz?: number };
    /** 可睡：点击出「睡觉」按钮，小人走过去躺上床（按钮变「起床」，头朝枕头 + Zzz 特效）；
     *  ryOff = 躺下朝向偏移（吊床等长轴沿 x 的家具用，让小人躺在长轴上而非横跨）；
     *  out = 起身落点（局部坐标，锚点缺省时用） */
    sleep?: { y: number; dz?: number; ryOff?: number; out?: [number, number] };
    /**
     * 可泡澡/淋浴：小人脱衣走进浴缸或淋浴房（按钮变「出来」）；out = 起身落点（局部坐标）；
     * stand = 站姿淋浴（花洒自动开水）；ryOff = 朝向偏移；浴缸水龙头可放水
     */
    bath?: {
      y: number;
      dx?: number;
      dz?: number;
      stand?: boolean;
      ryOff?: number;
      out?: [number, number];
    };
    /** 可看：点击出「看电视」按钮，小人坐到电视前地板上（电视自动开机，按钮变「关电视」） */
    watch?: { y: number; dz?: number };
    /** 可用：点击出「上网」按钮，小人坐到电脑前敲键盘（屏幕自动亮起，按钮变「休息一下」） */
    work?: { y: number; dz?: number };
    /** 打游戏：小人走到主机前坐下开玩（同 work 的坐姿；屏幕/电视自动亮） */
    game?: { y: number; dz?: number };
    /** 端一杯咖啡：小人走到咖啡机前煮一杯端着逛（热气袅袅，同 drink 的自由走动） */
    coffee?: { y: number; dx?: number; dz?: number; out?: [number, number] };
    /** 阅读：书架标记（点击抽一本书，走到最近的沙发/椅子坐下翻页看） */
    read?: boolean;
    /** 吃火锅：小人坐到火锅桌边涮火锅（炉火自动开，吃到饱手动起身）；ryOff = 朝向偏移（坐东缘面朝锅） */
    hotpot?: { y: number; dx?: number; dz?: number; ryOff?: number; out?: [number, number] };
  };
  /** 是灯具：开着时附加点光（y 为相对家具原点的灯高） */
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

/**
 * 小人姿势：站立 / 坐下 / 躺床 / 泡澡（脱衣坐浴缸）/ 淋浴（脱衣站淋浴房）/
 * 做饭 / 吃饭 / 喝东西 / 弹琴 / 弹吉他 / 化妆 / 照镜子（game 复用 sit）/ 坐着看书
 */
export type CharPose =
  | 'stand'
  | 'sit'
  | 'lie'
  | 'bath'
  | 'shower'
  | 'cook'
  | 'eat'
  | 'drink'
  | 'piano'
  | 'guitar'
  | 'makeup'
  | 'mirror'
  | 'read';

/** 小人画风 */
export type CharStyle = 'cartoon' | 'real';

/** 小人正在执行的家具动作（走向家具 → 摆姿势） */
export interface CharAction {
  type:
    | 'sit'
    | 'lie'
    | 'bath'
    | 'shower'
    | 'watch'
    | 'work'
    | 'cook'
    | 'eat'
    | 'drink'
    | 'play'
    | 'makeup'
    | 'mirror'
    | 'dress'
    | 'game'
    | 'hotpot'
    | 'coffee'
    | 'read';
  itemId: string;
  /** 目标落点（世界坐标）与朝向、坐垫高度 */
  tx: number;
  tz: number;
  ry: number;
  y: number;
  /** 起身落点（世界坐标；结束动作时小人自然走下家具落在这里） */
  ox?: number;
  oz?: number;
  /** 已走到位（姿势已摆好） */
  arrived?: boolean;
  /** 到位后摆的姿势（缺省按 type 查 POSE_OF_ACT；play 乐器按 kind 分流钢琴/吉他） */
  pose?: CharPose;
  /** 走到位后的回调（GameLoop 触发一次；拿饮料 → 开门取杯进入「端着逛」模式） */
  onArrive?: () => void;
}

/** 模式 */
export type HomeMode = 'live' | 'edit';
