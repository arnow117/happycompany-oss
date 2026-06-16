import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Chat } from './Chat';
import { useChatStore } from '../stores/chat';

vi.mock('../components/chat/ChatView', () => ({
  ChatView: ({
    selectedWorkdir,
    workdirs,
    initialRuntimeContext,
  }: {
    selectedWorkdir: string;
    workdirs: Array<{ id: string }>;
    initialRuntimeContext?: {
      tenant?: string;
      entryId?: string;
      actorId?: string;
      targetEmployeeId?: string;
      sessionId?: string;
      chatId?: string;
    };
  }) => (
    <div>
      <div data-testid="selected-workdir">{selectedWorkdir}</div>
      <div data-testid="workdir-ids">{workdirs.map((w) => w.id).join(',')}</div>
      <div data-testid="runtime-context">{JSON.stringify(initialRuntimeContext ?? {})}</div>
    </div>
  ),
}));

describe('Chat route initialization', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useChatStore.setState({
      connected: false,
      wsRef: { current: null },
      reconnectTimer: null,
      messages: [],
      loadingHistory: false,
      hasMoreHistory: false,
      selectedWorkdir: 'web',
      chatId: 'web-initial',
      userId: undefined,
      drafts: {},
      streaming: {},
      workdirs: [
        { id: 'acme', displayName: '示例医疗助手', path: './e2e/data/acme-workdir', channels: ['dingtalk'] },
        { id: 'sales-zhangsan', displayName: '销售张三', path: '/corp/acme/agents/sales-zhangsan', channels: ['web'], tenant: 'acme' },
      ],
      tenants: [
        { id: 'acme-med', displayName: 'Acme 医疗' },
        { id: 'acme', displayName: '示例医疗' },
      ],
      selectedTenant: 'acme-med',
      sessions: [],
    });
  });

  test('uses route botName as selected workdir and aligns tenant without a transient web fallback', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/acme']}>
        <Routes>
          <Route path="/chat/:botName" element={<Chat />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('selected-workdir')).toHaveTextContent('acme');
    });

    expect(screen.getByTestId('workdir-ids')).toHaveTextContent('acme');

    const state = useChatStore.getState();
    expect(state.selectedWorkdir).toBe('acme');
    expect(state.selectedTenant).toBe('acme');
    expect(state.chatId).toMatch(/^acme-/);
  });

  test('replaces stale default web workdir with first real tenant workdir after loading', () => {
    useChatStore.setState({
      selectedWorkdir: 'web',
      selectedTenant: 'acme-happycompany',
      chatId: 'web-initial',
      messages: [{ id: 'old', chatId: 'web-initial', text: 'old', source: 'user', timestamp: 1 }],
      streaming: {
        'web:web-initial': {
          isStreaming: true,
          partialText: 'old partial',
          thinkingText: '',
          isThinking: false,
          thinkingDurationMs: 0,
          activeTools: [],
          recentEvents: [],
          todos: [],
          interrupted: false,
        },
      },
    });

    useChatStore.getState().setWorkdirs([
      {
        id: 'web-bot',
        displayName: 'Assistant',
        path: 'agents/web-bot',
        channels: ['web'],
        tenant: 'acme-happycompany',
      },
    ]);

    const state = useChatStore.getState();
    expect(state.selectedWorkdir).toBe('web-bot');
    expect(state.chatId).toMatch(/^web-bot-/);
    expect(state.messages).toEqual([]);
    expect(state.streaming).toEqual({});
  });

  test('replaces stale legacy acme tenant with happycompany tenant on startup', () => {
    useChatStore.setState({
      selectedTenant: 'acme',
      selectedWorkdir: 'web',
      chatId: 'web-initial',
    });

    useChatStore.getState().setTenants([
      { id: 'acme', displayName: '示例医疗' },
      { id: 'acme-happycompany', displayName: '示例医疗' },
    ]);
    useChatStore.getState().setWorkdirs([
      {
        id: 'web-bot',
        displayName: 'Assistant',
        path: 'agents/web-bot',
        channels: ['web'],
        tenant: 'acme-happycompany',
      },
      {
        id: 'sales-zhangsan',
        displayName: '销售张三',
        path: '/corp/acme/agents/sales-zhangsan',
        channels: ['web'],
        tenant: 'acme',
      },
    ]);

    const state = useChatStore.getState();
    expect(state.selectedTenant).toBe('acme-happycompany');
    expect(state.selectedWorkdir).toBe('web-bot');
    expect(localStorage.getItem('hc-selectedTenant')).toBe('acme-happycompany');
  });

  test('passes runtime session query parameters into ChatView', async () => {
    render(
      <MemoryRouter initialEntries={['/chat?tenant=acme&entry=web-bot&actor=visitor-1&employee=sales-zhangsan&session=session-1&chat=chat-1']}>
        <Routes>
          <Route path="/chat" element={<Chat />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(useChatStore.getState().selectedTenant).toBe('acme');
    });

    expect(screen.getByTestId('runtime-context')).toHaveTextContent('"tenant":"acme"');
    expect(screen.getByTestId('runtime-context')).toHaveTextContent('"entryId":"web-bot"');
    expect(screen.getByTestId('runtime-context')).toHaveTextContent('"actorId":"visitor-1"');
    expect(screen.getByTestId('runtime-context')).toHaveTextContent('"targetEmployeeId":"sales-zhangsan"');
    expect(screen.getByTestId('runtime-context')).toHaveTextContent('"sessionId":"session-1"');
    expect(screen.getByTestId('runtime-context')).toHaveTextContent('"chatId":"chat-1"');
  });
});
