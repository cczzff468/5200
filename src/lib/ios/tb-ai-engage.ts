'use client';

/**
 * 淘宝 AI 联动引擎（对齐美团 mt-ai-engage 同一套交互口径）：
 * - 上下文注入 buildTbEngageCtx：机主淘宝订单实时动态（AI 知道买了什么/哪家店/多少钱/快递状态）
 *   + 待付订单 [帮付淘宝]（AI 按人设/记忆/关系主动代付）+ 在途快递 [帮取快递]（帮机主取件）
 *   + 聊到购物时的商品目录与 [帮你买]（AI 代买草稿，机主确认后 AI 出钱下单）
 *   与 [自己买]（AI 自己想要，下单后请机主代付）教学；
 * - 动作执行 applyTbEngageAction：帮付/代买草稿/自己买/帮取快递四类标记落地；
 * - 礼物链路：机主分享订单后说「给你买的」→ 自动标记礼物（AI 上下文可感知），包裹到驿站后
 *   AI 自主取件（tbEngageTick）+ 道谢记忆——卡片上的「已签收」在 AI 取完才出现；
 * - 主动参与：tbEngageTick 发现机主有待付款订单时，最近聊天的 AI 角色按人设/记忆决定要不要
 *   主动帮忙付掉（每单只问一次 + 全局冷却 + 金额上限，不刷屏）；到货/发货还会低频主动问一句；
 * - 全部动作写事件记忆（memAddEventFragment），代付/订单互相关联（订单挂 proxy 快照）。
 */
import { kvGet, kvSet } from './idb-kv';
import { getContact, ownerProfileFor, listContacts } from './contacts-store';
import { avatarFor, isFriendIn, type ContactRecord } from '../contacts';
import { buildPersonaSystemPrompt } from './persona';
import { getMemSettings } from '@/lib/memory';
import { memChatRecallBlock, memAddEventFragment } from '@/lib/memory';
import { getTimeAware, buildTimeAwareBlock } from '@/lib/time-aware';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { getActiveAccountIdFor, getActiveAccountFor, type AccountApp } from './accounts';
import { productById, shopById, tbSearchPool } from './taobao-data';
import {
  tbArrivedAtStation,
  tbConfirmReceive,
  tbCreateOrder,
  tbCurAddr,
  tbGetSession,
  tbLoadOrders,
  tbMainImg,
  tbSaveOrders,
  tbStatusText,
  tbUidOf,
  type TbOrder,
  type TbOrderItem,
} from './taobao-store';
import {
  TB_PROXY_CARD_EVENT,
  tbAiPayPendingOrder,
  tbCreateProxyRequestByChar,
  tbGetProxy,
  tbGetShare,
  tbPendingProxiesOfChat,
  tbShareOrderOf,
} from './tb-share-proxy';
import { callTbLlm, extractJsonObject, deliverPeerMsgs } from './tb-proxy-ai';
import type { RichAction } from '@/lib/chat-rich';

export type TbEngageApp = 'wx' | 'qq';

/** 主动参与金额上限（¥）：超过需机主明确同意才帮付/代买（对齐美团口径，淘宝物价略高） */
export const TB_ENGAGE_AMOUNT_CAP = 150;
/** 硬顶：超过直接不参与（LLM 都不用问） */
export const TB_ENGAGE_AMOUNT_HARD = 300;
/** 主动参与冷却（同一角色 5 分钟内只主动一次） */
export const TB_ENGAGE_COOLDOWN_MS = 5 * 60_000;
/** 全局主动代付冷却（防多单连发打扰） */
const PROACTIVE_PAY_CD_MS = 3 * 60_000;
/** 到货主动问候冷却 */
const ARRIVAL_COMMENT_CD_MS = 10 * 60_000;
/** 礼物说明的追溯窗口（分享后 2 小时内说「给你买的」都算） */
const GIFT_WINDOW_MS = 2 * 60 * 60_000;

const engageCdKey = (app: TbEngageApp, charId: string): string => `tb-engage-cd:${app}:${charId}`;

export function tbEngageCoolingDown(app: TbEngageApp, charId: string): boolean {
  const at = kvGet<number>(engageCdKey(app, charId));
  return typeof at === 'number' && Date.now() - at < TB_ENGAGE_COOLDOWN_MS;
}

export function tbMarkEngage(app: TbEngageApp, charId: string): void {
  kvSet(engageCdKey(app, charId), Date.now());
}

function globalCoolingDown(key: string, ms: number): boolean {
  const at = kvGet<number>(key);
  return typeof at === 'number' && Date.now() - at < ms;
}

function markGlobal(key: string): void {
  kvSet(key, Date.now());
}

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ownerNameSync(): string {
  try {
    const s = tbGetSession();
    return s?.name || '机主';
  } catch {
    return '机主';
  }
}

/** 角色人设 system 段（人设+机主称呼+账号上下文；主动消息/取件道谢等场景共用） */
async function tbPersonaSystemFor(contact: ContactRecord, app: TbEngageApp): Promise<string> {
  const meName = ownerNameSync();
  return buildPersonaSystemPrompt(contact, {
    channel: app === 'wx' ? '微信' : 'QQ',
    userName: meName,
    userRealName: meName,
    userNickname: null,
    ownerName: meName,
    accountId: getActiveAccountIdFor(app as AccountApp),
    multiApp: getMemSettings(contact.id).share,
  });
}

// ---------------- 购物话题扫描（目录/代买教学只在聊到买时注入，平时不占 token） ----------------

const SHOP_TEXT_RE =
  /(淘宝|买|购物|购物车|下单|种草|剁手|好物|商品|店铺|包邮|快递|包裹|取件|驿站|签收|收货|发货|物流|双十一|双11|618|年货|礼物|缺什么|推荐一|安利)/;

export function tbScanShopText(texts: (string | undefined | null)[]): boolean {
  for (const t of texts) {
    if (typeof t === 'string' && t && SHOP_TEXT_RE.test(t)) return true;
  }
  return false;
}

/** 机主说明「订单是给 AI 买的」的表达（礼物链路自动标记用） */
const GIFT_TEXT_RE = /(给你买|买给你|送给你|送你的|买给你的|给你的礼物|给你带|给你准备的)/;

// ---------------- 商品目录（AI 推荐口径：多品类抽样，id 原样输出用） ----------------

function catalogBlock(): string {
  try {
    // 种子 + AI 注册商品，同 tag 去重抽样（品类多样，AI 推荐不总是一类）
    const all = tbSearchPool().filter((p) => p.id && p.title && p.price > 0);
    const seenTag = new Set<string>();
    const picked: typeof all = [];
    for (const p of all) {
      if (picked.length >= 24) break;
      if (seenTag.has(p.tag)) continue;
      seenTag.add(p.tag);
      picked.push(p);
    }
    if (picked.length === 0) return '';
    const lines = picked.map((p) => `· id=${p.id} ${p.title.slice(0, 30)} ¥${fmt2(p.price)}`);
    return `【淘宝在售商品目录】（推荐/代买只能从这个清单里选，id 必须原样抄写）\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

// ---------------- AI 代买草稿（kind='tbdraft'，机主确认后 AI 出钱下单） ----------------

export interface TbAiDraft {
  id: string;
  /** 淘宝账号 uid（订单归属） */
  uid: string;
  /** 商品（taobao-data 商品库，含 AI 注册表） */
  pid: string;
  title: string;
  img?: string;
  price: number;
  qty: number;
  shopId: string;
  shopName: string;
  /** 发起的 AI 角色 */
  charId: string;
  charName: string;
  app: TbEngageApp;
  status: 'pending' | 'confirmed' | 'declined';
  createdAt: number;
  orderId?: string;
  /** 实付金额（确认下单后回填） */
  total?: number;
}

export const TB_DRAFT_EVENT = 'tb-draft-changed';

function genDid(): string {
  return `tbdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function bumpDraftIndex(did: string): void {
  try {
    const idx = kvGet<string[]>('tb-draft-index') ?? [];
    if (!idx.includes(did)) kvSet('tb-draft-index', [...idx, did].slice(-30));
  } catch {
    /* 忽略 */
  }
}

function fireDraftEvent(): void {
  try {
    window.dispatchEvent(new CustomEvent(TB_DRAFT_EVENT));
  } catch {
    /* 忽略 */
  }
}

export function tbGetDraft(did: string): TbAiDraft | null {
  if (!did) return null;
  const d = kvGet<Partial<TbAiDraft>>(`tb-draft:${did}`);
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || typeof d.pid !== 'string') return null;
  return {
    ...d,
    id: d.id,
    uid: typeof d.uid === 'string' ? d.uid : '',
    pid: d.pid,
    title: typeof d.title === 'string' ? d.title : '淘宝商品',
    img: typeof d.img === 'string' && d.img ? d.img : undefined,
    price: typeof d.price === 'number' ? d.price : 0,
    qty: typeof d.qty === 'number' && d.qty > 0 ? d.qty : 1,
    shopId: typeof d.shopId === 'string' ? d.shopId : '',
    shopName: typeof d.shopName === 'string' ? d.shopName : '淘宝好店',
    charId: typeof d.charId === 'string' ? d.charId : '',
    charName: typeof d.charName === 'string' ? d.charName : '好友',
    app: d.app === 'qq' ? 'qq' : 'wx',
    status: d.status === 'confirmed' ? 'confirmed' : d.status === 'declined' ? 'declined' : 'pending',
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
    orderId: typeof d.orderId === 'string' ? d.orderId : undefined,
    total: typeof d.total === 'number' ? d.total : undefined,
  };
}

export type TbCreateDraftResult = { ok: true; draft: TbAiDraft } | { ok: false; error: string };

/** 创建 AI 代买草稿（商品必须存在于商品库；金额按商品价 × 数量预估） */
export function tbCreateAiDraft(opts: {
  uid: string;
  pid: string;
  qty?: number;
  charId: string;
  charName: string;
  app: TbEngageApp;
}): TbCreateDraftResult {
  const p = productById(opts.pid);
  if (!p) return { ok: false, error: '没有找到这个商品，换一个推荐吧' };
  const qty = Math.max(1, Math.min(5, Math.round(opts.qty ?? 1)));
  const draft: TbAiDraft = {
    id: genDid(),
    uid: opts.uid,
    pid: p.id,
    title: p.title,
    img: tbMainImg(p),
    price: p.price,
    qty,
    shopId: p.shopId,
    shopName: shopById(p.shopId).name,
    charId: opts.charId,
    charName: opts.charName,
    app: opts.app,
    status: 'pending',
    createdAt: Date.now(),
  };
  kvSet(`tb-draft:${draft.id}`, draft);
  bumpDraftIndex(draft.id);
  fireDraftEvent();
  return { ok: true, draft };
}

export function tbDeclineAiDraft(did: string): boolean {
  const d = tbGetDraft(did);
  if (!d || d.status !== 'pending') return false;
  kvSet(`tb-draft:${did}`, { ...d, status: 'declined' });
  fireDraftEvent();
  return true;
}

export type TbConfirmDraftResult = { ok: true; orderId: string; total: number } | { ok: false; error: string };

/**
 * 机主确认 AI 代买：创建待付款订单（地址用当前收货地址）→ AI 立即付款（演示语义）
 * → 订单分享卡（role peer，「X已买单」）回聊天 + 角色记忆。商品下架时拒绝。
 */
export function tbConfirmAiDraft(did: string): TbConfirmDraftResult {
  const d = tbGetDraft(did);
  if (!d) return { ok: false, error: '代买请求不存在或已过期' };
  if (d.status !== 'pending') return { ok: false, error: '这张代买请求已经处理过了' };
  const p = productById(d.pid);
  if (!p) return { ok: false, error: '商品已下架，没法下单啦' };
  const item: TbOrderItem = { pid: p.id, title: p.title, img: tbMainImg(p), sku: {}, price: p.price, qty: d.qty };
  const order = tbCreateOrder({ uid: d.uid, items: [item], address: tbCurAddr(d.uid) ?? undefined });
  // 先落确认态防重复点击（金额以订单为准）
  kvSet(`tb-draft:${did}`, { ...d, status: 'confirmed', orderId: order.id, total: order.total });
  fireDraftEvent();
  try {
    window.dispatchEvent(new CustomEvent('tb-orders-changed'));
  } catch {
    /* 忽略 */
  }
  // AI 出钱：建 friend 方向代付记录并立即支付（完成回执卡丢弃，用订单分享卡替代）
  void Promise.resolve()
    .then(() =>
      tbAiPayPendingOrder(order, { id: d.charId, name: d.charName, avatar: null }, d.app),
    )
    .catch(() => undefined);
  // 订单分享卡（AI 发给机主，「X已买单」+ 实时状态时间线）+ 记忆
  void (async () => {
    try {
      const { tbCreateOrderShare } = await import('./tb-share-proxy');
      const fresh = tbLoadOrders(d.uid).find((o) => o.id === order.id) ?? order;
      await tbCreateOrderShare({
        order: fresh,
        idp: d.app,
        contactId: d.charId,
        fromName: d.charName,
        role: 'peer',
        paidBy: d.charName,
        content: `[淘宝订单分享]帮你在「${fresh.shopName}」下单啦，我付好了~`,
      });
    } catch {
      /* 分享卡失败不影响下单 */
    }
    const meName = ownerNameSync();
    memAddEventFragment(
      d.charId,
      d.app,
      `你帮机主${meName}在淘宝「${d.shopName}」下单了「${d.title}」（¥${fmt2(order.total)}），已由你付款`,
      { eventTime: Date.now(), sourceTag: 'tb-buy-for' },
    );
  })();
  return { ok: true, orderId: order.id, total: order.total };
}

// ---------------- 上下文注入（wechat/qq 私聊每回合构建） ----------------

export interface TbEngageCtx {
  /** 注入 system 的动态块（机主淘宝订单实时动态） */
  block: string;
  /** 追加到处理动作规则后的段落（礼物标记/待付订单/快递/代买教学；按条件出现） */
  rules: string[];
}

function orderBrief(o: TbOrder): string {
  const items = o.items.map((i) => `${i.title.slice(0, 14)}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、');
  return `· ${fmtClock(o.createdAt)} 「${o.shopName}」 ${items} ¥${fmt2(o.total)} · ${tbStatusText(o)}`;
}

/**
 * 每回合现场构建（全同步 kv 读 + 礼物标记副作用）。
 * 礼物扫描：机主本轮/最近几句话说「给你买的」→ 自动给本聊天最近的未标记分享卡标记 gift
 * （同时把 aiPickup 写到订单上，到驿站后由 watcher 触发 AI 自主取件），并下发规则让 AI 本轮自然回应。
 */
export function buildTbEngageCtx(
  chatContactId: string,
  app: TbEngageApp,
  recentTexts: (string | undefined | null)[],
): TbEngageCtx {
  const empty: TbEngageCtx = { block: '', rules: [] };
  let session: ReturnType<typeof tbGetSession> = null;
  try {
    session = tbGetSession();
  } catch {
    session = null;
  }
  if (!session) return empty;
  const uid = tbUidOf(session);
  const owner = ownerNameSync();
  const orders = tbLoadOrders(uid);
  const rules: string[] = [];

  // —— 礼物自动标记（幂等）：说「给你买的」+ 本聊天 2h 内未标记的分享卡 → gift
  const giftHit = GIFT_TEXT_RE.test(recentTexts.filter((t): t is string => typeof t === 'string').join(' '));
  if (giftHit) {
    try {
      const ids = kvGet<string[]>('tb-share-index') ?? [];
      const candidates = ids
        .map((sid) => tbGetShare(sid))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .filter((s) => s.idp === app && s.contactId === chatContactId && !s.gift && !s.paidBy && Date.now() - s.createdAt < GIFT_WINDOW_MS)
        .sort((a, b) => b.createdAt - a.createdAt);
      const target = candidates[0];
      if (target) {
        kvSet(`tb-share:${target.id}`, { ...target, gift: true });
        const order = tbShareOrderOf(target);
        if (order && !order.aiPickup && order.status !== 'completed' && order.status !== 'cancelled' && !order.ticket) {
          const list = tbLoadOrders(uid);
          const hit = list.find((o) => o.id === order.id);
          if (hit && !hit.aiPickup) {
            hit.aiPickup = { contactId: chatContactId, contactName: target.contactName, app, kind: 'gift' };
            tbSaveOrders(uid, list);
            try {
              window.dispatchEvent(new CustomEvent('tb-orders-changed'));
            } catch {
              /* 忽略 */
            }
          }
        }
        memAddEventFragment(
          chatContactId,
          app,
          `机主${owner}把淘宝「${target.shopName}」的订单（${target.items.map((i) => `${i.name}x${i.qty}`).join('、')}，¥${fmt2(target.amount)}）送给你了，说这是给你买的——包裹到驿站后你要自己去取`,
          { eventTime: Date.now(), sourceTag: 'tb-gift' },
        );
        rules.push(
          `【机主送你的礼物】机主刚说明淘宝「${target.shopName}」的订单（${target.items.map((i) => `${i.name}x${i.qty}`).join('、')}）是送你的礼物。按你的人设自然回应（开心/感谢/惊喜都可以），包裹到驿站后系统会提醒你去取，不用现在承诺什么。`,
        );
      }
    } catch {
      /* 礼物标记失败不影响聊天 */
    }
  }

  // —— 动态块：最近订单（AI 知道机主买了什么/哪家店/多少钱/什么时候/快递状态，可自然提起、主动问）
  const recent = orders.filter((o) => o.status !== 'cancelled' && !o.ticket).slice(0, 5);
  const block = recent.length > 0
    ? `【${owner}的淘宝动态】（实时状态，可以自然提起、主动关心快递进度）\n${recent.map(orderBrief).join('\n')}`
    : '';

  // —— AI 自己发出去的代付请求（等机主付）
  const mePending = tbPendingProxiesOfChat(chatContactId).filter((p) => p.direction === 'me');
  if (mePending.length > 0) {
    rules.push(
      `【你发出去的淘宝代付请求（等机主帮你付）】\n${mePending.map((p) => `· 淘宝店「${p.shopName}」 ¥${fmt2(p.amount)}（${p.items.map((i) => `${i.name}x${i.qty}`).join('、')}）· 待机主支付`).join('\n')}\n可以自然提起（按人设撒娇催一催），机主点卡片就能帮你付；不要重复发请求。`,
    );
  }

  // —— 待付款订单 → [帮付淘宝:订单id]（一/五：AI 按人设记忆判断是否主动代付）
  const proxyOrderIds = new Set<string>();
  try {
    for (const pid of kvGet<string[]>('tb-proxy-index') ?? []) {
      const p = tbGetProxy(pid);
      if (p && p.status === 'pending') proxyOrderIds.add(p.orderId);
    }
  } catch {
    /* 忽略 */
  }
  const helpable = orders.filter((o) => o.status === 'pendingPay' && !proxyOrderIds.has(o.id));
  if (helpable.length > 0) {
    const lines = helpable.slice(0, 4).map((o) => `· 订单id=${o.id} 淘宝店「${o.shopName}」 ${o.items.map((i) => `${i.title.slice(0, 14)}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、')} ¥${fmt2(o.total)}`);
    rules.push(
      `【${owner}的待付款淘宝订单】\n${lines.join('\n')}\n` +
        `如果符合你的人设、你们的关系和上面的记忆（说好要送TA、想宠TA、TA正好缺这个、金额不大等），可以主动帮TA付掉：输出标记 [帮付淘宝:订单id]（id 必须原样抄写，系统会立即支付并回执）。` +
        `单笔超过 ¥${TB_ENGAGE_AMOUNT_CAP} 时先在正文提议「我帮你付了吧」，对方明确同意（说「好呀」「帮我付」等）后再发标记；金额不大也别每次都抢着付。`,
    );
  }

  // —— 在途快递 → [帮取快递:订单id]（机主开口让 AI 取件）
  const express = orders.filter((o) => o.status === 'shipped' && !o.ticket && !o.aiPickup);
  if (express.length > 0) {
    const lines = express.slice(0, 4).map((o) => `· 订单id=${o.id} 淘宝店「${o.shopName}」 ${o.items.map((i) => `${i.title.slice(0, 14)}`).join('、')} · ${tbArrivedAtStation(o) ? '已到驿站待取件' : '还在路上'}`);
    rules.push(
      `【${owner}的淘宝快递】\n${lines.join('\n')}\n` +
        `机主让你帮忙取快递/取件时：输出标记 [帮取快递:订单id]（id 原样抄写）。已到驿站的会立即取好；还在路上的会记下来，到驿站后你自动去取并回消息。取完记得按人设说一句。`,
    );
  }

  // —— 购物话题 → 商品目录 + [帮你买]（代买草稿）/ [自己买]（自己买请机主付）
  if (tbScanShopText(recentTexts)) {
    const cat = catalogBlock();
    if (cat) {
      rules.push(
        `${cat}\n\n` +
          `【帮机主买淘宝商品（你出钱）】聊到想买什么/缺什么/让你推荐时，结合你记得的偏好、当前季节节日、机主买过的东西先聊几句或直接推荐；机主同意后输出标记 [帮你买:商品id|数量?]（id 原样抄目录，数量可省略默认 1）。系统会生成一张代买卡片，机主确认后你立即付款下单，TA会收到一张已支付的订单卡片（实时显示快递状态）。注意：单笔超过 ¥${TB_ENGAGE_AMOUNT_CAP} 要机主明确同意后才发标记；别频繁送。\n` +
          `【你自己想买（机主出钱）】你自己种草了什么/缺什么的时候（按人设判断，别频繁），输出标记 [自己买:商品id|数量?]——系统会生成待付款订单并请机主帮你代付，记得用正文说一句让TA帮你付。`,
      );
    }
  }

  if (tbEngageCoolingDown(app, chatContactId)) {
    rules.push(
      '【参与节流】你刚刚（5分钟内）已经主动帮付/代买/取件过一次了（冷却中）：这一轮不要再输出 [帮付淘宝]/[帮你买]/[自己买] 标记（发了系统也不会执行），用正文正常聊就好。',
    );
  }
  return { block, rules };
}

// ---------------- 动作执行（wechat/qq buildReplyMsgs 分流调用） ----------------

export type TbEngageActionKind = 'tb-pay-for' | 'tb-order-draft' | 'tb-order-self' | 'tb-pickup';

export function isTbEngageActionKind(kind: string): kind is TbEngageActionKind {
  return kind === 'tb-pay-for' || kind === 'tb-order-draft' || kind === 'tb-order-self' || kind === 'tb-pickup';
}

/** 执行器产出的卡片消息（微信 WxMsg / QQ QQMsg 结构子集，直接 push 进回复队列） */
export type TbEngageCard =
  | { id: string; role: 'peer'; content: string; time: number; kind: 'tbpay'; tbpay: { pid: string; role: 'req' | 'done' } }
  | { id: string; role: 'peer'; content: string; time: number; kind: 'tbdraft'; tbdraft: { did: string } };

export interface TbEngageExecResult {
  msgs: TbEngageCard[];
  /** 需要以系统行展示的提示（执行失败原因等）；空 = 静默 */
  sys?: string;
}

/** 异步流失败的系统提示行直写聊天并广播（与美团 insertEngageSys 同款） */
function insertEngageSys(app: TbEngageApp, contactId: string, text: string): void {
  try {
    const key = `${app}-chat-msgs:${contactId}`;
    const cur = kvGet<unknown[]>(key) ?? [];
    kvSet(key, [
      ...cur,
      { id: `tbsy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, role: 'peer', content: '', time: Date.now(), kind: 'sys', sys: { text } },
    ].slice(-100));
  } catch {
    /* 落库失败静默 */
  }
  try {
    window.dispatchEvent(new CustomEvent(TB_PROXY_CARD_EVENT, { detail: { cid: contactId, app } }));
  } catch {
    /* 忽略 */
  }
}

export function tbEngageSessionUid(): { uid: string; name: string } | null {
  try {
    const s = tbGetSession();
    return s ? { uid: tbUidOf(s), name: s.name } : null;
  } catch {
    return null;
  }
}

/** 机主联系人（direction 'me' 代付的付款人；与美团 mtOwnerContactFor 同口径） */
export async function tbOwnerContactFor(app: TbEngageApp): Promise<{ id: string; name: string; avatar: string | null } | null> {
  try {
    const acc = getActiveAccountFor(app as AccountApp);
    const all = await listContacts();
    let me = acc.kind === 'main' ? all.find((c) => c.kind === 'user' && !c.altOf) : (all.find((c) => c.altOf === acc.id) ?? (acc.ownerContactId ? all.find((c) => c.id === acc.ownerContactId) : undefined));
    if (!me) me = all.find((c) => c.kind === 'user' && !c.altOf);
    if (!me) return null;
    const name = (me.nickname?.trim() || me.name || '').trim() || '我';
    return { id: me.id, name, avatar: avatarFor(me, app) };
  } catch {
    return null;
  }
}

/** [帮付淘宝/自己买/帮你买] 的「机主已明确同意」判定（与美团 mtEngageConsented 同词表） */
const TB_CONSENT_RE = /(好呀|好啊|好吧|可以呀|可以的|同意|请吧|请我|帮我付|帮我买单|帮我取|买吧|下单吧|交给你了|麻烦你啦|谢谢你|那就拜托|安排上)/;
function tbConsented(texts: (string | undefined | null)[]): boolean {
  return texts.some((t) => typeof t === 'string' && t && TB_CONSENT_RE.test(t));
}

export function applyTbEngageAction(
  action: RichAction,
  peer: ContactRecord,
  opts: { app: TbEngageApp; meName?: string; recentTexts?: (string | undefined | null)[] },
): TbEngageExecResult {
  const now = Date.now();
  const kind = action.kind;
  const meName = opts.meName?.trim() || ownerNameSync() || '机主';
  const uidInfo = tbEngageSessionUid();

  if (kind === 'tb-pay-for') {
    // [帮付淘宝:订单id]：AI 主动为机主的待付款订单代付（立即建代付记录并支付，完成卡异步投递）
    if (!uidInfo) return { msgs: [], sys: '（淘宝尚未登录，无法帮付）' };
    const order = tbLoadOrders(uidInfo.uid).find((o) => o.id === action.targetId.trim());
    if (!order || order.status !== 'pendingPay') return { msgs: [], sys: '（订单不存在或已支付）' };
    if (tbEngageCoolingDown(opts.app, peer.id)) {
      return { msgs: [], sys: '（刚刚才帮付/代买过一次，先歇一歇，这次先不帮付啦）' };
    }
    if (order.total > TB_ENGAGE_AMOUNT_CAP && !tbConsented(opts.recentTexts ?? [])) {
      return { msgs: [], sys: `（这笔¥${fmt2(order.total)}有点大，先在正文里问一句对方同不同意，同意后再帮付吧）` };
    }
    const res = tbAiPayPendingOrder(order, { id: peer.id, name: peer.name, avatar: avatarFor(peer, opts.app) }, opts.app);
    if (!res.ok) return { msgs: [], sys: `（帮付未成功：${res.error}）` };
    tbMarkEngage(opts.app, peer.id);
    const summary = order.items.map((i) => `${i.title.slice(0, 14)}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、');
    memAddEventFragment(peer.id, opts.app, `你主动帮机主${meName}付了淘宝「${order.shopName}」¥${fmt2(order.total)}的订单（${summary}）`, { eventTime: now, sourceTag: 'tb-help-pay' });
    return { msgs: res.card ? [res.card as TbEngageCard] : [] };
  }

  if (kind === 'tb-order-draft') {
    // [帮你买:商品id|数量?]：生成 AI 代买草稿卡（机主确认后 AI 出钱下单）
    if (!uidInfo) return { msgs: [], sys: '（淘宝尚未登录，无法代买）' };
    const body = parseTbBuyBody(action.targetId);
    if (!body) return { msgs: [], sys: '（代买格式有误，未能下单）' };
    const p = productById(body.pid);
    if (!p) return { msgs: [], sys: '（没有找到这个商品，没法代买）' };
    if (p.price * body.qty > TB_ENGAGE_AMOUNT_HARD && !tbConsented(opts.recentTexts ?? [])) {
      return { msgs: [], sys: `（这件要¥${fmt2(p.price * body.qty)}，先在正文里问一句，机主同意后再发标记才能下单）` };
    }
    const res = tbCreateAiDraft({ uid: uidInfo.uid, pid: body.pid, qty: body.qty, charId: peer.id, charName: peer.name, app: opts.app });
    if (!res.ok) return { msgs: [], sys: `（代买失败：${res.error}）` };
    return {
      msgs: [{
        id: `tbdm-${res.draft.id}`,
        role: 'peer',
        content: `[淘宝代买]帮你看好了「${res.draft.title.slice(0, 18)}」，确认后就下单`,
        time: now,
        kind: 'tbdraft',
        tbdraft: { did: res.draft.id },
      }],
    };
  }

  if (kind === 'tb-order-self') {
    // [自己买:商品id|数量?]：异步流——建待付款订单 + 请机主代付（direction 'me' 请求卡）
    if (!uidInfo) return { msgs: [], sys: '（淘宝尚未登录，无法下单）' };
    const body = parseTbBuyBody(action.targetId);
    if (!body) return { msgs: [], sys: '（下单格式有误）' };
    if (tbEngageCoolingDown(opts.app, peer.id)) {
      return { msgs: [], sys: '（刚刚才帮付/代买/点过一次，先歇一歇，这次先不买啦）' };
    }
    const p = productById(body.pid);
    if (!p) return { msgs: [], sys: '（没有找到这个商品，没法下单）' };
    void tbSelfOrderFlow(body, peer, opts).catch(() => undefined);
    return { msgs: [] };
  }

  // tb-pickup：[帮取快递:订单id] —— 已到驿站立即取；没到先记下（到驿站自动取）
  const order = uidInfo ? tbLoadOrders(uidInfo.uid).find((o) => o.id === action.targetId.trim()) : null;
  if (!order || order.ticket) return { msgs: [], sys: '（快递订单不存在）' };
  if (order.status === 'completed') return { msgs: [], sys: '（这个快递已经取过了）' };
  if (order.status !== 'shipped') return { msgs: [], sys: '（还没发货呢，先别急着取）' };
  if (order.aiPickup) return { msgs: [] };
  const list = tbLoadOrders(uidInfo!.uid);
  const hit = list.find((o) => o.id === order.id);
  if (!hit) return { msgs: [], sys: '（快递订单不存在）' };
  hit.aiPickup = { contactId: peer.id, contactName: peer.name, app: opts.app, kind: 'favor' };
  tbSaveOrders(uidInfo!.uid, list);
  memAddEventFragment(peer.id, opts.app, `机主${meName}让你帮忙取淘宝「${hit.shopName}」的快递（${hit.items.map((i) => i.title.slice(0, 12)).join('、')}），你答应了${tbArrivedAtStation(hit) ? '，已经去取好啦' : '，到驿站后你会去取'}`, { eventTime: now, sourceTag: 'tb-pickup' });
  if (tbArrivedAtStation(hit)) {
    // 已到驿站：当场取掉（watcher 也会兜底，这里立即执行让回复即时生效）
    void tbRunPickup(uidInfo!.uid, order.id).catch(() => undefined);
  }
  return { msgs: [] };
}

/** [自己买] 异步全流程：建单 → direction 'me' 代付请求（卡片经事件合并进聊天）→ 角色记忆 */
async function tbSelfOrderFlow(
  body: { pid: string; qty: number },
  peer: ContactRecord,
  opts: { app: TbEngageApp; meName?: string },
): Promise<void> {
  const uidInfo = tbEngageSessionUid();
  if (!uidInfo) return;
  const p = productById(body.pid);
  if (!p) {
    insertEngageSys(opts.app, peer.id, '（没有找到这个商品，没法下单）');
    return;
  }
  const item: TbOrderItem = { pid: p.id, title: p.title, img: tbMainImg(p), sku: {}, price: p.price, qty: body.qty };
  const order = tbCreateOrder({ uid: uidInfo.uid, items: [item], address: tbCurAddr(uidInfo.uid) ?? undefined });
  const payer = await tbOwnerContactFor(opts.app);
  if (!payer) {
    insertEngageSys(opts.app, peer.id, '（代付请求没有发出去：找不到机主的联系人信息）');
    return;
  }
  await tbCreateProxyRequestByChar({
    order,
    idp: opts.app,
    char: { id: peer.id, name: peer.name, avatar: avatarFor(peer, opts.app) },
    payer,
  });
  tbMarkEngage(opts.app, peer.id);
  const meName = opts.meName?.trim() || ownerNameSync() || '机主';
  memAddEventFragment(peer.id, opts.app, `你在淘宝给自己拍了「${p.title}」（¥${fmt2(order.total)}），请机主${meName}帮你代付`, { eventTime: order.createdAt, sourceTag: 'tb-self-order' });
}

// ---------------- watcher 联动（tbEngageTick，淘宝订单状态机每 10s 接力） ----------------

/** 最近聊过天的 AI 角色（跨微信/QQ，主动参与/到货问候的发起人；无候选返回 null） */
async function tbPickRecentAiChat(): Promise<{ app: TbEngageApp; contact: ContactRecord } | null> {
  try {
    const all = await listContacts();
    let best: { app: TbEngageApp; contact: ContactRecord; t: number } | null = null;
    for (const c of all) {
      if (c.kind === 'user') continue;
      for (const app of ['wx', 'qq'] as const) {
        if (!isFriendIn(c, app)) continue;
        const msgs = kvGet<{ time?: number }[]>(`${app}-chat-msgs:${c.id}`);
        const t = Array.isArray(msgs) && msgs.length > 0 ? (msgs[msgs.length - 1]?.time ?? 0) : 0;
        if (t > 0 && (!best || t > best.t)) best = { app, contact: c, t };
      }
    }
    return best ? { app: best.app, contact: best.contact } : null;
  } catch {
    return null;
  }
}

/**
 * 取件报喜/道谢两条消息：LLM 按人设+记忆+上下文现场生成（out=出发取件时 / done=取到之后），
 * 道谢不套模板——礼物感谢必须结合人设/关系/礼物本身/共同记忆组织语言；模型不可用时回退本地兑底。
 */
async function tbPickupLinesViaLlm(
  contact: ContactRecord,
  app: TbEngageApp,
  kind: 'gift' | 'favor',
  order: TbOrder,
  meName: string,
  summary: string,
): Promise<string[]> {
  const sessionKey = `${app}:${contact.id}`;
  const system = [
    await tbPersonaSystemFor(contact, app),
    memChatRecallBlock(
      contact.id,
      app,
      kind === 'gift' ? '礼物 惊喜 感谢 喜欢 收到' : '帮忙取快递 取件 顺路 帮忙',
      {},
    ),
    getTimeAware(sessionKey) ? buildTimeAwareBlock({ regionHint: contact.region || null }) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const user =
    kind === 'gift'
      ? [
          `【刚发生的事】${meName}之前在淘宝送了你一件礼物（「${order.shopName}」的${summary}，¥${fmt2(order.total)}），现在包裹到驿站了，你正去取。`,
          '【任务】生成你要发的两条消息：第一条是出发去取快递时说的（自然随口）；第二条是取到之后说的——收到礼物表达开心/感谢，必须结合你的人设、你们的关系、礼物本身和你们相处的记忆来组织语言，像平时聊天的口吻，禁止套用「我超喜欢，谢谢你XX」这类固定句式，也不要复述「到驿站/取件」流程细节。',
          '输出 JSON：{"out":"出发时那条","done":"取到后那条"}（各 1 句，像平时聊天）。',
          '严禁输出 JSON 以外的文字。',
        ].join('\n\n')
      : [
          `【刚发生的事】${meName}的淘宝快递（「${order.shopName}」的${summary}）到驿站了，TA之前请你帮忙取件，你正去取。`,
          '【任务】生成你要发的两条消息：第一条是出发去取时说的；第二条是取到之后交差的话（按你的人设自然说，比如放哪了/让TA来拿/顺路这些你们之间才会有的说法，禁止套模板，也不要复述流程细节）。',
          '输出 JSON：{"out":"出发时那条","done":"取到后那条"}（各 1 句，像平时聊天）。',
          '严禁输出 JSON 以外的文字。',
        ].join('\n\n');
  const raw = await callTbLlm(system, user);
  const parsed = extractJsonObject(raw) as { out?: string; done?: string } | null;
  const clean = (s?: string): string =>
    (s ?? '')
      .trim()
      .replace(/^[「"'『]+|[」"'』]+$/g, '')
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)[0] ?? '';
  const out = clean(parsed?.out);
  const done = clean(parsed?.done);
  if (!out || !done) return [];
  return [out, done];
}

/** 取件执行：确认收货 + 清标记 + AI 报喜消息（礼物=道谢 / 帮取=交差）+ 事件记忆 */
export async function tbRunPickup(uid: string, orderId: string): Promise<void> {
  const order = tbLoadOrders(uid).find((o) => o.id === orderId);
  if (!order || !order.aiPickup || order.status !== 'shipped' || !tbArrivedAtStation(order)) return;
  const pick = order.aiPickup;
  if (!tbConfirmReceive(uid, orderId)) return;
  // 清标记（幂等：读改写防覆盖）
  const list = tbLoadOrders(uid);
  const hit = list.find((o) => o.id === orderId);
  if (hit) {
    delete hit.aiPickup;
    tbSaveOrders(uid, list);
    try {
      window.dispatchEvent(new CustomEvent('tb-orders-changed'));
    } catch {
      /* 忽略 */
    }
  }
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(pick.contactId);
  } catch {
    contact = null;
  }
  const app: TbEngageApp = pick.app === 'qq' ? 'qq' : 'wx';
  const meName = ownerNameSync();
  const summary = order.items.map((i) => `${i.title.slice(0, 12)}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、');
  const now = Date.now();
  // 两条消息按人设+记忆+上下文现场生成（道谢不套模板）；模型不可用时退回本地兑底文案
  let lines: string[] = [];
  if (contact) {
    try {
      lines = await tbPickupLinesViaLlm(contact, app, pick.kind, order, meName, summary);
    } catch {
      lines = [];
    }
  }
  if (lines.length < 2) {
    lines =
      pick.kind === 'gift'
        ? [`你的礼物到驿站啦，我这就去取~`, `取到啦！！${summary.slice(0, 16)}我超喜欢，谢谢你${meName}！`]
        : [`${meName}，你的快递到驿站了，我帮你去取~`, `取回来啦，放你门口了哈`];
  }
  if (contact) {
    memAddEventFragment(
      pick.contactId,
      app,
      pick.kind === 'gift'
        ? `机主${meName}送你的淘宝礼物（${summary}，¥${fmt2(order.total)}）到驿站后你自己去取回来了，很喜欢`
        : `你帮机主${meName}取了淘宝「${order.shopName}」的快递（${summary}），已确认收货`,
      { eventTime: now, sourceTag: pick.kind === 'gift' ? 'tb-gift-pickup' : 'tb-favor-pickup' },
    );
    await deliverPeerMsgs(app, contact, lines.map((content, i) => ({ id: `tbpick-${now.toString(36)}-${i}`, role: 'peer' as const, content, time: now + i * 4000 })));
  }
}

/** 主动代付决策（机主没开口，AI 自己看到待付款订单）：人设+记忆+金额 → 付或不付都聊一句 */
async function runProactivePayEngage(uid: string, orderId: string): Promise<void> {
  const picked = await tbPickRecentAiChat();
  if (!picked) return;
  const { app, contact } = picked;
  const order = tbLoadOrders(uid).find((o) => o.id === orderId);
  if (!order || order.status !== 'pendingPay') return;
  const sessionKey = `${app}:${contact.id}`;
  const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
  const meName = owner?.realName || ownerNameSync();
  const persona = buildPersonaSystemPrompt(contact, {
    channel: app === 'wx' ? '微信' : 'QQ',
    userName: meName,
    userRealName: meName,
    userNickname: owner?.nickname || null,
    ownerName: meName,
    accountId: getActiveAccountIdFor(app as AccountApp),
    multiApp: getMemSettings(contact.id).share,
  });
  const summary = order.items.map((i) => `${i.title.slice(0, 14)}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、');
  const memoryBlock = memChatRecallBlock(contact.id, app, `淘宝 待付款 代付 购物 ${order.shopName} ${summary}`, {});
  const timeBlock = getTimeAware(sessionKey) ? buildTimeAwareBlock({ regionHint: contact.region || null }) : '';
  const system = [persona, memoryBlock, timeBlock].filter(Boolean).join('\n\n');
  const user = [
    `【你看到的一件事】${meName}刚在淘宝「${order.shopName}」下单还没付款：${summary}，共 ¥${fmt2(order.total)}（30 分钟内不付会自动取消）。`,
    '【任务】结合你的人设、你们的关系、上面的记忆和金额，决定要不要主动帮TA把这笔付了（演示语义，不会真花钱）。',
    '关系亲近/金额不大/人设大方/正好想宠TA → 可以直接付（输出 {"pay":true,...}）；人设节俭/关系一般/金额偏大/刚闹过矛盾 → 不付，就用正文自然提一嘴（调侃/关心/催TA去买单都行）。两种选择都自然，没有标准答案。',
    '输出 JSON：{"pay":true或false,"reply":"给对方发的一句话（像平时聊天，1~2句；付了说已付+人设话，没付就自然聊）"}',
    '严禁输出 JSON 以外的文字。',
  ].join('\n\n');
  let parsed: { pay?: boolean; reply?: string } | null = null;
  try {
    const raw = await callTbLlm(system, user);
    parsed = extractJsonObject(raw) as { pay?: boolean; reply?: string } | null;
  } catch {
    parsed = null;
  }
  const reply = (parsed?.reply ?? '').trim().replace(/^[「"'『]+|[」"'』]+$/g, '').split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
  // 决策落定前复查（机主可能已自己付款/取消）
  const cur = tbLoadOrders(uid).find((o) => o.id === orderId);
  if (!cur || cur.status !== 'pendingPay') return;
  const outMsgs: { id: string; role: 'me' | 'peer'; content: string; time: number; kind?: string; tbpay?: { pid: string; role: 'req' | 'done' } }[] = [];
  if (parsed?.pay === true) {
    const res = tbAiPayPendingOrder(cur, { id: contact.id, name: contact.name, avatar: avatarFor(contact, app) }, app);
    if (res.ok && res.card) {
      outMsgs.push(res.card);
      memAddEventFragment(contact.id, app, `你看到机主${meName}在淘宝「${cur.shopName}」有待付款订单（¥${fmt2(cur.total)}，${summary}），主动帮TA付了`, { eventTime: Date.now(), sourceTag: 'tb-proactive-pay' });
    }
  }
  if (reply) outMsgs.push({ id: `tbpp-${Date.now().toString(36)}`, role: 'peer', content: reply, time: Date.now() + 1 });
  if (outMsgs.length === 0) return;
  try {
    const { isProactiveChatActive } = await import('./proactive-msg');
    const notifyApp = app === 'wx' ? ('wechat' as const) : ('qq' as const);
    await deliverPeerMsgs(app, contact, outMsgs);
    void pushChatNotification({
      sessionKey,
      app: notifyApp,
      title: contact.name,
      avatar: avatarFor(contact, app),
      body: outMsgs[outMsgs.length - 1]?.content ?? '',
      target: { app: notifyApp, contactId: contact.id },
    });
    if (!isProactiveChatActive(app, contact.id)) {
      if (app === 'wx') wxUnreads.bump(contact.id, outMsgs.length);
      else qqUnreads.bump(contact.id, outMsgs.length);
    }
  } catch {
    /* 投递失败静默 */
  }
}

/** 到货/发货主动问候一句话：LLM 按人设+记忆+上下文生成（不套固定收尾），失败回退本地文案 */
async function tbArrivalLineViaLlm(
  contact: ContactRecord,
  app: TbEngageApp,
  arrived: boolean,
  shopName: string,
  item: string,
  meName: string,
): Promise<string> {
  const sessionKey = `${app}:${contact.id}`;
  const system = [
    await tbPersonaSystemFor(contact, app),
    memChatRecallBlock(contact.id, app, '淘宝 快递 物流 购物', {}),
    getTimeAware(sessionKey) ? buildTimeAwareBlock({ regionHint: contact.region || null }) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const user = [
    arrived
      ? `【你注意到的事】${meName}在淘宝「${shopName}」买的${item}刚放到驿站了（TA还没取）。`
      : `【你注意到的事】${meName}在淘宝「${shopName}」买的${item}刚发货了，还在路上。`,
    '【任务】主动关心一句（1 句，像平时聊天）：到驿站就提醒TA去取，在路上就说留意下物流；按你的人设、你们的关系和记忆自然说，禁止每次都用「记得去取呀」这类固定收尾。',
    '直接输出这句话本身，不要 JSON、不要引号。',
  ].join('\n\n');
  const raw = await callTbLlm(system, user);
  return raw.trim().replace(/^[「"'『]+|[」"'』]+$/g, '').split('\n')[0]?.trim() ?? '';
}

/** 到货主动问候（四：AI 可以主动问快递）——低频一次性 */
async function maybeArrivalComment(uid: string, orderId: string): Promise<void> {
  if (globalCoolingDown('tb-comment-cd', ARRIVAL_COMMENT_CD_MS)) return;
  if (Math.random() > 0.3) return;
  const picked = await tbPickRecentAiChat();
  if (!picked) return;
  markGlobal('tb-comment-cd');
  const { app, contact } = picked;
  const order = tbLoadOrders(uid).find((o) => o.id === orderId);
  if (!order) return;
  const meName = ownerNameSync();
  const item = order.items[0]?.title.slice(0, 16) ?? '快递';
  const arrived = tbArrivedAtStation(order);
  // 人设化问候（LLM 现场生成，不套模板）；失败退回本地兜底文案
  let line = '';
  try {
    line = await tbArrivalLineViaLlm(contact, app, arrived, order.shopName, item, meName);
  } catch {
    line = '';
  }
  if (!line) {
    line = arrived
      ? `${meName}，你买的${item}到驿站啦，记得去取呀~`
      : `${meName}，你买的${item}发货啦，留意下物流哦~`;
  }
  try {
    await deliverPeerMsgs(app, contact, [{ id: `tbac-${Date.now().toString(36)}`, role: 'peer', content: line, time: Date.now() }]);
    const notifyApp = app === 'wx' ? ('wechat' as const) : ('qq' as const);
    void pushChatNotification({
      sessionKey: `${app}:${contact.id}`,
      app: notifyApp,
      title: contact.name,
      avatar: avatarFor(contact, app),
      body: line,
      target: { app: notifyApp, contactId: contact.id },
    });
    const { isProactiveChatActive } = await import('./proactive-msg');
    if (!isProactiveChatActive(app, contact.id)) {
      if (app === 'wx') wxUnreads.bump(contact.id, 1);
      else qqUnreads.bump(contact.id, 1);
    }
  } catch {
    /* 静默 */
  }
}

/** 订单状态机 tick 接力（taobao-store watcher 每 10s 调用）：取件/主动代付/到货问候/终态记忆 */
export async function tbEngageTick(uid: string): Promise<void> {
  try {
    const orders = tbLoadOrders(uid);
    // (a) AI 取件（礼物/帮取）：到驿站即取
    for (const o of orders) {
      if (o.aiPickup && o.status === 'shipped' && tbArrivedAtStation(o)) {
        await tbRunPickup(uid, o.id);
      }
    }
    // (b) 主动代付参与：待付款超 20s 未处理且没挂代付请求 → 最近的 AI 角色自主决策（每单一次）
    const proxyOrderIds = new Set<string>();
    try {
      for (const pid of kvGet<string[]>('tb-proxy-index') ?? []) {
        const p = tbGetProxy(pid);
        if (p && p.status === 'pending') proxyOrderIds.add(p.orderId);
      }
    } catch {
      /* 忽略 */
    }
    const now = Date.now();
    const target = orders.find(
      (o) => o.status === 'pendingPay' && !o.aiAsked && !proxyOrderIds.has(o.id) && now - o.createdAt > 20_000 && o.total <= TB_ENGAGE_AMOUNT_HARD,
    );
    if (target && !globalCoolingDown('tb-proactive-cd', PROACTIVE_PAY_CD_MS)) {
      const list = tbLoadOrders(uid);
      const hit = list.find((o) => o.id === target.id);
      if (hit) {
        hit.aiAsked = true;
        tbSaveOrders(uid, list);
        markGlobal('tb-proactive-cd');
        await runProactivePayEngage(uid, target.id);
        return; // 一轮只做一件主动事
      }
    }
    // (c) 到货主动问候：新有物流的单，低频提一嘴（有礼物/帮取安排的由取件流程说话，不重复）
    const commented = orders.find((o) => o.status === 'shipped' && !o.aiPickup && !kvGet<boolean>(`tb-commented:${o.id}`) && o.track.length > 0);
    if (commented) {
      kvSet(`tb-commented:${commented.id}`, true);
      await maybeArrivalComment(uid, commented.id);
      return;
    }
    // (d) 终态记忆：AI 参与代付的单签收后给角色补一条（幂等 kv 标记）
    for (const o of orders) {
      if (o.status !== 'completed' || !o.proxy || kvGet<boolean>(`tb-memo-done:${o.id}`)) continue;
      const p = tbGetProxy(o.proxy.id);
      if (!p || p.status !== 'paid' || p.direction === 'me') continue;
      kvSet(`tb-memo-done:${o.id}`, true);
      let contact: ContactRecord | null = null;
      try {
        contact = await getContact(p.contactId);
      } catch {
        contact = null;
      }
      if (!contact) continue;
      memAddEventFragment(
        p.contactId,
        p.idp,
        `你帮机主代付的淘宝「${o.shopName}」订单（${o.items.map((i) => i.title.slice(0, 12)).join('、')}，¥${fmt2(o.total)}）已签收`,
        { eventTime: Date.now(), sourceTag: 'tb-order-terminal' },
      );
    }
  } catch {
    /* tick 失败静默 */
  }
}

// ---------------- 淘宝「找人帮取」分享后的 AI 响应 ----------------

/**
 * 机主在淘宝详情点「找人帮取」分享给 AI 后调度：延时让角色「看到请求」——
 * 已到驿站 → 立即取件 + 报喜；没到 → 答应下来（到驿站后 watcher 自动取）。
 * 人设化回复（LLM），模型不可用时用本地兜底文案。
 */
export function tbSchedulePickupResponse(sid: string): void {
  window.setTimeout(async () => {
    try {
      const share = tbGetShare(sid);
      if (!share || !share.pickupReq) return;
      const contact = await getContact(share.contactId);
      if (!contact || contact.kind === 'user') return;
      const app: TbEngageApp = share.idp;
      const uid = share.uid;
      const order = tbLoadOrders(uid).find((o) => o.id === share.orderId);
      if (!order || order.status === 'cancelled') return;
      // 标记帮取（分享时可能因状态没写上，这里补）
      if (!order.aiPickup && order.status !== 'completed') {
        const list = tbLoadOrders(uid);
        const hit = list.find((o) => o.id === order.id);
        if (hit && !hit.aiPickup) {
          hit.aiPickup = { contactId: contact.id, contactName: contact.name, app, kind: 'favor' };
          tbSaveOrders(uid, list);
        }
      }
      const meName = ownerNameSync();
      const summary = order.items.map((i) => i.title.slice(0, 12)).join('、');
      if (tbArrivedAtStation(order) && order.status === 'shipped') {
        await tbRunPickup(uid, order.id);
        return; // tbRunPickup 已投递报喜消息
      }
      // 还在路上：人设化答应一句
      const persona = buildPersonaSystemPrompt(contact, {
        channel: app === 'wx' ? '微信' : 'QQ',
        userName: meName,
        userRealName: meName,
        userNickname: null,
        ownerName: meName,
        accountId: getActiveAccountIdFor(app as AccountApp),
        multiApp: getMemSettings(contact.id).share,
      });
      const user = [
        `【刚收到的事】${meName}在淘宝把「${order.shopName}」的快递订单分享给你，请你帮忙取件（${summary}）。包裹还在路上，到驿站后你会去取。`,
        '按你的人设自然回应一句（答应下来，1~2 句，像平时聊天）。',
        '直接输出这句话本身，不要 JSON、不要引号。',
      ].join('\n\n');
      let line = '';
      try {
        line = (await callTbLlm(persona, user)).trim().replace(/^[「"'『]+|[」"'』]+$/g, '').split('\n')[0]?.trim() ?? '';
      } catch {
        line = '';
      }
      if (!line) line = '好呀，到你家驿站了我就去帮你取~';
      const now = Date.now();
      await deliverPeerMsgs(app, contact, [{ id: `tbpr-${now.toString(36)}`, role: 'peer', content: line, time: now }]);
      memAddEventFragment(contact.id, app, `机主${meName}请你帮忙取淘宝「${order.shopName}」的快递（${summary}），你答应了`, { eventTime: now, sourceTag: 'tb-pickup-req' });
    } catch {
      /* 静默 */
    }
  }, 4200 + Math.floor(Math.random() * 3600));
}

// ---------------- 标记体解析（[帮你买/自己买:商品id|数量?]） ----------------

export function parseTbBuyBody(raw: string): { pid: string; qty: number } | null {
  const segs = raw.split('|').map((s) => s.trim());
  const pid = segs[0] ?? '';
  if (!pid) return null;
  let qty = 1;
  const q = segs[1];
  if (q) {
    const n = Number.parseInt(q, 10);
    if (Number.isFinite(n) && n > 0) qty = Math.min(5, n);
  }
  return { pid, qty };
}

/** AI 代买草稿卡 → AI 可读文本（确认/取消状态可回看） */
export function tbDraftHistoryLine(did: string): string {
  const d = tbGetDraft(did);
  if (!d) return '[淘宝代买卡片]';
  const status = d.status === 'pending' ? '待机主确认' : d.status === 'confirmed' ? `已下单（订单${d.orderId ?? ''}，你已付款）` : '机主已取消';
  return `[淘宝代买 id:${d.id}]（${d.charName}帮机主买的：淘宝店「${d.shopName}」的「${d.title}」x${d.qty}，约¥${fmt2(d.total ?? d.price * d.qty)}，状态:${status}）`;
}
