import { NextRequest, NextResponse } from 'next/server';

/**
 * 语音 API · 音色列表拉取（POST /api/tts/voices）
 * POST { config: { provider, baseUrl, apiKey, groupId?, model? } }
 * 返回 { voices: [{ id, name }] }；失败返回 { error }。
 * - MiniMax：get_voice 接口（system_voice + voice_cloning 合并）
 * - OpenAI 兼容：无标准音色接口 → 尽力尝试 /audio/voices，拉不到返回空列表由用户手动填写
 */

import { minimaxVoices, openaiVoices, type TtsProvider, type TtsUpstreamConfig } from '@/lib/server-tts';

export const runtime = 'nodejs';

const PROVIDERS: TtsProvider[] = ['minimax', 'openai'];

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法的 JSON' }, { status: 400 });
  }
  const root = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const cfgRoot = typeof root.config === 'object' && root.config !== null ? (root.config as Record<string, unknown>) : {};

  const provider = PROVIDERS.includes(cfgRoot.provider as TtsProvider) ? (cfgRoot.provider as TtsProvider) : null;
  if (!provider) {
    return NextResponse.json({ error: '不支持的服务商' }, { status: 400 });
  }
  const cfg: TtsUpstreamConfig = {
    provider,
    baseUrl: typeof cfgRoot.baseUrl === 'string' ? cfgRoot.baseUrl : '',
    apiKey: typeof cfgRoot.apiKey === 'string' ? cfgRoot.apiKey : '',
    groupId: typeof cfgRoot.groupId === 'string' ? cfgRoot.groupId : '',
    model: typeof cfgRoot.model === 'string' ? cfgRoot.model : '',
  };

  try {
    const voices = provider === 'minimax' ? await minimaxVoices(cfg) : await openaiVoices(cfg);
    return NextResponse.json({ voices });
  } catch (err) {
    // 安全：只透出错误文案，绝不打印 config/apiKey
    const detail = err instanceof Error && err.message ? err.message : '未知错误';
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}
