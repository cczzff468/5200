'use client';

/**
 * 微信 / QQ 语音通话界面（同一引擎 useChatCall，两种皮肤）：
 *
 * - 微信皮肤（对照用户截图）：深色背景；接通后顶部居中显示通话时长；方形圆角头像；
 *   底部三个圆形按钮（麦克风 / 挂断 / 扬声器，麦克风任何时候都在，拨号中也可看可按）；
 *   来电页「邀请你语音通话」+ 红拒绝/绿接听圆形按钮 +
 *   「1小时内隐藏他的来电」胶囊；点按麦克风说话、再点发送，长按麦克风静音。
 * - QQ 皮肤（对照用户截图）：深色背景；圆形大头像；呼叫中「正在呼叫…」；接通后时长显示在
 *   底部按钮上方；底部三个圆角方形按钮（麦克风 / 扬声器 / 挂断，居中拉开间距）；
 *   来电页「邀请你语音通话」+「消息回复」+ 红挂断/绿接听圆角方按钮；长按麦克风静音。
 *
 * - 状态区：「正在说话」「正在听」「正在思考…」「识别中…」等。
 * - 通话弹幕字幕（头像/名字下方，实时）：我说的话录音中经 Web Speech 增量识别逐字上屏（白字），
 *   松手识别完成后整句正式入列；AI 说的话在 TTS 播报的同时按播放进度逐字揭示（灰色字）；
 *   字幕逐条出现、自动滚到最新，文字聊天轮次同屏可见（与文字面板共用 chatLog）。
 * - 通话中文字聊天：接通后右上角信息图标进入文字面板 —— 面板与通话页同构：左上角小窗按钮、
 *   头像+名字+通话时长、下方三个小按钮（麦克风/挂断/扬声器，QQ 顺序 麦克风/扬声器/挂断）、
 *   消息列表在其下方（双方带头像、微信绿白/QQ 蓝白美化气泡），右上角 X 关闭返回语音通话；
 *   用户发文字、AI 回文字（不 TTS），共用同一套人设/记忆/时间/位置链路，语音轮次同步可见。
 * - 通话卡片（CallCardBubble）：结束后插入聊天记录——普通文字气泡同款样式（跟普通气泡一样），
 *   电话图标 + 文案（已取消（点击重拨）/ 对方未接听 / 对方已拒绝 / 已拒绝 / 未接听 / 通话时长）；
 *   QQ 蓝底白字图标在文字前，微信我方绿底文字在前、对方白底图标在前；微信图标朝下（通话记录样式）。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BellOff,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  PictureInPicture2,
  SendHorizontal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { DefaultAvatar } from './default-avatar';
import { useSettings } from '@/lib/ios/store';
import {
  formatCallDuration,
  useChatCall,
  type ChatCallApi,
  type ChatCallResult,
  type ChatCallTextMsg,
  type ChatCallTurnMsg,
} from '@/lib/ios/chat-call';
import type { ContactRecord } from '@/lib/contacts';

// ---------------- 通话界面 ----------------

export interface VoiceCallScreenProps {
  variant: 'wx' | 'qq';
  name: string;
  avatar: string | null;
  contact: ContactRecord | null;
  direction: 'out' | 'in';
  /** 进入通话时携带的最近聊天上下文（宿主按会话消息归并） */
  initialHistory: ChatCallTurnMsg[];
  /** 宿主组装的 system 附加块（记忆/动态/时间感知） */
  memoryBlock?: string;
  momentsBlock?: string;
  timeBlock?: string;
  /** 位置感知块（与文字聊天同一套 buildLocationBlock）：通话里 AI 知道“用户在哪” */
  locBlock?: string;
  multiApp?: boolean;
  /** 通话结束（恰好一次）：宿主生成通话卡片并关闭浮层 */
  onEnd: (r: ChatCallResult) => void;
  /** 左上角小窗图标点击：收起为全局悬浮小窗（全局层传入；无则仅展示不可点） */
  onMinimize?: () => void;
  /** QQ 来电页「消息回复」：挂断来电并回到聊天 */
  onMessageReply?: () => void;
}

export function VoiceCallScreen(props: VoiceCallScreenProps) {
  const { variant } = props;
  return (
    <div
      className="absolute inset-0 z-[70] flex flex-col overflow-hidden text-white"
      style={{
        background:
          variant === 'wx'
            ? 'radial-gradient(120% 90% at 50% 0%, #3a3a41 0%, #232327 42%, #0b0b0d 100%)'
            : 'radial-gradient(120% 90% at 50% 10%, #33333a 0%, #202024 45%, #0a0a0c 100%)',
      }}
      role="dialog"
      aria-label={`与${props.name}的语音通话`}
      data-testid={`vc-screen-${props.variant}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.07),transparent_55%)]" />
      {variant === 'wx' ? <WxCallScreen {...props} /> : <QqCallScreen {...props} />}
    </div>
  );
}

/** 头像（微信方形圆角 / QQ 圆形） */
function CallAvatar({ variant, avatar, size }: { variant: 'wx' | 'qq'; avatar: string | null; size: number }) {
  if (avatar) {
    return (
      <img
        src={avatar}
        alt=""
        className={`shrink-0 object-cover shadow-2xl ring-1 ring-white/15 ${variant === 'wx' ? 'rounded-[16px]' : 'rounded-full'}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <DefaultAvatar
      size={size}
      shape={variant === 'wx' ? 'square' : 'circle'}
      className={`${variant === 'wx' ? 'rounded-[16px]' : 'rounded-full'} shadow-2xl ring-1 ring-white/15`}
    />
  );
}

/** 左上角小窗图标（两 App 通话页都有；点击收起为全局悬浮小窗，通话不断） */
function PipIcon({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label="收起为悬浮小窗"
      data-testid="call-pip-btn"
      onClick={onClick}
      disabled={!onClick}
      className="absolute left-5 top-16 z-10 flex h-10 w-10 items-center justify-center rounded-[12px] bg-white/10 text-white/80 backdrop-blur-sm transition-colors active:opacity-60"
    >
      <PictureInPicture2 className="h-5 w-5" strokeWidth={1.8} />
    </button>
  );
}

/** 状态区文案（正在说话 / 正在听 / 正在思考… / 识别中…） */
function statusLine(
  phase: 'dialing' | 'incoming' | 'active' | 'ended',
  status: 'connecting' | 'listening' | 'recording' | 'recognizing' | 'thinking' | 'speaking',
  variant: 'wx' | 'qq',
): string {
  if (phase === 'incoming') return '邀请你语音通话';
  if (phase === 'dialing') return variant === 'wx' ? '等待对方接受邀请' : '正在呼叫…';
  switch (status) {
    case 'speaking':
      return '正在说话';
    case 'thinking':
      return '正在思考…';
    case 'recognizing':
      return '识别中…';
    case 'recording':
      return '正在听（再点一下发送）';
    default:
      return '正在听';
  }
}

// ---------------- 通话弹幕字幕（头像/名字下方实时流） ----------------

/** 单条字幕（用户反馈：字幕前面不要显示头像）——AI 左侧灰色字（AI 说话同步显示、灰色），我方右侧白字；
 *  整条弹跳入场（跳动特效，animate-call-caption） */
function CaptionLine({ mine, children }: { mine: boolean; children: ReactNode }) {
  return (
    <p
      className={`animate-call-caption max-w-[85%] whitespace-pre-wrap break-words text-[13px] leading-[1.55] ${
        mine ? 'ml-auto text-right text-white/90' : 'mr-auto text-left text-white/45'
      }`}
    >
      {children}
    </p>
  );
}

/** 逐字揭示中的光标 */
function Caret() {
  return <span className="animate-pulse" aria-hidden="true">▍</span>;
}

/**
 * 通话弹幕字幕流（头像/名字下方，跟实时弹幕一样逐条出现）：
 * - 我说的话：录音中 Web Speech 增量识别逐字上屏（liveHeard，白字+光标），识别完成后整句正式入列；
 * - AI 说的话：TTS 播报的同时按播放进度逐字揭示（aiReveal，灰色字+光标），播完整句沉淀；
 * - 新字幕自动滚到最新；内容来自 chatLog（语音轮次 + 文字聊天轮次统一呈现）。
 */
function CaptionStream({ variant, call }: { variant: 'wx' | 'qq'; call: ChatCallApi }) {
  const { chatLog, aiReveal, liveHeard } = call;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 新字幕/逐字更新时自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatLog.length, aiReveal, liveHeard]);

  // AI 揭示中：最后一条 assistant 消息由「揭示中的部分文本」呈现（避免整句提前闪现）
  const lastIdx = chatLog.length - 1;
  const revealing =
    aiReveal !== null && lastIdx >= 0 && chatLog[lastIdx].role === 'assistant' && chatLog[lastIdx].content === aiReveal.text;

  return (
    <div
      ref={scrollRef}
      className="no-scrollbar flex w-full min-h-0 flex-1 flex-col overflow-y-auto"
      aria-live="polite"
      data-testid={`${variant}-call-captions`}
    >
      <div className="mt-auto space-y-2 py-2">
        {chatLog.map((m, i) => {
          const partial = revealing && i === lastIdx;
          const text = partial && aiReveal ? aiReveal.text.slice(0, aiReveal.shown) : m.content;
          return (
            <CaptionLine key={`${m.at}-${i}`} mine={m.role === 'user'}>
              {text}
              {partial && <Caret />}
            </CaptionLine>
          );
        })}
        {liveHeard && (
          <CaptionLine mine>
            <span data-testid={`${variant}-call-liveheard`}>
              {liveHeard}
              <Caret />
            </span>
          </CaptionLine>
        )}
      </div>
    </div>
  );
}

// ---------------- 通话中文字聊天面板（右上角信息图标进入；AI 文字回复不出声） ----------------

/** 小头像（微信方圆角 / QQ 圆形，32px） */
function TextChatAvatar({ variant, avatar, mine }: { variant: 'wx' | 'qq'; avatar: string | null; mine: boolean }) {
  const rounded = variant === 'wx' ? 'rounded-[6px]' : 'rounded-full';
  if (avatar) {
    return <img src={avatar} alt="" className={`h-8 w-8 shrink-0 object-cover ${rounded}`} />;
  }
  return <DefaultAvatar size={32} shape={variant === 'wx' ? 'square' : 'circle'} className={`${rounded} ${mine ? 'opacity-90' : ''}`} />;
}

/**
 * 面板气泡（美化版）：双方带头像（AI=联系人头像在左，我=机主头像在右），
 * 微信绿/白同款圆角+小三角尾巴，QQ 蓝/白圆角，白底带轻阴影在深色面板上更立体。
 */
function TextChatBubble({
  variant,
  msg,
  peerAvatar,
  myAvatar,
}: {
  variant: 'wx' | 'qq';
  msg: ChatCallTextMsg;
  peerAvatar: string | null;
  myAvatar: string | null;
}) {
  const mine = msg.role === 'user';
  const isWx = variant === 'wx';
  return (
    <div className={`flex items-start gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
      <TextChatAvatar variant={variant} avatar={mine ? myAvatar : peerAvatar} mine={mine} />
      <div
        className={`relative max-w-[68%] whitespace-pre-wrap break-words text-left text-[15px] leading-[1.55] ${
          isWx
            ? `rounded-[8px] px-3.5 py-[9px] shadow-[0_1px_3px_rgba(0,0,0,0.35)] ${
                mine ? 'bg-[#95EC69] text-black' : 'bg-white text-black'
              }`
            : `rounded-[14px] px-3.5 py-[9px] shadow-[0_1px_4px_rgba(0,0,0,0.35)] ${
                mine ? 'text-white' : 'bg-white text-[#1F2329]'
              }`
        }`}
        style={variant === 'qq' && mine ? { backgroundColor: '#0099FF' } : undefined}
      >
        {/* 微信同款小三角尾巴（QQ 无尾巴） */}
        {isWx && (
          <span
            aria-hidden="true"
            className={`absolute top-[13px] h-[7px] w-[7px] rotate-45 ${
              mine ? '-right-[3px] bg-[#95EC69]' : '-left-[3px] bg-white'
            }`}
          />
        )}
        {msg.content}
      </div>
    </div>
  );
}

function TextChatPanel({
  variant,
  name,
  avatar,
  call,
  onClose,
  onMinimize,
}: {
  variant: 'wx' | 'qq';
  name: string;
  avatar: string | null;
  call: ChatCallApi;
  onClose: () => void;
  onMinimize?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const { chatLog, textBusy, error, muted, speakerOn } = call;
  const myAvatar = useSettings((s) => s.profile.avatar);
  const isWx = variant === 'wx';

  // 新消息/输入中自动滚到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatLog.length, textBusy]);

  const send = () => {
    const t = draft.trim();
    if (!t || textBusy) return;
    call.sendText(t);
    setDraft('');
  };

  // 三个小按钮（与通话页同款功能，尺寸缩小以容纳消息区）：微信 麦克风/挂断/扬声器，QQ 麦克风/扬声器/挂断
  const miniBtn = isWx
    ? 'flex h-[50px] w-[50px] items-center justify-center rounded-full transition-colors active:opacity-70'
    : 'flex h-[50px] w-[50px] items-center justify-center rounded-[17px] transition-colors active:opacity-70';

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col bg-[#141416] text-white"
      role="dialog"
      aria-label="通话中文字聊天"
      data-testid={`${variant}-call-textchat`}
    >
      {/* 左上角小窗按钮（与通话页一致：收起为全局悬浮小窗，通话不断） */}
      <button
        type="button"
        onClick={onMinimize}
        disabled={!onMinimize}
        aria-label="收起为悬浮小窗"
        data-testid={`${variant}-call-textchat-pip`}
        className="absolute left-5 top-16 z-10 flex h-10 w-10 items-center justify-center rounded-[12px] bg-white/10 text-white/80 backdrop-blur-sm transition-colors active:opacity-60"
      >
        <PictureInPicture2 className="h-5 w-5" strokeWidth={1.8} />
      </button>
      {/* 右上角 X 关闭（用户需求：关闭就是点击右上角关闭，回到语音通话） */}
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭文字聊天"
        data-testid={`${variant}-call-textchat-close`}
        className="absolute right-5 top-16 z-10 flex h-10 w-10 items-center justify-center rounded-[12px] bg-white/10 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
      >
        <X className="h-5 w-5" strokeWidth={2} />
      </button>

      {/* 头像 + 名字 + 通话时长（对照通话页；消息显示在其下方） */}
      <div className="flex flex-col items-center pt-[54px]">
        <CallAvatar variant={variant} avatar={avatar} size={64} />
        <h3 className="mt-2 max-w-[220px] truncate text-[17px] font-medium leading-tight">{name}</h3>
        <span className="mt-0.5 text-[11px] tabular-nums text-white/50" data-testid={`${variant}-call-textchat-duration`}>
          通话中 {formatCallDuration(call.seconds)}
        </span>
      </div>

      {/* 三个按钮（与通话页同款：麦克风=静音切换 / 挂断 / 扬声器） */}
      <div className={`mt-3.5 flex items-center justify-center ${isWx ? 'gap-10' : 'gap-9'}`}>
        <button
          type="button"
          onClick={call.toggleMute}
          aria-label={muted ? '取消静音' : '静音'}
          aria-pressed={muted}
          data-testid={`${variant}-call-textchat-mic`}
          className={`${miniBtn} ${muted ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
        >
          {muted ? <MicOff className="h-5 w-5" strokeWidth={1.9} /> : <Mic className="h-5 w-5" strokeWidth={1.9} />}
        </button>
        {isWx ? (
          <>
            <button
              type="button"
              onClick={call.hangup}
              aria-label="挂断"
              data-testid={`${variant}-call-textchat-hangup`}
              className={`${miniBtn} bg-[#FA5151] text-white`}
            >
              <PhoneOff className="h-[22px] w-[22px]" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={call.toggleSpeaker}
              aria-label={speakerOn ? '关闭扬声器' : '开启扬声器'}
              aria-pressed={speakerOn}
              data-testid={`${variant}-call-textchat-speaker`}
              className={`${miniBtn} ${speakerOn ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
            >
              {speakerOn ? <Volume2 className="h-5 w-5" strokeWidth={1.9} /> : <VolumeX className="h-5 w-5" strokeWidth={1.9} />}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={call.toggleSpeaker}
              aria-label={speakerOn ? '关闭扬声器' : '开启扬声器'}
              aria-pressed={speakerOn}
              data-testid={`${variant}-call-textchat-speaker`}
              className={`${miniBtn} ${speakerOn ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
            >
              {speakerOn ? <Volume2 className="h-5 w-5" strokeWidth={1.9} /> : <VolumeX className="h-5 w-5" strokeWidth={1.9} />}
            </button>
            <button
              type="button"
              onClick={call.hangup}
              aria-label="挂断"
              data-testid={`${variant}-call-textchat-hangup`}
              className={`${miniBtn} bg-[#F5455C] text-white`}
            >
              <PhoneOff className="h-[22px] w-[22px]" strokeWidth={2} />
            </button>
          </>
        )}
      </div>

      <div className="mx-5 mt-3.5 border-t border-white/10" aria-hidden="true" />

      {/* 消息列表（头像/名字/时长/按钮下方；语音轮次同步可见；空白时给引导文案） */}
      <div ref={listRef} className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4" aria-live="polite">
        {chatLog.length === 0 && !textBusy && (
          <p className="pt-8 text-center text-[13px] leading-relaxed text-white/40">
            通话中也可以发消息
            <br />
            对方会以文字回复
          </p>
        )}
        {chatLog.map((m, i) => (
          <TextChatBubble key={`${m.at}-${i}`} variant={variant} msg={m} peerAvatar={avatar} myAvatar={myAvatar} />
        ))}
        {textBusy && (
          <div className="flex items-start justify-start gap-2" aria-label="对方正在输入">
            <TextChatAvatar variant={variant} avatar={avatar} mine={false} />
            <div
              className={`relative flex items-center gap-1.5 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.35)] ${
                isWx ? 'rounded-[8px] px-3.5 py-[11px]' : 'rounded-[14px] px-4 py-3'
              }`}
            >
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-black/35"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 错误提示 + 输入栏 */}
      <div className="pb-[max(10px,env(safe-area-inset-bottom))]">
        {error && <p className="px-4 pb-1 text-center text-[12px] text-red-300">{error}</p>}
        <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="发消息…"
            aria-label="输入消息"
            data-testid={`${variant}-call-textchat-input`}
            className="h-10 min-w-0 flex-1 rounded-full bg-white/[0.09] px-4 text-[15px] text-white ring-1 ring-white/10 outline-none transition-shadow placeholder:text-white/35 focus:ring-white/30"
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim() || textBusy}
            aria-label="发送"
            data-testid={`${variant}-call-textchat-send`}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors active:opacity-70 ${
              draft.trim() && !textBusy
                ? isWx
                  ? 'bg-[#07C160] text-white'
                  : 'bg-[#0099FF] text-white'
                : 'bg-white/10 text-white/40'
            }`}
          >
            <SendHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 微信皮肤 ----------------

function WxCallScreen({ name, avatar, contact, direction, initialHistory, memoryBlock, momentsBlock, timeBlock, locBlock, multiApp, onEnd, onMinimize }: VoiceCallScreenProps) {
  const call = useChatCall({ app: 'wx', contact, direction, initialHistory, memoryBlock, momentsBlock, timeBlock, locBlock, multiApp, onEnd });
  const { phase, status, seconds, recording, muted, speakerOn, error } = call;
  const [textChatOpen, setTextChatOpen] = useState(false);

  const openTextChat = () => {
    if (phase !== 'active') return;
    call.setTextMode(true); // 丢弃进行中的录音/播报；期间 AI 回复只出文字
    setTextChatOpen(true);
  };
  const closeTextChat = () => {
    call.setTextMode(false); // 回到语音模式（AI 回复恢复 TTS 播报）
    setTextChatOpen(false);
  };

  // 长按麦克风 = 静音切换；点按 = 说话/发送
  const holdTimer = useRef<number | null>(null);
  const longFired = useRef(false);
  const holdStart = () => {
    longFired.current = false;
    if (phase !== 'active') return;
    holdTimer.current = window.setTimeout(() => {
      longFired.current = true;
      call.toggleMute();
    }, 550);
  };
  const holdEnd = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  const micClick = () => {
    if (longFired.current) return;
    if (muted) {
      call.toggleMute();
      return;
    }
    call.tapMic();
  };

  const wxRound = 'flex h-[74px] w-[74px] items-center justify-center rounded-full transition-colors active:opacity-70';

  return (
    <div className="relative z-10 flex h-full flex-col">
      <PipIcon onClick={onMinimize} />
      {/* 接通后顶部居中计时（对照截图 12:00:00） */}
      {phase === 'active' && (
        <div className="pt-[70px] text-center text-[20px] font-light tabular-nums text-white/95" data-testid="wx-call-duration">
          {formatCallDuration(seconds)}
        </div>
      )}
      {phase === 'dialing' && (
        <div className="pt-[70px] text-center text-[20px] font-light text-white/90">语音通话</div>
      )}
      {/* 右上角信息图标：接通后可进入文字聊天（原「更多」+ 号换成信息图标） */}
      {phase === 'active' && (
        <button
          type="button"
          aria-label="发消息"
          data-testid="wx-call-textchat-btn"
          onClick={openTextChat}
          className="absolute right-5 top-[64px] z-10 flex h-10 w-10 items-center justify-center rounded-[12px] bg-white/10 text-white/80 backdrop-blur-sm transition-colors active:opacity-60"
        >
          <MessageSquare className="h-5 w-5" strokeWidth={1.8} />
        </button>
      )}

      {/* 中部：头像 + 名字 + 弹幕字幕流 + 状态（字幕显示在头像和名字下面，实时逐条出现） */}
      <div className="flex min-h-0 flex-1 flex-col items-center px-8 pb-9">
        {phase === 'incoming' && <div className="h-[56px] shrink-0" aria-hidden="true" />}
        <div className="relative mt-1">
          {phase === 'dialing' && <span className="absolute inset-0 animate-ping rounded-[16px] bg-white/10" aria-hidden="true" />}
          <CallAvatar variant="wx" avatar={avatar} size={104} />
        </div>
        <h2 className="mt-5 max-w-[280px] truncate text-[22px] font-medium leading-tight">{name}</h2>
        {phase === 'active' ? (
          <CaptionStream variant="wx" call={call} />
        ) : (
          <div className="min-h-4 flex-1" aria-hidden="true" />
        )}
        <p className="mt-1.5 text-[14px] text-white/60" aria-live="polite" data-testid="wx-call-status">
          {statusLine(phase, status, 'wx')}
        </p>
        {error && <p className="mt-2 max-w-[280px] text-center text-[12px] text-red-300">{error}</p>}
      </div>

      {/* 底部按钮区 */}
      {phase === 'incoming' ? (
        <div className="flex flex-col items-center px-8 pb-[max(30px,env(safe-area-inset-bottom))]">
          <div className="flex w-full items-start justify-between px-6">
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={call.reject} aria-label="拒绝" data-testid="wx-call-reject" className={`${wxRound} bg-[#FA5151] text-white`}>
                <PhoneOff className="h-8 w-8" strokeWidth={2} />
              </button>
              <span className="text-[13px] text-white/85">拒绝</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={call.accept} aria-label="接听" data-testid="wx-call-accept" className={`${wxRound} bg-[#07C160] text-white`}>
                <Phone className="h-8 w-8" strokeWidth={2} />
              </button>
              <span className="text-[13px] text-white/85">接听</span>
            </div>
          </div>
          <div className="mt-8 flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-[13px] text-white/70 backdrop-blur-sm">
            <BellOff className="h-4 w-4" strokeWidth={1.8} />
            1小时内隐藏他的来电
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center px-8 pb-[max(34px,env(safe-area-inset-bottom))]">
          <div className="flex w-full items-end justify-center gap-12">
            {/* 麦克风：任何时候都在（拨号中也在，对照微信原生）；点按说话 / 长按静音 */}
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                aria-label={muted ? '取消静音' : recording ? '发送' : '说话（长按静音）'}
                aria-pressed={muted}
                data-testid="wx-call-mic"
                onPointerDown={holdStart}
                onPointerUp={holdEnd}
                onPointerLeave={holdEnd}
                onContextMenu={(e) => e.preventDefault()}
                onClick={micClick}
                className={`${wxRound} select-none ${
                  recording ? 'bg-white text-black ring-2 ring-[#07C160]' : muted ? 'bg-white/10 text-white/85' : 'bg-white/10 text-white'
                }`}
              >
                {muted ? <MicOff className="h-7 w-7" strokeWidth={1.9} /> : <Mic className={`h-7 w-7 ${recording ? 'animate-pulse' : ''}`} strokeWidth={1.9} />}
              </button>
              <span className="max-w-[86px] text-center text-[12px] leading-tight text-white/75">
                {muted ? '麦克风已关' : recording ? '正在听…' : '麦克风已开'}
              </span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={call.hangup} aria-label="挂断" data-testid="wx-call-hangup" className={`${wxRound} bg-[#FA5151] text-white`}>
                <PhoneOff className="h-8 w-8" strokeWidth={2} />
              </button>
              <span className="text-[13px] text-white/85">挂断</span>
            </div>
            {/* 扬声器（拨号中也可切换） */}
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={call.toggleSpeaker}
                aria-label={speakerOn ? '关闭扬声器' : '开启扬声器'}
                aria-pressed={speakerOn}
                data-testid="wx-call-speaker"
                className={`${wxRound} ${speakerOn ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
              >
                {speakerOn ? <Volume2 className="h-7 w-7" strokeWidth={1.9} /> : <VolumeX className="h-7 w-7" strokeWidth={1.9} />}
              </button>
              <span className="text-[12px] text-white/75">{speakerOn ? '扬声器已开' : '扬声器已关'}</span>
            </div>
          </div>
          {phase === 'active' && !muted && (
            <p className="mt-4 text-[11px] text-white/35">点一下麦克风说话 · 长按可静音</p>
          )}
        </div>
      )}

      {/* 通话中文字聊天面板（覆盖层；通话不中断，时长继续走；小窗按钮先退文字模式再收起） */}
      {textChatOpen && phase === 'active' && (
        <TextChatPanel
          variant="wx"
          name={name}
          avatar={avatar}
          call={call}
          onClose={closeTextChat}
          onMinimize={() => {
            closeTextChat();
            onMinimize?.();
          }}
        />
      )}
    </div>
  );
}

// ---------------- QQ 皮肤 ----------------

function QqCallScreen({ name, avatar, contact, direction, initialHistory, memoryBlock, momentsBlock, timeBlock, locBlock, multiApp, onEnd, onMinimize, onMessageReply }: VoiceCallScreenProps) {
  const call = useChatCall({ app: 'qq', contact, direction, initialHistory, memoryBlock, momentsBlock, timeBlock, locBlock, multiApp, onEnd });
  const { phase, status, seconds, recording, muted, speakerOn, error } = call;
  const [textChatOpen, setTextChatOpen] = useState(false);

  const openTextChat = () => {
    if (phase !== 'active') return;
    call.setTextMode(true);
    setTextChatOpen(true);
  };
  const closeTextChat = () => {
    call.setTextMode(false);
    setTextChatOpen(false);
  };

  // 长按麦克风 = 静音切换（原三条横杠菜单里的静音入口移到长按手势）；点按 = 说话/发送
  const holdTimer = useRef<number | null>(null);
  const longFired = useRef(false);
  const holdStart = () => {
    longFired.current = false;
    if (phase !== 'active') return;
    holdTimer.current = window.setTimeout(() => {
      longFired.current = true;
      call.toggleMute();
    }, 550);
  };
  const holdEnd = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  const micClick = () => {
    if (longFired.current) return;
    if (muted) {
      call.toggleMute();
      return;
    }
    call.tapMic();
  };

  const qqSquare =
    'flex h-[72px] w-[72px] items-center justify-center rounded-[26px] transition-colors active:opacity-70';
  const darkBtn = `${qqSquare} bg-white/10 text-white`;
  const whiteBtn = `${qqSquare} bg-white text-black`;

  return (
    <div className="relative z-10 flex h-full flex-col">
      <PipIcon onClick={onMinimize} />

      {/* 右上角信息图标：接通后可进入文字聊天（与微信皮肤一致） */}
      {phase === 'active' && (
        <button
          type="button"
          aria-label="发消息"
          data-testid="qq-call-textchat-btn"
          onClick={openTextChat}
          className="absolute right-5 top-16 z-10 flex h-10 w-10 items-center justify-center rounded-[12px] bg-white/10 text-white/80 backdrop-blur-sm transition-colors active:opacity-60"
        >
          <MessageSquare className="h-5 w-5" strokeWidth={1.8} />
        </button>
      )}

      {/* 中部：圆形大头像 + 名字 + 弹幕字幕流 + 状态 */}
      <div className="flex min-h-0 flex-1 flex-col items-center px-8 pb-14 pt-[62px]">
        <div className="relative">
          {phase === 'dialing' && <span className="absolute inset-0 animate-ping rounded-full bg-white/10" aria-hidden="true" />}
          <CallAvatar variant="qq" avatar={avatar} size={direction === 'in' ? 132 : 168} />
        </div>
        <h2 className="mt-6 max-w-[280px] truncate text-[24px] font-normal leading-tight">{name}</h2>
        {phase === 'active' ? (
          <CaptionStream variant="qq" call={call} />
        ) : (
          <div className="min-h-4 flex-1" aria-hidden="true" />
        )}
        <p className="mt-2 text-[15px] text-white/65" aria-live="polite" data-testid="qq-call-status">
          {statusLine(phase, status, 'qq')}
        </p>
        {error && <p className="mt-2 max-w-[280px] text-center text-[12px] text-red-300">{error}</p>}
      </div>

      {/* 底部按钮区 */}
      {phase === 'incoming' ? (
        <div className="flex flex-col px-10 pb-[max(40px,env(safe-area-inset-bottom))]">
          {/* 消息回复（对照截图：左侧气泡图标 + 文案；挂断来电回到聊天，生成「已拒绝」卡片） */}
          {onMessageReply && (
            <button
              type="button"
              onClick={() => {
                call.reject();
                onMessageReply();
              }}
              className="mb-9 flex w-[86px] flex-col items-center gap-2 self-start text-white/90 active:opacity-60"
              data-testid="qq-call-msg-reply"
            >
              <MessageSquare className="h-8 w-8" strokeWidth={1.6} />
              <span className="text-[13px]">消息回复</span>
            </button>
          )}
          <div className="flex items-center justify-between">
            <button type="button" onClick={call.reject} aria-label="拒绝" data-testid="qq-call-reject" className={`${qqSquare} bg-[#F5455C] text-white`}>
              <PhoneOff className="h-8 w-8" strokeWidth={2} />
            </button>
            <button type="button" onClick={call.accept} aria-label="接听" data-testid="qq-call-accept" className={`${qqSquare} bg-[#2FBF71] text-white`}>
              <Phone className="h-8 w-8" strokeWidth={2} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center px-6 pb-[max(28px,env(safe-area-inset-bottom))]">
          {/* 接通后：时长显示在按钮上方（对照截图 00:03） */}
          {phase === 'active' && (
            <div className="mb-7 text-center text-[17px] tabular-nums text-white/85" data-testid="qq-call-duration">
              {formatCallDuration(seconds)}
            </div>
          )}
          {/* 三个按钮居中拉开间距（原三条横杠菜单按钮已删除，长按麦克风可静音） */}
          <div className="flex w-full items-center justify-center gap-12">
            {/* 麦克风：点按说话 / 发送，长按静音 */}
            <button
              type="button"
              onClick={micClick}
              onPointerDown={holdStart}
              onPointerUp={holdEnd}
              onPointerLeave={holdEnd}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={recording ? '发送' : muted ? '取消静音' : '说话（长按静音）'}
              aria-pressed={recording}
              data-testid="qq-call-mic"
              className={`${recording ? `${whiteBtn} ring-2 ring-[#2FBF71]` : muted ? `${darkBtn} opacity-60` : whiteBtn} select-none`}
            >
              <Mic className={`h-7 w-7 ${recording ? 'animate-pulse' : ''}`} strokeWidth={1.9} />
            </button>
            {/* 扬声器 */}
            <button
              type="button"
              onClick={call.toggleSpeaker}
              aria-label={speakerOn ? '关闭扬声器' : '开启扬声器'}
              aria-pressed={speakerOn}
              data-testid="qq-call-speaker"
              className={speakerOn ? whiteBtn : darkBtn}
            >
              {speakerOn ? <Volume2 className="h-7 w-7" strokeWidth={1.9} /> : <VolumeX className="h-7 w-7" strokeWidth={1.9} />}
            </button>
            {/* 挂断 */}
            <button type="button" onClick={call.hangup} aria-label="挂断" data-testid="qq-call-hangup" className={`${qqSquare} bg-[#F5455C] text-white`}>
              <PhoneOff className="h-8 w-8" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      {/* 通话中文字聊天面板（覆盖层；通话不中断，时长继续走；小窗按钮先退文字模式再收起） */}
      {textChatOpen && phase === 'active' && (
        <TextChatPanel
          variant="qq"
          name={name}
          avatar={avatar}
          call={call}
          onClose={closeTextChat}
          onMinimize={() => {
            closeTextChat();
            onMinimize?.();
          }}
        />
      )}
    </div>
  );
}

// ---------------- 通话卡片（结束后插入聊天记录） ----------------

export type CallCardState = 'cancelled' | 'no-answer' | 'rejected' | 'missed-in' | 'ended';

/** 通话结果 → 卡片状态（宿主落盘用） */
export function callResultToCardState(r: ChatCallResult): CallCardState {
  if (r.connected && r.endReason !== 'cancel' && r.endReason !== 'reject') return 'ended';
  switch (r.endReason) {
    case 'cancel':
      return 'cancelled';
    case 'no-answer':
      return 'no-answer';
    case 'reject':
      return 'rejected';
    case 'missed-in':
      return 'missed-in';
    default:
      return 'ended';
  }
}

/**
 * 通话卡片文案（对照用户截图）：
 * - QQ：我方取消 = 「已取消，点击重拨」（整卡可点重拨）；对方拒接 = 「对方已拒绝」；
 * - 微信：我方取消 = 「已取消」；对方拒接 = 「对方已拒绝」、我方拒接来电 = 「已拒绝」。
 */
export function callCardText(state: CallCardState, duration: number, direction: 'out' | 'in', variant: 'wx' | 'qq'): string {
  switch (state) {
    case 'cancelled':
      return variant === 'qq' ? '已取消，点击重拨' : '已取消';
    case 'no-answer':
      return '对方未接听';
    case 'rejected':
      return direction === 'out' ? '对方已拒绝' : '已拒绝';
    case 'missed-in':
      return '未接听';
    default:
      return `通话时长 ${formatCallDuration(duration)}`;
  }
}

/** AI 可读的通话摘要（进聊天上下文；中立措辞，role=me/peer 两侧都通顺） */
export function callCardAiText(state: CallCardState, duration: number): string {
  switch (state) {
    case 'cancelled':
      return '[语音通话：拨通前取消了]';
    case 'no-answer':
      return '[语音通话：对方未接听]';
    case 'rejected':
      return '[语音通话：来电被拒绝]';
    case 'missed-in':
      return '[语音通话：未接听]';
    default:
      return `[语音通话：通话时长 ${formatCallDuration(duration)}]`;
  }
}

/**
 * 通话记录卡片（微信/QQ 聊天气泡内）：跟普通文字气泡完全同款——同底色、同圆角、同小三角尾巴，
 * 内容为电话图标 + 文案。图标位置对照两 App 原生：QQ 图标恒在文字前（我方蓝底白图标，
 * 对方白底深图标）；微信我方文字在前（绿底）、对方图标在前（白底）。
 * 整卡可点：点击任意通话卡片即回拨（onRedial 由宿主传入；用户需求「点击通话卡片就能回拨电话」）。
 */
export function CallCardBubble({
  variant,
  state,
  duration,
  direction = 'out',
  onRedial,
}: {
  variant: 'wx' | 'qq';
  state: CallCardState;
  duration: number;
  direction?: 'out' | 'in';
  onRedial?: () => void;
}) {
  const mine = direction === 'out';
  const clickable = Boolean(onRedial);
  const text = callCardText(state, duration, direction, variant);
  const isWx = variant === 'wx';
  const iconFirst = variant === 'qq' || !mine;
  // 微信电话图标凹口朝下（lucide Phone 默认凹口朝右上，rotate-45 朝右，rotate-[135deg] 才朝下——用户反馈「凹的地方朝下，不是朝右」）；QQ 不转
  const phoneIcon = (
    <Phone
      className={`${isWx ? 'h-[17px] w-[17px] rotate-[135deg]' : 'h-[18px] w-[18px]'} shrink-0`}
      strokeWidth={variant === 'qq' && mine ? 0 : 2}
      {...(variant === 'qq' && mine ? { fill: 'currentColor' } : {})}
      aria-hidden="true"
    />
  );
  return (
    <button
      type="button"
      onClick={clickable ? onRedial : undefined}
      aria-label={`语音通话：${text}${clickable ? '，点击回拨' : ''}`}
      data-testid={`${variant}-call-card`}
      className={`relative flex w-fit min-w-0 max-w-full select-none items-center gap-1.5 text-left transition-colors ${
        isWx
          ? `rounded-[5px] px-3 py-2 text-[16px] leading-[1.45] ${
              mine ? 'bg-[#95EC69] text-black dark:bg-[#3EB575] dark:text-black' : 'bg-white text-black dark:bg-[#1E1E1E] dark:text-white'
            }`
          : `rounded-[10px] px-3.5 py-[9px] text-[16px] leading-[1.5] ${
              mine ? 'text-white' : 'bg-white text-[#1F2329] dark:bg-[#2A2C31] dark:text-white'
            }`
      } ${clickable ? 'cursor-pointer active:opacity-70' : 'cursor-default'}`}
      style={variant === 'qq' && mine ? { backgroundColor: '#0099FF' } : undefined}
    >
      {/* 小三角尾巴（微信同款；QQ 无尾巴） */}
      {isWx && (
        <span
          aria-hidden="true"
          className={`absolute top-[11px] h-[8px] w-[8px] rotate-45 ${
            mine ? '-right-[3px] bg-[#95EC69] dark:bg-[#3EB575]' : '-left-[3px] bg-white dark:bg-[#1E1E1E]'
          }`}
        />
      )}
      {iconFirst && phoneIcon}
      <span className="whitespace-nowrap" data-testid={`${variant}-call-card-sub`}>
        {text}
      </span>
      {!iconFirst && phoneIcon}
    </button>
  );
}
