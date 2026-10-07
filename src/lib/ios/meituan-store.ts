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
import { avatarFor } from '@/lib/contacts';
import { MT_COUPON_SEED, MT_COUPON_TYPE_LABEL, MT_GOD_CLAIMS, MT_DEALS, MT_MERCHANTS, mtDishesOf, type MtCouponSeed, type MtCouponType, type MtMerchant } from './meituan-data';

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
      return { contactId: me.id, name, avatar: avatarFor(me, idp) };
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

/**
 * 会话资料跟随全局账号信息（需求「我的界面的头像跟随全局信息的头像」）：
 * 按会话绑定的联系人实时读取微信/QQ「我」页的昵称/头像（avatarFor 按 App 投影，与微信/QQ 显示一致），
 * 变化则返回新会话（uid 不变，数据隔离不受影响）；联系人缺失/异常时原样返回。
 * 配合 contact-avatar-changed 事件可实时同步。
 */
export async function mtSyncSessionIdentity(s: MtSession): Promise<MtSession> {
  if (s.idp === 'phone' || !s.contactId) return s;
  try {
    const c = await getContact(s.contactId);
    if (!c || c.kind !== 'user') return s;
    const name = (c.nickname?.trim() || c.name || '').trim() || s.name;
    const avatar = avatarFor(c, s.idp);
    if (name === s.name && avatar === s.avatar) return s;
    return { ...s, name, avatar };
  } catch {
    return s;
  }
}

// ---------------- 购物车（单商家模式：跨店加购需清空换店，对齐真机） ----------------

export interface MtCart {
  merchantId: string | null;
  items: { dishId: string; qty: number; /** 规格文案（大杯/正常冰/珍珠/正常糖） */ spec?: string; /** 含小料加价的单价（覆盖菜品原价） */ unitPrice?: number }[];
}

const cartKey = (uid: string) => `mt-cart:${uid}`;

export function mtLoadCart(uid: string): MtCart {
  const c = kvGet<Partial<MtCart>>(cartKey(uid));
  if (c && typeof c === 'object' && Array.isArray(c.items)) {
    return {
      merchantId: typeof c.merchantId === 'string' ? c.merchantId : null,
      items: c.items.filter((i) => i && typeof i.dishId === 'string' && typeof i.qty === 'number' && i.qty > 0).map((i) => ({
        dishId: i.dishId,
        qty: i.qty,
        spec: typeof i.spec === 'string' && i.spec ? i.spec : undefined,
        unitPrice: typeof i.unitPrice === 'number' && i.unitPrice > 0 ? i.unitPrice : undefined,
      })),
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

/** 订单履约类型：外卖配送（默认，兼容旧数据）/ 团购到店（支付后直接完成）/ 机票 / 火车票（支付后→待出行→出行中→完成） */
export type MtOrderKind = 'waimai' | 'tuangou' | 'flight' | 'train';

export interface MtOrderItem {
  dishId: string;
  name: string;
  price: number;
  qty: number;
  emoji: string;
  img?: string;
  /** 规格文案（含小料：大杯/正常冰/珍珠/正常糖） */
  spec?: string;
}

// ---------------- 收藏（商家/菜品/团购） ----------------

export interface MtFavs {
  stores: string[];
  dishes: string[];
  deals: string[];
}

const favsKey = (uid: string) => `mt-favs:${uid}`;

export function mtLoadFavs(uid: string): MtFavs {
  const f = kvGet<Partial<MtFavs>>(favsKey(uid));
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { stores: arr(f?.stores), dishes: arr(f?.dishes), deals: arr(f?.deals) };
}

export function mtSaveFavs(uid: string, favs: MtFavs): void {
  kvSet(favsKey(uid), favs);
}

/** 切换收藏状态；返回切换后是否已收藏 */
export function mtToggleFav(uid: string, kind: keyof MtFavs, id: string): boolean {
  const favs = mtLoadFavs(uid);
  const list = favs[kind];
  const has = list.includes(id);
  const next = has ? list.filter((x) => x !== id) : [id, ...list];
  mtSaveFavs(uid, { ...favs, [kind]: next.slice(0, 99) });
  return !has;
}

// ---------------- 浏览记录（商家/团购，按时间倒序） ----------------

export interface MtHistItem {
  kind: 'merchant' | 'deal';
  id: string;
  at: number;
}

const histKey = (uid: string) => `mt-history:${uid}`;
const MAX_HIST = 50;

export function mtLoadHistory(uid: string): MtHistItem[] {
  const list = kvGet<Partial<MtHistItem>[]>(histKey(uid));
  if (!Array.isArray(list)) return [];
  return list
    .filter((h): h is MtHistItem => Boolean(h) && typeof h.id === 'string' && typeof h.at === 'number' && (h.kind === 'merchant' || h.kind === 'deal'))
    .slice(0, MAX_HIST);
}

export function mtPushHistory(uid: string, kind: 'merchant' | 'deal', id: string): void {
  if (!uid || !id) return;
  const rest = mtLoadHistory(uid).filter((h) => !(h.kind === kind && h.id === id));
  kvSet(histKey(uid), [{ kind, id, at: Date.now() }, ...rest].slice(0, MAX_HIST));
}

export function mtClearHistory(uid: string): void {
  kvSet(histKey(uid), []);
}

/** 删除单条浏览记录（浏览记录页管理模式） */
export function mtRemoveHistory(uid: string, kind: 'merchant' | 'deal', id: string): void {
  kvSet(histKey(uid), mtLoadHistory(uid).filter((h) => !(h.kind === kind && h.id === id)));
}

// ---------------- 退款/售后 ----------------

export interface MtRefund {
  reason: string;
  note?: string;
  /** 申请时间 */
  appliedAt: number;
  /** pending=商家审核中 / approved=已退款（原路退回） / failed=退款失败（异常） */
  status: 'pending' | 'approved' | 'failed';
  /** 退款金额（当前为全额） */
  amount: number;
  /** 审核通过/到账时间 */
  doneAt?: number;
  /** 原路退回渠道（微信零钱/QQ钱包余额/亲属卡等） */
  channel?: string;
  /** 失败原因文案（status=failed 时展示） */
  failMsg?: string;
  /** 原路退回入账已完成（防止重复入账的幂等标记） */
  paidBack?: boolean;
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
  /** 使用的优惠券 id（核销标记） */
  couponId?: string;
  /** 优惠券抵扣金额（含在 discount 内） */
  couponAmount?: number;
  /** 实付金额（pendingPay 时为应付金额） */
  total: number;
  note?: string;
  /** 履约类型（团购单无收货地址，支付后到店直接消费完成） */
  kind?: MtOrderKind;
  address?: MtAddress;
  /** 到店消费完成时间（团购单支付成功即写入） */
  consumedAt?: number;
  /** 退款/售后信息（申请后挂载） */
  refund?: MtRefund;
  /** 支付方式：'wx' | 'qq'（pendingPay 时为空） */
  payIdp?: 'wx' | 'qq';
  /** 具体支付渠道展示名（零钱/银行卡/亲属卡） */
  payChannelLabel?: string;
  /** 亲属卡支付标记（支付方式展示「亲属卡」） */
  payFc?: boolean;
  /** 支付渠道 methodId（退款原路退回定位账户用：balance/银行卡id/fcin-亲属卡id） */
  payMethodId?: string;
  /** 亲属卡多卡分摊明细（退款时按原分摊回补各卡额度） */
  payFcParts?: { cardInId: string; amount: number }[];
  /** 找人代付（待支付时发起）：id = 代付请求（mt-proxy:<id>），name = 代付好友 */
  proxy?: { id: string; name: string };
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
  /** 用户评价（订单完成后提交；商详评价 tab 聚合展示） */
  review?: MtOrderReview;
}

/** 订单评价（星级 + 文字 + 标签 + 晒图，演示图取内容匹配图链） */
export interface MtOrderReview {
  rating: number;
  content: string;
  tags: string[];
  imgs: string[];
  at: number;
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
      couponId: typeof o.couponId === 'string' ? o.couponId : undefined,
      couponAmount: typeof o.couponAmount === 'number' ? o.couponAmount : undefined,
      total: typeof o.total === 'number' ? o.total : 0,
      note: typeof o.note === 'string' ? o.note : undefined,
      kind: o.kind === 'tuangou' || o.kind === 'flight' || o.kind === 'train' ? o.kind : 'waimai',
      address: (o.address ?? undefined) as MtAddress | undefined,
      consumedAt: typeof o.consumedAt === 'number' ? o.consumedAt : undefined,
      payIdp: o.payIdp === 'wx' || o.payIdp === 'qq' ? o.payIdp : undefined,
      payChannelLabel: typeof o.payChannelLabel === 'string' ? o.payChannelLabel : undefined,
      payFc: o.payFc === true,
      payMethodId: typeof o.payMethodId === 'string' ? o.payMethodId : undefined,
      payFcParts: Array.isArray(o.payFcParts)
        ? (o.payFcParts as { cardInId?: unknown; amount?: unknown }[])
            .filter((p) => p && typeof p.cardInId === 'string' && typeof p.amount === 'number')
            .map((p) => ({ cardInId: p.cardInId as string, amount: p.amount as number }))
        : undefined,
      proxy:
        o.proxy && typeof o.proxy === 'object' && typeof (o.proxy as { id?: unknown }).id === 'string'
          ? { id: (o.proxy as { id: string }).id, name: typeof (o.proxy as { name?: unknown }).name === 'string' ? (o.proxy as { name: string }).name : '好友' }
          : undefined,
      refund:
        o.refund && typeof o.refund === 'object' && typeof o.refund.appliedAt === 'number'
          ? {
              reason: typeof o.refund.reason === 'string' ? o.refund.reason : '用户申请退款',
              note: typeof o.refund.note === 'string' ? o.refund.note : undefined,
              appliedAt: o.refund.appliedAt,
              status: o.refund.status === 'approved' ? 'approved' : o.refund.status === 'failed' ? 'failed' : 'pending',
              amount: typeof o.refund.amount === 'number' ? o.refund.amount : 0,
              doneAt: typeof o.refund.doneAt === 'number' ? o.refund.doneAt : undefined,
              channel: typeof o.refund.channel === 'string' ? o.refund.channel : undefined,
              failMsg: typeof o.refund.failMsg === 'string' ? o.refund.failMsg : undefined,
              paidBack: o.refund.paidBack === true,
            }
          : undefined,
      status: (o.status ?? 'pendingPay') as MtOrderStatus,
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
      paidAt: typeof o.paidAt === 'number' ? o.paidAt : undefined,
      cancelReason: typeof o.cancelReason === 'string' ? o.cancelReason : undefined,
      riderName: typeof o.riderName === 'string' ? o.riderName : undefined,
      etaAt: typeof o.etaAt === 'number' ? o.etaAt : undefined,
      statusLog: Array.isArray(o.statusLog) ? (o.statusLog as MtOrder['statusLog']).filter((s) => s && typeof s.at === 'number') : [],
      review:
        o.review && typeof o.review === 'object' && typeof o.review.at === 'number'
          ? {
              rating: typeof o.review.rating === 'number' ? Math.min(5, Math.max(1, Math.round(o.review.rating))) : 5,
              content: typeof o.review.content === 'string' ? o.review.content : '',
              tags: Array.isArray(o.review.tags) ? (o.review.tags as unknown[]).filter((x): x is string => typeof x === 'string') : [],
              imgs: Array.isArray(o.review.imgs) ? (o.review.imgs as unknown[]).filter((x): x is string => typeof x === 'string') : [],
              at: o.review.at,
            }
          : undefined,
    })) as MtOrder[];
  // 旧数据迁移：「待使用+券码」已废弃 → 团购单待使用态直接归档为已完成（消费时间取支付时间）
  return normalized.map((o) => mtBackfillOrderImgs(
    (o.status as string) === 'pendingUse'
      ? { ...o, status: 'completed' as const, consumedAt: o.consumedAt ?? o.paidAt ?? o.createdAt, statusLog: [...o.statusLog, { status: 'completed' as const, at: o.consumedAt ?? o.paidAt ?? Date.now() }] }
      : o
  ));
}

/** 订单图片补全（需求「订单所有的图片补充完整」）：历史订单缺图时按 商品图→团购图→商家图 逐级回填 */
function mtBackfillOrderImgs(o: MtOrder): MtOrder {
  const merchant = MT_MERCHANTS.find((m) => m.id === o.merchantId);
  const dishes = merchant ? mtDishesOf(merchant) : [];
  let itemsChanged = false;
  const items = o.items.map((it) => {
    if (it.img) return it;
    const dish = dishes.find((d) => d.id === it.dishId);
    const deal = MT_DEALS.find((d) => d.id === it.dishId);
    const img = dish?.img ?? deal?.img ?? merchant?.cover;
    if (!img) return it;
    itemsChanged = true;
    return { ...it, img };
  });
  const merchantImg = o.merchantImg ?? merchant?.cover;
  if (!itemsChanged && merchantImg === o.merchantImg) return o;
  return { ...o, items, merchantImg };
}

export function mtSaveOrders(uid: string, list: MtOrder[]): void {
  kvSet(ordersKey(uid), list.slice(0, MAX_ORDERS));
}

export function mtGetOrder(uid: string, id: string): MtOrder | undefined {
  return mtLoadOrders(uid).find((o) => o.id === id);
}

// ---------------- 订单状态机（时间戳确定性推进） ----------------

/**
 * 支付后全程按真实外卖节奏推进（重启按时间戳补推进）：
 * 商家接单/骑手取餐两档按配送总时长等比缩放（接单 ≤2 分钟、取餐在总时长 50% 处）；
 * 预计送达时间(etaAt=支付后5~30分钟)系统确认送达；
 * etaAt 缺失的旧订单按 45 分钟兜底；团购单支付后即完成。
 * 时长与支付页「现在支付，预计XX:XX送达」承诺、详情页 ETA 大字完全一致（同一订单号确定性推导）。
 */
/** 商家接单上限（配送总时长更长时也最多 2 分钟接单） */
const ACCEPT_MS = 2 * 60_000;
/** etaAt 缺失的旧订单兜底送达时长 */
const DELIVERED_MS = 45 * 60_000;
/** 待支付超时（自动取消，对齐真机 15 分钟） */
export const PAY_TIMEOUT_MS = 15 * 60_000;

/** 按订单号确定性推导配送时长（5~30 分钟）：支付页 ETA、状态机送达时刻、详情页承诺保持一致 */
export const mtDeliveryMinutesOf = (orderId: string): number =>
  5 + ([...orderId].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7) % 26);

/** 配送总时长（毫秒） */
const deliveryMsOf = (o: { id: string }): number => mtDeliveryMinutesOf(o.id) * 60_000;
/** 商家接单档（总时长 ×35%，上限 2 分钟）：5 分钟单约 1 分 45 秒接单，30 分钟单 2 分钟接单 */
const acceptMsOf = (o: { id: string }): number => Math.min(ACCEPT_MS, Math.round(deliveryMsOf(o) * 0.35));
/** 骑手取餐档（总时长 ×50%）：接单后备餐到一半时长即取餐出发 */
const pickupMsOf = (o: { id: string }): number => Math.round(deliveryMsOf(o) * 0.5);

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
        if (cur.paidAt && now - cur.paidAt >= acceptMsOf(cur)) {
          // 出行单（机票/火车票）：无骑手概念，直接进入「出行中」
          step('accepted', cur.kind === 'flight' || cur.kind === 'train' ? {} : { riderName: RIDER_POOL[Math.floor(now / 60000) % RIDER_POOL.length] });
          continue;
        }
        break;
      }
      if (cur.status === 'accepted') {
        // 出行单：值机/检票后按预计到达时间完成行程（跳过配送档）
        if (cur.kind === 'flight' || cur.kind === 'train') {
          const doneAt = cur.etaAt ?? (cur.paidAt ? cur.paidAt + DELIVERED_MS : 0);
          if (doneAt && now >= doneAt) {
            step('completed');
            continue;
          }
          break;
        }
        if (cur.paidAt && now - cur.paidAt >= pickupMsOf(cur)) {
          step('delivering');
          continue;
        }
        break;
      }
      if (cur.status === 'delivering') {
        // 按预计送达时间（etaAt）确认送达——与详情页大字/骑手气泡剩余分钟同源
        const doneAt = cur.etaAt ?? (cur.paidAt ? cur.paidAt + DELIVERED_MS : 0);
        if (doneAt && now >= doneAt) {
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
  // 退款售后：审核超时自动出结果（原路退回；按订单号确定性地约 1/4 概率退款失败，对齐真机「退款失败」态）
  let refundChanged = false;
  const credited: MtOrder[] = [];
  const withRefunds = next.map((o) => {
    if (!o.refund || o.refund.status !== 'pending') return o;
    if (now - o.refund.appliedAt < REFUND_AUTO_MS) return o;
    refundChanged = true;
    // 确定性伪随机：同一订单结果稳定，重进页面不变卦
    const h = [...o.id].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const failed = h % 4 === 1;
    if (failed) {
      return {
        ...o,
        refund: { ...o.refund, status: 'failed' as const, doneAt: now, failMsg: '退款过程中出现异常，退款失败' },
      };
    }
    const approved: MtOrder = {
      ...o,
      // 未完成的配送单退款后关闭
      status: o.status === 'completed' ? o.status : 'canceled',
      cancelReason: o.status === 'completed' ? o.cancelReason : '退款成功，订单已关闭',
      statusLog:
        o.status === 'completed'
          ? o.statusLog
          : [...o.statusLog, { status: 'canceled' as const, at: now }],
      refund: { ...o.refund, status: 'approved' as const, doneAt: now, channel: mtRefundChannelOf(o), paidBack: true },
    };
    credited.push(approved);
    return approved;
  });
  if (changed || refundChanged) mtSaveOrders(uid, withRefunds);
  // 退款成功 → 原路退回入账（微信零钱/银行卡回补、亲属卡恢复本月额度、QQ钱包余额/银行卡入账）
  for (const o of credited) mtFireRefundCredit(o);
  return transitions;
}

// ---------------- 退款/售后操作 ----------------

/** 审核时长（演示节奏：20 秒后自动通过，原路退回） */
const REFUND_AUTO_MS = 20_000;

/** 是否可申请退款（已支付且未退款未取消） */
export function mtCanRefund(o: MtOrder): boolean {
  return !o.refund && o.status !== 'pendingPay' && o.status !== 'canceled';
}

/**
 * 取消订单并自动退款（对齐真机：取消订单 → 退款/售后列表出现「退款成功」记录，
 * 售后详情退款原因 =「订单取消时，自动退款」）。
 */
export function mtCancelWithRefund(uid: string, orderId: string, cancelReason: string): boolean {
  const orders = mtLoadOrders(uid);
  const target = orders.find((o) => o.id === orderId);
  if (!target || target.status === 'canceled' || target.refund) return false;
  const now = Date.now();
  let refunded: MtOrder | null = null;
  const next = orders.map((o) =>
    o.id === orderId
      ? (refunded = {
            ...o,
            status: 'canceled' as const,
            cancelReason,
            statusLog: [...o.statusLog, { status: 'canceled' as const, at: now }],
            refund: {
              reason: '订单取消时，自动退款',
              appliedAt: now,
              status: 'approved' as const,
              amount: o.total,
              doneAt: now,
              channel: mtRefundChannelOf(o),
              paidBack: true,
            },
          })
      : o
  );
  mtSaveOrders(uid, next);
  window.dispatchEvent(new CustomEvent('mt-orders-changed'));
  if (refunded) mtFireRefundCredit(refunded);
  return true;
}

/** 提交退款申请（全额、原路退回） */
export function mtApplyRefund(uid: string, orderId: string, reason: string, note?: string): boolean {
  const orders = mtLoadOrders(uid);
  const target = orders.find((o) => o.id === orderId);
  if (!target || !mtCanRefund(target)) return false;
  const now = Date.now();
  const next = orders.map((o) =>
    o.id === orderId
      ? {
          ...o,
          refund: {
            reason: reason.trim() || '用户申请退款',
            note: note?.trim() || undefined,
            appliedAt: now,
            status: 'pending' as const,
            amount: o.total,
            channel: o.payChannelLabel ?? (o.payIdp === 'qq' ? 'QQ钱包' : '微信支付'),
          },
        }
      : o
  );
  mtSaveOrders(uid, next);
  window.dispatchEvent(new CustomEvent('mt-orders-changed'));
  return true;
}

/** 原路退回渠道短名（订单详情展示） */
function mtRefundChannelOf(o: MtOrder): string {
  if (o.payChannelLabel) return o.payChannelLabel;
  return o.payIdp === 'qq' ? 'QQ钱包余额' : '微信零钱';
}

/** 退款成功后原路退回入账（异步动态 import 钱包模块，失败静默；幂等由 paidBack 标记保证） */
export function mtFireRefundCredit(o: MtOrder): void {
  void import('./meituan-pay')
    .then((m) => m.mtRefundToOrigin(o))
    .catch(() => undefined);
}

/** 商家接单后写一条骑手取餐前的等待文案（订单详情/通知用；机票/火车票有专属文案） */
export function mtStatusBody(o: MtOrder): string {
  switch (o.status) {
    case 'pendingPay':
      return '订单已提交，请尽快完成支付';
    case 'pendingAccept':
      if (o.kind === 'flight') return `出票成功，已支付¥${o.total.toFixed(2)}，祝您旅途愉快`;
      if (o.kind === 'train') return `购票成功，已支付¥${o.total.toFixed(2)}，请提前到站候车`;
      return `已支付¥${o.total.toFixed(2)}，等待商家接单`;
    case 'accepted':
      if (o.kind === 'flight') return '值机已开始，航班准点，祝您一路平安';
      if (o.kind === 'train') return '检票口已开放，请凭身份证检票乘车';
      return '商家已接单，正在为您准备餐品';
    case 'delivering':
      return `骑手${o.riderName ?? ''}已取餐，正在火速配送`;
    case 'completed':
      if (o.kind === 'flight' || o.kind === 'train') return '行程已结束，感谢乘坐，欢迎评价';
      return o.kind === 'tuangou' ? `团购已完成¥${o.total.toFixed(2)}，感谢光临，欢迎评价` : '订单已送达，感谢您的信任，欢迎评价';
    case 'canceled':
      return o.cancelReason ?? '订单已取消';
  }
}

// ---------------- 催单（催一下） ----------------

export interface MtUrgeResult {
  ok: boolean;
  /** 提示文案（催单结果：提前了多少） */
  msg: string;
  /** 催单后的预计送达时刻（成功时返回） */
  etaAt?: number;
}

/**
 * 催一下：把预计送达时间（etaAt）提前——
 * - 剩余 > 5 分钟：直接提前 5 分钟；
 * - 剩余 ≤ 5 分钟（时间少）：随机提前 10 秒 ~ 1 分钟；
 * - 提前后不早于「现在 + 8 秒」（再催就真的马上送到了）。
 * 仅对进行中的外卖单生效（pendingAccept/accepted/delivering 且已有 etaAt）。
 */
export function mtUrgeOrder(uid: string, orderId: string): MtUrgeResult {
  const orders = mtLoadOrders(uid);
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx < 0) return { ok: false, msg: '订单不存在' };
  const o = orders[idx];
  if (o.status !== 'pendingAccept' && o.status !== 'accepted' && o.status !== 'delivering') {
    return { ok: false, msg: '当前状态无法催单' };
  }
  if (!o.etaAt) return { ok: false, msg: '当前状态无法催单' };
  const now = Date.now();
  const left = o.etaAt - now;
  if (left <= 0) return { ok: false, msg: '骑手马上就到，无需催单' };
  // 剩余多 → 减 5 分钟；剩余少（≤5 分钟）→ 减 10 秒 ~ 1 分钟
  const cutMs = left > 5 * 60_000 ? 5 * 60_000 : (10 + Math.floor(Math.random() * 51)) * 1000;
  const etaAt = Math.max(now + 8_000, o.etaAt - cutMs);
  const savedSec = Math.round((o.etaAt - etaAt) / 1000);
  orders[idx] = { ...o, etaAt };
  mtSaveOrders(uid, orders);
  window.dispatchEvent(new CustomEvent('mt-orders-changed'));
  const leftMin = Math.ceil((etaAt - now) / 60_000);
  const msg =
    savedSec >= 60
      ? `已催单，骑手正在加急，预计提前${Math.floor(savedSec / 60)}分钟送达`
      : `已催单，骑手正在加急，预计提前${savedSec}秒送达（约${leftMin}分钟后送达）`;
  return { ok: true, msg, etaAt };
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

/** 结算合计：商品（含规格小料加价）- 满减/新客 + 配送费（满45免） */
export function mtCheckoutCalc(uid: string, merchant: MtMerchant, cart: MtCart): { itemTotal: number; deliveryFee: number; discount: number; total: number; labels: string[]; count: number } {
  const all = mtDishesOf(merchant);
  const itemTotal = cart.items.reduce((s, i) => {
    const d = all.find((x) => x.id === i.dishId);
    if (!d) return s;
    const unit = i.unitPrice ?? d.price;
    return s + unit * i.qty;
  }, 0);
  const count = cart.items.reduce((s, i) => s + i.qty, 0);
  const baseFee = merchant.deliveryFee;
  const deals = mtCalcDeals(uid, merchant, itemTotal, baseFee);
  const freeShip = itemTotal >= 45;
  const deliveryFee = freeShip ? 0 : baseFee;
  const total = Math.max(0.01, Math.round((itemTotal - deals.discount + deliveryFee) * 100) / 100);
  return { itemTotal, deliveryFee, discount: deals.discount, total, labels: deals.labels, count };
}

/** 从订单复制购物车（再来一单，保留规格小料） */
export function mtReorder(uid: string, o: MtOrder): boolean {
  const merchant = MT_MERCHANTS.find((m) => m.id === o.merchantId);
  if (!merchant) return false;
  const all = mtDishesOf(merchant);
  mtSaveCart(
    uid,
    {
      merchantId: merchant.id,
      items: o.items
        .filter((i) => all.some((d) => d.id === i.dishId))
        .map((i) => ({ dishId: i.dishId, qty: i.qty, spec: i.spec, unitPrice: i.price })),
    }
  );
  return true;
}

// ---------------- 优惠券（我的券，按账号隔离） ----------------

export interface MtCoupon {
  id: string;
  name: string;
  type: MtCouponType;
  /** 神券角标 */
  god: boolean;
  /** 面额 */
  amount: number;
  /** 门槛（满 min 可用） */
  min: number;
  /** 到期时间戳 */
  expireAt: number;
  /** 获得时间（最近获得排序） */
  obtainedAt: number;
  /** 使用时间（已使用置灰） */
  usedAt?: number;
}

const couponKey = (uid: string) => `mt-coupons:${uid}`;

export function mtLoadCoupons(uid: string): MtCoupon[] {
  const list = kvGet<Partial<MtCoupon>[]>(couponKey(uid));
  if (Array.isArray(list) && list.length > 0) {
    return list
      .filter((c): c is MtCoupon => Boolean(c) && typeof (c as MtCoupon).id === 'string' && typeof (c as MtCoupon).amount === 'number')
      .map((c) => ({ ...c, type: (c.type ?? 'waimai') as MtCouponType, usedAt: typeof c.usedAt === 'number' ? c.usedAt : undefined }));
  }
  // 首次播种（对齐真机截图1）
  const now = Date.now();
  const seeded: MtCoupon[] = MT_COUPON_SEED.map((s, i) => ({
    id: `cp${now.toString(36)}${i}`,
    name: s.name,
    type: s.type,
    god: s.god,
    amount: s.amount,
    min: s.min,
    expireAt: now + s.ttl,
    obtainedAt: now - (MT_COUPON_SEED.length - i) * 60_000,
  }));
  kvSet(couponKey(uid), seeded);
  return seeded;
}

export function mtSaveCoupons(uid: string, list: MtCoupon[]): void {
  kvSet(couponKey(uid), list.slice(0, 60));
}

/** 领神券/一键领取：发放 MT_GOD_CLAIMS 中未拥有的同名同面额券，返回新领张数 */
export function mtClaimGodCoupons(uid: string): number {
  const cur = mtLoadCoupons(uid);
  const now = Date.now();
  let added = 0;
  const next = [...cur];
  for (const s of MT_GOD_CLAIMS) {
    const exists = cur.some((c) => c.name === s.name && c.amount === s.amount && !c.usedAt);
    if (exists) continue;
    next.unshift({
      id: `cp${now.toString(36)}g${added}`,
      name: s.name,
      type: s.type,
      god: s.god,
      amount: s.amount,
      min: s.min,
      expireAt: now + s.ttl,
      obtainedAt: now,
    });
    added += 1;
  }
  if (added > 0) mtSaveCoupons(uid, next);
  return added;
}

/** 可用于下单的券（类型匹配 + 未使用 + 未过期 + 达到门槛），面额大在前 */
export function mtListUsableCoupons(uid: string, type: 'waimai' | 'daodian', itemTotal: number): { usable: MtCoupon[]; others: MtCoupon[] } {
  const now = Date.now();
  const all = mtLoadCoupons(uid).filter((c) => !c.usedAt && c.expireAt > now);
  const ok = all.filter((c) => c.type === type && itemTotal >= c.min);
  const notOk = all.filter((c) => !(c.type === type && itemTotal >= c.min));
  return { usable: ok.sort((a, b) => b.amount - a.amount), others: notOk };
}

/** 核销优惠券（下单时调用） */
export function mtUseCoupon(uid: string, couponId: string): void {
  const list = mtLoadCoupons(uid);
  mtSaveCoupons(
    uid,
    list.map((c) => (c.id === couponId ? { ...c, usedAt: Date.now() } : c))
  );
}

/** 券类型角标文案 */
export const mtCouponTypeLabel = (t: MtCouponType): string => MT_COUPON_TYPE_LABEL[t] ?? '外卖';

/** 种子类型再导出（UI 层构造用） */
export type { MtCouponSeed };
