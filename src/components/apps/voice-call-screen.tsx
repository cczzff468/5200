'use client';

/**
 * 微信 / QQ 语音通话界面（同一引擎 useChatCall，两种皮肤）：
 *
 * - 微信皮肤（对照用户截图）：深色背景；接通后顶部居中显示通话时长；方形圆角头像；
 *   底部三个圆形按钮（麦克风 / 挂断 / 扬声器）；来电页「邀请你语音通话」+ 红拒绝/绿接听圆形按钮 +
 *   「1小时内隐藏他的来电」胶囊；点按麦克风说话、再点发送，长按麦克风静音。
 * - QQ 皮肤（对照用户截图）：深色背景；圆形大头像；呼叫中「正在呼叫…」；接通后时长显示在
 *   底部按钮上方；底部圆角方形按钮（菜单 / 麦克风 / 扬声器 / 挂断）；来电页「邀请你语音通话」+
 *   「消息回复」+ 红挂断/绿接听圆角方按钮；菜单里可静音。
 *
 * - 状态区：「正在说话」「正在听」「正在思考…」「识别中…」等；TTS 失败时回复文字以字幕显示，通话不中断。
 * - 通话卡片（CallCardBubble）：结束后插入聊天记录——已取消（点击重拨）/ 对方未接听 / 已拒绝 /
 *   未接听 / 通话时长；带电话图标，微信/QQ 各自配色。
 */

import { useRef, useState } from 'react';
import {
  BellOff,
  Mic,
  MicOff,
  MessageSquare,
  Phone,
  PhoneOff,
  PictureInPicture2,
  Plus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { DefaultAvatar } from './default-avatar';
import {
  formatCallDuration,
  useChatCall,
  type ChatCallResult,
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
  multiApp?: boolean;
  /** 通话结束（恰好一次）：宿主生成通话卡片并关闭浮层 */
  onEnd: (r: ChatCallResult) => void;
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

/** 左上角小窗图标（两 App 通话页都有） */
function PipIcon() {
  return (
    <span className="absolute left-5 top-16 flex h-10 w-10 items-center justify-center rounded-[12px] bg-white/10 text-white/80 backdrop-blur-sm" aria-hidden="true">
      <PictureInPicture2 className="h-5 w-5" strokeWidth={1.8} />
    </span>
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

// ---------------- 微信皮肤 ----------------

function WxCallScreen({ name, avatar, contact, direction, initialHistory, memoryBlock, momentsBlock, timeBlock, multiApp, onEnd }: VoiceCallScreenProps) {
  const call = useChatCall({ app: 'wx', contact, direction, initialHistory, memoryBlock, momentsBlock, timeBlock, multiApp, onEnd });
  const { phase, status, seconds, recording, muted, speakerOn, error, caption } = call;

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
      <PipIcon />
      {/* 接通后顶部居中计时（对照截图 12:00:00） */}
      {phase === 'active' && (
        <div className="pt-[70px] text-center text-[20px] font-light tabular-nums text-white/95" data-testid="wx-call-duration">
          {formatCallDuration(seconds)}
        </div>
      )}
      {phase === 'dialing' && (
        <div className="pt-[70px] text-center text-[20px] font-light text-white/90">语音通话</div>
      )}
      {phase !== 'incoming' && (
        <button
          type="button"
          aria-label="更多"
          className="absolute right-5 top-[64px] flex h-10 w-10 items-center justify-center rounded-full text-white/80 active:opacity-60"
        >
          <Plus className="h-6 w-6" strokeWidth={1.6} />
        </button>
      )}

      {/* 中部：头像 + 名字 + 状态 */}
      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-16">
        <div className="relative">
          {phase === 'dialing' && <span className="absolute inset-0 animate-ping rounded-[16px] bg-white/10" aria-hidden="true" />}
          <CallAvatar variant="wx" avatar={avatar} size={104} />
        </div>
        <h2 className="mt-5 max-w-[280px] truncate text-[22px] font-medium leading-tight">{name}</h2>
        <p className="mt-2 text-[14px] text-white/60" aria-live="polite" data-testid="wx-call-status">
          {statusLine(phase, status, 'wx')}
        </p>
        {caption && (
          <p className="mt-3 max-w-[280px] text-center text-[13px] leading-relaxed text-white/80" data-testid="wx-call-caption">
            {caption}
          </p>
        )}
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
            {/* 麦克风：点按说话 / 长按静音（拨号中禁用） */}
            {phase === 'active' && (
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
            )}
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
    </div>
  );
}

// ---------------- QQ 皮肤 ----------------

function QqCallScreen({ name, avatar, contact, direction, initialHistory, memoryBlock, momentsBlock, timeBlock, multiApp, onEnd, onMessageReply }: VoiceCallScreenProps) {
  const call = useChatCall({ app: 'qq', contact, direction, initialHistory, memoryBlock, momentsBlock, timeBlock, multiApp, onEnd });
  const { phase, status, seconds, recording, muted, speakerOn, error, caption } = call;
  const [menuOpen, setMenuOpen] = useState(false);

  const qqSquare =
    'flex h-[72px] w-[72px] items-center justify-center rounded-[26px] transition-colors active:opacity-70';
  const darkBtn = `${qqSquare} bg-white/10 text-white`;
  const whiteBtn = `${qqSquare} bg-white text-black`;

  return (
    <div className="relative z-10 flex h-full flex-col">
      <PipIcon />

      {/* 中部：圆形大头像 + 名字 + 状态 */}
      <div className="flex flex-1 flex-col items-center justify-center px-8 pb-20">
        <div className="relative">
          {phase === 'dialing' && <span className="absolute inset-0 animate-ping rounded-full bg-white/10" aria-hidden="true" />}
          <CallAvatar variant="qq" avatar={avatar} size={direction === 'in' ? 132 : 168} />
        </div>
        <h2 className="mt-6 max-w-[280px] truncate text-[24px] font-normal leading-tight">{name}</h2>
        <p className="mt-3 text-[15px] text-white/65" aria-live="polite" data-testid="qq-call-status">
          {statusLine(phase, status, 'qq')}
        </p>
        {caption && (
          <p className="mt-3 max-w-[280px] text-center text-[13px] leading-relaxed text-white/80" data-testid="qq-call-caption">
            {caption}
          </p>
        )}
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
          <div className="flex w-full items-center justify-between px-1">
            {/* 菜单（静音入口；拨号中隐藏） */}
            {phase === 'active' ? (
              <button type="button" onClick={() => setMenuOpen(true)} aria-label="更多" data-testid="qq-call-menu" className={darkBtn}>
                <span className="flex flex-col gap-[5px]" aria-hidden="true">
                  <span className="block h-[2px] w-[22px] rounded bg-current" />
                  <span className="block h-[2px] w-[22px] rounded bg-current" />
                  <span className="block h-[2px] w-[22px] rounded bg-current" />
                </span>
              </button>
            ) : (
              <span className="h-[72px] w-[72px]" aria-hidden="true" />
            )}
            {/* 麦克风：点按说话 / 发送 */}
            <button
              type="button"
              onClick={call.tapMic}
              aria-label={recording ? '发送' : '说话'}
              aria-pressed={recording}
              data-testid="qq-call-mic"
              className={`${recording ? `${whiteBtn} ring-2 ring-[#2FBF71]` : muted ? `${darkBtn} opacity-60` : whiteBtn}`}
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

      {/* 菜单底部弹层：静音 / 取消 */}
      {menuOpen && (
        <div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/50" role="dialog" aria-label="通话菜单" onClick={() => setMenuOpen(false)} data-testid="qq-call-menu-sheet">
          <div className="mx-3 mb-[max(14px,env(safe-area-inset-bottom))] overflow-hidden rounded-[14px] bg-[#F7F7F7] dark:bg-[#2A2A2E]" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => {
                call.toggleMute();
                setMenuOpen(false);
              }}
              className="flex w-full items-center justify-between px-5 py-4 text-[16px] text-black active:bg-black/5 dark:text-white dark:active:bg-white/10"
              data-testid="qq-call-menu-mute"
            >
              <span>{muted ? '取消静音' : '静音麦克风'}</span>
              {muted && <MicOff className="h-5 w-5 text-[#F5455C]" strokeWidth={1.9} />}
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="flex w-full items-center justify-center border-t border-black/5 px-5 py-4 text-[16px] text-[#12B7F5] active:bg-black/5 dark:border-white/10 dark:active:bg-white/10"
            >
              <X className="mr-1 h-4 w-4" strokeWidth={2} />
              取消
            </button>
          </div>
        </div>
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

export function callCardSubtitle(state: CallCardState, duration: number): string {
  switch (state) {
    case 'cancelled':
      return '已取消，点击重拨';
    case 'no-answer':
      return '对方未接听';
    case 'rejected':
      return '已拒绝';
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
 * 通话记录卡片（微信/QQ 聊天气泡内；带电话图标，样式对照两 App）。
 * state==='cancelled' 时整卡可点（重拨）。
 */
export function CallCardBubble({
  variant,
  state,
  duration,
  onRedial,
}: {
  variant: 'wx' | 'qq';
  state: CallCardState;
  duration: number;
  onRedial?: () => void;
}) {
  const accent = variant === 'wx' ? '#07C160' : '#12B7F5';
  const clickable = state === 'cancelled' && Boolean(onRedial);
  return (
    <button
      type="button"
      onClick={clickable ? onRedial : undefined}
      disabled={!clickable}
      aria-label={`语音通话：${callCardSubtitle(state, duration)}${clickable ? '，点击重拨' : ''}`}
      data-testid={`${variant}-call-card`}
      className={`flex min-w-[190px] items-center gap-3 rounded-[10px] px-3.5 py-3 text-left transition-colors ${
        variant === 'wx'
          ? 'bg-white dark:bg-[#232324]'
          : 'bg-white dark:bg-[#232326] rounded-[12px]'
      } ${clickable ? 'cursor-pointer active:opacity-70' : 'cursor-default'}`}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: accent }}
        aria-hidden="true"
      >
        <Phone className="h-5 w-5" strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium leading-tight text-black/90 dark:text-white/90">语音通话</span>
        <span className="mt-1 block truncate text-[12px] leading-tight text-black/45 dark:text-white/45" data-testid={`${variant}-call-card-sub`}>
          {callCardSubtitle(state, duration)}
          {clickable && <span className="ml-1" style={{ color: accent }}>拨打</span>}
        </span>
      </span>
    </button>
  );
}
