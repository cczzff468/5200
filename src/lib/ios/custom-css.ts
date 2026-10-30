/**
 * 自定义 CSS（第六十五轮首建 · 第七十轮按联系人隔离）——核心库
 * ---------------------------------------------------------------------------
 * 三个作用域（各自独立存储、互不影响）：
 *   1. global   全局：整个手机的所有界面（所有面板/按钮/弹层，含线下模式）；
 *   2. chat:app:联系人ID  聊天：只作用于「当前联系人」的聊天界面（消息/气泡/输入栏），
 *      每个联系人一套、互不影响（第七十轮：由按 App 升级为按联系人隔离）；
 *   3. offline  线下：只作用于线下模式的所有界面（开始页/见面页/存档/现场设置/历史）。
 *
 * 注入方式：CSS 文本经 scopeCss() 把每条选择器自动加上作用域前缀，再渲染成 <style> 标
 * —— 用户写的选择器只落在对应界面里，不会泄漏到别处。挂载点：
 *   global → [data-phone-shell]（手机壳）；
 *   聊天  → [data-phone-shell] [data-chat-css="wx:联系人ID"]（该联系人的聊天根）；
 *   线下  → [data-phone-shell] [data-offline-css]（线下模式根）。
 *
 * ── 优先级（用户指定，极度重要）：联系人聊天 CSS ＞ 线下 CSS ＞ 全局 CSS ＞ 内置主题 ──
 * 双保险实现：① 特异性阶梯——聊天/线下的前缀比全局多一级属性选择器
 * （聊天/线下用户规则 (0,3,0) vs 全局用户规则 (0,2,0)，无论各自写什么选择器都稳定压制）；
 * ② 源顺序——全局 <style> 渲染在手机壳内容首位，聊天/线下的 <style> 在各自组件内更靠后，
 * 同特异性时后者赢。内置主题（古早/液态玻璃）只是普通类名样式，永远在最底层。
 * 第六十九轮：& 可写在选择器任意位置（.dark & = 深色模式写法，html.dark 是手机壳祖先）。
 * 第七十一轮：示例从「主题」升级为「完整模板」——逐段列出界面上所有能改的元素
 * （背景/顶栏/底栏/气泡/尾巴/时间/输入栏/状态栏/面板/按钮/滚动条…），微信/QQ 各一份，
 * 按各自 App 的真实样式书写；每段默认值 = 当前样式，不改直接应用 ≈ 界面没变化。
 *
 * 方案收藏：CustomCssScheme（自定义名字 + CSS 本体 + 归属作用域），三处编辑器共用一份清单，
 * 各编辑器只列出自己作用域保存的方案（聊天方案跟着联系人走）。
 *
 * 持久化：zustand useSettings → IndexedDB settings.customCss（与 bubbleStyle / chatDecor 分键互不影响）。
 */

/** 全部作用域 key（存储/读取用）：global / offline / chat:app:联系人ID（如 chat:wx:9） */
export type CustomCssScope = 'global' | 'offline' | `chat:${string}`;

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
  offline: string;
  /** 联系人聊天 CSS（key = `${app}:${联系人ID}` 如 "wx:9"，值 = 已应用的 CSS）——每个联系人一套 */
  chats: Record<string, string>;
  /** 已命名方案收藏（跨作用域共用一份清单） */
  schemes: CustomCssScheme[];
}

/** CSS 本体长度上限（防脏档/极端输入撑爆 localStorage → IndexedDB） */
export const CUSTOM_CSS_MAX_LEN = 60000;
/** 方案数量上限 */
export const CUSTOM_CSS_SCHEME_CAP = 30;
/** 方案名字数上限 */
export const CUSTOM_CSS_NAME_MAX = 24;
/** 联系人聊天 CSS 同时保留的套数上限（防脏档无限膨胀） */
export const CUSTOM_CSS_CHAT_CAP = 60;

export function defaultCustomCss(): CustomCssConfig {
  return { global: '', offline: '', chats: {}, schemes: [] };
}

// ---------------- 联系人聊天作用域（第七十轮：按联系人隔离） ----------------

/**
 * 联系人存储 key：`${app}:${encodeURIComponent(contactId)}`（如 "wx:9" / "qq:c3"）。
 * encodeURIComponent 保证 key 只含安全字符——它同时会被拼进 CSS 属性选择器
 * `[data-chat-css="..."]`，绝不能出现引号/反斜杠。
 */
export function chatContactKey(app: 'wx' | 'qq', contactId: string): string {
  return `${app}:${encodeURIComponent(String(contactId))}`;
}

/** 联系人编辑器的作用域 key：`chat:wx:9`（chats 存储 key 再去掉前缀） */
export function chatCssScope(app: 'wx' | 'qq', contactId: string): CustomCssScope {
  return `chat:${chatContactKey(app, contactId)}`;
}

/** 统一读取「某作用域当前已应用的 CSS」（编辑器/聊天页挂载共用，空串 = 未应用） */
export function readCustomCssActive(cfg: CustomCssConfig, scope: CustomCssScope): string {
  if (scope === 'global') return cfg.global;
  if (scope === 'offline') return cfg.offline;
  return cfg.chats[scope.slice('chat:'.length)] ?? '';
}

// ---------------- 作用域选择器（挂载 <style> 用，特异性阶梯见文件头） ----------------

/** 全局（基础优先级）：手机壳内所有元素 */
export const GLOBAL_CSS_SCOPE = '[data-phone-shell]';
/** 线下（次高优先级）：多一级属性 → 特异性压制全局 */
export const OFFLINE_CSS_SCOPE = '[data-phone-shell] [data-offline-css]';
/** 联系人聊天（最高优先级）：多一级属性 → 特异性压制全局；与线下界面互斥不相遇 */
export function chatCssScopeSelector(contactKey: string): string {
  return `[data-phone-shell] [data-chat-css="${contactKey}"]`;
}

function normalizeCssText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.length > CUSTOM_CSS_MAX_LEN ? v.slice(0, CUSTOM_CSS_MAX_LEN) : v;
}

/** 任意来源（IndexedDB 旧档/脏数据）→ 合法配置；不合法回默认。
 *  第七十轮迁移：旧档的 'chat-wx'/'chat-qq' 字段（按 App 的聊天 CSS）无法拆分到具体联系人，
 *  直接弃用（方案库里的旧聊天方案归入 global 列表，CSS 文本不丢，可复制到联系人编辑器再用）。 */
export function normalizeCustomCss(v: unknown): CustomCssConfig {
  const base = defaultCustomCss();
  if (!v || typeof v !== 'object') return base;
  const o = v as Record<string, unknown>;
  // 联系人聊天 CSS：key 校验安全字符（会拼进属性选择器），空串剔除，最多保留 CHAT_CAP 套
  const chats: Record<string, string> = {};
  if (o.chats && typeof o.chats === 'object') {
    let count = 0;
    for (const [k, val] of Object.entries(o.chats as Record<string, unknown>)) {
      if (count >= CUSTOM_CSS_CHAT_CAP) break;
      // key 形如 "wx:9"：app 前缀 + encodeURIComponent 输出（字母数字 - _ . ! ~ * ' ( ) % 和分隔冒号，无引号/反斜杠）
      if (!/^[a-z][a-zA-Z0-9\-_.!~*'():%]*$/.test(k)) continue;
      const css = normalizeCssText(val);
      if (!css.trim()) continue;
      chats[k] = css;
      count++;
    }
  }
  const schemes = Array.isArray(o.schemes)
    ? o.schemes
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : `css-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: typeof s.name === 'string' ? s.name.slice(0, CUSTOM_CSS_NAME_MAX) : '未命名',
          css: normalizeCssText(s.css),
          // 合法：global / offline / chat:…；旧 'chat-wx'/'chat-qq' 方案归入 global 列表（文本不丢）
          scope: (typeof s.scope === 'string' && (s.scope === 'global' || s.scope === 'offline' || s.scope.startsWith('chat:'))
            ? s.scope
            : 'global') as CustomCssScope,
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
        }))
        .slice(0, CUSTOM_CSS_SCHEME_CAP)
    : [];
  return {
    global: normalizeCssText(o.global),
    offline: normalizeCssText(o.offline),
    chats,
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
 *  html.dark 是手机壳的祖先 → 稳定命中；模板靠它做「浅色一套 / 深色一套」双色规则） */
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
 * - 顶层 @ 语句（@import …; 第七十一轮补）：以分号结尾、没有块，直接透传，
 *   不再混进下一条规则的选择器里（模板里的字体示例被解开注释时，后面的规则不被破坏）；
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
    // 顶层分号：@import / @charset / @namespace 这类无块 at 语句到此结束 → 原样透传并清空
    if (c === ';') {
      const pre = prelude.trim();
      if (pre.startsWith('@')) {
        out += `${pre};`;
        prelude = '';
      } else {
        prelude += c;
      }
      k++;
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

// ---------------- CSS 完整模板（第七十一轮：示例从「主题」升级为「完整模板」） ----------------
// 模板 = 界面元素清单：把该作用域里所有能改的东西逐段列出（背景 / 顶栏 / 底栏 / 气泡 /
// 尾巴 / 时间胶囊 / 输入栏 / 状态栏 / 灵动岛 / 面板 / 按钮 / 滚动条 / 文字选中…），
// 每段 = 真实选择器 + 该界面当前的默认值——不改直接应用 ≈ 界面没变化；
// 用户改哪段哪段生效，不想要的整段删掉。微信 / QQ 各一份，按各自 App 的真实样式书写。
// 默认由动态逻辑决定黑白的元素（状态栏/Home 条/输入光标）以注释形式列出，解开即填。

/** 一份可一键填入编辑框的完整模板（按钮文案 + 一句话说明 + CSS 本体） */
export interface CssTemplate {
  name: string;
  desc: string;
  css: string;
}

// ================= 全局（个性装扮 › 主题 Tab › 自定义CSS） =================

/** 全局模板：整台手机所有界面的完整清单（默认值 = 系统当前样式） */
export const GLOBAL_CSS_TEMPLATE: CssTemplate = {
  name: '全局完整模板',
  desc: '背景 / 状态栏 / 灵动岛 / 面板 / 按钮…手机上所有能改的地方',
  css: `/* ═══════════════════════════════════════════════
   全局 · 完整模板（整台手机）
   ═══════════════════════════════════════════════
   作用范围：手机里所有界面——各 App 页面、状态栏、面板、
   按钮、线下模式，全部听这里的。
   每一段 = 一处；把值改成你想要的，不想要的整段删掉。
   下面填的都是系统现在的默认样式——不改直接应用 ≈ 没变化。
   注意：联系人若单独设了聊天 CSS，会盖过这里的同名规则。 */

/* ── 1. 页面背景（所有 App 的灰白底一起换色） ── */
[class*='bg-[#F5F6F7]'], [class*='bg-[#EDEDED]'], [class*='bg-[#F4F5F7]'],
[class*='bg-[#F7F8FA]'], [class*='bg-[#F5F6F8]'], [class*='bg-[#F7F7F7]'],
[class*='bg-[#F2F3F5]'], [class*='bg-[#F6F7F8]'], [class*='bg-[#F8F8F8]'],
[class*='bg-[#F6F7F9]'], [class*='bg-[#F4F5F9]'], [class*='bg-[#FAFAFC]'],
[class*='bg-[#FAFAFA]'], [class*='bg-[#EFEFF4]'] {
  background: #F5F6F7;   /* ← 换成你想要的颜色 */
}

/* 上面那批页面在深色模式下的颜色 */
.dark & [class*='bg-[#F5F6F7]'], .dark & [class*='bg-[#EDEDED]'], .dark & [class*='bg-[#F4F5F7]'],
.dark & [class*='bg-[#F7F8FA]'], .dark & [class*='bg-[#F5F6F8]'], .dark & [class*='bg-[#F7F7F7]'],
.dark & [class*='bg-[#F2F3F5]'], .dark & [class*='bg-[#F6F7F8]'], .dark & [class*='bg-[#F8F8F8]'],
.dark & [class*='bg-[#F6F7F9]'], .dark & [class*='bg-[#F4F5F9]'], .dark & [class*='bg-[#FAFAFC]'],
.dark & [class*='bg-[#FAFAFA]'], .dark & [class*='bg-[#EFEFF4]'] {
  background: #111214;
}

/* ── 2. 状态栏（顶部时间 · 信号 · 电池） ── */
/* 默认自动选黑/白字（看背景明暗）；想固定颜色就解开注释填 */
/* .ph-statusbar { color: #1F1F1F; } */

/* ── 3. 灵动岛（顶部黑色胶囊） ── */
.ph-island { background: #000000; }

/* ── 4. Home 指示条（屏幕最底部的小横杠） ── */
/* 同样默认自动黑/白；想固定颜色就解开注释填 */
/* .ph-homebar { background: #1F1F1F; opacity: 0.9; } */

/* ── 5. App 顶部导航栏（大标题那一整条） ── */
[class*='bg-background/80'] {
  background: color-mix(in oklab, var(--background) 80%, transparent);
}
/* ↑ 这行 = 系统默认（半透明，自动跟随深浅模式）；直接换成你要的颜色，如 rgba(255,250,240,0.85) */

/* ── 6. 面板 / 卡片（设置页、弹窗里的卡片） ── */
.rt-panel { background: #FFFFFF; }
.dark & .rt-panel { background: #35353D; }

.lg-card, .lg-sheet, .lg-panel { background: rgba(255, 255, 255, 0.62); }
.dark & .lg-card, .dark & .lg-sheet, .dark & .lg-panel { background: rgba(28, 28, 34, 0.62); }

/* ── 7. 按钮手感（按下轻轻缩，松手弹回来） ── */
button {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.3, 1.4),
    background-color 0.18s, color 0.18s, opacity 0.18s;
}
button:active { transform: scale(0.955); }

/* ── 8. 输入框（打字时的光标颜色） ── */
/* 解开注释填你想要的颜色 */
/* input, textarea { caret-color: #FF7A59; } */

/* ── 9. 文字选中（长按 / 拖选文字的高亮色） ── */
/* 解开注释填你想要的颜色 */
/* ::selection { background: #FF7A59; color: #FFFFFF; } */

/* ── 10. 滚动条（手机里所有列表的滚动条） ── */
::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.25); border-radius: 99px; }
.dark & ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.25); }

/* ── 11. 想再动手？解开这些注释 ── */
/* 所有按钮统一圆角 */
/* button { border-radius: 12px; } */

/* 全手机文字放大一档 */
/* & { font-size: 105%; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* & { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

// ================= 聊天（联系人 › 聊天设置 › 自定义CSS） =================

/** 微信模板：按微信真实样式逐段列出聊天页所有能改的地方（默认值 = 微信当前样式） */
const WX_CSS_TEMPLATE: CssTemplate = {
  name: '微信完整模板',
  desc: '按微信样式：背景 / 气泡 / 小尾巴 / 时间 / 输入栏',
  css: `/* ═══════════════════════════════════════════════
   微信 · 聊天界面完整模板（联系人专属）
   ═══════════════════════════════════════════════
   作用范围：只有这个联系人的聊天页（其他联系人、
   消息列表、朋友圈等界面都不受影响）。
   每一段 = 一处；把值改成你想要的，不想要的整段删掉。
   下面填的都是微信现在的默认样式——不改直接应用 ≈ 没变化。
   成对的两行里，第二行是深色模式的值（想让深浅不一样才留它）。
   装扮气泡（纯色/七彩/古早/液态）自带样式，不吃这套规则；
   聊天设置里设过纯色/图片背景时，背景层会盖在第 1 段上面。 */

/* ── 1. 聊天页背景 ── */
& { background: #EDEDED; }
.dark & { background: #111111; }

/* ── 2. 顶部栏（返回 · 名字 · 菜单那一行） ── */
.wx-topbar { background: #EDEDED; }
.dark & .wx-topbar { background: #111111; }

/* ── 3. 我的气泡（右侧绿泡；文字和语音一起换） ── */
.wx-bub-mine {
  background: #95EC69 !important;   /* 微信绿 */
  color: #000000;
}
.dark & .wx-bub-mine {
  background: #3EB575 !important;
  color: #000000;
}

/* ── 4. 对方的气泡（左侧白泡；文字和语音一起换） ── */
.wx-bub-theirs {
  background: #FFFFFF !important;
  color: #000000;
}
.dark & .wx-bub-theirs {
  background: #1E1E1E !important;
  color: #FFFFFF;
}

/* ── 5. 气泡小尾巴（跟气泡同色的小三角） ── */
.wx-bub-tail-mine { background: #95EC69 !important; }
.dark & .wx-bub-tail-mine { background: #3EB575 !important; }
.wx-bub-tail-theirs { background: #FFFFFF !important; }
.dark & .wx-bub-tail-theirs { background: #1E1E1E !important; }

/* ── 6. 时间胶囊（居中的时间小条） ── */
.wx-time-chip {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & .wx-time-chip {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 7. 底部输入栏（打字那一栏） ── */
.wx-inputbar {
  background: #EDEDED;
  border-color: rgba(0, 0, 0, 0.07);
}
.dark & .wx-inputbar {
  background: #111111;
  border-color: rgba(255, 255, 255, 0.06);
}

/* ── 8. 想再动手？解开这些注释 ── */
/* 气泡圆角改小一点 */
/* .wx-bub-mine, .wx-bub-theirs { border-radius: 8px; } */

/* 聊天文字放大一档 */
/* .wx-chat-list { font-size: 17px; } */

/* 消息区左右留窄一点 */
/* .wx-chat-list { padding-left: 10px; padding-right: 10px; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .wx-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

/** QQ 模板：按 QQ 真实样式逐段列出聊天页所有能改的地方（默认值 = QQ 当前样式） */
const QQ_CSS_TEMPLATE: CssTemplate = {
  name: 'QQ完整模板',
  desc: '按 QQ 样式：背景 / 蓝气泡 / 时间 / 输入栏',
  css: `/* ═══════════════════════════════════════════════
   QQ · 聊天界面完整模板（联系人专属）
   ═══════════════════════════════════════════════
   作用范围：只有这个联系人的聊天页。
   每一段 = 一处；把值改成你想要的，不想要的整段删掉。
   下面填的都是 QQ 现在的默认样式——不改直接应用 ≈ 没变化。
   成对的两行里，第二行是深色模式的值（想让深浅不一样才留它）。
   特别说明：我的气泡颜色是程序内联写死的，模板里那两条
   规则带了 !important 才能盖住——保留它，别删。 */

/* ── 1. 聊天页背景 ── */
& { background: #F5F6F7; }
.dark & { background: #111214; }

/* ── 2. 顶部栏（返回 · 名字 · 菜单那一行） ── */
.qq-topbar { background: #F5F6F7; }
.dark & .qq-topbar { background: #111214; }

/* ── 3. 我的气泡（右侧蓝泡；文字和语音一起换） ── */
.qq-bub-mine {
  background: #0099FF !important;   /* QQ 蓝（深浅模式同色） */
  color: #FFFFFF;
}
/* 想让深色模式换个颜色，解开下面这行 */
/* .dark & .qq-bub-mine { background: #0077E0 !important; color: #FFFFFF; } */

/* ── 4. 对方的气泡（左侧白泡；文字和语音一起换） ── */
.qq-bub-theirs {
  background: #FFFFFF !important;
  color: #1F2329;
}
.dark & .qq-bub-theirs {
  background: #2A2C31 !important;
  color: #FFFFFF;
}

/* ── 5. 时间胶囊（居中的时间小条） ── */
.qq-time-chip {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.5);
}
.dark & .qq-time-chip {
  background: rgba(255, 255, 255, 0.13);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 6. 底部输入栏（打字那一栏） ── */
.qq-inputbar { background: #FFFFFF; }
.dark & .qq-inputbar { background: #1B1C1F; }

/* ── 7. 想再动手？解开这些注释 ── */
/* 气泡圆角改小一点 */
/* .qq-bub-mine, .qq-bub-theirs { border-radius: 8px; } */

/* 聊天文字放大一档 */
/* .qq-chat-list { font-size: 17px; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .qq-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

/** 聊天模板：微信 / QQ 各一份，按各自 App 的真实样式书写（联系人 › 聊天设置） */
export function chatCssTemplate(app: 'wx' | 'qq'): CssTemplate {
  return app === 'qq' ? QQ_CSS_TEMPLATE : WX_CSS_TEMPLATE;
}

// ================= 线下（线下模式 › 现场设置 › 自定义CSS） =================

/** 线下模板：线下模式所有界面的完整清单（默认值 = 默认毛玻璃皮肤当前样式） */
export const OFFLINE_CSS_TEMPLATE: CssTemplate = {
  name: '线下完整模板',
  desc: '页面 / 卡片 / 按钮 / 输入框 / 对话气泡',
  css: `/* ═══════════════════════════════════════════════
   线下模式 · 完整模板
   ═══════════════════════════════════════════════
   作用范围：线下模式的所有界面（开始页、见面页、
   存档、现场设置、历史记录）。
   每一段 = 一处；把值改成你想要的，不想要的整段删掉。
   下面填的是线下界面现在的默认样式（毛玻璃）——
   不改直接应用 ≈ 没变化。成对的两行里，第二行是深色
   模式的值（想让深浅不一样才留它）。 */

/* ── 1. 页面底色 ── */
& { background: #F3F1EE; }
.dark & { background: #0C0C0E; }

/* ── 2. 卡片（叙事卡 / 信息卡 / 设置卡） ── */
.off-card {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(255, 255, 255, 0.6);
}
.dark & .off-card {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}

/* ── 3. 顶部小按钮 / 幽灵按钮（返回 · 收藏 · 取消） ── */
.off-chip, .off-btn-ghost {
  background: rgba(255, 255, 255, 0.55);
  border-color: rgba(255, 255, 255, 0.7);
  color: rgba(0, 0, 0, 0.6);
}
.dark & .off-chip, .dark & .off-btn-ghost {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
}

/* ── 4. 主按钮（开始见面 · 新建 · 发送） ── */
.off-start, .off-btn-primary, .off-send {
  background: rgba(28, 28, 30, 0.9);
  color: #FFFFFF;
}
.dark & .off-start, .dark & .off-btn-primary, .dark & .off-send {
  background: #FFFFFF;
  color: #000000;
}

/* ── 5. 输入框（表单 · 聊天输入条） ── */
.off-input {
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(255, 255, 255, 0.7);
}
.dark & .off-input {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
}

/* ── 6. 我的对话气泡（见面页里你说的话） ── */
.off-bubble-user {
  background: rgba(236, 234, 231, 0.85);
  border-color: rgba(0, 0, 0, 0.06);
}
.dark & .off-bubble-user {
  background: rgba(44, 44, 46, 0.85);
  border-color: rgba(255, 255, 255, 0.1);
}

/* ── 7. 想再动手？解开这些注释 ── */
/* 卡片圆角改小 */
/* .off-card { border-radius: 12px; } */

/* 开始见面按钮改渐变色 */
/* .off-start { background: linear-gradient(180deg, #97CC58 0%, #71A83B 100%); color: #fff; } */

/* 叙事文字放大一档 */
/* .off-card { font-size: 15.5px; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* & { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};
