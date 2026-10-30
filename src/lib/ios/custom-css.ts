/**
 * 自定义 CSS（第六十五轮）——核心库
 * ---------------------------------------------------------------------------
 * 三个作用域（各自独立存储、互不影响）：
 *   1. global   全局：整个手机的所有界面（所有面板/按钮/弹层，含线下模式）；
 *   2. chat-wx / chat-qq  聊天：只作用于对应 App 的聊天界面（消息/气泡/输入栏）；
 *   3. offline  线下：只作用于线下模式的所有界面（开始页/见面页/存档/现场设置/历史）。
 *
 * 注入方式：CSS 文本经 scopeCss() 把每条选择器自动加上作用域前缀
 * （global → [data-phone-shell]；聊天 → [data-chat-css="qq"]；线下 → [data-offline-css]），
 * 再渲染成 <style> 标签 —— 用户写的选择器只落在对应界面里，不会泄漏到别处。
 *
 * 方案收藏：CustomCssScheme（自定义名字 + CSS 本体 + 归属作用域），三处编辑器共用一份清单，
 * 各编辑器只列出自己作用域保存的方案。
 *
 * 持久化：zustand useSettings → IndexedDB settings.customCss（与 bubbleStyle / chatDecor 分键互不影响）。
 */

/** 全部作用域 key（存储/读取用） */
export type CustomCssScope = 'global' | 'chat-wx' | 'chat-qq' | 'offline';

/** 单个已命名方案（用户「保存」下来的 CSS 快照） */
export interface CustomCssScheme {
  id: string;
  name: string;
  css: string;
  /** 保存时所在的作用域（列表按作用域过滤展示） */
  scope: CustomCssScope;
  createdAt: number;
}

/** 自定义 CSS 全量配置（active = 当前应用的 CSS；空串 = 未应用） */
export interface CustomCssConfig {
  global: string;
  'chat-wx': string;
  'chat-qq': string;
  offline: string;
  /** 已命名方案收藏（跨作用域共用一份清单） */
  schemes: CustomCssScheme[];
}

/** CSS 本体长度上限（防脏档/极端输入撑爆 localStorage → IndexedDB） */
export const CUSTOM_CSS_MAX_LEN = 60000;
/** 方案数量上限 */
export const CUSTOM_CSS_SCHEME_CAP = 30;
/** 方案名字数上限 */
export const CUSTOM_CSS_NAME_MAX = 24;

export function defaultCustomCss(): CustomCssConfig {
  return { global: '', 'chat-wx': '', 'chat-qq': '', offline: '', schemes: [] };
}

function normalizeCssText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.length > CUSTOM_CSS_MAX_LEN ? v.slice(0, CUSTOM_CSS_MAX_LEN) : v;
}

/** 任意来源（IndexedDB 旧档/脏数据）→ 合法配置；不合法回默认 */
export function normalizeCustomCss(v: unknown): CustomCssConfig {
  const base = defaultCustomCss();
  if (!v || typeof v !== 'object') return base;
  const o = v as Record<string, unknown>;
  const schemes = Array.isArray(o.schemes)
    ? o.schemes
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : `css-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: typeof s.name === 'string' ? s.name.slice(0, CUSTOM_CSS_NAME_MAX) : '未命名',
          css: normalizeCssText(s.css),
          scope: (typeof s.scope === 'string' && ['global', 'chat-wx', 'chat-qq', 'offline'].includes(s.scope)
            ? s.scope
            : 'global') as CustomCssScope,
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
        }))
        .slice(0, CUSTOM_CSS_SCHEME_CAP)
    : [];
  return {
    global: normalizeCssText(o.global),
    'chat-wx': normalizeCssText(o['chat-wx']),
    'chat-qq': normalizeCssText(o['chat-qq']),
    offline: normalizeCssText(o.offline),
    schemes,
  };
}

// ---------------- 作用域前缀器 ----------------

/** 跳过一段字符串字面量（返回含结束引号的整段；处理 \ 转义） */
function skipString(src: string, start: number): string {
  const quote = src[start];
  let j = start + 1;
  while (j < src.length) {
    if (src[j] === '\\') j += 2;
    else if (src[j] === quote) return src.slice(start, j + 1);
    else if (src[j] === '\n') return src.slice(start, j); // 未闭合（容忍）
    else j++;
  }
  return src.slice(start);
}

/** 跳过一段注释（返回整段；未闭合容忍到结尾） */
function skipComment(src: string, start: number): string {
  const end = src.indexOf('*/', start + 2);
  return end === -1 ? src.slice(start) : src.slice(start, end + 2);
}

/** 找到与 src[start]（'{'）配对的 '}'（字符串/注释/嵌套大括号感知）；返回其下标（找不到 = -1） */
function matchBrace(src: string, start: number): number {
  let depth = 0;
  let k = start;
  while (k < src.length) {
    const c = src[k];
    if (c === '/' && src[k + 1] === '*') {
      k += skipComment(src, k).length;
      continue;
    }
    if (c === '"' || c === "'") {
      k += skipString(src, k).length;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return k;
    }
    k++;
  }
  return -1;
}

/** 单条选择器加前缀（html/body/:root → 作用域本身；& 嵌套 → 替换；组合器开头 → 直接拼接） */
function prefixOneSelector(sel: string, scope: string): string {
  const s = sel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  if (s === '&') return scope;
  if (s.startsWith('&')) return scope + s.slice(1);
  if (/^(html|body|:root)$/i.test(s)) return scope;
  if (/^[>+~]/.test(s)) return `${scope} ${s}`;
  return `${scope} ${s}`;
}

/** 逗号分隔的选择器组逐个加前缀（括号/属性选择器/字符串里的逗号不切分） */
function prefixSelectorGroup(group: string, scope: string): string {
  const parts: string[] = [];
  let cur = '';
  let k = 0;
  while (k < group.length) {
    const c = group[k];
    if (c === '/' && group[k + 1] === '*') {
      const seg = skipComment(group, k);
      cur += seg;
      k += seg.length;
      continue;
    }
    if (c === '"' || c === "'") {
      const seg = skipString(group, k);
      cur += seg;
      k += seg.length;
      continue;
    }
    if (c === '(' || c === '[') {
      // 括号/属性选择器内的逗号不切分：粗略深度计数（引号已在上面整段跳过）
      let depth = 1;
      let j = k + 1;
      while (j < group.length && depth > 0) {
        const cj = group[j];
        if (cj === '(' || cj === '[') depth++;
        else if (cj === ')' || cj === ']') depth--;
        j++;
      }
      cur += group.slice(k, j);
      k = j;
      continue;
    }
    if (c === ',' ) {
      parts.push(cur);
      cur = '';
      k++;
      continue;
    }
    cur += c;
    k++;
  }
  parts.push(cur);
  return parts
    .map((p) => prefixOneSelector(p, scope))
    .filter(Boolean)
    .join(', ');
}

/**
 * 把用户 CSS 的所有样式规则选择器加上作用域前缀（如 '[data-phone-shell]'）。
 * - @media / @supports / @layer / @container 块递归处理（内部规则照样加前缀）；
 * - @keyframes / @font-face / @property / @import 等原样保留（帧选择器/描述符不需要前缀）；
 * - 字符串与注释原样透传（引号里的 { } , 不会干扰解析）。
 * 解析失败的片段原样保留 —— 宁可多生效也不吞用户的 CSS。
 */
export function scopeCss(css: string, scope: string): string {
  if (!css.trim()) return '';
  const input = css.slice(0, CUSTOM_CSS_MAX_LEN);
  let out = '';
  let prelude = '';
  let k = 0;
  while (k < input.length) {
    const c = input[k];
    if (c === '/' && input[k + 1] === '*') {
      const seg = skipComment(input, k);
      prelude += seg;
      k += seg.length;
      continue;
    }
    if (c === '"' || c === "'") {
      const seg = skipString(input, k);
      prelude += seg;
      k += seg.length;
      continue;
    }
    if (c === '{') {
      const close = matchBrace(input, k);
      const inner = close === -1 ? input.slice(k + 1) : input.slice(k + 1, close);
      const pre = prelude.trim();
      prelude = '';
      const at = /^@([\w-]+)/.exec(pre);
      if (at) {
        const name = at[1].toLowerCase();
        if (name === 'media' || name === 'supports' || name === 'layer' || name === 'container' || name === 'scope') {
          // 条件块：内部再解析（里面的样式规则继续加前缀；嵌套 @keyframes 原样保留）
          out += `${pre} {${scopeCss(inner, scope)}}`;
        } else {
          // @keyframes / @font-face / @property / @counter-style 等：原样保留
          out += `${pre} {${inner}}`;
        }
      } else if (pre) {
        // 普通样式规则：选择器加前缀，声明块原样保留
        out += `${prefixSelectorGroup(pre, scope)} {${inner}}`;
      } else {
        // 没有选择器的裸块（异常输入）：原样保留
        out += `{${inner}}`;
      }
      if (close === -1) break;
      k = close + 1;
      continue;
    }
    prelude += c;
    k++;
  }
  out += prelude;
  return out;
}

// ---------------- 示例 CSS（用户可以按照这个改） ----------------

/** 全局示例（主题界面 › 自定义CSS）：作用于整个手机 */
export const GLOBAL_CSS_EXAMPLE = `/* ===== 全局自定义 CSS 示例（可修改后点「应用」）=====
 * 作用于整个手机：所有界面、所有面板、所有按钮（含线下模式）。
 * 选择器会自动限定在手机范围内，不会影响页面其他区域。
 */

/* 例1：所有按钮按下时轻微缩小（按压手感） */
button:active {
  transform: scale(0.97);
}

/* 例2：复古主题的白色面板描边加深一档 */
.rt-panel {
  box-shadow: inset 0 0 0 1.5px #9FA3AE, 0 1px 2px rgba(24, 28, 44, 0.07);
}

/* 例3：液态玻璃的圆钮更通透 */
.lg-chip {
  background: rgba(255, 255, 255, 0.45);
}

/* 例4：所有滚动条变成半透明细条 */
::-webkit-scrollbar {
  width: 3px;
  height: 3px;
}
::-webkit-scrollbar-thumb {
  background: rgba(127, 127, 127, 0.35);
  border-radius: 99px;
}
`;

/** 聊天作用域示例（聊天设置 › 自定义CSS）：只作用于该 App 的聊天页 */
export function chatCssExample(app: 'wx' | 'qq'): string {
  const list = app === 'qq' ? 'qq-chat-list' : 'wx-chat-list';
  const name = app === 'qq' ? 'QQ' : '微信';
  return `/* ===== ${name}聊天界面自定义 CSS 示例（可修改后点「应用」）=====
 * 只作用于${name}的聊天页面（消息、气泡、输入栏），其他界面不受影响。
 */

/* 例1：消息区文字整体放大 */
[data-testid="${list}"] {
  font-size: 16.5px;
}

/* 例2：消息区四周加轻微暗角（vignette） */
[data-testid="${list}"] {
  box-shadow: inset 0 0 60px rgba(0, 0, 0, 0.10);
}

/* 例3：古早气泡圆角更小（装扮为古早样式时可见） */
.bub-retro-qq, .bub-retro {
  border-radius: 6px;
}

/* 例4：时间胶囊（古早主题时间行）文字加粗 */
.rt-time {
  font-weight: 600;
}
`;
}

/** 线下作用域示例（线下模式 › 现场设置 › 自定义CSS）：只作用于线下模式所有界面 */
export const OFFLINE_CSS_EXAMPLE = `/* ===== 线下模式自定义 CSS 示例（可修改后点「应用」）=====
 * 只作用于线下模式的所有界面（开始页、见面页、存档、现场设置、历史记录）。
 */

/* 例1：叙事卡片圆角变小 */
.off-card {
  border-radius: 10px;
}

/* 例2：顶部按钮胶囊放大一号 */
.off-chip {
  height: 40px;
  width: 40px;
}

/* 例3：开始见面按钮换成绿色 */
.off-start {
  background: linear-gradient(180deg, #97CC58 0%, #71A83B 100%);
}

/* 例4：输入框文字放大 */
.off-input {
  font-size: 16px;
}
`;
