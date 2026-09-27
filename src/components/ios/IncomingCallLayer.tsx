'use client';

/**
 * 全局来电层（PhoneShell 挂载，覆盖所有 App / 主屏幕 / 锁屏）：
 *
 * - 顶部来电弹窗（z-[94]，对照用户截图）：
 *   · 电话来电 = iOS 胶囊（黑色胶囊：头像+名字+红色拒接+绿色接听）；
 *   · 微信语音来电 = 微信大窗（深色圆角卡：头像+名字+「邀请你语音通话...」+忽略+拒接/接听），
 *     显示 5 秒后自动缩成同款胶囊小窗继续响铃；QQ 来电无弹窗（不经过本模块）；
 *   · 弹窗上的接听/忽略按钮直接操作：电话走来电快照回调；微信经全局通话引擎转发
 *     （useGlobalCall.engine.accept / reject → 页内 WxCallScreen 的 accept/reject）；
 * - iOS 全屏来电界面（z-[84]，仅电话来电渲染；对照第二张截图）：深灰渐变背景 + 右上 ⓘ +
 *   头像/名字/「语音通话邀请…」+ 信息/提醒我 + 拒绝/接听大圆钮；
 *   微信语音来电的全屏界面由现有全局通话层（WxCallScreen incoming 态）承担；
 * - 自动跳转：AI 来电触发即渲染全屏来电界面（电话）/ 全局通话层已是全屏（微信）——
 *   不管在哪个 App、哪个界面都会被来电界面覆盖；
 * - 电话来电响铃 25 秒无人处理 → 超时未接（onMissed('timeout')：落未接记录 + AI 语音留言）。
 */

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, BellOff, Info, MessageCircle, Phone, PhoneOff } from 'lucide-react';
import { useGlobalCall } from '@/lib/ios/global-call';
import {
  startIncomingRing,
  stopIncomingRing,
  useIncomingCall,
  type IncomingCallSnapshot,
} from '@/lib/ios/incoming-call';

// iOS 全屏来电页较重，按需加载（无来电不进包）
const IncomingCallScreen = dynamic(() => Promise.resolve(IncomingCallScreenImpl), { ssr: false });

export default function IncomingCallLayer() {
  const call = useIncomingCall((s) => s.call);
  const enginePhase = useGlobalCall((s) => s.enginePhase);
  const hasWxSession = useGlobalCall((s) => s.session !== null);
  const isPhone = call?.source === 'phone';
  const isWx = call?.source === 'wx';
  // 微信弹窗只在页内引擎处于「来电响铃」阶段显示（接通/结束后随引擎阶段消失）
  const wxRinging = isWx && enginePhase === 'incoming';

  // 电话来电：铃声循环 + 25 秒响铃超时（微信铃声/超时由页内引擎自理）
  useEffect(() => {
    if (!isPhone) return;
    startIncomingRing();
    const timer = window.setTimeout(() => {
      useIncomingCall.getState().dismiss('timeout');
    }, 25000);
    return () => {
      stopIncomingRing();
      window.clearTimeout(timer);
    };
  }, [isPhone, call?.id]);

  // 微信来电：大窗 5 秒后自动缩成胶囊小窗（响铃继续，直至接听/忽略/超时）
  useEffect(() => {
    if (!isWx || call?.bannerStage !== 'big') return;
    const timer = window.setTimeout(() => {
      useIncomingCall.getState().setStage('pill');
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [isWx, call?.id, call?.bannerStage]);

  // 微信来电收尾兜底：页内引擎超时未接（missed-in）会关闭全局会话——
  // 会话消失（session=null）时若弹窗还挂着就同步清掉
  useEffect(() => {
    if (!isWx || hasWxSession) return;
    useIncomingCall.getState().clear();
  }, [isWx, hasWxSession]);

  const showBanner = isPhone || wxRinging;

  return (
    <>
      <AnimatePresence>{showBanner && call ? <CallBanner key={call.id} call={call} /> : null}</AnimatePresence>
      {isPhone && call ? <IncomingCallScreen call={call} /> : null}
    </>
  );
}

// ---------------- 顶部来电弹窗（胶囊 / 微信大窗） ----------------

function CallBanner({ call }: { call: IncomingCallSnapshot }) {
  const big = call.source === 'wx' && call.bannerStage === 'big';

  /** 接听：电话走快照回调（打开电话 App 进通话）；微信代理到页内引擎 accept */
  const answer = () => {
    if (call.source === 'wx') {
      useGlobalCall.getState().engine?.accept();
      return;
    }
    useIncomingCall.getState().answer();
  };
  /** 拒绝/忽略：电话走快照回调（落未接记录+留言）；微信代理到页内引擎 reject */
  const decline = () => {
    if (call.source === 'wx') {
      useGlobalCall.getState().engine?.reject();
      return;
    }
    useIncomingCall.getState().dismiss('declined');
  };

  if (big) {
    // 微信大窗（对照第三张截图）：深色圆角卡 + 头像/名字/邀请文案 + 忽略 + 拒接/接听
    return (
      <motion.div
        initial={{ y: -76, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -76, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="pointer-events-auto absolute left-1/2 top-[58px] z-[94] w-[344px] -translate-x-1/2 rounded-[22px] bg-[#1c1c1e]/95 pb-3 pt-3.5 shadow-[0_18px_44px_rgba(0,0,0,0.5)] ring-1 ring-white/10 backdrop-blur-xl"
        role="alertdialog"
        aria-label={`微信语音通话邀请：${call.name}`}
        data-testid="incoming-banner-wx-big"
      >
        <div className="flex items-center gap-3 px-4">
          <BannerAvatar name={call.name} avatar={call.avatar} wx />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold leading-[22px] text-white">{call.name}</div>
            <div className="mt-0.5 text-[13px] leading-[18px] text-white/50">邀请你语音通话...</div>
          </div>
        </div>
        <div className="mt-3.5 flex items-center justify-between pl-5 pr-4">
          <button
            type="button"
            onClick={decline}
            aria-label="忽略"
            data-testid="incoming-ignore"
            className="flex h-[44px] items-center gap-1.5 rounded-full bg-white/10 pl-4 pr-5 text-[15px] text-white active:bg-white/15"
          >
            <BellOff className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden="true" />
            忽略
          </button>
          <div className="flex items-center gap-3">
            <CircleBtn tone="red" onClick={decline} label="拒绝" />
            <CircleBtn tone="green" onClick={answer} label="接听" />
          </div>
        </div>
      </motion.div>
    );
  }

  // 胶囊弹窗（对照第一张截图左：响铃态）：黑色胶囊 + 头像 + 名字 + 拒接/接听
  return (
    <motion.div
      initial={{ y: -64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -64, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className="pointer-events-auto absolute left-1/2 top-[56px] z-[94] flex h-[56px] -translate-x-1/2 items-center gap-2.5 rounded-full bg-black/92 pl-2.5 pr-2 shadow-[0_14px_36px_rgba(0,0,0,0.45)] ring-1 ring-white/10 backdrop-blur-xl"
      role="alertdialog"
      aria-label={`来电：${call.name}`}
      data-testid="incoming-banner-pill"
      onClick={answer}
    >
      <BannerAvatar name={call.name} avatar={call.avatar} />
      <span className="max-w-[104px] truncate text-[15px] font-medium leading-none text-white">{call.name}</span>
      <div className="flex items-center gap-1.5">
        <CircleBtn tone="red" onClick={decline} label="拒绝" testId="incoming-pill-reject" />
        <CircleBtn tone="green" onClick={answer} label="接听" testId="incoming-pill-accept" />
      </div>
    </motion.div>
  );
}

/** 弹窗头像（微信大窗用白色圆角方形+外圈，胶囊用圆形） */
function BannerAvatar({ name, avatar, wx = false }: { name: string; avatar: string | null; wx?: boolean }) {
  if (avatar) {
    return (
      <img
        src={avatar}
        alt=""
        draggable={false}
        className={`h-[40px] w-[40px] shrink-0 object-cover ring-1 ring-white/20 ${wx ? 'rounded-[10px] p-0' : 'rounded-full'}`}
      />
    );
  }
  return (
    <div
      className={`flex h-[40px] w-[40px] shrink-0 items-center justify-center bg-white/15 text-[16px] font-medium text-white ring-1 ring-white/20 ${
        wx ? 'rounded-[10px]' : 'rounded-full'
      }`}
    >
      {name.slice(0, 1)}
    </div>
  );
}

/** 弹窗圆形按钮（红色拒接 / 绿色接听，44px） */
function CircleBtn({
  tone,
  onClick,
  label,
  testId,
}: {
  tone: 'red' | 'green';
  onClick: () => void;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      data-testid={testId}
      className={`flex h-[44px] w-[44px] items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-[0.92] ${
        tone === 'red' ? 'bg-[#FF453A]' : 'bg-[#30D158]'
      }`}
    >
      {tone === 'red' ? (
        <PhoneOff className="h-[19px] w-[19px]" strokeWidth={2.2} aria-hidden="true" />
      ) : (
        <Phone className="h-[19px] w-[19px]" strokeWidth={2.2} aria-hidden="true" />
      )}
    </button>
  );
}

// ---------------- iOS 全屏来电界面（电话来电；对照第二张截图） ----------------

function IncomingCallScreenImpl({ call }: { call: IncomingCallSnapshot }) {
  const answer = () => useIncomingCall.getState().answer();
  const decline = () => useIncomingCall.getState().dismiss('declined');
  /** 「信息」：挂断来电并打开信息 App（iOS 语义：改用短信回复） */
  const replyBySms = () => {
    decline();
    try {
      import('@/lib/ios/store').then(({ useUI }) => useUI.getState().openApp('chat'));
    } catch {
      // 打开失败不影响挂断
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      className="pointer-events-auto absolute inset-0 z-[84] flex flex-col overflow-hidden bg-gradient-to-b from-[#4a4a4e] via-[#333336] to-[#1c1c1e] text-white"
      role="dialog"
      aria-label={`来自${call.name}的电话`}
      data-testid="incoming-call-screen"
    >
      {/* 状态栏预留 + 右上信息角标 */}
      <div className="relative pt-[64px]">
        <button
          type="button"
          aria-label="通话信息"
          className="absolute right-5 top-[70px] flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-white/35 active:bg-white/10"
          onClick={(e) => e.preventDefault()}
          tabIndex={-1}
        >
          <Info className="h-[18px] w-[18px] text-white/70" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      {/* 来电人信息（头像 + 「主号」标签 + 名字 + 邀请文案） */}
      <div className="flex flex-1 flex-col items-center justify-start px-8 pt-2">
        <div className="flex h-[124px] w-[124px] items-center justify-center overflow-hidden rounded-full bg-white/15 text-[44px] font-light shadow-2xl ring-1 ring-white/20">
          {call.avatar ? (
            <img src={call.avatar} alt="" draggable={false} className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden="true">{call.name.slice(0, 1)}</span>
          )}
        </div>
        <div className="mt-4 flex items-center gap-1.5">
          <span className="rounded-[5px] bg-black/35 px-1.5 py-0.5 text-[11px] font-medium leading-none text-white/85 ring-1 ring-white/25">
            主号
          </span>
          <span className="text-[13px] leading-none text-white/55">手机来电</span>
        </div>
        <h1 className="mt-1.5 max-w-full truncate text-[38px] font-semibold leading-[46px] tracking-tight">
          {call.name}
        </h1>
        <p className="mt-1 text-[16px] text-white/60">语音通话邀请…</p>
      </div>

      {/* 底部操作区：信息/提醒我 + 拒绝/接听 */}
      <div className="px-10 pb-[44px]">
        <div className="flex items-start justify-between">
          <RoundAction
            icon={<MessageCircle className="h-[24px] w-[24px] text-white" strokeWidth={1.9} aria-hidden="true" />}
            label="信息"
            onClick={replyBySms}
          />
          <RoundAction
            icon={<Bell className="h-[24px] w-[24px] text-white" strokeWidth={1.9} aria-hidden="true" />}
            label="提醒我"
            onClick={decline}
          />
        </div>
        <div className="mt-8 flex items-start justify-between">
          <RoundAction
            icon={<PhoneOff className="h-[30px] w-[30px] text-white" strokeWidth={2.1} aria-hidden="true" />}
            label="拒绝"
            tone="red"
            size="lg"
            onClick={decline}
            testId="incoming-screen-reject"
          />
          <RoundAction
            icon={<Phone className="h-[30px] w-[30px] text-white" strokeWidth={2.1} aria-hidden="true" />}
            label="接听"
            tone="green"
            size="lg"
            onClick={answer}
            testId="incoming-screen-accept"
          />
        </div>
      </div>
    </motion.div>
  );
}

/** 来电界面圆形操作钮（信息/提醒我 = 64px 半透明；拒绝/接听 = 76px 红/绿） */
function RoundAction({
  icon,
  label,
  onClick,
  tone = 'plain',
  size = 'md',
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'plain' | 'red' | 'green';
  size?: 'md' | 'lg';
  testId?: string;
}) {
  const sizeCls = size === 'lg' ? 'h-[76px] w-[76px]' : 'h-[64px] w-[64px]';
  const toneCls =
    tone === 'red' ? 'bg-[#FF453A] shadow-[0_10px_28px_rgba(255,69,58,0.35)]' : tone === 'green' ? 'bg-[#30D158] shadow-[0_10px_28px_rgba(48,209,88,0.35)]' : 'bg-white/15';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
      className="flex w-[84px] flex-col items-center gap-1.5 outline-none"
    >
      <span
        className={`flex ${sizeCls} items-center justify-center rounded-full transition-transform active:scale-90 ${toneCls}`}
      >
        {icon}
      </span>
      <span className="text-[13px] text-white/90">{label}</span>
    </button>
  );
}
