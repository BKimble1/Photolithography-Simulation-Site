// Dev helper: report frame rate and Continue-button stability for a page in headless Chromium.
// Usage: node scripts/fps.mjs "<url>" [width] [height]
import { chromium } from '@playwright/test';
const [,, url, w = '1440', h = '900'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
for (let i = 0; i < 4; i++) {
  const r = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now(); let longest = 0; let last = t0;
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Continue');
    const boxes = new Set();
    const f = () => { const t = performance.now(); longest = Math.max(longest, t - last); last = t; n++; if (btn) { const b = btn.getBoundingClientRect(); boxes.add(`${b.x.toFixed(1)},${b.y.toFixed(1)},${b.width.toFixed(1)},${b.height.toFixed(1)}`); } if (t - t0 < 2000) requestAnimationFrame(f); else res({ fps: n / ((t - t0) / 1000), longest, boxes: [...boxes] }); };
    requestAnimationFrame(f);
  }));
  console.log(JSON.stringify(r));
}
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
