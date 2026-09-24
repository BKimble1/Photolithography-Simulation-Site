// Real-time playback measurements on a running build (normal wall-clock time, never ?virt=1).
//
//   node scripts/perf.mjs <baseUrl> <out.json> [--scenarios a,b,c] [--video dir] [--label text] [--query k=v&k2=v2] [--gpu] [--headed]
//
// Each scenario drives the app the way a learner would (clicks, keys) and records, per phase:
// the interval between animation frames (median, p95, p99, max, frames over 50 and 100 ms, and
// the longest while the camera was moving — it moved into the frame before the gap and again
// across it — and while it held still), long tasks, WebGL draw calls and triangles summed over every render pass of each frame, and
// resource counts (geometries, textures, shader programs, JS heap where the browser reports
// it). The page is opened with ?hooks=1 so the renderer can be observed; nothing else changes.
// With --video the scenario is also recorded in real time (Playwright's screencast), so the
// clip shows the frames as they were actually produced, stalls included.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const args = process.argv.slice(2);
const base = (args[0] ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const outFile = args[1] ?? 'perf.json';
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt('--scenarios')?.split(',');
const videoDir = opt('--video');
const label = opt('--label') ?? '';
/** Extra address parameters for every page (e.g. quality=high to compare at one tier). */
const extra = opt('--query') ? '&' + opt('--query') : '';

// ───────────────────────────── in-page instrumentation ─────────────────────────────

function instrument() {
  // cam: the camera as each frame began (position, orientation, field of view), to tell the
  // frames in which it moved from those in which it held still (waiting for a machine, say)
  const perf = { frames: [], cam: [], marks: [], longTasks: [], gl: [], started: performance.now() };
  window.__perf = perf;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.longTasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* not supported */
  }
  const acc = { calls: 0, tris: 0, passes: 0 };
  let hooked = false;
  const hook = () => {
    const f = window.__fab;
    if (hooked || !f || !f.gl) return;
    hooked = true;
    const gl = f.gl;
    const render = gl.render.bind(gl);
    // renderer.info resets at the start of each render call: sum every pass of the frame
    gl.render = (scene, camera) => {
      render(scene, camera);
      acc.calls += gl.info.render.calls;
      acc.tris += gl.info.render.triangles;
      acc.passes++;
    };
  };
  const loop = (t) => {
    hook();
    perf.frames.push(t);
    const c = window.__fab?.camera;
    perf.cam.push(c ? [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov] : null);
    perf.gl.push({ t, calls: acc.calls, tris: acc.tris, passes: acc.passes });
    acc.calls = acc.tris = acc.passes = 0;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__mark = (name) => perf.marks.push({ name, t: performance.now() });
}

// ───────────────────────────── helpers ─────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Seconds of playback per phase (PERF_HOLD, default 8): enough frames even on software rendering. */
const HOLD = Number(process.env.PERF_HOLD ?? 8) * 1000;

async function stageReady(page, timeout = 120_000) {
  await page.waitForFunction(() => !!window.__fab?.stationBoxes?.size, null, { timeout });
}
async function settled(page, timeout = 60_000) {
  // the director is not travelling (and the lesson clock, if any, is not waiting for it)
  await page.waitForFunction(
    () => {
      const f = window.__fab;
      if (!f) return false;
      const s = f.useStageInfo.getState();
      const c = window.__fabStores?.useClock?.getState?.();
      return !s.flying && !(c && c.pendingPlay);
    },
    null,
    { timeout, polling: 50 },
  );
}
const mark = (page, name) => page.evaluate((n) => window.__mark(n), name);
const resources = (page) =>
  page.evaluate(() => {
    const gl = window.__fab?.gl;
    const m = performance.memory;
    return {
      geometries: gl?.info.memory.geometries ?? null,
      textures: gl?.info.memory.textures ?? null,
      programs: gl?.info.programs?.length ?? null,
      heapMB: m ? Math.round(m.usedJSHeapSize / 1048576) : null,
    };
  });
async function press(page, name, exact = true) {
  await page.getByRole('button', { name, exact }).first().click();
}

// ───────────────────────────── scenarios ─────────────────────────────

const scenarios = {
  // First visit: the bay, the home view's slow establishing move.
  'home-idle': async (page) => {
    await page.goto(`${base}/?hooks=1${extra}`, { waitUntil: 'domcontentloaded' });
    await stageReady(page);
    await mark(page, 'idle');
    await sleep(HOLD);
  },
  // A cold lesson, then two machine changes (load port → robot → inspection).
  'arrive-transfer-scan': async (page) => {
    await page.goto(`${base}/?step=arrive&hooks=1${extra}`, { waitUntil: 'domcontentloaded' });
    await mark(page, 'cold-load');
    await stageReady(page);
    await settled(page);
    await mark(page, 'play-arrive');
    await sleep(HOLD);
    await mark(page, 'to-transfer');
    await press(page, 'Continue');
    await sleep(200);
    await settled(page);
    await mark(page, 'play-transfer');
    await sleep(HOLD);
    await mark(page, 'to-scan');
    await press(page, 'Continue');
    await sleep(200);
    await settled(page);
    await mark(page, 'play-scan');
    await sleep(HOLD);
  },
  // Three steps on one machine (the track), then on to the scanner.
  'prime-coat-softbake': async (page) => {
    await page.goto(`${base}/?step=prime&hooks=1${extra}`, { waitUntil: 'domcontentloaded' });
    await stageReady(page);
    await settled(page);
    await mark(page, 'play-prime');
    await sleep(HOLD);
    await mark(page, 'to-coat');
    await press(page, 'Continue');
    await sleep(200);
    await settled(page);
    await mark(page, 'play-coat');
    await sleep(HOLD);
    await mark(page, 'to-softbake');
    await press(page, 'Continue');
    await sleep(200);
    await settled(page);
    await mark(page, 'play-softbake');
    await sleep(HOLD);
  },
  // Scanner → track (post-exposure bake) → develop, down to the cross-section.
  'expose-peb-develop': async (page) => {
    await page.goto(`${base}/?step=expose&hooks=1${extra}`, { waitUntil: 'domcontentloaded' });
    await stageReady(page);
    await settled(page);
    await mark(page, 'play-expose');
    await sleep(HOLD);
    await mark(page, 'to-peb');
    await press(page, 'Continue');
    await sleep(200);
    await settled(page);
    await mark(page, 'play-peb');
    await sleep(HOLD);
    await mark(page, 'to-develop');
    await press(page, 'Continue');
    await sleep(200);
    await settled(page);
    await page.getByRole('button', { name: 'The resist that was exposed to light' }).click();
    await mark(page, 'play-develop');
    await sleep(HOLD);
  },
  // Inspect layers / Back to equipment, interrupted mid-fade, six times.
  'layers-interrupt': async (page) => {
    await page.goto(`${base}/?step=gate-etch&p=0.5&hooks=1${extra}`, { waitUntil: 'domcontentloaded' });
    await stageReady(page);
    await settled(page);
    await mark(page, 'toggles');
    for (let i = 0; i < 6; i++) {
      await press(page, i % 2 ? 'Back to equipment' : 'Inspect layers');
      await sleep(450);
    }
    await settled(page);
    await mark(page, 'rest');
    await sleep(2000);
  },
  // A lesson → the whole fab → the etch cluster → its demonstration → back to the lesson.
  'explore-roundtrip': async (page) => {
    await page.goto(`${base}/?step=coat&hooks=1${extra}`, { waitUntil: 'domcontentloaded' });
    await stageReady(page);
    await settled(page);
    await sleep(1500);
    await mark(page, 'to-fab');
    await press(page, 'Explore fab');
    await sleep(200);
    await settled(page);
    await mark(page, 'to-etch');
    await press(page, 'Equipment');
    await page.getByRole('button', { name: /^Plasma etch cluster/ }).click();
    await sleep(200);
    await settled(page);
    await mark(page, 'demo');
    await press(page, 'See it work', false);
    await sleep(HOLD);
    await mark(page, 'return');
    await press(page, 'Return to lesson');
    await sleep(200);
    await settled(page);
    await mark(page, 'rest');
    await sleep(1500);
  },
  // Twelve steps forward and back with the arrow keys, then the resource counts again.
  'nav-loop': async (page) => {
    await page.goto(`${base}/?step=arrive&hooks=1${extra}`, { waitUntil: 'domcontentloaded' });
    await stageReady(page);
    await settled(page);
    const r0 = await resources(page);
    await mark(page, 'loop');
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 6; i++) {
        await page.locator('h1.step-title').focus();
        await page.keyboard.press('ArrowRight');
        await sleep(900);
      }
      for (let i = 0; i < 6; i++) {
        await page.locator('h1.step-title').focus();
        await page.keyboard.press('ArrowLeft');
        await sleep(900);
      }
    }
    await settled(page);
    await mark(page, 'rest');
    await sleep(1000);
    const r1 = await resources(page);
    return { resourcesBefore: r0, resourcesAfter: r1 };
  },
  // A lesson on a phone (portrait, pixel ratio 2), then the explorer's whole-fab view.
  'phone-coat-explore': async (page) => {
    await page.goto(`${base}/?step=coat&hooks=1${extra}`, { waitUntil: 'domcontentloaded' });
    await stageReady(page);
    await settled(page);
    await mark(page, 'play-coat');
    await sleep(HOLD);
    await mark(page, 'to-fab');
    await page.getByRole('button', { name: 'Explore fab' }).first().click();
    await sleep(200);
    await settled(page);
    await mark(page, 'fab');
    await sleep(HOLD / 2);
  },
  // The film, from the lithography chapter, for a minute.
  'watch-minute': async (page) => {
    await page.goto(`${base}/?hooks=1${extra}`, { waitUntil: 'domcontentloaded' });
    await stageReady(page);
    await press(page, 'Watch the film');
    await page.waitForFunction(() => window.__fabFilm?.useFilm.getState().status === 'playing', null, { timeout: 60_000 });
    await page.evaluate(() => window.__fabFilm.filmControls.seek(280));
    await sleep(500);
    await mark(page, 'film');
    const t0 = await page.evaluate(() => window.__fabFilm.filmPlayer().now());
    await sleep(60_000);
    const t1 = await page.evaluate(() => window.__fabFilm.filmPlayer().now());
    return { filmSecondsIn60: +(t1 - t0).toFixed(2) };
  },
};

// ───────────────────────────── analysis ─────────────────────────────

const pct = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(q * (a.length - 1) + 0.5))] : null);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

function analyse(perf, t0, t1) {
  const idx = perf.frames.map((t, i) => i).filter((i) => perf.frames[i] >= t0 && perf.frames[i] <= t1);
  const fr = idx.map((i) => perf.frames[i]);
  const iv = [];
  // the longest frame while the camera moved (it moved into the frame before the gap and again
  // across the gap: a stall in the middle of a move, a flight's or a lesson's own) and while it
  // held still (a wait for a machine, or before a move sets off, counts here)
  const moved = (i) => {
    const a = perf.cam[i - 1];
    const b = perf.cam[i];
    if (!a || !b) return false;
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-4 || Math.abs(a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6]) < 1 - 1e-7 || Math.abs(a[7] - b[7]) > 1e-3;
  };
  let maxMoving = 0;
  let maxStill = 0;
  for (let k = 1; k < idx.length; k++) {
    const d = fr[k] - fr[k - 1];
    iv.push(d);
    if (idx[k - 1] > 0 && moved(idx[k - 1]) && moved(idx[k])) maxMoving = Math.max(maxMoving, d);
    else maxStill = Math.max(maxStill, d);
  }
  const s = [...iv].sort((a, b) => a - b);
  const gl = perf.gl.filter((g) => g.t >= t0 && g.t <= t1 && g.passes > 0);
  const calls = gl.map((g) => g.calls).sort((a, b) => a - b);
  const tris = gl.map((g) => g.tris).sort((a, b) => a - b);
  const lt = perf.longTasks.filter((l) => l.start >= t0 && l.start <= t1);
  const secs = (t1 - t0) / 1000;
  return {
    seconds: r1(secs),
    frames: fr.length,
    fps: r1(fr.length / Math.max(0.001, secs)),
    intervalMs: { median: r1(pct(s, 0.5)), p95: r1(pct(s, 0.95)), p99: r1(pct(s, 0.99)), max: r1(s.at(-1)), maxMoving: r1(maxMoving), maxStill: r1(maxStill) },
    over50ms: iv.filter((d) => d > 50).length,
    over100ms: iv.filter((d) => d > 100).length,
    longTasks: { count: lt.length, totalMs: Math.round(lt.reduce((a, l) => a + l.dur, 0)), maxMs: Math.round(Math.max(0, ...lt.map((l) => l.dur))) },
    drawCalls: { median: pct(calls, 0.5), max: calls.at(-1) ?? null },
    triangles: { median: pct(tris, 0.5), max: tris.at(-1) ?? null },
  };
}

// ───────────────────────────── run ─────────────────────────────

const sha = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
  } catch {
    return null;
  }
})();

// Software rendering (SwiftShader) by default, so runs are comparable on machines without a
// GPU; --gpu uses the machine's graphics hardware (with --headed, in a visible window, which
// some drivers need for hardware acceleration).
const gpu = args.includes('--gpu');
const headed = args.includes('--headed');
const browser = await chromium.launch({
  headless: !headed,
  args: gpu
    ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl', '--enable-precise-memory-info']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-precise-memory-info'],
});
const report = { label, base, query: extra.slice(1), sha, date: new Date().toISOString(), host: { cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memGB: Math.round(os.totalmem() / 2 ** 30) }, scenarios: {} };
const viewports = { desktop: { width: 1280, height: 800, deviceScaleFactor: 1 }, phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const list = Object.keys(scenarios).filter((k) => !only || only.includes(k));
if (videoDir) mkdirSync(videoDir, { recursive: true });

for (const name of list) {
  const vp = name.startsWith('phone-') ? viewports.phone : viewports.desktop;
  const { width, height, ...rest } = vp;
  const ctx = await browser.newContext({ viewport: { width, height }, ...rest, ...(videoDir ? { recordVideo: { dir: videoDir, size: { width, height } } } : {}) });
  await ctx.addInitScript(instrument);
  await ctx.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const started = Date.now();
  let extra = null;
  try {
    extra = await scenarios[name](page);
  } catch (e) {
    errors.push(`scenario: ${String(e.message).split('\n')[0]}`);
  }
  const perf = await page.evaluate(() => {
    const p = window.__perf;
    return { frames: p.frames, cam: p.cam, marks: p.marks, longTasks: p.longTasks, gl: p.gl, now: performance.now() };
  });
  const env = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const dbg = c?.getExtension('WEBGL_debug_renderer_info');
    return { ua: navigator.userAgent, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight], renderer: dbg ? c.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : c?.getParameter(c.RENDERER), cores: navigator.hardwareConcurrency, tier: window.__fabQuality?.() ?? null };
  });
  const phases = {};
  for (let i = 0; i < perf.marks.length; i++) {
    const m = perf.marks[i];
    const end = perf.marks[i + 1]?.t ?? perf.now;
    phases[m.name] = analyse(perf, m.t, end);
  }
  const all = analyse(perf, perf.marks[0]?.t ?? 0, perf.now);
  report.scenarios[name] = { env, wallSeconds: Math.round((Date.now() - started) / 1000), overall: all, phases, resources: await resources(page).catch(() => null), extra, errors };
  const v = page.video();
  await ctx.close();
  if (v) report.scenarios[name].video = await v.path();
  console.log(`${name}: ${all.fps} fps, median ${all.intervalMs.median} ms, p95 ${all.intervalMs.p95} ms, >100 ms ${all.over100ms}, long tasks ${all.longTasks.count}${errors.length ? ' ERRORS ' + errors.join(' | ') : ''}`);
}
await browser.close();
writeFileSync(outFile, JSON.stringify(report, null, 1));
console.log(`wrote ${outFile}`);
