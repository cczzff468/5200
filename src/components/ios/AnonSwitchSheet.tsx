'use client';

import { useEffect, useState } from 'react';
import { EyeOff, Plus, UserRound, X } from 'lucide-react';
import {
  accountDisplayName,
  createAccount,
  getAccounts,
  getActiveAccountId,
  MAIN_ACCOUNT_ID,
  switchAccount,
  type PhoneAccount,
} from '@/lib/ios/accounts';

/**
 * 匿名号码切换弹层（Task 40-E，电话/信息 App 共享）：
 * - 半屏底部弹层（iOS action-sheet 风）：圆角 18px 顶部 + 毛玻璃卡 + 遮罩点击关闭 + slide-up 动画
 *   （进出场用 rAF 驱动的 transition，与 IOSActionSheet 同一套 260ms iOS 曲线，不用 tailwindcss-animate）。
 * - 列表 = 全部 kind==='anon' 账号（getAccounts() 过滤）：深灰圆头像（EyeOff 面具感）+ 名字 + 号码小字；
 *   当前使用行右侧绿点 + 「当前使用」；点其他行 → switchAccount(id)（写标记 + location.reload()，
 *   整页重启后 DB 层按新账号开库——reload 前不调用 onClose，也无机会调用）。
 * - 「新建匿名号码」行（+ 圆钮）→ createAccount('anon') → switchAccount(newId)。
 * - 当前活跃账号非大号时列表顶部加「返回大号（机主）」行 → switchAccount(MAIN_ACCOUNT_ID)。
 * - 深浅色适配：面板用半透明浅灰/深灰 + backdrop-blur（对照 IOSActionSheet 配色），
 *   行/分隔线用 foreground 语义色，跟随 App 内深浅色变量。
 *
 * 用法（渲染在 App 自己的 relative 容器内，绝对定位铺满该 App）：
 *   <AnonSwitchSheet open={anonSheetOpen} onClose={() => setAnonSheetOpen(false)} />
 */

/** iOS 弹层曲线（与 IOSActionSheet 一致） */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** 匿名号号码脱敏：前 2 后 4（32****5644）——拨号键盘徽标与弹层行共用 */
export function maskAnonPhone(phone: string): string {
  if (phone.length <= 6) return phone;
  return `${phone.slice(0, 2)}****${phone.slice(-4)}`;
}

interface AnonSheetSnapshot {
  activeId: string;
  anons: PhoneAccount[];
}

function readSnapshot(): AnonSheetSnapshot {
  return {
    activeId: getActiveAccountId(),
    anons: getAccounts().filter((a) => a.kind === 'anon'),
  };
}

export function AnonSwitchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  /** 挂载开关（退场动画期间仍挂载） */
  const [mounted, setMounted] = useState(open);
  /** 进场/退场动画状态 */
  const [shown, setShown] = useState(false);
  /** 注册表现读快照：切号 = 整页 reload，打开期间数据不可能变化，打开时读一次即可 */
  const [snap, setSnap] = useState<AnonSheetSnapshot>(() => readSnapshot());

  // open 切换时驱动进/退场动画 + 刷新账号快照（setState 全部在 rAF/timeout 回调内，遵守 React Compiler lint）
  useEffect(() => {
    let raf = 0;
    let inner = 0;
    let timer = 0;
    if (open) {
      raf = requestAnimationFrame(() => {
        // 快照刷新与挂载同帧完成（open 首次置真时兜底重读注册表；setState 在 rAF 回调内，遵守 lint）
        setSnap(readSnapshot());
        setMounted(true);
        inner = requestAnimationFrame(() => setShown(true));
      });
    } else {
      raf = requestAnimationFrame(() => {
        setShown(false);
        // 退场动画播完后再真正卸载
        timer = window.setTimeout(() => setMounted(false), 210);
      });
    }
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(inner);
      window.clearTimeout(timer);
    };
  }, [open]);

  if (!mounted) return null;

  const { activeId, anons } = snap;

  return (
    <div className="absolute inset-0 z-[70]" role="dialog" aria-label="匿名号码" aria-modal="true">
      {/* 遮罩（点击关闭） */}
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className={`absolute inset-0 cursor-default bg-black/45 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* 半屏面板（slide-up） */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 flex max-h-[76%] flex-col overflow-hidden rounded-t-[18px] bg-[#f6f6f8]/95 shadow-[0_-10px_40px_rgba(0,0,0,0.22)] backdrop-blur-2xl transition-transform duration-[260ms] dark:bg-[#242426]/95 ${
          shown ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ transitionTimingFunction: EASE }}
      >
        {/* 标题栏：左侧关闭 X（同电话 App 主动来电设置弹层），居中标题 */}
        <div className="relative flex h-12 shrink-0 items-center justify-center border-b border-black/[0.06] dark:border-white/[0.08]">
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="absolute left-3 grid h-8 w-8 place-items-center rounded-full text-muted-foreground active:bg-foreground/10"
          >
            <X className="h-5 w-5" strokeWidth={2.2} />
          </button>
          <p className="text-[16px] font-semibold">匿名号码</p>
        </div>
        <p className="shrink-0 px-5 pb-1 pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
          切换后拨号/短信都以匿名身份进行，聊天与记忆完全独立
        </p>

        {/* 账号列表（超出可滚动；顶部在非大号身份时多一行「返回大号」） */}
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2">
          <div className="overflow-hidden rounded-[14px] bg-white/80 ring-1 ring-black/[0.05] dark:bg-white/[0.07] dark:ring-white/[0.08]">
            {/* 返回大号（当前非大号身份时显示在最上） */}
            {activeId !== MAIN_ACCOUNT_ID && (
              <button
                type="button"
                data-testid="anon-back-main"
                onClick={() => switchAccount(MAIN_ACCOUNT_ID)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors active:bg-black/[0.05] dark:active:bg-white/[0.08]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white">
                  <UserRound className="h-[19px] w-[19px]" strokeWidth={1.9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] leading-tight">返回大号（机主）</span>
                  <span className="mt-0.5 block truncate text-[12.5px] leading-tight text-muted-foreground">
                    回到机主身份，聊天与记忆恢复本号数据
                  </span>
                </span>
              </button>
            )}

            {/* 匿名号列表（当前行 = 绿点 + 「当前使用」；点其他行切号 → reload） */}
            {anons.map((a, i) => {
              const current = a.id === activeId;
              const separated = activeId !== MAIN_ACCOUNT_ID || i > 0;
              return (
                <button
                  key={a.id}
                  type="button"
                  data-testid={`anon-row-${a.id}`}
                  onClick={() => (current ? onClose() : switchAccount(a.id))}
                  aria-current={current ? 'true' : undefined}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors active:bg-black/[0.05] dark:active:bg-white/[0.08] ${
                    separated ? 'border-t border-black/[0.06] dark:border-white/[0.08]' : ''
                  }`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#3a3a3c] text-white dark:bg-[#57575b]">
                    <EyeOff className="h-[18px] w-[18px]" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] leading-tight">{accountDisplayName(a)}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] leading-tight tabular-nums text-muted-foreground">
                      {maskAnonPhone(a.phone)}
                    </span>
                  </span>
                  {current && (
                    <span className="flex shrink-0 items-center gap-1.5 text-[13px] leading-none text-[#34C759]">
                      <span className="h-2 w-2 rounded-full bg-[#34C759]" aria-hidden="true" />
                      当前使用
                    </span>
                  )}
                </button>
              );
            })}

            {/* 空态提示（还没有任何匿名号时） */}
            {anons.length === 0 && (
              <div className="px-3 py-4 text-center text-[13px] leading-relaxed text-muted-foreground">
                还没有匿名号码
                <br />
                点下方「新建匿名号码」创建一个
              </div>
            )}

            {/* 新建匿名号码（创建后立即切过去 → reload） */}
            <button
              type="button"
              data-testid="anon-create"
              onClick={() => {
                const acc = createAccount('anon');
                switchAccount(acc.id);
              }}
              className="flex w-full items-center gap-3 border-t border-black/[0.06] px-3 py-2.5 text-left transition-colors active:bg-black/[0.05] dark:border-white/[0.08] dark:active:bg-white/[0.08]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground dark:bg-white/[0.14]">
                <Plus className="h-[20px] w-[20px]" strokeWidth={2.1} />
              </span>
              <span className="min-w-0 flex-1 text-[16px] leading-tight">新建匿名号码</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
