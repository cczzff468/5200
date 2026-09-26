'use client';

/**
 * 微信 / QQ 语音通话引擎（useChatCall）——两 App 共用一套状态机与语音链路：
 *
 * 一、通话流程（与需求一致）：
 *   拨号（dialing，1.8~3.2s 模拟响铃后 AI 接听）/ 来电（incoming，用户接听或拒绝，25s 无应答对方取消）
 *   → 接通（active）：AI 先开口（greeting）→ 用户点麦克风说话（录音）→ 松开后 STT 转文字
 *   → 文字交给聊天模型（/api/phone/turn，复用人设/记忆/时间感知链路）→ 用当前角色音色 TTS 播报
 *   → 回到聆听，循环直到用户挂断或 AI 主动挂断（告别语后输出〔挂断〕标记）。
 *
 * 二、音色：speakUserTts 现场解析（角色 voiceId → 全局默认 → 内置默认声线），与语音消息同一套
 *   TTS 配置；TTS 失败不中断通话——回复文字以字幕（caption）显示在状态区，通话继续。
 *   STT 与语音消息转文字共用 transcribeAudioBlob（内置识别 / OpenAI 兼容）；识别失败给出提示，
 *   通话继续、可重试。
 *
 * 三、权限与边界：麦克风首次使用时 getUserMedia 申请；拒绝后界面提示、文字聊天与其他功能不受影响；
 *   通话不涉及真实电话网络；挂断/卸载时释放录音流、停止播报、停表。
 *
 * 四、通话结果（onEnd 恰好一次回调）：direction / endReason / connected / duration（接通秒数），
 *   由宿主（微信/QQ 聊天页）生成通话卡片消息并持久化。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContactRecord } from '@/lib/contacts';
import { useSettings } from './store';
import { directChatStream } from './direct-api';
import { transcribeAudioBlob } from './stt-client';
import { speakUserTts, stopSpeaking } from './tts-client';
import { reportCallSeconds } from './global-call';

// ---------------- 类型 ----------------

export type ChatCallPhase = 'dialing' | 'incoming' | 'active' | 'ended';
/** 通话内细状态（状态区文案用） */
export type ChatCallStatus = 'connecting' | 'listening' | 'recording' | 'recognizing' | 'thinking' | 'speaking';
/** 通话结束原因（宿主据此生成通话卡片状态） */
export type ChatCallEndReason =
  | 'cancel' // 拨号中用户取消（对方接听前）
  | 'no-answer' // 拨号后对方一直未接（预留）
  | 'reject' // 来电被用户拒绝
  | 'missed-in' // 来电未接听（响铃超时对方取消）
  | 'hangup' // 接通后用户挂断
  | 'ai-hangup'; // 接通后 AI 主动结束

export interface ChatCallResult {
  direction: 'out' | 'in';
  endReason: ChatCallEndReason;
  /** 是否接通过（卡片「已接通/通话时长」依据） */
  connected: boolean;
  /** 接通后的通话秒数（未接通为 0） */
  duration: number;
}

export interface ChatCallTurnMsg {
  role: 'user' | 'assistant';
  content: string;
}

export interface UseChatCallOptions {
  app: 'wx' | 'qq';
  /** 通话对端联系人（人设/音色来源；kind='user' 时对端不说话，仅保留聆听状态） */
  contact: ContactRecord | null;
  direction: 'out' | 'in';
  /** 进入通话时携带的最近聊天上下文（按 user/assistant 归并），AI 按人设与上下文应答 */
  initialHistory: ChatCallTurnMsg[];
  /** 宿主组装的 system 附加块（记忆召回 / 社交动态 / 时间感知 / 位置感知；发送时原样透传给 turn API） */
  memoryBlock?: string;
  momentsBlock?: string;
  timeBlock?: string;
  /** 位置感知块（与文字聊天同一套 buildLocationBlock）：通话里 AI 知道“用户在哪” */
  locBlock?: string;
  /** 跨 App 身份感知互通开关（宿主按联系人读 getMemSettings；undefined = 不注入） */
  multiApp?: boolean;
  /** 通话结束（恰好一次） */
  onEnd: (r: ChatCallResult) => void;
}

// ---------------- 音效（回铃 / 接通 / 挂断；WebAudio 轻提示音） ----------------

let audioCtxSingleton: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtxSingleton) audioCtxSingleton = new Ctx();
    if (audioCtxSingleton.state === 'suspended') void audioCtxSingleton.resume();
    return audioCtxSingleton;
  } catch {
    return null;
  }
}

function playTone(freq: number, durationMs: number, volume = 0.05, delayMs = 0): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + delayMs / 1000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
    gain.gain.setValueAtTime(volume, t0 + durationMs / 1000 - 0.03);
    gain.gain.linearRampToValueAtTime(0, t0 + durationMs / 1000);
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + durationMs / 1000 + 0.05);
  } catch {
    // 音效失败不影响通话
  }
}

/** 回铃音：450Hz 响 1s 停 4s，循环（来电响铃用更急促的节奏） */
class RingTone {
  private timer: number | null = null;
  start(mode: 'out' | 'in'): void {
    this.stop();
    const beep = () => {
      if (mode === 'in') {
        playTone(440, 400, 0.045);
        playTone(440, 400, 0.045, 600);
      } else {
        playTone(450, 1000, 0.035);
      }
    };
    beep();
    this.timer = window.setInterval(beep, mode === 'in' ? 4000 : 5000);
  }
  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function playConnectBlip(): void {
  playTone(600, 120, 0.05);
  playTone(900, 160, 0.05, 130);
}

function playHangupBlip(): void {
  playTone(600, 180, 0.05);
  playTone(380, 240, 0.05, 190);
}

/** 接通过判定：接通后结束的两个原因一定 connected；其余看计时器是否走过 */
function phaseWasConnected(endReason: ChatCallEndReason): boolean {
  return endReason === 'hangup' || endReason === 'ai-hangup';
}

// ---------------- 引擎 ----------------

/** AI 告别语后的挂断标记（识别后从播报文本中剥除） */
const HANGUP_MARK_RE = /〔挂断〕|【挂断】|\[挂断\]|（挂断）|\(挂断\)/g;

/** 通话场景附加规则（聊天通话：允许 AI 按人设/上下文主动结束通话） */
const CHAT_CALL_EXTRA_RULES = [
  '你在和很熟的朋友语音通话，保持人设，语气自然亲昵；',
  '如果你想结束通话（话题聊完、要去忙、困了等自然原因），先用一句话自然告别（如「那我先去洗澡啦，回头聊」），然后在告别语的最后单独输出〔挂断〕标记；除此之外的任何情况都不要输出〔挂断〕；',
  '正常聊天时绝对不要输出〔挂断〕标记；每轮只说出口语内容本身。',
];

export interface ChatCallApi {
  phase: ChatCallPhase;
  status: ChatCallStatus;
  /** 接通后的通话秒数 */
  seconds: number;
  recording: boolean;
  muted: boolean;
  speakerOn: boolean;
  /** 麦克风错误（权限拒绝/不可用等；只提示，不中断通话） */
  error: string;
  /** TTS 失败时显示的文字字幕（通话不中断） */
  caption: string;
  /** 最后一次识别出的「我说的话」（字幕用） */
  lastHeard: string;
  accept: () => void;
  reject: () => void;
  hangup: () => void;
  /** 麦克风主按钮：未录音→开始录音；录音中→发送识别；AI 播报中→打断并开始录音 */
  tapMic: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
}

export function useChatCall(opts: UseChatCallOptions): ChatCallApi {
  const { app, contact, direction, initialHistory, memoryBlock, momentsBlock, timeBlock, locBlock, multiApp, onEnd } = opts;

  const [phase, setPhase] = useState<ChatCallPhase>(direction === 'in' ? 'incoming' : 'dialing');
  const [status, setStatus] = useState<ChatCallStatus>('connecting');
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [error, setError] = useState('');
  const [caption, setCaption] = useState('');
  const [lastHeard, setLastHeard] = useState('');

  // ---------- refs（异步循环里读最新值，避免 stale closure；写 ref 一律入 effect，不在渲染期） ----------
  const endedRef = useRef(false);
  const phaseRef = useRef<ChatCallPhase>(phase);
  const secondsRef = useRef(0);
  const mutedRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ringRef = useRef<RingTone | null>(null);
  const busyRef = useRef(false); // STT/turn/TTS 循环进行中
  const historyRef = useRef<ChatCallTurnMsg[]>(initialHistory.slice(-16));
  const onEndRef = useRef(onEnd);
  const optsRef = useRef({ app, contact, memoryBlock, momentsBlock, timeBlock, locBlock, multiApp });
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    onEndRef.current = onEnd;
    optsRef.current = { app, contact, memoryBlock, momentsBlock, timeBlock, locBlock, multiApp };
  });

  /** 统一收尾：只执行一次；停录音/停播报/停铃声，回调宿主结果 */
  const finish = useCallback((endReason: ChatCallEndReason) => {
    if (endedRef.current) return;
    endedRef.current = true;
    ringRef.current?.stop();
    stopSpeaking();
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    } catch {
      // 已停止
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    playHangupBlip();
    setPhase('ended');
    setRecording(false);
    setStatus('listening');
    reportCallSeconds(0);
    const connected = secondsRef.current > 0 || phaseWasConnected(endReason);
    onEndRef.current({
      direction: optsRef.current.app === 'wx' || optsRef.current.app === 'qq' ? direction : 'out',
      endReason,
      connected,
      duration: secondsRef.current,
    });
  }, [direction]);

  // ---------- TTS 播报（角色音色；失败转字幕不中断） ----------
  const speakReply = useCallback(
    (text: string, onDone: () => void) => {
      const contactId = optsRef.current.contact?.id ?? null;
      // 播报前剥挂断标记（识别在调用方）
      void speakUserTts({
        text,
        contactId,
        cancelled: () => endedRef.current,
        onStart: () => {
          if (!endedRef.current) setStatus('speaking');
        },
        onEnd: () => {
          if (!endedRef.current) onDone();
        },
      }).catch(() => {
        // TTS 失败：字幕显示文字，通话继续
        if (!endedRef.current) {
          setCaption(text);
          onDone();
        }
      });
    },
    [],
  );

  // ---------- 一轮对话：文字 → LLM → TTS ----------
  const runTurn = useCallback(
    async (userText: string | null, greeting: boolean) => {
      const ended = () => endedRef.current;
      if (ended()) return;
      busyRef.current = true;
      setError('');
      setCaption('');
      // 对端是「机主本人」联系人（自己给自己打）：不说话，只保留聆听
      if (optsRef.current.contact?.kind === 'user') {
        setStatus('listening');
        busyRef.current = false;
        return;
      }
      setStatus('thinking');
      const c = optsRef.current.contact;
      const historyBefore = userText
        ? [...historyRef.current, { role: 'user' as const, content: userText }]
        : historyRef.current;
      if (userText) historyRef.current = historyBefore.slice(-16);
      try {
        const res = await fetch('/api/phone/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contact: c
              ? {
                  name: c.name,
                  kind: c.kind,
                  gender: c.gender,
                  age: c.age,
                  occupation: c.occupation,
                  region: c.region,
                  relation: c.relation,
                  relationToUser: c.relationToUser ?? null,
                  birthday: c.birthday ?? null,
                  persona: c.persona,
                  background: c.background,
                }
              : undefined,
            number: c?.phone || '10086',
            greeting,
            history: historyBefore.map((m) => ({ role: m.role, content: m.content })),
            memoryBlock: optsRef.current.memoryBlock || undefined,
            momentsBlock: optsRef.current.momentsBlock || undefined,
            timeBlock: optsRef.current.timeBlock || undefined,
            locBlock: optsRef.current.locBlock || undefined,
            multiApp: optsRef.current.multiApp,
            extraRules: CHAT_CALL_EXTRA_RULES,
            config: useSettings.getState().apiConfig,
          }),
        });
        const data = (await res.json()) as {
          reply?: string;
          error?: string;
          directOnly?: boolean;
          messages?: { role: 'system' | 'user' | 'assistant'; content: string }[];
        };
        if (ended()) return;
        let reply = '';
        if (res.ok && data.directOnly && Array.isArray(data.messages) && data.messages.length > 0) {
          // 内网 API：浏览器直连流式（与电话 App 同策略），取全量文本
          try {
            const full = await directChatStream(useSettings.getState().apiConfig, data.messages, () => undefined);
            reply = full
              .replace(/[*_`#>~]/g, '')
              .replace(/^["'「『]+|["'」』]+$/g, '')
              .trim();
          } catch {
            reply = '';
          }
        } else if (res.ok && data.reply) {
          reply = data.reply.trim();
        }
        if (ended()) return;
        if (!reply) {
          setError(data.error || '信号不好，请再试一次');
          setStatus('listening');
          busyRef.current = false;
          return;
        }
        // AI 主动挂断：告别语后输出〔挂断〕标记 → 播完告别自动结束通话
        const wantHangup = HANGUP_MARK_RE.test(reply);
        reply = reply.replace(HANGUP_MARK_RE, '').trim();
        HANGUP_MARK_RE.lastIndex = 0;
        if (!reply) {
          finish(wantHangup ? 'ai-hangup' : 'hangup');
          return;
        }
        historyRef.current = [...historyRef.current, { role: 'assistant' as const, content: reply }].slice(-16);
        speakReply(reply, () => {
          if (ended()) return;
          if (wantHangup) {
            finish('ai-hangup');
            return;
          }
          setStatus('listening');
          busyRef.current = false;
        });
      } catch {
        if (!ended()) {
          setError('通话网络异常，请再试一次');
          setStatus('listening');
          busyRef.current = false;
        }
      }
    },
    [finish, speakReply],
  );

  // ---------- 录音（点按开始/发送；与语音消息共用 STT 配置） ----------
  const startRecording = useCallback(async () => {
    if (endedRef.current || busyRef.current) return;
    if (mutedRef.current) {
      setError('麦克风已静音，先取消静音再说话');
      return;
    }
    setError('');
    setCaption('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (endedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        setRecording(false);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (endedRef.current) return;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size < 1200) {
          setError('没听到声音，请再试一次');
          setStatus('listening');
          return;
        }
        setStatus('recognizing');
        busyRef.current = true;
        void transcribeAudioBlob(blob)
          .then((text) => {
            if (endedRef.current) return;
            if (!text) {
              setError('没听清，请再说一遍');
              setStatus('listening');
              busyRef.current = false;
              return;
            }
            setLastHeard(text);
            return runTurn(text, false);
          })
          .catch((e: unknown) => {
            if (endedRef.current) return;
            setError(e instanceof Error && e.message ? e.message : '识别失败，请再试一次');
            setStatus('listening');
            busyRef.current = false;
          });
      };
      recorder.start();
      setRecording(true);
      setStatus('recording');
    } catch {
      setError('麦克风不可用，请检查权限后重试');
      setStatus('listening');
    }
  }, [runTurn]);

  /** 麦克风主按钮：状态机总入口 */
  const tapMic = useCallback(() => {
    if (endedRef.current || phaseRef.current !== 'active') return;
    if (recording) {
      // 发送：停录音触发 onstop → STT → turn
      try {
        recorderRef.current?.stop();
      } catch {
        // 忽略
      }
      return;
    }
    if (busyRef.current) return;
    // AI 正在说 → 打断播报并开始录音
    if (status === 'speaking') stopSpeaking();
    void startRecording();
  }, [recording, status, startRecording]);

  const toggleMute = useCallback(() => {
    if (endedRef.current) return;
    if (recording) return; // 录音中不切静音（先发送）
    setMuted((m) => {
      mutedRef.current = !m;
      return !m;
    });
  }, [recording]);

  const toggleSpeaker = useCallback(() => {
    if (endedRef.current) return;
    setSpeakerOn((s) => !s);
  }, []);

  // ---------- 接听 / 拒绝 / 挂断 ----------
  const accept = useCallback(() => {
    if (endedRef.current || phaseRef.current !== 'incoming') return;
    ringRef.current?.stop();
    playConnectBlip();
    setPhase('active');
    setStatus('thinking');
    secondsRef.current = 0;
    setSeconds(0);
    // 对方打来的：接通后对方先开口
    void runTurn(null, true);
  }, [runTurn]);

  const reject = useCallback(() => {
    if (endedRef.current || phaseRef.current !== 'incoming') return;
    finish('reject');
  }, [finish]);

  const hangup = useCallback(() => {
    if (endedRef.current) return;
    // 拨号中挂断 = 取消（对方接听前）；接通后挂断 = 正常结束
    finish(phaseRef.current === 'dialing' ? 'cancel' : 'hangup');
  }, [finish]);

  // ---------- 生命周期：铃声 / 自动接听 / 来电超时 / 计时 / 卸载清理 ----------
  useEffect(() => {
    ringRef.current = new RingTone();
    const ring = ringRef.current;
    let answerTimer: number | undefined;
    let missTimer: number | undefined;

    if (direction === 'out') {
      ring.start('out');
      // 模拟对方响铃后接听（1.8~3.2s），接通即打招呼
      answerTimer = window.setTimeout(() => {
        if (endedRef.current) return;
        ring.stop();
        playConnectBlip();
        setPhase('active');
        setStatus('thinking');
        void runTurn(null, true);
      }, 1800 + Math.floor(Math.random() * 1400));
    } else {
      ring.start('in');
      // 来电 25s 未处理：对方取消（生成「未接听」卡片）
      missTimer = window.setTimeout(() => {
        if (endedRef.current) finish('missed-in');
      }, 25000);
    }

    return () => {
      window.clearTimeout(answerTimer);
      window.clearTimeout(missTimer);
      ring.stop();
      endedRef.current = true;
      stopSpeaking();
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      } catch {
        // 忽略
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // 接通后计时（秒数同时上报全局总线，悬浮小窗实时显示）
  useEffect(() => {
    if (phase !== 'active') return;
    reportCallSeconds(secondsRef.current);
    const timer = window.setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
      reportCallSeconds(secondsRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  return {
    phase,
    status,
    seconds,
    recording,
    muted,
    speakerOn,
    error,
    caption,
    lastHeard,
    accept,
    reject,
    hangup,
    tapMic,
    toggleMute,
    toggleSpeaker,
  };
}

// ---------------- 工具（宿主生成通话卡片文案用） ----------------

/** 秒 → MM:SS（≥1h 为 H:MM:SS） */
export function formatCallDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(2, '0');
  const ssStr = String(ss).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ssStr}` : `${mm}:${ssStr}`;
}
