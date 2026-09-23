/**
 * E2E 种子（在页面上下文执行；写 IndexedDB ios-phone-db + localStorage，完成后置 window.__seedDone=true）：
 * - 用户：凡凡（昵称 凑凑）；AI：榴莲（直爽热心，群主）；NPC：红红（榴莲的高中同学，管理员）
 * - 微信群「周末爬山群」：群主榴莲、管理员红红、机主不在 memberIds（UI 独立渲染）
 * - 微信群「只有事件的群」g-evt：仅含 join 事件（验证会话列表预览兜底）
 * - apiConfig 指向本机 mock（127.0.0.1:4100）
 */
(async () => {
  const DB = 'ios-phone-db';
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const put = (db, store, value, key) => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
  const get = (db, store, key) => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

  const db = await open();
  const now = Date.now();
  const iso = '2024-01-01T00:00:00.000Z';

  const mk = (o) => Object.assign({
    ownerId: null, gender: null, age: null, height: null, weight: null, persona: null, background: null,
    occupation: null, company: null, region: null, birthday: null, relation: null, relationToUser: null,
    phone: null, wechatId: null, wechatPassword: null, qqId: null, qqPassword: null, avatar: null,
    remark: null, isFriend: false, createdAt: iso,
  }, o);

  const me = mk({ id: 'user-fanfan', kind: 'user', name: '凡凡', nickname: '凑凑', region: '杭州', phone: '13800000001', wechatId: 'wxid_fanfan', wechatPassword: 'wx123456', qqId: '100000001', qqPassword: 'qq123456', isFriend: true });
  const liulian = mk({ id: 'c-liulian', kind: 'char', name: '榴莲', persona: '直爽热心、爱张罗事儿，说话干脆，爱管群里的事', relation: '好朋友', region: '杭州', phone: '13800000002', wechatId: 'wxid_liulian', wechatPassword: 'wx123456', qqId: '100000002', qqPassword: 'qq123456', isFriend: true, friendWx: true, friendQq: true });
  const honghong = mk({ id: 'c-honghong', kind: 'npc', ownerId: 'c-liulian', name: '红红', persona: '活泼话多，爱开玩笑', relation: '榴莲的高中同学', relationToUser: '用户的朋友', region: '杭州', phone: '13800000003', wechatId: 'wxid_hong', qqId: '100000003', isFriend: true, friendWx: true, friendQq: true });

  await put(db, 'contacts', me);
  await put(db, 'contacts', liulian);
  await put(db, 'contacts', honghong);

  const groupA = {
    id: 'g-hike', app: 'wx', name: '周末爬山群', remark: '', avatar: null,
    ownerId: 'c-liulian', memberIds: ['c-liulian', 'c-honghong'], adminIds: ['c-honghong'],
    mutes: {}, announcement: '周六早上八点山门口集合，别迟到！', no: '233666888',
    memoryInterop: false, createdAt: now - 86400e3,
  };
  const msgsA = [
    { id: 'gm1', role: 'peer', senderId: 'c-liulian', senderName: '榴莲', content: '周六爬山的事定下来了，八点山门口集合', time: now - 7200e3 },
    { id: 'gm2', role: 'peer', senderId: 'c-honghong', senderName: '红红', content: '记得带水！上回有人渴到怀疑人生', time: now - 3600e3 },
  ];
  const groupEvt = {
    id: 'g-evt', app: 'wx', name: '老友聚集地', remark: '', avatar: null,
    ownerId: 'c-liulian', memberIds: ['c-liulian', 'c-honghong'], adminIds: [],
    mutes: {}, announcement: '', no: '233666999', memoryInterop: false, createdAt: now - 3600e3,
  };
  const msgsEvt = [
    { id: 'em1', role: 'peer', senderId: 'c-liulian', senderName: '榴莲', time: now - 3000e3, kind: 'notice', content: '', noticeText: '榴莲创建了群聊', evt: { type: 'create', actorId: 'c-liulian' } },
  ];

  await put(db, 'kv', { key: 'wx-chat-groups', value: [groupA, groupEvt] });
  await put(db, 'kv', { key: 'wx-group-msgs:g-hike', value: msgsA });
  await put(db, 'kv', { key: 'wx-group-msgs:g-evt', value: msgsEvt });
  await put(db, 'settings', { key: 'apiConfig', value: { baseUrl: 'http://127.0.0.1:4100/v1/chat/completions', apiKey: 'test-key', model: 'mock-model', temperature: 0.7, maxTokens: 600 } });

  localStorage.setItem('wx-session-user-id', 'user-fanfan');
  localStorage.setItem('ios-contacts-migrated', '1');
  localStorage.removeItem('wx-chat-hidden');

  // 冒烟断言：种子可读
  const back = await get(db, 'contacts', 'user-fanfan');
  window.__seedDone = back && back.name === '凡凡' && back.nickname === '凑凑';
  return String(window.__seedDone);
})()
