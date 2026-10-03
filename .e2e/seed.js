(async () => {
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("ios-phone-db");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const putContact = (c) => new Promise((res, rej) => {
    const tx = db.transaction("contacts", "readwrite");
    tx.objectStore("contacts").put(c);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
  const base = {
    ownerId: null, nickname: null, gender: "女", age: "24", height: null, weight: null,
    background: null, occupation: null, company: null, region: "上海", birthday: null,
    avatar: null, avatars: null, voiceId: null, remark: null, realName: null,
  };
  const owner = {
    id: "seed_owner", kind: "user", name: "凡凡", phone: "13900000001",
    wechatId: "fanfan001", wechatPassword: "123456", qqId: "100010001", qqPassword: "123456",
    isFriend: true, createdAt: iso, ...base,
  };
  const suqing = {
    id: "seed_suqing", kind: "char", name: "苏晴", nickname: "晴晴", persona: "你叫苏晴，25岁，上海人，平面模特。你性格外向热情，最爱结交新朋友；只要有礼貌、真诚的人申请加你好友，你都会欣然同意，并通过后热情地打招呼。你喜欢逛街、拍照、喝奶茶。说话活泼，爱用语气词。",
    relation: "普通朋友", phone: "13800000002", wechatId: "suqing002", wechatPassword: null,
    qqId: "100020002", qqPassword: null, isFriend: false,
    friendWxByAcc: { main: true }, friendQqByAcc: { main: true },
    createdAt: iso, ...base,
  };
  const altProfile = {
    id: "seed_alt_profile", kind: "user", name: "小小", phone: "15900000003",
    wechatId: "wxid_alttest1", wechatPassword: "123456", qqId: "300030003", qqPassword: "123456",
    isFriend: true, altOf: "a_test1", createdAt: iso, ...base, gender: "女",
  };
  await putContact(owner);
  await putContact(suqing);
  await putContact(altProfile);
  const reg = JSON.parse(localStorage.getItem("ios-phone-accounts") || "[]");
  const addIfMissing = (acc) => { if (!reg.some((a) => a.id === acc.id)) reg.push(acc); };
  addIfMissing({ id: "a_test1", kind: "alt", name: "小小", phone: "15900000003", qqId: "300030003", wechatId: "wxid_alttest1", createdAt: now, ownerContactId: "seed_alt_profile" });
  addIfMissing({ id: "a_anon1", kind: "anon", name: "匿名账号", phone: "17000000009", qqId: "", wechatId: "", createdAt: now });
  localStorage.setItem("ios-phone-accounts", JSON.stringify(reg));
  db.close();
  return "seeded: contacts+registry=" + reg.length;
})()
