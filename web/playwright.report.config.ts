import { mkdirSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

mkdirSync('playwright-report/journeys', { recursive: true });

export default defineConfig({
  ...baseConfig,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/journeys', open: 'never' }],
  ],
  outputDir: './e2e/__journey-output__',
  testMatch: [
    '**/journey-*/**/*.spec.ts',
  ],
  use: {
    ...baseConfig.use,
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
});
