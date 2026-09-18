/**
 * 记忆库 · 纯数据类型与纯逻辑（无浏览器 API，客户端/服务端路由均可安全导入）。
 * 存储与管线在 src/lib/memory.ts；本文件只放「可共享的记忆模型」：
 * - 类型：MemFragment / MemCore / MemLongTerm / MemSettings / 权重 / 失忆程度
 * - 三层记忆：碎片（每 N 轮提取）→ 核心记忆（M 条碎片总结）→ 长期记忆（K 条核心总结）
 * - 淡化状态机：fresh（新鲜）→ fading（淡化中，召回降权）→ faded（已归档，不参与召回）
 * - 权重自动分类：姓名/关系/承诺/健康禁忌 → high；临时安排/近期状态 → low；其余 normal
 * - 相似度：字符 2-gram 最短边归一化（「X喜欢海边」≈「X很喜欢去海边」可判同）
 * - 视角统一：记忆文本一律用「用户真实名字 + 角色名字」指代，禁混用「对方/用户/我」
 */

// ---------------- 基础类型 ----------------

export type MemApp = 'wx' | 'qq' | 'sms' | 'phone';

export const MEM_APP_LABEL: Record<MemApp, string> = { wx: '微信', qq: 'QQ', sms: '信息', phone: '电话' };

/** 记忆权重：高（身份/关系/承诺/禁忌）/ 普通 / 低（临时安排、近期状态，最先淡化） */
export type MemWeight = 'high' | 'normal' | 'low';

/** 失忆程度：快≈3天 / 中≈2周 / 慢≈2个月 / 从不 */
export type MemForget = 'fast' | 'medium' | 'slow' | 'never';

export const MEM_FORGET_OPTIONS: MemForget[] = ['fast', 'medium', 'slow', 'never'];
export const MEM_FORGET_LABEL: Record<MemForget, string> = { fast: '快', medium: '中', slow: '慢', never: '从不' };
export const MEM_FORGET_DAYS: Record<Exclude<MemForget, 'never'>, number> = { fast: 3, medium: 14, slow: 60 };

/** 记忆碎片：每 N 轮对话（或手动总结）提取的一条「事实/偏好/承诺」 */
export interface MemFragment {
  id: string;
  contactId: string;
  /** 来源会话（哪个 App 的对话提取出来的） */
  app: MemApp;
  content: string;
  /** 来源时间：提取时对话最后一条消息的时间 */
  sourceTime: number;
  createdAt: number;
  /** 事件发生时间（内容所指的时间，如「明天去北京」→明天；无时间信息不写） */
  eventTime?: number;
  /** 过期时间（空 = 永不过期；到期后碎片自动归档、不再召回） */
  expiresAt?: number;
  /** 时间被用户手动编辑过的事件：设置后自动流程（提取合并/去重）不得改写 eventTime/expiresAt */
  timeEditedAt?: number;
  /** 实际过期归档时刻（惰性标记：扫到过期即写入，UI 显示「已过期」） */
  expiredAt?: number;
  /** 被更新标记：新旧记忆矛盾时旧记忆记下更新时刻（不再参与召回/总结，UI 显示「已更新」） */
  supersededAt?: number;
  /** 更新它的新记忆 id（追溯） */
  supersededBy?: string;
  /** 手动编辑过的时间（编辑后不再被自动流程改写） */
  editedAt?: number;
  /** 已被长期记忆总结消费（召回时由长期记忆代表，避免重复注入） */
  consumedAt?: number;
  /** 权重（召回排序用；高权重召回优先、淡化更慢，低权重最先淡化）。缺省按内容自动分类 */
  weight?: MemWeight;
  /** 最近一次被「加强」的时间：重复提及/合并相似记忆/手动回忆都会刷新；淡化计时起点 */
  reinforcedAt?: number;
  /** 被重复提及/合并的次数（重复出现的记忆更可信） */
  reinforceCount?: number;
  /** 来源消息 ID（追溯：这条记忆来自哪次对话的哪条消息） */
  sourceMsgId?: string;
  /** 来源渠道：缺省 = 私聊对话提取；'moments' = 朋友圈/QQ空间动态（与私聊区分，注入时带渠道标注） */
  source?: 'chat' | 'moments';
  /** source==='moments'：关联的动态 id（动态与记忆双向打通的追溯键） */
  sourcePostId?: string;
  /** source==='moments'：互动类型（发动态/点赞/评论） */
  sourceKind?: 'post' | 'like' | 'comment';
  /** source==='moments'：关联的评论 id（可追溯到具体哪条互动） */
  sourceCommentId?: string;
}

/** 核心记忆：M 条碎片自动总结出的一条核心事实（被长期记忆收编后标记 archivedAt） */
export interface MemCore {
  id: string;
  contactId: string;
  content: string;
  /** 来源碎片数量 */
  fragmentCount: number;
  /** 来源碎片 id（详情/审计用） */
  sourceIds: string[];
  /** 来源 App 集合（互通关闭时召回过滤用） */
  apps: MemApp[];
  createdAt: number;
  /** 事件时间（来源碎片中带时间信息的最早/代表时间；可选） */
  eventTime?: number;
  /** 过期时间（空 = 永不过期；默认永不过期，用户可手动设置） */
  expiresAt?: number;
  editedAt?: number;
  /** 时间被用户手动编辑过的事件：设置后自动流程不得改写 eventTime/expiresAt */
  timeEditedAt?: number;
  /** 已被长期记忆总结收编（召回时由长期记忆代表，不再参与后续总结与召回） */
  archivedAt?: number;
}

/** 长期记忆：K 条核心记忆自动总结出的最稳定画像（记忆层级的顶层） */
export interface MemLongTerm {
  id: string;
  contactId: string;
  content: string;
  /** 来源核心记忆数量 */
  coreCount: number;
  /** 来源核心记忆 id（详情/审计用） */
  sourceIds: string[];
  /** 来源 App 集合（互通关闭时召回过滤用） */
  apps: MemApp[];
  createdAt: number;
  /** 事件时间（来源核心中带时间信息的代表时间；可选） */
  eventTime?: number;
  /** 过期时间（空 = 永不过期；默认永不过期，用户可手动设置） */
  expiresAt?: number;
  editedAt?: number;
  /** 时间被用户手动编辑过的事件：设置后自动流程不得改写 eventTime/expiresAt */
  timeEditedAt?: number;
}

/** 每联系人记忆设置 */
export interface MemSettings {
  /** 对话总结频率：每隔多少轮对话自动提取一次记忆碎片 */
  interval: 10 | 20 | 30 | 40 | 50;
  /** 核心记忆总结频率：积累多少个（未消费的）记忆碎片后自动触发核心总结 */
  threshold: 5 | 10 | 15 | 20 | 30;
  /** 长期记忆总结频率：积累多少条（未归档的）核心记忆后自动触发长期记忆总结；默认 5 */
  longThreshold: 3 | 5 | 7 | 10 | 20;
  /** 跨 App 互通记忆（默认开）：开=四端共享，关=各 App 只用自己来源的记忆 */
  share: boolean;
  /** 失忆程度（默认中）：过期记忆先淡化后归档，不再参与召回；从不重要的记忆开始 */
  forget: MemForget;
}

export const DEFAULT_MEM_SETTINGS: MemSettings = {
  interval: 20,
  threshold: 5,
  longThreshold: 5,
  share: true,
  forget: 'medium',
};

export const MEM_INTERVAL_OPTIONS: MemSettings['interval'][] = [10, 20, 30, 40, 50];
export const MEM_THRESHOLD_OPTIONS: MemSettings['threshold'][] = [5, 10, 15, 20, 30];
export const MEM_LONG_OPTIONS: MemSettings['longThreshold'][] = [3, 5, 7, 10, 20];

// ---------------- 时间感知（记忆 × 当前时间联动） ----------------

/** 时间解析/范围校验的边界：距当前 ±5 年，超出视为模型幻觉时间，置空处理 */
export const MEM_TIME_RANGE_YEARS = 5;

/**
 * 有效时间（注入排序/标注用）：事件时间优先（内容所指的时间），
 * 其次加强时间/来源时间（碎片），最后创建时间（核心/长期）。
 */
export function memEffectiveTime(m: {
  eventTime?: number;
  reinforcedAt?: number;
  sourceTime?: number;
  createdAt: number;
}): number {
  return m.eventTime ?? m.reinforcedAt ?? m.sourceTime ?? m.createdAt;
}

/** 是否已过期（expiresAt 空 = 永不过期；核心/长期默认永不过期） */
export function isMemExpired(m: { expiresAt?: number }, now: number = Date.now()): boolean {
  return m.expiresAt != null && now > m.expiresAt;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 北京时间（UTC+8）下的年月日/时分/星期（与 time-aware 的 toBjTime、提取锚点 Asia/Shanghai
 * 三处一致，与设备时区无关 —— 设备时区设错也不影响标签正确性）。
 */
function bjParts(ms: number): { y: number; mo: number; d: number; h: number; mi: number; w: number } {
  const u = new Date(ms + 8 * 3_600_000);
  return {
    y: u.getUTCFullYear(),
    mo: u.getUTCMonth() + 1,
    d: u.getUTCDate(),
    h: u.getUTCHours(),
    mi: u.getUTCMinutes(),
    w: u.getUTCDay(),
  };
}

/**
 * 中文时间标签（注入/展示共用）：同年省年份；0点0分视为仅日期（日期型事件时间不带出无意义的 00:00）。
 * 时区固定北京时间（UTC+8），与注入块头部的当前时间、聊天时间感知块一致。
 * 例：9月20日 / 9月20日 19:30 / 2025年12月31日。
 */
export function memTimeLabel(ts: number, now: number = Date.now()): string {
  const b = bjParts(ts);
  const sameYear = bjParts(now).y === b.y;
  const base = `${b.mo}月${b.d}日`;
  const hm = b.h !== 0 || b.mi !== 0 ? ` ${String(b.h).padStart(2, '0')}:${String(b.mi).padStart(2, '0')}` : '';
  return sameYear ? `${base}${hm}` : `${b.y}年${base}${hm}`;
}

/** 当前时间标签（注入记忆块头部，供 AI 对比记忆新旧）：2026年9月17日 星期四 07:40（北京时间） */
export function memNowLabel(now: number = Date.now()): string {
  const b = bjParts(now);
  const hm = `${String(b.h).padStart(2, '0')}:${String(b.mi).padStart(2, '0')}`;
  return `${b.y}年${b.mo}月${b.d}日 星期${WEEKDAYS[b.w]} ${hm}`;
}

/** 记忆提取/总结时双方名字（视角统一：一律用真实名字指代，禁用「对方/用户/我」） */
export interface MemNames {
  /** 用户（机主）真实名字；空 = 提取时回退固定称呼「用户」 */
  user?: string | null;
  /** 角色名字（聊天对端 AI 角色）；空 = 回退固定称呼「对方」 */
  peer?: string | null;
}

/** 旧版视角代称（修复旧记忆时替换为真实名字） */
export const MEM_STALE_PAT = /(对方|用户)/g;

/** 对话轮次（供提取器使用的一问一答文本） */
export interface MemConvoTurn {
  role: 'me' | 'peer';
  text: string;
}

// ---------------- 权重 ----------------

/** 权重系数：召回得分乘数 & 淡化有效期倍率（高权重更持久、低权重先淡化） */
export function weightFactor(w?: MemWeight): number {
  return w === 'high' ? 2 : w === 'low' ? 0.5 : 1;
}

/** 权重取高：合并记忆时保留更重要的一档 */
export function higherWeight(a?: MemWeight, b?: MemWeight): MemWeight {
  const rank = (w?: MemWeight) => (w === 'high' ? 2 : w === 'low' ? 0 : 1);
  return rank(a) >= rank(b) ? (a ?? 'normal') : (b ?? 'normal');
}

const HIGH_PAT =
  /(生日|纪念|结婚|订婚|离婚|老婆|老公|女友|女朋友|男友|男朋友|对象|未婚|妻子|丈夫|女儿|儿子|孩子|弟弟|妹妹|哥哥|姐姐|父母|爸妈|爸爸|妈妈|家人|爷爷|奶奶|外婆|外公|名字|姓名|叫.{0,4}(吗|么|呢)|承诺|答应|保证|约定|说好|欠|过敏|忌口|不能吃|病史|住院|手术|药)/;
const LOW_PAT =
  /(明天|后天|大后天|下周|下星期|下个月|月底|今晚|今天晚|这几天|近期|最近在|正在减|暂时|临时|可能|也许|大概|说不定|先不|试试|考虑)/;

/** 关键词自动分类（LLM 未返回权重时的兜底）：姓名/关系/承诺/健康 → high；临时/近期 → low */
export function autoWeight(text: string): MemWeight {
  if (HIGH_PAT.test(text)) return 'high';
  if (LOW_PAT.test(text)) return 'low';
  return 'normal';
}

/** 归一化模型返回的权重（非法值回落自动分类） */
export function normalizeWeight(w: unknown, text: string): MemWeight {
  return w === 'high' || w === 'low' || w === 'normal' ? w : autoWeight(text);
}

// ---------------- 淡化状态机 ----------------

export type FadeState = 'fresh' | 'fading' | 'faded';

/** 淡化计时输入：取「最近被加强的时间」，没有则回落来源时间/创建时间 */
export interface FadeInput {
  reinforcedAt?: number;
  sourceTime?: number;
  createdAt?: number;
  weight?: MemWeight;
}

/**
 * 记忆淡化状态：
 * - 有效期 = 失忆程度天数 × 权重倍率（low ×0.5 先淡化，high ×2 更持久，never = 永不）
 * - 超过有效期一半 → fading（淡化中：召回降权 0.4，UI 半淡显）
 * - 超过有效期 → faded（已归档：不再参与召回/总结，UI 沉底淡显，可「回忆一下」救回）
 */
export function fadeState(m: FadeInput, forget: MemForget, now: number = Date.now()): FadeState {
  if (forget === 'never') return 'fresh';
  const days = MEM_FORGET_DAYS[forget] * weightFactor(m.weight);
  const base = m.reinforcedAt ?? m.sourceTime ?? m.createdAt ?? now;
  const ageDays = (now - base) / 86_400_000;
  if (ageDays >= days) return 'faded';
  if (ageDays >= days * 0.5) return 'fading';
  return 'fresh';
}

// ---------------- 相似度（去重合并） ----------------

/** 字符 2-gram 集合（中文友好轻量相关性） */
export function bigrams(s: string): Set<string> {
  const t = s.replace(/\s+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** 相似度：重叠 gram 数 / 较短边 gram 数（0-1）。≥0.6 视为「同一事实的不同说法」 */
export function similarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  const min = Math.min(ga.size, gb.size);
  if (min === 0) return 0;
  let n = 0;
  ga.forEach((g) => {
    if (gb.has(g)) n++;
  });
  return n / min;
}

/** 相似合并阈值：例「小晨喜欢海边」vs「小晨很喜欢去海边」≈0.6 命中；不同事实（北京/上海）≈0.36 不命中 */
export const SIMILAR_MERGE_THRESHOLD = 0.6;
