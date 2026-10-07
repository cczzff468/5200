import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 美团内容匹配图代理（2025 调研：LoremFlickr/Unsplash Source/Foodish 均已停服，关键词出图首选 AI 生成）：
 * - 前端传英文品类词（k，如 hotpot/pizza/milk-tea）→ 四级生成链，保证图片与内容一致：
 *   ① Pollinations（快，配额内 2~5s；402/403 限流快跳不浪费时间）
 *   ② z-ai 内置生图（内容匹配、质量稳定；结果永久缓存，一次生成长期复用）
 *   ③ Wikimedia Commons 实拍图（免费无 key，关键词相关）
 *   ④ Lorem Picsum 随机图（最终兜底，不缓存 → 下次自动重试真实生成，自愈）
 * - 内存缓存（同 tag+变体只生成一次）+ 浏览器强缓存（immutable），命中秒出；
 * - 并发队列（同时最多 2 个生成任务）：避免信息流 burst 触发上游限流。
 */

// ---------------- 参数 ----------------

const MAX_CACHE = 240; // 内存缓存上限（张）
const MAX_CONCURRENCY = 3; // 同时生成任务数（z-ai 单张 ~60s，并发太低会让信息流填图过慢）

function intOf(v: string | null, def: number, lo: number, hi: number): number {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}

/** tag 清洗：小写、仅留 a-z0-9-，空回退 food */
function tagOf(raw: string | null): string {
  const t = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return t || 'food';
}

/** 饮品类 tag：用「杯装饮品」提示词（避免 dish/plating 生成甜品碗） */
const DRINK_TAGS = new Set(['milk-tea', 'tea', 'coffee', 'juice', 'soymilk', 'milkshake', 'milk', 'cola', 'suanmeitang', 'drink', 'lemon-tea', 'yogurt']);

/** 提示词模板：f=菜品/套餐近拍，c=门头/店内，饮品=杯装（专业美食摄影风格，出图更精致） */
function promptOf(kind: 'f' | 'c', tag: string): string {
  const t = tag.replace(/-/g, ' ');
  if (kind === 'c') {
    return `${t} shop storefront, inviting entrance with warm lights, appetizing display, professional photography, high quality, detailed`;
  }
  if (DRINK_TAGS.has(tag)) {
    return `${t} drink in a plastic cup with straw, professional beverage photography, refreshing condensation, bright clean background, high quality`;
  }
  return `${t} dish, professional food photography, appetizing plating, soft warm light, shallow depth of field, high quality, detailed`;
}

// ---------------- 缓存 + 并发队列 ----------------

const cache = new Map<string, Buffer>();
const inflight = new Map<string, Promise<GenResult>>();
let active = 0;
const waiters: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const w = waiters.shift();
  if (w) w(); // 槽位直接移交，active 不变
  else active--;
}

function cacheSet(key: string, buf: Buffer): void {
  cache.set(key, buf);
  if (cache.size > MAX_CACHE) {
    // 淘汰最早插入的 1/6（Map 迭代序 = 插入序）
    const evict = Math.ceil(MAX_CACHE / 6);
    let i = 0;
    for (const k of cache.keys()) {
      cache.delete(k);
      if (++i >= evict) break;
    }
  }
}

// ---------------- 生成 ----------------

type GenResult = { buf: Buffer; cacheable: boolean };

/** z-ai 内置生图客户端（模块级单例，懒加载） */
interface ZaiLike {
  images: { generations: { create: (a: { prompt: string; size: string }) => Promise<{ data?: Array<{ base64?: string }> }> } };
}
let zaiClient: Promise<ZaiLike> | null = null;
function getZai(): Promise<ZaiLike> {
  if (!zaiClient) {
    zaiClient = import('z-ai-web-dev-sdk').then((m) => m.default.create() as unknown as ZaiLike);
  }
  return zaiClient;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** ③ Wikimedia Commons 实拍图（免费无 key；搜前 5 张，取第一张 jpeg/png） */
async function wikimediaImage(tag: string, w: number): Promise<Buffer | null> {
  try {
    const q = tag.replace(/-/g, ' ');
    const api =
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}` +
      `&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url|mime&iiurlwidth=${Math.min(w, 800)}&format=json&origin=*`;
    const res = await fetch(api, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'meituan-demo/1.0 (local demo)' },
    });
    if (!res.ok) return null;
    const j: unknown = await res.json();
    const pages = (j as { query?: { pages?: Record<string, { imageinfo?: Array<{ mime?: string; thumburl?: string; url?: string }> }> } }).query?.pages;
    if (!pages) return null;
    for (const p of Object.values(pages)) {
      const info = p.imageinfo?.[0];
      if (!info?.mime || !/jpeg|png/.test(info.mime)) continue;
      const url = info.thumburl ?? info.url;
      if (!url) continue;
      try {
        const ir = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (ir.ok) {
          const buf = Buffer.from(await ir.arrayBuffer());
          if (buf.byteLength > 1000) return buf;
        }
      } catch {
        // 下一张
      }
    }
  } catch {
    // 忽略，走最终兜底
  }
  return null;
}

async function genBytes(kind: 'f' | 'c', tag: string, prompt: string, w: number, h: number, seed: number, key: string): Promise<GenResult> {
  // ① Pollinations：402/403 限流快跳（重试无意义），超时/网络错误重试一次
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > 1000) return { buf: Buffer.from(ab), cacheable: true };
      }
      if (res.status === 402 || res.status === 403) break;
    } catch {
      // 超时/网络错误，稍后重试一次
    }
    await sleep(1200);
  }
  // ② z-ai 内置生图（内容匹配、质量稳定；结果永久缓存，一次生成长期复用）
  try {
    const zai = await getZai();
    const r = await zai.images.generations.create({
      prompt: `${prompt}, high quality, detailed`,
      size: w >= h ? '1152x864' : '1024x1024',
    });
    const b64 = r.data?.[0]?.base64;
    if (b64) return { buf: Buffer.from(b64, 'base64'), cacheable: true };
  } catch {
    // SDK 失败，继续兜底
  }
  // ③ Wikimedia Commons 实拍图（快、免费、与关键词相关；不缓存 —— 相关度不稳，下次请求自愈给 ②z-ai）
  const wb = await wikimediaImage(tag, w);
  if (wb) return { buf: wb, cacheable: false };
  // ④ Lorem Picsum 随机图（最终兜底；不缓存 → 下次请求自动重试真实生成，自愈）
  try {
    const res = await fetch(`https://picsum.photos/seed/${encodeURIComponent(`mtfb-${key}`)}/${w}/${h}.jpg`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { buf: Buffer.from(await res.arrayBuffer()), cacheable: false };
  } catch {
    // 全部失败
  }
  throw new Error('图片生成失败');
}

// ---------------- 路由 ----------------

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const kind: 'f' | 'c' = sp.get('p') === 'c' ? 'c' : 'f';
  const tag = tagOf(sp.get('k'));
  const s = intOf(sp.get('s'), 0, 0, 999);
  const w = intOf(sp.get('w'), kind === 'c' ? 480 : 400, 100, 800);
  const h = intOf(sp.get('h'), kind === 'c' ? 360 : 400, 100, 800);
  // v=提示词/链路版本：升级后浏览器旧缓存自然失效（URL 变了）
  const ver = intOf(sp.get('v'), 1, 1, 99);
  const key = `${kind}|${tag}|${w}x${h}|${s}|v${ver}`;

  const hit = cache.get(key);
  if (hit) return jpeg(hit);

  let task = inflight.get(key);
  if (!task) {
    task = acquire()
      .then(() => genBytes(kind, tag, promptOf(kind, tag), w, h, s, key))
      .finally(release);
    inflight.set(key, task);
    task
      .then((r) => {
        // 仅缓存真实生成/实拍结果；picsum 兜底不缓存（下次请求自动重试真实生成）
        if (r.cacheable) cacheSet(key, r.buf);
      })
      .catch(() => undefined)
      .finally(() => inflight.delete(key));
  }

  try {
    const r = await task;
    return jpeg(r.buf);
  } catch {
    return NextResponse.json({ ok: false, error: '图片生成失败' }, { status: 502 });
  }
}

function jpeg(buf: Buffer): NextResponse {
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
