'use client';

/**
 * 情侣小家（客厅篇）—— 主组件
 *
 * 架构：
 *  - 「世界」层（WORLD_W x WORLD_H）整体 translate3d 实现 camera（DOM 直改，不触发 React 渲染）；
 *    视口 = AppWindow 内容区尺寸，动态测量。
 *  - camera 两种模式：follow（lerp 跟随 me 小人）/ free（手指滑动平移，
 *    2.6 秒无操作自动回跟）。tap 空白处 = 点击寻路（小人走过去）。
 *  - 摇杆（左下）持续驱动 me 移动；partner 由轻量 AI 漫游（随机目标+慢速）。
 *  - 家具点击（交互）/ 长按（拖拽换位，网格吸附）由 Furniture 自理。
 *  - React 合规：me/partner/home 都是 state；游戏循环内函数式 setState 每帧更新，
 *    refs（meRef 等）仅在 effect/事件里同步与读取。
 *  - 家具状态 + 小人位置统一持久化到 IndexedDB（kvSetDebounced，同 couple-space 模式）。
 *  - 昼夜切换：夜晚整体调暗，灯具光晕成为视觉焦点。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Moon, Sun, RotateCcw, Info } from 'lucide-react';
import type { CharId, CharState, FurnitureItem, HomeState, Particle } from './types';
import {
  CATALOG,
  WALL,
  WALL_TOP,
  WALK_MARGIN,
  WORLD_H,
  WORLD_W,
  defaultHome,
  furnRect,
  loadHome,
  saveHome,
} from './catalog';
import Furniture from './Furniture';
import Character, { CharBadge } from './Character';
import Joystick from './Joystick';
import { WardrobePanel, WasherPanel } from './Panels';

const ME_SPEED = 240; // 摇杆驱动 px/s
const TAP_SPEED = 200; // 点击寻路 px/s
const PARTNER_SPEED = 70; // TA 漫游 px/s
const FREE_BACK_MS = 2600; // 自由视角静默多久回跟

/** pixelated 渲染常量 */
const PIX_ = 'pixelated' as const;

interface CoupleHomeProps {
  close: () => void;
}

export default function CoupleHome({ close }: CoupleHomeProps) {
  // ---------------- 状态 ----------------
  const [home, setHome] = useState<HomeState>(() => {
    const h = loadHome();
    return { furniture: h.furniture, night: h.night };
  });
  const [me, setMe] = useState<CharState>(() => loadHome().chars.me);
  const [partner, setPartner] = useState<CharState>(() => loadHome().chars.partner);
  const [night, setNight] = useState(home.night);
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [followMode, setFollowMode] = useState(true);
  const [tapMark, setTapMark] = useState<{ tx: number; ty: number } | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const camRef = useRef({ x: 0, y: 0 });
  const camModeRef = useRef<'follow' | 'free'>('follow');
  const freeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joyRef = useRef({ dx: 0, dy: 0 });
  const tapTargetRef = useRef<{ tx: number; ty: number } | null>(null);
  const partnerTargetRef = useRef<{ tx: number; ty: number } | null>(null);
  const meRef = useRef(me);
  const partnerRef = useRef(partner);
  const homeRef = useRef(home);
  const vpRef = useRef({ w: 390, h: 700 });
  const partId = useRef(1);
  const washTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitTimers = useRef<ReturnType<typeof setInterval> | null>(null);
  const partnerThink = useRef<ReturnType<typeof setTimeout> | null>(null);

  // state → ref 同步（供 rAF 循环/定时器读取最新值；合法时机写入）
  useEffect(() => {
    meRef.current = me;
  }, [me]);
  useEffect(() => {
    partnerRef.current = partner;
  }, [partner]);
  useEffect(() => {
    homeRef.current = home;
  }, [home]);

  /** 持久化快照（合并 refs 的最新位置） */
  const snapshot = useCallback((): HomeState => {
    return {
      furniture: homeRef.current.furniture,
      night,
      chars: { me: meRef.current, partner: partnerRef.current },
    };
  }, [night]);

  // ---------------- 工具 ----------------
  const showToast = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
  }, []);

  const emit = useCallback((x: number, y: number, emoji: string) => {
    const p: Particle = { id: partId.current++, x, y, emoji, seed: Math.random() };
    setParticles((arr) => [...arr.slice(-24), p]);
    setTimeout(() => {
      setParticles((arr) => arr.filter((q) => q.id !== p.id));
    }, 1500);
  }, []);

  const clampWalk = useCallback((x: number, y: number): { x: number; y: number } => {
    const minX = WALL + WALK_MARGIN;
    const maxX = WORLD_W - WALL - WALK_MARGIN;
    const minY = WALL_TOP + WALK_MARGIN;
    const maxY = WORLD_H - WALK_MARGIN;
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    };
  }, []);

  /** 家具碰撞（简单推出：脚部陷入矩形则沿最短边推出；地毯/小件忽略） */
  const collide = useCallback((x: number, y: number, self: CharId): { x: number; y: number } => {
    let px = x;
    let py = y;
    for (const f of homeRef.current.furniture) {
      const c = CATALOG[f.kind];
      if (!c || c.zBias) continue; // 地毯不挡路
      if (f.kind === 'pillow' || f.kind === 'books' || f.kind === 'chair') continue; // 小件可跨
      const r = furnRect(f);
      // 只挡「脚」以下区域（家具上半身可以遮住人 = 站家具后面）
      const m = 6;
      if (px > r.x - m && px < r.x + r.w + m && py > r.y + r.h * 0.45 && py < r.y + r.h + m) {
        const left = px - (r.x - m);
        const right = r.x + r.w + m - px;
        const top = py - (r.y + r.h * 0.45);
        const bottom = r.y + r.h + m - py;
        const min = Math.min(left, right, top, bottom);
        if (min === left) px = r.x - m;
        else if (min === right) px = r.x + r.w + m;
        else if (min === top) py = r.y + r.h * 0.45;
        else py = r.y + r.h + m;
        if (self === 'partner') partnerTargetRef.current = null; // TA 撞到就换个目标
      }
    }
    return clampWalk(px, py);
  }, [clampWalk]);

  // ---------------- 视口测量 ----------------
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => {
      vpRef.current = { w: vp.clientWidth, h: vp.clientHeight };
    });
    ro.observe(vp);
    vpRef.current = { w: vp.clientWidth, h: vp.clientHeight };
    return () => ro.disconnect();
  }, []);

  const clampCam = useCallback((x: number, y: number) => {
    const { w, h } = vpRef.current;
    return {
      x: Math.min(Math.max(0, x), Math.max(0, WORLD_W - w)),
      y: Math.min(Math.max(0, y), Math.max(0, WORLD_H - h)),
    };
  }, []);

  /** 开场把 camera 立即对准小人 */
  useEffect(() => {
    const { x, y } = clampCam(
      meRef.current.x - vpRef.current.w / 2,
      meRef.current.y - vpRef.current.h * 0.62,
    );
    camRef.current = { x, y };
  }, [clampCam]);

  // ---------------- 主游戏循环 ----------------
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;

      // -- me：摇杆 or 点击寻路 --
      const j = joyRef.current;
      const mag = Math.hypot(j.dx, j.dy);
      if (mag > 0.14) {
        tapTargetRef.current = null;
        setTapMark(null);
        setMe((prev) => {
          const nx = prev.x + j.dx * ME_SPEED * dt;
          const ny = prev.y + j.dy * ME_SPEED * dt;
          const p = collide(nx, ny, 'me');
          const dir: CharState['dir'] =
            Math.abs(j.dx) > 0.06 ? (j.dx < 0 ? 'left' : 'right') : prev.dir;
          if (p.x === prev.x && p.y === prev.y && prev.moving && dir === prev.dir) return prev;
          return { ...prev, x: p.x, y: p.y, dir, moving: true };
        });
      } else if (tapTargetRef.current) {
        const { tx, ty } = tapTargetRef.current;
        setMe((prev) => {
          const dx = tx - prev.x;
          const dy = ty - prev.y;
          const d = Math.hypot(dx, dy);
          if (d < 8) {
            tapTargetRef.current = null;
            setTapMark(null);
            return { ...prev, moving: false };
          }
          const nx = prev.x + (dx / d) * TAP_SPEED * dt;
          const ny = prev.y + (dy / d) * TAP_SPEED * dt;
          const p = collide(nx, ny, 'me');
          return { ...prev, x: p.x, y: p.y, dir: dx < 0 ? 'left' : 'right', moving: true };
        });
      } else {
        setMe((prev) => (prev.moving ? { ...prev, moving: false } : prev));
      }

      // -- partner 漫游 --
      const tgt = partnerTargetRef.current;
      if (tgt) {
        setPartner((prev) => {
          const dx = tgt.tx - prev.x;
          const dy = tgt.ty - prev.y;
          const d = Math.hypot(dx, dy);
          if (d < 10) {
            partnerTargetRef.current = null;
            return { ...prev, moving: false };
          }
          const nx = prev.x + (dx / d) * PARTNER_SPEED * dt;
          const ny = prev.y + (dy / d) * PARTNER_SPEED * dt;
          const p = clampWalk(nx, ny);
          return { ...prev, x: p.x, y: p.y, dir: dx < 0 ? 'left' : 'right', moving: true };
        });
      } else {
        setPartner((prev) => (prev.moving ? { ...prev, moving: false } : prev));
      }

      // -- camera（DOM 直改 transform，不经 React）--
      if (camModeRef.current === 'follow') {
        const target = clampCam(
          meRef.current.x - vpRef.current.w / 2,
          meRef.current.y - vpRef.current.h * 0.62,
        );
        const k = 1 - Math.pow(0.0018, dt); // 帧率无关的平滑
        camRef.current = {
          x: camRef.current.x + (target.x - camRef.current.x) * k,
          y: camRef.current.y + (target.y - camRef.current.y) * k,
        };
      }
      const wr = worldRef.current;
      if (wr) {
        wr.style.transform = `translate3d(${-Math.round(camRef.current.x)}px, ${-Math.round(
          camRef.current.y,
        )}px, 0)`;
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clampCam, clampWalk, collide]);

  // 低频持久化
  useEffect(() => {
    const id = setInterval(() => saveHome(snapshot()), 1500);
    return () => clearInterval(id);
  }, [snapshot]);

  // ---------------- partner AI 漫游决策 ----------------
  useEffect(() => {
    const think = () => {
      // 1/3 概率走到某件家具旁「互动」（冒爱心），否则随机逛
      if (Math.random() < 0.33) {
        const fs = homeRef.current.furniture;
        const f = fs[Math.floor(Math.random() * fs.length)];
        if (f) {
          partnerTargetRef.current = { tx: f.x + (Math.random() > 0.5 ? 70 : -70), ty: f.y + 20 };
          emit(f.x, f.y - 40, '💗');
        }
      } else {
        partnerTargetRef.current = {
          tx: WALL + WALK_MARGIN + Math.random() * (WORLD_W - 2 * (WALL + WALK_MARGIN)),
          ty: WALL_TOP + WALK_MARGIN + Math.random() * (WORLD_H - WALL_TOP - 2 * WALK_MARGIN),
        };
      }
      partnerThink.current = setTimeout(think, 4200 + Math.random() * 4200);
    };
    partnerThink.current = setTimeout(think, 2000);
    return () => {
      if (partnerThink.current) clearTimeout(partnerThink.current);
    };
  }, [emit]);

  // ---------------- 电视/洗衣机运转粒子周期 ----------------
  useEffect(() => {
    const id = setInterval(() => {
      const h = homeRef.current;
      const tv = h.furniture.find((f) => f.kind === 'tv' && f.st.on);
      if (tv) emit(tv.x + (Math.random() - 0.5) * 60, tv.y - 10, Math.random() > 0.5 ? '🎵' : '🎶');
      const wa = h.furniture.find((f) => f.kind === 'washer' && f.st.washing);
      if (wa) emit(wa.x + (Math.random() - 0.5) * 30, wa.y - 30, Math.random() > 0.5 ? '🫧' : '💧');
    }, 1400);
    return () => clearInterval(id);
  }, [emit]);

  // 洗衣机完成检查（面板关闭也能洗完）
  useEffect(() => {
    const id = setInterval(() => {
      const wa = homeRef.current.furniture.find((f) => f.kind === 'washer' && f.st.washing);
      if (wa && wa.st.washStart && Date.now() - wa.st.washStart > 8000) {
        setHome((h) => ({
          ...h,
          furniture: h.furniture.map((f) =>
            f.id === wa.id ? { ...f, st: { ...f.st, washing: false, washDone: true } } : f,
          ),
        }));
        showToast('🫧 洗衣机把衣服洗好啦！去取出来吧～');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [showToast]);

  // 卸载清理 + 最后一次保存
  useEffect(() => {
    return () => {
      if (washTimer.current) clearTimeout(washTimer.current);
      if (emitTimers.current) clearInterval(emitTimers.current);
      if (partnerThink.current) clearTimeout(partnerThink.current);
      if (freeTimer.current) clearTimeout(freeTimer.current);
      saveHome({
        furniture: homeRef.current.furniture,
        night,
        chars: { me: meRef.current, partner: partnerRef.current },
      });
    };
  }, [night]);

  // ---------------- 场景手势（tap 寻路 / pan 视角） ----------------
  const panRef = useRef({ x: 0, y: 0, camx: 0, camy: 0, active: false, moved: false, t0: 0 });

  const onSceneDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* 非活跃指针安全忽略 */
    }
    panRef.current = {
      x: e.clientX,
      y: e.clientY,
      camx: camRef.current.x,
      camy: camRef.current.y,
      active: true,
      moved: false,
      t0: Date.now(),
    };
  };

  const onSceneMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = panRef.current;
    if (!p.active) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) > 10) {
      p.moved = true;
      camModeRef.current = 'free';
      setFollowMode(false);
      if (freeTimer.current) clearTimeout(freeTimer.current);
    }
    if (p.moved) {
      camRef.current = clampCam(p.camx - dx, p.camy - dy);
    }
  };

  const onSceneUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* 非活跃指针安全忽略 */
    }
    const p = panRef.current;
    p.active = false;
    if (!p.moved) {
      // tap：点击寻路（把小人派过去）
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect && Date.now() - p.t0 < 420) {
        const wx = e.clientX - rect.left + camRef.current.x;
        const wy = e.clientY - rect.top + camRef.current.y;
        const t = clampWalk(wx, wy);
        tapTargetRef.current = { tx: t.x, ty: t.y };
        setTapMark({ tx: t.x, ty: t.y });
      }
    } else {
      // pan 结束 → 静默 2.6s 后回到跟随
      if (freeTimer.current) clearTimeout(freeTimer.current);
      freeTimer.current = setTimeout(() => {
        camModeRef.current = 'follow';
        setFollowMode(true);
      }, FREE_BACK_MS);
    }
  };

  // ---------------- 家具交互 ----------------
  const onInteract = useCallback(
    (f: FurnitureItem) => {
      const c = CATALOG[f.kind];
      const isWardrobe = f.kind === 'wardrobe';
      const isWasher = f.kind === 'washer';
      const isBox = f.kind === 'box';
      setHome((h) => ({
        ...h,
        furniture: h.furniture.map((it) => {
          if (it.id !== f.id) return it;
          const st = { ...it.st };
          if (c.acts.toggle) {
            st.on = !st.on;
            if (st.on) emit(it.x, it.y - 30, f.kind === 'tv' ? '🎵' : '✨');
          } else if (isWardrobe || isBox) {
            st.open = !st.open;
            if (isBox) emit(it.x, it.y - 30, st.open ? '📦' : '✨');
          }
          return { ...it, st };
        }),
      }));
      if (isWardrobe) {
        // 开门同时开面板；关门同时收面板
        const willOpen = !f.st.open;
        setOpenPanel(willOpen ? f.id : null);
      } else if (isWasher) {
        setOpenPanel(f.id);
      } else if (c.quips?.length) {
        showToast(c.quips[Math.floor(Math.random() * c.quips.length)]);
      } else if (c.acts.toggle) {
        showToast(
          f.kind === 'tv'
            ? f.st.on
              ? '电视关掉了 📺'
              : '电视打开啦 📺'
            : f.st.on
              ? '关灯了 💡'
              : '开灯了 💡',
        );
      }
    },
    [emit, showToast],
  );

  const onFurnMove = useCallback(
    (f: FurnitureItem, x: number, y: number) => {
      const r = furnRect({ ...f, x, y });
      const nx = Math.min(Math.max(WALL + r.w / 2, x), WORLD_W - WALL - r.w / 2);
      const ny = Math.min(Math.max(WALL_TOP + r.h, y), WORLD_H - 8);
      setHome((h) => ({
        ...h,
        furniture: h.furniture.map((it) => (it.id === f.id ? { ...it, x: nx, y: ny } : it)),
      }));
      showToast('摆好啦 ✨ 家具位置已保存');
    },
    [showToast],
  );

  const onDragStart = useCallback(() => {
    // 拖家具时暂停 camera 跟随，避免视口漂移干扰
    camModeRef.current = 'free';
    if (freeTimer.current) clearTimeout(freeTimer.current);
    freeTimer.current = setTimeout(() => {
      camModeRef.current = 'follow';
      setFollowMode(true);
    }, FREE_BACK_MS);
  }, []);

  // 衣橱：送洗
  const onSendWash = useCallback(
    (clothId: string) => {
      setHome((h) => ({
        ...h,
        furniture: h.furniture.map((f) => {
          if (f.kind === 'wardrobe') {
            return {
              ...f,
              st: { ...f.st, clothes: (f.st.clothes ?? []).filter((c) => c !== clothId) },
            };
          }
          if (f.kind === 'washer') {
            return { ...f, st: { ...f.st, clothes: [...(f.st.clothes ?? []), clothId] } };
          }
          return f;
        }),
      }));
      showToast('放进洗衣机了 🫧 可以启动洗衣咯');
    },
    [showToast],
  );

  // 洗衣机：启动 / 取出
  const startWash = useCallback(() => {
    setHome((h) => ({
      ...h,
      furniture: h.furniture.map((f) =>
        f.kind === 'washer'
          ? { ...f, st: { ...f.st, washing: true, washStart: Date.now(), washDone: false } }
          : f,
      ),
    }));
    showToast('启动！咕嘟咕嘟～ 🫧');
  }, [showToast]);

  const takeWash = useCallback(() => {
    let clothes: string[] = [];
    setHome((h) => ({
      ...h,
      furniture: h.furniture.map((f) => {
        if (f.kind === 'washer') {
          clothes = f.st.clothes ?? [];
          return { ...f, st: { ...f.st, clothes: [], washDone: false, washing: false } };
        }
        if (f.kind === 'wardrobe') {
          return { ...f, st: { ...f.st, clothes: [...(f.st.clothes ?? []), ...clothes] } };
        }
        return f;
      }),
    }));
    setOpenPanel(null);
    showToast('衣服回到衣橱啦 ✨ 香喷喷的～');
  }, [showToast]);

  // 昼夜 / 重置
  const toggleNight = useCallback(() => {
    const next = !night;
    setNight(next);
    setHome((h) => ({ ...h, night: next }));
    showToast(next ? '夜幕降临 🌙 开灯试试～' : '天亮了 ☀️');
  }, [night, showToast]);

  const resetLayout = useCallback(() => {
    const fresh = defaultHome();
    setHome({ furniture: fresh.furniture, night: false });
    setNight(false);
    setMe(fresh.chars.me);
    setPartner(fresh.chars.partner);
    meRef.current = fresh.chars.me;
    partnerRef.current = fresh.chars.partner;
    showToast('布局已重置 ♻️');
  }, [showToast]);

  // ---------------- 首次提示 ----------------
  useEffect(() => {
    const seen = sessionStorage.getItem('couple-home-hint');
    if (seen) return;
    sessionStorage.setItem('couple-home-hint', '1');
    const id = setTimeout(() => {
      showToast('🎮 左下摇杆移动 · 点家具互动 · 长按家具拖拽换位 · 滑动屏幕看房间');
    }, 900);
    return () => clearTimeout(id);
  }, [showToast]);

  const wardrobe = useMemo(
    () => home.furniture.find((f) => f.id === openPanel && f.kind === 'wardrobe'),
    [home, openPanel],
  );
  const washer = useMemo(
    () => home.furniture.find((f) => f.id === openPanel && f.kind === 'washer'),
    [home, openPanel],
  );

  return (
    <div className="flex h-full flex-col bg-[#20242c]">
      {/* 顶栏 */}
      <div className="shrink-0 bg-[#f6f6f8]/95 pt-[54px] backdrop-blur-md">
        <div className="relative flex h-11 items-center px-1.5">
          <button
            type="button"
            onClick={close}
            aria-label="返回"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#3a3a40] transition-opacity active:opacity-50"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[16px] font-bold">
            情侣小家 · 客厅
          </div>
          <div className="ml-auto flex items-center gap-1 pr-1.5">
            <button
              type="button"
              onClick={toggleNight}
              aria-label="切换昼夜"
              onPointerDown={(e) => e.stopPropagation()}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#5a5a62] transition-colors active:bg-black/0.06"
            >
              {night ? (
                <Moon className="h-5 w-5 text-[#4a6a9c]" />
              ) : (
                <Sun className="h-5 w-5 text-[#d9a520]" />
              )}
            </button>
            <button
              type="button"
              onClick={resetLayout}
              aria-label="重置布局"
              onPointerDown={(e) => e.stopPropagation()}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#5a5a62] transition-colors active:bg-black/0.06"
            >
              <RotateCcw className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </div>

      {/* 场景视口 */}
      <div
        ref={viewportRef}
        className="relative flex-1 touch-none overflow-hidden"
        onPointerDown={onSceneDown}
        onPointerMove={onSceneMove}
        onPointerUp={onSceneUp}
        onPointerCancel={onSceneUp}
        style={{ background: '#20242c' }}
      >
        {/* 世界 */}
        <div
          ref={worldRef}
          className="absolute left-0 top-0 will-change-transform"
          style={{ width: WORLD_W, height: WORLD_H }}
        >
          {/* 地板（Kenney floorFull 平铺，木地板暖色化） */}
          <div
            className="absolute"
            style={{
              left: WALL,
              top: WALL_TOP,
              width: WORLD_W - 2 * WALL,
              height: WORLD_H - WALL_TOP,
              backgroundImage: 'url(/home/furniture/floorFull.png)',
              backgroundSize: '152px 152px',
              imageRendering: PIX_,
              filter: 'saturate(1.12) sepia(0.12) hue-rotate(-6deg) brightness(1.02)',
            }}
          />
          {/* 顶墙 */}
          <div
            className="absolute"
            style={{
              left: 0,
              top: 0,
              width: WORLD_W,
              height: WALL_TOP,
              background:
                'linear-gradient(180deg, #efe7d8 0%, #e8dece 40%, #ddd2c0 82%, #c9bda8 100%)',
            }}
          >
            {/* 墙上窗户（两扇） */}
            {[300, 640].map((wx) => (
              <img
                key={wx}
                src="/home/furniture/wallWindow.png"
                alt=""
                draggable={false}
                className="absolute"
                style={{ left: wx, top: 42, width: 190, imageRendering: PIX_ }}
              />
            ))}
          </div>
          {/* 左右墙 */}
          <div
            className="absolute"
            style={{ left: 0, top: 0, width: WALL, height: WORLD_H, background: '#ddd2c0' }}
          />
          <div
            className="absolute"
            style={{
              left: WORLD_W - WALL,
              top: 0,
              width: WALL,
              height: WORLD_H,
              background: '#ddd2c0',
            }}
          />
          {/* 底墙 */}
          <div
            className="absolute"
            style={{
              left: 0,
              top: WORLD_H - 10,
              width: WORLD_W,
              height: 10,
              background: '#c9bda8',
            }}
          />

          {/* 家具 */}
          {home.furniture.map((f) => (
            <Furniture
              key={f.id}
              f={f}
              night={night}
              camRef={camRef}
              onInteract={onInteract}
              onMove={onFurnMove}
              onEmit={(ff, emoji) => emit(ff.x, ff.y - 40, emoji)}
              onDragStart={onDragStart}
            />
          ))}

          {/* 小人（me / partner） */}
          <Character ch={me} />
          <Character ch={partner} />
          <CharBadge ch={me} label="我" />
          <CharBadge ch={partner} label="TA" />

          {/* 点击寻路落点标记 */}
          <AnimatePresence>
            {tapMark && (
              <motion.div
                key="tap"
                className="pointer-events-none absolute"
                style={{ left: tapMark.tx, top: tapMark.ty, zIndex: 9050 }}
                initial={{ scale: 0.4, opacity: 0.9 }}
                animate={{ scale: 1, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
              >
                <div
                  className="-translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    width: 30,
                    height: 30,
                    border: '3px solid rgba(226,106,150,0.9)',
                    background: 'rgba(226,106,150,0.25)',
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* 粒子 */}
          <AnimatePresence>
            {particles.map((p) => (
              <motion.div
                key={p.id}
                className="pointer-events-none absolute select-none text-[20px]"
                style={{ left: p.x, top: p.y, zIndex: 9600 }}
                initial={{ y: 0, opacity: 0, scale: 0.6 }}
                animate={{
                  y: -70 - p.seed * 40,
                  x: Math.sin(p.seed * 6.28) * 26,
                  opacity: [0, 1, 1, 0],
                  scale: 1,
                }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.4, ease: 'easeOut' }}
              >
                {p.emoji}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* 夜晚滤镜 */}
        <AnimatePresence>
          {night && (
            <motion.div
              key="night"
              className="pointer-events-none absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              style={{
                background:
                  'linear-gradient(180deg, rgba(24,34,58,0.52), rgba(18,26,46,0.6) 55%, rgba(14,20,38,0.66))',
                mixBlendMode: 'multiply',
                zIndex: 9100,
              }}
            />
          )}
        </AnimatePresence>

        {/* 视角模式指示 */}
        {!followMode && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              camModeRef.current = 'follow';
              setFollowMode(true);
            }}
            className="absolute right-3 top-3 z-[9520] flex items-center gap-1 rounded-full bg-black/45 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm"
          >
            <Info className="h-3.5 w-3.5" /> 自由视角 · 点我回到TA身边
          </button>
        )}

        {/* 摇杆（左下，玻璃质感） */}
        <div className="absolute bottom-5 left-4 z-[9530]">
          <Joystick onVec={(dx, dy) => (joyRef.current = { dx, dy })} />
        </div>

        {/* 底部交互面板 */}
        {wardrobe && (
          <WardrobePanel f={wardrobe} onClose={() => setOpenPanel(null)} onSendWash={onSendWash} />
        )}
        {washer && (
          <WasherPanel
            f={washer}
            onClose={() => setOpenPanel(null)}
            onStart={startWash}
            onTake={takeWash}
          />
        )}

        {/* toast */}
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              className="pointer-events-none absolute left-1/2 z-[9540] w-[86%] -translate-x-1/2"
              style={{ top: 12 }}
              initial={{ y: -16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="rounded-2xl bg-black/62 px-4 py-2.5 text-center text-[13px] font-medium text-white shadow-xl backdrop-blur-md">
                {toast.text}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
