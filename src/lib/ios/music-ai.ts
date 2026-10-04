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
import { buildCrossContextBlocks } from './cross-app-context';

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

const SONGPLAY_KEY_PREFIX = 'music-tg-songplay:';
function songPlayKey(cid: string, songId: number): string {
  return `${SONGPLAY_KEY_PREFIX}${musicUid()}:${cid}:${songId}`;
}

/** B（第二十轮）：同一首歌「一起听过几遍」真实计数（一起听中每放一首新歌 +1），
 *  供 AI 说「这是我们一起听的第三遍了」这类基于事实的话 */
function bumpTogetherSongPlay(cid: string, songId: number): void {
  try {
    kvSet(songPlayKey(cid, songId), (kvGet<number>(songPlayKey(cid, songId)) ?? 0) + 1);
  } catch {
    /* 静默 */
  }
}

function togetherSongPlayCount(cid: string, songId: number): number {
  return kvGet<number>(songPlayKey(cid, songId)) ?? 0;
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

/** 播放钩子：一起听中每次放新歌 → 记忆 + 概率触发 AI 评论；solo 听歌 → 轻量记忆（30 分钟节流） */
export function installMusicAiHook(): void {
  let lastSongId = 0;
  let lastWrittenAt = 0;
  let lastSoloMemAt = 0;
  setSongPlayedHook((song: NcmSong) => {
    void (async () => {
      const t = loadActiveTogether();
      const artist = songArtistText(song);
      if (t) {
        const c = await getContact(t.contactId);
        if (!c) return;
        if (song.id !== lastSongId) {
          lastSongId = song.id;
          lastWrittenAt = Date.now();
          await writeTogetherMemory(t.contactId, `一起听了《${song.name}》（${artist}）`);
          bumpTogetherSongPlay(t.contactId, song.id); // B：同歌「一起听过几遍」计数
        } else if (Date.now() - lastWrittenAt > 10 * 60_000) {
          lastWrittenAt = Date.now();
          await writeTogetherMemory(t.contactId, `一起听了《${song.name}》（${artist}）`);
        }
        if (t.aiChatter && Math.random() < 0.45) {
          void aiComment(t.contactId, `刚刚切到了《${song.name}》（${artist}）`);
        }
        startChatterTimer();
        return;
      }
      // solo 听歌记忆（需求一.4）：非一起听时也给最近聊过的角色留一笔听歌痕迹，
      // 参与后续聊天召回（全局 30 分钟节流，不吵）；实时近况另有 cross-app 音乐块注入
      if (Date.now() - lastSoloMemAt > 30 * 60_000) {
        lastSoloMemAt = Date.now();
        try {
          const cids = await recentChatCharIds(3);
          if (cids.length > 0) {
            const who = await ownerName();
            for (const cid of cids) {
              memAddEventFragment(cid, 'wx', `${who}听了《${song.name}》（${artist}）`, {
                eventTime: Date.now(),
                sourceTag: 'music-solo',
              });
            }
          }
        } catch {
          // 静默
        }
      }
    })();
  });
}

/** 最近聊过天的 char 角色 id（读三个聊天 App 当前账号会话的最后消息时间，倒序前 n） */
async function recentChatCharIds(n: number): Promise<string[]> {
  try {
    const { listContacts } = await import('./contacts-store');
    const { kvGetScoped } = await import('./idb-kv');
    const all = await listContacts();
    const chars = all.filter((c) => c.kind === 'char');
    const scored: { id: string; ts: number }[] = [];
    for (const c of chars) {
      let ts = 0;
      for (const [app, key] of [
        ['wx', `wx-chat-msgs:${c.id}`],
        ['qq', `qq-chat-msgs:${c.id}`],
        ['sms', `ios-chat-msgs:c:${c.id}`],
      ] as const) {
        try {
          const msgs = kvGetScoped<{ time?: number }[]>(key, app);
          if (Array.isArray(msgs) && msgs.length > 0) {
            const t = Number(msgs[msgs.length - 1]?.time ?? 0);
            if (Number.isFinite(t) && t > ts) ts = t;
          }
        } catch {
          // 单端失败跳过
        }
      }
      if (ts > 0) scored.push({ id: c.id, ts });
    }
    return scored
      .sort((a, b) => b.ts - a.ts)
      .slice(0, n)
      .map((x) => x.id);
  } catch {
    return [];
  }
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

/** A（第二十轮）：当前歌词上下文块（正在唱的一句 + 前后各一句，含翻译）——
 *  之前 AI 只知道歌名/进度，看不到歌词，聊不了「这句词好戳」这种细节 */
function lyricNowBlock(): string {
  const st = useMusic.getState();
  if (!st.current || st.lyricFor !== st.current.id || st.lyricLines.length === 0) return '';
  const lines = st.lyricLines;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= st.position + 0.2) idx = i;
    else break;
  }
  if (idx < 0) return '';
  const at = (i: number): string => {
    const l = lines[i];
    if (!l) return '';
    return l.tr ? `${l.text}（${l.tr}）` : l.text;
  };
  const parts: string[] = [];
  if (idx > 0) parts.push(`上一句：${at(idx - 1)}`);
  parts.push(`正在唱：${at(idx)}`);
  if (idx + 1 < lines.length) parts.push(`下一句：${at(idx + 1)}`);
  return `【正在唱到的歌词】\n${parts.join('\n')}`;
}

function playingBlock(extra: string, who: string, cid: string): string {
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
  // A：当前歌词上下文
  const lb = lyricNowBlock();
  if (lb) lines.push('', lb);
  // B：真实的一起听统计（累计时长 + 同一首歌听过几遍）
  if (cid) {
    const totalMs = togetherTotalMs(cid);
    if (totalMs > 60_000) lines.push(`你们累计一起听了 ${fmtTogetherDur(totalMs)}。`);
    if (cur) {
      const played = togetherSongPlayCount(cid, cur.id);
      if (played >= 2) lines.push(`《${cur.name}》你们已经一起听过 ${played} 遍了。`);
    }
  }
  lines.push(
    '',
    '【一起听聊天规则】',
    '- 你正在和对方一起实时听歌，像坐在同一间屋子里各戴一只耳机那样自然聊天；',
    '- 可以聊当下这首歌的感受、歌手、歌词、回忆，也可以说日常；消息要口语化、短（1~2 句）、符合你的人设语气；',
    '- 可以引用「正在唱到的歌词」里的一两句聊感受，但不要整段抄歌词；',
    '- 绝对禁止复读：聊天记录里（不管是你还是对方说过的）已有的句子、句式和意思都不许再重复，每次都要换一个全新的角度（旋律/歌手音色/歌词/回忆/当下氛围/联想画面……任选一个没聊过的切入口）；',
    '- 不要输出 markdown、不要伪装成系统；直接输出消息正文。',
    '',
    '【播放控制】你在陪对方听歌，可以控制播放（指令写在消息末尾，系统会真实执行，不要在正文里描述指令本身，不要加引号/代码块）：',
    '- 想切下一首：[切歌]；想回上一首：[上一首]；',
    '- 想暂停音乐：[暂停]；想继续放：[继续]；',
    '- 想放一首具体的歌（选歌/换到你们聊到的歌）：[放歌:歌名:歌手]（写真实存在的歌，如 [放歌:晴天:周杰伦]）；',
    '- 觉得这首歌好听、想帮对方收藏：[红心]（把当前歌加进对方红心，同一首歌别重复发）；',
    '- 想跳过前奏/直接听副歌：[快进:秒数]（如 [快进:30]，最多 300 秒）；',
    '- 选什么歌、什么时候切，完全按你的人设、你们的聊天内容和这首歌的氛围来；用户随时会手动操作播放器，别抢节奏，不要每条消息都带指令。',
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
  // 跨 App 感知（需求二）：以 'music' 身份拉【当前环境】+ 其他 App 最近消息 + 共同群近况——
  // AI 带着微信/QQ/信息/电话的记忆进音乐 App，也知道「现在是在音乐 App 聊天」
  let crossBlock = '';
  try {
    const blocks = await buildCrossContextBlocks(cid, 'music', userName);
    crossBlock = [blocks.crossAppBlock, blocks.groupBlock].filter(Boolean).join('\n\n');
  } catch {
    crossBlock = '';
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
  return [persona, memory, crossBlock, musicBlock].filter(Boolean).join('\n\n');
}

// ---------------- AI 播放控制（需求五：一起听 AI 自动播放/关闭/选歌/切歌） ----------------

interface TgControl {
  type: 'next' | 'prev' | 'pause' | 'resume' | 'play' | 'like' | 'seek';
  name?: string;
  artist?: string;
  /** type='seek' 时：快进秒数（最多 300） */
  delta?: number;
}

/** 从 AI 原文里抽出播放控制指令并从正文剔除：[切歌]/[上一首]/[暂停]/[继续]/[放歌:歌名:歌手] */
function extractTgControls(raw: string): { text: string; controls: TgControl[] } {
  const controls: TgControl[] = [];
  let text = raw ?? '';
  text = text.replace(/\[(?:放歌|播放|来一首|来首)[:：]([^\][]*)(?:[:：]([^\][]*))?\]/g, (_m, name, artist) => {
    const n = String(name ?? '').trim();
    if (n) controls.push({ type: 'play', name: n, artist: String(artist ?? '').trim() });
    return '';
  });
  text = text.replace(/\[(切歌|下一首|上一首|暂停|继续|停下|关音乐)\]/g, (_m, k) => {
    const key = String(k);
    if (key === '切歌' || key === '下一首') controls.push({ type: 'next' });
    else if (key === '上一首') controls.push({ type: 'prev' });
    else if (key === '暂停' || key === '停下' || key === '关音乐') controls.push({ type: 'pause' });
    else controls.push({ type: 'resume' });
    return '';
  });
  // C（第二十轮）：[红心] 指令——帮对方把当前歌加入红心
  text = text.replace(/\[(?:红心|点赞|收藏)\]/g, () => {
    controls.push({ type: 'like' });
    return '';
  });
  // D（第二十轮）：[快进:秒数] 指令——真实拖进度
  text = text.replace(/\[快进[:：]\s*(\d{1,3})\s*(?:秒|s)?\]/g, (_m, sec) => {
    const n = parseInt(String(sec), 10);
    if (Number.isFinite(n) && n > 0) controls.push({ type: 'seek', delta: Math.min(n, 300) });
    return '';
  });
  return { text: text.replace(/[ \t]+$/gm, '').trim(), controls };
}

/** 执行一起听 AI 的播放控制（直接调 useMusic action；用户随时可手动覆盖，store 层天然以最后操作为准） */
async function runTgControls(cid: string, controls: TgControl[]): Promise<void> {
  if (controls.length === 0) return;
  const st = useMusic.getState();
  for (const c of controls.slice(0, 3)) {
    try {
      if (c.type === 'next') await st.next(false);
      else if (c.type === 'prev') await st.prev();
      else if (c.type === 'pause') {
        if (st.playing) st.toggle();
      } else if (c.type === 'resume') {
        if (!st.playing && st.current) st.toggle();
      } else if (c.type === 'like') {
        // C：帮对方把当前歌加入红心（已红心则跳过，不会取消）
        if (st.current && !st.isLiked(st.current.id)) await st.toggleLike(st.current);
      } else if (c.type === 'seek') {
        // D：真实拖进度（钳制在歌曲时长内）
        if (st.current && st.duration > 0 && c.delta) {
          st.seek(Math.min(st.duration - 1, Math.max(0, st.position + c.delta)));
        }
      } else if (c.type === 'play' && c.name) {
        // P2：AI 点歌搜不到时不再静默——自动补一条兑底消息
        //（规则要求正文不描述指令，静默失败时用户会困惑「说了放歌但什么都没发生」）
        let hit: NcmSong | undefined;
        try {
          const r = await search(`${c.name} ${c.artist ?? ''}`.trim(), 1, 1);
          hit = r.songs[0];
        } catch {
          hit = undefined;
        }
        if (hit) await st.playSong(hit, [hit]);
        else {
          appendMsg(cid, {
            id: genMsgId(),
            role: 'peer',
            text: `《${c.name}》这首歌曲库里没有诶，换一首听听？`,
            time: Date.now(),
          });
        }
      }
    } catch {
      // 单条指令失败不影响其余
    }
  }
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
  useMusic.setState({ tgAiBusy: true }); // 聊天视图显示三个跳动点
  try {
    const who = await ownerName();
    const history = recentChatText(cid, 10, who);
    const system = await personaSystemFor(
      cid,
      playingBlock(
        `【聊天记录】\n${history || '（刚开始聊）'}\n\n对方（${who}）刚发来一条消息，请回复。`,
        who,
        cid,
      ),
    );
    const { text, controls } = await genUniqueReply(
      cid,
      system,
      userText || '（对方点了推荐按钮，想让你推荐几首歌）',
    );
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
    // AI 的播放控制指令（切歌/暂停/选歌/红心/快进）异步真实执行（不阻塞回复 flag；用户随时可手动覆盖）
    void runTgControls(cid, controls);
  } finally {
    replying = false;
    useMusic.setState({ tgAiBusy: false });
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

// ---------------- 防复读（第十五轮反馈：为什么老是发一模一样的话） ----------------

/** 多样性种子：让每次请求的 prompt 都不同（绕开同输入→同输出），同时提醒模型换角度 */
function varietySeed(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
}

/** 归一化（去标点/空白/大小写）后比较，避免只换标点的假变化 */
function normDup(s: string): string {
  return (s ?? '').replace(/[\s，。！？、,.!?:：;；'"“”「」『』()（）…·\-~～]/g, '').toLowerCase();
}

/** 是否与最近几条消息重复（同义复读检测；P4：窗口 6→12 条，双方消息都查——AI 复读机主原话同样算重复） */
function isDupOfRecent(cid: string, text: string): boolean {
  const n = normDup(text);
  if (!n) return false;
  return loadTogetherMsgs(cid)
    .slice(-12)
    .some((m) => normDup(m.text) === n);
}

/**
 * 生成一条不与近期消息重复的对方回复：首次带种子请求；若与最近消息重复，
 * 带明确换角度指令重试一次（最多 2 次），避免「同一句话发 N 遍」。
 */
async function genUniqueReply(
  cid: string,
  system: string,
  userBase: string,
): Promise<{ text: string; controls: TgControl[] }> {
  const run = async (userContent: string) => {
    const raw = await callLlmTwoTier(system, userContent);
    const { text: ctrlText, controls } = extractTgControls(raw);
    return { text: cleanAiText(ctrlText), controls };
  };
  let out = await run(`${userBase}\n（回复多样性种子：${varietySeed()}）`);
  if (out.text && isDupOfRecent(cid, out.text)) {
    out = await run(
      `${userBase}\n（系统提醒：你刚才的回复和聊天记录里已说过的话重复了，必须换一个完全不同的切入角度重新回复，只输出新消息正文。多样性种子：${varietySeed()}）`,
    );
  }
  return out;
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
    // 反独白：最后一条不是机主发的（AI 刚说过话/刚开始还没人聊）就不再主动接话，
    // 等用户开口或切歌时再评——避免 AI 自己连发一串（第十五轮反馈截图里连续四条同文消息）
    const msgs = loadTogetherMsgs(cur.contactId);
    if (msgs.length > 0 && msgs[msgs.length - 1].role !== 'me') {
      startChatterTimer();
      return;
    }
    // P7：音乐暂停时不再点评歌曲（穿越感）——35% 概率自然问一句「怎么停了」
    if (!st.playing) {
      if (Math.random() < 0.35) void aiComment(cur.contactId, '对方把音乐暂停了');
      startChatterTimer();
      return;
    }
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
  useMusic.setState({ tgAiBusy: true });
  try {
    const who = await ownerName();
    const history = recentChatText(cid, 6, who);
    const system = await personaSystemFor(
      cid,
      playingBlock(
        `${hint ? `【情境】${hint}\n` : ''}【聊天记录】\n${history || '（还没聊过）'}\n\n请主动发一条消息（可以是此刻这首歌的感受、一句联想或闲聊），不要重复聊天记录里任何已有的句子。`,
        who,
        cid,
      ),
    );
    const { text, controls } = await genUniqueReply(cid, system, '（主动发一条一起听的消息）');
    if (text) {
      appendMsg(cid, { id: genMsgId(), role: 'peer', text, time: Date.now() });
    }
    void runTgControls(cid, controls);
  } finally {
    replying = false;
    useMusic.setState({ tgAiBusy: false });
  }
}

// ---------------- AI 推荐歌曲 ----------------

/** 让 AI 推荐 2~4 首歌（P5：数量由 AI 按语境定）：LLM 出 JSON → 搜索匹配真实曲库 → recs 消息 */
export async function togetherRecommend(cid: string, wish: string): Promise<void> {
  const t = loadActiveTogether();
  if (!t) return;
  if (replying) return; // P1：回复/点评进行中不接受推荐（全局互斥锁），避免两条 AI 消息并发交错
  replying = true;
  useMusic.setState({ tgAiBusy: true });
  try {
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
      `【聊天记录】\n${history}\n\n对方（${who}）想让你推荐歌曲。结合你们正在听的歌、${who}的听歌历史和你们的聊天，推荐 2~4 首真实存在的歌曲（几首由你按语境定）。`,
      who,
      cid,
    ),
  );
  const user = `请严格只输出 JSON 数组（不要解释、不要 markdown 代码块），格式：
[{"title":"歌名","artist":"歌手","reason":"一句话推荐理由（20字内，用你的口吻）"}]
共 2~4 项（几首由你定）。理由不要和聊天记录里已说过的句子重复。多样性种子：${varietySeed()}`;
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
  for (const item of arr.slice(0, 4)) {
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
  // P6：推荐理由也过防复读——依次挑第一条与近期消息不重复的理由做开头
  const reasons = arr
    .slice(0, 4)
    .map((it) => cleanAiText(String(it.reason ?? '')))
    .filter(Boolean);
  const lead = reasons.find((r) => !isDupOfRecent(cid, r)) ?? '';
  appendMsg(cid, {
    id: genMsgId(),
    role: 'recs',
    text: lead || '给你挑了几首，戳卡片直接听：',
    time: Date.now(),
    songs,
  });
  } finally {
    replying = false;
    useMusic.setState({ tgAiBusy: false });
  }
}

// ---------------- 启动恢复 ----------------

let sleepWarnBound = false;
/** F（第二十轮）：睡前提醒——定时关闭剩 1 分钟时（music-store 广播 music-sleep-warning 事件），
 *  一起听中的角色自然说一句「要睡着了？音乐快停了哦」 */
function bindSleepWarning(): void {
  if (sleepWarnBound || typeof window === 'undefined') return;
  sleepWarnBound = true;
  window.addEventListener('music-sleep-warning', () => {
    const t = loadActiveTogether();
    if (!t || !t.aiChatter) return;
    void aiComment(t.contactId, '定时关闭快到了，音乐还有一分钟就要停');
  });
}

/** 音乐 App 打开时调用：恢复一起听会话 + 装 AI 钩子 + 重启空闲定时 */
export async function bootMusicAi(): Promise<void> {
  installMusicAiHook();
  bindSleepWarning();
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
