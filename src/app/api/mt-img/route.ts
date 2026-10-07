import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 美团内容匹配图代理：
 * - 前端传英文品类词（k，如 hotpot/pizza/milk-tea）→ 服务端调用 AI 生图（Pollinations），
 *   生成与内容一致的图片（奶茶=奶茶杯、火锅=红汤锅），解决随机图库「图片与内容不符」问题；
 * - 内存缓存（同 tag+变体只生成一次）+ 浏览器强缓存（immutable），命中秒出；
 * - 并发队列（同时最多 2 个生成任务）：避免信息流 burst 触发上游限流（402）；
 * - 402/5xx/超时自动退避重试，全部失败再兜底 Lorem Picsum，最后返回 502 由前端显示占位图。
 */

// ---------------- 参数 ----------------

const MAX_CACHE = 240; // 内存缓存上限（张）
const MAX_CONCURRENCY = 2; // 同时生成任务数

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

/** 提示词模板：f=菜品/套餐近拍，c=门头/店内，饮品=杯装 */
function promptOf(kind: 'f' | 'c', tag: string): string {
  const t = tag.replace(/-/g, ' ');
  if (kind === 'c') {
    return `${t} restaurant storefront with appetizing food, warm cozy interior, food photography`;
  }
  if (DRINK_TAGS.has(tag)) {
    return `${t} drink in a plastic cup with straw, refreshing beverage photography`;
  }
  return `${t} dish, delicious appetizing close-up food photography, plating`;
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

type GenResult = { buf: Buffer; fromFallback: boolean };

async function genBytes(prompt: string, w: number, h: number, seed: number, key: string): Promise<GenResult> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > 1000) return { buf: Buffer.from(ab), fromFallback: false };
      }
    } catch {
      // 超时/网络错误，退避后重试
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  // 兜底：Lorem Picsum（随机图但至少能出图；不进缓存 → 下次请求自动重试真实生成，自愈）
  try {
    const res = await fetch(`https://picsum.photos/seed/${encodeURIComponent(`mtfb-${key}`)}/${w}/${h}.jpg`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { buf: Buffer.from(await res.arrayBuffer()), fromFallback: true };
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
  const key = `${kind}|${tag}|${w}x${h}|${s}`;

  const hit = cache.get(key);
  if (hit) return jpeg(hit);

  let task = inflight.get(key);
  if (!task) {
    task = acquire()
      .then(() => genBytes(promptOf(kind, tag), w, h, s, key))
      .finally(release);
    inflight.set(key, task);
    task
      .then((r) => {
        // 仅缓存真实生成结果；兜底图不缓存（下次请求自动重试真实生成）
        if (!r.fromFallback) cacheSet(key, r.buf);
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
