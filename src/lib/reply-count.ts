'use client';

/**
 * 回复条数（AI 像真人一样一句一句连发多条消息）：
 *
 * - 每个会话独立保存自己的回复条数（sessionKey = wx:<contactId> / qq:<contactId> /
 *   sms:<storageKey>，天然按角色/App 隔离），localStorage 单键 JSON map 持久化；
 *   切换角色时各 App 在发送现场读取该角色自己的值，互不影响；
 * - buildReplyCountPrompt：追加在角色人设 system 消息之后，要求「一句一条、这次要发
 *   N 条左右」——条数是目标而非宽松上限（模型对「最多 N 条、少发也行」天然偷懒，
 *   实测无论设多大都只回两三条）；大条数时给出「怎么自然铺开」的具体思路；
 * - buildContinueReplyPrompt：连发补发指令（chat-stream-store 使用）——首轮没发够
 *   目标条数时，把已发内容作为 assistant 消息附回，再以 user 角色追加本指令自动
 *   追发，直到凑够条数 / 达到轮数上限 / 无新内容（客户端兜底，三端共用）。
 * - 消息边界 = 「&&&」标记 或 换行 或 句末标点：AI 守「一句一行」约定时按行切；把多句话
 *   写在同一行里时按句子切开（句末标点保留在气泡文本里）—— 一句就是一条消息，逐条连发；
 * - splitReplySegments：流结束后把完整回复按边界切成多条消息（一条消息一条记录、各自
 *   入库渲染）；单条模式（multi=false）沿用旧行为只按标记切分；切不出任何非空段时返回
 *   ['']（调用方沿用各自的空回复兜底文案），至少保证第一条消息正常显示；
 * - splitReplyRender：流式渲染期把已收内容实时切成多条气泡（句末标点保留在气泡文本里，
 *   末尾没凑齐的半截「&&」不闪现），收不到边界时自然回退为单气泡，不会混成一条长文；
 * - createReplyPacer：连发节奏器（聊天流总线使用）—— 一条消息输出完（边界出现）立即
 *   放出并显示「打字中」，停顿片刻后放出下一条【完整】消息，一句一句逐条连发；下一条
 *   还没打完（边界未出现）时保持「打字中」继续等、绝不放半截；流数据接收结束后，剩余
 *   未放出的消息也继续按同样节奏逐条放出（end 返回 Promise，全部放完后才 resolve，
 *   落盘收尾等它 —— 短回复也不会一口气全部弹出）；immediate 退出（失败路径）立刻放出
 *   全部剩余内容。全程不阻塞读取上游，退出页面后继续接收的逻辑不受影响。
 */

/** 可选回复条数（默认 5 条） */
export const REPLY_COUNT_OPTIONS: readonly number[] = [1, 3, 5, 7, 15, 20, 25, 30];
/** 默认回复条数 */
export const DEFAULT_REPLY_COUNT = 5;

const STORE_KEY = 'chat-reply-counts';

/** 多条消息分隔标记：连续 3 个以上「&」（历史约定，兼容仍输出该标记的模型） */
const MARKER_RE = /&{3,}/;

/**
 * 消息边界（正则源）：「&&&」标记 / 换行 / 句末标点。
 * 句末标点取「连续的句终符（。！？!?…）+ 紧随的收尾引号/括号」，把「他说“走吧！”」这类
 * 引号收尾整体留在前一条消息末尾；连续标点（！！！/？！/……）算一个边界，不会切碎。
 */
const BOUNDARY_SRC = '&{3,}|\\n|[。！？!?…]+[”’"』」）)\\]]*';

/** 非 global 版本：exec 无 lastIndex 副作用，可复用 */
const BOUNDARY_ONE_RE = new RegExp(BOUNDARY_SRC);

/** 末尾 1-2 个「&」：可能被拆进下个增量的半截分隔标记 */
const HALF_MARKER_RE = /&{1,2}$/;

/**
 * 判断文本是否以消息边界收尾（换行 / 「&&&」标记 / 句末标点+收尾引号，允许尾随空白）。
 * 连发补发前用它检查上一轮内容：没以边界收尾 = 最后一条还没「打完」，
 * 需要先补一个换行把它变成完整一条，否则补发的内容会黏进上一条消息。
 */
export function endsWithReplyBoundary(text: string): boolean {
  return /(?:\n|&{3,}|[。！？!?…]+[”’"』」）)\]]*)\s*$/.test(text);
}

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

/**
 * 追加在人设 system 消息之后的「回复条数」指令块。
 * N 是本次连发的【目标条数】（N 条左右）——不能写成「最多 N 条、少发也行」：模型对
 * 宽松上限天然偷懒，实测无论设多大都只回两三条；大条数时给出「怎么自然铺开」的
 * 具体思路（细节/感受/提问/动作/新话题），让条数用真实内容填满而不是客套凑数。
 */
export function buildReplyCountPrompt(n: number): string {
  const lines = [
    `【连发短消息】本次回复请模仿真人在手机上聊天：把想说的话拆成一条一条的短消息，一句一条、连续发出来，这次要发 ${n} 条左右。`,
    `每条消息只写一句简短、口语化的话，单独占一行；消息内部不要换行，不要加序号、项目符号或任何分隔标记。`,
  ];
  if (n >= 7) {
    lines.push(
      `条数比较多：把话题自然铺开来聊——说说细节和感受、吐槽、回忆、打算，多问几个问题，描述你此刻正在做的事和状态，也可以自然聊起相关的新话题；每条都要有实际内容，像真人越聊越起劲那样，但不要重复啰嗦、不要用无意义的客套话凑数。`
    );
  } else {
    lines.push(`各条消息围绕当前话题自然衔接，就像随手一口气连发出去的一样。`);
  }
  return lines.join('\n');
}

/**
 * 连发补发指令（chat-stream-store 使用）：上游一轮没发够目标条数时，把已发内容作为
 * assistant 消息附回消息列表，再以 user 角色追加本指令请求「继续连发」补足条数。
 * 不给模型「少发也行」的退路（否则补发轮同样只回两三条就停），只约束内容要自然、
 * 不重复、不解释；剩余条数与总条数都写明，让模型知道还差多少。
 */
export function buildContinueReplyPrompt(remaining: number, total: number): string {
  return [
    `（系统指令，不是聊天内容：你刚才连发的消息还不够数。请紧接着刚才的话头继续连发短消息，再发 ${remaining} 条左右，让这次连发总共达到 ${total} 条左右。）`,
    `继续像真人越聊越起劲那样往下接：补充细节、说说感受、吐槽、提问、描述你此刻正在做的事或状态、自然聊起相关的话题都可以。`,
    `不要重复已经说过的话，不要总结收尾，不要输出任何解释说明；直接输出消息内容——每条一句简短、口语化的话，单独占一行，不要加序号或分隔标记。`,
  ].join('\n');
}

/**
 * 按消息边界把文本切成原始段（不 trim 不过滤）：
 * 「&&&」标记与换行本身丢弃；句末标点保留在前一条消息末尾（气泡里要看到「！」）。
 */
function splitByBoundaryRaw(text: string): string[] {
  const re = new RegExp(BOUNDARY_SRC, 'g');
  const out: string[] = [];
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const end = m.index + m[0].length;
    const isSentence = m[0] !== '\n' && !m[0].startsWith('&');
    // 句末标点并入前一条消息；标记/换行本身丢弃不进气泡
    out.push(text.slice(last, isSentence ? end : m.index));
    last = end;
  }
  out.push(text.slice(last));
  return out;
}

/** 去掉首尾空白并滤掉空段 */
function trimSegs(parts: string[]): string[] {
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * 流结束后把完整回复切成多条消息文本（每条独立入库/渲染）。
 * multi（回复条数 > 1）时按「标记 + 换行 + 句末标点」切分：一句就是一条消息 —— AI 在一条
 * 消息里写了多句、多行也会被拆开，不会把几句话挤进同一个气泡；单条模式沿用旧行为只按
 * 标记切分。切不出任何非空段时返回 ['']（调用方沿用各自的空回复兜底文案），
 * 解析失败时整段原样返回 —— 至少保证第一条消息正常显示。
 */
export function splitReplySegments(content: string, multi = false): string[] {
  const segs = trimSegs(multi ? splitByBoundaryRaw(content) : content.split(MARKER_RE));
  return segs.length > 0 ? segs : [''];
}

/** 流式渲染期的切分结果：texts = 已收到的各条消息（最后一条可能仍在增长），pending = 下一条即将开始（渲染「打字中」气泡） */
export interface ReplyRenderSplit {
  texts: string[];
  pending: boolean;
}

/**
 * 把流式接收中的内容切成多条气泡文本：边界（标记/换行/句末标点）后的空段 → pending；
 * 末尾没凑齐的半截「&&」不闪现；多条模式下句末标点保留在气泡文本里（「你好！」不会变「你好」）。
 */
export function splitReplyRender(shown: string, multi = false): ReplyRenderSplit {
  const parts = multi ? splitByBoundaryRaw(shown) : shown.split(MARKER_RE);
  const lastIdx = parts.length - 1;
  const pending = parts.length > 1 && (parts[lastIdx] ?? '').replace(HALF_MARKER_RE, '').trim().length === 0;
  const texts = parts
    .map((s, i) => (i === lastIdx ? s.replace(HALF_MARKER_RE, '') : s).trim())
    .filter((s) => s.length > 0);
  return { texts, pending };
}

/** 连发节奏器：把上游增量按「边界即放行、下一条先停顿」的节奏转为界面展示内容 */
export interface ReplyPacer {
  /** 喂入上游增量 */
  push: (delta: string) => void;
  /**
   * 流数据接收结束：剩余未放出的内容继续按连发节奏逐条放出（每条完整弹出、间隔停顿），
   * 全部放完后 resolve（调用方 await 它之后再落盘收尾，短回复也是一句一句出现）。
   * immediate=true（失败路径）：立刻放出全部剩余内容并 resolve，不等节奏。
   */
  end: (opts?: { immediate?: boolean }) => Promise<void>;
}

/** 找到 from 之后第一个消息边界的结束位置；没有则 -1 */
function nextBoundaryEnd(s: string, from: number): number {
  const m = BOUNDARY_ONE_RE.exec(s.slice(from));
  return m ? from + m.index + m[0].length : -1;
}

/**
 * 创建连发节奏器：
 * - 一条消息输出完（边界出现：标记/换行/句末标点）立即放出，渲染层据此在其后挂「打字中」气泡；
 * - 下一条消息输出完之前停顿片刻（期间渲染层显示「打字中」），到点只放出下一条【完整】消息
 *   再停顿 —— 一句一句逐条连发，每句之间都有真人打字的节奏感；下一条还没打完（边界未出现）
 *   时保持等待，绝不把半句话提前放出去；
 * - 流数据接收结束后（end）：剩余没放完的消息继续按同样节奏逐条放出，全部放完后才 resolve ——
 *   落盘收尾 await 它，短回复也不会在流结束瞬间一口气全部弹出；
 * - immediate=true（失败路径）：立刻放出全部剩余内容；
 * - 全程不阻塞读取上游，退出页面后继续接收不受影响。
 */
export function createReplyPacer(onShown: (text: string) => void, pauseMs?: () => number): ReplyPacer {
  const pause = pauseMs ?? (() => 600 + Math.floor(Math.random() * 500));
  let full = ''; // 累计收到的原始内容
  let shown = ''; // 已放出的内容（full 的前缀）
  let scanned = 0; // full 中已完成边界扫描的位置（只向前扫，不回扫）
  /** 最近一个边界的结束位置（其后出现新内容 → 先停顿再放出下一条） */
  let awaiting = -1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 流数据是否已接收结束（结束后不再等下一增量，最后半条整体放出） */
  let finished = false;
  let doneResolve: (() => void) | null = null;

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
  const resolveDone = () => {
    const r = doneResolve;
    doneResolve = null;
    r?.();
  };
  const schedulePause = () => {
    if (timer === null) timer = setTimeout(flushNext, pause());
  };
  /** 停顿结束：只放出下一条【完整】消息（到它的边界为止），随后继续停顿 —— 逐条连发 */
  const flushNext = () => {
    timer = null;
    const end = nextBoundaryEnd(full, Math.max(awaiting, 0));
    if (end >= 0) {
      show(end);
      scanned = Math.max(scanned, end);
      awaiting = end;
    } else if (finished) {
      show(full.length); // 流已结束且最后一条没有边界收尾：整条放出（其后已无边界可切）
    } else {
      // 下一条还没打完（边界未出现）：保持「打字中」继续等，等它输出完或下个增量到达时再检查
      return;
    }
    if (finished && shown.length >= full.length) {
      awaiting = -1;
      resolveDone();
      return;
    }
    if (full.length > shown.length) schedulePause(); // 后面还有内容：继续停顿（逐条连发）
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
      const tail = HALF_MARKER_RE.exec(full);
      scanned = tail ? tail.index : full.length;
      if (awaiting >= 0 && full.length > awaiting) {
        schedulePause(); // 下一条已开始输出：先停顿、等它打完再放出（真人连发节奏）
        return;
      }
      show(full.length); // 当前这条还在逐字输出：透传
    },
    end(opts) {
      if (opts?.immediate === true) {
        // 失败路径：立刻放出全部剩余内容（错误信息要马上可见）
        finished = true;
        clearTimer();
        awaiting = -1;
        scanned = full.length;
        show(full.length);
        resolveDone();
        return Promise.resolve();
      }
      if (finished) {
        awaiting = -1;
        return Promise.resolve();
      }
      finished = true;
      if (shown.length >= full.length) {
        awaiting = -1;
        return Promise.resolve();
      }
      // 还有没放出的内容：继续按连发节奏逐条放出，全部放完后 resolve（落盘收尾等它）
      clearTimer();
      return new Promise<void>((resolve) => {
        doneResolve = resolve;
        schedulePause();
      });
    },
  };
}
