/**
 * E2E mock LLM server（仅测试用）：OpenAI 兼容 /v1/chat/completions
 * - stream:true → SSE（带 CORS，浏览器直连可用）
 * - stream:false → JSON（服务端记忆提取走这条）
 * - 群聊请求：按 system 里「你以「XX」的身份参与其中」提取成员名，回复带名字便于断言
 * - 记忆提取请求（system 含「只输出 JSON」/「fragments」）→ 返回合法 fragments JSON
 * - 所有请求体落 /tmp/mock-llm-requests.log（JSONL）供断言 system 注入内容
 */
const PORT = 4100;

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname !== '/v1/chat/completions' && url.pathname !== '/chat/completions') {
      return new Response('not found', { status: 404, headers: cors });
    }
    let body: any = {};
    try {
      body = await req.json();
    } catch {}
    const messages: Array<{ role: string; content: string }> = Array.isArray(body.messages) ? body.messages : [];
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    // 请求落盘（断言用）
    try {
      await Bun.write(
        '/tmp/mock-llm-requests.log',
        `${JSON.stringify({ t: Date.now(), stream: body.stream === true, system: system.slice(0, 8000), lastUser: lastUser.slice(0, 400) })}\n`,
        { append: true }
      );
    } catch {}

    const isMemoryExtract = /只输出 JSON|fragments|记忆提取/.test(system) && !/【群聊模式】/.test(system);
    let reply: string;
    if (isMemoryExtract) {
      reply = JSON.stringify({ fragments: [] });
    } else {
      const m = system.match(/你以「(.+?)」的身份参与/);
      const name = m ? m[1] : (system.match(/你是「(.+?)」/)?.[1] ?? 'AI');
      const timeQ = /现在几点|几点了|今天星期几|星期几|现在是早上|中午|晚上/.test(lastUser);
      if (timeQ) {
        reply = `【${name}】现在是北京时间 ${new Date(Date.now() + 8 * 3600_000).toISOString().slice(11, 16)}，我来查一下手机再告诉你哈。`;
      } else {
        reply = `【${name}】收到，群里看到你说：「${lastUser.slice(0, 30)}」，我在呢～`;
      }
    }

    if (body.stream === true) {
      const encoder = new TextEncoder();
      const chunks = reply.match(/[\s\S]{1,6}/g) ?? [];
      const sse = new ReadableStream({
        async start(controller) {
          for (const c of chunks) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: c } }] })}\n\n`)
            );
            await new Promise((r) => setTimeout(r, 16));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(sse, {
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', ...cors },
      });
    }
    return new Response(
      JSON.stringify({ id: 'mock', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] }),
      { headers: { 'Content-Type': 'application/json', ...cors } }
    );
  },
});

console.log(`[mock-llm] listening on :${PORT}`);
