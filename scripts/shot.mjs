// Capture a screenshot of the running dev server: node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs]
import { chromium } from '@playwright/test';
/** Screenshots of the canvas are read after its frame: keep the drawing buffer (?capture=1). */
const withCapture = (u) => (u.includes('capture=1') ? u : u + (u.includes('?') ? '&' : '?') + 'capture=1');
const [,, url, out, w = '1440', h = '900', wait = '4000'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(withCapture(url), { waitUntil: 'networkidle' });
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
const gl = await page.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); return g ? g.getParameter(g.RENDERER) + ' / ' + g.getParameter(g.VERSION) : 'no webgl2'; });
console.log('GL:', gl);
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
