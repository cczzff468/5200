import { NextRequest, NextResponse } from 'next/server';
import { MT_CATS, type MtDeal, type MtDealMenu, type MtDish, type MtMerchant } from '@/lib/ios/meituan-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 美团信息流 AI 生成接口：
 * - 优先用「设置 › API 配置」里用户配置好的 OpenAI 兼容模型（config 随请求体传入）；
 * - 未配置 / 上游失败 → 内置模型（z-ai-web-dev-sdk）兜底；
 * - 每次请求注入随机口令 + 排除名单（已展示内容），保证下拉刷新 / 上滑加载出来的都是新内容；
 * - 图片统一 Lorem Picsum（seed 格式，稳定可缓存）；生成数据仅展示用。
 */

// ---------------- 类型 ----------------

interface FeedConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

type RawRec = Record<string, unknown>;

interface GenerateArgs {
  topic: string;
  mode: 'mixed' | 'merchant' | 'deal';
  count: number;
  exclude: string[];
  nonce: string;
}

// ---------------- 工具 ----------------

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function num(v: unknown, def: number, lo: number, hi: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? clampN(n, lo, hi) : def;
}

function intOf(v: unknown, def: number, lo: number, hi: number): number {
  return Math.round(num(v, def, lo, hi));
}

function strOf(v: unknown, def: string, maxLen = 40): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return (s || def).slice(0, maxLen);
}

/** Lorem Picsum 稳定图（同 seed 同图 → 浏览器缓存不重复加载） */
function picsum(seed: string, w = 480, h = 360): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
}

/** baseUrl 归一化候选：完整端点 / /v1 结尾 / 裸域名（与 /api/chat 同策略） */
function buildCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/(\/v\d+)\/v\d+$/, '$1')
    .replace(/(\/v\d+)\/v\d+(?=\/chat\/completions)/, '$1');
  if (trimmed.endsWith('/chat/completions')) return [trimmed];
  if (/\/v\d+$/.test(trimmed)) return [`${trimmed}/chat/completions`];
  return [`${trimmed}/v1/chat/completions`, `${trimmed}/chat/completions`];
}

// ---------------- 上游调用 ----------------

/** 用户配置的 OpenAI 兼容接口（非流式，带 400 换参重试 + SSE 文本兜底解析） */
async function upstreamText(cfg: FeedConfig, system: string, user: string): Promise<string> {
  const candidates = buildCandidates(cfg.baseUrl);
  let useMaxCompletion = false;
  let temperature: number | undefined = cfg.temperature;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response | undefined;
    for (const endpoint of candidates) {
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            stream: false,
            ...(temperature === undefined ? {} : { temperature }),
            ...(useMaxCompletion ? { max_completion_tokens: cfg.maxTokens } : { max_tokens: cfg.maxTokens }),
          }),
          signal: AbortSignal.timeout(90_000),
        });
        if (res.status === 404 && endpoint !== candidates[candidates.length - 1]) continue;
        break;
      } catch (err) {
        lastErr = err;
        res = undefined;
      }
    }
    if (!res) throw lastErr instanceof Error ? lastErr : new Error('上游接口连接失败');
    if (res.status === 400) {
      const msg = (await res.text().catch(() => '')).slice(0, 300);
      if (!useMaxCompletion && /max_completion_tokens/i.test(msg)) {
        useMaxCompletion = true;
        continue;
      }
      if (temperature !== undefined && /temperature/i.test(msg)) {
        temperature = undefined;
        continue;
      }
      throw new Error(`上游 400：${msg || '参数被拒绝'}`);
    }
    if (!res.ok) throw new Error(`上游接口返回 ${res.status}`);

    const raw = (await res.text()).trim();
    if (!raw) throw new Error('上游接口返回空响应');

    // 个别网关用 200 + SSE 文本返回
    if (raw.startsWith('data:')) {
      let acc = '';
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:') || t === 'data: [DONE]') continue;
        try {
          const chunk: unknown = JSON.parse(t.slice(5).trim());
          const c = (chunk as { choices?: Array<{ message?: { content?: unknown }; delta?: { content?: unknown } }> })
            .choices?.[0];
          const content = c?.message?.content ?? c?.delta?.content;
          if (typeof content === 'string') acc += content;
        } catch {
          // 忽略无法解析的行
        }
      }
      if (acc.trim()) return acc;
    }
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        const payload: unknown = JSON.parse(raw);
        const c = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
        if (typeof c === 'string' && c.trim()) return c;
        if (typeof payload === 'object' && payload !== null) {
          const direct =
            (payload as { content?: unknown; response?: unknown }).content ??
            (payload as { response?: unknown }).response;
          if (typeof direct === 'string' && direct.trim()) return direct;
        }
      } catch {
        // 非 JSON，按纯文本返回
      }
    }
    return raw;
  }
  throw new Error('上游接口重试次数用尽');
}

/** 内置模型兜底（z-ai-web-dev-sdk，仅后端） */
async function sdkText(system: string, user: string): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: system },
      { role: 'user', content: user },
    ],
    thinking: { type: 'disabled' },
  });
  const text = completion.choices[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('内置模型返回空内容');
  return text;
}

// ---------------- 输出解析 ----------------

/** 逐对象容错扫描：string-aware 括号配对，逐个提取完整 {} 解析。
 *  模型长输出可能被截断或中间出现坏字节（整体 JSON.parse 失败），逐对象提取能救回大部分数据。 */
function extractObjects(raw: string): RawRec[] {
  const t = raw.replace(/\uFFFD/g, '');
  const objs: RawRec[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const v: unknown = JSON.parse(t.slice(start, i + 1));
          if (typeof v === 'object' && v !== null) objs.push(v as RawRec);
        } catch {
          // 跳过坏对象
        }
        start = -1;
      }
    }
  }
  return objs;
}

/** 从模型输出提取数据项：先试整体 JSON（含 markdown 剥壳），失败 → 逐对象容错扫描 */
function parseItems(raw: string): RawRec[] {
  const t = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const s = t.indexOf('[');
  const e = t.lastIndexOf(']');
  if (s !== -1 && e > s) {
    try {
      const v: unknown = JSON.parse(t.slice(s, e + 1));
      if (Array.isArray(v)) return v.filter((x): x is RawRec => typeof x === 'object' && x !== null);
    } catch {
      // 落入逐对象扫描
    }
  }
  return extractObjects(t);
}

// ---------------- 提示词 ----------------

function buildSystem(): string {
  return '你是美团信息流数据引擎，负责生成逼真的本地生活商家与团购数据。数值必须符合现实常识（评分 3.8~5.0、价格与折扣自洽、距离 0.3~8 公里）。只输出 JSON，不要输出任何解释、注释或 markdown 代码块。';
}

function buildUser(a: GenerateArgs): string {
  // schema 精简（menu 2~4 个、去掉 hours/notice）以在模型输出上限内装下更多条目
  const merchantSchema =
    '{"kind":"merchant","name":"老灶火锅·望京店","emoji":"🍲","rating":4.8,"monthSale":3200,"minOrder":20,"deliveryFee":2,"distanceKm":1.5,"deals":["满30减5"],"addr":"望京街道湖光中街1号","menu":[{"name":"招牌毛肚","price":38,"emoji":"🍲"},{"name":"鲜切牛肉","price":45,"emoji":"🥩"}]}';
  const dealSchema =
    '{"kind":"deal","title":"双人烤肉超值套餐","emoji":"🍖","price":88,"origPrice":168,"sold":"已售1.2万+","praise":"96%好评","tips":"到店吃","distanceKm":2.1,"merchantName":"炭一烤肉·望京店","menu":[{"sec":"套餐内容","items":[{"name":"烤肉拼盘","price":168},{"name":"饮品2杯","price":20}]}]}';

  const kindRule =
    a.mode === 'merchant'
      ? '每条都是 kind="merchant" 的商家。'
      : a.mode === 'deal'
        ? '每条都是 kind="deal" 的团购（必须带 merchantName）。'
        : '商家（kind="merchant"）与团购（kind="deal"，必须带 merchantName）数量大致各半。';

  return [
    `生成 ${a.count} 条美团「${a.topic}」信息流数据。${kindRule}`,
    `本次随机口令「${a.nonce}」：商家名、套餐名必须新颖独特（可自创小店品牌+品类/分店后缀，如「巷口葱油饼·五道口店」风格），禁止照抄知名连锁品牌原名。`,
    a.exclude.length > 0
      ? `以下名称已展示过，禁止再出现（商家名与套餐名都不得重复）：\n${a.exclude.join('、')}`
      : '无排除名单。',
    '字段规范（示例名称仅示意格式，输出中禁止出现「老灶火锅」「炭一烤肉」等示例名）：',
    `merchant = ${merchantSchema}`,
    `deal = ${dealSchema}`,
    `要求：rating 3.8~5.0；monthSale 50~90000 整数；price 与 origPrice 自洽（origPrice 更高，折扣约 3~8 折）；distanceKm 0.3~8 一位小数；deals 为 0~2 个优惠文案；merchant 的 menu 为 2~4 个菜品；deal 的 menu 为套餐内容清单。全部简体中文，数据要合理逼真。输出尽量精炼，确保 ${a.count} 条全部输出完整。`,
    '只输出一个 JSON 数组，不要 markdown 代码块，不要解释。',
  ].join('\n');
}

// ---------------- 数据塑形 ----------------

function coerceDish(mid: string, idx: number, raw: unknown): MtDish {
  // 模型可能把菜品返回为字符串（"毛肚"）而非对象：统一收窄
  const rec: RawRec =
    typeof raw === 'string'
      ? { name: raw }
      : typeof raw === 'object' && raw !== null
        ? (raw as RawRec)
        : {};
  return {
    id: `${mid}-d${idx}`,
    name: strOf(rec.name, `招牌菜${idx + 1}`, 24),
    price: num(rec.price, 12 + idx * 3, 0.5, 999),
    emoji: strOf(rec.emoji, '🍽️', 4),
    img: picsum(`${mid}-d${idx}`, 400, 400),
    monthSale: intOf(rec.monthSale, 800 + Math.floor(Math.random() * 9000), 20, 999999),
  };
}

function coerceMenuSections(mid: string, rawMenu: unknown): { cat: string; dishes: MtDish[] }[] {
  const arr = Array.isArray(rawMenu) ? rawMenu.slice(0, 8) : [];
  const dishes = arr.map((d, i) => coerceDish(mid, i, d));
  if (dishes.length === 0) dishes.push(coerceDish(mid, 0, {}));
  return [{ cat: '推荐', dishes }];
}

function buildMerchant(id: string, raw: unknown, filter: string | null): MtMerchant {
  const rec: RawRec = typeof raw === 'object' && raw !== null ? (raw as RawRec) : {};
  const deals = (Array.isArray(rec.deals) ? rec.deals : [])
    .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    .slice(0, 2);
  return {
    id,
    name: strOf(rec.name, '宝藏好店', 24),
    emoji: strOf(rec.emoji, '🏪', 4),
    cover: picsum(`${id}-cover`),
    cats: filter && filter !== 'tuangou' ? [filter] : ['meishi'],
    rating: Math.round(num(rec.rating, 4.7, 3.5, 5) * 10) / 10,
    monthSale: intOf(rec.monthSale, 1200 + Math.floor(Math.random() * 6000), 10, 999999),
    minOrder: intOf(rec.minOrder, 20, 0, 99),
    deliveryFee: Math.round(num(rec.deliveryFee, 2, 0, 9) * 10) / 10,
    distanceKm: Math.round(num(rec.distanceKm, 1.5, 0.2, 9.9) * 10) / 10,
    deliveryMin: intOf(rec.deliveryMin, 35, 15, 90),
    notice: typeof rec.notice === 'string' && rec.notice.trim() ? rec.notice.trim().slice(0, 40) : undefined,
    deals: deals.length > 0 ? deals : ['新客立减'],
    hours: strOf(rec.hours, '09:00-22:00', 24),
    addr: strOf(rec.addr, '望京街道湖光中街1号', 40),
    sections: coerceMenuSections(id, rec.menu),
    reviews: [],
  };
}

function coerceDealMenu(rawMenu: unknown): MtDealMenu[] {
  if (!Array.isArray(rawMenu) || rawMenu.length === 0) {
    return [{ sec: '套餐内容', items: [{ name: '套餐详情见门店', price: 0 }] }];
  }
  const out: MtDealMenu[] = [];
  for (const sec of rawMenu.slice(0, 5)) {
    const s: RawRec = typeof sec === 'object' && sec !== null ? (sec as RawRec) : {};
    const itemsRaw = Array.isArray(s.items) ? s.items : [];
    const items = itemsRaw.slice(0, 10).map((it) => {
      const r: RawRec = typeof it === 'object' && it !== null ? (it as RawRec) : {};
      return { name: strOf(r.name, '套餐项目', 24), price: num(r.price, 0, 0, 9999) };
    });
    out.push({
      sec: strOf(s.sec, '套餐内容', 16),
      items: items.length > 0 ? items : [{ name: '套餐详情见门店', price: 0 }],
    });
  }
  return out;
}

function buildDeal(id: string, raw: unknown, merchantId: string): MtDeal {
  const rec: RawRec = typeof raw === 'object' && raw !== null ? (raw as RawRec) : {};
  const price = num(rec.price, 29.9, 0.5, 9999);
  let origPrice = num(rec.origPrice, price * 2, 0.5, 99999);
  if (origPrice < price * 1.15) origPrice = Math.round(price * 2 * 10) / 10;
  const discount =
    typeof rec.discount === 'string' && rec.discount.trim()
      ? rec.discount.trim().slice(0, 8)
      : `${Math.round((price / origPrice) * 100) / 10}折`;
  return {
    id,
    merchantId,
    title: strOf(rec.title, '超值双人套餐', 30),
    img: picsum(`${id}-img`),
    emoji: strOf(rec.emoji, '🍱', 4),
    price: Math.round(price * 10) / 10,
    origPrice: Math.round(origPrice * 10) / 10,
    discount,
    sold:
      typeof rec.sold === 'string' && rec.sold.trim()
        ? rec.sold.trim().slice(0, 16)
        : `已售${500 + Math.floor(Math.random() * 9000)}+`,
    praise:
      typeof rec.praise === 'string' && /\d+%/.test(rec.praise)
        ? rec.praise.trim().slice(0, 10)
        : `${88 + Math.floor(Math.random() * 12)}%好评`,
    tips: strOf(rec.tips, '到店吃', 6),
    distanceKm: Math.round(num(rec.distanceKm, 1.5, 0.2, 9.9) * 10) / 10,
    usable: '周一至周日可用',
    notice: '本单将于7天后过期，请注意周末、节假日是否可用',
    menu: coerceDealMenu(rec.menu),
    storeTags: ['随时退', '免预约', '过期自动退'],
  };
}

// ---------------- 路由入口 ----------------

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const root: RawRec = typeof body === 'object' && body !== null ? (body as RawRec) : {};

  // filter：null=推荐混合 / 'tuangou'=团购频道 / 分类 id
  const filter = typeof root.filter === 'string' && root.filter.trim() ? root.filter.trim() : null;
  const catName = MT_CATS.find((c) => c.id === filter)?.name;
  const topic =
    filter === 'tuangou' ? '到店团购' : catName ? `${catName}频道` : '综合推荐（外卖商家+到店团购混合）';
  const mode: GenerateArgs['mode'] = filter === 'tuangou' ? 'deal' : catName ? 'merchant' : 'mixed';
  const count = intOf(root.count, 16, 8, 20);
  const exclude = (Array.isArray(root.exclude) ? root.exclude : [])
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, 80);
  const NONCE_A = `${Date.now().toString(36)}a${Math.random().toString(36).slice(2, 6)}`;
  const NONCE_B = `${Date.now().toString(36)}b${Math.random().toString(36).slice(2, 6)}`;

  // 用户配置（设置 › API 配置）：随请求体传入，不落盘
  let userCfg: FeedConfig | null = null;
  const rawCfg = root.config;
  if (typeof rawCfg === 'object' && rawCfg !== null) {
    const c = rawCfg as RawRec;
    if (typeof c.baseUrl === 'string' && c.baseUrl.trim()) {
      userCfg = {
        baseUrl: c.baseUrl.trim(),
        apiKey: typeof c.apiKey === 'string' ? c.apiKey.trim() : '',
        model: typeof c.model === 'string' && c.model.trim() ? c.model.trim() : 'gpt-4o-mini',
        temperature: num(c.temperature, 0.9, 0, 2),
        maxTokens: intOf(c.maxTokens, 4096, 256, 32768),
      };
    }
  }

  const system = buildSystem();

  /** 单次生成：用户模型优先，失败落内置模型；返回解析出的数据项 */
  const generateOnce = async (nonce: string, n: number): Promise<{ items: RawRec[]; source: 'user' | 'sdk' }> => {
    const user = buildUser({ topic, mode, count: n, exclude, nonce });
    try {
      if (userCfg) {
        return { items: parseItems(await upstreamText(userCfg, system, user)), source: 'user' };
      }
      return { items: parseItems(await sdkText(system, user)), source: 'sdk' };
    } catch {
      // 用户模型失败 → 内置模型兜底
      return { items: parseItems(await sdkText(system, user)), source: 'sdk' };
    }
  };

  // 并发两批生成（每批 ~count/2）：绕开单次输出上限，凑足 15~20 条；一批失败用另一批兜底
  const half = Math.max(8, Math.ceil(count / 2));
  const [batchA, batchB] = await Promise.all([
    generateOnce(NONCE_A, half).catch(() => ({ items: [] as RawRec[], source: 'sdk' as const })),
    generateOnce(NONCE_B, count - half).catch(() => ({ items: [] as RawRec[], source: 'sdk' as const })),
  ]);
  const allItems = [...batchA.items, ...batchB.items];
  const source: 'user' | 'sdk' = batchA.source === 'user' || batchB.source === 'user' ? 'user' : 'sdk';

  if (allItems.length === 0) {
    return NextResponse.json({ ok: false, error: 'AI 生成失败：两次生成均未返回有效数据' }, { status: 200 });
  }

  const items = allItems;
  const ts = Date.now().toString(36);
  const merchants: MtMerchant[] = [];
  const deals: MtDeal[] = [];
  const merchantByName = new Map<string, MtMerchant>();
  const excludeSet = new Set(exclude); // 模型可能不严格遵守排除名单：塑形层强制过滤，保证追加内容不与上方重复
  let seq = 0;

  // 先建商家（deal.merchantName 关联用）
  for (const it of items) {
    const rec: RawRec = typeof it === 'object' && it !== null ? (it as RawRec) : {};
    if (rec.kind !== 'merchant' || merchants.length >= 20) continue;
    const m = buildMerchant(`ai-m-${ts}-${seq++}`, rec, filter);
    if (merchantByName.has(m.name) || excludeSet.has(m.name)) continue;
    merchants.push(m);
    merchantByName.set(m.name, m);
  }

  // 再建团购，并保证每单都挂到有效商家
  const dealTitles = new Set<string>();
  for (const it of items) {
    const rec: RawRec = typeof it === 'object' && it !== null ? (it as RawRec) : {};
    if (rec.kind !== 'deal' || deals.length >= 20) continue;
    const title = strOf(rec.title, '超值双人套餐', 30);
    if (dealTitles.has(title) || excludeSet.has(title)) continue; // 两批并发可能撞名/已展示过：按标题去重
    dealTitles.add(title);
    const merchantName = typeof rec.merchantName === 'string' ? rec.merchantName.trim() : '';
    let host = merchantName ? merchantByName.get(merchantName) : undefined;
    if (!host) {
      const name = merchantName || `精选好店·${['望京', '国贸', '五道口', '中关村'][seq % 4]}店`;
      const existing = merchantByName.get(name);
      if (existing) {
        host = existing;
      } else {
        const id = `ai-m-${ts}-${seq++}`;
        host = buildMerchant(id, { name, kind: 'merchant' }, filter);
        merchants.push(host);
        merchantByName.set(name, host);
      }
    }
    const id = `ai-d-${ts}-${deals.length}`;
    deals.push(buildDeal(id, rec, host ? host.id : merchants[0]?.id ?? id));
  }

  // 该频道一样都没有 → 交给前端本地兜底
  if (merchants.length === 0 && deals.length === 0) {
    return NextResponse.json({ ok: false, error: '模型未返回有效数据' }, { status: 200 });
  }

  return NextResponse.json({ ok: true, source, merchants, deals });
}
