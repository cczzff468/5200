/**
 * 聊天气泡装扮系统（第十七轮建立 · 第十八轮重构）——核心库
 * ---------------------------------------------------------------------------
 * 四种内置样式（样式对两侧同时生效，不再区分 TA/我）：
 *  - default  纯色气泡（无自定义色 = 跟随 App 原生配色；微信我方绿 / QQ 我方蓝）
 *             自定义色后：仅换底色/文字色，圆角不覆盖——与各 App 原生气泡完全一致
 *             （用户指定：微信改色后圆角不能变圆，须和默认一样）
 *  - rainbow  七彩气泡：每条消息按序号在参考图 9 色间循环取色
 *             （亮黄→青柠→杏色→青色→粉色→薰衣草→灰褐→琥珀→珊瑚）；
 *             QQ 装扮后圆一点点（14px），微信保持原生
 *  - frosted  毛玻璃（第十九轮重做）：真实磨砂——.bub-frosted 奶白半透底（0.62 白）
 *             + 磨砂颗粒纹理（feTurbulence 噪点）+ 柔和悬浮投影；无描边无光泽高光；
 *             与语音胶囊同高 34px
 *  - liquid   液态玻璃（第十九轮终版）：清透玻璃——背景几乎完全透出只留极淡白膜
 *             （无 brightness、无描边——均用户指定删除）；与语音胶囊同高 34px；无高光无闪光
 *
 * 微信 / QQ 两 App 装扮完全隔离（wx / qq 各持 { kind, mineColor, theirsColor }），
 * 在微信里选的样式不影响 QQ，反之亦然。
 * 自定义颜色区分「我的 / TA的」两侧独立配色；样式(kind)不分侧。
 *
 * 持久化：zustand useSettings → IndexedDB settings.bubbleStyle / settings.bubbleSchemes。
 * 渲染：bubbleVisual() 输出 override/className/style/tail，聊天页按返回值
 * 覆盖原生背景与文字色（内联样式 + .bub-liquid/.bub-frosted 两个全局类，无其他 CSS 污染）。
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
 * 弯钩小尾巴 SVG path（viewBox 0 0 11 14）——参考图同款「水滴弯钩」第十八轮终版：
 * 末尾细如线（用户指定）——外缘掠过顶部弯峰后向下前铺，以近乎水平的切向
 * 逼近尖点 (0.33, 2.02)；内缘以同样近乎水平的切向离开尖点——两侧在尖端
 * 汇成约 25° 的针尖，且末端 1.5 单位保持 ≈1 单位厚（渲染约 1px 细线）。
 * 根部宽阔（右缘 3.7→12.6 藏在气泡身下，宿主定位横向重叠 2px 无缝）。
 */
export const BUBBLE_TAIL_PATH =
  'M11 3.7 C8.2 1.85 5.2 0.6 3 0.78 C1.55 0.92 0.7 1.18 0.55 1.55 C0.45 1.8 0.4 1.9 0.33 2.02 C0.62 2.18 1.05 2.4 1.6 2.72 C3.2 3.85 6.6 7.6 11 12.6 Z';

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
    // 圆角：QQ 原生 10px 略方正——装扮后圆一点点（14px，用户指定）；微信保持原生 5px
    const idx = ((msgIndex % RAINBOW_COLORS.length) + RAINBOW_COLORS.length) % RAINBOW_COLORS.length;
    const c = RAINBOW_COLORS[idx];
    return {
      override: true,
      className: '',
      style: {
        backgroundColor: c,
        color: yiqTextOn(c),
        ...(app === 'qq' ? { borderRadius: '14px' } : {}),
      },
      tail: app === 'wx' ? 'native' : 'hook',
      tailColor: c,
    };
  }

  if (kind === 'frosted') {
    // 毛玻璃（第十九轮重做）：真实磨砂玻璃——.bub-frosted 全局类提供三要素
    // （奶白半透底 0.62 + feTurbulence 磨砂颗粒纹理 + 柔和悬浮投影），
    // 素色聊天背景下也有可见的「磨砂玻璃板」质地；无描边无光泽高光；
    // 高度对齐语音胶囊 34px（24px 行盒 + 上下 padding 5px）；
    // 自定义色 = 彩色磨砂玻璃（内联 backgroundColor 0.55 覆盖类底色，颗粒纹理保留）
    const base = color;
    return {
      override: true,
      className: 'bub-frosted',
      style: {
        borderRadius: '999px',
        ...(base
          ? {
              backgroundColor: withAlpha(base, 0.55),
              color: yiqTextOn(base),
            }
          : {}),
        paddingTop: '5px',
        paddingBottom: '5px',
        lineHeight: 1.5,
      },
      tail: 'none',
      tailColor: '',
    };
  }

  if (kind === 'liquid') {
    // 液态玻璃（第十九轮终版）：清透玻璃胶囊——背景几乎完全直接透出，只留一层
    // 极淡白膜（无 brightness 提亮、无描边——用户指定删除，只剩 blur+饱和）;
    // 高度对齐语音胶囊 34px（24px 行盒 + 5px×2 padding，无描边不计）；
    // 自定义色 = 该色极淡渐变（α 0.10↔0.03）
    const base = color;
    return {
      override: true,
      className: 'bub-liquid',
      style: {
        borderRadius: '999px',
        ...(base
          ? {
              background: `linear-gradient(165deg, ${withAlpha(base, 0.10)} 0%, ${withAlpha(base, 0.03)} 45%, ${withAlpha(base, 0.06)} 75%, ${withAlpha(base, 0.09)} 100%)`,
            }
          : {}),
        paddingTop: '5px',
        paddingBottom: '5px',
        lineHeight: 1.5,
      },
      tail: 'none',
      tailColor: '',
    };
  }

  // default + 自定义色：仅换底色/文字色；圆角——微信保持原生 5px（用户指定不变），
  // QQ 原生 10px 略方正——装扮后圆一点点（14px，用户指定）。
  // 尾巴按 App —— 微信保持原生小三角（随色，用户指定不变），QQ 用弯钩尾巴
  return {
    override: true,
    className: '',
    style: {
      backgroundColor: color,
      color: yiqTextOn(color as string),
      ...(app === 'qq' ? { borderRadius: '14px' } : {}),
    },
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
