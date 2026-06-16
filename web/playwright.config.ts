import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

function readPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const webPort = readPort('HAPPYCOMPANY_WEB_PORT', 8888);
const apiPort = readPort('HAPPYCOMPANY_API_PORT', 3100);
const profileName = process.env.HAPPYCOMPANY_PROFILE?.trim();
const configPath = process.env.HAPPYCOMPANY_CONFIG?.trim();
const backendConfigArgs = configPath
  ? `--config ${quoteShellArg(configPath)}`
  : profileName
    ? `--profile ${quoteShellArg(profileName)}`
    : 'config.e2e.json';

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  outputDir: './e2e/__screenshots__',
  testMatch: ['**/story-v2-*/**/*.spec.ts', '**/story-q-*/**/*.spec.ts', '**/story-h-*/**/*.spec.ts', '**/story-config-page/**/*.spec.ts', '**/story-bootstrap/**/*.spec.ts'],
  use: {
    baseURL: `http://localhost:${webPort}`,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      port: webPort,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npx tsx src/index.ts ${backendConfigArgs}`,
      cwd: path.resolve(import.meta.dirname, '..'),
      port: apiPort,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
