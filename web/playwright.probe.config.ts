import { mkdirSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

mkdirSync('playwright-report/probes', { recursive: true });

export default defineConfig({
  ...baseConfig,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/probes', open: 'never' }],
  ],
  outputDir: './e2e/__probe-output__',
  testMatch: [
    '**/probe-*/**/*.spec.ts',
  ],
  use: {
    ...baseConfig.use,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
