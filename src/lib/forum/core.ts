'use client';

/**
 * X论坛 · 数据层（v1）。
 *
 * - 数据整体存 IndexedDB kv 单键 `forum-data-v1`（ios-phone-db，经 idb-kv 同步读/异步写）；
 * - 作者三类：user（机主）/ char:<联系人id>（AI 角色）/ npc:<id>（内置论坛网友，给广场人气）；
 * - NPC 帖子/回复：LLM 生成（/api/forum/generate），失败时落 NPC 内置文案池兜底——论坛永远不空；
 * - 订阅：轻量 rev 计数 + window 事件，组件用 useForumData()（useSyncExternalStore）取快照。
 */

import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { listContacts, ownerRealName } from '@/lib/ios/contacts-store';
import type { ContactRecord } from '@/lib/contacts';

// ---------------- 常量 ----------------

export const FORUM_KEY = 'forum-data-v1';
/** 首次播种的 NPC 帖子目标条数（feed 一屏半左右） */
export const SEED_POST_TARGET = 14;
/** 补新帖：feed 最新帖子超过该毫秒数视为「凉了」，打开时补 2~4 条 */
export const STALE_MS = 2 * 60 * 60 * 1000;
/** 单帖正文上限（X 长帖风格，超出截断） */
export const POST_MAX = 280;
/** 回复上限 */
export const REPLY_MAX = 140;

// ---------------- 数据模型 ----------------

export type AuthorKey = string; // 'user' | 'char:<contactId>' | 'npc:<id>' | 'official'

export interface ForumAuthor {
  key: AuthorKey;
  name: string;
  handle: string; // 不带 @
  avatar: string | null; // dataURL（user/char）；NPC 为 null（用彩底首字）
  /** NPC 彩底头像（bg 色值 + 显示字） */
  npcAvatar?: { bg: string; ch: string };
  /** 认证蓝 V（大 V NPC / 官方账号） */
  verified?: boolean;
  /** 一句话简介（个人页展示） */
  bio?: string;
  /** 粉丝数（NPC 基础值；user/char 动态算） */
  baseFollowers?: number;
  /** 生成用人设（NPC 发帖/回复的 LLM prompt；char 用联系人 persona） */
  persona?: string;
}

export interface ForumPost {
  id: string;
  authorKey: AuthorKey;
  content: string;
  /** 版块 id（null = 今日热议广场） */
  community: string | null;
  createdAt: number;
  /** 点过赞的作者 key 列表（含 'user'） */
  likes: AuthorKey[];
  /** 转推数（模拟增长） */
  reposts: number;
  views: number;
  /** 我是否转推过（X 转推可撤销；true 时绿高亮） */
  reposted?: boolean;
  /** 回复链：回复某帖时同时是一条帖（X 语义：回复即发帖） */
  replyTo: string | null;
  replyToName: string | null;
}

export interface ForumCommunity {
  id: string;
  name: string;
  desc: string;
  /** 头部封面底色（X Communities 卡片风格） */
  coverBg: string;
  /** 成员数（展示值） */
  members: number;
  joined: boolean;
}

export interface ForumNotification {
  id: string;
  type: 'like' | 'reply' | 'repost' | 'follow' | 'system';
  fromKey: AuthorKey;
  /** type=like/repost 时指向被互动的帖子；reply 时指向回复帖 */
  postId: string | null;
  /** 通知正文（system 用；like/reply 由前端拼） */
  text?: string;
  createdAt: number;
  read: boolean;
}

export interface ForumDm {
  /** 对话作者 key */
  peerKey: AuthorKey;
  messages: { id: string; from: AuthorKey; text: string; at: number }[];
}

export interface ForumData {
  v: 1;
  posts: ForumPost[];
  communities: ForumCommunity[];
  notifications: ForumNotification[];
  dms: ForumDm[];
  following: AuthorKey[];
  likesByMe: Record<string, true>;
  /** 主页顶部分类标签（版块 id 列表，显示为「为你推荐|关注」后的附加 tab） */
  pinnedTags?: string[];
  /** 论坛内自定义资料（编辑资料后生效；未编辑字段跟随全局机主资料） */
  profile?: ForumProfile;
  seeded: boolean;
  lastGenAt: number;
  joinedAt: number;
}

/** 论坛个人资料自定义（槽位隔离语义，与微信/QQ 头像三入口同口径）：
 *  每个字段未设置（undefined/null/空串）→ 跟随全局（设置›个人信息/联系人机主）；
 *  设置过后 → 论坛内优先使用这里的值，不再随全局变化。 */
export interface ForumProfile {
  /** 自定义名字（空 = 跟随全局机主名） */
  name?: string;
  /** 自定义头像 dataURL（空 = 跟随全局头像；全局也没有 → XAvatar 默认头像图） */
  avatar?: string | null;
  /** 自定义简介（空 = 「X论坛用户」） */
  bio?: string;
  /** 主页背景图 dataURL（从手机上传，居中裁剪 3:1） */
  banner?: string | null;
  /** 自定义「正在关注」展示数（undefined = 真实关注数） */
  followingCount?: number;
  /** 自定义「关注者」展示数（undefined = 默认公式值） */
  followersCount?: number;
}

// ---------------- 内置数据（NPC / 版块 / 官方账号） ----------------

/** NPC 论坛网友：名字（X handle）+ 一句话人设（LLM 与文案池共用）。
 *  粉丝数/蓝 V/头像色按真实感配置；handle 用全小写无空格（X 风格）。 */
export const NPC_DEFS: {
  id: string;
  name: string;
  handle: string;
  bg: string;
  bio: string;
  followers: number;
  verified?: boolean;
  persona: string;
  pool: string[];
  replies: string[];
}[] = [
  {
    id: 'wang',
    name: '老王谈数码',
    handle: 'laowang_digital',
    bg: '#1d892f',
    bio: '数码博主｜测评只说真话｜合作私信',
    followers: 128400,
    verified: true,
    persona: '资深数码博主老王，说话直接接地气，爱用「兄弟们」开头，偶尔毒舌吐槽厂商，对新机如数家珍，立场中立不站队。',
    pool: [
      '兄弟们，今天摸了摸新机的工程机，手感确实比上一代圆润不少，就是这定价我看不懂。等一个首发跳水。#数码圈#',
      '凌晨蹲测评的都散了吧，结论一句话：等等党永远不亏。#数码圈#',
      '把家里抽屉翻出来数了数，这些年评测过的机器没有一百也有八十，最良心的还得是三年前那台小钢炮。#数码圈#',
      '评论区总有人问「这预算买什么」，说真的，预算之内先买喜欢的，参数是给机器看的，喜欢才是给自己用的。#数码圈#',
      '今天直播拆了台二手机，里面灰厚得能种菜。兄弟们，隔半年清一次灰，机器能多活两年。#数码圈#',
      '新系统更新了，续航实测掉了半个多小时，先别升，等我两天复测。#数码圈#',
      '说个行业冷知识：很多「限量配色」其实不限量，只是产能有限。别为配色加价，不值。#数码圈#',
      '收到私信问「学生党第一台电脑」，统一回复：轻本+大内存，别追独显，图书馆里风扇一响全桌看你。#数码圈#',
    ],
    replies: [
      '兄弟说得对，我也是这个看法。',
      '这个观点我保留，等实测出来再聊。',
      '哈哈，评论区终于有人说人话了。',
      '来了来了，老王认证，这条说得在理。',
      '同感，我上次也踩过这个坑。',
    ],
  },
  {
    id: 'canteen',
    name: '深夜食堂掌柜',
    handle: 'night_canteen',
    bg: '#c4392f',
    bio: '凌晨不打烊｜一人食菜单每日更新',
    followers: 89200,
    verified: true,
    persona: '深夜食堂老板娘，温柔絮叨，爱聊吃的，说话带烟火气，句尾偶尔带「呀」「呢」，最懂深夜胃和心事。',
    pool: [
      '今晚的隐藏菜单是酱油炒面，加了点猪油，香得整条街都闻得到。深夜路过的一人食，随时进。#吃货联盟#',
      '有位客人说，吃下第一口的时候眼泪掉下来了。我说没事，食物接住你了。#深夜树洞#',
      '今日观察：深夜来店里的，八成不是为了吃，是为了有个亮着灯的地方。都可以，本店不问来路。#深夜树洞#',
      '刚熬好的高汤，留给还没睡的人。今天的故事换今晚打八折。#深夜树洞#',
      '收摊前最后一碗馄饨出锅。今晚风大，吃完这碗再回家。#吃货联盟#',
      '各位深夜档，掌柜提醒：泡面加个蛋是对自己最起码的尊重。#吃货联盟#',
      '店里的猫都睡了，你们还在熬什么呀。来，报个数，我看看要不要给你们留锅。#深夜树洞#',
    ],
    replies: [
      '这个点还醒着呀，来碗热的？',
      '说得对，吃好睡好，天大的事明天再说。',
      '本店认证，这条比菜单还下饭。',
      '深夜档的都看看这条，掌柜盖章了。',
    ],
  },
  {
    id: 'kitty',
    name: '阿喵不加班',
    handle: 'no_overtime_cat',
    bg: '#7b4fe0',
    bio: '互联网打工人｜摸鱼大师｜反卷先锋',
    followers: 45300,
    persona: '互联网公司打工人阿喵，嘴碎爱吐槽，反内卷反加班，工位摸鱼大师，说话带梗，句式夸张，但句句都是打工人的真心话。',
    pool: [
      '今日份摸鱼成果：用带薪如厕完成了本周 KPI 的思考，用接水时间完成了同事八卦的信息同步。下班，理直气壮。#职场摸鱼#',
      '领导说「年轻人要有冲劲」。有啊，我的冲劲全用在下班前一小时收拾东西上了。#职场摸鱼#',
      '公司新福利：免费咖啡。翻译一下：用一杯美式换你两小时加班，血赚的是谁不用我说了吧。#职场摸鱼#',
      '面试官问「你的缺点是什么」，现在标准答案：缺点是下班太准时，正在努力改（不是）。#职场摸鱼#',
      '同事都在假装很忙，我在假装假装很忙。高下立判。#职场摸鱼#',
      '周报文学最新力作：把「这周啥也没干」翻译成「持续探索中，对齐了颗粒度，沉淀了方法论」。#职场摸鱼#',
      '打工人周二问候：距离周末还有三天，距离发工资还有十七天，距离退休还有四十年。加油呢。#职场摸鱼#',
      '刚看到一个词「自愿加班」，笑了。什么时候发明个「自愿上班」我敬你是条汉子。#职场摸鱼#',
    ],
    replies: [
      '哈哈哈哈这条转我工位了。',
      '工友认证，句句属实。',
      '说得太对了，已截图当周一精神支柱。',
      '卷王看了沉默，摸鱼人看了狂喜。',
    ],
  },
  {
    id: 'iron',
    name: '健身狂人铁铁',
    handle: 'iron_tietie',
    bg: '#0f7d9c',
    bio: '撸铁十年｜自然健身｜拒绝焦虑贩卖',
    followers: 76100,
    verified: true,
    persona: '健身博主铁铁，语气热血爱打气，爱用「冲」「干就完了」，最烦身材焦虑，主张健康第一快乐第二。',
    pool: [
      '今天练腿，练完扶墙走的兄弟评论区集合。腿不是白练的，是换来的。#健身打卡#',
      '重申一万遍：健身房没有鄙视链，推空杆的和推两百公斤的都是自己人生的主角。冲就完了。#健身打卡#',
      '有人问我练了十年最大的收获是什么。体脂率吗？不是，是每天那一个多小时只属于自己的时间。#健身打卡#',
      '新手三大坑：盲目上重量、只练胸不练背、天天称体重。都避开的评论区扣个「稳」。#健身打卡#',
      '今天状态拉了胯，两组就喘。也正常，状态是波动的，别跟自己置气，明天再来就是。#健身打卡#',
      '深夜刷到我的人，别熬夜了，肌肉是睡出来的不是熬出来的。晚安，明早六点铁馆见。#健身打卡#',
    ],
    replies: [
      '冲！这条说得够铁。',
      '干就完了，兄弟。',
      '练背日看到这条，血赚。',
      '稳，铁馆见。',
    ],
  },
  {
    id: 'boat',
    name: '旅行诗人小舟',
    handle: 'poet_boat',
    bg: '#d18700',
    bio: '在路上第七年｜相机比行李重',
    followers: 210500,
    verified: true,
    persona: '旅行博主小舟，文笔安静有画面感，喜欢写小镇清晨和陌生人的善意，反对打卡式旅游，相信慢慢走才能看见。',
    pool: [
      '今早的小镇有雾，面包店五点半就开了灯。老板娘多塞给我一个可颂，说「路上吃」。旅途的善意总是这么轻，又这么重。#旅行摄影#',
      '有人问七年里最好的风景是哪一处。我想了想：是每一次决定出发的那个瞬间。#旅行摄影#',
      '打卡式旅游最大的浪费，是把一个地方变成了照片里的背景。坐下来，喝杯当地的茶，它才是真的。#旅行摄影#',
      '火车穿过隧道的那三分钟，整节车厢都在等光。等光的时候大家都没说话，那三分钟很干净。#旅行摄影#',
      '青旅遇到一位阿姨，五十八岁第一次独自旅行。她说「再不出发就真的老了」。阿姨，你没有老，你刚刚才出发。#旅行摄影#',
      '在海边住了三天，什么也没干。第三天退房时老板说「你是我见过最安静的客人」。这算不算一种夸奖。#旅行摄影#',
    ],
    replies: [
      '这条想打印出来贴在工位上。',
      '安静又好看，小舟的文字一直这个味道。',
      '看完立刻想请假了，怪你。',
      '旅途文学浓度超标，收藏了。',
    ],
  },
  {
    id: 'abacus',
    name: '理财小算盘',
    handle: 'abacus_money',
    bg: '#2f6d3f',
    bio: '记账第 8 年｜只讲普通人用得上的',
    followers: 58700,
    persona: '理财博主小算盘，说话精打细算不绕弯，爱报数字，反对消费主义，主张普通人先记账再谈投资，从不荐股。',
    pool: [
      '记账第 2920 天。今天菜钱 32.5，交通 4，一杯没喝的奶茶省下 18。省下的不是钱，是月底不慌的底气。#职场摸鱼#',
      '算过一笔账：每天一杯 20 的奶茶，一年 7300。不是让你别喝，是让你知道自己每天在喝掉多少钱。#职场摸鱼#',
      '普通人理财第一步不是买什么，是搞清楚自己每个月到底花哪了。八成的人答不上来，包括月入三万的。#职场摸鱼#',
      '大促又来了。先问自己：购物车里有多少是「需要」，多少是「因为它在打折」。需要的不打折也要买，不需要的打骨折也别买。#职场摸鱼#',
      '紧急备用金没存够六个月开支的，先别碰任何投资。这话我每年说八百遍，今年继续。#职场摸鱼#',
      '今日份扎心：你舍不得买的那个东西，商家用它换了你的时间。反过来想，时间也能换回来。#职场摸鱼#',
    ],
    replies: [
      '已记账，谢谢算盘。',
      '这条存了，月底翻出来看。',
      '理性消费党狂喜。',
      '不荐股这一点就值得关注。',
    ],
  },
  {
    id: 'kai',
    name: '游戏老玩家阿凯',
    handle: 'oldgamer_kai',
    bg: '#8c3aa8',
    bio: '二十年老玩家｜只玩好玩的不玩贵的',
    followers: 156800,
    verified: true,
    persona: '二十年游戏老玩家阿凯，说话带着老玩家的从容和偶尔的怀旧，对新游挑剔但公正，最爱聊游戏设计本身，反氪金焦虑。',
    pool: [
      '重玩了一遍十年前的老游戏，画面早过时了，好玩却一点没过时。好游戏是设计出来的，不是渲染出来的。#游戏玩家#',
      '现在的某些手游：开局送十连，三天送皮肤，七天送老婆。就是不好玩。送再多也治不了不好玩。#游戏玩家#',
      '年轻时通宵打副本，现在十一点困得不行。不是游戏不好玩了，是没那个身体了。兄弟们，爱惜身体，游戏会等你。#游戏玩家#',
      '给新玩家的建议：别看攻略先自己摸两小时。摸索的过程以后买不回来。#游戏玩家#',
      '氪金这事儿量力而行。游戏是拿来放松的，不是拿来焦虑的。月卡党玩得开心的多的是。#游戏玩家#',
      '今天侄子问我「叔叔你们那时候没有手机怎么打游戏」。我说我们那时候，一屋子人围着一个屏幕。他居然说听起来更热闹。这孩子有慧根。#游戏玩家#',
    ],
    replies: [
      '老玩家盖章，条条属实。',
      '这段话值一个赞，先赞后看。',
      '一屋子人一个屏幕，泪目了。',
      '说出了设计党的心里话。',
    ],
  },
  {
    id: 'candy',
    name: '追星女孩糖糖',
    handle: 'candy_fan',
    bg: '#e0528f',
    bio: '追星第八年｜理智追星从我做起',
    followers: 32100,
    persona: '追星女孩糖糖，语气活泼带波浪号，聊起偶像两眼放光，但坚决理智追星，反代拍反私生，主张喜欢是成为更好的自己。',
    pool: [
      '今天的演唱会唱到那首歌的时候，全场手机灯亮起来的瞬间我又哭了。八年了，还是会被同一个瞬间击中呀～#下班后的生活#',
      '姐妹们理智追星三件套：不打投对赌、不买代拍图、不蹲酒店。喜欢他的方式，是先过好自己的生活呀～#下班后的生活#',
      '今天新歌上线，单曲循环第 38 遍，室友已经会背了。她说她不是粉，她只是被迫营业。#下班后的生活#',
      '有人问我追星图什么。图他唱到那句时我正好在场的那个瞬间呀。那个瞬间是我的，谁也拿不走～#下班后的生活#',
      '今日份感慨：因为他开始学剪辑，现在居然接了小单子。最好的追星，是两个人都在变好。#下班后的生活#',
    ],
    replies: [
      '姐妹清醒！这条转粉群了～',
      '呜呜那段我也是，哭到隐形眼镜移位。',
      '理智追星标杆，学到了～',
      '两个人都在变好，说得太好了。',
    ],
  },
  {
    id: 'liang',
    name: '读书人梁老师',
    handle: 'reader_liang',
    bg: '#3a5f9c',
    bio: '语文老师｜每天推荐一本书的一句话',
    followers: 98300,
    verified: true,
    persona: '中学语文老师梁老师，说话温和有书卷气，爱引用句子，主张读书不求快，反对把读书变成打卡表演，偶尔温和幽默。',
    pool: [
      '今日一句：「人不管走到哪一步，都得爱点什么。」——汪曾祺。爱着什么的人，眼睛里有光。#下班后的生活#',
      '学生问我「老师，读那么多书有什么用」。我说：读书不能马上变现金，但能让你在现金变没的时候不慌。#下班后的生活#',
      '地铁上看到一位师傅在读《平凡的世界》，书页翻得起了毛边。这本书大概陪他很多年了。好书是这样，越旧越亲。#下班后的生活#',
      '反对读书打卡。书不是用来发的，是用来读的。读完一句在心上，胜过拍九张照片在圈里。#下班后的生活#',
      '「人间草木」今天重读。汪老写吃食的那几页，深夜读是一种酷刑。诸位保重。#深夜树洞#',
      '今日一问：你最近一次为一句话停下来，是什么时候？评论区说说，我想听听。#深夜树洞#',
    ],
    replies: [
      '梁老师来了，快坐下听讲。',
      '这条我要抄在扉页上。',
      '温和又有力量，学到了。',
      '语文老师的浪漫，旁人学不来。',
    ],
  },
  {
    id: 'sunny',
    name: '生活小晴报',
    handle: 'sunny_daily',
    bg: '#e8930c',
    bio: '分享让日子亮一点点的小事',
    followers: 18700,
    persona: '普通上班族小晴，语气温暖元气，专门发现生活里的小确幸：一杯热奶茶、下班时的晚霞、晾好的被子的味道，相信小事能救人。',
    pool: [
      '今天的晚霞是橘子汽水色的，在公交站多站了十分钟才回家。白捡十分钟的好心情，赚到了。#下班后的生活#',
      '刚晒好的被子有太阳的味道。躺上去的那一秒，工作群里八十条未读都没那么烦了。#下班后的生活#',
      '下班路上买了个烤红薯，烫得左右手倒着拿。想起小时候也是这样等在巷子口。今天被一个红薯治愈了。#下班后的生活#',
      '便利店的关东煮最后一根萝卜被我买到了。店员说「运气不错哦」。是呀，运气不错。#下班后的生活#',
      '加班到九点，出楼门发现下小雨了，但是空气特别好闻。站在门口闻了一会儿，算是今天给自己放的小假。#深夜树洞#',
    ],
    replies: [
      '被治愈到了，谢谢小晴。',
      '读着读着眼眶热了，是今天需要的。',
      '小事救人，说得真好。',
      '这条想转给每个在加班的人。',
    ],
  },
];

/** 官方账号（私信里的「论坛小助手」） */
export const OFFICIAL_AUTHOR: ForumAuthor = {
  key: 'official',
  name: '论坛小助手',
  handle: 'forum_helper',
  avatar: null,
  npcAvatar: { bg: '#1d9bf0', ch: '助' },
  verified: true,
  bio: 'X论坛官方助手｜使用问题请私信',
};

/** 版块（X Communities 风格） */
export const COMMUNITY_DEFS: { id: string; name: string; desc: string; coverBg: string; members: number }[] = [
  { id: 'hot', name: '今日热议', desc: '每天大家都在聊的新鲜事', coverBg: '#1d9bf0', members: 1286000 },
  { id: 'digital', name: '数码圈', desc: '新机、老机、一切和数码有关的讨论', coverBg: '#0f7d9c', members: 214300 },
  { id: 'food', name: '吃货联盟', desc: '今天吃了什么？晒出来馋大家', coverBg: '#c4392f', members: 356800 },
  { id: 'work', name: '职场摸鱼', desc: '打工人的互助树洞，不聊 KPI', coverBg: '#7b4fe0', members: 482100 },
  { id: 'game', name: '游戏玩家', desc: '好游戏值得被聊起，氪金与否都欢迎', coverBg: '#8c3aa8', members: 520700 },
  { id: 'fit', name: '健身打卡', desc: '今天练了吗？互相监督的地方', coverBg: '#0f9c6e', members: 98400 },
  { id: 'travel', name: '旅行摄影', desc: '在路上的人和你分享世界', coverBg: '#d18700', members: 176500 },
  { id: 'night', name: '深夜树洞', desc: '睡不着的人，进来坐坐', coverBg: '#3a4a5f', members: 267200 },
];

// ---------------- 存取 + 订阅 ----------------

const CHANGED_EVENT = 'forum-data-changed';

let cache: ForumData | null = null;
let rev = 0;
/** 联系人快照（char 作者解析用；App 挂载时 refreshForumAuthors 填充） */
let contactsSnap: ContactRecord[] = [];
let ownerName = '我';
let ownerAvatar: string | null = null;

function blank(): ForumData {
  return {
    v: 1,
    posts: [],
    communities: COMMUNITY_DEFS.map((c) => ({ ...c, joined: c.id === 'hot' })),
    notifications: [],
    dms: [],
    following: [],
    likesByMe: {},
    pinnedTags: [],
    seeded: false,
    lastGenAt: 0,
    joinedAt: Date.now(),
  };
}

/** 同步读（kv 内存缓存；未初始化时给空白） */
export function forumData(): ForumData {
  if (!cache) {
    const raw = kvGet(FORUM_KEY);
    if (raw && typeof raw === 'object' && Array.isArray((raw as ForumData).posts)) {
      cache = raw as ForumData;
    } else {
      cache = blank();
    }
  }
  return cache;
}

/** 写穿（内存 + 异步落盘）+ 广播 */
export function saveForum(next: ForumData): void {
  cache = next;
  rev += 1;
  void kvSet(FORUM_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

export function subscribeForum(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CHANGED_EVENT, cb);
  return () => window.removeEventListener(CHANGED_EVENT, cb);
}

/** useSyncExternalStore 快照（对象缓存：rev 不变时返回同一引用——
 *  getSnapshot 必须稳定，每次新建对象会触发无限重渲循环） */
let snapCache: { data: ForumData; rev: number } | null = null;
let snapRev = -1;
export function forumSnapshot(): { data: ForumData; rev: number } {
  const d = forumData();
  if (!snapCache || snapRev !== rev) {
    snapCache = { data: d, rev };
    snapRev = rev;
  }
  return snapCache;
}

export function forumRev(): number {
  return rev;
}

// ---------------- 作者解析 ----------------

/** 模块级缓存填充：读联系人 + 机主名/头像（App 挂载时调一次；联系人变化时可重调） */
export async function refreshForumAuthors(): Promise<void> {
  try {
    const list = await listContacts();
    contactsSnap = list;
  } catch {
    contactsSnap = [];
  }
  try {
    ownerName = (await ownerRealName()) || '我';
  } catch {
    /* 保持默认 */
  }
  try {
    const { useSettings } = await import('@/lib/ios/store');
    const prof = useSettings.getState().profile;
    ownerAvatar = prof?.avatar || null;
    if (prof?.name) ownerName = prof.name;
  } catch {
    /* 保持默认 */
  }
}

export function forumContactsSnap(): ContactRecord[] {
  return contactsSnap;
}

/** 按 key 解析作者（含 user/official/NPC/char）；未知 key 给占位。
 *  user：论坛内自定义资料（name/avatar/bio）优先，未自定义跟随全局机主资料。 */
export function resolveAuthor(key: AuthorKey): ForumAuthor {
  if (key === 'user') {
    const fp = forumData().profile;
    const name = fp?.name?.trim() || ownerName || '我';
    return {
      key,
      name,
      handle: name.replace(/\s+/g, '') || 'me',
      avatar: fp?.avatar ?? ownerAvatar,
      bio: fp?.bio?.trim() || 'X论坛用户',
    };
  }
  if (key === 'official') return OFFICIAL_AUTHOR;
  if (key.startsWith('npc:')) {
    const def = NPC_DEFS.find((n) => `npc:${n.id}` === key);
    if (def) {
      return {
        key,
        name: def.name,
        handle: def.handle,
        avatar: null,
        npcAvatar: { bg: def.bg, ch: def.name.slice(0, 1) },
        verified: def.verified,
        bio: def.bio,
        baseFollowers: def.followers,
        persona: def.persona,
      };
    }
  }
  if (key.startsWith('char:')) {
    const id = key.slice(5);
    const c = contactsSnap.find((x) => x.id === id);
    if (c) {
      const name = c.nickname || c.name;
      return {
        key,
        name,
        handle: name.replace(/\s+/g, '') || c.id.slice(0, 6),
        avatar: c.avatar || null,
        bio: [c.occupation, c.region, c.persona].filter(Boolean).join(' · ').slice(0, 60) || 'X论坛用户',
        persona: [c.persona, c.background, c.expressStyle].filter(Boolean).join('；'),
      };
    }
  }
  return { key, name: '论坛用户', handle: 'user_unknown', avatar: null };
}

/** 粉丝数展示值（user/char = 好友+NPC 混合的基础值；NPC = 基础值）。
 *  user 自定义过「关注者」数时优先展示自定义值。 */
export function followersOf(key: AuthorKey): number {
  if (key === 'user') {
    const fc = forumData().profile?.followersCount;
    if (typeof fc === 'number' && fc >= 0) return Math.floor(fc);
  }
  const a = resolveAuthor(key);
  if (typeof a.baseFollowers === 'number') return a.baseFollowers;
  if (key === 'user') return 320 + contactsSnap.length * 180;
  if (key.startsWith('char:')) return 980;
  return 1024;
}

/** 我的「正在关注」展示数（自定义优先，否则真实关注数） */
export function myFollowingCount(d: ForumData): number {
  const fc = d.profile?.followingCount;
  if (typeof fc === 'number' && fc >= 0) return Math.floor(fc);
  return d.following.length;
}

/** 保存论坛内自定义资料（局部合并；某字段传 undefined 即清除该字段、恢复跟随全局） */
export function saveForumProfile(patch: Partial<ForumProfile>): void {
  const d = forumData();
  d.profile = { ...(d.profile ?? {}), ...patch };
  saveForum({ ...d });
}

/** 全局机主资料快照（编辑资料页 placeholder/预览用：展示「未自定义时」的取值） */
export function ownerGlobalProfile(): { name: string; avatar: string | null } {
  return { name: ownerName || '我', avatar: ownerAvatar };
}

// ---------------- 工具 ----------------

let seq = 0;
export function uid(prefix: string): string {
  seq = (seq + 1) % 10000;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${seq}`;
}

/** X 风格相对时间：刚刚 / N分钟 / N小时 / 10月31日 / 2025年10月31日 */
export function relTime(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时`;
  const d = new Date(at);
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

/** 数字缩写（X 风格：1.2万 / 3400） */
export function countShort(n: number): string {
  if (n < 10000) return String(n);
  if (n < 100_000_000) {
    const w = n / 10000;
    return `${w >= 100 ? Math.round(w) : Math.round(w * 10) / 10}万`;
  }
  return `${Math.round((n / 100_000_000) * 10) / 10}亿`;
}

/** 版块名（null = 今日热议） */
export function communityName(id: string | null): string {
  if (!id) return '今日热议';
  return COMMUNITY_DEFS.find((c) => c.id === id)?.name ?? '今日热议';
}

/** 某作者的帖子（按时间倒序） */
export function postsOf(d: ForumData, key: AuthorKey): ForumPost[] {
  return d.posts
    .filter((p) => p.authorKey === key)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** 帖子的直接回复（按时间正序，thread 页用） */
export function repliesOf(d: ForumData, postId: string): ForumPost[] {
  return d.posts.filter((p) => p.replyTo === postId).sort((a, b) => a.createdAt - b.createdAt);
}

/** 热门话题（#话题# 统计 + 兜底；X 搜索页风格） */
export function trendingTopics(d: ForumData): { tag: string; count: number }[] {
  const map = new Map<string, number>();
  for (const p of d.posts) {
    for (const m of p.content.matchAll(/#([^#\s]{1,12})#/g)) {
      const tag = m[1];
      map.set(tag, (map.get(tag) ?? 0) + 1);
    }
  }
  const list = [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  if (list.length >= 3) return list;
  const fallback = [
    { tag: '今天吃什么', count: 12 },
    { tag: '下班后的生活', count: 9 },
    { tag: '等一个降温', count: 7 },
    { tag: '深夜树洞', count: 6 },
    { tag: '周末去哪玩', count: 5 },
  ];
  return list.length ? list : fallback;
}
