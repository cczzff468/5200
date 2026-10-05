'use client';

/**
 * 一起听遥控（第三十七轮）：微信/QQ 聊天端 × 音乐 App 一起听的播放联动。
 *
 * 背景：音乐 App 内一起听的 AI 已有完整播放控制（music-ai.ts 的 [切歌]/[暂停]/[放歌] 等指令，
 * 只在音乐 App 的聊天视图生效）；但用户回到微信/QQ 和同一位 AI 角色聊天时，对方只通过
 * cross-app-context 的「听歌动态」知道歌名/歌手——不知道播放到哪里、看不到歌词，也无法控制播放。
 *
 * 本模块给微信/QQ 私聊补上同一套能力（仅「与该角色的一起听会话进行中」生效）：
 * 1. togetherLiveBlock(cid, userLabel)：发消息时现场构建的实时音乐情境块——
 *    正在听的歌/歌手/播放进度（几分几秒、播放中还是暂停）/正在唱到的歌词窗口 + 播放控制指令说明，
 *    注入聊天 system（wechat.tsx / qq.tsx 的 runAiTurn，位置在跨 App 块之后）；
 * 2. takeMusicRemote(raw)：从 AI 回复里抽出播放控制指令并从正文剔除
 *    （指令语法与音乐 App 一起听完全一致：[切歌]/[上一首]/[暂停]/[继续]/[放歌:歌名:歌手]/[快进:秒]/[快退:秒]）；
 * 3. cutUnfinishedMusicTag(text)：流式分段防撕裂——尾部未闭合的半截指令括号留住（下次拼回），
 *    防止「[快进:」被分段器切开、一半进了气泡一半丢了指令；
 * 4. runMusicRemote(controls)：把指令真实作用到播放器（useMusic store，用户随时可手动覆盖）。
 *
 * 安全边界：
 * - takeMusicRemote 有会话闸门：没有进行中的一起听会话时原文原样返回（聊天正文里的方括号文案不吞不执行）；
 * - 指令最多执行 3 条/条回复；不弹任何兑底消息（音乐 App 侧才有「没找到这首歌」的回复链路），
 *   微信/QQ 侧搜不到歌就静默失败——AI 用的是意图式说法（"我切一下歌"），没放成也不显得说谎；
 * - 本模块不写消息、不写记忆，只动播放器。
 */

import { kvGet } from './idb-kv';
import { musicUid, songArtistText } from './music-api';
import { useMusic } from './music-store';
import { searchSongMatched } from './music-ai';

// ---------------- 类型 ----------------

export interface MusicRemoteControl {
  type: 'next' | 'prev' | 'pause' | 'resume' | 'play' | 'seek';
  /** type='play' 时：歌名（必填）/歌手（可选） */
  name?: string;
  artist?: string;
  /** type='seek' 时：快进/快退秒数（正=快进，负=快退，绝对值最多 600） */
  delta?: number;
}

/** 进行中的一起听会话快照（music-ai.ts 落盘的形状，鸭子读取防耦合） */
interface TgActiveSnapshot {
  contactId?: unknown;
  name?: unknown;
}

/** 是否有进行中的一起听会话（有则返回会话快照） */
function activeTogether(): TgActiveSnapshot | null {
  try {
    const t = kvGet<TgActiveSnapshot>(`music-together-active:${musicUid()}`);
    return t && typeof t === 'object' ? t : null;
  } catch {
    return null;
  }
}

// ---------------- 指令抽取 ----------------

/** 从 AI 原文里抽出播放控制指令并从正文剔除（与 music-ai.extractTgControls 同一套语法）。
 *  闸门：没有进行中的一起听会话时原文原样返回——聊天正文里的方括号文案（「点[切歌]按钮」这类）
 *  不吞、不执行，只有一起听中的 AI 被授予了指令能力。 */
export function takeMusicRemote(raw: string): { text: string; controls: MusicRemoteControl[] } {
  const src = raw ?? '';
  if (!activeTogether()) return { text: src, controls: [] };
  const controls: MusicRemoteControl[] = [];
  let text = src;
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
  text = text.replace(/\[(快进|快退)[:：]\s*(\d{1,3})\s*(?:秒|s)?\]/g, (_m, kind, sec) => {
    const n = parseInt(String(sec), 10);
    if (Number.isFinite(n) && n > 0) {
      controls.push({ type: 'seek', delta: (String(kind) === '快退' ? -1 : 1) * Math.min(n, 600) });
    }
    return '';
  });
  return { text: text.replace(/[ \t]+$/gm, '').trim(), controls };
}

/** 流式分段防撕裂：文本尾部未闭合的半截指令括号（如「…[快进:」）留住并从本段剔除，
 *  下一段到达后拼回开头再处理（wechat.tsx / qq.tsx 的 deliverSegment 与照片标签 carry 同款机制）。
 *  括号内容超过 24 字视为普通正文里的方括号（不是指令），不吞。 */
export function cutUnfinishedMusicTag(text: string): { text: string; held: string } {
  const src = text ?? '';
  const m = src.match(/\[[^\][]*$/);
  if (!m || m.index === undefined) return { text: src, held: '' };
  if (m[0].length > 24) return { text: src, held: '' };
  return { text: src.slice(0, m.index), held: m[0] };
}

// ---------------- 指令执行 ----------------

/** 把指令真实作用到播放器（直接调 useMusic action；用户随时可手动覆盖，store 层以最后操作为准）。
 *  单条回复最多执行 3 条；搜不到歌静默（不弹兑底消息，与音乐 App 侧不同——那边有消息链路）。 */
export async function runMusicRemote(controls: MusicRemoteControl[]): Promise<void> {
  if (!controls.length) return;
  for (const c of controls.slice(0, 3)) {
    try {
      const st = useMusic.getState();
      if (c.type === 'next') await st.next(false);
      else if (c.type === 'prev') await st.prev();
      else if (c.type === 'pause') {
        if (st.playing) st.toggle();
      } else if (c.type === 'resume') {
        if (!st.playing && st.current) st.toggle();
      } else if (c.type === 'seek') {
        if (st.current && st.duration > 0 && c.delta) {
          st.seek(Math.min(st.duration - 1, Math.max(0, st.position + c.delta)));
        }
      } else if (c.type === 'play' && c.name) {
        const hit = await searchSongMatched(c.name, c.artist ?? '');
        if (hit) await st.playSong(hit, [hit]);
      }
    } catch {
      // 单条指令失败不影响其余
    }
  }
}

// ---------------- 实时音乐情境块（发消息时现场构建） ----------------

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}

/** 正在唱到的歌词窗口（前 2 句 + 当前 + 后 1 句），歌词没加载出来时返回空串 */
function lyricWindowBlock(): string {
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
  const from = Math.max(0, idx - 2);
  const to = Math.min(lines.length - 1, idx + 1);
  for (let i = from; i <= to; i++) {
    const tag = i === idx ? '▶ 正在唱' : i < idx ? `前 ${idx - i} 句` : `后 ${i - idx} 句`;
    parts.push(`${tag}：${at(i)}`);
  }
  return `正在唱到的歌词：\n${parts.join('\n')}`;
}

/**
 * 一起听实时情境块：与该角色的一起听会话进行中时，返回注入聊天 system 的实时数据块
 * （歌名/歌手/进度/播放状态/歌词 + 播放控制指令说明）；没在一起听（或一起听的不是这位角色）返回空串。
 * 与 cross-app-context 的「听歌动态」不同：那个走跨 App 缓存（可能滞后一轮），本块在发消息瞬间构建，
 * 数据是此刻的真实进度；指令说明也只在这里给（AI 只有一起听中才被授予播控能力）。
 */
export function togetherLiveBlock(contactId: string, userLabel: string): string {
  try {
    const t = activeTogether();
    if (!t || typeof t.contactId !== 'string' || t.contactId !== contactId) return '';
    // 冷启动兜底（幂等）：页面刷新后没开过音乐 App 时，从播放器快照恢复队列/当前歌（同步完成）
    void useMusic.getState().boot();
    const st = useMusic.getState();
    const who = (userLabel ?? '').trim().slice(0, 20) || '机主';
    const lines: string[] = ['【一起听 · 实时音乐情境（你正和' + who + '在音乐 App 里一起听歌，以下是此刻的实时数据）】'];
    if (st.current) {
      lines.push(`正在一起听：《${st.current.name}》${songArtistText(st.current)}`);
      if (st.duration > 0) {
        lines.push(
          `播放进度：${fmtClock(st.position)} / ${fmtClock(st.duration)}（${st.playing ? '正在播放' : '已暂停'}）`,
        );
      }
      if (st.freeTrial) lines.push('（这是 VIP 歌曲，当前只播放试听片段）');
    } else {
      lines.push('播放器还没开始放歌（对方还没选歌）。');
    }
    const lw = lyricWindowBlock();
    if (lw) lines.push(lw);
    lines.push(
      '',
      '【一起听播放控制（真实生效）】你陪着' + who + '听歌，可以控制播放（指令写在回复末尾，系统会真实执行并从气泡里剔除，不要在正文里描述指令本身，不要加引号/代码块）：',
      '- 正文用意图式说法（如"我切一下歌""放首X听听"），不要用完成时说"已经切好了"——万一没放成也不显得说谎；',
      '- 想切下一首：[切歌]；想回上一首：[上一首]；',
      '- 想暂停音乐：[暂停]；想继续放：[继续]；',
      '- 想放一首具体的歌：[放歌:歌名:歌手]（写真实存在的歌，如 [放歌:晴天:周杰伦]）；',
      '- 想跳过前奏/直接听副歌：[快进:秒数]（如 [快进:30]）；想倒回去重听：[快退:秒数]（如 [快退:45]）；最多 600 秒；',
      '- 选什么歌、什么时候切，按你的人设、你们的聊天内容和这首歌的氛围来；' + who + '随时会手动操作播放器，别抢节奏，不要每条消息都带指令。',
    );
    return lines.join('\n');
  } catch {
    return ''; // 任何意外都不阻断消息发送
  }
}
