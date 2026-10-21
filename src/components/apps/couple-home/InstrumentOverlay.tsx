'use client';

/**
 * 情侣小家 —— 乐器弹奏覆盖层（生活模式点击吉他/钢琴 → 镜头推近 + 可弹奏界面）
 *
 * - 吉他：竖版六弦木纹指板（低音弦在左），点弦拨音、按住横扫 = 扫弦；
 *   底部和弦条 C/G/Am/F/Em：按住即「按弦」，此时扫弦弹出和弦把位（闷弦不发声）；
 * - 钢琴：C4→C6 两组八度黑白键，多指和弦、滑音（glissando），《小星星》一键自动演示；
 * - 音色切换（钢琴 3 种 / 吉他 2 种）、弹奏录音（跨乐器共享）与一键回放；
 * - 面板整体下沉收短（不遮挡 3D 小人）；面板外区域 pointer 穿透（可继续转动视角）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Music, X } from 'lucide-react';
import {
  GUITAR_CHORDS,
  GUITAR_STRINGS,
  PIANO_BLACK,
  PIANO_WHITE,
  TWINKLE,
  chordStringFreq,
  emitNote,
  type GuitarChord,
  type GuitarTimbre,
  onNote,
  pianoNote,
  pluckString,
  prettyNote,
  recClear,
  recGet,
  recIsRecording,
  recPlayTimbre,
  recStart,
  recStartedAt,
  recStop,
  recSubscribe,
  type PianoTimbre,
  twinkleTempoMs,
} from './instrument';

/** 音名 → 频率（演示曲排程用） */
const NOTE_FREQ = new Map<string, number>([...PIANO_WHITE, ...PIANO_BLACK].map((k) => [k.name, k.freq]));

const PIANO_TIMBRES: { v: PianoTimbre; label: string }[] = [
  { v: 'grand', label: '钢琴' },
  { v: 'ep', label: '电钢' },
  { v: 'musicbox', label: '八音盒' },
];
const GUITAR_TIMBRES: { v: GuitarTimbre; label: string }[] = [
  { v: 'acoustic', label: '木吉他' },
  { v: 'ukulele', label: '尤克里里' },
];

// ---------------- 吉他面板 ----------------

function GuitarPanel({ timbre }: { timbre: GuitarTimbre }) {
  const [vibing, setVibing] = useState<number[]>([]); // 正在抖动的弦
  const vibeTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // 按住滑动扫弦：记录上一根被拨的弦，滑入新弦时再拨（每根弦每次按住只拨一次入列去重）
  const lastStrum = useRef<{ pid: number; idx: number }[]>([]);
  // 按住的和弦：state 驱动 UI，ref 供扫弦时即时读取（多指：一手按和弦一手扫弦）
  const [heldChord, setHeldChord] = useState<GuitarChord | null>(null);
  const heldChordRef = useRef<GuitarChord | null>(null);

  // 弦抖动动效（回放/外部音符事件点亮时只动不发声）
  const flashString = useCallback((idx: number) => {
    setVibing((v) => (v.includes(idx) ? v : [...v, idx]));
    const old = vibeTimers.current.get(idx);
    if (old) clearTimeout(old);
    vibeTimers.current.set(
      idx,
      setTimeout(() => {
        setVibing((v) => v.filter((i) => i !== idx));
        vibeTimers.current.delete(idx);
      }, 520),
    );
  }, []);

  const twang = useCallback(
    (idx: number) => {
      const chord = heldChordRef.current;
      const semi = chord ? chord.offsets[idx] : null;
      if (chord && semi === null) return; // 按和弦时该弦被左手闷住，不出声
      const freq = chordStringFreq(GUITAR_STRINGS[idx].freq, semi);
      pluckString(freq, 1, timbre);
      emitNote({
        kind: 'guitar',
        freq,
        name: chord ? `${chord.name}·${GUITAR_STRINGS[idx].name}` : GUITAR_STRINGS[idx].name,
      });
      flashString(idx);
    },
    [flashString, timbre],
  );

  // 音符事件（录音回放等）点亮就近开放弦
  useEffect(() => {
    return onNote((e) => {
      if (e.kind !== 'guitar') return;
      let best = 0;
      let bestD = Infinity;
      GUITAR_STRINGS.forEach((s, i) => {
        const d = Math.abs(Math.log(s.freq / e.freq));
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      flashString(best);
    });
  }, [flashString]);

  const idxFromEvent = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width / GUITAR_STRINGS.length;
    return Math.max(0, Math.min(GUITAR_STRINGS.length - 1, Math.floor(x / w)));
  }, []);

  // 松开和弦：按住后任意位置 pointerup / pointercancel 都释放
  useEffect(() => {
    if (!heldChord) return;
    const release = () => {
      heldChordRef.current = null;
      setHeldChord(null);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [heldChord]);

  return (
    <div className="relative flex-1 overflow-hidden rounded-[26px] shadow-2xl">
      {/* 木纹指板 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg,#7a5230 0%,#6b4426 18%,#8a5f38 38%,#6b4426 62%,#5d3a20 82%,#4c2f1a 100%)',
        }}
      />
      {/* 品丝 + 品记 */}
      <div className="absolute inset-0">
        {[12, 28, 44, 60, 76, 90].map((top) => (
          <div
            key={top}
            className="absolute inset-x-0 h-[5px] rounded-full bg-gradient-to-b from-[#cfd4d8] via-[#9aa3ab] to-[#7c848c] shadow"
            style={{ top: `${top}%` }}
          />
        ))}
        {[20, 36, 52].map((top) => (
          <div
            key={top}
            className="absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-[#efe6d4]/90 shadow-inner"
            style={{ top: `${top}%` }}
          />
        ))}
      </div>
      {/* 六根弦（可拨/可扫） */}
      <div
        className="absolute inset-0 flex touch-none"
        style={{ WebkitTapHighlightColor: 'transparent' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          const idx = idxFromEvent(e);
          twang(idx);
          lastStrum.current = [{ pid: e.pointerId, idx }];
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0 && e.pointerType === 'mouse') return;
          if (!lastStrum.current.some((s) => s.pid === e.pointerId)) return;
          const idx = idxFromEvent(e);
          const mine = lastStrum.current.find((s) => s.pid === e.pointerId);
          if (mine && mine.idx !== idx) {
            twang(idx);
            mine.idx = idx;
          }
        }}
        onPointerUp={(e) => {
          lastStrum.current = lastStrum.current.filter((s) => s.pid !== e.pointerId);
        }}
        onPointerCancel={(e) => {
          lastStrum.current = lastStrum.current.filter((s) => s.pid !== e.pointerId);
        }}
      >
        {GUITAR_STRINGS.map((s, i) => (
          <div key={s.name + i} className="relative flex-1">
            {/* 弦体：低音弦缠丝金色 / 高音弦银亮，拨动时抖动 */}
            <div
              className={`absolute left-1/2 top-0 h-full w-[3.5px] -translate-x-1/2 rounded-full ${
                i % 2 === 0 ? 'animate-none' : ''
              }`}
              style={{
                background: s.wound
                  ? 'linear-gradient(90deg,#b98f3e,#f3dd9a 45%,#b98f3e)'
                  : 'linear-gradient(90deg,#9fa6ac,#f2f5f7 45%,#9fa6ac)',
                boxShadow: '0 0 4px rgba(0,0,0,0.45)',
                animation: vibing.includes(i) ? 'stringVibe 0.5s ease-out' : undefined,
              }}
            />
            {/* 弦枕环 */}
            <div className="absolute left-1/2 top-[3px] h-4 w-5 -translate-x-1/2 rounded-full border border-[#3a2a18]/60 bg-[#2a1d10]/50" />
            {/* 弦名 */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/35 px-2 py-0.5 text-[11px] font-bold text-[#f5e9d2]">
              {s.name}
            </div>
          </div>
        ))}
      </div>
      {/* 提示 / 已按和弦徽标 */}
      <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/30 px-3 py-1 text-[11px] text-white/85 backdrop-blur-sm">
        {heldChord ? `已按 ${heldChord.name} 和弦 · 扫弦试试` : '点弦拨音 · 按住横扫＝扫弦'}
      </div>
      {/* 和弦条：按住即「按弦」，此时扫弦弹和弦把位；仅 chip 自身拦截 pointer，不挡扫弦 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-9 z-20 flex items-center justify-center gap-1.5">
        {GUITAR_CHORDS.map((c) => {
          const held = heldChord?.id === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-label={`按住 ${c.name} 和弦`}
              className={`pointer-events-auto h-8 min-w-9 touch-none rounded-full px-2 text-[12px] font-bold text-white shadow-md transition active:scale-95 ${
                held ? '-translate-y-1 ring-2 ring-white/90' : ''
              }`}
              style={{ backgroundColor: c.tint, WebkitTapHighlightColor: 'transparent' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                heldChordRef.current = c;
                setHeldChord(c);
              }}
            >
              {c.name}
            </button>
          );
        })}
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes stringVibe{0%{transform:translate(-50%,0) scaleX(1)}15%{transform:translate(-46%,0) scaleX(2.6)}30%{transform:translate(-54%,0) scaleX(.7)}45%{transform:translate(-47%,0) scaleX(2.2)}60%{transform:translate(-53%,0) scaleX(.85)}75%{transform:translate(-49%,0) scaleX(1.6)}100%{transform:translate(-50%,0) scaleX(1)}}`,
        }}
      />
    </div>
  );
}

// ---------------- 钢琴面板 ----------------

function PianoPanel({ timbre }: { timbre: PianoTimbre }) {
  const [pressed, setPressed] = useState<string[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // 滑音：按住拖动时经过新键也发声
  const lastKey = useRef<{ pid: number; key: string }[]>([]);
  // 外部音符（小星星演示 / 录音回放）点亮的键
  const [lit, setLit] = useState<string[]>([]);
  const litTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const hit = useCallback(
    (name: string, freq: number) => {
      pianoNote(freq, 1, timbre);
      emitNote({ kind: 'piano', freq, name });
      setPressed((p) => (p.includes(name) ? p : [...p, name]));
      const old = timers.current.get(name);
      if (old) clearTimeout(old);
      timers.current.set(
        name,
        setTimeout(() => {
          setPressed((p) => p.filter((n) => n !== name));
          timers.current.delete(name);
        }, 260),
      );
    },
    [timbre],
  );

  // 音符事件点亮对应琴键（演示曲与录音回放共用，也覆盖另一处弹奏）
  useEffect(() => {
    return onNote((e) => {
      if (e.kind !== 'piano') return;
      setLit((l) => (l.includes(e.name) ? l : [...l, e.name]));
      const old = litTimers.current.get(e.name);
      if (old) clearTimeout(old);
      litTimers.current.set(
        e.name,
        setTimeout(() => {
          setLit((l) => l.filter((n) => n !== e.name));
          litTimers.current.delete(e.name);
        }, 300),
      );
    });
  }, []);

  // 卸载时清掉灯光定时器
  useEffect(
    () => () => {
      litTimers.current.forEach((t) => clearTimeout(t));
      litTimers.current.clear();
    },
    [],
  );

  const whiteEls = PIANO_WHITE.map((k) => {
    const on = pressed.includes(k.name) || lit.includes(k.name);
    return {
      ...k,
      el: (
        <div
          key={k.name}
          className="relative flex-1 touch-none rounded-b-[7px] border-r border-[#d8d5cd] shadow-[inset_0_-7px_0_rgba(0,0,0,0.07)]"
          style={{
            WebkitTapHighlightColor: 'transparent',
            background: on ? 'linear-gradient(180deg,#efe9da,#e3dccb)' : 'linear-gradient(180deg,#ffffff,#f4f2ec)',
            transform: on ? 'scaleY(0.965)' : undefined,
            transformOrigin: 'top',
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            hit(k.name, k.freq);
            lastKey.current = [...lastKey.current.filter((s) => s.pid !== e.pointerId), { pid: e.pointerId, key: k.name }];
          }}
          onPointerMove={(e) => {
            if (e.buttons === 0 && e.pointerType === 'mouse') return;
            const mine = lastKey.current.find((s) => s.pid === e.pointerId);
            if (mine && mine.key !== k.name) {
              hit(k.name, k.freq);
              mine.key = k.name;
            }
          }}
          onPointerUp={(e) => {
            lastKey.current = lastKey.current.filter((s) => s.pid !== e.pointerId);
          }}
          onPointerCancel={(e) => {
            lastKey.current = lastKey.current.filter((s) => s.pid !== e.pointerId);
          }}
        >
          {k.label && (
            <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-[#a8a49a]">
              {k.name}
            </span>
          )}
        </div>
      ),
    };
  });

  return (
    <div className="relative flex-1 overflow-hidden rounded-[26px] bg-gradient-to-b from-[#26262b] to-[#151518] p-3 pb-4 shadow-2xl">
      <div className="relative flex h-full gap-0">
        {whiteEls.map((w) => (
          <div key={w.name} className="relative flex flex-1">
            {w.el}
          </div>
        ))}
        {/* 黑键覆盖层 */}
        {PIANO_BLACK.map((b) => {
          const unit = 100 / PIANO_WHITE.length;
          const left = `calc(${(b.after + 1) * unit}% - ${unit * 0.31}%)`;
          const isOn = pressed.includes(b.name) || lit.includes(b.name);
          return (
            <div
              key={b.name}
              className="absolute top-0 z-10 h-[62%] touch-none rounded-b-[6px] shadow-[0_4px_8px_rgba(0,0,0,0.55)]"
              style={{
                left,
                width: `${unit * 0.62}%`,
                WebkitTapHighlightColor: 'transparent',
                background: isOn ? 'linear-gradient(180deg,#4a4048,#332d33)' : 'linear-gradient(180deg,#2f2f35,#101013)',
                transform: isOn ? 'scaleY(0.96)' : undefined,
                transformOrigin: 'top',
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture?.(e.pointerId);
                hit(b.name, b.freq);
                lastKey.current = [...lastKey.current.filter((s) => s.pid !== e.pointerId), { pid: e.pointerId, key: b.name }];
              }}
              onPointerMove={(e) => {
                if (e.buttons === 0 && e.pointerType === 'mouse') return;
                const mine = lastKey.current.find((s) => s.pid === e.pointerId);
                if (mine && mine.key !== b.name) {
                  hit(b.name, b.freq);
                  mine.key = b.name;
                }
              }}
              onPointerUp={(e) => {
                lastKey.current = lastKey.current.filter((s) => s.pid !== e.pointerId);
              }}
              onPointerCancel={(e) => {
                lastKey.current = lastKey.current.filter((s) => s.pid !== e.pointerId);
              }}
            >
              <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-semibold text-white/40">
                {prettyNote(b.name)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute left-1/2 top-1.5 -translate-x-1/2 rounded-full bg-white/10 px-3 py-0.5 text-[11px] text-white/85">
        点键发声 · 按住滑键＝滑音 · 多指可和弦
      </div>
    </div>
  );
}

// ---------------- 覆盖层主体 ----------------

export default function InstrumentOverlay({
  kind,
  onClose,
}: {
  kind: 'piano' | 'guitar';
  onClose: () => void;
}) {
  const stop = useCallback((e: React.SyntheticEvent) => e.stopPropagation(), []);

  // 音色（钢琴/吉他各自记忆，切面板不丢）
  const [pianoTimbre, setPianoTimbre] = useState<PianoTimbre>('grand');
  const [guitarTimbre, setGuitarTimbre] = useState<GuitarTimbre>('acoustic');
  const timbre: PianoTimbre | GuitarTimbre = kind === 'piano' ? pianoTimbre : guitarTimbre;
  // 回放/演示定时器触发时读取最新音色与面板（在 effect 中同步，避免渲染期写 ref）
  const timbreRef = useRef(timbre);
  const kindRef = useRef(kind);
  useEffect(() => {
    timbreRef.current = timbre;
    kindRef.current = kind;
    recPlayTimbre.current = timbre;
  }, [timbre, kind]);

  // —— 录音机（全局共享，跨面板/跨乐器）——
  const [recording, setRecording] = useState(recIsRecording());
  // 录音开始时刻（挂载时可能已在录音中：录音跨面板关闭/重开共享）
  const [recStartAt, setRecStartAt] = useState(() => (recIsRecording() ? recStartedAt() : 0));
  const [, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // —— 《小星星》演示 ——
  const [demoOn, setDemoOn] = useState(false);
  const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // 录音开始/停止/清空时刷新 UI
  useEffect(() => recSubscribe(() => setRecording(recIsRecording())), []);

  // 录音计时（节拍器式重渲，秒数在渲染时现算）
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setTick((n) => n + 1), 300);
    return () => clearInterval(id);
  }, [recording]);
  const elapsed = recording ? Math.max(0, Math.floor((Date.now() - recStartAt) / 1000)) : 0;

  const stopPlayback = useCallback(() => {
    playTimers.current.forEach(clearTimeout);
    playTimers.current = [];
    setPlaying(false);
  }, []);

  const stopDemo = useCallback(() => {
    demoTimers.current.forEach(clearTimeout);
    demoTimers.current = [];
    setDemoOn(false);
  }, []);

  // 回放：按事件时间表依次发声；音色按「事件种类 = 当前面板」路由（否则用该乐器默认音色）
  const startPlayback = useCallback(() => {
    if (recIsRecording()) return; // 录音中回放无效
    const events = recGet();
    if (!events.length) return;
    stopDemo();
    playTimers.current.forEach(clearTimeout);
    setPlaying(true);
    playTimers.current = events.map((ev) =>
      setTimeout(
        () => {
          const t = timbreRef.current;
          const matched = ev.kind === kindRef.current;
          if (ev.kind === 'piano') {
            pianoNote(ev.freq, 1, matched ? (t as PianoTimbre) : 'grand');
          } else {
            pluckString(ev.freq, 1, matched ? (t as GuitarTimbre) : 'acoustic');
          }
          emitNote(ev, { record: false }); // 回放不进录音带；琴键/弦灯由 onNote 订阅点亮
        },
        Math.max(0, ev.t),
      ),
    );
  }, [stopDemo]);

  // 小星星：按拍 setTimeout 链排程（二分音符 = 2 拍），demoOn 防双开
  const startDemo = useCallback(() => {
    stopDemo();
    if (playing) stopPlayback();
    setDemoOn(true);
    let t = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const n of TWINKLE) {
      const freq = NOTE_FREQ.get(n.name);
      if (freq == null) continue;
      const delay = t;
      timers.push(
        setTimeout(() => {
          pianoNote(freq, 1, timbreRef.current as PianoTimbre);
          emitNote({ kind: 'piano', freq, name: n.name }, { record: false });
        }, delay),
      );
      t += twinkleTempoMs * n.beats;
    }
    // 曲终收尾
    timers.push(
      setTimeout(() => {
        demoTimers.current = [];
        setDemoOn(false);
      }, t + 400),
    );
    demoTimers.current = timers;
  }, [playing, stopDemo, stopPlayback]);

  const toggleRec = useCallback(() => {
    if (recIsRecording()) {
      recStop();
    } else {
      recStart();
      setRecStartAt(recStartedAt());
    }
  }, []);

  const clearRec = useCallback(() => {
    stopPlayback();
    recClear();
  }, [stopPlayback]);

  // 卸载：清掉回放与演示定时器；切换乐器也要停演示曲
  useEffect(
    () => () => {
      playTimers.current.forEach(clearTimeout);
      playTimers.current = [];
      demoTimers.current.forEach(clearTimeout);
      demoTimers.current = [];
    },
    [],
  );
  useEffect(() => {
    return () => stopDemo();
  }, [kind, stopDemo]);

  const hasRec = recGet().length > 0;
  const canPlay = !recording && hasRec;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-end">
      <div
        className="pointer-events-auto mx-3 mb-[104px] flex h-[36%] max-h-[320px] flex-col gap-2"
        onPointerDown={stop}
        onPointerMove={stop}
        onPointerUp={stop}
        onTouchStart={stop}
        onTouchMove={stop}
      >
        {/* 标题条 */}
        <div className="flex items-center justify-between rounded-full bg-[#3a3a3e]/90 px-4 py-2 shadow-lg backdrop-blur">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
            <Music className="h-4 w-4 text-[#f4b3c2]" />
            {kind === 'piano' ? '弹钢琴 · C4–C6' : '弹吉他 · 标准调弦'}
          </div>
          <button
            onClick={onClose}
            aria-label="结束演奏"
            className="flex h-8 items-center gap-1 rounded-full bg-[#f4b3c2] px-3 text-[12px] font-semibold text-white transition active:scale-95"
          >
            <X className="h-3.5 w-3.5" />
            结束演奏
          </button>
        </div>
        {/* 工具条：音色 + 小星星（钢琴）｜录音/回放/清除 */}
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 rounded-full bg-[#3a3a3e]/90 px-2 shadow-lg backdrop-blur">
          <div className="flex min-w-0 items-center gap-1">
            {(kind === 'piano' ? PIANO_TIMBRES : GUITAR_TIMBRES).map((t) => {
              const active = timbre === t.v;
              return (
                <button
                  key={t.v}
                  type="button"
                  onClick={() =>
                    kind === 'piano' ? setPianoTimbre(t.v as PianoTimbre) : setGuitarTimbre(t.v as GuitarTimbre)
                  }
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] transition active:scale-95 ${
                    active ? 'bg-[#f4b3c2] font-semibold text-white' : 'bg-white/20 text-white/80'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
            {kind === 'piano' && (
              <button
                type="button"
                onClick={() => (demoOn ? stopDemo() : startDemo())}
                className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition active:scale-95 ${
                  demoOn ? 'bg-[#f4b3c2] font-semibold text-white' : 'bg-white/20 text-white/80'
                }`}
              >
                {demoOn ? (
                  <>
                    <span className="inline-block h-2 w-2 rounded-[2px] bg-current" />
                    停止
                  </>
                ) : (
                  <>
                    <Music className="h-3 w-3" />
                    小星星
                  </>
                )}
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={toggleRec}
              className={`flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition active:scale-95 ${
                recording ? 'bg-red-500 text-white' : 'bg-white/20 text-white/80'
              }`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${recording ? 'animate-pulse bg-white' : 'bg-red-400'}`}
              />
              {recording ? `录 ${elapsed}s` : '录'}
            </button>
            <button
              type="button"
              onClick={() => (playing ? stopPlayback() : startPlayback())}
              disabled={!playing && !canPlay}
              className={`flex h-7 shrink-0 items-center gap-1 rounded-full bg-white/20 px-2.5 text-[11px] font-semibold transition active:scale-95 ${
                playing ? 'bg-[#f4b3c2] text-white' : 'text-white/80'
              } ${!playing && !canPlay ? 'opacity-40' : ''}`}
            >
              {playing ? '■ 停止' : '▶ 回放'}
            </button>
            {hasRec && !recording && (
              <button
                type="button"
                onClick={clearRec}
                aria-label="清除录音"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-[13px] font-bold text-white/80 transition active:scale-95"
              >
                ×
              </button>
            )}
          </div>
        </div>
        {/* 乐器本体 */}
        {kind === 'guitar' ? <GuitarPanel timbre={guitarTimbre} /> : <PianoPanel timbre={pianoTimbre} />}
      </div>
    </div>
  );
}
