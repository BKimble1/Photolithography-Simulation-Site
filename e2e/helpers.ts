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
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
}

/** Wait until the WebGL canvas has been created and drawn at least once. */
export async function waitForCanvas(page: Page): Promise<void> {
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.waitForTimeout(600);
}
