'use client';

/**
 * 全局语音通话会话（微信 / QQ 共用）：
 *
 * 把「正在进行的通话」从聊天页组件中解耦出来，由本模块（页面之外的全局单例）持有：
 *
 * 1. 宿主（微信/QQ 聊天页）用 start() 发起通话（携带联系人/方向/上下文快照与 onEnd 回调），
 *    全屏通话页由 PhoneShell 挂载的 GlobalCallLayer 渲染 —— 退出聊天页 / 退出 App /
 *    打开别的 App 都不会卸载通话引擎，电话不断（全局化）；
 * 2. 通话中点左上角小窗图标 minimize()：全屏页隐藏（组件保持挂载，引擎不停），悬浮小窗
 *    （PiP）出现在屏幕上；点小窗 expand() 回到全屏通话页；
 * 3. 小窗可拖动；拖到屏幕左右边缘 dock() 后只露一条边缘（edge sliver），点边缘 undock()
 *    恢复完整小窗，再点小窗进全屏通话页；
 * 4. 通话结束（恰好一次）：引擎回调 onEnd —— 宿主在回调里用各自的 loadMsgs/saveMsgs
 *    直写通话卡片（聊天页卸载了也能落盘），随后 close() 清理会话；
 * 5. 通话秒数总线：引擎每秒 reportCallSeconds 上报，悬浮小窗订阅显示实时时长
 *    （小窗与全屏页是两个组件，时长经此共享）。
 */

import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { ContactRecord } from '@/lib/contacts';
import type { ChatCallResult, ChatCallTurnMsg } from './chat-call';

/** 一次全局通话的完整入参（宿主发起时一次性快照） */
export interface GlobalCallSession {
  variant: 'wx' | 'qq';
  name: string;
  avatar: string | null;
  contact: ContactRecord | null;
  direction: 'out' | 'in';
  /** 进入通话时携带的最近聊天上下文（宿主按会话消息归并） */
  initialHistory: ChatCallTurnMsg[];
  /** 记忆召回快照（发起时；兑底用） */
  memoryBlock?: string;
  /** 每轮动态召回记忆（宿主组装；引擎以「用户刚说的话」逐轮调用，优先于 memoryBlock） */
  memoryBlockFn?: (userText: string | null) => string | undefined;
  /** 世界书块（宿主 collectWbBlocks 组装；随人设注入 turn API） */
  worldbookBlock?: string;
  momentsBlock?: string;
  timeBlock?: string;
  /** 位置感知块（与文字聊天同一套 buildLocationBlock）：通话里 AI 知道“用户在哪” */
  locBlock?: string;
  multiApp?: boolean;
  /** 通话结束（恰好一次）：宿主直写通话卡片并落盘，随后全局层自动 close() */
  onEnd: (r: ChatCallResult) => void;
}

interface GlobalCallState {
  session: GlobalCallSession | null;
  /** 会话序号：每次 start 递增，VoiceCallScreen 用 key 重挂载新通话 */
  seq: number;
  /** full=全屏通话页 / pip=悬浮小窗（小窗被推到边缘时只露一条边） */
  view: 'full' | 'pip';
  pipDocked: boolean;
  pipSide: 'left' | 'right';
  /** 小窗位置（相对手机壳左上角；null=未初始化，首次显示时按壳尺寸摆到右上） */
  pipPos: { x: number; y: number } | null;
  start: (s: GlobalCallSession) => void;
  minimize: () => void;
  expand: () => void;
  dock: (side: 'left' | 'right') => void;
  undock: () => void;
  setPipPos: (p: { x: number; y: number }) => void;
  close: () => void;
}

export const useGlobalCall = create<GlobalCallState>()((set) => ({
  session: null,
  seq: 0,
  view: 'full',
  pipDocked: false,
  pipSide: 'right',
  pipPos: null,
  start: (s) =>
    set((prev) => ({
      session: s,
      seq: prev.seq + 1,
      view: 'full',
      pipDocked: false,
      pipPos: null,
    })),
  minimize: () => set({ view: 'pip', pipDocked: false }),
  expand: () => set({ view: 'full' }),
  dock: (side) => set({ pipDocked: true, pipSide: side }),
  undock: () => set({ pipDocked: false }),
  setPipPos: (p) => set({ pipPos: p }),
  close: () => {
    reportCallSeconds(0);
    set({ session: null, view: 'full', pipDocked: false, pipPos: null });
  },
}));

/** 发起一次全局通话（宿主入口；已有会话时直接替换为新一轮通话） */
export function startGlobalCall(session: GlobalCallSession): void {
  useGlobalCall.getState().start(session);
}

// ---------------- 通话秒数总线（引擎 → 悬浮小窗） ----------------

let callSeconds = 0;
const secondsSubs = new Set<() => void>();

/** 通话引擎每秒上报接通秒数（小窗订阅显示；close/start 时归零） */
export function reportCallSeconds(s: number): void {
  if (callSeconds === s) return;
  callSeconds = s;
  secondsSubs.forEach((fn) => fn());
}

function subscribeCallSeconds(fn: () => void): () => void {
  secondsSubs.add(fn);
  return () => {
    secondsSubs.delete(fn);
  };
}

/** 订阅通话实时秒数（SSR 快照 0） */
export function useCallSeconds(): number {
  return useSyncExternalStore(
    subscribeCallSeconds,
    () => callSeconds,
    () => 0,
  );
}
