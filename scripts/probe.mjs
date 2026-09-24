// Reproduces the round-three review findings on a build, frame by frame, and measures them
// the same way before and after the fixes (docs/ROUND3.md).
//
//   node scripts/probe.mjs <baseUrl> <out.json> [--cases a,b,c]
//
// The build must expose the test hooks (?virt=1 does). Frames are stepped on the harness
// clock (1/30 s each) and read back from the drawing buffer in the same task, so every frame
// the viewer would see is examined; nothing here measures frame rate (see scripts/perf.mjs).
//
// Cases:
//   leave-partial   leave a lesson half-way (non-default dose) for another machine: does the
//                   machine left behind change in the first frame of the move? is the
//                   learner's wafer ever on screen twice?
//   back-same       go back a lesson on the same machine (coat → prime): a one-frame jump?
//   next-same       finish a lesson and go on at the same machine (prime → coat): does the
//                   wafer teleport between modules?
//   interrupt       reverse "Inspect layers" / "Back to equipment" half-way through the
//                   cross-fade: a one-frame jump at the interruption?
//   film-gap        Watch: how many move plans are built while the film crosses a gap
//   slow-load       the next machine's module arrives 15 s late: does the camera fly into a
//                   machine that is not there?
//   load-fail       the next machine's module fails to load
//   shadows         shadow-map redraws per frame, settled and during a move
//   coat-uploads    large texture uploads while the coat lesson plays
//   op-boundary     frame cost when the cross-section changes (process operations)
//   decor-virt      decorative motion per harness frame (overhead vehicles)
//   pairs           every pair of consecutive lessons at one machine: finish the first, go on
//                   to the second; how far does the learner's wafer jump in one frame?
//   anchors         the camera while it frames a wafer that the machine is moving (flipping it,
//                   stepping and scanning it): does the camera chase it, shaking or swinging?
//   transitions     the whole course, lesson by lesson: finish each lesson, go on, and record
//                   every frame of the move until the camera settles (jumps, wafers on screen,
//                   wafer teleports, the hand-over, blank frames: the camera inside something)
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [, , base = 'http://127.0.0.1:4173', out = 'probe.json', ...rest] = process.argv;
const opt = (k) => {
  const i = rest.indexOf(k);
  return i >= 0 ? rest[i + 1] : undefined;
};
const ALL = ['leave-partial', 'back-same', 'next-same', 'interrupt', 'film-gap', 'slow-load', 'load-fail', 'shadows', 'coat-uploads', 'op-boundary', 'decor-virt', 'pairs', 'anchors', 'transitions'];
/** Consecutive lessons at the same machine: each must end where the next one starts. */
const PAIRS = [
  ['arrive', 'foup'],
  ['prime', 'track'],
  ['coat', 'track'],
  ['reticle', 'scanner'],
  ['align', 'scanner'],
  ['peb', 'track'],
  ['gate-etch', 'etch'],
  ['contact-align', 'scanner'],
  ['contact-fill', 'cmp'],
  ['metal1', 'cmp'],
  ['attach', 'package'],
];
const cases = (opt('--cases') ?? ALL.join(',')).split(',');
/** The lessons in order (src/sim/flow.ts). */
const STEP_IDS = ['arrive','transfer','scan','clean','diemap','padox','sti-etch','sti-fill','wells','anneal','gatestack','prime','coat','softbake','reticle','align','expose','peb','develop','adi','gate-etch','strip','sd','pmd','contact-align','contact-print','contact-etch','contact-fill','metal1','metal2','passivate','inspect','probe','dice','attach','bond','final'];

/** In-page helpers (installed before the app starts). */
function helpers() {
  const w = window;
  // count large texture uploads (canvas textures of wafers, say)
  w.__uploads = 0;
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    for (const name of ['texImage2D', 'texSubImage2D']) {
      const orig = C.prototype[name];
      C.prototype[name] = function (...a) {
        const src = a.find((x) => x && typeof x === 'object' && 'width' in x && 'height' in x);
        const wd = src ? src.width : typeof a[3] === 'number' ? a[3] : 0;
        if (wd >= 512) w.__uploads++;
        return orig.apply(this, a);
      };
    }
  }
  // long tasks (main-thread stalls over 50 ms)
  w.__longtasks = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__longtasks.push({ t: e.startTime, ms: e.duration }))).observe({ type: 'longtask', buffered: true });
  } catch {
    /* not supported */
  }
  const edgeLike = (m) => m && m.metalness === 0.9 && m.roughness === 0.25 && m.color && m.color.getHex() === 0x8f949c;
  const chainVisible = (o) => {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };
  w.__probe = {
    /** Render one harness frame and read back the picture (16 × 16 luminance grid). */
    frame() {
      w.__fabAdvance(1);
      const gl = w.__fab.gl.getContext();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const W = gl.drawingBufferWidth;
      const H = gl.drawingBufferHeight;
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const N = 16;
      const grid = new Array(N * N).fill(0);
      const cnt = new Array(N * N).fill(0);
      for (let y = 0; y < H; y += 3)
        for (let x = 0; x < W; x += 3) {
          const i = (y * W + x) * 4;
          const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          const g = Math.min(N - 1, Math.floor((y / H) * N)) * N + Math.min(N - 1, Math.floor((x / W) * N));
          grid[g] += l;
          cnt[g]++;
        }
      return grid.map((g, i) => g / Math.max(1, cnt[i]));
    },
    /** The learner's wafers (Wafer meshes) drawn this frame, and where. */
    wafers() {
      const f = w.__fab;
      const cam = f.camera;
      const out = [];
      const v = new f.THREE.Vector3();
      f.scene.traverse((o) => {
        if (!o.isMesh || !Array.isArray(o.material) || o.material.length !== 2 || !edgeLike(o.material[1])) return;
        if (!chainVisible(o)) return;
        o.getWorldPosition(v);
        let st = null;
        f.stationGroups.forEach((g, id) => {
          for (let p = o; p; p = p.parent) if (p === g) st = id;
        });
        const n = v.clone().project(cam);
        const onScreen = n.z < 1 && Math.abs(n.x) < 1.02 && Math.abs(n.y) < 1.02;
        out.push({ st, pos: [v.x, v.y, v.z].map((x) => +x.toFixed(4)), onScreen });
      });
      return out;
    },
    info() {
      const f = w.__fab;
      const s = f.useStageInfo.getState();
      const c = w.__fabStores?.useClock.getState();
      const a = w.__fabStores?.useApp.getState();
      const p = f.camera.position;
      return { flying: s.flying, space: s.space, loading: s.loading ?? null, shown: s.shown ?? null, step: a?.step, progress: c?.progress, cam: [p.x, p.y, p.z].map((x) => +x.toFixed(3)), fov: f.camera.fov, ready: [...f.readyStations] };
    },
  };
}

const change = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
let sha = '';
try {
  sha = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  /* not a checkout */
}
const report = { base, sha, date: new Date().toISOString(), cases: {} };

async function open(path, { route, realTime = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(helpers);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  await page.goto(base + '/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  if (route) await route(page);
  await page.goto(base + path);
  await page.waitForFunction((rt) => !!window.__fab && window.__fab.stationBoxes.size > 0 && (rt || !!window.__fabAdvance), realTime, { timeout: 180_000 });
  return { ctx, page, errors };
}

const frame = (page) => page.evaluate(() => window.__probe.frame());
const wafers = (page) => page.evaluate(() => window.__probe.wafers());
const info = (page) => page.evaluate(() => window.__probe.info());
const adv = (page, n) => page.evaluate((k) => window.__fabAdvance(k), n);

/** Step frames until the camera has settled (and the lesson may play). */
async function settle(page, max = 400) {
  for (let n = 0; n < max; n += 5) {
    await adv(page, 5);
    const i = await info(page);
    if (!i.flying && (i.shown === null || i.shown) && i.ready.length) return n;
  }
  return max;
}

/** Record `n` frames: picture change, the learner's wafers, the camera. */
async function record(page, n, from = null) {
  const frames = [];
  let prev = from;
  for (let k = 0; k < n; k++) {
    const g = await frame(page);
    const wf = await wafers(page);
    const i = await info(page);
    frames.push({ change: prev ? +change(prev, g).toFixed(3) : 0, detail: +detail(g).toFixed(2), wafersOnScreen: wf.filter((x) => x.onScreen).length, wafers: wf, ...i });
    prev = g;
  }
  return { frames, last: prev };
}

/** How much structure a picture has: the spread of its grid's luminances. A frame the camera
 * takes from inside a housing or a bench, or from a white-out, is nearly uniform. */
const detail = (g) => {
  const m = g.reduce((a, v) => a + v, 0) / g.length;
  return Math.sqrt(g.reduce((a, v) => a + (v - m) ** 2, 0) / g.length);
};
/** A frame with less detail than this (luminance levels, 0–255) is counted as blank. */
const BLANK = 4;

/** The largest one-frame picture change relative to its neighbourhood (a jump). */
function spikes(frames, from = 1) {
  let worst = { at: -1, change: 0, ratio: 0 };
  for (let k = from; k < frames.length; k++) {
    const around = frames.slice(Math.max(1, k - 4), k).concat(frames.slice(k + 1, k + 5)).map((f) => f.change);
    const ref = Math.max(0.25, median(around));
    const r = frames[k].change / ref;
    if (r > worst.ratio) worst = { at: k, change: frames[k].change, ratio: +r.toFixed(2) };
  }
  return worst;
}

const run = {
  async 'leave-partial'() {
    const { ctx, page, errors } = await open('/?step=expose&dose=3&virt=1');
    await settle(page);
    await page.evaluate(() => {
      const c = window.__fabStores.useClock.getState();
      c.set(0.45);
      c.play();
    });
    await adv(page, 3);
    const before = await record(page, 3);
    const scannerBefore = before.frames.at(-1).wafers.filter((x) => x.st === 'scanner');
    await page.evaluate(() => window.__fabStores.useApp.getState().next());
    const after = await record(page, 90, before.last);
    const first = after.frames[0];
    const scannerAfter = after.frames[0].wafers.filter((x) => x.st === 'scanner');
    const moved = scannerBefore.length && scannerAfter.length ? +dist(scannerBefore[0].pos, scannerAfter[0].pos).toFixed(4) : null;
    const res = {
      // the first frame after "Next": the camera has barely moved, so the picture should not change
      firstFrameChange: first.change,
      typicalFlightChange: median(after.frames.slice(2, 30).map((f) => f.change)),
      scannerWaferBefore: scannerBefore.map((x) => x.pos),
      scannerWaferAfter: scannerAfter.map((x) => x.pos),
      scannerWaferMoved: moved,
      maxWafersOnScreen: Math.max(...after.frames.map((f) => f.wafersOnScreen)),
      framesWithTwoWafers: after.frames.filter((f) => f.wafersOnScreen > 1).length,
      spike: spikes(after.frames, 1),
      errors,
    };
    await ctx.close();
    return res;
  },

  async 'back-same'() {
    const { ctx, page, errors } = await open('/?step=coat&spin=0.9&virt=1');
    await settle(page);
    await page.evaluate(() => {
      const c = window.__fabStores.useClock.getState();
      c.set(0.5);
      c.play();
    });
    await adv(page, 3);
    const before = await record(page, 4);
    const w0 = before.frames.at(-1).wafers.filter((x) => x.st === 'track');
    await page.evaluate(() => window.__fabStores.useApp.getState().prev());
    const after = await record(page, 45, before.last);
    const all = [...before.frames, ...after.frames];
    const jumps = [];
    for (let k = 1; k < all.length; k++) {
      const a = all[k - 1].wafers.find((x) => x.st === 'track');
      const b = all[k].wafers.find((x) => x.st === 'track');
      if (a && b) jumps.push(+dist(a.pos, b.pos).toFixed(4));
    }
    const res = { trackWaferBefore: w0.map((x) => x.pos), maxWaferStepPerFrame: Math.max(0, ...jumps), spike: spikes(all, before.frames.length), firstFrameChange: after.frames[0].change, errors };
    await ctx.close();
    return res;
  },

  async 'next-same'() {
    const { ctx, page, errors } = await open('/?step=prime&virt=1');
    await settle(page);
    await page.evaluate(() => window.__fabStores.useClock.getState().set(1));
    await adv(page, 3);
    const before = await record(page, 3);
    await page.evaluate(() => window.__fabStores.useApp.getState().next());
    const after = await record(page, 40, before.last);
    // then play the new lesson's opening
    await page.evaluate(() => window.__fabStores.useClock.getState().play());
    const opening = await record(page, 60, after.last);
    const all = [...before.frames, ...after.frames, ...opening.frames];
    const steps = [];
    for (let k = 1; k < all.length; k++) {
      const a = all[k - 1].wafers.find((x) => x.st === 'track');
      const b = all[k].wafers.find((x) => x.st === 'track');
      steps.push(a && b ? +dist(a.pos, b.pos).toFixed(4) : null);
    }
    const res = {
      waferBefore: before.frames.at(-1).wafers.filter((x) => x.st === 'track').map((x) => x.pos),
      waferAfterNext: after.frames[0].wafers.filter((x) => x.st === 'track').map((x) => x.pos),
      maxWaferStepPerFrame: Math.max(0, ...steps.filter((x) => x !== null)),
      framesWithoutWafer: steps.filter((x) => x === null).length,
      spike: spikes(all, before.frames.length),
      errors,
    };
    await ctx.close();
    return res;
  },

  async interrupt() {
    const { ctx, page, errors } = await open('/?step=gate-etch&p=0.5&virt=1');
    await settle(page);
    const trials = [];
    // out of the cross-section, reversed at several points of the fade; then in, reversed
    for (const [first, second, at] of [
      ['tool', 'device', 10],
      ['tool', 'device', 16],
      ['tool', 'device', 22],
      ['device', 'tool', 36],
      ['device', 'tool', 46],
      ['device', 'tool', 56],
    ]) {
      const cur = (await info(page)).space;
      // start from the opposite space of the first move
      if ((first === 'tool' && cur !== 'device') || (first === 'device' && cur !== 'world')) {
        await page.evaluate((v) => window.__fabStores.useApp.getState().setScaleOverride(v), first === 'tool' ? 'device' : 'tool');
        await settle(page);
      }
      await page.evaluate((v) => window.__fabStores.useApp.getState().setScaleOverride(v), first);
      const pre = await record(page, at);
      await page.evaluate((v) => window.__fabStores.useApp.getState().setScaleOverride(v), second);
      const post = await record(page, 20, pre.last);
      const all = [...pre.frames, ...post.frames];
      trials.push({ first, at, interruptChange: post.frames[0].change, before: median(pre.frames.slice(-5).map((f) => f.change)), spike: spikes(all, pre.frames.length - 1) });
      await settle(page);
    }
    const res = { trials, worstRatio: Math.max(...trials.map((t) => t.spike.ratio)), errors };
    await ctx.close();
    return res;
  },

  async 'film-gap'() {
    // count new camera paths (Catmull-Rom arc-length tables) built while crossing a gap
    const { ctx, page, errors } = await open('/?watch&t=0&virt=1');
    await page.evaluate(() => {
      const C = window.__fab.THREE.CatmullRomCurve3.prototype;
      const orig = C.getLengths;
      window.__curves = 0;
      C.getLengths = function (d) {
        if (!this.cacheArcLengths || this.needsUpdate) window.__curves++;
        return orig.call(this, d);
      };
    });
    const tl = await page.evaluate(() => {
      const t = window.__fabFilm.useFilm.getState().tl;
      return t ? t.segments.map((s) => ({ start: s.start, dur: s.dur, gap: s.gapAfter, station: s.station })) : null;
    });
    // a gap between two different machines, some way into the film
    const i = tl.findIndex((s, k) => k > 3 && tl[k + 1] && s.station && tl[k + 1].station && s.station !== tl[k + 1].station);
    const seg = tl[i];
    await page.evaluate((t) => window.__fabFilm.filmControls.seek(t), seg.start + seg.dur - 0.3);
    await page.evaluate(() => window.__fabFilm.filmControls.play());
    await adv(page, 20);
    const c0 = await page.evaluate(() => window.__curves);
    const frames = Math.ceil((seg.gap + 0.6) * 30);
    await adv(page, frames);
    const c1 = await page.evaluate(() => window.__curves);
    const res = { gap: { segment: i, seconds: seg.gap, from: seg.station, to: tl[i + 1].station }, frames, curvesBuilt: c1 - c0, gapStats: await page.evaluate(() => window.__fab.gapStats ?? null), errors };
    await ctx.close();
    return res;
  },

  async 'slow-load'() {
    // real time: the old director gave up waiting after three seconds of wall-clock time
    const delay = 15_000;
    const { ctx, page, errors } = await open('/?step=gatestack&hooks=1', {
      realTime: true,
      route: (page) =>
        page.route(/\/(assets\/Track-[^/]*\.js|src\/three\/tools\/Track\.tsx)/, async (r) => {
          await new Promise((res) => setTimeout(res, delay));
          await r.continue();
        }),
    });
    await page.waitForFunction(() => {
      const s = window.__fab.useStageInfo.getState();
      return !s.flying && s.shown !== false && window.__fab.readyStations.size > 0;
    }, undefined, { timeout: 180_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__fabStores.useApp.getState().next());
    const t0 = Date.now();
    const samples = [];
    while (Date.now() - t0 < delay + 10_000) {
      const i = await info(page);
      const extra = await page.evaluate(() => {
        const c = window.__fab.stationBoxes.get('track');
        const v = new window.__fab.THREE.Vector3();
        c.getCenter(v);
        const p = window.__fab.camera.position;
        return { toTrack: Math.hypot(p.x - v.x, p.z - v.z), notice: document.querySelector('.vp-loading')?.textContent ?? null };
      });
      samples.push({ t: Date.now() - t0, ...i, ...extra, trackReady: i.ready.includes('track') });
      await new Promise((r) => setTimeout(r, 250));
    }
    // (samples taken before the next frame has been drawn still show the old, settled state)
    const moved = samples.findIndex((s) => s.flying);
    const after = moved >= 0 ? samples.slice(moved) : samples;
    const settledEarly = after.find((s) => !s.flying && !s.trackReady);
    const res = {
      delayMs: delay,
      // the camera finished its move while the machine was still missing
      settledBeforeReady: !!settledEarly,
      firstSettled: after.find((s) => !s.flying) ?? null,
      nearestBeforeReady: Math.min(...samples.filter((s) => !s.trackReady).map((s) => s.toTrack)),
      loadingNotice: samples.find((s) => s.notice)?.notice ?? null,
      readyAt: samples.find((s) => s.trackReady)?.t ?? null,
      errors,
    };
    await ctx.close();
    return res;
  },

  async 'load-fail'() {
    const { ctx, page, errors } = await open('/?step=gatestack&virt=1', {
      route: (page) => page.route(/\/(assets\/Track-[^/]*\.js|src\/three\/tools\/Track\.tsx)/, (r) => r.abort()),
    });
    await settle(page);
    await page.evaluate(() => window.__fabStores.useApp.getState().next());
    for (let k = 0; k < 40; k++) {
      await adv(page, 3).catch(() => {});
      await new Promise((r) => setTimeout(r, 100));
    }
    const res = await page.evaluate(() => ({
      canvas: document.querySelectorAll('canvas').length,
      fallback: !!document.querySelector('.vp-flat, .vp-noweb'),
      notice: document.querySelector('.vp-failed')?.textContent ?? null,
      failed: window.__fab?.failedStations ? [...window.__fab.failedStations] : null,
      flying: window.__fab?.useStageInfo.getState().flying ?? null,
    }));
    res.errors = errors.slice(0, 5);
    await ctx.close();
    return res;
  },

  async shadows() {
    const { ctx, page, errors } = await open('/?step=softbake&virt=1');
    await page.evaluate(() => {
      const sm = window.__fab.gl.shadowMap;
      const orig = sm.render.bind(sm);
      window.__shadowPasses = 0;
      sm.render = (...a) => {
        if (sm.enabled && (sm.autoUpdate || sm.needsUpdate)) window.__shadowPasses++;
        return orig(...a);
      };
    });
    await settle(page);
    await page.evaluate(() => window.__fabStores.useClock.getState().pause());
    const count = async (n) => {
      const a = await page.evaluate(() => window.__shadowPasses);
      await adv(page, n);
      return ((await page.evaluate(() => window.__shadowPasses)) - a) / n;
    };
    const paused = await count(30);
    await page.evaluate(() => window.__fabStores.useApp.getState().next());
    const moving = await count(30);
    await settle(page);
    const playing = await count(30);
    const res = { passesPerFrame: { paused: +paused.toFixed(2), duringMove: +moving.toFixed(2), playing: +playing.toFixed(2) }, errors };
    await ctx.close();
    return res;
  },

  async 'coat-uploads'() {
    const { ctx, page, errors } = await open('/?step=coat&virt=1');
    await settle(page);
    await page.evaluate(() => window.__fabStores.useClock.getState().pause());
    await adv(page, 2);
    const u0 = await page.evaluate(() => window.__uploads);
    const t0 = Date.now();
    // sweep the coat lesson as playback would (every 1/100 of the step)
    for (let k = 0; k <= 100; k++) {
      await page.evaluate((p) => window.__fabStores.useClock.getState().set(p), k / 100);
      await adv(page, 1);
    }
    const res = { uploads: (await page.evaluate(() => window.__uploads)) - u0, frames: 101, wallMs: Date.now() - t0, errors };
    await ctx.close();
    return res;
  },

  async 'op-boundary'() {
    // real time (not the harness): the cross-section is rebuilt as operations complete; any
    // main-thread stall shows as a long task
    const { ctx, page, errors } = await open('/?step=gatestack&view=device&hooks=1', { realTime: true });
    await page.waitForFunction(() => window.__fab.useStageInfo.getState().space === 'device' && window.__fab.useStageInfo.getState().shown !== false, undefined, { timeout: 180_000 });
    await page.evaluate(() => window.__fabStores.useClock.getState().pause());
    await page.waitForTimeout(8000); // (let the first geometry and any prepared ones arrive)
    const plan = await page.evaluate(() => {
      window.__longtasks.length = 0;
      return true;
    });
    void plan;
    const marks = [];
    for (let k = 0; k <= 40; k++) {
      const key = await page.evaluate((p) => {
        window.__fabStores.useClock.getState().set(p);
        return window.__fabSim.learnStateKey();
      }, k / 40);
      await page.waitForTimeout(400);
      marks.push(key);
    }
    const boundaries = marks.filter((m, i) => i && m !== marks[i - 1]).length;
    const lt = await page.evaluate(() => window.__longtasks.slice());
    const res = { boundaries, longTasks: lt.length, longTaskMs: Math.round(lt.reduce((a, e) => a + e.ms, 0)), maxLongTaskMs: Math.round(Math.max(0, ...lt.map((e) => e.ms))), meshes: await page.evaluate(() => window.__fab.deviceMeshes?.stats ?? null), errors };
    await ctx.close();
    return res;
  },

  async 'decor-virt'() {
    const { ctx, page, errors } = await open('/?virt=1');
    await adv(page, 5);
    // every small instanced set in the bay (the overhead vehicles are one); the one that moves
    const pos = () =>
      page.evaluate(() => {
        const out = [];
        const m = new window.__fab.THREE.Matrix4();
        window.__fab.scene.traverse((o) => {
          if (!o.isInstancedMesh || o.count > 64) return;
          o.getMatrixAt(0, m);
          out.push([m.elements[12], m.elements[13], m.elements[14]]);
        });
        return out;
      });
    const series = [];
    let p = await pos();
    for (let k = 0; k < 20; k++) {
      await adv(page, 1);
      const q = await pos();
      series.push(q.map((v, i) => (p[i] ? dist(p[i], v) : 0)));
      p = q;
    }
    const moving = series[0].map((_, i) => series.map((s) => s[i])).filter((xs) => Math.max(...xs) > 1e-4);
    const steps = moving[0] ?? [0];
    const res = { metresPerFrame: { median: +median(steps).toFixed(4), max: +Math.max(...steps).toFixed(4) }, expected: +(0.85 / 30).toFixed(4), movingSets: moving.length, errors };
    await ctx.close();
    return res;
  },
};

run.pairs = async () => {
  const out = {};
  for (const [step, machine] of PAIRS) {
    const { ctx, page, errors } = await open(`/?step=${step}&virt=1`);
    await settle(page);
    await page.evaluate(() => {
      const c = window.__fabStores.useClock.getState();
      c.set(1);
      c.pause();
    });
    await adv(page, 3);
    const before = await record(page, 2);
    await page.evaluate(() => window.__fabStores.useApp.getState().next());
    const after = await record(page, 24, before.last);
    // and the opening of the next lesson, played (after the camera has settled: frames in
    // between are not recorded, so the two stretches are measured separately)
    await settle(page);
    await page.evaluate(() => window.__fabStores.useClock.getState().play());
    const opening = await record(page, 30);
    let jump = { m: 0, at: -1 };
    let gaps = 0;
    const stretches = [[...before.frames, ...after.frames], opening.frames];
    stretches.forEach((fr, si) => {
      for (let k = 1; k < fr.length; k++) {
        const a = fr[k - 1].wafers.find((x) => x.st === machine);
        const b = fr[k].wafers.find((x) => x.st === machine);
        if (a && b) {
          const d = dist(a.pos, b.pos);
          if (d > jump.m) jump = { m: d, at: si === 0 ? k : `opening ${k}` };
        } else if (a || b) gaps++;
      }
    });
    const s1 = spikes(stretches[0], before.frames.length);
    const s2 = spikes(opening.frames, 1);
    const spike = s2.ratio > s1.ratio ? { ...s2, at: `opening ${s2.at}` } : s1;
    const all = [...stretches[0], ...stretches[1]];
    out[step] = { machine, maxWaferStepPerFrame: +jump.m.toFixed(4), maxStepAt: jump.at, framesWaferAppearsOrVanishes: gaps, spike, blankFrames: all.filter((f) => f.detail < BLANK).length, leastDetail: Math.min(...all.map((f) => f.detail)), errors: errors.slice(0, 3) };
    console.log('  pair', step, JSON.stringify(out[step]));
    await ctx.close();
  }
  return out;
};

/** Lesson windows in which the camera frames (or moves to or from) a wafer the machine is moving. */
const ANCHOR_WINDOWS = [
  ['contact-align', 0.04, 0.34], // the stage visits the alignment marks
  ['contact-print', 0.04, 0.34], // the stage steps and scans the fields
  ['contact-fill', 0.42, 0.6], // the load cup flips the wafer face-down for the head
  ['contact-fill', 0.73, 0.97], // ... and face-up again
  ['metal1', 0.83, 0.99],
  ['sti-etch', 0.55, 0.72], // the robot sets the wafer on the chuck
  ['peb', 0.08, 0.3], // the wafer is lowered onto the hot plate
];

run.anchors = async () => {
  const out = {};
  for (const [step, a, b] of ANCHOR_WINDOWS) {
    const { ctx, page, errors } = await open(`/?step=${step}&virt=1`);
    await settle(page);
    await page.evaluate((a) => {
      const c = window.__fabStores.useClock.getState();
      c.set(a);
      c.play();
    }, a);
    await adv(page, 3);
    const frames = [];
    for (let k = 0; k < 400; k++) {
      const f = await page.evaluate(() => {
        window.__fabAdvance(1);
        const x = window.__fab;
        const p = window.__fabStores.useClock.getState().progress;
        // the world-side view the director drew (during a cross-fade to the layers, the side
        // still showing the machine); the camera object itself holds whichever view was drawn last
        const l = x.directorView.live;
        const side = l.a.space === 'world' ? l.a : l.mix > 0 && l.b.space === 'world' ? l.b : null;
        if (!side) return { p, space: 'device' };
        const d = side.target.clone().sub(side.pos).normalize();
        return { p, pos: side.pos.toArray(), dir: d.toArray(), space: 'world' };
      });
      frames.push(f);
      if (f.p >= b) break;
    }
    // per frame: how far the camera moved, how far it turned; and how often it reversed
    let move = 0;
    let turn = 0;
    let reversals = 0;
    let worstAt = null;
    const world = frames.filter((f) => f.space === 'world');
    const w = (k) => frames[k].space === 'world';
    for (let k = 1; k < frames.length; k++) {
      if (!w(k) || !w(k - 1)) continue;
      const a = frames[k - 1];
      const c = frames[k];
      const m = dist(a.pos, c.pos);
      const cos = a.dir[0] * c.dir[0] + a.dir[1] * c.dir[1] + a.dir[2] * c.dir[2];
      const t = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      if (t > turn) worstAt = +c.p.toFixed(3);
      move = Math.max(move, m);
      turn = Math.max(turn, t);
      if (k >= 2 && w(k - 2)) {
        const v0 = a.pos.map((v, i) => v - frames[k - 2].pos[i]);
        const v1 = c.pos.map((v, i) => v - a.pos[i]);
        const n0 = Math.hypot(...v0);
        const n1 = Math.hypot(...v1);
        // the camera reversing its motion from one frame to the next (shaking)
        if (n0 > 0.002 && n1 > 0.002 && (v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2]) / (n0 * n1) < 0) reversals++;
      }
    }
    const key = `${step}@${a}-${b}`;
    out[key] = { frames: frames.length, worldFrames: world.length, maxMoveMetresPerFrame: +move.toFixed(4), maxTurnDegPerFrame: +turn.toFixed(2), worstTurnAtP: worstAt, reversals, errors: errors.slice(0, 3) };
    console.log('  anchors', key, JSON.stringify(out[key]));
    await ctx.close();
  }
  return out;
};

run.transitions = async () => {
  const out = {};
  const { ctx, page, errors } = await open('/?step=arrive&virt=1');
  await settle(page);
  const total = STEP_IDS.length;
  for (let i = 0; i < total - 1; i++) {
    await page.evaluate(() => {
      const c = window.__fabStores.useClock.getState();
      c.set(1);
      c.pause();
    });
    await adv(page, 2);
    const before = await record(page, 2);
    const from = await page.evaluate(() => window.__fabStores.useApp.getState().step);
    const owner0 = await page.evaluate(() => window.__fab.handover?.owner ?? null);
    await page.evaluate(() => window.__fabStores.useApp.getState().next());
    const frames = [...before.frames];
    let last = before.last;
    let handAt = null;
    for (let k = 0; k < 240; k++) {
      const r = await record(page, 1, last);
      last = r.last;
      const f = r.frames[0];
      f.owner = await page.evaluate(() => window.__fab.handover?.owner ?? null);
      if (handAt === null && f.owner !== owner0) handAt = k;
      frames.push(f);
      if (k > 8 && !f.flying) break;
    }
    const moved = frames.slice(2);
    // the learner's wafer, per machine showing it: the largest move between two frames
    let step = { m: 0, st: null };
    for (let k = 1; k < frames.length; k++)
      for (const w of frames[k].wafers) {
        const a = frames[k - 1].wafers.find((x) => x.st === w.st);
        if (a) {
          const d = dist(a.pos, w.pos);
          if (d > step.m) step = { m: d, st: w.st };
        }
      }
    const id = await page.evaluate((i) => window.__fabStores.useApp.getState().step, i);
    const key = `${STEP_IDS[from]}>${STEP_IDS[id]}`;
    out[key] = {
      frames: moved.length,
      spike: spikes(frames, 2),
      maxWafersOnScreen: Math.max(...moved.map((f) => f.wafersOnScreen)),
      framesWithTwoWafers: moved.filter((f) => f.wafersOnScreen > 1).length,
      maxWaferStepPerFrame: +step.m.toFixed(4),
      stepAt: step.st,
      handOverFrame: handAt,
      blankFrames: moved.filter((f) => f.detail < BLANK).length,
      leastDetail: Math.min(...moved.map((f) => f.detail)),
    };
    console.log('  transition', key, JSON.stringify(out[key]));
    await settle(page);
  }
  out.errors = errors.slice(0, 5);
  await ctx.close();
  return out;
};

for (const name of cases) {
  if (!run[name]) continue;
  const t0 = Date.now();
  try {
    report.cases[name] = await run[name]();
  } catch (e) {
    report.cases[name] = { error: String(e?.message ?? e).slice(0, 400) };
  }
  report.cases[name].seconds = Math.round((Date.now() - t0) / 1000);
  console.log(name, JSON.stringify(report.cases[name]).slice(0, 600));
  writeFileSync(out, JSON.stringify(report, null, 1));
}
await browser.close();
console.log('wrote', out);
