'use client';

/**
 * 时间感知（聊天 AI 感知当前时间 / 季节 / 节日 / 事件时长 / 上次聊天间隔）：
 *
 * - 开关按会话键独立保存（sessionKey = wx:<contactId> / qq:<contactId> / sms:<storageKey> /
 *   phone:<contactId>），localStorage 单键 JSON map（chat-time-aware）持久化，默认开启；
 *   各 App 在发送现场读取 —— 打开/关闭后立刻影响下一次请求，无需重启 App；
 * - buildTimeAwareBlock：拼装注入 system 的完整时间感知块 —— 当前时间（北京时间 UTC+8）+
 *   月份天数参照表 + 日期运算规则 + 事件时长感知规则 + 场所营业状态 + 常见事件时长参照 +
 *   时空感知内化协议 + 节日对照表 + 距离上次聊天；全部规则只在内部生效，
 *   AI 被明确禁止把时间戳卡片作为消息输出；
 * - 「距离上次聊天」由调用方传入该会话最后一条消息的时间戳（lastMsgTime）现场计算，
 *   按角色/会话天然隔离不串台；只读取系统时钟换算北京时间，不修改系统时间；
 * - 开关关闭时调用方不注入本块，恢复普通聊天。
 */

const STORE_KEY = 'chat-time-aware';

function loadMap(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 读取某会话的时间感知开关（未设置时默认开启） */
export function getTimeAware(sessionKey: string): boolean {
  return loadMap()[sessionKey] ?? true;
}

/** 保存某会话的时间感知开关（持久化到 localStorage，按会话键隔离；立即影响下一次请求） */
export function setTimeAware(sessionKey: string, on: boolean): void {
  if (typeof window === 'undefined') return;
  const map = loadMap();
  map[sessionKey] = on;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    // 持久化失败忽略（本次会话内存态仍然生效）
  }
}

// ---------------- 时间计算（北京时间 UTC+8，只读系统时钟） ----------------

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** 北京时间下的年月日时分秒（用 UTC+8 偏移换算，与设备时区无关） */
export interface BjTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 星期中文单字（日/一/二/三/四/五/六） */
  week: string;
}

export function toBjTime(ms: number): BjTime {
  const d = new Date(ms + 8 * 3600 * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    week: WEEK_CN[d.getUTCDay()] ?? '日',
  };
}

/** 季节（气候季节：3-5月春 / 6-8月夏 / 9-11月秋 / 12-2月冬） */
export function getSeason(month: number): string {
  if (month >= 3 && month <= 5) return '春季';
  if (month >= 6 && month <= 8) return '夏季';
  if (month >= 9 && month <= 11) return '秋季';
  return '冬季';
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 当年每月天数（1-12 月；2月按闰年规则） */
function monthDaysOf(year: number): number[] {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
}

// ---------------- 节日 ----------------

/**
 * 节日对照表（2026 年公历日期 + 每年固定的公历/网络节日；键 = "M-D"）。
 * 母亲节/父亲节/感恩节按星期规则逐年浮动，不在表里写死（getFestivals 动态计算）。
 */
const FESTIVAL_MAP: Record<string, string> = {
  '1-1': '元旦',
  '1-27': '腊八节',
  '2-6': '小年（北方）',
  '2-7': '小年（南方）',
  '2-14': '情人节',
  '2-16': '除夕',
  '2-17': '春节',
  '3-3': '元宵节',
  '3-8': '妇女节',
  '4-5': '清明节',
  '5-1': '劳动节',
  '5-4': '青年节',
  '5-20': '520',
  '5-21': '521',
  '5-31': '端午节',
  '6-1': '儿童节',
  '8-8': '中元节',
  '8-19': '七夕节',
  '9-10': '教师节',
  '9-25': '中秋节',
  '10-18': '重阳节',
  '10-31': '万圣节',
  '11-11': '双十一',
  '12-12': '双十二',
  '12-25': '圣诞节',
  '12-31': '跨年夜',
};

/** 注入用节日对照表全文（按需求原文整理；周节日标注 2026 年落点） */
const FESTIVAL_TABLE_TEXT = [
  '1月1日元旦；1月27日腊八节；2月6日小年（北方）；2月7日小年（南方）；2月14日情人节；2月16日除夕；2月17日春节；3月3日元宵节；3月8日妇女节；4月5日清明节；5月1日劳动节；5月4日青年节；5月第二个周日母亲节（2026年为5月10日）；5月20日520；5月21日521；5月31日端午节；6月1日儿童节；6月第三个周日父亲节（2026年为6月21日）；7月-8月暑期；8月8日中元节；8月19日七夕节；9月10日教师节；9月25日中秋节；10月1日-7日国庆节；10月18日重阳节；10月31日万圣节；11月第4个周四感恩节（2026年为11月26日）；11月11日双十一；12月12日双十二；12月25日圣诞节；12月31日跨年夜。',
  '其中 520、521、双十一、双十二为网络节日，也要能识别。',
].join('\n');

/** 某月第 N 个星期 W 的日期（W: 0=周日 … 6=周六） */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
}

/** 计算某公历日期命中的节日（固定表 + 周规则浮动节日 + 国庆假期 + 暑期），命中多个时全部返回 */
export function getFestivals(year: number, month: number, day: number): string[] {
  const out: string[] = [];
  const hit = FESTIVAL_MAP[`${month}-${day}`];
  if (hit) out.push(hit);
  if (month === 5 && day === nthWeekdayOfMonth(year, 5, 0, 2)) out.push('母亲节');
  if (month === 6 && day === nthWeekdayOfMonth(year, 6, 0, 3)) out.push('父亲节');
  if (month === 11 && day === nthWeekdayOfMonth(year, 11, 4, 4)) out.push('感恩节');
  if (month === 10 && day >= 1 && day <= 7) out.push('国庆节');
  if (month === 7 || month === 8) out.push('暑期');
  return out;
}

// ---------------- 距离上次聊天 ----------------

/** 把毫秒间隔格式成「X 天 Y 小时 Z 分钟」（不足 1 分钟 → 「不足 1 分钟」） */
export function formatChatGap(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return '不足 1 分钟';
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} 天`);
  if (hours > 0) parts.push(`${hours} 小时`);
  if (mins > 0) parts.push(`${mins} 分钟`);
  return parts.length > 0 ? parts.join(' ') : '不足 1 分钟';
}

// ---------------- 注入块 ----------------

export interface TimeAwareOptions {
  /** 该会话最后一条消息的时间戳（epoch ms）；缺省 / 0 = 第一次聊天 */
  lastMsgTime?: number | null;
  /** 角色所在地区（人设 grounding，可空 —— 内化协议中「城市·具体地点」的参考） */
  regionHint?: string | null;
  /** 当前时间（epoch ms），默认读取系统时钟 */
  now?: number;
}

/**
 * 构建注入 system 消息的时间感知块（开关由调用方判断 —— 关闭时不调用/不注入）。
 * 全部内容为内部参考协议：AI 需内化时间概念并自然体现，禁止输出时间戳卡片或机械复述。
 */
export function buildTimeAwareBlock(opts: TimeAwareOptions = {}): string {
  const now = opts.now ?? Date.now();
  const t = toBjTime(now);
  const md = monthDaysOf(t.year);
  const festivals = getFestivals(t.year, t.month, t.day);
  const todayLine = festivals.length > 0 ? `今天是：${festivals.join('、')}。` : '今天是：无特殊节日。';
  const gap =
    opts.lastMsgTime && opts.lastMsgTime > 0 && now > opts.lastMsgTime
      ? `距离上次聊天：${formatChatGap(now - opts.lastMsgTime)}`
      : '距离上次聊天：这是第一次聊天';
  const regionLine = opts.regionHint
    ? `（角色所在地区参考：${opts.regionHint}；具体地点按人设与当前时间合理生成）`
    : '';
  const hh = `${t.hour}`.padStart(2, '0');
  const mm = `${t.minute}`.padStart(2, '0');
  const ss = `${t.second}`.padStart(2, '0');

  return [
    '【时间感知】（内部参考：以下时间信息只用于你内部辅助判断，绝对禁止把时间戳卡片作为消息输出，不要机械复述时间，也不要在每条回复里硬提时间）',
    `当前时间：${t.year}年${t.month}月${t.day}日 星期${t.week} ${hh}:${mm}:${ss}（北京时间，UTC+8）。${todayLine}${gap}。当前季节是${getSeason(t.month)}。`,
    `【月份天数参照表（${t.year}年）】`,
    `1月${md[0]}天，2月${md[1]}天，3月${md[2]}天，4月${md[3]}天，5月${md[4]}天，6月${md[5]}天，7月${md[6]}天，8月${md[7]}天，9月${md[8]}天，10月${md[9]}天，11月${md[10]}天，12月${md[11]}天。`,
    '【日期运算规则】',
    '当需要计算两个日期之间的天数时，严格参照月份天数表逐日计算，禁止凭直觉估算。先确认当前日期，再确认目标日期，然后用月份天数逐步相减得出剩余天数。',
    '【事件时长感知规则】',
    '角色在提及正在进行某项活动时，必须意识到该活动需要消耗真实时间。当用户发来新消息时，角色应对比上一次时间戳与当前消息时间，计算经过了多少分钟，根据常识判断该事件是否已完成：时间明显不足 → 表示仍在进行中；时间合理 → 表示刚完成或即将完成；时间远超所需 → 表示已完成并自然过渡。角色在说出任何事件耗时之前，必须先自行验证该时长是否符合现实常识。',
    '【场所营业状态】',
    '角色提及任何场所的营业状态时，应基于中国大陆常见营业时间判断，不得随意编造。若当前日期命中节日，角色应意识到部分场所可能放假或缩短营业时间，并自然体现。',
    '【常见事件时长参照】',
    '洗澡15-30分钟，做饭30-60分钟，吃饭20-40分钟，通勤20-60分钟，午睡20-40分钟，健身40-90分钟，打游戏一局15-40分钟，看一集剧40-60分钟。未列举事件按日常常识判断，禁止凭空夸大或缩短。涉及距离或路程时，按实际距离估算，无法确定时取偏短的常见值。',
    '【时空感知内化协议（最高优先级）】',
    `角色的每一次回复，都必须在内部构建完整的时空概念：[YYYY年M月DD日 星期X HH:MM 季节 城市·具体地点]。时间严格同步北京时间（UTC+8），精确到分钟；基于系统注入的当前时间生成，禁止编造；分钟数向下取整，即使秒数超过30也不进位。地点根据角色人设生成，格式为「城市·具体地点」，需符合当前时间逻辑${regionLine}。季节填在「HH:MM」之后、城市之前；若当天命中节日，在城市前插入节日名称。时间戳只在内部用于辅助判断，不对外展示。`,
    `【节日对照表（2026年，公历）】`,
    FESTIVAL_TABLE_TEXT,
    '请结合以上时间信息自然回复，让回复与真实的时间流逝、事件时长相符。',
  ].join('\n');
}
