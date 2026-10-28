'use client';

/**
 * 拾光小屋 · AI 弹奏曲库（v9.2）
 *
 * 用户对 AI 说「弹一首小星星 / 来首生日快乐歌」→ 大模型在 ACT 动作块里带 song 参数
 * → 前端 matchSong 匹配曲库 → AI 小人走到乐器前真的把旋律弹出来（Web Audio 可听）：
 * - 钢琴：pianoNote 谐波合成（grand）；
 * - 吉他：pluckString Karplus-Strong 拨弦；
 * - 放歌（音箱/唱片机/八音盒）：pianoNote musicbox 音色轻声循环 ——「自己放歌能听到」。
 *
 * 全部旋律用 PIANO_WHITE 音名记谱（C3~C6），节拍 beats：1 = 四分音符。
 */

import { emitNote, pianoNote, pluckString, PIANO_BLACK, PIANO_WHITE } from './instrument';

/** 一首曲子：音名 + 拍数 */
interface SongNote {
  name: string;
  beats: number;
}

export interface SongDef {
  /** 标准曲名 */
  title: string;
  /** 别名（用户口语叫法） */
  aliases: string[];
  /** 每拍毫秒（四分音符时值） */
  tempoMs: number;
  notes: SongNote[];
}

/** 曲库（6 首经典曲，音域都在 C3~C6 白键内） */
export const AI_SONGS: SongDef[] = [
  {
    title: '小星星',
    aliases: ['一闪一闪亮晶晶', '闪亮晶晶'],
    tempoMs: 420,
    notes: [
      { name: 'C4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'G4', beats: 1 },
      { name: 'A4', beats: 1 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 2 },
      { name: 'F4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'D4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'C4', beats: 2 },
      { name: 'G4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'F4', beats: 1 },
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'D4', beats: 2 },
      { name: 'G4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'F4', beats: 1 },
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'D4', beats: 2 },
      { name: 'C4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'G4', beats: 1 },
      { name: 'A4', beats: 1 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 2 },
      { name: 'F4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'D4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'C4', beats: 2 },
    ],
  },
  {
    title: '两只老虎',
    aliases: ['两只小老虎', '跑得快'],
    tempoMs: 380,
    notes: [
      { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'C4', beats: 1 },
      { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'C4', beats: 1 },
      { name: 'E4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'G4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'G4', beats: 2 },
      { name: 'G4', beats: 0.5 }, { name: 'A4', beats: 0.5 }, { name: 'G4', beats: 0.5 }, { name: 'F4', beats: 0.5 },
      { name: 'E4', beats: 1 }, { name: 'C4', beats: 1 },
      { name: 'G4', beats: 0.5 }, { name: 'A4', beats: 0.5 }, { name: 'G4', beats: 0.5 }, { name: 'F4', beats: 0.5 },
      { name: 'E4', beats: 1 }, { name: 'C4', beats: 1 },
      { name: 'C4', beats: 1 }, { name: 'G3', beats: 1 }, { name: 'C4', beats: 2 },
      { name: 'C4', beats: 1 }, { name: 'G3', beats: 1 }, { name: 'C4', beats: 2 },
    ],
  },
  {
    title: '生日快乐',
    aliases: ['生日歌', '祝你生日快乐', 'happy birthday'],
    tempoMs: 460,
    notes: [
      { name: 'G4', beats: 0.75 }, { name: 'G4', beats: 0.25 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'B4', beats: 2 },
      { name: 'G4', beats: 0.75 }, { name: 'G4', beats: 0.25 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'D5', beats: 1 }, { name: 'C5', beats: 2 },
      { name: 'G4', beats: 0.75 }, { name: 'G4', beats: 0.25 }, { name: 'G5', beats: 1 }, { name: 'E5', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'B4', beats: 1 }, { name: 'A4', beats: 2 },
      { name: 'F5', beats: 0.75 }, { name: 'F5', beats: 0.25 }, { name: 'E5', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'D5', beats: 1 }, { name: 'C5', beats: 2 },
    ],
  },
  {
    title: '欢乐颂',
    aliases: ['贝多芬第九交响曲', '快乐颂'],
    tempoMs: 400,
    notes: [
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'G4', beats: 1 },
      { name: 'G4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'D4', beats: 1 },
      { name: 'C4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'E4', beats: 1.5 }, { name: 'D4', beats: 0.5 }, { name: 'D4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'G4', beats: 1 },
      { name: 'G4', beats: 1 }, { name: 'F4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'D4', beats: 1 },
      { name: 'C4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'D4', beats: 1.5 }, { name: 'C4', beats: 0.5 }, { name: 'C4', beats: 2 },
    ],
  },
  {
    title: '小蜜蜂',
    aliases: ['嗡嗡嗡'],
    tempoMs: 380,
    notes: [
      { name: 'G4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'F4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'D4', beats: 2 },
      { name: 'C4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'G4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'F4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'D4', beats: 2 },
      { name: 'C4', beats: 1 }, { name: 'C4', beats: 1 }, { name: 'D4', beats: 1 }, { name: 'E4', beats: 1 },
      { name: 'C4', beats: 2 }, { name: 'C4', beats: 2 },
    ],
  },
  {
    title: '茉莉花',
    aliases: ['好一朵美丽的茉莉花'],
    tempoMs: 460,
    notes: [
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 0.5 }, { name: 'G4', beats: 0.5 }, { name: 'A4', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 2 },
      { name: 'G4', beats: 0.5 }, { name: 'A4', beats: 0.5 }, { name: 'G4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'G4', beats: 0.5 }, { name: 'A4', beats: 0.5 }, { name: 'C5', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 2 },
      { name: 'G4', beats: 0.5 }, { name: 'A4', beats: 0.5 }, { name: 'G4', beats: 1 }, { name: 'E4', beats: 2 },
      { name: 'E4', beats: 1 }, { name: 'E4', beats: 1 }, { name: 'G4', beats: 1 }, { name: 'A4', beats: 1 },
      { name: 'C5', beats: 1 }, { name: 'C5', beats: 1 }, { name: 'A4', beats: 1 }, { name: 'G4', beats: 2 },
    ],
  },
];

/** 音名 → 频率表（白键 + 黑键，合成器同源） */
const NOTE_FREQ = new Map<string, number>([...PIANO_WHITE, ...PIANO_BLACK].map((n) => [n.name, n.freq]));

/** 曲库曲名清单（给提示词用） */
export const AI_SONG_NAMES = AI_SONGS.map((s) => s.title).join('、');

/** 用户话/AI 参数 → 曲库匹配（曲名/别名包含即命中；如「弹个生日歌呀」命中「生日快乐」） */
export function matchSong(input?: string): SongDef | null {
  const q = (input ?? '').replace(/\s|《|》|["'「」]/g, '').trim();
  if (!q) return null;
  for (const s of AI_SONGS) {
    if (q.includes(s.title) || s.title.includes(q)) return s;
    for (const a of s.aliases) if (q.includes(a) || a.includes(q)) return s;
  }
  return null;
}

// ---------------- 播放调度（可随时打断） ----------------

type PlayKind = 'piano' | 'guitar' | 'musicbox';

let songTimers: ReturnType<typeof setTimeout>[] = [];
/** 当前正在播的曲名（重复触发同曲忽略） */
let currentKey = '';

/** 停止当前弹奏（新指令/动作结束时调用） */
export function stopAiSong(): void {
  songTimers.forEach(clearTimeout);
  songTimers = [];
  currentKey = '';
}

/**
 * 播一首曲子（真的能听到）：
 * - piano → pianoNote grand；guitar → pluckString；musicbox → pianoNote musicbox（轻声，放歌用）；
 * - loop=true 时循环播放（放歌场景）；每个音符广播 emitNote（可视化联动：琴键/弦位灯光）。
 * 返回实际播放的曲名（没匹配到时给一段即兴五声音阶小曲，返回 '即兴'）。
 */
export function playAiSong(kind: PlayKind, songInput?: string, opts?: { loop?: boolean; vol?: number }): string {
  stopAiSong();
  const song = matchSong(songInput);
  const loop = opts?.loop ?? false;
  const vol = opts?.vol ?? (kind === 'musicbox' ? 0.4 : 0.55);

  // 没匹配到曲库 → 即兴小曲：C 五声音阶上下行 + 随机跳音，听感温柔不刺耳
  const notes: SongNote[] = song?.notes ?? (() => {
    const scale = ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'A4', 'G4', 'E4', 'D4', 'C4'];
    const pick = [...scale, ...scale.slice(1, -1).reverse()];
    return pick.map((name, i) => ({ name, beats: i === pick.length - 1 ? 2 : 1 }));
  })();
  currentKey = `${kind}:${song?.title ?? '即兴'}`;

  const tempo = song?.tempoMs ?? 400;
  let t = 320; // 起手留一点「坐定」时间
  const schedule = (list: SongNote[]) => {
    for (const n of list) {
      const at = t;
      const freq = NOTE_FREQ.get(n.name) ?? 440;
      songTimers.push(
        setTimeout(() => {
          if (kind === 'guitar') pluckString(freq, vol, 'acoustic');
          else pianoNote(freq, vol, kind === 'musicbox' ? 'musicbox' : 'grand');
          emitNote({ kind: kind === 'guitar' ? 'guitar' : 'piano', freq, name: n.name });
        }, at),
      );
      t += n.beats * tempo;
    }
  };
  schedule(notes);
  if (loop) {
    // 放歌：循环到被停止（每次续排 90s，避免无限定时器堆积；停止/新指令即清空）
    const scheduleLoop = () => {
      if (!currentKey) return;
      schedule(notes);
      songTimers.push(setTimeout(scheduleLoop, t + 600));
    };
    songTimers.push(setTimeout(scheduleLoop, t + 600));
  }
  return song?.title ?? '即兴';
}

/** 当前是否在弹（防重复触发同曲） */
export function aiSongPlaying(): boolean {
  return songTimers.length > 0;
}

/** 同曲防重：同乐器+同曲正在播就不重排 */
export function playAiSongOnce(kind: PlayKind, songInput?: string, opts?: { loop?: boolean; vol?: number }): string {
  const key = `${kind}:${matchSong(songInput)?.title ?? '即兴'}`;
  if (key === currentKey && songTimers.length > 0) return matchSong(songInput)?.title ?? '即兴';
  return playAiSong(kind, songInput, opts);
}
