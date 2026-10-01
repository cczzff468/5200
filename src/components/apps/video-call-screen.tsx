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
 *   对方头像+名字+状态叠在前；来电响铃：全屏来电页（头像+邀请你视频通话+拒绝/视频接听）；
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
  PhoneOff,
  PictureInPicture2,
  RefreshCcw,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { DefaultAvatar } from './default-avatar';
import { CaptionStream, InlineCallChat } from './voice-call-screen';
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
  const toggleCam = () => {
    setCamOn((on) => {
      camOnRef.current = !on;
      if (on) latestVisionRef.current = ''; // 关摄像头即刻清描述：AI 下一轮起不再注入【用户画面】
      return !on;
    });
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
    toggleCam,
    flipCam,
    swapViews,
    swapped,
    camOn,
    camera,
    facing,
    visionCfgReady,
  };
}

type Runtime = ReturnType<typeof useVideoCallRuntime>;

/** 对方（AI 角色）动态画面：头像 Ken Burns 缓慢缩放 + 深色渐晕背景（AI 无真人视频，动态头像模拟） */
function RemoteView({ avatar, name, size }: { avatar: string | null; name: string; size: number }) {
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
          style={{ width: size, height: size, borderRadius: size / 2 }}
        >
          {avatar ? (
            <img src={avatar} alt={`${name}的画面`} className="h-full w-full object-cover" />
          ) : (
            <DefaultAvatar size={size} shape="circle" className="h-full w-full" />
          )}
        </motion.div>
      </div>
    </div>
  );
}

/** 我方画面（用户摄像头全屏，拨号中主画面用；无流时黑底+提示；基础量拆开传防 ref 容器对象渲染期访问） */
function LocalFullView({
  videoRef,
  ready,
  denied,
  name,
  hint,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  ready: boolean;
  denied: boolean;
  name: string;
  hint: string;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {ready ? (
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" aria-label="我的摄像头画面" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#111114]">
          <VideoOff className="h-9 w-9 text-white/30" strokeWidth={1.6} aria-hidden="true" />
          <p className="text-[13px] text-white/45">{denied ? '摄像头不可用，已为你隐藏画面' : hint}</p>
        </div>
      )}
      {/* 名字水印（对方看到的是对方的界面；此处为用户全屏自看时的水印） */}
      <p className="absolute bottom-[calc(env(safe-area-inset-bottom)+120px)] left-1/2 -translate-x-1/2 text-[12px] text-white/40">{name}（你）</p>
    </div>
  );
}

/** 我方小窗（用户摄像头 PIP；关/拒绝时占位；基础量拆开传防 ref 容器对象渲染期访问） */
function LocalPipView({
  videoRef,
  live,
  denied,
  className,
  testId,
  onClick,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  live: boolean;
  denied: boolean;
  className: string;
  testId: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={live ? '我的画面，点击与对方画面互换' : '我的画面（摄像头已关）'}
      data-testid={testId}
      onClick={onClick}
      className={`absolute z-10 overflow-hidden ring-1 ring-white/25 shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-transform active:scale-95 ${className}`}
    >
      {live ? (
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[#1b1b1f]">
          <VideoOff className="h-4 w-4 text-white/35" strokeWidth={1.8} aria-hidden="true" />
          <span className="text-[10px] leading-none text-white/40">{denied ? '摄像头不可用' : '摄像头已关'}</span>
        </span>
      )}
    </button>
  );
}

/** 视频通话页顶部信息（名字 + 接通后时长） */
function VideoTopBar({ name, phase, seconds, testId }: { name: string; phase: string; seconds: number; testId: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[54px] z-10 flex flex-col items-center gap-0.5">
      <span className="max-w-[240px] truncate text-[17px] font-medium text-white/95 drop-shadow">{name}</span>
      {phase === 'active' && (
        <span className="text-[14px] tabular-nums text-white/75 drop-shadow" data-testid={testId}>
          {formatCallDuration(seconds)}
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

/** 通话字幕（单句，叠在底部控制区上方；复用语音同款 CaptionStream） */
function VideoCaption({ variant, call }: { variant: 'wx' | 'qq'; call: ChatCallApi }) {
  return (
    <div className="pointer-events-none absolute inset-x-6 bottom-[218px] z-10 flex max-h-[64px] items-start justify-center overflow-hidden">
      <CaptionStream variant={variant} call={call} />
    </div>
  );
}

// ---------------- 微信皮肤 ----------------

function WxVideoCall(props: VideoCallScreenProps) {
  const rt = useVideoCallRuntime(props);
  const { call, camera } = rt;
  const { phase, seconds, muted, speakerOn } = call;
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
  const flipBtn = (
    <button
      type="button"
      onClick={rt.flipCam}
      aria-label="翻转摄像头（前后置切换）"
      data-testid="wx-video-flip"
      className={`${wxRound} bg-white/10 text-white`}
    >
      <SwitchCamera className="h-6 w-6" strokeWidth={1.8} />
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
      {/* 画面层：拨号中主画面=我方摄像头（对照微信真实行为）；来电/接通主画面=对方动态画面，小窗=我方 */}
      {dialing ? (
        <LocalFullView videoRef={camera.videoRef} ready={camera.ready} denied={camera.denied} name={props.name} hint="正在等待对方接受视频邀请…" />
      ) : rt.swapped ? (
        <>
          <LocalFullView videoRef={camera.videoRef} ready={camera.ready} denied={camera.denied} name={props.name} hint="摄像头已关" />
          {phase === 'active' && (
            <button
              type="button"
              onClick={rt.swapViews}
              aria-label="与我的画面互换"
              data-testid="wx-video-remote-mini"
              className="absolute right-4 top-[112px] z-10 h-[128px] w-[92px] overflow-hidden rounded-[14px] ring-1 ring-white/25 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
            >
              <RemoteView avatar={props.avatar} name={props.name} size={128} />
            </button>
          )}
        </>
      ) : (
        <>
          <RemoteView avatar={props.avatar} name={props.name} size={Math.min(260, 236)} />
          {phase === 'active' && (
            <LocalPipView
              videoRef={camera.videoRef}
              live={rt.camOn && camera.ready}
              denied={camera.denied}
              className="right-4 top-[108px] h-[136px] w-[96px] rounded-[14px]"
              testId="wx-video-pip"
              onClick={rt.swapViews}
            />
          )}
        </>
      )}

      {/* 顶部信息 + 小窗/文字聊天入口 */}
      <VideoTopBar name={props.name} phase={phase} seconds={seconds} testId="wx-video-duration" />
      {phase === 'active' && (
        <>
          <VideoPipIcon onClick={props.onMinimize} />
          <button
            type="button"
            aria-label="发消息"
            aria-pressed={textChatOpen}
            data-testid="wx-video-textchat-btn"
            onClick={toggleTextChat}
            className="absolute right-5 top-[58px] z-20 flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
          >
            <MessageSquare className="h-5 w-5" strokeWidth={1.8} />
          </button>
        </>
      )}

      {/* 来电页（对照截图 3：暗底 + 头像 + 邀请你视频通话 + 拒绝/视频接听） */}
      {incoming && (
        <div className="absolute inset-0 z-10 flex flex-col items-center bg-[#0e0e11]/92 backdrop-blur-sm">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-6">
            <div className="relative mt-10">
              <span className="absolute inset-0 animate-ping rounded-[18px] bg-white/10" aria-hidden="true" />
              {props.avatar ? (
                <img src={props.avatar} alt="" className="h-[104px] w-[104px] rounded-[18px] object-cover shadow-2xl ring-1 ring-white/15" />
              ) : (
                <DefaultAvatar size={104} shape="square" className="rounded-[18px] shadow-2xl ring-1 ring-white/15" />
              )}
            </div>
            <h2 className="mt-2 max-w-[280px] truncate text-[22px] font-medium text-white">{props.name}</h2>
            <p className="text-[14px] text-white/60" data-testid="wx-video-status">邀请你视频通话</p>
          </div>
          <div className="flex w-full items-start justify-between px-14 pb-[max(36px,env(safe-area-inset-bottom))]">
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={call.reject} aria-label="拒绝" data-testid="wx-video-reject" className="flex h-[74px] w-[74px] items-center justify-center rounded-full bg-[#FA5151] text-white">
                <PhoneOff className="h-8 w-8" strokeWidth={2} />
              </button>
              <span className="text-[13px] text-white/85">拒绝</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={rt.accept} aria-label="接听视频" data-testid="wx-video-accept" className="flex h-[74px] w-[74px] items-center justify-center rounded-full bg-[#07C160] text-white">
                <Video className="h-8 w-8" strokeWidth={2} />
              </button>
              <span className="text-[13px] text-white/85">接听</span>
            </div>
          </div>
        </div>
      )}

      {/* 接通后字幕 + 文字聊天条 + 底部控制 */}
      {phase === 'active' && !textChatOpen && <VideoCaption variant="wx" call={call} />}
      {textChatOpen && phase === 'active' && (
        <div className="absolute inset-x-4 bottom-[196px] z-20">
          <InlineCallChat variant="wx" call={call} />
        </div>
      )}
      {(phase === 'active' || dialing) && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-4 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-8 pb-[max(30px,env(safe-area-inset-bottom))] pt-8">
          {phase === 'active' && (
            <div className="flex items-start justify-center gap-10">
              <Ctl label={muted ? '麦克风已关' : '麦克风已开'}>{micBtn}</Ctl>
              <Ctl label={speakerOn ? '扬声器已开' : '扬声器已关'}>{speakerBtn}</Ctl>
              <Ctl label={rt.camOn ? '摄像头已开' : '摄像头已关'}>{camBtn}</Ctl>
            </div>
          )}
          <div className="flex items-center gap-14">
            {phase === 'active' && <Ctl label="翻转">{flipBtn}</Ctl>}
            {hangupBtn}
            {phase === 'active' && <Ctl label="互换画面">{swapBtn(rt.swapViews, 'wx-video-swap')}</Ctl>}
          </div>
          {phase === 'active' && !muted && (
            <p className="text-[11px] text-white/40">免提自动对话 · 直接说话即可</p>
          )}
        </div>
      )}
      {/* 拨号中状态行（等待对方接受邀请） */}
      {dialing && (
        <p className="absolute inset-x-0 bottom-[190px] z-10 text-center text-[15px] text-white/70" data-testid="wx-video-status-dialing">
          等待对方接受邀请
        </p>
      )}
      {call.error && phase !== 'ended' && (
        <p className="absolute inset-x-8 bottom-[168px] z-20 text-center text-[12px] text-red-300">{call.error}</p>
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

function swapBtn(onClick: () => void, testId: string) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="互换大小窗画面"
      data-testid={testId}
      className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-white/10 text-white transition-colors active:opacity-70"
    >
      <RefreshCcw className="h-6 w-6" strokeWidth={1.8} />
    </button>
  );
}

// ---------------- QQ 皮肤 ----------------

function QqVideoCall(props: VideoCallScreenProps) {
  const rt = useVideoCallRuntime(props);
  const { call, camera } = rt;
  const { phase, seconds, muted, speakerOn } = call;
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
  const toggleTextChat = () => (textChatOpen ? closeTextChat() : openTextChat());

  const dialing = phase === 'dialing';
  const incoming = phase === 'incoming';
  const qqSquare = 'flex h-[72px] w-[72px] items-center justify-center rounded-[26px] transition-colors active:opacity-70';
  const smallSquare = 'flex h-[52px] w-[52px] items-center justify-center rounded-[18px] transition-colors active:opacity-70';

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#050506]" data-testid="qq-video-screen">
      {/* 画面层：主画面=对方；小窗（QQ 在左上，对照截图 5）=我方 */}
      {dialing ? (
        <LocalFullView videoRef={camera.videoRef} ready={camera.ready} denied={camera.denied} name={props.name} hint="正在呼叫…" />
      ) : rt.swapped ? (
        <>
          <LocalFullView videoRef={camera.videoRef} ready={camera.ready} denied={camera.denied} name={props.name} hint="摄像头已关" />
          {phase === 'active' && (
            <button
              type="button"
              onClick={rt.swapViews}
              aria-label="与我的画面互换"
              data-testid="qq-video-remote-mini"
              className="absolute right-4 top-[104px] z-10 h-[128px] w-[92px] overflow-hidden rounded-[14px] ring-1 ring-white/25"
            >
              <RemoteView avatar={props.avatar} name={props.name} size={128} />
            </button>
          )}
        </>
      ) : (
        <>
          <RemoteView avatar={props.avatar} name={props.name} size={Math.min(260, 236)} />
          {phase === 'active' && (
            <LocalPipView
              videoRef={camera.videoRef}
              live={rt.camOn && camera.ready}
              denied={camera.denied}
              className="left-4 top-[100px] h-[132px] w-[92px] rounded-[14px]"
              testId="qq-video-pip"
              onClick={rt.swapViews}
            />
          )}
        </>
      )}

      <VideoTopBar name={props.name} phase={phase} seconds={seconds} testId="qq-video-duration" />
      {phase === 'active' && (
        <>
          <VideoPipIcon onClick={props.onMinimize} />
          <button
            type="button"
            aria-label="发消息"
            aria-pressed={textChatOpen}
            data-testid="qq-video-textchat-btn"
            onClick={toggleTextChat}
            className="absolute right-5 top-[58px] z-20 flex h-10 w-10 items-center justify-center rounded-[12px] bg-black/35 text-white/85 backdrop-blur-sm transition-colors active:opacity-60"
          >
            <MessageSquare className="h-5 w-5" strokeWidth={1.8} />
          </button>
        </>
      )}

      {/* 来电页（对照截图 4：黑底圆形大头像 + 邀请你视频通话 + 消息回复 + 红拒绝/绿视频接听方钮） */}
      {incoming && (
        <div className="absolute inset-0 z-10 flex flex-col items-center bg-[#050506]/94">
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8">
            <div className="relative mt-8">
              <span className="absolute inset-0 animate-ping rounded-full bg-white/10" aria-hidden="true" />
              {props.avatar ? (
                <img src={props.avatar} alt="" className="h-[132px] w-[132px] rounded-full object-cover shadow-2xl ring-1 ring-white/15" />
              ) : (
                <DefaultAvatar size={132} shape="circle" className="shadow-2xl ring-1 ring-white/15" />
              )}
            </div>
            <h2 className="mt-3 max-w-[280px] truncate text-[24px] font-normal text-white">{props.name}</h2>
            <p className="text-[15px] text-white/60" data-testid="qq-video-status">邀请你视频通话</p>
          </div>
          <div className="flex w-full flex-col px-10 pb-[max(40px,env(safe-area-inset-bottom))]">
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
            <div className="flex items-center justify-between">
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

      {/* 接通后：字幕 + 文字聊天条 + 控制区（QQ 时长在按钮上方，对照截图 5） */}
      {phase === 'active' && !textChatOpen && <VideoCaption variant="qq" call={call} />}
      {textChatOpen && phase === 'active' && (
        <div className="absolute inset-x-4 bottom-[210px] z-20">
          <InlineCallChat variant="qq" call={call} />
        </div>
      )}
      {phase === 'active' && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-5 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-6 pb-[max(28px,env(safe-area-inset-bottom))] pt-8">
          <div className="flex items-center gap-8">
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
            <button type="button" onClick={rt.flipCam} aria-label="翻转摄像头" data-testid="qq-video-flip" className={`${smallSquare} bg-white/10 text-white`}>
              <SwitchCamera className="h-5 w-5" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={rt.swapViews}
              aria-label="互换大小窗画面"
              data-testid="qq-video-swap"
              className={`${smallSquare} bg-white/10 text-white`}
            >
              <RefreshCcw className="h-5 w-5" strokeWidth={1.8} />
            </button>
          </div>
          <div className="text-center text-[17px] tabular-nums text-white/85" data-testid="qq-video-duration-lower">
            {formatCallDuration(seconds)}
          </div>
          <div className="flex w-full items-center justify-center gap-12">
            <button
              type="button"
              onClick={call.toggleMute}
              aria-label={muted ? '取消静音' : '静音麦克风'}
              aria-pressed={muted}
              data-testid="qq-video-mic"
              className={`${qqSquare} ${muted ? 'bg-white/10 text-white/55' : 'bg-white text-black'}`}
            >
              {muted ? <MicOff className="h-7 w-7" strokeWidth={1.9} /> : <Mic className="h-7 w-7" strokeWidth={1.9} />}
            </button>
            <button type="button" onClick={call.hangup} aria-label="挂断" data-testid="qq-video-hangup" className={`${qqSquare} bg-[#F5455C] text-white`}>
              <PhoneOff className="h-8 w-8" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={call.toggleSpeaker}
              aria-label={speakerOn ? '关闭扬声器' : '开启扬声器'}
              aria-pressed={speakerOn}
              data-testid="qq-video-speaker"
              className={`${qqSquare} ${speakerOn ? 'bg-white text-black' : 'bg-white/10 text-white/55'}`}
            >
              {speakerOn ? <Volume2 className="h-7 w-7" strokeWidth={1.9} /> : <VolumeX className="h-7 w-7" strokeWidth={1.9} />}
            </button>
          </div>
        </div>
      )}
      {dialing && (
        <p className="absolute inset-x-0 bottom-[190px] z-10 text-center text-[15px] text-white/70" data-testid="qq-video-status-dialing">
          正在呼叫…
        </p>
      )}
      {call.error && phase !== 'ended' && (
        <p className="absolute inset-x-8 bottom-[168px] z-20 text-center text-[12px] text-red-300">{call.error}</p>
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
        <LocalFullView videoRef={camera.videoRef} ready={camera.ready} denied={camera.denied} name={props.name} hint="正在呼叫…" />
      ) : rt.swapped ? (
        <>
          <LocalFullView videoRef={camera.videoRef} ready={camera.ready} denied={camera.denied} name={props.name} hint="摄像头已关" />
          {phase === 'active' && (
            <button
              type="button"
              onClick={rt.swapViews}
              aria-label="与我的画面互换"
              data-testid="phone-video-remote-mini"
              className="absolute right-4 top-[104px] z-10 h-[128px] w-[92px] overflow-hidden rounded-[14px] ring-1 ring-white/25"
            >
              <RemoteView avatar={props.avatar} name={props.name} size={128} />
            </button>
          )}
        </>
      ) : (
        <>
          <RemoteView avatar={props.avatar} name={props.name} size={Math.min(260, 236)} />
          {phase === 'active' && (
            <LocalPipView
              videoRef={camera.videoRef}
              live={rt.camOn && camera.ready}
              denied={camera.denied}
              className="right-4 top-[100px] h-[132px] w-[92px] rounded-[14px]"
              testId="phone-video-pip"
              onClick={rt.swapViews}
            />
          )}
        </>
      )}

      <VideoTopBar name={props.name} phase={phase} seconds={seconds} testId="phone-video-duration" />
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

      {phase === 'active' && <VideoCaption variant="wx" call={call} />}
      {phase === 'active' && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-5 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-8 pb-[max(32px,env(safe-area-inset-bottom))] pt-8">
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
      {call.error && phase !== 'ended' && (
        <p className="absolute inset-x-8 bottom-[168px] z-20 text-center text-[12px] text-red-300">{call.error}</p>
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
