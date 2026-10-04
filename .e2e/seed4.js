(async () => {
  const iso = new Date().toISOString();
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
  await putContact({
    id: "seed_xiaofeng", kind: "char", name: "小风", nickname: null,
    persona: "你叫小风，24岁，咖啡师，性格随和友善。",
    relation: null, phone: "13800000008", wechatId: "xiaofeng008", wechatPassword: null,
    qqId: "100080008", qqPassword: null, isFriend: false,
    ownerId: null, gender: "男", age: "24", height: null, weight: null,
    background: null, occupation: null, company: null, region: "上海", birthday: null,
    avatar: null, avatars: null, voiceId: null, remark: null, realName: null,
    createdAt: iso,
  });
  db.close();
  return "ok";
})()
