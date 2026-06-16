import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelConfig } from './ModelConfig';
import * as api from '../lib/api';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/api', () => ({
  api: {
    saveAdminConfig: vi.fn(),
    verifyModel: vi.fn(),
    getBootstrapStatus: vi.fn(),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

describe('ModelConfig Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.api.getBootstrapStatus).mockResolvedValue({
      configured: false,
      steps: {
        modelConfigured: false,
        employeeNetworkReady: false,
        peopleBound: false,
      },
    });
  });

  const renderWithRouter = (component: React.ReactNode) => {
    return render(<MemoryRouter>{component}</MemoryRouter>);
  };

  describe('Rendering', () => {
    it('renders the model config form', () => {
      renderWithRouter(<ModelConfig />);

      expect(screen.getByText('模型配置')).toBeInTheDocument();
      expect(screen.getByText('第三方渠道')).toBeInTheDocument();
      expect(screen.getByText('官方渠道')).toBeInTheDocument();
    });

    it('displays third-party mode by default', () => {
      renderWithRouter(<ModelConfig />);

      expect(screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/第三方网关 Token/)).toBeInTheDocument();
    });
  });

  describe('Provider toggle', () => {
    it('switches to official mode when clicked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ModelConfig />);

      await user.click(screen.getByText('官方渠道'));

      expect(screen.getByPlaceholderText(/sk-ant-api03-/)).toBeInTheDocument();
    });
  });

  describe('Validation', () => {
    it('shows error for missing base URL in third-party mode', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ModelConfig />);

      await user.click(screen.getByText(/保存并继续/));

      expect(screen.getByText('请填写 Base URL')).toBeInTheDocument();
    });

    it('shows error for missing auth token in third-party mode', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ModelConfig />);

      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      await user.click(screen.getByText(/保存并继续/));

      expect(screen.getByText('请填写 Auth Token')).toBeInTheDocument();
    });

    it('shows error for missing API key in official mode', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ModelConfig />);

      await user.click(screen.getByText('官方渠道'));
      await user.click(screen.getByText(/保存并继续/));

      expect(screen.getByText('请填写 Anthropic API Key')).toBeInTheDocument();
    });
  });

  describe('Test connection', () => {
    it('calls verifyModel API when test button is clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(api.api.verifyModel).mockResolvedValue({ ok: true, model: 'sonnet' });

      renderWithRouter(<ModelConfig />);

      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      const authTokenInput = screen.getByPlaceholderText(/第三方网关 Token/);
      await user.type(authTokenInput, 'test-token');

      await user.click(screen.getByText(/测试连接/));

      await waitFor(() => {
        expect(api.api.verifyModel).toHaveBeenCalledWith({
          baseUrl: 'https://example.com/v1',
          authToken: 'test-token',
        });
      });
    });

    it('shows success message when test passes', async () => {
      const user = userEvent.setup();
      vi.mocked(api.api.verifyModel).mockResolvedValue({ ok: true, model: 'sonnet' });

      renderWithRouter(<ModelConfig />);

      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      const authTokenInput = screen.getByPlaceholderText(/第三方网关 Token/);
      await user.type(authTokenInput, 'test-token');

      await user.click(screen.getByText(/测试连接/));

      await waitFor(() => {
        expect(screen.getByText(/连接成功: sonnet/)).toBeInTheDocument();
      });
    });

    it('shows error message when test fails', async () => {
      const user = userEvent.setup();
      vi.mocked(api.api.verifyModel).mockResolvedValue({ ok: false, error: 'Connection failed' });

      renderWithRouter(<ModelConfig />);

      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      const authTokenInput = screen.getByPlaceholderText(/第三方网关 Token/);
      await user.type(authTokenInput, 'test-token');

      await user.click(screen.getByText(/测试连接/));

      await waitFor(() => {
        expect(screen.getByText('Connection failed')).toBeInTheDocument();
      });
    });

    it('hides test button in official mode', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ModelConfig />);

      await user.click(screen.getByText('官方渠道'));

      expect(screen.queryByText(/测试连接/)).not.toBeInTheDocument();
    });
  });

  describe('Save', () => {
    it('saves third-party config when valid data provided', async () => {
      const user = userEvent.setup();
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true });

      renderWithRouter(<ModelConfig />);

      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      const authTokenInput = screen.getByPlaceholderText(/第三方网关 Token/);
      await user.type(authTokenInput, 'test-token');

      await user.click(screen.getByText(/保存并继续/));

      await waitFor(() => {
        expect(api.api.saveAdminConfig).toHaveBeenCalledWith({
          baseUrl: 'https://example.com/v1',
          authToken: 'test-token',
        });
      });
    });

    it('saves official mode config', async () => {
      const user = userEvent.setup();
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true });

      renderWithRouter(<ModelConfig />);

      await user.click(screen.getByText('官方渠道'));

      const apiKeyInput = screen.getByPlaceholderText(/sk-ant-api03-/);
      await user.type(apiKeyInput, 'sk-ant-test-key');

      await user.click(screen.getByText(/保存并继续/));

      await waitFor(() => {
        expect(api.api.saveAdminConfig).toHaveBeenCalledWith({
          apiKey: 'sk-ant-test-key',
        });
      });
    });

    it('shows error when save fails', async () => {
      const user = userEvent.setup();
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true, error: 'Invalid config' });

      renderWithRouter(<ModelConfig />);

      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      await user.type(baseUrlInput, 'https://example.com/v1');

      const authTokenInput = screen.getByPlaceholderText(/第三方网关 Token/);
      await user.type(authTokenInput, 'test-token');

      await user.click(screen.getByText(/保存并继续/));

      await waitFor(() => {
        expect(screen.getByText('Invalid config')).toBeInTheDocument();
      });
    });
  });

  describe('Status badge', () => {
    it('shows "已配置" badge when model is already configured', async () => {
      vi.mocked(api.api.getBootstrapStatus).mockResolvedValue({
        configured: true,
        steps: {
          modelConfigured: true,
          employeeNetworkReady: false,
          peopleBound: false,
        },
      });

      renderWithRouter(<ModelConfig />);

      await waitFor(() => {
        expect(screen.getByText('已配置')).toBeInTheDocument();
      });
    });

    it('does not show badge when model is not configured', () => {
      renderWithRouter(<ModelConfig />);

      expect(screen.queryByText('已配置')).not.toBeInTheDocument();
    });
  });
});