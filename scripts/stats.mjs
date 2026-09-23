// Renderer statistics per state: draw calls, triangles, geometries, textures, programs, the
// main-thread time to produce one frame (scene update and WebGL command submission; the GPU's
// own time is not included) and the JS heap. Uses the virtual-time harness (?virt=1).
//   node scripts/stats.mjs [baseUrl]
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const cases = [
  ['home', '?virt=1'],
  ['learn-arrive', '?step=arrive&p=0.5&virt=1'],
  ['learn-coat', '?step=coat&p=0.6&virt=1'],
  ['learn-expose', '?step=expose&p=0.5&virt=1'],
  ['learn-develop-device', '?step=develop&p=1&virt=1'],
  ['learn-gate-etch', '?step=gate-etch&p=0.5&virt=1'],
  ['learn-cmp', '?step=sti-fill&p=0.5&virt=1'],
  ['learn-final', '?step=final&p=1&virt=1'],
  ['explore-overview', '?explore&virt=1'],
  ['explore-scanner', '?explore=scanner&virt=1'],
  ['watch-expose', '?watch&t=303&virt=1'],
];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (const [name, q] of cases) {
  await page.goto(base + q, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.__fabAdvance?.(1));
    await page.waitForTimeout(150);
  }
  const r = await page.evaluate(() => {
    const f = window.__fab;
    if (!f) return null;
    const { gl } = f;
    gl.info.autoReset = false;
    gl.info.reset();
    window.__fabAdvance(1);
    const info = { calls: gl.info.render.calls, tris: gl.info.render.triangles, geos: gl.info.memory.geometries, tex: gl.info.memory.textures, programs: gl.info.programs?.length };
    gl.info.autoReset = true;
    // main-thread time per frame: the median of ten frames
    const ms = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      window.__fabAdvance(1);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    return { ...info, frameMs: +((ms[4] + ms[5]) / 2).toFixed(1), heapMB: heap };
  });
  console.log(name.padEnd(22), JSON.stringify(r));
}
await browser.close();
