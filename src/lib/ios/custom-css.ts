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
 * 第七十五轮（用户指定：全局模板不要「一键换肤」）：全局模板全量清单化，逐项列出。
 * 第七十六轮（用户指定：模板按 App 分开、面板各自不同、更详细）：
 * 全局编辑器模板拆为四份——微信模板（聊天页/消息列表/通讯录/发现/我/朋友圈/
 * 聊天设置/状态卡片/红包转账亲属卡礼物代付外卖卡片逐张列出）、QQ模板（聊天/消息/
 * 联系人/动态/设置/卡片）、信息模板（会话列表/聊天页）、手机公共模板（手机壳/页面底/
 * 面板/表单/滚动条）；配套补齐语义锚点：wx-tabbar/wx-nav/wx-panel/wx-session-row/
 * wx-menu-row/wx-letter-bar/wx-moments-post·name·nav·act、qq-root/tabbar/head/search/
 * session-row/contact-row、sms-topbar/chat-list/bub-mine 与 bub-theirs 与 tail 系列/inputbar/
 * session-row/session-list/tabbar、chat-set-page/card/row（三 App 聊天设置共用组件）。
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

// ================= 全局（个性装扮 › 自定义CSS Tab · 第七十六轮按 App 拆分） =================
// 用户指定：示例模板按 QQ / 微信 / 信息 App 的样式分开（各自的面板风格互不相同），
// 且更详细——微信模板覆盖聊天页 / 消息列表 / 通讯录 / 发现 / 我 / 朋友圈 / 聊天设置 /
// 状态卡片 / 聊天卡片（红包·转账·亲属卡·礼物·代付·外卖…一张一段）；QQ 与信息同理。
// 外加一份「手机公共模板」管所有 App 共用的部分（手机壳 / 页面底 / 面板 / 表单 / 滚动条）。

/** 微信 · 完整模板：微信所有界面的元素清单（聊天页 / 消息列表 / 通讯录 / 发现 / 我 /
 *  朋友圈 / 聊天设置 / 状态卡片 / 聊天卡片），每段 = 真实锚点 + 当前默认值。 */
export const WX_APP_TEMPLATE: CssTemplate = {
  name: '微信模板（全部界面）',
  desc: '聊天 / 消息列表 / 通讯录 / 发现 / 我 / 朋友圈 / 设置 / 卡片',
  css: `/* ═══════════════════════════════════════════════
   微信 · 完整模板（全部界面）
   ═══════════════════════════════════════════════
   作用范围：整台手机里的「微信」——聊天页、消息列表、
   通讯录、发现、我、朋友圈、聊天设置、状态卡片、
   红包/转账/亲属卡/礼物/代付/外卖卡片……逐段列出。
   每一段 = 一处；把值改成你想要的，不想要的整段删掉。
   下面填的都是微信现在的默认样式——不改直接应用 ≈ 没变化。
   成对的两行里，第二行是深色模式的值（想让深浅不一样才留它）。
   两个提醒：① 页面灰白底（#EDEDED）与其他 App 共用，
   在「手机公共模板 › 页面背景」统一改；② 只想改某一个
   联系人的聊天页，用该联系人 › 聊天设置 › 自定义CSS
   （优先级更高，只作用于 TA）。 */

/* ══ 一、聊天界面（所有微信联系人通用） ══ */

/* ── 1. 顶部栏（返回 · 名字 · 菜单那一行） ── */
.wx-topbar { background: #EDEDED; }
.dark & .wx-topbar { background: #111111; }

/* ── 2. 我的气泡（右侧绿泡；文字和语音一起换） ── */
.wx-bub-mine { background: #95EC69 !important; color: #000000; }
.dark & .wx-bub-mine { background: #3EB575 !important; color: #000000; }

/* ── 3. 对方的气泡（左侧白泡） ── */
.wx-bub-theirs { background: #FFFFFF !important; color: #000000; }
.dark & .wx-bub-theirs { background: #1E1E1E !important; color: #FFFFFF; }

/* ── 4. 气泡小尾巴（跟气泡同色的小三角） ── */
.wx-bub-tail-mine { background: #95EC69 !important; }
.dark & .wx-bub-tail-mine { background: #3EB575 !important; }
.wx-bub-tail-theirs { background: #FFFFFF !important; }
.dark & .wx-bub-tail-theirs { background: #1E1E1E !important; }

/* ── 5. 时间胶囊（居中的时间小条） ── */
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

/* ── 6. 底部输入栏（打字那一栏） ── */
.wx-inputbar { background: #EDEDED; border-color: rgba(0, 0, 0, 0.07); }
.dark & .wx-inputbar { background: #111111; border-color: rgba(255, 255, 255, 0.06); }

/* ── 7. 状态卡片（聊天页点对方头像弹出的那张卡） ── */
[data-testid='peer-status-card'] > div {
  background: color-mix(in srgb, var(--background) 95%, transparent);
  border-color: color-mix(in srgb, var(--border) 60%, transparent);
}

/* ══ 二、消息列表（微信 Tab） ══ */

/* ── 8. 顶部导航（返回 / 搜索 / ＋ 那一行；默认透明贴着页面底色） ── */
/* .wx-nav { background: #EDEDED; } */

/* ── 9. 会话列表白色面板（微信特有的一整幅白底） ── */
.wx-panel { background: #FFFFFF; }
.dark & .wx-panel { background: #1A1A1A; }

/* ── 10. 会话行（头像 + 名字 + 预览；默认透明，置顶行浅灰） ── */
.wx-session-row { background: transparent; }
/* 想连置顶行一起换色？解开下面两行 */
/* .wx-session-row { background: #ECECEC !important; } */
/* .dark & .wx-session-row { background: rgba(255, 255, 255, 0.06) !important; } */

/* ── 11. 未读角标（头像右上角红色数字） ── */
[data-testid^='wx-unread-badge-'],
[data-testid='wx-tab-badge-chats'],
[data-testid='wx-tab-badge-discover'] { background: #FA5151; }

/* ── 12. 底部标签栏（微信 / 通讯录 / 发现 / 我） ── */
.wx-tabbar {
  background: #F7F7F7;
  border-color: rgba(0, 0, 0, 0.10);
}
.dark & .wx-tabbar {
  background: #1A1A1A;
  border-color: rgba(255, 255, 255, 0.10);
}

/* ── 13. 标签按钮（未选中的字色；选中色是程序控制的微信绿 #07C160） ── */
[data-testid^='wx-tab-'] { color: rgba(0, 0, 0, 0.55); }
.dark & [data-testid^='wx-tab-'] { color: rgba(255, 255, 255, 0.55); }

/* ══ 三、通讯录 ══ */

/* ── 14. 功能入口行（新的朋友 / 群聊 / 标签 / 公众号…；默认透明） ──
   这个锚点同时管「发现」页（朋友圈/视频号/扫一扫…）和「我」页
   （服务/收藏/相册/表情…）的行——三页的行样式一起换 */
.wx-menu-row { background: transparent; }

/* ── 15. 字母分组条（A B C…吸顶那一行） ── */
.wx-letter-bar { background: #EDEDED; color: rgba(0, 0, 0, 0.5); }
.dark & .wx-letter-bar { background: #111111; color: rgba(255, 255, 255, 0.5); }

/* ── 16. 好友行（默认透明） ── */
[data-testid^='wx-contact-'] { background: transparent; }

/* ══ 四、我 ══ */

/* ── 17. 名片区（头像 + 名字 + 微信号那一块；默认透明） ── */
[data-testid='wx-me-profile'] { background: transparent; }

/* ══ 五、朋友圈 ══ */

/* ── 18. 朋友圈页面底色 ── */
[data-testid='wx-moments-list'] { background: #FFFFFF; }
.dark & [data-testid='wx-moments-list'] { background: #111111; }

/* ── 19. 顶部导航（悬浮在封面上；滚过封面自动变白底，默认透明） ── */
/* .wx-moments-nav { background: rgba(255, 255, 255, 0.95); } */

/* ── 20. 动态卡（头像 + 名字 + 正文 + 配图一整行） ── */
.wx-moments-post {
  background: transparent;
  border-color: rgba(0, 0, 0, 0.06);
}
.dark & .wx-moments-post { border-color: rgba(255, 255, 255, 0.08); }

/* ── 21. 作者名字（微信经典蓝） ── */
.wx-moments-name { color: #576B95; }
.dark & .wx-moments-name { color: #8FA5C9; }

/* ── 22. 赞 / 评论小胶囊（时间右边那颗灰按钮） ── */
.wx-moments-act { background: #F2F2F2; }
.dark & .wx-moments-act { background: #2A2A2A; }

/* ── 23. 「N条新消息」胶囊（封面下方那条深色气泡） ── */
[data-testid='wx-moments-pill'] { background: rgba(0, 0, 0, 0.7); }
.dark & [data-testid='wx-moments-pill'] { background: rgba(255, 255, 255, 0.2); }

/* ══ 六、聊天设置界面（联系人的聊天设置页） ══ */

/* ── 24. 设置页底 + 设置卡（圆角 10px 方角卡 = 微信的；QQ/信息不受影响） ── */
.chat-set-page[class*='bg-[#EDEDED]'] { background: #EDEDED; }
.dark & .chat-set-page[class*='bg-[#EDEDED]'] { background: #111111; }
.chat-set-card[class*='rounded-[10px]'] { background: #FFFFFF; }
.dark & .chat-set-card[class*='rounded-[10px]'] { background: #1A1A1A; }

/* ── 25. 设置行（备注 / 主题 / 翻译…；默认透明） ── */
.chat-set-row { background: transparent; }

/* ══ 七、聊天卡片（一段一张，全在聊天页里） ══ */

/* ── 26. 红包卡（红橙渐变 + 小尾巴） ── */
.chat-card-rp .chat-card-body {
  background: linear-gradient(135deg, #F2694C, #E94E38) !important;
}
.chat-card-rp .chat-card-tail { background: #EC5A42 !important; }

/* ── 27. 转账卡（橙色渐变 + 小尾巴） ── */
.chat-card-tr .chat-card-body {
  background: linear-gradient(135deg, #F6AC3D, #EF9A2E) !important;
}
.chat-card-tr .chat-card-tail { background: #F2A233 !important; }

/* ── 28. 亲属卡（米白卡身 + 小尾巴） ── */
.chat-card-fam .chat-card-body { background: #FFFFFF; }
.dark & .chat-card-fam .chat-card-body { background: #1E1E1E; }
.chat-card-fam .chat-card-tail { background: #FFFFFF; }
.dark & .chat-card-fam .chat-card-tail { background: #1E1E1E; }

/* ── 29. 礼物卡（深蓝星空 + 小尾巴） ── */
.chat-card-gift .chat-card-body {
  background: linear-gradient(160deg, #4467B4 0%, #2C4E92 46%, #20396E 100%) !important;
}
.chat-card-gift .chat-card-tail { background: #2C4E92 !important; }

/* ── 30. 美团系卡片（找人代付 / 代点外卖 / 订单分享：白卡 + 黄横幅） ── */
.chat-card-mtpay, .chat-card-mtdraft, .chat-card-mtshare { background: #FFFFFF; }
.chat-card-mtpay .chat-card-banner {
  background: linear-gradient(to right, #FFDB3D, #FFC933) !important;
}
.chat-card-mtpay .chat-card-btn, .chat-card-mtdraft .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 31. 淘宝系卡片（找人代付 / AI 帮买 / 订单分享：白卡 + 橙横幅） ── */
.chat-card-tbpay, .chat-card-tbdraft, .chat-card-tbshare { background: #FFFFFF; }
.chat-card-tbpay .chat-card-banner {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}
.chat-card-tbpay .chat-card-btn {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}

/* ── 32. 文字卡片（象牙白纸面） ── */
.chat-card-text {
  background: #FBF9F3;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .chat-card-text {
  background: #2A282B;
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 33. 卡片底部标签条（红包/转账/亲属卡/礼物那行小字） ── */
.chat-card-label { color: rgba(255, 255, 255, 0.9); font-size: 12px; }

/* ── 34. 卡片小标签（代点外卖 / AI帮你买 / 已买单…） ── */
.chat-card-tag { border-radius: 99px; }

/* ── 35. 想再动手？解开这些注释 ── */
/* 气泡圆角改小一点 */
/* .wx-bub-mine, .wx-bub-theirs { border-radius: 8px; } */

/* 聊天文字放大一档 */
/* .wx-chat-list { font-size: 17px; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .wx-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

/** QQ · 完整模板：QQ 所有界面的元素清单（聊天页 / 消息列表 / 联系人 / 动态 /
 *  聊天设置 / 聊天卡片），面板风格与微信模板各自独立。 */
export const QQ_APP_TEMPLATE: CssTemplate = {
  name: 'QQ模板（全部界面）',
  desc: '聊天 / 消息列表 / 联系人 / 动态 / 设置 / 卡片',
  css: `/* ═══════════════════════════════════════════════
   QQ · 完整模板（全部界面）
   ═══════════════════════════════════════════════
   作用范围：整台手机里的「QQ」——聊天页、消息列表、
   联系人、动态、聊天设置、红包/转账/亲属卡/代付/外卖卡片。
   用法同微信模板：每段 = 一处，改值生效，不想要整段删。
   成对的两行里，第二行是深色模式的值。
   两个提醒：① 聊天页灰白底（#F5F6F7）与其他 App 共用，
   在「手机公共模板 › 页面背景」统一改；② 我的气泡颜色是
   程序内联写死的，规则带 !important 才能盖住——保留，别删。 */

/* ══ 一、聊天界面（所有 QQ 联系人通用） ══ */

/* ── 1. 顶部栏（返回 · 名字 · 菜单那一行） ── */
.qq-topbar { background: #F5F6F7; }
.dark & .qq-topbar { background: #111214; }

/* ── 2. 我的气泡（右侧蓝泡；文字和语音一起换） ── */
.qq-bub-mine { background: #0099FF !important; color: #FFFFFF; }
/* 想让深色模式换个颜色？解开下面这行 */
/* .dark & .qq-bub-mine { background: #0077E0 !important; color: #FFFFFF; } */

/* ── 3. 对方的气泡（左侧白泡） ── */
.qq-bub-theirs { background: #FFFFFF !important; color: #1F2329; }
.dark & .qq-bub-theirs { background: #2A2C31 !important; color: #FFFFFF; }

/* ── 4. 时间胶囊（居中的时间小条） ── */
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

/* ── 5. 底部输入栏（打字那一栏） ── */
.qq-inputbar { background: #FFFFFF; }
.dark & .qq-inputbar { background: #1B1C1F; }

/* ══ 二、消息列表（消息 Tab） ══ */

/* ── 6. QQ 主界面底色（QQ 特有的冷灰白，与微信的 #EDEDED 各改各的） ── */
.qq-root { background: #FAFAFC; }
.dark & .qq-root { background: #16171A; }

/* ── 7. 页面头部（头像 + 大标题那一行；默认透明贴着页面底色） ── */
/* .qq-head { background: #FAFAFC; } */

/* ── 8. 搜索框胶囊 ── */
.qq-search { background: rgba(0, 0, 0, 0.05); }
.dark & .qq-search { background: rgba(255, 255, 255, 0.08); }

/* ── 9. 会话行（默认透明，置顶行浅灰） ── */
.qq-session-row { background: transparent; }
/* 想连置顶行一起换色？解开下面两行 */
/* .qq-session-row { background: #F0F1F5 !important; } */
/* .dark & .qq-session-row { background: rgba(255, 255, 255, 0.06) !important; } */

/* ── 10. 未读角标（红色数字） ── */
[data-testid^='qq-unread-badge-'],
[data-testid='qq-tab-badge-消息'],
[data-testid='qq-tab-badge-动态'],
[data-testid='qq-discover-zone-badge'] { background: #F5455C; }

/* ── 11. 底部标签栏（消息 / 联系人 / 动态） ── */
.qq-tabbar {
  background: #FFFFFF;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .qq-tabbar {
  background: #1B1C1F;
  border-color: rgba(255, 255, 255, 0.06);
}

/* ── 12. 标签按钮（未选中字色；选中色是程序控制的 QQ 蓝 #1E6FFF） ── */
[data-testid^='qq-tab-'] { color: rgba(0, 0, 0, 0.55); }
.dark & [data-testid^='qq-tab-'] { color: rgba(255, 255, 255, 0.55); }

/* ══ 三、联系人 ══ */

/* ── 13. 好友行（我的好友列表里的行；默认透明） ── */
.qq-contact-row { background: transparent; }

/* ── 14. 分组标签（分组 / 好友 / 群聊那排；选中色是程序控制的 QQ 蓝） ── */
[data-testid^='qq-ct-tab-'] { color: rgba(0, 0, 0, 0.55); }
.dark & [data-testid^='qq-ct-tab-'] { color: rgba(255, 255, 255, 0.55); }

/* ══ 四、动态 ══ */

/* ── 15. 动态入口行（好友动态 / 相册 / 日历…；默认透明） ── */
[data-testid^='qq-discover-'] { background: transparent; }

/* ══ 五、聊天设置界面（联系人的聊天设置页） ══ */

/* ── 16. 设置页底 + 设置卡（圆角 14px 大圆角卡 = QQ 的；微信/信息不受影响） ── */
.chat-set-page[class*='bg-[#F5F6F8]'] { background: #F5F6F8; }
.dark & .chat-set-page[class*='bg-[#F5F6F8]'] { background: #16171A; }
.chat-set-card[class*='rounded-[14px]'] { background: #FFFFFF; }
.dark & .chat-set-card[class*='rounded-[14px]'] { background: #232529; }

/* ══ 六、聊天卡片（QQ 无小尾巴、无礼物卡） ══ */

/* ── 17. QQ红包卡（红粉渐变封面） ── */
.chat-card-rp {
  background: linear-gradient(168deg, #FC8163 0%, #F5455C 55%, #F2394E 100%) !important;
}

/* ── 18. 转账卡（QQ蓝渐变） ── */
.chat-card-tr {
  background: linear-gradient(135deg, #29ABF2 0%, #0099FF 100%) !important;
}

/* ── 19. 亲属卡（金色渐变） ── */
.chat-card-fam {
  background: linear-gradient(135deg, #F7D488 0%, #EDB95E 100%) !important;
}

/* ── 20. 美团系卡片（找人代付 / 代点外卖 / 订单分享：白卡 + 黄横幅） ── */
.chat-card-mtpay, .chat-card-mtdraft, .chat-card-mtshare { background: #FFFFFF; }
.chat-card-mtpay .chat-card-banner {
  background: linear-gradient(to right, #FFDB3D, #FFC933) !important;
}
.chat-card-mtpay .chat-card-btn, .chat-card-mtdraft .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 21. 淘宝系卡片（找人代付 / AI 帮买 / 订单分享：白卡 + 橙横幅） ── */
.chat-card-tbpay, .chat-card-tbdraft, .chat-card-tbshare { background: #FFFFFF; }
.chat-card-tbpay .chat-card-banner {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}
.chat-card-tbpay .chat-card-btn {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}

/* ── 22. 文字卡片（象牙白纸面） ── */
.chat-card-text {
  background: #FBF9F3;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .chat-card-text {
  background: #2A282B;
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 23. 底部标签条（QQ红包/转账/亲属卡那行小字） ── */
.chat-card-label {
  color: rgba(255, 255, 255, 0.95);
  border-color: rgba(255, 255, 255, 0.25);
  font-size: 12.5px;
}

/* ── 24. 小标签（代点外卖 / AI帮你买 / 已买单…） ── */
.chat-card-tag { border-radius: 99px; }

/* ── 25. 想再动手？解开这些注释 ── */
/* 气泡圆角改小一点 */
/* .qq-bub-mine, .qq-bub-theirs { border-radius: 8px; } */

/* 聊天文字放大一档 */
/* .qq-chat-list { font-size: 17px; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .qq-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

/** 信息 · 完整模板：信息 App（iMessage 风）的元素清单（会话列表 + 聊天界面）。 */
export const SMS_APP_TEMPLATE: CssTemplate = {
  name: '信息模板（全部界面）',
  desc: '会话列表 / 聊天页：顶栏 / 气泡 / 尾巴 / 输入栏',
  css: `/* ═══════════════════════════════════════════════
   信息 · 完整模板（全部界面）
   ═══════════════════════════════════════════════
   作用范围：整台手机里的「信息」App（iMessage 风）——
   会话列表、聊天页（顶栏 / 气泡 / 小尾巴 / 输入栏）。
   用法同微信模板：每段 = 一处，改值生效，不想要整段删。
   成对的两行里，第二行是深色模式的值。
   两个提醒：① 信息 App 的页面底色跟系统走，在「手机公共
   模板 › 页面背景」统一改；② 气泡若装扮过（纯色/七彩），
   颜色是程序写死的，规则里的 !important 用来盖住——保留。 */

/* ══ 一、会话列表（信息 Tab） ══ */

/* ── 1. 会话行（小助手 / 好友；默认透明，置顶行浅灰） ── */
.sms-session-row { background: transparent; }
/* 想连置顶行一起换色？解开下面两行 */
/* .sms-session-row { background: rgba(0, 0, 0, 0.06) !important; } */
/* .dark & .sms-session-row { background: rgba(255, 255, 255, 0.08) !important; } */

/* ── 2. 未读角标（红色数字） ── */
[data-testid='sms-unread-badge'] { background: #FF3B30; }

/* ── 3. 底部分段栏（信息 / 联系人 胶囊那一栏；毛玻璃半透） ── */
.sms-tabbar { background: rgba(255, 255, 255, 0.6); }
.dark & .sms-tabbar { background: rgba(255, 255, 255, 0.06); }
/* 分段的选中胶囊是 iOS 蓝（#007AFF），由程序控制 */

/* ══ 二、聊天界面 ══ */

/* ── 4. 顶部栏（返回 + 头像/手机号 + 摄像机；毛玻璃半透） ── */
.sms-topbar {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.6);
}
.dark & .sms-topbar {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.09);
}

/* ── 5. 我的气泡（右侧 iOS 蓝泡；文字和语音一起换） ── */
.sms-bub-mine { background: #007AFF !important; color: #FFFFFF; }

/* ── 6. 对方的气泡（左侧灰泡） ── */
.sms-bub-theirs { background: hsl(var(--muted)) !important; color: hsl(var(--foreground)); }

/* ── 7. 气泡小尾巴（跟气泡同色的弯钩） ── */
.sms-bub-tail-mine { background: #007AFF !important; }
.sms-bub-tail-theirs { background: hsl(var(--muted)) !important; }

/* ── 8. 底部输入栏（加号 + 输入胶囊 + 麦克风；毛玻璃半透） ── */
.sms-inputbar {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.6);
}
.dark & .sms-inputbar {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.09);
}

/* ── 9. 想再动手？解开这些注释 ── */
/* 聊天文字放大一档 */
/* .sms-chat-list { font-size: 17px; } */

/* 气泡圆角改小一点 */
/* .sms-bub-mine, .sms-bub-theirs { border-radius: 12px; } */

/* 换个字体（把链接换成你要的字体） */
/* @import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap"); */
/* .sms-chat-list { font-family: "ZCOOL KuaiLe", sans-serif; } */`,
};

/** 手机公共模板：所有 App 共用的部分（手机壳 / 页面底 / 导航 / 面板 /
 *  表单控件 / 按钮手感 / 滚动条）。微信 / QQ / 信息各自的界面在它们自己的模板里；
 *  线下模式在 现场设置 › 自定义CSS。 */
export const GLOBAL_CSS_TEMPLATE: CssTemplate = {
  name: '手机公共模板',
  desc: '状态栏 / 灵动岛 / 页面底 / 面板 / 输入框 / 按钮所有 App 共用部分',
  css: `/* ═══════════════════════════════════════════════
   手机 · 公共模板（跨 App 的公共部分）
   ═══════════════════════════════════════════════
   作用范围：所有 App 共用的部分——手机壳（状态栏/
   灵动岛/Home 条）、页面灰白底、顶部导航、面板卡片、
   输入框/选择框/复选框、按钮手感、文字选中、滚动条。
   微信/QQ/信息各自的界面在它们自己的模板里改；
   线下模式在 现场设置 › 自定义CSS。
   每一段 = 一处；下面都是当前默认值——不改直接应用 ≈ 没变化。
   成对的两行里，第二行是深色模式的值。 */

/* ══ 一、手机壳 ══ */

/* ── 1. 状态栏（顶部时间 · 信号 · 电池） ── */
/* 默认自动选黑/白字；想固定颜色就解开注释填 */
/* .ph-statusbar { color: #1F1F1F; } */

/* ── 2. 灵动岛（顶部黑色胶囊） ── */
.ph-island { background: #000000; }

/* ── 3. Home 指示条（屏幕最底部的小横杠） ── */
/* 同样默认自动黑/白；想固定颜色就解开注释填 */
/* .ph-homebar { background: #1F1F1F; opacity: 0.9; } */

/* ══ 二、页面与导航 ══ */

/* ── 4. 页面背景（微信 / QQ / 淘宝…所有 App 的灰白底一起换色） ── */
[class*='bg-[#F5F6F7]'], [class*='bg-[#EDEDED]'], [class*='bg-[#F4F5F7]'],
[class*='bg-[#F7F8FA]'], [class*='bg-[#F5F6F8]'], [class*='bg-[#F7F7F7]'],
[class*='bg-[#F2F3F5]'], [class*='bg-[#F6F7F8]'], [class*='bg-[#F8F8F8]'],
[class*='bg-[#F6F7F9]'], [class*='bg-[#F4F5F9]'], [class*='bg-[#FAFAFC]'],
[class*='bg-[#FAFAFA]'], [class*='bg-[#EFEFF4]'] {
  background: #F5F6F7;   /* ← 所有 App 底色统一换成这个值 */
}
.dark & [class*='bg-[#F5F6F7]'], .dark & [class*='bg-[#EDEDED]'],
.dark & [class*='bg-[#F4F5F7]'], .dark & [class*='bg-[#F7F8FA]'],
.dark & [class*='bg-[#F5F6F8]'], .dark & [class*='bg-[#F7F7F7]'],
.dark & [class*='bg-[#F2F3F5]'], .dark & [class*='bg-[#F6F7F8]'],
.dark & [class*='bg-[#F8F8F8]'], .dark & [class*='bg-[#F6F7F9]'],
.dark & [class*='bg-[#F4F5F9]'], .dark & [class*='bg-[#FAFAFC]'],
.dark & [class*='bg-[#FAFAFA]'], .dark & [class*='bg-[#EFEFF4]'] {
  background: #111214;   /* 深色模式下这些页面的底色 */
}

/* ── 5. App 顶部导航栏（大标题那一整条） ── */
[class*='bg-background/80'] {
  background: color-mix(in oklab, var(--background) 80%, transparent);
}
/* ↑ 这行 = 系统默认（半透明，自动跟随深浅模式）；
   换成你要的颜色即可，如 rgba(255, 250, 240, 0.85) */

/* ══ 三、面板 ══ */

/* ── 6. 面板与卡片（设置页 · 弹窗 · 主题面板；线下模式的卡在现场设置里改） ── */
.rt-panel { background: #FFFFFF; }                    /* 古早主题白卡 */
.dark & .rt-panel { background: #35353D; }
.lg-card  { background: rgba(255, 255, 255, 0.62); }  /* 液态玻璃内容卡 */
.dark & .lg-card { background: rgba(28, 28, 34, 0.62); }
.lg-sheet { background: rgba(255, 255, 255, 0.78); }  /* 液态玻璃弹层 */
.dark & .lg-sheet { background: rgba(30, 30, 36, 0.86); }
.lg-panel { background: rgba(255, 255, 255, 0.96); }  /* 液态玻璃白色分组卡 */
.dark & .lg-panel { background: rgba(28, 28, 32, 0.96); }

/* ══ 四、输入与手感 ══ */

/* ── 7. 输入框 / 选择框 / 复选框（表单里那些） ── */
/* 输入框打字时的光标颜色 */
/* input, textarea { caret-color: #FF7A59; } */
/* 选择框（下拉框）统一圆角 */
/* select { border-radius: 10px; } */
/* 复选框勾选颜色（各 App 默认不一样：微信绿 / 删除红…这里统一改） */
/* input[type='checkbox'] { accent-color: #07C160; } */

/* ── 8. 按钮手感（按下轻轻缩，松手弹回来） ── */
button {
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.3, 1.4),
    background-color 0.18s, color 0.18s, opacity 0.18s;
}
button:active { transform: scale(0.955); }

/* ══ 五、细节 ══ */

/* ── 9. 文字选中（长按 / 拖选文字的高亮色） ── */
/* 解开注释填你想要的颜色 */
/* ::selection { background: #FF7A59; color: #FFFFFF; } */

/* ── 10. 滚动条（所有列表的滚动条） ── */
::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.25); border-radius: 99px; }
.dark & ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.25); }

/* ── 11. 想再动手？解开这些注释 ── */
/* 所有按钮统一圆角（注意：胶囊按钮会变方角） */
/* button, input, textarea, select { border-radius: 12px; } */

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

// ================= 聊天卡片模板（第七十二轮：红包/转账/亲属卡/礼物/代付/外卖全可改） =================
// 每张卡片都挂了语义锚点类，一套类名微信/QQ 通用：
//   .chat-card        所有聊天卡片（整体阴影等）
//   .chat-card-body   卡身（圆角 / 底色改这里）
//   .chat-card-tail   小尾巴（微信红包/转账/亲属卡/礼物卡的菱形尾巴）
//   .chat-card-label  底部标签条（红包/转账/亲属卡/礼物那行小字）
//   .chat-card-tag    小标签（代点外卖 / AI帮你买 / 已买单…）
//   .chat-card-banner 代付卡的横幅色块
//   .chat-card-btn    卡片里的主按钮（查看详情 / 确认下单）
// 具体卡片：.chat-card-rp 红包 / -tr 转账 / -fam 亲属卡 / -gift 礼物 / -mtpay 美团代付 /
//   -tbpay 淘宝代付 / -mtdraft 外卖草稿 / -tbdraft 代买草稿 / -mtshare · -tbshare 订单分享 / -text 文字卡片
// 注意：卡身渐变色是程序内联写死的 → 覆盖它要带 !important（模板里已带）。

/** 微信 · 聊天卡片完整模板（红包/转账/亲属卡/礼物/代付/外卖/订单分享/文字卡） */
const WX_CSS_CARD_TEMPLATE: CssTemplate = {
  name: '微信卡片模板',
  desc: '红包 / 转账 / 亲属卡 / 礼物 / 代付 / 外卖 / 标签 / 圆角',
  css: `/* ═══════════════════════════════════════════════
   微信 · 聊天卡片完整模板（联系人专属）
   ═══════════════════════════════════════════════
   作用范围：只有这个联系人聊天页里的卡片——
   红包、转账、亲属卡、礼物、美团/淘宝代付、
   外卖与代买草稿、订单分享、文字卡片。
   每一段 = 一张卡；把值改成你想要的，不想要的整段删掉。
   下面填的都是卡片现在的默认样式——不改直接应用 ≈ 没变化。
   注意：卡片颜色是程序写死的，规则里带 !important 才能盖住。 */

/* ── 1. 通用：所有卡片的圆角 / 阴影一起改 ── */
.chat-card-body { border-radius: 4px; }
/* 圆角想更圆润？解开下面这行 */
/* .chat-card-body { border-radius: 14px; } */

/* ── 2. 红包卡（红橙渐变 + 小尾巴） ── */
.chat-card-rp .chat-card-body {
  background: linear-gradient(135deg, #F2694C, #E94E38) !important;
}
.chat-card-rp .chat-card-tail { background: #EC5A42 !important; }

/* ── 3. 转账卡（橙色渐变 + 小尾巴） ── */
.chat-card-tr .chat-card-body {
  background: linear-gradient(135deg, #F6AC3D, #EF9A2E) !important;
}
.chat-card-tr .chat-card-tail { background: #F2A233 !important; }

/* ── 4. 亲属卡（米白卡身 + 小尾巴） ── */
.chat-card-fam .chat-card-body { background: #FFFFFF; }
.dark & .chat-card-fam .chat-card-body { background: #1E1E1E; }
.chat-card-fam .chat-card-tail { background: #FFFFFF; }
.dark & .chat-card-fam .chat-card-tail { background: #1E1E1E; }

/* ── 5. 礼物卡（深蓝星空） ── */
.chat-card-gift .chat-card-body {
  background: linear-gradient(160deg, #4467B4 0%, #2C4E92 46%, #20396E 100%) !important;
}
.chat-card-gift .chat-card-tail { background: #2C4E92 !important; }

/* ── 6. 美团系卡片：找人代付 / 代点外卖 / 订单分享（白卡 + 黄横幅） ── */
.chat-card-mtpay, .chat-card-mtdraft, .chat-card-mtshare { background: #FFFFFF; }
.chat-card-mtpay .chat-card-banner {
  background: linear-gradient(to right, #FFDB3D, #FFC933) !important;
}
.chat-card-mtpay .chat-card-btn, .chat-card-mtdraft .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 7. 淘宝系卡片：找人代付 / AI 帮买 / 订单分享（白卡 + 橙横幅） ── */
.chat-card-tbpay, .chat-card-tbdraft, .chat-card-tbshare { background: #FFFFFF; }
.chat-card-tbpay .chat-card-banner {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}
.chat-card-tbpay .chat-card-btn {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}

/* ── 8. 文字卡片（象牙白纸面） ── */
.chat-card-text {
  background: #FBF9F3;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .chat-card-text {
  background: #2A282B;
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 9. 底部标签条（红包/转账/亲属卡/礼物 那行小字） ── */
.chat-card-label {
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
}

/* ── 10. 小标签（代点外卖 / AI帮你买 / 已买单…） ── */
.chat-card-tag { border-radius: 99px; }
/* 想让小标签统一变一个颜色？解开下面两行 */
/* .chat-card-tag { background: #FFE8D2 !important; color: #B25B00 !important; } */

/* ── 11. 想再动手？解开这些注释 ── */
/* 红包变成蓝色系 */
/* .chat-card-rp .chat-card-body { background: linear-gradient(135deg, #5AC8FA, #0A84FF) !important; } */
/* .chat-card-rp .chat-card-tail { background: #0A84FF !important; } */

/* 卡片阴影统一加重 */
/* .chat-card { filter: drop-shadow(0 8px 20px rgba(0, 0, 0, 0.18)); } */`,
};

/** QQ · 聊天卡片完整模板（红包/转账/亲属卡/代付/外卖/订单分享/文字卡；QQ 卡无尾巴、无礼物卡） */
const QQ_CSS_CARD_TEMPLATE: CssTemplate = {
  name: 'QQ卡片模板',
  desc: '红包 / 转账 / 亲属卡 / 代付 / 外卖 / 标签 / 圆角',
  css: `/* ═══════════════════════════════════════════════
   QQ · 聊天卡片完整模板（联系人专属）
   ═══════════════════════════════════════════════
   作用范围：只有这个联系人聊天页里的卡片——
   QQ红包、转账、亲属卡、美团/淘宝代付、外卖与
   代买草稿、订单分享、文字卡片。
   每一段 = 一张卡；把值改成你想要的，不想要的整段删掉。
   下面填的都是卡片现在的默认样式——不改直接应用 ≈ 没变化。
   注意：卡片颜色是程序写死的，规则里带 !important 才能盖住。 */

/* ── 1. 通用：所有卡片的圆角一起改 ── */
.chat-card-body { border-radius: 12px; }
/* 圆角想更圆润？解开下面这行 */
/* .chat-card-body { border-radius: 18px; } */

/* ── 2. QQ红包卡（红粉渐变封面） ── */
.chat-card-rp {
  background: linear-gradient(168deg, #FC8163 0%, #F5455C 55%, #F2394E 100%) !important;
}

/* ── 3. 转账卡（QQ蓝渐变） ── */
.chat-card-tr {
  background: linear-gradient(135deg, #29ABF2 0%, #0099FF 100%) !important;
}

/* ── 4. 亲属卡（金色渐变） ── */
.chat-card-fam {
  background: linear-gradient(135deg, #F7D488 0%, #EDB95E 100%) !important;
}

/* ── 5. 美团系卡片：找人代付 / 代点外卖 / 订单分享（白卡 + 黄横幅） ── */
.chat-card-mtpay, .chat-card-mtdraft, .chat-card-mtshare { background: #FFFFFF; }
.chat-card-mtpay .chat-card-banner {
  background: linear-gradient(to right, #FFDB3D, #FFC933) !important;
}
.chat-card-mtpay .chat-card-btn, .chat-card-mtdraft .chat-card-btn {
  background: linear-gradient(to right, #FFD900, #FFC300) !important;
}

/* ── 6. 淘宝系卡片：找人代付 / AI 帮买 / 订单分享（白卡 + 橙横幅） ── */
.chat-card-tbpay, .chat-card-tbdraft, .chat-card-tbshare { background: #FFFFFF; }
.chat-card-tbpay .chat-card-banner {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}
.chat-card-tbpay .chat-card-btn {
  background: linear-gradient(to right, #FF7A21, #FF4400) !important;
}

/* ── 7. 文字卡片（象牙白纸面） ── */
.chat-card-text {
  background: #FBF9F3;
  border-color: rgba(0, 0, 0, 0.05);
}
.dark & .chat-card-text {
  background: #2A282B;
  border-color: rgba(255, 255, 255, 0.08);
}

/* ── 8. 底部标签条（转账/亲属卡/QQ红包 那行小字） ── */
.chat-card-label {
  color: rgba(255, 255, 255, 0.95);
  border-color: rgba(255, 255, 255, 0.25);
  font-size: 12.5px;
}

/* ── 9. 小标签（代点外卖 / AI帮你买 / 已买单…） ── */
.chat-card-tag { border-radius: 99px; }
/* 想让小标签统一变一个颜色？解开下面两行 */
/* .chat-card-tag { background: #FFE8D2 !important; color: #B25B00 !important; } */

/* ── 10. 想再动手？解开这些注释 ── */
/* 红包变成蓝色系 */
/* .chat-card-rp { background: linear-gradient(168deg, #5AC8FA 0%, #0A84FF 100%) !important; } */

/* 卡片阴影统一加重 */
/* .chat-card { filter: drop-shadow(0 8px 20px rgba(0, 0, 0, 0.18)); } */`,
};

/** 聊天模板组：界面完整模板 + 卡片模板（「示例」弹层按此列出） */
export function chatCssTemplates(app: 'wx' | 'qq'): CssTemplate[] {
  return app === 'qq' ? [QQ_CSS_TEMPLATE, QQ_CSS_CARD_TEMPLATE] : [WX_CSS_TEMPLATE, WX_CSS_CARD_TEMPLATE];
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

/** 全局模板组（个性装扮 › 自定义CSS Tab）：微信 / QQ / 信息按 App 分开 + 手机公共部分 */
export const GLOBAL_CSS_TEMPLATES: CssTemplate[] = [
  WX_APP_TEMPLATE,
  QQ_APP_TEMPLATE,
  SMS_APP_TEMPLATE,
  GLOBAL_CSS_TEMPLATE,
];

/** 线下模板组（线下模式 › 现场设置） */
export const OFFLINE_CSS_TEMPLATES: CssTemplate[] = [OFFLINE_CSS_TEMPLATE];
