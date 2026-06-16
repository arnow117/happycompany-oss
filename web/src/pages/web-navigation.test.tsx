import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Login } from './Login';
import { Setup } from './Setup';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getConfig: vi.fn().mockResolvedValue({ bots: {} }),
    saveAdminConfig: vi.fn().mockResolvedValue({}),
    login: vi.fn(),
    listBotBindings: vi.fn().mockResolvedValue({ employees: [], bindings: [] }),
    listTenants: vi.fn().mockResolvedValue({ tenants: [] }),
  },
}));

describe('Page Smoke Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Login page without crashing', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('HappyCompany');
  });

  it('renders Setup page without crashing', async () => {
    render(
      <MemoryRouter initialEntries={['/setup']}>
        <Routes>
          <Route path="/setup" element={<Setup />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('STEP 1 / 2');
  });

  it('renders Config page without crashing', async () => {
    const { Config } = await import('./Config');
    render(
      <MemoryRouter initialEntries={['/config']}>
        <Routes>
          <Route path="/config" element={<Config />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('配置');
  });
});
