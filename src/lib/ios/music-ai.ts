'use client';

/**
 * 音乐 App AI 互动层：
 *
 * 1. 一起听（邀 AI 角色一起听歌）：
 *    - 活跃会话持久化 kv music-together-active:{uid}（重启恢复）；
 *    - 消息持久化 kv music-together:{uid}:{cid}（按网易云账号 + 角色隔离）；
 *    - AI 回复走两级 LLM（用户上游 → 内置 SDK），system = 角色人设 + 记忆 + 音乐情境块
 *      （正在听的歌/进度/最近听歌历史/一起听消息）；
 *    - AI 主动评论：切歌触发 + 空闲定时触发（可关）；
 * 2. AI 推荐歌曲：LLM 返回 JSON 歌单 → /search 匹配真实曲库 → 消息内歌曲卡（点击播放）；
 * 3. 听歌记忆：一起听中播放的歌写角色记忆（memAddEventFragment, sourceTag='music-play'），
 *    自动参与后续所有聊天 App 的记忆召回——无需改任何聊天代码。
 */

import { buildPersonaSystemPrompt, type PersonaSource } from './persona';
import { memAddEventFragment, memChatRecallBlock, getMemSettings } from '../memory';
import { listContacts, getContact, ownerRealName } from './contacts-store';
import type { ContactRecord } from '../contacts';
import { kvGet, kvSet, kvDel } from './idb-kv';
import { useSettings } from './store';
import { useEffect, useState } from 'react';
import { useMusic, setSongPlayedHook } from './music-store';
import { search, songArtistText, musicUid, type NcmSong } from './music-api';

// ---------------- 类型 ----------------

export interface TgRecSong {
  id: number;
  name: string;
  artist: string;
  picUrl?: string;
}

export interface TgMsg {
  id: string;
  /** 'me' | 'peer' | 'recs'（推荐歌曲卡） */
  role: 'me' | 'peer' | 'recs';
  text: string;
  time: number;
  /** role=recs 时携带 */
  songs?: TgRecSong[];
  /** 消息生成失败标记 */
  error?: boolean;
}

export interface TogetherSession {
  contactId: string;
  name: string;
  avatar: string;
  /** 虚构距离（公里，按角色稳定） */
  distanceKm: number;
  /** 展示锚点 = 累计起点（现在 - 历史累计时长）：退出后重进，时长接着上次累计 */
  since: number;
  /** 本次段落真实开始时间（退出时把这段累加进总数） */
  segStart?: number;
  /** AI 主动评论开关（会话级） */
  aiChatter: boolean;
}

const ACTIVE_KEY_PREFIX = 'music-together-active:';
const MSGS_KEY_PREFIX = 'music-together:';
/** 每个角色的累计一起听时长（毫秒，永久保存：退出累加，重进接着算） */
const DUR_KEY_PREFIX = 'music-tg-dur:';

function activeKey(): string {
  return `${ACTIVE_KEY_PREFIX}${musicUid()}`;
}
function msgsKey(cid: string): string {
  return `${MSGS_KEY_PREFIX}${musicUid()}:${cid}`;
}
function durKey(cid: string): string {
  return `${DUR_KEY_PREFIX}${musicUid()}:${cid}`;
}

/** 读取与某角色的累计一起听时长（毫秒） */
export function togetherTotalMs(cid: string): number {
  return kvGet<number>(durKey(cid)) ?? 0;
}

/** 把当前活跃会话的这一段时长累加进总数（退出/换人前调用） */
function accumulateSegment(s: TogetherSession | null): void {
  if (!s) return;
  const seg = s.segStart ? Math.max(0, Date.now() - s.segStart) : 0;
  if (seg <= 0) return;
  kvSet(durKey(s.contactId), togetherTotalMs(s.contactId) + seg);
}

/** 格式化累计时长（X小时Y分钟 / Y分钟） */
export function fmtTogetherDur(ms: number): string {
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)}小时${mins % 60}分钟` : `${mins}分钟`;
}

// ---------------- 会话管理 ----------------

export function loadActiveTogether(): TogetherSession | null {
  return kvGet<TogetherSession>(activeKey());
}

export function startTogether(contact: ContactRecord): TogetherSession {
  // 若已有活跃会话，先把那段时长累加进对应角色（不丢失）
  accumulateSegment(loadActiveTogether());
  // 距离：按角色 id+region 稳定虚构（50~1800 km）
  const seedStr = `${contact.id}:${contact.region ?? ''}`;
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  const distanceKm = 50 + (h % 1750);
  const now = Date.now();
  // 时长永久累计：since 锚点 = 现在 - 历史累计（下次邀请从上次的时长继续）
  const carriedMs = togetherTotalMs(contact.id);
  const session: TogetherSession = {
    contactId: contact.id,
    name: contact.nickname || contact.name,
    avatar: contact.avatar || '',
    distanceKm,
    since: now - carriedMs,
    segStart: now,
    aiChatter: true,
  };
  kvSet(activeKey(), session);
  useMusic.setState({ together: session, togetherMsgs: loadTogetherMsgs(contact.id) });
  return session;
}

export async function stopTogether(): Promise<void> {
  const s = loadActiveTogether();
  if (s) {
    accumulateSegment(s); // 本段时长写入累计总数
    kvDel(activeKey());
    useMusic.setState({ together: null });
    stopChatterTimer();
    await writeTogetherMemory(
      s.contactId,
      `结束了这次一起听（累计一起听了 ${fmtTogetherDur(Date.now() - s.since)}）`,
    );
  } else {
    kvDel(activeKey());
    useMusic.setState({ together: null });
    stopChatterTimer();
  }
}

export function setTogetherAiChatter(on: boolean): void {
  const s = loadActiveTogether();
  if (!s) return;
  const next = { ...s, aiChatter: on };
  kvSet(activeKey(), next);
  useMusic.setState({ together: next });
  if (on) startChatterTimer();
  else stopChatterTimer();
}

export function loadTogetherMsgs(cid: string): TgMsg[] {
  return kvGet<TgMsg[]>(msgsKey(cid)) ?? [];
}

function saveTogetherMsgs(cid: string, msgs: TgMsg[]): void {
  kvSet(msgsKey(cid), msgs.slice(-100));
}

function appendMsg(cid: string, m: TgMsg): void {
  const cur = useMusic.getState();
  const list = cur.together?.contactId === cid ? cur.togetherMsgs : loadTogetherMsgs(cid);
  const next = [...list, m];
  saveTogetherMsgs(cid, next);
  if (cur.together?.contactId === cid) {
    useMusic.setState({ togetherMsgs: next });
  }
}

// ---------------- 记忆写入 ----------------

async function ownerName(): Promise<string> {
  try {
    return (await ownerRealName()) || '机主';
  } catch {
    return '机主';
  }
}

/** 一起听记忆（写角色碎片记忆，sourceTag='music-play'，参与后续聊天召回） */
export async function writeTogetherMemory(contactId: string, what: string): Promise<void> {
  try {
    const c = await getContact(contactId);
    if (!c || c.kind !== 'char') return;
    const who = await ownerName();
    memAddEventFragment(contactId, 'wx', `${who}和${c.nickname || c.name}${what}`, {
      eventTime: Date.now(),
      sourceTag: 'music-play',
    });
  } catch {
    // 记忆失败静默
  }
}

/** 播放钩子：一起听中每次放新歌 → 记忆 + 概率触发 AI 评论 */
export function installMusicAiHook(): void {
  let lastSongId = 0;
  let lastWrittenAt = 0;
  setSongPlayedHook((song: NcmSong) => {
    void (async () => {
      const t = loadActiveTogether();
      if (!t) return;
      const c = await getContact(t.contactId);
      if (!c) return;
      const artist = songArtistText(song);
      if (song.id !== lastSongId || Date.now() - lastWrittenAt > 10 * 60_000) {
        await writeTogetherMemory(t.contactId, `一起听了《${song.name}》（${artist}）`);
        lastSongId = song.id;
        lastWrittenAt = Date.now();
      }
      if (t.aiChatter && Math.random() < 0.45) {
        void aiComment(t.contactId, `刚刚切到了《${song.name}》（${artist}）`);
      }
      startChatterTimer();
    })();
  });
}

// ---------------- LLM（两级兜底，与 proactive-msg 同款） ----------------

async function callLlmTwoTier(system: string, userContent: string): Promise<string> {
  const cfg = useSettings.getState().apiConfig;
  const call = async (extra: Record<string, unknown>): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        ...extra,
      }),
      signal: AbortSignal.timeout(75_000),
    });
    return res.ok ? await res.text() : '';
  };
  let raw = '';
  try {
    raw = await call({ config: cfg });
  } catch {
    raw = '';
  }
  if (!raw.trim()) {
    try {
      raw = await call({ forceSdk: true });
    } catch {
      raw = '';
    }
  }
  return raw.trim();
}

/** 从原文抠 JSON 数组（推荐歌曲用） */
function extractJsonArray(raw: string): Record<string, unknown>[] | null {
  const t = (raw ?? '').replace(/```(json)?/gi, '').trim();
  const m = t.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]) as unknown;
    return Array.isArray(arr) ? (arr as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

// ---------------- 音乐情境块 ----------------

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}

function historyBlock(): string {
  const st = useMusic.getState();
  const recent = st.history.slice(0, 8).map((h) => `《${h.song.name}》${songArtistText(h.song)}`);
  if (!recent.length) return '';
  return `【${'机主'}最近在听的歌】\n${recent.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
}

function playingBlock(extra: string, who: string): string {
  const st = useMusic.getState();
  const cur = st.current;
  const lines: string[] = ['【一起听 · 音乐情境（真实数据）】'];
  if (cur) {
    lines.push(`正在一起听：《${cur.name}》 ${songArtistText(cur)}`);
    if (st.duration > 0) {
      lines.push(
        `播放进度：${fmtClock(st.position)} / ${fmtClock(st.duration)}（${st.playing ? '正在播放' : '已暂停'}）`,
      );
    }
    if (st.freeTrial) lines.push('（这是 VIP 歌曲，当前只播放试听片段）');
  } else {
    lines.push('当前没有在放歌。');
  }
  if (extra) lines.push(extra);
  const hb = historyBlock();
  if (hb) lines.push('', hb);
  lines.push(
    '',
    '【一起听聊天规则】',
    '- 你正在和对方一起实时听歌，像坐在同一间屋子里各戴一只耳机那样自然聊天；',
    '- 可以聊当下这首歌的感受、歌手、歌词、回忆，也可以说日常；消息要口语化、短（1~2 句）、符合你的人设语气；',
    '- 不要输出 markdown、不要伪装成系统；直接输出消息正文。',
  );
  void who;
  return lines.join('\n');
}

async function personaSystemFor(cid: string, musicBlock: string): Promise<string> {
  const c = await getContact(cid);
  if (!c) return musicBlock;
  const userName = await ownerName();
  let memory = '';
  try {
    memory = memChatRecallBlock(cid, 'wx', c.persona || '音乐', {});
  } catch {
    memory = '';
  }
  let share = true;
  try {
    share = getMemSettings(cid).share;
  } catch {
    share = true;
  }
  const persona = buildPersonaSystemPrompt(c as unknown as PersonaSource, {
    channel: '一起听（音乐 App）',
    userName,
    userRealName: userName,
    userNickname: null,
    ownerName: userName,
    multiApp: share,
    accountId: 'main',
    extraRules: [
      '当前场景是音乐 App 的「一起听」聊天：你们的聊天围绕正在听的音乐展开，语气随意自然，消息很短（一两句话）。',
    ],
  });
  return [persona, memory, musicBlock].filter(Boolean).join('\n\n');
}

// ---------------- AI 回复 ----------------

let replying = false;

function recentChatText(cid: string, n: number, who: string): string {
  return loadTogetherMsgs(cid)
    .slice(-n)
    .map((m) => `${m.role === 'me' ? who : '你'}：${m.role === 'recs' ? `（推荐了歌）${m.text}` : m.text}`)
    .join('\n');
}

/** 用户发消息 → AI 回复 */
export async function togetherReply(cid: string, userText: string): Promise<void> {
  if (replying) return;
  replying = true;
  try {
    const who = await ownerName();
    const history = recentChatText(cid, 10, who);
    const system = await personaSystemFor(
      cid,
      playingBlock(
        `【聊天记录】\n${history || '（刚开始聊）'}\n\n对方（${who}）刚发来一条消息，请回复。`,
        who,
      ),
    );
    const raw = await callLlmTwoTier(system, userText || '（对方点了推荐按钮，想让你推荐几首歌）');
    const text = cleanAiText(raw);
    if (text) {
      appendMsg(cid, { id: genMsgId(), role: 'peer', text, time: Date.now() });
    } else {
      appendMsg(cid, {
        id: genMsgId(),
        role: 'peer',
        text: '……（信号不太好，没听清）',
        time: Date.now(),
        error: true,
      });
    }
  } finally {
    replying = false;
  }
}

function cleanAiText(raw: string): string {
  let t = (raw ?? '').trim();
  t = t.replace(/^[「"'『]+|[」"'』]+$/g, '').trim();
  return t.slice(0, 300);
}

function genMsgId(): string {
  return `tg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 用户发消息入口 */
export function sendTogetherText(text: string): void {
  const t = loadActiveTogether();
  if (!t || !text.trim()) return;
  appendMsg(t.contactId, { id: genMsgId(), role: 'me', text: text.trim(), time: Date.now() });
  void togetherReply(t.contactId, text.trim());
}

// ---------------- AI 主动评论（空闲定时） ----------------

let chatterTimer: ReturnType<typeof setTimeout> | null = null;

export function startChatterTimer(): void {
  stopChatterTimer();
  const t = loadActiveTogether();
  if (!t || !t.aiChatter) return;
  const delay = 45_000 + Math.floor(Math.random() * 60_000); // 45~105s
  chatterTimer = setTimeout(() => {
    const cur = loadActiveTogether();
    if (!cur || !cur.aiChatter) return;
    const st = useMusic.getState();
    if (!st.current) return;
    void aiComment(cur.contactId, '');
    startChatterTimer();
  }, delay);
}

export function stopChatterTimer(): void {
  if (chatterTimer) {
    clearTimeout(chatterTimer);
    chatterTimer = null;
  }
}

/** AI 主动点评（空闲触发 / 切歌触发） */
async function aiComment(cid: string, hint: string): Promise<void> {
  if (replying) return;
  replying = true;
  try {
    const who = await ownerName();
    const history = recentChatText(cid, 6, who);
    const system = await personaSystemFor(
      cid,
      playingBlock(
        `${hint ? `【情境】${hint}\n` : ''}【聊天记录】\n${history || '（还没聊过）'}\n\n请主动发一条消息（可以是此刻这首歌的感受、一句联想或闲聊）。`,
        who,
      ),
    );
    const raw = await callLlmTwoTier(system, '（主动发一条一起听的消息）');
    const text = cleanAiText(raw);
    if (text) {
      appendMsg(cid, { id: genMsgId(), role: 'peer', text, time: Date.now() });
    }
  } finally {
    replying = false;
  }
}

// ---------------- AI 推荐歌曲 ----------------

/** 让 AI 推荐 3 首歌：LLM 出 JSON → 搜索匹配真实曲库 → recs 消息 */
export async function togetherRecommend(cid: string, wish: string): Promise<void> {
  const t = loadActiveTogether();
  if (!t) return;
  appendMsg(cid, {
    id: genMsgId(),
    role: 'me',
    text: wish.trim() || '给我推荐几首歌吧',
    time: Date.now(),
  });
  const who = await ownerName();
  const history = recentChatText(cid, 8, who);
  const system = await personaSystemFor(
    cid,
    playingBlock(
      `【聊天记录】\n${history}\n\n对方（${who}）想让你推荐歌曲。结合你们正在听的歌、${who}的听歌历史和你们的聊天，推荐 3 首真实存在的歌曲。`,
      who,
    ),
  );
  const user = `请严格只输出 JSON 数组（不要解释、不要 markdown 代码块），格式：
[{"title":"歌名","artist":"歌手","reason":"一句话推荐理由（20字内，用你的口吻）"}]
共 3 项。`;
  const raw = await callLlmTwoTier(system, user);
  const arr = extractJsonArray(raw);
  if (!arr || !arr.length) {
    appendMsg(cid, {
      id: genMsgId(),
      role: 'peer',
      text: '我想想……一时想不起来，你先放你的歌单？',
      time: Date.now(),
    });
    return;
  }
  const songs: TgRecSong[] = [];
  for (const item of arr.slice(0, 3)) {
    const title = String(item.title ?? '').trim();
    const artist = String(item.artist ?? '').trim();
    if (!title) continue;
    try {
      const r = await search(`${title} ${artist}`.trim(), 1, 1);
      const hit = r.songs[0];
      if (hit) {
        songs.push({ id: hit.id, name: hit.name, artist: songArtistText(hit), picUrl: hit.album?.picUrl });
      }
    } catch {
      // 单条失败跳过
    }
  }
  if (!songs.length) {
    appendMsg(cid, {
      id: genMsgId(),
      role: 'peer',
      text: '唔，这几首歌库里好像没有，你放你的歌单听听？',
      time: Date.now(),
    });
    return;
  }
  const lead = cleanAiText(String(arr[0]?.reason ?? ''));
  appendMsg(cid, {
    id: genMsgId(),
    role: 'recs',
    text: lead || '给你挑了几首，戳卡片直接听：',
    time: Date.now(),
    songs,
  });
}

// ---------------- 启动恢复 ----------------

/** 音乐 App 打开时调用：恢复一起听会话 + 装 AI 钩子 + 重启空闲定时 */
export async function bootMusicAi(): Promise<void> {
  installMusicAiHook();
  const t = loadActiveTogether();
  if (t) {
    const c = await getContact(t.contactId);
    if (c && c.kind === 'char') {
      useMusic.setState({ together: t, togetherMsgs: loadTogetherMsgs(t.contactId) });
      startChatterTimer();
    } else {
      await stopTogether();
    }
  }
}

/** 可一起听的角色列表（AI 角色） */
export async function listTogetherCandidates(): Promise<ContactRecord[]> {
  const all = await listContacts();
  return all.filter((c) => c.kind === 'char');
}

/**
 * 一起听对方信息「跟随全局」：头像/昵称始终读联系人库里的最新值，
 * （在微信/QQ里改了头像、昵称后一起听界面立即同步），联系人被删时回退会话快照。
 */
export function useTogetherLive(): TogetherSession | null {
  const session = useMusic((s) => s.together);
  // 只缓存联系人的覆盖值（不在 effect 里同步 setState，避免级联渲染）
  const [override, setOverride] = useState<{ cid: string; name?: string; avatar?: string } | null>(null);
  // 版本号：联系人头像/资料变更事件触达时 +1，强制重读联系人库
  const [rev, setRev] = useState(0);
  const cid = session?.contactId ?? '';
  useEffect(() => {
    if (!cid) return;
    const reread = () => setRev((n) => n + 1);
    window.addEventListener('contact-avatar-changed', reread);
    return () => window.removeEventListener('contact-avatar-changed', reread);
  }, [cid]);
  useEffect(() => {
    if (!cid) return;
    let on = true;
    void getContact(cid)
      .then((c) => {
        if (!on) return;
        setOverride(c ? { cid, name: c.nickname || c.name || '', avatar: c.avatar || '' } : null);
      })
      .catch(() => {
        /* 联系人库不可用时保持快照 */
      });
    return () => {
      on = false;
    };
  }, [cid, rev]);
  if (!session) return null;
  if (override && override.cid === cid) {
    return {
      ...session,
      name: override.name || session.name,
      avatar: override.avatar || session.avatar,
    };
  }
  return session;
}
