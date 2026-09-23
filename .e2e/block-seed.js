/** E2E 种子：写入联系人（凡凡/凑凑 + 榴莲）、API 配置（指向 mock:4100）、预置聊天消息 */
(async () => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('ios-phone-db');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const db = await open();
  const put = (store, val) => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(val);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  const now = Date.now();
  const base = {
    ownerId: null, gender: null, age: null, height: null, weight: null, persona: null, background: null,
    occupation: null, company: null, region: null, birthday: null, relation: null, phone: null,
    wechatId: null, wechatPassword: null, qqId: null, qqPassword: null, avatar: null, isFriend: false,
    friendWx: undefined, friendQq: undefined, friendSms: undefined, remark: null,
    createdAt: new Date(now).toISOString(),
  };
  await put('contacts', { ...base, id: 'user-fanfan', kind: 'user', name: '凡凡', nickname: '凑凑', isFriend: true });
  await put('contacts', {
    ...base,
    id: 'c-liulian', kind: 'char', name: '榴莲', ownerId: 'user-fanfan', isFriend: true,
    friendWx: true, friendQq: true, friendSms: true,
    persona: '直爽热心爱张罗，说话带梗，爱用「整」这个字',
    relation: '好朋友', phone: '13800001234', wechatId: 'wxid_liulian001', qqId: '234567890',
  });
  await put('settings', { key: 'apiConfig', value: { baseUrl: 'http://127.0.0.1:4100/v1/chat/completions', apiKey: 'test-key', model: 'mock-model', temperature: 0.7, maxTokens: 2048 } });
  await put('settings', { key: 'profile', value: { name: '凡凡', tag: '', avatar: null } });
  await put('kv', { key: 'wx-chat-msgs:c-liulian', value: [{ id: 'seed-m1', role: 'peer', content: '凡凡！周末整点好吃的不？', time: now - 60000 }] });
  await put('kv', { key: 'qq-chat-msgs:c-liulian', value: [{ id: 'seed-q1', role: 'peer', content: '凡凡！整点烧烤去不？', time: now - 60000 }] });
  await put('kv', { key: 'ios-chat-msgs:c:c-liulian', value: [{ id: 'seed-s1', role: 'assistant', content: '凡凡！短信也整一条？', time: now - 60000 }] });
  db.close();
  localStorage.setItem('wx-session-user-id', 'user-fanfan');
  localStorage.setItem('qq-session-user-id', 'user-fanfan');
  return 'seeded';
})()
