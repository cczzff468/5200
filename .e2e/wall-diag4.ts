/** 壁纸缝隙诊断 #4：elementsFromPoint 逐点揪出顶部/左缘白带绘制者 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const UNLOCK = () => readFileSync('/home/z/my-project/.e2e/block-nav.js', 'utf8');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await ctx.addInitScript(() => {
  try { localStorage.setItem('ios-display', JSON.stringify({ theme: 'dark', wallpaper: 'dark-stream', lockWallpaper: 'graphite', lockScreen: false, tz: 'Asia/Shanghai' })); } catch {}
  const req = indexedDB.open('ios-phone-db');
  req.onsuccess = () => {
    const db = req.result as IDBDatabase;
    try {
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ key: 'wallpaper', value: { preset: 'dark-stream' } });
      tx.objectStore('settings').put({ key: 'lock', value: { lockScreen: false, passcode: null, passcodeEnabled: false } });
      tx.oncomplete = () => db.close();
    } catch {}
  };
});
const page = await ctx.newPage();
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.evaluate(UNLOCK());
await page.evaluate(() => window.__unlock());
await page.waitForTimeout(2000);

const dump = await page.evaluate(() => {
  const describe = (el: Element): string => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} cls="${String(el.className).slice(0, 70)}" rect=[${+r.x.toFixed(0)},${+r.y.toFixed(0)},${+r.width.toFixed(0)},${+r.height.toFixed(0)}] bg=${cs.backgroundColor} bgimg=${cs.backgroundImage.slice(0, 50)} transform=${cs.transform.slice(0, 40)}`;
  };
  const points: Array<[number, number, string]> = [
    [195, 8, 'top-center-above-island'],
    [30, 30, 'top-left-white'],
    [360, 30, 'top-right-white'],
    [195, 25, 'top-mid'],
    [2, 400, 'left-edge-mid'],
    [388, 400, 'right-edge-mid'],
    [2, 830, 'left-edge-bottom'],
  ];
  const out: Record<string, string[]> = {};
  for (const [x, y, label] of points) {
    out[label] = document.elementsFromPoint(x, y).slice(0, 8).map(describe);
  }
  return out;
});
for (const [k, v] of Object.entries(dump)) {
  console.log(`\n### ${k}`);
  v.forEach((line) => console.log('  ' + line));
}
await page.screenshot({ path: '/tmp/wall4.png' });
await browser.close();
