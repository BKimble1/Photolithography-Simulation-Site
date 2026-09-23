import { expect, type Locator, type Page } from '@playwright/test';

/** Collect uncaught errors and console errors for the whole test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Tap on touch projects, click elsewhere. */
export async function press(target: Locator, touch: boolean): Promise<void> {
  if (touch) await target.tap();
  else await target.click();
}

export async function freshStart(page: Page, path = '/'): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(path);
}

/** Wait until the WebGL canvas has been created and drawn at least once. */
export async function waitForCanvas(page: Page): Promise<void> {
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.waitForTimeout(600);
}

/** Wait until the 3D stage, the bay's machines (and, with ?virt=1, the frame-stepping harness) are ready. */
export async function waitForStage(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { __fab?: { stationBoxes?: Map<string, unknown> }; __fabAdvance?: unknown };
    return !!w.__fab && (w.__fab.stationBoxes?.size ?? 1) > 0 && (!new URLSearchParams(location.search).has('virt') || !!w.__fabAdvance);
  }, undefined, { timeout: 90_000 });
}

/**
 * Frame-stepped harness (?virt=1): render n frames of exactly 1/30 s. Frames are rendered
 * one at a time so React can commit between them, as it would in a real browser.
 */
export async function advance(page: Page, n: number): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __fabAdvance?: unknown }).__fabAdvance, undefined, { timeout: 60_000 });
  for (let i = 0; i < n; i++) await page.evaluate(() => (window as unknown as { __fabAdvance?: (n: number) => void }).__fabAdvance?.(1));
}

/**
 * Frame-stepped harness: render frames until the camera has arrived (the director is not
 * travelling), checking every few frames; at most `max` frames.
 */
export async function settle(page: Page, max = 240): Promise<void> {
  await waitForStage(page);
  await advance(page, 4);
  for (let n = 4; n < max; n += 6) {
    const flying = await page.evaluate(() => (window as unknown as { __fab: { useStageInfo: { getState: () => { flying: boolean } } } }).__fab.useStageInfo.getState().flying);
    if (!flying) break;
    await advance(page, 6);
  }
  await advance(page, 2);
}

type Win = {
  __fabStores: { useApp: { getState: () => Record<string, unknown> & { navigate: (t: unknown) => void } }; useClock: { getState: () => { progress: number; playing: boolean; pendingPlay: boolean; set: (p: number) => void; pause: () => void }; setState: (s: object) => void } };
  __fabSim: { learnStateKey: () => string };
  __fab: {
    camera: { position: { x: number; y: number; z: number } };
    stageFocus: { station: string | null };
    useStageInfo: { getState: () => { scale: string; space: string; freeLook: boolean; flying: boolean } };
  };
};

/** The learning run and lesson clock, as the tests compare them. */
export async function runState(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as Win;
    const a = w.__fabStores.useApp.getState();
    const c = w.__fabStores.useClock.getState();
    return {
      mode: a.mode as string,
      step: a.step as number,
      choices: JSON.stringify(a.choices),
      checks: JSON.stringify(a.checks),
      visited: JSON.stringify(a.visited),
      progress: Math.round(c.progress * 1000) / 1000,
      playing: c.playing,
      key: w.__fabSim.learnStateKey(),
      saved: localStorage.getItem('fab-one:v2'),
    };
  });
}

export async function stageInfo(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as Win;
    const p = w.__fab.camera.position;
    return { ...w.__fab.useStageInfo.getState(), focus: w.__fab.stageFocus.station, cam: [p.x, p.y, p.z] as [number, number, number] };
  });
}

/** Axis-aligned boxes intersect (with a small tolerance). */
export function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, tol = 0.5): boolean {
  return a.x < b.x + b.width - tol && b.x < a.x + a.width - tol && a.y < b.y + b.height - tol && b.y < a.y + a.height - tol;
}

// ───────────────────────────── frame-by-frame continuity (round three) ─────────────────────────────

export interface FrameSample {
  /** 16 × 16 mean luminance of the picture. */
  grid: number[];
  /** The learner's wafer as drawn: which machine shows it, where, and whether it is on screen. */
  wafers: { station: string; pos: [number, number, number]; onScreen: boolean }[];
  cam: [number, number, number];
  target: [number, number, number];
  fov: number;
  space: string;
  flying: boolean;
}

/** Render one harness frame and read back what it drew (the picture and the learner's wafers). */
export async function sampleFrame(page: Page): Promise<FrameSample> {
  return page.evaluate(() => {
    type V3 = { x: number; y: number; z: number; clone(): V3; project(c: unknown): V3; set(x: number, y: number, z: number): V3 };
    type O3 = { visible: boolean; parent: O3 | null; getWorldPosition(v: V3): V3 };
    const w = window as unknown as {
      __fabAdvance: (n: number) => void;
      __fab: {
        gl: { getContext: () => WebGL2RenderingContext };
        camera: { position: V3; fov: number; getWorldDirection(v: V3): V3 };
        waferRegistry: Map<string, O3>;
        stationGroups: Map<string, O3>;
        useStageInfo: { getState: () => { space: string; flying: boolean } };
        THREE: { Vector3: new (x?: number, y?: number, z?: number) => V3 };
      };
    };
    w.__fabAdvance(1);
    const f = w.__fab;
    const gl = f.gl.getContext();
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
        const g = Math.min(N - 1, Math.floor((y / H) * N)) * N + Math.min(N - 1, Math.floor((x / W) * N));
        grid[g] += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        cnt[g]++;
      }
    const wafers: FrameSample['wafers'] = [];
    const v = new f.THREE.Vector3();
    f.waferRegistry.forEach((m, station) => {
      let shown = true;
      for (let o: O3 | null = m; o; o = o.parent) if (!o.visible) shown = false;
      if (!shown) return;
      m.getWorldPosition(v);
      const n = v.clone().project(f.camera);
      wafers.push({ station, pos: [v.x, v.y, v.z], onScreen: n.z < 1 && Math.abs(n.x) < 1 && Math.abs(n.y) < 1 });
    });
    const d = f.camera.getWorldDirection(new f.THREE.Vector3());
    const c = f.camera.position;
    const info = f.useStageInfo.getState();
    return {
      grid: grid.map((g, i) => g / Math.max(1, cnt[i])),
      wafers,
      cam: [c.x, c.y, c.z],
      target: [c.x + d.x, c.y + d.y, c.z + d.z],
      fov: f.camera.fov,
      space: info.space,
      flying: info.flying,
    } as FrameSample;
  });
}

export async function sampleFrames(page: Page, n: number): Promise<FrameSample[]> {
  const out: FrameSample[] = [];
  for (let i = 0; i < n; i++) out.push(await sampleFrame(page));
  return out;
}

/** Mean absolute change of the luminance grid between two frames (0–255). */
export const pictureChange = (a: FrameSample, b: FrameSample) => a.grid.reduce((s, v, i) => s + Math.abs(v - b.grid[i]), 0) / a.grid.length;

/**
 * The worst one-frame picture change relative to the frames around it: a jump shows as a
 * frame that changes far more than its neighbours do (continuous motion changes steadily).
 */
export function worstJump(frames: FrameSample[], from = 1): { at: number; change: number; ratio: number } {
  const ch = frames.map((f, i) => (i ? pictureChange(frames[i - 1], f) : 0));
  let worst = { at: -1, change: 0, ratio: 0 };
  for (let k = Math.max(1, from); k < frames.length; k++) {
    const around = [...ch.slice(Math.max(1, k - 4), k), ...ch.slice(k + 1, k + 5)].sort((a, b) => a - b);
    const ref = Math.max(0.35, around[Math.floor(around.length / 2)] ?? 0);
    const r = ch[k] / ref;
    if (r > worst.ratio) worst = { at: k, change: ch[k], ratio: r };
  }
  return worst;
}

/** Largest distance the learner's wafer (at `station`) moves between consecutive frames. */
export function maxWaferStep(frames: FrameSample[], station: string): number {
  let worst = 0;
  for (let k = 1; k < frames.length; k++) {
    const a = frames[k - 1].wafers.find((w) => w.station === station);
    const b = frames[k].wafers.find((w) => w.station === station);
    if (a && b) worst = Math.max(worst, Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]));
  }
  return worst;
}

export async function store(page: Page, js: string): Promise<void> {
  await page.evaluate(js);
}
