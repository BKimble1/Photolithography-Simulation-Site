// Capture a batch of screenshots: node scripts/capture.mjs <outDir> <specs.json>
// specs: [{ "name": "home-1280x640", "url": "http://127.0.0.1:5173/", "w": 1280, "h": 640, "wait": 5000, "dpr": 1, "reduced": false }]
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
/** Screenshots of the canvas are read after its frame: keep the drawing buffer (?capture=1). */
const withCapture = (u) => (u.includes('capture=1') ? u : u + (u.includes('?') ? '&' : '?') + 'capture=1');
const [, , outDir, specFile] = process.argv;
const specs = JSON.parse(readFileSync(specFile, 'utf8'));
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
for (const s of specs) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dpr ?? 1, reducedMotion: s.reduced ? 'reduce' : 'no-preference', hasTouch: !!s.touch, isMobile: !!s.mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  if (s.clear !== false) await page.addInitScript(() => { try { if (!sessionStorage.getItem('__cap')) { localStorage.clear(); sessionStorage.setItem('__cap', '1'); } } catch {} });
  if (s.zoom) await page.addInitScript((z) => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = z; }); }, s.zoom);
  await page.goto(withCapture(s.url), { waitUntil: 'networkidle' }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(s.wait ?? 5000);
  await page.screenshot({ path: `${outDir}/${s.name}.png`, timeout: 60000 }).catch((e) => errors.push('screenshot: ' + e.message));
  console.log(s.name, errors.length ? 'ERRORS: ' + errors.slice(0, 3).join(' | ') : 'ok');
  await ctx.close();
}
await browser.close();
