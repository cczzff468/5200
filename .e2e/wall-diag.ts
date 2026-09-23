/** 壁纸边缘缝隙诊断：量出 wrapper/shell/壁纸层/viewport 几何关系 + 横向溢出检查 */
import { chromium } from 'playwright';

async function diag(viewport: { width: number; height: number }, label: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
    const rect = (el: HTMLElement | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2),
        margin: cs.margin, padding: cs.padding, border: cs.borderWidth,
        bgImage: cs.backgroundImage.slice(0, 60), bgSize: cs.backgroundSize, bgPos: cs.backgroundPosition,
        borderRadius: cs.borderRadius, overflow: cs.overflow,
      };
    };
    return {
      innerW: window.innerWidth, innerH: window.innerHeight,
      docScrollW: document.documentElement.scrollWidth,
      docScrollH: document.documentElement.scrollHeight,
      bodyScrollW: document.body.scrollWidth,
      htmlClientW: document.documentElement.clientWidth,
      visualW: (window as unknown as { visualViewport?: { width: number } }).visualViewport?.width,
      wrapper: rect(q('[data-ios-wrap]')),
      shell: rect(q('[data-ios-shell]')),
      wall: rect(q('[data-boot-wall]')),
      lockScreen: !!q('[data-lock-screen]'),
      devicePixelRatio: window.devicePixelRatio,
    };
  });
  console.log(`\n===== ${label} (${viewport.width}x${viewport.height}) =====`);
  console.log(JSON.stringify(info, null, 1));
  await page.screenshot({ path: `/tmp/wall-diag-${label}.png` });
  await browser.close();
}

await diag({ width: 390, height: 844 }, 'mobile390');
await diag({ width: 1280, height: 900 }, 'desktop1280');
await diag({ width: 768, height: 900 }, 'tablet768');
