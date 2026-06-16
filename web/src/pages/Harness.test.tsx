import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Harness } from './Harness';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chat';

vi.mock('../lib/api', () => ({
  api: {
    listHarnessCases: vi.fn(),
    getLatestHarnessReport: vi.fn(),
    runHarnessSuite: vi.fn(),
    runHarnessStep: vi.fn(),
    listHarnessStepRuns: vi.fn(),
  },
}));

const caseSummary = {
  id: 'architecture-web-runtime-parity',
  description: 'Web shape should flow through runtime',
  file: 'architecture-web-runtime-parity.yaml',
  input: { channel: 'web', botName: 'sales-zhangsan', tenant: 'acme', userId: 'web-user-001' },
  expect: { routedEmployee: 'sales-zhangsan', noErrors: true },
};

const report = {
  id: 'harness-1',
  createdAt: '2026-05-31T10:00:00.000Z',
  summary: { passed: 1, failed: 0, total: 1 },
  text: '1 passed, 0 failed',
  results: [
    {
      case: {
        id: 'architecture-web-runtime-parity',
        description: 'Web shape should flow through runtime',
        input: { ...caseSummary.input, chatId: 'c1', text: 'hello' },
        expect: caseSummary.expect,
      },
      status: 'passed' as const,
      failures: [],
      ingress: {
        reply: 'Web 入口已通过同一运行时查询浙一医院维保状态。',
        trace: {
          input: { channel: 'web', botName: 'sales-zhangsan', chatId: 'c1' },
          routing: { selectedEmployee: 'sales-zhangsan' },
          toolCalls: [{ name: 'med_crm:global_search', status: 'complete' }],
          memory: [],
          handoffs: [],
          businessArtifacts: [{ type: 'maintenance_schedule', id: 'schedule-1', status: 'created' }],
          errors: [],
          startedAt: 1,
          finishedAt: 2,
        },
      },
    },
  ],
};

describe('Harness page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      tenants: [{ id: 'acme', displayName: '示例医疗' }],
      selectedTenant: 'acme',
    });
    vi.mocked(api.listHarnessCases).mockResolvedValue({
      fixtureDir: 'tests/fixtures/harness',
      cases: [caseSummary],
    });
    vi.mocked(api.getLatestHarnessReport).mockResolvedValue({ report });
    vi.mocked(api.runHarnessSuite).mockResolvedValue({ report });
    vi.mocked(api.runHarnessStep).mockResolvedValue({
      run: {
        id: 'step-2',
        input: {
          workflowRunId: 'manual-acceptance',
          stepId: 'lookup',
          employeeId: 'sales-zhangsan',
          tenant: 'acme',
          userId: 'web-harness-user',
          chatId: 'c2',
          prompt: '查一下浙一医院维保合同',
        },
        status: 'SUCCEEDED',
        createdAt: 3,
        finishedAt: 4,
        reply: 'ok',
        attempts: 0,
      },
    });
    vi.mocked(api.listHarnessStepRuns).mockResolvedValue({
      runs: [{
        id: 'step-1',
        input: {
          workflowRunId: 'workflow-1',
          stepId: 'step-1',
          employeeId: 'sales-zhangsan',
          chatId: 'c1',
          prompt: 'hello',
        },
        status: 'SUCCEEDED',
        createdAt: 1,
        finishedAt: 2,
        reply: 'ok',
        attempts: 0,
      }],
    });
  });

  it('renders cases and latest trace report', async () => {
    render(<Harness />);

    expect(await screen.findByText('验收 Harness')).toBeInTheDocument();
    expect(api.listHarnessCases).toHaveBeenCalledWith('acme');
    expect(screen.getAllByText('architecture-web-runtime-parity').length).toBeGreaterThan(0);
    expect(screen.getAllByText('sales-zhangsan').length).toBeGreaterThan(0);
    expect(screen.getByText('med_crm:global_search')).toBeInTheDocument();
    expect(screen.getByText(/created:maintenance_schedule:schedule-1/)).toBeInTheDocument();
    expect(screen.getByText('长任务 StepRun')).toBeInTheDocument();
    expect(screen.getByText('workflow-1 / step-1')).toBeInTheDocument();
  });

  it('runs the suite from the primary action', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await screen.findAllByText('architecture-web-runtime-parity');
    await user.click(screen.getByRole('button', { name: /运行当前企业/i }));

    await waitFor(() => expect(api.runHarnessSuite).toHaveBeenCalledWith(['architecture-web-runtime-parity']));
    expect(await screen.findByText('单条用例运行完成：1 passed, 0 failed')).toBeInTheDocument();
  });

  it('runs a single StepRun from the page', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await screen.findByDisplayValue('sales-zhangsan');
    await user.click(screen.getByRole('button', { name: /运行 Step/i }));

    await waitFor(() => expect(api.runHarnessStep).toHaveBeenCalledWith(expect.objectContaining({
      workflowRunId: 'manual-acceptance',
      stepId: 'lookup',
      employeeId: 'sales-zhangsan',
      tenant: 'acme',
      prompt: '查一下浙一医院维保合同',
    })));
    expect(await screen.findByText('StepRun SUCCEEDED: manual-acceptance / lookup')).toBeInTheDocument();
    expect(screen.getByText('manual-acceptance / lookup')).toBeInTheDocument();
  });
});
