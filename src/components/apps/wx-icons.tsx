'use client';

/**
 * 微信「发现 / 我 / 钱包」页彩色线稿图标（对齐微信 8.x 官方截图）：
 * 无底色色块，直接用彩色描边 SVG —— 朋友圈彩色光圈、视频号橙色丝带、
 * 扫一扫双手、听一听音符、看一看六边形花结、搜一搜红星、游戏宝石、
 * 小程序 S 环、服务绿色气泡勾、收藏立方体、作品双方块、小店门面、表情笑脸、设置齿轮，
 * 以及钱包页：零钱 ¥ 币、经营账户小店、零钱通钻石、银行卡、亲属卡双卡。
 *
 * 发现/我页图标自带 38×38 槽位（与原 WxTileIcon 同尺寸，WxMenuRow 分隔线对齐不变）；
 * 钱包页图标自带 34×34 槽位（与钱包 row 原 34px 圆标同尺寸，分隔线 left-[62px] 对齐不变）。
 */

import type { ReactNode } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';

/** 38×38 图标槽位 + 48 viewBox 画布（发现 / 我页用） */
function Slot({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 48 48" className="h-[31px] w-[31px]" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

/** 34×34 图标槽位 + 48 viewBox 画布（钱包页用，分隔线 left-[62px] 对齐） */
function Slot34({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 48 48" className="h-[32px] w-[32px]" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

/** 朋友圈：六叶彩色光圈（绿/蓝/橙/红/黄/紫 环形扇叶，扇叶宽 50° 缝 10°） */
const MOMENT_BLADE = 'M27.47 4.30 A20 20 0 0 1 41.32 14 L32.23 19.25 A9.5 9.5 0 0 0 25.65 14.64 Z';
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

/** 视频号：橙色双角丝带（W 形，两支由底部中心向外上卷的号角） */
export function WxIcChannels() {
  return (
    <Slot>
      <g stroke="#FA9D3B" strokeWidth={3.2}>
        <path d="M23.5 33 C16 32, 8 26, 8.5 17.5 C8.8 13, 13 11.5, 16 14.5 C20 18.5, 22.5 25, 23.5 33" />
        <path d="M25 33 C33 32.5, 41.5 25, 41 14.5 C40.8 9.8, 35.8 8.6, 32.6 12 C28 17, 25.8 24, 25 33" />
      </g>
    </Slot>
  );
}

/** 扫一扫：蓝色双手取景手势（左上手从左上伸向右下、右下手点对称；掌 + 四指 + 拇指 组合式，指缝清晰） */
function ScanHand() {
  return (
    <g>
      {/* 掌 */}
      <rect x="8" y="16" width="12.5" height="13.5" rx="5.2" />
      {/* 四根手指（从掌右缘伸出，指缝分明） */}
      <path d="M20.5 17.8 L27.5 17.8" strokeWidth={3.3} />
      <path d="M20.5 21.6 L28.8 21.6" strokeWidth={3.3} />
      <path d="M20.5 25.4 L27.8 25.4" strokeWidth={3.3} />
      <path d="M19.5 29 L24.5 29" strokeWidth={3} />
      {/* 拇指（从掌顶斜伸向右上） */}
      <path d="M13.5 15.5 L17.5 11" strokeWidth={3.3} />
    </g>
  );
}

export function WxIcScan() {
  return (
    <Slot>
      <g stroke="#4D9CF8" fill="none">
        <g transform="translate(-2.5 -5.5)">
          <g transform="rotate(38 18 20)">
            <ScanHand />
          </g>
        </g>
        <g transform="rotate(180 24 24)">
          <g transform="translate(-2.5 -5.5)">
            <g transform="rotate(38 18 20)">
              <ScanHand />
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

/** 看一看：金黄六边形 + 内接六角星花结 */
export function WxIcStories() {
  return (
    <Slot>
      <g stroke="#FFC300">
        <path d="M24 4.5 L40.9 14.25 L40.9 33.75 L24 43.5 L7.1 33.75 L7.1 14.25 Z" strokeWidth={3} />
        <path d="M24 12 L34.39 30 L13.61 30 Z" strokeWidth={2.4} />
        <path d="M24 36 L13.61 18 L34.39 18 Z" strokeWidth={2.4} />
      </g>
    </Slot>
  );
}

/** 搜一搜：红色五瓣星芒（长短参差 + 旋涡弧度） */
const SEARCH_RAYS: Array<[number, number]> = [
  [-88, 12],
  [-160, 14.5],
  [-16, 15.5],
  [118, 13.5],
  [52, 15],
];

export function WxIcSearch() {
  const rays = SEARCH_RAYS.map(([deg, len]) => {
    const t = (deg * Math.PI) / 180;
    const pt = (r: number, off: number) =>
      `${(24 + r * Math.cos(t + off)).toFixed(2)} ${(24 + r * Math.sin(t + off)).toFixed(2)}`;
    return `M${pt(4.2, -0.5)} Q${pt(len * 0.55, 0)} ${pt(len, 0.42)}`;
  });
  return (
    <Slot>
      <g stroke="#FA5151" strokeWidth={3.4}>
        {rays.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </Slot>
  );
}

/** 游戏：六面彩色宝石（红/橙/蓝/绿/黄/青 切面线稿，宽腰带钻石） */
export function WxIcGames() {
  const facets: Array<[string, string]> = [
    ['#FA5151', 'M5 19 L15 10 L19 19 Z'],
    ['#FA9D3B', 'M15 10 L33 10 L29 19 L19 19 Z'],
    ['#1B7AF5', 'M33 10 L43 19 L29 19 Z'],
    ['#07C160', 'M5 19 L19 19 L24 40 Z'],
    ['#FFC300', 'M19 19 L29 19 L24 40 Z'],
    ['#10AEB5', 'M29 19 L43 19 L24 40 Z'],
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

// ---------------- 钱包页（34×34 槽位） ----------------

/** 零钱：金黄 ¥ 圆币（线圈 + ¥） */
export function WxIcChange() {
  return (
    <Slot34>
      <g stroke="#FFC300">
        <circle cx="24" cy="24" r="16" strokeWidth={3} />
        <path d="M18.5 14.5 L24 22 L29.5 14.5" strokeWidth={2.8} />
        <path d="M24 22 L24 32" strokeWidth={2.8} />
        <path d="M18.5 25.5 L29.5 25.5" strokeWidth={2.8} />
        <path d="M18.5 29.5 L29.5 29.5" strokeWidth={2.8} />
      </g>
    </Slot34>
  );
}

/** 经营账户：金黄小店（雨棚 + 门体）+ 右下 ¥ 硬币徽章 */
export function WxIcBizAccount() {
  return (
    <Slot34>
      <g stroke="#F7A500">
        <path
          d="M8 13.5 Q8 9.5 12 9.5 L36 9.5 Q40 9.5 40 13.5 L40 16 A4 4 0 0 1 32 16 A4 4 0 0 1 24 16 A4 4 0 0 1 16 16 A4 4 0 0 1 8 16 Z"
          strokeWidth={2.6}
        />
        <path d="M11 19.5 L11 34.5 Q11 38.5 15 38.5 L33 38.5 Q37 38.5 37 34.5 L37 19.5" strokeWidth={2.6} />
        <circle cx="30.5" cy="31" r="7" strokeWidth={2.4} />
      </g>
      <g stroke="#F7A500" strokeWidth={1.8}>
        <path d="M28.4 28.2 L30.5 31 L32.6 28.2" />
        <path d="M30.5 31 L30.5 34.4" />
        <path d="M28.8 32.1 L32.2 32.1" />
      </g>
    </Slot34>
  );
}

/** 零钱通：金黄钻石（冠部 V 面 + 腰线 + 亭部 V 面） */
export function WxIcFund() {
  return (
    <Slot34>
      <g stroke="#F7B500">
        <path d="M15 9.5 L33 9.5 L41 19.5 L24 39 L7 19.5 Z" strokeWidth={2.8} />
        <path d="M15 9.5 L19.5 19.5 L7 19.5" strokeWidth={2.4} />
        <path d="M33 9.5 L28.5 19.5 L41 19.5" strokeWidth={2.4} />
        <path d="M19.5 19.5 L24 39 L28.5 19.5" strokeWidth={2.4} />
      </g>
    </Slot34>
  );
}

/** 银行卡：蓝色卡片（圆角卡体 + 磁条线） */
export function WxIcBankCard() {
  return (
    <Slot34>
      <g stroke="#4D9CF8">
        <rect x="6.5" y="13.5" width="35" height="21.5" rx="4.5" strokeWidth={3} />
        <path d="M12.5 20.5 L26.5 20.5" strokeWidth={3.2} />
      </g>
    </Slot34>
  );
}

/** 亲属卡：橙金双卡斜叠（后卡橙、前卡金带底色遮挡） */
export function WxIcFamilyCard() {
  return (
    <Slot34>
      <rect x="21.5" y="5" width="17" height="24" rx="4.5" stroke="#F7A500" strokeWidth={2.8} transform="rotate(38 30 17)" />
      <rect
        x="9.5"
        y="19"
        width="17"
        height="24"
        rx="4.5"
        stroke="#F7B500"
        strokeWidth={2.8}
        transform="rotate(38 18 31)"
        className="fill-white dark:fill-[#1A1A1A]"
      />
    </Slot34>
  );
}
