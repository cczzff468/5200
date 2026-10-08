'use client';

/**
 * 商家中心（美团「我的-入驻美团」管理页）：
 * - 当前账号自有店铺列表：封面、分类、菜品数、营业中/已打烊开关；
 * - 操作：编辑（进入驻表单回填）/ 进店看看（详情页）/ 删除（二次确认；同步清掉归属购物车行）；
 * - 无店空状态：入驻引导 + 「立即入驻」大按钮；
 * - 任何改动后回调 onChanged（父组件把首页信息流缓存置为失效，新店/改动即时露出）。
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, Pencil, Plus, Store, Trash2 } from 'lucide-react';
import { mtRegisterMyMerchants, mtUnregisterMerchant, mtUnregisterMyMerchants, type MtMerchant } from '@/lib/ios/meituan-data';
import { mtLoadCart, mtLoadShops, mtSaveCart, mtSaveShops, mtUidOf, type MtSession } from '@/lib/ios/meituan-store';

const MT_YELLOW = '#FFD100';
const money = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function MerchantCenterPage({
  session,
  onBack,
  onCreate,
  onEdit,
  onOpenMerchant,
  onChanged,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  /** 新建店铺 → 入驻表单 */
  onCreate: () => void;
  /** 编辑店铺 → 入驻表单（回填） */
  onEdit: (id: string) => void;
  onOpenMerchant: (id: string) => void;
  /** 店铺数据有变（增/删/上下架）→ 首页信息流失效 */
  onChanged: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const [shops, setShops] = useState<MtMerchant[]>(() => mtLoadShops(uid));
  const [confirmDel, setConfirmDel] = useState<MtMerchant | null>(null);

  const reload = () => setShops(mtLoadShops(uid));

  const toggleStatus = (s: MtMerchant) => {
    const nextStatus: 'open' | 'closed' = s.mtStatus === 'closed' ? 'open' : 'closed';
    const list = mtLoadShops(uid).map((x) => (x.id === s.id ? { ...x, mtStatus: nextStatus } : x));
    mtSaveShops(uid, list);
    // 注册表重建：先清全部 my-shop-* 再挂回现存列表（详情页/搜索池即时同步）
    mtUnregisterMyMerchants();
    mtRegisterMyMerchants(list);
    onChanged();
    reload();
    onToast(nextStatus === 'closed' ? `「${s.name}」已打烊，首页不再展示` : `「${s.name}」恢复营业`);
  };

  const removeShop = (s: MtMerchant) => {
    const list = mtLoadShops(uid).filter((x) => x.id !== s.id);
    mtSaveShops(uid, list);
    mtUnregisterMerchant(s.id);
    // 该店若正挂在购物车里 → 清空购物车行（订单历史快照不受影响）
    const cart = mtLoadCart(uid);
    if (cart.merchantId === s.id) {
      mtSaveCart(uid, { merchantId: null, items: [] });
    }
    setConfirmDel(null);
    onChanged();
    reload();
    onToast(`「${s.name}」已删除`);
  };

  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-black/5 bg-white px-3 pb-3 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-5 w-5 text-black/70" />
        </button>
        <p className="text-[16px] font-bold text-black/85">商家中心</p>
        <span className="ml-auto text-[11px] text-black/35">已入驻 {shops.length} 家</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {shops.length === 0 ? (
          /* 空状态引导 */
          <div className="mt-14 flex flex-col items-center" data-testid="mt-center-empty">
            <span className="grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-[#FFF3C4] to-[#FFD100]/60 shadow-[0_10px_30px_rgba(255,190,0,0.25)]">
              <Store className="h-10 w-10 text-[#8A4B00]" strokeWidth={1.6} />
            </span>
            <p className="mt-4 text-[17px] font-bold text-black/85">入驻美团，开一家自己的小店</p>
            <p className="mt-1.5 text-center text-[12px] leading-relaxed text-black/40">
              自定义店名与背景、上传菜品与小菜、
              <br />
              给奶茶配小料和大小杯定价、发店铺优惠券
            </p>
            <button
              type="button"
              data-testid="mt-center-create"
              onClick={onCreate}
              className="mt-6 h-12 rounded-full px-14 text-[15px] font-bold text-black/85 active:opacity-85"
              style={{ background: MT_YELLOW }}
            >
              立即入驻
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {shops.map((s) => {
              const closed = s.mtStatus === 'closed';
              const dishCount = s.sections.reduce((acc, x) => acc + x.dishes.length, 0);
              return (
                <div key={s.id} className={`overflow-hidden rounded-2xl bg-white ring-1 ring-black/[0.04] ${closed ? 'opacity-75' : ''}`} data-testid="mt-center-shop">
                  <div className="flex items-center gap-3 p-3">
                    <span className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[#F4F5F7]">
                      {s.cover ? (
                        <img src={s.cover} alt={s.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full w-full place-items-center bg-gradient-to-br from-[#FFE9B8] to-[#FFD100]/70 text-[26px]">{s.emoji}</span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-[15px] font-bold text-black/85">
                        {s.name}
                        {closed && <span className="rounded bg-black/[0.06] px-1 py-px text-[9px] font-normal text-black/45">已打烊</span>}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-black/40">
                        {s.cats.length}个分类 · {dishCount}道菜 · 起送¥{money(s.minOrder)} · 配送¥{money(s.deliveryFee)}
                      </p>
                      {s.coupons && s.coupons.length > 0 && (
                        <p className="mt-0.5 truncate text-[11px] text-[#FF4B33]">
                          {s.coupons.map((c) => `满${money(c.min)}减${money(c.amount)}`).join(' · ')}
                        </p>
                      )}
                    </div>
                    {/* 营业开关 */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!closed}
                      aria-label={`营业状态：${s.name}`}
                      data-testid={`mt-shop-toggle-${s.id}`}
                      onClick={() => toggleStatus(s)}
                      className="relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors"
                      style={{ background: closed ? '#D8D8D8' : MT_YELLOW }}
                    >
                      <span
                        className="absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all"
                        style={{ left: closed ? 2 : 22 }}
                      />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 border-t border-black/[0.04] px-3 py-2">
                    <button
                      type="button"
                      data-testid={`mt-shop-edit-${s.id}`}
                      onClick={() => onEdit(s.id)}
                      className="flex h-8 flex-1 items-center justify-center gap-1 rounded-full bg-[#F4F5F7] text-[13px] font-medium text-black/70 active:bg-black/[0.06]"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </button>
                    <button
                      type="button"
                      data-testid={`mt-shop-open-${s.id}`}
                      onClick={() => onOpenMerchant(s.id)}
                      className="flex h-8 flex-1 items-center justify-center gap-1 rounded-full bg-[#FFF3C4] text-[13px] font-medium text-black/80 active:opacity-80"
                    >
                      进店看看
                    </button>
                    <button
                      type="button"
                      aria-label={`删除店铺${s.name}`}
                      data-testid={`mt-shop-del-${s.id}`}
                      onClick={() => setConfirmDel(s)}
                      className="grid h-8 w-9 place-items-center rounded-full text-black/35 active:bg-black/5"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              data-testid="mt-center-add-more"
              onClick={onCreate}
              className="flex h-12 items-center justify-center gap-1 rounded-2xl border border-dashed border-black/15 bg-white/60 text-[14px] font-medium text-black/55 active:bg-white"
            >
              <Plus className="h-4 w-4" />
              再开一家店
            </button>
          </div>
        )}
      </div>

      {/* 删除确认 */}
      <AnimatePresence>
        {confirmDel && (
          <motion.div key="mt-del-confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50">
            <button type="button" aria-label="取消删除" className="absolute inset-0 bg-black/45" onClick={() => setConfirmDel(null)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white px-6 pb-9 pt-6"
              data-testid="mt-del-sheet"
            >
              <p className="text-center text-[16px] font-bold text-black/85">删除店铺「{confirmDel.name}」？</p>
              <p className="mt-2 text-center text-[12px] leading-relaxed text-black/40">
                删除后首页不再展示、无法再进店下单；
                <br />
                历史订单记录保留。该操作不可恢复。
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDel(null)}
                  className="h-11 flex-1 rounded-full bg-[#F4F5F7] text-[14px] font-medium text-black/70 active:bg-black/[0.06]"
                >
                  再想想
                </button>
                <button
                  type="button"
                  data-testid="mt-del-confirm-btn"
                  onClick={() => removeShop(confirmDel)}
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
