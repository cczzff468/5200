'use client';

/**
 * 淘宝 App（仿 iOS 淘宝购物，复用美团/支付宝底层逻辑）：
 * - 首页：搜索框/扫码/消息入口 + 分类宫格（数码/服饰/家居/美妆/食品/图书）+ 运营位 +
 *   推荐商品流（双列瀑布：图/标题/价格/销量/店铺）+ 下拉刷新 + 上滑加载更多；
 * - 搜索：关键词/搜索历史/热门搜索 + 结果筛选（包邮/天猫）排序（综合/销量/价格升降）；
 * - 商品详情：多图轮播 + SKU（颜色/尺码）+ 店铺卡 + 评价 + 加购/立即购买/收藏；
 * - 购物车：勾选/全选/删除 + 数量加减（减到 0 自动移除）+ 合计结算；
 * - 下单：收货地址 + 优惠券/运费 + 支付方式选择；支付复用 QQ/微信钱包（亲属卡支付写 AI 记忆）；
 * - 订单：待付款/待发货/待收货/已完成/已取消 + 物流轨迹 + 确认收货/评价/退款/再来一单；
 * - 我的：订单宫格/收藏/足迹/地址管理/快递/优惠券/账户余额（微信+QQ 只读）/设置；
 * - 数据：tb-* IndexedDB kv 按 uid 隔离（taobao-store.ts）；UI 图标一律 SVG（禁 emoji）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Bell,
  Bike,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  Clock as ClockIcon,
  ClipboardList,
  Copy,
  Crosshair,
  FileText,
  GripVertical,
  Headphones,
  Heart,
  Home as HomeIcon,
  LayoutGrid,
  MapPin,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Package,
  Phone,
  Plus,
  ScanLine,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Store,
  Ticket,
  Trash2,
  Truck,
  User,
  Wallet,
  X,
  Zap,
  Loader2,
} from 'lucide-react';
import { MT_RIDERS, mtGetRiderId, mtRiderSrcOf, mtSetRiderId } from '@/lib/ios/mt-rider';
import { useSettings, useUI } from '@/lib/ios/store';
import {
  tbChatLast,
  tbChatShops,
  tbChatTotalUnread,
  tbChatUnread,
  tbFetchAiBatch,
  tbFeedAuxLoad,
  tbFeedAuxSave,
  tbFeedLoad,
  tbFeedSave,
  tbRestoreAiProducts,
  type TbFeedTop,
} from '@/lib/ios/tb-ai-store';
import {
  TB_CATS,
  TB_HOT_SEARCHES,
  TB_PRODUCTS,
  productById,
  shopById,
  tbImg,
  tbReviewsOf,
  tbSalesText,
  tbSearchScore,
  type TbCatId,
  type TbProduct,
} from '@/lib/ios/taobao-data';
import {
  TB_CC_SEEDS,
  TB_COUPON_SEEDS,
  TB_PAY_TTL,
  TB_TRACK_NODES,
  tbAddToCart,
  tbBestCoupon,
  tbCancelOrder,
  tbCartQty,
  tbClaimCoupon,
  tbClearCheckedCart,
  tbClearSearchHist,
  tbConfirmReceive,
  tbCreateOrder,
  tbGetSession,
  tbIdpLoggedIn,
  tbLoadAddrs,
  tbLoadCart,
  tbLoadCoupons,
  tbLoadFoots,
  tbLoadFavs,
  tbLoadMsgs,
  tbLoadOrders,
  tbLoadSearchHist,
  tbLoadShopFollows,
  tbMarkPaid,
  tbMarkRefund,
  tbMsgUnreadCount,
  tbPinCartShop,
  tbPushFoot,
  tbPushMsg,
  tbPushSearchHist,
  tbRemoveCartItems,
  tbResolveIdpIdentity,
  tbSaveAddrs,
  tbSaveCart,
  tbSaveOrders,
  tbSetCartAllChecked,
  tbSetCurAddr,
  tbSetMsgsReadAt,
  tbSetSession,
  tbStartOrderWatcher,
  tbStatusText,
  tbSubmitReview,
  tbCurAddr,
  tbCurAddrId,
  tbDeleteOrder,
  tbTickOrders,
  tbToggleFav,
  tbToggleShopFollow,
  tbUidOf,
  tbUpdateCartItem,
  tbUseCoupon,
  tbWipeUid,
  type TbAddress,
  type TbCartItem,
  type TbCoupon,
  type TbOrder,
  type TbOrderItem,
  type TbOrderStatus,
  type TbSession,
} from '@/lib/ios/taobao-store';
import { tbExecutePay, tbListPayChannels, tbRefundToOrigin, type TbPayChannel } from '@/lib/ios/taobao-pay';
import { BillPage, FliggyPage, MoviePage, SeckillPage, SignInPage, SubsidyPage, TicketDetailPage } from './taobao-channels';
import { TbMsgChatPage } from './taobao-msg-chat';
import { TbPullIndicator, useTbPullRefresh } from './tb-pull-refresh';
import { LocalToast, useLocalToast } from './page-toast';

const TB_ORANGE = '#FF5000';
const TB_PRICE = '#FF4400';

// ---------------- 工具 ----------------

const fmtMoney = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** 价格整数/小数分段（¥59.8 → 59 大 8 小） */
function Price({ value, size = 18 }: { value: number; size?: number }) {
  const s = value.toFixed(2).replace(/\.?0+$/, '');
  const [int, dec] = s.split('.');
  return (
    <span className="font-semibold text-[#FF4400]" style={{ fontSize: size }}>
      <span className="text-[0.65em]">¥</span>
      {int}
      {dec ? <span className="text-[0.72em]">.{dec}</span> : null}
    </span>
  );
}

const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const fmtFullTime = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

/** 消息会话时间（截图2口径：今天 HH:MM / 昨天 / 星期X / 更早 YY/MM-DD） */
const fmtChatTime = (ts: number): string => {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dayMs = 86_400_000;
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= midnight) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ts >= midnight - dayMs) return '昨天';
  if (ts >= midnight - 6 * dayMs) return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
  if (d.getFullYear() !== now.getFullYear()) return `${String(d.getFullYear()).slice(2)}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
};

/** 待付款倒计时 mm:ss */
function useCountdown(target: number | undefined): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!target) return '30:00';
  const left = Math.max(0, Math.floor((target - now) / 1000));
  return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
}

/** 页面顶栏（返回 + 标题 + 右侧槽位） */
function TopBar({ title, onBack, right, light }: { title: string; onBack?: () => void; right?: ReactNode; light?: boolean }) {
  return (
    <div className={`sticky top-0 z-30 px-3 pt-[54px] ${light ? 'bg-[#FF5000] text-white' : 'bg-white text-black/90'}`}>
      <div className="flex h-12 items-center gap-2">
        {onBack ? (
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ArrowLeft className="h-[22px] w-[22px]" strokeWidth={2.2} />
          </button>
        ) : null}
        <span className="flex-1 truncate text-center text-[17px] font-semibold">{title}</span>
        <div className="flex min-w-[36px] items-center justify-end gap-1">{right}</div>
      </div>
    </div>
  );
}

/** 淘宝「淘」字标（SVG 文字，非图片非 emoji） */
function TbLogoMark({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-grid shrink-0 place-items-center rounded-full bg-[#FF5000] font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.62 }}
    >
      淘
    </span>
  );
}

/** 微信支付小图标（绿色对话气泡，内联 SVG 禁 emoji） */
function WxPayIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#09BB07" />
      <path d="M9.7 5.6c-2.9 0-5.2 1.9-5.2 4.2 0 1.32.76 2.5 1.95 3.27l-.49 1.48 1.72-.86c.6.16 1.24.25 2.02.25.1 0 .2 0 .3-.01a3.6 3.6 0 0 1-.13-.98c0-2.2 2.13-3.98 4.76-3.98.16 0 .32 0 .47.02-.42-1.93-2.6-3.39-5.4-3.39Z" fill="#fff" />
      <path d="M19.4 12.95c0-1.95-1.95-3.53-4.35-3.53s-4.35 1.58-4.35 3.53 1.95 3.53 4.35 3.53c.52 0 1.02-.07 1.48-.2l1.45.72-.4-1.22c1.1-.64 1.82-1.66 1.82-2.83Z" fill="#fff" />
      <circle cx="8.4" cy="9.1" r="0.62" fill="#09BB07" />
      <circle cx="11" cy="9.1" r="0.62" fill="#09BB07" />
    </svg>
  );
}

/** 支付宝小图标（蓝底「支」字，内联 SVG 禁 emoji） */
function AliPayIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#1677FF" />
      <text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">
        支
      </text>
    </svg>
  );
}

/** 支付方式单选行（截图7/9：微信支付 / 支付宝，橙勾单选） */
function PayRadioRow({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 py-2.5 text-left active:opacity-75">
      {icon}
      <span className="text-[14px] text-black/85">{label}</span>
      <span className={`ml-auto grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full ${active ? 'bg-[#FF5000]' : 'border border-black/20 bg-white'}`}>
        {active ? <Check className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
      </span>
    </button>
  );
}

// ---------------- 底部导航图标（截图1/2：气泡三点消息/圆角方播放视频/笑脸我的；选中态橙色填充） ----------------

/** 消息气泡（三个点；active 橙色填充白点，inactive 黑描边） */
function TbMsgTabIcon({ active, size = 24 }: { active: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.2c5.05 0 9 3.32 9 7.6 0 4.28-3.95 7.6-9 7.6-.94 0-1.85-.11-2.7-.33l-3.6 2.1a.55.55 0 0 1-.83-.5l.16-3.1C3.6 15.15 3 12.98 3 10.8c0-4.28 3.95-7.6 9-7.6Z"
        fill={active ? '#FF5000' : 'none'}
        stroke={active ? '#FF5000' : '#1a1a1a'}
        strokeWidth={active ? 0 : 1.9}
        strokeLinejoin="round"
      />
      <circle cx="8.2" cy="10.8" r="1.15" fill={active ? '#fff' : '#1a1a1a'} />
      <circle cx="12" cy="10.8" r="1.15" fill={active ? '#fff' : '#1a1a1a'} />
      <circle cx="15.8" cy="10.8" r="1.15" fill={active ? '#fff' : '#1a1a1a'} />
    </svg>
  );
}

/** 视频 tab（圆角方 + 播放三角；active 橙填充） */
function TbVideoTabIcon({ active, size = 24 }: { active: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4.4" width="18" height="15.2" rx="4.4" fill={active ? '#FF5000' : 'none'} stroke={active ? '#FF5000' : '#1a1a1a'} strokeWidth={1.9} />
      <path d="M10.2 9.1 15 12l-4.8 2.9V9.1Z" fill={active ? '#fff' : '#1a1a1a'} strokeLinejoin="round" />
    </svg>
  );
}

/** 我的淘宝（笑脸；active 橙填充白脸） */
function TbMeTabIcon({ active, size = 24 }: { active: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill={active ? '#FF5000' : 'none'} stroke={active ? '#FF5000' : '#1a1a1a'} strokeWidth={1.9} />
      <circle cx="9" cy="10" r="1.15" fill={active ? '#fff' : '#1a1a1a'} />
      <circle cx="15" cy="10" r="1.15" fill={active ? '#fff' : '#1a1a1a'} />
      <path d="M8.3 14.3c1 1.3 2.3 2 3.7 2s2.7-.7 3.7-2" fill="none" stroke={active ? '#fff' : '#1a1a1a'} strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

/** 清除未读小扫帚（内联 SVG） */
function BroomIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.5 3.5 20 9l-4.2 4.2-5.5-5.5 4.2-4.2Z" fill="#8a8a8a" />
      <path d="m9.6 8.4 5.5 5.5-6.3 6.3c-.4.4-1 .5-1.5.2l-3.6-2a1 1 0 0 1-.2-1.6l6.1-8.4Z" fill="#b9b9b9" />
      <path d="m5.6 15.2 2.7 2.7" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** 通讯录/联系人扫一扫（方括号+人形，消息页右上） */
function ContactScanIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#1a1a1a" strokeWidth="1.9" strokeLinecap="round">
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <circle cx="12" cy="10.2" r="2.5" />
      <path d="M7.6 16.8c.7-1.9 2.4-3 4.4-3s3.7 1.1 4.4 3" />
    </svg>
  );
}

/** 首页运营位图标（截图1：红包签到/淘宝秒杀/领淘金币/阿里拍卖/淘票票/飞猪；彩色内联 SVG） */
function HongbaoIcon({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="7" y="5" width="34" height="38" rx="7" fill="#FF3B30" />
      <path d="M7 12c6 4.5 11 6.6 17 6.6S35 16.5 41 12v-0.4A7 7 0 0 0 34 5H14a7 7 0 0 0-7 7v.4Z" fill="#E62E24" />
      <circle cx="24" cy="19" r="7.5" fill="#FFD100" />
      <text x="24" y="23.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#E62E24" fontFamily="system-ui, sans-serif">¥</text>
    </svg>
  );
}

function MiaoshaIcon({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="26" r="16" fill="#FF3B30" />
      <circle cx="24" cy="26" r="11.5" fill="#fff" />
      <path d="M24 17.5v8.5l6 3.6" stroke="#FF3B30" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M10.5 12.5 15 8M37.5 12.5 33 8" stroke="#FF3B30" strokeWidth="4" strokeLinecap="round" />
      <path d="M31.5 2.5 24 13h5l-2.5 8 9-11.5h-5l1-7Z" fill="#FFD100" stroke="#E62E24" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function TbCoinIcon({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="19" fill="#FFC300" />
      <circle cx="24" cy="24" r="14" fill="#FFDB4D" />
      <text x="24" y="30.5" textAnchor="middle" fontSize="17" fontWeight="700" fill="#C77700" fontFamily="system-ui, sans-serif">币</text>
      <path d="M13 10.5c2-1.8 4.4-3 7-3.6" stroke="#FFE68A" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function PaiIcon({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M10 8h28a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H26l-8 6v-6h-8a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4Z" fill="#FF4FA0" />
      <text x="24" y="25.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">捡漏</text>
      <circle cx="24" cy="40.5" r="2.6" fill="#FF4FA0" />
    </svg>
  );
}

function TicketPiaoIcon({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="16" cy="24" r="10" fill="#E62E24" />
      <circle cx="32" cy="24" r="10" fill="#E62E24" />
      <rect x="16" y="21" width="16" height="6" fill="#E62E24" />
      <circle cx="16" cy="24" r="4.6" fill="#fff" />
      <circle cx="32" cy="24" r="4.6" fill="#fff" />
      <circle cx="16" cy="24" r="2.2" fill="#2B7DE9" />
      <circle cx="32" cy="24" r="2.2" fill="#2B7DE9" />
    </svg>
  );
}

function FliggyIcon({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="26" r="17" fill="#FFD100" />
      <path d="M9 15c-2-4-1-7 1-8 2.4-1.2 5 .6 6.6 3.4A17 17 0 0 0 9 15ZM39 15c2-4 1-7-1-8-2.4-1.2-5 .6-6.6 3.4A17 17 0 0 1 39 15Z" fill="#FFD100" />
      <circle cx="18.5" cy="22" r="2.6" fill="#3b2b00" />
      <circle cx="29.5" cy="22" r="2.6" fill="#3b2b00" />
      <ellipse cx="24" cy="29.5" rx="6.4" ry="5" fill="#FFB800" />
      <circle cx="21.6" cy="29" r="1.2" fill="#8a6300" />
      <circle cx="26.4" cy="29" r="1.2" fill="#8a6300" />
    </svg>
  );
}

/** 订单取消原因（截图2：价格有点贵 默认选中） */
const TB_CANCEL_REASONS = ['价格有点贵', '余额不足', '收货地址拍错', '规格/款式/数量拍错', '商家不支持花呗', '暂时不需要了', '其他'];

/** 订单取消弹窗（截图2：待付款详情/订单卡「取消」→ 原因选择 → 确定取消 → 交易关闭） */
function CancelOrderSheet({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState(TB_CANCEL_REASONS[0]);
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" onClick={onClose}>
      <div className="rounded-t-2xl bg-white [animation:quick-in-up_.26s_cubic-bezier(0.32,0.72,0,1)_both]" onClick={(e) => e.stopPropagation()}>
        {/* 标题 + 关闭 */}
        <div className="relative flex items-center justify-center pb-3 pt-5">
          <span className="text-[17px] font-bold text-black/90">订单取消</span>
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-4 top-5 grid h-7 w-7 place-items-center active:opacity-60">
            <X className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
          </button>
        </div>
        {/* 提示条 */}
        <div className="mx-4 rounded-lg bg-black/[0.045] px-3.5 py-2.5 text-[13.5px] leading-5 text-black/60">取消后无法恢复，优惠券，红包可退回，有效期内使用</div>
        {/* 原因单选 */}
        <div className="max-h-[46vh] overflow-y-auto px-4 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TB_CANCEL_REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className="flex w-full items-center justify-between py-[15px] text-left active:opacity-70">
              <span className="text-[15px] text-black/85">{r}</span>
              <span className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full ${reason === r ? 'bg-[#FF5000]' : 'border-2 border-black/15 bg-white'}`}>
                {reason === r ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3.2} /> : null}
              </span>
            </button>
          ))}
        </div>
        {/* 底部双按钮（暂不取消 黄 / 确定取消 橙） */}
        <div className="flex gap-3 px-4 pb-8 pt-4">
          <button type="button" onClick={onClose} className="h-12 flex-1 rounded-lg bg-gradient-to-r from-[#FFC53D] to-[#FFB400] text-[16px] font-semibold text-white active:opacity-85">
            暂不取消
          </button>
          <button type="button" onClick={() => onConfirm(reason)} className="h-12 flex-1 rounded-lg bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[16px] font-semibold text-white active:opacity-85">
            确定取消
          </button>
        </div>
      </div>
    </div>
  );
}

/** 退款确认弹层（订单卡「退款」按钮）：确认后原路退回，订单进入「退款/售后」 */
function RefundConfirmSheet({ busy, onClose, onConfirm }: { busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" onClick={busy ? undefined : onClose}>
      <div className="rounded-t-2xl bg-white [animation:quick-in-up_.26s_cubic-bezier(0.32,0.72,0,1)_both]" onClick={(e) => e.stopPropagation()}>
        <div className="relative flex items-center justify-center pb-3 pt-5">
          <span className="text-[17px] font-bold text-black/90">申请退款</span>
          {!busy ? (
            <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-4 top-5 grid h-7 w-7 place-items-center active:opacity-60">
              <X className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
            </button>
          ) : null}
        </div>
        <div className="mx-4 rounded-lg bg-black/[0.045] px-3.5 py-2.5 text-[13.5px] leading-5 text-black/60">退款将按支付方式原路退回（余额/零钱/亲属卡），到账后订单进入「退款/售后」</div>
        <div className="flex gap-3 px-4 pb-8 pt-5">
          <button type="button" disabled={busy} onClick={onClose} className="h-12 flex-1 rounded-lg bg-black/[0.05] text-[16px] font-semibold text-black/70 active:opacity-85 disabled:opacity-50">
            暂不退款
          </button>
          <button type="button" disabled={busy} onClick={onConfirm} className="h-12 flex-1 rounded-lg bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[16px] font-semibold text-white active:opacity-85 disabled:opacity-60">
            {busy ? '退款中…' : '确认退款'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TmallMark() {
  return <span className="mr-1 inline-block rounded-[3px] bg-[#FF0036] px-1 py-[1px] align-[2px] text-[10px] font-bold leading-none text-white">天猫</span>;
}

/** 商品图（瀑布流/列表通用，懒加载 + 服务端默认图兜底） */
function ProductImg({ p, w = 600, h = 600, s = 0, className = '' }: { p: TbProduct; w?: number; h?: number; s?: number; className?: string }) {
  return (
    <img
      src={tbImg(p.tag, w, h, s)}
      alt={p.title}
      loading="lazy"
      draggable={false}
      className={`bg-[#f5f5f5] object-cover ${className}`}
    />
  );
}

// ---------------- 登录页 ----------------

// ---------------- 物流口径辅助（截图1-5 物流界面：按订单号确定性生成，刷新稳定） ----------------

function tbHash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const TB_COURIER_COS = ['中通快递', '圆通速递', '中国邮政', '韵达速递', '申通快递'];
const TB_COURIER_MEN = ['刘俊溪', '蒋照桃', '王志远', '李天佑', '陈国栋', '周天磊'];

/** 快递公司（订单号散列稳定） */
function tbCourierCo(orderId: string): string {
  return TB_COURIER_COS[tbHash(orderId) % TB_COURIER_COS.length];
}
/** 快递员姓名 */
function tbCourierMan(orderId: string): string {
  return TB_COURIER_MEN[tbHash(`${orderId}m`) % TB_COURIER_MEN.length];
}
/** 快递员手机号（11 位确定性） */
function tbCourierPhone(orderId: string): string {
  const h = tbHash(`${orderId}p`);
  return `1${3 + (h % 7)}${h % 10}${String((h >>> 4) % 100000000).padStart(8, '0')}`;
}
/** 运单号（14 位确定性） */
function tbTrackNo(orderId: string): string {
  const h = tbHash(`${orderId}t`);
  return `78${String((h >>> 2) % 1000000000000).padStart(12, '0')}`;
}
/** 菜鸟驿站取件码（4-2-5008 形态） */
function tbPickCode(orderId: string): string {
  const h = tbHash(`${orderId}c`);
  return `${1 + (h % 9)}-${1 + ((h >>> 4) % 9)}-${1000 + ((h >>> 8) % 9000)}`;
}
/** 驿站名（跟收货地址） */
function tbStationName(addr: TbAddress | undefined): string {
  if (!addr) return '菜鸟驿站';
  return `${addr.detail.slice(0, 12)}店`;
}
/** 手机号脱敏（86-137****2273） */
function tbMaskPhone(phone: string): string {
  return `86-${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

/** 完整地址（省市区/街道村 + 详细地址；需求：显示地址时省市村地址都要展示，不只门牌号） */
function tbFullAddr(a: TbAddress): string {
  return `${a.region.replace(/\s+/g, '')}${a.detail.trim()}`;
}

/** 物流阶段（地图形态）：备货（无轨迹）/ 揽收 / 运输 / 派送（骑手巡航）/ 驿站待取件 */
type TbExpressPhase = 'prepare' | 'pickup' | 'transit' | 'delivering' | 'station';

/** 骑手位置沿路线二次贝塞尔插值（viewBox 500×220，与路径 M 70 182 Q 250 60 430 150 同一条；
 *  起点降到 y=182：已揽收骑手站在 ETA 气泡下方，不被卡片盖住——用户反馈） */
function tbBezierPos(prog: number): { x: number; y: number } {
  const p = Math.min(1, Math.max(0, prog));
  const u = 1 - p;
  return {
    x: (u * u * 70 + 2 * u * p * 250 + p * p * 430) / 5,
    y: (u * u * 182 + 2 * u * p * 60 + p * p * 150) / 2.2,
  };
}

/** 菜鸟驿站小楼（截图3：橙色驿站 + 站内快递员，纯 SVG） */
function TbStationBuilding() {
  return (
    <span className="absolute left-[46%] top-[26%] block drop-shadow-[0_5px_6px_rgba(0,0,0,0.18)]" aria-hidden="true">
      <svg width="104" height="70" viewBox="0 0 104 70" fill="none">
        <rect x="6" y="20" width="92" height="46" rx="3" fill="#FF8A3C" />
        <rect x="6" y="20" width="92" height="13" rx="3" fill="#FF5A00" />
        <rect x="15" y="38" width="30" height="28" rx="2" fill="#FFE9D6" />
        <rect x="53" y="38" width="15" height="28" rx="2" fill="#FFB27A" />
        <rect x="74" y="38" width="14" height="15" rx="2" fill="#FFE9D6" />
        <rect x="76" y="40" width="10" height="3" rx="1.5" fill="#FF5A00" opacity="0.7" />
      </svg>
    </span>
  );
}

/** 物流地图（截图1/3：浅色高德风路网 + 橙色 ETA 气泡 + 橙路线 + 收货标记；
 *  骑手形象复用美团 mt-rider（「我的-骑手」所选形象，淘宝共用同一形象）：
 *  揽收期停在商家侧，派送期沿曲线向收货地行进，到驿站后驿站小楼+站前骑手） */
function TbExpressMap({ phase, etaTitle, etaSub, addrDetail, riderProg }: { phase: TbExpressPhase; etaTitle: string; etaSub: string; addrDetail?: string; riderProg: number }) {
  const riderSrc = mtRiderSrcOf(mtGetRiderId());
  const community = (addrDetail ?? '').trim().split(/\s+/)[0] || '未来科技城';
  const pos = tbBezierPos(phase === 'delivering' ? riderProg : phase === 'pickup' ? 0.06 : 0.97);
  const truckPos = tbBezierPos(Math.min(0.85, 0.2 + riderProg * 0.6));
  /** 备货中（无轨迹）：不画路线/骑手，仅商家+收货标记 */
  const preparing = phase === 'prepare';
  return (
    <div className="relative h-[252px] overflow-hidden bg-[#E9EFF5]" aria-label="物流地图">
      {/* 水系 / 绿地 */}
      <div className="absolute -right-8 top-8 h-24 w-40 rounded-[46%] bg-[#C7DFF2]" />
      <div className="absolute -left-10 bottom-[-30px] h-24 w-44 rounded-[48%] bg-[#C7DFF2]" />
      <div className="absolute -left-8 top-10 h-20 w-36 rounded-[46%] bg-[#D8EDD3]" />
      <div className="absolute right-[30%] bottom-[-20px] h-16 w-28 rounded-[45%] bg-[#D8EDD3]" />
      {/* 建筑块 */}
      <div className="absolute bottom-[34%] left-[26%] h-5 w-9 rounded-[3px] bg-black/[0.05]" />
      <div className="absolute left-[60%] top-[16%] h-4 w-7 rounded-[3px] bg-black/[0.05]" />
      <div className="absolute bottom-[20%] right-[30%] h-4 w-6 rounded-[3px] bg-black/[0.05]" />
      {/* 路网 */}
      <div className="absolute left-0 right-0 top-[44%] h-[7px] -rotate-2 bg-white/90" />
      <div className="absolute bottom-[-4%] left-[30%] top-[-4%] w-[6px] rotate-6 bg-white/90" />
      <div className="absolute left-[-6%] right-[20%] top-[72%] h-[5px] rotate-3 bg-white/75" />
      <div className="absolute bottom-[-6%] left-[70%] top-[10%] w-[5px] -rotate-12 bg-white/75" />
      {/* 地名 */}
      <span className="absolute left-[6%] top-[20%] text-[11px] text-black/30">文一西路隧道</span>
      <span className="absolute right-[8%] top-[10%] text-[11px] text-black/30">19号线</span>
      <span className="absolute left-[36%] top-[58%] -rotate-2 text-[12px] tracking-wide text-black/35">文一西路</span>
      <span className="absolute bottom-[10%] right-[6%] text-[11px] font-medium text-black/45">{community}</span>
      {/* 路线（商家 → 收货地 弧线；备货中不画） */}
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 500 220" preserveAspectRatio="none" fill="none" aria-hidden="true">
        {!preparing ? <path d="M 70 182 Q 250 60 430 150" stroke="#FF7A21" strokeWidth="3.5" strokeLinecap="round" opacity="0.85" /> : null}
      </svg>
      {/* 收货标记（橙「收」+ 白胶囊） */}
      <span className="absolute right-[13%] top-[56%] flex items-center gap-1.5">
        <span className="grid h-[22px] w-[22px] place-items-center rounded-md bg-[#FF5000] text-[13px] font-bold text-white shadow-md">收</span>
        <span className="rounded-full bg-white px-2 py-0.5 text-[12px] font-medium text-black/75 shadow-sm">收货地址</span>
      </span>
      {/* 起点：驿站小楼 / 商家标记 */}
      {phase === 'station' ? (
        <>
          <TbStationBuilding />
          <span className="absolute left-[49%] top-[47%] block">
            <img src={riderSrc} alt="驿站快递员" draggable={false} className="mt-rider-img h-[38px] w-[38px] select-none object-contain" style={{ filter: 'drop-shadow(0 4px 3px rgba(0,0,0,0.22))' }} />
          </span>
        </>
      ) : (
        <Store className="absolute left-[10%] top-[62%] h-[22px] w-[22px] text-[#FF8A00] drop-shadow-[0_2px_2px_rgba(0,0,0,0.22)]" strokeWidth={2.2} />
      )}
      {/* 运输中：货车沿路线行进 */}
      {phase === 'transit' ? (
        <span className="absolute" style={{ left: `calc(${truckPos.x}% - 15px)`, top: `calc(${truckPos.y}% - 15px)` }}>
          <Truck className="h-[30px] w-[30px] text-[#FF6A00] drop-shadow-[0_3px_3px_rgba(0,0,0,0.25)]" strokeWidth={2} />
        </span>
      ) : null}
      {/* 骑手形象（美团同款：立体投影 + 颠簸动画；驿站阶段由驿站小楼前的快递员替代；备货中不显示） */}
      {phase !== 'transit' && phase !== 'station' && phase !== 'prepare' ? (
        <span className="mt-rider absolute block" style={{ left: `calc(${pos.x}% - 26px)`, top: `calc(${pos.y}% - 26px)` }}>
          <img src={riderSrc} alt="快递骑手" draggable={false} className="mt-rider-img h-[52px] w-[52px] select-none object-contain" style={{ filter: 'drop-shadow(0 5px 4px rgba(0,0,0,0.25)) drop-shadow(0 1.5px 2px rgba(0,0,0,0.18))' }} />
        </span>
      ) : null}
      {/* ETA 气泡（顶栏正下方；用户反馈：已揽收卡片往上提，不得盖住骑手） */}
      <div className="absolute left-4 top-[96px] rounded-2xl bg-[#FF6A00] px-4 py-2.5 text-white shadow-[0_8px_20px_rgba(255,106,0,0.4)]">
        <div className="text-[17px] font-bold leading-6">{etaTitle}</div>
        <div className="mt-0.5 text-[12px] text-white/85">{etaSub}</div>
      </div>
    </div>
  );
}

/** 物流描述文案（节点序号 → 标题 + 描述，含橙色电话高亮） */
function tbNodeMeta(idx: number, man: string, manPhone: string, station: string): { title: string; desc: string; phone?: string } {
  switch (idx) {
    case 0:
      return { title: '已揽收', desc: '【杭州市】快递员已上门取件，包裹正准备发往杭州转运中心' };
    case 1:
      return { title: '运输中', desc: '【杭州市】快件已到达 杭州转运中心，即将发往目的地网点' };
    case 2:
      return { title: '派送中', desc: `【杭州市】 杭州未来科技城 的业务员【${man}（勿找商家，有事呼叫我），${manPhone}】正在为您派送`, phone: manPhone };
    case 3:
      return { title: '待取件', desc: `您的快件已暂存至${station}，请凭取货码及时领取。如有疑问请联系${manPhone}`, phone: manPhone };
    default:
      return { title: '物流更新', desc: '包裹物流信息更新' };
  }
}

/** 描述文本渲染（电话号码橙色高亮） */
function TbDescText({ text, phone }: { text: string; phone?: string }) {
  if (!phone || !text.includes(phone)) return <span>{text}</span>;
  const parts = text.split(phone);
  return (
    <span>
      {parts[0]}
      <span className="text-[#FF5000]">{phone}</span>
      {parts[1]}
    </span>
  );
}

/** 物流轨迹节点标题（订单卡物流条 / 详情页复用） */
function tbTrackPhaseText(nodeIdx: number): string {
  return nodeIdx >= 3 ? '待取件' : nodeIdx === 2 ? '派送中' : nodeIdx === 1 ? '运输中' : '已揽收';
}

function LoginPage({ onLogin, onToast }: { onLogin: (s: TbSession) => void; onToast: (m: string) => void }) {
  const closeApp = useUI((s) => s.closeApp);
  const [agree, setAgree] = useState(true);
  const [auth, setAuth] = useState<{ idp: 'wx' | 'qq'; contactId: string; name: string; avatar: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [idp, setIdp] = useState<'wx' | 'qq' | null>(null);
  const [account, setAccount] = useState('');
  const [pwd, setPwd] = useState('');
  const [pwdErr, setPwdErr] = useState('');

  const tapIdp = async (v: 'wx' | 'qq') => {
    if (busy) return;
    if (!agree) {
      onToast('请先阅读并同意《淘宝用户协议》和《隐私政策》');
      return;
    }
    if (!tbIdpLoggedIn(v)) {
      onToast(v === 'wx' ? '微信尚未登录，请先登录微信后再试' : 'QQ尚未登录，请先登录QQ后再试');
      return;
    }
    setBusy(true);
    try {
      const id = await tbResolveIdpIdentity(v);
      setAuth({ idp: v, contactId: id.contactId, name: id.name, avatar: id.avatar });
    } finally {
      setBusy(false);
    }
  };

  const confirmAuth = async () => {
    if (!auth) return;
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 700));
      onLogin({ idp: auth.idp, contactId: auth.contactId, name: auth.name, avatar: auth.avatar, via: 'oneclick', loginAt: Date.now() });
    } finally {
      setBusy(false);
    }
  };

  const pickIdp = (v: 'wx' | 'qq') => {
    if (busy) return;
    setPwdErr('');
    setIdp((cur) => (cur === v ? null : v));
    setAccount('');
    setPwd('');
  };

  /** 账号密码登录（校验对应微信/QQ 的真实账密，与微信/QQ App 同源） */
  const pwdLogin = async () => {
    if (busy || !idp) return;
    if (!agree) {
      onToast('请先阅读并同意《淘宝用户协议》和《隐私政策》');
      return;
    }
    if (!account.trim() || !pwd) {
      onToast('请输入账号和密码');
      return;
    }
    setBusy(true);
    setPwdErr('');
    try {
      const { loginWechat, loginQQ } = await import('@/lib/ios/contacts-store');
      const res = idp === 'wx' ? await loginWechat('wechat', account.trim(), pwd) : await loginQQ('account', account.trim(), pwd);
      if (!res.ok) {
        setPwdErr(res.error);
        return;
      }
      onLogin({ idp, contactId: res.user.id, name: res.user.name, avatar: res.user.avatar, via: 'password', loginAt: Date.now() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-white">
      <div className="flex items-center gap-2 px-4 pt-[58px]">
        <button type="button" aria-label="关闭" onClick={closeApp} className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.06] active:bg-black/10">
          <X className="h-5 w-5 text-black/80" strokeWidth={2.4} />
        </button>
        <span className="flex-1" />
        <button type="button" onClick={() => onToast('帮助中心（演示）')} className="flex items-center gap-1 text-[15px] text-black/85 active:opacity-60">
          帮助
          <ChevronRight className="h-3.5 w-3.5 rotate-90 text-black/50" />
        </button>
      </div>

      <div className="flex flex-col items-center px-8 pb-6 pt-14">
        <div className="grid h-[76px] w-[76px] place-items-center rounded-[22px] bg-gradient-to-b from-[#FF7A21] to-[#FF4400] shadow-[0_8px_24px_rgba(255,80,0,0.35)]">
          <span className="text-[40px] font-bold leading-none text-white">淘</span>
        </div>
        <div className="mt-4 text-[22px] font-bold tracking-wide text-black/90">淘宝</div>
        <div className="mt-1 text-[13px] text-black/45">淘好货，要淘宝</div>
      </div>

      {/* 一键授权登录 */}
      <div className="px-8">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => tapIdp('wx')}
            disabled={busy}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#07C160] text-[15px] font-medium text-white active:opacity-80 disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <ellipse cx="9.8" cy="8.6" rx="6.6" ry="5.7" />
              <circle cx="16.6" cy="14.4" r="4.7" />
            </svg>
            微信一键登录
          </button>
          <button
            type="button"
            onClick={() => tapIdp('qq')}
            disabled={busy}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#12B7F5] text-[15px] font-medium text-white active:opacity-80 disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3c3.6 0 5.5 2.6 5.5 6 0 .9 0 1.7.5 2.8.6 1.4 1.6 2.7 1.6 3.4 0 .9-1.4 1-2.3 1.5-.7.4-1.4 1.2-2.6 1.2" />
              <path d="M12 3C8.4 3 6.5 5.6 6.5 9c0 .9 0 1.7-.5 2.8-.6 1.4-1.6 2.7-1.6 3.4 0 .9 1.4 1 2.3 1.5.7.4 1.4 1.2 2.6 1.2" />
              <path d="M9.5 18.5c.7 1 1.5 2 2.5 2s1.8-1 2.5-2" />
            </svg>
            QQ一键登录
          </button>
        </div>
        <div className="mt-4 text-center text-[13px] text-black/40">— 或使用账号密码登录 —</div>

        {/* 账密登录 */}
        <div className="mt-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => pickIdp('wx')}
              className={`flex h-10 items-center justify-center gap-1.5 rounded-lg border text-[14px] ${idp === 'wx' ? 'border-[#07C160] bg-[#07C160]/10 text-[#07C160]' : 'border-black/10 text-black/70'}`}
            >
              <span className={`h-2 w-2 rounded-full ${idp === 'wx' ? 'bg-[#07C160]' : 'bg-black/20'}`} />
              微信账密
            </button>
            <button
              type="button"
              onClick={() => pickIdp('qq')}
              className={`flex h-10 items-center justify-center gap-1.5 rounded-lg border text-[14px] ${idp === 'qq' ? 'border-[#12B7F5] bg-[#12B7F5]/10 text-[#12B7F5]' : 'border-black/10 text-black/70'}`}
            >
              <span className={`h-2 w-2 rounded-full ${idp === 'qq' ? 'bg-[#12B7F5]' : 'bg-black/20'}`} />
              QQ账密
            </button>
          </div>
          {idp ? (
            <div className="mt-3 space-y-2">
              <input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder={idp === 'wx' ? '微信号/QQ号/手机号' : 'QQ号'}
                className="h-11 w-full rounded-xl bg-black/[0.04] px-4 text-[15px] outline-none placeholder:text-black/30"
              />
              <input
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                type="password"
                placeholder="密码"
                className="h-11 w-full rounded-xl bg-black/[0.04] px-4 text-[15px] outline-none placeholder:text-black/30"
              />
              {pwdErr ? <div className="text-[12px] text-red-500">{pwdErr}</div> : null}
              <button
                type="button"
                onClick={pwdLogin}
                disabled={busy || !account.trim() || !pwd}
                className="h-11 w-full rounded-xl bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[15px] font-semibold text-white active:opacity-80 disabled:opacity-50"
              >
                {busy ? '登录中…' : '登录'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-auto px-8 pb-10">
        <button type="button" onClick={() => setAgree((v) => !v)} className="mx-auto flex max-w-[300px] items-start gap-2 text-left">
          <span className={`mt-[2px] grid h-4 w-4 shrink-0 place-items-center rounded-full border ${agree ? 'border-[#FF5000] bg-[#FF5000]' : 'border-black/25'}`}>
            {agree ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : null}
          </span>
          <span className="text-[11px] leading-4 text-black/40">
            已阅读并同意 <span className="text-[#FF5000]">《淘宝用户协议》</span> <span className="text-[#FF5000]">《隐私政策》</span>《支付规则》
          </span>
        </button>
      </div>

      {/* 一键授权确认卡 */}
      {auth ? (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/40 px-8">
          <div className="w-full max-w-[300px] rounded-2xl bg-white p-5">
            <div className="text-center text-[17px] font-semibold">授权登录</div>
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-black/[0.03] p-3">
              {auth.avatar ? (
                <img src={auth.avatar} alt={auth.name} className="h-11 w-11 rounded-full object-cover" />
              ) : (
                <span className="grid h-11 w-11 place-items-center rounded-full bg-black/10 text-[16px] font-bold text-black/60">{auth.name.slice(0, 1)}</span>
              )}
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium">{auth.name}</div>
                <div className="text-[12px] text-black/40">{auth.idp === 'wx' ? '微信授权' : 'QQ授权'} · {auth.contactId ? '已实名' : '未实名'}</div>
              </div>
            </div>
            <div className="mt-3 text-[12px] leading-5 text-black/45">淘宝将获得你的昵称、头像，用于创建淘宝账号；购物数据按账号独立隔离保存。</div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setAuth(null)} className="h-11 rounded-xl bg-black/[0.05] text-[15px] text-black/70 active:opacity-80">
                拒绝
              </button>
              <button type="button" onClick={confirmAuth} disabled={busy} className="h-11 rounded-xl bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[15px] font-semibold text-white active:opacity-80 disabled:opacity-60">
                {busy ? '登录中…' : '同意'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------- 首页 ----------------

type HomeFeedTab = 'follow' | 'rec' | 'flash' | 'subsidy' | 'super88' | 'fliggy' | 'wear';

/** 商品池确定性洗牌（seed 固定 → 顺序稳定；刷新只前插新批次，不重排旧内容） */
function tbShufflePool(list: TbProduct[], seed: number): TbProduct[] {
  let h = 7 + seed * 131;
  return list
    .map((p) => {
      let x = 0;
      for (let i = 0; i < p.id.length; i++) x = (x * 31 + p.id.charCodeAt(i)) >>> 0;
      return { p, k: (x + h * 7919) % 100003 };
    })
    .sort((a, b) => a.k - b.k)
    .map((x) => x.p);
}

function HomePage({
  uid,
  onOpenSearch,
  onOpenProduct,
  onToast,
  onOpenCouponCenter,
  onOpenPage,
}: {
  uid: string;
  onOpenSearch: (seed?: string) => void;
  onOpenProduct: (pid: string) => void;
  onToast: (m: string) => void;
  onOpenCouponCenter: () => void;
  onOpenPage: (p: 'signin' | 'seckill' | 'movie' | 'fliggy' | 'subsidy') => void;
}) {
  const feedTabs: { id: HomeFeedTab; label: string; tag?: string }[] = [
    { id: 'follow', label: '关注' },
    { id: 'rec', label: '推荐' },
    { id: 'flash', label: '闪购', tag: '外卖' },
    { id: 'subsidy', label: '国补' },
    { id: 'super88', label: '超级88' },
    { id: 'fliggy', label: '飞猪' },
    { id: 'wear', label: '穿搭' },
  ];
  const [feedTab, setFeedTab] = useState<HomeFeedTab>('rec');
  // Task 40：刷新只往顶部前插新批次（refreshKey），旧内容原位保留；batch 追加式分页不回退
  // Task 41：更新内容用「设置 › API 配置」用户配置的模型生成（/api/tb-feed），AI 批次 + 分页状态
  // 全部持久化（tb-feed:<uid>:home:<tab>）——刷新页面/重开 App 后原样恢复，旧内容永不消失
  const [refreshKey, setRefreshKey] = useState(0);
  const [batch, setBatch] = useState(1);
  /** 前插条目（AI 批次 + 本地兜底批次统一存 pid 引用，经 productById 解析含 AI 注册表） */
  const [tops, setTops] = useState<TbFeedTop[]>([]);
  const apiConfig = useSettings((s) => s.apiConfig);
  const apiCfgRef = useRef(apiConfig);
  apiCfgRef.current = apiConfig;
  const refreshSeq = useRef(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // 镜像 ref：异步刷新完成回调里读取最新状态，避免闭包过期
  const topsRef = useRef(tops);
  topsRef.current = tops;
  const refreshKeyRef = useRef(refreshKey);
  refreshKeyRef.current = refreshKey;
  const batchRef = useRef(batch);
  batchRef.current = batch;
  const follows = tbLoadShopFollows(uid);
  // 当前表面（follow 由 FollowFeed 自渲染，不持久化）
  const surface = feedTab === 'follow' ? null : `home:${feedTab}`;
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const [pullY, setPullY] = useState(0);
  const [pullUpY, setPullUpY] = useState(0);
  const [refreshingDir, setRefreshingDir] = useState<'down' | 'up' | null>(null);
  const pullStart = useRef<number | null>(null);
  const pullDir = useRef<'down' | 'up'>('down');
  const anchorFrom = useRef(0);

  // 挂载/切 tab：恢复该频道持久化的前插批次与分页（旧内容永不消失）
  useEffect(() => {
    if (!surface) return;
    const s = tbFeedLoad(uid, surface);
    setTops(s?.tops ?? []);
    setRefreshKey(s?.refreshKey ?? 0);
    setBatch(s?.batch && s.batch >= 1 ? s.batch : 1);
  }, [uid, surface]);

  // 上滑加载更多（分页进度持久化：刷新页面后已加载的页数还在；节流 600ms 防连续触发）
  const batchSaveTimer = useRef<number | null>(null);
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400) {
      if (batchSaveTimer.current != null) return;
      batchSaveTimer.current = window.setTimeout(() => {
        batchSaveTimer.current = null;
      }, 600);
      setBatch((b) => {
        const nb = Math.min(20, b + 1);
        // 分页进度随写随存（保存为幂等操作，重复执行无副作用）
        if (nb !== b && surfaceRef.current) {
          tbFeedSave(uid, surfaceRef.current, { tops: topsRef.current, batch: nb, refreshKey: refreshKeyRef.current });
        }
        return nb;
      });
    }
  }, [uid]);

  // 双向刷新（Task 40/41）：顶部下拉、底部上拉都触发；AI 生成新推荐前插（用户配置模型），
  // 失败回退本地洗牌批次；旧内容与历史批次永远保留；up 方向视口锚定不跳屏
  const doHomeRefresh = (dir: 'down' | 'up') => {
    setRefreshingDir(dir);
    if (dir === 'down') setPullY(46);
    else {
      setPullUpY(46);
      if (scrollerRef.current) anchorFrom.current = scrollerRef.current.scrollHeight;
    }
    const seq = ++refreshSeq.current;
    const surf = surfaceRef.current;
    // 排除名单：当前已展示的宝贝标题（保证出来的是新内容）
    const exclude = [
      ...topsRef.current.map((t) => productById(t.pid)?.title ?? ''),
      ...pool.slice(0, Math.min(pool.length, 12 + batchRef.current * 8)).map((p) => p.title),
    ].filter((s) => s.length > 0);
    void (async () => {
      const ai = await tbFetchAiBatch({
        uid,
        surface: 'home',
        tab: feedTab,
        exclude,
        count: 8,
        config: apiCfgRef.current,
      });
      if (refreshSeq.current !== seq) return; // 期间又触发了刷新/切频道：丢弃过期批次
      let newTops: TbFeedTop[];
      let newKey = refreshKeyRef.current;
      if (ai) {
        const ks = `ai${Date.now().toString(36)}`;
        newTops = [...ai.products.map((p, i) => ({ pid: p.id, v: i % 4, k: `${ks}-${i}` })), ...topsRef.current];
      } else {
        // 本地兜底：确定性洗牌前插（与 Task 40 口径一致，同样持久化）
        newKey = refreshKeyRef.current + 1;
        const shuffled = tbShufflePool(pool, newKey);
        const ks = `r${newKey}`;
        newTops = [
          ...Array.from({ length: 8 }, (_, i) => ({ pid: shuffled[i % shuffled.length].id, v: newKey % 4, k: `${ks}-${i}` })),
          ...topsRef.current,
        ];
      }
      setTops(newTops);
      setRefreshKey(newKey);
      if (surf) tbFeedSave(uid, surf, { tops: newTops, batch: batchRef.current, refreshKey: newKey });
      setRefreshingDir(null);
      setPullY(0);
      setPullUpY(0);
      if (dir === 'up') {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const el = scrollerRef.current;
            if (el && anchorFrom.current > 0) {
              const d = el.scrollHeight - anchorFrom.current;
              if (d > 0) el.scrollTop += d;
            }
            anchorFrom.current = 0;
          }),
        );
      }
      onToast(ai ? '已为你推荐新的好物，旧内容都还在哦' : '已为你换上新推荐，旧内容都还在哦');
    })();
  };

  // 下拉/上拉触摸手势
  const onTouchStart = (e: React.TouchEvent) => {
    const el = scrollerRef.current;
    if (!el || refreshingDir) {
      pullStart.current = null;
      return;
    }
    if (el.scrollTop <= 0) {
      pullDir.current = 'down';
      pullStart.current = e.touches[0].clientY;
    } else if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
      pullDir.current = 'up';
      pullStart.current = e.touches[0].clientY;
    } else pullStart.current = null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (pullStart.current == null) return;
    const dy = e.touches[0].clientY - pullStart.current;
    if (pullDir.current === 'down' && dy > 0) setPullY(Math.min(90, dy * 0.45));
    else if (pullDir.current === 'up' && dy < 0) setPullUpY(Math.min(90, -dy * 0.45));
  };
  const onTouchEnd = () => {
    if (pullDir.current === 'down' && pullY > 40) doHomeRefresh('down');
    else if (pullDir.current === 'up' && pullUpY > 56) doHomeRefresh('up');
    pullStart.current = null;
  };

  // 推荐池：按 tab 过滤 + 固定种子洗牌（刷新不再重排旧内容——旧宝贝永远原位保留）
  const pool = useMemo(() => {
    let list = [...TB_PRODUCTS];
    if (feedTab === 'flash') list = list.filter((p) => p.promo === '超级88');
    else if (feedTab === 'subsidy') list = list.filter((p) => p.promo === '百亿补贴' || p.promo === '国补');
    else if (feedTab === 'super88') list = list.filter((p) => p.promo === '超级88' || p.promo === '超级立减');
    else if (feedTab === 'fliggy') list = list.filter((p) => p.cat === 'digital' || p.cat === 'fashion');
    else if (feedTab === 'wear') list = list.filter((p) => p.cat === 'fashion');
    return tbShufflePool(list, 0);
  }, [feedTab]);

  const feed = useMemo(() => {
    // 前插批次（Task 41）：AI 批次/本地兜底批次统一存 pid 引用，经 productById 解析（含 AI 注册表），
    // 持久化后刷新页面原样恢复；旧内容原位保留、不消失
    const topEntries = tops.flatMap((t) => {
      const p = productById(t.pid);
      return p ? [{ p, v: t.v, k: t.k }] : [];
    });
    // 基底流：固定顺序 + 追加式分页（i 为局部索引 → key/图变体稳定，不因刷新变化）
    const base: { p: TbProduct; v: number; k: string }[] = [];
    const n = Math.min(pool.length * 3, 12 + batch * 8);
    for (let i = 0; i < n; i++) {
      const p = pool[i % pool.length];
      base.push({ p, v: Math.floor(i / pool.length) % 4, k: `b-${p.id}-${i}` });
    }
    return [...topEntries, ...base];
  }, [tops, pool, batch]);

  // 需求（第十轮）：频道 tab「关注」左侧返回按钮 → 返回手机主屏幕
  const closeApp = useUI((s) => s.closeApp);

  return (
    // 需求（第八轮）：首页整体奶油肉粉色（截图1 口径），不再是橙色渐变
    <div className="flex h-full flex-col bg-[#FBF0E3]">
      {/* 顶部品牌区（固定：奶油底 + 返回主屏 + 黑字频道 tab + 橙描边搜索框；
          需求（第十轮）：搜索框以下的运营位图标/页点/双卡/商品流全部跟随列表滚动） */}
      <div className="relative z-30 shrink-0 bg-[#FDF2E6] pb-2">
        {/* 顶部频道 tab（关注/推荐/闪购外卖/国补/超级88/飞猪/穿搭；选中橙字+微笑弧）+ 左侧返回主屏按钮 */}
        <div className="flex items-end pt-[56px]">
          <button
            type="button"
            aria-label="返回主屏幕"
            onClick={closeApp}
            className="mb-1 ml-2 mr-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5"
          >
            <ArrowLeft className="h-[21px] w-[21px] text-black/80" strokeWidth={2.3} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-[18px] overflow-x-auto pr-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {feedTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  if (t.id === feedTab) return;
                  // 切频道前先保存当前频道的刷新批次（旧内容永不丢失），再恢复目标频道的持久化状态
                  if (surfaceRef.current) {
                    tbFeedSave(uid, surfaceRef.current, { tops: topsRef.current, batch: batchRef.current, refreshKey: refreshKeyRef.current });
                  }
                  setFeedTab(t.id);
                }}
                className={`relative shrink-0 pb-2 text-[18px] font-semibold transition-colors ${feedTab === t.id ? 'text-[#FF5000]' : 'text-black/85'}`}
              >
                {t.label}
                {t.tag ? <span className="ml-0.5 inline-block rounded-[4px] bg-[#FF0036] px-1 align-[3px] text-[10px] font-bold leading-[14px] text-white">{t.tag}</span> : null}
                {/* 微笑弧（截图1 选中 tab 下方弧线） */}
                {feedTab === t.id ? (
                  <svg viewBox="0 0 26 7" className="absolute bottom-0 left-1/2 h-[6px] w-[26px] -translate-x-1/2" aria-hidden="true">
                    <path d="M2 1.2 Q13 7.6 24 1.2" stroke="#FF5000" strokeWidth="2.4" fill="none" strokeLinecap="round" />
                  </svg>
                ) : null}
              </button>
            ))}
          </div>
        </div>
        {/* 搜索框（白底橙描边胶囊：扫码/占位/相机/橙搜索钮） */}
        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={() => onOpenSearch('')}
            className="flex h-[42px] w-full items-center rounded-full border-[1.6px] border-[#FF5000] bg-white pl-1.5 pr-1"
          >
            <ScanLine className="ml-1 h-[19px] w-[19px] shrink-0 text-[#FF5000]" strokeWidth={2.2} />
            <span className="mx-2 h-4 w-px shrink-0 bg-black/10" />
            <span className="min-w-0 flex-1 truncate text-left text-[14.5px] text-black/85">2026新型蓝牙耳机</span>
            <Camera className="mr-2 h-[19px] w-[19px] shrink-0 text-black/50" strokeWidth={2} />
            <span className="grid h-[34px] shrink-0 place-items-center rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-[18px] text-[15px] font-semibold text-white">搜索</span>
          </button>
        </div>
      </div>

      {/* 商品流滚动区（需求（第十轮）：搜索框以下——运营位图标/页点/双卡/商品流全部跟随滚动；包裹层 relative 用于悬浮刷新指示器定位） */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollerRef}
          className="h-full overflow-y-auto overscroll-contain"
          onScroll={onScroll}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* 运营位图标行（红包签到/淘宝秒杀/领淘金币/阿里拍卖/淘票票/飞猪；彩色 SVG，随列表滚动） */}
          <div className="mt-2.5 grid grid-cols-6 px-2">
            {[
              { icon: <HongbaoIcon />, label: '红包签到', on: () => onOpenPage('signin') },
              { icon: <MiaoshaIcon />, label: '淘宝秒杀', on: () => onOpenPage('seckill') },
              { icon: <TbCoinIcon />, label: '领淘金币', on: () => onToast('领淘金币（演示）') },
              { icon: <PaiIcon />, label: '阿里拍卖', on: () => onToast('阿里拍卖（演示）') },
              { icon: <TicketPiaoIcon />, label: '淘票票', on: () => onOpenPage('movie') },
              { icon: <FliggyIcon />, label: '飞猪', on: () => onOpenPage('fliggy') },
            ].map((it) => (
              <button key={it.label} type="button" onClick={it.on} className="flex flex-col items-center gap-1 py-0.5 active:opacity-70">
                {it.icon}
                <span className="text-[11.5px] text-black/80">{it.label}</span>
              </button>
            ))}
          </div>
          {/* 页点（两页指示） */}
          <div className="mt-1.5 flex justify-center gap-1">
            <span className="h-[3.5px] w-[9px] rounded-full bg-[#FF5000]" />
            <span className="h-[3.5px] w-[9px] rounded-full bg-black/15" />
          </div>
          {/* 运营位双卡：领券中心 / 百亿补贴（第九轮需求：删淘宝直播，领券中心移到原淘宝直播位；百亿补贴进频道页） */}
          <div className="grid grid-cols-2 gap-2 px-2 pt-2.5">
            <button type="button" onClick={onOpenCouponCenter} className="flex flex-col rounded-2xl bg-white p-2.5 text-left active:opacity-80">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-bold text-black/90">领券中心</span>
                <span className="text-[11px] font-black italic text-[#FF2600]">超级88</span>
              </div>
              <div className="mt-2 flex gap-1.5">
                {[
                  { v: 88, label: '消费券' },
                  { v: 50, label: '数码券' },
                ].map((c) => (
                  <span key={c.label} className="flex h-[72px] w-1/2 flex-col items-center justify-center rounded-lg bg-gradient-to-b from-[#FF5A45] to-[#F5222D] ring-1 ring-[#FFD9CC]">
                    <span className="text-[10px] leading-[13px] text-white/85">{c.label}</span>
                    <span className="text-[22px] font-black leading-[26px] text-[#FFE84D]">
                      ¥{c.v}
                    </span>
                    <span className="text-[9px] font-semibold text-white">立即领取</span>
                  </span>
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[12px] font-bold">
                <span className="text-[#FF2600]">大额券天天领</span>
                <span className="text-black/40">已领10.7万</span>
              </div>
            </button>
            <button type="button" onClick={() => onOpenPage('subsidy')} className="flex flex-col rounded-2xl bg-white p-2.5 text-left active:opacity-80">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-bold text-black/90">百亿补贴</span>
                <span className="flex items-center gap-0.5 text-[11px] font-bold text-[#00A860]">
                  <span className="grid h-[12px] w-[12px] place-items-center rounded-full bg-[#00A860]">
                    <Check className="h-2 w-2 text-white" strokeWidth={4} />
                  </span>
                  国家补贴
                </span>
              </div>
              <div className="mt-2 flex gap-1.5">
                {[0, 1].map((i) => (
                  <img key={i} src={tbImg(i === 0 ? 'phone' : 'earbuds', 140, 140, 4)} alt="补贴好物" className="h-[72px] w-1/2 rounded-lg object-cover" draggable={false} />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[12px] font-bold text-[#FF0036]">
                <span>补贴价¥3599</span>
                <span>补贴价¥11</span>
              </div>
            </button>
          </div>

          {/* 推荐商品流（双列瀑布） */}
          {feedTab === 'follow' ? (
            <FollowFeed uid={uid} follows={follows} onOpenProduct={onOpenProduct} onOpenSearch={() => setFeedTab('rec')} />
          ) : (
            <div className="mt-2 flex items-start gap-2 px-2 pb-24">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {feed.filter((_, i) => i % 2 === 0).map(({ p, v, k }) => (
                  <ProductCard key={k} p={p} v={v} onOpen={() => onOpenProduct(p.id)} />
                ))}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {feed.filter((_, i) => i % 2 === 1).map(({ p, v, k }) => (
                  <ProductCard key={k} p={p} v={v} onOpen={() => onOpenProduct(p.id)} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 下拉刷新指示器（悬浮于列表区顶部，不随内容滚动） */}
        {(pullY > 0 || refreshingDir === 'down') && (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-40 grid place-items-center" style={{ transform: `translateY(${pullY - 40}px)` }}>
            <div className={`flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13px] text-black/60 shadow-lg ${refreshingDir === 'down' ? 'animate-pulse' : ''}`}>
              <ScanLine className={`h-4 w-4 text-[#FF5000] ${refreshingDir === 'down' ? 'animate-spin' : ''}`} />
              {refreshingDir === 'down' ? '正在刷新…' : pullY > 40 ? '松开刷新' : '下拉刷新'}
            </div>
          </div>
        )}
        {/* 上拉更新指示器（悬浮于列表区底部；Task 40：上滑也更新，前插保旧不跳顶） */}
        {(pullUpY > 0 || refreshingDir === 'up') && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 z-40 grid place-items-center">
            <div className="flex h-9 items-center gap-2 rounded-full bg-black/55 px-4 text-[13px] text-white shadow-lg">
              <Loader2 className="h-4 w-4 animate-spin text-white/90" />
              {refreshingDir === 'up' ? '正在更新…' : pullUpY > 56 ? '松开更新' : '上拉更新'}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

/** 单个商品卡（瀑布流） */
function ProductCard({ p, v, onOpen }: { p: TbProduct; v: number; onOpen: () => void }) {
  const shop = shopById(p.shopId);
  return (
    <button type="button" onClick={onOpen} className="block w-full overflow-hidden rounded-xl bg-white text-left active:opacity-80">
      <div className="relative">
        <ProductImg p={p} s={v} className="aspect-square w-full" />
        {p.promo ? (
          <span className="absolute left-0 top-0 rounded-br-lg bg-gradient-to-r from-[#FF2D2D] to-[#FF5000] px-1.5 py-0.5 text-[10px] font-bold text-white">{p.promo}</span>
        ) : null}
      </div>
      <div className="p-2">
        <div className="line-clamp-2 min-h-[36px] text-[13px] leading-[18px] text-black/85">{p.title}</div>
        <div className="mt-1.5 flex items-baseline gap-1">
          <Price value={p.price} size={17} />
          {p.originPrice ? <span className="text-[11px] text-black/30 line-through">¥{fmtMoney(p.originPrice)}</span> : null}
          <span className="ml-auto text-[11px] text-black/40">已售{tbSalesText(p.sales)}</span>
        </div>
        <div className="mt-1 flex items-center gap-1 text-[11px] text-black/40">
          {shop.tmall ? <TmallMark /> : null}
          <span className="truncate">{shop.name}</span>
        </div>
      </div>
    </button>
  );
}

/** 关注 feed：关注店铺列表 + 为你推荐店铺 */
function FollowFeed({ uid, follows, onOpenProduct, onOpenSearch }: { uid: string; follows: string[]; onOpenProduct: (pid: string) => void; onOpenSearch: () => void }) {
  const recShops = useMemo(() => {
    const h = uid.length;
    return [...TB_PRODUCTS].slice(0, 40).filter((p, i, arr) => arr.findIndex((x) => x.shopId === p.shopId) === i && !follows.includes(p.shopId)).slice(0, 4).map((p) => shopById(p.shopId));
  }, [uid, follows]);
  return (
    <div className="mt-2 pb-24">
      {follows.length === 0 ? (
        <div className="grid place-items-center bg-white py-14">
          <Heart className="h-12 w-12 text-black/10" strokeWidth={1.6} />
          <div className="mt-3 text-[15px] text-black/45">还没有关注店铺哦</div>
        </div>
      ) : (
        <div className="space-y-2 px-2 pt-2">
          {follows.map((sid) => <ShopRow key={sid} shopId={sid} uid={uid} onOpenProduct={onOpenProduct} />)}
        </div>
      )}
      <div className="mt-3 bg-white px-3 pb-4 pt-3">
        <div className="mb-2 text-[15px] font-semibold text-black/80">为你推荐：</div>
        <div className="space-y-3">
          {recShops.map((s) => (
            <div key={s.id} className="flex items-center gap-3">
              <img src={tbImg(s.tag, 100, 100, 3, 'c')} alt={s.name} className="h-11 w-11 rounded-lg object-cover" draggable={false} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  {s.tmall ? <TmallMark /> : null}
                  <span className="truncate text-[14px] font-medium text-black/85">{s.name}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-black/40">{s.fans}粉丝数</div>
              </div>
              <button type="button" onClick={onOpenSearch} className="rounded-lg bg-[#FF5000] px-3.5 py-1.5 text-[13px] font-medium text-white active:opacity-80">
                进店逛逛
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 视频 tab（截图2 底部第2tab：竖滑短视频流——海报全屏 + 右侧互动栏 + 底部文案 + 播放态 chrome；演示态） */
function VideoPage({ uid, onOpenProduct, onToast }: { uid: string; onOpenProduct: (pid: string) => void; onToast: (m: string) => void }) {
  // 需求（第十轮）：视频页上滑可以刷新——滑到底部继续上拉换一批视频
  // Task 41：更新用「设置 › API 配置」用户配置的模型生成（/api/tb-feed），批次持久化（刷新页面不丢）
  const [vKey, setVKey] = useState(0);
  /** AI/本地兜底前插的视频条目（pid 引用，持久化恢复） */
  const [vTops, setVTops] = useState<TbFeedTop[]>([]);
  const apiConfig = useSettings((s) => s.apiConfig);
  const apiCfgRef = useRef(apiConfig);
  apiCfgRef.current = apiConfig;
  const vSeq = useRef(0);
  // 挂载：恢复持久化的视频批次（每次进视频 tab 都恢复原内容，不重置）
  useEffect(() => {
    const s = tbFeedLoad(uid, 'video');
    setVTops(s?.tops ?? []);
    setVKey(s?.refreshKey ?? 0);
  }, [uid]);
  const vTopsRef = useRef(vTops);
  vTopsRef.current = vTops;
  const vKeyRef = useRef(vKey);
  vKeyRef.current = vKey;
  const vids = useMemo(() => {
    const topEntries = vTops.flatMap((t) => {
      const p = productById(t.pid);
      return p ? [{ p, v: t.v }] : [];
    });
    const arr = [...TB_PRODUCTS];
    const start = (vKey * 3) % arr.length;
    const base = Array.from({ length: 8 }, (_, i) => ({ p: arr[(start + i) % arr.length], v: (i + vKey) % 4 }));
    return [...topEntries, ...base];
  }, [vTops, vKey]);
  const [playing, setPlaying] = useState(true);
  const [vRefreshing, setVRefreshing] = useState(false);
  const vScrollerRef = useRef<HTMLDivElement>(null);
  const vStart = useRef<number | null>(null);
  const vAcc = useRef(0);
  const onVTouchStart = (e: React.TouchEvent) => {
    const el = vScrollerRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
      vStart.current = e.touches[0].clientY;
      vAcc.current = 0;
    } else vStart.current = null;
  };
  const onVTouchMove = (e: React.TouchEvent) => {
    if (vStart.current == null) return;
    const dy = e.touches[0].clientY - vStart.current;
    if (dy < 0) vAcc.current = Math.min(140, -dy);
  };
  const onVTouchEnd = () => {
    if (vAcc.current > 60 && !vRefreshing) {
      setVRefreshing(true);
      const seq = ++vSeq.current;
      // 排除名单：当前已展示视频的宝贝标题
      const exclude = vids.map(({ p }) => p.title).filter(Boolean).slice(0, 60);
      void (async () => {
        const ai = await tbFetchAiBatch({ uid, surface: 'video', exclude, count: 5, config: apiCfgRef.current });
        if (vSeq.current !== seq) return;
        let newTops = vTopsRef.current;
        let newKey = vKeyRef.current;
        if (ai) {
          const ks = `ai${Date.now().toString(36)}`;
          newTops = [...ai.products.map((p, i) => ({ pid: p.id, v: i % 4, k: `${ks}-${i}` })), ...vTopsRef.current];
        } else {
          newKey = vKeyRef.current + 1;
        }
        setVTops(newTops);
        setVKey(newKey);
        tbFeedSave(uid, 'video', { tops: newTops, refreshKey: newKey });
        setVRefreshing(false);
        vScrollerRef.current?.scrollTo({ top: 0 });
        onToast(ai ? '视频已刷新，为你换了新一批' : '视频已刷新，为你换了新一批');
      })();
    }
    vStart.current = null;
    vAcc.current = 0;
  };
  return (
    <div className="relative h-full bg-black">
      <div
        ref={vScrollerRef}
        className="h-full snap-y snap-mandatory overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onTouchStart={onVTouchStart}
        onTouchMove={onVTouchMove}
        onTouchEnd={onVTouchEnd}
      >
        {vids.map(({ p, v }, i) => (
          <div key={`${p.id}-${i}`} className="relative h-full w-full snap-start overflow-hidden" onClick={() => setPlaying((s) => !s)}>
            <img src={tbImg(p.tag, 720, 1280, v)} alt={p.title} className="h-full w-full object-cover" draggable={false} />
            <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 to-transparent" />
            {/* 顶部进度条 */}
            <div className="absolute inset-x-0 top-0 h-[3px] bg-white/20">
              <div className="h-full bg-white/85" style={{ width: `${((i + 1) / vids.length) * 100}%` }} />
            </div>
            {/* 播放/暂停指示 */}
            {!playing ? (
              <span className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/35">
                <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6.5 18 12l-9 5.5v-11Z" fill="#fff" />
                </svg>
              </span>
            ) : null}
            {/* 右侧互动栏 */}
            <div className="absolute bottom-24 right-3 flex flex-col items-center gap-5">
              {[
                { label: '赞', n: '1.2w', d: 'M12 21s-7.5-4.7-9.5-9C1.2 9.3 2.7 6 6 6c2 0 3.2 1 4 2.2C10.8 7 12 6 14 6c3.3 0 4.8 3.3 3.5 6-2 4.3-9.5 9-9.5 9Z' },
                { label: '收藏', n: '3862', d: 'M12 3.5 14.6 9l6 .7-4.4 4.1 1.2 5.9L12 16.8l-5.4 2.9 1.2-5.9L3.4 9.7l6-.7L12 3.5Z' },
                { label: '评论', n: '428', d: 'M12 3.5c5 0 9 3.4 9 7.6 0 4.2-4 7.6-9 7.6-.9 0-1.8-.1-2.6-.3L5 20.6l.2-3.3C3.6 16 3 14.1 3 11.1c0-4.2 4-7.6 9-7.6Z' },
                { label: '分享', n: '256', d: 'M14 5.5 21 12l-7 6.5v-4C8 14.5 5 16.5 3 20c0-6 4-9.8 11-10.4v-4.1Z' },
              ].map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToast(`${a.label}（演示）`);
                  }}
                  className="flex flex-col items-center gap-1 active:opacity-70"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 backdrop-blur">
                    <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true">
                      <path d={a.d} fill="#fff" />
                    </svg>
                  </span>
                  <span className="text-[10.5px] text-white/90">{a.n}</span>
                </button>
              ))}
            </div>
            {/* 底部文案 */}
            <div className="absolute inset-x-0 bottom-0 p-4 pb-9" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => onOpenProduct(p.id)} className="flex items-center gap-1.5 active:opacity-80">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-white/20 text-[10px] font-bold text-white">店</span>
                <span className="text-[13.5px] font-medium text-white/95">{shopById(p.shopId).name}</span>
                <span className="rounded-full border border-white/60 px-2 py-px text-[11px] text-white">进店</span>
              </button>
              <div className="mt-1.5 line-clamp-2 text-[13.5px] leading-5 text-white/95">{p.title}</div>
            </div>
          </div>
        ))}
      </div>
      {/* 上滑刷新指示器（需求第十轮：到底继续上拉刷新视频流） */}
      {vRefreshing ? (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-40 grid place-items-center">
          <div className="flex h-9 items-center gap-2 rounded-full bg-white/15 px-4 text-[13px] text-white backdrop-blur">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在刷新…
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 关注店铺行（含在售商品 4 格） */
function ShopRow({ shopId, uid, onOpenProduct }: { shopId: string; uid: string; onOpenProduct: (pid: string) => void }) {
  const shop = shopById(shopId);
  const goods = TB_PRODUCTS.filter((p) => p.shopId === shopId).slice(0, 4);
  const followed = tbLoadShopFollows(uid).includes(shopId);
  return (
    <div className="rounded-xl bg-white p-3">
      <div className="flex items-center gap-3">
        <img src={tbImg(shop.tag, 100, 100, 0, 'c')} alt={shop.name} className="h-12 w-12 rounded-lg object-cover" draggable={false} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {shop.tmall ? <TmallMark /> : null}
            <span className="truncate text-[15px] font-semibold text-black/85">{shop.name}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-black/40">评分 {shop.rating} · {shop.fans}粉丝数</div>
        </div>
        <button
          type="button"
          onClick={() => tbToggleShopFollow(uid, shopId)}
          className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium ${followed ? 'bg-black/[0.06] text-black/50' : 'bg-[#FF5000] text-white'} active:opacity-80`}
        >
          {followed ? '已关注' : '关注'}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {goods.map((p, i) => (
          <button key={p.id} type="button" onClick={() => onOpenProduct(p.id)} className="active:opacity-70">
            <ProductImg p={p} s={(i + 1) % 4} className="aspect-square w-full rounded-lg" />
            <div className="mt-1 text-left">
              <Price value={p.price} size={13} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- 搜索页（历史 + 热门） ----------------

function SearchPage({ uid, onBack, onSearch }: { uid: string; onBack: () => void; onSearch: (kw: string) => void }) {
  const [kw, setKw] = useState('');
  const [hist, setHist] = useState<string[]>(() => tbLoadSearchHist(uid));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const go = (k: string) => {
    const key = k.trim();
    if (!key) return;
    tbPushSearchHist(uid, key);
    onSearch(key);
  };
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 px-3 pb-2 pt-[58px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ArrowLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
        </button>
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-black/[0.05] px-3">
          <Search className="h-[17px] w-[17px] shrink-0 text-black/35" />
          <input
            ref={inputRef}
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go(kw);
            }}
            placeholder="搜索淘宝好物"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30"
          />
          {kw ? (
            <button type="button" aria-label="清空" onClick={() => setKw('')} className="grid h-5 w-5 place-items-center rounded-full bg-black/20 text-white">
              <X className="h-3 w-3" strokeWidth={3} />
            </button>
          ) : null}
        </div>
        <button type="button" onClick={() => go(kw)} className="shrink-0 text-[15px] font-medium text-[#FF5000] active:opacity-60">
          搜索
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {hist.length > 0 ? (
          <div className="mt-3">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold text-black/80">搜索历史</span>
              <button
                type="button"
                onClick={() => {
                  tbClearSearchHist(uid);
                  setHist([]);
                }}
                className="flex items-center gap-1 text-[12px] text-black/40 active:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" />
                清空
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {hist.map((h) => (
                <button key={h} type="button" onClick={() => go(h)} className="rounded-lg bg-black/[0.04] px-3 py-1.5 text-[13px] text-black/70 active:bg-black/[0.08]">
                  {h}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-5">
          <span className="text-[15px] font-semibold text-black/80">热门搜索</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {TB_HOT_SEARCHES.map((h, i) => (
              <button
                key={h}
                type="button"
                onClick={() => go(h)}
                className={`rounded-lg px-3 py-1.5 text-[13px] active:opacity-70 ${i < 2 ? 'bg-[#FF5000]/[0.08] font-medium text-[#FF5000]' : 'bg-black/[0.04] text-black/70'}`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-6 rounded-xl bg-black/[0.03] p-3 text-[12px] leading-5 text-black/40">
          搜索小贴士：支持商品标题、店铺名、分类关键词；点击历史词可直接复搜；热门词实时更新。
        </div>
      </div>
    </div>
  );
}

// ---------------- 搜索结果页（筛选 + 排序） ----------------

type SortMode = 'rec' | 'sales' | 'priceAsc' | 'priceDesc';

function SearchResultPage({ kw, onBack, onOpenProduct, onSearchSeed }: { kw: string; onBack: () => void; onOpenProduct: (pid: string) => void; onSearchSeed: (kw: string) => void }) {
  const [input, setInput] = useState(kw);
  const [sort, setSort] = useState<SortMode>('rec');
  const [onlyFree, setOnlyFree] = useState(false);
  const [onlyTmall, setOnlyTmall] = useState(false);
  const [batch, setBatch] = useState(1);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const hits = useMemo(() => {
    let list = TB_PRODUCTS.map((p) => ({ p, s: tbSearchScore(p, kw) })).filter((x) => x.s > 0);
    if (onlyFree) list = list.filter((x) => x.p.freight === 0);
    if (onlyTmall) list = list.filter((x) => shopById(x.p.shopId).tmall);
    if (sort === 'sales') list.sort((a, b) => b.p.sales - a.p.sales);
    else if (sort === 'priceAsc') list.sort((a, b) => a.p.price - b.p.price);
    else if (sort === 'priceDesc') list.sort((a, b) => b.p.price - a.p.price);
    else list.sort((a, b) => b.s - a.s || b.p.sales - a.p.sales);
    return list.map((x) => x.p);
  }, [kw, sort, onlyFree, onlyTmall]);

  const shown = useMemo(() => {
    const n = Math.min(hits.length, 10 + batch * 8);
    return hits.slice(0, n);
  }, [hits, batch]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 400) setBatch((b) => (b < 20 ? b + 1 : b));
  }, []);

  const sortBtn = (id: SortMode, label: string, arrow?: 'up' | 'down') => (
    <button
      type="button"
      onClick={() => setSort(id)}
      className={`flex items-center gap-0.5 text-[14px] ${sort === id ? 'font-semibold text-[#FF5000]' : 'text-black/60'}`}
    >
      {label}
      {arrow ? (
        <svg viewBox="0 0 10 14" className="h-3 w-2" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path d="M2 5l3-3 3 3" opacity={arrow === 'up' ? 1 : 0.3} />
          <path d="M2 9l3 3 3-3" opacity={arrow === 'down' ? 1 : 0.3} />
        </svg>
      ) : null}
    </button>
  );

  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <div className="sticky top-0 z-30 bg-white pb-2 pt-[58px]">
        <div className="flex items-center gap-2 px-3">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ArrowLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
          </button>
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-black/[0.05] px-3">
            <Search className="h-[17px] w-[17px] shrink-0 text-black/35" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && input.trim()) {
                  tbPushSearchHist(tbGetSession() ? tbUidOf(tbGetSession()!) : '', input.trim());
                  onSearchSeed(input.trim());
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => input.trim() && onSearchSeed(input.trim())}
            className="shrink-0 text-[15px] font-medium text-[#FF5000] active:opacity-60"
          >
            搜索
          </button>
        </div>
        {/* 排序 + 筛选 */}
        <div className="mt-2 flex items-center gap-4 px-4">
          {sortBtn('rec', '综合')}
          {sortBtn('sales', '销量')}
          {sortBtn('priceAsc', '价格', 'up')}
          {sortBtn('priceDesc', '价格', 'down')}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setOnlyFree((v) => !v)}
            className={`rounded-lg px-2.5 py-1 text-[12px] ${onlyFree ? 'bg-[#FF5000] font-medium text-white' : 'bg-black/[0.05] text-black/60'}`}
          >
            包邮
          </button>
          <button
            type="button"
            onClick={() => setOnlyTmall((v) => !v)}
            className={`rounded-lg px-2.5 py-1 text-[12px] ${onlyTmall ? 'bg-[#FF0036] font-medium text-white' : 'bg-black/[0.05] text-black/60'}`}
          >
            天猫
          </button>
        </div>
      </div>
      <div ref={scrollerRef} className="flex-1 overflow-y-auto" onScroll={onScroll}>
        {shown.length === 0 ? (
          <div className="grid place-items-center bg-white py-16">
            <Search className="h-12 w-12 text-black/10" strokeWidth={1.6} />
            <div className="mt-3 text-[15px] text-black/45">没有找到与「{kw}」相关的商品</div>
            <button type="button" onClick={onBack} className="mt-4 rounded-lg bg-[#FF5000] px-5 py-2 text-[14px] font-medium text-white active:opacity-80">
              重新搜索
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2 px-2 pt-2">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {shown.filter((_, i) => i % 2 === 0).map((p, i) => (
                  <ProductCard key={`${p.id}-${i}`} p={p} v={i % 4} onOpen={() => onOpenProduct(p.id)} />
                ))}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {shown.filter((_, i) => i % 2 === 1).map((p, i) => (
                  <ProductCard key={`${p.id}-${i}`} p={p} v={(i + 1) % 4} onOpen={() => onOpenProduct(p.id)} />
                ))}
              </div>
            </div>
            {shown.length < hits.length ? <div className="py-3 text-center text-[12px] text-black/35">上滑加载更多…</div> : <div className="py-3 text-center text-[12px] text-black/35">已经到底啦</div>}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- 商品详情 ----------------

/** 商品图片轮播（横向 snap + 页码指示） */
function ProductGallery({ p }: { p: TbProduct }) {
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const total = 4;
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setIdx(Math.min(total - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
  };
  return (
    <div className="relative bg-white">
      <div ref={ref} className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" onScroll={onScroll}>
        {Array.from({ length: total }, (_, i) => (
          <div key={i} className="w-full shrink-0 snap-center">
            <ProductImg p={p} w={750} h={750} s={i} className="aspect-square w-full" />
          </div>
        ))}
      </div>
      <div className="absolute bottom-3 right-3 rounded-full bg-black/45 px-2.5 py-0.5 text-[12px] text-white">
        {idx + 1}/{total}
      </div>
    </div>
  );
}

/** SKU 选择弹层（颜色分类 / 尺码等 + 数量 + 确定） */
/** 购买弹窗（截图9：地址行 + 实付/优惠前 + 颜色缩略图/尺码价格 + 顺手买 + 支付单选 + 立即支付） */
function SkuSheet({
  p,
  uid,
  onClose,
  onConfirm,
  mode,
}: {
  p: TbProduct;
  uid: string;
  onClose: () => void;
  onConfirm: (sku: Record<string, string>, qty: number, addonPid?: string) => void;
  mode: 'cart' | 'buy';
}) {
  const [sel, setSel] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const g of p.skus) {
      const first = g.options.find((o) => !o.soldOut);
      if (first) init[g.name] = first.label;
    }
    return init;
  });
  const [qty, setQty] = useState(1);
  const [addonSel, setAddonSel] = useState(false);
  const [addonIdx, setAddonIdx] = useState(0);
  const [remarkOpen, setRemarkOpen] = useState(false);
  /** 地址切换（需求：点击地址可以切换添加的地址） */
  const [addrPickerOpen, setAddrPickerOpen] = useState(false);
  const [, setAddrTick] = useState(0);
  const price = useMemo(() => {
    let v = p.price;
    for (const g of p.skus) {
      const o = g.options.find((x) => x.label === sel[g.name]);
      if (o?.priceDelta) v += o.priceDelta;
    }
    return Math.round(v * 100) / 100;
  }, [p, sel]);
  const skuImg = useMemo(() => {
    for (const g of p.skus) {
      const o = g.options.find((x) => x.label === sel[g.name]);
      if (o?.img) return o.img;
    }
    return tbImg(p.tag, 200, 200, 0);
  }, [p, sel]);
  const ready = p.skus.every((g) => sel[g.name]);
  const addr = tbCurAddr(uid);
  const addonPool = useMemo(() => {
    const h = tbHash(p.id);
    const list = TB_PRODUCTS.filter((x) => x.id !== p.id);
    return [list[h % list.length], list[(h + 7) % list.length], list[(h + 13) % list.length]].filter(Boolean);
  }, [p.id]);
  const addon = addonPool.length ? addonPool[addonIdx % addonPool.length] : null;
  const totalPrice = Math.round((price + (addonSel && addon ? addon.price : 0)) * 100) / 100;
  const etaDate = (() => {
    const d = new Date(Date.now() + 3 * 86_400_000);
    return `预计${d.getMonth() + 1}月${d.getDate()}日送达`;
  })();
  const sizeGroup = p.skus.find((g) => g.name === '尺码');
  const sizeGuide = sizeGroup ? { h: 165 + (tbHash(p.id) % 15), w: 55 + (tbHash(`${p.id}w`) % 25), shoulder: 42 + (tbHash(`${p.id}s`) % 8), chest: 108 + (tbHash(`${p.id}c`) % 16) } : null;
  const discount = p.originPrice ? Math.round((p.originPrice - price) * 100) / 100 : 0;
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div className="flex max-h-[82%] flex-col rounded-t-2xl bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {/* 地址行（截图9头部；需求：删铅笔图标，点击地址切换收货地址） */}
          <div className="px-4 pb-2 pt-3">
            <button
              type="button"
              onClick={() => setAddrPickerOpen(true)}
              className="flex w-full items-center gap-1.5 text-left active:opacity-70"
            >
              <MapPin className="h-4 w-4 shrink-0 text-black/75" strokeWidth={2.1} />
              <span className="min-w-0 truncate text-[14.5px] font-semibold text-black/85">{addr ? `${addr.name} ${tbFullAddr(addr)}` : '请选择收货地址'}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/25" />
            </button>
            <div className="mt-1 flex items-center gap-2 pl-5.5 text-[12px]">
              <span className="text-[#00A860]">{etaDate}</span>
              <span className="h-3 w-px bg-black/10" />
              <span className="text-black/55">快递 {p.freight === 0 ? '包邮' : `¥${fmtMoney(p.freight)}`}</span>
              <span className="h-3 w-px bg-black/10" />
              <span className="text-black/40">退货宝</span>
            </div>
          </div>
          {/* 商品头：图 + 实付/优惠前 + 步进 */}
          <div className="flex gap-3 px-4 pb-1 pt-2">
            <img src={skuImg} alt={p.title} className="h-[88px] w-[88px] shrink-0 rounded-lg object-cover" draggable={false} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[12px] text-black/45">实付</span>
                <span className="text-[24px] font-bold leading-none text-[#FF4400]">
                  <span className="text-[14px]">¥</span>
                  {fmtMoney(price)}
                </span>
                {p.originPrice ? <span className="text-[12px] text-black/35">| 优惠前 ¥{fmtMoney(p.originPrice)}</span> : null}
              </div>
              {discount > 0 ? (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="text-[11.5px] text-[#FF4400]">共减 ¥{fmtMoney(discount)} {'>'}</span>
                  <span className="rounded border border-[#FF6A1E]/40 px-1 py-px text-[10px] text-[#FF6A1E]">官方立减{fmtMoney(discount)}元</span>
                </div>
              ) : (
                <div className="mt-1.5 text-[12px] text-black/40">已售{tbSalesText(p.sales)}</div>
              )}
              <div className="mt-2 flex justify-end">
                <div className="flex items-center rounded-md border border-black/12">
                  <button type="button" aria-label="减少" onClick={() => setQty((q) => Math.max(1, q - 1))} className="grid h-8 w-9 place-items-center border-r border-black/10 text-black/60 active:opacity-60">
                    <Minus className="h-3.5 w-3.5" strokeWidth={2.6} />
                  </button>
                  <span className="min-w-[34px] text-center text-[14px] font-medium">{qty}</span>
                  <button type="button" aria-label="增加" onClick={() => setQty((q) => Math.min(99, q + 1))} className="grid h-8 w-9 place-items-center border-l border-black/10 text-black/60 active:opacity-60">
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
                  </button>
                </div>
              </div>
            </div>
          </div>
          {/* 规格组 */}
          {p.skus.map((g, gi) => (
            <div key={g.name} className="px-4 pb-1 pt-3">
              <div className="flex items-center">
                <span className="text-[15.5px] font-semibold text-black/85">
                  {g.name}
                  {g.name === '尺码' ? null : `（${g.options.length}）`}
                </span>
                {g.name === '尺码' ? (
                  <span className="ml-2 text-[12px] text-black/40">
                    96%买家认为尺码标准 推荐<span className="mx-0.5 font-medium text-[#FF4400]">{sizeGroup?.options[Math.min(2, sizeGroup.options.length - 1)]?.label ?? 'M'}</span>
                  </span>
                ) : null}
                {g.name === '尺码' ? (
                  <button type="button" onClick={onClose} className="ml-auto text-[12px] text-black/40 active:opacity-60">
                    创建档案 {'>'}
                  </button>
                ) : (
                  <span className="ml-auto flex items-center gap-1 text-[12px] text-black/40">
                    <LayoutGrid className="h-3.5 w-3.5" />
                    大图
                  </span>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2.5">
                {g.options.map((o) => {
                  const active = sel[g.name] === o.label;
                  const optPrice = Math.round((p.price + (o.priceDelta ?? 0)) * 100) / 100;
                  if (g.name === '尺码') {
                    return (
                      <button
                        key={o.label}
                        type="button"
                        disabled={o.soldOut}
                        onClick={() => setSel((s) => ({ ...s, [g.name]: o.label }))}
                        className={`min-w-[68px] rounded-lg border px-3 py-2 text-center text-[14px] ${
                          o.soldOut ? 'border-black/[0.06] text-black/25' : active ? 'border-[#FF5000] font-medium text-[#FF5000]' : 'border-black/[0.12] text-black/75'
                        }`}
                      >
                        {o.label} <span className={`text-[11.5px] ${active ? 'text-[#FF5000]/80' : 'text-black/35'}`}>¥{fmtMoney(optPrice)}</span>
                      </button>
                    );
                  }
                  return (
                    <button
                      key={o.label}
                      type="button"
                      disabled={o.soldOut}
                      onClick={() => setSel((s) => ({ ...s, [g.name]: o.label }))}
                      className={`relative flex items-center gap-1.5 rounded-lg border py-1 pl-1 pr-3 text-[13px] ${o.soldOut ? 'border-black/[0.06] text-black/25' : active ? 'border-[#FF5000] bg-[#FF5000]/[0.04] font-medium text-[#FF5000]' : 'border-black/[0.12] text-black/75'}`}
                    >
                      {o.soldOut ? <span className="absolute -top-2 right-1 rounded bg-black/25 px-1 text-[9px] leading-[14px] text-white">缺货</span> : null}
                      {o.img ? <img src={o.img} alt={o.label} className={`h-9 w-9 rounded-md object-cover ${o.soldOut ? 'opacity-40 grayscale' : ''}`} draggable={false} /> : null}
                      <span className="max-w-[150px] truncate">{o.label}</span>
                      {o.priceDelta ? <span className="text-[11px] opacity-70">+{o.priceDelta}</span> : null}
                    </button>
                  );
                })}
              </div>
              {/* 尺码辅助条 */}
              {g.name === '尺码' && sizeGuide ? (
                <button type="button" onClick={onClose} className="mt-2.5 flex w-full items-center gap-2 rounded-lg bg-[#EDEEF0] px-3 py-2 text-left active:opacity-80">
                  <span className="truncate text-[12.5px] text-black/65">
                    适合身高体重: {sizeGuide.h}cm/{sizeGuide.w}kg&nbsp;&nbsp;肩宽: {sizeGuide.shoulder}cm&nbsp;&nbsp;胸围: {sizeGuide.chest}cm
                  </span>
                  <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-black/35" />
                </button>
              ) : null}
            </div>
          ))}
          {/* 备注/发票折叠 */}
          <div className="px-4 pt-3">
            <button type="button" onClick={() => setRemarkOpen((v) => !v)} className="flex w-full items-center border-t border-black/[0.05] pt-3 text-[13.5px]">
              <span className="text-black/70">备注 · 发票已折叠</span>
              <span className="ml-auto flex items-center text-black/40">
                展开详情
                <ChevronDown className={`h-4 w-4 transition-transform ${remarkOpen ? 'rotate-180' : ''}`} />
              </span>
            </button>
            {remarkOpen ? (
              <div className="mt-2 space-y-1.5 rounded-lg bg-black/[0.03] p-3 text-[12.5px] text-black/55">
                <div>发票抬头：不开发票</div>
                <div>订单备注：暂无备注</div>
              </div>
            ) : null}
          </div>
          {/* 顺手买（截图9中部） */}
          {addon ? (
            <div className="mt-3 bg-[#F7F8FA] px-4 py-3">
              <div className="flex items-center">
                <span className="text-[15px] font-semibold text-black/85">顺手买 · {shopById(addon.shopId).name.slice(0, 6)}</span>
                <button
                  type="button"
                  onClick={() => setAddonIdx((i) => i + 1)}
                  className="ml-auto flex items-center text-[13px] text-black/45 active:opacity-60"
                >
                  换一换
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2 flex gap-2.5">
                <img src={tbImg(addon.tag, 200, 200, 0)} alt={addon.title} className="h-16 w-16 shrink-0 rounded-lg object-cover" draggable={false} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 text-[13.5px] font-medium text-black/85">{addon.title}</div>
                  <div className="mt-0.5 truncate text-[12px] text-black/40">{addon.tags[0] ?? '正品保障'} | 已售{tbSalesText(addon.sales)}</div>
                  <div className="mt-0.5 flex items-baseline gap-1">
                    <span className="text-[15px] font-bold text-[#FF4400]">¥{fmtMoney(addon.price)}</span>
                    {addon.originPrice ? <span className="text-[11px] text-black/30 line-through">¥{fmtMoney(addon.originPrice)}</span> : null}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="顺手买勾选"
                  onClick={() => setAddonSel((v) => !v)}
                  className={`ml-1 grid h-[20px] w-[20px] shrink-0 self-center place-items-center rounded-full ${addonSel ? 'bg-[#FF5000]' : 'border border-black/20 bg-white'}`}
                >
                  {addonSel ? <Check className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
                </button>
              </div>
            </div>
          ) : null}
          </div>
          {/* 底部按钮 */}
          <div className="border-t border-black/[0.05] px-4 pb-7 pt-2.5">
            {mode === 'buy' ? <div className="mb-1 text-right text-[11px] text-[#FF4400]">热卖中，库存充足</div> : null}
            <button
              type="button"
              disabled={!ready}
              onClick={() => ready && onConfirm(sel, qty, addonSel && addon ? addon.id : undefined)}
              className="h-12 w-full rounded-xl bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[16px] font-semibold text-white active:opacity-85 disabled:opacity-50"
            >
              {mode === 'cart' ? '加入购物车' : `立即支付 ¥${fmtMoney(totalPrice)}`}
            </button>
          </div>
      </div>
      {/* 地址切换弹层（需求：点击地址可切换添加的地址） */}
      {addrPickerOpen ? (
        <AddrPickerSheet
          uid={uid}
          onClose={() => {
            setAddrPickerOpen(false);
            setAddrTick((n) => n + 1);
          }}
          onManage={() => {
            setAddrPickerOpen(false);
            onClose();
          }}
        />
      ) : null}
    </div>
  );
}
/** 评价页（全部评价：种子 + 订单晒单聚合） */
function ReviewsPage({ p, uid, onBack }: { p: TbProduct; uid: string; onBack: () => void }) {
  const seeds = tbReviewsOf(p.id);
  const orderReviews = useMemo(() => {
    const s = tbGetSession();
    if (!s) return [];
    return tbLoadOrders(uid)
      .filter((o) => o.review && o.items.some((it) => it.pid === p.id))
      .map((o) => ({ user: '我', rating: o.review!.rating, content: o.review!.content, daysAgo: 0, sku: Object.entries(o.items.find((it) => it.pid === p.id)!.sku).map(([k, v]) => `${k}：${v}`).join('；'), reply: undefined as string | undefined }));
  }, [p.id, uid]);
  const all = [...orderReviews, ...seeds.map((r) => ({ ...r, sku: r.sku ?? '' , reply: r.reply })) as { user: string; rating: number; content: string; daysAgo: number; sku: string; reply?: string }[]];
  return (
    <div className="flex h-full flex-col bg-white">
      <TopBar title={`全部评价(${all.length})`} onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {all.map((r, i) => (
          <div key={i} className="border-b border-black/[0.05] py-4 last:border-0">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[#FF5000]/10 text-[13px] font-bold text-[#FF5000]">{r.user.slice(0, 1)}</span>
              <span className="text-[14px] font-medium text-black/80">{r.user}</span>
              <span className="ml-auto flex gap-0.5">
                {Array.from({ length: 5 }, (_, si) => (
                  <Star key={si} className={`h-3.5 w-3.5 ${si < r.rating ? 'fill-[#FFA400] text-[#FFA400]' : 'fill-black/10 text-black/10'}`} />
                ))}
              </span>
            </div>
            <div className="mt-2 text-[14px] leading-6 text-black/75">{r.content}</div>
            {r.sku ? <div className="mt-1 text-[12px] text-black/35">{r.sku} · {r.daysAgo}天前</div> : <div className="mt-1 text-[12px] text-black/35">{r.daysAgo}天前</div>}
            {r.reply ? <div className="mt-2 rounded-lg bg-black/[0.03] p-2.5 text-[13px] text-black/60">商家回复：{r.reply}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 商品详情页 */
function ProductPage({
  pid,
  uid,
  onBack,
  onToast,
  onCartChanged,
  onOpenShop,
  onOpenCheckout,
  onOpenReviews,
  onOpenChat,
}: {
  pid: string;
  uid: string;
  onBack: () => void;
  onToast: (m: string) => void;
  onCartChanged: () => void;
  onOpenShop: (shopId: string) => void;
  onOpenCheckout: (items: TbOrderItem[]) => void;
  onOpenReviews: () => void;
  /** 联系客服（Task 41：带商品上下文进 AI 客服聊天） */
  onOpenChat: (shopId: string, pid: string) => void;
}) {
  const p = productById(pid);
  const [faved, setFaved] = useState(() => tbLoadFavs(uid).includes(pid));
  const [skuMode, setSkuMode] = useState<'cart' | 'buy' | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // 收藏人数（确定性，展示用；收藏后数字橙色高亮）
  const favCount = String(1000 + (tbHash(`${pid}fav`) % 9000));
  // 预计送达日期（与 SkuSheet 同口径：3 天后）
  const etaDate = (() => {
    const d = new Date(Date.now() + 3 * 86_400_000);
    return `${d.getMonth() + 1}月${d.getDate()}日送达`;
  })();
  if (!p) {
    return (
      <div className="grid h-full place-items-center bg-white">
        <div className="text-[15px] text-black/40">商品不存在或已下架</div>
      </div>
    );
  }
  const shop = shopById(p.shopId);
  const openSku = (mode: 'cart' | 'buy') => {
    // 足迹：浏览商品详情即记录
    tbPushFoot(uid, p.id);
    setSkuMode(mode);
  };
  const confirmSku = (sku: Record<string, string>, qty: number, addonPid?: string) => {
    const addonItem = (() => {
      if (!addonPid) return null;
      const ap = productById(addonPid);
      if (!ap) return null;
      return { pid: ap.id, title: ap.title, img: tbImg(ap.tag, 300, 300, 0), sku: {} as Record<string, string>, price: ap.price, qty: 1 };
    })();
    if (skuMode === 'cart') {
      tbAddToCart(uid, p.id, sku, qty);
      if (addonItem) tbAddToCart(uid, addonItem.pid, addonItem.sku, addonItem.qty);
      onCartChanged();
      setSkuMode(null);
      onToast('已加入购物车');
    } else {
      setSkuMode(null);
      const items = [{ pid: p.id, title: p.title, img: tbImg(p.tag, 300, 300, 0), sku, price: skuPriceOf(p, sku), qty }];
      if (addonItem) items.push(addonItem);
      onOpenCheckout(items);
    }
  };
  return (
    <div className="relative flex h-full flex-col bg-[#f4f4f4]">
      <div className="absolute left-3 top-[58px] z-30 flex gap-1.5">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-white/90 shadow-sm active:opacity-70">
          <ArrowLeft className="h-[20px] w-[20px] text-black/75" strokeWidth={2.2} />
        </button>
      </div>
      <div ref={scrollerRef} className="flex-1 overflow-y-auto pb-24">
        <ProductGallery p={p} />
        {/* SKU 快选条 */}
        <div className="flex gap-2 overflow-x-auto bg-white px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(p.skus[0]?.options ?? []).slice(0, 4).map((o, i) => (
            <button
              key={o.label}
              type="button"
              disabled={o.soldOut}
              onClick={() => openSku('cart')}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-1.5 py-1 text-[12px] ${o.soldOut ? 'border-black/[0.06] text-black/25' : i === 0 ? 'border-[#FF5000] bg-[#FF5000]/[0.05] text-black/80' : 'border-black/10 text-black/70'}`}
            >
              {o.img ? <img src={o.img} alt={o.label} className="h-8 w-8 rounded object-cover" draggable={false} /> : null}
              <span className="max-w-[96px] truncate">{o.label}</span>
              {o.soldOut ? <span className="text-[10px]">缺货</span> : null}
            </button>
          ))}
          <button type="button" onClick={() => openSku('cart')} className="ml-auto flex shrink-0 items-center gap-0.5 text-[12px] text-black/40">
            全部
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* 价格区 */}
        <div className="bg-gradient-to-r from-[#FF2D2D] to-[#FF5000] px-4 py-3 text-white">
          <div className="flex items-end gap-2">
            <span className="text-[13px] text-white/85">超级88</span>
            <span className="text-[26px] font-bold leading-none">
              <span className="text-[15px]">¥</span>
              {fmtMoney(skuPriceOf(p, {}))}
            </span>
            {p.originPrice ? <span className="pb-0.5 text-[13px] text-white/70">| 优惠前¥{fmtMoney(p.originPrice)}</span> : null}
            <span className="ml-auto pb-0.5 text-[12px] text-white/85">已售 {tbSalesText(p.sales)}</span>
          </div>
          <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px]">
            <Bell className="h-3 w-3" />
            官方立减 {fmtMoney(Math.round((p.originPrice ? p.originPrice - p.price : 0) * 100) / 100)}元
          </div>
        </div>
        {/* 标题 + 标签 */}
        <div className="bg-white px-4 py-3">
          <div className="flex gap-2">
            {shop.tmall ? <TmallMark /> : <span className="mr-1 inline-block rounded-[3px] bg-[#FF5000] px-1 py-[1px] align-[2px] text-[10px] font-bold leading-none text-white">淘宝</span>}
            <div className="text-[16px] font-medium leading-6 text-black/90">{p.title}</div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.tags.map((t) => (
              <span key={t} className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] text-black/55">{t}</span>
            ))}
          </div>
          {p.coupon ? (
            <button type="button" onClick={() => onToast(`已领店铺券：满${p.coupon!.min > 0 ? p.coupon!.min : '0'}减${p.coupon!.amount}元`)} className="mt-2 flex items-center gap-2 rounded-lg bg-[#FFF1E8] px-2.5 py-1.5 text-left active:opacity-80">
              <Ticket className="h-4 w-4 text-[#FF5000]" />
              <span className="text-[12px] font-medium text-[#FF5000]">领券立减{p.coupon.amount}元{p.coupon.min > 0 ? `（满${p.coupon.min}可用）` : ''}</span>
              <ChevronRight className="ml-auto h-3.5 w-3.5 text-[#FF5000]" />
            </button>
          ) : null}
          <button type="button" onClick={() => openSku('cart')} className="mt-3 flex w-full items-center justify-between rounded-lg bg-black/[0.03] px-3 py-2.5 active:opacity-70">
            <span className="text-[13px] text-black/60">选择：{p.skus.map((g) => g.name).join(' / ')}{p.skus.length === 0 ? '默认规格' : ''}</span>
            <ChevronRight className="h-4 w-4 text-black/30" />
          </button>
        </div>
        {/* 店铺卡 */}
        <button type="button" onClick={() => onOpenShop(shop.id)} className="mt-2 flex w-full items-center gap-3 bg-white px-4 py-3 text-left active:opacity-80">
          <img src={tbImg(shop.tag, 120, 120, 0, 'c')} alt={shop.name} className="h-11 w-11 rounded-lg object-cover" draggable={false} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              {shop.tmall ? <TmallMark /> : null}
              <span className="truncate text-[15px] font-semibold text-black/85">{shop.name}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-black/40">店铺评分 {shop.rating} · {shop.fans}粉丝数{shop.desc ? ` · ${shop.desc}` : ''}</div>
          </div>
          <span className="rounded-full border border-black/10 px-3 py-1.5 text-[12px] text-black/60">进店</span>
        </button>
        {/* 评价 */}
        <div className="mt-2 bg-white px-4 py-3">
          <button type="button" onClick={onOpenReviews} className="flex w-full items-center justify-between">
            <span className="text-[15px] font-semibold text-black/85">宝贝评价（{tbReviewsOf(p.id).length * 3300 + p.sales % 900}+）</span>
            <span className="flex items-center text-[13px] text-[#FF5000]">
              查看全部
              <ChevronRight className="h-4 w-4" />
            </span>
          </button>
          <div className="mt-2 space-y-3">
            {tbReviewsOf(p.id).slice(0, 2).map((r, i) => (
              <div key={i}>
                <div className="flex items-center gap-1.5 text-[12px] text-black/45">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-black/[0.06] text-[10px]">{r.user.slice(0, 1)}</span>
                  {r.user}
                  <span className="ml-auto flex gap-0.5">
                    {Array.from({ length: 5 }, (_, si) => (
                      <Star key={si} className={`h-3 w-3 ${si < r.rating ? 'fill-[#FFA400] text-[#FFA400]' : 'fill-black/10 text-black/10'}`} />
                    ))}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-[13px] leading-5 text-black/70">{r.content}</div>
              </div>
            ))}
          </div>
        </div>
        {/* 图文详情 */}
        <div className="mt-2 bg-white px-4 py-4">
          <div className="mb-2 text-center text-[14px] font-semibold text-black/70">—— 商品详情 ——</div>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <img key={i} src={tbImg(p.tag, 750, 560, i)} alt={`${p.title} 详情图${i}`} className="w-full rounded-lg object-cover" draggable={false} />
            ))}
          </div>
          <div className="mt-3 space-y-1.5 text-[12px] leading-5 text-black/45">
            <div>· 品牌名称：{shop.name}</div>
            <div>· 商品名称：{p.title}</div>
            <div>· 服务保障：{p.tags.join(' / ')}</div>
            <div>· 发货地：浙江杭州 · 快递：{p.freight === 0 ? '免运费' : `¥${fmtMoney(p.freight)}`}</div>
          </div>
        </div>
        {/* 预计送达行（截图1：绿字卡车 + 预计X月X日送达） */}
        <div className="mt-2 flex items-center gap-2 bg-white px-4 py-4">
          <Truck className="h-5 w-5 shrink-0 text-black/80" strokeWidth={2} />
          <span className="text-[16px] font-semibold text-[#00B578]">预计{etaDate}</span>
          <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-black/25" />
        </div>
      </div>

      {/* 底部操作栏（截图1：店铺/客服/收藏数 + 黄色加入购物车 + 橙色领券购买，方形圆角） */}
      <div className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-1 border-t border-black/[0.06] bg-white/95 px-3 pb-6 pt-2 backdrop-blur-md">
        <button type="button" onClick={() => onOpenShop(shop.id)} className="flex w-[48px] flex-col items-center gap-0.5 active:opacity-60">
          <ShoppingBag className="h-[20px] w-[20px] text-black/70" strokeWidth={2} />
          <span className="text-[10px] text-black/50">店铺</span>
        </button>
        <button type="button" onClick={() => onOpenChat(shop.id, p.id)} className="flex w-[48px] flex-col items-center gap-0.5 active:opacity-60">
          <MessageSquare className="h-[20px] w-[20px] text-black/70" strokeWidth={2} />
          <span className="text-[10px] text-black/50">客服</span>
        </button>
        <button
          type="button"
          onClick={() => {
            const now = tbToggleFav(uid, p.id);
            setFaved(now);
            onToast(now ? '已加入收藏' : '已取消收藏');
          }}
          className="flex w-[52px] flex-col items-center gap-0.5 active:opacity-60"
        >
          <Star className={`h-[20px] w-[20px] ${faved ? 'fill-[#FFA400] text-[#FFA400]' : 'text-black/70'}`} strokeWidth={2} />
          <span className={`text-[10px] ${faved ? 'font-medium text-[#FFA400]' : 'text-black/50'}`}>{favCount}</span>
        </button>
        <div className="ml-1 flex min-w-0 flex-1 overflow-hidden rounded-xl">
          <button type="button" onClick={() => openSku('cart')} className="h-11 min-w-0 flex-1 bg-[#FFB400] text-[15px] font-semibold text-white active:opacity-85">
            加入购物车
          </button>
          <button type="button" onClick={() => openSku('buy')} className="h-11 min-w-0 flex-1 bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[15px] font-semibold text-white active:opacity-85">
            领券购买
          </button>
        </div>
      </div>

      {skuMode ? <SkuSheet p={p} uid={uid} mode={skuMode} onClose={() => setSkuMode(null)} onConfirm={confirmSku} /> : null}
    </div>
  );
}

/** SKU 组合价（priceDelta 累加） */
export function skuPriceOf(p: TbProduct, sku: Record<string, string>): number {
  let v = p.price;
  for (const g of p.skus) {
    const o = g.options.find((x) => x.label === sku[g.name]);
    if (o?.priceDelta) v += o.priceDelta;
  }
  return Math.round(v * 100) / 100;
}

// ---------------- 购物车 ----------------

function CartPage({
  uid,
  onBack,
  onOpenProduct,
  onCheckout,
  onToast,
  onOpenHome,
  onCartChange,
}: {
  uid: string;
  onBack?: () => void;
  onOpenProduct: (pid: string) => void;
  onCheckout: (items: TbOrderItem[]) => void;
  onToast: (m: string) => void;
  onOpenHome: () => void;
  /** 购物车变化后同步底部 tab 角标 */
  onCartChange?: () => void;
}) {
  const [items, setItems] = useState<TbCartItem[]>(() => tbLoadCart(uid));
  const [manage, setManage] = useState(false);
  /** 数量修改展开（截图5：右上 ×N，点击展开步进器；减到 0 自动移除） */
  const [qtyEdit, setQtyEdit] = useState<string | null>(null);
  /** 需求（第八轮）：回到顶部按钮（列表下滑 >300px 出现） */
  const [showTop, setShowTop] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const reload = () => {
    setItems(tbLoadCart(uid));
    onCartChange?.();
  };
  const checkedItems = items.filter((c) => c.checked);
  const total = checkedItems.reduce((n, c) => {
    const p = productById(c.pid);
    return p ? n + skuPriceOf(p, c.sku) * c.qty : n;
  }, 0);
  /** 共减（勾选商品划线价差合计，展示在结算栏「共减 ¥x | 查看明细」） */
  const savedTotal = Math.round(
    checkedItems.reduce((n, c) => {
      const p = productById(c.pid);
      if (!p?.originPrice) return n;
      return n + Math.max(0, (p.originPrice - skuPriceOf(p, c.sku)) * c.qty);
    }, 0) * 100
  ) / 100;
  /** 优惠券横幅（截图4：您有N张共X元消费券待使用） */
  const coupons = tbLoadCoupons(uid).filter((c) => !c.usedAt && c.expireAt > Date.now());
  const couponSum = coupons.reduce((n, c) => n + c.amount, 0);
  /** 店铺分组（保序：按 shopId 聚合） */
  const groups = (() => {
    const map = new Map<string, { shopId: string; items: TbCartItem[] }>();
    for (const c of items) {
      const p = productById(c.pid);
      const sid = p?.shopId ?? 'unknown';
      if (!map.has(sid)) map.set(sid, { shopId: sid, items: [] });
      map.get(sid)!.items.push(c);
    }
    return Array.from(map.values());
  })();

  const sigOf = (c: TbCartItem) => (c.sku && Object.keys(c.sku).length ? Object.keys(c.sku).sort().map((k) => `${k}:${c.sku[k]}`).join('|') : '');

  const checkout = () => {
    if (checkedItems.length === 0) {
      onToast('请先勾选要结算的商品');
      return;
    }
    const orderItems: TbOrderItem[] = checkedItems.map((c) => {
      const p = productById(c.pid)!;
      return { pid: p.id, title: p.title, img: tbImg(p.tag, 300, 300, 0), sku: c.sku, price: skuPriceOf(p, c.sku), qty: c.qty };
    });
    onCheckout(orderItems);
  };

  /** 管理模式：移入收藏（先收藏再移出购物车） */
  const moveCheckedToFavs = () => {
    if (checkedItems.length === 0) {
      onToast('请先勾选商品');
      return;
    }
    const favsNow = tbLoadFavs(uid);
    for (const c of checkedItems) {
      if (!favsNow.includes(c.pid)) tbToggleFav(uid, c.pid);
    }
    tbRemoveCartItems(
      uid,
      checkedItems.map((c) => ({ pid: c.pid, sig: sigOf(c) }))
    );
    reload();
    onToast('已移入收藏');
  };

  /** 管理模式：删除所选 */
  const removeChecked = () => {
    if (checkedItems.length === 0) {
      onToast('请先勾选要删除的商品');
      return;
    }
    tbRemoveCartItems(
      uid,
      checkedItems.map((c) => ({ pid: c.pid, sig: sigOf(c) }))
    );
    reload();
    onToast('已删除所选商品');
  };

  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      {/* 顶栏（截图4：购物车(N) 左对齐 + 搜索/对比/管理） */}
      <div className="sticky top-0 z-30 bg-white px-3 pb-2.5 pt-[58px]">
        <div className="flex items-center">
          {onBack ? (
            <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
              <ArrowLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
            </button>
          ) : <span className="w-4" />}
          <span className="text-[20px] font-bold text-black/90">
            购物车
            {items.length > 0 ? <span className="ml-1.5 align-[1px] text-[13px] font-normal text-black/40">({items.length})</span> : null}
          </span>
          <div className="ml-auto flex items-center gap-4">
            {manage ? (
              // 管理模式头部（截图6：批量清理 + 退出管理）
              <>
                <button
                  type="button"
                  onClick={() => {
                    tbSetCartAllChecked(uid, true);
                    reload();
                    onToast('已全选，可批量分享/收藏/删除');
                  }}
                  className="text-[15px] text-black/80 active:opacity-60"
                >
                  批量清理
                </button>
                <button type="button" onClick={() => setManage(false)} className="text-[15px] text-black/80 active:opacity-60">
                  退出管理
                </button>
              </>
            ) : (
              <>
                <button type="button" aria-label="搜索购物车" onClick={() => onToast('搜索购物车（演示）')} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
                  <Search className="h-[20px] w-[20px] text-black/80" strokeWidth={2.1} />
                </button>
                <button type="button" onClick={() => onToast('商品对比（演示）')} className="text-[15px] text-black/80 active:opacity-60">
                  对比
                </button>
                <button type="button" onClick={() => setManage(true)} className="text-[15px] text-black/80 active:opacity-60">
                  管理
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto pb-40"
        onScroll={(e) => setShowTop((e.currentTarget as HTMLDivElement).scrollTop > 300)}
      >
        {items.length === 0 ? (
          <>
            <div className="grid place-items-center bg-white py-16">
              <div className="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-[#FF7A21] to-[#FF4400]">
                <ShoppingCart className="h-11 w-11 text-white/90" strokeWidth={1.8} />
              </div>
              <div className="mt-4 text-[16px] font-medium text-black/70">购物车竟然是空的</div>
              <div className="mt-1 text-[13px] text-black/35">再忙，也要记得买点什么犒赏自己~</div>
            </div>
            <div className="mt-2 bg-white px-3 pb-4 pt-3">
              <div className="mb-2 text-[15px] font-semibold text-black/80">猜你也想要</div>
              <div className="grid grid-cols-2 gap-2">
                {TB_PRODUCTS.slice(6, 14).map((p) => (
                  <ProductCard key={p.id} p={p} v={1} onOpen={() => onOpenProduct(p.id)} />
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* 需求（第八轮）：购物车按新截图美化——旧权益标签行/粉色券条移除（券入口在首页/我的） */}
            {/* 店铺分组卡（截图5：店铺圆圈勾选 + 天猫/淘宝标 + 商品行圆圈勾选 + ×N + 明细） */}
            <div className="space-y-2 px-2">
              {groups.map((g) => {
                const shop = shopById(g.shopId);
                const groupItems = g.items;
                const allChecked = groupItems.every((c) => c.checked);
                const shopCoupons = coupons.filter((c) => c.pids.length > 0 && c.pids.some((pid) => groupItems.some((it) => it.pid === pid)));
                return (
                  <div key={g.shopId} className="rounded-xl bg-white px-3 py-3">
                    {/* 店铺头 */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={allChecked ? '取消店铺全选' : '店铺全选'}
                        onClick={() => {
                          for (const c of groupItems) tbUpdateCartItem(uid, c.pid, sigOf(c), { checked: !allChecked });
                          reload();
                        }}
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${allChecked ? 'border-[#FF5000] bg-[#FF5000]' : 'border-black/15 bg-white'}`}
                      >
                        {allChecked ? <Check className="h-3 w-3 text-white" strokeWidth={3.6} /> : null}
                      </button>
                      {shop.tmall ? <TmallMark /> : <span className="mr-0.5 inline-block rounded-[3px] bg-[#FF5000] px-1 py-[1px] text-[10px] font-bold leading-none text-white">淘宝</span>}
                      <button type="button" onClick={() => onToast(`进店逛逛（演示）`)} className="flex min-w-0 items-center gap-0.5 active:opacity-70">
                        <span className="truncate text-[15.5px] font-semibold text-black/85">{shop.name}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/30" />
                      </button>
                      {manage ? (
                        // 管理模式（截图6）：店铺行右侧 置顶
                        <button
                          type="button"
                          onClick={() => {
                            tbPinCartShop(uid, g.shopId, (pid) => productById(pid)?.shopId ?? 'unknown');
                            reload();
                            onToast('已置顶该店铺');
                          }}
                          className="ml-auto shrink-0 text-[13px] text-black/45 active:opacity-60"
                        >
                          置顶
                        </button>
                      ) : shopCoupons.length > 0 ? (
                        <button type="button" onClick={() => onToast('已领取店铺优惠券')} className="ml-auto flex shrink-0 items-center text-[13px] text-[#FF6A1E] active:opacity-70">
                          领券
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                    {/* 商品行 */}
                    <div className="mt-3 space-y-4">
                      {groupItems.map((c) => {
                        const p = productById(c.pid);
                        if (!p) return null;
                        const sig = sigOf(c);
                        const key = `${c.pid}|${sig}`;
                        const price = skuPriceOf(p, c.sku);
                        const skuText = Object.entries(c.sku).map(([k, v]) => `${k}：${v}`).join('；');
                        return (
                          <div key={key} className="flex gap-2">
                            <button
                              type="button"
                              aria-label={c.checked ? '取消勾选' : '勾选'}
                              onClick={() => {
                                tbUpdateCartItem(uid, c.pid, sig, { checked: !c.checked });
                                reload();
                              }}
                              className={`mt-7 grid h-5 w-5 shrink-0 place-items-center self-start rounded-full border-2 ${c.checked ? 'border-[#FF5000] bg-[#FF5000]' : 'border-black/15 bg-white'}`}
                            >
                              {c.checked ? <Check className="h-3 w-3 text-white" strokeWidth={3.6} /> : null}
                            </button>
                            <button type="button" onClick={() => onOpenProduct(c.pid)} className="shrink-0 active:opacity-70">
                              <img src={tbImg(p.tag, 200, 200, 0)} alt={p.title} className="h-[86px] w-[86px] rounded-lg object-cover" draggable={false} />
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-2">
                                <button type="button" onClick={() => onOpenProduct(c.pid)} className="min-w-0 flex-1 text-left">
                                  <span className="line-clamp-1 text-[13.5px] leading-5 text-black/85">
                                    {p.promo ? <span className="mr-1 font-bold text-[#FF0036]">{p.promo}</span> : null}
                                    {p.title}
                                  </span>
                                </button>
                                {/* ×N（点击展开步进器；减到 0 自动移除；管理模式隐藏） */}
                                {!manage ?
                                  qtyEdit === key ? (
                                    <div className="flex shrink-0 items-center rounded-md border border-black/15">
                                      <button
                                        type="button"
                                        aria-label="减少数量"
                                        onClick={() => {
                                          tbUpdateCartItem(uid, c.pid, sig, { qty: c.qty - 1 });
                                          reload();
                                          if (c.qty <= 1) {
                                            setQtyEdit(null);
                                            onToast('已从购物车移除');
                                          }
                                        }}
                                        className="grid h-7 w-7 place-items-center border-r border-black/10 text-black/60 active:opacity-60"
                                      >
                                        <Minus className="h-3 w-3" strokeWidth={2.6} />
                                      </button>
                                      <span className="min-w-[26px] text-center text-[13px] font-medium">{c.qty}</span>
                                      <button
                                        type="button"
                                        aria-label="增加数量"
                                        onClick={() => {
                                          tbUpdateCartItem(uid, c.pid, sig, { qty: c.qty + 1 });
                                          reload();
                                        }}
                                        className="grid h-7 w-7 place-items-center border-l border-black/10 text-black/60 active:opacity-60"
                                      >
                                        <Plus className="h-3 w-3" strokeWidth={2.6} />
                                      </button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => setQtyEdit(key)} className="shrink-0 rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[12px] text-black/55 active:opacity-60">
                                      ×{c.qty}
                                    </button>
                                  )
                                : null}
                              </div>
                              <button type="button" onClick={() => onOpenProduct(c.pid)} className="mt-0.5 flex max-w-full items-center text-left active:opacity-70">
                                <span className="truncate text-[12px] text-black/40">{skuText}</span>
                                <ChevronRight className="h-3 w-3 shrink-0 text-black/25" />
                              </button>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {p.tags.slice(0, 3).map((t, ti) => (
                                  <span
                                    key={t}
                                    className={`rounded-[3px] border px-1 py-px text-[10.5px] leading-[15px] ${ti === 0 ? 'border-[#FF6A1E]/45 text-[#FF6A1E]' : ti === 1 ? 'border-[#00A860]/40 text-[#00A860]' : 'border-black/12 text-black/45'}`}
                                  >
                                    {t}
                                  </span>
                                ))}
                              </div>
                              <div className="mt-1.5 flex items-end">
                                <span className="text-[12px] text-[#FF6A1E]">店铺优惠后</span>
                                <span className="ml-1 text-[19px] font-bold leading-none text-[#FF4400]">
                                  <span className="text-[12px] font-semibold">¥</span>
                                  {fmtMoney(price)}
                                </span>
                                {p.originPrice ? <span className="ml-1 text-[11px] leading-[13px] text-black/30 line-through">¥{fmtMoney(p.originPrice)}</span> : null}
                                {!manage ? (
                                  <button type="button" onClick={() => onToast('优惠明细：店铺券 + 平台补贴')} className="ml-auto flex shrink-0 items-center text-[12.5px] text-[#FF6A1E] active:opacity-70">
                                    明细
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            {/* 管理模式右侧（截图6：拖拽柄 + 红色删除） */}
                            {manage ? (
                              <div className="flex shrink-0 flex-col items-center justify-between self-stretch py-1">
                                <GripVertical className="h-5 w-5 text-black/20" />
                                <button
                                  type="button"
                                  aria-label="删除该商品"
                                  onClick={() => {
                                    tbRemoveCartItems(uid, [{ pid: c.pid, sig }]);
                                    reload();
                                    onToast('已删除该商品');
                                  }}
                                  className="grid h-8 w-8 place-items-center active:opacity-60"
                                >
                                  <Trash2 className="h-[19px] w-[19px] text-[#FF0036]" strokeWidth={2} />
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 回到顶部（截图6：右下白色圆钮） */}
      {showTop && items.length > 0 ? (
        <button
          type="button"
          aria-label="回到顶部"
          onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="absolute bottom-[150px] right-3 z-30 grid h-11 w-11 place-items-center rounded-full bg-white/95 shadow-[0_4px_14px_rgba(0,0,0,0.12)] ring-1 ring-black/5 active:opacity-80"
        >
          <span className="flex flex-col items-center">
            <ChevronUp className="h-4 w-4 text-black/60" strokeWidth={2.4} />
            <span className="text-[9px] leading-[10px] text-black/55">顶部</span>
          </span>
        </button>
      ) : null}

      {/* 底部（截图5/6：普通=全选+合计共减+结算；管理=全选+分享/移入收藏/删除；tab 模式避开底栏） */}
      {items.length > 0 ? (
        <div className={`absolute inset-x-0 z-30 flex items-center gap-2 border-t border-black/[0.06] bg-white/95 px-3 pt-2.5 backdrop-blur-md ${onBack ? 'bottom-0 pb-6' : 'bottom-[53px] pb-3'}`}>
          <button
            type="button"
            onClick={() => {
              tbSetCartAllChecked(uid, checkedItems.length < items.length);
              reload();
            }}
            className="flex items-center gap-1.5"
          >
            <span className={`grid h-5 w-5 place-items-center rounded-full border-2 ${checkedItems.length === items.length ? 'border-[#FF5000] bg-[#FF5000]' : 'border-black/15 bg-white'}`}>
              {checkedItems.length === items.length ? <Check className="h-3 w-3 text-white" strokeWidth={3.6} /> : null}
            </span>
            <span className="text-[13.5px] text-black/70">全选</span>
          </button>
          {manage ? (
            // 管理模式（截图6：分享 / 移入收藏 / 删除）
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => onToast('分享链接已复制（演示）')} className="h-11 shrink-0 rounded-xl bg-[#FFE9E4] px-5 text-[15px] font-semibold text-[#FF6A1E] active:opacity-80">
                分享
              </button>
              <button type="button" onClick={moveCheckedToFavs} className="h-11 shrink-0 rounded-xl bg-[#FFE9E4] px-4 text-[15px] font-semibold text-[#FF6A1E] active:opacity-80">
                移入收藏
              </button>
              <button type="button" onClick={removeChecked} className="h-11 shrink-0 rounded-xl bg-[#FF0036] px-5 text-[15px] font-semibold text-white active:opacity-85">
                删除
              </button>
            </div>
          ) : (
            <>
              <div className="ml-auto mr-1 text-right leading-tight">
                <div className="flex items-baseline justify-end gap-1">
                  <span className="text-[13px] text-black/60">合计:</span>
                  <Price value={total} size={20} />
                </div>
                {savedTotal > 0 ? (
                  <button type="button" onClick={() => onToast('共减明细：官方立减 + 店铺优惠')} className="text-[11.5px] text-[#FF4400] active:opacity-70">
                    共减 ¥{fmtMoney(savedTotal)} | 查看明细
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={checkout}
                className={`h-11 shrink-0 rounded-xl px-6 text-[15px] font-bold text-white ${checkedItems.length > 0 ? 'bg-gradient-to-r from-[#FF7A21] to-[#FF4400] active:opacity-85' : 'bg-black/20'}`}
              >
                结算{checkedItems.length > 0 ? `(${checkedItems.length})` : ''}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className={`absolute inset-x-0 z-30 border-t border-black/[0.06] bg-white/95 px-3 pt-2 backdrop-blur-md ${onBack ? 'bottom-0 pb-6' : 'bottom-[53px] pb-3'}`}>
          <button type="button" onClick={onOpenHome} className="h-10 w-full rounded-xl bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[15px] font-semibold text-white active:opacity-85">
            去逛逛
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------- 下单确认（结算页） ----------------

function CheckoutPage({
  uid,
  items,
  onBack,
  onToast,
  onOpenAddrPicker,
  onPaid,
}: {
  uid: string;
  items: TbOrderItem[];
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenAddrPicker: () => void;
  /** 下单成功（已支付）后回调：跳订单详情 */
  onPaid: (orderId: string) => void;
}) {
  const [addr, setAddr] = useState<TbAddress | null>(() => tbCurAddr(uid));
  const [couponId, setCouponId] = useState<string | null>(null);
  const [qtyOverride, setQtyOverride] = useState<Record<string, number>>({});
  const [payOpen, setPayOpen] = useState(false);
  const refreshAddr = useCallback(() => setAddr(tbCurAddr(uid)), [uid]);

  const itemTotal = items.reduce((n, it) => n + it.price * (qtyOverride[it.pid + it.img] ?? it.qty), 0);
  const freight = items.reduce((n, it) => n + (productById(it.pid)?.freight ?? 0), 0);
  const usableCoupons = tbLoadCoupons(uid).filter((c) => !c.usedAt && c.expireAt > Date.now() && itemTotal >= c.min && (c.pids.length === 0 || items.some((it) => c.pids.includes(it.pid))));
  const best = usableCoupons.sort((a, b) => b.amount - a.amount)[0];
  const couponAmount = usableCoupons.find((c) => c.id === (couponId ?? best?.id))?.amount ?? 0;
  const total = Math.max(0, Math.round((itemTotal + freight - couponAmount) * 100) / 100);

  /** 提交订单：创建待付款订单 → 直接拉起支付 */
  const submit = () => {
    if (!addr) {
      onToast('请先选择收货地址');
      onOpenAddrPicker();
      return;
    }
    const finalItems = items.map((it) => ({ ...it, qty: qtyOverride[it.pid + it.img] ?? it.qty }));
    const order = tbCreateOrder({
      uid,
      items: finalItems,
      address: addr,
      couponId: couponAmount > 0 ? usableCoupons.find((c) => c.id === (couponId ?? best?.id))!.id : undefined,
      couponAmount,
    });
    if (couponAmount > 0) tbUseCoupon(uid, usableCoupons.find((c) => c.id === (couponId ?? best?.id))!.id, order.id);
    setPayOpen(true);
    // 支付成功由 PaySheet 回调 onPaid(order.id)；这里先把订单号暂存
    pendingOrderId.current = order.id;
  };
  const pendingOrderId = useRef<string | null>(null);

  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <TopBar title="确认订单" onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-28">
        {/* 收货地址 */}
        <button type="button" onClick={onOpenAddrPicker} className="flex w-full items-start gap-2.5 bg-white px-4 py-3.5 text-left active:opacity-80">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#FF5000]" strokeWidth={2.1} />
          {addr ? (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold text-black/85">{addr.name}</span>
                <span className="text-[13px] text-black/45">{addr.phone.slice(0, 3)}****{addr.phone.slice(7)}</span>
                {addr.tag ? <span className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[10px] text-black/50">{addr.tag}</span> : null}
              </div>
              <div className="mt-0.5 text-[13px] leading-5 text-black/60">{addr.region} {addr.detail}</div>
            </div>
          ) : (
            <div className="flex-1 text-[15px] text-black/50">请选择收货地址</div>
          )}
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-black/30" />
        </button>
        {/* 商品确认 */}
        <div className="mt-2 bg-white px-4 py-3">
          {items.map((it, i) => {
            const qty = qtyOverride[it.pid + it.img] ?? it.qty;
            return (
              <div key={i} className="flex gap-2.5 py-2 first:pt-0 last:pb-0">
                <img src={it.img} alt={it.title} className="h-16 w-16 rounded-lg object-cover" draggable={false} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[13px] leading-[18px] text-black/85">{it.title}</div>
                  <div className="mt-0.5 truncate text-[11px] text-black/35">{Object.entries(it.sku).map(([k, v]) => `${k}：${v}`).join('；')}</div>
                  <div className="mt-1 flex items-center">
                    <Price value={it.price} size={15} />
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        aria-label="减少"
                        onClick={() => setQtyOverride((q) => ({ ...q, [it.pid + it.img]: Math.max(1, qty - 1) }))}
                        className="grid h-6 w-6 place-items-center rounded-[7px] border border-black/15 text-black/60 active:opacity-60"
                      >
                        <Minus className="h-3.5 w-3.5" strokeWidth={2.6} />
                      </button>
                      <span className="min-w-[18px] text-center text-[14px]">{qty}</span>
                      <button
                        type="button"
                        aria-label="增加"
                        onClick={() => setQtyOverride((q) => ({ ...q, [it.pid + it.img]: Math.min(99, qty + 1) }))}
                        className="grid h-6 w-6 place-items-center rounded-[7px] border border-black/15 text-black/60 active:opacity-60"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {/* 价格明细 + 优惠券 */}
        <div className="mt-2 space-y-2.5 bg-white px-4 py-3.5">
          <div className="flex justify-between text-[14px]">
            <span className="text-black/60">商品总价</span>
            <span className="text-black/85">¥{fmtMoney(itemTotal)}</span>
          </div>
          <div className="flex justify-between text-[14px]">
            <span className="text-black/60">运费{freight === 0 ? '（包邮）' : ''}</span>
            <span className="text-black/85">{freight === 0 ? '¥0' : `¥${fmtMoney(freight)}`}</span>
          </div>
          <button type="button" onClick={() => onToast(usableCoupons.length ? '在下方选择可用优惠券' : '暂无可用优惠券')} className="flex w-full items-center justify-between text-[14px]">
            <span className="text-black/60">优惠券{usableCoupons.length ? `（${usableCoupons.length}张可用）` : ''}</span>
            {usableCoupons.length > 0 ? (
              <span className="flex items-center gap-1">
                <select
                  value={couponId ?? best?.id ?? ''}
                  onChange={(e) => setCouponId(e.target.value || null)}
                  className="max-w-[150px] rounded bg-black/[0.04] px-2 py-1 text-right text-[13px] text-[#FF4400] outline-none"
                >
                  <option value="">不使用优惠券</option>
                  {usableCoupons.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} -¥{c.amount}
                    </option>
                  ))}
                </select>
              </span>
            ) : (
              <span className="text-black/35">暂无可用</span>
            )}
          </button>
          <div className="flex justify-between border-t border-black/[0.05] pt-2.5 text-[15px] font-semibold">
            <span className="text-black/85">实付款</span>
            <Price value={total} size={20} />
          </div>
        </div>
        <div className="mx-4 mt-3 rounded-xl bg-black/[0.03] p-3 text-[12px] leading-5 text-black/40">
          提交订单后请在 30 分钟内完成支付，超时订单将自动取消；支持 QQ钱包（余额/银行卡）与微信支付（零钱/银行卡/亲属卡）。
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-between border-t border-black/[0.06] bg-white/95 px-4 pb-6 pt-2 backdrop-blur-md">
        <div className="flex items-baseline gap-1">
          <span className="text-[13px] text-black/50">合计：</span>
          <Price value={total} size={20} />
        </div>
        <button type="button" onClick={submit} className="h-11 rounded-xl bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-8 text-[15px] font-semibold text-white active:opacity-85">
          提交订单
        </button>
      </div>

      {/* 支付方式选择 + 支付（复用 QQ/微信渠道，含亲属卡） */}
      {payOpen && pendingOrderId.current ? (
        <PaySheet
          uid={uid}
          orderId={pendingOrderId.current}
          amount={total}
          goodsBrief={items.length > 1 ? `${items[0].title.slice(0, 12)}等${items.length}件` : items[0]?.title.slice(0, 18) ?? '商品'}
          onClose={() => setPayOpen(false)}
          onSuccess={(oid) => {
            // 结算来源清掉已购购物车项；立即购买无购物车影响
            tbClearCheckedCart(uid);
            onToast('支付成功');
            setPayOpen(false);
            onPaid(oid);
          }}
        />
      ) : null}
      {/* 地址选择弹层挂载在父级（AddrPickerSheet），选完回写 */}
      <AddrPickerBridge uid={uid} onChange={refreshAddr} />
    </div>
  );
}

/** 地址选择联动桥（父级 AddrPickerSheet 关闭后同步最新默认地址） */
function AddrPickerBridge({ uid, onChange }: { uid: string; onChange: () => void }) {
  useEffect(() => {
    const t = setInterval(onChange, 600);
    return () => clearInterval(t);
  }, [uid, onChange]);
  return null;
}

// ---------------- 支付弹层（复用 QQ/微信支付渠道） ----------------

function PaySheet({
  uid,
  orderId,
  amount,
  goodsBrief,
  onClose,
  onSuccess,
  onError,
}: {
  uid: string;
  orderId: string;
  amount: number;
  goodsBrief: string;
  onClose: () => void;
  onSuccess: (orderId: string) => void;
  onError?: (m: string) => void;
}) {
  const [chans, setChans] = useState<TbPayChannel[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    void (async () => {
      const [wx, qq] = await Promise.all([tbListPayChannels('wx', amount).catch(() => [] as TbPayChannel[]), tbListPayChannels('qq', amount).catch(() => [] as TbPayChannel[])]);
      const all = [...wx, ...qq];
      setChans(all);
      const firstOk = all.find((c) => !c.insufficient);
      setSel(firstOk?.key ?? null);
    })();
  }, [amount]);

  const selChan = chans?.find((c) => c.key === sel);

  const pay = async () => {
    if (!selChan || paying) return;
    if (selChan.insufficient) {
      setErrMsg('该渠道额度不足，请选择其他支付方式');
      return;
    }
    setPaying(true);
    setErrMsg('');
    try {
      const res = await tbExecutePay(selChan.idp, selChan, amount, goodsBrief);
      if (!res.ok) {
        setErrMsg(res.error ?? '支付失败，请重试');
        onError?.(res.error ?? '支付失败');
        return;
      }
      const labelMap: Record<string, string> = { balance: selChan.idp === 'wx' ? '微信零钱' : 'QQ钱包余额' };
      tbMarkPaid(uid, orderId, {
        payIdp: selChan.idp,
        payChannelLabel: selChan.isFc ? selChan.label : labelMap[selChan.methodId] ?? selChan.label,
        payMethodId: selChan.methodId,
        payFc: selChan.isFc,
        payFcParts: res.fc?.parts.map((p) => ({ cardInId: p.cardInId, amount: p.amount })),
      });
      // 站内消息：支付成功（交易物流）
      tbPushMsg(uid, { kind: 'logistics', title: '支付成功', text: `订单已支付 ¥${fmtMoney(amount)}（${selChan.isFc ? selChan.label : labelMap[selChan.methodId] ?? selChan.label}），商家将尽快发货`, orderId });
      // 成功态：绿色对勾短展示后跳转订单详情
      setPaid(true);
      window.setTimeout(() => onSuccess(orderId), 750);
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={paying ? undefined : onClose}>
      <div className="max-h-[88%] overflow-y-auto rounded-t-[22px] bg-[#F6F7F9] pb-8 [animation:quick-in-up_.26s_cubic-bezier(0.32,0.72,0,1)_both]" onClick={(e) => e.stopPropagation()}>
        {/* 顶部拖拽指示条 + 标题 */}
        <div className="flex justify-center pt-2.5">
          <span className="h-1 w-9 rounded-full bg-black/12" />
        </div>
        <div className="relative flex items-center justify-center pb-2 pt-2">
          <span className="text-[16px] font-semibold text-black/85">收银台</span>
          <button type="button" aria-label="关闭" onClick={onClose} disabled={paying} className="absolute right-3 top-1.5 grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] disabled:opacity-40">
            <X className="h-4 w-4 text-black/60" strokeWidth={2.4} />
          </button>
        </div>
        <div className="px-4">
          {/* 金额卡（订单信息 + 大数字） */}
          <div className="rounded-2xl bg-white px-4 py-4 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            {paid ? (
              <>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#00B578]/10">
                  <CircleCheck className="h-7 w-7 text-[#00B578]" strokeWidth={2.2} />
                </span>
                <div className="mt-2 text-[17px] font-semibold text-black/85">支付成功</div>
                <div className="mt-0.5 text-[12px] text-black/35">{goodsBrief}</div>
              </>
            ) : (
              <>
                <div className="truncate text-[12px] text-black/40">{goodsBrief}</div>
                <div className="mt-1.5 flex items-baseline justify-center gap-1.5">
                  <Price value={amount} size={40} />
                </div>
                <div className="mt-1 text-[11px] text-black/30">订单号 {orderId} · 淘宝</div>
              </>
            )}
          </div>
          {/* 渠道列表（白色圆角卡分组，方形圆角图标） */}
          {chans === null ? (
            <div className="grid place-items-center py-10 text-[14px] text-black/40">正在获取支付方式…</div>
          ) : chans.length === 0 ? (
            <div className="mt-3 rounded-2xl bg-white py-8 text-center text-[14px] text-black/40">
              暂无可用支付方式
              <div className="mt-1 text-[12px] text-black/35">请先在微信/QQ 中开通钱包或添加银行卡</div>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {(['wx', 'qq'] as const).map((idp) => {
                const list = chans.filter((c) => c.idp === idp);
                if (list.length === 0) return null;
                return (
                  <div key={idp} className="overflow-hidden rounded-2xl bg-white px-2 py-1 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <div className="px-2.5 pb-0.5 pt-2 text-[12px] font-medium text-black/35">{idp === 'wx' ? '微信支付' : 'QQ支付'}</div>
                    {list.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        disabled={paying || paid}
                        onClick={() => {
                          setSel(c.key);
                          setErrMsg(c.insufficient ? '该渠道额度不足，请选择其他支付方式' : '');
                        }}
                        className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left transition-colors ${sel === c.key && !c.insufficient ? 'bg-[#FFF3EC]' : ''} ${c.insufficient ? 'opacity-45' : 'active:bg-black/[0.03]'}`}
                      >
                        {/* 用户反馈：微信/QQ 图标换成主界面同款真实 App 图标（wechat.png/qq.png） */}
                        <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-[10px] shadow-sm ring-1 ring-black/[0.06]">
                          <img src={c.idp === 'wx' ? '/icons/wechat.png' : '/icons/qq.png'} alt={c.idp === 'wx' ? '微信支付' : 'QQ支付'} className="h-full w-full select-none object-cover" draggable={false} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium text-black/85">{c.label}</span>
                          <span className="block truncate text-[12px] text-black/40">{c.sub}</span>
                        </span>
                        {c.insufficient ? <span className="shrink-0 rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[11px] text-red-400">额度不足</span> : null}
                        <span className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border-2 ${sel === c.key && !c.insufficient ? 'border-[#FF5000] bg-[#FF5000]' : 'border-black/20'}`}>
                          {sel === c.key && !c.insufficient ? <Check className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {errMsg && !paid ? <div className="pt-2 text-center text-[12px] text-red-500">{errMsg}</div> : null}
          {/* 支付按钮（方形圆角 + 支付中转圈） */}
          <div className="pt-4">
            <button
              type="button"
              onClick={pay}
              disabled={paying || paid || !selChan || chans?.length === 0}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[16px] font-semibold text-white shadow-[0_6px_16px_rgba(255,80,0,0.28)] active:opacity-85 disabled:opacity-50"
            >
              {paying ? (
                <>
                  <Loader2 className="h-4.5 w-4.5 animate-spin" strokeWidth={2.4} />
                  正在支付…
                </>
              ) : (
                `立即支付 ¥${fmtMoney(amount)}`
              )}
            </button>
            {selChan?.isFc && !paid ? <div className="pt-1.5 text-center text-[11px] text-black/35">使用亲属卡支付后，赠卡人将收到消费通知</div> : null}
            <div className="pt-2.5 text-center text-[11px] text-black/30">由微信支付 / QQ钱包提供安全保障 · 支付即同意《淘宝支付规则》</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- 订单列表 ----------------

type TbOrderFilter = 'all' | 'pendingPay' | 'pendingDeliver' | 'shipped' | 'refund' | 'completed';

function OrdersPage({
  uid,
  initialTab,
  onBack,
  onOpenOrder,
  onOpenDetail,
  onToast,
  onPayOrder,
  onOpenLogistics,
  onRate,
}: {
  uid: string;
  initialTab: TbOrderStatus | 'all';
  onBack: () => void;
  onOpenOrder: (id: string) => void;
  /** 取消成功后跳「交易关闭」详情（需求：取消支付以后的界面） */
  onOpenDetail: (id: string) => void;
  onToast: (m: string) => void;
  onPayOrder: (id: string) => void;
  onOpenLogistics: (id: string) => void;
  onRate: (id: string) => void;
}) {
  const [filter, setFilter] = useState<TbOrderFilter>(initialTab === 'all' || initialTab === 'cancelled' ? (initialTab === 'cancelled' ? 'refund' : 'all') : initialTab);
  const [channel, setChannel] = useState<'orders' | 'gou' | 'flash' | 'pig'>('gou');
  const [kw, setKw] = useState('');
  const [, setTick] = useState(0);
  // 双向刷新（Task 40）：重读订单推进状态；订单永远原位保留、不消失、不跳顶
  const pull = useTbPullRefresh(() => {
    tbTickOrders(uid);
    setTick((n) => n + 1);
    onToast('订单已更新');
  });
  /** 取消订单弹窗（截图2：原因选择） */
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  /** 退款确认弹窗（需求：退款/售后只显示退款订单——订单卡直接可发起退款） */
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  // 打开时 catch-up 状态推进
  useEffect(() => {
    tbTickOrders(uid);
  }, [uid]);
  const msgCount = tbLoadMsgs(uid).length;
  const orders = tbLoadOrders(uid)
    // 需求：退款/售后界面只显示退款的订单（不含仅取消未退款的「交易关闭」单）
    .filter((o) => (filter === 'all' ? true : filter === 'refund' ? !!o.refund : o.status === filter))
    .filter((o) => {
      const k = kw.trim();
      if (!k) return true;
      return o.shopName.includes(k) || o.items.some((it) => it.title.includes(k));
    });
  const filters: { id: TbOrderFilter; label: string }[] = [
    { id: 'all', label: '全部' },
    { id: 'pendingPay', label: '待付款' },
    { id: 'pendingDeliver', label: '待发货' },
    { id: 'shipped', label: '待收货' },
    { id: 'refund', label: '退款/售后' },
    { id: 'completed', label: '已完成' },
  ];
  const channels: { id: 'orders' | 'gou' | 'flash' | 'pig'; label: string; tag?: string }[] = [
    { id: 'orders', label: '全部订单' },
    { id: 'gou', label: '购物' },
    { id: 'flash', label: '闪购', tag: '外卖' },
    { id: 'pig', label: '飞猪', tag: '旅行' },
  ];
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <div className="sticky top-0 z-30 bg-[#f4f4f4] pt-[58px]">
        <div className="flex items-center gap-2 px-3">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5">
            <ArrowLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
          </button>
          <div className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-white px-3">
            <Search className="h-4 w-4 shrink-0 text-black/30" strokeWidth={2.2} />
            <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索订单" className="min-w-0 flex-1 bg-transparent text-[14px] text-black/80 outline-none placeholder:text-black/30" />
          </div>
          <button type="button" aria-label="工具" onClick={() => onToast('订单工具（演示）')} className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5">
            <LayoutGrid className="h-[19px] w-[19px] text-black/75" strokeWidth={2} />
            {msgCount > 0 ? <span className="absolute -right-0.5 -top-0.5 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[#FF5000] px-0.5 text-[9px] font-bold text-white">{msgCount > 99 ? '99+' : msgCount}</span> : null}
          </button>
          <button type="button" aria-label="更多" onClick={() => onToast('更多（演示）')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5">
            <MoreHorizontal className="h-[20px] w-[20px] text-black/75" strokeWidth={2} />
          </button>
        </div>
        {/* 频道 tab（截图6：全部订单/购物/闪购/飞猪） */}
        <div className="mt-1 flex items-center gap-5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {channels.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setChannel(c.id);
                if (c.id === 'flash') onToast('闪购订单已并入外卖频道（演示）');
                if (c.id === 'pig') onToast('飞猪订单已并入旅行频道（演示）');
              }}
              className={`relative shrink-0 pb-2 text-[16px] ${channel === c.id ? 'font-semibold text-black/90' : 'text-black/50'}`}
            >
              {c.label}
              {c.tag ? <span className="ml-0.5 inline-block rounded-[3px] bg-[#FF5000] px-0.5 py-px align-[2px] text-[9px] font-bold leading-none text-white">{c.tag}</span> : null}
              {channel === c.id ? <span className="absolute inset-x-1 bottom-0 h-[3px] rounded-full bg-[#FF5000]" /> : null}
            </button>
          ))}
        </div>
        {/* 状态筛选胶囊 */}
        <div className="flex items-center gap-2 overflow-x-auto px-3 pb-2.5 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`h-8 shrink-0 rounded-full px-3.5 text-[13px] ${filter === f.id ? 'bg-[#FFE8DA] font-medium text-[#FF5000]' : 'bg-white text-black/60'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={pull.scrollRef} {...pull.bind} className="h-full overflow-y-auto pb-10">
        {orders.length === 0 ? (
          <div className="grid place-items-center bg-white py-16">
            <ShoppingBag className="h-12 w-12 text-black/10" strokeWidth={1.6} />
            <div className="mt-3 text-[15px] text-black/45">{kw.trim() ? '没有找到相关订单' : '暂无相关订单'}</div>
          </div>
        ) : (
          <div className="space-y-2 px-2 pt-1">
            {orders.map((o) => (
              <OrderCard key={o.id} o={o} uid={uid} onOpen={() => onOpenOrder(o.id)} onPay={() => onPayOrder(o.id)} onToast={onToast} onOpenLogistics={onOpenLogistics} onRate={onRate} onCancel={() => setCancelFor(o.id)} onRefund={() => setRefundFor(o.id)} />
            ))}
          </div>
        )}
        </div>
        <TbPullIndicator h={pull} />
      </div>
      {/* 订单取消弹窗（截图2：选择原因 → 确定取消 → 交易关闭） */}
      {cancelFor ? (
        <CancelOrderSheet
          onClose={() => setCancelFor(null)}
          onConfirm={(reason) => {
            if (tbCancelOrder(uid, cancelFor, reason)) {
              onToast('订单已取消');
              setCancelFor(null);
              // 需求：取消支付以后的界面——直接进入交易关闭详情
              onOpenDetail(cancelFor);
            } else {
              setCancelFor(null);
            }
          }}
        />
      ) : null}
      {/* 退款确认弹层：确认后原路退回 → 订单进入「退款/售后」（只显示退款单） */}
      {refundFor ? (
        <RefundConfirmSheet
          busy={refunding}
          onClose={() => (refunding ? null : setRefundFor(null))}
          onConfirm={async () => {
            const o = tbLoadOrders(uid).find((x) => x.id === refundFor);
            if (!o) {
              setRefundFor(null);
              return;
            }
            setRefunding(true);
            const okPay = await tbRefundToOrigin(o);
            setRefunding(false);
            if (!okPay) {
              onToast('退款失败，请稍后重试');
              return;
            }
            tbMarkRefund(uid, o.id, o.total, '买家申请退款，已原路退回');
            tbPushMsg(uid, { kind: 'refund', title: '退款成功', text: `订单退款 ¥${fmtMoney(o.total)} 已原路退回（${o.payChannelLabel ?? '原支付方式'}）`, orderId: o.id });
            setRefundFor(null);
            onToast('退款成功，已原路退回');
          }}
        />
      ) : null}
    </div>
  );
}

/** 订单卡（截图6：天猫头 + 服务标签 + 物流条 + 状态按钮组） */
function OrderCard({
  o,
  uid,
  onOpen,
  onPay,
  onToast,
  onOpenLogistics,
  onRate,
  onCancel,
  onRefund,
}: {
  o: TbOrder;
  uid: string;
  onOpen: () => void;
  onPay: () => void;
  onToast: (m: string) => void;
  onOpenLogistics: (id: string) => void;
  onRate: (id: string) => void;
  onCancel: () => void;
  /** 待发货卡「退款」按钮：弹退款确认（不再进物流页死角） */
  onRefund: () => void;
}) {
  const countdown = useCountdown(o.status === 'pendingPay' ? o.createdAt + TB_PAY_TTL : undefined);
  // 票务订单卡（第十三轮淘票票：电影/喜剧脱口秀/演唱会——无物流不发货，直接「待收货」，点击进电影票详情）
  if (o.ticket) {
    const t = o.ticket;
    const stText = o.status === 'cancelled' ? (o.refund ? '退款成功' : '交易关闭') : o.status === 'completed' ? '交易成功' : '待收货';
    return (
      <div onClick={onOpen} className="cursor-pointer rounded-2xl bg-white px-3.5 py-3 active:bg-black/[0.015]">
        <div className="flex w-full items-center gap-1.5">
          <span className="mr-0.5 inline-block rounded-[3px] bg-gradient-to-r from-[#FF5C8A] to-[#FF2D6B] px-1 py-[1px] text-[10px] font-bold leading-none text-white">淘票票</span>
          <span className="min-w-0 truncate text-[14px] font-semibold text-black/85">{o.shopName}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/30" />
          <span className={`ml-auto shrink-0 text-[13px] ${o.status === 'cancelled' ? 'text-black/40' : 'text-[#FF6A1E]'}`}>{stText}</span>
        </div>
        <div className="mt-2.5 flex gap-2.5">
          {/* 渐变海报（票务单无实体图） */}
          <span className="relative h-[74px] w-[58px] shrink-0 overflow-hidden rounded-lg" style={{ background: `linear-gradient(160deg, ${t.posterC1} 0%, ${t.posterC2} 100%)` }}>
            <span className="absolute inset-x-1 top-2 line-clamp-3 text-[10.5px] font-black leading-[13px] text-white/95">{t.title}</span>
            <span className="absolute bottom-1 left-1 rounded-[2px] bg-black/45 px-0.5 py-px text-[8px] font-bold text-white">{t.kind === 'movie' ? '电影票' : t.kind === 'comedy' ? '演出票' : '演唱会'}</span>
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex gap-2">
              <span className="line-clamp-1 min-w-0 flex-1 text-[13.5px] leading-5 text-black/85">{t.title}</span>
              <span className="shrink-0 text-[13.5px] leading-5 text-black/70">¥{fmtMoney(t.unitPrice)}</span>
            </div>
            <div className="mt-0.5 truncate text-[12px] text-black/40">
              {t.dateLabel} {t.start} · {t.venue}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-black/40">
              {t.seats.join(' ')} · {t.qty}张
            </div>
            <div className="mt-1 flex gap-2.5 text-[11.5px] text-[#FF6A1E]">
              <span>电子票</span>
              <span>免配送</span>
              <span>开场前可退</span>
            </div>
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-end">
          <span className="text-[12px] text-black/45">
            实付款 <span className="text-[16px] font-semibold text-black/85">¥{fmtMoney(o.total)}</span>
          </span>
        </div>
        <div className="mt-2.5 flex items-center">
          {o.status === 'shipped' || o.status === 'completed' ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="text-[13px] text-black/50 active:opacity-60">
              更多
            </button>
          ) : (
            <span />
          )}
          <div className="ml-auto flex gap-2">
            {o.status === 'shipped' ? (
              <>
                <button type="button" onClick={(e) => { e.stopPropagation(); onRefund(); }} className="rounded-lg border border-black/12 px-3.5 py-1.5 text-[13px] text-black/60 active:opacity-70">
                  申请退款
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="rounded-lg bg-gradient-to-r from-[#FF5C8A] to-[#FF2D6B] px-3.5 py-1.5 text-[13px] font-semibold text-white active:opacity-85">
                  取票码
                </button>
              </>
            ) : null}
            {o.status === 'completed' ? (
              <>
                {o.review ? (
                  <span className="rounded-lg border border-black/[0.08] px-3.5 py-1.5 text-[13px] text-black/30">已评价</span>
                ) : (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onRate(o.id); }} className="rounded-lg border border-black/12 px-3.5 py-1.5 text-[13px] text-black/60 active:opacity-70">
                    评价
                  </button>
                )}
                <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="rounded-lg border border-[#FF3676] px-3.5 py-1.5 text-[13px] font-medium text-[#FF3676] active:opacity-70">
                  去看看
                </button>
              </>
            ) : null}
            {o.status === 'cancelled' ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="rounded-lg border border-black/12 px-3.5 py-1.5 text-[13px] text-black/60 active:opacity-70">
                查看详情
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
  const shop = shopById(o.shopId);
  const nodeIdx = o.track.length - 1;
  const statusRight = (() => {
    switch (o.status) {
      case 'pendingPay':
        return `待付款 · 剩${countdown}`;
      case 'pendingDeliver':
        return '待发货';
      case 'shipped':
        // 需求：已发货待收货的时候显示「已发货」（动态状态，不再写死卖家已发货）
        return '已发货';
      case 'completed':
        return '交易成功';
      case 'cancelled':
        return o.refund ? '退款成功' : '交易关闭';
    }
  })();
  const rebuy = () => {
    for (const it of o.items) tbAddToCart(uid, it.pid, it.sku, it.qty);
    onToast('已将订单商品加入购物车');
  };
  return (
    // 需求（第五轮）：点击整卡进入对应状态订单详情页——卡体整体 onOpen，卡内功能按钮 stopPropagation 自行接管
    <div onClick={onOpen} className="cursor-pointer rounded-2xl bg-white px-3.5 py-3 active:bg-black/[0.015]">
      <div className="flex w-full items-center gap-1.5">
        {shop.tmall ? <TmallMark /> : <span className="mr-0.5 inline-block rounded-[3px] bg-[#FF5000] px-1 py-[1px] text-[10px] font-bold leading-none text-white">淘宝</span>}
        <span className="min-w-0 truncate text-[14px] font-semibold text-black/85">{o.shopName}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/30" />
        <span className={`ml-auto shrink-0 text-[13px] ${o.status === 'pendingPay' || o.status === 'shipped' ? 'text-[#FF6A1E]' : o.status === 'cancelled' ? 'text-black/40' : 'text-black/50'}`}>{statusRight}</span>
      </div>
      <div className="mt-2.5 space-y-3">
        {/* 需求（第六轮澄清）：整卡任何地方（名字/图片/规格等）点击都进对应状态订单详情页——
            商品行不再跳商品详情，去掉自身 onClick 让点击冒泡到卡体 onOpen */}
        {o.items.map((it, i) => (
          <button key={i} type="button" className="flex w-full gap-2.5 text-left">
            <img src={it.img} alt={it.title} className="h-[74px] w-[74px] shrink-0 rounded-lg object-cover" draggable={false} />
            <div className="min-w-0 flex-1">
              <div className="flex gap-2">
                <span className="line-clamp-1 min-w-0 flex-1 text-[13.5px] leading-5 text-black/85">{it.title}</span>
                <span className="shrink-0 text-[13.5px] leading-5 text-black/70">¥{fmtMoney(it.price)}</span>
              </div>
              <div className="mt-0.5 flex items-center">
                <span className="truncate text-[12px] text-black/40">{Object.entries(it.sku).map(([k, v]) => `${k}：${v}`).join('；')}</span>
                <span className="ml-auto shrink-0 text-[12px] text-black/40">x{it.qty}</span>
              </div>
              <div className="mt-1 flex gap-2.5 text-[11.5px] text-[#FF6A1E]">
                <span>退货宝</span>
                <span>假一赔四</span>
                <span>极速退款</span>
              </div>
            </div>
          </button>
        ))}
      </div>
      {/* 物流条（运输中/派送中/待取件，点击进物流页） */}
      {o.status === 'shipped' && nodeIdx >= 0 ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpenLogistics(o.id); }} className="mt-2.5 flex w-full items-center gap-2 rounded-xl bg-[#F6F7F8] px-3 py-2.5 text-left active:opacity-80">
          {nodeIdx >= 3 ? <Package className="h-4 w-4 shrink-0 text-black/70" strokeWidth={2} /> : nodeIdx === 2 ? <Bike className="h-4 w-4 shrink-0 text-black/70" strokeWidth={2} /> : <Truck className="h-4 w-4 shrink-0 text-black/70" strokeWidth={2} />}
          <span className="shrink-0 text-[13px] font-medium text-black/80">{tbTrackPhaseText(nodeIdx)}</span>
          <span className="truncate text-[12px] text-black/40">{nodeIdx >= 2 ? '预计今天送达' : '预计明天送达'}</span>
          <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-black/25" />
        </button>
      ) : null}
      <div className="mt-2.5 flex items-center justify-end">
        <span className="text-[12px] text-black/45">
          {o.status === 'pendingPay' ? '应付' : '实付款'} <span className="text-[16px] font-semibold text-black/85">¥{fmtMoney(o.total)}</span>
          {o.discount > 0 ? <span className="ml-1 text-[#FF4400]">共减¥{fmtMoney(o.discount)}</span> : null}
        </span>
      </div>
      <div className="mt-2.5 flex items-center">
        {o.status === 'shipped' || o.status === 'completed' ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="text-[13px] text-black/50 active:opacity-60">
            更多
          </button>
        ) : (
          <span />
        )}
        <div className="ml-auto flex gap-2">
          {o.status === 'pendingPay' ? (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); onCancel(); }} className="rounded-lg border border-black/12 px-3.5 py-1.5 text-[13px] text-black/60 active:opacity-70">
                取消订单
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); onPay(); }} className="rounded-lg bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-3.5 py-1.5 text-[13px] font-semibold text-white active:opacity-85">
                继续付款
              </button>
            </>
          ) : null}
          {o.status === 'pendingDeliver' ? (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); onToast('已提醒商家尽快发货'); }} className="rounded-lg border border-black/12 px-3.5 py-1.5 text-[13px] text-black/60 active:opacity-70">
                提醒发货
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); onRefund(); }} className="rounded-lg border border-black/12 px-3.5 py-1.5 text-[13px] text-black/60 active:opacity-70">
                退款
              </button>
            </>
          ) : null}
          {o.status === 'shipped' ? (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); onToast('收货时间已延长 7 天'); }} className="rounded-lg border border-black/12 px-3.5 py-1.5 text-[13px] text-black/60 active:opacity-70">
                延长收货
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpenLogistics(o.id); }} className="rounded-lg border border-black/12 px-3.5 py-1.5 text-[13px] text-black/60 active:opacity-70">
                查看物流
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (tbConfirmReceive(uid, o.id)) {
                    tbPushMsg(uid, { kind: 'logistics', title: '确认收货', text: `订单已确认收货 ¥${fmtMoney(o.total)}，记得评价哦`, orderId: o.id });
                    onToast('确认收货成功');
                  }
                }}
                className="rounded-lg bg-[#FFF1E6] px-3.5 py-1.5 text-[13px] font-semibold text-[#FF5000] active:opacity-80"
              >
                确认收货
              </button>
            </>
          ) : null}
          {o.status === 'completed' ? (
            <>
              {o.review ? (
                <span className="rounded-lg border border-black/[0.08] px-3.5 py-1.5 text-[13px] text-black/30">已评价</span>
              ) : (
                <button type="button" onClick={(e) => { e.stopPropagation(); onRate(o.id); }} className="rounded-lg border border-black/12 px-3.5 py-1.5 text-[13px] text-black/60 active:opacity-70">
                  评价
                </button>
              )}
              <button type="button" onClick={(e) => { e.stopPropagation(); rebuy(); }} className="rounded-lg border border-[#FF5000] px-3.5 py-1.5 text-[13px] font-medium text-[#FF5000] active:opacity-70">
                再买一单
              </button>
            </>
          ) : null}
          {o.status === 'cancelled' ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); rebuy(); }} className="rounded-lg border border-[#FF5000] px-3.5 py-1.5 text-[13px] font-medium text-[#FF5000] active:opacity-70">
              再买一单
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
// ---------------- 订单详情 ----------------
/** 订单信息行（详情页通用） */
function OdInfoRow({ label, value, arrow, copyable, onCopy }: { label: string; value: string; arrow?: boolean; copyable?: boolean; onCopy?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="shrink-0 text-black/45">{label}</span>
      <span className="flex min-w-0 items-center gap-1 text-black/70">
        <span className="truncate">{value}</span>
        {arrow ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/25" /> : null}
        {copyable ? (
          <button type="button" aria-label={`复制${label}`} onClick={onCopy} className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-black/[0.04] active:opacity-60">
            <Copy className="h-3 w-3 text-black/50" />
          </button>
        ) : null}
      </span>
    </div>
  );
}

const TB_GUARDS = [
  { t: '破损包退', d: '破损可退货或退款，商家承担运费' },
  { t: '假一赔四', d: '收到商品非正品，可获成交金额四倍赔偿' },
  { t: '极速退款', d: '满足相应条件，极速退款到账' },
];

function OrderDetailPage({
  uid,
  orderId,
  onBack,
  onToast,
  onPayOrder,
  onOpenProduct,
  onRate,
  onOpenLogistics,
  onOpenAddrPicker,
  onOpenShop,
  onOpenChat,
}: {
  uid: string;
  orderId: string;
  onBack: () => void;
  onToast: (m: string) => void;
  onPayOrder: (id: string) => void;
  onOpenProduct: (pid: string) => void;
  onRate: (id: string) => void;
  onOpenLogistics: (id: string) => void;
  onOpenAddrPicker: () => void;
  onOpenShop: (shopId: string) => void;
  /** 联系客服（Task 41：带订单上下文进 AI 客服聊天） */
  onOpenChat: (shopId: string, orderId: string) => void;
}) {
  const [, setTick] = useState(0);
  const [payPref, setPayPref] = useState<'wx' | 'ali'>('wx');
  const [priceOpen, setPriceOpen] = useState(true);
  /** 订单取消弹窗（截图2：待付款底栏「取消」） */
  const [cancelOpen, setCancelOpen] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, []);
  tbTickOrders(uid);
  const o = tbLoadOrders(uid).find((x) => x.id === orderId);
  // 倒计时 hook 无条件调用（hooks 规则：不能在早 return 之后）
  const countdown = useCountdown(o?.status === 'pendingPay' ? o.createdAt + TB_PAY_TTL : undefined);
  const isPendingPay = o?.status === 'pendingPay';
  // 待付款订单「修改地址」：AddrPickerSheet 改默认地址后同步到本单
  useEffect(() => {
    if (!isPendingPay) return;
    const t = setInterval(() => {
      const cur = tbCurAddr(uid);
      const list = tbLoadOrders(uid);
      const hit = list.find((x) => x.id === orderId);
      if (cur && hit && hit.address && cur.id !== hit.address.id) {
        hit.address = cur;
        tbSaveOrders(uid, list);
        setTick((n) => n + 1);
      }
    }, 800);
    return () => clearInterval(t);
  }, [isPendingPay, uid, orderId]);

  const copyText = (text: string, tip: string) => {
    try {
      void navigator.clipboard.writeText(text);
      onToast(tip);
    } catch {
      onToast('复制失败，请手动选择');
    }
  };
  /** 退款（原路退回） */
  const applyRefund = async () => {
    if (!o || !o.payIdp || !o.payMethodId) {
      onToast('退款信息异常，请联系客服');
      return;
    }
    const okPay = await tbRefundToOrigin(o);
    if (!okPay) {
      onToast('退款失败，请稍后重试');
      return;
    }
    tbMarkRefund(uid, o.id, o.total, '买家申请退款，已原路退回');
    tbPushMsg(uid, { kind: 'refund', title: '退款成功', text: `订单退款 ¥${fmtMoney(o.total)} 已原路退回（${o.payChannelLabel ?? '原支付方式'}）`, orderId: o.id });
    onToast('退款成功，已原路退回');
    setTick((n) => n + 1);
  };
  const addAllToCart = () => {
    if (!o) return;
    for (const it of o.items) tbAddToCart(uid, it.pid, it.sku, it.qty);
    onToast('已将订单商品加入购物车');
  };

  if (!o) {
    return (
      <div className="grid h-full place-items-center bg-white">
        <div className="text-[15px] text-black/40">订单不存在</div>
      </div>
    );
  }
  const st = tbStatusText(o);
  const shop = shopById(o.shopId);
  const man = tbCourierMan(o.id);
  const manPhone = tbCourierPhone(o.id);
  const nodeIdx = o.track.length - 1;
  const qtyAll = o.items.reduce((n, it) => n + it.qty, 0);
  const coinGold = Math.max(0.01, Math.round(o.total * 0.025 * 100) / 100);
  const company = `${shop.name.replace(/官方旗舰店|旗舰店|专营店|专卖店|官方/g, '')}有限公司`;
  const promiseText = (() => {
    if (!o.paidAt) return '48小时内发货';
    const d = new Date(o.paidAt + 2 * 86_400_000);
    return `后天${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}前发货`;
  })();
  // 驿站口径（待收货详情「已送达」驿站卡与物流页同源）
  const station = tbStationName(o.address);
  const pickCode = tbPickCode(o.id);
  /** 确认收货（底栏按钮 / 驿站卡「一键取件」同口径：需求「点击一键取件等于点击确认收货」） */
  const confirmReceive = () => {
    if (tbConfirmReceive(uid, o.id)) {
      tbPushMsg(uid, { kind: 'logistics', title: '确认收货', text: `订单已确认收货 ¥${fmtMoney(o.total)}，记得评价哦`, orderId: o.id });
      onToast('确认收货成功');
      setTick((n) => n + 1);
    }
  };

  /** 商品行（详情页通用；variant 区分状态口径） */
  const itemRows = (variant: 'pay' | 'deliver' | 'done') => (
    <div className="mt-2 space-y-3.5">
      {o.items.map((it, i) => {
        const skuText = Object.entries(it.sku).map(([k, v]) => `${k}：${v}`).join('；');
        const origin = Math.round(it.price * 1.32 * 100) / 100;
        return (
          <button key={i} type="button" onClick={() => onOpenProduct(it.pid)} className="flex w-full gap-2.5 text-left">
            <img src={it.img} alt={it.title} className="h-[78px] w-[78px] shrink-0 rounded-lg object-cover" draggable={false} />
            <div className="min-w-0 flex-1">
              <div className="flex gap-2">
                <span className="line-clamp-1 min-w-0 flex-1 text-[14px] leading-5 text-black/85">{it.title}</span>
                <span className="shrink-0 text-[14px] leading-5 text-black/70">¥{fmtMoney(it.price)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                {variant === 'deliver' ? <span className="shrink-0 rounded-[3px] bg-black/[0.06] px-1 py-px text-[10px] text-black/45">可换</span> : null}
                <span className="truncate text-[12px] text-black/40">{skuText}</span>
                {variant === 'deliver' && origin > it.price ? <span className="ml-auto shrink-0 text-[12px] text-black/30 line-through">¥{fmtMoney(origin)}</span> : null}
                <span className="shrink-0 text-[12px] text-black/40">x{it.qty}</span>
              </div>
              {variant === 'deliver' ? (
                <div className="mt-1 flex items-center gap-2 text-[12px] text-[#00A860]">
                  <span>破损包退</span>
                  <span>假一赔四</span>
                  <span>极速退款</span>
                  <ChevronRight className="h-3 w-3 text-[#00A860]/60" />
                </div>
              ) : (
                <>
                  <div className="mt-1 flex items-center text-[12px] text-[#00A860]">
                    <span>极速退款</span>
                    <span className="ml-1.5">7天无理由退货</span>
                    <ChevronRight className="h-3 w-3 text-[#00A860]/60" />
                  </div>
                  <div className="mt-0.5 text-[12px] text-black/60">
                    实付价 <span className="font-semibold text-black/85">¥{fmtMoney(it.price * it.qty)}</span>
                    <span className="ml-1.5 text-black/35">价格明细 {'>'}</span>
                  </div>
                  {variant === 'done' ? <div className="mt-0.5 truncate text-[11px] text-black/30">{company}</div> : null}
                </>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="relative flex h-full flex-col bg-[#f4f4f4]">
      <TopBar
        title={o.status === 'cancelled' ? (o.refund ? '退款成功' : '交易关闭') : o.status === 'completed' ? '交易成功' : st}
        onBack={onBack}
        right={
          <button type="button" aria-label="更多操作" onClick={() => copyText(o.id, '订单号已复制')} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <MoreHorizontal className="h-[20px] w-[20px] text-black/75" strokeWidth={2.2} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto pb-32">
        {/* ============ 待付款（截图7） ============ */}
        {o.status === 'pendingPay' ? (
          <>
            <div className="bg-white px-4 pb-3.5 pt-4">
              <div className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-[#00B578]" strokeWidth={2.1} />
                <span className="text-[17px] font-semibold text-[#00B578]">48小时内发货</span>
              </div>
              <div className="ml-2 my-1 h-6 w-px border-l border-dashed border-black/15" />
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 shrink-0 text-black/75" strokeWidth={2.1} />
                <span className="min-w-0 truncate text-[17px] font-semibold text-black/85">送至 {o.address ? tbFullAddr(o.address) : '待填写地址'}</span>
                <button type="button" onClick={onOpenAddrPicker} className="ml-auto flex shrink-0 items-center text-[13px] text-black/45 active:opacity-70">
                  修改
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              {o.address ? (
                <div className="mt-1 pl-7 text-[13px] text-black/45">
                  {o.address.name} {tbMaskPhone(o.address.phone)}
                  <span className="ml-1.5 rounded border border-black/10 px-1 py-px text-[10px] text-black/40">号码保护中</span>
                </div>
              ) : null}
            </div>
            <div className="mt-2 bg-white px-4 py-3">
              <div className="flex items-center gap-2.5">
                <img src={tbImg(shop.tag, 96, 96, 0, 'c')} alt={shop.name} className="h-10 w-10 rounded-lg object-cover" draggable={false} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold text-black/85">{shop.name}</div>
                  <div className="mt-0.5 text-[11px] text-black/35">平均2天退款</div>
                </div>
                <button type="button" onClick={() => onOpenShop(shop.id)} className="flex shrink-0 items-center text-[13px] text-black/50 active:opacity-70">
                  进店逛逛
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              {itemRows('pay')}
              <div className="mt-2.5 flex justify-end">
                <button type="button" onClick={addAllToCart} className="rounded-lg border border-black/12 px-3.5 py-1.5 text-[13px] text-black/65 active:opacity-70">
                  加入购物车
                </button>
              </div>
            </div>
            <div className="mt-2 space-y-2.5 bg-white px-4 py-3.5 text-[13.5px]">
              <div className="flex items-center justify-between">
                <span className="text-black/55">
                  商品总价 <span className="text-[12px] text-black/35">共{qtyAll}件</span>
                </span>
                <span className="text-black/80">¥{fmtMoney(o.itemTotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-black/55">运费</span>
                <span className="text-black/80">{o.freight === 0 ? '包邮' : `¥${fmtMoney(o.freight)}`}</span>
              </div>
              {o.discount > 0 ? (
                <button type="button" onClick={() => onToast('天降礼金：平台立减优惠')} className="flex w-full items-center justify-between">
                  <span className="flex items-center gap-1.5 text-black/55">
                    <span className="grid h-4 w-4 place-items-center rounded-[4px] bg-[#FF0036] text-[9px] font-bold text-white">¥</span>
                    平台优惠 天降礼金
                  </span>
                  <span className="flex items-center text-[#FF4400]">
                    -¥{fmtMoney(o.discount)}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              ) : null}
              <div className="flex items-center justify-between border-t border-black/[0.05] pt-2.5">
                <span className="text-[15px] font-semibold text-black/85">
                  需付款 {o.discount > 0 ? <span className="text-[13px] font-normal text-[#FF4400]">共减¥{fmtMoney(o.discount)}</span> : null}
                </span>
                <Price value={o.total} size={20} />
              </div>
            </div>
            {/* 支付方式（截图7：支付宝 / 微信支付单选） */}
            <div className="mt-2 bg-white px-4 py-1.5">
              <PayRadioRow icon={<AliPayIcon />} label="支付宝" active={payPref === 'ali'} onClick={() => setPayPref('ali')} />
              <PayRadioRow icon={<WxPayIcon />} label="微信支付" active={payPref === 'wx'} onClick={() => setPayPref('wx')} />
            </div>
            <div className="mt-2 space-y-2.5 bg-white px-4 py-3.5">
              <div className="flex items-center text-[13px]">
                <span className="font-medium text-black/80">订单信息 共2项</span>
                <ChevronDown className="ml-1 h-4 w-4 text-black/30" />
                <span className="ml-auto flex min-w-0 items-center gap-1 text-black/65">
                  <span className="truncate">{o.id}</span>
                  <span className="mx-0.5 h-3 w-px bg-black/10" />
                  <button type="button" onClick={() => copyText(o.id, '订单号已复制')} className="text-[12px] text-black/45 active:opacity-60">
                    复制
                  </button>
                </span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-black/45">订单保障</span>
                <span className="flex items-center text-black/55">
                  凭据：今日下单交易快照
                  <ChevronRight className="h-3.5 w-3.5 text-black/25" />
                </span>
              </div>
            </div>
          </>
        ) : null}

        {/* ============ 待发货（截图4） ============ */}
        {o.status === 'pendingDeliver' ? (
          <>
            <button type="button" onClick={() => onToast('商家承诺时限内发货')} className="flex w-full items-center gap-2 bg-white px-4 py-4 text-left active:opacity-80">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#00B578]/10">
                <Zap className="h-3.5 w-3.5 text-[#00B578]" strokeWidth={2.4} />
              </span>
              <span className="text-[15.5px] font-semibold text-black/85">承诺{promiseText}</span>
              <span className="mx-1 h-3.5 w-px bg-black/10" />
              <span className="text-[13px] text-black/45">预计明天发货</span>
              <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-black/25" />
            </button>
            <div className="mt-2 bg-white px-4 py-3">
              <div className="flex items-center gap-1.5">
                {shop.tmall ? <TmallMark /> : <span className="mr-1 inline-block rounded-[3px] bg-[#FF5000] px-1 py-[1px] text-[10px] font-bold leading-none text-white">淘宝</span>}
                <span className="truncate text-[14.5px] font-semibold text-black/85">{shop.name}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/30" />
              </div>
              {itemRows('deliver')}
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => onToast('可在商品页重新选择款式')} className="rounded-lg bg-[#FFF1E6] px-3.5 py-1.5 text-[13px] text-[#FF6A1E] active:opacity-75">
                  更换款式
                </button>
                <button type="button" onClick={addAllToCart} className="rounded-lg bg-black/[0.04] px-3.5 py-1.5 text-[13px] text-black/65 active:opacity-70">
                  加入购物车
                </button>
                <button type="button" onClick={() => void applyRefund()} className="rounded-lg bg-black/[0.04] px-3.5 py-1.5 text-[13px] text-black/65 active:opacity-70">
                  退款
                </button>
              </div>
              <button type="button" onClick={() => setPriceOpen((v) => !v)} className="mt-4 flex w-full items-center">
                <span className="flex items-center gap-1 text-[14px] text-black/60">
                  价格明细
                  <ChevronDown className={`h-4 w-4 text-black/35 transition-transform ${priceOpen ? '' : '-rotate-90'}`} />
                </span>
                <span className="ml-auto flex items-baseline gap-0.5">
                  <span className="text-[12px] text-black/50">实付款</span>
                  <Price value={o.total} size={19} />
                </span>
              </button>
              {priceOpen ? (
                <div className="mt-2 space-y-1.5">
                  <div className="text-right text-[12px] text-[#FF6A1E]">
                    <span className="mr-1 inline-grid h-3.5 w-3.5 place-items-center rounded-full border border-[#FF6A1E] align-[-2px] text-[9px] font-bold">¥</span>
                    其中淘金币已抵 ¥{fmtMoney(coinGold)}
                  </div>
                  <div className="flex justify-between text-[12.5px]">
                    <span className="text-black/45">商品总价</span>
                    <span className="text-black/70">¥{fmtMoney(o.itemTotal)}</span>
                  </div>
                  <div className="flex justify-between text-[12.5px]">
                    <span className="text-black/45">运费</span>
                    <span className="text-black/70">{o.freight === 0 ? '包邮' : `¥${fmtMoney(o.freight)}`}</span>
                  </div>
                  {o.discount > 0 ? (
                    <div className="flex justify-between text-[12.5px]">
                      <span className="text-black/45">平台优惠</span>
                      <span className="text-[#FF4400]">-¥{fmtMoney(o.discount)}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="mt-2 space-y-3 bg-white px-4 py-3.5">
              <OdInfoRow label="付款时间" value={fmtFullTime(o.paidAt ?? o.createdAt)} />
              <OdInfoRow label="创建时间" value={fmtFullTime(o.createdAt)} />
              <OdInfoRow label="支付宝交易号" value={`2025${o.id.slice(0, 20)}`} copyable onCopy={() => copyText(`2025${o.id.slice(0, 20)}`, '交易号已复制')} />
              <OdInfoRow label="天猫积分" value={`获得${Math.max(1, Math.floor(o.total))}点积分`} arrow />
              <OdInfoRow label="交易快照" value="发生交易争议时，可作为判断依据" arrow />
              <OdInfoRow label="订单信息" value={o.id} copyable onCopy={() => copyText(o.id, '订单号已复制')} />
            </div>
            <div className="mt-2 bg-white px-4 py-3.5">
              <div className="flex items-center">
                <span className="text-[14.5px] font-semibold text-black/85">服务保障</span>
                <button type="button" onClick={() => onToast('服务保障说明（演示）')} className="ml-auto flex items-center text-[13px] text-[#FF6A1E]">
                  查看更多
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-2">
                {TB_GUARDS.map((g) => (
                  <button key={g.t} type="button" onClick={() => onToast(`${g.t}：${g.d}`)} className="rounded-lg bg-[#F7F8FA] p-2.5 text-left active:opacity-75">
                    <div className="flex items-center text-[13px] font-semibold text-black/80">
                      {g.t}
                      <ChevronRight className="h-3 w-3 text-black/30" />
                    </div>
                    <div className="mt-1 text-[10.5px] leading-4 text-black/35">{g.d}</div>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {/* ============ 待收货 ============ */}
        {o.status === 'shipped' ? (
          <>
            {nodeIdx >= 3 ? (
              /* 需求（第五轮·截图1）：到驿站后头部显示「已送达」，下面显示待取件通知 + 驿站卡（取件码/找人帮取/一键取件） */
              <div className="bg-white px-4 pb-4 pt-4">
                <div className="flex items-center gap-2">
                  <Package className="h-5 w-5 shrink-0 text-[#FF6A1E]" strokeWidth={2.1} />
                  <span className="text-[17px] font-bold text-[#FF6A1E]">已送达</span>
                  <span className="text-[13px] text-black/40">{fmtTime(o.track[o.track.length - 1]?.at ?? o.createdAt)}</span>
                  <button type="button" onClick={() => onOpenLogistics(o.id)} className="ml-auto flex shrink-0 items-center text-[13px] text-black/45 active:opacity-70">
                    查看物流
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-1.5 text-[13.5px] leading-[22px] text-black/75">
                  <TbDescText text={`您的快件已暂存至${station}，请凭取货码及时领取。如有疑问请联系${manPhone}`} phone={manPhone} />
                </div>
                <div className="mt-3 rounded-2xl bg-[#F7F8FA] px-4 pb-4 pt-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[17px] font-semibold text-black/90">{station}</div>
                      <div className="mt-0.5 truncate text-[13px] text-black/40">{o.address?.region.replace(/\s+/g, '') ?? ''}</div>
                    </div>
                    <button type="button" aria-label="拨打驿站电话" onClick={() => onToast(`拨打驿站电话 ${manPhone}`)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.08)] active:opacity-60">
                      <Phone className="h-[18px] w-[18px] text-black/75" strokeWidth={2} />
                    </button>
                  </div>
                  <div className="mt-3.5 flex items-center gap-3">
                    <span className="shrink-0 text-[14px] text-black/55">取件码</span>
                    <span className="text-[28px] font-bold leading-none tracking-wide text-black/90">{pickCode}</span>
                    <button type="button" onClick={() => copyText(pickCode, '取件码已复制')} className="text-[13.5px] text-black/45 active:opacity-60">
                      复制
                    </button>
                  </div>
                  <div className="mt-3.5 flex items-center">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[#FF6A1E]">驿站距您较远，有疑问可联系快递员</span>
                    <button type="button" onClick={() => onToast(`已通知快递员 ${man}`)} className="ml-auto flex shrink-0 items-center text-[14px] text-[#FF6A1E] active:opacity-70">
                      去联系
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-4 flex gap-3">
                    <button type="button" onClick={() => onToast('已生成帮取码，可分享给亲友')} className="h-11 flex-1 rounded-xl border border-black/12 bg-white text-[14px] text-black/75 active:opacity-70">
                      找人帮取
                    </button>
                    {/* 需求：一键取件 = 确认收货 */}
                    <button type="button" onClick={confirmReceive} className="h-11 flex-1 rounded-xl border border-black/12 bg-white text-[14px] text-black/75 active:opacity-70">
                      一键取件
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => onOpenLogistics(o.id)} className="block w-full bg-white px-4 py-4 text-left active:opacity-85">
                <div className="flex items-center gap-2">
                  {nodeIdx >= 3 ? <Package className="h-5 w-5 text-[#FF6A1E]" strokeWidth={2.1} /> : nodeIdx === 2 ? <Bike className="h-5 w-5 text-[#FF6A1E]" strokeWidth={2.1} /> : <Truck className="h-5 w-5 text-[#FF6A1E]" strokeWidth={2.1} />}
                  <span className="text-[17px] font-semibold text-[#FF6A1E]">{tbTrackPhaseText(nodeIdx)}</span>
                  <span className="text-[13px] text-black/45">{nodeIdx >= 2 ? '预计今天送达' : '预计明天送达'}</span>
                  <span className="ml-auto flex shrink-0 items-center text-[13px] text-black/45">
                    查看物流
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </div>
                <div className="mt-1 line-clamp-1 pl-7 text-[12px] text-black/40">
                  {[...o.track].reverse()[0]?.text} · {fmtTime([...o.track].reverse()[0]?.at ?? o.createdAt)}
                </div>
              </button>
            )}
            {o.address ? (
              <div className="mt-2 bg-white px-4 py-3.5">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 shrink-0 text-black/75" strokeWidth={2.1} />
                  <span className="min-w-0 truncate text-[15.5px] font-semibold text-black/85">
                    送至 {o.address.region.replace(/\s+/g, '')} {o.address.detail}
                  </span>
                </div>
                <div className="mt-1 pl-7 text-[13px] text-black/45">
                  {o.address.name} {tbMaskPhone(o.address.phone)}
                  <span className="ml-1.5 rounded border border-black/10 px-1 py-px text-[10px] text-black/40">号码保护中</span>
                </div>
              </div>
            ) : null}
            <div className="mt-2 bg-white px-4 py-3">
              <div className="flex items-center gap-1.5">
                {shop.tmall ? <TmallMark /> : <span className="mr-1 inline-block rounded-[3px] bg-[#FF5000] px-1 py-[1px] text-[10px] font-bold leading-none text-white">淘宝</span>}
                <span className="truncate text-[14.5px] font-semibold text-black/85">{shop.name}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/30" />
              </div>
              {itemRows('done')}
              <div className="mt-3 space-y-2 border-t border-black/[0.05] pt-2.5 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-black/50">商品总价</span>
                  <span className="text-black/80">¥{fmtMoney(o.itemTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/50">运费</span>
                  <span className="text-black/80">{o.freight === 0 ? '包邮' : `¥${fmtMoney(o.freight)}`}</span>
                </div>
                {o.discount > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-black/50">平台优惠</span>
                    <span className="text-[#FF4400]">-¥{fmtMoney(o.discount)}</span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between pt-0.5">
                  <span className="text-[15px] font-semibold text-black/85">实付款</span>
                  <Price value={o.total} size={19} />
                </div>
              </div>
            </div>
          </>
        ) : null}

        {/* ============ 交易成功（截图5） ============ */}
        {o.status === 'completed' ? (
          <>
            {o.address ? (
              <button type="button" onClick={() => onOpenLogistics(o.id)} className="block w-full bg-white px-4 py-4 text-left active:opacity-85">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 shrink-0 text-black/75" strokeWidth={2.1} />
                  <span className="shrink-0 text-[16px] font-semibold text-[#00B578]">已签收</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-black/85">{o.address ? tbFullAddr(o.address) : ''}</span>
                  <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-black/25" />
                </div>
                <div className="mt-1 pl-7 text-[13px] text-black/45">
                  {o.address.name} {tbMaskPhone(o.address.phone)}
                </div>
              </button>
            ) : null}
            <div className="mt-2 flex items-center gap-3 bg-white px-4 py-3">
              <img src={tbImg(shop.tag, 96, 96, 0, 'c')} alt={shop.name} className="h-11 w-11 rounded-lg object-cover" draggable={false} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-black/85">{shop.name}</div>
                <div className="mt-0.5 text-[11.5px] text-black/40">88VIP好评率93%，客服平均22秒回复</div>
              </div>
              <button type="button" onClick={() => onOpenShop(shop.id)} className="flex shrink-0 items-center text-[13px] text-black/55 active:opacity-70">
                进店逛逛
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 bg-white px-4 py-3">
              {itemRows('done')}
              <button type="button" onClick={() => onToast('去看看搭配好物（演示）')} className="mt-3 flex w-full items-center gap-1.5 rounded-lg bg-[#FFF0F4] px-3 py-2.5 text-left active:opacity-80">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#FF4D88]" />
                <span className="truncate text-[13px] text-black/75">配个{Object.values(o.items[0]?.sku ?? {})[0] ?? '同款'}配件更好用</span>
                <span className="ml-auto shrink-0 text-[13px] text-[#FF4D88]">去看看 {'>'}</span>
                <span className="h-3 w-px shrink-0 bg-[#FF4D88]/30" />
                <span className="shrink-0 text-[13px] text-[#FF4D88]">更多</span>
              </button>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => onToast('已复制商品信息，可去闲鱼转卖')} className="rounded-lg border border-black/12 bg-white px-3.5 py-1.5 text-[13px] text-black/65 active:opacity-70">
                  闲鱼转卖
                </button>
                <button type="button" onClick={() => void applyRefund()} className="rounded-lg border border-black/12 bg-white px-3.5 py-1.5 text-[13px] text-black/65 active:opacity-70">
                  申请售后
                </button>
                <button type="button" onClick={addAllToCart} className="rounded-lg bg-[#FFF1E6] px-3.5 py-1.5 text-[13px] font-medium text-[#FF6A1E] active:opacity-75">
                  加入购物车
                </button>
              </div>
            </div>
            <div className="mt-2 bg-white px-4 py-3.5">
              <div className="flex items-center">
                <span className="text-[15px] font-semibold text-black/85">
                  实付款 {o.discount > 0 ? <span className="text-[13px] font-normal text-[#FF4400]">共减¥{fmtMoney(o.discount)}</span> : null}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <Price value={o.total} size={19} />
                  <ChevronDown className="h-4 w-4 text-black/30" />
                </span>
              </div>
              {o.discount > 0 ? (
                <span className="mt-1.5 inline-flex items-center gap-1 rounded bg-[#FFF1E6] px-1.5 py-0.5 text-[11px] text-[#FF6A1E]">
                  <span className="inline-grid h-3 w-3 place-items-center rounded-full border border-[#FF6A1E] text-[8px] font-bold">¥</span>
                  官方限时补贴抵¥{fmtMoney(o.discount)}
                </span>
              ) : null}
            </div>
            <div className="mt-2 space-y-3 bg-white px-4 py-3.5">
              <div className="flex items-center text-[13px]">
                <span className="font-medium text-black/80">订单信息 共7项</span>
                <ChevronDown className="ml-1 h-4 w-4 text-black/30" />
                <span className="ml-auto flex min-w-0 items-center gap-1 text-black/65">
                  <span className="truncate">{o.id}</span>
                  <span className="mx-0.5 h-3 w-px bg-black/10" />
                  <button type="button" onClick={() => copyText(o.id, '订单号已复制')} className="text-[12px] text-black/45 active:opacity-60">
                    复制
                  </button>
                </span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-black/45">
                  订单保障 <span className="rounded bg-[#FFF1E6] px-1 py-px text-[11px] text-[#FF6A1E]">共2项</span>
                </span>
                <span className="flex items-center text-black/55">
                  凭据：{new Date(o.createdAt).getMonth() + 1}月{new Date(o.createdAt).getDate()}日下单交易快照
                  <ChevronRight className="h-3.5 w-3.5 text-black/25" />
                </span>
              </div>
            </div>
          </>
        ) : null}

        {/* ============ 已取消 / 退款成功 ============ */}
        {o.status === 'cancelled' ? (
          <>
            {o.refund ? (
              /* 需求（第五轮）：退款售后详情页美化——退款成功 hero（金额+到账渠道）+ 退款进度 + 退款信息卡 */
              <>
                <div className="bg-white px-4 pb-5 pt-5">
                  <div className="flex items-center gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#00B578]/10">
                      <Check className="h-6 w-6 text-[#00B578]" strokeWidth={2.6} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[19px] font-bold text-black/90">退款成功</div>
                      <div className="mt-0.5 truncate text-[12.5px] text-black/45">已原路退回至{o.payChannelLabel ?? '原支付方式'}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[11.5px] text-black/40">退款金额</div>
                      <div className="mt-1 flex items-baseline justify-end text-[#FF4400]">
                        <span className="text-[15px] font-semibold">¥</span>
                        <span className="text-[26px] font-bold leading-none">{fmtMoney(o.refund.amount)}</span>
                      </div>
                    </div>
                  </div>
                  {/* 退款进度：申请退款 → 商家退款 → 已到账 */}
                  <div className="relative mt-6">
                    <div className="absolute left-[16.5%] right-[16.5%] top-[8px] h-[2px] rounded bg-[#00B578]/30" />
                    <div className="relative flex">
                      {[
                        { t: '申请退款', at: o.refund.at - 120_000, last: false },
                        { t: '商家退款', at: o.refund.at - 60_000, last: false },
                        { t: '已到账', at: o.refund.at, last: true },
                      ].map((s) => (
                        <div key={s.t} className="flex flex-1 flex-col items-center">
                          <span className={`grid h-[18px] w-[18px] place-items-center rounded-full ${s.last ? 'bg-[#00B578] shadow-[0_0_0_4px_rgba(0,181,120,0.14)]' : 'border-[3px] border-[#00B578] bg-white'}`}>
                            {s.last ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.4} /> : null}
                          </span>
                          <div className={`mt-1.5 text-[12.5px] ${s.last ? 'font-semibold text-black/85' : 'font-medium text-black/65'}`}>{s.t}</div>
                          <div className="mt-0.5 text-[10.5px] text-black/35">{fmtTime(s.at)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl bg-[#F7F8FA] px-3.5 py-2.5 text-[12.5px] leading-[20px] text-black/50">退款已按支付方式原路退回，到账后会以消息通知您，请留意{o.payChannelLabel ?? '原支付方式'}账单变化。如有疑问可联系客服处理。</div>
                </div>
                {/* 退款信息卡 */}
                <div className="mt-2 space-y-2.5 bg-white px-4 py-3.5">
                  <div className="text-[14.5px] font-semibold text-black/85">退款信息</div>
                  <OdInfoRow label="退款编号" value={`TK${o.id.slice(0, 18)}`} copyable onCopy={() => copyText(`TK${o.id.slice(0, 18)}`, '退款编号已复制')} />
                  <OdInfoRow label="退款原因" value={o.refund.reason} />
                  <OdInfoRow label="退款方式" value={`原路退回（${o.payChannelLabel ?? '原支付方式'}）`} />
                  <OdInfoRow label="申请时间" value={fmtFullTime(o.refund.at - 120_000)} />
                  <OdInfoRow label="到账时间" value={fmtFullTime(o.refund.at)} />
                </div>
              </>
            ) : (
              <div className="bg-gradient-to-r from-[#FF6A1E] to-[#FF4400] px-4 py-4 text-white">
                <div className="text-[19px] font-bold">交易关闭</div>
                <div className="mt-1 text-[13px] text-white/85">{o.cancelReason ?? '订单已取消'}</div>
              </div>
            )}
            {/* 地址卡（截图1：定位标 + 姓名 + 脱敏手机 + 号码保护中） */}
            {o.address ? (
              <div className="mt-2 flex items-start gap-2.5 bg-white px-4 py-3.5">
                <MapPin className="mt-1 h-[18px] w-[18px] shrink-0 text-black/80" strokeWidth={2.1} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-semibold text-black/90">{o.address.detail.trim().split(/\s+/).pop() || tbFullAddr(o.address)}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[13px] text-black/50">
                    <span className="truncate">{o.address.name} {tbMaskPhone(o.address.phone)}</span>
                    <span className="shrink-0 rounded border border-black/12 px-1 py-px text-[10px] text-black/40">号码保护中</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11.5px] text-black/35">{tbFullAddr(o.address)}</div>
                </div>
              </div>
            ) : null}
            {/* 店铺 + 商品卡（截图1：店铺图/平均2天退款/进店逛逛 + 商品行 + 加入购物车） */}
            <div className="mt-2 bg-white px-4 py-3">
              <div className="flex items-center gap-2.5">
                <img src={tbImg(shop.tag, 96, 96, 0, 'c')} alt={shop.name} className="h-10 w-10 rounded-lg object-cover" draggable={false} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold text-black/85">{shop.name}</div>
                  <div className="mt-0.5 text-[11px] text-black/35">平均2天退款</div>
                </div>
                <button type="button" onClick={() => onOpenShop(shop.id)} className="flex shrink-0 items-center text-[13px] text-black/50 active:opacity-70">
                  进店逛逛
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              {itemRows('done')}
              <div className="mt-2.5 flex justify-end">
                <button type="button" onClick={addAllToCart} className="rounded-lg bg-black/[0.04] px-3.5 py-1.5 text-[13px] text-black/65 active:opacity-70">
                  加入购物车
                </button>
              </div>
            </div>
            {/* 应付款 / 共减 / 礼金标（截图1） */}
            <div className="mt-2 bg-white px-4 py-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold text-black/85">
                  应付款 {o.discount > 0 ? <span className="text-[13px] font-semibold text-[#FF4400]">共减¥{fmtMoney(o.discount)}</span> : null}
                </span>
                <span className="flex items-center gap-1">
                  <Price value={o.total} size={20} />
                  <ChevronDown className="h-4 w-4 text-black/35" />
                </span>
              </div>
              {o.discount > 0 ? (
                <div className="mt-2 inline-flex items-center gap-1 rounded bg-[#FFF1E6] px-2 py-1 text-[11.5px] text-[#FF6A1E]">
                  <span className="grid h-3.5 w-3.5 place-items-center rounded-[3px] bg-[#FF0036] text-[9px] font-bold text-white">¥</span>
                  天降礼金抵¥{fmtMoney(o.discount)}
                </div>
              ) : null}
            </div>
            {/* 订单信息 / 订单保障 / 7天无理由退货卡（截图1） */}
            <div className="mt-2 space-y-2.5 bg-white px-4 py-3.5">
              <div className="flex items-center text-[13px]">
                <span className="font-medium text-black/80">订单信息 共{qtyAll}项</span>
                <ChevronDown className="ml-1 h-4 w-4 text-black/30" />
                <span className="ml-auto flex min-w-0 items-center gap-1 text-black/65">
                  <span className="truncate">{o.id}</span>
                  <span className="mx-0.5 h-3 w-px bg-black/10" />
                  <button type="button" onClick={() => copyText(o.id, '订单号已复制')} className="text-[12px] text-black/45 active:opacity-60">
                    复制
                  </button>
                </span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-black/45">订单保障</span>
                <span className="flex items-center text-black/55">
                  凭据：今日下单交易快照
                  <ChevronRight className="h-3.5 w-3.5 text-black/25" />
                </span>
              </div>
              <button type="button" onClick={() => onToast('物流签收后7天内可享')} className="flex w-full items-center rounded-xl bg-[#F7F8FA] px-3.5 py-3 text-left active:opacity-80">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-black/85">7天无理由退货</div>
                  <div className="mt-0.5 text-[11.5px] text-black/40">物流签收后7天内可享</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
              </button>
            </div>
          </>
        ) : null}

        {/* 我的评价 */}
        {o.review ? (
          <div className="mt-2 bg-white px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-black/85">我的评价</span>
              <span className="ml-auto flex gap-0.5">
                {Array.from({ length: 5 }, (_, si) => (
                  <Star key={si} className={`h-3.5 w-3.5 ${si < o.review!.rating ? 'fill-[#FFA400] text-[#FFA400]' : 'fill-black/10 text-black/10'}`} />
                ))}
              </span>
            </div>
            <div className="mt-1.5 text-[13px] leading-5 text-black/70">{o.review.content}</div>
            {o.review.tags.length ? <div className="mt-1 flex flex-wrap gap-1">{o.review.tags.map((t) => <span key={t} className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] text-black/50">{t}</span>)}</div> : null}
          </div>
        ) : null}
      </div>

      {/* ============ 底部操作条 ============ */}
      {o.status === 'pendingPay' ? (
        <div className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-black/[0.06] bg-white/95 px-4 pb-6 pt-2 backdrop-blur-md">
          <div className="flex gap-4">
            <button type="button" onClick={() => onOpenChat(o.shopId, o.id)} className="flex w-11 flex-col items-center gap-0.5 active:opacity-60">
              <Headphones className="h-[19px] w-[19px] text-black/70" strokeWidth={2} />
              <span className="text-[10px] text-black/50">客服</span>
            </button>
            <button type="button" onClick={() => setCancelOpen(true)} className="flex w-11 flex-col items-center gap-0.5 active:opacity-60">
              <X className="h-[19px] w-[19px] text-black/70" strokeWidth={2} />
              <span className="text-[10px] text-black/50">取消</span>
            </button>
          </div>
          <div className="ml-auto text-right leading-tight">
            <div className="flex items-baseline justify-end gap-1 text-[13px] text-black/50">
              共{qtyAll}件 合计:<Price value={o.total} size={17} />
            </div>
            {o.discount > 0 ? <div className="text-[11px] text-[#FF4400]">共减 ¥{fmtMoney(o.discount)}</div> : null}
          </div>
          <button type="button" onClick={() => onPayOrder(o.id)} className="shrink-0 rounded-xl bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-5 py-2 text-center text-white active:opacity-85">
            <span className="block text-[14px] font-semibold leading-[18px]">继续付款</span>
            <span className="block text-[10px] leading-[14px] opacity-85">剩余{countdown}</span>
          </button>
        </div>
      ) : null}
      {o.status === 'pendingDeliver' ? (
        <div className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-4 border-t border-black/[0.06] bg-white/95 px-4 pb-6 pt-2 backdrop-blur-md">
          <button type="button" onClick={() => onOpenChat(o.shopId, o.id)} className="flex w-11 flex-col items-center gap-0.5 active:opacity-60">
            <Headphones className="h-[19px] w-[19px] text-black/70" strokeWidth={2} />
            <span className="text-[10px] text-black/50">客服</span>
          </button>
          <button type="button" onClick={() => onToast('投诉已记录，将尽快处理')} className="flex w-11 flex-col items-center gap-0.5 active:opacity-60">
            <FileText className="h-[19px] w-[19px] text-black/70" strokeWidth={2} />
            <span className="text-[10px] text-black/50">投诉</span>
          </button>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => onToast('开票申请已提交')} className="rounded-lg bg-black/[0.05] px-4 py-2 text-[13px] text-black/70 active:opacity-70">
              申请开票
            </button>
            <button type="button" onClick={() => onToast('已提醒商家尽快发货')} className="rounded-lg bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-4 py-2 text-[13px] font-semibold text-white active:opacity-85">
              催发货
            </button>
          </div>
        </div>
      ) : null}
      {o.status === 'shipped' ? (
        // 需求（第五轮·截图2）：底部按钮改平行等宽（退款/延长收货/查看物流/确认收货）
        <div className="absolute inset-x-0 bottom-0 z-30 flex items-stretch gap-2.5 border-t border-black/[0.06] bg-white/95 px-4 pb-6 pt-2.5 backdrop-blur-md">
          <button type="button" onClick={() => void applyRefund()} className="h-[46px] flex-1 rounded-xl border border-black/12 bg-white text-[13.5px] text-black/70 active:opacity-70">
            退款
          </button>
          <button type="button" onClick={() => onToast('收货时间已延长 7 天')} className="h-[46px] flex-1 rounded-xl border border-black/12 bg-white text-[13.5px] text-black/70 active:opacity-70">
            延长收货
          </button>
          <button type="button" onClick={() => onOpenLogistics(o.id)} className="h-[46px] flex-1 rounded-xl border border-black/12 bg-white text-[13.5px] text-black/70 active:opacity-70">
            查看物流
          </button>
          <button type="button" onClick={confirmReceive} className="h-[46px] flex-1 rounded-xl bg-[#FDEEE2] text-[13.5px] font-semibold text-[#FF5000] active:opacity-80">
            确认收货
          </button>
        </div>
      ) : null}
      {o.status === 'completed' ? (
        <div className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-black/[0.06] bg-white/95 px-4 pb-6 pt-2 backdrop-blur-md">
          <button type="button" onClick={() => onToast('更多操作（演示）')} className="flex w-11 shrink-0 flex-col items-center gap-0.5 active:opacity-60">
            <MoreHorizontal className="h-[20px] w-[20px] rounded-full bg-black/[0.05] p-0.5 text-black/70" strokeWidth={2.2} />
            <span className="text-[10px] text-black/50">更多</span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={addAllToCart} className="rounded-lg bg-black/[0.05] px-4 py-2 text-[13px] text-black/70 active:opacity-70">
              加入购物车
            </button>
            <button type="button" onClick={addAllToCart} className="rounded-lg bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-5 py-2 text-[13px] font-semibold text-white active:opacity-85">
              再买一单
            </button>
          </div>
        </div>
      ) : null}
      {o.status === 'cancelled' ? (
        <div className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-black/[0.06] bg-white/95 px-4 pb-6 pt-2 backdrop-blur-md">
          <button type="button" onClick={() => onOpenChat(o.shopId, o.id)} className="flex w-11 shrink-0 flex-col items-center gap-0.5 active:opacity-60">
            <Headphones className="h-[19px] w-[19px] text-black/70" strokeWidth={2} />
            <span className="text-[10px] text-black/50">客服</span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (tbDeleteOrder(uid, o.id)) {
                  onToast('订单已删除');
                  onBack();
                }
              }}
              className="rounded-lg bg-black/[0.05] px-3.5 py-2 text-[13px] text-black/70 active:opacity-70"
            >
              删除订单
            </button>
            <button type="button" onClick={addAllToCart} className="rounded-lg bg-black/[0.05] px-3.5 py-2 text-[13px] text-black/70 active:opacity-70">
              加入购物车
            </button>
            <button type="button" onClick={addAllToCart} className="rounded-lg bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-4 py-2 text-[13px] font-semibold text-white active:opacity-85">
              再买一单
            </button>
          </div>
        </div>
      ) : null}
      {/* 订单取消弹窗（截图2：选择原因 → 确定取消 → 交易关闭） */}
      {cancelOpen ? (
        <CancelOrderSheet
          onClose={() => setCancelOpen(false)}
          onConfirm={(reason) => {
            if (tbCancelOrder(uid, o.id, reason)) {
              onToast('订单已取消');
              setCancelOpen(false);
              setTick((n) => n + 1);
            }
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------- 物流页（截图1-5：点击订单进入） ----------------

function LogisticsPage({
  uid,
  orderId,
  onBack,
  onToast,
  onOpenProduct,
  onOpenChat,
}: {
  uid: string;
  orderId: string;
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenProduct: (pid: string) => void;
  /** 联系客服（Task 41：带订单上下文进 AI 客服聊天） */
  onOpenChat: (shopId: string, orderId: string) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [, setTick] = useState(0);
  // 骑手位移平滑刷新
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);
  tbTickOrders(uid);
  const o = tbLoadOrders(uid).find((x) => x.id === orderId);
  // 无物流轨迹订单（待付款/待发货/已取消）：需求「点击订单进物流界面」——显示状态头而非空白
  if (!o) {
    return (
      <div className="grid h-full place-items-center bg-white">
        <div className="text-[15px] text-black/40">订单不存在</div>
      </div>
    );
  }
  const shop0 = shopById(o.shopId);
  if (o.track.length === 0) {
    const pre = (() => {
      if (o.status === 'pendingPay') return { title: '等待买家付款', sub: '付款后商家将在 48 小时内发货', head: '待付款' };
      if (o.status === 'pendingDeliver') return { title: '商家备货中', sub: '包裹完成打包后将交给快递员揽收', head: '待发货' };
      if (o.status === 'cancelled') return { title: '交易已关闭', sub: o.refund ? '退款已原路退回' : '订单未支付，物流已停止跟踪', head: o.refund ? '退款成功' : '交易关闭' };
      return { title: '等待发货', sub: '商家正在准备包裹', head: '待发货' };
    })();
    return (
      <div className="relative flex h-full flex-col bg-[#f4f4f4]">
        {/* 悬浮顶栏（白胶囊浮于地图上） */}
        <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-3 pt-[58px]">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-white/95 shadow-sm active:opacity-70">
            <ArrowLeft className="h-[20px] w-[20px] text-black/75" strokeWidth={2.2} />
          </button>
          <div className="flex items-center gap-2 rounded-full bg-white/95 px-3.5 py-2 shadow-sm">
            <button type="button" onClick={() => onOpenChat(o.shopId, o.id)} className="flex items-center gap-1 active:opacity-60">
              <Headphones className="h-4 w-4 text-black/75" strokeWidth={2} />
              <span className="text-[13px] text-black/75">客服</span>
            </button>
            <span className="h-3.5 w-px bg-black/10" />
            <button type="button" onClick={() => onToast('更多操作（演示）')} className="active:opacity-60">
              <MoreHorizontal className="h-4 w-4 text-black/75" strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto pb-8">
          <TbExpressMap phase="prepare" etaTitle={pre.title} etaSub={pre.sub} addrDetail={o.address?.detail} riderProg={0} />
          <div className="relative z-10 -mt-4 rounded-t-2xl bg-white px-4 pb-3 pt-4">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 shrink-0 text-[#FF6A1E]" strokeWidth={2.1} />
              <span className="text-[17px] font-bold text-black/90">{pre.head}</span>
              <span className="ml-auto text-[13px] text-black/40">{o.status === 'pendingPay' ? '剩余付款时间可见于订单详情' : '发货后可查看实时物流'}</span>
            </div>
            <div className="mt-3 flex gap-3">
              <div className="flex flex-col items-center">
                <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full bg-[#FF5000]" />
                <span className="my-1 w-px flex-1 border-l border-dashed border-black/12" />
              </div>
              <div className="min-w-0 flex-1 pb-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[15px] font-bold text-[#FF5000]">{pre.title}</span>
                  <span className="text-[13px] text-black/40">{fmtTime(Date.now())}</span>
                </div>
                <div className="mt-1 text-[13.5px] leading-[21px] text-black/65">{pre.sub}</div>
              </div>
            </div>
            {/* 商品脚卡（点击可进商品） */}
            <button type="button" onClick={() => onOpenProduct(o.items[0]?.pid ?? '')} className="mt-1 flex w-full items-center gap-2.5 rounded-xl bg-[#F7F8FA] p-2.5 text-left active:opacity-80">
              <img src={o.items[0]?.img} alt={o.items[0]?.title} className="h-12 w-12 shrink-0 rounded-lg object-cover" draggable={false} />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-1 text-[13px] text-black/80">{o.items[0]?.title}</div>
                <div className="mt-0.5 text-[12px] text-black/40">{shop0.name} · x{o.items[0]?.qty ?? 1}</div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
            </button>
          </div>
        </div>
      </div>
    );
  }
  const co = tbCourierCo(o.id);
  const man = tbCourierMan(o.id);
  const manPhone = tbCourierPhone(o.id);
  const trackNo = tbTrackNo(o.id);
  const pickCode = tbPickCode(o.id);
  const station = tbStationName(o.address);
  const nodeIdx = o.track.length - 1;
  const phase: TbExpressPhase = nodeIdx >= 3 ? 'station' : nodeIdx === 2 ? 'delivering' : nodeIdx === 1 ? 'transit' : 'pickup';
  const latest = [...o.track].reverse()[0];
  // 派送中骑手行进进度（节点时间起 90s 走完，不倒退）
  const riderProg = Math.min(0.92, Math.max(0.12, (Date.now() - latest.at) / 90_000));
  const eta = (() => {
    switch (phase) {
      case 'delivering':
        return { title: '预计今天送达', sub: `距收货地${2 + (tbHash(o.id) % 4)}公里` };
      case 'station':
        return { title: '已放入菜鸟驿站', sub: `距收货地${(3.5 + (tbHash(`${o.id}s`) % 15) / 10).toFixed(1)}公里` };
      case 'transit':
        return { title: '运输中', sub: '预计明天送达' };
      default:
        return { title: '已揽收', sub: '商家已把包裹交给快递员' };
    }
  })();
  const copyText = (text: string, tip: string) => {
    try {
      void navigator.clipboard.writeText(text);
      onToast(tip);
    } catch {
      onToast('复制失败，请手动选择');
    }
  };
  /** 时间线条目（最新在前） */
  const entries = o.track
    .map((t, i) => ({ ...tbNodeMeta(i, man, manPhone, station), at: t.at }))
    .reverse();
  /** 详细信息弹层条目（含更早的干线条目） */
  const detailEntries = [
    ...entries,
    { title: '', desc: '【杭州市】快件已由 广东东莞 发出，正在干线运输中', at: o.shipAt! - 50 * 60_000, phone: undefined as string | undefined },
    { title: '', desc: '【东莞市】商家已通知快递揽收，包裹完成分拣', at: o.shipAt! - 80 * 60_000, phone: undefined as string | undefined },
  ];
  const shop = shopById(o.shopId);
  return (
    <div className="relative flex h-full flex-col bg-[#f4f4f4]">
      {/* 悬浮顶栏（白胶囊浮于地图上） */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-3 pt-[58px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-white/95 shadow-sm active:opacity-70">
          <ArrowLeft className="h-[20px] w-[20px] text-black/75" strokeWidth={2.2} />
        </button>
        <div className="flex items-center gap-2 rounded-full bg-white/95 px-3.5 py-2 shadow-sm">
          <button type="button" onClick={() => onOpenChat(o.shopId, o.id)} className="flex items-center gap-1 active:opacity-60">
            <Headphones className="h-4 w-4 text-black/75" strokeWidth={2} />
            <span className="text-[13px] text-black/75">客服</span>
          </button>
          <span className="h-3.5 w-px bg-black/10" />
          <button type="button" onClick={() => onToast('更多操作（演示）')} className="active:opacity-60">
            <MoreHorizontal className="h-4 w-4 text-black/75" strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto pb-8">
        <TbExpressMap phase={phase} etaTitle={eta.title} etaSub={eta.sub} addrDetail={o.address?.detail} riderProg={riderProg} />
        {/* 白卡（压住地图底部圆角） */}
        <div className="relative z-10 -mt-4 rounded-t-2xl bg-white px-4 pb-3 pt-4">
          {/* 快递公司行 */}
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#1677FF]/10 text-[11px] font-bold text-[#1677FF]">{co.slice(0, 1)}</span>
            <span className="min-w-0 truncate text-[15px] font-semibold text-black/85">
              {co} {trackNo}
            </span>
            <span className="ml-auto flex shrink-0 items-center text-[13.5px] text-black/60">
              <button type="button" onClick={() => copyText(trackNo, '运单号已复制')} className="active:opacity-60">
                复制
              </button>
              <span className="mx-2.5 h-3.5 w-px bg-black/10" />
              <button type="button" onClick={() => onToast(`拨打 ${co} 官方电话`)} className="active:opacity-60">
                打电话
              </button>
            </span>
          </div>
          {/* 时间线（前 4 条） */}
          <div className="mt-4">
            {entries.slice(0, 4).map((e, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ${i === 0 ? 'bg-[#FF5000]' : 'border-2 border-black/15 bg-white'}`} />
                  {i < Math.min(4, entries.length) - 1 ? <span className="my-1 w-px flex-1 border-l border-dashed border-black/12" /> : null}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-[15px] ${i === 0 ? 'font-bold text-[#FF5000]' : 'font-medium text-black/80'}`}>{e.title}</span>
                    <span className={`text-[13px] ${i === 0 ? 'text-[#FF5000]' : 'text-black/40'}`}>{fmtTime(e.at)}</span>
                  </div>
                  <div className="mt-1 text-[13.5px] leading-[21px] text-black/70">
                    <TbDescText text={e.desc} phone={e.phone} />
                  </div>
                  {/* 派送中：骑手卡 */}
                  {i === 0 && phase === 'delivering' ? (
                    <div className="mt-2.5 flex items-center gap-3 rounded-xl bg-[#F7F8FA] px-3.5 py-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[#FF6A00]/10">
                        <img src={mtRiderSrcOf(mtGetRiderId())} alt={man} className="h-10 w-10 object-contain" draggable={false} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold text-black/85">{man}</div>
                        <div className="mt-0.5 text-[12px] text-black/45">快递员在奋力配送中</div>
                      </div>
                      <button type="button" onClick={() => onToast(`拨打快递员 ${manPhone}`)} className="flex shrink-0 flex-col items-center gap-0.5 active:opacity-60">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm">
                          <Phone className="h-4 w-4 text-black/75" strokeWidth={2} />
                        </span>
                        <span className="text-[10px] text-black/50">电话</span>
                      </button>
                    </div>
                  ) : null}
                  {/* 待取件：驿站卡 */}
                  {i === 0 && phase === 'station' ? (
                    <div className="mt-2.5 rounded-xl bg-[#F7F8FA] px-3.5 py-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-semibold text-black/85">{station}</div>
                          <div className="mt-0.5 truncate text-[12px] text-black/40">{o.address?.region.replace(/\s+/g, '') ?? ''}</div>
                        </div>
                        <button type="button" onClick={() => onToast(`拨打驿站电话 ${manPhone}`)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white shadow-sm active:opacity-60">
                          <Phone className="h-4 w-4 text-black/75" strokeWidth={2} />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <span className="shrink-0 text-[13px] text-black/55">取件码</span>
                        <span className="text-[26px] font-bold tracking-wide text-black/90">{pickCode}</span>
                        <button type="button" onClick={() => copyText(pickCode, '取件码已复制')} className="text-[13px] text-black/45 active:opacity-60">
                          复制
                        </button>
                      </div>
                      <div className="mt-1 flex items-center">
                        <span className="text-[12px] text-[#FF6A1E]">驿站距您较远，有疑问可联系快递员</span>
                        <button type="button" onClick={() => onToast(`已通知快递员 ${man}`)} className="ml-auto flex items-center text-[13px] text-[#FF6A1E] active:opacity-70">
                          去联系
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {/* 需求（第五轮）：一键取件 = 确认收货（物流页同口径）；已签收后不再显示操作钮 */}
                      {o.status === 'shipped' ? (
                        <div className="mt-2.5 flex gap-2.5">
                          <button type="button" onClick={() => onToast('已生成帮取码，可分享给亲友')} className="h-9 flex-1 rounded-lg border border-black/12 bg-white text-[13px] text-black/70 active:opacity-70">
                            找人帮取
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (o.status === 'shipped' && tbConfirmReceive(uid, o.id)) {
                                tbPushMsg(uid, { kind: 'logistics', title: '确认收货', text: `订单已确认收货 ¥${fmtMoney(o.total)}，记得评价哦`, orderId: o.id });
                                onToast('取件成功，已确认收货');
                                setTick((n) => n + 1);
                              }
                            }}
                            className="h-9 flex-1 rounded-lg border border-black/12 bg-white text-[13px] text-black/70 active:opacity-70"
                          >
                            一键取件
                          </button>
                        </div>
                      ) : (
                        <div className="mt-2.5 flex items-center gap-1.5 text-[13px] text-[#00B578]">
                          <Check className="h-4 w-4" strokeWidth={2.4} />
                          已签收，包裹已从驿站取出
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setDetailOpen(true)} className="flex items-center gap-1 pb-1 text-[13px] text-black/45 active:opacity-70">
            查看更多物流明细
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        {/* 送至地址 */}
        {o.address ? (
          <div className="mt-2 bg-white px-4 py-3.5">
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-[18px] w-[18px] shrink-0 text-black/80" strokeWidth={2.1} />
              <div className="min-w-0 flex-1">
                <div className="text-[15.5px] font-semibold text-black/85">
                  送至 {o.address.region.replace(/\s+/g, '')} {o.address.detail}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-black/45">
                  {o.address.name} {tbMaskPhone(o.address.phone)}
                  <span className="rounded border border-black/10 px-1 py-px text-[10px] text-black/40">号码保护中</span>
                  <span className="rounded border border-[#FF6A1E]/40 px-1 py-px text-[10px] text-[#FF6A1E]">取件出示虚拟号 {'>'}</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {/* 店铺商品 */}
        <div className="mt-2 bg-white px-4 py-3">
          <div className="flex items-center gap-1.5">
            {shop.tmall ? <TmallMark /> : <span className="mr-1 inline-block rounded-[3px] bg-[#FF5000] px-1 py-[1px] text-[10px] font-bold leading-none text-white">淘宝</span>}
            <span className="truncate text-[14.5px] font-semibold text-black/85">{shop.name}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/30" />
          </div>
          {o.items.map((it, i) => (
            <button key={i} type="button" onClick={() => onOpenProduct(it.pid)} className="mt-2.5 flex w-full gap-2.5 text-left">
              <img src={it.img} alt={it.title} className="h-[64px] w-[64px] shrink-0 rounded-lg object-cover" draggable={false} />
              <div className="min-w-0 flex-1">
                <div className="flex gap-2">
                  <span className="line-clamp-1 min-w-0 flex-1 text-[13.5px] leading-5 text-black/85">{it.title}</span>
                  <span className="shrink-0 text-[13.5px] leading-5 text-black/70">¥{fmtMoney(it.price)}</span>
                </div>
                <div className="mt-0.5 flex items-center">
                  <span className="truncate text-[12px] text-black/40">{Object.entries(it.sku).map(([k, v]) => `${k}：${v}`).join('；')}</span>
                  <span className="ml-auto shrink-0 text-[12px] text-black/40">x{it.qty}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 详细信息弹层（截图2） */}
      {detailOpen ? (
        <div className="absolute inset-0 z-50 flex flex-col bg-white">
          <div className="relative flex items-center justify-center pb-1 pt-[58px]">
            <span className="text-[17px] font-semibold text-black/90">详细信息</span>
            <button type="button" aria-label="关闭" onClick={() => setDetailOpen(false)} className="absolute right-3 top-[60px] grid h-9 w-9 place-items-center rounded-full bg-black/[0.04] active:opacity-60">
              <X className="h-[18px] w-[18px] text-black/70" strokeWidth={2.4} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-10 pt-3">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#FF6A00]/10 text-[11px] font-bold text-[#FF6A00]">菜</span>
              <span className="text-[15px] font-semibold text-black/85">官方物流</span>
              <span className="min-w-0 truncate text-[13px] text-black/45">{trackNo}</span>
              <button type="button" onClick={() => copyText(trackNo, '运单号已复制')} className="ml-auto shrink-0 text-[13.5px] text-black/60 active:opacity-60">
                复制
              </button>
            </div>
            <div className="mt-4">
              {detailEntries.map((e, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ${i === 0 ? 'bg-[#FF5000]' : 'border-2 border-black/15 bg-white'}`} />
                    {i < detailEntries.length - 1 ? <span className="my-1 w-px flex-1 border-l border-dashed border-black/12" /> : null}
                  </div>
                  <div className="min-w-0 flex-1 pb-5">
                    <div className="flex items-baseline gap-2">
                      {e.title ? <span className={`text-[15px] ${i === 0 ? 'font-bold text-[#FF5000]' : 'font-medium text-black/80'}`}>{e.title}</span> : null}
                      <span className={`text-[13px] ${i === 0 ? 'text-[#FF5000]' : 'text-black/40'}`}>{fmtTime(e.at)}</span>
                    </div>
                    <div className="mt-1 text-[13.5px] leading-[21px] text-black/70">
                      <TbDescText text={e.desc} phone={e.phone} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------- 评价弹层 ----------------

const REVIEW_TAGS = ['质量很好', '物流很快', '包装精美', '性价比高', '客服态度好', '外观漂亮'];

function RateSheet({ order, uid, onClose, onToast }: { order: TbOrder; uid: string; onClose: () => void; onToast: (m: string) => void }) {
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div className="rounded-t-2xl bg-white p-4 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="text-center text-[16px] font-semibold text-black/85">评价商品</div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[13px] text-black/50">整体评分</span>
          <span className="flex gap-1">
            {Array.from({ length: 5 }, (_, i) => (
              <button key={i} type="button" aria-label={`${i + 1}星`} onClick={() => setRating(i + 1)} className="active:scale-90">
                <Star className={`h-6 w-6 ${i < rating ? 'fill-[#FFA400] text-[#FFA400]' : 'fill-black/10 text-black/10'}`} />
              </button>
            ))}
          </span>
          <span className="ml-auto text-[13px] text-[#FFA400]">{['非常差', '差', '一般', '满意', '超赞'][rating - 1]}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {REVIEW_TAGS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTags((v) => (v.includes(t) ? v.filter((x) => x !== t) : [...v, t]))}
              className={`rounded-lg border px-3 py-1 text-[12px] ${tags.includes(t) ? 'border-[#FF5000] bg-[#FF5000]/[0.06] text-[#FF5000]' : 'border-black/10 text-black/55'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="宝贝满足你的期待吗？说说它的优点和不足吧"
          rows={4}
          className="mt-3 w-full resize-none rounded-xl bg-black/[0.03] p-3 text-[14px] outline-none placeholder:text-black/30"
        />
        <button
          type="button"
          onClick={() => {
            if (!content.trim()) {
              onToast('写点评价内容吧');
              return;
            }
            if (tbSubmitReview(uid, order.id, rating, content.trim(), tags)) {
              onToast('评价成功，感谢分享');
              onClose();
            } else onToast('评价失败，请稍后重试');
          }}
          className="mt-3 h-11 w-full rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[15px] font-semibold text-white active:opacity-85"
        >
          发布评价
        </button>
      </div>
    </div>
  );
}

// ---------------- 我的淘宝 ----------------

function MePage({
  session,
  uid,
  onOpenOrders,
  onOpenFavorites,
  onOpenFootprints,
  onOpenAddresses,
  onOpenCoupons,
  onOpenExpress,
  onOpenSettings,
  onOpenMsgs,
  onOpenShopFollows,
  onOpenProduct,
  onToast,
  onOpenWallet,
  onOpenCouponCenter,
  onOpenBill,
}: {
  session: TbSession;
  uid: string;
  onOpenOrders: (tab: TbOrderStatus | 'all') => void;
  onOpenFavorites: () => void;
  onOpenFootprints: () => void;
  onOpenAddresses: () => void;
  onOpenCoupons: () => void;
  onOpenExpress: () => void;
  onOpenSettings: () => void;
  onOpenMsgs: () => void;
  onOpenShopFollows: () => void;
  onOpenProduct: (pid: string) => void;
  onToast: (m: string) => void;
  onOpenWallet: () => void;
  onOpenCouponCenter: () => void;
  onOpenBill: () => void;
}) {
  const [, setTick] = useState(0);
  // 骑手形象选择（需求：我的淘宝淘金币入口改为骑手，复用美团 mt-rider 全套形象；
  // 选中形象同时用于淘宝物流页地图巡航，与美团共用同一 localStorage）
  const [riderOpen, setRiderOpen] = useState(false);
  const [riderId, setRiderId] = useState<string>(() => mtGetRiderId());
  useEffect(() => {
    tbTickOrders(uid);
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [uid]);
  const orders = tbLoadOrders(uid);
  const count = (st: TbOrderStatus) => orders.filter((o) => o.status === st).length;
  // 需求（第十轮）：删除「N张共X元消费券待使用」条目；coupons 保留给资产行「优惠券 N张」计数
  const coupons = tbLoadCoupons(uid).filter((c) => !c.usedAt);
  const favs = tbLoadFavs(uid);
  const foots = tbLoadFoots(uid);
  const follows = tbLoadShopFollows(uid);
  // 需求（第八轮）+ Task 40：「我的」界面顶部下拉 / 底部上拉都可刷新「猜你喜欢」——
  // 新一批前插到顶部，旧批次保留（最多留 3 批），不重排、不跳顶
  const [menuBatches, setMenuBatches] = useState<number[]>([0]);
  const menuSeq = useRef(1);
  const mePull = useTbPullRefresh(() => {
    const seed = menuSeq.current++;
    setMenuBatches((bs) => [seed, ...bs].slice(0, 3));
    onToast('已为你换上新的好物，旧推荐都还在哦');
  });
  // 猜你喜欢菜单（批次前插：最新批在最上，旧批次原位保留）
  const meMenu = useMemo(() => {
    const arr = [...TB_PRODUCTS];
    return menuBatches.flatMap((k) => {
      const start = (14 + k * 8) % arr.length;
      return Array.from({ length: 8 }, (_, i) => ({ p: arr[(start + i) % arr.length], k: `${k}-${i}` }));
    });
  }, [menuBatches]);
  return (
    <>
    <div className="relative h-full">
    <div ref={mePull.scrollRef} {...mePull.bind} className="h-full overflow-y-auto bg-[#f4f4f4] pb-24">
      {/* 头部（需求：橙色改肉粉色 + 美化，截图3 口径：奶油粉底 + 黑字 + 白卡） */}
      <div className="bg-gradient-to-b from-[#FCDBC4] via-[#FDE3D2] to-[#FBEDE2] px-4 pb-4 pt-[62px]">
        <div className="flex items-center gap-3">
          {session.avatar ? (
            <img src={session.avatar} alt={session.name} className="h-14 w-14 rounded-full border-2 border-[#FF7A2E]/70 object-cover" draggable={false} />
          ) : (
            <span className="grid h-14 w-14 place-items-center rounded-full border-2 border-[#FF7A2E]/70 bg-white/60 text-[20px] font-bold text-[#B4632A]">{session.name.slice(0, 1)}</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[19px] font-bold text-black/90">{session.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="rounded bg-gradient-to-r from-[#8A4D16] to-[#A56428] px-1.5 py-[1px] text-[10px] font-bold text-[#FFE3C2]">青铜会员</span>
              <span className="text-[11px] text-black/55">{follows.length}家关注店铺</span>
            </div>
          </div>
          <button type="button" onClick={onOpenAddresses} className="flex flex-col items-center gap-0.5 text-black/80">
            <MapPin className="h-[21px] w-[21px]" strokeWidth={1.9} />
            <span className="text-[10px]">地址</span>
          </button>
          <button type="button" onClick={() => onToast('官方客服（演示）')} className="flex flex-col items-center gap-0.5 text-black/80">
            <Headphones className="h-[21px] w-[21px]" strokeWidth={1.9} />
            <span className="text-[10px]">官方客服</span>
          </button>
          <button type="button" onClick={onOpenSettings} className="flex flex-col items-center gap-0.5 text-black/80">
            <SettingsIcon className="h-[21px] w-[21px]" strokeWidth={1.9} />
            <span className="text-[10px]">设置</span>
          </button>
        </div>
        {/* 消费明细白卡（第九轮：标题点击进淘宝账单页；会员中心/省钱卡等宽平行；资产行 label/value 统一行高平行） */}
        <div className="mt-3 rounded-2xl bg-white p-3">
          <div className="flex items-center">
            <button type="button" onClick={onOpenBill} className="flex items-center gap-0.5 active:opacity-70">
              <span className="text-[17px] font-bold text-black/90">我的消费明细</span>
              <ChevronRight className="h-4 w-4 text-black/35" />
            </button>
            <div className="ml-auto flex items-center">
              <button type="button" onClick={onOpenCouponCenter} className="flex w-[86px] flex-col items-start leading-tight active:opacity-70">
                <span className="text-[13.5px] font-bold text-[#FF4400]">会员中心</span>
                <span className="mt-0.5 text-[10.5px] text-black/40">闪购券50元起 &gt;</span>
              </button>
              <span className="mx-2.5 h-7 w-px bg-black/[0.07]" />
              <button type="button" onClick={onOpenCouponCenter} className="flex w-[64px] flex-col items-start leading-tight active:opacity-70">
                <span className="text-[13.5px] font-bold text-[#FF4400]">省钱卡</span>
                <span className="mt-0.5 text-[10.5px] text-black/40">免费领 &gt;</span>
              </button>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#FF3B30] to-[#FF0036]">
                <span className="grid h-8 w-8 place-items-center rounded-md border border-white/40 text-center text-[9px] font-bold leading-[10px] text-[#FFD100]">免费
                  <br />领</span>
              </span>
            </div>
          </div>
          {/* 资产行（label 上 value 下；value 统一 h-[18px] 居中保证五列平行） */}
          <div className="mt-1 flex items-center">
            <button type="button" onClick={() => onToast('红包 ¥0.00（演示）')} className="flex flex-1 flex-col items-center py-1.5 active:opacity-70">
              <span className="text-[12px] leading-none text-black/45">红包</span>
              <span className="mt-1.5 flex h-[18px] items-center justify-center text-[16px] font-bold leading-none text-black/90">
                <span className="text-[11px] font-semibold">¥</span>0
              </span>
            </button>
            <button type="button" onClick={onOpenCoupons} className="flex flex-1 flex-col items-center py-1.5 active:opacity-70">
              <span className="text-[12px] leading-none text-black/45">优惠券</span>
              <span className="mt-1.5 flex h-[18px] items-center justify-center text-[16px] font-bold leading-none text-black/90">{coupons.length}张</span>
            </button>
            {/* 骑手（上轮需求保留：淘金币位显示当前骑手形象，点按弹选择层） */}
            <button type="button" data-testid="my-rider" onClick={() => setRiderOpen(true)} className="flex flex-1 flex-col items-center py-1.5 active:opacity-70">
              <span className="text-[12px] leading-none text-black/45">骑手</span>
              <span className="mt-1.5 flex h-[18px] items-center justify-center">
                <img src={mtRiderSrcOf(riderId)} alt="骑手形象" draggable={false} className="h-[17px] w-[17px] object-contain" />
              </span>
            </button>
            <button type="button" onClick={onOpenWallet} className="flex flex-1 flex-col items-center py-1.5 active:opacity-70">
              <span className="text-[12px] leading-none text-black/45">账户余额</span>
              <span className="mt-1.5 flex h-[18px] items-center justify-center text-[13px] font-bold leading-none text-black/90">微信/QQ</span>
            </button>
            <button type="button" onClick={() => onToast('天猫积分 0（演示）')} className="flex flex-1 flex-col items-center py-1.5 active:opacity-70">
              <span className="text-[12px] leading-none text-black/45">天猫积分</span>
              <span className="mt-1.5 flex h-[18px] items-center justify-center text-[16px] font-bold leading-none text-black/90">0</span>
            </button>
          </div>
        </div>
        {/* 需求（第十轮）：原「N张共X元消费券待使用」条目已删除 */}
      </div>
      {/* 快捷入口（截图3：细线描边黑色图标，无底色圆） */}
      <div className="mx-2 mt-2 grid grid-cols-4 gap-2 rounded-xl bg-white p-3">
        {[
          { icon: Package, label: '快递', on: onOpenExpress },
          { icon: Star, label: `收藏${favs.length ? `(${favs.length})` : ''}`, on: onOpenFavorites },
          { icon: Store, label: '关注店铺', on: onOpenShopFollows },
          { icon: ClockIcon, label: `足迹${foots.length ? `(${foots.length})` : ''}`, on: onOpenFootprints },
        ].map((it) => (
          <button key={it.label} type="button" onClick={it.on} className="flex flex-col items-center gap-1.5 py-1 active:opacity-60">
            <it.icon className="h-[26px] w-[26px] text-black/85" strokeWidth={1.6} />
            <span className="text-[12px] text-black/70">{it.label}</span>
          </button>
        ))}
      </div>
      {/* 我的订单 */}
      <div className="mx-2 mt-2 rounded-xl bg-white p-3">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold text-black/85">我的订单</span>
          <button type="button" onClick={() => onOpenOrders('all')} className="flex items-center text-[13px] text-black/40">
            全部
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1">
          {[
            { st: 'pendingPay' as TbOrderStatus, label: '待付款', n: count('pendingPay') },
            { st: 'pendingDeliver' as TbOrderStatus, label: '待发货', n: count('pendingDeliver') },
            { st: 'shipped' as TbOrderStatus, label: '待收货', n: count('shipped') },
            { st: 'completed' as TbOrderStatus, label: '待评价', n: orders.filter((o) => o.status === 'completed' && !o.review).length },
            { st: 'cancelled' as TbOrderStatus, label: '退款/售后', n: orders.filter((o) => o.refund).length },
          ].map((it) => (
            <button key={it.label} type="button" onClick={() => onOpenOrders(it.st)} className="flex flex-col items-center gap-1.5 py-1 active:opacity-60">
              <span className="relative">
                {/* 截图3：细线描边黑色图标（无底色圆） */}
                {it.st === 'pendingPay' ? <Wallet className="h-[25px] w-[25px] text-black/85" strokeWidth={1.6} /> : it.st === 'pendingDeliver' ? <ShoppingBag className="h-[25px] w-[25px] text-black/85" strokeWidth={1.6} /> : it.st === 'shipped' ? <Truck className="h-[25px] w-[25px] text-black/85" strokeWidth={1.6} /> : it.st === 'completed' ? <MessageSquare className="h-[25px] w-[25px] text-black/85" strokeWidth={1.6} /> : <CircleCheck className="h-[25px] w-[25px] text-black/85" strokeWidth={1.6} />}
                {it.n > 0 ? <span className="absolute -right-1 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#FF4400] px-1 text-[10px] font-bold text-white">{it.n}</span> : null}
              </span>
              <span className="text-[11px] text-black/60">{it.label}</span>
            </button>
          ))}
        </div>
      </div>
      {/* 超级88 领券中心（需求：开发领券中心；入口卡 + 更多> 进领券中心页） */}
      <div className="mx-2 mt-2 rounded-xl bg-white p-3">
        <div className="flex items-center">
          <button type="button" onClick={onOpenCouponCenter} className="flex items-center gap-1.5 active:opacity-70">
            <span className="text-[17px] font-black italic leading-none text-[#FF2600]">超级88</span>
            <span className="text-[15px] font-bold text-black/90">领券中心</span>
          </button>
          <button type="button" onClick={onOpenCouponCenter} className="ml-auto flex items-center text-[12.5px] text-black/40 active:opacity-70">
            更多
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2.5 grid grid-cols-4 gap-2">
          {[
            { amount: 38, label: '消费券', btn: '去使用', go: true },
            { amount: 15, label: '母婴加补券', btn: '' },
            { amount: 20, label: '超市加补券', btn: '' },
            { amount: 60, label: '店铺优惠券', btn: '' },
          ].map((t) => {
            const claimed = t.go ? false : tbLoadCoupons(uid).some((x) => x.name === t.label && !x.usedAt);
            return (
              <div key={t.label} className="rounded-lg bg-gradient-to-b from-[#FFE9EC] to-[#FFDCE2] p-1.5 text-center">
                <div className="text-[17px] font-bold leading-[22px] text-[#FF1E00]">
                  <span className="text-[10px]">¥</span>
                  {t.amount}
                </div>
                <div className="truncate text-[10.5px] leading-[14px] text-[#a04046]">{t.label}</div>
                <button
                  type="button"
                  onClick={() => {
                    if (t.go) {
                      onOpenCouponCenter();
                      return;
                    }
                    if (claimed) {
                      onToast('已领取过该券');
                      return;
                    }
                    tbClaimCoupon(uid, { name: t.label, amount: t.amount, min: 0, pids: [] });
                    setTick((n) => n + 1);
                    onToast(`领取成功：${t.label} ¥${t.amount}`);
                  }}
                  className={`mt-1 w-full rounded-[5px] py-[3px] text-[11px] font-semibold ${claimed ? 'bg-black/[0.06] text-black/35' : 'bg-gradient-to-r from-[#FF3B30] to-[#FF0036] text-white active:opacity-85'}`}
                >
                  {t.go ? t.btn : claimed ? '已领取' : '去领取'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {/* 消息 + 猜你喜欢 */}
      <button type="button" onClick={onOpenMsgs} className="mx-2 mt-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-xl bg-white px-4 py-3 active:opacity-80">
        <Bell className="h-5 w-5 text-[#FF5000]" />
        <span className="text-[14px] font-medium text-black/80">消息通知</span>
        <span className="ml-auto text-[12px] text-black/35">{tbLoadMsgs(uid).length > 0 ? `${tbLoadMsgs(uid).length}条动态` : '暂无消息'}</span>
        <ChevronRight className="h-4 w-4 text-black/25" />
      </button>
      <div className="mx-2 mt-2 rounded-xl bg-white p-3">
        <div className="mb-2 flex items-center gap-4">
          <span className="text-[15px] font-semibold text-[#FF5000]">猜你喜欢</span>
          <span className="text-[14px] text-black/40">我的收藏</span>
          <span className="text-[14px] text-black/40">我的评价</span>
        </div>
        {/* 下拉/上拉刷新提示（Task 40：两方向都可刷新，新推荐前插、旧推荐保留） */}
        {mePull.refreshing ? (
          <div className="flex items-center justify-center gap-2 py-2 text-[12.5px] text-black/45">
            <Loader2 className="h-4 w-4 animate-spin text-[#FF5000]" />
            正在刷新…
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {meMenu.map(({ p, k }, i) => (
            <ProductCard key={k} p={p} v={i % 4} onOpen={() => onOpenProduct(p.id)} />
          ))}
        </div>
        <div className="pt-2 text-center text-[11.5px] text-black/30">下拉或滑到底部拉一拉，都可刷新推荐</div>
      </div>
    </div>
    <TbPullIndicator h={mePull} />
    </div>
    {/* 骑手形象选择（需求：淘金币入口改为骑手；底部弹层复用美团 MT_RIDERS 全套形象，
        选中后同时用于淘宝物流页地图巡航与美团配送地图，共用同一形象） */}
    {riderOpen ? (
      <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" onClick={() => setRiderOpen(false)}>
        <div className="rounded-t-2xl bg-white [animation:quick-in-up_.26s_cubic-bezier(0.32,0.72,0,1)_both]" onClick={(e) => e.stopPropagation()} data-testid="rider-sheet">
          <div className="relative flex items-center justify-center pb-3 pt-5">
            <span className="text-[17px] font-bold text-black/90">选择骑手形象</span>
            <button type="button" aria-label="关闭" onClick={() => setRiderOpen(false)} className="absolute right-4 top-5 grid h-7 w-7 place-items-center active:opacity-60">
              <X className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
            </button>
          </div>
          <p className="px-5 pb-3 text-[12px] text-black/40">内置 {MT_RIDERS.length} 位骑手 · 骑手会把你的包裹送到驿站</p>
          <div className="grid max-h-[52vh] grid-cols-3 gap-3 overflow-y-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {MT_RIDERS.map((r) => {
              const active = r.id === riderId;
              return (
                <button
                  key={r.id}
                  type="button"
                  data-testid={`rider-${r.id}`}
                  onClick={() => {
                    setRiderId(r.id);
                    mtSetRiderId(r.id);
                    setRiderOpen(false);
                    onToast(`骑手「${r.name}」已接单，为你的包裹护航`);
                  }}
                  className={`relative flex flex-col items-center rounded-2xl px-2 pb-2.5 pt-3 transition-all active:scale-[0.97] ${active ? 'bg-[#FFF1E6] ring-2 ring-[#FF5000]' : 'bg-[#F7F8FA] ring-1 ring-black/[0.04]'}`}
                >
                  {active ? (
                    <span className="absolute right-1.5 top-1.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-[#FF5000]">
                      <Check className="h-3 w-3 text-white" strokeWidth={3} />
                    </span>
                  ) : null}
                  <img src={r.src} alt={r.name} draggable={false} className="h-20 w-20 object-contain" />
                  <span className={`mt-1 text-[12px] ${active ? 'font-semibold text-black/85' : 'text-black/60'}`}>{r.name}</span>
                </button>
              );
            })}
          </div>
          <div className="h-7" />
        </div>
      </div>
    ) : null}
    </>
  );
}

/** 账户余额弹层（微信零钱 + QQ 钱包只读展示） */
function WalletSheet({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const [wxBal, setWxBal] = useState<number | null>(null);
  const [qqBal, setQqBal] = useState<number | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const ww = await import('./wechat-wallet');
        setWxBal(ww.loadJSON<{ balance?: number }>(ww.LS_WALLET, {}).balance ?? 0);
      } catch {
        setWxBal(0);
      }
      try {
        const qq = await import('./qq');
        setQqBal(qq.loadWallet().balance);
      } catch {
        setQqBal(0);
      }
    })();
  }, []);
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div className="rounded-t-2xl bg-white p-4 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="text-center text-[16px] font-semibold text-black/85">账户余额</div>
        <div className="mt-1 text-center text-[12px] text-black/35">购物支付使用微信 / QQ 钱包余额，余额在对应 App 内管理</div>
        <div className="mt-4 space-y-2">
          <button type="button" onClick={() => onToast('到微信 App「我→服务→钱包」管理零钱')} className="flex w-full items-center gap-3 rounded-xl bg-black/[0.03] p-3.5 text-left active:opacity-70">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[#07C160] text-white">
              <Wallet className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <span className="flex-1">
              <span className="block text-[15px] font-medium text-black/85">微信零钱</span>
              <span className="block text-[12px] text-black/40">微信支付时可用</span>
            </span>
            <span className="text-[18px] font-bold text-black/85">{wxBal === null ? '…' : `¥${fmtMoney(wxBal)}`}</span>
          </button>
          <button type="button" onClick={() => onToast('到 QQ App「头像→我的钱包」管理余额')} className="flex w-full items-center gap-3 rounded-xl bg-black/[0.03] p-3.5 text-left active:opacity-70">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[#12B7F5] text-white">
              <Wallet className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <span className="flex-1">
              <span className="block text-[15px] font-medium text-black/85">QQ钱包余额</span>
              <span className="block text-[12px] text-black/40">QQ支付时可用</span>
            </span>
            <span className="text-[18px] font-bold text-black/85">{qqBal === null ? '…' : `¥${fmtMoney(qqBal)}`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 消息页（交易物流 / 售后保障） ----------------

/** 消息页服务号行通用（截图2：彩色圆角方图标 + 标题 + 副标 + 右侧时间） */
function MsgServiceRow({ icon, title, sub, time, onClick }: { icon: ReactNode; title: string; sub: string; time?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-[13px] text-left active:bg-black/[0.03]">
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-[16.5px] font-bold text-black/90">{title}</span>
        <span className="mt-0.5 block truncate text-[13.5px] text-black/45">{sub}</span>
      </span>
      {time ? <span className="shrink-0 text-[12px] text-black/30">{time}</span> : null}
    </button>
  );
}

/** 消息页（截图2：白色大标题 + 清除未读 + 服务号三行 + 店铺会话列表） */
function MsgsPage({
  uid,
  onOpenOrder,
  onOpenExpress,
  onOpenRefundOrders,
  onOpenCouponCenter,
  onOpenChat,
  onToast,
}: {
  uid: string;
  onOpenOrder: (id: string) => void;
  onOpenExpress: () => void;
  onOpenRefundOrders: () => void;
  onOpenCouponCenter: () => void;
  /** 进入店铺客服聊天（Task 41：消息页会话点击 → AI 客服聊天） */
  onOpenChat: (shopId: string) => void;
  onToast: (m: string) => void;
}) {
  const [, setTick] = useState(0);
  const msgs = tbLoadMsgs(uid);
  const unread = tbMsgUnreadCount(uid);
  const lastLogi = msgs.find((m) => m.kind === 'logistics');
  const lastRefund = msgs.find((m) => m.kind === 'refund');
  // 店铺会话（Task 41 合并两种来源：①客服聊天会话（持久化 tb-chat）②系统消息聚合；聊天有未读角标）
  const orders = tbLoadOrders(uid);
  const chats = (() => {
    type ChatRow = { key: string; name: string; text: string; at: number; orderId?: string; tag?: string; tmall?: boolean; shopId?: string; unread: number };
    const map = new Map<string, ChatRow>();
    // ① 客服聊天会话（AI 客服消息持久化；点击进聊天页）
    for (const cs of tbChatShops(uid)) {
      const shop = shopById(cs.shopId);
      const last = tbChatLast(uid, cs.shopId);
      if (!last) continue;
      const preview = last.text
        ? last.text
        : last.card?.type === 'product'
          ? `【宝贝】${productById(last.card.pid)?.title ?? '商品卡片'}`
          : '【订单】你正在咨询的订单';
      map.set(shop.id, {
        key: `cs-${shop.id}`,
        name: shop.name,
        text: (last.role === 'user' ? '我：' : '') + preview,
        at: last.at,
        tag: shop.tag,
        tmall: shop.tmall,
        shopId: shop.id,
        unread: tbChatUnread(uid, shop.id),
      });
    }
    // ② 系统消息聚合（同店铺已有聊天会话时跳过，避免重复行）
    for (const m of msgs) {
      const order = m.orderId ? orders.find((o) => o.id === m.orderId) : undefined;
      const shop = order ? shopById(order.shopId) : undefined;
      if (shop && map.has(shop.id)) continue;
      const name = shop?.name ?? m.title;
      const prev = map.get(name);
      if (!prev || m.at > prev.at) {
        map.set(name, { key: prev?.key ?? m.id, name, text: m.text, at: m.at, orderId: m.orderId ?? prev?.orderId, tag: shop?.tag, tmall: shop?.tmall, unread: prev?.unread ?? 0 });
      } else if (!prev.orderId && m.orderId) {
        prev.orderId = m.orderId;
      }
    }
    return [...map.values()].sort((a, b) => b.at - a.at);
  })();
  /** 服务号行（模块级 MsgServiceRow） */
  return (
    // 需求（第八轮）：消息界面白色简洁风（截图2），消息 tab 根页面无返回键
    <div className="flex h-full flex-col bg-white">
      {/* 大标题头（消息 + 清除未读 + 搜索/通讯录/加号） */}
      <div className="sticky top-0 z-30 bg-white px-4 pb-2 pt-[56px]">
        <div className="flex items-center gap-2">
          <span className="text-[27px] font-bold leading-none tracking-tight text-black/92">消息</span>
          <button
            type="button"
            data-testid="clear-unread"
            onClick={() => {
              tbSetMsgsReadAt(uid, Date.now());
              setTick((n) => n + 1);
              onToast('已清除未读');
            }}
            className="ml-1 flex h-[30px] items-center gap-1 rounded-full bg-black/[0.045] px-2.5 text-[12.5px] text-black/60 active:opacity-70"
          >
            <BroomIcon />
            清除未读
            {unread > 0 ? <span className="text-[#FF4400]">{unread}</span> : null}
          </button>
          <div className="ml-auto flex items-center gap-4">
            <button type="button" aria-label="搜索消息" onClick={() => onToast('搜索消息（演示）')} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
              <Search className="h-[21px] w-[21px] text-black/85" strokeWidth={2.1} />
            </button>
            <button type="button" aria-label="通讯录" onClick={() => onToast('通讯录（演示）')} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
              <ContactScanIcon />
            </button>
            <button type="button" aria-label="发起" onClick={() => onToast('发起聊天（演示）')} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
              <Plus className="h-[22px] w-[22px] text-black/85" strokeWidth={2.1} />
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto pb-8">
        {/* 服务号固定行：交易物流 / 售后保障（截图2） */}
        <div className="pt-1">
          <MsgServiceRow
            icon={
              <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-2xl bg-[#FF7A2E]">
                <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2.5 7.5A1.5 1.5 0 0 1 4 6h8.5a1.5 1.5 0 0 1 1.5 1.5V16H4.6L2.5 14V7.5Z" fill="#fff" />
                  <path d="M14 9h3.2c.5 0 .95.24 1.22.65L20.5 12.6c.2.28.3.6.3.94V15a1 1 0 0 1-1 1h-.6a2.4 2.4 0 0 0-4.7 0H14V9Z" fill="#fff" />
                  <circle cx="7" cy="17" r="1.9" fill="#fff" stroke="#FF7A2E" strokeWidth="1.2" />
                  <circle cx="16.8" cy="17" r="1.9" fill="#fff" stroke="#FF7A2E" strokeWidth="1.2" />
                </svg>
              </span>
            }
            title="交易物流"
            sub={lastLogi?.text ?? '暂无包裹动态更新'}
            onClick={onOpenExpress}
          />
          <MsgServiceRow
            icon={
              <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-2xl bg-[#2B7DE9]">
                <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M11 6H6.5A2.5 2.5 0 0 0 4 8.5v7A2.5 2.5 0 0 0 6.5 18H11V6Z" fill="#fff" opacity="0.55" />
                  <rect x="11" y="6" width="9" height="12" rx="2.4" fill="#fff" />
                  <path d="M16.6 9.6 13.8 12l2.8 2.4" stroke="#2B7DE9" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M13.8 12h4" stroke="#2B7DE9" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </span>
            }
            title="售后保障"
            sub={lastRefund?.text ?? '您的订单已退款成功'}
            time={lastRefund ? fmtChatTime(lastRefund.at) : '26/02/12'}
            onClick={onOpenRefundOrders}
          />
        </div>
        {/* 灰色分隔带（截图2 服务区与会话区分隔） */}
        <div className="h-[7px] bg-[#F5F6F7]" />
        {/* 活动优惠（服务号） */}
        <MsgServiceRow
          icon={
            <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-2xl bg-[#FF3B30]">
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3.5 9.2c0-.7.5-1.3 1.2-1.4C7 7.3 8.4 6 9.3 4.3c.3-.6 1.1-.8 1.7-.4l8 5.2c.6.4.8 1.2.4 1.8-1 1.7-1.3 3.6-.8 5.6.2.7-.3 1.4-1 1.5-2.3.5-3.7 1.8-4.6 3.5-.3.6-1.1.8-1.7.4l-8-5.2a1.3 1.3 0 0 1-.4-1.8c1-1.7 1.3-3.6.8-5.6l-.2-.1Z" fill="#fff" />
                <text x="12.6" y="13.6" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#FF3B30" fontFamily="system-ui, sans-serif">¥</text>
              </svg>
            </span>
          }
          title="活动优惠"
          sub="免单名额火热派送中！"
          time="17:07"
          onClick={onOpenCouponCenter}
        />
        {/* 店铺会话列表（截图2：方头像 + 名称 + 预览 + 时间） */}
        {chats.length === 0 ? (
          <div className="grid place-items-center pt-16">
            <TbMsgTabIcon active={false} size={52} />
            <div className="mt-3 text-[15px] text-black/40">还没有消息哦</div>
          </div>
        ) : (
          <div>
            {chats.map((c, i) => (
              <button
                key={c.key}
                type="button"
                onClick={() => {
                  // Task 41：客服聊天会话进聊天页；纯系统消息会话保持跳订单详情
                  if (c.shopId) onOpenChat(c.shopId);
                  else if (c.orderId) onOpenOrder(c.orderId);
                  else onToast('会话（演示）');
                }}
                className={`flex w-full items-center gap-3 px-4 py-[13px] text-left active:bg-black/[0.03] ${i < chats.length - 1 ? 'border-b border-black/[0.04]' : ''}`}
              >
                {c.tag ? (
                  <img src={tbImg(c.tag, 120, 120, 3)} alt={c.name} className="h-[46px] w-[46px] shrink-0 rounded-xl object-cover" draggable={false} />
                ) : (
                  <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-xl bg-[#F2F3F5] text-[17px] font-bold text-black/45">{c.name.slice(0, 1)}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-bold text-black/90">{c.name}</span>
                  <span className="mt-0.5 block truncate text-[13.5px] text-black/45">{c.text}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[12px] text-black/30">{fmtChatTime(c.at)}</span>
                  {c.unread > 0 ? (
                    <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#FF4400] px-1 text-[11px] font-bold leading-none text-white">{c.unread > 99 ? '99+' : c.unread}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- 地址管理 ----------------

function AddressListPage({ uid, onBack, onEdit, onToast, picker }: { uid: string; onBack: () => void; onEdit: (a: TbAddress | null) => void; onToast: (m: string) => void; picker?: boolean }) {
  const [list] = useState<TbAddress[]>(() => tbLoadAddrs(uid));
  const curId = tbCurAddrId(uid);
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <TopBar
        title="收货地址"
        onBack={onBack}
        right={
          <div className="flex items-center gap-3">
            <button type="button" aria-label="搜索地址" onClick={() => onToast('搜索地址（演示）')} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
              <Search className="h-[18px] w-[18px] text-black/75" strokeWidth={2.1} />
            </button>
            <button type="button" onClick={() => onToast('长按地址可删除')} className="text-[14px] text-black/70 active:opacity-60">
              管理
            </button>
            <button type="button" onClick={() => onEdit(null)} className="text-[14px] font-medium text-[#FF5000] active:opacity-60">
              新增地址
            </button>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto pb-24">
        {list.length === 0 ? (
          <div className="grid place-items-center bg-white py-16">
            <MapPin className="h-12 w-12 text-black/10" strokeWidth={1.6} />
            <div className="mt-3 text-[15px] text-black/45">还没有收货地址</div>
          </div>
        ) : (
          <div className="space-y-2 px-2 pt-2">
            {list.map((a) => (
              <div key={a.id} className="rounded-xl bg-white p-3.5">
                <button
                  type="button"
                  onClick={() => {
                    if (picker) {
                      // 地址选择模式（结算页）：点击选中返回
                      tbSetCurAddr(uid, a.id);
                      onToast('已选择该地址');
                    } else {
                      // 需求：地址列表不显示删除/编辑按钮，点击地址直接进入编辑
                      onEdit(a);
                    }
                  }}
                  className="flex w-full items-start gap-2.5 text-left"
                >
                  <span className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${curId === a.id ? 'border-[#FF5000] bg-[#FF5000]' : 'border-black/20'}`}>
                    {curId === a.id ? <Check className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold text-black/85">{a.name}</span>
                      <span className="text-[13px] text-black/45">{a.phone}</span>
                      {a.tag ? <span className="rounded bg-[#FF5000]/[0.08] px-1.5 py-0.5 text-[10px] text-[#FF5000]">{a.tag}</span> : null}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-5 text-black/60">{tbFullAddr(a)}</span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 z-30 border-t border-black/[0.06] bg-white/95 px-4 pb-6 pt-2 backdrop-blur-md">
        <button type="button" onClick={() => onEdit(null)} className="h-11 w-full rounded-xl bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[15px] font-semibold text-white active:opacity-85">
          新增收货地址
        </button>
      </div>
    </div>
  );
}

/** 新增/编辑地址（截图10：真实地图选址 + 智能粘贴 + 省市区 + 默认地址 + 6 标签） */
const TB_REGIONS: { name: string; lat: number; lon: number }[] = [
  { name: '浙江省杭州市西湖区文新街道', lat: 30.2845, lon: 120.0932 },
  { name: '河南省濮阳市濮阳县徐镇镇', lat: 35.7099, lon: 115.395 },
  { name: '广东省东莞市南城街道', lat: 23.0205, lon: 113.7563 },
  { name: '贵州省贵阳市乌当区', lat: 26.6497, lon: 106.76 },
];
const TB_ADDR_TAGS = ['家', '公司', '学校', '父母', '朋友', '自定义'];

/** 经纬度 → OSM 瓦片坐标（浮点） */
function tbLon2TileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}
function tbLat2TileY(lat: number, z: number): number {
  const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

/** 真实地图（OpenStreetMap 瓦片，服务端 /api/tb-tile 代理 + 缓存；3×3 视口，中心=定位点） */
function TbRealMap({ lat, lon, zoom = 15 }: { lat: number; lon: number; zoom?: number }) {
  const tx = tbLon2TileX(lon, zoom);
  const ty = tbLat2TileY(lat, zoom);
  const itx = Math.floor(tx);
  const ity = Math.floor(ty);
  const fx = tx - itx;
  const fy = ty - ity;
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#E8EDF2]" aria-label="选址地图">
      <div
        className="absolute left-1/2 top-1/2 h-[768px] w-[768px]"
        style={{ transform: `translate(calc(-50% - ${(fx - 0.5) * 256}px), calc(-50% - ${(fy - 0.5) * 256}px))` }}
      >
        {[-1, 0, 1].map((i) =>
          [-1, 0, 1].map((j) => (
            <img
              key={`${i},${j}`}
              src={`/api/tb-tile?z=${zoom}&x=${itx + i}&y=${ity + j}`}
              alt=""
              draggable={false}
              className="absolute h-[256px] w-[256px] max-w-none select-none bg-[#E8EDF2]"
              style={{ left: (i + 1) * 256, top: (j + 1) * 256 }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function AddressEditPage({ uid, editing, onBack, onToast }: { uid: string; editing: TbAddress | null; onBack: () => void; onToast: (m: string) => void }) {
  const [name, setName] = useState(editing?.name ?? '');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  const [region, setRegion] = useState(editing?.region?.replace(/\s+/g, '') ?? TB_REGIONS[0].name);
  const [regionOpen, setRegionOpen] = useState(false);
  const [detail, setDetail] = useState(editing?.detail ?? '');
  const [tag, setTag] = useState(editing?.tag && TB_ADDR_TAGS.includes(editing.tag) ? editing.tag : editing ? '自定义' : '家');
  const [customTag, setCustomTag] = useState(editing?.tag && !TB_ADDR_TAGS.includes(editing.tag) ? editing.tag : '');
  const [isDefault, setIsDefault] = useState(() => (editing ? tbCurAddrId(uid) === editing.id : tbLoadAddrs(uid).length === 0));
  /** 真实地图：中心坐标（预设区域坐标 / 搜索选中点） */
  const [latLon, setLatLon] = useState<{ lat: number; lon: number }>(() => {
    const hit = TB_REGIONS.find((r) => r.name === (editing?.region?.replace(/\s+/g, '') ?? ''));
    return hit ? { lat: hit.lat, lon: hit.lon } : { lat: TB_REGIONS[0].lat, lon: TB_REGIONS[0].lon };
  });
  /** 逆地理编码得到的真实地址行（省市区街道/村；需求：地图显示真实地址） */
  const [geoLine, setGeoLine] = useState('');
  /** 地址搜索：关键词 + 候选（/api/tb-geo?q=，Nominatim 正向） */
  const [searchKw, setSearchKw] = useState('');
  const [suggests, setSuggests] = useState<{ label: string; tail: string; full: string; lat: number; lon: number }[]>([]);
  const [searching, setSearching] = useState(false);
  /** 删除确认（编辑态：顶栏「删除」→ 二次确认弹层） */
  const [delOpen, setDelOpen] = useState(false);
  /** 用户是否主动改过所在地区（选预设/搜索选中）：初始编辑已有地址时不让反解码覆盖原 region */
  const regionTouched = useRef(!!editing);

  // 逆地理编码：地图中心变化 → /api/tb-geo?lat&lon 拉取真实地址（600ms 防抖，失败静默回退预设名）
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      fetch(`/api/tb-geo?lat=${latLon.lat}&lon=${latLon.lon}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('geo failed'))))
        .then((j: { region?: string; road?: string; formatted?: string }) => {
          if (!alive) return;
          const line = j.region || j.formatted || '';
          if (line) {
            setGeoLine(line);
            // 真实反解码区域回填（仅新建/用户主动换过定位点时；编辑已有地址不覆盖原 region）
            if (!regionTouched.current) setRegion(line.slice(0, 30));
          }
        })
        .catch(() => undefined);
    }, 600);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [latLon]);

  // 地址搜索建议：350ms 防抖（≥2 字才搜；setState 全部在定时器回调内，避免 effect 同步更新）
  useEffect(() => {
    const t = window.setTimeout(() => {
      const k = searchKw.trim();
      if (k.length < 2) {
        setSuggests([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      fetch(`/api/tb-geo?q=${encodeURIComponent(k)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('search failed'))))
        .then((arr: { label: string; tail: string; full: string; lat: number; lon: number }[]) => {
          setSuggests(Array.isArray(arr) ? arr : []);
        })
        .catch(() => setSuggests([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchKw]);

  const save = () => {
    if (!detail.trim()) {
      onToast('请填写详细地址与门牌号');
      return;
    }
    if (!name.trim()) {
      onToast('请填写收货人名字');
      return;
    }
    if (!/^1\d{10}$/.test(phone.trim())) {
      onToast('请填写正确的 11 位手机号');
      return;
    }
    const finalTag = tag === '自定义' ? customTag.trim() || '其他' : tag;
    const list = tbLoadAddrs(uid);
    if (editing) {
      const i = list.findIndex((a) => a.id === editing.id);
      if (i >= 0) list[i] = { ...editing, name: name.trim(), phone: phone.trim(), region: region.trim(), detail: detail.trim(), tag: finalTag };
      tbSaveAddrs(uid, list);
      if (isDefault) tbSetCurAddr(uid, editing.id);
      onToast('地址已保存');
    } else {
      const id = `tba${Date.now().toString(36)}`;
      tbSaveAddrs(uid, [...list, { id, name: name.trim(), phone: phone.trim(), region: region.trim(), detail: detail.trim(), tag: finalTag }]);
      // 默认地址勾选 / 首个地址自动设为默认
      if (isDefault || list.length === 0) tbSetCurAddr(uid, id);
      onToast('地址已添加');
    }
    onBack();
  };
  /** 删除地址（编辑态；至少保留一个） */
  const removeAddr = () => {
    if (!editing) return;
    const list = tbLoadAddrs(uid);
    if (list.length <= 1) {
      onToast('至少保留一个地址');
      setDelOpen(false);
      return;
    }
    const next = list.filter((x) => x.id !== editing.id);
    tbSaveAddrs(uid, next);
    if (tbCurAddrId(uid) === editing.id) tbSetCurAddr(uid, next[0]?.id ?? '');
    onToast('地址已删除');
    onBack();
  };
  /** 搜索建议选中：地图移到该点 + 真实区域回填 + 详址填入最小地名 */
  const pickSuggest = (s: { label: string; tail: string; full: string; lat: number; lon: number }) => {
    setLatLon({ lat: s.lat, lon: s.lon });
    regionTouched.current = true;
    setRegion(s.label.slice(0, 30));
    if (!detail.trim()) setDetail(s.tail || s.label);
    setSearchKw('');
    setSuggests([]);
    onToast('已定位到所选地址');
  };
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <div className="flex-1 overflow-y-auto pb-32">
        {/* 真实选址地图（沉浸式：需求「添加地址界面状态栏后面是地图」——地图延伸到页面最顶部，顶栏浮于地图上） */}
        <div className="relative h-[290px] overflow-hidden bg-[#E8EDF2]">
          <TbRealMap lat={latLon.lat} lon={latLon.lon} zoom={15} />
          {/* 悬浮顶栏（返回/标题/删除，白胶囊浮于地图上） */}
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-3 pt-[54px]">
            <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-white/95 shadow-sm active:opacity-70">
              <ArrowLeft className="h-[20px] w-[20px] text-black/75" strokeWidth={2.2} />
            </button>
            <span className="rounded-full bg-white/95 px-4 py-1.5 text-[15px] font-semibold text-black/85 shadow-sm">{editing ? '编辑地址' : '新增地址'}</span>
            {editing ? (
              <button type="button" onClick={() => setDelOpen(true)} className="grid h-9 min-w-[56px] place-items-center rounded-full bg-white/95 px-3 text-[14px] font-medium text-[#FF4400] shadow-sm active:opacity-70">
                删除
              </button>
            ) : (
              <span className="w-9" />
            )}
          </div>
          {/* 中心定位针 */}
          <svg className="absolute left-1/2 top-[58%] z-10 -translate-x-1/2 -translate-y-full drop-shadow-[0_3px_3px_rgba(0,0,0,0.3)]" width="32" height="40" viewBox="0 0 30 38" aria-hidden="true">
            <path d="M15 1C7.8 1 2 6.8 2 14c0 9.4 13 23 13 23s13-13.6 13-23C28 6.8 22.2 1 15 1Z" fill="#FF5000" />
            <circle cx="15" cy="14" r="5" fill="#fff" />
          </svg>
          <button type="button" aria-label="关闭选址" onClick={() => onToast('已定位到所选地址')} className="absolute right-3 top-[104px] z-10 grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm active:opacity-70">
            <X className="h-4 w-4 text-black/65" strokeWidth={2.4} />
          </button>
          <button type="button" aria-label="回正定位" onClick={() => {
            const hit = TB_REGIONS.find((r) => r.name === region) ?? TB_REGIONS[0];
            setLatLon({ lat: hit.lat, lon: hit.lon });
            onToast('已回到所选区域');
          }} className="absolute bottom-3 right-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-white shadow-sm active:opacity-70">
            <Crosshair className="h-[18px] w-[18px] text-black/70" strokeWidth={2} />
          </button>
          <span className="absolute bottom-1.5 left-2 z-10 text-[10px] text-black/45">© OpenStreetMap</span>
        </div>
        {/* 所在地区条（真实反解码地址：省市区/街道村） */}
        <div className="bg-[#F5F6F7] px-4 py-1.5 text-[12px] text-black/45">{geoLine || region}</div>
        {/* 白色表单（截图10下半） */}
        <div className="relative z-10 bg-white px-4 pb-4 pt-3">
          <div className="relative flex items-center gap-2">
            <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-[#F5F6F7] px-3.5">
              <Search className="h-4 w-4 shrink-0 text-black/35" strokeWidth={2.2} />
              <input
                value={searchKw}
                onChange={(e) => setSearchKw(e.target.value)}
                placeholder="搜索地址，更快填写"
                className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-black/30"
              />
              {searching ? <span className="text-[11px] text-black/30">搜索中…</span> : null}
            </div>
            {/* 搜索建议（真实地点，选中定位到地图） */}
            {suggests.length > 0 ? (
              <div className="absolute inset-x-0 top-[44px] z-20 divide-y divide-black/[0.04] overflow-hidden rounded-xl bg-white shadow-[0_8px_24px_rgba(0,0,0,0.14)]">
                {suggests.map((s, i) => (
                  <button key={i} type="button" onClick={() => pickSuggest(s)} className="block w-full px-3.5 py-2.5 text-left active:bg-black/[0.04]">
                    <span className="block truncate text-[14px] text-black/85">{s.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-black/35">{s.full}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {/* 所在地区 + 默认地址 */}
          <div className="mt-1">
            <div className="flex items-center gap-2 border-b border-black/[0.05] py-3.5">
              <span className="text-[15px] font-bold text-[#FF5000]">*</span>
              <button type="button" onClick={() => setRegionOpen((v) => !v)} className="flex min-w-0 items-center gap-1 text-[15px] text-black/85 active:opacity-70">
                <span className="truncate">{region}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-black/35" />
              </button>
              <button type="button" onClick={() => setIsDefault((v) => !v)} className="ml-auto flex shrink-0 items-center gap-1.5 active:opacity-70">
                <span className="text-[13px] text-black/55">默认地址</span>
                <span className={`grid h-[19px] w-[19px] place-items-center rounded-full ${isDefault ? 'bg-[#FF5000]' : 'border border-black/20 bg-white'}`}>
                  {isDefault ? <Check className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
                </span>
              </button>
            </div>
            {regionOpen ? (
              <div className="divide-y divide-black/[0.04] border-b border-black/[0.05]">
                {TB_REGIONS.map((r) => (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => {
                      setRegion(r.name);
                      regionTouched.current = true;
                      setLatLon({ lat: r.lat, lon: r.lon });
                      setRegionOpen(false);
                    }}
                    className={`block w-full py-2.5 text-left text-[14px] ${region === r.name ? 'font-medium text-[#FF5000]' : 'text-black/75'}`}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {/* 详细地址 */}
          <div className="border-b border-black/[0.05] py-3">
            <div className="flex items-center gap-2 text-[14px] text-black/45">
              <span className="text-[15px] font-bold text-[#FF5000]">*</span>
              详细地址与门牌号
            </div>
            <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="街道、门牌号、小区、楼栋号等" className="mt-1.5 w-full bg-transparent text-[16px] text-black/90 outline-none placeholder:text-black/25" />
          </div>
          {/* 收货人 */}
          <div className="border-b border-black/[0.05] py-3">
            <div className="flex items-center gap-2 text-[14px] text-black/45">
              <span className="text-[15px] font-bold text-[#FF5000]">*</span>
              收货人名字
            </div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="请填写收货人姓名" className="mt-1.5 w-full bg-transparent text-[16px] text-black/90 outline-none placeholder:text-black/25" />
          </div>
          {/* 手机号 */}
          <div className="border-b border-black/[0.05] py-3">
            <div className="flex items-center gap-2 text-[14px] text-black/45">
              <span className="text-[15px] font-bold text-[#FF5000]">*</span>
              手机号
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <button type="button" onClick={() => onToast('当前仅支持中国大陆手机号')} className="flex shrink-0 items-center gap-0.5 text-[16px] text-black/85 active:opacity-70">
                +86
                <ChevronDown className="h-4 w-4 text-black/40" />
              </button>
              <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} inputMode="numeric" placeholder="请填写手机号" className="min-w-0 flex-1 bg-transparent text-[16px] text-black/90 outline-none placeholder:text-black/25" />
            </div>
          </div>
          {/* 地址标签 */}
          <div className="pt-4">
            <div className="text-[15.5px] font-semibold text-black/85">地址标签</div>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {TB_ADDR_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTag(t)}
                  className={`h-10 rounded-lg border px-4 text-[14px] ${tag === t ? 'border-[#FF5000] font-medium text-[#FF5000]' : 'border-black/[0.12] text-black/70'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            {tag === '自定义' ? (
              <input value={customTag} onChange={(e) => setCustomTag(e.target.value)} placeholder="填写自定义标签，如：奶奶家" className="mt-3 h-10 w-full rounded-lg bg-black/[0.03] px-3.5 text-[14px] outline-none placeholder:text-black/25" />
            ) : null}
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 z-30 bg-white/95 px-4 pb-6 pt-2 backdrop-blur-md">
        <button type="button" onClick={save} className="h-12 w-full rounded-xl bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[16px] font-semibold text-white active:opacity-85">
          保存地址
        </button>
      </div>
      {/* 删除确认弹层 */}
      {delOpen ? (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/45 px-10" onClick={() => setDelOpen(false)}>
          <div className="w-full max-w-[280px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-[16px] font-semibold text-black/85">删除地址</div>
            <div className="mt-2 text-center text-[13px] leading-5 text-black/50">确定删除「{editing?.name}」的地址吗？删除后不可恢复。</div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setDelOpen(false)} className="h-10 rounded-xl bg-black/[0.05] text-[14px] text-black/70 active:opacity-80">
                取消
              </button>
              <button type="button" onClick={removeAddr} className="h-10 rounded-xl bg-[#FF4400] text-[14px] font-medium text-white active:opacity-80">
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
// ---------------- 收藏 / 足迹 / 关注店铺 ----------------

function FavoritesPage({ uid, onBack, onOpenProduct, onToast }: { uid: string; onBack: () => void; onOpenProduct: (pid: string) => void; onToast: (m: string) => void }) {
  const [ids, setIds] = useState<string[]>(() => tbLoadFavs(uid));
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <TopBar title={`我的收藏(${ids.length})`} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-10">
        {ids.length === 0 ? (
          <div className="grid place-items-center bg-white py-16">
            <Star className="h-12 w-12 text-black/10" strokeWidth={1.6} />
            <div className="mt-3 text-[15px] text-black/45">还没有收藏的商品</div>
          </div>
        ) : (
          <div className="space-y-2 px-2 pt-2">
            {ids.map((pid) => {
              const p = productById(pid);
              if (!p) return null;
              return (
                <div key={pid} className="flex gap-2.5 rounded-xl bg-white p-3">
                  <button type="button" onClick={() => onOpenProduct(pid)} className="shrink-0 active:opacity-70">
                    <ProductImg p={p} w={200} h={200} className="h-[84px] w-[84px] rounded-lg" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => onOpenProduct(pid)} className="block w-full text-left">
                      <div className="line-clamp-2 text-[13px] leading-[18px] text-black/85">{p.title}</div>
                      <div className="mt-1 text-[12px] text-black/40">{shopById(p.shopId).name}</div>
                    </button>
                    <div className="mt-1.5 flex items-center">
                      <Price value={p.price} size={17} />
                      <button
                        type="button"
                        onClick={() => {
                          tbToggleFav(uid, pid);
                          setIds(tbLoadFavs(uid));
                          onToast('已取消收藏');
                        }}
                        className="ml-auto rounded-full border border-black/12 px-3 py-1.5 text-[12px] text-black/55 active:opacity-70"
                      >
                        取消收藏
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FootprintsPage({ uid, onBack, onOpenProduct, onToast }: { uid: string; onBack: () => void; onOpenProduct: (pid: string) => void; onToast: (m: string) => void }) {
  const [foots, setFoots] = useState(() => tbLoadFoots(uid));
  const today = new Date();
  const isToday = (ts: number) => {
    const d = new Date(ts);
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  };
  const groups: { label: string; items: typeof foots }[] = [
    { label: '今天', items: foots.filter((f) => isToday(f.at)) },
    { label: '更早', items: foots.filter((f) => !isToday(f.at)) },
  ].filter((g) => g.items.length > 0);
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <TopBar title={`足迹(${foots.length})`} onBack={onBack} right={<button type="button" onClick={() => { localStorage.setItem('tb-foots-wipe', uid); onToast('清空成功'); }} className="text-[13px] text-black/50">清空</button>} />
      <div className="flex-1 overflow-y-auto pb-10">
        {groups.length === 0 ? (
          <div className="grid place-items-center bg-white py-16">
            <ScanLine className="h-12 w-12 text-black/10" strokeWidth={1.6} />
            <div className="mt-3 text-[15px] text-black/45">暂无浏览足迹</div>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="px-4 pb-1 pt-3 text-[13px] text-black/40">{g.label}</div>
              <div className="space-y-2 px-2">
                {g.items.map((f) => {
                  const p = productById(f.pid);
                  if (!p) return null;
                  return (
                    <div key={f.pid} className="flex gap-2.5 rounded-xl bg-white p-3">
                      <button type="button" onClick={() => onOpenProduct(f.pid)} className="shrink-0 active:opacity-70">
                        <ProductImg p={p} w={200} h={200} className="h-[76px] w-[76px] rounded-lg" />
                      </button>
                      <button type="button" onClick={() => onOpenProduct(f.pid)} className="min-w-0 flex-1 text-left">
                        <div className="line-clamp-2 text-[13px] leading-[18px] text-black/85">{p.title}</div>
                        <div className="mt-1 text-[12px] text-black/40">{shopById(p.shopId).name}</div>
                        <div className="mt-1.5">
                          <Price value={p.price} size={16} />
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ShopFollowsPage({ uid, onBack, onOpenProduct, onToast }: { uid: string; onBack: () => void; onOpenProduct: (pid: string) => void; onToast: (m: string) => void }) {
  const [ids, setIds] = useState<string[]>(() => tbLoadShopFollows(uid));
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <TopBar title={`关注店铺(${ids.length})`} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-10">
        {ids.length === 0 ? (
          <div className="grid place-items-center bg-white py-16">
            <Heart className="h-12 w-12 text-black/10" strokeWidth={1.6} />
            <div className="mt-3 text-[15px] text-black/45">还没有关注店铺哦</div>
          </div>
        ) : (
          <div className="space-y-2 px-2 pt-2">
            {ids.map((sid) => {
              const shop = shopById(sid);
              const goods = TB_PRODUCTS.filter((p) => p.shopId === sid).slice(0, 4);
              return (
                <div key={sid} className="rounded-xl bg-white p-3">
                  <div className="flex items-center gap-3">
                    <img src={tbImg(shop.tag, 100, 100, 0, 'c')} alt={shop.name} className="h-11 w-11 rounded-lg object-cover" draggable={false} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        {shop.tmall ? <TmallMark /> : null}
                        <span className="truncate text-[14px] font-medium text-black/85">{shop.name}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-black/40">{shop.fans}粉丝数 · 评分 {shop.rating}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        tbToggleShopFollow(uid, sid);
                        setIds(tbLoadShopFollows(uid));
                        onToast('已取消关注');
                      }}
                      className="rounded-full bg-black/[0.06] px-3.5 py-1.5 text-[13px] text-black/50 active:opacity-80"
                    >
                      已关注
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {goods.map((p, i) => (
                      <button key={p.id} type="button" onClick={() => onOpenProduct(p.id)} className="active:opacity-70">
                        <ProductImg p={p} s={(i + 1) % 4} className="aspect-square w-full rounded-lg" />
                        <div className="mt-1 text-left">
                          <Price value={p.price} size={13} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- 店铺页 ----------------

function ShopPage({ shopId, uid, onBack, onOpenProduct, onToast }: { shopId: string; uid: string; onBack: () => void; onOpenProduct: (pid: string) => void; onToast: (m: string) => void }) {
  const shop = shopById(shopId);
  const goods = TB_PRODUCTS.filter((p) => p.shopId === shopId);
  const followed = tbLoadShopFollows(uid).includes(shopId);
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <div className="bg-gradient-to-b from-[#FF6A1E] to-[#FF9A50] pb-3">
        <div className="flex items-center px-3 pt-[58px]">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full bg-white/25 active:opacity-70">
            <ArrowLeft className="h-[20px] w-[20px] text-white" strokeWidth={2.2} />
          </button>
          <span className="flex-1 text-center text-[16px] font-semibold text-white">店铺</span>
          <span className="w-9" />
        </div>
        <div className="mt-3 flex items-center gap-3 px-4">
          <img src={tbImg(shop.tag, 120, 120, 0, 'c')} alt={shop.name} className="h-14 w-14 rounded-xl border-2 border-white/60 object-cover" draggable={false} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              {shop.tmall ? <TmallMark /> : null}
              <span className="truncate text-[16px] font-bold text-white">{shop.name}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-white/80">评分 {shop.rating} · {shop.fans}粉丝数{shop.desc ? ` · ${shop.desc}` : ''}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              const now = tbToggleShopFollow(uid, shopId);
              onToast(now ? '已关注店铺' : '已取消关注');
            }}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium ${followed ? 'bg-white/25 text-white' : 'bg-white text-[#FF5000]'} active:opacity-80`}
          >
            {followed ? '已关注' : '+ 关注'}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 pb-3 pt-2 text-[13px] text-black/45">全部商品（{goods.length}）</div>
        <div className="grid grid-cols-2 gap-2 px-2">
          {goods.map((p, i) => (
            <ProductCard key={p.id} p={p} v={i % 4} onOpen={() => onOpenProduct(p.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- 优惠券 / 快递 / 设置 ----------------

/** 领券中心（需求：开发领券中心，截图4：超级88领好券红色页——三档消费券/加赠/家电数码券/平台加补券/预告券，领取入账 tb-coupons） */
function CouponCenterPage({ uid, onBack, onToast }: { uid: string; onBack: () => void; onToast: (m: string) => void }) {
  const [, setTick] = useState(0);
  const coupons = tbLoadCoupons(uid);
  const claimedOf = (name: string) => coupons.some((x) => x.name === name && !x.usedAt);
  const claim = (name: string, amount: number, min: number) => {
    if (tbClaimCoupon(uid, { name, amount, min, pids: [] })) {
      setTick((n) => n + 1);
      onToast(`领取成功：${name} ¥${amount}`);
    } else onToast('已领取过该券');
  };
  // 加赠条倒计时（仅剩 04:32:17 起跳）
  const [left, setLeft] = useState(4 * 3600 + 32 * 60 + 17);
  useEffect(() => {
    const t = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  const leftText = `${String(Math.floor(left / 3600)).padStart(2, '0')}:${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  const ccTile = (name: string, amount: number, min: number) => {
    const claimed = claimedOf(name);
    return (
      <button
        key={name}
        type="button"
        onClick={() => claim(name, amount, min)}
        className={`flex flex-col items-center rounded-xl bg-white py-3 active:opacity-85 ${claimed ? 'opacity-60' : ''}`}
      >
        <span className="text-[26px] font-black leading-none text-[#FF1E00]">
          <span className="text-[14px] font-bold">¥</span>
          {amount}
        </span>
        <span className="mt-1.5 text-[13px] font-bold text-black/85">满{min}可用</span>
        <span className="mt-0.5 text-[10.5px] text-black/35">10.7-10.12有效</span>
        <span className={`mt-1 rounded-full px-2 py-px text-[10px] font-bold ${claimed ? 'bg-black/[0.06] text-black/35' : 'bg-[#FF3B30] text-white'}`}>{claimed ? '已领取' : '点击领取'}</span>
      </button>
    );
  };
  const digitalClaimed = TB_CC_SEEDS.digital.every((c) => claimedOf(`家电数码券${c.amount}`));
  return (
    <div className="flex h-full flex-col bg-[#EF1500]">
      {/* 顶栏（红底：返回 + 超级88领好券 + 更多） */}
      <div className="relative z-30 shrink-0 bg-gradient-to-b from-[#FF4A2A] to-[#F5222D] px-3 pb-2.5 pt-[56px]">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/25 active:opacity-70">
            <ArrowLeft className="h-[20px] w-[20px] text-white" strokeWidth={2.3} />
          </button>
          <span className="text-[20px] font-black italic leading-none text-white">超级88</span>
          <span className="text-[19px] font-bold text-white">领好券</span>
          <button type="button" aria-label="更多" onClick={() => onToast('更多（演示）')} className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/25 active:opacity-70">
            <MoreHorizontal className="h-[19px] w-[19px] text-white" strokeWidth={2.2} />
          </button>
        </div>
        {/* 领券动态 + 规则 */}
        <div className="mt-2 flex items-center gap-1.5">
          <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px] bg-[#FFD100] text-[11px] font-bold text-[#E62E24]">¥</span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-white/95">x**a刚刚领了8.8折超市加补券</span>
          <button type="button" onClick={() => onToast('规则：消费券可与加补券叠加使用')} className="shrink-0 rounded-md bg-black/25 px-2 py-0.5 text-[12px] text-white active:opacity-70">规则</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-8">
        {/* 超级88消费券 tab卡（三档消费券 + 查看飞猪券包） */}
        <div className="mt-1 overflow-hidden rounded-2xl">
          <div className="flex bg-[#FFD5D0]">
            <div className="flex-1 bg-gradient-to-b from-[#FF5A45] to-[#FF2600] py-2 text-center">
              <div className="text-[15px] font-bold text-white">超级88</div>
              <div className="text-[12px] text-white/85">消费券</div>
            </div>
            <div className="flex-1 py-2 text-center">
              <div className="text-[15px] font-bold text-[#93392e]">更多惊喜</div>
              <div className="text-[12px] text-[#a05a50]">敬请期待</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 bg-[#FFE3E0] p-2.5">{TB_CC_SEEDS.consume.map((c) => ccTile(`消费券${c.min}`, c.amount, c.min))}</div>
          <button type="button" onClick={() => onToast('飞猪券包（演示）')} className="w-full bg-[#FFE3E0] pb-2.5 pt-1 text-center text-[13px] font-medium text-[#a04046] active:opacity-70">
            查看飞猪券包 ⌄
          </button>
        </div>
        {/* 加赠条（¥15 满125可用 仅剩倒计时） */}
        <button type="button" onClick={() => claim('加赠消费券', TB_CC_SEEDS.bonus.amount, TB_CC_SEEDS.bonus.min)} className={`mt-2 flex w-full items-center gap-2 rounded-2xl bg-white p-3 text-left active:opacity-90 ${claimedOf('加赠消费券') ? 'opacity-60' : ''}`}>
          <span className="relative shrink-0">
            <span className="absolute -left-1.5 -top-3 z-10 rotate-[-14deg] rounded-[3px] bg-[#FFD100] px-1 text-[9px] font-bold leading-[13px] text-[#8a4d16]">加赠</span>
            <span className="text-[25px] font-black leading-none text-[#FF1E00]">¥15</span>
          </span>
          <span className="text-[14.5px] font-semibold text-black/85">满125可用</span>
          <span className="ml-auto text-[12.5px] text-black/45">仅剩{leftText}</span>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold ${claimedOf('加赠消费券') ? 'bg-black/[0.06] text-black/35' : 'bg-[#FF3B30] text-white'}`}>{claimedOf('加赠消费券') ? '已领取' : '领取'}</span>
        </button>
        {/* 您有消费券待使用 */}
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-[#FFD5D0]/75 px-3 py-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#1a1a1a]">
            <span className="text-[9px] font-bold text-white">天猫</span>
          </span>
          <span className="text-[13.5px] font-medium text-black/80">您有消费券待使用</span>
          <button type="button" onClick={() => onToast('规则：下单自动抵扣最优券')} className="ml-auto text-[12.5px] text-black/45 active:opacity-70">规则</button>
        </div>
        {/* 家电数码券（三档 + 立即领取） */}
        <div className="mt-2 rounded-2xl bg-gradient-to-b from-[#FF5A45] to-[#FF2600] p-3">
          <div className="flex items-center">
            <span className="text-[19px] font-black text-white">家电数码券</span>
            <button type="button" onClick={() => onToast('规则：数码家电类目可用')} className="ml-auto rounded-md bg-black/25 px-2 py-0.5 text-[12px] text-white active:opacity-70">规则</button>
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {TB_CC_SEEDS.digital.map((c) => (
              <div key={c.amount} className="flex flex-col items-center rounded-xl bg-white py-2.5">
                <span className="text-[24px] font-black leading-none text-[#FF1E00]">
                  <span className="text-[13px] font-bold">¥</span>
                  {c.amount}
                </span>
                <span className="mt-1 text-[12px] font-bold text-black/85">满{c.min}可用</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-center text-[12.5px] text-white/90">10.7晚8点-10.12有效</div>
          <button
            type="button"
            data-testid="cc-digital-claim"
            onClick={() => {
              if (digitalClaimed) {
                onToast('家电数码券已领取');
                return;
              }
              let got = 0;
              for (const c of TB_CC_SEEDS.digital) {
                if (tbClaimCoupon(uid, { name: `家电数码券${c.amount}`, amount: c.amount, min: c.min, pids: [] })) got++;
              }
              setTick((n) => n + 1);
              onToast(got > 0 ? `领取成功：家电数码券${got}张` : '已领取过该券');
            }}
            className={`mt-2.5 h-11 w-full rounded-xl text-[16px] font-bold active:opacity-85 ${digitalClaimed ? 'bg-white/60 text-black/35' : 'bg-[#FFE9E2] text-[#FF4400]'}`}
          >
            {digitalClaimed ? '已领取' : '立即领取'}
          </button>
        </div>
        {/* 平台加补券（可叠消费券） */}
        <div className="mt-2 rounded-2xl bg-gradient-to-b from-[#FF5A45] to-[#FF2600] p-3">
          <div className="flex items-center gap-2">
            <span className="text-[19px] font-black text-white">平台加补券</span>
            <span className="rounded-[4px] bg-white/20 px-1.5 py-0.5 text-[11px] font-bold text-white">可叠消费券!</span>
            <button type="button" onClick={() => onToast('攻略：先领加补券，叠消费券下单更省')} className="ml-auto text-[12.5px] text-white/90 active:opacity-70">攻略</button>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {TB_CC_SEEDS.extra.map((c) => {
              const claimed = claimedOf(c.name);
              return (
                <div key={c.name} className="flex flex-col rounded-xl bg-white p-2.5">
                  <span className="text-[14.5px] font-bold text-black/90">{c.name}</span>
                  <span className="mt-0.5 flex items-baseline gap-1">
                    <span className="text-[21px] font-black leading-none text-[#FF1E00]">
                      <span className="text-[12px] font-bold">¥</span>
                      {c.amount}
                    </span>
                    <span className="text-[11px] text-black/40">共{c.count}张</span>
                  </span>
                  <span className="mt-0.5 truncate text-[10.5px] text-black/40">{c.scope}</span>
                  <img src={tbImg(c.tag, 160, 100, 5)} alt={c.name} className="mt-1 h-[52px] w-full rounded-md object-cover" draggable={false} />
                  <button
                    type="button"
                    onClick={() => claim(c.name, c.amount, c.min)}
                    className={`mt-1.5 h-8 w-full rounded-lg text-[13px] font-bold active:opacity-85 ${claimed ? 'bg-black/[0.06] text-black/35' : 'bg-gradient-to-r from-[#FF3B30] to-[#FF0036] text-white'}`}
                  >
                    {claimed ? '已领取' : '领取'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        {/* 更多大额加补券即将可领（预告） */}
        <div className="mb-2 mt-2 rounded-2xl bg-gradient-to-b from-[#FF5A45] to-[#FF2600] p-3">
          <div className="flex items-center gap-2">
            <span className="text-[18px] font-black text-white">更多大额加补券即将可领!</span>
            <span className="ml-auto shrink-0 rounded-[4px] bg-[#FFD100] px-1.5 py-0.5 text-[10.5px] font-bold text-[#8a2a20]">每天0点,10点,20点抢</span>
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {TB_CC_SEEDS.upcoming.map((c) => (
              <div key={c.name} className="flex flex-col rounded-xl bg-white p-2">
                <span className="truncate text-[13px] font-bold text-black/90">{c.name}</span>
                <span className="mt-0.5 text-[19px] font-black leading-none text-[#FF1E00]">
                  <span className="text-[11px] font-bold">¥</span>
                  {c.amount}
                </span>
                <span className="mt-0.5 text-[10.5px] text-black/40">共{c.count}张</span>
                <button
                  type="button"
                  onClick={() => onToast('每天0点、10点、20点开抢，记得回来')}
                  className="mt-1.5 h-8 w-full rounded-lg bg-[#FFB4A6] text-[12px] font-bold text-white active:opacity-80"
                >
                  今天20点领
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CouponsPage({ uid, onBack, onToast }: { uid: string; onBack: () => void; onToast: (m: string) => void }) {
  const [tab, setTab] = useState<'ok' | 'used'>('ok');
  const list = tbLoadCoupons(uid).filter((c) => (tab === 'ok' ? !c.usedAt : !!c.usedAt));
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <TopBar title="我的优惠券" onBack={onBack} />
      <div className="sticky top-0 z-30 flex gap-6 bg-white px-4 pb-2">
        {(['ok', 'used'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`relative pb-1.5 text-[15px] ${tab === t ? 'font-semibold text-[#FF5000]' : 'text-black/55'}`}>
            {t === 'ok' ? '未使用' : '已使用'}
            {tab === t ? <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-[#FF5000]" /> : null}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto pb-10">
        {list.length === 0 ? (
          <div className="grid place-items-center bg-white py-16">
            <Ticket className="h-12 w-12 text-black/10" strokeWidth={1.6} />
            <div className="mt-3 text-[15px] text-black/45">{tab === 'ok' ? '暂无可用优惠券，去领券中心看看' : '暂无已使用的优惠券'}</div>
          </div>
        ) : (
          <div className="space-y-2 px-2 pt-2">
            {list.map((c) => (
              <div key={c.id} className={`flex items-center overflow-hidden rounded-xl bg-white ${c.usedAt ? 'opacity-55' : ''}`}>
                <div className="flex w-[92px] flex-col items-center justify-center bg-gradient-to-br from-[#FF6A1E] to-[#FF4400] py-4 text-white">
                  <span className="text-[22px] font-bold leading-none">
                    <span className="text-[13px]">¥</span>
                    {c.amount}
                  </span>
                  <span className="mt-1 text-[10px] text-white/85">{c.min > 0 ? `满${c.min}可用` : '无门槛'}</span>
                </div>
                <div className="min-w-0 flex-1 px-3">
                  <div className="truncate text-[15px] font-semibold text-black/85">{c.name}</div>
                  <div className="mt-0.5 text-[11px] text-black/40">{c.pids.length === 0 ? '全场通用' : '限指定商品'} · {new Date(c.expireAt).getMonth() + 1}月{new Date(c.expireAt).getDate()}日到期</div>
                </div>
                {!c.usedAt ? (
                  <button type="button" onClick={() => onToast('下单时自动使用最优券，也可在结算页手动选择')} className="mr-3 rounded-lg bg-[#FF5000] px-3.5 py-1.5 text-[12px] font-medium text-white active:opacity-80">
                    去使用
                  </button>
                ) : (
                  <span className="mr-3 text-[12px] text-black/35">已使用</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 我的快递（全部订单物流聚合） */
function ExpressPage({ uid, onBack, onOpenOrder }: { uid: string; onBack: () => void; onOpenOrder: (id: string) => void }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  tbTickOrders(uid);
  const shipped = tbLoadOrders(uid).filter((o) => o.status === 'shipped');
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <TopBar title="我的快递" onBack={onBack} />
      <div className="flex gap-2 overflow-x-auto bg-white px-3 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {['待取件', '派送中', '运输中', '已揽收'].map((s, i) => (
          <span key={s} className={`rounded-lg px-3 py-1 text-[12px] ${i === 0 ? 'bg-[#FF5000]/[0.08] font-medium text-[#FF5000]' : 'bg-black/[0.04] text-black/45'}`}>{s}</span>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto pb-10">
        {shipped.length === 0 ? (
          <div className="grid place-items-center bg-white py-16">
            <Truck className="h-12 w-12 text-black/10" strokeWidth={1.6} />
            <div className="mt-3 text-[15px] text-black/45">暂无近期包裹</div>
          </div>
        ) : (
          <div className="space-y-2 px-2 pt-2">
            {shipped.map((o) => {
              const last = o.track[o.track.length - 1];
              return (
                <button key={o.id} type="button" onClick={() => onOpenOrder(o.id)} className="flex w-full items-start gap-2.5 rounded-xl bg-white p-3.5 text-left active:opacity-80">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#FF5000]/[0.08]">
                    <Truck className="h-5 w-5 text-[#FF5000]" strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-black/85">{o.shopName} · {o.items.length}件商品</span>
                    <span className="mt-0.5 block truncate text-[12px] text-black/50">{last ? last.text : '商家已发货'}</span>
                    <span className="mt-0.5 block text-[11px] text-black/30">{last ? fmtTime(last.at) : ''}</span>
                  </span>
                  <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-black/25" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsPage({ session, onBack, onToast, onLogout }: { session: TbSession; onBack: () => void; onToast: (m: string) => void; onLogout: () => void }) {
  const uid = tbUidOf(session);
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <TopBar title="设置" onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-10">
        <div className="mt-2 bg-white">
          <button type="button" onClick={() => onToast('个人资料在对应微信/QQ App 内修改')} className="flex w-full items-center gap-3 border-b border-black/[0.04] px-4 py-3.5 text-left active:opacity-70">
            <User className="h-5 w-5 text-black/60" strokeWidth={2} />
            <span className="flex-1 text-[15px] text-black/85">个人资料</span>
            <span className="text-[13px] text-black/35">{session.name}</span>
            <ChevronRight className="h-4 w-4 text-black/25" />
          </button>
          <button type="button" onClick={() => onToast(`当前账号：${session.idp === 'phone' ? `手机号 ${session.phone}` : session.idp === 'wx' ? '微信授权' : 'QQ授权'}`)} className="flex w-full items-center gap-3 border-b border-black/[0.04] px-4 py-3.5 text-left active:opacity-70">
            <Wallet className="h-5 w-5 text-black/60" strokeWidth={2} />
            <span className="flex-1 text-[15px] text-black/85">账号与安全</span>
            <ChevronRight className="h-4 w-4 text-black/25" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('确定清除本账号全部淘宝数据吗？购物车/订单/收藏/足迹/地址将全部清空且不可恢复。')) {
                tbWipeUid(uid);
                onToast('已清除本账号淘宝数据');
              }
            }}
            className="flex w-full items-center gap-3 border-b border-black/[0.04] px-4 py-3.5 text-left active:opacity-70"
          >
            <Trash2 className="h-5 w-5 text-black/60" strokeWidth={2} />
            <span className="flex-1 text-[15px] text-black/85">清除淘宝数据</span>
            <span className="text-[12px] text-black/35">购物车/订单/收藏</span>
            <ChevronRight className="h-4 w-4 text-black/25" />
          </button>
          <button type="button" onClick={() => onToast('淘宝 v1.0（演示版）')} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:opacity-70">
            <CircleCheck className="h-5 w-5 text-black/60" strokeWidth={2} />
            <span className="flex-1 text-[15px] text-black/85">关于淘宝</span>
            <span className="text-[13px] text-black/35">v1.0</span>
            <ChevronRight className="h-4 w-4 text-black/25" />
          </button>
        </div>
        <div className="px-4 pt-8">
          <button type="button" onClick={onLogout} className="h-11 w-full rounded-full bg-white text-[15px] font-medium text-[#FF4400] active:opacity-80">
            退出登录
          </button>
          <div className="pt-3 text-center text-[11px] leading-5 text-black/30">
            退出后本账号购物数据将保留，重新登录同一账号即可恢复；购物支付复用微信/QQ 钱包。
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- 主入口（tab 框架 + 页面栈） ----------------

type TbPage = 'main' | 'search' | 'searchResult' | 'product' | 'checkout' | 'orders' | 'orderDetail' | 'logistics' | 'addresses' | 'addressEdit' | 'coupons' | 'couponCenter' | 'favorites' | 'foots' | 'shopFollows' | 'shop' | 'reviews' | 'express' | 'settings' | 'msgs' | 'chat' | 'subsidy' | 'seckill' | 'signin' | 'movie' | 'fliggy' | 'bill' | 'ticketDetail';
type TbTab = 'home' | 'video' | 'msgs' | 'cart' | 'me';

/** 底部导航（首页/消息/购物车/我的淘宝） */
function BottomTabBar({ active, onTab, cartCount, msgCount }: { active: TbTab; onTab: (t: TbTab) => void; cartCount: number; msgCount: number }) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-40 flex h-[53px] items-stretch border-t border-black/[0.05] bg-white/95 pb-3 pt-0.5 backdrop-blur-lg">
      {/* 需求（第十轮）：底部 tab 上下变窄一点（pt-1.5→pt-0.5、pb-5→pb-3、行距/内边距收紧）；
          本轮：固定高 53px（=1px 边线+2+图标 23+文字 15+12），购物车结算栏按此对齐消除底部空隙 */}
      {/* 首页（active：橙色淘 logo 圆，截图1） */}
      <button type="button" onClick={() => onTab('home')} className="relative flex flex-1 flex-col items-center gap-0 py-0 active:opacity-60">
        {active === 'home' ? (
          <TbLogoMark size={23} />
        ) : (
          <HomeIcon className="h-[23px] w-[23px] text-black/60" strokeWidth={1.9} />
        )}
        <span className={`text-[10px] ${active === 'home' ? 'font-medium text-[#FF5000]' : 'text-black/45'}`}>首页</span>
      </button>
      {/* 视频（截图2：圆角方播放） */}
      <button type="button" onClick={() => onTab('video')} className="relative flex flex-1 flex-col items-center gap-0 py-0 active:opacity-60">
        <TbVideoTabIcon active={active === 'video'} />
        <span className={`text-[10px] ${active === 'video' ? 'font-medium text-[#FF5000]' : 'text-black/45'}`}>视频</span>
      </button>
      {/* 消息（截图1/2：气泡三点图标；active 橙色填充白点） */}
      <button type="button" onClick={() => onTab('msgs')} className="relative flex flex-1 flex-col items-center gap-0 py-0 active:opacity-60">
        <span className="relative">
          <TbMsgTabIcon active={active === 'msgs'} />
          {msgCount > 0 ? (
            <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#FF4400] px-1 text-[10px] font-bold text-white">{msgCount > 99 ? '99+' : msgCount}</span>
          ) : null}
        </span>
        <span className={`text-[10px] ${active === 'msgs' ? 'font-medium text-[#FF5000]' : 'text-black/45'}`}>消息</span>
      </button>
      {/* 购物车 */}
      <button type="button" onClick={() => onTab('cart')} className="relative flex flex-1 flex-col items-center gap-0 py-0 active:opacity-60">
        <span className="relative">
          <ShoppingCart className={`h-[23px] w-[23px] ${active === 'cart' ? 'text-[#FF5000]' : 'text-black/60'}`} strokeWidth={active === 'cart' ? 2.3 : 1.9} />
          {cartCount > 0 ? (
            <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#FF4400] px-1 text-[10px] font-bold text-white">{cartCount > 99 ? '99+' : cartCount}</span>
          ) : null}
        </span>
        <span className={`text-[10px] ${active === 'cart' ? 'font-medium text-[#FF5000]' : 'text-black/45'}`}>购物车</span>
      </button>
      {/* 我的淘宝（笑脸，截图2） */}
      <button type="button" onClick={() => onTab('me')} className="relative flex flex-1 flex-col items-center gap-0 py-0 active:opacity-60">
        <TbMeTabIcon active={active === 'me'} />
        <span className={`text-[10px] ${active === 'me' ? 'font-medium text-[#FF5000]' : 'text-black/45'}`}>我的淘宝</span>
      </button>
    </div>
  );
}

/** 地址选择弹层（下单页选地址） */
function AddrPickerSheet({ uid, onClose, onManage }: { uid: string; onClose: () => void; onManage: () => void }) {
  const list = tbLoadAddrs(uid);
  const curId = tbCurAddrId(uid);
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div className="max-h-[70%] overflow-y-auto rounded-t-2xl bg-white pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <span className="text-[16px] font-semibold text-black/85">选择收货地址</span>
          <button type="button" aria-label="关闭" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-black/[0.04]">
            <X className="h-4 w-4 text-black/60" strokeWidth={2.4} />
          </button>
        </div>
        {list.length === 0 ? (
          <div className="px-4 py-8 text-center text-[14px] text-black/45">还没有收货地址，先去添加一个吧</div>
        ) : (
          <div className="space-y-1 px-3">
            {list.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  tbSetCurAddr(uid, a.id);
                  onClose();
                }}
                className={`flex w-full items-start gap-2.5 rounded-xl border p-3 text-left ${curId === a.id ? 'border-[#FF5000] bg-[#FF5000]/[0.04]' : 'border-black/[0.07]'}`}
              >
                <span className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${curId === a.id ? 'border-[#FF5000] bg-[#FF5000]' : 'border-black/20'}`}>
                  {curId === a.id ? <Check className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-black/85">{a.name}</span>
                    <span className="text-[12px] text-black/45">{a.phone.slice(0, 3)}****{a.phone.slice(7)}</span>
                    {a.tag ? <span className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[10px] text-black/50">{a.tag}</span> : null}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-5 text-black/55">{a.region} {a.detail}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="px-4 pt-3">
          <button type="button" onClick={onManage} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-black/10 text-[14px] text-black/70 active:opacity-70">
            <MapPin className="h-4 w-4" />
            管理收货地址
          </button>
        </div>
      </div>
    </div>
  );
}

/** 待付款订单续付弹层（订单列表/详情「继续付款」） */
function PayPendingSheet({ uid, orderId, onClose, onPaid, onToast }: { uid: string; orderId: string; onClose: () => void; onPaid: (id: string) => void; onToast: (m: string) => void }) {
  const o = tbLoadOrders(uid).find((x) => x.id === orderId);
  if (!o) return null;
  const brief = o.items.length > 1 ? `${o.items[0].title.slice(0, 12)}等${o.items.length}件` : o.items[0]?.title.slice(0, 18) ?? '商品';
  // 支付成功消息由 PaySheet 内部统一推送（避免重复）
  return <PaySheet uid={uid} orderId={orderId} amount={o.total} goodsBrief={brief} onClose={onClose} onSuccess={(oid) => { onToast('支付成功'); onPaid(oid); }} />;
}

export default function TaobaoApp() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<TbSession | null>(null);
  const [page, setPage] = useState<TbPage>('main');
  const [tab, setTab] = useState<TbTab>('home');
  const [cartCount, setCartCount] = useState(0);
  const [searchKw, setSearchKw] = useState('');
  const [pid, setPid] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderTab, setOrderTab] = useState<TbOrderStatus | 'all'>('all');
  const [checkoutItems, setCheckoutItems] = useState<TbOrderItem[] | null>(null);
  const [addrPicker, setAddrPicker] = useState(false);
  const [editAddr, setEditAddr] = useState<TbAddress | null>(null);
  const [payOrderId, setPayOrderId] = useState<string | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [rateFor, setRateFor] = useState<string | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  /** 客服聊天页（Task 41）：店铺 + 上下文（商品/订单） */
  const [chatShopId, setChatShopId] = useState<string | null>(null);
  const [chatPid, setChatPid] = useState<string | null>(null);
  const [chatOrderId, setChatOrderId] = useState<string | null>(null);
  /** 物流页订单 + 返回目标（订单列表/详情/快递页均可进） */
  const [logisticsId, setLogisticsId] = useState<string | null>(null);
  const [logiBack, setLogiBack] = useState<'orders' | 'orderDetail'>('orders');
  /** 票务订单详情（第十三轮淘票票）+ 返回目标（订单列表/淘票票）+ 淘票票初始频道 */
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [ticketReturn, setTicketReturn] = useState<'movie' | 'orders'>('orders');
  const [movieTab, setMovieTab] = useState<'movie' | 'comedy' | 'concert' | 'merch'>('movie');
  /** 二级页返回目标（订单页可从「我的」或首页进入） */
  const [subReturn, setSubReturn] = useState<TbTab>('me');
  /** 地址页返回目标：'me'（我的页进）/ 'checkout'（下单页地址弹层进） */
  const [addrReturn, setAddrReturn] = useState<'me' | 'checkout'>('me');
  const [toastMsg, showToast] = useLocalToast();

  // 启动：恢复登录态 + 订单状态机 tick（异步包一层，避免 effect 内同步 setState 级联渲染）
  useEffect(() => {
    tbStartOrderWatcher();
    void Promise.resolve().then(() => {
      setSession(tbGetSession());
      setBooting(false);
    });
  }, []);

  // Task 41：登录后恢复 AI 生成商品的持久化注册表（刷新页面/重开 App 后详情/下单链路可用）
  useEffect(() => {
    if (session) tbRestoreAiProducts(tbUidOf(session));
  }, [session]);

  // 登录后刷新购物车角标
  useEffect(() => {
    if (!session) return;
    void Promise.resolve().then(() => setCartCount(tbCartQty(tbUidOf(session))));
  }, [session]);

  const refreshCart = useCallback(() => {
    const s = tbGetSession();
    if (s) setCartCount(tbCartQty(tbUidOf(s)));
  }, []);

  if (booting) {
    return (
      <div className="grid h-full place-items-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="grid h-16 w-16 place-items-center rounded-[18px] bg-gradient-to-b from-[#FF7A21] to-[#FF4400]">
            <span className="text-[32px] font-bold leading-none text-white">淘</span>
          </div>
          <span className="text-[13px] text-black/40">淘宝</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <LoginPage
        onLogin={(s) => {
          tbSetSession(s);
          setSession(s);
          setTab('home');
          setPage('main');
        }}
        onToast={showToast}
      />
    );
  }

  const uid = tbUidOf(session);
  // 底部消息角标 = 系统消息未读 + 客服聊天未读（消息页「清除未读」清系统侧）
  const msgCount = tbMsgUnreadCount(uid) + tbChatTotalUnread(uid);

  /** 打开客服聊天（Task 41：商品页/订单页/物流页/消息页统一入口） */
  const openChat = (sid: string, ctx?: { pid?: string | null; orderId?: string | null }) => {
    setChatShopId(sid);
    setChatPid(ctx?.pid ?? null);
    setChatOrderId(ctx?.orderId ?? null);
    setPage('chat');
  };

  /** 打开订单（票务单 → 电影票详情；普通单 → 对应状态详情页；from 记录返回目标） */
  const openOrderSmart = (id: string, from: 'orders' | 'movie' = 'orders') => {
    const o = tbLoadOrders(uid).find((x) => x.id === id);
    if (o?.ticket) {
      setTicketId(id);
      setTicketReturn(from);
      setPage('ticketDetail');
    } else {
      setOrderId(id);
      setPage('orderDetail');
    }
  };

  /** 二级页返回（订单/地址等可能从「我的」或主框架进入） */
  const backToReturn = () => {
    setPage('main');
    setTab(subReturn);
  };

  const openProduct = (id: string) => {
    setPid(id);
    setPage('product');
  };

  let content: ReactNode;
  if (page === 'main') {
    content = (
      <>
        {tab === 'home' ? (
          <HomePage
            uid={uid}
            onOpenSearch={(seed) => {
              setSearchKw(seed ?? '');
              setPage(seed ? 'searchResult' : 'search');
            }}
            onOpenProduct={openProduct}
            onToast={showToast}
            onOpenCouponCenter={() => setPage('couponCenter')}
            onOpenPage={(p) => setPage(p)}
          />
        ) : null}
        {tab === 'video' ? <VideoPage uid={uid} onOpenProduct={openProduct} onToast={showToast} /> : null}
        {tab === 'msgs' ? (
          <MsgsPage
            uid={uid}
            onOpenOrder={(id) => openOrderSmart(id, 'orders')}
            onOpenExpress={() => setPage('express')}
            onOpenRefundOrders={() => {
              setOrderTab('cancelled');
              setSubReturn('me');
              setPage('orders');
            }}
            onOpenCouponCenter={() => setPage('couponCenter')}
            onOpenChat={(sid) => openChat(sid)}
            onToast={showToast}
          />
        ) : null}
        {tab === 'cart' ? (
          <CartPage
            uid={uid}
            onOpenProduct={openProduct}
            onCheckout={(items) => {
              setCheckoutItems(items);
              setPage('checkout');
            }}
            onToast={showToast}
            onOpenHome={() => setTab('home')}
            onCartChange={refreshCart}
          />
        ) : null}
        {tab === 'me' ? (
          <MePage
            session={session}
            uid={uid}
            onOpenOrders={(t) => {
              setOrderTab(t);
              setSubReturn('me');
              setPage('orders');
            }}
            onOpenFavorites={() => setPage('favorites')}
            onOpenFootprints={() => setPage('foots')}
            onOpenAddresses={() => {
              setAddrReturn('me');
              setPage('addresses');
            }}
            onOpenCoupons={() => setPage('coupons')}
            onOpenExpress={() => setPage('express')}
            onOpenSettings={() => setPage('settings')}
            onOpenMsgs={() => setTab('msgs')}
            onOpenShopFollows={() => setPage('shopFollows')}
            onOpenProduct={openProduct}
            onToast={showToast}
            onOpenWallet={() => setWalletOpen(true)}
            onOpenCouponCenter={() => setPage('couponCenter')}
            onOpenBill={() => setPage('bill')}
          />
        ) : null}
        <BottomTabBar
          active={tab}
          onTab={(t) => setTab(t)}
          cartCount={cartCount}
          msgCount={msgCount}
        />
      </>
    );
  } else if (page === 'search') {
    content = <SearchPage uid={uid} onBack={() => setPage('main')} onSearch={(kw) => { setSearchKw(kw); setPage('searchResult'); }} />;
  } else if (page === 'searchResult') {
    content = <SearchResultPage kw={searchKw} onBack={() => setPage('main')} onOpenProduct={openProduct} onSearchSeed={(kw) => setSearchKw(kw)} />;
  } else if (page === 'product' && pid) {
    content = (
      <ProductPage
        pid={pid}
        uid={uid}
        onBack={() => setPage('main')}
        onToast={showToast}
        onCartChanged={refreshCart}
        onOpenShop={(sid) => {
          setShopId(sid);
          setPage('shop');
        }}
        onOpenCheckout={(items) => {
          setCheckoutItems(items);
          setPage('checkout');
        }}
        onOpenReviews={() => setPage('reviews')}
        onOpenChat={(sid, cpid) => openChat(sid, { pid: cpid })}
      />
    );
  } else if (page === 'reviews' && pid) {
    const p = productById(pid);
    content = p ? <ReviewsPage p={p} uid={uid} onBack={() => setPage('product')} /> : null;
  } else if (page === 'checkout' && checkoutItems) {
    content = (
      <CheckoutPage
        uid={uid}
        items={checkoutItems}
        onBack={() => {
          // 返回时回滚未支付的暂存（核销的券回滚交给订单超时取消）
          setPage('main');
          setTab('cart');
        }}
        onToast={showToast}
        onOpenAddrPicker={() => setAddrPicker(true)}
        onPaid={(oid) => {
          refreshCart();
          setOrderId(oid);
          setPage('orderDetail');
        }}
      />
    );
  } else if (page === 'orders') {
    content = (
      <OrdersPage
        uid={uid}
        initialTab={orderTab}
        onBack={backToReturn}
        onOpenOrder={(id) => {
          // 需求（第四轮澄清）：全部订单/我的订单点击订单进入对应详情页；
          // 票务单（第十三轮）→ 电影票详情，普通单 → 对应状态订单详情页
          openOrderSmart(id, 'orders');
        }}
        onOpenDetail={(id) => openOrderSmart(id, 'orders')}
        onPayOrder={(id) => setPayOrderId(id)}
        onToast={showToast}
        onOpenLogistics={(id) => {
          setLogisticsId(id);
          setLogiBack('orders');
          setPage('logistics');
        }}
        onRate={(id) => setRateFor(id)}
      />
    );
  } else if (page === 'orderDetail' && orderId) {
    content = (
      <OrderDetailPage
        uid={uid}
        orderId={orderId}
        onBack={() => setPage('orders')}
        onToast={showToast}
        onPayOrder={(id) => setPayOrderId(id)}
        onOpenProduct={openProduct}
        onRate={(id) => setRateFor(id)}
        onOpenLogistics={(id) => {
          setLogisticsId(id);
          setLogiBack('orderDetail');
          setPage('logistics');
        }}
        onOpenAddrPicker={() => setAddrPicker(true)}
        onOpenShop={(sid) => {
          setShopId(sid);
          setPage('shop');
        }}
        onOpenChat={(sid, oid) => openChat(sid, { orderId: oid })}
      />
    );
  } else if (page === 'logistics' && logisticsId) {
    content = (
      <LogisticsPage
        uid={uid}
        orderId={logisticsId}
        onBack={() => setPage(logiBack === 'orderDetail' ? 'orderDetail' : 'orders')}
        onToast={showToast}
        onOpenProduct={openProduct}
        onOpenChat={(sid, oid) => openChat(sid, { orderId: oid })}
      />
    );
  } else if (page === 'chat' && chatShopId) {
    // 客服聊天（Task 41：AI 客服按提示词规则回复，消息持久化）
    content = (
      <TbMsgChatPage
        uid={uid}
        shopId={chatShopId}
        pid={chatPid}
        orderId={chatOrderId}
        userName={session.name}
        userAvatar={session.avatar}
        onBack={() => setPage('main')}
        onToast={showToast}
        onOpenProduct={openProduct}
        onOpenOrder={(id) => openOrderSmart(id, 'orders')}
      />
    );
  } else if (page === 'addresses') {
    content = <AddressListPage uid={uid} onBack={() => setPage(addrReturn === 'checkout' && checkoutItems ? 'checkout' : 'main')} onEdit={(a) => { setEditAddr(a); setPage('addressEdit'); }} onToast={showToast} />;
  } else if (page === 'addressEdit') {
    content = <AddressEditPage uid={uid} editing={editAddr} onBack={() => setPage('addresses')} onToast={showToast} />;
  } else if (page === 'coupons') {
    content = <CouponsPage uid={uid} onBack={() => setPage('main')} onToast={showToast} />;
  } else if (page === 'couponCenter') {
    // 领券中心（首页/消息/我的入口共用；返回回 tab 主页）
    content = <CouponCenterPage uid={uid} onBack={() => setPage('main')} onToast={showToast} />;
  } else if (page === 'subsidy') {
    // 百亿补贴（第九轮：首页双卡/频道入口；返回回首页）
    content = <SubsidyPage uid={uid} onBack={() => setPage('main')} onToast={showToast} onOpenProduct={openProduct} />;
  } else if (page === 'seckill') {
    // 淘宝秒杀（第九轮：首页运营位图标入口）
    content = <SeckillPage uid={uid} onBack={() => setPage('main')} onToast={showToast} onOpenProduct={openProduct} />;
  } else if (page === 'signin') {
    // 红包签到·领现金（第九轮：首页运营位图标入口）
    content = <SignInPage uid={uid} onBack={() => setPage('main')} onToast={showToast} />;
  } else if (page === 'movie') {
    // 淘票票（第十三轮重构：四大频道 tab；出票→票详情；周边下单→支付面板）
    content = (
      <MoviePage
        uid={uid}
        initialTab={movieTab}
        onBack={() => setPage('main')}
        onToast={showToast}
        onOpenCouponCenter={() => setPage('couponCenter')}
        onIssued={(id) => {
          setTicketId(id);
          setTicketReturn('movie');
          setPage('ticketDetail');
        }}
        onPayOrder={(id) => setPayOrderId(id)}
      />
    );
  } else if (page === 'ticketDetail' && ticketId) {
    // 电影票详情（待开场/已放映/已退款 三态）
    content = (
      <TicketDetailPage
        uid={uid}
        orderId={ticketId}
        onBack={() => setPage(ticketReturn === 'movie' ? 'movie' : 'orders')}
        onToast={showToast}
        onRate={(id) => setRateFor(id)}
        onOpenMerch={() => {
          setMovieTab('merch');
          setPage('movie');
        }}
      />
    );
  } else if (page === 'fliggy') {
    // 飞猪旅行（第九轮：首页运营位图标入口；首页→酒店列表内部导航）
    content = <FliggyPage uid={uid} onBack={() => setPage('main')} onToast={showToast} />;
  } else if (page === 'bill') {
    // 淘宝账单/我的消费明细（第九轮：我的淘宝消费明细卡入口；真实订单数据；
    // 需求（第十轮）：本月消费行点击进对应订单详情页）
    content = <BillPage session={session} uid={uid} onBack={() => setPage('main')} onToast={showToast} onOpenOrder={(id) => { setSubReturn('me'); openOrderSmart(id, 'orders'); }} />;
  } else if (page === 'favorites') {
    content = <FavoritesPage uid={uid} onBack={() => setPage('main')} onOpenProduct={openProduct} onToast={showToast} />;
  } else if (page === 'foots') {
    content = <FootprintsPage uid={uid} onBack={() => setPage('main')} onOpenProduct={openProduct} onToast={showToast} />;
  } else if (page === 'shopFollows') {
    content = <ShopFollowsPage uid={uid} onBack={() => setPage('main')} onOpenProduct={openProduct} onToast={showToast} />;
  } else if (page === 'shop' && shopId) {
    content = <ShopPage shopId={shopId} uid={uid} onBack={() => setPage('product')} onOpenProduct={openProduct} onToast={showToast} />;
  } else if (page === 'express') {
    // 用户口径统一：点击订单/包裹一律进对应状态订单详情页（物流页走详情内「查看物流」）
    content = <ExpressPage uid={uid} onBack={() => setPage('main')} onOpenOrder={(id) => openOrderSmart(id, 'orders')} />;
  } else if (page === 'settings') {
    content = (
      <SettingsPage
        session={session}
        onBack={() => setPage('main')}
        onToast={showToast}
        onLogout={() => {
          tbSetSession(null);
          setSession(null);
          setTab('home');
          setPage('main');
        }}
      />
    );
  } else {
    content = null;
  }

  return (
    <div className="relative h-full overflow-hidden bg-[#f4f4f4]">
      {content}
      <LocalToast msg={toastMsg} />
      {/* 地址选择弹层（下单页） */}
      {addrPicker ? (
        <AddrPickerSheet
          uid={uid}
          onClose={() => setAddrPicker(false)}
          onManage={() => {
            setAddrPicker(false);
            setAddrReturn('checkout');
            setPage('addresses');
          }}
        />
      ) : null}
      {/* 待付款订单续付（订单列表/详情） */}
      {payOrderId ? (
        <PayPendingSheet
          uid={uid}
          orderId={payOrderId}
          onClose={() => setPayOrderId(null)}
          onPaid={(oid) => {
            setPayOrderId(null);
            setOrderId(oid);
            setPage('orderDetail');
          }}
          onToast={showToast}
        />
      ) : null}
      {/* 评价弹层 */}
      {rateFor ? (
        (() => {
          const o = tbLoadOrders(uid).find((x) => x.id === rateFor);
          if (!o) return null;
          return (
            <RateSheet
              order={o}
              uid={uid}
              onClose={() => setRateFor(null)}
              onToast={showToast}
            />
          );
        })()
      ) : null}
      {/* 账户余额（微信/QQ 只读） */}
      {walletOpen ? <WalletSheet onClose={() => setWalletOpen(false)} onToast={showToast} /> : null}
    </div>
  );
}
