import { expect, test, type Page } from '@playwright/test';
import { freshStart, overlaps, watchErrors } from './helpers';

/**
 * The home headline never collides with the wordmark or overflows sideways, at any size,
 * zoom level, text size, or while the web fonts are still loading.
 */
const SIZES: [number, number, string][] = [
  [1440, 900, 'desktop'],
  [1920, 640, 'wide and short'],
  [1440, 560, 'short'],
  [1280, 720, 'laptop'],
  [640, 360, 'laptop at 200 % zoom'],
  [1024, 768, 'tablet'],
  [768, 1024, 'tablet portrait'],
  [390, 844, 'phone'],
  [844, 390, 'phone landscape'],
  [320, 568, 'small phone'],
];

async function checkHome(page: Page, label: string) {
  const wordmark = await page.locator('.wordmark').boundingBox();
  const title = await page.locator('.home-intro__title').boundingBox();
  const header = await page.locator('.topbar').boundingBox();
  const actions = await page.locator('.home-intro__actions').boundingBox();
  const watch = await page.getByRole('button', { name: 'Watch the film' }).boundingBox();
  expect(wordmark && title && header && actions && watch, label).toBeTruthy();
  expect(overlaps(wordmark!, title!), `${label}: wordmark and headline overlap`).toBe(false);
  expect(title!.y, `${label}: headline starts inside the header`).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
  expect(overlaps(watch!, title!), `${label}: Watch and headline overlap`).toBe(false);
  expect(overlaps(watch!, wordmark!), `${label}: Watch and wordmark overlap`).toBe(false);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(1);
  // the primary actions are on screen without scrolling sideways
  expect(actions!.x + actions!.width, `${label}: actions clipped`).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

test('home: headline, wordmark and actions never collide or overflow', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set explicitly here');
  const errors = watchErrors(page);
  await freshStart(page);
  for (const [w, h, label] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    await checkHome(page, `${label} ${w}×${h}`);
  }
  // Enlarged text (browser text size 150 %).
  await page.addStyleTag({ content: 'html { font-size: 150% !important; }' });
  for (const [w, h, label] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    await checkHome(page, `${label} ${w}×${h}, large text`);
  }
  expect(errors).toEqual([]);
});

test('home: layout holds while the web fonts have not loaded', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'sizes are set explicitly here');
  await page.route('**/*.woff2', (r) => r.abort());
  await freshStart(page);
  for (const [w, h, label] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    await checkHome(page, `${label} ${w}×${h}, fallback font`);
  }
});

test('lesson header: brand, place and actions keep their own space', async ({ page }) => {
  await freshStart(page, '/?step=contact-align');
  const brand = await page.locator('.topbar__brand').boundingBox();
  const centre = await page.locator('.topbar__centre .place').boundingBox();
  const actions = await page.locator('.topbar__actions').boundingBox();
  expect(overlaps(brand!, centre!)).toBe(false);
  expect(overlaps(centre!, actions!)).toBe(false);
  await expect(page.getByRole('button', { name: 'Watch the film' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
