import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * 电话 App · AI 通话对话轮次（微信 / QQ / 电话 App 三端共用）
 * POST { contact?: { name, kind, gender, age, occupation, region, relation, persona, background },
 *        number: string, greeting?: boolean,
 *        proactiveAttempt?: number,          // AI 主动开口：用户超过几秒没说话后的第 N 次主动（1 起）
 *        history: { role: 'user' | 'assistant', content: string }[],
 *        config: { baseUrl, apiKey, model, temperature, maxTokens } }
 * 返回 { reply, name } 或 { directOnly: true, messages, name }
 * 联系人资料由前端直传（联系人存浏览器本地 IndexedDB，服务端不查库）；不传则按陌生号码处理。
 *
 * 统一策略（只有一套逻辑，无内置模型）：
 * 永远使用设置 App「API 设置」里配置的 OpenAI 兼容接口；
 * - 公网地址 → 服务端代理转发（浏览器无感）；
 * - 内网 / 本机地址 → 返回 directOnly + 组装好的 messages，由浏览器直连
 *   （云端服务器不可达内网，见 src/lib/ios/direct-api.ts）。
 * 未配置 / 上游报错 → 返回友好错误，不再回退任何内置模型。
 *
 * 话量控制（三端统一）：每次说 1~5 句，具体句数由人设性格与当下情绪决定，不固定。
 */

import { buildPersonaSystemPrompt, type PersonaSource } from '@/lib/ios/persona';
import {
  type CallApiMessage,
  type InlineContact,
  callUpstream,
  cleanCallReply,
  extractUpstreamConfig,
  isPrivateHost,
  normalizeHistory,
  parseInlineContact,
  sdkTurn,
  unknownPersona,
} from '@/lib/ios/call-upstream';

/**
 * 组装通话场景 system prompt：七要素人设（名字/身份/性格/说话风格/背景/与用户的关系/禁止事项）
 * 由全 App 共用模块从联系人数据组装；这里只追加语音通话场景规则。
 * multiApp：跨 App 身份感知（前端按每联系人互通开关传入；undefined=不注入）。
 */
function buildCallSystemPrompt(
  peer: PersonaSource,
  greeting: boolean,
  /** AI 主动开口：用户几秒没说话后的第 N 次主动尝试（0/undefined = 正常轮次） */
  proactiveAttempt: number,
  npcExtra?: { ownerLabel?: string; npcCircle?: InlineContact['npcCircle']; ownerCard?: string[]; backgroundNotes?: string[] },
  multiApp?: boolean,
  /** 调用方附加规则（微信/QQ 语音通话注入主动挂断标记规则等；电话 App 复用同一套） */
  extraRules?: string[],
  /** 机主身份（前端直传）：名字/真名/昵称——人设注入【用户的称呼】段（软件上显示的名字只是昵称） */
  user?: { name: string | null; realName: string | null; nickname: string | null }
): string {
  const base = buildPersonaSystemPrompt(peer, {
    channel: '语音通话',
    userName: user?.name ?? null,
    userRealName: user?.realName ?? null,
    userNickname: user?.nickname ?? null,
    ...npcExtra,
    multiApp,
    extraRules: [
      '这是实时语音通话：用第一人称口语化说话，像真人打电话；每次只说 1~5 句——具体句数由你的人设性格和当下情绪决定：健谈外向的人自然多聊几句，高冷话少的人往往只说一两个短句；同一次通话里长短也可以随话题起伏变化，不要每句都一样长；一次只说一两件事；',
      '禁止任何表情符号、emoji、引号、括号、列表；只输出要说出口的话；',
      '打电话会互相打招呼、寒暄、自然结束（如"那我先挂了啊"）；对方说的内容要自然回应。',
      ...(Array.isArray(extraRules) ? extraRules.filter((r) => typeof r === 'string' && r.trim()).slice(0, 8) : []),
      ...(proactiveAttempt >= 1
        ? [
            '对方一直没说话（可能在做别的事、走开了或没听到）。轮到你主动开口：基于你的人设、你们的关系、刚才聊到的内容和你们的记忆，自然地主动说一句（比如关心、催促、调侃、找新话题）；绝对不要重复你这次通话里已经说过的句子；',
            ...(proactiveAttempt >= 2
              ? [
                  `这已经是你第 ${proactiveAttempt} 次主动开口了对方还是没有回应：语气可以带点担心或无奈；如果你觉得对方可能真的不在，就用一句话自然告别（如「那我先挂了啊，你忙完了打给我」）并在告别语最后单独输出〔挂断〕标记。`,
                ]
              : []),
          ]
        : []),
    ],
  });
  if (!greeting) return base;
  return base + '\n现在用户刚拨通电话，请你像接到电话一样先开口打招呼（先喂一声，再说一句自然的话）。';
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const number = typeof root.number === 'string' ? root.number.trim() : '';
  if (!number) {
    return NextResponse.json({ error: '缺少号码' }, { status: 400 });
  }
  const greeting = root.greeting === true;
  const proactiveAttempt = typeof root.proactiveAttempt === 'number' && Number.isFinite(root.proactiveAttempt)
    ? Math.max(0, Math.min(9, Math.floor(root.proactiveAttempt)))
    : 0;
  const history = normalizeHistory(root.history);

  // 解析对端身份：前端直传的联系人资料 / 陌生号码（联系人存本地 IndexedDB，服务端不查库）
  const inline = parseInlineContact(root.contact);
  const peer: PersonaSource = inline
    ? {
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
        nickname: inline.nickname ?? null,
        realName: inline.realName ?? null,
      }
    : (() => {
        const p = unknownPersona(number);
        return { name: p.name, persona: p.persona };
      })();
  const peerName = peer.name;

  const system = buildCallSystemPrompt(
    peer,
    greeting,
    proactiveAttempt,
    {
      ownerLabel: inline?.ownerLabel,
      npcCircle: inline?.npcCircle,
      ownerCard: inline?.ownerCard,
      backgroundNotes: inline?.backgroundNotes,
    },
    root.multiApp === true || root.multiApp === false ? (root.multiApp as boolean) : undefined,
    Array.isArray(root.extraRules) ? (root.extraRules as unknown[]).filter((x): x is string => typeof x === 'string') : undefined,
    // 机主身份：前端直传（真实名字 + 昵称），AI 知道软件上显示的名字只是昵称、被问是谁报真名
    (() => {
      const real = typeof root.userRealName === 'string' ? root.userRealName.trim() : '';
      const nick = typeof root.userNickname === 'string' ? root.userNickname.trim() : '';
      if (!real && !nick) return undefined;
      return { name: real || nick, realName: real || null, nickname: nick || null };
    })()
  );
  // 记忆库：前端传入的跨 App 记忆块（互通开关范围已由前端过滤），附加在人设之后
  const memoryBlock = typeof root.memoryBlock === 'string' ? root.memoryBlock.trim() : '';
  // 世界书块：前端与文字聊天同一套 collectWbBlocks 组装（全局/局部/专属命中条目 + 使用规则），
  // 附加在人设之后、记忆之前（优先级：人设/世界设定 > 记忆，与文字聊天 systemFull 顺序一致）
  const worldbookBlock = typeof root.worldbookBlock === 'string' ? root.worldbookBlock.trim() : '';
  // 社交动态块：前端按互通开关现场构建的「最近朋友圈/QQ动态 + 相关互动」（动态与聊天记忆双向打通）
  const momentsBlock = typeof root.momentsBlock === 'string' ? root.momentsBlock.trim() : '';
  // 时间感知块：前端按联系人开关现场构建（当前时间/季节/节日/事件时长/上次聊天间隔），附加在记忆之后
  const timeBlock = typeof root.timeBlock === 'string' ? root.timeBlock.trim() : '';
  // 位置感知块：前端与文字聊天同一套 buildLocationBlock（用户最近发过的位置：名称/地址/经纬度/时间）
  const locBlock = typeof root.locBlock === 'string' ? root.locBlock.trim() : '';
  const systemFull = [system, worldbookBlock, memoryBlock, momentsBlock, timeBlock, locBlock].filter(Boolean).join('\n\n');

  // 上游要求 messages 必须以 user 消息收尾：
  // - 普通轮次：历史本身以用户刚说的话收尾，直接透传；
  // - 接通问候 / AI 主动开口：补一条 user 消息触发开口。
  const messages: CallApiMessage[] = [{ role: 'system', content: systemFull }, ...history];
  if (greeting && (messages.length === 1 || messages[messages.length - 1].role !== 'user')) {
    messages.push({ role: 'user', content: '（电话已拨通，请先开口打招呼）' });
  } else if (!greeting && messages.length > 1 && messages[messages.length - 1].role === 'assistant') {
    // 兜底：正常轮次历史不该以 assistant 收尾，补一条 user 触发回应
    messages.push({ role: 'user', content: proactiveAttempt >= 1 ? '（对方迟迟没有说话，请主动开口）' : '（请继续用口语回应）' });
  }

  // ---------- 统一走用户自己的 API；未配置 / 上游故障时内置模型兜底 ----------
  const config = extractUpstreamConfig(root.config);

  /** 内置模型兜底：把人设/记忆/时间块照常注入，保证通话体验不中断；viaSdk 供前端统计 */
  const sdkFallback = async (): Promise<NextResponse> => {
    try {
      const reply = cleanCallReply(await sdkTurn(messages));
      if (reply) return NextResponse.json({ reply, name: peerName, viaSdk: true });
      return NextResponse.json({ error: '对方没有回应，请稍后再试' }, { status: 502 });
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : '未知错误';
      return NextResponse.json({ error: `内置模型也不可用：${detail}` }, { status: 502 });
    }
  };

  if (!config) {
    // 未配置也能通话：直接内置模型接听
    return sdkFallback();
  }
  let hostname = '';
  try {
    hostname = new URL(config.baseUrl).hostname;
  } catch {
    return NextResponse.json({ error: 'API 地址无法解析，请到 设置 › API 设置 检查' }, { status: 400 });
  }
  // 内网 / 本机地址：云端服务器必然不可达 → 交给浏览器直连（返回组装好的 messages）
  if (isPrivateHost(hostname)) {
    return NextResponse.json({ directOnly: true, messages, name: peerName });
  }
  // 公网地址：服务端代理转发（对浏览器透明，同一套逻辑）
  const result = await callUpstream(config, messages);
  if (result.reply) {
    // 去掉可能出现的 markdown 符号/首尾引号包裹
    const reply = cleanCallReply(result.reply);
    if (reply) return NextResponse.json({ reply, name: peerName });
  }
  // 上游故障（连接失败/401/403/404/429/空回复）：内置模型兜底，通话不中断
  return sdkFallback();
}
