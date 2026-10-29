'use client';

/**
 * 古早主题（retro）图标套件（第五十四轮）
 * ---------------------------------------------------------------------------
 *  2012-2014 年代拟物复古图标（微信 / QQ 古早主题专用）：
 *  - Tab 图标：粗线条（2.2）方角线稿（iOS 6 时代 App 通用语言），
 *    颜色随 currentColor（宿主用 .rt-tab-on 复古蓝选中态）；
 *  - RetroIc：iOS 6 拟物圆角方块底座（上高光渐变 + 1px 硬边 + 做旧滤镜），
 *    套在发现/我/动态页的彩色 SVG 图标外（.rt-ic 全局类提供材质）。
 */

/** 复古 Tab 图标通用外壳：粗线条方角线稿（尺寸由 className 控制） */
function RtIconBase({ children, className = 'h-[22px] w-[22px]' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 微信 Tab：老式方角对话气泡（左上直角 + 内三点） */
export function RtChatIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <path d="M4 5 H20 V17 H9 L5.5 20.5 V17 H4 Z" />
      <circle cx="9" cy="11" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="11" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11" r="0.6" fill="currentColor" stroke="none" />
    </RtIconBase>
  );
}

/** 通讯录 Tab：老式名片本（方框 + 人形 + 右侧装订线） */
export function RtContactsIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M7.5 16 C7.5 13.8 9.2 12.8 12 12.8 C14.8 12.8 16.5 13.8 16.5 16" />
      <circle cx="12" cy="9.4" r="2.3" />
    </RtIconBase>
  );
}

/** 发现 Tab：老式指南针罗盘（方圆结合 + 指针） */
export function RtDiscoverIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M15.2 8.8 L13.4 13.4 L8.8 15.2 L10.6 10.6 Z" fill="currentColor" stroke="none" />
    </RtIconBase>
  );
}

/** 我 Tab：老式人像卡（方框 + 半身像） */
export function RtMeIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <circle cx="12" cy="8.6" r="3.1" />
      <path d="M5.8 19 C5.8 15.2 8.6 13.6 12 13.6 C15.4 13.6 18.2 15.2 18.2 19" />
    </RtIconBase>
  );
}

/** QQ 消息 Tab：老式方角铃铛 */
export function RtBellIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <path d="M6 17 V11 C6 7.8 8.4 5.6 12 5.6 C15.6 5.6 18 7.8 18 11 V17" />
      <path d="M4.4 17 H19.6" />
      <path d="M10.2 19.4 C10.2 20.4 11 21 12 21 C13 21 13.8 20.4 13.8 19.4" />
    </RtIconBase>
  );
}

/** QQ 联系人 Tab：老式双人名片 */
export function RtUsersIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <circle cx="9.4" cy="9" r="2.8" />
      <path d="M4 18.6 C4 15.4 6.4 13.8 9.4 13.8 C12.4 13.8 14.8 15.4 14.8 18.6" />
      <path d="M15.4 7.2 C17.2 7.6 18.4 9.2 18.4 11 C18.4 12.6 17.6 13.8 16.4 14.4" />
      <path d="M16.6 18.6 C16.6 16.6 16 15.2 15 14.2" />
    </RtIconBase>
  );
}

/** QQ 动态 Tab：老式五角星（方角化） */
export function RtStarIcon({ className }: { className?: string }) {
  return (
    <RtIconBase className={className}>
      <path d="M12 4 L14.4 9.2 L20 10 L16 14 L17 19.6 L12 17 L7 19.6 L8 14 L4 10 L9.6 9.2 Z" />
    </RtIconBase>
  );
}

/** iOS 6 拟物圆角方块底座：套住任意彩色 SVG 图标（.rt-ic 材质 + 做旧滤镜）。
 *  tone = 可选复古渐变底色（css background 值）；缺省 = 银灰底座。 */
export function RetroIc({
  children,
  tone,
  size = 30,
  radius = 7,
}: {
  children: React.ReactNode;
  /** 复古渐变底（如 'linear-gradient(180deg,#A8D8CF 0%,#7FB8AE 100%)'）；缺省银灰 */
  tone?: string;
  size?: number;
  radius?: number;
}) {
  return (
    <span className="rt-ic" style={{ width: size, height: size, borderRadius: radius, ...(tone ? { background: tone } : {}) }}>
      {children}
    </span>
  );
}

/** 古早主题发现/我/动态页图标配色（iOS 6 拟物渐变：上浅下深同色系 + 硬边阴影由 .rt-ic 提供） */
export const RETRO_ICON_TONES = {
  moments: 'linear-gradient(180deg, #9FD4CB 0%, #6FAFA4 100%)', // 朋友圈 复古青绿
  channels: 'linear-gradient(180deg, #D89A96 0%, #B96F6A 100%)', // 视频号 复古红
  scan: 'linear-gradient(180deg, #9FB4D8 0%, #6E86B4 100%)', // 扫一扫 复古蓝
  listen: 'linear-gradient(180deg, #DDB684 0%, #BC8F55 100%)', // 听一听 复古橙
  stories: 'linear-gradient(180deg, #D4C68C 0%, #B2A361 100%)', // 看一看 复古黄
  search: 'linear-gradient(180deg, #A8B2C4 0%, #7D8899 100%)', // 搜一搜 复古灰蓝
  games: 'linear-gradient(180deg, #B49AD4 0%, #8A6EB2 100%)', // 游戏 复古紫
  theme: 'linear-gradient(180deg, #D4A2C0 0%, #B0749A 100%)', // 主题 复古粉
  wallet: 'linear-gradient(180deg, #A2CC8E 0%, #74A45E 100%)', // 钱包 复旧绿
  favorites: 'linear-gradient(180deg, #D8A884 0%, #B47C55 100%)', // 收藏 复古橘
  works: 'linear-gradient(180deg, #8FB8B8 0%, #5F9090 100%)', // 视频/作品
  sticker: 'linear-gradient(180deg, #D9A8A0 0%, #B57568 100%)', // 表情
  settings: 'linear-gradient(180deg, #A8A8B4 0%, #7C7C8A 100%)', // 设置 复古灰
  zone: 'linear-gradient(180deg, #9FB4D8 0%, #6E86B4 100%)', // QQ 空间 复古蓝
  farm: 'linear-gradient(180deg, #A2CC8E 0%, #74A45E 100%)', // 农场 复古绿
} as const;
