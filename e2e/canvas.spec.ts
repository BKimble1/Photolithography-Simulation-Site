import { expect, test, type Page } from '@playwright/test';
import { advance, freshStart, waitForStage, watchErrors } from './helpers';

/**
 * The 3D view draws a real picture (not a blank or uniform canvas) and it moves: frames are
 * rendered on the harness clock (?virt=1) and read back from the WebGL drawing buffer in the
 * same task, so the check sees exactly what was drawn.
 */
type Frame = { std: number; levels: number; grid: number[] };

const frame = (page: Page): Promise<Frame> =>
  page.evaluate(() => {
    const w = window as unknown as {
      __fabAdvance: (n: number) => void;
      __fab: { gl: { getContext: () => WebGL2RenderingContext } };
    };
    w.__fabAdvance(1);
    const gl = w.__fab.gl.getContext();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // luminance statistics, and a 16 × 16 grid of mean luminance to compare frames
    const N = 16;
    const grid = new Array(N * N).fill(0);
    const count = new Array(N * N).fill(0);
    const seen = new Set<number>();
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let y = 0; y < H; y += 2)
      for (let x = 0; x < W; x += 2) {
        const i = (y * W + x) * 4;
        const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        sum += l;
        sum2 += l * l;
        n++;
        seen.add(Math.round(l / 4));
        const g = Math.min(N - 1, Math.floor((y / H) * N)) * N + Math.min(N - 1, Math.floor((x / W) * N));
        grid[g] += l;
        count[g]++;
      }
    const mean = sum / n;
    return { std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), levels: seen.size, grid: grid.map((g, i) => g / Math.max(1, count[i])) };
  });

/** Mean absolute change of the 16 × 16 luminance grid between two frames (0–255). */
const change = (a: Frame, b: Frame) => a.grid.reduce((s, v, i) => s + Math.abs(v - b.grid[i]), 0) / a.grid.length;

test('a lesson draws a real picture, and it moves', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = watchErrors(page);
  // the first lesson: the overhead hoist lowers the pod onto the load port
  await freshStart(page, '/?step=arrive&virt=1');
  await waitForStage(page);
  await advance(page, 20);
  const a = await frame(page);
  await advance(page, 25);
  const b = await frame(page);
  expect(a.std, 'the picture has contrast').toBeGreaterThan(10);
  expect(a.levels, 'the picture has many tones').toBeGreaterThan(24);
  expect(change(a, b), 'the picture changed between frames').toBeGreaterThan(0.3);
  expect(errors).toEqual([]);
});

test('the film draws a real picture, and it moves', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = watchErrors(page);
  await freshStart(page, '/?watch&t=292&virt=1');
  await waitForStage(page);
  await advance(page, 10);
  await page.evaluate(() => (window as unknown as { __fabFilm: { filmControls: { play: () => void } } }).__fabFilm.filmControls.play());
  const a = await frame(page);
  await advance(page, 30);
  const b = await frame(page);
  expect(a.std).toBeGreaterThan(10);
  expect(a.levels).toBeGreaterThan(24);
  expect(change(a, b)).toBeGreaterThan(0.3);
  expect(errors).toEqual([]);
});
