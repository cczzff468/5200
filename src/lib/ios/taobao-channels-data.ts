/**
 * 淘宝频道页种子数据（第九轮需求）：
 * - 百亿补贴 / 淘宝秒杀 / 淘票票 / 飞猪旅行 / 红包签到 的静态展示数据；
 * - 与 taobao-data.ts 同架构：纯前端静态数据，图链复用 /api/mt-img 品类 tag；
 * - 频道商品可挂 pid（淘宝真实商品）→ 抢购直达商品详情下单链路。
 */

/** 百亿补贴频道 */

/** 百亿补贴商品条目 */
export interface TbSubsidyItem {
  id: string;
  title: string;
  price: string;
  /** 价格后缀（/180天最低 等） */
  unit: string;
  /** 已抢光（盖章态） */
  soldOut?: boolean;
  /** 底部榜单/销量文案（无 specs 时展示） */
  foot?: string;
  sub?: string;
  /** 划线价说明（优惠前N） */
  orig?: string;
  /** 三列规格（心相印抽纸） */
  specs?: string[];
  specLabels?: string[];
  tag: string;
  /** 映射淘宝真实商品 pid（有则抢购直达商品详情） */
  pid?: string;
}

export const TB_SUBSIDY = {
  /** 顶部四图横滑（大疆/耳机/冰箱/手机） */
  hero: [
    { tag: 'camera', label: '大疆免费升级' },
    { tag: 'earbuds', label: '¥66.9' },
    { tag: 'fridge', label: '¥1275.85' },
    { tag: 'phone', label: '¥2398' },
  ],
  /** 国家补贴 / 补上加补 / 多人团 / 水蛋奶 四宫格 */
  grid: [
    { kind: 'nation' as const, name: '国家补贴', price: '2608.65', extra: '', tag: 'phone' },
    { kind: 'boost' as const, name: '补上加补', price: '66', extra: '补10元', tag: 'jeans' },
    { kind: 'team' as const, name: '多人团', price: '18.9', extra: '补6元', tag: 'snacks' },
    { kind: 'milk' as const, name: '水蛋奶', price: '8.9', extra: '补1元', tag: 'fruit' },
  ],
  /** 频道惊喜权益红包（领取入账 tb-coupons） */
  redpackets: [
    { name: '惊喜红包10元', amount: 10, min: 50 },
    { name: '惊喜红包5元', amount: 5, min: 20 },
    { name: '惊喜红包2元', amount: 2, min: 5 },
  ],
  tabs: ['精选', '补上加补', '苹果专区', '手机', '女装', '数码', '箱包', '美妆', '食品'],
  items: [
    {
      id: 'sb1', title: 'OPPORe512GB+256GB2亿像素超清影像极光蓝', price: '3399', unit: '/180天最低',
      soldOut: true, foot: '已售10万+', sub: '正品发货 假一赔十', tag: 'phone', pid: 'p-phone-2',
    },
    {
      id: 'sb2', title: '鲸言 官方织物苹果18promax手机壳官方新款', price: '76', unit: '/5.9折', orig: '优惠前129',
      foot: '手机壳回购榜·前14名', sub: '红包已抵3 假一赔十', tag: 'backpack',
    },
    {
      id: 'sb3', title: '心相印抽纸110抽茶语6包', price: '10.01', unit: '/每包¥1.67',
      foot: '已售10万+', sub: '7天无理由退货', specs: ['原生浆', '110片', '心相印'], specLabels: ['原料成分', '片数', '品牌'], tag: 'bedding',
    },
    {
      id: 'sb4', title: '修眉剪刀指甲钳去死皮美妆工具九件套', price: '19.9', unit: '/3.3折', orig: '优惠前59.9',
      foot: '已售10万+', sub: '7天无理由退货', tag: 'makeup', pid: 'p-makeup-1',
    },
    {
      id: 'sb5', title: '真无线蓝牙耳机主动降噪超长续航官方旗舰', price: '66.9', unit: '/3折', orig: '优惠前199',
      foot: '已售2万+', sub: '正品发货 假一赔十', tag: 'earbuds', pid: 'p-earbuds-1',
    },
    {
      id: 'sb6', title: '直筒牛仔裤女2026春秋高腰显瘦垂感阔腿裤', price: '66', unit: '/补10元',
      foot: '已售8万+', sub: '退货宝 免费改长', tag: 'jeans', pid: 'p-jeans-1',
    },
  ] as TbSubsidyItem[],
};

/** 淘宝秒杀频道 */
export const TB_SECKILL = {
  /** 9块9品牌疯抢 / 0.99产地直发 */
  top: [
    { group: '9块9品牌疯抢', tag: 'watch', label: '已售4万+', price: '8.55' },
    { group: '9块9品牌疯抢', tag: 'powerbank', label: '热销80万+', price: '1.64' },
    { group: '0.99产地直发', tag: 'perfume', label: '已售1万+', price: '0.89' },
    { group: '0.99产地直发', tag: 'snacks', label: '已售3000+', price: '0.89/包' },
  ],
  tabs: ['精选', '3元3件', '拼团', '品牌精选', '女装', '玩具潮玩', '数码'],
  items: [
    { id: 'sk1', title: '二合一超长续航蓝牙耳机', grab: 62, sold: '已售2万+', foot: ['直降43元', '红包抵3元', '24小时发货'], price: '22.6', orig: '69', tag: 'earbuds', pid: 'p-earbuds-1' },
    { id: 'sk2', title: '蓝牙运动跑步传导耳机', grab: 33, sold: '全网热销40万+', foot: ['直降15元', '全网低价'], price: '17.76', orig: '32.9', tag: 'speaker', pid: 'p-earbuds-1' },
    { id: 'sk3', title: '无线降噪入耳蓝牙耳机', grab: 43, sold: '已售4000+', foot: ['直降9.99元', '全网低价'], price: '10.01', orig: '20', tag: 'earbuds', pid: 'p-earbuds-1' },
    { id: 'sk4', title: '智能手表运动血氧心率监测超长续航', grab: 51, sold: '已售1万+', foot: ['直降40元', '一年换新'], price: '8.55', orig: '49', tag: 'watch', pid: 'p-watch-1' },
  ],
};

/** 淘票票频道（热映/即将上映/影院） */
export interface TbMovie {
  id: string;
  title: string;
  rating?: number;
  want?: string;
  badge: string;
  c1: string;
  c2: string;
}

export const TB_MOVIES: TbMovie[] = [
  { id: 'm1', title: '生化危机：净化', rating: 8.0, badge: 'IMAX 2D', c1: '#33424D', c2: '#8B2F1F' },
  { id: 'm2', title: '神探之痕迹', rating: 9.5, badge: 'IMAX 2D', c1: '#4E4237', c2: '#2B2B2B' },
  { id: 'm3', title: '什么意思夫妇', rating: 9.0, badge: '纯爆笑剧', c1: '#F5A623', c2: '#E8452C' },
  { id: 'm4', title: '小猪佩奇·完美假期', rating: 9.1, badge: '2D', c1: '#8ED3F5', c2: '#F48FB1' },
];

export const TB_MOVIES_SOON: TbMovie[] = [
  { id: 's1', title: '群星闪耀时', rating: 9.7, badge: '重映', c1: '#1B2A4A', c2: '#C9A227' },
  { id: 's2', title: '生如夏花', want: '7521人想看', badge: '生日快乐', c1: '#7A4A3A', c2: '#3B2A24' },
  { id: 's3', title: '偷偷藏不住', want: '10.0万人想看', badge: 'IMAX 2D', c1: '#37576B', c2: '#1F3B4D' },
  { id: 's4', title: '真杀真刺激', rating: 9.6, badge: '权谋狠到位', c1: '#5A2D2D', c2: '#8C1F1F' },
];

export interface TbCinema {
  name: string;
  addr: string;
  dist: string;
  hot?: string;
  tags: string[];
  /** 近期场次（空 = 今天已放映完） */
  session?: string;
}

export const TB_CINEMAS: TbCinema[] = [
  { name: '台前县中影时光国际影城', addr: '台前县金水路与s101交叉口东南角建德购物广场…', dist: '78.2km', hot: '新人¥38起', tags: ['影城卡', '券包·3.3折起', '退票', '改签', '观影小食'], session: '21:00' },
  { name: '濮阳星光国际影城', addr: '华龙区江汉路与茂名中路交叉口西北角二楼', dist: '27.5km', tags: ['影城卡', '券包·3.3折起', '退票', '改签', '可停车'] },
  { name: '艾可为巨幕影城', addr: '华龙区濮东街道政德内环路西，苏北路南华龙区…', dist: '27.6km', tags: [] },
  { name: '濮阳市悦尚城奥斯卡影城（原百姓影院）', addr: '华龙区黄河路与丽都路交叉口东100米路北百姓生…', dist: '29.0km', tags: ['影城卡', '券包·3.3折起', '退票', '改签', '可停车'] },
  { name: '圣雅国际影城（丹尼斯店）', addr: '华龙区长庆中路与任丘路交叉口丹尼斯百货四层', dist: '29.2km', tags: ['影城卡', '券包·4.8折起', '退票', '改签', '观影小食', '可停车'] },
  { name: '濮阳奥斯卡兴隆影城铜锣湾店（全景声）', addr: '华龙区开州路与人民路交汇处铜锣湾北门', dist: '29.5km', tags: [] },
];

/** 影厅座位图：1 = 有座位；行 1-8；列 1-12（0 为走道） */
export const TB_SEAT_LAYOUT: number[][] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

/** 最佳观影区（0 基：行 4-6 × 列 4-8） */
export const TB_BEST_ZONE = { r1: 3, r2: 5, c1: 4, c2: 8 };

/** 座位已售（确定性伪随机：同一影厅每次一致） */
export function tbSeatSold(r: number, c: number): boolean {
  let h = (r * 131 + c * 37 + 11) >>> 0;
  h = (h ^ (h << 13)) >>> 0;
  h = (h ^ (h >> 7)) >>> 0;
  return h % 9 === 0;
}

/** 飞猪旅行频道 */
export const TB_FLIGGY = {
  chips: ['濮阳的酒店', '新加坡', '旅行租赁', '民宿公寓', '政府补贴'],
  flights: [
    { from: '安阳', to: '成都', price: '310', off: '2.6折' },
    { from: '安阳', to: '广州', price: '590', off: '3.8折' },
    { from: '安阳', to: '沈阳', price: '250', off: '2.0折' },
  ],
  hotels: [
    { name: '濮阳忆江南华尔尼酒店', price: '69', reviews: '700+条点评', tag: 'bedding' },
    { name: '格彬斯顿酒店（海斯顿公园店）', price: '132', reviews: '320+条点评', tag: 'sofa' },
    { name: '海友濮阳体育场京开大道酒店', price: '152', reviews: '580+条点评', tag: 'lamp' },
  ],
  deal: { name: '万岁山武侠城', sub: '遛娃宝藏地', price: '99' },
};

/** 红包签到：五日奖励槽 */
export const TB_SIGN_SLOTS = [
  { kind: 'today' as const, coins: 7200, label: '今日奖励' },
  { kind: 'cash' as const, coins: 0, label: '明日奖励' },
  { kind: 'cash' as const, coins: 0, label: '第3天' },
  { kind: 'cash' as const, coins: 0, label: '第4天' },
  { kind: 'extra' as const, coins: 0, label: '连签5日可得' },
];

/** 签到状态（localStorage 按 uid 隔离） */
export interface TbSignState {
  /** 最近签到日 YYYY-MM-DD */
  last: string;
  /** 连续签到天数（含最近一次） */
  streak: number;
  /** 累计元宝（100000 = ¥1 提现额度展示） */
  coins: number;
  /** 今日加宝/点击领取已完成日（复用 last 判重） */
  bonusDay: string;
}

export const TB_SIGN_GOAL = 100000;

export function tbSignToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const signKey = (uid: string) => `tb-sign:${uid}`;

export function tbLoadSign(uid: string): TbSignState {
  try {
    const raw = window.localStorage.getItem(signKey(uid));
    if (raw) {
      const p = JSON.parse(raw) as Partial<TbSignState>;
      if (p && typeof p.last === 'string' && typeof p.streak === 'number' && typeof p.coins === 'number') {
        return { last: p.last, streak: p.streak, coins: p.coins, bonusDay: typeof p.bonusDay === 'string' ? p.bonusDay : '' };
      }
    }
  } catch {
    /* 静默 */
  }
  return { last: '', streak: 0, coins: 0, bonusDay: '' };
}

export function tbSaveSign(uid: string, s: TbSignState): void {
  try {
    window.localStorage.setItem(signKey(uid), JSON.stringify(s));
  } catch {
    /* 静默 */
  }
}
