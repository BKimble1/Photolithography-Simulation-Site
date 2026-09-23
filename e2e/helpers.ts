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

/** Wait until the 3D stage (and, with ?virt=1, its frame-stepping harness) is ready. */
export async function waitForStage(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { __fab?: unknown; __fabAdvance?: unknown };
    return !!w.__fab && (!new URLSearchParams(location.search).has('virt') || !!w.__fabAdvance);
  }, undefined, { timeout: 60_000 });
}

/**
 * Frame-stepped harness (?virt=1): render n frames of exactly 1/30 s. Frames are rendered
 * one at a time so React can commit between them, as it would in a real browser.
 */
export async function advance(page: Page, n: number): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __fabAdvance?: unknown }).__fabAdvance, undefined, { timeout: 60_000 });
  for (let i = 0; i < n; i++) await page.evaluate(() => (window as unknown as { __fabAdvance?: (n: number) => void }).__fabAdvance?.(1));
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
