'use client';

/**
 * 微信「发现 / 我」页彩色线稿图标（对齐微信 8.x 官方风格）：
 * 无底色色块，直接用彩色描边 SVG —— 朋友圈彩色光圈、视频号橙色丝带、
 * 扫一扫双手、听一听音符、看一看六边形花、搜一搜红星、游戏宝石、
 * 小程序 S 环、服务绿色气泡勾、收藏立方体、作品双方块、小店门面、表情笑脸、设置齿轮。
 *
 * 每个组件自带 38×38 槽位（与原 WxTileIcon 同尺寸），保证 WxMenuRow 分隔线对齐不变。
 */

import type { ReactNode } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';

/** 38×38 图标槽位 + 48 viewBox 画布 */
function Slot({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 48 48" className="h-[31px] w-[31px]" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

/** 朋友圈：六叶彩色光圈（绿/蓝/橙/红/黄/紫 环形扇叶） */
const MOMENT_BLADE = 'M28.16 4.44 A20 20 0 0 1 39.76 11.69 L31.49 18.15 A9.5 9.5 0 0 0 25.98 14.71 Z';
const MOMENT_COLORS = ['#07C160', '#1B7AF5', '#FA9D3B', '#FA5151', '#FFC300', '#6467F0'];

export function WxIcMoments() {
  return (
    <Slot>
      {MOMENT_COLORS.map((color, i) => (
        <path key={color} d={MOMENT_BLADE} fill={color} transform={`rotate(${i * 60} 24 24)`} />
      ))}
    </Slot>
  );
}

/** 视频号：橙色双环丝带（蝴蝶结形 W） */
export function WxIcChannels() {
  return (
    <Slot>
      <g stroke="#FA9D3B" strokeWidth={3.4}>
        <path d="M22.5 24 C17 13.5, 5.5 11.5, 5.5 19 C5.5 26.5, 17 27.5, 22.5 24" />
        <path d="M25.5 24 C31 13.5, 42.5 11.5, 42.5 19 C42.5 26.5, 31 27.5, 25.5 24" />
      </g>
    </Slot>
  );
}

/** 扫一扫：蓝色双手取景手势（左手左上、右手右下，点对称） */
const SCAN_HAND =
  'M11 20 A2.6 2.6 0 0 1 16.2 20 A2.6 2.6 0 0 1 21.4 20 A2.6 2.6 0 0 1 26.6 20 ' +
  'C27.6 20 28.2 20.9 28.2 22 C28.2 26.8 24 29.6 19.2 29.6 L15.2 29.6 C12.7 29.6 11 28 11 25.6 Z';

export function WxIcScan() {
  return (
    <Slot>
      <g stroke="#4D9CF8" strokeWidth={3} fill="none">
        <g transform="translate(-1.7 -5.2)">
          <g transform="rotate(115 19.6 23.5)">
            <path d={SCAN_HAND} />
          </g>
        </g>
        <g transform="rotate(180 24 24)">
          <g transform="translate(-1.7 -5.2)">
            <g transform="rotate(115 19.6 23.5)">
              <path d={SCAN_HAND} />
            </g>
          </g>
        </g>
      </g>
    </Slot>
  );
}

/** 听一听：红橙八分音符 */
export function WxIcListen() {
  return (
    <Slot>
      <g stroke="#FA5151" strokeWidth={3.2}>
        <path d="M22.1 32.5 L22.1 11.5" />
        <path d="M22.1 11.5 C28 13.5, 30.5 18.5, 27.8 24" />
      </g>
      <ellipse cx="17.5" cy="33.5" rx="4.8" ry="3.7" fill="#FA5151" transform="rotate(-18 17.5 33.5)" />
    </Slot>
  );
}

/** 看一看：金黄六边形套六边形花结 */
export function WxIcStories() {
  return (
    <Slot>
      <g stroke="#FFC300" strokeWidth={3}>
        <path d="M24 5 L40.5 14.5 L40.5 33.5 L24 43 L7.5 33.5 L7.5 14.5 Z" />
        <path d="M34.5 24 L29.25 33.09 L18.75 33.09 L13.5 24 L18.75 14.91 L29.25 14.91 Z" />
      </g>
    </Slot>
  );
}

/** 搜一搜：红色五瓣旋涡星（搜索星标） */
export function WxIcSearch() {
  const rays = [0, 72, 144, 216, 288].map((deg) => {
    const t = (deg * Math.PI) / 180;
    const pt = (r: number, off: number) =>
      `${(24 + r * Math.cos(t + off)).toFixed(2)} ${(24 + r * Math.sin(t + off)).toFixed(2)}`;
    return `M${pt(4.5, -0.55)} Q${pt(10.5, 0)} ${pt(16.5, 0.5)}`;
  });
  return (
    <Slot>
      <g stroke="#FA5151" strokeWidth={3.2}>
        {rays.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </Slot>
  );
}

/** 游戏：六面彩色宝石（红/橙/蓝/绿/黄/青 切面线稿） */
export function WxIcGames() {
  const facets: Array<[string, string]> = [
    ['#FA5151', 'M6 19 L15 9 L20 19 Z'],
    ['#FA9D3B', 'M15 9 L33 9 L28 19 L20 19 Z'],
    ['#1B7AF5', 'M33 9 L42 19 L28 19 Z'],
    ['#07C160', 'M6 19 L20 19 L24 39 Z'],
    ['#FFC300', 'M20 19 L28 19 L24 39 Z'],
    ['#10AEB5', 'M28 19 L42 19 L24 39 Z'],
  ];
  return (
    <Slot>
      {facets.map(([color, d]) => (
        <path key={color} d={d} stroke={color} strokeWidth={2.4} />
      ))}
    </Slot>
  );
}

/** 小程序：蓝紫圆环 + 手写 S */
export function WxIcMiniProgram() {
  return (
    <Slot>
      <g stroke="#6467F0" strokeWidth={3}>
        <circle cx="24" cy="24" r="17" />
        <path d="M29.5 17 C29.5 14.6, 26.6 13.6, 24 14.6 C21.2 15.7, 20.6 18.6, 22.8 20.1 L25.6 22 C28.2 23.8, 27.9 27.2, 25.2 28.5 C22.6 29.8, 19.3 28.9, 18.6 26.4" />
      </g>
    </Slot>
  );
}

/** 服务：绿色对话气泡 + 对勾 */
export function WxIcServices() {
  return (
    <Slot>
      <path
        d="M24 6.5 C33.7 6.5 41 13.3 41 21.8 C41 30.3 33.7 37 24 37 C21.4 37 18.9 36.5 16.7 35.5 L9 38 L11.3 30.9 C8.9 28.3 7 25.3 7 21.8 C7 13.3 14.3 6.5 24 6.5 Z"
        stroke="#07C160"
        strokeWidth={3}
      />
      <path d="M17.5 22 L22.3 26.8 L30.8 17.5" stroke="#07C160" strokeWidth={3.2} />
    </Slot>
  );
}

/** 收藏：蓝顶 / 橙左 / 红右 的立体立方体线稿 */
export function WxIcFavorites() {
  return (
    <Slot>
      <path d="M24 6 L39 13.5 L24 21 L9 13.5 Z" stroke="#1B7AF5" strokeWidth={2.6} />
      <path d="M9 13.5 L9 29.5 L24 37 L24 21 Z" stroke="#FA9D3B" strokeWidth={2.6} />
      <path d="M24 21 L24 37 L39 29.5 L39 13.5 Z" stroke="#FA5151" strokeWidth={2.6} />
    </Slot>
  );
}

/** 作品：前后两枚圆角方块（前蓝遮后浅蓝） */
export function WxIcWorks() {
  return (
    <Slot>
      <rect x="15" y="7" width="21" height="21" rx="5" stroke="#B9D6FA" strokeWidth={2.8} />
      <rect x="9" y="13" width="21" height="21" rx="5" stroke="#3D7FF5" strokeWidth={2.8} className="fill-white dark:fill-[#1A1A1A]" />
    </Slot>
  );
}

/** 小店与卡包：红色门面（波浪雨棚 + 拱形门） */
export function WxIcShop() {
  return (
    <Slot>
      <g stroke="#FA5151" strokeWidth={2.9}>
        <path d="M8 12 Q8 8.5 11.5 8.5 L36.5 8.5 Q40 8.5 40 12 L40 15 A5.33 5.33 0 0 1 29.33 15 A5.33 5.33 0 0 1 18.67 15 A5.33 5.33 0 0 1 8 15 Z" />
        <path d="M11 18.8 L11 35.5 Q11 39 14.5 39 L33.5 39 Q37 39 37 35.5 L37 18.8" />
        <path d="M19.5 39 L19.5 28.5 Q19.5 25 24 25 Q28.5 25 28.5 28.5 L28.5 39" />
      </g>
    </Slot>
  );
}

/** 表情：金黄笑脸（圆脸 + 咧嘴笑） */
export function WxIcSticker() {
  return (
    <Slot>
      <circle cx="24" cy="24" r="17.5" stroke="#FFC300" strokeWidth={3} />
      <circle cx="17.5" cy="19.5" r="2.3" fill="#FFC300" />
      <circle cx="30.5" cy="19.5" r="2.3" fill="#FFC300" />
      <path d="M15.5 27 C17.5 33.5, 30.5 33.5, 32.5 27" stroke="#FFC300" strokeWidth={3} />
    </Slot>
  );
}

/** 设置：蓝色齿轮（lucide 自带 viewBox，独立于 48 画布） */
export function WxIcSettings() {
  return (
    <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center" aria-hidden="true">
      <SettingsIcon className="h-[30px] w-[30px] text-[#4D9CF8]" strokeWidth={2} />
    </span>
  );
}
