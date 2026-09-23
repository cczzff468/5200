/**
 * E2E mock LLM（OpenAI 兼容，端口 4100）：
 * - POST /v1/chat/completions：stream=true 走 SSE（脚本化回复队列），stream=false 返回 {"fragments":[]}（记忆提取）
 * - POST /__script：{ text, reset? } 压入下一条脚本化回复（FIFO）
 * - 请求体逐条追加到 .e2e/req-log.ndjson 供断言（system prompt / 成员名单 / 称呼段）
 * - CORS 全开：浏览器直连可用
 */
const PORT = 4100;
const LOG = '/home/z/my-project/.e2e/req-log.ndjson';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};
let queue: string[] = [];

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/__health') {
      return new Response(JSON.stringify({ ok: true, queueLen: queue.length }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/__script' && req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as { text?: string; reset?: boolean } | null;
      if (body?.reset) queue = [];
      if (typeof body?.text === 'string') queue.push(body.text);
      return new Response(JSON.stringify({ queueLen: queue.length }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { stream?: boolean; messages?: unknown };
      try {
        await Bun.write(LOG, JSON.stringify({ t: Date.now(), body }) + '\n', { append: true });
      } catch {}
      const stream = body.stream === true;
      const scripted = queue.shift();
      const content = stream ? (typeof scripted === 'string' ? scripted : '好的，我在呢。') : '{"fragments":[]}';
      if (stream) {
        const enc = new TextEncoder();
        const chunk = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(enc.encode(chunk({ id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: Date.now(), model: 'mock', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })));
              c.enqueue(enc.encode(chunk({ id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: Date.now(), model: 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })));
              c.enqueue(enc.encode('data: [DONE]\n\n'));
              c.close();
            },
          }),
          { headers: { ...CORS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } },
        );
      }
      return new Response(
        JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion', created: Date.now(), model: 'mock', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }
    return new Response('not found', { status: 404, headers: CORS });
  },
});
console.log(`mock-llm listening on :${PORT}`);
