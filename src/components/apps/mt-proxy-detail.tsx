'use client';

/**
 * 美团「找人代付」共享 UI（微信/QQ 聊天端与美团端共用）：
 * - MtPayBubble：聊天里的代付卡片气泡（美团黄渐变，req=代付请求卡 / done=代付完成卡；
 *   请求卡付款后由 kv 状态驱动变已代付灰化，与红包/转账卡同语义）；
 * - MtProxyDetailPage：点卡片进入的「代付详情」全屏页（对齐真机截图）：
 *   待付 = 请求人头像行 + 等待代付 + 付款须知 + 立即代付（聊天端 canPay）；
 *   已付 = 代付人头像行 + 支付成功 + 金额 + 渠道 + 付款须知 + 完成 + 订单商品卡。
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, CircleCheck, Clock as ClockIcon, HandCoins } from 'lucide-react';
import { FoodImg } from './mt-food-img';
import { MT_PROXY_CARD_EVENT, mtGetProxy, mtProxyChannelName, mtProxyPayOrder } from '@/lib/ios/mt-proxy-pay';

const fmt2 = (n: number): string => {
  const s = n.toFixed(2);
  return s.endsWith('.00') ? String(Math.round(n)) : s;
};

function fmtFull(ts: number): string {
  const d = new Date(ts);
  const p = (v: number): string => String(v).padStart(2, '0');
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 商品名剥「N杯」数量尾缀（与美团端 stripDealQty 同口径；代付详情商品行已有 ×N 数量列） */
const stripDealQty = (s: string): string =>
  s
    .replace(/\s*\d+杯/g, '')
    .replace(/（\s*）/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[·、]\s*$/u, '')
    .trim();

// ---------------- 聊天气泡（微信/QQ 共用） ----------------

export function MtPayBubble({ pid, role, onClick }: { pid: string; role: 'req' | 'done'; onClick: () => void }) {
  const p = mtGetProxy(pid);
  const paid = p?.status === 'paid';
  const settled = role === 'done' || paid;
  return (
    <button
      type="button"
      data-testid={`mt-pay-bubble-${role}`}
      onClick={onClick}
      className="relative block w-[206px] overflow-hidden rounded-[8px] text-left shadow-sm transition-all duration-300 active:brightness-95"
      style={{
        background: 'linear-gradient(135deg, #FFC53D, #FF9F1C)',
        // 已代付后卡面褪色（与红包/转账终态卡同语义）
        filter: settled ? 'grayscale(0.62) brightness(0.97)' : undefined,
      }}
      aria-label={`美团代付卡 ¥${fmt2(p?.amount ?? 0)}（${settled ? '已代付' : '待代付'}）`}
    >
      <span aria-hidden="true" className={`absolute top-[11px] h-[13px] w-[13px] rotate-45 rounded-[2px] bg-[#FFB42E] ${role === 'done' ? '-right-[3px]' : '-left-[3px]'}`} />
      <span className="relative flex items-center gap-2.5 px-3 pb-2.5 pt-3">
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border-2 border-white/90" aria-hidden="true">
          {settled ? <CircleCheck className="h-5 w-5 text-white" strokeWidth={2.4} /> : <HandCoins className="h-5 w-5 text-white" strokeWidth={2} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-tight text-white">{role === 'done' ? '代付成功' : p ? `${p.merchantName}的订单` : '美团代付请求'}</span>
          <span className="mt-0.5 block truncate text-[12.5px] text-white/95" data-testid={`mt-pay-bubble-${role}-status`}>
            {role === 'done'
              ? p
                ? `¥${fmt2(p.amount)} · ${p.paidChannel ?? mtProxyChannelName(p.idp)}`
                : '美团代付'
              : `¥${fmt2(p?.amount ?? 0)} · ${settled ? '好友已代付' : '待好友代付'}`}
          </span>
        </span>
      </span>
      <span className="relative block bg-black/[0.08] px-3 py-[5px] text-[12px] text-white/95">美团 · 找人代付</span>
    </button>
  );
}

// ---------------- 代付详情页（点卡片进入；聊天端可代付，美团端只读） ----------------

export function MtProxyDetailPage({
  pid,
  canPay,
  onBack,
  onToast,
}: {
  pid: string;
  /** 聊天端（好友视角）= true 显示「立即代付」；美团端只读 */
  canPay: boolean;
  onBack: () => void;
  onToast: (m: string) => void;
}) {
  const [ver, setVer] = useState(0);
  const [paying, setPaying] = useState(false);
  const p = mtGetProxy(pid);

  // 代付状态被别处更新（订单侧/另一端）→ 重读渲染
  useEffect(() => {
    const onCard = () => setVer((v) => v + 1);
    window.addEventListener(MT_PROXY_CARD_EVENT, onCard);
    return () => window.removeEventListener(MT_PROXY_CARD_EVENT, onCard);
  }, []);
  void ver;

  if (!p) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col bg-[#F4F5F7]">
        <div className="flex shrink-0 items-center bg-white px-2 pb-2 pt-[54px]">
          <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-6 w-6 text-black/75" />
          </button>
          <p className="min-w-0 flex-1 text-center pr-9 text-[17px] font-semibold text-black/90">代付详情</p>
        </div>
        <div className="grid flex-1 place-items-center">
          <p className="text-[13px] text-black/40">代付请求不存在或已过期</p>
        </div>
      </div>
    );
  }

  const paid = p.status === 'paid';
  const channel = p.paidChannel ?? mtProxyChannelName(p.idp);
  const platform = p.idp === 'wx' ? '微信' : 'QQ';

  const payNow = async () => {
    if (paying || paid) return;
    setPaying(true);
    await new Promise((r) => setTimeout(r, 950));
    const res = mtProxyPayOrder(p.id);
    setPaying(false);
    if (!res.ok) {
      onToast(res.error);
      return;
    }
    onToast('代付成功，订单已支付');
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#F4F5F7]" data-testid="mt-proxy-detail">
      {/* 顶栏 */}
      <div className="shrink-0 bg-white">
        <div className="relative grid h-[52px] place-items-center border-b border-black/[0.04]">
          <button type="button" aria-label="返回" data-testid="mt-proxy-detail-back" onClick={onBack} className="absolute left-1 grid h-10 w-10 place-items-center rounded-full active:bg-black/5">
            <ChevronLeft className="h-[24px] w-[24px] text-black/85" strokeWidth={2.2} />
          </button>
          <p className="text-[17px] font-semibold text-black/90">代付详情</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* 人物行：已付 = 代付人；待付 = 请求人 */}
        <div className="flex items-center gap-3 px-1 pb-3.5">
          {paid ? (
            <>
              <AvatarImg src={p.contactAvatar} name={p.contactName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-semibold text-black/90" data-testid="mt-proxy-payer-name">{p.contactName}</p>
                <p className="mt-0.5 truncate text-[13px] text-black/45">我们友谊的小船更加稳固了～</p>
              </div>
            </>
          ) : (
            <>
              <AvatarImg src={p.fromAvatar} name={p.fromName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-semibold text-black/90">{p.fromName}</p>
                <p className="mt-0.5 truncate text-[13px] text-black/45">拍下了订单，快来帮我付一下吧～</p>
              </div>
            </>
          )}
        </div>

        {/* 状态卡 */}
        <div className="rounded-2xl bg-white p-5">
          <div className="flex flex-col items-center">
            <span className="flex items-center gap-2 text-[20px] font-bold text-black/90" data-testid="mt-proxy-state">
              {paid ? (
                <>
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[#FFD100]">
                    <CircleCheck className="h-[18px] w-[18px] text-black/80" strokeWidth={2.4} />
                  </span>
                  支付成功
                </>
              ) : (
                <>
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[#FF6000]">
                    <ClockIcon className="h-[17px] w-[17px] text-white" strokeWidth={2.2} />
                  </span>
                  等待代付
                </>
              )}
            </span>
            <p className="mt-2.5 text-[42px] font-bold leading-tight tracking-tight text-black/90" data-testid="mt-proxy-amount">
              <span className="text-[26px]">¥</span>
              {fmt2(p.amount)}
            </p>
            <p className="mt-1 text-[13px] text-black/45" data-testid="mt-proxy-channel">
              {paid ? channel : `等待${p.contactName}代付（${platform}好友）`}
            </p>
            {paid && p.paidAt && <p className="mt-0.5 text-[11px] text-black/30">支付时间 {fmtFull(p.paidAt)}</p>}
          </div>

          {/* 付款须知（对齐截图黄底须知块） */}
          <div className="mt-4 rounded-xl bg-[#FFF8D9] px-4 py-3">
            <p className="text-[13px] font-semibold text-[#8F6B1E]">付款须知</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[#A98A3C]">
              1.代付订单创建成功后15分钟内未付款，订单会自动取消，你可以重新下单。
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-[#A98A3C]">
              2.当代付订单退款成功后，实付金额将原路退还代付人。
            </p>
          </div>

          {/* 主按钮：待付 + 好友视角 = 立即代付；其余 = 完成/等待 */}
          {paid ? (
            <button
              type="button"
              onClick={onBack}
              data-testid="mt-proxy-done-btn"
              className="mt-4 h-[46px] w-full rounded-full bg-[#F6D554] text-[16px] font-semibold text-black/85 active:opacity-85"
            >
              完成
            </button>
          ) : canPay ? (
            <button
              type="button"
              onClick={() => void payNow()}
              disabled={paying}
              data-testid="mt-proxy-pay-btn"
              className="mt-4 h-[46px] w-full rounded-full bg-gradient-to-r from-[#FFC300] to-[#FF9500] text-[16px] font-semibold text-white shadow-[0_3px_10px_rgba(255,170,0,0.35)] active:opacity-85 disabled:opacity-60"
            >
              {paying ? '正在支付…' : `立即代付（以${p.contactName}的身份支付）`}
            </button>
          ) : (
            <button type="button" disabled className="mt-4 h-[46px] w-full cursor-not-allowed rounded-full bg-[#F5F6F7] text-[15px] text-black/35">
              等待好友代付…
            </button>
          )}
        </div>

        {/* 订单商品卡 */}
        <div className="mt-3 rounded-2xl bg-white p-4">
          <p className="truncate text-[15px] font-bold text-black/90" data-testid="mt-proxy-merchant">{p.merchantName}</p>
          <div className="mt-3 space-y-3">
            {p.items.map((it, i) => (
              <div key={i} className="flex items-center gap-3">
                <FoodImg src={it.img} emoji={it.emoji} className="h-12 w-12 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-black/85">{stripDealQty(it.name)}</p>
                  {it.spec && <p className="mt-0.5 truncate text-[11.5px] text-black/40">{stripDealQty(it.spec)}</p>}
                  <p className="mt-0.5 text-[11.5px] text-black/40">×{it.qty}</p>
                </div>
                <span className="shrink-0 text-[14px] font-semibold text-black/85">¥{fmt2(it.price * it.qty)}</span>
              </div>
            ))}
          </div>
          {p.note && (
            <p className="mt-3 border-t border-black/[0.05] pt-2.5 text-[11.5px] text-black/40">备注：{p.note}</p>
          )}
        </div>

        <p className="mt-3 px-2 text-center text-[10.5px] leading-relaxed text-black/30">
          代付金额与订单一致 · 资金由{platform}支付保障
        </p>
      </div>
    </div>
  );
}

function AvatarImg({ src, name }: { src: string | null; name: string }) {
  if (src) return <img src={src} alt={name} className="h-11 w-11 shrink-0 rounded-full object-cover" />;
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#FFD100] text-[15px] font-bold text-black/70">
      {name.slice(0, 1)}
    </span>
  );
}
