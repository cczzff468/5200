'use client';

/**
 * 美团 App（桌面生活服务 App，仿真机界面）：
 * - 登录：QQ 一键 / 微信一键（读取联系人系统当前账号 + 授权卡）+ 手机号验证码（演示码 246810）；
 *   登录态 localStorage mt-session 持久化，重启保留；支持退出登录 / 切换账号；
 *   美团数据（购物车/订单/地址）按登录 uid 隔离（见 meituan-store.ts）；
 * - 首页：定位地址、分类入口、优惠活动、附近商家（评分/月售/起送/配送费/距离）、搜索商家菜品；
 * - 商家详情：菜单分区 + 加购、评价、商家信息、购物车结算；
 * - 下单：地址、价格明细（满减/新客立减/满45免配送）、备注、支付方式；
 * - 支付：微信支付 / QQ 支付 → 渠道（零钱/银行卡/亲属卡）复用现有钱包扣款（meituan-pay.ts）；
 *   亲属卡消费走 recordFcSpend（channel='美团'）→ 赠卡人 AI 记忆感知 + 聊天通知行；余额不足提示换渠道；
 * - 订单：状态机（待支付/待接单/商家接单/配送中/已完成/已取消）+ 骑手配送进度 + 再来一单；
 *   全局状态推进与灵动岛通知见 MeituanOrderWatcher。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bike,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock as ClockIcon,
  MapPin,
  MessageSquareMore,
  Phone as PhoneIcon,
  Search as SearchIcon,
  ShoppingCart,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { ISLAND_NAV_EVENT, takeNotifyNavigation } from '@/lib/ios/island-notify';
import { LocalToast, useLocalToast } from './page-toast';
import { MT_CATS, MT_HOME_DEALS, MT_MERCHANTS, mtDishesOf, mtMerchantOf, type MtDish, type MtMerchant } from '@/lib/ios/meituan-data';
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

type Page = 'main' | 'search' | 'merchant' | 'checkout' | 'orderDetail' | 'addresses' | 'addAddress' | 'about';
type Tab = 'home' | 'orders' | 'my';

const MT_YELLOW = '#FFD100';
const MT_PRICE = '#FF4B33';

const fmtMoney = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const fmtDateTime = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 菜品图（搜索 OSS 图；失败回退 emoji 渐变占位） */
function FoodImg({ src, emoji, className = '' }: { src?: string; emoji: string; className?: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-[#FFE7C2] to-[#FFC96B] ${className}`} aria-hidden="true">
        <span className="text-[60%] leading-none">{emoji}</span>
      </div>
    );
  }
  return <img src={src} alt="" draggable={false} loading="lazy" onError={() => setErr(true)} className={`object-cover ${className}`} />;
}

/** 数量步进器 */
function Stepper({ qty, onAdd, onDec }: { qty: number; onAdd: () => void; onDec: () => void }) {
  return (
    <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {qty > 0 && (
        <>
          <button type="button" aria-label="减少" onClick={onDec} className="grid h-[22px] w-[22px] place-items-center rounded-full border border-black/25 text-black/60 active:bg-black/10">
            <span className="mt-[-2px] text-[15px] leading-none">−</span>
          </button>
          <span className="min-w-[18px] text-center text-[14px] font-medium">{qty}</span>
        </>
      )}
      <button type="button" aria-label="增加" onClick={onAdd} className="grid h-[22px] w-[22px] place-items-center rounded-full bg-[#FFD100] text-black/85 active:opacity-80">
        <span className="mt-[-1px] text-[16px] leading-none">＋</span>
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

// ================================ 登录页 ================================

function LoginPage({ onLogin, onToast }: { onLogin: (s: MtSession) => void; onToast: (m: string) => void }) {
  const [agree, setAgree] = useState(true);
  const [auth, setAuth] = useState<{ idp: 'wx' | 'qq'; contactId: string; name: string; avatar: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
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
    setSent(true);
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
    if (code !== '246810') {
      onToast('验证码错误，请重新输入');
      return;
    }
    onLogin({ idp: 'phone', phone, name: `用户${phone.slice(-4)}`, avatar: null, loginAt: Date.now() });
  };

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-white">
      <div className="bg-gradient-to-b from-[#FFDE3E] to-[#FFF9DC] px-6 pb-16 pt-[70px]">
        <div className="flex items-center gap-3">
          <img src="/icons/meituan.png" alt="美团" className="h-14 w-14 rounded-[14px] shadow-md" />
          <div>
            <p className="text-[22px] font-bold text-black/85">美团</p>
            <p className="text-[12px] text-black/50">吃喝玩乐，什么都有</p>
          </div>
        </div>
        <p className="mt-8 text-[26px] font-bold text-black/90">欢迎登录美团</p>
        <p className="mt-1 text-[13px] text-black/45">登录后下单，新人立享专属优惠</p>
      </div>

      <div className="-mt-10 flex-1 px-6 pb-10">
        <button
          type="button"
          onClick={() => void tapIdp('wx')}
          disabled={busy}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[#06C160] text-[17px] font-medium text-white shadow-sm active:opacity-85 disabled:opacity-60"
        >
          <img src="/icons/wechat.png" alt="" className="h-6 w-6 rounded-md" />
          {busy ? '正在获取账号…' : '微信一键登录'}
        </button>
        <button
          type="button"
          onClick={() => void tapIdp('qq')}
          disabled={busy}
          className="mt-3 flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[#12B7F5] text-[17px] font-medium text-white shadow-sm active:opacity-85 disabled:opacity-60"
        >
          <img src="/icons/qq.png" alt="" className="h-6 w-6 rounded-md" />
          {busy ? '正在获取账号…' : 'QQ一键登录'}
        </button>

        <div className="my-6 flex items-center gap-3 text-[12px] text-black/35">
          <span className="h-px flex-1 bg-black/10" />
          或用手机号登录
          <span className="h-px flex-1 bg-black/10" />
        </div>

        <div className="rounded-2xl bg-[#F5F6F7] px-4 py-1">
          <div className="flex h-12 items-center gap-2 border-b border-black/5">
            <span className="text-[15px] font-medium text-black/70">+86</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
              inputMode="numeric"
              placeholder="请输入手机号"
              className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30"
            />
          </div>
          <div className="flex h-12 items-center gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="请输入验证码"
              className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-black/30"
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
        </div>
        <button
          type="button"
          onClick={phoneLogin}
          className={`mt-4 h-[50px] w-full rounded-full text-[17px] font-medium shadow-sm active:opacity-85 ${sent && code.length === 6 ? 'bg-[#FFD100] text-black/85' : 'bg-[#FFF3B8] text-black/45'}`}
        >
          登录
        </button>

        <button type="button" onClick={() => setAgree((a) => !a)} className="mt-6 flex items-start gap-2 text-left">
          <span className={`mt-0.5 grid h-[16px] w-[16px] shrink-0 place-items-center rounded-full ${agree ? 'bg-[#FFC300]' : 'border border-black/25'}`}>
            {agree && <Check className="h-3 w-3 text-black/80" strokeWidth={3} />}
          </span>
          <span className="text-[12px] leading-[1.6] text-black/45">
            我已阅读并同意<span className="text-[#2A7BF6]">《美团用户协议》</span>和<span className="text-[#2A7BF6]">《隐私政策》</span>
            ，并授权美团使用上述账号信息登录
          </span>
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
              className={`mt-4 h-11 w-full rounded-full text-[15px] font-medium text-white active:opacity-85 disabled:opacity-60 ${auth.idp === 'wx' ? 'bg-[#06C160]' : 'bg-[#12B7F5]'}`}
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

// ================================ 首页 ================================

function MerchantCard({ m, onOpen }: { m: MtMerchant; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full gap-3 rounded-2xl bg-white p-3 text-left shadow-[0_1px_6px_rgba(0,0,0,0.04)] active:bg-black/[0.02]">
      <FoodImg src={m.cover} emoji={m.emoji} className="h-[84px] w-[84px] shrink-0 rounded-xl" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[16px] font-semibold text-black/85">{m.name}</span>
        </span>
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

function HomePage({
  session,
  cat,
  setCat,
  onOpenMerchant,
  onOpenSearch,
  onPickAddress,
  onManageAddress,
}: {
  session: MtSession;
  cat: string | null;
  setCat: (c: string | null) => void;
  onOpenMerchant: (id: string) => void;
  onOpenSearch: () => void;
  onPickAddress: () => void;
  onManageAddress: () => void;
}) {
  const uid = mtUidOf(session);
  const addrs = useMemo(() => mtLoadAddresses(uid), [uid]);
  const cur = addrs.find((a) => a.id === mtCurAddrId(uid)) ?? addrs[0];
  const [sort, setSort] = useState<'综合排序' | '距离最近' | '好评优先'>('综合排序');

  const list = useMemo(() => {
    let arr = [...MT_MERCHANTS];
    if (cat && cat !== 'all') arr = arr.filter((m) => m.cats.includes(cat));
    if (sort === '距离最近') arr.sort((a, b) => a.distanceKm - b.distanceKm);
    else if (sort === '好评优先') arr.sort((a, b) => b.rating - a.rating);
    else arr.sort((a, b) => b.rating * 10 + (b.deals.length - a.deals.length) - (a.rating * 10));
    return arr;
  }, [cat, sort]);

  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-[#F5F6F7] pb-24">
      {/* 顶部黄色区：定位 + 搜索 */}
      <div className="bg-gradient-to-b from-[#FFD100] to-[#FFE45C] px-4 pb-5 pt-[54px]">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onPickAddress} className="flex min-w-0 items-center gap-1 text-left active:opacity-70">
            <MapPin className="h-4 w-4 shrink-0 text-black/75" />
            <span className="truncate text-[16px] font-semibold text-black/85">{cur ? cur.text.slice(0, 10) : '选择地址'}</span>
            <span className="text-[10px] text-black/60">▼</span>
          </button>
          <span className="flex-1" />
          <button type="button" aria-label="消息" onClick={onManageAddress} className="grid h-8 w-8 place-items-center rounded-full bg-black/5 active:opacity-70">
            <MessageSquareMore className="h-[18px] w-[18px] text-black/70" />
          </button>
        </div>
        <button type="button" onClick={onOpenSearch} className="mt-3 flex h-11 w-full items-center gap-2 rounded-full bg-white px-4 text-left shadow-sm active:opacity-90">
          <SearchIcon className="h-4 w-4 text-black/40" />
          <span className="text-[14px] text-black/35">搜索商家、菜品，如「奶茶」「汉堡」</span>
          <span className="ml-auto rounded-full bg-[#FFD100] px-4 py-1.5 text-[13px] font-medium text-black/85">搜索</span>
        </button>
      </div>

      {/* 分类入口 */}
      <div className="mx-3 -mt-1 rounded-2xl bg-white p-3 shadow-[0_1px_6px_rgba(0,0,0,0.04)]">
        <div className="grid grid-cols-5 gap-y-3">
          {MT_CATS.map((c) => (
            <button key={c.id} type="button" onClick={() => setCat(cat === c.id || c.id === 'all' ? null : c.id)} className="flex flex-col items-center gap-1.5 active:opacity-70">
              <span className={`grid h-[46px] w-[46px] place-items-center rounded-2xl bg-gradient-to-br ${c.tint} ${cat === c.id ? 'ring-2 ring-[#FFC300]' : ''}`}>
                <span className="text-[22px] leading-none">{c.emoji}</span>
              </span>
              <span className={`text-[11px] ${cat === c.id ? 'font-semibold text-black/85' : 'text-black/65'}`}>{c.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 优惠活动 */}
      <div className="mx-3 mt-3 flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {MT_HOME_DEALS.map((d) => (
          <button key={d.title} type="button" onClick={() => onOpenMerchant(d.merchantId)} className="flex w-[220px] shrink-0 items-center gap-2.5 rounded-2xl bg-white p-2.5 text-left shadow-[0_1px_6px_rgba(0,0,0,0.04)] active:opacity-80">
            <FoodImg src={d.img} emoji={d.emoji} className="h-14 w-14 shrink-0 rounded-xl" />
            <span className="min-w-0">
              <span className="inline-block rounded bg-[#FF4B33] px-1 py-px text-[10px] font-medium text-white">{d.tag}</span>
              <span className="mt-1 block truncate text-[13px] font-medium text-black/85">{d.title}</span>
              <span className="block truncate text-[11px] text-black/40">{d.sub}</span>
            </span>
          </button>
        ))}
      </div>

      {/* 附近商家 */}
      <div className="mx-3 mt-4 flex items-center gap-2">
        <p className="text-[17px] font-bold text-black/85">附近商家</p>
        {cat && <span className="rounded-full bg-[#FFF3B8] px-2 py-0.5 text-[11px] text-[#B77900]">{MT_CATS.find((c) => c.id === cat)?.name} · 点击分类取消</span>}
      </div>
      <div className="mx-3 mt-2 flex gap-2">
        {(['综合排序', '距离最近', '好评优先'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSort(s)}
            className={`rounded-full px-3 py-1.5 text-[12px] ${sort === s ? 'bg-[#FFD100] font-medium text-black/85' : 'bg-white text-black/55'}`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="mx-3 mt-2.5 space-y-2.5">
        {list.map((m) => (
          <MerchantCard key={m.id} m={m} onOpen={() => onOpenMerchant(m.id)} />
        ))}
        {list.length === 0 && <p className="rounded-2xl bg-white p-8 text-center text-[13px] text-black/40">该分类下暂无商家</p>}
      </div>
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
    <div className="flex h-full flex-col bg-[#F5F6F7]">
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
                <MerchantCard key={m.id} m={m} onOpen={() => onOpenMerchant(m.id)} />
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

// ================================ 商家详情页 ================================

function MerchantPage({ merchant, onBack, onCheckout, onToast }: { merchant: MtMerchant; onBack: () => void; onCheckout: () => void; onToast: (m: string) => void }) {
  const session = mtGetSession();
  const uid = session ? mtUidOf(session) : '';
  const [tab, setTab] = useState<'点菜' | '评价' | '商家'>('点菜');
  const [cart, setCart] = useState<MtCart>(() => mtLoadCart(uid));
  const [cartOpen, setCartOpen] = useState(false);
  const [activeCat, setActiveCat] = useState(0);
  const catRefs = useRef<(HTMLDivElement | null)[]>([]);

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
    <div className="flex h-full flex-col bg-[#F5F6F7]">
      {/* 头图 + 返回 */}
      <div className="relative h-[118px] shrink-0">
        <FoodImg src={merchant.cover} emoji={merchant.emoji} className="h-full w-full" />
        <button type="button" aria-label="返回" onClick={onBack} className="absolute left-3 top-[60px] grid h-9 w-9 place-items-center rounded-full bg-black/35 text-white active:opacity-75">
          <ChevronLeft className="h-6 w-6" />
        </button>
      </div>

      {/* 商家信息卡 */}
      <div className="relative z-10 -mt-6 px-3">
        <div className="rounded-2xl bg-white p-3.5 shadow-[0_2px_10px_rgba(0,0,0,0.05)]">
          <div className="flex gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#FFE7C2] to-[#FFC96B] text-[24px]">{merchant.emoji}</span>
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

      {/* 页签 */}
      <div className="mt-2.5 flex shrink-0 items-center gap-6 px-5">
        {(['点菜', '评价', '商家'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`relative py-2 text-[15px] ${tab === t ? 'font-bold text-black/85' : 'text-black/45'}`}>
            {t}
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

// ================================ 支付方式选择弹层 ================================

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
  const [wxChans, setWxChans] = useState<MtPayChannel[] | null>(null);
  const [qqChans, setQqChans] = useState<MtPayChannel[] | null>(null);

  useEffect(() => {
    let alive = true;
    mtListPayChannels('wx', amount)
      .then((c) => alive && setWxChans(c))
      .catch(() => alive && setWxChans([]));
    return () => {
      alive = false;
    };
  }, [amount]);

  const expandQq = () => {
    if (qqChans) return;
    setQqChans(null);
    mtListPayChannels('qq', amount)
      .then((c) => setQqChans(c))
      .catch(() => setQqChans([]));
  };

  const pick = (c: MtPayChannel) => {
    if (c.insufficient) {
      onToast(c.isFc ? '亲属卡本月额度不足，请切换其他支付方式' : '该渠道余额不足，请更换支付方式');
      return;
    }
    onSelect(c);
  };

  const renderChans = (chans: MtPayChannel[] | null) => {
    if (!chans) return <p className="px-4 py-4 text-center text-[12px] text-black/35">正在获取支付渠道…</p>;
    if (chans.length === 0) return <p className="px-4 py-4 text-center text-[12px] text-black/35">该支付方式暂无可用渠道</p>;
    return chans.map((c) => (
      <button key={c.key} type="button" onClick={() => pick(c)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.03]">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[15px] ${c.isFc ? 'bg-[#FFF0EB]' : c.idp === 'wx' ? 'bg-[#E8F9EF]' : 'bg-[#E5F6FD]'}`}>{c.isFc ? '👪' : c.sub.startsWith('可用') ? '💰' : '💳'}</span>
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
    ));
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/45" onClick={onClose}>
      <div className="max-h-[78%] overflow-y-auto rounded-t-2xl bg-white pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white">
          <p className="py-3.5 text-center text-[16px] font-semibold text-black/85">选择支付方式</p>
        </div>
        <div className="border-t border-black/5">
          <p className="flex items-center gap-2 px-4 pb-1 pt-3 text-[13px] font-semibold text-black/70">
            <img src="/icons/wechat.png" alt="" className="h-5 w-5 rounded" /> 微信支付
          </p>
          {renderChans(wxChans)}
        </div>
        <div className="mt-2 border-t border-black/5">
          <p className="flex items-center gap-2 px-4 pb-1 pt-3 text-[13px] font-semibold text-black/70">
            <img src="/icons/qq.png" alt="" className="h-5 w-5 rounded" /> QQ支付
          </p>
          <button
            type="button"
            onClick={expandQq}
            className={`w-full text-left ${qqChans ? 'pointer-events-none' : ''}`}
          >
            {qqChans === null ? (
              <p className="flex items-center justify-between px-4 py-3 text-[14px] text-black/70">
                展开QQ钱包渠道（余额 / 银行卡）
                <ChevronRight className="h-4 w-4 text-black/30" />
              </p>
            ) : null}
          </button>
          {qqChans !== null && renderChans(qqChans)}
        </div>
        <p className="px-4 pt-3 text-center text-[11px] leading-relaxed text-black/30">
          使用亲属卡支付将由赠卡人买单（消费记录同步给赠卡人）；支付结果以商家订单为准
        </p>
      </div>
    </div>
  );
}

// ================================ 支付确认弹层 ================================

function PayConfirmSheet({
  order,
  channel,
  onChangeChannel,
  onAutoSelect,
  onClose,
  onPaid,
  onToast,
}: {
  order: MtOrder;
  channel: MtPayChannel | null;
  onChangeChannel: () => void;
  onAutoSelect: (c: MtPayChannel) => void;
  onClose: () => void;
  onPaid: (o: MtOrder) => void;
  onToast: (m: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'processing' | 'fail'>('idle');
  const [err, setErr] = useState('');
  const [tried, setTried] = useState(0);

  // 未选渠道时自动预选微信首个可用渠道（零钱优先），用户仍可「更换支付方式」
  useEffect(() => {
    if (channel) return;
    let alive = true;
    mtListPayChannels('wx', order.total)
      .then((cs) => {
        const c = cs.find((x) => !x.insufficient);
        if (alive && c) onAutoSelect(c);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [channel, order.total, onAutoSelect]);

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
    // 成功：落单（待接单）+ 支付信息 + 预计送达
    const now = Date.now();
    const paid: MtOrder = {
      ...order,
      status: 'pendingAccept',
      paidAt: now,
      etaAt: now + 45 * 60_000,
      payIdp: channel.idp,
      payChannelLabel: `${channel.idp === 'wx' ? '微信' : 'QQ'}${channel.isFc ? '亲属卡' : ''} · ${channel.label}`,
      payFc: channel.isFc === true,
      statusLog: [...order.statusLog, { status: 'pendingAccept', at: now }],
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
            <p className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#FFF0EB] text-[30px]">⚠️</p>
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
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#F5F6F7]">{channel?.isFc ? '👪' : '💳'}</span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-[14px] font-medium text-black/85">{channel ? `${channel.idp === 'wx' ? '微信支付' : 'QQ支付'} · ${channel.label}` : '请选择支付方式'}</span>
                <span className="block text-[11px] text-black/40">{channel ? channel.sub : '零钱 / 银行卡 / 亲属卡'}</span>
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

// ================================ 结算页 ================================

function CheckoutPage({
  session,
  merchant,
  onBack,
  onOpenPay,
  onPickAddress,
  onToast,
}: {
  session: MtSession;
  merchant: MtMerchant;
  onBack: () => void;
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

  const items = cart.items.map((i) => {
    const d = mtDishesOf(merchant).find((x) => x.id === i.dishId);
    return d ? { dish: d, qty: i.qty } : null;
  }).filter((x): x is { dish: MtDish; qty: number } => x !== null);

  // 空车守卫：订单已提交（购物车被清空）但未支付就关闭支付弹层时，避免停留在空结算页
  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col bg-[#F5F6F7]">
        <div className="flex shrink-0 items-center gap-2 bg-white px-3 pb-2.5 pt-[54px]">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/70" />
          </button>
          <p className="flex-1 text-center text-[16px] font-semibold text-black/85">确认订单</p>
          <span className="h-9 w-9" />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-8">
          <p className="text-[44px]">🧾</p>
          <p className="mt-3 text-center text-[14px] leading-relaxed text-black/50">
            购物车是空的
            <br />
            如有已提交未支付的订单，可在「订单」页继续支付
          </p>
          <button type="button" onClick={onBack} className="mt-5 rounded-full bg-[#FFD100] px-8 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
            返回商家
          </button>
        </div>
      </div>
    );
  }

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
    onOpenPay(order, null);
  };

  return (
    <div className="flex h-full flex-col bg-[#F5F6F7]">
      <div className="flex shrink-0 items-center gap-2 bg-white px-3 pb-2.5 pt-[54px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
          <ChevronLeft className="h-6 w-6 text-black/70" />
        </button>
        <p className="flex-1 text-center text-[16px] font-semibold text-black/85">确认订单</p>
        <span className="h-9 w-9" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-4">
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
          <p className="flex items-center gap-1.5 text-[14px] font-semibold text-black/80">
            <span className="text-[16px]">{merchant.emoji}</span>
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
    </div>
  );
}

// ================================ 订单列表页 ================================

const ORDER_TABS: { key: string; match: (s: MtOrderStatus) => boolean }[] = [
  { key: '全部', match: () => true },
  { key: '待支付', match: (s) => s === 'pendingPay' },
  { key: '待接单', match: (s) => s === 'pendingAccept' },
  { key: '配送中', match: (s) => s === 'accepted' || s === 'delivering' },
  { key: '已完成', match: (s) => s === 'completed' },
  { key: '已取消', match: (s) => s === 'canceled' },
];

function OrdersPage({
  session,
  tab,
  setTab,
  onOpenOrder,
  onGoHome,
}: {
  session: MtSession;
  tab: string;
  setTab: (t: string) => void;
  onOpenOrder: (id: string) => void;
  onGoHome: () => void;
}) {
  const uid = mtUidOf(session);
  useOrdersTick();
  const orders = mtLoadOrders(uid);
  const cur = ORDER_TABS.find((t) => t.key === tab) ?? ORDER_TABS[0];
  const list = orders.filter((o) => cur.match(o.status));

  return (
    <div className="flex h-full flex-col bg-[#F5F6F7]">
      <div className="shrink-0 bg-white px-4 pb-0 pt-[54px]">
        <p className="text-[20px] font-bold text-black/85">订单</p>
        <div className="mt-2.5 flex gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ORDER_TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`relative shrink-0 pb-2.5 text-[15px] ${tab === t.key ? 'font-bold text-black/85' : 'text-black/45'}`}>
              {t.key}
              {tab === t.key && <span className="absolute inset-x-1 bottom-1 h-[3px] rounded-full bg-[#FFD100]" />}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {list.length === 0 && (
          <div className="mt-20 text-center">
            <p className="text-[44px]">🛍️</p>
            <p className="mt-2 text-[13px] text-black/40">还没有相关订单，去下一单吧</p>
            <button type="button" onClick={onGoHome} className="mt-4 rounded-full bg-[#FFD100] px-6 py-2.5 text-[14px] font-medium text-black/85 active:opacity-85">
              去逛逛
            </button>
          </div>
        )}
        <div className="space-y-2.5">
          {list.map((o) => (
            <div key={o.id} className="rounded-2xl bg-white p-3.5 shadow-sm">
              <button type="button" onClick={() => onOpenOrder(o.id)} className="w-full text-left">
                <span className="flex items-center gap-1.5">
                  <span className="text-[15px]">{o.merchantEmoji}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-black/85">{o.merchantName}</span>
                  <span className={`text-[12px] ${o.status === 'pendingPay' ? 'font-semibold' : ''}`} style={{ color: o.status === 'pendingPay' ? MT_PRICE : o.status === 'canceled' ? '#999' : '#333' }}>
                    {MT_STATUS_LABEL[o.status]}
                  </span>
                  <ChevronRight className="h-4 w-4 text-black/20" />
                </span>
                <span className="mt-2 flex items-center gap-2.5">
                  <span className="flex shrink-0 -space-x-2">
                    {o.items.slice(0, 3).map((i) => (
                      <FoodImg key={i.dishId} src={i.img} emoji={i.emoji} className="h-10 w-10 rounded-lg ring-2 ring-white" />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-black/45">
                    {o.items[0]?.name}
                    {o.items.length > 1 ? ` 等${o.items.reduce((s, i) => s + i.qty, 0)}件商品` : ''}
                  </span>
                  <span className="shrink-0 text-[14px] font-semibold text-black/85">¥{o.total.toFixed(2)}</span>
                </span>
              </button>
              <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-black/5 pt-2.5">
                {o.status === 'pendingPay' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const list2 = mtLoadOrders(uid).map((x) => (x.id === o.id ? { ...x, status: 'canceled' as const, cancelReason: '用户主动取消', statusLog: [...x.statusLog, { status: 'canceled' as const, at: Date.now() }] } : x));
                        mtSaveOrders(uid, list2);
                        window.dispatchEvent(new CustomEvent('mt-orders-changed'));
                      }}
                      className="rounded-full border border-black/15 px-4 py-1.5 text-[12px] text-black/60 active:bg-black/5"
                    >
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
                  <button
                    type="button"
                    onClick={() => {
                      if (mtReorder(uid, o)) onGoHome();
                    }}
                    className="rounded-full border border-[#FFC300] px-4 py-1.5 text-[12px] font-medium text-[#B77900] active:opacity-75"
                  >
                    再来一单
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ================================ 订单详情页 ================================

/** 配送小地图（CSS 假地图：路网 + 商家/家 pin + 骑手巡航） */
function DeliveryMap({ merchantEmoji }: { merchantEmoji: string }) {
  return (
    <div className="relative h-44 overflow-hidden rounded-2xl bg-[#EAF0E4]">
      <div className="absolute left-0 right-0 top-[38%] h-[7px] -rotate-3 bg-white/85" />
      <div className="absolute bottom-0 left-[30%] top-0 w-[6px] rotate-6 bg-white/85" />
      <div className="absolute left-[-8%] right-[20%] top-[68%] h-[5px] rotate-6 bg-white/70" />
      <div className="absolute left-[62%] bottom-[-6%] top-[16%] w-[5px] -rotate-12 bg-white/70" />
      <span className="absolute left-[14%] top-[18%] text-[15px]">🌳</span>
      <span className="absolute bottom-[16%] right-[26%] text-[15px]">🏢</span>
      <span className="absolute right-[10%] top-[24%] text-[15px]">🌳</span>
      {/* 商家 pin */}
      <span className="absolute left-[12%] top-[62%] grid h-8 w-8 place-items-center rounded-full bg-white text-[14px] shadow-md ring-1 ring-black/5">{merchantEmoji}</span>
      {/* 家 pin */}
      <span className="absolute bottom-[10%] right-[10%] grid h-8 w-8 place-items-center rounded-full bg-white text-[14px] shadow-md ring-1 ring-black/5">🏠</span>
      {/* 骑手 */}
      <span className="mt-rider absolute grid h-9 w-9 place-items-center rounded-full bg-[#FFD100] text-[16px] shadow-lg ring-2 ring-white">🛵</span>
      <span className="absolute right-3 top-3 rounded-full bg-black/45 px-2 py-0.5 text-[10px] text-white">美团专送</span>
    </div>
  );
}

function OrderDetailPage({
  session,
  orderId,
  onBack,
  onOpenPay,
  onGoOrders,
  onToast,
}: {
  session: MtSession;
  orderId: string;
  onBack: () => void;
  onOpenPay: (o: MtOrder, sel: MtPayChannel | null) => void;
  onGoOrders: () => void;
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
      <div className="flex h-full flex-col items-center justify-center bg-[#F5F6F7]">
        <p className="text-[13px] text-black/40">订单不存在</p>
        <button type="button" onClick={onGoOrders} className="mt-3 rounded-full bg-[#FFD100] px-5 py-2 text-[13px] font-medium text-black/85">
          返回订单列表
        </button>
      </div>
    );
  }

  const steps: { key: string; icon: 'pay' | 'store' | 'bike' | 'home'; at?: number }[] = [
    { key: '已支付', icon: 'pay', at: order.paidAt },
    { key: '商家接单', icon: 'store', at: order.statusLog.find((s) => s.status === 'accepted')?.at },
    { key: '骑手取餐', icon: 'bike', at: order.statusLog.find((s) => s.status === 'delivering')?.at },
    { key: '已送达', icon: 'home', at: order.statusLog.find((s) => s.status === 'completed')?.at },
  ];
  const doneIdx = steps.reduce((acc, s, i) => (s.at ? i : acc), -1);

  const heroText: Record<MtOrderStatus, { title: string; sub: string }> = {
    pendingPay: { title: '待支付', sub: '请在 15 分钟内完成支付，超时订单自动取消' },
    pendingAccept: { title: '等待商家接单', sub: `预计 ${order.etaAt ? fmtTime(order.etaAt) : '--:--'} 送达` },
    accepted: { title: '商家已接单', sub: `商家正在准备餐品，预计 ${order.etaAt ? fmtTime(order.etaAt) : '--:--'} 送达` },
    delivering: { title: '骑手正在送货', sub: `骑手${order.riderName ?? ''}已取餐，预计 ${order.etaAt ? fmtTime(order.etaAt) : '--:--'} 送达` },
    completed: { title: '订单已送达', sub: '感谢您的信任，期待再次光临' },
    canceled: { title: '订单已取消', sub: order.cancelReason ?? '订单已取消' },
  };
  const hero = heroText[order.status];

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

  const countdown = (() => {
    if (order.status !== 'pendingPay') return null;
    const left = Math.max(0, order.createdAt + 15 * 60_000 - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  })();

  return (
    <div className="flex h-full flex-col bg-[#F5F6F7]">
      <div className="shrink-0 bg-white px-3 pb-2.5 pt-[54px]">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/70" />
          </button>
          <p className="flex-1 text-center text-[16px] font-semibold text-black/85">订单详情</p>
          <span className="h-9 w-9" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 状态 hero */}
        <div className="bg-gradient-to-b from-[#FFD100] to-[#FFDE3E] px-5 pb-6 pt-4">
          <p className="flex items-center gap-2 text-[22px] font-bold text-black/90">
            {hero.title}
            {countdown && <span className="text-[15px] font-semibold text-black/60">还剩 {countdown}</span>}
          </p>
          <p className="mt-1 text-[13px] text-black/60">{hero.sub}</p>
          {order.status !== 'pendingPay' && order.status !== 'canceled' && (
            <div className="mt-5 flex items-center">
              {steps.map((s, i) => (
                <div key={s.key} className="flex flex-1 items-center last:flex-none">
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className={`grid h-8 w-8 place-items-center rounded-full ${i <= doneIdx ? 'bg-white text-black/80 shadow' : 'bg-white/40 text-black/30'}`}
                    >
                      {s.icon === 'pay' && <span className="text-[13px] font-bold">¥</span>}
                      {s.icon === 'store' && <span className="text-[13px]">🏪</span>}
                      {s.icon === 'bike' && <Bike className="h-4 w-4" strokeWidth={2.2} />}
                      {s.icon === 'home' && <span className="text-[12px]">🏠</span>}
                    </span>
                    <span className={`whitespace-nowrap text-[10px] ${i <= doneIdx ? 'font-medium text-black/70' : 'text-black/35'}`}>{s.key}</span>
                  </div>
                  {i < steps.length - 1 && <span className={`mx-1 mb-4 h-[3px] flex-1 rounded-full ${i < doneIdx ? 'bg-white' : 'bg-white/40'}`} />}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 配送地图（配送中展示） */}
        {order.status === 'delivering' && (
          <div className="px-3 pt-3">
            <DeliveryMap merchantEmoji={order.merchantEmoji} />
          </div>
        )}

        {/* 操作按钮 */}
        {(order.status === 'accepted' || order.status === 'delivering') && (
          <div className="flex gap-2 px-3 pt-3">
            {['催一下', '联系商家', '联系骑手'].map((t) => (
              <button key={t} type="button" onClick={() => onToast(t === '催一下' ? '已提醒商家尽快出餐' : '已发起联系（演示）')} className="flex-1 rounded-full bg-white py-2.5 text-[12px] text-black/70 shadow-sm active:bg-black/5">
                {t}
              </button>
            ))}
          </div>
        )}

        {/* 订单信息 */}
        <div className="mx-3 mt-3 rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-[15px] font-bold text-black/85">订单信息</p>
          <div className="mt-2.5 space-y-2 text-[12px]">
            {[
              ['期望时间', '立即配送'],
              ['配送地址', `${order.address.text}（${order.address.name} ${order.address.phone}）`],
              ['订单号码', order.id],
              ['下单时间', fmtDateTime(order.createdAt)],
              ['支付方式', order.payIdp ? (order.payChannelLabel ?? (order.payIdp === 'wx' ? '微信支付' : 'QQ支付')) : '在线支付（未支付）'],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <span className="w-[56px] shrink-0 text-black/35">{k}</span>
                <span className="min-w-0 flex-1 break-all leading-relaxed text-black/70">{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 商品费用 */}
        <div className="mx-3 mt-2.5 rounded-2xl bg-white p-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-[15px] font-bold text-black/85">
            <span>{order.merchantEmoji}</span>
            {order.merchantName}
          </p>
          <div className="mt-2.5 space-y-2">
            {order.items.map((i) => (
              <div key={i.dishId} className="flex items-center gap-2.5">
                <FoodImg src={i.img} emoji={i.emoji} className="h-10 w-10 shrink-0 rounded-lg" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-black/75">{i.name}</span>
                <span className="text-[12px] text-black/35">×{i.qty}</span>
                <span className="w-14 text-right text-[13px] text-black/80">¥{fmtMoney(i.price * i.qty)}</span>
              </div>
            ))}
          </div>
          {order.note && <p className="mt-2.5 rounded-lg bg-[#F5F6F7] p-2 text-[11px] text-black/50">备注：{order.note}</p>}
          <div className="mt-3 space-y-1.5 border-t border-black/5 pt-2.5 text-[12px]">
            <p className="flex justify-between text-black/55">
              <span>商品总价</span>
              <span>¥{fmtMoney(order.itemTotal)}</span>
            </p>
            <p className="flex justify-between text-black/55">
              <span>配送费</span>
              <span>¥{fmtMoney(order.deliveryFee)}</span>
            </p>
            {order.discount > 0 && (
              <p className="flex justify-between text-[#FF4B33]">
                <span>优惠</span>
                <span>-¥{fmtMoney(order.discount)}</span>
              </p>
            )}
            <p className="flex justify-between border-t border-black/5 pt-2 text-[14px] font-bold text-black/85">
              <span>实付</span>
              <span style={{ color: MT_PRICE }}>¥{order.total.toFixed(2)}</span>
            </p>
          </div>
        </div>
        <div className="h-4" />
      </div>

      {/* 底部操作 */}
      <div className="shrink-0 border-t border-black/5 bg-white px-4 py-3">
        <div className="flex items-center justify-end gap-2.5">
          {order.status === 'pendingPay' && (
            <>
              <button type="button" onClick={cancel} className="rounded-full border border-black/15 px-5 py-2.5 text-[13px] text-black/60 active:bg-black/5">
                取消订单
              </button>
              <button type="button" onClick={() => onOpenPay(order, null)} className="rounded-full bg-[#FFD100] px-6 py-2.5 text-[14px] font-semibold text-black/90 active:opacity-85">
                ¥{order.total.toFixed(2)} 继续支付
              </button>
            </>
          )}
          {order.status === 'pendingAccept' && (
            <button type="button" onClick={cancel} className="rounded-full border border-black/15 px-5 py-2.5 text-[13px] text-black/60 active:bg-black/5">
              取消订单（退款）
            </button>
          )}
          {(order.status === 'completed' || order.status === 'canceled') && (
            <>
              {order.status === 'completed' && (
                <button type="button" onClick={() => onToast('感谢评价，积分+100（演示）')} className="rounded-full border border-black/15 px-5 py-2.5 text-[13px] text-black/60 active:bg-black/5">
                  评价
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (mtReorder(uid, order)) onToast('已加入购物车');
                }}
                className="rounded-full bg-[#FFD100] px-6 py-2.5 text-[14px] font-semibold text-black/90 active:opacity-85"
              >
                再来一单
              </button>
            </>
          )}
        </div>
      </div>
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
    <div className="flex h-full flex-col bg-[#F5F6F7]">
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
    <div className="flex h-full flex-col bg-[#F5F6F7]">
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

// ================================ 我的页 ================================

function MyPage({
  session,
  onOpenOrders,
  onOpenAddresses,
  onOpenAbout,
  onLogout,
  onSwitch,
}: {
  session: MtSession;
  onOpenOrders: () => void;
  onOpenAddresses: () => void;
  onOpenAbout: () => void;
  onLogout: () => void;
  onSwitch: () => void;
}) {
  const uid = mtUidOf(session);
  const orders = mtLoadOrders(uid);
  const countOf = (f: (s: MtOrderStatus) => boolean) => orders.filter((o) => f(o.status)).length;
  const idpLabel = session.idp === 'wx' ? '微信账号' : session.idp === 'qq' ? 'QQ账号' : `手机用户 ${session.phone ?? ''}`;

  return (
    <div className="h-full overflow-y-auto bg-[#F5F6F7] pb-24">
      <div className="bg-gradient-to-b from-[#FFD100] to-[#FFE45C] px-5 pb-14 pt-[70px]">
        <div className="flex items-center gap-3.5">
          {session.avatar ? (
            <img src={session.avatar} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-white/70" />
          ) : (
            <span className="grid h-16 w-16 place-items-center rounded-full bg-white text-[26px] font-bold text-black/70 shadow">{session.name.slice(0, 1)}</span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[19px] font-bold text-black/90">{session.name}</p>
            <p className="mt-0.5 text-[12px] text-black/50">{idpLabel} · 美团普通会员</p>
          </div>
        </div>
      </div>

      <div className="-mt-9 px-3">
        {/* 订单快捷入口 */}
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-semibold text-black/80">我的订单</p>
            <button type="button" onClick={onOpenOrders} className="flex items-center text-[12px] text-black/40">
              全部订单 <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-4">
            {[
              ['待支付', (s: MtOrderStatus) => s === 'pendingPay'],
              ['待接单', (s: MtOrderStatus) => s === 'pendingAccept'],
              ['配送中', (s: MtOrderStatus) => s === 'accepted' || s === 'delivering'],
              ['已完成', (s: MtOrderStatus) => s === 'completed'],
            ].map(([label, f]) => (
              <button key={label as string} type="button" onClick={onOpenOrders} className="flex flex-col items-center gap-1.5 active:opacity-70">
                <span className="relative grid h-10 w-10 place-items-center rounded-full bg-[#FFF7D6]">
                  <ShoppingCart className="h-[18px] w-[18px] text-[#B77900]" />
                  {countOf(f as (s: MtOrderStatus) => boolean) > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-[#FF4B33] px-1 text-[9px] font-bold text-white">{countOf(f as (s: MtOrderStatus) => boolean)}</span>
                  )}
                </span>
                <span className="text-[11px] text-black/60">{label as string}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 服务列表 */}
        <div className="mt-2.5 rounded-2xl bg-white shadow-sm">
          {[
            ['📍', '收货地址管理', onOpenAddresses],
            ['🎫', '红包卡券', () => onToast('暂无可用卡券（演示）')],
            ['👤', '客服中心', () => onToast('美团客服：0539-000-0000（演示）')],
            ['ℹ️', '关于美团', onOpenAbout],
          ].map(([emoji, label, fn], i) => (
            <button key={label as string} type="button" onClick={fn as () => void} className={`flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.03] ${i > 0 ? 'border-t border-black/5' : ''}`}>
              <span className="text-[17px]">{emoji as string}</span>
              <span className="flex-1 text-[14px] text-black/80">{label as string}</span>
              <ChevronRight className="h-4 w-4 text-black/20" />
            </button>
          ))}
        </div>

        {/* 账号 */}
        <div className="mt-2.5 rounded-2xl bg-white shadow-sm">
          <button type="button" onClick={onSwitch} className="flex w-full items-center gap-3 border-b border-black/5 px-4 py-3.5 text-left active:bg-black/[0.03]">
            <span className="text-[17px]">🔄</span>
            <span className="flex-1 text-[14px] text-black/80">切换账号</span>
            <ChevronRight className="h-4 w-4 text-black/20" />
          </button>
          <button type="button" onClick={onLogout} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.03]">
            <span className="text-[17px]">🚪</span>
            <span className="flex-1 text-[14px] text-[#FF4B33]">退出登录</span>
          </button>
        </div>
        <p className="py-4 text-center text-[10px] text-black/25">美团 v10.18.0 · 数据仅保存在本机 · 按账号隔离</p>
      </div>
    </div>
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
  const [cat, setCat] = useState<string | null>(null);
  const [orderTab, setOrderTab] = useState('全部');
  const [editAddr, setEditAddr] = useState<MtAddress | null>(null);
  const [addrPicker, setAddrPicker] = useState(false);
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
    setPaySheet(false);
  }, []);

  const openMerchant = useCallback((id: string) => {
    setMerchantId(id);
    setPage('merchant');
  }, []);

  const openOrder = useCallback((id: string) => {
    setOrderId(id);
    setPage('orderDetail');
  }, []);

  const goHome = useCallback(() => {
    setTab('home');
    setPage('main');
  }, []);

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

  const pickAddr = (a: MtAddress) => {
    mtSetCurAddr(uid, a.id);
    showToast(`已选择：${a.text.slice(0, 12)}`);
  };

  return (
    <div className="relative h-full overflow-hidden bg-[#F5F6F7]">
      {/* 页面路由（早退式，与微信/QQ 同模式） */}
      {page === 'main' && (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            {tab === 'home' && (
              <HomePage
                session={session}
                cat={cat}
                setCat={setCat}
                onOpenMerchant={openMerchant}
                onOpenSearch={() => setPage('search')}
                onPickAddress={() => setAddrPicker(true)}
                onManageAddress={() => setPage('addresses')}
              />
            )}
            {tab === 'orders' && (
              <OrdersPage
                session={session}
                tab={orderTab}
                setTab={setOrderTab}
                onOpenOrder={openOrder}
                onGoHome={goHome}
              />
            )}
            {tab === 'my' && (
              <MyPage
                session={session}
                onOpenOrders={() => {
                  setTab('orders');
                }}
                onOpenAddresses={() => setPage('addresses')}
                onOpenAbout={() => setPage('about')}
                onLogout={logout}
                onSwitch={logout}
              />
            )}
          </div>
          {/* 底部导航 */}
          <div className="flex shrink-0 items-stretch border-t border-black/5 bg-white pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))]">
            {([
              ['home', '首页', '🛍️'],
              ['orders', '订单', '📄'],
              ['my', '我的', '🙂'],
            ] as const).map(([k, label, emoji]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className="flex flex-1 flex-col items-center gap-0.5 py-1 active:opacity-70">
                <span className={`text-[20px] leading-none ${tab === k ? '' : 'opacity-45 grayscale'}`}>{emoji}</span>
                <span className={`text-[10px] ${tab === k ? 'font-semibold text-black/85' : 'text-black/40'}`}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {page === 'search' && <SearchPage onBack={() => setPage('main')} onOpenMerchant={openMerchant} />}
      {page === 'merchant' && merchant && (
        <MerchantPage
          merchant={merchant}
          onBack={() => setPage('main')}
          onCheckout={() => setPage('checkout')}
          onToast={showToast}
        />
      )}
      {page === 'checkout' && merchant && (
        <CheckoutPage
          session={session}
          merchant={merchant}
          onBack={() => setPage('merchant')}
          onOpenPay={openPay}
          onPickAddress={() => setAddrPicker(true)}
          onToast={showToast}
        />
      )}
      {page === 'orderDetail' && orderId && (
        <OrderDetailPage
          session={session}
          orderId={orderId}
          onBack={() => {
            setTab('orders');
            setPage('main');
          }}
          onOpenPay={openPay}
          onGoOrders={() => {
            setTab('orders');
            setPage('main');
          }}
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
      {paySheet && payFor && (
        <PayMethodSheet
          amount={payFor.total}
          selected={paySel}
          onSelect={(c) => {
            setPaySel(c);
            setPaySheet(false);
          }}
          onClose={() => setPaySheet(false)}
          onToast={showToast}
        />
      )}
      {payFor && !paySheet && (
        <PayConfirmSheet
          order={payFor}
          channel={paySel}
          onChangeChannel={() => setPaySheet(true)}
          onAutoSelect={setPaySel}
          onClose={() => {
            setPayFor(null);
            setPaySel(null);
          }}
          onPaid={(o) => {
            setPayFor(null);
            setPaySel(null);
            setOrderId(o.id);
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
