'use client';

/**
 * 美团 × AI 聊天联动引擎（外卖参与 + 双向代付）：
 * - AI 帮机主点外卖：AI 输出 [帮点外卖:商家ID|菜名x数量,...|备注] → 生成「代点草稿卡」
 *   （mt-draft:<id>）落到聊天，机主确认后创建美团待支付订单并跳收银台支付；
 * - AI 请客点外卖：AI 输出 [请客点外卖:商家ID|菜名x数量,...|备注] → 直接下单并由 AI 付款
 *   （mtAiPayPendingOrder，演示语义）→ 以订单分享卡（role peer，角标「X已买单」）发给机主，
 *   机主无需付款，卡片内嵌实时配送状态时间线；
 * - AI 给自己点外卖：AI 输出 [自己点外卖:商家ID|菜名x数量,...] → 创建待支付订单 +
 *   direction 'me' 代付请求（请机主帮付），请求卡落在该角色聊天；
 * - AI 主动帮付：AI 输出 [帮付:订单ID] → 为机主的待支付订单立即代付（direction 'friend'，
 *   完成卡随回复队列投递）；
 * - AI 代付决策：机主发起找人代付后（mtCreateProxyRequest），调度本角色的 LLM 决策——
 *   按人设/记忆/上下文决定是否代付，付则出完成卡+回复，婉拒则只回复；两者都写角色记忆；
 * - 感知注入：buildMtEngageCtx 每回合现场构建【美团外卖动态】（最近订单/待支付订单/
 *   待处理代付请求，状态实时读 kv）与【美团外卖精选】目录（食物话题命中时）+ 动作教学规则；
 * - 记忆：AI 参与（代付/帮付/代点/请付）的时刻按角色 contactId 直写事件记忆
 *   （memAddEventFragment，sourceTag 防同模板互吞）；普通订单靠动态块实时感知不刷记忆；
 * - 隔离：草稿按美团 uid + 角色双写；记忆按角色 contactId（既有机制）；不涉及真实资金。
 */
import { kvGet, kvSet } from './idb-kv';
import { getContact, listContacts, ownerProfileFor, cachedOwnerName } from './contacts-store';
import { avatarFor, type ContactRecord } from '../contacts';
import { getActiveAccountFor, getActiveAccountIdFor, type AccountApp } from './accounts';
import {
  mtGetSession,
  mtUidOf,
  mtLoadOrders,
  mtSaveOrders,
  mtCurAddrId,
  mtLoadAddresses,
  mtCheckoutCalc,
  MT_STATUS_LABEL,
  type MtOrder,
} from './meituan-store';
import { mtAllMerchants, mtMerchantOf, mtDishesOf, type MtDish, type MtMerchant } from './meituan-data';
import {
  mtGetProxy,
  mtProxyChatCid,
  mtPendingProxiesOfChat,
  mtProxyPayOrder,
  mtCreateProxyRequestByChar,
  mtAiPayPendingOrder,
  type MtProxyCardMsg,
} from './mt-proxy-pay';
import { buildPersonaSystemPrompt } from './persona';
import { memChatRecallBlock, memAddEventFragment } from '@/lib/memory';
import { buildTimeAwareBlock, getTimeAware } from '@/lib/time-aware';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { scheduleAiDelivery } from './ai-delivery';
import { useSettings } from './store';
import { mtGetShare, mtCreateOrderShare } from './mt-order-share';
import type { RichAction } from '@/lib/chat-rich';

export type MtEngageApp = 'wx' | 'qq';

// ---------------- AI 代点外卖草稿 ----------------

export interface MtDraftItem {
  dishId?: string;
  name: string;
  qty: number;
  price: number;
  emoji?: string;
  img?: string;
}

export interface MtAiDraft {
  id: string;
  /** 美团账号 uid（下单归属） */
  uid: string;
  merchantId: string;
  merchantName: string;
  merchantEmoji: string;
  merchantImg?: string;
  items: MtDraftItem[];
  /** 创建时的预览合计（确认下单时按 mtCheckoutCalc 重算，以订单为准） */
  estimate: number;
  note?: string;
  /** 发起的 AI 角色 */
  charId: string;
  charName: string;
  app: MtEngageApp;
  status: 'pending' | 'confirmed' | 'declined';
  createdAt: number;
  orderId?: string;
  /** 确认下单后的应付金额（与美团订单一致） */
  total?: number;
}

export const MT_DRAFT_EVENT = 'mt-draft-changed';

function genDid(): string {
  return `mtdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function bumpDraftIndex(did: string): void {
  try {
    const idx = kvGet<string[]>('mt-draft-index') ?? [];
    if (!idx.includes(did)) kvSet('mt-draft-index', [...idx, did].slice(-30));
  } catch {
    /* 忽略 */
  }
}

function fireDraftEvent(): void {
  try {
    window.dispatchEvent(new CustomEvent(MT_DRAFT_EVENT));
  } catch {
    /* 忽略 */
  }
}

export function mtGetDraft(did: string): MtAiDraft | null {
  if (!did) return null;
  const d = kvGet<Partial<MtAiDraft>>(`mt-draft:${did}`);
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || typeof d.merchantId !== 'string') return null;
  return {
    ...d,
    id: d.id,
    uid: typeof d.uid === 'string' ? d.uid : '',
    merchantId: d.merchantId,
    merchantName: typeof d.merchantName === 'string' ? d.merchantName : '美团商家',
    merchantEmoji: typeof d.merchantEmoji === 'string' ? d.merchantEmoji : '🍜',
    merchantImg: typeof d.merchantImg === 'string' ? d.merchantImg : undefined,
    items: Array.isArray(d.items)
      ? (d.items as MtDraftItem[]).filter((i) => i && typeof i.name === 'string').map((i) => ({ ...i, qty: typeof i.qty === 'number' ? i.qty : 1, price: typeof i.price === 'number' ? i.price : 0 }))
      : [],
    estimate: typeof d.estimate === 'number' ? d.estimate : 0,
    note: typeof d.note === 'string' && d.note ? d.note : undefined,
    charId: typeof d.charId === 'string' ? d.charId : '',
    charName: typeof d.charName === 'string' ? d.charName : '好友',
    app: d.app === 'qq' ? 'qq' : 'wx',
    status: d.status === 'confirmed' ? 'confirmed' : d.status === 'declined' ? 'declined' : 'pending',
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
    orderId: typeof d.orderId === 'string' ? d.orderId : undefined,
    total: typeof d.total === 'number' ? d.total : undefined,
  };
}

/** 解析 [帮点外卖/自己点外卖] 标记体：商家ID|菜名x数量,菜名x数量|备注? */
export function parseMtOrderBody(raw: string): { merchantId: string; items: { name: string; qty: number }[]; note?: string } | null {
  const segs = raw.split('|').map((s) => s.trim());
  const merchantId = segs[0] ?? '';
  if (!merchantId) return null;
  const items: { name: string; qty: number }[] = [];
  for (const seg of (segs[1] ?? '').split(/[,，、]/)) {
    const s = seg.trim();
    if (!s) continue;
    const m = /^(.{1,40}?)\s*[xX×*]\s*(\d{1,2})$/.exec(s);
    if (m) {
      const name = m[1].replace(/[xX×*]\s*$/, '').trim();
      if (name) items.push({ name, qty: Math.max(1, Math.min(20, Number(m[2]))) });
    } else {
      items.push({ name: s.replace(/[xX×*]\s*$/, '').trim(), qty: 1 });
    }
  }
  if (items.length === 0) return null;
  const note = segs.slice(2).join('|').trim() || undefined;
  return { merchantId, items, note };
}

/** 菜名 → 菜品（精确 → 包含；均不中返回 null） */
function resolveDish(merchant: MtMerchant, name: string): MtDish | null {
  const all = mtDishesOf(merchant);
  const clean = name.trim();
  if (!clean) return null;
  return all.find((d) => d.name === clean) ?? all.find((d) => d.name.includes(clean) || clean.includes(d.name)) ?? null;
}

export type MtCreateDraftResult = { ok: true; draft: MtAiDraft } | { ok: false; error: string };

/** 创建代点草稿（菜品按商家菜单解析，金额按菜单价 + 满减/免配送预估） */
export function mtCreateAiDraft(opts: {
  uid: string;
  merchantId: string;
  items: { name: string; qty: number }[];
  note?: string;
  charId: string;
  charName: string;
  app: MtEngageApp;
}): MtCreateDraftResult {
  const merchant = mtMerchantOf(opts.merchantId);
  if (!merchant) return { ok: false, error: `没有找到这家店（${opts.merchantId}）` };
  const items: MtDraftItem[] = [];
  for (const it of opts.items) {
    const dish = resolveDish(merchant, it.name);
    if (!dish) return { ok: false, error: `「${it.name}」不在「${merchant.name}」的菜单里` };
    items.push({ dishId: dish.id, name: dish.name, qty: it.qty, price: dish.price, emoji: dish.emoji, img: dish.img });
  }
  const cartItems = items.map((i) => ({ dishId: i.dishId as string, qty: i.qty }));
  const calc = mtCheckoutCalc(opts.uid, merchant, { merchantId: merchant.id, items: cartItems });
  const draft: MtAiDraft = {
    id: genDid(),
    uid: opts.uid,
    merchantId: merchant.id,
    merchantName: merchant.name,
    merchantEmoji: merchant.emoji,
    merchantImg: merchant.cover,
    items,
    estimate: calc.total,
    note: opts.note,
    charId: opts.charId,
    charName: opts.charName,
    app: opts.app,
    status: 'pending',
    createdAt: Date.now(),
  };
  kvSet(`mt-draft:${draft.id}`, draft);
  bumpDraftIndex(draft.id);
  fireDraftEvent();
  return { ok: true, draft };
}

/** 拒绝代点草稿 */
export function mtDeclineAiDraft(did: string): boolean {
  const d = mtGetDraft(did);
  if (!d || d.status !== 'pending') return false;
  kvSet(`mt-draft:${did}`, { ...d, status: 'declined' });
  fireDraftEvent();
  return true;
}

export type MtConfirmDraftResult = { ok: true; orderId: string; total: number } | { ok: false; error: string };

/**
 * 确认代点草稿 → 创建美团待支付订单（金额/满减与正常下单同口径 mtCheckoutCalc，地址用当前选中地址），
 * 调用方随后跳美团收银台支付；写发起角色记忆（「你帮机主点了外卖」）。
 */
export function mtConfirmAiDraft(did: string): MtConfirmDraftResult {
  const d = mtGetDraft(did);
  if (!d) return { ok: false, error: '代点请求不存在' };
  if (d.status !== 'pending') return { ok: false, error: '该代点请求已处理' };
  if (!d.uid) return { ok: false, error: '请先登录美团' };
  const merchant = mtMerchantOf(d.merchantId);
  if (!merchant) return { ok: false, error: '商家已下架' };
  const calc = mtCheckoutCalc(d.uid, merchant, { merchantId: merchant.id, items: d.items.map((i) => ({ dishId: i.dishId as string, qty: i.qty })) });
  const addrs = mtLoadAddresses(d.uid);
  const curId = mtCurAddrId(d.uid);
  const addr = addrs.find((a) => a.id === curId) ?? addrs[0];
  if (!addr) return { ok: false, error: '请先在美团里选择收货地址' };
  const now = Date.now();
  const order: MtOrder = {
    id: `mt${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    uid: d.uid,
    merchantId: merchant.id,
    merchantName: merchant.name,
    merchantEmoji: merchant.emoji,
    merchantImg: merchant.cover,
    kind: 'waimai',
    items: d.items.map((i) => ({ dishId: i.dishId ?? i.name, name: i.name, price: i.price, qty: i.qty, emoji: i.emoji ?? '🍱', img: i.img })),
    itemTotal: calc.itemTotal,
    deliveryFee: calc.deliveryFee,
    discount: calc.discount,
    total: calc.total,
    note: d.note,
    address: addr,
    status: 'pendingPay',
    createdAt: now,
    statusLog: [{ status: 'pendingPay', at: now }],
  };
  mtSaveOrders(d.uid, [order, ...mtLoadOrders(d.uid)]);
  kvSet(`mt-draft:${did}`, { ...d, status: 'confirmed', orderId: order.id, total: calc.total });
  fireDraftEvent();
  try {
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
  } catch {
    /* 忽略 */
  }
  // 写发起角色记忆（按角色隔离；sourceTag 防同模板互吞）
  const summary = d.items.map((i) => `${i.name}x${i.qty}`).join('、');
  memAddEventFragment(d.charId, d.app, `你帮机主在美团点了「${merchant.name}」的外卖（${summary}，应付¥${calc.total}），订单已提交等机主支付`, { eventTime: now, sourceTag: 'mt-ai-order' });
  return { ok: true, orderId: order.id, total: calc.total };
}

// ---------------- 场景识别 + 每回合上下文/规则 ----------------

const FOOD_TEXT_RE = /(吃|饿|外卖|点餐|点单|午餐|午饭|晚饭|晚餐|早餐|下午茶|夜宵|宵夜|奶茶|咖啡|火锅|麻辣烫|汉堡|披萨|炸鸡|寿司|甜品|蛋糕|干饭|美食|美团|加个鸡腿|有什么吃的)/;

export function mtScanFoodText(texts: (string | undefined | null)[]): boolean {
  return texts.some((t) => typeof t === 'string' && FOOD_TEXT_RE.test(t));
}

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (v: number): string => String(v).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function orderItemSummary(o: MtOrder, max = 3): string {
  const names = o.items.map((i) => `${i.name}${i.qty > 1 ? `x${i.qty}` : ''}`);
  return names.slice(0, max).join('、') + (names.length > max ? `等${names.length}样` : '');
}

/** 美团外卖精选目录（食物话题命中时注入；确定性选取避免每次换店） */
function buildCatalogBlock(): string {
  const foodCats = new Set(['waimai', 'meishi', 'yinyin', 'hamburg', 'mala', 'zaocan', 'chaoshi', 'shuiguo']);
  const pool = mtAllMerchants().filter((m) => m.cats.some((c) => foodCats.has(c)));
  const picked: MtMerchant[] = [];
  for (const m of pool) {
    if (picked.length >= 10) break;
    picked.push(m);
  }
  const lines = picked.map((m) => {
    const dishes = [...mtDishesOf(m)].sort((a, b) => (b.sig ? 1 : 0) - (a.sig ? 1 : 0)).slice(0, 3);
    const dishText = dishes.map((d) => `${d.name}(¥${fmt2(d.price)})`).join('、');
    return `· ${m.id} 「${m.name}」 评分${m.rating} 月售${m.monthSale} 起送¥${fmt2(m.minOrder)} 配送费¥${fmt2(m.deliveryFee)} 约${m.deliveryMin}分钟 ｜ ${dishText}`;
  });
  return `【美团外卖精选】（商家ID就是标记里要用的 ID；菜名必须原样抄写）\n${lines.join('\n')}`;
}

export interface MtEngageCtx {
  /** 注入 system 的动态块（最近订单/待支付订单实时状态） */
  block: string;
  /** 追加到处理动作规则后的段落（代付请求/帮付/点外卖教学；按条件出现） */
  rules: string[];
}

/**
 * 每回合现场构建（全同步 kv 读）：代付请求/订单状态实时、按角色聊天隔离。
 * recentTexts = 本轮触发文本 + 最近几条消息文本（食物话题命中时才注入商家目录）。
 */
export function buildMtEngageCtx(chatContactId: string, app: MtEngageApp, recentTexts: (string | undefined | null)[]): MtEngageCtx {
  const empty: MtEngageCtx = { block: '', rules: [] };
  let session: ReturnType<typeof mtGetSession> = null;
  try {
    session = mtGetSession();
  } catch {
    return empty;
  }
  if (!session) return empty;
  const uid = mtUidOf(session);
  const ownerName = cachedOwnerName() || session.name;
  const orders = mtLoadOrders(uid);
  const pendingPay = orders.filter((o) => o.status === 'pendingPay');
  const recentDone = orders.filter((o) => o.status !== 'pendingPay' && o.status !== 'canceled').slice(0, 5);

  // 动态块：最近订单（AI 知道机主点了什么/哪家店/金额/什么时候/配送状态）
  const blockParts: string[] = [];
  if (recentDone.length > 0) {
    const lines = recentDone.map((o) => `· ${fmtClock(o.createdAt)} 「${o.merchantName}」 ${orderItemSummary(o)} ¥${fmt2(o.total)} · ${MT_STATUS_LABEL[o.status]}${o.payChannelLabel ? `（${o.payChannelLabel}）` : ''}`);
    blockParts.push(`【${ownerName}的美团外卖动态】（实时状态，可自然提起）\n${lines.join('\n')}`);
  }

  // 规则段
  const rules: string[] = [];
  const proxies = mtPendingProxiesOfChat(chatContactId);
  const friendPending = proxies.filter((p) => p.direction === 'friend');
  const mePending = proxies.filter((p) => p.direction === 'me');
  if (friendPending.length > 0) {
    const lines = friendPending.map((p) => `· id=${p.id} 商家「${p.merchantName}」 ¥${fmt2(p.amount)}（${p.items.map((i) => `${i.name}x${i.qty}`).join('、')}）${p.note ? ` 备注:${p.note}` : ''} · 请求人:${p.fromName}`);
    rules.push(
      `【美团代付请求（机主发来请你代付）】\n${lines.join('\n')}\n` +
        `机主希望你帮忙支付上面的订单。是否代付完全由你按人设、你们的关系、记忆和金额自主决定：愿意就先说一句，再单独输出标记 [代付:请求id]（系统会立即支付并发出回执卡片，id 必须原样抄写）；不想付或觉得不合适就用正文自然婉拒（可以调侃、可以撒娇说下次），不要输出标记。15 分钟内不处理订单会自动取消。`
    );
  }
  if (mePending.length > 0) {
    rules.push(
      `【你发出去的代付请求（等机主帮你付）】\n${mePending.map((p) => `· 商家「${p.merchantName}」 ¥${fmt2(p.amount)} · 待机主支付`).join('\n')}\n` +
        `可以自然提起（撒娇催一催），机主点卡片就能帮你付；不要重复发请求。`
    );
  }
  if (pendingPay.length > 0) {
    const lines = pendingPay.slice(0, 4).map((o) => `· 订单id=${o.id} 商家「${o.merchantName}」 ${orderItemSummary(o)} ¥${fmt2(o.total)}`);
    rules.push(
      `【${ownerName}的待支付外卖订单】\n${lines.join('\n')}\n` +
        `如果符合你的人设和你们的关系（说好请客、想宠TA、金额不大等），可以主动帮TA付：输出标记 [帮付:订单id]（系统立即支付并回执）；金额较大或没把握时，先用正文提议「我帮你付吧」，TA同意后再用标记，不要每次都抢着付。`
    );
  }
  if (mtScanFoodText(recentTexts)) {
    rules.push(
      `${buildCatalogBlock()}\n\n` +
        `【帮机主点外卖（机主自己付款）】聊到吃的、机主说饿/懒得动/让你推荐时，你可以先问问口味或结合你记得的偏好、当前时间（早餐/午餐/夜宵）推荐上面的商家和菜品；机主同意后输出标记 [帮点外卖:商家ID|菜名x数量,菜名x数量|备注?]（菜名必须原样抄目录里的名字；备注可省略）。系统会生成一张代点卡片，机主确认后才真正下单并自己付款，你不用再重复确认。\n` +
        `【请客点外卖（你直接付好）】如果你按人设/你们的关系想直接请TA吃（说好了请客、想宠TA、庆祝纪念等，别频繁），可以输出标记 [请客点外卖:商家ID|菜名x数量,菜名x数量|备注?]——系统会直接下单并由你付款（演示语义，不扣真钱），TA会收到一张已支付的订单卡片（实时显示配送状态），不需要再付款。金额较大时先正文问一句「我请你吃吧」再发标记。\n` +
        `【给你自己点外卖】你自己想吃/馋了的时候（按人设判断，别频繁），可以输出标记 [自己点外卖:商家ID|菜名x数量,菜名x数量]——系统会生成待支付订单并请机主帮你代付，记得用正文说一句让TA帮你付。`
    );
  }
  return { block: blockParts.join('\n\n'), rules };
}

// ---------------- AI 动作执行（wechat/QQ buildReplyMsgs 分流调用） ----------------

/** AI 可输出的美团联动动作（chat-rich ACTION_LABELS 登记同名标记） */
export type MtEngageActionKind = 'mt-proxy-pay' | 'mt-pay-for' | 'mt-order-draft' | 'mt-order-self' | 'mt-order-treat';

export function isMtEngageActionKind(kind: string): kind is MtEngageActionKind {
  return kind === 'mt-proxy-pay' || kind === 'mt-pay-for' || kind === 'mt-order-draft' || kind === 'mt-order-self' || kind === 'mt-order-treat';
}

/** 执行器产出的卡片消息（微信 WxMsg / QQ QQMsg 结构子集，直接 push 进回复队列） */
export type MtEngageCard = MtProxyCardMsg | { id: string; role: 'peer'; content: string; time: number; kind: 'mtdraft'; mtdraft: { did: string } };

export interface MtEngageExecResult {
  /** 随回复队列投递的卡片（mtpay 完成卡 / mtdraft 代点卡） */
  msgs: MtEngageCard[];
  /** 需要以系统行展示的提示（执行失败原因等）；空 = 静默 */
  sys?: string;
}

/** 美团当前登录态（动作执行/规则构建共用） */
export function mtEngageSessionUid(): { uid: string; name: string } | null {
  try {
    const s = mtGetSession();
    return s ? { uid: mtUidOf(s), name: s.name } : null;
  } catch {
    return null;
  }
}

export function applyMtEngageAction(action: RichAction, peer: ContactRecord, opts: { app: MtEngageApp; meName: string }): MtEngageExecResult {
  const now = Date.now();
  const kind = action.kind;
  if (kind === 'mt-proxy-pay') {
    // [代付:pid]：AI 支付机主发来的代付请求（仅 direction 'friend' 且落在自己聊天）
    const pid = action.targetId.trim();
    const p = mtGetProxy(pid);
    if (!p || p.status !== 'pending' || p.direction !== 'friend' || mtProxyChatCid(p) !== peer.id) {
      return { msgs: [], sys: '（代付请求不存在或已处理）' };
    }
    const res = mtProxyPayOrder(pid, { deferCard: true });
    if (!res.ok) return { msgs: [], sys: `（代付未成功：${res.error}）` };
    if (!res.card) return { msgs: [], sys: '（代付未完成，请稍后再试）' };
    const summary = p.items.map((i) => `${i.name}x${i.qty}`).join('、');
    memAddEventFragment(peer.id, opts.app, `机主${opts.meName}在美团请你代付「${p.merchantName}」的订单（¥${fmt2(p.amount)}，${summary}），你同意并已支付`, { eventTime: now, sourceTag: 'mt-proxy-pay' });
    return { msgs: [res.card] };
  }
  if (kind === 'mt-pay-for') {
    // [帮付:订单id]：AI 主动为机主的待支付订单代付
    const uidInfo = mtEngageSessionUid();
    if (!uidInfo) return { msgs: [], sys: '（美团尚未登录，无法帮付）' };
    const order = mtLoadOrders(uidInfo.uid).find((o) => o.id === action.targetId.trim());
    if (!order || order.status !== 'pendingPay') return { msgs: [], sys: '（订单不存在或已支付）' };
    const res = mtAiPayPendingOrder(order, { id: peer.id, name: peer.name, avatar: avatarFor(peer, opts.app) }, opts.app);
    if (!res.ok) return { msgs: [], sys: `（帮付未成功：${res.error}）` };
    if (!res.card) return { msgs: [], sys: '（帮付未完成，请稍后再试）' };
    const summary = order.items.map((i) => `${i.name}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、');
    memAddEventFragment(peer.id, opts.app, `你主动帮机主${opts.meName}付了美团「${order.merchantName}」¥${fmt2(order.total)}的订单（${summary}）`, { eventTime: now, sourceTag: 'mt-help-pay' });
    return { msgs: [res.card] };
  }
  if (kind === 'mt-order-draft') {
    // [帮点外卖:商家ID|菜名x数量,...|备注?]：生成代点草稿卡（机主确认后才下单）
    const uidInfo = mtEngageSessionUid();
    if (!uidInfo) return { msgs: [], sys: '（美团尚未登录，无法代点外卖）' };
    const body = parseMtOrderBody(action.targetId);
    if (!body) return { msgs: [], sys: '（代点外卖格式有误，未能下单）' };
    const res = mtCreateAiDraft({
      uid: uidInfo.uid,
      merchantId: body.merchantId,
      items: body.items,
      note: body.note,
      charId: peer.id,
      charName: peer.name,
      app: opts.app,
    });
    if (!res.ok) return { msgs: [], sys: `（代点失败：${res.error}）` };
    return {
      msgs: [{
        id: `mtdm-${res.draft.id}`,
        role: 'peer',
        content: `[美团代点]帮你挑了「${res.draft.merchantName}」的外卖，确认后就去下单`,
        time: now,
        kind: 'mtdraft',
        mtdraft: { did: res.draft.id },
      }],
    };
  }
  // mt-order-self：[自己点外卖:商家ID|菜名x数量,...] —— 异步流：创建待支付订单 + 请机主代付
  if (kind === 'mt-order-self') {
    const uidInfo = mtEngageSessionUid();
    if (!uidInfo) return { msgs: [], sys: '（美团尚未登录，无法点外卖）' };
    const body = parseMtOrderBody(action.targetId);
    if (!body) return { msgs: [], sys: '（点外卖格式有误，未能下单）' };
    void mtSelfOrderFlow(body, peer, opts).catch(() => undefined);
    return { msgs: [] };
  }
  // mt-order-treat：[请客点外卖:商家ID|菜名x数量,...|备注?] —— 异步流：直接下单 + AI 付款 + 发已支付订单卡
  const uidInfo2 = mtEngageSessionUid();
  if (!uidInfo2) return { msgs: [], sys: '（美团尚未登录，无法点外卖）' };
  const body2 = parseMtOrderBody(action.targetId);
  if (!body2) return { msgs: [], sys: '（请客点外卖格式有误，未能下单）' };
  void mtTreatOrderFlow(body2, peer, opts).catch(() => undefined);
  return { msgs: [] };
}

/** [自己点外卖]/[请客点外卖] 共用：按解析体创建美团待支付订单（金额/满减与正常下单同口径；地址用当前选中地址） */
function mtBuildParsedOrder(
  uid: string,
  body: { merchantId: string; items: { name: string; qty: number }[]; note?: string },
  fallbackNote: string,
): { ok: true; order: MtOrder } | { ok: false; error: string } {
  const merchant = mtMerchantOf(body.merchantId);
  if (!merchant) return { ok: false, error: `没有找到这家店（${body.merchantId}）` };
  const items: { dishId: string; name: string; qty: number; price: number; emoji?: string; img?: string }[] = [];
  for (const it of body.items) {
    const dish = resolveDish(merchant, it.name);
    if (!dish) return { ok: false, error: `「${it.name}」不在「${merchant.name}」的菜单里` };
    items.push({ dishId: dish.id, name: dish.name, qty: it.qty, price: dish.price, emoji: dish.emoji, img: dish.img });
  }
  const calc = mtCheckoutCalc(uid, merchant, { merchantId: merchant.id, items: items.map((i) => ({ dishId: i.dishId, qty: i.qty })) });
  const addrs = mtLoadAddresses(uid);
  const addr = addrs.find((a) => a.id === mtCurAddrId(uid)) ?? addrs[0];
  if (!addr) return { ok: false, error: '请先在美团里选择收货地址' };
  const now = Date.now();
  const order: MtOrder = {
    id: `mt${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    uid,
    merchantId: merchant.id,
    merchantName: merchant.name,
    merchantEmoji: merchant.emoji,
    merchantImg: merchant.cover,
    kind: 'waimai',
    items: items.map((i) => ({ ...i, emoji: i.emoji ?? '🍱' })),
    itemTotal: calc.itemTotal,
    deliveryFee: calc.deliveryFee,
    discount: calc.discount,
    total: calc.total,
    note: body.note ?? fallbackNote,
    address: addr,
    status: 'pendingPay',
    createdAt: now,
    statusLog: [{ status: 'pendingPay', at: now }],
  };
  mtSaveOrders(uid, [order, ...mtLoadOrders(uid)]);
  try {
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
  } catch {
    /* 忽略 */
  }
  return { ok: true, order };
}

/** [自己点外卖] 异步全流程：建单 → direction 'me' 代付请求（卡片经事件合并进聊天）→ 角色记忆 */
async function mtSelfOrderFlow(
  body: { merchantId: string; items: { name: string; qty: number }[]; note?: string },
  peer: ContactRecord,
  opts: { app: MtEngageApp; meName: string },
): Promise<void> {
  const uidInfo = mtEngageSessionUid();
  if (!uidInfo) return;
  const built = mtBuildParsedOrder(uidInfo.uid, body, `${peer.name}想吃的`);
  if (!built.ok) return; // 菜品不存在等 → 整单放弃（静默，与代点不同：这是 AI 自己的单）
  const order = built.order;
  const payer = await mtOwnerContactFor(opts.app);
  if (!payer) return;
  await mtCreateProxyRequestByChar({
    order,
    idp: opts.app,
    char: { id: peer.id, name: peer.name, avatar: avatarFor(peer, opts.app) },
    payer,
  });
  const summary = order.items.map((i) => `${i.name}x${i.qty}`).join('、');
  memAddEventFragment(peer.id, opts.app, `你在美团给自己点了「${order.merchantName}」的外卖（${summary}，¥${fmt2(order.total)}），请机主${opts.meName}帮你代付`, { eventTime: order.createdAt, sourceTag: 'mt-self-order' });
}

/**
 * [请客点外卖] 异步全流程：建单 → AI 立即付款（mtAiPayPendingOrder，演示语义不扣真钱）→
 * 以订单分享卡（role peer，角标「X已买单」，内嵌实时状态时间线）发给机主 → 灵动岛通知/未读角标 → 角色记忆。
 * 机主全程无需付款；点击卡片进美团订单详情。
 */
async function mtTreatOrderFlow(
  body: { merchantId: string; items: { name: string; qty: number }[]; note?: string },
  peer: ContactRecord,
  opts: { app: MtEngageApp; meName: string },
): Promise<void> {
  const uidInfo = mtEngageSessionUid();
  if (!uidInfo) return;
  const built = mtBuildParsedOrder(uidInfo.uid, body, `${peer.name}请客的`);
  if (!built.ok) return; // 菜品/商家/地址不存在 → 静默放弃（与 [自己点外卖] 同口径）
  const order = built.order;
  // AI 付款：建 direction 'friend' 代付记录并立即支付（完成回执卡丢弃，用订单动态卡替代）
  const payRes = mtAiPayPendingOrder(order, { id: peer.id, name: peer.name, avatar: avatarFor(peer, opts.app) }, opts.app);
  if (!payRes.ok || !payRes.order) return;
  const paidOrder = payRes.order;
  // 已支付订单动态卡发给机主（实时状态时间线，点击进订单详情）
  const shareRes = await mtCreateOrderShare({
    order: paidOrder,
    idp: opts.app,
    contactId: peer.id,
    fromName: peer.name,
    role: 'peer',
    paidBy: peer.name,
    content: `[美团订单]请你吃的「${paidOrder.merchantName}」已下单，我付好啦`,
  });
  if (!shareRes.ok) return;
  // 灵动岛通知 + 未读角标（聊天不在场也能感知；与主动消息同管线）
  const notifyApp = opts.app === 'wx' ? ('wechat' as const) : ('qq' as const);
  const itemSummary = paidOrder.items.map((i) => `${i.name}${i.qty > 1 ? `x${i.qty}` : ''}`).join('、');
  try {
    pushChatNotification({
      sessionKey: `${opts.app}:${peer.id}`,
      app: notifyApp,
      title: peer.name,
      avatar: avatarFor(peer, opts.app),
      body: `请你吃了「${paidOrder.merchantName}」的外卖（¥${fmt2(paidOrder.total)}），已经付好啦`,
      target: { app: notifyApp, contactId: peer.id },
    });
  } catch {
    /* 忽略 */
  }
  try {
    const { isProactiveChatActive } = await import('./proactive-msg');
    if (!isProactiveChatActive(opts.app, peer.id)) {
      if (opts.app === 'wx') wxUnreads.bump(peer.id, 1);
      else qqUnreads.bump(peer.id, 1);
    }
  } catch {
    /* 忽略 */
  }
  memAddEventFragment(peer.id, opts.app, `你请机主${opts.meName}在美团吃了「${paidOrder.merchantName}」的外卖（${itemSummary}，¥${fmt2(paidOrder.total)}），订单已由你付款`, { eventTime: Date.now(), sourceTag: 'mt-treat-order' });
}

/** 机主联系人（direction 'me' 代付的付款人） */
export async function mtOwnerContactFor(app: MtEngageApp): Promise<{ id: string; name: string; avatar: string | null } | null> {
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

// ---------------- AI 历史序列化（mtpay/mtshare/mtdraft 卡 → AI 可读文本） ----------------

export function mtProxyHistoryLine(pid: string, cardRole: 'req' | 'done', senderName: string): string {
  const p = mtGetProxy(pid);
  if (!p) return `[美团代付卡片]`;
  if (cardRole === 'req') {
    return `[美团代付请求 id:${p.id}]（${senderName}发的：商家「${p.merchantName}」¥${fmt2(p.amount)}，${p.items.map((i) => `${i.name}x${i.qty}`).join('、')}${p.note ? `，备注:${p.note}` : ''}，状态:${p.status === 'pending' ? '待代付' : '已代付'}）`;
  }
  return `[美团代付回执 id:${p.id}]（${senderName}：已代付「${p.merchantName}」¥${fmt2(p.amount)}，订单支付完成）`;
}

export function mtDraftHistoryLine(did: string, senderName: string): string {
  const d = mtGetDraft(did);
  if (!d) return '[美团代点卡片]';
  const status = d.status === 'pending' ? '待机主确认' : d.status === 'confirmed' ? `已下单（订单${d.orderId ?? ''}）` : '机主已取消';
  return `[美团代点 id:${d.id}]（${senderName}帮机主点的：商家「${d.merchantName}」，${d.items.map((i) => `${i.name}x${i.qty}`).join('、')}，约¥${fmt2(d.total ?? d.estimate)}，状态:${status}）`;
}

/** 订单分享卡 → AI 可读文本（含实时配送状态与付款人，AI 能自然接话） */
export function mtOrderShareHistoryLine(sid: string): string {
  const s = mtGetShare(sid);
  if (!s) return '[美团订单分享卡片]';
  const order = mtLoadOrders(s.uid).find((o) => o.id === s.orderId);
  const status = order ? MT_STATUS_LABEL[order.status] : '未知';
  const who = s.paidBy ? `${s.paidBy}请客已付的（机主无需付款）` : `${s.fromName}分享的`;
  return `[美团订单分享]（${who}：「${s.merchantName}」¥${fmt2(s.amount)}，${s.items.map((i) => `${i.name}x${i.qty}`).join('、')}，当前状态:${status}）`;
}

/** AI 幻觉回显剥除：模型有时照抄聊天历史里的卡片序列化行（[美团代付/代点/订单分享…]（…））
 *  当正文发出来——这些行是系统视角的卡片描述不是发言，整行剥除（只剥「整行都是该模式」的行） */
const MT_ECHO_LINE_RE = /^\s*\[美团(?:代付|代点|订单分享)[^\]]*\]\s*（[^）]*）\s*$/;
export function stripMtEchoText(text: string): string {
  const lines = text.split('\n');
  const kept = lines.filter((l) => !MT_ECHO_LINE_RE.test(l));
  return kept.length === lines.length ? text : kept.join('\n');
}

// ---------------- AI 代付决策（机主发起代付请求后的自主决策） ----------------

const decisionInFlight = new Set<string>();

/** 机主发起找人代付后调用：延时让该 AI 角色「看到请求」并按人设/记忆决策是否代付 */
export function scheduleMtProxyAiDecision(pid: string): void {
  if (decisionInFlight.has(pid)) return;
  decisionInFlight.add(pid);
  const delay = 5200 + Math.floor(Math.random() * 6800);
  window.setTimeout(() => {
    void runProxyDecision(pid)
      .catch(() => undefined)
      .finally(() => decisionInFlight.delete(pid));
  }, delay);
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as unknown;
    if (j && typeof j === 'object') return j as Record<string, unknown>;
  } catch {
    /* 继续兜底 */
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as unknown;
      if (j && typeof j === 'object') return j as Record<string, unknown>;
    } catch {
      /* 放弃 */
    }
  }
  return null;
}

async function callLlm(system: string, userContent: string): Promise<string> {
  const apiConfig = useSettings.getState().apiConfig;
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }], ...extra }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  let raw = '';
  try {
    raw = await call({ config: apiConfig });
  } catch {
    raw = '';
  }
  if (!raw.trim()) {
    try {
      raw = await call({ forceSdk: true });
    } catch {
      raw = '';
    }
  }
  return raw;
}

interface ProxyDecision {
  pay: boolean;
  reply: string;
}

async function runProxyDecision(pid: string): Promise<void> {
  const p = mtGetProxy(pid);
  if (!p || p.status !== 'pending') return;
  let contact: ContactRecord | null = null;
  try {
    contact = await getContact(p.contactId);
  } catch {
    contact = null;
  }
  if (!contact || contact.kind === 'user') return;
  const app = p.idp;
  const sessionKey = `${app}:${contact.id}`;
  const owner = await ownerProfileFor(app as AccountApp).catch(() => null);
  const meName = owner?.realName || p.fromName || '机主';

  const persona = buildPersonaSystemPrompt(contact, {
    channel: app === 'wx' ? '微信' : 'QQ',
    userName: owner?.realName || null,
    userRealName: owner?.realName || null,
    userNickname: owner?.nickname || null,
    ownerName: owner?.realName || null,
    accountId: getActiveAccountIdFor(app as AccountApp),
  });
  const summary = p.items.map((i) => `${i.name}x${i.qty}`).join('、');
  const memoryBlock = memChatRecallBlock(contact.id, app, `美团 代付 外卖 ${p.merchantName} ${summary} ${p.note ?? ''}`, {});
  const timeBlock = getTimeAware(sessionKey) ? buildTimeAwareBlock({ regionHint: contact.region || null }) : '';
  const system = [persona, memoryBlock, timeBlock].filter(Boolean).join('\n\n');

  const user = [
    `【刚收到的美团代付请求】\n${meName}（${p.fromName}）在美团拍了「${p.merchantName}」的外卖：${summary}，共 ¥${fmt2(p.amount)}，想请你代付。${p.note ? `订单备注：${p.note}。` : ''}15 分钟内不处理订单会自动取消。`,
    '【任务】结合你的人设、性格、你们的关系、上面的记忆和金额，决定要不要帮TA付这笔钱（演示语义，不会真花钱）。',
    '一般来说：关系亲近、金额不大、人设大方/爱请客/正好想宠TA → 可以付；人设节俭/关系一般/金额偏大/刚闹过矛盾 → 可以婉拒或调侃。两种选择都自然，没有标准答案。',
    '输出 JSON：{"pay":true或false,"reply":"无论付不付都要给对方的一句话回复（像平时聊天，1~2句；付了可以说已付+一句人设话，婉拒就自然说）"}',
    '严禁输出 JSON 以外的文字。',
  ].join('\n\n');

  const raw = await callLlm(system, user);
  const parsed = extractJsonObject(raw) as Partial<ProxyDecision> | null;
  if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) return;
  const reply = parsed.reply.trim().replace(/^[「"'『]+|[」"'』]+$/g, '').split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
  if (!reply) return;

  // 决策落定前复查状态（机主可能已取消/自己付了）
  const cur = mtGetProxy(pid);
  if (!cur || cur.status !== 'pending') return;

  const now = Date.now();
  const outMsgs: { id: string; role: 'me' | 'peer'; content: string; time: number; kind?: 'mtpay'; mtpay?: { pid: string; role: 'req' | 'done' } }[] = [];
  if (parsed.pay === true) {
    const res = mtProxyPayOrder(pid, { deferCard: true });
    if (!res.ok || !res.card) return;
    outMsgs.push(res.card);
    const itemSummary = cur.items.map((i) => `${i.name}x${i.qty}`).join('、');
    memAddEventFragment(contact.id, app, `机主${meName}在美团请你代付「${cur.merchantName}」的订单（¥${fmt2(cur.amount)}，${itemSummary}），你决定帮TA付了`, { eventTime: now, sourceTag: 'mt-proxy-pay' });
  } else {
    memAddEventFragment(contact.id, app, `机主${meName}在美团请你代付「${cur.merchantName}」的订单（¥${fmt2(cur.amount)}），你婉拒了`, { eventTime: now, sourceTag: 'mt-proxy-decline' });
  }
  outMsgs.push({ id: `mtpxr-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, role: 'peer', content: reply, time: now + 1 });

  await deliverPeerMsgs(app, contact, outMsgs);
}

/** 决策消息投递（落库 + 灵动岛通知 + 未读角标；与主动消息同管线） */
async function deliverPeerMsgs(app: MtEngageApp, contact: ContactRecord, msgs: { id: string; role: 'me' | 'peer'; content: string; time: number; kind?: string; mtpay?: { pid: string; role: 'req' | 'done' } }[]): Promise<void> {
  const cid = contact.id;
  const sessionKey = `${app}:${cid}`;
  const notifyApp = app === 'wx' ? ('wechat' as const) : ('qq' as const);
  const { isProactiveChatActive } = await import('./proactive-msg');
  await scheduleAiDelivery<(typeof msgs)[number]>(
    sessionKey,
    msgs,
    (m) => {
      try {
        const key = `${app}-chat-msgs:${cid}`;
        const rawList = kvGet<unknown[]>(key);
        const list = Array.isArray(rawList) ? rawList : [];
        kvSet(key, [...list, m].slice(-200));
      } catch {
        /* 落库失败静默 */
      }
      pushChatNotification({
        sessionKey,
        app: notifyApp,
        title: contact.name,
        avatar: avatarFor(contact, app),
        body: m.content,
        target: { app: notifyApp, contactId: cid },
      });
      if (!isProactiveChatActive(app, cid)) {
        if (app === 'wx') wxUnreads.bump(cid, 1);
        else qqUnreads.bump(cid, 1);
      }
    },
    { initialDelay: 0 },
  );
}

