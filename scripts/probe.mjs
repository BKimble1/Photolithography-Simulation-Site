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
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [, , base = 'http://127.0.0.1:4173', out = 'probe.json', ...rest] = process.argv;
const opt = (k) => {
  const i = rest.indexOf(k);
  return i >= 0 ? rest[i + 1] : undefined;
};
const ALL = ['leave-partial', 'back-same', 'next-same', 'interrupt', 'film-gap', 'slow-load', 'load-fail', 'shadows', 'coat-uploads', 'op-boundary', 'decor-virt', 'pairs'];
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

async function open(path, { route } = {}) {
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
  await page.waitForFunction(() => !!window.__fab && window.__fab.stationBoxes.size > 0 && !!window.__fabAdvance, undefined, { timeout: 180_000 });
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
    frames.push({ change: prev ? +change(prev, g).toFixed(3) : 0, wafersOnScreen: wf.filter((x) => x.onScreen).length, wafers: wf, ...i });
    prev = g;
  }
  return { frames, last: prev };
}

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
    const delay = 15_000;
    const { ctx, page, errors } = await open('/?step=gatestack&virt=1', {
      route: (page) =>
        page.route(/\/(assets\/Track-[^/]*\.js|src\/three\/tools\/Track\.tsx)/, async (r) => {
          await new Promise((res) => setTimeout(res, delay));
          await r.continue();
        }),
    });
    await settle(page);
    await page.evaluate(() => window.__fabStores.useApp.getState().next());
    const t0 = Date.now();
    const samples = [];
    while (Date.now() - t0 < delay + 8000) {
      await adv(page, 3);
      const i = await info(page);
      const trackShown = await page.evaluate(() => {
        const g = window.__fab.stationGroups.get('track');
        return !!g && g.visible;
      });
      samples.push({ t: Date.now() - t0, ...i, trackReady: i.ready.includes('track'), trackShown });
      await new Promise((r) => setTimeout(r, 100));
    }
    const arrived = samples.find((s) => !s.flying);
    const res = {
      delayMs: delay,
      // the camera finished its move while the machine was still missing
      settledBeforeReady: samples.some((s) => !s.flying && !s.trackReady),
      firstSettled: arrived ? { t: arrived.t, trackReady: arrived.trackReady, cam: arrived.cam } : null,
      loadingShown: samples.some((s) => s.loading === 'track'),
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
    const { ctx, page, errors } = await open('/?step=gatestack&view=device&virt=1');
    await settle(page);
    await page.evaluate(() => window.__fabStores.useClock.getState().pause());
    await adv(page, 3);
    const times = [];
    for (let k = 0; k <= 60; k++) {
      const r = await page.evaluate((p) => {
        window.__fabStores.useClock.getState().set(p);
        const t = performance.now();
        window.__fabAdvance(1);
        return { ms: performance.now() - t, key: window.__fabSim.learnStateKey() };
      }, k / 60);
      times.push(r);
    }
    const boundary = [];
    const plain = [];
    for (let k = 1; k < times.length; k++) (times[k].key !== times[k - 1].key ? boundary : plain).push(times[k].ms);
    const res = { boundaries: boundary.length, boundaryFrameMs: { median: +median(boundary).toFixed(1), max: +Math.max(0, ...boundary).toFixed(1) }, plainFrameMs: { median: +median(plain).toFixed(1), max: +Math.max(0, ...plain).toFixed(1) }, errors };
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
    // and the opening of the next lesson, played
    await settle(page);
    await page.evaluate(() => window.__fabStores.useClock.getState().play());
    const opening = await record(page, 30, after.last);
    const all = [...before.frames, ...after.frames, ...opening.frames];
    let jump = 0;
    let gaps = 0;
    for (let k = 1; k < all.length; k++) {
      const a = all[k - 1].wafers.find((x) => x.st === machine);
      const b = all[k].wafers.find((x) => x.st === machine);
      if (a && b) jump = Math.max(jump, dist(a.pos, b.pos));
      else if (a || b) gaps++;
    }
    out[step] = { machine, maxWaferStepPerFrame: +jump.toFixed(4), framesWaferAppearsOrVanishes: gaps, spike: spikes(all, before.frames.length), errors: errors.slice(0, 3) };
    console.log('  pair', step, JSON.stringify(out[step]));
    await ctx.close();
  }
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
