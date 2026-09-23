// Capture WebGL frames (the canvas only, read back in the same task) at given lesson points:
//   node scripts/frames.mjs <baseUrl> "/?step=coat&virt=1" <outDir> p=0 p=0.05 next settle grab=name adv=10
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
const [, , base, path, outDir, ...spec] = process.argv;
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base + '/');
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto(base + path);
await page.waitForFunction(() => !!window.__fab && window.__fab.stationBoxes.size > 0 && !!window.__fabAdvance, undefined, { timeout: 120000 });
const grab = (name) => page.evaluate(() => {
  window.__fabAdvance(1);
  const gl = window.__fab.gl.getContext();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}).then((d) => writeFileSync(`${outDir}/${name}.png`, Buffer.from(d.split(',')[1], 'base64')));
const settle = async () => { for (let i = 0; i < 80; i++) { await page.evaluate(() => window.__fabAdvance(5)); const s = await page.evaluate(() => { const i = window.__fab.useStageInfo.getState(); return !i.flying && i.shown; }); if (s) return; } };
await settle();
// spec items: "p=0.05" (scrub and grab), "next", "prev", "adv=N", "grab=name"
let k = 0;
for (const s of spec) {
  if (s === 'next' || s === 'prev') { await page.evaluate((m) => window.__fabStores.useApp.getState()[m](), s); continue; }
  if (s === 'settle') { await settle(); continue; }
  if (s.startsWith('adv=')) { await page.evaluate((n) => window.__fabAdvance(n), Number(s.slice(4))); continue; }
  if (s.startsWith('p=')) { const p = Number(s.slice(2)); await page.evaluate((p) => { const c = window.__fabStores.useClock.getState(); c.set(p); c.pause(); }, p); await page.evaluate(() => window.__fabAdvance(2)); await grab(String(k++).padStart(2, '0') + '_p' + p); continue; }
  if (s.startsWith('grab=')) { await grab(String(k++).padStart(2, '0') + '_' + s.slice(5)); continue; }
}
console.log(JSON.stringify({ errors: errors.slice(0, 8), info: await page.evaluate(() => ({ step: window.__fabStores.useApp.getState().step, ...window.__fab.useStageInfo.getState() })) }));
await browser.close();
