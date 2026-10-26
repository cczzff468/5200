'use client';

/**
 * 微信礼物（第 20 轮，替代原加号面板「快递」入口）：
 * - WxGiftPicker：礼物选择页（compose='gift'）——奶油金色调页面 + 2 列礼物卡，点「送出」即把礼物卡发进当前聊天
 * - WxGiftCardBubble：聊天里的礼物卡片气泡——**用户参考真机截图 1:1**：深蓝星空底（细碎白星）
 *   + 金色竖丝带（全高细线 + 中部蝴蝶结）+ 居中金色「送你一份心意」+ 左下角白色「礼物」；
 *   尾巴指向发送方头像侧（right = 我方），点卡片开收礼弹窗
 * - WxGiftReceiveSheet：点卡片弹出的收礼弹窗（真机同款）——奶油金大圆角面板（{sender}送的礼物 /
 *   送你一份心意 / 礼物大图 / 金色祝福语标题+数量 / 金色「收下礼物」按钮）+ 面板下方圆形 ✕ 关闭钮；
 *   收下后按钮变「已收下」（accepted 持久化在消息上，重开仍显示已收下）
 */

import { ChevronLeft, ChevronRight, X } from 'lucide-react';

/** 礼物条目（礼物目录内置于代码；image 为 public 静态路径，随消息快照落库） */
export interface WxGiftItem {
  id: string;
  /** 礼物全名（弹窗金色标题用 bless，列表/消息快照用 name） */
  name: string;
  /** 数量行（如「四叶草小狗1个」，真机同款文案） */
  countLabel: string;
  /** 弹窗金色祝福标题（如「好运降临！幸运四叶草小狗钥匙扣」） */
  bless: string;
  image: string;
}

/** 聊天消息里持久化的礼物快照（= WxGiftItem + 收下状态；accepted 后弹窗按钮变已收下） */
export interface WxGiftData extends WxGiftItem {
  accepted?: boolean;
}

/** 内置礼物目录（首礼按用户参考截图的四叶草小狗毛绒挂件，AI 生成商品图） */
export const WX_GIFTS: WxGiftItem[] = [
  { id: 'clover-dog', name: '幸运四叶草小狗钥匙扣', countLabel: '四叶草小狗1个', bless: '好运降临！幸运四叶草小狗钥匙扣', image: '/gifts/clover-dog.webp' },
  { id: 'rose-bear', name: '永生花小熊礼盒', countLabel: '永生花小熊1盒', bless: '甜蜜满怀！永生花小熊礼盒', image: '/gifts/rose-bear.webp' },
  { id: 'star-jar', name: '星空许愿玻璃罐', countLabel: '许愿星星1罐', bless: '愿望成真！星空许愿玻璃罐', image: '/gifts/star-jar.webp' },
  { id: 'latte-candle', name: '拿铁香氛蜡烛', countLabel: '香氛蜡烛1个', bless: '温暖常伴！拿铁香氛蜡烛', image: '/gifts/latte-candle.webp' },
];

/** 卡片配色常量（与真机截图采样对齐） */
const CARD_GOLD = '#F2D9A6';
const CARD_GOLD_SOFT = '#E9C98B';

/* 星空点缀：固定坐标散点（x/y 为百分比，r 像素，o 透明度）——细碎白星不闪烁，贴真机静态星空 */
const CARD_STARS: Array<[number, number, number, number]> = [
  [6, 14, 1.1, 0.75], [13, 34, 0.9, 0.5], [9, 58, 1.3, 0.6], [4, 82, 1, 0.45],
  [17, 90, 1.2, 0.55], [22, 8, 0.8, 0.4], [27, 22, 1.4, 0.8], [24, 47, 0.9, 0.42],
  [30, 70, 1.1, 0.5], [26, 88, 0.8, 0.35], [36, 12, 1, 0.55], [41, 32, 1.5, 0.85],
  [38, 55, 0.8, 0.4], [44, 78, 1.2, 0.6], [42, 92, 0.9, 0.4], [52, 10, 1.1, 0.6],
  [56, 27, 0.8, 0.4], [54, 46, 1.3, 0.7], [58, 66, 0.9, 0.45], [52, 86, 1.4, 0.75],
  [64, 16, 0.9, 0.5], [68, 38, 1.1, 0.6], [66, 60, 0.8, 0.4], [72, 80, 1.2, 0.65],
  [78, 10, 1.3, 0.7], [82, 30, 0.8, 0.4], [86, 52, 1.4, 0.8], [80, 72, 0.9, 0.45],
  [90, 18, 1, 0.55], [94, 44, 1.2, 0.65], [92, 68, 0.8, 0.4], [96, 88, 1.1, 0.6],
];

/** 蝴蝶结（金色线描双环 + 中心结，竖丝带从卡片顶贯穿到底，结扎在垂直居中处） */
function RibbonBow() {
  return (
    <svg width="38" height="24" viewBox="0 0 38 24" fill="none" aria-hidden="true" className="block">
      <path
        d="M19 12 C13 3, 4 3.5, 3.5 9 C3.2 13.5, 12 15.5, 19 12 Z"
        fill="rgba(242,217,166,0.16)"
        stroke={CARD_GOLD_SOFT}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M19 12 C25 3, 34 3.5, 34.5 9 C34.8 13.5, 26 15.5, 19 12 Z"
        fill="rgba(242,217,166,0.16)"
        stroke={CARD_GOLD_SOFT}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="19" cy="12" r="2.1" fill={CARD_GOLD_SOFT} />
    </svg>
  );
}

/** 礼物卡片气泡（深蓝星空 + 金丝带 + 送你一份心意，真机参考图 1:1；side 决定尾巴指向头像侧） */
export function WxGiftCardBubble({
  gift,
  side,
  onClick,
}: {
  gift: WxGiftData;
  /** 'right' = 我方发出（尾巴在右）；'left' = 对方送来（尾巴在左） */
  side: 'right' | 'left';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="wx-gift-bubble"
      aria-label={`礼物卡片：${gift.bless}，点击查看`}
      onClick={onClick}
      className="relative block h-[100px] w-[252px] cursor-pointer overflow-hidden rounded-[10px] text-left shadow-[0_5px_16px_rgba(0,0,0,0.14)] transition-transform duration-150 active:scale-[0.97]"
      style={{ background: 'linear-gradient(160deg, #4467B4 0%, #2C4E92 46%, #20396E 100%)' }}
    >
      {/* 星空细碎白点 */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        {CARD_STARS.map(([x, y, r, o], i) => (
          <circle key={i} cx={`${x}%`} cy={`${y}%`} r={r} fill="#FFFFFF" opacity={o} />
        ))}
      </svg>

      {/* 竖丝带：全高金色细线（x≈17%）+ 中部蝴蝶结 */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 top-0 w-[2.5px]"
        style={{ left: 44, background: `linear-gradient(180deg, ${CARD_GOLD} 0%, ${CARD_GOLD_SOFT} 60%, rgba(233,201,139,0.55) 100%)` }}
      />
      <span aria-hidden="true" className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: 45 }}>
        <RibbonBow />
      </span>

      {/* 居中金色标题（真机同款文案） */}
      <span
        className="absolute inset-y-0 flex items-center justify-center text-[17px] font-semibold tracking-[0.5px]"
        style={{ left: 64, right: 6, color: CARD_GOLD }}
      >
        送你一份心意
      </span>

      {/* 左下角「礼物」标签 */}
      <span className="absolute bottom-[9px] left-[13px] text-[13px] font-medium text-white/95">礼物</span>

      {/* 气泡尾巴：指向发送方头像侧（与其它卡片气泡同一画法） */}
      <span
        aria-hidden="true"
        className={`absolute top-[14px] h-[11px] w-[11px] rotate-45 rounded-[2px] ${side === 'left' ? '-left-[4px]' : '-right-[4px]'}`}
        style={{ backgroundColor: '#2E5095' }}
      />
    </button>
  );
}

/** 礼物选择页（加号面板「礼物」入口）：奶油金色调 + 2 列礼物卡，点「送出」发卡进当前聊天 */
export function WxGiftPicker({
  onBack,
  onSend,
}: {
  onBack: () => void;
  /** 选中礼物 → 父组件负责落消息 + toast + 关页（+触发 AI 回合） */
  onSend: (gift: WxGiftItem) => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col" data-testid="wx-gift-picker" style={{ background: 'linear-gradient(180deg, #FDF6E7 0%, #F7EDD8 100%)' }}>
      {/* 顶栏（奶油金同款） */}
      <div className="shrink-0 pt-[54px]">
        <div className="relative grid h-[48px] place-items-center">
          <button type="button" aria-label="返回" data-testid="wx-gift-back" onClick={onBack} className="absolute left-1 grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-[24px] w-[24px] text-[#8A6B3A]" strokeWidth={2.2} />
          </button>
          <p className="text-[17px] font-semibold" style={{ color: '#7A5C30' }}>礼物</p>
        </div>
        <p className="pb-1 pt-0.5 text-center text-[11.5px]" style={{ color: 'rgba(160,124,66,0.55)' }}>送你一份心意 · 大家都在送的礼物</p>
      </div>

      {/* 礼物 2 列网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="grid grid-cols-2 gap-3">
          {WX_GIFTS.map((g) => (
            <div key={g.id} className="overflow-hidden rounded-[14px] bg-white shadow-[0_2px_10px_rgba(122,92,48,0.08)]" data-testid={`wx-gift-item-${g.id}`}>
              <div className="aspect-square w-full overflow-hidden bg-[#F5EEDD]">
                <img src={g.image} alt={g.name} className="h-full w-full object-cover" loading="lazy" />
              </div>
              <div className="px-2.5 pb-2.5 pt-2">
                <p className="line-clamp-1 text-[12.5px] font-medium leading-[17px] text-[#5C4526]">{g.name}</p>
                <p className="mt-0.5 text-[10.5px] leading-[14px]" style={{ color: 'rgba(160,124,66,0.6)' }}>{g.countLabel}</p>
                <button
                  type="button"
                  data-testid={`wx-gift-send-${g.id}`}
                  onClick={() => onSend(g)}
                  className="mt-2 h-[30px] w-full rounded-[8px] text-[12.5px] font-semibold text-white transition active:opacity-85"
                  style={{ background: 'linear-gradient(90deg, #E4BE88, #D3A76C)' }}
                >
                  送出
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 收礼弹窗（点卡片唤起，真机同款）：奶油金面板 + 礼物大图 + 金色祝福语 + 收下礼物按钮 + 面板下方 ✕ */
export function WxGiftReceiveSheet({
  gift,
  senderName,
  onAccept,
  onClose,
}: {
  gift: WxGiftData;
  /** 送礼人名（面板顶部「XX送的礼物」） */
  senderName: string;
  onAccept: () => void;
  onClose: () => void;
}) {
  const accepted = !!gift.accepted;
  return (
    <div
      className="absolute inset-0 z-[70] flex flex-col items-center justify-center bg-black/60 px-7"
      data-testid="wx-gift-sheet"
      role="dialog"
      aria-label="礼物弹窗"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[318px] rounded-[24px] px-6 pb-6 pt-8 text-center shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
        style={{ background: 'linear-gradient(180deg, #FDF8EA 0%, #F8EED9 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[15px] font-medium" style={{ color: '#C9A063' }}>{senderName}送的礼物</p>
        <p className="mt-1 text-[17px] font-medium" style={{ color: '#C9A063' }}>送你一份心意</p>

        <img src={gift.image} alt={gift.name} className="mx-auto mt-5 h-[188px] w-[188px] rounded-[12px] object-cover" />

        <button
          type="button"
          onClick={onClose}
          className="mx-auto mt-5 flex max-w-full items-center justify-center gap-0.5 text-[16.5px] font-semibold leading-snug transition active:opacity-70"
          style={{ color: '#B98A46' }}
          data-testid="wx-gift-bless"
        >
          <span className="line-clamp-2">{gift.bless}</span>
          <ChevronRight className="h-[15px] w-[15px] shrink-0" strokeWidth={2.4} />
        </button>
        <p className="mt-1.5 text-[13px]" style={{ color: 'rgba(185,138,70,0.75)' }}>{gift.countLabel}</p>

        <button
          type="button"
          data-testid="wx-gift-accept"
          disabled={accepted}
          onClick={onAccept}
          className="mt-12 h-[46px] w-full rounded-[10px] text-[16px] font-medium text-white transition active:opacity-85 disabled:cursor-default disabled:opacity-60"
          style={{ background: 'linear-gradient(90deg, #E2BE8A, #D2A868)' }}
        >
          {accepted ? '已收下' : '收下礼物'}
        </button>
      </div>

      {/* 面板下方圆形关闭钮（真机同款白描边 ✕） */}
      <button
        type="button"
        aria-label="关闭"
        data-testid="wx-gift-sheet-close"
        onClick={onClose}
        className="mt-5 grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full border-2 border-white/85 text-white transition active:opacity-70"
      >
        <X className="h-[20px] w-[20px]" strokeWidth={2} />
      </button>
    </div>
  );
}
