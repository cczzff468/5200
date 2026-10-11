'use client';

/**
 * 淘宝快递灵动岛（与 MeituanIsland 同一套交互规格，用户要求「和美团的灵动岛样式一样」）：
 * - 小窗（黑色胶囊）：有进行中的淘宝快递单（待发货/已发货，票务单不进灵动岛）时常驻显示——
 *   左侧当前运输快递员形象（我的淘宝-快递员所选，默认运输车）+ 状态文案（等待发货/已揽收/
 *   运输中/派送中/已到驿站），右侧剩余时间「N分钟」淘宝橙 + 「送达」；
 * - 大窗（展开卡）：商品首图 + 橙色「预计HH:MM送达」+ 状态副文案 + 淘宝 logo +
 *   发货→运输→送达 三节点进度条（快递员形象骑在进度上，随真实时间推进，与物流地图同源算法）；
 *   状态变化（付款/发货/揽收/运输/派送/到站）时自动展开一次，显示 5 秒收回小窗；
 * - 点小窗 → 展开大窗（一直显示，不自动收回）；
 * - 点大窗 → 进入淘宝订单详情（复用灵动岛导航总线：navigateToChatSession('taobao', orderId)）；
 * - 点大窗以外的地方 → 收回小窗（透明捕获层，iOS 灵动岛同语义）；
 * - 聊天消息灵动岛通知展示期间/来电响铃/熄屏/关闭状态栏时整层隐身，恢复后小窗回归；
 * - 剩余分钟按真实时钟每秒推算（tbDeliveryTiming：快 30-60min/正常 1-3h/慢 3-6h）。
 *
 * 锚位互斥（与美团灵动岛同锚）：两者都有进行中单时「最新事件的一方」展示（另一让位）；
 * 音乐灵动岛在任一配送岛可见时隐身（mt-island-store + tb-island-store 双写）。
 *
 * 层级 z-[82]：盖住音乐灵动岛（z-81），低于聊天通知卡（z-93）。大窗的「点击别处」捕获层 z-[81]。
 */

import { useEffect, useRef, useState } from 'react';
import { motion, type Transition } from 'framer-motion';
import { useSettings, useUI } from '@/lib/ios/store';
import { useIslandNotify, navigateToChatSession } from '@/lib/ios/island-notify';
import { useGlobalCall } from '@/lib/ios/global-call';
import { useIncomingCall } from '@/lib/ios/incoming-call';
import { useTbIsland } from '@/lib/ios/tb-island-store';
import { tbCurrentCourier, TB_COURIER_CHANGED } from '@/lib/ios/tb-courier';
import {
  TB_TRACK_NODES,
  tbDeliveryTiming,
  tbGetSession,
  tbLoadOrders,
  tbStartOrderWatcher,
  tbUidOf,
  type TbOrder,
} from '@/lib/ios/taobao-store';
import { mtGetSession, mtLoadOrders, mtUidOf } from '@/lib/ios/meituan-store';

/** 小窗胶囊几何（与美团灵动岛一致） */
const PILL = { width: 198, height: 33, borderRadius: 16.5 } as const;
/** 大窗展开姿态 */
const EXPANDED = { width: 348, height: 'auto', borderRadius: 26 } as const;
const SPRING: Transition = { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 };
/** 自动展开停留时长（大窗显示 5 秒） */
const AUTO_COLLAPSE_MS = 5000;
/** 胶囊/展开态的垂直锚位（与静态灵动岛同位） */
const PILL_TOP = 11;

/** 来电展示中（与 IslandNotificationLayer 同口径） */
function useIncomingCallPresenting(): boolean {
  const call = useIncomingCall((s) => s.call);
  const enginePhase = useGlobalCall((s) => s.enginePhase);
  if (call?.source === 'phone') return true;
  const source = (call?.source ?? '') as string;
  if (source === 'wx' || source === 'qq') return enginePhase === 'incoming';
  return false;
}

/** 进行中的淘宝快递单（待发货/已发货；票务单/已完成/取消不进灵动岛） */
function inProgressOf(o: TbOrder): boolean {
  if (o.ticket) return false;
  return o.status === 'pendingDeliver' || o.status === 'shipped';
}

/** 订单最新事件时刻（互斥仲裁：与美团灵动岛比谁的事件更新） */
function latestEventAt(o: TbOrder): number {
  return Math.max(
    o.paidAt ?? o.createdAt,
    o.shipAt ?? 0,
    o.track.length > 0 ? o.track[o.track.length - 1].at : 0,
  );
}

/** 美团进行中外卖单的最新事件时刻（0=无单）：淘宝灵动岛让位判定用 */
function mtActiveLatestAt(): number {
  try {
    const s = mtGetSession();
    if (!s) return 0;
    let latest = 0;
    for (const o of mtLoadOrders(mtUidOf(s))) {
      const kind = o.kind ?? 'waimai';
      if (kind !== 'waimai') continue;
      if (o.status !== 'pendingAccept' && o.status !== 'accepted' && o.status !== 'delivering') continue;
      const t = Math.max(o.paidAt ?? o.createdAt, o.statusLog.length > 0 ? o.statusLog[o.statusLog.length - 1].at : 0);
      if (t > latest) latest = t;
    }
    return latest;
  } catch {
    return 0;
  }
}

/** 发货阶段（track 节点序：0 揽收 / 1 运输 / 2 派送 / ≥3 到站） */
type TbIslandPhase = 'wait' | 'pickup' | 'transit' | 'delivering' | 'station';

function phaseOf(o: TbOrder): TbIslandPhase {
  if (o.status === 'pendingDeliver') return 'wait';
  const n = o.track.length - 1;
  if (n >= 3) return 'station';
  if (n === 2) return 'delivering';
  if (n === 1) return 'transit';
  return 'pickup';
}

/** 小窗状态文案 */
function pillLabelOf(o: TbOrder): string {
  switch (phaseOf(o)) {
    case 'wait':
      return '等待发货';
    case 'pickup':
      return '已揽收';
    case 'transit':
      return '运输中';
    case 'delivering':
      return '派送中';
    default:
      return '已到驿站';
  }
}

/** 大窗副文案 */
function subLabelOf(o: TbOrder): string {
  switch (phaseOf(o)) {
    case 'wait':
      return '已付款，商家正准备发货';
    case 'pickup':
      return '商家已发货，包裹揽收中';
    case 'transit':
      return '包裹运输中，正发往收货城市';
    case 'delivering':
      return '快递员正在派送，请留意来电';
    default:
      return '包裹已放入驿站，记得取件哦';
  }
}

/** 预计送达时刻（真实时钟）：待发货=付款+总时长；已发货=发货+4 节点（与 tbTickOrders 同源） */
function etaOf(o: TbOrder, uid: string): number {
  const t = tbDeliveryTiming(uid, o.id);
  if (o.status === 'pendingDeliver' || !o.shipAt) return (o.paidAt ?? o.createdAt) + t.totalMs;
  return o.shipAt + t.trackStepMs * TB_TRACK_NODES.length;
}

/** 三节点进度（0~1）：与物流地图 phaseFrac 同源——发货前小幅起步、揽收/运输/派送段按真实时间推进 */
function progressOf(o: TbOrder, now: number, uid: string): number {
  const t = tbDeliveryTiming(uid, o.id);
  if (o.status === 'pendingDeliver') {
    const start = o.paidAt ?? o.createdAt;
    const frac = t.shipDelayMs > 0 ? Math.min(1, Math.max(0, (now - start) / t.shipDelayMs)) : 0;
    return 0.06 + 0.12 * frac;
  }
  const n = o.track.length - 1;
  if (n >= 3) return 1;
  const phaseStartAt = n >= 1 ? o.track[n - 1].at : (o.shipAt ?? now);
  const frac = Math.min(1, Math.max(0, (now - phaseStartAt) / Math.max(60_000, t.trackStepMs)));
  if (n === 0) return 0.22 + 0.1 * frac;
  if (n === 1) return 0.38 + 0.22 * frac;
  return 0.65 + 0.25 * frac;
}

export default function TaobaoIsland() {
  const statusBarVisible = useSettings((s) => s.statusBarVisible);
  const screenOff = useUI((s) => s.screenOff);
  const chatNotifyShowing = useIslandNotify((s) => s.current !== null || s.exiting);
  const callPresenting = useIncomingCallPresenting();

  /** active = 当前进行中的快递单（每秒重读 kv；null = 无单隐身） */
  const [active, setActive] = useState<TbOrder | null>(null);
  /** active 所属 uid（tbDeliveryTiming 需要读速度档） */
  const [uid, setUid] = useState('');
  /** 小窗形态；expanded = 大窗 */
  const [expanded, setExpanded] = useState(false);
  /** 每秒刷新的时钟（剩余分钟/进度推进） */
  const [nowTs, setNowTs] = useState(() => Date.now());
  /** 当前运输快递员形象（我的淘宝-快递员所选） */
  const [courierSrc, setCourierSrc] = useState(() => tbCurrentCourier().src);

  const expandedRef = useRef(false);
  const autoExpandRef = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 已消费的状态签名（订单id|状态|节点数）：变化即自动展开大窗 5 秒 */
  const seenSigRef = useRef<string>('');

  const readActive = () => {
    try {
      const s = tbGetSession();
      if (!s) {
        setActive(null);
        setUid('');
        return;
      }
      const u = tbUidOf(s);
      const list = tbLoadOrders(u).filter(inProgressOf);
      // 多单进行中：取最新事件的一单
      list.sort((a, b) => latestEventAt(b) - latestEventAt(a));
      setActive(list[0] ?? null);
      setUid(u);
    } catch {
      /* kv 未就绪等异常：保持现状 */
    }
  };

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const clearAuto = () => {
    if (autoTimer.current) {
      clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
  };

  /** 自动展开大窗 5 秒（仅小窗形态时） */
  const autoExpand = () => {
    if (expandedRef.current) return;
    autoExpandRef.current = true;
    setExpanded(true);
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null;
      if (autoExpandRef.current) setExpanded(false);
    }, AUTO_COLLAPSE_MS);
  };

  /** 手动展开（点小窗）：一直显示 */
  const expandManually = () => {
    autoExpandRef.current = false;
    clearAuto();
    setExpanded(true);
  };

  const collapse = () => {
    autoExpandRef.current = false;
    clearAuto();
    setExpanded(false);
  };

  // 数据源：每秒轮询（kv 无订阅总线）+ 订单变化事件即时刷新 + 时钟推进 + 快递员换装跟随
  // （首帧读取包进微任务，规避 react-hooks/set-state-in-effect）
  useEffect(() => {
    let alive = true;
    // 确保全局订单推进 watcher 在跑（幂等）：灵动岛在任何界面都可见，
    // 未打开过淘宝 App 时订单状态机也要实时推进（含 tbEngageTick 联动）
    tbStartOrderWatcher();
    Promise.resolve().then(() => {
      if (!alive) return;
      readActive();
      setNowTs(Date.now());
      setCourierSrc(tbCurrentCourier().src);
    });
    const iv = window.setInterval(() => {
      readActive();
      setNowTs(Date.now());
    }, 1000);
    const onChanged = () => readActive();
    const onCourier = () => setCourierSrc(tbCurrentCourier().src);
    window.addEventListener('tb-orders-changed', onChanged);
    window.addEventListener(TB_COURIER_CHANGED, onCourier);
    return () => {
      alive = false;
      window.clearInterval(iv);
      window.removeEventListener('tb-orders-changed', onChanged);
      window.removeEventListener(TB_COURIER_CHANGED, onCourier);
    };
  }, []);

  useEffect(() => () => { clearAuto(); }, []);

  // 锚位互斥：美团灵动岛有进行中单且其最新事件不早于淘宝 → 淘宝让位（同为进行中时「最新事件方」展示）
  const mtLatest = mtActiveLatestAt();
  const tbLatest = active ? latestEventAt(active) : 0;
  const mtWins = mtLatest > 0 && (active === null || mtLatest >= tbLatest);

  const hidden =
    !statusBarVisible || screenOff || chatNotifyShowing || callPresenting || !active || mtWins;

  // 状态签名变化（新单/发货/揽收/派送/到站）→ 自动展开大窗 5 秒；
  // 通知层/来电占位期间隐身时不消费签名，恢复可见后补放
  useEffect(() => {
    if (hidden) return;
    const sig = active ? `${active.id}|${active.status}|${active.track.length}` : '';
    if (!sig) {
      seenSigRef.current = '';
      return;
    }
    if (sig === seenSigRef.current) return;
    seenSigRef.current = sig;
    // 微任务里展开（规则：effect 内不同步 setState）
    Promise.resolve().then(() => autoExpand());
  }, [active, hidden]);

  // 可见性写入共享 store（音乐灵动岛/状态栏消费）+ 隐身时收回展开态
  useEffect(() => {
    useTbIsland.getState().setVisible(!hidden);
    if (hidden && expandedRef.current) {
      Promise.resolve().then(() => collapse());
    }
  }, [hidden]);

  if (hidden || !active) return null;

  // 剩余送达时间（真实时钟推算，秒级刷新）；已到驿站 → 待取件
  const atStation = phaseOf(active) === 'station';
  const etaAt = etaOf(active, uid);
  const leftMs = Math.max(0, etaAt - nowTs);
  const leftMin = Math.max(1, Math.ceil(leftMs / 60_000));
  const leftText = atStation ? '待取件' : leftMs < 60_000 ? '即将送达' : `${leftMin}分钟`;
  const etaText = atStation ? '' : fmtHM(etaAt);

  const p = progressOf(active, nowTs, uid);
  const phase = phaseOf(active);
  const stageDone = (k: 0 | 1 | 2) => {
    if (k === 0) return active.status === 'shipped';
    if (k === 1) return active.track.length >= 2;
    return active.track.length >= 4;
  };
  const firstImg = active.items[0]?.img ?? '';
  const firstTitle = active.items[0]?.title ?? active.shopName;

  return (
    <>
      {/* 大窗展开期间：点击别处收回小窗（透明捕获层，iOS 灵动岛同语义） */}
      {expanded && (
        <div className="absolute inset-0 z-[81]" onClick={collapse} aria-label="收起淘宝快递弹窗" data-testid="tb-island-catcher" />
      )}
      <div className="pointer-events-none absolute inset-x-0 z-[82] flex flex-col items-center" style={{ top: PILL_TOP }}>
        <motion.div
          data-testid="tb-island"
          role="button"
          aria-label={expanded ? '淘宝快递弹窗：打开订单详情' : '淘宝快递弹窗：展开快递进度'}
          initial={false}
          animate={{
            width: expanded ? EXPANDED.width : PILL.width,
            height: expanded ? EXPANDED.height : PILL.height,
            borderRadius: expanded ? EXPANDED.borderRadius : PILL.borderRadius,
          }}
          transition={SPRING}
          onClick={() => {
            if (!expanded) {
              expandManually();
            } else {
              // 点大窗 → 进订单详情（锁屏/熄屏时 navigateToChatSession 内部守卫不跳转）
              collapse();
              navigateToChatSession('taobao', active.id);
            }
          }}
          className="pointer-events-auto relative cursor-pointer overflow-hidden bg-black text-white shadow-[0_10px_30px_-8px_rgba(0,0,0,0.5)] outline-none"
        >
          {/* ---------- 小窗内容（绝对定位不参与流式布局，展开时淡出） ---------- */}
          <motion.div
            initial={false}
            animate={{ opacity: expanded ? 0 : 1 }}
            transition={{ duration: 0.14 }}
            className="absolute inset-x-0 top-0 flex items-center gap-1.5 pl-[3px] pr-3"
            style={{ height: PILL.height }}
          >
            <img
              src={courierSrc}
              alt=""
              draggable={false}
              className="h-[27px] w-[27px] shrink-0 select-none object-contain"
              style={{ filter: 'drop-shadow(0 1.5px 2px rgba(0,0,0,0.35))' }}
            />
            <span className="min-w-0 shrink-0 text-[12px] font-medium leading-none text-white/90">{pillLabelOf(active)}</span>
            <span className="min-w-0 flex-1" />
            <span className="shrink-0 whitespace-nowrap text-[12px] leading-none">
              <span className="font-bold text-[#FF6A00]" data-testid="tb-island-left">
                {leftText}
              </span>
              {!atStation && leftMs >= 60_000 && <span className="ml-[3px] text-white/75">送达</span>}
            </span>
          </motion.div>

          {/* ---------- 大窗内容（宽度形变基本完成后错峰淡入） ---------- */}
          <motion.div
            initial={false}
            animate={{ opacity: expanded ? 1 : 0 }}
            transition={{ duration: expanded ? 0.2 : 0.08, delay: expanded ? 0.18 : 0 }}
            className={expanded ? 'block' : 'hidden'}
          >
            <div className="flex items-center gap-2.5 p-3 pb-2">
              {/* 商品首图 */}
              {firstImg ? (
                <img src={firstImg} alt={firstTitle} draggable={false} className="h-[46px] w-[46px] shrink-0 rounded-[10px] bg-zinc-800 object-cover" />
              ) : (
                <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[10px] bg-zinc-800 text-[20px]">📦</span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-bold leading-[22px] text-[#FF6A00]" data-testid="tb-island-eta">
                  {atStation ? '已放入菜鸟驿站' : `预计${etaText}送达`}
                </p>
                <p className="mt-0.5 truncate text-[12px] leading-[16px] text-white/85" data-testid="tb-island-sub">
                  {subLabelOf(active)}
                </p>
              </div>
              {/* 淘宝图标（黑底高对比直出，与美团岛同款排布） */}
              <img
                src="/icons/taobao.png"
                alt=""
                draggable={false}
                className="h-[34px] w-[34px] shrink-0 select-none object-contain"
              />
            </div>

            {/* 发货 → 运输 → 送达 进度条（快递员形象骑在进度上；与物流地图同一套时间算法） */}
            <div className="px-5 pb-1 pt-6">
              <div className="relative h-[10px]">
                {/* 快递员（骑在进度线上） */}
                <img
                  src={courierSrc}
                  alt=""
                  draggable={false}
                  className="absolute h-[30px] w-[30px] -translate-x-1/2 select-none object-contain transition-[left] duration-700 ease-linear"
                  style={{ left: `${p * 100}%`, bottom: -6, filter: 'drop-shadow(0 3px 3px rgba(0,0,0,0.4))' }}
                />
                {/* 轨道 */}
                <div className="absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-white/22">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#FF8A00] to-[#FF5000]" style={{ width: `${p * 100}%` }} />
                </div>
                {/* 节点（首尾贴边） */}
                {[0, 1, 2].map((k) => (
                  <span
                    key={k}
                    className={`absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
                      stageDone(k as 0 | 1 | 2) ? 'border-[#FF5000] bg-[#FF5000]' : 'border-white/45 bg-black'
                    } ${k === 0 ? 'left-0' : k === 1 ? 'left-1/2' : 'left-full'}`}
                  />
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[11px] leading-none text-white/75">
                <span>发货</span>
                <span className={phase === 'transit' || phase === 'delivering' ? 'font-medium text-white' : ''}>运输</span>
                <span>送达</span>
              </div>
            </div>
            {/* 底部呼吸留白 */}
            <div className="h-1.5" />
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}

/** HH:MM（预计送达时刻） */
function fmtHM(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
