/** 壁纸缝隙诊断 #7：白带精确像素 + DPR 敏感性 + dataURL/绘制路径对比 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const UNLOCK = () => readFileSync('/home/z/my-project/.e2e/block-nav.js', 'utf8');

async function boot(dpr: number) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr });
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
  await page.waitForTimeout(1800);
  await page.evaluate(UNLOCK());
  await page.evaluate(() => window.__unlock());
  await page.waitForTimeout(1800);
  return { browser, page };
}

// --- DPR 1 / 2 / 3 对比 ---
for (const dpr of [1, 2, 3]) {
  const { browser, page } = await boot(dpr);
  await page.screenshot({ path: `/tmp/dpr${dpr}.png` });
  await browser.close();
}

// --- 白带精确像素分析（dpr3 截图）---
const sharp = (await import('sharp')).default;
const img = sharp('/tmp/dpr3.png');
const raw = await img.raw().toBuffer({ resolveWithObject: true });
const { data, info } = raw;
const px = (x: number, y: number) => {
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
// x=200 device px（CSS ~66px），从上往下找第一行非白像素
let bandEnd = -1;
for (let y = 0; y < 300; y++) {
  const [r, g, b] = px(200, y);
  if (r < 200 && g < 200) { bandEnd = y; break; }
}
console.log('band end (device px at x=200):', bandEnd, '=> CSS px:', bandEnd / 3);
console.log('pixels:', { y0: px(200, 0), y50: px(200, 50), y100: px(200, 100), y104: px(200, 104), y110: px(200, 110) });
