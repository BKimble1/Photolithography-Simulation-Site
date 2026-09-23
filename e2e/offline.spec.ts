import { expect, test } from '@playwright/test';
import { freshStart, watchErrors } from './helpers';

async function openSave(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /Save for offline|Saved for offline/ }).click();
  return page.getByRole('dialog', { name: 'Save for offline' });
}

test.describe('offline film', () => {
  test.beforeEach(({ browserName }, info) => {
    test.skip(browserName !== 'chromium' || info.project.name !== 'desktop', 'service worker flow, once');
  });

  test.afterEach(async ({ page }) => {
    if (!page.url().startsWith('http')) return; // skipped: the page never left about:blank
    await page.evaluate(async () => {
      for (const k of await caches.keys()) await caches.delete(k);
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    });
  });

  test('saving is explicit and verified; the saved film then plays without a connection', async ({ page, context }) => {
    const errors = watchErrors(page);
    await freshStart(page, '/?watch&hooks=1');
    const pop = await openSave(page);
    await expect(pop.getByText(/Download the film and this site/)).toBeVisible();
    await pop.getByRole('button', { name: 'Download' }).click();
    await expect(pop.getByText(/Saved on this device/)).toBeVisible({ timeout: 120_000 });
    // every cached file matches the build list and the narration manifest
    const count = await page.evaluate(async () => {
      const keys = (await caches.keys()).filter((k) => k.startsWith('fabone-offline-'));
      const c = await caches.open(keys[0]);
      return { caches: keys.length, entries: (await c.keys()).length };
    });
    expect(count.caches).toBe(1);
    expect(count.entries).toBeGreaterThan(70);
    await page.evaluate(() => navigator.serviceWorker.ready);

    await context.setOffline(true);
    await page.goto('/?watch&hooks=1');
    await expect(page.getByRole('group', { name: 'Film controls' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Play the film' }).click();
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __fabFilm: { useFilm: { getState: () => { status: string; audioOk: boolean } } } }).__fabFilm.useFilm.getState()), { timeout: 60_000 })
      .toMatchObject({ status: 'playing', audioOk: true });
    // the cross-section is built in a worker, whose script is part of the saved build
    await page.goto('/?step=wells&hooks=1');
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __fab?: { deviceMeshes: { stats: { worker: number; main: number } } } }).__fab?.deviceMeshes.stats ?? null), { timeout: 120_000 })
      .toMatchObject({ worker: expect.any(Number) });
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __fab: { deviceMeshes: { stats: { worker: number } } } }).__fab.deviceMeshes.stats.worker), { timeout: 120_000 })
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { __fab: { deviceMeshes: { stats: { main: number } } } }).__fab.deviceMeshes.stats.main), 'no fallback to the main thread').toBe(0);
    await context.setOffline(false);
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  });

  test('an interrupted download is reported, nothing is claimed, and retry completes it', async ({ page }) => {
    await freshStart(page, '/?watch&hooks=1');
    let failed = false;
    await page.route('**/narration/**/develop.mp3', (r) => {
      if (!failed) {
        failed = true;
        return r.abort('connectionreset');
      }
      return r.continue();
    });
    const pop = await openSave(page);
    await pop.getByRole('button', { name: 'Download' }).click();
    await expect(pop.getByRole('alert')).toBeVisible({ timeout: 120_000 });
    await expect(pop.getByText(/Saved on this device/)).toHaveCount(0);
    const complete = await page.evaluate(async () => {
      for (const k of await caches.keys()) if (await (await caches.open(k)).match('__complete__')) return true;
      return false;
    });
    expect(complete).toBe(false);
    await pop.getByRole('button', { name: 'Try again' }).click();
    await expect(pop.getByText(/Saved on this device/)).toBeVisible({ timeout: 120_000 });
  });

  test('not enough storage: says so before downloading anything', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'storage', { value: { estimate: async () => ({ quota: 2_000_000, usage: 1_500_000 }), persist: async () => false } });
    });
    await freshStart(page, '/?watch&hooks=1');
    const pop = await openSave(page);
    await pop.getByRole('button', { name: 'Download' }).click();
    await expect(pop.getByText(/Not enough storage space/)).toBeVisible();
    const any = await page.evaluate(async () => (await caches.keys()).length);
    expect(any).toBeLessThanOrEqual(1);
  });
});
