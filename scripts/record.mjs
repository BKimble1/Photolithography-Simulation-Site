// Record a short video of the app, rendered frame by frame on the virtual clock (?virt=1), so
// motion is smooth and correctly timed even on a slow software renderer. Optionally adds the
// film's narration for a Watch excerpt (the same MP3s the app plays, placed on the same
// timeline).
//
//   node scripts/record.mjs <spec.json>
//
// spec: { "name": "develop-layers", "w": 960, "h": 540, "url": "http://127.0.0.1:5173/?step=develop&virt=1",
//         "setup": [ ...sequence.mjs steps... ], "frames": 300, "film": false,
//         "out": "docs/recordings/develop-layers.mp4" }
// With "film": true the recording starts at the film's current time and the narration of
// that stretch is muxed in (needs tools/narration/.venv for ffmpeg and numpy).
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
/** Screenshots of the canvas are read after its frame: keep the drawing buffer (?capture=1). */
const withCapture = (u) => (u.includes('capture=1') ? u : u + (u.includes('?') ? '&' : '?') + 'capture=1');

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const tmp = join(tmpdir(), `fabrec-${spec.name}`);
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const FFMPEG = execFileSync('tools/narration/.venv/bin/python', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({
  viewport: { width: spec.w, height: spec.h },
  deviceScaleFactor: spec.dpr ?? 1,
  reducedMotion: spec.reduced ? 'reduce' : 'no-preference',
  hasTouch: !!spec.touch,
  isMobile: !!spec.mobile,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  try {
    if (!sessionStorage.getItem('__rec')) {
      localStorage.clear();
      sessionStorage.setItem('__rec', '1');
    }
  } catch {}
});
await page.goto(withCapture(spec.url), { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const advance = async (n) => {
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => window.__fabAdvance?.(1));
    await page.waitForTimeout(2);
  }
};
for (const st of spec.setup ?? []) {
  if (st.wait) await page.waitForTimeout(st.wait);
  if (st.advance) await advance(st.advance);
  if (st.click) await (st.click.startsWith('text=') ? page.getByText(st.click.slice(5)).first() : page.locator(st.click).first()).click();
  if (st.eval) await page.evaluate(st.eval);
  if (st.key) await page.keyboard.press(st.key);
}
const t0 = spec.film ? await page.evaluate(() => window.__fabFilm.filmPlayer().t) : 0;
const started = Date.now();
for (let i = 0; i < spec.frames; i++) {
  for (const ev of spec.during ?? []) if (ev.frame === i) await page.evaluate(ev.eval);
  await advance(1);
  await page.screenshot({ path: join(tmp, `${String(i).padStart(5, '0')}.png`), timeout: 120000 });
  if (i % 50 === 0) console.log(`${spec.name}: frame ${i}/${spec.frames} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
}
let audioArgs = [];
if (spec.film) {
  const segs = await page.evaluate(() => window.__fabFilm.filmPlayer().tl.segments.map((s) => ({ start: s.start, file: s.file })));
  const base = await page.evaluate(() => new URL(`narration/${window.__fabFilm.filmPlayer().tl.version}/`, location.origin + '/').pathname);
  writeFileSync(join(tmp, 'film.json'), JSON.stringify({ from: t0, dur: spec.frames / 30, segments: segs, dir: 'public' + base }));
  execFileSync('tools/narration/.venv/bin/python', ['scripts/film_audio.py', join(tmp, 'film.json'), join(tmp, 'film.wav')], { stdio: 'inherit' });
  audioArgs = ['-i', join(tmp, 'film.wav'), '-c:a', 'aac', '-b:a', '96k', '-shortest'];
}
await browser.close();
mkdirSync(dirname(spec.out), { recursive: true });
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', '30', '-i', join(tmp, '%05d.png'), ...audioArgs, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart', spec.out], { stdio: 'inherit' });
console.log(`${spec.name}: wrote ${spec.out} (${spec.frames} frames)${errors.length ? ' ERRORS: ' + errors.slice(0, 3).join(' | ') : ''}`);
