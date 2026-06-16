import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const today = new Date().toISOString().slice(0, 10);
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
const outputPath = path.resolve(repoRoot, outputArg?.slice('--output='.length) || `docs/reports/${today}-e2e-story-review.generated.html`);

const suiteRoots = [
  { type: 'Mainline', prefix: 'story-', dir: 'web/e2e' },
  { type: 'Journey', prefix: 'journey-', dir: 'web/e2e' },
  { type: 'Probe', prefix: 'probe-', dir: 'web/e2e' },
];

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function pathExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listSuites() {
  const e2eDir = path.join(repoRoot, 'web/e2e');
  const entries = await readdir(e2eDir, { withFileTypes: true });
  const suites = [];

  for (const root of suiteRoots) {
    const dirs = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(root.prefix))
      .map((entry) => entry.name)
      .sort();

    for (const dir of dirs) {
      const specFiles = await readdir(path.join(repoRoot, root.dir, dir))
        .then((items) => items.filter((item) => item.endsWith('.spec.ts')))
        .catch(() => []);
      let testCount = 0;
      for (const specFile of specFiles) {
        const source = await readFile(path.join(repoRoot, root.dir, dir, specFile), 'utf8');
        testCount += source.match(/\btest(?:\.(?:only|skip|fixme))?\(/g)?.length || 0;
      }
      suites.push({ type: root.type, dir, testCount });
    }
  }

  return suites;
}

function parseField(markdown, label) {
  const match = markdown.match(new RegExp(`- \\*\\*${label}\\*\\*: (.+)`));
  return match?.[1]?.trim() || '';
}

async function listStoryCards() {
  const cardsDir = path.join(repoRoot, 'docs/specs/e2e-story-cards');
  const entries = await readdir(cardsDir, { withFileTypes: true }).catch(() => []);
  const cards = [];

  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name))) {
    const markdown = await readFile(path.join(cardsDir, entry.name), 'utf8');
    cards.push({
      file: entry.name,
      name: parseField(markdown, 'Name') || entry.name.replace(/^\d+-/, '').replace(/\.md$/, ''),
      status: parseField(markdown, 'Status') || 'Unknown',
      user: parseField(markdown, 'User'),
      goal: parseField(markdown, 'Business goal'),
      mainline: parseField(markdown, 'Mainline coverage'),
      probe: parseField(markdown, 'Probe coverage'),
    });
  }

  return cards;
}

async function listGaps() {
  const matrixPath = path.join(repoRoot, 'docs/specs/2026-06-04-e2e-coverage-matrix.md');
  if (!await pathExists(matrixPath)) return [];
  const matrix = await readFile(matrixPath, 'utf8');
  return matrix
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.includes('Product Story') && !line.includes('---'))
    .map((line) => line.split('|').map((part) => part.trim()).filter(Boolean))
    .filter((cols) => cols.length >= 6 && /Missing|Partial|Probe only|Mainline only/i.test(cols[4]))
    .map((cols) => ({ story: cols[0], status: cols[4], next: cols[5] }));
}

async function listScreenshots() {
  const assetsDir = path.join(repoRoot, 'docs/reports/e2e-story-review-assets');
  const entries = await readdir(assetsDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => `e2e-story-review-assets/${entry.name}`)
    .sort();
}

function renderSuiteSummary(suites) {
  const totals = suites.reduce((sum, suite) => sum + suite.testCount, 0);
  const byType = suiteRoots.map((root) => ({
    type: root.type,
    stories: suites.filter((suite) => suite.type === root.type).length,
    tests: suites.filter((suite) => suite.type === root.type).reduce((sum, suite) => sum + suite.testCount, 0),
  }));
  return {
    totals,
    html: byType.map((item) => `
      <article class="metric">
        <strong>${item.tests}</strong>
        <span>${item.type}: ${item.stories} stories/routes</span>
      </article>`).join('\n'),
  };
}

function renderHtml({ suites, cards, gaps, screenshots }) {
  const summary = renderSuiteSummary(suites);
  const storyCards = cards.map((card) => `
    <article class="story">
      <div class="tags"><span class="tag">${escapeHtml(card.status)}</span><span class="tag">${escapeHtml(card.file)}</span></div>
      <h3>${escapeHtml(card.name)}</h3>
      <p>${escapeHtml(card.goal || card.user || '未填写产品目标')}</p>
      <ul class="checks">
        <li>Mainline: ${escapeHtml(card.mainline || '未标注')}</li>
        <li>Probe: ${escapeHtml(card.probe || '未标注')}</li>
      </ul>
    </article>`).join('\n');
  const gapCards = gaps.map((gap) => `
    <article class="note">
      <h3>${escapeHtml(gap.story)}</h3>
      <p>${escapeHtml(gap.status)} · ${escapeHtml(gap.next)}</p>
    </article>`).join('\n') || '<article class="note"><h3>暂无显式缺口</h3><p>覆盖矩阵未列出 Partial/Missing 项。</p></article>';
  const screenshotGrid = screenshots.length
    ? `<div class="screenshots">${screenshots.map((src) => `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(path.basename(src))}"><figcaption>${escapeHtml(path.basename(src))}</figcaption></figure>`).join('\n')}</div>`
    : '<div class="note"><p>没有找到稳定截图资产。运行 Journey 后可把关键截图复制到 docs/reports/e2e-story-review-assets/。</p></div>';
  const suiteRows = suites.map((suite) => `<tr><td>${escapeHtml(suite.type)}</td><td>${escapeHtml(suite.dir)}</td><td>${suite.testCount}</td></tr>`).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HappyCompany E2E Story Review ${today}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #191916; background: #fbfaf7; line-height: 1.55; }
    header { padding: 48px 6vw 28px; background: #e8edf0; border-bottom: 1px solid #d6dde1; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 32px 64px; }
    h1 { margin: 10px 0 0; font-size: clamp(32px, 5vw, 56px); line-height: 1.05; letter-spacing: 0; }
    h2 { margin: 42px 0 16px; font-size: 25px; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 18px; letter-spacing: 0; }
    p { margin: 0; }
    .lead { margin-top: 18px; max-width: 900px; color: #3d3932; font-size: 18px; }
    .pill, .tag { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border-radius: 999px; background: #fff; border: 1px solid #d6dde1; font-size: 13px; font-weight: 650; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: -24px; }
    .metric, .story, .note { padding: 18px; border: 1px solid #d6dde1; border-radius: 8px; background: #fff; }
    .metric strong { display: block; font-size: 34px; line-height: 1; margin-bottom: 10px; }
    .metric span, .story p, .note p, td, th { color: #68635b; font-size: 14px; }
    .story-grid, .note-grid, .screenshots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .checks { margin: 10px 0 0; padding-left: 19px; font-size: 14px; }
    figure { margin: 0; border: 1px solid #d6dde1; border-radius: 8px; overflow: hidden; background: #fff; }
    figure img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-bottom: 1px solid #d6dde1; }
    figcaption { padding: 10px 12px; color: #68635b; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d6dde1; border-radius: 8px; overflow: hidden; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #d6dde1; }
    th { color: #191916; }
    @media (max-width: 880px) { main { padding: 24px 16px 48px; } .summary, .story-grid, .note-grid, .screenshots { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <span class="pill">${today}</span>
    <h1>HappyCompany E2E Story Review</h1>
    <p class="lead">按产品故事整理当前 Web E2E 覆盖。当前扫描到 ${suites.length} 个故事/路线，${summary.totals} 条测试。运行结果请结合最新 Playwright 输出确认。</p>
  </header>
  <main>
    <section class="summary">
      <article class="metric"><strong>${summary.totals}</strong><span>Total tests discovered from specs</span></article>
      ${summary.html}
    </section>
    <section>
      <h2>产品故事地图</h2>
      <div class="story-grid">${storyCards}</div>
    </section>
    <section>
      <h2>截图证据</h2>
      ${screenshotGrid}
    </section>
    <section>
      <h2>故事/路线清单</h2>
      <table><thead><tr><th>Type</th><th>Directory</th><th>Tests</th></tr></thead><tbody>${suiteRows}</tbody></table>
    </section>
    <section>
      <h2>还没有覆盖什么</h2>
      <div class="note-grid">${gapCards}</div>
    </section>
  </main>
</body>
</html>`;
}

const suites = await listSuites();
const cards = await listStoryCards();
const gaps = await listGaps();
const screenshots = await listScreenshots();
await writeFile(outputPath, renderHtml({ suites, cards, gaps, screenshots }));
console.log(`Generated ${path.relative(repoRoot, outputPath)}`);
