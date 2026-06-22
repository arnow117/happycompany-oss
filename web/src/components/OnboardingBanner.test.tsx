import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingBanner } from './OnboardingBanner';
import * as api from '../lib/api';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/api', () => ({
  api: {
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

describe('OnboardingBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const renderWithRouter = (props: { isFullHeight?: boolean }) =>
    render(
      <MemoryRouter>
        <OnboardingBanner {...props} />
      </MemoryRouter>,
    );

  it('shows step 1 prompt when model not configured', async () => {
    vi.mocked(api.api.getBootstrapStatus).mockResolvedValue({
      configured: false,
      steps: { modelConfigured: false, employeeNetworkReady: false, peopleBound: false },
    });

    renderWithRouter({});

    const el = await screen.findByText('配置模型');
    expect(el).toBeInTheDocument();
    expect(screen.getByText('继续')).toBeInTheDocument();
    expect(screen.getByText('0/3')).toBeInTheDocument();
  });

  it('shows step 2 prompt when only model configured', async () => {
    vi.mocked(api.api.getBootstrapStatus).mockResolvedValue({
      configured: false,
      steps: { modelConfigured: true, employeeNetworkReady: false, peopleBound: false },
    });

    renderWithRouter({});

    const el = await screen.findByText('创建数字员工');
    expect(el).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('shows step 3 prompt when only people not bound', async () => {
    vi.mocked(api.api.getBootstrapStatus).mockResolvedValue({
      configured: false,
      steps: { modelConfigured: true, employeeNetworkReady: true, peopleBound: false },
    });

    renderWithRouter({});

    const el = await screen.findByText('绑定人员');
    expect(el).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('hides banner when all steps complete', async () => {
    vi.mocked(api.api.getBootstrapStatus).mockResolvedValue({
      configured: true,
      steps: { modelConfigured: true, employeeNetworkReady: true, peopleBound: true },
    });

    renderWithRouter({});

    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText(/下一步/)).not.toBeInTheDocument();
  });

  it('dismisses and stores in localStorage', async () => {
    vi.mocked(api.api.getBootstrapStatus).mockResolvedValue({
      configured: false,
      steps: { modelConfigured: false, employeeNetworkReady: false, peopleBound: false },
    });

    renderWithRouter({});
    await screen.findByText('配置模型');

    const dismissBtn = screen.getByRole('button', { name: '暂时隐藏' });
    await userEvent.click(dismissBtn);

    expect(localStorage.getItem('onboarding-dismissed')).toBe('true');
    expect(screen.queryByText(/下一步/)).not.toBeInTheDocument();
  });

  it('does not render when isFullHeight is true', async () => {
    vi.mocked(api.api.getBootstrapStatus).mockResolvedValue({
      configured: false,
      steps: { modelConfigured: false, employeeNetworkReady: false, peopleBound: false },
    });

    const { container } = renderWithRouter({ isFullHeight: true });

    await new Promise((r) => setTimeout(r, 100));
    expect(container.innerHTML).toBe('');
  });
});
