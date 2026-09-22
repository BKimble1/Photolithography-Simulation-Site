import { expect, test } from '@playwright/test';
import { STEPS } from '../src/content/steps';
import { FLOW } from '../src/sim/flow';
import { freshStart, press, waitForCanvas, watchErrors } from './helpers';

test('first run: home → every step → working inverter → recap', async ({ page, hasTouch }) => {
  // 37 steps with full rendering; software WebGL (SwiftShader) is slow, so allow plenty of time.
  test.setTimeout(20 * 60_000);
  const errors = watchErrors(page);
  await freshStart(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Build a chip');
  await press(page.getByRole('button', { name: /Start the journey/ }), hasTouch);
  await waitForCanvas(page);

  for (let i = 0; i < FLOW.length; i++) {
    const id = FLOW[i].id;
    await expect(page.locator('h1.step-title')).toHaveText(STEPS[id].title);
    await expect(page).toHaveURL(new RegExp(`step=${id}(&|$)`));
    if (STEPS[id].check === 'develop') {
      // Knowledge check: a positive resist loses the exposed areas.
      await press(page.getByRole('button', { name: 'The resist that was exposed to light' }), hasTouch);
      await expect(page.getByText('Correct.', { exact: false })).toBeVisible();
    }
    if (i === FLOW.length - 1) break;
    await press(page.getByRole('button', { name: 'Continue', exact: true }), hasTouch);
  }

  // The inverter truth table, driven from the extracted circuit.
  await expect(page.getByText('Your die: pass')).toBeVisible();
  await expect(page.getByText('Output 1 (high)')).toBeVisible();
  await press(page.getByRole('radio', { name: /1\s*high/ }), hasTouch);
  await expect(page.getByText('Output 0 (low)')).toBeVisible();
  await press(page.getByRole('radio', { name: /0\s*low/ }), hasTouch);
  await expect(page.getByText('Output 1 (high)')).toBeVisible();

  await press(page.getByRole('button', { name: 'See your recap' }), hasTouch);
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
});

test('keyboard: start, advance, open stages, switch zoom level', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard flow is for desktop and tablet');
  const errors = watchErrors(page);
  await freshStart(page);
  const startBtn = page.getByRole('button', { name: /Start the journey/ });
  for (let i = 0; i < 8 && !(await startBtn.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(startBtn).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.arrive.title);
  // Focus moves to the step title so screen readers announce the new step.
  await expect(page.locator('h1.step-title')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.transfer.title);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.arrive.title);
  await page.keyboard.press('3');
  await expect(page.getByRole('button', { name: 'Wafer', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('s');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('reduced motion: steps land on their end state without playing', async ({ page, hasTouch }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = watchErrors(page);
  await freshStart(page, '/?step=coat');
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.coat.title);
  const scrub = page.getByRole('slider', { name: /Scrub through/ });
  await expect(scrub).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await press(page.getByRole('button', { name: 'Continue', exact: true }), hasTouch);
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.softbake.title);
  await expect(scrub).toHaveValue('1');
  expect(errors).toEqual([]);
});
