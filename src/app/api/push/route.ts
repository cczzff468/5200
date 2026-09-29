import { NextResponse } from 'next/server';
import webpush from 'web-push';

/**
 * Web Push 订阅管理（退出网页后也收「每条消息一条系统通知」）：
 * - GET：返回 VAPID 公钥（客户端订阅用；密钥首次访问时生成并持久化到 .data/vapid.json）；
 * - POST：保存浏览器推送订阅（.data/push-subs.json，按 endpoint 去重）；
 * - DELETE：移除订阅（浏览器退订时调用）。
 * 订阅在服务端为尽力而为的增强能力：不支持 Service Worker / Push 的环境（如预览面板 iframe）
 * 注册失败静默跳过，应用内灵动岛弹窗与页面隐藏时的 Web Notification 不受影响。
 *
 * 鉴权（#13，可选共享 token）：配置了环境变量 PUSH_SHARED_TOKEN 时，GET/POST/DELETE 均校验
 * 请求头 x-shared-token 必须等于该值，否则 401（防公网部署上被第三方任意写入/清洗订阅表、
 * 探测 VAPID 公钥）；未配置（本地沙箱默认）行为完全不变。前端订阅链路（push-client.ts）
 * 同源自带凭据场景无需改造：本地/未配置 token 时零影响。
 */

export const runtime = 'nodejs';

/** 可选共享 token（环境变量未配置 = 不启用鉴权，历史行为不变） */
const TOKEN = process.env.PUSH_SHARED_TOKEN;

/** 共享 token 校验：未配置恒通过；已配置时请求头 x-shared-token 必须精确匹配 */
function tokenOk(req: Request): boolean {
  if (!TOKEN) return true;
  try {
    return req.headers.get('x-shared-token') === TOKEN;
  } catch {
    return false;
  }
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

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

/**
 * VAPID 密钥加载（模块级单飞）：
 * vapid.json 缺失时并发首个 GET 只生成一次密钥 —— 原实现「读→生成→写」无并发保护，
 * 两个客户端同时 GET 会各自 generateVAPIDKeys 先后写盘互相覆盖，
 * 用旧公钥订阅的客户端离线推送从此 401/403。进程内缓存 in-flight Promise；
 * 写盘前再读一次盘上是否已有密钥（双保险，防多进程窗口期覆盖）。
 * 文件级原子性不强求（单进程 Next 服务够用）。
 */
let vapidInflight: Promise<{ publicKey: string; privateKey: string }> | null = null;

async function getVapid(): Promise<{ publicKey: string; privateKey: string }> {
  if (!vapidInflight) {
    vapidInflight = (async () => {
      const saved = await readJson<{ publicKey?: string; privateKey?: string }>('vapid.json', {});
      if (saved.publicKey && saved.privateKey) {
        return { publicKey: saved.publicKey, privateKey: saved.privateKey };
      }
      // 双保险：生成前再读一次（另一个进程 / 上次启动可能刚好已写入）
      const recheck = await readJson<{ publicKey?: string; privateKey?: string }>('vapid.json', {});
      if (recheck.publicKey && recheck.privateKey) {
        return { publicKey: recheck.publicKey, privateKey: recheck.privateKey };
      }
      const keys = webpush.generateVAPIDKeys();
      await writeJson('vapid.json', keys);
      return { publicKey: keys.publicKey, privateKey: keys.privateKey };
    })().catch((err: unknown) => {
      vapidInflight = null; // 失败不缓存，下次请求重试
      throw err;
    });
  }
  return vapidInflight;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!tokenOk(req)) return unauthorized();
  try {
    const { publicKey } = await getVapid();
    return NextResponse.json({ publicKey });
  } catch {
    return NextResponse.json({ error: '推送初始化失败' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!tokenOk(req)) return unauthorized();
  const body = (await req.json().catch(() => null)) as {
    subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  } | null;
  const endpoint = body?.subscription?.endpoint;
  // 最小形状校验（#56）：endpoint 必须为非空字符串，且 keys.p256dh/auth 必须为字符串——
  // web-push 协议必需这两项作为加密材料，缺失会让发送时 422 直接报错且占用订阅槽位。
  if (
    typeof endpoint !== 'string' ||
    !endpoint ||
    typeof body?.subscription?.keys?.p256dh !== 'string' ||
    !body.subscription.keys.p256dh ||
    typeof body?.subscription?.keys?.auth !== 'string' ||
    !body.subscription.keys.auth
  ) {
    return NextResponse.json({ error: 'subscription 无效' }, { status: 400 });
  }
  // 串行化读-改-写（#55）：两个并发 POST 各自 read→filter→write 后写覆盖前写、
  // 订阅会丢失。用模块级 in-flight Promise 链把所有 POST/DELETE 排队串行执行。
  const result = await runSubsMutation(async () => {
    const subs = await readJson<SubRec[]>('push-subs.json', []);
    const next = Array.isArray(subs) ? subs.filter((s) => s && s.endpoint !== endpoint) : [];
    next.push(body!.subscription as SubRec);
    await writeJson('push-subs.json', next.slice(-50));
    return NextResponse.json({ ok: true });
  });
  return result;
}

export async function DELETE(req: Request): Promise<NextResponse> {
  if (!tokenOk(req)) return unauthorized();
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== 'string') return NextResponse.json({ error: 'endpoint 无效' }, { status: 400 });
  // 与 POST 同一 in-flight 链（#55），避免 DELETE 与 POST 互撞。
  const result = await runSubsMutation(async () => {
    const subs = await readJson<SubRec[]>('push-subs.json', []);
    await writeJson('push-subs.json', subs.filter((s) => s && s.endpoint !== body!.endpoint));
    return NextResponse.json({ ok: true });
  });
  return result;
}

/**
 * 订阅列表读-改-写单飞链（#55）：
 * 任意一次 POST/DELETE 都先 await 上一笔完成再开始，确保 read→write 之间无并发窗口。
 * subsInflight 持久化为「完成时清空」的 Promise<void>：每次新调用接到上一笔的尾巴后
 * 立即替换为本笔，链式串行；任务内异常被吞成 500 响应并解链，不影响后续请求。
 */
let subsInflight: Promise<void> = Promise.resolve();

function runSubsMutation(task: () => Promise<NextResponse>): Promise<NextResponse> {
  const curr = subsInflight.then(task, () => task()).then(
    (r) => r,
    () => NextResponse.json({ error: '订阅存储失败' }, { status: 500 }),
  );
  subsInflight = curr.then(
    () => undefined,
    () => undefined,
  );
  return curr;
}
