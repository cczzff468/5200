import { NextRequest, NextResponse } from 'next/server';
import { completeWithFallback, extractUpstreamConfig, readJsonBody } from '@/lib/server-llm';

export const runtime = 'nodejs';

/**
 * 「文字图片」画面描述自动构思（信息/微信/QQ 加号面板 → 文字图片，描述留空时调用）：
 * 把「角色人设 + 最近聊天记录（+ 用户可选的画面提示）」交给 LLM，
 * 让它以角色第一人称视角写一句用于生图的画面描述；随后客户端拿该描述走
 * generateCharacterPhoto（锁脸参考图/外貌描述/代理转发与手动生成完全同管线）。
 *
 * 请求：{ config?: { baseUrl, apiKey, model, temperature?, maxTokens? },
 *        charName, channel?, persona?, hint?, history?: string[] }
 * 响应：{ desc } / { error }（上游与内置 SDK 兜底都失败时 502）
 */
export async function POST(req: NextRequest) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });

  const charName =
    typeof body.charName === 'string' && body.charName.trim() ? body.charName.trim().slice(0, 40) : '对方';
  const channel = typeof body.channel === 'string' ? body.channel.trim().slice(0, 20) : '';
  const persona = typeof body.persona === 'string' ? body.persona.trim().slice(0, 1200) : '';
  const hint = typeof body.hint === 'string' ? body.hint.trim().slice(0, 160) : '';
  const history = Array.isArray(body.history)
    ? body.history
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(-14)
        .map((s) => s.trim().slice(0, 120))
    : [];
  const config = extractUpstreamConfig(body.config);

  const system = [
    `你是聊天角色「${charName}」的摄影导演。${channel ? `你们正在${channel}里聊天。` : '你们正在聊天。'}`,
    persona ? `角色人设（供参考，遵守其中与形象/年龄/身份相关的设定）：\n${persona}` : '',
    '你的任务：根据最近的聊天记录和角色人设，构思一张「这个角色此刻会随手拍下来发给对方的照片」。',
    [
      '输出要求：',
      '1. 只输出一句中文画面描述，40 字以内；',
      '2. 描述照片里的场景 / 动作 / 氛围 / 光线，具体、口语化、有生活感；',
      '3. 以角色第一人称视角拍摄（自拍或眼前所见），符合 TA 的身份与当下聊天情境；',
      '4. 不要出现引号、序号、解释、「画面：」之类前缀或任何多余文字，直接输出描述本身。',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');

  const userMsg = [
    history.length > 0 ? `最近聊天记录：\n${history.join('\n')}` : '（还没有聊天记录，按人设自由发挥一张符合 TA 的日常照片）',
    hint ? `用户想要的画面提示：${hint}（优先围绕这个提示构思，但保持与角色身份一致）` : '',
    '现在直接输出那一句画面描述：',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const { text } = await completeWithFallback(config, [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ]);
    // 清洗：取第一行非空文本 → 去首尾引号/书名号包裹 → 截断（生图提示词不宜过长）
    const firstLine = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)[0];
    const desc = (firstLine ?? '')
      .replace(/^[「『"'“”‘’《【(（]+/, '')
      .replace(/[」』"'“”‘’》】)）]+$/, '')
      .slice(0, 80)
      .trim();
    if (!desc) return NextResponse.json({ error: 'AI 没有返回有效的画面描述' }, { status: 502 });
    return NextResponse.json({ desc });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '画面构思失败，请重试' },
      { status: 502 },
    );
  }
}
