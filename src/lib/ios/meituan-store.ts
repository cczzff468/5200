/**
 * 美团 App 数据层（本地优先，与微信/QQ 同架构）：
 * - 所有美团数据存 IndexedDB kv（idb-kv 内存同步读 + 异步写穿），键按登录账号隔离：
 *   登录身份 uid = `wx:<联系人id>` / `qq:<联系人id>` / `ph:<手机号>`，美团数据键全部带 uid
 *   （`mt-orders:<uid>` 等）——换账号登录互不串数据（需求「美团数据按账号隔离」）；
 * - 登录态存 localStorage `mt-session`（重启后仍保留）；
 * - 订单状态机：待支付 → 待接单 → 商家已接单 → 配送中 → 已送达（已完成）/ 已取消；
 *   按时间戳确定性推进（MeituanOrderWatcher 全局 tick + 打开 App 时 catch-up，重启不丢进度）。
 * 支付不在这里：meituan-pay.ts 动态 import 微信/QQ 钱包模块（避免全局加载 1.4 万行聊天模块）。
 */
import { kvGet, kvSet } from '@/lib/ios/idb-kv';
import { accLs, getActiveAccountFor } from '@/lib/ios/accounts';
import { getContact, listContacts } from '@/lib/ios/contacts-store';
import type { ContactRecord } from '@/lib/contacts';
import { MT_MERCHANTS, mtDishesOf, type MtMerchant } from './meituan-data';

// ---------------- 登录态 ----------------

export interface MtSession {
  /** 登录方式：QQ 一键 / 微信一键 / 手机号 */
  idp: 'wx' | 'qq' | 'phone';
  /** wx/qq 登录：联系人记录 id（机主或小号档案） */
  contactId?: string;
  /** 手机号登录：手机号 */
  phone?: string;
  name: string;
  avatar: string | null;
  loginAt: number;
}

const LS_SESSION = 'mt-session';
const LS_RECENTS = 'mt-recent-users';
const LS_SEARCH_HIST = 'mt-search-hist';

/** 数据隔离键 uid：不同美团账号（微信/QQ/手机号）各一份购物车/订单/地址 */
export function mtUidOf(s: MtSession): string {
  if (s.idp === 'phone') return `ph:${s.phone ?? ''}`;
  return `${s.idp}:${s.contactId ?? ''}`;
}

export function mtGetSession(): MtSession | null {
  try {
    const raw = window.localStorage.getItem(LS_SESSION);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<MtSession>;
    if (!p || typeof p !== 'object' || (p.idp !== 'wx' && p.idp !== 'qq' && p.idp !== 'phone')) return null;
    if (typeof p.name !== 'string' || !p.name) return null;
    return {
      idp: p.idp,
      contactId: typeof p.contactId === 'string' ? p.contactId : undefined,
      phone: typeof p.phone === 'string' ? p.phone : undefined,
      name: p.name,
      avatar: typeof p.avatar === 'string' ? p.avatar : null,
      loginAt: typeof p.loginAt === 'number' ? p.loginAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function mtSetSession(s: MtSession | null): void {
  try {
    if (s) {
      window.localStorage.setItem(LS_SESSION, JSON.stringify(s));
      mtPushRecent(s);
    } else {
      window.localStorage.removeItem(LS_SESSION);
    }
  } catch {
    /* 忽略 */
  }
}

/** 最近登录过的美团账号（切换账号页快捷头像，最多 4 个） */
export interface MtRecentUser {
  uid: string;
  idp: 'wx' | 'qq' | 'phone';
  name: string;
  avatar: string | null;
}

export function mtGetRecents(): MtRecentUser[] {
  try {
    const raw = window.localStorage.getItem(LS_RECENTS);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((r): r is MtRecentUser => Boolean(r) && typeof (r as MtRecentUser).uid === 'string' && typeof (r as MtRecentUser).name === 'string')
      .slice(0, 4);
  } catch {
    return [];
  }
}

function mtPushRecent(s: MtSession): void {
  try {
    const uid = mtUidOf(s);
    const rest = mtGetRecents().filter((r) => r.uid !== uid);
    window.localStorage.setItem(LS_RECENTS, JSON.stringify([{ uid, idp: s.idp, name: s.name, avatar: s.avatar }, ...rest].slice(0, 4)));
  } catch {
    /* 忽略 */
  }
}

export function mtGetSearchHist(): string[] {
  try {
    const raw = window.localStorage.getItem(LS_SEARCH_HIST);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
  } catch {
    return [];
  }
}

export function mtPushSearchHist(kw: string): void {
  const k = kw.trim().slice(0, 20);
  if (!k) return;
  try {
    const next = [k, ...mtGetSearchHist().filter((x) => x !== k)].slice(0, 10);
    window.localStorage.setItem(LS_SEARCH_HIST, JSON.stringify(next));
  } catch {
    /* 忽略 */
  }
}

export function mtClearSearchHist(): void {
  try {
    window.localStorage.removeItem(LS_SEARCH_HIST);
  } catch {
    /* 忽略 */
  }
}

// ---------------- 登录身份解析（QQ/微信一键登录） ----------------

/**
 * 解析微信/QQ 当前账号对应的「人」的联系人（一键登录读取账号信息）：
 * 1) 该端登录会话指针（与微信/QQ App 显示的「我」一致）；
 * 2) 回退：账号槽位关联的档案联系人（main = 机主，alt/anon = altOf/ownerContactId）；
 * 3) 终底：联系人库为空（全新环境/未初始化）→ 本地虚拟账号（contactId 空，uid 仍按端隔离），
 *    保证「一键登录」永不失败；真机上正常走 1/2 拿到真实昵称头像。
 */
export async function mtResolveIdpIdentity(idp: 'wx' | 'qq'): Promise<{ contactId: string; name: string; avatar: string | null }> {
  try {
    const acc = getActiveAccountFor(idp);
    const all = await listContacts();
    let me: ContactRecord | undefined;
    const sid = typeof window !== 'undefined' ? window.localStorage.getItem(accLs(`${idp}-session-user-id`, idp)) : null;
    if (sid) me = all.find((c) => c.id === sid && c.kind === 'user');
    if (!me) {
      me =
        acc.kind === 'main'
          ? all.find((c) => c.kind === 'user' && !c.altOf)
          : (all.find((c) => c.altOf === acc.id) ?? (acc.ownerContactId ? all.find((c) => c.id === acc.ownerContactId) : undefined));
    }
    if (me) {
      const name = (me.nickname?.trim() || me.name || '').trim() || (idp === 'wx' ? '微信用户' : 'QQ用户');
      return { contactId: me.id, name, avatar: typeof me.avatar === 'string' && me.avatar ? me.avatar : null };
    }
  } catch {
    /* 联系人库异常 → 走虚拟账号兜底 */
  }
  return { contactId: '', name: idp === 'wx' ? '微信用户' : 'QQ用户', avatar: null };
}

/** 登录会话有效性校验（打开 App 时调用）：wx/qq 会话对应的联系人被删除 → 视为已退出；
 *  本地虚拟账号（联系人库为空时一键登录的兜底，contactId 空）直接有效 */
export async function mtValidateSession(s: MtSession | null): Promise<MtSession | null> {
  if (!s) return null;
  if (s.idp === 'phone') return s.phone ? s : null;
  if (!s.contactId) return s;
  try {
    const c = await getContact(s.contactId);
    return c && c.kind === 'user' ? s : null;
  } catch {
    return null;
  }
}

// ---------------- 购物车（单商家模式：跨店加购需清空换店，对齐真机） ----------------

export interface MtCart {
  merchantId: string | null;
  items: { dishId: string; qty: number }[];
}

const cartKey = (uid: string) => `mt-cart:${uid}`;

export function mtLoadCart(uid: string): MtCart {
  const c = kvGet<Partial<MtCart>>(cartKey(uid));
  if (c && typeof c === 'object' && Array.isArray(c.items)) {
    return {
      merchantId: typeof c.merchantId === 'string' ? c.merchantId : null,
      items: c.items.filter((i) => i && typeof i.dishId === 'string' && typeof i.qty === 'number' && i.qty > 0),
    };
  }
  return { merchantId: null, items: [] };
}

export function mtSaveCart(uid: string, cart: MtCart): void {
  kvSet(cartKey(uid), cart);
}

export function mtCartCount(cart: MtCart): number {
  return cart.items.reduce((s, i) => s + i.qty, 0);
}

// ---------------- 收货地址 ----------------

export interface MtAddress {
  id: string;
  name: string;
  phone: string;
  text: string;
  tag: string;
}

const addrKey = (uid: string) => `mt-addrs:${uid}`;
const LS_CUR_ADDR = 'mt-cur-addr';

export function mtCurAddrId(uid: string): string {
  try {
    return window.localStorage.getItem(`${LS_CUR_ADDR}:${uid}`) ?? '';
  } catch {
    return '';
  }
}

export function mtSetCurAddr(uid: string, id: string): void {
  try {
    window.localStorage.setItem(`${LS_CUR_ADDR}:${uid}`, id);
  } catch {
    /* 忽略 */
  }
}

/** 地址列表（空则播种默认地址；默认地址自动选中） */
export function mtLoadAddresses(uid: string): MtAddress[] {
  const list = kvGet<Partial<MtAddress>[]>(addrKey(uid));
  if (Array.isArray(list) && list.length > 0) {
    return list
      .filter((a) => a && typeof a.text === 'string')
      .map((a, i) => ({
        id: typeof a.id === 'string' ? a.id : `addr${i}`,
        name: typeof a.name === 'string' ? a.name : '收货人',
        phone: typeof a.phone === 'string' ? a.phone : '',
        text: a.text as string,
        tag: typeof a.tag === 'string' && a.tag ? a.tag : '家',
      }));
  }
  const seed: MtAddress[] = [
    { id: 'addr1', name: '陶先生', phone: '156****2929', text: '幸福小区西区 3 栋 2 单元 502', tag: '家' },
    { id: 'addr2', name: '陶先生', phone: '156****2929', text: '科技园写字楼 B 座 12 层 1206', tag: '公司' },
  ];
  kvSet(addrKey(uid), seed);
  mtSetCurAddr(uid, seed[0].id);
  return seed;
}

export function mtSaveAddresses(uid: string, list: MtAddress[]): void {
  kvSet(addrKey(uid), list);
}

// ---------------- 订单 ----------------

export type MtOrderStatus = 'pendingPay' | 'pendingAccept' | 'accepted' | 'delivering' | 'completed' | 'canceled';

export const MT_STATUS_LABEL: Record<MtOrderStatus, string> = {
  pendingPay: '待支付',
  pendingAccept: '待接单',
  accepted: '商家已接单',
  delivering: '配送中',
  completed: '已完成',
  canceled: '已取消',
};

/** 订单履约类型：外卖配送（默认，兼容旧数据） / 团购到店（支付后直接完成） */
export type MtOrderKind = 'waimai' | 'tuangou';

export interface MtOrderItem {
  dishId: string;
  name: string;
  price: number;
  qty: number;
  emoji: string;
  img?: string;
}

export interface MtOrder {
  id: string;
  /** 数据隔离 uid（订单归属的美团账号） */
  uid: string;
  merchantId: string;
  merchantName: string;
  merchantEmoji: string;
  merchantImg?: string;
  items: MtOrderItem[];
  itemTotal: number;
  deliveryFee: number;
  discount: number;
  /** 实付金额（pendingPay 时为应付金额） */
  total: number;
  note?: string;
  /** 履约类型（团购单无收货地址，支付后到店直接消费完成） */
  kind?: MtOrderKind;
  address?: MtAddress;
  /** 到店消费完成时间（团购单支付成功即写入） */
  consumedAt?: number;
  /** 支付方式：'wx' | 'qq'（pendingPay 时为空） */
  payIdp?: 'wx' | 'qq';
  /** 具体支付渠道展示名（零钱/银行卡/亲属卡） */
  payChannelLabel?: string;
  /** 亲属卡支付标记（支付方式展示「亲属卡」） */
  payFc?: boolean;
  status: MtOrderStatus;
  createdAt: number;
  paidAt?: number;
  cancelReason?: string;
  /** 骑手（商家接单后分配） */
  riderName?: string;
  /** 预计送达时间戳（支付后生成） */
  etaAt?: number;
  /** 状态流水（新的在后） */
  statusLog: { status: MtOrderStatus; at: number }[];
}

const ordersKey = (uid: string) => `mt-orders:${uid}`;
const MAX_ORDERS = 60;

export function mtLoadOrders(uid: string): MtOrder[] {
  const list = kvGet<Partial<MtOrder>[]>(ordersKey(uid));
  if (!Array.isArray(list)) return [];
  const normalized = list
    .filter((o) => o && typeof o.id === 'string' && Array.isArray(o.items))
    .map((o) => ({
      ...o,
      id: o.id as string,
      uid,
      merchantId: typeof o.merchantId === 'string' ? o.merchantId : '',
      merchantName: typeof o.merchantName === 'string' ? o.merchantName : '商家',
      merchantEmoji: typeof o.merchantEmoji === 'string' ? o.merchantEmoji : '🍜',
      merchantImg: typeof o.merchantImg === 'string' ? o.merchantImg : undefined,
      items: (o.items as MtOrderItem[]).filter((i) => i && typeof i.name === 'string'),
      itemTotal: typeof o.itemTotal === 'number' ? o.itemTotal : 0,
      deliveryFee: typeof o.deliveryFee === 'number' ? o.deliveryFee : 0,
      discount: typeof o.discount === 'number' ? o.discount : 0,
      total: typeof o.total === 'number' ? o.total : 0,
      note: typeof o.note === 'string' ? o.note : undefined,
      kind: o.kind === 'tuangou' ? 'tuangou' : 'waimai',
      address: (o.address ?? undefined) as MtAddress | undefined,
      consumedAt: typeof o.consumedAt === 'number' ? o.consumedAt : undefined,
      payIdp: o.payIdp === 'wx' || o.payIdp === 'qq' ? o.payIdp : undefined,
      payChannelLabel: typeof o.payChannelLabel === 'string' ? o.payChannelLabel : undefined,
      payFc: o.payFc === true,
      status: (o.status ?? 'pendingPay') as MtOrderStatus,
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
      paidAt: typeof o.paidAt === 'number' ? o.paidAt : undefined,
      cancelReason: typeof o.cancelReason === 'string' ? o.cancelReason : undefined,
      riderName: typeof o.riderName === 'string' ? o.riderName : undefined,
      etaAt: typeof o.etaAt === 'number' ? o.etaAt : undefined,
      statusLog: Array.isArray(o.statusLog) ? (o.statusLog as MtOrder['statusLog']).filter((s) => s && typeof s.at === 'number') : [],
    })) as MtOrder[];
  // 旧数据迁移：「待使用+券码」已废弃 → 团购单待使用态直接归档为已完成（消费时间取支付时间）
  return normalized.map((o) =>
    (o.status as string) === 'pendingUse'
      ? { ...o, status: 'completed' as const, consumedAt: o.consumedAt ?? o.paidAt ?? o.createdAt, statusLog: [...o.statusLog, { status: 'completed' as const, at: o.consumedAt ?? o.paidAt ?? Date.now() }] }
      : o
  );
}

export function mtSaveOrders(uid: string, list: MtOrder[]): void {
  kvSet(ordersKey(uid), list.slice(0, MAX_ORDERS));
}

export function mtGetOrder(uid: string, id: string): MtOrder | undefined {
  return mtLoadOrders(uid).find((o) => o.id === id);
}

// ---------------- 订单状态机（时间戳确定性推进） ----------------

/** 支付后：10s 商家接单 → 26s 骑手取餐/配送中 → 75s 已送达（演示节奏，重启按时间戳补推进）；团购单支付后即完成 */
const ACCEPT_MS = 10_000;
const PICKUP_MS = 26_000;
const DELIVERED_MS = 75_000;
/** 待支付超时（自动取消，对齐真机 30 分钟） */
const PAY_TIMEOUT_MS = 30 * 60_000;

const RIDER_POOL = ['宋世超', '刘志伟', '王建平', '李海峰', '赵国栋', '陈志强'];

export interface MtOrderTransition {
  order: MtOrder;
  from: MtOrderStatus;
  to: MtOrderStatus;
}

/** 推进某账号全部订单的状态；有变化则持久化并返回变更明细（供灵动岛通知） */
export function mtAdvanceOrders(uid: string): MtOrderTransition[] {
  const orders = mtLoadOrders(uid);
  if (orders.length === 0) return [];
  const now = Date.now();
  const transitions: MtOrderTransition[] = [];
  let changed = false;
  const next = orders.map((o) => {
    let cur = o;
    const step = (to: MtOrderStatus, patch?: Partial<MtOrder>): void => {
      const from = cur.status;
      cur = { ...cur, ...patch, status: to, statusLog: [...cur.statusLog, { status: to, at: now }] };
      transitions.push({ order: cur, from, to });
      changed = true;
    };
    // 多步推进循环（长间隔后一次 tick 可能跨多档）
    for (let guard = 0; guard < 4; guard += 1) {
      if (cur.status === 'pendingPay') {
        if (now - cur.createdAt >= PAY_TIMEOUT_MS) step('canceled', { cancelReason: '超时未支付，订单自动取消' });
        break;
      }
      if (cur.status === 'pendingAccept') {
        if (cur.paidAt && now - cur.paidAt >= ACCEPT_MS) {
          step('accepted', { riderName: RIDER_POOL[Math.floor(now / 60000) % RIDER_POOL.length] });
          continue;
        }
        break;
      }
      if (cur.status === 'accepted') {
        if (cur.paidAt && now - cur.paidAt >= PICKUP_MS) {
          step('delivering');
          continue;
        }
        break;
      }
      if (cur.status === 'delivering') {
        if (cur.paidAt && now - cur.paidAt >= DELIVERED_MS) {
          step('completed');
          continue;
        }
        break;
      }
      // 团购单：待使用 → 无自动推进，用户到店核销
      break;
    }
    return cur;
  });
  if (changed) mtSaveOrders(uid, next);
  return transitions;
}

/** 商家接单后写一条骑手取餐前的等待文案（订单详情/通知用） */
export function mtStatusBody(o: MtOrder): string {
  switch (o.status) {
    case 'pendingPay':
      return '订单已提交，请尽快完成支付';
    case 'pendingAccept':
      return `已支付¥${o.total.toFixed(2)}，等待商家接单`;
    case 'accepted':
      return '商家已接单，正在为您准备餐品';
    case 'delivering':
      return `骑手${o.riderName ?? ''}已取餐，正在火速配送`;
    case 'completed':
      return o.kind === 'tuangou' ? `团购已完成¥${o.total.toFixed(2)}，感谢光临，欢迎评价` : '订单已送达，感谢您的信任，欢迎评价';
    case 'canceled':
      return o.cancelReason ?? '订单已取消';
  }
}

// ---------------- 下单金额计算 ----------------

export interface MtDeals {
  /** 命中的满减（含新客立减）金额合计 */
  discount: number;
  /** 命中的满减标签（价格明细展示） */
  labels: string[];
}

/** 解析「满30减8」类满减标签 → [{min, off}] */
export function mtParseDeals(deals: string[]): { min: number; off: number; label: string }[] {
  const out: { min: number; off: number; label: string }[] = [];
  for (const d of deals) {
    const m = /^满(\d+(?:\.\d+)?)减(\d+(?:\.\d+)?)$/.exec(d.replace(/\s/g, ''));
    if (m) out.push({ min: Number(m[1]), off: Number(m[2]), label: d });
  }
  return out;
}

/** 优惠计算：满减取最优档 + 新客立减（该账号无任何已完成/已支付订单时） */
export function mtCalcDeals(uid: string, merchant: MtMerchant, itemTotal: number, deliveryFee: number): MtDeals {
  const labels: string[] = [];
  let discount = 0;
  const rules = mtParseDeals(merchant.deals)
    .filter((r) => itemTotal >= r.min)
    .sort((a, b) => b.off - a.off);
  if (rules.length > 0) {
    discount += rules[0].off;
    labels.push(rules[0].label);
  }
  const paid = mtLoadOrders(uid).some((o) => o.status !== 'pendingPay' && o.status !== 'canceled');
  if (!paid && itemTotal > 0) {
    discount += 3;
    labels.push('新客立减3');
  }
  // 满额免配送费（对齐真机常现规则）
  if (itemTotal >= 45 && deliveryFee > 0) {
    labels.push('满45免配送费');
  }
  return { discount: Math.round(discount * 100) / 100, labels };
}

/** 结算合计：商品 - 满减/新客 + 配送费（满45免） */
export function mtCheckoutCalc(uid: string, merchant: MtMerchant, cart: MtCart): { itemTotal: number; deliveryFee: number; discount: number; total: number; labels: string[]; count: number } {
  const all = mtDishesOf(merchant);
  const itemTotal = cart.items.reduce((s, i) => {
    const d = all.find((x) => x.id === i.dishId);
    return s + (d ? d.price * i.qty : 0);
  }, 0);
  const count = cart.items.reduce((s, i) => s + i.qty, 0);
  const baseFee = merchant.deliveryFee;
  const deals = mtCalcDeals(uid, merchant, itemTotal, baseFee);
  const freeShip = itemTotal >= 45;
  const deliveryFee = freeShip ? 0 : baseFee;
  const total = Math.max(0.01, Math.round((itemTotal - deals.discount + deliveryFee) * 100) / 100);
  return { itemTotal, deliveryFee, discount: deals.discount, total, labels: deals.labels, count };
}

/** 从订单复制购物车（再来一单） */
export function mtReorder(uid: string, o: MtOrder): boolean {
  const merchant = MT_MERCHANTS.find((m) => m.id === o.merchantId);
  if (!merchant) return false;
  const all = mtDishesOf(merchant);
  mtSaveCart(uid, { merchantId: merchant.id, items: o.items.filter((i) => all.some((d) => d.id === i.dishId)).map((i) => ({ dishId: i.dishId, qty: i.qty })) });
  return true;
}
