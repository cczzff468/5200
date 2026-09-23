'use client';

import { useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, CloudSun, Flashlight, FlashlightOff } from 'lucide-react';
import { useSettings, useUI, useLockWallpaper, useMeasuredWallpaperLight, useBootDisplayLight, useWallpaperDecodedRepaint } from '@/lib/ios/store';
import { WALLPAPER_PRESETS, BOOT_LOCK_WALL_STYLE } from '@/lib/ios/wallpaper-presets';
import { formatLunarDate, formatSolarShort } from '@/lib/ios/lunar';
import { formatIOSTime, formatWeekShort, ssrWallClock, useNow } from '@/lib/ios/clock';
import { useBattery } from '@/lib/ios/battery';
import { weatherCodeInfo, useWeatherSnapshot } from '@/components/apps/weather-core';
import PasscodePad from './PasscodePad';

// 锁屏直达相机：相机 App 懒加载（点开锁屏相机时才拉取，不拖累首屏）
const CameraApp = dynamic(() => import('@/components/apps/camera'), { ssr: false });

/** 周短格式：改用 clock.ts 的 formatWeekShort（支持 SSR 时区），模块级常量已移除 */

/**
 * 锁屏（仿 iOS）：
 * - 日期（含农历）+ 超大时钟 + 「×××的iPhone」电量 / 天气 / 日期小组件；
 * - 上滑解锁：未设密码直接解锁，已设密码进入密码键盘；
 * - 手电筒（白屏补光模拟）与相机快捷入口（锁屏直达相机，不解锁，关闭相机回锁屏）；
 * - 密码验证失败抖动 + 提示，验证通过播放解锁退场动画（由 PhoneShell 的 AnimatePresence 播放）。
 */
export default function LockScreen({
  bootTz,
  bootLockWallpaper,
}: {
  /** SSR 首帧时钟时区（cookie 直通；客户端注水后走 useNow 本机时钟，不用此值） */
  bootTz?: string;
  /** loaded 之前的锁屏壁纸预设（cookie 直通；store selector 在 SSR/水合阶段读不到注水值） */
  bootLockWallpaper?: string;
} = {}) {
  const lockConfig = useSettings((s) => s.lockConfig);
  const applyLockConfig = useSettings((s) => s.applyLockConfig);
  const profileName = useSettings((s) => s.profile.name).trim();
  const unlock = useUI((s) => s.unlock);
  const lockCameraOpen = useUI((s) => s.lockCameraOpen);
  const setLockCameraOpen = useUI((s) => s.setLockCameraOpen);
  // 手电筒补光放全局 store：全屏白时前景（状态栏/横杠）需转黑
  const torch = useUI((s) => s.torchOpen);
  const setTorch = useUI((s) => s.setTorchOpen);

  const now = useNow();
  const battery = useBattery();
  // SSR 首帧兜底：服务端拿不到 useNow（恒 null），过去时钟/日期在首帧 HTML 里是空的，
  // JS 加载完才「凭空出现」——观感是锁屏缺内容闪一下。现在服务端用用户时区（cookie 直通）
  // 直接渲染当前时间；客户端注水后 useNow 接管（suppressHydrationWarning 压制毫秒级偏差）。
  const shown = now ?? ssrWallClock(bootTz);
  // 锁屏壁纸（主题里可独立设置，未设置时跟随主屏幕）。
  // loaded 之前用 BOOT_LOCK_WALL_STYLE（CSS 变量引用）：
  // store selector 在 SSR/水合阶段读创建时快照，具体预设值两边可能不一致（iframe 里服务端只有默认快照）
  // —— 变量引用让 SSR/客户端 style 属性完全相同，真实壁纸由 pre-paint 脚本写进变量，首帧即真实壁纸；
  // 明暗静态标记仍按快照预设取（bootLockWallpaper）。
  const storeLw = useLockWallpaper();
  const storeLoaded = useSettings((s) => s.loaded);
  // boot 脚本算好的锁屏壁纸分区亮度（与 data-boot-lock-light 标记/持久化实测同源）：
  // loaded 前回退它而不是预设静态标记 —— 消灭「boot 首帧颜色 → 水合变色 → load() 再变色」的跳变
  const bootLight = useBootDisplayLight();
  const bootLw = useMemo(() => {
    const preset = WALLPAPER_PRESETS.find((w) => w.id === bootLockWallpaper);
    const staticMark = preset?.light ?? false;
    return {
      style: BOOT_LOCK_WALL_STYLE,
      light: bootLight?.lock?.top ?? staticMark,
      lightBottom: bootLight?.lock?.bottom ?? staticMark,
    };
  }, [bootLockWallpaper, bootLight]);
  const { style: wallpaperStyle, light: presetLight, lightBottom: presetLightBottom } =
    storeLoaded
      ? { ...storeLw, lightBottom: undefined as boolean | undefined }
      : bootLw;
  // 锁屏壁纸层重光栅化：同主屏壁纸层（未解码白缝防护，详见 store.ts useWallpaperDecodedRepaint）
  const lockWallRef = useRef<HTMLDivElement | null>(null);
  useWallpaperDecodedRepaint(wallpaperStyle, lockWallRef);

  const [mode, setMode] = useState<'lock' | 'passcode' | 'resetNew' | 'resetConfirm'>('lock');
  const [errText, setErrText] = useState('');
  const [errSignal, setErrSignal] = useState(0);
  /** 忘记密码重设流程中第一次输入的新密码 */
  const [resetCode, setResetCode] = useState('');

  // 上滑手势（ref 供事件处理器同步读取，state 供渲染）
  const [dy, setDy] = useState(0);
  const dyRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const startY = useRef(0);

  // 壁纸亮度决定前景色：分区域实测壁纸亮度（顶部 0–35% 管状态栏/日期/时钟/小组件，
  // 底部 86–100% 管上滑提示/快捷按钮）——「上亮下暗」的壁纸（如雾山）两端分别选黑/白字，
  // 测量中或失败时回退链：boot 快照分区亮度 → 预设静态标记（三段同源，颜色零跳变）；
  // boot 值兜底尤其关键：load() 移除 data-boot-lock-* CSS 锁的瞬间实测可能尚未落地
  // （自定义壁纸 Blob URL 每会话都变），若直接跳静态标记就会重现「黑→白」变色闪烁 ——
  // 保持 boot 判定值直到实测接管，两端颜色一致（同一张图同一算法）；
  // 自定义壁纸同样实测，浅色图自动改用黑字
  const measured = useMeasuredWallpaperLight(wallpaperStyle);
  const lightWallpaper = measured.top ?? (bootLight?.lock?.top ?? presetLight);
  const lightWallpaperBottom =
    measured.bottom ?? (bootLight?.lock?.bottom ?? (presetLightBottom ?? presetLight));
  const lightText = !lightWallpaper;
  const lightTextBottom = !lightWallpaperBottom;
  const fg = lightText ? 'text-white' : 'text-black/85';
  const widgetBg = lightText ? 'bg-white/45' : 'bg-white/15 backdrop-blur-md';
  const quickBtn = `flex h-[50px] w-[50px] items-center justify-center rounded-full backdrop-blur-md transition active:scale-90 ${
    lightTextBottom ? 'bg-white/45 text-black/80 active:bg-white/60' : 'bg-white/20 text-white active:bg-white/35'
  }`;

  // 下一个即将响铃的闹钟已随闹钟小组件移除；天气快照供天气小组件使用
  const weather = useWeatherSnapshot();
  const wInfo = weather ? weatherCodeInfo(weather.current.code) : null;
  const WeatherIcon = wInfo?.Icon;
  const wTemp = weather ? `${Math.round(weather.current.temperature)}°` : '--°';
  /** 锁屏设备名：个人信息名字 + 的iPhone（名字来自设置-个人信息） */
  const deviceName = profileName ? `${profileName}的iPhone` : 'iPhone';
  // 日期行含农历换算：直接计算，React Compiler 会按真实依赖自动记忆化
  const dateLine = shown ? `${formatSolarShort(shown)} · ${formatLunarDate(shown)}` : '';
  const weekShort = shown ? formatWeekShort(shown) : '';

  // ---------------- 上滑解锁手势 ----------------

  const setDyBoth = (v: number) => {
    dyRef.current = v;
    setDy(v);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'lock') return;
    if ((e.target as HTMLElement).closest('button')) return;
    draggingRef.current = true;
    setIsDragging(true);
    startY.current = e.clientY;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const d = e.clientY - startY.current;
    setDyBoth(d < 0 ? d : d * 0.28);
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    const v = dyRef.current;
    if (v < -110) {
      if (lockConfig.enabled && lockConfig.code) {
        setDyBoth(0);
        setMode('passcode');
      } else {
        // 解锁：保留当前拖拽位移，不回弹；退场动画从手指离开的位置继续上滑，
        // 避免先弹回原位再淡出造成的“主屏一闪而过”撕裂感
        unlock();
      }
    } else {
      setDyBoth(0);
    }
  };

  // ---------------- 密码验证 / 忘记密码重设 ----------------

  const verify = (code: string) => {
    if (code === lockConfig.code) {
      setErrText('');
      setMode('lock');
      try {
        navigator.vibrate?.(10);
      } catch {
        /* 震动不可用 */
      }
      unlock();
    } else {
      setErrSignal((s) => s + 1);
      setErrText('密码错误，请重试');
      try {
        navigator.vibrate?.([60, 40, 60]);
      } catch {
        /* 震动不可用 */
      }
    }
  };

  const onPadComplete = (code: string) => {
    if (mode === 'resetNew') {
      setResetCode(code);
      setErrText('');
      setMode('resetConfirm');
    } else if (mode === 'resetConfirm') {
      if (code === resetCode) {
        // 新密码生效并直接解锁
        applyLockConfig({ ...lockConfig, enabled: true, code });
        setResetCode('');
        setErrText('');
        setMode('lock');
        try {
          navigator.vibrate?.(10);
        } catch {
          /* 震动不可用 */
        }
        unlock();
      } else {
        setResetCode('');
        setMode('resetNew');
        setErrSignal((s) => s + 1);
        setErrText('两次输入不一致，请重新设置');
        try {
          navigator.vibrate?.([60, 40, 60]);
        } catch {
          /* 震动不可用 */
        }
      }
    } else {
      verify(code);
    }
  };

  const openForgot = () => {
    setResetCode('');
    setErrText('');
    setMode('resetNew');
  };

  const cancelPad = () => {
    // 密码/重设页取消：重设中回密码页，密码页回锁屏
    setMode((m) => (m === 'passcode' ? 'lock' : 'passcode'));
    setResetCode('');
    setErrText('');
  };

  const padTitle = mode === 'passcode' ? '输入密码' : mode === 'resetNew' ? '重设密码' : '再输入一次';

  const batteryLevel = battery ? Math.round(battery.level) : null;
  const lowBattery = battery !== null && battery.level < 20 && !battery.charging;

  return (
    <motion.div
      className="absolute inset-0 z-[65] select-none overflow-hidden"
      style={{ touchAction: 'none' }}
      data-lock-screen=""
      // 解锁退场：从当前位置继续上滑并淡出（与拖拽手势无缝衔接）
      exit={{ y: -420, opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
      role="dialog"
      aria-label="锁屏"
    >
      {/* 锁屏自绘壁纸层（盖住主屏幕，只透出壁纸；首帧 = CSS 变量直出真实壁纸）。
          -inset-px：四边各多出 1px，亚像素取整产生的边缘细缝被推到可视区外 */}
      <div ref={lockWallRef} className="absolute -inset-px" style={wallpaperStyle} data-boot-lock-wall="" suppressHydrationWarning aria-hidden="true" />

      {/* initial={false}：首次挂载不播淡入——开机直接整帧呈现锁屏内容，
          否则时钟/小组件在壁纸上先透明再淡入，看起来像锁屏闪了一下 */}
      <AnimatePresence mode="wait" initial={false}>
        {mode === 'lock' ? (
          <motion.div
            key="lock"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.2 }}
          >
            {/* 可拖拽内容层（data-lock-fg：boot 期浅色壁纸的首帧前景色由全局 CSS 覆盖，避免水合后变色闪烁） */}
            <div
              className={`absolute inset-0 flex flex-col ${fg}`}
              data-lock-fg=""
              suppressHydrationWarning
              style={{
                transform: `translateY(${dy}px)`,
                opacity: Math.max(0.3, 1 + Math.min(0, dy) / 420),
                transition: isDragging
                  ? 'none'
                  : 'transform 0.32s cubic-bezier(0.32,0.72,0,1), opacity 0.32s ease',
              }}
            >
              {/* 日期 + 农历 + 大时钟（SSR 首帧即有内容；水合后由客户端时钟接管，suppressHydrationWarning 压制毫秒级偏差警告） */}
              <div className="flex flex-col items-center px-6 pt-[84px]">
                <p className="text-center text-[17px] font-semibold tracking-wide opacity-95" suppressHydrationWarning>
                  {dateLine}
                </p>
                <p
                  className="mt-1 text-center text-[88px] font-semibold leading-[1.05] tracking-[-0.02em] tabular-nums"
                  style={lightText ? { textShadow: '0 2px 18px rgba(0,0,0,0.15)' } : undefined}
                  data-ssr-clock=""
                  suppressHydrationWarning
                >
                  {shown ? formatIOSTime(shown) : ''}
                </p>
              </div>

              {/* 锁屏小组件：×××的iPhone（电量）/ 天气 / 日期（小巧版） */}
              <div className="mt-6 flex items-center justify-center gap-2.5 px-6">
                <div className={`flex h-[64px] w-[118px] flex-col justify-between rounded-[22px] px-3 py-2.5 ${widgetBg}`}>
                  <div className="flex min-w-0 items-center">
                    <span className="min-w-0 truncate text-[11px] font-semibold">{deviceName}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold tabular-nums">
                      {batteryLevel === null ? '--' : `${batteryLevel}%`}
                    </span>
                    <div className={`h-[4px] min-w-0 flex-1 overflow-hidden rounded-full ${lightText ? 'bg-black/15' : 'bg-white/25'}`}>
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${
                          lowBattery ? 'bg-[#FF453A]' : lightText ? 'bg-black/70' : 'bg-white/90'
                        }`}
                        style={{ width: `${batteryLevel === null ? 0 : Math.min(100, Math.max(2, batteryLevel))}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className={`flex h-[64px] w-[64px] flex-col items-center justify-center gap-1 rounded-full ${widgetBg}`} aria-label="锁屏天气">
                  {WeatherIcon ? (
                    <WeatherIcon className="h-[18px] w-[18px]" strokeWidth={2} />
                  ) : (
                    <CloudSun className="h-[18px] w-[18px] opacity-60" strokeWidth={2} />
                  )}
                  <span className="text-[12px] font-semibold tabular-nums">{wTemp}</span>
                </div>
                {/* 日期小组件（iOS 日历风：白底红字） */}
                <div
                  className="flex h-[64px] w-[64px] flex-col items-center justify-center gap-[3px] rounded-full bg-white shadow-[0_5px_14px_rgba(0,0,0,0.2)]"
                  aria-label="锁屏日期"
                >
                  <span className="text-[22px] font-semibold leading-none tabular-nums text-[#FF453A]" suppressHydrationWarning>
                    {shown ? shown.getDate() : '--'}
                  </span>
                  <span className="text-[11px] font-medium leading-none text-black/70" suppressHydrationWarning>
                    {weekShort || '周--'}
                  </span>
                </div>
              </div>

              <div className="flex-1" />

              {/* 底部快捷入口 + 提示 + Home 指示条（颜色跟底部区域壁纸明暗） */}
              <p
                className={`pb-4 text-center text-[13px] font-medium opacity-70 ${
                  lightTextBottom ? 'text-white' : 'text-black/80'
                }`}
              >
                向上轻扫以解锁
              </p>
              <div className="flex items-center justify-between px-12 pb-[58px]">
                <button
                  type="button"
                  aria-label={torch ? '关闭锁屏手电筒' : '打开锁屏手电筒'}
                  aria-pressed={torch}
                  onClick={() => setTorch(!torch)}
                  className={torch ? 'flex h-[50px] w-[50px] items-center justify-center rounded-full bg-white text-black transition active:scale-90' : quickBtn}
                >
                  <Flashlight className="h-[22px] w-[22px]" strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  aria-label="锁屏相机"
                  onClick={() => setLockCameraOpen(true)}
                  className={quickBtn}
                >
                  <Camera className="h-[22px] w-[22px]" strokeWidth={1.9} />
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="pass"
            className="absolute inset-0 flex flex-col items-center bg-black/45 pb-[40px] backdrop-blur-2xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="h-[120px]" />
            <p className="text-[17px] font-medium text-white">{padTitle}</p>
            {mode === 'resetNew' && (
              <p className="mt-1 text-[13px] text-white/55">设置一个新的锁屏密码</p>
            )}
            {mode === 'resetConfirm' && (
              <p className="mt-1 text-[13px] text-white/55">请再次输入相同的密码</p>
            )}
            <PasscodePad
              length={lockConfig.len}
              light
              onComplete={onPadComplete}
              errorSignal={errSignal}
              className="mt-4"
            />
            <p className="mt-3 min-h-[20px] text-[13px] font-medium text-[#FF453A]" role="alert">
              {errText}
            </p>
            <button
              type="button"
              className="mt-auto rounded-full px-6 py-2 text-[17px] text-white/90 transition active:opacity-60"
              onClick={cancelPad}
            >
              取消
            </button>
            {mode === 'passcode' && (
              <button
                type="button"
                onClick={openForgot}
                className="mt-2 text-[14px] text-white/60 underline decoration-white/40 underline-offset-[5px] transition active:opacity-60"
              >
                忘记密码？
              </button>
            )}
            {mode !== 'passcode' && <div className="h-[30px]" aria-hidden="true" />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 手电筒补光（白屏模拟）：整屏即关闭热区，避免“一片空白不知如何退出”。
          onPointerDown 阻断冒泡，防止白屏下的拖拽手势把补光层一起拖着走 */}
      <AnimatePresence>
        {torch && (
          <motion.div
            key="torch"
            role="button"
            aria-label="关闭手电筒"
            tabIndex={0}
            onClick={() => setTorch(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setTorch(false);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute inset-0 z-[20] cursor-pointer bg-white outline-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {/* 顶部状态提示 */}
            <div className="flex flex-col items-center pt-[104px] text-black/45">
              <Flashlight className="h-8 w-8" strokeWidth={1.6} />
              <p className="mt-3 text-[15px] font-medium">手电筒已开启</p>
            </div>
            {/* 底部明显关闭按钮（点整屏任意位置同样关闭） */}
            <div className="absolute inset-x-0 bottom-[96px] flex flex-col items-center gap-3">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/[0.12] text-black/80 ring-1 ring-black/15">
                <FlashlightOff className="h-7 w-7" strokeWidth={1.9} />
              </span>
              <span className="text-[13px] font-medium text-black/55">轻点任意位置关闭</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 锁屏直达相机（不解锁；关闭相机回锁屏） */}
      <AnimatePresence>
        {lockCameraOpen && (
          <motion.div
            key="lockcam"
            className="absolute inset-0 z-[30] bg-black"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            <CameraApp onExit={() => setLockCameraOpen(false)} hideGallery />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
