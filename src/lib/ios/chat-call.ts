'use client';

/**
 * 微信 / QQ 语音通话引擎（useChatCall）——两 App 共用一套状态机与语音链路：
 *
 * 一、通话流程（与需求一致）：
 *   拨号（dialing，1.8~3.2s 模拟响铃后 AI 接听）/ 来电（incoming，用户接听或拒绝，25s 无应答对方取消）
 *   → 接通（active）：AI 先开口（greeting）→ 免提「自动对话」循环（VAD，无需点任何按钮）：
 *   AI 播完自动开录音待命 → 用户直接说话 → 说完停顿 1.4s 自动结束录音 → STT 转文字
 *   → 交给聊天模型（/api/phone/turn，复用人设/记忆/时间感知链路）→ 用当前角色音色 TTS 播报
 *   → 播完自动回到聆听，循环直到用户挂断或 AI 主动挂断（告别语后输出〔挂断〕标记）。
 *   控制：长按/点按麦克风可临时静音（恢复后自动续听）；说话中点麦克风立即发送；
 *   一直没人说话自动丢弃重听；识别失败自动重试（连续失败暂停并提示，可切文字聊天）。
 *
 * 五、通话中文字聊天（右上角信息图标开关）：接通后底部按钮上方出现内联输入条（消息区+输入框），
 *   开启期间字幕隐藏；用户发文字 → AI 若配置了第三方语音 API（hasCustomTtsApi）则 TTS 语音回复，
 *   否则文字回复（显示在输入条上方消息区）；共用同一条 /api/phone/turn 链路与人设/记忆上下文，
 *   文字/语音轮次写入同一份通话历史（via 标记）；AI 若输出〔挂断〕标记，呈现完告别后结束通话。
 *
 * 二、音色：speakUserTts 现场解析（角色 voiceId → 全局默认 → 内置默认声线），与语音消息同一套
 *   TTS 配置；AI 回复在 TTS 播报的同时把文字逐字同步到字幕流（aiReveal，onProgress 驱动），
 *   TTS 失败不中断通话——回复文字整句直接显示在字幕流里，通话继续。
 *   用户录音期间并行跑 Web Speech 实时识别（liveHeard 增量更新；不再作为字幕上屏——字幕只显示
 *   AI 说的话，实时文本仅作服务端 STT 失败兑底）；
 *   松手后仍以 transcribeAudioBlob 为准，识别失败时用实时识别结果兑底。
 *   STT 与语音消息转文字共用 transcribeAudioBlob（内置识别 / OpenAI 兼容）；识别失败给出提示，
 *   通话继续、可重试。
 *
 * 三、权限与边界：麦克风首次使用时 getUserMedia 申请；拒绝后界面提示、文字聊天与其他功能不受影响；
 *   通话不涉及真实电话网络；挂断/卸载时释放录音流、停止播报、停表。
 *
 * 四、通话结果（onEnd 恰好一次回调）：direction / endReason / connected / duration（接通秒数），
 *   由宿主（微信/QQ 聊天页）生成通话卡片消息并持久化。
 *
 * 五、通话记忆（与文字聊天共用同一套记忆系统，同池存储 / 同互通开关 / 按联系人隔离）：
 *   1) 每轮回复后 memorizeTurn：轮次计数（无持久消息数组固定计 2 条）→ 达提取间隔自动从
 *      通话转写提取记忆碎片（后台异步，失败静默）；
 *   2) 挂断时 summarizeCall：整通电话转写自动总结一次（memSummarizeCallNow），关键信息沉淀；
 *   3) 每轮 requestTurn 前经 memoryBlockFn 以「用户刚说的话」动态召回相关记忆注入 system
 *      （文字聊过的事通话里能接上；通话里说的事文字聊天也能接上——互通开关决定召回范围）；
 *   4) worldbookBlock：宿主用 collectWbBlocks 组装的世界书设定，随人设注入（优先级高于记忆）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContactRecord } from '@/lib/contacts';
import { memAfterAiTurn, memConvoFromRaw, memSummarizeCallNow } from '@/lib/memory';
import { ownerRealName, ownerProfile } from './contacts-store';
import { useSettings } from './store';
import { directChatStream } from './direct-api';
import { transcribeAudioBlob } from './stt-client';
import { startWebSpeechSession, type WebSpeechSession } from './web-speech';
import {
  startVad,
  AUTO_MAX_MS,
  AUTO_RETRY_DELAY_MS,
  AUTO_SILENCE_MS,
  AUTO_WAIT_MS,
  PROACTIVE_MAX_MS,
  PROACTIVE_MIN_MS,
  STT_FAIL_LIMIT,
  type VadHandle,
} from './vad';
import { requestAnswerDecision } from './call-decision';
import { requestCallFollowup } from './call-followup';
import { speakUserTts, stopSpeaking, hasCustomTtsApi } from './tts-client';
import { reportCallSeconds } from './global-call';
import { getReplyCount } from '../reply-count';

// ---------------- 类型 ----------------

export type ChatCallPhase = 'dialing' | 'incoming' | 'active' | 'ended';
/** 通话内细状态（状态区文案用；listening=免提待命听，recording=VAD 检测到你正在说话） */
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
  /** AI 拒接/未接后的解释文字（接听决策产出；宿主稍后以聊天消息/语音留言呈现） */
  afterText?: string;
}

export interface ChatCallTurnMsg {
  role: 'user' | 'assistant';
  content: string;
}

/** 通话内消息日志条目（字幕/文字条消息区共用；via 区分轮次渠道） */
export interface ChatCallTextMsg {
  role: 'user' | 'assistant';
  content: string;
  at: number;
  /** 渠道：'voice' = 语音轮次（说话/播报，不出文字）；'text' = 文字聊天轮次（输入条消息区可见）。
   *  缺省视为 'voice'（旧数据兼容） */
  via?: 'voice' | 'text';
}

/** AI 字幕逐字揭示状态（与 TTS 播放进度同步；null = 当前无揭示中的字幕） */
export interface ChatCallReveal {
  text: string;
  shown: number;
}

export interface UseChatCallOptions {
  app: 'wx' | 'qq';
  /** 通话对端联系人（人设/音色来源；kind='user' 时对端不说话，仅保留聆听状态） */
  contact: ContactRecord | null;
  direction: 'out' | 'in';
  /** 进入通话时携带的最近聊天上下文（按 user/assistant 归并），AI 按人设与上下文应答 */
  initialHistory: ChatCallTurnMsg[];
  /** 宿主组装的 system 附加块（记忆召回 / 社交动态 / 时间感知 / 位置感知；发送时原样透传给 turn API）
   *  memoryBlock 为发起时快照（兑底）；memoryBlockFn 每轮以「用户刚说的话」重新召回（优先使用）——
   *  通话里 AI 能随话题变化召回相关记忆，主动提起之前聊过的事 */
  memoryBlock?: string;
  /** 每轮动态召回记忆（宿主组装：memRecallBlock(contactId, app, userText)）；优先于 memoryBlock */
  memoryBlockFn?: (userText: string | null) => string | undefined;
  /** 世界书块（宿主用 collectWbBlocks 组装：全局/局部/专属命中条目 + 使用规则），透传 turn API */
  worldbookBlock?: string;
  momentsBlock?: string;
  timeBlock?: string;
  /** 位置感知块（与文字聊天同一套 buildLocationBlock）：通话里 AI 知道“用户在哪” */
  locBlock?: string;
  /** 跨 App 身份感知互通开关（宿主按联系人读 getMemSettings；undefined = 不注入） */
  multiApp?: boolean;
  /** 通话结束（恰好一次） */
  onEnd: (r: ChatCallResult) => void;
  /** 挂断后 AI 续聊文字生成完毕（引擎异步产出，紧随挂断）：宿主负责呈现——
   *  微信/QQ 以聊天消息落盘，电话 App 以语音留言呈现；文字已并入通话转写一同沉淀记忆 */
  onFollowup?: (texts: string[]) => void;
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

/** AI 告别语后的挂断标记（识别后从播报文本中剥除；三端共用，电话 App 也复用） */
export const HANGUP_MARK_RE = /〔挂断〕|【挂断】|\[挂断\]|（挂断）|\(挂断\)/g;

/** 通话场景附加规则（聊天通话：允许 AI 按人设/上下文主动结束通话；三端共用） */
export const CHAT_CALL_EXTRA_RULES = [
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
  /** 用户实时说话识别文本（Web Speech 增量；不再作为字幕渲染——我方说话不上屏，仅作 STT 失败兑底） */
  liveHeard: string;
  /** AI 回复逐字揭示（与 TTS 播放进度同步；null = 无揭示中的字幕） */
  aiReveal: ChatCallReveal | null;
  /** 最后一次识别出的「我说的话」（备用） */
  lastHeard: string;
  /** 通话内消息日志（语音轮次 + 文字聊天轮次；文字面板数据源） */
  chatLog: ChatCallTextMsg[];
  /** 文字聊天回复中（面板「对方正在输入…」） */
  textBusy: boolean;
  accept: () => void;
  reject: () => void;
  hangup: () => void;
  /** 麦克风主按钮：说话中点一下=立即发送（不等停顿）；空闲（如识别失败暂停后）=立即开听 */
  tapMic: () => void;
  /** 静音 = 临时关闭麦克风：暂停免提自动听并丢弃进行中的录音；取消静音自动恢复听 */
  toggleMute: () => void;
  toggleSpeaker: () => void;
  /** 进出文字聊天模式（输入条开合：打断进行中的录音/播报；期间字幕隐藏、回复走输入条） */
  setTextMode: (on: boolean) => void;
  /** 文字聊天发送（内联输入条用；AI 配了语音 API 则语音回复，否则文字回复进消息区） */
  sendText: (text: string) => void;
}

export function useChatCall(opts: UseChatCallOptions): ChatCallApi {
  const { app, contact, direction, initialHistory, memoryBlock, memoryBlockFn, worldbookBlock, momentsBlock, timeBlock, locBlock, multiApp, onEnd, onFollowup } = opts;

  const [phase, setPhase] = useState<ChatCallPhase>(direction === 'in' ? 'incoming' : 'dialing');
  const [status, setStatus] = useState<ChatCallStatus>('connecting');
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [error, setError] = useState('');
  const [liveHeard, setLiveHeard] = useState('');
  const [aiReveal, setAiReveal] = useState<ChatCallReveal | null>(null);
  const [lastHeard, setLastHeard] = useState('');
  const [chatLog, setChatLog] = useState<ChatCallTextMsg[]>([]);
  const [textBusy, setTextBusy] = useState(false);

  // ---------- refs（异步循环里读最新值，避免 stale closure；写 ref 一律入 effect，不在渲染期） ----------
  const endedRef = useRef(false);
  const phaseRef = useRef<ChatCallPhase>(phase);
  const secondsRef = useRef(0);
  const mutedRef = useRef(false);
  const statusRef = useRef<ChatCallStatus>(status);
  const chatLogRef = useRef<ChatCallTextMsg[]>([]);
  const textBusyRef = useRef(false);
  /** 文字聊天模式：输入条打开期间为 true（字幕隐藏；回复呈现形态见 hasCustomTtsApi） */
  const textModeRef = useRef(false);
  /** 打开面板时丢弃进行中的录音 */
  const discardRef = useRef(false);
  /** VAD 会话（免提自动听：检测开口/停顿/超时） */
  const vadRef = useRef<VadHandle | null>(null);
  /** 自动重听延迟定时器 */
  const retryTimerRef = useRef<number | null>(null);
  /** 连续识别失败计数（达上限暂停自动听） */
  const sttFailRef = useRef(0);
  /** 免提自动听调度（定义在 startRecording 之后，经 effect 同步进 ref 供上游回调调用） */
  const autoListenRef = useRef<(delayMs?: number) => void>(() => {});
  /** AI 主动开口：聆听状态挂起「用户一直不说话」计时器；触发后转入 AI 独白轮 */
  const proactiveTimerRef = useRef<number | null>(null);
  /** 主动开口已触发（等 recorder onstop 丢弃静默录音后发起） */
  const proactivePendingRef = useRef(false);
  /** 连续主动开口计数（用户真正说话后归零；连续多次后 AI 会告别并挂断） */
  const proactiveCountRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ringRef = useRef<RingTone | null>(null);
  /** 录音期间并行的 Web Speech 实时识别会话（liveHeard 字幕来源 + 服务端 STT 失败兑底） */
  const wsRef = useRef<WebSpeechSession | null>(null);
  const busyRef = useRef(false); // STT/turn/TTS 循环进行中
  const historyRef = useRef<ChatCallTurnMsg[]>(initialHistory.slice(-16));
  /** 通话前的最近聊天快照（发起时；挂断续聊的「最近聊天记录」依据，不随通话轮次混入） */
  const recentChatRef = useRef<ChatCallTurnMsg[]>(initialHistory.slice(-8));
  const onEndRef = useRef(onEnd);
  /** 挂断后 AI 续聊文字回调（宿主呈现） */
  const onFollowupRef = useRef(onFollowup);
  const optsRef = useRef({ app, contact, memoryBlock, memoryBlockFn, worldbookBlock, momentsBlock, timeBlock, locBlock, multiApp });
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  /** 追加通话内消息日志（语音轮次与文字轮次统一入口） */
  const appendLog = useCallback((m: ChatCallTextMsg) => {
    chatLogRef.current = [...chatLogRef.current, m].slice(-100);
    setChatLog(chatLogRef.current);
  }, []);
  useEffect(() => {
    onEndRef.current = onEnd;
    onFollowupRef.current = onFollowup;
    optsRef.current = { app, contact, memoryBlock, memoryBlockFn, worldbookBlock, momentsBlock, timeBlock, locBlock, multiApp };
  });

  /** 停 VAD + 清自动重听定时器 + 清主动开口计时器（挂断/静音/开文字条时用；不动 MediaRecorder——丢弃或发送由调用方决定） */
  const stopAutoListenTimers = useCallback(() => {
    vadRef.current?.stop();
    vadRef.current = null;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (proactiveTimerRef.current !== null) {
      window.clearTimeout(proactiveTimerRef.current);
      proactiveTimerRef.current = null;
    }
  }, []);

  // ---------- 通话记忆接线（微信/QQ 与电话 App 同款）：轮次计数 + 自动提取 + 挂断总结 ----------

  /** 通话转写 → 记忆对话轮次（chatLog 含语音轮次 + 文字轮次，统一转 me/peer） */
  const chatLogToConvo = useCallback(() => {
    return memConvoFromRaw(
      chatLogRef.current.map((m) => ({ role: m.role, text: m.content })),
      '',
    );
  }, []);

  /** 一轮 AI 回复后的记忆管线（runTurn/sendText 成功分支调用；后台异步，失败静默）：
   *  轮次计数（无持久消息数组，固定计 2 条）→ 达提取间隔自动从通话转写提取记忆碎片；
   *  与文字聊天共用同一记忆库（同池存储 / 同互通开关），电话里说过的事文字聊天能接上 */
  const memorizeTurn = useCallback(() => {
    const cur = optsRef.current;
    const cid = cur.contact?.id;
    if (!cid || cur.contact?.kind === 'user') return;
    void ownerRealName()
      .catch(() => '')
      .then((owner) =>
        memAfterAiTurn(
          cid,
          cur.app,
          useSettings.getState().apiConfig,
          () => chatLogToConvo(),
          () => null, // 无持久消息数组：每轮固定计 2 条（1 用户 + 1 AI）
          { user: owner, peer: cur.contact?.name || '' },
        ),
      );
  }, [chatLogToConvo]);

  /** 挂断时自动总结整通电话：提取关键信息沉淀为记忆（通话结束自动触发一次；失败静默不阻塞收尾） */
  const summarizeCall = useCallback(() => {
    const cur = optsRef.current;
    const cid = cur.contact?.id;
    if (!cid || cur.contact?.kind === 'user') return;
    const turns = chatLogToConvo();
    if (turns.length < 2) return; // 通话太短没有可沉淀的内容
    void ownerRealName()
      .catch(() => '')
      .then((owner) =>
        memSummarizeCallNow(cid, cur.app, useSettings.getState().apiConfig, turns, {
          user: owner,
          peer: cur.contact?.name || '',
        }),
      );
  }, [chatLogToConvo]);

  /** 挂断后 AI 续聊（三端共用逻辑，挂断即触发）+ 记忆总结（一次提取「通话内容+续聊文字」）：
   *  ① 接通后挂断（AI 主动挂断 / 用户挂断）→ 基于人设+通话内容+记忆+最近聊天生成文字，立刻发
   *     （条数上限 = 该会话聊天设置「回复条数」，没话可以少发）；
   *  ② AI 打来的电话被拒/未接（direction in）、拨号被取消（direction out）→ 生成自然的反应消息；
   *  ③ 拨出去被 AI 拒接/未接（direction out 的 reject/no-answer）→ 接听决策 afterText 已覆盖，不重复发。
   *  续聊文字并入通话转写后交 summarizeCall 沉淀（同池互通、按联系人隔离）；请求失败也照常总结。 */
  const followupAndSummarize = useCallback(
    (endReason: ChatCallEndReason) => {
      const peer = optsRef.current.contact;
      const connected = secondsRef.current > 0 || phaseWasConnected(endReason);
      const eligible =
        !!peer &&
        peer.kind !== 'user' &&
        (connected
          ? endReason === 'hangup' || endReason === 'ai-hangup'
          : (direction === 'in' && (endReason === 'reject' || endReason === 'missed-in')) ||
            (direction === 'out' && endReason === 'cancel'));
      if (!eligible) {
        summarizeCall();
        return;
      }
      void (async () => {
        let texts: string[] = [];
        try {
          const transcript = chatLogRef.current.map((m) => ({ role: m.role, content: m.content }));
          const lastUser = [...transcript].reverse().find((m) => m.role === 'user')?.content ?? null;
          const owner = await ownerProfile().catch(() => null);
          texts = await requestCallFollowup({
            contact: {
              name: peer.name,
              kind: peer.kind,
              gender: peer.gender,
              age: peer.age,
              occupation: peer.occupation,
              region: peer.region,
              relation: peer.relation,
              relationToUser: peer.relationToUser ?? null,
              birthday: peer.birthday ?? null,
              persona: peer.persona,
              background: peer.background,
              nickname: peer.nickname ?? null,
              realName: peer.realName ?? null,
            },
            direction,
            endReason,
            connected,
            duration: secondsRef.current,
            transcript: transcript.slice(-24),
            recentChat: recentChatRef.current.map((m) => ({ role: m.role, content: m.content })),
            memoryBlock: optsRef.current.memoryBlockFn?.(lastUser) || optsRef.current.memoryBlock || undefined,
            worldbookBlock: optsRef.current.worldbookBlock || undefined,
            timeBlock: optsRef.current.timeBlock || undefined,
            multiApp: optsRef.current.multiApp,
            // 条数上限 = 该会话聊天设置「回复条数」（wx:<id> / qq:<id>，与文字聊天同一份设置）
            replyCount: getReplyCount(`${optsRef.current.app}:${peer.id}`),
            // 机主身份：AI 知道软件上显示的名字只是昵称，被问是谁报真名
            userRealName: owner?.realName || undefined,
            userNickname: owner?.nickname || undefined,
          });
        } catch {
          texts = []; // 续聊失败静默：不影响记忆总结
        }
        if (texts.length > 0) {
          // 续聊文字并入通话转写（via='text'）：随后的总结把「通话内容+续聊」一起沉淀（互通）
          const now = Date.now();
          chatLogRef.current = [
            ...chatLogRef.current,
            ...texts.map((t, i) => ({ role: 'assistant' as const, content: t, at: now + i, via: 'text' as const })),
          ];
          try {
            onFollowupRef.current?.(texts);
          } catch {
            // 宿主呈现失败不影响记忆沉淀
          }
        }
        summarizeCall();
      })();
    },
    [direction, summarizeCall],
  );

  /** 统一收尾：只执行一次；停录音/停播报/停铃声，回调宿主结果（afterText = AI 拒接/未接后的解释文字） */
  const finish = useCallback((endReason: ChatCallEndReason, afterText?: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    stopAutoListenTimers();
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
    // 挂断后 AI 续聊（立刻发）+ 通话结束自动总结：整通转写（含续聊文字）交给记忆管线提取关键信息（异步，不阻塞宿主落卡片）
    followupAndSummarize(endReason);
    onEndRef.current({
      direction: optsRef.current.app === 'wx' || optsRef.current.app === 'qq' ? direction : 'out',
      endReason,
      connected,
      duration: secondsRef.current,
      ...(afterText ? { afterText } : {}),
    });
  }, [direction, stopAutoListenTimers, followupAndSummarize]);

  // ---------- TTS 播报（角色音色；逐字字幕同步；失败整句直出字幕不中断） ----------
  const speakReply = useCallback(
    (text: string, onDone: () => void, onFail?: () => void) => {
      const contactId = optsRef.current.contact?.id ?? null;
      // 播报前剥挂断标记（识别在调用方）；字幕流先挂上整句，随播放进度逐字揭示
      if (!endedRef.current) setAiReveal({ text, shown: 0 });
      void speakUserTts({
        text,
        contactId,
        cancelled: () => endedRef.current,
        onStart: () => {
          if (!endedRef.current) setStatus('speaking');
        },
        onProgress: (ratio) => {
          if (endedRef.current) return;
          setAiReveal((cur) =>
            cur && cur.text === text ? { ...cur, shown: Math.max(cur.shown, Math.ceil(text.length * ratio)) } : cur,
          );
        },
        onEnd: () => {
          if (!endedRef.current) {
            setAiReveal(null); // 揭示完成：整句由 chatLog 字幕流自然呈现
            onDone();
          }
        },
      }).catch(() => {
        // TTS 失败：整句直接显示在字幕流，通话继续；onFail 让调用方做额外降级（如消息区文字呈现）
        if (!endedRef.current) {
          setAiReveal(null);
          if (onFail) onFail();
          else onDone();
        }
      });
    },
    [],
  );

  /** TTS 失败兑底：把最后一条 assistant 消息降级为文字（via='text'）——
   *  文字输入条开着时消息区可见；语音模式字幕本就渲染整句，降级无副作用 */
  const demoteLastReplyToText = useCallback(() => {
    const log = chatLogRef.current;
    const last = log[log.length - 1];
    if (last && last.role === 'assistant' && last.via === 'voice') {
      const next = [...log.slice(0, -1), { ...last, via: 'text' as const }];
      chatLogRef.current = next;
      setChatLog(next);
    }
  }, []);

  // ---------- 请求一轮 LLM 回复（语音轮与文字轮共用；返回纯文本） ----------
  const requestTurn = useCallback(
    async (
      historyBefore: ChatCallTurnMsg[],
      greeting: boolean,
      /** AI 主动开口：用户一直不说话后的第 N 次主动尝试（0 = 正常轮次） */
      proactiveAttempt = 0,
    ): Promise<{ reply: string; error?: string }> => {
      const c = optsRef.current.contact;
      // 本轮用户刚说的话（greeting/主动开口时不存）：供每轮动态召回相关记忆（主动提起之前聊过的事）
      const lastUserText = greeting || proactiveAttempt > 0 ? null : (historyBefore[historyBefore.length - 1]?.content ?? null);
      const recalledBlock =
        optsRef.current.memoryBlockFn?.(lastUserText) || optsRef.current.memoryBlock || undefined;
      // 机主身份：AI 知道软件上显示的名字只是昵称，被问是谁报真名
      const owner = await ownerProfile().catch(() => null);
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
                  nickname: c.nickname ?? null,
                  realName: c.realName ?? null,
                }
              : undefined,
            // 机主身份：AI 知道软件上显示的名字只是昵称，被问是谁报真名
            userRealName: owner?.realName || undefined,
            userNickname: owner?.nickname || undefined,
            greeting,
            proactiveAttempt: proactiveAttempt > 0 ? proactiveAttempt : undefined,
            history: historyBefore.map((m) => ({ role: m.role, content: m.content })),
            memoryBlock: recalledBlock,
            worldbookBlock: optsRef.current.worldbookBlock || undefined,
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
        if (res.ok && data.directOnly && Array.isArray(data.messages) && data.messages.length > 0) {
          // 内网 API：浏览器直连流式（与电话 App 同策略），取全量文本
          try {
            const full = await directChatStream(useSettings.getState().apiConfig, data.messages, () => undefined);
            return {
              reply: full
                .replace(/[*_`#>~]/g, '')
                .replace(/^["'「『]+|["'」』]+$/g, '')
                .trim(),
            };
          } catch {
            return { reply: '', error: data.error };
          }
        }
        if (res.ok && data.reply) return { reply: data.reply.trim() };
        return { reply: '', error: data.error || '信号不好，请再试一次' };
      } catch {
        return { reply: '', error: '通话网络异常，请再试一次' };
      }
    },
    [],
  );

  // ---------- 一轮对话：文字 → LLM → TTS ----------
  const runTurn = useCallback(
    async (userText: string | null, greeting: boolean, proactiveAttempt = 0) => {
      const ended = () => endedRef.current;
      if (ended()) return;
      busyRef.current = true;
      setError('');
      if (userText) proactiveCountRef.current = 0; // 用户开口：主动连发计数归零
      // 对端是「机主本人」联系人（自己给自己打）：不说话，只保留聆听
      if (optsRef.current.contact?.kind === 'user') {
        setStatus('listening');
        busyRef.current = false;
        return;
      }
      setStatus('thinking');
      const historyBefore = userText
        ? [...historyRef.current, { role: 'user' as const, content: userText }]
        : historyRef.current;
      if (userText) {
        setLiveHeard(''); // 最终文字入列：实时 provisional 字幕让位
        historyRef.current = historyBefore.slice(-16);
        appendLog({ role: 'user', content: userText, at: Date.now(), via: 'voice' });
      }
      const { reply: raw, error: turnError } = await requestTurn(historyBefore, greeting, proactiveAttempt);
      if (ended()) return;
      if (!raw) {
        setError(turnError || '信号不好，请再试一次');
        setStatus('listening');
        busyRef.current = false;
        autoListenRef.current(AUTO_RETRY_DELAY_MS); // 网络恢复后自动续听
        return;
      }
      // AI 主动挂断：告别语后输出〔挂断〕标记 → 播完告别自动结束通话
      const wantHangup = HANGUP_MARK_RE.test(raw);
      const reply = raw.replace(HANGUP_MARK_RE, '').trim();
      HANGUP_MARK_RE.lastIndex = 0;
      if (!reply) {
        finish(wantHangup ? 'ai-hangup' : 'hangup');
        return;
      }
      historyRef.current = [...historyRef.current, { role: 'assistant' as const, content: reply }].slice(-16);
      // 回复形态：语音模式恒走 TTS（speakUserTts 内置引擎兜底，配了 API 用 API）；
      // 文字输入条开着时按「是否配置语音 API」决定——配了语音回复，没配文字回复
      const asText = textModeRef.current && !hasCustomTtsApi();
      appendLog({ role: 'assistant', content: reply, at: Date.now(), via: asText ? 'text' : 'voice' });
      memorizeTurn(); // 通话记忆：轮次计数 + 自动提取（后台异步，失败静默）
      if (asText) {
        // 文字回复：不出声（字幕/消息区已呈现整句）
        if (wantHangup) {
          finish('ai-hangup');
          return;
        }
        setStatus('listening');
        busyRef.current = false;
        autoListenRef.current(); // 文字回复呈现完继续免提听（文字条开着时由开合逻辑接管）
        return;
      }
      speakReply(
        reply,
        () => {
          if (ended()) return;
          if (wantHangup) {
            finish('ai-hangup');
            return;
          }
          setStatus('listening');
          busyRef.current = false;
          autoListenRef.current(); // AI 说完 → 自动开始听（免提循环核心）
        },
        () => {
          // TTS 失败：字幕兜底整句 + 降级为文字（输入条开着时消息区同样可见）
          demoteLastReplyToText();
          if (ended()) return;
          if (wantHangup) {
            finish('ai-hangup');
            return;
          }
          setStatus('listening');
          busyRef.current = false;
          autoListenRef.current(); // 播报失败也继续免提循环（文字已呈现）
        },
      );
    },
    [finish, speakReply, requestTurn, appendLog, demoteLastReplyToText, memorizeTurn],
  );

  // ---------- 通话中文字聊天：用户发文字 → LLM → 配了语音 API 语音回复，否则文字回复 ----------
  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, 2000);
      if (!text || endedRef.current) return;
      if (phaseRef.current !== 'active') return;
      if (busyRef.current || textBusyRef.current) return;
      if (optsRef.current.contact?.kind === 'user') return; // 自己给自己发：不回
      textBusyRef.current = true;
      busyRef.current = true;
      setTextBusy(true);
      setError('');
      appendLog({ role: 'user', content: text, at: Date.now(), via: 'text' });
      const historyBefore = [...historyRef.current, { role: 'user' as const, content: text }];
      historyRef.current = historyBefore.slice(-16);
      const { reply: rawReply, error: turnError } = await requestTurn(historyBefore, false);
      if (endedRef.current) return;
      if (!rawReply) {
        textBusyRef.current = false;
        busyRef.current = false;
        setTextBusy(false);
        setError(turnError || '发送失败，请再试一次');
        return;
      }
      const wantHangup = HANGUP_MARK_RE.test(rawReply);
      const reply = rawReply.replace(HANGUP_MARK_RE, '').trim();
      HANGUP_MARK_RE.lastIndex = 0;
      if (!reply) {
        textBusyRef.current = false;
        busyRef.current = false;
        setTextBusy(false);
        if (wantHangup) finish('ai-hangup');
        return;
      }
      historyRef.current = [...historyRef.current, { role: 'assistant' as const, content: reply }].slice(-16);
      if (hasCustomTtsApi()) {
        // AI 配置了语音 API → 语音回复（不出文字）；播报期间保持「回应中」防止插发新消息
        appendLog({ role: 'assistant', content: reply, at: Date.now(), via: 'voice' });
        memorizeTurn(); // 通话记忆：轮次计数 + 自动提取（后台异步，失败静默）
        speakReply(
          reply,
          () => {
            textBusyRef.current = false;
            busyRef.current = false;
            setTextBusy(false);
            if (endedRef.current) return;
            if (wantHangup) {
              finish('ai-hangup');
              return;
            }
            setStatus('listening');
          },
          () => {
            // TTS 失败：降级为文字回复（消息区气泡可见）
            demoteLastReplyToText();
            textBusyRef.current = false;
            busyRef.current = false;
            setTextBusy(false);
            if (endedRef.current) return;
            if (wantHangup) {
              finish('ai-hangup');
              return;
            }
            setStatus('listening');
          },
        );
      } else {
        // 没配语音 API → 文字回复（输入条消息区气泡呈现）
        appendLog({ role: 'assistant', content: reply, at: Date.now(), via: 'text' });
        memorizeTurn(); // 通话记忆：轮次计数 + 自动提取（后台异步，失败静默）
        textBusyRef.current = false;
        busyRef.current = false;
        setTextBusy(false);
        if (wantHangup) finish('ai-hangup');
      }
    },
    [requestTurn, appendLog, finish, speakReply, demoteLastReplyToText, memorizeTurn],
  );

  /** 进出文字聊天模式：开启=停免提自动听（清重听定时器）、丢弃进行中的录音、打断播报；
   *  期间字幕隐藏、回复走输入条；关闭=恢复免提自动听 */
  const setTextMode = useCallback(
    (on: boolean) => {
      textModeRef.current = on;
      if (on) {
        stopAutoListenTimers();
        if (endedRef.current) return;
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          discardRef.current = true;
          try {
            recorderRef.current.stop();
          } catch {
            // 已停止
          }
        }
        if (statusRef.current === 'speaking') {
          stopSpeaking();
          setAiReveal(null); // 播报被打断：揭示中的字幕让位（整句仍在 chatLog 里）
          setStatus('listening');
        }
        return;
      }
      if (!endedRef.current) autoListenRef.current(250); // 关输入条：恢复免提听
    },
    [stopAutoListenTimers],
  );

  // ---------- 免提自动听（VAD 循环）：AI 说完自动开录待命，说完停顿自动发送，全程无需点按钮 ----------
  /** AI 主动开口：聆听状态挂「用户一直不说话」计时器（3~5s 随机），触发后丢弃静默录音转 AI 独白轮 */
  const armProactiveTimer = useCallback(() => {
    if (proactiveTimerRef.current !== null) {
      window.clearTimeout(proactiveTimerRef.current);
      proactiveTimerRef.current = null;
    }
    proactiveTimerRef.current = window.setTimeout(
      () => {
        proactiveTimerRef.current = null;
        if (endedRef.current || phaseRef.current !== 'active') return;
        if (busyRef.current || mutedRef.current || textModeRef.current) return;
        if (statusRef.current === 'recording') return; // VAD 已检测到你正在说
        if (optsRef.current.contact?.kind === 'user') return;
        // 用户一直没说：丢弃当前静默录音（onstop 的 proactivePending 分支接管），转入主动开口
        proactivePendingRef.current = true;
        discardRef.current = true;
        try {
          if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
        } catch {
          // 已停止
        }
      },
      PROACTIVE_MIN_MS + Math.floor(Math.random() * Math.max(1, PROACTIVE_MAX_MS - PROACTIVE_MIN_MS)),
    );
  }, []);

  const startRecording = useCallback(async () => {
    if (endedRef.current || busyRef.current) return;
    if (mutedRef.current || textModeRef.current) return;
    if (optsRef.current.contact?.kind === 'user') return;
    if (recorderRef.current && recorderRef.current.state === 'recording') return;
    setError('');
    setAiReveal(null);
    setLiveHeard('');
    try {
      // AEC/NS/AGC：回声消除（免提外放时 AI 尾音不进麦克）、降噪、自动增益
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
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
        // 收实时识别会话：丢弃路径直接 abort；正常路径等转写失败时再 stop 取兑底文本
        const ws = wsRef.current;
        wsRef.current = null;
        if (endedRef.current) {
          ws?.abort();
          setLiveHeard('');
          chunksRef.current = [];
          return;
        }
        if (discardRef.current) {
          // 静音/开文字条/超时无人说话：丢弃本轮；未被禁止时自动重新听（免提等待循环）
          discardRef.current = false;
          ws?.abort();
          setLiveHeard('');
          chunksRef.current = [];
          // AI 主动开口：用户一直没说，丢弃静默录音后转 AI 独白轮（第 N 次尝试，计数递增——
          // 连续多次无回应时 system 会提示 AI 可自然告别并挂断）
          if (proactivePendingRef.current) {
            proactivePendingRef.current = false;
            if (!mutedRef.current && !textModeRef.current && phaseRef.current === 'active') {
              busyRef.current = true;
              proactiveCountRef.current += 1;
              void runTurn(null, false, proactiveCountRef.current);
              return;
            }
            if (!mutedRef.current && !textModeRef.current) autoListenRef.current(); // 已挂断竞态：静默丢弃
            return;
          }
          if (!mutedRef.current && !textModeRef.current) autoListenRef.current();
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size < 1200) {
          ws?.abort();
          setLiveHeard('');
          setError('没听到声音，请再说一次');
          setStatus('listening');
          autoListenRef.current(AUTO_RETRY_DELAY_MS);
          return;
        }
        setStatus('recognizing');
        busyRef.current = true;
        void (async () => {
          // 服务端 STT 为主；失败/超时时用录音期间 Web Speech 的实时文本兑底
          let text = '';
          let sttError: unknown = null;
          try {
            text = await transcribeAudioBlob(blob);
          } catch (e) {
            sttError = e;
          }
          if (endedRef.current) return;
          if (!text && ws) {
            try {
              const fallback = (await ws.stop()).trim();
              // 过滤 ASR 对静音/噪声的典型无意义输出（纯符号），避免当成有效转写
              if (fallback && !/^[#\s*_\-.,!?~。？！，、…—·]+$/.test(fallback)) text = fallback;
            } catch {
              // 兑底也失败：走统一错误提示
            }
          } else {
            ws?.abort();
          }
          if (endedRef.current) return;
          if (!text) {
            setLiveHeard('');
            setError(
              sttError instanceof Error && sttError.message
                ? sttError.message
                : '没听清，请再说一次',
            );
            setStatus('listening');
            busyRef.current = false;
            // 自动对话：识别失败自动重听；连续失败达上限暂停（可点麦克风重试 / 切文字聊天）
            sttFailRef.current += 1;
            if (sttFailRef.current < STT_FAIL_LIMIT) autoListenRef.current(AUTO_RETRY_DELAY_MS);
            else setError('连续几次没听清，点麦克风可重试，也可用输入条文字聊');
            return;
          }
          sttFailRef.current = 0;
          setLiveHeard('');
          setLastHeard(text);
          return runTurn(text, false);
        })().catch((e: unknown) => {
          if (endedRef.current) return;
          setLiveHeard('');
          setError(e instanceof Error && e.message ? e.message : '识别失败，请再试一次');
          setStatus('listening');
          busyRef.current = false;
          autoListenRef.current(AUTO_RETRY_DELAY_MS);
        });
      };
      recorder.start();
      setRecording(true);
      setStatus('listening'); // 免提待命等你开口（VAD 检测到声音才进入 recording）
      armProactiveTimer(); // 用户若一直不说话（3~5s），AI 主动开口
      // 并行跑 Web Speech 实时识别（与 MediaRecorder 共享麦克风）：仅作服务端 STT 失败兑底，
      // 不支持/启动失败返回 null，录音与 VAD 不受影响
      wsRef.current = startWebSpeechSession({
        onPartial: (t) => {
          if (!endedRef.current) setLiveHeard(t);
        },
      });
      // VAD（免提核心）：检测你何时开口、何时说完
      vadRef.current = startVad({
        stream,
        silenceMs: AUTO_SILENCE_MS,
        waitMs: AUTO_WAIT_MS,
        maxMs: AUTO_MAX_MS,
        onSpeechStart: () => {
          if (proactiveTimerRef.current !== null) {
            window.clearTimeout(proactiveTimerRef.current); // 你开口了：取消主动开口
            proactiveTimerRef.current = null;
          }
          if (!endedRef.current) setStatus('recording');
        },
        onSpeechEnd: (reason) => {
          vadRef.current = null;
          if (endedRef.current) return;
          // silent-timeout：一直没人说话，丢弃本轮重新听（不能一直录）；pause/maxlen：正常发送
          if (reason === 'silent-timeout') discardRef.current = true;
          try {
            if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
          } catch {
            // 已停止
          }
        },
      });
    } catch {
      setError('麦克风不可用，请检查权限后重试');
      setStatus('listening');
    }
  }, [runTurn, armProactiveTimer]);

  /** 免提自动听调度：空闲且未被禁止（挂断/静音/文字条/自己）时开始新一轮聆听；delayMs 缓冲后执行 */
  const scheduleAutoListen = useCallback(
    (delayMs = 0) => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      const go = () => {
        retryTimerRef.current = null;
        if (endedRef.current || phaseRef.current !== 'active') return;
        if (mutedRef.current || textModeRef.current) return;
        if (busyRef.current) return;
        if (optsRef.current.contact?.kind === 'user') return;
        if (recorderRef.current && recorderRef.current.state === 'recording') return;
        void startRecording();
      };
      if (delayMs > 0) retryTimerRef.current = window.setTimeout(go, delayMs);
      else go();
    },
    [startRecording],
  );
  useEffect(() => {
    autoListenRef.current = scheduleAutoListen;
  });

  /** 麦克风主按钮：说话中点一下=立即发送（不等停顿）；空闲（如识别失败暂停后）=立即开听；
   *  待命等你说时无需操作；AI 播报/思考中不打断（免提顺序循环，播完自动听） */
  const tapMic = useCallback(() => {
    if (endedRef.current || phaseRef.current !== 'active') return;
    if (recording) {
      if (statusRef.current !== 'recording') return; // 待命等待说话：无需手动发送
      vadRef.current?.stop();
      vadRef.current = null;
      // 立即发送：停录音触发 onstop → STT → turn
      try {
        recorderRef.current?.stop();
      } catch {
        // 忽略
      }
      return;
    }
    if (busyRef.current) return;
    sttFailRef.current = 0; // 手动重试清失败计数
    void startRecording();
  }, [recording, startRecording]);

  /** 静音 = 临时关闭麦克风：停免提自动听（清定时器）、丢弃进行中的录音；取消静音自动恢复听 */
  const toggleMute = useCallback(() => {
    if (endedRef.current) return;
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) {
      stopAutoListenTimers();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        discardRef.current = true;
        try {
          recorderRef.current.stop();
        } catch {
          // 已停止
        }
      }
      if (statusRef.current === 'recording') setStatus('listening');
    } else {
      autoListenRef.current(200);
    }
  }, [stopAutoListenTimers]);

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

  // ---------- 生命周期：铃声 / AI 接听决策（接听·拒绝·不接）/ 来电超时 / 计时 / 卸载清理 ----------
  useEffect(() => {
    ringRef.current = new RingTone();
    const ring = ringRef.current;
    let answerTimer: number | undefined;
    let missTimer: number | undefined;
    let peerTimer: number | undefined;

    if (direction === 'out') {
      ring.start('out');
      const connect = () => {
        ring.stop();
        playConnectBlip();
        setPhase('active');
        setStatus('thinking');
        void runTurn(null, true);
      };
      // AI 接听决策：响铃开始就发（人设/关系/当前时间状态/最近聊天 → 接听/拒绝/不接），
      // 失败或超时兜底 answer（宁可多接，不让用户白等）；机主打给自己（kind='user'）不决策
      const peer = optsRef.current.contact;
      const decision =
        peer && peer.kind !== 'user'
          ? ownerProfile()
              .then((owner) =>
                requestAnswerDecision({
                  number: peer.phone || '10086',
                  contact: {
                    name: peer.name,
                    kind: peer.kind,
                    gender: peer.gender,
                    age: peer.age,
                    occupation: peer.occupation,
                    region: peer.region,
                    relation: peer.relation,
                    relationToUser: peer.relationToUser ?? null,
                    birthday: peer.birthday ?? null,
                    persona: peer.persona,
                    background: peer.background,
                    nickname: peer.nickname ?? null,
                    realName: peer.realName ?? null,
                  },
                  recentChat: historyRef.current.map((m) => ({ role: m.role, content: m.content })),
                  timeBlock: optsRef.current.timeBlock || undefined,
                  // 机主身份：AI 知道软件上显示的名字只是昵称，被问是谁报真名
                  userRealName: owner?.realName || undefined,
                  userNickname: owner?.nickname || undefined,
                  config: useSettings.getState().apiConfig,
                }),
              )
              .catch(() => ({ decision: 'answer' }) as const)
          : null;
      // 先响铃 1.8~3.2s（决策多半已返回；未返回则等它 settle，最长 ANSWER_DECISION_TIMEOUT_MS 兜底）
      answerTimer = window.setTimeout(() => {
        void (async () => {
          if (endedRef.current) return;
          const d = decision ? await decision : ({ decision: 'answer' } as const);
          if (endedRef.current) return;
          if (d.decision === 'reject') {
            // 对方拒绝：再响 0.8~1.6s 后挂断（已响过一阵铃，「几声铃被挂断」更真实）
            peerTimer = window.setTimeout(() => {
              if (!endedRef.current) finish('reject', d.afterText);
            }, 800 + Math.floor(Math.random() * 800));
          } else if (d.decision === 'miss') {
            // 对方不接：继续响 9~15s 然后转「无人接听」
            peerTimer = window.setTimeout(() => {
              if (!endedRef.current) finish('no-answer', d.afterText);
            }, 9000 + Math.floor(Math.random() * 6000));
          } else {
            connect();
          }
        })();
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
      window.clearTimeout(peerTimer);
      ring.stop();
      endedRef.current = true;
      stopAutoListenTimers();
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
    liveHeard,
    aiReveal,
    lastHeard,
    chatLog,
    textBusy,
    accept,
    reject,
    hangup,
    tapMic,
    toggleMute,
    toggleSpeaker,
    setTextMode,
    sendText,
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
