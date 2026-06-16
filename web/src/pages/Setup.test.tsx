import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Setup } from './Setup';
import * as api from '../lib/api';
import { MemoryRouter, Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';

vi.mock('../lib/api', () => ({
  api: {
    saveAdminConfig: vi.fn(),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

describe('Setup Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: vi.fn() },
      writable: true,
    });
  });

  const renderWithRouter = (component: React.ReactNode) => {
    return render(<MemoryRouter>{component}</MemoryRouter>);
  };

  describe('Step 1: Model Configuration', () => {
    it('renders step indicator correctly', () => {
      renderWithRouter(<Setup />);

      expect(screen.getByText('STEP 1 / 2')).toBeInTheDocument();
      expect(screen.getByText('配置模型接入')).toBeInTheDocument();
    });

    it('displays mode toggle buttons', () => {
      renderWithRouter(<Setup />);

      expect(screen.getByText('第三方渠道')).toBeInTheDocument();
      expect(screen.getByText('官方渠道')).toBeInTheDocument();
    });

    it('defaults to third-party mode', () => {
      renderWithRouter(<Setup />);

      expect(screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/第三方网关 Token/)).toBeInTheDocument();
    });

    it('switches to official mode when clicked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Setup />);

      await user.click(screen.getByText('官方渠道'));

      expect(screen.getByPlaceholderText(/sk-ant-api03-/)).toBeInTheDocument();
    });

    it('validates required fields in third-party mode', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Setup />);

      const nextButton = screen.getByText(/下一步/);
      await user.click(nextButton);

      expect(screen.getByText('请填写 Base URL')).toBeInTheDocument();
    });

    it('validates required fields in official mode', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Setup />);

      await user.click(screen.getByText('官方渠道'));

      const nextButton = screen.getByText(/下一步/);
      await user.click(nextButton);

      expect(screen.getByText('请填写 Anthropic API Key')).toBeInTheDocument();
    });

    it('allows navigation to step 2 with valid data', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Setup />);

      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      const authTokenInput = screen.getByPlaceholderText(/第三方网关 Token/);
      await user.type(authTokenInput, 'test-token');

      await user.click(screen.getByText(/下一步/));

      expect(screen.getByText('STEP 2 / 2')).toBeInTheDocument();
      expect(screen.getByText('创建 Bot')).toBeInTheDocument();
    });
  });

  describe('Step 2: Bot Creation', () => {
    it('renders step indicator correctly', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Setup />);

      // Fill step 1 and proceed
      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      const authTokenInput = screen.getByPlaceholderText(/第三方网关 Token/);
      await user.type(authTokenInput, 'test-token');

      await user.click(screen.getByText(/下一步/));

      expect(screen.getByText('STEP 2 / 2')).toBeInTheDocument();
    });

    it('displays channel selector', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Setup />);

      // Fill step 1 and proceed
      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      const authTokenInput = screen.getByPlaceholderText(/第三方网关 Token/);
      await user.type(authTokenInput, 'test-token');

      await user.click(screen.getByText(/下一步/));

      expect(screen.getByText('钉钉')).toBeInTheDocument();
      expect(screen.getByText('飞书')).toBeInTheDocument();
    });

    it('has bot name input with validation', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Setup />);

      // Fill step 1 and proceed
      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      const authTokenInput = screen.getByPlaceholderText(/第三方网关 Token/);
      await user.type(authTokenInput, 'test-token');

      await user.click(screen.getByText(/下一步/));

      const botNameInput = screen.getByPlaceholderText('例如：my-bot');
      expect(botNameInput).toBeInTheDocument();
    });

    it('allows going back to step 1', async () => {
      const user = userEvent.setup();
      renderWithRouter(<Setup />);

      // Fill step 1 and proceed
      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      const authTokenInput = screen.getByPlaceholderText(/第三方网关 Token/);
      await user.type(authTokenInput, 'test-token');

      await user.click(screen.getByText(/下一步/));

      await user.click(screen.getByText(/上一步/));

      expect(screen.getByText('STEP 1 / 2')).toBeInTheDocument();
    });
  });

  describe('Completion', () => {
    it('saves config and redirects to /config when completing', async () => {
      const user = userEvent.setup();
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true });

      renderWithRouter(<Setup />);

      // Fill step 1
      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      const authTokenInput = screen.getByPlaceholderText(/第三方网关 Token/);
      await user.type(authTokenInput, 'test-token');

      await user.click(screen.getByText(/下一步/));

      // Fill step 2
      const botNameInput = screen.getByPlaceholderText('例如：my-bot');
      await user.type(botNameInput, 'test-bot');

      const displayNameInput = screen.getByPlaceholderText('例如：我的助手');
      await user.type(displayNameInput, 'Test Bot');

      // Complete
      await user.click(screen.getByText(/完成设置/));

      await waitFor(() => {
        expect(api.api.saveAdminConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            baseUrl: 'https://example.com/v1',
            authToken: 'test-token',
            bots: expect.arrayContaining([
              expect.objectContaining({
                name: 'test-bot',
                displayName: 'Test Bot',
              }),
            ]),
          }),
        );
      });
    });

    it('shows skip button and allows skipping bot creation', async () => {
      const user = userEvent.setup();
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true });

      renderWithRouter(<Setup />);

      // Fill step 1
      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      const authTokenInput = screen.getByPlaceholderText(/第三方网关 Token/);
      await user.type(authTokenInput, 'test-token');

      await user.click(screen.getByText(/下一步/));

      // Skip
      await user.click(screen.getByText('跳过，稍后配置'));

      await waitFor(() => {
        expect(api.api.saveAdminConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            baseUrl: 'https://example.com/v1',
            authToken: 'test-token',
            bots: undefined,
          }),
        );
      });
    });

    it('displays error message when save fails', async () => {
      const user = userEvent.setup();
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true, error: 'Invalid API key' });

      renderWithRouter(<Setup />);

      // Fill step 1
      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      const authTokenInput = screen.getByPlaceholderText(/第三方网关 Token/);
      await user.type(authTokenInput, 'test-token');

      await user.click(screen.getByText(/下一步/));

      // Try to complete
      await user.click(screen.getByText('跳过，稍后配置'));

      await waitFor(() => {
        expect(screen.getByText('Invalid API key')).toBeInTheDocument();
      });
    });
  });
});
