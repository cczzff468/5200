/**
 * 送达速度统一设置（第四十一轮：淘宝 + 美团共用一份「送达速度」）。
 *
 * - 快：5-15 分钟；正常：15-30 分钟；慢：30-60 分钟；自定义：用户输入区间（1-480 分钟）；
 * - 存储用 kvGetRaw/kvSetRaw（无账号作用域、真全局键 delivery-speed:global）——
 *   任一端（美团「我的 › 送达速度」或淘宝「我的淘宝 › 送达速度」）修改后两端同时生效；
 * - dsMinutesFor(seed)：在当前速度区间内按种子哈希确定性抖动（同一订单/商家号
 *   在同一设置下时间可复现，重启不跳变）；
 * - 修改后广播 window 事件 delivery-speed-changed，UI（我的页速度行等）即时刷新。
 */

import { kvGetRaw, kvSetRaw } from './idb-kv';

export type DsPreset = 'fast' | 'normal' | 'slow' | 'custom';

/** 三档固定区间（用户指定）：快 5-15 分钟 / 正常 15-30 分钟 / 慢 30-60 分钟 */
export const DS_RANGE: Record<Exclude<DsPreset, 'custom'>, { min: number; max: number }> = {
  fast: { min: 5, max: 15 },
  normal: { min: 15, max: 30 },
  slow: { min: 30, max: 60 },
};

export const DS_LABEL: Record<DsPreset, string> = {
  fast: '快',
  normal: '正常',
  slow: '慢',
  custom: '自定义',
};

/** 自定义允许的分钟边界（模拟器现实值：1 分钟 ~ 8 小时） */
export const DS_CUSTOM_MIN = 1;
export const DS_CUSTOM_MAX = 480;

export interface DsSetting {
  preset: DsPreset;
  /** 生效区间（含端点）；preset 非 custom 时与 DS_RANGE 一致 */
  min: number;
  max: number;
}

const DS_KEY = 'delivery-speed:global';

const clampInt = (n: unknown, def: number, lo: number, hi: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : NaN;
  if (Number.isNaN(v)) return def;
  return Math.min(hi, Math.max(lo, v));
};

/** 规整任意输入为合法设置（脏值一律回退「正常」） */
function normalize(v: unknown): DsSetting {
  if (typeof v === 'string') {
    // 兼容旧淘宝纯档位值（'fast' | 'normal' | 'slow'）
    if (v === 'fast' || v === 'normal' || v === 'slow') {
      const r = DS_RANGE[v];
      return { preset: v, min: r.min, max: r.max };
    }
    return { preset: 'normal', min: DS_RANGE.normal.min, max: DS_RANGE.normal.max };
  }
  if (v && typeof v === 'object') {
    const o = v as Partial<DsSetting>;
    const preset: DsPreset = o.preset === 'fast' || o.preset === 'slow' || o.preset === 'custom' ? o.preset : 'normal';
    if (preset === 'custom') {
      let min = clampInt(o.min, DS_RANGE.normal.min, DS_CUSTOM_MIN, DS_CUSTOM_MAX);
      let max = clampInt(o.max, DS_RANGE.normal.max, DS_CUSTOM_MIN, DS_CUSTOM_MAX);
      if (min > max) [min, max] = [max, min];
      return { preset, min, max };
    }
    const r = DS_RANGE[preset];
    return { preset, min: r.min, max: r.max };
  }
  return { preset: 'normal', min: DS_RANGE.normal.min, max: DS_RANGE.normal.max };
}

/** 读当前送达速度（未设置/脏值 → 正常 15-30 分钟） */
export function dsGet(): DsSetting {
  try {
    return normalize(kvGetRaw(DS_KEY));
  } catch {
    return { preset: 'normal', min: DS_RANGE.normal.min, max: DS_RANGE.normal.max };
  }
}

/** 写送达速度并广播（两端 UI 监听 delivery-speed-changed 即时刷新） */
export function dsSet(s: DsSetting): void {
  const next = normalize(s);
  try {
    kvSetRaw(DS_KEY, next);
  } catch {
    /* 存储失败静默（本次会话仍生效于内存态由调用方刷新） */
  }
  try {
    window.dispatchEvent(new CustomEvent('delivery-speed-changed'));
  } catch {
    /* 非浏览器环境忽略 */
  }
}

/** 当前速度的文案（如「5-15分钟送达」「20-40分钟送达」） */
export function dsDesc(s?: DsSetting): string {
  const cur = s ?? dsGet();
  return `${cur.min}-${cur.max}分钟送达`;
}

/** 当前速度的短文案（如「5-15分钟」） */
export function dsDescShort(s?: DsSetting): string {
  const cur = s ?? dsGet();
  return `${cur.min}-${cur.max}分钟`;
}

/** 种子哈希（同一订单/商家号在同一设置下确定性抖动，复用淘宝同族 31 进制滚动） */
function dsHashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/**
 * 在当前速度区间内按种子确定性取分钟数（[min, max] 闭区间）。
 * 美团订单 ETA / 淘宝物流时间轴共用：seed 用订单号（或商家号预演）。
 */
export function dsMinutesFor(seed: string, s?: DsSetting): number {
  const cur = s ?? dsGet();
  const span = Math.max(0, cur.max - cur.min);
  return cur.min + (dsHashStr(seed) % (span + 1));
}
