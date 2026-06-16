import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentBuilder } from './AgentBuilder';
import { api, type AgentBuilderDraft } from '../lib/api';
import { useChatStore } from '../stores/chat';

vi.mock('../lib/api', () => ({
  api: {
    listAgentBuilderDrafts: vi.fn(),
    getAgentBuilderOptions: vi.fn(),
    listRuntimeEntries: vi.fn(),
    listTenants: vi.fn(),
    listTemplates: vi.fn(),
    listEmployees: vi.fn(),
    getAgentBuilderDraftCapabilities: vi.fn(),
    createAgentBuilderDraft: vi.fn(),
    updateAgentBuilderDraft: vi.fn(),
    validateAgentBuilderDraft: vi.fn(),
    testAgentBuilderDraft: vi.fn(),
    sendAgentBuilderSandboxMessage: vi.fn(),
    publishAgentBuilderDraft: vi.fn(),
  },
}));

const employee = {
  id: 'maintenance-qa',
  displayName: '售后质检员工',
  description: '检查维修工单质量',
  model: 'claude-sonnet-4-6',
  systemPrompt: '你是售后质检员工',
  tools: ['med_crm:list_maintenance'],
  skills: ['med_crm'],
  role: 'maintenance',
  capabilities: ['质检'],
  workspace: 'agents/maintenance-qa',
  source: 'generated' as const,
  createdAt: 1,
  hasFallbackLevel1: false,
  hasFallbackLevel2: false,
  toolCount: 1,
  skillCount: 1,
  allowedTargets: ['finance-wangwu'],
};

const draft: AgentBuilderDraft = {
  id: 'natural-language-maintenance-qa',
  tenant: 'builder-demo',
  source: 'natural_language',
  status: 'draft',
  createdAt: 1,
  updatedAt: 1,
  input: { naturalLanguage: '创建一个售后质检员工' },
  employee,
  validation: { ok: false, issues: [] },
};

const sandbox = {
  lastSessionId: 'builder-demo:builder_sandbox:natural-language-maintenance-qa:builder-web:builder-natural-language-maintenance-qa',
  lastResult: 'passed' as const,
  reply: '沙盒回复',
  testedAt: 2,
  fingerprint: 'fingerprint',
};

describe('AgentBuilder page', () => {
  beforeEach(() => {
    useChatStore.setState({
      tenants: [],
      selectedTenant: '',
    });
    vi.mocked(api.listAgentBuilderDrafts).mockResolvedValue({ drafts: [] });
    vi.mocked(api.getAgentBuilderOptions).mockResolvedValue({
      tenant: 'builder-demo',
      skills: [{ name: 'med_crm', displayName: '医疗 CRM', description: '医疗设备服务工具', toolCount: 2 }],
      tools: [
        { name: 'med_crm:list_maintenance', appName: 'med_crm', description: '查询维保合同', riskLevel: 'read' },
        { name: 'med_crm:add_incident', appName: 'med_crm', description: '新增维修工单', riskLevel: 'internal_write' },
      ],
      employees: [
        { id: 'finance-wangwu', displayName: '财务王五', role: 'finance', workspace: 'agents/finance-wangwu' },
        { id: 'maintenance-lisi', displayName: '维修李四', role: 'maintenance', workspace: 'agents/maintenance-lisi' },
      ],
    });
    vi.mocked(api.listTenants).mockResolvedValue({ tenants: [{ id: 'builder-demo', displayName: 'Builder Demo' }] });
    vi.mocked(api.listTemplates).mockResolvedValue({ templates: [{ id: 'med-device', name: '医疗器械', description: '', employeeCount: 1 }] });
    vi.mocked(api.listEmployees).mockResolvedValue({ employees: [employee] });
    vi.mocked(api.getAgentBuilderDraftCapabilities).mockResolvedValue({
      capability: {
        tenant: 'builder-demo',
        employeeId: employee.id,
        displayName: employee.displayName,
        role: employee.role,
        workspace: { relative: employee.workspace, absolute: `/tmp/${employee.workspace}`, hasClaudeMd: false },
        promptSource: { yamlSystemPrompt: true, workspaceClaudeMd: false },
        capabilities: employee.capabilities,
        skills: [{ name: 'med_crm', displayName: '医疗 CRM', description: '', installed: true, toolCount: 2, allowed: true }],
        tools: [{ name: 'med_crm:list_maintenance', appName: 'med_crm', description: '', riskLevel: 'read', registered: true, allowed: true }],
        handoffTargets: [{ employeeId: 'finance-wangwu', displayName: '财务王五', exists: true }],
        mcpBoundary: { platformMcpVisible: true, businessMcpDirectVisible: false, businessInterface: 'run_skill' },
        summary: { skillCount: 1, toolCount: 1, allowedToolCount: 1, highRiskToolCount: 0, handoffTargetCount: 1, warningCount: 0 },
        warnings: [],
      },
    });
    vi.mocked(api.createAgentBuilderDraft).mockResolvedValue({ draft });
    vi.mocked(api.listRuntimeEntries).mockResolvedValue({ entries: [] });
    vi.mocked(api.updateAgentBuilderDraft).mockImplementation(async (_id, next) => ({ draft: next }));
    vi.mocked(api.validateAgentBuilderDraft).mockResolvedValue({
      draft: { ...draft, status: 'validated', validation: { ok: true, issues: [] } },
      validation: { ok: true, issues: [] },
    });
    vi.mocked(api.testAgentBuilderDraft).mockResolvedValue({
      draft: { ...draft, status: 'tested', validation: { ok: true, issues: [] }, harness: { yaml: 'id: builder', lastResult: 'passed', failures: [] } },
      result: { status: 'passed', failures: [] },
    });
    vi.mocked(api.sendAgentBuilderSandboxMessage).mockResolvedValue({
      draft: {
        ...draft,
        status: 'tested',
        validation: { ok: true, issues: [] },
        harness: { yaml: 'id: builder', lastResult: 'passed', failures: [] },
        sandbox,
      },
      session: {
        id: sandbox.lastSessionId,
        tenant: 'builder-demo',
        entryId: 'builder-sandbox:natural-language-maintenance-qa',
        channel: 'builder_sandbox',
        actorId: 'builder-web',
        chatId: 'builder-natural-language-maintenance-qa',
        employeeId: 'maintenance-qa',
        instanceId: 'builder-demo:builder-web:draft:natural-language-maintenance-qa',
        workdir: '/tmp/builder-sandbox',
        sdkSessionScope: sandbox.lastSessionId,
        mode: 'builder_sandbox',
        createdAt: 1,
        updatedAt: 2,
      },
      reply: '沙盒回复',
    });
    vi.mocked(api.publishAgentBuilderDraft).mockResolvedValue({
      draft: { ...draft, status: 'published', validation: { ok: true, issues: [] } },
      yamlPath: '/tmp/maintenance-qa.yaml',
      workspacePath: '/tmp/agents/maintenance-qa',
      colonyRegistered: true,
    });
  });

  it('creates a natural-language draft and shows structured fields', async () => {
    const user = userEvent.setup();
    render(<AgentBuilder />);

    expect(await screen.findByText('数字员工 Builder')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /生成草稿/i }));

    await waitFor(() => expect(api.createAgentBuilderDraft).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'builder-demo',
      source: 'natural_language',
    })));
    expect(await screen.findByDisplayValue('售后质检员工')).toBeInTheDocument();
    expect(screen.getByText('agents/maintenance-qa')).toBeInTheDocument();
  });

  it('defaults the builder tenant from runtime entries instead of directory order', async () => {
    vi.mocked(api.listTenants).mockResolvedValue({
      tenants: [
        { id: 'acme-demo', displayName: 'Acme Demo' },
        { id: 'acme-happycompany', displayName: '示例医疗' },
      ],
    });
    vi.mocked(api.listRuntimeEntries).mockResolvedValue({
      entries: [{
        id: 'web-bot',
        tenant: 'acme-happycompany',
        channel: 'web',
        displayName: 'Web Entry',
        routingMode: 'employee-director',
        enabled: true,
      }],
    });
    render(<AgentBuilder />);

    await waitFor(() => expect(api.getAgentBuilderOptions).toHaveBeenCalledWith('acme-happycompany'));
    expect(screen.queryByLabelText('租户')).not.toBeInTheDocument();
    expect(screen.getByText('当前企业')).toBeInTheDocument();
    expect(screen.getByText('示例医疗')).toBeInTheDocument();
  });

  it('starts a fresh build flow without being pinned to the existing draft', async () => {
    const user = userEvent.setup();
    const newDraft: AgentBuilderDraft = {
      ...draft,
      id: 'natural-language-new-sales',
      employee: {
        ...employee,
        id: 'sales-followup',
        displayName: '销售跟进员工',
        workspace: 'agents/sales-followup',
      },
    };
    vi.mocked(api.listAgentBuilderDrafts).mockResolvedValue({ drafts: [draft] });
    vi.mocked(api.createAgentBuilderDraft).mockResolvedValueOnce({ draft: newDraft });
    render(<AgentBuilder />);

    await screen.findByDisplayValue('售后质检员工');
    await user.click(screen.getByRole('button', { name: /新建构建/ }));

    expect(screen.queryByText('agents/maintenance-qa')).not.toBeInTheDocument();
    expect(screen.getByText('当前是新建构建流。左侧构建会话里仍然保留了历史草稿，可以随时切回继续。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /售后质检员工/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /售后质检员工/ }));
    expect(await screen.findByText('agents/maintenance-qa')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /新建构建/ }));

    await user.type(screen.getByLabelText('需求'), '创建一个销售跟进员工');
    await user.click(screen.getByRole('button', { name: /生成草稿/i }));

    await waitFor(() => expect(api.createAgentBuilderDraft).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'builder-demo',
      source: 'natural_language',
      prompt: '创建一个销售跟进员工',
    })));
    expect(await screen.findByDisplayValue('销售跟进员工')).toBeInTheDocument();
    expect(screen.getByText('agents/sales-followup')).toBeInTheDocument();
  });

  it('runs validation, harness test, and publish from the review panel', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listAgentBuilderDrafts).mockResolvedValue({ drafts: [draft] });
    render(<AgentBuilder />);

    await screen.findByDisplayValue('售后质检员工');
    expect(await screen.findByText('能力装配摘要')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^校验$/i }));
    await waitFor(() => expect(api.validateAgentBuilderDraft).toHaveBeenCalledWith(draft.id));

    await user.click(screen.getByRole('button', { name: /^测试$/i }));
    await waitFor(() => expect(api.testAgentBuilderDraft).toHaveBeenCalledWith(draft.id));

    await user.click(screen.getByRole('button', { name: /^沙盒试聊$/i }));
    await waitFor(() => expect(api.sendAgentBuilderSandboxMessage).toHaveBeenCalledWith(draft.id, expect.objectContaining({
      actorId: 'builder-web',
    })));

    await user.click(screen.getByRole('button', { name: /^发布$/i }));
    await screen.findByRole('dialog', { name: '发布确认' });
    await user.click(screen.getByRole('button', { name: /^确认发布$/i }));
    await waitFor(() => expect(api.publishAgentBuilderDraft).toHaveBeenCalledWith(draft.id));
    expect(await screen.findByText(/发布成功：maintenance-qa/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '绑定人员' })).toHaveAttribute('href', '/people');
  });

  it('sends sandbox messages through the builder runtime API', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listAgentBuilderDrafts).mockResolvedValue({ drafts: [draft] });
    render(<AgentBuilder />);

    await screen.findByDisplayValue('售后质检员工');
    const sandboxInput = screen.getByDisplayValue('帮我检查这张维修工单是否可以关闭');
    await user.clear(sandboxInput);
    await user.type(sandboxInput, '测试一下草稿回复');
    await user.click(screen.getByRole('button', { name: /^沙盒试聊$/i }));

    await waitFor(() => expect(api.sendAgentBuilderSandboxMessage).toHaveBeenCalledWith(draft.id, {
      actorId: 'builder-web',
      chatId: `builder-${draft.id}`,
      text: '测试一下草稿回复',
    }));
    expect(await screen.findByText('沙盒回复')).toBeInTheDocument();
    expect(screen.getByText(/builder-demo:builder_sandbox/)).toBeInTheDocument();
    expect(screen.getByText('/tmp/builder-sandbox')).toBeInTheDocument();
  });

  it('returns a tested sandbox draft to the configuration stage', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listAgentBuilderDrafts).mockResolvedValue({
      drafts: [{
        ...draft,
        status: 'tested',
        validation: { ok: true, issues: [] },
        harness: { yaml: 'id: builder', lastResult: 'passed', failures: [] },
        sandbox,
      }],
    });
    render(<AgentBuilder />);

    await screen.findByDisplayValue('售后质检员工');
    expect(screen.getByRole('button', { name: /^发布$/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /^返回配置$/i }));

    await waitFor(() => expect(api.updateAgentBuilderDraft).toHaveBeenCalledWith(draft.id, expect.objectContaining({
      status: 'draft',
      harness: undefined,
      sandbox: undefined,
      validation: { ok: false, issues: [] },
    })));
    expect(await screen.findByText('已返回配置阶段')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^发布$/i })).toBeDisabled();
  });

  it('uses structured selectors and marks tested drafts dirty after edits', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listAgentBuilderDrafts).mockResolvedValue({
      drafts: [{
        ...draft,
        status: 'tested',
        validation: { ok: true, issues: [] },
        harness: { yaml: 'id: builder', lastResult: 'passed', failures: [] },
        sandbox,
      }],
    });
    render(<AgentBuilder />);

    await screen.findAllByText('医疗 CRM');
    expect(screen.getByText('医疗设备服务工具')).toBeInTheDocument();
    expect(screen.getByText('查询维保合同')).toBeInTheDocument();
    expect(screen.getByText('新增维修工单')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Tools$/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^发布$/i })).toBeEnabled();

    await user.click(screen.getByLabelText(/新增维修工单/));
    expect(screen.getByRole('button', { name: /^发布$/i })).toBeDisabled();
    expect(screen.queryByText('模拟 Harness passed')).not.toBeInTheDocument();
  });

  it('removes unknown tools without falling back to free text editing', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listAgentBuilderDrafts).mockResolvedValue({
      drafts: [{
        ...draft,
        employee: { ...draft.employee, tools: ['med_crm:missing_tool'] },
        validation: { ok: false, issues: [{ severity: 'error', field: 'employee.tools', message: 'Tool is not registered: med_crm:missing_tool' }] },
      }],
    });
    render(<AgentBuilder />);

    await screen.findByText('未知 Tools');
    await user.click(screen.getByRole('button', { name: '移除 med_crm:missing_tool' }));
    await user.click(screen.getByLabelText(/查询维保合同/));

    await waitFor(() => expect(screen.queryByText('未知 Tools')).not.toBeInTheDocument());
    expect(screen.getByLabelText(/查询维保合同/)).toBeChecked();
  });

  it('requires warning confirmation before publishing risky drafts', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listAgentBuilderDrafts).mockResolvedValue({
      drafts: [{
        ...draft,
        status: 'tested',
        employee: { ...draft.employee, tools: ['med_crm:add_incident'] },
        validation: {
          ok: true,
          issues: [{ severity: 'warning', field: 'employee.tools', message: 'med_crm:add_incident is internal_write' }],
        },
        harness: { yaml: 'id: builder', lastResult: 'passed', failures: [] },
        sandbox,
      }],
    });
    render(<AgentBuilder />);

    await screen.findByText('med_crm:add_incident is internal_write');
    await user.click(screen.getByRole('button', { name: /^发布$/i }));
    expect(await screen.findByRole('button', { name: '确认发布（含风险提示）' })).toBeInTheDocument();
  });
});
