'use client';

import { useId, type ComponentType, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import {
  AudioLines,
  Calculator as CalculatorIcon,
  CalendarDays,
  Camera,
  CircleCheck,
  Clock as ClockIcon,
  CloudSun,
  Compass,
  FileText,
  Folder,
  Ghost,
  Image as ImageIcon,
  MessageCircle,
  Music2,
  Palette,
  Phone as PhoneGlyph,
  Settings as SettingsIcon,
  Store,
  Users as UsersIcon,
} from 'lucide-react';
import type { AppId } from '@/lib/ios/store';
import { selectResolvedTheme, useSettings, useSystemDark } from '@/lib/ios/store';
import { useHomeWallpaperLight } from '@/lib/ios/foreground';

// App 组件全部懒加载：主屏/锁屏只需图标，App 代码在点开时才拉取
// （首屏包体积大幅下降，网页打开/水合明显变快）
const ChatApp = dynamic(() => import('./chat'), { ssr: false });
const PhotosApp = dynamic(() => import('./photos'), { ssr: false });
const CameraApp = dynamic(() => import('./camera'), { ssr: false }) as ComponentType;
const MusicApp = dynamic(() => import('./music'), { ssr: false });
const BrowserApp = dynamic(() => import('./browser'), { ssr: false });
const WeatherApp = dynamic(() => import('./weather'), { ssr: false });
const ClockApp = dynamic(() => import('./clock'), { ssr: false });
const ThemesApp = dynamic(() => import('./themes'), { ssr: false });
const FilesApp = dynamic(() => import('./files'), { ssr: false });
const RemindersApp = dynamic(() => import('./reminders'), { ssr: false });
const CalculatorApp = dynamic(() => import('./calculator'), { ssr: false });
const NotesApp = dynamic(() => import('./notes'), { ssr: false });
const CalendarApp = dynamic(() => import('./calendar'), { ssr: false });
const RecorderApp = dynamic(() => import('./recorder'), { ssr: false });
const SettingsApp = dynamic(() => import('./settings'), { ssr: false });
const ContactsApp = dynamic(() => import('./contacts'), { ssr: false });
const PhoneApp = dynamic(() => import('./phone'), { ssr: false });
const WeChatApp = dynamic(() => import('./wechat'), { ssr: false });
const QQApp = dynamic(() => import('./qq'), { ssr: false });
const AppStoreApp = dynamic(() => import('./appstore'), { ssr: false });

export interface AppMeta {
  id: AppId;
  name: string;
  icon: ReactNode;
  component: ComponentType;
  /** 状态栏强制白字（App 顶部背景非背景色系时用：天气蓝天/相机黑底）；缺省=跟随主题明暗 */
  statusBarLight?: boolean;
}

function IconTile({ className = '', children }: { className?: string; children?: ReactNode }) {
  return <div className={`flex h-full w-full items-center justify-center ${className}`}>{children}</div>;
}

/** 线条样式图标（用户参考图：iOS 磨砂玻璃风）——满槽半透明磨砂圆角方形底座
 *  （backdrop-blur 模糊底下壁纸，磨砂质感）+ 粗线条图标，无虚线边框；
 *  深色主题统一「深色烟熏玻璃 + 白色粗线条」（适配深色模式，与壁纸明暗无关）；
 *  浅色主题按主屏幕壁纸明暗自适应（图标画在壁纸上）：深色壁纸上淡白磨砂 + 白线、
 *  浅色壁纸上高白磨砂 + 深灰线保证可见；
 *  壁纸明暗与标签文字同源（useHomeWallpaperLight：图片/自定义壁纸逐像素实测亮度，
 *  静态预设标记仅作测量前兜底）——修「浅色主题 + 自定义白色背景图」时底座/边框/
 *  线条全是白色画在白纸上看不见的问题；自定义壁纸不再硬编码按深色处理；
 *  内缘顶部一道细高光（玻璃质感）；线条加粗（用户要求「里面的变粗一点」）；
 *  variant="card"：卡片底色场景（主题页预览等）强制浅磨砂玻璃 + 深灰线，
 *  不随壁纸/主题翻转（修浅色主题 + 深色壁纸时白线画在浅卡上一片空白） */
function LineIcon({ children, variant = 'auto' }: { children: ReactNode; variant?: 'auto' | 'card' }) {
  const themeMode = useSettings((s) => s.theme);
  const systemDark = useSystemDark();
  const dark = variant === 'card' ? false : selectResolvedTheme(themeMode, systemDark) === 'dark';
  // 壁纸实测亮度（hooks 无条件调用；card 场景不消费结果）
  const lightWallpaper = useHomeWallpaperLight();
  // 卡片场景强制高白磨砂深灰线；壁纸场景：浅色主题 + 浅色壁纸 → 高白磨砂深灰线，
  // 其余（深色主题任意壁纸 / 浅色主题深壁纸）→ 深玻璃白线
  const lightGlass = variant === 'card' ? true : !dark && lightWallpaper;
  return (
    <IconTile className={lightGlass ? 'text-[#48484e]' : 'text-[#f6f6f8]'}>
      <span
        aria-hidden="true"
        className={`flex h-full w-full items-center justify-center rounded-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] ring-1 backdrop-blur-[8px] ${
          lightGlass
            ? 'bg-white/60 ring-black/[0.06]'
            : dark
              ? 'bg-black/[0.32] ring-white/[0.14]'
              : 'bg-white/[0.16] ring-white/[0.12]'
        }`}
      >
        {children}
      </span>
    </IconTile>
  );
}

/** 图标统一规格：60px 位内 30px 线性图标（与 iOS 线性图标比例一致）；
 *  线条加粗（1.7 → 2.2，用户要求图标「里面的变粗一点」） */
/** 真实 iOS 图标（public/icons 的 PNG：自带彩色圆角底），满槽铺满图标位。
 *  图片自带透明圆角（约 22%），稍微放大 1.07 让自身圆角越过容器边被裁掉，
 *  最终圆角完全由容器 rounded-[15px] 决定，十枚图标圆角绝对一致；
 *  附极淡描边 + 柔和投影——备忘录/照片/文件/提醒事项这类白底图标在白色
 *  壁纸/卡片上也有清晰边界（修之前线条图标在白纸上「隐身」的痛点）。
 *  彩色实体底不随主题/壁纸翻转，任何背景下都醒目 */
function RealIconTile({ src }: { src: string }) {
  return (
    <IconTile>
      <span
        aria-hidden="true"
        className="relative block h-full w-full overflow-hidden rounded-[15px] shadow-[0_2px_8px_rgba(0,0,0,0.16)] ring-1 ring-black/[0.06]"
      >
        <Image
          src={src}
          alt=""
          fill
          sizes="60px"
          loading="eager"
          draggable={false}
          className="scale-[1.07] object-cover"
        />
      </span>
    </IconTile>
  );
}

const GLYPH_CLASS = 'h-[30px] w-[30px]';
const GLYPH_STROKE = 2.2;

/** 微信图标：经典双气泡线稿，与其他 App 图标完全同规格——同一磨砂底座（LineIcon 统一
 *  包装）、同 30px 尺寸（GLYPH_CLASS）、同粗线条（GLYPH_STROKE）；大气泡左上、小气泡
 *  右下带一圈留白缝的前后遮挡（SVG mask 挖断大气泡描边，useId 保证多实例不撞 id），
 *  弧线尾巴 + 2+2 实心眼点 */
function WeChatGlyph() {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const maskId = `wx-${uid}`;
  return (
    <svg
      viewBox="0 0 24 24"
      className={GLYPH_CLASS}
      fill="none"
      stroke="currentColor"
      strokeWidth={GLYPH_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        {/* 大气泡描边在小气泡（外扩一圈留白缝）处干净断开 */}
        <mask id={maskId}>
          <rect x="0" y="0" width="24" height="24" fill="#fff" />
          <circle cx="16.6" cy="14.4" r="5.6" fill="#000" />
        </mask>
      </defs>
      {/* 大气泡（左上）+ 左下弧线尾巴 */}
      <g mask={`url(#${maskId})`}>
        <ellipse cx="9.8" cy="8.6" rx="6.6" ry="5.7" />
        <path d="M5.2 12.4C4.4 14 3.3 15.3 2 16.2c2.2-.2 4.1-1 5.7-2.4" />
      </g>
      {/* 小气泡（右下，叠在大气泡前，留白缝隔开）+ 右下弧线尾巴 */}
      <circle cx="16.6" cy="14.4" r="4.7" />
      <path d="M19.4 18c.6 1.4 1.5 2.6 2.7 3.5-1.9-.1-3.6-.9-5-2.2" />
      {/* 2+2 实心眼点 */}
      <circle cx="7.4" cy="7.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.2" cy="7.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.9" cy="13.2" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="18.3" cy="13.2" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** App 定义表：glyph 为裸线条图（不含磨砂底座）；image 为真实图标图片（public 下
 *  路径，满槽实体图标），两者可并存，icon 生成时优先用 image */
interface AppDef {
  id: AppId;
  name: string;
  glyph: ReactNode;
  image?: string;
  component: ComponentType;
  statusBarLight?: boolean;
}

const APP_DEFS: AppDef[] = [
  {
    id: 'photos',
    name: '照片',
    image: '/icons/photos.png',
    glyph: <ImageIcon className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: PhotosApp,
  },
  {
    id: 'weather',
    name: '天气',
    image: '/icons/weather.png',
    glyph: <CloudSun className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: WeatherApp,
    statusBarLight: true,
  },
  {
    id: 'clock',
    name: '时钟',
    image: '/icons/clock.png',
    glyph: <ClockIcon className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: ClockApp,
  },
  {
    id: 'calculator',
    name: '计算器',
    image: '/icons/calculator.png',
    glyph: <CalculatorIcon className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: CalculatorApp,
  },
  {
    id: 'notes',
    name: '备忘录',
    image: '/icons/notes.png',
    glyph: <FileText className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: NotesApp,
  },
  {
    id: 'calendar',
    name: '日历',
    image: '/icons/calendar.png',
    glyph: <CalendarDays className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: CalendarApp,
  },
  {
    id: 'recorder',
    name: '语音备忘录',
    image: '/icons/recorder.png',
    glyph: <AudioLines className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: RecorderApp,
  },
  {
    id: 'reminders',
    name: '提醒事项',
    image: '/icons/reminders.png',
    glyph: <CircleCheck className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: RemindersApp,
  },
  {
    id: 'files',
    name: '文件',
    image: '/icons/files.png',
    glyph: <Folder className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: FilesApp,
  },
  {
    id: 'wechat',
    name: '微信',
    image: '/icons/wechat.png',
    glyph: <WeChatGlyph />,
    component: WeChatApp,
  },
  {
    id: 'qq',
    name: 'QQ',
    image: '/icons/qq.png',
    // 备用线条图（有 image 时不会展示）：幽灵轮廓贴近 QQ 企鹅剪影
    glyph: <Ghost className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: QQApp,
  },
  {
    id: 'contacts',
    name: '联系人',
    image: '/icons/contacts.png',
    glyph: <UsersIcon className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: ContactsApp,
  },
  {
    id: 'phone',
    name: '电话',
    image: '/icons/phone.png',
    glyph: <PhoneGlyph className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: PhoneApp,
  },
  {
    id: 'settings',
    name: '设置',
    image: '/icons/settings.png',
    glyph: <SettingsIcon className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: SettingsApp,
  },
  {
    id: 'themes',
    name: '主题',
    image: '/icons/themes.png',
    glyph: <Palette className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: ThemesApp,
  },
  {
    id: 'chat',
    name: '信息',
    image: '/icons/chat.png',
    glyph: <MessageCircle className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: ChatApp,
  },
  {
    id: 'browser',
    name: '浏览器',
    image: '/icons/browser.png',
    glyph: <Compass className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: BrowserApp,
  },
  {
    id: 'music',
    name: '音乐',
    image: '/icons/music.png',
    glyph: <Music2 className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: MusicApp,
  },
  {
    id: 'camera',
    name: '相机',
    image: '/icons/camera.png',
    glyph: <Camera className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: CameraApp,
    statusBarLight: true,
  },
  {
    id: 'appstore',
    name: 'App Store',
    image: '/icons/appstore.png',
    glyph: <Store className={GLYPH_CLASS} strokeWidth={GLYPH_STROKE} />,
    component: AppStoreApp,
  },
];

/** appId → 真实图标图片路径（有 image 字段的 App），供卡片底色场景（AppIconTile）复用 */
const IMAGES = Object.fromEntries(
  APP_DEFS.filter((d) => d.image).map((d) => [d.id, d.image]),
) as Partial<Record<AppId, string>>;

/** 壁纸上的图标（主屏网格 / Dock / Spotlight / 多任务）：真实 iOS 图标满槽铺满；
 *  其余保持磨砂玻璃底座随壁纸明暗与主题自适应 */
export const APPS: AppMeta[] = APP_DEFS.map(({ glyph, image, ...rest }) => ({
  ...rest,
  icon: image ? <RealIconTile src={image} /> : <LineIcon>{glyph}</LineIcon>,
}));

/** 各 App 裸线条图（appId → glyph），供卡片底色场景（AppIconTile）重组使用 */
const GLYPHS = Object.fromEntries(APP_DEFS.map((d) => [d.id, d.glyph])) as Record<AppId, ReactNode>;

/** 卡片底色上的图标预览（主题页「自定义图标」区、App Store 列表等）：真实 iOS 图标
 *  原样展示（自带彩色底任何卡片上都清晰）；线条图标 App 强制「浅磨砂玻璃底座 +
 *  深灰线条」不随壁纸/主题翻转——修复浅色主题 + 深色壁纸时预览一片空白 */
export function AppIconTile({ id }: { id: AppId }) {
  const image = IMAGES[id];
  if (image) return <RealIconTile src={image} />;
  return <LineIcon variant="card">{GLYPHS[id]}</LineIcon>;
}

export const APP_MAP: Record<AppId, AppMeta> = Object.fromEntries(APPS.map((a) => [a.id, a])) as Record<AppId, AppMeta>;

/** 底部 Dock（用户指定：信息 / 联系人 / 电话 / 设置） */
const DOCK_IDS: AppId[] = ['chat', 'contacts', 'phone', 'settings'];

/** 主屏幕网格 App（除 Dock 外全部 14 个；具体分页排布见 HomeScreen 的 defaultLayout） */
export const GRID_APPS: AppMeta[] = APPS.filter((a) => !DOCK_IDS.includes(a.id));

/** 底部 Dock（4 个） */
export const DOCK_APPS: AppMeta[] = DOCK_IDS.map((id) => APP_MAP[id]);
