(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("ios-phone-db");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const get = (key) => new Promise((res) => {
    const tx = db.transaction("kv", "readonly");
    const rq = tx.objectStore("kv").get(key);
    rq.onsuccess = () => res(rq.result ? rq.result.value : null);
    rq.onerror = () => res(null);
  });
  const qqLs = await get("wx-chat-msgs:seed_suqing--a_test1");
  const reqs = await get("wx-friend-reqs--a_test1");
  const summary = {
    wxMsgs: Array.isArray(qqLs) ? qqLs.map((m) => ({ role: m.role, kind: m.kind, fr: m.fr, sys: m.sys ? m.sys.text : undefined, content: (m.content || "").slice(0, 30) })) : null,
    wxReq: Array.isArray(reqs) ? reqs.map((r) => ({ name: r.name, status: r.status, fromChar: r.fromChar, thread: (r.thread || []).map((t) => t.who + ":" + t.text.slice(0, 20)) })) : null,
  };
  db.close();
  return JSON.stringify(summary);
})()
