'use client';

/**
 * 微信礼物（第二十轮反馈）：加号面板「礼物」全链路——
 * - GiftBoxIcon：加号面板礼物入口图标（礼盒+蝴蝶结线性 SVG，lucide 旧版无 Gifts 用自绘）
 * - GIFT_CATALOG：内置礼物目录（AI 生成的真实感商品图存 public/gifts/，含截图同款
 *   「好运降临！幸运四叶草小狗钥匙扣」）
 * - WxGiftPicker：礼物选择页（加号面板「礼物」入口，2 列商品卡 + 「送这份」）
 * - WxGiftCard：聊天里的**深蓝星空礼物卡**（1:1 复刻真机微信礼物卡，用户参考截图测量）：
 *   ① 卡片 238×101px（真机 658×279/1080 → ×0.361 换算 390px 屏）② 底色 #164281 深海军蓝
 *   （真机取色 rgb(22,66,129)）③ 左侧金蝴蝶结（双环+垂带）+ 纵向丝带渐变线（底部淡出）
 *   ④ 金字「送你一份心意」（#EDD3A4 17px）⑤ 左下白字「礼物」12px ⑥ 满卡星点+✦ 星芒
 *   （确定性伪随机坐标，防 hydration 抖动）⑦ 尾巴：右侧细长三角（12×6px）顶点在卡片
 *   高度 19% 处（真机测得 111/279），指向头像侧；对方侧镜像
 * - WxGiftDetailPage：点卡片进礼物详情页（真机同款暖奶油底 + 白卡两段：
 *   商品信息卡 / 「礼物待收下 · 24 小时内未收下将自动退款」卡 + 底部「大家都在送的礼物」）
 */

import { ArrowLeft, ChevronRight, Info } from 'lucide-react';

/* ───────── 礼物目录 ───────── */

export interface GiftItem {
  id: string;
  name: string;
  price: number;
  img: string;
  /** 详情页数量行文案（如「四叶草小狗1个」，与真机一致） */
  unit: string;
}

export const GIFT_CATALOG: GiftItem[] = [
  { id: 'clover-puppy', name: '好运降临！幸运四叶草小狗钥匙扣', price: 39.9, img: '/gifts/clover-puppy.jpg', unit: '四叶草小狗1个' },
  { id: 'rose-bear', name: '永生花小熊礼盒 · 一生所爱', price: 129, img: '/gifts/rose-bear.jpg', unit: '永生花小熊1个' },
  { id: 'bunny-plush', name: '奶fufu垂耳兔玩偶 · 超软抱抱款', price: 59, img: '/gifts/bunny-plush.jpg', unit: '垂耳兔玩偶1只' },
  { id: 'star-bracelet', name: '星愿琉璃手链 · 摘颗星星给你', price: 89, img: '/gifts/star-bracelet.jpg', unit: '星愿手链1条' },
  { id: 'candle-box', name: '甜梦奶油香薰蜡烛礼盒', price: 49, img: '/gifts/candle-box.jpg', unit: '香薰蜡烛1盒' },
  { id: 'star-lamp', name: '星空投影小夜灯 · 把银河搬回家', price: 99, img: '/gifts/star-lamp.jpg', unit: '星空投影灯1台' },
];

export function giftById(id: string): GiftItem | undefined {
  return GIFT_CATALOG.find((g) => g.id === id);
}

/** 加号面板「礼物」入口图标（礼盒+蝴蝶结，26×26 线性风格与 lucide 一致） */
export function GiftBoxIcon({ className = 'h-[25px] w-[25px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* 蝴蝶结 */}
      <path d="M12 6.5c-1.2-2.4-4.6-2.6-5.2-.7-.5 1.6 1.8 2.4 5.2.7Z" />
      <path d="M12 6.5c1.2-2.4 4.6-2.6 5.2-.7.5 1.6-1.8 2.4-5.2.7Z" />
      {/* 盒盖 */}
      <rect x="3.5" y="8.5" width="17" height="4" rx="1" />
      {/* 盒身 */}
      <path d="M5 12.5v6a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-6" />
      {/* 竖丝带 */}
      <path d="M12 8.5v11.5" />
    </svg>
  );
}

/* ───────── 深蓝星空礼物卡（聊天消息） ───────── */

/** 星点坐标（确定性手铺，x/y 为卡内百分比，s=px，o=透明度）；✦ 星芒用字符渲染 */
const CARD_STARS: Array<[number, number, number, number]> = [
  [4, 12, 1.5, 0.5], [9, 46, 1, 0.35], [13, 78, 1.5, 0.6], [18, 26, 1, 0.3],
  [22, 62, 1.2, 0.45], [27, 14, 1.5, 0.7], [31, 88, 1, 0.3], [36, 38, 1.2, 0.4],
  [41, 70, 1.5, 0.55], [45, 8, 1, 0.35], [49, 52, 1.3, 0.5], [54, 24, 1, 0.3],
  [58, 84, 1.5, 0.6], [63, 44, 1.2, 0.4], [67, 10, 1, 0.45], [71, 66, 1.5, 0.55],
  [76, 30, 1.2, 0.4], [80, 90, 1, 0.35], [84, 18, 1.5, 0.7], [88, 56, 1.2, 0.45],
  [92, 36, 1, 0.4], [95, 76, 1.5, 0.6], [58, 8, 1, 0.3], [8, 92, 1.2, 0.4],
];

/** 金蝴蝶结 + 纵向丝带线（真机同款：双环外撇、垂带八字、丝带线底部渐隐） */
function GiftBowArt() {
  return (
    <>
      {/* 纵向丝带线：从卡片顶穿到 77% 高度、向下渐隐（真机测得 x≈14.4%、长 77%） */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-[33px] h-[78px] w-[3px]"
        style={{ background: 'linear-gradient(to bottom, rgba(237,211,164,0.95) 0%, rgba(237,211,164,0.85) 45%, rgba(237,211,164,0) 100%)' }}
      />
      <svg viewBox="0 0 100 88" className="pointer-events-none absolute top-[19px] left-[15px] h-[32px] w-[37px]" fill="none" aria-hidden="true">
        {/* 左环（外撇上翘） */}
        <path d="M52 47 C40 26 12 19 7 35 C2 51 32 58 52 47" stroke="#E7CDA1" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        {/* 右环 */}
        <path d="M48 47 C60 26 88 19 93 35 C98 51 68 58 48 47" stroke="#E7CDA1" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        {/* 垂带（八字撇出） */}
        <path d="M44 52 L27 76" stroke="#E7CDA1" strokeWidth={6.5} strokeLinecap="round" />
        <path d="M56 52 L73 76" stroke="#E7CDA1" strokeWidth={6.5} strokeLinecap="round" />
      </svg>
    </>
  );
}

/** 聊天深蓝星空礼物卡：238×101（真机 658×279@1080 → ×0.361），点击进礼物详情 */
export function WxGiftCard({ onClick, side = 'right' }: { onClick?: () => void; side?: 'right' | 'left' }) {
  const mine = side === 'right';
  return (
    <button
      type="button"
      data-testid="wx-gift-card"
      aria-label="礼物卡片：送你一份心意"
      onClick={onClick}
      className="relative block h-[101px] w-[238px] select-none overflow-visible rounded-[9px] bg-[#164281] text-left active:opacity-90 dark:bg-[#164281]"
    >
      {/* 尾巴：细长三角、顶点在卡高 19% 处、颜色与卡同（真机测得 32×15@279 → 12×6） */}
      <span
        aria-hidden="true"
        className={`absolute top-[13px] h-0 w-0 border-y-[6px] border-transparent ${
          mine ? '-right-[6px] border-l-[6px] border-l-[#164281]' : '-left-[6px] border-r-[6px] border-r-[#164281]'
        }`}
      />
      {/* 星空层 */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[9px]">
        {CARD_STARS.map(([x, y, s, o], i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white"
            style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, opacity: o }}
          />
        ))}
        {/* 星芒 ✦（三颗，错落） */}
        <span className="absolute left-[68%] top-[16%] text-[7px] leading-none text-white/70">✦</span>
        <span className="absolute left-[26%] top-[72%] text-[6px] leading-none text-white/55">✦</span>
        <span className="absolute left-[87%] top-[64%] text-[6.5px] leading-none text-white/65">✦</span>
      </span>
      <GiftBowArt />
      {/* 主标语（真机：金字居卡片 38% 高度、起点 28% 宽） */}
      <span className="absolute left-[67px] top-[29px] text-[17px] font-medium tracking-[0.5px] text-[#EDD3A4]">
        送你一份心意
      </span>
      {/* 左下角类型字 */}
      <span className="absolute bottom-[9px] left-[12px] text-[12px] tracking-[1px] text-white/90">礼物</span>
    </button>
  );
}

/* ───────── 礼物选择页（加号面板「礼物」入口） ───────── */

const fmtPrice = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function WxGiftPicker({
  peerName,
  onBack,
  onSend,
}: {
  peerName: string;
  onBack: () => void;
  onSend: (gift: GiftItem) => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#F4F5F9] dark:bg-[#111111]" data-testid="wx-gift-picker">
      {/* 顶栏 */}
      <div className="shrink-0 bg-[#F4F5F9] pt-[54px] dark:bg-[#111111]">
        <div className="relative grid h-[48px] place-items-center">
          <button type="button" aria-label="返回" data-testid="wx-gift-back" onClick={onBack} className="absolute left-1 grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <ArrowLeft className="h-[24px] w-[24px] text-black/85 dark:text-white/85" strokeWidth={2.2} />
          </button>
          <p className="text-[17px] font-semibold text-black/90 dark:text-white/90">礼物</p>
        </div>
        <p className="px-4 pb-2 pt-0.5 text-[12px] text-black/40 dark:text-white/40">送你一份心意 · 挑一份礼物送给 {peerName}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          {GIFT_CATALOG.map((g) => (
            <div key={g.id} className="overflow-hidden rounded-2xl bg-white dark:bg-[#1E1E1E]" data-testid={`wx-gift-item-${g.id}`}>
              <img src={g.img} alt={g.name} className="aspect-square w-full object-cover" />
              <div className="p-2.5">
                <p className="line-clamp-2 min-h-[36px] text-[12.5px] leading-[18px] text-black/85 dark:text-white/85">{g.name}</p>
                <div className="mt-1.5 flex items-end justify-between">
                  <p className="text-[15px] font-bold text-[#C89B5A] dark:text-[#D9B87E]">
                    <span className="text-[10px]">¥</span>
                    {fmtPrice(g.price)}
                  </p>
                  <button
                    type="button"
                    data-testid={`wx-gift-send-${g.id}`}
                    onClick={() => onSend(g)}
                    className="rounded-full bg-gradient-to-r from-[#D9B87E] to-[#C89B5A] px-3.5 py-1.5 text-[12px] font-semibold text-white active:opacity-85"
                  >
                    送这份
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="pt-3 text-center text-[11px] text-black/30 dark:text-white/30">礼物将由「礼物」服务寄出 · 24 小时内未收下将自动退款</p>
      </div>
    </div>
  );
}

/* ───────── 礼物详情页（点聊天卡进入，真机暖奶油底 + 白卡两段） ───────── */

export function WxGiftDetailPage({
  senderName,
  gift,
  onBack,
}: {
  /** 送礼人名字（我方送 = 机主名字；对方送 = 好友名字） */
  senderName: string;
  gift: GiftItem;
  onBack: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#F7F1E6] dark:bg-[#15130F]" data-testid="wx-gift-detail">
      {/* 顶栏（真机：仅返回 + 右上更多，无标题） */}
      <div className="shrink-0 pt-[54px]">
        <div className="relative grid h-[48px] place-items-center">
          <button type="button" aria-label="返回" data-testid="wx-gift-detail-back" onClick={onBack} className="absolute left-1 grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <ArrowLeft className="h-[24px] w-[24px] text-black/85 dark:text-white/85" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 送礼人抬头 */}
        <div className="flex items-center gap-3 px-1 py-3">
          <span className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#E8CFA4] to-[#C89B5A] text-[17px] font-semibold text-white">
            {senderName.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[16px] font-semibold text-[#8A6B3F] dark:text-[#C9A96E]">
              {senderName} 送的礼物
            </p>
            <p className="mt-0.5 text-[13.5px] text-[#B4A488] dark:text-white/45">送你一份心意</p>
          </div>
        </div>

        {/* 商品信息卡 */}
        <div className="mt-2 rounded-2xl bg-white p-3.5 dark:bg-[#221F19]">
          <div className="flex items-start gap-3">
            <img src={gift.img} alt={gift.name} className="h-[68px] w-[68px] shrink-0 rounded-xl object-cover" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[15.5px] font-semibold leading-[21px] text-[#33291A] dark:text-white/90">{gift.name}</p>
              <p className="mt-1.5 flex items-center gap-1 text-[13.5px] text-black/45 dark:text-white/45">
                {gift.unit}
                <Info className="h-[13px] w-[13px] text-black/25" />
              </p>
              <p className="mt-1.5 text-[13.5px] text-[#576B95]">礼物详情</p>
            </div>
          </div>
        </div>

        {/* 礼物待收下卡 */}
        <div className="mt-2.5 rounded-2xl bg-white dark:bg-[#221F19]">
          <div className="px-4 pb-3.5 pt-4">
            <p className="text-[16.5px] font-semibold text-[#A9895B] dark:text-[#C9A96E]">礼物待收下</p>
            <p className="mt-1.5 text-[13.5px] text-black/45 dark:text-white/45">24小时内礼物未收下将自动退款</p>
          </div>
          <div className="border-t border-black/[0.06] py-3 text-center dark:border-white/[0.08]">
            <p className="text-[15px] text-[#576B95]">查看礼物订单</p>
          </div>
        </div>

        {/* 底部：大家都在送的礼物 */}
        <button type="button" className="mx-auto mt-8 flex items-center gap-0.5 text-[14px] text-[#8A6B3F] dark:text-[#C9A96E]">
          大家都在送的礼物
          <ChevronRight className="h-[15px] w-[15px]" />
        </button>
      </div>
    </div>
  );
}
