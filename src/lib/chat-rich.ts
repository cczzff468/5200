/**
 * AI 发送特殊消息（红包 / 转账 / 亲属卡 / 位置 / 表情包）的标记约定与解析（微信 / QQ 共用）：
 *
 * - AI 在回复文本中按约定输出标记（如 [红包:8.88:恭喜发财]），落盘前由 parseRichParts 解析成
 *   对应类型的消息数据，渲染层复用各 App 已有的卡片气泡（与用户手动发送完全同款、同款交互），
 *   纯本地模拟，不涉及真实资金流转、不跳转第三方支付；
 * - 表情包标记 [表情包:ID] 从用户本地添加的表情包（wx-stickers / qq-stickers）里按 ID 匹配，
 *   每个表情有唯一 ID；ID 找不到时回退显示文字「[表情包]」；
 * - mergeRichSegments：回复条数连发时消息按「换行 / 句末标点」切分成多条，标记内部的标点
 *   （祝福语里的「！」等）会把一个标记切成两段——把含未闭合标记的段与后续段合并，保证解析成功；
 * - prettifyRichText：流式渲染期把完整标记换成简短占位文字（[红包]/[转账]/…）、截掉还没输出完的
 *   半截标记，避免原始标记文本在气泡里闪现（流结束落盘后即为真实卡片消息）；
 * - buildRichRules：追加到角色人设 system 提示词的约定规则（含当前可用的表情包 ID 清单）。
 */

import type { Sticker } from './ios/stickers';

// ---------------- 标记解析结果 ----------------

/** 红包标记：[红包:金额:祝福语] */
export interface RichRedpacket {
  kind: 'redpacket';
  amount: number;
  blessing: string;
}
/** 转账标记：[转账:金额:备注] */
export interface RichTransfer {
  kind: 'transfer';
  amount: number;
  note: string;
}
/** 亲属卡标记：[亲属卡:每月额度:留言] */
export interface RichFamily {
  kind: 'family';
  monthlyLimit: number;
  message: string;
}
/** 位置标记：[位置:地点名:经纬度或地址] */
export interface RichLocation {
  kind: 'location';
  name: string;
  coords: string;
}
/** 表情包标记：[表情包:表情ID]（parseRichParts 保证 ID 在 stickers 里能找到） */
export interface RichSticker {
  kind: 'sticker';
  stickerId: string;
}

export type RichMsg = RichRedpacket | RichTransfer | RichFamily | RichLocation | RichSticker;

/** 一段回复的解析结果：普通文字 或 富消息标记 */
export type RichPart = { type: 'text'; text: string } | { type: 'rich'; rich: RichMsg };

// ---------------- 标记正则 ----------------

/** 完整标记（中英文冒号兼容；内容里不允许出现「]」） */
const RICH_RE = /\[(红包|转账|亲属卡|位置|表情包)(?:[:：]([^\][]*))?\]/g;
/** 段尾未闭合的半截标记（AI 还在逐字输出 / 被切分边界切开） */
const OPEN_TAIL_RE = /\[(?:红包|转账|亲属卡|位置|表情包)(?:[:：][^\][]*)?$/;

function parseAmount(v: string | undefined): number {
  const n = Number((v ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : NaN;
}

/** 解析单个标记 → 富消息数据；金额非法 / 名称缺失等格式错误时返回 null（调用方回退为文本显示） */
function parseMarker(kind: string, inner: string): RichMsg | null {
  const segs = inner.split(/[:：]/);
  switch (kind) {
    case '红包': {
      const amount = parseAmount(segs[0]);
      if (!Number.isFinite(amount)) return null;
      return { kind: 'redpacket', amount, blessing: segs.slice(1).join(':').trim() || '恭喜发财，大吉大利' };
    }
    case '转账': {
      const amount = parseAmount(segs[0]);
      if (!Number.isFinite(amount)) return null;
      return { kind: 'transfer', amount, note: segs.slice(1).join(':').trim() };
    }
    case '亲属卡': {
      const monthlyLimit = parseAmount(segs[0]);
      if (!Number.isFinite(monthlyLimit)) return null;
      return { kind: 'family', monthlyLimit, message: segs.slice(1).join(':').trim() };
    }
    case '位置': {
      const name = (segs[0] ?? '').trim();
      if (!name) return null;
      return { kind: 'location', name, coords: segs.slice(1).join(':').trim() };
    }
    case '表情包': {
      const stickerId = inner.trim();
      return stickerId ? { kind: 'sticker', stickerId } : null;
    }
    default:
      return null;
  }
}

/**
 * 把一段回复文本解析为「文字 + 富消息」混合序列：
 * - 标记前后的文字保留为独立文本段（AI 偶尔把标记写在一句话中间也不丢内容）；
 * - 表情包标记按 ID 在 stickers 里查找：找不到时该段回退显示文字「[表情包]」；
 * - 格式错误的标记（金额不是数字等）原样作为文本显示。
 */
export function parseRichParts(seg: string, stickers: Sticker[] | null): RichPart[] {
  const parts: RichPart[] = [];
  let last = 0;
  for (const m of seg.matchAll(RICH_RE)) {
    const before = seg.slice(last, m.index).trim();
    if (before) parts.push({ type: 'text', text: before });
    const rich = parseMarker(m[1], m[2] ?? '');
    if (!rich) {
      parts.push({ type: 'text', text: m[0] }); // 格式错误：回退显示标记原文
    } else if (rich.kind === 'sticker') {
      const hit = (stickers ?? []).some((s) => s.id === rich.stickerId);
      parts.push(hit ? { type: 'rich', rich } : { type: 'text', text: '[表情包]' }); // ID 找不到：回退显示文字
    } else {
      parts.push({ type: 'rich', rich });
    }
    last = m.index + m[0].length;
  }
  const tail = seg.slice(last).trim();
  if (tail) parts.push({ type: 'text', text: tail });
  return parts;
}

/**
 * 修复被切分边界切碎的标记：标记内的句末标点（祝福语「生日快乐！」的「！」）会把一个标记切成
 * 两段——把以未闭合标记结尾的段与其后续段循环合并，直到该段闭合为止。
 */
export function mergeRichSegments(segs: string[]): string[] {
  const out = [...segs];
  let i = 0;
  while (i < out.length - 1) {
    if (OPEN_TAIL_RE.test(out[i])) {
      out[i] = `${out[i]}\n${out[i + 1]}`;
      out.splice(i + 1, 1);
      // 不前进：合并后的段可能仍未闭合（标记被切成三段以上），继续吞下一段
    } else {
      i++;
    }
  }
  return out;
}

/** 流式渲染期：完整标记 → 简短占位文字；还没输出完的半截标记截掉（落盘后即为真实卡片） */
export function prettifyRichText(text: string): string {
  return text
    .replace(RICH_RE, (_all, kind: string) => `[${kind}]`)
    .replace(OPEN_TAIL_RE, '');
}

/**
 * 追加到角色人设 system 提示词的「特殊消息」约定规则（微信 / QQ 各自调用，extraRules 透传）：
 * - 标记语法与示例；
 * - 表情包清单（ID:意思，AI 只能从这里选 ID，最多列 30 个防止提示词过长）；
 * - 没有收藏表情包时不给表情包规则，AI 自然不会输出该标记。
 */
export function buildRichRules(stickers: Sticker[]): string[] {
  const rules = [
    '【特殊消息】想发红包/转账/亲属卡/位置/表情包时，在回复里输出对应标记——标记单独占一行，前后不要加引号、括号说明或代码块，不要解释：' +
      '[红包:金额:祝福语]（如 [红包:8.88:恭喜发财]）；[转账:金额:备注]（如 [转账:66:昨天的饭钱]）；' +
      '[亲属卡:每月额度:留言]（如 [亲属卡:520:给你办的卡，随便花]）；[位置:地点名:经纬度或地址]（如 [位置:上海外滩:121.48,31.23]）' +
      (stickers.length > 0 ? '；[表情包:表情ID]（从我收藏的表情包里选，只能用清单里的 ID）' : '') +
      '。金额和额度写数字（可带小数）；标记格式不对会发送失败，务必严格照写；没有合适的理由时不要发这些。',
  ];
  if (stickers.length > 0) {
    rules.push(
      '【表情包清单】（ID:意思）：' +
        stickers
          .slice(0, 30)
          .map((s) => `${s.id}${s.meaning ? `:${s.meaning}` : ''}`)
          .join('；')
    );
  }
  return rules;
}
