'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence } from 'framer-motion';
import { selectResolvedTheme, seedDisplay, useSettings, useSystemDark, useUI, useWallpaperStyle } from '@/lib/ios/store';
import { useLightForeground } from '@/lib/ios/foreground';
import { BOOT_WALL_STYLE } from '@/lib/ios/wallpaper-presets';
import { bootSnapshotFromWindow, type DisplaySnapshot } from '@/lib/ios/display-cookie';
import { migrateFromServer } from '@/lib/ios/contacts-store';
import { ensureKvReady } from '@/lib/ios/idb-kv';
import StatusBar from './StatusBar';
import HomeScreen from './HomeScreen';
import AppWindow from './AppWindow';
import AppSwitcher from './AppSwitcher';
import LockScreen from './LockScreen';

// 闹钟监听懒加载：避免为一个小组件把整个时钟 App 拖进首屏包
const AlarmWatcher = dynamic(() => import('@/components/apps/clock').then((m) => m.AlarmWatcher), { ssr: false });

// 朋友圈/QQ动态全局调度（AI 互动结算 + 自动发布）：同样懒加载，挂载即后台运行
const MomentsScheduler = dynamic(() => import('./MomentsScheduler'), { ssr: false });

/** 底部边缘识别带高度：比 28px 可视横杠更高，按下点在屏幕最底部一段内即开始识别（真机好滑起见给了 72px） */
const EDGE_ZONE = 72;
/** 上滑超过该距离即打开多任务切换器（真机好滑：短距离即触发） */
const OPEN_DELTA = 18;

/**
 * 手机壳：桌面端显示 iPhone 机身外框（含电源键），移动端全屏。
 * 内部依次为 壁纸层 → 主屏幕 → App 窗口 → 多任务切换器 → 锁屏 → 熄屏遮罩 → 状态栏 → 灵动岛。
 *
 * 首帧防闪烁：主题/壁纸/锁屏开关由「首帧镜像」直出 ——
 * - SSR：page.tsx 从 cookie 读快照传 initialDisplay（顶层导航可用）；
 * - 客户端：pre-paint 启动脚本（layout 注入）读 localStorage 镜像写在 window.__IOS_DISPLAY__，
 *   跨站 iframe（预览面板）里 cookie 写不进去时它仍是真实值 → 客户端首渲染优先用它；
 * - 壁纸层首帧用 CSS 变量样式（BOOT_WALL_STYLE）：SSR 与客户端的 style 属性完全相同
 *   （都是 var() 引用），真实壁纸由启动脚本在绘制前写进变量 → 零水合差异、首帧即真实壁纸。
 * IndexedDB 设置读出（load）后切回 store（含自定义壁纸 Blob、真实密码配置等）。
 */
export default function PhoneShell({ initialDisplay }: { initialDisplay?: DisplaySnapshot | null }) {
  // 首帧注水快照：客户端优先用启动脚本全局（localStorage 镜像，iframe 里也真实），SSR 用 cookie prop
  const bootSnapshot = bootSnapshotFromWindow() ?? initialDisplay;
  // 首帧注水：useState 惰性初始化保证在任何 hook 订阅前执行且仅执行一次（StrictMode 双渲染也幂等）。
  // 【只在客户端执行】seedDisplay 会 setState —— zustand 是模块级单例，SSR 阶段执行会污染服务端
  // store 并跨请求泄漏（例如之前某个带 lockScreen=false cookie 的请求会把服务端 locked 永久改成 false，
  // 之后所有无 cookie 的 SSR 都渲染「无锁屏」，水合后再弹回锁屏 = 闪烁）。
  // SSR 的 locked/主题/壁纸由「store 初始值 + boot prop（cookie）」确定，确定性问题由
  // pre-paint 脚本的 data-lock-off / CSS 变量在首帧绘制前修正。
  useState(() => {
    if (typeof window !== 'undefined') seedDisplay(bootSnapshot);
    return true;
  });

  const theme = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const load = useSettings((s) => s.load);
  const storeLoaded = useSettings((s) => s.loaded);
  const switcherOpen = useUI((s) => s.switcherOpen);
  const storeLocked = useUI((s) => s.locked);
  const screenOff = useUI((s) => s.screenOff);
  const pressPower = useUI((s) => s.pressPower);
  const storeWallpaperStyle = useWallpaperStyle();
  // 【SSR 首帧真值】zustand v5 的 selector 在 SSR/水合阶段读 store 创建时快照（setState 注水不可见），
  // 所以 loaded 之前的壁纸/主题/锁屏开关/时区全部用首帧快照（bootSnapshot）直通；
  // load() 完成后切回 store（含自定义壁纸 Blob、真实密码配置等）。
  // loaded 的 selector 语义恰好正确：SSR/水合阶段恒 false → 用快照；之后 store 为 true → 用 store。
  const boot = storeLoaded ? null : bootSnapshot;
  const theme0 = boot?.theme ?? theme;
  const locked = boot ? (boot.lockScreen && storeLocked) : storeLocked;
  // 首帧（loaded 前）一律用 CSS 变量引用 —— 无 cookie 的 SSR（预览 iframe）也渲染同一份 var() 样式，
  // 真实壁纸由 pre-paint 脚本写进 <head><style>：变量有值→首帧即真实壁纸；
  // 无值（真首次访问）→回退 graphite 默认。若这里用具体预设值，无 cookie SSR 会先画默认色直到水合 = 深色闪烁
  const wallpaperStyle = storeLoaded ? storeWallpaperStyle : BOOT_WALL_STYLE;
  // 横杠颜色与状态栏同一套判定（但按壁纸底部区域实测，上亮下暗壁纸横杠可独立选色）：身后背景深→白杠、浅→黑杠
  const barLight = useLightForeground('bottom', boot?.lockWallpaper);
  const shellRef = useRef<HTMLDivElement | null>(null);
  /** 底部边缘上滑手势进行中状态（fired 防止同一次滑动重复触发） */
  const edgeGesture = useRef<{ x: number; y: number; fired: boolean } | null>(null);

  // 启动时一次性迁移：旧版存服务端的联系人/微信背景图 → 本地 IndexedDB（先搬后删，详见 contacts-store.ts）
  useEffect(() => {
    void migrateFromServer();
  }, []);

  // 底部边缘上滑手势（全局）：从屏幕最底下往上滑 → 打开多任务切换器，主屏幕与所有 App 内均生效（含时钟）。
  // 用 window 捕获阶段原生 Pointer 监听而非组件 onTouch 事件：
  // ① 鼠标/触摸/触控笔统一支持（旧实现仅 touch 事件，桌面鼠标永远无法触发，时钟等界面看起来“不能多任务”）；
  // ② 捕获阶段先于一切子组件，不会被任何 stopPropagation 拦截；
  // ③ move/up 挂在 window，快速上滑滑出横杠也不丢事件，第一下就能触发；
  // ④ 只识别“按下点在底部边缘带内 + 上滑超阈值”，轻点（点 dock 图标/tab 按钮）完全不受影响。
  // 真机难点：App 内列表都可滚动，上滑会被浏览器认领为滚动并回 pointercancel 掐死手势——
  // 所以边缘带内起手且已明确竖直上滑意图时，touchmove preventDefault 阻止浏览器接管
  // （横向滑动第一个像素就方向不符、不拦，主屏翻页等不受影响）；同时放宽判定：
  // 识别带 72px / 触发仅需 18px / 允许略斜（竖直 > 水平×0.85），滑动轻松得多。
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = edgeGesture.current;
      if (!g || g.fired) return;
      const dy = g.y - e.clientY;
      if (dy > OPEN_DELTA && dy > Math.abs(e.clientX - g.x) * 0.85) {
        g.fired = true;
        const ui = useUI.getState();
        // 主屏幕编辑模式：上滑不进多任务（用户要求，避免整理图标时误触）
        if (!ui.locked && !ui.screenOff && !ui.switcherOpen && !ui.alarmRinging && !ui.homeEdit) {
          try {
            navigator.vibrate?.(8);
          } catch {
            /* 震动不可用 */
          }
          ui.openSwitcher();
        }
      }
    };
    // 浏览器滚动接管防御：只在「边缘带内起手 + 已明确竖直上滑」时才拦截
    const onTouchMove = (e: TouchEvent) => {
      const g = edgeGesture.current;
      if (!g || g.fired) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = g.y - t.clientY;
      if (dy > 6 && dy > Math.abs(t.clientX - g.x)) e.preventDefault();
    };
    const finish = () => {
      edgeGesture.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    const onDown = (e: PointerEvent) => {
      edgeGesture.current = null; // 上一次未正常收尾的手势作废
      const ui = useUI.getState();
      if (ui.locked || ui.screenOff || ui.switcherOpen || ui.alarmRinging) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const rect = shellRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (e.clientX < rect.left || e.clientX > rect.right) return;
      if (e.clientY < rect.top || e.clientY > rect.bottom) return;
      if (rect.bottom - e.clientY > EDGE_ZONE) return; // 按下点不在底部边缘带内
      edgeGesture.current = { x: e.clientX, y: e.clientY, fired: false };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('touchmove', onTouchMove, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, []);

  // 从 IndexedDB 加载持久化配置（主题/壁纸/API/锁屏密码）。
  // 先完成 localStorage → IndexedDB 迁移与注水（聊天/记忆/表情包等模块的同步读写
  // 都依赖内存缓存就位），再读设置 —— 两者都完成后才结束开机门控。
  useEffect(() => {
    void (async () => {
      await ensureKvReady();
      await load();
    })();
  }, [load]);

  const dark = selectResolvedTheme(theme0, systemDark) === 'dark';

  // html 级深色类同步：pre-paint 脚本已按首帧快照加过 html.dark（水合前就生效），
  // 这里在挂载后接管（主题切换/自动模式变化时增删）；脚本留下的 data-lock-off 标记也一并移除
  // （此后锁屏显隐完全由 locked 状态驱动，标记只在「水合前隐藏 SSR 锁屏」用）。
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('dark', dark);
    html.removeAttribute('data-lock-off');
  }, [dark]);

  // 首帧前景色标记（data-boot-lock-light）只在 boot 期有效：load() 后壁纸明暗由实测接管，
  // 移除标记让 CSS 覆盖规则失效，避免盖住 React 的动态前景色
  const storeLoadedForFlag = useSettings((s) => s.loaded);
  useEffect(() => {
    if (storeLoadedForFlag) document.documentElement.removeAttribute('data-boot-lock-light');
  }, [storeLoadedForFlag]);

  // 开机门控已移除（防锁屏闪烁的最终修复）：过去「设置读出前渲染纯黑开机屏」，
  // 刷新时旧锁屏→一段纯黑→新锁屏，看起来就是锁屏闪一下。
  // 现在首帧由 cookie 注水的真实设置直接渲染锁屏/主屏，load() 只负责补齐
  // 首帧不需要的数据（API 配置/自定义壁纸/自定义图标/密码等），到达时原地更新。

  return (
    <div
      data-ios-wrap=""
      suppressHydrationWarning
      className="flex min-h-[100svh] w-full items-center justify-center bg-[#dcdce1] dark:bg-black sm:p-8"
    >
      <div
        ref={shellRef}
        data-ios-shell=""
        suppressHydrationWarning
        className={`relative h-[100svh] w-full overflow-hidden bg-black text-foreground sm:h-[844px] sm:w-[390px] sm:rounded-[56px] sm:border-[12px] sm:border-[#151517] sm:shadow-[0_40px_90px_-20px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.08)] ${
          dark ? 'dark' : ''
        }`}
      >
        {/* 壁纸层（首帧 = CSS 变量，pre-paint 脚本写入真实壁纸；load() 后换 store 具体值） */}
        <div className="absolute inset-0" style={wallpaperStyle} data-boot-wall="" suppressHydrationWarning aria-hidden="true" />

        {/* 主屏幕 */}
        <HomeScreen />

        {/* App 窗口 */}
        <AppWindow />

        {/* Home 指示条：所有界面常显，颜色由 useLightForeground 随身后背景明暗选黑/白
            （白底黑杠、黑底白杠；饱和色背景按明暗取色，不像 mix-blend-difference 那样变互补色）。
            上滑 = 打开多任务切换器：由 PhoneShell 顶部 window 捕获阶段全局边缘手势接管（鼠标/触摸均可，
            主屏幕与所有 App 内一致生效）；指示条本体 pointer-events-none——
            纯视觉元素不拦截点击（否则会挡住 App 内底部区域的按钮，如表情面板弹窗的完成按钮） */}
        {!screenOff && !switcherOpen && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[72] flex h-[28px] items-end justify-center pb-[7px] touch-none"
          >
            <div
              className={`h-[5px] w-[134px] rounded-full opacity-90 transition-colors duration-300 ${
                barLight ? 'bg-white' : 'bg-black'
              }`}
              data-homebar-fg=""
              suppressHydrationWarning
            />
          </div>
        )}

        {/* 多任务切换器（主屏幕或 App 内均可打开；锁定时被锁屏覆盖） */}
        <AppSwitcher />

        {/* 锁屏（含密码验证 / 手电筒 / 锁屏直达相机；解锁时播放退场动画）
            bootLockWallpaper：SSR/水合阶段 store selector 读不到注水值，预设明暗标记用快照直通；
            壁纸本身走 CSS 变量（pre-paint 脚本首帧直出）；data-lock-screen 供启动脚本/全局 CSS 定位 */}
        <AnimatePresence>
          {locked && (
            <LockScreen
              key="lockscreen"
              bootTz={bootSnapshot?.tz}
              bootLockWallpaper={boot?.lockWallpaper}
            />
          )}
        </AnimatePresence>

        {/* 熄屏遮罩（电源键熄屏；轻点或再按电源键唤醒到锁屏） */}
        {screenOff && (
          <div
            role="button"
            aria-label="轻点唤醒屏幕"
            onClick={pressPower}
            className="absolute inset-0 z-[95] cursor-pointer bg-black"
          />
        )}

        {/* 状态栏 + 灵动岛（bootTz：SSR 首帧按用户时区渲染时间；bootLockWallpaper：首帧前景色按锁屏壁纸选） */}
        <StatusBar bootTz={bootSnapshot?.tz} bootLockWallpaper={boot?.lockWallpaper} />
        <div
          className="pointer-events-none absolute left-1/2 top-[11px] z-[80] h-[33px] w-[118px] -translate-x-1/2 rounded-full bg-black"
          aria-hidden="true"
        />

        {/* 全局闹钟监听（锁屏时也会响铃，铃声弹层 z-90 高于锁屏） */}
        <AlarmWatcher />

        {/* 朋友圈/QQ动态全局调度：AI 好友的点赞/评论/回复延迟队列结算 + 三种触发自动发动态（App 不打开也生效） */}
        <MomentsScheduler />

        {/* 电源键（桌面端机身右侧：熄屏 ↔ 亮屏锁定） */}
        <button
          type="button"
          aria-label="电源键：熄屏或唤醒"
          title="电源键"
          onClick={pressPower}
          className="absolute -right-[17px] top-[196px] z-[10] hidden h-[64px] w-[6px] rounded-r-[3px] bg-[#3a3a3d] transition-colors hover:bg-[#5a5a5e] active:bg-[#6a6a6e] sm:block"
        />
      </div>
    </div>
  );
}
