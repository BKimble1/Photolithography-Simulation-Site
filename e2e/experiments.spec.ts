import { expect, test, type Page } from '@playwright/test';
import { STEPS } from '../src/content/steps';
import { freshStart, press, watchErrors } from './helpers';

async function setSlider(page: Page, name: string | RegExp, keys: string[]) {
  const s = page.getByRole('slider', { name });
  await s.focus();
  for (const k of keys) await page.keyboard.press(k);
}

test('overlay beyond the margin fails the final test; re-aligning restores it', async ({ page, hasTouch }) => {
  const errors = watchErrors(page);
  await freshStart(page, '/?step=contact-align');
  await expect(page.locator('h1.step-title')).toHaveText(STEPS['contact-align'].title);
  await setSlider(page, 'Contact overlay offset', Array(5).fill('ArrowRight'));
  await expect(page.getByText('Beyond the margin')).toBeVisible();

  // Choices persist, so jumping to the last step tests the wafer built with this offset.
  await page.goto('/?step=final');
  await expect(page.getByText('Your die: fail')).toBeVisible();
  await expect(page.getByText(/Output (shorted|floating)/)).toBeVisible();

  await press(page.getByRole('button', { name: 'Re-align contacts' }), hasTouch);
  await expect(page.getByText('Your die: pass')).toBeVisible();
  await expect(page.getByText('Output 1 (high)')).toBeVisible();
  expect(errors).toEqual([]);
});

test('far under-exposure fails inspection; rework and nominal dose recover', async ({ page, hasTouch }) => {
  const errors = watchErrors(page);
  await freshStart(page, '/?step=expose');
  await setSlider(page, 'Exposure dose', ['Home']);
  await press(page.getByRole('button', { name: 'Continue', exact: true }), hasTouch); // PEB
  await press(page.getByRole('button', { name: 'Continue', exact: true }), hasTouch); // develop
  await press(page.getByRole('button', { name: 'The resist that stayed in shadow under the chrome' }), hasTouch);
  await expect(page.getByText('Not quite.', { exact: false })).toBeVisible();
  await press(page.getByRole('button', { name: 'Continue', exact: true }), hasTouch); // inspection
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.adi.title);
  await expect(page.getByText('Out of spec', { exact: true })).toBeVisible();

  await press(page.getByRole('button', { name: 'Rework: strip and redo' }), hasTouch);
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.expose.title);
  await expect(page.getByText(/Reworked: the resist was stripped/)).toBeVisible();
  await press(page.getByRole('button', { name: 'Restore nominal dose' }), hasTouch);
  for (let i = 0; i < 3; i++) await press(page.getByRole('button', { name: 'Continue', exact: true }), hasTouch);
  await expect(page.locator('h1.step-title')).toHaveText(STEPS.adi.title);
  await expect(page.getByText('In spec — released to etch')).toBeVisible();
  expect(errors).toEqual([]);
});

test('skipping the clean leaves particles that cost dies at wafer sort', async ({ page, hasTouch }) => {
  const errors = watchErrors(page);
  const yieldAt = async () => {
    await page.goto('/?step=probe');
    const chip = page.getByText(/Yield [\d.]+% \(toy model\)/);
    await expect(chip).toBeVisible({ timeout: 60_000 });
    return Number((await chip.textContent())!.match(/([\d.]+)%/)![1]);
  };
  await freshStart(page, '/?step=clean');
  const clean = await yieldAt();

  await page.goto('/?step=clean');
  await press(page.getByRole('radio', { name: 'Skip it' }), hasTouch);
  await expect(page.getByText(/particles left/)).toBeVisible();
  const dirty = await yieldAt();
  expect(dirty).toBeLessThan(clean);
  expect(errors).toEqual([]);
});
