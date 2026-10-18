'use client';

/**
 * 情侣小家（2.5D 卡通写实版）—— 主组件
 *
 * 视觉：AI 生成 Adorable Home 式贴图 + CSS 房间（背景墙/木地板/窗/门/墙饰）
 * 模式：
 *  - live 生活模式：虚拟摇杆操控小人，镜头平滑跟随（小人约在屏幕 58% 高度，
 *    走远看背影、走近看正面，天然「第一人称跟随」手感）；拖地板可自由观察，2.6s 后回跟；
 *    点击家具交互（灯/电视/唱机开关、衣橱/冰箱/纸箱开门、洗衣机流程、玩伴家具赚金币）
 *  - edit 编辑模式：上帝视角（zoom 0.62）+ 网格；点选家具（绿框+浮动按钮），
 *    按住即可拖动整理；底部商店（分类 + 金币购买）；昼夜切换；重置布局
 * 持久化：IndexedDB 即时缓存 + Prisma（/api/couple-home，乐观并发 rev），防抖自动保存
 * 全屏：Maximize 按钮调用 Fullscreen API
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Moon, Sun, Maximize, Minimize, Hammer, Coins, RotateCcw, Check,
} from 'lucide-react';
import type { CharState, FurnitureItem, Particle } from './types';
import {
  CATALOG, SHOP_TABS, WALL_BOTTOM, WALK_MARGIN, WORLD_H, WORLD_W,
  defaultHome, loadCache, saveCache, saveCacheNow, fetchRemote, pushRemote, resetRemote,
} from './catalog';
import type { HomePersist } from './catalog';
import { cam, view, setZoom, measureView, viewW, viewH } from './camState';
import Furniture from './Furniture';
import Character from './Character';
import Joystick from './Joystick';
import { WardrobePanel, WasherPanel } from './Panels';

const ME_SPEED = 300; // 摇杆速度 px/s
const PARTNER_SPEED = 62; // TA 漫游速度
const FREE_BACK_MS = 2600; // 自由视角静默回跟
const WASH_MS = 8000; // 洗衣时长
const ZOOM_EDIT = 0.62; // 编辑模式上帝视角
const ZOOM_LIVE = 1;
const FOLLOW_Y = 0.58; // 小人在屏幕高度的位置（第一人称跟随感）
const HINT_KEY = 'couple-home-hinted';

/** 灯/电视光源的世界偏移（LightingLayer 用；按 kind 微调光心位置） */
const GLOW_DY: Record<string, number> = {
  lampFloor: 105,
  lampTable: 42,
  tv: 70,
  recordPlayer: 34,
};

interface CoupleHomeProps {
  close: () => void;
}

function initialPersist(): HomePersist {
  const c = loadCache();
  return c ?? { home: defaultHome(), coins: 600, rev: 0 };
}

export default function CoupleHome({ close }: CoupleHomeProps) {
  // ---------------- 状态 ----------------
  const [persist, setPersist] = useState<HomePersist>(initialPersist);
  const home = persist.home;
  const coins = persist.coins;

  const [mode, setMode] = useState<'live' | 'edit'>('live');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [panel, setPanel] = useState<{ kind: 'wardrobe' | 'washer'; id: string } | null>(null);
  const [toast, setToast] = useState<{ text: string; t: number } | null>(null);
  const [savedFlash, setSavedFlash] = useState(0);
  const [fullscr, setFullscr] = useState(false);
  const [shopTab, setShopTab] = useState<(typeof SHOP_TABS)[number]['key']>('all');
  const [resetArmed, setResetArmed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [hinted, setHinted] = useState(true);
  const [charsView, setCharsView] = useState<{
    me: CharState;
    partner: CharState;
  }>(() => ({
    me: { id: 'me', ...initialPersistView().me },
    partner: { id: 'partner', ...initialPersistView().partner },
  }));

  // ---------------- refs（游戏循环专用，绕开闭包） ----------------
  const rootRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const meRef = useRef<CharState>(charsView.me);
  const partnerRef = useRef<CharState>(charsView.partner);
  const partnerTarget = useRef<{ x: number; y: number } | null>(null);
  const partnerWait = useRef(0);
  const joy = JOY;
  const keys = useRef<Record<string, boolean>>({});
  const freeUntil = useRef(0);
  const zoomTarget = useRef(ZOOM_LIVE);
  const zoomCur = useRef(ZOOM_LIVE);
  const raf = useRef(0);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const particleSeq = useRef(0);
  const lastSavedChars = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  const showToast = useCallback((text: string) => {
    setToast({ text, t: Date.now() });
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  /** 保存（小人位置快照随行；防抖写缓存 + 推服务端） */
  const updatePersist = useCallback(
    (next: HomePersist) => {
      const withChars: HomePersist = {
        ...next,
        home: {
          ...next.home,
          chars: {
            me: { x: meRef.current.x, y: meRef.current.y, dir: meRef.current.dir },
            partner: { x: partnerRef.current.x, y: partnerRef.current.y, dir: partnerRef.current.dir },
          },
        },
      };
      setPersist(withChars);
      persistRef.current = withChars;
      saveCache(withChars);
      lastSavedChars.current = {
        mx: meRef.current.x,
        my: meRef.current.y,
        px: partnerRef.current.x,
        py: partnerRef.current.y,
      };
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(async () => {
        const res = await pushRemote(persistRef.current);
        if (res === 'conflict-none') return;
        if (res === 'conflict') {
          setPersist(res);
          persistRef.current = res;
          saveCacheNow(res);
          meRef.current = { id: 'me', ...res.home.chars.me };
          partnerRef.current = { id: 'partner', ...res.home.chars.partner };
          showToast('已同步为最新的家数据～');
          return;
        }
        persistRef.current = res; // 仅更新 rev
        setPersist(res);
        setSavedFlash(Date.now());
      }, 1200);
    },
    [showToast],
  );

  // ---------------- 启动：服务端对账 + 首次提示 ----------------
  useEffect(() => {
    let alive = true;
    try {
      setHinted(Boolean(window.localStorage.getItem(HINT_KEY)));
    } catch {
      setHinted(false);
    }
    (async () => {
      const remote = await fetchRemote();
      if (!alive) return;
      if (remote) {
        setPersist(remote);
        persistRef.current = remote;
        saveCacheNow(remote);
        meRef.current = { id: 'me', ...remote.home.chars.me };
        partnerRef.current = { id: 'partner', ...remote.home.chars.partner };
        setCharsView({ me: { ...meRef.current }, partner: { ...partnerRef.current } });
      } else {
        const seeded: HomePersist = { home: defaultHome(), coins: 600, rev: 0 };
        setPersist(seeded);
        persistRef.current = seeded;
        saveCacheNow(seeded);
        meRef.current = { id: 'me', ...seeded.home.chars.me };
        partnerRef.current = { id: 'partner', ...seeded.home.chars.partner };
        setCharsView({ me: { ...meRef.current }, partner: { ...partnerRef.current } });
        pushRemote(seeded).then((r) => {
          if (r !== 'conflict-none' && r !== 'conflict' && alive) {
            persistRef.current = r;
            setPersist(r);
          }
        });
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
      if (pushTimer.current) clearTimeout(pushTimer.current);
      // 卸载兜底：最后一次快照落盘
      const p = persistRef.current;
      saveCacheNow({
        ...p,
        home: {
          ...p.home,
          chars: {
            me: { x: meRef.current.x, y: meRef.current.y, dir: meRef.current.dir },
            partner: { x: partnerRef.current.x, y: partnerRef.current.y, dir: partnerRef.current.dir },
          },
        },
      });
    };
  }, []);

  // ---------------- 视口测量 + 全屏监听 ----------------
  useEffect(() => {
    const measure = () => measureView(rootRef.current);
    measure();
    window.addEventListener('resize', measure);
    const onFs = () => {
      setFullscr(Boolean(document.fullscreenElement));
      setTimeout(measure, 300);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('resize', measure);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  // ---------------- 键盘（桌面友好） ----------------
  useEffect(() => {
    const KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (KEYS.has(k)) {
        keys.current[k] = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ---------------- 游戏循环 ----------------
  useEffect(() => {
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const vw = viewW();
      const vh = viewH();

      // --- 我：摇杆 + 键盘 ---
      let dx = joy.current.dx;
      let dy = joy.current.dy;
      const k = keys.current;
      if (k['w'] || k['arrowup']) dy -= 1;
      if (k['s'] || k['arrowdown']) dy += 1;
      if (k['a'] || k['arrowleft']) dx -= 1;
      if (k['d'] || k['arrowright']) dx += 1;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      const me = meRef.current;
      if (mode === 'live' && len > 0.16) {
        const spd = ME_SPEED * dt;
        me.x = Math.max(WALK_MARGIN, Math.min(WORLD_W - WALK_MARGIN, me.x + dx * spd));
        me.y = Math.max(WALL_BOTTOM + 60, Math.min(WORLD_H - 40, me.y + dy * spd));
        me.moving = true;
        if (Math.abs(dy) > Math.abs(dx)) me.dir = dy < 0 ? 'up' : 'down';
        else me.dir = dx < 0 ? 'left' : 'right';
      } else {
        me.moving = false;
      }

      // --- TA：轻量漫游 ---
      const pa = partnerRef.current;
      if (mode === 'live') {
        if (!partnerTarget.current) {
          partnerWait.current -= dt;
          if (partnerWait.current <= 0) {
            partnerTarget.current = {
              x: 150 + Math.random() * (WORLD_W - 300),
              y: WALL_BOTTOM + 120 + Math.random() * (WORLD_H - WALL_BOTTOM - 260),
            };
            partnerWait.current = 4 + Math.random() * 6;
          }
        }
        const tgt = partnerTarget.current;
        if (tgt) {
          const ddx = tgt.x - pa.x;
          const ddy = tgt.y - pa.y;
          const d = Math.hypot(ddx, ddy);
          if (d < 14) {
            partnerTarget.current = null;
            pa.moving = false;
          } else {
            const spd = PARTNER_SPEED * dt;
            pa.x += (ddx / d) * spd;
            pa.y += (ddy / d) * spd;
            pa.moving = true;
            if (Math.abs(ddy) > Math.abs(ddx)) pa.dir = ddy < 0 ? 'up' : 'down';
            else pa.dir = ddx < 0 ? 'left' : 'right';
          }
        }
      } else {
        pa.moving = false;
      }

      // --- 小人视图同步（每帧浅拷贝，驱动 Character 重渲染） ---
      setCharsView({ me: { ...me }, partner: { ...pa } });

      // --- 洗衣机完成检测 ---
      const now = Date.now();
      let washedId: string | null = null;
      for (const f of persistRef.current.home.furniture) {
        if (f.kind === 'washer' && f.st?.washing && f.st?.washStart && now - f.st.washStart > WASH_MS) {
          washedId = f.id;
          break;
        }
      }
      if (washedId) {
        const cur = persistRef.current;
        const furniture = cur.home.furniture.map((f) =>
          f.id === washedId
            ? { ...f, st: { ...f.st, washing: false, washDone: true, washStart: undefined } }
            : f,
        );
        updatePersist({ ...cur, home: { ...cur.home, furniture } });
      }

      // --- 镜头 ---
      zoomCur.current += (zoomTarget.current - zoomCur.current) * Math.min(1, dt * 5);
      setZoom(zoomCur.current);
      const freeCam = t < freeUntil.current;
      if (mode === 'live' && !freeCam) {
        const tx = me.x - vw / 2;
        const ty = me.y - vh * FOLLOW_Y;
        cam.x += (tx - cam.x) * Math.min(1, dt * 6.5);
        cam.y += (ty - cam.y) * Math.min(1, dt * 6.5);
      }
      cam.x = Math.max(0, Math.min(WORLD_W - vw, cam.x));
      cam.y = Math.max(0, Math.min(WORLD_H - vh, cam.y));
      if (worldRef.current) {
        worldRef.current.style.transform = `translate3d(${(-cam.x).toFixed(1)}px, ${(-cam.y).toFixed(1)}px, 0) scale(${zoomCur.current.toFixed(3)})`;
      }

      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [mode, updatePersist]);

  // ---------------- 定期落盘小人位置（我走了很远才存；TA 位置不重要，卸载时兜底） ----------------
  useEffect(() => {
    const id = setInterval(() => {
      const lc = lastSavedChars.current;
      const movedFar = Math.hypot(meRef.current.x - lc.mx, meRef.current.y - lc.my) > 120;
      if (movedFar) updatePersist(persistRef.current);
    }, 8000);
    return () => clearInterval(id);
  }, [updatePersist]);

  // ---------------- 场景拖动（自由视角） ----------------
  const panRef = useRef<{ x: number; y: number; camX: number; camY: number } | null>(null);
  const onSceneDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode === 'edit' && selectedId) setSelectedId(null);
    panRef.current = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* 忽略 */
    }
  };
  const onSceneMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = panRef.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.hypot(dx, dy) < 8) return;
    freeUntil.current = performance.now() + FREE_BACK_MS;
    const vw = viewW();
    const vh = viewH();
    cam.x = Math.max(0, Math.min(WORLD_W - vw, p.camX - dx / (view.scale * zoomCur.current)));
    cam.y = Math.max(0, Math.min(WORLD_H - vh, p.camY - dy / (view.scale * zoomCur.current)));
  };
  const onSceneUp = () => {
    panRef.current = null;
  };

  // ---------------- 粒子 ----------------
  const emitParticle = useCallback((f: FurnitureItem, emoji: string) => {
    const id = ++particleSeq.current;
    setParticles((ps) => [...ps.slice(-14), { id, x: f.x, y: f.y - 40, emoji, seed: Math.random() }]);
    window.setTimeout(() => {
      setParticles((ps) => ps.filter((p) => p.id !== id));
    }, 1300);
  }, []);

  // ---------------- 交互 ----------------
  const onInteract = useCallback(
    (f: FurnitureItem) => {
      const cur = persistRef.current;
      const c = CATALOG[f.kind];
      const patch = (st: FurnitureItem['st']) => {
        const furniture = cur.home.furniture.map((it) => (it.id === f.id ? { ...it, st } : it));
        updatePersist({ ...cur, home: { ...cur.home, furniture } });
      };
      if (c.acts.toggle) {
        const on = !f.st?.on;
        patch({ ...f.st, on });
        if (f.kind === 'recordPlayer' && on) emitParticle(f, '🎵');
        if (f.kind === 'tv' && on) emitParticle(f, '📺');
      } else if (f.kind === 'wardrobe') {
        patch({ ...f.st, open: true });
        setPanel({ kind: 'wardrobe', id: f.id });
      } else if (f.kind === 'washer') {
        patch({ ...f.st, open: true });
        setPanel({ kind: 'washer', id: f.id });
      } else if (c.acts.door) {
        patch({ ...f.st, open: !f.st?.open });
        emitParticle(f, f.st?.open ? '✨' : '🚪');
      } else {
        const gain = 1 + Math.floor(Math.random() * 3);
        updatePersist({ ...cur, coins: cur.coins + gain });
        emitParticle(f, '🪙');
      }
    },
    [updatePersist, emitParticle],
  );

  const onMove = useCallback(
    (f: FurnitureItem, x: number, y: number) => {
      const cur = persistRef.current;
      const furniture = cur.home.furniture.map((it) => (it.id === f.id ? { ...it, x, y } : it));
      updatePersist({ ...cur, home: { ...cur.home, furniture } });
    },
    [updatePersist],
  );

  const onFlip = useCallback(
    (f: FurnitureItem) => {
      const cur = persistRef.current;
      const furniture = cur.home.furniture.map((it) => (it.id === f.id ? { ...it, flip: !it.flip } : it));
      updatePersist({ ...cur, home: { ...cur.home, furniture } });
    },
    [updatePersist],
  );

  const onDelete = useCallback(
    (f: FurnitureItem) => {
      const cur = persistRef.current;
      const c = CATALOG[f.kind];
      const furniture = cur.home.furniture.filter((it) => it.id !== f.id);
      updatePersist({ ...cur, home: { ...cur.home, furniture }, coins: cur.coins + Math.floor(c.price * 0.5) });
      setSelectedId(null);
      showToast(`已回收「${c.name}」+${Math.floor(c.price * 0.5)} 金币`);
    },
    [updatePersist, showToast],
  );

  const onFurnDragStart = useCallback(() => {
    freeUntil.current = performance.now() + 4000;
  }, []);

  // ---------------- 商店购买 ----------------
  const shopItems = useMemo(() => {
    const list = Object.values(CATALOG);
    return shopTab === 'all' ? list : list.filter((c) => c.cat === shopTab);
  }, [shopTab]);

  const buy = (kind: string) => {
    const c = CATALOG[kind];
    const cur = persistRef.current;
    if (cur.coins < c.price) {
      showToast('金币不够啦～点一点家里的东西能赚金币哦');
      return;
    }
    const vw = viewW();
    const vh = viewH();
    const x = Math.round((cam.x + vw / 2) / 16) * 16;
    const y = Math.round((cam.y + vh * 0.45) / 16) * 16;
    const item: FurnitureItem = {
      id: `${kind}-${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`,
      kind: kind as FurnitureItem['kind'],
      x: Math.max(60, Math.min(WORLD_W - 60, x)),
      y: Math.max(WALL_BOTTOM + 40, Math.min(WORLD_H - 30, y)),
      st: {},
    };
    updatePersist({
      ...cur,
      coins: cur.coins - c.price,
      home: { ...cur.home, furniture: [...cur.home.furniture, item] },
    });
    setSelectedId(item.id);
    showToast(`已放置「${c.name}」，拖动调整位置～`);
  };

  // ---------------- 昼夜 / 模式 / 全屏 / 重置 ----------------
  const toggleNight = useCallback(() => {
    const cur = persistRef.current;
    updatePersist({ ...cur, home: { ...cur.home, night: !cur.home.night } });
  }, [updatePersist]);

  const toggleMode = useCallback(() => {
    if (mode === 'live') {
      setMode('edit');
      setSelectedId(null);
      zoomTarget.current = ZOOM_EDIT;
      showToast('装修模式：拖动整理 · 点家具选中 · 底部商店购买');
    } else {
      setMode('live');
      setSelectedId(null);
      zoomTarget.current = ZOOM_LIVE;
      freeUntil.current = 0; // 立即恢复跟随
      saveCacheNow(persistRef.current);
    }
  }, [mode, showToast]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        const el = (rootRef.current ?? document.documentElement) as HTMLElement & {
          requestFullscreen: () => Promise<void>;
        };
        await el.requestFullscreen();
      }
    } catch {
      showToast('当前环境不支持全屏');
    }
  }, [showToast]);

  const doReset = useCallback(() => {
    if (!resetArmed) {
      setResetArmed(true);
      window.setTimeout(() => setResetArmed(false), 2800);
      showToast('再点一次确认恢复默认布局');
      return;
    }
    setResetArmed(false);
    resetRemote().then((fresh) => {
      setPersist(fresh);
      persistRef.current = fresh;
      meRef.current = { id: 'me', ...fresh.home.chars.me };
      partnerRef.current = { id: 'partner', ...fresh.home.chars.partner };
      setSelectedId(null);
      showToast('已恢复默认布局');
    });
  }, [resetArmed, showToast]);

  // ---------------- 衣橱/洗衣机 面板动作 ----------------
  const panelFurniture = panel ? home.furniture.find((f) => f.id === panel.id) ?? null : null;

  /** 关面板顺手关门（衣橱/洗衣机换回关门贴图） */
  const closePanel = () => {
    const p = panel;
    setPanel(null);
    if (!p) return;
    const cur = persistRef.current;
    const furniture = cur.home.furniture.map((it) =>
      it.id === p.id ? { ...it, st: { ...it.st, open: false } } : it,
    );
    updatePersist({ ...cur, home: { ...cur.home, furniture } });
  };

  const sendWash = (clothId: string) => {
    if (!panelFurniture) return;
    const cur = persistRef.current;
    const washer = cur.home.furniture.find((f) => f.kind === 'washer');
    if (!washer) {
      showToast('家里还没有洗衣机哦，去商店买一台吧');
      return;
    }
    const furniture = cur.home.furniture.map((f) => {
      if (f.id === panelFurniture.id && f.kind === 'wardrobe') {
        return { ...f, st: { ...f.st, clothes: (f.st?.clothes ?? []).filter((c) => c !== clothId) } };
      }
      if (f.id === washer.id) {
        return { ...f, st: { ...f.st, clothes: [...(f.st?.clothes ?? []), clothId] } };
      }
      return f;
    });
    updatePersist({ ...cur, home: { ...cur.home, furniture } });
    showToast('已放进洗衣机 🫧');
  };

  const startWash = () => {
    if (!panelFurniture) return;
    const cur = persistRef.current;
    if ((panelFurniture.st?.clothes ?? []).length === 0) {
      showToast('筒里空空的，先从衣橱送点衣服来吧');
      return;
    }
    const furniture = cur.home.furniture.map((f) =>
      f.id === panelFurniture.id
        ? { ...f, st: { ...f.st, washing: true, washStart: Date.now(), washDone: false, open: false } }
        : f,
    );
    updatePersist({ ...cur, home: { ...cur.home, furniture } });
    setPanel(null);
    showToast('咕嘟咕嘟…开始洗衣服啦 🫧');
  };

  const takeOutWash = () => {
    if (!panelFurniture) return;
    const cur = persistRef.current;
    const washed = panelFurniture.st?.clothes ?? [];
    const wardrobe = cur.home.furniture.find((f) => f.kind === 'wardrobe');
    const furniture = cur.home.furniture.map((f) => {
      if (f.id === panelFurniture.id) {
        return { ...f, st: { ...f.st, clothes: [], washDone: false, washing: false } };
      }
      if (wardrobe && f.id === wardrobe.id) {
        return { ...f, st: { ...f.st, clothes: [...(f.st?.clothes ?? []), ...washed] } };
      }
      return f;
    });
    updatePersist({ ...cur, home: { ...cur.home, furniture } });
    setPanel(null);
    showToast('香喷喷！衣物已收回衣橱 ✨');
  };

  const dismissHint = () => {
    try {
      window.localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* 忽略 */
    }
    setHinted(true);
  };

  // ---------------- 夜光层 ----------------
  const litItems = home.furniture.filter((f) => {
    const c = CATALOG[f.kind];
    return Boolean(c?.acts?.toggle && f.st?.on && c.glow);
  });
  const isNight = home.night;

  const me = charsView.me;
  const partner = charsView.partner;

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-[#f6ead6]"
      onPointerDown={onSceneDown}
      onPointerMove={onSceneMove}
      onPointerUp={onSceneUp}
      onPointerCancel={onSceneUp}
      data-testid="couple-home-root"
    >
      {/* ============ 世界 ============ */}
      <div
        ref={worldRef}
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: WORLD_W, height: WORLD_H }}
      >
        {/* ---- 背景墙 ---- */}
        <div
          className="absolute left-0 top-0 w-full"
          style={{
            height: WALL_BOTTOM,
            background: isNight
              ? 'linear-gradient(180deg, #6a5d70 0%, #75685f 100%)'
              : 'linear-gradient(180deg, #f4e7d0 0%, #efe0c4 100%)',
          }}
        >
          <div
            className="absolute inset-0 opacity-40"
            style={{
              background: `repeating-linear-gradient(90deg, transparent 0 118px, ${
                isNight ? 'rgba(40,32,50,0.5)' : 'rgba(190,160,110,0.16)'
              } 118px 121px)`,
            }}
          />
          {/* 墙裙 */}
          <div
            className="absolute bottom-0 w-full"
            style={{
              height: 74,
              background: isNight ? '#5a4f56' : '#e9d6b2',
              boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.25)',
            }}
          >
            <div
              className="absolute inset-0 opacity-60"
              style={{
                background: `repeating-linear-gradient(90deg, transparent 0 58px, ${
                  isNight ? 'rgba(30,24,38,0.55)' : 'rgba(178,148,96,0.35)'
                } 58px 62px)`,
              }}
            />
          </div>
          {/* 踢脚线 */}
          <div
            className="absolute bottom-0 w-full"
            style={{
              height: 14,
              background: isNight ? '#463d43' : '#d8bd8f',
              boxShadow: '0 3px 6px rgba(60,40,20,0.25)',
            }}
          />

          {/* ---- 门 ---- */}
          <div className="absolute" style={{ left: 42, top: 34, width: 120, height: 252 }}>
            <div
              className="relative h-full w-full rounded-t-[10px]"
              style={{
                background: isNight
                  ? 'linear-gradient(180deg, #8a6f52, #6f5540)'
                  : 'linear-gradient(180deg, #c99e6e, #b1845a)',
                boxShadow: 'inset 0 0 0 5px rgba(255,255,255,0.22), inset 0 -6px 12px rgba(90,60,30,0.35)',
              }}
            >
              <div className="absolute inset-x-4 top-5 h-[74px] rounded-[6px] border-[3px] border-[rgba(255,255,255,0.28)]" />
              <div className="absolute inset-x-4 top-[96px] h-[110px] rounded-[6px] border-[3px] border-[rgba(255,255,255,0.28)]" />
              <div
                className="absolute right-[16px] top-[118px] h-[13px] w-[13px] rounded-full"
                style={{ background: '#f0d9a0', boxShadow: 'inset 0 -2px 3px rgba(120,90,40,0.5)' }}
              />
            </div>
          </div>

          {/* ---- 窗 ×2 ---- */}
          <WinDecor left={196} width={175} night={isNight} />
          <WinDecor left={918} width={175} night={isNight} />

          {/* ---- 墙饰 ---- */}
          <img
            src="/home/furniture/photoFrame.webp"
            alt="我们的合照"
            draggable={false}
            className="absolute select-none"
            style={{ left: 396, top: 128, width: 74, filter: 'drop-shadow(0 3px 4px rgba(70,50,30,0.25))' }}
          />
          <img
            src="/home/furniture/wallClock.webp"
            alt="挂钟"
            draggable={false}
            className="absolute select-none"
            style={{ left: 524, top: 118, width: 66, filter: 'drop-shadow(0 3px 4px rgba(70,50,30,0.25))' }}
          />
          <img
            src="/home/furniture/photoFrame.webp"
            alt="合照"
            draggable={false}
            className="absolute select-none"
            style={{ left: 660, top: 132, width: 60, filter: 'drop-shadow(0 3px 4px rgba(70,50,30,0.25))' }}
          />
          <img
            src="/home/furniture/wallShelf.webp"
            alt="置物搁板"
            draggable={false}
            className="absolute select-none"
            style={{ left: 760, top: 122, width: 132, filter: 'drop-shadow(0 4px 5px rgba(70,50,30,0.28))' }}
          />

          {/* 搁板下的串灯（夜晚点亮） */}
          {isNight && (
            <div className="absolute" style={{ left: 762, top: 196, width: 128, height: 12 }}>
              {Array.from({ length: 7 }).map((_, i) => (
                <span
                  key={i}
                  className="absolute top-0 h-[7px] w-[7px] rounded-full bg-[#ffd98a]"
                  style={{
                    left: i * 19,
                    boxShadow: '0 0 7px 2px rgba(255,205,110,0.75)',
                    animation: `ch-twinkle-star ${1.4 + (i % 3) * 0.5}s ease-in-out infinite`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* ---- 地板 ---- */}
        <div
          className="absolute left-0 w-full"
          style={{
            top: WALL_BOTTOM,
            height: WORLD_H - WALL_BOTTOM,
            background: isNight
              ? 'linear-gradient(180deg, #8a7050 0%, #96795a 30%, #8f7150 100%)'
              : 'linear-gradient(180deg, #dcb17e 0%, #e8c091 30%, #e2b98a 100%)',
          }}
        >
          <div
            className="absolute inset-0 opacity-70"
            style={{
              background: `repeating-linear-gradient(0deg, transparent 0 64px, ${
                isNight ? 'rgba(40,26,14,0.5)' : 'rgba(150,110,60,0.22)'
              } 64px 67px)`,
            }}
          />
          <div
            className="absolute inset-0 opacity-50"
            style={{
              background: `repeating-linear-gradient(90deg, transparent 0 132px, ${
                isNight ? 'rgba(40,26,14,0.4)' : 'rgba(150,110,60,0.16)'
              } 132px 134px)`,
            }}
          />
          <div
            className="absolute left-0 top-0 w-full"
            style={{
              height: 42,
              background: 'linear-gradient(180deg, rgba(60,38,16,0.30), rgba(60,38,16,0))',
            }}
          />
          {mode === 'edit' && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'repeating-linear-gradient(0deg, rgba(52,201,142,0.22) 0 1px, transparent 1px 16px),' +
                  'repeating-linear-gradient(90deg, rgba(52,201,142,0.22) 0 1px, transparent 1px 16px)',
              }}
            />
          )}
        </div>

        {/* ---- 家具 ---- */}
        {home.furniture.map((f) => (
          <Furniture
            key={f.id}
            f={f}
            editMode={mode === 'edit'}
            selected={selectedId === f.id}
            onSelect={(sel) => setSelectedId(sel ? sel.id : null)}
            onFlip={onFlip}
            onDelete={onDelete}
            onInteract={onInteract}
            onMove={onMove}
            onEmit={emitParticle}
            onDragStart={onFurnDragStart}
          />
        ))}

        {/* ---- 小人（生活模式） ---- */}
        {mode === 'live' && (
          <>
            <Character ch={me} />
            <Character ch={partner} />
          </>
        )}

        {/* ---- 夜光层 ---- */}
        {isNight && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{ zIndex: 12000, background: 'rgba(26,20,44,0.46)', mixBlendMode: 'multiply' }}
          />
        )}
        {litItems.map((f) => {
          const c = CATALOG[f.kind];
          const dy = GLOW_DY[f.kind] ?? 60;
          const r = (c.glow ?? 180) * (isNight ? 1.05 : 0.66);
          return (
            <div
              key={`glow-${f.id}`}
              className="pointer-events-none absolute"
              style={{
                left: f.x,
                top: f.y - dy,
                width: r * 2,
                height: r * 1.5,
                transform: 'translate(-50%, -50%)',
                zIndex: 12001,
                mixBlendMode: 'screen',
                background: `radial-gradient(ellipse, ${
                  isNight
                    ? 'rgba(255,208,120,0.55) 0%, rgba(255,196,100,0.22) 45%, rgba(255,190,90,0) 72%'
                    : 'rgba(255,232,170,0.30) 0%, rgba(255,225,150,0.10) 50%, rgba(255,220,140,0) 75%'
                })`,
              }}
            />
          );
        })}
        {/* 电视开机屏幕 */}
        {home.furniture
          .filter((f) => f.kind === 'tv' && f.st?.on)
          .map((f) => {
            const c = CATALOG.tv;
            return (
              <div
                key={`tvon-${f.id}`}
                className="pointer-events-none absolute"
                style={{
                  left: f.x - c.w * 0.39,
                  top: f.y - c.w * 0.66,
                  width: c.w * 0.78,
                  height: c.w * 0.46,
                  zIndex: 12002,
                  borderRadius: 8,
                  overflow: 'hidden',
                  boxShadow: '0 0 24px 6px rgba(140,200,255,0.45)',
                  animation: 'ch-tv-play 7s linear infinite',
                  background:
                    'linear-gradient(100deg, #ffb3c1 0%, #ffd9a0 16%, #b8e6ff 34%, #c8f7d8 52%, #f7c8ff 70%, #ffe3b0 88%, #ffb3c1 100%)',
                  backgroundSize: '300% 100%',
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      'radial-gradient(ellipse at 30% 40%, rgba(255,255,255,0.5), transparent 55%),' +
                      'radial-gradient(ellipse at 75% 65%, rgba(255,255,255,0.35), transparent 50%)',
                  }}
                />
              </div>
            );
          })}

        {/* ---- 粒子 ---- */}
        {particles.map((p) => (
          <div
            key={p.id}
            className="pointer-events-none absolute text-[22px]"
            style={{
              left: p.x + (p.seed - 0.5) * 46,
              top: p.y,
              zIndex: 13000,
              animation: 'ch-float-up 1.25s ease-out forwards',
            }}
          >
            {p.emoji}
          </div>
        ))}
      </div>

      {/* ============ 顶部栏 ============ */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[20000] px-3 pt-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={close}
            aria-label="返回情侣空间"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-[#3a3a40] shadow-md backdrop-blur-md active:scale-90"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex h-10 items-center gap-1.5 rounded-full bg-white/85 px-3 shadow-md backdrop-blur-md">
            <span className="text-[15px] leading-none">{mode === 'edit' ? '🔨' : '🏠'}</span>
            <span className="text-[13px] font-semibold text-[#3a3a40]">
              {mode === 'edit' ? '装修模式' : '情侣小家'}
            </span>
          </div>
          <div className="flex-1" />
          <div
            key={coins}
            className="flex h-10 items-center gap-1 rounded-full bg-[#fff7e0]/92 px-3 shadow-md backdrop-blur-md ring-1 ring-[#e8c06a]/60"
            style={{ animation: 'ch-coin-pop 0.45s ease-out' }}
          >
            <Coins className="h-[17px] w-[17px] text-[#e2a34f]" />
            <span className="text-[13px] font-bold tabular-nums text-[#a6721f]">{coins}</span>
          </div>
          <button
            type="button"
            onClick={toggleNight}
            aria-label={isNight ? '切换白天' : '切换夜晚'}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 shadow-md backdrop-blur-md active:scale-90"
          >
            {isNight ? <Moon className="h-5 w-5 text-[#5b6bbf]" /> : <Sun className="h-5 w-5 text-[#e2a34f]" />}
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscr ? '退出全屏' : '全屏'}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-[#3a3a40] shadow-md backdrop-blur-md active:scale-90"
          >
            {fullscr ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={toggleMode}
            aria-label={mode === 'edit' ? '完成装修' : '进入装修模式'}
            className="flex h-10 w-10 items-center justify-center rounded-full text-white shadow-md active:scale-90"
            style={{
              background:
                mode === 'edit'
                  ? 'linear-gradient(135deg, #34c98e, #2aa776)'
                  : 'linear-gradient(135deg, #e2889d, #d46a86)',
            }}
          >
            {mode === 'edit' ? <Check className="h-5 w-5" /> : <Hammer className="h-5 w-5" />}
          </button>
        </div>
        {mode === 'edit' && (
          <div className="pointer-events-auto mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={doReset}
              className="flex h-8 items-center gap-1 rounded-full bg-white/85 px-3 text-[12px] font-semibold text-[#c95b5b] shadow-sm backdrop-blur-md active:scale-95"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {resetArmed ? '确认重置？' : '重置布局'}
            </button>
            {savedFlash > 0 && Date.now() - savedFlash < 2200 && (
              <div className="flex h-8 items-center gap-1 rounded-full bg-[#34c98e]/90 px-3 text-[12px] font-semibold text-white shadow-sm">
                <Check className="h-3.5 w-3.5" /> 已自动保存
              </div>
            )}
          </div>
        )}
      </div>

      {/* ============ 摇杆（生活模式） ============ */}
      {mode === 'live' && (
        <div className="absolute bottom-6 left-5 z-[20001]">
          <Joystick onVec={onJoyVec} size={132} />
        </div>
      )}

      {/* 首次提示 */}
      {mode === 'live' && loaded && !hinted && <HintBubble onDone={dismissHint} />}

      {/* ============ 商店（编辑模式底部） ============ */}
      <AnimatePresence>
        {mode === 'edit' && (
          <motion.div
            initial={{ y: 260 }}
            animate={{ y: 0 }}
            exit={{ y: 260 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="absolute inset-x-0 bottom-0 z-[20002] rounded-t-3xl bg-white/96 pb-4 pt-2.5 shadow-[0_-10px_30px_rgba(0,0,0,0.14)] backdrop-blur-xl"
          >
            <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-black/15" />
            <div className="mb-2 flex items-center gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {SHOP_TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setShopTab(t.key)}
                  className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-semibold transition-all active:scale-95 ${
                    shopTab === t.key ? 'bg-[#3a3a40] text-white shadow-sm' : 'bg-[#f2f0ec] text-[#6a6a70]'
                  }`}
                >
                  <span className="text-[13px] leading-none">{t.emoji}</span>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-stretch gap-2.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {shopItems.map((c) => (
                <button
                  key={c.kind}
                  type="button"
                  onClick={() => buy(c.kind)}
                  className="flex w-[104px] shrink-0 flex-col items-center rounded-2xl bg-[#faf6ef] p-2 shadow-sm ring-1 ring-black/[0.04] transition-transform active:scale-95"
                >
                  <div className="flex h-[62px] w-full items-center justify-center rounded-xl bg-white p-1">
                    <img
                      src={c.img}
                      alt={c.name}
                      draggable={false}
                      className="max-h-full max-w-full object-contain"
                      style={{ filter: 'drop-shadow(0 3px 4px rgba(90,70,40,0.18))' }}
                    />
                  </div>
                  <span className="mt-1.5 w-full truncate text-center text-[11px] font-semibold text-[#3a3a40]">
                    {c.name}
                  </span>
                  <span
                    className={`mt-1 flex items-center gap-0.5 rounded-full px-2 py-[2px] text-[11px] font-bold ${
                      c.price === 0 ? 'bg-[#e8f5ee] text-[#2a9d6f]' : 'bg-[#fff3d9] text-[#a6721f]'
                    }`}
                  >
                    {c.price === 0 ? (
                      '免费'
                    ) : (
                      <>
                        <Coins className="h-3 w-3" />
                        {c.price}
                      </>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ 面板（衣橱/洗衣机） ============ */}
      {panelFurniture && panel?.kind === 'wardrobe' && (
        <WardrobePanel f={panelFurniture} onClose={closePanel} onSendWash={sendWash} />
      )}
      {panelFurniture && panel?.kind === 'washer' && (
        <WasherPanel
          f={panelFurniture}
          onClose={closePanel}
          onStart={startWash}
          onTake={takeOutWash}
        />
      )}

      {/* ============ Toast ============ */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.t}
            initial={{ opacity: 0, y: 14, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            className="pointer-events-none absolute bottom-[150px] left-1/2 z-[20010] -translate-x-1/2 rounded-full bg-[#2c3026]/88 px-4 py-2 text-center text-[13px] font-medium text-white shadow-lg backdrop-blur-sm"
            style={{ maxWidth: 300 }}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 摇杆输出 → 模块级 ref（单实例组件，避免闭包重建） */
const JOY = { current: { dx: 0, dy: 0 } };
const onJoyVec = (dx: number, dy: number) => {
  JOY.current = { dx, dy };
};

/** charsView 初始化辅助（避免双读 persist） */
function initialPersistView() {
  const p = initialPersist();
  return p.home.chars;
}

/* ---------------- 窗户 ---------------- */
function WinDecor({ left, width, night }: { left: number; width: number; night: boolean }) {
  return (
    <div
      className="absolute rounded-t-[26px]"
      style={{
        left,
        top: 44,
        width,
        height: 188,
        background: night
          ? 'linear-gradient(180deg, #232c4e 0%, #2e3a66 60%, #3a4676 100%)'
          : 'linear-gradient(180deg, #aee0f8 0%, #cdeefb 55%, #eaf7fd 100%)',
        boxShadow: 'inset 0 0 0 7px rgba(255,253,248,0.9), 0 4px 8px rgba(70,50,30,0.2)',
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-full w-[7px] bg-[rgba(255,253,248,0.88)]" />
      </div>
      <div className="absolute left-0 top-1/2 h-[7px] w-full -translate-y-1/2 bg-[rgba(255,253,248,0.88)]" />
      {night ? (
        <>
          <div
            className="absolute"
            style={{
              right: 18,
              top: 22,
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: '#fdeeb0',
              boxShadow: '0 0 16px 4px rgba(253,238,176,0.55)',
            }}
          />
          {[
            { l: 16, t: 26, s: 4, d: 0 },
            { l: 38, t: 52, s: 3, d: 0.7 },
            { l: 58, t: 20, s: 4, d: 1.3 },
            { l: 74, t: 60, s: 3, d: 0.4 },
            { l: 30, t: 76, s: 3.5, d: 1.1 },
          ].map((st, i) => (
            <span
              key={i}
              className="absolute rounded-full bg-white"
              style={{
                left: st.l,
                top: st.t,
                width: st.s,
                height: st.s,
                animation: `ch-twinkle-star ${1.6 + st.d}s ease-in-out infinite`,
              }}
            />
          ))}
        </>
      ) : (
        <>
          <div
            className="absolute"
            style={{
              right: 20,
              top: 20,
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: 'radial-gradient(circle, #fff5c8 0 40%, #ffe89a 70%, rgba(255,230,140,0) 100%)',
              boxShadow: '0 0 20px 8px rgba(255,240,170,0.55)',
            }}
          />
          <div
            className="absolute rounded-full bg-white/80 blur-[2px]"
            style={{ left: 14, top: 58, width: 44, height: 16, animation: 'ch-cloud-drift 7s ease-in-out infinite alternate' }}
          />
          <div
            className="absolute rounded-full bg-white/70 blur-[2px]"
            style={{ left: 34, top: 78, width: 30, height: 12, animation: 'ch-cloud-drift 9s ease-in-out infinite alternate-reverse' }}
          />
        </>
      )}
      <div
        className="absolute -bottom-2 left-[-8px] w-[calc(100%+16px)] rounded-full"
        style={{ height: 13, background: night ? '#7a6a52' : '#e6cda1', boxShadow: '0 3px 5px rgba(60,40,20,0.3)' }}
      />
    </div>
  );
}

/* ---------------- 首次提示 ---------------- */
function HintBubble({ onDone }: { onDone: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute bottom-[172px] left-1/2 z-[20009] -translate-x-1/2 rounded-2xl bg-white/92 px-4 py-2.5 text-center shadow-xl backdrop-blur-md"
      style={{ maxWidth: 260 }}
    >
      <div className="text-[12.5px] font-semibold leading-relaxed text-[#3a3a40]">
        🕹️ 左下摇杆走动 · 点家具互动
        <br />
        💕 长按家具可以搬动位置
        <br />
        🔨 右上按钮进入装修模式
      </div>
      <button
        type="button"
        onClick={onDone}
        className="mt-2 rounded-full bg-[#e2889d] px-4 py-1 text-[12px] font-semibold text-white active:scale-95"
      >
        知道啦
      </button>
    </motion.div>
  );
}
