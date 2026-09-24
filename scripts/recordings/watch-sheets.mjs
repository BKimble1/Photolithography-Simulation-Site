// Watch after a seek, frame by frame (?virt=1), on one build: (1) a chapter jump from the furnace
// into the layers with both places already loaded: the frame before the jump and the eleven
// after it; (2) the film played through a machine change, and the same film time reached by a
// paused seek. Writes PNGs to <outdir>/jump and <outdir>/seek; tile them with sheet.py:
//   node scripts/recordings/watch-sheets.mjs http://127.0.0.1:4173 /tmp/watch
//   python3 scripts/recordings/sheet.py /tmp/watch/jump sheet-watch-jump.jpg 4 300 "title"
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [base, OUT] = process.argv.slice(2);
fs.mkdirSync(`${OUT}/jump`, { recursive: true });
fs.mkdirSync(`${OUT}/seek`, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 600 } })).newPage();
await page.goto(base + '/');
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto(base + '/?watch&t=0&virt=1');
await page.waitForFunction(() => !!window.__fabFilm?.filmPlayer() && !!window.__fabAdvance && !!window.__fab?.gl, null, { timeout: 120000 });
const untilLive = () => page.waitForFunction(() => { const w = window; w.__fabAdvance(1); const st = w.__fab.stageFocus.station; return !w.__fab.useStageInfo.getState().flying && (!st || w.__fab.readyStations.has(st)); }, null, { polling: 100, timeout: 180000 });
await untilLive();
const frame = () => page.evaluate(() => {
  const w = window; w.__fabAdvance(1);
  const gl = w.__fab.gl.getContext();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const N = 16, grid = new Array(N * N).fill(0), cnt = new Array(N * N).fill(0);
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) { const i = (y * W + x) * 4; const g = Math.min(N - 1, Math.floor((y / H) * N)) * N + Math.min(N - 1, Math.floor((x / W) * N)); grid[g] += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; cnt[g]++; }
  const c = document.createElement('canvas'); c.width = W / 2; c.height = H / 2; const cx = c.getContext('2d'); const id = cx.createImageData(W / 2, H / 2);
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) { const s = ((H - 1 - y * 2) * W + x * 2) * 4, d = (y * (W / 2) + x) * 4; id.data[d] = px[s]; id.data[d + 1] = px[s + 1]; id.data[d + 2] = px[s + 2]; id.data[d + 3] = 255; }
  cx.putImageData(id, 0, 0);
  return { t: w.__fabFilm.filmPlayer().now(), grid: grid.map((g, i) => g / Math.max(1, cnt[i])), url: c.toDataURL('image/png') };
});
const change = (a, b) => a.grid.reduce((s, v, i) => s + Math.abs(v - b.grid[i]), 0) / a.grid.length;
const save = (name, f) => fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(f.url.split(',')[1], 'base64'));
const chapters = await page.evaluate(() => window.__fabFilm.filmPlayer().tl.chapters.map((c) => c.start));
// load both places, then jump from the furnace into the layers with both loaded
for (const t of [chapters[3] + 2, chapters[1] + 2]) {
  await page.evaluate((x) => window.__fabFilm.filmControls.seek(x), t);
  await untilLive();
}
for (let k = 0; k < 12; k++) await frame();
let prev = await frame();
save('jump/f00 before the jump', prev);
await page.evaluate((x) => window.__fabFilm.filmControls.seek(x), chapters[3] + 2);
const log = [];
for (let k = 1; k <= 11; k++) {
  const f = await frame();
  const ch = change(prev, f);
  log.push(ch.toFixed(2));
  save(`jump/f${String(k).padStart(2, '0')} after +${k} change ${ch.toFixed(1)}`, f);
  prev = f;
}
console.log('jump: picture change per frame after the seek', log.join(' '));
// played through a machine change, then the same film time by a paused seek
const segs = await page.evaluate(() => window.__fabFilm.filmPlayer().tl.segments.map((s) => ({ start: s.start, dur: s.dur, station: s.station })));
const i = segs.findIndex((s, k) => k > 5 && segs[k + 1] && s.station !== segs[k + 1].station);
const gapStart = segs[i].start + segs[i].dur;
await page.evaluate((t) => window.__fabFilm.filmControls.seek(t), gapStart - 1);
await untilLive();
await page.evaluate(() => window.__fabFilm.filmControls.play());
for (let k = 0; k < 20; k++) await frame();
const played = [];
for (let k = 0; k < 60; k++) played.push(await frame());
const t40 = gapStart - 1 + 60 / 30;
await page.evaluate((t) => { const f = window.__fabFilm; f.filmControls.pause(); f.filmControls.seek(t); }, t40);
await frame();
const sought = await frame();
save(`seek/a played t=${played[39].t.toFixed(3)}`, played[39]);
save(`seek/b sought t=${sought.t.toFixed(3)} change ${change(sought, played[39]).toFixed(1)}`, sought);
console.log(`seek: played ${played[39].t.toFixed(3)} vs sought ${sought.t.toFixed(3)}: change ${change(sought, played[39]).toFixed(2)}`);
await browser.close();
