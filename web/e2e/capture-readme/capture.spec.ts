import { test } from '@playwright/test';
import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';

// Regenerates the README / docs screenshots against the de-identified demo
// tenant (corp/acme · 示例医疗). Runs against the real seeded e2e backend
// (development auth mode = open), so the captured UI never shows a real
// customer name. Writes to both docs/screenshots and web/docs/screenshots.
const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const webDocs = path.resolve(import.meta.dirname, '..', '..', 'docs', 'screenshots');
const repoDocs = path.join(repoRoot, 'docs', 'screenshots');

const PAGES: Array<{ route: string; file: string }> = [
  { route: '/', file: '01-dashboard.png' },
  { route: '/employees', file: '02-apps.png' },
  { route: '/people', file: '03-stats.png' },
  { route: '/skills-marketplace', file: '04-skills.png' },
  { route: '/orchestration', file: '05-insights.png' },
  { route: '/memory', file: '06-knowledge-base.png' },
];

test('capture README screenshots from the de-identified UI', async ({ page }) => {
  mkdirSync(webDocs, { recursive: true });
  mkdirSync(repoDocs, { recursive: true });

  for (const { route, file } of PAGES) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    // Sidebar brand renders on every authed page; wait for it, then let the
    // page settle (metrics, lists, charts) before the full-page capture.
    await page.getByText('HappyCompany').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1500);
    const target = path.join(webDocs, file);
    await page.screenshot({ path: target, fullPage: true });
    copyFileSync(target, path.join(repoDocs, file));
  }
});
