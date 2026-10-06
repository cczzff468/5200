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
  Bell,
  Bike,
  BookOpen,
  BriefcaseMedical,
  Building,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleArrowDown,
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
  Footprints,
  Gamepad2,
  Gift,
  Handshake,
  HardHat,
  Headset,
  Heart,
  Home as HomeIcon,
  Info,
  Languages,
  LayoutGrid,
  Leaf,
  LogOut,
  MapPin,
  MessageCircleMore,
  PartyPopper,
  Phone as PhoneIcon,
  Plane,
  Rabbit,
  Receipt,
  Repeat,
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
  mtCheckoutCalc,
  mtClearSearchHist,
  mtCurAddrId,
  mtGetOrder,
  mtGetSearchHist,
  mtGetSession,
  mtLoadAddresses,
  mtLoadCart,
  mtLoadOrders,
  mtReorder,
  mtResolveIdpIdentity,
  mtSaveAddresses,
  mtSaveCart,
  mtSaveOrders,
  mtSetCurAddr,
  mtSetSession,
  mtUidOf,
  mtValidateSession,
  MT_STATUS_LABEL,
  type MtAddress,
  type MtCart,
  type MtOrder,
  type MtOrderStatus,
  type MtSession,
} from '@/lib/ios/meituan-store';
import { mtExecutePay, mtListPayChannels, type MtPayChannel } from '@/lib/ios/meituan-pay';

type Page = 'main' | 'search' | 'merchant' | 'orderDetail' | 'addresses' | 'addAddress' | 'about' | 'deal';
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

function BottomTabBar({ active, onTab, onToast }: { active: Tab; onTab: (t: Tab) => void; onToast: (m: string) => void }) {
  const item = (k: Tab, label: string, Icon: typeof ShoppingCart, badge?: string) => (
    <button key={k} type="button" onClick={() => onTab(k)} className="relative flex flex-1 flex-col items-center gap-0.5 pt-1 active:opacity-70">
      <span className="relative">
        <Icon className={`h-[24px] w-[24px] ${active === k ? 'text-[#FFB300]' : 'text-black/75'}`} strokeWidth={active === k ? 2.2 : 1.8} />
        {badge && (
          <span className="absolute -right-2.5 -top-1.5 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-[#FF3B30] px-1 text-[9px] font-bold text-white">{badge}</span>
        )}
      </span>
      <span className={`text-[10px] ${active === k ? 'font-semibold text-black/85' : 'text-black/50'}`}>{label}</span>
    </button>
  );
  return (
    <div className="flex shrink-0 items-end border-t border-black/[0.06] bg-white pb-[max(6px,env(safe-area-inset-bottom))]">
      {item('home', '推荐', CircleArrowDown)}
      <button type="button" onClick={() => onToast('美团视频敬请期待')} className="relative flex flex-1 flex-col items-center gap-0.5 pt-1 active:opacity-70">
        <span className="relative">
          <CirclePlay className="h-[24px] w-[24px] text-black/75" strokeWidth={1.8} />
          <span className="absolute -right-2.5 -top-1.5 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-[#FF3B30] px-1 text-[9px] font-bold text-white">1</span>
        </span>
        <span className="text-[10px] text-black/50">视频</span>
      </button>
      <button type="button" onClick={() => onToast('小团 AI 助手敬请期待')} className="flex flex-1 flex-col items-center active:opacity-70">
        <span
          className="-mt-5 grid h-[46px] w-[46px] place-items-center rounded-full p-[2.5px] shadow-[0_2px_10px_rgba(0,0,0,0.15)]"
          style={{ background: 'conic-gradient(from 210deg, #FFD100, #FF8A5E, #FF66B8, #7CC7FF, #FFD100)' }}
        >
          <span className="grid h-full w-full place-items-center overflow-hidden rounded-full bg-white">
            <img src="/icons/meituan.png" alt="小团" className="h-full w-full rounded-full object-cover" />
          </span>
        </span>
        <span className="text-[10px] font-semibold text-black/80">小团</span>
      </button>
      {item('cart', '购物车', ShoppingCart)}
      <button type="button" onClick={() => onTab('my')} className="relative flex flex-1 flex-col items-center gap-0.5 pt-1 active:opacity-70">
        <span className="relative">
          <Smile className={`h-[24px] w-[24px] ${active === 'my' ? 'text-[#FFB300]' : 'text-black/75'}`} strokeWidth={active === 'my' ? 2.2 : 1.8} />
          <Star className="absolute -right-1.5 -top-1 h-2.5 w-2.5 fill-[#FFB300] text-[#FFB300]" strokeWidth={0} />
        </span>
        <span className={`text-[10px] ${active === 'my' ? 'font-semibold text-black/85' : 'text-black/50'}`}>我的</span>
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
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      <div className="flex items-center gap-2 bg-white px-3 pb-2.5 pt-[54px]">
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
                <button key={h} type="button" onClick={() => run(h)} className="rounded-full bg-white px-3 py-1.5 text-[12px] text-black/65 shadow-sm active:opacity-70">
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
                    <button key={h} type="button" onClick={() => run(h)} className="rounded-full bg-white px-3 py-1.5 text-[12px] text-black/65 shadow-sm active:opacity-70">
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
            <div className="mt-2 space-y-2.5">
              {merchantHits.map((m) => (
                <SearchMerchantRow key={m.id} m={m} onOpen={() => onOpenMerchant(m.id)} />
              ))}
            </div>
            {dishHits.length > 0 && <p className="mt-4 text-[13px] font-semibold text-black/45">相关菜品</p>}
            <div className="mt-2 space-y-2">
              {dishHits.map(({ m, d }) => (
                <button key={d.id} type="button" onClick={() => onOpenMerchant(m.id)} className="flex w-full items-center gap-3 rounded-2xl bg-white p-2.5 text-left shadow-sm active:bg-black/[0.02]">
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
                <p className="text-[40px]">🍽️</p>
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
    <button type="button" onClick={onOpen} className="flex w-full gap-3 rounded-2xl bg-white p-3 text-left shadow-sm active:bg-black/[0.02]">
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

function MerchantPage({ merchant, onBack, onCheckout, onOpenOrder, onToast }: { merchant: MtMerchant; onBack: () => void; onCheckout: () => void; onOpenOrder: (id: string) => void; onToast: (m: string) => void }) {
  const session = mtGetSession();
  const uid = session ? mtUidOf(session) : '';
  const [tab, setTab] = useState<'点菜' | '评价' | '商家' | '订单'>('点菜');
  const [cart, setCart] = useState<MtCart>(() => mtLoadCart(uid));
  const [cartOpen, setCartOpen] = useState(false);
  const [activeCat, setActiveCat] = useState(0);
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
    mutateCart((prev) => ({
      merchantId: merchant.id,
      items: prev.items.some((i) => i.dishId === d.id)
        ? prev.items.map((i) => (i.dishId === d.id ? { ...i, qty: i.qty + 1 } : i))
        : [...prev.items, { dishId: d.id, qty: 1 }],
    }));
  };
  const dec = (d: MtDish) => {
    mutateCart((prev) => {
      const items = prev.items.map((i) => (i.dishId === d.id ? { ...i, qty: i.qty - 1 } : i)).filter((i) => i.qty > 0);
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
          <button type="button" aria-label="收藏" onClick={() => onToast('已收藏商家')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/35 text-white active:opacity-75">
            <Star className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 商家信息卡 */}
      <div className="relative z-10 -mt-6 px-3">
        <div className="rounded-2xl bg-white p-3.5 shadow-[0_2px_10px_rgba(0,0,0,0.05)]">
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
      </div>

      {/* 页签（点菜/评价/商家/本店订单） */}
      <div className="mt-2.5 flex shrink-0 items-center gap-6 px-5">
        {(['点菜', '评价', '商家', '订单'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`relative py-2 text-[15px] ${tab === t ? 'font-bold text-black/85' : 'text-black/45'}`}>
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
                    <FoodImg src={d.img} emoji={d.emoji} className="h-[72px] w-[72px] shrink-0 rounded-lg" />
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
              <p className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white shadow-sm">
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
                    <div key={i.dishId} className="flex items-center gap-2.5 py-2.5">
                      <FoodImg src={d.img} emoji={d.emoji} className="h-10 w-10 shrink-0 rounded-lg" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-black/80">{d.name}</span>
                      <span className="text-[14px] font-semibold" style={{ color: MT_PRICE }}>
                        ¥{fmtMoney(d.price * i.qty)}
                      </span>
                      <Stepper qty={i.qty} onAdd={() => add(d)} onDec={() => dec(d)} />
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

// ================================ 支付方式选择弹层（两步：先选微信/QQ，再选渠道） ================================

function PayMethodSheet({
  amount,
  selected,
  onSelect,
  onClose,
  onToast,
}: {
  amount: number;
  selected: MtPayChannel | null;
  onSelect: (c: MtPayChannel) => void;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  // 第一步：平台（null）；第二步：idp 渠道列表
  const [idp, setIdp] = useState<'wx' | 'qq' | null>(null);
  const [chans, setChans] = useState<MtPayChannel[] | null>(null);

  const chooseIdp = (v: 'wx' | 'qq') => {
    setChans(null);
    setIdp(v);
  };

  useEffect(() => {
    if (!idp) return;
    let alive = true;
    mtListPayChannels(idp, amount)
      .then((c) => alive && setChans(c))
      .catch(() => alive && setChans([]));
    return () => {
      alive = false;
    };
  }, [idp, amount]);

  const pick = (c: MtPayChannel) => {
    if (c.insufficient) {
      onToast(c.isFc ? '亲属卡本月额度不足，请切换其他支付方式' : '该渠道余额不足，请更换支付方式');
      return;
    }
    onSelect(c);
  };

  const chanIcon = (c: MtPayChannel) => {
    if (c.isFc) return <Users className="h-4 w-4 text-[#FF6000]" strokeWidth={2} />;
    if (c.methodId === 'balance') return <Wallet className={`h-4 w-4 ${c.idp === 'wx' ? 'text-[#06C160]' : 'text-[#12B7F5]'}`} strokeWidth={2} />;
    return <CreditCard className="h-4 w-4 text-black/55" strokeWidth={2} />;
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" onClick={onClose}>
      <div className="max-h-[82%] overflow-y-auto rounded-t-2xl bg-white pb-8" onClick={(e) => e.stopPropagation()}>
        {idp === null ? (
          /* —— 第一步：选择微信 / QQ —— */
          <>
            <p className="py-3.5 text-center text-[16px] font-semibold text-black/85">选择支付方式</p>
            <p className="pb-3 text-center text-[26px] font-bold leading-none text-black/90">
              <span className="text-[16px]">¥</span>
              {amount.toFixed(2)}
            </p>
            <div className="space-y-2.5 px-4">
              <button type="button" onClick={() => chooseIdp('wx')} className="flex w-full items-center gap-3 rounded-2xl border border-black/8 bg-white p-3.5 text-left shadow-sm active:bg-black/[0.02]">
                <img src="/icons/wechat.png" alt="" className="h-10 w-10 rounded-xl" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-black/85">微信支付</span>
                  <span className="block text-[11px] text-black/40">零钱 / 银行卡 / 亲属卡</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
              </button>
              <button type="button" onClick={() => chooseIdp('qq')} className="flex w-full items-center gap-3 rounded-2xl border border-black/8 bg-white p-3.5 text-left shadow-sm active:bg-black/[0.02]">
                <img src="/icons/qq.png" alt="" className="h-10 w-10 rounded-xl" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-black/85">QQ支付</span>
                  <span className="block text-[11px] text-black/40">QQ钱包余额 / 银行卡</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
              </button>
            </div>
            <p className="px-6 pt-4 text-center text-[11px] leading-relaxed text-black/30">
              使用亲属卡支付将由赠卡人买单（消费记录同步给赠卡人）；支付结果以商家订单为准
            </p>
          </>
        ) : (
          /* —— 第二步：该平台下选渠道 —— */
          <>
            <div className="flex items-center gap-1 px-2 pb-1 pt-2">
              <button type="button" aria-label="返回" onClick={() => setIdp(null)} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
                <ChevronLeft className="h-5 w-5 text-black/70" />
              </button>
              <p className="flex-1 pr-10 text-center text-[16px] font-semibold text-black/85">
                {idp === 'wx' ? '微信支付' : 'QQ支付'}
              </p>
            </div>
            <p className="pb-2 text-center text-[22px] font-bold leading-none text-black/90">
              <span className="text-[14px]">¥</span>
              {amount.toFixed(2)}
            </p>
            {chans === null ? (
              <p className="px-4 py-6 text-center text-[12px] text-black/35">正在获取支付渠道…</p>
            ) : chans.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-black/35">该支付方式暂无可用渠道，请更换</p>
            ) : (
              <div>
                {chans.map((c) => (
                  <button key={c.key} type="button" onClick={() => pick(c)} className="flex w-full items-center gap-3 px-5 py-3 text-left active:bg-black/[0.03]">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${c.isFc ? 'bg-[#FFF0EB]' : c.idp === 'wx' ? 'bg-[#E8F9EF]' : 'bg-[#E5F6FD]'}`}>{chanIcon(c)}</span>
                    <span className={`min-w-0 flex-1 ${c.insufficient ? 'opacity-45' : ''}`}>
                      <span className="block truncate text-[14px] font-medium text-black/85">{c.label}</span>
                      <span className="block text-[11px] text-black/40">{c.sub}</span>
                    </span>
                    {c.insufficient ? (
                      <span className="shrink-0 text-[11px] text-[#FF4B33]">{c.isFc ? '额度不足' : '余额不足'}</span>
                    ) : (
                      <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ${selected?.key === c.key ? 'bg-[#FFC300]' : 'border border-black/20'}`}>
                        {selected?.key === c.key && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {idp === 'wx' && <p className="px-6 pt-2 text-center text-[11px] leading-relaxed text-black/30">使用亲属卡支付将由赠卡人买单，消费后赠卡人会收到通知</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ================================ 支付确认弹层 ================================

function PayConfirmSheet({
  order,
  channel,
  onChangeChannel,
  onClose,
  onPaid,
  onToast,
}: {
  order: MtOrder;
  channel: MtPayChannel | null;
  onChangeChannel: () => void;
  onClose: () => void;
  onPaid: (o: MtOrder) => void;
  onToast: (m: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'processing' | 'fail'>('idle');
  const [err, setErr] = useState('');
  const [tried, setTried] = useState(0);

  const pay = async () => {
    if (!channel) {
      onToast('请先选择支付方式');
      return;
    }
    if (state === 'processing') return;
    setErr('');
    setState('processing');
    await new Promise((r) => setTimeout(r, 1100));
    // 偶发网络失败（首次尝试 12% 概率）→ 提示重试（需求：支付失败时提示重试）
    const randomFail = tried === 0 && Math.random() < 0.12;
    setTried((t) => t + 1);
    const res = await mtExecutePay(order.payIdp ?? channel.idp, channel, order.total, order.merchantName, randomFail);
    if (!res.ok) {
      setErr(res.error ?? '支付失败，请重试');
      setState('fail');
      return;
    }
    // 成功：落单（外卖→待接单开始配送流程 / 团购→直接完成并记录消费时间）
    const now = Date.now();
    const tuangouDone = order.kind === 'tuangou';
    const paid: MtOrder = {
      ...order,
      status: tuangouDone ? 'completed' : 'pendingAccept',
      paidAt: now,
      ...(tuangouDone ? { consumedAt: now } : { etaAt: now + 45 * 60_000 }),
      payIdp: channel.idp,
      payChannelLabel: `${channel.idp === 'wx' ? '微信' : 'QQ'}${channel.isFc ? '亲属卡' : ''} · ${channel.label}`,
      payFc: channel.isFc === true,
      statusLog: [...order.statusLog, { status: tuangouDone ? 'completed' : 'pendingAccept', at: now }],
    };
    const list = mtLoadOrders(order.uid).map((o) => (o.id === order.id ? paid : o));
    mtSaveOrders(order.uid, list);
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    if (res.fc) onToast(`已用${res.fc.parts[0]?.giverName ?? '亲属卡'}支付 ¥${fmtMoney(res.fc.total)}`);
    else onToast('支付成功');
    onPaid(paid);
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={() => state !== 'processing' && onClose()}>
      <div className="rounded-t-2xl bg-[#F7F8FA] pb-9" onClick={(e) => e.stopPropagation()}>
        <div className="relative bg-gradient-to-b from-[#FFD100] to-[#FFE45C] px-5 pb-5 pt-4">
          <button type="button" aria-label="关闭" onClick={onClose} className="absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-full bg-black/10 active:opacity-70">
            <X className="h-4 w-4 text-black/60" />
          </button>
          <p className="text-[13px] text-black/60">支付订单</p>
          <p className="mt-1 text-[34px] font-bold leading-tight text-black/90">
            <span className="text-[18px]">¥</span>
            {order.total.toFixed(2)}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-black/55">{order.merchantName}</p>
        </div>

        {state === 'fail' ? (
          <div className="px-5 pt-6 text-center">
            <p className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#FFF0EB]">
              <TriangleAlert className="h-7 w-7 text-[#FF4B33]" strokeWidth={2} />
            </p>
            <p className="mt-3 text-[16px] font-semibold text-black/85">支付失败</p>
            <p className="mt-1 text-[13px] text-black/45">{err}</p>
            <button type="button" onClick={() => void pay()} className="mt-5 h-12 w-full rounded-full bg-[#FFD100] text-[16px] font-semibold text-black/90 active:opacity-85">
              重新支付
            </button>
            <button
              type="button"
              onClick={() => {
                setState('idle');
                onChangeChannel();
              }}
              className="mt-2.5 h-11 w-full rounded-full border border-black/10 bg-white text-[14px] text-black/70 active:opacity-75"
            >
              更换支付方式
            </button>
          </div>
        ) : (
          <div className="px-5 pt-4">
            <button type="button" onClick={onChangeChannel} className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 active:bg-black/[0.02]">
              {channel ? (
                <img src={channel.idp === 'wx' ? '/icons/wechat.png' : '/icons/qq.png'} alt="" className="h-9 w-9 shrink-0 rounded-lg" />
              ) : (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#F5F6F7]">
                  <CreditCard className="h-4.5 w-4.5 text-black/50" strokeWidth={2} />
                </span>
              )}
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-[14px] font-medium text-black/85">{channel ? `${channel.idp === 'wx' ? '微信支付' : 'QQ支付'} · ${channel.label}` : '请选择支付方式'}</span>
                <span className="block text-[11px] text-black/40">{channel ? channel.sub : '微信 / QQ · 零钱 / 银行卡 / 亲属卡'}</span>
              </span>
              <span className="text-[13px] text-black/35">更换 ›</span>
            </button>
            <button
              type="button"
              onClick={() => void pay()}
              disabled={state === 'processing' || !channel}
              className={`mt-4 h-[52px] w-full rounded-full text-[17px] font-semibold active:opacity-85 disabled:opacity-60 ${channel?.idp === 'qq' ? 'bg-[#12B7F5] text-white' : 'bg-[#06C160] text-white'}`}
            >
              {state === 'processing' ? '正在支付…' : `确认支付 ¥${order.total.toFixed(2)}`}
            </button>
            <p className="mt-3 text-center text-[11px] text-black/30">支付即代表同意《美团支付服务协议》 · 资金由微信支付/QQ钱包保障</p>
          </div>
        )}
      </div>
    </div>
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
  onOpenPay: (o: MtOrder, sel: MtPayChannel | null) => void;
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

  const items = cart.items
    .map((i) => {
      const d = mtDishesOf(merchant).find((x) => x.id === i.dishId);
      return d ? { dish: d, qty: i.qty } : null;
    })
    .filter((x): x is { dish: MtDish; qty: number } => x !== null);

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
      items: items.map(({ dish, qty }) => ({ dishId: dish.id, name: dish.name, price: dish.price, qty, emoji: dish.emoji, img: dish.img })),
      itemTotal: calc.itemTotal,
      deliveryFee: calc.deliveryFee,
      discount: calc.discount,
      total: calc.total,
      note: note.trim() || undefined,
      address: cur,
      status: 'pendingPay',
      createdAt: now,
      statusLog: [{ status: 'pendingPay', at: now }],
    };
    const list = mtLoadOrders(uid);
    mtSaveOrders(uid, [order, ...list]);
    mtSaveCart(uid, { merchantId: null, items: [] });
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    onClose();
    onOpenPay(order, null);
  };

  return (
    <motion.div className="absolute inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        className="absolute inset-x-0 bottom-0 top-[88px] flex flex-col overflow-hidden rounded-t-[20px] bg-[#F4F5F7]"
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
            <p className="grid h-16 w-16 place-items-center rounded-full bg-white shadow-sm">
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
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {/* 地址 */}
              <button type="button" onClick={onPickAddress} className="w-full rounded-2xl bg-white p-4 text-left shadow-sm active:bg-black/[0.02]">
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
              <div className="mt-2.5 rounded-2xl bg-white p-4 shadow-sm">
                <p className="flex items-center gap-2 text-[14px] font-semibold text-black/80">
                  <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md">
                    <FoodImg src={merchant.cover} emoji={merchant.emoji} className="h-full w-full" />
                  </span>
                  {merchant.name}
                </p>
                <div className="mt-2.5 space-y-2.5">
                  {items.map(({ dish, qty }) => (
                    <div key={dish.id} className="flex items-center gap-2.5">
                      <FoodImg src={dish.img} emoji={dish.emoji} className="h-10 w-10 shrink-0 rounded-lg" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-black/75">{dish.name}</span>
                      <span className="text-[12px] text-black/40">×{qty}</span>
                      <span className="w-14 text-right text-[13px] text-black/80">¥{fmtMoney(dish.price * qty)}</span>
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
                  {calc.discount > 0 && (
                    <p className="flex justify-between text-[#FF4B33]">
                      <span>优惠{calc.labels.length > 0 && `（${calc.labels.join('、')}）`}</span>
                      <span>-¥{fmtMoney(calc.discount)}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* 备注 */}
              <div className="mt-2.5 rounded-2xl bg-white p-4 shadow-sm">
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
                    ¥{calc.total.toFixed(2)}
                  </span>
                  {calc.discount > 0 && <span className="ml-1 text-[11px] text-black/35">已优惠¥{fmtMoney(calc.discount)}</span>}
                </span>
                <button type="button" onClick={submit} className="h-12 rounded-full bg-[#FFD100] px-8 text-[16px] font-semibold text-black/90 shadow active:opacity-85">
                  提交订单
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// ================================ 订单列表页（截图5） ================================

const ORDER_TABS: { key: string; match: (s: MtOrderStatus) => boolean }[] = [
  { key: '全部', match: () => true },
  { key: '待付款', match: (s) => s === 'pendingPay' },
  { key: '待收货/待使用', match: (s) => s === 'pendingAccept' || s === 'accepted' || s === 'delivering' },
  { key: '评价', match: (s) => s === 'completed' },
  { key: '退款/售后', match: (s) => s === 'canceled' },
];

function OrdersPage({
  session,
  tab,
  setTab,
  onOpenOrder,
  onOpenDeal,
  onGoHome,
  onToast,
}: {
  session: MtSession;
  tab: string;
  setTab: (t: string) => void;
  onOpenOrder: (id: string) => void;
  onOpenDeal: (id: string) => void;
  onGoHome: () => void;
  onToast: (m: string) => void;
}) {
  const uid = mtUidOf(session);
  useOrdersTick();
  const orders = mtLoadOrders(uid);
  const cur = ORDER_TABS.find((t) => t.key === tab) ?? ORDER_TABS[0];
  const list = orders.filter((o) => cur.match(o.status));

  const cancelOrder = (o: MtOrder) => {
    const list2 = mtLoadOrders(uid).map((x) =>
      x.id === o.id ? { ...x, status: 'canceled' as const, cancelReason: '用户主动取消', statusLog: [...x.statusLog, { status: 'canceled' as const, at: Date.now() }] } : x
    );
    mtSaveOrders(uid, list2);
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    onToast('订单已取消');
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
    <div className="flex h-full flex-col bg-[#F0F3F5]">
      {/* 返回 + 搜索 + 筛选 + 发票（独立页：无底部 tab，顶部返回键回首页） */}
      <div className="shrink-0 bg-[#F0F3F5] px-3 pb-1 pt-[54px]">
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
          <div className="mt-20 text-center">
            <p className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white shadow-sm">
              <ShoppingBag className="h-7 w-7 text-black/25" strokeWidth={1.8} />
            </p>
            <p className="mt-3 text-[13px] text-black/40">还没有相关订单，去下一单吧</p>
            <button type="button" onClick={onGoHome} className="mt-4 rounded-full bg-[#FFD100] px-6 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
              去逛逛
            </button>
          </div>
        )}
        <div className="space-y-2.5">
          {list.map((o) => {
            const tuangou = o.kind === 'tuangou';
            const qtyTotal = o.items.reduce((s, i) => s + i.qty, 0);
            return (
              <div key={o.id} className="rounded-2xl bg-white p-3.5 shadow-sm">
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
  onToast,
}: {
  session: MtSession;
  orderId: string;
  onBack: () => void;
  onOpenPay: (o: MtOrder, sel: MtPayChannel | null) => void;
  onGoOrders: () => void;
  onOpenDeal: (id: string) => void;
  onPickAddress: () => void;
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
    const list = mtLoadOrders(uid).map((x) =>
      x.id === order.id
        ? { ...x, status: 'canceled' as const, cancelReason: x.status === 'pendingAccept' ? '用户取消，支付金额将原路退回' : '用户主动取消', statusLog: [...x.statusLog, { status: 'canceled' as const, at: Date.now() }] }
        : x
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
    <div className="flex h-full flex-col bg-[#F0F3F5]">
      {/* 顶栏：返回 + 金币/分享/客服/刷新 */}
      <div className="shrink-0 bg-white px-3 pb-2 pt-[54px]">
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

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
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
          <div className="mx-3 mt-3">
            <DeliveryMap merchantName={order.merchantName} />
          </div>
        )}

        {/* 操作按钮 */}
        {(order.status === 'accepted' || order.status === 'delivering') && (
          <div className="mt-3 flex gap-2 px-3">
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
          <div className="mx-3 mt-3 rounded-xl bg-white p-3.5 shadow-sm">
            <p className="text-[13px] font-medium leading-relaxed text-[#FF6000]">【使用限制】该订单为特惠订单，请在30分钟内完成支付，超时未支付将自动取消</p>
          </div>
        )}

        {/* 订单信息 */}
        <div className="mx-3 mt-3 rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-[16px] font-bold text-black/85">订单信息</p>
          <div className="mt-1.5">
            {tuangou ? (
              <>
                <InfoRow k="期望时间" v="免预约 · 随时可用" />
                <InfoRow k="适用门店" v={`${order.merchantName}（门店通用）`} />
                <InfoRow k="使用规则" v="随时退 · 过期自动退" />
                <InfoRow k="订单号码" v={order.id} action={<CopyBtn onClick={() => copy(order.id)} />} />
                <InfoRow k="下单时间" v={fmtDateTime(order.createdAt)} />
                <InfoRow k="支付方式" v={order.payIdp ? (order.payChannelLabel ?? (order.payIdp === 'wx' ? '微信支付' : 'QQ支付')) : '在线支付（未支付）'} />
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
                <InfoRow k="支付方式" v={order.payIdp ? (order.payChannelLabel ?? (order.payIdp === 'wx' ? '微信支付' : 'QQ支付')) : '在线支付（未支付）'} />
              </>
            )}
          </div>
        </div>

        {/* 商品费用 */}
        <div className="mx-3 mt-2.5 rounded-2xl bg-white p-4 shadow-sm">
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
              <div key={i.dishId} className="flex items-center gap-2.5">
                <FoodImg src={i.img} emoji={i.emoji} className="h-11 w-11 shrink-0 rounded-lg" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-black/75">{i.name}</span>
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
                <span>优惠共减</span>
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
              <button type="button" onClick={() => onOpenPay(order, null)} className="rounded-full bg-gradient-to-r from-[#FF9A21] to-[#FF6F1E] px-7 py-2.5 text-[15px] font-semibold text-white active:opacity-85">
                ¥{order.total.toFixed(2)} 继续支付
              </button>
            </>
          )}
          {order.status === 'pendingAccept' && (
            <button type="button" onClick={cancel} className="rounded-full border border-black/15 px-6 py-2.5 text-[13px] text-black/60 active:bg-black/5">
              取消订单（退款）
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
  if (!merchant) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <p className="text-[13px] text-black/40">团购不存在</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
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
            <button type="button" aria-label="收藏" onClick={() => onToast('已收藏')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/35 text-white active:opacity-75">
              <Star className="h-4 w-4" />
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
        <div className="mx-3 mt-2.5 overflow-hidden rounded-2xl shadow-sm">
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
        <div className="mx-3 mt-2.5 rounded-2xl bg-white p-4 shadow-sm">
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
  onOpenPay: (o: MtOrder, sel: MtPayChannel | null) => void;
  onToast: (m: string) => void;
}) {
  const session = mtGetSession();
  const uid = session ? mtUidOf(session) : '';
  const merchant = mtMerchantOf(deal.merchantId);
  const [qty, setQty] = useState(1);
  const unitPrice = mode === 'group' ? (deal.groupPrice ?? Math.max(0.1, Math.round((deal.price - 2) * 10) / 10)) : deal.price;
  const itemTotal = Math.round(deal.origPrice * qty * 100) / 100;
  const total = Math.round(unitPrice * qty * 100) / 100;
  const discount = Math.round((itemTotal - total) * 100) / 100;

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
      total,
      status: 'pendingPay',
      createdAt: now,
      statusLog: [{ status: 'pendingPay', at: now }],
    };
    const list = mtLoadOrders(uid);
    mtSaveOrders(uid, [order, ...list]);
    window.dispatchEvent(new CustomEvent('mt-orders-changed'));
    onClose();
    onOpenPay(order, null);
  };

  return (
    <motion.div className="absolute inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      <div className="absolute inset-0 bg-black/55" onClick={onClose} />
      {/* 面板外顶部提示条（对齐截图7） */}
      <motion.div
        className="absolute inset-x-0 top-[64px] flex justify-center"
        initial={{ y: -14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -14, opacity: 0 }}
        transition={{ delay: 0.16, duration: 0.2 }}
      >
        <div className="flex items-center gap-3 rounded-full bg-black/70 py-2 pl-4 pr-2.5 text-[13px] text-white shadow-lg">
          <span>未成团自动退 · 过期自动退</span>
          <button type="button" aria-label="关闭" onClick={onClose} className="grid h-5 w-5 place-items-center rounded-full bg-white/20 active:bg-white/30">
            <X className="h-3 w-3" />
          </button>
        </div>
      </motion.div>

      <motion.div
        className="absolute inset-x-0 bottom-0 top-[108px] flex flex-col overflow-hidden rounded-t-[20px] bg-[#F4F5F7]"
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
          <div className="space-y-2.5 px-3 pt-3 pb-2">
            {/* 到店消费提示 */}
            <div className="flex items-center gap-2 rounded-xl bg-[#FFEFF5] px-3 py-2.5 text-[13px] text-[#E6003A]">
              <Info className="h-4 w-4 shrink-0" />
              您正在购买的商品需要到商家店内消费
            </div>

            {/* 商品卡 */}
            <div className="rounded-2xl bg-white p-3.5 shadow-sm">
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

            {/* 过期提醒 */}
            <div className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-3 shadow-sm">
              <Bell className="h-4 w-4 shrink-0 text-black/55" />
              <p className="text-[12px] leading-relaxed text-black/55">{deal.notice}</p>
            </div>

            {/* 价格卡 */}
            <div className="space-y-3.5 rounded-2xl bg-white p-4 shadow-sm">
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
            <div className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm">
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
            <div className="flex items-center justify-between rounded-2xl bg-white px-3.5 py-3.5 shadow-sm">
              <span className="text-[14px] text-black/80">评价后享</span>
              <span className="text-[13px] text-black/55">
                评价可得最高<span className="font-semibold text-[#FF3B30]">100积分</span>
              </span>
            </div>

            <p className="px-1 pt-1 text-[11px] leading-relaxed text-black/35">订单支付后即可消费，如有问题可随时申请退款</p>
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
    </motion.div>
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
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      <div className="flex shrink-0 items-center gap-2 bg-white px-3 pb-2.5 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-6 w-6 text-black/70" />
        </button>
        <p className="flex-1 text-center text-[16px] font-semibold text-black/85">收货地址</p>
        <span className="h-9 w-9" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="space-y-2.5">
          {addrs.map((a) => (
            <div key={a.id} className="rounded-2xl bg-white p-4 shadow-sm">
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
      <div className="shrink-0 bg-white px-4 py-3">
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
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      <div className="flex shrink-0 items-center gap-2 bg-white px-3 pb-2.5 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-6 w-6 text-black/70" />
        </button>
        <p className="flex-1 text-center text-[16px] font-semibold text-black/85">{editing ? '编辑地址' : '新增地址'}</p>
        <span className="h-9 w-9" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          {([
            ['联系人', name, setName, '收货人姓名'],
            ['手机号', phone, setPhone, '11 位手机号'],
            ['详细地址', text, setText, '小区 / 写字楼 / 门牌号'],
          ] as const).map(([label, val, set, ph]) => (
            <label key={label} className="flex items-center gap-3 border-b border-black/5 pb-3 last:border-0 last:pb-0">
              <span className="w-[64px] shrink-0 text-[14px] text-black/50">{label}</span>
              <input value={val} onChange={(e) => set(e.target.value)} placeholder={ph} className="h-9 flex-1 bg-transparent text-[14px] outline-none placeholder:text-black/25" />
            </label>
          ))}
          <div className="flex items-center gap-2">
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
  onToast,
}: {
  session: MtSession;
  onOpenMerchant: (id: string) => void;
  onCheckout: (merchantId: string) => void;
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
      return d ? { dish: d, qty: i.qty } : null;
    })
    .filter((x): x is { dish: MtDish; qty: number } => x !== null);

  const selIds = selected ?? new Set(rows.map((r) => r.dish.id));
  const selRows = rows.filter((r) => selIds.has(r.dish.id));
  const sum = selRows.reduce((s, r) => s + r.dish.price * r.qty, 0);
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
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      {/* 头部 */}
      <div className="flex shrink-0 items-center gap-2 bg-white px-4 pb-2.5 pt-[54px]">
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
        {/* 收藏入口 */}
        <button type="button" onClick={() => onToast('收藏的商家与菜品（演示）')} className="mx-3 mt-1 flex items-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-left shadow-sm active:opacity-80">
          <Star className="h-[18px] w-[18px] fill-[#FFB800] text-[#FFB800]" />
          <span className="text-[14px] text-black/80">收藏</span>
          <ChevronRight className="h-4 w-4 text-black/30" />
        </button>

        {rows.length === 0 || !merchant ? (
          /* 空态（对齐截图3插画卡） */
          <div className="mx-3 mt-2.5 rounded-2xl bg-white py-12 text-center shadow-sm">
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
            <div className="mx-3 mt-2.5 rounded-2xl bg-white p-3.5 shadow-sm">
              <button type="button" onClick={() => onOpenMerchant(merchant.id)} className="flex w-full items-center gap-1.5 text-left active:opacity-70">
                <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md">
                  <FoodImg src={merchant.cover} emoji={merchant.emoji} className="h-full w-full" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-black/85">{merchant.name}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
              </button>
              <div className="mt-1 divide-y divide-black/[0.04]">
                {rows.map(({ dish, qty }) => {
                  const checked = selIds.has(dish.id);
                  return (
                    <div key={dish.id} className="flex items-center gap-2.5 py-3">
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
                        {manage && (
                          <button type="button" onClick={() => removeRow(dish)} className="mt-1 w-fit rounded-full border border-[#FF4B33]/40 px-2.5 py-0.5 text-[11px] text-[#FF4B33] active:bg-black/5">
                            删除
                          </button>
                        )}
                        <div className="mt-auto flex items-center justify-between">
                          <span className="text-[16px] font-bold" style={{ color: MT_PRICE }}>
                            <span className="text-[11px]">¥</span>
                            {fmtMoney(dish.price)}
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
                className="mx-3 mt-2.5 flex w-[calc(100%-24px)] items-center justify-center gap-1.5 rounded-2xl bg-white py-3 text-[13px] text-[#FF4B33] shadow-sm active:bg-black/[0.02]"
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
  onOpenAddresses,
  onOpenAbout,
  onLogout,
  onToast,
}: {
  session: MtSession;
  onOpenOrders: (tab?: string) => void;
  onOpenAddresses: () => void;
  onOpenAbout: () => void;
  onLogout: () => void;
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
    <div className="h-full overflow-y-auto bg-[#F4F5F7] pb-4">
      {/* 黄色头部 + 会员卡 */}
      <div className="bg-gradient-to-b from-[#FFDE00] via-[#FFE65A] to-[#F4F5F7] px-4 pb-4 pt-[58px]">
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
          <button type="button" onClick={onOpenAbout} className="relative ml-2 flex flex-col items-center gap-0.5 active:opacity-60">
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
            <button type="button" onClick={() => onToast('会员中心（演示）')} className="ml-auto rounded-l-full rounded-r-xl bg-white/70 px-2.5 py-1 text-right active:opacity-70">
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
              <button key={l} type="button" onClick={() => onToast(`${l}（演示）`)} className="relative rounded-xl bg-white/60 py-2.5 text-center active:opacity-70">
                {i === 0 && <span className="absolute -right-1 -top-1.5 rounded-full rounded-bl-none bg-[#FF3B30] px-1 py-px text-[8px] font-bold text-white">待领取</span>}
                <span className="mx-auto grid h-[22px] w-[22px] place-items-center">
                  <Icon className="h-[22px] w-[22px] text-[#5A4200]" strokeWidth={1.9} />
                </span>
                <span className="mt-1 block text-[11px] text-[#5A4200]">{l} ›</span>
              </button>
            ))}
          </div>
          <div className="mt-2.5 flex items-center rounded-xl bg-white/60 px-3 py-2">
            {[
              ['¥12', '外卖大额神券'],
              ['¥11', '堂食膨胀神券'],
              ['¥7', '堂食神券'],
            ].map(([p, l], i) => (
              <button key={l} type="button" onClick={() => onToast(`${l}（演示）`)} className={`flex flex-1 flex-col items-center ${i > 0 ? 'border-l border-[#5A4200]/10' : ''}`}>
                <span className="text-[15px] font-bold text-[#5A4200]">{p}</span>
                <span className="text-[9px] text-[#5A4200]/60">{l}</span>
              </button>
            ))}
            <div className="ml-1 flex flex-col items-center gap-1 border-l border-[#5A4200]/10 pl-2.5">
              <span className="text-[10px] font-medium text-[#5A4200]">每日领券</span>
              <button type="button" onClick={() => onToast('已领取3张神券（演示）')} className="rounded-full bg-[#FFD100] px-2.5 py-1 text-[10px] font-semibold text-black/85 active:opacity-80">
                一键领取
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 功能宫格 */}
      <div className="mx-3 -mt-1 grid grid-cols-4 gap-y-4 rounded-2xl bg-white px-2 py-3.5 shadow-sm">
        {([
          [Star, '收藏', null],
          [Eye, '浏览记录', null],
          [Ticket, '红包卡券', null],
          [Coins, '美团币', '1'],
        ] as [LucideIcon, string, string | null][]).map(([Icon, l, badge]) => (
          <button key={l} type="button" onClick={() => onToast(`${l}（演示）`)} className="flex flex-col items-center gap-1.5 active:opacity-70">
            <span className="relative">
              <Icon className="h-[22px] w-[22px] text-black/75" strokeWidth={1.8} />
              {badge && <span className="absolute -right-2 -top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[#FF3B30] px-1 text-[9px] font-bold text-white">{badge}</span>}
            </span>
            <span className="text-[11px] text-black/70">{l}</span>
          </button>
        ))}
      </div>

      {/* 订单 */}
      <div className="mx-3 mt-2.5 rounded-2xl bg-white p-3.5 shadow-sm">
        <p className="text-[16px] font-bold text-black/85">订单</p>
        <div className="mt-3 grid grid-cols-4">
          {cell(Receipt, '全部订单', null, () => onOpenOrders('全部'))}
          {cell(ClockIcon, '待收货/使用', inFlight, () => onOpenOrders('待收货/待使用'))}
          {cell(MessageCircleMore, '待评价', null, () => onOpenOrders('评价'))}
          {cell(Wallet, '退款售后', null, () => onOpenOrders('退款/售后'))}
        </div>
      </div>

      {/* 钱包 */}
      <div className="mx-3 mt-2.5 rounded-2xl bg-white p-3.5 shadow-sm">
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
      <div className="mx-3 mt-2.5 grid grid-cols-4 gap-y-4 rounded-2xl bg-white px-2 py-3.5 shadow-sm">
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

      {/* 账号 */}
      <div className="mx-3 mt-2.5 rounded-2xl bg-white shadow-sm">
        <button type="button" onClick={onOpenAddresses} className="flex w-full items-center gap-3 border-b border-black/5 px-4 py-3.5 text-left active:bg-black/[0.03]">
          <MapPin className="h-[18px] w-[18px] text-black/70" strokeWidth={1.9} />
          <span className="flex-1 text-[14px] text-black/80">收货地址管理</span>
          <ChevronRight className="h-4 w-4 text-black/20" />
        </button>
        <button type="button" onClick={onLogout} className="flex w-full items-center gap-3 border-b border-black/5 px-4 py-3.5 text-left active:bg-black/[0.03]">
          <Repeat className="h-[18px] w-[18px] text-black/70" strokeWidth={1.9} />
          <span className="flex-1 text-[14px] text-black/80">切换账号</span>
          <ChevronRight className="h-4 w-4 text-black/20" />
        </button>
        <button type="button" onClick={onLogout} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.03]">
          <LogOut className="h-[18px] w-[18px] text-[#FF4B33]" strokeWidth={1.9} />
          <span className="flex-1 text-[14px] text-[#FF4B33]">退出登录</span>
        </button>
      </div>
      <p className="py-4 text-center text-[10px] text-black/25">美团 v10.18.0 · 数据仅保存在本机 · 按账号隔离 · {idpLabel}</p>
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
  const [paySel, setPaySel] = useState<MtPayChannel | null>(null);
  const [paySheet, setPaySheet] = useState(false);
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

  const openPay = useCallback((o: MtOrder, sel: MtPayChannel | null) => {
    setPayFor(o);
    setPaySel(sel);
    // 支付流程（需求）：未选渠道时先弹「选择支付方式」（先微信/QQ，再渠道），选完进入确认支付
    setPaySheet(sel === null);
  }, []);

  const openMerchant = useCallback((id: string) => {
    setMerchantId(id);
    setPage('merchant');
  }, []);

  const openOrder = useCallback((id: string, from: 'orders' | 'merchant' = 'orders') => {
    setOrderId(id);
    setOrderFrom(from);
    setPage('orderDetail');
  }, []);

  const openDeal = useCallback((id: string) => {
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
                onToast={showToast}
              />
            )}
            {tab === 'my' && (
              <MyPage
                session={session}
                onOpenOrders={goOrders}
                onOpenAddresses={() => setPage('addresses')}
                onOpenAbout={() => setPage('about')}
                onLogout={logout}
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
          onToast={showToast}
        />
      )}
      {page === 'addresses' && (
        <AddressesPage
          session={session}
          onBack={() => setPage('main')}
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
          <button type="button" onClick={() => setPage('main')} className="mt-6 rounded-full bg-[#FFD100] px-8 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
            返回首页
          </button>
        </div>
      )}

      {/* 弹层 */}
      {addrPicker && <AddressPickerSheet uid={uid} onClose={() => setAddrPicker(false)} onPicked={pickAddr} onManage={() => setPage('addresses')} />}

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

      {paySheet && payFor && (
        <PayMethodSheet
          key={payFor.id}
          amount={payFor.total}
          selected={paySel}
          onSelect={(c) => {
            setPaySel(c);
            setPaySheet(false);
          }}
          onClose={() => {
            setPaySheet(false);
            if (!paySel) {
              // 未选渠道就关闭 → 取消支付，回到来源页（订单保持待支付，可继续支付）
              setPayFor(null);
            }
          }}
          onToast={showToast}
        />
      )}
      {payFor && !paySheet && (
        <PayConfirmSheet
          key={payFor.id}
          order={payFor}
          channel={paySel}
          onChangeChannel={() => setPaySheet(true)}
          onClose={() => {
            setPayFor(null);
            setPaySel(null);
          }}
          onPaid={(o) => {
            setPayFor(null);
            setPaySel(null);
            setOrderId(o.id);
            setOrderFrom('orders');
            setTab('orders');
            setPage('orderDetail');
          }}
          onToast={showToast}
        />
      )}

      <LocalToast msg={toastMsg} />
    </div>
  );
}
