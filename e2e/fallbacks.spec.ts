import { expect, test } from '@playwright/test';
import { STEPS } from '../src/content/steps';
import { advance, freshStart, press, runState, stageInfo, waitForStage, watchErrors } from './helpers';

test('reduced motion: steps still play, in still compositions; captions follow the process', async ({ page, hasTouch }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = watchErrors(page);
  // frame by frame (?virt=1), six times faster (?fast=1): a cross-section step, whose shots go
  // from the machine to the wafer, your die and the magnified layers
  await freshStart(page, '/?step=peb&virt=1&fast=1');
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.peb.title);
  await waitForStage(page);
  const progress: number[] = [];
  const cams: string[] = [];
  const captions = new Set<string>();
  for (let i = 0; i < 150 && progress.at(-1) !== 1; i++) {
    await advance(page, 1);
    progress.push((await runState(page)).progress);
    cams.push((await stageInfo(page)).cam.map((v) => v.toFixed(3)).join(' '));
    const cap = page.locator('.caption__text:visible');
    if (await cap.count()) captions.add((await cap.first().textContent()) ?? '');
  }
  // the step played through (it did not jump to its result)...
  expect(progress.filter((p) => p > 0.05 && p < 0.95).length).toBeGreaterThan(5);
  expect(progress.at(-1)).toBe(1);
  // ...its captions changed with the process...
  expect(captions.size).toBeGreaterThanOrEqual(2);
  // ...and the camera never travelled: it holds a composition and cuts (fades) to the next
  // (a travelling camera changes on nearly every frame; a cross-fade is two or three frames)
  const moves = cams.filter((c, i) => i > 0 && c !== cams[i - 1]).length;
  expect(cams.length).toBeGreaterThan(30);
  expect(moves).toBeLessThanOrEqual(12);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  // the next step (a knowledge check) waits for the answer, then plays
  await press(page.getByRole('button', { name: 'Continue', exact: true }), hasTouch);
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.develop.title);
  await press(page.getByRole('button', { name: 'The resist that was exposed to light' }), hasTouch);
  await advance(page, 8);
  const p = (await runState(page)).progress;
  expect(p).toBeGreaterThan(0);
  expect(p).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test('without WebGL: the lesson, its captions, the machine list and the film still work', async ({ page, hasTouch }) => {
  const errors = watchErrors(page);
  await freshStart(page, '/?step=develop&flat=1');
  await expect(page.locator('.vp-flat .xsec')).toBeVisible();
  await expect(page.locator('.caption__text:visible')).toBeVisible();
  await press(page.getByRole('button', { name: 'The resist that was exposed to light' }), hasTouch);
  await press(page.getByRole('button', { name: 'Continue', exact: true }), hasTouch);
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.adi.title);

  await page.goto('/?explore&flat=1');
  await press(page.getByRole('button', { name: 'Equipment list' }), hasTouch);
  await press(page.getByRole('button', { name: /^CD-SEM/ }), hasTouch);
  await expect(page.getByRole('heading', { name: 'CD-SEM' })).toBeVisible();

  await page.goto('/?watch&flat=1&hooks=1');
  await expect(page.getByRole('group', { name: 'Film controls' })).toBeVisible();
  expect(errors).toEqual([]);
});
