'use client';

/**
 * 回复条数（AI 像真人一样连发多条消息）：
 *
 * - 每个会话独立保存自己的回复条数（sessionKey = wx:<contactId> / qq:<contactId> /
 *   sms:<storageKey>，天然按角色/App 隔离），localStorage 单键 JSON map 持久化；
 *   切换角色时各 App 在发送现场读取该角色自己的值，互不影响；
 * - buildReplyCountPrompt：追加在角色人设 system 消息之后，要求「最多 N 条、没话可说就少发」，
 *   每条消息一句话单独一行，并用「&&&」作为相邻消息的分隔标记；
 * - 消息边界 = 「&&&」标记 或 换行（一行就是一条消息）：即使 AI 没守约定、在一条消息里
 *   写了多行，也会被按行切开成多个独立气泡，不会把几句话挤进同一个气泡；
 * - splitReplySegments：流结束后把完整回复按边界切成多条消息（一条消息一条记录、各自
 *   入库渲染）；单条模式（multi=false）沿用旧行为只按标记切分；切不出任何非空段时返回
 *   ['']（调用方沿用各自的空回复兜底文案），至少保证第一条消息正常显示；
 * - splitReplyRender：流式渲染期把已收内容实时切成多条气泡（末尾没凑齐的半截「&&」
 *   不闪现），收不到边界时自然回退为单气泡，不会混成一条长文；
 * - createReplyPacer：连发节奏器（聊天流总线使用）—— 一条消息输出完（边界出现）立即
 *   放行并显示「打字中」，停顿片刻后只放出下一条，逐条连发、每条之间都有真人打字的
 *   节奏感；流结束时立刻放出全部剩余内容，退出页面后继续接收的逻辑不受影响。
 */

/** 可选回复条数（默认 5 条） */
export const REPLY_COUNT_OPTIONS: readonly number[] = [1, 3, 5, 7, 15, 20, 25, 30];
/** 默认回复条数 */
export const DEFAULT_REPLY_COUNT = 5;

/** 多条消息分隔标记：连续 3 个以上「&」（与 buildReplyCountPrompt 的约定一致） */
const MARKER_RE = /&{3,}/;

/** 消息边界：分隔标记或换行 —— 一行就是一条消息（AI 没守「一条一行」约定时也能正确切分） */
const BOUNDARY_RE = /&{3,}|\n/;

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
    `【回复条数】本次请像真人连发消息那样，把回复拆成多条独立的消息发出，最多 ${n} 条：话题多可以发满，话题简单或实在没话可说时就少发几条（最少 1 条），不要硬凑条数。`,
    `每条消息只写一句简短口语化的话，单独占一行，消息内部绝对不要换行；想连着表达几层意思就拆成几条消息，不要把多条内容合并成一条长文。`,
    `相邻两条消息之间用「&&&」分隔，例如：第一条内容&&&第二条内容&&&第三条内容；除分隔标记外不要输出任何多余内容，消息正文里也不要出现「&&&」。`,
    `各条消息围绕当前话题自然衔接，像真人随手连发的那样简短、口语化。`,
  ].join('\n');
}

/**
 * 流结束后把完整回复切成多条消息文本（每条独立入库/渲染）。
 * multi（回复条数 > 1）时按「标记 + 换行」双重切分：一行就是一条消息，AI 在一条消息里
 * 写了多行也会被拆开，不会把几句话挤进同一个气泡；单条模式沿用旧行为只按标记切分。
 * 切不出任何非空段时返回 ['']（调用方沿用各自的空回复兜底文案），
 * 条数解析失败时整段原样返回 —— 至少保证第一条消息正常显示。
 */
export function splitReplySegments(content: string, multi = false): string[] {
  const segs = content
    .split(MARKER_RE)
    .flatMap((s) => (multi ? s.split('\n') : [s]))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return segs.length > 0 ? segs : [''];
}

/** 流式渲染期的切分结果：texts = 已收到的各条消息（最后一条可能仍在增长），pending = 下一条即将开始（渲染「打字中」气泡） */
export interface ReplyRenderSplit {
  texts: string[];
  pending: boolean;
}

/**
 * 把流式接收中的内容切成多条气泡文本：完整分隔标记后的空段 → pending；
 * multi（回复条数 > 1）时换行也是消息边界（一行一条气泡）；
 * 末尾没凑齐的半截「&&」不闪现，收不到边界时自然回退为单气泡。
 */
export function splitReplyRender(shown: string, multi = false): ReplyRenderSplit {
  const parts = shown.split(multi ? BOUNDARY_RE : MARKER_RE);
  const pending = parts.length > 1 && (parts[parts.length - 1] ?? '').trim().length === 0;
  const texts = parts
    .map((s, i) => (i === parts.length - 1 ? s.replace(/&{1,2}$/, '') : s).trim())
    .filter((s) => s.length > 0);
  return { texts, pending };
}

/** 连发节奏器：把上游增量按「边界即放行、下一条先停顿」的节奏转为界面展示内容 */
export interface ReplyPacer {
  /** 喂入上游增量 */
  push: (delta: string) => void;
  /** 流结束：立刻放出全部剩余内容（不再停顿） */
  end: () => void;
}

/** 找到 from 之后第一个消息边界（「&&&」标记或换行）的结束位置；没有则 -1 */
function nextBoundaryEnd(s: string, from: number): number {
  const m = BOUNDARY_RE.exec(s.slice(from));
  return m ? from + m.index + m[0].length : -1;
}

/**
 * 创建连发节奏器：
 * - 一条消息输出完（边界出现）立即放出，渲染层据此在其后挂「打字中」气泡；
 * - 下一条消息开始输出前停顿片刻，之后只放出下一条（到它的边界为止）再停顿 ——
 *   逐条连发，每条之间都有真人打字的节奏感；
 * - 最后一条没有边界收尾时，停顿结束后整体放出并恢复逐字透传；
 * - 流结束立刻放出全部剩余内容。全程不阻塞读取上游，退出页面后继续接收不受影响。
 */
export function createReplyPacer(onShown: (text: string) => void, pauseMs?: () => number): ReplyPacer {
  const pause = pauseMs ?? (() => 600 + Math.floor(Math.random() * 500));
  let full = ''; // 累计收到的原始内容
  let shown = ''; // 已放出的内容（full 的前缀）
  let scanned = 0; // full 中已完成边界扫描的位置（只向前扫，不回扫）
  /** 最近一个边界的结束位置（其后出现新内容 → 先停顿再放出下一条） */
  let awaiting = -1;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const show = (upto: number) => {
    if (upto > shown.length) {
      shown = full.slice(0, upto);
      onShown(shown);
    }
  };
  const flushAll = () => {
    clearTimer();
    awaiting = -1;
    scanned = full.length;
    show(full.length);
  };
  const schedulePause = () => {
    if (timer === null) timer = setTimeout(flushNext, pause());
  };
  /** 停顿结束：只放出下一条（到它的边界为止），随后继续停顿 —— 逐条连发 */
  const flushNext = () => {
    timer = null;
    const end = nextBoundaryEnd(full, Math.max(awaiting, 0));
    if (end >= 0) {
      show(end);
      scanned = Math.max(scanned, end);
      awaiting = end;
      if (full.length > end) schedulePause();
    } else {
      // 后面已没有完整边界（最后一条仍在输出）：放出全部并恢复逐字透传
      flushAll();
    }
  };

  return {
    push(delta) {
      if (!delta) return;
      full += delta;
      if (timer !== null) return; // 停顿中：缓冲的内容由 flushNext 逐段放出
      const end = nextBoundaryEnd(full, scanned);
      if (end >= 0) {
        // 刚输出完一条（边界出现）：立即放出，渲染层据此显示「打字中」
        show(end);
        scanned = end;
        awaiting = end;
        if (full.length > end) schedulePause(); // 边界后已有新内容：安排停顿
        return;
      }
      // 没有新边界：当前这条还在逐字输出，透传；但末尾 1-2 个「&」可能是被拆进
      // 下个增量的半截分隔标记，scanned 先不越过它们（否则「&&&」跨增量拼齐时会漏检）
      const tail = /&{1,2}$/.exec(full);
      scanned = tail ? tail.index : full.length;
      if (awaiting >= 0 && full.length > awaiting) {
        schedulePause(); // 下一条已开始输出：先停顿再放出（真人连发节奏）
        return;
      }
      show(full.length); // 当前这条还在逐字输出：透传
    },
    end: flushAll,
  };
}
