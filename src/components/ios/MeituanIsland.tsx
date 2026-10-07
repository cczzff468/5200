'use client';

/**
 * 美团外卖灵动岛（对齐真机「美团外卖 × iOS 灵动岛」体验，用户规格）：
 * - 小窗（黑色胶囊）：有进行中的外卖单时常驻显示（所有界面：主屏/各 App/锁屏）——
 *   左侧当前骑手形象 + 状态文案（商家接单中/商家备餐中/送货中），右侧剩余时间「N分钟」黄色 + 「送达」；
 * - 大窗（展开卡）：商家图 + 黄色「预计HH:MM送达」+ 状态副文案 + 美团袋鼠标 +
 *   接单→取餐→送达 三节点进度条（骑手形象骑在进度上，随时间推进）；
 *   状态变化（支付成功/商家接单/骑手取餐）时自动展开一次，显示 5 秒收回小窗；
 * - 点小窗 → 展开大窗（一直显示，不自动收回）；
 * - 点大窗 → 进入美团订单详情（复用灵动岛导航总线：switchToApp('meituan') + 订单详情）；
 * - 点大窗以外的地方 → 收回小窗（透明捕获层，iOS 灵动岛同语义）；
 * - 聊天消息灵动岛通知展示期间/来电响铃/熄屏/关闭状态栏时整层隐身，恢复后小窗回归；
 * - 剩余分钟按真实时钟每秒推算（etaAt），催单（催一下）提前 eta 后小窗/大窗数字即时变小。
 *
 * 层级 z-[82]：盖住音乐灵动岛（z-81，美团配送优先展示；音乐在播时由 mt-island-store 让音乐弹窗隐身），
 * 低于聊天通知卡（z-93）。大窗的「点击别处」捕获层 z-[81]。
 */

import { useEffect, useRef, useState } from 'react';
import { motion, type Transition } from 'framer-motion';
import { useSettings, useUI } from '@/lib/ios/store';
import { useIslandNotify, navigateToChatSession } from '@/lib/ios/island-notify';
import { useGlobalCall } from '@/lib/ios/global-call';
import { useIncomingCall } from '@/lib/ios/incoming-call';
import { useMtIsland } from '@/lib/ios/mt-island-store';
import { mtCurrentRider } from '@/lib/ios/mt-rider';
import { mtGetSession, mtLoadOrders, mtUidOf, type MtOrder } from '@/lib/ios/meituan-store';

/** 小窗胶囊几何 */
const PILL = { width: 198, height: 33, borderRadius: 16.5 } as const;
/** 大窗展开姿态 */
const EXPANDED = { width: 348, height: 'auto', borderRadius: 26 } as const;
const SPRING: Transition = { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 };
/** 自动展开停留时长（大窗显示 5 秒） */
const AUTO_COLLAPSE_MS = 5000;
/** 胶囊/展开态的垂直锚位（与静态灵动岛同位） */
const PILL_TOP = 11;

/** 来电展示中（与 IslandNotificationLayer 同口径，只读两个通话 store） */
function useIncomingCallPresenting(): boolean {
  const call = useIncomingCall((s) => s.call);
  const enginePhase = useGlobalCall((s) => s.enginePhase);
  if (call?.source === 'phone') return true;
  const source = (call?.source ?? '') as string;
  if (source === 'wx' || source === 'qq') return enginePhase === 'incoming';
  return false;
}

/** 进行中的外卖单（配送三态；团购/出行单不进灵动岛） */
function inProgressOf(o: MtOrder): boolean {
  const kind = o.kind ?? 'waimai';
  return kind === 'waimai' && (o.status === 'pendingAccept' || o.status === 'accepted' || o.status === 'delivering');
}

/** 小窗状态文案 */
function pillLabelOf(o: MtOrder): string {
  if (o.status === 'pendingAccept') return '商家接单中';
  if (o.status === 'accepted') return '商家备餐中';
  return '送货中';
}

/** 大窗副文案（对齐参考截图） */
function subLabelOf(o: MtOrder): string {
  if (o.status === 'pendingAccept') return '订单已支付，等待商家接单';
  if (o.status === 'accepted') return '商家已接单，商品备餐中';
  return '商家已出餐，骑手正赶往商家';
}

/** 三节点进度（0~1）：接单前起步、备餐中到取餐节点前、配送段按真实时间在 取餐→送达 间推进 */
function progressOf(o: MtOrder, now: number): number {
  if (o.status === 'pendingAccept') return 0.1;
  if (o.status === 'accepted') return 0.36;
  const delAt = o.statusLog.find((s) => s.status === 'delivering')?.at ?? o.paidAt ?? now;
  const end = o.etaAt ?? delAt + 60_000;
  const frac = end > delAt ? Math.min(1, Math.max(0, (now - delAt) / (end - delAt))) : 1;
  return 0.55 + 0.42 * frac;
}

export default function MeituanIsland() {
  const statusBarVisible = useSettings((s) => s.statusBarVisible);
  const screenOff = useUI((s) => s.screenOff);
  const chatNotifyShowing = useIslandNotify((s) => s.current !== null || s.exiting);
  const callPresenting = useIncomingCallPresenting();

  /** active = 当前进行中的外卖单（每秒重读 kv；null = 无单隐身） */
  const [active, setActive] = useState<MtOrder | null>(null);
  /** 小窗形态；expanded = 大窗 */
  const [expanded, setExpanded] = useState(false);
  /** 每秒刷新的时钟（剩余分钟/进度推进） */
  const [nowTs, setNowTs] = useState(() => Date.now());

  const expandedRef = useRef(false);
  const autoExpandRef = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 已消费的状态签名（订单id|状态）：变化即自动展开大窗 5 秒（含通知层让位后的补放） */
  const seenSigRef = useRef<string>('');

  const readActive = () => {
    try {
      const s = mtGetSession();
      if (!s) {
        setActive(null);
        return;
      }
      const list = mtLoadOrders(mtUidOf(s)).filter(inProgressOf);
      // 多单进行中：取最近支付的一单
      list.sort((a, b) => (b.paidAt ?? b.createdAt) - (a.paidAt ?? a.createdAt));
      setActive(list[0] ?? null);
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

  // 数据源：每秒轮询（kv 无订阅总线）+ 订单变化事件即时刷新 + 时钟推进
  // （首帧读取包进微任务，规避 react-hooks/set-state-in-effect）
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => {
      if (!alive) return;
      readActive();
      setNowTs(Date.now());
    });
    const iv = window.setInterval(() => {
      readActive();
      setNowTs(Date.now());
    }, 1000);
    const onChanged = () => readActive();
    window.addEventListener('mt-orders-changed', onChanged);
    return () => {
      alive = false;
      window.clearInterval(iv);
      window.removeEventListener('mt-orders-changed', onChanged);
    };
  }, []);

  useEffect(() => () => { clearAuto(); }, []);

  const hidden = !statusBarVisible || screenOff || chatNotifyShowing || callPresenting || !active;

  // 状态签名变化（新单/接单/取餐）→ 自动展开大窗 5 秒；
  // 通知层/来电占位期间隐身时不消费签名，恢复可见（hidden 翻转触发本 effect 重跑）后补放
  useEffect(() => {
    if (hidden) return;
    const sig = active ? `${active.id}|${active.status}` : '';
    if (!sig) {
      seenSigRef.current = '';
      return;
    }
    if (sig === seenSigRef.current) return;
    seenSigRef.current = sig;
    // 微任务里展开（规则：effect 内不同步 setState）
    Promise.resolve().then(() => autoExpand());
  }, [active, hidden]);

  // 可见性写入共享 store（音乐灵动岛/状态栏消费）+ 隐身时收回展开态（微任务里 setState）
  useEffect(() => {
    useMtIsland.getState().setVisible(!hidden);
    if (hidden && expandedRef.current) {
      Promise.resolve().then(() => collapse());
    }
  }, [hidden]);

  if (hidden || !active) return null;

  // 剩余送达时间（真实时钟推算，秒级刷新；催单后立刻变小）
  const leftMs = Math.max(0, (active.etaAt ?? 0) - nowTs);
  const leftMin = Math.max(1, Math.ceil(leftMs / 60_000));
  const leftText = leftMs < 60_000 ? '即将送达' : `${leftMin}分钟`;
  const etaText = active.etaAt ? fmtHM(active.etaAt) : '--:--';

  const p = progressOf(active, nowTs);
  const stageDone = (k: 0 | 1 | 2) => {
    if (k === 0) return active.status !== 'pendingAccept';
    if (k === 1) return active.status === 'delivering';
    return false;
  };
  const riderSrc = mtCurrentRider().src;

  return (
    <>
      {/* 大窗展开期间：点击别处收回小窗（透明捕获层，iOS 灵动岛同语义） */}
      {expanded && (
        <div className="absolute inset-0 z-[81]" onClick={collapse} aria-label="收起美团配送弹窗" data-testid="mt-island-catcher" />
      )}
      <div className="pointer-events-none absolute inset-x-0 z-[82] flex flex-col items-center" style={{ top: PILL_TOP }}>
        <motion.div
          data-testid="mt-island"
          role="button"
          aria-label={expanded ? '美团配送弹窗：打开订单详情' : '美团配送弹窗：展开配送进度'}
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
              navigateToChatSession('meituan', active.id);
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
              src={riderSrc}
              alt=""
              draggable={false}
              className="h-[27px] w-[27px] shrink-0 select-none object-contain"
              style={{ filter: 'drop-shadow(0 1.5px 2px rgba(0,0,0,0.35))' }}
            />
            <span className="min-w-0 shrink-0 text-[12px] font-medium leading-none text-white/90">{pillLabelOf(active)}</span>
            <span className="min-w-0 flex-1" />
            <span className="shrink-0 whitespace-nowrap text-[12px] leading-none">
              <span className="font-bold text-[#FFC300]" data-testid="mt-island-left">
                {leftText}
              </span>
              {leftMs >= 60_000 && <span className="ml-[3px] text-white/75">送达</span>}
            </span>
          </motion.div>

          {/* ---------- 大窗内容（展开基本完成后淡入；对齐参考截图布局） ---------- */}
          <motion.div initial={false} animate={{ opacity: expanded ? 1 : 0 }} transition={{ duration: expanded ? 0.18 : 0.08 }} className={expanded ? 'block' : 'hidden'}>
            <div className="flex items-center gap-2.5 p-3 pb-2">
              {/* 商家图 */}
              {active.merchantImg ? (
                <img src={active.merchantImg} alt="" draggable={false} className="h-[46px] w-[46px] shrink-0 rounded-[10px] bg-zinc-800 object-cover" />
              ) : (
                <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[10px] bg-zinc-800 text-[20px]">{active.merchantEmoji}</span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-bold leading-[22px] text-[#FFC300]" data-testid="mt-island-eta">
                  预计{etaText}送达
                </p>
                <p className="mt-0.5 truncate text-[12px] leading-[16px] text-white/85" data-testid="mt-island-sub">
                  {subLabelOf(active)}
                </p>
              </div>
              {/* 美团袋鼠标（白底圆角方块） */}
              <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-white">
                <img src="/icons/meituan.png" alt="" draggable={false} className="h-[26px] w-[26px] rounded-[6px] object-contain" />
              </span>
            </div>

            {/* 接单 → 取餐 → 送达 进度条（骑手形象骑在进度上） */}
            <div className="px-5 pb-1 pt-2">
              <div className="relative h-[10px]">
                {/* 骑手（贴在进度头顶上方） */}
                <img
                  src={riderSrc}
                  alt=""
                  draggable={false}
                  className="absolute bottom-[7px] h-[30px] w-[30px] -translate-x-1/2 select-none object-contain transition-[left] duration-700 ease-linear"
                  style={{ left: `${p * 100}%`, filter: 'drop-shadow(0 3px 3px rgba(0,0,0,0.4))' }}
                />
                {/* 轨道 */}
                <div className="absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-white/22">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#FFD100] to-[#FFC300]" style={{ width: `${p * 100}%` }} />
                </div>
                {/* 节点（首尾贴边：接单/送达在轨道两端，取餐居中） */}
                {[0, 1, 2].map((k) => (
                  <span
                    key={k}
                    className={`absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
                      stageDone(k as 0 | 1 | 2) ? 'border-[#FFC300] bg-[#FFC300]' : 'border-white/45 bg-black'
                    } ${k === 0 ? 'left-0' : k === 1 ? 'left-1/2' : 'left-full'}`}
                  />
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[11px] leading-none text-white/75">
                <span>接单</span>
                <span className={active.status === 'delivering' ? 'font-medium text-white' : ''}>取餐</span>
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
