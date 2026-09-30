'use client';

/**
 * 头像快照同步器（换头像 → 所有历史展示位立即换新头像的数据面）：
 *
 * 联系人头像统一存一份（Contact.avatar 全局默认 + avatars 按 App 槽位），聊天界面/联系人列表/
 * 通话记录等渲染时直接读联系人实时值；但朋友圈动态、互动消息、新的朋友通知等历史数据里
 * 还散落着「写入当时的头像快照」。本模块在头像变化时把这些存量快照批量改写为新头像：
 *
 * - contacts-store.updateContact 检测到头像变化 → 广播 `contact-avatar-changed` 事件（带 contactId）；
 * - 本模块监听事件 → 单联系人增量同步（moments.ts 的动态/互动消息 + 微信「新的朋友」通知）；
 * - 启动时 MomentsScheduler 调 syncAllAvatarSnapshots() 做一次全量校准（幂等，兜住漏同步的存量）；
 * - 同步落盘后 moments.ts 会广播 moments-changed，打开中的朋友圈/空间页面立即重读刷新；
 * - 渲染端另有 liveAvatarOf() 实时读取兜底（联系人还在就永远显示当前头像），双保险。
 *
 * 覆盖范围（快照位置）：wx-moments / qq-zone-posts（作者头像）、moments-inbox:wx|qq（actorAvatar）、
 * wx-friend-reqs（新的朋友通知头像）；群聊消息/联系人/通话等读取点本身实时，无需同步。
 */

import { avatarFor, displayNameOf, type ContactRecord } from '@/lib/contacts';
import { syncAllMomentAvatarSnapshots, syncMomentAvatarSnapshots } from '@/lib/moments';
import { getContact, listContacts } from '@/lib/ios/contacts-store';
import { kvGet, kvSet } from '@/lib/ios/idb-kv';

/** 微信「新的朋友」通知存储键（与 wechat.tsx 的 LS_WX_REQS 同键；形状 {id,name,avatar,message,time}） */
const WX_REQS_KEY = 'wx-friend-reqs';

/** 名字命中：展示名 / 真名 / 昵称任一相等（与 moments.ts 的 avatarOwnerMatches 同一归属口径） */
function avatarNameMatches(name: string, contact: ContactRecord): boolean {
  if (!name) return false;
  return name === displayNameOf(contact) || name === contact.name || name === (contact.realName ?? '');
}

/** 微信「新的朋友」通知头像快照 → 按名字命中联系人即改写为当前头像（值相同跳过，幂等） */
function syncWxFriendReqAvatars(contact: ContactRecord): boolean {
  try {
    const raw = kvGet<{ id: string; name: string; avatar: string | null; message: string; time: number }[]>(WX_REQS_KEY);
    if (!Array.isArray(raw) || raw.length === 0) return false;
    const cur = avatarFor(contact, 'wx');
    let changed = false;
    const next = raw.map((r) => {
      if (!r || typeof r.name !== 'string' || !avatarNameMatches(r.name, contact)) return r;
      if ((r.avatar ?? null) === (cur ?? null)) return r;
      changed = true;
      return { ...r, avatar: cur };
    });
    if (changed) kvSet(WX_REQS_KEY, next);
    return changed;
  } catch {
    return false;
  }
}

let installed = false;

/**
 * 安装头像变更监听（模块导入即生效，全局唯一）：收到 `contact-avatar-changed` 后
 * 对该联系人做增量同步（朋友圈/空间历史动态 + 两平台互动消息 + 微信新的朋友通知）。
 */
export function installAvatarSync(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('contact-avatar-changed', ((e: Event) => {
    const contactId = (e as CustomEvent<{ contactId?: string }>).detail?.contactId;
    if (!contactId) return;
    void (async () => {
      try {
        await syncMomentAvatarSnapshots(contactId);
        const contact = await getContact(contactId);
        if (contact) syncWxFriendReqAvatars(contact);
      } catch {
        // 同步失败静默（渲染端 liveAvatarOf 兜底，显示仍正确）
      }
    })();
  }) as EventListener);
}

/** 启动全量校准（幂等）：所有联系人的历史头像快照统一对齐当前头像 */
export function syncAllAvatarSnapshots(): void {
  void (async () => {
    try {
      const contacts = await listContacts();
      for (const contact of contacts) syncWxFriendReqAvatars(contact);
      await syncAllMomentAvatarSnapshots();
    } catch {
      // 忽略
    }
  })();
}
