/** 壁纸缝隙诊断 #8：时间轴连拍定位白带出现时机（重复 5 次实验） */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const UNLOCK = () => readFileSync('/home/z/my-project/.e2e/block-nav.js', 'utf8');

async function isBandThere(screenshotPath: string): Promise<{ band: boolean; firstDarkY: number }> {
  const sharp = (await import('sharp')).default;
  const raw = await sharp(screenshotPath).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => {
    const i = (y * raw.info.width + x) * raw.info.channels;
    return [raw.data[i], raw.data[i + 1], raw.data[i + 2]];
  };
  let firstDarkY = -1;
  for (let y = 0; y < 300; y++) {
    const [r, g] = px(200, y);
    if (r < 180 && g < 180) { firstDarkY = y; break; }
  }
  return { band: firstDarkY > 8, firstDarkY };
}

for (let trial = 1; trial <= 5; trial++) {
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
  await page.waitForTimeout(1500);
  await page.evaluate(UNLOCK());
  await page.evaluate(() => window.__unlock());
  // 解锁后连拍
  const timeline: string[] = [];
  for (let i = 0; i < 10; i++) {
    const p = `/tmp/TL-${trial}-${i}.png`;
    await page.screenshot({ path: p });
    const { band, firstDarkY } = await isBandThere(p);
    timeline.push(`t+${i * 400}ms band=${band ? 'YES(firstDarkY=' + firstDarkY + ')' : 'no'}`);
    await page.waitForTimeout(400);
  }
  console.log(`trial ${trial}: ${timeline.join(' | ')}`);
  await browser.close();
}
