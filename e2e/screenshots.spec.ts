import { expect, test, type Browser } from '@playwright/test';

/**
 * Regenerates the round-two screenshots in docs/screenshots/round2 (run: npm run screenshots).
 * The names of the first eight match docs/screenshots/round1 for before/after comparison.
 * ?p= freezes a lesson at a given progress; ?watch&t= opens the film paused at a time.
 */
const SHOTS: { file: string; path: string; w: number; h: number; answered?: boolean; wait?: number }[] = [
  { file: 'home-1440x900.png', path: '/', w: 1440, h: 900 },
  { file: 'home-1280x640.png', path: '/', w: 1280, h: 640 },
  { file: 'home-1024x600.png', path: '/', w: 1024, h: 600 },
  { file: 'home-768x1024.png', path: '/', w: 768, h: 1024 },
  { file: 'home-phone-390x844.png', path: '/', w: 390, h: 844 },
  { file: 'home-phone-landscape-844x390.png', path: '/', w: 844, h: 390 },
  { file: 'home-1920x640-overlap.png', path: '/', w: 1920, h: 640 },
  { file: 'home-1440x560-overlap.png', path: '/', w: 1440, h: 560 },
  { file: 'learn-coat-1440x900.png', path: '/?step=coat&p=0.35', w: 1440, h: 900 },
  { file: 'learn-develop-device-1440x900.png', path: '/?step=develop&p=1', w: 1440, h: 900, answered: true },
  { file: 'learn-coat-phone.png', path: '/?step=coat&p=0.35', w: 390, h: 844 },
  { file: 'learn-expose-light-path-1440x900.png', path: '/?step=expose&p=0.45&lp=1', w: 1440, h: 900 },
  { file: 'learn-gate-etch-1440x900.png', path: '/?step=gate-etch&p=0.55', w: 1440, h: 900 },
  { file: 'learn-sti-etch-plasma-1440x900.png', path: '/?step=sti-etch&p=0.62', w: 1440, h: 900 },
  { file: 'learn-contact-fill-polish-1440x900.png', path: '/?step=contact-fill&p=0.65', w: 1440, h: 900 },
  { file: 'learn-final-test-1440x900.png', path: '/?step=final&p=1&in=1', w: 1440, h: 900 },
  { file: 'learn-chapters-1440x900.png', path: '/?step=develop&p=1&panel=chapters', w: 1440, h: 900, answered: true },
  { file: 'explore-overview-1440x900.png', path: '/?explore', w: 1440, h: 900 },
  { file: 'explore-etch-1440x900.png', path: '/?explore=etch', w: 1440, h: 900 },
  { file: 'explore-scanner-demo-1440x900.png', path: '/?explore=scanner&demo=1', w: 1440, h: 900, wait: 9000 },
  { file: 'explore-phone.png', path: '/?explore=track', w: 390, h: 844 },
  { file: 'watch-expose-1440x900.png', path: '/?watch&t=303', w: 1440, h: 900 },
  { file: 'watch-phone.png', path: '/?watch&t=303', w: 390, h: 844 },
];

async function shoot(browser: Browser, s: (typeof SHOTS)[number]) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.w < 600 ? 2 : 1, isMobile: s.w < 600, hasTouch: s.w < 600 });
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
  await page.waitForTimeout(s.wait ?? 7000);
  await page.screenshot({ path: `docs/screenshots/round2/${s.file}`, timeout: 120_000 });
  await page.close();
}

test('capture screenshots', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'captured once, from the desktop project');
  test.setTimeout(1_200_000);
  for (const s of SHOTS) await shoot(browser, s);
});
