import { test, expect } from '@playwright/test';
import { createJourneyReport } from '../reporting';
import { probeHarnessCase, probeHarnessStepRun, setupProbeConsole } from '../probe-helpers';

test('captures harness acceptance journey', async ({ page }, testInfo) => {
  const report = createJourneyReport(testInfo, {
    slug: 'harness-acceptance',
    title: 'Harness Acceptance Journey',
    note: '展示用例驱动验收入口、Trace 报告、Suite 运行和长任务 StepRun。',
  });

  await setupProbeConsole(page);

  await page.goto('/harness');
  await expect(page.getByRole('heading', { name: '验收 Harness' })).toBeVisible();
  await expect(page.getByText(probeHarnessCase.id).first()).toBeVisible();
  await expect(page.getByText('Cases')).toBeVisible();
  await expect(page.getByText('Passed', { exact: true })).toBeVisible();
  await report.capture(page, 'harness-overview', 'Harness 验收入口概览');

  await expect(page.getByRole('heading', { name: 'Trace 报告' })).toBeVisible();
  await expect(page.getByText('maintenance_records:lookup').first()).toBeVisible();
  await expect(page.getByText('sales-zhangsan->maintenance-lisi')).toBeVisible();
  await report.capture(page, 'trace-report', 'Trace 报告展示路由、工具和 handoff');

  await page.getByRole('button', { name: /运行当前企业/ }).click();
  await expect(page.getByText(/用例运行完成：1 passed, 0 failed/)).toBeVisible();
  await report.capture(page, 'suite-run', '运行当前企业 Harness 用例');

  await expect(page.getByText('长任务 StepRun')).toBeVisible();
  await page.getByRole('button', { name: /运行 Step/ }).click();
  await expect(page.getByText(`StepRun passed: ${probeHarnessStepRun.input.workflowRunId} / ${probeHarnessStepRun.input.stepId}`)).toBeVisible();
  await expect(page.getByText(`${probeHarnessStepRun.input.workflowRunId} / ${probeHarnessStepRun.input.stepId}`).first()).toBeVisible();
  await report.capture(page, 'step-run', '运行长任务 StepRun');

  await report.writeSummary({
    status: 'passed',
    notes: [
      '验证 Harness 页面可以展示验收用例、Trace 报告、Suite 运行反馈和 StepRun 结果。',
      '本 Journey 作为 release/demo 时的验收报告截图链路。',
    ],
  });
});
