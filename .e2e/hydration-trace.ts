/** 抓 hydration 错误的完整信息与组件栈 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const NAV = () => readFileSync('/home/z/my-project/.e2e/block-nav.js', 'utf8');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
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
page.on('pageerror', (e) => console.log('PAGEERROR FULL:\n' + String(e)));
page.on('console', async (m) => {
  if (m.type() === 'error') {
    const args = await Promise.all(m.args().map(async (a) => { try { return JSON.stringify(await a.jsonValue()).slice(0, 600); } catch { return '<unserializable>'; } }));
    console.log('CONSOLE:', args.join(' | ').slice(0, 900));
  }
});
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await browser.close();
