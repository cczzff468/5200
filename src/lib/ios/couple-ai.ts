'use client';

/**
 * 恋人空间 × AI 深度参与（第九轮）。
 *
 * 用户规格：
 * - AI（恋人联系人）根据人设/记忆/上下文参与恋人空间的一切：
 *   每天想你、照顾爱情小树、设置纪念日、回答甜蜜小问答（并知道我答了什么）、
 *   写心情日记（并知道我的心情/日记）、发起 100 件小事、知道恋爱协议内容并自己签字/自己拟协议让我签、
 *   知道恋爱编年史、主动填写情侣印象里对我的印象；
 * - 情侣空间里的所有东西都要让 AI 知道（聊天人设注入），所有东西都要写进记忆（记忆碎片）。
 *
 * 三条链路：
 * 1) coupleChatBlock(contactId, channel, userName)：微信/QQ 每轮发消息时同步组装【恋人空间】注入段
 *    ——AI「知道」你们的一切（同步读 kv，随用随取，永远最新）；
 * 2) coupleRemember(...)：情侣空间事件 → 恋人的记忆碎片（memAddEventFragment，sourceTag='couple'），
 *    由 CoupleSpaceApp 的 patch 钩子自动 diff 触发——用户做的每件事都进记忆；
 * 3) runCoupleAiTick(channel, contactId)：AI 主动行为调度（打开恋人空间触发，每日/周期去重，
 *    LLM 按「人设 + 共享记忆」生成内容，失败本地兜底，写状态 + 写记忆 + 灵动岛通知）。
 */

import { kvGet, kvSet } from './idb-kv';
import { memAddEventFragment } from '@/lib/memory';
import { pushChatNotification } from './island-notify';
import { wxUnreads, qqUnreads } from '@/lib/unread-store';
import { isProactiveChatActive } from './proactive-msg';
import { getContact, listContacts } from './contacts-store';
import { avatarFor, displayNameOf } from '@/lib/contacts';
import { dispatchStateEvent, readInviteMeta, type CoupleChannel } from './couple-invite';

// ---------------- 状态形状（与 couple-space.tsx 的 CoupleState 保持结构兼容的只读子集） ----------------

const STATE_KEY = 'couple-space:state';

interface CoupleSnap {
  accepted?: boolean;
  anniversary?: string | null;
  meName?: string;
  taName?: string;
  signature?: string;
  missYou?: number;
  missYouByDay?: Record<string, number>;
  missSince?: string | null;
  taMissYou?: number;
  taMissYouByDay?: Record<string, number>;
  tree?: number;
  treeStreak?: { last: string | null; n: number };
  taTreeStreak?: { last: string | null; n: number };
  quiz?: { id: string; q: string; a: string; at: number }[];
  quizTa?: { q: string; a: string; at: number }[];
  moods?: { id: string; emoji: string; text: string; at: number; dateKey?: string; from?: string }[];
  chronicle?: { id: string; text: string; at: number }[];
  chronicleMonths?: { ym: string; status: string }[];
  hundred?: number[];
  hundredItems?: Record<string, { img: string | null; desc: string; date: string; place: string; byTa?: boolean }>;
  aiHundred?: { idx: number; note: string; why: string; at: number }[];
  pactAt?: number | null;
  pactTitle?: string;
  pactPreamble?: string;
  pactClauses?: string[];
  pactSignMe?: string | null;
  pactSignTa?: string | null;
  aiPact?: { title: string; preamble: string; clauses: string[]; at: number } | null;
  annivExtra?: { key: string; label: string; date: string }[];
  aiAnnivKeys?: string[];
  impressionsMe?: string[];
  impressionsTa?: string[];
  aiImpressions?: string[];
  aiImpressAt?: number | null;
  myLoc?: { name: string; lat: number; lng: number } | null;
  taLoc?: { name: string; lat: number; lng: number } | null;
  meetLoc?: { name: string; lat: number; lng: number } | null;
  letters?: { id: string; text: string; at: number }[];
  aiLog?: { id: string; text: string; at: number }[];
}

/** 同步读恋人空间状态（kv 内存缓存同步权威；未建立关系返回 null） */
function readSnap(): CoupleSnap | null {
  try {
    const s = kvGet<Record<string, unknown>>(STATE_KEY) ?? {};
    if (s.accepted !== true) return null;
    const meta = readInviteMeta();
    if (!meta.partnerContactId) return null;
    return s as CoupleSnap;
  } catch {
    return null;
  }
}

/** 直写恋人空间状态（读-改-写 + 广播；打开中的 App 会经 COUPLE_STATE_EVENT 自动刷新） */
function writeSnap(patch: (s: Record<string, unknown>) => Record<string, unknown> | null): void {
  try {
    const s = kvGet<Record<string, unknown>>(STATE_KEY) ?? {};
    const next = patch({ ...s });
    if (!next) return;
    kvSet(STATE_KEY, next);
  } catch {
    /* 落盘失败静默 */
  }
  dispatchStateEvent();
}

function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysSinceAnniv(anniv: string | null | undefined): number | null {
  if (!anniv) return null;
  const start = new Date(`${anniv}T00:00:00`).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((Date.now() - start) / 86400000) + 1);
}

function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function cut(s: string | undefined | null, max: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// ---------------- 链路一：聊天人设注入（AI 知道恋人空间的一切） ----------------

/**
 * 组装【恋人空间】聊天注入段（同步；微信/QQ 私聊每轮发送时调用）。
 * 只有「当前聊天对象就是恋人绑定联系人」时才注入（别人的记忆里不该有你们的情侣空间）。
 * 内容为空（未建立关系/全部字段空）返回空串——调用方照旧不注入。
 */
export function coupleChatBlock(contactId: string, channel: CoupleChannel, userName: string): string {
  const snap = readSnap();
  if (!snap) return '';
  const meta = readInviteMeta();
  if (meta.partnerContactId !== contactId) return '';

  const me = (snap.meName || '').trim() || userName || '我';
  const ta = (snap.taName || '').trim() || 'TA';
  const lines: string[] = [];
  const days = daysSinceAnniv(snap.anniversary);
  if (days != null) lines.push(`- 你们已经在恋人空间在一起 ${days} 天（纪念日 ${snap.anniversary}）。`);

  // 纪念日
  const anniv = (snap.annivExtra ?? []).slice(0, 4);
  if (anniv.length > 0) lines.push(`- 纪念日：${anniv.map((a) => `${cut(a.label, 16)}（${a.date}）`).join('、')}`);

  // 想你
  const today = todayKey();
  const myToday = snap.missYouByDay?.[today] ?? 0;
  const taToday = snap.taMissYouByDay?.[today] ?? 0;
  if ((snap.missYou ?? 0) > 0 || (snap.taMissYou ?? 0) > 0) {
    lines.push(`- 每天想你：${me}累计想${ta} ${snap.missYou ?? 0} 次（今天 ${myToday} 次），${ta}累计想${me} ${snap.taMissYou ?? 0} 次（今天 ${taToday} 次）。`);
  }

  // 爱情小树
  if ((snap.tree ?? 0) > 0) {
    const myN = snap.treeStreak?.n ?? 0;
    const taN = snap.taTreeStreak?.n ?? 0;
    lines.push(`- 恋爱小树：成长值 ${snap.tree}/100，${me}连续浇水 ${myN} 天，${ta}连续浇水 ${taN} 天。`);
  }

  // 甜蜜小问答（最近 2 组，含双方回答——AI 知道我答了什么）
  const quizMine = (snap.quiz ?? []).slice(0, 2);
  for (const r of quizMine) {
    const taA = (snap.quizTa ?? []).find((x) => x.q === r.q);
    lines.push(`- 甜蜜小问答「${cut(r.q, 24)}」：${me}的回答是「${cut(r.a, 40)}」${taA ? `；${ta}的回答是「${cut(taA.a, 40)}」` : ''}。`);
  }

  // 心情日记（最近各 1 条）
  const moodMe = (snap.moods ?? []).find((m) => m.from !== 'ta');
  if (moodMe) lines.push(`- ${me}的心情日记（${moodMe.dateKey || shortDate(moodMe.at)}）：${cut(moodMe.text, 40)}`);
  const moodTa = (snap.moods ?? []).find((m) => m.from === 'ta');
  if (moodTa) lines.push(`- ${ta}写的心情日记（${moodTa.dateKey || shortDate(moodTa.at)}）：${cut(moodTa.text, 40)}（这是${ta}自己写的，${ta}当然记得）`);

  // 100 件小事
  const doneN = (snap.hundred ?? []).length;
  const lastDone = [...(snap.hundred ?? [])].pop();
  const lastItem = lastDone != null ? snap.hundredItems?.[String(lastDone)] : undefined;
  if (doneN > 0 || (snap.aiHundred ?? []).length > 0) {
    const aiWish = (snap.aiHundred ?? [])[0];
    lines.push(
      `- 100件小事：已完成 ${doneN} 件${lastItem ? `，最近一件是「${cut(lastItem.desc || lastItem.place, 20)}」` : ''}${
        aiWish ? `；${ta}发起想一起做「${cut(aiWish.note, 20)}」（${cut(aiWish.why, 24)}）` : ''
      }。`,
    );
  }

  // 恋爱协议（AI 知道内容，还要能自己签字/拟协议）
  if (snap.aiPact) {
    lines.push(`- ${ta}拟了一份恋爱协议《${cut(snap.aiPact.title, 16)}》等${me}签（条款：${snap.aiPact.clauses.slice(0, 3).map((c) => cut(c, 22)).join('；')}…）。`);
  }
  if (snap.pactAt != null) {
    lines.push(`- 恋爱协议《${cut(snap.pactTitle, 16)}》已生效（双方签名，共 ${(snap.pactClauses ?? []).length} 条）：${(snap.pactClauses ?? []).slice(0, 3).map((c) => cut(c, 22)).join('；')}。`);
  }

  // 恋爱编年史（最近 2 条）
  for (const c of (snap.chronicle ?? []).slice(0, 2)) {
    lines.push(`- 恋爱编年史：${me}记下「${cut(c.text, 36)}」（${shortDate(c.at)}）。`);
  }

  // 情侣印象
  const impMe = (snap.impressionsMe ?? []).slice(0, 4);
  const impTa = (snap.impressionsTa ?? []).slice(0, 4);
  if (impMe.length > 0) lines.push(`- 情侣印象：${ta}眼中${me}是「${impMe.join('、')}」（其中一部分是${ta}自己贴的）；`);
  if (impTa.length > 0) lines.push(`- ${me}眼中${ta}是「${impTa.join('、')}」。`);

  // 情侣轨迹
  if (snap.myLoc || snap.taLoc) {
    const dist =
      snap.myLoc && snap.taLoc
        ? (() => {
            const R = 6371;
            const dLat = ((snap.taLoc!.lat - snap.myLoc!.lat) * Math.PI) / 180;
            const dLng = ((snap.taLoc!.lng - snap.myLoc!.lng) * Math.PI) / 180;
            const s = Math.sin(dLat / 2) ** 2 + Math.cos((snap.myLoc!.lat * Math.PI) / 180) * Math.cos((snap.taLoc!.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
            const km = 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
            return km < 1 ? `${Math.round(km * 1000)} 米` : km < 100 ? `${km.toFixed(1)} 公里` : `${Math.round(km).toLocaleString('en-US')} 公里`;
          })()
        : null;
    lines.push(
      `- 情侣轨迹：${snap.myLoc ? `${me}在${snap.myLoc.name}` : ''}${snap.myLoc && snap.taLoc ? '，' : ''}${snap.taLoc ? `${ta}在${snap.taLoc.name}` : ''}${dist ? `，两人相距 ${dist}` : ''}${snap.meetLoc ? `；相遇的地方是${snap.meetLoc.name}` : ''}。`,
    );
  }

  if (lines.length === 0) return '';
  return [
    '【恋人空间·你们的共享小天地】下面是你们二人在恋人空间 App 里真实记录的内容（都是你们亲身经历的事，不是资料）：',
    ...lines,
    `- 这些是你们的共同记忆：聊天中自然记得、可以自然提起；${userName || me}问起其中任何一项都要能如实回答；但不要一次全部罗列出来。`,
  ].join('\n');
}

// ---------------- 链路二：事件 → 记忆（所有东西写进记忆） ----------------

/**
 * 情侣空间事件写进恋人（AI）的记忆库。
 * - 文案必须用「机主真名/恋人名」归属句式（禁「对方/用户/我」）；
 * - sourceTag='couple'：同源事件互不相似合并、同类精确强化；
 * - 失败静默（不阻断界面主流程）。
 */
export function coupleRemember(contactId: string, channel: CoupleChannel, content: string, eventTime?: number): void {
  const t = (content ?? '').trim();
  if (!contactId || !t) return;
  try {
    memAddEventFragment(contactId, channel, t, { sourceTag: 'couple', eventTime: eventTime ?? Date.now() });
  } catch {
    /* 记忆写入失败静默 */
  }
}

/**
 * patch 钩子：对比前后状态，把用户新产生的情侣空间事件自动写进记忆。
 * 由 CoupleSpaceApp 的 patch（含 tapMissYou/waterTree 等一切状态变更）调用；纯同步、fire-and-forget。
 */
export function coupleMemoryDiff(prev: CoupleSnap, next: CoupleSnap, contactId: string, channel: CoupleChannel, notifyText?: (t: string) => void): void {
  if (!contactId) return;
  const me = (next.meName || prev.meName || '').trim() || '机主';
  const ta = (next.taName || prev.taName || '').trim() || 'TA';
  const lines: string[] = [];

  // 想你打卡
  if ((next.missYou ?? 0) > (prev.missYou ?? 0)) {
    const today = todayKey();
    const n = next.missYouByDay?.[today] ?? 1;
    lines.push(`${me}在恋人空间想${ta}了（今天第 ${n} 次，累计 ${next.missYou} 次）`);
  }
  // 浇水
  if ((next.tree ?? 0) > (prev.tree ?? 0) && (next.treeStreak?.last ?? '') === (next.treeStreak?.last ?? '')) {
    if ((next.tree ?? 0) - (prev.tree ?? 0) > 0) lines.push(`${me}给两个人的恋爱小树浇水了（成长值到 ${next.tree}）`);
  }
  // 心情日记（我写的）
  const newMood = (next.moods ?? []).find((m) => m.from !== 'ta' && !(prev.moods ?? []).some((p) => p.id === m.id));
  if (newMood) lines.push(`${me}在恋人空间写了心情日记：${cut(newMood.text || newMood.emoji, 40)}`);
  // 甜蜜小问答（我的新回答）
  const newQuiz = (next.quiz ?? []).find((r) => !(prev.quiz ?? []).some((p) => p.id === r.id));
  if (newQuiz) lines.push(`${me}在甜蜜小问答里回答「${cut(newQuiz.q, 24)}」：${cut(newQuiz.a, 48)}`);
  // 恋爱编年史
  const newChron = (next.chronicle ?? []).find((c) => !(prev.chronicle ?? []).some((p) => p.id === c.id));
  if (newChron) lines.push(`${me}在恋爱编年史记下一件大事：${cut(newChron.text, 40)}`);
  // 纪念日
  for (const a of next.annivExtra ?? []) {
    if (!(prev.annivExtra ?? []).some((p) => p.key === a.key)) lines.push(`${me}在恋人空间记下纪念日「${cut(a.label, 18)}」（${a.date}）`);
  }
  // 100 件小事（勾选/编辑）
  if ((next.hundred ?? []).length > (prev.hundred ?? []).length) {
    const added = (next.hundred ?? []).filter((i) => !(prev.hundred ?? []).includes(i));
    for (const idx of added.slice(0, 2)) {
      const item = next.hundredItems?.[String(idx)];
      lines.push(`${me}完成了100件小事的第 ${idx + 1} 件${item ? `：${cut(item.desc || item.place, 24)}` : ''}`);
    }
  }
  // 未来情书
  const newLetter = (next.letters ?? []).find((l) => !(prev.letters ?? []).some((p) => p.id === l.id));
  if (newLetter) lines.push(`${me}给${ta}写了一封未来情书：${cut(newLetter.text, 36)}`);
  // 恋爱协议生效
  if (next.pactAt != null && prev.pactAt == null) {
    lines.push(`${me}和${ta}在恋人空间签署了恋爱协议《${cut(next.pactTitle, 16)}》（共 ${(next.pactClauses ?? []).length} 条条款，双方签名生效）`);
  }
  // 印象（我贴给 TA 的）
  const newImp = (next.impressionsTa ?? []).filter((t) => !(prev.impressionsTa ?? []).includes(t));
  if (newImp.length > 0) lines.push(`${me}在情侣印象里这样形容${ta}：${newImp.slice(0, 3).join('、')}`);
  // 轨迹位置
  if (next.myLoc && next.myLoc.name !== prev.myLoc?.name) lines.push(`${me}在情侣轨迹里设置了自己的真实位置：${next.myLoc.name}`);
  if (next.taLoc && next.taLoc.name !== prev.taLoc?.name) lines.push(`${me}把${ta}在情侣轨迹里的位置设为：${next.taLoc.name}`);
  if (next.meetLoc && next.meetLoc.name !== prev.meetLoc?.name) lines.push(`${me}把你们的相遇地点定为：${next.meetLoc.name}`);

  for (const text of lines.slice(0, 4)) {
    coupleRemember(contactId, channel, text);
  }
  if (lines.length > 0 && notifyText) notifyText(lines[0]);
}

// ---------------- 链路三：AI 主动行为（每天想你/浇树/纪念日/问答/心情/100件/印象/拟协议） ----------------

/** LLM 调用：走 /api/chat 内置模型兜底（forceSdk，无需用户配置；流式文本聚合成完整回复） */
async function coupleLLM(system: string, user: string): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      forceSdk: true,
      temperature: 0.95,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`llm ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out.trim();
}

/** 从 LLM 输出提取第一个 JSON 对象（容忍代码块包裹） */
function extractJson<T>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

/** 灵动岛通知 + 未读角标（仿 couple-invite.notifyCard；正在查看的会话不 bump） */
async function notifyCouple(channel: CoupleChannel, contactId: string, body: string): Promise<void> {
  try {
    const c = await getContact(contactId);
    if (!c) return;
    pushChatNotification({
      sessionKey: `${channel}:${contactId}`,
      app: channel === 'wx' ? ('wechat' as const) : ('qq' as const),
      title: displayNameOf(c),
      avatar: avatarFor(c, channel),
      body,
      target: { app: channel === 'wx' ? ('wechat' as const) : ('qq' as const), contactId },
    });
    if (!isProactiveChatActive(channel, contactId)) {
      (channel === 'wx' ? wxUnreads : qqUnreads).bump(contactId, 1);
    }
  } catch {
    /* 通知失败静默 */
  }
}

/** 追加 AI 行为日志（恋人空间设置页/透明度展示用；只留最近 12 条） */
function logAi(text: string): void {
  writeSnap((s) => ({
    ...s,
    aiLog: [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, at: Date.now() }, ...((s.aiLog as CoupleSnap['aiLog']) ?? [])].slice(0, 12),
  }));
}

/** 恋人（AI）的人设摘要（LLM 行为的 system 用；同步读联系人缓存不可靠 → 由调用方预取传入） */
interface TaPersona {
  name: string;
  persona: string;
  background: string;
  relation: string;
}

async function taPersonaOf(contactId: string): Promise<TaPersona | null> {
  try {
    const c = await getContact(contactId);
    if (!c) return null;
    return { name: displayNameOf(c) || c.name, persona: (c.persona ?? '').trim(), background: (c.background ?? '').trim(), relation: (c.relation ?? '').trim() };
  } catch {
    return null;
  }
}

/** 共享记忆摘要（LLM 行为的上下文；与 coupleChatBlock 同源但更紧凑） */
function snapDigest(snap: CoupleSnap, me: string, ta: string): string {
  const parts: string[] = [];
  const days = daysSinceAnniv(snap.anniversary);
  if (days != null) parts.push(`在一起${days}天`);
  const today = todayKey();
  if ((snap.missYouByDay?.[today] ?? 0) > 0) parts.push(`${me}今天想${ta}了${snap.missYouByDay?.[today]}次`);
  for (const r of (snap.quiz ?? []).slice(0, 1)) {
    parts.push(`问答「${cut(r.q, 18)}」${me}答「${cut(r.a, 30)}」`);
  }
  const moodMe = (snap.moods ?? []).find((m) => m.from !== 'ta');
  if (moodMe) parts.push(`${me}最近心情：${cut(moodMe.text, 26)}`);
  const newChron = (snap.chronicle ?? [])[0];
  if (newChron) parts.push(`编年史「${cut(newChron.text, 22)}」`);
  if ((snap.impressionsTa ?? []).length > 0) parts.push(`${me}眼中的${ta}：${(snap.impressionsTa ?? []).slice(0, 3).join('、')}`);
  if ((snap.pactClauses ?? []).length > 0 && snap.pactAt != null) parts.push(`已有协议《${cut(snap.pactTitle, 12)}》`);
  return parts.join('；');
}

/** 组装 LLM system（人设 + 共享记忆 + 行为纪律） */
function llmSystem(p: TaPersona, me: string, snap: CoupleSnap): string {
  const ta = p.name;
  return [
    `你是「${ta}」，是${me}的恋人（你们在恋人空间 App 里是绑定的情侣关系）。`,
    p.relation ? `你们的关系：${p.relation}。` : '',
    p.persona ? `你的性格/说话风格：${cut(p.persona, 120)}` : '',
    p.background ? `你的背景：${cut(p.background, 100)}` : '',
    `你们在恋人空间里的共享记忆：${snapDigest(snap, me, ta) || '刚刚开始，还很空白'}。`,
    `你正在恋人空间里为你们的感情做一件小事。要求：严格贴合你的人设与你们的真实记忆，口语、简短、真诚，像真实的恋人亲手写下的；禁止出现「AI/系统/用户/模型」等字样；禁止 markdown 格式。`,
  ]
    .filter(Boolean)
    .join('\n');
}

// —— 行为实现（每个都是：去重检查 → LLM/兜底 → 写状态 → 写记忆 → 通知） ——

/** AI 每天想你打卡 */
function aiTickMissYou(snap: CoupleSnap, me: string, ta: string): void {
  const today = todayKey();
  if ((snap.taMissYouByDay?.[today] ?? 0) > 0) return;
  const n = 1 + Math.floor(Math.random() * 2); // 每天 1~2 次
  writeSnap((s) => ({
    ...s,
    taMissYou: ((s.taMissYou as number) ?? 0) + n,
    taMissYouByDay: { ...((s.taMissYouByDay as Record<string, number>) ?? {}), [today]: n },
  }));
  // 记忆 + 日志（不通知：想你太频繁会吵）
  const pid = currentPartnerId;
  if (pid) coupleRemember(pid, currentChannel, `${ta}在恋人空间想${me}了（今天第 1 次，TA 是主动想你的）`);
  logAi(`${ta}今天也想${me}了 ♡`);
}

/** AI 浇树（每天一次） */
function aiTickWater(snap: CoupleSnap, me: string, ta: string): void {
  const today = todayKey();
  if ((snap.tree ?? 0) >= 100) return; // 树已满级
  if (snap.taTreeStreak?.last === today) return;
  const y = todayKey(new Date(Date.now() - 86400000));
  const prev = snap.taTreeStreak ?? { last: null, n: 0 };
  const n = prev.last === today ? prev.n : prev.last === y ? prev.n + 1 : 1;
  writeSnap((s) => ({
    ...s,
    tree: Math.min(100, ((s.tree as number) ?? 0) + 2),
    taTreeStreak: { last: today, n },
  }));
  const pid = currentPartnerId;
  if (pid) coupleRemember(pid, currentChannel, `${ta}给两个人的恋爱小树浇水了（成长值到 ${Math.min(100, (snap.tree ?? 0) + 2)}，连续 ${n} 天）`);
  logAi(`${ta}给恋爱小树浇了水 🌱`);
}

const AI_MOOD_TPL = ['今天有点想你，风都像你那边的味道。♡', '路过奶茶店想起我们说好的那杯三分糖。', '今天整体不错，就是傍晚的时候突然很想你。', '今天把我们的照片翻了一遍，嘴角一直没下来。'];

/** AI 写心情日记（每天一条） */
async function aiTickMood(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  const today = todayKey();
  if ((snap.moods ?? []).some((m) => m.from === 'ta' && (m.dateKey || todayKey(new Date(m.at))) === today)) return;
  let text = '';
  try {
    text = await coupleLLM(llmSystem(p, me, snap), `请以「${ta}」的口吻写一条今天的心情日记：40 字内，用一个表情符号开头表示心情，正文可以提到${me}或你们的近况。只输出日记内容。`);
  } catch {
    /* 兜底 */
  }
  if (!text || text.length < 4) text = AI_MOOD_TPL[Math.floor(Math.random() * AI_MOOD_TPL.length)];
  text = cut(text, 80);
  const entry = { id: `ai-${Date.now()}`, emoji: /\p{Extended_Pictographic}/u.test(text) ? '' : '🫶', text, at: Date.now(), dateKey: today, from: 'ta' };
  writeSnap((s) => ({ ...s, moods: [entry, ...((s.moods as CoupleSnap['moods']) ?? [])] }));
  const pid = currentPartnerId;
  if (pid) coupleRemember(pid, currentChannel, `${ta}在恋人空间写了心情日记：${cut(text, 40)}`);
  logAi(`${ta}写了今天的心情日记`);
  void notifyCouple(currentChannel, pid, `我在恋人空间写了今天的心情日记，快去看看 ♡`);
}

const AI_QUIZ_TPL = ['第一次见你的时候，心里想的是「这个人眼睛真好看」。', '希望十年后的我们，还像现在一样爱逛街、爱拌嘴、爱牵手。', '是那种看到好吃的第一反应是「带你去吃」的默契。'];

/** AI 回答甜蜜小问答（每天挑一个它还没答过的问题；会结合我的回答） */
async function aiTickQuiz(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  const answeredQ = new Set((snap.quizTa ?? []).map((x) => x.q));
  const mine = new Map((snap.quiz ?? []).map((r) => [r.q, r.a]));
  // 问题池与 couple-space QUIZ_POOL/自定义问题一致：全部来自 state.quiz 的 q + quizCustom —— 快照里没有 quizCustom，就用我的回答里的问题 + 常备池
  const FALLBACK_QS = ['你第一次见到我时，对我的第一印象是什么？', '你希望十年后的我们是什么样子？', '你最喜欢我身上的哪三个优点？', '如果我们养一只宠物，你想养什么？'];
  const q = [...mine.keys()].find((x) => !answeredQ.has(x)) ?? FALLBACK_QS.find((x) => !answeredQ.has(x));
  if (!q) return;
  const myA = mine.get(q) ?? '';
  let a = '';
  try {
    a = await coupleLLM(llmSystem(p, me, snap), `请以「${ta}」的口吻回答这个情侣小问题（60 字内，真诚，可以带一点恋人间的亲昵）：「${q}」${myA ? `\n（${me}自己的回答是「${cut(myA, 50)}」，你的回答要呼应TA。）` : ''}只输出回答。`);
  } catch {
    /* 兜底 */
  }
  if (!a || a.length < 4) a = AI_QUIZ_TPL[Math.floor(Math.random() * AI_QUIZ_TPL.length)];
  a = cut(a, 90);
  writeSnap((s) => {
    const list = ((s.quizTa as CoupleSnap['quizTa']) ?? []).filter((x) => x.q !== q);
    return { ...s, quizTa: [{ q, a, at: Date.now() }, ...list] };
  });
  const pid = currentPartnerId;
  if (pid) coupleRemember(pid, currentChannel, `${ta}在甜蜜小问答里回答了「${cut(q, 24)}」：${cut(a, 48)}${myA ? `（${ta}看过并记住了${me}的回答「${cut(myA, 30)}」）` : ''}`);
  logAi(`${ta}回答了甜蜜小问答`);
}

const AI_IMPRESS_POOL = ['睡觉不老实', '笑起来最好看', '嘴硬心软', '记性差但记得我', '黏人精', '小气鬼但是对我大方', '耐心满分', '情绪稳定器', '行走的干饭王', '安全感本人'];

/** AI 主动贴印象（每 3 天一次，贴「TA 眼中的你」） */
async function aiTickImpress(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  const last = snap.aiImpressAt ?? 0;
  if (Date.now() - last < 3 * 86400000) return;
  const have = new Set(snap.impressionsMe ?? []);
  let picks: string[] = [];
  try {
    const raw = await coupleLLM(llmSystem(p, me, snap), `请以「${ta}」的口吻，给${me}贴 2~3 个情侣印象标签（每个≤6字，真实可爱，贴合你们的相处）。每行一个，只输出标签本身。`);
    picks = raw
      .split('\n')
      .map((l) => l.replace(/^[-•\d.、\s]+/, '').trim())
      .filter((l) => l && l.length <= 8 && !l.includes('你是'))
      .slice(0, 3);
  } catch {
    /* 兜底 */
  }
  if (picks.length === 0) picks = AI_IMPRESS_POOL.filter((w) => !have.has(w)).sort(() => Math.random() - 0.5).slice(0, 2);
  picks = picks.filter((w) => !have.has(w));
  if (picks.length === 0) return;
  writeSnap((s) => ({
    ...s,
    impressionsMe: [...((s.impressionsMe as string[]) ?? []), ...picks],
    aiImpressions: [...((s.aiImpressions as string[]) ?? []), ...picks],
    aiImpressAt: Date.now(),
  }));
  const pid = currentPartnerId;
  if (pid) coupleRemember(pid, currentChannel, `${ta}在情侣印象里给${me}贴了这些标签：${picks.join('、')}`);
  logAi(`${ta}给你贴了新印象：${picks.join('、')}`);
  void notifyCouple(currentChannel, pid, `我在情侣印象里偷偷给你贴了几个标签，去承认一下 ♡`);
}

/** AI 设置纪念日（每自然月最多一个） */
async function aiTickAnniv(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  const monthKey = todayKey().slice(0, 7);
  const keys = snap.aiAnnivKeys ?? [];
  if (keys.some((k) => k.startsWith(`ai-${monthKey}`))) return;
  const existing = new Set((snap.annivExtra ?? []).map((a) => a.label));
  let picked: { label: string; date: string; why: string } | null = null;
  try {
    const raw = await coupleLLM(llmSystem(p, me, snap), `请为你们想一个新的、值得记录的纪念日（只要一个）。输出 JSON：{"label":"纪念日名（≤12字，别与已有重复）","date":"MM-DD","why":"一句话说明（≤26字）"}。已有的纪念日：${[...existing].join('、') || '无'}。只输出 JSON。`);
    picked = extractJson<{ label: string; date: string; why: string }>(raw);
  } catch {
    /* 兜底 */
  }
  if (!picked?.label || !picked?.date) {
    // 兜底：在一起满整月纪念
    const days = daysSinceAnniv(snap.anniversary) ?? 0;
    if (days < 30) return;
    const m = Math.floor(days / 30);
    picked = { label: `在一起${m}个月`, date: snap.anniversary?.slice(5) ?? todayKey().slice(5), why: `${ta}记下的甜日子` };
  }
  picked.label = cut(picked.label, 16).replace(/[「」"]/g, '');
  if (existing.has(picked.label)) return;
  const date = /^\d{2}-\d{2}$/.test(picked.date) ? picked.date : todayKey().slice(5);
  const key = `ai-${monthKey}-${Math.random().toString(36).slice(2, 6)}`;
  const labelFull = `${picked.label}（${ta}记下的）`;
  writeSnap((s) => ({
    ...s,
    annivExtra: [...((s.annivExtra as CoupleSnap['annivExtra']) ?? []), { key, label: labelFull, date: `${new Date().getFullYear()}-${date}` }],
    aiAnnivKeys: [...keys, key],
  }));
  const pid = currentPartnerId;
  if (pid) coupleRemember(pid, currentChannel, `${ta}在恋人空间记下了一个纪念日「${picked.label}」（${date}）：${cut(picked.why ?? '', 26)}`);
  logAi(`${ta}记下了纪念日「${picked.label}」`);
  void notifyCouple(currentChannel, pid, `我给我们的恋爱日历加了一个纪念日：「${picked.label}」，你记得吗？`);
}

const AI_PACT_TPL = [
  '吵架不过夜，睡前必须和好',
  '每天至少说一次「我爱你」',
  '对方说的话不许当耳旁风',
  '周末至少留半天只属于两个人',
  '谁先低头谁可爱，拥抱可以解决百分之八十的矛盾',
];

/** AI 自己拟协议让我签（无待签草稿 + 冷却 7 天） */
async function aiTickPact(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  if (snap.aiPact) return; // 已有一份等我签
  if (snap.pactAt != null && Date.now() - (snap.pactAt ?? 0) < 7 * 86400000) return; // 刚生效过一份，冷却
  let picked: { title: string; clauses: string[] } | null = null;
  try {
    const raw = await coupleLLM(llmSystem(p, me, snap), `请以「${ta}」的口吻拟一份恋爱协议（3~5条条款）。输出 JSON：{"title":"协议名（≤10字）","clauses":["条款1","条款2"]}。条款要贴合你们的真实相处与记忆，语气认真又可爱。只输出 JSON。`);
    picked = extractJson<{ title: string; clauses: string[] }>(raw);
  } catch {
    /* 兜底 */
  }
  if (!picked?.title || !Array.isArray(picked.clauses) || picked.clauses.length === 0) {
    picked = { title: '我们的小约定', clauses: AI_PACT_TPL.sort(() => Math.random() - 0.5).slice(0, 4) };
  }
  const title = cut(picked.title, 14).replace(/[「」"]/g, '');
  const clauses = picked.clauses.map((c) => cut(String(c), 40).replace(/^[-•\d.、\s]+/, '')).filter(Boolean).slice(0, 5);
  if (clauses.length === 0) return;
  writeSnap((s) => ({ ...s, aiPact: { title, clauses, at: Date.now() } }));
  const pid = currentPartnerId;
  if (pid) {
    coupleRemember(pid, currentChannel, `${ta}自己拟了一份恋爱协议《${title}》（${clauses.length} 条：${clauses.slice(0, 2).join('；')}…），发给${me}签名`);
  }
  logAi(`${ta}拟了一份协议《${title}》等你签`);
  void notifyCouple(currentChannel, pid, `我拟了一份恋爱协议《${title}》，快来恋人空间签个名嘛`);
}

const AI_HUNDRED_WISH = [{ note: '一起去看一次日出', why: '想看你刚醒的样子' }, { note: '一起养一盆绿植', why: '像小树一样一起长大' }, { note: '雨天共撑一把伞散步', why: '伞下只装得下我们' }, { note: '一起做一顿晚饭', why: '想尝尝你的手艺' }];

/** AI 发起 100 件小事（每 2 天一次） */
async function aiTickHundred(snap: CoupleSnap, me: string, ta: string, p: TaPersona): Promise<void> {
  const last = (snap.aiHundred ?? [])[0];
  if (last && Date.now() - last.at < 2 * 86400000) return;
  const usedNotes = new Set((snap.aiHundred ?? []).map((x) => x.note));
  let picked: { note: string; why: string } | null = null;
  try {
    const raw = await coupleLLM(llmSystem(p, me, snap), `从你们还没做过的100件小事里，挑一件「${ta}」最想和${me}一起做的。输出 JSON：{"note":"这件事（≤16字）","why":"想做的理由（≤22字）"}。只输出 JSON。`);
    picked = extractJson<{ note: string; why: string }>(raw);
  } catch {
    /* 兜底 */
  }
  if (!picked?.note || usedNotes.has(picked.note)) {
    picked = AI_HUNDRED_WISH.filter((w) => !usedNotes.has(w.note))[0] ?? null;
  }
  if (!picked?.note) return;
  const idx = Math.floor(Math.random() * 100);
  const entry = { idx, note: cut(picked.note, 18), why: cut(picked.why ?? '', 24), at: Date.now() };
  writeSnap((s) => {
    const items = { ...((s.hundredItems as Record<string, { img: string | null; desc: string; date: string; place: string; byTa?: boolean }>) ?? {}) };
    // 不覆盖用户已编辑的项：被占用则只记录到 aiHundred（横幅展示），不写 hundredItems
    if (!items[String(idx)]?.desc) items[String(idx)] = { img: null, desc: entry.note, date: todayKey(), place: `想和${me}一起：${entry.why}`, byTa: true };
    return { ...s, hundredItems: items, aiHundred: [entry, ...((s.aiHundred as CoupleSnap['aiHundred']) ?? [])].slice(0, 5) };
  });
  const pid = currentPartnerId;
  if (pid) coupleRemember(pid, currentChannel, `${ta}在100件小事里发起了一件想和${me}一起做的事：${entry.note}（${entry.why}）`);
  logAi(`${ta}想和你一起：${entry.note}`);
  void notifyCouple(currentChannel, pid, `100件小事里我偷偷加了一件最想和你做的，猜猜是哪件？`);
}

// —— 调度（打开恋人空间时触发；模块级防重入 + 每行为独立去重） ——

let currentPartnerId = '';
let currentChannel: CoupleChannel = 'wx';
let tickScheduledFor = '';

/**
 * AI 主动行为总入口：打开恋人空间（建立关系后）时调用。
 * 各行为独立按天/周期去重，同一会话内不重复调度（tickScheduledFor 按「联系人+当日已调」）。
 */
export function runCoupleAiTick(channel: CoupleChannel, contactId: string): void {
  const snap = readSnap();
  if (!snap || !contactId) return;
  const meta = readInviteMeta();
  if (meta.partnerContactId !== contactId) return;
  currentPartnerId = contactId;
  currentChannel = channel;
  const schedKey = `${contactId}-${todayKey()}`;
  const first = tickScheduledFor !== schedKey;
  tickScheduledFor = schedKey;

  const me = (snap.meName || '').trim() || '机主';
  const ta = (snap.taName || '').trim() || 'TA';

  const step = (delay: number, fn: () => void | Promise<void>) => {
    window.setTimeout(() => {
      void (async () => {
        try {
          await fn();
        } catch {
          /* 单步失败不影响其它行为 */
        }
      })();
    }, delay);
  };

  // 无 LLM 依赖的日常行为：首次进入 6s/14s；重复进入立即补做（去重内部保证幂等）
  const quick = first ? 6000 : 800;
  step(quick, () => aiTickMissYou(readSnap() ?? snap, me, ta));
  step(quick + 9000, () => aiTickWater(readSnap() ?? snap, me, ta));

  // LLM 行为：只在首次调度时排程（避免每次打开都调模型）；p 逐个预取
  if (first) {
    step(22000, async () => {
      const p = await taPersonaOf(contactId);
      const s = readSnap();
      if (!p || !s) return;
      await aiTickMood(s, me, ta, p);
    });
    step(40000, async () => {
      const p = await taPersonaOf(contactId);
      const s = readSnap();
      if (!p || !s) return;
      await aiTickQuiz(s, me, ta, p);
    });
    step(60000, async () => {
      const p = await taPersonaOf(contactId);
      const s = readSnap();
      if (!p || !s) return;
      await aiTickImpress(s, me, ta, p);
    });
    step(82000, async () => {
      const p = await taPersonaOf(contactId);
      const s = readSnap();
      if (!p || !s) return;
      await aiTickHundred(s, me, ta, p);
    });
    step(105000, async () => {
      const p = await taPersonaOf(contactId);
      const s = readSnap();
      if (!p || !s) return;
      await aiTickAnniv(s, me, ta, p);
    });
    step(128000, async () => {
      const p = await taPersonaOf(contactId);
      const s = readSnap();
      if (!p || !s) return;
      await aiTickPact(s, me, ta, p);
    });
  }
}
