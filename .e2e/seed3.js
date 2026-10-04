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
    id: "seed_youyou", kind: "char", name: "悠悠", nickname: null,
    persona: "你叫悠悠，23岁，插画师。你性格慢热谨慎，从来不随便加陌生人好友。有人申请加你好友时，你不会马上同意，而是先回一句问问对方是谁、怎么找到你的；聊过几句、确认对方真诚友善之后，你才会同意好友申请。你说话温柔、简短、有礼貌。",
    relation: null, phone: "13800000005", wechatId: "youyou005", wechatPassword: null,
    qqId: "100050005", qqPassword: null, isFriend: false,
    friendWxByAcc: { main: true }, friendQqByAcc: { main: true },
    ownerId: null, gender: "女", age: "23", height: null, weight: null,
    background: null, occupation: null, company: null, region: "杭州", birthday: null,
    avatar: null, avatars: null, voiceId: null, remark: null, realName: null,
    createdAt: iso,
  });
  db.close();
  return "seeded youyou";
})()
