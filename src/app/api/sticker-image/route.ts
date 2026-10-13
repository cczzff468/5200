import { NextRequest, NextResponse } from 'next/server';

/**
 * 表情图片防盗链代理（GET /api/sticker-image?u=<编码后的原图 URL>）
 *
 * 为什么需要：搜索结果里的图片直链（img.soutula.com / i0.hdslb.com / sinaimg.cn 等）普遍校验
 * Referer，聊天消息气泡直接 <img src=外域> 会裂图——统一经本代理带正确 Referer 转发。
 *
 * 安全：仅放行公网 http(s) 图片域名白名单；拦截内网地址（localhost/127./10./192.168./169.254/元数据）。
 * 缓存：不落盘不驻内存，流式转发；浏览器侧 Cache-Control 86400s 自行缓存。
 */

export const runtime = 'nodejs';

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

/** 域名后缀白名单（带点精确后缀匹配）+ 对应伪造 Referer（来源站 = 图片实际所属站点） */
const REFERER_RULES: [RegExp, string][] = [
  [/(\.|^)soutula\.com$/i, 'https://fabiaoqing.com/'],
  [/(\.|^)sinaimg\.cn$/i, 'https://weibo.com/'],
  [/(\.|^)hdslb\.com$/i, 'https://www.bilibili.com/'],
  [/(\.|^)gtimg\.com$/i, 'https://qq.com/'],
  [/(\.|^)alicdn\.com$/i, 'https://www.taobao.com/'],
  [/(\.|^)byteimg\.com$/i, 'https://www.douyin.com/'],
  [/(\.|^)douyinpic\.com$/i, 'https://www.douyin.com/'],
  [/(\.|^)360buyimg\.com$/i, 'https://www.jd.com/'],
];

/** 兜底白名单（无 Referer 规则的域：bing 缩略图 CDN 等本身不校验来源） */
const ALLOW_HOST_RE =
  /(\.|^)(mm\.bing\.net|bing\.net|fabiaoqing\.com|weibo\.com|bilibili\.com|qq\.com|61\.com|bilivideo\.com|akamaized\.net|imgur\.com|githubusercontent\.com|loli\.net|xiaohongshu\.com|xhscdn\.com)$/i;

function refererFor(host: string): string | undefined {
  for (const [re, ref] of REFERER_RULES) if (re.test(host)) return ref;
  return undefined;
}

/** 内网/危险地址拦截 */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1|f[cd]|fe80)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('u');
  if (!raw) return NextResponse.json({ error: 'missing u' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(decodeURIComponent(raw));
  } catch {
    return NextResponse.json({ error: 'bad url' }, { status: 400 });
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return NextResponse.json({ error: 'bad protocol' }, { status: 400 });
  }
  const host = target.hostname;
  if (isBlockedHost(host)) return NextResponse.json({ error: 'blocked host' }, { status: 403 });
  if (!ALLOW_HOST_RE.test(host) && !REFERER_RULES.some(([re]) => re.test(host))) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 403 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        'User-Agent': UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        ...(refererFor(host) ? { Referer: refererFor(host) } : {}),
      },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
    }
    const headers = new Headers();
    headers.set('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
    const len = upstream.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    headers.set('Cache-Control', 'public, max-age=86400');
    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 });
  }
}
