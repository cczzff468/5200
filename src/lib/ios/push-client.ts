'use client';

/**
 * Web Push 订阅客户端（退出网页后也收「每条消息一条系统通知」）：
 * - 前提：浏览器通知权限已 granted + 支持 Service Worker / PushManager；
 * - 注册 /sw.js → 取服务端 VAPID 公钥 → 订阅推送 → 上报订阅到 /api/push；
 * - 全程尽力而为：预览面板 iframe / iOS 非主屏 PWA / 不支持的浏览器都会静默失败，
 *   应用内灵动岛弹窗与页面隐藏时的 Web Notification 通道不受影响。
 * 由 island-notify 在通知权限变为 granted 时调用（模块内只跑一次）。
 */

let tried = false;

export async function setupPushSubscription(): Promise<void> {
  if (tried) return;
  tried = true;
  try {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    // 同源安全上下文才可用（https 或 localhost）；iframe 里注册失败会走 catch 静默降级
    const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
    if (!reg) return;
    const res = await fetch('/api/push').catch(() => null);
    if (!res || !res.ok) return;
    const data = (await res.json()) as { publicKey?: string };
    if (!data.publicKey) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey) as BufferSource,
      });
    }
    await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  } catch {
    // 订阅失败静默（推送为增强能力，不影响应用内通知）
  }
}

/** VAPID 公钥（base64url）→ applicationServerKey 所需的 Uint8Array */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
