import { NextResponse } from 'next/server';
import webpush from 'web-push';

/**
 * 退出网页后续复（服务端接力）：
 *
 * 用户关闭网页（pagehide）时，客户端用 sendBeacon 把「还没跑完的会话」上报到本端点：
 * - mode='generate'：该会话的流式请求还没 finalize（AI 回复没拿到/没拿全）→ 服务端用同一套
 *   生成链路（内部自调 /api/chat，含上游代理 + SDK 兜底）把回复生成出来；
 * - mode='deliver'：流已 finalize 但逐条投递（打字节奏）还没落盘完 → 上报现成的消息文本。
 *
 * 两种方式最终都写入本会话的 pending 队列（内存态），并尽力给已订阅的浏览器发 Web Push
 * （每条消息一条系统通知；页面已关、浏览器还开着时也能弹）。
 * 用户重新打开网页后：聊天页挂载/回前台时 GET ?sessionKey=… 拉取并走各 App 原有投递管线
 * （逐条落盘 + 灵动岛弹窗 + 未读角标）；会话列表页 GET ?peekAll=1 拉各会话条数点亮未读。
 *
 * pending 队列与订阅都存内存/本地文件（.data/），服务重启清空 —— 接力是尽力而为的增强能力。
 */

export const runtime = 'nodejs';

interface PendingItem {
  id: string;
  /** 消息文本数组（generate 模式 = [完整回复原文]；deliver 模式 = 逐条未投递消息文本） */
  texts: string[];
  /** true = texts[0] 是一次完整回复原文（可能含 &&& 分段/动作标记，客户端按单条管线解析） */
  single: boolean;
  /** 会话显示名（客户端 beacon 上报的联系人名；空则推送标题用 App 名） */
  title: string;
  createdAt: number;
}

/** 会话键 → 待拉取消息（内存态；服务重启清空） */
const pending = new Map<string, PendingItem[]>();
/** 同一会话同时只跑一次服务端生成（防重复 beacon 叠加重複回复） */
const generating = new Set<string>();

const MAX_SESSIONS = 200;
const MAX_ITEMS_PER_SESSION = 20;
const MAX_TEXTS = 20;
const TEXT_MAX = 4000;

function appDefaultName(sessionKey: string): string {
  if (sessionKey.startsWith('wx:group:')) return '微信群聊';
  if (sessionKey.startsWith('wx:')) return '微信';
  if (sessionKey.startsWith('qq:group:')) return 'QQ群聊';
  if (sessionKey.startsWith('qq:')) return 'QQ';
  return '信息';
}

function enqueue(sessionKey: string, texts: string[], single: boolean, title: string): PendingItem {
  const item: PendingItem = {
    id: `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    texts,
    single,
    title,
    createdAt: Date.now(),
  };
  const arr = pending.get(sessionKey) ?? [];
  arr.push(item);
  if (arr.length > MAX_ITEMS_PER_SESSION) arr.splice(0, arr.length - MAX_ITEMS_PER_SESSION);
  pending.set(sessionKey, arr);
  if (pending.size > MAX_SESSIONS) {
    const first = pending.keys().next().value;
    if (first) pending.delete(first);
  }
  void pushToSubscribers(sessionKey, texts, title);
  return item;
}

/* ---------------- Web Push（每条消息一条系统通知；失败静默） ---------------- */

interface PushSubLike {
  endpoint?: unknown;
  [k: string]: unknown;
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const { readFile } = await import('fs/promises');
    const path = await import('path');
    const raw = await readFile(path.join(process.cwd(), '.data', file), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file: string, value: unknown): Promise<void> {
  try {
    const { writeFile, mkdir } = await import('fs/promises');
    const path = await import('path');
    await mkdir(path.join(process.cwd(), '.data'), { recursive: true });
    await writeFile(path.join(process.cwd(), '.data', file), JSON.stringify(value), 'utf8');
  } catch {
    // 持久化失败不阻断（推送为尽力而为）
  }
}

async function getVapid(): Promise<{ publicKey: string; privateKey: string } | null> {
  try {
    const saved = await readJsonFile<{ publicKey?: string; privateKey?: string }>('vapid.json', {});
    if (saved.publicKey && saved.privateKey) return { publicKey: saved.publicKey, privateKey: saved.privateKey };
    const keys = webpush.generateVAPIDKeys();
    await writeJsonFile('vapid.json', keys);
    return { publicKey: keys.publicKey, privateKey: keys.privateKey };
  } catch {
    return null;
  }
}

async function pushToSubscribers(sessionKey: string, texts: string[], title: string): Promise<void> {
  try {
    const vapid = await getVapid();
    if (!vapid) return;
    const subs = await readJsonFile<PushSubLike[]>('push-subs.json', []);
    if (!Array.isArray(subs) || subs.length === 0) return;
    const notifyTitle = title || appDefaultName(sessionKey);
    const alive: PushSubLike[] = [];
    await Promise.all(
      subs.map(async (sub) => {
        try {
          if (typeof sub.endpoint !== 'string') return;
          alive.push(sub);
          // 每条消息一条系统通知（tag 唯一 → 不互相替换）
          for (let i = 0; i < texts.length; i++) {
            const preview = texts[i].replace(/\s+/g, ' ').trim().slice(0, 120);
            await webpush.sendNotification(
              sub as unknown as Parameters<typeof webpush.sendNotification>[0],
              JSON.stringify({ title: notifyTitle, body: preview, tag: `bg-${Date.now().toString(36)}-${i}`, url: '/' }),
              { vapidDetails: { subject: 'mailto:bg-reply@ios-phone.local', publicKey: vapid.publicKey, privateKey: vapid.privateKey } },
            );
          }
        } catch (err) {
          const e = err as { statusCode?: number };
          // 404/410 = 订阅已失效 → 剔除
          if (e?.statusCode !== 404 && e?.statusCode !== 410) alive.push(sub);
        }
      }),
    );
    await writeJsonFile('push-subs.json', alive);
  } catch {
    // 推送失败不影响 pending 队列（重开网页仍能拉到）
  }
}

/* ---------------- 服务端生成（复用 /api/chat 全链路：上游代理 + SDK 兜底） ---------------- */

interface BgPayload {
  messages?: unknown;
  config?: unknown;
}

async function generateAndEnqueue(sessionKey: string, payload: BgPayload, title: string): Promise<void> {
  try {
    const messages = Array.isArray(payload.messages) ? payload.messages : null;
    if (!messages) {
      enqueue(sessionKey, ['〔对方暂时没有回复，请稍后再试〕'], true, title);
      return;
    }
    const port = process.env.PORT || '3000';
    const body: Record<string, unknown> = { messages };
    if (payload.config && typeof payload.config === 'object') body.config = payload.config;
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = res.ok ? (await res.text()).trim() : '';
    enqueue(sessionKey, [text || '〔对方暂时没有回复，请稍后再试〕'], true, title);
  } catch {
    enqueue(sessionKey, ['〔对方暂时没有回复，请稍后再试〕'], true, title);
  } finally {
    generating.delete(sessionKey);
  }
}

/* ---------------- 路由 ---------------- */

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as
    | {
        mode?: unknown;
        sessionKey?: unknown;
        payload?: BgPayload;
        texts?: unknown;
        single?: unknown;
        meta?: { title?: unknown; app?: unknown };
      }
    | null;
  if (!body || typeof body.sessionKey !== 'string' || !body.sessionKey.trim() || body.sessionKey.length > 160) {
    return NextResponse.json({ error: 'sessionKey 无效' }, { status: 400 });
  }
  const sessionKey = body.sessionKey;
  const title = typeof body.meta?.title === 'string' ? body.meta.title.slice(0, 60) : '';

  if (body.mode === 'generate') {
    // 流式没跑完就关页：服务端接管生成。同一会话进行中不重复接（防双回复）
    if (generating.has(sessionKey)) return NextResponse.json({ ok: true, scheduled: false });
    const messages = Array.isArray(body.payload?.messages) ? body.payload?.messages : null;
    if (!messages || messages.length === 0) return NextResponse.json({ error: 'payload 无效' }, { status: 400 });
    generating.add(sessionKey);
    void generateAndEnqueue(sessionKey, { messages, config: body.payload?.config }, title);
    return NextResponse.json({ ok: true, scheduled: true });
  }

  if (body.mode === 'deliver') {
    // 投递没落盘完就关页：现成消息文本直接入队（客户端拉取后按普通消息逐条投递）
    const texts = Array.isArray(body.texts)
      ? body.texts
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .slice(0, MAX_TEXTS)
          .map((t) => t.slice(0, TEXT_MAX))
      : [];
    if (texts.length === 0) return NextResponse.json({ ok: true, queued: 0 });
    const item = enqueue(sessionKey, texts, body.single === true, title);
    return NextResponse.json({ ok: true, queued: item.texts.length });
  }

  return NextResponse.json({ error: 'mode 无效' }, { status: 400 });
}

export async function GET(req: Request): Promise<NextResponse> {
  const sp = new URL(req.url).searchParams;

  // 会话列表角标查询：各会话待拉取消息条数（不清除；客户端对已提示过的条目去重）
  if (sp.get('peekAll')) {
    const counts: Record<string, number> = {};
    pending.forEach((arr, key) => {
      const n = arr.reduce((s, it) => s + it.texts.length, 0);
      if (n > 0) counts[key] = n;
    });
    return NextResponse.json({ counts });
  }

  const sessionKey = sp.get('sessionKey');
  if (!sessionKey) return NextResponse.json({ error: 'sessionKey 必填' }, { status: 400 });
  const items = pending.get(sessionKey) ?? [];
  pending.delete(sessionKey);
  return NextResponse.json({ items });
}
