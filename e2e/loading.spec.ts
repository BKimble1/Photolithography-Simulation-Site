import { expect, test, type Page } from '@playwright/test';
import { advance, sampleFrame, sampleFrames, settle, waitForStage, watchErrors, worstJump } from './helpers';

/**
 * Loading (round three): the camera never flies into a machine that is not there. It waits
 * however long the model takes, says what it is waiting for, and shows a model that failed
 * to load from outside, with a notice. The first picture is revealed only once its machine is
 * ready. The track's module is held back (or refused) at the network to make this happen, from
 * its first request: the next lesson's machine is loaded while the current lesson plays, so the
 * track is asked for as soon as the deposition lesson opens.
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

/**
 * A fresh learner at `path` with the track's module held at the network until the returned
 * function is called (or refused outright).
 */
async function openHeld(page: Page, path: string, refuse = false): Promise<() => void> {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  let release = () => {};
  const released = new Promise<void>((r) => (release = r));
  await page.route(TRACK_MODULE, async (r) => {
    if (refuse) return r.abort();
    await released;
    await r.continue();
  });
  await page.goto(path);
  return release;
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
  const release = await openHeld(page, '/?step=gatestack&virt=1');
  await settle(page);
  expect((await info(page)).trackReady, 'the track is still loading').toBe(false);
  await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().next());
  const waiting = await stepFor(page, 8000);
  // far longer than the old three-second allowance: still waiting, still at the deposition tool
  expect(waiting.every((s) => s.flying && !s.trackReady), 'waits while the model is missing').toBe(true);
  expect(waiting.at(-1)!.loading).toBe('track');
  await expect(page.locator('.vp-loading')).toContainText('Loading the coater/developer track');
  const far = waiting.at(-1)!.toTrack;
  expect(far, 'the camera has not left for the track').toBeGreaterThan(4);
  // the module arrives: the camera goes, and arrives at a loaded machine
  release();
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
  const release = await openHeld(page, '/?step=gatestack&virt=1');
  await settle(page);
  await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().next());
  await stepFor(page, 2500);
  // back to the deposition lesson before the track has loaded
  await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().prev());
  const frames = await sampleFrames(page, 30);
  // the track arriving now does not take the camera there
  release();
  await stepFor(page, 3000);
  await settle(page);
  const end = await info(page);
  expect(end.step).toBe(10);
  expect(end.loading).toBeNull();
  expect(end.toTrack, 'still at the deposition tool').toBeGreaterThan(4);
  expect(worstJump(frames, 1).ratio).toBeLessThan(4);
  expect(errors).toEqual([]);
});

test('a machine that fails to load is shown from outside, with a notice; the stage keeps working', async ({ page }, ti) => {
  test.skip(ti.project.name !== 'desktop', 'once');
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  await openHeld(page, '/?step=gatestack&virt=1', true);
  await settle(page);
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
  // the refused request and the module it breaks are reported by the browser (and by the
  // renderer, which reports errors its error boundaries catch); nothing else may fail
  expect(errors.filter((e) => !/Track-|dynamically imported module|net::ERR_FAILED/i.test(e))).toEqual([]);
});

test('the first picture is revealed only when its machine is ready', async ({ page }, ti) => {
  test.skip(ti.project.name !== 'desktop', 'once');
  test.setTimeout(600_000);
  const release = await openHeld(page, '/?step=coat&virt=1');
  await waitForStage(page);
  await advance(page, 10);
  await expect(page.locator('.vp-veil')).toBeVisible();
  const held = await stepFor(page, 4000);
  expect(held.every((s) => !s.shown && !s.trackReady), 'veiled while its machine loads').toBe(true);
  await expect(page.locator('.vp-veil')).toBeVisible();
  release();
  await stepFor(page, 5000);
  await settle(page, 600);
  expect((await info(page)).shown).toBe(true);
  await expect(page.locator('.vp-veil')).toHaveCount(0);
});
