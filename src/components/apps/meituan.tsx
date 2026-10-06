'use client';

/**
 * 美团 App（桌面生活服务 App，仿真机界面）—— UI 对齐真机截图（2026-10 版）：
 * - 登录（截图1）：白底「欢迎登录美团」+86/密码胶囊输入、协议勾选、淡黄登录按钮、
 *   验证码登录切换、底部微信/数字身份/QQ 三圆标一键登录（读取联系人当前账号 + 授权卡）；
 *   登录态 localStorage mt-session 持久化，数据按 uid 隔离（meituan-store.ts）；
 * - 首页（截图2）：黄头定位/消息/扫一扫 + 搜索胶囊、两页 15 宫格分类（圆点翻页）、
 *   瀑布流「特价团」团购卡 + 商家外卖卡；
 * - 团购详情（截图6）/ 确认订单（截图7）：粉色特价团风格，直接购买/拼团 → 提交订单 → 支付；
 * - 购物车（截图3）：独立 Tab 页，收藏入口、空态插画、全选/合计/结算；
 * - 我的（截图4）：黄渐变 + 会员卡成长值 + 神券条 + 宫格 + 钱包 + 服务宫格 + 地址/切换账号/退出；
 * - 订单列表（截图5）：搜索/筛选/发票 + 全部/待付款/待收货·待使用/评价/退款售后 五页签，
 *   团购卡带「消费时间/免预约/多店可用/共N张」、更多/领神券/再来一单；
 * - 订单详情（截图8/9）：预计送达大标题 + 四节点进度条 + 骑手假地图（美团专送/放心吃）+
 *   申请售后/催一下/联系商家骑手 + 订单信息（配送服务/骑手/号码保护/录音保护/复制）+ 商品费用；
 * - 待支付详情（截图10）：待付款倒计时 + 使用限制 + 取消订单/继续支付（橙色）；
 * - 支付：微信/QQ → 零钱/银行卡/亲属卡渠道（meituan-pay.ts 复用现有钱包），失败重试；
 *   亲属卡消费 recordFcSpend(channel='美团') → AI 记忆感知；余额不足灰显拦截；
 * - 全局状态推进与灵动岛通知见 MeituanOrderWatcher。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  Bell,
  Bike,
  BookOpen,
  BriefcaseMedical,
  Building,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CirclePlay,
  Clapperboard,
  Clock as ClockIcon,
  Coins,
  Copy,
  CreditCard,
  Cross,
  Crown,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Frown,
  Footprints,
  Gamepad2,
  Gift,
  Handshake,
  HardHat,
  Headset,
  Heart,
  Home as HomeIcon,
  Languages,
  Laugh,
  LayoutGrid,
  Leaf,
  MapPin,
  Meh,
  MessageCircleMore,
  Minus,
  PartyPopper,
  Phone as PhoneIcon,
  Plane,
  Rabbit,
  Receipt,
  RotateCw,
  ScanLine,
  Scissors,
  Search as SearchIcon,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Smile,
  Star,
  Stethoscope,
  Store,
  Ticket,
  Trash2,
  TriangleAlert,
  TreePine,
  Undo2,
  Users,
  Utensils,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { ISLAND_NAV_EVENT, takeNotifyNavigation } from '@/lib/ios/island-notify';
import { LocalToast, useLocalToast } from './page-toast';
import {
  MT_CATS,
  MT_DEALS,
  MT_HOME_GRID,
  MT_HOME_LIST,
  MT_MERCHANTS,
  mtDishesOf,
  mtMerchantOf,
  type MtDeal,
  type MtDish,
  type MtMerchant,
} from '@/lib/ios/meituan-data';
import {
  mtApplyRefund,
  mtCanRefund,
  mtCancelWithRefund,
  mtCheckoutCalc,
  mtClaimGodCoupons,
  mtClearHistory,
  mtClearSearchHist,
  mtCouponTypeLabel,
  mtCurAddrId,
  mtGetOrder,
  mtGetSearchHist,
  mtGetSession,
  mtListUsableCoupons,
  mtLoadAddresses,
  mtLoadCart,
  mtLoadCoupons,
  mtLoadFavs,
  mtLoadHistory,
  mtLoadOrders,
  mtPushHistory,
  mtReorder,
  mtRemoveHistory,
  mtResolveIdpIdentity,
  mtSaveAddresses,
  mtSaveCart,
  mtSaveOrders,
  mtSetCurAddr,
  mtSetSession,
  mtToggleFav,
  mtUidOf,
  mtUseCoupon,
  mtValidateSession,
  MT_STATUS_LABEL,
  type MtAddress,
  type MtCart,
  type MtCoupon,
  type MtFavs,
  type MtHistItem,
  type MtOrder,
  type MtSession,
} from '@/lib/ios/meituan-store';
import { mtExecutePay, mtListPayChannels, type MtPayChannel } from '@/lib/ios/meituan-pay';

type Page = 'main' | 'search' | 'merchant' | 'orderDetail' | 'addresses' | 'addAddress' | 'about' | 'deal' | 'settings' | 'favorites' | 'history' | 'refundDetail' | 'coupons';
type Tab = 'home' | 'orders' | 'cart' | 'my';

const MT_YELLOW = '#FFD100';
const MT_PRICE = '#FF4B33';
const MT_PINK = '#FF2D7E';
const MT_ORANGE = '#FF6000';

const fmtMoney = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const fmtDateTime = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const fmtDate = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 状态展示文案（对齐真机：待付款/已关闭） */
const mtStatusText = (o: MtOrder): string => {
  if (o.status === 'pendingPay') return '待付款';
  if (o.kind === 'tuangou' && o.status === 'canceled') return '已关闭';
  return MT_STATUS_LABEL[o.status];
};

/** 首页宫格图标（icon key → Lucide 组件，对齐真机彩色拟物图） */
const GRID_ICONS: Record<string, LucideIcon> = {
  Bike,
  Ticket,
  Building,
  Zap,
  Cross,
  Utensils,
  Gamepad2,
  Footprints,
  Rabbit,
  Clapperboard,
  Scissors,
  Plane,
  Stethoscope,
  BookOpen,
  LayoutGrid,
};

/** 菜品图（搜索 OSS 图；失败回退图形渐变占位） */
function FoodImg({ src, className = '' }: { src?: string; emoji?: string; className?: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-[#FFE7C2] to-[#FFC96B] ${className}`} aria-hidden="true">
        <Utensils className="h-[36%] w-[36%] text-white/85" strokeWidth={2.2} />
      </div>
    );
  }
  return <img src={src} alt="" draggable={false} loading="lazy" onError={() => setErr(true)} className={`object-cover ${className}`} />;
}

/** 数量步进器（对齐真机：灰色 − / 描边数量框 / 灰色 +） */
function Stepper({ qty, onAdd, onDec }: { qty: number; onAdd: () => void; onDec: () => void }) {
  return (
    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {qty > 0 && (
        <>
          <button type="button" aria-label="减少" onClick={onDec} className="grid h-6 w-6 place-items-center rounded-full text-[18px] leading-none text-black/45 active:bg-black/5">
            <span className="mt-[-2px]">−</span>
          </button>
          <span className="grid h-[26px] min-w-[32px] place-items-center rounded-[5px] border border-black/15 bg-white px-1 text-[14px] font-medium">{qty}</span>
        </>
      )}
      <button type="button" aria-label="增加" onClick={onAdd} className="grid h-6 w-6 place-items-center rounded-full text-[18px] leading-none text-black/45 active:bg-black/5">
        <span className="mt-[-2px]">＋</span>
      </button>
    </span>
  );
}

/** 订单状态推进刷新 hook：事件 + 定时器双通道 */
function useOrdersTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const iv = setInterval(bump, 3000);
    window.addEventListener('mt-orders-changed', bump);
    return () => {
      clearInterval(iv);
      window.removeEventListener('mt-orders-changed', bump);
    };
  }, []);
  return tick;
}

const EMPTY_FAVS: MtFavs = { stores: [], dishes: [], deals: [] };

/** 收藏状态 hook（商家/菜品/团购）：读当前登录账号，切换后强制刷新；返回切换后是否已收藏 */
function useFavs() {
  const [, setVer] = useState(0);
  const session = mtGetSession();
  const uid = session ? mtUidOf(session) : '';
  const favs = uid ? mtLoadFavs(uid) : EMPTY_FAVS;
  const toggle = useCallback(
    (kind: keyof MtFavs, id: string): boolean => {
      if (!uid) return false;
      const on = mtToggleFav(uid, kind, id);
      setVer((v) => v + 1);
      return on;
    },
    [uid]
  );
  return { favs, toggle, uid };
}

/** 「特⚡价团」字标（黄色闪电为 SVG，不用 emoji） */
const TuanMark = ({ className = '' }: { className?: string }) => (
  <span className={`inline-flex items-center whitespace-nowrap font-bold ${className}`}>
    <span className="text-[#FF2D7E]">特</span>
    <Zap className="h-[0.82em] w-[0.82em] fill-[#FFB300] text-[#FFB300]" strokeWidth={0} />
    <span className="text-[#FF2D7E]">价团</span>
  </span>
);

// ================================ 登录页（截图1） ================================

function LoginPage({ onLogin, onToast }: { onLogin: (s: MtSession) => void; onToast: (m: string) => void }) {
  const [agree, setAgree] = useState(true);
  const [auth, setAuth] = useState<{ idp: 'wx' | 'qq'; contactId: string; name: string; avatar: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'pwd' | 'code'>('pwd');
  const [phone, setPhone] = useState('');
  const [pwd, setPwd] = useState('');
  const [code, setCode] = useState('');
  const [cd, setCd] = useState(0);

  useEffect(() => {
    if (cd <= 0) return;
    const t = setTimeout(() => setCd((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cd]);

  const tapIdp = async (idp: 'wx' | 'qq') => {
    if (busy) return;
    if (!agree) {
      onToast('请先阅读并同意《美团用户协议》和《隐私政策》');
      return;
    }
    setBusy(true);
    try {
      const id = await mtResolveIdpIdentity(idp);
      setAuth({ idp, contactId: id.contactId, name: id.name, avatar: id.avatar });
    } finally {
      setBusy(false);
    }
  };

  const confirmAuth = async () => {
    if (!auth) return;
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 700));
      onLogin({ idp: auth.idp, contactId: auth.contactId, name: auth.name, avatar: auth.avatar, loginAt: Date.now() });
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () => {
    if (!/^1\d{10}$/.test(phone)) {
      onToast('请输入正确的手机号');
      return;
    }
    setCd(60);
    onToast('验证码：246810（演示）');
  };

  const phoneLogin = () => {
    if (!agree) {
      onToast('请先阅读并同意《美团用户协议》和《隐私政策》');
      return;
    }
    if (!/^1\d{10}$/.test(phone)) {
      onToast('请输入正确的手机号');
      return;
    }
    if (mode === 'pwd') {
      if (pwd.length < 6 || pwd.length > 16) {
        onToast('请输入 6-16 位密码');
        return;
      }
    } else {
      if (code !== '246810') {
        onToast('验证码错误，请重新输入');
        return;
      }
    }
    onLogin({ idp: 'phone', phone, name: `用户${phone.slice(-4)}`, avatar: null, loginAt: Date.now() });
  };

  const loginReady = /^1\d{10}$/.test(phone) && (mode === 'pwd' ? pwd.length >= 6 : code.length === 6);

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-white">
      {/* 顶栏：关闭 / 语言 / 帮助 */}
      <div className="flex items-center gap-2 px-4 pt-[58px]">
        <button
          type="button"
          aria-label="关闭"
          onClick={() => onToast('请先登录后使用美团')}
          className="grid h-10 w-10 place-items-center rounded-full bg-black/[0.06] active:bg-black/10"
        >
          <X className="h-5 w-5 text-black/80" strokeWidth={2.4} />
        </button>
        <span className="flex-1" />
        <button type="button" onClick={() => onToast('多语言（演示）')} className="flex items-center gap-1.5 px-1 text-[15px] text-black/85 active:opacity-60">
          <Languages className="h-[18px] w-[18px]" />
          Language
          <ChevronRight className="h-3.5 w-3.5 rotate-90 text-black/50" />
        </button>
        <span className="h-4 w-px bg-black/15" />
        <button type="button" onClick={() => onToast('美团客服：0539-000-0000（演示）')} className="px-1 text-[15px] text-black/85 active:opacity-60">
          帮助
        </button>
      </div>

      <p className="mt-12 px-6 text-[30px] font-bold tracking-wide text-black/90">欢迎登录美团</p>

      {/* 输入区 */}
      <div className="mt-10 space-y-4 px-6">
        <div className="flex h-[54px] items-center gap-2 rounded-full bg-[#F5F6F7] px-5">
          <button type="button" onClick={() => onToast('仅支持 +86（演示）')} className="flex shrink-0 items-center gap-1 text-[16px] font-medium text-black/85">
            +86
            <ChevronRight className="h-3.5 w-3.5 rotate-90 text-black/50" />
          </button>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
            inputMode="numeric"
            placeholder="请输入手机号"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30"
          />
        </div>

        {mode === 'pwd' ? (
          <div className="flex h-[54px] items-center gap-2 rounded-full bg-[#F5F6F7] px-5">
            <input
              value={pwd}
              onChange={(e) => setPwd(e.target.value.slice(0, 16))}
              type="password"
              placeholder="请输入密码"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30"
            />
            <EyeOff className="h-5 w-5 shrink-0 text-black/60" />
          </div>
        ) : (
          <div className="flex h-[54px] items-center gap-2 rounded-full bg-[#F5F6F7] px-5">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="请输入验证码"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30"
            />
            <button
              type="button"
              onClick={sendCode}
              disabled={cd > 0}
              className="shrink-0 rounded-full border border-[#FFC300] px-3 py-1.5 text-[12px] font-medium text-[#B77900] active:opacity-70 disabled:opacity-50"
            >
              {cd > 0 ? `${cd}s 后重发` : '获取验证码'}
            </button>
          </div>
        )}
      </div>

      {/* 协议 */}
      <button type="button" onClick={() => setAgree((a) => !a)} className="mt-5 flex items-center gap-2 px-6 text-left">
        <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ${agree ? 'bg-[#FFC300]' : 'border border-black/25'}`}>
          {agree && <Check className="h-3 w-3 text-black/85" strokeWidth={3.2} />}
        </span>
        <span className="text-[13px] text-black/60">
          我已阅读并同意<span className="text-[#2A7BF6]">《美团用户协议》</span>和<span className="text-[#2A7BF6]">《隐私政策》</span>
        </span>
      </button>

      {/* 登录按钮（未就绪淡黄 → 就绪美团黄） */}
      <div className="mt-5 px-6">
        <button
          type="button"
          onClick={phoneLogin}
          className={`h-[52px] w-full rounded-full text-[17px] font-medium active:opacity-85 ${loginReady ? 'bg-[#FFD100] text-black/90' : 'bg-[#F6EC9F] text-black/45'}`}
        >
          登录
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'pwd' ? 'code' : 'pwd');
            setPwd('');
            setCode('');
          }}
          className="mx-auto mt-6 block text-[15px] text-black/65 active:opacity-60"
        >
          {mode === 'pwd' ? '验证码登录' : '密码登录'}
        </button>
      </div>

      {/* 底部三方登录 */}
      <div className="mt-auto flex items-center justify-center gap-10 pb-[max(30px,env(safe-area-inset-bottom))] pt-10">
        <button type="button" aria-label="微信一键登录" onClick={() => void tapIdp('wx')} disabled={busy} className="flex flex-col items-center gap-1.5 active:opacity-70">
          <span className="grid h-[52px] w-[52px] place-items-center overflow-hidden rounded-full bg-[#07C160] shadow-sm">
            <img src="/icons/wechat.png" alt="" className="h-full w-full rounded-full object-cover" />
          </span>
          <span className="text-[10px] text-black/40">微信</span>
        </button>
        <button type="button" onClick={() => onToast('数字身份登录暂未开通，试试微信/QQ')} className="flex flex-col items-center gap-1.5 active:opacity-70">
          <span className="grid h-[52px] w-[52px] place-items-center rounded-full bg-[#F0412E] text-center text-[11px] font-semibold leading-[1.15] text-white shadow-sm">
            数字
            <br />
            身份
          </span>
          <span className="text-[10px] text-black/40">数字身份</span>
        </button>
        <button type="button" aria-label="QQ一键登录" onClick={() => void tapIdp('qq')} disabled={busy} className="flex flex-col items-center gap-1.5 active:opacity-70">
          <span className="grid h-[52px] w-[52px] place-items-center overflow-hidden rounded-full bg-[#12B7F5] shadow-sm">
            <img src="/icons/qq.png" alt="" className="h-full w-full rounded-full object-cover" />
          </span>
          <span className="text-[10px] text-black/40">QQ</span>
        </button>
      </div>

      {auth && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 px-8" onClick={() => !busy && setAuth(null)}>
          <div className="w-full rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5">
              <img src={auth.idp === 'wx' ? '/icons/wechat.png' : '/icons/qq.png'} alt="" className="h-9 w-9 rounded-lg" />
              <img src="/icons/meituan.png" alt="" className="h-6 w-6 rounded-md" />
              <p className="text-[15px] font-semibold text-black/80">{auth.idp === 'wx' ? '微信' : 'QQ'}授权登录</p>
            </div>
            <p className="mt-3 text-[13px] text-black/55">美团申请获取以下信息：</p>
            <div className="mt-2 space-y-1.5 rounded-xl bg-[#F5F6F7] p-3 text-[13px] text-black/70">
              <p>· 你的昵称、头像</p>
              <p>· 你的{auth.idp === 'wx' ? '微信' : 'QQ'}OpenID（用于识别账号）</p>
            </div>
            <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-black/5 p-2.5">
              {auth.avatar ? (
                <img src={auth.avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#FFD100] text-[16px] font-bold text-black/70">{auth.name.slice(0, 1)}</span>
              )}
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-black/80">{auth.name}</p>
                <p className="text-[11px] text-black/40">{auth.idp === 'wx' ? '当前登录的微信账号' : '当前登录的QQ账号'}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void confirmAuth()}
              disabled={busy}
              className={`mt-4 h-11 w-full rounded-full text-[15px] font-medium text-white active:opacity-85 disabled:opacity-60 ${auth.idp === 'wx' ? 'bg-[#07C160]' : 'bg-[#12B7F5]'}`}
            >
              {busy ? '登录中…' : '同意授权'}
            </button>
            <button type="button" onClick={() => setAuth(null)} className="mt-2 h-9 w-full text-[13px] text-black/40">
              拒绝
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ================================ 底部导航（推荐/视频/小团/购物车/我的） ================================

/** 底部 Tab（对齐真机截图2）：推荐=黑底白 N 圆标、视频=播放圈+红点1、小团=黄底袋鼠凸起+彩虹环、
 *  购物车/我的=线性图标；选中态黑色加粗，未选中灰色（真机无黄色选中态） */
function BottomTabBar({ active, onTab, onToast }: { active: Tab; onTab: (t: Tab) => void; onToast: (m: string) => void }) {
  const labelCls = (on: boolean) => `text-[10px] leading-none ${on ? 'font-semibold text-black/90' : 'text-black/45'}`;
  const stroke = (on: boolean) => (on ? 2.1 : 1.7);
  return (
    <div className="relative z-20 flex shrink-0 items-start border-t border-black/[0.06] bg-white pb-[max(7px,env(safe-area-inset-bottom))]">
      {/* 推荐：黑底白 N 圆标（品牌标恒黑） */}
      <button type="button" onClick={() => onTab('home')} className="flex flex-1 flex-col items-center gap-[3px] pt-[7px] active:opacity-70">
        <span className="grid h-[24px] w-[24px] place-items-center rounded-full bg-black">
          <span className="text-[13px] font-black leading-none text-white" style={{ fontFamily: 'Arial, sans-serif' }}>N</span>
        </span>
        <span className={labelCls(active === 'home')}>推荐</span>
      </button>
      {/* 视频：播放圈 + 红点 1 */}
      <button type="button" onClick={() => onToast('美团视频敬请期待')} className="flex flex-1 flex-col items-center gap-[3px] pt-[7px] active:opacity-70">
        <span className="relative">
          <CirclePlay className="h-[24px] w-[24px] text-black/80" strokeWidth={1.7} />
          <span className="absolute -right-[9px] -top-[5px] grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[#FA2C19] px-[3px] text-[9px] font-bold leading-none text-white">1</span>
        </span>
        <span className={labelCls(false)}>视频</span>
      </button>
      {/* 小团：凸起袋鼠头像 + 彩虹渐变环 */}
      <button type="button" onClick={() => onToast('小团 AI 助手敬请期待')} className="flex flex-1 flex-col items-center gap-[3px] pt-[7px] active:opacity-70">
        <span className="relative h-[24px] w-[24px]">
          <span
            className="absolute bottom-[-4px] left-1/2 h-[44px] w-[44px] -translate-x-1/2 rounded-full p-[2.5px] shadow-[0_2px_10px_rgba(0,0,0,0.18)]"
            style={{ background: 'conic-gradient(from 210deg, #FFD100, #FF8A5E, #FF66B8, #7CC7FF, #B69CFF, #FFD100)' }}
          >
            <span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-[#FFD100]">
              <img src="/icons/meituan.png" alt="" className="h-[112%] w-[112%] max-w-none object-cover" />
            </span>
          </span>
        </span>
        <span className={labelCls(false)}>小团</span>
      </button>
      {/* 购物车 */}
      <button type="button" onClick={() => onTab('cart')} className="flex flex-1 flex-col items-center gap-[3px] pt-[7px] active:opacity-70">
        <ShoppingCart className="h-[24px] w-[24px] text-black/80" strokeWidth={stroke(active === 'cart')} />
        <span className={labelCls(active === 'cart')}>购物车</span>
      </button>
      {/* 我的 */}
      <button type="button" onClick={() => onTab('my')} className="flex flex-1 flex-col items-center gap-[3px] pt-[7px] active:opacity-70">
        <Smile className="h-[24px] w-[24px] text-black/80" strokeWidth={stroke(active === 'my')} />
        <span className={labelCls(active === 'my')}>我的</span>
      </button>
    </div>
  );
}

// ================================ 首页（截图2） ================================

/** 团购卡（瀑布流） */
function DealCard({ deal, onOpen }: { deal: MtDeal; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="mb-2 block w-full break-inside-avoid overflow-hidden rounded-xl bg-white text-left shadow-[0_1px_6px_rgba(0,0,0,0.04)] active:opacity-90">
      <span className="relative block">
        <FoodImg src={deal.img} emoji={deal.emoji} className="h-[150px] w-full" />
        <span className="absolute bottom-2 left-2 flex gap-1">
          <span className="rounded-[4px] bg-[#FF3B30] px-1.5 py-0.5 text-[10px] font-medium text-white">团购</span>
          <span className="rounded-[4px] bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{deal.distanceKm.toFixed(1)}km</span>
        </span>
      </span>
      <span className="block px-2.5 pb-2.5 pt-2">
        <span className="flex items-center gap-1 text-[14px] font-bold leading-snug text-black/90">
          <TuanMark className="shrink-0 text-[14px]" />
          <span className="truncate">{deal.title}</span>
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[12px]">
          <span className="font-medium text-[#FF2D7E]">{deal.tips}</span>
          <span className="text-black/45">{deal.praise}</span>
        </span>
        <span className="mt-1 flex items-baseline gap-1.5">
          <span className="text-[19px] font-bold leading-none" style={{ color: MT_PRICE }}>
            <span className="text-[12px]">¥</span>
            {fmtMoney(deal.price)}
          </span>
          <span className="text-[12px] text-black/40">{deal.discount}</span>
          <span className="truncate text-[11px] text-black/40">{deal.sold}</span>
        </span>
      </span>
    </button>
  );
}

/** 特价团聚合卡（列表位） */
function DealListCard({ onOpen }: { onOpen: (id: string) => void }) {
  const deals = MT_HOME_LIST.dealIds.map((id) => MT_DEALS.find((d) => d.id === id)).filter((d): d is MtDeal => !!d);
  if (deals.length === 0) return null;
  return (
    <div className="mb-2 break-inside-avoid rounded-xl bg-white p-3 shadow-[0_1px_6px_rgba(0,0,0,0.04)]">
      <button type="button" onClick={() => onOpen(deals[0].id)} className="flex w-full items-center gap-1.5 whitespace-nowrap text-left active:opacity-70">
        <TuanMark className="shrink-0 text-[15px]" />
        <span className="shrink-0 rounded-[4px] bg-[#FF3B30] px-1 py-px text-[10px] font-medium text-white">{MT_HOME_LIST.badge}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-black/85">{MT_HOME_LIST.title}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
      </button>
      <div className="mt-2.5 space-y-3">
        {deals.map((d) => (
          <button key={d.id} type="button" onClick={() => onOpen(d.id)} className="flex w-full items-center gap-2.5 text-left active:opacity-80">
            <FoodImg src={d.img} emoji={d.emoji} className="h-[56px] w-[56px] shrink-0 rounded-lg" />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[13px] leading-snug text-black/85">{d.title.length > 9 ? `${d.title.slice(0, 9)}…` : d.title}【{d.tips}】</span>
              <span className="mt-1 flex items-baseline gap-1">
                <span className="rounded-[3px] bg-[#FFE8F1] px-1 text-[10px] text-[#FF2D7E]">{d.discount}</span>
                <span className="text-[15px] font-bold leading-none" style={{ color: MT_PRICE }}>
                  ¥{fmtMoney(d.price)}
                </span>
                <span className="text-[11px] text-black/30 line-through">¥{fmtMoney(d.origPrice)}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 外卖商家卡（瀑布流） */
function MerchantCard({ m, onOpen }: { m: MtMerchant; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="mb-2 block w-full break-inside-avoid overflow-hidden rounded-xl bg-white text-left shadow-[0_1px_6px_rgba(0,0,0,0.04)] active:opacity-90">
      <FoodImg src={m.cover} emoji={m.emoji} className="h-[120px] w-full" />
      <span className="block px-2.5 pb-2.5 pt-2">
        <span className="block truncate text-[14px] font-bold text-black/90">{m.name}</span>
        <span className="mt-1 flex items-center gap-1.5 text-[11px]">
          <span className="flex items-center gap-0.5 text-[#FF6000]">
            <Star className="h-3 w-3 fill-[#FF6000]" strokeWidth={0} />
            <span className="font-semibold">{m.rating}</span>
          </span>
          <span className="text-black/40">月售{m.monthSale >= 10000 ? `${(m.monthSale / 10000).toFixed(1)}万` : m.monthSale}+</span>
        </span>
        <span className="mt-0.5 block text-[11px] text-black/45">
          起送 ¥{m.minOrder} · 配送 ¥{m.deliveryFee} · {m.distanceKm}km
        </span>
        {m.deals[0] && (
          <span className="mt-1.5 inline-block rounded-[3px] border border-[#FF4B33]/35 px-1 py-px text-[10px] leading-[1.5] text-[#FF4B33]">{m.deals[0]}</span>
        )}
      </span>
    </button>
  );
}

const HOME_SEARCH_HINTS = ['衣服女装套装', '珍珠奶茶', '爆款汉堡4件套', '麻辣烫', '应季草莓', '电影票'];

function HomePage({
  session,
  onOpenMerchant,
  onOpenDeal,
  onOpenSearch,
  onPickAddress,
  onToast,
}: {
  session: MtSession;
  onOpenMerchant: (id: string) => void;
  onOpenDeal: (id: string) => void;
  onOpenSearch: () => void;
  onPickAddress: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const addrs = useMemo(() => mtLoadAddresses(uid), [uid]);
  const cur = addrs.find((a) => a.id === mtCurAddrId(uid)) ?? addrs[0];
  const [filter, setFilter] = useState<string | null>(null); // null=推荐流 / 'tuangou' / 商家分类id
  const [hintIdx, setHintIdx] = useState(0);
  const [gridPage, setGridPage] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const iv = setInterval(() => setHintIdx((i) => (i + 1) % HOME_SEARCH_HINTS.length), 3200);
    return () => clearInterval(iv);
  }, []);

  const feed = useMemo(() => {
    type FeedItem = { t: 'deal'; d: MtDeal } | { t: 'list' } | { t: 'm'; m: MtMerchant };
    if (filter === 'tuangou') {
      return MT_DEALS.map<FeedItem>((d) => ({ t: 'deal', d }));
    }
    if (filter) {
      return MT_MERCHANTS.filter((m) => m.cats.includes(filter)).map<FeedItem>((m) => ({ t: 'm', m }));
    }
    const byId = (id: string) => MT_DEALS.find((d) => d.id === id);
    const mById = (id: string) => MT_MERCHANTS.find((m) => m.id === id);
    const seq: FeedItem[] = [];
    const push = (i: FeedItem | undefined) => {
      if (i) seq.push(i);
    };
    push(byId('d-tast-set') && { t: 'deal', d: byId('d-tast-set')! });
    push({ t: 'list' });
    push(byId('d-ygf-set') && { t: 'deal', d: byId('d-ygf-set')! });
    push(mById('m-mixue') && { t: 'm', m: mById('m-mixue')! });
    push(byId('d-zb-pizza') && { t: 'deal', d: byId('d-zb-pizza')! });
    push(byId('d-fruit-3x1') && { t: 'deal', d: byId('d-fruit-3x1')! });
    push(mById('m-tasiting') && { t: 'm', m: mById('m-tasiting')! });
    push(byId('d-bf-2r') && { t: 'deal', d: byId('d-bf-2r')! });
    push(mById('m-hotpot') && { t: 'm', m: mById('m-hotpot')! });
    push(byId('d-mixue-hyn') && { t: 'deal', d: byId('d-mixue-hyn')! });
    push(byId('d-mixue-mjlv') && { t: 'deal', d: byId('d-mixue-mjlv')! });
    push(mById('m-noodle') && { t: 'm', m: mById('m-noodle')! });
    push(mById('m-store') && { t: 'm', m: mById('m-store')! });
    push(mById('m-fruit') && { t: 'm', m: mById('m-fruit')! });
    push(mById('m-pharmacy') && { t: 'm', m: mById('m-pharmacy')! });
    push(mById('m-pizza') && { t: 'm', m: mById('m-pizza')! });
    push(mById('m-rice') && { t: 'm', m: mById('m-rice')! });
    push(mById('m-breakfast') && { t: 'm', m: mById('m-breakfast')! });
    push(mById('m-yangguofu') && { t: 'm', m: mById('m-yangguofu')! });
    return seq;
  }, [filter]);

  const tapCat = (c: (typeof MT_HOME_GRID)[number][number]) => {
    if (c.filter === null || c.filter === undefined) {
      onToast(`「${c.name}」频道即将上线`);
      return;
    }
    setFilter((f) => (f === c.filter ? null : c.filter!));
  };

  const filterName = filter === 'tuangou' ? '团购' : filter ? (MT_CATS.find((c) => c.id === filter)?.name ?? '') : '';

  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-[#F4F5F7] pb-4">
      {/* 黄头：定位 / 消息 / 扫一扫 / 搜索 */}
      <div className="bg-[#FFD100] px-4 pb-3 pt-[54px]">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onPickAddress} className="flex min-w-0 items-center gap-1 text-left active:opacity-70">
            <MapPin className="h-[18px] w-[18px] shrink-0 text-black/80" strokeWidth={2.2} />
            <span className="truncate text-[17px] font-semibold text-black/90">{cur ? cur.text.slice(0, 9) : '选择地址'}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-black/60" />
          </button>
          <span className="flex-1" />
          <button type="button" aria-label="消息" onClick={() => onToast('暂无新消息')} className="active:opacity-60">
            <MessageCircleMore className="h-[22px] w-[22px] text-black/80" strokeWidth={1.9} />
          </button>
          <button type="button" aria-label="扫一扫" onClick={() => onToast('扫一扫（演示）')} className="ml-3 active:opacity-60">
            <ScanLine className="h-[22px] w-[22px] text-black/80" strokeWidth={1.9} />
          </button>
        </div>
        <button type="button" onClick={onOpenSearch} className="mt-3 flex h-10 w-full items-center gap-2 rounded-full bg-white pl-4 pr-1 text-left shadow-sm active:opacity-95">
          <span key={hintIdx} className="min-w-0 flex-1 truncate text-[14px] text-black/75">{HOME_SEARCH_HINTS[hintIdx]}</span>
          <span className="rounded-full bg-[#FFD100] px-5 py-[7px] text-[14px] font-semibold text-black/85">搜索</span>
        </button>
      </div>

      {/* 分类宫格（两页 + 圆点） */}
      <div className="bg-white">
        <div
          ref={gridRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setGridPage(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
          }}
          className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {MT_HOME_GRID.map((pageCats, pi) => (
            <div key={pi} className="grid w-full shrink-0 snap-center grid-cols-5 gap-y-4 px-2 py-3.5">
              {pageCats.map((c) => {
                const activeFilter = filter !== null && c.filter === filter;
                const GIcon = GRID_ICONS[c.icon] ?? LayoutGrid;
                return (
                  <button key={c.id} type="button" onClick={() => tapCat(c)} className="flex flex-col items-center gap-1.5 active:opacity-70">
                    <span className={`grid h-[46px] w-[46px] place-items-center rounded-2xl bg-gradient-to-br ${c.tint} ${activeFilter ? 'ring-2 ring-[#FFC300]' : ''}`}>
                      <GIcon className="h-[24px] w-[24px]" style={{ color: c.fg }} strokeWidth={2.1} />
                    </span>
                    <span className={`text-[11px] ${activeFilter ? 'font-semibold text-black/85' : 'text-black/65'}`}>{c.name}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-1.5 pb-2.5">
          {MT_HOME_GRID.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`第${i + 1}页`}
              onClick={() => gridRef.current?.scrollTo({ left: i * gridRef.current.clientWidth, behavior: 'smooth' })}
              className={`h-[5px] rounded-full transition-all ${gridPage === i ? 'w-4 bg-[#FFC300]' : 'w-[5px] bg-black/15'}`}
            />
          ))}
        </div>
      </div>

      {/* 筛选条 */}
      {filterName && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[12px] shadow-sm">
          <span className="font-medium text-black/75">{filterName}</span>
          <span className="text-black/35">· 点击分类名可取消</span>
          <button type="button" onClick={() => setFilter(null)} className="ml-auto grid h-4 w-4 place-items-center rounded-full bg-black/10">
            <X className="h-2.5 w-2.5 text-black/60" />
          </button>
        </div>
      )}

      {/* 瀑布流 */}
      <div className="mt-2 columns-2 gap-2 px-2">
        {feed.map((it, i) =>
          it.t === 'deal' ? (
            <DealCard key={`deal-${it.d.id}-${i}`} deal={it.d} onOpen={() => onOpenDeal(it.d.id)} />
          ) : it.t === 'list' ? (
            <DealListCard key="deal-list" onOpen={onOpenDeal} />
          ) : (
            <MerchantCard key={`m-${it.m.id}-${i}`} m={it.m} onOpen={() => onOpenMerchant(it.m.id)} />
          )
        )}
      </div>
      {feed.length === 0 && <p className="mx-3 mt-6 rounded-2xl bg-white p-8 text-center text-[13px] text-black/40">该分类下暂无商家</p>}
    </div>
  );
}

// ================================ 搜索页 ================================

function SearchPage({ onBack, onOpenMerchant }: { onBack: () => void; onOpenMerchant: (id: string) => void }) {
  const [kw, setKw] = useState('');
  const [done, setDone] = useState('');
  const [hist, setHist] = useState<string[]>(() => mtGetSearchHist());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = (k: string) => {
    const key = k.trim();
    if (!key) return;
    setKw(key);
    setDone(key);
    const next = [key, ...mtGetSearchHist().filter((x) => x !== key)].slice(0, 10);
    try {
      window.localStorage.setItem('mt-search-hist', JSON.stringify(next));
    } catch {
      /* 忽略 */
    }
    setHist(next);
  };

  const merchantHits = done
    ? MT_MERCHANTS.filter((m) => m.name.includes(done) || m.cats.some((c) => MT_CATS.find((x) => x.id === c)?.name.includes(done)) || m.sections.some((s) => s.cat.includes(done)))
    : [];
  const dishHits = done
    ? MT_MERCHANTS.flatMap((m) => mtDishesOf(m).filter((d) => d.name.includes(done)).map((d) => ({ m, d }))).slice(0, 12)
    : [];

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-black/[0.04] bg-white px-3 pb-2.5 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-6 w-6 text-black/70" />
        </button>
        <div className="flex h-10 flex-1 items-center gap-2 rounded-full bg-[#F5F6F7] px-3.5">
          <SearchIcon className="h-4 w-4 text-black/35" />
          <input
            ref={inputRef}
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run(kw);
            }}
            placeholder="搜索商家、菜品"
            className="h-full flex-1 bg-transparent text-[14px] outline-none placeholder:text-black/30"
          />
          {kw && (
            <button type="button" aria-label="清空" onClick={() => { setKw(''); setDone(''); }}>
              <X className="h-4 w-4 text-black/30" />
            </button>
          )}
        </div>
        <button type="button" onClick={() => run(kw)} className="rounded-full bg-[#FFD100] px-4 py-2 text-[14px] font-medium text-black/85 active:opacity-80">
          搜索
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!done && (
          <>
            <p className="text-[14px] font-semibold text-black/70">搜索发现</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {['奶茶', '汉堡', '麻辣烫', '水果', '药品', '比萨', '盖浇饭', '火锅'].map((h) => (
                <button key={h} type="button" onClick={() => run(h)} className="rounded-full bg-[#F5F6F7] px-3 py-1.5 text-[12px] text-black/65 active:opacity-70">
                  {h}
                </button>
              ))}
            </div>
            {hist.length > 0 && (
              <>
                <div className="mt-5 flex items-center">
                  <p className="text-[14px] font-semibold text-black/70">搜索历史</p>
                  <button
                    type="button"
                    onClick={() => {
                      mtClearSearchHist();
                      setHist([]);
                    }}
                    className="ml-auto text-[12px] text-black/35"
                  >
                    清空
                  </button>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {hist.map((h) => (
                    <button key={h} type="button" onClick={() => run(h)} className="rounded-full bg-[#F5F6F7] px-3 py-1.5 text-[12px] text-black/65 active:opacity-70">
                      {h}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {done && (
          <>
            {merchantHits.length > 0 && <p className="text-[13px] font-semibold text-black/45">相关商家</p>}
            <div className="mt-2 divide-y divide-black/[0.04]">
              {merchantHits.map((m) => (
                <SearchMerchantRow key={m.id} m={m} onOpen={() => onOpenMerchant(m.id)} />
              ))}
            </div>
            {dishHits.length > 0 && <p className="mt-4 text-[13px] font-semibold text-black/45">相关菜品</p>}
            <div className="mt-2 divide-y divide-black/[0.04]">
              {dishHits.map(({ m, d }) => (
                <button key={d.id} type="button" onClick={() => onOpenMerchant(m.id)} className="flex w-full items-center gap-3 p-2.5 text-left active:bg-black/[0.02]">
                  <FoodImg src={d.img} emoji={d.emoji} className="h-12 w-12 shrink-0 rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-black/85">{d.name}</span>
                    <span className="block text-[11px] text-black/40">{m.name}</span>
                  </span>
                  <span className="text-[15px] font-semibold" style={{ color: MT_PRICE }}>
                    ¥{fmtMoney(d.price)}
                  </span>
                </button>
              ))}
            </div>
            {merchantHits.length === 0 && dishHits.length === 0 && (
              <div className="mt-16 text-center">
                <p className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#F5F6F7]">
                  <SearchIcon className="h-6 w-6 text-black/25" strokeWidth={1.8} />
                </p>
                <p className="mt-2 text-[13px] text-black/40">没有找到「{done}」相关的商家或菜品</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** 搜索结果商家行（列表式） */
function SearchMerchantRow({ m, onOpen }: { m: MtMerchant; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full gap-3 p-3 text-left active:bg-black/[0.02]">
      <FoodImg src={m.cover} emoji={m.emoji} className="h-[76px] w-[76px] shrink-0 rounded-xl" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-black/85">{m.name}</span>
        <span className="mt-1 flex items-center gap-1.5 text-[12px]">
          <span className="flex items-center gap-0.5 text-[#FF6000]">
            <Star className="h-3 w-3 fill-[#FF6000]" strokeWidth={0} />
            <span className="font-semibold">{m.rating}</span>
          </span>
          <span className="text-black/40">月售{m.monthSale >= 10000 ? `${(m.monthSale / 10000).toFixed(1)}万` : m.monthSale}+</span>
          <span className="text-black/40">{m.deliveryMin}分钟 · {m.distanceKm}km</span>
        </span>
        <span className="mt-1 block text-[12px] text-black/55">
          起送 ¥{m.minOrder} · 配送 ¥{m.deliveryFee}
          {m.minOrder === 0 && <span className="ml-1 text-[#00A661]">免起送</span>}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-1">
          {m.deals.slice(0, 2).map((d) => (
            <span key={d} className="rounded border border-[#FF4B33]/35 px-1 py-px text-[10px] leading-[1.5] text-[#FF4B33]">
              {d}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

// ================================ 商家详情页 ================================

/** 商家页页签记忆（进订单详情再返回时停留在原页签，如「订单」） */
let merchantTabMemo: '点菜' | '评价' | '商家' | '订单' = '点菜';

function MerchantPage({ merchant, onBack, onCheckout, onOpenOrder, onToast }: { merchant: MtMerchant; onBack: () => void; onCheckout: () => void; onOpenOrder: (id: string) => void; onToast: (m: string) => void }) {
  const { favs, toggle } = useFavs();
  const storeFav = favs.stores.includes(merchant.id);
  const session = mtGetSession();
  const uid = session ? mtUidOf(session) : '';
  const [tab, setTab] = useState<'点菜' | '评价' | '商家' | '订单'>(merchantTabMemo);
  const [cart, setCart] = useState<MtCart>(() => mtLoadCart(uid));
  const [cartOpen, setCartOpen] = useState(false);
  const [activeCat, setActiveCat] = useState(0);
  const [specDish, setSpecDish] = useState<MtDish | null>(null); // 规格/小料选择弹窗
  const catRefs = useRef<(HTMLDivElement | null)[]>([]);
  useOrdersTick();
  const shopOrders = uid ? mtLoadOrders(uid).filter((o) => o.merchantId === merchant.id) : [];

  const calc = mtCheckoutCalc(uid, merchant, cart);
  const cartMerchantOk = cart.merchantId === null || cart.merchantId === merchant.id || cart.items.length === 0;

  /** 函数式更新 + 持久化（连续点击同一帧内也正确累加，避免 stale state 相互覆盖） */
  const mutateCart = (updater: (prev: MtCart) => MtCart): void => {
    setCart((prev) => {
      const next = updater(prev);
      mtSaveCart(uid, next);
      return next;
    });
  };

  const add = (d: MtDish) => {
    if (!cartMerchantOk && cart.items.length > 0) {
      onToast('不同商家商品不能合并结算，请先结算或清空购物车');
      return;
    }
    // 有规格的菜品（奶茶小料/食物配菜）先弹规格选择弹窗
    if (d.specs && d.specs.length > 0) {
      setSpecDish(d);
      return;
    }
    mutateCart((prev) => ({
      merchantId: merchant.id,
      items: prev.items.some((i) => i.dishId === d.id)
        ? prev.items.map((i) => (i.dishId === d.id ? { ...i, qty: i.qty + 1 } : i))
        : [...prev.items, { dishId: d.id, qty: 1 }],
    }));
  };
  /** 规格弹窗「选好了」：同菜不同规格分行（dishId+spec 为唯一键） */
  const addWithSpec = (d: MtDish, qty: number, spec: string, unitPrice: number) => {
    if (!cartMerchantOk && cart.items.length > 0) {
      onToast('不同商家商品不能合并结算，请先结算或清空购物车');
      setSpecDish(null);
      return;
    }
    mutateCart((prev) => {
      const sameKey = (i: { dishId: string; spec?: string }): boolean => i.dishId === d.id && (i.spec ?? '') === spec;
      const items = prev.items.some(sameKey)
        ? prev.items.map((i) => (sameKey(i) ? { ...i, qty: i.qty + qty } : i))
        : [...prev.items, { dishId: d.id, qty, spec, unitPrice }];
      return { merchantId: merchant.id, items };
    });
    setSpecDish(null);
    onToast(`已加入购物车${spec ? `（${spec}）` : ''}`);
  };
  const dec = (d: MtDish) => {
    // 多规格分行：减最后一个同菜行
    mutateCart((prev) => {
      const idx = prev.items.map((i) => i.dishId).lastIndexOf(d.id);
      if (idx < 0) return prev;
      const items = prev.items.map((i, k) => (k === idx ? { ...i, qty: i.qty - 1 } : i)).filter((i) => i.qty > 0);
      return { merchantId: items.length > 0 ? merchant.id : null, items };
    });
  };
  const clearCart = () => {
    const next: MtCart = { merchantId: null, items: [] };
    setCart(next);
    mtSaveCart(uid, next);
    setCartOpen(false);
  };

  const qtyOf = (dishId: string): number => cart.items.find((i) => i.dishId === dishId)?.qty ?? 0;
  const belowMin = calc.itemTotal < merchant.minOrder;

  // 点菜分区滚动跟随
  const onCatTap = (idx: number) => {
    setActiveCat(idx);
    catRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      {/* 头图 + 悬浮搜索条（对齐团购详情页头） */}
      <div className="relative h-[128px] shrink-0">
        <FoodImg src={merchant.cover} emoji={merchant.emoji} className="h-full w-full" />
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-3 pt-[54px]">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/35 text-white active:opacity-75">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-white/95 px-3">
            <SearchIcon className="h-3.5 w-3.5 shrink-0 text-black/40" />
            <span className="truncate text-[13px] text-black/70">{merchant.name}</span>
            <span className="ml-auto shrink-0 rounded-full bg-[#FFD100] px-3 py-1 text-[12px] font-medium text-black/85">搜索</span>
          </div>
          <button
            type="button"
            aria-label="收藏商家"
            onClick={() => onToast(toggle('stores', merchant.id) ? '已收藏，可在收藏中查看' : '已取消收藏商家')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/35 text-white active:opacity-75"
          >
            <Star className={`h-4 w-4 ${storeFav ? 'fill-[#FFD100] text-[#FFD100]' : ''}`} />
          </button>
        </div>
      </div>

      {/* 商家信息（白底直排无面板） */}
      <div className="relative z-10 -mt-6 border-y border-black/[0.05] bg-white px-4 py-3.5">
          <div className="flex gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl">
              <FoodImg src={merchant.cover} emoji={merchant.emoji} className="h-full w-full" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[17px] font-bold text-black/85">{merchant.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-black/50">
                <span className="flex items-center gap-0.5 text-[#FF6000]">
                  <Star className="h-3 w-3 fill-[#FF6000]" strokeWidth={0} />
                  <span className="font-semibold">{merchant.rating}</span>
                </span>
                <span>月售{merchant.monthSale >= 10000 ? `${(merchant.monthSale / 10000).toFixed(1)}万` : merchant.monthSale}+</span>
                <span>{merchant.deliveryMin}分钟 · {merchant.distanceKm}km</span>
              </p>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {merchant.deals.map((d) => (
              <span key={d} className="rounded bg-[#FFF0EB] px-1.5 py-0.5 text-[11px] text-[#FF4B33]">
                {d}
              </span>
            ))}
            <span className="ml-auto text-[11px] text-black/35">公告：{merchant.notice?.slice(0, 12) ?? '无'}</span>
          </div>
      </div>

      {/* 页签（点菜/评价/商家/本店订单） */}
      <div className="mt-0 flex shrink-0 items-center gap-6 px-5">
        {(['点菜', '评价', '商家', '订单'] as const).map((t) => (
          <button key={t} type="button" onClick={() => { merchantTabMemo = t; setTab(t); }} className={`relative py-2 text-[15px] ${tab === t ? 'font-bold text-black/85' : 'text-black/45'}`}>
            {t}
            {t === '订单' && shopOrders.some((o) => ['pendingAccept', 'accepted', 'delivering'].includes(o.status)) && (
              <span className="absolute -right-2.5 top-1 grid h-[14px] min-w-[14px] place-items-center rounded-full bg-[#FF3B30] px-0.5 text-[9px] font-bold text-white">
                {shopOrders.filter((o) => ['pendingAccept', 'accepted', 'delivering'].includes(o.status)).length}
              </span>
            )}
            {tab === t && <span className="absolute -bottom-px left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full bg-[#FFD100]" />}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      {tab === '点菜' && (
        <div className="flex min-h-0 flex-1">
          <div className="w-[88px] shrink-0 overflow-y-auto bg-[#EDEEF0] pb-28 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {merchant.sections.map((s, i) => (
              <button key={s.cat} type="button" onClick={() => onCatTap(i)} className={`flex w-full flex-col items-center gap-0.5 px-2 py-3.5 text-[12px] leading-tight ${activeCat === i ? 'bg-white font-semibold text-black/85' : 'text-black/50'}`}>
                <span>{s.cat}</span>
                <span className="text-[10px] text-black/35">{s.dishes.length}种</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto bg-white pb-32 px-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {merchant.sections.map((s, i) => (
              <div key={s.cat} ref={(el) => { catRefs.current[i] = el; }} className="scroll-mt-2">
                <p className="py-2.5 text-[14px] font-bold text-black/80">{s.cat}</p>
                {s.dishes.map((d) => (
                  <div key={d.id} className="flex gap-2.5 py-2">
                    <span className="relative shrink-0">
                      <FoodImg src={d.img} emoji={d.emoji} className="h-[72px] w-[72px] rounded-lg" />
                      <button
                        type="button"
                        aria-label="收藏菜品"
                        onClick={() => onToast(toggle('dishes', d.id) ? '已收藏菜品' : '已取消收藏菜品')}
                        className="absolute right-0.5 top-0.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-black/30 active:scale-90"
                      >
                        <Heart className={`h-3 w-3 ${favs.dishes.includes(d.id) ? 'fill-[#FF2D7E] text-[#FF2D7E]' : 'text-white'}`} strokeWidth={2.4} />
                      </button>
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="flex items-center gap-1 text-[14px] font-medium leading-snug text-black/85">
                        <span className="truncate">{d.name}</span>
                        {d.sig && <span className="shrink-0 rounded bg-[#FFF3B8] px-1 text-[10px] text-[#B77900]">招牌</span>}
                      </p>
                      {d.desc && <p className="mt-0.5 line-clamp-1 text-[11px] text-black/40">{d.desc}</p>}
                      <p className="mt-0.5 text-[11px] text-black/35">月售{d.monthSale >= 10000 ? `${(d.monthSale / 10000).toFixed(1)}万` : d.monthSale}</p>
                      <div className="mt-auto flex items-end justify-between pt-1">
                        <span className="text-[16px] font-bold" style={{ color: MT_PRICE }}>
                          <span className="text-[11px]">¥</span>
                          {fmtMoney(d.price)}
                          {d.origPrice && <span className="ml-1 text-[11px] font-normal text-black/30 line-through">¥{fmtMoney(d.origPrice)}</span>}
                        </span>
                        <Stepper qty={qtyOf(d.id)} onAdd={() => add(d)} onDec={() => dec(d)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === '评价' && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 pb-28 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-end gap-2">
            <span className="text-[34px] font-bold leading-none text-[#FF6000]">{merchant.rating}</span>
            <span className="pb-1 text-[12px] text-black/40">综合评分 · 月售{merchant.monthSale >= 10000 ? `${(merchant.monthSale / 10000).toFixed(1)}万` : merchant.monthSale}+</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {['全部({n})', '味道赞', '配送快', '包装好', '分量足'].map((t, i) => (
              <span key={t} className={`rounded-full px-3 py-1.5 text-[12px] ${i === 0 ? 'bg-[#FFF3B8] font-medium text-[#B77900]' : 'bg-[#F5F6F7] text-black/55'}`}>
                {t.replace('({n})', `(${merchant.reviews.length})`)}
              </span>
            ))}
          </div>
          <div className="mt-4 space-y-4">
            {merchant.reviews.map((r, i) => (
              <div key={`${r.user}-${i}`} className="flex gap-2.5 border-b border-black/5 pb-4 last:border-0">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FFE0D1] to-[#FFB08A] text-[14px] font-bold text-black/60">{r.user.slice(0, 1)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-black/75">{r.user}</p>
                  <p className="mt-0.5 flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, si) => (
                      <Star key={si} className={`h-3 w-3 ${si < Math.round(r.rating) ? 'fill-[#FF6000] text-[#FF6000]' : 'text-black/15'}`} strokeWidth={1.5} />
                    ))}
                    <span className="ml-1 text-[11px] text-black/30">{r.time}</span>
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-black/70">{r.content}</p>
                  {r.tags && (
                    <p className="mt-1.5 flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <span key={t} className="rounded bg-[#F5F6F7] px-1.5 py-0.5 text-[10px] text-black/45">
                          {t}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === '商家' && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 pb-28 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="space-y-3.5 text-[13px]">
            {[
              ['商家地址', merchant.addr],
              ['营业时间', merchant.hours],
              ['起送价', `¥${merchant.minOrder}`],
              ['配送费', `¥${merchant.deliveryFee}（满45免配送费）`],
              ['预计送达', `约 ${merchant.deliveryMin} 分钟`],
              ['商家公告', merchant.notice ?? '暂无公告'],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <span className="w-[64px] shrink-0 text-black/40">{k}</span>
                <span className="flex-1 leading-relaxed text-black/75">{v}</span>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => onToast('已拨打商家电话（演示）')} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full border border-black/10 py-3 text-[14px] text-black/70 active:bg-black/5">
            <PhoneIcon className="h-4 w-4" /> 联系商家
          </button>
        </div>
      )}

      {tab === '订单' && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#F4F5F7] px-3 pb-28 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {shopOrders.length === 0 ? (
            <div className="mt-14 text-center">
              <p className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-black/[0.05]">
                <Receipt className="h-6 w-6 text-black/25" />
              </p>
              <p className="mt-3 text-[13px] text-black/40">在本店还没有订单，下一单吧</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {shopOrders.map((o) => (
                <button key={o.id} type="button" onClick={() => onOpenOrder(o.id)} className="block w-full rounded-2xl bg-white p-3.5 text-left shadow-sm active:bg-black/[0.02]">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-black/85">{o.items[0]?.name ?? o.merchantName}</span>
                    <span className={`shrink-0 text-[12px] ${['pendingPay', 'pendingAccept', 'accepted', 'delivering'].includes(o.status) ? 'font-medium text-[#FF6000]' : 'text-[#9A9A9A]'}`}>{mtStatusText(o)}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-black/20" />
                  </span>
                  <span className="mt-2 flex items-center gap-2.5">
                    <FoodImg src={o.items[0]?.img} emoji={o.items[0]?.emoji ?? o.merchantEmoji} className="h-11 w-11 shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-black/45">{o.items.length > 1 ? `${o.items[0]?.name} 等${o.items.reduce((s, i) => s + i.qty, 0)}件商品` : `共${o.items.reduce((s, i) => s + i.qty, 0)}件`}</span>
                    <span className="shrink-0 text-[14px] font-semibold text-black/85">¥{o.total.toFixed(2)}</span>
                  </span>
                  <span className="mt-1.5 block text-[11px] text-black/30">下单：{fmtDateTime(o.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 购物车底栏 */}
      {tab === '点菜' && (
        <div className="relative z-20 shrink-0 px-3 pb-3">
          {cartOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-2 rounded-2xl bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.12)]">
              <div className="flex items-center justify-between border-b border-black/5 px-4 py-2.5">
                <p className="text-[13px] font-semibold text-black/70">已选商品</p>
                <button type="button" onClick={clearCart} className="flex items-center gap-1 text-[12px] text-black/40">
                  <Trash2 className="h-3.5 w-3.5" /> 清空
                </button>
              </div>
              <div className="max-h-52 overflow-y-auto px-4 py-1">
                {cart.items.map((i) => {
                  const d = mtDishesOf(merchant).find((x) => x.id === i.dishId);
                  if (!d) return null;
                  return (
                    <div key={`${i.dishId}-${i.spec ?? ''}`} className="flex items-center gap-2.5 py-2.5">
                      <FoodImg src={d.img} emoji={d.emoji} className="h-10 w-10 shrink-0 rounded-lg" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-black/80">{d.name}</span>
                        {i.spec && <span className="block truncate text-[11px] text-black/40">{i.spec}</span>}
                      </span>
                      <span className="text-[14px] font-semibold" style={{ color: MT_PRICE }}>
                        ¥{fmtMoney((i.unitPrice ?? d.price) * i.qty)}
                      </span>
                      <Stepper qty={i.qty} onAdd={() => (d.specs?.length ? setSpecDish(d) : add(d))} onDec={() => dec(d)} />
                    </div>
                  );
                })}
                {cart.items.length === 0 && <p className="py-6 text-center text-[12px] text-black/30">购物车是空的</p>}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 rounded-full bg-[#2B2B33] py-2 pl-2 pr-2 shadow-lg">
            <button type="button" aria-label="购物车" onClick={() => setCartOpen((o) => !o)} className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#FFD100] active:opacity-85">
              <ShoppingCart className="h-5 w-5 text-black/80" />
              {calc.count > 0 && (
                <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#FF4B33] px-1 text-[10px] font-bold text-white">{calc.count}</span>
              )}
            </button>
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-bold text-white">
                ¥{fmtMoney(calc.itemTotal)}
                {calc.discount > 0 && <span className="ml-1.5 text-[11px] font-normal text-white/50">已优惠¥{fmtMoney(calc.discount)}</span>}
              </span>
              <span className="block text-[10px] text-white/45">{belowMin ? `还差 ¥${fmtMoney(merchant.minOrder - calc.itemTotal)} 起送` : '配送费 ¥' + fmtMoney(calc.deliveryFee) + (calc.itemTotal >= 45 ? '（已免）' : '')}</span>
            </span>
            <button
              type="button"
              disabled={belowMin || calc.count === 0}
              onClick={onCheckout}
              className={`h-11 shrink-0 rounded-full px-6 text-[15px] font-semibold ${belowMin || calc.count === 0 ? 'bg-white/15 text-white/40' : 'bg-[#FFD100] text-black/90 active:opacity-85'}`}
            >
              {belowMin && calc.count > 0 ? `¥${fmtMoney(merchant.minOrder)}起送` : '去结算'}
            </button>
          </div>
        </div>
      )}

      {/* 规格/小料选择弹窗（奶茶小料/食物配菜） */}
      <AnimatePresence>
        {specDish && (
          <DishSpecSheet
            key={`${specDish.id}-${cart.items.reduce((s, i) => s + (i.dishId === specDish.id ? i.qty : 0), 0)}`}
            dish={specDish}
            onClose={() => setSpecDish(null)}
            onConfirm={({ qty, spec, unitPrice }) => addWithSpec(specDish, qty, spec, unitPrice)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ================================ 地址选择弹层 ================================

function AddressPickerSheet({ uid, onClose, onPicked, onManage }: { uid: string; onClose: () => void; onPicked: (a: MtAddress) => void; onManage: () => void }) {
  const addrs = mtLoadAddresses(uid);
  const cur = mtCurAddrId(uid);
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/45" onClick={onClose}>
      <div className="max-h-[70%] overflow-y-auto rounded-t-2xl bg-white pb-6" onClick={(e) => e.stopPropagation()}>
        <p className="py-3.5 text-center text-[16px] font-semibold text-black/85">选择收货地址</p>
        <div className="px-4">
          {addrs.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                onPicked(a);
                onClose();
              }}
              className="flex w-full items-center gap-3 rounded-2xl p-3 text-left active:bg-black/[0.03]"
            >
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${a.id === cur ? 'bg-[#FFC300]' : 'border border-black/20'}`}>
                {a.id === cur && <Check className="h-3.5 w-3.5 text-black/80" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="rounded bg-[#FFF3B8] px-1 text-[10px] text-[#B77900]">{a.tag}</span>
                  <span className="text-[14px] font-medium text-black/85">{a.name}</span>
                  <span className="text-[12px] text-black/40">{a.phone}</span>
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-black/50">{a.text}</span>
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            onManage();
            onClose();
          }}
          className="mx-4 mt-2 flex h-11 items-center justify-center gap-1 rounded-full bg-[#F5F6F7] text-[14px] text-black/70 active:opacity-75"
        >
          <MapPin className="h-4 w-4" /> 管理收货地址
        </button>
      </div>
    </div>
  );
}

// ================================ 支付收银台（对齐真机截图：订单 / 倒计时 / 美团支付绿卡 / 其他支付方式 / 确认交易） ================================

/** 美团支付「工商银行储蓄卡」立减金额（最优惠） */
const ICBC_OFF = 2.28;

function PayPage({
  order,
  onClose,
  onPaid,
  onToast,
}: {
  order: MtOrder;
  onClose: () => void;
  onPaid: (o: MtOrder) => void;
  onToast: (m: string) => void;
}) {
  // 美团支付银行卡（bank=普通银行卡 / icbc=工商银行储蓄卡·最优惠）与 微信/QQ 渠道二选一
  const [selBank, setSelBank] = useState<'bank' | 'icbc' | null>(null);
  const [idp, setIdp] = useState<'wx' | 'qq' | null>(null);
  const [chans, setChans] = useState<MtPayChannel[] | null>(null);
  const [chanKey, setChanKey] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'processing' | 'fail'>('idle');
  const [err, setErr] = useState('');
  const [tried, setTried] = useState(0);
  const [, tick] = useState(0);

  // 待支付倒计时（30 分钟，对齐真机「交易剩余时间」）
  useEffect(() => {
    const iv = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  const leftMs = Math.max(0, order.createdAt + 30 * 60_000 - Date.now());
  const countdown = `${String(Math.floor(leftMs / 60000)).padStart(2, '0')}:${String(Math.floor((leftMs % 60000) / 1000)).padStart(2, '0')}`;

  // 选中工商银行储蓄卡 → 立减（其他方式原价）
  const payAmount = selBank === 'icbc' ? Math.max(0.01, Math.round((order.total - Math.min(ICBC_OFF, order.total)) * 100) / 100) : order.total;

  // 展开微信/QQ → 拉取渠道（余额/额度预检）；展开时自动选中首个可用渠道（对齐真机）
  useEffect(() => {
    if (!idp) {
      setChans(null);
      return;
    }
    let alive = true;
    setChans(null);
    mtListPayChannels(idp, order.total)
      .then((c) => {
        if (!alive) return;
        setChans(c);
        setChanKey((k) => (k && c.some((x) => x.key === k) ? k : (c.find((x) => !x.insufficient)?.key ?? null)));
      })
      .catch(() => alive && setChans([]));
    return () => {
      alive = false;
    };
  }, [idp, order.total]);

  const selBankRow = (v: 'bank' | 'icbc') => {
    if (state === 'processing') return;
    setSelBank((cur) => (cur === v ? null : v));
    setChanKey(null);
    setErr('');
    setState('idle');
  };

  const toggleIdp = (v: 'wx' | 'qq') => {
    if (state === 'processing') return;
    setErr('');
    setState('idle');
    setIdp((cur) => (cur === v ? null : v));
    setSelBank(null);
    setChanKey(null);
  };

  const chan = chans?.find((c) => c.key === chanKey) ?? null;
  const chanOfIdp = (v: 'wx' | 'qq') => (idp === v ? chan : null);

  const confirm = async () => {
    if (state === 'processing') return;
    if (selBank) {
      // 美团支付·银行卡（演示）：不扣微信/QQ钱包，原路信息记为美团支付
      setErr('');
      setState('processing');
      await new Promise((r) => setTimeout(r, 1100));
      const randomFail = tried === 0 && Math.random() < 0.12;
      setTried((t) => t + 1);
      if (randomFail) {
        setErr('网络异常，支付失败，请重试');
        setState('fail');
        return;
      }
      const off = selBank === 'icbc' ? Math.min(ICBC_OFF, order.total) : 0;
      const now = Date.now();
      const tuangouDone = order.kind === 'tuangou';
      const paid: MtOrder = {
        ...order,
        total: Math.max(0.01, Math.round((order.total - off) * 100) / 100),
        discount: Math.round((order.discount + off) * 100) / 100,
        status: tuangouDone ? 'completed' : 'pendingAccept',
        paidAt: now,
        ...(tuangouDone ? { consumedAt: now } : { etaAt: now + 45 * 60_000 }),
        payChannelLabel: selBank === 'icbc' ? `美团支付 · 工商银行储蓄卡（已立减${fmtMoney(off)}元）` : '美团支付 · 银行卡',
        statusLog: [...order.statusLog, { status: tuangouDone ? 'completed' : 'pendingAccept', at: now }],
      };
      mtSaveOrders(order.uid, mtLoadOrders(order.uid).map((o) => (o.id === order.id ? paid : o)));
      window.dispatchEvent(new CustomEvent('mt-orders-changed'));
      onToast(off > 0 ? `支付成功，已立减${fmtMoney(off)}元` : '支付成功');
      onPaid(paid);
      return;
    }
    if (chan) {
      setErr('');
      setState('processing');
      await new Promise((r) => setTimeout(r, 1100));
      const randomFail = tried === 0 && Math.random() < 0.12;
      setTried((t) => t + 1);
      const res = await mtExecutePay(chan.idp, chan, order.total, order.merchantName, randomFail);
      if (!res.ok) {
        setErr(res.error ?? '支付失败，请重试');
        setState('fail');
        return;
      }
      const now = Date.now();
      const tuangouDone = order.kind === 'tuangou';
      const paid: MtOrder = {
        ...order,
        status: tuangouDone ? 'completed' : 'pendingAccept',
        paidAt: now,
        ...(tuangouDone ? { consumedAt: now } : { etaAt: now + 45 * 60_000 }),
        payIdp: chan.idp,
        payChannelLabel: `${chan.idp === 'wx' ? '微信' : 'QQ'}${chan.isFc ? '亲属卡' : ''} · ${chan.label}`,
        payFc: chan.isFc === true,
        statusLog: [...order.statusLog, { status: tuangouDone ? 'completed' : 'pendingAccept', at: now }],
      };
      mtSaveOrders(order.uid, mtLoadOrders(order.uid).map((o) => (o.id === order.id ? paid : o)));
      window.dispatchEvent(new CustomEvent('mt-orders-changed'));
      if (res.fc) onToast(`已用${res.fc.parts[0]?.giverName ?? '亲属卡'}支付 ¥${fmtMoney(res.fc.total)}`);
      else onToast('支付成功');
      onPaid(paid);
      return;
    }
    onToast('请先选择支付方式');
  };

  const Radio = ({ on }: { on: boolean }) => (
    <span className={`grid h-[21px] w-[21px] shrink-0 place-items-center rounded-full ${on ? 'bg-[#FFC300]' : 'border-[1.5px] border-black/15'}`}>
      {on && <Check className="h-3.5 w-3.5 text-black/80" strokeWidth={3.2} />}
    </span>
  );

  const chanIcon = (c: MtPayChannel) => {
    if (c.isFc) return <Users className="h-[17px] w-[17px] text-[#FF6000]" strokeWidth={2} />;
    if (c.methodId === 'balance') return <Wallet className={`h-[17px] w-[17px] ${c.idp === 'wx' ? 'text-[#06C160]' : 'text-[#12B7F5]'}`} strokeWidth={2} />;
    return <CreditCard className="h-[17px] w-[17px] text-black/55" strokeWidth={2} />;
  };

  return (
    <motion.div className="absolute inset-0 z-50 flex flex-col bg-white" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 24, opacity: 0 }} transition={{ duration: 0.18 }}>
      {/* 顶栏：返回 + 居中「订单」 */}
      <div className="relative grid h-[100px] shrink-0 place-items-center border-b border-black/[0.04] pt-[50px]">
        <button type="button" aria-label="返回" onClick={onClose} className="absolute left-1 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[24px] w-[24px] text-black/85" strokeWidth={2.2} />
        </button>
        <p className="text-[20px] font-semibold text-black/90">订单</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 倒计时 + 金额 */}
        <p className="mt-3 text-center text-[15px] text-black/50">交易剩余时间 {countdown}</p>
        <p className="mt-1 text-center text-[42px] font-bold leading-tight tracking-tight text-black/90">
          <span className="text-[26px]">¥</span>
          {payAmount.toFixed(2)}
        </p>

        {/* 支付方式：美团支付（白底直排） */}
        <div className="mt-4 border-t-[7px] border-[#F5F6F7] px-4 pt-3">
          <div className="flex items-center gap-2 pb-1">
            <span className="grid h-[26px] w-[26px] place-items-center rounded-[8px] bg-gradient-to-br from-[#FFD100] to-[#FFB800] shadow-sm">
              <Zap className="h-[15px] w-[15px] fill-white text-white" strokeWidth={0} />
            </span>
            <span className="text-[17px] font-bold text-black/90">美团支付</span>
            <span className="ml-auto flex items-center gap-1 text-[12px] font-medium text-[#3D8B37]">
              美团账户安全保障中
              <Leaf className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
          </div>
          <div>
            <button type="button" onClick={() => selBankRow('bank')} className="flex w-full items-center gap-2 py-[15px] text-left active:opacity-80">
              <span className="flex-1 text-[15px] text-black/85">使用银行卡支付</span>
              <Radio on={selBank === 'bank'} />
            </button>
            <div className="border-t border-black/[0.05]" />
            <button type="button" onClick={() => selBankRow('icbc')} className="flex w-full items-center gap-2 py-[15px] text-left active:opacity-80">
              <span className="text-[15px] text-black/85">使用工商银行储蓄卡</span>
              <span className="shrink-0 rounded-[4px] bg-[#FF4B33] px-1 py-px text-[10px] font-semibold text-white">最优惠</span>
              <span className="ml-auto flex items-center gap-2">
                <span className="text-[15px] font-medium text-[#FF4B33]">- ¥ {fmtMoney(Math.min(ICBC_OFF, order.total))}</span>
                <Radio on={selBank === 'icbc'} />
              </span>
            </button>
            <div className="border-t border-black/[0.05]" />
            <button type="button" onClick={() => onToast('更多绑卡优惠即将上线，敬请期待')} className="flex w-full items-center gap-1 py-[13px] text-left active:opacity-70">
              <span className="text-[15px] text-black/50">查看更多绑卡优惠</span>
              <ChevronRight className="h-4 w-4 text-black/30" />
            </button>
          </div>
        </div>

        {/* 其他支付方式：微信 / QQ（点行展开渠道） */}
        <div className="border-t-[7px] border-[#F5F6F7] px-4 pt-3">
          <p className="pb-2 text-[15px] text-black/50">其他支付方式</p>
          {(
            [
              ['wx', '/icons/wechat.png', '微信支付'],
              ['qq', '/icons/qq.png', 'QQ支付'],
            ] as ['wx' | 'qq', string, string][]
          ).map(([v, img, name], i) => {
            const cur = chanOfIdp(v);
            return (
              <div key={v} className={i > 0 ? 'border-t border-black/[0.05]' : ''}>
                <button type="button" onClick={() => toggleIdp(v)} className="flex w-full items-center gap-3 py-[13px] text-left active:opacity-80">
                  <img src={img} alt="" className="h-[28px] w-[28px] shrink-0 rounded-[7px]" />
                  <span className="flex-1 text-[15px] font-medium text-black/85">{name}</span>
                  <Radio on={Boolean(cur)} />
                </button>
                {/* 展开的渠道列表（缩进，微信：零钱/银行卡/亲属卡；QQ：余额/银行卡） */}
                {idp === v && (
                  <div className="pb-1.5 pl-[40px]">
                    {chans === null ? (
                      <p className="py-3 text-[12px] text-black/35">正在获取支付渠道…</p>
                    ) : chans.length === 0 ? (
                      <p className="py-3 text-[12px] text-black/35">该支付方式暂无可用渠道，请更换</p>
                    ) : (
                      chans.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => {
                            if (c.insufficient) {
                              onToast(c.isFc ? '亲属卡本月额度不足，请切换其他支付方式' : '该渠道余额不足，请更换支付方式');
                              return;
                            }
                            setSelBank(null);
                            setChanKey(c.key);
                            setErr('');
                            setState('idle');
                          }}
                          className={`flex w-full items-center gap-2.5 border-t border-black/[0.04] py-2.5 text-left ${c.insufficient ? 'opacity-45' : 'active:opacity-70'}`}
                        >
                          <span className="grid h-[22px] w-[22px] shrink-0 place-items-center">{chanIcon(c)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] text-black/85">{c.label}</span>
                            <span className="block text-[10.5px] text-black/40">{c.sub}</span>
                          </span>
                          {c.insufficient ? (
                            <span className="shrink-0 text-[11px] text-[#FF4B33]">{c.isFc ? '额度不足' : '余额不足'}</span>
                          ) : (
                            <Radio on={chanKey === c.key} />
                          )}
                        </button>
                      ))
                    )}
                    {v === 'wx' && <p className="border-t border-black/[0.04] py-2 text-[10.5px] leading-relaxed text-black/30">使用亲属卡支付将由赠卡人买单，消费后赠卡人会收到通知</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="px-2 pb-1 pt-3.5 text-center text-[11px] leading-relaxed text-black/30">支付结果以商家订单为准 · 资金由微信支付/QQ钱包保障</p>
      </div>

      {/* 底部：立减横幅 + 确认交易 */}
      <div className="shrink-0 border-t border-black/[0.05] bg-white px-3.5 pb-[max(12px,env(safe-area-inset-bottom))] pt-1.5">
        <div className="mt-1 flex items-center gap-3 bg-[#FFF6D8] px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold text-black/85">
              使用工商银行储蓄卡立减 <span className="text-[#FF4B33]">2.28</span> 元
            </p>
            <p className="mt-0.5 text-[11px] text-black/40">美团支付限时专享福利</p>
          </div>
          <button type="button" onClick={() => onToast('已领取，支付时自动抵扣')} className="shrink-0 rounded-full bg-gradient-to-r from-[#FF5A3C] to-[#FF3B6B] px-4 py-2 text-[13px] font-semibold text-white active:opacity-85">
            去领取
          </button>
        </div>
        {state === 'fail' && <p className="mt-2 flex items-center justify-center gap-1 text-[12px] text-[#FF4B33]"><TriangleAlert className="h-3.5 w-3.5" />{err}</p>}
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={!selBank && !chan}
          className={`mt-2.5 h-[52px] w-full rounded-[26px] text-[17px] font-bold active:opacity-85 ${selBank || chan ? 'bg-[#FFD100] text-black/90 shadow-[0_4px_14px_rgba(255,190,0,0.35)]' : 'bg-[#F6EC9F] text-black/40'}`}
        >
          {state === 'processing' ? '正在支付…' : state === 'fail' ? '重新支付' : '确认交易'}
        </button>
      </div>
    </motion.div>
  );
}

// ================================ 外卖确认订单弹窗（截图7 弹窗式，非独立页面） ================================

function CheckoutSheet({
  session,
  merchant,
  onClose,
  onOpenPay,
  onPickAddress,
  onToast,
}: {
  session: MtSession;
  merchant: MtMerchant;
  onClose: () => void;
  onOpenPay: (o: MtOrder) => void;
  onPickAddress: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const addrs = mtLoadAddresses(uid);
  const [addrId, setAddrId] = useState(() => mtCurAddrId(uid) || addrs[0]?.id || '');
  const cur = addrs.find((a) => a.id === addrId) ?? addrs[0];
  const cart = mtLoadCart(uid);
  const calc = mtCheckoutCalc(uid, merchant, cart);
  const [note, setNote] = useState('');
  // 优惠券（外卖券，达门槛可用）
  const [selCoupon, setSelCoupon] = useState<MtCoupon | null>(null);
  const [couponPick, setCouponPick] = useState(false);
  const couponOff = selCoupon ? Math.min(selCoupon.amount, Math.max(0.01, calc.total - 0.01)) : 0;
  const payable = Math.max(0.01, Math.round((calc.total - couponOff) * 100) / 100);
  const usableCoupons = mtListUsableCoupons(uid, 'waimai', calc.itemTotal);

  const items = cart.items
    .map((i) => {
      const d = mtDishesOf(merchant).find((x) => x.id === i.dishId);
      return d ? { dish: d, qty: i.qty, spec: i.spec, unitPrice: i.unitPrice } : null;
    })
    .filter((x): x is { dish: MtDish; qty: number; spec: string | undefined; unitPrice: number | undefined } => x !== null);

  const submit = () => {
    if (items.length === 0) {
      onToast('购物车是空的');
      return;
    }
    if (!cur) {
      onToast('请先选择收货地址');
      return;
    }
    const now = Date.now();
    const order: MtOrder = {
      id: `mt${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      uid,
      merchantId: merchant.id,
      merchantName: merchant.name,
      merchantEmoji: merchant.emoji,
      merchantImg: merchant.cover,
      kind: 'waimai',
      items: items.map(({ dish, qty, spec, unitPrice }) => ({ dishId: dish.id, name: dish.name, price: unitPrice ?? dish.price, qty, emoji: dish.emoji, img: dish.img, spec })),
      itemTotal: calc.itemTotal,
      deliveryFee: calc.deliveryFee,
      discount: Math.round((calc.discount + couponOff) * 100) / 100,
      couponId: selCoupon?.id,
      couponAmount: couponOff > 0 ? couponOff : undefined,
      total: payable,
      note: note.trim() || undefined,
      address: cur,
      status: 'pendingPay',
      createdAt: now,
      statusLog: [{ status: 'pendingPay', at: now }],
    };
    if (selCoupon) mtUseCoupon(uid, selCoupon.id);
    const list = mtLoadOrders(uid);
    mtSaveOrders(uid, [order, ...list]);
    mtSaveCart(uid, { merchantId: null, items: [] });
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    onClose();
    onOpenPay(order);
  };

  return (
    <motion.div className="absolute inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      {/* 遮罩：点击弹窗外任意区域关闭 */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 top-[72px] flex flex-col overflow-hidden rounded-t-[20px] bg-white"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.34 }}
      >
        {/* 标题行（拖动指示 + 关闭） */}
        <div className="relative flex shrink-0 items-center bg-white px-3 pb-2.5 pt-3.5">
          <span className="absolute left-1/2 top-[7px] h-1 w-9 -translate-x-1/2 rounded-full bg-black/12" aria-hidden="true" />
          <span className="w-9" />
          <p className="flex-1 text-center text-[16px] font-semibold text-black/85">确认订单</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] active:bg-black/10">
            <X className="h-4 w-4 text-black/60" />
          </button>
        </div>

        {items.length === 0 ? (
          /* 空车守卫（订单已提交但关闭支付弹层后重开） */
          <div className="flex flex-1 flex-col items-center justify-center px-8">
            <p className="grid h-16 w-16 place-items-center rounded-full bg-black/[0.05]">
              <Receipt className="h-7 w-7 text-black/25" />
            </p>
            <p className="mt-3 text-center text-[14px] leading-relaxed text-black/50">
              购物车是空的
              <br />
              如有已提交未支付的订单，可在「订单」页继续支付
            </p>
            <button type="button" onClick={onClose} className="mt-5 rounded-full bg-[#FFD100] px-8 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
              返回商家
            </button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* 地址 */}
              <button type="button" onClick={onPickAddress} className="w-full px-4 py-4 text-left active:bg-black/[0.02]">
                <span className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#FF6000]" />
                  <span className="min-w-0 flex-1">
                    {cur ? (
                      <>
                        <span className="flex items-center gap-2">
                          <span className="text-[15px] font-semibold text-black/85">{cur.name} {cur.phone}</span>
                          <span className="rounded bg-[#FFF3B8] px-1 text-[10px] text-[#B77900]">{cur.tag}</span>
                        </span>
                        <span className="mt-0.5 block text-[12px] text-black/50">{cur.text}</span>
                      </>
                    ) : (
                      <span className="text-[14px] text-black/50">请选择收货地址</span>
                    )}
                  </span>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-black/25" />
                </span>
                <span className="mt-2 flex items-center gap-1.5 border-t border-black/5 pt-2 text-[11px] text-black/40">
                  <ClockIcon className="h-3.5 w-3.5" /> 立即配送 · 预计 {merchant.deliveryMin} 分钟送达
                </span>
              </button>

              {/* 商品 */}
              <div className="border-t border-black/5 px-4 py-3.5">
                <p className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                  <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md">
                    <FoodImg src={merchant.cover} emoji={merchant.emoji} className="h-full w-full" />
                  </span>
                  {merchant.name}
                </p>
                <div className="mt-2.5 space-y-2.5">
                  {items.map(({ dish, qty, spec, unitPrice }) => (
                    <div key={`${dish.id}-${spec ?? ''}`} className="flex items-center gap-2.5">
                      <FoodImg src={dish.img} emoji={dish.emoji} className="h-10 w-10 shrink-0 rounded-lg" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-black/75">{dish.name}</span>
                        {spec && <span className="block truncate text-[11px] text-black/40">{spec}</span>}
                      </span>
                      <span className="text-[12px] text-black/40">×{qty}</span>
                      <span className="w-14 text-right text-[13px] text-black/80">¥{fmtMoney((unitPrice ?? dish.price) * qty)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1.5 border-t border-black/5 pt-2.5 text-[12px]">
                  <p className="flex justify-between text-black/55">
                    <span>商品总价</span>
                    <span>¥{fmtMoney(calc.itemTotal)}</span>
                  </p>
                  <p className="flex justify-between text-black/55">
                    <span>配送费{calc.itemTotal >= 45 && <span className="ml-1 text-[#00A661]">（满45已免）</span>}</span>
                    <span>¥{fmtMoney(calc.deliveryFee)}</span>
                  </p>
                  <button type="button" onClick={() => setCouponPick(true)} className="flex w-full justify-between text-black/55 active:opacity-70">
                    <span>优惠券</span>
                    <span className={`flex items-center gap-0.5 ${selCoupon || couponOff > 0 ? 'font-medium text-[#FF4B33]' : 'text-black/40'}`}>
                      {selCoupon ? `-¥${fmtMoney(couponOff)}` : usableCoupons.usable.length > 0 ? `${usableCoupons.usable.length}张可用` : '暂无可用'}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </button>
                  {calc.discount > 0 && (
                    <p className="flex justify-between text-[#FF4B33]">
                      <span>满减优惠{calc.labels.length > 0 && `（${calc.labels.join('、')}）`}</span>
                      <span>-¥{fmtMoney(calc.discount)}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* 备注 */}
              <div className="border-t border-black/5 px-4 py-3.5">
                <p className="text-[13px] font-semibold text-black/75">订单备注</p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 50))}
                  rows={2}
                  placeholder="口味偏好、放门口等（选填）"
                  className="mt-2 w-full resize-none rounded-xl bg-[#F5F6F7] p-2.5 text-[13px] outline-none placeholder:text-black/25"
                />
              </div>
            </div>

            {/* 底栏 */}
            <div className="shrink-0 border-t border-black/5 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="text-[13px] text-black/45">合计 </span>
                  <span className="text-[20px] font-bold" style={{ color: MT_PRICE }}>
                    ¥{payable.toFixed(2)}
                  </span>
                  {calc.discount + couponOff > 0 && <span className="ml-1 text-[11px] text-black/35">已优惠¥{fmtMoney(calc.discount + couponOff)}</span>}
                </span>
                <button type="button" onClick={submit} className="h-12 rounded-full bg-[#FFD100] px-8 text-[16px] font-semibold text-black/90 shadow active:opacity-85">
                  提交订单
                </button>
              </div>
            </div>
          </>
        )}

        {/* 优惠券选择弹层 */}
        <AnimatePresence>
          {couponPick && (
            <CouponPickerSheet
              key="mt-coupon-pick"
              uid={uid}
              type="waimai"
              itemTotal={calc.itemTotal}
              selId={selCoupon?.id ?? null}
              onClose={() => setCouponPick(false)}
              onPick={(c) => {
                setSelCoupon(c);
                setCouponPick(false);
              }}
              onToast={onToast}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

// ================================ 订单列表页（截图5） ================================

const ORDER_TABS: { key: string; match: (o: MtOrder) => boolean }[] = [
  { key: '全部', match: () => true },
  { key: '待付款', match: (o) => o.status === 'pendingPay' },
  { key: '待收货/待使用', match: (o) => o.status === 'pendingAccept' || o.status === 'accepted' || o.status === 'delivering' },
  { key: '评价', match: (o) => o.status === 'completed' },
  // 退款/售后：只显示买了以后退款的（有退款记录的已支付订单；未支付就取消的不算售后）
  { key: '退款/售后', match: (o) => !!o.refund },
];

function OrdersPage({
  session,
  tab,
  setTab,
  onOpenOrder,
  onOpenDeal,
  onOpenRefund,
  onGoHome,
  onToast,
}: {
  session: MtSession;
  tab: string;
  setTab: (t: string) => void;
  onOpenOrder: (id: string) => void;
  onOpenDeal: (id: string) => void;
  onOpenRefund: (id: string) => void;
  onGoHome: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  useOrdersTick();
  const orders = mtLoadOrders(uid);
  const cur = ORDER_TABS.find((t) => t.key === tab) ?? ORDER_TABS[0];
  const list = orders.filter((o) => cur.match(o));

  const cancelOrder = (o: MtOrder) => {
    // 取消订单自动退款：退款/售后列表出现「退款成功」记录（对齐真机）
    mtCancelWithRefund(uid, o.id, '用户主动取消');
    onToast('订单已取消，款项将自动退回');
  };

  const reorder = (o: MtOrder) => {
    if (o.kind === 'tuangou') {
      const deal = MT_DEALS.find((d) => d.id === o.items[0]?.dishId);
      if (deal) {
        onOpenDeal(deal.id);
        return;
      }
    }
    if (mtReorder(uid, o)) onGoHome();
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 返回 + 搜索 + 筛选 + 发票（独立页：无底部 tab，顶部返回键回首页） */}
      <div className="shrink-0 border-b border-black/[0.04] bg-white px-3 pb-1 pt-[54px]">
        <div className="flex items-center gap-2.5">
          <button type="button" aria-label="返回" onClick={onGoHome} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <button type="button" onClick={() => onToast('订单搜索（演示）')} className="flex h-[38px] min-w-0 flex-1 items-center gap-2 rounded-full bg-white px-3.5 text-left shadow-sm active:opacity-80">
            <SearchIcon className="h-4 w-4 shrink-0 text-black/35" />
            <span className="truncate text-[14px] text-black/30">搜索我的订单</span>
          </button>
          <button type="button" onClick={() => onToast('筛选（演示）')} className="flex w-[44px] shrink-0 flex-col items-center gap-0.5 text-black/70 active:opacity-60">
            <Filter className="h-[19px] w-[19px]" strokeWidth={1.8} />
            <span className="text-[10px]">筛选</span>
          </button>
          <button type="button" onClick={() => onToast('开发票（演示）')} className="flex w-[44px] shrink-0 flex-col items-center gap-0.5 text-black/70 active:opacity-60">
            <FileText className="h-[19px] w-[19px]" strokeWidth={1.8} />
            <span className="text-[10px]">发票</span>
          </button>
        </div>
        {/* 页签 */}
        <div className="mt-2.5 flex gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ORDER_TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`relative shrink-0 pb-2.5 text-[16px] ${tab === t.key ? 'font-bold text-black/90' : 'text-black/55'}`}>
              {t.key}
              {tab === t.key && <span className="absolute inset-x-0 bottom-[6px] mx-auto h-[3px] w-7 rounded-full bg-[#FF6000]" />}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
        {list.length === 0 && (
          <div className="mt-24 text-center">
            <p className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-black/[0.05]">
              <ShoppingBag className="h-7 w-7 text-black/25" strokeWidth={1.8} />
            </p>
            <p className="mt-3 text-[13px] text-black/40">还没有相关订单，去下一单吧</p>
            <button type="button" onClick={onGoHome} className="mt-4 rounded-full bg-[#FFD100] px-6 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
              去逛逛
            </button>
          </div>
        )}
        <div>
          {list.map((o) => {
            const tuangou = o.kind === 'tuangou';
            const qtyTotal = o.items.reduce((s, i) => s + i.qty, 0);
            // 退款/售后页签：对齐真机专项卡（橙色圆标↓ + 商家名 + 右侧退款状态 + 总价行 + 退款进度橙钮）
            // 页签只显示买了以后退款的订单（均有退款记录）
            if (tab === '退款/售后') {
              const rs = o.refund!.status;
              const statusText = rs === 'pending' ? '退款中' : rs === 'failed' ? '退款失败' : '退款成功';
              const statusTone = rs === 'approved' ? 'text-black/45' : 'text-[#FF6000]';
              return (
                <div key={o.id} className="border-t-[7px] border-[#F5F6F7] px-4 py-3.5 first:border-t-0">
                  <button
                    type="button"
                    onClick={() => onOpenRefund(o.id)}
                    className="w-full text-left active:opacity-80"
                  >
                    <span className="flex items-center gap-2">
                      <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FF8A21] to-[#FF6000]">
                        <ArrowDown className="h-3.5 w-3.5 text-white" strokeWidth={2.6} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[16px] font-bold text-black/90">{o.merchantName.split('（')[0]}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-black/30" />
                      <span className={`shrink-0 text-[14px] ${statusTone}`}>{statusText}</span>
                    </span>
                    <span className="mt-3 flex items-center gap-3">
                      <FoodImg src={o.items[0]?.img} emoji={o.items[0]?.emoji ?? o.merchantEmoji} className="h-[72px] w-[72px] shrink-0 rounded-xl" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[17px] font-bold text-black/90">总价：¥{o.total.toFixed(2)}</span>
                        <span className="mt-1 block truncate text-[13px] text-black/40">
                          {tuangou ? `有效期至 ${fmtDate(o.createdAt + 90 * 86400_000)} 23:59` : `下单：${fmtDate(o.createdAt)}`}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-black/35">{o.refund!.reason}</span>
                      </span>
                    </span>
                  </button>
                  <div className="mt-3 flex items-center justify-end border-t border-black/[0.05] pt-2.5">
                    <button
                      type="button"
                      onClick={() => onOpenRefund(o.id)}
                      className="rounded-full bg-gradient-to-r from-[#FF8A21] to-[#FF6000] px-5 py-2 text-[13px] font-medium text-white active:opacity-85"
                    >
                      退款进度
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div key={o.id} className="border-t-[7px] border-[#F5F6F7] px-4 py-3.5 first:border-t-0">
                <button type="button" onClick={() => onOpenOrder(o.id)} className="w-full text-left">
                  <span className="flex items-center gap-1.5">
                    <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[#FFF3DC]">
                      <Utensils className="h-3 w-3 text-[#FF8A00]" strokeWidth={2.4} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[16px] font-bold text-black/90">{o.merchantName.split('（')[0]}</span>
                    {tuangou && <span className="shrink-0 rounded-[3px] border border-black/15 px-1 py-px text-[10px] text-black/45">多店可用</span>}
                    <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
                    <span className={`ml-1 shrink-0 text-[13px] ${['pendingPay', 'pendingAccept', 'accepted', 'delivering'].includes(o.status) ? 'font-medium text-[#FF6000]' : 'text-[#9A9A9A]'}`}>
                      {mtStatusText(o)}
                    </span>
                    {o.refund && (
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${
                          o.refund.status === 'pending' ? 'bg-[#FFF0EB] text-[#FF6000]' : o.refund.status === 'failed' ? 'bg-[#FDECEC] text-[#F53F3F]' : 'bg-[#F5F6F7] text-black/45'
                        }`}
                      >
                        {o.refund.status === 'pending' ? '退款中' : o.refund.status === 'failed' ? '退款失败' : '已退款'}
                      </span>
                    )}
                  </span>
                  <span className="mt-2.5 flex items-center gap-2.5">
                    <FoodImg src={o.items[0]?.img} emoji={o.items[0]?.emoji ?? o.merchantEmoji} className="h-[64px] w-[64px] shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-black/85">{o.items[0]?.name}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-black/45">
                        {o.status === 'completed' && o.consumedAt ? `消费时间: ${fmtDate(o.consumedAt)}` : o.status === 'canceled' ? `下单: ${fmtDate(o.createdAt)}` : `下单: ${fmtDate(o.createdAt)}`}
                      </span>
                      {tuangou && (
                        <span className="mt-1 flex gap-1">
                          <span className="rounded-[3px] border border-black/15 px-1 py-px text-[10px] text-black/45">免预约</span>
                          <span className="rounded-[3px] border border-black/15 px-1 py-px text-[10px] text-black/45">{o.items[0]?.name.includes('早餐') ? '限早餐时段' : '周一至周日可用'}</span>
                        </span>
                      )}
                      {!tuangou && <span className="mt-0.5 block text-[12px] text-black/40">{o.items.length > 1 ? `等${qtyTotal}件商品` : `共${qtyTotal}件`}</span>}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[16px] font-semibold text-black/90">¥{o.total.toFixed(2)}</span>
                      {tuangou && qtyTotal > 1 && <span className="block text-[11px] text-black/40">共{qtyTotal}张</span>}
                    </span>
                  </span>
                </button>
                <div className="mt-3 flex items-center justify-end gap-2 border-t border-black/[0.06] pt-2.5">
                  <button type="button" onClick={() => onToast('更多操作（演示）')} className="mr-auto text-[13px] text-black/45 active:opacity-60">
                    更多
                  </button>
                  {o.refund && (
                    <button type="button" onClick={() => onOpenRefund(o.id)} className="rounded-full border border-black/15 px-4 py-1.5 text-[12px] text-black/60 active:bg-black/5">
                      售后详情
                    </button>
                  )}
                  {o.status === 'pendingPay' && (
                    <>
                      <button type="button" onClick={() => cancelOrder(o)} className="rounded-full border border-black/15 px-4 py-1.5 text-[12px] text-black/60 active:bg-black/5">
                        取消订单
                      </button>
                      <button type="button" onClick={() => onOpenOrder(o.id)} className="rounded-full bg-[#FFD100] px-4 py-1.5 text-[12px] font-semibold text-black/90 active:opacity-85">
                        去支付
                      </button>
                    </>
                  )}
                  {(o.status === 'pendingAccept' || o.status === 'accepted' || o.status === 'delivering') && (
                    <button type="button" onClick={() => onOpenOrder(o.id)} className="rounded-full bg-[#FFD100] px-4 py-1.5 text-[12px] font-semibold text-black/90 active:opacity-85">
                      查看进度
                    </button>
                  )}
                  {(o.status === 'completed' || o.status === 'canceled') && (
                    <>
                      <button type="button" onClick={() => onToast('已领取神券（演示）')} className="rounded-full border border-black/15 px-4 py-1.5 text-[12px] text-black/60 active:bg-black/5">
                        领神券
                      </button>
                      <button type="button" onClick={() => reorder(o)} className="rounded-full border border-[#FF6000] px-4 py-1.5 text-[12px] font-medium text-[#FF6000] active:opacity-75">
                        再来一单
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ================================ 订单详情页（截图8/9/10） ================================

/** 配送小地图（CSS 假地图：路网 + 商家/家 pin + 骑手巡航 + 撒漏必赔胶囊） */
function DeliveryMap({ merchantName }: { merchantName: string }) {
  return (
    <div className="relative h-52 overflow-hidden rounded-2xl bg-[#EAF0E4]">
      <div className="absolute left-0 right-0 top-[38%] h-[7px] -rotate-3 bg-white/85" />
      <div className="absolute bottom-0 left-[30%] top-0 w-[6px] rotate-6 bg-white/85" />
      <div className="absolute left-[-8%] right-[20%] top-[68%] h-[5px] rotate-6 bg-white/70" />
      <div className="absolute left-[62%] bottom-[-6%] top-[16%] w-[5px] -rotate-12 bg-white/70" />
      <TreePine className="absolute left-[14%] top-[16%] h-4 w-4 text-[#7BAE6B]" strokeWidth={2} />
      <Building className="absolute bottom-[18%] right-[28%] h-4 w-4 text-black/30" strokeWidth={2} />
      <TreePine className="absolute right-[10%] top-[22%] h-4 w-4 text-[#7BAE6B]" strokeWidth={2} />
      <span className="absolute left-[38%] top-[64%] text-[12px] text-black/35">河北大道</span>
      {/* 骑手气泡 */}
      <span className="absolute left-[16%] top-[24%] rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-medium text-black/80 shadow-md">
        前方剩余<span className="text-[#FF6000]">2单</span>·9分钟
      </span>
      {/* 商家 pin */}
      <span className="absolute left-[12%] top-[62%] grid h-8 w-8 place-items-center rounded-full bg-white shadow-md ring-1 ring-black/5" title={merchantName}>
        <Store className="h-4 w-4 text-[#FF8A00]" strokeWidth={2.2} />
      </span>
      {/* 家 pin */}
      <span className="absolute bottom-[12%] right-[10%] grid h-9 w-9 place-items-center rounded-xl bg-white shadow-md ring-1 ring-black/5">
        <HomeIcon className="h-4.5 w-4.5 text-[#FFB300]" strokeWidth={2.2} />
      </span>
      {/* 骑手 */}
      <span className="mt-rider absolute grid h-9 w-9 place-items-center rounded-full bg-[#FFD100] shadow-lg ring-2 ring-white">
        <Bike className="h-4.5 w-4.5 text-black/80" strokeWidth={2.2} />
      </span>
      <span className="absolute right-3 top-3 rounded-[4px] bg-[#FFD100] px-1.5 py-0.5 text-[10px] font-medium text-black/80">美团专送</span>
      {/* 放心吃 */}
      <span className="absolute bottom-2.5 left-2.5 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[10px] text-black/70 shadow-sm">
        <CircleCheck className="h-3 w-3 text-[#FF6000]" />
        放心吃：撒漏必赔 · 食品安全保障中
      </span>
    </div>
  );
}

/** 信息行（订单信息卡） */
function InfoRow({ k, v, action }: { k: string; v: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-[7px]">
      <span className="w-[60px] shrink-0 text-[13px] leading-[1.5] text-black/35">{k}</span>
      <span className="min-w-0 flex-1 break-all text-[13px] leading-[1.5] text-black/80">{v}</span>
      {action}
    </div>
  );
}

function OrderDetailPage({
  session,
  orderId,
  onBack,
  onOpenPay,
  onGoOrders,
  onOpenDeal,
  onPickAddress,
  onApplyRefund,
  onOpenRefund,
  onToast,
}: {
  session: MtSession;
  orderId: string;
  onBack: () => void;
  onOpenPay: (o: MtOrder) => void;
  onGoOrders: () => void;
  onOpenDeal: (id: string) => void;
  onPickAddress: () => void;
  onApplyRefund: (o: MtOrder) => void;
  onOpenRefund: (o: MtOrder) => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  useOrdersTick();
  const [, forceTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  const order = mtGetOrder(uid, orderId);
  if (!order) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#F0F3F5]">
        <p className="text-[13px] text-black/40">订单不存在</p>
        <button type="button" onClick={onGoOrders} className="mt-3 rounded-full bg-[#FFD100] px-5 py-2 text-[13px] font-medium text-black/85">
          返回订单列表
        </button>
      </div>
    );
  }

  const tuangou = order.kind === 'tuangou';

  const steps: { key: string; icon: 'pay' | 'store' | 'bike' | 'home'; at?: number }[] = [
    { key: '已支付', icon: 'pay', at: order.paidAt },
    { key: '商家接单', icon: 'store', at: order.statusLog.find((s) => s.status === 'accepted')?.at },
    { key: '骑手取餐', icon: 'bike', at: order.statusLog.find((s) => s.status === 'delivering')?.at },
    { key: '已送达', icon: 'home', at: order.statusLog.find((s) => s.status === 'completed')?.at },
  ];
  const doneIdx = steps.reduce((acc, s, i) => (s.at ? i : acc), -1);

  const cancel = () => {
    if (order.status === 'pendingAccept') {
      // 已支付单取消 → 自动原路退款（退款/售后可查）
      mtCancelWithRefund(uid, order.id, '用户取消，支付金额将原路退回');
      onToast('订单已取消，款项将自动退回');
      return;
    }
    const list = mtLoadOrders(uid).map((x) =>
      x.id === order.id ? { ...x, status: 'canceled' as const, cancelReason: '用户主动取消', statusLog: [...x.statusLog, { status: 'canceled' as const, at: Date.now() }] } : x
    );
    mtSaveOrders(uid, list);
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    onToast('订单已取消');
  };

  const copy = (text: string) => {
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      /* 忽略 */
    }
    onToast('已复制');
  };

  const countdown = (() => {
    if (order.status !== 'pendingPay') return null;
    const left = Math.max(0, order.createdAt + 30 * 60_000 - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  })();

  const reorder = () => {
    if (tuangou) {
      const deal = MT_DEALS.find((d) => d.id === order.items[0]?.dishId);
      if (deal) {
        onOpenDeal(deal.id);
        return;
      }
    }
    if (mtReorder(uid, order)) onToast('已加入购物车');
  };

  // 详情头文案
  const hero: { big: string; sub: string; icon?: boolean; tag?: string } = (() => {
    if (order.status === 'pendingPay') return { big: `待付款，还剩 ${countdown ?? '30:00'}`, sub: '超时未支付订单将自动取消', icon: true };
    if (order.status === 'pendingAccept') return { big: order.etaAt ? fmtTime(order.etaAt) : '--:--', sub: '等待商家接单', tag: '预计送达' };
    if (order.status === 'accepted') return { big: order.etaAt ? fmtTime(order.etaAt) : '--:--', sub: '商家正在准备餐品', tag: '预计送达' };
    if (order.status === 'delivering') return { big: order.etaAt ? fmtTime(order.etaAt) : '--:--', sub: `骑手${order.riderName ?? ''}正在送货`, tag: '预计送达' };
    if (order.status === 'completed') return { big: '订单已完成', sub: '感谢您的信任，欢迎评价' };
    return { big: '订单已取消', sub: order.cancelReason ?? '订单已取消' };
  })();

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 顶栏：返回 + 金币/分享/客服/刷新 */}
      <div className="shrink-0 border-b border-black/[0.04] bg-white px-3 pb-2 pt-[54px]">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <span className="flex-1" />
          <button type="button" aria-label="美团币" onClick={() => onToast('下单返美团币（演示）')} className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-b from-[#FFD76E] to-[#FFB800] text-[10px] font-bold text-[#8A5B00] shadow-sm">
            30
          </button>
          <button type="button" aria-label="分享" onClick={() => onToast('分享（演示）')} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <Share2 className="h-[19px] w-[19px] text-black/70" strokeWidth={1.8} />
          </button>
          <button type="button" aria-label="客服" onClick={() => onToast('美团客服：0539-000-0000（演示）')} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <Headset className="h-[19px] w-[19px] text-black/70" strokeWidth={1.8} />
          </button>
          <button type="button" aria-label="刷新" onClick={() => forceTick((t) => t + 1)} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <RotateCw className="h-[18px] w-[18px] text-black/70" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 状态 hero */}
        <div className="bg-white px-5 pb-4 pt-1">
          <p className="flex items-center gap-2 text-[24px] font-bold leading-tight text-black/90">
            {hero.icon && <ClockIcon className="h-6 w-6 text-black/75" strokeWidth={2} />}
            {hero.big}
            {hero.tag && <span className="text-[13px] font-normal text-black/45">{hero.tag}</span>}
          </p>
          <p className="mt-1 text-[15px] font-semibold text-black/80">{hero.sub}</p>

          {/* 四节点进度（仅外卖） */}
          {!tuangou && order.status !== 'pendingPay' && order.status !== 'canceled' && (
            <div className="mt-4 px-1">
              <div className="flex items-center">
                {steps.map((s, i) => (
                  <div key={s.key} className="flex flex-1 items-center last:flex-none">
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${i <= doneIdx ? 'bg-[#FFD100] text-black/85 shadow-sm' : 'bg-[#E8EAED] text-white'}`}
                    >
                      {s.icon === 'pay' && <span className="text-[13px] font-bold">¥</span>}
                      {s.icon === 'store' && <Store className="h-4 w-4" strokeWidth={2.2} />}
                      {s.icon === 'bike' && <Bike className="h-4 w-4" strokeWidth={2.4} />}
                      {s.icon === 'home' && <Check className="h-4 w-4" strokeWidth={3} />}
                    </span>
                    {i < steps.length - 1 && <span className={`mx-0.5 h-[5px] flex-1 rounded-full ${i < doneIdx ? 'bg-[#FFD100]' : 'bg-[#E8EAED]'}`} />}
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-black/45">
                {steps.map((s) => (
                  <span key={s.key} className="w-8 text-center first:text-left last:text-right">{s.key}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 配送地图 */}
        {order.status === 'delivering' && (
          <div className="mt-3 border-y-[7px] border-[#F5F6F7]">
            <DeliveryMap merchantName={order.merchantName} />
          </div>
        )}

        {/* 退款/售后进度卡（点击进「售后详情」，截图2） */}
        {order.refund && (
          <div className="border-t-[7px] border-[#F5F6F7] px-4 py-4">
            <button type="button" onClick={() => onOpenRefund(order)} className="flex w-full items-center gap-2.5 text-left active:opacity-75">
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                  order.refund.status === 'pending' ? 'bg-[#FFF0EB]' : order.refund.status === 'failed' ? 'bg-[#FDECEC]' : 'bg-[#E8F9EF]'
                }`}
              >
                <Undo2
                  className={`h-[18px] w-[18px] ${order.refund.status === 'pending' ? 'text-[#FF6000]' : order.refund.status === 'failed' ? 'text-[#F53F3F]' : 'text-[#00A661]'}`}
                  strokeWidth={2}
                />
              </span>
              <p className="min-w-0 flex-1 text-[15px] font-bold text-black/85">
                {order.refund.status === 'pending' ? '退款审核中' : order.refund.status === 'failed' ? '退款失败' : '已退款'}
              </p>
              <span className="shrink-0 text-[16px] font-bold" style={{ color: MT_PRICE }}>
                ¥{fmtMoney(order.refund.amount)}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
            </button>
            <div className="mt-1.5">
              <InfoRow k="退款原因" v={order.refund.reason} />
              {order.refund.note && <InfoRow k="补充说明" v={order.refund.note} />}
              {order.refund.status === 'failed' && order.refund.failMsg && <InfoRow k="失败原因" v={order.refund.failMsg} />}
              <InfoRow k="退款方式" v={`原路退回 · ${order.refund.channel ?? (order.payIdp === 'qq' ? 'QQ钱包' : '微信支付')}`} />
              <InfoRow k="申请时间" v={fmtDateTime(order.refund.appliedAt)} />
              {order.refund.doneAt && order.refund.status !== 'failed' && <InfoRow k="退款时间" v={fmtDateTime(order.refund.doneAt)} />}
            </div>
            <button type="button" onClick={() => onOpenRefund(order)} className="mt-2 flex w-full items-center justify-between rounded-xl bg-[#F7F8FA] px-3 py-2.5 active:opacity-75">
              <span className="text-[12px] text-black/55">
                {order.refund.status === 'pending'
                  ? '商家审核中，退款将原路退回您的支付账户'
                  : order.refund.status === 'failed'
                    ? '退款失败，点击查看详情并重新发起'
                    : '退款已原路退回，查看售后详情'}
              </span>
              <span className="flex items-center text-[12px] font-medium text-black/75">
                售后详情
                <ChevronRight className="h-3.5 w-3.5 text-black/35" />
              </span>
            </button>
          </div>
        )}

        {/* 操作按钮 */}
        {(order.status === 'accepted' || order.status === 'delivering') && (
          <div className="flex gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {['更多', '申请售后', '催一下', '联系商家', '联系骑手'].map((t, i) => (
              <button
                key={t}
                type="button"
                onClick={() => onToast(t === '催一下' ? '已提醒商家尽快出餐' : t === '申请售后' ? '售后申请已提交（演示）' : '已发起联系（演示）')}
                className={`flex-1 whitespace-nowrap rounded-full bg-white py-2.5 text-[12px] text-black/70 shadow-sm active:bg-black/5 ${i === 4 ? 'border border-[#FFD100] font-medium text-[#B77900]' : ''}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* 待支付使用限制 */}
        {order.status === 'pendingPay' && (
          <div className="border-t-[7px] border-[#F5F6F7] px-4 py-3.5">
            <p className="text-[13px] font-medium leading-relaxed text-[#FF6000]">【使用限制】该订单为特惠订单，请在30分钟内完成支付，超时未支付将自动取消</p>
          </div>
        )}

        {/* 订单信息 */}
        <div className="border-t-[7px] border-[#F5F6F7] px-4 py-4">
          <p className="text-[16px] font-bold text-black/85">订单信息</p>
          <div className="mt-1.5">
            {tuangou ? (
              <>
                <InfoRow k="期望时间" v="免预约 · 随时可用" />
                <InfoRow k="适用门店" v={`${order.merchantName}（门店通用）`} />
                <InfoRow k="使用规则" v="随时退 · 过期自动退" />
                <InfoRow k="订单号码" v={order.id} action={<CopyBtn onClick={() => copy(order.id)} />} />
                <InfoRow k="下单时间" v={fmtDateTime(order.createdAt)} />
                <InfoRow k="支付方式" v={order.paidAt ? (order.payChannelLabel ?? (order.payIdp === 'wx' ? '微信支付' : order.payIdp === 'qq' ? 'QQ支付' : '美团支付')) : '在线支付（未支付）'} />
                {order.consumedAt && <InfoRow k="消费时间" v={fmtDateTime(order.consumedAt)} />}
              </>
            ) : (
              <>
                <InfoRow k="期望时间" v="立即配送" />
                <InfoRow
                  k="配送地址"
                  v={order.address ? `${order.address.text}（${order.address.name} ${order.address.phone}）` : '—'}
                  action={order.status === 'pendingPay' ? <SmallPill onClick={onPickAddress}>修改</SmallPill> : undefined}
                />
                <InfoRow k="餐具数量" v="2份" />
                {order.paidAt && <InfoRow k="配送服务" v="美团专送" action={<ChevronRight className="mt-1 h-4 w-4 shrink-0 text-black/25" />} />}
                {(order.status === 'accepted' || order.status === 'delivering') && (
                  <InfoRow
                    k="配送骑手"
                    v={order.riderName ?? '待分配'}
                    action={<SmallPill onClick={() => onToast('打赏/查看骑手（演示）')}>打赏/查看骑手</SmallPill>}
                  />
                )}
                {order.paidAt && <InfoRow k="号码保护" v="保护隐私，服务护航" action={<ChevronRight className="mt-1 h-4 w-4 shrink-0 text-black/25" />} />}
                {order.paidAt && <InfoRow k="录音保护" v="交餐录音，保护安全" action={<ChevronRight className="mt-1 h-4 w-4 shrink-0 text-black/25" />} />}
                <InfoRow k="订单号码" v={order.id} action={<CopyBtn onClick={() => copy(order.id)} />} />
                <InfoRow k="下单时间" v={fmtDateTime(order.createdAt)} />
                <InfoRow k="支付方式" v={order.paidAt ? (order.payChannelLabel ?? (order.payIdp === 'wx' ? '微信支付' : order.payIdp === 'qq' ? 'QQ支付' : '美团支付')) : '在线支付（未支付）'} />
              </>
            )}
          </div>
        </div>

        {/* 商品费用 */}
        <div className="border-t-[7px] border-[#F5F6F7] px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md">
              <FoodImg src={order.merchantImg} emoji={order.merchantEmoji} className="h-full w-full" />
            </span>
            <p className="min-w-0 flex-1 truncate text-[16px] font-bold text-black/85">{order.merchantName}</p>
            <button type="button" onClick={() => onToast('已加入商家粉丝群（演示）')} className="shrink-0 text-[12px] font-medium text-[#FF6000]">
              进商家粉丝群 &gt;
            </button>
          </div>
          <div className="mt-2.5 space-y-2">
            {order.items.map((i) => (
              <div key={`${i.dishId}-${i.spec ?? ''}`} className="flex items-center gap-2.5">
                <FoodImg src={i.img} emoji={i.emoji} className="h-11 w-11 shrink-0 rounded-lg" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-black/75">{i.name}</span>
                  {i.spec && <span className="block truncate text-[11px] text-black/40">{i.spec}</span>}
                </span>
                <span className="text-[12px] text-black/35">×{i.qty}</span>
                <span className="w-14 text-right text-[13px] text-black/80">¥{fmtMoney(i.price * i.qty)}</span>
              </div>
            ))}
          </div>
          {order.note && <p className="mt-2.5 rounded-lg bg-[#F5F6F7] p-2 text-[11px] text-black/50">备注：{order.note}</p>}
          <div className="mt-3 space-y-1.5 border-t border-black/5 pt-2.5 text-[13px]">
            <p className="flex justify-between text-black/55">
              <span>商品总价{!tuangou && '（共1单）'}</span>
              <span>¥{fmtMoney(order.itemTotal)}</span>
            </p>
            {!tuangou && (
              <p className="flex justify-between text-black/55">
                <span>配送费{order.deliveryFee === 0 && order.itemTotal >= 45 ? <span className="ml-1 text-[#00A661]">（满45已免）</span> : null}</span>
                <span>¥{fmtMoney(order.deliveryFee)}</span>
              </p>
            )}
            {order.discount > 0 && (
              <p className="flex justify-between text-[#FF4B33]">
                <span>优惠共减{order.couponAmount ? <span className="ml-1 text-black/40">（含优惠券¥{fmtMoney(order.couponAmount)}）</span> : null}</span>
                <span>-¥{fmtMoney(order.discount)}</span>
              </p>
            )}
            <p className="flex justify-between border-t border-black/5 pt-2 text-[14px] font-bold text-black/85">
              <span>{order.status === 'pendingPay' ? '待付款' : '实付'}</span>
              <span style={{ color: order.status === 'pendingPay' ? MT_ORANGE : MT_PRICE }}>¥{order.total.toFixed(2)}</span>
            </p>
          </div>
        </div>
      </div>

      {/* 底部操作 */}
      <div className="shrink-0 border-t border-black/5 bg-white px-4 py-3">
        <div className="flex items-center justify-end gap-2.5">
          {order.status === 'pendingPay' && (
            <>
              <button type="button" onClick={cancel} className="rounded-full border border-[#FF6000] px-6 py-2.5 text-[14px] font-medium text-[#FF6000] active:opacity-75">
                取消订单
              </button>
              <button type="button" onClick={() => onOpenPay(order)} className="rounded-full bg-gradient-to-r from-[#FF9A21] to-[#FF6F1E] px-7 py-2.5 text-[15px] font-semibold text-white active:opacity-85">
                ¥{order.total.toFixed(2)} 继续支付
              </button>
            </>
          )}
          {order.status === 'pendingAccept' && (
            <button type="button" onClick={cancel} className="rounded-full border border-black/15 px-6 py-2.5 text-[13px] text-black/60 active:bg-black/5">
              取消订单（退款）
            </button>
          )}
          {['pendingAccept', 'accepted', 'delivering', 'completed'].includes(order.status) && mtCanRefund(order) && (
            <button
              type="button"
              onClick={() => onApplyRefund(order)}
              className="rounded-full border border-[#FF6000] px-6 py-2.5 text-[13px] font-medium text-[#FF6000] active:opacity-75"
            >
              申请退款
            </button>
          )}
          {(order.status === 'completed' || order.status === 'canceled') && (
            <>
              {order.status === 'completed' && (
                <button type="button" onClick={() => onToast('感谢评价，积分+100（演示）')} className="rounded-full border border-black/15 px-6 py-2.5 text-[13px] text-black/60 active:bg-black/5">
                  评价
                </button>
              )}
              <button type="button" onClick={reorder} className="rounded-full bg-[#FFD100] px-7 py-2.5 text-[14px] font-semibold text-black/90 active:opacity-85">
                再来一单
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 小按钮（修改 / 打赏骑手） */
function SmallPill({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ml-1 shrink-0 rounded-full border border-black/15 px-2.5 py-1 text-[11px] leading-none text-black/60 active:bg-black/5">
      {children}
    </button>
  );
}

/** 复制按钮 */
function CopyBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ml-1 shrink-0 rounded-full border border-black/15 px-2.5 py-1 text-[11px] leading-none text-black/60 active:bg-black/5">
      复制
    </button>
  );
}

// ================================ 团购详情页（截图6） ================================

function DealDetailPage({ deal, onBack, onBuy, onOpenMerchant, onToast }: { deal: MtDeal; onBack: () => void; onBuy: (mode: 'group' | 'direct') => void; onOpenMerchant: (id: string) => void; onToast: (m: string) => void }) {
  const merchant = mtMerchantOf(deal.merchantId);
  const thumbs = MT_DEALS.filter((d) => d.merchantId === deal.merchantId).slice(0, 5);
  const groupPrice = deal.groupPrice ?? Math.max(0.1, Math.round((deal.price - 2) * 10) / 10);
  const { favs, toggle } = useFavs();
  const dealFav = favs.deals.includes(deal.id);
  if (!merchant) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <p className="text-[13px] text-black/40">团购不存在</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 头图 + 悬浮搜索 */}
        <div className="relative h-[228px]">
          <FoodImg src={deal.img} emoji={deal.emoji} className="h-full w-full" />
          <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-3 pt-[54px]">
            <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/35 text-white active:opacity-75">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => onToast('搜索（演示）')} className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-white/95 px-3">
              <SearchIcon className="h-3.5 w-3.5 shrink-0 text-black/40" />
              <span className="truncate text-[13px] text-black/70">{merchant.name.split('（')[0]}</span>
              <span className="ml-auto shrink-0 rounded-full bg-[#FFD100] px-3 py-1 text-[12px] font-medium text-black/85">搜索</span>
            </button>
            <button
              type="button"
              aria-label="收藏团购"
              onClick={() => onToast(toggle('deals', deal.id) ? '已收藏，可在收藏中查看' : '已取消收藏')}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/35 text-white active:opacity-75"
            >
              <Star className={`h-4 w-4 ${dealFav ? 'fill-[#FFD100] text-[#FFD100]' : ''}`} />
            </button>
            <button type="button" aria-label="分享" onClick={() => onToast('分享（演示）')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/35 text-white active:opacity-75">
              <Share2 className="h-4 w-4" />
            </button>
          </div>
          <span className="absolute bottom-3 right-3 rounded-full bg-black/45 px-2 py-0.5 text-[10px] text-white">1/3</span>
        </div>

        {/* 套餐缩略条 */}
        <div className="flex gap-2 overflow-x-auto bg-white px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {thumbs.map((t, i) => (
            <div key={t.id} className={`w-[78px] shrink-0 rounded-lg p-[3px] ${i === 0 ? 'border-[1.5px] border-[#FF2D7E]' : ''}`}>
              <FoodImg src={t.img} emoji={t.emoji} className="h-[60px] w-full rounded-md" />
              <p className="mt-1 line-clamp-2 text-[10px] leading-tight text-black/70">{t.title}</p>
              <p className="text-[11px] font-semibold" style={{ color: i === 0 ? MT_PINK : MT_PRICE }}>
                ¥{fmtMoney(t.price)}
              </p>
            </div>
          ))}
          <button type="button" onClick={() => onToast('全部套餐（演示）')} className="flex w-8 shrink-0 flex-col items-center justify-center text-[11px] text-black/45">
            全部
            <ChevronRight className="h-3.5 w-3.5 rotate-90" />
          </button>
        </div>

        {/* 价格块（粉）+ 标题/须知/门店/规则/详情 */}
        <div className="mt-2.5 overflow-hidden border-y-[7px] border-[#F5F6F7]">
          <div className="bg-gradient-to-r from-[#FF2D7E] to-[#FF5E9E] px-4 pb-3 pt-3">
            <div className="flex items-start gap-2">
              <p className="flex items-baseline leading-none">
                <span className="text-[15px] font-bold text-[#A5001F]">¥</span>
                <span className="text-[30px] font-bold tracking-tight text-[#A5001F]">{fmtMoney(deal.price)}</span>
              </p>
              <span className="mt-1 flex items-center rounded-full bg-white px-1.5 py-0.5 text-[11px] font-semibold text-[#FF2D7E]">
                {deal.discount}
                <ChevronRight className="h-3 w-3" />
              </span>
              <span className="mt-1.5 text-[13px] text-white/85 line-through">¥{fmtMoney(deal.origPrice)}</span>
              <span className="mt-1.5 text-[13px] text-white/85">{deal.sold}</span>
              <span className="ml-auto mt-0.5 rounded-lg bg-[#E6197A] px-2 py-1 text-center text-[10px] font-bold leading-[1.3] text-white">
                限量·低价
                <br />
                特价团
              </span>
            </div>
            <p className="mt-1 flex items-center gap-1 text-[12px] text-white/95">
              <Zap className="h-3.5 w-3.5" />
              品牌新客价
            </p>
          </div>

          <div className="bg-white px-4 pb-4 pt-3">
            <p className="text-[18px] font-bold leading-snug text-black/90">{deal.title}</p>
            <div className="mt-2.5 flex items-center gap-1.5 text-[12px]">
              <span className="text-black/35">需知</span>
              <span className="rounded-[3px] border border-[#FF2D7E]/45 px-1 py-px text-[10px] text-[#FF2D7E]">{deal.tips}</span>
              <span className="rounded-[3px] border border-[#FF2D7E]/45 px-1 py-px text-[10px] text-[#FF2D7E]">到店取</span>
              <span className="min-w-0 flex-1 truncate text-black/45">{deal.usable} · 随时退 · 过期自动退</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/25" />
            </div>

            <button type="button" onClick={() => onOpenMerchant(merchant.id)} className="mt-4 flex w-full items-center text-left">
              <span className="text-[15px] font-bold text-black/85">适用门店</span>
              <span className="ml-auto text-[12px] text-black/45">5家门店通用</span>
              <ChevronRight className="h-4 w-4 text-black/25" />
            </button>
            <div className="mt-2 rounded-xl bg-[#F7F8FA] p-3">
              <div className="flex items-center gap-2.5">
                <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-white shadow-sm">
                  <FoodImg src={merchant.cover} emoji={merchant.emoji} className="h-full w-full" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-[15px] font-bold text-black/85">
                    {merchant.name}
                    <ChevronRight className="h-4 w-4 shrink-0 text-black/30" />
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12px]">
                    <span className="flex items-center gap-0.5 text-[#FF6000]">
                      <Star className="h-3 w-3 fill-[#FF6000]" strokeWidth={0} />
                      <span className="font-semibold">{merchant.rating}</span>
                    </span>
                    <span className="text-black/45">{MT_CATS.find((c) => c.id === merchant.cats[0])?.name ?? '美食'}</span>
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {deal.storeTags.map((t, i) => (
                  <span key={t} className={`rounded-[3px] px-1.5 py-0.5 text-[10px] ${i === 0 ? 'bg-[#FFF3B8] text-[#B77900]' : 'border border-black/10 bg-white text-black/45'}`}>
                    {t}
                  </span>
                ))}
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-black/60">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-black/40" />
                <span className="truncate">距您{deal.distanceKm}km，{merchant.addr}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/25" />
              </p>
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-black/60">
                <ClockIcon className="h-3.5 w-3.5 shrink-0 text-black/40" />
                营业中 {merchant.hours}
              </p>
            </div>

            {/* 拼团规则 */}
            <div className="mt-4 flex items-center">
              <span className="text-[15px] font-bold text-black/85">拼团规则</span>
              <span className="ml-auto text-[12px] text-black/45">查看拼团规则</span>
              <ChevronRight className="h-4 w-4 text-black/25" />
            </div>
            <div className="mt-2.5 flex items-center text-[12px] text-black/60">
              <span className="flex items-center gap-1"><Receipt className="h-3.5 w-3.5" />下单支付</span>
              <span className="mx-2 flex-1 border-t border-dashed border-black/20" />
              <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />邀请新用户拼团</span>
              <span className="mx-2 flex-1 border-t border-dashed border-black/20" />
              <span className="flex items-center gap-1"><PartyPopper className="h-3.5 w-3.5" />人满成团</span>
            </div>
          </div>
        </div>

        {/* 团购详情 */}
        <div className="border-y-[7px] border-[#F5F6F7] px-4 py-4">
          <p className="text-[16px] font-bold text-black/85">团购详情</p>
          {deal.menu.map((sec) => (
            <div key={sec.sec} className="mt-3">
              <p className="text-[14px] font-bold text-black/80">{sec.sec}</p>
              <div className="mt-1.5 space-y-2">
                {sec.items.map((it, i) => (
                  <p key={`${it.name}-${i}`} className="flex items-baseline gap-2 text-[13px]">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-black/25" />
                    <span className="min-w-0 flex-1 text-black/75">{it.name}</span>
                    <span className="shrink-0 text-black/40">（1份）</span>
                    <span className="shrink-0 font-medium text-black/80">¥{fmtMoney(it.price)}</span>
                  </p>
                ))}
              </div>
            </div>
          ))}
          <p className="mt-3 border-t border-black/5 pt-2.5 text-[12px] text-black/40">备注：【温馨提示】具体产品过敏原信息请查看商家小程序产品界面</p>
        </div>
      </div>

      {/* 底部：拼团 + 直接购买 */}
      <div className="shrink-0 border-t border-black/5 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onBuy('group')}
            className="flex h-12 flex-1 items-center justify-center gap-1 rounded-full border-[1.5px] border-[#FF2D7E] text-[#FF2D7E] active:opacity-80"
          >
            <span className="text-[17px] font-bold">¥{fmtMoney(groupPrice)}</span>
            <span className="text-[13px]">2人拼团</span>
          </button>
          <button
            type="button"
            onClick={() => onBuy('direct')}
            className="flex h-12 flex-1 items-center justify-center gap-1 rounded-full bg-gradient-to-r from-[#FF2D7E] to-[#FF5E9E] text-white shadow-sm active:opacity-85"
          >
            <span className="text-[17px] font-bold">¥{fmtMoney(deal.price)}</span>
            <span className="text-[15px] font-medium">直接购买</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================ 团购确认订单弹窗（截图7：面板外顶部提示条 + 特价团粉横幅） ================================

function DealConfirmSheet({
  deal,
  mode,
  onClose,
  onOpenPay,
  onToast,
}: {
  deal: MtDeal;
  mode: 'group' | 'direct';
  onClose: () => void;
  onOpenPay: (o: MtOrder) => void;
  onToast: (m: string) => void;
}) {
  const session = mtGetSession();
  const uid = session ? mtUidOf(session) : '';
  const merchant = mtMerchantOf(deal.merchantId);
  const [qty, setQty] = useState(1);
  // 优惠券（到店券）
  const [selCoupon, setSelCoupon] = useState<MtCoupon | null>(null);
  const [couponPick, setCouponPick] = useState(false);
  const unitPrice = mode === 'group' ? (deal.groupPrice ?? Math.max(0.1, Math.round((deal.price - 2) * 10) / 10)) : deal.price;
  const itemTotal = Math.round(deal.origPrice * qty * 100) / 100;
  const baseTotal = Math.round(unitPrice * qty * 100) / 100;
  const couponOff = selCoupon ? Math.min(selCoupon.amount, Math.max(0.01, baseTotal - 0.01)) : 0;
  const total = Math.max(0.01, Math.round((baseTotal - couponOff) * 100) / 100);
  const discount = Math.round((itemTotal - total) * 100) / 100;
  const usableCoupons = uid ? mtListUsableCoupons(uid, 'daodian', baseTotal) : { usable: [], others: [] };

  const submit = () => {
    if (!merchant || !uid) {
      onToast('数据异常，请返回重试');
      return;
    }
    const now = Date.now();
    const order: MtOrder = {
      id: `mt${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      uid,
      merchantId: merchant.id,
      merchantName: merchant.name,
      merchantEmoji: merchant.emoji,
      merchantImg: merchant.cover,
      kind: 'tuangou',
      items: [{ dishId: deal.id, name: deal.title, price: deal.origPrice, qty, emoji: deal.emoji, img: deal.img }],
      itemTotal,
      deliveryFee: 0,
      discount,
      couponId: selCoupon?.id,
      couponAmount: couponOff > 0 ? couponOff : undefined,
      total,
      status: 'pendingPay',
      createdAt: now,
      statusLog: [{ status: 'pendingPay', at: now }],
    };
    if (selCoupon) mtUseCoupon(uid, selCoupon.id);
    const list = mtLoadOrders(uid);
    mtSaveOrders(uid, [order, ...list]);
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    onClose();
    onOpenPay(order);
  };

  return (
    <motion.div className="absolute inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      {/* 遮罩：点击弹窗外任意区域关闭（需求：点击别的地方弹窗消失） */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <motion.div
        className="absolute inset-x-0 bottom-0 top-[64px] flex flex-col overflow-hidden rounded-t-[20px] bg-white"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.34 }}
      >
        {/* 特价团粉横幅（面板顶部，对齐截图7） */}
        <div className="flex shrink-0 items-center gap-2 bg-[#FF2D7E] px-4 py-2.5">
          <span className="flex items-center whitespace-nowrap text-[16px] font-bold text-white">
            特
            <Zap className="h-[13px] w-[13px] fill-[#FFD100] text-[#FFD100]" strokeWidth={0} />
            价团
          </span>
          <span className="text-[13px] text-white">本单为你额外节省{fmtMoney(discount)}元</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div>
            {/* 商品卡 */}
            <div className="px-4 py-3.5">
              <div className="flex gap-3">
                <FoodImg src={deal.img} emoji={deal.emoji} className="h-[84px] w-[84px] shrink-0 rounded-xl" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="text-[15px] font-bold leading-snug text-black/90">{deal.title}</p>
                  <p className="mt-1 flex items-center gap-1 text-[12px] text-black/45">
                    {deal.usable}
                    <span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-black/20 text-[9px] text-black/40">?</span>
                  </p>
                  <div className="mt-auto flex items-end justify-between">
                    <span className="text-[15px] font-bold text-black/85">¥{fmtMoney(deal.origPrice)}</span>
                    <Stepper
                      qty={qty}
                      onAdd={() => setQty((q) => Math.min(9, q + 1))}
                      onDec={() => setQty((q) => Math.max(1, q - 1))}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 优惠券（到店券） */}
            <button type="button" onClick={() => setCouponPick(true)} className="flex w-full items-center border-t border-black/5 px-4 py-3.5 text-left active:opacity-70">
              <span className="flex-1 text-[14px] text-black/80">优惠券</span>
              <span className={`flex items-center gap-0.5 text-[13px] ${selCoupon || usableCoupons.usable.length > 0 ? 'font-medium text-[#FF2D7E]' : 'text-black/40'}`}>
                {selCoupon ? `-¥${fmtMoney(couponOff)}` : usableCoupons.usable.length > 0 ? `${usableCoupons.usable.length}张可用` : '暂无可用'}
                <ChevronRight className="h-4 w-4" />
              </span>
            </button>

            {/* 过期提醒 */}
            <div className="flex items-center gap-2 border-t border-black/5 px-4 py-3">
              <Bell className="h-4 w-4 shrink-0 text-black/55" />
              <p className="text-[12px] leading-relaxed text-black/55">{deal.notice}</p>
            </div>

            {/* 价格卡 */}
            <div className="space-y-3.5 border-t border-black/5 px-4 py-4">
              <p className="flex items-baseline justify-between text-[14px]">
                <span className="text-black/80">
                  商品总价<span className="ml-1 text-[12px] text-black/40">（共{qty}件）</span>
                </span>
                <span className="text-[16px] font-bold text-black/90">¥{fmtMoney(itemTotal)}</span>
              </p>
              <p className="flex items-center justify-between text-[14px]">
                <span className="text-black/80">优惠共减</span>
                <span className="flex items-center gap-0.5 font-medium text-[#FF2D7E]">
                  -¥{fmtMoney(discount)}
                  <ChevronRight className="h-4 w-4 rotate-90 text-black/25" />
                </span>
              </p>
              <p className="flex items-baseline justify-between border-t border-black/5 pt-3 text-[14px]">
                <span className="font-semibold text-black/85">实付</span>
                <span className="text-[18px] font-bold" style={{ color: MT_PINK }}>
                  ¥{fmtMoney(total)}
                </span>
              </p>
            </div>

            {/* 购买后可领 */}
            <div className="flex items-center gap-3 border-t border-black/5 px-4 py-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#FF6A4D] to-[#FF3B30] shadow-sm">
                <Gift className="h-5 w-5 text-white" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-black/85">
                  购买后可领1次 <span className="font-bold text-[#FF3B30]">休闲玩乐</span>
                </p>
                <p className="mt-0.5 text-[11px] text-black/45">附近门店可用，休闲玩乐N选1免费兑换</p>
              </div>
            </div>

            {/* 评价后享 */}
            <div className="flex items-center justify-between border-t border-black/5 px-4 py-3.5">
              <span className="text-[14px] text-black/80">评价后享</span>
              <span className="text-[13px] text-black/55">
                评价可得最高<span className="font-semibold text-[#FF3B30]">100积分</span>
              </span>
            </div>

            <p className="px-4 pt-3 text-[11px] leading-relaxed text-black/35">订单支付后即可消费，如有问题可随时申请退款</p>
          </div>
        </div>

        {/* 底栏 */}
        <div className="shrink-0 border-t border-black/5 bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[20px] font-bold leading-tight" style={{ color: MT_PINK }}>
                ¥{fmtMoney(total)}
              </p>
              <p className="text-[11px] text-black/40">
                共{qty}件 总优惠 ¥{fmtMoney(discount)}
              </p>
            </div>
            <button type="button" onClick={submit} className="h-12 rounded-full bg-gradient-to-r from-[#FF2D7E] to-[#FF5E9E] px-9 text-[16px] font-semibold text-white shadow-sm active:opacity-85">
              提交订单
            </button>
          </div>
        </div>
      </motion.div>

      {/* 优惠券选择弹层（到店券） */}
      <AnimatePresence>
        {couponPick && uid && (
          <CouponPickerSheet
            key="mt-deal-coupon-pick"
            uid={uid}
            type="daodian"
            itemTotal={baseTotal}
            selId={selCoupon?.id ?? null}
            onClose={() => setCouponPick(false)}
            onPick={(c) => {
              setSelCoupon(c);
              setCouponPick(false);
            }}
            onToast={onToast}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ================================ 优惠券选择弹层（下单用券） ================================

function CouponPickerSheet({
  uid,
  type,
  itemTotal,
  selId,
  onClose,
  onPick,
  onToast,
}: {
  uid: string;
  type: 'waimai' | 'daodian';
  itemTotal: number;
  selId: string | null;
  onClose: () => void;
  onPick: (c: MtCoupon | null) => void;
  onToast: (m: string) => void;
}) {
  const { usable, others } = mtListUsableCoupons(uid, type, itemTotal);
  return (
    <motion.div className="absolute inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      {/* 点弹窗外任意区域关闭 */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 flex max-h-[72%] flex-col overflow-hidden rounded-t-[20px] bg-white"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.3 }}
      >
        <div className="relative flex shrink-0 items-center justify-center pb-2.5 pt-4">
          <span className="absolute left-1/2 top-[7px] h-1 w-9 -translate-x-1/2 rounded-full bg-black/12" aria-hidden="true" />
          <p className="text-[16px] font-semibold text-black/85">选择优惠券</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-3 grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] active:bg-black/10">
            <X className="h-4 w-4 text-black/60" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* 不使用优惠券 */}
          <button type="button" onClick={() => onPick(null)} className="flex w-full items-center justify-between border-b border-black/[0.05] py-3.5 text-left active:bg-black/[0.02]">
            <span className="text-[14px] text-black/75">不使用优惠券</span>
            <span className={`grid h-[19px] w-[19px] place-items-center rounded-full ${selId === null ? 'bg-[#FFC300]' : 'border border-black/20'}`}>
              {selId === null && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
            </span>
          </button>

          {usable.map((c) => (
            <button key={c.id} type="button" onClick={() => onPick(c)} className="flex w-full items-center gap-3 border-b border-black/[0.05] py-3.5 text-left active:bg-black/[0.02]">
              <span className="grid h-11 w-[64px] shrink-0 place-items-center bg-gradient-to-br from-[#FF5A3C] to-[#FF3B6B] text-white">
                <span className="text-[19px] font-bold leading-none">
                  <span className="text-[11px]">¥</span>
                  {c.amount}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-black/85">{c.name}</span>
                <span className="block text-[11px] text-black/40">
                  满{c.min}可用 · {fmtDate(c.expireAt)}前有效
                </span>
              </span>
              <span className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full ${selId === c.id ? 'bg-[#FFC300]' : 'border border-black/20'}`}>
                {selId === c.id && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
              </span>
            </button>
          ))}

          {others.length > 0 && (
            <>
              <p className="mt-3 text-[12px] text-black/35">不可用券</p>
              {others.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onToast(c.type === type ? `未满足使用门槛（满${c.min}可用）` : '该券与当前订单类型不符')}
                  className="flex w-full items-center gap-3 py-3.5 text-left opacity-45"
                >
                  <span className="grid h-11 w-[64px] shrink-0 place-items-center bg-black/15 text-white">
                    <span className="text-[19px] font-bold leading-none">
                      <span className="text-[11px]">¥</span>
                      {c.amount}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-black/85">{c.name}</span>
                    <span className="block text-[11px] text-black/40">{c.type === type ? `满${c.min}可用` : `限${mtCouponTypeLabel(c.type)}使用`}</span>
                  </span>
                </button>
              ))}
            </>
          )}
          {usable.length === 0 && <p className="py-8 text-center text-[13px] text-black/35">暂无本单可用的优惠券</p>}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ================================ 商品规格选择弹窗（奶茶小料/食物小料配菜） ================================

/** 菜品规格弹窗（对齐截图2：图+标题、单选/多选粉选芯片、底价+步进+选好了） */
function DishSpecSheet({
  dish,
  onClose,
  onConfirm,
}: {
  dish: MtDish;
  onClose: () => void;
  onConfirm: (payload: { qty: number; spec: string; unitPrice: number }) => void;
}) {
  const specs = dish.specs ?? [];
  // 初始选中：单选组默认第一项；多选组默认空
  const initSel = (): Record<string, string[]> => {
    const m: Record<string, string[]> = {};
    for (const g of specs) m[g.name] = g.multi ? [] : [g.options[0]?.label ?? ''];
    return m;
  };
  const [sel, setSel] = useState<Record<string, string[]>>(initSel);
  const [qty, setQty] = useState(1);

  const optionPrice = (gName: string, label: string): number => specs.find((g) => g.name === gName)?.options.find((o) => o.label === label)?.price ?? 0;

  const tapOption = (gName: string, label: string) => {
    const g = specs.find((x) => x.name === gName);
    if (!g) return;
    setSel((prev) => {
      const cur = prev[gName] ?? [];
      if (g.multi) {
        const has = cur.includes(label);
        if (has) return { ...prev, [gName]: cur.filter((x) => x !== label) };
        const max = g.max ?? g.options.length;
        if (cur.length >= max) {
          // 超上限：替换最早选中（保持可选，体验顺滑）
          return { ...prev, [gName]: [...cur.slice(1), label] };
        }
        return { ...prev, [gName]: [...cur, label] };
      }
      return { ...prev, [gName]: [label] };
    });
  };

  const unitPrice = Math.max(0.1, dish.price + specs.reduce((s, g) => s + (sel[g.name] ?? []).reduce((t, l) => t + optionPrice(g.name, l), 0), 0));
  const specText = specs
    .map((g) => {
      const picked = sel[g.name] ?? [];
      if (picked.length === 0) return '';
      return picked.join('、');
    })
    .filter(Boolean)
    .join('/');

  const chipBase = 'min-h-[44px] rounded-lg px-2 text-[15px] transition-colors';
  const chipOn = 'border-[1.5px] border-[#FF2D7E] bg-[#FFEBF3] font-medium text-[#FF2D7E]';
  const chipOff = 'border-[1.5px] border-transparent bg-[#F5F6F7] text-black/80';

  return (
    <motion.div className="absolute inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      {/* 点弹窗外任意区域关闭 */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 top-[56px] flex flex-col overflow-hidden rounded-t-[20px] bg-white"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.3 }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* 头部：图 + 标题 + 关闭 */}
          <div className="flex items-start gap-3">
            <FoodImg src={dish.img} emoji={dish.emoji} className="h-[88px] w-[88px] shrink-0 rounded-xl" />
            <p className="min-w-0 flex-1 pt-1 text-[17px] font-bold leading-snug text-black/90">{dish.name}</p>
            <button type="button" aria-label="关闭" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/[0.05] active:bg-black/10">
              <X className="h-4 w-4 text-black/60" />
            </button>
          </div>

          {specs.map((g, gi) => (
            <div key={g.name} className="mt-5">
              <p className="text-[16px] font-semibold text-black/90">
                {g.name === '规格' && gi === 0 ? '' : g.multi && g.max ? `${g.name}（最多可选${g.max}份）` : g.name}
              </p>
              <div className="mt-2.5 grid grid-cols-3 gap-2.5">
                {g.options.map((o) => {
                  const on = (sel[g.name] ?? []).includes(o.label);
                  return (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => tapOption(g.name, o.label)}
                      className={`${chipBase} ${on ? chipOn : chipOff} ${o.price !== undefined && g.multi ? 'flex items-center justify-between px-3' : 'flex items-center justify-center'}`}
                    >
                      <span className="truncate">{o.label}</span>
                      {o.price !== undefined && g.multi && (
                        <>
                          <span className="mx-2 h-4 w-px shrink-0 bg-black/10" aria-hidden="true" />
                          <span className="shrink-0">{o.price > 0 ? `¥${o.price}` : o.price < 0 ? `-¥${-o.price}` : ''}</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 底部：价格 + 步进 + 选好了 */}
        <div className="shrink-0 border-t border-black/[0.05] bg-white px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-center gap-2">
            <span className="text-[24px] font-bold leading-none text-[#FF2D7E]">
              <span className="text-[14px]">¥</span>
              {fmtMoney(unitPrice)}
            </span>
            {dish.origPrice && dish.origPrice > dish.price && <span className="text-[13px] font-medium text-[#FF2D7E]">已优惠¥{fmtMoney(Math.round((dish.origPrice - dish.price) * 100) / 100)}</span>}
            <span className="flex-1" />
            <span className="flex items-center gap-2.5">
              <button
                type="button"
                aria-label="减少"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="grid h-8 w-8 place-items-center rounded-full border border-black/15 text-black/55 active:bg-black/5"
              >
                <Minus className="h-4 w-4" strokeWidth={2.4} />
              </button>
              <span className="min-w-5 text-center text-[16px] font-semibold">{qty}</span>
              <button
                type="button"
                aria-label="增加"
                onClick={() => setQty((q) => Math.min(9, q + 1))}
                className="grid h-8 w-8 place-items-center rounded-full bg-[#FF2D7E] text-white active:opacity-85"
              >
                <span className="-mt-px text-[18px] leading-none">＋</span>
              </button>
            </span>
          </div>
          <button
            type="button"
            onClick={() => onConfirm({ qty, spec: specText, unitPrice })}
            className="mt-3 h-[52px] w-full rounded-[26px] bg-gradient-to-r from-[#FF2D7E] to-[#FF5E9E] text-[17px] font-bold text-white shadow-[0_4px_14px_rgba(255,45,126,0.3)] active:opacity-85"
          >
            选好了
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ================================ 我的券（优惠券页，对齐截图1） ================================

type CouponCat = 'all' | 'waimai' | 'daodian' | 'hotel' | 'shangou';
const COUPON_CATS: { key: CouponCat; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'waimai', label: '外卖' },
  { key: 'daodian', label: '美食' },
  { key: 'hotel', label: '酒店民宿' },
  { key: 'shangou', label: '闪购' },
];

function CouponsPage({
  session,
  onBack,
  onGoUse,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  onGoUse: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const [, setVer] = useState(0);
  const [cat, setCat] = useState<CouponCat>('all');
  const [quick, setQuick] = useState<string | null>(null);
  const [listTab, setListTab] = useState<'coupon' | 'card'>('coupon');
  const coupons = mtLoadCoupons(uid);
  const now = Date.now();

  // 即将过期（24h 内）
  const expiringSoon = coupons.filter((c) => !c.usedAt && c.expireAt - now < 24 * 3600_000 && c.expireAt > now).length;

  const list = (() => {
    let arr = [...coupons];
    if (cat !== 'all') arr = arr.filter((c) => c.type === cat);
    if (quick === 'god') arr = arr.filter((c) => c.god);
    else if (quick === 'recent') arr.sort((a, b) => b.obtainedAt - a.obtainedAt);
    else if (quick === 'expiring') arr = arr.filter((c) => !c.usedAt && c.expireAt - now < 24 * 3600_000 && c.expireAt > now);
    else if (quick === 'discount') arr.sort((a, b) => b.amount / Math.max(1, b.min) - a.amount / Math.max(1, a.min));
    else if (quick === 'big') arr.sort((a, b) => b.amount - a.amount);
    else arr.sort((a, b) => Number(Boolean(a.usedAt)) - Number(Boolean(b.usedAt)) || b.obtainedAt - a.obtainedAt);
    return arr;
  })();

  const claim = () => {
    const n = mtClaimGodCoupons(uid);
    setVer((v) => v + 1);
    onToast(n > 0 ? `已领取${n}张神券，快去下单使用吧` : '神券已领取过了，可在列表查看');
  };

  const expireLine = (c: MtCoupon): ReactNode => {
    const left = c.expireAt - now;
    if (c.usedAt) return <span className="text-black/30">已使用</span>;
    if (left <= 24 * 3600_000) {
      const h = Math.max(0, Math.floor(left / 3600_000));
      const mnt = Math.max(0, Math.floor((left % 3600_000) / 60_000));
      const s = Math.max(0, Math.floor((left % 60_000) / 1000));
      return (
        <>
          <span className="text-[#FF6000]">仅剩{String(h).padStart(2, '0')}:{String(mnt).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>
          <span className="text-black/35"> 规则</span>
        </>
      );
    }
    if (left <= 2 * 24 * 3600_000) {
      return (
        <>
          <span className="text-black/45">明日到期</span>
          <span className="text-black/35"> 规则</span>
        </>
      );
    }
    return (
      <>
        <span className="text-black/45">{fmtDate(c.expireAt)}到期</span>
        <span className="text-black/35"> 规则</span>
      </>
    );
  };

  return (
    <div className="flex h-full flex-col bg-[#F5F5F7]">
      {/* 顶栏：返回 + 我的券/卡 胶囊 + 更多 */}
      <div className="relative grid h-[100px] shrink-0 place-items-center border-b border-black/[0.04] bg-white pt-[50px]">
        <button type="button" aria-label="返回" onClick={onBack} className="absolute left-1 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.2} />
        </button>
        <div className="flex h-[40px] items-center rounded-full bg-[#F1F2F4] p-[3px]">
          {([
            ['coupon', '我的券'],
            ['card', '卡'],
          ] as ['coupon' | 'card', string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setListTab(k)}
              className={`h-[34px] rounded-full px-5 text-[15px] font-medium transition-colors ${listTab === k ? 'bg-white text-black/90 shadow-sm' : 'text-black/45'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" aria-label="更多" onClick={() => onToast('券码兑换/帮助中心（演示）')} className="absolute right-3 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <span className="flex gap-[3px]">
            <span className="h-[4px] w-[4px] rounded-full bg-black/60" />
            <span className="h-[4px] w-[4px] rounded-full bg-black/60" />
            <span className="h-[4px] w-[4px] rounded-full bg-black/60" />
          </span>
        </button>
      </div>

      {listTab === 'card' ? (
        /* 卡 tab：卡包空态 */
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-black/[0.05]">
            <CreditCard className="h-7 w-7 text-black/25" strokeWidth={1.8} />
          </span>
          <p className="mt-4 text-[15px] font-medium text-black/60">暂无可用的卡</p>
          <p className="mt-1 text-[12px] text-black/35">美团联名卡、储值卡将展示在这里</p>
        </div>
      ) : (
        <>
          {/* 分类页签 */}
          <div className="shrink-0 bg-white px-4">
            <div className="flex gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {COUPON_CATS.map((t) => (
                <button key={t.key} type="button" onClick={() => setCat(t.key)} className={`relative shrink-0 py-3 text-[16px] ${cat === t.key ? 'font-bold text-black/90' : 'text-black/55'}`}>
                  {t.label}
                  {cat === t.key && <span className="absolute inset-x-0 bottom-[4px] mx-auto h-[3px] w-6 rounded-full bg-[#FFC300]" />}
                </button>
              ))}
            </div>
          </div>

          {/* 快捷筛选 chips */}
          <div className="shrink-0 border-b border-black/[0.04] bg-white px-3 pb-2.5">
            <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {([
                ['god', '神券', true],
                ['recent', '最近获得', false],
                ['expiring', `即将过期(${expiringSoon})`, false],
                ['discount', '折扣最大', false],
                ['big', '面额最大', false],
              ] as [string, string, boolean][]).map(([k, label, hot]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setQuick((q) => (q === k ? null : k))}
                  className={`shrink-0 rounded-lg px-3.5 py-2 text-[13px] transition-colors ${quick === k ? 'bg-[#FFF3B8] font-semibold text-[#B77900]' : hot ? 'bg-[#F5F6F7] font-bold text-[#FF3B30]' : 'bg-[#F5F6F7] text-black/70'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 券列表 */}
          <div className="min-h-0 flex-1 overflow-y-auto pb-28 pt-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {list.length === 0 ? (
              <div className="pt-20 text-center">
                <p className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white">
                  <Ticket className="h-7 w-7 text-black/25" strokeWidth={1.8} />
                </p>
                <p className="mt-3 text-[14px] text-black/45">暂无相关优惠券</p>
                <button type="button" onClick={claim} className="mt-4 rounded-full bg-[#FFD100] px-6 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
                  去领神券
                </button>
              </div>
            ) : (
              <div className="space-y-2.5 px-3">
                {list.map((c) => {
                  const used = Boolean(c.usedAt);
                  const expired = c.expireAt <= now && !used;
                  const dead = used || expired;
                  return (
                    <div key={c.id} className={`relative flex items-stretch overflow-hidden rounded-2xl bg-white ${dead ? 'opacity-55' : ''}`}>
                      {/* 左侧信息 */}
                      <div className="min-w-0 flex-1 p-3.5">
                        <p className="flex items-center gap-1.5">
                          {c.god && (
                            <span className="rounded-t-md rounded-br-md bg-gradient-to-r from-[#FF5A3C] to-[#FF3B6B] px-1.5 py-px text-[11px] font-bold italic text-white">神券</span>
                          )}
                          <span className="rounded-t-md rounded-br-md bg-[#FFF0C2] px-1.5 py-px text-[11px] text-[#B77900]">{mtCouponTypeLabel(c.type)}</span>
                        </p>
                        <p className="mt-1.5 truncate text-[17px] font-bold text-black/90">{c.name}</p>
                        <p className="mt-1.5 flex items-center text-[12px]">
                          {expireLine(c)}
                          <ChevronRight className="h-3 w-3 text-black/25" />
                        </p>
                      </div>
                      {/* 右侧面额 + 去使用 */}
                      <div className="flex w-[110px] shrink-0 flex-col items-center justify-center gap-1.5 border-l border-dashed border-black/[0.08] py-3">
                        <span className="text-[26px] font-bold leading-none text-[#FF3B30]">
                          {c.amount}
                          <span className="text-[14px]">元</span>
                        </span>
                        <span className="text-[11px] text-black/40">满{c.min}可用</span>
                        <button
                          type="button"
                          disabled={dead}
                          onClick={() => {
                            if (dead) {
                              onToast(used ? '该券已使用' : '该券已过期');
                              return;
                            }
                            onGoUse();
                          }}
                          className={`mt-1 rounded-full px-5 py-1.5 text-[13px] font-semibold ${dead ? 'bg-[#F5F6F7] text-black/30' : 'bg-[#FFD100] text-black/90 active:opacity-85'}`}
                        >
                          {used ? '已使用' : expired ? '已过期' : '去使用'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 底部功能条：我的钱包 / 领神券 / 返利 / 会员中心 */}
          <div className="absolute inset-x-0 bottom-0 flex shrink-0 items-start border-t border-black/[0.05] bg-white pb-[max(8px,env(safe-area-inset-bottom))] pt-2.5">
            <button type="button" onClick={() => onToast('美团钱包（演示）')} className="flex flex-1 flex-col items-center gap-1 active:opacity-70">
              <Wallet className="h-[22px] w-[22px] text-black/80" strokeWidth={1.8} />
              <span className="text-[11px] text-black/70">我的钱包</span>
            </button>
            <button type="button" onClick={claim} className="flex flex-1 flex-col items-center active:opacity-80">
              <span className="grid h-[46px] w-[46px] -translate-y-1.5 place-items-center rounded-full bg-gradient-to-br from-[#FF5A3C] to-[#FF3B6B] px-1 text-center text-[12px] font-bold italic leading-[1.15] text-white shadow-[0_3px_10px_rgba(255,59,107,0.4)]">
                领神券
              </span>
            </button>
            <button type="button" onClick={() => onToast('返利 1 笔待提现（演示）')} className="flex flex-1 flex-col items-center gap-1 active:opacity-70">
              <span className="grid h-[22px] w-[22px] place-items-center rounded-full border-[1.5px] border-black/70 text-[12px] font-bold text-black/75">返</span>
              <span className="text-[11px] text-black/70">1笔返利</span>
            </button>
            <button type="button" onClick={() => onToast('会员中心（演示）')} className="flex flex-1 flex-col items-center gap-1 active:opacity-70">
              <Crown className="h-[22px] w-[22px] text-black/80" strokeWidth={1.8} />
              <span className="text-[11px] text-black/70">会员中心</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ================================ 地址管理页 ================================

function AddressesPage({ session, onBack, onAdd, onEdit, onToast }: { session: MtSession; onBack: () => void; onAdd: () => void; onEdit: (a: MtAddress) => void; onToast: (m: string) => void }) {
  const uid = mtUidOf(session);
  const [, setVer] = useState(0);
  const addrs = mtLoadAddresses(uid);
  const cur = mtCurAddrId(uid);

  const remove = (a: MtAddress) => {
    if (addrs.length <= 1) {
      onToast('至少保留一个收货地址');
      return;
    }
    const next = addrs.filter((x) => x.id !== a.id);
    mtSaveAddresses(uid, next);
    if (cur === a.id) mtSetCurAddr(uid, next[0].id);
    setVer((v) => v + 1);
    onToast('地址已删除');
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.04] bg-white px-3 pb-2.5 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-6 w-6 text-black/70" />
        </button>
        <p className="flex-1 text-center text-[16px] font-semibold text-black/85">收货地址</p>
        <span className="h-9 w-9" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div>
          {addrs.map((a) => (
            <div key={a.id} className="border-b border-black/[0.04] px-4 py-4 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="rounded bg-[#FFF3B8] px-1.5 text-[11px] text-[#B77900]">{a.tag}</span>
                <span className="text-[15px] font-semibold text-black/85">{a.name}</span>
                <span className="text-[13px] text-black/45">{a.phone}</span>
                {a.id === cur && <span className="ml-auto rounded-full bg-[#E8F9EF] px-2 py-0.5 text-[10px] text-[#00A661]">默认</span>}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-black/65">{a.text}</p>
              <div className="mt-2.5 flex items-center gap-4 border-t border-black/5 pt-2.5 text-[12px]">
                <button type="button" onClick={() => { mtSetCurAddr(uid, a.id); setVer((v) => v + 1); onToast('已设为默认地址'); }} className="flex items-center gap-1 text-black/55 active:opacity-60">
                  <CircleCheck className="h-3.5 w-3.5" /> 设为默认
                </button>
                <button type="button" onClick={() => onEdit(a)} className="text-black/55 active:opacity-60">
                  编辑
                </button>
                <button type="button" onClick={() => remove(a)} className="ml-auto text-[#FF4B33] active:opacity-60">
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="shrink-0 border-t border-black/5 bg-white px-4 py-3">
        <button type="button" onClick={onAdd} className="h-12 w-full rounded-full bg-[#FFD100] text-[15px] font-semibold text-black/90 active:opacity-85">
          + 新增收货地址
        </button>
      </div>
    </div>
  );
}

function AddAddressPage({ session, onBack, editing, onToast }: { session: MtSession; onBack: () => void; editing: MtAddress | null; onToast: (m: string) => void }) {
  const uid = mtUidOf(session);
  const [name, setName] = useState(editing?.name ?? '');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  const [text, setText] = useState(editing?.text ?? '');
  const [tag, setTag] = useState(editing?.tag ?? '家');

  const save = () => {
    if (!name.trim() || !text.trim()) {
      onToast('请填写联系人和地址');
      return;
    }
    const addrs = mtLoadAddresses(uid);
    if (editing) {
      mtSaveAddresses(uid, addrs.map((a) => (a.id === editing.id ? { ...a, name: name.trim(), phone: phone.trim(), text: text.trim(), tag } : a)));
    } else {
      mtSaveAddresses(uid, [...addrs, { id: `addr${Date.now().toString(36)}`, name: name.trim(), phone: phone.trim() || '138****0000', text: text.trim(), tag }]);
    }
    onToast('地址已保存');
    onBack();
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.04] bg-white px-3 pb-2.5 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-6 w-6 text-black/70" />
        </button>
        <p className="flex-1 text-center text-[16px] font-semibold text-black/85">{editing ? '编辑地址' : '新增地址'}</p>
        <span className="h-9 w-9" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="divide-y divide-black/[0.04]">
          {([
            ['联系人', name, setName, '收货人姓名'],
            ['手机号', phone, setPhone, '11 位手机号'],
            ['详细地址', text, setText, '小区 / 写字楼 / 门牌号'],
          ] as const).map(([label, val, set, ph]) => (
            <label key={label} className="flex items-center gap-3 py-3.5">
              <span className="w-[64px] shrink-0 text-[14px] text-black/50">{label}</span>
              <input value={val} onChange={(e) => set(e.target.value)} placeholder={ph} className="h-9 flex-1 bg-transparent text-[14px] outline-none placeholder:text-black/25" />
            </label>
          ))}
          <div className="flex items-center gap-2 py-3.5">
            <span className="w-[64px] shrink-0 text-[14px] text-black/50">标签</span>
            {['家', '公司', '学校'].map((t) => (
              <button key={t} type="button" onClick={() => setTag(t)} className={`rounded-full px-3 py-1.5 text-[12px] ${tag === t ? 'bg-[#FFD100] font-medium text-black/85' : 'bg-[#F5F6F7] text-black/55'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={save} className="mt-5 h-12 w-full rounded-full bg-[#FFD100] text-[15px] font-semibold text-black/90 active:opacity-85">
          保存地址
        </button>
      </div>
    </div>
  );
}

// ================================ 购物车页（截图3） ================================

function CartPage({
  session,
  onOpenMerchant,
  onCheckout,
  onOpenFavorites,
  onToast,
}: {
  session: MtSession;
  onOpenMerchant: (id: string) => void;
  onCheckout: (merchantId: string) => void;
  onOpenFavorites: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const [, setVer] = useState(0);
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<Set<string> | null>(null); // null = 全选态
  const addrs = mtLoadAddresses(uid);
  const cur = addrs.find((a) => a.id === mtCurAddrId(uid)) ?? addrs[0];
  const cart = mtLoadCart(uid);
  const merchant = cart.merchantId ? mtMerchantOf(cart.merchantId) : undefined;
  const rows = cart.items
    .map((i) => {
      if (!merchant) return null;
      const d = mtDishesOf(merchant).find((x) => x.id === i.dishId);
      return d ? { dish: d, qty: i.qty, spec: i.spec, unitPrice: i.unitPrice } : null;
    })
    .filter((x): x is { dish: MtDish; qty: number; spec: string | undefined; unitPrice: number | undefined } => x !== null);

  const selIds = selected ?? new Set(rows.map((r) => r.dish.id));
  const selRows = rows.filter((r) => selIds.has(r.dish.id));
  const sum = selRows.reduce((s, r) => s + (r.unitPrice ?? r.dish.price) * r.qty, 0);
  const allSel = selRows.length === rows.length && rows.length > 0;

  const mutate = (next: MtCart) => {
    mtSaveCart(uid, next);
    setVer((v) => v + 1);
  };

  const dec = (dish: MtDish) => {
    const items = cart.items.map((i) => (i.dishId === dish.id ? { ...i, qty: i.qty - 1 } : i)).filter((i) => i.qty > 0);
    mutate({ merchantId: items.length > 0 ? cart.merchantId : null, items });
  };
  const add = (dish: MtDish) => {
    mutate({ merchantId: cart.merchantId, items: cart.items.map((i) => (i.dishId === dish.id ? { ...i, qty: i.qty + 1 } : i)) });
  };
  const removeRow = (dish: MtDish) => {
    const items = cart.items.filter((i) => i.dishId !== dish.id);
    mutate({ merchantId: items.length > 0 ? cart.merchantId : null, items });
    onToast('已删除');
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 头部 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.04] bg-white px-4 pb-2.5 pt-[54px]">
        <p className="shrink-0 text-[22px] font-bold text-black/90">购物车</p>
        <button type="button" onClick={() => onToast('地址选择请到「我的-收货地址」或下单时选择')} className="flex min-w-0 flex-1 items-center gap-1 text-left active:opacity-60">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-black/45" />
          <span className="truncate text-[13px] text-black/50">{cur ? cur.text : '暂无地址'}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/30" />
        </button>
        {rows.length > 0 && (
          <button type="button" onClick={() => setManage((m) => !m)} className="shrink-0 text-[15px] text-black/75 active:opacity-60">
            {manage ? '完成' : '管理'}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {/* 收藏入口（星星+收藏+箭头，白底直排不套面板） */}
        <button type="button" onClick={onOpenFavorites} className="mx-4 mt-2 flex items-center gap-1.5 py-2 text-left active:opacity-70">
          <Star className="h-[18px] w-[18px] fill-[#FFB800] text-[#FFB800]" />
          <span className="text-[14px] text-black/80">收藏</span>
          <ChevronRight className="h-4 w-4 text-black/30" />
        </button>

        {rows.length === 0 || !merchant ? (
          /* 空态（对齐截图3插画） */
          <div className="py-12 text-center">
            <div className="relative mx-auto h-16 w-20">
              <span className="absolute left-1/2 top-2 h-10 w-16 -translate-x-1/2 rotate-[-4deg] rounded-lg bg-gradient-to-br from-[#C9CDFF] to-[#A7AEFF] shadow-sm" />
              <span className="absolute left-1/2 top-6 h-9 w-16 -translate-x-1/2 rotate-[3deg] rounded-lg bg-gradient-to-br from-[#B5BCFF] to-[#8E96FF] shadow" />
              <span className="absolute left-[30%] top-[34px] h-1 w-6 rounded bg-white/80" />
            </div>
            <p className="mt-4 text-[14px] text-black/45">还没有加购任何商品，快去选购吧</p>
            <button type="button" onClick={() => onOpenMerchant('m-mixue')} className="mt-4 rounded-full bg-[#FFD100] px-7 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
              去逛逛
            </button>
          </div>
        ) : (
          <>
            {/* 商家组 */}
            <div className="border-t-[7px] border-[#F5F6F7] px-4 py-3.5">
              <button type="button" onClick={() => onOpenMerchant(merchant.id)} className="flex w-full items-center gap-1.5 text-left active:opacity-70">
                <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md">
                  <FoodImg src={merchant.cover} emoji={merchant.emoji} className="h-full w-full" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-black/85">{merchant.name}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
              </button>
              <div className="mt-1 divide-y divide-black/[0.04]">
                {rows.map(({ dish, qty, spec, unitPrice }) => {
                  const checked = selIds.has(dish.id);
                  return (
                    <div key={`${dish.id}-${spec ?? ''}`} className="flex items-center gap-2.5 py-3">
                      <button
                        type="button"
                        aria-label={checked ? '取消选择' : '选择'}
                        onClick={() => {
                          const next = new Set(selIds);
                          if (next.has(dish.id)) next.delete(dish.id);
                          else next.add(dish.id);
                          setSelected(next);
                        }}
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${checked ? 'bg-[#FFC300]' : 'border border-black/20'}`}
                      >
                        {checked && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
                      </button>
                      <FoodImg src={dish.img} emoji={dish.emoji} className="h-16 w-16 shrink-0 rounded-lg" />
                      <div className="flex min-w-0 flex-1 flex-col self-stretch">
                        <p className="line-clamp-1 text-[14px] font-medium text-black/85">{dish.name}</p>
                        {spec && <p className="mt-0.5 line-clamp-1 text-[11px] text-black/40">{spec}</p>}
                        {manage && (
                          <button type="button" onClick={() => removeRow(dish)} className="mt-1 w-fit rounded-full border border-[#FF4B33]/40 px-2.5 py-0.5 text-[11px] text-[#FF4B33] active:bg-black/5">
                            删除
                          </button>
                        )}
                        <div className="mt-auto flex items-center justify-between">
                          <span className="text-[16px] font-bold" style={{ color: MT_PRICE }}>
                            <span className="text-[11px]">¥</span>
                            {fmtMoney(unitPrice ?? dish.price)}
                          </span>
                          {!manage && <Stepper qty={qty} onAdd={() => add(dish)} onDec={() => dec(dish)} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {manage && (
              <button
                type="button"
                onClick={() => {
                  mutate({ merchantId: null, items: [] });
                  onToast('购物车已清空');
                }}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 border-t-[7px] border-[#F5F6F7] py-3 text-[13px] text-[#FF4B33] active:bg-black/[0.02]"
              >
                <Trash2 className="h-4 w-4" /> 清空购物车
              </button>
            )}
          </>
        )}
      </div>

      {/* 底部结算条（非空才显示） */}
      {rows.length > 0 && (
        <div className="flex shrink-0 items-center gap-2.5 border-t border-black/[0.06] bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => setSelected(allSel ? new Set<string>() : null)}
            className="flex items-center gap-2 active:opacity-70"
          >
            <span className={`grid h-5 w-5 place-items-center rounded-full ${allSel ? 'bg-[#FFC300]' : 'border border-black/20'}`}>
              {allSel && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
            </span>
            <span className="text-[14px] text-black/60">全选</span>
          </button>
          <span className="flex-1" />
          <span className="text-[14px] text-black/75">
            合计: <span className="text-[19px] font-bold" style={{ color: MT_PRICE }}>¥{fmtMoney(sum)}</span>
          </span>
          <button
            type="button"
            disabled={selRows.length === 0}
            onClick={() => {
              if (!merchant) return;
              if (selRows.length === 0) {
                onToast('请先选择商品');
                return;
              }
              onCheckout(merchant.id);
            }}
            className={`h-11 rounded-full px-8 text-[16px] font-semibold ${selRows.length > 0 ? 'bg-[#FFD100] text-black/90 shadow active:opacity-85' : 'bg-[#F6EC9F] text-black/40'}`}
          >
            结算{selRows.length > 0 ? `(${selRows.length})` : ''}
          </button>
        </div>
      )}
    </div>
  );
}

// ================================ 我的页（截图4） ================================

function MyPage({
  session,
  onOpenOrders,
  onOpenSettings,
  onOpenFavorites,
  onOpenHistory,
  onOpenCoupons,
  onClaimCoupons,
  onToast,
}: {
  session: MtSession;
  onOpenOrders: (tab?: string) => void;
  onOpenSettings: () => void;
  onOpenFavorites: () => void;
  onOpenHistory: () => void;
  onOpenCoupons: () => void;
  onClaimCoupons: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  useOrdersTick();
  const orders = mtLoadOrders(uid);
  const inFlight = orders.filter((o) => ['pendingAccept', 'accepted', 'delivering'].includes(o.status)).length;
  const idpLabel = session.idp === 'wx' ? '微信账号' : session.idp === 'qq' ? 'QQ账号' : `手机用户 ${session.phone ?? ''}`;

  const cell = (Icon: LucideIcon, label: string, badge: number | null, onTap: () => void, tint = 'text-black/75') => (
    <button key={label} type="button" onClick={onTap} className="flex flex-col items-center gap-1.5 active:opacity-70">
      <span className="relative">
        <Icon className={`h-[22px] w-[22px] ${tint}`} strokeWidth={1.8} />
        {badge !== null && badge > 0 && (
          <span className="absolute -right-2 -top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[#FF3B30] px-1 text-[9px] font-bold text-white">{badge}</span>
        )}
      </span>
      <span className="text-[11px] text-black/70">{label}</span>
    </button>
  );

  return (
    <div className="h-full overflow-y-auto bg-white pb-4">
      {/* 黄色头部 + 会员卡（页面主体白底，图标区不再套白色圆角面板） */}
      <div className="bg-gradient-to-b from-[#FFDE00] via-[#FFE65A] to-white px-4 pb-4 pt-[58px]">
        <div className="flex items-center gap-3">
          {session.avatar ? (
            <img src={session.avatar} alt="" className="h-[54px] w-[54px] rounded-full object-cover ring-2 ring-white/70" />
          ) : (
            <span className="grid h-[54px] w-[54px] place-items-center overflow-hidden rounded-full bg-white shadow">
              <img src="/icons/meituan.png" alt="" className="h-full w-full object-cover" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[20px] font-bold text-black/90">{session.name}</p>
            <button type="button" onClick={() => onToast('实名认证（演示）')} className="mt-0.5 flex items-center gap-0.5 text-[12px] text-black/55 active:opacity-60">
              去实名
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <button type="button" onClick={() => onToast('美团客服：0539-000-0000（演示）')} className="flex flex-col items-center gap-0.5 active:opacity-60">
            <Headset className="h-[22px] w-[22px] text-black/80" strokeWidth={1.8} />
            <span className="text-[10px] text-black/60">客服</span>
          </button>
          <button type="button" onClick={onOpenSettings} className="relative ml-2 flex flex-col items-center gap-0.5 active:opacity-60">
            <span className="relative">
              <SettingsIcon />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#FF3B30]" />
            </span>
            <span className="text-[10px] text-black/60">设置</span>
          </button>
        </div>

        {/* 会员卡 */}
        <div className="mt-3 rounded-2xl bg-gradient-to-br from-[#FFEA75] to-[#FFD100] p-3.5 shadow-[0_2px_10px_rgba(180,120,0,0.12)]">
          <div className="flex items-center gap-1.5">
            <Crown className="h-[18px] w-[18px] fill-[#5A4200] text-[#5A4200]" strokeWidth={0} />
            <span className="text-[16px] font-bold text-[#5A4200]">普通会员</span>
            <span className="ml-0.5 flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className={`h-3 w-3 ${i === 0 ? 'fill-[#5A4200] text-[#5A4200]' : 'text-[#5A4200]/40'}`} strokeWidth={1.6} />
              ))}
            </span>
            <button type="button" onClick={onOpenCoupons} className="ml-auto rounded-l-full rounded-r-xl bg-white/70 px-2.5 py-1 text-right active:opacity-70">
              <span className="block text-[11px] font-semibold text-[#5A4200]">会员中心 ›</span>
              <span className="block text-[9px] text-[#5A4200]/70">查看8项权益</span>
            </button>
          </div>
          <p className="mt-0.5 text-[11px] text-[#5A4200]/70">成长值 34/500</p>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {([
              [Bike, '惊喜多选1'],
              [Wallet, '会员神券包'],
              [Building, '延迟退房'],
            ] as [LucideIcon, string][]).map(([Icon, l], i) => (
              <button key={l} type="button" onClick={() => (l === '会员神券包' ? onOpenCoupons() : onToast(`${l}（演示）`))} className="relative py-2.5 text-center active:opacity-70">
                {i === 0 && <span className="absolute -right-1 -top-1.5 rounded-full rounded-bl-none bg-[#FF3B30] px-1 py-px text-[8px] font-bold text-white">待领取</span>}
                <span className="mx-auto grid h-[22px] w-[22px] place-items-center">
                  <Icon className="h-[22px] w-[22px] text-[#5A4200]" strokeWidth={1.9} />
                </span>
                <span className="mt-1 block text-[11px] text-[#5A4200]">{l} ›</span>
              </button>
            ))}
          </div>
          <div className="mt-2.5 flex items-center px-3 py-2">
            {[
              ['¥12', '外卖大额神券'],
              ['¥11', '堂食膨胀神券'],
              ['¥7', '堂食神券'],
            ].map(([p, l], i) => (
              <button key={l} type="button" onClick={onOpenCoupons} className={`flex flex-1 flex-col items-center ${i > 0 ? 'border-l border-[#5A4200]/10' : ''}`}>
                <span className="text-[15px] font-bold text-[#5A4200]">{p}</span>
                <span className="text-[9px] text-[#5A4200]/60">{l}</span>
              </button>
            ))}
            <div className="ml-1 flex flex-col items-center gap-1 border-l border-[#5A4200]/10 pl-2.5">
              <span className="text-[10px] font-medium text-[#5A4200]">每日领券</span>
              <button type="button" onClick={onClaimCoupons} className="rounded-full bg-[#FFD100] px-2.5 py-1 text-[10px] font-semibold text-black/85 active:opacity-80">
                一键领取
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 功能宫格（白底直排，无圆角面板；收藏/浏览记录为真实页面，红包卡券/美团币演示） */}
      <div className="grid grid-cols-4 gap-y-4 px-2 pb-4 pt-1">
        {([
          [Star, '收藏', null, () => onOpenFavorites()],
          [Eye, '浏览记录', null, () => onOpenHistory()],
          [Ticket, '红包卡券', null, () => onOpenCoupons()],
          [Coins, '美团币', '1', () => onToast('美团币（演示）')],
        ] as [LucideIcon, string, string | null, () => void][]).map(([Icon, l, badge, tap]) => (
          <button key={l} type="button" onClick={tap} className="flex flex-col items-center gap-1.5 active:opacity-70">
            <span className="relative">
              <Icon className="h-[22px] w-[22px] text-black/75" strokeWidth={1.8} />
              {badge && <span className="absolute -right-2 -top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[#FF3B30] px-1 text-[9px] font-bold text-white">{badge}</span>}
            </span>
            <span className="text-[11px] text-black/70">{l}</span>
          </button>
        ))}
      </div>

      {/* 订单 */}
      <div className="border-t-[7px] border-[#F7F8FA] px-4 py-3.5">
        <p className="text-[16px] font-bold text-black/85">订单</p>
        <div className="mt-3 grid grid-cols-4">
          {cell(Receipt, '全部订单', null, () => onOpenOrders('全部'))}
          {cell(ClockIcon, '待收货/使用', inFlight, () => onOpenOrders('待收货/待使用'))}
          {cell(MessageCircleMore, '待评价', null, () => onOpenOrders('评价'))}
          {cell(Wallet, '退款售后', null, () => onOpenOrders('退款/售后'))}
        </div>
      </div>

      {/* 钱包 */}
      <div className="border-t-[7px] border-[#F7F8FA] px-4 py-3.5">
        <div className="flex items-center">
          <p className="text-[16px] font-bold text-black/85">钱包</p>
          <button type="button" onClick={() => onToast('钱包（演示）')} className="ml-auto flex items-center text-[12px] text-black/40">
            查看全部
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2.5 grid grid-cols-4">
          {[
            ['***', '美团借钱', '随借随还'],
            ['9.98万', '我的卡额度', '免费申领'],
            ['2.90元', '实名认证', '待完善'],
            ['1笔', '购药抵扣金', '去查看'],
          ].map(([v, l, s]) => (
            <button key={l} type="button" onClick={() => onToast(`${l}（演示）`)} className="flex flex-col items-center gap-0.5 active:opacity-70">
              <span className="relative text-[16px] font-bold leading-tight text-black/85">
                {v}
                {l === '实名认证' && <span className="absolute -right-4 -top-2 rounded-full rounded-bl-none bg-[#FF3B30] px-1 py-px text-[8px] font-bold text-white">去查看</span>}
              </span>
              <span className="text-[11px] text-black/70">{l}</span>
              <span className="text-[9px] text-black/35">{s}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 服务宫格 */}
      <div className="grid grid-cols-4 gap-y-4 border-t-[7px] border-[#F7F8FA] px-2 py-3.5">
        {([
          [Receipt, '开发票'],
          [MessageCircleMore, '小美评审团'],
          [Heart, '我的公益'],
          [Handshake, '入驻美团'],
          [Store, '添加商户'],
          [HardHat, '工作兼职'],
          [Leaf, '我的碳账户'],
          [LayoutGrid, '更多工具'],
        ] as [LucideIcon, string][]).map(([Icon, l]) => (
          <button key={l} type="button" onClick={() => onToast(`${l}（演示）`)} className="flex flex-col items-center gap-1.5 active:opacity-70">
            <Icon className="h-[22px] w-[22px] text-black/75" strokeWidth={1.8} />
            <span className="text-[11px] text-black/70">{l}</span>
          </button>
        ))}
      </div>

      {/* 账号管理已移至「设置」（收货地址/切换账号/退出登录） */}
      <p className="py-4 text-center text-[10px] text-black/25">美团 v10.18.0 · 数据仅保存在本机 · 按账号隔离 · {idpLabel}</p>
    </div>
  );
}

// ================================ 设置页（截图3：收货地址/切换账号/退出登录迁入） ================================

function SettingsRow({ label, value, onClick, danger }: { label: string; value?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center px-4 py-[17px] text-left active:bg-black/[0.03]">
      <span className={`flex-1 text-[15px] ${danger ? 'font-medium text-[#FF4B33]' : 'text-black/85'}`}>{label}</span>
      {value && <span className="pr-1.5 text-[13px] text-black/35">{value}</span>}
      {!danger && <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/25" />}
    </button>
  );
}

function SettingsPage({
  session,
  onBack,
  onOpenAddresses,
  onOpenAbout,
  onLogout,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  onOpenAddresses: () => void;
  onOpenAbout: () => void;
  onLogout: () => void;
  onToast: (m: string) => void;
}) {
  const idpLabel = session.idp === 'wx' ? '微信账号' : session.idp === 'qq' ? 'QQ账号' : `手机用户 ${session.phone ?? ''}`;
  return (
    <div className="flex h-full flex-col bg-white">
      {/* 顶栏：返回 + 居中标题 */}
      <div className="relative grid h-[110px] shrink-0 place-items-center border-b border-black/[0.04] pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="absolute left-1 top-[54px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
        </button>
        <p className="text-[19px] font-semibold text-black/90">设置</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="divide-y divide-black/[0.04] px-4">
          <SettingsRow label="个人信息" value={session.name} onClick={() => onToast('个人信息（演示）')} />
          <SettingsRow label="收货地址" onClick={onOpenAddresses} />
        </div>

        <div className="mt-2 divide-y divide-black/[0.04] border-t-[7px] border-[#F5F6F7] px-4 pt-1">
          <SettingsRow label="账号安全" value="实名待完善" onClick={() => onToast('账号安全（演示）')} />
          <SettingsRow label="隐私设置" onClick={() => onToast('隐私设置（演示）')} />
        </div>

        <div className="mt-2 divide-y divide-black/[0.04] border-t-[7px] border-[#F5F6F7] px-4 pt-1">
          <SettingsRow label="支付设置" onClick={() => onToast('支付设置（演示）')} />
          <SettingsRow label="消息通知" onClick={() => onToast('消息通知（演示）')} />
          <SettingsRow label="通用设置" onClick={() => onToast('通用设置（演示）')} />
          <SettingsRow label="清理缓存" onClick={() => onToast('已清理完成，存储空间更清爽')} />
        </div>

        <div className="mt-2 divide-y divide-black/[0.04] border-t-[7px] border-[#F5F6F7] px-4 pt-1">
          <SettingsRow label="长辈版" value="未开启" onClick={() => onToast('长辈版（演示）')} />
          <SettingsRow label="未成年人模式" value="未开启" onClick={() => onToast('未成年人模式（演示）')} />
          <SettingsRow label="语言切换/Language" value="简体中文" onClick={() => onToast('语言切换（演示）')} />
        </div>

        <div className="mt-2 divide-y divide-black/[0.04] border-t-[7px] border-[#F5F6F7] px-4 pt-1">
          <SettingsRow label="关于美团" value="当前已是最新版本" onClick={onOpenAbout} />
          <SettingsRow label="意见反馈" onClick={() => onToast('意见反馈（演示）')} />
        </div>

        {/* 账号管理（需求：切换账号/退出登录移至设置；白底直排无面板） */}
        <div className="mt-2 divide-y divide-black/[0.04] border-t-[7px] border-[#F5F6F7] px-4 pt-1">
          <SettingsRow label="切换账号" onClick={onLogout} />
          <SettingsRow label="退出登录" danger onClick={onLogout} />
        </div>

        <p className="py-5 text-center text-[10px] text-black/25">美团 v10.18.0 · 数据仅保存在本机 · 按账号隔离 · {idpLabel}</p>
      </div>
    </div>
  );
}

// ================================ 收藏页（截图1：页签 商户/团购/商品菜品/内容/其他 + 白色圆角内容板 + 黄放大镜空态） ================================

type FavTab = 'store' | 'deal' | 'dish' | 'content' | 'other';

const FAV_TABS: { key: FavTab; label: string }[] = [
  { key: 'store', label: '商户' },
  { key: 'deal', label: '团购' },
  { key: 'dish', label: '商品/菜品' },
  { key: 'content', label: '内容' },
  { key: 'other', label: '其他' },
];

/** 空态插画（黄色放大镜趴在灰色小丘上 + Z z，纯 CSS/SVG 无 emoji，对齐截图1） */
function FavEmptyIllust() {
  return (
    <div className="relative mx-auto h-[150px] w-[190px]" aria-hidden="true">
      {/* 小丘 */}
      <span className="absolute bottom-1 left-1/2 h-[70px] w-[170px] -translate-x-1/2 rounded-[50%] bg-gradient-to-b from-[#ECEDEF] to-[#F8F9FA]" />
      {/* 放大镜镜片 */}
      <span className="absolute left-[58px] top-[26px] h-[58px] w-[58px] rotate-[14deg] rounded-full border-[9px] border-[#FFC300] bg-gradient-to-br from-white to-[#FFF7DC] shadow-[0_2px_6px_rgba(180,120,0,0.18)]" />
      {/* 镜片高光 */}
      <span className="absolute left-[74px] top-[38px] h-3.5 w-3.5 rotate-[14deg] rounded-full bg-white/90" />
      {/* 镜柄 */}
      <span className="absolute left-[122px] top-[86px] h-[34px] w-[10px] rotate-[48deg] rounded-full bg-gradient-to-b from-[#FFC300] to-[#F0A800]" />
      {/* Z z（睡觉感） */}
      <span className="absolute right-[38px] top-[6px] text-[18px] font-bold text-black/20">z</span>
      <span className="absolute right-[16px] top-[30px] text-[12px] font-bold text-black/15">z</span>
    </div>
  );
}

function FavoritesPage({
  session,
  onBack,
  onOpenMerchant,
  onOpenDeal,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  onOpenMerchant: (id: string) => void;
  onOpenDeal: (id: string) => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const [, setVer] = useState(0);
  const [tab, setTab] = useState<FavTab>('store');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const favs = mtLoadFavs(uid);

  // 收藏的团购
  const favDeals = favs.deals.map((id) => MT_DEALS.find((d) => d.id === id)).filter((d): d is MtDeal => Boolean(d));
  // 收藏的菜品 → 按归属商家分组（商家卡内菜品行）
  const dishOwners = new Map<string, { m: MtMerchant; d: MtDish }>();
  for (const m of MT_MERCHANTS) {
    for (const d of mtDishesOf(m)) dishOwners.set(d.id, { m, d });
  }
  const dishGroups = new Map<string, { m: MtMerchant; dishes: MtDish[] }>();
  for (const id of favs.dishes) {
    const own = dishOwners.get(id);
    if (!own) continue;
    const g = dishGroups.get(own.m.id);
    if (g) g.dishes.push(own.d);
    else dishGroups.set(own.m.id, { m: own.m, dishes: [own.d] });
  }
  // 纯商家收藏
  const storeOnly = favs.stores.map((id) => mtMerchantOf(id)).filter((m): m is MtMerchant => Boolean(m));

  const qtyOf = (id: string) => qtyMap[id] ?? 1;
  const setQty = (id: string, q: number) => setQtyMap((m) => ({ ...m, [id]: Math.min(9, Math.max(1, q)) }));
  const toggleSel = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSel(next);
  };
  const unfav = (ids: string[]) => {
    for (const id of ids) mtToggleFav(uid, 'dishes', id);
    setSel(new Set());
    setVer((v) => v + 1);
  };
  const addSelectedToCart = () => {
    const selArr = [...sel];
    const first = dishOwners.get(selArr[0]);
    if (!first) return;
    const mid = first.m.id;
    const inMerchant = selArr.filter((id) => dishOwners.get(id)?.m.id === mid);
    const cart = mtLoadCart(uid);
    const merged = new Map(cart.merchantId === mid ? cart.items.map((i) => [i.dishId, i.qty]) : []);
    for (const id of inMerchant) merged.set(id, (merged.get(id) ?? 0) + qtyOf(id));
    const switched = cart.items.length > 0 && cart.merchantId !== mid;
    mtSaveCart(uid, { merchantId: mid, items: [...merged.entries()].map(([dishId, qty]) => ({ dishId, qty })) });
    setSel(new Set());
    window.dispatchEvent(new CustomEvent('mt-cart-changed'));
    onToast(switched ? '已切换商家并加入购物车' : '已加入购物车');
  };

  const tabEmpty: Record<FavTab, boolean> = {
    store: storeOnly.length === 0,
    deal: favDeals.length === 0,
    dish: dishGroups.size === 0,
    content: true,
    other: true,
  };
  const CircleCheckBtn = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button type="button" aria-label={on ? '取消选择' : '选择'} onClick={onClick} className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${on ? 'bg-[#FFC300]' : 'border border-black/20 bg-white'}`}>
      {on && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
    </button>
  );

  return (
    <div className="relative flex h-full flex-col bg-white">
      {/* 顶栏：返回 + 标题 + 搜索/购物车（对齐截图1） */}
      <div className="relative grid h-[100px] shrink-0 place-items-center border-b border-black/[0.04] pt-[50px]">
        <button type="button" aria-label="返回" onClick={onBack} className="absolute left-1 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
        </button>
        <p className="text-[19px] font-semibold text-black/90">收藏</p>
        <span className="absolute right-3 top-[50px] flex items-center gap-1">
          <button type="button" aria-label="搜索收藏" onClick={() => onToast('收藏搜索（演示）')} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <SearchIcon className="h-[19px] w-[19px] text-black/75" strokeWidth={2.1} />
          </button>
          <button type="button" aria-label="购物车" onClick={() => onToast('请到底部「购物车」查看')} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <ShoppingCart className="h-[19px] w-[19px] text-black/75" strokeWidth={2.1} />
          </button>
        </span>
      </div>

      {/* 页签（激活项黑色加粗 + 黄色下划线） */}
      <div className="flex shrink-0 items-end gap-6 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FAV_TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`relative shrink-0 pb-1.5 transition-colors ${tab === t.key ? 'text-[19px] font-bold text-black/90' : 'text-[16px] text-black/45'}`}>
            {t.label}
            {tab === t.key && <span className="absolute inset-x-1 bottom-0 mx-auto h-[3px] w-6 rounded-full bg-[#FFC300]" />}
          </button>
        ))}
      </div>

      {/* 内容区（白底直排，无圆角面板） */}
      <div className="min-h-0 flex-1 overflow-hidden bg-white">
        <div className="h-full overflow-y-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* ===== 空态（黄放大镜插画 + 暂未收藏"X"） ===== */}
          {tabEmpty[tab] ? (
            <div className="pt-16 text-center">
              <FavEmptyIllust />
              <p className="mt-5 text-[19px] font-bold text-black/85">暂未收藏“{FAV_TABS.find((t) => t.key === tab)?.label}”</p>
              <p className="mt-2 text-[14px] text-black/35">去看看别的收藏类型吧</p>
              {tab === 'store' && (
                <button type="button" onClick={onBack} className="mt-5 rounded-full bg-[#FFD100] px-7 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
                  去逛逛
                </button>
              )}
            </div>
          ) : tab === 'store' ? (
            /* ===== 商户收藏（商户卡：门头图 + 名称 + 评分/月售 + 距离/配送 + 分类） ===== */
            <div className="pt-2">
              {storeOnly.map((m) => (
                <div key={m.id} className="flex items-start gap-3 border-b border-black/[0.04] p-3 last:border-b-0">
                  <button type="button" onClick={() => onOpenMerchant(m.id)} className="shrink-0 active:opacity-80">
                    <FoodImg src={m.cover} emoji={m.emoji} className="h-[76px] w-[76px] rounded-xl" />
                  </button>
                  <button type="button" onClick={() => onOpenMerchant(m.id)} className="min-w-0 flex-1 text-left active:opacity-80">
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[17px] font-bold text-black/90">{m.name}</span>
                      <span className={`shrink-0 rounded-[4px] px-1 py-px text-[10px] font-medium ${m.cats.includes('waimai') ? 'bg-[#FFD100] text-black/80' : 'bg-[#FF6000] text-white'}`}>
                        {m.cats.includes('waimai') ? '外卖' : '到店'}
                      </span>
                    </span>
                    <span className="mt-1.5 flex items-center text-[13px]">
                      <Star className="mr-0.5 inline h-3.5 w-3.5 fill-[#FF6000] text-[#FF6000]" strokeWidth={0} />
                      <span className="font-semibold text-[#FF6000]">{m.rating}</span>
                      <span className="ml-2 text-black/45">月售{m.monthSale >= 10000 ? `${(m.monthSale / 10000).toFixed(1)}万` : m.monthSale}</span>
                      <span className="ml-auto text-black/45">
                        {m.deliveryMin}分钟 {m.distanceKm}km
                      </span>
                    </span>
                    <span className="mt-1.5 block truncate text-[13px] text-black/40">{m.cats.map((c) => MT_CATS.find((x) => x.id === c)?.name ?? c).slice(0, 2).join('  ')}</span>
                  </button>
                  <button type="button" aria-label="取消收藏商家" onClick={() => { mtToggleFav(uid, 'stores', m.id); setVer((v) => v + 1); onToast('已取消收藏商家'); }} className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full active:bg-black/5">
                    <Star className="h-[18px] w-[18px] fill-[#FFB800] text-[#FFB800]" strokeWidth={0} />
                  </button>
                </div>
              ))}
            </div>
          ) : tab === 'deal' ? (
            /* ===== 团购收藏（白底直排行） ===== */
            <div>
              {favDeals.map((d) => (
                <div key={d.id} className="flex items-center gap-3 border-b border-black/[0.04] p-3.5 last:border-b-0">
                  <button type="button" onClick={() => onOpenDeal(d.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-80">
                    <FoodImg src={d.img} emoji={d.emoji} className="h-16 w-16 shrink-0 rounded-xl" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-[14px] font-semibold text-black/85">{d.title}</span>
                      <span className="mt-1 block truncate text-[11px] text-black/40">{d.tips} · {d.praise}</span>
                      <span className="mt-0.5 block text-[15px] font-bold" style={{ color: MT_PRICE }}>
                        ¥{fmtMoney(d.price)} <span className="text-[11px] font-normal text-black/30 line-through">¥{fmtMoney(d.origPrice)}</span>
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
                  </button>
                  <button type="button" aria-label="取消收藏" onClick={() => { mtToggleFav(uid, 'deals', d.id); setVer((v) => v + 1); onToast('已取消收藏'); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-full active:bg-black/5">
                    <Star className="h-[18px] w-[18px] fill-[#FFB800] text-[#FFB800]" strokeWidth={0} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            /* ===== 商品/菜品收藏（商家卡内勾选/步进，可加购；白底直排） ===== */
            <div>
              {[...dishGroups.values()].map(({ m, dishes }) => (
                <div key={m.id} className="border-b border-black/[0.04] px-3.5 py-3 last:border-b-0">
                  <button type="button" onClick={() => onOpenMerchant(m.id)} className="flex w-full items-center gap-2 text-left active:opacity-70">
                    <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg">
                      <FoodImg src={m.cover} emoji={m.emoji} className="h-full w-full" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[16px] font-bold text-black/90">{m.name}</span>
                    <span className="shrink-0 text-[11px] text-black/35">
                      <Star className="mr-0.5 inline h-3 w-3 fill-[#FF6000] text-[#FF6000]" strokeWidth={0} />
                      {m.rating} · {m.distanceKm}km
                    </span>
                    <ChevronRight className="h-[18px] w-[18px] shrink-0 text-black/30" />
                  </button>
                  <div className="mt-1 space-y-3.5 border-t border-black/[0.05] pt-3">
                    {dishes.map((d) => (
                      <div key={d.id} className="flex items-center gap-3">
                        <CircleCheckBtn on={sel.has(d.id)} onClick={() => toggleSel(d.id)} />
                        <FoodImg src={d.img} emoji={d.emoji} className="h-[60px] w-[60px] shrink-0 rounded-lg" />
                        <div className="flex min-w-0 flex-1 flex-col self-stretch">
                          <p className="line-clamp-1 text-[15px] font-medium text-black/85">{d.name}</p>
                          <p className="mt-auto text-[19px] font-bold" style={{ color: MT_PRICE }}>
                            <span className="text-[12px]">¥</span>
                            {fmtMoney(d.price)}
                          </p>
                        </div>
                        <Stepper qty={qtyOf(d.id)} onAdd={() => setQty(d.id, qtyOf(d.id) + 1)} onDec={() => setQty(d.id, qtyOf(d.id) - 1)} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 底部操作条（选中菜品后出现） */}
      {tab === 'dish' && sel.size > 0 && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2.5 border-t border-black/[0.06] bg-white/95 px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur">
          <button type="button" onClick={() => unfav([...sel])} className="h-11 rounded-full border border-[#FF4B33]/40 px-5 text-[14px] text-[#FF4B33] active:bg-black/5">
            取消收藏({sel.size})
          </button>
          <span className="flex-1" />
          <button type="button" onClick={addSelectedToCart} className="h-11 rounded-full bg-[#FFD100] px-8 text-[16px] font-semibold text-black/90 shadow active:opacity-85">
            加入购物车({sel.size})
          </button>
        </div>
      )}
    </div>
  );
}
// ================================ 浏览记录页（截图2：页签 商户/团购 + 周日期条 + 今天分组商户卡） ================================

type HistTab = 'merchant' | 'deal';

const WEEK_HEADS = ['日', '一', '二', '三', '四', '五', '六'];

/** 商户卡右侧分类名（取第一个分类） */
const mtCatNameOf = (m: MtMerchant): string => MT_CATS.find((c) => c.id === m.cats[0])?.name ?? '';

function HistoryPage({
  session,
  onBack,
  onOpenMerchant,
  onOpenDeal,
  onToast,
}: {
  session: MtSession;
  onBack: () => void;
  onOpenMerchant: (id: string) => void;
  onOpenDeal: (id: string) => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  const [, setVer] = useState(0);
  const [tab, setTab] = useState<HistTab>('merchant');
  const [manage, setManage] = useState(false);
  const [stripOpen, setStripOpen] = useState(true);
  const [dayOffset, setDayOffset] = useState<number | null>(null); // null=全部，0=今天，1=昨天…

  const hist = mtLoadHistory(uid);

  // 本周日历（周日起，对齐截图「日一二三四五六」+「今」高亮）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sunday = new Date(today);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  const weekDays = WEEK_HEADS.map((head, i) => {
    const d = new Date(sunday);
    d.setDate(d.getDate() + i);
    const isToday = d.getTime() === today.getTime();
    const start = d.getTime();
    const end = start + 86400_000;
    return {
      head,
      label: isToday ? '今' : String(d.getDate()),
      isToday,
      offset: Math.round((today.getTime() - start) / 86400_000),
      hasRecord: hist.some((h) => h.at >= start && h.at < end),
    };
  });

  const tabItems = hist.filter((h) => (tab === 'merchant' ? h.kind === 'merchant' : h.kind === 'deal'));
  const filtered = dayOffset === null ? tabItems : tabItems.filter((h) => h.at >= today.getTime() - (dayOffset + 1) * 86400_000 + 86400_000 - 86400_000 && h.at < today.getTime() - dayOffset * 86400_000 + 86400_000);

  // 按天分组（今天/昨天/M月D日）
  const groupsMap = new Map<number, MtHistItem[]>();
  for (const h of filtered) {
    const day = Math.floor(h.at / 86400_000);
    const g = groupsMap.get(day);
    if (g) g.push(h);
    else groupsMap.set(day, [h]);
  }
  const groups = [...groupsMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([day, items]) => {
      const label = day === Math.floor(today.getTime() / 86400_000) ? '今天' : day === Math.floor(today.getTime() / 86400_000) - 1 ? '昨天' : (() => {
        const d = new Date(day * 86400_000);
        return `${d.getMonth() + 1}月${d.getDate()}日`;
      })();
      return { label, items };
    });

  const removeOne = (kind: string, id: string) => {
    mtRemoveHistory(uid, kind === 'deal' ? 'deal' : 'merchant', id);
    setVer((v) => v + 1);
    onToast('已删除该条记录');
  };
  const clearAll = () => {
    mtClearHistory(uid);
    setManage(false);
    setVer((v) => v + 1);
    onToast('浏览记录已清空');
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 顶栏：返回 + 标题 + 管理 */}
      <div className="relative grid h-[100px] shrink-0 place-items-center border-b border-black/[0.04] pt-[50px]">
        <button type="button" aria-label="返回" onClick={onBack} className="absolute left-1 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
        </button>
        <p className="text-[19px] font-semibold text-black/90">浏览记录</p>
        <button
          type="button"
          onClick={() => setManage((m) => !m)}
          className="absolute right-4 top-[54px] text-[15px] text-black/75 active:opacity-60"
        >
          {manage ? '完成' : '管理'}
        </button>
      </div>

      {/* 页签 */}
      <div className="flex shrink-0 items-end gap-6 px-4 pb-2">
        {([
          { key: 'merchant', label: '商户' },
          { key: 'deal', label: '团购' },
        ] as { key: HistTab; label: string }[]).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setDayOffset(null);
            }}
            className={`relative shrink-0 pb-1.5 transition-colors ${tab === t.key ? 'text-[19px] font-bold text-black/90' : 'text-[16px] text-black/45'}`}
          >
            {t.label}
            {tab === t.key && <span className="absolute inset-x-1 bottom-0 mx-auto h-[3px] w-6 rounded-full bg-[#FFC300]" />}
          </button>
        ))}
      </div>

      {/* 内容区（白底直排，无圆角面板） */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
        <div className="h-full overflow-y-auto pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* 周日期条（今高亮黄框+黄点；有记录的日期下方小黄点） */}
          {stripOpen && tabItems.length > 0 && (
            <div className="px-1 pt-3">
              <div className="grid grid-cols-7">
                {weekDays.map((d) => (
                  <button key={d.head + d.label} type="button" onClick={() => setDayOffset(dayOffset === d.offset ? null : d.offset)} className="flex flex-col items-center gap-1 py-1 active:opacity-70">
                    <span className={`text-[12px] ${d.isToday ? 'text-black/85' : 'text-black/40'}`}>{d.head}</span>
                    <span
                      className={`grid h-9 w-9 place-items-center rounded-xl text-[16px] ${
                        dayOffset === d.offset ? 'bg-[#FFF7CC] font-semibold text-black/90' : d.isToday ? 'rounded-xl border border-[#F0C900] bg-[#FFFBE0] font-semibold text-black/90' : 'text-black/75'
                      }`}
                    >
                      {d.label}
                    </span>
                    <span className={`h-[3px] w-[3px] rounded-full ${d.hasRecord ? 'bg-[#F0C900]' : 'bg-transparent'}`} />
                  </button>
                ))}
              </div>
              {dayOffset !== null && (
                <p className="pb-1 text-center text-[12px] text-black/40">
                  仅看{weekDays.find((d) => d.offset === dayOffset)?.isToday ? '今天' : '该日'}记录 · 点击日期可取消
                </p>
              )}
            </div>
          )}

          {/* 收起/展开日期条 */}
          {tabItems.length > 0 && (
            <div className="flex justify-center py-1.5">
              <button type="button" aria-label={stripOpen ? '收起日期' : '展开日期'} onClick={() => setStripOpen((s) => !s)} className="grid h-8 w-8 place-items-center rounded-full bg-[#F5F6F7] active:bg-black/10">
                <ChevronDown className={`h-4.5 w-4.5 text-black/55 transition-transform ${stripOpen ? '' : 'rotate-180'}`} />
              </button>
            </div>
          )}

          {/* 列表 */}
          {tabItems.length === 0 ? (
            <div className="pt-16 text-center">
              <p className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#F5F6F7]">
                <Eye className="h-7 w-7 text-black/25" strokeWidth={1.8} />
              </p>
              <p className="mt-3 text-[14px] text-black/45">暂无浏览记录</p>
              <p className="mt-1 text-[12px] text-black/30">逛过的商家和团购会出现在这里</p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="pt-16 text-center text-[13px] text-black/40">这一天没有浏览记录</p>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="mt-2">
                <p className="px-1 pb-1 pt-2 text-[17px] font-bold text-black/90">{g.label}</p>
                <div>
                  {g.items.map((h) => {
                    const delBtn = manage ? (
                      <button type="button" aria-label="删除" onClick={() => removeOne(h.kind, h.id)} className="mt-5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#F5F6F7] active:bg-black/10">
                        <Minus className="h-4 w-4 text-black/45" strokeWidth={2.4} />
                      </button>
                    ) : null;
                    if (h.kind === 'merchant') {
                      const m = mtMerchantOf(h.id);
                      if (!m) return null;
                      return (
                        <div key={`${h.kind}-${h.id}`} className="flex items-start gap-3 border-b border-black/[0.04] p-3 last:border-b-0">
                          <button type="button" onClick={() => onOpenMerchant(m.id)} className="shrink-0 active:opacity-80">
                            <FoodImg src={m.cover} emoji={m.emoji} className="h-[76px] w-[76px] rounded-xl" />
                          </button>
                          <button type="button" onClick={() => onOpenMerchant(m.id)} className="min-w-0 flex-1 text-left active:opacity-80">
                            <span className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate text-[17px] font-bold text-black/90">{m.name}</span>
                              <span className={`shrink-0 rounded-[4px] px-1 py-px text-[10px] font-medium ${m.cats.includes('waimai') ? 'bg-[#FFD100] text-black/80' : 'bg-[#FF6000] text-white'}`}>
                                {m.cats.includes('waimai') ? '外卖' : '到店'}
                              </span>
                            </span>
                            <span className="mt-1.5 flex items-center text-[13px]">
                              <Star className="mr-0.5 inline h-3.5 w-3.5 fill-[#FF6000] text-[#FF6000]" strokeWidth={0} />
                              <span className="font-semibold text-[#FF6000]">{m.rating}</span>
                              <span className="ml-2 text-black/45">月售{m.monthSale >= 10000 ? `${(m.monthSale / 10000).toFixed(1)}万` : m.monthSale}</span>
                              <span className="ml-auto text-black/45">
                                {m.deliveryMin}分钟 {m.distanceKm}km
                              </span>
                            </span>
                            <span className="mt-1.5 flex items-center justify-between">
                              <span className="truncate text-[13px] text-black/40">{mtCatNameOf(m)}</span>
                              <span className="shrink-0 text-[11px] text-black/30">{fmtTime(h.at)}</span>
                            </span>
                          </button>
                          {delBtn}
                        </div>
                      );
                    }
                    const d = MT_DEALS.find((x) => x.id === h.id);
                    if (!d) return null;
                    return (
                      <div key={`${h.kind}-${h.id}`} className="flex items-start gap-3 border-b border-black/[0.04] p-3 last:border-b-0">
                        <button type="button" onClick={() => onOpenDeal(d.id)} className="shrink-0 active:opacity-80">
                          <FoodImg src={d.img} emoji={d.emoji} className="h-[76px] w-[76px] rounded-xl" />
                        </button>
                        <button type="button" onClick={() => onOpenDeal(d.id)} className="min-w-0 flex-1 text-left active:opacity-80">
                          <span className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-[17px] font-bold text-black/90">{d.title}</span>
                            <span className="shrink-0 rounded-[4px] bg-[#FFEBF3] px-1 py-px text-[10px] font-medium text-[#FF2D7E]">团购</span>
                          </span>
                          <span className="mt-1.5 flex items-center text-[13px]">
                            <span className="font-semibold text-[#FF6000]">{d.discount}</span>
                            <span className="ml-2 text-black/45">{d.sold}</span>
                            <span className="ml-auto text-black/45">{d.tips}</span>
                          </span>
                          <span className="mt-1.5 flex items-center justify-between">
                            <span className="text-[15px] font-bold" style={{ color: MT_PRICE }}>
                              ¥{fmtMoney(d.price)} <span className="text-[11px] font-normal text-black/30 line-through">¥{fmtMoney(d.origPrice)}</span>
                            </span>
                            <span className="shrink-0 text-[11px] text-black/30">{fmtTime(h.at)}</span>
                          </span>
                        </button>
                        {delBtn}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {/* 尾注 */}
          {tabItems.length > 0 && filtered.length > 0 && <p className="py-4 text-center text-[13px] text-black/30">- 没有更多了 -</p>}

          {/* 管理模式：清空全部 */}
          {manage && tabItems.length > 0 && (
            <button type="button" onClick={clearAll} className="mx-4 mb-2 mt-3 flex items-center justify-center gap-1.5 rounded-full border border-[#FF4B33]/30 py-3 text-[14px] text-[#FF4B33] active:bg-[#FFF4F0]">
              <Trash2 className="h-4 w-4" /> 清空全部浏览记录
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
// ================================ 退款申请弹层（退款售后） ================================

const REFUND_REASONS = ['不想要了', '商家超时未接单', '骑手配送太慢', '餐品洒漏/包装破损', '商家告知缺货', '其他原因'];

function RefundApplySheet({ order, onClose, onToast }: { order: MtOrder; onClose: () => void; onToast: (m: string) => void }) {
  const session = mtGetSession();
  const uid = session ? mtUidOf(session) : '';
  const [reason, setReason] = useState(REFUND_REASONS[0]);
  const [note, setNote] = useState('');

  const submit = () => {
    if (!uid) {
      onToast('登录状态异常，请重试');
      return;
    }
    if (mtApplyRefund(uid, order.id, reason, note)) {
      onToast('退款申请已提交，等待商家审核');
      onClose();
    } else {
      onToast('该订单暂无法申请退款');
    }
  };

  return (
    <motion.div className="absolute inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      {/* 点击弹窗外任意区域关闭 */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[20px] bg-white"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', ease: [0.32, 0.72, 0, 1], duration: 0.32 }}
      >
        <div className="relative flex shrink-0 items-center justify-center bg-white px-3 pb-2.5 pt-4">
          <span className="absolute left-1/2 top-[7px] h-1 w-9 -translate-x-1/2 rounded-full bg-black/12" aria-hidden="true" />
          <p className="text-[16px] font-semibold text-black/85">申请退款</p>
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-3 grid h-8 w-8 place-items-center rounded-full bg-black/[0.05] active:bg-black/10">
            <X className="h-4 w-4 text-black/60" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="mt-1 flex items-center justify-between bg-[#FFF7F3] px-4 py-3">
            <span className="text-[14px] text-black/70">退款金额</span>
            <span className="text-[20px] font-bold" style={{ color: MT_PRICE }}>
              ¥{order.total.toFixed(2)}
            </span>
          </div>
          <p className="mt-1 px-1 text-[11px] text-black/35">退款将原路退回您的支付账户（{order.payChannelLabel ?? (order.payIdp === 'qq' ? 'QQ钱包' : '微信支付')}）</p>

          <p className="mt-4 text-[14px] font-semibold text-black/80">退款原因</p>
          <div className="mt-1.5 divide-y divide-black/[0.04]">
            {REFUND_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className="flex w-full items-center py-3 text-left active:bg-black/[0.02]">
                <span className={`flex-1 text-[14px] ${reason === r ? 'font-medium text-black/90' : 'text-black/65'}`}>{r}</span>
                <span className={`grid h-[19px] w-[19px] place-items-center rounded-full ${reason === r ? 'bg-[#FFC300]' : 'border border-black/20'}`}>
                  {reason === r && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
                </span>
              </button>
            ))}
          </div>

          <p className="mt-3 text-[14px] font-semibold text-black/80">补充说明</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 60))}
            rows={2}
            placeholder="选填，最多60字"
            className="mt-1.5 w-full resize-none rounded-xl bg-[#F5F6F7] p-3 text-[13px] outline-none placeholder:text-black/25"
          />
        </div>

        <div className="shrink-0 border-t border-black/5 bg-white px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button type="button" onClick={submit} className="h-12 w-full rounded-full bg-[#FFD100] text-[16px] font-semibold text-black/90 shadow-sm active:opacity-85">
            提交申请
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ================================ 售后详情页（截图1/3：退款成功绿色卡 / 退款失败红色页） ================================

const REFUND_FAQS = ['查询退款进度', '查询退款退回账户', '我要删除订单', '优惠券是否可退', '能否撤销退款申请', '退款金额不对'];

/** 退款失败页的满意度评分（0-10 分 + 三档表情，对齐截图3） */
function RefundSatisfaction({ onToast }: { onToast: (m: string) => void }) {
  const [show, setShow] = useState(true);
  const [score, setScore] = useState<number | null>(null);
  if (!show) return null;
  return (
    <div className="border-t-[7px] border-[#F5F6F7] px-4 py-4">
      <div className="flex items-start">
        <p className="flex-1 text-[15px] font-bold text-black/85">您对本次退款体验满意吗?</p>
        <button type="button" aria-label="关闭" onClick={() => setShow(false)} className="grid h-6 w-6 place-items-center rounded-full text-black/30 active:bg-black/5">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between px-1">
        {[
          [Frown, '非常不满意'],
          [Meh, '一般'],
          [Laugh, '非常满意'],
        ].map(([Icon, label], i) => (
          <button key={label as string} type="button" onClick={() => onToast('感谢您的反馈')} className="flex items-center gap-1.5 active:opacity-60">
            <Icon className={`h-5 w-5 ${i === 2 ? 'text-[#FFB800]' : 'text-[#FFC46B]'}`} strokeWidth={1.8} />
            <span className="text-[13px] text-black/60">{label as string}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between px-0.5">
        {Array.from({ length: 11 }).map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              setScore(i);
              onToast(`已提交 ${i} 分评价，感谢反馈`);
            }}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] transition-colors ${
              score === i ? 'bg-[#FF6000] font-semibold text-white' : 'bg-[#F5F6F7] text-black/70 active:bg-black/10'
            }`}
          >
            {i}
          </button>
        ))}
      </div>
    </div>
  );
}

function RefundDetailPage({
  session,
  orderId,
  onBack,
  onToast,
}: {
  session: MtSession;
  orderId: string;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  useOrdersTick();
  const [open, setOpen] = useState(true);
  const order = mtGetOrder(uid, orderId);

  if (!order || !order.refund) {
    return (
      <div className="flex h-full flex-col bg-[#F5F6F7]">
        <div className="relative grid h-[100px] shrink-0 place-items-center pt-[50px]">
          <button type="button" aria-label="返回" onClick={onBack} className="absolute left-1 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
          </button>
          <p className="text-[19px] font-semibold text-black/90">售后详情</p>
        </div>
        <p className="mt-24 text-center text-[13px] text-black/40">该订单没有进行中的售后</p>
      </div>
    );
  }
  const r = order.refund;
  const done = r.status === 'approved';
  const failed = r.status === 'failed';
  const idpName = order.payIdp === 'qq' ? 'QQ钱包' : '微信';
  // 到账承诺：申请后 3 天内（对齐截图「预计最晚2026年05月14日前到账」）
  const expectDate = (() => {
    const d = new Date(r.appliedAt + 3 * 24 * 3600_000);
    return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`;
  })();

  // 退款流程时间线（新的在上）
  const flow: { title: string; body: string; at: number; danger?: boolean; link?: string }[] = failed
    ? [
        { title: r.failMsg ?? '退款过程中出现异常，退款失败', body: '', at: r.doneAt ?? r.appliedAt, danger: true, link: '查看详情' },
        { title: '退款受理完成', body: '', at: (r.doneAt ?? r.appliedAt + 21_000) - 20_000 },
        { title: '发起退款申请', body: '系统审核通过后将为您退款', at: r.appliedAt },
      ]
    : done
      ? [
          { title: '退款完成', body: `已成功退款至您的${order.payIdp === 'qq' ? 'QQ钱包' : '微信支付'}。如有疑问可拨打${idpName}客服电话95017。`, at: r.doneAt ?? r.appliedAt },
          { title: `${idpName}已受理退款`, body: `您的退款已被${idpName}成功受理`, at: (r.doneAt ?? r.appliedAt + 21_000) - 20_000 },
          { title: '美团审核通过', body: '美团已受理您的退款申请', at: r.appliedAt + 1000 },
          { title: '发起取消订单申请', body: '系统审核通过后将为您退款', at: r.appliedAt },
        ]
      : [
          { title: '商家审核中', body: '商家已收到您的退款申请，审核通过后原路退回', at: r.appliedAt },
          { title: '发起取消订单申请', body: '系统审核通过后将为您退款', at: r.appliedAt },
        ];
  const flowShown = open ? flow : flow.slice(0, 1);

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 顶栏：返回 + 居中标题 + 客服（失败页对齐截图3） */}
      <div className="relative grid h-[100px] shrink-0 place-items-center border-b border-black/[0.04] pt-[50px]">
        <button type="button" aria-label="返回" onClick={onBack} className="absolute left-1 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
        </button>
        <p className="text-[19px] font-semibold text-black/90">{failed ? '退款详情' : '售后详情'}</p>
        {failed && (
          <button type="button" aria-label="客服" onClick={() => onToast('美团客服：0539-000-0000（演示）')} className="absolute right-3 top-[50px] grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <Headset className="h-[20px] w-[20px] text-black/80" strokeWidth={1.8} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {failed ? (
          /* ===== 退款失败（截图3：红 X + 大金额 + 明细 + 进度 + 您可能想问 + 满意度） ===== */
          <>
            <div className="px-5 py-5">
              <div className="flex items-center gap-3">
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-[#F53F3F]">
                  <X className="h-[18px] w-[18px] text-white" strokeWidth={3} />
                </span>
                <p className="min-w-0 flex-1 text-[24px] font-bold leading-tight text-black/90">退款失败</p>
                <p className="shrink-0 text-[26px] font-bold text-[#F53F3F]">¥{r.amount.toFixed(2)}</p>
              </div>
              <div className="mt-1 text-right">
                <button type="button" onClick={() => setOpen((o) => !o)} className="text-[14px] text-black/55 active:opacity-60">
                  明细
                  <ChevronUp className={`ml-0.5 inline h-4 w-4 transition-transform ${open ? '' : 'rotate-180'}`} />
                </button>
              </div>
              {open && (
                <div className="mt-2 space-y-1.5 rounded-xl bg-[#F7F8FA] p-3.5 text-[13px]">
                  <p className="flex justify-between text-black/60">
                    <span>订单金额</span>
                    <span className="text-black/80">¥{order.total.toFixed(2)}</span>
                  </p>
                  <p className="flex justify-between text-black/60">
                    <span>退回渠道</span>
                    <span className="text-black/80">{r.channel ?? (order.payIdp === 'qq' ? 'QQ钱包' : '微信支付')}</span>
                  </p>
                  <p className="flex justify-between text-[#F53F3F]">
                    <span>退款失败金额</span>
                    <span>¥{r.amount.toFixed(2)}</span>
                  </p>
                </div>
              )}
            </div>

            {/* 退款进度 */}
            <div className="border-t-[7px] border-[#F5F6F7] px-4 py-4">
              <p className="text-[17px] font-bold text-black/85">退款进度</p>
              <div className="mt-3">
                {flow.map((f, i) => (
                  <div key={`${f.title}-${f.at}`} className="relative flex gap-3 pb-5 last:pb-0">
                    <span className="relative flex w-3 shrink-0 justify-center">
                      {i === 0 ? (
                        <span className="z-10 mt-1 h-[11px] w-[11px] rounded-full bg-[#F53F3F]" />
                      ) : (
                        <span className="z-10 mt-[7px] h-[7px] w-[7px] rounded-full bg-black/15" />
                      )}
                      {i < flow.length - 1 && <span className="absolute top-3 bottom-0 w-px bg-black/10" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`flex items-center gap-1.5 text-[15px] font-semibold ${i === 0 ? 'text-black/90' : 'text-black/45'}`}>
                        {f.title}
                        {i === 0 ? (
                          <button type="button" onClick={() => onToast('异常原因：收款账户状态异常，资金将退回美团余额')} className="text-[13px] font-normal text-[#4E6EF2] active:opacity-60">
                            {f.link} &gt;
                          </button>
                        ) : null}
                      </span>
                      {f.body && <span className="mt-1 block text-[13px] text-black/45">{f.body}</span>}
                      <span className="mt-1 block text-[12px] text-black/30">{fmtDateTime(f.at)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 您可能想问 */}
            <div className="border-t-[7px] border-[#F5F6F7] px-4 py-4">
              <div className="flex items-center">
                <p className="flex-1 text-[17px] font-bold text-black/85">您可能想问</p>
                <button type="button" onClick={() => onToast('更多问题请拨打客服电话（演示）')} className="text-[13px] text-black/45 active:opacity-60">
                  更多问题 &gt;
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2.5">
                {REFUND_FAQS.map((q) => (
                  <button key={q} type="button" onClick={() => onToast(`「${q}」演示入口`)} className="rounded-full bg-[#F5F6F7] px-4 py-2 text-[13px] text-black/70 active:bg-black/10">
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <RefundSatisfaction onToast={onToast} />
          </>
        ) : (
          /* ===== 退款成功 / 处理中（截图1：绿色渐变状态卡 + 时间线 + 退款信息） ===== */
          <>
            {/* 状态卡（绿色渐变 + 右上大对勾水印） */}
              <div className="relative overflow-hidden bg-gradient-to-br from-[#F3FBF3] via-[#EAF7EC] to-[#DDF2E1] p-5">
                <span className="pointer-events-none absolute -right-4 -top-6 text-[150px] leading-none text-[#C8E9CF]/70" aria-hidden="true">
                  ✓
                </span>
                <p className="relative text-[24px] font-bold leading-tight text-black/90">{done ? '退款成功' : '退款处理中'}</p>
                <p className="relative mt-1.5 text-[13px] text-black/45">预计最晚{expectDate}前到账</p>
                <div className="relative mt-4 bg-white/70 p-4">
                <p className="flex items-baseline justify-between">
                  <span className="text-[14px] text-black/60">退款金额</span>
                  <span className="text-[19px] font-bold text-black/90">¥{fmtMoney(r.amount)}</span>
                </p>
                <p className="mt-0.5 text-[12px] text-black/35">申请通过后退回至原账户</p>
                <p className="mt-4 flex items-baseline justify-between">
                  <span className="text-[14px] text-black/60">退回红包</span>
                  <span className="text-[15px] font-bold text-black/90">1张红包</span>
                </p>
                <p className="mt-0.5 text-[12px] text-black/35">
                  已退回至美团红包{' '}
                  <button type="button" onClick={() => onToast('红包已退回，可在「我的-红包卡券」查看')} className="font-medium text-[#FF6000]">
                    查看&gt;
                  </button>
                </p>
              </div>
            </div>

            {/* 退款流程 */}
            <div className="flex items-center justify-between px-4 pt-5">
              <p className="text-[17px] font-bold text-black/85">退款流程</p>
              <button type="button" onClick={() => onToast('已通知商家，将尽快处理您的售后')} className="flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12px] text-black/70 active:opacity-70">
                <span className="relative">
                  <Bike className="h-3.5 w-3.5 text-black/60" />
                  <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[#FF3B30]" />
                </span>
                联系商家
              </button>
            </div>
            <div className="mx-4 mt-2 border-t border-black/[0.05] pt-4">
              {flowShown.map((f, i) => {
                const first = i === 0;
                return (
                  <div key={`${f.title}-${f.at}`} className="relative flex gap-3 pb-5 last:pb-0">
                    {/* 节点 + 连线 */}
                    <span className="relative flex w-3 shrink-0 justify-center">
                      {first ? (
                        <span className="z-10 mt-1 h-[11px] w-[11px] rounded-full border-[3px] border-[#FFC300] bg-white" />
                      ) : (
                        <span className="z-10 mt-[7px] h-[7px] w-[7px] rounded-full bg-black/15" />
                      )}
                      {i < flowShown.length - 1 && <span className="absolute top-3 bottom-0 w-px bg-black/10" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[15px] font-semibold ${first ? 'text-black/90' : 'text-black/45'}`}>{f.title}</span>
                      <span className={`mt-1 block text-[13px] leading-relaxed ${first ? 'text-black/75' : 'text-black/40'}`}>{f.body}</span>
                      <span className="mt-1 block text-[12px] text-black/30">{fmtDateTime(f.at)}</span>
                    </span>
                  </div>
                );
              })}
              <button type="button" onClick={() => setOpen((o) => !o)} className="mx-auto mt-1 flex items-center gap-0.5 text-[12px] text-black/35 active:opacity-60">
                点击{open ? '收起' : '展开'}
                <ChevronUp className={`h-3.5 w-3.5 transition-transform ${open ? '' : 'rotate-180'}`} />
              </button>
            </div>

            {/* 退款信息 */}
            <p className="border-t-[7px] border-[#F5F6F7] px-4 pt-5 text-[17px] font-bold text-black/85">退款信息</p>
            <div className="mx-4 mt-3 pb-2">
              <div className="flex gap-3">
                <FoodImg src={order.items[0]?.img} emoji={order.items[0]?.emoji ?? order.merchantEmoji} className="h-14 w-14 shrink-0 rounded-lg" />
                <p className="line-clamp-2 min-w-0 flex-1 text-[14px] leading-snug text-black/85">{order.items[0]?.name ?? order.merchantName}</p>
                <p className="shrink-0 text-[14px] font-bold text-black/90">¥{fmtMoney(r.amount)}</p>
              </div>
              <p className="mt-1.5 truncate text-[11px] text-black/35">
                {order.merchantName} · {order.items.map((i) => `${i.name}×${i.qty}`).join('，')} × 1
              </p>
              <div className="mt-3 border-t border-black/[0.05] pt-1">
                <p className="flex items-center justify-between py-[7px]">
                  <span className="text-[13px] text-black/35">退款原因</span>
                  <span className="min-w-0 truncate pl-3 text-[13px] text-black/80">{r.reason}</span>
                </p>
                {r.note && (
                  <p className="flex items-center justify-between py-[7px]">
                    <span className="text-[13px] text-black/35">补充说明</span>
                    <span className="min-w-0 truncate pl-3 text-[13px] text-black/80">{r.note}</span>
                  </p>
                )}
                <p className="flex items-center justify-between py-[7px]">
                  <span className="text-[13px] text-black/35">订单号码</span>
                  <span className="min-w-0 truncate pl-3 text-[13px] text-black/80">{order.id}</span>
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 设置图标（齿轮） */
function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] text-black/80" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// ================================ 根组件 ================================

export default function MeituanApp() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<MtSession | null>(null);
  const [page, setPage] = useState<Page>('main');
  const [tab, setTab] = useState<Tab>('home');
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderFrom, setOrderFrom] = useState<'orders' | 'merchant'>('orders');
  const [dealId, setDealId] = useState<string | null>(null);
  const [dealMode, setDealMode] = useState<'group' | 'direct'>('direct');
  const [orderTab, setOrderTab] = useState('全部');
  const [editAddr, setEditAddr] = useState<MtAddress | null>(null);
  const [addrPicker, setAddrPicker] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [dealConfirmOpen, setDealConfirmOpen] = useState(false);
  const [payFor, setPayFor] = useState<MtOrder | null>(null);
  const [payPage, setPayPage] = useState(false);
  const [refundFor, setRefundFor] = useState<MtOrder | null>(null);
  const [refundOrderId, setRefundOrderId] = useState<string | null>(null);
  const [refundFrom, setRefundFrom] = useState<'order' | 'orders'>('order');
  // 二级页返回目标（设置页进入的 收货地址/关于美团 返回时回设置）
  const [subReturn, setSubReturn] = useState<'main' | 'settings'>('main');
  const [toastMsg, showToast] = useLocalToast();
  const sessionRef = useRef<MtSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // 启动：恢复登录态 + 消费灵动岛通知点击跳转（订单详情）
  useEffect(() => {
    void (async () => {
      const v = await mtValidateSession(mtGetSession());
      setSession(v);
      setBooting(false);
      const nav = takeNotifyNavigation('meituan');
      if (nav?.contactId && v) {
        setOrderId(nav.contactId);
        setTab('orders');
        setPage('orderDetail');
      }
    })();
    const onNav = () => {
      const nav = takeNotifyNavigation('meituan');
      if (nav?.contactId && sessionRef.current) {
        setOrderId(nav.contactId);
        setTab('orders');
        setPage('orderDetail');
      }
    };
    window.addEventListener(ISLAND_NAV_EVENT, onNav);
    return () => window.removeEventListener(ISLAND_NAV_EVENT, onNav);
  }, []);

  const login = useCallback((s: MtSession) => {
    mtSetSession(s);
    setSession(s);
    setTab('home');
    setPage('main');
    showToast(`欢迎回来，${s.name}`);
  }, [showToast]);

  const logout = useCallback(() => {
    mtSetSession(null);
    setSession(null);
    setTab('home');
    setPage('main');
  }, []);

  const goSub = useCallback((p: 'addresses' | 'about', from: 'main' | 'settings') => {
    setSubReturn(from);
    setPage(p);
  }, []);

  const openPay = useCallback((o: MtOrder) => {
    // 收银台（全页）：选支付方式 → 确认交易，全在 PayPage 内完成
    setPayFor(o);
    setPayPage(true);
  }, []);

  const openRefundById = useCallback((id: string, from: 'order' | 'orders') => {
    setRefundOrderId(id);
    // 从订单详情进 → 返回时回订单详情；从订单列表进 → 返回时回订单列表
    setRefundFrom(from);
    setPage('refundDetail');
  }, []);

  const openRefund = useCallback((o: MtOrder) => {
    openRefundById(o.id, page === 'orderDetail' ? 'order' : 'orders');
  }, [page, openRefundById]);

  const openMerchant = useCallback((id: string) => {
    // 浏览记录打点（商家）
    if (sessionRef.current) mtPushHistory(mtUidOf(sessionRef.current), 'merchant', id);
    setMerchantId(id);
    setPage('merchant');
  }, []);

  const openOrder = useCallback((id: string, from: 'orders' | 'merchant' = 'orders') => {
    setOrderId(id);
    setOrderFrom(from);
    setPage('orderDetail');
  }, []);

  const openDeal = useCallback((id: string) => {
    // 浏览记录打点（团购）
    if (sessionRef.current) mtPushHistory(mtUidOf(sessionRef.current), 'deal', id);
    setDealId(id);
    setPage('deal');
  }, []);

  const goHome = useCallback(() => {
    setTab('home');
    setPage('main');
  }, []);

  const goOrders = useCallback((t?: string) => {
    if (t) setOrderTab(t);
    setTab('orders');
    setPage('main');
  }, []);

  const backFromOrder = useCallback(() => {
    if (orderFrom === 'merchant' && merchantId) {
      setPage('merchant');
      return;
    }
    setTab('orders');
    setPage('main');
  }, [orderFrom, merchantId]);

  if (booting) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#FFD100]">
        <img src="/icons/meituan.png" alt="美团" className="h-20 w-20 rounded-[22px] shadow-lg" />
        <p className="mt-4 text-[15px] font-semibold text-black/70">美团 · 吃喝玩乐什么都有</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="relative h-full overflow-hidden bg-white">
        <LoginPage onLogin={login} onToast={showToast} />
        <LocalToast msg={toastMsg} />
      </div>
    );
  }

  const uid = mtUidOf(session);
  const merchant = merchantId ? mtMerchantOf(merchantId) : undefined;
  const deal = dealId ? MT_DEALS.find((d) => d.id === dealId) : undefined;

  const pickAddr = (a: MtAddress) => {
    mtSetCurAddr(uid, a.id);
    showToast(`已选择：${a.text.slice(0, 12)}`);
  };

  return (
    <div className="relative h-full overflow-hidden bg-[#F4F5F7]">
      {/* 页面路由（早退式，与微信/QQ 同模式） */}
      {page === 'main' && (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            {tab === 'home' && (
              <HomePage
                session={session}
                onOpenMerchant={openMerchant}
                onOpenDeal={openDeal}
                onOpenSearch={() => setPage('search')}
                onPickAddress={() => setAddrPicker(true)}
                onToast={showToast}
              />
            )}
            {tab === 'orders' && (
              <OrdersPage
                session={session}
                tab={orderTab}
                setTab={setOrderTab}
                onOpenOrder={openOrder}
                onOpenDeal={openDeal}
                onOpenRefund={(id) => openRefundById(id, 'orders')}
                onGoHome={goHome}
                onToast={showToast}
              />
            )}
            {tab === 'cart' && (
              <CartPage
                session={session}
                onOpenMerchant={openMerchant}
                onCheckout={(mid) => {
                  setMerchantId(mid);
                  setCheckoutOpen(true);
                }}
                onOpenFavorites={() => setPage('favorites')}
                onToast={showToast}
              />
            )}
            {tab === 'my' && (
              <MyPage
                session={session}
                onOpenOrders={goOrders}
                onOpenSettings={() => setPage('settings')}
                onOpenFavorites={() => setPage('favorites')}
                onOpenHistory={() => setPage('history')}
                onOpenCoupons={() => setPage('coupons')}
                onClaimCoupons={() => {
                  const n = mtClaimGodCoupons(uid);
                  showToast(n > 0 ? `已领取${n}张神券，可在「红包卡券」查看` : '神券已领取过了');
                }}
                onToast={showToast}
              />
            )}
          </div>
          {/* 底部导航（订单页为独立页：无底部 tab） */}
          {tab !== 'orders' && <BottomTabBar active={tab} onTab={(t) => setTab(t)} onToast={showToast} />}
        </div>
      )}
      {page === 'search' && <SearchPage onBack={() => setPage('main')} onOpenMerchant={openMerchant} />}
      {page === 'merchant' && merchant && (
        <MerchantPage
          merchant={merchant}
          onBack={() => setPage('main')}
          onCheckout={() => setCheckoutOpen(true)}
          onOpenOrder={(id) => openOrder(id, 'merchant')}
          onToast={showToast}
        />
      )}
      {page === 'deal' && deal && (
        <DealDetailPage
          deal={deal}
          onBack={() => setPage('main')}
          onBuy={(m) => {
            setDealMode(m);
            setDealConfirmOpen(true);
          }}
          onOpenMerchant={openMerchant}
          onToast={showToast}
        />
      )}
      {page === 'orderDetail' && orderId && (
        <OrderDetailPage
          session={session}
          orderId={orderId}
          onBack={backFromOrder}
          onOpenPay={openPay}
          onGoOrders={() => goOrders()}
          onOpenDeal={openDeal}
          onPickAddress={() => setAddrPicker(true)}
          onApplyRefund={(o) => setRefundFor(o)}
          onOpenRefund={openRefund}
          onToast={showToast}
        />
      )}
      {page === 'refundDetail' && refundOrderId && (
        <RefundDetailPage
          session={session}
          orderId={refundOrderId}
          onBack={() => {
            if (refundFrom === 'order' && orderId) {
              setPage('orderDetail');
              return;
            }
            setTab('orders');
            setPage('main');
          }}
          onToast={showToast}
        />
      )}
      {page === 'settings' && (
        <SettingsPage
          session={session}
          onBack={() => setPage('main')}
          onOpenAddresses={() => goSub('addresses', 'settings')}
          onOpenAbout={() => goSub('about', 'settings')}
          onLogout={logout}
          onToast={showToast}
        />
      )}
      {page === 'favorites' && (
        <FavoritesPage
          session={session}
          onBack={() => setPage('main')}
          onOpenMerchant={openMerchant}
          onOpenDeal={openDeal}
          onToast={showToast}
        />
      )}
      {page === 'history' && (
        <HistoryPage
          session={session}
          onBack={() => setPage('main')}
          onOpenMerchant={openMerchant}
          onOpenDeal={openDeal}
          onToast={showToast}
        />
      )}
      {page === 'coupons' && (
        <CouponsPage
          session={session}
          onBack={() => setPage('main')}
          onGoUse={() => {
            // 去使用：回首页逛对应频道（外卖/团购卡都在首页瀑布流）
            setTab('home');
            setPage('main');
            showToast('选好商品后，结算时选择该券即可抵扣');
          }}
          onToast={showToast}
        />
      )}
      {page === 'addresses' && (
        <AddressesPage
          session={session}
          onBack={() => setPage(subReturn)}
          onAdd={() => {
            setEditAddr(null);
            setPage('addAddress');
          }}
          onEdit={(a) => {
            setEditAddr(a);
            setPage('addAddress');
          }}
          onToast={showToast}
        />
      )}
      {page === 'addAddress' && (
        <AddAddressPage session={session} onBack={() => setPage('addresses')} editing={editAddr} onToast={showToast} />
      )}
      {page === 'about' && (
        <div className="flex h-full flex-col items-center justify-center bg-white px-8 text-center">
          <img src="/icons/meituan.png" alt="美团" className="h-20 w-20 rounded-[22px] shadow-lg" />
          <p className="mt-4 text-[19px] font-bold text-black/85">美团</p>
          <p className="mt-1 text-[12px] text-black/40">v10.18.0 · 演示版</p>
          <p className="mt-4 text-[12px] leading-relaxed text-black/45">
            当前账号：{session.name}（{session.idp === 'wx' ? '微信' : session.idp === 'qq' ? 'QQ' : '手机号'}登录）
            <br />
            购物车 / 订单 / 地址按账号隔离存储在本机
          </p>
          <button type="button" onClick={() => (subReturn === 'settings' ? setPage('settings') : goHome())} className="mt-6 rounded-full bg-[#FFD100] px-8 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
            {subReturn === 'settings' ? '返回设置' : '返回首页'}
          </button>
        </div>
      )}

      {/* 弹层 */}
      {addrPicker && <AddressPickerSheet uid={uid} onClose={() => setAddrPicker(false)} onPicked={pickAddr} onManage={() => goSub('addresses', 'main')} />}

      {/* 下单确认弹窗（外卖结算 / 团购确认，slide-up 覆盖在商家页/团购详情页上） */}
      <AnimatePresence>
        {checkoutOpen && merchant && (
          <CheckoutSheet
            key="mt-checkout"
            session={session}
            merchant={merchant}
            onClose={() => setCheckoutOpen(false)}
            onOpenPay={openPay}
            onPickAddress={() => setAddrPicker(true)}
            onToast={showToast}
          />
        )}
        {dealConfirmOpen && deal && (
          <DealConfirmSheet
            key="mt-deal-confirm"
            deal={deal}
            mode={dealMode}
            onClose={() => setDealConfirmOpen(false)}
            onOpenPay={openPay}
            onToast={showToast}
          />
        )}
      </AnimatePresence>

      {payFor && payPage && (
        <AnimatePresence>
          <PayPage
            key={payFor.id}
            order={payFor}
            onClose={() => {
              // 返回 → 取消支付，回到来源页（订单保持待支付，可继续支付）
              setPayPage(false);
              setPayFor(null);
            }}
            onPaid={(o) => {
              setPayPage(false);
              setPayFor(null);
              setOrderId(o.id);
              setOrderFrom('orders');
              setTab('orders');
              setPage('orderDetail');
            }}
            onToast={showToast}
          />
        </AnimatePresence>
      )}

      {/* 退款申请弹层（退款售后） */}
      <AnimatePresence>
        {refundFor && (
          <RefundApplySheet
            key={refundFor.id}
            order={refundFor}
            onClose={() => setRefundFor(null)}
            onToast={showToast}
          />
        )}
      </AnimatePresence>

      <LocalToast msg={toastMsg} />
    </div>
  );
}
