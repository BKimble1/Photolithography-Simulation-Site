import { expect, test, type Browser } from '@playwright/test';

/**
 * Regenerates the README screenshots in docs/screenshots (run: npm run screenshots).
 * ?p= freezes a step's animation at a given progress so the shots are repeatable.
 */
const SHOTS: { file: string; path: string; w: number; h: number; answered?: boolean }[] = [
  { file: '01-home.png', path: '/', w: 1440, h: 900 },
  { file: '02-coating.png', path: '/?step=coat&p=0.62', w: 1440, h: 900 },
  { file: '03-exposure-light-path.png', path: '/?step=expose&p=0.45&lp=1', w: 1440, h: 900 },
  { file: '04-develop-cross-section.png', path: '/?step=develop&view=device&p=1', w: 1440, h: 900, answered: true },
  { file: '05-final-test.png', path: '/?step=final&p=1&in=1', w: 1440, h: 900 },
  { file: '06-wafer-map.png', path: '/?step=probe&p=1', w: 1440, h: 900 },
  { file: '07-mobile-coating.png', path: '/?step=coat&p=0.62', w: 390, h: 844 },
  { file: '08-mobile-final-test.png', path: '/?step=final&p=1', w: 390, h: 844 },
];

async function shoot(browser: Browser, s: (typeof SHOTS)[number]) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.w < 600 ? 2 : 1 });
  await page.addInitScript((answered) => {
    try {
      localStorage.clear();
      if (answered) localStorage.setItem('fab-one:v1', JSON.stringify({ checks: { develop: { choice: 0, correct: true } } }));
    } catch {
      /* ignore */
    }
  }, !!s.answered);
  await page.goto(s.path, { waitUntil: 'networkidle' });
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `docs/screenshots/${s.file}` });
  await page.close();
}

test('capture screenshots', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'captured once, from the desktop project');
  test.setTimeout(300_000);
  for (const s of SHOTS) await shoot(browser, s);
});
