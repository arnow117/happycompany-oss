import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Orchestration } from './Orchestration';
import { api, type WorkflowCase, type WorkflowTimelineEvent } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    listRuntimeCases: vi.fn(),
    getRuntimeCaseTimeline: vi.fn(),
  },
}));

vi.mock('../stores/chat', () => ({
  useChatStore: (selector: (state: { selectedTenant: string; tenants: Array<{ id: string }> }) => unknown) => selector({
    selectedTenant: 'acme-happycompany',
    tenants: [{ id: 'acme-happycompany' }],
  }),
}));

const collaborationCase: WorkflowCase = {
  id: 'acme:web-bot:user-sales:sales-zhangsan:chat-1',
  tenant: 'acme-happycompany',
  sessionId: 'acme:web-bot:user-sales:sales-zhangsan:chat-1',
  entryId: 'web-bot',
  actorId: 'user-sales',
  chatId: 'chat-1',
  state: 'active',
  currentEmployeeId: 'maintenance-lisi',
  participants: ['sales-zhangsan', 'maintenance-lisi'],
  handoffCount: 1,
  toolCallCount: 1,
  lastMessageAt: 1000,
  messageCount: 2,
  preview: '请确认这台设备是否还在维保期',
};

const financeCase: WorkflowCase = {
  ...collaborationCase,
  id: 'acme:web:user-sales:finance-wangwu:chat-2',
  sessionId: 'acme:web:user-sales:finance-wangwu:chat-2',
  chatId: 'chat-2',
  currentEmployeeId: 'finance-wangwu',
  participants: ['sales-zhangsan', 'finance-wangwu'],
  preview: '财务结算协同',
};

const timeline: WorkflowTimelineEvent[] = [
  {
    id: 'm1',
    type: 'user_message',
    at: 900,
    employeeId: 'sales-zhangsan',
    text: '请确认这台设备是否还在维保期',
  },
  {
    id: 'route-1',
    type: 'routing_decision',
    at: 920,
    employeeId: 'sales-zhangsan',
    payload: { selectedEmployee: 'sales-zhangsan' },
  },
  {
    id: 'handoff-1',
    type: 'handoff',
    at: 940,
    employeeId: 'sales-zhangsan',
    fromEmployeeId: 'sales-zhangsan',
    toEmployeeId: 'maintenance-lisi',
    reason: '需要确认设备维保记录',
  },
  {
    id: 'tool-1',
    type: 'tool_call',
    at: 960,
    employeeId: 'maintenance-lisi',
    toolName: 'maintenance.lookup_device',
    status: 'completed',
  },
  {
    id: 'artifact-1',
    type: 'business_artifact',
    at: 980,
    employeeId: 'maintenance-lisi',
    status: 'created',
    artifactType: 'service_record',
    artifactId: 'sr-001',
  },
  {
    id: 'm2',
    type: 'agent_message',
    at: 1000,
    employeeId: 'maintenance-lisi',
    text: '设备仍在维保期内',
  },
];

describe('Orchestration collaboration log page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listRuntimeCases).mockResolvedValue({ cases: [collaborationCase] });
    vi.mocked(api.getRuntimeCaseTimeline).mockResolvedValue({ case: collaborationCase, timeline });
  });

  it('shows collaboration cases and their timeline', async () => {
    render(<Orchestration />);

    expect(await screen.findByText('协同日志')).toBeInTheDocument();
    expect(await screen.findByText('请确认这台设备是否还在维保期')).toBeInTheDocument();
    expect(screen.getAllByText('maintenance-lisi').length).toBeGreaterThan(0);
    expect(await screen.findByText('员工协同')).toBeInTheDocument();
    expect(screen.getAllByText('sales-zhangsan').length).toBeGreaterThan(0);
    expect(screen.getByText(/需要确认设备维保记录/)).toBeInTheDocument();
    expect(screen.getByText('工具 maintenance.lookup_device')).toBeInTheDocument();
    expect(screen.getByText('业务产物')).toBeInTheDocument();
    expect(screen.getByText(/created · service_record · sr-001/)).toBeInTheDocument();
  });

  it('requests collaboration cases without the all-sessions escape hatch', async () => {
    render(<Orchestration />);

    await screen.findByText('请确认这台设备是否还在维保期');
    expect(api.listRuntimeCases).toHaveBeenCalledWith({
      tenant: 'acme-happycompany',
      limit: 100,
    });
    expect(screen.queryByLabelText('显示全部会话')).not.toBeInTheDocument();
  });

  it('keeps the timeline selection inside the filtered case list', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listRuntimeCases).mockResolvedValue({ cases: [collaborationCase, financeCase] });

    render(<Orchestration />);

    await screen.findByText('请确认这台设备是否还在维保期');
    await user.type(screen.getByPlaceholderText('搜索员工、入口或消息'), 'finance');

    expect(await screen.findByText('财务结算协同')).toBeInTheDocument();
    await waitFor(() => expect(api.getRuntimeCaseTimeline).toHaveBeenLastCalledWith(financeCase.id));
    expect(screen.getAllByText('finance-wangwu').length).toBeGreaterThan(0);
  });
});
