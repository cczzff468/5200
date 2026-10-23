import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/upload-glb
 * 接收用户上传的 GLB/FBX/ZIP 模型文件，保存到项目 upload-glb/ 目录。
 * form-data 字段：file（可多次调用，或单文件）
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const entries = formData.getAll('file');
    const files = entries.filter((e): e is File => e instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ ok: false, error: '没有收到文件' }, { status: 400 });
    }

    const dir = path.join(process.cwd(), 'upload-glb');
    await mkdir(dir, { recursive: true });

    const saved: { name: string; size: number }[] = [];
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const safe = file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
      const finalName = `glb-${Date.now()}-${safe}`;
      await writeFile(path.join(dir, finalName), buf);
      saved.push({ name: finalName, size: buf.length });
      console.log(`[upload-glb] saved ${finalName} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
    }

    return NextResponse.json({ ok: true, saved });
  } catch (err) {
    console.error('[upload-glb] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
