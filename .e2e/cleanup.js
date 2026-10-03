(async () => {
  const seedIds = ["seed_owner","seed_suqing","seed_alt_profile","seed_lingshuang","seed_youyou","seed_xiaofeng"];
  const seedAccs = ["a_test1","a_anon1"];
  const log = [];
  // 1. delete seeded contacts
  const db = await new Promise((res, rej) => { const r = indexedDB.open("ios-phone-db"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const allKeys = (store) => new Promise((res) => { const tx = db.transaction(store, "readonly"); const rq = tx.objectStore(store).getAllKeys(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); });
  const delKV = (key) => new Promise((res) => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").delete(key); tx.oncomplete = () => res(true); tx.onerror = () => res(false); });
  const delContact = (id) => new Promise((res) => { const tx = db.transaction("contacts", "readwrite"); tx.objectStore("contacts").delete(id); tx.oncomplete = () => res(true); tx.onerror = () => res(false); });
  for (const id of seedIds) { await delContact(id); log.push("contact-" + id); }
  // 2. delete seeded-scoped kv keys + main-scope test keys
  const kvKeys = await allKeys("kv");
  const doomed = kvKeys.filter((k) => {
    if (typeof k !== "string") return false;
    if (/(^|:)seed_[a-z]+(--|$)/.test(k) || k.includes("seed_")) return true;
    if (/(wx-friend-reqs|qq-friend-reqs)(--a_test1)?$/.test(k)) return true;
    if (k === "qq-last-login-id" || k === "qq-last-login-id--a_test1") return true;
    return false;
  });
  for (const k of doomed) { await delKV(k); log.push("kv-" + k); }
  db.close();
  // 3. registry: remove seeded accounts
  const reg = JSON.parse(localStorage.getItem("ios-phone-accounts") || "[]");
  localStorage.setItem("ios-phone-accounts", JSON.stringify(reg.filter((a) => !seedAccs.includes(a.id))));
  log.push("registry-cleaned:" + reg.length + "->" + reg.filter((a) => !seedAccs.includes(a.id)).length);
  // 4. localStorage: sessions / force flags / login hist entries / maps with seed refs
  const rm = (k) => { localStorage.removeItem(k); log.push("ls-" + k); };
  ["wx-session-user-id","wx-session-user-id--a_test1","qq-session-user-id","qq-session-user-id--a_test1","wx-force-login","qq-force-login"].forEach(rm);
  for (const hk of ["wx-login-hist","qq-login-hist"]) {
    try {
      const list = JSON.parse(localStorage.getItem(hk) || "[]");
      if (Array.isArray(list)) {
        const cleaned = list.filter((x) => !seedAccs.includes(x));
        if (cleaned.length) localStorage.setItem(hk, JSON.stringify(cleaned)); else localStorage.removeItem(hk);
        log.push(hk + ":" + JSON.stringify(cleaned));
      }
    } catch (e) {}
  }
  // maps (unread/flags/reply-count/time-aware 等) 剔除含 seed_ 的条目
  for (const mk of ["wxUnreads","qqUnreads","chat-badge-wx","chatBadgeWx","chat-reply-counts","chat-time-aware","chat-sticker-on","ai-voice-freq","ai-voice-counters","wx-chat-flags","qq-chat-flags","chat-sentence-send","chat-sentence-pending"]) {
    const raw = localStorage.getItem(mk);
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        let changed = false;
        for (const k of Object.keys(obj)) if (k.includes("seed_")) { delete obj[k]; changed = true; }
        if (changed) localStorage.setItem(mk, JSON.stringify(obj));
      }
    } catch (e) {}
  }
  // 5. active accounts: 指向已删账号时回退 main
  try {
    const act = JSON.parse(localStorage.getItem("ios-phone-active-accounts") || "{}");
    for (const app of Object.keys(act)) if (seedAccs.includes(act[app])) act[app] = "main";
    localStorage.setItem("ios-phone-active-accounts", JSON.stringify({ wx: "main", qq: "main", sms: "main", phone: "main", ...act }));
  } catch (e) {}
  log.push("active-accounts-reset");
  return JSON.stringify({ removed: log.length, sample: log.slice(0, 40) });
})()
