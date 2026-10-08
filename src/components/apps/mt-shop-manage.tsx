'use client';

/**
 * 店铺管理页（商家中心 → 点某个店铺进入；视觉对齐买家端店铺页）：
 * - 头图 + 店铺信息（logo / 店名 / ★评分 月售 时长·距离 / 公告）；
 * - 页签：点菜（左分区栏 + 右菜品列表，点菜品进编辑）/ 评价 / 商家 / 订单；
 * - 右下角「黄色大加号」悬浮按钮（外圈黄色光晕包裹）→ 添加菜品（独立全屏页）；
 * - 商家页签：店铺信息 / 营业开关 / 优惠券 / 编辑店铺 / 删除店铺（二次确认）；
 * - 全部图标使用 Lucide 线条图标（无 emoji），无图菜品用渐变 + 线条图标占位。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BadgePercent,
  Bike,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Megaphone,
  PackageOpen,
  Pencil,
  Plus,
  Receipt,
  Star,
  Store,
  Tags,
  Ticket,
  Trash2,
} from 'lucide-react';
import { MT_CATS, mtRegisterAiMerchant, mtUnregisterMerchant, type MtDish, type MtMerchant } from '@/lib/ios/meituan-data';
import {
  MT_STATUS_LABEL,
  mtLoadCart,
  mtLoadOrders,
  mtLoadShops,
  mtSaveCart,
  mtSaveShops,
  mtUidOf,
  type MtOrder,
  type MtSession,
} from '@/lib/ios/meituan-store';
import { DishImg, ShopImg } from './mt-merchant-ui';
import DishEditPage from './mt-dish-edit';

const MT_YELLOW = '#FFD100';
const MT_PRICE = '#FF4B33';

const money = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtMoney = (n: number): string => money(Math.round(n * 100) / 100);
/** 分类 id → 展示名（未知 id 原样展示） */
const catName = (id: string): string => MT_CATS.find((c) => c.id === id)?.name ?? id;

export default function ShopManagePage({
  session,
  shopId,
  onBack,
  onEditShop,
  onChanged,
  onToast,
}: {
  session: MtSession;
  shopId: string;
  onBack: () => void;
  /** 编辑店铺信息（店名/背景/分类/优惠券）→ 入驻表单回填 */
  onEditShop: () => void;
  /** 店铺数据有变 → 首页信息流失效 */
  onChanged: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const loadShop = useCallback((): MtMerchant | undefined => mtLoadShops(uid).find((s) => s.id === shopId), [uid, shopId]);
  const [shop, setShop] = useState<MtMerchant | undefined>(() => loadShop());
  const [tab, setTab] = useState<'点菜' | '评价' | '商家' | '订单'>('点菜');
  const [activeCat, setActiveCat] = useState(0);
  const [dishPage, setDishPage] = useState<{ catIdx: number; dish: MtDish | null } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [orders, setOrders] = useState<MtOrder[]>(() => mtLoadOrders(uid).filter((o) => o.merchantId === shopId));
  const catRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 订单状态推进刷新（事件 + 轮询双通道，同 useOrdersTick 口径）
  useEffect(() => {
    const bump = () => setOrders(mtLoadOrders(uid).filter((o) => o.merchantId === shopId));
    const iv = setInterval(bump, 3000);
    window.addEventListener('mt-orders-changed', bump);
    return () => {
      clearInterval(iv);
      window.removeEventListener('mt-orders-changed', bump);
    };
  }, [uid, shopId]);

  const reload = () => setShop(loadShop());

  /** 持久化店铺：保存 + 注册表同步 + 首页信息流失效 */
  const persist = (next: MtMerchant, toast: string) => {
    const list = mtLoadShops(uid);
    mtSaveShops(uid, list.map((s) => (s.id === next.id ? next : s)));
    mtRegisterAiMerchant(next);
    setShop(next);
    onChanged();
    onToast(toast);
  };

  const closed = shop?.mtStatus === 'closed';

  const toggleStatus = () => {
    if (!shop) return;
    const nextStatus: 'open' | 'closed' = shop.mtStatus === 'closed' ? 'open' : 'closed';
    persist({ ...shop, mtStatus: nextStatus }, nextStatus === 'closed' ? `「${shop.name}」已打烊，首页不再展示` : `「${shop.name}」恢复营业`);
  };

  const removeShop = () => {
    if (!shop) return;
    const list = mtLoadShops(uid).filter((x) => x.id !== shop.id);
    mtSaveShops(uid, list);
    mtUnregisterMerchant(shop.id);
    const cart = mtLoadCart(uid);
    if (cart.merchantId === shop.id) mtSaveCart(uid, { merchantId: null, items: [] });
    onChanged();
    onToast(`「${shop.name}」已删除`);
    onBack();
  };

  const saveDish = (catIdx: number, d: MtDish) => {
    if (!shop) return;
    const sections = shop.sections.map((s, i) => {
      if (i !== catIdx) return s;
      const exists = s.dishes.some((x) => x.id === d.id);
      return { ...s, dishes: exists ? s.dishes.map((x) => (x.id === d.id ? d : x)) : [...s.dishes, d] };
    });
    persist({ ...shop, sections }, '菜品已保存');
    setDishPage(null);
  };

  const deleteDish = (catIdx: number, d: MtDish) => {
    if (!shop) return;
    const sections = shop.sections.map((s, i) => (i !== catIdx ? s : { ...s, dishes: s.dishes.filter((x) => x.id !== d.id) }));
    persist({ ...shop, sections }, `「${d.name}」已删除`);
    setDishPage(null);
  };

  const myReviews = useMemo(
    () =>
      orders
        .filter((o) => o.review)
        .map((o) => ({
          user: `${session.name}（本店订单）`,
          rating: o.review!.rating,
          content: o.review!.content,
          time: new Date(o.review!.at).toLocaleDateString('zh-CN'),
        })),
    [orders, session.name]
  );

  if (!shop) {
    // 店铺刚被删除等极端情况：给出兜底返回
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#F4F5F7] gap-3">
        <PackageOpen className="h-10 w-10 text-black/25" strokeWidth={1.6} />
        <p className="text-[14px] text-black/45">店铺不存在或已删除</p>
        <button type="button" onClick={onBack} className="h-10 rounded-full px-8 text-[14px] font-medium text-black/80" style={{ background: MT_YELLOW }}>
          返回商家中心
        </button>
      </div>
    );
  }

  const dishTotal = shop.sections.reduce((acc, s) => acc + s.dishes.length, 0);
  const liveOrderCount = orders.filter((o) => ['pendingPay', 'pendingAccept', 'accepted', 'delivering'].includes(o.status)).length;

  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      {/* 头图（店铺背景） */}
      <div className="relative h-[150px] shrink-0">
        <ShopImg name={shop.name} cover={shop.cover} className="h-full w-full" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 pt-[54px]">
          <button type="button" aria-label="返回商家中心" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-black/35 text-white active:opacity-75">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="编辑店铺信息"
            data-testid="mt-manage-edit-shop"
            onClick={onEditShop}
            className="grid h-9 w-9 place-items-center rounded-full bg-black/35 text-white active:opacity-75"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
        {closed && (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 py-1 text-center text-[11px] text-white">已打烊 · 首页暂停展示</div>
        )}
      </div>

      {/* 店铺信息（对齐买家端店铺头） */}
      <div className="relative z-10 border-b border-black/[0.05] bg-white px-4 pb-3.5 pt-3.5">
        <div className="flex gap-3">
          <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl ring-1 ring-black/[0.06]">
            <ShopImg name={shop.name} cover={shop.cover} className="h-full w-full" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-[19px] font-bold leading-snug text-black/85">
              {shop.name}
              <span className={`shrink-0 rounded px-1.5 py-px text-[9px] font-medium ${closed ? 'bg-black/[0.07] text-black/45' : 'bg-[#FFF3C4] text-[#8A6A00]'}`}>
                {closed ? '已打烊' : '营业中'}
              </span>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[12px] text-black/50">
              <span className="flex items-center gap-0.5 text-[#FF6000]">
                <Star className="h-3 w-3 fill-[#FF6000]" strokeWidth={0} />
                <span className="font-semibold">{shop.rating}</span>
              </span>
              <span>月售{shop.monthSale}+</span>
              <span>{shop.deliveryMin}分钟 · {shop.distanceKm}km</span>
            </p>
          </div>
        </div>
        <p className="mt-2 text-right text-[11px] text-black/35">公告：{shop.notice?.slice(0, 14) || '无'}</p>
      </div>

      {/* 页签（点菜/评价/商家/订单） */}
      <div className="flex shrink-0 items-center gap-6 bg-white px-5">
        {(['点菜', '评价', '商家', '订单'] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`mt-manage-tab-${t}`}
            onClick={() => setTab(t)}
            className={`relative py-2.5 text-[15px] ${tab === t ? 'font-bold text-black/85' : 'text-black/45'}`}
          >
            {t}
            {t === '订单' && liveOrderCount > 0 && (
              <span className="absolute -right-3 top-1.5 grid h-[14px] min-w-[14px] place-items-center rounded-full bg-[#FF3B30] px-0.5 text-[9px] font-bold text-white">
                {liveOrderCount}
              </span>
            )}
            {tab === t && <span className="absolute -bottom-px left-1/2 h-[3px] w-7 -translate-x-1/2 rounded-full" style={{ background: MT_YELLOW }} />}
          </button>
        ))}
      </div>

      {/* 点菜：左分区栏 + 菜品列表（点菜品 → 编辑） */}
      {tab === '点菜' && (
        <div className="relative flex min-h-0 flex-1">
          <div className="w-[88px] shrink-0 overflow-y-auto bg-[#EDEEF0] pb-28 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {shop.sections.map((s, i) => (
              <button
                key={`${s.cat}-${i}`}
                type="button"
                onClick={() => {
                  setActiveCat(i);
                  catRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`flex w-full flex-col items-center gap-0.5 px-2 py-3.5 text-[12px] leading-tight ${activeCat === i ? 'bg-white font-semibold text-black/85' : 'text-black/50'}`}
              >
                <span>{s.cat}</span>
                <span className="text-[10px] text-black/35">{s.dishes.length}种</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto bg-white px-3 pb-32 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {shop.sections.map((s, i) => (
              <div key={`${s.cat}-${i}`} ref={(el) => { catRefs.current[i] = el; }} className="scroll-mt-2">
                <p className="py-2.5 text-[15px] font-bold text-black/80">{s.cat}</p>
                {s.dishes.length === 0 && (
                  <p className="pb-2 text-[12px] text-black/30">这个分区还没有菜，点右下角黄色「+」添加</p>
                )}
                {s.dishes.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    data-testid={`mt-manage-dish-${d.name}`}
                    onClick={() => setDishPage({ catIdx: i, dish: d })}
                    className="flex w-full gap-2.5 py-2 text-left active:opacity-80"
                  >
                    <span className="relative shrink-0">
                      <DishImg name={d.name} img={d.img} className="h-[80px] w-[80px] rounded-xl" />
                      <span className="absolute right-1 top-1 grid h-[20px] w-[20px] place-items-center rounded-full bg-black/35 text-white">
                        <Pencil className="h-2.5 w-2.5" strokeWidth={2.4} />
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1 text-[15px] font-semibold leading-snug text-black/85">
                        <span className="truncate">{d.name}</span>
                        {d.specs && d.specs.length > 0 && (
                          <span className="shrink-0 rounded bg-[#FFF3C4] px-1 py-px text-[9px] font-normal text-[#8A6A00]">{d.specs.length}组规格</span>
                        )}
                      </span>
                      {d.desc && <span className="mt-0.5 line-clamp-1 text-[11px] text-black/40">{d.desc}</span>}
                      <span className="mt-0.5 text-[11px] text-black/35">月售{d.monthSale}</span>
                      <span className="mt-auto flex items-end pt-1 text-[17px] font-bold" style={{ color: MT_PRICE }}>
                        <span className="text-[11px]">¥</span>
                        {fmtMoney(d.price)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {dishTotal === 0 && (
              <div className="flex flex-col items-center gap-2 pb-6 pt-14 text-black/30">
                <PackageOpen className="h-9 w-9" strokeWidth={1.5} />
                <p className="text-[13px]">还没有菜品，点右下角「+」添加第一道菜</p>
              </div>
            )}
          </div>

          {/* 右下角：黄色大加号（外圈黄色光晕包裹） */}
          <button
            type="button"
            aria-label="添加菜品"
            data-testid="mt-manage-add-dish"
            onClick={() => setDishPage({ catIdx: Math.min(activeCat, shop.sections.length - 1), dish: null })}
            className="group absolute bottom-7 right-5 z-20"
          >
            <span className="absolute -inset-2 rounded-full bg-[#FFD100]/30 transition-transform group-active:scale-90" aria-hidden="true" />
            <span
              className="relative grid h-14 w-14 place-items-center rounded-full shadow-[0_10px_24px_rgba(255,190,0,0.5)] ring-4 ring-white/70 transition-transform group-active:scale-90"
              style={{ background: MT_YELLOW }}
            >
              <Plus className="h-7 w-7 text-black/85" strokeWidth={2.8} />
            </span>
          </button>
        </div>
      )}

      {/* 评价 */}
      {tab === '评价' && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 pb-10 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-end gap-2">
            <span className="text-[34px] font-bold leading-none text-[#FF6000]">{shop.rating}</span>
            <span className="pb-1 text-[12px] text-black/40">综合评分 · 月售{shop.monthSale}+</span>
          </div>
          {shop.reviews.length === 0 && myReviews.length === 0 ? (
            <div className="flex flex-col items-center gap-2 pb-10 pt-16 text-black/30">
              <Star className="h-9 w-9" strokeWidth={1.5} />
              <p className="text-[13px]">还没有评价，买家晒单后会显示在这里</p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {myReviews.map((r, i) => (
                <div key={`my-${i}`} className="flex gap-2.5 border-b border-black/5 pb-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FFF1C0] to-[#FFD100] text-[14px] font-bold text-black/60">
                    {r.user.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-black/75">{r.user}</p>
                    <p className="mt-0.5 flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, si) => (
                        <Star key={si} className={`h-3 w-3 ${si < Math.round(r.rating) ? 'fill-[#FF6000] text-[#FF6000]' : 'text-black/15'}`} strokeWidth={1.5} />
                      ))}
                      <span className="ml-1 text-[11px] text-black/30">{r.time}</span>
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-black/70">{r.content}</p>
                  </div>
                </div>
              ))}
              {shop.reviews.map((r, i) => (
                <div key={`seed-${i}`} className="flex gap-2.5 border-b border-black/5 pb-4 last:border-0">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FFF1C0] to-[#FFD100] text-[14px] font-bold text-black/60">
                    {r.user.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-black/75">{r.user}</p>
                    <p className="mt-0.5 flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, si) => (
                        <Star key={si} className={`h-3 w-3 ${si < Math.round(r.rating) ? 'fill-[#FF6000] text-[#FF6000]' : 'text-black/15'}`} strokeWidth={1.5} />
                      ))}
                      <span className="ml-1 text-[11px] text-black/30">{r.time}</span>
                    </p>
                    {r.content && <p className="mt-1 text-[13px] leading-relaxed text-black/70">{r.content}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 商家：信息 / 营业开关 / 优惠券 / 危险操作 */}
      {tab === '商家' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-black/[0.03]">
            <p className="flex items-center gap-1.5 text-[14px] font-bold text-black/80">
              <Store className="h-4 w-4 text-black/55" strokeWidth={1.9} />
              店铺信息
            </p>
            <div className="mt-2.5 flex flex-col gap-2.5 text-[13px]">
              {([
                [Tags, '店铺分类', shop.cats.map(catName).join(' / ')],
                [Megaphone, '店铺公告', shop.notice || '无'],
                [Receipt, '店铺地址', shop.addr],
                [CalendarClock, '营业时间', shop.hours],
                [PackageOpen, '起送价', `¥${money(shop.minOrder)}`],
                [Bike, '配送费', `¥${money(shop.deliveryFee)}`],
              ] as [typeof Tags, string, string][]).map(([Icon, label, val]) => (
                <p key={label} className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-black/35" strokeWidth={1.9} />
                  <span className="w-16 shrink-0 text-black/40">{label}</span>
                  <span className="min-w-0 flex-1 truncate text-black/75">{val}</span>
                </p>
              ))}
            </div>
          </div>

          <div className="mt-3 flex items-center rounded-2xl bg-white p-4 ring-1 ring-black/[0.03]">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-black/80">营业状态</p>
              <p className="mt-0.5 text-[11px] text-black/40">{closed ? '已打烊：首页不再展示，买家无法下单' : '营业中：首页正常展示、可接单'}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!closed}
              aria-label="营业状态开关"
              data-testid="mt-manage-toggle"
              onClick={toggleStatus}
              className="relative h-[28px] w-[50px] shrink-0 rounded-full transition-colors"
              style={{ background: closed ? '#D8D8D8' : MT_YELLOW }}
            >
              <span className="absolute top-[2px] h-[24px] w-[24px] rounded-full bg-white shadow transition-all" style={{ left: closed ? 2 : 24 }} />
            </button>
          </div>

          <div className="mt-3 rounded-2xl bg-white p-4 ring-1 ring-black/[0.03]">
            <div className="flex items-center">
              <p className="flex items-center gap-1.5 text-[14px] font-bold text-black/80">
                <Ticket className="h-4 w-4 text-black/55" strokeWidth={1.9} />
                店铺优惠券（{(shop.coupons ?? []).length}）
              </p>
              <button type="button" data-testid="mt-manage-coupon-edit" onClick={onEditShop} className="ml-auto flex items-center gap-0.5 text-[12px] font-medium text-[#B77900] active:opacity-70">
                去添加 / 编辑
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            {(shop.coupons ?? []).length === 0 ? (
              <p className="mt-2 text-[12px] text-black/35">还没有发券，满减券能帮店铺带来更多下单</p>
            ) : (
              <div className="mt-2.5 flex flex-col gap-2">
                {(shop.coupons ?? []).map((c) => (
                  <div key={c.id} className="flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[#FFF3C4] to-[#FFEDAD] px-3 py-2 ring-1 ring-[#FFD100]/50">
                    <BadgePercent className="h-4 w-4 shrink-0 text-[#8A4B00]" strokeWidth={1.9} />
                    <span className="text-[16px] font-bold text-[#8A4B00]">¥{money(c.amount)}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[#5A4200]/80">
                      {c.name} · 满 ¥{money(c.min)} 可用
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            data-testid="mt-manage-delete"
            onClick={() => setConfirmDel(true)}
            className="mt-3 flex h-12 w-full items-center justify-center gap-1.5 rounded-2xl bg-white text-[14px] font-medium text-[#FF4B33] ring-1 ring-[#FF4B33]/25 active:bg-[#FFF0EB]"
          >
            <Trash2 className="h-4 w-4" />
            删除店铺
          </button>
        </div>
      )}

      {/* 订单：本店订单列表 */}
      {tab === '订单' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 pb-10 pt-16 text-black/30">
              <Receipt className="h-9 w-9" strokeWidth={1.5} />
              <p className="text-[13px]">还没有订单，买家下单后会显示在这里</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {orders.map((o) => {
                const canceled = o.status === 'canceled';
                return (
                  <div key={o.id} className={`rounded-2xl bg-white p-3.5 ring-1 ring-black/[0.03] ${canceled ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 shrink-0 text-black/30" />
                      <span className="text-[11px] text-black/35">{new Date(o.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      <span className={`ml-auto text-[12px] font-semibold ${canceled ? 'text-black/35' : 'text-[#FF6000]'}`}>{MT_STATUS_LABEL[o.status]}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-black/75">
                      {o.items.map((it) => `${it.name}x${it.qty}`).join('，')}
                    </p>
                    <p className="mt-1.5 text-right text-[14px] font-bold text-black/85">
                      实收 <span style={{ color: MT_PRICE }}>¥{fmtMoney(o.total)}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 添加/编辑菜品（独立全屏页，页内推入动画） */}
      <AnimatePresence>
        {dishPage && dishPage.catIdx >= 0 && shop.sections[dishPage.catIdx] && (
          <motion.div
            key={`dish-${dishPage.catIdx}-${dishPage.dish?.id ?? 'new'}`}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0 z-[60] bg-white"
          >
            <DishEditPage
              catName={shop.sections[dishPage.catIdx].cat}
              initial={dishPage.dish}
              onBack={() => setDishPage(null)}
              onSave={(d) => saveDish(dishPage.catIdx, d)}
              onDelete={(d) => deleteDish(dishPage.catIdx, d)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 删除店铺二次确认 */}
      <AnimatePresence>
        {confirmDel && (
          <motion.div key="mt-shop-del-confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[65]">
            <button type="button" aria-label="取消删除" className="absolute inset-0 bg-black/50" onClick={() => setConfirmDel(false)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white px-6 pb-9 pt-6"
              data-testid="mt-shop-del-sheet"
            >
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#FFF0EB]">
                <Trash2 className="h-6 w-6 text-[#FF4B33]" strokeWidth={1.9} />
              </span>
              <p className="mt-3 text-center text-[16px] font-bold text-black/85">删除店铺「{shop.name}」？</p>
              <p className="mt-2 text-center text-[12px] leading-relaxed text-black/40">
                删除后首页不再展示、无法再进店下单；
                <br />
                历史订单记录保留。该操作不可恢复。
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDel(false)}
                  className="h-11 flex-1 rounded-full bg-[#F4F5F7] text-[14px] font-medium text-black/70 active:bg-black/[0.06]"
                >
                  再想想
                </button>
                <button
                  type="button"
                  data-testid="mt-shop-del-confirm-btn"
                  onClick={removeShop}
                  className="h-11 flex-1 rounded-full bg-[#FF4B33] text-[14px] font-semibold text-white active:opacity-85"
                >
                  确认删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
