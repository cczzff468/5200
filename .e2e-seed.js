(() => {
  const DB = 'ios-phone-db';
  return new Promise((resolve) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('contacts', 'readwrite');
      const store = tx.objectStore('contacts');
      const now = new Date().toISOString();
      const user = {
        id: 'e2e-user', kind: 'user', ownerId: null, name: '陈明', nickname: null,
        gender: '男', age: '28', height: null, weight: null, persona: '普通人', background: null,
        occupation: '工程师', company: null, region: '北京', birthday: null, relation: null,
        phone: '13800138000', wechatId: 'chenming01', wechatPassword: 'test1234',
        qqId: '10001', qqPassword: 'test1234', avatar: null,
        isFriend: true, friendWx: true, friendQq: true, friendSms: true,
        realName: null, remark: null, voiceId: null, createdAt: now,
      };
      const char = {
        id: 'e2e-char', kind: 'char', ownerId: null, name: '苏晴', nickname: '小晴',
        gender: '女', age: '26', height: null, weight: null,
        persona: '温柔的网友，喜欢聊天和分享日常', background: null,
        occupation: '插画师', company: null, region: '上海', birthday: null, relation: '好友',
        phone: '13912345678', wechatId: 'suqing520', wechatPassword: null,
        qqId: '20002', qqPassword: null, avatar: null,
        isFriend: true, friendWx: true, friendQq: true, friendSms: true,
        realName: null, remark: null, voiceId: null, createdAt: now,
      };
      store.put(user); store.put(char);
      tx.oncomplete = () => resolve('seeded-2-contacts');
      tx.onerror = () => resolve('seed-error');
    };
    req.onerror = () => resolve('db-open-error');
  });
})()
