import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * 情侣小家 3D 持久化 API（Prisma 单行快照，按浏览器工作区隔离）
 *
 * - GET  → { data: HomeState | null, rev: number }（无档案时 data=null，客户端播默认布局）
 * - POST → 保存全量快照 { data, rev }（乐观并发：rev 不匹配返回 409 + 服务端最新版，客户端采纳服务端）
 *          { action: 'reset' } → 删除档案（客户端重新播种默认布局）
 *
 * 校验策略：结构宽松但逐字段清洗（条数/坐标/角度/颜色钳制），防止任意大 payload 与坐标穿模。
 * 3D 坐标系：房间中心为原点，坐标可为负（±20 米钳制）；金币系统已移除（列保留恒 0）。
 */

interface FurnItem {
  id: string;
  kind: string;
  x: number;
  z: number;
  /** 抬升（米）：电视上墙 / 小物上桌 */
  y?: number;
  /** 水平旋转（弧度，任意角度） */
  ry?: number;
  /** 俯仰旋转（弧度，±~60°） */
  rx?: number;
  /** 用户自选主色（#rrggbb） */
  col?: string;
  st?: Record<string, unknown>;
}

interface HomePayload {
  v: number;
  furniture: FurnItem[];
  chars: Record<string, { x: number; z: number; dir?: string }>;
  night?: boolean;
  /** 窗户开态（最多 8 扇） */
  win?: boolean[];
  /** 地板自定义色（#rrggbb） */
  floorCol?: string;
  /** 墙壁自定义色（#rrggbb） */
  wallCol?: string;
}

const MAX_ITEMS = 150;
/** 3D 世界坐标绝对值上限（米） */
const MAX_COORD = 20;
const MAX_JSON = 256 * 1024;

/** 有符号坐标清洗：钳到 [-max, max]，非法返回 null */
function clampCoord(v: unknown, max = MAX_COORD): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(-max, Math.min(max, Math.round(n * 100) / 100));
}

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function cleanStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** 弧度清洗：钳到 [-π, π]（非法返回 null） */
function clampRad(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(-max, Math.min(max, Math.round(n * 1000) / 1000));
}

/** 用户色清洗：仅接受 #rrggbb */
function cleanHex(v: unknown): string | undefined {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined;
}

const DIRS = new Set(['up', 'down', 'left', 'right']);

/** 宽松清洗 HomeState（3D 版 v=3）；结构不合法返回 null */
function normalizeHome(raw: unknown): HomePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.furniture)) return null;
  const furniture: FurnItem[] = [];
  for (const it of r.furniture.slice(0, MAX_ITEMS)) {
    if (!it || typeof it !== 'object') continue;
    const f = it as Record<string, unknown>;
    const x = clampCoord(f.x);
    const z = clampCoord(f.z);
    const id = cleanStr(f.id, 64);
    const kind = cleanStr(f.kind, 24);
    if (x == null || z == null || !id || !kind) continue;
    const ry = clampRad(f.ry, Math.PI);
    const rx = clampRad(f.rx, 1.1);
    const y = clampCoord(f.y, 2.4);
    const col = cleanHex(f.col);
    const st =
      f.st && typeof f.st === 'object' && !Array.isArray(f.st)
        ? JSON.stringify(f.st).length <= 2048
          ? (f.st as Record<string, unknown>)
          : {}
        : {};
    furniture.push({ id, kind, x, z, ry: ry ?? 0, rx: rx ?? 0, y: y ?? 0, col, st });
  }
  if (furniture.length === 0 && r.furniture.length > 0) return null;
  const chars: HomePayload['chars'] = {};
  if (r.chars && typeof r.chars === 'object') {
    for (const [key, val] of Object.entries(r.chars as Record<string, unknown>).slice(0, 4)) {
      if (!val || typeof val !== 'object') continue;
      const c = val as Record<string, unknown>;
      const x = clampCoord(c.x);
      const z = clampCoord(c.z);
      if (x == null || z == null) continue;
      const dir = typeof c.dir === 'string' && DIRS.has(c.dir) ? c.dir : undefined;
      chars[key] = { x, z, dir };
    }
  }
  if (!chars.me || !chars.partner) return null;
  // 窗户开态：最多 8 扇布尔值
  let win: boolean[] | undefined;
  if (Array.isArray(r.win)) {
    win = r.win.slice(0, 8).map((w) => w === true);
  }
  return {
    v: typeof r.v === 'number' ? r.v : 4,
    furniture,
    chars,
    night: r.night === true,
    win,
    floorCol: cleanHex(r.floorCol),
    wallCol: cleanHex(r.wallCol),
  };
}

function wsOf(req: NextRequest): string {
  const raw = req.headers.get('x-workspace-id')?.trim();
  return raw ? raw.slice(0, 64) : 'default';
}

export async function GET(req: NextRequest) {
  try {
    const row = await db.coupleHome.findUnique({ where: { workspaceId: wsOf(req) } });
    if (!row) return NextResponse.json({ data: null, rev: 0 });
    return NextResponse.json({
      data: normalizeHome(JSON.parse(row.data)),
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
  const clientRev = clampInt(body.rev, 0, 1_000_000) ?? 0;
  const dataStr = JSON.stringify(home);
  if (dataStr.length > MAX_JSON) return NextResponse.json({ error: 'too-large' }, { status: 413 });

  try {
    // 乐观并发：仅当服务端存的是「同代（v4）合法数据」且 rev 不一致 → 409 + 回带服务端最新（客户端采纳）；
    // 服务端若存的是旧格式（v3 / 2D 时代 / 损坏数据），直接用新快照覆盖完成迁移。
    const existing = await db.coupleHome.findUnique({ where: { workspaceId } });
    if (existing) {
      let serverVer = 0;
      try {
        serverVer = (JSON.parse(existing.data) as { v?: number }).v ?? 0;
      } catch {
        serverVer = 0;
      }
      const serverHome = serverVer === 4 ? normalizeHome(JSON.parse(existing.data)) : null;
      if (serverHome && existing.rev !== clientRev) {
        return NextResponse.json(
          {
            conflict: true,
            data: serverHome,
            rev: existing.rev,
          },
          { status: 409 },
        );
      }
    }
    const row = await db.coupleHome.upsert({
      where: { workspaceId },
      create: { workspaceId, data: dataStr, coins: 0, rev: 1 },
      update: { data: dataStr, coins: 0, rev: { increment: 1 } },
    });
    return NextResponse.json({ ok: true, rev: row.rev });
  } catch {
    return NextResponse.json({ error: 'db-error' }, { status: 500 });
  }
}
