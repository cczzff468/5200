/**
 * 淘宝 App 数据层（本地优先，与美团/微信/QQ 同架构）：
 * - 所有淘宝数据存 IndexedDB kv（idb-kv 内存同步读 + 异步写穿），键按登录账号隔离：
 *   登录身份 uid = `wx:<联系人id>` / `qq:<联系人id>` / `ph:<手机号>`，淘宝数据键全部带 uid
 *   （`tb-orders:<uid>` 等）——换账号登录互不串数据（需求「淘宝数据按账号隔离」）；
 * - 登录态存 localStorage `tb-session`（重启后仍保留）；
 * - 订单状态机（确定性时间戳推进，MeituanOrderWatcher 同款思路：全局 tick + 打开 App catch-up，
 *   重启不丢进度）：待付款(30min 超时自动取消) → 支付 → 待发货(SHIP_DELAY 自动发货) →
 *   待收货(物流节点每 TRACK_STEP 推进：已揽收→运输中→派送中→已到驿站) → 确认收货 → 已完成；
 *   待付款可取消 → 已取消；待发货/待收货/已完成可退款 → 退款成功原路退回（taobao-pay.ts）→ 已取消；
 * - 支付不在这里：taobao-pay.ts 动态 import 微信/QQ 钱包模块（支付复用现有 QQ、微信逻辑）。
 */
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { accLs, getActiveAccountFor } from './accounts';
import { productById, shopById, tbImg, tbReviewsOf, type TbProduct } from './taobao-data';

// ---------------- 登录态 ----------------

export interface TbSession {
  /** 登录方式：QQ 一键 / 微信一键 / 手机号 */
  idp: 'wx' | 'qq' | 'phone';
  /** wx/qq 登录：联系人记录 id */
  contactId?: string;
  phone?: string;
  /** 'oneclick' 一键授权（跟随微信/QQ App 登录态）/ 'password' 账号密码独立会话 */
  via?: 'oneclick' | 'password';
  name: string;
  avatar: string | null;
  loginAt: number;
}

const LS_SESSION = 'tb-session';

export function tbUidOf(s: TbSession): string {
  if (s.idp === 'phone') return `ph:${s.phone ?? ''}`;
  return `${s.idp}:${s.contactId ?? ''}`;
}

export function tbGetSession(): TbSession | null {
  try {
    const raw = window.localStorage.getItem(LS_SESSION);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<TbSession>;
    if (!p || typeof p !== 'object' || (p.idp !== 'wx' && p.idp !== 'qq' && p.idp !== 'phone')) return null;
    if (typeof p.name !== 'string' || !p.name) return null;
    return {
      idp: p.idp,
      contactId: typeof p.contactId === 'string' ? p.contactId : undefined,
      phone: typeof p.phone === 'string' ? p.phone : undefined,
      via: p.via === 'password' || p.via === 'oneclick' ? p.via : undefined,
      name: p.name,
      avatar: typeof p.avatar === 'string' ? p.avatar : null,
      loginAt: typeof p.loginAt === 'number' ? p.loginAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function tbSetSession(s: TbSession | null): void {
  try {
    if (s) window.localStorage.setItem(LS_SESSION, JSON.stringify(s));
    else window.localStorage.removeItem(LS_SESSION);
  } catch {
    /* 存储失败静默（隐私模式等） */
  }
}

/** 一键登录前提：微信/QQ App 在线（与美团 mtIdpLoggedIn 同口径：会话键 `wx-session-user-id` / `qq-session-user-id` 账号作用域） */
export function tbIdpLoggedIn(idp: 'wx' | 'qq'): boolean {
  try {
    return window.localStorage.getItem(accLs(`${idp}-session-user-id`, idp)) !== null;
  } catch {
    return false;
  }
}

/** 一键登录身份解析（与美团 mtResolveIdpIdentity 同源：会话指针 → 账号槽位档案 → 虚拟账号兜底） */
export async function tbResolveIdpIdentity(idp: 'wx' | 'qq'): Promise<{ contactId: string; name: string; avatar: string | null }> {
  try {
    const { listContacts } = await import('./contacts-store');
    const acc = getActiveAccountFor(idp);
    const all = await listContacts();
    let me: (typeof all)[number] | undefined;
    const sid = window.localStorage.getItem(accLs(`${idp}-session-user-id`, idp)) ?? '';
    if (sid) me = all.find((c) => c.id === sid && c.kind === 'user');
    if (!me) {
      me = acc.kind === 'main' ? all.find((c) => c.kind === 'user' && !c.altOf) : all.find((c) => c.altOf === acc.id);
    }
    if (me) return { contactId: me.id, name: me.name || (idp === 'wx' ? '微信用户' : 'QQ用户'), avatar: me.avatar ?? null };
  } catch {
    /* 联系人库异常 → 走虚拟账号兜底 */
  }
  return { contactId: '', name: idp === 'wx' ? '微信用户' : 'QQ用户', avatar: null };
}

// ---------------- kv 基础 ----------------

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

/** 清空某账号全部淘宝数据（退出登录不清理，重登数据还在；仅「设置-清除淘宝数据」用） */
export function tbWipeUid(uid: string): void {
  for (const base of ['tb-cart', 'tb-favs', 'tb-foots', 'tb-addrs', 'tb-coupons', 'tb-orders', 'tb-msgs', 'tb-shopfollow', 'tb-search']) save(`${base}:${uid}`, []);
  save(`tb-curaddr:${uid}`, '');
}

// ---------------- 购物车 ----------------

export interface TbCartItem {
  pid: string;
  /** 已选规格（组名 → 选项） */
  sku: Record<string, string>;
  qty: number;
  checked: boolean;
  at: number;
}

const cartKey = (uid: string) => `tb-cart:${uid}`;

export function tbLoadCart(uid: string): TbCartItem[] {
  return load<TbCartItem[]>(cartKey(uid), []);
}

export function tbSaveCart(uid: string, v: TbCartItem[]): void {
  save(cartKey(uid), v);
}

/** 加入购物车（同商品同规格合并数量；skuKey = 组名:选项 用 | 串接） */
export function tbAddToCart(uid: string, pid: string, sku: Record<string, string>, qty: number): void {
  const list = tbLoadCart(uid);
  const sig = tbSkuSig(sku);
  const hit = list.find((c) => c.pid === pid && tbSkuSig(c.sku) === sig);
  if (hit) hit.qty = Math.min(99, hit.qty + qty);
  else list.push({ pid, sku, qty: Math.min(99, Math.max(1, qty)), checked: true, at: Date.now() });
  save(cartKey(uid), list);
}

/** 规格签名（合并/展示用：颜色分类:蓝色|尺码:L） */
export function tbSkuSig(sku: Record<string, string>): string {
  return Object.keys(sku)
    .sort()
    .map((k) => `${k}:${sku[k]}`)
    .join('|');
}

export function tbCartQty(uid: string): number {
  return tbLoadCart(uid).reduce((n, c) => n + c.qty, 0);
}

export function tbUpdateCartItem(uid: string, pid: string, sig: string, patch: { qty?: number; checked?: boolean }): void {
  const list = tbLoadCart(uid);
  const hit = list.find((c) => c.pid === pid && tbSkuSig(c.sku) === sig);
  if (!hit) return;
  if (patch.qty !== undefined) {
    // 需求：数量减到 0 自动移除
    if (patch.qty <= 0) {
      save(cartKey(uid), list.filter((c) => c !== hit));
      return;
    }
    hit.qty = Math.min(99, patch.qty);
  }
  if (patch.checked !== undefined) hit.checked = patch.checked;
  save(cartKey(uid), list);
}

export function tbRemoveCartItems(uid: string, keys: { pid: string; sig: string }[]): void {
  const set = new Set(keys.map((k) => `${k.pid}|${k.sig}`));
  save(
    cartKey(uid),
    tbLoadCart(uid).filter((c) => !set.has(`${c.pid}|${tbSkuSig(c.sku)}`))
  );
}

export function tbSetCartAllChecked(uid: string, checked: boolean): void {
  save(
    cartKey(uid),
    tbLoadCart(uid).map((c) => ({ ...c, checked }))
  );
}

/** 结算后清掉已购商品 */
export function tbClearCheckedCart(uid: string): void {
  save(
    cartKey(uid),
    tbLoadCart(uid).filter((c) => !c.checked)
  );
}

/** 店铺置顶（购物车管理模式）：该店铺全部商品移到列表最前（保序稳定） */
export function tbPinCartShop(uid: string, shopId: string, shopOf: (pid: string) => string): void {
  const list = tbLoadCart(uid);
  const head = list.filter((c) => shopOf(c.pid) === shopId);
  if (head.length === 0 || head.length === list.length) return;
  save(
    cartKey(uid),
    [...head, ...list.filter((c) => shopOf(c.pid) !== shopId)]
  );
}

// ---------------- 收藏 / 足迹 ----------------

const favKey = (uid: string) => `tb-favs:${uid}`;

export function tbLoadFavs(uid: string): string[] {
  return load<string[]>(favKey(uid), []);
}

export function tbToggleFav(uid: string, pid: string): boolean {
  const list = tbLoadFavs(uid);
  const i = list.indexOf(pid);
  if (i >= 0) {
    list.splice(i, 1);
    save(favKey(uid), list);
    return false;
  }
  list.unshift(pid);
  save(favKey(uid), list);
  return true;
}

const footKey = (uid: string) => `tb-foots:${uid}`;

export interface TbFoot {
  pid: string;
  at: number;
}

/** 浏览商品即记录足迹（同商品去重置顶，上限 60 条） */
export function tbPushFoot(uid: string, pid: string): void {
  const list = load<TbFoot[]>(footKey(uid), []).filter((f) => f.pid !== pid);
  list.unshift({ pid, at: Date.now() });
  save(footKey(uid), list.slice(0, 60));
}

export function tbLoadFoots(uid: string): TbFoot[] {
  return load<TbFoot[]>(footKey(uid), []);
}

// ---------------- 收货地址 ----------------

export interface TbAddress {
  id: string;
  name: string;
  phone: string;
  /** 省市区（简化文本） */
  region: string;
  detail: string;
  tag: string;
}

const addrKey = (uid: string) => `tb-addrs:${uid}`;
const LS_CUR_ADDR = 'tb-cur-addr';

export function tbLoadAddrs(uid: string): TbAddress[] {
  return load<TbAddress[]>(addrKey(uid), []);
}

export function tbSaveAddrs(uid: string, list: TbAddress[]): void {
  save(addrKey(uid), list);
}

export function tbCurAddrId(uid: string): string {
  try {
    return window.localStorage.getItem(`${LS_CUR_ADDR}:${uid}`) ?? '';
  } catch {
    return '';
  }
}

export function tbSetCurAddr(uid: string, id: string): void {
  try {
    window.localStorage.setItem(`${LS_CUR_ADDR}:${uid}`, id);
  } catch {
    /* 静默 */
  }
}

/** 当前地址（无记录取第一条；仍无返回 null） */
export function tbCurAddr(uid: string): TbAddress | null {
  const list = tbLoadAddrs(uid);
  const cur = list.find((a) => a.id === tbCurAddrId(uid));
  return cur ?? list[0] ?? null;
}

// ---------------- 优惠券 ----------------

export interface TbCoupon {
  id: string;
  /** 券名（消费券/服饰加补券…） */
  name: string;
  amount: number;
  /** 门槛（满 N 可用，0 无门槛） */
  min: number;
  /** 适用商品 pid（空 = 全场通用） */
  pids: string[];
  expireAt: number;
  usedAt?: number;
  /** 用在哪个订单 */
  usedOrderId?: string;
}

const couponKey = (uid: string) => `tb-coupons:${uid}`;

export function tbLoadCoupons(uid: string): TbCoupon[] {
  return load<TbCoupon[]>(couponKey(uid), []);
}

export function tbSaveCoupons(uid: string, list: TbCoupon[]): void {
  save(couponKey(uid), list);
}

/** 领取领券中心券（每张券每账号限领 1 次） */
export function tbClaimCoupon(uid: string, c: Omit<TbCoupon, 'id' | 'expireAt' | 'usedAt'>): boolean {
  const list = tbLoadCoupons(uid);
  if (list.some((x) => x.name === c.name && !x.usedAt)) return false;
  list.unshift({ ...c, id: `tbc${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`, expireAt: Date.now() + 7 * 86_400_000 });
  save(couponKey(uid), list);
  return true;
}

/** 订单可用的最优券（按抵扣最大取；门槛已满足且在有效期内且未核销） */
export function tbBestCoupon(uid: string, pid: string, amount: number): TbCoupon | null {
  const now = Date.now();
  const ok = tbLoadCoupons(uid).filter(
    (c) => !c.usedAt && c.expireAt > now && (c.pids.length === 0 || c.pids.includes(pid)) && amount >= c.min
  );
  if (ok.length === 0) return null;
  return ok.sort((a, b) => b.amount - a.amount)[0];
}

/** 核销/回滚 */
export function tbUseCoupon(uid: string, cid: string, orderId: string): void {
  const list = tbLoadCoupons(uid);
  const hit = list.find((c) => c.id === cid);
  if (hit) {
    hit.usedAt = Date.now();
    hit.usedOrderId = orderId;
    save(couponKey(uid), list);
  }
}

export function tbUnuseCoupon(uid: string, cid: string): void {
  const list = tbLoadCoupons(uid);
  const hit = list.find((c) => c.id === cid);
  if (hit) {
    delete hit.usedAt;
    delete hit.usedOrderId;
    save(couponKey(uid), list);
  }
}

/** 领券中心种子（「我的」页横滑领取 + 领券中心页领取） */
export const TB_COUPON_SEEDS: { name: string; amount: number; min: number; pids: string[] }[] = [
  { name: '消费券', amount: 10, min: 0, pids: [] },
  { name: '服饰加补券', amount: 15, min: 59, pids: [] },
  { name: '数码加补券', amount: 50, min: 199, pids: [] },
  { name: '美妆加补券', amount: 20, min: 79, pids: [] },
  { name: '食品加补券', amount: 5, min: 0, pids: [] },
];

/** 领券中心页种子（超级88领好券：截图口径 三档消费券/家电数码券/平台加补券/预告券） */
export const TB_CC_SEEDS: {
  consume: { amount: number; min: number }[];
  bonus: { amount: number; min: number };
  digital: { amount: number; min: number }[];
  extra: { name: string; amount: number; min: number; count: number; scope: string; tag: string }[];
  upcoming: { name: string; amount: number; min: number; count: number }[];
} = {
  consume: [
    { amount: 3, min: 20 },
    { amount: 20, min: 200 },
    { amount: 50, min: 500 },
  ],
  bonus: { amount: 15, min: 125 },
  digital: [
    { amount: 150, min: 1500 },
    { amount: 300, min: 3000 },
    { amount: 500, min: 5000 },
  ],
  extra: [
    { name: '超市加补券', amount: 926, min: 0, count: 10, scope: '限超市部分商品可用', tag: 'grocery' },
    { name: '母婴加补券', amount: 40, min: 0, count: 2, scope: '限母婴部分商品可用', tag: 'toy' },
  ],
  upcoming: [
    { name: '服饰加补券', amount: 100, min: 0, count: 3 },
    { name: '秋装加补券', amount: 200, min: 0, count: 4 },
    { name: '饰品加补券', amount: 165, min: 0, count: 3 },
  ],
};

// ---------------- 店铺关注 ----------------

const followKey = (uid: string) => `tb-shopfollow:${uid}`;

export function tbLoadShopFollows(uid: string): string[] {
  return load<string[]>(followKey(uid), []);
}

export function tbToggleShopFollow(uid: string, shopId: string): boolean {
  const list = tbLoadShopFollows(uid);
  const i = list.indexOf(shopId);
  if (i >= 0) {
    list.splice(i, 1);
    save(followKey(uid), list);
    return false;
  }
  list.unshift(shopId);
  save(followKey(uid), list);
  return true;
}

// ---------------- 搜索历史 ----------------

const searchKey = (uid: string) => `tb-search:${uid}`;

export function tbLoadSearchHist(uid: string): string[] {
  return load<string[]>(searchKey(uid), []);
}

export function tbPushSearchHist(uid: string, kw: string): void {
  const k = kw.trim();
  if (!k) return;
  const list = tbLoadSearchHist(uid).filter((x) => x !== k);
  list.unshift(k);
  save(searchKey(uid), list.slice(0, 12));
}

export function tbClearSearchHist(uid: string): void {
  save(searchKey(uid), []);
}

// ---------------- 订单 ----------------

export type TbOrderStatus = 'pendingPay' | 'pendingDeliver' | 'shipped' | 'completed' | 'cancelled';

/** 票务订单信息（第十三轮淘票票：电影/喜剧脱口秀/演唱会出票；无物流，直接待收货） */
export interface TbTicketInfo {
  kind: 'movie' | 'comedy' | 'concert';
  /** 影片/演出名 */
  title: string;
  /** 海报渐变色（无实体图时渲染渐变海报） */
  posterC1: string;
  posterC2: string;
  /** 版本行（国语 2D / 脱口秀 / 演唱会） */
  badge: string;
  qty: number;
  /** 影院/剧场/场馆 */
  venue: string;
  /** 影厅/场馆区域 */
  hall: string;
  /** 场次日期 YYYY-MM-DD */
  date: string;
  /** 场次日期文案（明天 10-10） */
  dateLabel: string;
  start: string;
  end: string;
  /** 座位（演唱会为票档名） */
  seats: string[];
  /** 取票号（4×4 数字分组） */
  ticketNo: string;
  unitPrice: number;
  /** 退款信息（票详情已退款态判定优先于时间） */
  refunded?: { amount: number; at: number };
}

export interface TbOrderItem {
  pid: string;
  title: string;
  img: string;
  sku: Record<string, string>;
  /** 单价（下单时快照） */
  price: number;
  qty: number;
}

export interface TbOrder {
  id: string;
  /** 数据隔离 uid（订单归属的淘宝账号） */
  uid: string;
  shopId: string;
  shopName: string;
  items: TbOrderItem[];
  itemTotal: number;
  freight: number;
  /** 优惠总额（券抵扣含在内） */
  discount: number;
  couponId?: string;
  couponAmount?: number;
  /** 实付（pendingPay 时为应付） */
  total: number;
  /** 'wx' | 'qq'（pendingPay 为空） */
  payIdp?: 'wx' | 'qq';
  payChannelLabel?: string;
  payFc?: boolean;
  payMethodId?: string;
  payFcParts?: { cardInId: string; amount: number }[];
  address?: TbAddress;
  status: TbOrderStatus;
  createdAt: number;
  paidAt?: number;
  shipAt?: number;
  completedAt?: number;
  cancelReason?: string;
  /** 物流轨迹（发货后生成，新的在后） */
  track: { text: string; at: number }[];
  /** 退款信息 */
  refund?: { amount: number; reason: string; at: number };
  /** 用户评价（已完成提交） */
  review?: { rating: number; content: string; tags: string[]; at: number };
  /** 票务信息（有值 = 票务订单：无物流、无地址，卡/详情走票务渲染） */
  ticket?: TbTicketInfo;
}

const orderKey = (uid: string) => `tb-orders:${uid}`;

export function tbLoadOrders(uid: string): TbOrder[] {
  return load<TbOrder[]>(orderKey(uid), []).sort((a, b) => b.createdAt - a.createdAt);
}

export function tbSaveOrders(uid: string, list: TbOrder[]): void {
  save(orderKey(uid), list);
}

export function tbOrderById(uid: string, id: string): TbOrder | undefined {
  return tbLoadOrders(uid).find((o) => o.id === id);
}

// 状态机参数（演示节奏：看得见推进，又不至于秒变）
export const TB_PAY_TTL = 30 * 60_000; // 待付款 30min 超时自动取消
export const TB_SHIP_DELAY = 75_000; // 支付后 75s 自动发货
export const TB_TRACK_STEP = 40_000; // 物流节点每 40s 推进
export const TB_TRACK_NODES = ['包裹已由商家揽收', '运输中：包裹已到达【杭州转运中心】', '派送中：快递员正在为您派送', '包裹已放入菜鸟驿站，请凭取件码领取'];

/** 下单（购物车结算 / 立即购买共用）：创建待付款订单 */
export function tbCreateOrder(opts: {
  uid: string;
  items: TbOrderItem[];
  address?: TbAddress;
  couponId?: string;
  couponAmount?: number;
}): TbOrder {
  const { uid, items, address, couponId, couponAmount } = opts;
  const itemTotal = Math.round(items.reduce((n, it) => n + it.price * it.qty, 0) * 100) / 100;
  const freight = items.reduce((n, it) => {
    const p = productById(it.pid);
    return n + (p?.freight ?? 0);
  }, 0);
  const discount = Math.round((couponAmount ?? 0) * 100) / 100;
  const total = Math.round((itemTotal + freight - discount) * 100) / 100;
  const shopIds = Array.from(new Set(items.map((it) => productById(it.pid)?.shopId ?? '')));
  const order: TbOrder = {
    id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    uid,
    shopId: shopIds[0] ?? '',
    shopName: shopIds[0] ? shopById(shopIds[0]).name : '淘宝好店',
    items,
    itemTotal,
    freight,
    discount,
    couponId,
    couponAmount,
    total: Math.max(0, total),
    address,
    status: 'pendingPay',
    createdAt: Date.now(),
    track: [],
  };
  const list = tbLoadOrders(uid);
  list.unshift(order);
  tbSaveOrders(uid, list);
  return order;
}

/** 取票号（4×4 数字分组：3353 8086 1298 6080 口径，确定性派生自订单号） */
function ticketNoOf(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const digits: string[] = [];
  for (let i = 0; i < 16; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    digits.push(String((h >>> 0) % 10));
  }
  return digits.join('').replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** 票务出票（淘票票电影/喜剧脱口秀/演唱会共用）：
 *  需求——买了票直接进「全部订单」待收货（status=shipped），不需要发货/物流 */
export function tbCreateTicketOrder(
  uid: string,
  t: Omit<TbTicketInfo, 'ticketNo'>,
  opts?: { total?: number }
): TbOrder {
  const total = opts?.total ?? Math.round(t.unitPrice * t.qty * 100) / 100;
  const order: TbOrder = {
    id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    uid,
    shopId: '',
    shopName: '淘票票',
    items: [
      {
        pid: `ticket-${t.kind}-${t.title}`,
        title: t.title,
        img: '',
        sku: {},
        price: t.unitPrice,
        qty: t.qty,
      },
    ],
    itemTotal: total,
    freight: 0,
    discount: 0,
    total,
    status: 'shipped',
    createdAt: Date.now(),
    paidAt: Date.now(),
    payIdp: 'wx',
    payChannelLabel: '微信零钱',
    payMethodId: 'balance',
    track: [],
    ticket: { ...t, ticketNo: '' },
  };
  order.ticket!.ticketNo = ticketNoOf(order.id);
  const list = tbLoadOrders(uid);
  list.unshift(order);
  tbSaveOrders(uid, list);
  return order;
}

/** 淘票票周边商城下单（实体货走正常待付款→发货→物流链路） */
export function tbCreateMerchOrder(uid: string, m: { id: string; title: string; tag: string; price: number }, qty: number): TbOrder {
  const items: TbOrderItem[] = [
    { pid: `merch-${m.id}`, title: m.title, img: tbImg(m.tag, 300, 300), sku: { 类型: '官方周边' }, price: m.price, qty },
  ];
  const itemTotal = Math.round(m.price * qty * 100) / 100;
  const order: TbOrder = {
    id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    uid,
    shopId: '',
    shopName: '淘票票周边商城',
    items,
    itemTotal,
    freight: 0,
    discount: 0,
    total: itemTotal,
    address: tbCurAddr(uid) ?? undefined,
    status: 'pendingPay',
    createdAt: Date.now(),
    track: [],
  };
  const list = tbLoadOrders(uid);
  list.unshift(order);
  tbSaveOrders(uid, list);
  return order;
}

/** 状态推进 catch-up：全局 tick 与打开 App 时都调用（确定性时间戳，重启不丢进度） */
export function tbTickOrders(uid: string): boolean {
  let changed = false;
  const list = tbLoadOrders(uid);
  const now = Date.now();
  for (const o of list) {
    // 票务订单：散场（end 时间过）自动完成（详情页已同步切换「电影已放映」）
    if (o.ticket && o.status === 'shipped') {
      const endAt = new Date(`${o.ticket.date}T${o.ticket.end}:00`).getTime();
      if (Number.isFinite(endAt) && now > endAt) {
        o.status = 'completed';
        o.completedAt = now;
        changed = true;
      }
      continue;
    }
    if (o.status === 'pendingPay' && now - o.createdAt > TB_PAY_TTL) {
      o.status = 'cancelled';
      o.cancelReason = '超时未付款，订单自动取消';
      changed = true;
      continue;
    }
    if (o.status === 'pendingDeliver' && o.paidAt && now - o.paidAt > TB_SHIP_DELAY) {
      o.status = 'shipped';
      o.shipAt = now;
      o.track = [{ text: TB_TRACK_NODES[0], at: now }];
      changed = true;
      continue;
    }
    if (o.status === 'shipped' && o.shipAt) {
      // 物流节点逐步推进（全部节点走完即「已到驿站」可确认收货）
      const elapsed = now - o.shipAt;
      const nodeCount = Math.min(TB_TRACK_NODES.length, 1 + Math.floor(elapsed / TB_TRACK_STEP));
      if (o.track.length < nodeCount) {
        o.track = TB_TRACK_NODES.slice(0, nodeCount).map((text, i) => ({ text, at: o.shipAt! + (i + 1) * TB_TRACK_STEP }));
        changed = true;
      }
    }
  }
  if (changed) tbSaveOrders(uid, list);
  return changed;
}

/** 状态中文（订单卡/详情/消息页统一口径）；
 *  shipped 详情页标题用「已发货」——与订单卡右上动态状态一致（用户：点「已发货」卡片
 *  要进入对应状态的已发货详情页，页面标题不能再写「待收货」造成两个界面） */
export function tbStatusText(o: TbOrder): string {
  switch (o.status) {
    case 'pendingPay':
      return '待付款';
    case 'pendingDeliver':
      return '待发货';
    case 'shipped':
      return '已发货';
    case 'completed':
      return '已完成';
    case 'cancelled':
      return o.refund ? '退款成功' : '已取消';
  }
}

/** 确认收货 */
export function tbConfirmReceive(uid: string, id: string): boolean {
  const o = tbOrderById(uid, id);
  if (!o || o.status !== 'shipped') return false;
  const list = tbLoadOrders(uid);
  const hit = list.find((x) => x.id === id);
  if (!hit) return false;
  hit.status = 'completed';
  hit.completedAt = Date.now();
  tbSaveOrders(uid, list);
  return true;
}

/** 取消订单（仅待付款） */
export function tbCancelOrder(uid: string, id: string, reason: string): boolean {
  const o = tbOrderById(uid, id);
  if (!o || o.status !== 'pendingPay') return false;
  const list = tbLoadOrders(uid);
  const hit = list.find((x) => x.id === id);
  if (!hit) return false;
  hit.status = 'cancelled';
  hit.cancelReason = reason;
  tbSaveOrders(uid, list);
  return true;
}

/** 标记退款（taobao-pay 原路退回成功后调用）；票务单同步写 ticket.refunded（票详情已退款态） */
export function tbMarkRefund(uid: string, id: string, amount: number, reason: string): boolean {
  const list = tbLoadOrders(uid);
  const hit = list.find((x) => x.id === id);
  if (!hit) return false;
  hit.status = 'cancelled';
  hit.refund = { amount, reason, at: Date.now() };
  if (hit.ticket && !hit.ticket.refunded) hit.ticket.refunded = { amount, at: Date.now() };
  tbSaveOrders(uid, list);
  return true;
}

/** 删除订单（交易关闭/已取消详情「删除订单」按钮）：从订单列表移除 */
export function tbDeleteOrder(uid: string, id: string): boolean {
  const list = tbLoadOrders(uid);
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  tbSaveOrders(uid, next);
  return true;
}

/** 提交评价 */
export function tbSubmitReview(uid: string, id: string, rating: number, content: string, tags: string[]): boolean {
  const list = tbLoadOrders(uid);
  const hit = list.find((x) => x.id === id);
  if (!hit || hit.status !== 'completed' || hit.review) return false;
  hit.review = { rating, content, tags, at: Date.now() };
  tbSaveOrders(uid, list);
  return true;
}

/** 支付成功落账：pendingPay → pendingDeliver（payInfo 由 taobao-pay 写入） */
export function tbMarkPaid(
  uid: string,
  id: string,
  pay: { payIdp: 'wx' | 'qq'; payChannelLabel: string; payMethodId: string; payFc?: boolean; payFcParts?: { cardInId: string; amount: number }[] }
): boolean {
  const list = tbLoadOrders(uid);
  const hit = list.find((x) => x.id === id);
  if (!hit || hit.status !== 'pendingPay') return false;
  hit.status = 'pendingDeliver';
  hit.paidAt = Date.now();
  hit.payIdp = pay.payIdp;
  hit.payChannelLabel = pay.payChannelLabel;
  hit.payMethodId = pay.payMethodId;
  hit.payFc = pay.payFc;
  hit.payFcParts = pay.payFcParts;
  tbSaveOrders(uid, list);
  return true;
}

// ---------------- 站内消息（交易物流 / 售后保障） ----------------

export interface TbMsg {
  id: string;
  /** 'logistics' 交易物流 | 'refund' 售后保障 */
  kind: 'logistics' | 'refund';
  title: string;
  text: string;
  at: number;
  /** 关联订单（点击跳订单详情） */
  orderId?: string;
}

const msgKey = (uid: string) => `tb-msgs:${uid}`;

export function tbLoadMsgs(uid: string): TbMsg[] {
  return load<TbMsg[]>(msgKey(uid), []).sort((a, b) => b.at - a.at);
}

export function tbPushMsg(uid: string, m: Omit<TbMsg, 'id' | 'at'>): void {
  const list = load<TbMsg[]>(msgKey(uid), []);
  list.push({ ...m, id: `tbm${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`, at: Date.now() });
  save(msgKey(uid), list);
}

/** 未读口径：消息时间晚于已读时间戳即未读（「消息-清除未读」用） */
const msgReadKey = (uid: string) => `tb-msgs-read:${uid}`;

export function tbMsgsReadAt(uid: string): number {
  return load<number>(msgReadKey(uid), 0);
}

export function tbSetMsgsReadAt(uid: string, ts: number): void {
  save(msgReadKey(uid), ts);
}

export function tbMsgUnreadCount(uid: string): number {
  const r = tbMsgsReadAt(uid);
  return tbLoadMsgs(uid).filter((m) => m.at > r).length;
}

// ---------------- 全局状态推进 tick ----------------

let tickTimer: ReturnType<typeof setInterval> | null = null;

/** 全局订单推进（App 挂载时启动一次）：每 10s catch-up 所有已登录账号 */
export function tbStartOrderWatcher(): void {
  if (tickTimer || typeof window === 'undefined') return;
  tickTimer = setInterval(() => {
    try {
      const s = tbGetSession();
      if (s) tbTickOrders(tbUidOf(s));
    } catch {
      /* 静默 */
    }
  }, 10_000);
}

// ---------------- 商品口径辅助 ----------------

/** 商品主图（首图，s 取变体） */
export function tbMainImg(p: TbProduct, s = 0): string {
  return tbImg(p.tag, 600, 600, s);
}

/** 商品详情评价（种子 3 条 + 订单晒单评价聚合在 UI 层做） */
export function tbSeedReviews(pid: string) {
  return tbReviewsOf(pid);
}
