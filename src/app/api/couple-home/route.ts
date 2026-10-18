import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * 情侣小家持久化 API（Prisma 单行快照，按浏览器工作区隔离）
 *
 * - GET  → { data: HomeState | null, coins: number, rev: number }（无档案时 data=null，客户端播默认布局）
 * - POST → 保存全量快照 { data, coins, rev }（乐观并发：rev 不匹配返回 409 + 服务端最新版，客户端采纳服务端）
 *          { action: 'reset' } → 删除档案（客户端重新播种默认布局）
 *
 * 校验策略：结构宽松但逐字段清洗（条数/坐标/金币钳制），防止任意大 payload 与坐标穿模。
 */

interface FurnItem {
  id: string;
  kind: string;
  x: number;
  y: number;
  flip?: boolean;
  st?: Record<string, unknown>;
}

interface HomePayload {
  furniture: FurnItem[];
  chars: Record<string, { x: number; y: number; dir?: string }>;
  night?: boolean;
}

const MAX_ITEMS = 150;
const MAX_COORD = 4000;
const MAX_JSON = 256 * 1024;

function clampNum(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(max, Math.round(n)));
}

function cleanStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** 宽松清洗 HomeState；结构不合法返回 null */
function normalizeHome(raw: unknown): HomePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.furniture)) return null;
  const furniture: FurnItem[] = [];
  for (const it of r.furniture.slice(0, MAX_ITEMS)) {
    if (!it || typeof it !== 'object') continue;
    const f = it as Record<string, unknown>;
    const x = clampNum(f.x, MAX_COORD);
    const y = clampNum(f.y, MAX_COORD);
    const id = cleanStr(f.id, 64);
    const kind = cleanStr(f.kind, 24);
    if (x == null || y == null || !id || !kind) continue;
    const st =
      f.st && typeof f.st === 'object' && !Array.isArray(f.st)
        ? JSON.stringify(f.st).length <= 2048
          ? (f.st as Record<string, unknown>)
          : {}
        : {};
    furniture.push({ id, kind, x, y, flip: f.flip === true ? true : undefined, st });
  }
  if (furniture.length === 0 && r.furniture.length > 0) return null;
  const chars: HomePayload['chars'] = {};
  if (r.chars && typeof r.chars === 'object') {
    for (const [key, val] of Object.entries(r.chars as Record<string, unknown>).slice(0, 4)) {
      if (!val || typeof val !== 'object') continue;
      const c = val as Record<string, unknown>;
      const x = clampNum(c.x, MAX_COORD);
      const y = clampNum(c.y, MAX_COORD);
      if (x == null || y == null) continue;
      chars[key] = { x, y, dir: c.dir === 'left' || c.dir === 'right' ? c.dir : undefined };
    }
  }
  return { furniture, chars, night: r.night === true };
}

function wsOf(req: NextRequest): string {
  const raw = req.headers.get('x-workspace-id')?.trim();
  return raw ? raw.slice(0, 64) : 'default';
}

export async function GET(req: NextRequest) {
  try {
    const row = await db.coupleHome.findUnique({ where: { workspaceId: wsOf(req) } });
    if (!row) return NextResponse.json({ data: null, coins: null, rev: 0 });
    return NextResponse.json({
      data: normalizeHome(JSON.parse(row.data)) ?? null,
      coins: row.coins,
      rev: row.rev,
    });
  } catch {
    return NextResponse.json({ error: 'db-error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }
  const workspaceId = wsOf(req);

  // 重置：删档（客户端随后重新播种默认布局）
  if (body.action === 'reset') {
    try {
      await db.coupleHome.delete({ where: { workspaceId } }).catch(() => null);
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: 'db-error' }, { status: 500 });
    }
  }

  const home = normalizeHome(body.data);
  if (!home) return NextResponse.json({ error: 'bad-data' }, { status: 400 });
  const coinsRaw = clampNum(body.coins, 1_000_000);
  const coins = coinsRaw == null ? 0 : coinsRaw;
  const clientRev = clampNum(body.rev, 1_000_000) ?? 0;
  const dataStr = JSON.stringify(home);
  if (dataStr.length > MAX_JSON) return NextResponse.json({ error: 'too-large' }, { status: 413 });

  try {
    // 乐观并发：服务端已有更高版本且与客户端 rev 不一致 → 409 + 回带服务端最新（客户端采纳）
    const existing = await db.coupleHome.findUnique({ where: { workspaceId } });
    if (existing && existing.rev !== clientRev) {
      return NextResponse.json(
        {
          conflict: true,
          data: normalizeHome(JSON.parse(existing.data)),
          coins: existing.coins,
          rev: existing.rev,
        },
        { status: 409 },
      );
    }
    const row = await db.coupleHome.upsert({
      where: { workspaceId },
      create: { workspaceId, data: dataStr, coins, rev: 1 },
      update: { data: dataStr, coins, rev: { increment: 1 } },
    });
    return NextResponse.json({ ok: true, rev: row.rev });
  } catch {
    return NextResponse.json({ error: 'db-error' }, { status: 500 });
  }
}
