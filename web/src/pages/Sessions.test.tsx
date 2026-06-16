import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sessions } from './Sessions';
import { api } from '../lib/api';
import type { RuntimeSessionInfo } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    listTenants: vi.fn(),
    listRuntimeEntries: vi.fn(),
    listRuntimeActors: vi.fn(),
    listRuntimeSessions: vi.fn(),
    getRuntimeSessionMessages: vi.fn(),
    archiveRuntimeSession: vi.fn(),
  },
}));

function makeSession(id: string, overrides: Partial<RuntimeSessionInfo> = {}): RuntimeSessionInfo {
  return {
    id,
    tenant: 'tenant-a',
    entryId: 'web-bot',
    channel: 'web',
    actorId: 'user-sales',
    chatId: id,
    employeeId: 'sales-zhangsan',
    instanceId: 'tenant-a:user-sales:sales-zhangsan',
    workdir: '/corp/tenant-a/agents/sales-zhangsan/user-sales',
    sdkSessionScope: `tenant-a:web-bot:user-sales:sales-zhangsan:${id}`,
    mode: 'single_employee',
    messageCount: 1,
    lastMessageAt: 1000,
    preview: 'hello',
    ...overrides,
  };
}

describe('Sessions page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listTenants).mockResolvedValue({
      tenants: [{ id: 'tenant-a', displayName: 'Tenant A' }],
    });
    vi.mocked(api.listRuntimeEntries).mockResolvedValue({
      entries: [{
        id: 'web-bot',
        tenant: 'tenant-a',
        channel: 'web',
        displayName: 'Web Entry',
        routingMode: 'employee-director',
        enabled: true,
      }],
    });
    vi.mocked(api.listRuntimeActors).mockResolvedValue({
      actors: [{
        tenant: 'tenant-a',
        actorId: 'user-sales',
        source: 'people',
        displayName: 'Sales User',
        bindings: [{ employeeId: 'sales-zhangsan', isDefault: true }],
      }],
    });
    vi.mocked(api.listRuntimeSessions).mockResolvedValue({
      sessions: [makeSession('session-1', { chatId: 'chat-1', sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:chat-1' })],
    });
    vi.mocked(api.getRuntimeSessionMessages).mockResolvedValue({
      session: {
        id: 'session-1',
        tenant: 'tenant-a',
        entryId: 'web-bot',
        channel: 'web',
        actorId: 'user-sales',
        chatId: 'chat-1',
        employeeId: 'sales-zhangsan',
        instanceId: 'tenant-a:user-sales:sales-zhangsan',
        workdir: '/corp/tenant-a/agents/sales-zhangsan/user-sales',
        sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:chat-1',
        mode: 'single_employee',
        createdAt: 1000,
        updatedAt: 1000,
      },
      messages: [{
        id: 'm1',
        chatId: 'chat-1',
        sessionId: 'session-1',
        timestamp: 1000,
        botName: 'sales-zhangsan',
        tenant: 'tenant-a',
        entryId: 'web-bot',
        actorId: 'user-sales',
        employeeId: 'sales-zhangsan',
        instanceId: 'tenant-a:user-sales:sales-zhangsan',
        workdir: '/corp/tenant-a/agents/sales-zhangsan/user-sales',
        mode: 'single_employee',
        text: 'expanded-message-body',
        source: 'user',
      }],
    });
    vi.mocked(api.archiveRuntimeSession).mockResolvedValue({
      archived: true,
      session: {
        id: 'session-1',
        tenant: 'tenant-a',
        entryId: 'web-bot',
        channel: 'web',
        actorId: 'user-sales',
        chatId: 'chat-1',
        employeeId: 'sales-zhangsan',
        instanceId: 'tenant-a:user-sales:sales-zhangsan',
        workdir: '/corp/tenant-a/agents/sales-zhangsan/user-sales',
        sdkSessionScope: 'tenant-a:web-bot:user-sales:sales-zhangsan:chat-1',
        mode: 'single_employee',
        createdAt: 1000,
        updatedAt: 1100,
        archivedAt: 1100,
      },
    });
  });

  it('loads runtime filters and sessions instead of bot sessions', async () => {
    render(<Sessions />, { wrapper: MemoryRouter });

    expect(await screen.findByText('chat-1')).toBeInTheDocument();
    expect(screen.getByText('web-bot · user-sales · sales-zhangsan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute(
      'href',
      '/chat?tenant=tenant-a&entry=web-bot&actor=user-sales&employee=sales-zhangsan&session=session-1&chat=chat-1',
    );
    await waitFor(() => expect(api.listRuntimeSessions).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'tenant-a',
      limit: 51,
      offset: 0,
    })));
    expect(vi.mocked(api.listRuntimeSessions).mock.calls.at(-1)?.[0]).not.toHaveProperty('entryId');
    expect(vi.mocked(api.listRuntimeSessions).mock.calls.at(-1)?.[0]).not.toHaveProperty('actorId');
  });

  it('keeps all-entry filters live when selecting an actor', async () => {
    vi.mocked(api.listRuntimeEntries).mockResolvedValue({
      entries: [
        {
          id: 'web-bot',
          tenant: 'tenant-a',
          channel: 'web',
          displayName: 'Web Entry',
          routingMode: 'employee-director',
          enabled: true,
        },
        {
          id: 'acme-dingtalk',
          tenant: 'tenant-a',
          channel: 'dingtalk',
          displayName: 'DingTalk Entry',
          routingMode: 'employee-director',
          enabled: true,
        },
      ],
    });
    vi.mocked(api.listRuntimeActors).mockResolvedValue({
      actors: [
        {
          tenant: 'tenant-a',
          actorId: 'wen-hanxiang',
          source: 'people',
          displayName: '温瀚翔',
          bindings: [{ employeeId: 'sales-zhangsan', isDefault: true }],
        },
      ],
    });

    render(<Sessions />, { wrapper: MemoryRouter });

    await screen.findByText('chat-1');
    fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: 'wen-hanxiang' } });

    await waitFor(() => expect(api.listRuntimeSessions).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'tenant-a',
      actorId: 'wen-hanxiang',
      limit: 51,
      offset: 0,
    })));
    expect(vi.mocked(api.listRuntimeSessions).mock.calls.at(-1)?.[0]).not.toHaveProperty('entryId');
  });

  it('uses selectable page sizes and offsets the next page', async () => {
    const firstPage = Array.from({ length: 51 }, (_, index) => makeSession(`bulk-${index}`));
    vi.mocked(api.listRuntimeSessions).mockImplementation(async (filter = {}) => ({
      sessions: filter.offset === 50
        ? [makeSession('bulk-50', { chatId: 'bulk-chat-50' })]
        : firstPage,
    }));

    render(<Sessions />, { wrapper: MemoryRouter });

    expect(await screen.findByText('bulk-0')).toBeInTheDocument();
    expect(screen.queryByText('bulk-50')).not.toBeInTheDocument();
    await waitFor(() => expect(api.listRuntimeSessions).toHaveBeenCalledWith(expect.objectContaining({
      limit: 51,
      offset: 0,
    })));

    fireEvent.change(screen.getAllByRole('combobox')[3], { target: { value: '10' } });
    await waitFor(() => expect(api.listRuntimeSessions).toHaveBeenCalledWith(expect.objectContaining({
      limit: 11,
      offset: 0,
    })));

    fireEvent.change(screen.getAllByRole('combobox')[3], { target: { value: '50' } });
    await waitFor(() => expect(api.listRuntimeSessions).toHaveBeenCalledWith(expect.objectContaining({
      limit: 51,
      offset: 0,
    })));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(api.listRuntimeSessions).toHaveBeenCalledWith(expect.objectContaining({
      limit: 51,
      offset: 50,
    })));
    expect(await screen.findByText('bulk-chat-50')).toBeInTheDocument();
  });

  it('expands a runtime session and loads messages by session id', async () => {
    render(<Sessions />, { wrapper: MemoryRouter });

    const sessionCell = await screen.findByText('chat-1');
    fireEvent.click(sessionCell);

    await waitFor(() => expect(api.getRuntimeSessionMessages).toHaveBeenCalledWith('session-1', 100));
    expect(await screen.findByText('expanded-message-body')).toBeInTheDocument();
  });

  it('archives runtime sessions through the runtime API', async () => {
    render(<Sessions />, { wrapper: MemoryRouter });

    expect(await screen.findByText('chat-1')).toBeInTheDocument();
    vi.mocked(api.listRuntimeSessions).mockResolvedValue({ sessions: [] });
    fireEvent.click(screen.getByText('Clear'));

    await waitFor(() => expect(api.archiveRuntimeSession).toHaveBeenCalledWith('session-1'));
    await waitFor(() => expect(screen.queryByText('chat-1')).not.toBeInTheDocument());
  });
});
