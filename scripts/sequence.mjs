// Drive the app through a sequence of actions and capture screenshots (and optionally video).
//   node scripts/sequence.mjs <outDir> <spec.json>
// spec: { "w": 1280, "h": 800, "dpr": 1, "url": "...", "video": false, "reduced": false, "touch": false,
//         "steps": [ { "wait": 500 }, { "click": "css or text=Label" }, { "key": "ArrowRight" },
//                    { "shot": "name" }, { "frames": { "name": "x", "count": 8, "every": 250 } },
//                    { "eval": "js expression" }, { "goto": "url" }, { "tap": [x, y] }, { "drag": [x0, y0, x1, y1] },
//                    { "advance": 30 }, { "film": { "name": "x", "count": 60, "step": 1 } } ] }
// With ?virt=1 in the URL the app renders only on request: "advance" renders n frames of 1/30 s,
// "film" captures count frames, advancing `step` frames before each (for smooth recordings).
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const [, , outDir, specFile] = process.argv;
const spec = JSON.parse(readFileSync(specFile, 'utf8'));
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({
  viewport: { width: spec.w ?? 1280, height: spec.h ?? 800 },
  deviceScaleFactor: spec.dpr ?? 1,
  reducedMotion: spec.reduced ? 'reduce' : 'no-preference',
  hasTouch: !!spec.touch,
  isMobile: !!spec.mobile,
  recordVideo: spec.video ? { dir: outDir, size: { width: spec.w ?? 1280, height: spec.h ?? 800 } } : undefined,
});
const page = await ctx.newPage();
const log = [];
page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && log.push(m.type() + ': ' + m.text()));
if (spec.clear !== false) await page.addInitScript(() => { try { if (!sessionStorage.getItem('__seq')) { localStorage.clear(); sessionStorage.setItem('__seq', '1'); } } catch {} });
await page.goto(spec.url, { waitUntil: 'networkidle' }).catch(() => {});
await page.evaluate(() => document.fonts.ready).catch(() => {});
const t0 = Date.now();
const advance = async (n) => {
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => window.__fabAdvance?.(1));
    await page.waitForTimeout(4);
  }
};
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
for (const st of spec.steps) {
  if (st.wait) await page.waitForTimeout(st.wait);
  if (st.goto) await page.goto(st.goto, { waitUntil: 'networkidle' }).catch(() => {});
  if (st.click) {
    const loc = st.click.startsWith('text=') ? page.getByText(st.click.slice(5), { exact: false }).first() : page.locator(st.click).first();
    await loc.click({ timeout: 10000 }).catch((e) => log.push('click failed: ' + st.click + ' ' + e.message.split('\n')[0]));
  }
  if (st.key) await page.keyboard.press(st.key);
  if (st.tap) await page.touchscreen.tap(st.tap[0], st.tap[1]);
  if (st.drag) {
    const [x0, y0, x1, y1] = st.drag;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10);
    await page.mouse.up();
  }
  if (st.eval) {
    const r = await page.evaluate(st.eval).catch((e) => 'eval failed: ' + e.message);
    log.push(`${stamp()} eval ${st.eval.slice(0, 60)} → ${JSON.stringify(r)}`);
  }
  if (st.advance) await advance(st.advance);
  if (st.film) {
    const { name, count, step = 1 } = st.film;
    mkdirSync(`${outDir}/${name}`, { recursive: true });
    for (let i = 0; i < count; i++) {
      await advance(step);
      await page.screenshot({ path: `${outDir}/${name}/${String(i).padStart(4, '0')}.png`, timeout: 120000 });
    }
    log.push(`${stamp()} film ${name} (${count} frames)`);
  }
  if (st.shot) {
    await page.screenshot({ path: `${outDir}/${st.shot}.png`, timeout: 120000 });
    log.push(`${stamp()} shot ${st.shot}`);
  }
  if (st.frames) {
    const { name, count, every } = st.frames;
    for (let i = 0; i < count; i++) {
      await page.screenshot({ path: `${outDir}/${name}-${String(i).padStart(2, '0')}.png`, timeout: 120000 });
      log.push(`${stamp()} frame ${name}-${i}`);
      if (every) await page.waitForTimeout(every);
    }
  }
}
await ctx.close();
await browser.close();
console.log(log.join('\n'));
