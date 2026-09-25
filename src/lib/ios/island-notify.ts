'use client';

/**
 * 全局灵动岛弹窗通知（模拟 iOS 灵动岛通知；微信 / QQ / 信息，单聊群聊共用）。
 *
 * 设计要点：
 * 1. 触发：AI 每落盘一条聊天消息（单聊 / 群聊 / 信息端 / 退群挽留私信）就 push 一次；
 *    系统行（拉黑提示/红包领取通知/凭据卡）不弹。
 * 2. 弹出：由 PhoneShell 内的 IslandNotificationLayer 渲染，卡片从灵动岛几何位
 *    （w-118 h-33 top-11 圆角胶囊）展开为通知卡；展开期间灵动岛隐藏（同一几何位无缝交接），
 *    收起动画结束后灵动岛恢复——全程无闪烁。
 * 3. 全局覆盖：层级 z-93 高于锁屏(65)/切换器(60)/闹钟(90)/状态栏(70)/灵动岛(80)，
 *    仅低于熄屏黑遮罩(95)；不阻塞操作（卡片外全部可正常交互，仅卡片本身可点击）。
 * 4. 节流合并（不刷屏）：
 *    - 同一会话（sessionKey）短时间内多条消息 → 合并为一条通知（正文取最新一条，计数 +1，计时重置）；
 *    - 不同会话 → 排队逐条展示（每条 3 秒），队列上限 4 条，超出丢最旧；
 *    - 自动收起计时在页面不可见（切走标签页）或熄屏时冻结，回来自动续期。
 * 5. 离开网页也通知：页面不可见且浏览器支持 Web Notification 且已授权 → 发系统通知
 *    （tag = 会话键，同会话多条系统级替换合并）；权限 default 时首次自动申请一次，
 *    拒绝/不支持/申请失败都不影响应用内灵动岛弹窗。
 * 6. 点击跳转：卡片点击 → switchToApp 到目标 App + 经导航总线（ISLAND_NAV_EVENT +
 *    takeNotifyNavigation）让对应聊天页打开该会话（单聊 / 群聊）；锁屏/熄屏/闹钟响铃时点击只收起不跳转。
 */

import { create } from 'zustand';
import { useUI } from './store';

// ---------------- 类型 ----------------

/** 通知归属 App（AppId 的聊天子集） */
export type NotifyApp = 'wechat' | 'qq' | 'chat';

/** 点击跳转目标：单聊给 contactId，群聊给 groupId（群聊宿主在 wechat/qq App 内） */
export interface NotifyTarget {
  app: NotifyApp;
  contactId?: string;
  groupId?: string;
}

/** 各端聊天 finalize 调用的通知输入（正文已由调用方按消息类型映射好占位符） */
export interface ChatNotifyInput {
  /** 合并键：会话键（wx:<id> / wx:group:<gid> / qq:<id> / qq:group:<gid> / sms:<key>） */
  sessionKey: string;
  app: NotifyApp;
  /** 角色名字（群聊 = 发言成员） */
  title: string;
  /** 副标题（群聊 = 群名） */
  subtitle?: string;
  /** 角色头像（路径或 dataURL；空展示首字符占位） */
  avatar?: string | null;
  /** 消息预览文本（调用方用 notifyPreviewText 映射，模块内再截断） */
  body: string;
  target: NotifyTarget;
}

export interface IslandNotification {
  id: string;
  /** 合并键 = sessionKey */
  mergeKey: string;
  app: NotifyApp;
  avatar: string | null;
  title: string;
  subtitle: string;
  body: string;
  /** 合并条数（同一会话连续多条 > 1 时展示） */
  count: number;
  target: NotifyTarget;
}

interface IslandNotifyState {
  current: IslandNotification | null;
  /** 收起动画进行中（current 仍持有，动画结束后 finishExit 恢复灵动岛 / 展示下一条） */
  exiting: boolean;
  queue: IslandNotification[];
  show: (n: IslandNotification) => void;
  mergeCurrent: (patch: Partial<IslandNotification>) => void;
  mergeQueued: (key: string, patch: Partial<IslandNotification>) => void;
  enqueue: (n: IslandNotification) => void;
  beginExit: () => void;
  finishExit: () => void;
}

// ---------------- 常量 ----------------

/** 弹窗停留时长（需求：显示时长可控，默认 3 秒后自动收起；点击可立即收起） */
export const AUTO_DISMISS_MS = 3000;
/** 不同会话排队上限（超出丢最旧，防刷屏） */
const MAX_QUEUE = 4;
/** 通知正文最大字符数 */
const BODY_MAX = 80;
/** 导航请求有效期（App 未登录等场景挂起后过期作废） */
const NAV_TTL_MS = 60_000;
/** 灵动岛胶囊几何（与 PhoneShell 静态灵动岛一致，保证无缝形变） */
export const ISLAND_PILL = { width: 118, height: 33, borderRadius: 17 } as const;

// ---------------- Store ----------------

let seq = 0;
const genNotifyId = () => `ntf-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** 收起动画完成：恢复灵动岛 / 展示队列下一条（IslandNotification 动画回调调用） */
export function finishExit(): void {
  useIslandNotify.getState().finishExit();
}

export const useIslandNotify = create<IslandNotifyState>((set, get) => ({
  current: null,
  exiting: false,
  queue: [],
  show: (n) => set({ current: n }),
  mergeCurrent: (patch) =>
    set((s) => (s.current ? { current: { ...s.current, ...patch } } : {})),
  mergeQueued: (key, patch) =>
    set((s) => {
      const idx = s.queue.findIndex((q) => q.mergeKey === key);
      if (idx < 0) return {};
      const queue = s.queue.slice();
      queue[idx] = { ...queue[idx], ...patch };
      return { queue };
    }),
  enqueue: (n) =>
    set((s) => {
      const queue = [...s.queue, n];
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
      return { queue };
    }),
  beginExit: () => {
    if (!get().current || get().exiting) return;
    clearAutoDismiss();
    set({ exiting: true });
  },
  finishExit: () => {
    const { queue } = get();
    const [next, ...rest] = queue;
    set({ current: next ?? null, queue: rest, exiting: false });
    if (next) armAutoDismiss();
  },
}));

// ---------------- 自动收起计时（页面不可见 / 熄屏时冻结，回来续期） ----------------

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function clearAutoDismiss(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export function armAutoDismiss(): void {
  clearAutoDismiss();
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (useUI.getState().screenOff) return;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    useIslandNotify.getState().beginExit();
  }, AUTO_DISMISS_MS);
}

if (typeof window !== 'undefined') {
  // 切走标签页：冻结计时；切回：未收起的通知续期计时
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearAutoDismiss();
    } else {
      const st = useIslandNotify.getState();
      if (st.current && !st.exiting) armAutoDismiss();
    }
  });
}

// ---------------- 推送入口（各聊天端 finalize 调用） ----------------

export function truncateBody(s: string, max = BODY_MAX): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * 推送一条 AI 消息通知：
 * - 与正在展示的通知同会话 → 原地合并（正文取最新、计数 +1、计时重置）；
 * - 与队列中待展示的同会话 → 原地合并；
 * - 否则立即展示（无正在展示的）或入队排队。
 * 页面不可见时同时走 Web Notification 通道（支持且已授权时）。
 */
export function pushChatNotification(input: ChatNotifyInput): void {
  const body = truncateBody(input.body);
  if (!body) return;
  const st = useIslandNotify.getState();
  const base = {
    mergeKey: input.sessionKey,
    app: input.app,
    avatar: input.avatar ?? null,
    title: input.title,
    subtitle: input.subtitle ?? '',
    body,
    target: input.target,
  };
  if (st.current && !st.exiting && st.current.mergeKey === base.mergeKey) {
    st.mergeCurrent({ ...base, count: st.current.count + 1 });
    armAutoDismiss();
    return;
  }
  const qi = st.queue.findIndex((q) => q.mergeKey === base.mergeKey);
  if (qi >= 0) {
    st.mergeQueued(base.mergeKey, { ...base, count: st.queue[qi].count + 1 });
    return;
  }
  const n: IslandNotification = { id: genNotifyId(), count: 1, ...base };
  if (!st.current && !st.exiting) {
    st.show(n);
    armAutoDismiss();
  } else {
    st.enqueue(n);
  }
  maybeWebNotification(n);
}

// ---------------- Web Notification（离开网页也通知；不支持/拒绝 → 应用内弹窗兜底） ----------------

/** App 图标（public 下真实图标，与主屏一致） */
export const NOTIFY_APP_ICON: Record<NotifyApp, string> = {
  wechat: '/icons/wechat.png',
  qq: '/icons/qq.png',
  chat: '/icons/chat.png',
};

let webPermAsked = false;

function postWebNotification(n: IslandNotification): void {
  try {
    const notif = new Notification(n.title, {
      body: n.subtitle ? `【${n.subtitle}】${n.body}` : n.body,
      tag: n.mergeKey, // 同一会话短时间多条 → 系统级替换合并，不刷屏
      icon: n.avatar || NOTIFY_APP_ICON[n.app],
      silent: true,
    });
    notif.onclick = () => {
      window.focus();
      navigateToNotifyTarget(n.target);
      notif.close();
    };
  } catch {
    // 构造失败（部分浏览器限制）静默降级为应用内弹窗
  }
}

function maybeWebNotification(n: IslandNotification): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return; // 不支持 → 应用内弹窗
  try {
    const perm = Notification.permission;
    if (perm === 'granted') {
      // 页面可见时灵动岛弹窗足够，不重复打扰；只有用户切走/锁屏才发系统通知
      if (document.visibilityState === 'hidden') postWebNotification(n);
    } else if (perm === 'default' && !webPermAsked) {
      // 首次使用时申请一次；拒绝后不再申请，应用内弹窗不受影响
      webPermAsked = true;
      void Notification.requestPermission();
    }
  } catch {
    // 权限查询异常（旧浏览器）静默降级
  }
}

// ---------------- 点击导航总线 ----------------

/** 导航事件名（已挂载的聊天页监听；新挂载的聊天页挂载时消费 pending） */
export const ISLAND_NAV_EVENT = 'island-notify-nav';

let pendingNav: { target: NotifyTarget; at: number } | null = null;

function navigateToNotifyTarget(target: NotifyTarget): void {
  const ui = useUI.getState();
  if (ui.locked || ui.screenOff) return;
  pendingNav = { target, at: Date.now() };
  ui.switchToApp(target.app);
  window.dispatchEvent(new Event(ISLAND_NAV_EVENT));
}

/** 点击通知卡片：跳转目标会话（锁屏/熄屏/闹钟时只收起不跳转）+ 收起弹窗 */
export function activateCurrentNotification(): void {
  const cur = useIslandNotify.getState().current;
  if (!cur) return;
  navigateToNotifyTarget(cur.target);
  useIslandNotify.getState().beginExit();
}

/**
 * 聊天页消费导航请求（挂载时 + 收到 ISLAND_NAV_EVENT 时各调一次）：
 * 只取属于本 App 的目标并清空 pending；不属于则原样保留给目标 App。
 * 挂起超过 60s 过期作废，避免陈旧跳转。
 */
export function takeNotifyNavigation(app: NotifyApp): NotifyTarget | null {
  if (!pendingNav || pendingNav.target.app !== app) return null;
  if (Date.now() - pendingNav.at > NAV_TTL_MS) {
    pendingNav = null;
    return null;
  }
  const t = pendingNav.target;
  pendingNav = null;
  return t;
}

// ---------------- 消息 → 通知预览文本（各端共用映射；返回 null = 不弹） ----------------

export interface NotifyMsgInfo {
  /** 消息种类（各端 kind；缺省 = 文本） */
  kind?: string;
  /** 文本内容（语音消息为空串） */
  content?: string;
  /** 语音转写/朗读原文（kind='voice' 时优先展示） */
  voiceText?: string | null;
  /** 红包/转账金额 */
  amount?: number | null;
  /** 红包祝福语 */
  blessing?: string | null;
  /** 转账留言 */
  note?: string | null;
  /** 合并转发（kind='forward' 时展示为 [聊天记录]） */
  mergedFwd?: boolean;
}

/** 通知预览文本映射（与各端会话列表预览口径一致）；系统行/凭据卡返回 null（不弹通知） */
export function notifyPreviewText(m: NotifyMsgInfo): string | null {
  switch (m.kind) {
    case 'sys':
    case 'notice':
    case 'blockreq':
      return null;
    case 'image':
      return '[图片]';
    case 'voice':
      // 语音消息预览只显示[语音]（iOS 原生行为）：不透出转写原文，与各端会话列表预览口径一致
      return '[语音]';
    case 'redpacket':
      return m.amount != null ? `[红包] ¥${m.amount}${m.blessing ? ` ${m.blessing}` : ''}` : '[红包]';
    case 'transfer':
      return m.amount != null ? `[转账] ¥${m.amount}${m.note ? ` ${m.note}` : ''}` : '[转账]';
    case 'family':
      return '[亲属卡]';
    case 'location':
      return '[位置]';
    case 'sticker':
      return '[表情]';
    case 'forward':
      return m.mergedFwd ? '[聊天记录]' : m.content?.trim() || '[转发]';
    case 'groupcard':
      return '[群聊邀请]';
    default:
      return m.content?.trim() || null;
  }
}
