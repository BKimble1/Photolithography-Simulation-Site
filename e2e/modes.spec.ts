import { expect, test } from '@playwright/test';
import { STEPS } from '../src/content/steps';
import { advance, freshStart, press, runState, settle, stageInfo, waitForStage, watchErrors } from './helpers';

test('changing scale never changes the step, choices, checks or simulated state', async ({ page, hasTouch }) => {
  test.setTimeout(480_000); // frame-stepped on software rendering
  const errors = watchErrors(page);
  await freshStart(page, '/?step=gate-etch&virt=1');
  await waitForStage(page);
  await advance(page, 12);
  await page.evaluate(() => {
    const w = window as unknown as { __fabStores: { useClock: { getState: () => { pause: () => void; set: (p: number) => void } } } };
    w.__fabStores.useClock.getState().pause();
    w.__fabStores.useClock.getState().set(0.6);
  });
  await advance(page, 2);
  const before = await runState(page);
  await press(page.getByRole('button', { name: 'Inspect layers' }), hasTouch);
  await settle(page);
  expect((await stageInfo(page)).space).toBe('device');
  expect(await runState(page)).toEqual(before);
  await press(page.getByRole('button', { name: 'Back to equipment' }), hasTouch);
  await settle(page);
  expect((await stageInfo(page)).space).toBe('world');
  expect(await runState(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('Explore fab pauses the lesson; returning restores it exactly and offers Resume', async ({ page, hasTouch }) => {
  test.setTimeout(480_000); // frame-stepped on software rendering
  const errors = watchErrors(page);
  await freshStart(page, '/?step=coat&virt=1');
  await waitForStage(page);
  await advance(page, 45); // the step is playing
  expect((await runState(page)).playing).toBe(true);
  const camBefore = (await stageInfo(page)).cam;

  // Leaving for Explore pauses the lesson exactly where it was (no frame is drawn in between).
  await press(page.getByRole('button', { name: 'Explore fab' }), hasTouch);
  const before = { ...(await runState(page)), mode: 'learn' };
  expect(before.playing).toBe(false);
  expect(before.progress).toBeGreaterThan(0.05);
  await expect(page).toHaveURL(/\?explore$/);
  await settle(page);
  await press(page.getByRole('button', { name: 'Equipment', exact: true }), hasTouch);
  await press(page.getByRole('button', { name: /^Plasma etch cluster/ }), hasTouch);
  await expect(page.getByRole('heading', { name: 'Plasma etch cluster' })).toBeVisible();
  await expect(page).toHaveURL(/\?explore=etch$/);
  await press(page.getByRole('button', { name: 'See it work' }), hasTouch);
  await expect(page.getByText('Demonstration', { exact: true })).toBeVisible();
  await settle(page);
  await advance(page, 45);
  // the demonstration runs on a sample wafer: the learning run is untouched
  const during = await runState(page);
  expect({ ...during, mode: 'learn', key: before.key }).toEqual(before);
  expect(during.saved).toBe(before.saved);

  await press(page.getByRole('button', { name: 'Return to lesson' }), hasTouch);
  await expect(page).toHaveURL(/\?step=coat$/);
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.coat.title);
  // it was playing when we left, so it offers Resume rather than playing by surprise
  await expect(page.getByText('Paused where you left it.')).toBeVisible();
  await settle(page);
  const after = await runState(page);
  expect(after).toEqual(before);
  // back at the same framing
  const cam = (await stageInfo(page)).cam;
  expect(Math.hypot(cam[0] - camBefore[0], cam[1] - camBefore[1], cam[2] - camBefore[2])).toBeLessThan(0.05);
  await press(page.getByRole('button', { name: /Resume/ }), hasTouch);
  await advance(page, 10);
  expect((await runState(page)).playing).toBe(true);
  expect(errors).toEqual([]);
});

test('chapters drawer, deep links and browser history agree', async ({ page, hasTouch }) => {
  const errors = watchErrors(page);
  await freshStart(page, '/?step=arrive');
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.arrive.title);
  await press(page.getByRole('button', { name: 'Chapters' }), hasTouch);
  const drawer = page.getByRole('dialog', { name: 'Chapters' });
  await expect(drawer).toBeVisible();
  // unanswered checks are not shown as done
  await expect(drawer.getByRole('button', { name: /Develop\. not visited yet/ })).toBeVisible();
  await press(drawer.getByRole('button', { name: /Coat the wafer/ }), hasTouch);
  await expect(page).toHaveURL(/\?step=coat$/);
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.coat.title);
  await page.goBack();
  await expect(page).toHaveURL(/\?step=arrive$/);
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.arrive.title);
  await page.goForward();
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.coat.title);
  await page.reload();
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.coat.title);
  expect(errors).toEqual([]);
});

test('rapid navigation: the last request wins and no stale camera move completes', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard');
  const errors = watchErrors(page);
  await freshStart(page, '/?step=arrive&virt=1');
  await waitForStage(page);
  await advance(page, 20);
  await page.locator('h1.step-title').focus();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('ArrowRight');
    await advance(page, 3); // mid-flight each time
  }
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.padox.title);
  await settle(page, 300);
  const s = await stageInfo(page);
  expect(s.flying).toBe(false);
  expect(s.focus).toBe('furnace');
  expect((await runState(page)).step).toBe(5);
  expect(errors).toEqual([]);
});

test('scrubbing forwards and back gives the same state as playing', async ({ page }) => {
  await freshStart(page, '/?step=sti-etch&virt=1');
  await waitForStage(page);
  await advance(page, 10);
  const at = async (p: number) => {
    await page.evaluate((v) => (window as unknown as { __fabStores: { useClock: { getState: () => { set: (p: number) => void } } } }).__fabStores.useClock.getState().set(v), p);
    await advance(page, 2);
    return (await runState(page)).key;
  };
  const k80 = await at(0.8);
  const k20 = await at(0.2);
  expect(await at(0.8)).toBe(k80);
  expect(await at(0.2)).toBe(k20);
  expect(k80).not.toBe(k20);
});
