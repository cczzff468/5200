import { kvGet, kvSet } from './idb-kv';

/** 朋友圈/空间动态互动设置（wx + qq 共享一份） */
export interface MomentsSettings {
  // 一、发布频率
  /** 最短发帖间隔（小时，1-24）；自动发帖调度时强制等待 ≥ 此值 */
  minPostInterval: number;        // 默认 12
  /** 最长发帖间隔（小时，1-24）；自动发帖等待时间上限 */
  maxPostInterval: number;        // 默认 24
  /** 自动发帖总开关；关闭后所有角色不再自动发帖 */
  autoPostEnabled: boolean;       // 默认 true

  // 二、评论与点赞
  /** 首条评论延迟（秒，1-3600） */
  firstCommentDelay: number;      // 默认 30
  /** 后续评论间隔（秒，1-3600） */
  followCommentDelay: number;     // 默认 30
  /** 评论概率（0-1） */
  commentProbability: number;     // 默认 0.5
  /** 点赞概率（0-1） */
  likeProbability: number;        // 默认 0.5

  // 三、NPC 互动
  /** NPC 互动延迟（秒，1-3600） */
  npcInteractDelay: number;       // 默认 30
  /** 角色回复 NPC 评论延迟（秒，1-3600） */
  replyNpcCommentDelay: number;   // 默认 3

  // 四、双语翻译
  /** 朋友圈双语翻译开关 */
  bilingualEnabled: boolean;      // 默认 true
  /** 折叠中文译文（关闭后默认展开） */
  foldChineseTranslation: boolean;// 默认 true
  /** 朋友圈双语提示词（空串 = 用 DEFAULT_BILINGUAL_PROMPT） */
  bilingualPrompt: string;        // 默认 ''
}

export const DEFAULT_MOMENTS_SETTINGS: MomentsSettings = {
  minPostInterval: 12,
  maxPostInterval: 24,
  autoPostEnabled: true,
  firstCommentDelay: 30,
  followCommentDelay: 30,
  commentProbability: 0.5,
  likeProbability: 0.5,
  npcInteractDelay: 30,
  replyNpcCommentDelay: 3,
  bilingualEnabled: true,
  foldChineseTranslation: true,
  bilingualPrompt: '',
};

export const DEFAULT_BILINGUAL_PROMPT = `【朋友圈双语规则（仅非中文角色使用，中文角色忽略此规则）】
- **不改变协议头和结构标签**：只对你实际输出的正文内容使用双语格式，不要翻译或改动协议头和结构标签，不要改动 [回复 昵称]、[不回复]、[NPC点赞]、[NPC评论]、昵称、以及"昵称 回复 被回复者昵称:"这类结构。
- **中文正常输出无需译文**：如果正文是中文，直接正常输出，不要添加译文
- **非中文语言译文输出格式**：非中文语言，正文必须使用"原文|对应的简体中文译文"的格式输出，必须有|分割符号。
- **朋友圈正文双语补充**：如果朋友圈正文、评论正文或回复正文使用非中文，必须在同一段正文里写成"完整外文原文|完整简体中文译文"。
- **照片双语规则**：如果输出 [照片:使用参考图:描述] 或 [照片:不使用参考图:描述]，只允许描述部分使用双语格式，不要改动照片标签外层结构。`;

/** kv 键名 */
const MOMENTS_SETTINGS_KEY = 'moments-settings';

/** 同步读取设置（合并默认值，每字段容错） */
export function getMomentsSettings(): MomentsSettings {
  const v = kvGet<{ [K in keyof MomentsSettings]?: unknown }>(MOMENTS_SETTINGS_KEY);
  if (!v || typeof v !== 'object') return { ...DEFAULT_MOMENTS_SETTINGS };
  return {
    minPostInterval: typeof v.minPostInterval === 'number' && v.minPostInterval >= 1 && v.minPostInterval <= 24 ? v.minPostInterval : DEFAULT_MOMENTS_SETTINGS.minPostInterval,
    maxPostInterval: typeof v.maxPostInterval === 'number' && v.maxPostInterval >= 1 && v.maxPostInterval <= 24 ? v.maxPostInterval : DEFAULT_MOMENTS_SETTINGS.maxPostInterval,
    autoPostEnabled: typeof v.autoPostEnabled === 'boolean' ? v.autoPostEnabled : DEFAULT_MOMENTS_SETTINGS.autoPostEnabled,
    firstCommentDelay: typeof v.firstCommentDelay === 'number' && v.firstCommentDelay >= 1 && v.firstCommentDelay <= 3600 ? v.firstCommentDelay : DEFAULT_MOMENTS_SETTINGS.firstCommentDelay,
    followCommentDelay: typeof v.followCommentDelay === 'number' && v.followCommentDelay >= 1 && v.followCommentDelay <= 3600 ? v.followCommentDelay : DEFAULT_MOMENTS_SETTINGS.followCommentDelay,
    commentProbability: typeof v.commentProbability === 'number' && v.commentProbability >= 0 && v.commentProbability <= 1 ? v.commentProbability : DEFAULT_MOMENTS_SETTINGS.commentProbability,
    likeProbability: typeof v.likeProbability === 'number' && v.likeProbability >= 0 && v.likeProbability <= 1 ? v.likeProbability : DEFAULT_MOMENTS_SETTINGS.likeProbability,
    npcInteractDelay: typeof v.npcInteractDelay === 'number' && v.npcInteractDelay >= 1 && v.npcInteractDelay <= 3600 ? v.npcInteractDelay : DEFAULT_MOMENTS_SETTINGS.npcInteractDelay,
    replyNpcCommentDelay: typeof v.replyNpcCommentDelay === 'number' && v.replyNpcCommentDelay >= 1 && v.replyNpcCommentDelay <= 3600 ? v.replyNpcCommentDelay : DEFAULT_MOMENTS_SETTINGS.replyNpcCommentDelay,
    bilingualEnabled: typeof v.bilingualEnabled === 'boolean' ? v.bilingualEnabled : DEFAULT_MOMENTS_SETTINGS.bilingualEnabled,
    foldChineseTranslation: typeof v.foldChineseTranslation === 'boolean' ? v.foldChineseTranslation : DEFAULT_MOMENTS_SETTINGS.foldChineseTranslation,
    bilingualPrompt: typeof v.bilingualPrompt === 'string' ? v.bilingualPrompt : DEFAULT_MOMENTS_SETTINGS.bilingualPrompt,
  };
}

/** 同步写入设置（patch 部分字段，合并后写 kv） */
export function saveMomentsSettings(patch: Partial<MomentsSettings>): MomentsSettings {
  const cur = getMomentsSettings();
  const next = { ...cur, ...patch };
  kvSet(MOMENTS_SETTINGS_KEY, next);
  return next;
}

/** 恢复默认 */
export function resetMomentsSettings(): MomentsSettings {
  kvSet(MOMENTS_SETTINGS_KEY, DEFAULT_MOMENTS_SETTINGS);
  return { ...DEFAULT_MOMENTS_SETTINGS };
}

// ---------------- UI 选择项常量（已废弃） ----------------
// Task 49-a：UI 改为可输入任意数值的输入框，不再使用固定选项 ActionSheet。
// 以下常量与格式化函数保留导出以防外部引用（grep 确认当前仅本模块定义、UI 不再使用），
// 不再被推荐使用。

/**
 * 最小/最长发帖间隔选项（小时）
 * @deprecated Task 49-a：UI 改为输入框，不再使用固定选项。
 */
export const MIN_POST_INTERVAL_OPTIONS = [1, 2, 3, 6, 12, 18, 24];

/**
 * @deprecated Task 49-a：UI 改为输入框，不再使用固定选项。
 */
export const MAX_POST_INTERVAL_OPTIONS = [1, 2, 3, 6, 12, 18, 24];

/**
 * 延迟选项（秒）：3s / 10s / 30s / 1min / 3min / 10min / 30min / 60min
 * @deprecated Task 49-a：UI 改为输入框，不再使用固定选项。
 */
export const DELAY_OPTIONS_SEC = [3, 10, 30, 60, 180, 600, 1800, 3600];

/**
 * 概率选项
 * @deprecated Task 49-a：UI 改为输入框，不再使用固定选项。
 */
export const PROBABILITY_OPTIONS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];

/**
 * 延迟秒数 → 显示文案
 * @deprecated Task 49-a：UI 改为输入框直接显示数字，不再格式化显示。
 */
export function formatDelaySec(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
  return `${Math.round(sec / 3600)} 小时`;
}

/**
 * 概率 → 百分比文案
 * @deprecated Task 49-a：UI 改为输入框直接显示百分比数字，不再格式化显示。
 */
export function formatProbability(p: number): string {
  return `${Math.round(p * 100)}%`;
}
