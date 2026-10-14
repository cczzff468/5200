'use client';

/**
 * 情侣空间 App（恋人空间，原情侣空间）——白/浅灰定制配色版。
 *
 * 用户规格：按提供的 5 张参考截图 1:1 复刻结构（邀请页 / 首页 / 发现 / 相册 / 我们），
 * 全站配色不用粉色/红色，改用白色 + 浅灰（主强调色为炭灰渐变，深灰白字保证对比）。
 *
 * 页面结构（对应参考图）：
 * - 邀请页（图1）：全屏渐变底 + 装饰圆与浮点 + 恋人头像/昵称 + 「邀请你开通恋人空间」
 *   + 左上角返回键 + 「接受邀请」大按钮 + 底部「在恋人空间你们可以体验这些」三体验卡（情侣相册/爱情树/纪念日）
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
  GripVertical,
  Heart,
  Headphones,
  HelpCircle,
  IdCard,
  Image as ImageIcon,
  ImagePlus,
  Info,
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
import { useUI } from '@/lib/ios/store';
import { listContacts } from '@/lib/ios/contacts-store';
import {
  COUPLE_STATE_EVENT,
  channelIdentityOf,
  emptyInviteMeta,
  readInviteMeta,
  sendMyInvite,
  aiInvitesMe,
  acceptIncomingInvite,
  type CoupleChannel,
  type CoupleInviteMeta,
} from '@/lib/ios/couple-invite';
import { coupleMemoryDiff, runCoupleAiTick } from '@/lib/ios/couple-ai';
import { displayNameOf, isFriendIn } from '@/lib/contacts';
import { fileToScaledDataURL, loadProfileCard } from '@/components/ios/ProfileCard';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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

/** 真实地理位置（情侣轨迹）：open-meteo 地理编码返回的地名 + WGS84 坐标 */
interface CouplePlace {
  name: string; // 展示名（如「北京市」）
  lat: number;
  lng: number;
}

/** 已保存的恋爱协议书（签署生效后自动存档；可多份，可点击回看） */
interface CouplePactRecord {
  id: string;
  title: string;
  preamble: string;
  clauses: string[];
  signMe: string | null;
  signTa: string | null;
  meAt: number | null;
  taAt: number | null;
  at: number; // 生效时间（双方签完）
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
  letterDraft: string; // 未来情书草稿（存草稿按钮）
  albums: CoupleAlbum[];
  moods: { id: string; emoji: string; text: string; at: number; photo?: string | null; dateKey?: string; from?: 'me' | 'ta' }[]; // 心情日记（from='ta' = AI 写的）
  chronicle: { id: string; text: string; at: number }[]; // 恋爱编年史
  impressionsMe: string[]; // TA 眼中的我（标签）
  impressionsTa: string[]; // 我眼中的 TA（标签）
  hundred: number[]; // 100 件小事已勾选索引
  hundredItems: Record<string, { img: string | null; desc: string; date: string; place: string; byTa?: boolean }>; // 100 件小事编辑数据（key=索引；byTa=AI 发起）
  missCards: number; // 想你补签卡数量
  missMadeUp: string[]; // 已补签的日期 key
  stoneEngraved: boolean; // 三生石已刻名
  quiz: { id: string; q: string; a: string; at: number }[]; // 甜蜜小问答记录
  quizCustom: string[]; // 甜蜜小问答自定义问题
  examBest: number | null; // 恋爱水平考试最高分
  status: string; // 恋爱状态
  pactAt: number | null; // 恋爱协议签署时间（双方签完生效）
  pactTitle: string; // 协议名称（可编辑）
  pactPreamble: string; // 协议声明（可编辑）
  pactClauses: string[]; // 协议条款（可编辑/排序/增删）
  pactSignMe: string | null; // 我的签名
  pactSignTa: string | null; // TA 的签名
  pactMeAt: number | null; // 我签名时间
  pactTaAt: number | null; // TA 签名时间
  zodiac: { me: string; ta: string } | null; // 星座缘分选择
  tarotHistory: { id: string; name: string; at: number }[]; // 塔罗抽牌历史（存最近一张）
  married: boolean; // 小礼堂：是否已婚
  marriedAt: number | null;
  meetPlace: string; // 情侣轨迹：相遇地点
  myLoc: CouplePlace | null; // 情侣轨迹：我的真实位置（第八轮）
  taLoc: CouplePlace | null; // 情侣轨迹：TA 的真实位置（第八轮）
  meetLoc: CouplePlace | null; // 情侣轨迹：相遇地点定位（第八轮）
  chronicleMonths: { ym: string; status: string }[]; // 恋爱编年史：关键月份状态（ym='YYYY-MM'；第八轮重做）
  pacts: CouplePactRecord[]; // 已保存的协议书（第八轮：可多份/可回看）
  replies: { id: string; prompt: string; reply: string; at: number }[]; // 回复挑战（旧版自由回复存档）
  replyBest: number | null; // 回复挑战历史最佳（到达关数，12=通关；第七轮玩法）
  treeStreak: { last: string | null; n: number }; // 爱情树：我连续浇树（last=最近浇水日）
  taMissYou: number; // TA（AI）想你累计（第九轮：AI 每天想你）
  taMissYouByDay: Record<string, number>; // TA 每日想你
  taTreeStreak: { last: string | null; n: number }; // TA 连续浇树
  quizTa: { q: string; a: string; at: number }[]; // AI 的问答回答（每题保留最近一次）
  aiImpressions: string[]; // AI 贴给我的印象标签
  aiImpressAt: number | null; // AI 上次贴印象时间
  aiAnnivKeys: string[]; // AI 添加的纪念日 key
  aiHundred: { idx: number; note: string; why: string; at: number }[]; // AI 发起的 100 件小事
  aiPact: { title: string; preamble: string; clauses: string[]; at: number } | null; // AI 拟的协议草稿（等我签）
  aiLog: { id: string; text: string; at: number }[]; // AI 行为日志
  invite: CoupleInviteMeta; // 邀请元数据（全局唯一：恋人绑定/待处理邀请/每联系人限一次历史）
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
    letterDraft: '',
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
    hundredItems: {},
    missCards: 0,
    missMadeUp: [],
    stoneEngraved: false,
    quiz: [],
    quizCustom: [],
    examBest: null,
    status: '',
    pactAt: null,
    pactTitle: '恋爱协议书',
    pactPreamble: '为维护双方的感情与信任，促进彼此理解与成长，建立健康、稳定、真诚的亲密关系，双方经友好协商，达成如下协议，共同遵守：',
    pactClauses: [
      '做错事情要认真道歉，并用实际行动改正',
      '即使意见不同，也要尊重对方的选择和感受',
      '每天睡前都要通电话或者视频',
      '爱屋及乌，尊重并融入对方的圈子',
      '不能轻易说分手',
      '少喝碳酸饮料少吃垃圾食品按时吃饭睡觉',
    ],
    pactSignMe: null,
    pactSignTa: null,
    pactMeAt: null,
    pactTaAt: null,
    zodiac: null,
    tarotHistory: [],
    married: false,
    marriedAt: null,
    meetPlace: '',
    myLoc: null,
    taLoc: null,
    meetLoc: null,
    chronicleMonths: [],
    pacts: [],
    replies: [],
    replyBest: null,
    treeStreak: { last: null, n: 0 },
    taMissYou: 0,
    taMissYouByDay: {},
    taTreeStreak: { last: null, n: 0 },
    quizTa: [],
    aiImpressions: [],
    aiImpressAt: null,
    aiAnnivKeys: [],
    aiHundred: [],
    aiPact: null,
    aiLog: [],
    invite: emptyInviteMeta(),
  };
}

/** 读取持久化状态（缺失字段用默认值补齐，防旧数据缺键） */
function loadCoupleState(): CoupleState {
  try {
    const raw = kvGet<Partial<CoupleState>>(STATE_KEY);
    if (!raw) return defaultState();
    return {
      ...defaultState(),
      ...raw,
      // invite 子对象深合并（旧数据无 invite 键 → 默认；存在但缺字段 → 逐字段兜底）
      invite: { ...emptyInviteMeta(), ...(raw.invite ?? {}) },
      v: 1,
    };
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

/** 100 件小事清单（前 5 项与参考图一致：用情侣头像/一起看电影/第一次合照的照片/互穿对方衣服拍照/连麦睡觉） */
const HUNDRED_LIST: string[] = [
  '用情侣头像', '一起看电影', '第一次合照的照片', '互穿对方衣服拍照', '连麦睡觉',
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

/** 回复挑战（第七轮重做，参考图1/2）：12 关高危回复关卡；d=[体面值,觉察值,安抚值,存活率] 增量 */
const REPLY_LEVELS: {
  name: string;
  scene: string;
  quote: string;
  opts: { t: string; d: [number, number, number, number]; v: string }[];
}[] = [
  {
    name: '没事陷阱',
    scene: '你临时忙起来，忘了提前报备。TA 等到情绪已经降温，才回你一句很轻的话。最危险的是：这句话听起来不吵不闹。',
    quote: '没事，你忙吧。',
    opts: [
      { t: '我忙完马上找你，先别难过', d: [2, 2, 4, 2], v: '及格但不满分：TA 要的不是「等」，是「被优先」。' },
      { t: '我刚没交代清楚，让你干等了', d: [5, 6, 6, 5], v: '高情商：先认账再补救，TA 的委屈被看见了。' },
      { t: '我不是不想陪你，只是刚好忙', d: [-3, -2, -2, -4], v: '解释型回复：听起来像辩解，TA 只听到「你不如忙」。' },
      { t: '你先睡，明天我认真补给你', d: [-5, -4, -6, -8], v: '危险发言：「补」字一出，TA 觉得自己在被排期。' },
    ],
  },
  {
    name: '随便考验',
    scene: '你问 TA 晚上吃什么，TA 盯着手机没抬头，轻轻吐出两个字。这两个字是送命题的入口。',
    quote: '随便你。',
    opts: [
      { t: '不随便了，我订你最爱的那家', d: [6, 4, 6, 6], v: '直接给答案，绕过送命题，满分操作。' },
      { t: '那我说了哦：你最想吃的那家', d: [4, 5, 5, 4], v: '「随便」的潜台词是「你猜中我想要的」。' },
      { t: '行，那就随便吃点', d: [-6, -3, -5, -9], v: '把「随便」当真的人，今晚可能要自己吃了。' },
      { t: '你怎么老说随便，烦不烦', d: [-8, -6, -8, -12], v: '把情绪问题升级成人身攻击，火力全开直通败局。' },
    ],
  },
  {
    name: '已读深渊',
    scene: '你发了一长段分享，对话框顶端跳出「已读」。十分钟后，TA 回了一个字。',
    quote: '哦。',
    opts: [
      { t: '看来你今天不太想聊天，晚上我陪你补上', d: [6, 7, 6, 6], v: '给台阶也给自己台阶，晚上的约定让 TA 有盼头。' },
      { t: '发个表情包把气氛拉回来', d: [3, 2, 4, 3], v: '轻处理是对的，但别每次都用表情包躲问题。' },
      { t: '怎么回一个哦，我说的不好笑吗', d: [-2, -1, -2, -4], v: '质问会让 TA 关闭分享欲，下条「哦」已经在路上了。' },
      { t: '（也不回了，开始冷战）', d: [-8, -4, -8, -14], v: '以冷制冷，两败俱伤，存活率直接腰斩。' },
    ],
  },
  {
    name: '在吗迷雾',
    scene: 'TA 发来「在吗」，你回了「在」，然后对方开始打字、停止、又打字。三分钟后什么都没发过来。',
    quote: '在吗？',
    opts: [
      { t: '怎么啦？慢慢说，我都在', d: [5, 4, 6, 5], v: '「我都在」是给安全感的教科书句式。' },
      { t: '在，咋了你说', d: [1, 0, 1, 0], v: '太干了，TA 的欲言又止需要一点推动力。' },
      { t: '有事直接说，别老发在吗', d: [-6, -5, -6, -9], v: '「在吗恐惧症」背后是怕麻烦，但说出来就是刀。' },
      { t: '（假装没看见）', d: [-4, -2, -5, -10], v: '已读不回是会记账的，TA 记性好得很。' },
    ],
  },
  {
    name: '你开心就好',
    scene: '你们为一个周末安排争执了几句，TA 突然不争了，语气平静得可怕。',
    quote: '嗯，你开心就好。',
    opts: [
      { t: '我们先停十分钟，抱一下再慢慢说', d: [6, 6, 7, 6], v: '暂停 + 肢体接触，冲突降温最快的一招。' },
      { t: '我不开心，我想让你也开心', d: [5, 5, 6, 5], v: '接住了潜台词：TA 不是让你开心，是委屈。' },
      { t: '你又来了，至于吗', d: [-7, -6, -7, -11], v: '「至于吗」三个字是冷战助燃剂。' },
      { t: '好，那按我说的来', d: [-9, -5, -8, -15], v: '听不出反话的直球发言，当场暴毙。' },
    ],
  },
  {
    name: '别人家对象',
    scene: 'TA 刷到别人的对象送了限定礼物，语气酸酸地看了你一眼。',
    quote: '你怎么不学学人家对象？',
    opts: [
      { t: '是我疏忽了，下个月给你准备更大的惊喜', d: [7, 5, 7, 7], v: '承认 + 行动方案，把酸味变成期待。' },
      { t: '学不来，我只会对你一个人好', d: [4, 4, 5, 4], v: '油但有效，嫉妒需要一句甜话中和。' },
      { t: '那都是摆拍，有什么好在意的', d: [-3, -2, -3, -6], v: '否定 TA 的感受，酸味会发酵成怨气。' },
      { t: '人家对象好你去找人家啊', d: [-10, -6, -9, -16], v: '送命题标准错误答案，直接原地去世。' },
    ],
  },
  {
    name: '凌晨两点',
    scene: '凌晨两点，TA 突然发来消息，字里行间全是不安。',
    quote: '我是不是特别麻烦？',
    opts: [
      { t: '不麻烦，我就是你的树洞，说说怎么了', d: [7, 6, 7, 7], v: '倾听比解决更重要，TA 需要的是出口。' },
      { t: '麻烦，但我乐意，谁让我喜欢你', d: [6, 5, 7, 6], v: '先接住「麻烦」，再把负担变成宠爱。' },
      { t: '你想多了，早点睡吧', d: [-5, -4, -6, -9], v: '「你想多了」是否定感受四件套之首。' },
      { t: '还行吧，比一般人麻烦点', d: [-8, -5, -8, -13], v: '深夜玩梗等于玩火，玩笑也救不了场。' },
    ],
  },
  {
    name: '翻旧账预警',
    scene: '这次迟到让 TA 想起了上上次、上上上次。旧账本哗啦啦翻开。',
    quote: '你上次也是这么说的。',
    opts: [
      { t: '对不起，这次真的记住了，你看我做的', d: [6, 6, 6, 6], v: '旧账的本质是「信用破产」，用行动续费。' },
      { t: '这次和上次不一样，你听我解释', d: [-2, -1, -3, -5], v: '「你听我解释」是偶像剧里误会加深的开始。' },
      { t: '那我以后都不说了行吧', d: [-6, -4, -6, -10], v: '赌气式承诺，TA 听到的是「你无理取闹」。' },
      { t: '你怎么老翻旧账，累不累', d: [-9, -6, -9, -14], v: '指责翻旧账只会让 TA 更委屈，账本更厚。' },
    ],
  },
  {
    name: '算了吧陷阱',
    scene: '大吵一架后，TA 红着眼说出那四个字。但 TA 的手还紧紧攥着你们的合照。',
    quote: '要不……我们算了吧。',
    opts: [
      { t: '我不算，我们之间不能算', d: [7, 6, 7, 7], v: '假性分手要的是挽留，态度比道理重要。' },
      { t: '我们先都冷静，但我不会放弃我们', d: [5, 5, 6, 6], v: '给空间但不放手，进可攻退可守。' },
      { t: '你又来这套，烦不烦', d: [-8, -5, -8, -13], v: '把求救当威胁，TA 会真的死心。' },
      { t: '算就算了吧', d: [-12, -8, -12, -20], v: '顺着接就是真分手，存活率清零。' },
    ],
  },
  {
    name: '醋意试探',
    scene: 'TA 提到你最近和异性同事走得很近，语气轻描淡写，眼神却在打探。',
    quote: '那个谁对你挺好的呀。',
    opts: [
      { t: '我会注意分寸，也会把界限说清楚', d: [7, 7, 6, 7], v: '给足安全感，行动承诺最有力。' },
      { t: '好是好，但都没你好，你才最特别', d: [5, 4, 6, 5], v: '醋需要甜来化，先哄再划界限。' },
      { t: '你吃醋了？哈哈哈', d: [-4, -2, -3, -7], v: '嘲笑 TA 的醋意，下次 TA 会藏得更深。' },
      { t: '你能不能别疑神疑鬼', d: [-7, -5, -7, -12], v: '「疑神疑鬼」否定了 TA 的不安。' },
    ],
  },
  {
    name: '玩笑收刀',
    scene: 'TA 刚才开了个有点过分的玩笑，你脸都黑了，TA 立刻补了一句。',
    quote: '逗你的，你怎么还当真了。',
    opts: [
      { t: '我知道是玩笑，但这个玩笑我不喜欢', d: [7, 7, 6, 7], v: '温和而坚定地划界，玩笑也要有边界。' },
      { t: '你这玩笑一点都不好笑', d: [-2, -1, -2, -5], v: '对，但太硬，可以再加半句感受。' },
      { t: '（憋着，不说话）', d: [-3, -2, -4, -8], v: '憋住的委屈不会消失，只会过期变质。' },
      { t: '那你继续逗，看你能逗到什么时候', d: [-5, -4, -5, -9], v: '阴阳怪气回击，战火升级。' },
    ],
  },
  {
    name: '终极沉默',
    scene: 'TA 把你的消息全部已读，一个字都没有回。这是最危险的一关：无题可解，只能用心。',
    quote: '（TA 已读不回）',
    opts: [
      { t: '打个电话过去：我想听你说说', d: [8, 7, 8, 8], v: '沉默降级不了矛盾，声音可以。主动破冰是王者操作。' },
      { t: '发一段真诚的长文道歉', d: [5, 6, 5, 5], v: '真诚永远有效，但记得之后当面聊。' },
      { t: '连发十条消息追问怎么了', d: [-6, -2, -5, -10], v: '追问会让 TA 觉得被压迫，沉默更深。' },
      { t: 'TA 不回我也不回，看谁熬得过谁', d: [-9, -6, -9, -16], v: '沉默对决，输的都是感情。' },
    ],
  },
];

/** 情侣酒店房型（玩梗向） */
const HOTEL_ROOMS = [
  { name: '云朵大床房', desc: '整面落地窗，适合一起赖床到中午' },
  { name: '星空圆床房', desc: '屋顶天窗，躺着数星星' },
  { name: '温泉私汤房', desc: '独立汤池，冬夜首选' },
  { name: '海边木屋', desc: '推门就是沙滩和日出' },
];

/** 恋爱协议随机条款池（随机新增一条；第七轮参考图3/4/5 重做） */
const PACT_RANDOM_POOL = [
  '吵架时先抱十秒再讲道理',
  '每周至少一次正式约会',
  '出门前和回家后都要打招呼',
  '对方说话时不玩手机',
  '好吃的先让对方尝第一口',
  '生病时要第一时间关心',
  '购物车里的心愿偶尔悄悄清空',
  '每天至少夸对方一次',
  '合照时认真配合不敷衍',
  '每月一起解锁一件新事情',
];

/** 恋爱协议标准模板（导入模板编码加载，20 条，参考图3） */
const PACT_TEMPLATE_CLAUSES = [
  '绝不和异性搞暧昧',
  '绝不失联半天找不到人',
  '吵架不能隔夜，要当天解决',
  '吵架不说伤人的话，不骂人',
  '绝不在有异性的情况下过夜',
  '吵架不能不接电话、挂电话',
  '吵完架冷静后要反省和改正',
  '要记得每个纪念日和节日',
  '每天都要问候对方早晚安',
  '不能隐瞒和欺骗对方',
  '信息可以不秒回，但看到了一定要回',
  '遇到开心或难过的事要彼此分享',
  '可以吵架，不能冷战冷暴力',
  '不能轻易说分手',
  '外出或者行事提前互相报备',
  '少喝碳酸饮料少吃垃圾食品按时吃饭睡觉',
  '放下过往旧事不翻旧账一起向前看',
  '分手后不能诋毁不能把对方黑料报出去',
  '要相互包容相互理解这样爱情才长久',
  '有不满要直接告诉对方，不要在心里偷偷扣分',
];

/** 心情选项（含手绘风表情配色：c=脸色 d=描边/细节） */
const MOOD_LIST = [
  { emoji: '😊', label: '开心', c: '#f8d05e', d: '#e2b23c' },
  { emoji: '🥰', label: '甜蜜', c: '#f6bfcb', d: '#e59cad' },
  { emoji: '😴', label: '困困', c: '#cdccdb', d: '#a8a7bf' },
  { emoji: '😤', label: '生气', c: '#f08a78', d: '#d96a58' },
  { emoji: '😢', label: '委屈', c: '#93bbe9', d: '#709bd2' },
  { emoji: '🤔', label: '思考', c: '#eac59b', d: '#d2a774' },
  { emoji: '🤩', label: '兴奋', c: '#f4ab6d', d: '#de8c4c' },
  { emoji: '🥲', label: '想TA', c: '#c6b0e2', d: '#aa90cb' },
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

/**
 * 手绘蜡笔风心情表情（参考截图的圆脸涂鸦风）：
 * 不规则圆脸 + 各心情专属五官/装饰（口水笑/星星眼/泪滴/怒气线/思考泡/zzz…）
 */
function MoodFace({ mood, size = 40, className = '' }: { mood: string; size?: number; className?: string }) {
  const meta = MOOD_LIST.find((m) => m.emoji === mood);
  if (!meta) {
    return (
      <span className={`flex items-center justify-center rounded-full bg-[#ececef] ${className}`} style={{ width: size, height: size }}>
        <Smile className="h-1/2 w-1/2 text-[#b6b6bd]" strokeWidth={1.6} />
      </span>
    );
  }
  const ink = '#4a3d33';
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true">
      {/* 不规则蜡笔圆脸 */}
      <path
        d="M50 6 C73 4 94 23 93 49 C92 75 73 94 48 93 C24 92 7 75 7 49 C7 24 27 8 50 6 Z"
        fill={meta.c}
        stroke={meta.d}
        strokeWidth="2.6"
      />
      {meta.emoji === '😊' && (
        <>
          <circle cx="36" cy="43" r="3.4" fill={ink} />
          <circle cx="64" cy="43" r="3.4" fill={ink} />
          <path d="M31 56 Q50 82 69 56 Q50 65 31 56 Z" fill={ink} />
        </>
      )}
      {meta.emoji === '🥰' && (
        <>
          <path d="M29 45 Q36 37 43 45" stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none" />
          <path d="M57 45 Q64 37 71 45" stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none" />
          <ellipse cx="27" cy="55" rx="6" ry="3.6" fill="#ffffff" opacity="0.55" />
          <ellipse cx="73" cy="55" rx="6" ry="3.6" fill="#ffffff" opacity="0.55" />
          <path d="M40 59 Q50 69 60 59" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M22 24 c2-4.5 8.5-3.2 8.5 1.2 c0 3.4-4.6 6.2-8.5 9.4 c-3.9-3.2-8.5-6-8.5-9.4 c0-4.4 6.5-5.7 8.5-1.2 Z" fill={meta.d} opacity="0.9" />
        </>
      )}
      {meta.emoji === '😴' && (
        <>
          <path d="M29 44 Q36 50 43 44" stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none" />
          <path d="M57 44 Q64 50 71 44" stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none" />
          <circle cx="50" cy="63" r="3.4" fill={ink} />
          <text x="68" y="30" fontSize="17" fontWeight="bold" fill={ink} transform="rotate(14 68 30)">z</text>
          <text x="79" y="19" fontSize="11" fontWeight="bold" fill={ink} transform="rotate(14 79 19)">z</text>
        </>
      )}
      {meta.emoji === '😤' && (
        <>
          <path d="M28 35 L42 42" stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
          <path d="M72 35 L58 42" stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
          <circle cx="37" cy="49" r="3" fill={ink} />
          <circle cx="63" cy="49" r="3" fill={ink} />
          <path d="M40 67 Q50 58 60 67" stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none" />
          <path d="M63 14 l7 7 M74 10 l2.6 10.4 M84 17 l-7.4 5.6" stroke={ink} strokeWidth="2.6" strokeLinecap="round" fill="none" />
        </>
      )}
      {meta.emoji === '😢' && (
        <>
          <path d="M29 34 Q36 31 43 35" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M71 34 Q64 31 57 35" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="36" cy="45" r="3.2" fill={ink} />
          <circle cx="64" cy="45" r="3.2" fill={ink} />
          <path d="M32 53 q-4 9 0 12.5 q4-3.5 0-12.5 Z" fill="#b7d4f4" stroke={meta.d} strokeWidth="1.4" />
          <path d="M68 53 q-4 9 0 12.5 q4-3.5 0-12.5 Z" fill="#b7d4f4" stroke={meta.d} strokeWidth="1.4" />
          <path d="M41 68 Q45.5 63.5 50 68 Q54.5 72.5 59 68" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
        </>
      )}
      {meta.emoji === '🤔' && (
        <>
          <path d="M29 32 Q36 28.5 43 33" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M57 38 Q64 35.5 71 39" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="36" cy="45" r="3.2" fill={ink} />
          <circle cx="64" cy="47" r="3.2" fill={ink} />
          <path d="M43 66 L58 62" stroke={ink} strokeWidth="3.2" strokeLinecap="round" />
          <circle cx="73" cy="27" r="3.4" fill={ink} opacity="0.85" />
          <circle cx="81" cy="18" r="2.4" fill={ink} opacity="0.7" />
          <circle cx="88" cy="11" r="1.6" fill={ink} opacity="0.55" />
        </>
      )}
      {meta.emoji === '🤩' && (
        <>
          <path d="M0 -7.5 L2.2 -2.2 7.5 0 2.2 2.2 0 7.5 -2.2 2.2 -7.5 0 -2.2 -2.2 Z" transform="translate(36 43)" fill={ink} />
          <path d="M0 -7.5 L2.2 -2.2 7.5 0 2.2 2.2 0 7.5 -2.2 2.2 -7.5 0 -2.2 -2.2 Z" transform="translate(64 43)" fill={ink} />
          <path d="M31 58 Q50 82 69 58 Q50 66 31 58 Z" fill={ink} />
        </>
      )}
      {meta.emoji === '🥲' && (
        <>
          <path d="M36 38 c2.6-4.6 9.2-3.2 9.2 1.4 c0 3.6-5 6.6-9.2 10 c-4.2-3.4-9.2-6.4-9.2-10 c0-4.6 6.6-6 9.2-1.4 Z" transform="translate(0 -1) scale(0.62) translate(22 26)" fill={meta.d} />
          <path d="M64 38 c2.6-4.6 9.2-3.2 9.2 1.4 c0 3.6-5 6.6-9.2 10 c-4.2-3.4-9.2-6.4-9.2-10 c0-4.6 6.6-6 9.2-1.4 Z" transform="translate(0 -1) scale(0.62) translate(41 26)" fill={meta.d} />
          <path d="M41 62 Q50 70 59 62" stroke={ink} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M71 52 q-4 9 0 12.5 q4-3.5 0-12.5 Z" fill="#cdbdf0" stroke={meta.d} strokeWidth="1.3" />
        </>
      )}
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
  // 邀请流（第六轮）：全局邀请元数据同步 + 选人弹层（模式 send=我邀TA / recv=TA邀我）+ 渠道选择
  const [invMeta, setInvMeta] = useState<CoupleInviteMeta>(() => readInviteMeta());
  const [pickSheet, setPickSheet] = useState<'send' | 'recv' | null>(null);
  const [pickChannel, setPickChannel] = useState<CoupleChannel>('wx');
  const [friends, setFriends] = useState<{ id: string; name: string; avatar: string | null }[]>([]);

  /** 全局邀请状态事件同步：couple-invite（AI 接受/关系建立/收到邀请）直写 kv 后广播，
   *  本组件重读全局 kv 刷新（邀请页按钮状态切换 + 关系建立后自动进入主界面）；
   *  顺带触发 AI 主动行为（建立关系后 AI 开始想你/浇树/写日记…） */
  useEffect(() => {
    const sync = () => {
      const meta = readInviteMeta();
      setInvMeta(meta);
      setState(loadCoupleState()); // kv 内存缓存同步权威，读到的总是最新合并值
      if (meta.partnerContactId) runCoupleAiTick(meta.partnerApp ?? 'wx', meta.partnerContactId);
    };
    window.addEventListener(COUPLE_STATE_EVENT, sync);
    return () => window.removeEventListener(COUPLE_STATE_EVENT, sync);
  }, []);

  /** 全局头像/名字同步（用户要求：用微信邀请→双方身份跟随微信；QQ 邀请→跟随 QQ）：
   *  渠道 = 关系建立渠道（partnerApp）；我 = 该渠道当前账号档案（社交名 + 分 App 头像槽位），
   *  TA = 绑定恋人联系人（展示名 + 分 App 头像槽位）。
   *  挂载时 + 全局状态事件时同步，联系人改名/换头像后打开 App 自动跟随 */
  useEffect(() => {
    let alive = true;
    const syncFromGlobal = async () => {
      try {
        const meta = readInviteMeta();
        const ch: CoupleChannel = meta.partnerApp ?? 'wx';
        const idn = await channelIdentityOf(ch, meta.partnerContactId);
        if (!alive) return;
        setState((prev) => {
          const next: CoupleState = { ...prev };
          let changed = false;
          if (idn.meName && idn.meName !== prev.meName) {
            next.meName = idn.meName;
            changed = true;
          }
          if (idn.meAvatar && idn.meAvatar !== prev.meAvatar) {
            next.meAvatar = idn.meAvatar;
            changed = true;
          }
          if (idn.taName && idn.taName !== prev.taName) {
            next.taName = idn.taName;
            changed = true;
          }
          if (idn.taAvatar && idn.taAvatar !== prev.taAvatar) {
            next.taAvatar = idn.taAvatar;
            changed = true;
          }
          if (!changed) return prev;
          kvSetDebounced(STATE_KEY, next);
          return next;
        });
      } catch {
        /* 同步失败静默（保留本地值） */
      }
    };
    void syncFromGlobal();
    window.addEventListener(COUPLE_STATE_EVENT, syncFromGlobal);
    return () => {
      alive = false;
      window.removeEventListener(COUPLE_STATE_EVENT, syncFromGlobal);
    };
  }, []);

  /** 选人弹层打开/切换渠道时拉取该渠道 AI 好友列表（char/npc，排除机主小号） */
  useEffect(() => {
    if (!pickSheet) return;
    let alive = true;
    void (async () => {
      try {
        const list = await listContacts();
        if (!alive) return;
        setFriends(
          list
            .filter((c) => c.kind !== 'user' && isFriendIn(c, pickChannel))
            .map((c) => ({ id: c.id, name: displayNameOf(c), avatar: c.avatar ?? null })),
        );
      } catch {
        if (alive) setFriends([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pickSheet, pickChannel]);

  /** 选人确认：send=我邀请TA（选微信/QQ + AI 联系人）→ 邀请卡进会话 + AI 延时接受；
   *  recv=让 TA 来邀请你 → AI 延时发邀请卡（邀请页变「接受邀请」） */
  const onPickFriend = useCallback(
    async (contactId: string) => {
      if (!pickSheet) return;
      const mode = pickSheet;
      const ch = pickChannel;
      const r = mode === 'send' ? await sendMyInvite(ch, contactId) : await aiInvitesMe(ch, contactId);
      if (r.ok) {
        setPickSheet(null);
        showToast(mode === 'send' ? `邀请已发送到${ch === 'wx' ? '微信' : 'QQ'}，等 TA 同意 ♡` : '好，TA 稍后会向你发起邀请 ♡');
      } else {
        showToast(r.error);
      }
    },
    [pickSheet, pickChannel, showToast],
  );

  /** 接受邀请（邀请页大按钮；聊天卡片按钮走 couple-invite 同一入口）：
   *  AI 的邀请卡转已同意 → 我回成功卡 → sys 提示行 → 建立关系（全局）→ 事件同步进主界面 */
  const doAcceptInvite = useCallback(async () => {
    const inv = invMeta.pendingInvite;
    if (!inv) return;
    const r = await acceptIncomingInvite(inv.contactId);
    showToast(r.ok ? '欢迎来到你们的小天地 ♡' : r.error);
  }, [invMeta.pendingInvite, showToast]);

  /** 状态更新 + 防抖落盘（支持对象或函数式 updater，供快速连点场景原子更新）。
   *  同时：diff 前后状态，把用户新产生的情侣空间事件自动写进恋人（AI）的记忆（第九轮）。 */
  const invMetaRef = useRef(invMeta);
  useEffect(() => {
    invMetaRef.current = invMeta;
  });
  const patch = useCallback((pOrFn: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => {
    setState((prev) => {
      const inc = typeof pOrFn === 'function' ? pOrFn(prev) : pOrFn;
      const next = { ...prev, ...inc };
      kvSetDebounced(STATE_KEY, next);
      const meta = invMetaRef.current;
      if (meta.partnerContactId) {
        try {
          coupleMemoryDiff(prev, next, meta.partnerContactId, meta.partnerApp ?? 'wx');
        } catch {
          /* 记忆写入失败不阻断界面 */
        }
      }
      return next;
    });
  }, []);

  /** 解除关系：清空全部数据回到邀请页（设置页入口） */
  const resetAll = useCallback(() => {
    kvSet(STATE_KEY, defaultState());
    setState(defaultState());
    setSub(null);
  }, []);

  /** 首次进入：预填「我」的信息卡资料 + 联系人第一位 AI 角色作为恋人；记录登录 + 生成情侣号；
   *  已建立关系时触发 AI 主动行为调度（AI 每天想你/浇树/写日记…，内部按天去重） */
  useEffect(() => {
    const meta0 = readInviteMeta();
    if (meta0.partnerContactId) runCoupleAiTick(meta0.partnerApp ?? 'wx', meta0.partnerContactId);
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

  /** 浇水（爱情树）：成长值 +2，并累计连续浇树天数 */
  const waterTree = useCallback(() => {
    setState((prev) => {
      const k = todayKey();
      const yKey = todayKey(new Date(Date.now() - 86400000));
      const prevStreak = prev.treeStreak || { last: null, n: 0 };
      let n = 1;
      if (prevStreak.last === k) n = Math.max(1, prevStreak.n);
      else if (prevStreak.last === yKey) n = prevStreak.n + 1;
      const next: CoupleState = { ...prev, tree: Math.min(100, prev.tree + 2), treeStreak: { last: k, n } };
      kvSetDebounced(STATE_KEY, next);
      return next;
    });
    showToast('浇好水啦，小树茁壮成长 🌱');
  }, [showToast]);

  // ---------- 邀请页（图1；第六轮：按钮按邀请状态切换 + 邀请流） ----------
  if (!state.accepted) {
    const pend = invMeta.pendingInvite;
    const recvInvite = pend?.dir === 'recv' ? pend : null; // 有人邀请我 → 接受邀请
    const sendPend = pend?.dir === 'send' ? pend : null; // 我已发出邀请，等对方同意
    // 头像/名字：TA 邀请我 → 显示邀请人；否则显示预填恋人（兜底）
    const invAvatar = recvInvite?.fromAvatar ?? state.taAvatar;
    const invName = recvInvite?.fromName || state.taName;
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

        <div className="relative flex flex-1 flex-col items-center px-8 pt-[104px]">
          {/* 左上角返回键（第七轮）：回到手机主界面 */}
          <button
            type="button"
            data-testid="couple-invite-back"
            onClick={() => useUI.getState().closeApp()}
            aria-label="返回主界面"
            className="absolute left-3 top-[58px] flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-[#3a3a40] shadow-[0_2px_10px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-opacity active:opacity-50"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          {/* 恋人头像 + 名字（recv 时为邀请人） */}
          <div className="h-[118px] w-[118px] overflow-hidden rounded-full bg-[#ececef] ring-[6px] ring-white/80 shadow-[0_10px_30px_rgba(0,0,0,0.10)]">
            {invAvatar ? (
              <img src={invAvatar} alt={invName || '恋人'} className="h-full w-full object-cover" draggable={false} />
            ) : (
              <DefaultAvatar size={118} />
            )}
          </div>
          <div className="mt-8 text-[30px] font-bold leading-none">{invName || '恋人'}</div>
          <div className="mt-7 text-[30px] font-bold leading-tight text-[#3c3c42]">邀请你开通恋人空间</div>

          {/* 按钮区：有人邀请我 → 接受邀请；我已发出 → 等待对方；没人邀请 → 立即邀请我的另一半 */}
          {recvInvite ? (
            <>
              <div className="mt-5 text-[14px] text-[#6e6e76]">「{recvInvite.fromName}」想和你建立情侣关系</div>
              <button
                type="button"
                data-testid="couple-accept-btn"
                onClick={() => void doAcceptInvite()}
                className="mt-4 h-[64px] w-full rounded-full bg-[linear-gradient(135deg,#6a6a72,#45454c)] text-[22px] font-semibold text-white shadow-[0_12px_28px_rgba(60,60,68,0.28)] transition-transform active:scale-[0.98]"
              >
                接受邀请
              </button>
            </>
          ) : sendPend ? (
            <>
              <div className="mt-5 text-[14px] text-[#6e6e76]">
                已向「{sendPend.toName}」发出{sendPend.app === 'wx' ? '微信' : 'QQ'}邀请
              </div>
              <button
                type="button"
                disabled
                className="mt-4 h-[64px] w-full rounded-full bg-[linear-gradient(135deg,#b6b6bd,#9a9aa2)] text-[22px] font-semibold text-white shadow-[0_12px_28px_rgba(60,60,68,0.18)]"
              >
                等待对方接受…
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                data-testid="couple-invite-btn"
                onClick={() => setPickSheet('send')}
                className="mt-10 h-[64px] w-full rounded-full bg-[linear-gradient(135deg,#6a6a72,#45454c)] text-[22px] font-semibold text-white shadow-[0_12px_28px_rgba(60,60,68,0.28)] transition-transform active:scale-[0.98]"
              >
                立即邀请我的另一半
              </button>
              <button
                type="button"
                data-testid="couple-recv-btn"
                onClick={() => setPickSheet('recv')}
                className="mt-4 text-[14px] text-[#8e8e96] underline-offset-4 transition-opacity active:opacity-60"
              >
                让 TA 来邀请你
              </button>
            </>
          )}
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

        {/* 邀请选人弹层：渠道（微信/QQ）+ AI 好友列表（每联系人限一次，已邀请过置灰） */}
        {pickSheet && (
          <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/35" onClick={() => setPickSheet(null)}>
            <div className="max-h-[74%] overflow-y-auto rounded-t-3xl bg-white px-5 pb-9 pt-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto h-1 w-10 rounded-full bg-[#e0e0e5]" />
              <div className="mt-3 text-[17px] font-bold text-[#2c2c30]">{pickSheet === 'send' ? '邀请你的另一半' : '让 TA 来邀请你'}</div>
              <div className="mt-1 text-[12.5px] leading-relaxed text-[#9a9aa2]">
                {pickSheet === 'send' ? '选择渠道和要邀请的 AI 好友，TA 会稍后同意你的邀请' : '选择渠道和 AI 好友，TA 会稍后向你发起邀请'}
              </div>

              {/* 渠道分段选择（用户邀请 AI 可选微信还是 QQ） */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                {(['wx', 'qq'] as CoupleChannel[]).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    data-testid={`couple-channel-${ch}`}
                    onClick={() => setPickChannel(ch)}
                    className={`h-11 rounded-xl text-[14px] font-medium transition-colors ${
                      pickChannel === ch
                        ? 'bg-[linear-gradient(135deg,#6a6a72,#45454c)] text-white shadow-[0_4px_12px_rgba(60,60,68,0.25)]'
                        : 'bg-[#f3f3f5] text-[#4a4a52] active:bg-[#ececef]'
                    }`}
                  >
                    {ch === 'wx' ? '通过微信邀请' : '通过QQ邀请'}
                  </button>
                ))}
              </div>

              {/* 该渠道 AI 好友列表 */}
              <div className="mt-4 max-h-72 space-y-1 overflow-y-auto" data-testid="couple-friend-list">
                {friends.length === 0 ? (
                  <div className="py-8 text-center text-[13px] text-[#b6b6bd]">该渠道还没有 AI 好友</div>
                ) : (
                  friends.map((f) => {
                    const invited = invMeta.invitedOnce.some((x) => x.contactId === f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        disabled={invited}
                        data-testid={`couple-friend-${f.id}`}
                        onClick={() => void onPickFriend(f.id)}
                        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors active:bg-[#f3f3f5] disabled:opacity-40"
                      >
                        <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-[#ececef]">
                          {f.avatar ? (
                            <img src={f.avatar} alt={f.name} className="h-full w-full object-cover" draggable={false} />
                          ) : (
                            <DefaultAvatar size={40} />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[14.5px] text-[#2c2c30]">{f.name}</span>
                        {invited && <span className="shrink-0 text-[12px] text-[#b6b6bd]">已邀请过</span>}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
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
            onClose={() => useUI.getState().closeApp()}
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
  onClose: () => void;
}) {
  const { state, days, missDays, tapMissYou, openSub, onPickBg, onClose } = props;
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
    <div className="relative flex h-full flex-col">
      {/* 可滚动内容区 */}
      <div className="relative flex-1 overflow-y-auto overscroll-contain">
        <div className="px-5 pt-[60px]">
          {/* 点击标题返回手机主界面（第七轮用户要求） */}
          <button
            type="button"
            data-testid="couple-home-title"
            onClick={onClose}
            aria-label="返回主界面"
            className="text-left text-[24px] font-bold leading-tight tracking-tight transition-opacity active:opacity-40"
          >
            恋人空间
          </button>
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

      {/* 每天想你大圆：首次点击打卡后消失，改为头像下方想念天数（记录入口在右侧悬浮心形按钮） */}
      {missDays == null && (
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
      )}

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
      </div>

      {/* 右侧悬浮操作（想念记录 / 换背景）：固定在功能卡上方，不随内容滚动 */}
      <div className="absolute bottom-[116px] right-3 z-20 flex flex-col gap-2.5">
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

      {/* 底部固定四功能卡（不随内容滚动，始终贴在 Tab 栏上方） */}
      <div className="relative z-10 grid shrink-0 grid-cols-4 gap-2 px-3 pb-3 pt-2">
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

          {/* 双头像 + 浅灰爱心 + 进度条 + 天数 */}
          <div className="relative mt-4 flex items-start justify-between px-5">
            <span aria-hidden="true" className="mt-16 text-[13px] text-[#d9d9de]">♡</span>
            <CoupleAvatar src={state.meAvatar} name={state.meName} size={62} ring={false} />
            <div className="flex flex-col items-center gap-1 pt-1.5">
              <Heart className="h-9 w-9 text-[#d6d6dc]" fill="#e2e2e7" strokeWidth={1.1} />
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
      return <TreePage state={state} waterTree={waterTree} close={close} showToast={showToast} />;
    case 'track':
      return <TrackPage state={state} patch={patch} days={days} close={close} showToast={showToast} />;
    case 'quiz':
      return <QuizPage state={state} patch={patch} days={days} close={close} showToast={showToast} />;
    case 'letters':
      return <LettersPage state={state} patch={patch} close={close} showToast={showToast} />;
    case 'house':
      return <HousePage state={state} days={days} close={close} />;
    case 'mood':
      return <MoodPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'tarot':
      return <TarotPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'hundred':
      return <HundredPage state={state} patch={patch} close={close} showToast={showToast} />;
    case 'pact':
      return <PactPage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'exam':
      return <ExamPage state={state} patch={patch} close={close} />;
    case 'zodiac':
      return <ZodiacPage state={state} patch={patch} close={close} />;
    case 'chronicle':
      return <ChroniclePage state={state} patch={patch} showToast={showToast} close={close} />;
    case 'stone':
      return <StonePage state={state} patch={patch} showToast={showToast} close={close} />;
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
      return <MissYouPage state={state} patch={patch} tapMissYou={tapMissYou} showToast={showToast} close={close} />;
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
      {/* 英雄卡：双头像 + 在一起天数 */}
      <div className="relative mt-3 overflow-hidden rounded-3xl bg-[linear-gradient(160deg,#ffffff_0%,#f2f2f5_60%,#e7e7eb_100%)] px-5 pb-5 pt-6 text-center shadow-[0_10px_26px_rgba(0,0,0,0.08)]">
        <div aria-hidden="true" className="pointer-events-none absolute -left-8 -top-10 h-28 w-28 rounded-full bg-white/70" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-6 top-8 h-20 w-20 rounded-full bg-white/50" />
        <div className="relative mx-auto flex w-fit items-center">
          <div className="h-12 w-12 overflow-hidden rounded-full bg-[#ececef] ring-2 ring-white shadow-sm">
            {state.meAvatar ? <img src={state.meAvatar} alt={state.meName} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={48} />}
          </div>
          <div className="relative ml-2.5 h-12 w-12 overflow-hidden rounded-full bg-[#ececef] ring-2 ring-white shadow-sm">
            {state.taAvatar ? <img src={state.taAvatar} alt={state.taName} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={48} />}
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

/** 爱情小树（SVG 手绘风，随成长值 stage 0-4 变化：嫩芽→壮苗→树苗→小树→繁花大树），替代 emoji 图标 */
const LOVE_HEART_PATH = 'M0 2.2 C0 0.6 1.6 -0.6 3 0.4 L4.5 1.5 L6 0.4 C7.4 -0.6 9 0.6 9 2.2 C9 4.6 4.5 7.5 4.5 7.5 C4.5 7.5 0 4.6 0 2.2 Z';
function LoveHeartDot({ x, y, s = 1, fill = '#ff8fae' }: { x: number; y: number; s?: number; fill?: string }) {
  return <path d={LOVE_HEART_PATH} transform={`translate(${x} ${y}) scale(${s}) translate(-4.5 -3.5)`} fill={fill} />;
}

function LoveTree({ stage }: { stage: number }) {
  const s = Math.max(0, Math.min(4, stage));
  return (
    <svg viewBox="0 0 200 240" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="ltLeaf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a8e063" />
          <stop offset="100%" stopColor="#56ab2f" />
        </linearGradient>
        <linearGradient id="ltLeaf2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c7ee8f" />
          <stop offset="100%" stopColor="#7cc95c" />
        </linearGradient>
        <linearGradient id="ltTrunk" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#a5713d" />
          <stop offset="55%" stopColor="#8a5a2e" />
          <stop offset="100%" stopColor="#6e4520" />
        </linearGradient>
        <radialGradient id="ltGlow" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      {s >= 3 && <ellipse cx="100" cy="120" rx="86" ry="80" fill="url(#ltGlow)" />}
      <ellipse cx="100" cy="228" rx={40 + s * 5} ry="8" fill="rgba(90,120,50,0.16)" />

      {s === 0 && (
        <g>
          <path d="M100 226 C100 214 99 204 100 192" stroke="#5ea732" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M100 198 C84 194 74 182 76 166 C92 168 102 180 100 198 Z" fill="url(#ltLeaf)" />
          <path d="M100 192 C116 188 126 176 124 160 C108 162 98 174 100 192 Z" fill="url(#ltLeaf2)" />
        </g>
      )}
      {s === 1 && (
        <g>
          <path d="M100 226 C100 208 99 192 100 174" stroke="#5ea732" strokeWidth="6" fill="none" strokeLinecap="round" />
          <path d="M100 202 C82 198 70 184 72 166 C90 170 102 184 100 202 Z" fill="url(#ltLeaf)" />
          <path d="M100 194 C118 190 130 176 128 158 C110 162 98 176 100 194 Z" fill="url(#ltLeaf2)" />
          <path d="M100 180 C88 170 86 156 92 144 C104 152 108 168 100 180 Z" fill="url(#ltLeaf2)" />
          <LoveHeartDot x={116} y={158} s={0.9} fill="#ffb3c6" />
        </g>
      )}
      {s === 2 && (
        <g>
          <path d="M95 226 L96 196 Q97 184 99 176 L103 176 Q104 186 105 196 L106 226 Z" fill="url(#ltTrunk)" />
          <circle cx="100" cy="154" r="27" fill="url(#ltLeaf2)" />
          <circle cx="80" cy="168" r="19" fill="url(#ltLeaf)" />
          <circle cx="121" cy="166" r="18" fill="url(#ltLeaf)" />
          <circle cx="93" cy="143" r="15" fill="#c7ee8f" opacity="0.92" />
          <LoveHeartDot x={112} y={150} s={1} />
        </g>
      )}
      {s === 3 && (
        <g>
          <path d="M93 226 L94 196 Q95 178 90 164 L100 154 L110 164 Q105 178 106 196 L107 226 Z" fill="url(#ltTrunk)" />
          <circle cx="100" cy="128" r="35" fill="url(#ltLeaf2)" />
          <circle cx="68" cy="150" r="25" fill="url(#ltLeaf)" />
          <circle cx="132" cy="148" r="26" fill="url(#ltLeaf)" />
          <circle cx="100" cy="106" r="21" fill="#c7ee8f" />
          <LoveHeartDot x={82} y={140} s={1.3} />
          <LoveHeartDot x={120} y={122} s={1.1} fill="#ffb3c6" />
          <LoveHeartDot x={100} y={158} s={0.9} fill="#ff8fae" />
        </g>
      )}
      {s === 4 && (
        <g>
          <path d="M88 226 L90 190 Q90 168 76 150 L92 136 L100 128 L108 136 L124 150 Q110 168 110 190 L112 226 Z" fill="url(#ltTrunk)" />
          <circle cx="100" cy="100" r="42" fill="url(#ltLeaf2)" />
          <circle cx="58" cy="128" r="31" fill="url(#ltLeaf)" />
          <circle cx="142" cy="126" r="32" fill="url(#ltLeaf)" />
          <circle cx="100" cy="140" r="30" fill="url(#ltLeaf)" opacity="0.95" />
          <circle cx="90" cy="80" r="19" fill="#c7ee8f" />
          <LoveHeartDot x={70} y={104} s={1.5} />
          <LoveHeartDot x={130} y={92} s={1.3} fill="#ffb3c6" />
          <LoveHeartDot x={112} y={148} s={1.2} />
          <LoveHeartDot x={86} y={62} s={1} fill="#ff8fae" />
          <circle cx="64" cy="76" r="2" fill="#fff" opacity="0.9" />
          <circle cx="146" cy="66" r="1.6" fill="#fff" opacity="0.9" />
          <circle cx="156" cy="104" r="1.8" fill="#ffe9a8" opacity="0.95" />
        </g>
      )}
    </svg>
  );
}

/** 爱情小树成长记（参考图：全屏游戏场景）——顶部悬挂木牌（等级星+进度+连续浇树）+ 草地小树（SVG 成长）+ 化肥浇水气泡 */
function TreePage({ state, waterTree, close, showToast }: { state: CoupleState; waterTree: () => void; close: () => void; showToast: (m: string) => void }) {
  const tree = state.tree;
  const level = Math.max(1, Math.min(5, Math.ceil(tree / 20) || 1));
  const inLevel = tree >= 100 ? 20 : tree - (level - 1) * 20;
  const stage = Math.min(4, Math.floor(tree / 20));
  const streak = state.treeStreak?.n ?? 0;
  const today = todayKey();
  const yesterday = todayKey(new Date(Date.now() - 86400000));
  const wateredToday = state.treeStreak?.last === today;
  const brokeStreak = !wateredToday && state.treeStreak?.last === yesterday; // 昨天浇了今天还没浇 → 断签提醒
  // TA（AI）连续浇树（第九轮：AI 会主动照顾小树）
  const taTreeStreak = useMemo(() => {
    let n = 0;
    const start = new Date();
    const hit = (d: Date) => state.taTreeStreak && state.taTreeStreak.n > 0 && state.taTreeStreak.last === todayKey(d);
    // taTreeStreak 只存最近一次：从今天起往回推（last 匹配即连续，再往前无法追溯，取 last 距今天数+1 逻辑简化）
    if (state.taTreeStreak?.last === todayKey(start)) {
      n = state.taTreeStreak.n;
    } else {
      start.setDate(start.getDate() - 1);
      if (state.taTreeStreak?.last === todayKey(start)) n = 0; // TA 昨天浇了今天还没浇
    }
    return n;
  }, [state.taTreeStreak]);
  const taWateredToday = state.taTreeStreak?.last === today;
  const [pop, setPop] = useState(0);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[linear-gradient(180deg,#bfe9fb_0%,#d8f4fd_38%,#eefaf7_62%,#dff0d0_100%)]">
      {/* ===== 场景层 ===== */}
      {/* 太阳光晕 */}
      <span aria-hidden="true" className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.9),rgba(255,255,255,0)_70%)]" />
      {/* 云朵（漂移动画） */}
      <div aria-hidden="true" className="absolute left-0 right-0 top-[130px] [animation:couple-cloud-drift_9s_ease-in-out_infinite_alternate]">
        <span className="absolute left-[6%] h-7 w-24 rounded-full bg-white/90 blur-[1px]" />
        <span className="absolute left-[10%] top-4 h-6 w-16 rounded-full bg-white/80 blur-[1px]" />
        <span className="absolute right-[16%] top-10 h-8 w-28 rounded-full bg-white/85 blur-[1px]" />
        <span className="absolute right-[22%] top-16 h-5 w-14 rounded-full bg-white/75 blur-[1px]" />
      </div>
      {/* 海鸥 */}
      <svg aria-hidden="true" viewBox="0 0 60 24" className="absolute left-[16%] top-[150px] w-9 opacity-80">
        <path d="M2 16 Q10 4 18 14 Q26 4 34 14" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <svg aria-hidden="true" viewBox="0 0 60 24" className="absolute right-[24%] top-[210px] w-6 opacity-60">
        <path d="M2 16 Q10 4 18 14 Q26 4 34 14" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      {/* 远山 */}
      <span aria-hidden="true" className="absolute -left-16 top-[46%] h-36 w-72 rounded-[50%] bg-[#cfe8c2]/80 blur-[2px]" />
      <span aria-hidden="true" className="absolute -right-20 top-[48%] h-40 w-80 rounded-[50%] bg-[#c4e2b8]/80 blur-[2px]" />
      <span aria-hidden="true" className="absolute left-1/4 top-[50%] h-28 w-64 rounded-[50%] bg-[#d8eed0]/70 blur-[2px]" />
      {/* 草地 */}
      <span aria-hidden="true" className="absolute -bottom-[26%] left-1/2 h-[62%] w-[150%] -translate-x-1/2 rounded-[50%] bg-[linear-gradient(180deg,#b5e07e,#98d15e_60%,#8cc654)] shadow-[inset_0_14px_28px_rgba(255,255,255,0.35)]" />
      <span aria-hidden="true" className="absolute -bottom-[30%] left-1/2 h-[58%] w-[120%] -translate-x-1/2 rounded-[50%] bg-[#a3d96c]/70 blur-[6px]" />
      {/* 草地小花 */}
      {[
        ['6%', '82%'], ['14%', '90%'], ['26%', '78%'], ['70%', '80%'], ['84%', '88%'], ['92%', '76%'], ['46%', '94%'],
      ].map(([l, t], i) => (
        <span key={i} aria-hidden="true" className="absolute select-none text-[10px]" style={{ left: l, top: t }}>
          {i % 2 === 0 ? '✿' : '❀'}
        </span>
      ))}
      {/* 右下角石头 LO */}
      <span aria-hidden="true" className="absolute bottom-[92px] right-3 flex h-9 w-12 rotate-6 items-center justify-center rounded-[45%_55%_50%_50%/55%_50%_50%_45%] bg-[linear-gradient(150deg,#e8e6df,#c9c6bd)] text-[10px] font-bold tracking-wider text-white shadow-[0_3px_8px_rgba(90,90,80,0.25)]">
        LO
      </span>

      {/* ===== 顶部：返回 + 悬挂木牌（整体避开状态栏 54px） ===== */}
      <div className="relative z-20 shrink-0">
        <button
          type="button"
          onClick={close}
          aria-label="返回"
          className="absolute left-3 top-[62px] z-30 flex h-10 w-10 items-center justify-center rounded-[14px] bg-[linear-gradient(180deg,#ffd94d,#ffb62e)] text-white shadow-[0_4px_10px_rgba(220,150,30,0.45)] transition-transform active:scale-95"
        >
          <ArrowLeft className="h-6 w-6" strokeWidth={3} />
        </button>
        {/* 悬挂横杆 */}
        <div className="pt-[56px]">
          <span aria-hidden="true" className="mx-auto block h-2.5 w-[240px] rounded-b-md bg-[linear-gradient(180deg,#9c6b35,#7a4e22)] shadow-sm" />
        {/* 木牌主体 */}
        <div className="mx-auto mt-1 w-[236px]">
          <div className="relative rounded-xl border-[3px] border-[#8a5a2e] bg-[linear-gradient(180deg,#c99a55,#b07f3e)] px-3 py-2 shadow-[0_6px_14px_rgba(120,80,30,0.35)]">
            {/* 顶部绿果实 */}
            <span aria-hidden="true" className="absolute -top-2 right-9 h-4 w-4 rounded-full border-2 border-[#5f8f3a] bg-[radial-gradient(circle_at_35%_30%,#b9e877,#7cb84a)] shadow-sm" />
            <div className="flex items-center gap-2">
              {/* 等级星 */}
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
                <span aria-hidden="true" className="absolute inset-0 bg-[#ffcf3e] [clip-path:polygon(50%_0%,61%_35%,98%_35%,68%_57%,79%_91%,50%_70%,21%_91%,32%_57%,2%_35%,39%_35%)] drop-shadow-[0_2px_2px_rgba(160,110,20,0.5)]" />
                <b className="relative text-[15px] font-extrabold text-[#7a5200]">{level}</b>
              </span>
              {/* 进度条 */}
              <div className="min-w-0 flex-1">
                <div className="relative h-4 overflow-hidden rounded-full border-2 border-[#7a4e22] bg-[#6e4520]">
                  <div className="h-full rounded-full bg-[linear-gradient(180deg,#ffe98a,#ffc93c)] transition-all duration-500" style={{ width: `${(inLevel / 20) * 100}%` }} />
                </div>
              </div>
              <span className="shrink-0 text-[12px] font-bold text-white drop-shadow-[0_1px_1px_rgba(90,60,20,0.6)]">{inLevel}/20</span>
            </div>
          </div>
          {/* 连续浇树小木牌 */}
          <div className="relative mx-auto -mt-1 w-[196px] rounded-lg border-[3px] border-[#8a5a2e] bg-[linear-gradient(180deg,#bd8d4a,#a5763a)] px-3 py-1.5 shadow-[0_5px_12px_rgba(120,80,30,0.3)]">
            <div className="text-[12.5px] font-bold leading-relaxed text-[#5f3d18]">
              他连续浇树 <b className="mx-1 text-[14px]">{taTreeStreak}</b> 天
            </div>
            <div className="text-[12.5px] font-bold leading-relaxed text-[#5f3d18]">
              我连续浇树 <b className="mx-1 text-[14px]">{streak}</b> 天
            </div>
          </div>
          {/* 断签提醒 */}
          {brokeStreak && (
            <button
              type="button"
              onClick={() => showToast('昨天忘浇水啦，今天补上还不断签！')}
              className="absolute -bottom-14 right-0 flex h-12 w-12 rotate-3 flex-col items-center justify-center rounded-xl bg-white shadow-[0_4px_12px_rgba(0,0,0,0.18)] [animation:couple-float-y_2.4s_ease-in-out_infinite]"
            >
              <span className="text-[8.5px] font-bold leading-none text-[#e0483a]">断签</span>
              <span className="mt-0.5 text-[10px] font-extrabold leading-none text-[#333]">昨天</span>
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#e0483a] text-[9px] font-bold text-white">✕</span>
            </button>
          )}
        </div>
        </div>
      </div>

      {/* TA 也浇过水提示（第九轮：AI 主动照顾小树） */}
      {taWateredToday && (
        <div className="absolute left-1/2 top-[122px] z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/90 px-3.5 py-1.5 text-[11.5px] font-semibold text-[#3f7d4e] shadow-[0_3px_10px_rgba(60,120,70,0.2)] backdrop-blur-sm">
          💧 TA 今天也给小树浇了水
        </div>
      )}

      {/* ===== 中部场景 ===== */}
      <div className="relative z-10 flex-1">
        {/* 左侧滑动箭头（装饰） */}
        <button
          type="button"
          onClick={() => showToast('左右滑动可以看看小树的成长变化')}
          aria-label="切换视角"
          className="absolute left-0 top-[46%] flex h-14 w-8 items-center justify-center rounded-r-2xl bg-black/15 text-white backdrop-blur-[1px] transition-opacity active:opacity-60"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* 小树 + 泥土堆（SVG 成长树） */}
        <div className="absolute bottom-[26px] left-1/2 -translate-x-1/2 text-center">
          <span key={pop} className="mx-auto block h-[218px] w-[200px] [animation:couple-pop-heart_.5s_ease-out]">
            <LoveTree stage={stage} />
          </span>
          {/* 泥土堆 */}
          <span aria-hidden="true" className="mx-auto -mt-6 block h-6 w-[92px] rounded-[50%] bg-[linear-gradient(180deg,#9a6b3d,#7c5227)] shadow-[0_4px_10px_rgba(80,50,20,0.35)]" />
          <span aria-hidden="true" className="mx-auto -mt-5 block h-3.5 w-[70px] rounded-[50%] bg-[#b07f4a]" />
        </div>

        {/* 水滴浇水按钮（点击浇水） */}
        <button
          type="button"
          onClick={() => {
            waterTree();
            setPop((p) => p + 1);
          }}
          disabled={tree >= 100}
          aria-label="用小水滴给小树浇水"
          className="absolute bottom-[146px] left-[31%] flex flex-col items-center transition-transform active:scale-[0.94] disabled:opacity-60"
        >
          <span className="relative flex h-[62px] w-[62px] items-center justify-center rounded-full bg-white/95 shadow-[0_5px_16px_rgba(90,130,60,0.3)] [animation:couple-float-y_2.6s_ease-in-out_infinite]">
            <svg viewBox="0 0 24 24" className="h-9 w-9" aria-hidden="true">
              <path d="M12 2.6 C12 2.6 5.2 10.4 5.2 15 A6.8 6.8 0 0 0 18.8 15 C18.8 10.4 12 2.6 12 2.6 Z" fill="url(#dropg)" stroke="#4f9bd2" strokeWidth="1.2" />
              <defs>
                <linearGradient id="dropg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#b5e3fa" />
                  <stop offset="1" stopColor="#6cb7e8" />
                </linearGradient>
              </defs>
              <path d="M8.8 15.2 A3.2 3.2 0 0 0 10.8 18" stroke="#ffffff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
              <circle cx="9.4" cy="12.4" r="0.9" fill="#ffffff" opacity="0.9" />
            </svg>
            {/* 气泡尾巴 */}
            <span aria-hidden="true" className="absolute -bottom-2 left-3.5 h-4 w-4 rotate-45 rounded-[3px] bg-white/95" />
          </span>
        </button>

        {/* 化肥浇水气泡 */}
        <button
          type="button"
          onClick={() => {
            waterTree();
            setPop((p) => p + 1);
          }}
          disabled={tree >= 100}
          aria-label="给小树浇水"
          className="absolute bottom-[142px] left-[56%] flex flex-col items-center transition-transform active:scale-[0.94] disabled:opacity-60"
        >
          <span className="relative flex h-[74px] w-[74px] items-center justify-center rounded-full bg-white/95 shadow-[0_5px_16px_rgba(90,130,60,0.3)]">
            {/* 化肥罐 */}
            <span className="flex h-11 w-12 items-center justify-center rounded-[10px_10px_14px_14px] bg-[linear-gradient(180deg,#c99456,#a26b32)] text-[11px] font-extrabold text-[#5f3d18] shadow-inner ring-2 ring-[#8a5a2e]/40">
              <span className="relative -mt-1 block">
                化肥
                <span aria-hidden="true" className="absolute -top-2.5 left-1/2 h-1.5 w-6 -translate-x-1/2 rounded-t-sm bg-[#7c5227]" />
              </span>
            </span>
            {/* 气泡尾巴 */}
            <span aria-hidden="true" className="absolute -bottom-2 left-4 h-4 w-4 rotate-45 rounded-[3px] bg-white/95" />
          </span>
        </button>
      </div>
    </div>
  );
}

// ---------------- 情侣轨迹：真实地图（高德瓦片代理 + WGS84→GCJ02 纠偏 + 真实距离） ----------------

const GCJ_A = 6378245;
const GCJ_EE = 0.00669342162296594323;

function gcjTransformLat(x: number, y: number): number {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return ret;
}

function gcjTransformLng(x: number, y: number): number {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return ret;
}

/** WGS84 → GCJ02（高德瓦片按 GCJ02 索引，marker 必须纠偏后才能落在正确位置；境外点原样返回） */
function wgs84ToGcj02(lat: number, lng: number): [number, number] {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lat, lng];
  let dLat = gcjTransformLat(lng - 105, lat - 35);
  let dLng = gcjTransformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lat + dLat, lng + dLng];
}

/** 球面距离 km（Haversine，WGS84 语义下的真实距离） */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function fmtKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 真实地图（情侣轨迹专用）：高德街道瓦片经 /api/map-tile 代理渲染，可拖动/滚轮/双指缩放；
 *  双方真实位置头像 marker + 相遇地点 📍 + 虚线连线与真实距离标签 */
function RealCoupleMap(props: {
  me: CouplePlace | null;
  ta: CouplePlace | null;
  meet: CouplePlace | null;
  meAvatar: string | null;
  taAvatar: string | null;
  meName: string;
  taName: string;
  fitSignal: number;
}) {
  const { me, ta, meet, meAvatar, taAvatar, meName, taName, fitSignal } = props;
  const holderRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lgRef = useRef<L.LayerGroup | null>(null);
  const viewKeyRef = useRef('');
  const dataRef = useRef(props);
  useEffect(() => {
    dataRef.current = props;
  });

  // 初始化（可拖动/缩放的真实地图）
  useEffect(() => {
    if (!holderRef.current || mapRef.current) return;
    const map = L.map(holderRef.current, {
      center: [36.2, 105.8],
      zoom: 4,
      minZoom: 3,
      maxZoom: 17,
      zoomControl: false,
      attributionControl: false,
    });
    L.tileLayer('/api/map-tile?z={z}&x={x}&y={y}', { minZoom: 3, maxZoom: 17 }).addTo(map);
    lgRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      lgRef.current = null;
      viewKeyRef.current = '';
    };
  }, []);

  // marker/连线/距离标签重绘（位置、头像、名字任一变化）
  useEffect(() => {
    const map = mapRef.current;
    const lg = lgRef.current;
    if (!map || !lg) return;
    lg.clearLayers();

    const gcjOf = (p: CouplePlace): [number, number] => wgs84ToGcj02(p.lat, p.lng);

    const avatarIcon = (avatar: string | null, name: string, tag: string) =>
      L.divIcon({
        className: '',
        iconSize: [46, 46],
        iconAnchor: [23, 40],
        html: `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
          <div style="width:44px;height:44px;border-radius:14px;overflow:hidden;background:#fff;border:3px solid #fff;box-shadow:0 6px 16px rgba(0,0,0,0.28)">${avatar ? `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover" draggable="false"/>` : ''}</div>
          <span style="max-width:96px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(255,255,255,0.96);border-radius:999px;padding:1px 8px;font-size:10px;font-weight:600;color:#3a3a40;box-shadow:0 2px 8px rgba(0,0,0,0.2)">${escHtml(name || '我')}·${tag}</span>
        </div>`,
      });

    const gMe = me ? gcjOf(me) : null;
    const gTa = ta ? gcjOf(ta) : null;

    if (gMe) L.marker(gMe, { icon: avatarIcon(meAvatar, meName, '我'), keyboard: false, zIndexOffset: 200 }).addTo(lg);
    if (gTa) L.marker(gTa, { icon: avatarIcon(taAvatar, taName, 'TA'), keyboard: false, zIndexOffset: 200 }).addTo(lg);

    if (gMe && gTa && me && ta) {
      L.polyline([gMe, gTa], { color: '#3f3f46', weight: 2.4, opacity: 0.85, dashArray: '7 8' }).addTo(lg);
      const km = haversineKm(me.lat, me.lng, ta.lat, ta.lng);
      const mid: [number, number] = [(gMe[0] + gTa[0]) / 2, (gMe[1] + gTa[1]) / 2];
      L.marker(mid, {
        keyboard: false,
        icon: L.divIcon({
          className: '',
          iconSize: [10, 10],
          html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;background:#3f3f46;color:#fff;font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;box-shadow:0 4px 12px rgba(0,0,0,0.3)">相距 ${fmtKm(km)}</div>`,
        }),
      }).addTo(lg);
    }

    if (meet) {
      L.marker(gcjOf(meet), {
        keyboard: false,
        zIndexOffset: 400,
        icon: L.divIcon({
          className: '',
          iconSize: [30, 30],
          iconAnchor: [15, 30],
          html: `<div style="display:flex;flex-direction:column;align-items:center">
            <div style="font-size:26px;line-height:1;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.3))">📍</div>
            <span style="margin-top:1px;max-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(255,255,255,0.96);border-radius:999px;padding:1px 8px;font-size:10px;font-weight:600;color:#3a3a40;box-shadow:0 2px 8px rgba(0,0,0,0.2)">相遇·${escHtml(meet.name)}</span>
          </div>`,
        }),
      }).addTo(lg);
    }

    // 视角自适应：坐标集合变化才移动（拖动/缩放不被打扰）
    const key = `${gMe?.join(',') ?? '-'}#${gTa?.join(',') ?? '-'}#${meet ? gcjOf(meet).join(',') : '-'}`;
    if (key !== viewKeyRef.current) {
      viewKeyRef.current = key;
      const pts = [gMe, gTa].filter(Boolean) as [number, number][];
      if (pts.length === 2) map.fitBounds(L.latLngBounds(pts).pad(0.3), { animate: true, maxZoom: 13 });
      else if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 9), { animate: true });
      else if (meet) map.setView(gcjOf(meet), Math.max(map.getZoom(), 10), { animate: true });
    }
  }, [me, ta, meet, meAvatar, taAvatar, meName, taName]);

  // 十字准星：回到两人中间（或单点/相遇地）
  useEffect(() => {
    if (!fitSignal) return;
    const map = mapRef.current;
    if (!map) return;
    const { me: m, ta: t, meet: mt } = dataRef.current;
    const pts = [m, t].filter(Boolean).map((p) => wgs84ToGcj02(p!.lat, p!.lng)) as [number, number][];
    if (pts.length === 2) map.fitBounds(L.latLngBounds(pts).pad(0.3), { animate: true, maxZoom: 13 });
    else if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 9), { animate: true });
    else if (mt) map.setView(wgs84ToGcj02(mt.lat, mt.lng), Math.max(map.getZoom(), 10), { animate: true });
  }, [fitSignal]);

  return (
    <div className="absolute inset-0 z-0">
      <div ref={holderRef} className="h-full w-full" style={{ background: '#e8eaed' }} />
    </div>
  );
}

/** 位置搜索行（轨迹设置弹层用）：/api/geocode 搜索 → 点选写入真实位置 */
function PlaceSearchRow({ label, current, onPick, onClear, showToast }: { label: string; current: CouplePlace | null; onPick: (p: CouplePlace) => void; onClear: () => void; showToast: (m: string) => void }) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ name: string; lat: number; lng: number; label: string }[] | null>(null);

  const doSearch = async () => {
    const t = q.trim();
    if (!t || loading) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(t)}`);
      const d = (await r.json()) as { results?: { name: string; lat: number; lng: number; label: string }[] };
      const list = Array.isArray(d?.results) ? d.results : [];
      setResults(list);
      if (list.length === 0) showToast('没找到这个地方，换个说法试试');
    } catch {
      showToast('搜索失败，稍后再试');
    }
    setLoading(false);
  };

  return (
    <div className="mt-3 rounded-2xl bg-[#f7f7f9] p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[#4a4a52]">{label}</span>
        {current ? (
          <button
            type="button"
            onClick={() => {
              onClear();
              setResults(null);
            }}
            className="flex max-w-[70%] items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11.5px] text-[#6e6e76] shadow-sm"
          >
            <MapPin className="h-3 w-3 shrink-0 text-[#8e8e96]" />
            <span className="truncate">{current.name}</span>
            <span className="shrink-0 text-[#b6b6bd]">✕</span>
          </button>
        ) : (
          <span className="text-[11.5px] text-[#b6b6bd]">未设置</span>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void doSearch();
          }}
          placeholder="搜索城市或地址，如「上海」"
          maxLength={30}
          className="h-10 flex-1 rounded-xl bg-white px-3.5 text-[14px] shadow-sm outline-none placeholder:text-[#b6b6bd]"
        />
        <button
          type="button"
          onClick={() => void doSearch()}
          className="flex h-10 w-[64px] items-center justify-center rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[13.5px] font-semibold text-white"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '搜索'}
        </button>
      </div>
      {results != null && results.length > 0 && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-white p-1 shadow-sm">
          {results.map((it, i) => (
            <button
              key={`${it.name}-${i}`}
              type="button"
              onClick={() => {
                onPick({ name: it.name, lat: it.lat, lng: it.lng });
                setResults(null);
                setQ('');
              }}
              className="block w-full rounded-lg px-3 py-2 text-left active:bg-[#f3f3f5]"
            >
              <span className="block text-[13.5px] text-[#2c2c30]">{it.name}</span>
              {it.label !== it.name && <span className="block truncate text-[11px] text-[#9a9aa2]">{it.label}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 情侣轨迹（第八轮重做）：真实地图（高德瓦片/可拖动缩放）+ 双方真实位置头像 marker + 真实距离 + 位置设置弹层 */
function TrackPage({ state, patch, days, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; days: number | null; showToast: (m: string) => void; close: () => void }) {
  const [sheet, setSheet] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);

  // 真实距离：双方都设置了真实位置才有
  const distKm = state.myLoc && state.taLoc ? haversineKm(state.myLoc.lat, state.myLoc.lng, state.taLoc.lat, state.taLoc.lng) : null;

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

      {/* 全屏真实地图（可拖动/缩放） */}
      <div className="relative flex-1 overflow-hidden">
        <RealCoupleMap
          me={state.myLoc}
          ta={state.taLoc}
          meet={state.meetLoc}
          meAvatar={state.meAvatar}
          taAvatar={state.taAvatar}
          meName={state.meName}
          taName={state.taName}
          fitSignal={fitSignal}
        />
        {/* 柔光遮罩，让悬浮卡更突出 */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.55),transparent)]" />

        {/* 顶部悬浮卡：双头像 + 心形天数 + 真实距离 */}
        <div className="absolute inset-x-3 top-3 z-10 rounded-2xl bg-white/88 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.10)] backdrop-blur-md">
          <div className="flex items-start justify-between">
            <div className="flex w-[86px] flex-col items-center gap-1">
              <span className="flex max-w-full items-center gap-0.5 text-[10px] text-[#8e8e96]">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{state.myLoc?.name || (state.meetPlace ? '' : '设置我的位置')}</span>
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
                  {distKm != null
                    ? `相距 ${fmtKm(distKm)}`
                    : state.myLoc || state.taLoc
                      ? '等 TA 也设置真实位置'
                      : days != null
                        ? '去 ⚙ 设置你们的真实位置'
                        : '设置纪念日开启轨迹'}
                </span>
              </div>
            </div>

            <div className="flex w-[86px] flex-col items-center gap-1">
              <span className="flex max-w-full items-center gap-0.5 text-[10px] text-[#8e8e96]">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{state.taLoc?.name || (state.meetPlace ? '' : '设置TA的位置')}</span>
              </span>
              <div className="h-12 w-12 overflow-hidden rounded-2xl bg-[#ececef] shadow-[0_0_0_3px_rgba(255,255,255,0.9),0_4px_12px_rgba(0,0,0,0.12)]">
                {state.taAvatar ? <img src={state.taAvatar} alt={state.taName} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={48} />}
              </div>
              <span className="max-w-full truncate text-[10px] text-[#6e6e76]">{state.taName || 'TA'}</span>
            </div>
          </div>
        </div>

        {/* 右侧工具按钮（装饰 + 设置 + 回到两人中间） */}
        <div className="absolute bottom-5 right-3 z-10 flex flex-col gap-2">
          <span className={`${toolBtn} text-[#c9a24b]`}>
            <Crown className="h-4 w-4" />
          </span>
          <span className={toolBtn}>
            <HelpCircle className="h-4 w-4" />
          </span>
          <button type="button" onClick={() => setSheet(true)} aria-label="轨迹设置" className={toolBtn}>
            <SettingsIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setFitSignal((s) => s + 1)} aria-label="回到两人中间" className={toolBtn}>
            <Crosshair className="h-4 w-4" />
          </button>
        </div>

        {/* 底部历史轨迹按钮 */}
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-6 py-2.5 text-[14px] font-semibold text-white shadow-[0_10px_26px_rgba(60,60,68,0.4)] transition-transform active:scale-[0.97]"
        >
          <MapPin className="h-4 w-4" fill="rgba(255,255,255,0.25)" />
          位置与轨迹
        </button>

        <span className="pointer-events-none absolute bottom-1.5 right-2 z-10 text-[9px] text-[#8a8f95]">恋人地图 · 真实位置</span>
      </div>

      {/* 位置与轨迹弹层 */}
      {sheet && (
        <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/35" onClick={() => setSheet(false)}>
          <div className="max-h-[76%] overflow-y-auto rounded-t-3xl bg-white px-5 pb-7 pt-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto h-1 w-10 rounded-full bg-[#e0e0e5]" />
            <div className="mt-3 text-[16px] font-bold text-[#2c2c30]">我们的轨迹</div>
            <div className="mt-1 text-[12px] text-[#9a9aa2]">
              已经一起走过 {days ?? '--'} 天{state.meetLoc?.name ? ` · 相遇在${state.meetLoc.name}` : state.meetPlace ? ` · 相遇在${state.meetPlace}` : ''}
              {distKm != null ? ` · 现在相距 ${fmtKm(distKm)}` : ''}
            </div>

            {/* 真实位置搜索（第八轮：地址 → 真实经纬度 → 真实地图 marker + 真实距离） */}
            <PlaceSearchRow
              label="我的位置"
              current={state.myLoc}
              onPick={(p) => {
                patch({ myLoc: p });
                showToast('我的位置已更新 ♡');
              }}
              onClear={() => patch({ myLoc: null })}
              showToast={showToast}
            />
            <PlaceSearchRow
              label="TA 的位置"
              current={state.taLoc}
              onPick={(p) => {
                patch({ taLoc: p });
                showToast('TA 的位置已更新 ♡');
              }}
              onClear={() => patch({ taLoc: null })}
              showToast={showToast}
            />
            <PlaceSearchRow
              label="相遇地点"
              current={state.meetLoc}
              onPick={(p) => {
                patch({ meetLoc: p, meetPlace: p.name });
                showToast('相遇地点已记录 ♡');
              }}
              onClear={() => patch({ meetLoc: null })}
              showToast={showToast}
            />

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

/** 甜蜜小问答（参考图3/4/5）：问题列表（粉色序号+圆点状态）→ 题目详情（双栏回答）→ 回答编辑；右下角 + 号自定义问题 */
function QuizHeartLine({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`flex items-center gap-2 ${className}`}>
      <span className="h-px flex-1 bg-[linear-gradient(90deg,transparent,#f3b7c6)]" />
      <Heart className="h-3.5 w-3.5 text-[#f8a8bc]" fill="#f8a8bc" strokeWidth={0} />
      <span className="h-px flex-1 bg-[linear-gradient(90deg,#f3b7c6,transparent)]" />
    </div>
  );
}

function QuizPage({ state, patch, days, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; days: number | null; showToast: (m: string) => void; close: () => void }) {
  const [view, setView] = useState<'list' | 'detail' | 'answer'>('list');
  const [cur, setCur] = useState(0);
  const [answer, setAnswer] = useState('');
  const [addSheet, setAddSheet] = useState(false);
  const [newQ, setNewQ] = useState('');

  const custom = state.quizCustom || [];
  const questions = useMemo(() => [...custom, ...QUIZ_POOL], [custom]);
  const latestByQ = useMemo(() => {
    const map: Record<string, { a: string; at: number }> = {};
    for (const r of state.quiz) if (!map[r.q] || map[r.q].at < r.at) map[r.q] = { a: r.a, at: r.at };
    return map;
  }, [state.quiz]);
  /** TA（AI）的回答（第九轮：AI 会主动回答，每题取最近一次） */
  const taByQ = useMemo(() => {
    const map: Record<string, { a: string; at: number }> = {};
    for (const r of state.quizTa ?? []) if (!map[r.q] || map[r.q].at < r.at) map[r.q] = { a: r.a, at: r.at };
    return map;
  }, [state.quizTa]);

  const q = questions[cur] ?? '';
  const my = latestByQ[q];
  const isCustom = cur < custom.length;
  const me = state.meName || '我';
  const ta = state.taName || 'TA';

  const openDetail = (i: number) => {
    setCur(i);
    setView('detail');
  };
  const startAnswer = () => {
    setAnswer(my?.a ?? '');
    setView('answer');
  };
  const saveAnswer = () => {
    const text = answer.trim();
    if (!text) return;
    patch({ quiz: [{ id: uid(), q, a: text, at: Date.now() }, ...state.quiz.filter((r) => r.q !== q)] });
    showToast('回答已记录 ♡');
    setView('detail');
  };
  const addCustom = () => {
    const t = newQ.trim();
    if (!t) return;
    patch({ quizCustom: [t, ...custom] });
    setNewQ('');
    setAddSheet(false);
    showToast('问题已添加 ♡');
    setCur(0);
    setView('detail');
  };
  const removeCustom = () => {
    patch({ quizCustom: custom.filter((x) => x !== q) });
    showToast('已删除该问题');
    setView('list');
  };

  /** 顶栏（列表/详情/回答共用）：back 行为随视图变化 */
  const TopBar = (
    <div className="relative flex h-12 shrink-0 items-center px-2">
      <button
        type="button"
        onClick={() => (view === 'list' ? close() : view === 'detail' ? setView('list') : setView('detail'))}
        aria-label="返回"
        className="flex h-9 items-center gap-0.5 rounded-full px-1.5 text-[#3a3a40] transition-opacity active:opacity-50"
      >
        <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
        {view === 'detail' && <span className="text-[15px] font-medium">题目列表</span>}
      </button>
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-bold">甜蜜小问答</div>
    </div>
  );

  /** 题目头（详情/回答共用）：大标题 + 序号信息行 */
  const QuestionHead = (
    <>
      <div className="text-[21px] font-bold leading-snug text-[#26262b]">{q}</div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-[14px]">
          <span className="text-[#9a9aa2]"># 第{cur + 1}个问题 </span>
          <span className="font-medium text-[#f78fb0]">在一起{days ?? 0}天</span>
        </div>
        <button
          type="button"
          onClick={() => showToast('小问答打印成册（演示）')}
          className="shrink-0 rounded-full bg-[linear-gradient(90deg,#ffb9cb,#ff9db8)] px-3 py-1.5 text-[12.5px] font-bold text-white shadow-[0_2px_8px_rgba(240,140,170,0.4)] transition-transform active:scale-95"
        >
          小问答打印成册
        </button>
      </div>
      <QuizHeartLine className="mt-4" />
    </>
  );

  return (
    <div className="relative flex h-full flex-col bg-[#fdfafb]">
      <div className="shrink-0 bg-[#fdfafb]/95 pt-[54px] backdrop-blur-md">{TopBar}</div>

      {/* ============ 列表视图（参考图3） ============ */}
      {view === 'list' && (
        <>
          <div className="flex shrink-0 items-center px-4 pb-1 pt-1">
            <button
              type="button"
              onClick={() => showToast('小问答打印成册（演示）')}
              className="rounded-full rounded-l-none bg-[linear-gradient(90deg,#ffb9cb,#ff9db8)] py-2 pl-5 pr-4 text-[14px] font-bold text-white shadow-[0_3px_10px_rgba(240,140,170,0.4)] transition-transform active:scale-95"
            >
              打印成册
            </button>
            <QuizHeartLine className="mx-3 flex-1" />
            <button
              type="button"
              onClick={() => showToast('每天一题，把答案留给未来的我们 ♡')}
              aria-label="说明"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#c9c9d0] transition-opacity active:opacity-50"
            >
              <Info className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-28 pt-2">
            {questions.map((item, i) => {
              const answered = !!latestByQ[item];
              return (
                <button
                  key={`${item}-${i}`}
                  type="button"
                  onClick={() => openDetail(i)}
                  className="flex w-full items-center gap-3 border-b border-[#f5e7eb] py-4 text-left transition-colors active:bg-[#fdf1f4]"
                >
                  <span className="w-9 shrink-0 text-[24px] font-light italic leading-none text-[#f5b8c6]" style={{ fontFamily: 'Georgia, serif' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="flex-1 text-[16px] font-semibold leading-snug text-[#2c2c30]">{item}</span>
                  {isCustomIndex(i, custom.length) && (
                    <span className="shrink-0 rounded-full bg-[#fdeef2] px-1.5 py-0.5 text-[9px] font-bold text-[#e88ba4]">自定义</span>
                  )}
                  <span
                    aria-hidden="true"
                    className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 ${
                      answered ? 'border-transparent bg-[linear-gradient(135deg,#ffb9cb,#ff8fae)]' : 'border-[#f3b7c6] bg-transparent'
                    }`}
                  >
                    {answered && <Heart className="h-3 w-3 text-white" fill="#ffffff" strokeWidth={0} />}
                  </span>
                </button>
              );
            })}
            <div className="pt-5 text-center text-[12px] text-[#c9b6bc]">— 每天一问 · 把甜蜜记下来 —</div>
          </div>
        </>
      )}

      {/* ============ 详情视图（参考图4） ============ */}
      {view === 'detail' && (
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 pb-28 pt-3">
          {QuestionHead}
          {/* TA 的回答（第九轮：AI 会主动回答，并知道我答了什么） */}
          <div className="mt-6">
            <div className="text-[15px] font-medium text-[#8f9fe8]">{ta}（TA）</div>
            {taByQ[q] ? (
              <>
                <div className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-[#4a4a52]" data-testid="quiz-ta-answer">
                  {taByQ[q].a}
                </div>
                <div className="mt-1.5 text-[12px] text-[#c9c9d0]">{fmtDate(taByQ[q].at)} · TA 自己主动写的</div>
              </>
            ) : (
              <div className="mt-2 text-[15px] leading-relaxed text-[#b9b9c0]">还没有回答问题哦</div>
            )}
          </div>
          {/* 我的回答 */}
          <div className="mt-7">
            <div className="text-[15px] font-medium text-[#f78fb0]">{me}（我）</div>
            {my ? (
              <>
                <div className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-[#2c2c30]">{my.a}</div>
                <div className="mt-1.5 text-[12px] text-[#c9c9d0]">{fmtDate(my.at)}</div>
                <button
                  type="button"
                  onClick={startAnswer}
                  className="mt-4 h-11 w-full rounded-full border-2 border-[#f3a0b8] text-[15px] font-semibold text-[#f06e96] transition-colors active:bg-[#fdf1f4]"
                >
                  修改我的回答
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startAnswer}
                className="mt-4 h-12 w-full rounded-full border-2 border-[#f3a0b8] text-[16px] font-semibold text-[#f06e96] transition-colors active:bg-[#fdf1f4]"
              >
                点此回答问题
              </button>
            )}
          </div>
          {isCustom && (
            <button type="button" onClick={removeCustom} className="mx-auto mt-8 block text-[13px] text-[#d3a5b1] underline underline-offset-4">
              删除这个自定义问题
            </button>
          )}
        </div>
      )}

      {/* ============ 回答视图（参考图5） ============ */}
      {view === 'answer' && (
        <div className="flex flex-1 flex-col overflow-hidden px-6 pt-3">
          {QuestionHead}
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="输入你的回答..."
            maxLength={100}
            rows={5}
            autoFocus
            className="mt-5 w-full flex-1 resize-none bg-transparent text-[16px] leading-relaxed text-[#2c2c30] outline-none placeholder:text-[#c6c6cd]"
          />
          <div className="pb-2 text-right text-[13px] text-[#c6c6cd]">{answer.length}/100</div>
          <button
            type="button"
            onClick={saveAnswer}
            disabled={!answer.trim()}
            className="mx-auto mb-8 h-[52px] w-[70%] rounded-full bg-[linear-gradient(135deg,#ffc3d4,#ff92b0)] text-[17px] font-bold text-white shadow-[0_4px_14px_rgba(240,140,170,0.45)] transition-all active:scale-[0.98] disabled:opacity-45 disabled:shadow-none"
          >
            完成
          </button>
        </div>
      )}

      {/* 右下角悬浮 + 号：自定义问题 */}
      {view !== 'answer' && (
        <button
          type="button"
          onClick={() => setAddSheet(true)}
          aria-label="自定义问题"
          className="absolute bottom-7 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ffb9cb,#ff8fae)] text-white shadow-[0_6px_18px_rgba(240,140,170,0.55)] transition-transform active:scale-90"
        >
          <Plus className="h-7 w-7" strokeWidth={2.4} />
        </button>
      )}

      {/* 自定义问题弹层 */}
      {addSheet && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 px-8" onClick={() => setAddSheet(false)}>
          <div className="w-full rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-[17px] font-bold text-[#2c2c30]">自定义问题</div>
            <QuizHeartLine className="mt-3" />
            <textarea
              value={newQ}
              onChange={(e) => setNewQ(e.target.value)}
              placeholder="写下你想和 TA 聊的问题…"
              maxLength={50}
              rows={3}
              autoFocus
              className="mt-4 w-full resize-none rounded-xl bg-[#fdf1f4] p-3.5 text-[15px] leading-relaxed outline-none placeholder:text-[#d8aab6]"
            />
            <div className="text-right text-[12px] text-[#c9c9d0]">{newQ.length}/50</div>
            <div className="mt-3 flex gap-3">
              <button type="button" onClick={() => setAddSheet(false)} className="h-11 flex-1 rounded-full bg-[#f3f3f5] text-[15px] font-medium text-[#7a7a82]">
                取消
              </button>
              <button
                type="button"
                onClick={addCustom}
                disabled={!newQ.trim()}
                className="h-11 flex-1 rounded-full bg-[linear-gradient(135deg,#ffb9cb,#ff8fae)] text-[15px] font-bold text-white disabled:opacity-45"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 判断列表序号是否为自定义问题 */
function isCustomIndex(i: number, customLen: number) {
  return i < customLen;
}

/** 未来情书信纸样式（编辑器可切换） */
const LETTER_PAPERS = [
  { key: 'default', name: '默认', bg: 'linear-gradient(180deg,#fdf8ec,#fbf2df)', line: 'rgba(196,164,116,0.55)', dashed: true, text: '#5a4a38', dark: false },
  { key: 'white', name: '纯白简约', bg: 'linear-gradient(180deg,#ffffff,#fafafb)', line: 'rgba(165,165,175,0.45)', dashed: false, text: '#3a3a40', dark: false },
  { key: 'gray', name: '浅灰格纹', bg: 'linear-gradient(180deg,#f5f5f7,#ececef)', line: 'rgba(150,150,162,0.4)', dashed: false, text: '#4a4a52', dark: false },
  { key: 'green', name: '墨绿复古', bg: 'linear-gradient(180deg,#f7f2e3,#efe5cb)', line: 'rgba(122,110,80,0.5)', dashed: true, text: '#4a4232', dark: false },
  { key: 'pink', name: '柔粉蕾丝', bg: 'linear-gradient(180deg,#fdf1f4,#fae6ec)', line: 'rgba(214,150,170,0.5)', dashed: true, text: '#7a4a58', dark: false },
  { key: 'night', name: '星夜蓝', bg: 'linear-gradient(180deg,#232633,#191c27)', line: 'rgba(185,195,225,0.32)', dashed: true, text: '#d8deee', dark: true },
];

/** 未来情书字体（编辑器字体面板） */
const LETTER_FONTS = [
  { key: 'default', name: '默认', css: '"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif' },
  { key: 'kai', name: '楷体', css: 'KaiTi,"Kaiti SC",STKaiti,serif' },
  { key: 'song', name: '宋体', css: 'SimSun,"Songti SC",STSong,serif' },
  { key: 'fang', name: '仿宋', css: 'FangSong,"Fangsong SC",STFangsong,serif' },
  { key: 'xing', name: '行楷', css: '"Xingkai SC",STXingkai,KaiTi,cursive' },
  { key: 'yuan', name: '圆体', css: '"Yuanti SC",YouYuan,"PingFang SC",sans-serif' },
];

/** 未来情书字色 */
const LETTER_COLORS = ['#4a4238', '#8a8a94', '#a13a52', '#b8860b', '#3f6b4f', '#4a5a7a', '#8a5a2e', '#5f3d8a'];

/** 星空底（未来情书）：随机星点 + 缓闪 */
function LetterStars({ count = 44 }: { count?: number }) {
  const stars = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: Math.random() * 100,
        top: Math.random() * 70,
        s: Math.random() * 1.8 + 0.6,
        o: Math.random() * 0.45 + 0.25,
        d: Math.random() * 4,
      })),
    [count],
  );
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {stars.map((st, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white [animation:couple-twinkle_3.4s_ease-in-out_infinite]"
          style={{ left: `${st.left}%`, top: `${st.top}%`, width: st.s, height: st.s, opacity: st.o, animationDelay: `${st.d}s` }}
        />
      ))}
    </div>
  );
}

/** 深夜信封（主视图插画：斜置信封 + 火漆心 + 星芒） */
function NightEnvelope() {
  return (
    <svg viewBox="0 0 210 150" className="w-[216px]" aria-hidden="true">
      <defs>
        <linearGradient id="envFace" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3d3d48" />
          <stop offset="1" stopColor="#232329" />
        </linearGradient>
      </defs>
      {/* 底下压着的信封 */}
      <rect x="16" y="30" width="168" height="100" rx="8" fill="#191920" transform="rotate(-5 100 80)" />
      <rect x="22" y="36" width="156" height="88" rx="6" fill="#202027" transform="rotate(-5 100 80)" />
      {/* 主信封 */}
      <g transform="rotate(3 105 84)">
        <rect x="25" y="36" width="160" height="94" rx="7" fill="url(#envFace)" stroke="#4d4d5a" strokeWidth="1.5" />
        <path d="M25 40 L105 94 L185 40" fill="none" stroke="#4d4d5a" strokeWidth="1.5" />
        <path d="M25 128 L88 84 M185 128 L122 84" stroke="#3c3c47" strokeWidth="1.2" opacity="0.8" />
        {/* 火漆印 */}
        <circle cx="105" cy="94" r="11.5" fill="#141419" stroke="#5d5d6c" strokeWidth="2" />
        <path d={LOVE_HEART_PATH} transform="translate(105 94) scale(1.15) translate(-4.5 -3.5)" fill="#6e6e7e" />
      </g>
      {/* 星芒 */}
      <g transform="translate(158 24)">
        <path d="M0 -13 L2.2 -2.2 L13 0 L2.2 2.2 L0 13 L-2.2 2.2 L-13 0 L-2.2 -2.2 Z" fill="#ffffff" />
        <circle r="2.6" fill="#ffffff" />
        <path d="M0 0 L34 0 M0 0 L-30 -8 M0 0 L26 -14" stroke="#ffffff" strokeWidth="0.8" opacity="0.55" />
      </g>
      <circle cx="34" cy="18" r="1.4" fill="#8a8a96" />
      <circle cx="196" cy="66" r="1.2" fill="#8a8a96" />
      <circle cx="12" cy="86" r="1.2" fill="#8a8a96" />
    </svg>
  );
}

/** 订单记录小图标（剪贴板） */
function OrderIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="5" y="4" width="14" height="17" rx="2.4" />
      <rect x="9" y="2.2" width="6" height="3.6" rx="1.2" />
      <path d="M8.6 9.5h6.8M8.6 13h6.8M8.6 16.5h4.2" />
    </svg>
  );
}

/** 未来情书（参考截图：黑色星空治愈风）—— 主视图（信封）→ 告白页 → 编辑信件（信纸/字体/虚线工具栏）→ 封存 → 订单记录 */
function LettersPage({ state, patch, close, showToast }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; close: () => void; showToast: (m: string) => void }) {
  const [view, setView] = useState<'home' | 'intro' | 'write' | 'seal' | 'box'>('home');
  const [text, setText] = useState(state.letterDraft || '');
  const [after, setAfter] = useState(30);
  const [paper, setPaper] = useState(LETTER_PAPERS[0]);
  const [font, setFont] = useState(LETTER_FONTS[0]);
  const [fontSize, setFontSize] = useState(14);
  const [color, setColor] = useState(LETTER_COLORS[0]);
  const [dashed, setDashed] = useState(true);
  const [receipt, setReceipt] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [sheet, setSheet] = useState<null | 'paper' | 'font'>(null);
  const now = Date.now();
  const arrived = (l: { at: number; openAfterDays: number }) => now >= l.at + l.openAfterDays * 86400000;
  const arriveDate = new Date(Date.now() + after * 86400000);

  /** 封存信件 */
  const sealLetter = () => {
    const t = text.trim();
    if (!t) return;
    patch({
      letters: [{ id: uid(), text: t, at: Date.now(), openAfterDays: after }, ...state.letters],
      letterDraft: '',
    });
    setText('');
    setView('box');
    showToast('情书已封存，未来会准时送达 ♡');
  };

  /** 顶部栏（深色） */
  const TopBar = ({ title, onBack }: { title: string; onBack: () => void }) => (
    <div className="relative z-30 shrink-0 pt-[54px]">
      <div className="flex h-11 items-center px-1.5">
        <button type="button" onClick={onBack} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-white/90 transition-opacity active:opacity-50">
          <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <div className="pointer-events-none absolute left-1/2 top-[54px] flex h-11 -translate-x-1/2 items-center text-[16px] font-bold text-white">{title}</div>
      </div>
    </div>
  );

  // ============ 主视图：信封 ============
  if (view === 'home') {
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-[#0a0a0d]">
        <LetterStars />
        <TopBar title="未来情书" onBack={close} />
        {/* 订单记录入口 */}
        <button
          type="button"
          onClick={() => setView('box')}
          className="relative z-20 ml-4 mt-2 flex w-14 shrink-0 flex-col items-center gap-1.5 rounded-xl py-1.5 text-white/90 transition-opacity active:opacity-60"
        >
          <OrderIcon className="h-7 w-7" />
          <span className="text-[11px] font-medium">订单记录</span>
        </button>
        {/* 信封 + 文案 */}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-9 pb-6">
          <div className="[animation:couple-float-y_5s_ease-in-out_infinite]">
            <NightEnvelope />
          </div>
          <div className="mt-12 w-full text-[20px] font-light leading-[3.4rem] tracking-wide text-[#87878f]">
            <p>把你想对他说的话</p>
            <p>写成一封信</p>
            <p>在未来的某天寄给他吧</p>
          </div>
        </div>
        {/* 底部圆形箭头 */}
        <button
          type="button"
          onClick={() => setView('intro')}
          aria-label="下一步"
          className="relative z-20 mx-auto mb-9 flex h-[62px] w-[62px] items-center justify-center rounded-full border border-white/40 transition-transform active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="#e8e8ee" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12h15M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    );
  }

  // ============ 告白视图：星尘 + 跨越时间的情书 ============
  if (view === 'intro') {
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-[#0a0a0d]">
        <LetterStars />
        {/* 星尘飘落 + 星芒爆点 */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {[18, 32, 55, 70, 84].map((left, i) => (
            <span key={i} className="absolute h-1 w-1 rounded-full bg-white [animation:couple-fall_4.6s_linear_infinite]" style={{ left: `${left}%`, top: '4%', animationDelay: `${i * 1.1}s` }} />
          ))}
          <svg viewBox="0 0 120 120" className="absolute right-[6%] top-[16%] w-44">
            <g transform="translate(66 52)">
              <path d="M0 -17 L3 -3 L17 0 L3 3 L0 17 L-3 3 L-17 0 L-3 -3 Z" fill="#ffffff" />
              <circle r="3.4" fill="#ffffff" />
              <path d="M0 0 L44 6 M0 0 L34 -18 M0 0 L40 22" stroke="#ffffff" strokeWidth="0.9" opacity="0.6" />
              {[[-30, -22], [38, -8], [-24, 26], [30, 30], [10, -30]].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={i % 2 ? 1.1 : 1.6} fill="#cfcfda" />
              ))}
            </g>
          </svg>
        </div>
        <TopBar title="未来情书" onBack={() => setView('home')} />
        <div className="relative z-10 flex flex-1 flex-col justify-end px-9 pb-14">
          <div className="text-[20px] font-light leading-[3.4rem] tracking-wide text-[#9c9ca6]">
            <p>最浪漫的告白是</p>
            <p>写给他的那封</p>
            <p>跨越时间的未来情书</p>
          </div>
          <button
            type="button"
            onClick={() => setView('write')}
            className="mx-auto mt-12 h-[52px] w-[248px] rounded-full border border-white/40 text-[16px] text-white/95 transition-transform active:scale-95"
          >
            给他写封未来情书
          </button>
          <div className="mt-3.5 text-center text-[12px] text-white/60">(纸质实物情书)</div>
        </div>
      </div>
    );
  }

  // ============ 编辑信件视图：信纸 + 工具栏 ============
  if (view === 'write') {
    const lineBg = dashed && paper.dashed !== undefined
      ? `repeating-linear-gradient(180deg, transparent 0px, transparent 30px, ${paper.line} 30px, ${paper.line} calc(30px + 1px))`
      : undefined;
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-[#101014]">
        <TopBar title="编辑信件" onBack={() => setView('home')} />
        {/* 信纸区 */}
        <div className="relative flex-1 px-3 pb-2 pt-1.5">
          <div className="relative h-full overflow-hidden rounded-md shadow-[0_8px_28px_rgba(0,0,0,0.5)]" style={{ background: paper.bg }}>
            {/* 横线 */}
            {lineBg && <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: lineBg, backgroundPosition: '0 6px' }} />}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 800))}
              placeholder="写下你想说的话…"
              className="letter-pad absolute inset-0 h-full w-full resize-none bg-transparent px-5 py-4 leading-[30px] tracking-[0.5px] outline-none"
              style={{ fontFamily: font.css, fontSize, color, caretColor: color }}
            />
            {/* 工具开关 chip */}
            <button
              type="button"
              onClick={() => setToolsOpen((v) => !v)}
              className="absolute right-2 top-2.5 z-10 rounded-md bg-[#21b357] px-2.5 py-1 text-[12.5px] font-medium text-white shadow-sm"
            >
              工具 {toolsOpen ? '˄' : '˅'}
            </button>
            {/* 右侧工具栏（虚线/手写信/字体/回执/信纸） */}
            {toolsOpen && (
              <div className="absolute right-2.5 top-12 z-10 flex flex-col gap-2.5">
                <button type="button" onClick={() => setDashed((v) => !v)} className={`h-[62px] w-9 rounded-lg text-[13px] font-bold leading-[1.15] text-white shadow-md transition-colors ${dashed ? 'bg-[#21b357]' : 'bg-[#9a9aa2]'}`} style={{ writingMode: 'vertical-rl' }}>
                  虚线
                </button>
                <button type="button" onClick={() => showToast('手写信誊写功能即将上线 ♡')} className="h-[62px] w-9 rounded-lg bg-[#9a9aa2] text-[13px] font-bold leading-[1.15] text-white shadow-md" style={{ writingMode: 'vertical-rl' }}>
                  手写信
                </button>
                <button type="button" onClick={() => setSheet('font')} className="h-[62px] w-9 rounded-lg bg-[#9a9aa2] text-[13px] font-bold leading-[1.15] text-white shadow-md" style={{ writingMode: 'vertical-rl' }}>
                  字体
                </button>
                <button type="button" onClick={() => { setReceipt((v) => !v); showToast(receipt ? '已关闭回执' : '已开启回执：TA 拆信时会通知你'); }} className={`h-[62px] w-9 rounded-lg text-[13px] font-bold leading-[1.15] text-white shadow-md transition-colors ${receipt ? 'bg-[#21b357]' : 'bg-[#9a9aa2]'}`} style={{ writingMode: 'vertical-rl' }}>
                  回执
                </button>
                <button type="button" onClick={() => setSheet('paper')} className="relative h-[62px] w-9 rounded-lg border border-[#e8cdb2] bg-[#fdf8ec] text-[13px] font-bold leading-[1.15] text-[#2f6b3f] shadow-md" style={{ writingMode: 'vertical-rl' }}>
                  信纸
                  <span aria-hidden="true" className="absolute -top-1 right-1 h-1.5 w-1.5 rounded-full bg-[#e05a6d]" />
                </button>
              </div>
            )}
            {/* 底部日期 + 页码 */}
            <div className="pointer-events-none absolute bottom-2.5 left-4 text-[12.5px]" style={{ color: paper.dark ? 'rgba(216,222,238,0.55)' : 'rgba(90,74,56,0.55)' }}>
              {`${new Date().getFullYear()}/${new Date().getMonth() + 1}/${new Date().getDate()}`}
            </div>
            <div className="pointer-events-none absolute bottom-2.5 right-4 text-[12.5px]" style={{ color: paper.dark ? 'rgba(216,222,238,0.55)' : 'rgba(90,74,56,0.55)' }}>
              当前: 第1/1页
            </div>
          </div>
        </div>
        {/* 底部操作栏 */}
        <div className="relative z-20 flex shrink-0 items-center gap-3 border-t border-white/8 bg-[#141419] px-4 pb-7 pt-3.5">
          <button
            type="button"
            onClick={() => {
              patch({ letterDraft: text });
              showToast(text.trim() ? '草稿已保存' : '已清空草稿');
            }}
            className="h-[46px] flex-1 rounded-full border border-white/25 text-[15.5px] font-medium text-white/90 transition-transform active:scale-[0.97]"
          >
            存草稿
          </button>
          <button
            type="button"
            onClick={() => {
              if (!text.trim()) {
                showToast('先写点什么吧 ♡');
                return;
              }
              patch({ letterDraft: text });
              setView('seal');
            }}
            className="h-[46px] flex-[1.6] rounded-full bg-[#21b357] text-[16px] font-bold text-white shadow-[0_4px_14px_rgba(33,179,87,0.4)] transition-transform active:scale-[0.97]"
          >
            下一步
          </button>
        </div>

        {/* 信纸选择弹层 */}
        {sheet === 'paper' && (
          <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/55" onClick={() => setSheet(null)}>
            <div className="rounded-t-2xl bg-white px-4 pb-8 pt-3 [animation:couple-sub-in_.24s_ease-out]" onClick={(e) => e.stopPropagation()}>
              <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-10 rounded-full bg-[#dcdce2]" />
              <div className="text-center text-[17px] font-bold text-[#2c2c30]">选择信纸</div>
              <div className="mt-1 text-center text-[11px] text-[#b6b6bd]">‹ 左右滑动切换风格 ›</div>
              <div className="mt-3 grid max-h-[290px] grid-cols-4 gap-3 overflow-y-auto">
                {LETTER_PAPERS.map((p) => (
                  <button key={p.key} type="button" onClick={() => { setPaper(p); setSheet(null); }} className="flex flex-col items-center gap-1.5">
                    <span
                      className={`h-[86px] w-full rounded-md border-2 shadow-sm ${paper.key === p.key ? 'border-[#21b357]' : 'border-transparent'}`}
                      style={{ background: p.bg, backgroundImage: `repeating-linear-gradient(180deg, transparent 0 12px, ${p.line} 12px 13px)` }}
                    />
                    <span className="w-full truncate text-[11.5px] text-[#5a5a62]">{p.name}</span>
                  </button>
                ))}
              </div>
              <div className="mt-4 flex gap-3">
                <button type="button" onClick={() => showToast('更多信纸即将上架 ♡')} className="h-11 flex-1 rounded-full bg-[#f0f0f3] text-[15px] font-medium text-[#5a5a62]">
                  更多信纸
                </button>
                <button type="button" onClick={() => setSheet(null)} className="h-11 flex-1 rounded-full bg-[#21b357] text-[15px] font-bold text-white">
                  完成
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 字体弹层（字体/字号/颜色） */}
        {sheet === 'font' && (
          <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/55" onClick={() => setSheet(null)}>
            <div className="max-h-[78%] overflow-y-auto rounded-t-2xl bg-white px-4 pb-8 pt-3 [animation:couple-sub-in_.24s_ease-out]" onClick={(e) => e.stopPropagation()}>
              <span aria-hidden="true" className="mx-auto mb-2 block h-1 w-10 rounded-full bg-[#dcdce2]" />
              <div className="grid grid-cols-3 gap-2.5">
                {LETTER_FONTS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFont(f)}
                    className={`rounded-lg border px-2 py-2.5 ${font.key === f.key ? 'border-[#c9a86a] bg-[#fbf5e8]' : 'border-[#e8e8ec] bg-white'}`}
                  >
                    <div className="text-[10.5px] text-[#9a9aa2]">{f.name}</div>
                    <div className="mt-0.5 text-[17px] text-[#3a3a40]" style={{ fontFamily: f.css }}>见字如面</div>
                  </button>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <span className="shrink-0 text-[14px] font-semibold text-[#3a3a40]">字号</span>
                <span className="text-[12px] text-[#b6b6bd]">A</span>
                <input type="range" min={12} max={22} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="h-1.5 flex-1 accent-[#21b357]" aria-label="字号" />
                <span className="text-[18px] font-semibold text-[#3a3a40]">A</span>
                <span className="w-8 shrink-0 rounded-full bg-[#21b357] py-0.5 text-center text-[12px] font-bold text-white">{fontSize}</span>
              </div>
              <div className="mt-4 flex items-start gap-3">
                <span className="shrink-0 pt-1.5 text-[14px] font-semibold text-[#3a3a40]">颜色</span>
                <div className="flex flex-wrap gap-2.5">
                  {LETTER_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`颜色 ${c}`}
                      onClick={() => setColor(c)}
                      className={`h-8 w-8 rounded-lg border-2 ${color === c ? 'border-[#2c2c30]' : 'border-transparent'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => setSheet(null)} className="mt-5 h-11 w-full rounded-full bg-[#21b357] text-[15px] font-bold text-white">
                完成
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============ 封存视图：选择送达时间 ============
  if (view === 'seal') {
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-[#0a0a0d]">
        <LetterStars count={30} />
        <TopBar title="封存这封信" onBack={() => setView('write')} />
        <div className="relative z-10 flex flex-1 flex-col items-center px-9 pt-8">
          <NightEnvelope />
          <div className="mt-8 text-center text-[16px] font-light leading-relaxed text-[#9c9ca6]">
            这封信将在
            <b className="mx-1.5 text-[22px] font-semibold text-white">{after}</b>
            天后
            <br />
            送达 TA 的信箱
          </div>
          <div className="mt-3 text-[13px] text-[#6e6e78]">预计 {arriveDate.getFullYear()}年{arriveDate.getMonth() + 1}月{arriveDate.getDate()}日 开启</div>
          <div className="mt-6 flex w-full gap-2.5">
            {[7, 30, 100, 365].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setAfter(d)}
                className={`h-11 flex-1 rounded-full border text-[14px] transition-colors ${after === d ? 'border-white/70 bg-white/12 font-bold text-white' : 'border-white/18 text-[#8a8a94]'}`}
              >
                {d} 天
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={sealLetter}
            className="mt-9 h-[50px] w-full rounded-full bg-[#21b357] text-[16.5px] font-bold text-white shadow-[0_6px_20px_rgba(33,179,87,0.4)] transition-transform active:scale-[0.97]"
          >
            封存这封信
          </button>
          <div className="mt-3 text-[12px] text-white/45">封存后不可修改，到时会提醒你拆开 ♡</div>
        </div>
      </div>
    );
  }

  // ============ 订单记录（信箱） ============
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#0a0a0d]">
      <LetterStars count={30} />
      <TopBar title="订单记录" onBack={() => setView('home')} />
      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-10 pt-2">
        {state.letters.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <NightEnvelope />
            <p className="mt-6 text-[15px] text-[#87878f]">还没有寄出的信</p>
            <p className="mt-1.5 text-[13px] text-[#5d5d66]">去写第一封跨越时间的情书吧</p>
            <button type="button" onClick={() => setView('write')} className="mt-6 h-11 rounded-full border border-white/35 px-8 text-[14.5px] text-white/90">
              去写信
            </button>
          </div>
        )}
        <div className="space-y-4">
          {state.letters.map((l) => {
            const open = arrived(l);
            const remain = Math.max(1, Math.ceil((l.at + l.openAfterDays * 86400000 - now) / 86400000));
            return (
              <div key={l.id} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] text-[#87878f]">
                    {fmtDate(l.at)} 寄出 · {l.openAfterDays} 天后开启
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium ${open ? 'bg-[#21b357] text-white' : 'bg-white/10 text-[#9c9ca6]'}`}>
                    {open ? '可拆信' : `还剩 ${remain} 天`}
                  </span>
                </div>
                {open ? (
                  <div className="mt-3 whitespace-pre-wrap rounded-xl bg-[#fdf8ec] p-3.5 text-[15px] leading-relaxed text-[#4a4238]">{l.text}</div>
                ) : (
                  <div className="mt-3 flex items-center gap-2.5 text-[13.5px] italic text-[#6e6e78]">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                      <rect x="3" y="6" width="18" height="13" rx="2.4" />
                      <path d="M3.5 7.5 12 13.5 20.5 7.5" />
                    </svg>
                    这封信还在时间的路上
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {state.letters.length > 0 && (
          <button
            type="button"
            onClick={() => setView('write')}
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-white/25 text-[15px] text-white/90"
          >
            <Plus className="h-4.5 w-4.5" strokeWidth={2} />
            再写一封
          </button>
        )}
      </div>
    </div>
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
    const selLabel = MOOD_LIST.find((m) => m.emoji === mood)?.label;
    return (
      <SubShell title="心情日记" onBack={() => setView('cal')}>
        <div className="mt-3 rounded-2xl bg-white px-4 pb-4 pt-4 shadow-[0_6px_18px_rgba(0,0,0,0.05)]">
          {/* 日期头 */}
          <div className="flex items-baseline gap-2 border-b border-black/[0.05] pb-3">
            <span className="text-[22px] font-bold leading-none text-[#2c2c30]">{isToday ? '今天' : selDate}</span>
            <span className="text-[12px] text-[#9a9aa2]">{sm}月,{sy}</span>
          </div>

          {/* 当前选中心情大表情（蜡笔涂鸦风） */}
          <div className="mt-4 flex justify-center">
            <MoodFace mood={mood} size={78} className={mood ? 'drop-shadow-[0_6px_14px_rgba(0,0,0,0.12)]' : 'opacity-55'} />
          </div>
          <div className="mt-1.5 text-center text-[11.5px] font-medium text-[#8e8e96]">{mood ? `今天很${selLabel}` : '选一个心情，开始记录今天'}</div>

          {/* 心情选择圈 */}
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {MOOD_LIST.map((m) => (
              <button
                key={m.label}
                type="button"
                onClick={() => setMood(m.emoji)}
                aria-pressed={mood === m.emoji}
                className={`flex flex-col items-center gap-1 rounded-2xl py-2 transition-all ${mood === m.emoji ? 'bg-[#f1f1f4] shadow-[inset_0_1px_4px_rgba(0,0,0,0.06)]' : 'active:bg-[#f6f6f8]'}`}
              >
                <MoodFace mood={m.emoji} size={38} className={mood === m.emoji ? '[animation:couple-pop-heart_.4s_ease-out]' : 'opacity-90'} />
                <span className={`text-[10px] ${mood === m.emoji ? 'font-semibold text-[#3c3c42]' : 'text-[#8e8e96]'}`}>{m.label}</span>
              </button>
            ))}
          </div>

          {/* 正文（无框直书） */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="今天想写些什么"
            maxLength={300}
            rows={4}
            className="mt-3 w-full resize-none bg-transparent px-1 text-[15px] leading-relaxed outline-none placeholder:text-[#c2c2c9]"
          />

          {/* 照片 tile */}
          <div className="mt-1 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => (photo ? setPhoto(null) : photoInput.current?.click())}
              className="relative flex h-[84px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#f3f3f5] text-[#b6b6bd] transition-opacity active:opacity-70"
              aria-label={photo ? '移除照片' : '添加照片'}
            >
              {photo ? (
                <>
                  <img src={photo} alt="心情照片" className="h-full w-full object-cover" draggable={false} />
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/45 text-white">✕</span>
                </>
              ) : (
                <ImagePlus className="h-6 w-6" strokeWidth={1.6} />
              )}
            </button>
            <span className="text-[11.5px] leading-relaxed text-[#b6b6bd]">{photo ? '点击照片可移除' : '配一张今天的照片吧'}</span>
          </div>

          {/* 位置行 */}
          <div className="mt-3 flex items-center gap-2 rounded-full bg-[#f5f5f7] py-2.5 pl-4 pr-3">
            <MapPin className="h-4 w-4 shrink-0 text-[#8e8e96]" />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-[#4a4a52]">{state.meetPlace || '还没有相遇地点'}</span>
            {state.meetPlace && (
              <button
                type="button"
                onClick={() => {
                  patch({ meetPlace: '' });
                  showToast('已清除地点，可在情侣轨迹重新设置');
                }}
                aria-label="清除地点"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#dcdce1] text-[11px] leading-none text-white"
              >
                ✕
              </button>
            )}
            <ChevronRight className="h-4 w-4 shrink-0 text-[#c2c2c9]" />
          </div>
        </div>

        {/* 吸底完成按钮 */}
        <button
          type="button"
          onClick={saveMood}
          className="sticky bottom-4 z-10 mb-3 mt-5 h-12 w-full rounded-full bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(60,60,68,0.28)] transition-transform active:scale-[0.98]"
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
  const monthPrefix = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;
  const monthCount = state.moods.filter((m) => (m.dateKey || fmtDate(m.at)).startsWith(monthPrefix)).length;

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
      {/* 月份切换（胶囊卡） */}
      <div className="mt-2 flex justify-center">
        <div className="flex items-center gap-3.5 rounded-full bg-white px-3.5 py-1.5 shadow-[0_4px_14px_rgba(0,0,0,0.06)]">
          <button
            type="button"
            aria-label="上个月"
            onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { ...c, m: c.m - 1 }))}
            className="flex h-6.5 w-6.5 items-center justify-center rounded-full bg-[#f0f0f3] p-1 text-[#6e6e76] transition-opacity active:opacity-60"
          >
            <ChevronRight className="h-3.5 w-3.5 rotate-180" />
          </button>
          <span className="min-w-[88px] text-center text-[16px] font-bold tracking-wide text-[#2c2c30]">
            {cursor.y}.{String(cursor.m + 1).padStart(2, '0')}
          </span>
          <button
            type="button"
            aria-label="下个月"
            onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 }))}
            className="flex h-6.5 w-6.5 items-center justify-center rounded-full bg-[#f0f0f3] p-1 text-[#6e6e76] transition-opacity active:opacity-60"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 本月记录数 */}
      <div className="mt-2.5 flex justify-center">
        <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] text-[#8e8e96] shadow-[0_3px_10px_rgba(0,0,0,0.05)]">
          本月记录 <b className="text-[#3c3c42]">{monthCount}</b> 篇心情
        </span>
      </div>

      {/* 日历卡片 */}
      <div className="mt-2.5 rounded-2xl bg-white/92 p-3 shadow-[0_6px_18px_rgba(0,0,0,0.05)] backdrop-blur-sm">
        {/* 星期表头（周一起始） */}
        <div className="grid grid-cols-7 text-center text-[10.5px] text-[#a9a9b2]">
          {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        {/* 日期格子 */}
        <div className="mt-2 grid grid-cols-7 gap-y-1.5">
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
                className="flex h-[60px] flex-col items-center justify-start pt-0.5 transition-transform active:scale-[0.94]"
              >
                <span className={`text-[10.5px] leading-none ${cell.key === todayK ? 'font-bold text-[#2c2c30]' : 'text-[#6e6e76]'}`}>{cell.d}</span>
                {byDay[cell.key] ? (
                  <span className={`mt-1 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)] ${cell.key === todayK ? 'ring-2 ring-[#5c5c64]' : 'ring-1 ring-[#ececef]'}`}>
                    <MoodFace mood={byDay[cell.key][byDay[cell.key].length - 1].emoji} size={30} />
                  </span>
                ) : (
                  <span className={`mt-1 h-8 w-8 rounded-full border border-dashed ${cell.key === todayK ? 'border-[#b9b9c1] bg-white/70' : 'border-[#e4e4e9]'}`} />
                )}
                {cell.key === todayK && <span className="mt-0.5 text-[8.5px] font-semibold leading-none text-[#8e8e96]">今天</span>}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="mt-3.5 text-center text-[14px] font-medium text-[#4a4a52]">Hi，你今天的心情怎么样？</div>

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
          <div className="space-y-2 pb-2">
            {recent.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setDaySheet(m.dateKey || fmtDate(m.at))}
                className="flex w-full items-start gap-3 rounded-2xl bg-white p-3 text-left shadow-[0_4px_12px_rgba(0,0,0,0.05)]"
              >
                <span className="shrink-0"><MoodFace mood={m.emoji} size={38} /></span>
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
                    <span className="shrink-0"><MoodFace mood={m.emoji} size={34} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] leading-relaxed text-[#2c2c30]">{m.text || '（没说话，就是心情不好不坏）'}</div>
                      {m.photo && <img src={m.photo} alt="心情照片" className="mt-2 max-h-40 w-full rounded-xl object-cover" draggable={false} />}
                    </div>
                    {m.from === 'ta' && (
                      <span className="shrink-0 rounded-full bg-[#eef2fd] px-2 py-0.5 text-[10px] font-bold text-[#7f96e0]">TA 写的</span>
                    )}
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

/** 100 件小事（手账拼贴风）：标题牌 + 拍立得卡片 + 待完成/已完成邮戳 */
/** 100 件小事（参考图1/2）：粉色手账拼贴 + 拍立得卡片墙（翻页）+ 待完成印章 + 目录/添加小事 + 编辑详情页 */
const HUNDRED_ROT = ['-rotate-[1.6deg]', 'rotate-[1.1deg]', '-rotate-[0.6deg]', 'rotate-[1.5deg]'];

/** 卡通表情（豆豆眼 + 小嘴 + 腮红） */
function KawaiiFace({ x, y, s = 1, tone = '#8a626e' }: { x: number; y: number; s?: number; tone?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle cx="-3" cy="0" r="1.05" fill={tone} />
      <circle cx="3" cy="0" r="1.05" fill={tone} />
      <path d="M-1.3 2.4 Q0 3.8 1.3 2.4" stroke={tone} strokeWidth="0.8" fill="none" strokeLinecap="round" />
      <ellipse cx="-5.8" cy="1.8" rx="1.5" ry="0.9" fill="#f7b8c4" opacity="0.75" />
      <ellipse cx="5.8" cy="1.8" rx="1.5" ry="0.9" fill="#f7b8c4" opacity="0.75" />
    </g>
  );
}

/** 手账插画（参考图1风格：软萌 SVG 小插画，替代 emoji；kind 见 HUNDRED_KIND_COUNT） */
const HUNDRED_KIND_COUNT = 54;
function ScrapIllus({ kind, className = '' }: { kind: number; className?: string }) {
  const k = ((kind % HUNDRED_KIND_COUNT) + HUNDRED_KIND_COUNT) % HUNDRED_KIND_COUNT;
  return (
    <svg viewBox="0 0 100 70" className={className} aria-hidden="true">
      {k === 0 && (
        /* 用情侣头像：两颗带脸的爱心 */
        <g>
          <ellipse cx="50" cy="61" rx="36" ry="6" fill="#f3dbe2" opacity="0.7" />
          <path d={LOVE_HEART_PATH} transform="translate(31 24) scale(4.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <KawaiiFace x={31} y={26} s={1.5} />
          <path d={LOVE_HEART_PATH} transform="translate(67 28) scale(3.4) translate(-4.5 -3.5)" fill="#f7c3d0" />
          <KawaiiFace x={67} y={29} s={1.2} />
          <circle cx="18" cy="16" r="1.6" fill="#f3c8d3" />
          <circle cx="84" cy="14" r="1.2" fill="#f3c8d3" />
        </g>
      )}
      {k === 1 && (
        /* 一起看电影：爆米花桶 + 饮料杯 */
        <g>
          <g transform="translate(35 32)">
            <circle cx="-8" cy="-9" r="5" fill="#fbdce4" />
            <circle cx="0" cy="-12" r="6" fill="#fce8ee" />
            <circle cx="8" cy="-9" r="5" fill="#fbdce4" />
            <path d="M-13 -6 L13 -6 L10 26 L-10 26 Z" fill="#fff" stroke="#eec3cf" strokeWidth="1.5" />
            <path d="M-6 -6 L-4.5 26" stroke="#f2a9bc" strokeWidth="3.2" />
            <path d="M6 -6 L4.5 26" stroke="#f2a9bc" strokeWidth="3.2" />
            <KawaiiFace x={0} y={9} s={1.1} />
          </g>
          <g transform="translate(68 34)">
            <rect x="-2.6" y="-19" width="2.6" height="14" rx="1.3" fill="#e8988a" transform="rotate(14 -1 -12)" />
            <path d="M-10 -7 L10 -7 L7.6 25 L-7.6 25 Z" fill="#f9c8a8" stroke="#efb08c" strokeWidth="1.2" />
            <ellipse cx="0" cy="-7" rx="10" ry="2.6" fill="#f4b28a" />
            <KawaiiFace x={0} y={7} s={1} />
          </g>
        </g>
      )}
      {k === 2 && (
        /* 第一次合照的照片：拍立得相框 + 双心 */
        <g transform="rotate(-4 50 35)">
          <rect x="22" y="11" width="54" height="46" rx="3" fill="#fdf6ee" stroke="#e8cdb2" strokeWidth="2.4" />
          <rect x="29" y="18" width="40" height="31" rx="2" fill="#fbe3e9" />
          <path d={LOVE_HEART_PATH} transform="translate(44 33) scale(2.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <path d={LOVE_HEART_PATH} transform="translate(57 36) scale(1.7) translate(-4.5 -3.5)" fill="#f7c3d0" />
          <circle cx="72" cy="13" r="2.6" fill="#f2a9bc" opacity="0.85" />
        </g>
      )}
      {k === 3 && (
        /* 互穿对方衣服拍照：两件小衣服 */
        <g>
          <g transform="translate(32 38)">
            <path d="M-12 -10 L-5 -14 L0 -10.5 L5 -14 L12 -10 L15 -2 L10 -0.5 L10 14 L-10 14 L-10 -0.5 L-15 -2 Z" fill="#fdf3e3" stroke="#ecd9b8" strokeWidth="1.5" />
            <path d="M-5 -14 L0 -10.5 L5 -14" fill="none" stroke="#e8c9a0" strokeWidth="1.2" />
            <KawaiiFace x={0} y={2} s={1} />
          </g>
          <g transform="translate(68 40)">
            <path d="M-8 -13 L8 -13 L10 -7 L7 -7 L11 12 L-11 12 L-7 -7 L-10 -7 Z" fill="#fdeff3" stroke="#f3c6d3" strokeWidth="1.5" />
            <path d="M-8 -13 L8 -13" stroke="#f3c6d3" strokeWidth="3.4" strokeLinecap="round" />
            <KawaiiFace x={0} y={-1} s={0.95} />
          </g>
        </g>
      )}
      {k === 4 && (
        /* 连麦睡觉：小床 + 枕头 + 心 */
        <g>
          <rect x="14" y="30" width="9" height="22" rx="3" fill="#e8cdb2" />
          <rect x="20" y="36" width="62" height="15" rx="4" fill="#fdf0e2" stroke="#ecd5bc" strokeWidth="1.4" />
          <ellipse cx="37" cy="34.5" rx="9" ry="4.6" fill="#fff" stroke="#e8d5c8" strokeWidth="1" />
          <path d="M24 44 Q52 50 80 42 L80 51 L24 51 Z" fill="#f6cdd9" opacity="0.9" />
          <path d={LOVE_HEART_PATH} transform="translate(64 28) scale(1.8) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <text x="74" y="18" fontSize="9" fontWeight="bold" fill="#c9a9b2">z z</text>
        </g>
      )}
      {k === 5 && (
        /* 一起看日出：山间朝阳 */
        <g>
          <circle cx="50" cy="34" r="13" fill="#ffd98a" />
          <path d="M50 21 A13 13 0 0 1 50 47 Z" fill="#ffca6e" opacity="0.7" />
          <path d="M12 47 Q30 34 50 46 Q72 34 88 47 L88 56 L12 56 Z" fill="#f3b8c8" opacity="0.8" />
          <path d="M22 47 L26 42 M50 44 L54 40 M72 46 L76 42" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
        </g>
      )}
      {k === 6 && (
        /* 牵手压马路：脚印与爱心路 */
        <g>
          <path d="M10 52 Q35 40 50 48 Q70 58 88 40" stroke="#eec3cf" strokeWidth="3" strokeDasharray="5 5" fill="none" strokeLinecap="round" />
          <ellipse cx="34" cy="26" rx="4.5" ry="6" fill="#f2a9bc" transform="rotate(-14 34 26)" />
          <circle cx="30.5" cy="34" r="1.8" fill="#f2a9bc" />
          <ellipse cx="56" cy="20" rx="4.5" ry="6" fill="#f7c3d0" transform="rotate(12 56 20)" />
          <circle cx="59.5" cy="28" r="1.8" fill="#f7c3d0" />
          <path d={LOVE_HEART_PATH} transform="translate(70 30) scale(1.6) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 7 && (
        /* 雨天共撑一把伞 */
        <g>
          <path d="M22 32 Q50 8 78 32 Z" fill="#f2a9bc" />
          <path d="M36 32 Q50 12 50 12 M64 32 Q50 12 50 12" stroke="#fff" strokeWidth="1.4" opacity="0.6" fill="none" />
          <path d="M50 32 L50 50 Q50 56 44 55" stroke="#d9899d" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M20 44 l-2.4 5 M32 48 l-2.4 5 M74 44 l-2.4 5 M84 50 l-2.4 5" stroke="#a8c8e8" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
      {k === 8 && (
        /* 一起做一顿晚饭：平底锅 + 爱心蛋 */
        <g>
          <ellipse cx="52" cy="40" rx="30" ry="14" fill="#5f5f66" />
          <ellipse cx="52" cy="38" rx="24" ry="10" fill="#4a4a50" />
          <ellipse cx="52" cy="38" rx="13" ry="7" fill="#fff" />
          <path d={LOVE_HEART_PATH} transform="translate(52 37) scale(1.3) translate(-4.5 -3.5)" fill="#ffd98a" />
          <path d="M82 38 L96 34" stroke="#5f5f66" strokeWidth="5" strokeLinecap="round" />
          <circle cx="24" cy="20" r="1.6" fill="#f3c8d3" />
        </g>
      )}
      {k === 9 && (
        /* 一起唱一首歌：音符与小心心 */
        <g>
          <circle cx="32" cy="50" r="6" fill="#f2a9bc" />
          <rect x="36.4" y="22" width="2.6" height="28" fill="#e88ba4" />
          <path d="M39 22 Q50 24 50 32 Q46 26 39 27 Z" fill="#e88ba4" />
          <circle cx="66" cy="44" r="5" fill="#f7c3d0" />
          <rect x="69.6" y="20" width="2.4" height="24" fill="#efb0c4" />
          <path d={LOVE_HEART_PATH} transform="translate(84 26) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <path d="M14 22 Q18 18 22 22" stroke="#f3c8d3" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 10 && (
        /* 互送礼物：礼物盒 */
        <g>
          <rect x="28" y="28" width="44" height="30" rx="3" fill="#fbdce4" stroke="#f2a9bc" strokeWidth="1.6" />
          <rect x="24" y="20" width="52" height="11" rx="3" fill="#f2a9bc" />
          <rect x="47" y="20" width="6" height="38" fill="#fff" opacity="0.85" />
          <path d="M50 20 C42 8 30 12 36 19 C40 23 46 21 50 20 Z" fill="none" stroke="#e88ba4" strokeWidth="2" />
          <path d="M50 20 C58 8 70 12 64 19 C60 23 54 21 50 20 Z" fill="none" stroke="#e88ba4" strokeWidth="2" />
        </g>
      )}
      {k === 11 && (
        /* 一起去看海：海浪小帆船 */
        <g>
          <circle cx="76" cy="18" r="7" fill="#ffd98a" />
          <path d="M44 14 L44 34 L62 34 Z" fill="#fff" stroke="#e8cdb2" strokeWidth="1.2" />
          <path d="M42 14 L42 34" stroke="#d9899d" strokeWidth="2" />
          <path d="M36 36 L52 36 L48 42 L40 42 Z" fill="#f2a9bc" />
          <path d="M8 48 Q20 42 32 48 Q44 54 56 48 Q68 42 80 48 Q88 52 94 49" stroke="#8fc3e8" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M12 56 Q26 51 40 56 Q56 61 70 56 Q82 52 92 56" stroke="#b3d9f2" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 12 && (
        /* 数流星许愿：月亮星星 */
        <g>
          <path d="M62 12 A17 17 0 1 0 78 38 A13.5 13.5 0 0 1 62 12 Z" fill="#ffd98a" />
          <path d="M20 16 L23 24 L31 26 L23 29 L20 37 L17 29 L9 26 L17 24 Z" fill="#f7c3d0" />
          <path d="M38 40 L40 45 L45 46.5 L40 48 L38 53 L36 48 L31 46.5 L36 45 Z" fill="#f2a9bc" />
          <path d="M14 52 l6 -3" stroke="#f3c8d3" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      )}
      {k === 13 && (
        /* 奶茶约会：两杯奶茶 */
        <g>
          <g transform="translate(36 34)">
            <path d="M-11 -10 L11 -10 L8.5 24 L-8.5 24 Z" fill="#fdf0e2" stroke="#ecd5bc" strokeWidth="1.4" />
            <path d="M-11 -10 L11 -10 L10.4 -2 L-10.4 -2 Z" fill="#f2d8b8" />
            <circle cx="-3" cy="18" r="2.2" fill="#c99a6a" />
            <circle cx="3" cy="21" r="2.2" fill="#c99a6a" />
            <KawaiiFace x={0} y={8} s={0.95} />
          </g>
          <g transform="translate(66 37)">
            <path d="M-9 -8 L9 -8 L7 20 L-7 20 Z" fill="#fdeff3" stroke="#f3c6d3" strokeWidth="1.4" />
            <ellipse cx="0" cy="-8" rx="9" ry="2.2" fill="#f3c6d3" />
            <KawaiiFace x={0} y={5} s={0.85} />
          </g>
        </g>
      )}
      {k === 14 && (
        /* 一起挑戏指环 */
        <g>
          <circle cx="50" cy="42" r="16" fill="none" stroke="#ffd98a" strokeWidth="5" />
          <circle cx="50" cy="42" r="16" fill="none" stroke="#f2c14e" strokeWidth="1.6" opacity="0.7" />
          <path d={LOVE_HEART_PATH} transform="translate(50 20) scale(1.9) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <circle cx="43" cy="16" r="1.4" fill="#f3c8d3" />
          <circle cx="59" cy="14" r="1" fill="#f3c8d3" />
        </g>
      )}
      {k === 15 && (
        /* 一起种一盆植物：小花盆 */
        <g>
          <path d="M34 40 L66 40 L62 58 L38 58 Z" fill="#f2a9bc" />
          <rect x="32" y="36" width="36" height="7" rx="2.5" fill="#e88ba4" />
          <path d="M50 36 L50 18" stroke="#5ea732" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M50 24 C42 22 38 16 40 10 C48 12 52 18 50 24 Z" fill="#8ed86e" />
          <path d="M50 20 C58 18 62 12 60 6 C52 8 48 14 50 20 Z" fill="#a8e063" />
          <path d={LOVE_HEART_PATH} transform="translate(76 22) scale(1.3) translate(-4.5 -3.5)" fill="#f7c3d0" />
        </g>
      )}
      {k === 16 && (
        /* 洗碗/泡脚：木桶 + 泡泡 */
        <g>
          <path d="M28 30 L72 30 L67 56 Q50 61 33 56 Z" fill="#e8c9a0" stroke="#d3ab7e" strokeWidth="1.6" />
          <path d="M31 40 L69 40 M33 49 L67 49" stroke="#d3ab7e" strokeWidth="1.4" opacity="0.7" />
          <rect x="26" y="25" width="48" height="8" rx="3.5" fill="#f2d8b8" stroke="#d3ab7e" strokeWidth="1.4" />
          <circle cx="34" cy="14" r="4.5" fill="#fff" stroke="#cfe4ef" strokeWidth="1.2" />
          <circle cx="48" cy="8" r="5.5" fill="#fff" stroke="#cfe4ef" strokeWidth="1.2" />
          <circle cx="62" cy="13" r="4" fill="#fff" stroke="#cfe4ef" strokeWidth="1.2" />
          <circle cx="73" cy="20" r="2.6" fill="#fff" stroke="#cfe4ef" strokeWidth="1" />
          <circle cx="22" cy="21" r="2.4" fill="#fff" stroke="#cfe4ef" strokeWidth="1" />
          <path d={LOVE_HEART_PATH} transform="translate(50 45) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 17 && (
        /* 互相喂对方吃水果：双果 */
        <g>
          <circle cx="34" cy="40" r="13" fill="#f2a9bc" />
          <path d="M34 27 Q33 19 40 17" stroke="#5ea732" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path d="M34 27 C28 21 21 23 21 23 C23 29 30 30 34 27 Z" fill="#8ed86e" />
          <KawaiiFace x={34} y={40} s={1.1} />
          <circle cx="66" cy="42" r="11" fill="#ffd98a" />
          <path d="M66 31 L66 53 M55 42 L77 42 M58 34 L74 50 M74 34 L58 50" stroke="#f2b45c" strokeWidth="1.3" />
          <circle cx="66" cy="42" r="11" fill="none" stroke="#f2b45c" strokeWidth="1.4" />
          <path d={LOVE_HEART_PATH} transform="translate(50 16) scale(1.5) translate(-4.5 -3.5)" fill="#f7c3d0" />
        </g>
      )}
      {k === 18 && (
        /* 唱歌/K歌：麦克风 */
        <g>
          <circle cx="46" cy="22" r="12" fill="#c9c9d2" stroke="#9e9ea8" strokeWidth="1.6" />
          <path d="M38 17 h16 M37 22 h18 M39 27 h14" stroke="#8e8e96" strokeWidth="1.3" />
          <rect x="40" y="32" width="12" height="22" rx="6" fill="#e88ba4" />
          <path d="M36 44 Q28 48 30 58 M56 44 Q64 48 62 58" stroke="#f3c8d3" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <circle cx="74" cy="30" r="3" fill="#f2a9bc" />
          <rect x="75.6" y="14" width="2" height="16" fill="#e88ba4" />
          <path d={LOVE_HEART_PATH} transform="translate(84 14) scale(1.3) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 19 && (
        /* 一起敷面膜：脸 + 面膜 */
        <g>
          <ellipse cx="50" cy="38" rx="19" ry="22" fill="#fce4d4" />
          <path d="M31 38 Q31 15 50 15 Q69 15 69 38 L63 42 Q57 35 53 41 Q50 45 47 41 Q43 35 37 42 Z" fill="#ffffff" opacity="0.94" stroke="#e3e3ea" strokeWidth="1" />
          <circle cx="42" cy="33" r="2.2" fill="#5a5a62" />
          <circle cx="58" cy="33" r="2.2" fill="#5a5a62" />
          <path d="M46 46 Q50 49 54 46" stroke="#8a626e" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <ellipse cx="39" cy="42" rx="2.6" ry="1.5" fill="#f7b8c4" opacity="0.8" />
          <ellipse cx="61" cy="42" rx="2.6" ry="1.5" fill="#f7b8c4" opacity="0.8" />
          <path d={LOVE_HEART_PATH} transform="translate(82 20) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 20 && (
        /* 帮对方吹头发：吹风机 */
        <g>
          <rect x="18" y="22" width="32" height="23" rx="10" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.6" />
          <path d="M50 26 L68 21 L68 46 L50 41 Z" fill="#f2a9bc" stroke="#efb0c4" strokeWidth="1.4" />
          <circle cx="32" cy="33" r="6.5" fill="#fff" opacity="0.85" />
          <circle cx="32" cy="33" r="3" fill="#fbdce4" />
          <path d="M72 24 l9 -3 M74 33 l10 0 M72 42 l9 3" stroke="#a8c8e8" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 52 h9 M10 58 h11" stroke="#a8c8e8" strokeWidth="1.8" strokeLinecap="round" />
          <path d={LOVE_HEART_PATH} transform="translate(24 56) scale(1.2) translate(-4.5 -3.5)" fill="#f7c3d0" />
        </g>
      )}
      {k === 21 && (
        /* 堆雪人/打雪仗：雪人 */
        <g>
          <circle cx="46" cy="46" r="15" fill="#fff" stroke="#dfe4ec" strokeWidth="1.6" />
          <circle cx="48" cy="24" r="11" fill="#fff" stroke="#dfe4ec" strokeWidth="1.6" />
          <circle cx="44.5" cy="22" r="1.4" fill="#5a5a62" />
          <circle cx="51.5" cy="22" r="1.4" fill="#5a5a62" />
          <path d="M45 27 Q48 30 51 27" stroke="#e88ba4" strokeWidth="1.3" fill="none" strokeLinecap="round" />
          <rect x="41" y="11" width="14" height="3.2" rx="1.6" fill="#5a5a62" />
          <rect x="44" y="4" width="8" height="8" rx="1.6" fill="#5a5a62" />
          <path d="M36 42 Q29 44 25 39" stroke="#8a5a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="72" cy="16" r="1.6" fill="#dfe4ec" />
          <circle cx="82" cy="28" r="1.2" fill="#dfe4ec" />
          <circle cx="70" cy="34" r="1.2" fill="#dfe4ec" />
          <path d={LOVE_HEART_PATH} transform="translate(78 50) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 22 && (
        /* 夏天吃冰淇淋：甜筒 */
        <g>
          <path d="M37 30 L63 30 L53 62 Q50 66 47 62 Z" fill="#f2d8b8" stroke="#d3ab7e" strokeWidth="1.4" />
          <path d="M42 37 L57 46 M42 46 L55 37 M45 52 L55 44" stroke="#e3bd90" strokeWidth="1.2" />
          <circle cx="41" cy="24" r="9" fill="#f7c3d0" />
          <circle cx="59" cy="24" r="9" fill="#f2a9bc" />
          <circle cx="50" cy="17" r="8.5" fill="#fce3ea" />
          <circle cx="50" cy="7" r="3" fill="#e8647a" />
          <path d="M50 10 L50 14" stroke="#8a5a2e" strokeWidth="1.2" />
          <circle cx="78" cy="16" r="1.4" fill="#f3c8d3" />
        </g>
      )}
      {k === 23 && (
        /* 一起吃火锅：小锅 + 热气 */
        <g>
          <path d="M50 16 Q47 10 52 7 M62 20 Q59 14 64 11" stroke="#c9c9d2" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.85" />
          <path d="M23 34 L23 48 Q23 53 29 53 L71 53 Q77 53 77 48 L77 34" fill="#e88ba4" />
          <ellipse cx="50" cy="34" rx="27" ry="10" fill="#e88ba4" />
          <ellipse cx="50" cy="33" rx="21" ry="7.5" fill="#fdf0e2" />
          <circle cx="41" cy="32" r="2.8" fill="#8ed86e" />
          <circle cx="54" cy="35" r="2.4" fill="#f2b45c" />
          <circle cx="62" cy="31" r="2.2" fill="#f7c3d0" />
          <path d="M14 58 Q22 54 30 58 Q38 62 46 58" stroke="#8fc3e8" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 24 && (
        /* 跨年/放烟花：烟花 */
        <g>
          <path d="M50 6 L52 20 M26 14 L37 25 M74 14 L63 25 M14 34 L28 36 M86 34 L72 36" stroke="#f2a9bc" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M34 8 L40 18 M66 8 L60 18 M12 22 L24 28" stroke="#a8c8e8" strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
          <circle cx="50" cy="33" r="5.5" fill="#ffd98a" />
          <circle cx="30" cy="44" r="2.2" fill="#f7c3d0" />
          <circle cx="70" cy="46" r="2.2" fill="#f7c3d0" />
          <circle cx="50" cy="56" r="2.4" fill="#a8c8e8" />
          <path d="M14 60 l5 -2 M86 58 l-5 -2" stroke="#f3c8d3" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      )}
      {k === 25 && (
        /* 放孔明灯 */
        <g>
          <path d="M36 32 Q36 14 50 14 Q64 14 64 32 Q64 42 50 48 Q36 42 36 32 Z" fill="#ffd98a" stroke="#f2b45c" strokeWidth="1.6" />
          <path d="M42 46 L42 51 M58 46 L58 51 M42 51 Q50 55 58 51" stroke="#e3a04a" strokeWidth="1.6" fill="none" />
          <circle cx="50" cy="32" r="2.6" fill="#e8647a" />
          <circle cx="24" cy="20" r="1.6" fill="#f7c3d0" />
          <circle cx="76" cy="24" r="1.4" fill="#f7c3d0" />
          <path d="M16 42 Q22 38 26 42" stroke="#f3c8d3" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 26 && (
        /* 捡贝壳：贝壳 + 海星 */
        <g>
          <path d="M28 46 Q28 22 50 22 Q72 22 72 46 Q61 39 50 46 Q39 39 28 46 Z" fill="#fce3ea" stroke="#f2b8c8" strokeWidth="1.6" />
          <path d="M38 26 Q40 36 45 43 M50 22 L50 45 M62 26 Q60 36 55 43" stroke="#f2b8c8" strokeWidth="1.3" fill="none" />
          <path d="M78 28 l2.2 5 5.4 0.6 -4 3.6 1.2 5.4 -4.8 -2.8 -4.8 2.8 1.2 -5.4 -4 -3.6 5.4 -0.6 Z" fill="#ffd98a" />
          <circle cx="18" cy="18" r="1.5" fill="#f3c8d3" />
          <path d="M12 56 Q18 52 24 56" stroke="#8fc3e8" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 27 && (
        /* 爬山看云海：山峰 */
        <g>
          <path d="M8 56 L34 22 L52 48 L64 30 L90 56 Z" fill="#cfd8e6" />
          <path d="M34 22 L41 31 L37.5 31 L45 42" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M64 30 L70 38 L66 38 L74 49" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
          <ellipse cx="28" cy="54" rx="20" ry="4.6" fill="#fff" opacity="0.92" />
          <ellipse cx="68" cy="58" rx="24" ry="4.6" fill="#fff" opacity="0.85" />
          <circle cx="78" cy="14" r="6" fill="#ffd98a" />
        </g>
      )}
      {k === 28 && (
        /* 露营看星星：帐篷星空 */
        <g>
          <path d="M20 56 L46 24 L72 56 Z" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.4" />
          <path d="M39 56 L46 42 L53 56 Z" fill="#e898a8" />
          <path d="M46 24 L46 42" stroke="#efb0c4" strokeWidth="1.2" />
          <circle cx="20" cy="13" r="1.8" fill="#ffd98a" />
          <circle cx="80" cy="11" r="1.5" fill="#ffd98a" />
          <circle cx="70" cy="22" r="1.2" fill="#ffd98a" />
          <path d="M78 16 A6 6 0 1 0 85 24 A4.8 4.8 0 0 1 78 16 Z" fill="#ffd98a" />
          <path d="M12 30 l6 -3" stroke="#f3c8d3" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      )}
      {k === 29 && (
        /* 坐摩天轮 */
        <g>
          <circle cx="50" cy="28" r="19" fill="none" stroke="#c9c9d2" strokeWidth="2" />
          <path d="M50 9 L50 47 M31 28 L69 28 M37 15 L63 41 M63 15 L37 41" stroke="#c9c9d2" strokeWidth="1.2" />
          <rect x="34" y="12" width="9" height="7.5" rx="2.4" fill="#f2a9bc" />
          <rect x="57" y="12" width="9" height="7.5" rx="2.4" fill="#a8c8e8" />
          <rect x="34" y="37" width="9" height="7.5" rx="2.4" fill="#ffd98a" />
          <rect x="57" y="37" width="9" height="7.5" rx="2.4" fill="#8ed86e" />
          <circle cx="50" cy="28" r="3" fill="#9e9ea8" />
          <path d="M50 31 L38 60 M50 31 L62 60 M34 60 L66 60" stroke="#9e9ea8" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      )}
      {k === 30 && (
        /* 坐旋转木马 */
        <g>
          <path d="M20 26 Q50 10 80 26 Z" fill="#f2a9bc" />
          <circle cx="50" cy="13" r="2.6" fill="#e88ba4" />
          <path d="M34 26 L34 54 M66 26 L66 54" stroke="#c9c9d2" strokeWidth="1.6" />
          <ellipse cx="32" cy="42" rx="9" ry="5.5" fill="#f7c3d0" />
          <circle cx="40" cy="36" r="4" fill="#f7c3d0" />
          <path d="M43 34 l4 -2.5" stroke="#8a5a2e" strokeWidth="1.6" strokeLinecap="round" />
          <ellipse cx="68" cy="44" rx="8" ry="5" fill="#fce3ea" />
          <circle cx="75" cy="38.5" r="3.6" fill="#fce3ea" />
          <rect x="18" y="54" width="64" height="4.5" rx="2.2" fill="#f2d8b8" />
        </g>
      )}
      {k === 31 && (
        /* 游乐园/过山车 */
        <g>
          <path d="M10 56 Q30 56 38 34 Q46 13 62 13 Q80 13 86 34" fill="none" stroke="#c9c9d2" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M38 34 L38 56 M54 20 L54 44 M70 15 L70 40 M86 34 L86 56" stroke="#c9c9d2" strokeWidth="1.2" />
          <g transform="rotate(-26 47 27)">
            <rect x="38" y="23" width="19" height="10" rx="3.5" fill="#f2a9bc" />
            <circle cx="43" cy="33" r="2.2" fill="#5a5a62" />
            <circle cx="53" cy="33" r="2.2" fill="#5a5a62" />
            <circle cx="43" cy="27" r="1.6" fill="#fff" opacity="0.85" />
          </g>
          <circle cx="20" cy="16" r="1.6" fill="#f3c8d3" />
        </g>
      )}
      {k === 32 && (
        /* 美术馆/博物馆/展览：画框 + 调色板 */
        <g>
          <rect x="16" y="16" width="44" height="36" rx="3" fill="#fff" stroke="#d3cfc8" strokeWidth="1.8" />
          <path d="M22 46 L34 30 L42 40 L50 26 L54 46 Z" fill="#fbdce4" />
          <circle cx="27" cy="24" r="2.8" fill="#ffd98a" />
          <ellipse cx="74" cy="38" rx="14" ry="12" fill="#f2d8b8" stroke="#d3ab7e" strokeWidth="1.4" />
          <circle cx="68" cy="33" r="2.4" fill="#f2a9bc" />
          <circle cx="78" cy="32" r="2.4" fill="#a8c8e8" />
          <circle cx="82" cy="42" r="2.4" fill="#8ed86e" />
          <circle cx="72" cy="44" r="2.4" fill="#ffd98a" />
          <path d="M58 54 L70 46" stroke="#8a5a2e" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      )}
      {k === 33 && (
        /* 图书馆/书店/母校：书本 */
        <g>
          <path d="M16 20 Q31 13 46 20 L46 54 Q31 47 16 54 Z" fill="#fbdce4" stroke="#f2b8c8" strokeWidth="1.5" />
          <path d="M84 20 Q69 13 54 20 L54 54 Q69 47 84 54 Z" fill="#fce8ee" stroke="#f2b8c8" strokeWidth="1.5" />
          <path d="M50 19 L50 54" stroke="#e8b0be" strokeWidth="2.2" />
          <path d="M23 28 Q33 24 41 28 M23 36 Q33 32 41 36" stroke="#f2b8c8" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <path d="M59 28 Q67 24 77 28 M59 36 Q67 32 77 36" stroke="#f2b8c8" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <path d={LOVE_HEART_PATH} transform="translate(50 10) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 34 && (
        /* 演唱会/话剧：吉他 */
        <g>
          <circle cx="40" cy="46" r="14" fill="#f2d8b8" stroke="#d3ab7e" strokeWidth="1.6" />
          <circle cx="40" cy="46" r="5" fill="#fdf0e2" stroke="#d3ab7e" strokeWidth="1.2" />
          <path d="M46 35 Q53 25 61 20 L67 14" stroke="#8a5a2e" strokeWidth="5" strokeLinecap="round" />
          <path d="M64 10 l8 8" stroke="#8a5a2e" strokeWidth="6.5" strokeLinecap="round" />
          <path d="M44 43 L62 19" stroke="#5f3d18" strokeWidth="1.1" />
          <circle cx="62" cy="11" r="1.5" fill="#5f3d18" />
          <circle cx="69" cy="9" r="1.5" fill="#5f3d18" />
          <circle cx="20" cy="20" r="3" fill="#e88ba4" />
          <rect x="21.6" y="6" width="1.8" height="14" fill="#e88ba4" />
          <path d={LOVE_HEART_PATH} transform="translate(80 36) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 35 && (
        /* 放风筝 */
        <g>
          <path d="M50 8 L70 28 L50 48 L30 28 Z" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.5" />
          <path d="M50 8 L50 48 M30 28 L70 28" stroke="#fff" strokeWidth="1.4" opacity="0.8" />
          <path d="M50 48 Q46 56 40 58 Q34 60 32 56" stroke="#e88ba4" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M42 55 l5 -2.4 l0 5 Z" fill="#ffd98a" />
          <path d="M35 60 l5 -2.4 l0 5 Z" fill="#a8c8e8" />
          <circle cx="20" cy="12" r="1.6" fill="#f3c8d3" />
          <path d="M78 16 q4 -4 8 0" stroke="#f3c8d3" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 36 && (
        /* 双人自行车 */
        <g>
          <circle cx="26" cy="48" r="9" fill="none" stroke="#5a5a62" strokeWidth="2" />
          <circle cx="74" cy="48" r="9" fill="none" stroke="#5a5a62" strokeWidth="2" />
          <path d="M26 48 L40 32 L62 32 M40 32 L36 48 M40 32 L74 48 M62 32 L74 48 M62 32 L58 48" fill="none" stroke="#e88ba4" strokeWidth="2" strokeLinecap="round" />
          <path d="M34 29 h9 M56 29 h9" stroke="#5a5a62" strokeWidth="3" strokeLinecap="round" />
          <path d="M64 29 q6 -4 8 2" stroke="#5a5a62" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M62 30 L62 16" stroke="#5a5a62" strokeWidth="1.4" />
          <path d={LOVE_HEART_PATH} transform="translate(62 12) scale(1.4) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 37 && (
        /* 钓鱼 */
        <g>
          <path d="M14 18 Q20 34 34 38" stroke="#8a5a2e" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path d="M34 38 Q36 48 34 56" stroke="#9e9ea8" strokeWidth="1.2" fill="none" strokeDasharray="3 3" />
          <path d="M34 56 q3 3 5.5 0" stroke="#9e9ea8" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M8 63 Q16 59 24 63 Q32 67 40 63" stroke="#8fc3e8" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <ellipse cx="64" cy="32" rx="9" ry="5" fill="#a8c8e8" />
          <path d="M72 32 L81 27 L81 37 Z" fill="#a8c8e8" />
          <circle cx="59.5" cy="31" r="1.2" fill="#3a3a40" />
          <path d="M56 46 l-2 4 M63 48 l0 4 M70 46 l2 4" stroke="#8fc3e8" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      )}
      {k === 38 && (
        /* 看樱花：花枝 */
        <g>
          <path d="M14 60 Q38 48 58 28" stroke="#8a5a2e" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <path d="M42 46 Q50 46 56 52" stroke="#8a5a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
          {[[28, 34, 1], [58, 22, 0.9], [62, 52, 0.75]].map(([x, y, s], i) => (
            <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
              {[0, 72, 144, 216, 288].map((a) => (
                <ellipse key={a} cx={Math.cos((a * Math.PI) / 180) * 6} cy={Math.sin((a * Math.PI) / 180) * 6} rx="4.6" ry="5.4" fill="#f9cdd8" />
              ))}
              <circle r="3" fill="#f2a9bc" />
            </g>
          ))}
          <circle cx="82" cy="36" r="1.4" fill="#f3c8d3" />
        </g>
      )}
      {k === 39 && (
        /* 踩落叶 */
        <g>
          <path d="M28 20 Q37 11 46 20 Q37 31 28 20 Z" fill="#f2b45c" />
          <path d="M28 20 Q37 23 46 20" stroke="#d99a3e" strokeWidth="1.2" fill="none" />
          <path d="M37 20 L37 29" stroke="#d99a3e" strokeWidth="1" />
          <path d="M58 34 Q64 27 70 34 Q64 43 58 34 Z" fill="#e8935c" />
          <path d="M64 34 L64 43" stroke="#c97a42" strokeWidth="1" />
          <path d="M34 48 Q40 42 46 48 Q40 56 34 48 Z" fill="#ffd98a" />
          <circle cx="76" cy="16" r="1.4" fill="#f3c8d3" />
          <path d="M14 40 q4 -4 8 0" stroke="#f3c8d3" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 40 && (
        /* 养宠物：爪印 */
        <g>
          <ellipse cx="38" cy="46" rx="13" ry="10.5" fill="#f2d8b8" />
          <circle cx="26.5" cy="32" r="4.6" fill="#f2d8b8" />
          <circle cx="38" cy="28" r="4.8" fill="#f2d8b8" />
          <circle cx="49.5" cy="32" r="4.6" fill="#f2d8b8" />
          <ellipse cx="66" cy="24" rx="7" ry="5.6" fill="#f7c3d0" transform="rotate(-18 66 24)" />
          <circle cx="60" cy="14.5" r="2.6" fill="#f7c3d0" />
          <circle cx="66" cy="12" r="2.7" fill="#f7c3d0" />
          <circle cx="72" cy="14.5" r="2.6" fill="#f7c3d0" />
          <path d={LOVE_HEART_PATH} transform="translate(80 46) scale(1.5) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 41 && (
        /* 写信/手写信/纸条：信封 */
        <g>
          <rect x="22" y="20" width="56" height="36" rx="3.5" fill="#fdf6ee" stroke="#e8cdb2" strokeWidth="1.8" />
          <path d="M22 23 L50 43 L78 23" fill="none" stroke="#e8cdb2" strokeWidth="1.8" />
          <path d={LOVE_HEART_PATH} transform="translate(50 49) scale(1.6) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <circle cx="15" cy="15" r="1.6" fill="#f3c8d3" />
          <circle cx="86" cy="30" r="1.3" fill="#f3c8d3" />
        </g>
      )}
      {k === 42 && (
        /* 生病照顾/剪指甲：护理箱 */
        <g>
          <rect x="26" y="24" width="48" height="32" rx="5" fill="#fff" stroke="#d3cfc8" strokeWidth="1.8" />
          <path d="M42 24 L42 18 Q42 15 45 15 L55 15 Q58 15 58 18 L58 24" fill="none" stroke="#d3cfc8" strokeWidth="1.8" />
          <rect x="45" y="31" width="10" height="18" rx="2" fill="#f2a9bc" />
          <rect x="41" y="35" width="18" height="10" rx="2" fill="#f2a9bc" />
          <circle cx="82" cy="20" r="1.5" fill="#f3c8d3" />
          <path d="M14 62 h8" stroke="#f3c8d3" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      )}
      {k === 43 && (
        /* 恋爱条约/真心话：纸笔 */
        <g>
          <g transform="rotate(-3 48 37)">
            <rect x="26" y="16" width="44" height="42" rx="3" fill="#fdf6ee" stroke="#e8cdb2" strokeWidth="1.8" />
            <path d="M33 26 L61 24 M33 33 L61 31 M33 40 L53 38" stroke="#d8c6a8" strokeWidth="1.6" strokeLinecap="round" />
          </g>
          <path d="M62 52 L80 34 L84 38 L66 56 L60 58 Z" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.3" />
          <path d="M60 58 L55.5 62.5" stroke="#8a5a2e" strokeWidth="2" strokeLinecap="round" />
          <path d={LOVE_HEART_PATH} transform="translate(80 18) scale(1.3) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 44 && (
        /* 梦想基金：存钱罐 */
        <g>
          <circle cx="49" cy="11" r="4.6" fill="#ffd98a" stroke="#f2b45c" strokeWidth="1.2" />
          <text x="49" y="13.8" fontSize="6.5" fontWeight="bold" fill="#b8860b" textAnchor="middle">¥</text>
          <rect x="42" y="21" width="15" height="3.4" rx="1.7" fill="#d9899d" />
          <ellipse cx="49" cy="41" rx="23" ry="16.5" fill="#f7c3d0" />
          <path d="M62 27 Q69 22 69 29 Q65 31.5 61 29 Z" fill="#f2a9bc" />
          <ellipse cx="27" cy="41" rx="5.5" ry="4.6" fill="#f2a9bc" />
          <circle cx="25.4" cy="41" r="1" fill="#c97a8e" />
          <circle cx="28.6" cy="41" r="1" fill="#c97a8e" />
          <path d="M37 56 L37 60 M59 56 L59 60" stroke="#f2a9bc" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M71 54 Q76 56 75 61" stroke="#f2a9bc" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 45 && (
        /* 攒钱旅行/蜜月：行李箱 */
        <g>
          <rect x="30" y="22" width="40" height="34" rx="6" fill="#b8d4ea" stroke="#9bbcd8" strokeWidth="1.6" />
          <path d="M40 22 L40 56 M60 22 L60 56" stroke="#9bbcd8" strokeWidth="2" />
          <path d="M44 22 L44 15 Q44 13 46 13 L54 13 Q56 13 56 15 L56 22" fill="none" stroke="#9bbcd8" strokeWidth="2.2" />
          <circle cx="38" cy="59" r="2.6" fill="#5a5a62" />
          <circle cx="62" cy="59" r="2.6" fill="#5a5a62" />
          <path d={LOVE_HEART_PATH} transform="translate(50 40) scale(1.7) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <path d="M14 20 q4 -4 8 0" stroke="#f3c8d3" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 46 && (
        /* 给爸妈打电话：电话 */
        <g>
          <rect x="30" y="16" width="40" height="42" rx="8" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.6" />
          <rect x="36" y="24" width="28" height="21" rx="3" fill="#fff" opacity="0.88" />
          <path d={LOVE_HEART_PATH} transform="translate(50 34) scale(1.5) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <circle cx="50" cy="52" r="2.8" fill="#fff" />
          <path d="M24 26 q-5 8 0 16 M76 26 q5 8 0 16" stroke="#f3c8d3" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </g>
      )}
      {k === 47 && (
        /* 拍vlog/视频：相机 */
        <g>
          <rect x="24" y="24" width="52" height="32" rx="6" fill="#c9c9d2" stroke="#9e9ea8" strokeWidth="1.6" />
          <path d="M40 24 L44 17 L56 17 L60 24 Z" fill="#9e9ea8" />
          <circle cx="50" cy="40" r="10" fill="#8e8e96" />
          <circle cx="50" cy="40" r="6.5" fill="#dfe4ec" />
          <circle cx="47.5" cy="37.5" r="2" fill="#fff" />
          <circle cx="70" cy="31" r="2.2" fill="#ffd98a" />
          <path d={LOVE_HEART_PATH} transform="translate(28 17) scale(1.2) translate(-4.5 -3.5)" fill="#f2a9bc" />
        </g>
      )}
      {k === 48 && (
        /* 双人游戏：手柄 */
        <g>
          <path d="M26 26 L74 26 Q85 26 85 41 Q85 54 76 54 Q69 54 65 45 L60 45 L40 45 L35 45 Q31 54 24 54 Q15 54 15 41 Q15 26 26 26 Z" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.6" />
          <path d="M32 35.5 h9 M36.5 31 v9" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          <circle cx="62" cy="33" r="2.8" fill="#a8c8e8" />
          <circle cx="69" cy="39" r="2.8" fill="#8ed86e" />
          <path d={LOVE_HEART_PATH} transform="translate(50 36) scale(1.3) translate(-4.5 -3.5)" fill="#e88ba4" />
        </g>
      )}
      {k === 49 && (
        /* 1000片拼图 */
        <g>
          <path d="M24 24 L48 24 L48 30 Q42 30 42 37 Q42 44 48 44 L48 52 L24 52 Z" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.5" />
          <path d="M52 24 L76 24 L76 52 L52 52 L52 44 Q58 44 58 37 Q58 30 52 30 Z" fill="#fce8ee" stroke="#f2b8c8" strokeWidth="1.5" />
          <path d={LOVE_HEART_PATH} transform="translate(64 38) scale(1.6) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <circle cx="17" cy="17" r="1.5" fill="#f3c8d3" />
        </g>
      )}
      {k === 50 && (
        /* 搭积木 */
        <g>
          <rect x="24" y="38" width="25" height="21" rx="2.5" fill="#a8c8e8" stroke="#9bbcd8" strokeWidth="1.4" />
          <rect x="51" y="38" width="25" height="21" rx="2.5" fill="#f7c3d0" stroke="#efb0c4" strokeWidth="1.4" />
          <rect x="37.5" y="17" width="25" height="21" rx="2.5" fill="#ffd98a" stroke="#f2c14e" strokeWidth="1.4" />
          <circle cx="36.5" cy="48.5" r="4" fill="#fff" opacity="0.85" />
          <path d="M59.5 44.5 h9 M64 40 v9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          <path d={LOVE_HEART_PATH} transform="translate(50 27.5) scale(1.4) translate(-4.5 -3.5)" fill="#fff" opacity="0.92" />
        </g>
      )}
      {k === 51 && (
        /* 晨跑/运动/鞋码：运动鞋 */
        <g>
          <path d="M22 46 Q22 38 30 36 L38 29 Q42 33.5 48 36 Q58 40 70 42 Q80 44 80 50 L80 53 L22 53 Z" fill="#fff" stroke="#c9c9d2" strokeWidth="1.8" />
          <path d="M22 53 L80 53 L80 55.5 Q80 58.5 76 58.5 L26 58.5 Q22 58.5 22 55.5 Z" fill="#f2a9bc" />
          <path d="M36 38 L44 42 M40 34 L48 38" stroke="#c9c9d2" strokeWidth="1.6" strokeLinecap="round" />
          <path d={LOVE_HEART_PATH} transform="translate(64 47) scale(1.3) translate(-4.5 -3.5)" fill="#f2a9bc" />
          <path d="M11 40 h9 M9 48 h9" stroke="#dfe4ec" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
      {k === 52 && (
        /* 生日快乐/庆祝14号：蛋糕 */
        <g>
          <rect x="48.4" y="15" width="3.2" height="13" rx="1.6" fill="#a8c8e8" />
          <path d="M50 7.5 Q53.2 10.8 50 14.5 Q46.8 10.8 50 7.5 Z" fill="#ffd98a" />
          <path d="M28 44 L28 32 Q28 28 32 28 L68 28 Q72 28 72 32 L72 44 Q61 49.5 50 44 Q39 49.5 28 44 Z" fill="#fce8ee" />
          <rect x="28" y="42" width="44" height="15" rx="3" fill="#f7c3d0" />
          <path d="M28 48 Q39 53.5 50 48 Q61 42.5 72 48" stroke="#f2a9bc" strokeWidth="2" fill="none" />
          <circle cx="36" cy="31" r="2" fill="#e8647a" />
          <circle cx="64" cy="31" r="2" fill="#e8647a" />
        </g>
      )}
      {k === 53 && (
        /* 恋爱日记/年度总结：日记本 */
        <g>
          <rect x="27" y="15" width="48" height="43" rx="4.5" fill="#fce8ee" stroke="#f2b8c8" strokeWidth="1.6" />
          <rect x="27" y="15" width="11" height="43" rx="4.5" fill="#f2a9bc" />
          {[24, 33, 42].map((y) => (
            <circle key={y} cx="32.5" cy={y} r="1.7" fill="#fff" opacity="0.9" />
          ))}
          <path d={LOVE_HEART_PATH} transform="translate(56 32) scale(2.3) translate(-4.5 -3.5)" fill="#fff" opacity="0.92" />
          <path d="M45 52 L67 52" stroke="#f2b8c8" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M49 58 L63 58" stroke="#f2b8c8" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

/** 手账装饰花（SVG 玫瑰） */
function ScrapFlower({ size = 64, className = '', tone = '#f6c3d0' }: { size?: number; className?: string; tone?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return <ellipse key={i} cx={32 + Math.cos(a) * 14} cy={32 + Math.sin(a) * 14} rx="12" ry="13" fill={tone} opacity="0.92" />;
      })}
      <circle cx="32" cy="32" r="12" fill={tone} />
      <circle cx="32" cy="32" r="6.5" fill="#eaa4b6" />
    </svg>
  );
}

const HUNDRED_DRAFT_DEFAULT = { img: null as string | null, desc: '', date: '', place: '' };

/** 100 件小事：每件事对应的插画 kind（与 HUNDRED_LIST 顺序一一对应，图标匹配事件内容） */
const HUNDRED_KIND_MAP: number[] = [
  /* 0-4 */ 0, 1, 2, 3, 4,
  /* 5-9 用情侣头像~做晚饭 */ 5, 5, 6, 7, 8,
  /* 10-14 洗碗~给对方唱歌 */ 16, 17, 1, 9, 18,
  /* 15-19 逛街情侣装~敷面膜 */ 3, 3, 2, 47, 19,
  /* 20-24 吹头发~堆雪人 */ 20, 42, 16, 21, 21,
  /* 25-29 冰淇淋~熬夜跨年 */ 22, 23, 13, 8, 24,
  /* 30-34 倒数~踩浪花 */ 24, 24, 25, 11, 11,
  /* 35-39 捡贝壳~看极光 */ 26, 27, 28, 12, 12,
  /* 40-44 摩天轮~逛美术馆 */ 29, 30, 31, 31, 32,
  /* 45-49 博物馆~演唱会 */ 32, 33, 33, 32, 34,
  /* 50-54 话剧~打雪仗 */ 34, 18, 9, 7, 21,
  /* 55-59 风筝~看樱花 */ 35, 36, 11, 37, 38,
  /* 60-64 踩落叶~宠物生日 */ 39, 15, 15, 40, 40,
  /* 65-69 写未来信~藏纸条 */ 41, 41, 10, 10, 41,
  /* 70-74 鞋码~梦想基金 */ 51, 42, 0, 43, 44,
  /* 75-79 攒钱旅行~童年秘密 */ 45, 45, 2, 0, 41,
  /* 80-84 回母校~拍vlog */ 33, 0, 46, 53, 47,
  /* 85-89 剪视频~真心话大冒险 */ 47, 48, 49, 50, 43,
  /* 90-94 猜心情~学技能 */ 0, 51, 51, 33, 33,
  /* 95-99 家乡菜~恋爱日记 */ 8, 24, 52, 52, 53,
  /* 100-104 老地重游~一起白头 */ 6, 2, 14, 0, 12,
];

function HundredPage({ state, patch, close, showToast }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; close: () => void; showToast: (m: string) => void }) {
  const PER_PAGE = 6;
  const pageCount = Math.ceil(HUNDRED_LIST.length / PER_PAGE);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState(HUNDRED_DRAFT_DEFAULT);
  const [showIndex, setShowIndex] = useState(false);
  const touchX = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const items = state.hundredItems || {};

  const openEdit = (i: number) => {
    setEditing(i);
    setDraft(items[String(i)] || { ...HUNDRED_DRAFT_DEFAULT });
  };
  /** 保存编辑：有内容自动标记完成，全空则取消完成 */
  const finishEdit = () => {
    if (editing == null) return;
    const key = String(editing);
    const hasContent = !!(draft.img || draft.desc.trim() || draft.date || draft.place.trim());
    const done = state.hundred.includes(editing);
    patch({
      hundredItems: { ...items, [key]: draft },
      hundred: hasContent && !done ? [...state.hundred, editing] : !hasContent && done ? state.hundred.filter((x) => x !== editing) : state.hundred,
    });
    showToast(hasContent ? '已完成这件小事 ♡' : '已保存');
    setEditing(null);
  };
  /** 点击印章切换完成 */
  const toggleDone = (i: number) => {
    const done = state.hundred.includes(i);
    patch({ hundred: done ? state.hundred.filter((x) => x !== i) : [...state.hundred, i] });
    showToast(done ? '已改回待完成' : '已完成这件小事 ♡');
  };
  const onPickImg = async (f: File | null) => {
    if (!f) return;
    try {
      const url = await fileToScaledDataURL(f, 900, 0.72);
      setDraft((d) => ({ ...d, img: url }));
    } catch {
      showToast('图片处理失败，换一张试试');
    }
  };

  // ============ 编辑详情页（参考图2） ============
  if (editing != null) {
    const title = HUNDRED_LIST[editing] || '';
    return (
      <div className="relative flex h-full flex-col bg-[linear-gradient(180deg,#fdf2f5_0%,#fbeaef_100%)]">
        {/* 顶栏：返回 + 清空 + 完成 */}
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[56px]">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setEditing(null)}
              aria-label="返回"
              className="text-[#8a6a74] transition-opacity active:opacity-50"
            >
              <ArrowLeft className="h-6 w-6" strokeWidth={2.2} />
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({ ...HUNDRED_DRAFT_DEFAULT });
                showToast('已清空这件小事的内容');
              }}
              aria-label="清空内容"
              className="text-[#e0708a] transition-opacity active:opacity-50"
            >
              <Trash2 className="h-6 w-6" strokeWidth={1.8} />
            </button>
          </div>
          <button
            type="button"
            onClick={finishEdit}
            className="rounded-md bg-[linear-gradient(180deg,#f9b7ca,#f49cb6)] px-6 py-1.5 text-[15px] font-bold text-white shadow-[0_3px_10px_rgba(230,130,160,0.4)] transition-transform active:scale-95"
          >
            完成
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {/* 拍立得相框 + 胶带 */}
          <div className="relative mx-auto mt-3 w-full max-w-[300px]">
            <span aria-hidden="true" className="absolute -left-2 -top-2 z-10 h-5 w-16 rotate-[-32deg] rounded-[3px] bg-[#f6c9d6]/80 shadow-sm" />
            <span aria-hidden="true" className="absolute -bottom-2 -right-2 z-10 h-5 w-16 rotate-[-32deg] rounded-[3px] bg-[#f6c9d6]/80 shadow-sm" />
            <div className="rounded-md bg-white p-3 shadow-[0_8px_24px_rgba(210,120,150,0.22)]">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                aria-label="添加图片"
                className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-sm bg-[#fdf1f4]"
              >
                {draft.img ? (
                  <img src={draft.img} alt="小事照片" className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <span className="flex flex-col items-center gap-2">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(180deg,#f9b7ca,#f49cb6)] text-[30px] font-light text-white shadow-[0_4px_12px_rgba(230,130,160,0.45)]">+</span>
                    <span className="text-[13px] font-medium text-[#e88ba4]">添加图片</span>
                  </span>
                )}
              </button>
            </div>
          </div>
          <div className="mt-4 text-center text-[19px] font-semibold tracking-wide text-[#5c4a44]">{title}</div>

          {/* 表单：描述/日期/地点 */}
          <div className="mt-6 space-y-0">
            {([
              { key: 'desc', label: '添加描述', hint: '（可不填）', type: 'text', placeholder: '' },
              { key: 'date', label: '选择日期', hint: '（可不填）', type: 'date', placeholder: '' },
              { key: 'place', label: '输入地点', hint: '（可不填）', type: 'text', placeholder: '' },
            ] as const).map((row) => (
              <label key={row.key} className="flex items-center gap-2 border-b border-[#e8ccd4] py-3.5">
                {row.type === 'date' ? (
                  <>
                    <span className="text-[15px] text-[#5c4a44]">{draft.date || row.label}</span>
                    <input
                      type="date"
                      value={draft.date}
                      onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                      aria-label="选择日期"
                      className={`flex-1 bg-transparent text-right text-[15px] outline-none ${draft.date ? 'text-[#5c4a44]' : 'text-transparent'}`}
                    />
                    {!draft.date && <span className="pointer-events-none -ml-24 text-[15px] text-[#c3a8b0]">{row.hint}</span>}
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      value={draft[row.key]}
                      onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
                      placeholder={row.label}
                      maxLength={60}
                      className="h-7 flex-1 bg-transparent text-[15px] text-[#5c4a44] outline-none placeholder:text-[#c3a8b0]"
                    />
                    <span className="shrink-0 text-[15px] text-[#c3a8b0]">{row.hint}</span>
                  </>
                )}
              </label>
            ))}
          </div>
        </div>

        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => {
          void onPickImg(e.target.files?.[0] ?? null);
          e.currentTarget.value = '';
        }} />
      </div>
    );
  }

  // ============ 手账主页（参考图1） ============
  const pageItems = HUNDRED_LIST.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const done = state.hundred.length;

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden bg-[linear-gradient(160deg,#fdeff3_0%,#fadce4_45%,#f6ccd8_100%)]"
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (dx < -44) setPage((p) => Math.min(pageCount - 1, p + 1));
        else if (dx > 44) setPage((p) => Math.max(0, p - 1));
        touchX.current = null;
      }}
    >
      {/* 背景装饰：柔光斑 + 花朵 + 丝带 + 回形针 + 花瓣 */}
      <span aria-hidden="true" className="absolute -left-10 top-6 h-40 w-40 rounded-full bg-white/45 blur-xl" />
      <span aria-hidden="true" className="absolute -right-8 top-24 h-36 w-36 rounded-full bg-white/35 blur-xl" />
      <ScrapFlower size={78} tone="#f5bccb" className="absolute -left-5 top-[110px] opacity-90" />
      <ScrapFlower size={56} tone="#f8cfda" className="absolute left-8 top-[170px] opacity-80" />
      <ScrapFlower size={90} tone="#f3b2c3" className="absolute -right-6 top-[150px] opacity-90" />
      <ScrapFlower size={60} tone="#f6c3d0" className="absolute right-10 top-[236px] opacity-75" />
      <ScrapFlower size={70} tone="#f5bccb" className="absolute -left-4 bottom-24 opacity-85" />
      <ScrapFlower size={52} tone="#f8cfda" className="absolute bottom-40 right-4 opacity-70" />
      {/* 花瓣 */}
      {[['12%', '24%', -20], ['30%', '12%', 40], ['70%', '9%', -35], ['86%', '30%', 24], ['8%', '58%', 30], ['90%', '62%', -28], ['22%', '82%', -12], ['64%', '88%', 18]].map(([l, t, r], i) => (
        <span
          key={i}
          aria-hidden="true"
          className="absolute h-3 w-5 rounded-[50%_50%_50%_50%/60%_60%_40%_40%] bg-[#f4bccb]/80"
          style={{ left: l as string, top: t as string, transform: `rotate(${r}deg)` }}
        />
      ))}
      {/* 回形针 */}
      <svg aria-hidden="true" viewBox="0 0 24 48" className="absolute right-8 top-3 h-11 w-6 rotate-12 opacity-80">
        <path d="M7 14 V36 a5 5 0 0 0 10 0 V10 a7 7 0 0 0 -14 0 v26" fill="none" stroke="#c9909e" strokeWidth="2.6" strokeLinecap="round" />
      </svg>

      {/* 顶部：返回 + 标题牌（避开状态栏） */}
      <div className="relative z-20 shrink-0 pt-[56px]">
        <button
          type="button"
          onClick={close}
          aria-label="返回"
          className="absolute left-3 top-[62px] z-30 flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(180deg,#f9b7ca,#f29cb6)] text-white shadow-[0_4px_12px_rgba(230,130,160,0.45)] transition-transform active:scale-95"
        >
          <ArrowLeft className="h-6 w-6" strokeWidth={2.6} />
        </button>
        {/* 标题牌（斜置粉色亚克力牌） */}
        <div className="relative mx-auto w-fit rotate-[-3deg]">
          <div className="relative rounded-xl border-2 border-white/85 bg-[linear-gradient(135deg,#f8c6d4,#f2a9be_60%,#ee9db4)] px-7 py-2.5 shadow-[0_6px_18px_rgba(210,110,140,0.35)]">
            <span aria-hidden="true" className="absolute left-2.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-white/85 shadow-inner" />
            <div className="pl-2 text-center">
              <div className="text-[19px] font-extrabold tracking-wide text-[#a13a52] drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]">我们的 100 件小事</div>
              <div className="-mt-0.5 text-right text-[9px] italic tracking-[3px] text-white/95">OurLoveDiary</div>
            </div>
          </div>
          {/* 牌上小花 */}
          <ScrapFlower size={34} tone="#fce3ea" className="absolute -right-4 -top-3" />
        </div>
      </div>

      {/* TA 发起的小事（第九轮：AI 会主动添加 100 件小事里的事件） */}
      {(state.aiHundred ?? []).length > 0 && (
        <div className="relative z-10 mx-5 mt-1 rounded-xl border border-[#f2cdd8] bg-white/85 px-3.5 py-2.5 backdrop-blur-sm" data-testid="ai-hundred-banner">
          <div className="text-[12.5px] leading-relaxed text-[#b0506c]">
            <b>{state.taName || 'TA'}</b> 想和你一起做：<b>{state.aiHundred[0].note}</b>
            <span className="ml-1 text-[11.5px] text-[#c58ba0]">（{state.aiHundred[0].why}）</span>
          </div>
        </div>
      )}

      {/* 拍立得卡片墙（当前页 6 张） */}
      <div className="relative z-10 flex-1 overflow-hidden px-5 pt-3">
        <div className="grid grid-cols-2 gap-x-4">
          {pageItems.map((item, i) => {
            const idx = page * PER_PAGE + i;
            const checked = state.hundred.includes(idx);
            const it = items[String(idx)];
            return (
              <button
                key={idx}
                type="button"
                onClick={() => openEdit(idx)}
                aria-pressed={checked}
                aria-label={`小事：${item}`}
                className={`relative mb-5 rounded-md bg-white px-2 pb-1.5 pt-2 shadow-[0_6px_16px_rgba(200,110,140,0.22)] transition-transform active:scale-[0.96] ${HUNDRED_ROT[idx % 4]} ${i % 2 === 1 ? 'mt-7' : ''}`}
              >
                {/* 胶带 */}
                <span aria-hidden="true" className="absolute -top-2 left-1/2 z-10 h-4 w-12 -translate-x-1/2 rotate-[-5deg] rounded-[3px] bg-[#f6cdd9]/90 shadow-sm" />
                {/* 插画（SVG 手绘风，非 emoji） */}
                <span className="flex h-[74px] items-center justify-center overflow-hidden rounded-sm bg-[#fdf3ec]">
                  {it?.img ? (
                    <img src={it.img} alt={item} className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <ScrapIllus kind={HUNDRED_KIND_MAP[idx] ?? idx % 16} className="h-full w-full p-1.5" />
                  )}
                </span>
                <span className={`mt-1 block min-h-[30px] text-center text-[11.5px] leading-snug ${checked ? 'text-[#c3a8b0] line-through' : 'text-[#6b5a52]'}`}>{item}</span>
                {/* 序号 */}
                <span className="absolute bottom-0.5 left-2 text-[8px] font-bold tracking-wider text-[#e3ccd3]">{String(idx + 1).padStart(2, '0')}</span>
                {/* 待完成/已完成 印章（点击切换，参考图位于左上角） */}
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={checked ? '标记待完成' : '标记完成'}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDone(idx);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleDone(idx);
                    }
                  }}
                  className={`absolute -left-1.5 -top-2 z-20 rounded-[4px] border px-[3px] py-[3px] text-[9px] font-extrabold leading-[1.1] shadow-sm ${checked ? 'border-[#b09a90] bg-[#b09a90] text-white' : 'border-[#e05a6d] bg-white/90 text-[#e05a6d]'}`}
                  style={{ writingMode: 'vertical-rl' }}
                >
                  {checked ? '已完成' : '待完成'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 右侧固定按钮：目录 + 添加小事 */}
      <div className="absolute bottom-[86px] right-3 z-30 flex flex-col items-end gap-2.5">
        <button
          type="button"
          onClick={() => setShowIndex(true)}
          className="flex items-center gap-1.5 rounded-md bg-[linear-gradient(180deg,#b7a6ec,#9d8ade)] px-3.5 py-2 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(140,120,210,0.4)] transition-transform active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
          目录
        </button>
        <button
          type="button"
          onClick={() => {
            const next = HUNDRED_LIST.findIndex((_, i) => !state.hundred.includes(i));
            openEdit(next >= 0 ? next : 0);
          }}
          className="flex items-center gap-1.5 rounded-md bg-[linear-gradient(180deg,#f9a8c0,#f387a7)] px-3.5 py-2 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(230,120,155,0.45)] transition-transform active:scale-95"
        >
          <span className="text-[16px] font-light leading-none">+</span>
          添加小事
        </button>
      </div>

      {/* 底部：左右滑动提示 + 翻页箭头 */}
      <div className="relative z-20 flex shrink-0 items-center justify-between px-5 pb-4">
        <span className="flex-1 text-center text-[15px] font-medium text-white drop-shadow-[0_1px_3px_rgba(190,90,120,0.55)]">左右滑动 / 点击翻页</span>
        <button
          type="button"
          onClick={() => setPage((p) => (p + 1) % pageCount)}
          aria-label="下一页"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-white/90 bg-white/45 text-white shadow-[0_3px_10px_rgba(200,110,140,0.35)] backdrop-blur-sm transition-transform active:scale-90"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </div>
      {/* 页码 */}
      <span aria-hidden="true" className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-semibold text-[#d89aab]">
        {page + 1} / {pageCount} · 已完成 {done}/100
      </span>

      {/* 目录弹层 */}
      {showIndex && (
        <div className="absolute inset-0 z-40 flex items-end bg-black/35" onClick={() => setShowIndex(false)}>
          <div className="max-h-[76%] w-full overflow-hidden rounded-t-3xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.05] px-5 py-3.5">
              <span className="text-[16px] font-bold text-[#3c3c42]">目录 · 已完成 {done}/100</span>
              <button type="button" onClick={() => setShowIndex(false)} aria-label="关闭目录" className="text-[13px] font-medium text-[#e88ba4]">
                收起
              </button>
            </div>
            <div className="max-h-[62vh] overflow-y-auto overscroll-contain px-4 pb-8 pt-2">
              {Array.from({ length: 10 }).map((_, g) => (
                <div key={g} className="mb-1">
                  <div className="px-1 pb-1 pt-2 text-[11px] font-bold text-[#c9a9b2]">{g * 10 + 1}-{g * 10 + 10}</div>
                  {HUNDRED_LIST.slice(g * 10, g * 10 + 10).map((item, j) => {
                    const i = g * 10 + j;
                    const checked = state.hundred.includes(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setPage(Math.floor(i / PER_PAGE));
                          setShowIndex(false);
                        }}
                        className="flex h-10 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors active:bg-[#fdf1f4]"
                      >
                        <span className="w-6 shrink-0 text-[11px] font-bold text-[#d8b8c0]">{String(i + 1).padStart(2, '0')}</span>
                        <span className={`flex-1 truncate text-[13.5px] ${checked ? 'text-[#c3a8b0] line-through' : 'text-[#4a3f3b]'}`}>{item}</span>
                        {checked && <span className="text-[12px] font-bold text-[#e0708a]">✓</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 恋爱协议红章（参考图3：恋人空间公证 LOVE SPACE 圆形印章） */
function PactStamp() {
  return (
    <svg viewBox="0 0 120 120" className="h-[98px] w-[98px] -rotate-[14deg] opacity-90" aria-hidden="true">
      <defs>
        <path id="pact-stamp-circ" d="M60 60 m -42 0 a 42 42 0 1 1 84 0 a 42 42 0 1 1 -84 0" fill="none" />
      </defs>
      <circle cx="60" cy="60" r="54" fill="rgba(229,70,76,0.05)" stroke="#e5464c" strokeWidth="3.5" />
      <circle cx="60" cy="60" r="29" fill="none" stroke="#e5464c" strokeWidth="1.8" />
      <text fill="#e5464c" fontSize="12.5" fontWeight="700" letterSpacing="2.2">
        <textPath href="#pact-stamp-circ" startOffset="1%">LOVE SPACE · 恋人空间公证</textPath>
      </text>
      <text x="60" y="54" textAnchor="middle" fontSize="14" fontWeight="800" fill="#e5464c">恋人空间</text>
      <text x="60" y="72" textAnchor="middle" fontSize="12" fontWeight="800" fill="#e5464c" letterSpacing="6">公证</text>
      <path d="M60 77 c -3.2 -4.2 -9.5 -3 -9.5 2 c 0 4 5.2 6.8 9.5 9.8 c 4.3 -3 9.5 -5.8 9.5 -9.8 c 0 -5 -6.3 -6.2 -9.5 -2 Z" fill="#e5464c" />
    </svg>
  );
}

/** 协议纸数据（当前草稿 / 已保存协议通用形状） */
interface PactPaperData {
  title: string;
  preamble: string;
  clauses: string[];
  signMe: string | null;
  signTa: string | null;
  meAt: number | null;
  taAt: number | null;
  at: number | null;
}

/** 恋爱协议纸（预览/签署/回看共用）：标题 + 声明 + 条款 + 双签名 + 日期（签署后盖红章） */
function PactPaper({ data, meName, taName }: { data: PactPaperData; meName: string; taName: string }) {
  const signed = data.at != null;
  const kai = { fontFamily: "'Kaiti SC','STKaiti','KaiTi','SimKai',cursive" } as const;
  const sig = (side: 'me' | 'ta') => {
    const name = side === 'me' ? data.signMe ?? (signed ? meName || null : null) : data.signTa ?? (signed ? taName || null : null);
    const at = side === 'me' ? data.meAt ?? data.at : data.taAt ?? data.at;
    return { name, at };
  };
  return (
    <div className="relative overflow-hidden rounded-lg border border-[#e9e9ee] bg-white px-5 pb-6 pt-6 shadow-[0_4px_18px_rgba(0,0,0,0.05)]">
      <div className="text-center text-[21px] font-bold tracking-[2px] text-[#26262b]">{data.title || '恋爱协议书'}</div>
      <div className="mt-4 h-[2px] bg-[#2c2c30]" />
      <p className="mt-4 text-justify text-[13.5px] leading-[1.9] text-[#4a4a52]">{data.preamble}</p>
      <div className="my-4 border-t border-dashed border-[#dcdce1]" />
      <ol className="space-y-1.5 px-1" data-testid="pact-paper-clauses">
        {data.clauses.map((c, i) => (
          <li key={i} className="flex gap-1.5 text-[13px] leading-relaxed text-[#4a4a52]">
            <span className="shrink-0">{i + 1}.</span>
            <span>{c}</span>
          </li>
        ))}
        {data.clauses.length === 0 && <li className="text-[12.5px] text-[#c9c9cf]">还没有条款，去添加第一条约定吧</li>}
      </ol>
      <div className="my-4 border-t border-dashed border-[#dcdce1]" />
      <div className="grid grid-cols-2">
        {(['me', 'ta'] as const).map((side) => {
          const { name, at } = sig(side);
          return (
            <div key={side} className={side === 'me' ? 'border-r border-[#e9e9ee] pr-4' : 'pl-4'}>
              <div className="text-[12px] text-[#6e6e76]">{side === 'me' ? '你的签名' : '他的签名'}</div>
              <div className="mt-1.5 min-h-[36px] text-[23px] leading-[36px] text-[#26262b]" style={kai}>
                {name || <span className="text-[14px] tracking-[2px] text-[#c9c9cf]">＿＿＿＿＿</span>}
              </div>
              <div className="mt-1 text-[11.5px] text-[#9a9aa2]">日期：{at ? fmtDateCn(fmtDate(at)) : '＿＿＿年＿＿月＿＿日'}</div>
            </div>
          );
        })}
      </div>
      {signed && (
        <div className="pointer-events-none absolute -right-1 bottom-20">
          <PactStamp />
        </div>
      )}
    </div>
  );
}

/** 恋爱协议（第七轮重做，参考图3/4/5）：预览主页 → 编辑协议 → 签署协议（双方签名后盖章生效） */
function PactPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const [view, setView] = useState<'home' | 'edit' | 'sign' | 'view'>('home');
  const [signFrom, setSignFrom] = useState<'home' | 'edit'>('home');
  const [taPending, setTaPending] = useState(false);
  const [viewPact, setViewPact] = useState<CouplePactRecord | null>(null);
  const [dlg, setDlg] = useState<null | { type: 'title' | 'preamble' | 'custom' | 'template' } | { type: 'clause'; idx: number }>(null);
  const [draft, setDraft] = useState('');
  const clauses = state.pactClauses;
  const curPaper: PactPaperData = {
    title: state.pactTitle || '恋爱协议书',
    preamble: state.pactPreamble,
    clauses: state.pactClauses,
    signMe: state.pactSignMe,
    signTa: state.pactSignTa,
    meAt: state.pactMeAt,
    taAt: state.pactTaAt,
    at: state.pactAt,
  };

  /** 再添加一份协议：重置草稿为默认模板 → 进编辑（已保存的协议书不受影响） */
  const startNewPact = () => {
    const d = defaultState();
    patch({ pactTitle: d.pactTitle, pactPreamble: d.pactPreamble, pactClauses: [...d.pactClauses], pactSignMe: null, pactMeAt: null, pactSignTa: null, pactTaAt: null, pactAt: null });
    setSignFrom('edit');
    setView('edit');
    showToast('新的一份协议，开始编辑吧 ♡');
  };

  // 条款拖拽排序（指针事件：按手柄 → 移动高亮目标行 → 松手落位）
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragFrom = useRef<number | null>(null);
  const dragToRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragTo, setDragTo] = useState<number | null>(null);

  const startDrag = (i: number, e: React.PointerEvent) => {
    e.preventDefault();
    dragFrom.current = i;
    dragToRef.current = i;
    setDragging(i);
    setDragTo(i);
    const onMove = (ev: PointerEvent) => {
      let target: number | null = null;
      rowRefs.current.forEach((el, j) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (ev.clientY >= r.top && ev.clientY <= r.bottom) target = j;
      });
      if (target != null) {
        dragToRef.current = target;
        setDragTo(target);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const from = dragFrom.current;
      const to = dragToRef.current;
      dragFrom.current = null;
      dragToRef.current = null;
      setDragging(null);
      setDragTo(null);
      if (from == null || to == null || from === to) return;
      const arr = [...clauses];
      const [m] = arr.splice(from, 1);
      arr.splice(to, 0, m);
      patch({ pactClauses: arr });
      showToast('条款顺序已调整');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const openDlg = (d: NonNullable<typeof dlg>, initial = '') => {
    setDraft(initial);
    setDlg(d);
  };

  const submitDlg = () => {
    if (!dlg) return;
    const t = draft.trim();
    if (dlg.type === 'title') {
      if (!t) {
        showToast('协议名称不能为空');
        return;
      }
      patch({ pactTitle: t });
      showToast('协议名称已更新 ♡');
    } else if (dlg.type === 'preamble') {
      if (!t) {
        showToast('协议声明不能为空');
        return;
      }
      patch({ pactPreamble: t });
      showToast('协议声明已更新 ♡');
    } else if (dlg.type === 'clause') {
      if (!t) {
        showToast('条款内容不能为空');
        return;
      }
      const arr = [...clauses];
      arr[dlg.idx] = t;
      patch({ pactClauses: arr });
      showToast('条款已更新 ♡');
    } else if (dlg.type === 'custom') {
      if (!t) {
        showToast('先写下你们的约定吧');
        return;
      }
      patch({ pactClauses: [...clauses, t] });
      showToast('已添加一条自定义条款 ♡');
    } else if (dlg.type === 'template') {
      if (!t) {
        showToast('请输入模板编码');
        return;
      }
      patch({ pactClauses: [...PACT_TEMPLATE_CLAUSES], pactTitle: '恋爱协议书' });
      showToast('标准模板导入成功，共 20 条 ♡');
    }
    setDlg(null);
    setDraft('');
  };

  const addRandom = () => {
    const pool = PACT_RANDOM_POOL.filter((p) => !clauses.includes(p));
    if (pool.length === 0) {
      showToast('随机条款库都被你用完啦');
      return;
    }
    patch({ pactClauses: [...clauses, pool[Math.floor(Math.random() * pool.length)]] });
    showToast('已随机新增一条 ♡');
  };

  const removeClause = (idx: number) => {
    patch({ pactClauses: clauses.filter((_, i) => i !== idx) });
    showToast('已删除该条款');
  };

  const signMe = () => {
    if (state.pactSignMe) return;
    patch({ pactSignMe: state.meName || '我', pactMeAt: Date.now() });
    showToast('签名成功 ♡ 现在可以发给 TA 签名了');
  };

  const sendToTa = () => {
    if (!state.pactSignMe || state.pactSignTa || taPending) return;
    setTaPending(true);
    showToast(`已发送给${state.taName || 'TA'}签名，等 TA 一会儿…`);
    window.setTimeout(() => {
      setTaPending(false);
      // TA 签完生效，同时自动存档一份（第八轮：可多份保存/回看）
      const rec: CouplePactRecord = {
        id: uid(),
        title: state.pactTitle || '恋爱协议书',
        preamble: state.pactPreamble,
        clauses: [...state.pactClauses],
        signMe: state.pactSignMe || state.meName || '我',
        signTa: state.taName || 'TA',
        meAt: state.pactMeAt,
        taAt: Date.now(),
        at: Date.now(),
      };
      patch({ pactSignTa: rec.signTa, pactTaAt: rec.taAt, pactAt: rec.at, pacts: [rec, ...(state.pacts ?? [])] });
      showToast('TA 已签名，恋爱协议正式生效并已保存 ♡');
    }, 2600 + Math.random() * 2400);
  };

  const dlgTitle = dlg ? (dlg.type === 'title' ? '编辑协议名称' : dlg.type === 'preamble' ? '编辑协议声明' : dlg.type === 'clause' ? '编辑条款' : dlg.type === 'custom' ? '自定义一条' : '导入模板') : '';

  return (
    <div className="relative h-full">
      {view === 'home' && (
        <SubShell title="恋爱协议" onBack={close}>
          {/* TA 拟的协议（第九轮：AI 会自己拟协议等我签） */}
          {state.aiPact && (
            <div className="mt-3 rounded-2xl border-2 border-dashed border-[#f2536a] bg-white p-4" data-testid="ai-pact-card">
              <div className="flex items-center justify-between">
                <div className="text-[14.5px] font-bold text-[#26262b]">
                  {state.taName || 'TA'} 拟了一份协议 <span className="text-[#f2536a]">《{state.aiPact.title}》</span>
                </div>
                <span className="shrink-0 rounded-full bg-[#fdeef2] px-2 py-0.5 text-[10.5px] font-bold text-[#f2536a]">等你签</span>
              </div>
              <div className="mt-2 space-y-1">
                {state.aiPact.clauses.slice(0, 3).map((c, i) => (
                  <div key={i} className="flex gap-1.5 text-[12.5px] leading-relaxed text-[#6e6e76]">
                    <span className="shrink-0">{i + 1}.</span>
                    <span className="min-w-0">{c}</span>
                  </div>
                ))}
                {state.aiPact.clauses.length > 3 && <div className="text-[11.5px] text-[#b6b6bd]">…共 {state.aiPact.clauses.length} 条</div>}
              </div>
              <div className="mt-3 flex gap-2.5">
                <button
                  type="button"
                  data-testid="ai-pact-dismiss"
                  onClick={() => {
                    patch({ aiPact: null });
                    showToast('已婉拒 TA 的协议草稿');
                  }}
                  className="h-10 flex-1 rounded-full bg-[#f0f0f3] text-[14px] font-medium text-[#5a5a62]"
                >
                  不了谢谢
                </button>
                <button
                  type="button"
                  data-testid="ai-pact-adopt"
                  onClick={() => {
                    const p = state.aiPact!;
                    patch({ pactTitle: p.title, pactPreamble: state.pactPreamble, pactClauses: [...p.clauses], pactSignMe: null, pactMeAt: null, pactSignTa: null, pactTaAt: null, pactAt: null, aiPact: null });
                    setSignFrom('edit');
                    setView('edit');
                    showToast(`已换成 ${state.taName || 'TA'} 的版本，改完就能签啦 ♡`);
                  }}
                  className="h-10 flex-1 rounded-full bg-[#f2536a] text-[14px] font-semibold text-white active:opacity-85"
                >
                  用 TA 的版本去签
                </button>
              </div>
            </div>
          )}

          {/* 主标题（参考图3）：一起写一份 / 专属恋爱协议 */}
          <div className="px-1 pt-2">
            <h2 className="text-[27px] font-extrabold leading-[1.3] text-[#26262b]">
              一起写一份
              <br />
              <span className="text-[#f2536a]">专属</span> 恋爱协议
            </h2>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-[#9a9aa2]">写下你们的约定，一起签名，生成协议书留作纪念，让爱有据可依。</p>
          </div>

          {/* 三步流程卡 */}
          <div className="mt-4 rounded-2xl border border-[#f2dfe3] bg-white p-4 shadow-sm">
            <div className="flex items-start">
              {[
                { n: '1', icon: NotebookPen, label: '写下约定', desc: '填写你们的相处约定和美好承诺' },
                { n: '2', icon: Users, label: '双方签名', desc: '你们分别签名确认彼此的约定' },
                { n: '3', icon: BadgeCheck, label: '生成保存', desc: '生成专属协议书可保存或分享' },
              ].map((s, i) => (
                <div key={s.n} className={`flex flex-1 flex-col items-center text-center ${i > 0 ? 'border-l border-dashed border-[#f0e3e5]' : ''}`}>
                  <div className="relative">
                    <span className="absolute -right-2 -top-2 grid h-[18px] w-[18px] place-items-center rounded-full bg-[#f2536a] text-[10.5px] font-bold text-white">{s.n}</span>
                    <s.icon className="h-9 w-9 text-[#f2536a]" strokeWidth={1.7} />
                  </div>
                  <div className="mt-2 text-[14px] font-semibold text-[#26262b]">{s.label}</div>
                  <div className="mt-1 px-1 text-[10.5px] leading-snug text-[#b6b6bd]">{s.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 协议预览 */}
          <div className="mt-6 flex items-center justify-center gap-2">
            <span className="text-[11px] text-[#f2536a]">♥</span>
            <span className="text-[16px] font-bold text-[#26262b]">协议预览</span>
            <span className="text-[11px] text-[#f2536a]">♥</span>
          </div>
          <div className="mt-3">
            <PactPaper data={curPaper} meName={state.meName} taName={state.taName} />
          </div>

          {/* 已保存的协议书（第八轮：生效自动存档，可多份/可回看） */}
          {state.pacts.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between px-1">
                <div className="text-[15px] font-bold text-[#26262b]">
                  已保存的协议书 <span className="text-[#f2536a]">{state.pacts.length}</span>
                </div>
                <button type="button" data-testid="pact-add-another" onClick={startNewPact} className="text-[13px] font-medium text-[#f2536a] active:opacity-60">
                  + 添加另一份
                </button>
              </div>
              <div className="mt-2.5 space-y-2">
                {state.pacts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-testid="pact-saved-item"
                    onClick={() => {
                      setViewPact(p);
                      setView('view');
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border border-[#f2dfe3] bg-white px-4 py-3 text-left active:bg-[#fff5f7]"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#fdeef2]">
                      <Scale className="h-4.5 w-4.5 text-[#f2536a]" strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-[#26262b]">{p.title}</span>
                      <span className="block text-[11.5px] text-[#9a9aa2]">
                        {p.clauses.length} 条条款 · {fmtDateCn(fmtDate(p.at))} 生效 · 双方已签名
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#c9c9cf]" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 模板导入 + 创建按钮 */}
          <div className="mt-4 text-center text-[13px] text-[#9a9aa2]">
            已有模板编码？
            <button type="button" data-testid="pact-import-btn" onClick={() => openDlg({ type: 'template' })} className="ml-1 font-medium text-[#f2536a] underline underline-offset-2 active:opacity-60">
              导入模板
            </button>
          </div>
          <button
            type="button"
            data-testid="pact-create-btn"
            onClick={() => {
              setSignFrom('edit');
              setView('edit');
            }}
            className="mt-3 flex h-[52px] w-full items-center justify-center rounded-full bg-[#f2536a] text-[17px] font-semibold text-white shadow-[0_8px_22px_rgba(242,83,106,0.3)] transition-transform active:scale-[0.98]"
          >
            {state.pactAt != null ? '重新编辑协议 ✦' : '创建恋爱协议 ✦'}
          </button>
          {state.pactAt != null && (
            <button
              type="button"
              onClick={() => {
                setSignFrom('home');
                setView('sign');
              }}
              className="mt-3 w-full text-center text-[13.5px] text-[#9a9aa2] underline-offset-2 active:opacity-60"
            >
              查看已签署的协议书 →
            </button>
          )}
        </SubShell>
      )}

      {view === 'edit' && (
        <SubShell title="编辑协议" onBack={() => setView('home')}>
          {/* 协议名称 */}
          <div className="mt-1 text-[16px] font-bold text-[#26262b]">协议名称</div>
          <button
            type="button"
            onClick={() => openDlg({ type: 'title' }, state.pactTitle)}
            className="mt-2.5 flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl border border-[#e4e4e9] bg-white px-4 py-3 text-left active:bg-[#fafafa]"
          >
            <span className="flex-1 truncate text-[15.5px] text-[#26262b]">{state.pactTitle || '恋爱协议书'}</span>
            <span className="flex shrink-0 items-center gap-1 text-[13px] text-[#26262b]">
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> 编辑
            </span>
          </button>

          {/* 协议声明 */}
          <div className="mt-5 text-[16px] font-bold text-[#26262b]">协议声明</div>
          <button
            type="button"
            onClick={() => openDlg({ type: 'preamble' }, state.pactPreamble)}
            className="mt-2.5 flex w-full items-start justify-between gap-3 rounded-xl border border-[#e4e4e9] bg-white p-4 text-left active:bg-[#fafafa]"
          >
            <span className="flex-1 text-[13.5px] leading-[1.8] text-[#4a4a52]">{state.pactPreamble}</span>
            <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[13px] text-[#26262b]">
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> 编辑
            </span>
          </button>

          {/* 协议条款 */}
          <div className="mt-5 flex items-baseline justify-between">
            <div className="text-[16px] font-bold text-[#26262b]">协议条款</div>
            <div className="text-[11.5px] text-[#c9c9cf]">按住右侧手柄排序</div>
          </div>
          <div className="mt-1" data-testid="pact-clause-list">
            {clauses.map((c, i) => (
              <div
                key={i}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className={`flex items-center gap-1.5 py-3.5 ${
                  dragging === i
                    ? 'rounded-lg bg-white px-2 shadow-[0_8px_22px_rgba(0,0,0,0.14)]'
                    : dragTo === i && dragging != null && dragTo !== dragging
                      ? 'border-t-2 border-[#f2536a]'
                      : 'border-b border-dashed border-[#e4e4e9]'
                }`}
              >
                <span className="w-6 shrink-0 text-[15px] font-semibold text-[#26262b]">{i + 1}</span>
                <span className="min-w-0 flex-1 text-[14px] leading-snug text-[#26262b]">{c}</span>
                <button
                  type="button"
                  aria-label={`编辑条款${i + 1}`}
                  onClick={() => openDlg({ type: 'clause', idx: i }, c)}
                  className="flex shrink-0 items-center gap-1 px-1 text-[12.5px] text-[#4a4a52] active:opacity-60"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> 编辑
                </button>
                <button
                  type="button"
                  aria-label={`删除条款${i + 1}`}
                  onClick={() => removeClause(i)}
                  className="flex shrink-0 items-center gap-1 px-1 text-[12.5px] text-[#4a4a52] active:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} /> 删除
                </button>
                <button type="button" aria-label="拖动排序" onPointerDown={(e) => startDrag(i, e)} className="shrink-0 cursor-grab touch-none px-0.5 text-[#c9c9cf] active:text-[#9a9aa2]">
                  <GripVertical className="h-4.5 w-4.5" strokeWidth={2} />
                </button>
              </div>
            ))}
            {clauses.length === 0 && <div className="py-8 text-center text-[13px] text-[#c9c9cf]">还没有条款，从下面新增一条吧</div>}
          </div>

          {/* 新增 */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" data-testid="pact-random-btn" onClick={addRandom} className="h-12 rounded-xl border-2 border-[#f8a0b4] text-[14.5px] font-medium text-[#f2536a] active:bg-[#fff5f7]">
              + 随机新增一条
            </button>
            <button type="button" data-testid="pact-custom-btn" onClick={() => openDlg({ type: 'custom' })} className="h-12 rounded-xl border border-[#d9d9de] bg-white text-[14.5px] font-medium text-[#4a4a52] active:bg-[#f7f7f9]">
              + 自定义一条
            </button>
          </div>

          <button
            type="button"
            data-testid="pact-to-sign-btn"
            onClick={() => {
              setSignFrom('edit');
              setView('sign');
            }}
            className="mb-2 mt-6 flex h-[52px] w-full items-center justify-center rounded-full bg-[#f2536a] text-[16.5px] font-semibold text-white shadow-[0_8px_22px_rgba(242,83,106,0.3)] transition-transform active:scale-[0.98]"
          >
            下一步：预览协议
          </button>
        </SubShell>
      )}

      {view === 'sign' && (
        <SubShell title="签署协议" onBack={() => setView(signFrom)}>
          <div className="mt-1">
            <PactPaper data={curPaper} meName={state.meName} taName={state.taName} />
          </div>

          {/* 双签名区（参考图5）：先我签 → 再发 TA 签 */}
          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <div className="text-[14px] font-semibold text-[#26262b]">你的签名</div>
              <button
                type="button"
                data-testid="pact-sign-me"
                disabled={!!state.pactSignMe}
                onClick={signMe}
                className={`mt-2 flex h-[92px] w-full items-center justify-center rounded-md border-2 border-dashed transition-colors ${
                  state.pactSignMe ? 'border-[#f8a0b4] bg-white' : 'border-[#f8a0b4] bg-[#fff5f7] active:bg-[#ffeef2]'
                }`}
              >
                {state.pactSignMe ? (
                  <span className="text-[26px] text-[#26262b]" style={{ fontFamily: "'Kaiti SC','STKaiti','KaiTi','SimKai',cursive" }}>
                    {state.pactSignMe}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[14px] text-[#f2536a]">
                    <Pencil className="h-4 w-4" strokeWidth={2} /> 点击签名
                  </span>
                )}
              </button>
              {!state.pactSignMe && <div className="mt-2 rounded-md border border-[#f2536a] px-2 py-1 text-center text-[11px] leading-snug text-[#f2536a]">请先签名，完成后即可生成协议书</div>}
              <div className="mt-2.5 text-[12px] text-[#9a9aa2]">日期：{state.pactMeAt ? fmtDateCn(fmtDate(state.pactMeAt)) : '＿＿＿年＿＿月＿＿日'}</div>
            </div>
            <div>
              <div className="text-[14px] font-semibold text-[#26262b]">他的签名</div>
              <button
                type="button"
                data-testid="pact-sign-ta"
                disabled={!state.pactSignMe || !!state.pactSignTa || taPending}
                onClick={sendToTa}
                className={`mt-2 flex h-[92px] w-full items-center justify-center rounded-md border-2 border-dashed border-[#d9d9de] transition-colors ${
                  !state.pactSignMe || state.pactSignTa ? 'bg-[#fafafa]' : 'bg-[#fafafa] active:bg-[#f1f1f4]'
                }`}
              >
                {state.pactSignTa ? (
                  <span className="text-[26px] text-[#26262b]" style={{ fontFamily: "'Kaiti SC','STKaiti','KaiTi','SimKai',cursive" }}>
                    {state.pactSignTa}
                  </span>
                ) : taPending ? (
                  <span className="flex items-center gap-1.5 text-[13px] text-[#9a9aa2]">
                    <Loader2 className="h-4 w-4 animate-spin" /> 等待 TA 签名…
                  </span>
                ) : (
                  <span className={`text-[14px] ${state.pactSignMe ? 'text-[#6e6e76]' : 'text-[#c9c9cf]'}`}>发送给他签名</span>
                )}
              </button>
              <div className="mt-2 text-center text-[11.5px] text-[#c9c9cf]">{state.pactSignTa ? 'TA 已签名 ♡' : state.pactSignMe ? '完成签名后，可发送给他签名' : '请先完成你的签名'}</div>
              <div className="mt-2.5 text-[12px] text-[#9a9aa2]">日期：{state.pactTaAt ? fmtDateCn(fmtDate(state.pactTaAt)) : '＿＿＿年＿＿月＿＿日'}</div>
            </div>
          </div>

          {state.pactAt != null ? (
            <div className="mb-2 mt-5 rounded-xl bg-[#fdeef2] py-3.5 text-center text-[14px] font-semibold text-[#f2536a]" data-testid="pact-effective-banner">
              协议书已生成并生效，好好爱 ♡
            </div>
          ) : (
            <p className="mb-2 mt-5 text-center text-[12.5px] leading-relaxed text-[#b6b6bd]">双方都签名后，协议书自动生成并盖上恋人空间公证章</p>
          )}
        </SubShell>
      )}

      {view === 'view' && viewPact && (
        <SubShell title="协议书" onBack={() => setView('home')}>
          <div className="mt-1" data-testid="pact-saved-view">
            <PactPaper
              data={{ title: viewPact.title, preamble: viewPact.preamble, clauses: viewPact.clauses, signMe: viewPact.signMe, signTa: viewPact.signTa, meAt: viewPact.meAt, taAt: viewPact.taAt, at: viewPact.at }}
              meName={state.meName}
              taName={state.taName}
            />
          </div>
          <div className="mt-4 rounded-xl bg-[#fdeef2] py-3 text-center text-[13px] font-semibold text-[#f2536a]">
            {fmtDateCn(fmtDate(viewPact.at))} 生效 · 双方已签名 ♡
          </div>
          <div className="mb-2 mt-4 flex gap-2.5">
            <button
              type="button"
              data-testid="pact-saved-delete"
              onClick={() => {
                patch({ pacts: state.pacts.filter((x) => x.id !== viewPact.id) });
                setViewPact(null);
                setView('home');
                showToast('已删除该份协议书');
              }}
              className="h-11 flex-1 rounded-full bg-[#f0f0f3] text-[15px] font-medium text-[#5a5a62]"
            >
              删除这份协议
            </button>
            <button type="button" onClick={() => setView('home')} className="h-11 flex-1 rounded-full bg-[#f2536a] text-[15px] font-semibold text-white active:opacity-85">
              返回
            </button>
          </div>
        </SubShell>
      )}

      {/* 编辑弹层：名称/声明/条款/自定义/模板编码 */}
      {dlg && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/35 px-6" onClick={() => setDlg(null)}>
          <div className="w-full rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[16.5px] font-bold text-[#26262b]">{dlgTitle}</div>
            {dlg.type === 'template' ? (
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="输入模板编码，如 LOVE2026"
                autoFocus
                className="mt-3.5 h-12 w-full rounded-xl bg-[#f3f3f5] px-3.5 text-[15px] text-[#26262b] outline-none placeholder:text-[#b6b6bd]"
              />
            ) : dlg.type === 'preamble' ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={5}
                autoFocus
                maxLength={200}
                className="mt-3.5 w-full resize-none rounded-xl bg-[#f3f3f5] p-3.5 text-[14.5px] leading-relaxed text-[#26262b] outline-none placeholder:text-[#b6b6bd]"
              />
            ) : (
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                maxLength={dlg.type === 'title' ? 20 : 50}
                placeholder={dlg.type === 'custom' ? '写一条你们的小约定…' : ''}
                className="mt-3.5 h-12 w-full rounded-xl bg-[#f3f3f5] px-3.5 text-[15px] text-[#26262b] outline-none placeholder:text-[#b6b6bd]"
              />
            )}
            <div className="mt-4 flex gap-2.5">
              <button type="button" onClick={() => setDlg(null)} className="h-11 flex-1 rounded-full bg-[#f0f0f3] text-[15px] font-medium text-[#5a5a62]">
                取消
              </button>
              <button type="button" data-testid="pact-dlg-save" onClick={submitDlg} className="h-11 flex-1 rounded-full bg-[#f2536a] text-[15px] font-semibold text-white active:opacity-85">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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

/** 恋爱编年史状态色（参考图2：暗恋/暧昧/恋爱/分手/复合/结婚 多彩淡色块） */
const CHRON_STATUSES: { key: string; bg: string; fg: string }[] = [
  { key: '暗恋', bg: '#fff3d6', fg: '#c08a1f' },
  { key: '暧昧', bg: '#ffe1e9', fg: '#e0607e' },
  { key: '恋爱', bg: '#ffe6df', fg: '#e06a4a' },
  { key: '分手', bg: '#eae6fb', fg: '#8071cf' },
  { key: '复合', bg: '#ffedd4', fg: '#d68f2c' },
  { key: '结婚', bg: '#e0f2df', fg: '#3f9e54' },
];

/** 恋爱编年史（第八轮重做，参考图2/3）：年×月状态表格 + 关键月份编辑器（自动补全年内月份）+ 恋爱大事记 */
function ChroniclePage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const now = new Date();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<{ y: number; m: number; status: string }[]>(() => [
    { y: now.getFullYear(), m: now.getMonth() + 1, status: '暗恋' },
  ]);

  /** 已保存的关键月份（按时间升序） */
  const months = useMemo(() => [...state.chronicleMonths].sort((a, b) => a.ym.localeCompare(b.ym)), [state.chronicleMonths]);

  /** 年份列：出现过的年份 + 当前年（参考图2 起止由用户选择决定） */
  const years = useMemo(() => {
    const set = new Set<number>(months.map((m) => Number(m.ym.slice(0, 4))));
    set.add(now.getFullYear());
    return [...set].sort((a, b) => a - b);
  }, [months]);

  /** 补全规则：某年某月显示「≤ 该月的最近一次关键选择」的状态；之前没有任何选择 → —（跨年同样延续） */
  const statusAt = (y: number, mi: number): string | null => {
    const target = y * 12 + (mi + 1);
    let cur: string | null = null;
    for (const it of months) {
      const k = Number(it.ym.slice(0, 4)) * 12 + Number(it.ym.slice(5, 7));
      if (k <= target) cur = it.status;
    }
    return cur;
  };

  /** 编辑器：年份候选（2018 ~ 当前年+1） */
  const yearOpts = useMemo(() => {
    const arr: number[] = [];
    for (let y = 2018; y <= now.getFullYear() + 1; y++) arr.push(y);
    return arr;
  }, []);

  const statusMeta = (s: string) => CHRON_STATUSES.find((x) => x.key === s) ?? CHRON_STATUSES[0];

  const saveDraft = () => {
    const seen = new Set<string>();
    const list = [...draft]
      .sort((a, b) => a.y * 12 + a.m - (b.y * 12 + b.m))
      .map((it) => ({ ym: `${it.y}-${String(it.m).padStart(2, '0')}`, status: it.status }))
      .filter((it) => {
        if (seen.has(it.ym)) return false;
        seen.add(it.ym);
        return true;
      });
    if (list.length === 0) {
      showToast('先选择至少一个月份');
      return;
    }
    patch({ chronicleMonths: list });
    setEditing(false);
    showToast('恋爱编年史已生成 ♡');
  };

  // ---------------- 编辑视图（参考图3） ----------------
  if (editing) {
    return (
      <SubShell title="恋爱编年史" onBack={() => setEditing(false)}>
        <div className="mt-5 text-center">
          <div className="text-[21px] font-extrabold text-[#26262b]">选择几个感情变化的月份</div>
          <div className="mt-1.5 text-[12.5px] text-[#9a9aa2]">系统会自动补全年内月份</div>
        </div>

        <div className="mt-5 rounded-2xl border border-[#f6e3e7] bg-white/70 p-3.5" data-testid="chronicle-edit">
          {draft.map((it, i) => (
            <div key={i} className="flex items-center gap-2.5 py-2">
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-[#f2536a] bg-white" />
              <div className="flex flex-1 items-center gap-1 rounded-xl border border-[#f3d9df] bg-white px-2.5 py-2">
                <select
                  value={it.y}
                  onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, y: Number(e.target.value) } : x)))}
                  className="bg-transparent text-[15px] font-semibold text-[#26262b] outline-none"
                  aria-label="年份"
                >
                  {yearOpts.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <span className="text-[#9a9aa2]">.</span>
                <select
                  value={it.m}
                  onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, m: Number(e.target.value) } : x)))}
                  className="bg-transparent text-[15px] font-semibold text-[#26262b] outline-none"
                  aria-label="月份"
                >
                  {Array.from({ length: 12 }, (_, mi) => (
                    <option key={mi + 1} value={mi + 1}>
                      {String(mi + 1).padStart(2, '0')}
                    </option>
                  ))}
                </select>
                <select
                  value={it.status}
                  onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)))}
                  className="ml-auto rounded-full px-2.5 py-1 text-[12.5px] font-semibold outline-none"
                  style={{ background: statusMeta(it.status).bg, color: statusMeta(it.status).fg }}
                  aria-label="状态"
                >
                  {CHRON_STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.key}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                aria-label={`删除第${i + 1}条`}
                data-testid="chronicle-remove-row"
                onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#fdeef2] text-[15px] font-bold text-[#f2536a] active:opacity-60"
              >
                −
              </button>
            </div>
          ))}
          <div className="py-2 pl-6">
            <button
              type="button"
              data-testid="chronicle-add-row"
              onClick={() => setDraft((d) => [...d, { y: now.getFullYear(), m: now.getMonth() + 1, status: '暗恋' }])}
              className="w-full rounded-xl border-2 border-dashed border-[#f2536a] bg-[#fff5f7] py-2.5 text-[14px] font-medium text-[#f2536a] active:bg-[#ffeef2]"
            >
              ＋ 继续添加月份（可选）
            </button>
          </div>
        </div>

        <button
          type="button"
          data-testid="chronicle-generate"
          onClick={saveDraft}
          className="mb-2 mt-6 flex h-[52px] w-full items-center justify-center rounded-full bg-[#f2536a] text-[16.5px] font-semibold text-white shadow-[0_8px_22px_rgba(242,83,106,0.3)] transition-transform active:scale-[0.98]"
        >
          生成我的编年史
        </button>
      </SubShell>
    );
  }

  // ---------------- 结果视图（参考图2） ----------------
  return (
    <SubShell title="恋爱编年史" onBack={close}>
      {/* 头部 */}
      <div className="mt-3 px-1">
        <div className="flex items-start gap-2.5">
          <span className="mt-1 shrink-0">
            <PixelHeart size={30} />
          </span>
          <h2 className="text-[21px] font-extrabold leading-snug text-[#26262b]">
            记录几个关键月份，
            <br />
            生成你的<span className="text-[#f2536a]">恋爱编年史</span>
          </h2>
        </div>
        <p className="mt-2 pl-[42px] text-[13px] text-[#9a9aa2]">用一张表，记录感情里的重要时刻</p>
      </div>

      {/* 结果表格 */}
      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm" data-testid="chronicle-table-card">
        <div className="text-[14.5px] font-bold text-[#26262b]">
          我的恋爱编年史 <span className="text-[12px]">💗</span>
        </div>
        <div className="mt-3 overflow-x-auto pb-1" data-testid="chronicle-table">
          <table className="border-separate border-spacing-0 text-center" style={{ minWidth: years.length > 3 ? 96 * Math.min(years.length + 1, 7) : 300 }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-1.5 py-1.5 text-[12px] font-semibold text-[#8e8e96]">月份</th>
                {years.map((y) => (
                  <th key={y} className="px-1.5 py-1.5 text-[12.5px] font-bold text-[#26262b]">
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 12 }, (_, mi) => (
                <tr key={mi}>
                  <td className="sticky left-0 z-10 bg-white px-1.5 py-[2.5px] text-[11.5px] text-[#8e8e96]">{mi + 1}月</td>
                  {years.map((y) => {
                    const st = statusAt(y, mi);
                    const meta = st ? CHRON_STATUSES.find((s) => s.key === st) : undefined;
                    return (
                      <td key={y} className="px-[2px] py-[2.5px]">
                        <span
                          className="block whitespace-nowrap rounded-md px-1.5 py-[3px] text-[11px]"
                          style={meta ? { background: meta.bg, color: meta.fg } : { color: '#c9c9cf' }}
                        >
                          {meta ? meta.key : '—'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {months.length === 0 && <div className="mt-2 text-center text-[12px] text-[#b6b6bd]">还没有关键月份，点下方「开始制作」记录第一段感情线吧</div>}
      </div>

      {/* 怎么玩 */}
      <div className="mt-7 text-center text-[17px] font-bold text-[#f2536a]">✦ 怎么玩？ ✦</div>
      <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
        {[
          { n: '1', icon: <CalendarDays className="h-6 w-6" strokeWidth={1.8} />, bg: '#ffe1e9', fg: '#e0607e', label: '选择关键月份', desc: '记录感情里发生变化的时间点' },
          { n: '2', icon: <Heart className="h-6 w-6" strokeWidth={1.8} />, bg: '#eae6fb', fg: '#8071cf', label: '选择对应状态', desc: '比如暗恋、暧昧、恋爱、分手、复合' },
          { n: '3', icon: <Sparkles className="h-6 w-6" strokeWidth={1.8} />, bg: '#e0f2df', fg: '#3f9e54', label: '生成结果表', desc: '系统自动补全年内月份，一目了然' },
        ].map((s, i) => (
          <div key={s.n} className={`flex items-center gap-3.5 py-3 ${i > 0 ? 'border-t border-dashed border-[#f0e3e5]' : ''}`}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: s.bg, color: s.fg }}>
              {s.icon}
            </span>
            <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[#f2536a] text-[10.5px] font-bold text-white">{s.n}</span>
            <span className="min-w-0">
              <span className="block text-[14.5px] font-semibold text-[#26262b]">{s.label}</span>
              <span className="block text-[11.5px] text-[#b6b6bd]">{s.desc}</span>
            </span>
          </div>
        ))}
      </div>

      <button
        type="button"
        data-testid="chronicle-start"
        onClick={() => {
          setDraft(
            months.length > 0
              ? months.map((it) => ({ y: Number(it.ym.slice(0, 4)), m: Number(it.ym.slice(5, 7)), status: it.status }))
              : [{ y: now.getFullYear(), m: now.getMonth() + 1, status: '暗恋' }],
          );
          setEditing(true);
        }}
        className="mb-1 mt-5 flex h-[54px] w-full items-center justify-center rounded-full bg-[#f2536a] text-[18px] font-semibold text-white shadow-[0_8px_22px_rgba(242,83,106,0.3)] transition-transform active:scale-[0.98]"
      >
        开始制作 ✨
      </button>

      {/* 恋爱大事记（原编年史事件：情侣轨迹弹层同步引用） */}
      <div className="mt-9">
        <div className="text-[16px] font-bold text-[#26262b]">恋爱大事记</div>
        <div className="text-[12px] text-[#9a9aa2]">值得记住的时刻，也一条条留在这里</div>
        <div className="mt-3 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) {
                patch({ chronicle: [{ id: uid(), text: text.trim(), at: Date.now() }, ...state.chronicle] });
                setText('');
                showToast('已写入大事记 ✍️');
              }
            }}
            placeholder="记录一件值得记住的小事…"
            maxLength={40}
            className="h-11 flex-1 rounded-xl bg-white px-3.5 text-[15px] shadow-sm outline-none placeholder:text-[#b6b6bd]"
          />
          <button
            type="button"
            data-testid="chronicle-add-event"
            onClick={() => {
              const t = text.trim();
              if (!t) return;
              patch({ chronicle: [{ id: uid(), text: t, at: Date.now() }, ...state.chronicle] });
              setText('');
              showToast('已写入大事记 ✍️');
            }}
            className="h-11 rounded-xl bg-[linear-gradient(135deg,#5c5c64,#3f3f46)] px-5 text-[15px] font-semibold text-white"
          >
            记录
          </button>
        </div>
        {state.chronicle.length === 0 ? (
          <div className="mt-8 text-center text-[14px] text-[#b6b6bd]">时间线还是空的，从今天开始记录吧</div>
        ) : (
          <div className="mt-5 space-y-0">
            {state.chronicle.map((c, i) => (
              <div key={c.id} className="relative flex gap-4 pb-6">
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
      </div>
    </SubShell>
  );
}

/** 三生石（参考图5）：深蓝星空 + 发光水晶 + 竖排名牌 + 缔结名簿 */
const STONE_NAMES = ['陈文冲', '陆湘玲', '蔡慧欣', '彭书源', '吴艳婷', '曾予彬', '宋嘉萍', '陈嘉佑', '徐梓馨', '蒋东兴', '刘简清', '肖丰初', '袁欣菲', '饶兴国', '何方珊', '徐溢涵', '黄静璐', '谭鑫磊', '黄新连', '蒙金玉', '王鑫雨', '王巍', '周子涵', '玉玲', '薛名言', '艾海洋', '杨春艳', '蔡一晨', '姜睿磊'];

/** 竖排名字牌 */
function NameTag({ name, style, hot = false, delay = 0 }: { name: string; style?: React.CSSProperties; hot?: boolean; delay?: number }) {
  return (
    <span
      className={`pointer-events-none absolute flex items-center justify-center rounded-[7px] px-[3px] py-2 text-[13px] tracking-[3px] ${
        hot
          ? 'z-10 border border-[#ffd9a8]/80 bg-[linear-gradient(180deg,rgba(255,214,150,0.34),rgba(255,170,190,0.22))] text-[#ffe9c8] shadow-[0_0_16px_rgba(255,190,120,0.5)]'
          : 'border border-white/20 bg-white/[0.08] text-white/85 backdrop-blur-[2px]'
      } [writing-mode:vertical-rl] [animation:couple-float-y_4s_ease-in-out_infinite]`}
      style={{ ...style, animationDelay: `${delay}s` }}
    >
      {name}
    </span>
  );
}

function StonePage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const [sheet, setSheet] = useState<'none' | 'explain' | 'ours'>('none');
  const engraved = state.stoneEngraved;
  const me = state.meName || '我';
  const ta = state.taName || 'TA';
  /** 名牌布局：左右两列 + 底部一行（参考图散布） */
  const tagSpots: { l: string; t: string; d: number }[] = [
    { l: '4%', t: '17%', d: 0 }, { l: '13%', t: '19%', d: 0.6 },
    { l: '27%', t: '15%', d: 1.1 }, { l: '36%', t: '18%', d: 0.3 },
    { l: '60%', t: '15%', d: 0.8 }, { l: '70%', t: '17%', d: 1.4 },
    { l: '4%', t: '46%', d: 0.5 }, { l: '13%', t: '48%', d: 1.2 },
    { l: '27%', t: '44%', d: 0.2 }, { l: '36%', t: '47%', d: 0.9 },
    { l: '60%', t: '44%', d: 1.5 }, { l: '70%', t: '46%', d: 0.4 },
    { l: '86%', t: '47%', d: 1.0 },
  ];
  const bottomSpots = engraved
    ? [
        { name: me, hot: true, l: '30%', t: '72%', d: 0.2 },
        { name: ta, hot: true, l: '42%', t: '73%', d: 0.7 },
      ]
    : [
        { name: STONE_NAMES[24], hot: false, l: '8%', t: '70%', d: 0.3 },
        { name: STONE_NAMES[25], hot: false, l: '17%', t: '72%', d: 0.8 },
        { name: STONE_NAMES[26], hot: false, l: '30%', t: '70%', d: 0.2 },
        { name: STONE_NAMES[27], hot: false, l: '39%', t: '72%', d: 0.6 },
        { name: STONE_NAMES[28], hot: false, l: '52%', t: '70%', d: 1.1 },
      ];

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[linear-gradient(180deg,#141f3a_0%,#1d3054_34%,#31507e_62%,#5f82ac_86%,#8aa8c8_100%)]">
      {/* ===== 星空背景 ===== */}
      {[
        ['8%', '8%', 2], ['20%', '5%', 1.4], ['38%', '9%', 1.8], ['55%', '4%', 1.2], ['72%', '10%', 2.2], ['88%', '6%', 1.5],
        ['12%', '30%', 1.3], ['93%', '26%', 1.9], ['6%', '55%', 1.6], ['95%', '62%', 1.4], ['30%', '38%', 1.1], ['66%', '36%', 1.3],
      ].map(([l, t, s], i) => (
        <span
          key={i}
          aria-hidden="true"
          className="absolute rounded-full bg-white [animation:couple-twinkle_2.6s_ease-in-out_infinite]"
          style={{ left: l as string, top: t as string, width: `${s}px`, height: `${s}px`, animationDelay: `${(i % 5) * 0.5}s` }}
        />
      ))}
      {/* 星轨弧线 */}
      <svg aria-hidden="true" viewBox="0 0 400 700" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full opacity-25">
        <circle cx="200" cy="300" r="190" fill="none" stroke="#9fc3e8" strokeWidth="0.8" strokeDasharray="3 7" />
        <circle cx="200" cy="300" r="250" fill="none" stroke="#9fc3e8" strokeWidth="0.6" strokeDasharray="2 9" />
        <circle cx="200" cy="300" r="130" fill="none" stroke="#b8d4ee" strokeWidth="0.7" strokeDasharray="4 8" />
      </svg>
      {/* 流星（周期性划过） */}
      <span aria-hidden="true" className="absolute left-[6%] top-[14%] h-[2px] w-20 rounded-full bg-[linear-gradient(90deg,transparent,#cfe8ff,#fff)] opacity-0 shadow-[0_0_8px_rgba(190,225,255,0.9)] [animation:couple-shoot_6s_ease-in_1.2s_infinite]" />
      <span aria-hidden="true" className="absolute left-[52%] top-[8%] h-[2px] w-14 rounded-full bg-[linear-gradient(90deg,transparent,#ffe9c8,#fff)] opacity-0 shadow-[0_0_8px_rgba(255,225,180,0.9)] [animation:couple-shoot_8s_ease-in_4.5s_infinite]" />
      {/* 星尘飘落 */}
      {[
        ['16%', 0], ['30%', 1.4], ['55%', 2.6], ['70%', 0.8], ['84%', 2], ['44%', 3.4],
      ].map(([l, d], i) => (
        <span
          key={`dust${i}`}
          aria-hidden="true"
          className="absolute top-0 h-1 w-1 rounded-full bg-[#cfe8ff] shadow-[0_0_6px_rgba(170,215,255,0.9)] [animation:couple-fall_9s_linear_infinite]"
          style={{ left: l as string, animationDelay: `${d}s` }}
        />
      ))}
      {/* 底部远山 + 云雾 */}
      <span aria-hidden="true" className="absolute bottom-[13%] -left-10 h-24 w-72 rounded-[50%] bg-[#243b60]/90 blur-[3px]" />
      <span aria-hidden="true" className="absolute bottom-[15%] -right-14 h-28 w-80 rounded-[50%] bg-[#2a4568]/90 blur-[3px]" />
      <span aria-hidden="true" className="absolute bottom-[6%] left-0 right-0 h-24 bg-[linear-gradient(180deg,transparent,rgba(180,205,230,0.35))]" />

      {/* ===== 顶部：返回 + 标题 + 右侧菱形钮（整体避开状态栏） ===== */}
      <div className="relative z-30 shrink-0 pt-[58px]">
        <button
          type="button"
          onClick={close}
          aria-label="返回"
          className="absolute left-3 top-[64px] flex h-10 w-10 rotate-45 items-center justify-center rounded-[10px] border border-[#9fc3e8]/60 bg-[#2a4a78]/70 shadow-[0_0_12px_rgba(120,180,240,0.35)] transition-transform active:scale-90"
        >
          <ArrowLeft className="h-5 w-5 -rotate-45 text-[#d8e8f8]" strokeWidth={2.4} />
        </button>
        <div className="text-center text-[19px] font-semibold tracking-[2px] text-[#cfe2f5] [text-shadow:0_0_14px_rgba(140,190,240,0.65)]">
          缔<span className="mx-0.5 text-[#7d9cc4]">/</span>结<span className="mx-0.5 text-[#7d9cc4]">/</span>名<span className="mx-0.5 text-[#7d9cc4]">/</span>簿
          <span className="mx-3" />
          缘<span className="mx-0.5 text-[#7d9cc4]">/</span>定<span className="mx-0.5 text-[#7d9cc4]">/</span>三<span className="mx-0.5 text-[#7d9cc4]">/</span>生
        </div>
        {/* 右侧两个菱形按钮 */}
        <div className="absolute right-4 top-[128px] flex flex-col items-center gap-6">
          <button type="button" onClick={() => setSheet('explain')} className="group flex flex-col items-center transition-transform active:scale-90">
            <span className="flex h-11 w-11 rotate-45 items-center justify-center rounded-[12px] border border-[#9fc3e8]/70 bg-[linear-gradient(135deg,rgba(150,190,235,0.4),rgba(70,110,170,0.4))] shadow-[0_0_14px_rgba(120,180,240,0.45)] backdrop-blur-[2px]">
              <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-45 text-[#e8f2fc]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z" />
                <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
              </svg>
            </span>
            <span className="mt-2 text-[13px] font-medium text-[#dce9f8] [text-shadow:0_0_8px_rgba(140,190,240,0.8)]">说明</span>
          </button>
          <button type="button" onClick={() => setSheet('ours')} className="flex flex-col items-center transition-transform active:scale-90">
            <span className="flex h-11 w-11 rotate-45 items-center justify-center rounded-[12px] border border-[#9fc3e8]/70 bg-[linear-gradient(135deg,rgba(150,190,235,0.4),rgba(70,110,170,0.4))] shadow-[0_0_14px_rgba(120,180,240,0.45)] backdrop-blur-[2px]">
              <Heart className="h-5 w-5 -rotate-45 text-[#e8f2fc]" strokeWidth={2} fill="rgba(232,242,252,0.85)" />
            </span>
            <span className="mt-2 text-[14px] font-medium text-[#e4eefa] [text-shadow:0_0_8px_rgba(140,190,240,0.8)]">我们的名字</span>
          </button>
        </div>
      </div>

      {/* ===== 中部：发光水晶 + 名牌 ===== */}
      <div className="relative z-10 flex-1">
        {/* 名牌（水晶两侧，inline style 定位避免动态类名被裁剪） */}
        {tagSpots.map((s, i) => (
          <NameTag key={i} name={STONE_NAMES[i % STONE_NAMES.length]} style={{ left: s.l, top: s.t }} delay={s.d} />
        ))}
        {bottomSpots.map((s, i) => (
          <NameTag key={`b${i}`} name={s.name} hot={s.hot} style={{ left: s.l, top: s.t }} delay={s.d} />
        ))}

        {/* 水晶主体 */}
        <div className="absolute left-1/2 top-[10%] h-[78%] -translate-x-1/2">
          {/* 外发光 */}
          <span aria-hidden="true" className="absolute left-1/2 top-1/2 h-[110%] w-[130%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(120,190,255,0.5),rgba(120,190,255,0.12)_55%,transparent_75%)] [animation:couple-glow-pulse_3.4s_ease-in-out_infinite]" />
          <svg viewBox="0 0 200 320" className="relative h-full w-auto drop-shadow-[0_0_24px_rgba(110,180,250,0.55)]" aria-hidden="true">
            <defs>
              <linearGradient id="cgTop" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f2fbff" />
                <stop offset="100%" stopColor="#9cccef" />
              </linearGradient>
              <linearGradient id="cgL" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#b5d9f4" />
                <stop offset="100%" stopColor="#4d84c4" />
              </linearGradient>
              <linearGradient id="cgR" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8fc0ea" />
                <stop offset="100%" stopColor="#2a5a9a" />
              </linearGradient>
              <linearGradient id="cgCore" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#e8f6ff" />
                <stop offset="50%" stopColor="#7fb3e6" />
                <stop offset="100%" stopColor="#3a6ca8" />
              </linearGradient>
            </defs>
            <polygon points="100,6 152,84 100,128 48,84" fill="url(#cgTop)" />
            <polygon points="48,84 100,128 74,238 100,314 100,128" fill="url(#cgL)" opacity="0.95" />
            <polygon points="152,84 100,128 100,314 128,236" fill="url(#cgR)" />
            <polygon points="100,128 74,238 100,314" fill="url(#cgCore)" opacity="0.75" />
            <polygon points="100,128 128,236 100,314" fill="#1d4a80" opacity="0.55" />
            <polyline points="48,84 100,128 152,84" fill="none" stroke="#ffffff" strokeWidth="1.6" opacity="0.85" />
            <line x1="100" y1="6" x2="100" y2="314" stroke="#ffffff" strokeWidth="1.1" opacity="0.5" />
            <line x1="48" y1="84" x2="74" y2="238" stroke="#ffffff" strokeWidth="0.8" opacity="0.4" />
            <line x1="152" y1="84" x2="128" y2="236" stroke="#ffffff" strokeWidth="0.8" opacity="0.4" />
            <ellipse cx="78" cy="60" rx="16" ry="9" fill="#ffffff" opacity="0.5" transform="rotate(-30 78 60)" />
          </svg>
          {/* 内部闪光粒子 */}
          {[['40%', '22%', 0], ['58%', '34%', 0.8], ['46%', '52%', 1.6], ['55%', '66%', 0.4]].map(([l, t, d], i) => (
            <span key={i} aria-hidden="true" className="absolute h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_8px_#bfe0ff] [animation:couple-twinkle_2.2s_ease-in-out_infinite]" style={{ left: l, top: t, animationDelay: `${d}s` }} />
          ))}
        </div>
        {/* 刻名后：名字浮现于水晶之上（暖光竖排） */}
        {engraved && (
          <div className="absolute left-1/2 top-[34%] z-10 flex -translate-x-1/2 items-start gap-5">
            <span className="rounded-md border border-[#ffd9a8]/60 bg-[rgba(255,200,130,0.18)] px-1.5 py-2 text-[15px] font-semibold tracking-[3px] text-[#ffe9c8] shadow-[0_0_14px_rgba(255,190,120,0.4)] backdrop-blur-[1px] [animation:couple-float-y_4s_ease-in-out_infinite] [writing-mode:vertical-rl]">
              {me}
            </span>
            <span aria-hidden="true" className="mt-4 text-[13px] text-[#ffd98a] [animation:couple-twinkle_2.4s_ease-in-out_infinite]">
              ✦
            </span>
            <span className="rounded-md border border-[#ffd9a8]/60 bg-[rgba(255,200,130,0.18)] px-1.5 py-2 text-[15px] font-semibold tracking-[3px] text-[#ffe9c8] shadow-[0_0_14px_rgba(255,190,120,0.4)] backdrop-blur-[1px] [animation:couple-float-y_4s_ease-in-out_infinite_0.8s] [writing-mode:vertical-rl]">
              {ta}
            </span>
          </div>
        )}
        {/* 底部倒影光斑 */}
        <span aria-hidden="true" className="absolute bottom-[4%] left-1/2 h-10 w-56 -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgba(160,210,255,0.4),transparent)]" />
      </div>

      {/* ===== 底部：刻名按钮 + 说明文字 ===== */}
      <div className="relative z-20 shrink-0 px-8 pb-7">
        <button
          type="button"
          onClick={() => {
            if (engraved) {
              setSheet('ours');
              return;
            }
            patch({ stoneEngraved: true });
            showToast('名字已刻上三生石，缘定三生 💍');
          }}
          className={`relative h-[52px] w-full rounded-xl border text-[19px] font-bold tracking-[6px] backdrop-blur-sm transition-transform active:scale-[0.98] ${
            engraved
              ? 'border-[#ffd9a8]/70 bg-[rgba(255,200,130,0.16)] text-[#ffe9c8] shadow-[0_0_18px_rgba(255,190,120,0.35)]'
              : 'border-[#a8ccf0]/70 bg-[rgba(110,160,220,0.28)] text-white shadow-[0_0_20px_rgba(120,180,240,0.45)]'
          }`}
        >
          {engraved ? '已刻上我们的名字' : '立刻刻上我们的名字'}
          <span aria-hidden="true" className="absolute -right-1 -bottom-1 text-[13px] text-[#bfe0ff]">✦</span>
        </button>
        <p className="mt-3 text-center text-[13.5px] leading-relaxed text-[#b8cde4]">
          {me} 和 {ta} 使用 <span className="font-semibold text-[#ffd98a]">姻缘笔</span> 缔结名簿 缘定三生
        </p>
      </div>

      {/* 说明 / 我们的名字 弹层 */}
      {sheet !== 'none' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 px-8" onClick={() => setSheet('none')}>
          <div className="w-full rounded-2xl border border-[#9fc3e8]/40 bg-[#1c2f52] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {sheet === 'explain' ? (
              <>
                <div className="text-[16px] font-bold text-[#dce9f8]">三生石·说明</div>
                <p className="mt-2 text-[14px] leading-relaxed text-[#a8c0dc]">
                  相传三生石畔，姻缘笔落，名簿留痕——第一生相遇，第二生相知，第三生相守。把两个人的名字刻在一起，从此生生世世，缘定三生。
                </p>
              </>
            ) : (
              <>
                <div className="text-[16px] font-bold text-[#dce9f8]">我们的名字</div>
                <div className="mt-4 flex items-center justify-center gap-4">
                  <span className="rounded-lg border border-[#ffd9a8]/60 bg-[rgba(255,200,130,0.14)] px-4 py-2 text-[16px] font-semibold tracking-widest text-[#ffe9c8]">{me}</span>
                  <Heart className="h-5 w-5 text-[#f0a0b8]" fill="#f0a0b8" />
                  <span className="rounded-lg border border-[#ffd9a8]/60 bg-[rgba(255,200,130,0.14)] px-4 py-2 text-[16px] font-semibold tracking-widest text-[#ffe9c8]">{ta}</span>
                </div>
                <p className="mt-3 text-center text-[12.5px] text-[#8aa4c4]">{engraved ? '三生石上，已刻下你们的名字 ✦' : '还未刻名，点下方按钮刻上你们的名字吧'}</p>
              </>
            )}
            <button type="button" onClick={() => setSheet('none')} className="mt-4 h-11 w-full rounded-full bg-[rgba(150,190,235,0.25)] text-[15px] font-medium text-[#dce9f8]">
              知道了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 回复挑战（第七轮重做，参考图1/2）：黑底粉强调；挑战首页 + 12 关高危回复玩法 */
function ReplyPage({ state, patch, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  const [view, setView] = useState<'home' | 'play' | 'dead' | 'clear'>('home');
  const [lv, setLv] = useState(0);
  const [stats, setStats] = useState({ tm: 72, jc: 42, af: 48, sc: 78 });
  const [picked, setPicked] = useState<number | null>(null);
  const [players, setPlayers] = useState(791662);

  /** 全网挑战人数：每 2.4s 微涨，模拟全网实时在玩 */
  useEffect(() => {
    const t = window.setInterval(() => setPlayers((p) => p + Math.floor(Math.random() * 4)), 2400);
    return () => window.clearInterval(t);
  }, []);

  const start = () => {
    setLv(0);
    setStats({ tm: 72, jc: 42, af: 48, sc: 78 });
    setPicked(null);
    setView('play');
  };

  const clamp = (n: number) => Math.max(0, Math.min(100, n));

  /** 选一个反应：先亮出点评，1.6s 后结算数值 → 下一关 / 死亡 / 通关 */
  const pick = (i: number) => {
    if (picked != null) return;
    setPicked(i);
    const d = REPLY_LEVELS[lv].opts[i].d;
    window.setTimeout(() => {
      const ns = { tm: clamp(stats.tm + d[0]), jc: clamp(stats.jc + d[1]), af: clamp(stats.af + d[2]), sc: stats.sc + d[3] };
      setStats(ns);
      if (ns.sc <= 0) {
        patch({ replyBest: Math.max(state.replyBest ?? 0, lv + 1) });
        setView('dead');
      } else if (lv >= REPLY_LEVELS.length - 1) {
        patch({ replyBest: Math.max(state.replyBest ?? 0, REPLY_LEVELS.length) });
        setView('clear');
      } else {
        setLv(lv + 1);
        setPicked(null);
      }
    }, 1600);
  };

  const level = REPLY_LEVELS[Math.min(lv, REPLY_LEVELS.length - 1)];
  const best = state.replyBest ?? null;

  /** 深色顶栏（SubShell 是浅色底，这里自绘以贴合黑金参考图） */
  const darkHeader = (onBack: () => void) => (
    <div className="shrink-0 bg-[#050506] pt-[54px]">
      <div className="relative flex h-11 items-center px-1.5">
        <button type="button" onClick={onBack} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-opacity active:opacity-50">
          <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
        </button>
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[16px] font-bold text-white">回复挑战</div>
      </div>
    </div>
  );

  /** 数值条（体面值/觉察值/安抚值/存活率） */
  const statChip = (label: string, v: number) => (
    <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.05] px-2.5 pb-2.5 pt-2">
      <div className="text-[10.5px] leading-none text-white/40">{label}</div>
      <div className="mt-1 text-[19px] font-bold leading-none text-white">{v}</div>
      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-[#f9a8d4] transition-[width] duration-700" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-[#050506] text-white">
      {darkHeader(view === 'home' ? close : () => setView('home'))}

      {/* 首页（参考图1）：高危氛围 + 全网数据 + 开始挑战 */}
      {view === 'home' && (
        <div className="flex-1 overflow-y-auto overscroll-contain pb-10">
          {/* 开场对话演示：TA 的轻描淡写 vs 我的心虚 */}
          <div className="space-y-2.5 px-5 pt-4" aria-hidden="true">
            <div className="flex items-end gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#3a3a40] text-[11px] font-semibold text-white">TA</span>
              <span className="rounded-[4px] rounded-tl-none bg-white px-3 py-1.5 text-[14px] text-black">没事，你忙吧。</span>
            </div>
            <div className="flex items-end justify-end gap-2">
              <span className="rounded-[4px] rounded-tr-none bg-[#a8e05f] px-3 py-1.5 text-[14px] text-black">那我先不回了?</span>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#a8e05f] text-[11px] font-semibold text-black">我</span>
            </div>
            <div className="flex items-end gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#3a3a40] text-[11px] font-semibold text-white">TA</span>
              <span className="rounded-[4px] rounded-tl-none bg-white px-3 py-1.5 text-[14px] text-black">随便你。</span>
            </div>
          </div>

          {/* 标签 + 大标题 */}
          <div className="px-5 pt-8">
            <span className="border-b-2 border-[#f9a8d4] pb-0.5 text-[14px] font-semibold text-[#f9a8d4]">情绪高压</span>
          </div>
          <h1 className="mt-3 px-5 text-[32px] font-extrabold leading-tight tracking-tight text-white">恋爱高危回复挑战</h1>
          <p className="mt-2 px-5 text-[15px] leading-relaxed text-white/40">对方说&ldquo;没事&rdquo;的时候，你真的听懂了吗？</p>

          {/* 全网数据卡 */}
          <div className="mx-5 mt-6 rounded-[22px] border border-white/10 bg-white/[0.04] p-5">
            <div className="grid grid-cols-3 items-end">
              <div>
                <div className="text-[24px] font-extrabold leading-none text-[#f9a8d4] tabular-nums">{players.toLocaleString('en-US')}</div>
                <div className="mt-1.5 text-[11px] text-white/35">全网挑战人数</div>
              </div>
              <div className="text-center">
                <div className="text-[24px] font-extrabold leading-none text-white">0.8%</div>
                <div className="mt-1.5 text-[11px] text-white/35">历史通关率</div>
              </div>
              <div className="text-right">
                <div className="text-[24px] font-extrabold leading-none text-[#f9a8d4]">{best == null ? '第4关' : best >= REPLY_LEVELS.length ? '通关🎉' : `第${best}关`}</div>
                <div className="mt-1.5 text-[11px] text-white/35">你的最深纪录</div>
              </div>
            </div>
          </div>

          {/* 开始挑战 */}
          <button
            type="button"
            data-testid="reply-start-btn"
            onClick={start}
            className="mx-5 mt-5 flex h-14 w-[calc(100%-40px)] items-center justify-center rounded-full bg-[linear-gradient(90deg,#f6a6ce_0%,#fbe3e9_100%)] text-[20px] font-bold text-black shadow-[0_10px_30px_rgba(246,166,206,0.25)] transition-transform active:scale-[0.98]"
          >
            开始挑战
          </button>
          <p className="mt-5 text-center text-[12.5px] text-white/30">本挑战专治：自以为讲清楚了，实际上把火烧旺了。</p>

          {/* 旧版高情商回复存档 */}
          {state.replies.length > 0 && (
            <div className="mx-5 mt-9">
              <div className="text-[15px] font-bold text-white/85">我的高情商回复</div>
              <div className="mt-3 space-y-2.5">
                {state.replies.map((r) => (
                  <div key={r.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
                    <div className="text-[12px] text-white/35">{r.prompt}</div>
                    <div className="mt-1.5 text-[14.5px] leading-relaxed text-white/85">{r.reply}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 关卡中（参考图2）：第 N/12 关 + 四数值条 + 场景卡 + A/B/C/D */}
      {view === 'play' && (
        <div className="flex-1 overflow-y-auto overscroll-contain pb-10">
          <div className="px-5 pt-3">
            <div className="text-[13px] font-bold text-[#f9a8d4]">
              第 {lv + 1}/{REPLY_LEVELS.length} 关
            </div>
            <h2 className="mt-1 text-[28px] font-extrabold leading-tight text-white">{level.name}</h2>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 px-4">
            {statChip('体面值', stats.tm)}
            {statChip('觉察值', stats.jc)}
            {statChip('安抚值', stats.af)}
            {statChip('存活率', stats.sc)}
          </div>

          <div className="mx-4 mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.05] p-5">
            <div className="text-[12px] text-white/35">真实恋爱场景</div>
            <p className="mt-3 text-[14.5px] leading-[1.8] text-white/55">{level.scene}</p>
            <div className="mt-4 border-t border-white/10" />
            <p className="mt-4 text-[24px] font-bold leading-snug text-white">{level.quote}</p>
          </div>

          <div className="mt-5 flex items-center justify-between px-5">
            <span className="text-[14px] font-bold text-[#f9a8d4]">你会怎么做</span>
            <span className="text-[12px] text-white/30">{picked == null ? '选择一个反应' : 'TA 正在等你…'}</span>
          </div>

          <div className="mt-3 space-y-2.5 px-4">
            {level.opts.map((o, i) => {
              const isPicked = picked === i;
              const dim = picked != null && !isPicked;
              return (
                <div key={i}>
                  <button
                    type="button"
                    data-testid={`reply-opt-${i}`}
                    disabled={picked != null}
                    onClick={() => pick(i)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-all ${
                      isPicked ? 'border-[#f9a8d4]/70 bg-[#f9a8d4]/[0.12]' : 'border-white/[0.08] bg-white/[0.05] active:bg-white/[0.09]'
                    } ${dim ? 'opacity-35' : ''}`}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#f9a8d4]/[0.14] text-[15px] font-bold text-[#f9a8d4]">{['A', 'B', 'C', 'D'][i]}</span>
                    <span className="flex-1 text-[15px] leading-snug text-white/90">{o.t}</span>
                  </button>
                  {isPicked && (
                    <p className={`mt-2 px-2 text-[12.5px] leading-relaxed ${o.d[3] >= 0 ? 'text-[#f9a8d4]/90' : 'text-white/45'}`} data-testid="reply-verdict">
                      {o.v}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 挑战失败 */}
      {view === 'dead' && (
        <div className="flex flex-1 flex-col items-center justify-center px-8 pb-16">
          <div className="text-[34px] font-extrabold text-white">挑战失败</div>
          <div className="mt-2 text-[15px] font-semibold text-[#f9a8d4]">
            倒在第 {lv + 1} 关 ·「{level.name}」
          </div>
          <p className="mt-4 text-center text-[13.5px] leading-relaxed text-white/40">TA 已经不想说话了。这一次的沉默，比吵架更伤人。</p>
          <div className="mt-6 flex gap-2.5">
            {[
              { l: '体面值', v: stats.tm },
              { l: '觉察值', v: stats.jc },
              { l: '安抚值', v: stats.af },
              { l: '存活率', v: Math.max(0, stats.sc) },
            ].map((s) => (
              <div key={s.l} className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-center">
                <div className="text-[10px] text-white/35">{s.l}</div>
                <div className="mt-0.5 text-[16px] font-bold text-white">{s.v}</div>
              </div>
            ))}
          </div>
          <button type="button" onClick={start} className="mt-9 flex h-14 w-full items-center justify-center rounded-full bg-[linear-gradient(90deg,#f6a6ce,#fbe3e9)] text-[18px] font-bold text-black transition-transform active:scale-[0.98]">
            再挑战一次
          </button>
          <button type="button" onClick={() => setView('home')} className="mt-3 h-12 w-full rounded-full bg-white/[0.08] text-[15px] font-medium text-white/70">
            回到首页
          </button>
        </div>
      )}

      {/* 通关成功 */}
      {view === 'clear' && (
        <div className="flex flex-1 flex-col items-center justify-center px-8 pb-16">
          <div className="text-[40px]" aria-hidden="true">
            🎉
          </div>
          <div className="mt-2 text-[32px] font-extrabold text-[#f9a8d4]">通关成功</div>
          <p className="mt-3 text-center text-[14.5px] leading-relaxed text-white/55">
            {REPLY_LEVELS.length} 关全过 · 你已经听懂了
            <br />
            那些没说出口的话
          </p>
          <div className="mt-6 flex gap-2.5">
            {[
              { l: '体面值', v: stats.tm },
              { l: '觉察值', v: stats.jc },
              { l: '安抚值', v: stats.af },
              { l: '存活率', v: Math.max(0, stats.sc) },
            ].map((s) => (
              <div key={s.l} className="rounded-xl border border-[#f9a8d4]/25 bg-[#f9a8d4]/[0.08] px-3 py-2 text-center">
                <div className="text-[10px] text-[#f9a8d4]/70">{s.l}</div>
                <div className="mt-0.5 text-[16px] font-bold text-white">{s.v}</div>
              </div>
            ))}
          </div>
          <button type="button" onClick={start} className="mt-9 flex h-13 w-full items-center justify-center rounded-full bg-white/[0.08] text-[16px] font-semibold text-white/85 transition-transform active:scale-[0.98]">
            再挑战一次
          </button>
          <button type="button" onClick={() => setView('home')} className="mt-3 h-12 w-full rounded-full bg-white/[0.08] text-[15px] font-medium text-white/70">
            回到首页
          </button>
        </div>
      )}
    </div>
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

/** 情侣印象词库（参考图4 风格，换一批轮换） */
const IMPRESSION_POOL = [
  '教科书式的恋爱',
  '男友力max',
  '一生幸福',
  '笔芯',
  '甜蜜暴击',
  '默默吞下这碗狗粮',
  '颜王cp',
  '坐等喝喜酒',
  '国民夫妇',
  '天生一对',
  '双向奔赴',
  '甜甜的恋爱',
  '模范情侣',
  '灵魂伴侣',
  '心动信号站',
  '撒糖机',
  '吵架不过夜',
  '永远的神',
  '每日亲亲',
  '牵手散步',
  '甜到冒泡',
  '惹人羡慕',
  '稳稳的幸福',
  '小两口的快乐',
];

/** 情侣印象（第八轮重做，参考图4）：粉渐变横幅 + 双头像选贴的对象 + 词库点选贴标签（每人最多5个）+ 自定义 + 换一批 + 提交 */
function ImpressPage({ state, patch, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void }) {
  // 主 App 传入的 patch 实际支持函数式 updater（运行时是宽化函数），此处取函数式形态用于原子更新
  const patchFn = patch as unknown as (p: Partial<CoupleState> | ((prev: CoupleState) => Partial<CoupleState>)) => void;
  const [target, setTarget] = useState<'me' | 'ta'>('ta');
  const [custom, setCustom] = useState('');
  const [batch, setBatch] = useState<string[]>(() => IMPRESSION_POOL.slice(0, 9));

  const tags = target === 'me' ? state.impressionsMe : state.impressionsTa;
  const otherTags = target === 'me' ? state.impressionsTa : state.impressionsMe;

  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (tags.includes(t)) {
      showToast('这个标签已经贴过啦');
      return;
    }
    if (tags.length >= 5) {
      showToast('最多贴 5 个词，先提交吧');
      return;
    }
    // 函数式更新：快速连点也逐条生效（读 prev 而非 render 快照）
    patchFn((prev) => {
      const cur = target === 'me' ? prev.impressionsMe : prev.impressionsTa;
      if (cur.includes(t) || cur.length >= 5) return {};
      return target === 'me' ? { impressionsMe: [...cur, t] } : { impressionsTa: [...cur, t] };
    });
    showToast('标签已贴上 ♡');
  };

  const removeTag = (t: string) =>
    patchFn((prev) =>
      target === 'me' ? { impressionsMe: prev.impressionsMe.filter((x) => x !== t) } : { impressionsTa: prev.impressionsTa.filter((x) => x !== t) },
    );

  const shuffle = () => {
    const used = new Set([...tags, ...otherTags]);
    const src = IMPRESSION_POOL.filter((w) => !used.has(w));
    const pool = src.length >= 9 ? src : [...src, ...IMPRESSION_POOL.filter((w) => !tags.includes(w))];
    const out = [...new Set(pool)];
    // 洗牌取前 9
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    setBatch(out.slice(0, 9));
  };

  const avatarBlock = (side: 'me' | 'ta') => {
    const active = target === side;
    const name = side === 'me' ? state.meName || '我' : state.taName || 'TA';
    const avatar = side === 'me' ? state.meAvatar : state.taAvatar;
    return (
      <button
        type="button"
        data-testid={`impress-target-${side}`}
        onClick={() => setTarget(side)}
        className="flex w-[76px] flex-col items-center gap-1.5"
        aria-label={`贴给${side === 'me' ? '我' : 'TA'}`}
      >
        <span className={`relative h-[64px] w-[64px] overflow-hidden rounded-full bg-[#ececef] transition-shadow ${active ? 'shadow-[0_0_0_3px_#fff,0_0_0_6px_#f2536a]' : 'shadow-[0_0_0_3px_#fff,0_4px_12px_rgba(0,0,0,0.10)]'}`}>
          {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" draggable={false} /> : <DefaultAvatar size={64} />}
          {active && (
            <span className="absolute -right-0.5 -top-0.5 grid h-5 w-5 place-items-center rounded-full bg-[#f2536a] text-[10px] font-bold text-white shadow">✓</span>
          )}
        </span>
        <span className={`max-w-full truncate text-[12.5px] ${active ? 'font-bold text-[#f2536a]' : 'text-[#6e6e76]'}`}>{name}</span>
      </button>
    );
  };

  return (
    <SubShell title="情侣印象" onBack={close}>
      {/* 粉渐变横幅（参考图4） */}
      <div className="-mx-3.5 -mt-0 select-none bg-[linear-gradient(120deg,#f789a4_0%,#f2536a_58%,#ee4b62_100%)] px-5 pb-12 pt-5 text-center">
        <div className="flex items-center justify-center gap-1.5 text-[24px] font-extrabold leading-tight text-white">
          先选
          <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-white text-[21px] font-extrabold text-[#f2536a] shadow-[0_3px_10px_rgba(0,0,0,0.12)]">5</span>
          个词自评一下你们吧
        </div>
      </div>

      {/* 双头像卡（压在横幅上） */}
      <div className="-mt-9 rounded-2xl bg-white px-4 pb-5 pt-5 shadow-[0_8px_24px_rgba(0,0,0,0.07)]">
        <div className="flex items-start justify-center gap-9">{avatarBlock('me')}{avatarBlock('ta')}</div>
        <div className="mt-4 border-t border-dashed border-[#e9e9ee] pt-3 text-center">
          <div className="text-[12.5px] text-[#9a9aa2]">
            {target === 'me' ? 'TA 眼中的你' : '你眼中的 TA'} · 已贴 {tags.length}/5
          </div>
          {tags.length === 0 ? (
            <div className="mt-3 rounded-lg border-x-0 border-dashed border-[#f0e3e5] py-3 text-[14px] text-[#c58f9c]" data-testid="impress-empty">
              还没有人贴过印象哦
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap justify-center gap-2" data-testid="impress-current-tags">
              {tags.map((t) => (
                <span key={t} className="flex items-center gap-1 rounded-full bg-[#fff0f4] px-3 py-1.5 text-[13px] text-[#e0607e]">
                  {t}
                  {(state.aiImpressions ?? []).includes(t) && target === 'me' && (
                    <span className="rounded-full bg-[#eef2fd] px-1.5 py-px text-[9px] font-bold text-[#7f96e0]">TA贴</span>
                  )}
                  <button type="button" onClick={() => removeTag(t)} aria-label={`删除标签${t}`} className="text-[#e5a0b0] active:opacity-60">
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 词库标签墙 */}
      <div className="mt-5 flex flex-wrap gap-2.5" data-testid="impress-pool">
        {batch.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => addTag(w)}
            className="rounded-lg border border-[#f7dbe2] bg-white px-3.5 py-2 text-[13.5px] text-[#3c3c42] shadow-[0_2px_8px_rgba(242,83,106,0.10)] transition-transform active:scale-95"
          >
            {w}
          </button>
        ))}
      </div>

      {/* 自定义 + 换一批 */}
      <div className="mt-4 flex items-center gap-2.5">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom.trim()) {
              addTag(custom);
              setCustom('');
            }
          }}
          placeholder="自定义…"
          maxLength={10}
          className="h-11 flex-1 rounded-xl border-2 border-dashed border-[#f0dfe3] bg-white/70 px-3.5 text-[14px] outline-none placeholder:text-[#c9c9cf]"
        />
        <button
          type="button"
          onClick={shuffle}
          data-testid="impress-shuffle"
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[14px] font-medium text-[#f2536a] active:opacity-60"
        >
          <RefreshCcw className="h-4 w-4" />
          换一批
        </button>
      </div>

      {/* 底部提交（吸底） */}
      <div className="sticky bottom-0 -mx-3.5 mt-6 bg-[linear-gradient(180deg,rgba(255,255,255,0),#fff_38%)] px-3.5 pb-6 pt-4">
        <button
          type="button"
          data-testid="impress-submit"
          onClick={() => showToast(tags.length > 0 ? '印象已提交，甜甜的恋爱值 +1 ♡' : '先选几个词再提交吧')}
          className="h-[50px] w-full rounded-full bg-[linear-gradient(135deg,#f789a4,#f2536a)] text-[16.5px] font-semibold text-white shadow-[0_8px_22px_rgba(242,83,106,0.32)] transition-transform active:scale-[0.98]"
        >
          提 交
        </button>
      </div>
    </SubShell>
  );
}

/** 恋爱资料（参考图2）：iOS 分组列表（头像/昵称/性别/情侣号/恋人证书/登录记录/解除关系） */
function ProfilePage({ state, patch, showToast, close, onReset }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; showToast: (m: string) => void; close: () => void; onReset: () => void }) {
  const meInput = useRef<HTMLInputElement | null>(null);
  const [dialog, setDialog] = useState<null | 'nickname' | 'gender' | 'cert' | 'logins' | 'reset'>(null);
  const [nickDraft, setNickDraft] = useState('');

  const pickAvatar = async (f: File | null) => {
    if (!f) return;
    try {
      const url = await fileToScaledDataURL(f, 360, 0.85);
      patch({ meAvatar: url });
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
          <span className="text-[14.5px]">解除关系</span>
          {chev}
        </button>
      </div>

      <p className="mt-4 px-2 text-[12px] leading-relaxed text-[#b6b6bd]">情侣号是你们的小家门牌号，头像、昵称、性别都可以随时修改。</p>

      {/* 隐藏文件选择（我的头像） */}
      <input
        ref={meInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pickAvatar(e.target.files?.[0] ?? null);
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

/** 每天想你记录页（参考图4）：大粉心 + 我/他连续天数 + 去提醒他 + 心形月历 + 补签卡 */
function MissYouPage({ state, patch, tapMissYou, showToast, close }: { state: CoupleState; patch: (p: Partial<CoupleState>) => void; tapMissYou: () => void; showToast: (m: string) => void; close: () => void }) {
  const [monthOff, setMonthOff] = useState(0); // 0=本月，1=上月
  const [sheet, setSheet] = useState<'none' | 'explain' | 'record'>('none');
  const today = todayKey();
  const madeUp = new Set(state.missMadeUp || []);
  const hit = (k: string) => (state.missYouByDay[k] || 0) > 0 || madeUp.has(k);

  /** 我连续想他：从今天（若今天未打卡则从昨天）往回连续计数 */
  const myStreak = useMemo(() => {
    let n = 0;
    const start = new Date();
    if (!hit(todayKey(start))) start.setDate(start.getDate() - 1);
    for (;;) {
      if (!hit(todayKey(start))) break;
      n += 1;
      start.setDate(start.getDate() - 1);
    }
    return n;
     
  }, [state.missYouByDay, state.missMadeUp]);
  /** TA（AI）连续想我：从今天（若今天未打卡则从昨天）往回连续计数（第九轮：AI 每天想你） */
  const taHit = (k: string) => (state.taMissYouByDay?.[k] ?? 0) > 0;
  const taStreak = useMemo(() => {
    let n = 0;
    const start = new Date();
    if (!taHit(todayKey(start))) start.setDate(start.getDate() - 1);
    for (;;) {
      if (!taHit(todayKey(start))) break;
      n += 1;
      start.setDate(start.getDate() - 1);
    }
    return n;
  }, [state.taMissYouByDay]);
  const taTodayMiss = state.taMissYouByDay?.[today] ?? 0;
  const taMissTotal = state.taMissYou ?? 0;

  /** 展示月份 */
  const base = new Date();
  const view = new Date(base.getFullYear(), base.getMonth() - monthOff, 1);
  const year = view.getFullYear();
  const month = view.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0=周日
  const todayNum = base.getDate();
  const isThisMonth = monthOff === 0;

  /** 本月是否存在断签（missSince 起始之后、今天之前有未打卡日） */
  const sinceStart = state.missSince ? new Date(`${state.missSince}T00:00:00`) : null;
  const hasBreak = useMemo(() => {
    if (!sinceStart) return false;
    for (let d = 1; d <= (isThisMonth ? todayNum : daysInMonth); d++) {
      const dt = new Date(year, month, d);
      if (dt < sinceStart || dt.getTime() >= new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime()) continue;
      if (!hit(todayKey(dt))) return true;
    }
    return false;
     
  }, [state.missSince, state.missYouByDay, state.missMadeUp, monthOff]);

  /** 补签：消耗一张补签卡 */
  const makeUp = (key: string) => {
    if ((state.missCards || 0) <= 0) return;
    patch({ missCards: (state.missCards || 0) - 1, missMadeUp: [...(state.missMadeUp || []), key] });
    showToast('补签成功，想念不断签 ♡');
  };
  /** 获得补签卡（演示） */
  const gainCard = () => {
    patch({ missCards: (state.missCards || 0) + 1 });
    showToast('获得 1 张想你补签卡 ♡');
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 顶栏 */}
      <div className="shrink-0 bg-white pt-[54px]">
        <div className="relative flex h-11 items-center px-1.5">
          <button type="button" onClick={close} aria-label="返回" className="flex h-9 w-9 items-center justify-center rounded-full text-[#3a3a40] transition-opacity active:opacity-50">
            <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[17px] font-bold">想你记录</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {/* 大粉心（点击也能打卡） */}
        <button type="button" onClick={tapMissYou} aria-label="想你 +1" className="mx-auto mt-2 block transition-transform active:scale-95">
          <svg viewBox="0 0 100 100" className="h-[104px] w-[112px]" aria-hidden="true">
            <defs>
              <linearGradient id="missHeartG" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ff8fa8" />
                <stop offset="55%" stopColor="#f85e83" />
                <stop offset="100%" stopColor="#ef4a70" />
              </linearGradient>
            </defs>
            <path d="M50 88 C22 64 8 46 8 30 A21 21 0 0 1 50 24 A21 21 0 0 1 92 30 C92 46 78 64 50 88Z" fill="url(#missHeartG)" />
            <ellipse cx="32" cy="30" rx="11" ry="7" fill="#ffffff" opacity="0.45" transform="rotate(-24 32 30)" />
          </svg>
        </button>

        {/* 连续天数 */}
        <div className="mt-1 text-center text-[16px] text-[#3c3c42]">
          我连续想他 <b className="mx-0.5 align-middle text-[27px] font-extrabold text-[#f0436e]">{myStreak}</b> 天 / 他连续想我{' '}
          <b className="mx-0.5 align-middle text-[27px] font-extrabold text-[#4a90f2]">{taStreak}</b> 天
        </div>
        {taMissTotal > 0 && (
          <div className="mt-1 text-center text-[12px] text-[#8fb3e8]">TA 累计想了你 {taMissTotal} 次 · 每天都会想你 ♡</div>
        )}

        {/* 去提醒他 */}
        <div className="mt-3 flex flex-col items-center">
          <button
            type="button"
            onClick={() => showToast('已经去提醒他啦，让他快来想你 ♡')}
            className="h-11 w-[196px] rounded-full bg-[linear-gradient(90deg,#4a9df3,#2f7fe8)] text-[16px] font-semibold text-white shadow-[0_6px_16px_rgba(60,130,230,0.35)] transition-transform active:scale-[0.97]"
          >
            去提醒他
          </button>
          <span className="mt-2 text-[13px] text-[#b6b6bd]">{taTodayMiss > 0 ? `TA 今天也想了你 ${taTodayMiss} 次 ♡` : '今天他还没来过哦~'}</span>
        </div>

        {/* 有断签 + 月份切换 */}
        <div className="mt-6 flex items-end justify-between px-4">
          {hasBreak ? (
            <span className="relative -mb-1 rounded-full bg-[#ffc93c] px-2.5 py-[3px] text-[11px] font-bold text-[#7a4e00] shadow-sm">
              ❗有断签
              <span aria-hidden="true" className="absolute -bottom-1 left-3 h-2 w-2 rotate-45 bg-[#ffc93c]" />
            </span>
          ) : (
            <span />
          )}
        </div>
        <div className="relative flex h-11 items-center justify-center bg-[#fdf0f3]">
          <button
            type="button"
            onClick={() => setMonthOff((o) => o + 1)}
            aria-label="上一月"
            className="absolute left-3 flex h-8 w-8 items-center justify-center text-[#8a8a92]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <span className="text-[16px] font-semibold text-[#4a4a52]">
            {year}年{month + 1}月
          </span>
          {monthOff > 0 && (
            <button
              type="button"
              onClick={() => setMonthOff((o) => Math.max(0, o - 1))}
              aria-label="下一月"
              className="absolute right-3 flex h-8 w-8 items-center justify-center text-[#8a8a92]"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M9 5l7 7-7 7" /></svg>
            </button>
          )}
        </div>

        {/* 心形日历 */}
        <div className="grid grid-cols-7 gap-y-2 px-3 py-4">
          {Array.from({ length: firstWeekday }).map((_, i) => (
            <span key={`b${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const d = i + 1;
            const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isToday = isThisMonth && d === todayNum;
            const isFuture = isThisMonth ? d > todayNum : new Date(year, month, d) > base;
            const done = hit(key);
            if (isFuture) {
              return (
                <span key={key} className="flex flex-col items-center">
                  <span className="flex h-[42px] w-[42px] items-center justify-center rounded-2xl bg-[#ececef]">
                    <svg viewBox="0 0 100 100" className="h-6 w-6 opacity-70">
                      <path d="M50 88 C22 64 8 46 8 30 A21 21 0 0 1 50 24 A21 21 0 0 1 92 30 C92 46 78 64 50 88Z" fill="#ffffff" />
                    </svg>
                  </span>
                </span>
              );
            }
            if (done) {
              return (
                <button key={key} type="button" onClick={tapMissYou} aria-label={`${key} 已想你`} className="flex flex-col items-center transition-transform active:scale-90">
                  <span className="relative flex h-[42px] w-[46px] items-center justify-center">
                    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
                      <defs>
                        <linearGradient id={`mg${key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#ffaebf" />
                          <stop offset="100%" stopColor="#f7738f" />
                        </linearGradient>
                      </defs>
                      <path d="M50 88 C22 64 8 46 8 30 A21 21 0 0 1 50 24 A21 21 0 0 1 92 30 C92 46 78 64 50 88Z" fill={`url(#mg${key})`} />
                    </svg>
                    {isToday ? (
                      <span className="relative text-[10px] font-bold text-white">今日</span>
                    ) : (
                      <span className="relative text-[13px] font-semibold text-white/95">{d}</span>
                    )}
                  </span>
                </button>
              );
            }
            // 过去未打卡（可补签）
            const canMakeUp = isThisMonth && (state.missCards || 0) > 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  if (!canMakeUp) {
                    showToast('没有补签卡啦，先点下方 + 号获得一张吧');
                    return;
                  }
                  makeUp(key);
                }}
                aria-label={`${key} 未打卡，点击补签`}
                className="flex flex-col items-center transition-transform active:scale-90"
              >
                <span className="relative flex h-[42px] w-[46px] items-center justify-center">
                  <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
                    <path d="M50 88 C22 64 8 46 8 30 A21 21 0 0 1 50 24 A21 21 0 0 1 92 30 C92 46 78 64 50 88Z" fill="#ffffff" stroke="#f0a9ba" strokeWidth="5" />
                  </svg>
                  <span className="relative text-[13px] font-semibold text-[#8a5560]">{d}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* 补签卡 */}
        <div className="mt-2 flex items-center justify-center gap-1.5 pb-2 text-[15px] text-[#3c3c42]">
          你们有 <b className="mx-0.5 text-[19px] font-extrabold text-[#f0436e]">{state.missCards || 0}</b>
          <button
            type="button"
            onClick={gainCard}
            aria-label="获得补签卡"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[linear-gradient(180deg,#f9a8c0,#f387a7)] text-[15px] font-bold leading-none text-white shadow-sm"
          >
            +
          </button>
          张想你补签卡
        </div>

        {/* 说明/记录链接 */}
        <div className="flex items-center justify-center gap-10 pb-8 pt-2">
          <button type="button" onClick={() => setSheet('explain')} className="flex items-center gap-1 text-[14px] font-medium text-[#f0436e] underline underline-offset-4">
            <HelpCircle className="h-4 w-4" /> 补签卡说明
          </button>
          <button type="button" onClick={() => setSheet('record')} className="flex items-center gap-1 text-[14px] font-medium text-[#f0436e] underline underline-offset-4">
            <Heart className="h-4 w-4" /> 补签卡记录
          </button>
        </div>
      </div>

      {/* 说明 / 记录弹层 */}
      {sheet !== 'none' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 px-8" onClick={() => setSheet('none')}>
          <div className="w-full rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {sheet === 'explain' ? (
              <>
                <div className="text-[16px] font-bold text-[#2c2c30]">补签卡说明</div>
                <p className="mt-2 text-[14px] leading-relaxed text-[#5a5a62]">
                  每天回来点一次「想你」即为当天打卡；断签的日子可以用补签卡补上，连续天数就不会断啦。点击日历上空心的日子即可补签，点下方 + 号可获得补签卡（演示）。
                </p>
              </>
            ) : (
              <>
                <div className="text-[16px] font-bold text-[#2c2c30]">补签卡记录</div>
                <div className="mt-3 max-h-[46vh] space-y-2 overflow-y-auto">
                  {(state.missMadeUp || []).length === 0 ? (
                    <div className="py-8 text-center text-[14px] text-[#b6b6bd]">还没有补签过哦~</div>
                  ) : (
                    (state.missMadeUp || []).map((k) => (
                      <div key={k} className="flex items-center justify-between rounded-xl bg-[#fdf0f3] px-4 py-2.5 text-[14px] text-[#5a5a62]">
                        <span>{fmtDateCn(k)}</span>
                        <span className="text-[12px] font-semibold text-[#f0436e]">已补签 ♡</span>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
            <button type="button" onClick={() => setSheet('none')} className="mt-4 h-11 w-full rounded-full bg-[#f3f3f5] text-[15px] font-medium text-[#5a5a62]">
              知道了
            </button>
          </div>
        </div>
      )}
    </div>
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

      {/* TA 在恋人空间做的事（第九轮：AI 深度参与，全部写进记忆；此处透明展示最近 12 条） */}
      {(state.aiLog ?? []).length > 0 && (
        <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm" data-testid="ai-log">
          <div className="text-[14.5px] font-bold text-[#2c2c30]">
            {state.taName || 'TA'} 最近在你们的小天地里做的事
          </div>
          <div className="mt-2 space-y-1.5">
            {state.aiLog.slice(0, 12).map((l) => (
              <div key={l.id} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-[#6e6e76]">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#f2536a]/70" />
                <span className="min-w-0 flex-1">{l.text}</span>
                <span className="shrink-0 text-[10.5px] text-[#c9c9cf]">{fmtDate(l.at).slice(5)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] leading-relaxed text-[#c9c9cf]">TA 做的每一件事、你记录的每一件事，都会写进 TA 的记忆，聊天时都记得。</div>
        </div>
      )}

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
