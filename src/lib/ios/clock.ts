'use client';

import { useSyncExternalStore } from 'react';

/** 每秒广播的时钟源（useSyncExternalStore，SSR 安全；与秒边界对齐，翻分立即刷新不滞后） */
function subscribeClock(onChange: () => void): () => void {
  let timer: number | undefined;
  // 先对齐到下一个整秒再开始每秒触发，避免轮询相位滞后最多 1 秒
  const timeout = window.setTimeout(() => {
    onChange();
    timer = window.setInterval(onChange, 1000);
  }, 1000 - (Date.now() % 1000));
  return () => {
    window.clearTimeout(timeout);
    if (timer !== undefined) window.clearInterval(timer);
  };
}

function getClockSecond(): number {
  return Math.floor(Date.now() / 1000);
}

function getServerClockSecond(): number {
  return 0;
}

/** 当前时间（每秒刷新）；SSR 阶段返回 null */
export function useNow(): Date | null {
  const second = useSyncExternalStore(subscribeClock, getClockSecond, getServerClockSecond);
  return second > 0 ? new Date(second * 1000) : null;
}

/**
 * HH:mm 24 小时制（状态栏/锁屏共用）。
 * 约定：传入的 date 是「墙钟 Date」——其本机 getter 读出的就是用户时区的墙钟时间
 * （客户端 useNow 的原始 instant 本机 getter = 用户本机时间；服务端传 ssrWallClock 的偏移后 Date）。
 * 用本机 getter 而非 Intl timeZone：避免「服务端已按 tz 偏移过、Intl 再按时区换算」的双重应用。
 */
export function formatIOSTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const WEEK_SHORTS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/** 周短格式（周X），从墙钟 Date 的本机 getDay() 推导（时区语义与 formatIOSTime 一致） */
export function formatWeekShort(date: Date): string {
  return WEEK_SHORTS[date.getDay()] ?? '';
}

/** 计算某时区相对本机的偏移（ms）：返回值加到 instant 上后，用本机 getter 读即得目标时区墙钟 */
function tzOffsetMs(d: Date, tz: string): number {
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const p: Record<string, string> = {};
    for (const x of f.formatToParts(d)) p[x.type] = x.value;
    const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
    return asUTC - (d.getTime() - (d.getTime() % 1000));
  } catch {
    return 0;
  }
}

/**
 * SSR 首帧时钟兜底：服务端没有 useNow（useSyncExternalStore 的 server snapshot 固定 null），
 * 过去锁屏/状态栏的时钟在 SSR HTML 里是空的，要等 JS 加载完才「凭空出现」——观感是锁屏缺内容。
 * 现在服务端渲染时用它取「用户时区」的当前时刻（tz 来自 cookie 注水）：
 * 大时钟/日期/星期/日期小组件首帧即有内容；客户端注水后由 useNow 接管（同一时区下数值一致，无跳变）。
 * 客户端渲染时恒返回 null（走 useNow 真实时钟）。
 */
export function ssrWallClock(tz?: string): Date | null {
  if (typeof window !== 'undefined') return null;
  const d = new Date();
  if (!tz) return d;
  const off = tzOffsetMs(d, tz);
  return off === 0 ? d : new Date(d.getTime() + off);
}
