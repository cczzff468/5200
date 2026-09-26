'use client';

/**
 * 挂断后 AI 续聊文字（三端共用客户端封装）：
 *
 * 通话引擎在挂断收尾时调用，生成 1~2 条「AI 继续发的文字」——
 * 依据：人设 + 本次通话内容 + 相关记忆（动态召回）+ 最近聊天 + 时间感知（服务端 /api/phone/followup 组装）。
 * 呈现由宿主负责：微信/QQ 以聊天消息落盘，电话 App 以语音留言呈现（无聊天面板，与拒接解释同机制）。
 *
 * 续聊文字同时并入通话转写 → 挂断总结把「通话内容 + 续聊文字」一起沉淀入记忆
 * （与文字记忆同池互通、按联系人隔离）；下次聊天或通话时都能引用。
 *
 * 任何失败静默返回 []：续聊是体验增强，绝不阻塞挂断收尾。
 */

import { useSettings } from './store';
import { directChatStream } from './direct-api';

/** 前端直传的联系人资料（与 turn API 的 InlineContact 同形；联系人存浏览器本地 IndexedDB） */
export interface CallFollowupContact {
  name: string;
  kind: string;
  gender: string | null;
  age: string | null;
  occupation: string | null;
  region: string | null;
  relation: string | null;
  relationToUser: string | null;
  birthday: string | null;
  persona: string | null;
  background: string | null;
}

export interface CallFollowupTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CallFollowupPayload {
  contact: CallFollowupContact | null;
  direction: 'out' | 'in';
  /** 挂断原因：ai-hangup / hangup / reject / missed-in / cancel（服务端映射场景说明） */
  endReason: string;
  connected: boolean;
  duration: number;
  /** 本次通话转写（user=机主 / assistant=AI；未接通传 []） */
  transcript: CallFollowupTurn[];
  /** 通话前的最近聊天上下文（引擎发起时快照；电话 App 无聊天面板传 []） */
  recentChat: CallFollowupTurn[];
  /** 动态召回的记忆块（宿主按联系人组装；互通开关范围已过滤） */
  memoryBlock?: string;
  worldbookBlock?: string;
  timeBlock?: string;
  multiApp?: boolean;
}

/** 从模型文本提取续聊消息（宽松：JSON 平衡块优先，失败按行拆；去标记/符号/包裹引号，最多 2 条） */
export function parseFollowupText(raw: string): string[] {
  const clean = (s: string) =>
    s
      .replace(/〔挂断〕|【挂断】|\[挂断\]|（挂断）|\(挂断\)/g, '')
      .replace(/[*_`#>~[\]]/g, '')
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .trim()
      .slice(0, 200);
  const start = raw.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const obj = JSON.parse(raw.slice(start, i + 1)) as { messages?: unknown };
            if (obj && Array.isArray(obj.messages)) {
              const out = (obj.messages as unknown[])
                .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
                .map(clean)
                .filter(Boolean);
              if (out.length > 0) return out.slice(0, 2);
            }
          } catch {
            // JSON 不完整：走按行兜底
          }
          break;
        }
      }
    }
  }
  return raw
    .split('\n')
    .map((l) => clean(l))
    .filter(Boolean)
    .slice(0, 2);
}

/** 请求挂断续聊文字（fire-and-forget 友好：所有失败静默返回 []，由调用方决定总结时序） */
export async function requestCallFollowup(p: CallFollowupPayload): Promise<string[]> {
  try {
    const res = await fetch('/api/phone/followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...p, config: useSettings.getState().apiConfig }),
    });
    const data = (await res.json()) as {
      messages?: unknown;
      directOnly?: boolean;
      error?: string;
    };
    // 内网 API：浏览器直连流式（与通话轮次同策略），取全量文本再解析
    if (res.ok && data.directOnly && Array.isArray(data.messages) && data.messages.length > 0) {
      try {
        const full = await directChatStream(useSettings.getState().apiConfig, data.messages as Parameters<typeof directChatStream>[1], () => undefined);
        return parseFollowupText(full);
      } catch {
        return [];
      }
    }
    if (res.ok && Array.isArray(data.messages)) {
      return (data.messages as unknown[])
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim().slice(0, 200))
        .slice(0, 2);
    }
    return [];
  } catch {
    return [];
  }
}
