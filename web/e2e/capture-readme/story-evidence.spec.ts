import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Regenerates the E2E Story Review "screenshot evidence" against the
// de-identified demo tenant (corp/acme · 示例医疗), so docs/reports/
// e2e-story-review-assets/ never shows a real customer name. The story report
// generator (npm run e2e:story-report) embeds whatever PNGs live in that dir.
const assetsDir = path.resolve(import.meta.dirname, '..', '..', '..', 'docs', 'reports', 'e2e-story-review-assets');

const PAGES: Array<{ route: string; file: string }> = [
  { route: '/', file: '01-dashboard.png' },
  { route: '/employees', file: '02-employee-network.png' },
  { route: '/agent-builder', file: '03-agent-builder.png' },
  { route: '/people', file: '04-people-binding.png' },
  { route: '/skills-marketplace', file: '05-skills-marketplace.png' },
  { route: '/orchestration', file: '06-orchestration.png' },
  { route: '/sessions', file: '07-sessions.png' },
  { route: '/harness', file: '08-harness.png' },
  { route: '/chat', file: '09-chat.png' },
  { route: '/memory', file: '10-memory.png' },
  { route: '/knowledge', file: '11-knowledge-base.png' },
];

test('capture E2E story-review evidence from the de-identified UI', async ({ page }) => {
  mkdirSync(assetsDir, { recursive: true });
  for (const { route, file } of PAGES) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.getByText('HappyCompany').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(assetsDir, file), fullPage: true });
  }
});
