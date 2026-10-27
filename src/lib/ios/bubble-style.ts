/**
 * 聊天气泡装扮系统（第十七轮建立 · 第十八轮重构）——核心库
 * ---------------------------------------------------------------------------
 * 四种内置样式（样式对两侧同时生效，不再区分 TA/我）：
 *  - default  纯色气泡（无自定义色 = 跟随 App 原生配色；微信我方绿 / QQ 我方蓝）
 *             自定义色后：仅换底色/文字色，圆角不覆盖——与各 App 原生气泡完全一致
 *             （用户指定：微信改色后圆角不能变圆，须和默认一样）
 *  - rainbow  七彩气泡：每条消息按序号在参考图 9 色间循环取色
 *             （亮黄→青柠→杏色→青色→粉色→薰衣草→灰褐→琥珀→珊瑚）；圆角同原生
 *  - frosted  毛玻璃：胶囊形（椭圆）无尾巴 + backdrop-filter 高斯模糊 + 细白描边
 *  - liquid   液态气泡：透明玻璃材质（.bub-liquid）——胶囊形无尾巴 + 透明玻璃底 +
 *             高斯模糊提饱和 + 顶部月牙高光 + 流动光泽；文字色随深浅色模式自适应
 *
 * 微信 / QQ 两 App 装扮完全隔离（wx / qq 各持 { kind, mineColor, theirsColor }），
 * 在微信里选的样式不影响 QQ，反之亦然。
 * 自定义颜色区分「我的 / TA的」两侧独立配色；样式(kind)不分侧。
 *
 * 持久化：zustand useSettings → IndexedDB settings.bubbleStyle / settings.bubbleSchemes。
 * 渲染：bubbleVisual() 输出 override/className/style/tail，聊天页按返回值
 * 覆盖原生背景与文字色（内联样式 + .bub-liquid 一个全局类，无其他 CSS 污染）。
 *
 * 旧档迁移：第十七轮格式 { mine:{kind,color}, theirs:{kind,color} }（两 App 共享）
 * → 自动转成新格式：两侧 kind 取旧 mine.kind，两 App 各得 { kind, mineColor, theirsColor }。
 */
import type { CSSProperties } from 'react';

export type BubbleStyleKind = 'default' | 'rainbow' | 'frosted' | 'liquid';

/** 单个 App 的装扮：样式（不分侧） + 两侧独立自定义色 */
export interface BubbleAppStyle {
  kind: BubbleStyleKind;
  /** 我的气泡自定义基色（#RRGGBB）；undefined = 跟随默认 */
  mineColor?: string;
  /** TA 的气泡自定义基色（#RRGGBB）；undefined = 跟随默认 */
  theirsColor?: string;
}

/** 全量装扮配置：微信 / QQ 完全隔离 */
export interface BubbleStyleConfig {
  wx: BubbleAppStyle;
  qq: BubbleAppStyle;
}

/** 收藏夹里的一套已命名方案（归属某个 App，应用时只覆盖该 App） */
export interface BubbleScheme {
  id: string;
  name: string;
  /** 方案归属 App（保存时所在的应用） */
  app: 'wx' | 'qq';
  style: BubbleAppStyle;
  createdAt: number;
}

/**
 * 七彩循环色板 —— 用户参考图逐像素提取的 9 色
 * （气泡浏览数字 01→10 跳过 08 的顺序：亮黄/青柠/杏色/青色/粉色/薰衣草/灰褐/琥珀/珊瑚）
 */
export const RAINBOW_COLORS = [
  '#FFEB00', // 01 亮黄
  '#B9F000', // 02 青柠
  '#FEAE8B', // 03 杏色
  '#46EAEB', // 04 青色
  '#FE91A6', // 05 粉色
  '#E19EFF', // 06 薰衣草紫
  '#BBB4AC', // 07 灰褐
  '#FFCE0F', // 09 琥珀
  '#FB9F94', // 10 珊瑚
] as const;

export const BUBBLE_KINDS: readonly BubbleStyleKind[] = ['default', 'rainbow', 'frosted', 'liquid'];

/** 各 App 原生默认气泡底色（kind=default 且未自定义色时还原成它） */
export const NATIVE_BUBBLE: Record<'wx' | 'qq', { mine: string; theirs: string }> = {
  wx: { mine: '#95EC69', theirs: '#FFFFFF' },
  qq: { mine: '#0099FF', theirs: '#FFFFFF' },
};

export const DEFAULT_BUBBLE_STYLE: BubbleStyleConfig = {
  wx: { kind: 'default' },
  qq: { kind: 'default' },
};

/**
 * 弯钩小尾巴 SVG path（viewBox 0 0 11 14）——参考图同款「水滴弯钩」第十八轮修订版：
 * 尖端更细（末尾收敛成窄尖，参考图同款）；尖端在左上指向头像方向，
 * 外缘凸弧向下掠入气泡本体，右缘直线藏在气泡身下（宿主定位时横向重叠 2px 保证无缝）。
 */
export const BUBBLE_TAIL_PATH =
  'M11 3.4 C7.8 1.5 4 0.5 2.2 0.9 C1 1.15 0.7 2 1.5 2.6 C3.5 4.6 7.5 8.6 11 12.6 Z';

/** 预设色板（全色彩盘快捷区：参考图 9 色打头 + 常用色补充，共 24 色） */
export const PRESET_SWATCHES: readonly string[] = [
  '#FFEB00', '#B9F000', '#FEAE8B', '#46EAEB', '#FE91A6', '#E19EFF',
  '#BBB4AC', '#FFCE0F', '#FB9F94', '#FF3B30', '#FF9500', '#34C759',
  '#00C75D', '#00C7BE', '#3DD5F3', '#3D9BFF', '#0A5CFF', '#5856D6',
  '#AF52DE', '#C86DD7', '#FF2D55', '#FF6FA5', '#FFB3C1', '#4A4A4A',
];

// ---------------- 颜色工具（hex / rgb / hsl / yiq 互转） ----------------

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** #hex → { h: 0-360, s: 0-100, l: 0-100 } */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** { h: 0-360, s: 0-100, l: 0-100 } → #hex */
export function hslToHex(h: number, s: number, l: number): string {
  const hn = ((h % 360) + 360) % 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hn < 60) [r, g, b] = [c, x, 0];
  else if (hn < 120) [r, g, b] = [x, c, 0];
  else if (hn < 180) [r, g, b] = [0, c, x];
  else if (hn < 240) [r, g, b] = [0, x, c];
  else if (hn < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** hex → rgba() 字符串（alpha 0-1） */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** YIQ 亮度判断：返回适配的文字色（黑/白），保证自定义底色上文字可读 */
export function yiqTextOn(bg: string): '#000000' | '#FFFFFF' {
  const { r, g, b } = hexToRgb(bg);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#000000' : '#FFFFFF';
}

// ---------------- 存储读回校验（store.load 用） ----------------

function normKind(v: unknown): BubbleStyleKind {
  if (v === 'glass') return 'liquid'; // 第十七轮「玻璃」→ 第十八轮「液态」
  return BUBBLE_KINDS.includes(v as BubbleStyleKind) ? (v as BubbleStyleKind) : 'default';
}

function normColor(v: unknown): string | undefined {
  return isHexColor(v) ? (v as string).toUpperCase() : undefined;
}

/** 单 App 装扮 → 合法对象；不合法回默认 */
function normalizeAppStyle(v: unknown): BubbleAppStyle {
  const o = (v ?? {}) as Partial<BubbleAppStyle>;
  return {
    kind: normKind(o.kind),
    mineColor: normColor(o.mineColor),
    theirsColor: normColor(o.theirsColor),
  };
}

/** 任何来源（IndexedDB 旧档/脏数据）→ 合法配置；不合法回默认。含第十七轮旧档自动迁移。 */
export function normalizeBubbleStyle(v: unknown): BubbleStyleConfig {
  if (!v || typeof v !== 'object') return { wx: { kind: 'default' }, qq: { kind: 'default' } };
  const o = v as Record<string, unknown>;
  // 新格式：{ wx, qq }
  if (o.wx || o.qq) {
    return { wx: normalizeAppStyle(o.wx), qq: normalizeAppStyle(o.qq) };
  }
  // 第十七轮旧格式：{ mine: {kind,color}, theirs: {kind,color} }（两 App 共享）
  // → 迁移：kind 取旧 mine.kind（装扮主选择），两侧色各自保留，两 App 同步获得
  const oldMine = (o.mine ?? {}) as { kind?: unknown; color?: unknown };
  const oldTheirs = (o.theirs ?? {}) as { kind?: unknown; color?: unknown };
  const migrated: BubbleAppStyle = {
    kind: normKind(oldMine.kind ?? oldTheirs.kind),
    mineColor: normColor(oldMine.color),
    theirsColor: normColor(oldTheirs.color),
  };
  return { wx: { ...migrated }, qq: { ...migrated } };
}

/** 收藏夹列表读回校验：过滤非法项；旧格式方案（config.mine/theirs）迁移为 wx 方案 */
export function normalizeBubbleSchemes(v: unknown): BubbleScheme[] {
  if (!Array.isArray(v)) return [];
  const out: BubbleScheme[] = [];
  for (const s of v) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.createdAt !== 'number') continue;
    if (r.style && typeof r.style === 'object') {
      // 新格式
      out.push({
        id: r.id,
        name: r.name,
        app: r.app === 'qq' ? 'qq' : 'wx',
        style: normalizeAppStyle(r.style),
        createdAt: r.createdAt,
      });
    } else if (r.config && typeof r.config === 'object') {
      // 第十七轮旧格式 { config: { mine, theirs } } → 迁移为 wx 方案
      const c = r.config as { mine?: { kind?: unknown; color?: unknown }; theirs?: { kind?: unknown; color?: unknown } };
      out.push({
        id: r.id,
        name: r.name,
        app: 'wx',
        style: {
          kind: normKind(c.mine?.kind ?? c.theirs?.kind),
          mineColor: normColor(c.mine?.color),
          theirsColor: normColor(c.theirs?.color),
        },
        createdAt: r.createdAt,
      });
    }
  }
  return out;
}

/** 是否仍是原生默认（该 App 没有任何装扮）——聊天页可借此完全零开销直通 */
export function isNativeBubbleStyle(cfg: BubbleStyleConfig | undefined, app: 'wx' | 'qq'): boolean {
  if (!cfg) return true;
  const a = cfg[app];
  return a?.kind === 'default' && !a?.mineColor && !a?.theirsColor;
}

// ---------------- 气泡视觉计算（聊天页渲染核心） ----------------

export interface BubbleVisual {
  /** true = 需覆盖原生背景/文字（调用方停用原生 bg 类，改用下方 style/className） */
  override: boolean;
  /** override 时的附加类（液态气泡 = 'bub-liquid'；其余为空字符串） */
  className: string;
  /** override 时的内联样式（背景/圆角/文字色/模糊/描边/高光） */
  style: CSSProperties;
  /**
   * 小尾巴指令（第十八轮修订：尾巴策略按 App 区分）：
   *  - 'native' 保持 App 原生尾巴（微信小方块三角 · 纯色/七彩时随 tailColor 上色；QQ 原生无尾巴）
   *  - 'hook'   渲染参考图同款弯钩尾巴（QQ 纯色/七彩；fill = tailColor；我方自动镜像）
   *  - 'none'   不渲染尾巴（毛玻璃/液态胶囊）
   */
  tail: 'native' | 'hook' | 'none';
  /** 尾巴填充色（hook 的 SVG fill / native 方块的 backgroundColor；无装扮时为空） */
  tailColor: string;
}

const NO_VISUAL: BubbleVisual = { override: false, className: '', style: {}, tail: 'native', tailColor: '' };

/**
 * 计算某条消息气泡的最终视觉。
 * @param side     mine=我的消息（右侧）/ theirs=TA 的消息（左侧）
 * @param cfg      全量装扮配置（微信/QQ 隔离，取 cfg[app]）
 * @param msgIndex 消息在会话中的序号（七彩循环的递增索引：渲染时传 map 下标即可）
 * @param app      宿主 App（default 无自定义色时还原各 App 原生配色）
 */
export function bubbleVisual(
  side: 'mine' | 'theirs',
  cfg: BubbleStyleConfig | undefined,
  msgIndex: number,
  app: 'wx' | 'qq',
): BubbleVisual {
  const a = cfg?.[app];
  if (!a) return NO_VISUAL;
  const kind = normKind(a.kind);
  const color = normColor(side === 'mine' ? a.mineColor : a.theirsColor);

  // 原生默认：零覆盖直通（微信绿/白、QQ 蓝/白，深浅色模式类名由聊天页原样保留）
  if (kind === 'default' && !color) return NO_VISUAL;

  if (kind === 'rainbow') {
    // 七彩：参考图 9 色按消息序号循环；尾巴按 App —— 微信保持原生小三角（随色），
    // QQ 用参考图同款弯钩（QQ 原生无尾巴，装扮后才有）。
    // 圆角不覆盖：保留宿主原生 rounded-* 类（微信文本 5px / 语音 4px、QQ 10px / 12px）
    const idx = ((msgIndex % RAINBOW_COLORS.length) + RAINBOW_COLORS.length) % RAINBOW_COLORS.length;
    const c = RAINBOW_COLORS[idx];
    return {
      override: true,
      className: '',
      style: { backgroundColor: c, color: yiqTextOn(c) },
      tail: app === 'wx' ? 'native' : 'hook',
      tailColor: c,
    };
  }

  if (kind === 'frosted') {
    // 毛玻璃：胶囊形（椭圆）无尾巴 + 半透明底 + 高斯模糊 + 细白描边
    const base = color ?? '#FFFFFF';
    return {
      override: true,
      className: '',
      style: {
        borderRadius: '999px',
        backgroundColor: withAlpha(base, color ? 0.5 : 0.55),
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        boxShadow: '0 4px 16px rgba(31, 35, 41, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
        color: color ? yiqTextOn(color) : '#111111',
      },
      tail: 'none',
      tailColor: '',
    };
  }

  if (kind === 'liquid') {
    // 液态气泡（第十八轮再修订）：透明玻璃材质（用户指定）——胶囊形无尾巴。
    // 底色与文字色全部交给 .bub-liquid 全局类：透明玻璃底 + 模糊 + 高光，
    // 文字色随深浅色模式自适应（浅色黑字 / 深色白字）；
    // 自定义色 = 内联覆盖为该色低透明度渐变（α 0.30↔0.14，背景透出只留色膜），
    // 文字色仍走 CSS 自适应（极低透明度下按页面底色读字才准确）
    const base = color;
    return {
      override: true,
      className: 'bub-liquid',
      style: base
        ? {
            borderRadius: '999px',
            background: `linear-gradient(165deg, ${withAlpha(base, 0.30)} 0%, ${withAlpha(base, 0.14)} 45%, ${withAlpha(base, 0.20)} 75%, ${withAlpha(base, 0.28)} 100%)`,
          }
        : { borderRadius: '999px' },
      tail: 'none',
      tailColor: '',
    };
  }

  // default + 自定义色：仅换底色/文字色；圆角不覆盖——保留宿主原生 rounded-* 类
  // （微信文本 5px / 语音 4px、QQ 10px / 12px），改色后圆角与默认气泡完全一致（用户指定）。
  // 尾巴按 App —— 微信保持原生小三角（随色，用户指定不变），QQ 用弯钩尾巴
  return {
    override: true,
    className: '',
    style: { backgroundColor: color, color: yiqTextOn(color as string) },
    tail: app === 'wx' ? 'native' : 'hook',
    tailColor: color as string,
  };
}

/** 样式中文名（设置页/收藏夹展示用） */
export const BUBBLE_KIND_LABEL: Record<BubbleStyleKind, string> = {
  default: '默认',
  rainbow: '七彩',
  frosted: '毛玻璃',
  liquid: '液态',
};
