import { NextResponse } from 'next/server';
import webpush from 'web-push';

/**
 * Web Push 订阅管理（退出网页后也收「每条消息一条系统通知」）：
 * - GET：返回 VAPID 公钥（客户端订阅用；密钥首次访问时生成并持久化到 .data/vapid.json）；
 * - POST：保存浏览器推送订阅（.data/push-subs.json，按 endpoint 去重）；
 * - DELETE：移除订阅（浏览器退订时调用）。
 * 订阅在服务端为尽力而为的增强能力：不支持 Service Worker / Push 的环境（如预览面板 iframe）
 * 注册失败静默跳过，应用内灵动岛弹窗与页面隐藏时的 Web Notification 不受影响。
 */

export const runtime = 'nodejs';

interface SubRec {
  endpoint: string;
  [k: string]: unknown;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const { readFile } = await import('fs/promises');
    const path = await import('path');
    const raw = await readFile(path.join(process.cwd(), '.data', file), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  try {
    const { writeFile, mkdir } = await import('fs/promises');
    const path = await import('path');
    await mkdir(path.join(process.cwd(), '.data'), { recursive: true });
    await writeFile(path.join(process.cwd(), '.data', file), JSON.stringify(value), 'utf8');
  } catch {
    // 持久化失败静默
  }
}

async function getVapid(): Promise<{ publicKey: string; privateKey: string }> {
  const saved = await readJson<{ publicKey?: string; privateKey?: string }>('vapid.json', {});
  if (saved.publicKey && saved.privateKey) return { publicKey: saved.publicKey, privateKey: saved.privateKey };
  const keys = webpush.generateVAPIDKeys();
  await writeJson('vapid.json', keys);
  return { publicKey: keys.publicKey, privateKey: keys.privateKey };
}

export async function GET(): Promise<NextResponse> {
  try {
    const { publicKey } = await getVapid();
    return NextResponse.json({ publicKey });
  } catch {
    return NextResponse.json({ error: '推送初始化失败' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { subscription?: { endpoint?: unknown } } | null;
  const endpoint = body?.subscription?.endpoint;
  if (typeof endpoint !== 'string' || !endpoint) {
    return NextResponse.json({ error: 'subscription 无效' }, { status: 400 });
  }
  const subs = await readJson<SubRec[]>('push-subs.json', []);
  const next = Array.isArray(subs) ? subs.filter((s) => s && s.endpoint !== endpoint) : [];
  next.push(body.subscription as SubRec);
  await writeJson('push-subs.json', next.slice(-50));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== 'string') return NextResponse.json({ error: 'endpoint 无效' }, { status: 400 });
  const subs = await readJson<SubRec[]>('push-subs.json', []);
  await writeJson('push-subs.json', subs.filter((s) => s && s.endpoint !== body.endpoint));
  return NextResponse.json({ ok: true });
}
