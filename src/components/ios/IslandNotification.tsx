'use client';

/**
 * 全局灵动岛通知层（PhoneShell 挂载，覆盖所有 App / 主屏 / 锁屏）。
 *
 * 动画（模拟 iOS 灵动岛通知）：
 * - 展开：从灵动岛胶囊几何（118×33 圆角 17）弹性展开为通知卡（宽高自适应内容，最高不超出屏宽），
 *   内容在卡片基本展开后淡入，形变过程无重排闪烁；
 * - 收起：内容先淡出，卡片缩回胶囊几何，动画完成后由 finishExit 恢复灵动岛 / 展示队列下一条
 *   （收起期间灵动岛保持隐藏，缩回终点与静态灵动岛同位同色，交接无缝）；
 * - 3 秒自动收起（计时在页面不可见/熄屏时冻结）；点击立即收起并跳转对应聊天。
 *
 * 层级 z-[93]：高于锁屏/切换器/闹钟/状态栏，仅低于熄屏黑遮罩（熄屏=屏幕关了，不看）。
 */

import { useEffect } from 'react';
import { motion, type Transition } from 'framer-motion';
import {
  activateCurrentNotification,
  armAutoDismiss,
  clearAutoDismiss,
  finishExit,
  useIslandNotify,
  NOTIFY_APP_ICON,
  type NotifyApp,
} from '@/lib/ios/island-notify';
import { useUI } from '@/lib/ios/store';

const APP_NAME: Record<NotifyApp, string> = { wechat: '微信', qq: 'QQ', chat: '信息' };

/** 展开姿态：宽高自适应内容（framer 会测 auto 尺寸做补间） */
const EXPANDED = { width: 'auto', height: 'auto', borderRadius: 24 } as const;
/** 收起姿态：回到灵动岛胶囊几何（与 PhoneShell 静态灵动岛完全一致） */
const PILL = { width: 118, height: 33, borderRadius: 17 } as const;
const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 };
const TWEEN_OUT: Transition = { duration: 0.24, ease: [0.4, 0, 0.2, 1] };

function NotifyCard() {
  const current = useIslandNotify((s) => s.current)!;
  const exiting = useIslandNotify((s) => s.exiting);
  // 熄屏时冻结自动收起，唤醒后续期（与页面不可见冻结同策略）
  const screenOff = useUI((s) => s.screenOff);
  useEffect(() => {
    if (screenOff || exiting) {
      clearAutoDismiss();
    } else {
      armAutoDismiss();
    }
    return clearAutoDismiss;
  }, [screenOff, exiting, current]);

  return (
    <motion.div
      key={current.id}
      data-testid="island-notification"
      role="button"
      aria-label={`${APP_NAME[current.app]}通知：${current.title} ${current.body}`}
      initial={PILL}
      animate={exiting ? PILL : EXPANDED}
      transition={exiting ? TWEEN_OUT : SPRING}
      onAnimationComplete={() => {
        if (exiting) finishExit();
      }}
      onClick={activateCurrentNotification}
      className="pointer-events-auto relative max-w-[calc(100%-16px)] cursor-pointer overflow-hidden bg-black text-white shadow-[0_12px_32px_-10px_rgba(0,0,0,0.55)] outline-none"
    >
      {/* 内容：展开基本完成后淡入，收起立即淡出（避免形变过程内容重排可见） */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: exiting ? 0 : 1 }}
        transition={exiting ? { duration: 0.08 } : { duration: 0.16, delay: 0.14 }}
        className="flex w-[336px] max-w-full items-center gap-2.5 px-2 py-2.5"
      >
        {/* 角色头像 + App 图标角标（微信消息带微信角标、QQ 消息带 QQ 角标、信息带信息角标） */}
        <div className="relative h-[38px] w-[38px] shrink-0">
          {current.avatar ? (
            <img
              src={current.avatar}
              alt=""
              className="h-full w-full rounded-full bg-muted object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-full bg-white/15 text-[16px] font-medium">
              {current.title.slice(0, 1)}
            </div>
          )}
          <img
            src={NOTIFY_APP_ICON[current.app]}
            alt=""
            className="absolute -bottom-[3px] -right-[3px] h-[16px] w-[16px] rounded-[4px] ring-1 ring-black/30"
            draggable={false}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[13px] font-semibold leading-[17px]">{current.title}</span>
            {current.subtitle ? (
              <span className="truncate text-[11px] leading-[17px] text-white/50">{current.subtitle}</span>
            ) : null}
            {current.count > 1 ? (
              <span
                data-testid="island-notification-count"
                className="ml-auto shrink-0 rounded-full bg-white/15 px-1.5 text-[10px] leading-[16px] text-white/80"
              >
                {current.count} 条
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[12px] leading-[16px] text-white/85">{current.body}</div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function IslandNotificationLayer() {
  const current = useIslandNotify((s) => s.current);
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-[11px] z-[93] flex flex-col items-center"
      role="status"
      aria-live="polite"
    >
      {current ? <NotifyCard key={current.id} /> : null}
    </div>
  );
}
