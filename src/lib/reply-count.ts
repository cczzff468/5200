'use client';

/**
 * 回复条数（AI 像真人一样一句一句连发多条消息）：
 *
 * - 每个会话独立保存自己的回复条数（sessionKey = wx:<contactId> / qq:<contactId> /
 *   sms:<storageKey>，天然按角色/App 隔离），localStorage 单键 JSON map 持久化；
 *   切换角色时各 App 在发送现场读取该角色自己的值，互不影响；
 * - buildReplyCountPrompt：追加在角色人设 system 消息之后，约定「最多 N 条」的上限语义
 *   （N 是上限不是任务：没话说可以少发，不硬凑、不重复、不空消息）——说什么内容完全
 *   交给角色人设自由发挥，不做「怎么铺开话题」之类的引导；
 * - 消息边界 = 「&&&」标记 或 换行 或 句末标点：AI 守「一句一行」约定时按行切；把多句话
 *   写在同一行里时按句子切开（句末标点保留在气泡文本里）—— 一句就是一条消息，逐条连发；
 * - splitReplySegments：把完整回复按边界切成多条消息文本（单条模式 multi=false 只按标记
 *   切分）；切不出任何非空段时返回 ['']（调用方沿用各自的空回复兜底文案）；
 * - createReplySegmentScanner：流式分段器（聊天流总线使用，「边接收边逐条显示」的核心）——
 *   增量接收原文，每凑齐一条【完整】消息（边界出现、标记闭合）立刻回调 onSegment，由各 App
 *   解析成真实消息排队投递上屏；已放出 N-1 条后停止切分，剩余内容（含后续溢出的句子）全部
 *   留给 finish() 作为第 N 条（上限不是任务，也绝不丢失正文）；连续重复的段直接丢弃；
 *   末尾停在未闭合标记里的片段（祝福语「！」切碎标记）不提前放出，等标记闭合后再扫。
 *   全程不阻塞读取上游，退出页面后继续接收的逻辑不受影响。
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
 * 只约定连发的条数与格式（方便客户端按边界切成多个气泡），说什么内容完全
 * 由角色人设决定，不额外引导「怎么把话题铺开」。
 */
export function buildReplyCountPrompt(n: number): string {
  return [
    `【连发短消息】本次回复按你的人设，模仿真人在手机上聊天：把想说的话拆成一条一条的短消息，一句一条、连续发出来。`,
    `本次最多发 ${n} 条——${n} 条是上限不是任务：没话说时就少发（哪怕只发 1 条），绝不要为了凑满 ${n} 条硬撑内容。`,
    `每条消息只写一句简短、口语化的话，单独占一行；消息内部不要换行，不要加序号、项目符号或任何分隔标记。`,
    `不允许重复：不要把同一句话或同一个意思换个说法再发一遍；不允许发空消息。`,
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

/**
 * 流式分段器（「边接收边逐条显示」的核心，聊天流总线使用）：
 * 增量接收上游原文，每凑齐一条【完整】消息（边界出现、标记闭合）立刻回调 onSegment，
 * 由各 App 解析成真实消息排队投递上屏 —— 用户看到的是逐条冒出来，不存在先全文后消失。
 *
 * - 最多 N 条：已放出 N-1 条后停止切分，剩余内容（含后续溢出的句子）全部留给 finish()
 *   作为第 N 条 —— N 是上限不是任务，也绝不丢失正文；
 * - 空段跳过、连续重复段丢弃（不硬凑、不重复、不空消息）；
 * - 片段末尾停在未闭合标记里（祝福语「生日快乐！」的「！」切碎标记）不提前放出，
 *   游标先越过标记内边界等标记闭合后再重扫；
 * - finish()：返回剩余未放出的最后一条（标记换成换行、去掉末尾半截「&&」后 trim；
 *   无剩余或与上一条重复时返回空串，调用方跳过投递）。
 */
export interface ReplySegmentScanner {
  /** 喂入上游增量（纯文本累计，与展示状态无关） */
  push: (delta: string) => void;
  /** 流接收结束：返回剩余的最后一条（可为空串） */
  finish: () => string;
}

/** 段内是否有未闭合的「[」（标记被边界切碎时先不放出，等闭合后再扫） */
function hasOpenBracket(s: string): boolean {
  return s.lastIndexOf('[') > s.lastIndexOf(']');
}

export function createReplySegmentScanner(onSegment: (segment: string) => void, cap: number): ReplySegmentScanner {
  const max = Math.max(1, Math.floor(cap) || 1);
  let full = ''; // 累计收到的原始内容
  let segStart = 0; // 当前未放出片段的起点
  let scanFrom = 0; // 边界搜索游标（≥ segStart；标记未闭合时先越过标记内边界等待闭合）
  let emitted = 0; // 已放出的条数
  let lastEmitted = ''; // 上一条放出的内容（连续重复去重）

  return {
    push(delta) {
      if (!delta) return;
      full += delta;
      for (;;) {
        const m = BOUNDARY_ONE_RE.exec(full.slice(scanFrom));
        if (!m) break;
        const end = scanFrom + m.index + m[0].length;
        const isSentence = m[0] !== '\n' && !m[0].startsWith('&');
        // 句末标点并入本条（「你好！」完整弹出）；标记/换行本身丢弃不进气泡
        const candidate = full.slice(segStart, isSentence ? end : end - m[0].length);
        if (hasOpenBracket(candidate)) {
          // 停在未闭合的标记里：越过标记内边界，等标记闭合后重扫（祝福语带「！」的红包/转账标记）
          scanFrom = end;
          continue;
        }
        const trimmed = candidate.trim();
        if (trimmed.length === 0) {
          // 空段（连续换行/标记）：跳过不投、不占条数
          segStart = end;
          scanFrom = end;
          continue;
        }
        if (emitted >= max - 1) break; // 已放出 N-1 条：剩余全部留给 finish() 的第 N 条（最多 N 条）
        if (trimmed === lastEmitted) {
          // 连续重复：丢弃不投（不重复）
          segStart = end;
          scanFrom = end;
          continue;
        }
        onSegment(trimmed);
        emitted += 1;
        lastEmitted = trimmed;
        segStart = end;
        scanFrom = end;
      }
    },
    finish() {
      // 剩余内容（最后一条 / 超出上限的溢出部分）：标记换成换行，半截「&&」不进气泡
      let tail = full.slice(segStart).replace(MARKER_RE, '\n').trim();
      tail = tail.replace(HALF_MARKER_RE, '').trim();
      if (!tail || tail === lastEmitted) return '';
      return tail;
    },
  };
}
