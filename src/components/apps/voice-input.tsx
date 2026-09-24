'use client';

/**
 * 语音录制交互（微信 / QQ / 信息 / 两端群聊共用）：
 * - useVoiceRecorder：MediaRecorder 录音（mime 能力探测 + 24kbps opus），AnalyserNode 实时振幅采样，
 *   60 秒上限自动结束；结束回调 onResult(result, zone) —— result 为 null 表示太短/已取消
 * - 按住标志（多任务误触修复）：beginVoiceHold/endVoiceHold 维护模块级计数，PhoneShell 底部
 *   边缘上滑手势读到 isVoiceHoldActive() 即中止 —— 「按住 说话」胶囊就在边缘带内，录音时
 *   上滑取消不再把多任务卡片拉起来
 * - VoiceHoldBar：微信/信息输入区「按住 说话」胶囊。按住开录，setPointerCapture + touch-none
 *   保证手指划出仍持续跟踪、不被浏览器滚动认领；上滑/左滑 → 取消，右滑 → 转文字，原松开 → 发送
 * - QqVoicePanel / QqVoiceHoldButton：QQ 风语音面板（参考 QQ App：工具栏下方展开
 *   「按住说话」+ 大圆麦克风 + 变声/对讲/录音页签）。大圆钮按住开录：左滑 → 「文」转文字，
 *   右滑/上滑 → 「×」取消，原松开 → 发送
 * - RecordOverlayWx：微信风录音浮层 —— 暗幕 + 绿色气泡实时波形 + 底部「取消 / 滑到这里 转文字」
 *   + 浅色「松开 发送」条
 * - RecordOverlayQq：QQ 风录音浮层 —— 白幕 + 顶部计时与两侧波形 + 中央大麦克风 + 左「文」右「×」
 * - 权限被拒/不支持录音：onStartError 提示，仍可继续用文字聊天
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { downsampleWave, pickRecorderMime } from '@/lib/ios/audio-utils';
import { stopVoicePlayback } from '@/lib/ios/voice-player';

export interface VoiceRecordResult {
  blob: Blob;
  /** 秒（≥1，四舍五入） */
  duration: number;
  /** 气泡静态波形（22 根，0~1） */
  wave: number[];
}

export type VoiceRecordZone = 'cancel' | 'stt' | null;

export interface VoiceRecorder {
  phase: 'idle' | 'starting' | 'recording';
  /** 录音已进行秒数（浮点，100ms 刷新） */
  seconds: number;
  /** 实时振幅采样（约每 100ms 一个，0~1） */
  levels: number[];
  /** 手势目标区：null=原松开发送 / cancel=取消 / stt=转文字 */
  zone: VoiceRecordZone;
  setZone: (z: VoiceRecordZone) => void;
  start: () => void;
  finish: () => void;
}

const WAVE_BARS = 22;
const MAX_SEC = 60;
const MIN_SEC = 0.7;

/* ───────────────────────── 按住录音标志（供 PhoneShell 屏蔽多任务手势） ───────────────────────── */

let holdCount = 0;

/** 按住录音开始（计数 +1）：PhoneShell 底部边缘上滑手势在读到 true 期间不再打开多任务卡片 */
export function beginVoiceHold(): void {
  holdCount += 1;
}

/** 按住录音结束（计数 -1） */
export function endVoiceHold(): void {
  holdCount = Math.max(0, holdCount - 1);
}

/** PhoneShell 查询：当前是否处于「按住说话」手势中 */
export function isVoiceHoldActive(): boolean {
  return holdCount > 0;
}

/** 按住标志接线：down 时 begin，up/cancel/卸载时 end（防重复、防泄漏） */
function useHoldFlag() {
  const flagRef = useRef(false);
  useEffect(
    () => () => {
      if (flagRef.current) {
        flagRef.current = false;
        endVoiceHold();
      }
    },
    [],
  );
  return {
    begin: () => {
      if (!flagRef.current) {
        flagRef.current = true;
        beginVoiceHold();
      }
    },
    end: () => {
      if (flagRef.current) {
        flagRef.current = false;
        endVoiceHold();
      }
    },
  };
}

/* ───────────────────────── 录音器 ───────────────────────── */

export function useVoiceRecorder(opts: {
  /** 结束回调：result=null 表示太短或取消；zone 告知手势去向 */
  onResult: (result: VoiceRecordResult | null, zone: VoiceRecordZone) => void;
  /** 开始失败（权限被拒/不支持）提示文案回调 */
  onStartError: (msg: string) => void;
}): VoiceRecorder {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [zone, setZoneState] = useState<VoiceRecordZone>(null);

  const optsRef = useRef(opts);
  // 回调经 ref 透传（避免 useVoiceRecorder 返回的函数随 onResult 身份变化重建）
  useEffect(() => {
    optsRef.current = opts;
  });

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>('');
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const levelBufRef = useRef<number[]>([]);
  const lastSampleRef = useRef(0);
  const startRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const phaseRef = useRef<'idle' | 'starting' | 'recording'>('idle');
  const zoneRef = useRef<VoiceRecordZone>(null);
  const stopRequestedRef = useRef(false);
  const deadRef = useRef(false);

  const setPhaseSafe = (p: 'idle' | 'starting' | 'recording') => {
    phaseRef.current = p;
    setPhase(p);
  };
  const setZoneSafe = useCallback((z: VoiceRecordZone) => {
    zoneRef.current = z;
    setZoneState(z);
  }, []);

  const cleanupCapture = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      ctxRef.current?.close();
    } catch {
      /* ignore */
    }
    ctxRef.current = null;
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // 卸载时若还在录音：静默丢弃
  useEffect(
    () => () => {
      deadRef.current = true;
      const rec = recRef.current;
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null;
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      recRef.current = null;
      cleanupCapture();
    },
    [cleanupCapture],
  );

  const finalize = useCallback(
    (discard: boolean) => {
      const rec = recRef.current;
      const elapsed = (performance.now() - startRef.current) / 1000;
      const z = zoneRef.current;
      recRef.current = null;
      cleanupCapture();
      setPhaseSafe('idle');
      setZoneSafe(null);
      setSeconds(0);
      setLevels([]);
      if (discard || !rec || elapsed < MIN_SEC) {
        // 太短：只有「原松开」才提示，取消手势静默
        chunksRef.current = [];
        if (!discard && z === null) optsRef.current.onResult(null, null);
        return;
      }
      const chunks = chunksRef.current;
      chunksRef.current = [];
      if (chunks.length === 0) {
        optsRef.current.onResult(null, z);
        return;
      }
      const blob = new Blob(chunks, { type: mimeRef.current.includes('audio') ? mimeRef.current : 'audio/webm' });
      const result: VoiceRecordResult = {
        blob,
        duration: Math.max(1, Math.round(elapsed)),
        wave: downsampleWave(levelBufRef.current, WAVE_BARS),
      };
      optsRef.current.onResult(result, z);
    },
    [cleanupCapture, setZoneSafe],
  );

  const start = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    // 录音前停掉在播的语音气泡/TTS，避免回声
    stopVoicePlayback();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      optsRef.current.onStartError('当前浏览器不支持录音');
      return;
    }
    stopRequestedRef.current = false;
    setPhaseSafe('starting');
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (phaseRef.current !== 'starting' || deadRef.current) {
          // 等权限期间已卸载/取消
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const mime = pickRecorderMime();
        mimeRef.current = mime ?? 'audio/webm';
        let rec: MediaRecorder;
        try {
          rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 });
        } catch {
          try {
            rec = new MediaRecorder(stream);
            mimeRef.current = rec.mimeType || 'audio/webm';
          } catch {
            stream.getTracks().forEach((t) => t.stop());
            setPhaseSafe('idle');
            optsRef.current.onStartError('当前浏览器不支持录音');
            return;
          }
        }
        chunksRef.current = [];
        levelBufRef.current = [];
        lastSampleRef.current = 0;
        rec.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        rec.onstop = () => finalize(false);
        rec.start(200);
        recRef.current = rec;

        // 实时振幅采样（overlay 波形动画 + 气泡静态波形）
        try {
          const w = window as Window & { webkitAudioContext?: typeof AudioContext };
          const Ctor = window.AudioContext ?? w.webkitAudioContext;
          if (Ctor) {
            const ctx = new Ctor();
            void ctx.resume().catch(() => undefined);
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            ctxRef.current = ctx;
            analyserRef.current = analyser;
          }
        } catch {
          // 采样失败不影响录音本身
        }

        startRef.current = performance.now();
        setSeconds(0);
        setPhaseSafe('recording');
        timerRef.current = window.setInterval(() => {
          const sec = (performance.now() - startRef.current) / 1000;
          setSeconds(sec);
          // 每 ~100ms 采一个 RMS
          const analyser = analyserRef.current;
          if (analyser && performance.now() - lastSampleRef.current > 100) {
            lastSampleRef.current = performance.now();
            const buf = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) {
              const d = (buf[i] - 128) / 128;
              sum += d * d;
            }
            const rms = Math.sqrt(sum / buf.length);
            levelBufRef.current.push(Math.max(0.08, Math.min(1, rms * 3.2)));
            setLevels(levelBufRef.current.slice(-160));
          }
          if (sec >= MAX_SEC) {
            // 60 秒上限：自动结束并发送（与松开同路径，走 onstop → finalize）
            const cur = recRef.current;
            if (cur && cur.state !== 'inactive') {
              try {
                cur.stop();
              } catch {
                finalize(false);
              }
            }
          }
        }, 100);
        // 按住期间就松手（getUserMedia 等待中）：进入录音后立刻结束
        if (stopRequestedRef.current) finalize(false);
      })
      .catch((err: unknown) => {
        // 启动失败（权限拒绝 / 构造或启动录音器异常）：释放可能已取得的媒体流与录音器，避免麦克风占用泄漏
        const rec = recRef.current;
        if (rec && rec.state !== 'inactive') {
          rec.onstop = null;
          try {
            rec.stop();
          } catch {
            /* ignore */
          }
        }
        recRef.current = null;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        cleanupCapture();
        setPhaseSafe('idle');
        const name = typeof err === 'object' && err !== null ? (err as { name?: string }).name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
          optsRef.current.onStartError('无法使用麦克风：请在浏览器设置中允许录音权限');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          optsRef.current.onStartError('未找到可用麦克风');
        } else {
          optsRef.current.onStartError('无法访问麦克风，请检查权限设置');
        }
      });
  }, [cleanupCapture, finalize]);

  const finish = useCallback(() => {
    if (phaseRef.current === 'starting') {
      // 还在等权限/启动：标记，等真正开始录音后立即结束
      stopRequestedRef.current = true;
      return;
    }
    if (phaseRef.current !== 'recording') return;
    const rec = recRef.current;
    if (!rec) return;
    try {
      if (rec.state !== 'inactive') rec.stop();
      else finalize(false);
    } catch {
      finalize(false);
    }
  }, [finalize]);

  return { phase, seconds, levels, zone, setZone: setZoneSafe, start, finish };
}

/* ───────────────────────── 按住手势（微信/信息胶囊 + QQ 大圆钮） ───────────────────────── */

/** 按住手势通用接线：down 起录 + 标志，move 更新区，up/cancel 收尾 */
function useHoldGesture(rec: VoiceRecorder, applyZone: (dx: number, dy: number) => void) {
  const startPt = useRef({ x: 0, y: 0 });
  const flag = useHoldFlag();
  const holding = rec.phase !== 'idle';

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    startPt.current = { x: e.clientX, y: e.clientY };
    flag.begin();
    rec.setZone(null);
    rec.start();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!holding) return;
    applyZone(e.clientX - startPt.current.x, e.clientY - startPt.current.y);
  };
  const onPointerUp = () => {
    if (!holding) return;
    flag.end();
    rec.finish();
  };
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}

/** 「按住 说话」胶囊（微信/信息）：按住开录；上滑/左滑取消，右滑转文字，松开发送 */
export function VoiceHoldBar({
  rec,
  testId = 'voice-hold-bar',
}: {
  rec: VoiceRecorder;
  testId?: string;
}) {
  const holding = rec.phase !== 'idle';
  const applyZone = (dx: number, dy: number) => {
    if (dy < -60 || dx < -70) rec.setZone('cancel'); // 上滑 / 左滑 → 取消
    else if (dx > 70) rec.setZone('stt'); // 右滑 → 转文字
    else rec.setZone(null);
  };
  const g = useHoldGesture(rec, applyZone);

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={holding ? '正在录音，松开发送，上滑取消' : '按住说话'}
      onPointerDown={g.onPointerDown}
      onPointerMove={g.onPointerMove}
      onPointerUp={g.onPointerUp}
      onPointerCancel={g.onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      className={`h-[36px] min-w-0 flex-1 touch-none select-none rounded-[5px] text-center text-[16px] leading-[36px] transition-colors ${
        rec.zone === 'cancel'
          ? 'bg-[#FA5151] text-white'
          : rec.zone === 'stt'
            ? 'bg-[#07C160] text-white'
            : 'bg-white text-black active:bg-black/[0.04] dark:bg-[#232323] dark:text-white dark:active:bg-white/[0.06]'
      }`}
    >
      {rec.phase === 'starting' ? '准备中…' : holding ? '松开 发送' : '按住 说话'}
    </button>
  );
}

/** QQ 大圆麦克风钮：按住开录；左滑 → 「文」转文字，右滑/上滑 → 「×」取消，松开发送 */
export function QqVoiceHoldButton({
  rec,
  testId = 'qq-voice-hold',
}: {
  rec: VoiceRecorder;
  testId?: string;
}) {
  const holding = rec.phase !== 'idle';
  const applyZone = (dx: number, dy: number) => {
    if (dx < -70) rec.setZone('stt'); // 左滑 → 「文」转文字
    else if (dy < -60 || dx > 70) rec.setZone('cancel'); // 上滑 / 右滑 → 「×」取消
    else rec.setZone(null);
  };
  const g = useHoldGesture(rec, applyZone);

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={holding ? '正在录音，松开发送，左滑转文字，右滑取消' : '按住说话'}
      onPointerDown={g.onPointerDown}
      onPointerMove={g.onPointerMove}
      onPointerUp={g.onPointerUp}
      onPointerCancel={g.onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      className="grid h-[112px] w-[112px] touch-none select-none place-items-center rounded-full bg-gradient-to-b from-[#3AA0FF] to-[#1374F0] shadow-[0_10px_36px_rgba(31,143,255,0.45)] transition-transform active:scale-[0.97]"
    >
      <Mic className="h-12 w-12 text-white" strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/** QQ 语音面板（工具栏下方展开）：「按住说话」+ 大圆麦克风 + 变声/对讲/录音页签（装饰） */
export function QqVoicePanel({
  rec,
  holdTestId = 'qq-voice-hold',
}: {
  rec: VoiceRecorder;
  holdTestId?: string;
}) {
  return (
    <div className="relative z-10 flex h-[290px] shrink-0 select-none flex-col items-center bg-white pb-4 dark:bg-[#1B1C1F]" data-testid="qq-voice-panel">
      <p className="mt-4 text-[17px] text-black/40 dark:text-white/40">按住说话</p>
      <div className="flex flex-1 items-center">
        <QqVoiceHoldButton rec={rec} testId={holdTestId} />
      </div>
      <div className="flex w-full items-center justify-center gap-14 text-[15px]">
        <span className="text-black/30 dark:text-white/30">变声</span>
        <span className="font-medium text-black/85 dark:text-white/85">对讲</span>
        <span className="text-black/30 dark:text-white/30">录音</span>
      </div>
    </div>
  );
}

/* ───────────────────────── 录音浮层（微信风 / QQ 风） ───────────────────────── */

function timeLabelOf(seconds: number): string {
  const sec = Math.floor(seconds);
  return `0:${String(Math.min(59, sec)).padStart(2, '0')}`;
}

/** 微信风录音浮层：暗幕 + 绿色气泡实时波形 + 底部「取消 / 滑到这里 转文字」+ 浅色「松开 发送」条 */
export function RecordOverlayWx({ rec }: { rec: VoiceRecorder }) {
  if (rec.phase === 'idle') return null;
  const cancel = rec.zone === 'cancel';
  const stt = rec.zone === 'stt';
  const bars = rec.levels.slice(-26);
  while (bars.length < 26) bars.unshift(0.08);
  return (
    <div
      data-testid="voice-record-overlay"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center bg-black/75"
    >
      {/* 绿色录音气泡（转文字/取消时变色）+ 下指尾巴 */}
      <div className="relative mt-[16%]">
        <div
          className={`flex h-[92px] items-center justify-center gap-[3px] rounded-[24px] px-7 transition-colors ${
            cancel ? 'bg-[#FA5151]' : 'bg-[#95EC69]'
          }`}
        >
          {bars.map((v, i) => (
            <span
              key={i}
              className={`w-[3px] rounded-full ${cancel ? 'bg-white/90' : 'bg-[#3CA135]/85'}`}
              style={{ height: `${Math.max(4, v * 54)}px` }}
            />
          ))}
        </div>
        <span
          className={`absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[10px] border-t-[12px] border-x-transparent transition-colors ${
            cancel ? 'border-t-[#FA5151]' : 'border-t-[#95EC69]'
          }`}
        />
      </div>
      {/* 计时 */}
      <p className="mt-5 text-[15px] tabular-nums text-white/70" data-testid="voice-record-timer">
        {timeLabelOf(rec.seconds)}
      </p>
      {/* 底部手势提示区（手势仍在按住的胶囊上，纯视觉） */}
      <div className="mt-auto flex w-full items-end justify-between px-6 pb-[84px]">
        <span
          className={`rounded-full px-5 py-2 text-[15px] transition-colors ${
            cancel ? 'bg-white text-[#FA5151]' : 'bg-white/15 text-white/80'
          }`}
        >
          取消
        </span>
        <span
          className={`rounded-full px-5 py-2 text-[15px] transition-colors ${
            stt ? 'bg-white text-[#07C160]' : 'bg-white/15 text-white/80'
          }`}
        >
          滑到这里 转文字
        </span>
      </div>
      {/* 浅色「松开 发送」条（模拟输入区位置） */}
      <div className="flex h-[58px] w-full items-center justify-center bg-[#EDEDED]/95 dark:bg-[#2C2C2C]/95">
        <span className="text-[16px] text-black/85 dark:text-white/85">
          {cancel ? '松开 取消' : stt ? '松开 转文字' : '松开 发送'}
        </span>
      </div>
    </div>
  );
}

/** QQ 风录音浮层：白幕 + 顶部计时与两侧波形 + 中央大麦克风 + 左「文」右「×」 */
export function RecordOverlayQq({ rec }: { rec: VoiceRecorder }) {
  if (rec.phase === 'idle') return null;
  const stt = rec.zone === 'stt';
  const cancel = rec.zone === 'cancel';
  const leftBars = rec.levels.slice(-12);
  const rightBars = rec.levels.slice(-12).reverse();
  return (
    <div
      data-testid="voice-record-overlay"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center bg-white/95 dark:bg-[#1B1C1F]/95"
    >
      {/* 顶部计时 + 两侧波形 */}
      <div className="mt-9 flex h-8 items-center gap-[3px]">
        {leftBars.map((v, i) => (
          <span key={`l${i}`} className="w-[3px] rounded-full bg-black/20 dark:bg-white/30" style={{ height: `${Math.max(3, v * 30)}px` }} />
        ))}
        <span
          className="mx-2 min-w-[64px] text-center text-[26px] font-light tabular-nums text-black/80 dark:text-white/80"
          data-testid="voice-record-timer"
        >
          {timeLabelOf(rec.seconds)}
        </span>
        {rightBars.map((v, i) => (
          <span key={`r${i}`} className="w-[3px] rounded-full bg-black/20 dark:bg-white/30" style={{ height: `${Math.max(3, v * 30)}px` }} />
        ))}
      </div>
      {/* 左「文」/ 大麦克风 / 右「×」 */}
      <div className="mt-[18%] flex w-full items-center justify-center">
        <span
          className={`grid h-[64px] w-[64px] place-items-center rounded-full text-[20px] transition-colors ${
            stt ? 'bg-[#0099FF] text-white' : 'bg-[#F2F3F5] text-black/80 dark:bg-white/10 dark:text-white/80'
          }`}
        >
          文
        </span>
        <div className="relative mx-16 grid h-[124px] w-[124px] place-items-center">
          {rec.phase === 'recording' && (
            <span className="absolute inset-0 animate-ping rounded-full bg-[#1F8FFF]/30" style={{ animationDuration: '1.6s' }} />
          )}
          <span className="relative grid h-[104px] w-[104px] place-items-center rounded-full bg-gradient-to-b from-[#3AA0FF] to-[#1374F0] shadow-[0_10px_36px_rgba(31,143,255,0.45)]">
            <Mic className="h-11 w-11 text-white" strokeWidth={1.8} aria-hidden="true" />
          </span>
        </div>
        <span
          className={`grid h-[64px] w-[64px] place-items-center rounded-full text-black/80 transition-colors dark:text-white/80 ${
            cancel ? 'bg-[#FA5151] text-white' : 'bg-[#F2F3F5] dark:bg-white/10'
          }`}
        >
          ✕
        </span>
      </div>
      {/* 底部提示 */}
      <p className="mt-auto pb-12 text-[15px] text-black/45 dark:text-white/45">
        {cancel ? '松开 取消' : stt ? '松开 转文字' : '松开 发送'}
      </p>
    </div>
  );
}
