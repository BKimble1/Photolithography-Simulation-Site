import { expect, test, type Page } from '@playwright/test';
import { advance, freshStart, maxWaferStep, sampleFrame, sampleFrames, settle, waitForStage, watchErrors, worstJump, type FrameSample } from './helpers';

/**
 * Continuity, frame by frame (round three): every frame the viewer would see is rendered on
 * the harness clock and examined — the picture, the camera and where the learner's wafer is.
 * A jump is a frame that changes far more than the frames around it; the learner's wafer must
 * never be on screen twice, and never teleport.
 */

type W = {
  __fabStores: {
    useApp: { getState: () => { next: () => void; prev: () => void; setScaleOverride: (v: string | null) => void; navigate: (t: unknown) => void; step: number } };
    useClock: { getState: () => { set: (p: number) => void; play: () => void; pause: () => void; progress: number } };
  };
  __fab: {
    frozen: Map<string, { pres: { choices: { dose: number }; progress: { get: () => number }; frozen?: boolean } }>;
    gl: { info: { memory: { geometries: number; textures: number }; programs?: unknown[] } };
    useStageInfo: { getState: () => { space: string; flying: boolean } };
  };
};

const onlyDesktop = (name: string) => test.skip(name !== 'desktop', 'frame-by-frame checks run once, at desktop size');

const finite = (f: FrameSample) => [...f.cam, ...f.target, f.fov].every(Number.isFinite);

test('leaving a lesson half-way keeps the machine left behind exactly as it was', async ({ page }, info) => {
  onlyDesktop(info.project.name);
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  // a non-default dose, half-way through the exposure
  await freshStart(page, '/?step=expose&dose=3&virt=1');
  await settle(page);
  await page.evaluate(() => {
    const c = (window as unknown as W).__fabStores.useClock.getState();
    c.set(0.45);
    c.play();
  });
  await advance(page, 3);
  const before = await sampleFrames(page, 3);
  const scannerWafer = before[2].wafers.find((w) => w.station === 'scanner');
  expect(scannerWafer, 'the wafer is in the scanner').toBeTruthy();
  await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().next());
  const after = await sampleFrames(page, 75);
  // the scanner holds its real last frame: same run (dose), same progress, same wafer place
  const frozen = await page.evaluate(() => {
    const f = (window as unknown as W).__fab.frozen.get('scanner');
    return f ? { dose: f.pres.choices.dose, p: f.pres.progress.get(), frozen: !!f.pres.frozen } : null;
  });
  expect(frozen, 'the scanner is held on its last frame').toMatchObject({ dose: 3, frozen: true });
  expect(frozen!.p).toBeGreaterThan(0.44);
  expect(frozen!.p).toBeLessThan(0.5);
  // the wafer stays in the scanner, where it was, as the move begins (it changes hands in the aisle)
  for (const f of after.slice(0, 10)) expect(f.wafers.some((w) => w.station === 'scanner'), 'the scanner still holds the wafer').toBe(true);
  for (const f of after) {
    const w = f.wafers.find((x) => x.station === 'scanner');
    if (w) expect(Math.hypot(w.pos[0] - scannerWafer!.pos[0], w.pos[1] - scannerWafer!.pos[1], w.pos[2] - scannerWafer!.pos[2]), 'the wafer left behind does not move').toBeLessThan(1e-4);
    expect(f.wafers.filter((x) => x.onScreen).length, 'one learner wafer on screen at most').toBeLessThanOrEqual(1);
    expect(finite(f)).toBe(true);
  }
  const all = [...before, ...after];
  expect(worstJump(all, 3).ratio, 'no one-frame jump').toBeLessThan(4);
  expect(errors).toEqual([]);
});

/** Toggle the scale override and sample frames; returns the frames around the toggle. */
async function toggleAfter(page: Page, first: string, at: number, second: string) {
  await page.evaluate((v) => (window as unknown as W).__fabStores.useApp.getState().setScaleOverride(v), first);
  const pre = await sampleFrames(page, at);
  await page.evaluate((v) => (window as unknown as W).__fabStores.useApp.getState().setScaleOverride(v), second);
  const post = await sampleFrames(page, 16);
  return { pre, post };
}

test('reversing the cross-section fade at any point never jumps; the latest request wins', async ({ page }, info) => {
  onlyDesktop(info.project.name);
  test.setTimeout(900_000);
  const errors = watchErrors(page);
  await freshStart(page, '/?step=gate-etch&p=0.5&virt=1');
  await settle(page);
  // out of the cross-section, reversed early, mid and late in the fade; then in, reversed
  for (const [first, at, second] of [
    ['tool', 8, 'device'],
    ['tool', 14, 'device'],
    ['tool', 20, 'device'],
    ['device', 30, 'tool'],
    ['device', 40, 'tool'],
    ['device', 50, 'tool'],
  ] as const) {
    const start = (await page.evaluate(() => (window as unknown as W).__fab.useStageInfo.getState().space)) as string;
    const from = first === 'tool' ? 'device' : 'world';
    if (start !== from) {
      await page.evaluate((v) => (window as unknown as W).__fabStores.useApp.getState().setScaleOverride(v), first === 'tool' ? 'device' : 'tool');
      await settle(page);
    }
    const { pre, post } = await toggleAfter(page, first, at, second);
    const all = [...pre, ...post];
    for (const f of all) expect(finite(f), 'finite camera').toBe(true);
    const j = worstJump(all, pre.length - 2);
    expect(j.ratio, `reversed ${at} frames into "${first}": worst one-frame change ${j.change.toFixed(2)} at ${j.at}`).toBeLessThan(4);
    await settle(page);
    expect((await sampleFrame(page)).space, 'ends where the last request pointed').toBe(second === 'device' ? 'device' : 'world');
  }
  // rapid toggling: five requests five frames apart; the last one wins
  const seq = ['device', 'tool', 'device', 'tool', 'device'];
  const frames: FrameSample[] = [];
  for (const v of seq) {
    await page.evaluate((x) => (window as unknown as W).__fabStores.useApp.getState().setScaleOverride(x), v);
    frames.push(...(await sampleFrames(page, 5)));
  }
  expect(worstJump(frames, 1).ratio, 'rapid reversals stay continuous').toBeLessThan(4);
  await settle(page);
  expect((await sampleFrame(page)).space).toBe('device');
  expect(errors).toEqual([]);
});

test('the track carries the wafer from module to module (no teleporting)', async ({ page }, info) => {
  onlyDesktop(info.project.name);
  test.setTimeout(900_000);
  const errors = watchErrors(page);
  await freshStart(page, '/?step=prime&virt=1');
  await settle(page);
  for (const step of ['prime', 'coat']) {
    // finish the lesson, go on to the next one at the same machine, and play its opening
    await page.evaluate(() => (window as unknown as W).__fabStores.useClock.getState().set(1));
    await advance(page, 2);
    const end = await sampleFrames(page, 2);
    await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().next());
    const move = await sampleFrames(page, 12);
    await settle(page);
    await page.evaluate(() => (window as unknown as W).__fabStores.useClock.getState().play());
    const opening = await sampleFrames(page, 75);
    // the lesson changes without a jump (same machine, the next lesson starting where this one ended)
    const change = [...end, ...move];
    expect(worstJump(change, 2).ratio, `after ${step}: no one-frame jump at the lesson change`).toBeLessThan(4);
    // then the robot carries the wafer: legitimately fast motion (the robot runs into view
    // from its park position), checked by the wafer's own path rather than by the picture
    for (const stretch of [change, opening]) {
      expect(maxWaferStep(stretch, 'track'), `after ${step}: the wafer moves, it never jumps`).toBeLessThan(0.16);
      expect(stretch.every((f) => f.wafers.filter((w) => w.station === 'track').length === 1), `after ${step}: always exactly one wafer in the track`).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});

test('going back a lesson on the same machine dissolves instead of jumping', async ({ page }, info) => {
  onlyDesktop(info.project.name);
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  await freshStart(page, '/?step=coat&spin=0.9&virt=1');
  await settle(page);
  await page.evaluate(() => {
    const c = (window as unknown as W).__fabStores.useClock.getState();
    c.set(0.5);
    c.play();
  });
  await advance(page, 3);
  const before = await sampleFrames(page, 3);
  await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().prev());
  const after = await sampleFrames(page, 40);
  const all = [...before, ...after];
  expect(worstJump(all, 3).ratio, 'no one-frame jump').toBeLessThan(4);
  for (const f of all) expect(f.wafers.filter((w) => w.onScreen).length).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('rising out of the layers to leave for another machine, your die fades in (no pop)', async ({ page }, info) => {
  onlyDesktop(info.project.name);
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  // the anneal ends in the layers; the next lesson is at the deposition tool, so the camera
  // first rises out of the cross-section onto your die in the furnace, then leaves. The fade
  // must show the wafer in the furnace (where the move has it until the hand-over in the aisle):
  // drawn at the deposition tool instead, the die close-up was empty and popped in at the end
  await freshStart(page, '/?step=anneal&virt=1');
  await settle(page);
  await page.evaluate(() => {
    const c = (window as unknown as W).__fabStores.useClock.getState();
    c.set(1);
    c.pause();
  });
  await advance(page, 3);
  const before = await sampleFrames(page, 2);
  await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().next());
  const after = await sampleFrames(page, 40);
  const all = [...before, ...after];
  expect(worstJump(all, 2).ratio, 'no one-frame jump as the die fades in').toBeLessThan(4);
  for (const f of all) expect(f.wafers.filter((w) => w.onScreen).length).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('reduced motion: moves become still cross-fades, and still nothing jumps', async ({ page }, info) => {
  onlyDesktop(info.project.name);
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await freshStart(page, '/?step=softbake&virt=1');
  await settle(page);
  const before = await sampleFrames(page, 2);
  await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().next());
  const after = await sampleFrames(page, 30);
  const all = [...before, ...after];
  // the camera never travels: each frame's camera is one of the two still compositions
  const cams = new Set(all.map((f) => f.cam.map((v) => v.toFixed(2)).join(',')));
  expect(cams.size, 'still compositions only').toBeLessThanOrEqual(3);
  expect(worstJump(all, 2).ratio).toBeLessThan(4);
  expect(errors).toEqual([]);
});

test('resizing the window during a move keeps the camera continuous and on course', async ({ page }, info) => {
  onlyDesktop(info.project.name);
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  await freshStart(page, '/?step=clean&virt=1');
  await settle(page);
  await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().next());
  const a = await sampleFrames(page, 12);
  await page.setViewportSize({ width: 1100, height: 820 });
  const b = await sampleFrames(page, 60);
  for (const f of [...a, ...b]) expect(finite(f)).toBe(true);
  await settle(page);
  const end = await sampleFrame(page);
  expect(end.flying).toBe(false);
  expect(errors).toEqual([]);
});

test('going back and forth through the lessons does not accumulate GPU resources', async ({ page }, info) => {
  onlyDesktop(info.project.name);
  test.setTimeout(1_200_000);
  const errors = watchErrors(page);
  await freshStart(page, '/?step=gatestack&virt=1');
  await settle(page);
  const counts = async () =>
    page.evaluate(() => {
      const i = (window as unknown as W).__fab.gl.info;
      return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 };
    });
  const loop = async () => {
    for (let k = 0; k < 5; k++) {
      await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().next());
      await settle(page);
    }
    for (let k = 0; k < 5; k++) {
      await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().prev());
      await settle(page);
    }
    await advance(page, 30);
    return counts();
  };
  const first = await loop();
  const second = await loop();
  expect(second.geometries, `geometries ${first.geometries} → ${second.geometries}`).toBeLessThanOrEqual(Math.ceil(first.geometries * 1.1) + 5);
  expect(second.textures, `textures ${first.textures} → ${second.textures}`).toBeLessThanOrEqual(first.textures + 4);
  expect(second.programs, `programs ${first.programs} → ${second.programs}`).toBeLessThanOrEqual(first.programs + 2);
  expect(errors).toEqual([]);
});

test('a hidden page resumes a move where it left it (real time)', async ({ page }, info) => {
  onlyDesktop(info.project.name);
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  await freshStart(page, '/?step=clean&hooks=1');
  await waitForStage(page);
  await page.waitForFunction(() => {
    const w = window as unknown as { __fab?: { useStageInfo: { getState: () => { shown?: boolean; flying: boolean } } } };
    const s = w.__fab?.useStageInfo.getState();
    return !!s && s.shown !== false && !s.flying;
  }, undefined, { timeout: 120_000 });
  const cam = () => page.evaluate(() => (window as unknown as { __fab: { camera: { position: { toArray: () => number[] } } } }).__fab.camera.position.toArray());
  const hide = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await page.evaluate(() => (window as unknown as W).__fabStores.useApp.getState().next());
  // hide the page once the move is under way
  await page.waitForFunction(() => (window as unknown as W).__fab.useStageInfo.getState().flying, undefined, { timeout: 60_000 });
  await hide(true);
  const atHide = await cam();
  // three seconds hidden: the scenario itself (frames may still be drawn while "hidden" here;
  // the stage clock does not advance)
  await page.waitForTimeout(3000);
  const whileHidden = await cam();
  await hide(false);
  const d = Math.hypot(whileHidden[0] - atHide[0], whileHidden[1] - atHide[1], whileHidden[2] - atHide[2]);
  expect(d, 'the move waits while the page is hidden').toBeLessThan(0.25);
  await page.waitForFunction(() => !(window as unknown as W).__fab.useStageInfo.getState().flying, undefined, { timeout: 120_000 });
  expect(errors).toEqual([]);
});
