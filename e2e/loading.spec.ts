import { expect, test, type Page } from '@playwright/test';
import { advance, freshStart, sampleFrame, sampleFrames, settle, watchErrors, worstJump } from './helpers';

/**
 * Loading (round three): the camera never flies into a machine that is not there. It waits
 * however long the model takes, says what it is waiting for, and shows a model that failed
 * to load from outside, with a notice. The first picture is revealed only once its machine is
 * ready. The track's module is held back (or refused) at the network to make this happen.
 */

type W = {
  __fabStores: { useApp: { getState: () => { next: () => void; prev: () => void; step: number } } };
  __fab: {
    readyStations: Set<string>;
    failedStations: Set<string>;
    stationBoxes: Map<string, { getCenter: (v: unknown) => { x: number; y: number; z: number } }>;
    camera: { position: { x: number; y: number; z: number } };
    THREE: { Vector3: new () => unknown };
    useStageInfo: { getState: () => { flying: boolean; loading: string | null; failed: string | null; shown: boolean } };
  };
};

const TRACK_MODULE = /\/(assets\/Track-[^/]*\.js|src\/three\/tools\/Track\.tsx)(\?.*)?$/;

/** Hold the track's module back for `ms`, or refuse it (ms < 0). */
async function throttleTrack(page: Page, ms: number) {
  await page.route(TRACK_MODULE, async (r) => {
    if (ms < 0) return r.abort();
    await new Promise((res) => setTimeout(res, ms));
    await r.continue();
  });
}

const info = (page: Page) =>
  page.evaluate(() => {
    const f = (window as unknown as W).__fab;
    const s = f.useStageInfo.getState();
    const c = f.stationBoxes.get('track')!.getCenter(new f.THREE.Vector3());
    const p = f.camera.position;
    return { ...s, trackReady: f.readyStations.has('track'), trackFailed: f.failedStations.has('track'), toTrack: Math.hypot(p.x - c.x, p.z - c.z), step: (window as unknown as W).__fabStores.useApp.getState().step };
  });

/** Step the harness while real time passes (a module is arriving over the network). */
async function stepFor(page: Page, ms: number, each = 6) {
  const t0 = Date.now();
  const seen: Awaited<ReturnType<typeof info>>[] = [];
  while (Date.now() - t0 < ms) {
    await advance(page, each);
    seen.push(await info(page));
    await page.waitForTimeout(150);
  }
  return seen;
}

test('the camera waits for a machine that loads late, and says what it is waiting for', async ({ page }, ti) => {
  test.skip(ti.project.name !== 'desktop', 'once');
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  await freshStart(page, '/?step=gatestack&virt=1');
  await settle(page);
  await throttleTrack(page, 12_000);
  await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().next());
  const waiting = await stepFor(page, 8000);
  // far longer than the old three-second allowance: still waiting, still at the deposition tool
  expect(waiting.every((s) => s.flying && !s.trackReady), 'waits while the model is missing').toBe(true);
  expect(waiting.at(-1)!.loading).toBe('track');
  await expect(page.locator('.vp-loading')).toContainText('Loading the coater/developer track');
  const far = waiting.at(-1)!.toTrack;
  expect(far, 'the camera has not left for the track').toBeGreaterThan(4);
  // the module arrives: the camera goes, and arrives at a loaded machine
  await stepFor(page, 7000);
  await settle(page, 600);
  const end = await info(page);
  expect(end.trackReady).toBe(true);
  expect(end.flying).toBe(false);
  expect(end.toTrack).toBeLessThan(far);
  await expect(page.locator('.vp-loading')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('changing your mind while a machine loads: the latest destination wins', async ({ page }, ti) => {
  test.skip(ti.project.name !== 'desktop', 'once');
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  await freshStart(page, '/?step=gatestack&virt=1');
  await settle(page);
  await throttleTrack(page, 10_000);
  await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().next());
  await stepFor(page, 2500);
  // back to the deposition lesson before the track has loaded
  await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().prev());
  const frames = await sampleFrames(page, 30);
  await settle(page);
  const end = await info(page);
  expect(end.step).toBe(10);
  expect(end.loading).toBeNull();
  expect(worstJump(frames, 1).ratio).toBeLessThan(4);
  expect(errors).toEqual([]);
});

test('a machine that fails to load is shown from outside, with a notice; the stage keeps working', async ({ page }, ti) => {
  test.skip(ti.project.name !== 'desktop', 'once');
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  await freshStart(page, '/?step=gatestack&virt=1');
  await settle(page);
  await throttleTrack(page, -1);
  await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().next());
  await stepFor(page, 4000);
  await settle(page, 600);
  const end = await info(page);
  expect(end.trackFailed).toBe(true);
  expect(end.failed).toBe('track');
  expect(end.flying).toBe(false);
  await expect(page.locator('.vp-failed')).toContainText('could not be loaded');
  await expect(page.locator('canvas')).toHaveCount(1);
  // the rest of the fab still works: on to the scanner
  await page.evaluate(() => {
    const a = (window as unknown as W).__fabStores.useApp.getState();
    a.next();
    a.next();
    a.next();
  });
  await settle(page, 600);
  expect((await sampleFrame(page)).flying).toBe(false);
  // the refused module is reported by the browser; nothing else may fail
  expect(errors.filter((e) => !/Track|dynamically imported module|Failed to fetch/i.test(e))).toEqual([]);
});

test('the first picture is revealed only when its machine is ready', async ({ page }, ti) => {
  test.skip(ti.project.name !== 'desktop', 'once');
  test.setTimeout(600_000);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await throttleTrack(page, 6000);
  await page.goto('/?step=coat&virt=1');
  await page.waitForFunction(() => !!(window as unknown as { __fabAdvance?: unknown }).__fabAdvance, undefined, { timeout: 120_000 });
  await advance(page, 10);
  await expect(page.locator('.vp-veil')).toBeVisible();
  expect((await info(page)).shown).toBe(false);
  await stepFor(page, 9000);
  await settle(page, 600);
  expect((await info(page)).shown).toBe(true);
  await expect(page.locator('.vp-veil')).toHaveCount(0);
});
