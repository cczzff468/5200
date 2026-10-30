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
 * 第六十九轮：示例升级为「整套主题」模板（色板 + 深/浅双色 + 协调规则，
 * 用户照着改色就能得到自己的一套主题）；& 可写在选择器任意位置（.dark & 深色写法）。
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

/** 单条选择器加前缀（html/body/:root → 作用域本身；& 嵌套任意位置 → 替换；组合器开头 → 直接拼接）
 *  第六十九轮：& 支持出现在选择器任意位置（`.dark &` = 深色模式下的作用域祖先写法，
 *  主题示例靠它做「浅色一套 / 深色一套」双色模板） */
function prefixOneSelector(sel: string, scope: string): string {
  const s = sel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  if (s.includes('&')) return s.replace(/&/g, scope);
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

// ---------------- CSS 示例模板（第六十九轮终版：结构化参考模板，用户照着做自己的主题） ----------------
// 格式对齐用户提供的参考示例：颜色变量区 + 分区编号 + 真实选择器 + 注释可选开关。
// 三个作用域各有一组预设主题 chips，每枚 chip = 同一套模板填入不同色板。

/** 一套可一键载入编辑框的示例主题（名字 + CSS 本体 + 色板预览小圆点） */
export interface CssThemePreset {
  name: string;
  css: string;
  /** 编辑器示例 chips 上的色板预览点（2~4 个颜色） */
  swatch: string[];
}

// ================= 全局（主题界面 › 自定义CSS） =================

/** 全局模板色板 */
interface GlobalPalette {
  name: string;
  page: string;
  night: string;
  card: string;
  ink: string;
  accent: string;
}

function globalThemeCss(p: GlobalPalette): string {
  return `/* ═══ 全局自定义 CSS 示例 · ${p.name} ═══ */
/* 作用范围：整台手机的所有界面（所有 App、面板、按钮、线下模式）。 */
/* 做自己的主题：改下面 1 的颜色变量就够了，后面的规则全部从变量取色。 */


/* ══════════════════════════
   1. 颜色变量
   ══════════════════════════ */
:root {
  --c-page:  ${p.page};   /* 页面底色（浅色模式） */
  --c-page-dark: ${p.night};  /* 页面底色（深色模式） */
  --c-card:  ${p.card};   /* 卡片 / 面板底色 */
  --c-ink:   ${p.ink};    /* 面板上的文字 */
  --c-accent: ${p.accent};  /* 主题色（滚动条 / 输入光标） */
}


/* ══════════════════════════
   2. 页面底色（各 App 的灰白底统一换成主题色）
   ══════════════════════════ */
[class*='bg-[#F5F6F7]'], [class*='bg-[#EDEDED]'], [class*='bg-[#F4F5F7]'],
[class*='bg-[#F7F8FA]'], [class*='bg-[#F5F6F8]'], [class*='bg-[#F7F7F7]'],
[class*='bg-[#F2F3F5]'], [class*='bg-[#F6F7F8]'], [class*='bg-[#F8F8F8]'],
[class*='bg-[#F6F7F9]'], [class*='bg-[#F4F5F9]'], [class*='bg-[#FAFAFC]'],
[class*='bg-[#FAFAFA]'], [class*='bg-[#EFEFF4]'] {
  background: var(--c-page);
}

/* 同一批页面在深色模式下的夜色 */
.dark & [class*='bg-[#F5F6F7]'], .dark & [class*='bg-[#EDEDED]'], .dark & [class*='bg-[#F4F5F7]'],
.dark & [class*='bg-[#F7F8FA]'], .dark & [class*='bg-[#F5F6F8]'], .dark & [class*='bg-[#F7F7F7]'],
.dark & [class*='bg-[#F2F3F5]'], .dark & [class*='bg-[#F6F7F8]'], .dark & [class*='bg-[#F8F8F8]'],
.dark & [class*='bg-[#F6F7F9]'], .dark & [class*='bg-[#F4F5F9]'], .dark & [class*='bg-[#FAFAFC]'],
.dark & [class*='bg-[#FAFAFA]'], .dark & [class*='bg-[#EFEFF4]'] {
  background: var(--c-page-dark);
}


/* ══════════════════════════
   3. 按钮手感（按下轻轻缩，松手弹回来）
   ══════════════════════════ */
button {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.3, 1.4),
    background-color 0.18s, color 0.18s, opacity 0.18s;
}

button:active {
  transform: scale(0.955);
}


/* ══════════════════════════
   4. 皮肤面板（装扮为古早 / 液态玻璃主题时，卡片跟着换装）
   ══════════════════════════ */
.rt-panel {
  background: var(--c-card);
  color: var(--c-ink);
}

.lg-card, .lg-panel, .lg-sheet {
  background: color-mix(in srgb, var(--c-card) 55%, transparent);
}


/* ══════════════════════════
   5. 滚动条（细条 + 主题色）
   ══════════════════════════ */
::-webkit-scrollbar {
  width: 3px;
  height: 3px;
}

::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--c-accent) 55%, transparent);
  border-radius: 99px;
}


/* ══════════════════════════
   6. 输入光标（主题色）
   ══════════════════════════ */
input, textarea {
  caret-color: var(--c-accent);
}


/* ══════════════════════════
   7. 可选开关（想用就解开注释）
   ══════════════════════════ */
/* 所有按钮统一圆角 */
/* button { border-radius: 12px; } */

/* 文字整体放大一档 */
/* & { font-size: 105%; } */

/* 自定义字体（网络字体，取消注释并把链接换成你想要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* & { font-family: "ZCOOL KuaiLe", sans-serif; } */`;
}

/** 全局示例主题 ×4（主题界面 › 自定义CSS 的示例 chips） */
export const globalCssPresets: CssThemePreset[] = [
  {
    name: '奶油曲奇',
    swatch: ['#F6EFE2', '#FFFDF4', '#C08A54'],
    css: globalThemeCss({ name: '奶油曲奇', page: '#F6EFE2', night: '#191712', card: '#FFFDF4', ink: '#5C5243', accent: '#C08A54' }),
  },
  {
    name: '薄荷苏打',
    swatch: ['#E8F3EC', '#F7FCF8', '#4F9D69'],
    css: globalThemeCss({ name: '薄荷苏打', page: '#E8F3EC', night: '#12201B', card: '#F7FCF8', ink: '#35543F', accent: '#4F9D69' }),
  },
  {
    name: '夜航蓝',
    swatch: ['#E9EEF6', '#F5F8FD', '#3E5C8F'],
    css: globalThemeCss({ name: '夜航蓝', page: '#E9EEF6', night: '#101623', card: '#F5F8FD', ink: '#3A4A63', accent: '#3E5C8F' }),
  },
  {
    name: '樱花信笺',
    swatch: ['#F9EEF1', '#FFFAFB', '#D87891'],
    css: globalThemeCss({ name: '樱花信笺', page: '#F9EEF1', night: '#201318', card: '#FFFAFB', ink: '#6B4550', accent: '#D87891' }),
  },
];

// ================= 聊天（联系人 › 聊天设置 › 自定义CSS） =================

/** 聊天模板色板 */
interface ChatPalette {
  name: string;
  bg: string;
  bgN: string;
  mine: string;
  mineN: string;
  peer: string;
  peerN: string;
  input: string;
  inputN: string;
}

function chatThemeCss(app: 'wx' | 'qq', p: ChatPalette): string {
  const hook = app === 'qq' ? 'qq' : 'wx';
  const appName = app === 'qq' ? 'QQ' : '微信';
  // QQ 我方默认蓝泡 / 微信我方默认绿泡是内联颜色（style backgroundColor），
  // 类规则要 !important 才能盖住；其余表面无内联色，不需要
  const imp = ' !important';
  const tailPart =
    app === 'wx'
      ? `
/* ══════════════════════════
   5. 小尾巴（默认样式的小三角，跟气泡同色；装扮气泡自带尾巴不受影响）
   ══════════════════════════ */
.wx-bub-tail-mine { background: var(--c-bubble-self) !important; }
.dark & .wx-bub-tail-mine { background: var(--c-bubble-self-dark) !important; }
.wx-bub-tail-theirs { background: var(--c-bubble-other) !important; }
.dark & .wx-bub-tail-theirs { background: var(--c-bubble-other-dark) !important; }


`
      : '';
  return `/* ═══ ${appName}聊天界面 CSS 示例 · ${p.name} ═══ */
/* 作用范围：只改${appName}的聊天页（背景、气泡、语音、时间、输入栏）。 */
/* 消息列表 / 联系人 / 动态等其他界面不受影响。 */
/* 做自己的主题：改下面 1 的颜色变量就够了，后面的规则全部从变量取色。 */
/* 注：装扮气泡（纯色 / 七彩 / 古早 / 液态）自带样式，不参与这套换色。 */


/* ══════════════════════════
   1. 颜色变量
   ══════════════════════════ */
:root {
  --c-bg:            ${p.bg};   /* 聊天背景（浅色） */
  --c-bg-dark:       ${p.bgN};   /* 聊天背景（深色） */
  --c-bubble-self:   ${p.mine};  /* 我的气泡（文字 + 语音） */
  --c-bubble-self-dark: ${p.mineN};  /* 我的气泡（深色） */
  --c-bubble-other:  ${p.peer};  /* 对方的气泡（文字 + 语音） */
  --c-bubble-other-dark: ${p.peerN};  /* 对方的气泡（深色） */
  --c-input:         ${p.input}; /* 输入栏底色 */
  --c-input-dark:    ${p.inputN}; /* 输入栏底色（深色） */
}


/* ══════════════════════════
   2. 聊天背景
   ══════════════════════════ */
& { background: var(--c-bg); }

.dark & { background: var(--c-bg-dark); }


/* ══════════════════════════
   3. 我的气泡（文字 + 语音一起换）
   ══════════════════════════ */
.${hook}-bub-mine { background: var(--c-bubble-self)${imp}; }

.dark & .${hook}-bub-mine { background: var(--c-bubble-self-dark)${imp}; }


/* ══════════════════════════
   4. 对方的气泡（文字 + 语音一起换）
   ══════════════════════════ */
.${hook}-bub-theirs { background: var(--c-bubble-other)${imp}; }

.dark & .${hook}-bub-theirs { background: var(--c-bubble-other-dark)${imp}; }


${tailPart}/* ══════════════════════════
   ${tailPart ? '6' : '5'}. 时间胶囊（居中的时间小条）
   ══════════════════════════ */
.${hook}-time-chip {
  background: color-mix(in srgb, var(--c-bubble-other) 75%, transparent);
  border-color: color-mix(in srgb, var(--c-bg) 60%, #000 12%);
}


/* ══════════════════════════
   ${tailPart ? '7' : '6'}. 输入栏（底部打字区）
   ══════════════════════════ */
.${hook}-inputbar { background: var(--c-input); }

.dark & .${hook}-inputbar { background: var(--c-input-dark); }


/* ══════════════════════════
   ${tailPart ? '8' : '7'}. 可选开关（想用就解开注释）
   ══════════════════════════ */
/* 消息区左右留窄一点 */
/* .${hook}-chat-list { padding-left: 10px; padding-right: 10px; } */

/* 气泡圆角统一改小 */
/* .${hook}-bub-mine, .${hook}-bub-theirs { border-radius: 8px; } */

/* 聊天文字整体放大一档 */
/* .${hook}-chat-list { font-size: 17px; } */

/* 自定义字体（网络字体，取消注释并把链接换成你想要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .${hook}-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`;
}

/** 聊天示例主题 ×2/App（联系人 › 聊天设置 › 自定义CSS 的示例 chips） */
export function chatCssPresets(app: 'wx' | 'qq'): CssThemePreset[] {
  if (app === 'qq') {
    return [
      {
        name: '落日橙',
        swatch: ['#F6EFE7', '#E89A5B', '#FFFFFF'],
        css: chatThemeCss('qq', {
          name: '落日橙', bg: '#F6EFE7', bgN: '#1B1611',
          mine: '#E89A5B', mineN: '#8A5527', peer: '#FFFFFF', peerN: '#262019',
          input: '#FFF8EF', inputN: '#1F1A14',
        }),
      },
      {
        name: '青瓷',
        swatch: ['#ECF2EF', '#7FBFA8', '#FFFFFF'],
        css: chatThemeCss('qq', {
          name: '青瓷', bg: '#ECF2EF', bgN: '#121A17',
          mine: '#7FBFA8', mineN: '#2F6353', peer: '#FFFFFF', peerN: '#1D2622',
          input: '#F4FAF7', inputN: '#151E1A',
        }),
      },
    ];
  }
  return [
    {
      name: '素笺',
      swatch: ['#F4EFE3', '#A9C98C', '#FFFFFF'],
      css: chatThemeCss('wx', {
        name: '素笺', bg: '#F4EFE3', bgN: '#191813',
        mine: '#A9C98C', mineN: '#3F5C33', peer: '#FFFFFF', peerN: '#24231D',
        input: '#F0EAD9', inputN: '#141310',
      }),
    },
    {
      name: '海雾',
      swatch: ['#E8EEF2', '#9CCBD8', '#FFFFFF'],
      css: chatThemeCss('wx', {
        name: '海雾', bg: '#E8EEF2', bgN: '#131A20',
        mine: '#9CCBD8', mineN: '#2F5563', peer: '#FFFFFF', peerN: '#1E262C',
        input: '#DFE8EE', inputN: '#0F151A',
      }),
    },
  ];
}

// ================= 线下（线下模式 › 现场设置 › 自定义CSS） =================

/** 线下模板色板 */
interface OfflinePalette {
  name: string;
  bg: string;
  card: string;
  chip: string;
  start: string;
  ink: string;
}

function offlineThemeCss(p: OfflinePalette): string {
  return `/* ═══ 线下模式 CSS 示例 · ${p.name} ═══ */
/* 作用范围：线下模式的所有界面（开始页、见面页、存档、现场设置、历史记录）。 */
/* 做自己的主题：改下面 1 的颜色变量就够了，后面的规则全部从变量取色。 */


/* ══════════════════════════
   1. 颜色变量
   ══════════════════════════ */
:root {
  --c-bg:     ${p.bg};    /* 页面底色 */
  --c-card:   ${p.card};  /* 卡片 / 输入框 */
  --c-chip:   ${p.chip};  /* 顶部小按钮 / 幽灵按钮 */
  --c-primary: ${p.start}; /* 开始见面 / 主按钮 / 我的气泡 */
  --c-ink:    ${p.ink};   /* 主要文字 */
}


/* ══════════════════════════
   2. 页面底色
   ══════════════════════════ */
& { background: var(--c-bg); }


/* ══════════════════════════
   3. 卡片（叙事卡 / 存档卡 / 设置卡）
   ══════════════════════════ */
.off-card {
  background: var(--c-card);
  border-color: color-mix(in srgb, var(--c-ink) 20%, transparent);
}


/* ══════════════════════════
   4. 顶部小按钮 + 幽灵按钮
   ══════════════════════════ */
.off-chip, .off-btn-ghost {
  background: var(--c-chip);
  color: var(--c-ink);
}


/* ══════════════════════════
   5. 开始见面 + 主按钮 + 发送
   ══════════════════════════ */
.off-start, .off-btn-primary, .off-send {
  background: var(--c-primary);
  color: #fff;
}


/* ══════════════════════════
   6. 输入框
   ══════════════════════════ */
.off-input {
  background: var(--c-card);
  color: var(--c-ink);
}


/* ══════════════════════════
   7. 我的对话气泡
   ══════════════════════════ */
.off-bubble-user {
  background: var(--c-primary);
  color: #fff;
}


/* ══════════════════════════
   8. 深色模式（同一批元素自动换低亮度版本）
   ══════════════════════════ */
.dark & { background: color-mix(in srgb, var(--c-bg) 22%, #141414); }

.dark & .off-card, .dark & .off-input {
  background: color-mix(in srgb, var(--c-card) 12%, #1B1B1B);
  color: #F0EEE8;
}

.dark & .off-chip, .dark & .off-btn-ghost {
  background: color-mix(in srgb, var(--c-chip) 16%, #1B1B1B);
  color: #E8E5DE;
}


/* ══════════════════════════
   9. 可选开关（想用就解开注释）
   ══════════════════════════ */
/* 卡片圆角改小 */
/* .off-card { border-radius: 10px; } */

/* 开始见面按钮改渐变色 */
/* .off-start { background: linear-gradient(180deg, #97CC58 0%, #71A83B 100%); } */

/* 叙事文字放大一档 */
/* .off-card { font-size: 15.5px; } */

/* 自定义字体（网络字体，取消注释并把链接换成你想要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* & { font-family: "ZCOOL KuaiLe", sans-serif; } */`;
}

/** 线下示例主题 ×2（线下模式 › 现场设置 › 自定义CSS 的示例 chips） */
export const OFFLINE_CSS_PRESETS: CssThemePreset[] = [
  {
    name: '暖阳',
    swatch: ['#F8F1E3', '#FFFCF2', '#E8A23D'],
    css: offlineThemeCss({ name: '暖阳', bg: '#F8F1E3', card: '#FFFCF2', chip: '#F2E7CF', start: '#E8A23D', ink: '#6B5B3E' }),
  },
  {
    name: '墨石',
    swatch: ['#EBEFF1', '#FAFCFD', '#5B7C8A'],
    css: offlineThemeCss({ name: '墨石', bg: '#EBEFF1', card: '#FAFCFD', chip: '#DFE7EA', start: '#5B7C8A', ink: '#43555E' }),
  },
];
