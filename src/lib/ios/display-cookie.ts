/**
 * 显示设置的 Cookie 镜像（首帧防闪烁）：
 * 过去 PhoneShell 在 IndexedDB 设置读出前渲染纯黑开机屏 —— 刷新/进入网页时
 * 「旧锁屏 → 一段纯黑 → 新锁屏」，看起来就是锁屏闪烁。
 * 现在把主题/壁纸/锁屏开关这几项「决定首帧长什么样」的设置同步写进 cookie
 * （每次变更时由 store setter 写入，随请求带上服务端），
 * 服务端 SSR 直接按真实设置渲染锁屏/主屏 —— 首帧即最终样子，黑屏门控彻底移除。
 *
 * 约束：cookie 只放小的枚举值（主题/预设 id/布尔），不放 Blob/自定义壁纸图；
 * 自定义壁纸首帧按预设底色兜底显示，图片解码后由既有逻辑换上（一次性换图，非黑闪）。
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
}

export const DISPLAY_COOKIE_NAME = 'ios-display';

/** 默认值与 store 初始状态保持一致（首次访问无 cookie 时 SSR 用它渲染） */
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
  return { theme, wallpaper, lockWallpaper, lockScreen: o.lockScreen };
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
    /* cookie 不可用时静默：首帧回退默认样式 */
  }
}
