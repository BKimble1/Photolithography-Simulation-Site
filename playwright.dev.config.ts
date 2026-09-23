import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Iterate on the e2e specs against the running dev server (npm run dev), without a build. */
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5173' },
  webServer: undefined,
});
