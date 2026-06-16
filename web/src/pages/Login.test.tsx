import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Login } from './Login';
import * as api from '../lib/api';
import * as auth from '../lib/auth';

vi.mock('../lib/api', () => ({
  api: {
    login: vi.fn(),
  },
}));

vi.mock('../lib/auth', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

function renderLogin() {
  return render(
    <BrowserRouter>
      <Login />
    </BrowserRouter>,
  );
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders admin console entry with product context', () => {
    renderLogin();
    expect(screen.getByText('HappyCompany')).toBeInTheDocument();
    expect(screen.getByText('Admin Console')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '让企业消息进入 数字员工网络' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '搭建员工网络' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '接入消息入口' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '协作完成任务' })).toBeInTheDocument();
    expect(screen.getByText('Web / 钉钉 / 飞书')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '管理员登录' })).toBeInTheDocument();
    expect(screen.getByText('Powered by Claude Agent SDK')).toBeInTheDocument();
  });

  test('renders translucent login card layout', () => {
    const { container } = renderLogin();
    const form = container.querySelector('form');
    expect(form).toHaveStyle({
      background: 'rgba(255, 252, 247, 0.9)',
    });
  });

  test('renders remember-device checkbox', () => {
    renderLogin();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeInTheDocument();
    expect(screen.getByText('在这台设备上保留登录状态')).toBeInTheDocument();
  });

  test('toggles remember me checkbox on click', () => {
    renderLogin();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  test('submits login form with token and shows loading state', async () => {
    vi.mocked(api.api.login).mockResolvedValue({ success: true });
    renderLogin();

    const input = screen.getByPlaceholderText(/enter admin token/i);
    const button = screen.getByRole('button', { name: '进入控制台' });

    fireEvent.change(input, { target: { value: 'test-token' } });
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('正在校验...');
    });

    await waitFor(() => {
      expect(api.api.login).toHaveBeenCalledWith('test-token');
    });
  });

  test('shows error message on invalid token', async () => {
    vi.mocked(api.api.login).mockRejectedValue(new Error('Invalid token'));
    renderLogin();

    const input = screen.getByPlaceholderText(/enter admin token/i);
    const button = screen.getByRole('button', { name: '进入控制台' });

    fireEvent.change(input, { target: { value: 'invalid-token' } });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('管理员令牌无效或已过期')).toBeInTheDocument();
    });
  });

  test('has generated enterprise console background on page', () => {
    const { container } = renderLogin();
    const page = container.firstChild as HTMLElement;
    const background = page.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(background.style.backgroundImage).toContain('/assets/hero-digital-employees.png');
  });

  describe('Auth Flow', () => {
    test('stores token in localStorage after successful login', async () => {
      vi.mocked(api.api.login).mockResolvedValue({ success: true });
      renderLogin();

      const input = screen.getByPlaceholderText(/enter admin token/i);
      const button = screen.getByRole('button', { name: '进入控制台' });

      fireEvent.change(input, { target: { value: 'my-secret-token' } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(auth.setToken).toHaveBeenCalledWith('my-secret-token', false);
      });
    });

    test('stores token in localStorage when remember me is checked', async () => {
      vi.mocked(api.api.login).mockResolvedValue({ success: true });
      renderLogin();

      const input = screen.getByPlaceholderText(/enter admin token/i);
      const button = screen.getByRole('button', { name: '进入控制台' });
      const checkbox = screen.getByRole('checkbox');

      fireEvent.click(checkbox);
      fireEvent.change(input, { target: { value: 'my-secret-token' } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(auth.setToken).toHaveBeenCalledWith('my-secret-token', true);
      });
    });

    test('shows error message on invalid token', async () => {
      vi.mocked(api.api.login).mockRejectedValueOnce(new Error('Invalid token'));
      renderLogin();

      const input = screen.getByPlaceholderText(/enter admin token/i);
      const button = screen.getByRole('button', { name: '进入控制台' });

      // Attempt with invalid token
      fireEvent.change(input, { target: { value: 'invalid-token' } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('管理员令牌无效或已过期')).toBeInTheDocument();
      });
    });

    test('button is enabled when input is empty (validation on submit)', () => {
      renderLogin();
      const button = screen.getByRole('button', { name: '进入控制台' });
      expect(button).toBeEnabled();
    });

    test('button is enabled when input has value', () => {
      renderLogin();
      const input = screen.getByPlaceholderText(/enter admin token/i);
      const button = screen.getByRole('button', { name: '进入控制台' });

      fireEvent.change(input, { target: { value: 'test' } });

      expect(button).toBeEnabled();
    });
  });
});
