'use client';

/**
 * 美团骑手形象（「我的-骑手」可选；配送地图巡航 + 灵动岛小窗共用）：
 * public/mt/riders 已去白边透明 PNG，选中 id 持久化在 localStorage。
 * 独立成模块供 meituan.tsx（App 内）与 MeituanIsland.tsx（全局灵动岛）双端引用，
 * 避免灵动岛反向依赖整个 App 组件。
 *
 * 自定义骑手：用户在骑手选择弹层从手机相册上传图片，前端 canvas 自动去白边
 * （边缘泛洪清背景 + 最大连通域 + alpha 羽化 + 内容裁剪），存为 dataURL 持久化；
 * 展示/地图渲染时叠加立体投影（与内置形象同套 drop-shadow）。
 */

export interface MtRider {
  id: string;
  name: string;
  src: string;
  /** 用户自行上传的形象 */
  custom?: boolean;
}

/** 内置可选骑手形象（默认圆圆；r18-r22 为本轮新增） */
export const MT_RIDERS: MtRider[] = [
  { id: 'r4', name: '圆圆', src: '/mt/riders/r4.png' },
  { id: 'r7', name: '蹦蹦', src: '/mt/riders/r7.png' },
  { id: 'r1', name: '呜呜', src: '/mt/riders/r1.png' },
  { id: 'r2', name: '惬惬', src: '/mt/riders/r2.png' },
  { id: 'r3', name: '蓝蓝', src: '/mt/riders/r3.png' },
  { id: 'r5', name: '帽帽', src: '/mt/riders/r5.png' },
  { id: 'r6', name: '萝卜', src: '/mt/riders/r6.png' },
  { id: 'r8', name: '瘫瘫', src: '/mt/riders/r8.png' },
  { id: 'r9', name: '屁屁', src: '/mt/riders/r9.png' },
  { id: 'r10', name: '钱钱', src: '/mt/riders/r10.png' },
  { id: 'r11', name: '懒懒', src: '/mt/riders/r11.png' },
  { id: 'r12', name: '笑笑', src: '/mt/riders/r12.png' },
  { id: 'r13', name: '馋馋', src: '/mt/riders/r13.png' },
  { id: 'r14', name: '嗨嗨', src: '/mt/riders/r14.png' },
  { id: 'r15', name: '一二', src: '/mt/riders/r15.png' },
  { id: 'r16', name: '布布', src: '/mt/riders/r16.png' },
  { id: 'r17', name: '兔兔', src: '/mt/riders/r17.png' },
  { id: 'r18', name: '笨笨', src: '/mt/riders/r18.png' },
  { id: 'r19', name: '咻咻', src: '/mt/riders/r19.png' },
  { id: 'r20', name: '哭哭', src: '/mt/riders/r20.png' },
  { id: 'r21', name: '咪咪', src: '/mt/riders/r21.png' },
  { id: 'r22', name: '咩咩', src: '/mt/riders/r22.png' },
];

const MT_RIDER_KEY = 'mt-rider-avatar';
const MT_CUSTOM_KEY = 'mt-riders-custom';

/** 用户上传的自定义骑手（dataURL 形象，localStorage 持久化） */
export function mtGetCustomRiders(): MtRider[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MT_CUSTOM_KEY) ?? '[]') as MtRider[];
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.id === 'string' && typeof r.src === 'string') : [];
  } catch {
    return [];
  }
}

/** 追加一张用户上传形象（前端已去白边），返回新骑手对象 */
export function mtAddCustomRider(src: string): MtRider {
  const rider: MtRider = { id: `u${Date.now().toString(36)}`, name: '我的骑手', src, custom: true };
  const list = mtGetCustomRiders();
  list.push(rider);
  try {
    localStorage.setItem(MT_CUSTOM_KEY, JSON.stringify(list));
  } catch {
    /* 存储满时静默：形象仍在本会话可用 */
  }
  return rider;
}

/** 内置 + 自定义合并列表（选择弹层与 src 解析共用） */
export function mtAllRiders(): MtRider[] {
  return [...MT_RIDERS, ...mtGetCustomRiders()];
}

export function mtGetRiderId(): string {
  try {
    return localStorage.getItem(MT_RIDER_KEY) ?? MT_RIDERS[0].id;
  } catch {
    return MT_RIDERS[0].id;
  }
}

export function mtSetRiderId(id: string): void {
  try {
    localStorage.setItem(MT_RIDER_KEY, id);
  } catch {
    /* 隐私模式忽略 */
  }
}

export function mtRiderSrcOf(id: string): string {
  return (mtAllRiders().find((r) => r.id === id) ?? MT_RIDERS[0]).src;
}

/** 当前选中骑手形象（快捷取整个对象） */
export function mtCurrentRider(): MtRider {
  return mtAllRiders().find((r) => r.id === mtGetRiderId()) ?? MT_RIDERS[0];
}

/**
 * 客户端去白边（用户上传形象用）：与 scripts/add-riders.mjs 同算法的 canvas 版。
 * 边缘泛洪清浅色背景（保留角色内部白色）→ 只留最大连通域 → alpha 羽化 → 内容裁剪，
 * 输出 256×256 透明 PNG dataURL。处理失败（纯色/识别不出主体）返回 null。
 */
export async function mtRemoveWhiteEdges(file: File): Promise<string | null> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      URL.revokeObjectURL(url);
      resolve(el);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    el.src = url;
  });
  if (!img) return null;

  const W = 360;
  const side = Math.max(img.naturalWidth, img.naturalHeight) || 1;
  const dw = Math.max(1, Math.round((img.naturalWidth / side) * W));
  const dh = Math.max(1, Math.round((img.naturalHeight / side) * W));
  const cv = document.createElement('canvas');
  cv.width = dw;
  cv.height = dh;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, dw, dh);
  const image = ctx.getImageData(0, 0, dw, dh);
  const px = image.data;
  const w = dw;
  const h = dh;
  const idx = (x: number, y: number) => (y * w + x) * 4;
  const isLight = (r: number, g: number, b: number) => Math.min(r, g, b) >= 186 && Math.max(r, g, b) - Math.min(r, g, b) <= 64;

  // 1) 边缘泛洪清背景
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (bg[p]) continue;
    const i = p * 4;
    if (px[i + 3] === 0 || isLight(px[i], px[i + 1], px[i + 2])) {
      bg[p] = 1;
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w);
      if (y < h - 1) stack.push(p + w);
    }
  }
  // 2) 只保留最大连通域（用户照片主体明确，比批处理脚本更保守，防杂物残留）
  const comp = new Int32Array(w * h).fill(-1);
  let mainId = -1;
  let mainSize = 0;
  const sizes: number[] = [];
  for (let p0 = 0; p0 < w * h; p0++) {
    if (bg[p0] || comp[p0] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    comp[p0] = id;
    const q = [p0];
    while (q.length) {
      const p = q.pop()!;
      size++;
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0 && !bg[p - 1] && comp[p - 1] < 0) { comp[p - 1] = id; q.push(p - 1); }
      if (x < w - 1 && !bg[p + 1] && comp[p + 1] < 0) { comp[p + 1] = id; q.push(p + 1); }
      if (y > 0 && !bg[p - w] && comp[p - w] < 0) { comp[p - w] = id; q.push(p - w); }
      if (y < h - 1 && !bg[p + w] && comp[p + w] < 0) { comp[p + w] = id; q.push(p + w); }
    }
    sizes.push(size);
    if (size > mainSize) {
      mainSize = size;
      mainId = id;
    }
  }
  if (mainId < 0 || mainSize < w * h * 0.02) return null;
  for (let p = 0; p < w * h; p++) {
    if (bg[p] || comp[p] !== mainId) px[p * 4 + 3] = 0;
  }
  // 3) alpha 3x3 羽化去白边
  const alphaCopy = new Uint8ClampedArray(w * h);
  for (let p = 0; p < w * h; p++) alphaCopy[p] = px[p * 4 + 3];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (alphaCopy[p] === 0) continue;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) sum += alphaCopy[(y + dy) * w + (x + dx)];
      const avg = sum / 9;
      if (avg < 250) px[p * 4 + 3] = Math.min(alphaCopy[p], Math.round(avg));
    }
  }
  // 4) 内容包围盒裁剪 → 256×256
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (px[idx(x, y) + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (minX > maxX || minY > maxY) return null;
  const pad = 4;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = 256;
  out.height = 256;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.drawImage(cv, minX, minY, maxX - minX + 1, maxY - minY + 1, 0, 0, 256, 256);
  return out.toDataURL('image/png');
}
