import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatView } from './ChatView';
import { useChatStore } from '../../stores/chat';

const apiMock = vi.hoisted(() => ({
  getWebChatConfig: vi.fn(),
  listRuntimeEntries: vi.fn(),
  listRuntimeActors: vi.fn(),
  listRuntimeTargets: vi.fn(),
  listRuntimeSessions: vi.fn(),
  getRuntimeSessionMessages: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getWebChatConfig: apiMock.getWebChatConfig,
      listRuntimeEntries: apiMock.listRuntimeEntries,
      listRuntimeActors: apiMock.listRuntimeActors,
      listRuntimeTargets: apiMock.listRuntimeTargets,
      listRuntimeSessions: apiMock.listRuntimeSessions,
      getRuntimeSessionMessages: apiMock.getRuntimeSessionMessages,
    },
  };
});

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('./MessageList', () => ({
  MessageList: ({
    messages,
    activeTitle,
    activeSubtitle,
  }: {
    messages: Array<{ id: string; text: string }>;
    activeTitle?: string;
    activeSubtitle?: string;
  }) => (
    <div data-testid="messages">
      {activeTitle && <div data-testid="active-title">{activeTitle}</div>}
      {activeSubtitle && <div data-testid="active-subtitle">{activeSubtitle}</div>}
      {messages.map((message) => (
        <div key={message.id}>{message.text}</div>
      ))}
    </div>
  ),
}));

vi.mock('./MessageInput', () => ({
  MessageInput: ({
    onSend,
    disabled,
    statusText,
    draftText,
  }: {
    onSend: (content: string) => Promise<boolean>;
    disabled?: boolean;
    statusText?: string;
    draftText?: string;
  }) => (
    <div>
      {statusText && <div data-testid="input-status">{statusText}</div>}
      {draftText && <div data-testid="draft-text">{draftText}</div>}
      <button type="button" disabled={disabled} onClick={() => onSend('你好')}>send</button>
    </div>
  ),
}));

class MockWebSocket {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Array<Record<string, unknown>> = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.onclose?.();
  }
}

describe('ChatView runtime WebSocket handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    sessionStorage.clear();
    localStorage.clear();
    useChatStore.setState({
      connected: false,
      wsRef: { current: null },
      reconnectTimer: null,
      messages: [],
      loadingHistory: false,
      hasMoreHistory: false,
      selectedWorkdir: 'web-bot',
      chatId: 'chat-runtime-ui',
      userId: undefined,
      runtimeContext: {},
      drafts: {},
      streaming: {},
      workdirs: [],
      tenants: [],
      selectedTenant: 'tenant-a',
      sessions: [],
    });
    apiMock.getWebChatConfig.mockResolvedValue({
      historyLimit: 50,
      showSessionPicker: true,
      showQuickPrompts: false,
      enableImageUpload: false,
    });
    apiMock.listRuntimeEntries.mockResolvedValue({
      entries: [{ id: 'web-bot', tenant: 'tenant-a', channel: 'web', displayName: 'Web', routingMode: 'direct', enabled: true }],
    });
    apiMock.listRuntimeActors.mockResolvedValue({
      actors: [{ tenant: 'tenant-a', actorId: 'user-sales', displayName: '销售用户', source: 'people', bindings: [{ employeeId: 'sales-zhangsan', isDefault: true }] }],
    });
    apiMock.listRuntimeTargets.mockResolvedValue({ targets: [] });
    apiMock.listRuntimeSessions.mockResolvedValue({ sessions: [] });
    apiMock.getRuntimeSessionMessages.mockResolvedValue({ messages: [] });
  });

  it('accepts runtime events routed to the default employee before a target is selected', async () => {
    render(
      <ChatView
        selectedWorkdir="web-bot"
        workdirs={[{ id: 'web-bot', displayName: 'Web', tenant: 'tenant-a' }]}
        onWorkdirChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(apiMock.listRuntimeTargets).toHaveBeenCalledWith('tenant-a', 'user-sales', 'web-bot'));
    await waitFor(() => expect(useChatStore.getState().connected).toBe(true));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    fireEvent.click(screen.getByRole('button', { name: 'send' }));

    expect(ws.sent[0]).toEqual(expect.objectContaining({
      type: 'send_message',
      tenant: 'tenant-a',
      entryId: 'web-bot',
      actorId: 'user-sales',
      chatId: 'chat-runtime-ui',
      content: '你好',
    }));
    expect(ws.sent[0].target).toBeUndefined();

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'stream_event',
          botName: 'sales-zhangsan',
          chatId: 'chat-runtime-ui',
          meta: {
            tenant: 'tenant-a',
            entryId: 'web-bot',
            actorId: 'user-sales',
            employeeId: 'sales-zhangsan',
          },
          event: { eventType: 'text_delta', text: '处理中' },
        }),
      } as MessageEvent<string>);
    });

    expect(useChatStore.getState().streaming['sales-zhangsan:chat-runtime-ui']?.partialText).toBe('处理中');

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'new_message',
          botName: 'sales-zhangsan',
          chatId: 'chat-runtime-ui',
          meta: {
            tenant: 'tenant-a',
            entryId: 'web-bot',
            actorId: 'user-sales',
            employeeId: 'sales-zhangsan',
          },
          message: {
            id: 'reply-1',
            chatId: 'chat-runtime-ui',
            text: '已收到',
            source: 'bot',
            botName: 'sales-zhangsan',
            timestamp: 123,
            tenant: 'tenant-a',
            entryId: 'web-bot',
            actorId: 'user-sales',
            employeeId: 'sales-zhangsan',
          },
        }),
      } as MessageEvent<string>);
    });

    expect(screen.getByText('已收到')).toBeInTheDocument();
  });

  it('records handoff stream events as current collaboration state', async () => {
    render(
      <ChatView
        selectedWorkdir="web-bot"
        workdirs={[{ id: 'web-bot', displayName: 'Web', tenant: 'tenant-a' }]}
        onWorkdirChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(useChatStore.getState().connected).toBe(true));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'stream_event',
          botName: 'sales-zhangsan',
          chatId: 'chat-runtime-ui',
          meta: {
            tenant: 'tenant-a',
            entryId: 'web-bot',
            actorId: 'user-sales',
            employeeId: 'sales-zhangsan',
          },
          event: {
            eventType: 'handoff',
            handoffFrom: 'sales-zhangsan',
            handoffTo: 'maintenance-lisi',
            handoffReason: '需要确认设备维保记录',
          },
        }),
      } as MessageEvent<string>);
    });

    expect(useChatStore.getState().streaming['sales-zhangsan:chat-runtime-ui']?.collaborations).toEqual([
      expect.objectContaining({
        from: 'sales-zhangsan',
        to: 'maintenance-lisi',
        reason: '需要确认设备维保记录',
        status: 'pending',
      }),
    ]);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'stream_event',
          botName: 'sales-zhangsan',
          chatId: 'chat-runtime-ui',
          meta: {
            tenant: 'tenant-a',
            entryId: 'web-bot',
            actorId: 'user-sales',
            employeeId: 'sales-zhangsan',
          },
          event: {
            eventType: 'handoff_result',
            handoffTo: 'maintenance-lisi',
            handoffStatus: 'completed',
            handoffResult: '维修李四确认：设备维保记录已核验。',
            contractId: 'child-1',
            parentContractId: 'root-1',
          },
        }),
      } as MessageEvent<string>);
    });

    expect(useChatStore.getState().streaming['sales-zhangsan:chat-runtime-ui']?.collaborations).toEqual([
      expect.objectContaining({
        from: 'sales-zhangsan',
        to: 'maintenance-lisi',
        status: 'completed',
        result: '维修李四确认：设备维保记录已核验。',
      }),
    ]);
  });

  it('restores the last runtime session when returning to Chat', async () => {
    useChatStore.setState({
      chatId: 'chat-1',
      runtimeContext: {
        tenant: 'tenant-a',
        entryId: 'web-bot',
        actorId: 'user-sales',
        targetEmployeeId: 'sales-zhangsan',
        sessionId: 'session-1',
        chatId: 'chat-1',
      },
    });
    apiMock.listRuntimeTargets.mockResolvedValue({
      targets: [{ tenant: 'tenant-a', entryId: 'web-bot', actorId: 'user-sales', employeeId: 'sales-zhangsan', displayName: '销售张三', isDefault: true }],
    });
    apiMock.listRuntimeSessions.mockResolvedValue({
      sessions: [{
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
        messageCount: 1,
        lastMessageAt: 1000,
        preview: 'hello',
      }],
    });
    apiMock.getRuntimeSessionMessages.mockResolvedValue({
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
        text: 'restored-history',
        source: 'bot',
      }],
    });

    render(
      <ChatView
        selectedWorkdir="web-bot"
        workdirs={[{ id: 'web-bot', displayName: 'Web', tenant: 'tenant-a' }]}
        onWorkdirChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(apiMock.getRuntimeSessionMessages).toHaveBeenCalledWith('session-1', 50));
    expect(await screen.findByText('restored-history')).toBeInTheDocument();
  });

  it('surfaces the active runtime context and send target in the chat chrome', async () => {
    apiMock.listRuntimeTargets.mockResolvedValue({
      targets: [{
        tenant: 'tenant-a',
        entryId: 'web-bot',
        actorId: 'user-sales',
        employeeId: 'sales-zhangsan',
        displayName: '销售张三',
        isDefault: true,
      }],
    });

    render(
      <ChatView
        selectedWorkdir="web-bot"
        workdirs={[{ id: 'web-bot', displayName: 'Web', tenant: 'tenant-a' }]}
        onWorkdirChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('active-title')).toHaveTextContent('销售张三');
    });

    expect(screen.getByTestId('active-subtitle')).toHaveTextContent('Web / 销售用户');
    expect(screen.getByTestId('input-status')).toHaveTextContent('将发送给 销售张三');
  });
});
