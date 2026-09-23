import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { DISPLAY_COOKIE_NAME, parseDisplayCookie } from "@/lib/ios/display-cookie";
import { bootBackColorOf } from "@/lib/ios/wallpaper-presets";
import { cookies } from "next/headers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Phone — 仿 iOS 智能助手",
  description:
    "高还原度 iOS 风格 AI 聊天手机：灵动岛状态栏、真实电量、相册、相机、计算器、时钟、音乐、天气、备忘录、日历、录音机、浏览器、设置。本地优先，数据存于 IndexedDB。",
  keywords: ["iOS", "AI聊天", "仿苹果", "PWA", "IndexedDB", "Next.js"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 首帧背板 = 壁纸底色（cookie 注水；无 cookie 回退默认锁屏壁纸石墨黑）：
  // 浏览器解析到 <html> 的第一帧就是壁纸色，进网页/刷新不再出现「白底 → 深色锁屏」的闪变
  const jar = await cookies();
  const display = parseDisplayCookie(jar.get(DISPLAY_COOKIE_NAME)?.value);
  const backColor = bootBackColorOf(
    display?.wallpaper ?? 'graphite',
    display?.lockWallpaper ?? 'graphite',
    display?.lockScreen ?? true
  );

  return (
    <html lang="zh-CN" suppressHydrationWarning style={{ backgroundColor: backColor }}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
