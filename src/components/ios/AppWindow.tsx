'use client';

import { useUI } from '@/lib/ios/store';
import { APP_MAP } from '../apps/registry';

/**
 * App 窗口容器：iOS 风格的打开/关闭缩放动画。
 * Home 指示条由 PhoneShell 统一常显渲染（所有页面一致，mix-blend-difference 自适应背景）。
 */
export default function AppWindow() {
  const activeApp = useUI((s) => s.activeApp);
  const phase = useUI((s) => s.phase);

  if (!activeApp) return null;
  const meta = APP_MAP[activeApp];
  if (!meta) return null;
  const App = meta.component;

  return (
    <div
      role="dialog"
      aria-label={meta.name}
      className={`absolute inset-0 z-40 overflow-hidden bg-background will-change-[transform,opacity] transition-all duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
        phase === 'open' ? 'scale-100 rounded-none opacity-100' : 'scale-[0.18] rounded-[48px] opacity-0'
      }`}
    >
      <App />
    </div>
  );
}
