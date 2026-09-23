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
