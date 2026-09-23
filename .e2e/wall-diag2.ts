/** 壁纸边缘缝隙诊断 #2：解锁后主屏，分别测 graphite 渐变 / dark-stream PNG / 自定义壁纸三种情况 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const UNLOCK = () => readFileSync('/home/z/my-project/.e2e/block-nav.js', 'utf8');

async function diag(preset: string, label: string) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('ios-display', JSON.stringify({ theme: 'dark', wallpaper: 'dark-stream', lockWallpaper: 'graphite', lockScreen: false, tz: 'Asia/Shanghai' })); } catch {}
    // 种 IndexedDB：load() 后 store 从这里读壁纸（localStorage 镜像只管首帧）
    const req = indexedDB.open('ios-phone-db');
    req.onsuccess = () => {
      const db = req.result as IDBDatabase;
      try {
        const tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').put({ key: 'wallpaper', value: { preset: 'dark-stream' } });
        tx.oncomplete = () => db.close();
      } catch {}
    };
  });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.evaluate(UNLOCK());
  const r = await page.evaluate(() => window.__unlock());
  await page.waitForTimeout(900);
  const info = await page.evaluate(() => {
    const wall = document.querySelector('[data-boot-wall]') as HTMLElement | null;
    const shell = document.querySelector('[data-ios-shell]') as HTMLElement | null;
    const cs = wall ? getComputedStyle(wall) : null;
    const rs = wall?.getBoundingClientRect();
    const rss = shell?.getBoundingClientRect();
    // 左边缘采样：壁纸层最左 1px 列与 shell 最左列的颜色是否一致（缩放比 3 下取 0.33px 内）
    return {
      unlock: window.__unlockResult ?? null,
      wallRect: rs ? { x: +rs.x.toFixed(2), y: +rs.y.toFixed(2), w: +rs.width.toFixed(2), h: +rs.height.toFixed(2) } : null,
      shellRect: rss ? { x: +rss.x.toFixed(2), y: +rss.y.toFixed(2), w: +rss.width.toFixed(2), h: +rss.height.toFixed(2) } : null,
      bgImage: cs?.backgroundImage.slice(0, 80),
      bgSize: cs?.backgroundSize,
      bgPos: cs?.backgroundPosition,
      innerW: window.innerWidth,
      docScrollW: document.documentElement.scrollWidth,
    };
  });
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify({ ...info, unlock: r }, null, 1));
  await page.screenshot({ path: `/tmp/wall2-${label}.png` });
  await browser.close();
}

await diag('dark-stream', 'png-preset');
