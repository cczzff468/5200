import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

/**
 * GET /api/search?q=<关键词>&num=<条数>
 * 微信搜索页「网络结果」后端：z-ai web_search 透传（SDK 只能在服务端使用）。
 * 返回 { results: [{ name, url, snippet, host_name, date, favicon }] }
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  const num = Math.min(Math.max(Number(req.nextUrl.searchParams.get('num')) || 6, 1), 10);

  if (!q) return NextResponse.json({ results: [] });

  try {
    const zai = await ZAI.create();
    const raw = (await zai.functions.invoke('web_search', { query: q, num })) as unknown;

    if (!Array.isArray(raw)) {
      return NextResponse.json({ results: [] });
    }

    const results = raw
      .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
      .map((r) => ({
        name: typeof r.name === 'string' ? r.name : '',
        url: typeof r.url === 'string' ? r.url : '',
        snippet: typeof r.snippet === 'string' ? r.snippet : '',
        host_name: typeof r.host_name === 'string' ? r.host_name : '',
        date: typeof r.date === 'string' ? r.date : '',
        favicon: typeof r.favicon === 'string' ? r.favicon : '',
      }))
      .filter((r) => r.url && /^https?:\/\//i.test(r.url))
      .slice(0, num);

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: '网络搜索失败' }, { status: 500 });
  }
}
