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
    id: "seed_lingshuang", kind: "char", name: "凌霜", nickname: null,
    persona: "你叫凌霜，26岁，投行分析师。你高冷寡言，极度注重隐私，非常讨厌陌生人随便加你好友。对不认识的账号发来的好友申请，你一律拒绝，语气冷淡简短，不解释太多。只有真正熟悉的人你才温和。",
    relation: null, phone: "13800000007", wechatId: "lingshuang007", wechatPassword: null,
    qqId: "100070007", qqPassword: null, isFriend: false,
    friendWxByAcc: { main: true }, friendQqByAcc: { main: true },
    ownerId: null, gender: "女", age: "26", height: null, weight: null,
    background: null, occupation: null, company: null, region: "上海", birthday: null,
    avatar: null, avatars: null, voiceId: null, remark: null, realName: null,
    createdAt: iso,
  });
  db.close();
  return "seeded lingshuang";
})()
