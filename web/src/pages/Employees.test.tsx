import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Employees } from './Employees';
import { api, type Employee, type EnterprisePerson } from '../lib/api';
import { useChatStore } from '../stores/chat';

vi.mock('../lib/api', () => ({
  api: {
    listEmployees: vi.fn(),
    listEnterprisePeople: vi.fn(),
  },
}));

const employees: Employee[] = [
  {
    id: 'sales-zhangsan',
    displayName: '销售张三',
    description: '负责客户跟进和合同线索整理',
    model: 'claude-sonnet-4-6',
    systemPrompt: '你是销售数字员工，负责跟进客户并记录关键业务字段。',
    tools: ['med_crm:query_contract', 'dingtalk:send_message'],
    skills: ['crm_lookup'],
    role: 'sales',
    allowedTargets: ['maintenance-lisi'],
    capabilities: ['客户跟进', '合同查询'],
    workspace: 'agents/sales-zhangsan',
    source: 'prepopulated',
    createdAt: 1,
    hasFallbackLevel1: false,
    hasFallbackLevel2: false,
    toolCount: 2,
    skillCount: 1,
  },
  {
    id: 'maintenance-lisi',
    displayName: '售后李四',
    description: '负责维修工单和售后质检',
    model: 'claude-sonnet-4-6',
    systemPrompt: '你是售后数字员工，负责处理维修工单。',
    tools: ['med_crm:list_maintenance'],
    skills: ['repair_quality'],
    role: 'maintenance',
    capabilities: ['维修工单'],
    workspace: 'agents/maintenance-lisi',
    source: 'generated',
    createdAt: 2,
    hasFallbackLevel1: false,
    hasFallbackLevel2: false,
    toolCount: 1,
    skillCount: 1,
  },
];

const people: EnterprisePerson[] = [
  {
    userId: 'user-1',
    name: '王小明',
    departments: [{ id: 'sales', name: '销售部' }],
    status: 'active',
    source: 'manual',
    syncedAt: 1,
    updatedAt: 1,
    entryEmployee: 'sales-zhangsan',
    routingMode: 'bound',
    visibleEmployees: [],
  },
  {
    userId: 'user-2',
    name: '赵小红',
    departments: [{ id: 'service', name: '售后部' }],
    status: 'active',
    source: 'manual',
    syncedAt: 1,
    updatedAt: 1,
    routingMode: 'selector',
    visibleEmployees: ['sales-zhangsan', 'maintenance-lisi'],
  },
];

describe('Employees page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      selectedTenant: 'demo-tenant',
      tenants: [{ id: 'demo-tenant', displayName: 'Demo Tenant' }],
    });
    vi.mocked(api.listEmployees).mockResolvedValue({ employees });
    vi.mocked(api.listEnterprisePeople).mockResolvedValue({ people });
  });

  it('renders a read-only digital employee directory from employees and people bindings', async () => {
    render(
      <MemoryRouter initialEntries={['/employees']}>
        <Employees />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '数字员工' })).toBeInTheDocument();
    expect(api.listEmployees).toHaveBeenCalledWith('demo-tenant');
    expect(api.listEnterprisePeople).toHaveBeenCalledWith('demo-tenant');

    expect(screen.getByText('销售张三')).toBeInTheDocument();
    expect(screen.getAllByText('售后李四').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'crm_lookup' })).toHaveAttribute('href', '/skills-marketplace?skill=crm_lookup');
    expect(screen.getByRole('link', { name: '客户跟进' })).toHaveAttribute('href', '/employees?capability=%E5%AE%A2%E6%88%B7%E8%B7%9F%E8%BF%9B');
    expect(screen.getByRole('link', { name: 'med_crm:query_contract' })).toHaveAttribute('href', '/skills-marketplace?app=med_crm');
    expect(screen.getByText('dingtalk:send_message')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '王小明 · user-1' })).toHaveAttribute('href', '/people');
    expect(screen.getByRole('link', { name: '售后李四' })).toHaveAttribute('href', '#employee-maintenance-lisi');
    expect(screen.getAllByText('跳转').length).toBeGreaterThan(0);
    expect(screen.getAllByText('筛选').length).toBeGreaterThan(0);
    expect(screen.getAllByText('运行上下文预览').length).toBeGreaterThan(0);
    expect(screen.getAllByText('当前人员与协作上下文').length).toBeGreaterThan(0);
    expect(screen.getAllByText('动态').length).toBeGreaterThan(0);
    expect(screen.getAllByText('路由角色键').length).toBeGreaterThan(0);
    expect(screen.queryByText(/角色是 sales/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Prompt 组成视图').length).toBeGreaterThan(0);
    expect(screen.getByText('选择器模式')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /去 Builder 构造/ })).toHaveAttribute('href', '/agent-builder');

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /生成|录入|优化|Fork|保存模板/i })).not.toBeInTheDocument();
    });
  });
});
