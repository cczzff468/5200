/**
 * 淘宝客服 AI（第十六轮「开发淘宝消息界面 + AI 提示词规则」）：
 * - 每个店铺一位专属客服（昵称稳定派生），回复走 /api/chat：
 *   「设置 › API 配置」用户配置的 OpenAI 兼容模型优先 → 内置模型兜底 → 本地规则兜底；
 * - 提示词规则：亲切淘宝客服人设 + 店铺资料 + 在售商品目录 + 买家订单上下文 +
 *   十一条服务守则（称呼/发货/售后/物流/尺码/优惠/红线/推荐标记 [商品:ID]）；
 * - 回复里的 [商品:pid] 标记由聊天界面转成商品卡片消息。
 */
import { useSettings } from './store';
import { tbSearchPool, productById, type TbProduct, type TbShop } from './taobao-data';
import { tbLoadOrders, type TbOrder } from './taobao-store';

// ---------------- 客服昵称（同店铺稳定，不同店铺不同：月月/小雨…对照用户截图） ----------------

const AGENT_NAMES = ['月月', '小雨', '安安', '桃子', '晚晚', '糖果', '暖暖', '乐乐', '星野', '苗苗'];

export function tbSellerName(shopId: string): string {
  let h = 0;
  for (let i = 0; i < shopId.length; i++) h = (h * 31 + shopId.charCodeAt(i)) >>> 0;
  return AGENT_NAMES[h % AGENT_NAMES.length];
}

// ---------------- 上下文 ----------------

export interface TbSellerCtx {
  shop: TbShop;
  /** 正在咨询的商品（从商品页「客服」进入时带入） */
  product?: TbProduct | null;
  /** 正在咨询的订单（从订单/物流页「客服」进入时带入） */
  order?: TbOrder | null;
  /** 买家昵称 */
  custName: string;
}

function orderStatusText(o: TbOrder): string {
  switch (o.status) {
    case 'pendingPay':
      return '待付款';
    case 'pendingDeliver':
      return '待发货（付款后 48 小时内发出）';
    case 'shipped':
      return `待收货（${o.track?.[o.track.length - 1]?.text ?? '运输中'}）`;
    case 'completed':
      return '已完成';
    case 'cancelled':
      return o.refund ? `已退款（¥${o.refund.amount.toFixed(2)} 原路退回）` : '已取消';
    default:
      return o.status;
  }
}

/** 店铺在售商品目录（种子 + AI 注册；本店优先，不足补热卖） */
function shopCatalog(shop: TbShop): TbProduct[] {
  const all = tbSearchPool();
  const own = all.filter((p) => p.shopId === shop.id);
  return own.length >= 6 ? own.slice(0, 8) : [...own, ...all.filter((p) => p.shopId !== shop.id)].slice(0, 8);
}

/** 拼商品行：ID | 标题 | ¥价格 */
function productLine(p: TbProduct): string {
  return `- ${p.id} | ${p.title.slice(0, 40)} | ¥${p.price}`;
}

/**
 * AI 提示词规则（客服人设 + 服务守则 + 上下文）。
 * 规则要点（对照真实淘宝客服话术）：
 * 1 称呼「亲」、口语短句 1~3 句 ≤60 字；2 只聊本店商品/订单/售后；3 发货 48h（预售 30 天）；
 * 4 售后按店铺口径；5 不编物流单号；6 尺码给确定建议；7 不虚构折扣；8 红线（不承诺功效/
 * 不引导线下/不索验证码）；9 推荐商品输出 [商品:ID]；10 退款安抚+原路退回口径；11 纯文本简体中文。
 */
export function buildSellerSystemPrompt(ctx: TbSellerCtx): string {
  const { shop, product, order, custName } = ctx;
  const agent = tbSellerName(shop.id);
  const catalog = shopCatalog(shop)
    .map(productLine)
    .join('\n');
  const lines: string[] = [
    `你是淘宝店铺「${shop.name}」的资深客服「${agent}」（店铺体验分 ${shop.rating} 分，${shop.tmall ? '天猫店' : '淘宝企业店'}，店铺简介：${shop.desc ?? '好物甄选'}）。`,
    `你正在和买家「${custName}」用淘宝旺信聊天。`,
    '',
    '【沟通规则（必须遵守）】',
    '1. 称呼买家「亲」，语气亲切热情、口语化；单次回复 1~3 句话、总共不超过 60 字，可用「哦/呢/呀/~」但不能刷屏。',
    '2. 只聊与本店商品、订单、售后、物流有关的话题；无关话题礼貌拉回：「亲，咱们聊聊宝贝和订单的事哦~」。',
    '3. 发货时间：现货 48 小时内发出；预售/定制款 30 天内发货；买家催发货就安抚并说会优先安排。',
    '4. 售后：本店支持质量问题包退换；7 天无理由、退货宝等以商品服务标签为准，不夸大承诺。',
    '5. 物流：绝不编造具体快递单号；让买家点「查看物流」或稍等，说系统会自动推送轨迹。',
    '6. 尺码/规格咨询：买家给身高体重时要给出确定的推荐（衣服给码数 S/M/L，鞋子给码数，家具给尺寸），语气笃定不模棱两可。',
    '7. 价格优惠：不虚构折扣；可以提示「领店铺券」「满减活动」引导下单。',
    '8. 红线：不承诺任何医疗/保健功效；不引导线下交易或加联系方式；不索要密码、验证码。',
    '9. 推荐商品时：在回复最后单独一行输出标记 [商品:商品ID]，只能推荐下方「在售商品目录」里给出的 ID，一次最多 1 个。',
    '10. 退款/售后诉求：先安抚（亲别着急~），说明退款原路退回、1~3 个工作日到账，并引导在订单页申请。',
    '11. 全程简体中文纯文本：不用 markdown、不用表情符号代码、不用换行（标记行除外）。',
    '',
    '【在售商品目录】（推荐时输出 [商品:ID]，仅限以下 ID）',
    catalog,
  ];
  if (product) {
    lines.push(
      '',
      '【买家正在咨询的商品】',
      productLine(product),
      `- 服务标签：${product.tags.join('、') || '无'}；销量：已售${product.sales}+`,
      product.skus.length > 0
        ? `- 规格：${product.skus.map((g) => `${g.name}（${g.options.map((o) => o.label).slice(0, 4).join('/')}）`).join('；')}`
        : '',
    );
  }
  if (order) {
    lines.push(
      '',
      '【买家正在咨询的订单】',
      `- 订单号 ${order.id}｜状态：${orderStatusText(order)}｜实付 ¥${order.total.toFixed(2)}`,
      `- 商品：${order.items.map((i) => `${i.title.slice(0, 20)}×${i.qty}`).join('、')}`,
      order.createdAt ? `- 下单时间：${new Date(order.createdAt).toLocaleString('zh-CN', { hour12: false })}` : '',
    );
  }
  return lines.filter((l) => l !== undefined).join('\n');
}

/** 历史消息（只取文本，卡片转占位描述） */
export interface TbSellerHistoryMsg {
  role: 'user' | 'bot';
  text?: string;
  card?: { type: 'product'; pid: string } | { type: 'order'; orderId: string };
}

function historyToApiMessages(history: TbSellerHistoryMsg[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of history.slice(-8)) {
    if (m.card && !m.text) {
      const label = m.card.type === 'product' ? `（发了商品卡：${productById(m.card.pid)?.title ?? m.card.pid}）` : '（发了订单卡）';
      out.push({ role: m.role === 'user' ? 'user' : 'assistant', content: label });
    } else if (m.text?.trim()) {
      out.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
    }
  }
  return out;
}

/** 本地规则兜底（模型全挂时保证客服仍会说话） */
function localRuleReply(text: string, ctx: TbSellerCtx): string {
  const t = text.trim();
  const agent = tbSellerName(ctx.shop.id);
  const has = (...kw: string[]) => kw.some((k) => t.includes(k));
  if (!t) return `在的亲~有什么可以帮您？`;
  if (has('发货', '多久', '什么时候', '几号')) return '亲，现货 48 小时内发出哦，付款后会优先给您安排呢~';
  if (has('退款', '退钱', '退货')) return '亲别着急~支持售后哦，退款原路退回 1~3 个工作日到账，订单页申请就行呢。';
  if (has('尺码', '身高', '体重', '多大', '大小', '尺寸')) return '亲，报一下身高体重，我帮您推荐合适的尺码哦~';
  if (has('弹性', '弹力', ' stretch')) return '亲，这款有一定弹力的，日常穿着完全够用哦~';
  if (has('正品', '真假', '正版')) return '亲放心，本店正品保证，支持专柜验货，假一赔十哦~';
  if (has('便宜', '优惠', '券', '折扣')) return '亲可以领一下店铺券再下单，更划算呢~';
  if (has('物流', '快递', '到货', '几天')) return '亲，点订单里的「查看物流」就能看到最新轨迹哦，到了会有电话呢~';
  if (has('你好', '在吗', '在么', 'hello')) return `在的在的亲~我是${ctx.shop.name}客服${agent}，请问有什么可以帮您？`;
  if (has('质量', '怎么样', '好用吗', '评价')) return '亲这款回购率很高的，质量您可以放心，不满意还能退哦~';
  return '在的亲~您想了解宝贝的什么问题呢？我这边为您解答哦~';
}

/** 从回复中拆出 [商品:pid] 标记 */
export function parseSellerReply(text: string): { text: string; pids: string[] } {
  const pids: string[] = [];
  const cleaned = text
    .replace(/\s*\[商品[:：]\s*([a-zA-Z0-9-]+)\s*\]/g, (_m, pid: string) => {
      if (pids.length < 2 && productById(pid)) pids.push(pid);
      return '';
    })
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text: cleaned, pids };
}

/**
 * 客服回复：用户配置模型 → forceSdk（内置模型）→ 本地规则。
 * /api/chat 非流式文本返回（与 friend-state/cross-app-reach 同模式）。
 */
export async function tbSellerReply(userText: string, history: TbSellerHistoryMsg[], ctx: TbSellerCtx): Promise<string> {
  const apiMsgs = [
    { role: 'system' as const, content: buildSellerSystemPrompt(ctx) },
    ...historyToApiMessages(history),
    { role: 'user' as const, content: userText || '（买家发来一个表情）' },
  ];
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: apiMsgs, ...extra }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  let raw = '';
  try {
    raw = await call({ config: useSettings.getState().apiConfig });
    if (!raw.trim()) raw = await call({ forceSdk: true });
  } catch {
    try {
      raw = await call({ forceSdk: true });
    } catch {
      raw = '';
    }
  }
  const cleaned = raw.replace(/^"|"$/g, '').trim();
  return cleaned || localRuleReply(userText, ctx);
}

export { localRuleReply };
