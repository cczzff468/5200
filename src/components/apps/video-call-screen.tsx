'use client';

/**
 * 微信 / QQ / 电话 App 视频通话界面（Task 22，同一引擎 useChatCall media='video'，三种皮肤）：
 *
 * 完整复用语音通话引擎（chat-call.ts）：状态机（拨号/来电/接通/结束）、AI 接听决策、免提自动对话
 * （VAD）、通话字幕、通话中文字聊天、挂断续聊、通话记忆（提取+总结）全部同源——本组件只加
 * 「视频画面层 + 相机采集 + 识图注入」：
 *
 * - 主画面 = 对方（AI 角色）画面：角色头像 Ken Burns 缓慢缩放的「动态画面」（AI 无法产出真人视频，
 *   以动态头像+模糊背景模拟；无头像用 DefaultAvatar 兜底）；
 * - 小窗 = 用户摄像头画面（getUserMedia video-only，音频轨由通话引擎自理）：默认右上角（QQ 左上），
 *   点击主画面/小窗互换大小窗；前后置翻转（facingMode user/environment，切翻转重建流）；
 *   摄像头开关随时可切；权限拒绝/无设备 → 降级为「摄像头已关」占位，通话完全不受影响；
 * - AI 看见用户：接通且摄像头开启时每 10s 抓一帧（canvas 缩帧 → JPEG dataURL）→ 用户自己配置的
 *   识图模型（/api/vision 同链路，内网直连/内置兜底同 describeImages）→ 描述文本缓存；引擎每轮
 *   经 visionBlockFn 取最新描述注入【用户画面】system 块——AI 知道画面内容并按人设回应；
 *   摄像头关/识图未配置/识图失败 → 不注入，AI 规则明确「不装作看得见」（chatCallExtraRules video 分叉）；
 * - 拨号中（我方拨出）：主画面 = 用户摄像头全屏（对照微信真实行为：等待接通时看到自己），
 *   对方头像小窗常显（Task 24：刚拨出界面头像也要一直显示）+名字+状态叠在前；来电响铃：全屏来电页
 *   （头像+邀请你视频通话+拒绝/视频接听）；
 * - 通话卡片/记忆/续聊由引擎与宿主承担（media='video' 分叉：视频通话时长文案、视频通话记忆场景）。
 *
 * 权限边界：摄像头只在「拨出即开 / 接听时开」首次使用时申请；拒绝后文字/语音聊天与其他功能不受影响。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  PictureInPicture2,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { DefaultAvatar } from './default-avatar';
import { CaptionStream, InlineCallChat, statusLine } from './voice-call-screen';
import {
  formatCallDuration,
  useChatCall,
  type ChatCallApi,
  type ChatCallResult,
  type ChatCallTurnMsg,
} from '@/lib/ios/chat-call';
import type { ContactRecord } from '@/lib/contacts';
import { useSettings } from '@/lib/ios/store';
import {
  captureFrameDataUrl,
  describeUserFrame,
  useLocalCamera,
  videoVisionReady,
  type CameraFacing,
} from '@/lib/ios/camera-capture';

export interface VideoCallScreenProps {
  /** wx=微信皮肤 / qq=QQ皮肤 / phone=电话 App（iOS 黑白灰） */
  variant: 'wx' | 'qq' | 'phone';
  name: string;
  avatar: string | null;
  contact: ContactRecord | null;
  direction: 'out' | 'in';
  /** 进入通话时携带的最近聊天上下文（宿主按会话消息归并） */
  initialHistory: ChatCallTurnMsg[];
  memoryBlock?: string;
  memoryBlockFn?: (userText: string | null) => string | undefined;
  worldbookBlock?: string;
  momentsBlock?: string;
  timeBlock?: string;
  locBlock?: string;
  multiApp?: boolean;
  /** 通话结束（恰好一次）：宿主生成通话卡片并关闭浮层 */
  onEnd: (r: ChatCallResult) => void;
  /** 挂断后 AI 续聊文字生成完毕（引擎异步产出，紧随挂断）：宿主以聊天消息落盘 */
  onFollowup?: (texts: string[]) => void;
  /** 左上角小窗图标点击：收起为全局悬浮小窗（全局层传入；无则仅展示不可点） */
  onMinimize?: () => void;
  /** QQ 来电页「消息回复」：挂断来电并回到聊天 */
  onMessageReply?: () => void;
}

/** 识图轮询间隔（ms）：接通即抓一帧，之后每 10s 刷新一次「用户画面」描述 */
const VISION_TICK_MS = 10_000;

/** 共享运行时：引擎（media='video'）+ 相机 + 识图循环 + 大小窗互换 */
function useVideoCallRuntime(props: VideoCallScreenProps) {
  const { variant, direction } = props;
  const visionCfg = useSettings((s) => s.visionConfig);
  const visionCfgReady = useMemo(() => videoVisionReady(visionCfg), [visionCfg]);

  const latestVisionRef = useRef('');
  /** 摄像头开关（用户可随时切）；来电响铃阶段不拉流，接听时才申请权限 */
  const camOnRef = useRef(true);
  const [camOn, setCamOn] = useState(true);
  /** 已获准拉流：拨出=true（等待接通就看到自己，对照微信真实行为）/ 来电=接听后 true */
  const [camArmed, setCamArmed] = useState(direction === 'out');
  const [facing, setFacing] = useState<CameraFacing>('user');
  const [swapped, setSwapped] = useState(false);
  /** 用户摄像头实际分辨率（Task 23）：PIP 小窗高度随视频宽高比自适应，避免 object-cover 过度裁剪显得「太放大」 */
  const [camSize, setCamSize] = useState<{ w: number; h: number } | null>(null);
  const onVideoMeta = (w: number, h: number) =>
    setCamSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));

  const call = useChatCall({
    app: variant,
    media: 'video',
    contact: props.contact,
    direction: props.direction,
    initialHistory: props.initialHistory,
    memoryBlock: props.memoryBlock,
    memoryBlockFn: props.memoryBlockFn,
    worldbookBlock: props.worldbookBlock,
    momentsBlock: props.momentsBlock,
    timeBlock: props.timeBlock,
    locBlock: props.locBlock,
    multiApp: props.multiApp,
    visionBlockFn: () => (camOnRef.current ? latestVisionRef.current || undefined : undefined),
    onEnd: props.onEnd,
    onFollowup: props.onFollowup,
  });

  const camera = useLocalCamera(camArmed && camOn && call.phase !== 'ended', facing);

  // 来电接听：先开摄像头再进通话（权限首次申请时机=接听动作）
  const accept = () => {
    setCamArmed(true);
    call.accept();
  };
  /** 来电页「语音接听」（对照微信截图）：关摄像头只通声音，走正常接听（识图同步停） */
  const acceptAsVoice = () => {
    camOnRef.current = false;
    setCamOn(false);
    latestVisionRef.current = '';
    setCamArmed(true);
    call.accept();
  };
  const toggleCam = () => {
    const next = !camOnRef.current;
    camOnRef.current = next;
    setCamOn(next);
    if (next) {
      // 开摄像头（含来电响铃阶段预开，对照 QQ 截图「摄像头已开」）：允许拉流（首次触发权限申请）
      setCamArmed(true);
    } else {
      latestVisionRef.current = ''; // 关摄像头即刻清描述：AI 下一轮起不再注入【用户画面】
    }
  };
  const flipCam = () => setFacing((f) => (f === 'user' ? 'environment' : 'user'));
  const swapViews = () => setSwapped((s) => !s);

  // 识图循环：接通 + 摄像头就绪 + 识图配置就绪才跑；单飞防重入；失败静默（保上一条描述）
  useEffect(() => {
    if (call.phase !== 'active' || !camOn || !camera.ready || !visionCfgReady) return;
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (stopped || busy) return;
      const frame = captureFrameDataUrl(camera.videoRef.current);
      if (!frame) return;
      busy = true;
      try {
        const desc = await describeUserFrame(visionCfg, frame);
        if (!stopped && desc) latestVisionRef.current = desc;
      } catch {
        // 识图失败静默：AI 下一轮不注入画面（规则侧「不装作看得见」），通话继续
      }
      busy = false;
    };
    // 接通后稍等 1.2s 首抓（等 <video> 出画面），再固定间隔刷新
    const first = window.setTimeout(() => void tick(), 1200);
    const timer = window.setInterval(() => void tick(), VISION_TICK_MS);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [call.phase, camOn, camera.ready, visionCfgReady, facing, visionCfg, camera.videoRef]);

  return {
    call,
    accept,
    acceptAsVoice,
    toggleCam,
    flipCam,
    swapViews,
    swapped,
    camOn,
    camera,
    facing,
    visionCfgReady,
    camSize,
    onVideoMeta,
  };
}

type Runtime = ReturnType<typeof useVideoCallRuntime>;

/** 对方（AI 角色）动态画面：头像 Ken Burns 缓慢缩放 + 深色渐晕背景（AI 无真人视频，动态头像模拟）。
 *  Task 23：微信皮肤头像为正方形圆角（对照微信真实行为），QQ/电话保持圆形 */
function RemoteView({
  avatar,
  name,
  size,
  shape = 'circle',
}: {
  avatar: string | null;
  name: string;
  size: number;
  shape?: 'circle' | 'square';
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {/* 模糊放大的头像背景（角色画面氛围底） */}
      {avatar ? (
        <div
          className="absolute inset-0 scale-125 bg-cover bg-center opacity-40 blur-2xl"
          style={{ backgroundImage: `url(${avatar})` }}
          aria-hidden="true"
        />
      ) : null}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_20%,transparent_30%,rgba(0,0,0,0.55)_100%)]" aria-hidden="true" />
      {/* 头像缓慢缩放（Ken Burns）模拟动态画面 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          animate={{ scale: [1, 1.07, 1] }}
          transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
          className="overflow-hidden shadow-2xl ring-1 ring-white/10"
          style={{ width: size, height: size, borderRadius: shape === 'square' ? Math.round(size * 0.12) : size / 2 }}
        >
          {avatar ? (
            <img src={avatar} alt={`${name}的画面`} className="h-full w-full object-cover" />
          ) : (
            <DefaultAvatar size={size} shape={shape === 'square' ? 'square' : 'circle'} className="h-full w-full" />
          )}
        </motion.div>
      </div>
    </div>
  );
}

/** 我方画面（用户摄像头全屏，拨号中/互换后主画面用；无流时黑底+提示；基础量拆开传防 ref 容器对象渲染期访问）。
 *  Task 23：前置摄像头镜像预览（照镜子习惯，「画面是反的」修复；后置不镜像）。
 *  Task 24：「聚焦太放大」修复——全屏不再 object-cover 硬裁剪（390×844 竖屏装 4:3 横向画面会裁掉约
 *  65% 宽度，显得极度放大），改为 object-contain 完整显示 + 同路视频流模糊放大垫底（视频通话惯例观感） */
function LocalFullView({
  videoRef,
  stream,
  ready,
  denied,
  hint,
  mirrored,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** 摄像头 MediaStream（垫底模糊画面第二个 <video> 用，与主画面同一流） */
  stream: MediaStream | null;
  ready: boolean;
  denied: boolean;
  hint: string;
  /** 前置摄像头镜像预览 */
  mirrored: boolean;
}) {
  const backdropRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (backdropRef.current) backdropRef.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {ready ? (
        <>
          {/* 模糊垫底（同一流，放大+虚化；contain 主画面四周不再是大黑边） */}
          <video
            ref={backdropRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-2xl"
            style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
            aria-hidden="true"
          />
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 h-full w-full object-contain"
            style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
            aria-label="我的摄像头画面"
          />
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#111114]">
          <VideoOff className="h-9 w-9 text-white/30" strokeWidth={1.6} aria-hidden="true" />
          <p className="text-[13px] text-white/45">{denied ? '摄像头不可用，已为你隐藏画面' : hint}</p>
        </div>
      )}
      {/* 自看水印（这是我的摄像头画面，与对方画面区分） */}
      <p className="absolute bottom-[calc(env(safe-area-inset-bottom)+120px)] left-1/2 -translate-x-1/2 text-[12px] text-white/40">你</p>
    </div>
  );
}

/** 我方小窗（用户摄像头 PIP；关/拒绝时占位；基础量拆开传防 ref 容器对象渲染期访问）。
 *  Task 23：前置摄像头镜像预览（后置不镜像）+ 高度随视频实际宽高比自适应——
 *  固定高在宽高比不匹配时 object-cover 会重度裁剪，画面显得「太放大」；
 *  点击小窗与对方画面互换（Task 23：互换画面按钮已删，点右上角小窗互换） */
function LocalPipView({
  videoRef,
  live,
  denied,
  className,
  testId,
  onClick,
  mirrored,
  height,
  onMeta,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  live: boolean;
  denied: boolean;
  className: string;
  testId: string;
  onClick?: () => void;
  /** 前置摄像头镜像预览 */
  mirrored: boolean;
  /** 自适应高度（px）；不传则用 className 里的默认高度 */
  height?: number;
  /** 视频实际分辨率上报（供高度自适应计算） */
  onMeta?: (w: number, h: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label={live ? '我的画面，点击与对方画面互换' : '我的画面（摄像头已关）'}
      data-testid={testId}
      onClick={onClick}
      style={height ? { height } : undefined}
      className={`absolute z-10 overflow-hidden ring-1 ring-white/25 shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-transform active:scale-95 ${className}`}
    >
      {live ? (
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="h-full w-full object-cover"
          style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            if (el.videoWidth > 0 && el.videoHeight > 0) onMeta?.(el.videoWidth, el.videoHeight);
          }}
        />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[#1b1b1f]">
          <VideoOff className="h-4 w-4 text-white/35" strokeWidth={1.8} aria-hidden="true" />
          <span className="text-[10px] leading-none text-white/40">{denied ? '摄像头不可用' : '摄像头已关'}</span>
        </span>
      )}
    </button>
  );
}

/** PIP 高度自适应（Task 23/24）：按摄像头实际宽高比把小窗高度收敛到视频比例，过度裁剪会显得太放大；
 *  下限 64（Task 24 从 100 下调：4:3 画面 96 宽只需 72 高，之前被抬到 100 反而又裁了 28%） */
function pipAdaptiveHeight(size: { w: number; h: number } | null, width: number, fallback: number): number {
  if (!size || size.w <= 0 || size.h <= 0) return fallback;
  return Math.max(64, Math.min(152, Math.round((width * size.h) / size.w)));
}

/** 来电打字点动画（对照微信/QQ 来电截图：头像下的呼吸点） */
function TypingDots() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true" data-testid="video-typing-dots">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-white/80"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{ duration: 1.15, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

/** 视频通话页顶部信息（Task 24：小头像+名字一行（比语音通话小一号）+ 接通后时长 + AI 状态
 *  （正在听/正在思考…/正在说话，与语音通话同款 statusLine）） */
function VideoTopBar({
  avatar,
  name,
  phase,
  seconds,
  statusText,
  shape,
  testId,
}: {
  avatar: string | null;
  name: string;
  phase: string;
  seconds: number;
  statusText: string | null;
  shape: 'circle' | 'square';
  testId: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[54px] z-10 flex flex-col items-center gap-1">
      <div className="flex items-center gap-2">
        {avatar ? (
          <img
            src={avatar}
            alt=""
            className={`h-8 w-8 shrink-0 object-cover shadow-md ring-1 ring-white/20 ${shape === 'square' ? 'rounded-[9px]' : 'rounded-full'}`}
          />
        ) : (
          <DefaultAvatar size={32} shape={shape} className="h-8 w-8 shrink-0 shadow-md ring-1 ring-white/20" />
        )}
        <span className="max-w-[190px] truncate text-[15px] font-medium text-white/95 drop-shadow">{name}</span>
      </div>
      {phase === 'active' && (
        <span className="text-[12px] tabular-nums text-white/70 drop-shadow" data-testid={testId}>
          {formatCallDuration(seconds)}
        </span>
      )}
      {phase === 'active' && statusText && (
        <span className="text-[11px] leading-none text-white/55 drop-shadow" aria-live="polite" data-testid={`${testId}-status`}>
          {statusText}
        </span>
      )}
    </div>
  );
}

/** 小窗图标（收起为全局悬浮小窗；视频页复用语音同款） */
function VideoPipIcon({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label="收起为悬浮小窗"
      data-testid="call-pip-btn"
      onClick={onClick}
      disabled={!onClick}
      className="absolute left-5 top-[58px] z-20 flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
    >
      <PictureInPicture2 className="h-5 w-5" strokeWidth={1.8} />
    </button>
  );
}

/** 通话字幕（单句；容器由宿主给位：接通后底部控制区第一格，超高内部滚动；复用语音同款 CaptionStream） */
function VideoCaption({ variant, call }: { variant: 'wx' | 'qq'; call: ChatCallApi }) {
  return (
    <div className="pointer-events-none flex max-h-full w-full items-start justify-center overflow-hidden">
      <CaptionStream variant={variant} call={call} />
    </div>
  );
}

// ---------------- 微信皮肤 ----------------

function WxVideoCall(props: VideoCallScreenProps) {
  const rt = useVideoCallRuntime(props);
  const { call, camera } = rt;
  const { phase, status, seconds, muted, speakerOn } = call;
  const [textChatOpen, setTextChatOpen] = useState(false);

  // Task 24：接通后与语音通话同款状态文案（正在听/在听你说…/识别中…/正在思考…/正在说话）
  const statusText = phase === 'active' ? statusLine('active', status, 'wx') : null;

  const openTextChat = () => {
    if (phase !== 'active') return;
    call.setTextMode(true);
    setTextChatOpen(true);
  };
  const closeTextChat = () => {
    call.setTextMode(false);
    setTextChatOpen(false);
  };
  const toggleTextChat = () => (textChatOpen ? closeTextChat() : openTextChat());

  const dialing = phase === 'dialing';
  const incoming = phase === 'incoming';
  const wxRound = 'flex h-[60px] w-[60px] items-center justify-center rounded-full transition-colors active:opacity-70';

  const camBtn = (
    <button
      type="button"
      onClick={rt.toggleCam}
      aria-label={rt.camOn ? '关闭摄像头' : '打开摄像头'}
      aria-pressed={rt.camOn}
      data-testid="wx-video-cam"
      className={`${wxRound} ${rt.camOn ? 'bg-white/15 text-white' : 'bg-white/10 text-white/50'}`}
    >
      {rt.camOn ? <Video className="h-6 w-6" strokeWidth={1.9} /> : <VideoOff className="h-6 w-6" strokeWidth={1.9} />}
    </button>
  );
  const micBtn = (
    <button
      type="button"
      onClick={call.toggleMute}
      aria-label={muted ? '取消静音' : '静音麦克风'}
      aria-pressed={muted}
      data-testid="wx-video-mic"
      className={`${wxRound} ${muted ? 'bg-white/10 text-white/60' : 'bg-white/15 text-white'}`}
    >
      {muted ? <MicOff className="h-6 w-6" strokeWidth={1.9} /> : <Mic className="h-6 w-6" strokeWidth={1.9} />}
    </button>
  );
  const speakerBtn = (
    <button
      type="button"
      onClick={call.toggleSpeaker}
      aria-label={speakerOn ? '关闭扬声器' : '开启扬声器'}
      aria-pressed={speakerOn}
      data-testid="wx-video-speaker"
      className={`${wxRound} ${speakerOn ? 'bg-white/15 text-white' : 'bg-white/10 text-white/60'}`}
    >
      {speakerOn ? <Volume2 className="h-6 w-6" strokeWidth={1.9} /> : <VolumeX className="h-6 w-6" strokeWidth={1.9} />}
    </button>
  );
  const hangupBtn = (
    <button
      type="button"
      onClick={call.hangup}
      aria-label="挂断"
      data-testid="wx-video-hangup"
      className="flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[#FA5151] text-white transition-colors active:opacity-80"
    >
      <PhoneOff className="h-8 w-8" strokeWidth={2} />
    </button>
  );

  return (
    <div className="relative h-full w-full overflow-hidden" data-testid="wx-video-screen">
      {/* 画面层：拨号中主画面=我方摄像头（对照微信真实行为）+对方头像小窗常显；来电/接通主画面=对方动态画面，小窗=我方 */}
      {dialing ? (
        <>
          <LocalFullView
            videoRef={camera.videoRef}
            stream={camera.stream}
            ready={camera.ready}
            denied={camera.denied}
            hint="正在等待对方接受视频邀请…"
            mirrored={rt.facing === 'user'}
          />
          {/* Task 24：刚拨出界面对方头像也要一直显示（位置与接通后我方小窗一致，接通自然衔接） */}
          <div
            aria-hidden="true"
            data-testid="wx-video-dial-avatar"
            className="absolute right-4 top-[108px] z-10 h-[140px] w-[104px] overflow-hidden rounded-[14px] shadow-[0_8px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/25"
          >
            <RemoteView avatar={props.avatar} name={props.name} size={84} shape="square" />
          </div>
        </>
      ) : rt.swapped ? (
        <>
          <LocalFullView
            videoRef={camera.videoRef}
            stream={camera.stream}
            ready={camera.ready}
            denied={camera.denied}
            hint="摄像头已关"
            mirrored={rt.facing === 'user'}
          />
          {phase === 'active' && (
            <button
              type="button"
              onClick={rt.swapViews}
              aria-label="与我的画面互换"
              data-testid="wx-video-remote-mini"
              className="absolute right-4 top-[108px] z-10 h-[140px] w-[104px] overflow-hidden rounded-[14px] ring-1 ring-white/25 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
            >
              <RemoteView avatar={props.avatar} name={props.name} size={104} shape="square" />
            </button>
          )}
        </>
      ) : (
        <>
          {/* 微信皮肤：角色头像为正方形圆角（Task 23 用户指定）；Task 24 头像变小一档 */}
          <RemoteView avatar={props.avatar} name={props.name} size={184} shape="square" />
          {phase === 'active' && (
            <LocalPipView
              videoRef={camera.videoRef}
              live={rt.camOn && camera.ready}
              denied={camera.denied}
              className="right-4 top-[108px] h-[140px] w-[104px] rounded-[14px]"
              testId="wx-video-pip"
              onClick={rt.swapViews}
              mirrored={rt.facing === 'user'}
              height={pipAdaptiveHeight(rt.camSize, 104, 140)}
              onMeta={rt.onVideoMeta}
            />
          )}
        </>
      )}

      {/* 顶部信息（小头像+名字+时长+状态） + 小窗/翻转/文字聊天入口 */}
      <VideoTopBar
        avatar={props.avatar}
        name={props.name}
        phase={phase}
        seconds={seconds}
        statusText={statusText}
        shape="square"
        testId="wx-video-duration"
      />
      {(phase === 'active' || dialing) && (
        <>
          <VideoPipIcon onClick={props.onMinimize} />
          {/* 右上角（时长文字旁）：翻转摄像头（Task 23 从底部移上来）+ 发消息 */}
          <div className="absolute right-5 top-[58px] z-20 flex items-center gap-2">
            <button
              type="button"
              onClick={rt.flipCam}
              aria-label="翻转摄像头（前后置切换）"
              data-testid="wx-video-flip"
              className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
            >
              <SwitchCamera className="h-5 w-5" strokeWidth={1.8} />
            </button>
            {phase === 'active' && (
              <button
                type="button"
                aria-label="发消息"
                aria-pressed={textChatOpen}
                data-testid="wx-video-textchat-btn"
                onClick={toggleTextChat}
                className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
              >
                <MessageSquare className="h-5 w-5" strokeWidth={1.8} />
              </button>
            )}
          </div>
        </>
      )}

      {/* 来电页（Task 23 对照微信截图：暗底 + 圆形头像 + 呼吸点 + 邀请你视频通话 +
          消息回复/语音接听 + 红拒绝/绿视频接听；底部按钮一直显示） */}
      {incoming && (
        <div className="absolute inset-0 z-10 flex flex-col items-center bg-[#0e0e11]/92 backdrop-blur-sm">
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 pb-6">
            <div className="relative mt-10">
              <span className="absolute inset-0 animate-ping rounded-full bg-white/10" aria-hidden="true" />
              {props.avatar ? (
                <img src={props.avatar} alt="" className="h-[112px] w-[112px] rounded-full object-cover shadow-2xl ring-1 ring-white/15" />
              ) : (
                <DefaultAvatar size={112} shape="circle" className="shadow-2xl ring-1 ring-white/15" />
              )}
            </div>
            <TypingDots />
            <p className="text-[15px] text-white/60" data-testid="wx-video-status">邀请你视频通话</p>
          </div>
          <div className="w-full px-12 pb-[max(34px,env(safe-area-inset-bottom))]">
            {/* 消息回复 / 语音接听（对照微信截图；语音接听=关摄像头只通声音） */}
            <div className="mb-9 flex items-start justify-around">
              {props.onMessageReply && (
                <button
                  type="button"
                  onClick={() => {
                    call.reject();
                    props.onMessageReply?.();
                  }}
                  aria-label="消息回复"
                  data-testid="wx-video-msg-reply"
                  className="flex flex-col items-center gap-2 text-white/90 active:opacity-60"
                >
                  <MessageSquare className="h-8 w-8" strokeWidth={1.6} />
                  <span className="text-[13px]">消息回复</span>
                </button>
              )}
              <button
                type="button"
                onClick={rt.acceptAsVoice}
                aria-label="语音接听（关闭摄像头）"
                data-testid="wx-video-voice-accept"
                className="flex flex-col items-center gap-2 text-white/90 active:opacity-60"
              >
                <Phone className="h-8 w-8" strokeWidth={1.6} />
                <span className="text-[13px]">语音接听</span>
              </button>
            </div>
            <div className="flex w-full items-start justify-between">
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={call.reject}
                  aria-label="拒绝"
                  data-testid="wx-video-reject"
                  className="flex h-[74px] w-[74px] items-center justify-center rounded-full bg-[#FA5151] text-white active:opacity-80"
                >
                  <PhoneOff className="h-8 w-8" strokeWidth={2} />
                </button>
                <span className="text-[13px] text-white/85">拒绝</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={rt.accept}
                  aria-label="接听视频"
                  data-testid="wx-video-accept"
                  className="flex h-[74px] w-[74px] items-center justify-center rounded-full bg-[#07C160] text-white active:opacity-80"
                >
                  <Video className="h-8 w-8" strokeWidth={2} />
                </button>
                <span className="text-[13px] text-white/85">接听</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 接通后底部控制（Task 24 重排：字幕/文字条与按钮同列排布——位置固定不叠压、不再随绝对定位漂移） */}
      {(phase === 'active' || dialing) && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-8 pb-[max(30px,env(safe-area-inset-bottom))] pt-6">
          {call.error && !textChatOpen && (
            <p className="text-center text-[12px] text-red-300">{call.error}</p>
          )}
          {phase === 'active' ? (
            textChatOpen ? (
              /* 文字输入条开着时字幕隐藏（与语音通话同口径），关掉恢复 */
              <div className="w-full">
                <InlineCallChat variant="wx" call={call} className="w-full" />
              </div>
            ) : (
              <div className="flex h-[68px] w-full items-center justify-center overflow-hidden">
                <VideoCaption variant="wx" call={call} />
              </div>
            )
          ) : (
            <p className="text-center text-[15px] text-white/70" data-testid="wx-video-status-dialing">
              等待对方接受邀请
            </p>
          )}
          {phase === 'active' && (
            <div className="flex items-start justify-center gap-10">
              <Ctl label={muted ? '麦克风已关' : '麦克风已开'}>{micBtn}</Ctl>
              <Ctl label={speakerOn ? '扬声器已开' : '扬声器已关'}>{speakerBtn}</Ctl>
              <Ctl label={rt.camOn ? '摄像头已开' : '摄像头已关'}>{camBtn}</Ctl>
            </div>
          )}
          {hangupBtn}
          {phase === 'active' && !muted && (
            <p className="text-[11px] text-white/40">免提自动对话 · 直接说话即可</p>
          )}
        </div>
      )}
    </div>
  );
}

/** 底部控制按钮+标签 */
function Ctl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {children}
      <span className="text-[12px] leading-none text-white/70">{label}</span>
    </div>
  );
}

// ---------------- QQ 皮肤 ----------------

function QqVideoCall(props: VideoCallScreenProps) {
  const rt = useVideoCallRuntime(props);
  const { call, camera } = rt;
  const { phase, status, seconds, muted, speakerOn } = call;
  const [textChatOpen, setTextChatOpen] = useState(false);

  // Task 24：接通后与语音通话同款状态文案（正在听/在听你说…/识别中…/正在思考…/正在说话）
  const statusText = phase === 'active' ? statusLine('active', status, 'qq') : null;

  const openTextChat = () => {
    if (phase !== 'active') return;
    call.setTextMode(true);
    setTextChatOpen(true);
  };
  const closeTextChat = () => {
    call.setTextMode(false);
    setTextChatOpen(false);
  };
  const toggleTextChat = () => (textChatOpen ? closeTextChat() : openTextChat());

  const dialing = phase === 'dialing';
  const incoming = phase === 'incoming';
  const qqSquare = 'flex h-[72px] w-[72px] items-center justify-center rounded-[26px] transition-colors active:opacity-70';
  const smallSquare = 'flex h-[52px] w-[52px] items-center justify-center rounded-[18px] transition-colors active:opacity-70';
  /** Task 24：底部四按钮行专用（摄像头并入后四钮平行，72px 放不下，收一档保证间距） */
  const qqCtl4 = 'flex h-[66px] w-[66px] items-center justify-center rounded-[22px] transition-colors active:opacity-70';

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#050506]" data-testid="qq-video-screen">
      {/* 画面层：拨号中主画面=我方摄像头+左上对方头像小窗常显（Task 24）；接通主画面=对方；小窗（QQ 在左上，对照截图 5）=我方 */}
      {dialing ? (
        <>
          <LocalFullView
            videoRef={camera.videoRef}
            stream={camera.stream}
            ready={camera.ready}
            denied={camera.denied}
            hint="正在呼叫…"
            mirrored={rt.facing === 'user'}
          />
          {/* Task 24：刚拨出界面对方头像也要一直显示（位置与接通后我方小窗一致，接通自然衔接） */}
          <div
            aria-hidden="true"
            data-testid="qq-video-dial-avatar"
            className="absolute left-4 top-[100px] z-10 h-[132px] w-[100px] overflow-hidden rounded-[14px] shadow-[0_8px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/25"
          >
            <RemoteView avatar={props.avatar} name={props.name} size={80} />
          </div>
        </>
      ) : rt.swapped ? (
        <>
          <LocalFullView
            videoRef={camera.videoRef}
            stream={camera.stream}
            ready={camera.ready}
            denied={camera.denied}
            hint="摄像头已关"
            mirrored={rt.facing === 'user'}
          />
          {phase === 'active' && (
            <button
              type="button"
              onClick={rt.swapViews}
              aria-label="与我的画面互换"
              data-testid="qq-video-remote-mini"
              className="absolute right-4 top-[104px] z-10 h-[132px] w-[100px] overflow-hidden rounded-[14px] ring-1 ring-white/25"
            >
              <RemoteView avatar={props.avatar} name={props.name} size={100} />
            </button>
          )}
        </>
      ) : (
        <>
          {/* Task 24：主画面头像变小一档 */}
          <RemoteView avatar={props.avatar} name={props.name} size={184} />
          {phase === 'active' && (
            <LocalPipView
              videoRef={camera.videoRef}
              live={rt.camOn && camera.ready}
              denied={camera.denied}
              className="left-4 top-[100px] h-[132px] w-[100px] rounded-[14px]"
              testId="qq-video-pip"
              onClick={rt.swapViews}
              mirrored={rt.facing === 'user'}
              height={pipAdaptiveHeight(rt.camSize, 100, 132)}
              onMeta={rt.onVideoMeta}
            />
          )}
        </>
      )}

      <VideoTopBar
        avatar={props.avatar}
        name={props.name}
        phase={phase}
        seconds={seconds}
        statusText={statusText}
        shape="circle"
        testId="qq-video-duration"
      />
      {/* 右上角（时长文字旁）：翻转摄像头（Task 24 从底部小按钮行移上来，与微信同款）+ 发消息；拨号中也可翻转 */}
      {(phase === 'active' || dialing) && (
        <>
          <VideoPipIcon onClick={props.onMinimize} />
          <div className="absolute right-5 top-[58px] z-20 flex items-center gap-2">
            <button
              type="button"
              onClick={rt.flipCam}
              aria-label="翻转摄像头（前后置切换）"
              data-testid="qq-video-flip"
              className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
            >
              <SwitchCamera className="h-5 w-5" strokeWidth={1.8} />
            </button>
            {phase === 'active' && (
              <button
                type="button"
                aria-label="发消息"
                aria-pressed={textChatOpen}
                data-testid="qq-video-textchat-btn"
                onClick={toggleTextChat}
                className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
              >
                <MessageSquare className="h-5 w-5" strokeWidth={1.8} />
              </button>
            )}
          </div>
        </>
      )}

      {/* 来电页（Task 23 对照 QQ 截图：黑底圆形大头像 + 呼吸点 + 邀请你视频通话..
          + 翻转/摄像头预开 + 消息回复 + 红拒绝/绿视频接听；底部按钮一直显示） */}
      {incoming && (
        <div className="absolute inset-0 z-10 flex flex-col items-center bg-[#050506]/94">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8">
            <div className="relative mt-8">
              <span className="absolute inset-0 animate-ping rounded-full bg-white/10" aria-hidden="true" />
              {props.avatar ? (
                <img src={props.avatar} alt="" className="h-[132px] w-[132px] rounded-full object-cover shadow-2xl ring-1 ring-white/15" />
              ) : (
                <DefaultAvatar size={132} shape="circle" className="shadow-2xl ring-1 ring-white/15" />
              )}
            </div>
            <TypingDots />
            <p className="text-[15px] text-white/60" data-testid="qq-video-status">邀请你视频通话..</p>
          </div>
          <div className="flex w-full flex-col items-center px-10 pb-[max(40px,env(safe-area-inset-bottom))]">
            {/* 响铃阶段预置摄像头（对照截图：翻转 / 摄像头已开——开=首次申请权限，接通即带上画面） */}
            <div className="mb-8 flex items-start justify-center gap-12">
              <Ctl label="翻转">
                <button
                  type="button"
                  onClick={rt.flipCam}
                  aria-label="翻转摄像头"
                  data-testid="qq-video-flip"
                  className={`${smallSquare} bg-white/10 text-white`}
                >
                  <SwitchCamera className="h-5 w-5" strokeWidth={1.8} />
                </button>
              </Ctl>
              <Ctl label={rt.camOn ? '摄像头已开' : '摄像头已关'}>
                <button
                  type="button"
                  onClick={rt.toggleCam}
                  aria-label={rt.camOn ? '关闭摄像头' : '打开摄像头'}
                  aria-pressed={rt.camOn}
                  data-testid="qq-video-cam"
                  className={`${smallSquare} ${rt.camOn ? 'bg-white/15 text-white' : 'bg-white/10 text-white/50'}`}
                >
                  {rt.camOn ? <Video className="h-5 w-5" strokeWidth={1.9} /> : <VideoOff className="h-5 w-5" strokeWidth={1.9} />}
                </button>
              </Ctl>
            </div>
            {props.onMessageReply && (
              <button
                type="button"
                onClick={() => {
                  call.reject();
                  props.onMessageReply?.();
                }}
                className="mb-9 flex w-[86px] flex-col items-center gap-2 self-start text-white/90 active:opacity-60"
                data-testid="qq-video-msg-reply"
              >
                <MessageSquare className="h-8 w-8" strokeWidth={1.6} />
                <span className="text-[13px]">消息回复</span>
              </button>
            )}
            <div className="flex w-full items-center justify-between">
              <button type="button" onClick={call.reject} aria-label="拒绝" data-testid="qq-video-reject" className={`${qqSquare} bg-[#F5455C] text-white`}>
                <PhoneOff className="h-8 w-8" strokeWidth={2} />
              </button>
              <button type="button" onClick={rt.accept} aria-label="接听视频" data-testid="qq-video-accept" className={`${qqSquare} bg-[#2FBF71] text-white`}>
                <Video className="h-8 w-8" strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 接通后：字幕/文字条 + 四按钮行（Task 24：摄像头并入底部三按钮→四钮平行；时长/状态在顶部，不再重复）
          与微信同款重排——字幕与按钮同列排布，不再绝对定位互相叠压 */}
      {(phase === 'active' || dialing) && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-4 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-6 pb-[max(28px,env(safe-area-inset-bottom))] pt-6">
          {call.error && !textChatOpen && (
            <p className="text-center text-[12px] text-red-300">{call.error}</p>
          )}
          {phase === 'active' ? (
            textChatOpen ? (
              /* 文字输入条开着时字幕隐藏（与语音通话同口径），关掉恢复 */
              <div className="w-full">
                <InlineCallChat variant="qq" call={call} className="w-full" />
              </div>
            ) : (
              <div className="flex h-[68px] w-full items-center justify-center overflow-hidden">
                <VideoCaption variant="qq" call={call} />
              </div>
            )
          ) : (
            <p className="text-center text-[15px] text-white/70" data-testid="qq-video-status-dialing">
              正在呼叫…
            </p>
          )}
          {/* 四按钮平行（麦克风/摄像头/挂断/扬声器）；互换画面按钮已删（点小窗互换），翻转移右上角 */}
          <div className="flex w-full items-center justify-between">
            <button
              type="button"
              onClick={call.toggleMute}
              aria-label={muted ? '取消静音' : '静音麦克风'}
              aria-pressed={muted}
              data-testid="qq-video-mic"
              className={`${qqCtl4} ${muted ? 'bg-white/10 text-white/55' : 'bg-white text-black'}`}
            >
              {muted ? <MicOff className="h-6 w-6" strokeWidth={1.9} /> : <Mic className="h-6 w-6" strokeWidth={1.9} />}
            </button>
            <button
              type="button"
              onClick={rt.toggleCam}
              aria-label={rt.camOn ? '关闭摄像头' : '打开摄像头'}
              aria-pressed={rt.camOn}
              data-testid="qq-video-cam"
              className={`${qqCtl4} ${rt.camOn ? 'bg-white/15 text-white' : 'bg-white/10 text-white/50'}`}
            >
              {rt.camOn ? <Video className="h-6 w-6" strokeWidth={1.9} /> : <VideoOff className="h-6 w-6" strokeWidth={1.9} />}
            </button>
            <button type="button" onClick={call.hangup} aria-label="挂断" data-testid="qq-video-hangup" className={`${qqCtl4} bg-[#F5455C] text-white`}>
              <PhoneOff className="h-7 w-7" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={call.toggleSpeaker}
              aria-label={speakerOn ? '关闭扬声器' : '开启扬声器'}
              aria-pressed={speakerOn}
              data-testid="qq-video-speaker"
              className={`${qqCtl4} ${speakerOn ? 'bg-white text-black' : 'bg-white/10 text-white/55'}`}
            >
              {speakerOn ? <Volume2 className="h-6 w-6" strokeWidth={1.9} /> : <VolumeX className="h-6 w-6" strokeWidth={1.9} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 电话 App 皮肤（iOS 黑白灰） ----------------

function PhoneVideoCall(props: VideoCallScreenProps) {
  const rt = useVideoCallRuntime(props);
  const { call, camera } = rt;
  const { phase, seconds, muted, speakerOn } = call;
  const dialing = phase === 'dialing';
  const incoming = phase === 'incoming';

  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-b from-[#3c3c40] via-[#26262a] to-[#0c0c0e]" data-testid="phone-video-screen">
      {dialing ? (
        <LocalFullView
          videoRef={camera.videoRef}
          stream={camera.stream}
          ready={camera.ready}
          denied={camera.denied}
          hint="正在呼叫…"
          mirrored={rt.facing === 'user'}
        />
      ) : rt.swapped ? (
        <>
          <LocalFullView
            videoRef={camera.videoRef}
            stream={camera.stream}
            ready={camera.ready}
            denied={camera.denied}
            hint="摄像头已关"
            mirrored={rt.facing === 'user'}
          />
          {phase === 'active' && (
            <button
              type="button"
              onClick={rt.swapViews}
              aria-label="与我的画面互换"
              data-testid="phone-video-remote-mini"
              className="absolute right-4 top-[104px] z-10 h-[132px] w-[100px] overflow-hidden rounded-[14px] ring-1 ring-white/25"
            >
              <RemoteView avatar={props.avatar} name={props.name} size={100} />
            </button>
          )}
        </>
      ) : (
        <>
          <RemoteView avatar={props.avatar} name={props.name} size={184} />
          {phase === 'active' && (
            <LocalPipView
              videoRef={camera.videoRef}
              live={rt.camOn && camera.ready}
              denied={camera.denied}
              className="right-4 top-[100px] h-[132px] w-[100px] rounded-[14px]"
              testId="phone-video-pip"
              onClick={rt.swapViews}
              mirrored={rt.facing === 'user'}
              height={pipAdaptiveHeight(rt.camSize, 100, 132)}
              onMeta={rt.onVideoMeta}
            />
          )}
        </>
      )}

      <VideoTopBar
        avatar={props.avatar}
        name={props.name}
        phase={phase}
        seconds={seconds}
        statusText={phase === 'active' ? statusLine('active', call.status, 'wx') : null}
        shape="circle"
        testId="phone-video-duration"
      />
      {phase === 'active' && <VideoPipIcon onClick={props.onMinimize} />}

      {incoming && (
        <div className="absolute inset-0 z-10 flex flex-col items-center bg-black/55 backdrop-blur-md">
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8">
            {props.avatar ? (
              <img src={props.avatar} alt="" className="h-[124px] w-[124px] rounded-full object-cover shadow-2xl ring-1 ring-white/20" />
            ) : (
              <DefaultAvatar size={124} shape="circle" className="shadow-2xl ring-1 ring-white/20" />
            )}
            <h1 className="mt-3 max-w-[300px] truncate text-[32px] font-semibold tracking-tight text-white">{props.name}</h1>
            <p className="text-[15px] text-white/60" data-testid="phone-video-status">邀请你视频通话</p>
          </div>
          <div className="flex w-full items-start justify-between px-12 pb-[max(40px,env(safe-area-inset-bottom))]">
            <div className="flex w-[84px] flex-col items-center gap-2">
              <button type="button" onClick={call.reject} aria-label="拒绝" data-testid="phone-video-reject" className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#FF453A] text-white shadow-[0_10px_28px_rgba(255,69,58,0.35)] active:scale-95">
                <PhoneOff className="h-[30px] w-[30px]" strokeWidth={2.1} />
              </button>
              <span className="text-[13px] text-white/90">拒绝</span>
            </div>
            <div className="flex w-[84px] flex-col items-center gap-2">
              <button type="button" onClick={rt.accept} aria-label="接听视频" data-testid="phone-video-accept" className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#30D158] text-white shadow-[0_10px_28px_rgba(48,209,88,0.35)] active:scale-95">
                <Video className="h-[30px] w-[30px]" strokeWidth={2.1} />
              </button>
              <span className="text-[13px] text-white/90">接听</span>
            </div>
          </div>
        </div>
      )}

      {phase === 'active' && (
        <div className="pointer-events-none absolute inset-x-6 bottom-[204px] z-10 flex h-[64px] items-start justify-center overflow-hidden">
          <VideoCaption variant="wx" call={call} />
        </div>
      )}
      {(phase === 'active' || dialing) && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-5 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-8 pb-[max(32px,env(safe-area-inset-bottom))] pt-8">
          {call.error && (
            <p className="text-center text-[12px] text-red-300">{call.error}</p>
          )}
          {phase === 'active' && (
            <div className="flex items-center gap-8">
              <MiniCtl label={muted ? '已静音' : '静音'}>
                <button type="button" onClick={call.toggleMute} aria-label={muted ? '取消静音' : '静音'} aria-pressed={muted} data-testid="phone-video-mic" className={`flex h-[52px] w-[52px] items-center justify-center rounded-full ${muted ? 'bg-white text-black' : 'bg-white/15 text-white'}`}>
                  {muted ? <MicOff className="h-5 w-5" strokeWidth={1.9} /> : <Mic className="h-5 w-5" strokeWidth={1.9} />}
                </button>
              </MiniCtl>
              <MiniCtl label={rt.camOn ? '摄像头开' : '摄像头关'}>
                <button type="button" onClick={rt.toggleCam} aria-label={rt.camOn ? '关闭摄像头' : '打开摄像头'} aria-pressed={rt.camOn} data-testid="phone-video-cam" className={`flex h-[52px] w-[52px] items-center justify-center rounded-full ${rt.camOn ? 'bg-white text-black' : 'bg-white/15 text-white'}`}>
                  {rt.camOn ? <Video className="h-5 w-5" strokeWidth={1.9} /> : <VideoOff className="h-5 w-5" strokeWidth={1.9} />}
                </button>
              </MiniCtl>
              <MiniCtl label="翻转">
                <button type="button" onClick={rt.flipCam} aria-label="翻转摄像头" data-testid="phone-video-flip" className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white/15 text-white">
                  <SwitchCamera className="h-5 w-5" strokeWidth={1.8} />
                </button>
              </MiniCtl>
              <MiniCtl label={speakerOn ? '扬声器开' : '扬声器关'}>
                <button type="button" onClick={call.toggleSpeaker} aria-label={speakerOn ? '关闭扬声器' : '开启扬声器'} aria-pressed={speakerOn} data-testid="phone-video-speaker" className={`flex h-[52px] w-[52px] items-center justify-center rounded-full ${speakerOn ? 'bg-white text-black' : 'bg-white/15 text-white'}`}>
                  {speakerOn ? <Volume2 className="h-5 w-5" strokeWidth={1.9} /> : <VolumeX className="h-5 w-5" strokeWidth={1.9} />}
                </button>
              </MiniCtl>
            </div>
          )}
          {/* 挂断拨号中也显示（此前拨号中无法取消通话） */}
          <button type="button" onClick={call.hangup} aria-label="挂断" data-testid="phone-video-hangup" className="flex h-[70px] w-[70px] items-center justify-center rounded-full bg-[#FF453A] text-white shadow-[0_10px_28px_rgba(255,69,58,0.35)] active:scale-95">
            <PhoneOff className="h-8 w-8" strokeWidth={2} />
          </button>
        </div>
      )}
      {dialing && (
        <p className="absolute inset-x-0 bottom-[190px] z-10 text-center text-[15px] text-white/70" data-testid="phone-video-status-dialing">
          正在呼叫…
        </p>
      )}
    </div>
  );
}

/** 电话皮肤无文字聊天条（iOS 电话语义），字幕恒开 */
function MiniCtl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {children}
      <span className="text-[11px] leading-none text-white/70">{label}</span>
    </div>
  );
}

// ---------------- 出口 ----------------

export default function VideoCallScreen(props: VideoCallScreenProps) {
  const { variant } = props;
  return (
    <div
      className="absolute inset-0 z-[70] overflow-hidden bg-black text-white"
      role="dialog"
      aria-label={`与${props.name}的视频通话`}
      data-testid={`video-screen-${props.variant}`}
    >
      {variant === 'wx' ? <WxVideoCall {...props} /> : variant === 'qq' ? <QqVideoCall {...props} /> : <PhoneVideoCall {...props} />}
    </div>
  );
}
