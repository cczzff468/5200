/**
 * 显示设置的「首帧镜像」（防锁屏闪烁）：
 * 过去 PhoneShell 在 IndexedDB 设置读出前渲染纯黑开机屏 —— 刷新/进入网页时
 * 「旧锁屏 → 一段纯黑 → 新锁屏」；后来改成 cookie 注水 SSR 直出，但 cookie 有一个
 * 致命盲区：预览面板是跨站 iframe，第三方上下文里 samesite=lax 的 cookie 根本写不进去
 * → 服务端每次都拿默认快照渲染 → load() 后才换成真实设置 = 闪烁 + 壁纸延迟。
 *
 * 现在双通道镜像：
 * - cookie（原有）：顶层导航可写，服务端 SSR 直读（layout/page）；
 * - localStorage（新增）：跨站 iframe 里也可写（分区存储但持久），随 setters 同步写；
 *   layout 注入的 pre-paint 内联脚本读它，在首帧绘制前用 CSS 变量直出真实壁纸/背板。
 *
 * 另外缓存自定义壁纸的压缩 dataURL（ios-display-wall）：Blob 只存在 IndexedDB，
 * 要等 load() 才有 —— 有了 dataURL 缓存，自定义壁纸也能首帧直出。
 *
 * 约束：cookie 只放小枚举值；localStorage 额外放壁纸图 dataURL（压缩到 ~几百 KB）。
 */

export interface DisplaySnapshot {
  /** 主题模式：light / dark / auto */
  theme: 'light' | 'dark' | 'auto';
  /** 主屏幕壁纸预设 id */
  wallpaper: string;
  /** 锁屏壁纸预设 id */
  lockWallpaper: string;
  /** 锁屏总开关（false=开机直接进主屏幕，不出锁屏） */
  lockScreen: boolean;
  /** 用户时区（IANA 名，如 Asia/Shanghai；SSR 用它渲染时钟/日期，与服务端本机时区无关） */
  tz?: string;
}

export const DISPLAY_COOKIE_NAME = 'ios-display';
export const DISPLAY_LS_KEY = 'ios-display';
export const DISPLAY_WALL_LS_KEY = 'ios-display-wall';

/** pre-paint 脚本写入的全局（PhoneShell 客户端首渲染优先读它，cookie prop 兜底） */
declare global {
  interface Window {
    __IOS_DISPLAY__?: DisplaySnapshot | null;
    __IOS_DISPLAY_WALL__?: WallCache | null;
  }
}

/** 默认值与 store 初始状态保持一致（首次访问无任何镜像时 SSR 用它渲染） */
export const DEFAULT_DISPLAY_SNAPSHOT: DisplaySnapshot = {
  theme: 'light',
  wallpaper: 'graphite',
  lockWallpaper: 'graphite',
  lockScreen: true,
};

function asSnapshot(v: unknown): DisplaySnapshot | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const theme = o.theme;
  const wallpaper = o.wallpaper;
  const lockWallpaper = o.lockWallpaper;
  if (theme !== 'light' && theme !== 'dark' && theme !== 'auto') return null;
  if (typeof wallpaper !== 'string' || wallpaper.length === 0 || wallpaper.length > 64) return null;
  if (typeof lockWallpaper !== 'string' || lockWallpaper.length === 0 || lockWallpaper.length > 64) return null;
  if (typeof o.lockScreen !== 'boolean') return null;
  const tz = typeof o.tz === 'string' && o.tz.length > 0 && o.tz.length <= 64 ? o.tz : undefined;
  return { theme, wallpaper, lockWallpaper, lockScreen: o.lockScreen, tz };
}

/** 解析 cookie 头里的显示快照（无效/缺失 → null，调用方回退默认值） */
export function parseDisplayCookie(raw: string | undefined | null): DisplaySnapshot | null {
  if (!raw) return null;
  // cookie 值里的 JSON 用 encodeURIComponent 转义过，这里先反转义再解析
  let json = raw;
  if (json.startsWith('%7B') || json.includes('%22')) {
    try {
      json = decodeURIComponent(json);
    } catch {
      return null;
    }
  }
  try {
    return asSnapshot(JSON.parse(json));
  } catch {
    return null;
  }
}

/** 序列化为 cookie 值（encodeURIComponent 防 JSON 里的分隔符破坏 cookie 结构） */
export function serializeDisplayCookie(snap: DisplaySnapshot): string {
  return encodeURIComponent(JSON.stringify(snap));
}

/** 客户端写 cookie（仅在 store setter 内调用，1 年有效，随每次请求带给服务端 SSR） */
export function writeDisplayCookie(snap: DisplaySnapshot): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = `${DISPLAY_COOKIE_NAME}=${serializeDisplayCookie(snap)}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* cookie 不可用（如跨站 iframe）时静默：pre-paint 脚本会走 localStorage 通道 */
  }
}

// ---------------- localStorage 镜像（iframe 里唯一可靠的首帧通道） ----------------

/** 客户端写 localStorage 镜像（与 writeDisplayCookie 成对调用；同步 API，写完即生效） */
export function writeDisplayLS(snap: DisplaySnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISPLAY_LS_KEY, JSON.stringify(snap));
  } catch {
    /* 存储满/被禁时静默：回退 cookie/默认首帧 */
  }
}

/** 客户端读 localStorage 镜像（无效/缺失 → null） */
export function readDisplayLS(): DisplaySnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    return asSnapshot(JSON.parse(window.localStorage.getItem(DISPLAY_LS_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

/** 客户端读启动快照：pre-paint 脚本写在 window 上的全局优先（head 时机比 React 早），缺失回退 cookie prop */
export function bootSnapshotFromWindow(): DisplaySnapshot | null {
  if (typeof window === 'undefined') return null;
  return window.__IOS_DISPLAY__ ?? null;
}

// ---------------- 自定义壁纸首帧缓存（压缩 dataURL；Blob 要等 IndexedDB load，太慢） ----------------

export interface WallCacheEntry {
  /** 压缩后的 dataURL（image/jpeg） */
  d: string;
  /** 源 Blob 大小（自愈比对：尺寸不符 = 缓存过期，重新生成） */
  s: number;
}

export interface WallCache {
  v: 1;
  home?: WallCacheEntry | null;
  lock?: WallCacheEntry | null;
}

/** 客户端读自定义壁纸缓存（pre-paint 脚本用同 key 同格式直接读 localStorage） */
export function readWallCache(): WallCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = JSON.parse(window.localStorage.getItem(DISPLAY_WALL_LS_KEY) ?? 'null') as WallCache | null;
    return v && v.v === 1 ? v : null;
  } catch {
    return null;
  }
}

/** 写/清某一面的自定义壁纸缓存（kind: home=主屏壁纸 lock=锁屏壁纸） */
export function writeWallCache(kind: 'home' | 'lock', entry: WallCacheEntry | null): void {
  if (typeof window === 'undefined') return;
  try {
    const cur = readWallCache() ?? { v: 1 as const };
    const next: WallCache = { v: 1, home: cur.home ?? null, lock: cur.lock ?? null };
    next[kind] = entry;
    window.localStorage.setItem(DISPLAY_WALL_LS_KEY, JSON.stringify(next));
  } catch {
    /* 配额满等失败静默：自定义壁纸退回「load 后换图」的旧行为 */
  }
}

/**
 * Blob → 压缩 dataURL（最长边约 1080px、JPEG 0.82）：控制在几百 KB 内，
 * pre-paint 脚本首帧直接用它当背景图，自定义壁纸不再等 IndexedDB load。
 * 失败（解码失败/Canvas 不可用）返回 null，调用方跳过缓存。
 */
export async function compressBlobToDataUrl(blob: Blob, maxSide = 1080, quality = 0.82): Promise<string | null> {
  try {
    if (typeof document === 'undefined') return null;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}

/**
 * 首帧缓存自愈（load() 后台调用）：IndexedDB 里的自定义壁纸与 localStorage 缓存比对，
 * 尺寸不符/缺失 → 重新生成；壁纸已移除 → 清缓存。全部静默，绝不阻塞开机。
 */
export async function healWallCache(kind: 'home' | 'lock', blob: Blob | null): Promise<void> {
  if (typeof window === 'undefined') return;
  const cur = readWallCache();
  const entry = cur ? cur[kind] ?? null : null;
  if (!blob) {
    if (entry) writeWallCache(kind, null);
    return;
  }
  if (entry && entry.s === blob.size) return;
  const d = await compressBlobToDataUrl(blob);
  if (d) writeWallCache(kind, { d, s: blob.size });
}
