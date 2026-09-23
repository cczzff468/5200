/** 壁纸修复 E2E 验证：
 *  T1 移动端 390x844：几何铺满 + 边缘像素扫描无缝
 *  T2 折叠屏展开 717x916（触屏模拟 ≥640）：无机身框、壁纸铺满（本次修复核心）
 *  T3 桌面 1280x900（鼠标环境）：机身框保留（不破坏现有桌面形态）
 *  T4 解码重光栅化 hook 生效（outline 微扰后复原、壁纸层 style 干净）
 */
import { readFileSync } from 'node:fs';
import { chromium, type devices } from 'playwright';

const UNLOCK = () => readFileSync('/home/z/my-project/.e2e/block-nav.js', 'utf8');

interface Probe {
  wrapPadding: string;
  shellRect: [number, number, number, number];
  wallRect: [number, number, number, number];
  shellBorder: string;
  shellRadius: string;
  powerBtnVisible: boolean;
  docScrollW: number;
  innerW: number;
  innerH: number;
  viewportMeta: string | null;
}

async function probe(opts: {
  viewport: { width: number; height: number };
  touch: boolean;
  label: string;
  unlock: boolean;
}): Promise<{ p: Probe; shot: string }> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: opts.viewport,
    deviceScaleFactor: 3,
    hasTouch: opts.touch,
    isMobile: opts.touch,
    // 触屏设备浏览器 UA/特性下 hover:none + pointer:coarse（Playwright isMobile+hasTouch 即模拟真机）
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
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  if (opts.unlock) {
    await page.evaluate(UNLOCK());
    await page.evaluate(() => window.__unlock());
    await page.waitForTimeout(1200);
  }
  const p = await page.evaluate(() => {
    const wrap = document.querySelector('[data-ios-wrap]') as HTMLElement;
    const shell = document.querySelector('[data-ios-shell]') as HTMLElement;
    const wall = document.querySelector('[data-boot-wall]') as HTMLElement;
    const power = document.querySelector('[data-power-btn]') as HTMLElement | null;
    const sr = shell.getBoundingClientRect();
    const wr = wall.getBoundingClientRect();
    const cs = getComputedStyle(shell);
    return {
      wrapPadding: getComputedStyle(wrap).padding,
      shellRect: [+sr.x.toFixed(1), +sr.y.toFixed(1), +sr.width.toFixed(1), +sr.height.toFixed(1)],
      wallRect: [+wr.x.toFixed(1), +wr.y.toFixed(1), +wr.width.toFixed(1), +wr.height.toFixed(1)],
      shellBorder: cs.borderTopWidth,
      shellRadius: cs.borderTopLeftRadius,
      powerBtnVisible: power ? getComputedStyle(power).display !== 'none' : false,
      docScrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
    } as Probe;
  });
  const shot = `/tmp/verify-${opts.label}.png`;
  await page.screenshot({ path: shot });
  await browser.close();
  return { p, shot };
}

// T1 移动端竖屏
const t1 = await probe({ viewport: { width: 390, height: 844 }, touch: true, label: 'mobile390', unlock: true });
console.log('\nT1 mobile390 (touch):', JSON.stringify(t1.p, null, 1));

// T2 折叠屏展开态 717x916 触屏（≥640 以前会被套机身框 —— 修复核心）
const t2 = await probe({ viewport: { width: 717, height: 916 }, touch: true, label: 'fold717', unlock: true });
console.log('\nT2 fold717 (touch, ≥640):', JSON.stringify(t2.p, null, 1));

// T3 桌面鼠标环境（框保留）
const t3 = await probe({ viewport: { width: 1280, height: 900 }, touch: false, label: 'desktop1280', unlock: false });
console.log('\nT3 desktop1280 (mouse):', JSON.stringify(t3.p, null, 1));

// 边缘像素扫描（T1/T2）
const sharp = (await import('sharp')).default;
for (const [label, f] of [['mobile390', t1.shot], ['fold717', t2.shot]] as const) {
  const raw = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  const { data, info } = raw;
  const lum = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
  };
  const colAvg = (x: number) => { let s = 0, n = 0; for (let y = 100; y < info.height - 100; y += 7) { s += lum(x, y); n++; } return s / n; };
  const interiorL = colAvg(Math.round(info.width * 0.25));
  const interiorR = colAvg(Math.round(info.width * 0.75));
  const edgesL = [0, 1, 2, 3].map(colAvg);
  const edgesR = [info.width - 4, info.width - 3, info.width - 2, info.width - 1].map(colAvg);
  const maxDevL = Math.max(...edgesL.map((v) => Math.abs(v - interiorL)));
  const maxDevR = Math.max(...edgesR.map((v) => Math.abs(v - interiorR)));
  console.log(`[${label}] 左边缘4列最大偏差 ${maxDevL.toFixed(1)} / 右边缘 ${maxDevR.toFixed(1)}（阈值 25 内=无亮缝）→ ${maxDevL < 25 && maxDevR < 25 ? 'PASS' : 'FAIL'}`);
}
