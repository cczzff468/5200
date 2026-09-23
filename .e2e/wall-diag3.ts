/** 壁纸缝隙诊断 #3：解锁前后逐帧观察 + transform/rect 全量抓取 + console 错误收集 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const UNLOCK = () => readFileSync('/home/z/my-project/.e2e/block-nav.js', 'utf8');

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  recordVideo: { dir: '/tmp/wall-vid', size: { width: 390, height: 844 } },
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
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));

await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.evaluate(UNLOCK());
await page.evaluate(() => window.__unlock());
await page.waitForTimeout(2500);

const dump = await page.evaluate(() => {
  const out: Record<string, unknown> = {};
  const probe = (sel: string, name: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) { out[name] = null; return; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[name] = {
      rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      transform: cs.transform,
      borderRadius: cs.borderRadius,
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage.slice(0, 70),
    };
  };
  probe('[data-boot-wall]', 'wallpaperLayer');
  probe('[data-ios-shell]', 'shell');
  probe('[data-lock-screen]', 'lockScreen');
  // 主屏根节点（找 HomeScreen 的类名特征：搜索 label 含打开微信 的父级容器）
  const all = [...document.querySelectorAll('body *')].slice(0, 4000);
  // 找出所有带 transform 且面积接近全屏的元素
  const transformed: string[] = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.transform && cs.transform !== 'none') {
      const r = el.getBoundingClientRect();
      if (r.width > 300 && r.height > 600) {
        transformed.push(`${el.tagName}.${String(el.className).slice(0, 60)} t=${cs.transform.slice(0, 80)} rect=${[r.x, r.y, r.width, r.height].map((n) => +n.toFixed(1)).join(',')}`);
      }
    }
  }
  out.transformedFullscreens = transformed.slice(0, 10);
  return out;
});
console.log(JSON.stringify(dump, null, 1));
console.log('ERRORS:', JSON.stringify(errors.slice(0, 10), null, 1));
await page.screenshot({ path: '/tmp/wall3-home.png' });
await ctx.close();
await browser.close();
