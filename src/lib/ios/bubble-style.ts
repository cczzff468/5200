/**
 * 聊天气泡装扮系统（第十七轮）——核心库
 * ---------------------------------------------------------------------------
 * 四种内置样式：
 *  - default  纯色气泡（无自定义色 = 跟随 App 原生配色；微信我方绿 / QQ 我方蓝）
 *  - rainbow  七彩气泡：每条消息按序号在 红橙黄绿青蓝紫 间循环取色
 *  - frosted  毛玻璃：半透明底 + backdrop-filter 高斯模糊 + 细白描边
 *  - glass    玻璃：渐变透明底 + 模糊/提饱和 + 内高光反光条
 *
 * 双端独立：mine（我的气泡）/ theirs（TA的气泡）各自持有 { kind, color }，
 * 选色只应用到当前编辑侧；两 App（微信/QQ）共用同一套装扮（装扮随人走）。
 *
 * 持久化：zustand useSettings → IndexedDB settings.bubbleStyle / settings.bubbleSchemes。
 * 渲染：bubbleVisual() 输出 override/className/style/tail，聊天页按返回值
 * 覆盖原生背景与文字色（全部走内联样式/CSS 变量，无全局 CSS 污染）。
 */
import type { CSSProperties } from 'react';

export type BubbleStyleKind = 'default' | 'rainbow' | 'frosted' | 'glass';

export interface BubbleSideStyle {
  kind: BubbleStyleKind;
  /** 自定义基色（#RRGGBB）；undefined = 跟随默认（default=App 原生 / frosted=白玻璃 / glass=白玻璃） */
  color?: string;
}

export interface BubbleStyleConfig {
  /** 我的气泡（右侧） */
  mine: BubbleSideStyle;
  /** TA 的气泡（左侧） */
  theirs: BubbleSideStyle;
}

/** 收藏夹里的一套已命名方案 */
export interface BubbleScheme {
  id: string;
  name: string;
  config: BubbleStyleConfig;
  createdAt: number;
}

/** 七彩循环色板：红橙黄绿青蓝紫（iOS 系统色域，饱和度统一） */
export const RAINBOW_COLORS = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#3D9BFF', '#AF52DE'] as const;

export const BUBBLE_KINDS: readonly BubbleStyleKind[] = ['default', 'rainbow', 'frosted', 'glass'];

/** 各 App 原生默认气泡底色（kind=default 且未自定义色时还原成它） */
export const NATIVE_BUBBLE: Record<'wx' | 'qq', { mine: string; theirs: string }> = {
  wx: { mine: '#95EC69', theirs: '#FFFFFF' },
  qq: { mine: '#0099FF', theirs: '#FFFFFF' },
};

export const DEFAULT_BUBBLE_STYLE: BubbleStyleConfig = {
  mine: { kind: 'default' },
  theirs: { kind: 'default' },
};

/** 预设色板（全色彩盘快捷区：24 色常用色） */
export const PRESET_SWATCHES: readonly string[] = [
  '#FF3B30', '#FF6B4A', '#FF9500', '#FFCC00', '#FFE600', '#D4FF3F',
  '#34C759', '#00C75D', '#00C7BE', '#3DD5F3', '#3D9BFF', '#0A5CFF',
  '#5856D6', '#AF52DE', '#C86DD7', '#FF2D55', '#FF6FA5', '#FFB3C1',
  '#F5A623', '#8B5A2B', '#7ADCB0', '#95A5A6', '#4A4A4A', '#111111',
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

function normalizeSide(v: unknown): BubbleSideStyle {
  const o = (v ?? {}) as Partial<BubbleSideStyle>;
  const kind = BUBBLE_KINDS.includes(o.kind as BubbleStyleKind) ? (o.kind as BubbleStyleKind) : 'default';
  return { kind, color: isHexColor(o.color) ? (o.color as string).toUpperCase() : undefined };
}

/** 任何来源（IndexedDB 旧档/脏数据）→ 合法配置；不合法回默认 */
export function normalizeBubbleStyle(v: unknown): BubbleStyleConfig {
  if (!v || typeof v !== 'object') return { mine: { kind: 'default' }, theirs: { kind: 'default' } };
  const o = v as Partial<BubbleStyleConfig>;
  if (!o.mine || !o.theirs) return { mine: { kind: 'default' }, theirs: { kind: 'default' } };
  return { mine: normalizeSide(o.mine), theirs: normalizeSide(o.theirs) };
}

/** 收藏夹列表读回校验：过滤非法项 */
export function normalizeBubbleSchemes(v: unknown): BubbleScheme[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (s): s is BubbleScheme =>
      !!s &&
      typeof s === 'object' &&
      typeof (s as BubbleScheme).id === 'string' &&
      typeof (s as BubbleScheme).name === 'string' &&
      !!(s as BubbleScheme).config?.mine &&
      !!(s as BubbleScheme).config?.theirs &&
      typeof (s as BubbleScheme).createdAt === 'number',
  );
}

/** 是否仍是原生默认（没有任何装扮）——聊天页可借此完全零开销直通 */
export function isNativeBubbleStyle(cfg: BubbleStyleConfig | undefined): boolean {
  if (!cfg) return true;
  return cfg.mine?.kind === 'default' && !cfg.mine?.color && cfg.theirs?.kind === 'default' && !cfg.theirs?.color;
}

// ---------------- 气泡视觉计算（聊天页渲染核心） ----------------

export interface BubbleVisual {
  /** true = 需覆盖原生背景/文字（调用方停用原生 bg 类，改用下方 style/className） */
  override: boolean;
  /** override 时的附加类（当前仅文字色 text-black/text-white） */
  className: string;
  /** override 时的内联样式（背景/模糊/描边/高光） */
  style: CSSProperties;
  /** 微信小三角的样式（override 时；QQ 无三角可忽略） */
  tail: CSSProperties;
}

const NO_VISUAL: BubbleVisual = { override: false, className: '', style: {}, tail: {} };

/**
 * 计算某条消息气泡的最终视觉。
 * @param side      mine=我的消息（右侧）/ theirs=TA 的消息（左侧）
 * @param cfg       全局装扮配置
 * @param msgIndex  消息在会话中的序号（七彩循环的递增索引：渲染时传 map 下标即可，
 *                  每发一条新消息序号 +1 → 颜色自动切到下一色）
 * @param app       宿主 App（default 无自定义色时还原各 App 原生配色）
 */
export function bubbleVisual(
  side: 'mine' | 'theirs',
  cfg: BubbleStyleConfig | undefined,
  msgIndex: number,
  app: 'wx' | 'qq',
): BubbleVisual {
  if (!cfg) return NO_VISUAL;
  const s = cfg[side];
  if (!s) return NO_VISUAL;
  const kind: BubbleStyleKind = BUBBLE_KINDS.includes(s.kind) ? s.kind : 'default';
  const color = isHexColor(s.color) ? (s.color as string).toUpperCase() : undefined;

  // 原生默认：零覆盖直通（微信绿/白、QQ 蓝/白，深浅色模式类名由聊天页原样保留）
  if (kind === 'default' && !color) return NO_VISUAL;

  const textClass = (hex: string) => (yiqTextOn(hex) === '#FFFFFF' ? 'text-white' : 'text-black');

  if (kind === 'rainbow') {
    const idx = ((msgIndex % RAINBOW_COLORS.length) + RAINBOW_COLORS.length) % RAINBOW_COLORS.length;
    const c = RAINBOW_COLORS[idx];
    return {
      override: true,
      className: textClass(c),
      style: { backgroundColor: c },
      tail: { backgroundColor: c },
    };
  }

  if (kind === 'frosted') {
    // 毛玻璃：半透明底 + 高斯模糊 + 细白描边（无自定义色 = 白玻璃，黑白字均可读）
    const base = color ?? '#FFFFFF';
    return {
      override: true,
      className: color ? textClass(color) : 'text-black',
      style: {
        backgroundColor: withAlpha(base, color ? 0.52 : 0.55),
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(255, 255, 255, 0.45)',
        boxShadow: '0 4px 16px rgba(31, 35, 41, 0.10)',
      },
      tail: {
        backgroundColor: withAlpha(base, color ? 0.52 : 0.55),
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      },
    };
  }

  if (kind === 'glass') {
    // 玻璃：斜向渐变透明底 + 模糊提饱和 + 顶部内高光反光条（清爽反光质感）
    const base = color ?? '#FFFFFF';
    const a = color ? [0.72, 0.38, 0.5, 0.66] : [0.62, 0.3, 0.44, 0.55];
    return {
      override: true,
      className: color ? textClass(color) : 'text-black',
      style: {
        background: `linear-gradient(150deg, ${withAlpha(base, a[0])} 0%, ${withAlpha(base, a[1])} 42%, ${withAlpha(base, a[2])} 78%, ${withAlpha(base, a[3])} 100%)`,
        backdropFilter: 'blur(14px) saturate(160%)',
        WebkitBackdropFilter: 'blur(14px) saturate(160%)',
        border: '1px solid rgba(255, 255, 255, 0.6)',
        boxShadow:
          'inset 0 1px 0 rgba(255, 255, 255, 0.75), inset 0 -1px 0 rgba(255, 255, 255, 0.28), 0 6px 18px rgba(31, 35, 41, 0.14)',
      },
      tail: {
        backgroundColor: withAlpha(base, color ? 0.52 : 0.5),
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
      },
    };
  }

  // default + 自定义色：纯色气泡
  return {
    override: true,
    className: textClass(color as string),
    style: { backgroundColor: color },
    tail: { backgroundColor: color },
  };
}

/** 样式中文名（设置页/收藏夹展示用） */
export const BUBBLE_KIND_LABEL: Record<BubbleStyleKind, string> = {
  default: '默认',
  rainbow: '七彩',
  frosted: '毛玻璃',
  glass: '玻璃',
};
