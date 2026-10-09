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
import Image from 'next/image';
import {
  ArrowLeft,
  Bell,
  Camera,
  ChevronRight,
  CircleCheck,
  Copy,
  CreditCard,
  Heart,
  Home as HomeIcon,
  MapPin,
  MessageSquare,
  Minus,
  Plus,
  ScanLine,
  Search,
  Settings as SettingsIcon,
  ShoppingBag,
  ShoppingCart,
  Star,
  Ticket,
  Trash2,
  Truck,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { useUI } from '@/lib/ios/store';
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
  tbPushFoot,
  tbPushMsg,
  tbPushSearchHist,
  tbRemoveCartItems,
  tbResolveIdpIdentity,
  tbSaveAddrs,
  tbSaveCart,
  tbSetCartAllChecked,
  tbSetCurAddr,
  tbSetSession,
  tbStartOrderWatcher,
  tbStatusText,
  tbSubmitReview,
  tbCurAddr,
  tbCurAddrId,
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
    <div className={`sticky top-0 z-30 flex h-12 items-center gap-2 px-3 ${light ? 'bg-[#FF5000] text-white' : 'bg-white text-black/90'}`}>
      {onBack ? (
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ArrowLeft className="h-[22px] w-[22px]" strokeWidth={2.2} />
        </button>
      ) : null}
      <span className="flex-1 truncate text-center text-[17px] font-semibold">{title}</span>
      <div className="flex min-w-[36px] items-center justify-end gap-1">{right}</div>
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

/** 天猫角标 */
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
            className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#07C160] text-[15px] font-medium text-white active:opacity-80 disabled:opacity-60"
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
            className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#12B7F5] text-[15px] font-medium text-white active:opacity-80 disabled:opacity-60"
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
              className={`flex h-10 items-center justify-center gap-1.5 rounded-full border text-[14px] ${idp === 'wx' ? 'border-[#07C160] bg-[#07C160]/10 text-[#07C160]' : 'border-black/10 text-black/70'}`}
            >
              <span className={`h-2 w-2 rounded-full ${idp === 'wx' ? 'bg-[#07C160]' : 'bg-black/20'}`} />
              微信账密
            </button>
            <button
              type="button"
              onClick={() => pickIdp('qq')}
              className={`flex h-10 items-center justify-center gap-1.5 rounded-full border text-[14px] ${idp === 'qq' ? 'border-[#12B7F5] bg-[#12B7F5]/10 text-[#12B7F5]' : 'border-black/10 text-black/70'}`}
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
                className="h-11 w-full rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[15px] font-semibold text-white active:opacity-80 disabled:opacity-50"
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
            {agree ? <CircleCheck className="h-3 w-3 text-white" strokeWidth={3} /> : null}
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
              <button type="button" onClick={() => setAuth(null)} className="h-11 rounded-full bg-black/[0.05] text-[15px] text-black/70 active:opacity-80">
                拒绝
              </button>
              <button type="button" onClick={confirmAuth} disabled={busy} className="h-11 rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[15px] font-semibold text-white active:opacity-80 disabled:opacity-60">
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

type HomeFeedTab = 'follow' | 'rec' | 'flash' | 'subsidy' | 'wear';

function HomePage({
  session,
  uid,
  onOpenSearch,
  onOpenProduct,
  onOpenMsgs,
  onOpenCart,
  onToast,
  cartCount,
}: {
  session: TbSession;
  uid: string;
  onOpenSearch: (seed?: string) => void;
  onOpenProduct: (pid: string) => void;
  onOpenMsgs: () => void;
  onOpenCart: () => void;
  onToast: (m: string) => void;
  cartCount: number;
}) {
  const feedTabs: { id: HomeFeedTab; label: string }[] = [
    { id: 'follow', label: '关注' },
    { id: 'rec', label: '推荐' },
    { id: 'flash', label: '闪购' },
    { id: 'subsidy', label: '国补' },
    { id: 'wear', label: '穿搭' },
  ];
  const [feedTab, setFeedTab] = useState<HomeFeedTab>('rec');
  const [refreshKey, setRefreshKey] = useState(0);
  const [batch, setBatch] = useState(1);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [pullY, setPullY] = useState(0);
  const pullStart = useRef<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const follows = tbLoadShopFollows(uid);

  // 上滑加载更多
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400) {
      setBatch((b) => Math.min(20, b + 1));
    }
  }, []);

  // 下拉刷新（触摸）
  const onTouchStart = (e: React.TouchEvent) => {
    const el = scrollerRef.current;
    if (el && el.scrollTop <= 0) pullStart.current = e.touches[0].clientY;
    else pullStart.current = null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (pullStart.current == null) return;
    const dy = e.touches[0].clientY - pullStart.current;
    if (dy > 0) setPullY(Math.min(90, dy * 0.45));
  };
  const onTouchEnd = () => {
    if (pullY > 40) {
      setRefreshing(true);
      setPullY(46);
      setTimeout(() => {
        setRefreshKey((k) => k + 1);
        setBatch(1);
        setRefreshing(false);
        setPullY(0);
        onToast('已为你推荐新的好物');
      }, 800);
    } else setPullY(0);
    pullStart.current = null;
  };

  // 推荐池：按 tab 过滤 + 分页追加（不同批取不同图变体）
  const pool = useMemo(() => {
    let list = [...TB_PRODUCTS];
    if (feedTab === 'flash') list = list.filter((p) => p.promo === '超级88');
    else if (feedTab === 'subsidy') list = list.filter((p) => p.promo === '百亿补贴' || p.promo === '国补');
    else if (feedTab === 'wear') list = list.filter((p) => p.cat === 'fashion');
    // 确定性洗牌（refreshKey 参与：下拉刷新换一批）
    let h = 7 + refreshKey * 131;
    list = list
      .map((p) => {
        let x = 0;
        for (let i = 0; i < p.id.length; i++) x = (x * 31 + p.id.charCodeAt(i)) >>> 0;
        return { p, k: (x + h * 7919) % 100003 };
      })
      .sort((a, b) => a.k - b.k)
      .map((x) => x.p);
    return list;
  }, [feedTab, refreshKey]);

  const feed = useMemo(() => {
    const n = Math.min(pool.length * 3, 12 + batch * 8);
    const out: { p: TbProduct; v: number }[] = [];
    for (let i = 0; i < n; i++) {
      const p = pool[i % pool.length];
      out.push({ p, v: (Math.floor(i / pool.length) + refreshKey) % 4 });
    }
    return out;
  }, [pool, batch, refreshKey]);

  return (
    <div
      ref={scrollerRef}
      className="h-full overflow-y-auto overscroll-contain bg-[#f4f4f4]"
      onScroll={onScroll}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* 顶部品牌区（橙红渐变，含 tab + 搜索框 + 图标宫格背景） */}
      <div className="relative bg-gradient-to-b from-[#FF6A1E] via-[#FF6A1E] to-[#FF6A1E]/90 pb-3">
        {/* 顶部 feed tab */}
        <div className="flex items-center gap-5 overflow-x-auto px-4 pb-1 pt-[58px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {feedTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFeedTab(t.id)}
              className={`relative shrink-0 pb-1.5 text-[19px] font-semibold transition-colors ${feedTab === t.id ? 'text-white' : 'text-white/70'}`}
            >
              {t.label}
              {feedTab === t.id ? <span className="absolute inset-x-1 -bottom-0 h-[3px] rounded-full bg-white" /> : null}
            </button>
          ))}
        </div>
        {/* 搜索框（扫码 / 相机 / 搜索按钮）+ 消息入口 */}
        <div className="flex items-center gap-2 px-3 pt-2">
          <button
            type="button"
            onClick={() => onOpenSearch('')}
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-white pl-2.5 pr-1"
          >
            <ScanLine className="ml-0.5 h-[20px] w-[20px] shrink-0 text-[#FF5000]" strokeWidth={2.2} />
            <span className="h-4 w-px shrink-0 bg-black/10" />
            <span className="min-w-0 flex-1 truncate text-left text-[14px] text-black/40">超长续航蓝牙耳机</span>
            <Camera className="h-[19px] w-[19px] shrink-0 text-black/45" strokeWidth={2} />
            <span className="grid h-[32px] shrink-0 place-items-center rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-4 text-[14px] font-semibold text-white">搜索</span>
          </button>
          <button type="button" aria-label="消息" onClick={onOpenMsgs} className="relative grid h-10 w-9 shrink-0 place-items-center text-white active:opacity-70">
            <MessageSquare className="h-[21px] w-[21px]" strokeWidth={2.1} />
            {tbLoadMsgs(uid).length > 0 ? <span className="absolute right-1 top-1.5 h-2 w-2 rounded-full bg-white ring-2 ring-[#FF6A1E]" /> : null}
          </button>
        </div>
        {/* 分类宫格（需求：数码/服饰/家居/美妆/食品/图书） */}
        <div className="mt-3 grid grid-cols-6 px-2">
          {TB_CATS.map((c) => (
            <button key={c.id} type="button" onClick={() => onOpenSearch(c.name)} className="flex flex-col items-center gap-1 py-1 active:opacity-70">
              <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-white/90 shadow-sm">
                <img src={tbImg(c.tag, 88, 88, 1)} alt={c.name} className="h-full w-full object-cover" draggable={false} />
              </span>
              <span className="text-[11px] font-medium text-white">{c.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 运营位：直播 / 百亿补贴（演示装饰） */}
      <div className="mt-2 grid grid-cols-2 gap-2 px-2">
        <button type="button" onClick={() => onToast('淘宝直播（演示）')} className="flex flex-col rounded-xl bg-gradient-to-br from-[#fff1e8] to-[#ffe3d2] p-3 text-left active:opacity-80">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-bold text-[#7a3b12]">淘宝直播</span>
            <span className="rounded-full bg-[#FF2D7E] px-1.5 py-0.5 text-[10px] font-bold text-white">直播有好价</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            <img src={tbImg('earbuds', 140, 100, 2)} alt="直播好物" className="h-14 w-1/2 rounded-lg object-cover" draggable={false} />
            <img src={tbImg('phone', 140, 100, 2)} alt="直播好物" className="h-14 w-1/2 rounded-lg object-cover" draggable={false} />
          </div>
        </button>
        <button type="button" onClick={() => onToast('百亿补贴（演示）')} className="flex flex-col rounded-xl bg-gradient-to-br from-[#fff4f4] to-[#ffe0e0] p-3 text-left active:opacity-80">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-bold text-[#8a1f1f]">百亿补贴</span>
            <span className="rounded-full bg-[#FF0036] px-1.5 py-0.5 text-[10px] font-bold text-white">国家补贴</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            <img src={tbImg('toy', 140, 100, 2)} alt="补贴好物" className="h-14 w-1/2 rounded-lg object-cover" draggable={false} />
            <img src={tbImg('laptop', 140, 100, 2)} alt="补贴好物" className="h-14 w-1/2 rounded-lg object-cover" draggable={false} />
          </div>
        </button>
      </div>

      {/* 超级88 横条（装饰） */}
      <button type="button" onClick={() => onToast('超级88 领券中心（演示）')} className="mx-2 mt-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-xl bg-gradient-to-r from-[#FF2D2D] to-[#FF5000] px-3 py-2.5 text-left active:opacity-90">
        <span className="text-[16px] font-black italic text-white">超级88</span>
        <span className="flex-1 truncate text-[13px] text-white/95">叠加大额消费券 7.7 折起，速抢</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-[#FF4400]">去抢购</span>
      </button>

      {/* 推荐商品流（双列瀑布） */}
      {feedTab === 'follow' ? (
        <FollowFeed uid={uid} follows={follows} onOpenProduct={onOpenProduct} onOpenSearch={() => setFeedTab('rec')} />
      ) : (
        <div className="mt-2 flex items-start gap-2 px-2 pb-24">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {feed.filter((_, i) => i % 2 === 0).map(({ p, v }, i) => (
              <ProductCard key={`${p.id}-${v}-${i}`} p={p} v={v} onOpen={() => onOpenProduct(p.id)} />
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {feed.filter((_, i) => i % 2 === 1).map(({ p, v }, i) => (
              <ProductCard key={`${p.id}-${v}-${i}`} p={p} v={v} onOpen={() => onOpenProduct(p.id)} />
            ))}
          </div>
        </div>
      )}

      {/* 下拉刷新指示器 */}
      {(pullY > 0 || refreshing) && (
        <div className="pointer-events-none fixed left-0 right-0 top-[120px] z-40 grid place-items-center" style={{ transform: `translateY(${pullY - 40}px)` }}>
          <div className={`flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13px] text-black/60 shadow-lg ${refreshing ? 'animate-pulse' : ''}`}>
            <ScanLine className={`h-4 w-4 text-[#FF5000] ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? '正在刷新…' : pullY > 40 ? '松开刷新' : '下拉刷新'}
          </div>
        </div>
      )}
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
              <button type="button" onClick={onOpenSearch} className="rounded-full bg-[#FF5000] px-3.5 py-1.5 text-[13px] font-medium text-white active:opacity-80">
                进店逛逛
              </button>
            </div>
          ))}
        </div>
      </div>
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
          className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium ${followed ? 'bg-black/[0.06] text-black/50' : 'bg-[#FF5000] text-white'} active:opacity-80`}
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
                <button key={h} type="button" onClick={() => go(h)} className="rounded-full bg-black/[0.04] px-3 py-1.5 text-[13px] text-black/70 active:bg-black/[0.08]">
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
                className={`rounded-full px-3 py-1.5 text-[13px] active:opacity-70 ${i < 2 ? 'bg-[#FF5000]/[0.08] font-medium text-[#FF5000]' : 'bg-black/[0.04] text-black/70'}`}
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
            className={`rounded-full px-2.5 py-1 text-[12px] ${onlyFree ? 'bg-[#FF5000] font-medium text-white' : 'bg-black/[0.05] text-black/60'}`}
          >
            包邮
          </button>
          <button
            type="button"
            onClick={() => setOnlyTmall((v) => !v)}
            className={`rounded-full px-2.5 py-1 text-[12px] ${onlyTmall ? 'bg-[#FF0036] font-medium text-white' : 'bg-black/[0.05] text-black/60'}`}
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
            <button type="button" onClick={onBack} className="mt-4 rounded-full bg-[#FF5000] px-5 py-2 text-[14px] font-medium text-white active:opacity-80">
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
function SkuSheet({
  p,
  onClose,
  onConfirm,
  mode,
}: {
  p: TbProduct;
  onClose: () => void;
  onConfirm: (sku: Record<string, string>, qty: number) => void;
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
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div className="max-h-[78%] overflow-y-auto rounded-t-2xl bg-white pb-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-3 p-4">
          <img src={skuImg} alt={p.title} className="h-[92px] w-[92px] rounded-lg object-cover" draggable={false} />
          <div className="min-w-0 flex-1 pt-1">
            <Price value={price} size={22} />
            {p.originPrice ? <span className="ml-2 text-[12px] text-black/30 line-through">¥{fmtMoney(p.originPrice)}</span> : null}
            <div className="mt-1 text-[12px] text-black/40">已售{tbSalesText(p.sales)}</div>
            <div className="mt-1 line-clamp-2 text-[13px] text-black/60">{Object.entries(sel).map(([k, v]) => `${k}：${v}`).join('；') || '请选择规格'}</div>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-black/[0.04]">
            <X className="h-4 w-4 text-black/60" strokeWidth={2.4} />
          </button>
        </div>
        {p.skus.map((g) => (
          <div key={g.name} className="px-4 pb-1 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold text-black/85">{g.name}</span>
              <span className="text-[12px] text-black/35">大图</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {g.options.map((o) => {
                const active = sel[g.name] === o.label;
                return (
                  <button
                    key={o.label}
                    type="button"
                    disabled={o.soldOut}
                    onClick={() => setSel((s) => ({ ...s, [g.name]: o.label }))}
                    className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-[13px] ${
                      o.soldOut
                        ? 'border-black/[0.06] text-black/25'
                        : active
                          ? 'border-[#FF5000] bg-[#FF5000]/[0.06] font-medium text-[#FF5000]'
                          : 'border-black/10 text-black/70'
                    }`}
                  >
                    {o.img ? <img src={o.img} alt={o.label} className={`h-7 w-7 rounded-full object-cover ${o.soldOut ? 'opacity-40' : ''}`} draggable={false} /> : null}
                    {o.label}
                    {o.priceDelta ? <span className="text-[11px] opacity-70">+{o.priceDelta}</span> : null}
                    {o.soldOut ? <span className="text-[10px]">缺货</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <span className="text-[15px] font-semibold text-black/85">购买数量</span>
          <div className="flex items-center gap-3 rounded-full bg-black/[0.04] px-2 py-1">
            <button type="button" aria-label="减少" onClick={() => setQty((q) => Math.max(1, q - 1))} className="grid h-7 w-7 place-items-center rounded-full bg-white text-black/70 shadow-sm active:opacity-70">
              <Minus className="h-4 w-4" strokeWidth={2.4} />
            </button>
            <span className="min-w-[22px] text-center text-[15px] font-medium">{qty}</span>
            <button type="button" aria-label="增加" onClick={() => setQty((q) => Math.min(99, q + 1))} className="grid h-7 w-7 place-items-center rounded-full bg-white text-black/70 shadow-sm active:opacity-70">
              <Plus className="h-4 w-4" strokeWidth={2.4} />
            </button>
          </div>
        </div>
        <div className="px-4 pt-2">
          <button
            type="button"
            disabled={!ready}
            onClick={() => ready && onConfirm(sel, qty)}
            className="h-12 w-full rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[16px] font-semibold text-white active:opacity-85 disabled:opacity-50"
          >
            {mode === 'cart' ? '加入购物车' : '立即购买'}
          </button>
        </div>
      </div>
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
}: {
  pid: string;
  uid: string;
  onBack: () => void;
  onToast: (m: string) => void;
  onCartChanged: () => void;
  onOpenShop: (shopId: string) => void;
  onOpenCheckout: (items: TbOrderItem[]) => void;
  onOpenReviews: () => void;
}) {
  const p = productById(pid);
  const [faved, setFaved] = useState(() => tbLoadFavs(uid).includes(pid));
  const [skuMode, setSkuMode] = useState<'cart' | 'buy' | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
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
  const confirmSku = (sku: Record<string, string>, qty: number) => {
    if (skuMode === 'cart') {
      tbAddToCart(uid, p.id, sku, qty);
      onCartChanged();
      setSkuMode(null);
      onToast('已加入购物车');
    } else {
      setSkuMode(null);
      onOpenCheckout([{ pid: p.id, title: p.title, img: tbImg(p.tag, 300, 300, 0), sku, price: skuPriceOf(p, sku), qty }]);
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
      </div>

      {/* 底部操作栏（店铺/客服/收藏 + 加购/立即购买） */}
      <div className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-1 border-t border-black/[0.06] bg-white/95 px-3 pb-6 pt-2 backdrop-blur-md">
        <button type="button" onClick={() => onOpenShop(shop.id)} className="flex w-[52px] flex-col items-center gap-0.5 active:opacity-60">
          <ShoppingBag className="h-[20px] w-[20px] text-black/70" strokeWidth={2} />
          <span className="text-[10px] text-black/50">店铺</span>
        </button>
        <button type="button" onClick={() => onToast('客服（演示）')} className="flex w-[52px] flex-col items-center gap-0.5 active:opacity-60">
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
          <span className={`text-[10px] ${faved ? 'text-[#FFA400]' : 'text-black/50'}`}>收藏</span>
        </button>
        <div className="ml-1 flex min-w-0 flex-1 gap-2">
          <button type="button" onClick={() => openSku('cart')} className="h-11 min-w-0 flex-1 rounded-l-full bg-[#FFA400] text-[15px] font-semibold text-white active:opacity-85">
            加入购物车
          </button>
          <button type="button" onClick={() => openSku('buy')} className="h-11 min-w-0 flex-1 rounded-r-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[15px] font-semibold text-white active:opacity-85">
            立即购买
          </button>
        </div>
      </div>

      {skuMode ? <SkuSheet p={p} mode={skuMode} onClose={() => setSkuMode(null)} onConfirm={confirmSku} /> : null}
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
}: {
  uid: string;
  onBack?: () => void;
  onOpenProduct: (pid: string) => void;
  onCheckout: (items: TbOrderItem[]) => void;
  onToast: (m: string) => void;
  onOpenHome: () => void;
}) {
  const [items, setItems] = useState<TbCartItem[]>(() => tbLoadCart(uid));
  const [manage, setManage] = useState(false);
  const reload = () => setItems(tbLoadCart(uid));
  const checkedItems = items.filter((c) => c.checked);
  const total = checkedItems.reduce((n, c) => {
    const p = productById(c.pid);
    return p ? n + skuPriceOf(p, c.sku) * c.qty : n;
  }, 0);

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

  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <div className="sticky top-0 z-30 bg-white px-3 pb-2 pt-[58px]">
        <div className="flex items-center">
          {onBack ? (
            <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
              <ArrowLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
            </button>
          ) : <span className="w-9" />}
          <span className="flex-1 text-center text-[17px] font-semibold text-black/90">购物车</span>
          <button type="button" onClick={() => setManage((v) => !v)} className="w-9 text-right text-[15px] text-black/70">
            {manage ? '完成' : '管理'}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto pb-32">
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
          <div className="space-y-2 px-2 pt-2">
            {items.map((c) => {
              const p = productById(c.pid);
              if (!p) return null;
              const sig = c.sku && Object.keys(c.sku).length ? Object.keys(c.sku).sort().map((k) => `${k}:${c.sku[k]}`).join('|') : '';
              return (
                <div key={`${c.pid}|${sig}`} className="flex gap-2.5 rounded-xl bg-white p-3">
                  <button
                    type="button"
                    aria-label={c.checked ? '取消勾选' : '勾选'}
                    onClick={() => {
                      tbUpdateCartItem(uid, c.pid, sig, { checked: !c.checked });
                      reload();
                    }}
                    className={`mt-8 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${c.checked ? 'border-[#FF5000] bg-[#FF5000]' : 'border-black/20'}`}
                  >
                    {c.checked ? <CircleCheck className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
                  </button>
                  <button type="button" onClick={() => onOpenProduct(c.pid)} className="shrink-0 active:opacity-70">
                    <img src={tbImg(p.tag, 200, 200, 0)} alt={p.title} className="h-[88px] w-[88px] rounded-lg object-cover" draggable={false} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => onOpenProduct(c.pid)} className="block w-full text-left">
                      <div className="line-clamp-2 text-[13px] leading-[18px] text-black/85">{p.title}</div>
                    </button>
                    <div className="mt-0.5 truncate text-[11px] text-black/35">
                      {Object.entries(c.sku).map(([k, v]) => `${k}：${v}`).join('；')}
                    </div>
                    <div className="mt-1 flex items-center">
                      <Price value={skuPriceOf(p, c.sku)} size={16} />
                      <div className="ml-auto flex items-center gap-2.5">
                        <button
                          type="button"
                          aria-label="减少数量"
                          onClick={() => {
                            // 数量减到 0 自动移除（需求）
                            tbUpdateCartItem(uid, c.pid, sig, { qty: c.qty - 1 });
                            reload();
                            if (c.qty <= 1) onToast('已从购物车移除');
                          }}
                          className="grid h-6 w-6 place-items-center rounded-full border border-black/15 text-black/60 active:opacity-60"
                        >
                          <Minus className="h-3.5 w-3.5" strokeWidth={2.6} />
                        </button>
                        <span className="min-w-[18px] text-center text-[14px]">{c.qty}</span>
                        <button
                          type="button"
                          aria-label="增加数量"
                          onClick={() => {
                            tbUpdateCartItem(uid, c.pid, sig, { qty: c.qty + 1 });
                            reload();
                          }}
                          className="grid h-6 w-6 place-items-center rounded-full border border-black/15 text-black/60 active:opacity-60"
                        >
                          <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {manage ? (
              <div className="flex items-center justify-between rounded-xl bg-white p-3">
                <span className="text-[14px] text-black/70">勾选 {checkedItems.length} 件商品</span>
                <button
                  type="button"
                  onClick={() => {
                    if (checkedItems.length === 0) {
                      onToast('请先勾选要删除的商品');
                      return;
                    }
                    tbRemoveCartItems(
                      uid,
                      checkedItems.map((c) => ({ pid: c.pid, sig: Object.keys(c.sku).sort().map((k) => `${k}:${c.sku[k]}`).join('|') }))
                    );
                    reload();
                    setManage(false);
                    onToast('已删除所选商品');
                  }}
                  className="rounded-full border border-[#FF5000] px-4 py-1.5 text-[13px] font-medium text-[#FF5000] active:opacity-70"
                >
                  删除所选
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* 底部：全选 / 合计 / 结算 */}
      {items.length > 0 ? (
        <div className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-black/[0.06] bg-white/95 px-3 pb-6 pt-2 backdrop-blur-md">
          <button
            type="button"
            onClick={() => {
              tbSetCartAllChecked(uid, checkedItems.length < items.length);
              reload();
            }}
            className="flex items-center gap-1.5"
          >
            <span className={`grid h-[18px] w-[18px] place-items-center rounded-full border-2 ${checkedItems.length === items.length ? 'border-[#FF5000] bg-[#FF5000]' : 'border-black/20'}`}>
              {checkedItems.length === items.length ? <CircleCheck className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
            </span>
            <span className="text-[13px] text-black/70">全选</span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[13px] text-black/50">合计：</span>
            <Price value={total} size={20} />
            <button
              type="button"
              onClick={checkout}
              className={`ml-1 h-10 rounded-full px-6 text-[15px] font-semibold text-white ${checkedItems.length > 0 ? 'bg-gradient-to-r from-[#FF7A21] to-[#FF4400] active:opacity-85' : 'bg-black/20'}`}
            >
              结算{checkedItems.length > 0 ? `(${checkedItems.length})` : ''}
            </button>
          </div>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 z-30 border-t border-black/[0.06] bg-white/95 px-3 pb-6 pt-2 backdrop-blur-md">
          <button type="button" onClick={onOpenHome} className="h-10 w-full rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[15px] font-semibold text-white active:opacity-85">
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
                        className="grid h-6 w-6 place-items-center rounded-full border border-black/15 text-black/60 active:opacity-60"
                      >
                        <Minus className="h-3.5 w-3.5" strokeWidth={2.6} />
                      </button>
                      <span className="min-w-[18px] text-center text-[14px]">{qty}</span>
                      <button
                        type="button"
                        aria-label="增加"
                        onClick={() => setQtyOverride((q) => ({ ...q, [it.pid + it.img]: Math.min(99, qty + 1) }))}
                        className="grid h-6 w-6 place-items-center rounded-full border border-black/15 text-black/60 active:opacity-60"
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
        <button type="button" onClick={submit} className="h-11 rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-8 text-[15px] font-semibold text-white active:opacity-85">
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
      onSuccess(orderId);
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" onClick={paying ? undefined : onClose}>
      <div className="rounded-t-2xl bg-white pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="relative flex flex-col items-center pb-3 pt-4">
          <span className="text-[16px] font-semibold text-black/85">收银台</span>
          <button type="button" aria-label="关闭" onClick={onClose} disabled={paying} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/[0.04] disabled:opacity-40">
            <X className="h-4 w-4 text-black/60" strokeWidth={2.4} />
          </button>
        </div>
        <div className="pb-3 text-center">
          <span className="text-[13px] text-black/45">应付金额</span>
          <div className="mt-1">
            <Price value={amount} size={34} />
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto px-4">
          {chans === null ? (
            <div className="grid place-items-center py-10 text-[14px] text-black/40">正在获取支付方式…</div>
          ) : chans.length === 0 ? (
            <div className="py-8 text-center text-[14px] text-black/40">
              暂无可用支付方式
              <div className="mt-1 text-[12px] text-black/35">请先在微信/QQ 中开通钱包或添加银行卡</div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* 渠道分组标签 */}
              {(['wx', 'qq'] as const).map((idp) => {
                const list = chans.filter((c) => c.idp === idp);
                if (list.length === 0) return null;
                return (
                  <div key={idp}>
                    <div className="px-1 pb-1 pt-2 text-[12px] font-medium text-black/35">{idp === 'wx' ? '微信支付' : 'QQ支付'}</div>
                    {list.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        disabled={paying}
                        onClick={() => {
                          setSel(c.key);
                          setErrMsg(c.insufficient ? '该渠道额度不足，请选择其他支付方式' : '');
                        }}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left ${sel === c.key ? 'border-[#FF5000] bg-[#FF5000]/[0.04]' : 'border-black/[0.08]'} ${c.insufficient ? 'opacity-50' : ''}`}
                      >
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-white ${c.idp === 'wx' ? 'bg-[#07C160]' : 'bg-[#12B7F5]'}`}>
                          {c.isFc ? <Heart className="h-4.5 w-4.5" strokeWidth={2.2} /> : c.methodId === 'balance' ? <Wallet className="h-[18px] w-[18px]" strokeWidth={2.2} /> : <CreditCard className="h-[18px] w-[18px]" strokeWidth={2.2} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-medium text-black/85">{c.label}</span>
                          <span className="block truncate text-[12px] text-black/40">{c.sub}</span>
                        </span>
                        {c.insufficient ? <span className="shrink-0 text-[12px] text-red-400">额度不足</span> : null}
                        <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${sel === c.key && !c.insufficient ? 'border-[#FF5000] bg-[#FF5000]' : 'border-black/20'}`}>
                          {sel === c.key && !c.insufficient ? <CircleCheck className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {errMsg ? <div className="px-4 pt-2 text-center text-[12px] text-red-500">{errMsg}</div> : null}
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={pay}
            disabled={paying || !selChan || chans?.length === 0}
            className="h-12 w-full rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[16px] font-semibold text-white active:opacity-85 disabled:opacity-50"
          >
            {paying ? '正在支付…' : `立即支付 ¥${fmtMoney(amount)}`}
          </button>
          {selChan?.isFc ? <div className="pt-1.5 text-center text-[11px] text-black/35">使用亲属卡支付后，赠卡人将收到消费通知</div> : null}
        </div>
      </div>
    </div>
  );
}

// ---------------- 订单列表 ----------------

function OrdersPage({
  uid,
  initialTab,
  onBack,
  onOpenOrder,
  onToast,
  onPayOrder,
  onOpenProduct,
}: {
  uid: string;
  initialTab: TbOrderStatus | 'all';
  onBack: () => void;
  onOpenOrder: (id: string) => void;
  onToast: (m: string) => void;
  onPayOrder: (id: string) => void;
  onOpenProduct: (pid: string) => void;
}) {
  const [tab, setTab] = useState<TbOrderStatus | 'all'>(initialTab);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  // 打开时 catch-up 状态推进
  useEffect(() => {
    tbTickOrders(uid);
  }, [uid]);
  const orders = tbLoadOrders(uid).filter((o) => (tab === 'all' ? true : o.status === tab));
  const tabs: { id: TbOrderStatus | 'all'; label: string }[] = [
    { id: 'all', label: '全部' },
    { id: 'pendingPay', label: '待付款' },
    { id: 'pendingDeliver', label: '待发货' },
    { id: 'shipped', label: '待收货' },
    { id: 'completed', label: '已完成' },
    { id: 'cancelled', label: '已取消' },
  ];
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <div className="sticky top-0 z-30 bg-white pt-[58px]">
        <div className="flex items-center px-3">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ArrowLeft className="h-[22px] w-[22px] text-black/80" strokeWidth={2.2} />
          </button>
          <span className="flex-1 text-center text-[17px] font-semibold text-black/90">我的订单</span>
          <span className="w-9" />
        </div>
        <div className="mt-1 flex items-center gap-5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`relative shrink-0 pb-2 text-[15px] ${tab === t.id ? 'font-semibold text-[#FF5000]' : 'text-black/60'}`}>
              {t.label}
              {tab === t.id ? <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-[#FF5000]" /> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto pb-10">
        {orders.length === 0 ? (
          <div className="grid place-items-center bg-white py-16">
            <ShoppingBag className="h-12 w-12 text-black/10" strokeWidth={1.6} />
            <div className="mt-3 text-[15px] text-black/45">暂无相关订单</div>
          </div>
        ) : (
          <div className="space-y-2 px-2 pt-2">
            {orders.map((o) => (
              <OrderCard key={o.id} o={o} uid={uid} onOpen={() => onOpenOrder(o.id)} onPay={() => onPayOrder(o.id)} onToast={onToast} onOpenProduct={onOpenProduct} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 订单卡（列表项，含状态操作按钮） */
function OrderCard({ o, uid, onOpen, onPay, onToast, onOpenProduct }: { o: TbOrder; uid: string; onOpen: () => void; onPay: () => void; onToast: (m: string) => void; onOpenProduct: (pid: string) => void }) {
  const countdown = useCountdown(o.status === 'pendingPay' ? o.createdAt + TB_PAY_TTL : undefined);
  const st = tbStatusText(o);
  return (
    <div className="rounded-xl bg-white p-3">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-2">
        <span className="truncate text-[14px] font-semibold text-black/85">{o.shopName}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-black/30" />
        <span className={`ml-auto shrink-0 text-[13px] font-medium ${o.status === 'pendingPay' ? 'text-[#FF5000]' : o.status === 'completed' ? 'text-black/50' : o.status === 'cancelled' ? 'text-black/40' : 'text-[#FF6A1E]'}`}>
          {o.status === 'pendingPay' ? `${st} · 剩${countdown}` : st}
        </span>
      </button>
      <div className="mt-2 space-y-2">
        {o.items.map((it, i) => (
          <button key={i} type="button" onClick={() => onOpenProduct(it.pid)} className="flex w-full gap-2.5 text-left">
            <img src={it.img} alt={it.title} className="h-[72px] w-[72px] shrink-0 rounded-lg object-cover" draggable={false} />
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-[13px] leading-[18px] text-black/80">{it.title}</div>
              <div className="mt-0.5 truncate text-[11px] text-black/35">{Object.entries(it.sku).map(([k, v]) => `${k}：${v}`).join('；')}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[13px] text-black/70">¥{fmtMoney(it.price)}</div>
              <div className="mt-0.5 text-[11px] text-black/35">x{it.qty}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-black/[0.05] pt-2">
        <span className="text-[12px] text-black/45">
          {o.status === 'pendingPay' ? '应付' : '实付'} <span className="text-[15px] font-semibold text-black/85">¥{fmtMoney(o.total)}</span>
          {o.discount > 0 ? <span className="ml-1 text-[#FF4400]">（共减¥{fmtMoney(o.discount)}）</span> : null}
        </span>
        <div className="flex gap-2">
          {o.status === 'pendingPay' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (tbCancelOrder(uid, o.id, '买家主动取消')) {
                    onToast('订单已取消');
                  }
                }}
                className="rounded-full border border-black/12 px-3.5 py-1.5 text-[13px] text-black/60 active:opacity-70"
              >
                取消订单
              </button>
              <button type="button" onClick={onPay} className="rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-3.5 py-1.5 text-[13px] font-semibold text-white active:opacity-85">
                继续付款
              </button>
            </>
          ) : null}
          {o.status === 'shipped' ? (
            <button type="button" onClick={onOpen} className="rounded-full border border-black/12 px-3.5 py-1.5 text-[13px] text-black/60 active:opacity-70">
              查看物流
            </button>
          ) : null}
          {o.status === 'completed' ? (
            <button
              type="button"
              onClick={() => {
                const cart = o.items.map((it) => ({ pid: it.pid, sku: it.sku, qty: it.qty, checked: true, at: Date.now() }));
                for (const c of cart) tbAddToCart(uid, c.pid, c.sku, c.qty);
                onToast('已将订单商品加入购物车');
              }}
              className="rounded-full border border-[#FF5000] px-3.5 py-1.5 text-[13px] font-medium text-[#FF5000] active:opacity-70"
            >
              再来一单
            </button>
          ) : null}
          {o.status === 'cancelled' && !o.refund ? (
            <button
              type="button"
              onClick={() => {
                for (const it of o.items) tbAddToCart(uid, it.pid, it.sku, it.qty);
                onToast('已将订单商品加入购物车');
              }}
              className="rounded-full border border-[#FF5000] px-3.5 py-1.5 text-[13px] font-medium text-[#FF5000] active:opacity-70"
            >
              再来一单
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------- 订单详情 ----------------

function OrderDetailPage({
  uid,
  orderId,
  onBack,
  onToast,
  onPayOrder,
  onOpenProduct,
  onRate,
}: {
  uid: string;
  orderId: string;
  onBack: () => void;
  onToast: (m: string) => void;
  onPayOrder: (id: string) => void;
  onOpenProduct: (pid: string) => void;
  onRate: (id: string) => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  tbTickOrders(uid);
  const o = tbLoadOrders(uid).find((x) => x.id === orderId);
  // 倒计时 hook 无条件调用（hooks 规则：不能在早 return 之后）
  const countdown = useCountdown(o?.status === 'pendingPay' ? o.createdAt + TB_PAY_TTL : undefined);
  if (!o) {
    return (
      <div className="grid h-full place-items-center bg-white">
        <div className="text-[15px] text-black/40">订单不存在</div>
      </div>
    );
  }
  const st = tbStatusText(o);
  const copyOrderId = () => {
    try {
      void navigator.clipboard.writeText(o.id);
      onToast('订单号已复制');
    } catch {
      onToast('复制失败，请手动选择');
    }
  };
  /** 退款（原路退回） */
  const applyRefund = async () => {
    if (o.status === 'pendingDeliver' || o.status === 'shipped' || o.status === 'completed') {
      if (!o.payIdp || !o.payMethodId) {
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
    }
  };
  const subCopy = (() => {
    switch (o.status) {
      case 'pendingPay':
        return `请在 ${countdown} 内完成支付，超时订单自动取消`;
      case 'pendingDeliver':
        return '商家正在准备发货，请耐心等待';
      case 'shipped':
        return o.track.length >= TB_TRACK_NODES.length ? '包裹已到驿站，请及时取件或确认收货' : '包裹运输中，请留意物流更新';
      case 'completed':
        return '交易完成，感谢您的购买';
      case 'cancelled':
        return o.cancelReason ?? '订单已取消';
    }
  })();
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <TopBar title="订单详情" onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-10">
        {/* 状态头 */}
        <div className="bg-gradient-to-r from-[#FF6A1E] to-[#FF4400] px-4 py-4 text-white">
          <div className="text-[19px] font-bold">{o.status === 'cancelled' && o.refund ? '退款成功' : st}</div>
          <div className="mt-1 text-[13px] text-white/85">{subCopy}</div>
        </div>
        {/* 收货地址 */}
        {o.address ? (
          <div className="mt-2 flex items-start gap-2.5 bg-white px-4 py-3">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#FF5000]" strokeWidth={2.1} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold text-black/85">{o.address.name}</span>
                <span className="text-[13px] text-black/45">{o.address.phone.slice(0, 3)}****{o.address.phone.slice(7)}</span>
              </div>
              <div className="mt-0.5 text-[13px] leading-5 text-black/60">{o.address.region} {o.address.detail}</div>
            </div>
          </div>
        ) : null}
        {/* 物流信息 */}
        {o.status === 'shipped' || o.status === 'completed' ? (
          <div className="mt-2 bg-white px-4 py-3">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-[#FF5000]" />
              <span className="text-[14px] font-semibold text-black/85">物流信息</span>
              <span className="ml-auto text-[11px] text-black/35">圆通速递</span>
            </div>
            {o.track.length > 0 ? (
              <div className="mt-2 space-y-0">
                {[...o.track].reverse().map((t, i) => (
                  <div key={i} className="flex gap-2.5">
                    <div className="flex flex-col items-center">
                      <span className={`mt-1 h-2 w-2 rounded-full ${i === 0 ? 'bg-[#FF5000]' : 'bg-black/15'}`} />
                      {i < o.track.length - 1 ? <span className="my-0.5 w-px flex-1 bg-black/10" /> : null}
                    </div>
                    <div className="pb-3">
                      <div className={`text-[13px] ${i === 0 ? 'font-medium text-black/85' : 'text-black/55'}`}>{t.text}</div>
                      <div className="mt-0.5 text-[11px] text-black/35">{fmtTime(t.at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-[13px] text-black/40">暂无物流信息</div>
            )}
          </div>
        ) : null}
        {/* 商品 */}
        <div className="mt-2 bg-white px-4 py-3">
          <div className="flex items-center gap-2 pb-2">
            <span className="text-[14px] font-semibold text-black/85">{o.shopName}</span>
            <ChevronRight className="h-3.5 w-3.5 text-black/30" />
            <span className={`ml-auto text-[12px] ${o.status === 'pendingPay' ? 'text-[#FF5000]' : 'text-black/50'}`}>{o.status === 'pendingPay' ? `${st} · 剩${countdown}` : st}</span>
          </div>
          {o.items.map((it, i) => (
            <button key={i} type="button" onClick={() => onOpenProduct(it.pid)} className="flex w-full gap-2.5 py-1.5 text-left">
              <img src={it.img} alt={it.title} className="h-[72px] w-[72px] shrink-0 rounded-lg object-cover" draggable={false} />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[13px] leading-[18px] text-black/80">{it.title}</div>
                <div className="mt-0.5 truncate text-[11px] text-black/35">{Object.entries(it.sku).map(([k, v]) => `${k}：${v}`).join('；')}</div>
                <div className="mt-1 text-[11px] text-black/40">7天无理由退货</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[13px] text-black/70">¥{fmtMoney(it.price)}</div>
                <div className="mt-0.5 text-[11px] text-black/35">x{it.qty}</div>
              </div>
            </button>
          ))}
          {/* 价格明细 */}
          <div className="mt-2 space-y-1.5 border-t border-black/[0.05] pt-2.5 text-[13px]">
            <div className="flex justify-between">
              <span className="text-black/50">商品总价</span>
              <span className="text-black/80">¥{fmtMoney(o.itemTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-black/50">运费</span>
              <span className="text-black/80">{o.freight === 0 ? '免运费' : `¥${fmtMoney(o.freight)}`}</span>
            </div>
            {o.discount > 0 ? (
              <div className="flex justify-between">
                <span className="text-black/50">平台优惠</span>
                <span className="text-[#FF4400]">-¥{fmtMoney(o.discount)}</span>
              </div>
            ) : null}
            <div className="flex justify-between pt-1 text-[15px] font-semibold">
              <span className="text-black/85">{o.status === 'pendingPay' ? '需付款' : o.status === 'cancelled' && o.refund ? '退款金额' : '实付款'}</span>
              <Price value={o.total} size={19} />
            </div>
          </div>
        </div>
        {/* 订单信息 */}
        <div className="mt-2 space-y-2 bg-white px-4 py-3 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-black/50">订单编号</span>
            <span className="flex items-center gap-1 text-black/75">
              {o.id}
              <button type="button" aria-label="复制订单号" onClick={copyOrderId} className="grid h-6 w-6 place-items-center rounded-full bg-black/[0.04] active:opacity-60">
                <Copy className="h-3 w-3 text-black/50" />
              </button>
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-black/50">下单时间</span>
            <span className="text-black/75">{fmtFullTime(o.createdAt)}</span>
          </div>
          {o.paidAt ? (
            <div className="flex justify-between">
              <span className="text-black/50">支付方式</span>
              <span className="text-black/75">{o.payChannelLabel ?? (o.payIdp === 'wx' ? '微信支付' : 'QQ支付')}{o.payFc ? '（亲属卡）' : ''}</span>
            </div>
          ) : null}
        </div>
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
        {/* 操作按钮区 */}
        <div className="mt-3 flex flex-wrap justify-end gap-2 px-4">
          {o.status === 'pendingPay' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (tbCancelOrder(uid, o.id, '买家主动取消')) {
                    onToast('订单已取消');
                    setTick((n) => n + 1);
                  }
                }}
                className="rounded-full border border-black/12 px-4 py-2 text-[13px] text-black/60 active:opacity-70"
              >
                取消订单
              </button>
              <button type="button" onClick={() => onPayOrder(o.id)} className="rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-5 py-2 text-[13px] font-semibold text-white active:opacity-85">
                继续付款
              </button>
            </>
          ) : null}
          {o.status === 'pendingDeliver' ? (
            <>
              <button type="button" onClick={() => onToast('已提醒商家尽快发货')} className="rounded-full border border-black/12 px-4 py-2 text-[13px] text-black/60 active:opacity-70">
                提醒发货
              </button>
              <button type="button" onClick={() => void applyRefund()} className="rounded-full border border-black/12 px-4 py-2 text-[13px] text-black/60 active:opacity-70">
                申请退款
              </button>
            </>
          ) : null}
          {o.status === 'shipped' ? (
            <>
              <button type="button" onClick={() => void applyRefund()} className="rounded-full border border-black/12 px-4 py-2 text-[13px] text-black/60 active:opacity-70">
                退款
              </button>
              <button
                type="button"
                onClick={() => {
                  if (tbConfirmReceive(uid, o.id)) {
                    tbPushMsg(uid, { kind: 'logistics', title: '确认收货', text: `订单已确认收货 ¥${fmtMoney(o.total)}，记得评价哦`, orderId: o.id });
                    onToast('确认收货成功');
                    setTick((n) => n + 1);
                  }
                }}
                className="rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-5 py-2 text-[13px] font-semibold text-white active:opacity-85"
              >
                确认收货
              </button>
            </>
          ) : null}
          {o.status === 'completed' ? (
            <>
              <button type="button" onClick={() => void applyRefund()} className="rounded-full border border-black/12 px-4 py-2 text-[13px] text-black/60 active:opacity-70">
                申请退款
              </button>
              {!o.review ? (
                <button type="button" onClick={() => onRate(o.id)} className="rounded-full border border-[#FF5000] px-4 py-2 text-[13px] font-medium text-[#FF5000] active:opacity-70">
                  评价
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  for (const it of o.items) tbAddToCart(uid, it.pid, it.sku, it.qty);
                  onToast('已将订单商品加入购物车');
                }}
                className="rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-5 py-2 text-[13px] font-semibold text-white active:opacity-85"
              >
                再来一单
              </button>
            </>
          ) : null}
          {o.status === 'cancelled' && !o.refund ? (
            <button
              type="button"
              onClick={() => {
                for (const it of o.items) tbAddToCart(uid, it.pid, it.sku, it.qty);
                onToast('已将订单商品加入购物车');
              }}
              className="rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-5 py-2 text-[13px] font-semibold text-white active:opacity-85"
            >
              再来一单
            </button>
          ) : null}
        </div>
      </div>
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
              className={`rounded-full border px-3 py-1 text-[12px] ${tags.includes(t) ? 'border-[#FF5000] bg-[#FF5000]/[0.06] text-[#FF5000]' : 'border-black/10 text-black/55'}`}
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
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    tbTickOrders(uid);
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [uid]);
  const orders = tbLoadOrders(uid);
  const count = (st: TbOrderStatus) => orders.filter((o) => o.status === st).length;
  const coupons = tbLoadCoupons(uid).filter((c) => !c.usedAt);
  const favs = tbLoadFavs(uid);
  const foots = tbLoadFoots(uid);
  const follows = tbLoadShopFollows(uid);
  return (
    <div className="h-full overflow-y-auto bg-[#f4f4f4] pb-24">
      {/* 头部（橙渐变） */}
      <div className="bg-gradient-to-b from-[#FF7A21] to-[#FF9A50] px-4 pb-4 pt-[62px]">
        <div className="flex items-center gap-3">
          {session.avatar ? (
            <img src={session.avatar} alt={session.name} className="h-14 w-14 rounded-full border-2 border-white/70 object-cover" draggable={false} />
          ) : (
            <span className="grid h-14 w-14 place-items-center rounded-full border-2 border-white/70 bg-white/25 text-[20px] font-bold text-white">{session.name.slice(0, 1)}</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[18px] font-bold text-white">{session.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="rounded bg-gradient-to-r from-[#7A4310] to-[#9A5A1E] px-1.5 py-[1px] text-[10px] font-bold text-[#FFD9A0]">青铜会员</span>
              <span className="text-[11px] text-white/75">{follows.length}家关注店铺</span>
            </div>
          </div>
          <button type="button" onClick={onOpenAddresses} className="flex flex-col items-center gap-0.5 text-white/90">
            <MapPin className="h-[20px] w-[20px]" strokeWidth={2.1} />
            <span className="text-[10px]">地址</span>
          </button>
          <button type="button" onClick={() => onToast('官方客服（演示）')} className="flex flex-col items-center gap-0.5 text-white/90">
            <MessageSquare className="h-[20px] w-[20px]" strokeWidth={2.1} />
            <span className="text-[10px]">客服</span>
          </button>
          <button type="button" onClick={onOpenSettings} className="flex flex-col items-center gap-0.5 text-white/90">
            <SettingsIcon className="h-[20px] w-[20px]" strokeWidth={2.1} />
            <span className="text-[10px]">设置</span>
          </button>
        </div>
        {/* 资产条（账户余额 + 优惠券入口） */}
        <div className="mt-3 flex items-center rounded-xl bg-white/95 p-3 backdrop-blur">
          <button type="button" onClick={onOpenWallet} className="flex flex-1 flex-col items-center">
            <Wallet className="h-5 w-5 text-[#FF5000]" strokeWidth={2} />
            <span className="mt-1 text-[12px] font-semibold text-black/80">账户余额</span>
            <span className="text-[10px] text-black/40">微信 / QQ</span>
          </button>
          <span className="h-8 w-px bg-black/[0.06]" />
          <button type="button" onClick={onOpenCoupons} className="flex flex-1 flex-col items-center">
            <Ticket className="h-5 w-5 text-[#FF5000]" strokeWidth={2} />
            <span className="mt-1 text-[12px] font-semibold text-black/80">{coupons.length}张</span>
            <span className="text-[10px] text-black/40">优惠券</span>
          </button>
          <span className="h-8 w-px bg-black/[0.06]" />
          <button type="button" onClick={() => onToast('淘金币：888（演示）')} className="flex flex-1 flex-col items-center">
            <Star className="h-5 w-5 text-[#FFA400]" strokeWidth={2} />
            <span className="mt-1 text-[12px] font-semibold text-black/80">888</span>
            <span className="text-[10px] text-black/40">淘金币</span>
          </button>
          <span className="h-8 w-px bg-black/[0.06]" />
          <button type="button" onClick={() => onToast('红包 ¥0.00（演示）')} className="flex flex-1 flex-col items-center">
            <span className="grid h-5 w-5 place-items-center rounded bg-[#FF5000]/10">
              <ShoppingBag className="h-3.5 w-3.5 text-[#FF5000]" strokeWidth={2.2} />
            </span>
            <span className="mt-1 text-[12px] font-semibold text-black/80">¥0.00</span>
            <span className="text-[10px] text-black/40">红包</span>
          </button>
        </div>
      </div>
      {/* 快捷入口 */}
      <div className="mx-2 mt-2 grid grid-cols-4 gap-2 rounded-xl bg-white p-3">
        {[
          { icon: Truck, label: '快递', on: onOpenExpress },
          { icon: Star, label: `收藏${favs.length ? `(${favs.length})` : ''}`, on: onOpenFavorites },
          { icon: Heart, label: '关注店铺', on: onOpenShopFollows },
          { icon: ScanLine, label: `足迹${foots.length ? `(${foots.length})` : ''}`, on: onOpenFootprints },
        ].map((it) => (
          <button key={it.label} type="button" onClick={it.on} className="flex flex-col items-center gap-1.5 py-1 active:opacity-60">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-[#FF5000]/[0.07]">
              <it.icon className="h-[21px] w-[21px] text-[#FF5000]" strokeWidth={2} />
            </span>
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
            <button key={it.label} type="button" onClick={() => onOpenOrders(it.st)} className="flex flex-col items-center gap-1 py-1 active:opacity-60">
              <span className="relative">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-black/[0.04]">
                  {it.st === 'pendingPay' ? <Wallet className="h-[17px] w-[17px] text-black/65" strokeWidth={2} /> : it.st === 'pendingDeliver' ? <ShoppingBag className="h-[17px] w-[17px] text-black/65" strokeWidth={2} /> : it.st === 'shipped' ? <Truck className="h-[17px] w-[17px] text-black/65" strokeWidth={2} /> : it.st === 'completed' ? <MessageSquare className="h-[17px] w-[17px] text-black/65" strokeWidth={2} /> : <Copy className="h-[17px] w-[17px] text-black/65" strokeWidth={2} />}
                </span>
                {it.n > 0 ? <span className="absolute -right-1 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#FF4400] px-1 text-[10px] font-bold text-white">{it.n}</span> : null}
              </span>
              <span className="text-[11px] text-black/60">{it.label}</span>
            </button>
          ))}
        </div>
      </div>
      {/* 领券中心 */}
      <div className="mx-2 mt-2 rounded-xl bg-white p-3">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold text-black/85">领券中心</span>
          <span className="text-[12px] text-black/35">更多好券</span>
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TB_COUPON_SEEDS.map((c) => {
            const claimed = tbLoadCoupons(uid).some((x) => x.name === c.name && !x.usedAt);
            return (
              <div key={c.name} className="w-[118px] shrink-0 rounded-lg bg-gradient-to-br from-[#fff1e8] to-[#ffe3d2] p-2">
                <div className="text-center">
                  <span className="text-[17px] font-bold text-[#FF4400]">¥{c.amount}</span>
                </div>
                <div className="mt-0.5 truncate text-center text-[11px] text-[#7a3b12]">{c.name}</div>
                <button
                  type="button"
                  onClick={() => {
                    if (claimed) {
                      onToast('已领取过该券');
                      return;
                    }
                    tbClaimCoupon(uid, c);
                    setTick((n) => n + 1);
                    onToast(`领取成功：${c.name} ¥${c.amount}`);
                  }}
                  className={`mt-1.5 w-full rounded-full py-1 text-[11px] font-medium ${claimed ? 'bg-black/[0.06] text-black/40' : 'bg-[#FF5000] text-white active:opacity-80'}`}
                >
                  {claimed ? '已领取' : '去领取'}
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
        <div className="grid grid-cols-2 gap-2">
          {[...TB_PRODUCTS].slice(14, 22).map((p, i) => (
            <ProductCard key={p.id} p={p} v={i % 4} onOpen={() => onOpenProduct(p.id)} />
          ))}
        </div>
      </div>
    </div>
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

function MsgsPage({ uid, onBack, onOpenOrder }: { uid: string; onBack: () => void; onOpenOrder: (id: string) => void }) {
  const msgs = tbLoadMsgs(uid);
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <TopBar title="消息" onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-10">
        <div className="space-y-2 px-2 pt-2">
          <div className="flex items-center gap-3 rounded-xl bg-white p-3.5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#FF5000]/[0.09]">
              <Truck className="h-5 w-5 text-[#FF5000]" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-black/85">交易物流</div>
              <div className="mt-0.5 truncate text-[12px] text-black/40">{msgs.filter((m) => m.kind === 'logistics').length > 0 ? msgs.find((m) => m.kind === 'logistics')!.text : '暂无包裹动态更新'}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-white p-3.5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#12B7F5]/[0.09]">
              <Copy className="h-5 w-5 text-[#12B7F5]" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-black/85">售后保障</div>
              <div className="mt-0.5 truncate text-[12px] text-black/40">{msgs.filter((m) => m.kind === 'refund').length > 0 ? msgs.find((m) => m.kind === 'refund')!.text : '暂无新消息'}</div>
            </div>
          </div>
        </div>
        {msgs.length === 0 ? (
          <div className="grid place-items-center pt-20">
            <MessageSquare className="h-14 w-14 text-black/10" strokeWidth={1.5} />
            <div className="mt-3 text-[15px] text-black/40">还没有消息哦</div>
          </div>
        ) : (
          <div className="mt-2 space-y-2 px-2">
            {msgs.map((m) => (
              <button key={m.id} type="button" onClick={() => m.orderId && onOpenOrder(m.orderId)} className="flex w-full items-start gap-3 rounded-xl bg-white p-3.5 text-left active:opacity-80">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${m.kind === 'logistics' ? 'bg-[#FF5000]/[0.08]' : 'bg-[#12B7F5]/[0.08]'}`}>
                  {m.kind === 'logistics' ? <Truck className="h-4 w-4 text-[#FF5000]" /> : <Copy className="h-4 w-4 text-[#12B7F5]" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center">
                    <span className="text-[14px] font-medium text-black/85">{m.title}</span>
                    <span className="ml-auto text-[11px] text-black/30">{fmtTime(m.at)}</span>
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-5 text-black/55">{m.text}</span>
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
  const [list, setList] = useState<TbAddress[]>(() => tbLoadAddrs(uid));
  const curId = tbCurAddrId(uid);
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <TopBar title="收货地址" onBack={onBack} />
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
                      tbSetCurAddr(uid, a.id);
                      onToast('已选择该地址');
                    }
                  }}
                  className="flex w-full items-start gap-2.5 text-left"
                >
                  <span className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${curId === a.id ? 'border-[#FF5000] bg-[#FF5000]' : 'border-black/20'}`}>
                    {curId === a.id ? <CircleCheck className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold text-black/85">{a.name}</span>
                      <span className="text-[13px] text-black/45">{a.phone}</span>
                      {a.tag ? <span className="rounded bg-[#FF5000]/[0.08] px-1.5 py-0.5 text-[10px] text-[#FF5000]">{a.tag}</span> : null}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-5 text-black/60">{a.region} {a.detail}</span>
                  </span>
                </button>
                <div className="mt-2 flex justify-end gap-2 border-t border-black/[0.05] pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (list.length <= 1) {
                        onToast('至少保留一个地址');
                        return;
                      }
                      const next = list.filter((x) => x.id !== a.id);
                      tbSaveAddrs(uid, next);
                      if (curId === a.id) tbSetCurAddr(uid, next[0]?.id ?? '');
                      setList(next);
                      onToast('地址已删除');
                    }}
                    className="flex items-center gap-1 rounded-full border border-black/10 px-3 py-1.5 text-[12px] text-black/55 active:opacity-70"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </button>
                  <button type="button" onClick={() => onEdit(a)} className="flex items-center gap-1 rounded-full border border-black/10 px-3 py-1.5 text-[12px] text-black/55 active:opacity-70">
                    <SettingsIcon className="h-3.5 w-3.5" />
                    编辑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 z-30 border-t border-black/[0.06] bg-white/95 px-4 pb-6 pt-2 backdrop-blur-md">
        <button type="button" onClick={() => onEdit(null)} className="h-11 w-full rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[15px] font-semibold text-white active:opacity-85">
          新增收货地址
        </button>
      </div>
    </div>
  );
}

function AddressEditPage({ uid, editing, onBack, onToast }: { uid: string; editing: TbAddress | null; onBack: () => void; onToast: (m: string) => void }) {
  const [name, setName] = useState(editing?.name ?? '');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  const [region, setRegion] = useState(editing?.region ?? '浙江省 杭州市 西湖区');
  const [detail, setDetail] = useState(editing?.detail ?? '');
  const [tag, setTag] = useState(editing?.tag ?? '家');
  const save = () => {
    if (!name.trim()) {
      onToast('请填写收货人姓名');
      return;
    }
    if (!/^1\d{10}$/.test(phone.trim())) {
      onToast('请填写正确的 11 位手机号');
      return;
    }
    if (!detail.trim()) {
      onToast('请填写详细地址');
      return;
    }
    const list = tbLoadAddrs(uid);
    if (editing) {
      const i = list.findIndex((a) => a.id === editing.id);
      if (i >= 0) list[i] = { ...editing, name: name.trim(), phone: phone.trim(), region: region.trim(), detail: detail.trim(), tag };
      tbSaveAddrs(uid, list);
      onToast('地址已保存');
    } else {
      const id = `tba${Date.now().toString(36)}`;
      tbSaveAddrs(uid, [...list, { id, name: name.trim(), phone: phone.trim(), region: region.trim(), detail: detail.trim(), tag }]);
      // 首个地址自动设为默认
      if (list.length === 0) tbSetCurAddr(uid, id);
      onToast('地址已添加');
    }
    onBack();
  };
  return (
    <div className="flex h-full flex-col bg-[#f4f4f4]">
      <TopBar title={editing ? '编辑地址' : '新增地址'} onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-3 pt-3">
        <div className="space-y-2 rounded-xl bg-white p-4">
          {[
            { label: '收货人', value: name, set: setName, placeholder: '请填写收货人姓名' },
            { label: '手机号', value: phone, set: setPhone, placeholder: '请填写 11 位手机号' },
            { label: '所在地区', value: region, set: setRegion, placeholder: '省 市 区' },
            { label: '详细地址', value: detail, set: setDetail, placeholder: '街道、门牌号、小区、楼栋号等' },
          ].map((f) => (
            <div key={f.label} className="flex items-center gap-3 border-b border-black/[0.04] py-2.5 last:border-0">
              <span className="w-[64px] shrink-0 text-[14px] text-black/60">{f.label}</span>
              <input value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.placeholder} className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-black/25" />
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <span className="w-[64px] shrink-0 text-[14px] text-black/60">标签</span>
            {['家', '公司', '学校'].map((t) => (
              <button key={t} type="button" onClick={() => setTag(t)} className={`rounded-full border px-3 py-1 text-[12px] ${tag === t ? 'border-[#FF5000] bg-[#FF5000]/[0.06] text-[#FF5000]' : 'border-black/10 text-black/55'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 z-30 border-t border-black/[0.06] bg-white/95 px-4 pb-6 pt-2 backdrop-blur-md">
        <button type="button" onClick={save} className="h-11 w-full rounded-full bg-gradient-to-r from-[#FF7A21] to-[#FF4400] text-[15px] font-semibold text-white active:opacity-85">
          保存
        </button>
      </div>
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
                  <button type="button" onClick={() => onToast('下单时自动使用最优券，也可在结算页手动选择')} className="mr-3 rounded-full bg-[#FF5000] px-3.5 py-1.5 text-[12px] font-medium text-white active:opacity-80">
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
          <span key={s} className={`rounded-full px-3 py-1 text-[12px] ${i === 0 ? 'bg-[#FF5000]/[0.08] font-medium text-[#FF5000]' : 'bg-black/[0.04] text-black/45'}`}>{s}</span>
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

type TbPage = 'main' | 'search' | 'searchResult' | 'product' | 'checkout' | 'orders' | 'orderDetail' | 'addresses' | 'addressEdit' | 'coupons' | 'favorites' | 'foots' | 'shopFollows' | 'shop' | 'reviews' | 'express' | 'settings' | 'msgs';
type TbTab = 'home' | 'msgs' | 'cart' | 'me';

/** 底部导航（首页/消息/购物车/我的淘宝） */
function BottomTabBar({ active, onTab, cartCount, msgCount }: { active: TbTab; onTab: (t: TbTab) => void; cartCount: number; msgCount: number }) {
  const items: { id: TbTab; label: string; icon: typeof HomeIcon }[] = [
    { id: 'home', label: '首页', icon: HomeIcon },
    { id: 'msgs', label: '消息', icon: MessageSquare },
    { id: 'cart', label: '购物车', icon: ShoppingCart },
    { id: 'me', label: '我的淘宝', icon: User },
  ];
  return (
    <div className="absolute inset-x-0 bottom-0 z-40 flex items-stretch border-t border-black/[0.06] bg-white/92 pb-5 pt-1.5 backdrop-blur-lg">
      {items.map((it) => {
        const badge = it.id === 'cart' ? cartCount : it.id === 'msgs' ? msgCount : 0;
        return (
          <button key={it.id} type="button" onClick={() => onTab(it.id)} className="relative flex flex-1 flex-col items-center gap-0.5 py-0.5 active:opacity-60">
            <span className="relative">
              <it.icon className={`h-[23px] w-[23px] ${active === it.id ? 'text-[#FF5000]' : 'text-black/55'}`} strokeWidth={active === it.id ? 2.3 : 2} />
              {badge > 0 ? (
                <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#FF4400] px-1 text-[10px] font-bold text-white">{badge > 99 ? '99+' : badge}</span>
              ) : null}
            </span>
            <span className={`text-[10px] ${active === it.id ? 'font-medium text-[#FF5000]' : 'text-black/45'}`}>{it.label}</span>
          </button>
        );
      })}
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
                  {curId === a.id ? <CircleCheck className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
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
          <button type="button" onClick={onManage} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-full border border-black/10 text-[14px] text-black/70 active:opacity-70">
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
  const msgCount = tbLoadMsgs(uid).length;

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
            session={session}
            uid={uid}
            onOpenSearch={(seed) => {
              setSearchKw(seed ?? '');
              setPage(seed ? 'searchResult' : 'search');
            }}
            onOpenProduct={openProduct}
            onOpenMsgs={() => {
              setTab('msgs');
            }}
            onOpenCart={() => {
              setTab('cart');
            }}
            onToast={showToast}
            cartCount={cartCount}
          />
        ) : null}
        {tab === 'msgs' ? <MsgsPage uid={uid} onBack={() => setTab('home')} onOpenOrder={(id) => { setOrderId(id); setPage('orderDetail'); }} /> : null}
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
          setOrderId(id);
          setPage('orderDetail');
        }}
        onPayOrder={(id) => setPayOrderId(id)}
        onToast={showToast}
        onOpenProduct={openProduct}
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
      />
    );
  } else if (page === 'addresses') {
    content = <AddressListPage uid={uid} onBack={() => setPage(addrReturn === 'checkout' && checkoutItems ? 'checkout' : 'main')} onEdit={(a) => { setEditAddr(a); setPage('addressEdit'); }} onToast={showToast} />;
  } else if (page === 'addressEdit') {
    content = <AddressEditPage uid={uid} editing={editAddr} onBack={() => setPage('addresses')} onToast={showToast} />;
  } else if (page === 'coupons') {
    content = <CouponsPage uid={uid} onBack={() => setPage('main')} onToast={showToast} />;
  } else if (page === 'favorites') {
    content = <FavoritesPage uid={uid} onBack={() => setPage('main')} onOpenProduct={openProduct} onToast={showToast} />;
  } else if (page === 'foots') {
    content = <FootprintsPage uid={uid} onBack={() => setPage('main')} onOpenProduct={openProduct} onToast={showToast} />;
  } else if (page === 'shopFollows') {
    content = <ShopFollowsPage uid={uid} onBack={() => setPage('main')} onOpenProduct={openProduct} onToast={showToast} />;
  } else if (page === 'shop' && shopId) {
    content = <ShopPage shopId={shopId} uid={uid} onBack={() => setPage('product')} onOpenProduct={openProduct} onToast={showToast} />;
  } else if (page === 'express') {
    content = <ExpressPage uid={uid} onBack={() => setPage('main')} onOpenOrder={(id) => { setOrderId(id); setPage('orderDetail'); }} />;
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
