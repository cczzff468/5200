'use client';

/**
 * 回复条数（AI 像真人一样连发多条消息）：
 *
 * - 每个会话独立保存自己的回复条数（sessionKey = wx:<contactId> / qq:<contactId> /
 *   sms:<storageKey>，天然按角色/App 隔离），localStorage 单键 JSON map 持久化；
 *   切换角色时各 App 在发送现场读取该角色自己的值，互不影响；
 * - buildReplyCountPrompt：追加在角色人设 system 消息之后，明确要求本次生成 N 条消息、
 *   每条独立成段，并用一行「&&&」作为相邻消息的分隔标记；
 * - splitReplySegments：流结束后把完整回复按「&&&」切成多条消息（一条消息一条记录、
 *   各自入库渲染）；没有分隔标记时整段作为第一条兜底，至少保证第一条正常显示；
 * - splitReplyRender：流式渲染期把已收内容实时切成多条气泡（末尾没凑齐的半截
 *   「&&」不闪现），收不到分隔标记时自然回退为单气泡，不会混成一条长文；
 * - createReplyPacer：连发节奏器（聊天流总线使用）—— 分隔标记一出现立即放行并在
 *   下一条消息开始输出前停顿片刻（聊天页此时显示「打字中」气泡），产生真人连发的
 *   节奏感；流结束时立刻放出全部剩余内容，退出页面后继续接收的逻辑不受影响。
 */

/** 可选回复条数（默认 5 条） */
export const REPLY_COUNT_OPTIONS: readonly number[] = [1, 3, 5, 7, 15, 20, 25, 30];
/** 默认回复条数 */
export const DEFAULT_REPLY_COUNT = 5;

/** 多条消息分隔标记：连续 3 个以上「&」（与 buildReplyCountPrompt 的约定一致） */
const MARKER_RE = /&{3,}/;

const STORE_KEY = 'chat-reply-counts';

/** 把任意值收窄为合法的回复条数（非法/未提供时回退 fallback） */
export function normalizeReplyCount(v: unknown, fallback: number = DEFAULT_REPLY_COUNT): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : NaN;
  return REPLY_COUNT_OPTIONS.includes(n) ? n : fallback;
}

function loadMap(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && REPLY_COUNT_OPTIONS.includes(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 读取某会话的回复条数（fallback：该 App 未设置时的默认值） */
export function getReplyCount(sessionKey: string, fallback: number = DEFAULT_REPLY_COUNT): number {
  const v = loadMap()[sessionKey];
  return typeof v === 'number' ? normalizeReplyCount(v, fallback) : normalizeReplyCount(fallback, fallback);
}

/** 保存某会话的回复条数（持久化到 localStorage，按 sessionKey 隔离） */
export function saveReplyCount(sessionKey: string, n: number): void {
  if (typeof window === 'undefined') return;
  const map = loadMap();
  map[sessionKey] = normalizeReplyCount(n);
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    // 持久化失败忽略（本次会话内存态仍然生效）
  }
}

/** 追加在人设 system 消息之后的「回复条数」指令块 */
export function buildReplyCountPrompt(n: number): string {
  return [
    `【回复条数】本次请生成 ${n} 条消息，每条消息独立成段，不要把多条内容合并成一条。`,
    `多条消息的输出格式：每条消息单独一小段；相邻两条消息之间用一行只包含「&&&」的分隔标记隔开，例如：第一条内容&&&第二条内容&&&第三条内容。`,
    `除分隔标记外不要输出任何多余内容，消息正文里也不要出现「&&&」；${n} 条消息要像真人连发那样围绕同一话题自然衔接，每条都简短口语化，不要写成段落长文。`,
  ].join('\n');
}

/**
 * 流结束后把完整回复切成多条消息文本（每条独立入库/渲染）。
 * 切不出任何非空段时返回 ['']（调用方沿用各自的空回复兜底文案），
 * 条数解析失败时整段原样返回 —— 至少保证第一条消息正常显示。
 */
export function splitReplySegments(content: string): string[] {
  const segs = content
    .split(MARKER_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return segs.length > 0 ? segs : [''];
}

/** 流式渲染期的切分结果：texts = 已收到的各条消息（最后一条可能仍在增长），pending = 下一条即将开始（渲染「打字中」气泡） */
export interface ReplyRenderSplit {
  texts: string[];
  pending: boolean;
}

/** 把流式接收中的内容切成多条气泡文本：完整分隔标记后的空段 → pending；末尾没凑齐的半截「&&」不闪现 */
export function splitReplyRender(shown: string): ReplyRenderSplit {
  const parts = shown.split(MARKER_RE);
  const pending = parts.length > 1 && (parts[parts.length - 1] ?? '').trim().length === 0;
  const texts = parts
    .map((s, i) => (i === parts.length - 1 ? s.replace(/&{1,2}$/, '') : s).trim())
    .filter((s) => s.length > 0);
  return { texts, pending };
}

/** 连发节奏器：把上游增量按「标记即放行、下一条先停顿」的节奏转为界面展示内容 */
export interface ReplyPacer {
  /** 喂入上游增量 */
  push: (delta: string) => void;
  /** 流结束：立刻放出全部剩余内容（不再停顿） */
  end: () => void;
}

/**
 * 创建连发节奏器：
 * - 分隔标记一凑齐就立即放出（聊天页在标记后挂「打字中」气泡）；
 * - 标记后出现新消息的第一个字时停顿 pauseMs() 再放出，之后恢复逐字透传；
 * - 下一次出现分隔标记时重复以上节奏；全程不阻塞读取上游，退出页面不受影响。
 */
export function createReplyPacer(onShown: (text: string) => void, pauseMs?: () => number): ReplyPacer {
  const pause = pauseMs ?? (() => 600 + Math.floor(Math.random() * 500));
  let full = '';
  let shown = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 已放出的最后一个分隔标记结束位置（其后出现新文本时触发一次停顿） */
  let awaiting = -1;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const flushAll = () => {
    clearTimer();
    awaiting = -1;
    if (full.length !== shown.length) {
      shown = full;
      onShown(shown);
    }
  };
  const update = () => {
    // 只关心已展示部分之后的新增内容（向前多看 2 字符：防止「&&」+「&」跨增量拼成完整标记）
    const from = Math.max(0, shown.length - 2);
    const m = MARKER_RE.exec(full.slice(from));
    if (!m) {
      if (awaiting >= 0 && full.length > awaiting) {
        // 下一条消息已开始输出：先停顿片刻再放出（真人连发节奏）
        if (timer === null) {
          timer = setTimeout(() => {
            timer = null;
            flushAll();
          }, pause());
        }
        return;
      }
      if (timer === null && full.length !== shown.length) {
        shown = full;
        onShown(shown);
      }
      return;
    }
    const markerEnd = from + m.index + m[0].length;
    if (markerEnd > shown.length) {
      // 分隔标记一凑齐立即放出（渲染层据此在后面挂「打字中」气泡）
      shown = full.slice(0, markerEnd);
      onShown(shown);
      awaiting = markerEnd;
      if (full.length > markerEnd && timer === null) {
        timer = setTimeout(() => {
          timer = null;
          flushAll();
        }, pause());
      }
    } else if (timer === null && full.length !== shown.length) {
      // 无新标记且未在停顿等待：直接透传
      shown = full;
      onShown(shown);
    }
  };

  return {
    push(delta) {
      if (!delta) return;
      full += delta;
      update();
    },
    end: flushAll,
  };
}
