import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 通话挂断后 AI 续聊文字（微信 / QQ / 电话 App 三端共用）：
 *
 * 挂断是通话的延续而不是终点——AI 按人设像平时发消息那样，紧接着再发 1~2 条文字：
 * 接着说通话里没聊完的话茬、补一句叮嘱/约定、表达关心，或对「被挂断/没接通」做自然反应。
 * 三种挂断场景共用本 API（由前端引擎区分场景注入说明）：
 *   1. AI 主动挂断（ai-hangup）；2. 用户挂断（hangup / 来电被拒 missed-in·reject / 拨号取消 cancel）；
 *   3. 拨出去被 AI 拒接/未接（reject / no-answer——该场景的 afterText 由 /api/phone/answer 决策产出，不走这里）。
 *
 * 生成依据：人设 + 本次通话内容 + 相关记忆（前端动态召回注入）+ 最近聊天记录 + 时间感知。
 * 硬约束：不复读通话里说过的原话；语气符合人设与情绪；每条像真人随手发的短消息。
 *
 * POST { contact, number?, direction, endReason, connected, duration,
 *        transcript, recentChat, memoryBlock?, worldbookBlock?, timeBlock?, multiApp?, config? }
 * 返回 { messages: string[] } 或 { directOnly: true, messages: CallApiMessage[] }（内网 API 浏览器直连）。
 * 任何失败 → { messages: [] }（续聊是体验增强，静默失败，绝不阻塞挂断收尾与记忆总结）。
 */

import { buildPersonaSystemPrompt, type PersonaSource } from '@/lib/ios/persona';
import {
  type CallApiMessage,
  callUpstream,
  extractJsonObject,
  extractUpstreamConfig,
  isPrivateHost,
  normalizeHistory,
  parseInlineContact,
  sdkTurn,
} from '@/lib/ios/call-upstream';

/** 挂断场景说明（system 里向 AI 交代「这通电话是怎么结束的」） */
const SCENE_TEXT: Record<string, string> = {
  'ai-hangup': '你觉得聊得差不多了，自然告别后主动挂断了电话',
  hangup: '对方先挂断了电话',
  reject: '你打给对方，对方没有接（按掉了）',
  'missed-in': '你打给对方，响了很久都没人接，你把电话挂了',
  cancel: '对方拨给你，但还没接通就取消了',
};

function buildFollowupSystemPrompt(
  peer: PersonaSource,
  scene: string,
  connected: boolean,
  durationLabel: string,
  hasChat: boolean,
  multiApp?: boolean
): string {
  return buildPersonaSystemPrompt(peer, {
    channel: '挂断电话后的文字消息',
    userName: null,
    multiApp,
    extraRules: [
      `你刚结束一通语音通话（${scene}${connected ? `，通话时长 ${durationLabel}` : ''}）。现在像平时发消息那样，主动给对方发 1~2 条文字，自然衔接这次通话：`,
      connected
        ? '可以接着说通话里没聊完的话茬、补一句刚才没说完的事、叮嘱/约定/关心，或顺着通话里提到的事聊两句新的；'
        : '这通电话没有真正聊起来：结合你的人设、你们的关系和最近聊天，发一条自然的消息（比如关心对方为什么没接/怎么挂了、带点小情绪或撒娇、约下次再聊）；',
      '绝对不要复读通话里已经说过的原话；不要自我介绍；不要说「刚才我们通话了」这类出戏的话——就像平时聊微信/QQ 一样接着说；',
      '语气完全符合你的人设和此刻情绪（聊得开心就热络、被匆匆挂断可以有点小抱怨、深夜可以带着困意）；',
      '每条消息像真人随手发的：口语化、简短（一条一般 1~2 句），可以有语气词；不要 markdown 符号、不要引号包裹、不要表情符号；',
      hasChat ? '结合下方最近聊天内容让消息更有来由。' : '没有最近聊天记录时，就纯粹基于人设和这次通话发挥。',
      '严格输出一个 JSON 对象，不要输出任何其他文字：',
      '{"messages":["第一条","第二条"]}',
      'messages 数组放 1~2 条消息文本（通常 2 条更自然，内容简短时 1 条也可以）。',
    ],
  });
}

/** 生成结果清洗：JSON 优先（宽松平衡块），失败按行拆；统一去标记/符号/包裹引号，最多 2 条 */
function normalizeFollowup(raw: string): string[] {
  const clean = (s: string) =>
    s
      .replace(/〔挂断〕|【挂断】|\[挂断\]|（挂断）|\(挂断\)/g, '')
      .replace(/[*_`#>~]/g, '')
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .trim()
      .slice(0, 200);
  const obj = extractJsonObject(raw);
  if (obj && Array.isArray(obj.messages)) {
    const out = (obj.messages as unknown[])
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map(clean)
      .filter(Boolean);
    if (out.length > 0) return out.slice(0, 2);
  }
  return raw
    .split('\n')
    .map((l) => clean(l))
    .filter(Boolean)
    .slice(0, 2);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ messages: [] });
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  // 对端身份：前端直传联系人（kind='user' 是机主本人，不产生续聊）
  const inline = parseInlineContact(root.contact);
  if (!inline || inline.kind === 'user') {
    return NextResponse.json({ messages: [] });
  }
  const peer: PersonaSource = {
    name: inline.name,
    kind: inline.kind,
    gender: inline.gender,
    age: inline.age,
    occupation: inline.occupation,
    region: inline.region,
    persona: inline.persona,
    background: inline.background,
    relation: inline.relation,
    relationToUser: inline.relationToUser,
    birthday: inline.birthday,
  };

  const direction = root.direction === 'in' ? 'in' : 'out';
  const endReasonRaw = typeof root.endReason === 'string' ? root.endReason.trim() : '';
  const endReason = SCENE_TEXT[endReasonRaw] ? endReasonRaw : 'hangup';
  const connected = root.connected === true;
  const duration = typeof root.duration === 'number' && Number.isFinite(root.duration) ? Math.max(0, Math.floor(root.duration)) : 0;
  const durationLabel = duration >= 60 ? `${Math.floor(duration / 60)} 分 ${duration % 60} 秒` : `${duration} 秒`;
  const transcript = normalizeHistory(root.transcript);
  const recentChat = normalizeHistory(root.recentChat);

  const system = buildFollowupSystemPrompt(
    peer,
    SCENE_TEXT[endReason],
    connected,
    durationLabel,
    recentChat.length > 0,
    root.multiApp === true || root.multiApp === false ? (root.multiApp as boolean) : undefined
  );
  // 记忆 / 世界书 / 时间感知：前端组装注入（与通话轮次同一套来源，人设 > 世界书 > 记忆 > 时间）
  const memoryBlock = typeof root.memoryBlock === 'string' ? root.memoryBlock.trim() : '';
  const worldbookBlock = typeof root.worldbookBlock === 'string' ? root.worldbookBlock.trim() : '';
  const timeBlock = typeof root.timeBlock === 'string' ? root.timeBlock.trim() : '';
  const systemFull = [system, worldbookBlock, memoryBlock, timeBlock].filter(Boolean).join('\n\n');

  // 触发消息：把「最近聊天 + 通话转写」打包成一段上下文（user/assistant 双方已标注），避免与消息角色混淆
  const recap: string[] = [];
  if (recentChat.length > 0) {
    recap.push('【通话前的最近聊天】');
    recap.push(...recentChat.map((m) => `${m.role === 'user' ? '机主' : '你'}：${m.content}`));
    recap.push('');
  }
  if (transcript.length > 0) {
    recap.push('【这次通话里你们说的话】');
    recap.push(...transcript.map((m) => `${m.role === 'user' ? '机主' : '你'}（说出口的话）：${m.content}`));
    recap.push('');
  }
  recap.push('（通话已结束，请输出你要发给对方的文字消息 JSON）');
  const messages: CallApiMessage[] = [{ role: 'system', content: systemFull }, { role: 'user', content: recap.join('\n') }];

  const fail = () => NextResponse.json({ messages: [] });
  const viaSdk = async (): Promise<NextResponse> => {
    try {
      return NextResponse.json({ messages: normalizeFollowup(await sdkTurn(messages)), viaSdk: true });
    } catch {
      return fail();
    }
  };

  const config = extractUpstreamConfig(root.config);
  if (!config) return viaSdk();
  let hostname = '';
  try {
    hostname = new URL(config.baseUrl).hostname;
  } catch {
    return viaSdk();
  }
  // 内网 / 本机地址：云端不可达 → 浏览器直连（与 turn 路由同策略，保住用户自己的模型）
  if (isPrivateHost(hostname)) {
    return NextResponse.json({ directOnly: true, messages });
  }
  const result = await callUpstream(config, messages);
  if (result.reply) {
    const parsed = normalizeFollowup(result.reply);
    if (parsed.length > 0) return NextResponse.json({ messages: parsed });
  }
  // 上游故障 / 解析不出：内置模型兜底，再失败静默
  return viaSdk();
}
