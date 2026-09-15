/**
 * 角色人设 system prompt 组装（全 App 共用：微信 / QQ / 信息 / 电话）。
 *
 * 设计约束（「根据角色人设聊天」需求）：
 * - 人设一律从联系人角色数据读取，本模块不含任何具体角色的硬编码人设；
 * - 每次请求都由当前聊天对象现场组装 system 消息并放在上下文最前，
 *   切换角色时自然切换，绝不沿用上一个角色的人设；
 * - 人设描述固定包含七要素：名字 / 身份 / 性格 / 说话风格 / 背景 / 与用户的关系 / 禁止事项，
 *   数据缺失的要素回退为通用表述，不编造具体内容。
 */

/** 人设数据源（联系人记录的形状子集；全部可选字段缺省时安全回退） */
export interface PersonaSource {
  name: string;
  /** 'char'（AI 角色）| 'user'（用户本人）| 'npc'（配角）；缺省按 char 处理 */
  kind?: string | null;
  gender?: string | null;
  age?: string | null;
  height?: string | null;
  weight?: string | null;
  /** 职业 → 身份要素 */
  occupation?: string | null;
  /** 公司 → 身份要素 */
  company?: string | null;
  region?: string | null;
  /** 人设描述（自由文本：性格、脾气、说话风格、口头禅等都写在这里） */
  persona?: string | null;
  /** 背景故事 → 背景要素 */
  background?: string | null;
  /** 与用户（或 NPC 归属者）的关系 */
  relation?: string | null;
}

export interface PersonaPromptCtx {
  /** 聊天对面的用户名；未知（如陌生来电）传 null → 文案用「用户」 */
  userName?: string | null;
  /** NPC 场景：聊天中用户扮演的归属角色名 */
  ownerName?: string | null;
  /** 场景渠道名，如 微信 / QQ / 短信 / 语音通话 */
  channel: string;
  /** 平台/场景附加规则（表情包语义、语音短句等），追加在禁止事项列表后 */
  extraRules?: string[];
}

function kindLabelOf(kind?: string | null): string {
  if (kind === 'user') return '用户本人的自设角色';
  if (kind === 'npc') return '配角角色';
  return 'AI 角色';
}

function clean(v?: string | null): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 由联系人数据组装七要素人设 system prompt。
 * 纯函数、无 DOM / Node 依赖：客户端（微信/QQ/信息）与服务端（电话 turn 路由）共用同一实现，
 * 保证任何 App 里角色的人设表述完全一致。
 */
export function buildPersonaSystemPrompt(peer: PersonaSource, ctx: PersonaPromptCtx): string {
  const user = clean(ctx.userName) || '用户';
  const name = clean(peer.name) || '对方';
  const persona = clean(peer.persona);
  const background = clean(peer.background);
  const relation = clean(peer.relation);
  // NPC 的「用户」其实是它归属的角色（聊天中由用户扮演）；其余情况就是聊天对面的用户
  const relationTo = peer.kind === 'npc' && clean(ctx.ownerName) ? clean(ctx.ownerName) : user;
  const roleplayNote =
    peer.kind === 'npc' && clean(ctx.ownerName)
      ? `（补充：这是角色扮演场景，聊天中的用户正在扮演「${clean(ctx.ownerName)}」。）`
      : '';

  // 身份要素：类型 + 职业 + 公司 + 地区
  const identity: string[] = [kindLabelOf(peer.kind)];
  if (clean(peer.occupation)) identity.push(clean(peer.occupation));
  if (clean(peer.company)) identity.push(`就职于${clean(peer.company)}`);
  if (clean(peer.region)) identity.push(`坐标${clean(peer.region)}`);

  // 基础资料要素：性别 / 年龄 / 身高 / 体重（有才写）
  const facts: string[] = [];
  if (clean(peer.gender)) facts.push(`性别 ${clean(peer.gender)}`);
  if (clean(peer.age)) facts.push(`${clean(peer.age)}岁`);
  if (clean(peer.height)) facts.push(`身高 ${clean(peer.height)}`);
  if (clean(peer.weight)) facts.push(`体重 ${clean(peer.weight)}`);

  const lines: string[] = [
    `你现在是${user}${ctx.channel}里的联系人「${name}」，正在${ctx.channel}上和${user}互动。${roleplayNote}`,
    `请始终以「${name}」的身份、用第一人称口语化回复，严格保持角色，不要跳出。`,
    '',
    `【名字】${name}`,
    `【身份】${identity.join('，')}`,
    ...(facts.length ? [`【基础资料】${facts.join('；')}`] : []),
    `【性格】${persona || '按资料自然呈现，像一个有血有肉的真实的人'}`,
    `【说话风格】${
      persona
        ? '严格贴合「性格」段人设的语气、用词习惯与口头禅；人设里写到的说话方式必须照做'
        : '自然口语，像真实的人随手打字'
    }`,
  ];
  if (background) lines.push(`【背景】${background}`);
  lines.push(
    `【与${relationTo}的关系】${relation || '普通朋友，认识对方，日常闲聊'}`,
    '【禁止事项】',
    `- 永远不要说自己是 AI、语言模型、助手或程序，也不要提及「人设」「角色扮演」「prompt」等幕后概念；`,
    `- 不要跳出「${name}」的角色，不要替${user}说话、总结或代答；`,
    `- 资料里没有的信息不要大量编造；`,
    `- 不要输出 markdown、列表、序号、引号或括号舞台说明；`,
    `- 每次只回复对方刚说的话，简短自然、像真人随手打字。`
  );
  for (const rule of ctx.extraRules ?? []) {
    const r = clean(rule);
    if (r) lines.push(`- ${r}`);
  }
  return lines.join('\n');
}
