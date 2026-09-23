/** 壁纸缝隙诊断 #9：节流图片响应强制复现白带 → 验证「未解码首光栅 + 无重绘卡死」理论 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const UNLOCK = () => readFileSync('/home/z/my-project/.e2e/block-nav.js', 'utf8');

async function isBandThere(p: string) {
  const sharp = (await import('sharp')).default;
  const raw = await sharp(p).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => {
    const i = (y * raw.info.width + x) * raw.info.channels;
    return [raw.data[i], raw.data[i + 1], raw.data[i + 2]];
  };
  let fy = -1;
  for (let y = 0; y < 400; y++) {
    const [r, g] = px(Math.floor(raw.info.width / 2), y);
    if (r < 180 && g < 180) { fy = y; break; }
  }
  return { band: fy > 8, fy };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
// 节流壁纸图片 5 秒 → 首帧光栅化必然早于解码完成
await ctx.route('**/wallpapers/dark-stream.png', async (route) => {
  await new Promise((r) => setTimeout(r, 5000));
  await route.continue();
});
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
await page.goto('http://localhost:3000/', { waitUntil: 'commit' });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/thr-1-early.png' }); // 图片还在节流中（未到）
await page.waitForTimeout(4200); // 图片已到但看是否有白带
await page.evaluate(UNLOCK());
await page.evaluate(() => window.__unlock());
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/thr-2-after-load.png' });
console.log('early:', JSON.stringify(await isBandThere('/tmp/thr-1-early.png')));
console.log('after:', JSON.stringify(await isBandThere('/tmp/thr-2-after-load.png')));

// 若有白带：强制重绘（透明→不透明闪烁）看是否消失
await page.evaluate(() => {
  const w = document.querySelector('[data-boot-wall]') as HTMLElement;
  w.style.backgroundPosition = '50.001% 50%';
  requestAnimationFrame(() => requestAnimationFrame(() => { w.style.backgroundPosition = ''; }));
});
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/thr-3-repaint.png' });
console.log('after repaint nudge:', JSON.stringify(await isBandThere('/tmp/thr-3-repaint.png')));
await browser.close();
