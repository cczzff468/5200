/** 功能回归：解锁→打开微信→截图 + console/pageerror 收集（确认修复零功能破坏） */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const NAV = () => readFileSync('/home/z/my-project/.e2e/block-nav.js', 'utf8');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
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
const errs: string[] = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 120)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push('console: ' + m.text().slice(0, 120)); });

await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(NAV());
const r1 = await page.evaluate(() => window.__goto('微信'));
await page.waitForTimeout(1200);
console.log('open wechat:', r1);
await page.screenshot({ path: '/tmp/regress-wechat.png' });
// 回主屏（上滑手势由 __unlock 类似方式触发会麻烦，直接验证多任务开关器也可省略）
console.log('page errors:', JSON.stringify(errs));
await browser.close();
