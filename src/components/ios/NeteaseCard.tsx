'use client';

/**
 * 网易云音乐小组件（第三页 2×3 方格，用户参考图样式）：
 * 圆角卡片上方叠一只黑胶唱片（唱臂从右上角探到盘面，盘面缓慢旋转表示播放中），
 * 卡片内为右上角投播徽标、进度条（1:15 / -2:38）、退带/暂停/快进控制键、
 * 底部「一起听」语音胶囊（播放三角 + 声波条）。
 * 盘缘装饰徽标（爱心/声波）已按用户要求删除。
 * 纯装饰卡片：点击打开音乐 App（WIDGET_META.openApp 驱动）；无投影，仅轻描边
 * （与其它小组件一致，用户要求小组件无阴影）。
 * 深浅主题自适应（用户要求小组件适配深色）：浅色=浅灰卡黑字，深色=炭黑卡白字；
 * 黑胶唱片本体黑盘 + 浅盘标两态通用（黑胶本来就更适合深色）。
 */

import { Airplay, FastForward, Pause, Play, Rewind } from 'lucide-react';
import { selectResolvedTheme, useSettings, useSystemDark } from '@/lib/ios/store';

/** 底部胶囊里的声波条高度序列（固定值，避免随机数导致水合不一致） */
const WAVE_BARS = [7, 11, 15, 9, 17, 12, 8, 16, 10, 18, 9, 14, 7, 12, 16, 8, 10, 6];

export function NeteaseCardWidget() {
  const themeMode = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const dark = selectResolvedTheme(themeMode, systemDark) === 'dark';
  return (
    <div className="relative h-[260px] w-full select-none">
      {/* 黑胶唱片（缓慢旋转）：黑色盘体 + 细密纹路 + 盘标 + 中心孔 */}
      <div className="absolute left-1/2 top-[10px] z-[1] h-[104px] w-[104px] -translate-x-1/2">
        <div
          aria-hidden="true"
          className="h-full w-full rounded-full bg-[#17171a] animate-[netease-spin_16s_linear_infinite]"
        >
          {/* 纹路（同心细圈） */}
          <span className="absolute inset-[5px] rounded-full border border-white/[0.07]" />
          <span className="absolute inset-[13px] rounded-full border border-white/[0.06]" />
          <span className="absolute inset-[21px] rounded-full border border-white/[0.05]" />
          {/* 盘标 + 中心孔 */}
          <span className={`absolute left-1/2 top-1/2 h-[44px] w-[44px] -translate-x-1/2 -translate-y-1/2 rounded-full ${dark ? 'bg-[#34343a]' : 'bg-[#ececef]'}`} />
          <span className="absolute left-1/2 top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#17171a]" />
        </div>
      </div>

      {/* 唱臂：右上角枢轴 → 弯臂探向盘面（唱头落在唱片纹路上；白臂深浅两态均可见） */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute right-[6px] top-[2px] z-[2] h-[48px] w-[64px]"
        viewBox="0 0 64 48"
        fill="none"
      >
        <path d="M56 10 L28 40" stroke="#f2f2f4" strokeWidth="3.4" strokeLinecap="round" />
        <path d="M28 40 L21 47" stroke="#f2f2f4" strokeWidth="6" strokeLinecap="round" />
        <circle cx="56" cy="10" r="7" fill="#f2f2f4" />
        <circle cx="56" cy="10" r="2.6" fill="#9a9aa0" />
      </svg>

      {/* 卡片主体（上缘被唱片压住；深浅主题自适应） */}
      <div className={`absolute inset-x-0 bottom-0 top-[84px] rounded-[24px] ring-1 ${dark ? 'bg-[#232327] ring-white/[0.08]' : 'bg-[#e9e9ec] ring-black/[0.06]'}`}>
        {/* 投播徽标（右上） */}
        <span className={`absolute right-[10px] top-[12px] flex h-[24px] w-[24px] items-center justify-center rounded-full ${dark ? 'bg-[#3a3a41]' : 'bg-[#d6d6da]'}`}>
          <Airplay className={`h-[12px] w-[12px] ${dark ? 'text-[#eaeaec]' : 'text-[#2c2c30]'}`} strokeWidth={2.2} aria-hidden="true" />
        </span>

        {/* 进度条（55% 处圆点）+ 时间 */}
        <div className="absolute inset-x-[18px] top-[64px]">
          <span className={`relative block h-[2.5px] rounded-full ${dark ? 'bg-[#48484e]' : 'bg-[#c6c6cb]'}`}>
            <span className={`absolute inset-y-0 left-0 w-[55%] rounded-full ${dark ? 'bg-[#f0f0f2]' : 'bg-[#232327]'}`} />
            <span className={`absolute right-[calc(55%-4px)] -top-[3px] h-[9px] w-[9px] rounded-full ${dark ? 'bg-[#f0f0f2]' : 'bg-[#232327]'}`} />
          </span>
          <div className={`mt-[5px] flex items-center justify-between text-[11px] leading-none tabular-nums ${dark ? 'text-[#a0a0a6]' : 'text-[#77777d]'}`}>
            <span>1:15</span>
            <span>-2:38</span>
          </div>
        </div>

        {/* 控制键（实心：退带 / 暂停 / 快进） */}
        <div className={`absolute inset-x-0 top-[104px] flex items-center justify-center gap-[24px] ${dark ? 'text-[#ececef]' : 'text-[#1d1d21]'}`}>
          <Rewind className="h-[19px] w-[19px]" fill="currentColor" strokeWidth={1} aria-hidden="true" />
          <Pause className="h-[22px] w-[22px]" fill="currentColor" strokeWidth={1} aria-hidden="true" />
          <FastForward className="h-[19px] w-[19px]" fill="currentColor" strokeWidth={1} aria-hidden="true" />
        </div>

        {/* 「一起听」语音胶囊（播放三角 + 白色声波条） */}
        <div className={`absolute bottom-[10px] left-1/2 flex h-[34px] w-[126px] -translate-x-1/2 items-center gap-[7px] rounded-full pl-[12px] pr-[10px] ${dark ? 'bg-[#3d3d44]' : 'bg-[#cfcfd4]'}`}>
          <Play className="h-[13px] w-[13px] shrink-0 fill-white text-white" aria-hidden="true" />
          <span className="flex flex-1 items-center gap-[2.5px]" aria-hidden="true">
            {WAVE_BARS.map((h, i) => (
              <span key={i} className="w-[2px] rounded-full bg-white" style={{ height: `${h}px` }} />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
