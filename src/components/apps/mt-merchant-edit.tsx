'use client';

/**
 * 商家入驻 / 编辑店铺（美团「我的-入驻美团」）：
 * - 店铺信息：店名、店铺背景图（上传压缩 dataURL）、分类多选、公告、地址、起送价、配送费；
 * - 菜单管理：分区（可增删）+ 菜品列表（点「加菜」或菜品 → 独立全屏菜品编辑页）；
 * - 店铺优惠券：满 X 减 Y 自建（保存后详情页可领，自动派生首页满减角标）；
 * - 保存 → mtSaveShops（按账号隔离）+ mtRegisterAiMerchant（详情页/搜索/AI 代点即时生效）。
 *   图标全部使用 Lucide 线条图标（无 emoji），无图菜品用渐变 + 线条图标占位。
 */
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ImagePlus,
  Pencil,
  Plus,
  Store,
  Ticket,
  Trash2,
} from 'lucide-react';
import {
  mtAutoEmoji,
  mtRegisterAiMerchant,
  type MtDish,
  type MtMerchant,
  type MtShopCouponDef,
} from '@/lib/ios/meituan-data';
import {
  mtCurAddrId,
  mtLoadAddresses,
  mtLoadShops,
  mtSaveShops,
  mtUidOf,
  type MtSession,
} from '@/lib/ios/meituan-store';
import { readImageFile } from './wechat';
import DishEditPage from './mt-dish-edit';
import { DishImg } from './mt-merchant-ui';

const MT_YELLOW = '#FFD100';
const MT_PRICE = '#FF4B33';

/** 入驻可选分类（首页分类宫格映射的商家筛选 id 子集） */
const JOIN_CATS: { id: string; name: string }[] = [
  { id: 'waimai', name: '外卖' },
  { id: 'meishi', name: '美食' },
  { id: 'yinyin', name: '甜点饮品' },
  { id: 'hamburg', name: '汉堡披萨' },
  { id: 'mala', name: '麻辣烫' },
  { id: 'zaocan', name: '早餐' },
  { id: 'chaoshi', name: '超市便利' },
  { id: 'shuiguo', name: '水果' },
];

const num = (s: string): number => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
};
const money = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const inputCls =
  'h-10 w-full rounded-xl bg-[#F4F5F7] px-3 text-[14px] text-black/85 outline-none placeholder:text-black/25 focus:bg-white focus:ring-1 focus:ring-[#FFD100]';

// ================================ 入驻 / 编辑主页 ================================

export default function MerchantEditPage({
  session,
  editId,
  onBack,
  onSaved,
  onToast,
}: {
  session: MtSession;
  /** 有值 = 编辑已有店铺；空 = 新入驻 */
  editId: string | null;
  onBack: () => void;
  /** 保存成功（id） */
  onSaved: (id: string) => void;
  onToast: (m: string) => void;
}) {
  const uidKey = mtUidOf(session);
  const editing = editId ? mtLoadShops(uidKey).find((s) => s.id === editId) : undefined;
  const defAddr = (() => {
    try {
      const addrs = mtLoadAddresses(uidKey);
      return addrs.find((a) => a.id === mtCurAddrId(uidKey))?.text ?? addrs[0]?.text ?? '';
    } catch {
      return '';
    }
  })();

  const [name, setName] = useState(editing?.name ?? '');
  const [cover, setCover] = useState<string | undefined>(editing?.cover);
  const [cats, setCats] = useState<string[]>(editing?.cats?.filter((c) => JOIN_CATS.some((j) => j.id === c)) ?? []);
  const [notice, setNotice] = useState(editing?.notice ?? '');
  const [addr, setAddr] = useState(editing?.addr ?? defAddr);
  const [minOrder, setMinOrder] = useState(editing ? money(editing.minOrder) : '0');
  const [deliveryFee, setDeliveryFee] = useState(editing ? money(editing.deliveryFee) : '2');
  const [sections, setSections] = useState<{ cat: string; dishes: MtDish[] }[]>(
    editing?.sections ?? [
      { cat: '招牌推荐', dishes: [] },
      { cat: '热销爆款', dishes: [] },
    ]
  );
  const [coupons, setCoupons] = useState<MtShopCouponDef[]>(editing?.coupons ?? []);
  const [cName, setCName] = useState('店铺满减券');
  const [cMin, setCMin] = useState('');
  const [cAmount, setCAmount] = useState('');
  const [newCat, setNewCat] = useState('');
  const [dishSheet, setDishSheet] = useState<{ catIdx: number; dish: MtDish | null } | null>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const [bgBusy, setBgBusy] = useState(false);

  const pickBg = async (f: File | null | undefined) => {
    if (!f) return;
    setBgBusy(true);
    try {
      setCover(await readImageFile(f, 1280));
    } catch {
      onToast('图片读取失败，换一张试试');
    }
    setBgBusy(false);
  };

  const save = () => {
    const n = name.trim();
    if (!n) {
      onToast('先给店铺起个名字吧');
      return;
    }
    if (cats.length === 0) {
      onToast('至少选择一个店铺分类');
      return;
    }
    const dishCount = sections.reduce((acc, s) => acc + s.dishes.length, 0);
    if (dishCount === 0) {
      onToast('至少添加一道菜品');
      return;
    }
    const cleanSections = sections
      .map((s) => ({ cat: s.cat.trim(), dishes: s.dishes }))
      .filter((s) => s.cat && s.dishes.length > 0);
    if (cleanSections.length === 0) {
      onToast('菜品分区不能为空');
      return;
    }
    const minO = num(minOrder);
    const fee = num(deliveryFee);
    const shop: MtMerchant = {
      id: editing?.id ?? `my-shop-${Date.now().toString(36)}`,
      name: n,
      emoji: editing?.emoji ?? mtAutoEmoji(n),
      cover,
      cats,
      rating: editing?.rating ?? 4.8,
      monthSale: editing?.monthSale ?? 88,
      minOrder: Number.isFinite(minO) && minO >= 0 ? minO : 0,
      deliveryFee: Number.isFinite(fee) && fee >= 0 ? fee : 2,
      distanceKm: editing?.distanceKm ?? 0.6,
      deliveryMin: editing?.deliveryMin ?? 28,
      notice: notice.trim() || undefined,
      deals: coupons.map((c) => `满${money(c.min)}减${money(c.amount)}`),
      hours: '10:00 - 22:00',
      addr: addr.trim() || '附近',
      sections: cleanSections,
      reviews: editing?.reviews ?? [],
      mine: true,
      coupons,
      mtStatus: editing?.mtStatus ?? 'open',
    };
    const list = mtLoadShops(uidKey);
    mtSaveShops(uidKey, editing ? list.map((s) => (s.id === editing.id ? shop : s)) : [shop, ...list]);
    // 即时注册进运行时注册表：详情页/搜索/AI 代点不需要重启就生效（同 id 覆盖）
    mtRegisterAiMerchant(shop);
    onToast(editing ? '店铺已保存' : '入驻成功，店铺已上架到首页');
    onSaved(shop.id);
  };

  const addCoupon = () => {
    const mn = num(cMin);
    const am = num(cAmount);
    if (!Number.isFinite(mn) || mn <= 0 || !Number.isFinite(am) || am <= 0) {
      onToast('先填好「满」和「减」金额');
      return;
    }
    if (am > mn) {
      onToast('减免金额不能超过使用门槛');
      return;
    }
    setCoupons((p) => [...p, { id: `sc${Date.now().toString(36)}${p.length}`, name: cName.trim() || '店铺满减券', amount: am, min: mn }]);
    setCMin('');
    setCAmount('');
    setCName('店铺满减券');
  };

  const dishTotal = sections.reduce((acc, s) => acc + s.dishes.length, 0);

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-black/5 bg-white px-3 pb-3 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-5 w-5 text-black/70" />
        </button>
        <p className="text-[16px] font-bold text-black/85">{editing ? '编辑店铺' : '入驻美团'}</p>
        <span className="ml-auto rounded-full bg-[#FFF3C4] px-2 py-0.5 text-[10px] text-black/55">开店后店铺会出现在首页</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {/* 店铺信息 */}
        <div className="px-4 pt-4">
          <p className="flex items-center gap-1.5 text-[15px] font-bold text-black/85">
            <Store className="h-4 w-4 text-black/60" strokeWidth={1.9} />
            店铺信息
          </p>
          {/* 背景图 */}
          <button
            type="button"
            data-testid="mt-shop-bg"
            onClick={() => bgRef.current?.click()}
            className="relative mt-3 block h-28 w-full overflow-hidden rounded-2xl bg-[#F4F5F7] ring-1 ring-black/[0.04] active:opacity-90"
            aria-label="上传店铺背景图"
          >
            {cover ? (
              <>
                <img src={cover} alt="店铺背景" className="h-full w-full object-cover" />
                <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white">更换背景图</span>
              </>
            ) : (
              <span className="flex h-full flex-col items-center justify-center gap-1.5 border border-dashed border-black/15 text-black/35">
                {bgBusy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/15 border-t-black/45" /> : <ImagePlus className="h-6 w-6" strokeWidth={1.6} />}
                <span className="text-[12px]">上传店铺背景图</span>
              </span>
            )}
          </button>
          <input ref={bgRef} type="file" accept="image/*" hidden onChange={(e) => { void pickBg(e.target.files?.[0]); e.target.value = ''; }} />

          <div className="mt-3">
            <p className="mb-1.5 text-[12px] text-black/45">店铺名称</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：琳琳的奶茶铺" data-testid="mt-shop-name" className={inputCls} maxLength={16} />
          </div>

          <p className="mb-1.5 mt-3 text-[12px] text-black/45">店铺分类（可多选）</p>
          <div className="flex flex-wrap gap-2">
            {JOIN_CATS.map((c) => {
              const on = cats.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`mt-cat-${c.id}`}
                  onClick={() => setCats((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                  className={`h-8 rounded-full px-3.5 text-[13px] transition-colors ${on ? 'bg-[#FFF3C4] font-semibold text-black/85 ring-1 ring-[#FFD100]' : 'bg-[#F4F5F7] text-black/50'}`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>

          <div className="mt-3">
            <p className="mb-1.5 text-[12px] text-black/45">店铺公告（可选）</p>
            <input value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="例：新店开业，全场上新价" className={inputCls} maxLength={24} />
          </div>
          <div className="mt-3">
            <p className="mb-1.5 text-[12px] text-black/45">店铺地址</p>
            <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="例：望京街道方恒国际中心B座" className={inputCls} maxLength={30} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1.5 text-[12px] text-black/45">起送价（¥）</p>
              <input value={minOrder} onChange={(e) => setMinOrder(e.target.value.replace(/[^\d.]/g, ''))} className={`${inputCls} text-center`} inputMode="decimal" placeholder="0" />
            </div>
            <div>
              <p className="mb-1.5 text-[12px] text-black/45">配送费（¥）</p>
              <input value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value.replace(/[^\d.]/g, ''))} className={`${inputCls} text-center`} inputMode="decimal" placeholder="2" />
            </div>
          </div>
        </div>

        {/* 菜单管理 */}
        <div className="mt-6 px-4">
          <div className="flex items-center">
            <p className="text-[15px] font-bold text-black/85">菜单管理</p>
            <span className="ml-2 text-[12px] text-black/35">共 {dishTotal} 道菜</span>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {sections.map((sec, si) => (
              <div key={si} className="rounded-2xl bg-[#FAFAFB] ring-1 ring-black/[0.04]">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: MT_YELLOW }} />
                  <input
                    value={sec.cat}
                    onChange={(e) => setSections((p) => p.map((s, k) => (k === si ? { ...s, cat: e.target.value } : s)))}
                    className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-black/85 outline-none"
                    maxLength={8}
                  />
                  <span className="text-[11px] text-black/35">{sec.dishes.length}道</span>
                  <button
                    type="button"
                    data-testid={`mt-sec-add-dish-${si}`}
                    onClick={() => setDishSheet({ catIdx: si, dish: null })}
                    className="flex h-7 items-center gap-0.5 rounded-full px-2.5 text-[12px] font-medium text-black/70 active:bg-black/5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    加菜
                  </button>
                  <button
                    type="button"
                    aria-label={`删除分区${sec.cat}`}
                    onClick={() => {
                      setSections((p) => p.filter((_, k) => k !== si));
                      if (sec.dishes.length > 0) onToast(`已删除分区「${sec.cat}」及 ${sec.dishes.length} 道菜`);
                    }}
                    className="grid h-7 w-7 place-items-center rounded-full text-black/30 active:bg-black/5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {sec.dishes.length > 0 && (
                  <div className="flex flex-col gap-1 px-3 pb-2.5">
                    {sec.dishes.map((d) => (
                      <div key={d.id} className="flex items-center gap-2.5 rounded-xl bg-white px-2.5 py-2 ring-1 ring-black/[0.04]">
                        <DishImg name={d.name} img={d.img} className="h-9 w-9 rounded-lg" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-black/85">
                            {d.name}
                            {d.specs && d.specs.length > 0 && <span className="ml-1.5 rounded bg-[#FFF3C4] px-1 py-px text-[9px] text-black/55">{d.specs.length}组规格</span>}
                          </p>
                          <p className="text-[11px] text-black/40">
                            ¥{money(d.price)}
                            {d.specs && d.specs.length > 0 && ` · ${d.specs.map((s) => s.name).join('/')}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`编辑菜品${d.name}`}
                          onClick={() => setDishSheet({ catIdx: si, dish: d })}
                          className="grid h-7 w-7 place-items-center rounded-full text-black/40 active:bg-black/5"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除菜品${d.name}`}
                          onClick={() => setSections((p) => p.map((s, k) => (k === si ? { ...s, dishes: s.dishes.filter((x) => x.id !== d.id) } : s)))}
                          className="grid h-7 w-7 place-items-center rounded-full text-black/30 active:bg-black/5"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* 加分区 */}
          <div className="mt-3 flex items-center gap-2">
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newCat.trim()) {
                  setSections((p) => [...p, { cat: newCat.trim(), dishes: [] }]);
                  setNewCat('');
                }
              }}
              placeholder="新分区名（如 主食 / 小吃 / 饮品）"
              className={inputCls}
              maxLength={8}
            />
            <button
              type="button"
              data-testid="mt-add-section"
              onClick={() => {
                if (!newCat.trim()) {
                  onToast('先填分区名');
                  return;
                }
                setSections((p) => [...p, { cat: newCat.trim(), dishes: [] }]);
                setNewCat('');
              }}
              className="flex h-10 shrink-0 items-center gap-1 rounded-xl bg-[#F4F5F7] px-4 text-[13px] font-medium text-black/70 active:bg-black/[0.06]"
            >
              <Plus className="h-4 w-4" />
              加分区
            </button>
          </div>
        </div>

        {/* 店铺优惠券 */}
        <div className="mt-6 px-4">
          <p className="flex items-center gap-1.5 text-[15px] font-bold text-black/85">
            <Ticket className="h-4 w-4 text-black/60" strokeWidth={1.9} />
            店铺优惠券
            <span className="ml-1 text-[11px] font-normal text-black/35">买家在店铺里领取，下单自动抵扣</span>
          </p>
          {coupons.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {coupons.map((c) => (
                <div key={c.id} className="flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[#FFF3C4] to-[#FFEDAD] px-3 py-2.5 ring-1 ring-[#FFD100]/50">
                  <span className="text-[18px] font-bold text-[#8A4B00]">¥{money(c.amount)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-[#5A4200]">{c.name}</p>
                    <p className="text-[10px] text-[#5A4200]/65">满 ¥{money(c.min)} 可用 · 领取后 7 天有效</p>
                  </div>
                  <button type="button" aria-label={`删除优惠券${c.name}`} onClick={() => setCoupons((p) => p.filter((x) => x.id !== c.id))} className="grid h-7 w-7 place-items-center rounded-full text-[#5A4200]/50 active:bg-black/5">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <input value={cName} onChange={(e) => setCName(e.target.value)} className={`${inputCls} !h-9 w-[104px] shrink-0 !px-2.5 !text-[12px]`} maxLength={8} />
            <span className="shrink-0 text-[12px] text-black/45">满</span>
            <input value={cMin} onChange={(e) => setCMin(e.target.value.replace(/[^\d.]/g, ''))} placeholder="20" className={`${inputCls} !h-9 !w-[58px] shrink-0 !px-2 text-center !text-[13px]`} inputMode="decimal" data-testid="mt-coupon-min" />
            <span className="shrink-0 text-[12px] text-black/45">减</span>
            <input value={cAmount} onChange={(e) => setCAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="5" className={`${inputCls} !h-9 !w-[58px] shrink-0 !px-2 text-center !text-[13px]`} inputMode="decimal" data-testid="mt-coupon-amount" />
            <button
              type="button"
              data-testid="mt-coupon-add"
              onClick={addCoupon}
              className="flex h-9 shrink-0 items-center gap-0.5 rounded-xl bg-[#F4F5F7] px-3 text-[13px] font-medium text-black/70 active:bg-black/[0.06]"
            >
              <Plus className="h-4 w-4" />
              添加
            </button>
          </div>
        </div>

        <p className="px-6 pb-2 pt-5 text-center text-[11px] leading-relaxed text-black/25">
          提交后店铺立即上架到首页瀑布流顶部，买家可以点进店铺下单；
          <br />
          店铺、菜单、券都保存在本机，按账号隔离。
        </p>
      </div>

      {/* 底部提交 */}
      <div className="shrink-0 border-t border-black/5 bg-white px-4 pb-7 pt-3">
        <button
          type="button"
          data-testid="mt-shop-submit"
          onClick={save}
          className="h-12 w-full rounded-full text-[15px] font-bold text-black/85 active:opacity-85"
          style={{ background: MT_YELLOW }}
        >
          {editing ? '保存修改' : '提交入驻'}
        </button>
      </div>

      {/* 菜品编辑（独立全屏页，页内推入动画） */}
      <AnimatePresence>
        {dishSheet && sections[dishSheet.catIdx] && (
          <motion.div
            key={`dish-${dishSheet.catIdx}-${dishSheet.dish?.id ?? 'new'}`}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0 z-[60] bg-white"
          >
            <DishEditPage
              catName={sections[dishSheet.catIdx].cat}
              initial={dishSheet.dish}
              onBack={() => setDishSheet(null)}
              onSave={(d) => {
                setSections((p) =>
                  p.map((s, k) => {
                    if (k !== dishSheet.catIdx) return s;
                    const exists = s.dishes.some((x) => x.id === d.id);
                    return { ...s, dishes: exists ? s.dishes.map((x) => (x.id === d.id ? d : x)) : [...s.dishes, d] };
                  })
                );
                setDishSheet(null);
                onToast('菜品已保存');
              }}
              onDelete={(d) => {
                setSections((p) => p.map((s, k) => (k === dishSheet.catIdx ? { ...s, dishes: s.dishes.filter((x) => x.id !== d.id) } : s)));
                setDishSheet(null);
                onToast(`「${d.name}」已删除`);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
