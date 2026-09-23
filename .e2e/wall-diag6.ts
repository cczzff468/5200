/** 壁纸缝隙诊断 #6：浏览器内 canvas 解码采样 dark-stream.png 顶部像素 + Image自然尺寸 */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://localhost:3000/wallpapers/dark-stream.png');
await page.waitForTimeout(500);

const result = await page.evaluate(async () => {
  const img = new Image();
  img.src = '/wallpapers/dark-stream.png?' + Math.random();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  const w = img.naturalWidth, h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx2d = canvas.getContext('2d')!;
  ctx2d.drawImage(img, 0, 0);
  const sample = (x: number, y: number) => {
    const d = ctx2d.getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  };
  const rows: Record<string, number[][]> = {};
  for (const y of [0, 5, 20, 50, 100, 200, 500, 1000, 1300, h - 1]) {
    rows['y=' + y] = [sample(10, y), sample(Math.floor(w / 2), y), sample(w - 10, y)];
  }
  return { naturalWidth: w, naturalHeight: h, rows };
});
console.log(JSON.stringify(result, null, 1));
await browser.close();
