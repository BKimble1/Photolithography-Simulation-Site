import { expect, test, type Page } from '@playwright/test';
import { advance, sampleFrame, sampleFrames, watchErrors, worstJump, pictureChange } from './helpers';

/**
 * Watch, frame by frame (round three): the silent moves between segments are planned once and
 * reused (and planned again when the viewport changes); a seek shows exactly the frame that
 * playing would; chapter jumps land on a loaded, consistent scene; the learner's wafer is
 * never on screen twice.
 */

type FW = {
  __fabFilm: {
    filmPlayer: () => { tl: { segments: { start: number; dur: number; gapAfter: number; station: string | null }[]; chapters: { start: number }[] } } | null;
    filmControls: { seek: (t: number) => void; play: () => void; pause: () => void };
  };
  __fab: { gapStats: { planned: number; reused: number }; readyStations: Set<string> };
};

async function openFilm(page: Page, t: number) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`/?watch&t=${t}&virt=1`);
  // the film's player and the stage's harness hooks (the canvas mounts its scene asynchronously)
  await page.waitForFunction(
    () => {
      const w = window as unknown as FW & { __fabAdvance?: unknown; __fab?: { gl?: unknown } };
      return !!w.__fabFilm?.filmPlayer() && !!w.__fabAdvance && !!w.__fab?.gl;
    },
    undefined,
    { timeout: 120_000 },
  );
  await advance(page, 10);
  await untilLive(page);
}

/**
 * Render frames until the film shows a live picture again: after a seek to a machine that is
 * not loaded yet the director holds the last picture, and its modules arrive in real time,
 * so frames are rendered as they come until the machine the film is at is ready.
 */
async function untilLive(page: Page) {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __fabAdvance: (n: number) => void; __fab: { readyStations: Set<string>; stageFocus: { station: string | null }; useStageInfo: { getState: () => { flying: boolean } } } };
      w.__fabAdvance(1);
      const st = w.__fab.stageFocus.station;
      return !w.__fab.useStageInfo.getState().flying && (!st || w.__fab.readyStations.has(st));
    },
    undefined,
    { polling: 100, timeout: 180_000 },
  );
}

const segments = (page: Page) => page.evaluate(() => (window as unknown as FW).__fabFilm.filmPlayer()!.tl.segments.map((s) => ({ start: s.start, dur: s.dur, gap: s.gapAfter, station: s.station })));

test('a gap move is planned once and reused; a new viewport plans it again', async ({ page }, ti) => {
  test.skip(ti.project.name !== 'desktop', 'once');
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  await openFilm(page, 0);
  const segs = await segments(page);
  const i = segs.findIndex((s, k) => k > 3 && segs[k + 1] && s.station && segs[k + 1].station && s.station !== segs[k + 1].station);
  await page.evaluate((t) => {
    const f = (window as unknown as FW).__fabFilm;
    f.filmControls.seek(t);
    f.filmControls.pause();
  }, segs[i].start + segs[i].dur + 0.2);
  // (the machines at both ends load first: the move is planned with both in place)
  await advance(page, 20);
  await untilLive(page);
  const a = await page.evaluate(() => ({ ...(window as unknown as FW).__fab.gapStats }));
  await page.evaluate(() => (window as unknown as FW).__fabFilm.filmControls.play());
  await advance(page, 40);
  const b = await page.evaluate(() => ({ ...(window as unknown as FW).__fab.gapStats }));
  expect(b.planned - a.planned, 'no new plans while crossing the same gap').toBe(0);
  expect(b.reused - a.reused, 'the plan is reused every frame').toBeGreaterThanOrEqual(30);
  // a different viewport: the move is planned again for it (once the stage has the new size:
  // between harness frames the browser may not have laid the page out again yet)
  type Cam = { __fab: { camera: { aspect: number }; gl: { domElement: HTMLCanvasElement } } };
  const aspect0 = await page.evaluate(() => (window as unknown as Cam).__fab.camera.aspect);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForFunction((a0) => {
    const f = (window as unknown as Cam).__fab;
    const c = f.gl.domElement;
    return Math.abs(f.camera.aspect - a0) > 1e-3 && Math.abs(f.camera.aspect - c.clientWidth / c.clientHeight) < 1e-3;
  }, aspect0);
  await page.evaluate((t) => (window as unknown as FW).__fabFilm.filmControls.seek(t), segs[i].start + segs[i].dur + 0.4);
  await advance(page, 6);
  const c = await page.evaluate(() => ({ ...(window as unknown as FW).__fab.gapStats }));
  expect(c.planned - b.planned).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('a seek shows exactly the frame that playing would, and the moves are continuous', async ({ page }, ti) => {
  test.skip(ti.project.name !== 'desktop', 'once');
  test.setTimeout(900_000);
  const errors = watchErrors(page);
  await openFilm(page, 0);
  const segs = await segments(page);
  const i = segs.findIndex((s, k) => k > 5 && segs[k + 1] && s.station !== segs[k + 1].station);
  const gapStart = segs[i].start + segs[i].dur;
  // play from just before the move, through it (once the picture is live again after the seek,
  // with the machines of the move loaded, as when the film plays into it)
  await page.evaluate((t) => (window as unknown as FW).__fabFilm.filmControls.seek(t), gapStart - 1);
  await untilLive(page);
  await page.evaluate(() => (window as unknown as FW).__fabFilm.filmControls.play());
  await advance(page, 20);
  const played = await sampleFrames(page, 60);
  for (const f of played) expect(f.wafers.filter((w) => w.onScreen).length, 'one learner wafer on screen at most').toBeLessThanOrEqual(1);
  expect(worstJump(played, 1).ratio, 'the move is continuous').toBeLessThan(4);
  // the time of the 40th played frame (each frame advances the film by 1/30 s), reached by a
  // seek instead: paused there, the frame shows that time
  const t40 = gapStart - 1 + (20 + 40) / 30;
  await page.evaluate((t) => {
    const f = (window as unknown as FW).__fabFilm;
    f.filmControls.pause();
    f.filmControls.seek(t);
  }, t40);
  await advance(page, 1);
  const sought = await sampleFrame(page);
  expect(pictureChange(sought, played[39]), 'the sought frame matches the played one').toBeLessThan(1.5);
  expect(errors).toEqual([]);
});

test('chapter jumps land on a loaded, consistent scene', async ({ page }, ti) => {
  test.skip(ti.project.name !== 'desktop', 'once');
  test.setTimeout(900_000);
  const errors = watchErrors(page);
  await openFilm(page, 0);
  const chapters = await page.evaluate(() => (window as unknown as FW).__fabFilm.filmPlayer()!.tl.chapters.map((c) => c.start));
  for (const t of [chapters[3], chapters[1], chapters[chapters.length - 2]]) {
    await page.evaluate((x) => (window as unknown as FW).__fabFilm.filmControls.seek(x + 2), t);
    // until the machines the new place needs are ready, the last picture is held; then it
    // dissolves into the live scene
    const held = await sampleFrames(page, 3);
    await untilLive(page);
    const f = [...held, ...(await sampleFrames(page, 16))];
    for (const s of f) expect(s.wafers.filter((w) => w.onScreen).length).toBeLessThanOrEqual(1);
    expect(worstJump(f, 1).ratio).toBeLessThan(4);
  }
  expect(errors).toEqual([]);
});
