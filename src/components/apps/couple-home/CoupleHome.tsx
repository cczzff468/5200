'use client';

/**
 * 情侣小家 3D v4 —— 主组件（白色系·客厅篇）
 *
 * - 生活模式：摇杆/WASD 操控小人、镜头跟随、滑动旋转视角、点家具交互（无提示气泡/图标）；
 * - 编辑模式：上帝视角、拖拽移动（0.25m 吸附）、移动按钮（拖画面任意处搬运）、
 *   四向旋转（左右 45° + 上下俯仰 15°）、每件家具调色盘、画面缩放、家具商店、昼夜切换；
 * - 金币系统已移除；
 * - 持久化：IndexedDB 即时缓存 + Prisma 服务端（rev 乐观并发，409 采纳服务端）；
 * - 全屏按钮（Fullscreen API，被拦截时降级提示）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Droplet,
  Loader2,
  Maximize,
  Minimize,
  Moon,
  Move,
  Pencil,
  RotateCcw,
  RotateCw,
  Store,
  Sun,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import Joystick from './Joystick';
import {
  CATALOG,
  PLAY_COOLDOWN,
  SHOP_TABS,
  TILT_LIMIT,
  defaultHome,
  fetchRemote,
  loadCache,
  pushRemote,
  resetRemote,
  saveCache,
  saveCacheNow,
  type HomePersist,
} from './catalog';
import type { CharRT, FurnitureItem, FurnitureKind, HomeMode, HomeState } from './types';

const HomeScene = dynamic(() => import('./scene/HomeScene'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-[#f3f0e8]">
      <div className="flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-[13px] text-[#6b6b6b] shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-[#e8a3b3]" />
        小家布置中…
      </div>
    </div>
  ),
});

/** 洗衣一轮时长（秒） */
const WASH_SECONDS = 30;

/** 水平旋转步进（弧度，45°） */
const YAW_STEP = Math.PI / 4;
/** 俯仰旋转步进（弧度，15°） */
const TILT_STEP = Math.PI / 12;

/** 调色盘预设（白色为主 + 可混搭的点缀色） */
const SWATCHES: { hex: string; name: string }[] = [
  { hex: '#ffffff', name: '云白' },
  { hex: '#f6f1e7', name: '奶油' },
  { hex: '#e3e1db', name: '浅灰' },
  { hex: '#43464b', name: '柔黑' },
  { hex: '#f6cdd6', name: '浅粉' },
  { hex: '#f2b3c2', name: '樱粉' },
  { hex: '#f9e6a6', name: '浅黄' },
  { hex: '#c9e3cf', name: '抹茶' },
  { hex: '#d9e0e6', name: '雾灰蓝' },
  { hex: '#dcd2ec', name: '雾紫' },
];

const dirToHeading: Record<string, number> = { up: Math.PI, down: 0, left: -Math.PI / 2, right: Math.PI / 2 };

function headingToDir(h: number): 'up' | 'down' | 'left' | 'right' {
  const deg = ((((h * 180) / Math.PI) % 360) + 360) % 360;
  if (deg >= 315 || deg < 45) return 'down';
  if (deg >= 45 && deg < 135) return 'right';
  if (deg >= 135 && deg < 225) return 'up';
  return 'left';
}

/** 角度归一到 [-π, π] */
function normAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

interface Toast {
  id: number;
  msg: string;
}

let uid = 0;

export default function CoupleHome({ close }: { close: () => void }) {
  // ---------------- 持久化状态 ----------------
  const [pack] = useState<HomePersist>(() => loadCache() ?? { home: defaultHome(), rev: 0 });
  const [items, setItems] = useState<FurnitureItem[]>(pack.home.furniture);
  const [night, setNight] = useState<boolean>(pack.home.night);
  const [rev, setRev] = useState<number>(pack.rev);

  // ---------------- UI 状态 ----------------
  const [mode, setMode] = useState<HomeMode>('live');
  const [selId, setSelId] = useState<string | null>(null);
  const [moveOn, setMoveOn] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopTab, setShopTab] = useState<string>('all');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [full, setFull] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);

  // ---------------- 小人运行时（ref 高频更新，不走 React） ----------------
  const meRT = useRef<CharRT>({
    x: pack.home.chars.me.x,
    z: pack.home.chars.me.z,
    heading: dirToHeading[pack.home.chars.me.dir] ?? 0,
    moving: false,
    target: null,
    nextWander: 3,
  });
  const taRT = useRef<CharRT>({
    x: pack.home.chars.partner.x,
    z: pack.home.chars.partner.z,
    heading: dirToHeading[pack.home.chars.partner.dir] ?? 0,
    moving: false,
    target: null,
    nextWander: 5,
  });
  const joyRef = useRef({ dx: 0, dy: 0 });
  /** 编辑模式缩放指令（HUD 按钮 → Canvas 内相机） */
  const zoomCmd = useRef({ v: 0, dir: 0 });

  // ---------------- 同步 refs（快照用） ----------------
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const nightRef = useRef(night);
  nightRef.current = night;
  const revRef = useRef(rev);
  revRef.current = rev;

  // ---------------- 提示 ----------------
  const toast = useCallback((msg: string) => {
    const id = ++uid;
    setToasts((t) => [...t.slice(-2), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  }, []);

  // ---------------- 快照与推送 ----------------
  const snap = useCallback((): HomePersist => {
    const home: HomeState = {
      v: 4,
      furniture: itemsRef.current,
      night: nightRef.current,
      chars: {
        me: {
          x: Math.round(meRT.current.x * 100) / 100,
          z: Math.round(meRT.current.z * 100) / 100,
          dir: headingToDir(meRT.current.heading),
        },
        partner: {
          x: Math.round(taRT.current.x * 100) / 100,
          z: Math.round(taRT.current.z * 100) / 100,
          dir: headingToDir(taRT.current.heading),
        },
      },
    };
    return { home, rev: revRef.current };
  }, []);

  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushTick = useRef(0);
  const doPush = useCallback(
    async (p: HomePersist) => {
      const res = await pushRemote(p);
      if (res === 'offline') return; // 网络失败：保持本地，稍后重试
      if ('conflict' in res) {
        // 采纳服务端最新
        const s = res.conflict;
        setItems(s.home.furniture);
        setNight(s.home.night);
        setRev(s.rev);
        meRT.current.x = s.home.chars.me.x;
        meRT.current.z = s.home.chars.me.z;
        taRT.current.x = s.home.chars.partner.x;
        taRT.current.z = s.home.chars.partner.z;
        saveCacheNow(s);
        toast('已同步对方的最新布置');
        return;
      }
      setRev(res.rev);
    },
    [toast],
  );

  const schedulePush = useCallback(
    (p?: HomePersist) => {
      const data = p ?? snap();
      saveCache(data); // idb 节流写
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        void doPush(data);
      }, 2500);
    },
    [snap, doPush],
  );

  const saveSoon = useCallback(() => schedulePush(), [schedulePush]);

  // ---------------- 初始化：拉远端（远端 rev 更新则采纳） ----------------
  useEffect(() => {
    let alive = true;
    (async () => {
      const remote = await fetchRemote();
      if (!alive) return;
      if (remote && remote.rev > pack.rev) {
        setItems(remote.home.furniture);
        setNight(remote.home.night);
        setRev(remote.rev);
        meRT.current.x = remote.home.chars.me.x;
        meRT.current.z = remote.home.chars.me.z;
        taRT.current.x = remote.home.chars.partner.x;
        taRT.current.z = remote.home.chars.partner.z;
        saveCacheNow(remote);
      } else {
        // 无远端或本地更新：播种服务端
        schedulePush();
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 定期推送 + 卸载兜底
  useEffect(() => {
    const t = setInterval(() => {
      if (++pushTick.current % 12 === 0) schedulePush();
    }, 5000);
    const onHide = () => saveCacheNow(snap());
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(t);
      window.removeEventListener('pagehide', onHide);
      saveCacheNow(snap());
    };
  }, []);

  // ---------------- 洗衣机倒计时（无事可做时不 setState，避免每秒重渲染打断手势） ----------------
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      const finishing = itemsRef.current.some(
        (it) => it.st?.washing && it.st.washStart && now - it.st.washStart > WASH_SECONDS * 1000,
      );
      if (!finishing) return; // 没有到点的洗衣机 → 不触发渲染
      setItems((prev) =>
        prev.map((it) => {
          if (it.st?.washing && it.st.washStart && Date.now() - it.st.washStart > WASH_SECONDS * 1000) {
            return { ...it, st: { ...it.st, washing: false, washDone: true } };
          }
          return it;
        }),
      );
      toast('洗衣机：衣物洗好了');
      saveSoon();
    }, 1000);
    return () => clearInterval(t);
  }, [toast, saveSoon]);

  // ---------------- 家具交互（生活模式） ----------------
  const onFurnTap = useCallback(
    (item: FurnitureItem) => {
      const entry = CATALOG[item.kind];
      if (!entry) return;

      if (mode === 'edit') {
        // 选中（正在逛商店时点家具 → 收起抽屉露出操作栏）
        setShopOpen(false);
        setPaletteOpen(false);
        setSelId((s) => (s === item.id ? null : item.id));
        return;
      }

      // 生活模式：按能力交互
      const st = item.st ?? {};
      const patch = (next: FurnitureItem['st']) => {
        setItems((prev) => prev.map((f) => (f.id === item.id ? { ...f, st: { ...f.st, ...next } } : f)));
        saveSoon();
      };

      if (entry.acts?.washer) {
        if (st.washDone) {
          patch({ washDone: false, open: false });
          toast('衣物收好啦');
        } else if (st.washing) {
          const left = Math.max(1, Math.ceil(WASH_SECONDS - (Date.now() - (st.washStart ?? 0)) / 1000));
          toast(`洗衣机运转中…约 ${left} 秒`);
        } else {
          const now = Date.now();
          patch({ washing: true, washStart: now, open: false });
          toast('开始洗衣，去忙别的吧～');
        }
        return;
      }
      if (entry.acts?.toggle) {
        patch({ on: !st.on });
        return;
      }
      if (entry.acts?.door) {
        patch({ open: !st.open });
        return;
      }
      if (entry.acts?.playful) {
        const now = Date.now();
        if (now - (st.lastTouch ?? 0) < PLAY_COOLDOWN * 1000) return;
        patch({ lastTouch: now });
      }
    },
    [mode, saveSoon, toast],
  );

  // ---------------- 编辑操作 ----------------
  const rotateY = useCallback(
    (dir: 1 | -1) => {
      if (!selId) return;
      setItems((prev) => prev.map((f) => (f.id === selId ? { ...f, ry: normAngle((f.ry ?? 0) + dir * YAW_STEP) } : f)));
      saveSoon();
    },
    [selId, saveSoon],
  );

  const tilt = useCallback(
    (dir: 1 | -1) => {
      if (!selId) return;
      setItems((prev) =>
        prev.map((f) =>
          f.id === selId
            ? { ...f, rx: Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, (f.rx ?? 0) + dir * TILT_STEP)) }
            : f,
        ),
      );
      saveSoon();
    },
    [selId, saveSoon],
  );

  const removeSel = useCallback(() => {
    if (!selId) return;
    setItems((prev) => prev.filter((f) => f.id !== selId));
    setSelId(null);
    setMoveOn(false);
    setPaletteOpen(false);
    saveSoon();
    toast('已收起家具');
  }, [selId, saveSoon, toast]);

  /** 调色盘：选中家具上色 / 恢复默认 */
  const applyColor = useCallback(
    (hex: string | null) => {
      if (!selId) return;
      setItems((prev) =>
        prev.map((f) => (f.id === selId ? { ...f, col: hex ?? undefined } : f)),
      );
      saveSoon();
    },
    [selId, saveSoon],
  );

  const toggleMove = useCallback(() => {
    setMoveOn((m) => {
      const next = !m;
      if (next) toast('移动模式：按住画面拖动即可搬运');
      return next;
    });
  }, [toast]);

  /** 编辑模式画面缩放 */
  const zoom = useCallback(
    (dir: 1 | -1) => {
      zoomCmd.current = { v: zoomCmd.current.v + 1, dir };
    },
    [],
  );

  const onDragMove = useCallback((id: string, x: number, z: number) => {
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, x, z } : f)));
  }, []);

  const onDragEnd = useCallback(
    (_id: string) => {
      saveSoon();
    },
    [saveSoon],
  );

  const onDragSelect = useCallback((id: string) => {
    setSelId(id);
  }, []);

  const onFloorTap = useCallback(() => {
    setSelId(null);
    setMoveOn(false);
    setPaletteOpen(false);
  }, []);

  // ---------------- 商店 ----------------
  const shopItems = useMemo(() => {
    const list = Object.values(CATALOG).filter(
      (e) => !e.hidden && (shopTab === 'all' ? true : e.cat === shopTab),
    );
    return list;
  }, [shopTab]);

  /** 找个不太挤的落点 */
  const findSpot = useCallback((kind: FurnitureKind): { x: number; z: number } => {
    const e = CATALOG[kind];
    const [w, d] = e.fp;
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() - 0.5) * 6;
      const z = (Math.random() - 0.3) * 3.4;
      const ok = itemsRef.current.every((it) => {
        const ce = CATALOG[it.kind];
        if (!ce || (it.y ?? 0) > 0.45) return true;
        const [cw, cd] = ce.fp;
        return Math.abs(it.x - x) > (w + cw) / 2 + 0.15 || Math.abs(it.z - z) > (d + cd) / 2 + 0.15;
      });
      if (ok) return { x: Math.round(x * 4) / 4, z: Math.round(z * 4) / 4 };
    }
    return { x: 0, z: 0.5 };
  }, []);

  const buy = useCallback(
    (kind: FurnitureKind) => {
      const e = CATALOG[kind];
      if (!e) return;
      const spot = findSpot(kind);
      const id = `${kind}-${Date.now().toString(36)}`;
      setItems((prev) => [...prev, { id, kind, x: spot.x, z: spot.z, ry: 0, st: {} }]);
      setSelId(id);
      saveSoon();
      toast(`已添加「${e.name}」`);
    },
    [findSpot, saveSoon, toast],
  );

  const resetHome = useCallback(async () => {
    const fresh = await resetRemote();
    setItems(fresh.home.furniture);
    setNight(fresh.home.night);
    setRev(fresh.rev);
    meRT.current.x = fresh.home.chars.me.x;
    meRT.current.z = fresh.home.chars.me.z;
    taRT.current.x = fresh.home.chars.partner.x;
    taRT.current.z = fresh.home.chars.partner.z;
    setSelId(null);
    setMoveOn(false);
    setPaletteOpen(false);
    toast('小家已重置');
  }, [toast]);

  // ---------------- 模式 / 昼夜 / 全屏 ----------------
  const switchMode = useCallback(
    (m: HomeMode) => {
      setMode(m);
      if (m === 'edit') setShopOpen(true);
      else {
        setShopOpen(false);
        setSelId(null);
        setMoveOn(false);
        setPaletteOpen(false);
      }
      saveCacheNow(snap());
      schedulePush();
    },
    [snap, schedulePush],
  );

  const toggleNight = useCallback(() => {
    setNight((n) => !n);
    saveSoon();
  }, [saveSoon]);

  const toggleFull = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setFull(false);
      } else {
        await rootRef.current?.requestFullscreen();
        setFull(true);
      }
    } catch {
      toast('当前环境不支持全屏');
    }
  }, [toast]);

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ---------------- 渲染 ----------------
  const selItem = selId ? items.find((f) => f.id === selId) : null;
  const selEntry = selItem ? CATALOG[selItem.kind] : null;

  /** 操作按钮通用样式 */
  const toolBtn = 'flex h-9 w-9 items-center justify-center rounded-full transition active:scale-90';

  return (
    <div ref={rootRef} className="absolute inset-0 select-none overflow-hidden bg-[#efece4]">
      {/* 3D 场景 */}
      <HomeScene
        items={items}
        mode={mode}
        night={night}
        selId={selId}
        moveOn={moveOn}
        meRT={meRT.current}
        taRT={taRT.current}
        joyRef={joyRef}
        zoomCmd={zoomCmd}
        onFloorTap={onFloorTap}
        onFurnTap={onFurnTap}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragSelect={onDragSelect}
      />

      {/* ===== HUD ===== */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
        {/* 顶栏 */}
        <div className="flex items-start justify-between p-3 pt-11">
          <button
            onClick={close}
            aria-label="返回"
            className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#5a5a5e] shadow-sm backdrop-blur transition active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          {/* 模式标签 */}
          <div className="rounded-full bg-black/25 px-2.5 py-0.5 text-[10px] font-medium tracking-wide text-white/90 backdrop-blur-sm">
            {mode === 'live' ? '生活模式' : '装修模式'}
          </div>

          <div className="flex gap-2">
            <button
              onClick={toggleNight}
              aria-label={night ? '切换白天' : '切换夜晚'}
              className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#7a6a4e] shadow-sm backdrop-blur transition active:scale-95"
            >
              {night ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
            </button>
            <button
              onClick={toggleFull}
              aria-label="全屏"
              className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#5a5a5e] shadow-sm backdrop-blur transition active:scale-95"
            >
              {full ? <Minimize className="h-[18px] w-[18px]" /> : <Maximize className="h-[18px] w-[18px]" />}
            </button>
          </div>
        </div>

        {/* Toast */}
        <div className="pointer-events-none absolute left-1/2 top-24 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.95 }}
                className="rounded-full bg-[#3a3a3e]/85 px-3.5 py-1.5 text-[12px] text-white shadow-lg backdrop-blur-sm"
              >
                {t.msg}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* 编辑模式：缩放按钮（右缘中部） */}
        {mode === 'edit' && (
          <div className="pointer-events-auto absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-2">
            <button
              onClick={() => zoom(1)}
              aria-label="放大画面"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/85 text-[#5a5a5e] shadow-md backdrop-blur transition active:scale-95"
            >
              <ZoomIn className="h-5 w-5" />
            </button>
            <button
              onClick={() => zoom(-1)}
              aria-label="缩小画面"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/85 text-[#5a5a5e] shadow-md backdrop-blur transition active:scale-95"
            >
              <ZoomOut className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* 底部区 */}
        <div className="p-4 pb-6">
          {/* 选中操作条（编辑模式） */}
          <AnimatePresence>
            {mode === 'edit' && selItem && selEntry && !shopOpen && !paletteOpen && (
              <motion.div
                key={selItem.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                className="pointer-events-auto mx-auto mb-3 w-fit"
              >
                {/* 家具名小签 */}
                <div className="mx-auto mb-1.5 w-fit rounded-full bg-black/25 px-2.5 py-0.5 text-[11px] font-medium text-white/95 backdrop-blur-sm">
                  {selEntry.name}
                </div>
                <div className="flex items-center gap-1 rounded-2xl bg-white/90 p-1.5 shadow-lg backdrop-blur">
                  {/* 移动 */}
                  <button
                    onClick={toggleMove}
                    aria-label="移动模式（拖动画面搬运）"
                    title="移动模式"
                    className={
                      moveOn
                        ? `${toolBtn} bg-[#dff0e2] text-[#3f9a58] shadow-inner`
                        : `${toolBtn} bg-[#f1efe9] text-[#8a8a86]`
                    }
                  >
                    <Move className="h-4 w-4" />
                  </button>
                  {/* 左转 */}
                  <button
                    onClick={() => rotateY(-1)}
                    aria-label="向左旋转 45°"
                    title="向左旋转"
                    className={`${toolBtn} bg-[#f5efe2] text-[#8a7a54] hover:bg-[#f0e6cc]`}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  {/* 右转 */}
                  <button
                    onClick={() => rotateY(1)}
                    aria-label="向右旋转 45°"
                    title="向右旋转"
                    className={`${toolBtn} bg-[#f5efe2] text-[#8a7a54] hover:bg-[#f0e6cc]`}
                  >
                    <RotateCw className="h-4 w-4" />
                  </button>
                  {/* 上仰 */}
                  <button
                    onClick={() => tilt(1)}
                    aria-label="向上旋转 15°"
                    title="向上旋转"
                    className={`${toolBtn} bg-[#f5efe2] text-[#8a7a54] hover:bg-[#f0e6cc]`}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  {/* 下俯 */}
                  <button
                    onClick={() => tilt(-1)}
                    aria-label="向下旋转 15°"
                    title="向下旋转"
                    className={`${toolBtn} bg-[#f5efe2] text-[#8a7a54] hover:bg-[#f0e6cc]`}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  {/* 调色 */}
                  <button
                    onClick={() => setPaletteOpen(true)}
                    aria-label="调色盘"
                    title="调色盘"
                    className={`${toolBtn} bg-[#f0e2ee] text-[#b07193] hover:bg-[#ead4e4]`}
                  >
                    <Droplet className="h-4 w-4" />
                  </button>
                  {/* 收起 */}
                  <button
                    onClick={removeSel}
                    aria-label="收起家具"
                    title="收起"
                    className={`${toolBtn} bg-[#f9e3e8] text-[#d4717f] hover:bg-[#f5d5dc]`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  {/* 取消选中 */}
                  <button
                    onClick={() => setSelId(null)}
                    aria-label="取消选中"
                    className={`${toolBtn} bg-[#efeef0] text-[#8a8a90]`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-end justify-between">
            {/* 摇杆（生活模式） */}
            <div className={mode === 'live' ? 'pointer-events-auto' : 'hidden'}>
              <Joystick onVec={(dx, dy) => (joyRef.current = { dx, dy })} size={124} />
            </div>
            <div className={mode === 'live' ? 'hidden' : 'flex-1'} />

            {/* 模式切换 + 商店 */}
            <div className="pointer-events-auto flex flex-col items-end gap-2">
              {mode === 'edit' && (
                <button
                  onClick={() => setShopOpen((o) => !o)}
                  className="flex h-11 items-center gap-2 rounded-full bg-white/85 px-4 text-[13px] font-medium text-[#4a4a4e] shadow-md backdrop-blur transition active:scale-95"
                >
                  <Store className="h-4 w-4 text-[#c99a5b]" />
                  商店
                </button>
              )}
              <button
                onClick={() => switchMode(mode === 'live' ? 'edit' : 'live')}
                className={
                  mode === 'live'
                    ? 'flex h-12 items-center gap-2 rounded-full bg-[#f4b3c2] px-5 text-[14px] font-semibold text-white shadow-lg shadow-[#f4b3c2]/40 transition active:scale-95'
                    : 'flex h-12 items-center gap-2 rounded-full bg-[#8fce9e] px-5 text-[14px] font-semibold text-white shadow-lg shadow-[#8fce9e]/40 transition active:scale-95'
                }
              >
                {mode === 'live' ? (
                  <>
                    <Pencil className="h-4 w-4" />
                    装修小家
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    完成
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ===== 调色盘面板（编辑模式选中家具） ===== */}
      <AnimatePresence>
        {mode === 'edit' && paletteOpen && selItem && selEntry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/25 p-6"
            onClick={() => setPaletteOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.92, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 8 }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              className="pointer-events-auto w-full max-w-[320px] rounded-3xl bg-white/95 p-5 shadow-2xl backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[15px] font-semibold text-[#3a3a3e]">给「{selEntry.name}」上色</span>
                <button
                  onClick={() => setPaletteOpen(false)}
                  aria-label="关闭调色盘"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mb-4 text-[11.5px] text-[#9a9a96]">白色为主，点缀色随心混搭</p>

              {/* 色卡网格 */}
              <div className="grid grid-cols-5 gap-2.5">
                {SWATCHES.map((s) => (
                  <button
                    key={s.hex}
                    onClick={() => applyColor(s.hex)}
                    title={s.name}
                    aria-label={`选色 ${s.name}`}
                    className="group flex flex-col items-center gap-1"
                  >
                    <span
                      className={
                        selItem.col === s.hex
                          ? 'h-10 w-10 rounded-full ring-2 ring-[#f2a9bc] ring-offset-2 shadow-md'
                          : 'h-10 w-10 rounded-full shadow-sm ring-1 ring-black/10 transition group-active:scale-90'
                      }
                      style={{ background: s.hex }}
                    />
                    <span className="text-[10px] text-[#8a8a86]">{s.name}</span>
                  </button>
                ))}
              </div>

              {/* 自定义 + 恢复默认 */}
              <div className="mt-4 flex items-center gap-2.5">
                <label className="relative flex h-11 flex-1 cursor-pointer items-center gap-2.5 rounded-2xl bg-[#f6f4ef] px-3 ring-1 ring-[#eae7df]">
                  <span
                    className="h-7 w-7 rounded-lg shadow-inner ring-1 ring-black/10"
                    style={{
                      background: /^#[0-9a-fA-F]{6}$/.test(selItem.col ?? '')
                        ? selItem.col
                        : 'conic-gradient(#f6cdd6,#f9e6a6,#c9e3cf,#dcd2ec,#f6cdd6)',
                    }}
                  />
                  <span className="text-[12px] font-medium text-[#4a4a4e]">自定义颜色</span>
                  <input
                    type="color"
                    aria-label="自定义颜色"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    value={/^#[0-9a-fA-F]{6}$/.test(selItem.col ?? '') ? selItem.col : '#ffffff'}
                    onChange={(e) => applyColor(e.target.value)}
                  />
                </label>
                <button
                  onClick={() => applyColor(null)}
                  className="flex h-11 items-center rounded-2xl bg-[#f1efe9] px-4 text-[12px] font-medium text-[#8a8a86] transition active:scale-95"
                >
                  原色
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== 商店抽屉（编辑模式） ===== */}
      <AnimatePresence>
        {mode === 'edit' && shopOpen && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="absolute inset-x-0 bottom-0 z-10 flex max-h-[52%] flex-col rounded-t-3xl bg-white/95 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] backdrop-blur-xl"
          >
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <span className="text-[15px] font-semibold text-[#3a3a3e]">家具商店</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={resetHome}
                  className="rounded-full bg-[#f6eded] px-3 py-1 text-[11px] font-medium text-[#c26a6a] transition active:scale-95"
                >
                  重置
                </button>
                <button
                  onClick={() => setShopOpen(false)}
                  aria-label="关闭商店"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 分类 tab（纯文字） */}
            <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 pb-2 pt-1">
              {SHOP_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setShopTab(t.key)}
                  className={
                    shopTab === t.key
                      ? 'shrink-0 rounded-full bg-[#f4b3c2] px-3 py-1 text-[12px] font-medium text-white'
                      : 'shrink-0 rounded-full bg-[#f1efe9] px-3 py-1 text-[12px] text-[#8a8a86] transition active:scale-95'
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* 商品网格 */}
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto px-4 pb-5 pt-1">
              {shopItems.map((e) => (
                <button
                  key={e.kind}
                  onClick={() => buy(e.kind)}
                  className="flex flex-col items-start gap-1 rounded-2xl bg-[#faf8f3] p-2.5 text-left shadow-sm ring-1 ring-[#efece2] transition active:scale-95"
                >
                  <span
                    className="h-9 w-9 rounded-xl shadow-inner"
                    style={{ background: `linear-gradient(135deg, ${catColor(e.cat)}, ${shade(e.cat)})` }}
                  />
                  <span className="w-full truncate text-[11.5px] font-medium leading-tight text-[#4a4a4e]">
                    {e.name}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------- 商店色卡 ----------------

const CAT_COLORS: Record<string, [string, string]> = {
  sofa: ['#f6cdd6', '#f0b3c2'],
  table: ['#efdbb2', '#e5c894'],
  bed: ['#f9e4ea', '#f2ccd8'],
  lamp: ['#ffefc0', '#ffe49a'],
  plant: ['#c3e5cf', '#a8d8bb'],
  appliance: ['#e8e9e6', '#dcdcd8'],
  bathroom: ['#e3e9e6', '#d5e0da'],
  decor: ['#e6cfae', '#dbaf87'],
};

function catColor(cat: string): string {
  return (CAT_COLORS[cat] ?? CAT_COLORS.decor)[0];
}
function shade(cat: string): string {
  return (CAT_COLORS[cat] ?? CAT_COLORS.decor)[1];
}
