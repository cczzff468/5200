'use client';

/**
 * 美团「订单分享」动态卡片（微信/QQ 聊天端共用）：
 * - 我把美团订单分享给好友的卡片：美团 logo + 订单动态 + 商家/金额 + 买的什么（商品行）+
 *   五段状态时间线（提交订单→待商家接单→商家已接单→骑手已接单·骑手名→已送达）；
 * - 状态不落快照：每次渲染按 uid+orderId 实时读订单 statusLog 推导，监听 mt-orders-changed
 *   与逐秒 tick——订单推进时聊天里的卡片自动跟随（真·动态卡片）。
 */
import { useEffect, useState } from 'react';
import { Bike, Check, CircleCheck, Clock as ClockIcon, ShieldCheck, Store } from 'lucide-react';
import { FoodImg } from './mt-food-img';
import { mtGetShare, mtShareOrderOf, mtShareStagesOf } from '@/lib/ios/mt-order-share';

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

const fmtHm = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 商品名剥「N杯」数量尾缀（商品行已有 ×N 数量列） */
const stripDealQty = (s: string): string =>
  s
    .replace(/\s*\d+杯/g, '')
    .replace(/（\s*）/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[·、]\s*$/u, '')
    .trim();

export function MtShareBubble({ sid }: { sid: string }) {
  const share = mtGetShare(sid);
  // 动态刷新：逐秒 tick + 订单状态变化事件 → 重读订单推导时间线
  const [, setVer] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => setVer((v) => v + 1), 1000);
    const onChanged = () => setVer((v) => v + 1);
    window.addEventListener('mt-orders-changed', onChanged);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener('mt-orders-changed', onChanged);
    };
  }, []);

  if (!share) {
    return (
      <div className="relative w-[252px] rounded-[14px] bg-white p-3 shadow-[0_5px_16px_rgba(0,0,0,0.10)]">
        <span aria-hidden="true" className="absolute top-[13px] -right-[4px] h-[11px] w-[11px] rotate-45 rounded-[2px] bg-white" />
        <p className="text-[12px] text-black/35">订单分享已失效</p>
      </div>
    );
  }

  const order = mtShareOrderOf(share);
  const stages = mtShareStagesOf(order);
  const reachedCnt = stages.filter((s) => s.at).length;
  const canceled = order?.status === 'canceled';

  return (
    <div
      data-testid="mt-share-bubble"
      className="relative block w-[252px] rounded-[14px] bg-white p-2.5 text-left shadow-[0_5px_16px_rgba(0,0,0,0.10)]"
      aria-label={`美团订单分享 ¥${fmt2(share.amount)}（${stages[reachedCnt - 1]?.label ?? '提交订单'}）`}
    >
      {/* 箭头指向头像侧（我发出 → 右） */}
      <span aria-hidden="true" className="absolute top-[13px] -right-[4px] h-[11px] w-[11px] rotate-45 rounded-[2px] bg-white" />

      {/* 头部：美团 logo + 订单动态 */}
      <span className="relative flex items-center gap-1.5">
        <img src="/icons/meituan.png" alt="" className="h-[22px] w-[22px] rounded-full object-cover" />
        <span className="text-[13px] font-semibold text-black/85">美团</span>
        <span className="rounded-full bg-[#FFF3D1] px-1.5 py-[2px] text-[10px] font-medium leading-none text-[#B77900]">订单动态</span>
        <span className="ml-auto flex items-center gap-[3px] text-[11px] font-medium text-[#00B862]">
          <ShieldCheck className="h-[13px] w-[13px]" strokeWidth={2.2} />
          官方同步
        </span>
      </span>

      {/* 商家 + 金额 */}
      <span className="relative mt-1.5 flex items-baseline gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug text-black/90">{share.merchantName}</span>
        <span className="shrink-0 text-[16px] font-bold text-black/90">
          <span className="text-[11px]">¥</span>
          {fmt2(share.amount)}
        </span>
      </span>

      {/* 买的什么（商品行，最多 2 行 + 汇总） */}
      <span className="relative mt-1.5 flex items-center gap-2 rounded-[10px] bg-[#F8F8F8] px-2 py-2">
        <FoodImg src={share.items[0]?.img ?? share.merchantImg} emoji={share.items[0]?.emoji ?? share.merchantEmoji} className="h-9 w-9 shrink-0 rounded-md" />
        <span className="min-w-0 flex-1">
          {share.items.slice(0, 2).map((it, i) => (
            <span key={i} className="block truncate text-[12px] leading-[1.5] text-black/75">
              {stripDealQty(it.name)}
              <span className="text-black/35"> ×{it.qty}</span>
            </span>
          ))}
          {share.items.length > 2 && <span className="block text-[10.5px] text-black/35">等 {share.itemCount} 件商品</span>}
        </span>
      </span>

      {/* 动态时间线（提交订单→待商家接单→商家已接单→骑手已接单→已送达） */}
      <span className="relative mt-2.5 block">
        {stages.map((st, i) => {
          const done = !!st.at;
          const current = done && i === reachedCnt - 1 && !canceled;
          const last = i === stages.length - 1;
          return (
            <span key={st.key} className="relative flex gap-2" data-testid={`mt-share-stage-${st.key}`}>
              {/* 节点列 */}
              <span className="flex w-4 shrink-0 flex-col items-center">
                {current ? (
                  <span className="mt-[3px] grid h-[13px] w-[13px] shrink-0 place-items-center rounded-full bg-[#FFD100]">
                    {st.key === 'completed' ? (
                      <Check className="h-[9px] w-[9px] text-black/80" strokeWidth={3.4} />
                    ) : st.key === 'delivering' ? (
                      <Bike className="h-[9px] w-[9px] text-black/80" strokeWidth={2.8} />
                    ) : st.key === 'accepted' ? (
                      <Store className="h-[9px] w-[9px] text-black/80" strokeWidth={2.8} />
                    ) : (
                      <ClockIcon className="h-[9px] w-[9px] text-black/80" strokeWidth={2.8} />
                    )}
                  </span>
                ) : (
                  <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${done ? 'bg-[#FFD100]' : 'bg-black/12'}`} />
                )}
                {!last && <span className={`w-px flex-1 ${done ? 'bg-[#FFD100]/70' : 'bg-black/[0.08]'}`} />}
              </span>
              {/* 文案列 */}
              <span className={`min-w-0 flex-1 ${last ? '' : 'pb-2'}`}>
                <span className="flex items-baseline gap-1.5">
                  <span className={`text-[12px] leading-[1.45] ${current ? 'font-semibold text-black/85' : done ? 'text-black/60' : 'text-black/30'}`}>{st.label}</span>
                  {done && st.at && <span className="shrink-0 text-[10px] leading-[1.45] text-black/30">{fmtHm(st.at)}</span>}
                  {current && <span className="shrink-0 rounded-full bg-[#FFF3D1] px-1.5 text-[9.5px] font-medium leading-[1.7] text-[#B77900]">进行中</span>}
                </span>
                {st.key === 'delivering' && st.riderName && (done || current) && (
                  <span className="mt-0.5 block text-[10.5px] leading-[1.4] text-black/45">骑手 {st.riderName} 正在为您配送</span>
                )}
              </span>
            </span>
          );
        })}
        {canceled && (
          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-black/40">
            <CircleCheck className="h-3.5 w-3.5 text-black/25" strokeWidth={2} />
            该订单已取消
          </span>
        )}
      </span>

      {/* 底注 */}
      <span className="relative mt-2 block border-t border-black/[0.05] pt-1.5 text-[10px] text-black/30">
        {share.fromName} 的美团订单 · 状态实时同步
      </span>
    </div>
  );
}
