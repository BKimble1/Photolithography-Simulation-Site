import { expect, test, type Page } from '@playwright/test';
import { advance, freshStart, press, watchErrors } from './helpers';

type FilmWin = {
  __fabFilm: {
    filmPlayer: () => { t: number; tl: { duration: number; segments: { start: number; dur: number }[]; chapters: { start: number }[] } } | null;
    useFilm: { getState: () => { status: string; t: number; cue: string | null; audioOk: boolean; seg: number } };
    filmControls: { seek: (t: number) => void; rate: (r: number) => void; muted: (m: boolean) => void; pause: () => void; play: () => void };
  };
};

const film = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as FilmWin;
    const f = w.__fabFilm.useFilm.getState();
    const p = w.__fabFilm.filmPlayer() as unknown as { now: () => number } | null;
    return { status: f.status, t: p?.now() ?? 0, cue: f.cue, audioOk: f.audioOk, seg: f.seg };
  });

/** The time the picture is drawn at, against the audio element's own position, over n samples 100 ms apart. */
const drift = (page: Page, n: number) =>
  page.evaluate(async (n) => {
    const w = window as unknown as FilmWin;
    let worst = 0;
    let samples = 0;
    for (let i = 0; i < n; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const p = w.__fabFilm.filmPlayer()! as unknown as { now: () => number; els: HTMLAudioElement[]; active: number; tl: { segments: { start: number; dur: number }[] } };
      const audio = p.els[p.active];
      if (!audio || audio.paused) continue;
      const t = p.now();
      const seg = p.tl.segments.find((s) => t >= s.start - 0.01 && t <= s.start + s.dur + 0.01);
      if (!seg) continue;
      worst = Math.max(worst, Math.abs(t - (seg.start + audio.currentTime)));
      samples++;
    }
    return { worst, samples };
  }, n);

test('the film plays through to the working inverter without touching the learning run', async ({ page }) => {
  const errors = watchErrors(page);
  await freshStart(page, '/?step=expose&dose=1');
  const saved = await page.evaluate(() => localStorage.getItem('fab-one:v2'));
  expect(saved).toBeTruthy();
  await page.goto('/?watch&virt=1');
  await expect(page.getByRole('group', { name: 'Film controls' })).toBeVisible();
  // from shortly before the final test to the end, on the harness clock (captions only)
  await page.evaluate(() => {
    const w = window as unknown as FilmWin;
    const tl = w.__fabFilm.filmPlayer()!.tl as unknown as { segments: { start: number; def: { id: string } }[] };
    w.__fabFilm.filmControls.seek(tl.segments.find((s) => s.def.id === 'final')!.start - 1);
    w.__fabFilm.filmControls.play();
  });
  const seen = new Set<string>();
  for (let i = 0; i < 120; i++) {
    await page.evaluate(() => (window as unknown as { __fabTick: (n: number) => void }).__fabTick(15));
    const f = await film(page);
    if (f.cue) seen.add(f.cue);
    if (f.status === 'ended') break;
  }
  await advance(page, 2);
  expect([...seen]).toContain('With the input high, the NMOS transistor takes over, and the output goes low.');
  expect((await film(page)).status).toBe('ended');
  await expect(page.getByRole('dialog', { name: 'That was the whole journey.' })).toBeVisible();
  // no quiz was asked, and the saved learning run is exactly as it was
  await expect(page.getByText('Predict first')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('fab-one:v2'))).toBe(saved);
  expect(errors).toEqual([]);
});

test('narration drives the film clock: pause, seek, speed, mute and chapters stay in sync', async ({ page, isMobile }) => {
  test.skip(isMobile, 'measured once, on desktop');
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  await freshStart(page, '/?hooks=1');
  await press(page.getByRole('button', { name: 'Watch the film' }), false);
  await expect.poll(async () => (await film(page)).status, { timeout: 60_000 }).toBe('playing');
  // Alignment: the time the picture is drawn at, against the audio element's own position.
  const d0 = await drift(page, 40);
  console.log(`film clock vs narration audio: worst difference ${(d0.worst * 1000).toFixed(1)} ms over ${d0.samples} samples`);
  expect(d0.samples).toBeGreaterThan(10);
  expect(d0.worst).toBeLessThan(0.15);

  // pause holds the picture
  await page.evaluate(() => (window as unknown as FilmWin).__fabFilm.filmControls.pause());
  const t0 = (await film(page)).t;
  await page.waitForTimeout(800);
  expect((await film(page)).t).toBeCloseTo(t0, 2);
  // seek, then play at 1.5×, muted: time still runs from the (muted) audio
  await page.evaluate(() => {
    const c = (window as unknown as FilmWin).__fabFilm.filmControls;
    c.seek(245);
    c.rate(1.5);
    c.muted(true);
    c.play();
  });
  await expect.poll(async () => (await film(page)).status, { timeout: 30_000 }).toBe('playing');
  const a = (await film(page)).t;
  await page.waitForTimeout(2000);
  const b = (await film(page)).t;
  expect(b - a).toBeGreaterThan(2.2); // 1.5× speed
  const rate = await page.evaluate(() => [...(window as unknown as { __fabFilm: { filmPlayer: () => { els: HTMLAudioElement[] } } }).__fabFilm.filmPlayer().els].map((e) => [e.playbackRate, e.muted]));
  expect(rate[0]).toEqual([1.5, true]);
  // chapter marker
  await page.getByRole('button', { name: 'Jump to chapter: Testing' }).click({ force: true });
  const ch = await page.evaluate(() => (window as unknown as FilmWin).__fabFilm.filmPlayer()!.tl.chapters[4].start);
  expect((await film(page)).t).toBeGreaterThanOrEqual(ch - 0.01);
  expect((await film(page)).t).toBeLessThan(ch + 3);

  // Background and back: while hidden the page gets no animation frames (emulated here by
  // holding them back), the narration keeps playing and the clock follows it; on return the
  // picture is drawn at the audio's time again.
  const away = await page.evaluate(async () => {
    const p = (window as unknown as FilmWin).__fabFilm.filmPlayer()!;
    const raf = window.requestAnimationFrame;
    const held: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (cb) => (held.push(cb), 0);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const a = p.t;
    await new Promise((r) => setTimeout(r, 2000));
    const b = p.t;
    delete (document as unknown as { hidden?: boolean }).hidden;
    delete (document as unknown as { visibilityState?: string }).visibilityState;
    window.requestAnimationFrame = raf;
    document.dispatchEvent(new Event('visibilitychange'));
    for (const cb of held) raf(cb);
    return b - a;
  });
  expect(away).toBeGreaterThan(2); // 2 s away at 1.5×
  const d1 = await drift(page, 20);
  console.log(`after returning from the background: worst difference ${(d1.worst * 1000).toFixed(1)} ms over ${d1.samples} samples`);
  expect(d1.samples).toBeGreaterThan(5);
  expect(d1.worst).toBeLessThan(0.15);
  expect(errors).toEqual([]);
});

test('slow network: the picture waits for the narration (buffering), then carries on', async ({ page, isMobile, browserName }) => {
  test.skip(isMobile || browserName !== 'chromium', 'CDP network throttling');
  await freshStart(page, '/?hooks=1');
  await press(page.getByRole('button', { name: 'Watch the film' }), false);
  await expect.poll(async () => (await film(page)).status, { timeout: 60_000 }).toBe('playing');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 2000, downloadThroughput: 2000, uploadThroughput: 2000 });
  await page.evaluate(() => (window as unknown as FilmWin).__fabFilm.filmControls.seek(400)); // a segment not loaded yet
  await expect.poll(async () => (await film(page)).status, { timeout: 20_000 }).toBe('buffering');
  const held = (await film(page)).t;
  await page.waitForTimeout(1000);
  expect((await film(page)).t).toBeCloseTo(held, 1);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await expect.poll(async () => (await film(page)).status, { timeout: 60_000 }).toBe('playing');
});

test('narration that cannot load: the film says so and plays with captions', async ({ page }) => {
  await page.route('**/narration/**/*.mp3', (r) => r.abort());
  await freshStart(page, '/?hooks=1');
  await press(page.getByRole('button', { name: 'Watch the film' }), false);
  await expect(page.getByText(/Playing with captions only/)).toBeVisible({ timeout: 60_000 });
  const a = (await film(page)).t;
  await page.waitForTimeout(1500);
  const f = await film(page);
  expect(f.audioOk).toBe(false);
  expect(f.t).toBeGreaterThan(a);
});
