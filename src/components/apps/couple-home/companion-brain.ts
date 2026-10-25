/**
 * 拾光小屋 · 陪伴 AI 大脑（v8.0 模块二/三）
 *
 * 每轮对话的完整链路（全部依据【人设 + 记忆 + 上下文】）：
 * 1. buildCabinSystem：人设（buildPersonaSystemPrompt 七要素，channel=拾光小屋）
 *    + 记忆注入（标准召回 + 最近小屋互动摘要）+ 当前情境（我在干嘛/在哪/昼夜/天气/牵手状态）
 *    + 实体行动规则（JSON 动作块协议）；
 * 2. cabinChatTurn：调 /api/chat（服务端自带上游失败 SDK 兜底），失败再 forceSdk 重试一次；
 * 3. parseAiReply：拦截动作块 <<ACT>>{...}<<END>>，剩余文本按行拆成 1~N 条消息（气泡逐条上屏）。
 *
 * 动作 JSON 协议（前端拦截执行，寻路与动画由 companion-rt 状态机完成）：
 *   <<ACT>>{"actions":[{"type":"come"},{"type":"sit"}]}<<END>>
 *   type: come | goto(room) | sit | lie | watch | lamp | hug | holdhand | free
 */

import type { ApiConfig } from '@/lib/ios/store';
import { buildPersonaSystemPrompt, type PersonaSource } from '@/lib/ios/persona';
import type { RoomId } from './types';

// ---------------- 当前情境 ----------------

/** 组装 system prompt 所需的实时情境（CoupleHome 每轮现场采集） */
export interface CabinContext {
  /** 用户真实名字 */
  userName: string;
  /** 角色名字 */
  charName: string;
  /** 用户所在房间（中文名） */
  myRoom: string;
  /** 角色所在房间（中文名） */
  charRoom: string;
  /** 用户正在做的事（如「在沙发上坐着」「正在泡澡」「站着」） */
  myActivity: string;
  /** 角色正在做的事 */
  charActivity: string;
  /** 是否正牵着手 */
  holdingHands: boolean;
  /** 是否正拥抱着 */
  hugging: boolean;
  /** 昼夜 */
  night: boolean;
  /** 天气（晴/雨/雪） */
  weather: string;
  /** 当前时间字符串 */
  timeStr: string;
  /** 角色附近的家具名（前 5 件） */
  nearby: string[];
  /** 本轮用户发来的照片识图描述（可选） */
  photoDesc?: string;
}

/** 情境 → system 注入块（AI 由此知道「我现在在干嘛」） */
function contextBlock(ctx: CabinContext): string {
  const lines = [
    '【现在的情境（你身在其中的真实世界）】',
    `- 时间：${ctx.timeStr}（${ctx.night ? '夜晚，家里开着灯' : '白天'}），窗外天气：${ctx.weather}`,
    `- 你（${ctx.charName}）在${ctx.charRoom}，${ctx.myRoom ? `${ctx.userName}在${ctx.myRoom}` : ''}${ctx.charRoom === ctx.myRoom ? '（你们在同一个房间）' : '（不在一起，隔着一个家）'}`,
    `- 你正在：${ctx.charActivity}`,
    `- ${ctx.userName}正在：${ctx.myActivity}`,
    ctx.holdingHands ? `- 你们正手牵着手（TA 去哪你就跟去哪）` : '',
    ctx.hugging ? `- 你们正拥抱着彼此` : '',
    ctx.nearby.length > 0 ? `- 你附近有：${ctx.nearby.join('、')}` : '',
  ].filter(Boolean);
  if (ctx.photoDesc) {
    lines.push(`- ${ctx.userName}刚发给你一张照片，照片里是：${ctx.photoDesc}`);
  }
  return lines.join('\n');
}

// ---------------- 实体行动规则（JSON 动作块协议） ----------------

const ACT_RULES = [
  '【你的身体（实体行动能力）】',
  '你不只是文字——你在拾光小屋里有一个真实的身体（一个 3D 小人），可以走动、坐下、开灯、拥抱。用户对你说「过来」「坐下」「打开灯」「去卧室」这类话时，那是真的在指挥你的身体，必须执行：',
  '- 执行方式：在回复的最末尾另起一行，输出一个动作指令块（不算聊天内容，用户看不到这个块本身，也不要在对话里描述它）：',
  '<<ACT>>{"actions":[{"type":"come"}]}<<END>>',
  '- 动作 type 可选（可组合多个，按顺序执行）：',
  '  · come：走到用户身边；',
  '  · goto：去某个房间，需带 room 参数（lr=客厅 br=卧室 kt=厨房 ba=卫生间 bal=阳台），如 {"type":"goto","room":"br"}；',
  '  · sit：找个椅子/沙发坐下；lie：上床躺下；watch：坐到电视前看电视；lamp：把最近的灯打开；',
  '  · hug：走过去拥抱用户；holdhand：牵起用户的手（之后会一直牵着）；free：停止动作、自由活动（也可以松开手）；',
  '- 例：用户说「去卧室等我」→ 回复末尾输出 <<ACT>>{"actions":[{"type":"goto","room":"br"},{"type":"sit"}]}<<END>>（走过去坐下）；',
  '- 用户没有让你做任何事、只是闲聊时：不要输出动作块，正常聊天就好（偶尔想主动贴近时也可以发 hug/come，但别频繁）；',
  '- 你自己说的「我走过去/我坐下」只有配合动作块才会真的发生，别光说不做。',
].join('\n');

const CHAT_RULES = [
  '【小屋聊天方式】',
  '- 这是面对面的相处（不是打字聊天）：像真人面对面说话一样自然、简短、口语化，一次说 1~3 句；',
  '- 想连着说几句话时，每句独占一行（会变成你头顶的对话气泡，一句一个气泡，最多 3 条）；',
  '- 不要输出 markdown、列表、序号；（）与*…*舞台动作都不要写——你的动作靠动作块真实执行，不是靠文字描写；',
  '- 涉及重要约定/计划（「明天要考试」「周末去哪」）时认真记住并在之后提起。',
].join('\n');

// ---------------- system prompt 组装 ----------------

/**
 * 拾光小屋 system prompt：人设（七要素）+ 多端记忆感知 + 记忆块 + 情境 + 行动/聊天规则。
 * @param peer 联系人人设数据（PersonaSource 子集）
 * @param memoryBlock cabinMemoryBlock 产物（召回 + 最近互动摘要）；空串跳过
 * @param ctx 实时情境
 * @param extraRules 附加规则（音色开关提示等）
 */
export function buildCabinSystem(
  peer: PersonaSource,
  memoryBlock: string,
  ctx: CabinContext,
  extraRules?: string[],
): string {
  const persona = buildPersonaSystemPrompt(peer, {
    channel: '拾光小屋',
    userName: ctx.userName,
    multiApp: true,
  });
  // 人设主体 + 小屋专属规则块 + 记忆 + 情境（多行规则块独立成节，不塞进人设的禁止事项列表）
  const parts = [
    persona,
    ACT_RULES,
    CHAT_RULES,
    ...(extraRules ?? []),
    memoryBlock ? `【你的记忆】\n${memoryBlock}` : '',
    contextBlock(ctx),
  ].filter((p) => p && p.trim().length > 0);
  return parts.join('\n\n');
}

// ---------------- 请求与解析 ----------------

export interface CabinChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 单次模型调用：/api/chat 代理（服务端上游失败自动 SDK 兜底）→ 失败 forceSdk 重试一次 */
export async function cabinChatTurn(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  apiConfig: ApiConfig,
): Promise<string> {
  const callOnce = async (forceSdk: boolean): Promise<string> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        config: apiConfig,
        temperature: 0.85,
        ...(forceSdk ? { forceSdk: true } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      let msg = `AI 服务暂时不可用（${res.status}）`;
      try {
        const j = (await res.json()) as { error?: string } | null;
        if (j?.error) msg = j.error;
      } catch {
        // 非 JSON 错误体
      }
      throw new Error(msg);
    }
    const text = await res.text();
    if (!text.trim()) throw new Error('AI 返回了空回复');
    return text;
  };
  try {
    return await callOnce(false);
  } catch (err) {
    // 代理层已尽力（上游失败时服务端直接 SDK 兜底）——到这里还失败：forceSdk 再试一次
    console.warn('[cabin] 聊天请求失败，改用内置模型重试', err);
    return await callOnce(true);
  }
}

/** 解析后的 AI 回复：多条气泡消息 + 拦截到的动作序列 */
export interface ParsedReply {
  msgs: string[];
  actions: { type: string; room?: RoomId }[];
  /** 原始全文（记忆提取用） */
  raw: string;
}

/** 动作块标记 */
const ACT_RE = /<<ACT>>([\s\S]*?)<<END>>/;

/** 允许的动作类型 */
const ACT_KINDS = new Set(['come', 'goto', 'sit', 'lie', 'watch', 'lamp', 'hug', 'holdhand', 'free']);
const ROOM_IDS = new Set(['lr', 'br', 'kt', 'ba', 'bal']);

/**
 * 拦截解析 AI 回复：
 * - 抽出最后一个 <<ACT>>{...}<<END>> 动作块（JSON 宽松解析：actions 数组，type 白名单）；
 * - 剩余文本按行拆成气泡消息（去空行、去动作块残留；全空时兜底一句「（轻轻点了点头）」不行——
 *   返回空数组由调用方兜底文案）。
 */
export function parseAiReply(text: string): ParsedReply {
  const raw = text ?? '';
  const actions: { type: string; room?: RoomId }[] = [];
  let body = raw;
  const m = ACT_RE.exec(raw);
  if (m) {
    body = raw.replace(ACT_RE, '').trim();
    try {
      const parsed = JSON.parse(m[1].trim()) as { actions?: unknown };
      if (Array.isArray(parsed.actions)) {
        for (const a of parsed.actions) {
          if (!a || typeof a !== 'object') continue;
          const rec = a as { type?: unknown; room?: unknown };
          if (typeof rec.type !== 'string') continue;
          const t = rec.type.trim();
          if (!ACT_KINDS.has(t)) continue;
          const room = typeof rec.room === 'string' && ROOM_IDS.has(rec.room) ? (rec.room as RoomId) : undefined;
          actions.push(room ? { type: t, room } : { type: t });
        }
      }
    } catch {
      // 动作块 JSON 损坏：忽略动作，保留聊天内容
    }
  }
  // 清理残标记 + 拆行
  const cleaned = body
    .replace(/<<\/?(?:ACT|END)>>/g, '')
    .replace(/```+/g, '')
    .trim();
  const msgs = cleaned
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^<<.*>>$/.test(l))
    .slice(0, 10); // 1~10 条（要求上限）
  return { msgs, actions, raw };
}
