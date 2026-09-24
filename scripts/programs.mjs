// Which shader programs are compiled around lesson changes, and what waits for them (real time).
//   node scripts/programs.mjs [baseUrl] [--step arrive] [--next 2] [--gpu]
// Opens a lesson (production build, `?hooks=1`), lets it settle, then presses Continue --next
// times (holding 8 s after each move). Logs every program link and every call that blocked the
// page for over 15 ms (a program's first use waits for its compile), with the program's cache
// key (material type … custom key) and the call stack of the link, the long tasks, and when each
// machine was ready and the camera moving. A program linked during a move and used at once is a
// compile in the middle of that move.
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const base = args[0] && !args[0].startsWith('--') ? args[0] : 'http://127.0.0.1:4173';
const step = opt('--step', 'arrive');
const nexts = Number(opt('--next', '1'));
const gpu = args.includes('--gpu');

const browser = await chromium.launch({
  args: gpu ? ['--ignore-gpu-blocklist', '--enable-webgl'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  Error.stackTraceLimit = 40;
  const log = (window.__gllog = []);
  const P = WebGL2RenderingContext.prototype;
  const link = P.linkProgram;
  let n = 0;
  const where = () =>
    new Error().stack
      .split('\n')
      .slice(3, 14)
      .map((l) => l.trim().replace(/^at /, '').replace(/\(?https?:[^)]*\/assets\//, '(').slice(0, 60))
      .join(' < ');
  P.linkProgram = function (p) {
    p.__id = ++n;
    log.push({ t: performance.now(), ev: 'link', id: p.__id, where: where() });
    return link.call(this, p);
  };
  for (const name of ['getProgramInfoLog', 'getShaderInfoLog', 'getProgramParameter', 'getUniformLocation', 'getError', 'readPixels', 'texImage2D', 'texSubImage2D', 'bufferData', 'clientWaitSync', 'finish']) {
    const f = P[name];
    P[name] = function (...a) {
      const t = performance.now();
      const r = f.apply(this, a);
      const ms = performance.now() - t;
      if (ms > 15) log.push({ t, ev: name === 'getProgramInfoLog' ? 'first use' : name, id: a[0] && a[0].__id, ms: +ms.toFixed(1) });
      return r;
    };
  }
  window.__longtasks = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longtasks.push({ t: e.startTime, ms: e.duration }))).observe({ type: 'longtask', buffered: true });
});
const page = await ctx.newPage();
await page.goto(`${base}/?step=${step}&hooks=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__fab?.stationBoxes?.size, null, { timeout: 180_000 });
const settled = () =>
  page.waitForFunction(
    () => {
      const s = window.__fab.useStageInfo.getState();
      const c = window.__fabStores?.useClock?.getState?.();
      return !s.flying && !(c && c.pendingPlay);
    },
    null,
    { timeout: 180_000, polling: 50 },
  );
await settled();
await page.waitForTimeout(8000);
const t0 = await page.evaluate(() => {
  window.__states = [];
  let last = '';
  setInterval(() => {
    const f = window.__fab;
    const r = `ready ${[...f.readyStations].sort().join(',')} · ${f.useStageInfo.getState().flying ? 'moving' : 'still'}`;
    if (r !== last) window.__states.push({ t: performance.now(), r });
    last = r;
  }, 100);
  return performance.now();
});
const presses = [];
for (let k = 0; k < nexts; k++) {
  presses.push(Math.round((await page.evaluate(() => performance.now())) - t0));
  await page.getByRole('button', { name: 'Continue', exact: true }).first().click();
  await page.waitForTimeout(200);
  await settled();
  await page.waitForTimeout(8000);
}
const r = await page.evaluate(() => ({
  log: window.__gllog,
  lt: window.__longtasks,
  states: window.__states,
  programs: window.__fab.gl.info.programs.map((p) => ({ id: p.program.__id, key: p.cacheKey })),
}));
const rel = (t) => Math.round(t - t0);
const keyOf = new Map(r.programs.map((p) => [p.id, (({ key }) => { const k = key.split(','); return `${k.slice(0, 3).join(',')} … ${k.slice(-1)[0].slice(0, 40)}`; })(p)]));
console.log(`${step}: Continue pressed at ${presses.join(', ')} ms; programs linked before: ${r.log.filter((e) => e.ev === 'link' && e.t <= t0).length}, in all: ${r.programs.length}`);
console.log('long tasks since:', r.lt.filter((l) => l.t > t0).map((l) => `${rel(l.t)} ms (${Math.round(l.ms)} ms)`).join(', ') || 'none');
console.log('machines and camera:\n  ' + r.states.map((s) => `${rel(s.t)}: ${s.r}`).join('\n  '));
console.log('links and blocking calls (ms):');
for (const e of r.log.filter((x) => x.t > t0))
  console.log(`  ${rel(e.t)} ${e.ev} #${e.id ?? ''}${e.ms ? ' ' + e.ms + ' ms' : ''}${e.ev === 'link' ? ' ' + (keyOf.get(e.id) ?? '(released)') + '\n      ' + e.where : ''}`);
await browser.close();
