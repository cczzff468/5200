import { NextRequest } from 'next/server';

/**
 * 网易云 API 代理（内置默认通道）：
 *   /api/music/ncm/<path>?<query>  →  ${NCM_API_UPSTREAM}/<path>?<query>
 *     默认 http://localhost:3010（沙箱内 vendor 的 mini-services/netease-api，
 *     或外部同机部署 deploy/ncm-api/docker-compose.yml 的端口映射，均零配置对接）；
 *     离开沙箱后 API 部署在其它地址/主机时，设环境变量 NCM_API_UPSTREAM 指向即可
 *     （支持 .env / .env.local，改后重启 dev server）。
 *
 * 为什么经这层而不是前端直连：
 * - 统一同源 /api/music/ncm/*，沙箱内外行为一致，且顺带解决跨域与 cookie 透传；
 * - 音频/封面直链另有 /api/music/stream 白名单代理（http 混合内容与防盗链），不受本配置影响。
 *
 * API 本体：api-enhanced v4.41.1（vendor 于 mini-services/netease-api，源 cczzff468/api-enhanced），
 * 外部部署指南见 deploy/ncm-api/README.md。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPSTREAM = process.env.NCM_API_UPSTREAM?.trim() || 'http://localhost:3010';

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
