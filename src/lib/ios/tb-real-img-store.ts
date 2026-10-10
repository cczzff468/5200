'use client';

/**
 * 淘宝真实商品图客户端缓存（Task 50，多人用缓存方案）：
 *
 * - 缓存：每次刷新拿到的图（直链 + 作者/许可/来源）按品类 tag 存 IndexedDB kv（内存同步读 +
 *   写穿持久化），全局一份不按账号隔离——图片是分类资源而非用户资源，多人共享缓存 = 图库请求最少；
 * - 打开淘宝以后不自动更新：TbImg 挂载只读缓存渲染；仅当该品类从未拉取过（缓存为空）才按需
 *   请求一次（首帧就有旧图链 /api/mt-img 兜底，不打断页面），拉取失败落 10 分钟负缓存不反复打；
 * - 每次刷新换图（同分类）：各界面刷新 handler 拿到新内容后调 tbRefreshRealImages(新条目 tags)，
 *   逐 tag 请求 /api/tb-img?r=1，新图前插缓存并推进轮换基点 base → 同分类全部换新图；
 * - API 请求失败用缓存兜底：请求失败/超时/ok:false 一律不清缓存不换源，旧图继续显示；
 *   服务端还有一层 last-good 池兜底（网络全挂时服务端返回池内轮换图）。
 *
 * 不转存图片：缓存的是图库直链（URL + 版权元数据），浏览器直接热链；referral 用 no-referrer。
 */

import { kvGet, kvSet, isKvReady } from '@/lib/ios/idb-kv';

export interface TbRealImgItem {
  url: string;
  source: string;
  author: string;
  license: string;
  sourceUrl: string;
}

interface TbRealImgRec {
  list: TbRealImgItem[];
  base: number; // 轮换基点：每次刷新 +1，同 tag 全部展示位一起换到下一张（同分类）
  at: number;
}

const KEY = (tag: string) => `tb-real-img:${tag}`;
const NEG_PREFIX = 'tb-real-img-neg:';
const NEG_TTL = 10 * 60_000; // 首拉失败负缓存：10 分钟内不再自动请求（刷新是显式动作不受限）
const LIST_CAP = 16; // 每品类缓存张数上限（直链很小，16 张足够轮换多样性）

// ---------------- 订阅（useSyncExternalStore：版本号广播，新图到达全部挂载图重算） ----------------

let ver = 0;
const listeners = new Set<() => void>();

export function subscribeTbRealImg(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function tbRealImgVersion(): number {
  return ver;
}

function bump(): void {
  ver++;
  listeners.forEach((fn) => fn());
}

// ---------------- 读取（同步；TbImg 渲染用） ----------------

function recOf(tag: string): TbRealImgRec | null {
  const rec = kvGet<TbRealImgRec>(KEY(tag));
  if (!rec || !Array.isArray(rec.list)) return null;
  return rec;
}

export function tbGetRealImgs(tag: string): TbRealImgItem[] {
  const rec = recOf(tag);
  return rec ? rec.list.filter((i) => i && typeof i.url === 'string' && i.url.startsWith('http')) : [];
}

export function tbGetRealBase(tag: string): number {
  const rec = recOf(tag);
  return rec && typeof rec.base === 'number' && rec.base >= 0 ? rec.base : 0;
}

/** 版权信息一行（img title 展示）：作者 · 许可 · 图库 */
export function tbRealImgCredit(item: TbRealImgItem): string {
  return `${item.author || item.source} · ${item.license || 'CC'} · ${item.source}`;
}

// ---------------- 负缓存（localStorage，防离线/图库故障时反复打请求） ----------------

function negNow(tag: string): boolean {
  try {
    const t = Number(localStorage.getItem(NEG_PREFIX + tag));
    return Number.isFinite(t) && t > 0 && Date.now() - t < NEG_TTL;
  } catch {
    return false;
  }
}

function negSet(tag: string): void {
  try {
    localStorage.setItem(NEG_PREFIX + tag, String(Date.now()));
  } catch {
    /* 隐私模式忽略 */
  }
}

function negClr(tag: string): void {
  try {
    localStorage.removeItem(NEG_PREFIX + tag);
  } catch {
    /* 忽略 */
  }
}

// ---------------- 请求（全局并发 2 + 去重；按需请求不大量抓取） ----------------

const MAX_CONC = 2;
let active = 0;
const waiters: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < MAX_CONC) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const w = waiters.shift();
  if (w) w(); // 槽位直接移交
  else active--;
}

const inflight = new Map<string, Promise<boolean>>();

async function fetchItems(tag: string, refresh: boolean): Promise<TbRealImgItem[] | null> {
  try {
    const res = await fetch(`/api/tb-img?k=${encodeURIComponent(tag)}${refresh ? '&r=1' : ''}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { ok?: boolean; items?: TbRealImgItem[] };
    if (!j || !j.ok || !Array.isArray(j.items)) return null;
    return j.items.filter((it) => it && typeof it.url === 'string' && it.url.startsWith('http'));
  } catch {
    return null;
  }
}

/** 入缓存：新图前插（去重），base+1 让同 tag 展示位整体轮换到新图 */
function storeItems(tag: string, fresh: TbRealImgItem[]): void {
  const rec = recOf(tag) ?? { list: [], base: 0, at: 0 };
  const seen = new Set(rec.list.map((i) => i.url));
  const add = fresh.filter((i) => !seen.has(i.url));
  if (add.length === 0) return;
  const next: TbRealImgRec = {
    list: [...add, ...rec.list].slice(0, LIST_CAP),
    base: (rec.base || 0) + 1,
    at: Date.now(),
  };
  kvSet(KEY(tag), next);
  bump();
}

/** 首次按需拉取（仅缓存为空时；TbImg 挂载调用，打开淘宝不自动更新 = 有缓存就零请求）。
 *  kv 未注水完成时延后重试（防开机后立刻点开淘宝的时序性重复拉取）。 */
export function tbEnsureRealImg(tag: string, retryDepth = 0): void {
  const t = (tag || '').toLowerCase();
  if (!t || tbGetRealImgs(t).length > 0 || negNow(t)) return;
  if (!isKvReady()) {
    if (retryDepth < 20) setTimeout(() => tbEnsureRealImg(t, retryDepth + 1), 300);
    return;
  }
  const key = `e:${t}`;
  if (inflight.has(key)) return;
  const p = acquire()
    .then(async () => {
      const items = await fetchItems(t, false);
      if (items && items.length > 0) {
        negClr(t);
        storeItems(t, items);
        return true;
      }
      negSet(t); // 10 分钟内不重试（下拉刷新可立即重试）
      return false;
    })
    .finally(() => {
      release();
      inflight.delete(key);
    });
  inflight.set(key, p);
  p.catch(() => undefined);
}

/** 刷新换图（各界面刷新 handler 调用）：传入新内容条目的 tags，逐 tag 拉新图前插缓存。
 *  失败保留旧缓存（服务端缓存兜底也走这里——返回池内轮换图照常入缓存）。 */
export function tbRefreshRealImages(tags: string[]): void {
  const uniq = [...new Set(tags.map((t) => (t || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean))];
  for (const tag of uniq) {
    const key = `r:${tag}`;
    if (inflight.has(key)) continue;
    const p = acquire()
      .then(async () => {
        const items = await fetchItems(tag, true);
        if (items && items.length > 0) {
          negClr(tag);
          storeItems(tag, items);
          return true;
        }
        return false; // 失败：旧缓存原样保留
      })
      .finally(() => {
        release();
        inflight.delete(key);
      });
    inflight.set(key, p);
    p.catch(() => undefined);
  }
}
