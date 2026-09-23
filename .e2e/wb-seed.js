/** 世界书绑定角色 E2E 种子/还原工具：直接读写 IndexedDB contacts store 与 worldbooks kv */
(() => {
  const DB = 'ios-phone-db';
  const openDB = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const txDone = (tx) => new Promise((res) => { tx.oncomplete = () => res('ok'); tx.onerror = () => res('err'); });

  /** 覆盖写入联系人（全量替换，用于测试播种与还原基线） */
  window.__setContacts = async (list) => {
    const db = await openDB();
    const tx = db.transaction('contacts', 'readwrite');
    const store = tx.objectStore('contacts');
    store.clear();
    for (const c of list) store.put(c);
    db.close();
    return txDone(tx);
  };

  /** 读取全部联系人（快照/断言用） */
  window.__getContacts = async () => {
    const db = await openDB();
    const tx = db.transaction('contacts', 'readonly');
    const req = tx.objectStore('contacts').getAll();
    return new Promise((res) => {
      req.onsuccess = () => { db.close(); res(req.result); };
      req.onerror = () => { db.close(); res('err'); };
    });
  };

  /** 覆盖写入 worldbooks kv（null=删除） */
  window.__setWbKv = async (value) => {
    const db = await openDB();
    const tx = db.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    if (value === null) store.delete('worldbooks');
    else store.put({ key: 'worldbooks', value });
    db.close();
    return txDone(tx);
  };

  /** 读 worldbooks kv */
  window.__getWbKv = async () => {
    const db = await openDB();
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get('worldbooks');
    return new Promise((res) => {
      req.onsuccess = () => { db.close(); res(req.result ? req.result.value : null); };
      req.onerror = () => { db.close(); res('err'); };
    });
  };

  /** 清掉 localStorage 里的世界书镜像键（如有） */
  window.__cleanWbLs = () => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /worldbook|wb-/i.test(k)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    return 'cleaned:' + keys.join(',');
  };

  /** 构造联系人记录（字段与 createContact 对齐，够测试用即可） */
  window.__mkContact = (kind, name, extra = {}) => ({
    id: extra.id || 'wb-e2e-' + Math.random().toString(36).slice(2, 8),
    kind,
    ownerId: kind === 'npc' ? extra.ownerId ?? null : null,
    name,
    nickname: '',
    gender: '',
    age: '',
    height: '',
    weight: '',
    persona: '',
    background: '',
    occupation: '',
    company: '',
    region: '',
    birthday: '',
    relation: '',
    relationToUser: '',
    phone: extra.phone || '',
    wechatId: '',
    wechatPassword: '',
    qqId: '',
    qqPassword: '',
    avatar: null,
    remark: '',
    isFriend: kind === 'user',
    createdAt: new Date(Date.now() - (extra.ageMs || 0)).toISOString(),
    ...extra.overrides,
  });
  return 'wb-seed-ready';
})()
