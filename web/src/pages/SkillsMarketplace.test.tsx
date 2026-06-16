import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillsMarketplace } from './SkillsMarketplace';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chat';

vi.mock('../lib/api', () => ({
  api: {
    listSkills: vi.fn(),
    listEmployeesBySkill: vi.fn(),
  },
}));

const tenantSkill = {
  id: 'med_crm',
  name: 'med_crm',
  description: '示例医疗 CRM',
  source: 'tenant:acme-happycompany',
  enabled: true,
  userInvocable: true,
  allowedTools: [],
  argumentHint: null,
  updatedAt: '2026-06-02T00:00:00.000Z',
  files: [{ name: 'SKILL.md', type: 'file', size: 100 }],
};

const globalSkill = {
  id: 'browser',
  name: 'browser',
  description: '浏览器自动化',
  source: 'global',
  enabled: true,
  userInvocable: true,
  allowedTools: [],
  argumentHint: null,
  updatedAt: '2026-06-02T00:00:00.000Z',
  files: [{ name: 'SKILL.md', type: 'file', size: 100 }],
};

describe('SkillsMarketplace page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      selectedTenant: 'acme-happycompany',
      tenants: [{ id: 'acme-happycompany', displayName: '示例医疗' }],
    });
    vi.mocked(api.listSkills).mockResolvedValue([tenantSkill, globalSkill]);
    vi.mocked(api.listEmployeesBySkill).mockResolvedValue([]);
  });

  it('renders tenant and global skills without publish or workdir controls', async () => {
    render(
      <MemoryRouter initialEntries={['/skills-marketplace']}>
        <SkillsMarketplace />
      </MemoryRouter>,
    );

    expect(await screen.findByText('med_crm')).toBeInTheDocument();
    expect(await screen.findByText('browser')).toBeInTheDocument();
    expect(screen.getAllByText('企业技能').length).toBeGreaterThan(0);
    expect(screen.getAllByText('全局技能').length).toBeGreaterThan(0);
    expect(screen.queryByText('+ Publish')).not.toBeInTheDocument();
    expect(screen.queryByText('Workdir Skills')).not.toBeInTheDocument();
    expect(screen.queryByText('+ New Skill')).not.toBeInTheDocument();
    expect(api.listSkills).toHaveBeenCalledWith('acme-happycompany');
  });

  it('keeps old app query links focused on the matching skill', async () => {
    render(
      <MemoryRouter initialEntries={['/skills-marketplace?app=med_crm']}>
        <SkillsMarketplace />
      </MemoryRouter>,
    );

    expect(await screen.findByText('med_crm')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('browser')).not.toBeInTheDocument());
    expect(screen.getByText(/已从链接定位到「med_crm」/)).toBeInTheDocument();
  });
});
