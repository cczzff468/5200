/**
 * 淘宝 AI 内容层（第十六轮）：
 * - 刷新更新内容走「设置 › API 配置」用户配置好的 OpenAI 兼容模型（/api/tb-feed，未配置/失败
 *   服务端内置模型兜底），生成商品注册进 taobao-data 的 AI 注册表 → 详情/下单链路无感命中；
 * - 关键需求「刷新保存原来更新的内容」：AI 批次 + 前插列表全部持久化到 IndexedDB kv
 *   （按 tb uid 隔离），页面刷新 / 重开 App 后原样恢复，旧内容与历史批次永不消失；
 * - 客服聊天消息同层持久化（tb-chat:<uid>:<shopId>），未读独立计数。
 */
import { kvGet, kvSet } from './idb-kv';
import {
  tbImg,
  tbRegisterAiProducts,
  tbAiProductsAll,
  TB_SHOPS,
  type TbProduct,
  type TbSkuGroup,
} from './taobao-data';

// ---------------- kv 基础（与 taobao-store 同策略：内存同步读 + 异步写穿） ----------------

function load<T>(key: string, def: T): T {
  const v = kvGet(key);
  if (v == null) return def;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return def;
  }
}

function save(key: string, v: unknown): void {
  kvSet(key, JSON.stringify(v));
}

// ---------------- AI 商品持久化 ----------------

const aiProductsKey = (uid: string) => `tb-ai-products:${uid}`;
/** 上限：防止无限膨胀（旧的先淘汰） */
const AI_PRODUCT_CAP = 160;

/** 启动恢复：把持久化的 AI 商品重新注册进运行时注册表（TaobaoApp 启动时调用） */
export function tbRestoreAiProducts(uid: string): void {
  const list = load<TbProduct[]>(aiProductsKey(uid), []);
  const ok = list.filter((p) => p && typeof p.id === 'string' && p.id.startsWith('ai-') && typeof p.title === 'string');
  if (ok.length > 0) tbRegisterAiProducts(ok);
}

/** 注册并持久化 AI 商品批次（新批次在前，超上限淘汰尾部） */
export function tbPersistAiProducts(uid: string, batch: TbProduct[]): void {
  const prev = load<TbProduct[]>(aiProductsKey(uid), []);
  const ids = new Set(prev.map((p) => p.id));
  const fresh = batch.filter((p) => !ids.has(p.id));
  const next = [...fresh, ...prev].slice(0, AI_PRODUCT_CAP);
  save(aiProductsKey(uid), next);
  tbRegisterAiProducts(batch);
}

// ---------------- 信息流前插状态持久化（「刷新保存原来更新的内容」核心） ----------------

/** 前插条目：pid 经 productById 解析（含 AI 注册表），v 图变体，k 稳定 key */
export interface TbFeedTop {
  pid: string;
  v: number;
  k: string;
}

/** 某个信息流表面（首页各 tab/视频/补贴/秒杀/飞猪）的前插状态 */
export interface TbFeedState {
  /** 刷新前插的条目（最新批在最前，顶部下拉产生） */
  tops: TbFeedTop[];
  /** 底部追加的条目（最新批在最后，滑到底部拉一拉产生，Task 45） */
  tails?: TbFeedTop[];
  /** 本地兜底批次数（首页上滑分页恢复用） */
  batch?: number;
  /** 本地兜底刷新 key（首页历史批次恢复用） */
  refreshKey?: number;
}

const feedKey = (uid: string, surface: string) => `tb-feed:${uid}:${surface}`;

export function tbFeedLoad(uid: string, surface: string): TbFeedState | null {
  const s = load<TbFeedState | null>(feedKey(uid, surface), null);
  if (!s || !Array.isArray(s.tops)) return null;
  return s;
}

export function tbFeedSave(uid: string, surface: string, s: TbFeedState): void {
  save(feedKey(uid, surface), { ...s, tops: s.tops.slice(0, 120), tails: (s.tails ?? []).slice(-80) });
}

// ---------------- 频道页辅助持久化（确定性批次 / AI 电影等非商品数据） ----------------

const feedAuxKey = (uid: string, surface: string, key: string) => `tb-feed-aux:${uid}:${surface}:${key}`;

export function tbFeedAuxLoad<T>(uid: string, surface: string, key: string): T | null {
  return load<T | null>(feedAuxKey(uid, surface, key), null);
}

export function tbFeedAuxSave<T>(uid: string, surface: string, key: string, v: T): void {
  save(feedAuxKey(uid, surface, key), v);
}

// ---------------- /api/tb-feed 调用 + AI 商品构建 ----------------

/** /api/tb-feed 返回的原始条目（宽松结构，逐字段收窄） */
export interface TbFeedRaw {
  title?: unknown;
  price?: unknown;
  origPrice?: unknown;
  sales?: unknown;
  tag?: unknown;
  tags?: unknown;
  promo?: unknown;
  foot?: unknown;
  sub?: unknown;
  unit?: unknown;
  reviews?: unknown;
  /** 秒杀：已抢百分比（30~90） */
  grabbed?: unknown;
  /** 秒杀/补贴：直降文案（直降43元） */
  off?: unknown;
  /** 电影：制式角标（IMAX 2D / 2D / 3D） */
  badge?: unknown;
  /** 电影：主演/导演 */
  actors?: unknown;
  /** 演出：场馆/城市/档期/已售 */
  venue?: unknown;
  city?: unknown;
  dateRange?: unknown;
  hot?: unknown;
  /** 演唱会：艺人/巡演 */
  artist?: unknown;
  tour?: unknown;
  /** 周边所属影片/品类 */
  from?: unknown;
  kind?: unknown;
  /** 即将上映：想看人数（万人） */
  wantTo?: unknown;
}

export type TbFeedSurface =
  | 'home'
  | 'video'
  | 'subsidy'
  | 'seckill'
  | 'fliggy'
  | 'movie'
  /** 我的淘宝·猜你喜欢（Task 44：与首页同构的 AI 前插 + 持久化） */
  | 'me'
  /** 淘票票·喜剧脱口秀演出 */
  | 'standup'
  /** 淘票票·演唱会 */
  | 'concert'
  /** 淘票票·周边商城商品 */
  | 'merch'
  /** 淘票票·即将上映新片 */
  | 'movieUp';

/** tag → 分类（图链品类词与 TB_CATS 对齐） */
function catOf(tag: string): TbProduct['cat'] {
  if (['jacket', 'jeans', 'dress', 'sneakers', 'backpack', 'coat', 'shoes', 'hat', 'shirt'].includes(tag)) return 'fashion';
  if (['lipstick', 'perfume', 'skincare', 'makeup', 'foundation'].includes(tag)) return 'beauty';
  if (['snacks', 'fruit', 'tea', 'food'].includes(tag)) return 'food';
  if (['books', 'book'].includes(tag)) return 'book';
  if (['phone', 'earbuds', 'laptop', 'watch', 'tablet', 'camera', 'keyboard', 'powerbank', 'speaker'].includes(tag)) return 'digital';
  return 'home';
}

/** tag → 店铺（优先同 tag 店铺，兜底轮转；保证 AI 商品都挂在真实店铺下，店铺页/售后链路可用） */
function shopIdOf(tag: string, seed: number): string {
  const hit = TB_SHOPS.find((s) => s.tag === tag);
  if (hit) return hit.id;
  const home = TB_SHOPS.find((s) => s.tag === 'sofa');
  return TB_SHOPS[seed % TB_SHOPS.length]?.id ?? home?.id ?? TB_SHOPS[0].id;
}

/** 颜色组（与 taobao-data colorGroup 同构；AI 商品通用规格） */
function aiColorGroup(tag: string, names: string[]): TbSkuGroup {
  return {
    name: '颜色分类',
    options: names.map((n, i) => ({ label: n, img: tbImg(tag, 120, 120, i % 4) })),
  };
}

const AI_COLOR_NAMES = ['优雅黑', '云雾白', '雾霾蓝', '樱花粉'];

/** AI 原始条目 → TbProduct（可进详情/购物车/下单全链路） */
export function tbBuildAiProduct(raw: TbFeedRaw, id: string): TbProduct | null {
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 60) : '';
  if (!title) return null;
  const price = Math.round((typeof raw.price === 'number' && Number.isFinite(raw.price) && raw.price > 0 ? raw.price : 29.9) * 100) / 100;
  const originPriceRaw = typeof raw.origPrice === 'number' && Number.isFinite(raw.origPrice) ? raw.origPrice : 0;
  const originPrice = originPriceRaw > price ? Math.round(originPriceRaw * 100) / 100 : undefined;
  const sales = typeof raw.sales === 'number' && Number.isFinite(raw.sales) && raw.sales >= 0 ? Math.floor(raw.sales) : 2000;
  const tag = typeof raw.tag === 'string' && /^[a-z][a-z0-9-]{1,20}$/.test(raw.tag) ? raw.tag : 'mug';
  const promo = typeof raw.promo === 'string' && raw.promo.trim() ? raw.promo.trim().slice(0, 6) : undefined;
  const serviceTags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim().slice(0, 8)).slice(0, 3)
    : ['退货宝', '7天无理由'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return {
    id,
    title,
    price,
    originPrice,
    sales,
    shopId: shopIdOf(tag, h),
    cat: catOf(tag),
    tag,
    freight: 0,
    tags: serviceTags.length > 0 ? serviceTags : ['退货宝'],
    skus: [
      aiColorGroup(tag, AI_COLOR_NAMES),
      { name: '规格', options: [{ label: '官方标配' }, { label: '升级款', priceDelta: Math.max(10, Math.round(price * 0.15)) }] },
    ],
    promo,
  };
}

export interface TbAiFetchArgs {
  uid: string;
  surface: TbFeedSurface;
  tab?: string;
  /** 排除名单（已展示标题），保证出新内容 */
  exclude: string[];
  count?: number;
  config: { baseUrl: string; apiKey: string; model: string; temperature: number; maxTokens: number };
}

export interface TbAiBatchResult {
  products: TbProduct[];
  /** 附加原字段（补贴/秒杀/飞猪展示用） */
  raws: Array<TbFeedRaw & { title: string; tag: string }>;
}

/** 调 /api/tb-feed 拿一批 AI 商品：注册 + 持久化；失败返回 null（调用方走本地兜底） */
export async function tbFetchAiBatch(args: TbAiFetchArgs): Promise<TbAiBatchResult | null> {
  try {
    const res = await fetch('/api/tb-feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: args.config,
        surface: args.surface,
        tab: args.tab ?? null,
        exclude: args.exclude.slice(0, 80),
        count: args.count ?? 8,
        nonce: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; items?: TbFeedRaw[] } | null;
    if (!res.ok || !data || data.ok !== true || !Array.isArray(data.items) || data.items.length === 0) return null;
    const products: TbProduct[] = [];
    const raws: TbAiBatchResult['raws'] = [];
    const nonce = Date.now().toString(36);
    data.items.forEach((raw, i) => {
      const id = `ai-${args.surface}-${nonce}-${i}`;
      const p = tbBuildAiProduct(raw, id);
      if (p) {
        products.push(p);
        raws.push({ ...raw, title: p.title, tag: p.tag });
      }
    });
    if (products.length === 0) return null;
    tbPersistAiProducts(args.uid, products);
    return { products, raws };
  } catch {
    return null;
  }
}

// ---------------- 客服聊天消息持久化 ----------------

export interface TbCsMsg {
  id: string;
  /** user 买家 / bot 商家客服 */
  role: 'user' | 'bot';
  text?: string;
  /** 商品卡 / 订单卡（聊天里的宝贝与订单卡片消息） */
  card?: { type: 'product'; pid: string } | { type: 'order'; orderId: string };
  at: number;
}

const chatKey = (uid: string, shopId: string) => `tb-chat:${uid}:${shopId}`;

export function tbChatLoad(uid: string, shopId: string): TbCsMsg[] {
  return load<TbCsMsg[]>(chatKey(uid, shopId), []).sort((a, b) => a.at - b.at);
}

export function tbChatSave(uid: string, shopId: string, msgs: TbCsMsg[]): void {
  save(chatKey(uid, shopId), msgs.slice(-200));
}

/** 追加消息（时间戳自增保证顺序） */
export function tbChatAppend(uid: string, shopId: string, msgs: Array<Omit<TbCsMsg, 'id' | 'at'>>): TbCsMsg[] {
  const list = tbChatLoad(uid, shopId);
  let at = Date.now();
  for (const m of msgs) {
    while (list.length > 0 && at <= list[list.length - 1].at) at += 1;
    const full: TbCsMsg = { ...m, id: `cs${at.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, at };
    list.push(full);
    at += 1;
  }
  tbChatSave(uid, shopId, list);
  return list;
}

/** 最后一条消息（会话列表预览用） */
export function tbChatLast(uid: string, shopId: string): TbCsMsg | null {
  const list = tbChatLoad(uid, shopId);
  return list.length > 0 ? list[list.length - 1] : null;
}

// ---------------- 聊天未读（独立于系统消息 tb-msgs 的未读） ----------------

const chatUnreadKey = (uid: string, shopId: string) => `tb-chat-unread:${uid}:${shopId}`;

export function tbChatUnread(uid: string, shopId: string): number {
  return load<number>(chatUnreadKey(uid, shopId), 0);
}

export function tbChatAddUnread(uid: string, shopId: string, n = 1): void {
  save(chatUnreadKey(uid, shopId), tbChatUnread(uid, shopId) + n);
}

export function tbChatClearUnread(uid: string, shopId: string): void {
  save(chatUnreadKey(uid, shopId), 0);
}

/** 全部店铺聊天未读总数（底部消息角标 = 系统消息未读 + 聊天未读） */
export function tbChatTotalUnread(uid: string): number {
  // 店铺集合 = 有聊天记录的店铺（扫描键太贵，维护一份会话索引）
  const shops = load<string[]>(`tb-chat-shops:${uid}`, []);
  return shops.reduce((sum, s) => sum + tbChatUnread(uid, s), 0);
}

/** 记住有聊天记录的店铺（首条消息时登记，供未读总数与会话列表用） */
export function tbChatRememberShop(uid: string, shopId: string): void {
  const shops = load<string[]>(`tb-chat-shops:${uid}`, []);
  if (!shops.includes(shopId)) {
    save(`tb-chat-shops:${uid}`, [...shops, shopId].slice(-40));
  }
}

/** 有聊天记录的店铺列表（会话列表合并用，按最近消息时间排序返回） */
export function tbChatShops(uid: string): Array<{ shopId: string; lastAt: number }> {
  const shops = load<string[]>(`tb-chat-shops:${uid}`, []);
  return shops
    .map((shopId) => ({ shopId, lastAt: tbChatLast(uid, shopId)?.at ?? 0 }))
    .filter((s) => s.lastAt > 0)
    .sort((a, b) => b.lastAt - a.lastAt);
}
