/**
 * 美团 App 种子数据（商家/菜单/评价/分类入口）：
 * - 纯前端静态数据，对齐真机演示口径（评分/月售/起送/配送费/距离/满减）；
 * - 菜品图走图片搜索 OSS 直链（MT_IMG），加载失败由 UI 回退 emoji 渐变占位，无图也可用；
 * - 商家与菜品 id 稳定（购物车/订单跨重启引用）。
 */

/** 图片槽位（图片搜索 OSS 直链；空 = emoji 渐变占位） */
export const MT_IMG: Record<string, string> = {
  burger: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/601329bde485.jpg',
  milktea: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/8e0d77c2240a.jpg',
  chicken: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/028191e49842.jpg',
  malatang: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/7e4988d7f7c7.jpeg',
  hotpot: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/637b9d4d5b77.jpg',
  fruit: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/255d285daf50.jpg',
  store: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/18a20ee2a3f6.jpg',
  pharmacy: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/d00dfd7a4473.jpg',
  rice: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/0e5816453a07.jpg',
  noodle: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/5e4fa4eee327.jpg',
  pizza: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/f7d99ad1904b.jpg',
  breakfast: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/802e97a4e89e.jpg',
};

function img(key: string): string | undefined {
  const v = MT_IMG[key];
  return v && v.length > 0 ? v : undefined;
}

export interface MtDish {
  id: string;
  name: string;
  price: number;
  /** 原价（划线价，可选） */
  origPrice?: number;
  emoji: string;
  img?: string;
  desc?: string;
  monthSale: number;
  /** 招牌菜（菜单角标） */
  sig?: boolean;
}

export interface MtReview {
  user: string;
  rating: number;
  content: string;
  time: string;
  /** 点赞的评价标签（好评/口味赞/包装好…） */
  tags?: string[];
}

export interface MtMerchant {
  id: string;
  name: string;
  emoji: string;
  /** 门头图（封面，可选） */
  cover?: string;
  /** 覆盖的分类（首页分类入口过滤用） */
  cats: string[];
  rating: number;
  monthSale: number;
  minOrder: number;
  deliveryFee: number;
  distanceKm: number;
  deliveryMin: number;
  notice?: string;
  deals: string[];
  hours: string;
  addr: string;
  /** 菜单分区 */
  sections: { cat: string; dishes: MtDish[] }[];
  reviews: MtReview[];
}

/** 商家筛选分类（分类宫格映射到商家池用） */
export const MT_CATS: { id: string; name: string; emoji: string }[] = [
  { id: 'waimai', name: '外卖', emoji: '🛵' },
  { id: 'meishi', name: '美食', emoji: '🍜' },
  { id: 'chaoshi', name: '超市便利', emoji: '🛒' },
  { id: 'shuiguo', name: '水果', emoji: '🍓' },
  { id: 'maiyao', name: '看病买药', emoji: '💊' },
  { id: 'yinyin', name: '甜点饮品', emoji: '🧋' },
  { id: 'hamburg', name: '汉堡披萨', emoji: '🍔' },
  { id: 'mala', name: '麻辣烫', emoji: '🍲' },
  { id: 'zaocan', name: '早餐', emoji: '🥟' },
];

/** 首页分类宫格（两页 15 项，对齐真机布局）；filter=null 的频道为演示占位 */
export interface MtGridCat {
  id: string;
  name: string;
  emoji: string;
  tint: string;
  /** 商家筛选分类 id（null = 演示频道，点击提示） */
  filter?: string | null;
}
export const MT_HOME_GRID: MtGridCat[][] = [
  [
    { id: 'waimai', name: '外卖', emoji: '🛵', tint: 'from-[#FFF6D6] to-[#FFD84D]', filter: 'waimai' },
    { id: 'tuangou', name: '团购', emoji: '🎟️', tint: 'from-[#FFE7CC] to-[#FFA24E]', filter: 'tuangou' },
    { id: 'hotel', name: '酒店/旅行', emoji: '🏨', tint: 'from-[#D9ECFF] to-[#84BAFF]', filter: null },
    { id: 'shangou', name: '闪购', emoji: '⚡', tint: 'from-[#FFF1C0] to-[#FFD24D]', filter: null },
    { id: 'yao', name: '看病买药', emoji: '💊', tint: 'from-[#FFF0C2] to-[#FFCE54]', filter: 'maiyao' },
    { id: 'meishi', name: '美食', emoji: '🍴', tint: 'from-[#FFDED2] to-[#FF9E7A]', filter: 'meishi' },
    { id: 'xiuxian', name: '休闲玩乐', emoji: '🎮', tint: 'from-[#E6DFFF] to-[#AD92FF]', filter: null },
    { id: 'anmo', name: '按摩足疗', emoji: '💆', tint: 'from-[#FFDCE8] to-[#FF93BB]', filter: null },
    { id: 'paotui', name: '跑腿', emoji: '🏃', tint: 'from-[#FFF6D6] to-[#FFD84D]', filter: null },
    { id: 'dianying', name: '电影演出', emoji: '🎬', tint: 'from-[#FFDCCB] to-[#FF9E6B]', filter: null },
  ],
  [
    { id: 'liren', name: '丽人美发', emoji: '💇', tint: 'from-[#FFDCE8] to-[#FF93BB]', filter: null },
    { id: 'jipiao', name: '机票火车票', emoji: '✈️', tint: 'from-[#D9ECFF] to-[#84BAFF]', filter: null },
    { id: 'yiliao', name: '医疗牙科', emoji: '🦷', tint: 'from-[#D9F1FF] to-[#82C4FF]', filter: null },
    { id: 'xiaoshuo', name: '免费小说', emoji: '📖', tint: 'from-[#FFE9C8] to-[#FFC36B]', filter: null },
    { id: 'more', name: '更多服务', emoji: '🧭', tint: 'from-[#EEEFF3] to-[#C9CDD6]', filter: null },
  ],
];

// ---------------- 特价团（团购）数据：首页瀑布流 + 团购详情页 + 确认订单页 ----------------

export interface MtDealMenu {
  sec: string;
  items: { name: string; price: number }[];
}

export interface MtDeal {
  id: string;
  merchantId: string;
  /** 套餐标题（如 爆款单人四件套TG1548） */
  title: string;
  img?: string;
  emoji: string;
  /** 团购价（直接购买） */
  price: number;
  /** 原价（划线价 = 商品总价） */
  origPrice: number;
  /** 折扣角标（4.1折） */
  discount: string;
  /** 销量文案（已售58万+） */
  sold: string;
  praise: string;
  /** 履约方式（秒提 / 到店吃） */
  tips: string;
  distanceKm: number;
  /** 可用时间文案（周一至周日可用） */
  usable: string;
  /** 过期提醒 */
  notice: string;
  /** 拼团价（可选，低于直接购买价） */
  groupPrice?: number;
  /** 团购详情（套餐内容清单） */
  menu: MtDealMenu[];
  storeTags: string[];
}

const D = (d: MtDeal): MtDeal => d;

export const MT_DEALS: MtDeal[] = [
  D({
    id: 'd-tast-set',
    merchantId: 'm-tasiting',
    title: '爆款单人四件套TG1548',
    img: img('burger'),
    emoji: '🍔',
    price: 13.9,
    origPrice: 34,
    discount: '4.1折',
    sold: '已售58万+',
    praise: '94%好评',
    tips: '秒提',
    distanceKm: 1.2,
    usable: '周一至周日可用',
    notice: '本单将于7天后过期，请注意周末、节假日是否可用',
    groupPrice: 11.9,
    menu: [
      { sec: '主食 2选1', items: [{ name: '香辣鸡腿中国汉堡', price: 12 }, { name: '藤椒鸡腿中国汉堡', price: 12 }] },
      { sec: '小食 2选1', items: [{ name: '黄金鸡块（5块）', price: 9.9 }, { name: '香辣鸡翅（2块）', price: 10.5 }] },
      { sec: '固选', items: [{ name: '冰镇可口可乐（中杯）', price: 4 }] },
    ],
    storeTags: ['金冠好店', '不可吸烟', '有Wi-Fi', '不可带宠物'],
  }),
  D({
    id: 'd-mixue-hyn',
    merchantId: 'm-mixue',
    title: '厚芋泥奶茶 经典芋泥 3张',
    img: img('milktea'),
    emoji: '🧋',
    price: 21.6,
    origPrice: 31.5,
    discount: '6.9折',
    sold: '已售20万+',
    praise: '95%好评',
    tips: '秒提',
    distanceKm: 0.8,
    usable: '周一至周日可用',
    notice: '本单将于30天后过期，免预约随时可用',
    menu: [{ sec: '内含券 3张', items: [{ name: '厚芋泥奶茶（中杯）', price: 10.5 }, { name: '厚芋泥奶茶（中杯）', price: 10.5 }, { name: '厚芋泥奶茶（中杯）', price: 10.5 }] }],
    storeTags: ['免预约', '随时退'],
  }),
  D({
    id: 'd-mixue-mjlv',
    merchantId: 'm-mixue',
    title: '茉莉奶绿（特价团购） 3张',
    img: img('milktea'),
    emoji: '🍵',
    price: 13.3,
    origPrice: 19.5,
    discount: '6.8折',
    sold: '半年售10万+',
    praise: '93%好评',
    tips: '秒提',
    distanceKm: 0.8,
    usable: '周一至周日可用',
    notice: '本单将于30天后过期，免预约随时可用',
    menu: [{ sec: '内含券 3张', items: [{ name: '茉莉奶绿（中杯）', price: 6.5 }, { name: '茉莉奶绿（中杯）', price: 6.5 }, { name: '茉莉奶绿（中杯）', price: 6.5 }] }],
    storeTags: ['免预约', '随时退'],
  }),
  D({
    id: 'd-ygf-set',
    merchantId: 'm-yangguofu',
    title: '麻辣烫单人套餐（番茄微辣）',
    img: img('malatang'),
    emoji: '🍲',
    price: 15.8,
    origPrice: 25,
    discount: '6.3折',
    sold: '已售8万+',
    praise: '92%好评',
    tips: '到店吃',
    distanceKm: 1.5,
    usable: '周一至周五可用',
    notice: '本单将于14天后过期，法定节假日不可用',
    groupPrice: 13.9,
    menu: [
      { sec: '主食', items: [{ name: '番茄麻辣烫（微辣）', price: 16.8 }] },
      { sec: '小食', items: [{ name: '宽粉', price: 2 }, { name: '鹌鹑蛋（5个）', price: 3 }] },
      { sec: '饮品', items: [{ name: '酸梅汤（中杯）', price: 5 }] },
    ],
    storeTags: ['金冠好店', '免费Wi-Fi', '可停车'],
  }),
  D({
    id: 'd-zb-pizza',
    merchantId: 'm-pizza',
    title: '9寸金牌比萨 4选1',
    img: img('pizza'),
    emoji: '🍕',
    price: 19.9,
    origPrice: 36,
    discount: '5.5折',
    sold: '已售15万+',
    praise: '94%好评',
    tips: '秒提',
    distanceKm: 2.1,
    usable: '周一至周日可用',
    notice: '本单将于7天后过期，随时退·过期自动退',
    menu: [
      { sec: '比萨 4选1', items: [{ name: '超级至尊比萨', price: 36 }, { name: '夏威夷比萨', price: 32 }, { name: '肉香四溢比萨', price: 35 }, { name: '田园风光比萨', price: 28 }] },
      { sec: '固选', items: [{ name: '柠檬红茶（中杯）', price: 6 }] },
    ],
    storeTags: ['金冠好店', '有Wi-Fi'],
  }),
  D({
    id: 'd-fruit-3x1',
    merchantId: 'm-fruit',
    title: '应季鲜果拼盘 3选1',
    img: img('fruit'),
    emoji: '🍓',
    price: 9.9,
    origPrice: 19.9,
    discount: '5折',
    sold: '已售5万+',
    praise: '96%好评',
    tips: '秒提',
    distanceKm: 0.6,
    usable: '周一至周日可用',
    notice: '本单将于7天后过期，鲜果当日切配',
    menu: [
      { sec: '鲜果 3选1', items: [{ name: '当季草莓盒（300g）', price: 19.9 }, { name: '海南金菠萝（1个）', price: 12.9 }, { name: '新疆西梅（500g）', price: 19.9 }] },
    ],
    storeTags: ['新鲜直达', '坏果包赔'],
  }),
  D({
    id: 'd-bf-2r',
    merchantId: 'm-breakfast',
    title: '豆浆油条元气早餐 2人份',
    img: img('breakfast'),
    emoji: '🥟',
    price: 6.9,
    origPrice: 12,
    discount: '5.8折',
    sold: '已售12万+',
    praise: '95%好评',
    tips: '到店吃',
    distanceKm: 0.9,
    usable: '周一至周日可用',
    notice: '本单将于7天后过期，仅限早餐时段（6:00-10:30）',
    groupPrice: 5.9,
    menu: [
      { sec: '套餐内容', items: [{ name: '现磨豆浆（大杯）×2', price: 4 }, { name: '现炸油条×2', price: 4 }, { name: '鲜肉小笼包（4只）', price: 4 }] },
    ],
    storeTags: ['免预约', '清晨现做'],
  }),
];

/** 首页「特价团聚合卡」（右侧列表位，展示 2 条券） */
export const MT_HOME_LIST: { title: string; badge: string; dealIds: string[] } = {
  title: '十一寻味5折起',
  badge: '特价团',
  dealIds: ['d-mixue-hyn', 'd-zb-pizza'],
};

const R = (user: string, rating: number, content: string, time: string, tags?: string[]): MtReview => ({ user, rating, content, time, tags });

export const MT_MERCHANTS: MtMerchant[] = [
  {
    id: 'm-tasiting',
    name: '塔斯汀中国汉堡（解放南路店）',
    emoji: '🍔',
    cover: img('burger'),
    cats: ['hamburg', 'waimai'],
    rating: 4.8,
    monthSale: 12000,
    minOrder: 20,
    deliveryFee: 2.5,
    distanceKm: 1.2,
    deliveryMin: 35,
    notice: '爆款单人四件套回归，周一至周日可用，过期自动退',
    deals: ['满30减8', '新客立减3'],
    hours: '10:30-22:00',
    addr: '解放大道与民生街向南15米路东',
    sections: [
      {
        cat: '招牌套餐',
        dishes: [
          { id: 'ta-set', name: '爆款单人四件套', price: 13.9, origPrice: 34, emoji: '🍔', img: img('burger'), desc: '汉堡2选1+小食2选1+固选可乐，任选搭配', monthSale: 580000, sig: true },
          { id: 'ta-set2', name: '炙香鸡肉串（买1送1）', price: 8.9, origPrice: 17.8, emoji: '🍖', img: img('chicken'), desc: '炙香入味，串串满足', monthSale: 12000 },
        ],
      },
      {
        cat: '中国汉堡',
        dishes: [
          { id: 'ta-b1', name: '香辣鸡腿中国汉堡', price: 12, emoji: '🍔', img: img('burger'), desc: '现烤堡胚，香辣多汁', monthSale: 8900, sig: true },
          { id: 'ta-b2', name: '藤椒鸡腿中国汉堡', price: 12, emoji: '🍔', img: img('burger'), desc: '藤椒微麻，回味十足', monthSale: 6600 },
          { id: 'ta-b3', name: '培根煎蛋中国汉堡', price: 13, emoji: '🍳', img: img('burger'), desc: '培根+煎蛋，早餐也能吃', monthSale: 4300 },
          { id: 'ta-b4', name: '黄金香酥鸡柳堡', price: 14, emoji: '🍔', img: img('chicken'), desc: '整块鸡柳，外酥里嫩', monthSale: 3900 },
        ],
      },
      {
        cat: '小食甜品',
        dishes: [
          { id: 'ta-s1', name: '黄金鸡块（5块）', price: 9.9, emoji: '🍗', img: img('chicken'), monthSale: 5200 },
          { id: 'ta-s2', name: '葡式蛋挞（2只）', price: 5.5, emoji: '🥧', monthSale: 3100 },
          { id: 'ta-s3', name: '香辣鸡翅（2块）', price: 10.5, emoji: '🍗', img: img('chicken'), monthSale: 4700 },
        ],
      },
      { cat: '饮品', dishes: [{ id: 'ta-d1', name: '冰镇可口可乐', price: 4, emoji: '🥤', monthSale: 9800 }] },
    ],
    reviews: [
      R('爱吃汉堡的 leo', 5, '四件套太划算了，汉堡现烤的很香，配送也快，包装完好！', '今天 12:32', ['味道赞', '包装好']),
      R('小柚子', 4.5, '鸡柳堡很酥，可乐冰块多，就是中午高峰送得慢了点。', '昨天 13:05', ['味道赞']),
      R('濮阳小王', 5, '回购 N 次，藤椒堡yyds，满30减8凑单无压力。', '2天前', ['回头客']),
    ],
  },
  {
    id: 'm-mixue',
    name: '蜜雪冰城（城关老街店）',
    emoji: '🧋',
    cover: img('milktea'),
    cats: ['yinyin', 'waimai'],
    rating: 4.9,
    monthSale: 20000,
    minOrder: 0,
    deliveryFee: 1.5,
    distanceKm: 0.6,
    deliveryMin: 25,
    notice: '第二杯半价进行中，冰量糖量可备注',
    deals: ['满10减2', '新客立减3'],
    hours: '09:00-23:00',
    addr: '老街村商业街 18 号',
    sections: [
      {
        cat: '奶茶',
        dishes: [
          { id: 'mx-1', name: '珍珠奶茶', price: 7.2, emoji: '🧋', img: img('milktea'), desc: '经典款，珍珠软糯', monthSale: 99000, sig: true },
          { id: 'mx-2', name: '厚芋泥奶茶', price: 7.2, emoji: '🍠', img: img('milktea'), desc: '芋泥厚厚一层', monthSale: 66000 },
          { id: 'mx-3', name: '茉莉奶绿', price: 6.6, emoji: '🍵', img: img('milktea'), monthSale: 33000 },
        ],
      },
      {
        cat: '柠水冰品',
        dishes: [
          { id: 'mx-4', name: '冰鲜柠檬水', price: 4, emoji: '🍋', monthSale: 150000, sig: true },
          { id: 'mx-5', name: '黑糖珍珠大圣代', price: 6.5, emoji: '🍦', monthSale: 28000 },
          { id: 'mx-6', name: '新鲜冰淇淋', price: 3, emoji: '🍨', monthSale: 88000 },
          { id: 'mx-7', name: '摇摇奶昔（草莓）', price: 8, emoji: '🥛', monthSale: 21000 },
        ],
      },
    ],
    reviews: [
      R('奶茶续命中', 5, '柠檬水永远的神，4块钱快乐一整天。', '今天 15:40', ['性价比高']),
      R('甜甜圈不甜', 4.5, '芋泥奶茶半糖刚好，第二杯半价和朋友拼的。', '昨天 16:22', ['回头客']),
    ],
  },
  {
    id: 'm-yangguofu',
    name: '杨国福麻辣烫（濮阳旗舰店）',
    emoji: '🍲',
    cover: img('malatang'),
    cats: ['mala', 'meishi', 'waimai'],
    rating: 4.7,
    monthSale: 8000,
    minOrder: 20,
    deliveryFee: 3,
    distanceKm: 1.8,
    deliveryMin: 40,
    notice: '汤底可免费续，辣度分微辣/中辣/特辣',
    deals: ['满25减4', '满40减7'],
    hours: '10:00-22:30',
    addr: '红旗路与建设路交叉口南 50 米',
    sections: [
      {
        cat: '招牌麻辣烫',
        dishes: [
          { id: 'yg-1', name: '番茄麻辣烫（微辣）', price: 16.8, emoji: '🍅', img: img('malatang'), desc: '番茄汤底+经典配菜', monthSale: 32000, sig: true },
          { id: 'yg-2', name: '骨汤麻辣烫（不辣）', price: 15.8, emoji: '🥣', img: img('malatang'), monthSale: 26000 },
          { id: 'yg-3', name: '金汤肥牛麻辣烫', price: 21.8, emoji: '🌶️', img: img('malatang'), monthSale: 15000 },
        ],
      },
      {
        cat: '加料',
        dishes: [
          { id: 'yg-4', name: '肥牛卷', price: 6, emoji: '🥩', monthSale: 19000 },
          { id: 'yg-5', name: '宽粉', price: 2, emoji: '🍜', monthSale: 24000 },
          { id: 'yg-6', name: '鹌鹑蛋（5个）', price: 3, emoji: '🥚', monthSale: 12000 },
          { id: 'yg-7', name: '午餐肉', price: 4, emoji: '🥓', monthSale: 9800 },
          { id: 'yg-8', name: '酸梅汤', price: 5, emoji: '🧃', monthSale: 8600 },
        ],
      },
    ],
    reviews: [
      R('无辣不欢', 5, '金汤肥牛yyds，加了宽粉和肥牛，汤都喝完了。', '今天 18:44', ['味道赞', '分量足']),
      R('小城食客', 4, '送来还是热的，微辣刚好，包装没洒。', '昨天 19:10', ['包装好']),
      R('阿豪', 4.5, '满40减7很划算，两个人吃到撑。', '3天前', ['回头客']),
    ],
  },
  {
    id: 'm-noodle',
    name: '老王家牛肉面（中心店）',
    emoji: '🍜',
    cover: img('noodle'),
    cats: ['meishi', 'waimai'],
    rating: 4.6,
    monthSale: 3500,
    minOrder: 15,
    deliveryFee: 2,
    distanceKm: 0.9,
    deliveryMin: 30,
    notice: '手工现拉，汤底每日现熬',
    deals: ['满20减3'],
    hours: '07:00-21:00',
    addr: '中心广场东侧美食街 6 号',
    sections: [
      {
        cat: '招牌面',
        dishes: [
          { id: 'nd-1', name: '红烧牛肉面', price: 13.8, emoji: '🍜', img: img('noodle'), desc: '牛腱肉大块，汤浓味香', monthSale: 21000, sig: true },
          { id: 'nd-2', name: '牛肉拌面', price: 14.8, emoji: '🍝', img: img('noodle'), monthSale: 13000 },
          { id: 'nd-3', name: '酸菜肉丝面', price: 11.8, emoji: '🍲', monthSale: 8600 },
        ],
      },
      {
        cat: '小菜饮品',
        dishes: [
          { id: 'nd-4', name: '凉拌黄瓜', price: 6, emoji: '🥒', monthSale: 5400 },
          { id: 'nd-5', name: '卤蛋', price: 2, emoji: '🥚', monthSale: 8800 },
          { id: 'nd-6', name: '现磨豆浆', price: 4, emoji: '🥛', monthSale: 6200 },
        ],
      },
    ],
    reviews: [R('面馆常客', 4.5, '牛肉给得实在，汤头很正，配送准时。', '昨天 12:15', ['分量足']), R('小周', 4.5, '拌面香，加个卤蛋完美。', '2天前')],
  },
  {
    id: 'm-fruit',
    name: '鲜丰水果（中心广场店）',
    emoji: '🍓',
    cover: img('fruit'),
    cats: ['shuiguo', 'chaoshi'],
    rating: 4.8,
    monthSale: 5000,
    minOrder: 0,
    deliveryFee: 2,
    distanceKm: 1.5,
    deliveryMin: 45,
    notice: '坏果包赔，现切现送',
    deals: ['满30减5'],
    hours: '08:00-22:00',
    addr: '中心广场北路 22 号',
    sections: [
      {
        cat: '时令鲜果',
        dishes: [
          { id: 'fr-1', name: '当季草莓盒 250g', price: 12.9, emoji: '🍓', img: img('fruit'), monthSale: 8600, sig: true },
          { id: 'fr-2', name: '沙糖桔 2 斤装', price: 9.9, emoji: '🍊', monthSale: 12000 },
          { id: 'fr-3', name: '车厘子 JJ 250g', price: 29.9, origPrice: 39.9, emoji: '🍒', monthSale: 4300 },
          { id: 'fr-4', name: '猕猴桃 6 个装', price: 12.8, emoji: '🥝', monthSale: 6100 },
        ],
      },
      {
        cat: '鲜切果盒',
        dishes: [
          { id: 'fr-5', name: '现切西瓜盒 500g', price: 8.8, emoji: '🍉', img: img('fruit'), monthSale: 9800 },
          { id: 'fr-6', name: '混合水果捞', price: 15.8, emoji: '🍇', monthSale: 5200 },
          { id: 'fr-7', name: '进口香蕉 1 把', price: 6.9, emoji: '🍌', monthSale: 7700 },
        ],
      },
    ],
    reviews: [R('果粉小刘', 5, '草莓很甜没有坏果，现切西瓜冰镇过。', '今天 10:20', ['新鲜', '坏果包赔']), R('lemon', 4.5, '车厘子个头大，比超市划算。', '昨天 20:02')],
  },
  {
    id: 'm-store',
    name: '惠民优选超市（老街店）',
    emoji: '🛒',
    cover: img('store'),
    cats: ['chaoshi', 'shuiguo'],
    rating: 4.5,
    monthSale: 9000,
    minOrder: 0,
    deliveryFee: 1.5,
    distanceKm: 0.8,
    deliveryMin: 40,
    notice: '24 小时营业，急送必备',
    deals: ['满39减6'],
    hours: '00:00-24:00',
    addr: '老街村退役军人服务站旁',
    sections: [
      {
        cat: '饮品乳品',
        dishes: [
          { id: 'st-1', name: '农夫山泉 550ml×12', price: 16.8, emoji: '💧', img: img('store'), monthSale: 15000, sig: true },
          { id: 'st-2', name: '可口可乐 330ml×6', price: 12, emoji: '🥤', monthSale: 11000 },
          { id: 'st-3', name: '纯牛奶 250ml×12', price: 39.9, emoji: '🥛', monthSale: 6600 },
        ],
      },
      {
        cat: '零食日用',
        dishes: [
          { id: 'st-4', name: '乐事薯片原味', price: 6.5, emoji: '🥔', monthSale: 9900 },
          { id: 'st-5', name: '卫龙辣条大面筋', price: 5.5, emoji: '🌶️', monthSale: 8800 },
          { id: 'st-6', name: '抽纸 8 包整箱', price: 19.9, emoji: '🧻', monthSale: 7200 },
          { id: 'st-7', name: '鲜鸡蛋 30 枚', price: 25.9, emoji: '🥚', monthSale: 5300 },
        ],
      },
    ],
    reviews: [R('夜猫子', 4.5, '半夜点水也送，救急神器。', '昨天 23:40', ['配送快']), R('家庭主妇日常', 4, '鸡蛋完整没碎，价格实惠。', '2天前')],
  },
  {
    id: 'm-pharmacy',
    name: '康宁大药房（解放路店）',
    emoji: '💊',
    cover: img('pharmacy'),
    cats: ['maiyao'],
    rating: 4.9,
    monthSale: 2000,
    minOrder: 0,
    deliveryFee: 3,
    distanceKm: 2.2,
    deliveryMin: 50,
    notice: '执业药师在线咨询，夜间急送',
    deals: ['满99减10'],
    hours: '08:00-22:00',
    addr: '解放路 118 号',
    sections: [
      {
        cat: '感冒发烧',
        dishes: [
          { id: 'ph-1', name: '感冒灵颗粒 10 袋', price: 16.5, emoji: '💊', img: img('pharmacy'), monthSale: 3200, sig: true },
          { id: 'ph-2', name: '布洛芬缓释胶囊 24 粒', price: 19.8, emoji: '💊', img: img('pharmacy'), monthSale: 2600 },
        ],
      },
      {
        cat: '常备保健',
        dishes: [
          { id: 'ph-3', name: '藿香正气水 10 支', price: 12.8, emoji: '🧴', monthSale: 1800 },
          { id: 'ph-4', name: '医用外科口罩 50 只', price: 15.9, emoji: '😷', monthSale: 4400 },
          { id: 'ph-5', name: '创可贴 100 片装', price: 9.9, emoji: '🩹', monthSale: 2100 },
          { id: 'ph-6', name: '维生素 C 咀嚼片', price: 29.9, emoji: '🍊', monthSale: 1500 },
        ],
      },
    ],
    reviews: [R('宝妈小赵', 5, '孩子半夜发烧，30分钟送到，救急！', '今天 02:15', ['配送快', '夜间送']), R('健身达人', 4.5, '维C正品，药师还电话确认了用法。', '昨天 11:30', ['服务好'])],
  },
  {
    id: 'm-pizza',
    name: '尊宝比萨（濮阳店）',
    emoji: '🍕',
    cover: img('pizza'),
    cats: ['hamburg', 'meishi'],
    rating: 4.7,
    monthSale: 6000,
    minOrder: 39,
    deliveryFee: 4,
    distanceKm: 2.6,
    deliveryMin: 50,
    notice: '现拍现烤，9寸两人食刚好',
    deals: ['满59减12'],
    hours: '10:00-22:00',
    addr: '濮上中路 66 号',
    sections: [
      {
        cat: '比萨',
        dishes: [
          { id: 'pz-1', name: '经典夏威夷比萨 9 寸', price: 35.9, emoji: '🍕', img: img('pizza'), desc: '菠萝+火腿，咸甜经典', monthSale: 14000, sig: true },
          { id: 'pz-2', name: '意式肉酱比萨 9 寸', price: 39.9, emoji: '🍕', img: img('pizza'), monthSale: 9900 },
          { id: 'pz-3', name: '榴莲比萨 9 寸', price: 49.9, emoji: '🍕', monthSale: 7700, sig: true },
        ],
      },
      {
        cat: '小食饮品',
        dishes: [
          { id: 'pz-4', name: '蒜香鸡翅 6 只', price: 19.9, emoji: '🍗', img: img('chicken'), monthSale: 6600 },
          { id: 'pz-5', name: '黄金蝴蝶虾', price: 22, emoji: '🦐', monthSale: 4300 },
          { id: 'pz-6', name: '可乐 3 罐', price: 9.9, emoji: '🥤', monthSale: 8800 },
        ],
      },
    ],
    reviews: [R('披萨控', 5, '榴莲比萨料超足，拉丝绝了。', '昨天 19:30', ['味道赞', '分量足']), R('周末家庭日', 4.5, '满59减12，两个比萨才50块。', '3天前', ['回头客'])],
  },
  {
    id: 'm-rice',
    name: '川湘人家·盖浇饭（红旗路店）',
    emoji: '🍚',
    cover: img('rice'),
    cats: ['meishi', 'waimai'],
    rating: 4.6,
    monthSale: 4200,
    minOrder: 18,
    deliveryFee: 2,
    distanceKm: 1.1,
    deliveryMin: 35,
    notice: '小炒现做，米饭免费加',
    deals: ['满25减4', '满35减6'],
    hours: '10:30-21:30',
    addr: '红旗路 33 号附 2',
    sections: [
      {
        cat: '招牌盖浇饭',
        dishes: [
          { id: 'rc-1', name: '鱼香肉丝盖浇饭', price: 15.8, emoji: '🍛', img: img('rice'), monthSale: 18000, sig: true },
          { id: 'rc-2', name: '宫保鸡丁盖浇饭', price: 16.8, emoji: '🍛', img: img('rice'), monthSale: 15000 },
          { id: 'rc-3', name: '红烧肉盖浇饭', price: 19.8, emoji: '🍖', img: img('rice'), monthSale: 12000, sig: true },
          { id: 'rc-4', name: '番茄鸡蛋盖浇饭', price: 13.8, emoji: '🍅', monthSale: 9900 },
          { id: 'rc-5', name: '酸辣土豆丝盖浇饭', price: 12.8, emoji: '🥔', monthSale: 8600 },
        ],
      },
      { cat: '汤羹', dishes: [{ id: 'rc-6', name: '紫菜蛋花汤', price: 4, emoji: '🥣', monthSale: 6600 }] },
    ],
    reviews: [R('打工人午餐', 4.5, '鱼香肉丝下饭，米饭给了双份。', '今天 12:40', ['分量足']), R('湘妹子', 4.5, '红烧肉软烂入味，满35减6划算。', '昨天 18:55', ['回头客'])],
  },
  {
    id: 'm-hotpot',
    name: '鲜货火锅串串（怡景花园店）',
    emoji: '🍲',
    cover: img('hotpot'),
    cats: ['meishi', 'mala'],
    rating: 4.8,
    monthSale: 3000,
    minOrder: 59,
    deliveryFee: 5,
    distanceKm: 3.1,
    deliveryMin: 60,
    notice: '锅底+食材全套配齐，到家开火即食',
    deals: ['满99减15'],
    hours: '11:00-23:00',
    addr: '怡景花园西区商业街 8 号',
    sections: [
      {
        cat: '锅底',
        dishes: [
          { id: 'hp-1', name: '鸳鸯锅底（微辣/菌汤）', price: 29.8, emoji: '🍲', img: img('hotpot'), monthSale: 8600, sig: true },
          { id: 'hp-2', name: '重庆牛油红锅', price: 26.8, emoji: '🌶️', img: img('hotpot'), monthSale: 6600 },
        ],
      },
      {
        cat: '涮品',
        dishes: [
          { id: 'hp-3', name: '精品肥牛卷', price: 26.8, emoji: '🥩', monthSale: 9900 },
          { id: 'hp-4', name: '鲜毛肚', price: 22.8, emoji: '🍖', monthSale: 7700, sig: true },
          { id: 'hp-5', name: '手打虾滑', price: 19.8, emoji: '🦐', monthSale: 6600 },
          { id: 'hp-6', name: '土豆片', price: 4.8, emoji: '🥔', monthSale: 5200 },
          { id: 'hp-7', name: '宽粉', price: 4.8, emoji: '🍜', monthSale: 6100 },
          { id: 'hp-8', name: '冻豆腐', price: 5.8, emoji: '🧊', monthSale: 4300 },
          { id: 'hp-9', name: '唯怡豆奶 9 罐', price: 6, emoji: '🥛', monthSale: 3800 },
        ],
      },
    ],
    reviews: [R('火锅之夜', 5, '套餐齐全，连电磁炉都带了，满意！', '昨天 20:10', ['分量足', '包装好']), R('深夜食堂', 4.5, '毛肚脆嫩，红锅够味。', '2天前', ['味道赞'])],
  },
  {
    id: 'm-breakfast',
    name: '一品粥·早点铺（南门店）',
    emoji: '🥟',
    cover: img('breakfast'),
    cats: ['zaocan', 'meishi'],
    rating: 4.7,
    monthSale: 2600,
    minOrder: 0,
    deliveryFee: 1.5,
    distanceKm: 0.7,
    deliveryMin: 25,
    notice: '上午 10 点前下单立减 2 元',
    deals: ['满12减2'],
    hours: '05:30-10:30',
    addr: '南门早市街 3 号',
    sections: [
      {
        cat: '粥品汤点',
        dishes: [
          { id: 'bf-1', name: '皮蛋瘦肉粥', price: 7.8, emoji: '🥣', img: img('breakfast'), monthSale: 9900, sig: true },
          { id: 'bf-2', name: '鲜肉馄饨（10个）', price: 9.8, emoji: '🥟', img: img('breakfast'), monthSale: 7700 },
        ],
      },
      {
        cat: '面点炸物',
        dishes: [
          { id: 'bf-3', name: '小笼包（6个）', price: 8.8, emoji: '🥟', img: img('breakfast'), monthSale: 8800 },
          { id: 'bf-4', name: '现炸油条', price: 3, emoji: '🥖', monthSale: 11000 },
          { id: 'bf-5', name: '茶叶蛋', price: 2, emoji: '🥚', monthSale: 9600 },
          { id: 'bf-6', name: '现磨豆浆', price: 2.5, emoji: '🥛', monthSale: 12000 },
        ],
      },
    ],
    reviews: [R('早起打工人', 5, '油条配豆浆，上班路上的灵魂。', '今天 07:50', ['配送快']), R('粥粥', 4.5, '瘦肉粥料多，小笼包皮薄。', '昨天 08:15', ['味道赞'])],
  },
];

/** 按 id 查商家 */
export function mtMerchantOf(id: string): MtMerchant | undefined {
  return MT_MERCHANTS.find((m) => m.id === id);
}

/** 菜品全局索引（搜索用） */
export function mtFindDish(id: string): { merchant: MtMerchant; dish: MtDish } | undefined {
  for (const m of MT_MERCHANTS) {
    for (const sec of m.sections) {
      const d = sec.dishes.find((x) => x.id === id);
      if (d) return { merchant: m, dish: d };
    }
  }
  return undefined;
}

/** 菜单所有菜（购物车金额计算用） */
export function mtDishesOf(m: MtMerchant): MtDish[] {
  return m.sections.flatMap((s) => s.dishes);
}
