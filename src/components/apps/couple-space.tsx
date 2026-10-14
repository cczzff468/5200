'use client';

/**
 * 情侣空间 App（恋人空间，原情侣空间）——白/浅灰定制配色版。
 *
 * 用户规格：按提供的 5 张参考截图 1:1 复刻结构（邀请页 / 首页 / 发现 / 相册 / 我们），
 * 全站配色不用粉色/红色，改用白色 + 浅灰（主强调色为炭灰渐变，深灰白字保证对比）。
 *
 * 页面结构（对应参考图）：
 * - 邀请页（图1）：全屏渐变底 + 装饰圆与浮点 + 恋人头像/昵称 + 「邀请你开通恋人空间（原情侣空间）」
 *   + 「接受邀请」大按钮 + 底部「在恋人空间你们可以体验这些」三体验卡（情侣相册/爱情树/纪念日）
 * - 首页（图2）：恋人空间大标题 + 双头像虚线连接 + 中间纪念日气泡（点击设置→已相恋 N 天）
 *   + 背景合影图上叠「每天想你」大圆（可点击打卡，两侧引号装饰）+ 右侧悬浮心形/换背景按钮
 *   + 底部四功能卡（爱情小树成长记/情侣轨迹/甜蜜小问答/未来情书）
 * - 发现（图3）：一起玩吧两张大卡（情侣轨迹/情侣小家）+「情感升温小技巧」3×4 宫格 12 项
 * - 相册（图4）：拍给TA看/聊天记录/日记相册/纪念日相册 四张上传卡 + 情侣私密相册宫格（可新建）
 *   + 悬浮「新建相册」按钮
 * - 我们（图5）：蕾丝装饰「我们の恋爱日记」卡（双头像+像素心+恋爱进度条+在一起天数）
 *   + 功能列表（恋爱资料/纪念日/每天想你/甜蜜小问答/小礼堂/联系客服/设置）
 *
 * 全部子功能页均为可用的轻量实现（数据 IndexedDB 持久化，键 couple-space:state）：
 * 恋人资料默认从「我的信息卡 + 联系人第一位 AI 角色」预填，可在恋爱资料页修改。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  BookHeart,
  Cake,
  CalendarClock,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  Compass,
  Crosshair,
  Crown,
  Gem,
  Gift,
  Heart,
  Headphones,
  HelpCircle,
  IdCard,
  Image as ImageIcon,
  ImagePlus,
  Landmark,
  Loader2,
  MapPin,
  MessageCircleHeart,
  NotebookPen,
  Pencil,
  Plane,
  Plus,
  RefreshCcw,
  Scale,
  Settings as SettingsIcon,
  Smile,
  Sparkles,
  Sprout,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { kvGet, kvSet, kvSetDebounced } from '@/lib/ios/idb-kv';
import { listContacts } from '@/lib/ios/contacts-store';
import { fileToScaledDataURL, loadProfileCard } from '@/components/ios/ProfileCard';
import { DefaultAvatar } from './default-avatar';
import { LocalToast, useLocalToast } from './page-toast';

// ---------------- 数据模型与持久化 ----------------

/** 相册（四个固定卡 + 用户自建的私密相册通用结构） */
interface CoupleAlbum {
  id: string;
  name: string;
  desc: string;
  photos: string[]; // dataURL
}

interface CoupleState {
  v: 1;
  accepted: boolean; // 是否已接受邀请
  anniversary: string | null; // 纪念日 'YYYY-MM-DD'
  meName: string;
  meAvatar: string | null;
  taName: string;
  taAvatar: string | null;
  signature: string;
  homeBg: string | null; // 首页合影背景 dataURL；null = 内置默认图
  missYou: number; // 每天想你累计次数
  missYouByDay: Record<string, number>; // 'YYYY-MM-DD' → 当日次数
  missSince: string | null; // 首次点击「每天想你」的日期；非空后首页大圆消失、头像下显示想念天数
  gender: string; // 我的性别（恋爱资料页）
  coupleNo: string; // 情侣号（自动生成）
  logins: number[]; // 登录记录（时间戳）
  annivExtra: { key: string; label: string; date: string }[]; // 纪念日列表（预设 + 自建）
  tree: number; // 爱情树成长值（浇水次数）
  letters: { id: string; text: string; at: number; openAfterDays: number }[]; // 未来情书
  albums: CoupleAlbum[];
  moods: { id: string; emoji: string; text: string; at: number; photo?: string | null; dateKey?: string }[]; // 心情日记
  chronicle: { id: string; text: string; at: number }[]; // 恋爱编年史
  impressionsMe: string[]; // TA 眼中的我（标签）
  impressionsTa: string[]; // 我眼中的 TA（标签）
  hundred: number[]; // 100 件小事已勾选索引
  quiz: { id: string; q: string; a: string; at: number }[]; // 甜蜜小问答记录
  examBest: number | null; // 恋爱水平考试最高分
  status: string; // 恋爱状态
  pactAt: number | null; // 恋爱协议签署时间
  zodiac: { me: string; ta: string } | null; // 星座缘分选择
  tarotHistory: { id: string; name: string; at: number }[]; // 塔罗抽牌历史（存最近一张）
  married: boolean; // 小礼堂：是否已婚
  marriedAt: number | null;
  meetPlace: string; // 情侣轨迹：相遇地点
  replies: { id: string; prompt: string; reply: string; at: number }[]; // 回复挑战
}

const STATE_KEY = 'couple-space:state';

function defaultState(): CoupleState {
  return {
    v: 1,
    accepted: false,
    anniversary: null,
    meName: '',
    meAvatar: null,
    taName: '',
    taAvatar: null,
    signature: '',
    homeBg: null,
    missYou: 0,
    missYouByDay: {},
    missSince: null,
    gender: '',
    coupleNo: '',
    logins: [],
    annivExtra: [],
    tree: 0,
    letters: [],
    albums: [
      { id: 'ta', name: '拍给TA看', desc: '想看看你每天的样子', photos: [] },
      { id: 'chat', name: '聊天记录', desc: '上传好玩的甜蜜聊天记录', photos: [] },
      { id: 'diary', name: '日记相册', desc: '记录每天的心情', photos: [] },
      { id: 'anniv', name: '纪念日相册', desc: '记录重要的日子', photos: [] },
    ],
    moods: [],
    chronicle: [],
    impressionsMe: [],
    impressionsTa: [],
    hundred: [],
    quiz: [],
    examBest: null,
    status: '',
    pactAt: null,
    zodiac: null,
    tarotHistory: [],
    married: false,
    marriedAt: null,
    meetPlace: '',
    replies: [],
  };
}

/** 读取持久化状态（缺失字段用默认值补齐，防旧数据缺键） */
function loadCoupleState(): CoupleState {
  try {
    const raw = kvGet<Partial<CoupleState>>(STATE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...raw, v: 1 };
  } catch {
    return defaultState();
  }
}

// ---------------- 业务常量池 ----------------

/** 甜蜜小问答题库（每日按日期轮换一题） */
const QUIZ_POOL = [
  '你第一次见到我时，对我的第一印象是什么？',
  '如果用一种颜色形容我们的爱情，你会选哪种？为什么？',
  '我们在一起之后，你养成的最大习惯是什么？',
  '你最喜欢我身上的哪三个优点？',
  '如果我们养一只宠物，你想养什么？取什么名字？',
  '你心里最想和我一起去的地方是哪里？',
  '你觉得我们最像哪一对电影情侣？',
  '第一次牵手的时候你在想什么？',
  '如果明天就是世界末日，今天最想和我做什么？',
  '你最近一次偷偷想我是什么时候？',
  '你希望十年后的我们是什么样子？',
  '在我们的小家里，你最想拥有哪一个角落？',
];

/** 爱情塔罗牌组（白灰意象 + 恋爱解读） */
const TAROT_DECK = [
  { name: '月亮', meaning: '藏在心底的温柔正悄悄发酵，有些话不必说破，TA 都懂。' },
  { name: '星星', meaning: '你们的未来像夜空一样辽阔，许下的愿望正在路上。' },
  { name: '太阳', meaning: '关系进入明亮期，坦诚相待会有甜甜的回应。' },
  { name: '恋人', meaning: '正位恋人！心意的双向奔赴，大胆靠近吧。' },
  { name: '命运之轮', meaning: '缘分的齿轮转到你们这边，该发生的甜蜜马上发生。' },
  { name: '塔', meaning: '小小争执只是云朵路过，各退一步晴空万里。' },
  { name: '隐士', meaning: '给彼此一点独处空间，想念会在安静里生长。' },
  { name: '皇后', meaning: '被爱包围的一天，适合撒撒娇、收收礼物。' },
  { name: '皇帝', meaning: '今天适合把约定定下来，仪式感是爱情的锚。' },
  { name: '魔术师', meaning: '把「我想你」变成小惊喜，魔法由你施展。' },
  { name: '女祭司', meaning: '直觉很准的一天，TA 的小心思你能一眼看穿。' },
  { name: '世界', meaning: '圆满之牌！一个阶段完成了，去庆祝吧。' },
];

/** 100 件小事清单 */
const HUNDRED_LIST: string[] = [
  '一起看一次日出', '一起看一次日落', '牵手压马路一小时', '雨天共撑一把伞', '一起做一顿晚饭',
  '一起洗一次碗', '互相喂对方吃水果', '一起看电影看到片尾字幕', '一起唱一首歌', '给对方唱一首歌',
  '一起逛街买情侣装', '穿情侣装拍合照', '一起拍大头贴', '互相拍一张最丑的照片', '一起敷面膜',
  '帮对方吹头发', '帮对方剪指甲', '一起泡脚聊天', '冬天互暖对方的手', '一起堆雪人',
  '夏天一起吃同一支冰淇淋', '一起吃火锅', '一起吃路边摊', '为对方做一次早餐', '一起熬夜跨年',
  '跨年时一起倒数', '一起放烟花', '一起放孔明灯', '一起去看海', '一起踩浪花',
  '一起捡贝壳', '一起爬山看云海', '一起露营看星星', '一起数流星并许愿', '一起去看极光',
  '一起坐一次摩天轮', '一起坐旋转木马', '一起去游乐园疯玩一天', '一起坐过山车', '一起逛美术馆',
  '一起逛博物馆', '一起去图书馆看书', '一起逛书店各挑一本书', '一起看一次展览', '一起去看演唱会',
  '一起看话剧', '一起K歌到尽兴', '一起跳舞（哪怕很笨拙）', '一起淋一次雨（然后喝姜汤）', '一起打雪仗',
  '一起放风筝', '一起骑双人自行车', '一起划船', '一起钓鱼', '一起看一次樱花',
  '秋天一起踩落叶', '一起种一盆植物', '给它取名字并养大', '一起养一只宠物', '给宠物过生日',
  '一起给未来写一封信', '写给对方一封手写信', '互送礼物不告诉价格', '为对方准备一次惊喜', '藏一个小纸条被对方发现',
  '记住对方的鞋码和口味', '生病时照顾对方一次', '吵架后先低头哄对方', '一起制定恋爱条约', '一起存一个梦想基金',
  '一起攒钱旅行', '一起计划蜜月路线', '一起看对方的童年照片', '讲一件自己的糗事', '交换一个童年秘密',
  '一起回对方的母校', '见对方的好朋友', '一起给爸妈打电话', '一起做年度总结', '一起拍 vlog 记录一天',
  '剪一个只属于你们的视频', '一起玩双人游戏通关', '一起拼一副 1000 片拼图', '一起搭一次积木', '一起玩真心话大冒险',
  '猜对方今天的心情', '一起早起晨跑一次', '一起做一次运动', '教对方一项自己的特长', '学一项对方喜欢的技能',
  '一起学做对方家乡菜', '一起过一次对方传统节日', '生日零点第一句说生日快乐', '一起庆祝每个 14 号', '一起写恋爱日记',
  '在老地方重游一次', '拍十年之约的合照', '一起挑一枚戒指', '说一次正式的「我爱你」', '一起白头（正在完成中）',
];

/** 恋爱水平考试题（每题 3 选项，全选最甜蜜项得分） */
const EXAM_QUESTIONS: { q: string; opts: [string, string, string]; best: number }[] = [
  { q: 'TA 随口说想吃的东西，你会？', opts: ['嗯一声过去了', '记在备忘录里找机会买', '现在就出门买回来'], best: 2 },
  { q: '吵架时你的原则是？', opts: ['冷战到底比谁硬', '就事论事不翻旧账', '摔门出去冷静三天'], best: 1 },
  { q: '纪念日快到了，你会？', opts: ['等 TA 先提', '偷偷准备惊喜', '红包了事'], best: 1 },
  { q: 'TA 换了新发型，你会？', opts: ['没注意到', '夸一句好看', '开玩笑吐槽'], best: 1 },
  { q: '你心里的理想约会是？', opts: ['各玩各的手机', '一起做喜欢的小事', '越贵越好'], best: 1 },
  { q: 'TA 遇到烦心事找你吐槽，你会？', opts: ['讲一堆大道理', '先抱抱再听TA说', '让TA自己消化'], best: 1 },
];

/** 星座名单 */
const ZODIAC_LIST = ['白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座', '水瓶座', '双鱼座'];
/** 星座四元素分组（同元素高契合，相邻元素互补） */
const ZODIAC_GROUP: Record<string, 'fire' | 'earth' | 'air' | 'water'> = {
  白羊座: 'fire', 狮子座: 'fire', 射手座: 'fire',
  金牛座: 'earth', 处女座: 'earth', 摩羯座: 'earth',
  双子座: 'air', 天秤座: 'air', 水瓶座: 'air',
  巨蟹座: 'water', 天蝎座: 'water', 双鱼座: 'water',
};

function zodiacScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 92;
  const ga = ZODIAC_GROUP[a];
  const gb = ZODIAC_GROUP[b];
  if (ga === gb) return 88;
  const fireAir = (ga === 'fire' && gb === 'air') || (ga === 'air' && gb === 'fire');
  const earthWater = (ga === 'earth' && gb === 'water') || (ga === 'water' && gb === 'earth');
  if (fireAir || earthWater) return 85;
  // 同名固定基数 + 星座名长度做扰动（确定性，同组合每次结果一致）
  return 70 + ((a.length * 7 + b.length * 5) % 8);
}

/** 恋爱状态选项 */
const STATUS_LIST = ['热恋中 🔥', '稳定陪伴 🫶', '异地思念 ✈️', '老夫老妻 🏡', '暧昧升温 🌡️', '和好如初 🌈'];

/** 回复挑战题面 */
const REPLY_PROMPTS = [
  'TA 说：「我今天好累啊……」',
  'TA 说：「你是不是不爱我了？」',
  'TA 发来一张自拍问：「好看吗？」',
  'TA 说：「我们以后会一直在一起吗？」',
  'TA 半夜发消息：「睡不着」',
  'TA 说：「给你一个机会夸我」',
  'TA 说：「我想吃火锅了」',
  'TA 说：「我好像胖了」',
];

/** 情侣酒店房型（玩梗向） */
const HOTEL_ROOMS = [
  { name: '云朵大床房', desc: '整面落地窗，适合一起赖床到中午' },
  { name: '星空圆床房', desc: '屋顶天窗，躺着数星星' },
  { name: '温泉私汤房', desc: '独立汤池，冬夜首选' },
  { name: '海边木屋', desc: '推门就是沙滩和日出' },
];

/** 心情选项 */
const MOOD_LIST = [
  { emoji: '😊', label: '开心' }, { emoji: '🥰', label: '甜蜜' }, { emoji: '😴', label: '困困' },
  { emoji: '😤', label: '生气' }, { emoji: '😢', label: '委屈' }, { emoji: '🤔', label: '思考' },
  { emoji: '🤩', label: '兴奋' }, { emoji: '🥲', label: '想TA' },
];

// ---------------- 小工具 ----------------

function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 纪念日 → 在一起天数（含当天，最小 1） */
function daysSince(anniv: string | null): number | null {
  if (!anniv) return null;
  const t = new Date(`${anniv}T00:00:00`);
  if (Number.isNaN(t.getTime())) return null;
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((base.getTime() - t.getTime()) / 86400000) + 1;
  return diff >= 1 ? diff : 1;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** 生成情侣号（s + 9 位大小写字母数字，参考图样式如 sTCS9PFVKL） */
function genCoupleNo(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = 's';
  for (let i = 0; i < 9; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** 'YYYY-MM-DD' → 中文日期 + 星期（如 2006年6月20日 周二） */
function fmtDateCn(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}`;
}

/** 距离最近一个生日的天数（ MM-DD 重复出现；当天→0，已过→明年） */
function daysToNextMonthDay(md: string): number | null {
  const m = /^\d{4}-(\d{2}-\d{2})$/.exec(md);
  if (!m) return null;
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(`${now.getFullYear()}-${m[1]}T00:00:00`);
  if (Number.isNaN(next.getTime())) return null;
  if (next.getTime() < base.getTime()) next = new Date(next.getTime() + 365 * 86400000 + 6 * 3600000);
  return Math.round((next.getTime() - base.getTime()) / 86400000);
}

/** 像素爱心（参考图「我们」页双头像之间的小像素心，白灰配色） */
function PixelHeart({ size = 40 }: { size?: number }) {
  const px = size / 7;
  const cells: [number, number][] = [
    [1, 0], [2, 0], [4, 0], [5, 0],
    [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1],
    [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2],
    [1, 3], [2, 3], [3, 3], [4, 3], [5, 3],
    [2, 4], [3, 4], [4, 4],
    [3, 5],
  ];
  return (
    <svg width={size} height={size * 0.9} viewBox={`0 0 7 ${7 * 0.9}`} aria-hidden="true">
      {cells.map(([x, y], i) => (
        <rect key={i} x={x * px} y={y * px} width={px * 1.02} height={px * 1.02} rx={px * 0.22} fill={i % 3 === 0 ? '#b9b9c1' : '#8e8e97'} />
      ))}
    </svg>
  );
}

/** 头像：有图显示图，无图显示灰底剪影 */
function CoupleAvatar({ src, name, size, ring = true }: { src: string | null; name: string; size: number; ring?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`relative shrink-0 overflow-hidden rounded-full bg-[#ececef] ${ring ? 'ring-2 ring-white shadow-[0_2px_10px_rgba(0,0,0,0.10)]' : ''}`}
        style={{ width: size, height: size }}
      >
        {src ? (
           
          <img src={src} alt={name} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <DefaultAvatar size={size} />
        )}
      </div>
      <span className="max-w-[88px] truncate text-[13px] font-medium text-[#5a5a62]">{name || '…'}</span>
    </div>
  );
}

// ---------------- 主组件 ----------------

type TabKey = 'home' | 'discover' | 'album' | 'us';

type SubPage =
  | 'tree' | 'track' | 'quiz' | 'letters'
  | 'house' | 'mood' | 'tarot' | 'hundred' | 'pact' | 'exam' | 'zodiac'
  | 'chronicle' | 'stone' | 'reply' | 'hotel' | 'status' | 'impress'
  | 'profile' | 'missyou' | 'chapel' | 'support' | 'settings'
  | 'album' | 'anniv';

export default function CoupleSpaceApp() {
  const [toast, showToast] = useLocalToast();
  const [state, setState] = useState<CoupleState>(() => loadCoupleState());
  const [tab, setTab] = useState<TabKey>('home');
  const [sub, setSub] = useState<SubPage | null>(null);
  const [albumId, setAlbumId] = useState<string | null>(null); // 打开的私密相册
  const bootFilled = useRef(false);

  /** 状态更新 + 防抖落盘 */
  const patch = useCallback((p: Partial<CoupleState>) => {
    setState((prev) => {
      const next = { ...prev, ...p };
      kvSetDebounced(STATE_KEY, next);
      return next;
    });
  }, []);

  /** 解除关系：清空全部数据回到邀请页（设置页入口） */
  const resetAll = useCallback(() => {
    kvSet(STATE_KEY, defaultState());
    setState(defaultState());
    setSub(null);
  }, []);

  /** 首次进入：预填「我」的信息卡资料 + 联系人第一位 AI 角色作为恋人；记录登录 + 生成情侣号 */
  useEffect(() => {
    if (bootFilled.current) return;
    bootFilled.current = true;
    (async () => {
      try {
        const me = loadProfileCard();
        const cur = loadCoupleState();
        const needMe = !cur.meName;
        const needTa = !cur.taName;
        const meta: Partial<CoupleState> = {};
        if (!cur.coupleNo) meta.coupleNo = genCoupleNo();
        // 登录记录：每次会话记一条（去重到分钟），只留最近 20 条
        const last = cur.logins[0];
        if (!last || Date.now() - last > 60_000) meta.logins = [Date.now(), ...cur.logins].slice(0, 20);
        if (needMe || needTa || Object.keys(meta).length > 0) {
          let taName = '';
          let taAvatar: string | null = null;
          if (needTa) {
            try {
              const list = await listContacts();
              const c = list.find((x) => x.kind === 'char');
              if (c) {
                taName = c.nickname || c.remark || c.name || '';
                taAvatar = c.avatar || null;
              }
            } catch {
              /* 联系人拉取失败静默，保留空值 */
            }
          }
          setState((prev) => ({
            ...prev,
            ...meta,
            meName: prev.meName || (needMe ? me.name : prev.meName),
            meAvatar: prev.meAvatar ?? (needMe ? me.avatar : prev.meAvatar),
            taName: prev.taName || taName,
            taAvatar: prev.taAvatar ?? taAvatar,
          }));
        }
      } catch {
        /* 预填失败静默 */
      }
    })();
  }, []);

  const days = daysSince(state.anniversary);
  const homeBgSrc = state.homeBg || '/couple-home-bg.png';
  /** 「想他/想我」天数：首次点击每天想那一天起算 */
  const missDays = state.missSince ? daysSince(state.missSince) : null;

  /** 每天想你 +1（首次点击记录 missSince，之后首页大圆消失改为头像下想念天数） */
  const tapMissYou = useCallback(() => {
    setState((prev) => {
      const k = todayKey();
      const next: CoupleState = {
        ...prev,
        missYou: prev.missYou + 1,
        missSince: prev.missSince || k,
        missYouByDay: { ...prev.missYouByDay, [k]: (prev.missYouByDay[k] || 0) + 1 },
      };
      kvSetDebounced(STATE_KEY, next);
      return next;
    });
    showToast('想 TA 的心意 +1 ♡');
  }, [showToast]);

  /** 浇水（爱情树） */
  const waterTree = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, tree: Math.min(100, prev.tree + 2) };
      kvSetDebounced(STATE_KEY, next);
      return next;
    });
    showToast('浇好水啦，小树茁壮成长 🌱');
  }, [showToast]);

  // ---------- 邀请页（图1） ----------
  if (!state.accepted) {
    return (
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-[linear-gradient(165deg,#fbfbfc_0%,#f1f1f3_45%,#e3e3e7_100%)] text-[#2c2c30]">
        {/* 装饰大圆（白灰层叠） */}
        <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/70" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 top-40 h-56 w-56 rounded-full bg-white/50" />
        <div aria-hidden="true" className="pointer-events-none absolute -left-10 bottom-40 h-44 w-44 rounded-full bg-white/40" />
        {/* 浮动小点（原彩色点改为深浅灰） */}
        <div aria-hidden="true" className="pointer-events-none absolute left-[24%] top-[30%] h-3.5 w-3.5 rounded-full bg-[#c9c9cf]" />
        <div aria-hidden="true" className="pointer-events-none absolute left-[7%] top-[38%] h-3 w-3 rounded-full bg-[#dedee2]" />
        <div aria-hidden="true" className="pointer-events-none absolute right-[13%] top-[41%] h-4 w-4 rounded-full bg-[#c3c3ca]" />
        <div aria-hidden="true" className="pointer-events-none absolute right-[7%] top-[54%] h-2.5 w-2.5 rounded-full bg-[#d6d6db]" />
        <div aria-hidden="true" className="pointer-events-none absolute left-[13%] top-[57%] h-2.5 w-2.5 rounded-full bg-[#bfbfc7]" />

        <div className="relative flex flex-1 flex-col items-center px-8 pt-[150px]">
          {/* 恋人头像 + 名字 */}
          <div className="h-[118px] w-[118px] overflow-hidden rounded-full bg-[#ececef] ring-[6px] ring-white/80 shadow-[0_10px_30px_rgba(0,0,0,0.10)]">
            {state.taAvatar ? (
               
              <img src={state.taAvatar} alt={state.taName} className="h-full w-full object-cover" draggable={false} />
            ) : (
              <DefaultAvatar size={118} />
            )}
          </div>
          <div className="mt-8 text-[30px] font-bold leading-none">{state.taName || '恋人'}</div>
          <div className="mt-7 text-[30px] font-bold leading-tight text-[#3c3c42]">邀请你开通恋人空间</div>
          <div className="mt-2 self-center pl-24 text-[16px] text-[#8e8e96]">（原情侣空间）</div>

          <button
            type="button"
            onClick={() => {
              patch({ accepted: true });
              showToast('欢迎来到你们的小天地 ♡');
            }}
            className="mt-10 h-[64px] w-full rounded-full bg-[linear-gradient(135deg,#6a6a72,#45454c)] text-[22px] font-semibold text-white shadow-[0_12px_28px_rgba(60,60,68,0.28)] transition-transform active:scale-[0.98]"
          >
            接受邀请
          </button>
        </div>

        <div className="relative px-6 pb-12">
          <div className="mb-4 text-center text-[16px] text-[#9a9aa2]">在恋人空间你们可以体验这些</div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: '情侣相册', icon: <Camera className="h-8 w-8" strokeWidth={1.8} /> },
              { label: '爱情树', icon: <Sprout className="h-8 w-8" strokeWidth={1.8} /> },
              { label: '纪念日', icon: <BadgeCheck className="h-8 w-8" strokeWidth={1.8} /> },
            ].map((it) => (
              <div key={it.label} className="flex h-[110px] flex-col items-center justify-center gap-2.5 rounded-2xl bg-white shadow-[0_6px_18px_rgba(0,0,0,0.05)]">
                <span className="text-[#6e6e76]">{it.icon}</span>
                <span className="text-[15px] font-medium text-[#4a4a52]">{it.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---------- 已接受邀请：主界面（4 Tab + 子页覆盖层） ----------
  const openSub = (s: SubPage) => setSub(s);
  const closeSub = () => {
    setSub(null);
    setAlbumId(null);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#f6f6f8_55%,#ececee_100%)] text-[#2c2c30]">
      <LocalToast msg={toast} />

      {/* 全局背景：合影铺满整个 App，所有 Tab 共用；各 Tab 叠白纱保证可读 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
        <img src={homeBgSrc} alt="" className="h-full w-full object-cover" draggable={false} />
        <div className="absolute inset-0 bg-white/70" />
        {tab === 'home' && (
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.8)_0%,rgba(255,255,255,0.18)_34%,rgba(255,255,255,0.16)_58%,rgba(255,255,255,0.88)_100%)]" />
        )}
      </div>

      {/* 内容区 */}
      <div className="relative z-10 flex-1 overflow-hidden">
        {tab === 'home' && (
          <HomePage
            state={state}
            days={days}
            missDays={missDays}
            tapMissYou={tapMissYou}
            openSub={openSub}
            onPickBg={async (f) => {
              if (!f) return;
              try {
                const url = await fileToScaledDataURL(f, 1080, 0.75);
                patch({ homeBg: url });
                showToast('背景已更换 ♡');
              } catch {
                showToast('图片处理失败，换一张试试');
              }
            }}
          />
        )}
        {tab === 'discover' && <DiscoverPage openSub={openSub} />}
        {tab === 'album' && (
          <AlbumPage
            state={state}
            patch={patch}
            showToast={showToast}
            openAlbum={(id) => {
              setAlbumId(id);
              setSub('album');
            }}
          />
        )}
        {tab === 'us' && <UsPage state={state} days={days} openSub={openSub} />}
      </div>

      {/* 底部 Tab 栏（子页打开时隐藏） */}
      {!sub && (
        <nav aria-label="情侣空间导航" className="relative z-20 shrink-0 border-t border-black/[0.06] bg-white/90 pb-3 pt-1 backdrop-blur-md">
          <div className="grid grid-cols-4">
            {([
              { key: 'home', label: '首页', icon: Heart },
              { key: 'discover', label: '发现', icon: Compass },
              { key: 'album', label: '相册', icon: BookHeart },
              { key: 'us', label: '我们', icon: Smile },
            ] as const).map((t) => {
              const active = tab === t.key;
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key);
                    closeSub();
                  }}
                  aria-label={t.label}
                  aria-current={active ? 'page' : undefined}
                  className="flex h-[42px] flex-col items-center justify-center gap-[2px] transition-opacity active:opacity-60"
                >
                  <Icon
                    className="h-[19px] w-[19px]"
                    strokeWidth={active ? 2.5 : 1.9}
                    fill={active && t.key === 'home' ? 'currentColor' : 'none'}
                    color={active ? '#3a3a40' : '#b6b6bd'}
                  />
                  <span className={`text-[10px] leading-none ${active ? 'font-semibold text-[#3a3a40]' : 'text-[#b6b6bd]'}`}>{t.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* 子页（覆盖整个 App 含 Tab 栏，滑入动画） */}
      {sub && (
        <div className="absolute inset-0 z-30 bg-[#f6f6f8] [animation:couple-sub-in_.26s_cubic-bezier(0.32,0.72,0,1)_both]">
          <SubRouter
            sub={sub}
            state={state}
            patch={patch}
            albumId={albumId}
            days={days}
            tapMissYou={tapMissYou}
            waterTree={waterTree}
            close={closeSub}
            showToast={showToast}
            openSub={openSub}
            onReset={resetAll}
          />
        </div>
      )}
    </div>
  );
}

// ---------------- 首页（图2） ----------------

function HomePage(props: {
  state: CoupleState;
  days: number | null;
  missDays: number | null;
  tapMissYou: () => void;
  openSub: (s: SubPage) => void;
  onPickBg: (f: File | null) => void;
}) {
  const { state, days, missDays, tapMissYou, openSub, onPickBg } = props;
  const bgInput = useRef<HTMLInputElement | null>(null);
  const [pulse, setPulse] = useState(0);

  /** 头像 + 下方想念天数徽标（点击「每天想你」后出现） */
  const avatarCol = (side: 'me' | 'ta') => {
    const isMe = side === 'me';
    return (
      <div className="flex w-[78px] flex-col items-center">
        <CoupleAvatar src={isMe ? state.meAvatar : state.taAvatar} name={isMe ? state.meName : state.taName} size={52} />
        {missDays != null && (
          <button
            type="button"
            onClick={() => openSub('missyou')}
            className="mt-1 rounded-full bg-white/90 px-2 py-[3px] text-[10px] font-medium leading-none text-[#5a5a62] shadow-[0_2px_8px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-opacity active:opacity-60"
          >
            {isMe ? '想他' : '想我'} {missDays} 天
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="relative h-full overflow-y-auto overscroll-contain">
      <div className="px-5 pt-[60px]">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight">恋人空间</h1>
      </div>

      {/* 双头像 + 纪念日气泡 + 想念天数 */}
      <div className="mt-3 flex items-start justify-between px-4">
        {avatarCol('me')}
        <div className="relative flex-1 px-1.5 pt-1">
          {/* 虚线连接线 */}
          <svg viewBox="0 0 200 40" className="absolute left-1 right-1 top-[22px] h-9 w-[calc(100%-8px)]" aria-hidden="true">
            <path d="M6 14 C 60 -6, 80 40, 100 20 S 150 6, 194 26" fill="none" stroke="#c7c7ce" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" />
          </svg>
          <button
            type="button"
            onClick={() => openSub('anniv')}
            className="relative mx-auto flex min-h-[54px] w-[164px] items-center justify-center rounded-full border-2 border-white bg-white/90 px-3 py-2 text-center shadow-[0_6px_16px_rgba(0,0,0,0.09)] backdrop-blur-sm transition-transform active:scale-[0.97]"
          >
            {days == null ? (
              <span className="text-[12.5px] font-semibold leading-snug text-[#4a4a52]">
                点击设置你们
                <br />
                相恋的纪念日
              </span>
            ) : (
              <span className="text-[12.5px] font-semibold leading-snug text-[#4a4a52]">
                已相恋
                <br />
                {days} 天
              </span>
            )}
          </button>
        </div>
        {avatarCol('ta')}
      </div>

      {/* 每天想你大圆：首次点击打卡后消失，改为头像下方想念天数 */}
      {missDays == null ? (
        <div className="relative mt-3 flex h-[286px] w-full items-start justify-center">
          {/* 引号装饰 */}
          <span aria-hidden="true" className="absolute left-[18%] top-[44px] select-none font-serif text-[44px] font-bold leading-none text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.18)]">&ldquo;</span>
          <span aria-hidden="true" className="absolute right-[18%] top-[44px] select-none font-serif text-[44px] font-bold leading-none text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.18)]">&rdquo;</span>
          <button
            type="button"
            onClick={() => {
              tapMissYou();
              setPulse((p) => p + 1);
            }}
            aria-label="每天想你，点击打卡"
            className="relative top-[36px] flex h-[150px] w-[150px] items-center justify-center rounded-full bg-[radial-gradient(circle_at_32%_28%,#cfcfd6,#a9a9b2_68%,#96969f)] text-white shadow-[0_16px_40px_rgba(70,70,80,0.38)] transition-transform active:scale-[0.97]"
          >
            <span aria-hidden="true" className="absolute -inset-2.5 rounded-full bg-white/30" />
            <span key={pulse} aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full bg-white/40 [animation:couple-ripple-out_.7s_ease-out]" />
            <span key={`t${pulse}`} className="relative block text-[20px] font-bold tracking-wide [animation:couple-pop-heart_.45s_ease-out]">
              每天想你
            </span>
          </button>
        </div>
      ) : (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => openSub('missyou')}
            className="flex items-center gap-1.5 rounded-full bg-white/90 py-1.5 pl-3 pr-3.5 text-[12px] font-medium text-[#5a5a62] shadow-[0_4px_14px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-opacity active:opacity-60"
          >
            <Heart className="h-3.5 w-3.5 text-[#8e8e97]" fill="#c9c9cf" />
            已互相想念 {missDays} 天 · 点我看记录
          </button>
        </div>
      )}

      {/* 右侧悬浮操作（想念记录 / 换背景） */}
      <div className="absolute bottom-4 right-3 flex flex-col gap-2.5">
        <button
          type="button"
          onClick={() => openSub('missyou')}
          aria-label="每天想你记录"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-opacity active:opacity-70"
        >
          <Heart className="h-4 w-4" fill="none" />
        </button>
        <button
          type="button"
          onClick={() => bgInput.current?.click()}
          aria-label="更换背景"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-opacity active:opacity-70"
        >
          <ImageIcon className="h-4 w-4" />
        </button>
      </div>
      <input
        ref={bgInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onPickBg(e.target.files?.[0] ?? null);
          e.currentTarget.value = '';
        }}
      />

      {/* 底部四功能卡（炭灰渐变，白灰主题） */}
      <div className="grid grid-cols-4 gap-2 px-3 pb-5 pt-3">
        {([
          { key: 'tree', label: '爱情小树\n成长记', grad: 'linear-gradient(160deg,#5c5c64,#3f3f46)', icon: <Sprout className="h-6 w-6" strokeWidth={1.9} /> },
          { key: 'track', label: '情侣轨迹', grad: 'linear-gradient(160deg,#7c7c85,#5f5f68)', icon: <Compass className="h-6 w-6" strokeWidth={1.9} /> },
          { key: 'quiz', label: '甜蜜\n小问答', grad: 'linear-gradient(160deg,#9c9ca5,#7f7f89)', icon: <MessageCircleHeart className="h-6 w-6" strokeWidth={1.9} /> },
          { key: 'letters', label: '未来情书', grad: 'linear-gradient(160deg,#bcbcc4,#9e9ea8)', icon: <BookHeart className="h-6 w-6" strokeWidth={1.9} /> },
        ] as const).map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => openSub(c.key as SubPage)}
            className="flex h-[86px] flex-col items-center justify-center gap-1.5 rounded-2xl text-white shadow-[0_8px_20px_rgba(60,60,70,0.22)] transition-transform active:scale-[0.96]"
            style={{ background: c.grad }}
          >
            {c.icon}
            <span className="whitespace-pre-line text-center text-[11px] font-medium leading-tight">{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}


// ---------------- 发现页（图3） ----------------

const DISCOVER_GRID: { key: SubPage; label: string; icon: React.ReactNode }[] = [
  { key: 'mood', label: '心情日记', icon: <NotebookPen className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'tarot', label: '爱情塔罗', icon: <Scale className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'hundred', label: '100件小事', icon: <Heart className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'pact', label: '恋爱协议', icon: <Pencil className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'exam', label: '恋爱水平考试', icon: <CalendarClock className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'zodiac', label: '星座缘分', icon: <Star className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'chronicle', label: '恋爱编年史', icon: <CalendarDays className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'stone', label: '三生石', icon: <Gem className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'reply', label: '回复挑战', icon: <MessageCircleHeart className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'hotel', label: '情侣酒店', icon: <Users className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'status', label: '恋爱状态', icon: <Sparkles className="h-7 w-7" strokeWidth={1.9} /> },
  { key: 'impress', label: '情侣印象', icon: <Smile className="h-7 w-7" strokeWidth={1.9} /> },
];

function DiscoverPage({ openSub }: { openSub: (s: SubPage) => void }) {
  return (
    <div className="h-full overflow-y-auto overscroll-contain pb-5">
      <div className="px-5 pt-[60px]">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight">发现</h1>
        <p className="mt-0.5 text-[13px] text-[#8e8e96]">一起玩吧</p>
      </div>

      {/* 两张大卡 */}
      <div className="mt-3.5 grid grid-cols-2 gap-2.5 px-3">
        <button
          type="button"
          onClick={() => openSub('track')}
          className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_22px_rgba(0,0,0,0.08)] transition-transform active:scale-[0.98]"
        >
          { }
          <img src="/couple-map.png" alt="情侣轨迹" className="h-[118px] w-full rounded-t-2xl object-cover" draggable={false} />
          <div className="flex h-[44px] items-center justify-center bg-[linear-gradient(135deg,#56565e,#38383f)] text-[15px] font-semibold text-white">
            情侣轨迹
          </div>
        </button>
        <button
          type="button"
          onClick={() => openSub('house')}
          className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_22px_rgba(0,0,0,0.08)] transition-transform active:scale-[0.98]"
        >
          { }
          <img src="/couple-house.png" alt="情侣小家" className="h-[118px] w-full rounded-t-2xl object-cover" draggable={false} />
          <div className="flex h-[44px] items-center justify-center bg-[linear-gradient(135deg,#74747d,#55555e)] text-[15px] font-semibold text-white">
            情侣小家
          </div>
        </button>
      </div>

      {/* 情感升温小技巧 3×4 宫格 */}
      <h2 className="px-4 pb-2.5 pt-5 text-[16px] font-bold">情感升温小技巧</h2>
      <div className="grid grid-cols-3 gap-x-2.5 gap-y-2.5 px-3 pb-3">
        {DISCOVER_GRID.map((it, i) => (
          <button
            key={it.key + String(i)}
            type="button"
            onClick={() => openSub(it.key)}
            className="flex h-[86px] flex-col items-center justify-center gap-2 rounded-2xl transition-transform active:scale-[0.96]"
            style={{ background: ['#f7f7f9', '#f1f1f4', '#ebebee'][i % 3] }}
          >
            <span className="text-[#5a5a63]">{it.icon}</span>
            <span className="px-1 text-center text-[12px] font-medium leading-tight text-[#3c3c42]">{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- 相册页（图4） ----------------

const ALBUM_TINTS = ['#f5f5f7', '#ededf0', '#f8f8fa', '#eaeaee'];
const FIXED_ALBUM_ICONS: Record<string, React.ReactNode> = {
  ta: <Camera className="h-12 w-12" strokeWidth={1.5} />,
  chat: <MessageCircleHeart className="h-12 w-12" strokeWidth={1.5} />,
  diary: <NotebookPen className="h-12 w-12" strokeWidth={1.5} />,
  anniv: <CalendarDays className="h-12 w-12" strokeWidth={1.5} />,
};

function AlbumPage(props: {
  state: CoupleState;
  patch: (p: Partial<CoupleState>) => void;
  showToast: (m: string) => void;
  openAlbum: (id: string) => void;
}) {
  const { state, patch, showToast, openAlbum } = props;
  const input = useRef<HTMLInputElement | null>(null);
  const targetAlbum = useRef<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [manage, setManage] = useState(false);

  const uploadTo = (id: string) => {
    targetAlbum.current = id;
    input.current?.click();
  };

  const handleFiles = async (files: FileList | null) => {
    const id = targetAlbum.current;
    if (!files || !id) return;
    const album = state.albums.find((a) => a.id === id);
    if (!album) return;
    showToast('正在上传…');
    const urls: string[] = [];
    for (const f of Array.from(files).slice(0, 9)) {
      try {
        urls.push(await fileToScaledDataURL(f, 900, 0.72));
      } catch {
        /* 单张失败跳过 */
      }
    }
    if (urls.length === 0) {
      showToast('图片处理失败');
      return;
    }
    patch({ albums: state.albums.map((a) => (a.id === id ? { ...a, photos: [...a.photos, ...urls] } : a)) });
    showToast(`已上传 ${urls.length} 张 ♡`);
  };

  const createAlbum = () => {
    const name = newName.trim() || `相册 ${state.albums.length - 3}`;
    patch({ albums: [...state.albums, { id: uid(), name, desc: '', photos: [] }] });
    setCreating(false);
    setNewName('');
    showToast('相册已创建 ♡');
  };

  const removeAlbum = (id: string) => {
    if (['ta', 'chat', 'diary', 'anniv'].includes(id)) {
      showToast('固定相册不能删除哦');
      return;
    }
    patch({ albums: state.albums.filter((a) => a.id !== id) });
    setManage(false);
    showToast('相册已删除');
  };

  const custom = state.albums.filter((a) => !['ta', 'chat', 'diary', 'anniv'].includes(a.id));

  return (
    <div className="relative h-full overflow-y-auto overscroll-contain pb-24">
      <div className="px-5 pt-[60px]">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight">相册</h1>
      </div>

      {/* 四张固定上传卡 2×2：点击整卡进入独立相册页 */}
      <div className="mt-3.5 grid grid-cols-2 gap-2.5 px-1">
        {state.albums.slice(0, 4).map((a, i) => (
          <button
            key={a.id}
            type="button"
            onClick={() => openAlbum(a.id)}
            className="relative overflow-hidden rounded-2xl p-3.5 text-left shadow-[0_6px_16px_rgba(0,0,0,0.05)] transition-transform active:scale-[0.98]"
            style={{ background: ALBUM_TINTS[i] }}
          >
            <div className="text-[16px] font-bold text-[#3a3a40]">{a.name}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-[#9a9aa2]">{a.desc}</div>
            <div className="mt-2 flex items-center gap-2">
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  uploadTo(a.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    uploadTo(a.id);
                  }
                }}
                className="rounded-full bg-white px-3 py-1 text-[11.5px] font-medium text-[#4a4a52] shadow-sm"
              >
                立即上传
              </span>
              <span className="text-[11px] text-[#b6b6bd]">{a.photos.length} 张</span>
            </div>
            <span aria-hidden="true" className="pointer-events-none absolute -bottom-1.5 -right-1 text-[#d9d9de]">
              {FIXED_ALBUM_ICONS[a.id]}
            </span>
          </button>
        ))}
      </div>

      {/* 情侣私密相册 */}
      <div className="mt-6 flex items-center justify-between px-1.5">
        <h2 className="text-[17px] font-bold">情侣私密相册</h2>
        <button
          type="button"
          onClick={() => setManage((v) => !v)}
          aria-label="管理相册"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5a5a62] transition-opacity active:opacity-60"
        >
          <span className="flex flex-col gap-[3px]">
            <span className="block h-[2px] w-[18px] rounded bg-current" />
            <span className="block h-[2px] w-[18px] rounded bg-current" />
            <span className="block h-[2px] w-[18px] rounded bg-current" />
          </span>
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2.5 px-1">
        {/* 新建 tile */}
        <button
          type="button"
          onClick={() => setCreating(true)}
          aria-label="新建相册"
          className="flex h-[140px] items-center justify-center rounded-xl bg-[#f0f0f3]/90 transition-opacity active:opacity-70"
        >
          <Plus className="h-10 w-10 text-[#c2c2c9]" strokeWidth={1.6} />
        </button>
        {custom.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => openAlbum(a.id)}
            className="relative h-[140px] overflow-hidden rounded-xl bg-[#e6e6ea] text-left transition-transform active:scale-[0.98]"
          >
            {a.photos[0] ? (
               
              <img src={a.photos[0]} alt={a.name} className="h-full w-full object-cover" draggable={false} />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[#c2c2c9]">
                <ImageIcon className="h-9 w-9" strokeWidth={1.4} />
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/55 to-transparent px-3 pb-2 pt-6 text-[14px] font-medium text-white">
              {a.name}
              <span className="text-[12px] opacity-80">{a.photos.length} 张</span>
            </span>
            {manage && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  removeAlbum(a.id);
                }}
                onKeyDown={(e) => e.key === 'Enter' && removeAlbum(a.id)}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white"
                aria-label={`删除${a.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 悬浮新建相册按钮 */}
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="fixed bottom-[86px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-5 py-2.5 text-[14px] font-semibold text-white shadow-[0_10px_26px_rgba(60,60,68,0.35)] transition-transform active:scale-[0.97]"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25">
          <Plus className="h-3.5 w-3.5" />
        </span>
        新建相册
      </button>

      {/* 新建相册弹层 */}
      {creating && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-10" onClick={() => setCreating(false)}>
          <div className="w-full rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[17px] font-semibold text-[#2c2c30]">新建相册</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="给相册取个名字吧"
              maxLength={12}
              className="mt-3 h-11 w-full rounded-xl bg-[#f3f3f5] px-3.5 text-[15px] text-[#2c2c30] outline-none placeholder:text-[#b6b6bd]"
            />
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={() => setCreating(false)} className="h-11 flex-1 rounded-xl bg-[#f0f0f3] text-[15px] font-medium text-[#5a5a62]">
                取消
              </button>
              <button type="button" onClick={createAlbum} className="h-11 flex-1 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[15px] font-semibold text-white">
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}

// ---------------- 我们页（图5） ----------------

/** 灰色小蝴蝶结（蕾丝装饰，白灰主题） */
function LaceBow({ className = '', size = 26 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 30 22" fill="none" aria-hidden="true" className={className}>
      <path d="M14 11 L3.5 4.5 C2 3.6 1 4.6 1.4 6.2 L3.6 13.4 C4 14.9 5.4 15.4 6.6 14.5 Z" fill="#e8e8ec" stroke="#c9c9d0" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M16 11 L26.5 4.5 C28 3.6 29 4.6 28.6 6.2 L26.4 13.4 C26 14.9 24.6 15.4 23.4 14.5 Z" fill="#e8e8ec" stroke="#c9c9d0" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M12.6 12.5 C11.8 15.5 12.4 18.2 13.8 20.2 M17.4 12.5 C18.2 15.5 17.6 18.2 16.2 20.2" stroke="#c9c9d0" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="15" cy="10.6" r="3.1" fill="#dcdce1" stroke="#bdbdc5" strokeWidth="1.1" />
    </svg>
  );
}

/** 蕾丝圆点拱边（一排带圆点的半圆拱，参考图样式） */
function LaceArches({ count = 16 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="flex items-end justify-center gap-[5px]">
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className="relative block h-[13px] w-[15px] overflow-hidden rounded-t-full bg-[#f1f1f4] shadow-[inset_0_0_0_1px_#e4e4e9]">
          <span className="absolute left-1/2 top-[3px] h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-[#d6d6dc]" />
          <span className="absolute left-[3px] top-[7.5px] h-[2px] w-[2px] rounded-full bg-[#dedee3]" />
          <span className="absolute right-[3px] top-[7.5px] h-[2px] w-[2px] rounded-full bg-[#dedee3]" />
        </span>
      ))}
    </div>
  );
}

function UsPage({ state, days, openSub }: { state: CoupleState; days: number | null; openSub: (s: SubPage) => void }) {
  const rows: { key: SubPage; label: string; icon: React.ReactNode; right?: React.ReactNode }[] = [
    { key: 'profile', label: '恋爱资料', icon: <IdCard className="h-[19px] w-[19px]" strokeWidth={1.8} /> },
    {
      key: 'anniv',
      label: '纪念日',
      icon: <CalendarDays className="h-[19px] w-[19px]" strokeWidth={1.8} />,
      right: <span className="max-w-[150px] truncate text-[12px] text-[#b6b6bd]">{state.anniversary ? `${state.anniversary}` : '还没设置纪念日提醒哦'}</span>,
    },
    { key: 'missyou', label: '每天想你', icon: <Heart className="h-[19px] w-[19px]" strokeWidth={1.8} /> },
    { key: 'quiz', label: '甜蜜小问答', icon: <MessageCircleHeart className="h-[19px] w-[19px]" strokeWidth={1.8} /> },
    { key: 'chapel', label: '小礼堂', icon: <Landmark className="h-[19px] w-[19px]" strokeWidth={1.8} /> },
    { key: 'support', label: '联系客服', icon: <Headphones className="h-[19px] w-[19px]" strokeWidth={1.8} /> },
    { key: 'settings', label: '设置', icon: <SettingsIcon className="h-[19px] w-[19px]" strokeWidth={1.8} /> },
  ];

  return (
    <div className="h-full overflow-y-auto overscroll-contain pb-6">
      <div className="px-3 pt-[62px]">
        {/* 蕾丝装饰日记卡：蝴蝶结 + 圆点拱边 + 方格纸底纹 + 像素心 */}
        <div className="relative overflow-hidden rounded-2xl bg-white pb-4 shadow-[0_8px_22px_rgba(0,0,0,0.06)]">
          {/* 方格纸底纹 */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(#00000007_1px,transparent_1px),linear-gradient(90deg,#00000007_1px,transparent_1px)] bg-[size:14px_14px]" />
          {/* 左右角小蝴蝶结 */}
          <LaceBow className="absolute left-1.5 top-1.5 opacity-80" size={22} />
          <LaceBow className="absolute right-1.5 top-1.5 -scale-x-100 opacity-80" size={22} />
          {/* 顶部蕾丝拱边 + 中心蝴蝶结 */}
          <div className="relative mx-1 mt-1">
            <LaceArches count={16} />
            <LaceBow className="absolute left-1/2 top-[-3px] -translate-x-1/2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.10)]" size={26} />
          </div>

          <div className="relative -mt-0.5 text-center text-[13px] font-bold tracking-[2px] text-[#4a4a52]">
            <span className="mx-1 text-[#b9b9c1]">+</span>
            <span className="mx-0.5 text-[#b9b9c1]">♡</span>
            <span className="mx-1 text-[#cfcfd6]">---</span>
            <span className="mx-1 text-[#b9b9c1]">✕</span>
            <span className="mx-1.5">我们の恋爱日记</span>
            <span className="mx-1 text-[#b9b9c1]">✕</span>
            <span className="mx-1 text-[#cfcfd6]">---</span>
            <span className="mx-0.5 text-[#b9b9c1]">♡</span>
            <span className="mx-1 text-[#b9b9c1]">+</span>
          </div>

          {/* 双头像 + 像素心 + 进度条 + 天数 */}
          <div className="relative mt-4 flex items-start justify-between px-5">
            <span aria-hidden="true" className="mt-16 text-[13px] text-[#d9d9de]">♡</span>
            <CoupleAvatar src={state.meAvatar} name={state.meName} size={62} ring={false} />
            <div className="flex flex-col items-center gap-1 pt-1.5">
              <PixelHeart size={36} />
              <span className="text-[11px] text-[#8e8e96]">恋爱进度条</span>
              <div className="h-1.5 w-[80px] overflow-hidden rounded-full bg-[#ececef]">
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#8e8e97,#5c5c64)]" style={{ width: `${Math.min(100, ((days ?? 0) % 365) / 3.65 + 20)}%` }} />
              </div>
            </div>
            <CoupleAvatar src={state.taAvatar} name={state.taName} size={62} ring={false} />
            <span aria-hidden="true" className="mt-16 text-[13px] text-[#d9d9de]">♡</span>
          </div>
          <div className="relative mt-2.5 text-center text-[21px] font-bold text-[#2c2c30]">{days == null ? '未设置纪念日' : `${days} 天`}</div>
        </div>

        {/* 功能列表 */}
        <div className="mt-3 overflow-hidden rounded-2xl bg-white/95 shadow-[0_8px_22px_rgba(0,0,0,0.05)] backdrop-blur-sm">
          {rows.map((r, i) => (
            <button
              key={r.key + r.label}
              type="button"
              onClick={() => openSub(r.key)}
              className={`flex h-[52px] w-full items-center gap-3.5 px-4 text-left transition-colors active:bg-[#f6f6f8] ${i > 0 ? 'border-t border-black/[0.04]' : ''}`}
            >
              <span className="text-[#5a5a63]">{r.icon}</span>
              <span className="flex-1 text-[15px] font-medium text-[#2c2c30]">{r.label}</span>
              {r.right}
              <ChevronRight className="h-4 w-4 text-[#c6c6cd]" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- 子页容器 ----------------

function SubShell(props: { title: string; onBack: () => void; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 bg-[#f6f6f8]/92 pt-[54px] backdrop-blur-md">
        <div className="relative flex h-11 items-center px-1.5">
          <button type="button" onClick={props.onBack} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-[#3a3a40] transition-opacity active:opacity-50">
            <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[16px] font-bold">{props.title}</div>
          <div className="ml-auto flex items-center gap-2.5 pr-1.5">{props.right}</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-3.5 pb-8">{props.children}</div>
    </div>
  );
}

// ---------------- 子页路由 ----------------

function SubRouter(props: {
  sub: SubPage;
  state: CoupleState;
  patch: (p: Partial<CoupleState>) => void;
  albumId: string | null;
  days: number | null;
  tapMissYou: () => void;
  waterTree: () => void;
  close: () => void;
  showToast: (m: string) => void;
  openSub: (s: SubPage) => void;
  onReset: () => void;
}) {
  const { sub, state, patch, days, tapMissYou, waterTree, close, showToast, openSub, onReset } = props;

  switch (sub) {
    case 'tree':
      return <TreePage state={state} waterTree={waterTree} close={close} />;
    case 'track':
      return <TrackPage state={state} patch={patch} days={days} close={close} showToast={showToast} />;
    case 'quiz':
      return <QuizPage state={state} patch={patch} close={close} showToast={showToast} />;
    case 'letters':
      return <LettersPage state={state} patch={patch} close={close} showToast={showToast} />;
    case 'house':
      return <HousePage state={state} days={days} close={close} />;
    case 'mood':
      return <MoodPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'tarot':
      return <TarotPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'hundred':
      return <HundredPage state={state} patch={patch} close={close} />;
    case 'pact':
      return <PactPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'exam':
      return <ExamPage state={state} patch={patch} close={close} />;
    case 'zodiac':
      return <ZodiacPage state={state} patch={patch} close={close} />;
    case 'chronicle':
      return <ChroniclePage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'stone':
      return <StonePage state={state} days={days} close={close} />;
    case 'reply':
      return <ReplyPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'hotel':
      return <HotelPage showToast={showToast} close={close} />;
    case 'status':
      return <StatusPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'impress':
      return <ImpressPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'profile':
      return <ProfilePage state={state} patch={patch} showToast={showToast} close={close} onReset={onReset} />;
    case 'missyou':
      return <MissYouPage state={state} tapMissYou={tapMissYou} close={close} />;
    case 'chapel':
      return <ChapelPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'support':
      return <SupportPage close={close} />;
    case 'settings':
      return <SettingsPage state={state} patch={patch} showToast={showToast} close={close} onReset={onReset} />;
    case 'album':
      return <AlbumDetail state={state} patch={patch} albumId={props.albumId} showToast={showToast} close={close} />;
    case 'anniv':
      // 纪念日设置页（首页气泡/我们页入口共用）
      return <AnniversaryPage state={state} patch={patch} days={days} close={close} showToast={showToast} />;
  }
}

// ---------------- 各子页实现 ----------------

/** 纪念日页（参考图3）：英雄卡 + 纪念日列表 + 添加纪念日 */
const ANNIV_PRESETS: { key: string; label: string; icon: React.ReactNode; mode: 'since' | 'next' }[] = [
  { key: 'myBd', label: '我的生日', icon: <Cake className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'next' },
  { key: 'taBd', label: 'TA的生日', icon: <Gift className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'next' },
  { key: 'kiss', label: '第一次接吻的日子', icon: <Heart className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'since' },
  { key: 'hug', label: '第一次拥抱的日子', icon: <Users className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'since' },
  { key: 'travel', label: '第一次携手旅行的日子', icon: <Plane className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'since' },
  { key: 'wedding', label: '结婚纪念日', icon: <Landmark className="h-[18px] w-[18px]" strokeWidth={1.9} />, mode: 'since' },
];

function AnniversaryPage(props: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; days: number | null; close: () => void; showToast: (m: string) => void }) {
  const { state, patch, days, close, showToast } = props;
  /** 正在编辑的纪念日：love = 在一起纪念日；其余为 annivExtra 键 */
  const [editing, setEditing] = useState<{ key: string; label: string; date: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');

  const extraOf = (key: string) => state.annivExtra.find((e) => e.key === key);
  const dateOf = (key: string) => extraOf(key)?.date || null;

  const saveEdit = () => {
    if (!editing) return;
    if (!editing.date) {
      showToast('先选一个日期哦');
      return;
    }
    if (editing.key === 'love') {
      patch({ anniversary: editing.date });
    } else {
      const others = state.annivExtra.filter((e) => e.key !== editing.key);
      patch({ annivExtra: [...others, { key: editing.key, label: editing.label, date: editing.date }] });
    }
    showToast('纪念日已保存 ♡');
    setEditing(null);
  };

  const removeEdit = () => {
    if (!editing) return;
    if (editing.key === 'love') {
      patch({ anniversary: null });
    } else {
      patch({ annivExtra: state.annivExtra.filter((e) => e.key !== editing.key) });
    }
    showToast('已清除该纪念日');
    setEditing(null);
  };

  const addCustom = () => {
    const name = newName.trim();
    if (!name || !newDate) {
      showToast('填好名称和日期哦');
      return;
    }
    patch({ annivExtra: [...state.annivExtra, { key: uid(), label: name, date: newDate }] });
    setAdding(false);
    setNewName('');
    setNewDate('');
    showToast('纪念日已添加 ♡');
  };

  const setReminder = state.annivExtra.length > 0;

  return (
    <SubShell title="设置纪念日" onBack={close}>
      {/* 英雄卡：双头像 + 心形徽标 + 在一起天数 */}
      <div className="relative mt-3 overflow-hidden rounded-3xl bg-[linear-gradient(160deg,#ffffff_0%,#f2f2f5_60%,#e7e7eb_100%)] px-5 pb-5 pt-6 text-center shadow-[0_10px_26px_rgba(0,0,0,0.08)]">
        <div aria-hidden="true" className="pointer-events-none absolute -left-8 -top-10 h-28 w-28 rounded-full bg-white/70" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-6 top-8 h-20 w-20 rounded-full bg-white/50" />
        <div className="relative mx-auto flex w-fit items-center">
          <div className="h-12 w-12 overflow-hidden rounded-full bg-[#ececef] ring-2 ring-white shadow-sm">
            {state.meAvatar ? <img src={state.meAvatar} alt={state.meName} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={48} />}
          </div>
          <div className="relative -ml-2.5 h-12 w-12 overflow-hidden rounded-full bg-[#ececef] ring-2 ring-white shadow-sm">
            {state.taAvatar ? <img src={state.taAvatar} alt={state.taName} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={48} />}
            <span className="absolute -left-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-sm">
              <Heart className="h-2.5 w-2.5 text-[#5c5c64]" fill="#5c5c64" />
            </span>
          </div>
        </div>
        <div className="relative mt-1.5 flex items-center justify-center gap-4 text-[11px] text-[#8e8e96]">
          <span className="max-w-[100px] truncate">{state.meName || '我'}</span>
          <span className="max-w-[100px] truncate">{state.taName || 'TA'}</span>
        </div>
        <div className="relative mt-3 flex items-baseline justify-center gap-1.5 text-[15px] text-[#4a4a52]">
          我们已经在一起
          <span className="text-[30px] font-extrabold leading-none text-[#2c2c30]">{days ?? '--'}</span>
          天
        </div>
        {state.anniversary && <div className="relative mt-1.5 text-[11.5px] text-[#9a9aa2]">起始日期 {fmtDateCn(state.anniversary)}</div>}
      </div>

      {/* 纪念日列表 */}
      <div className="mt-3.5 overflow-hidden rounded-2xl bg-white shadow-sm">
        {/* 我们在一起（主纪念日） */}
        <button
          type="button"
          onClick={() => setEditing({ key: 'love', label: '我们在一起', date: state.anniversary || '' })}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-[#f6f6f8]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3f3f5] text-[#6e6e76]">
            <Heart className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold text-[#2c2c30]">我们在一起</span>
            <span className="mt-0.5 block text-[11.5px] text-[#9a9aa2]">{state.anniversary ? fmtDateCn(state.anniversary) : '点击设置那一天'}</span>
          </span>
          <span className="shrink-0 text-[12px] text-[#8e8e96]">
            {days != null ? (
              <>
                已经 <span className="text-[20px] font-extrabold text-[#3f3f46]">{days}</span> 天
              </>
            ) : (
              <Plus className="h-5 w-5 rounded-full border border-[#d9d9de] p-0.5 text-[#8e8e96]" />
            )}
          </span>
        </button>

        {ANNIV_PRESETS.map((pr) => {
          const date = dateOf(pr.key);
          const extra = extraOf(pr.key);
          return (
            <button
              key={pr.key}
              type="button"
              onClick={() => setEditing({ key: pr.key, label: pr.label, date: date || '' })}
              className="flex w-full items-center gap-3 border-t border-black/[0.04] px-4 py-3 text-left transition-colors active:bg-[#f6f6f8]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3f3f5] text-[#6e6e76]">{pr.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium text-[#2c2c30]">{pr.key === 'myBd' ? `${state.meName || '我'}的生日` : pr.key === 'taBd' ? `${state.taName || 'TA'}的生日` : pr.label}</span>
                <span className="mt-0.5 block text-[11.5px] text-[#9a9aa2]">{date ? fmtDateCn(date) : '点击设置那一天'}</span>
              </span>
              <span className="shrink-0 text-[12px] text-[#8e8e96]">
                {date ? (
                  pr.mode === 'next' ? (
                    <>
                      还有 <span className="text-[20px] font-extrabold text-[#3f3f46]">{daysToNextMonthDay(date) ?? '--'}</span> 天
                    </>
                  ) : (
                    <>
                      已经 <span className="text-[20px] font-extrabold text-[#3f3f46]">{daysSince(date) ?? '--'}</span> 天
                    </>
                  )
                ) : (
                  <Plus className="h-5 w-5 rounded-full border border-[#d9d9de] p-0.5 text-[#8e8e96]" />
                )}
              </span>
              {extra == null && <span className="hidden" />}
            </button>
          );
        })}

        {/* 自建纪念日 */}
        {state.annivExtra
          .filter((e) => !ANNIV_PRESETS.some((p) => p.key === e.key))
          .map((e) => (
            <button
              key={e.key}
              type="button"
              onClick={() => setEditing({ key: e.key, label: e.label, date: e.date })}
              className="flex w-full items-center gap-3 border-t border-black/[0.04] px-4 py-3 text-left transition-colors active:bg-[#f6f6f8]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3f3f5] text-[#6e6e76]">
                <Star className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium text-[#2c2c30]">{e.label}</span>
                <span className="mt-0.5 block text-[11.5px] text-[#9a9aa2]">{fmtDateCn(e.date)}</span>
              </span>
              <span className="shrink-0 text-[12px] text-[#8e8e96]">
                已经 <span className="text-[20px] font-extrabold text-[#3f3f46]">{daysSince(e.date) ?? '--'}</span> 天
              </span>
            </button>
          ))}
      </div>

      {/* 底部：提醒提示 + 添加纪念日 */}
      <div className="mt-4 flex items-center justify-center gap-3">
        <span className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12px] ${setReminder ? 'border-[#d9d9de] bg-white text-[#8e8e96]' : 'border-[#e6e6ea] bg-[#f7f7f9] text-[#9a9aa2]'}`}>
          <Sparkles className="h-3.5 w-3.5" />
          {setReminder ? '纪念日提醒已开启' : '还没设置提醒哦'}
        </span>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-4 py-2 text-[12.5px] font-semibold text-white shadow-[0_6px_16px_rgba(60,60,68,0.28)] transition-transform active:scale-[0.97]"
        >
          <Plus className="h-3.5 w-3.5" /> 添加纪念日
        </button>
      </div>

      {/* 编辑纪念日弹层 */}
      {editing && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-8" onClick={() => setEditing(null)}>
          <div className="w-full rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-semibold text-[#2c2c30]">{editing.label}</div>
            <input
              type="date"
              value={editing.date}
              onChange={(e) => setEditing({ ...editing, date: e.target.value })}
              className="mt-3 h-11 w-full rounded-xl bg-[#f3f3f5] px-3.5 text-[15px] text-[#2c2c30] outline-none"
            />
            <div className="mt-4 flex gap-2.5">
              {editing.key !== 'love' && (
                <button type="button" onClick={removeEdit} className="h-10 rounded-xl bg-[#f0f0f3] px-4 text-[13.5px] font-medium text-[#8e8e96]">
                  删除
                </button>
              )}
              <button type="button" onClick={() => setEditing(null)} className="h-10 flex-1 rounded-xl bg-[#f0f0f3] text-[13.5px] font-medium text-[#5a5a62]">
                取消
              </button>
              <button type="button" onClick={saveEdit} className="h-10 flex-1 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[13.5px] font-semibold text-white">
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加纪念日弹层 */}
      {adding && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-8" onClick={() => setAdding(false)}>
          <div className="w-full rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-semibold text-[#2c2c30]">添加纪念日</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="名称，比如「第一次看演唱会」"
              maxLength={14}
              className="mt-3 h-10 w-full rounded-xl bg-[#f3f3f5] px-3.5 text-[14px] outline-none placeholder:text-[#b6b6bd]"
            />
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="mt-2.5 h-10 w-full rounded-xl bg-[#f3f3f5] px-3.5 text-[14px] text-[#2c2c30] outline-none"
            />
            <div className="mt-4 flex gap-2.5">
              <button type="button" onClick={() => setAdding(false)} className="h-10 flex-1 rounded-xl bg-[#f0f0f3] text-[13.5px] font-medium text-[#5a5a62]">
                取消
              </button>
              <button type="button" onClick={addCustom} className="h-10 flex-1 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[13.5px] font-semibold text-white">
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </SubShell>
  );
}

/** 爱情小树成长记：成长值 0~100，按阈值换阶段 */
function TreePage({ state, waterTree, close }: { state: CoupleState; waterTree: () => void; close: () => void }) {
  const tree = state.tree;
  const stage = tree >= 90 ? 4 : tree >= 60 ? 3 : tree >= 30 ? 2 : tree >= 10 ? 1 : 0;
  const stageInfo = [
    { emoji: '🌰', label: '一颗种子', tip: '每天浇浇水，爱情会发芽' },
    { emoji: '🌱', label: '小芽破土', tip: '它开始听见你们的笑声了' },
    { emoji: '🌿', label: '枝叶舒展', tip: '认真经营的恋爱都会开花' },
    { emoji: '🌳', label: '枝繁叶茂', tip: '为你们撑起一片树荫' },
    { emoji: '🌸🌳', label: '开花的大树', tip: '所有用心都会结果' },
  ][stage];
  return (
    <SubShell title="爱情小树成长记" onBack={close}>
      <div className="mt-3 flex flex-col items-center rounded-2xl bg-white py-8 shadow-sm">
        <div className="text-[60px] leading-none [animation:couple-pop-heart_.6s_ease-out]">{stageInfo.emoji}</div>
        <div className="mt-4 text-[19px] font-bold text-[#2c2c30]">{stageInfo.label}</div>
        <div className="mt-1.5 text-[14px] text-[#8e8e96]">{stageInfo.tip}</div>
        <div className="mt-5 h-2.5 w-[70%] overflow-hidden rounded-full bg-[#efeff2]">
          <div className="h-full rounded-full bg-[linear-gradient(90deg,#9e9ea8,#5c5c64)] transition-all" style={{ width: `${tree}%` }} />
        </div>
        <div className="mt-2 text-[13px] text-[#9a9aa2]">成长值 {tree}/100</div>
        <button
          type="button"
          onClick={waterTree}
          className="mt-6 h-12 rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-12 text-[16px] font-semibold text-white shadow-[0_8px_20px_rgba(60,60,68,0.28)] transition-transform active:scale-[0.97]"
        >
          浇水 💧
        </button>
      </div>
      <p className="mt-4 px-2 text-[13px] leading-relaxed text-[#9a9aa2]">每浇一次水成长值 +2；从种子到开花共 5 个阶段，陪它慢慢长大吧。</p>
    </SubShell>
  );
}

/** 情侣轨迹（参考图4）：全屏地图 + 双人悬浮卡 + 照片标记 + 历史轨迹弹层 */
function TrackPage({ state, patch, days, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; days: number | null; showToast: (m: string) => void; close: () => void }) {
  const [place, setPlace] = useState(state.meetPlace);
  const [sheet, setSheet] = useState(false);

  // 取相册里前两张照片作地图标记
  const markers = state.albums.flatMap((a) => a.photos).slice(0, 2);

  const toolBtn = 'flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#6e6e76] shadow-[0_3px_10px_rgba(0,0,0,0.10)] transition-opacity active:opacity-60';

  return (
    <div className="relative flex h-full flex-col">
      {/* 顶栏 */}
      <div className="shrink-0 bg-[#f6f6f8]/92 pt-[54px] backdrop-blur-md">
        <div className="relative flex h-11 items-center px-1.5">
          <button type="button" onClick={close} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-[#3a3a40] transition-opacity active:opacity-50">
            <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[16px] font-bold">情侣轨迹</div>
        </div>
      </div>

      {/* 全屏地图 */}
      <div className="relative flex-1 overflow-hidden">
        <img src="/couple-map.png" alt="我们的轨迹地图" className="absolute inset-0 h-full w-full object-cover" draggable={false} />

        {/* 顶部悬浮卡：双头像 + 心形天数 + 虚线 */}
        <div className="absolute inset-x-3 top-3 rounded-2xl bg-white/88 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.10)] backdrop-blur-md">
          <div className="flex items-start justify-between">
            <div className="flex w-[86px] flex-col items-center gap-1">
              <span className="flex max-w-full items-center gap-0.5 text-[10px] text-[#8e8e96]">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{state.meetPlace || '相遇的地方'}</span>
              </span>
              <div className="h-12 w-12 overflow-hidden rounded-2xl bg-[#ececef] shadow-[0_0_0_3px_rgba(255,255,255,0.9),0_4px_12px_rgba(0,0,0,0.12)]">
                {state.meAvatar ? <img src={state.meAvatar} alt={state.meName} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={48} />}
              </div>
              <span className="max-w-full truncate text-[10px] text-[#6e6e76]">{state.meName || '我'}</span>
            </div>

            <div className="flex flex-1 flex-col items-center px-1">
              <div className="relative flex h-[70px] w-[76px] items-center justify-center">
                <Heart className="absolute h-[70px] w-[70px] text-[#e9e9ee]" fill="#eceff2" strokeWidth={1.2} />
                <div className="relative -mt-1 text-center">
                  <div className="text-[9px] leading-none text-[#8e8e96]">在一起</div>
                  <div className="text-[17px] font-extrabold leading-tight text-[#4a4a52]">{days ?? '--'}</div>
                  <div className="text-[8px] leading-none tracking-[2px] text-[#a9a9b2]">DAY</div>
                </div>
              </div>
              <div className="relative mt-0.5 h-5 w-full">
                <svg viewBox="0 0 200 20" className="absolute inset-0 h-full w-full" aria-hidden="true">
                  <path d="M8 10 C 50 -4, 150 24, 192 10" fill="none" stroke="#c7c7ce" strokeWidth="2.2" strokeDasharray="5 5" strokeLinecap="round" />
                </svg>
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-white px-2.5 py-[3px] text-[10px] text-[#6e6e76] shadow-sm ring-1 ring-[#e9e9ee]">
                  {days != null ? 'TA 就在你身边' : '设置纪念日开启轨迹'}
                </span>
              </div>
            </div>

            <div className="flex w-[86px] flex-col items-center gap-1">
              <span className="flex max-w-full items-center gap-0.5 text-[10px] text-[#8e8e96]">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{state.meetPlace || '相遇的地方'}</span>
              </span>
              <div className="h-12 w-12 overflow-hidden rounded-2xl bg-[#ececef] shadow-[0_0_0_3px_rgba(255,255,255,0.9),0_4px_12px_rgba(0,0,0,0.12)]">
                {state.taAvatar ? <img src={state.taAvatar} alt={state.taName} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={48} />}
              </div>
              <span className="max-w-full truncate text-[10px] text-[#6e6e76]">{state.taName || 'TA'}</span>
            </div>
          </div>
        </div>

        {/* 地图照片标记 + 虚线连接 */}
        {markers.length >= 2 && (
          <>
            <svg className="pointer-events-none absolute left-[30%] top-[56%] h-24 w-[36%]" viewBox="0 0 120 96" aria-hidden="true">
              <path d="M6 88 L114 8" fill="none" stroke="#b9b9c1" strokeWidth="4" strokeDasharray="10 8" strokeLinecap="round" />
            </svg>
            <div className="absolute left-[30%] top-[62%] h-11 w-11 rotate-[-4deg] overflow-hidden rounded-md bg-white p-0.5 shadow-[0_4px_12px_rgba(0,0,0,0.18)]">
              <img src={markers[0]} alt="轨迹照片1" className="h-full w-full rounded object-cover" draggable={false} />
            </div>
            <div className="absolute left-[56%] top-[42%] h-11 w-11 rotate-[3deg] overflow-hidden rounded-md bg-white p-0.5 shadow-[0_4px_12px_rgba(0,0,0,0.18)]">
              <img src={markers[1]} alt="轨迹照片2" className="h-full w-full rounded object-cover" draggable={false} />
            </div>
          </>
        )}

        {/* 右侧工具按钮（装饰 + 定位回到顶部卡） */}
        <div className="absolute bottom-5 right-3 flex flex-col gap-2">
          <span className={`${toolBtn} text-[#c9a24b]`}>
            <Crown className="h-4 w-4" />
          </span>
          <span className={toolBtn}>
            <HelpCircle className="h-4 w-4" />
          </span>
          <button type="button" onClick={() => setSheet(true)} aria-label="轨迹设置" className={toolBtn}>
            <SettingsIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => showToast(state.meetPlace ? `相遇地点：${state.meetPlace}` : '先在历史轨迹里写下相遇地点吧')}
            aria-label="定位相遇地点"
            className={toolBtn}
          >
            <Crosshair className="h-4 w-4" />
          </button>
        </div>

        {/* 底部历史轨迹按钮 */}
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-6 py-2.5 text-[14px] font-semibold text-white shadow-[0_10px_26px_rgba(60,60,68,0.4)] transition-transform active:scale-[0.97]"
        >
          <MapPin className="h-4 w-4" fill="rgba(255,255,255,0.25)" />
          历史轨迹
        </button>

        <span className="pointer-events-none absolute bottom-1.5 right-2 text-[9px] text-[#b6b6bd]">恋人地图 · 白灰限定</span>
      </div>

      {/* 历史轨迹弹层 */}
      {sheet && (
        <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/35" onClick={() => setSheet(false)}>
          <div className="max-h-[72%] overflow-y-auto rounded-t-3xl bg-white px-5 pb-7 pt-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto h-1 w-10 rounded-full bg-[#e0e0e5]" />
            <div className="mt-3 text-[16px] font-bold text-[#2c2c30]">我们的轨迹</div>
            <div className="mt-1 text-[12px] text-[#9a9aa2]">已经一起走过 {days ?? '--'} 天 · 双向奔赴的路上</div>

            <div className="mt-4 text-[13px] font-semibold text-[#4a4a52]">相遇地点</div>
            <div className="mt-2 flex gap-2">
              <input
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder="比如：学校门口的奶茶店"
                maxLength={20}
                className="h-10 flex-1 rounded-xl bg-[#f3f3f5] px-3.5 text-[14px] outline-none placeholder:text-[#b6b6bd]"
              />
              <button
                type="button"
                onClick={() => {
                  patch({ meetPlace: place.trim() });
                  showToast('相遇地点已记录 ♡');
                }}
                className="h-10 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-4 text-[13.5px] font-semibold text-white"
              >
                保存
              </button>
            </div>

            <div className="mt-5 text-[13px] font-semibold text-[#4a4a52]">走过的大事记</div>
            {state.chronicle.length === 0 ? (
              <div className="py-6 text-center text-[12.5px] text-[#b6b6bd]">还没有记录，去「恋爱编年史」写下第一件小事吧</div>
            ) : (
              <div className="mt-2 space-y-2 pb-2">
                {state.chronicle.slice(0, 10).map((c) => (
                  <div key={c.id} className="flex items-center gap-3 rounded-xl bg-[#f7f7f9] px-3.5 py-2.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#a9a9b2]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] text-[#2c2c30]">{c.text}</span>
                      <span className="text-[11px] text-[#b6b6bd]">{fmtDate(c.at)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 甜蜜小问答：每日一题 + 回答记录 */
function QuizPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const dayIdx = Math.floor(Date.now() / 86400000) % QUIZ_POOL.length;
  const question = QUIZ_POOL[dayIdx];
  const todayHas = state.quiz.some((q) => q.q === question);
  const [answer, setAnswer] = useState('');
  return (
    <SubShell title="甜蜜小问答" onBack={close}>
      <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
        <div className="text-[13px] text-[#9a9aa2]">今天的问题</div>
        <div className="mt-2 text-[17px] font-semibold leading-relaxed text-[#2c2c30]">{question}</div>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="写下你的答案…"
          maxLength={300}
          rows={3}
          className="mt-4 w-full resize-none rounded-xl bg-[#f3f3f5] p-3.5 text-[15px] leading-relaxed outline-none placeholder:text-[#b6b6bd]"
        />
        <button
          type="button"
          onClick={() => {
            const text = answer.trim();
            if (!text) {
              return;
            }
            patch({ quiz: [{ id: uid(), q: question, a: text, at: Date.now() }, ...state.quiz] });
            setAnswer('');
            showToast('答案已记录 ♡');
          }}
          disabled={todayHas}
          className="mt-3 h-12 w-full rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[16px] font-semibold text-white disabled:opacity-40"
        >
          {todayHas ? '今天已回答，明天再来' : '提交答案'}
        </button>
      </div>
      {state.quiz.length > 0 && (
        <>
          <h3 className="px-2 pb-2 pt-6 text-[17px] font-bold">往期问答</h3>
          <div className="max-h-[46vh] space-y-3 overflow-y-auto">
            {state.quiz.map((q) => (
              <div key={q.id} className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-[14px] font-medium leading-snug text-[#4a4a52]">{q.q}</div>
                  <div className="shrink-0 text-[12px] text-[#b6b6bd]">{fmtDate(q.at)}</div>
                </div>
                <div className="mt-2 text-[15px] leading-relaxed text-[#2c2c30]">{q.a}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </SubShell>
  );
}

/** 未来情书：写给未来的信，到期才能拆开 */
function LettersPage({ state, patch, close, showToast }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; close: () => void; showToast: (m: string) => void }) {
  const [text, setText] = useState('');
  const [after, setAfter] = useState(30);
  const now = Date.now();
  const arrived = (l: { at: number; openAfterDays: number }) => now >= l.at + l.openAfterDays * 86400000;
  return (
    <SubShell title="未来情书" onBack={close}>
      <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
        <div className="text-[15px] font-semibold text-[#2c2c30]">写一封信，寄给未来的 TA</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="亲爱的未来的你…"
          maxLength={500}
          rows={4}
          className="mt-3 w-full resize-none rounded-xl bg-[#f3f3f5] p-3.5 text-[15px] leading-relaxed outline-none placeholder:text-[#b6b6bd]"
        />
        <div className="mt-3 flex gap-2">
          {[7, 30, 100].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setAfter(d)}
              className={`h-10 flex-1 rounded-full text-[14px] font-medium transition-colors ${after === d ? 'bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-white' : 'bg-[#f0f0f3] text-[#5a5a62]'}`}
            >
              {d} 天后开启
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            const t = text.trim();
            if (!t) return;
            patch({ letters: [{ id: uid(), text: t, at: Date.now(), openAfterDays: after }, ...state.letters] });
            setText('');
            showToast('情书已封存 ✉️');
          }}
          className="mt-4 h-12 w-full rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[16px] font-semibold text-white"
        >
          封存这封信
        </button>
      </div>

      {state.letters.length > 0 && <h3 className="px-2 pb-2 pt-6 text-[17px] font-bold">信箱</h3>}
      <div className="space-y-3">
        {state.letters.map((l) => {
          const open = arrived(l);
          return (
            <div key={l.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[#9a9aa2]">
                  {fmtDate(l.at)} 寄出 · {l.openAfterDays} 天后开启
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-[12px] ${open ? 'bg-[#3f3f46] text-white' : 'bg-[#f0f0f3] text-[#8e8e96]'}`}>
                  {open ? '可拆信' : '未到时间'}
                </span>
              </div>
              {open ? (
                <div className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-[#2c2c30]">{l.text}</div>
              ) : (
                <div className="mt-2 text-[14px] italic leading-relaxed text-[#b6b6bd]">
                  ✉️ 这封信还在路上，还剩 {Math.max(1, Math.ceil((l.at + l.openAfterDays * 86400000 - now) / 86400000))} 天
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SubShell>
  );
}

/** 情侣小家：温馨度随天数与相册照片数成长 */
function HousePage({ state, days, close }: { state: CoupleState; days: number | null; close: () => void }) {
  const photos = state.albums.reduce((n, a) => n + a.photos.length, 0);
  const warmth = Math.min(100, (days ?? 0) * 2 + photos * 3 + (state.married ? 20 : 0));
  const furnitures = ['🛏️ 双人大床', '🪴 绿植角落', '🍳 小厨房', '📚 书架', '🐱 一只猫', '🪟 飘窗'];
  const unlocked = Math.floor(warmth / 18) + 1;
  return (
    <SubShell title="情侣小家" onBack={close}>
      <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
        { }
        <img src="/couple-house.png" alt="我们的小家" className="h-[190px] w-full object-cover" draggable={false} />
        <div className="px-5 py-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[15px] font-semibold text-[#2c2c30]">温馨度</span>
            <span className="text-[13px] text-[#9a9aa2]">陪伴 {days ?? 0} 天 · 照片 {photos} 张</span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#efeff2]">
            <div className="h-full rounded-full bg-[linear-gradient(90deg,#9e9ea8,#5c5c64)]" style={{ width: `${warmth}%` }} />
          </div>
        </div>
      </div>
      <h3 className="px-2 pb-2 pt-6 text-[17px] font-bold">家具清单（温馨度解锁）</h3>
      <div className="grid grid-cols-2 gap-3">
        {furnitures.map((f, i) => (
          <div key={f} className={`flex h-16 items-center gap-2 rounded-2xl px-4 text-[15px] ${i < unlocked ? 'bg-white font-medium text-[#2c2c30] shadow-sm' : 'bg-[#ececef] text-[#b6b6bd]'}`}>
            {i < unlocked ? f : '🔒 待解锁'}
          </div>
        ))}
      </div>
    </SubShell>
  );
}

/** 心情日记（参考图5）：月历气泡视图 + 写日记编辑页（心情/文字/照片/位置） */
function MoodPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const now0 = new Date();
  const [view, setView] = useState<'cal' | 'write'>('cal');
  const [cursor, setCursor] = useState({ y: now0.getFullYear(), m: now0.getMonth() });
  const [selDate, setSelDate] = useState(todayKey());
  const [mood, setMood] = useState('');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [daySheet, setDaySheet] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);

  /** 按日期分组（兼容旧数据：无 dateKey 时从 at 推导） */
  const byDay = useMemo(() => {
    const map: Record<string, { emoji: string; label: string; id: string }[]> = {};
    for (const m of state.moods) {
      const k = m.dateKey || fmtDate(m.at);
      const meta = MOOD_LIST.find((x) => x.emoji === m.emoji);
      (map[k] ||= []).push({ emoji: m.emoji, label: meta?.label || '心情', id: m.id });
    }
    return map;
  }, [state.moods]);

  /** 月历格子（周一起始） */
  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const lead = (first.getDay() + 6) % 7;
    const total = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const arr: ({ d: number; key: string } | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= total; d++) {
      arr.push({ d, key: `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }
    return arr;
  }, [cursor]);

  const openWrite = (key: string) => {
    if (key > todayKey()) {
      showToast('不能写未来的日子哦');
      return;
    }
    setSelDate(key);
    setMood('');
    setText('');
    setPhoto(null);
    setView('write');
  };

  const pickPhoto = async (f: File | null) => {
    if (!f) return;
    try {
      setPhoto(await fileToScaledDataURL(f, 900, 0.72));
    } catch {
      showToast('图片处理失败');
    }
  };

  const saveMood = () => {
    if (!mood) {
      showToast('先选一个心情吧');
      return;
    }
    const d = new Date(`${selDate}T12:00:00`);
    patch({
      moods: [{ id: uid(), emoji: mood, text: text.trim(), at: d.getTime(), photo, dateKey: selDate }, ...state.moods],
    });
    showToast('心情已记录 ♡');
    setView('cal');
  };

  const editEntry = (key: string) => {
    const list = byDay[key] || [];
    const entry = state.moods.find((m) => (m.dateKey || fmtDate(m.at)) === key);
    if (entry) {
      setSelDate(key);
      setMood(entry.emoji);
      setText(entry.text);
      setPhoto(entry.photo ?? null);
      setView('write');
    } else {
      void list;
      openWrite(key);
    }
    setDaySheet(null);
  };

  // ---------- 写日记视图 ----------
  if (view === 'write') {
    const [sy, sm] = [Number(selDate.slice(0, 4)), Number(selDate.slice(5, 7))];
    const isToday = selDate === todayKey();
    return (
      <SubShell title="心情日记" onBack={() => setView('cal')}>
        <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-baseline gap-2">
            <span className="text-[20px] font-bold text-[#2c2c30]">{isToday ? '今天' : selDate}</span>
            <span className="text-[12px] text-[#9a9aa2]">{sm}月,{sy}</span>
          </div>

          {/* 当前选中心情大表情 */}
          <div className="mt-3 flex justify-center">
            <span className={`flex h-[64px] w-[64px] items-center justify-center rounded-full bg-[#f3f3f5] text-[34px] shadow-inner ${mood ? '' : 'opacity-50'}`}>
              {mood || '🫥'}
            </span>
          </div>

          {/* 心情选择圈 */}
          <div className="mt-4 grid grid-cols-4 gap-2">
            {MOOD_LIST.map((m) => (
              <button
                key={m.label}
                type="button"
                onClick={() => setMood(m.emoji)}
                className={`flex flex-col items-center gap-1 rounded-2xl py-2 transition-colors ${mood === m.emoji ? 'bg-[#ececF0]' : 'active:bg-[#f6f6f8]'}`}
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-full text-[19px] shadow-sm ${mood === m.emoji ? 'bg-white ring-2 ring-[#5c5c64]' : 'bg-[#f3f3f5]'}`}>{m.emoji}</span>
                <span className="text-[10px] text-[#8e8e96]">{m.label}</span>
              </button>
            ))}
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="今天想写些什么"
            maxLength={300}
            rows={4}
            className="mt-4 w-full resize-none rounded-xl bg-[#f8f8fa] p-3.5 text-[14.5px] leading-relaxed outline-none placeholder:text-[#b6b6bd]"
          />

          {/* 照片 tile */}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => (photo ? setPhoto(null) : photoInput.current?.click())}
              className="relative flex h-[84px] w-[84px] items-center justify-center overflow-hidden rounded-xl bg-[#f3f3f5] text-[#b6b6bd] transition-opacity active:opacity-70"
              aria-label={photo ? '移除照片' : '添加照片'}
            >
              {photo ? (
                <>
                  <img src={photo} alt="心情照片" className="h-full w-full object-cover" draggable={false} />
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/45 text-white">
                    ✕
                  </span>
                </>
              ) : (
                <ImagePlus className="h-6 w-6" strokeWidth={1.6} />
              )}
            </button>
            <span className="text-[11.5px] leading-relaxed text-[#b6b6bd]">{photo ? '点击照片可移除' : '配一张今天的照片吧'}</span>
          </div>

          {/* 位置行 */}
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#f8f8fa] px-3.5 py-2.5">
            <MapPin className="h-4 w-4 shrink-0 text-[#8e8e96]" />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-[#4a4a52]">{state.meetPlace || '还没有相遇地点'}</span>
            <span className="text-[11px] text-[#c2c2c9]">{state.meetPlace ? '来自情侣轨迹' : '去情侣轨迹设置'}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={saveMood}
          className="mb-4 mt-5 h-12 w-full rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(60,60,68,0.28)] transition-transform active:scale-[0.98]"
        >
          完成
        </button>

        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void pickPhoto(e.target.files?.[0] ?? null);
            e.currentTarget.value = '';
          }}
        />
      </SubShell>
    );
  }

  // ---------- 月历视图 ----------
  const todayK = todayKey();
  const recent = state.moods.slice(0, 4);

  return (
    <SubShell
      title="心情日记"
      onBack={close}
      right={
        recent.length > 0 ? (
          <span className="text-[11.5px] text-[#8e8e96]">共 {state.moods.length} 篇</span>
        ) : undefined
      }
    >
      {/* 月份切换 */}
      <div className="mt-2 flex items-center justify-center gap-4">
        <button
          type="button"
          aria-label="上个月"
          onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { ...c, m: c.m - 1 }))}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e9e9ee] text-[#6e6e76] transition-opacity active:opacity-60"
        >
          <ChevronRight className="h-4 w-4 rotate-180" />
        </button>
        <span className="text-[17px] font-bold text-[#2c2c30]">
          {cursor.y}.{String(cursor.m + 1).padStart(2, '0')}
        </span>
        <button
          type="button"
          aria-label="下个月"
          onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 }))}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e9e9ee] text-[#6e6e76] transition-opacity active:opacity-60"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* 星期表头（周一起始） */}
      <div className="mt-3 grid grid-cols-7 text-center text-[10.5px] text-[#a9a9b2]">
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      {/* 日期格子 */}
      <div className="mt-1.5 grid grid-cols-7 gap-y-1">
        {cells.map((cell, i) =>
          cell == null ? (
            <span key={`b${i}`} />
          ) : (
            <button
              key={cell.key}
              type="button"
              onClick={() => {
                const list = byDay[cell.key];
                if (list && list.length > 0) setDaySheet(cell.key);
                else openWrite(cell.key);
              }}
              className="flex h-[62px] flex-col items-center justify-start pt-1 transition-transform active:scale-[0.94]"
            >
              <span className={`text-[10.5px] leading-none ${cell.key === todayK ? 'font-bold text-[#2c2c30]' : 'text-[#6e6e76]'}`}>{cell.d}</span>
              {byDay[cell.key] ? (
                <span className={`mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-white text-[17px] shadow-[0_2px_8px_rgba(0,0,0,0.10)] ${cell.key === todayK ? 'ring-2 ring-[#5c5c64]' : 'ring-1 ring-[#ececef]'}`}>
                  {byDay[cell.key][byDay[cell.key].length - 1].emoji}
                </span>
              ) : (
                <span className={`mt-1 h-8 w-8 rounded-full border border-dashed ${cell.key === todayK ? 'border-[#b9b9c1] bg-white/70' : 'border-[#e4e4e9]'}`} />
              )}
              {cell.key === todayK && <span className="mt-0.5 text-[8.5px] leading-none text-[#8e8e96]">今天</span>}
            </button>
          ),
        )}
      </div>

      <div className="mt-1 text-center text-[14px] font-medium text-[#4a4a52]">Hi，你今天的心情怎么样？</div>

      {/* 浮动写日记按钮 */}
      <button
        type="button"
        onClick={() => openWrite(todayKey())}
        className="fixed bottom-16 right-5 z-20 flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(60,60,68,0.4)] transition-transform active:scale-[0.96]"
      >
        <Pencil className="h-3.5 w-3.5" />
        写日记
      </button>

      {/* 最近的心情 */}
      {recent.length > 0 && (
        <>
          <h3 className="pb-2 pt-5 text-[14px] font-bold text-[#2c2c30]">最近的心情</h3>
          <div className="space-y-2">
            {recent.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setDaySheet(m.dateKey || fmtDate(m.at))}
                className="flex w-full items-start gap-3 rounded-2xl bg-white p-3 text-left shadow-sm"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f3f3f5] text-[18px]">{m.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] leading-relaxed text-[#2c2c30]">{m.text || '（没说话，就是心情不好不坏）'}</span>
                  <span className="mt-0.5 block text-[11px] text-[#b6b6bd]">{m.dateKey || fmtDate(m.at)}</span>
                </span>
                {m.photo && <img src={m.photo} alt="心情照片" className="h-11 w-11 shrink-0 rounded-lg object-cover" draggable={false} />}
              </button>
            ))}
          </div>
        </>
      )}

      {/* 某天的心情弹层 */}
      {daySheet && (
        <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/35" onClick={() => setDaySheet(null)}>
          <div className="max-h-[64%] overflow-y-auto rounded-t-3xl bg-white px-5 pb-7 pt-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto h-1 w-10 rounded-full bg-[#e0e0e5]" />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[15px] font-bold text-[#2c2c30]">{daySheet === todayK ? '今天的心情' : daySheet}</span>
              <button
                type="button"
                onClick={() => {
                  editEntry(daySheet);
                }}
                className="rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-3.5 py-1.5 text-[11.5px] font-semibold text-white"
              >
                {byDay[daySheet] ? '再写一篇' : '写这篇'}
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {(byDay[daySheet] || []).length === 0 && <div className="py-4 text-center text-[13px] text-[#b6b6bd]">这一天还没有记录</div>}
              {state.moods
                .filter((m) => (m.dateKey || fmtDate(m.at)) === daySheet)
                .map((m) => (
                  <div key={m.id} className="flex items-start gap-3 rounded-2xl bg-[#f7f7f9] p-3.5">
                    <span className="text-[22px]">{m.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] leading-relaxed text-[#2c2c30]">{m.text || '（没说话，就是心情不好不坏）'}</div>
                      {m.photo && <img src={m.photo} alt="心情照片" className="mt-2 max-h-40 w-full rounded-xl object-cover" draggable={false} />}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </SubShell>
  );
}

/** 爱情塔罗：从牌堆抽一张 */
function TarotPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const [drawn, setDrawn] = useState<number | null>(null);
  const [drawing, setDrawing] = useState(false);
  const draw = () => {
    if (drawing) return;
    setDrawing(true);
    setDrawn(null);
    setTimeout(() => {
      const idx = Math.floor(Math.random() * TAROT_DECK.length);
      setDrawn(idx);
      setDrawing(false);
      patch({ tarotHistory: [{ id: uid(), name: TAROT_DECK[idx].name, at: Date.now() }] } as Partial<CoupleState>);
      showToast(`抽到了「${TAROT_DECK[idx].name}」`);
    }, 900);
  };
  return (
    <SubShell title="爱情塔罗" onBack={close}>
      <div className="mt-4 rounded-2xl bg-white p-6 text-center shadow-sm">
        <div className="text-[15px] text-[#8e8e96]">深呼吸，心里想着 TA，然后抽一张牌</div>
        <div className="mx-auto mt-5 flex h-[180px] w-[124px] items-center justify-center rounded-2xl border-[3px] border-[#e2e2e7] bg-[linear-gradient(160deg,#f7f7f9,#e8e8ec)] shadow-inner">
          {drawn != null ? (
            <div className="px-2">
              <div className="text-[34px]">🃏</div>
              <div className="mt-1 text-[16px] font-bold text-[#2c2c30]">{TAROT_DECK[drawn].name}</div>
            </div>
          ) : (
            <div className="text-[13px] leading-relaxed text-[#9a9aa2]">
              {drawing ? <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#8e8e97]" /> : '命运\n之牌'}
            </div>
          )}
        </div>
        {drawn != null && <div className="mt-4 text-[15px] leading-relaxed text-[#4a4a52]">{TAROT_DECK[drawn].meaning}</div>}
        <button
          type="button"
          onClick={draw}
          disabled={drawing}
          className="mt-6 h-12 rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-12 text-[16px] font-semibold text-white disabled:opacity-50"
        >
          {drawn != null ? '再抽一次' : '抽取塔罗牌'}
        </button>
        {state.tarotHistory && state.tarotHistory.length > 0 && (
          <div className="mt-4 text-[13px] text-[#b6b6bd]">上次抽到：{state.tarotHistory[0].name}</div>
        )}
      </div>
    </SubShell>
  );
}

/** 100 件小事清单 */
function HundredPage({ state, patch, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; close: () => void }) {
  const done = state.hundred.length;
  const toggle = (i: number) => {
    const has = state.hundred.includes(i);
    patch({ hundred: has ? state.hundred.filter((x) => x !== i) : [...state.hundred, i] });
  };
  return (
    <SubShell title="100件小事" onBack={close} right={<span className="text-[14px] font-semibold text-[#5a5a62]">{done}/100</span>}>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#e9e9ed]">
        <div className="h-full rounded-full bg-[linear-gradient(90deg,#9e9ea8,#5c5c64)] transition-all" style={{ width: `${done}%` }} />
      </div>
      <div className="mt-4 space-y-1">
        {HUNDRED_LIST.map((item, i) => {
          const checked = state.hundred.includes(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors ${checked ? 'bg-white' : 'active:bg-white/60'}`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${checked ? 'border-[#3f3f46] bg-[#3f3f46] text-white' : 'border-[#c9c9cf]'}`}>
                {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
              <span className={`text-[15px] ${checked ? 'text-[#9a9aa2] line-through' : 'text-[#3c3c42]'}`}>
                <span className="mr-1.5 text-[12px] text-[#b6b6bd]">{String(i + 1).padStart(2, '0')}</span>
                {item}
              </span>
            </button>
          );
        })}
      </div>
    </SubShell>
  );
}

/** 恋爱协议 */
function PactPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const signed = state.pactAt != null;
  return (
    <SubShell title="恋爱协议" onBack={close}>
      <div className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
        <div className="text-center text-[20px] font-bold tracking-[6px] text-[#2c2c30]">恋 爱 协 议</div>
        <div className="mt-1 text-center text-[12px] text-[#b6b6bd]">COUPLE AGREEMENT</div>
        <div className="mt-5 space-y-3 rounded-xl bg-[#f7f7f9] p-4 text-[14px] leading-relaxed text-[#4a4a52]">
          <p>第一条：吵架不过夜，谁的错谁先哄，哄不好就抱一下再哄。</p>
          <p>第二条：忙碌时提前报备，不让对方对着「正在输入」发呆。</p>
          <p>第三条：纪念日、生日、在一起的每一天都要认真对待。</p>
          <p>第四条：开心的事第一时间分享，难过的事一起扛。</p>
          <p>第五条：永远不说分手，把「我们」放在第一位。</p>
        </div>
        <div className="mt-5 flex items-center justify-between text-[15px]">
          <div>
            <div className="text-[12px] text-[#9a9aa2]">甲方</div>
            <div className="font-semibold text-[#2c2c30]">{state.meName || '我'}</div>
          </div>
          <Heart className="h-5 w-5 text-[#a9a9b2]" fill="#d9d9de" />
          <div className="text-right">
            <div className="text-[12px] text-[#9a9aa2]">乙方</div>
            <div className="font-semibold text-[#2c2c30]">{state.taName || 'TA'}</div>
          </div>
        </div>
        <button
          type="button"
          disabled={signed}
          onClick={() => {
            patch({ pactAt: Date.now() });
            showToast('协议签署成功，好好爱 ♡');
          }}
          className="mt-5 h-12 w-full rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[16px] font-semibold text-white disabled:opacity-40"
        >
          {signed ? `已于 ${fmtDate(state.pactAt as number)} 签署` : '签署协议'}
        </button>
      </div>
    </SubShell>
  );
}

/** 恋爱水平考试 */
function ExamPage({ state, patch, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; close: () => void }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [score, setScore] = useState<number | null>(null);
  const answeredAll = EXAM_QUESTIONS.every((_, i) => answers[i] != null);
  const submit = () => {
    const s = EXAM_QUESTIONS.reduce((n, q, i) => n + (answers[i] === q.best ? 100 / EXAM_QUESTIONS.length : 0), 0);
    const rounded = Math.round(s);
    setScore(rounded);
    if (state.examBest == null || rounded > state.examBest) patch({ examBest: rounded });
  };
  const title = score == null ? '' : score >= 90 ? '满分恋人 🏆' : score >= 60 ? '合格恋人 💯' : '需要补课的恋人 📚';
  return (
    <SubShell title="恋爱水平考试" onBack={close} right={state.examBest != null ? <span className="text-[13px] text-[#9a9aa2]">最高 {state.examBest} 分</span> : undefined}>
      <div className="mt-4 space-y-3">
        {EXAM_QUESTIONS.map((q, qi) => (
          <div key={qi} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="text-[15px] font-semibold text-[#2c2c30]">
              {qi + 1}. {q.q}
            </div>
            <div className="mt-3 space-y-2">
              {q.opts.map((o, oi) => {
                const picked = answers[qi] === oi;
                const showRight = score != null && oi === q.best;
                const showWrong = score != null && picked && oi !== q.best;
                return (
                  <button
                    key={oi}
                    type="button"
                    onClick={() => score == null && setAnswers((a) => ({ ...a, [qi]: oi }))}
                    className={`flex h-11 w-full items-center rounded-xl px-3.5 text-left text-[14.5px] transition-colors ${
                      showRight
                        ? 'bg-[#3f3f46] font-medium text-white'
                        : showWrong
                          ? 'bg-[#ececef] text-[#b6b6bd] line-through'
                          : picked
                            ? 'bg-[#e9e9ed] font-medium text-[#2c2c30]'
                            : 'bg-[#f3f3f5] text-[#4a4a52]'
                    }`}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {score != null ? (
        <div className="mt-4 rounded-2xl bg-white p-5 text-center shadow-sm">
          <div className="text-[28px] font-bold text-[#2c2c30]">{score} 分</div>
          <div className="mt-1 text-[16px] text-[#5a5a62]">{title}</div>
          <button
            type="button"
            onClick={() => {
              setScore(null);
              setAnswers({});
            }}
            className="mt-4 h-11 w-full rounded-full bg-[#f0f0f3] text-[15px] font-medium text-[#5a5a62]"
          >
            <RefreshCcw className="mr-1.5 inline h-4 w-4" />
            重考一次
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!answeredAll}
          className="mt-5 h-12 w-full rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[16px] font-semibold text-white disabled:opacity-40"
        >
          {answeredAll ? '交卷' : `还剩 ${EXAM_QUESTIONS.length - Object.keys(answers).length} 题未答`}
        </button>
      )}
    </SubShell>
  );
}

/** 星座缘分 */
function ZodiacPage({ state, patch, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; close: () => void }) {
  const [me, setMe] = useState(state.zodiac?.me || '');
  const [ta, setTa] = useState(state.zodiac?.ta || '');
  const [result, setResult] = useState<{ score: number; text: string } | null>(
    state.zodiac ? { score: zodiacScore(state.zodiac.me, state.zodiac.ta), text: '' } : null,
  );
  const calc = () => {
    if (!me || !ta) return;
    const s = zodiacScore(me, ta);
    const text = s >= 85 ? '天生一对，磁场完美契合！' : s >= 75 ? '互补吸引，越处越甜的一对。' : '需要一点磨合，但爱能跨越一切。';
    setResult({ score: s, text });
    patch({ zodiac: { me, ta } });
  };
  return (
    <SubShell title="星座缘分" onBack={close}>
      <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: '我的星座', v: me, set: setMe },
            { label: 'TA 的星座', v: ta, set: setTa },
          ].map((f) => (
            <div key={f.label}>
              <div className="mb-1.5 text-[13px] text-[#9a9aa2]">{f.label}</div>
              <select
                value={f.v}
                onChange={(e) => f.set(e.target.value)}
                className="h-11 w-full rounded-xl bg-[#f3f3f5] px-3 text-[15px] text-[#2c2c30] outline-none"
              >
                <option value="">请选择</option>
                {ZODIAC_LIST.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={calc}
          disabled={!me || !ta}
          className="mt-5 h-12 w-full rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[16px] font-semibold text-white disabled:opacity-40"
        >
          查看缘分指数
        </button>
        {result && (
          <div className="mt-5 text-center">
            <div className="text-[34px] font-bold text-[#2c2c30]">{result.score}</div>
            <div className="mt-1 text-[15px] leading-relaxed text-[#5a5a62]">
              {me} ♡ {ta}
              <br />
              {result.text}
            </div>
          </div>
        )}
      </div>
    </SubShell>
  );
}

/** 恋爱编年史：时间线 + 添加大事记 */
function ChroniclePage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const [text, setText] = useState('');
  return (
    <SubShell title="恋爱编年史" onBack={close}>
      <div className="mt-4 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="记录一件值得记住的小事…"
          maxLength={40}
          className="h-11 flex-1 rounded-xl bg-white px-3.5 text-[15px] shadow-sm outline-none placeholder:text-[#b6b6bd]"
        />
        <button
          type="button"
          onClick={() => {
            const t = text.trim();
            if (!t) return;
            patch({ chronicle: [{ id: uid(), text: t, at: Date.now() }, ...state.chronicle] });
            setText('');
            showToast('已写入编年史 ✍️');
          }}
          className="h-11 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-5 text-[15px] font-semibold text-white"
        >
          记录
        </button>
      </div>
      {state.chronicle.length === 0 ? (
        <div className="mt-16 text-center text-[14px] text-[#b6b6bd]">时间线还是空的，从今天开始记录吧</div>
      ) : (
        <div className="mt-5 space-y-0">
          {state.chronicle.map((c, i) => (
            <div key={c.id} className="relative flex gap-4 pb-6">
              {/* 时间线竖线与节点 */}
              {i < state.chronicle.length - 1 && <span aria-hidden="true" className="absolute left-[7px] top-5 h-full w-[2px] bg-[#e3e3e8]" />}
              <span className="relative z-10 mt-1.5 h-4 w-4 shrink-0 rounded-full border-[3px] border-[#8e8e97] bg-white" />
              <div className="flex-1 rounded-2xl bg-white p-4 shadow-sm">
                <div className="text-[13px] text-[#9a9aa2]">{fmtDate(c.at)}</div>
                <div className="mt-1 text-[15px] leading-relaxed text-[#2c2c30]">{c.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SubShell>
  );
}

/** 三生石 */
function StonePage({ state, days, close }: { state: CoupleState; days: number | null; close: () => void }) {
  return (
    <SubShell title="三生石" onBack={close}>
      <div className="mt-6 flex flex-col items-center">
        {/* 石头造型 */}
        <div className="relative flex h-[188px] w-[188px] items-center justify-center rounded-[46%_54%_52%_48%/54%_46%_54%_46%] bg-[linear-gradient(150deg,#d8d8dd,#aeaeb8_60%,#9898a2)] shadow-[0_18px_40px_rgba(80,80,92,0.35)]">
          <div className="text-center">
            <div className="text-[22px] font-bold tracking-[3px] text-[#4a4a52]">{state.meName || '我'}</div>
            <div className="my-1 text-[13px] text-[#6e6e78]">♥ 三生三世 ♥</div>
            <div className="text-[22px] font-bold tracking-[3px] text-[#4a4a52]">{state.taName || 'TA'}</div>
          </div>
          <span aria-hidden="true" className="absolute left-8 top-10 h-8 w-12 rounded-full bg-white/35 blur-[6px]" />
        </div>
        <p className="mt-8 max-w-[280px] text-center text-[15px] leading-loose text-[#6e6e76]">
          传说三生石刻着有缘人的名字。
          <br />
          第一生相遇，第二生相知，
          <br />
          第三生相守——此刻正是第 {days == null ? '一' : '三'}生，
          <br />
          你们已并肩走过 {days ?? 0} 天。
        </p>
      </div>
    </SubShell>
  );
}

/** 回复挑战 */
function ReplyPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * REPLY_PROMPTS.length));
  const [text, setText] = useState('');
  return (
    <SubShell title="回复挑战" onBack={close}>
      <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
        <div className="text-[13px] text-[#9a9aa2]">如果 TA 这样说——</div>
        <div className="mt-2 rounded-xl bg-[#f7f7f9] p-4 text-[16px] font-medium leading-relaxed text-[#2c2c30]">{REPLY_PROMPTS[idx]}</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="写出你的高情商回复…"
          maxLength={120}
          rows={2}
          className="mt-3 w-full resize-none rounded-xl bg-[#f3f3f5] p-3.5 text-[15px] outline-none placeholder:text-[#b6b6bd]"
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              const t = text.trim();
              if (!t) {
                showToast('先写下你的回复吧');
                return;
              }
              patch({ replies: [{ id: uid(), prompt: REPLY_PROMPTS[idx], reply: t, at: Date.now() }, ...state.replies] });
              setText('');
              showToast('回复已收录 ♡');
            }}
            className="h-12 flex-1 rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[16px] font-semibold text-white"
          >
            提交回复
          </button>
          <button type="button" onClick={() => setIdx((i) => (i + 1) % REPLY_PROMPTS.length)} className="h-12 rounded-full bg-[#f0f0f3] px-5 text-[15px] font-medium text-[#5a5a62]">
            换一题
          </button>
        </div>
      </div>
      {state.replies.length > 0 && (
        <>
          <h3 className="px-2 pb-2 pt-6 text-[17px] font-bold">我的高情商回复</h3>
          <div className="space-y-3">
            {state.replies.map((r) => (
              <div key={r.id} className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="text-[13px] text-[#9a9aa2]">{r.prompt}</div>
                <div className="mt-1.5 text-[15px] leading-relaxed text-[#2c2c30]">{r.reply}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </SubShell>
  );
}

/** 情侣酒店（玩梗预约卡） */
function HotelPage({ showToast, close }: { showToast: (m: string) => void; close: () => void }) {
  const [booked, setBooked] = useState<string | null>(null);
  return (
    <SubShell title="情侣酒店" onBack={close}>
      <p className="mt-4 px-2 text-[13px] text-[#9a9aa2]">纸短情长，先预约一场说走就走的甜蜜（纯属虚构，记得带 TA 真正去一次）。</p>
      <div className="mt-3 space-y-3">
        {HOTEL_ROOMS.map((r) => (
          <div key={r.name} className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm">
            <div>
              <div className="text-[16px] font-semibold text-[#2c2c30]">{r.name}</div>
              <div className="mt-0.5 text-[13px] text-[#9a9aa2]">{r.desc}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                setBooked(r.name);
                showToast(`已预约「${r.name}」♡`);
              }}
              className={`h-10 shrink-0 rounded-full px-5 text-[14px] font-semibold ${booked === r.name ? 'bg-[#3f3f46] text-white' : 'bg-[#f0f0f3] text-[#4a4a52]'}`}
            >
              {booked === r.name ? '已预约' : '预约'}
            </button>
          </div>
        ))}
      </div>
    </SubShell>
  );
}

/** 恋爱状态 */
function StatusPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  return (
    <SubShell title="恋爱状态" onBack={close}>
      <div className="mt-4 space-y-3">
        {STATUS_LIST.map((s) => {
          const picked = state.status === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => {
                patch({ status: s });
                showToast(`状态已更新为「${s}」`);
              }}
              className={`flex h-14 w-full items-center justify-between rounded-2xl px-5 text-[16px] font-medium transition-colors ${picked ? 'bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-white' : 'bg-white text-[#3c3c42] shadow-sm'}`}
            >
              {s}
              {picked && <Check className="h-5 w-5" strokeWidth={2.4} />}
            </button>
          );
        })}
      </div>
    </SubShell>
  );
}

/** 情侣印象：互相贴标签 */
function ImpressPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const [tagMe, setTagMe] = useState('');
  const [tagTa, setTagTa] = useState('');
  const section = (title: string, tags: string[], onAdd: () => void, input: string, setInput: (v: string) => void, onRemove: (t: string) => void) => (
    <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-[16px] font-semibold text-[#2c2c30]">{title}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {tags.length === 0 && <span className="text-[13.5px] text-[#b6b6bd]">还没有标签，来贴第一张吧</span>}
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-[#f0f0f3] px-3.5 py-1.5 text-[14px] text-[#3c3c42]">
            {t}
            <button type="button" onClick={() => onRemove(t)} aria-label={`删除标签${t}`} className="text-[#b6b6bd]">
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="加一个标签，比如「睡觉不老实」"
          maxLength={10}
          className="h-11 flex-1 rounded-xl bg-[#f3f3f5] px-3.5 text-[15px] outline-none placeholder:text-[#b6b6bd]"
        />
        <button type="button" onClick={onAdd} className="h-11 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-5 text-[15px] font-semibold text-white">
          添加
        </button>
      </div>
    </div>
  );
  return (
    <SubShell title="情侣印象" onBack={close}>
      {section(
        `TA 眼中的你（${state.impressionsMe.length}）`,
        state.impressionsMe,
        () => {
          const t = tagMe.trim();
          if (!t) return;
          if (state.impressionsMe.includes(t)) {
            showToast('这个标签已经有了');
            return;
          }
          patch({ impressionsMe: [...state.impressionsMe, t] });
          setTagMe('');
          showToast('标签已贴上 ♡');
        },
        tagMe,
        setTagMe,
        (t) => patch({ impressionsMe: state.impressionsMe.filter((x) => x !== t) }),
      )}
      {section(
        `你眼中的 TA（${state.impressionsTa.length}）`,
        state.impressionsTa,
        () => {
          const t = tagTa.trim();
          if (!t) return;
          if (state.impressionsTa.includes(t)) {
            showToast('这个标签已经有了');
            return;
          }
          patch({ impressionsTa: [...state.impressionsTa, t] });
          setTagTa('');
          showToast('标签已贴上 ♡');
        },
        tagTa,
        setTagTa,
        (t) => patch({ impressionsTa: state.impressionsTa.filter((x) => x !== t) }),
      )}
    </SubShell>
  );
}

/** 恋爱资料（参考图2）：iOS 分组列表（头像/昵称/性别/情侣号/恋人证书/登录记录/解除关系 + 对方） */
function ProfilePage({ state, patch, showToast, close, onReset }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void; onReset: () => void }) {
  const meInput = useRef<HTMLInputElement | null>(null);
  const taInput = useRef<HTMLInputElement | null>(null);
  const [dialog, setDialog] = useState<null | 'nickname' | 'gender' | 'cert' | 'logins' | 'ta' | 'signature' | 'reset'>(null);
  const [nickDraft, setNickDraft] = useState('');
  const [taNameDraft, setTaNameDraft] = useState('');
  const [sigDraft, setSigDraft] = useState('');

  const pickAvatar = async (f: File | null, side: 'me' | 'ta') => {
    if (!f) return;
    try {
      const url = await fileToScaledDataURL(f, 360, 0.85);
      patch(side === 'me' ? { meAvatar: url } : { taAvatar: url });
      showToast('头像已更新 ♡');
    } catch {
      showToast('图片处理失败');
    }
  };

  const copyNo = async () => {
    try {
      await navigator.clipboard.writeText(state.coupleNo || '');
      showToast('情侣号已复制 ♡');
    } catch {
      showToast('复制失败，长按手动复制');
    }
  };

  const rowCls = 'flex min-h-[50px] w-full items-center gap-3 px-4 py-2 text-left transition-colors active:bg-[#f6f6f8]';
  const labelCls = 'min-w-0 flex-1 text-[14.5px] text-[#2c2c30]';
  const valCls = 'max-w-[170px] truncate text-[13px] text-[#a9a9b2]';
  const chev = <ChevronRight className="h-4 w-4 shrink-0 text-[#c6c6cd]" />;

  return (
    <SubShell title="我的恋爱资料" onBack={close}>
      {/* 第一组：我的资料 */}
      <div className="mt-3 overflow-hidden rounded-2xl bg-white shadow-sm">
        <button type="button" onClick={() => meInput.current?.click()} className={rowCls}>
          <span className={labelCls}>头像</span>
          <span className="ml-auto mr-1 h-9 w-9 overflow-hidden rounded-full bg-[#ececef]">
            {state.meAvatar ? <img src={state.meAvatar} alt="我的头像" className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={36} />}
          </span>
          {chev}
        </button>
        <button
          type="button"
          onClick={() => {
            setNickDraft(state.meName);
            setDialog('nickname');
          }}
          className={`${rowCls} border-t border-black/[0.04]`}
        >
          <span className={labelCls}>昵称</span>
          <span className={valCls}>{state.meName || '未设置'}</span>
          {chev}
        </button>
        <button
          type="button"
          onClick={() => setDialog('gender')}
          className={`${rowCls} border-t border-black/[0.04]`}
        >
          <span className={labelCls}>性别</span>
          <span className={valCls}>{state.gender || '未设置'}</span>
          {chev}
        </button>
        <button type="button" onClick={copyNo} className={`${rowCls} border-t border-black/[0.04]`}>
          <span className={labelCls}>情侣号</span>
          <span className={`${valCls} font-medium tracking-wide text-[#6e6e76]`}>{state.coupleNo || '--'}</span>
          {chev}
        </button>
        <button type="button" onClick={() => setDialog('cert')} className={`${rowCls} border-t border-black/[0.04]`}>
          <span className={labelCls}>恋人证书</span>
          {chev}
        </button>
        <button type="button" onClick={() => setDialog('logins')} className={`${rowCls} border-t border-black/[0.04]`}>
          <span className={labelCls}>登录记录</span>
          {chev}
        </button>
        <button
          type="button"
          onClick={() => setDialog('reset')}
          className={`${rowCls} border-t border-black/[0.04] text-[#8e8e96]`}
        >
          <span className="flex items-center gap-1.5 text-[14.5px]">
            解除关系 <span aria-hidden="true" className="[filter:grayscale(1)_opacity(0.75)]">💔</span>
          </span>
          {chev}
        </button>
      </div>

      {/* 第二组：对方 */}
      <div className="mt-3.5 overflow-hidden rounded-2xl bg-white shadow-sm">
        <button
          type="button"
          onClick={() => {
            setTaNameDraft(state.taName);
            setDialog('ta');
          }}
          className={rowCls}
        >
          <span className={labelCls}>对方</span>
          <span className="flex shrink-0 items-center gap-2.5">
            <span className="text-[13px] text-[#a9a9b2]">{state.taName || '未设置'}</span>
            <span className="h-9 w-9 overflow-hidden rounded-full bg-[#ececef]">
              {state.taAvatar ? <img src={state.taAvatar} alt="对方头像" className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={36} />}
            </span>
          </span>
          {chev}
        </button>
      </div>

      {/* 第三组：签名 */}
      <div className="mt-3.5 overflow-hidden rounded-2xl bg-white shadow-sm">
        <button
          type="button"
          onClick={() => {
            setSigDraft(state.signature);
            setDialog('signature');
          }}
          className={rowCls}
        >
          <span className={labelCls}>我们的签名</span>
          <span className={valCls}>{state.signature || '写一句属于你们的话'}</span>
          {chev}
        </button>
      </div>

      <p className="mt-4 px-2 text-[12px] leading-relaxed text-[#b6b6bd]">情侣号是你们的小家门牌号，头像、昵称、性别都可以随时修改。</p>

      {/* 隐藏文件选择（我 / 对方头像） */}
      <input
        ref={meInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pickAvatar(e.target.files?.[0] ?? null, 'me');
          e.currentTarget.value = '';
        }}
      />
      <input
        ref={taInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pickAvatar(e.target.files?.[0] ?? null, 'ta');
          e.currentTarget.value = '';
        }}
      />

      {/* 弹层们 */}
      {dialog != null && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-8" onClick={() => setDialog(null)}>
          <div className="w-full rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {dialog === 'nickname' && (
              <>
                <div className="text-[15px] font-semibold text-[#2c2c30]">修改昵称</div>
                <input
                  value={nickDraft}
                  onChange={(e) => setNickDraft(e.target.value)}
                  maxLength={12}
                  className="mt-3 h-11 w-full rounded-xl bg-[#f3f3f5] px-3.5 text-[15px] outline-none"
                />
                <div className="mt-4 flex gap-2.5">
                  <button type="button" onClick={() => setDialog(null)} className="h-10 flex-1 rounded-xl bg-[#f0f0f3] text-[13.5px] font-medium text-[#5a5a62]">
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      patch({ meName: nickDraft.trim() || state.meName });
                      setDialog(null);
                      showToast('昵称已保存 ♡');
                    }}
                    className="h-10 flex-1 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[13.5px] font-semibold text-white"
                  >
                    保存
                  </button>
                </div>
              </>
            )}

            {dialog === 'gender' && (
              <>
                <div className="text-[15px] font-semibold text-[#2c2c30]">选择性别</div>
                <div className="mt-3 space-y-2">
                  {['女', '男', '保密'].map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        patch({ gender: g });
                        setDialog(null);
                        showToast('性别已保存');
                      }}
                      className={`flex h-11 w-full items-center justify-between rounded-xl px-4 text-[14.5px] ${state.gender === g ? 'bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] font-semibold text-white' : 'bg-[#f3f3f5] text-[#3c3c42]'}`}
                    >
                      {g}
                      {state.gender === g && <Check className="h-4 w-4" strokeWidth={2.5} />}
                    </button>
                  ))}
                </div>
              </>
            )}

            {dialog === 'cert' && (
              <>
                <div className="text-center text-[17px] font-bold tracking-[6px] text-[#2c2c30]">恋 人 证 书</div>
                <div className="mt-1 text-center text-[10px] tracking-[2px] text-[#b6b6bd]">LOVER CERTIFICATE</div>
                <div className="mt-4 rounded-xl bg-[#f7f7f9] px-4 py-5 text-center">
                  <div className="flex items-center justify-center gap-2.5">
                    <span className="h-8 w-8 overflow-hidden rounded-full bg-[#ececef]">
                      {state.meAvatar ? <img src={state.meAvatar} alt="" className="h-full w-full object-cover" /> : <DefaultAvatar size={32} />}
                    </span>
                    <PixelHeart size={22} />
                    <span className="h-8 w-8 overflow-hidden rounded-full bg-[#ececef]">
                      {state.taAvatar ? <img src={state.taAvatar} alt="" className="h-full w-full object-cover" /> : <DefaultAvatar size={32} />}
                    </span>
                  </div>
                  <div className="mt-2.5 text-[14px] font-semibold text-[#2c2c30]">
                    {state.meName || '我'} <span className="mx-1 text-[#a9a9b2]">♡</span> {state.taName || 'TA'}
                  </div>
                  <div className="mt-1.5 text-[11.5px] leading-relaxed text-[#8e8e96]">
                    兹证明二位已缔结恋人关系
                    <br />
                    {state.anniversary ? `自 ${fmtDateCn(state.anniversary)} 起` : '纪念日期待你们写下'}
                    <br />
                    特此颁发此证，以资纪念。
                  </div>
                </div>
                <button type="button" onClick={() => setDialog(null)} className="mt-4 h-10 w-full rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[13.5px] font-semibold text-white">
                  收好证书
                </button>
              </>
            )}

            {dialog === 'logins' && (
              <>
                <div className="text-[15px] font-semibold text-[#2c2c30]">登录记录</div>
                <div className="mt-3 max-h-[46vh] space-y-1.5 overflow-y-auto">
                  {state.logins.length === 0 && <div className="py-4 text-center text-[13px] text-[#b6b6bd]">暂无记录</div>}
                  {state.logins.map((t, i) => {
                    const d = new Date(t);
                    return (
                      <div key={`${t}-${i}`} className="flex items-center justify-between rounded-xl bg-[#f7f7f9] px-3.5 py-2.5 text-[13px]">
                        <span className="text-[#2c2c30]">{i === 0 ? '本次登录' : `第 ${state.logins.length - i} 次`}</span>
                        <span className="text-[#8e8e96]">
                          {fmtDate(t)} {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={() => setDialog(null)} className="mt-4 h-10 w-full rounded-xl bg-[#f0f0f3] text-[13.5px] font-medium text-[#5a5a62]">
                  关闭
                </button>
              </>
            )}

            {dialog === 'ta' && (
              <>
                <div className="text-[15px] font-semibold text-[#2c2c30]">对方资料</div>
                <div className="mt-3 flex items-center gap-3">
                  <button type="button" onClick={() => taInput.current?.click()} className="relative shrink-0" aria-label="更换对方头像">
                    <span className="block h-12 w-12 overflow-hidden rounded-full bg-[#ececef]">
                      {state.taAvatar ? <img src={state.taAvatar} alt="" className="h-full w-full object-cover" /> : <DefaultAvatar size={48} />}
                    </span>
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#3f3f46] text-white">
                      <Camera className="h-2.5 w-2.5" />
                    </span>
                  </button>
                  <input
                    value={taNameDraft}
                    onChange={(e) => setTaNameDraft(e.target.value)}
                    placeholder="TA 的昵称"
                    maxLength={12}
                    className="h-11 flex-1 rounded-xl bg-[#f3f3f5] px-3.5 text-[15px] outline-none placeholder:text-[#b6b6bd]"
                  />
                </div>
                <div className="mt-4 flex gap-2.5">
                  <button type="button" onClick={() => setDialog(null)} className="h-10 flex-1 rounded-xl bg-[#f0f0f3] text-[13.5px] font-medium text-[#5a5a62]">
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      patch({ taName: taNameDraft.trim() || state.taName });
                      setDialog(null);
                      showToast('对方资料已保存 ♡');
                    }}
                    className="h-10 flex-1 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[13.5px] font-semibold text-white"
                  >
                    保存
                  </button>
                </div>
              </>
            )}

            {dialog === 'signature' && (
              <>
                <div className="text-[15px] font-semibold text-[#2c2c30]">我们的签名</div>
                <input
                  value={sigDraft}
                  onChange={(e) => setSigDraft(e.target.value)}
                  maxLength={30}
                  placeholder="写一句属于你们的话"
                  className="mt-3 h-11 w-full rounded-xl bg-[#f3f3f5] px-3.5 text-[15px] outline-none placeholder:text-[#b6b6bd]"
                />
                <div className="mt-4 flex gap-2.5">
                  <button type="button" onClick={() => setDialog(null)} className="h-10 flex-1 rounded-xl bg-[#f0f0f3] text-[13.5px] font-medium text-[#5a5a62]">
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      patch({ signature: sigDraft.trim() });
                      setDialog(null);
                      showToast('签名已保存 ♡');
                    }}
                    className="h-10 flex-1 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[13.5px] font-semibold text-white"
                  >
                    保存
                  </button>
                </div>
              </>
            )}

            {dialog === 'reset' && (
              <>
                <div className="text-[15px] font-semibold text-[#2c2c30]">确定解除恋人关系吗？</div>
                <p className="mt-2 text-[13px] leading-relaxed text-[#9a9aa2]">将清空恋人空间的全部数据（相册、日记、情书、成长值……），此操作不可恢复。</p>
                <div className="mt-4 flex gap-2.5">
                  <button type="button" onClick={() => setDialog(null)} className="h-10 flex-1 rounded-xl bg-[#f0f0f3] text-[13.5px] font-medium text-[#5a5a62]">
                    再想想
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDialog(null);
                      onReset();
                      showToast('已解除关系，回到邀请页');
                    }}
                    className="h-10 flex-1 rounded-xl bg-[#3f3f46] text-[13.5px] font-semibold text-white"
                  >
                    确认解除
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </SubShell>
  );
}

/** 每天想你记录页 */
function MissYouPage({ state, tapMissYou, close }: { state: CoupleState; tapMissYou: () => void; close: () => void }) {
  const today = state.missYouByDay[todayKey()] || 0;
  const week = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const k = todayKey(d);
    return { k, n: state.missYouByDay[k] || 0, label: ['日', '一', '二', '三', '四', '五', '六'][d.getDay()] };
  });
  const max = Math.max(1, ...week.map((w) => w.n));
  return (
    <SubShell title="每天想你" onBack={close}>
      <div className="mt-4 flex flex-col items-center rounded-2xl bg-white py-8 shadow-sm">
        <button type="button" onClick={tapMissYou} aria-label="想你 +1" className="flex h-[104px] w-[104px] items-center justify-center rounded-full bg-[radial-gradient(circle_at_32%_28%,#cfcfd6,#a9a9b2_70%)] text-white shadow-[0_14px_34px_rgba(70,70,80,0.35)] transition-transform active:scale-[0.94]">
          <Heart className="h-10 w-10" fill="currentColor" strokeWidth={1.5} />
        </button>
        <div className="mt-4 text-[15px] text-[#9a9aa2]">今天已经想了你</div>
        <div className="text-[34px] font-bold text-[#2c2c30]">{today} 次</div>
        <div className="text-[13px] text-[#b6b6bd]">累计 {state.missYou} 次</div>
      </div>
      {/* 近 7 天柱状 */}
      <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
        <div className="text-[15px] font-semibold text-[#2c2c30]">近 7 天的心动频率</div>
        <div className="mt-4 flex h-[90px] items-end justify-between gap-2 px-1">
          {week.map((w) => (
            <div key={w.k} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-[64px] w-full items-end">
                <div className="w-full rounded-t-md bg-[linear-gradient(180deg,#8e8e97,#6a6a73)] transition-all" style={{ height: `${(w.n / max) * 100}%`, minHeight: w.n > 0 ? 6 : 2, opacity: w.n > 0 ? 1 : 0.25 }} />
              </div>
              <span className="text-[11px] text-[#9a9aa2]">{w.label}</span>
            </div>
          ))}
        </div>
      </div>
    </SubShell>
  );
}

/** 小礼堂：求婚/结婚证 */
function ChapelPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  return (
    <SubShell title="小礼堂" onBack={close}>
      {state.married ? (
        <div className="mt-6 rounded-2xl bg-white p-6 text-center shadow-sm">
          <div className="text-[34px]">💒</div>
          <div className="mt-2 text-[22px] font-bold tracking-[4px] text-[#2c2c30]">结 婚 证</div>
          <div className="mt-4 space-y-2 text-[16px] text-[#4a4a52]">
            <div>
              {state.meName || '我'} <span className="mx-2 text-[#a9a9b2]">♡</span> {state.taName || 'TA'}
            </div>
            <div className="text-[13px] text-[#9a9aa2]">于 {state.marriedAt ? fmtDate(state.marriedAt) : ''} 在小礼堂登记结婚</div>
          </div>
          <div className="mx-auto mt-4 flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-[#c9502e] text-[11px] font-bold leading-tight text-[#c9502e]">
            结婚证
            <br />
            专用章
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center rounded-2xl bg-white py-10 shadow-sm">
          <div className="text-[44px]">💍</div>
          <div className="mt-3 text-[18px] font-bold text-[#2c2c30]">准备一场求婚仪式</div>
          <p className="mt-2 px-8 text-center text-[14px] leading-relaxed text-[#9a9aa2]">在小礼堂，单膝跪地，把余生的每一天都交给对方。</p>
          <button
            type="button"
            onClick={() => {
              patch({ married: true, marriedAt: Date.now() });
              showToast('TA 说「我愿意」💒');
            }}
            className="mt-6 h-12 rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-12 text-[16px] font-semibold text-white shadow-[0_8px_20px_rgba(60,60,68,0.28)]"
          >
            单膝跪地求婚
          </button>
        </div>
      )}
    </SubShell>
  );
}

/** 联系客服：本地假客服 */
function SupportPage({ close }: { close: () => void }) {
  const [msgs, setMsgs] = useState<{ id: string; me: boolean; text: string }[]>([
    { id: uid(), me: false, text: '您好，这里是恋人空间客服小甜 ♡ 请问有什么可以帮您？' },
  ]);
  const [text, setText] = useState('');
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setMsgs((m) => [...m, { id: uid(), me: true, text: t }]);
    setText('');
    setTimeout(() => {
      setMsgs((m) => [
        ...m,
        {
          id: uid(),
          me: false,
          text: ['收到啦！小甜已经记下来了 ♡', '这个问题交给爱情去解答，会更好的 ♡', '呜呜太甜了，小甜先磕为敬！', '有任何问题都可以随时来找我哦 ♡'][Math.floor(Math.random() * 4)],
        },
      ]);
    }, 700);
  };
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 bg-white/90 pt-[54px] backdrop-blur-md">
        <div className="relative flex h-12 items-center px-2">
          <button type="button" onClick={close} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full text-[#3a3a40]">
            <ArrowLeft className="h-6 w-6" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[18px] font-bold">联系客服</div>
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.me ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${m.me ? 'bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-white' : 'bg-white text-[#2c2c30] shadow-sm'}`}>{m.text}</div>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-black/[0.05] bg-white p-3 pb-5">
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="说说你遇到的问题…"
            maxLength={100}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            className="h-11 flex-1 rounded-full bg-[#f3f3f5] px-4 text-[15px] outline-none placeholder:text-[#b6b6bd]"
          />
          <button type="button" onClick={send} className="h-11 rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-5 text-[15px] font-semibold text-white">
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

/** 设置：换背景 / 解除关系（重置） / 关于 */
function SettingsPage({ state, patch, showToast, close, onReset }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void; onReset: () => void }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const bgInput = useRef<HTMLInputElement | null>(null);
  return (
    <SubShell title="设置" onBack={close}>
      <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
        <button
          type="button"
          onClick={() => bgInput.current?.click()}
          className="flex h-[58px] w-full items-center justify-between px-5 text-left transition-colors active:bg-[#f6f6f8]"
        >
          <span className="text-[16px] font-medium text-[#2c2c30]">更换首页合影背景</span>
          <ChevronRight className="h-5 w-5 text-[#c6c6cd]" />
        </button>
        <button
          type="button"
          onClick={() => {
            patch({ homeBg: null });
            showToast('已恢复默认背景');
          }}
          className="flex h-[58px] w-full items-center justify-between border-t border-black/[0.04] px-5 text-left transition-colors active:bg-[#f6f6f8]"
        >
          <span className="text-[16px] font-medium text-[#2c2c30]">恢复默认背景</span>
          <ChevronRight className="h-5 w-5 text-[#c6c6cd]" />
        </button>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="flex h-[58px] w-full items-center justify-between border-t border-black/[0.04] px-5 text-left transition-colors active:bg-[#f6f6f8]"
        >
          <span className="text-[16px] font-medium text-[#8e8e96]">解除恋人关系（清空数据）</span>
          <ChevronRight className="h-5 w-5 text-[#c6c6cd]" />
        </button>
      </div>
      <div className="mt-6 text-center text-[12.5px] leading-relaxed text-[#b6b6bd]">
        恋人空间 v1.0 · 白灰限定版
        <br />
        愿有岁月可回首，且以深情共白头
      </div>
      <input
        ref={bgInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.currentTarget.value = '';
          if (!f) return;
          try {
            const url = await fileToScaledDataURL(f, 1080, 0.75);
            patch({ homeBg: url });
            showToast('背景已更换 ♡');
          } catch {
            showToast('图片处理失败');
          }
        }}
      />
      {confirmReset && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-10" onClick={() => setConfirmReset(false)}>
          <div className="w-full rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[17px] font-semibold text-[#2c2c30]">确定解除恋人关系吗？</div>
            <p className="mt-2 text-[14px] leading-relaxed text-[#9a9aa2]">将清空恋人空间的全部数据（相册、日记、情书、成长值……），此操作不可恢复。</p>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={() => setConfirmReset(false)} className="h-11 flex-1 rounded-xl bg-[#f0f0f3] text-[15px] font-medium text-[#5a5a62]">
                再想想
              </button>
              <button
                type="button"
                onClick={() => {
                  onReset();
                  showToast('已解除关系，回到邀请页');
                }}
                className="h-11 flex-1 rounded-xl bg-[#3f3f46] text-[15px] font-semibold text-white"
              >
                确认解除
              </button>
            </div>
          </div>
        </div>
      )}
    </SubShell>
  );
}

/** 相册详情：照片网格 + 上传 + 删除 */
function AlbumDetail({ state, patch, albumId, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; albumId: string | null; showToast: (m: string) => void; close: () => void }) {
  const album = state.albums.find((a) => a.id === albumId);
  const input = useRef<HTMLInputElement | null>(null);
  const [view, setView] = useState<number | null>(null);
  if (!album) {
    return (
      <SubShell title="相册" onBack={close}>
        <div className="mt-10 text-center text-[14px] text-[#9a9aa2]">相册不存在</div>
      </SubShell>
    );
  }
  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    showToast('正在上传…');
    const urls: string[] = [];
    for (const f of Array.from(files).slice(0, 9)) {
      try {
        urls.push(await fileToScaledDataURL(f, 900, 0.72));
      } catch {
        /* 跳过失败 */
      }
    }
    if (urls.length === 0) {
      showToast('图片处理失败');
      return;
    }
    patch({ albums: state.albums.map((a) => (a.id === album.id ? { ...a, photos: [...a.photos, ...urls] } : a)) });
    showToast(`已上传 ${urls.length} 张 ♡`);
  };
  const removePhoto = (idx: number) => {
    patch({ albums: state.albums.map((a) => (a.id === album.id ? { ...a, photos: a.photos.filter((_, i) => i !== idx) } : a)) });
    setView(null);
    showToast('已删除');
  };
  return (
    <SubShell
      title={album.name}
      onBack={close}
      right={
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex h-9 items-center gap-1 rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-4 text-[13px] font-semibold text-white"
        >
          <Plus className="h-4 w-4" /> 上传
        </button>
      }
    >
      {album.photos.length === 0 ? (
        <div className="mt-20 flex flex-col items-center gap-3 text-[#b6b6bd]">
          <ImageIcon className="h-12 w-12" strokeWidth={1.3} />
          <div className="text-[14px]">还没有照片，点右上角上传吧</div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {album.photos.map((p, i) => (
            <button key={`${i}-${p.slice(-16)}`} type="button" onClick={() => setView(i)} className="aspect-square overflow-hidden rounded-lg bg-[#ececef]">
              { }
              <img src={p} alt={`照片${i + 1}`} className="h-full w-full object-cover transition-transform active:scale-[0.97]" draggable={false} />
            </button>
          ))}
        </div>
      )}
      {/* 大图查看 + 删除 */}
      {view != null && (
        <div className="absolute inset-0 z-40 flex flex-col bg-black/90" onClick={() => setView(null)}>
          <div className="flex h-[54px] items-center justify-end px-4 pt-[54px]">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removePhoto(view);
              }}
              aria-label="删除照片"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center px-6 pb-16">
            { }
            <img src={album.photos[view]} alt="查看照片" className="max-h-full max-w-full object-contain" draggable={false} onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files);
          e.currentTarget.value = '';
        }}
      />
    </SubShell>
  );
}
