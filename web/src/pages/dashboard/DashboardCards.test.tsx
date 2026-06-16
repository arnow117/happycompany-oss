import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetricCard, BotCard, ActionLink, ErrorBlock } from './DashboardCards';
import type { BotInfo } from '../../lib/api';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('MetricCard', () => {
  it('renders label and value', () => {
    render(<MetricCard label="Total Bots" value="3" />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Total Bots')).toBeInTheDocument();
  });
});

describe('BotCard', () => {
  const baseBot: BotInfo = {
    name: 'helper',
    displayName: 'Helper Bot',
    status: 'running',
    channel: 'feishu',
    workdir: '/app',
    model: 'claude-sonnet',
  };

  it('shows displayName, channel, and status', () => {
    renderWithRouter(<BotCard bot={baseBot} />);
    expect(screen.getByText('Helper Bot')).toBeInTheDocument();
    expect(screen.getByText(/feishu/)).toBeInTheDocument();
    expect(screen.getByText(/直连/)).toBeInTheDocument();
  });

  it('shows green dot for running status', () => {
    const { container } = renderWithRouter(<BotCard bot={baseBot} />);
    const dot = container.querySelector('.online-indicator');
    expect(dot).toBeTruthy();
  });

  it('shows gray dot for stopped status', () => {
    const stoppedBot = { ...baseBot, status: 'stopped' as const };
    const { container } = renderWithRouter(<BotCard bot={stoppedBot} />);
    const dot = container.querySelector('.offline-indicator');
    expect(dot).toBeTruthy();
  });

  it('falls back to name when no displayName', () => {
    const bot = { ...baseBot, displayName: '' };
    renderWithRouter(<BotCard bot={bot} />);
    expect(screen.getByText('helper')).toBeInTheDocument();
    expect(screen.queryByText('Helper Bot')).not.toBeInTheDocument();
  });
});

describe('ActionLink', () => {
  it('renders as a link with label and arrow', () => {
    renderWithRouter(<ActionLink to="/skills-marketplace" label="View Skills" />);
    const link = screen.getByRole('link', { name: /View Skills/ });
    expect(link).toHaveAttribute('href', '/skills-marketplace');
    expect(screen.getByText('View Skills')).toBeInTheDocument();
    // Arrow character is present
    expect(link.textContent).toContain('→');
  });
});

describe('ErrorBlock', () => {
  it('renders error message', () => {
    render(<ErrorBlock message="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});
