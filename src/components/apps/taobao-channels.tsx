'use client';

/**
 * 淘宝频道页（第九轮需求开发）：
 * - SubsidyPage 百亿补贴（红：疯狂加补周/国家补贴四宫格/频道惊喜权益/补贴商品流）；
 * - SeckillPage 淘宝秒杀（橙：超级88换季/9块9疯抢/整点抢红包/正在秒杀倒计时商品流）；
 * - SignInPage 红包签到·领现金（签到日历/赚元宝/连续打卡/任务栏/客户案例，localStorage 按 uid 持久化）；
 * - MoviePage 淘票票（首页→影院列表→选座，粉：热映/新人福利/场次/座位图）；
 * - FliggyPage 飞猪旅行（黄：酒店搜索→酒店列表，机票超低价/特惠酒店/爆款榜单）；
 * - BillPage 淘宝账单（我的消费明细：真实订单月账单/年累计/省钱统计）。
 * 图标一律 SVG/lucide（禁 emoji）；数据 tb-* 键按 uid 隔离。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BedDouble,
  Bell,
  CarTaxiFront,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clapperboard,
  Crosshair,
  Flame,
  Info,
  MapPin,
  Mic,
  MoreHorizontal,
  Pencil,
  Plane,
  Play,
  Search,
  ShoppingBag,
  ShoppingCart,
  Stamp,
  Ticket,
  TrainFront,
  User,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  TB_BEST_ZONE,
  TB_CINEMAS,
  TB_FLIGGY,
  TB_MOVIES,
  TB_MOVIES_SOON,
  TB_SEAT_LAYOUT,
  TB_SECKILL,
  TB_SIGN_GOAL,
  TB_SIGN_SLOTS,
  TB_SUBSIDY,
  tbLoadSign,
  tbSaveSign,
  tbSeatSold,
  tbSignToday,
  type TbMovie,
} from '@/lib/ios/taobao-channels-data';
import { tbImg } from '@/lib/ios/taobao-data';
import { tbClaimCoupon, tbLoadCoupons, tbLoadOrders, type TbSession } from '@/lib/ios/taobao-store';

const fmtMoney = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

/** 通用页头圆钮（返回/更多） */
function HeadBtn({ onClick, label, children, dark }: { onClick: () => void; label: string; children: React.ReactNode; dark?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full active:opacity-70 ${dark ? 'bg-black/25' : 'bg-white/25'}`}
    >
      {children}
    </button>
  );
}

// ============================== 百亿补贴 ==============================

/** 百亿补贴（截图1：红底 频道页——疯狂加补周/国家补贴四宫格/频道惊喜权益/补贴商品流） */
export function SubsidyPage({
  uid,
  onBack,
  onToast,
  onOpenProduct,
}: {
  uid: string;
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenProduct: (pid: string) => void;
}) {
  const [, setTick] = useState(0);
  const [tab, setTab] = useState('精选');
  const [packetsOpen, setPacketsOpen] = useState(true);
  const coupons = tbLoadCoupons(uid);
  const claim = (name: string, amount: number, min: number) => {
    if (tbClaimCoupon(uid, { name, amount, min, pids: [] })) {
      setTick((n) => n + 1);
      onToast(`领取成功：${name} ¥${amount}`);
    } else onToast('已领取过该红包');
  };
  return (
    <div className="flex h-full flex-col bg-[#E42323]">
      {/* 顶栏（红底：返回 + 百亿补贴 + 搜索 + 更多） */}
      <div className="relative z-30 shrink-0 bg-gradient-to-b from-[#C41820] to-[#E42323] px-3 pb-3 pt-[56px]">
        <div className="flex items-center gap-2">
          <HeadBtn onClick={onBack} label="返回" dark>
            <ArrowLeft className="h-[20px] w-[20px] text-white" strokeWidth={2.4} />
          </HeadBtn>
          <span className="text-[24px] font-black italic leading-none tracking-tight text-white">百亿补贴</span>
          <div className="ml-auto flex h-[38px] min-w-0 flex-1 max-w-[190px] items-center gap-1.5 rounded-full bg-white pl-3 pr-1">
            <Search className="h-[16px] w-[16px] shrink-0 text-[#E42323]" strokeWidth={2.4} />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/75">提亮高光粉</span>
            <span className="grid h-[30px] shrink-0 place-items-center rounded-full bg-[#E42323] px-3 text-[13px] font-semibold text-white">搜索</span>
          </div>
          <HeadBtn onClick={() => onToast('更多（演示）')} label="更多" dark>
            <MoreHorizontal className="h-[19px] w-[19px] text-white" strokeWidth={2.2} />
          </HeadBtn>
        </div>
        {/* 疯狂加补周横幅 */}
        <button type="button" onClick={() => onToast('疯狂加补周（演示）')} className="mt-3 flex w-full items-center justify-between px-1 text-left active:opacity-85">
          <span className="text-[30px] font-black italic leading-none tracking-tight text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.15)]">疯狂加补周</span>
          <span className="flex flex-col items-center">
            <img src={tbImg('toy', 120, 90, 8)} alt="加补周好物" className="h-[46px] w-[68px] rounded-lg object-cover" draggable={false} />
            <span className="mt-0.5 flex items-center rounded-full bg-[#FFD100] px-2 py-px text-[11px] font-bold text-[#C41820]">
              立即抢
              <ChevronRight className="h-3 w-3" strokeWidth={3} />
            </span>
          </span>
          <span className="text-[21px] font-black italic leading-none tracking-tight text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.15)]">7折抢小米电视</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-8">
        {/* 四图横滑卡 */}
        <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-white p-2">
          {TB_SUBSIDY.hero.map((h, i) => (
            <div key={i} className="relative">
              <img src={tbImg(h.tag, 160, 160, i)} alt={h.label} className="h-[86px] w-full rounded-lg object-cover" draggable={false} />
              <span className="absolute bottom-1 left-1 rounded-[4px] bg-[#E42323] px-1 py-px text-[9.5px] font-bold leading-[13px] text-white">{h.label}</span>
            </div>
          ))}
        </div>
        {/* 国家补贴 / 补上加补 / 多人团 / 水蛋奶 */}
        <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-black/[0.06]">
          {TB_SUBSIDY.grid.map((g) => (
            <button key={g.name} type="button" onClick={() => onToast(`${g.name}（演示）`)} className="flex items-center justify-between bg-white p-3 text-left active:opacity-80">
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  {g.kind === 'nation' ? (
                    <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[#00A860]">
                      <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.4} />
                    </span>
                  ) : g.kind === 'boost' ? (
                    <span className="grid h-[18px] w-[18px] place-items-center rounded-[5px] bg-[#FF3B30]">
                      <Zap className="h-2.5 w-2.5 fill-white text-white" />
                    </span>
                  ) : g.kind === 'team' ? (
                    <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[#FF3B30]">
                      <span className="text-[10px] font-bold text-white">团</span>
                    </span>
                  ) : (
                    <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[#FF3B30]">
                      <span className="text-[9px] font-bold text-[#FFD100]">奶</span>
                    </span>
                  )}
                  <span className="text-[15px] font-bold text-black/90">{g.name}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-black/25" />
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-[22px] font-black leading-none text-[#FF0036]">
                    <span className="text-[13px] font-bold">¥</span>
                    {g.price}
                  </span>
                  {g.extra ? <span className="text-[11.5px] font-semibold text-[#FF0036]">{g.extra}</span> : null}
                </div>
              </div>
              <img src={tbImg(g.tag, 120, 140, 2)} alt={g.name} className="h-[72px] w-[58px] shrink-0 rounded-lg object-cover" draggable={false} />
            </button>
          ))}
        </div>
        {/* 频道惊喜权益（红包领取入账） */}
        <div className="mt-2 rounded-2xl bg-white p-3">
          <div className="flex items-center">
            <span className="text-[16px] font-bold text-black/90">频道惊喜权益</span>
            <button type="button" onClick={() => setPacketsOpen((v) => !v)} className="ml-auto flex items-center text-[13px] text-black/35 active:opacity-70">
              {packetsOpen ? '收起' : '展开'}
              {packetsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
          {packetsOpen ? (
            <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {TB_SUBSIDY.redpackets.map((p) => {
                const claimed = coupons.some((x) => x.name === p.name && !x.usedAt);
                return (
                  <div key={p.name} className={`w-[128px] shrink-0 rounded-xl bg-gradient-to-b from-[#FF4A38] to-[#F01E1E] p-2.5 ${claimed ? 'opacity-60' : ''}`}>
                    <div className="flex items-baseline gap-0.5 text-white">
                      <span className="text-[26px] font-black leading-none">
                        {p.amount}
                        <span className="text-[12px] font-bold">元</span>
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/85">满{p.min}可用</div>
                    <div className="mt-1 text-[12.5px] font-bold text-white">惊喜红包</div>
                    <button
                      type="button"
                      onClick={() => (claimed ? onToast('已领取过该红包') : claim(p.name, p.amount, p.min))}
                      className="mt-1.5 h-[26px] w-full rounded-full bg-white text-[12px] font-bold text-[#F01E1E] active:opacity-80"
                    >
                      {claimed ? '已领取' : '立即领用'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        {/* 频道 tab */}
        <div className="flex items-center gap-5 overflow-x-auto px-1 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TB_SUBSIDY.tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`shrink-0 text-[17px] font-bold transition-colors ${tab === t ? 'text-white' : t === '补上加补' ? 'text-[#F5C86B]' : t === '苹果专区' ? 'text-[#FFB3B3]' : 'text-white/75'}`}
            >
              {t}
            </button>
          ))}
        </div>
        {/* 补贴商品流 */}
        <div className="flex flex-col gap-2">
          {TB_SUBSIDY.items.map((it) => (
            <div key={it.id} className="flex gap-2.5 rounded-2xl bg-white p-2">
              <div className="relative w-[122px] shrink-0">
                <img src={tbImg(it.tag, 240, 240, it.id.length)} alt={it.title} className={`h-[122px] w-full rounded-xl object-cover ${it.soldOut ? 'opacity-80' : ''}`} draggable={false} />
                {it.soldOut ? (
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-14deg] rounded-lg border-[2.5px] border-[#5c6b80]/80 px-2 py-1 text-center text-[15px] font-black leading-[18px] tracking-[3px] text-[#42506380]">
                    已抢光
                    <span className="block text-[8px] font-bold leading-[10px] tracking-[1px]">SOLD OUT</span>
                  </span>
                ) : (
                  <span className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 rounded-full bg-[#FFDCE4] px-1.5 py-px text-[10px] font-bold text-[#FF2D6B]">
                    180天最低
                    <Zap className="h-2.5 w-2.5 fill-[#FF2D6B]" />
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-1">
                  <span className="shrink-0 rounded-[4px] bg-gradient-to-r from-[#FF7A45] to-[#FF2D55] px-1 py-px text-[10px] font-bold text-white">百亿补贴|超级88</span>
                  <span className="shrink-0 rounded-[4px] bg-black/80 px-1 py-px text-[10px] font-bold text-white">品牌</span>
                  <span className="shrink-0 rounded-[4px] bg-[#F7E6C3] px-1 py-px text-[10px] font-bold text-[#8a6300]">买贵必赔</span>
                </div>
                <div className="mt-1 line-clamp-2 text-[15px] font-bold leading-[20px] text-black/90">{it.title}</div>
                <div className="mt-0.5 text-[12px] text-black/45">{it.sub}</div>
                {it.specs ? (
                  <div className="mt-1.5 flex items-center">
                    {it.specs.map((s, i) => (
                      <span key={s} className={`flex-1 ${i > 0 ? 'border-l border-black/[0.08] pl-2 ml-2' : ''}`}>
                        <span className="block truncate text-[12px] text-black/75">{s}</span>
                        <span className="block text-[10.5px] text-black/35">{it.specLabels?.[i]}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-0.5 truncate text-[12.5px] font-semibold text-[#8a6300]">{it.foot}</div>
                )}
                <div className="mt-auto flex items-end">
                  <span className="rounded-l-lg bg-gradient-to-r from-[#FFE3E8] to-[#FFE9E2] py-1 pl-1.5 pr-2 text-[#FF0036]">
                    <span className="text-[13px] font-bold">¥</span>
                    <span className="text-[26px] font-black leading-none">{it.price}</span>
                    <span className="text-[11px] text-black/45">{it.unit}</span>
                    {it.orig ? <span className="ml-1 text-[11px] text-black/35 line-through">{it.orig}</span> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => (it.pid ? onOpenProduct(it.pid) : onToast('抢购成功（演示）'))}
                    className="ml-auto grid h-[38px] w-[46px] shrink-0 place-items-center rounded-lg bg-gradient-to-b from-[#FF6E9C] to-[#FF2D6B] text-[17px] font-bold text-white active:opacity-85"
                  >
                    抢
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================== 淘宝秒杀 ==============================

/** 淘宝秒杀（截图2：橙底——超级88换季/9块9疯抢/整点抢红包/正在秒杀倒计时商品流） */
export function SeckillPage({
  uid,
  onBack,
  onToast,
  onOpenProduct,
}: {
  uid: string;
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenProduct: (pid: string) => void;
}) {
  void uid;
  const [tab, setTab] = useState('精选');
  // 正在秒杀倒计时（23:54:08.6 起跳，0.1s 步进）
  const [left, setLeft] = useState(23 * 3600 + 54 * 60 + 8.6);
  useEffect(() => {
    const t = setInterval(() => setLeft((n) => (n > 0 ? Math.round((n - 0.1) * 10) / 10 : 0)), 100);
    return () => clearInterval(t);
  }, []);
  const cd = `${String(Math.floor(left / 3600)).padStart(2, '0')}:${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}.${Math.floor((left % 1) * 10)}`;
  const topGroups = [TB_SECKILL.top.slice(0, 2), TB_SECKILL.top.slice(2, 4)];
  return (
    <div className="flex h-full flex-col bg-[#FF5000]">
      {/* 顶栏 */}
      <div className="relative z-30 shrink-0 bg-gradient-to-b from-[#FF6A1E] to-[#FF5000] px-3 pb-3 pt-[56px]">
        <div className="flex items-center gap-2">
          <HeadBtn onClick={onBack} label="返回" dark>
            <ArrowLeft className="h-[20px] w-[20px] text-white" strokeWidth={2.4} />
          </HeadBtn>
          <span className="text-[23px] font-black italic leading-none tracking-tight text-[#FFE84D]">淘宝秒杀</span>
          <div className="ml-auto flex h-[38px] min-w-0 flex-1 max-w-[190px] items-center gap-1.5 rounded-full bg-white/95 pl-3">
            <Search className="h-[16px] w-[16px] shrink-0 text-black/40" />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/70">备用手机</span>
            <span className="grid h-[30px] shrink-0 place-items-center rounded-full bg-[#FF3B30] px-2.5 text-[13px] font-semibold text-white">搜低价</span>
          </div>
          <HeadBtn onClick={() => onToast('更多（演示）')} label="更多" dark>
            <MoreHorizontal className="h-[19px] w-[19px] text-white" strokeWidth={2.2} />
          </HeadBtn>
        </div>
        {/* 超级88换季必备横幅 */}
        <button type="button" onClick={() => onToast('超级88换季必备（演示）')} className="relative mt-2 flex h-[104px] w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-r from-[#FF7A21] via-[#FF5A10] to-[#FF7A21] active:opacity-90">
          <span className="text-[40px] font-black italic leading-none tracking-tight text-[#FFE84D] drop-shadow-[0_2px_0_rgba(0,0,0,0.18)]">超级88</span>
          <img src={tbImg('toy', 120, 120, 3)} alt="换季好物" className="mx-2 h-[76px] w-[76px] rounded-xl object-cover" draggable={false} />
          <span className="text-[40px] font-black italic leading-none tracking-tight text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.18)]">换季必备</span>
          <span className="absolute bottom-2 right-2 rounded-md bg-black/30 px-1.5 py-px text-[11px] font-semibold text-white">1/4</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-8">
        {/* 9块9品牌疯抢 / 0.99产地直发 */}
        <div className="rounded-2xl bg-white p-3">
          <div className="grid grid-cols-2 gap-3">
            {topGroups.map((g, gi) => (
              <div key={gi}>
                <div className="text-[19px] font-black italic leading-none text-[#FF0036]">
                  {gi === 0 ? '9块9' : '0.99'}
                  <span className="text-[13px] font-bold text-black/85">{gi === 0 ? '品牌疯抢' : '产地直发'}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {g.map((it, i) => (
                    <button key={i} type="button" onClick={() => onToast('秒杀价已锁定（演示）')} className="text-left active:opacity-80">
                      <div className="relative">
                        <img src={tbImg(it.tag, 160, 160, i + 4)} alt={it.label} className="h-[84px] w-full rounded-lg object-cover" draggable={false} />
                        <span className="absolute bottom-0.5 left-0.5 rounded-[4px] bg-[#FF3B30] px-1 py-px text-[9px] font-bold text-white">{it.label}</span>
                      </div>
                      <div className="mt-1 text-[15px] font-black text-[#FF0036]">
                        <span className="text-[11px] font-bold">¥</span>
                        {it.price}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {/* 一分领商品 + 整点抢红包 */}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => onToast('一分领商品（演示）')} className="flex h-[42px] flex-1 items-center gap-2 rounded-lg bg-[#FFF3C2] px-2.5 text-left active:opacity-80">
              <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[#FFD100] text-[13px] font-black text-[#8a6300]">1分</span>
              <span className="text-[14px] font-bold text-black/85">一分领商品</span>
              <ChevronRight className="h-4 w-4 text-black/30" />
            </button>
            <button type="button" onClick={() => onToast('整点抢红包（演示）')} className="flex h-[42px] flex-1 items-center gap-1.5 rounded-lg bg-[#FF3B30] px-2.5 text-left active:opacity-85">
              <span className="text-[17px] font-black text-[#FFE84D]">¥5</span>
              <span className="text-[14px] font-bold text-white">整点抢红包</span>
              <span className="ml-auto text-[16px] font-black text-white">抢</span>
            </button>
          </div>
        </div>
        {/* 正在秒杀（白面板 + 倒计时） */}
        <div className="mt-2.5 rounded-t-2xl bg-white px-3 pt-3">
          <div className="flex items-center">
            <span className="text-[21px] font-black italic leading-none text-[#FF0036]">正在秒杀</span>
            <span className="ml-2 flex items-center gap-0.5 font-mono text-[14px] font-bold text-white">
              <span className="rounded-[4px] bg-[#FF3B30] px-1 py-px">{cd.slice(0, 2)}</span>
              <span className="text-[#FF3B30]">:</span>
              <span className="rounded-[4px] bg-[#FF3B30] px-1 py-px">{cd.slice(3, 5)}</span>
              <span className="text-[#FF3B30]">:</span>
              <span className="rounded-[4px] bg-[#FF3B30] px-1 py-px">{cd.slice(6)}</span>
            </span>
            <button type="button" onClick={() => onToast('明天20点场（演示）')} className="ml-auto text-[14px] font-semibold text-black/60 active:opacity-70">明天20点抢</button>
            <span className="mx-1.5 h-3 w-px bg-black/10" />
            <button type="button" onClick={() => onToast('后天20点场（演示）')} className="text-[14px] font-semibold text-black/60 active:opacity-70">后天20点抢</button>
          </div>
          {/* 场次 tab */}
          <div className="mt-3 flex items-center gap-5 overflow-x-auto pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TB_SECKILL.tabs.map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`shrink-0 text-[16.5px] font-bold transition-colors ${tab === t ? 'text-[#FF0036]' : 'text-black/65'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {/* 秒杀商品流 */}
        <div className="rounded-b-2xl bg-white px-2 pb-3 pt-1">
          {TB_SECKILL.items.map((it) => (
            <div key={it.id} className="flex gap-2.5 border-t border-black/[0.05] px-0.5 py-3 first:border-t-0">
              <img src={tbImg(it.tag, 220, 220, it.id.length + 2)} alt={it.title} className="h-[112px] w-[112px] shrink-0 rounded-xl object-cover" draggable={false} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="truncate text-[15.5px] font-bold text-black/90">{it.title}</div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="flex h-[12px] w-[110px] overflow-hidden rounded-full bg-black/[0.08]">
                    <span className="h-full rounded-full bg-gradient-to-r from-[#FFD100] to-[#FF9A00]" style={{ width: `${it.grab}%` }} />
                  </span>
                  <span className="text-[11px] font-semibold text-[#FF6A1E]">已抢{it.grab}%</span>
                  <span className="ml-auto text-[12px] text-black/45">{it.sold}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[12px]">
                  {it.foot.map((f) => (
                    <span key={f} className="flex items-center gap-0.5 font-semibold text-[#FF0036]">
                      {f.startsWith('直降') ? <Zap className="h-3 w-3 fill-[#FF0036]" /> : null}
                      {f}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex items-end">
                  <span className="rounded-l-lg bg-gradient-to-r from-[#FFE3E8] to-[#FFE9E2] py-1 pl-1.5 pr-2">
                    <span className="text-[13px] font-bold text-[#FF0036]">¥</span>
                    <span className="text-[25px] font-black leading-none text-[#FF0036]">{it.price}</span>
                    <span className="ml-0.5 text-[11px] font-semibold text-[#FF0036]">秒杀价</span>
                    <span className="ml-1 text-[11px] text-black/35 line-through">优惠前{it.orig}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => (it.pid ? onOpenProduct(it.pid) : onToast('抢购成功（演示）'))}
                    className="ml-auto grid h-[38px] w-[46px] shrink-0 place-items-center rounded-lg bg-gradient-to-b from-[#FF4A2A] to-[#FF2600] text-[17px] font-bold text-white active:opacity-85"
                  >
                    抢
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================== 红包签到 ==============================

/** 红包签到·领现金（截图3：橙红——签到日历/赚元宝/点击领取/连续打卡/任务栏/客户案例） */
export function SignInPage({ uid, onBack, onToast }: { uid: string; onBack: () => void; onToast: (m: string) => void }) {
  const [sign, setSign] = useState(() => tbLoadSign(uid));
  const today = tbSignToday();
  const doneToday = sign.last === today;
  // 连签槽位数（已签今天 = 连签第 n 天；未签 = 已连续 n 天）
  const filled = doneToday ? ((sign.streak - 1) % 5) + 1 : sign.streak % 5;
  const pct = Math.min(100, (sign.coins / TB_SIGN_GOAL) * 100);
  const cash = (sign.coins / TB_SIGN_GOAL).toFixed(2);
  const [cdLeft, setCdLeft] = useState(3 * 3600 + 54 * 60 + 49);
  useEffect(() => {
    const t = setInterval(() => setCdLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  const cdText = `${String(Math.floor(cdLeft / 3600)).padStart(2, '0')}:${String(Math.floor((cdLeft % 3600) / 60)).padStart(2, '0')}:${String(cdLeft % 60).padStart(2, '0')}`;

  const doSign = () => {
    if (doneToday) {
      onToast('今日已签到，明天再来领现金');
      return;
    }
    const next = { ...sign, last: today, streak: sign.streak + 1, coins: sign.coins + 7200 };
    tbSaveSign(uid, next);
    setSign(next);
    onToast('签到成功，元宝+7200');
  };
  const takeBonus = (amount: number, label: string) => {
    if (sign.bonusDay === today && sign.last === today) {
      onToast('今日已领取，明天再来');
      return;
    }
    const next = { ...sign, coins: sign.coins + amount, bonusDay: today, last: sign.last };
    tbSaveSign(uid, next);
    setSign(next);
    onToast(`${label}，元宝+${amount}`);
  };
  const coinIcon = (size = 34) => (
    <svg width={size} height={size * 0.72} viewBox="0 0 40 29" aria-hidden="true">
      <ellipse cx="20" cy="18" rx="17" ry="10" fill="#FFD100" />
      <ellipse cx="20" cy="14" rx="15" ry="9" fill="#FFE14D" />
      <path d="M8 10c3-4 8-6 12-6s9 2 12 6" stroke="#FFC300" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  );
  const tasks = [
    { icon: <Wallet className="h-[22px] w-[22px] text-white" strokeWidth={2} />, bg: 'from-[#4A9BFF] to-[#2E7BE8]', label: '天天提现', badge: '' },
    { icon: <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-white/25"><svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M7 4c2-2 4.5-2.6 6-2-.4 2-1.6 3.4-3 4 1.8.6 3 2 3 4.2 0 2.8-2.4 5-6 5s-6-2.2-6-5C1 8 2.2 6.6 4 6 2.6 5.4 1.4 4 1 2c1.5-.6 4 0 6 2Z" fill="#fff"/></svg></span>, bg: 'from-[#FFB03A] to-[#FF8A00]', label: '抽iphone', badge: '' },
    { icon: <span className="text-[11px] font-black leading-[12px] text-white">40元</span>, bg: 'from-[#FF5A4A] to-[#F01E1E]', label: '折扣红包', badge: '' },
    { icon: <span className="text-[15px] font-black text-[#8a6300]">¥</span>, bg: 'from-[#FFE14D] to-[#FFC300]', label: '点击领取', badge: '+40' },
    { icon: <Play className="h-[20px] w-[20px] fill-white text-white" />, bg: 'from-[#FFB03A] to-[#FF8A00]', label: '看小说短剧', badge: '+500' },
    { icon: <span className="text-[13px] font-black text-white">蚁</span>, bg: 'from-[#3BC46A] to-[#1E9E4E]', label: '去蚂蚁', badge: '' },
  ];
  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[#FF7A2E] via-[#FF5A28] to-[#FF3B30]">
      {/* 顶栏 */}
      <div className="relative z-30 shrink-0 px-3 pt-[56px]">
        <div className="flex items-center gap-2">
          <HeadBtn onClick={onBack} label="返回" dark>
            <ArrowLeft className="h-[20px] w-[20px] text-white" strokeWidth={2.4} />
          </HeadBtn>
          <span className="text-[21px] font-black leading-none text-white">
            红包签到·<span className="text-[#FFE84D]">领现金</span>
          </span>
          <button type="button" onClick={() => onToast('规则：签到得元宝，攒满可提现')} className="ml-auto rounded-md bg-black/25 px-2.5 py-1 text-[13px] font-medium text-white active:opacity-70">规则</button>
          <HeadBtn onClick={() => onToast('更多（演示）')} label="更多" dark>
            <MoreHorizontal className="h-[19px] w-[19px] text-white" strokeWidth={2.2} />
          </HeadBtn>
        </div>
        {/* 提现进度 + 10元提现卡 */}
        <div className="mt-2 flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[15px] font-bold text-white/95">
              再攒
              {coinIcon(26)}
              100000提现
            </div>
            <div className="mt-0.5 font-black leading-none text-white">
              <span className="text-[56px] tracking-tight">{cash.split('.')[0]}</span>
              <span className="text-[30px]">.{cash.split('.')[1]}</span>
              <span className="text-[20px] font-bold">元</span>
            </div>
            <div className="mt-2 h-[9px] w-[86%] overflow-hidden rounded-full bg-black/20">
              <span className="block h-full rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFAA00]" style={{ width: `${Math.max(1.5, pct)}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-white/70">{Math.floor(pct)}%</div>
          </div>
          <button type="button" onClick={() => onToast('攒满10元即可提现（演示）')} className="mt-1 w-[128px] shrink-0 rotate-[2deg] rounded-2xl bg-[#2E9BFF] p-1.5 shadow-lg ring-2 ring-white/50 active:opacity-85">
            <div className="rounded-xl bg-white px-2 py-2 text-center">
              <div className="text-[27px] font-black leading-none text-[#1E5FD8]">
                10<span className="text-[13px]">元</span>
              </div>
              <div className="mt-0.5 text-[11px] font-medium text-[#1E5FD8]/70">攒满提现 &gt;</div>
              <div className="mt-1 flex justify-center gap-1">
                <span className="grid h-[16px] w-[16px] place-items-center rounded-full bg-[#1677FF] text-[9px] font-bold text-white">支</span>
                <span className="grid h-[16px] w-[16px] place-items-center rounded-full bg-[#22C55E] text-[9px] font-bold text-white">微</span>
              </div>
            </div>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-8">
        {/* 连续签到奖励卡 */}
        <div className="mt-2 rounded-2xl bg-white p-3">
          <div className="flex items-center gap-2">
            <span className="text-[17px] font-black text-black/90">
              连续签到奖励 <span className="text-[15px]">({filled}/5)</span>
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-black/40">t*k提现100元，推荐您参与</span>
            <button type="button" onClick={() => onToast('已开启签到提醒')} className="flex shrink-0 items-center gap-1 rounded-full bg-black/[0.06] px-2.5 py-1.5 text-[12px] font-medium text-black/70 active:opacity-70">
              <Bell className="h-3.5 w-3.5" />
              开启提醒
            </button>
          </div>
          {/* 五日槽 */}
          <div className="mt-2.5 grid grid-cols-5 gap-1.5">
            {TB_SIGN_SLOTS.map((s, i) => {
              const got = doneToday && i < filled;
              return (
                <div
                  key={i}
                  className={`relative flex flex-col items-center justify-center rounded-xl px-1 py-2 ${s.kind === 'today' ? 'bg-[#FFF3C2]' : s.kind === 'extra' ? 'bg-[#E8F3FF] ring-1 ring-[#8FC4FF]' : 'bg-black/[0.045]'}`}
                >
                  {got ? (
                    <span className="absolute right-0.5 top-0.5 grid h-[14px] w-[14px] place-items-center rounded-full bg-[#FF3B30]">
                      <Check className="h-2 w-2 text-white" strokeWidth={4} />
                    </span>
                  ) : null}
                  {coinIcon(30)}
                  {s.kind === 'today' ? (
                    <>
                      <span className="mt-1 text-[14px] font-black leading-none text-[#FF3B30]">{s.coins}</span>
                      <span className="mt-0.5 text-[10px] font-semibold text-[#c2482f]">{got ? '已完成' : s.label}</span>
                    </>
                  ) : s.kind === 'extra' ? (
                    <>
                      <span className="mt-1 text-[12px] font-black leading-[13px] text-[#1E7FE8]">额外提现</span>
                      <span className="mt-0.5 text-center text-[9.5px] leading-[11px] text-[#1E7FE8]/70">{s.label}</span>
                    </>
                  ) : (
                    <>
                      <span className="mt-1 text-[12.5px] font-bold leading-none text-black/75">领现金</span>
                      <span className="mt-0.5 text-[10px] text-black/40">{s.label}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {/* 赚元宝 / 立即签到 / 点击领取 */}
          <div className="mt-2 flex items-stretch gap-2">
            <button type="button" onClick={() => takeBonus(8490, '看视频赚元宝')} className="relative flex w-[78px] shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-to-b from-[#FFB25A] to-[#FF8A3C] py-2 active:opacity-85">
              <span className="absolute -top-1.5 left-1 rounded-full bg-[#FF3B30] px-1.5 py-px text-[10px] font-bold text-white">+8490</span>
              {coinIcon(32)}
              <span className="mt-1 text-[13px] font-bold text-white">赚元宝</span>
            </button>
            <button
              type="button"
              onClick={doSign}
              className={`h-[68px] min-w-0 flex-1 rounded-xl text-[23px] font-black tracking-[6px] text-white active:opacity-90 ${doneToday ? 'bg-black/20' : 'bg-gradient-to-r from-[#FF4A2A] to-[#F5222D]'}`}
            >
              {doneToday ? '已签到' : '立即签到'}
            </button>
            <button type="button" onClick={() => takeBonus(1280, '点击领取')} className="relative flex w-[78px] shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-to-b from-[#FFB25A] to-[#FF8A3C] py-2 active:opacity-85">
              <span className="absolute -top-1.5 right-1 rounded-full bg-[#FF3B30] px-1.5 py-px text-[10px] font-bold text-white">+1280</span>
              {coinIcon(32)}
              <span className="mt-1 text-[13px] font-bold text-white">点击领取</span>
            </button>
          </div>
        </div>
        {/* 66元连续打卡卡 */}
        <div className="mt-2 flex items-center gap-3 rounded-2xl bg-white p-3">
          <div className="w-[88px] shrink-0 rounded-xl bg-gradient-to-b from-[#2ECC71] to-[#1E9E4E] p-2 text-center">
            <div className="text-[21px] font-black leading-none text-white">
              66<span className="text-[12px]">元</span>
            </div>
            <div className="mt-1 flex justify-center gap-1">
              <span className="grid h-[14px] w-[14px] place-items-center rounded-full bg-white text-[8px] font-bold text-[#1677FF]">支</span>
              <span className="grid h-[14px] w-[14px] place-items-center rounded-full bg-white text-[8px] font-bold text-[#22C55E]">微</span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[16.5px] font-black text-black/90">
              连续打卡<span className="text-[#FF3B30]">免费</span>领奖
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[12px] font-semibold text-[#FF3B30]">
              <Flame className="h-3.5 w-3.5 fill-[#FF3B30]" />
              3497056 人已领到
            </div>
          </div>
          <button type="button" onClick={() => onToast('连续打卡活动（演示）')} className="h-[40px] shrink-0 rounded-lg bg-[#FF3B30] px-4 text-[14.5px] font-bold text-white active:opacity-85">
            去参与
          </button>
        </div>
        {/* 任务栏（橙底） */}
        <div className="mt-3 grid grid-cols-6 gap-1 px-1">
          {tasks.map((t) => (
            <button key={t.label} type="button" onClick={() => onToast(`${t.label}（演示）`)} className="relative flex flex-col items-center gap-1 active:opacity-75">
              <span className={`relative grid h-[44px] w-[44px] place-items-center rounded-[12px] bg-gradient-to-b ${t.bg}`}>
                {t.icon}
                {t.badge ? <span className="absolute -right-2 -top-2 rounded-full bg-[#FF3B30] px-1 py-px text-[9px] font-bold text-white">{t.badge}</span> : null}
              </span>
              <span className="text-[10.5px] font-medium text-white/95">{t.label}</span>
            </button>
          ))}
        </div>
        {/* 搜索条 */}
        <div className="mt-3 flex h-[46px] items-center gap-2 rounded-xl bg-white px-2.5">
          <Search className="h-[19px] w-[19px] shrink-0 text-[#FF6A1E]" />
          <span className="min-w-0 flex-1 truncate text-[14.5px] text-black/80">备用手机</span>
          <span className="shrink-0 rounded-[4px] bg-[#FF3B30] px-1.5 py-px text-[10.5px] font-bold text-white">猜你想搜</span>
          <button type="button" onClick={() => onToast('搜索（演示）')} className="grid h-[34px] shrink-0 place-items-center rounded-lg bg-gradient-to-r from-[#FF7A21] to-[#FF4400] px-4 text-[14px] font-semibold text-white active:opacity-85">
            搜索
          </button>
        </div>
        {/* 客户案例分享 */}
        <div className="mt-3 text-[15px] font-black text-white">客户案例分享</div>
        <div className="mt-2 grid grid-cols-2 gap-2 pb-2">
          <button type="button" onClick={() => onToast('拍报机案例（演示）')} className="rounded-xl bg-white p-2 text-left active:opacity-80">
            <div className="grid grid-cols-2 gap-0.5 overflow-hidden rounded-lg">
              {[0, 1, 2, 3].map((i) => (
                <img key={i} src={tbImg('kiosk', 160, 120, i)} alt="拍报机案例" className="h-[52px] w-full object-cover" draggable={false} />
              ))}
            </div>
            <div className="mt-1.5 line-clamp-2 text-[13px] font-bold leading-[17px] text-black/85">头条拍报机大头贴机器网红打卡</div>
            <div className="mt-0.5 text-[11px] text-[#FF3B30]">红包省2.74元 包邮</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-[16px] font-black text-[#FF3B30]">
                <span className="text-[10px]">¥</span>407.26
              </span>
              <span className="text-[10px] font-semibold text-[#FF3B30]">红包价</span>
              <span className="ml-auto text-[10px] text-black/40">已售58件</span>
            </div>
          </button>
          <button type="button" onClick={() => onToast('浮球杯案例（演示）')} className="relative rounded-xl bg-white p-2 text-left active:opacity-80">
            <img src={tbImg('mug', 320, 240, 6)} alt="卡通动物浮球杯" className="h-[110px] w-full rounded-lg object-cover" draggable={false} />
            <div className="mt-1.5 flex items-center gap-1">
              <span className="shrink-0 rounded-[3px] bg-[#FF3B30] px-1 py-px text-[9.5px] font-bold text-white">天天特价</span>
              <span className="truncate text-[13px] font-bold text-black/85">2026新款浮球杯</span>
            </div>
            <div className="mt-0.5 text-[11px] text-[#FF3B30]">红包省2.74元 包邮 满29</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-[16px] font-black text-[#FF3B30]">
                <span className="text-[10px]">¥</span>7.27
              </span>
              <span className="text-[10px] font-semibold text-[#FF3B30]">红包价</span>
              <span className="ml-auto text-[10px] text-black/40">爆卖1万+件</span>
            </div>
            <span className="absolute bottom-9 right-1.5 rounded-lg bg-[#FF3B30] px-1.5 py-1 text-center text-white shadow-lg">
              <span className="block text-[13px] font-black leading-[15px]">
                2.74<span className="text-[9px]">元</span>
              </span>
              <span className="block font-mono text-[10px] leading-[12px]">{cdText}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================== 淘票票 ==============================

/** 电影海报（渐变 + 片名叠字，免图片依赖） */
function MoviePoster({ m, h = 146, onOpen }: { m: TbMovie; h?: number; onOpen?: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="relative block w-full overflow-hidden rounded-lg text-left active:opacity-85" style={{ height: h, background: `linear-gradient(160deg, ${m.c1} 0%, ${m.c2} 100%)` }}>
      <span className="absolute left-1.5 top-1.5 rounded-[3px] bg-black/45 px-1 py-px text-[9.5px] font-bold text-white">{m.badge}</span>
      <span className="absolute inset-x-1.5 top-7 text-[16px] font-black leading-[21px] tracking-wide text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">{m.title}</span>
      {m.rating != null ? (
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-1.5 pb-1 pt-4 text-[12.5px] font-bold text-white">评分 {m.rating}</span>
      ) : m.want ? (
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-1.5 pb-1 pt-4 text-[11.5px] font-bold text-white">{m.want}</span>
      ) : null}
    </button>
  );
}

/** 淘票票（截图4/5/6/7：首页→影院列表→选座；内部三级导航） */
export function MoviePage({
  onBack,
  onToast,
  onOpenCouponCenter,
}: {
  onBack: () => void;
  onToast: (m: string) => void;
  onOpenCouponCenter: () => void;
}) {
  const [view, setView] = useState<'home' | 'cinemas' | 'seats'>('home');
  const [movie, setMovie] = useState<TbMovie>(TB_MOVIES[3]);
  const [day, setDay] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const dateLabels = useMemo(() => {
    const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return ['今天', '明天', '后天'].map((l, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return { label: l, date: fmt(d) };
    });
  }, []);
  const fmtLong = useMemo(() => {
    const d = new Date();
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }, []);

  const toggleSeat = (r: number, k: number) => {
    const key = `${r}-${k}`;
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        if (next.size >= 5) {
          onToast('一次最多选5个座位');
          return prev;
        }
        next.add(key);
      }
      return next;
    });
  };
  const pickRecommend = (n: number) => {
    for (let r = TB_BEST_ZONE.r1; r <= TB_BEST_ZONE.r2; r++) {
      const row = TB_SEAT_LAYOUT[r];
      let run = 0;
      for (let c = 0; c < row.length; c++) {
        if (!row[c] || tbSeatSold(r, c)) {
          run = 0;
          continue;
        }
        run++;
        if (run === n) {
          const next = new Set<string>();
          for (let x = c - n + 1; x <= c; x++) next.add(`${r}-${x}`);
          setSel(next);
          return;
        }
      }
    }
    onToast('最佳观影区暂无连座');
  };
  const confirmSeats = () => {
    if (sel.size === 0) return;
    onToast(`出票成功：${sel.size}张 共¥${sel.size * 38}（${movie.title}）`);
    setSel(new Set());
    setView('cinemas');
  };

  // ---------- 选座 ----------
  if (view === 'seats') {
    return (
      <div className="flex h-full flex-col bg-white">
        {/* 顶栏 */}
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-[56px]">
          <button type="button" aria-label="返回" onClick={() => setView('cinemas')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:opacity-60">
            <ArrowLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.2} />
          </button>
          <span className="min-w-0 flex-1 truncate text-center text-[18px] font-bold text-black/90">{movie.id === 'm4' ? '台前县中影时光…' : `${movie.title}·附近影城`}</span>
          <button type="button" aria-label="更多" onClick={() => onToast('更多（演示）')} className="grid h-8 w-[52px] shrink-0 place-items-center rounded-full bg-black/[0.05]">
            <MoreHorizontal className="h-[17px] w-[17px] text-black/70" />
          </button>
        </div>
        {/* 图例 */}
        <div className="flex shrink-0 items-center justify-center gap-7 pb-2 pt-1 text-[13px] text-black/60">
          <span className="flex items-center gap-1.5">
            <span className="h-[15px] w-[15px] rounded-[4px] border border-black/20 bg-white" />
            可选
          </span>
          <span className="flex items-center gap-1.5">
            <span className="grid h-[15px] w-[15px] place-items-center rounded-[4px] bg-[#F03E3E]">
              <span className="h-[3px] w-[3px] rounded-full bg-white/90 shadow-[3px_0_0_0_rgba(255,255,255,0.9)]" />
            </span>
            已售
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[15px] w-[15px] rounded-[4px] border border-dashed border-[#F03E8C]" />
            最佳观影区
          </span>
        </div>
        {/* 银幕 */}
        <div className="shrink-0 px-8">
          <svg viewBox="0 0 300 14" className="h-[14px] w-full" aria-hidden="true">
            <path d="M4 12 Q150 -8 296 12" stroke="#F03E8C" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M4 12 Q150 -8 296 12" stroke="#F03E8C" strokeWidth="9" fill="none" opacity="0.18" />
          </svg>
          <div className="pb-1 pt-0.5 text-center text-[12px] text-black/35">三号激光影厅 银幕</div>
        </div>
        {/* 座位图 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <div className="relative mx-auto w-fit py-2">
            {TB_SEAT_LAYOUT.map((row, r) => {
              let k = -1;
              return (
                <div key={r} className="flex items-center gap-[6px] pb-[10px] last:pb-0">
                  <span className="grid h-[20px] w-[20px] shrink-0 place-items-center rounded bg-black/[0.06] text-[11px] text-black/45">{r + 1}</span>
                  {row.map((v, ci) => {
                    if (!v) return <span key={ci} className="h-[20px] w-[6px]" />;
                    k++;
                    const key = `${r}-${k}`;
                    const sold = tbSeatSold(r, k);
                    const picked = sel.has(key);
                    return (
                      <button
                        key={ci}
                        type="button"
                        aria-label={`${r + 1}排${k + 1}列`}
                        onClick={() => toggleSeat(r, k)}
                        disabled={sold}
                        className={`h-[20px] w-[24px] rounded-[5px] transition-colors ${sold ? 'bg-[#F03E3E]' : picked ? 'grid place-items-center bg-[#12B76A]' : 'border border-black/15 bg-white'}`}
                      >
                        {picked ? <Check className="h-3 w-3 text-white" strokeWidth={3.4} /> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {/* 最佳观影区虚线框（行3-5 × 座位序3-7，座位宽24+间距6=30/格） */}
            <span
              className="pointer-events-none absolute rounded-md border-[1.5px] border-dashed border-[#F03E8C]"
              style={{ left: 26 + TB_BEST_ZONE.c1 * 30 - 5, top: TB_BEST_ZONE.r1 * 30 - 4, width: (TB_BEST_ZONE.c2 - TB_BEST_ZONE.c1 + 1) * 30 - 8, height: (TB_BEST_ZONE.r2 - TB_BEST_ZONE.r1 + 1) * 30 - 12 }}
            />
            {/* 中央走道虚线 */}
            <span className="pointer-events-none absolute bottom-1 left-1/2 top-1 border-l border-dashed border-black/15" />
          </div>
          <div className="pb-2 pt-3 text-center text-[15px] font-bold text-[#C6CBD4]">淘票票</div>
        </div>
        {/* 底部信息与确认 */}
        <div className="shrink-0 bg-[#F4F5F7] px-3 pb-5 pt-2">
          <button type="button" onClick={() => onToast('观影须知：1.2米以下免票（演示）')} className="flex w-full items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-left active:opacity-80">
            <span className="shrink-0 rounded-[4px] border border-[#FF8A00]/50 px-1 py-px text-[10.5px] font-bold text-[#FF8A00]">儿童须知</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/75">1.2米以下免票</span>
            <span className="shrink-0 text-[13px] text-black/35">共1条 &gt;</span>
          </button>
          <div className="mt-2 rounded-xl bg-white p-3">
            <div className="flex items-center">
              <span className="truncate text-[15px] font-bold text-black/90">{movie.title}</span>
              <button type="button" onClick={() => setView('cinemas')} className="ml-auto shrink-0 text-[13.5px] font-medium text-[#3B82F6] active:opacity-70">切换场次</button>
            </div>
            <div className="mt-0.5 text-[13.5px] text-black/75">
              <span className="font-semibold text-[#FF3676]">{dateLabels[day].label}</span> {fmtLong} 21:00-22:28 国语 2D
            </div>
            <span className="mt-2 inline-block rounded-lg border-[1.5px] border-[#FF3676] bg-[#FFF0F5] px-3 py-1.5">
              <span className="text-[13.5px] font-bold text-black/90">21:00</span>
              <span className="ml-1.5 text-[11px] text-black/50">国语 2D</span>
              <span className="ml-1.5 text-[13px] font-bold text-[#FF3676]">¥38</span>
            </span>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[13px] text-black/55">推荐座位</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => pickRecommend(n)} className="rounded-lg bg-black/[0.045] px-3 py-1.5 text-[13.5px] text-black/80 active:opacity-70">
                  {n}人
                </button>
              ))}
            </div>
            {sel.size > 0 ? (
              <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {[...sel].map((key) => {
                  const [r, k] = key.split('-').map(Number);
                  return (
                    <span key={key} className="relative shrink-0 rounded-lg bg-white px-3 py-1.5 text-center shadow-sm">
                      <button type="button" aria-label="移除座位" onClick={() => toggleSeat(r, k)} className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 place-items-center">
                        <X className="h-2.5 w-2.5 text-black/30" strokeWidth={3} />
                      </button>
                      <span className="block text-[13.5px] font-bold leading-[16px] text-black/85">
                        {r + 1}排{k + 1}列
                      </span>
                      <span className="block text-[10.5px] leading-[13px] text-[#FF3676]">新人价¥38</span>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={confirmSeats}
            className={`mt-2.5 h-[52px] w-full rounded-full text-[17px] font-bold text-white active:opacity-90 ${sel.size === 0 ? 'bg-[#F3B7CC]/70' : 'bg-gradient-to-r from-[#FF5C8A] to-[#FF2D6B]'}`}
          >
            {sel.size === 0 ? '请先选座' : `${sel.size * 38}元 确认选座`}
          </button>
        </div>
      </div>
    );
  }

  // ---------- 影院列表 ----------
  if (view === 'cinemas') {
    const first = TB_CINEMAS[0];
    const rest = TB_CINEMAS.slice(1);
    return (
      <div className="flex h-full flex-col bg-[#F4F5F7]">
        <div className="shrink-0 bg-white">
          <div className="flex items-center gap-2 px-3 pb-2 pt-[56px]">
            <button type="button" aria-label="返回" onClick={() => setView('home')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:opacity-60">
              <ArrowLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.2} />
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-[18px] font-bold text-black/90">{movie.title}</span>
            <button type="button" aria-label="更多" onClick={() => onToast('更多（演示）')} className="grid h-8 w-[52px] shrink-0 place-items-center rounded-full bg-black/[0.05]">
              <MoreHorizontal className="h-[17px] w-[17px] text-black/70" />
            </button>
          </div>
          {/* 日期 tab */}
          <div className="flex items-center gap-7 px-4 pt-1">
            {dateLabels.map((d, i) => (
              <button key={d.label} type="button" onClick={() => setDay(i)} className={`relative pb-2 text-[16px] ${day === i ? 'font-bold text-black/90' : 'text-black/45'}`}>
                {d.label} {d.date}
                {day === i ? <span className="absolute bottom-0 left-1/2 h-[3px] w-[26px] -translate-x-1/2 rounded-full bg-[#FF3676]" /> : null}
              </button>
            ))}
          </div>
          {/* 筛选行 */}
          <div className="flex items-center gap-5 px-4 py-2.5 text-[15px] text-black/85">
            {['濮阳全域', '筛选', '品牌'].map((f) => (
              <button key={f} type="button" onClick={() => onToast(`${f}（演示）`)} className="flex items-center gap-0.5 active:opacity-70">
                {f}
                <ChevronDown className="h-3.5 w-3.5 text-black/40" />
              </button>
            ))}
            <button type="button" onClick={() => onToast('综合排序（演示）')} className="ml-auto flex items-center gap-1 active:opacity-70">
              <Info className="h-3.5 w-3.5 text-black/35" />
              综合排序
              <ChevronDown className="h-3.5 w-3.5 text-black/40" />
            </button>
            <Search className="h-[18px] w-[18px] text-black/70" />
          </div>
          {/* 影厅筛选 chips */}
          <div className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {['杜比全景声厅', '4K厅', 'realD厅', '大麦VIP印花票根'].map((c) => (
              <button key={c} type="button" onClick={() => onToast(`${c}筛选（演示）`)} className="shrink-0 rounded-lg bg-black/[0.045] px-3 py-1.5 text-[13.5px] text-black/70 active:opacity-70">
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-8">
          {/* 可购票影院 */}
          <div className="mt-1 rounded-2xl bg-white p-3.5">
            <div className="flex items-center">
              <span className="min-w-0 flex-1 truncate text-[17px] font-black text-black/90">{first.name}</span>
              {first.hot ? (
                <span className="ml-2 shrink-0 text-[#FF3676]">
                  <span className="text-[12px] font-semibold">新人</span>
                  <span className="text-[20px] font-black leading-none">¥38</span>
                  <span className="text-[12px]">起</span>
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[13px] text-black/45">{first.addr}</span>
              <span className="shrink-0 text-[13px] text-black/45">{first.dist}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {first.tags.map((t) => (
                <span
                  key={t}
                  className={`rounded-[4px] border px-1.5 py-px text-[11px] ${t === '影城卡' || t.startsWith('券包') ? 'border-[#FF3676]/45 text-[#FF3676]' : t === '退票' || t === '改签' ? 'border-[#3B82F6]/40 text-[#3B82F6]' : 'border-black/12 text-black/40'}`}
                >
                  {t}
                </span>
              ))}
            </div>
            <button type="button" onClick={() => setView('seats')} className="mt-2.5 flex w-full items-center gap-2 text-left active:opacity-75">
              <span className="text-[13.5px] text-black/60">近期场次：</span>
              <span className="text-[14px] font-medium text-[#3B82F6]">{first.session}</span>
              <ChevronRight className="h-4 w-4 text-[#3B82F6]" />
            </button>
          </div>
          {/* 已放映完 */}
          <div className="px-2 pb-1 pt-4 text-[15px] text-black/40">今天已放映完</div>
          {rest.map((c) => (
            <button key={c.name} type="button" onClick={() => onToast('今天已放映完，看看明天的场次吧')} className="mt-2 block w-full rounded-2xl bg-white p-3.5 text-left active:opacity-80">
              <div className="flex items-center">
                <span className="min-w-0 flex-1 truncate text-[17px] font-black text-black/90">{c.name}</span>
                <span className="ml-2 shrink-0 text-[13.5px] text-black/40">暂无场次</span>
              </div>
              <div className="mt-1 flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[13px] text-black/45">{c.addr}</span>
                <span className="shrink-0 text-[13px] text-black/45">{c.dist}</span>
              </div>
              {c.tags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.tags.map((t) => (
                    <span
                      key={t}
                      className={`rounded-[4px] border px-1.5 py-px text-[11px] ${t === '影城卡' || t.startsWith('券包') ? 'border-[#FF3676]/45 text-[#FF3676]' : t === '退票' || t === '改签' ? 'border-[#3B82F6]/40 text-[#3B82F6]' : 'border-black/12 text-black/40'}`}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 text-[13.5px] text-black/40">今天已放映完</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---------- 淘票票首页 ----------
  const ticketIcons = [
    { icon: <Clapperboard className="h-[22px] w-[22px] text-[#FF3676]" strokeWidth={1.9} />, label: '电影', on: () => onToast('电影频道（演示）') },
    {
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 10c2.5-3.5 7-5 9-5s6.5 1.5 9 5c-1 4-4.5 8-9 8s-8-4-9-8Z" fill="#FF5A78" />
          <path d="M8 9.5c.8-1.2 2-2 3.5-2M13 14.5c1 .3 2.2.2 3.2-.4" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      ),
      label: '喜剧脱口秀',
      on: () => onToast('喜剧脱口秀（演示）'),
    },
    { icon: <Ticket className="h-[22px] w-[22px] text-[#FF3676]" strokeWidth={1.9} />, label: '领券中心', on: onOpenCouponCenter, badge: '国庆领' },
    { icon: <Mic className="h-[22px] w-[22px] text-[#FF3676]" strokeWidth={1.9} />, label: '演唱会', on: () => onToast('演唱会（演示）') },
    { icon: <ShoppingBag className="h-[22px] w-[22px] text-[#FF3676]" strokeWidth={1.9} />, label: '周边商城', on: () => onToast('周边商城（演示）') },
  ];
  return (
    <div className="flex h-full flex-col bg-[#F4F5F7]">
      {/* 顶栏（粉底） */}
      <div className="relative z-30 shrink-0 bg-gradient-to-b from-[#FF5C8A] to-[#FF3676] px-3 pb-3 pt-[56px]">
        <div className="flex items-center gap-2">
          <HeadBtn onClick={onBack} label="返回">
            <ArrowLeft className="h-[20px] w-[20px] text-white" strokeWidth={2.4} />
          </HeadBtn>
          <span className="text-[21px] font-bold leading-none text-white">淘票票</span>
          <span className="ml-2 flex items-center gap-0.5 text-[15px] font-medium text-white/95">
            <MapPin className="h-[15px] w-[15px] fill-white/90 text-white" />
            濮阳
          </span>
          <div className="ml-auto flex items-center gap-2">
            <HeadBtn onClick={() => onToast('更多（演示）')} label="更多">
              <MoreHorizontal className="h-[19px] w-[19px] text-white" strokeWidth={2.2} />
            </HeadBtn>
            <HeadBtn onClick={() => onToast('拍摄（演示）')} label="拍摄">
              <span className="grid h-[15px] w-[15px] place-items-center rounded-full border-2 border-white" />
            </HeadBtn>
          </div>
        </div>
        {/* 光影故事横幅 */}
        <button type="button" onClick={() => onToast('惠民观影活动（演示）')} className="relative mt-2 block h-[140px] w-full overflow-hidden rounded-2xl bg-gradient-to-r from-[#8EC9F0] via-[#F6CBD8] to-[#FFE29A] text-left active:opacity-90">
          <span className="absolute left-0 right-0 top-6 text-center text-[30px] font-black italic leading-[38px] tracking-wide text-[#2B3A67] drop-shadow-[0_1px_0_rgba(255,255,255,0.6)]">
            光影故事 美好生活
          </span>
          <span className="absolute left-1/2 top-[86px] -translate-x-1/2 rotate-[-3deg] rounded-full bg-[#5C6BC0]/90 px-3.5 py-1 text-[12px] font-medium text-white">2026年河南省惠民观影活动</span>
          <span className="absolute bottom-2 right-3 grid h-[38px] w-[38px] place-items-center rounded-full bg-[#FF8A00] shadow-md">
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <circle cx="11" cy="12" r="7" fill="#FFD100" />
              <circle cx="8.5" cy="11" r="1.3" fill="#5b3a00" />
              <circle cx="13.5" cy="11" r="1.3" fill="#5b3a00" />
              <path d="M8 14.5c1.6 1.4 4.4 1.4 6 0" stroke="#5b3a00" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              <path d="M4 8C3 5.5 3.6 4 5 3.6c1.2-.3 2.4.7 3 2A8 8 0 0 0 4 8Zm14 0c1-2.5.4-4-1-4.4-1.2-.3-2.4.7-3 2A8 8 0 0 1 18 8Z" fill="#FF8A00" />
            </svg>
          </span>
          <span className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
            <span className="h-[4px] w-[10px] rounded-full bg-white" />
            <span className="h-[4px] w-[4px] rounded-full bg-white/50" />
          </span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {/* 五宫格图标 */}
        <div className="mx-2 mt-2 rounded-2xl bg-white py-3.5">
          <div className="grid grid-cols-5">
            {ticketIcons.map((it) => (
              <button key={it.label} type="button" onClick={it.on} className="relative flex flex-col items-center gap-1.5 active:opacity-70">
                <span className="relative grid h-[46px] w-[46px] place-items-center rounded-full bg-[#FFE9F1]">
                  {it.icon}
                  {it.badge ? <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-[#FF5A3C] to-[#FF2D00] px-1.5 py-px text-[9px] font-bold text-white">{it.badge}</span> : null}
                </span>
                <span className="text-[12px] text-black/80">{it.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-2.5 flex justify-center gap-1">
            <span className="h-[3.5px] w-[12px] rounded-full bg-[#FF3676]" />
            <span className="h-[3.5px] w-[5px] rounded-full bg-black/15" />
          </div>
        </div>
        {/* 新人限时福利 */}
        <div className="mx-2 mt-2 rounded-2xl bg-white p-3">
          <div className="text-[17px] font-black text-[#FF3676]">新人限时福利</div>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <button type="button" onClick={onOpenCouponCenter} className="flex items-center justify-between rounded-xl bg-gradient-to-br from-[#FFE1EC] to-[#FFD0E0] p-3 text-left active:opacity-85">
              <span>
                <span className="block text-[15px] font-bold text-black/90">观影权益</span>
                <span className="mt-0.5 block text-[12px] text-black/45">月月领</span>
                <span className="mt-2 inline-block rounded-full bg-gradient-to-r from-[#FF5C8A] to-[#FF2D6B] px-3 py-1 text-[12.5px] font-semibold text-white">去领券</span>
              </span>
              <Ticket className="h-9 w-9 rotate-[-12deg] text-white/80" strokeWidth={1.6} />
            </button>
            <button type="button" onClick={() => onToast('抽免单卡（演示）')} className="flex items-center justify-between rounded-xl bg-[#FFF3DC] p-3 text-left active:opacity-85">
              <span>
                <span className="block text-[15px] font-bold text-black/90">抽免单卡</span>
                <span className="mt-0.5 block text-[12px] text-black/45">0.01元喝</span>
                <span className="mt-2 inline-block rounded-full bg-gradient-to-r from-[#FFB03A] to-[#FF8A00] px-3 py-1 text-[12.5px] font-semibold text-white">去看看</span>
              </span>
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#FFD100]/70 text-[12px] font-black text-[#8a6300]">免18元</span>
            </button>
          </div>
        </div>
        {/* 热映影片 */}
        <div className="mx-2 mt-2 rounded-2xl bg-white p-3">
          <div className="flex items-baseline">
            <span className="text-[19px] font-black text-black/90">热映影片</span>
            <span className="ml-3 text-[15px] text-black/35">新热预告</span>
            <button type="button" onClick={() => onToast('全部热映（演示）')} className="ml-auto flex items-center text-[13px] text-black/45 active:opacity-70">
              全部
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2.5 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TB_MOVIES.map((m) => (
              <div key={m.id} className="w-[106px] shrink-0">
                <MoviePoster m={m} onOpen={() => { setMovie(m); setDay(0); setSel(new Set()); setView('cinemas'); }} />
                <div className="mt-1.5 truncate text-[13.5px] text-black/85">{m.title}</div>
                <button
                  type="button"
                  onClick={() => {
                    setMovie(m);
                    setDay(0);
                    setSel(new Set());
                    setView('cinemas');
                  }}
                  className="mt-1.5 block w-full rounded-full bg-gradient-to-r from-[#FF5C8A] to-[#FF2D6B] py-1.5 text-center text-[13.5px] font-bold text-white active:opacity-85"
                >
                  购票
                </button>
                <div className="mt-1 text-center text-[10.5px] text-[#FF3676]">特惠</div>
              </div>
            ))}
          </div>
        </div>
        {/* 即将上映 */}
        <div className="mx-2 mt-2 rounded-2xl bg-white p-3">
          <div className="flex items-baseline">
            <span className="text-[19px] font-black text-black/90">即将上映</span>
            <span className="ml-3 text-[15px] text-black/35">新片想看榜</span>
            <button type="button" onClick={() => onToast('全部新片（演示）')} className="ml-auto flex items-center text-[13px] text-black/45 active:opacity-70">
              全部
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2.5 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TB_MOVIES_SOON.map((m) => (
              <div key={m.id} className="w-[106px] shrink-0">
                <MoviePoster m={m} onOpen={() => onToast(`已预约《${m.title}》上映提醒`)} />
                <div className="mt-1.5 truncate text-[13.5px] text-black/85">{m.title}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================== 飞猪旅行 ==============================

/** 飞猪旅行（截图8/9：黄——酒店搜索首页→酒店列表；内部二级导航） */
export function FliggyPage({ onBack, onToast }: { onBack: () => void; onToast: (m: string) => void }) {
  const [view, setView] = useState<'home' | 'list'>('home');
  const [tab, setTab] = useState('国内');
  const goSearch = () => {
    setView('list');
    setTab('猜你喜欢');
  };
  const icons = [
    { icon: <BedDouble className="h-[22px] w-[22px] text-white" strokeWidth={1.9} />, bg: 'from-[#9F7BFF] to-[#7C5CFF]', label: '酒店', badge: '立减50起' },
    { icon: <Plane className="h-[20px] w-[20px] text-white" strokeWidth={1.9} />, bg: 'from-[#5AA9FF] to-[#2E7BE8]', label: '机票', badge: '' },
    { icon: <TrainFront className="h-[21px] w-[21px] text-white" strokeWidth={1.9} />, bg: 'from-[#3BC46A] to-[#1E9E4E]', label: '火车/汽车', badge: '' },
    { icon: <Ticket className="h-[20px] w-[20px] text-white" strokeWidth={1.9} />, bg: 'from-[#FF6A5A] to-[#F03E3E]', label: '门票/跟团', badge: '' },
    { icon: <CarTaxiFront className="h-[21px] w-[21px] text-white" strokeWidth={1.9} />, bg: 'from-[#FFA23A] to-[#FF7A00]', label: '租车/打车', badge: '' },
    { icon: <Stamp className="h-[20px] w-[20px] text-white" strokeWidth={1.9} />, bg: 'from-[#FFC93A] to-[#E8A000]', label: '签证/通讯', badge: '' },
  ];
  if (view === 'list') {
    return (
      <div className="flex h-full flex-col bg-[#F4F5F9]">
        {/* 顶部频道 tab（酒店紫色胶囊选中）+ 返回 */}
        <div className="shrink-0 bg-white px-2 pb-2.5 pt-[56px]">
          <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button type="button" aria-label="返回" onClick={() => setView('home')} className="grid h-8 w-8 shrink-0 place-items-center rounded-full active:opacity-60">
              <ArrowLeft className="h-[20px] w-[20px] text-black/80" strokeWidth={2.2} />
            </button>
            {icons.map((it) => (
              <button
                key={it.label}
                type="button"
                onClick={() => onToast(`${it.label}频道（演示）`)}
                className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[14px] ${it.label === '酒店' ? 'bg-[#7C5CFF] font-semibold text-white' : 'text-black/70'}`}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-8">
          {/* 三卡横排：机票超低价 / 特惠酒店 / 爆款榜单 */}
          <div className="grid grid-cols-[1fr_1.1fr_0.95fr] gap-2">
            <button type="button" onClick={() => onToast('机票超低价（演示）')} className="rounded-xl bg-white p-2.5 text-left active:opacity-80">
              <div className="flex items-center gap-1">
                <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[#2E7BE8]">
                  <Plane className="h-[11px] w-[11px] text-white" />
                </span>
                <span className="truncate text-[14px] font-black text-black/90">机票超低价</span>
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {TB_FLIGGY.flights.map((f) => (
                  <div key={f.to}>
                    <div className="text-[13.5px] font-bold text-black/85">
                      {f.from} - {f.to}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[15px] font-black text-[#FF3B30]">
                        <span className="text-[10px]">¥</span>
                        {f.price}
                        <span className="text-[10px] font-medium">起</span>
                      </span>
                      <span className="rounded-[3px] bg-[#FFF3C2] px-1 py-px text-[10px] font-bold text-[#B8860B]">{f.off}</span>
                    </div>
                  </div>
                ))}
              </div>
            </button>
            <button type="button" onClick={() => onToast('特惠酒店（演示）')} className="rounded-xl bg-white p-2.5 text-left active:opacity-80">
              <div className="flex items-center gap-1">
                <span className="grid h-[18px] w-[18px] place-items-center rounded-[5px] bg-[#7C5CFF]">
                  <BedDouble className="h-[11px] w-[11px] text-white" />
                </span>
                <span className="truncate text-[14px] font-black text-black/90">特惠酒店</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-black/25" />
              </div>
              <img src={tbImg('lamp', 320, 220, 2)} alt="海友酒店" className="mt-2 h-[92px] w-full rounded-lg object-cover" draggable={false} />
              <div className="mt-1.5 line-clamp-2 text-[12.5px] font-medium leading-[16px] text-black/80">{TB_FLIGGY.hotels[2].name}</div>
              <div className="mt-1 text-[15px] font-black text-[#FF3B30]">
                <span className="text-[10px]">¥</span>
                {TB_FLIGGY.hotels[2].price}
                <span className="text-[10px] font-medium">起</span>
              </div>
            </button>
            <button type="button" onClick={() => onToast('爆款榜单（演示）')} className="rounded-xl bg-white p-2.5 text-left active:opacity-80">
              <div className="flex items-center gap-1">
                <Flame className="h-[15px] w-[15px] fill-[#FF3B30] text-[#FF3B30]" />
                <span className="truncate text-[14px] font-black text-black/90">爆款榜单</span>
              </div>
              <div className="relative mt-2">
                <img src={tbImg('temple', 320, 220, 1)} alt={TB_FLIGGY.deal.name} className="h-[92px] w-full rounded-lg object-cover" draggable={false} />
                <span className="absolute left-1 top-1 rounded-md bg-[#FFD100] px-1 py-px text-[9.5px] font-black text-black/80">TOP 1</span>
              </div>
              <div className="mt-1.5 truncate text-[12.5px] font-bold text-black/85">{TB_FLIGGY.deal.name}</div>
              <div className="mt-0.5 truncate text-[11px] text-black/45">{TB_FLIGGY.deal.sub}</div>
              <div className="mt-1 text-[15px] font-black text-[#FF3B30]">
                <span className="text-[10px]">¥</span>
                {TB_FLIGGY.deal.price}
                <span className="text-[10px] font-medium">起</span>
              </div>
            </button>
          </div>
          {/* 猜你喜欢 tab */}
          <div className="mt-3 flex items-center gap-2">
            {['猜你喜欢', '濮阳周边', '机票次卡'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-full px-4 py-1.5 text-[14px] ${tab === t ? 'bg-gradient-to-r from-[#FFE63E] to-[#FFD100] font-bold text-black/90' : 'bg-white text-black/65'}`}
              >
                {t}
              </button>
            ))}
          </div>
          {/* 酒店瀑布 */}
          <div className="mt-2.5 grid grid-cols-2 gap-2 pb-2">
            <button type="button" onClick={() => onToast('飞猪闪购酒店（演示）')} className="relative flex h-[196px] flex-col rounded-xl bg-gradient-to-b from-[#D97A2B] to-[#8C3D12] p-3 text-left active:opacity-90">
              <span className="flex items-center gap-1">
                <span className="grid h-[16px] w-[16px] place-items-center rounded-full bg-[#FFD100] text-[9px] font-black text-[#8a6300]">飞</span>
                <span className="text-[11px] font-medium text-white/90">飞猪旅行</span>
              </span>
              <span className="mt-2 text-[20px] font-black italic leading-none text-white">飞猪闪购酒店</span>
              <span className="mt-1.5 text-[11px] text-white/85">金秋出游 折上再享8元起立减 &gt;</span>
              <span className="mt-auto grid h-[52px] w-[52px] place-items-center self-end rounded-full bg-[#FFD100] shadow-md">
                <svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true">
                  <circle cx="24" cy="26" r="15" fill="#FFC300" />
                  <circle cx="19" cy="23" r="2.2" fill="#3b2b00" />
                  <circle cx="29" cy="23" r="2.2" fill="#3b2b00" />
                  <ellipse cx="24" cy="30" rx="5.4" ry="4.2" fill="#FFB800" />
                  <path d="M12 18c-1.6-3.4-.8-5.6.8-6.4 1.8-.8 4 .8 5.2 3A14 14 0 0 0 12 18Zm24 0c1.6-3.4.8-5.6-.8-6.4-1.8-.8-4 .8-5.2 3A14 14 0 0 1 36 18Z" fill="#FFC300" />
                </svg>
              </span>
            </button>
            {TB_FLIGGY.hotels.slice(0, 2).map((h, i) => (
              <button key={h.name} type="button" onClick={() => onToast(`${h.name}（演示）`)} className="overflow-hidden rounded-xl bg-white text-left active:opacity-80">
                <img src={tbImg(h.tag, 320, 300, i)} alt={h.name} className="h-[150px] w-full object-cover" draggable={false} />
                <div className="p-2">
                  <div className="line-clamp-2 text-[13.5px] font-bold leading-[18px] text-black/90">{h.name}</div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-[17px] font-black text-[#FF3B30]">
                      <span className="text-[10px]">¥</span>
                      {h.price}
                      <span className="text-[10px] font-medium">起</span>
                    </span>
                    <span className="text-[10.5px] text-black/40">{h.reviews}</span>
                  </div>
                </div>
              </button>
            ))}
            <button type="button" onClick={() => onToast('海友濮阳体育场京开大道酒店（演示）')} className="overflow-hidden rounded-xl bg-white text-left active:opacity-80">
              <img src={tbImg('bedding', 320, 300, 5)} alt="海友酒店" className="h-[150px] w-full object-cover" draggable={false} />
              <div className="p-2">
                <div className="line-clamp-2 text-[13.5px] font-bold leading-[18px] text-black/90">{TB_FLIGGY.hotels[2].name}</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-[17px] font-black text-[#FF3B30]">
                    <span className="text-[10px]">¥</span>
                    {TB_FLIGGY.hotels[2].price}
                    <span className="text-[10px] font-medium">起</span>
                  </span>
                  <span className="text-[10.5px] text-black/40">{TB_FLIGGY.hotels[2].reviews}</span>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[#FFDD30] via-[#FFEC6E] to-[#F4F5F9]">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center gap-2 px-3 pt-[56px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/60 active:opacity-70">
          <ArrowLeft className="h-[20px] w-[20px] text-black/85" strokeWidth={2.4} />
        </button>
        <span className="text-[22px] font-black italic leading-none tracking-tight text-black/90">飞猪旅行</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" aria-label="更多" onClick={() => onToast('更多（演示）')} className="grid h-9 w-11 place-items-center rounded-full bg-white/60 active:opacity-70">
            <MoreHorizontal className="h-[19px] w-[19px] text-black/80" />
          </button>
          <button type="button" aria-label="拍摄" onClick={() => onToast('拍摄（演示）')} className="grid h-9 w-9 place-items-center rounded-full bg-white/60 active:opacity-70">
            <span className="grid h-[16px] w-[16px] place-items-center rounded-full border-2 border-black/75">
              <span className="h-[6px] w-[6px] rounded-full bg-black/75" />
            </span>
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 搜索框 */}
        <div className="mt-2.5 px-3">
          <div className="flex h-[46px] items-center gap-2 rounded-full bg-white pl-4 pr-1.5">
            <Search className="h-[18px] w-[18px] shrink-0 text-black/35" />
            <span className="min-w-0 flex-1 truncate text-[14.5px] text-black/35">濮阳东北庄野生动物园</span>
            <button type="button" onClick={goSearch} className="h-[36px] shrink-0 rounded-full bg-gradient-to-r from-[#7C5CFF] to-[#5B3DE8] px-5 text-[14.5px] font-semibold text-white active:opacity-85">
              搜索
            </button>
          </div>
        </div>
        {/* 快捷 chips */}
        <div className="mt-2.5 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TB_FLIGGY.chips.map((c) => (
            <button key={c} type="button" onClick={() => onToast(`${c}（演示）`)} className="shrink-0 whitespace-nowrap rounded-full bg-white/55 px-3.5 py-1.5 text-[13.5px] text-black/75 active:opacity-75">
              {c}
            </button>
          ))}
        </div>
        {/* 六宫格图标 */}
        <div className="mt-3 grid grid-cols-6 px-2">
          {icons.map((it) => (
            <button key={it.label} type="button" onClick={() => onToast(`${it.label}（演示）`)} className="relative flex flex-col items-center gap-1 active:opacity-75">
              <span className={`relative grid h-[46px] w-[46px] place-items-center rounded-full bg-gradient-to-b ${it.bg}`}>
                {it.icon}
                {it.badge ? <span className="absolute -left-2 -top-2 whitespace-nowrap rounded-full bg-[#FF3B30] px-1.5 py-px text-[9px] font-bold text-white">{it.badge}</span> : null}
              </span>
              <span className="whitespace-nowrap text-[11.5px] text-black/80">{it.label}</span>
            </button>
          ))}
        </div>
        {/* 酒店搜索卡 */}
        <div className="mx-2 mt-3 rounded-2xl bg-white p-3.5">
          <div className="flex items-center gap-6">
            {['国内', '国际', '酒店套餐', '民宿', '短租房'].map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`relative pb-1.5 text-[17px] ${tab === t ? 'font-bold text-black/90' : 'text-black/50'}`}>
                {t}
                {tab === t ? <span className="absolute bottom-0 left-1/2 h-[3px] w-[22px] -translate-x-1/2 rounded-full bg-black/85" /> : null}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[19px] font-black text-black/90">我的附近</span>
            <ChevronDown className="h-4 w-4 text-black/60" />
            <span className="ml-1 flex min-w-0 flex-1 items-center gap-1.5">
              <Search className="h-[17px] w-[17px] shrink-0 text-black/30" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-black/30">位置/品牌/酒店</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-black/25" />
            </span>
            <Crosshair className="h-[19px] w-[19px] shrink-0 text-[#7C5CFF]" strokeWidth={2} />
          </div>
          <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-[#EEEBFF] px-3 py-2">
            <MapPin className="h-4 w-4 shrink-0 fill-[#7C5CFF] text-[#7C5CFF]" />
            <span className="text-[13.5px] font-medium text-[#6A4DE8]">已定位到</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-black/70">濮阳县,老街村附近</span>
          </div>
          <div className="flex items-center justify-between border-b border-black/[0.06] py-4">
            <span className="flex items-baseline gap-1.5">
              <span className="text-[26px] font-black leading-none text-black/90">10月9日</span>
              <span className="text-[13px] text-black/40">今天</span>
            </span>
            <span className="flex items-center gap-1 rounded-full border border-black/15 px-2.5 py-0.5 text-[12.5px] text-black/75">
              1晚
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-[26px] font-black leading-none text-black/90">10月10日</span>
              <span className="text-[13px] text-black/40">明天</span>
            </span>
            <ChevronRight className="h-4.5 w-4.5 text-black/30" />
          </div>
          <div className="flex items-center border-b border-black/[0.06] py-3.5">
            <span className="text-[15.5px] font-bold text-black/90">1间房 2成人 0儿童</span>
            <ChevronDown className="ml-1 h-4 w-4 text-black/50" />
            <span className="ml-7 text-[15px] text-black/30">价格/星级</span>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {['首住特惠', '张挥公园', '濮阳县人民医院', '东环小区', '咸城遗址'].map((c, i) => (
              <button
                key={c}
                type="button"
                onClick={() => onToast(`${c}附近酒店（演示）`)}
                className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-[12.5px] ${i === 0 ? 'border border-[#FF3B30]/40 text-[#FF3B30]' : 'bg-black/[0.045] text-black/65'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="relative mt-5">
            <span className="absolute -top-3 right-2 rotate-[2deg] rounded-full bg-gradient-to-r from-[#FF5A3C] to-[#FF2D00] px-2.5 py-1 text-[11.5px] font-bold text-white shadow">旅游卡立省50元起</span>
            <button type="button" onClick={goSearch} className="h-[54px] w-full rounded-full bg-gradient-to-r from-[#FFE63E] to-[#FFC91E] text-[19px] font-black text-black/90 shadow-[0_6px_16px_rgba(255,180,0,0.35)] active:opacity-90">
              搜索酒店
            </button>
          </div>
          <div className="flex items-center justify-center gap-1 py-3.5 text-[12.5px] text-black/45">
            7x24小时服务 · 品牌直营 双重积分 · 信用住 先住后付
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================== 淘宝账单（我的消费明细） ==============================

/** 淘宝账单（截图10：真实订单数据——省钱统计/10月账单/2026年累计账单/分类） */
export function BillPage({ session, uid, onBack, onToast, onOpenOrder }: { session: TbSession; uid: string; onBack: () => void; onToast: (m: string) => void; onOpenOrder: (id: string) => void }) {
  const orders = tbLoadOrders(uid);
  const paid = orders.filter((o) => o.status !== 'cancelled' && o.paidAt);
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const inMonth = (t: number) => {
    const d = new Date(t);
    return d.getFullYear() === y && d.getMonth() === m;
  };
  const monthPaid = paid.filter((o) => inMonth(o.createdAt));
  const monthSum = Math.round(monthPaid.reduce((n, o) => n + o.total, 0) * 100) / 100;
  const yearPaid = paid.filter((o) => new Date(o.createdAt).getFullYear() === y);
  const yearSum = Math.round(yearPaid.reduce((n, o) => n + o.total, 0) * 100) / 100;
  const couponSave = Math.round(paid.reduce((n, o) => n + (o.couponAmount ?? 0), 0) * 100) / 100;
  const totalSave = Math.round(paid.reduce((n, o) => n + o.discount, 0) * 100) / 100;
  const otherSave = Math.max(0, Math.round((totalSave - couponSave) * 100) / 100);
  return (
    <div className="relative flex h-full flex-col bg-[#F2F3F7]">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-[56px]">
        <button type="button" aria-label="返回" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:opacity-60">
          <ArrowLeft className="h-[22px] w-[22px] text-black/85" strokeWidth={2.2} />
        </button>
        <span className="text-[19px] font-black text-black/90">淘宝账单</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" aria-label="账户" onClick={() => onToast('切换账单账号（演示）')} className="grid h-9 w-10 place-items-center rounded-lg bg-black/[0.06] active:opacity-70">
            <User className="h-[18px] w-[18px] text-black/65" />
          </button>
          <button type="button" aria-label="更多" onClick={() => onToast('更多（演示）')} className="grid h-9 w-[62px] place-items-center rounded-lg bg-black/[0.06]">
            <MoreHorizontal className="h-[18px] w-[18px] text-black/65" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-10">
        {/* 头像与省钱 */}
        <div className="flex items-center gap-3 px-4 pt-2">
          <span className="grid h-[58px] w-[58px] shrink-0 place-items-center overflow-hidden rounded-full bg-[#D8DCE3]">
            {session.avatar ? <img src={session.avatar} alt={session.name} className="h-full w-full object-cover" draggable={false} /> : <User className="h-7 w-7 text-white" />}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[19px] font-bold text-black/90">{session.name}</div>
            <div className="mt-0.5 flex items-center gap-1">
              <span className="text-[16.5px] font-bold text-black/90">淘宝已为你省钱</span>
              <span className="text-[25px] font-black leading-none text-[#FF5000]">
                {fmtMoney(totalSave)}
                <span className="text-[14px]">元</span>
              </span>
              <Info className="h-3.5 w-3.5 shrink-0 text-black/30" />
            </div>
          </div>
        </div>
        {/* 三项省钱统计 */}
        <div className="mt-3 grid grid-cols-3 px-4">
          {[
            { label: '淘金币', value: 0, info: false },
            { label: '红包/券', value: couponSave, info: false },
            { label: '其他优惠', value: otherSave, info: true },
          ].map((s) => (
            <button key={s.label} type="button" onClick={() => onToast(`${s.label}：共省${fmtMoney(s.value)}元`)} className="flex flex-col items-start py-0.5 text-left active:opacity-70">
              <span className="flex items-center gap-0.5 text-[13.5px] text-black/55">
                {s.label}
                {s.info ? <Info className="h-3 w-3 text-black/25" /> : <ChevronRight className="h-3.5 w-3.5 text-black/30" />}
              </span>
              <span className="mt-0.5 text-[16px] font-black leading-none text-black/90">
                省{fmtMoney(s.value)}<span className="text-[12px] font-bold">元</span>
              </span>
            </button>
          ))}
        </div>
        {/* 10月账单 */}
        <div className="mx-2 mt-3 rounded-2xl bg-white p-4">
          <div className="flex items-center">
            <button type="button" onClick={() => onToast('切换账单月份（演示）')} className="flex items-center gap-1 active:opacity-70">
              <span className="text-[20px] font-black text-black/90">{m + 1}月账单</span>
              <ChevronDown className="h-4.5 w-4.5 text-black/50" />
            </button>
            <button type="button" onClick={() => onToast('已订阅月度账单，每月1日推送')} className="ml-auto flex items-center gap-1 rounded-lg border-[1.5px] border-[#FF5000] px-2.5 py-1.5 text-[13px] font-semibold text-[#FF5000] active:opacity-75">
              <Bell className="h-3.5 w-3.5" />
              订阅账单
            </button>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-[30px] font-black leading-none text-black/90">
              {fmtMoney(monthSum)}
              <span className="text-[15px]">元</span>
            </span>
            <span className="text-[13.5px] text-black/45">共{monthPaid.length}单</span>
            <Info className="h-3.5 w-3.5 shrink-0 text-black/25" />
          </div>
          {/* 省钱机会 */}
          <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-[#FFF3E8] p-3">
            <Flame className="h-[18px] w-[18px] shrink-0 fill-[#FF6A1E] text-[#FF6A1E]" />
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-bold text-black/90">你的省钱机会</div>
              <div className="mt-0.5 text-[12.5px] leading-[17px] text-black/60">
                你有10淘金币奖励未领取，累计可抵
                <span className="mx-0.5 text-[17px] font-black text-[#FF5000]">0.1</span>元，快去攒金币吧~
              </div>
            </div>
            <button type="button" onClick={() => onToast('快去首页「红包签到」领淘金币吧~')} className="h-[38px] shrink-0 rounded-lg bg-[#FF5000] px-3.5 text-[13.5px] font-semibold text-white active:opacity-85">
              去攒金币
            </button>
          </div>
          {/* 本月消费列表 / 空态 */}
          {monthPaid.length === 0 ? (
            <div className="flex flex-col items-center py-9">
              <span className="relative">
                <ShoppingCart className="h-[62px] w-[62px] text-[#E3E6EC]" strokeWidth={1.4} />
                <span className="absolute -right-2 top-0 grid h-6 w-6 place-items-center rounded-full bg-[#FF8A5C] text-[11px] font-bold text-white">空</span>
              </span>
              <span className="mt-3 text-[14px] text-black/35">本月暂无消费哦~</span>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {monthPaid.slice(0, 3).map((o) => (
                <button key={o.id} type="button" onClick={() => onOpenOrder(o.id)} className="flex items-center gap-2.5 rounded-xl bg-black/[0.025] p-2 text-left active:opacity-75">
                  <img src={o.items[0]?.img} alt={o.items[0]?.title} className="h-11 w-11 shrink-0 rounded-lg object-cover" draggable={false} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-black/80">{o.items[0]?.title}</span>
                    <span className="mt-0.5 block text-[11.5px] text-black/40">
                      {new Date(o.createdAt).getMonth() + 1}月{new Date(o.createdAt).getDate()}日 · {o.shopName}
                    </span>
                  </span>
                  <span className="shrink-0 text-[14.5px] font-bold text-black/85">¥{fmtMoney(o.total)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* 年累计账单 */}
        <div className="mx-2 mt-3 rounded-2xl bg-white p-4">
          <div className="flex items-center">
            <button type="button" onClick={() => onToast('切换年份（演示）')} className="flex items-center gap-1 active:opacity-70">
              <span className="text-[20px] font-black text-black/90">{y}年累计账单</span>
              <ChevronDown className="h-4.5 w-4.5 text-black/50" />
            </button>
          </div>
          <div className="mt-2 flex items-end justify-between">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[26px] font-black leading-none text-black/90">
                {fmtMoney(yearSum)}
                <span className="text-[14px]">元</span>
              </span>
              <span className="text-[13px] text-black/45">共{yearPaid.length}单</span>
            </div>
            <button type="button" onClick={() => onToast('会员等级：人靠衣装LV.1（演示）')} className="flex items-center gap-1.5 active:opacity-75">
              <img src={tbImg('gift', 96, 96, 1)} alt="等级礼盒" className="h-9 w-9 rounded-lg object-cover" draggable={false} />
              <span className="text-left">
                <span className="block text-[11.5px] text-black/55">再买5单 升级</span>
                <span className="block text-[12.5px] font-bold text-black/85">[人靠衣装LV.1] &gt;</span>
              </span>
            </button>
          </div>
          {/* 分类 */}
          <div className="mt-4 grid grid-cols-3">
            {[
              { label: '购物', value: yearSum, count: yearPaid.length },
              { label: '闪购·外卖', value: 0, count: 0 },
              { label: '飞猪·旅行', value: 0, count: 0 },
            ].map((c) => (
              <button key={c.label} type="button" onClick={() => onToast(`${c.label}账单（演示）`)} className="flex flex-col items-start py-0.5 text-left active:opacity-70">
                <span className="flex items-center gap-0.5 text-[14px] text-black/70">
                  {c.label}
                  <ChevronRight className="h-3.5 w-3.5 text-black/30" />
                </span>
                <span className="mt-1 text-[16px] font-black leading-none text-black/90">
                  {fmtMoney(c.value)}
                  <span className="text-[12px] font-bold">元</span>
                </span>
                <span className="mt-0.5 text-[11.5px] text-black/40">{c.count}单</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {/* 悬浮编辑 */}
      <button type="button" aria-label="编辑" onClick={() => onToast('编辑账单备注（演示）')} className="absolute bottom-9 right-4 z-30 grid h-12 w-12 place-items-center rounded-full bg-white shadow-[0_4px_14px_rgba(0,0,0,0.12)] ring-1 ring-black/5 active:opacity-80">
        <Pencil className="h-5 w-5 text-black/70" strokeWidth={1.9} />
      </button>
    </div>
  );
}
