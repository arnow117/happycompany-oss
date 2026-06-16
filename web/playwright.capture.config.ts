import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

// One-off config to regenerate README/docs screenshots from the de-identified
// demo tenant. Reuses the base webServer (vite dev + backend on config.e2e.json)
// and globalSetup (seed-e2e), but only runs the capture spec.
export default defineConfig({
  ...baseConfig,
  testMatch: ['**/capture-readme/**/*.spec.ts'],
  reporter: [['list']],
  use: {
    ...baseConfig.use,
    screenshot: 'off',
    viewport: { width: 1440, height: 900 },
  },
});
