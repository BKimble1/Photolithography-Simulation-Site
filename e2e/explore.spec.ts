import { expect, test, type Page } from '@playwright/test';
import { MACHINE_INFO } from '../src/content/machines';
import { MACHINES } from '../src/state/nav';
import { advance, freshStart, waitForCanvas, waitForStage, watchErrors } from './helpers';

/**
 * A point on screen where pointing lands on the machine: its top face as seen from the camera,
 * checked against every machine's picking volume (the same padded footprints the bay uses).
 */
async function screenPoint(page: Page, id: string) {
  return page.evaluate((m) => {
    type V = { x: number; y: number; z: number; clone: () => V; project: (c: unknown) => V; set: (x: number, y: number, z: number) => V };
    type B = { min: V; max: V; clone: () => B; expandByVector: (v: V) => B };
    const w = window as unknown as {
      __fab: {
        camera: unknown;
        stationBoxes: Map<string, B>;
        THREE: { Vector3: new (x?: number, y?: number, z?: number) => V; Vector2: new (x: number, y: number) => unknown; Raycaster: new () => { setFromCamera: (p: unknown, c: unknown) => void; ray: { intersectBox: (b: B, t: V) => V | null; origin: V } } };
      };
    };
    const { THREE, camera, stationBoxes } = w.__fab;
    const boxes = [...stationBoxes].map(([k, b]) => [k, b.clone().expandByVector(new THREE.Vector3(0.15, 0.05, 0.15))] as const);
    const target = boxes.find(([k]) => k === m)![1];
    const rc = new THREE.Raycaster();
    const canvas = document.querySelector('canvas')!.getBoundingClientRect();
    const tmp = new THREE.Vector3();
    for (const fx of [0.5, 0.3, 0.7, 0.2, 0.8]) {
      for (const fz of [0.5, 0.3, 0.7, 0.2, 0.8]) {
        const p = new THREE.Vector3(target.min.x + (target.max.x - target.min.x) * fx, target.max.y - 0.02, target.min.z + (target.max.z - target.min.z) * fz).project(camera);
        if (Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95) continue;
        rc.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
        let best = '';
        let bd = Infinity;
        for (const [k, b] of boxes) {
          const hit = rc.ray.intersectBox(b, tmp);
          if (!hit) continue;
          const d = Math.hypot(hit.x - rc.ray.origin.x, hit.y - rc.ray.origin.y, hit.z - rc.ray.origin.z);
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
        if (best === m) return { x: canvas.left + ((p.x + 1) / 2) * canvas.width, y: canvas.top + ((1 - p.y) / 2) * canvas.height };
      }
    }
    return null;
  }, id);
}

test('every machine opens from the equipment list, by keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard');
  const errors = watchErrors(page);
  await freshStart(page, '/?explore');
  await waitForCanvas(page);
  for (const id of MACHINES) {
    await page.getByRole('button', { name: 'Equipment', exact: true }).focus();
    await page.keyboard.press('Enter');
    const item = page.getByRole('dialog', { name: 'Equipment' }).getByRole('button', { name: new RegExp('^' + MACHINE_INFO[id].name.replace(/[()]/g, '\\$&')) });
    await item.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: MACHINE_INFO[id].name })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`\\?explore=${id}$`));
  }
  // Escape goes back to the whole fab
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\?explore$/);
  expect(errors).toEqual([]);
});

test('every machine opens by pointing at it in the bay (click or tap)', async ({ page, hasTouch }) => {
  const errors = watchErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' }); // fades instead of flights keep this quick
  await freshStart(page, '/?explore&virt=1');
  await waitForStage(page);
  await advance(page, 12);
  for (const id of MACHINES) {
    // hide the overview card so it cannot cover a machine
    await page.evaluate(() => document.querySelector('.explore-dock')?.setAttribute('style', 'display:none'));
    const pt = await screenPoint(page, id);
    expect(pt, `${id} is visible and pickable from the overview`).toBeTruthy();
    if (!pt) continue;
    if (hasTouch) await page.touchscreen.tap(pt.x, pt.y);
    else await page.mouse.click(pt.x, pt.y);
    await advance(page, 3);
    await expect(page, `${id} at ${pt.x.toFixed(0)},${pt.y.toFixed(0)}`).toHaveURL(new RegExp(`\\?explore=${id}$`));
    await page.evaluate(() => (window as unknown as { __fabStores: { useApp: { getState: () => { navigate: (t: unknown) => void } } } }).__fabStores.useApp.getState().navigate({ mode: 'explore', machine: null }));
    await advance(page, 15);
  }
  expect(errors).toEqual([]);
});

test('hovering names a machine; a drag of the view is not a click', async ({ page, hasTouch }) => {
  test.skip(hasTouch, 'pointer hover');
  await freshStart(page, '/?explore&virt=1');
  await waitForStage(page);
  await advance(page, 12);
  await page.evaluate(() => document.querySelector('.explore-dock')?.setAttribute('style', 'display:none'));
  const pt = (await screenPoint(page, 'scanner'))!;
  await page.mouse.move(pt.x, pt.y);
  await advance(page, 3);
  await expect(page.locator('.lab3d', { hasText: MACHINE_INFO.scanner.name })).toHaveCSS('opacity', '1');
  // drag across the machine: orbit, not select
  await page.mouse.move(pt.x - 60, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + 60, pt.y, { steps: 8 });
  await page.mouse.up();
  await advance(page, 3);
  await expect(page).not.toHaveURL(/explore=/);
});
