/**
 * 壁纸预设（纯数据 + 纯函数，服务端/客户端共用）：
 * 独立成非 'use client' 模块的原因：layout.tsx（服务端组件）要在 SSR 阶段
 * 用 cookie 里的壁纸 id 解析底色，直接写进 <html> 内联样式 ——
 * 首帧之前浏览器背板就是壁纸色，进网页/刷新不再出现白闪。
 * store.ts 从这里 re-export，既有导入不受影响。
 */

export interface WallpaperPreset {
  id: string;
  name: string;
  css: string;
  /** 浅色壁纸（状态栏文字用黑色） */
  light: boolean;
  /** 底色兜底：PNG 预设图片异步加载/解码前先铺纯色，避免锁屏/主屏透出下层内容闪现 */
  base: string;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: 'dark-stream',
    name: '暗流',
    css: 'url(/wallpapers/dark-stream.png) center / cover no-repeat',
    light: false,
    base: '#0a0a0d',
  },
  {
    id: 'ink-marble',
    name: '墨纹',
    css: 'url(/wallpapers/ink-marble.png) center / cover no-repeat',
    light: false,
    base: '#141417',
  },
  {
    id: 'mist-mountain',
    name: '雾山',
    css: 'url(/wallpapers/mist-mountain.png) center / cover no-repeat',
    light: true,
    base: '#d9dade',
  },
  {
    id: 'graphite',
    name: '石墨黑',
    css: 'radial-gradient(120% 90% at 20% 0%, #2a2a2e 0%, #161618 45%, #050506 100%)',
    light: false,
    base: '#161618',
  },
  {
    id: 'dusk',
    name: '暮色灰',
    css: 'linear-gradient(180deg, #1b1b1f 0%, #33343b 52%, #5c5d66 100%)',
    light: false,
    base: '#1b1b1f',
  },
  {
    id: 'silver',
    name: '银白',
    css: 'linear-gradient(180deg, #fafafc 0%, #e3e3e9 55%, #b7b8c0 100%)',
    light: true,
    base: '#fafafc',
  },
  {
    id: 'mist',
    name: '晨雾',
    css: 'linear-gradient(180deg, #ececf1 0%, #c6c7cf 55%, #90919b 100%)',
    light: true,
    base: '#ececf1',
  },
];

/** 由预设 id + 自定义标记解析壁纸背景样式（自定义壁纸在服务端没有 Blob，只回底色）。
 *  预设 css 可能是 background 简写，需拆解；始终带 backgroundColor 底色：
 *  PNG 壁纸异步加载/解码前先铺不透明纯色，否则锁屏/主屏头几帧透明（闪烁根因） */
export function resolveWallpaperStyle(presetId: string, customUrl: string | null): import('react').CSSProperties {
  if (customUrl) {
    return {
      backgroundColor: '#1c1c1e',
      backgroundImage: `url(${customUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  const preset = WALLPAPER_PRESETS.find((w) => w.id === presetId) ?? WALLPAPER_PRESETS[0];
  if (preset.css.startsWith('url(')) {
    const end = preset.css.indexOf(')');
    const url = end > 4 ? preset.css.slice(4, end) : '';
    return {
      backgroundColor: preset.base,
      backgroundImage: `url(${url})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  return { backgroundColor: preset.base, backgroundImage: preset.css };
}

/** SSR 首帧背板色：锁屏开启用锁屏壁纸底色，否则用主屏幕壁纸底色（layout 内联到 <html>） */
export function bootBackColorOf(wallpaperId: string, lockWallpaperId: string, lockScreen: boolean): string {
  const id = lockScreen ? lockWallpaperId : wallpaperId;
  const preset = WALLPAPER_PRESETS.find((w) => w.id === id);
  return preset?.base ?? WALLPAPER_PRESETS[0].base;
}

// ---------------- pre-paint 启动脚本用的两张「CSS 变量壁纸」 ----------------
// cookie 在跨站 iframe（预览面板）里写不进去，服务端只能渲染默认快照；
// 所以首帧壁纸不能用具体预设值（否则 SSR 与真实设置不一致 → load() 后换图 = 闪烁）。
// 改为渲染 CSS 变量引用：layout 注入的 pre-paint 脚本在首帧绘制前把真实值写进
// <html> 的 --ios-boot-* 变量（读 localStorage 镜像，iframe 里也可用），
// SSR/客户端两边的 style 属性完全相同（都是 var() 引用）→ 零水合差异，首帧即真实壁纸。

/** 主屏幕壁纸层首帧样式（变量未设置时回退 graphite 默认，与 store 初始值一致） */
export const BOOT_WALL_STYLE: import('react').CSSProperties = {
  backgroundColor: 'var(--ios-boot-wall-base, #161618)',
  backgroundImage: 'var(--ios-boot-wall-image, none)',
  backgroundSize: 'var(--ios-boot-wall-size, auto)',
  backgroundPosition: 'var(--ios-boot-wall-pos, center)',
};

/** 锁屏壁纸层首帧样式（同上；锁屏默认也是 graphite） */
export const BOOT_LOCK_WALL_STYLE: import('react').CSSProperties = {
  backgroundColor: 'var(--ios-boot-lock-wall-base, #161618)',
  backgroundImage: 'var(--ios-boot-lock-wall-image, none)',
  backgroundSize: 'var(--ios-boot-lock-wall-size, auto)',
  backgroundPosition: 'var(--ios-boot-lock-wall-pos, center)',
};

/** 内联 pre-paint 脚本的预设表 JSON：{ id: { base, css, img, light } }
 *  （img=PNG 图片地址，供预载与样式还原；light=浅色壁纸标记，供首帧前景色覆盖规则） */
export function bootPresetTableJson(): string {
  const table: Record<string, { base: string; css: string; img: string | null; light: boolean }> = {};
  for (const p of WALLPAPER_PRESETS) {
    const m = p.css.startsWith('url(') ? p.css.slice(4, p.css.indexOf(')')) : null;
    table[p.id] = { base: p.base, css: p.css, img: m && m.length > 0 ? m : null, light: p.light };
  }
  return JSON.stringify(table);
}
