import { NextRequest, NextResponse } from 'next/server';

/**
 * 网上表情包搜索 API（GET /api/sticker-search?q=关键词）——微信/QQ 表情面板「表情搜索」弹窗后端
 *
 * 数据源（双源并发竞速，谁先回用谁，都回则合并）：
 *  - 发表情 fabiaoqing.com（中文斗图内容最对味；海外服务器访问慢 10-20s/偶发 502，国内部署时是首选快源）
 *  - Bing 图片 async 接口（海外快源；必须带 Accept-Language + Referer 头才返回数据，否则给 JS 壳）
 *
 * 缓存：Prisma SQLite（StickerSearchCache 表）24h 过期——同一关键词命中免出站；
 * 双源全挂时降级返回过期缓存（stale 标记），再挂才报错。
 *
 * 返回 { ok, items: [{ thumb, image }], source, cached? }；thumb 用于网格展示，image 用于发送（已包代理路径防防盗链）。
 */

import { db } from '@/lib/db';

export const runtime = 'nodejs';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6_000;
/** 发表情在海外慢（10-20s），再放宽也影响体验：单源预算 6s，超时即放弃该源 */
const MAX_ITEMS = 36;
/** Bing async 接口对同 IP 高频请求限流（几十秒内多次则临时空响应）：出站至少间隔 4s（全局队列） */
const BING_GAP_MS = 4_000;
let lastBingAt = 0;

interface StickerHit {
  /** 网格缩略图（可直接 <img> 加载） */
  thumb: string;
  /** 发送用原图（已包 /api/sticker-image 代理） */
  image: string;
  /** 相关性得分（Bing 源内部排序用） */
  score?: number;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 原始 URL → 代理路径（防防盗链 + 隐藏外域） */
function proxied(raw: string): string {
  return `/api/sticker-image?u=${encodeURIComponent(raw)}`;
}

// ---------------- 源 1：发表情 fabiaoqing.com（搜索页 HTML 宽容解析） ----------------

async function fetchFabiaoqing(q: string): Promise<StickerHit[]> {
  const url = `https://fabiaoqing.com/search/search/keyword/${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`fabiaoqing HTTP ${res.status}`);
  const html = await res.text();
  const hits: StickerHit[] = [];
  const seen = new Set<string>();
  // 宽容解析：<img> 的 data-original / data-gif / src 提取静态图片直链（搜索页结构：div.tagbqppdiv > img）
  const imgRe = /<img\b[^>]*>/gi;
  const attrRe = /(?:data-original|data-gif|src)=["']([^"']+\.(?:jpg|jpeg|png|gif|webp))["']/i;
  for (const tag of html.match(imgRe) ?? []) {
    const m = attrRe.exec(tag);
    if (!m) continue;
    let u = m[1];
    if (u.startsWith('//')) u = `https:${u}`;
    if (!/^https?:\/\//.test(u)) continue;
    // 过滤站点小图：logo/头像/图标类命名
    if (/logo|icon|avatar|\.svg/i.test(u)) continue;
    const key = u.replace(/^https?:/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ thumb: proxied(u), image: proxied(u) });
    if (hits.length >= MAX_ITEMS) break;
  }
  if (hits.length === 0) throw new Error('fabiaoqing 解析为空');
  return hits;
}

// ---------------- 源 2：Bing 图片 async（m 属性 JSON 里提 murl 原图 / turl 缩略图） ----------------

async function fetchBing(q: string): Promise<StickerHit[]> {
  // 全局节流：距上次出站不足 4s 则补齐间隔（防同 IP 高频触发 Bing 临时限流）
  const gap = Date.now() - lastBingAt;
  if (gap < BING_GAP_MS) await new Promise((r) => setTimeout(r, BING_GAP_MS - gap));
  lastBingAt = Date.now();
  const url = `https://www.bing.com/images/async?q=${encodeURIComponent(`${q} 表情包`)}&first=0&count=${MAX_ITEMS}&mmasync=1`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      // 三件套缺一不可：无 Accept-Language / Referer 时 Bing 返回 JS 壳页面（无图片数据）
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: 'https://www.bing.com/images/search',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`bing HTTP ${res.status}`);
  const html = await res.text();
  // 每个结果是一个 m="{...murl:...turl:...}" 属性块（HTML 实体编码），按块提取原图+缩略图
  const blockRe = /m="([^"]+)"/gi;
  const murlRe = /murl":"([^"]+)/;
  const turlRe = /turl":"([^"]+)/;
  const titleRe = /\\bt":"([^"]{0,120})/;
  const hits: StickerHit[] = [];
  const seen = new Set<string>();
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(html))) {
    // 先统一解码实体（&amp; → &）：否则原图 URL 自带的查询参数会被截断
    const payload = block[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    const mu = murlRe.exec(payload)?.[1];
    if (!mu) continue;
    const image = mu.replace(/\\u002f/gi, '/').replace(/\\\//g, '/');
    if (!/^https?:\/\//i.test(image)) continue;
    if (/\.(svg|ico)(\?|$)/i.test(image)) continue;
    const key = image.replace(/^https?:/i, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const tu = turlRe.exec(payload)?.[1];
    const thumbRaw = tu ? tu.replace(/\\u002f/gi, '/').replace(/\\\//g, '/') : image;
    const title = titleRe.exec(payload)?.[1] ?? '';
    hits.push({
      thumb: thumbRaw.startsWith('/') ? proxied(image) : thumbRaw,
      image: proxied(image),
      // 相关性加权：Bing 中文搜“表情包”会混入新闻图/素材图——标题或 URL 带表情包特征词的排前
      score: /(表情包|表情|斗图|梗图|金馆长|熊猫头|meme|sticker|bqb|biaoqing|emoji)/i.test(`${title} ${image}`) ? 1 : 0,
    });
    if (hits.length >= MAX_ITEMS + 12) break;
  }
  if (hits.length === 0) throw new Error('bing 解析为空');
  // 稳定排序：特征词命中在前，其余按原序
  return hits.map((h, i) => ({ h, i })).sort((a, b) => (b.h.score ?? 0) - (a.h.score ?? 0) || a.i - b.i).map(({ h }) => ({ thumb: h.thumb, image: h.image }));
}

// ---------------- 路由 ----------------

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 30);
  if (!q) return NextResponse.json({ ok: false, error: '缺少搜索词' }, { status: 400 });

  // 1) 缓存命中（24h 内）
  try {
    const row = await db.stickerSearchCache.findUnique({ where: { keyword: q } });
    if (row && Date.now() - row.updatedAt.getTime() < CACHE_TTL_MS) {
      const items = JSON.parse(row.items) as StickerHit[];
      if (Array.isArray(items) && items.length > 0) {
        return NextResponse.json({ ok: true, items, source: row.source, cached: true });
      }
    }
  } catch {
    /* 缓存读写失败不阻塞搜索 */
  }

  // 2) 双源并发竞速
  const results = await Promise.allSettled([fetchFabiaoqing(q), fetchBing(q)]);
  const fbq = results[0].status === 'fulfilled' ? results[0].value : null;
  const bing = results[1].status === 'fulfilled' ? results[1].value : null;

  let items: StickerHit[] = [];
  let source = '';
  if (fbq && bing) {
    // 合并去重：中文源在前、Bing 补足（原图维度去重）
    const seen = new Set<string>();
    items = [...fbq, ...bing].filter((h) => {
      const key = h.image.replace(/^\/api\/sticker-image\?u=/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    source = 'both';
  } else if (fbq) {
    items = fbq;
    source = 'fabiaoqing';
  } else if (bing) {
    items = bing;
    source = 'bing';
  }

  // 3) 全挂 → 过期缓存兜底
  if (items.length === 0) {
    try {
      const row = await db.stickerSearchCache.findUnique({ where: { keyword: q } });
      if (row) {
        const stale = JSON.parse(row.items) as StickerHit[];
        if (Array.isArray(stale) && stale.length > 0) {
          return NextResponse.json({ ok: true, items: stale, source: row.source, cached: true, stale: true });
        }
      }
    } catch {
      /* 继续报错 */
    }
    return NextResponse.json({ ok: false, error: '搜索失败，换个词试试' }, { status: 502 });
  }

  // 4) 写缓存（失败不阻塞）
  const sliced = items.slice(0, MAX_ITEMS);
  try {
    await db.stickerSearchCache.upsert({
      where: { keyword: q },
      update: { items: JSON.stringify(sliced), source },
      create: { keyword: q, items: JSON.stringify(sliced), source },
    });
  } catch {
    /* 忽略 */
  }

  return NextResponse.json({ ok: true, items: sliced, source });
}
