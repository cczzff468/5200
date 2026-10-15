'use client';

/**
 * 恋爱协议分享（第十二轮）——协议 ⇄ 微信/QQ 聊天卡片流。
 *
 * 用户规格：
 * - 协议可以分享给 AI（我拟的协议发到微信/QQ 会话，AI 决定签不签）；
 * - AI 也可以分享协议给我（AI 拟协议时自动发卡片，点卡片进恋人空间签署界面）；
 * - 分享协议在聊天界面是一张卡片，点击卡片进入签署协议界面。
 *
 * 实现模式（复用 couple-invite 的成熟管线）：
 * - 卡片注入：直写 `${app}-chat-msgs:${cid}`（按目标 App 账号作用域 kvGetScoped/kvSetScoped）
 *   + 恢复被隐藏会话 + 广播 COUPLE_CARD_EVENT（聊天页在场时实时合并上屏）+ 灵动岛通知 + 未读角标；
 * - 点击卡片 → 写 pendingPactOpen + 切进恋人空间 App → PactPage 消费后跳对应界面；
 * - 我分享给 AI → AI 延时决定签/不签（couple-ai.aiDecidePact），结果写回协议记录 + 记忆 + 通知。
 */

import { kvGet, kvGetScoped, kvSetScoped } from './idb-kv';
import { genId } from './db';
import { getContact } from './contacts-store';
import { avatarFor, displayNameOf } from '@/lib/contacts';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { isProactiveChatActive } from './proactive-msg';
import { COUPLE_CARD_EVENT, readInviteMeta, type CoupleChannel } from './couple-invite';

// ---------------- 类型 ----------------

/** 恋爱协议卡片数据（挂在消息 pactcard 字段；微信/QQ 聊天共用） */
export interface CouplePactCardData {
  title: string; // 协议名
  preamble: string; // 协议声明（可空）
  clauses: string[]; // 条款（卡片展示前 2 条 + 共 N 条）
  from: 'me' | 'ta'; // 谁分享的（我发给 TA / TA 发给我）
  status: 'pending' | 'signed' | 'declined'; // pending=待对方签署 signed=已签署 declined=已婉拒
  fromName: string;
  toName: string;
  app: CoupleChannel; // 卡片所在渠道
  contactId: string; // 卡片所在会话的联系人 id
  pactId?: string; // 关联恋人空间里的协议记录 id（pacts 里）或 'ai'（TA 拟的草稿）
  reason?: string; // declined 时的理由（TA 说的）
  at: number; // 分享时间
}

/** 点击卡片后的待打开协议（PactPage 消费） */
interface PendingPactOpen {
  pactId?: string; // pacts 记录 id
  from: 'me' | 'ta'; // 卡片来源
  at: number;
}

let pendingPactOpen: PendingPactOpen | null = null;

/** 聊天协议卡片点击 → 写待打开目标（切换 App 时带上；同 200ms 内重复点击去重） */
export function setPendingPactOpen(p: { pactId?: string; from: 'me' | 'ta' }): void {
  pendingPactOpen = { ...p, at: Date.now() };
}

/** PactPage 挂载时消费待打开目标（读后即清） */
export function consumePendingPactOpen(): PendingPactOpen | null {
  const p = pendingPactOpen && Date.now() - pendingPactOpen.at < 60_000 ? pendingPactOpen : null;
  pendingPactOpen = null;
  return p;
}

// ---------------- 消息落库（微信/QQ 会话注入；与 couple-invite 同款管线） ----------------

function msgsKey(channel: CoupleChannel, contactId: string): string {
  return `${channel}-chat-msgs:${contactId}`;
}

/** 恢复被「删除/不显示」的会话行（与各端 saveMsgs 的真微信行为一致） */
function restoreHiddenChat(channel: CoupleChannel, contactId: string): void {
  try {
    const key = channel === 'wx' ? 'wx-chat-hidden' : 'qq-chat-hidden';
    const raw = window.localStorage.getItem(key);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return;
    const next = arr.filter((x) => x !== contactId);
    if (next.length === arr.length) return;
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* 隐藏列表读不到/写不进都不影响消息落库 */
  }
}

/** 灵动岛通知 + 未读角标（正在查看的会话不 bump，与主动消息口径一致） */
async function notifyCard(channel: CoupleChannel, contactId: string, body: string): Promise<void> {
  try {
    const c = await getContact(contactId);
    if (!c) return;
    const notifyApp = channel === 'wx' ? ('wechat' as const) : ('qq' as const);
    pushChatNotification({
      sessionKey: `${channel}:${contactId}`,
      app: notifyApp,
      title: displayNameOf(c),
      avatar: avatarFor(c, channel),
      body,
      target: { app: notifyApp, contactId },
    });
    if (!isProactiveChatActive(channel, contactId)) {
      (channel === 'wx' ? wxUnreads : qqUnreads).bump(contactId, 1);
    }
  } catch {
    /* 通知失败静默 */
  }
}

/**
 * 把一份恋爱协议以卡片形式发进微信/QQ 会话。
 * dir='me'：我把协议分享给 TA（消息 role='me'，随后 AI 延时决定签/不签并回话）；
 * dir='ta'：TA（AI）把协议分享给我（消息 role='peer'，点卡片进签署界面）。
 */
export async function sendPactCard(opts: {
  channel: CoupleChannel;
  contactId: string;
  title: string;
  preamble: string;
  clauses: string[];
  dir: 'me' | 'ta';
  pactId?: string;
  status?: 'pending' | 'signed' | 'declined';
  reason?: string;
}): Promise<void> {
  const { channel, contactId, title, clauses, dir } = opts;
  if (!contactId || !title) return;
  // 双方名字（渠道身份）：我 = 渠道账号社交名；TA = 联系人展示名
  let meName = '我';
  let taName = 'TA';
  try {
    const c = await getContact(contactId);
    if (c) taName = displayNameOf(c) || c.name || 'TA';
  } catch {
    /* 静默 */
  }
  try {
    const snap = kvGet<Record<string, unknown>>('couple-space:state') ?? {};
    if (dir === 'me' && typeof snap.meName === 'string' && snap.meName.trim()) meName = snap.meName.trim();
    if (dir === 'ta' && typeof snap.taName === 'string' && snap.taName.trim()) taName = snap.taName.trim();
    if (dir === 'me' && typeof snap.taName === 'string' && snap.taName.trim()) taName = snap.taName.trim();
    if (dir === 'ta' && typeof snap.meName === 'string' && snap.meName.trim()) meName = snap.meName.trim();
  } catch {
    /* 静默 */
  }
  const data: CouplePactCardData = {
    title,
    preamble: opts.preamble ?? '',
    clauses: (clauses ?? []).slice(0, 8),
    from: dir,
    status: opts.status ?? 'pending',
    fromName: dir === 'me' ? meName : taName,
    toName: dir === 'me' ? taName : meName,
    app: channel,
    contactId,
    pactId: opts.pactId,
    reason: opts.reason,
    at: Date.now(),
  };
  const msg = {
    id: genId(),
    role: dir === 'me' ? 'me' : 'peer',
    content: '',
    time: Date.now(),
    kind: 'pactcard',
    pactcard: data,
  };
  const key = msgsKey(channel, contactId);
  try {
    const raw = kvGetScoped<unknown[]>(key, channel);
    const list = Array.isArray(raw) ? raw.filter((m) => m && typeof m === 'object') : [];
    list.push(msg);
    kvSetScoped(key, list, channel);
  } catch {
    /* 落库失败静默 */
  }
  restoreHiddenChat(channel, contactId);
  try {
    window.dispatchEvent(new CustomEvent(COUPLE_CARD_EVENT, { detail: { cid: contactId, app: channel } }));
  } catch {
    /* 广播失败不影响落库 */
  }
  const preview = dir === 'me' ? `我给你发了一份恋爱协议《${title}》，等你签名哦` : `给你分享了一份恋爱协议《${title}》，点击看看`;
  void notifyCard(channel, contactId, preview);
}

/** 更新某条协议卡片的状态（AI 签/拒后；直写落库，广播让聊天页刷新同 id 消息） */
export function patchPactCardInMsgs(channel: CoupleChannel, contactId: string, msgId: string, patch: Partial<CouplePactCardData>): void {
  const key = msgsKey(channel, contactId);
  try {
    const raw = kvGetScoped<unknown[]>(key, channel);
    if (!Array.isArray(raw)) return;
    const list = raw.map((m) => {
      const x = m as { id?: unknown; pactcard?: unknown };
      if (x && x.id === msgId && x.pactcard && typeof x.pactcard === 'object') {
        return { ...x, pactcard: { ...(x.pactcard as Record<string, unknown>), ...patch } };
      }
      return x;
    });
    kvSetScoped(key, list, channel);
  } catch {
    /* 落库失败静默 */
  }
  try {
    window.dispatchEvent(new CustomEvent(COUPLE_CARD_EVENT, { detail: { cid: contactId, app: channel } }));
  } catch {
    /* 广播失败不影响 */
  }
}

/**
 * 我把协议分享给 AI 后：AI 延时决定签/不签（像收到卡片后认真看了一遍）。
 * 结果 = { agree, reason }，由调用方写回协议记录；这里同时回一条 TA 的文字消息到会话。
 */
export function scheduleAiPactDecision(opts: {
  channel: CoupleChannel;
  contactId: string;
  title: string;
  clauses: string[];
  onDone: (r: { agree: boolean; reason: string }) => void;
}): void {
  const meta = readInviteMeta();
  if (meta.partnerContactId !== opts.contactId) return; // 只对恋人联系人生效
  window.setTimeout(() => {
    void (async () => {
      try {
        const { aiDecidePact } = await import('./couple-ai');
        const r = await aiDecidePact(opts.title, opts.clauses);
        // TA 的回复落到会话（一条普通文字消息，像看完协议后回的话）
        const key = msgsKey(opts.channel, opts.contactId);
        try {
          const raw = kvGetScoped<unknown[]>(key, opts.channel);
          const list = Array.isArray(raw) ? raw.filter((m) => m && typeof m === 'object') : [];
          list.push({
            id: genId(),
            role: 'peer',
            content: r.agree ? `协议我看过了，${r.reason} 我签啦，以后一起遵守哦。` : `这份协议我想了想，还是先不签了：${r.reason}。我们要不要再商量商量？`,
            time: Date.now(),
          });
          kvSetScoped(key, list, opts.channel);
        } catch {
          /* 静默 */
        }
        try {
          window.dispatchEvent(new CustomEvent(COUPLE_CARD_EVENT, { detail: { cid: opts.contactId, app: opts.channel } }));
        } catch {
          /* 静默 */
        }
        void notifyCard(opts.channel, opts.contactId, r.agree ? `你的协议我签好啦` : `关于那份协议，我想跟你说说`);
        opts.onDone(r);
      } catch {
        /* AI 决定失败静默 */
      }
    })();
  }, 5000 + Math.random() * 6000);
}

/** 供测试/兜底：读当前待打开协议（不清除） */
export function peekPendingPactOpen(): PendingPactOpen | null {
  return pendingPactOpen;
}

/** 聊天协议卡片点击后的导航事件名（CoupleSpaceApp 监听 → openSub('pact')） */
export const COUPLE_PACT_NAV_EVENT = 'couple-pact-nav';

/**
 * 聊天里的协议卡片被点击：记下待打开目标 + 切进恋人空间 + 广播导航事件。
 * （气泡组件调用；CoupleSpaceApp 收到事件后 openSub('pact')，PactPage 挂载后 consumePendingPactOpen 跳对应界面）
 */
export function navToPact(p: { pactId?: string; from: 'me' | 'ta' }): void {
  setPendingPactOpen(p);
  try {
    window.dispatchEvent(new CustomEvent(COUPLE_PACT_NAV_EVENT, { detail: p }));
  } catch {
    /* 非浏览器环境忽略 */
  }
}
