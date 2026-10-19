'use client';

/**
 * 情侣小家 3D v4 —— 主组件（白色系·客厅篇）
 *
 * - 生活模式：摇杆/WASD 操控小人、镜头跟随、滑动全方位旋转视角、点家具交互、点窗户开合；
 * - 编辑模式：上帝视角、拖拽移动（0.25m 吸附）、移动方式双轨：四向按钮微调 + 按住拖动/移动模式搬运、
 *   四宫格旋转（左转/右转 + 上仰/下俯）、每件家具调色盘、地板/墙壁自定义颜色、画面缩放、家具商店、昼夜切换；
 * - 金币系统已移除；
 * - 持久化：IndexedDB 即时缓存 + Prisma 服务端（rev 乐观并发，409 采纳服务端）；
 * - 全屏按钮（Fullscreen API，被拦截时降级提示）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Armchair,
  Baby,
  Bath,
  BedDouble,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Clock,
  Droplet,
  Eye,
  Loader2,
  Maximize,
  Minimize,
  Moon,
  Move,
  Paintbrush,
  Pencil,
  RotateCcw,
  RotateCw,
  Store,
  Sun,
  Trash2,
  UserRound,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import Joystick from './Joystick';
import {
  BATH_X1,
  CATALOG,
  DOORS,
  PLAY_COOLDOWN,
  ROOM_SPANS,
  ROOM_NAMES,
  SHOP_TABS,
  SNAP,
  TILT_LIMIT,
  WALL_H,
  WALL_SLOTS,
  WINS,
  clampFurnToRooms,
  defaultHome,
  fetchRemote,
  footprintOf,
  loadCache,
  pushRemote,
  resetRemote,
  resolveDoorPos,
  resolveWinPos,
  roomAt,
  saveCache,
  saveCacheNow,
  snapToWallSlot,
  type HomePersist,
} from './catalog';
import { getCachedThumb } from './scene/ShopThumbs';
import type { CharAction, CharPose, CharRT, CharStyle, FurnitureItem, FurnitureKind, HomeMode, HomeState, RoomId } from './types';

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

/** 商城缩略图工作室（隐藏离屏画布，商品 1:1 快照） */
const ShopThumbStudio = dynamic(() => import('./scene/ShopThumbs'), { ssr: false });

/** 洗衣一轮时长（秒） */
const WASH_SECONDS = 30;

/** 水平旋转步进（弧度，45°） */
const YAW_STEP = Math.PI / 4;
/** 俯仰旋转步进（弧度，15°） */
const TILT_STEP = Math.PI / 12;
/** 升降步进（米）：把小家具抬上桌 / 放回地面 */
const LIFT_STEP = 0.23;
const LIFT_MAX = 2.05;

/** 相片窗宽高比：按框型裁剪（立式/挂墙竖版 3:4 偏竖、横版 5:3、拍立得 1:1） */
const PHOTO_ASPECTS: Record<string, number> = {
  photoFrame: 0.4 / 0.56,
  photoWall: 0.46 / 0.6,
  photoWallWide: 1.0 / 0.6,
  polaroid: 1,
};

/**
 * 手机照片 → 居中裁到指定比例 → 压成 JPEG dataURL（几十 KB，可永久存在小家档案里）
 */
function compressPhoto(file: File, aspect: number, maxH = 520, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const finish = (fn: () => void) => {
      URL.revokeObjectURL(url);
      fn();
    };
    img.onload = () => {
      try {
        let cw = img.width;
        let ch = img.height;
        if (cw / ch > aspect) cw = Math.round(ch * aspect);
        else ch = Math.round(cw / aspect);
        const sx = (img.width - cw) / 2;
        const sy = (img.height - ch) / 2;
        const scale = Math.min(1, maxH / ch);
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(cw * scale));
        cv.height = Math.max(1, Math.round(ch * scale));
        const ctx = cv.getContext('2d')!;
        ctx.drawImage(img, sx, sy, cw, ch, 0, 0, cv.width, cv.height);
        const data = cv.toDataURL('image/jpeg', quality);
        finish(() => resolve(data));
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error('compress-fail')));
      }
    };
    img.onerror = () => finish(() => reject(new Error('img-load-fail')));
    img.src = url;
  });
}

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

/** 装修面板单行选色（色卡 + 自定义 + 默认），地板/墙/门/窗共用 */
function ColorRow({
  label,
  value,
  onPick,
  fallback,
}: {
  label: string;
  value?: string;
  onPick: (hex: string | null) => void;
  fallback: string;
}) {
  const validHex = /^#[0-9a-fA-F]{6}$/.test(value ?? '');
  return (
    <div className="mb-3.5 last:mb-0">
      <div className="mb-1 text-[12.5px] font-medium text-[#6a6a6e]">{label}</div>
      <div className="mb-2 grid grid-cols-5 gap-2.5">
        {SWATCHES.map((s) => (
          <button
            key={s.hex}
            onClick={() => onPick(s.hex)}
            title={s.name}
            aria-label={`${label}选色 ${s.name}`}
            className="group flex flex-col items-center gap-1"
          >
            <span
              className={
                value === s.hex
                  ? 'h-9 w-9 rounded-full ring-2 ring-[#f2a9bc] ring-offset-2 shadow-md'
                  : 'h-9 w-9 rounded-full shadow-sm ring-1 ring-black/10 transition group-active:scale-90'
              }
              style={{ background: s.hex }}
            />
            <span className="text-[10px] text-[#8a8a86]">{s.name}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2.5">
        <label className="relative flex h-10 flex-1 cursor-pointer items-center gap-2.5 rounded-2xl bg-[#f6f4ef] px-3 ring-1 ring-[#eae7df]">
          <span
            className="h-6 w-6 rounded-lg shadow-inner ring-1 ring-black/10"
            style={{
              background: validHex
                ? value
                : 'conic-gradient(#f6cdd6,#f9e6a6,#c9e3cf,#dcd2ec,#f6cdd6)',
            }}
          />
          <span className="text-[12px] font-medium text-[#4a4a4e]">自定义{label}色</span>
          <input
            type="color"
            aria-label={`自定义${label}颜色`}
            className="absolute inset-0 cursor-pointer opacity-0"
            value={validHex ? value : fallback}
            onChange={(e) => onPick(e.target.value)}
          />
        </label>
        <button
          onClick={() => onPick(null)}
          className="flex h-10 items-center rounded-2xl bg-[#f1efe9] px-3.5 text-[12px] font-medium text-[#8a8a86] transition active:scale-95"
        >
          默认
        </button>
      </div>
    </div>
  );
}

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
/** 购买序号（同毫秒连点也保证 id 唯一 —— 商城无限添加不串档） */
let buySeq = 0;

export default function CoupleHome({ close }: { close: () => void }) {
  // ---------------- 持久化状态 ----------------
  const [pack] = useState<HomePersist>(() => loadCache() ?? { home: defaultHome(), rev: 0 });
  const [items, setItems] = useState<FurnitureItem[]>(pack.home.furniture);
  const [night, setNight] = useState<boolean>(pack.home.night);
  const [rev, setRev] = useState<number>(pack.rev);
  const [win, setWin] = useState<boolean[]>([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => !!pack.home.win?.[i]));
  const [floorCol, setFloorCol] = useState<string | undefined>(pack.home.floorCol);
  const [wallCol, setWallCol] = useState<string | undefined>(pack.home.wallCol);
  const [floorColBed, setFloorColBed] = useState<string | undefined>(pack.home.floorColBed);
  const [wallColBed, setWallColBed] = useState<string | undefined>(pack.home.wallColBed);
  const [doorOpen, setDoorOpen] = useState<boolean>(!!pack.home.doorOpen);
  const [kitchenDoorOpen, setKitchenDoorOpen] = useState<boolean>(!!pack.home.kitchenDoorOpen);
  const [doorCol, setDoorCol] = useState<string | undefined>(pack.home.doorCol);
  const [winCol, setWinCol] = useState<string | undefined>(pack.home.winCol);
  const [floorColK, setFloorColK] = useState<string | undefined>(pack.home.floorColK);
  const [wallColK, setWallColK] = useState<string | undefined>(pack.home.wallColK);
  const [floorColB, setFloorColB] = useState<string | undefined>(pack.home.floorColB);
  const [wallColB, setWallColB] = useState<string | undefined>(pack.home.wallColB);
  const [ceilCol, setCeilCol] = useState<string | undefined>(pack.home.ceilCol);
  const [ceilColBed, setCeilColBed] = useState<string | undefined>(pack.home.ceilColBed);
  const [ceilColK, setCeilColK] = useState<string | undefined>(pack.home.ceilColK);
  const [ceilColB, setCeilColB] = useState<string | undefined>(pack.home.ceilColB);
  const [bathDoorOpen, setBathDoorOpen] = useState<boolean>(!!pack.home.bathDoorOpen);
  const [winPos, setWinPos] = useState<number[] | undefined>(pack.home.winPos);
  const [doorPos, setDoorPos] = useState<{ bed: number; kt: number; bath: number } | undefined>(pack.home.doorPos);
  const [fp, setFp] = useState<boolean>(!!pack.home.fp);
  const [charStyle, setCharStyle] = useState<CharStyle>(pack.home.charStyle === 'real' ? 'real' : 'cartoon');
  const [nightAuto, setNightAuto] = useState<boolean>(pack.home.nightAuto !== false);

  // ---------------- UI 状态 ----------------
  const [mode, setMode] = useState<HomeMode>('live');
  const [selId, setSelId] = useState<string | null>(null);
  const [moveOn, setMoveOn] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [roomStyleOpen, setRoomStyleOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopTab, setShopTab] = useState<string>('all');
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [full, setFull] = useState(false);
  /** 家具互动（生活模式）：点击可坐/睡/泡的家具后弹出确认按钮 */
  const [charAction, setCharAction] = useState<{ type: 'sit' | 'lie' | 'bath'; itemId: string; active: boolean } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoTargetRef = useRef<string | null>(null);

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
  /** 小人姿势（stand/sit/lie/bath + 支撑面高度）：GameLoop / Char3D 每帧读取 */
  const poseRef = useRef<{ pose: CharPose; y: number }>({ pose: 'stand', y: 0 });
  /** 正在执行的家具动作（走向家具 → 摆姿势） */
  const actRef = useRef<CharAction | null>(null);
  /** 编辑模式缩放指令（HUD 按钮 → Canvas 内相机） */
  const zoomCmd = useRef({ v: 0, dir: 0 });
  /** 四向微调指令（HUD 方向按钮 → Canvas 内按视角方位换算） */
  const moveCmd = useRef({ v: 0, dir: 'up' as 'up' | 'down' | 'left' | 'right' });

  // ---------------- 同步 refs（快照用） ----------------
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const nightRef = useRef(night);
  nightRef.current = night;
  const revRef = useRef(rev);
  revRef.current = rev;
  const winRef = useRef(win);
  winRef.current = win;
  const floorColRef = useRef(floorCol);
  floorColRef.current = floorCol;
  const wallColRef = useRef(wallCol);
  wallColRef.current = wallCol;
  const floorColBedRef = useRef(floorColBed);
  floorColBedRef.current = floorColBed;
  const wallColBedRef = useRef(wallColBed);
  wallColBedRef.current = wallColBed;
  const doorOpenRef = useRef(doorOpen);
  doorOpenRef.current = doorOpen;
  const kitchenDoorOpenRef = useRef(kitchenDoorOpen);
  kitchenDoorOpenRef.current = kitchenDoorOpen;
  const doorColRef = useRef(doorCol);
  doorColRef.current = doorCol;
  const winColRef = useRef(winCol);
  winColRef.current = winCol;
  const floorColKRef = useRef(floorColK);
  floorColKRef.current = floorColK;
  const wallColKRef = useRef(wallColK);
  wallColKRef.current = wallColK;
  const floorColBRef = useRef(floorColB);
  floorColBRef.current = floorColB;
  const wallColBRef = useRef(wallColB);
  wallColBRef.current = wallColB;
  const ceilColRef = useRef(ceilCol);
  ceilColRef.current = ceilCol;
  const ceilColBedRef = useRef(ceilColBed);
  ceilColBedRef.current = ceilColBed;
  const ceilColKRef = useRef(ceilColK);
  ceilColKRef.current = ceilColK;
  const ceilColBRef = useRef(ceilColB);
  ceilColBRef.current = ceilColB;
  const bathDoorOpenRef = useRef(bathDoorOpen);
  bathDoorOpenRef.current = bathDoorOpen;
  const winPosRef = useRef(winPos);
  winPosRef.current = winPos;
  const doorPosRef = useRef(doorPos);
  doorPosRef.current = doorPos;
  const fpRef = useRef({ on: fp });
  useEffect(() => {
    fpRef.current.on = fp;
  }, [fp]);
  const charStyleRef = useRef(charStyle);
  charStyleRef.current = charStyle;
  const nightAutoRef = useRef(nightAuto);
  nightAutoRef.current = nightAuto;

  // ---------------- 提示 ----------------
  const toast = useCallback((msg: string) => {
    const id = ++uid;
    setToasts((t) => [...t.slice(-2), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  }, []);

  // ---------------- 快照与推送 ----------------
  const snap = useCallback((): HomePersist => {
    const home: HomeState = {
      v: 5,
      furniture: itemsRef.current,
      night: nightRef.current,
      win: winRef.current,
      winPos: winPosRef.current,
      doorPos: doorPosRef.current,
      floorCol: floorColRef.current,
      wallCol: wallColRef.current,
      floorColBed: floorColBedRef.current,
      wallColBed: wallColBedRef.current,
      floorColK: floorColKRef.current,
      wallColK: wallColKRef.current,
      floorColB: floorColBRef.current,
      wallColB: wallColBRef.current,
      ceilCol: ceilColRef.current,
      ceilColBed: ceilColBedRef.current,
      ceilColK: ceilColKRef.current,
      ceilColB: ceilColBRef.current,
      doorOpen: doorOpenRef.current,
      kitchenDoorOpen: kitchenDoorOpenRef.current,
      bathDoorOpen: bathDoorOpenRef.current,
      doorCol: doorColRef.current,
      winCol: winColRef.current,
      fp: fpRef.current.on,
      charStyle: charStyleRef.current,
      nightAuto: nightAutoRef.current,
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

  /** 采纳一份完整档案（远端冲突 / 初始化 / 重置共用） */
  const adoptHome = useCallback((h: HomeState) => {
    setItems(h.furniture);
    setNight(h.night);
    setWin([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => !!h.win?.[i]));
    setFloorCol(h.floorCol);
    setWallCol(h.wallCol);
    setFloorColBed(h.floorColBed);
    setWallColBed(h.wallColBed);
    setFloorColK(h.floorColK);
    setWallColK(h.wallColK);
    setFloorColB(h.floorColB);
    setWallColB(h.wallColB);
    setCeilCol(h.ceilCol);
    setCeilColBed(h.ceilColBed);
    setCeilColK(h.ceilColK);
    setCeilColB(h.ceilColB);
    setDoorOpen(!!h.doorOpen);
    setKitchenDoorOpen(!!h.kitchenDoorOpen);
    setBathDoorOpen(!!h.bathDoorOpen);
    setDoorCol(h.doorCol);
    setWinCol(h.winCol);
    setWinPos(h.winPos);
    setDoorPos(h.doorPos);
    setFp(!!h.fp);
    setCharStyle(h.charStyle === 'real' ? 'real' : 'cartoon');
    setNightAuto(h.nightAuto !== false);
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
        adoptHome(s.home);
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
    [toast, adoptHome],
  );

  const schedulePush = useCallback(
    (_p?: HomePersist) => {
      // ⚑ 快照在推送定时器触发时才生成（ref 渲染后已最新）：
      //   旧版在 schedulePush 调用瞬间抓快照 —— 门刚点开时 ref 还是旧值，
      //   且 2.5s 内若有一笔在途旧 rev 推送落到服务端，409 采纳会把刚开
      //   的门「回滚关闭」。现在统一在触发时取最新 ref + 最新 rev。
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        const data = snap();
        saveCache(data); // idb 节流写
        void doPush(data);
      }, 2500);
      // 快速本地落盘（setState 渲染完成后 ref 已最新，~60ms 足够）
      setTimeout(() => saveCache(snap()), 60);
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
        adoptHome(remote.home);
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

  /** 结束当前动作：站起来 / 起床 / 出浴（泡澡自动关水穿衣） */
  const endAction = useCallback(() => {
    const act = actRef.current;
    actRef.current = null;
    poseRef.current.pose = 'stand';
    poseRef.current.y = 0;
    setCharAction(null);
    if (act?.type === 'bath') {
      const it = itemsRef.current.find((f) => f.id === act.itemId);
      if (it?.st?.bathWater) {
        setItems((prev) => prev.map((f) => (f.id === act.itemId ? { ...f, st: { ...f.st, bathWater: false } } : f)));
        saveSoon();
      }
      toast('洗得香香的，穿好衣服啦');
    }
  }, [saveSoon, toast]);

  /** 开始动作：小人走向家具落点 → 摆姿势（GameLoop 驱动） */
  const beginAction = useCallback(
    (type: 'sit' | 'lie' | 'bath', item: FurnitureItem) => {
      const entry = CATALOG[item.kind];
      const a: { y: number; dx?: number; dz?: number } | undefined =
        type === 'sit' ? entry?.acts.seat : type === 'lie' ? entry?.acts.sleep : entry?.acts.bath;
      if (!a) return;
      const ry = item.ry ?? 0;
      const cos = Math.cos(ry);
      const sin = Math.sin(ry);
      const lx = a.dx ?? 0;
      const lz = a.dz ?? 0;
      actRef.current = {
        type,
        itemId: item.id,
        tx: item.x + lx * cos + lz * sin,
        tz: item.z - lx * sin + lz * cos,
        ry,
        y: a.y,
      };
      setCharAction((prev) => (prev ? { ...prev, active: true } : { type, itemId: item.id, active: true }));
      toast(type === 'sit' ? '走过去坐下咯～' : type === 'lie' ? '上床躺好，盖好被子～' : '脱掉衣服，泡澡泡起来～');
    },
    [toast],
  );

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

      // 生活模式：可坐/睡/泡的家具 → 弹出确认按钮（先结束当前姿势）
      if (entry.acts?.seat || entry.acts?.sleep || entry.acts?.bath) {
        if (poseRef.current.pose !== 'stand' || actRef.current) endAction();
        const type: 'sit' | 'lie' | 'bath' = entry.acts.bath ? 'bath' : entry.acts.sleep ? 'lie' : 'sit';
        setCharAction({ type, itemId: item.id, active: false });
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
      if (entry.acts?.photo) {
        // 相框：唤起系统相册/相机选照片（生活模式）
        photoTargetRef.current = item.id;
        fileInputRef.current?.click();
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
    [mode, saveSoon, toast, endAction],
  );

  /** 浴缸水龙头：放水 / 关水 */
  const onFaucetTap = useCallback(
    (item: FurnitureItem) => {
      const on = !item.st?.bathWater;
      setItems((prev) => prev.map((f) => (f.id === item.id ? { ...f, st: { ...f.st, bathWater: on } } : f)));
      toast(on ? '哗啦啦～热水放好咯' : '水龙头关上啦');
      saveSoon();
    },
    [saveSoon, toast],
  );

  /** 泡澡时的放水/关水按钮（浴缸 = 当前动作的家具） */
  const toggleBathWater = useCallback(() => {
    const id = charAction?.itemId;
    if (!id) return;
    setItems((prev) =>
      prev.map((f) => (f.id === id ? { ...f, st: { ...f.st, bathWater: !f.st?.bathWater } } : f)),
    );
    const on = !itemsRef.current.find((f) => f.id === id)?.st?.bathWater;
    toast(on ? '哗啦啦～热水放好咯' : '水龙头关上啦');
    saveSoon();
  }, [charAction, saveSoon, toast]);

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

  /** 四向微调：沿屏幕视觉方向移动选中目标（家具 = 一格；门窗 = 沿墙滑行） */
  const nudgeSel = useCallback(
    (dx: number, dz: number) => {
      if (!selId) return;
      // —— 门窗：沿墙滑行（只取切向分量） ——
      if (selId.startsWith('win-') || selId.startsWith('door-')) {
        const step = 0.25;
        if (selId.startsWith('win-')) {
          const i = Number(selId.slice(4));
          const w = WINS[i];
          if (!w) return;
          if (w.axis === 'z' && dx === 0) return;
          if (w.axis === 'x' && dz === 0) return;
          const cur = winPosRef.current?.[i] ?? w.def;
          const along = cur + (w.axis === 'z' ? Math.sign(dx) : Math.sign(dz)) * step;
          const r = resolveWinPos(i, along, winPosRef.current, doorPosRef.current);
          setWinPos((prev) => {
            const next = prev ? prev.slice() : WINS.map((ww) => ww.def);
            next[i] = r.along;
            return next;
          });
        } else {
          const did = selId.slice(5) as 'bed' | 'kt' | 'bath';
          const d = DOORS.find((dd) => dd.id === did);
          if (!d) return;
          if (d.axis === 'z' && dx === 0) return;
          if (d.axis === 'x' && dz === 0) return;
          const cur = doorPosRef.current?.[did] ?? d.def;
          const along = cur + (d.axis === 'z' ? Math.sign(dx) : Math.sign(dz)) * step;
          const r = resolveDoorPos(did, along, winPosRef.current, doorPosRef.current);
          setDoorPos((prev) => ({ bed: DOORS[0].def, kt: DOORS[1].def, bath: DOORS[2].def, ...prev, [did]: r.along }));
        }
        saveSoon();
        return;
      }
      // —— 家具：四房间钳位 + 吸附 ——
      setItems((prev) =>
        prev.map((f) => {
          if (f.id !== selId) return f;
          const e = CATALOG[f.kind];
          const [w, d] = e ? footprintOf(e, f.ry ?? 0) : [0.5, 0.5];
          const hw = Math.max(w / 2, 0.18);
          const hd = Math.max(d / 2, 0.18);
          const [x, z] = clampFurnToRooms(f.x + dx * SNAP, f.z + dz * SNAP, hw, hd);
          return { ...f, x, z };
        }),
      );
      saveSoon();
    },
    [selId, saveSoon],
  );

  /** 升降选中家具：抬上桌面 / 放回地面（相框、小盆栽、书堆…） */
  const liftSel = useCallback(
    (dir: 1 | -1) => {
      if (!selId) return;
      setItems((prev) =>
        prev.map((f) => {
          if (f.id !== selId) return f;
          const y = Math.round(Math.min(LIFT_MAX, Math.max(0, (f.y ?? 0) + dir * LIFT_STEP)) * 100) / 100;
          return { ...f, y };
        }),
      );
      saveSoon();
    },
    [selId, saveSoon],
  );

  /** HUD 方向按钮 → 微调指令（Canvas 内按当前视角方位换算世界轴） */
  const issueMoveCmd = useCallback((dir: 'up' | 'down' | 'left' | 'right') => {
    moveCmd.current = { v: moveCmd.current.v + 1, dir };
  }, []);

  /** 调色盘：选中目标上色 / 恢复默认（门窗选中时改全屋门窗色） */
  const applyColor = useCallback(
    (hex: string | null) => {
      if (!selId) return;
      if (selId.startsWith('win-')) {
        setWinCol(hex ?? undefined);
        saveSoon();
        return;
      }
      if (selId.startsWith('door-')) {
        setDoorCol(hex ?? undefined);
        saveSoon();
        return;
      }
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
      if (next) toast('移动模式：按住画面拖动搬运，或点方向按钮微调');
      return next;
    });
  }, [toast]);

  /** 窗户开合（生活/编辑模式均可点） */
  const toggleWin = useCallback(
    (i: number) => {
      setWin((prev) => {
        const next = prev.slice();
        next[i] = !next[i];
        return next;
      });
      saveSoon();
    },
    [saveSoon],
  );

  /** 地板/墙壁自定义色（null = 恢复默认） */
  const applyFloorCol = useCallback(
    (hex: string | null) => {
      setFloorCol(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  const applyWallCol = useCallback(
    (hex: string | null) => {
      setWallCol(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  /** 卧室地板/墙壁自定义色（客厅卧室分开换色） */
  const applyFloorColBed = useCallback(
    (hex: string | null) => {
      setFloorColBed(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  const applyWallColBed = useCallback(
    (hex: string | null) => {
      setWallColBed(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  /** 厨房地板/墙壁自定义色（三房间分开换色） */
  const applyFloorColK = useCallback(
    (hex: string | null) => {
      setFloorColK(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  const applyWallColK = useCallback(
    (hex: string | null) => {
      setWallColK(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  /** 卫生间地板/墙壁自定义色（四房间分开换色） */
  const applyFloorColB = useCallback(
    (hex: string | null) => {
      setFloorColB(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  const applyWallColB = useCallback(
    (hex: string | null) => {
      setWallColB(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  /** 天花板自定义色（四房间分开） */
  const applyCeilCol = useCallback(
    (hex: string | null) => {
      setCeilCol(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  const applyCeilColBed = useCallback(
    (hex: string | null) => {
      setCeilColBed(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  const applyCeilColK = useCallback(
    (hex: string | null) => {
      setCeilColK(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  const applyCeilColB = useCallback(
    (hex: string | null) => {
      setCeilColB(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  const applyDoorCol = useCallback(
    (hex: string | null) => {
      setDoorCol(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  const applyWinCol = useCallback(
    (hex: string | null) => {
      setWinCol(hex ?? undefined);
      saveSoon();
    },
    [saveSoon],
  );

  /** 卧室门开合（点击门本体） */
  const toggleDoor = useCallback(() => {
    setDoorOpen((o) => {
      const next = !o;
      toast(next ? '门开啦，走进去就是卧室～' : '卧室门已关上');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** 厨房门开合（点击门本体） */
  const toggleKitchenDoor = useCallback(() => {
    setKitchenDoorOpen((o) => {
      const next = !o;
      toast(next ? '厨房门开啦，里面香喷喷～' : '厨房门已关上');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** 卫生间门开合（点击门本体） */
  const toggleBathDoor = useCallback(() => {
    setBathDoorOpen((o) => {
      const next = !o;
      toast(next ? '浴室门开啦，泡泡浴准备～' : '卫生间门已关上');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** 编辑模式点选门窗（选中而非开合） */
  const onWallTap = useCallback(
    (id: string) => {
      setShopOpen(false);
      setPaletteOpen(false);
      setSelId((s) => (s === id ? null : id));
    },
    [],
  );

  /** 第一/第三人称切换 */
  const toggleFp = useCallback(() => {
    setFp((v) => {
      const next = !v;
      toast(next ? '第一人称：你就是小人本人啦～' : '第三人称：跟随视角');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

  /** 相框选照片完成：按框型裁剪 → 压缩 → 写入家具状态（永久保存） */
  const onPickPhoto = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      e.target.value = ''; // 允许重复选同一张
      const id = photoTargetRef.current;
      photoTargetRef.current = null;
      if (!f || !id) return;
      const kind = itemsRef.current.find((it) => it.id === id)?.kind ?? 'photoFrame';
      try {
        const data = await compressPhoto(f, PHOTO_ASPECTS[kind] ?? 0.714);
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, st: { ...it.st, photo: data } } : it)));
        saveSoon();
        toast('照片装进相框啦，永久保存～');
      } catch {
        toast('照片读取失败，换一张试试？');
      }
    },
    [saveSoon, toast],
  );

  /** 编辑模式画面缩放 */
  const zoom = useCallback(
    (dir: 1 | -1) => {
      zoomCmd.current = { v: zoomCmd.current.v + 1, dir };
    },
    [],
  );

  const onDragMove = useCallback((id: string, x: number, z: number) => {
    // 门窗：沿墙滑行（写入 winPos/doorPos）
    if (id.startsWith('win-')) {
      const i = Number(id.slice(4));
      const w = WINS[i];
      if (!w) return;
      const along = w.axis === 'z' ? x : z;
      setWinPos((prev) => {
        const next = prev ? prev.slice() : WINS.map((ww) => ww.def);
        next[i] = along;
        return next;
      });
      return;
    }
    if (id.startsWith('door-')) {
      const did = id.slice(5) as 'bed' | 'kt' | 'bath';
      const d = DOORS.find((dd) => dd.id === did);
      if (!d) return;
      const along = d.axis === 'z' ? x : z;
      setDoorPos((prev) => ({ bed: DOORS[0].def, kt: DOORS[1].def, bath: DOORS[2].def, ...prev, [did]: along }));
      return;
    }
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, x, z } : f)));
  }, []);

  const onDragSelect = useCallback((id: string) => {
    setSelId(id);
  }, []);

  /** 拖拽结束：家具挂墙件自动贴墙；门窗吸附到 0.05m 网格 */
  const onDragEnd = useCallback(
    (id: string) => {
      if (id.startsWith('win-')) {
        const i = Number(id.slice(4));
        const w = WINS[i];
        if (w) {
          const cur = winPosRef.current?.[i] ?? w.def;
          const r = resolveWinPos(i, Math.round(cur * 20) / 20, winPosRef.current, doorPosRef.current);
          setWinPos((prev) => {
            const next = prev ? prev.slice() : WINS.map((ww) => ww.def);
            next[i] = r.along;
            return next;
          });
        }
        saveSoon();
        return;
      }
      if (id.startsWith('door-')) {
        const did = id.slice(5) as 'bed' | 'kt' | 'bath';
        const d = DOORS.find((dd) => dd.id === did);
        if (d) {
          const cur = doorPosRef.current?.[did] ?? d.def;
          const r = resolveDoorPos(did, Math.round(cur * 20) / 20, winPosRef.current, doorPosRef.current);
          setDoorPos((prev) => ({ bed: DOORS[0].def, kt: DOORS[1].def, bath: DOORS[2].def, ...prev, [did]: r.along }));
        }
        saveSoon();
        return;
      }
      const it = itemsRef.current.find((f) => f.id === id);
      if (it && CATALOG[it.kind]?.wallMount) {
        const s = snapToWallSlot(it.x, it.z);
        const nx = s.x + Math.sin(s.slot.ry) * 0.06;
        const nz = s.z + Math.cos(s.slot.ry) * 0.06;
        setItems((prev) => prev.map((f) => (f.id === id ? { ...f, x: nx, z: nz, ry: s.slot.ry } : f)));
      }
      saveSoon();
    },
    [saveSoon],
  );

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

  /** 缩略图待生成队列（undefined = 还没处理过；空串 = 失败已跳过；稳定引用，避免工作室重复重启） */
  const thumbQueue = useMemo(
    () =>
      shopItems
        .filter((e) => thumbMap[e.kind] === undefined && !getCachedThumb(e.kind))
        .map((e) => e.kind),
    [shopItems, thumbMap],
  );

  /** 找个不太挤的落点（小人当前所在房间内） */
  const findSpot = useCallback((kind: FurnitureKind, room: RoomId): { x: number; z: number } => {
    const e = CATALOG[kind];
    const [w, d] = e.fp;
    const [x0, x1, z0, z1] = ROOM_SPANS[room];
    for (let i = 0; i < 40; i++) {
      const x = x0 + Math.random() * (x1 - x0);
      const z = z0 + Math.random() * (z1 - z0);
      const ok = itemsRef.current.every((it) => {
        const ce = CATALOG[it.kind];
        if (!ce || (it.y ?? 0) > 0.45) return true;
        const [cw, cd] = ce.fp;
        return Math.abs(it.x - x) > (w + cw) / 2 + 0.15 || Math.abs(it.z - z) > (d + cd) / 2 + 0.15;
      });
      if (ok) return { x: Math.round(x * 4) / 4, z: Math.round(z * 4) / 4 };
    }
    return { x: Math.round(((x0 + x1) / 2) * 4) / 4, z: Math.round(((z0 + z1) / 2) * 4) / 4 };
  }, []);

  /** 在指定房间找一段空墙面（避开已挂件/高家具/窗户门洞；返回贴墙坐标与朝向） */
  const findWallSpot = useCallback(
    (room: RoomId, kind: FurnitureKind): { x: number; z: number; ry: number } => {
      const e = CATALOG[kind];
      const w = e.fp[0];
      const high = (e.wallY ?? 1.45) > 0.9; // 高挂件（相框/电视）需要避让窗户/门洞
      const slots = WALL_SLOTS.filter((s) => s.room === room);
      outer: for (const s of slots.length ? slots : WALL_SLOTS) {
        for (let a = s.from + w / 2 + 0.15; a <= s.to - w / 2 - 0.15 + 0.001; a += 0.45) {
          if (high && s.avoid?.some(([a0, a1]) => a > a0 - w / 2 && a < a1 + w / 2)) continue;
          const px = s.axis === 'z' ? a : s.at;
          const pz = s.axis === 'z' ? s.at : a;
          const free = itemsRef.current.every((it) => {
            const ce = CATALOG[it.kind];
            if (!ce) return true;
            const ialong = s.axis === 'z' ? it.x : it.z;
            const idist = s.axis === 'z' ? Math.abs(it.z - s.at) : Math.abs(it.x - s.at);
            // 已挂件/高家具占位：同墙面且沿墙距离不够 → 避让
            const tallBlock = (ce.h ?? 0) > 1.05 && (it.y ?? 0) < 0.45 && idist < 0.9;
            const wallBlock = (it.y ?? 0) > 0.9 && idist < 0.55;
            if (!tallBlock && !wallBlock) return true;
            const [ow] = footprintOf(ce, it.ry ?? 0);
            return Math.abs(ialong - a) > (ow + w) / 2 + 0.25;
          });
          if (free) {
            return { x: px + Math.sin(s.ry) * 0.06, z: pz + Math.cos(s.ry) * 0.06, ry: s.ry };
          }
        }
      }
      const s = slots[0] ?? WALL_SLOTS[0];
      const a = (s.from + s.to) / 2;
      return {
        x: (s.axis === 'z' ? a : s.at) + Math.sin(s.ry) * 0.06,
        z: (s.axis === 'z' ? s.at : a) + Math.cos(s.ry) * 0.06,
        ry: s.ry,
      };
    },
    [],
  );

  /** 小人在哪个房间，新家具就添加到哪个房间（商城可无限重复购买） */
  const buy = useCallback(
    (kind: FurnitureKind) => {
      const e = CATALOG[kind];
      if (!e) return;
      const id = `${kind}-${Date.now().toString(36)}-${++buySeq}`;
      const room: RoomId = roomAt(meRT.current.x, meRT.current.z);

      if (kind === 'chandelier') {
        // 吊灯：挂当前房间天花板中央附近
        const spot = findSpot(kind, room);
        setItems((prev) => [...prev, { id, kind, x: spot.x, z: spot.z, y: WALL_H - 0.04, st: {} }]);
        toast(`吊灯挂到${ROOM_NAMES[room]}天花板啦`);
      } else if (e.wallMount || kind === 'tv') {
        // 挂墙件（相框/插座/电视）：挂到当前房间的空墙面
        const spot = findWallSpot(room, kind);
        const y = kind === 'tv' ? 1.19 : (e.wallY ?? 1.45);
        setItems((prev) => [...prev, { id, kind, x: spot.x, z: spot.z, y, ry: spot.ry, st: {} }]);
        toast(`已挂到${ROOM_NAMES[room]}墙上`);
      } else if (kind === 'aircon') {
        // 壁挂空调：挂当前房间东墙（1.85m 高，面朝西）
        const pos =
          room === 'lr'
            ? { x: 4.34, z: -1.6 }
            : room === 'br'
              ? { x: 1.39, z: 5.6 }
              : room === 'kt'
                ? { x: 7.38, z: 4.1 }
                : { x: BATH_X1 - 0.16, z: -0.8 };
        setItems((prev) => [...prev, { id, kind, x: pos.x, z: pos.z, y: 1.85, ry: -Math.PI / 2, st: {} }]);
        toast(`已挂到${ROOM_NAMES[room]}东墙`);
      } else {
        const spot = findSpot(kind, room);
        setItems((prev) => [...prev, { id, kind, x: spot.x, z: spot.z, ry: 0, st: {} }]);
        toast(`已添加「${e.name}」到${ROOM_NAMES[room]}`);
      }
      setSelId(id);
      saveSoon();
    },
    [findSpot, findWallSpot, saveSoon, toast],
  );

  const resetHome = useCallback(async () => {
    const fresh = await resetRemote();
    adoptHome(fresh.home);
    setRev(fresh.rev);
    meRT.current.x = fresh.home.chars.me.x;
    meRT.current.z = fresh.home.chars.me.z;
    taRT.current.x = fresh.home.chars.partner.x;
    taRT.current.z = fresh.home.chars.partner.z;
    setSelId(null);
    setMoveOn(false);
    setPaletteOpen(false);
    setRoomStyleOpen(false);
    toast('小家已重置');
  }, [toast, adoptHome]);

  // ---------------- 模式 / 昼夜 / 全屏 ----------------
  const switchMode = useCallback(
    (m: HomeMode) => {
      setMode(m);
      if (m === 'edit') {
        setShopOpen(true);
        // 进装修模式：结束进行中的坐/睡/泡动作
        if (actRef.current || poseRef.current.pose !== 'stand') {
          actRef.current = null;
          poseRef.current.pose = 'stand';
          setCharAction(null);
        }
      } else {
        setShopOpen(false);
        setSelId(null);
        setMoveOn(false);
        setPaletteOpen(false);
        setRoomStyleOpen(false);
      }
      saveCacheNow(snap());
      schedulePush();
    },
    [snap, schedulePush],
  );

  const toggleNight = useCallback(() => {
    // 手动切换 → 脱离真实时间自动模式
    setNightAuto(false);
    setNight((n) => !n);
    saveSoon();
  }, [saveSoon]);

  /** 昼夜跟随真实时间（19:00~6:00 算夜晚，每 30s 校对） */
  const enableAutoNight = useCallback(() => {
    setNightAuto(true);
    saveSoon();
    toast('昼夜已跟随真实时间～');
  }, [saveSoon, toast]);

  useEffect(() => {
    if (!nightAuto) return;
    const compute = () => {
      const h = new Date().getHours();
      return h >= 19 || h < 6;
    };
    setNight(compute());
    const t = setInterval(() => setNight(compute()), 30000);
    return () => clearInterval(t);
  }, [nightAuto]);

  /** 小人画风：Q版卡通 ↔ 拟真 */
  const toggleCharStyle = useCallback(() => {
    setCharStyle((s) => {
      const next = s === 'cartoon' ? 'real' : 'cartoon';
      toast(next === 'real' ? '换成拟真小人啦，还是很像你～' : '换回 Q 版卡通小人～');
      return next;
    });
    saveSoon();
  }, [saveSoon, toast]);

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
  const selItem = selId && !selId.startsWith('win-') && !selId.startsWith('door-') ? items.find((f) => f.id === selId) : null;
  const selEntry = selItem ? CATALOG[selItem.kind] : null;
  const isWallSel = !!selId && (selId.startsWith('win-') || selId.startsWith('door-'));
  const selWallName = selId?.startsWith('win-')
    ? '窗户'
    : DOORS.find((d) => selId === `door-${d.id}`)?.name ?? '';
  /** 调色盘当前值（门窗选中时对应全局门窗色） */
  const paletteVal = selId?.startsWith('win-') ? winCol : selId?.startsWith('door-') ? doorCol : selItem?.col;

  /** 操作按钮通用样式 */
  const toolBtn = 'flex h-9 w-9 items-center justify-center rounded-full transition active:scale-90';

  return (
    <div ref={rootRef} className="absolute inset-0 select-none overflow-hidden bg-[#efece4]">
      {/* 照片选择（相框用；隐藏） */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickPhoto}
      />

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
        moveCmd={moveCmd}
        onNudge={nudgeSel}
        fp={fp}
        fpRef={fpRef}
        charStyle={charStyle}
        poseRef={poseRef}
        actRef={actRef}
        onFaucetTap={onFaucetTap}
        win={win}
        onToggleWin={toggleWin}
        winPos={winPos}
        doorPos={doorPos}
        floorCol={floorCol}
        wallCol={wallCol}
        doorCol={doorCol}
        winCol={winCol}
        floorColBed={floorColBed}
        wallColBed={wallColBed}
        floorColK={floorColK}
        wallColK={wallColK}
        floorColB={floorColB}
        wallColB={wallColB}
        ceilCol={ceilCol}
        ceilColBed={ceilColBed}
        ceilColK={ceilColK}
        ceilColB={ceilColB}
        doorOpen={doorOpen}
        kitchenDoorOpen={kitchenDoorOpen}
        bathDoorOpen={bathDoorOpen}
        onToggleDoor={toggleDoor}
        onToggleKitchenDoor={toggleKitchenDoor}
        onToggleBathDoor={toggleBathDoor}
        onFloorTap={onFloorTap}
        onFurnTap={onFurnTap}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragSelect={onDragSelect}
        onWallTap={onWallTap}
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

          <div className="flex gap-2">
            <button
              onClick={toggleNight}
              aria-label={night ? '切换白天' : '切换夜晚'}
              className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#7a6a4e] shadow-sm backdrop-blur transition active:scale-95"
            >
              {night ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
            </button>
            <button
              onClick={enableAutoNight}
              aria-label="昼夜跟随真实时间"
              title="昼夜跟随真实时间（19点~6点为夜晚）"
              className={
                nightAuto
                  ? 'pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#3a3a3e]/80 text-[#ffd98f] shadow-sm backdrop-blur transition active:scale-95'
                  : 'pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#5a5a5e] shadow-sm backdrop-blur transition active:scale-95'
              }
            >
              <Clock className="h-[18px] w-[18px]" />
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

        {/* 家具互动按钮（生活模式）：坐下/睡觉/泡澡 → 站起来/起床/出来 */}
        <AnimatePresence>
          {mode === 'live' && charAction && (
            <motion.div
              key="action-bar"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-[196px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2"
            >
              {charAction.active && charAction.type === 'bath' && (
                <button
                  onClick={toggleBathWater}
                  aria-label="浴缸放水/关水"
                  className="pointer-events-auto flex h-12 items-center gap-2 whitespace-nowrap rounded-full bg-[#a8d4e6] px-5 text-[14px] font-semibold text-white shadow-lg transition active:scale-95"
                >
                  <Droplet className="h-[18px] w-[18px]" />
                  放水
                </button>
              )}
              <motion.button
                key={`${charAction.itemId}-${charAction.active}`}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ type: 'spring', damping: 24, stiffness: 340 }}
                onClick={() => {
                  if (!charAction.active) {
                    const it = itemsRef.current.find((f) => f.id === charAction.itemId);
                    if (it) beginAction(charAction.type, it);
                  } else {
                    endAction();
                  }
                }}
                className={
                  charAction.active
                    ? 'pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-[#3a3a3e]/85 px-6 text-[14px] font-semibold text-white shadow-xl backdrop-blur transition active:scale-95'
                    : 'pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-[#f4b3c2] px-6 text-[14px] font-semibold text-white shadow-lg shadow-[#f4b3c2]/40 transition active:scale-95'
                }
              >
                {charAction.type === 'sit' ? (
                  <Armchair className="h-[18px] w-[18px]" />
                ) : charAction.type === 'lie' ? (
                  <BedDouble className="h-[18px] w-[18px]" />
                ) : (
                  <Bath className="h-[18px] w-[18px]" />
                )}
                {charAction.active
                  ? charAction.type === 'sit'
                    ? '站起来'
                    : charAction.type === 'lie'
                      ? '起床'
                      : '出来啦'
                  : charAction.type === 'sit'
                    ? '坐下'
                    : charAction.type === 'lie'
                      ? '睡觉'
                      : '泡个澡'}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

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
          {/* 选中操作条（编辑模式·门窗：移动/换色，不可删除） */}
          <AnimatePresence>
            {mode === 'edit' && isWallSel && !shopOpen && !paletteOpen && (
              <motion.div
                key={selId}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                className="pointer-events-auto mx-auto mb-3 w-fit"
              >
                <div className="mx-auto mb-1.5 w-fit rounded-full bg-black/25 px-2.5 py-0.5 text-[11px] font-medium text-white/95 backdrop-blur-sm">
                  {selWallName} · 拖动或方向键沿墙移动
                </div>
                <div className="flex items-center gap-1 rounded-2xl bg-white/90 p-1.5 shadow-lg backdrop-blur">
                  {/* 四向微调（沿墙滑行） */}
                  <div className="grid grid-cols-3 grid-rows-3 gap-px rounded-xl bg-[#efece3] p-1">
                    <span />
                    <button
                      onClick={() => issueMoveCmd('up')}
                      aria-label="上移"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#8a8a86] shadow-sm transition active:scale-90 active:bg-[#dff0e2] active:text-[#3f9a58]"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <span />
                    <button
                      onClick={() => issueMoveCmd('left')}
                      aria-label="左移"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#8a8a86] shadow-sm transition active:scale-90 active:bg-[#dff0e2] active:text-[#3f9a58]"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="flex h-7 w-7 items-center justify-center text-[9px] text-[#b8b5ac]">沿墙</span>
                    <button
                      onClick={() => issueMoveCmd('right')}
                      aria-label="右移"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#8a8a86] shadow-sm transition active:scale-90 active:bg-[#dff0e2] active:text-[#3f9a58]"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <span />
                    <button
                      onClick={() => issueMoveCmd('down')}
                      aria-label="下移"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#8a8a86] shadow-sm transition active:scale-90 active:bg-[#dff0e2] active:text-[#3f9a58]"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <span />
                  </div>
                  {/* 换色 */}
                  <button
                    onClick={() => setPaletteOpen(true)}
                    aria-label="给门窗换色"
                    title="换颜色"
                    className={`${toolBtn} bg-[#f0e2ee] text-[#b07193] hover:bg-[#ead4e4]`}
                  >
                    <Droplet className="h-4 w-4" />
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

          {/* 选中操作条（编辑模式·家具） */}
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
                  {/* 移动：四向按钮 + 中央「移动模式」开关
                     （两种搬运方式：① 点上下左右逐步微调 ② 开移动模式后按住画面拖动） */}
                  <div className="grid grid-cols-3 grid-rows-3 gap-px rounded-xl bg-[#efece3] p-1">
                    <span />
                    <button
                      onClick={() => issueMoveCmd('up')}
                      aria-label="上移一格"
                      title="上移一格"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#8a8a86] shadow-sm transition active:scale-90 active:bg-[#dff0e2] active:text-[#3f9a58]"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <span />
                    <button
                      onClick={() => issueMoveCmd('left')}
                      aria-label="左移一格"
                      title="左移一格"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#8a8a86] shadow-sm transition active:scale-90 active:bg-[#dff0e2] active:text-[#3f9a58]"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={toggleMove}
                      aria-label="移动模式（按住画面拖动搬运）"
                      title="移动模式（按住画面拖动搬运）"
                      className={
                        moveOn
                          ? 'flex h-7 w-7 items-center justify-center rounded-lg bg-[#dff0e2] text-[#3f9a58] shadow-inner'
                          : 'flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#8a8a86] shadow-sm transition active:scale-90'
                      }
                    >
                      <Move className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => issueMoveCmd('right')}
                      aria-label="右移一格"
                      title="右移一格"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#8a8a86] shadow-sm transition active:scale-90 active:bg-[#dff0e2] active:text-[#3f9a58]"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <span />
                    <button
                      onClick={() => issueMoveCmd('down')}
                      aria-label="下移一格"
                      title="下移一格"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#8a8a86] shadow-sm transition active:scale-90 active:bg-[#dff0e2] active:text-[#3f9a58]"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <span />
                  </div>

                  {/* 升降：抬上桌 / 放回地（相框、小盆栽…） */}
                  <div className="grid grid-rows-2 gap-px rounded-xl bg-[#efece3] p-1">
                    <button
                      onClick={() => liftSel(1)}
                      aria-label="抬高一层（可放上桌面）"
                      title="抬高一层"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#7a8a96] shadow-sm transition active:scale-90 active:bg-[#e2edf3] active:text-[#4e7f95]"
                    >
                      <ChevronsUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => liftSel(-1)}
                      aria-label="放低一层（放回地面）"
                      title="放低一层"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#7a8a96] shadow-sm transition active:scale-90 active:bg-[#e2edf3] active:text-[#4e7f95]"
                    >
                      <ChevronsDown className="h-4 w-4" />
                    </button>
                  </div>

                  {/* 旋转：四宫格（上排 左转/右转，下排 下俯/上仰） */}
                  <div className="grid grid-cols-2 grid-rows-2 gap-px rounded-xl bg-[#efece3] p-1">
                    <button
                      onClick={() => rotateY(-1)}
                      aria-label="向左旋转 45°"
                      title="向左旋转"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#8a7a54] shadow-sm transition active:scale-90 active:bg-[#f5efe2]"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => rotateY(1)}
                      aria-label="向右旋转 45°"
                      title="向右旋转"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#8a7a54] shadow-sm transition active:scale-90 active:bg-[#f5efe2]"
                    >
                      <RotateCw className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => tilt(-1)}
                      aria-label="向下旋转 15°"
                      title="向下旋转"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#8a7a54] shadow-sm transition active:scale-90 active:bg-[#f5efe2]"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => tilt(1)}
                      aria-label="向上旋转 15°"
                      title="向上旋转"
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-[#8a7a54] shadow-sm transition active:scale-90 active:bg-[#f5efe2]"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                  </div>

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

            {/* 画风 + 模式切换 + 视角 + 商店 + 装修 */}
            <div className="pointer-events-auto flex flex-col items-end gap-2">
              {mode === 'live' && (
                <button
                  onClick={toggleCharStyle}
                  aria-label={charStyle === 'cartoon' ? '切换拟真小人' : '切换卡通小人'}
                  title={charStyle === 'cartoon' ? '换成拟真小人' : '换成 Q 版卡通小人'}
                  className="flex h-11 items-center gap-2 rounded-full bg-white/85 px-4 text-[13px] font-medium text-[#4a4a4e] shadow-md backdrop-blur transition active:scale-95"
                >
                  {charStyle === 'cartoon' ? <Baby className="h-4 w-4 text-[#e78ba4]" /> : <UserRound className="h-4 w-4 text-[#8a7a54]" />}
                  {charStyle === 'cartoon' ? '卡通小人' : '拟真小人'}
                </button>
              )}
              {mode === 'live' && (
                <button
                  onClick={toggleFp}
                  aria-label={fp ? '切换第三人称' : '切换第一人称'}
                  title={fp ? '第三人称（跟随视角）' : '第一人称（小人就是自己）'}
                  className={
                    fp
                      ? 'flex h-11 items-center gap-2 rounded-full bg-[#f2b3c2] px-4 text-[13px] font-semibold text-white shadow-md transition active:scale-95'
                      : 'flex h-11 items-center gap-2 rounded-full bg-white/85 px-4 text-[13px] font-medium text-[#4a4a4e] shadow-md backdrop-blur transition active:scale-95'
                  }
                >
                  {fp ? <Eye className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                  {fp ? '第一人称' : '第三人称'}
                </button>
              )}
              {mode === 'edit' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setRoomStyleOpen((o) => !o)}
                    className="flex h-11 items-center gap-2 rounded-full bg-white/85 px-4 text-[13px] font-medium text-[#4a4a4e] shadow-md backdrop-blur transition active:scale-95"
                  >
                    <Paintbrush className="h-4 w-4 text-[#7fa8c9]" />
                    地板墙色
                  </button>
                  <button
                    onClick={() => setShopOpen((o) => !o)}
                    className="flex h-11 items-center gap-2 rounded-full bg-white/85 px-4 text-[13px] font-medium text-[#4a4a4e] shadow-md backdrop-blur transition active:scale-95"
                  >
                    <Store className="h-4 w-4 text-[#c99a5b]" />
                    商店
                  </button>
                </div>
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

      {/* ===== 调色盘面板（编辑模式：家具 / 门窗） ===== */}
      <AnimatePresence>
        {mode === 'edit' && paletteOpen && (isWallSel || (selItem && selEntry)) && (
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
                <span className="text-[15px] font-semibold text-[#3a3a3e]">
                  {isWallSel ? `给「${selWallName}」换色` : `给「${selEntry!.name}」上色`}
                </span>
                <button
                  onClick={() => setPaletteOpen(false)}
                  aria-label="关闭调色盘"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mb-4 text-[11.5px] text-[#9a9a96]">
                {isWallSel ? '全屋门窗一起换色' : '白色为主，点缀色随心混搭'}
              </p>

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
                        paletteVal === s.hex
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
                      background: /^#[0-9a-fA-F]{6}$/.test(paletteVal ?? '')
                        ? paletteVal
                        : 'conic-gradient(#f6cdd6,#f9e6a6,#c9e3cf,#dcd2ec,#f6cdd6)',
                    }}
                  />
                  <span className="text-[12px] font-medium text-[#4a4a4e]">自定义颜色</span>
                  <input
                    type="color"
                    aria-label="自定义颜色"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    value={/^#[0-9a-fA-F]{6}$/.test(paletteVal ?? '') ? paletteVal : '#ffffff'}
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

      {/* ===== 装修面板：地板 / 墙壁 / 门 / 窗 自定义颜色 ===== */}
      <AnimatePresence>
        {mode === 'edit' && roomStyleOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/25 p-6"
            onClick={() => setRoomStyleOpen(false)}
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
                <span className="text-[15px] font-semibold text-[#3a3a3e]">装修 · 换颜色</span>
                <button
                  onClick={() => setRoomStyleOpen(false)}
                  aria-label="关闭装修面板"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0eff1] text-[#8a8a90] transition active:scale-95"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mb-3 text-[11.5px] text-[#9a9a96]">四房间 + 天花板分开换色，门窗也能换</p>

              <div className="scrollbar-none max-h-[54vh] overflow-y-auto pr-0.5">
                {/* —— 客厅 —— */}
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#f2b3c2]" />
                  <span className="text-[12px] font-semibold text-[#8a8a90]">客厅</span>
                </div>
                <ColorRow label="地板" value={floorCol} onPick={applyFloorCol} fallback="#f5f2ec" />
                <ColorRow label="墙壁" value={wallCol} onPick={applyWallCol} fallback="#f7f3ec" />
                <ColorRow label="天花板" value={ceilCol} onPick={applyCeilCol} fallback="#fbf9f3" />

                {/* —— 卧室 —— */}
                <div className="mb-2 mt-4 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#c9a8dc]" />
                  <span className="text-[12px] font-semibold text-[#8a8a90]">卧室</span>
                </div>
                <ColorRow label="地板" value={floorColBed} onPick={applyFloorColBed} fallback="#f5f2ec" />
                <ColorRow label="墙壁" value={wallColBed} onPick={applyWallColBed} fallback="#f7f3ec" />
                <ColorRow label="天花板" value={ceilColBed} onPick={applyCeilColBed} fallback="#fbf9f3" />

                {/* —— 厨房 —— */}
                <div className="mb-2 mt-4 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#e8c9a0]" />
                  <span className="text-[12px] font-semibold text-[#8a8a90]">厨房</span>
                </div>
                <ColorRow label="地板" value={floorColK} onPick={applyFloorColK} fallback="#f5f2ec" />
                <ColorRow label="墙壁" value={wallColK} onPick={applyWallColK} fallback="#f7f3ec" />
                <ColorRow label="天花板" value={ceilColK} onPick={applyCeilColK} fallback="#fbf9f3" />

                {/* —— 卫生间 —— */}
                <div className="mb-2 mt-4 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#a8d8cf]" />
                  <span className="text-[12px] font-semibold text-[#8a8a90]">卫生间</span>
                </div>
                <ColorRow label="地板" value={floorColB} onPick={applyFloorColB} fallback="#f5f2ec" />
                <ColorRow label="墙壁" value={wallColB} onPick={applyWallColB} fallback="#f7f3ec" />
                <ColorRow label="天花板" value={ceilColB} onPick={applyCeilColB} fallback="#fbf9f3" />

                {/* —— 门窗（全屋通用） —— */}
                <div className="mb-2 mt-4 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#a8c5e0]" />
                  <span className="text-[12px] font-semibold text-[#8a8a90]">门 · 窗</span>
                </div>
                <ColorRow label="门" value={doorCol} onPick={applyDoorCol} fallback="#f3efe6" />
                <ColorRow label="窗" value={winCol} onPick={applyWinCol} fallback="#f0e7d4" />
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

            {/* 商品网格（1:1 实物缩略图 + 已有数量角标；无限购买） */}
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto px-4 pb-5 pt-1">
              {shopItems.map((e) => {
                const owned = items.filter((it) => it.kind === e.kind).length;
                const thumb = thumbMap[e.kind] || getCachedThumb(e.kind);
                return (
                  <button
                    key={e.kind}
                    onClick={() => buy(e.kind)}
                    className="relative flex flex-col items-start gap-1 rounded-2xl bg-[#faf8f3] p-2 text-left shadow-sm ring-1 ring-[#efece2] transition active:scale-95"
                  >
                    {owned > 0 && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-[#f4b3c2] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white shadow-sm">
                        ×{owned}
                      </span>
                    )}
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={e.name}
                        draggable={false}
                        className="h-16 w-full rounded-xl object-contain"
                      />
                    ) : (
                      <span
                        className="h-16 w-full animate-pulse rounded-xl shadow-inner"
                        style={{ background: `linear-gradient(135deg, ${catColor(e.cat)}, ${shade(e.cat)})` }}
                      />
                    )}
                    <span className="w-full truncate text-[11.5px] font-medium leading-tight text-[#4a4a4e]">
                      {e.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 商城 1:1 缩略图工作室（隐藏离屏画布，逐件快照） */}
      {shopOpen && thumbQueue[0] && (
        <ShopThumbStudio
          kind={thumbQueue[0]}
          onThumb={(kind, url) => {
            // 失败（空串）也标记，避免死循环重试
            setThumbMap((m) => (m[kind] === url ? m : { ...m, [kind]: url }));
          }}
        />
      )}
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
  kitchen: ['#fdeccd', '#f8dfae'],
  decor: ['#e6cfae', '#dbaf87'],
};

function catColor(cat: string): string {
  return (CAT_COLORS[cat] ?? CAT_COLORS.decor)[0];
}
function shade(cat: string): string {
  return (CAT_COLORS[cat] ?? CAT_COLORS.decor)[1];
}
