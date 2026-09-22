import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Regenerates docs/screenshots from the production build: npm run screenshots */
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ['**/screenshots.spec.ts'],
  projects: base.projects?.filter((p) => p.name === 'desktop'),
});
