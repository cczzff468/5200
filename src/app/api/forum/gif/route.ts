import { NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

/**
 * X论坛 · GIF/动图搜索（发布界面工具栏 GIF 入口）。
 * body: { query: string } → { success, results: [{ url, source }] }
 * 底层走 z-ai images.search（自研图片搜索服务，OSS 直链可嵌入）。
 */

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { query?: unknown };
    const query = typeof body.query === 'string' ? body.query.trim().slice(0, 40) : '';
    if (!query) {
      return NextResponse.json({ success: false, results: [], error: '缺少关键词' }, { status: 400 });
    }
    const zai = await ZAI.create();
    const res = await zai.images.search.create({
      query: `${query} gif 动图 表情包`,
      count: 12,
      gl: 'cn',
      rank: false,
    });
    const results = (res.results ?? [])
      .filter((r) => r.original_url)
      .map((r) => ({ url: r.original_url, source: r.source ?? '' }));
    return NextResponse.json({ success: true, results });
  } catch (err) {
    console.error('[forum/gif] search failed:', err);
    return NextResponse.json(
      { success: false, results: [], error: err instanceof Error ? err.message : '搜索失败' },
      { status: 500 },
    );
  }
}
