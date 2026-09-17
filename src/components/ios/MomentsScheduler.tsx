'use client';

/**
 * 朋友圈/QQ动态 全局调度器：挂在 PhoneShell（App 不打开也照常结算），每 5s 调一次 runMomentsTick：
 * - 结算延迟队列：用户动态的 AI 互动（1-2 位好友点赞/评论）+ 用户回复 AI 评论后的多轮再回复（重启不丢）；
 * - 自动发布：每角色×平台的三种触发（定时 / 频率 / 聊天灵感），内容由 AI 按人设生成，失败退避重试。
 *
 * 机主展示名从各平台登录态推导（localStorage 会话 id → 联系人 → displayNameOf），
 * 与朋友圈/QQ 发动态时写入的 authorName 同源，保证调度器写入的数据和 App 内一致；
 * 联系人列表每分钟刷新一次（新加好友自动纳入调度）。
 */

import { useEffect } from 'react';
import { displayNameOf, type ContactRecord } from '@/lib/contacts';
import { listContacts } from '@/lib/ios/contacts-store';
import { useSettings } from '@/lib/ios/store';
import { runMomentsTick, type MomentTickDeps } from '@/lib/moments';

const TICK_MS = 5000;
const CONTACTS_REFRESH_MS = 60_000;

const WX_SESSION_KEY = 'wx-session-user-id';
const QQ_SESSION_KEY = 'qq-session-user-id';

/** 登录会话 → 机主展示名（与微信/QQ App 内 me.name 同源；未登录返回空串跳过该平台） */
function sessionName(contacts: ContactRecord[], lsKey: string): string {
  try {
    const id = window.localStorage.getItem(lsKey);
    if (!id) return '';
    const hit = contacts.find((c) => c.id === id && c.kind === 'user');
    return hit ? displayNameOf(hit) : '';
  } catch {
    return '';
  }
}

export default function MomentsScheduler() {
  useEffect(() => {
    let alive = true;
    let busy = false;
    let contacts: ContactRecord[] = [];
    let contactsAt = 0;

    const tick = async () => {
      if (!alive || busy) return;
      busy = true;
      try {
        const now = Date.now();
        if (contacts.length === 0 || now - contactsAt > CONTACTS_REFRESH_MS) {
          contacts = await listContacts().catch(() => contacts);
          contactsAt = now;
        }
        const deps: MomentTickDeps = {
          apiConfig: useSettings.getState().apiConfig,
          contacts,
          wxUserName: sessionName(contacts, WX_SESSION_KEY),
          qqUserName: sessionName(contacts, QQ_SESSION_KEY),
        };
        await runMomentsTick(deps);
      } catch {
        // 动态是增强能力，任何异常静默（内部已有重试/退避）
      } finally {
        busy = false;
      }
    };

    const timer = window.setInterval(() => void tick(), TICK_MS);
    void tick();
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
