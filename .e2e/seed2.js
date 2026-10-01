(async () => {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 96;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 96, 96);
  g.addColorStop(0, '#f7b2c4'); g.addColorStop(1, '#9d7fd4');
  x.fillStyle = g; x.fillRect(0, 0, 96, 96);
  x.fillStyle = '#fff';
  x.beginPath(); x.arc(48, 38, 16, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.arc(48, 88, 30, 0, Math.PI * 2); x.fill();
  const avatar = c.toDataURL('image/png');
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('ios-phone-db', 7);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const get = await new Promise((resolve) => {
    const tx = db.transaction('contacts', 'readonly');
    const r = tx.objectStore('contacts').get('seed-xiaoxue');
    r.onsuccess = () => resolve(r.result);
  });
  get.avatar = avatar;
  await new Promise((resolve, reject) => {
    const tx = db.transaction('contacts', 'readwrite');
    tx.objectStore('contacts').put(get);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return 'avatar set';
})()
