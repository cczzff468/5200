import { cookies } from 'next/headers';
import PhoneShell from '@/components/ios/PhoneShell';
import { DISPLAY_COOKIE_NAME, parseDisplayCookie } from '@/lib/ios/display-cookie';

/**
 * 首帧防闪烁：把「主题/壁纸/锁屏开关」的 cookie 镜像读出来传给手机壳，
 * SSR 直接按用户真实设置渲染锁屏/主屏 —— 刷新/进入网页不再出现黑屏门控。
 */
export default async function Home() {
  const store = await cookies();
  const display = parseDisplayCookie(store.get(DISPLAY_COOKIE_NAME)?.value);
  return <PhoneShell initialDisplay={display} />;
}
