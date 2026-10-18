'use client';

/**
 * 情侣小家 —— 镜头 / 视口共享状态（DOM 直改，不触发 React 渲染）
 *
 * ⚠️ 关键坑：手机壳为适配窗口高度会整体 scale（桌面端 ~0.57）。
 * 游戏内部坐标系（世界 px = 游戏 root 的 CSS px）≠ 屏幕物理像素。
 * 所有换算必须带上 scale：
 *   world = (screen - viewOrigin) / (scale * zoom) + cam
 *
 * - cam：世界坐标系下「视口左上角」的位置
 * - view：游戏 root 的屏幕包围盒 + CSS 尺寸（rootW/rootH）+ 缩放（scale = view.w / rootW）
 * - zoom：编辑模式上帝视角缩放（世界层 transform scale，围绕视口中心）
 *
 * 游戏循环每帧写 cam/zoom 并直接改 DOM；交互事件读取换算，全程零 re-render。
 */

export const cam = { x: 0, y: 0 };

export const view = {
  x: 0, // root 屏幕包围盒 left
  y: 0, // root 屏幕包围盒 top
  w: 390, // root 屏幕宽（物理 px）
  h: 700, // root 屏幕高（物理 px）
  cw: 390, // root CSS 宽（世界单位）
  ch: 700, // root CSS 高（世界单位）
  scale: 1, // 手机壳缩放 = w / cw
};

/** 同步测量（resize / 全屏切换 / 挂载时调用） */
export function measureView(root: HTMLElement | null): void {
  const r = root?.getBoundingClientRect();
  if (!r || r.width < 10) return;
  view.x = r.left;
  view.y = r.top;
  view.w = r.width;
  view.h = r.height;
  const cw = root.clientWidth || 390;
  const ch = root.clientHeight || 700;
  view.cw = cw;
  view.ch = ch;
  view.scale = r.width / cw;
}

export let zoom = 1;
export function setZoom(z: number): void {
  zoom = z;
}

/** 视口宽（世界单位；含 zoom 换算） */
export function viewW(): number {
  return view.cw / zoom;
}

/** 视口高（世界单位） */
export function viewH(): number {
  return view.ch / zoom;
}

/** 视口中心（世界坐标） */
export function viewCenterWorld(): { x: number; y: number } {
  return {
    x: cam.x + viewW() / 2,
    y: cam.y + viewH() / 2,
  };
}

/** 浏览器 client 坐标 → 世界坐标（含手机壳 scale + zoom 双重换算） */
export function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const k = view.scale * zoom;
  return {
    x: (clientX - view.x) / k + cam.x,
    y: (clientY - view.y) / k + cam.y,
  };
}

/** 世界坐标 → 浏览器 client 坐标 */
export function worldToClient(wx: number, wy: number): { x: number; y: number } {
  const k = view.scale * zoom;
  return {
    x: (wx - cam.x) * k + view.x,
    y: (wy - cam.y) * k + view.y,
  };
}
