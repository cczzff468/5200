/** 壁纸缝隙诊断 #5：隐藏实验二分定位白带绘制者 */
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

// 实验A：壁纸层换成醒目红色 → 白带若仍在=上面有绘制者；若变红=白带属于壁纸层自身
await page.evaluate(() => {
  const w = document.querySelector('[data-boot-wall]') as HTMLElement;
  w.style.background = '#ff0000';
});
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/exp-A-red-wall.png' });

// 实验B：恢复壁纸，把壁纸层图片换成棋盘格（红蓝格）看可视切片映射
await page.evaluate(() => {
  const w = document.querySelector('[data-boot-wall]') as HTMLElement;
  w.style.background =
    'repeating-linear-gradient(45deg, #ff0000 0 20px, #0000ff 20px 40px)';
});
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/exp-B-checker.png' });

// 实验C：恢复真实壁纸，但把 z 序提升为最顶层，排除「被上面元素盖住/透出」
await page.evaluate(() => {
  const w = document.querySelector('[data-boot-wall]') as HTMLElement;
  w.style.background = '';
  w.style.zIndex = '9999';
});
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/exp-C-wall-top.png' });

await browser.close();
