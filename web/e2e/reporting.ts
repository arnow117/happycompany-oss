import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

export interface JourneyReportOptions {
  slug: string;
  title: string;
  note?: string;
}

export interface JourneyCaptureOptions {
  note?: string;
  fullPage?: boolean;
  artifactPath?: string;
}

export interface JourneyStep {
  id: string;
  title: string;
  screenshotPath: string;
  note?: string;
}

export interface JourneySummary {
  status?: 'passed' | 'failed' | 'partial';
  notes?: string[];
}

export interface JourneyReport {
  outputDir: string;
  steps: readonly JourneyStep[];
  capture(page: Page, id: string, title: string, options?: JourneyCaptureOptions): Promise<string>;
  writeSummary(summary?: JourneySummary): Promise<void>;
}

function safeSegment(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return normalized.replace(/^-+|-+$/g, '') || 'journey';
}

function markdownEscape(value: string): string {
  return value.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

export function createJourneyReport(testInfo: TestInfo, options: JourneyReportOptions): JourneyReport {
  const outputDir = testInfo.outputPath(`journey-${safeSegment(options.slug)}`);
  const steps: JourneyStep[] = [];
  mkdirSync(outputDir, { recursive: true });

  return {
    outputDir,
    steps,
    async capture(page, id, title, captureOptions) {
      const index = String(steps.length + 1).padStart(2, '0');
      const fileName = `${index}-${safeSegment(id)}.png`;
      const screenshotPath = path.join(outputDir, fileName);
      await page.screenshot({
        path: screenshotPath,
        fullPage: captureOptions?.fullPage ?? true,
      });
      if (captureOptions?.artifactPath) {
        mkdirSync(path.dirname(captureOptions.artifactPath), { recursive: true });
        copyFileSync(screenshotPath, captureOptions.artifactPath);
      }
      steps.push({
        id,
        title,
        screenshotPath,
        note: captureOptions?.note,
      });
      await testInfo.attach(`${index} ${title}`, {
        path: screenshotPath,
        contentType: 'image/png',
      });
      return screenshotPath;
    },
    async writeSummary(summary) {
      const manifest = {
        title: options.title,
        slug: options.slug,
        note: options.note,
        status: summary?.status ?? 'passed',
        notes: summary?.notes ?? [],
        steps,
      };
      const manifestPath = path.join(outputDir, 'manifest.json');
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const markdown = [
        `# ${options.title}`,
        '',
        options.note ? options.note : '',
        '',
        `Status: ${manifest.status}`,
        '',
        ...manifest.notes.map((note) => `- ${note}`),
        manifest.notes.length > 0 ? '' : '',
        ...steps.map((step, index) => {
          const imageName = path.basename(step.screenshotPath);
          const note = step.note ? `\n\n${step.note}` : '';
          return `## ${index + 1}. ${markdownEscape(step.title)}\n\n![${markdownEscape(step.title)}](./${imageName})${note}`;
        }),
      ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '');

      const summaryPath = path.join(outputDir, 'summary.md');
      writeFileSync(summaryPath, markdown.join('\n'));
      await testInfo.attach('Journey summary', {
        path: summaryPath,
        contentType: 'text/markdown',
      });
      await testInfo.attach('Journey manifest', {
        path: manifestPath,
        contentType: 'application/json',
      });
    },
  };
}
