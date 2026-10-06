'use client';

/**
 * 美团订单全局调度器（挂在 PhoneShell，App 不打开也生效，对齐 ProactiveMsgWatcher 模式）：
 * - 每 4s 推进当前美团账号订单状态机（待支付超时取消 / 商家接单 / 骑手取餐 / 已送达）；
 * - 状态变化时弹灵动岛通知（美团外卖 · 图标点击经 takeNotifyNavigation('meituan')
 *   跳回美团订单详情）+ 派发 mt-orders-changed 事件刷新打开中的美团界面；
 * - 未登录美团（无会话）时空转，零开销。
 */
import { useEffect } from 'react';
import { pushChatNotification } from '@/lib/ios/island-notify';
import { mtAdvanceOrders, mtGetSession, mtStatusBody, mtUidOf, type MtSession } from '@/lib/ios/meituan-store';

export default function MeituanOrderWatcher() {
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      try {
        const s: MtSession | null = mtGetSession();
        if (!s) return;
        const transitions = mtAdvanceOrders(mtUidOf(s));
        if (transitions.length === 0) return;
        for (const t of transitions) {
          pushChatNotification({
            sessionKey: `mt:order:${t.order.id}`,
            app: 'meituan',
            title: '美团外卖',
            avatar: '/icons/meituan.png',
            body: mtStatusBody(t.order),
            target: { app: 'meituan', contactId: t.order.id },
          });
        }
        window.dispatchEvent(new CustomEvent('mt-orders-changed'));
      } catch {
        /* 后台推进失败不打扰用户 */
      }
    };
    tick();
    const iv = setInterval(tick, 4000);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopped = true;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return null;
}
