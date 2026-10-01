(async () => {
  const now = new Date().toISOString();
  const me = {
    id: 'seed-me', kind: 'user', ownerId: null, name: '木子', nickname: null,
    gender: '男', age: '24', height: null, weight: null,
    persona: '你是机主本人', background: null, occupation: '设计师', company: null,
    region: '杭州', birthday: null, relation: null, relationToUser: null,
    phone: '13900000001', wechatId: 'wume888', wechatPassword: 'test1234',
    qqId: '88888888', qqPassword: 'test1234',
    avatar: null, avatars: null, isFriend: true, friendWx: true, friendQq: true, friendSms: true,
    realName: null, remark: null, voiceId: null, createdAt: now,
  };
  const ai = {
    id: 'seed-xiaoxue', kind: 'char', ownerId: 'seed-me', name: '小雪', nickname: '小雪',
    gender: '女', age: '23', height: '165cm', weight: null,
    persona: '你叫小雪，是机主木子的青梅竹马兼女友，性格温柔黏人爱撒娇，说话自然口语化带点小脾气，喜欢关心木子的日常起居，偶尔吃醋。回复简短自然像微信聊天，一般不超过30字。',
    background: '和木子从小一起长大，现在在同城工作', occupation: '插画师', company: null,
    region: '杭州', birthday: '3月5日', relation: '女友', relationToUser: null,
    phone: '10086', wechatId: 'xiaoxue10086', wechatPassword: null,
    qqId: '10086', qqPassword: null,
    avatar: null, avatars: null, isFriend: true, friendWx: true, friendQq: true, friendSms: true,
    realName: null, remark: null, voiceId: null, createdAt: now,
  };
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('ios-phone-db', 7);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('contacts')) d.createObjectStore('contacts', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('contacts', 'readwrite');
    tx.objectStore('contacts').put(me);
    tx.objectStore('contacts').put(ai);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return 'seeded: seed-me + seed-xiaoxue';
})()
