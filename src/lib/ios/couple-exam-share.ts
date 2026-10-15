'use client';

/**
 * 恋爱水平考试分享（第十五轮）——考试 ⇄ 微信/QQ 聊天卡片流。
 *
 * 用户规格：
 * - 我可以喊 TA 来答题：把当前试卷以卡片发进会话，TA（AI）延时认真作答并自评分；
 * - TA 也会自己出卷喊我来答：TA 的卡片点进来直达恋人空间的试卷答题页；
 * 复用 couple-pact-share 的成熟管线（落库 + 广播 + 通知 + 导航事件）。
 */

import { kvGet, kvGetScoped, kvSet, kvSetScoped } from './idb-kv';
import { genId } from './db';
import { getContact } from './contacts-store';
import { avatarFor, displayNameOf } from '@/lib/contacts';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { isProactiveChatActive } from './proactive-msg';
import { COUPLE_CARD_EVENT, dispatchStateEvent, readInviteMeta, type CoupleChannel } from './couple-invite';

// ---------------- 类型 ----------------

/** 恋爱考试卡片数据（挂在消息 examcard 字段；微信/QQ 聊天共用） */
export interface CoupleExamCardData {
  title: string; // 试卷名
  count: number; // 题数
  from: 'me' | 'ta'; // 谁发起（我喊TA答 / TA喊我答）
  fromName: string;
  toName: string;
  app: CoupleChannel;
  contactId: string;
  at: number;
}

/** 点击卡片后的待打开考试（ExamPage 消费） */
interface PendingExamOpen {
  from: 'me' | 'ta';
  at: number;
}

let pendingExamOpen: PendingExamOpen | null = null;

/** 聊天考试卡片点击 → 写待打开目标（切换 App 时带上） */
export function setPendingExamOpen(from: 'me' | 'ta'): void {
  pendingExamOpen = { from, at: Date.now() };
}

/** ExamPage 挂载时消费待打开目标（读后即清） */
export function consumePendingExamOpen(): PendingExamOpen | null {
  const p = pendingExamOpen && Date.now() - pendingExamOpen.at < 60_000 ? pendingExamOpen : null;
  pendingExamOpen = null;
  return p;
}

/** 供测试/兜底：读当前待打开考试（不清除） */
export function peekPendingExamOpen(): PendingExamOpen | null {
  return pendingExamOpen;
}

// ---------------- 消息落库（与 couple-pact-share 同款管线） ----------------

function msgsKey(channel: CoupleChannel, contactId: string): string {
  return `${channel}-chat-msgs:${contactId}`;
}

/** 恢复被「删除/不显示」的会话行 */
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

/** 灵动岛通知 + 未读角标 */
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
 * 把一场恋爱水平考试以卡片形式发进微信/QQ 会话。
 * dir='me'：我喊 TA 来答题（卡片 role='me'，随后 AI 延时作答）；
 * dir='ta'：TA（AI）出卷喊我来答（卡片 role='peer'，点击直达答题页）。
 */
export async function sendExamCard(opts: { channel: CoupleChannel; contactId: string; title: string; count: number; dir: 'me' | 'ta' }): Promise<void> {
  const { channel, contactId, title, count, dir } = opts;
  if (!contactId || !title) return;
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
    if (dir === 'me' && typeof snap.taName === 'string' && snap.taName.trim()) taName = snap.taName.trim();
    if (dir === 'ta' && typeof snap.taName === 'string' && snap.taName.trim()) taName = snap.taName.trim();
    if (dir === 'ta' && typeof snap.meName === 'string' && snap.meName.trim()) meName = snap.meName.trim();
  } catch {
    /* 静默 */
  }
  const data: CoupleExamCardData = {
    title,
    count: Math.max(1, count || 1),
    from: dir,
    fromName: dir === 'me' ? meName : taName,
    toName: dir === 'me' ? taName : meName,
    app: channel,
    contactId,
    at: Date.now(),
  };
  const msg = {
    id: genId(),
    role: dir === 'me' ? 'me' : 'peer',
    content: '',
    time: Date.now(),
    kind: 'examcard',
    examcard: data,
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
  const preview = dir === 'me' ? `我喊你来答题！《${title}》共 ${count} 题，看你能得多少分` : `我出了张卷子《${title}》，点进来答，考考你`;
  void notifyCard(channel, contactId, preview);
}

// ---------------- 导航（卡片点击 → 恋人空间考试页） ----------------

/** 聊天考试卡片点击后的导航事件名（CoupleSpaceApp 监听 → openSub('exam')） */
export const COUPLE_EXAM_NAV_EVENT = 'couple-exam-nav';

/**
 * 聊天里的考试卡片被点击：记下待打开目标 + 切进恋人空间 + 广播导航事件。
 * （ExamPage 挂载后 consumePendingExamOpen 直达对应答题/查看界面）
 */
export function navToExam(from: 'me' | 'ta'): void {
  setPendingExamOpen(from);
  try {
    window.dispatchEvent(new CustomEvent(COUPLE_EXAM_NAV_EVENT, { detail: { from } }));
  } catch {
    /* 非浏览器环境忽略 */
  }
}

// ---------------- 我喊 TA 答卷 → TA 延时作答 ----------------

/**
 * 我把卷子分享给 AI 后：TA 延时认真作答（人设 + 记忆），结果写进恋人空间状态 + 回一条聊天 + 通知。
 */
export function scheduleAiExamAnswer(opts: { channel: CoupleChannel; contactId: string; title: string; questions: { q: string; opts: string[] }[] }): void {
  const meta = readInviteMeta();
  if (meta.partnerContactId !== opts.contactId) return; // 只对恋人联系人生效
  window.setTimeout(() => {
    void (async () => {
      try {
        const { aiExamSheet, coupleRemember } = await import('./couple-ai');
        const r = await aiExamSheet(opts.title, opts.questions);
        if (!r) return;
        // 写进恋人空间状态（TA 的答卷）
        let taN = 'TA';
        let meN = '我';
        try {
          const s = kvGet<Record<string, unknown>>('couple-space:state') ?? {};
          if (typeof s.taName === 'string' && s.taName.trim()) taN = s.taName.trim();
          if (typeof s.meName === 'string' && s.meName.trim()) meN = s.meName.trim();
          kvSet('couple-space:state', { ...s, examTaSheet: { title: opts.title, picks: r.picks, score: r.score, comment: r.comment, at: Date.now() } });
          dispatchStateEvent();
        } catch {
          /* 状态落盘失败静默 */
        }
        // TA 的交卷留言落到会话
        const key = msgsKey(opts.channel, opts.contactId);
        try {
          const raw = kvGetScoped<unknown[]>(key, opts.channel);
          const list = Array.isArray(raw) ? raw.filter((m) => m && typeof m === 'object') : [];
          list.push({
            id: genId(),
            role: 'peer',
            content: `卷子我答完交啦，自己估了 ${r.score} 分。${r.comment}`,
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
        void notifyCard(opts.channel, opts.contactId, '我把卷子答完交啦，快去批卷');
        coupleRemember(opts.contactId, opts.channel, `${taN}答了${meN}出的恋爱考试卷《${opts.title}》，自评 ${r.score} 分，交卷时说：「${r.comment}」`);
      } catch {
        /* AI 作答失败静默 */
      }
    })();
  }, 6000 + Math.random() * 7000);
}
