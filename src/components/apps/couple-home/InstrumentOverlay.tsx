'use client';

/**
 * 情侣小家 —— 乐器弹奏覆盖层（生活模式点击吉他/钢琴 → 镜头推近 + 可弹奏界面）
 *
 * - 吉他：竖版六弦木纹指板（低音弦在左），点弦拨音、按住横扫 = 扫弦，
 *   Karplus-Strong 合成真实拨弦音；被拨的弦高频抖动；
 * - 钢琴：C4→C6 两组八度黑白键，多指和弦、滑音（glissando），
 *   谐波叠加合成钢琴音；键有按下动效；
 * - 顶部标题条 + 「结束演奏」按钮；面板外区域 pointer 穿透（可继续转动视角看小人）。
 */

import { useCallback, useRef, useState } from 'react';
import { Music, X } from 'lucide-react';
import {
  GUITAR_STRINGS,
  PIANO_BLACK,
  PIANO_WHITE,
  pianoNote,
  pluckString,
  prettyNote,
} from './instrument';

// ---------------- 吉他面板 ----------------

function GuitarPanel() {
  const [vibing, setVibing] = useState<number[]>([]); // 正在抖动的弦
  const vibeTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // 按住滑动扫弦：记录上一根被拨的弦，滑入新弦时再拨（每根弦每次按住只拨一次入列去重）
  const lastStrum = useRef<{ pid: number; idx: number }[]>([]);

  const twang = useCallback((idx: number) => {
    pluckString(GUITAR_STRINGS[idx].freq);
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

  const idxFromEvent = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width / GUITAR_STRINGS.length;
    return Math.max(0, Math.min(GUITAR_STRINGS.length - 1, Math.floor(x / w)));
  }, []);

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
      {/* 提示 */}
      <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-black/30 px-3 py-1 text-[11px] text-white/85 backdrop-blur-sm">
        点弦拨音 · 按住横扫＝扫弦
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

function PianoPanel() {
  const [pressed, setPressed] = useState<string[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // 滑音：按住拖动时经过新键也发声
  const lastKey = useRef<{ pid: number; key: string }[]>([]);

  const hit = useCallback((name: string, freq: number) => {
    pianoNote(freq);
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
  }, []);

  const whiteEls = PIANO_WHITE.map((k) => ({
    ...k,
    el: (
      <div
        key={k.name}
        className="relative flex-1 touch-none rounded-b-[7px] border-r border-[#d8d5cd] shadow-[inset_0_-7px_0_rgba(0,0,0,0.07)]"
        style={{
          WebkitTapHighlightColor: 'transparent',
          background: pressed.includes(k.name)
            ? 'linear-gradient(180deg,#efe9da,#e3dccb)'
            : 'linear-gradient(180deg,#ffffff,#f4f2ec)',
          transform: pressed.includes(k.name) ? 'scaleY(0.965)' : undefined,
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
  }));

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
          const isOn = pressed.includes(b.name);
          return (
            <div
              key={b.name}
              className="absolute top-0 z-10 h-[62%] touch-none rounded-b-[6px] shadow-[0_4px_8px_rgba(0,0,0,0.55)]"
              style={{
                left,
                width: `${unit * 0.62}%`,
                WebkitTapHighlightColor: 'transparent',
                background: isOn
                  ? 'linear-gradient(180deg,#4a4048,#332d33)'
                  : 'linear-gradient(180deg,#2f2f35,#101013)',
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
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-end">
      <div
        className="pointer-events-auto mx-3 mb-[168px] flex h-[46%] max-h-[420px] flex-col gap-2"
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
        {/* 乐器本体 */}
        {kind === 'guitar' ? <GuitarPanel /> : <PianoPanel />}
      </div>
    </div>
  );
}
