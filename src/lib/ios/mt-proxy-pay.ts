'use client';

/**
 * 美团「找人代付」跨 App 链路（收银台 → 微信/QQ 聊天卡片 → 好友代付 → 完成卡片）：
 * - 发起：PayPage「找人代付」选平台（微信/QQ）+ 联系人 → 生成代付请求（IDB kv `mt-proxy:<id>`，
 *   全局键不按美团 uid 隔离——聊天侧好友代付时按 pid 取）→ 代付请求卡片写入该联系人聊天消息流
 *   （wx-chat-msgs:/qq-chat-msgs:，与一起听卡片同机制）→ 广播 MT_PROXY_CARD_EVENT
 *   让在场聊天页实时合并；订单挂 proxy 快照（OrdersPage/详情显示「已请 TA 代付」）；
 * - 代付：聊天里点卡片进代付详情（mt-proxy-detail.tsx）→「立即代付」（演示语义：好友以自己
 *   渠道付款，不扣本机钱包）→ 订单状态机接手（待接单/团购完成）+ 请求卡同步变已代付 +
 *   「代付完成卡片」回聊天 + 灵动岛通知（美团订单 · 好友已代付）；
 * - 退款语义：好友代付订单 refund 原路退回给代付人（payMethodId 不落本机账户 → mtRefundToOrigin
 *   自然跳过本机入账，仅展示「原路退还代付人」）。
 */
import { kvGet, kvSet } from './idb-kv';
import { getContact } from './contacts-store';
import { avatarFor, displayNameOf, isFriendIn, type ContactRecord } from '../contacts';
import { mtLoadOrders, mtSaveOrders, type MtOrder } from './meituan-store';

// ---------------- 数据模型 ----------------

export interface MtProxyItem {
  name: string;
  qty: number;
  price: number;
  spec?: string;
  emoji?: string;
  img?: string;
}

export interface MtProxyPay {
  id: string;
  /** 下单人的美团账号 uid（mt-orders:<uid> 定位订单用） */
  uid: string;
  orderId: string;
  /** 代付渠道平台 */
  idp: 'wx' | 'qq';
  /** 好友（联系人） */
  contactId: string;
  contactName: string;
  contactAvatar: string | null;
  /** 请求人（美团登录账号本人） */
  fromName: string;
  fromAvatar: string | null;
  merchantName: string;
  merchantEmoji: string;
  merchantImg?: string;
  amount: number;
  itemCount: number;
  items: MtProxyItem[];
  note?: string;
  status: 'pending' | 'paid';
  createdAt: number;
  paidAt?: number;
  /** 好友支付渠道名（微信支付 / QQ钱包） */
  paidChannel?: string;
}

/** 聊天里的代付卡片消息（微信 WxMsg / QQ QQMsg 同构，kind='mtpay'） */
export interface MtProxyCardMsg {
  id: string;
  role: 'me' | 'peer';
  content: string;
  time: number;
  kind: 'mtpay';
  /** pid = 代付请求 id；role：req=代付请求卡（我发给好友）/ done=代付完成卡（好友付完回我） */
  mtpay: { pid: string; role: 'req' | 'done' };
}

/** 卡片落库广播（聊天页在场时监听实时合并，与 TG_CARD_INSERTED_EVENT 同机制） */
export const MT_PROXY_CARD_EVENT = 'mt-proxy-card-inserted';

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

function genPid(): string {
  return `mtpx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function genMsgId(): string {
  return `mtpxm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 读取代付请求（容错规范化） */
export function mtGetProxy(pid: string): MtProxyPay | null {
  if (!pid) return null;
  const p = kvGet<Partial<MtProxyPay>>(`mt-proxy:${pid}`);
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.orderId !== 'string') return null;
  return {
    ...p,
    id: p.id,
    uid: typeof p.uid === 'string' ? p.uid : '',
    orderId: p.orderId,
    idp: p.idp === 'qq' ? 'qq' : 'wx',
    contactId: typeof p.contactId === 'string' ? p.contactId : '',
    contactName: typeof p.contactName === 'string' ? p.contactName : '好友',
    contactAvatar: typeof p.contactAvatar === 'string' ? p.contactAvatar : null,
    fromName: typeof p.fromName === 'string' ? p.fromName : '我',
    fromAvatar: typeof p.fromAvatar === 'string' ? p.fromAvatar : null,
    merchantName: typeof p.merchantName === 'string' ? p.merchantName : '美团商家',
    merchantEmoji: typeof p.merchantEmoji === 'string' ? p.merchantEmoji : '🍜',
    merchantImg: typeof p.merchantImg === 'string' ? p.merchantImg : undefined,
    amount: typeof p.amount === 'number' ? p.amount : 0,
    itemCount: typeof p.itemCount === 'number' ? p.itemCount : 0,
    items: Array.isArray(p.items)
      ? (p.items as MtProxyItem[]).filter((i) => i && typeof i.name === 'string').map((i) => ({
          name: i.name,
          qty: typeof i.qty === 'number' ? i.qty : 1,
          price: typeof i.price === 'number' ? i.price : 0,
          spec: typeof i.spec === 'string' && i.spec ? i.spec : undefined,
          emoji: typeof i.emoji === 'string' ? i.emoji : undefined,
          img: typeof i.img === 'string' ? i.img : undefined,
        }))
      : [],
    note: typeof p.note === 'string' && p.note ? p.note : undefined,
    status: p.status === 'paid' ? 'paid' : 'pending',
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
    paidAt: typeof p.paidAt === 'number' ? p.paidAt : undefined,
    paidChannel: typeof p.paidChannel === 'string' ? p.paidChannel : undefined,
  };
}

function mtSetProxy(p: MtProxyPay): void {
  kvSet(`mt-proxy:${p.id}`, p);
}

/** 平台支付渠道名（完成卡/详情页展示） */
export function mtProxyChannelName(idp: 'wx' | 'qq'): string {
  return idp === 'wx' ? '微信支付' : 'QQ钱包';
}

// ---------------- 聊天卡片写入 ----------------

function insertProxyCard(idp: 'wx' | 'qq', contactId: string, msg: MtProxyCardMsg): void {
  const key = `${idp === 'wx' ? 'wx' : 'qq'}-chat-msgs:${contactId}`;
  try {
    const cur = kvGet<unknown[]>(key) ?? [];
    kvSet(key, [...cur, msg].slice(-100));
  } catch {
    /* 落库失败静默 */
  }
  try {
    window.dispatchEvent(new CustomEvent(MT_PROXY_CARD_EVENT, { detail: { cid: contactId, app: idp } }));
  } catch {
    /* 广播失败不影响落库 */
  }
}

// ---------------- 发起代付请求 ----------------

export interface MtCreateProxyOpts {
  order: MtOrder;
  idp: 'wx' | 'qq';
  contactId: string;
  fromName: string;
  fromAvatar: string | null;
}

export type MtCreateProxyResult = { ok: true; proxy: MtProxyPay } | { ok: false; error: string };

/**
 * 发起代付：生成请求 + 订单挂 proxy + 请求卡进聊天。
 * 同一订单同一好友防重复；订单非待支付拒绝。
 */
export async function mtCreateProxyRequest(opts: MtCreateProxyOpts): Promise<MtCreateProxyResult> {
  const { order, idp, contactId, fromName, fromAvatar } = opts;
  if (order.status !== 'pendingPay') return { ok: false, error: '订单不是待支付状态，无法发起代付' };
  if (!contactId) return { ok: false, error: '请先选择代付好友' };
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(contactId);
  } catch {
    contact = null;
  }
  if (!contact || contact.kind === 'user') return { ok: false, error: '代付好友不存在或已删除' };
  if (!isFriendIn(contact, idp)) return { ok: false, error: `该好友不是${idp === 'wx' ? '微信' : 'QQ'}好友` };
  // 防重复：同订单同好友已有待处理请求
  const dup = findPendingProxyOfOrder(order.uid, order.id).find((p) => p.contactId === contactId);
  if (dup) return { ok: false, error: `已向${displayNameOf(contact)}发送过代付请求，等待TA付款` };

  const proxy: MtProxyPay = {
    id: genPid(),
    uid: order.uid,
    orderId: order.id,
    idp,
    contactId,
    contactName: displayNameOf(contact),
    contactAvatar: avatarFor(contact, idp),
    fromName,
    fromAvatar,
    merchantName: order.merchantName,
    merchantEmoji: order.merchantEmoji,
    merchantImg: order.merchantImg,
    amount: order.total,
    itemCount: order.items.reduce((s, i) => s + i.qty, 0),
    items: order.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, spec: i.spec, emoji: i.emoji, img: i.img })),
    note: order.note,
    status: 'pending',
    createdAt: Date.now(),
  };
  mtSetProxy(proxy);
  // pid 索引（防重复/扫单用；幂等追加）
  try {
    const idx = kvGet<string[]>('mt-proxy-index') ?? [];
    if (!idx.includes(proxy.id)) kvSet('mt-proxy-index', [...idx, proxy.id].slice(-50));
  } catch {
    /* 忽略 */
  }

  // 订单挂 proxy 快照（订单列表/详情显示「已请 TA 代付」）
  mtSaveOrders(
    order.uid,
    mtLoadOrders(order.uid).map((o) => (o.id === order.id ? { ...o, proxy: { id: proxy.id, name: proxy.contactName } } : o))
  );
  window.dispatchEvent(new CustomEvent('mt-orders-changed'));

  // 请求卡片进聊天（我发给好友）
  insertProxyCard(idp, contactId, {
    id: genMsgId(),
    role: 'me',
    content: `[美团代付]帮我付一下¥${fmt2(proxy.amount)}的订单`,
    time: Date.now(),
    kind: 'mtpay',
    mtpay: { pid: proxy.id, role: 'req' },
  });
  return { ok: true, proxy };
}

/** 某订单的全部待处理代付请求（索引扫，同订单同好友防重复用） */
export function findPendingProxyOfOrder(uid: string, orderId: string): MtProxyPay[] {
  void uid;
  const out: MtProxyPay[] = [];
  try {
    const ids = kvGet<string[]>('mt-proxy-index') ?? [];
    for (const pid of ids) {
      const p = mtGetProxy(pid);
      if (p && p.orderId === orderId && p.status === 'pending') out.push(p);
    }
  } catch {
    /* 忽略 */
  }
  return out;
}

// ---------------- 好友代付（聊天侧详情页「立即代付」） ----------------

export type MtProxyPayResult = { ok: true; proxy: MtProxyPay; order: MtOrder } | { ok: false; error: string };

/**
 * 好友代付：请求置 paid + 订单支付完成（状态机接手）+ 完成卡片回聊天 + 灵动岛通知。
 * 演示语义：好友以「微信支付/QQ钱包」付款，不扣本机任何钱包余额。
 */
export function mtProxyPayOrder(pid: string): MtProxyPayResult {
  const p = mtGetProxy(pid);
  if (!p) return { ok: false, error: '代付请求不存在或已被清理' };
  if (p.status !== 'pending') return { ok: false, error: '该代付请求已处理，请勿重复支付' };
  const orders = mtLoadOrders(p.uid);
  const idx = orders.findIndex((o) => o.id === p.orderId);
  if (idx < 0) return { ok: false, error: '订单不存在，代付请求失效' };
  const cur = orders[idx];
  if (cur.status !== 'pendingPay') return { ok: false, error: cur.status === 'canceled' ? '订单已取消，代付请求失效' : '订单已支付，无需重复代付' };

  const now = Date.now();
  const tuangou = cur.kind === 'tuangou';
  const channel = mtProxyChannelName(p.idp);
  const paid: MtOrder = {
    ...cur,
    status: tuangou ? 'completed' : 'pendingAccept',
    paidAt: now,
    ...(tuangou ? {} : { etaAt: now + 45 * 60_000 }),
    payIdp: p.idp,
    payChannelLabel: `好友代付 · ${channel}（${p.contactName}）`,
    // 好友代付不落本机账户渠道：退款原路退还代付人（mtRefundToOrigin 无 methodId 自然跳过本机入账）
    payMethodId: undefined,
    payFc: false,
    statusLog: [...cur.statusLog, { status: tuangou ? 'completed' : 'pendingAccept', at: now }],
  };
  orders[idx] = paid;
  mtSaveOrders(p.uid, orders);

  const done: MtProxyPay = { ...p, status: 'paid', paidAt: now, paidChannel: channel };
  mtSetProxy(done);

  // 完成卡片（好友发回给我）
  insertProxyCard(p.idp, p.contactId, {
    id: genMsgId(),
    role: 'peer',
    content: `[美团代付]已帮你代付¥${fmt2(p.amount)}`,
    time: now,
    kind: 'mtpay',
    mtpay: { pid: p.id, role: 'done' },
  });

  window.dispatchEvent(new CustomEvent('mt-orders-changed'));
  // 灵动岛通知（美团订单 · 好友已代付；点击进订单详情）
  void import('./island-notify')
    .then((m) =>
      m.pushChatNotification({
        sessionKey: `mt:order:${paid.id}`,
        app: 'meituan',
        title: '美团订单',
        avatar: '/icons/meituan.png',
        body: `好友${p.contactName}已代付¥${fmt2(p.amount)}，订单已支付`,
        target: { app: 'meituan', contactId: paid.id },
      })
    )
    .catch(() => undefined);
  return { ok: true, proxy: done, order: paid };
}
