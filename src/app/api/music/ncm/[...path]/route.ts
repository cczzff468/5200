import { NextRequest } from 'next/server';

/**
 * 网易云 API 代理（内置默认通道）：
 *   /api/music/ncm/<path>?<query>  →  http://localhost:3010/<path>?<query>
 *
 * 为什么经这层而不是前端直连 3010（XTransformPort）：
 * - 预览面板走 Caddy(:81)，相对路径 + XTransformPort 可转发；但直连 3000 端口时
 *   Next.js 没有这些路由（404）。统一走同源 /api/music/ncm/*，两条通道行为完全一致；
 * - 顺带解决跨域与 cookie 透传。
 *
 * mini-services/netease-api（NeteaseCloudMusicApi@4.32.0）必须在本机 3010 端口运行。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPSTREAM = 'http://localhost:3010';

async function proxy(req: NextRequest, path: string[]) {
  const url = new URL(req.url);
  const target = `${UPSTREAM}/${path.map(encodeURIComponent).join('/')}${url.search}`;
  try {
    const res = await fetch(target, {
      method: req.method,
      headers: {
        'Content-Type': req.headers.get('content-type') ?? 'application/json',
        // 透传 cookie 参数场景无需特殊头；netease-api 全靠 query 传 cookie
      },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    const headers = new Headers();
    headers.set('content-type', res.headers.get('content-type') ?? 'application/json; charset=utf-8');
    headers.set('cache-control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    return new Response(
      JSON.stringify({ code: -2, message: `网易云 API 服务不可达（mini-services/netease-api 未运行？）：${(e as Error).message}` }),
      { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
