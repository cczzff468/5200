'use client';

/**
 * 深度思考（微信 / QQ / 信息三端单聊共用，按联系人隔离）：
 *
 * - 开关持久化在 IndexedDB kv store（ios-phone-db 的 kv，键 = deep-think:<contactId>，
 *   天然按联系人隔离——不同联系人各自记忆自己的开关；经 @/lib/ios/idb-kv 的内存写穿层
 *   同步读写，开机门控后组件层 kvGetRaw 一定命中，IndexedDB 异步落盘不丢）；
 * - 无论开关开还是关，每次发消息都在 system 里注入【深度思考】指令：AI 必须先用
 *   [思考]…[/思考] 包裹思考过程放在回复最开头，再写正文——开关只控制「前端要不要
 *   把思考过程渲染出来」（关闭 = 解析后直接丢弃，用户只看到最终正文），不改变模型行为；
 * - 流式剥离：chat-stream-store 的 onDelta 统一过 createThinkFilter 状态机，
 *   [思考]块不进正文累计（raw）也不进分段器（createReplySegmentScanner），思考内容
 *   单独收集、finalize 时经 ChatStreamResult.thinking 交给各端挂到本轮第一条 AI 消息；
 * - 非流式兜底：各端 buildReplyMsgs 入口再过一遍 extractThinkBlocks（bg 关页接力等
 *   绕过流总线的路径拿到的整段文本里若带 [思考] 块，就地剥掉防泄漏进气泡）；
 * - 标签跨增量分片安全：开始/结束标记被网络分片拆开（如「[思」「考]」分两个 delta）时
 *   状态机保留可能的半截前缀不输出，等下个增量拼齐后再判定；流结束时停在思考里
 *   （未闭合）的残量全部归入思考、不进正文。
 */

import { useSyncExternalStore } from 'react';
import { kvGetRaw, kvSetRaw } from './ios/idb-kv';

// ---------------- 开关持久化（IndexedDB kv，按联系人隔离） ----------------

/** kv 键前缀（+ contactId；不以 wx-/qq-/sms- 开头，不会被多账号作用域映射，按联系人全局生效） */
const KV_PREFIX = 'deep-think:';
/** 开关变更事件（本标签页即时刷新；订阅方 useSyncExternalStore 重读快照） */
const EVT = 'deep-think-change';

/** 读取某联系人的深度思考开关（未设置时默认关闭：思考过程解析后直接丢弃，只显示正文） */
export function getDeepThinkOn(contactId: string): boolean {
  if (!contactId) return false;
  return kvGetRaw<boolean>(`${KV_PREFIX}${contactId}`) === true;
}

/** 保存某联系人的深度思考开关（IndexedDB kv 写穿 + 派发变更事件，订阅方即时刷新渲染） */
export function setDeepThinkOn(contactId: string, on: boolean): void {
  if (!contactId) return;
  kvSetRaw(`${KV_PREFIX}${contactId}`, on);
  try {
    window.dispatchEvent(new CustomEvent(EVT, { detail: { contactId, on } }));
  } catch {
    // 事件派发失败忽略（下一次渲染仍会读到最新值）
  }
}

/** 订阅开关变化：本会话设置切换（EVT）触发重读快照 */
function subscribeDeepThink(notify: () => void): () => void {
  window.addEventListener(EVT, notify);
  return () => {
    window.removeEventListener(EVT, notify);
  };
}

/**
 * 联系人级深度思考开关（渲染订阅版）：useSyncExternalStore 订阅 kv 快照，
 * 设置页切换开关后历史消息的思维链卡片同步显隐（关闭 = 全部丢弃不渲染）。
 */
export function useDeepThinkOn(contactId: string): boolean {
  return useSyncExternalStore(
    subscribeDeepThink,
    () => getDeepThinkOn(contactId),
    // SSR 阶段无 kv：与默认态（关闭）保持一致
    () => false,
  );
}

// ---------------- 提示词规则（始终注入，与开关状态无关） ----------------

/**
 * 注入聊天 system 的深度思考指令：无论开关开还是关都注入（用户要求模型后台始终深度思考），
 * 强制 AI 先输出 [思考]…[/思考] 包裹的思考过程（回复最开头），再输出正文。
 * 放在 system 末尾（最新指令更受模型关注），并强调「无论回复长短都必须思考」——
 * 短回复场景（“在吗”→“在的”）模型最容易跳过思考块，必须显式钉死。
 */
export const DEEP_THINK_RULE =
  '【深度思考（每条回复必做）】每次回复前，请先进行深度思考：认真理解对方这句话的意思与情绪，结合你们的关系、过往记忆和当前情境，想清楚怎么回应最自然、最符合你的性格，然后再组织语言。' +
  '输出格式（严格遵守）：每条回复的第一个内容必须是 [思考] 标记，把你的思考过程（分析、回忆、斟酌语气）写在 [思考] 和 [/思考] 之间，[/思考] 之后紧接着写你真正要发送的聊天正文。' +
  '无论回复长短、哪怕只回一个字，都要先写思考块；思考要真实自然，不要在思考里把正文预先写一遍；正文里不要出现任何思考痕迹或这两个标记；' +
  '这两个标记只是给你理清思路用的，系统会在展示前自动摘除，对方看不到它们，请放心使用。' +
  '除思考块之外，正文照常遵守其他所有消息规则。';

/** 开关说明文案（设置页行下的小字，三端共用同一句式） */
export function deepThinkCaption(on: boolean): string {
  return on
    ? '开启后，对方每条回复都会先深度思考，气泡上方可展开查看思考过程。'
    : '已关闭：对方仍会在后台深度思考，但思考过程不显示，你只看到最终回复。';
}

// ---------------- 思考块标签与流式剥离状态机 ----------------

/** 开始标记（用户指定格式，全端统一） */
const OPEN = '[思考]';
/** 结束标记 */
const CLOSE = '[/思考]';

/** 单次 push 的产出：本次新确定的正文 / 思考增量 */
export interface ThinkDelta {
  text: string;
  thinking: string;
}

export interface ThinkFilter {
  /** 喂入流式增量：返回本次可以安全放出的正文与归入思考的内容（标签本身两边都不属于） */
  push: (delta: string) => ThinkDelta;
  /** 流结束：归位残量（未闭合的思考整段归入思考；正文侧可能的半截开始标记按原文放出） */
  finish: () => ThinkDelta;
}

/** s 的尾部是否可能是一个标记的开头前缀（跨增量的半截标记）：返回保留长度（0 = 无需保留） */
function tailPartialTagLen(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1);
  for (let k = max; k > 0; k--) {
    if (s.slice(s.length - k) === tag.slice(0, k)) return k;
  }
  return 0;
}

/**
 * 流式思考剥离状态机（chat-stream-store 的 onDelta 统一使用）：
 *
 * - 正文态（out）：透传一切文本；遇到 [思考] 转思考态，标签丢弃；
 * - 思考态（in）：累积内容归入 thinking；遇到 [/思考] 转回正文态，标签丢弃；
 * - 半截标签保护：增量末尾停在标记前缀中间（「[思」「[/思」）时先扣住不输出，
 *   下个增量拼齐再判定（拼不齐 = 普通文本，finish 时按原文归还正文）；
 * - 输出给调用方的 text 永远不含 [思考]/[/思考] 标签与思考内容，可安全进
 *   正文累计（raw）与分段器（createReplySegmentScanner）。
 */
export function createThinkFilter(): ThinkFilter {
  let buf = '';
  let inside = false;

  const drain = (outText: string[], outThink: string[]): void => {
    for (;;) {
      if (!inside) {
        const idx = buf.indexOf(OPEN);
        if (idx >= 0) {
          if (idx > 0) outText.push(buf.slice(0, idx));
          buf = buf.slice(idx + OPEN.length);
          inside = true;
          continue;
        }
        // 无完整开始标记：尾部可能是半截标记，扣住等下个增量
        const hold = tailPartialTagLen(buf, OPEN);
        const emitLen = buf.length - hold;
        if (emitLen > 0) outText.push(buf.slice(0, emitLen));
        buf = buf.slice(emitLen);
        return;
      }
      const idx = buf.indexOf(CLOSE);
      if (idx >= 0) {
        if (idx > 0) outThink.push(buf.slice(0, idx));
        buf = buf.slice(idx + CLOSE.length);
        inside = false;
        continue;
      }
      // 思考态：同样扣住尾部可能的半截结束标记，其余归入思考
      const hold = tailPartialTagLen(buf, CLOSE);
      const emitLen = buf.length - hold;
      if (emitLen > 0) outThink.push(buf.slice(0, emitLen));
      buf = buf.slice(emitLen);
      return;
    }
  };

  return {
    push(delta) {
      if (!delta) return { text: '', thinking: '' };
      buf += delta;
      const textParts: string[] = [];
      const thinkParts: string[] = [];
      drain(textParts, thinkParts);
      return { text: textParts.join(''), thinking: thinkParts.join('') };
    },
    finish() {
      const textParts: string[] = [];
      const thinkParts: string[] = [];
      if (inside) {
        // 停在思考里（模型没写 [/思考] 就被截断）：全部归入思考，不进正文
        if (buf) thinkParts.push(buf);
      } else {
        // 正文残量（含拼不齐的半截标记原文）按原文放出
        if (buf) textParts.push(buf);
      }
      buf = '';
      inside = false;
      return { text: textParts.join(''), thinking: thinkParts.join('') };
    },
  };
}

/**
 * 一次性解析整段文本（非流式兜底）：提取全部 [思考]…[/思考] 块并从正文剔除。
 * 未闭合的思考块整段归入 thinking；正文里不再残留任何思考痕迹与标签。
 * bg 关页接力等绕过流总线的路径在 buildReplyMsgs 入口调用，防思考内容泄漏进气泡。
 */
export function extractThinkBlocks(text: string): ThinkDelta {
  if (!text || (!text.includes(OPEN) && !text.includes(CLOSE))) return { text, thinking: '' };
  const f = createThinkFilter();
  const r1 = f.push(text);
  const r2 = f.finish();
  return {
    text: (r1.text + r2.text).replace(/^\n+/, ''),
    thinking: (r1.thinking + r2.thinking).trim(),
  };
}
