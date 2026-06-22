import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Layout } from './Layout';

function renderLayout(needsSetup = false) {
  return render(
    <BrowserRouter>
      <Layout needsSetup={needsSetup} />
    </BrowserRouter>,
  );
}

describe('Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Navigation Groups', () => {
    test('renders all navigation groups', () => {
      renderLayout();

      expect(screen.getByText('日常工作')).toBeInTheDocument();
      expect(screen.getByText('员工与能力')).toBeInTheDocument();
      expect(screen.getByText('系统')).toBeInTheDocument();
      expect(screen.queryByText('高级/诊断')).not.toBeInTheDocument();
      expect(screen.queryByText('蓝图/实验')).not.toBeInTheDocument();
    });

    test('日常工作 group contains live tenant operations', () => {
      renderLayout();

      expect(screen.getByText('日常工作')).toBeInTheDocument();
      expect(screen.getByText('对话')).toBeInTheDocument();
      expect(screen.getByText('会话')).toBeInTheDocument();
      expect(screen.getByText('知识库')).toBeInTheDocument();
      expect(screen.getByText('多员工工作流')).toBeInTheDocument();
    });

    test('员工与能力 group contains builder, employee, people, and marketplace', () => {
      renderLayout();

      expect(screen.getByText('员工与能力')).toBeInTheDocument();
      expect(screen.getByText('员工 Builder')).toBeInTheDocument();
      expect(screen.getByText('数字员工')).toBeInTheDocument();
      expect(screen.getByText('企业员工')).toBeInTheDocument();
      expect(screen.getByText('技能市场')).toBeInTheDocument();
    });

    test('系统 group contains dashboard, config, memory and harness', () => {
      renderLayout();

      expect(screen.getByText('系统')).toBeInTheDocument();
      expect(screen.getByText('概览')).toBeInTheDocument();
      expect(screen.getByText('配置')).toBeInTheDocument();
      expect(screen.getByText('记忆')).toBeInTheDocument();
      expect(screen.getByText('验收')).toBeInTheDocument();
    });

    test('legacy standalone pages are not first-class navigation items', () => {
      renderLayout();

      expect(screen.queryByText('入口路由')).not.toBeInTheDocument();
      expect(screen.queryByText('人员绑定')).not.toBeInTheDocument();
      expect(screen.queryByText('员工网络')).not.toBeInTheDocument();
      expect(screen.queryByText('员工配置')).not.toBeInTheDocument();
      expect(screen.queryByText('Agent Status')).not.toBeInTheDocument();
      expect(screen.queryByText('Scheduler')).not.toBeInTheDocument();
    });

    test('de-badged nav: production/build/ops items carry no tier badge', () => {
      renderLayout();

      // Restyle removed the per-item tier badges (group titles carry the layer);
      // only `preview` items would show a 预览 badge, and there are none.
      expect(screen.queryByText('可用')).not.toBeInTheDocument();
      expect(screen.queryByText('构建')).not.toBeInTheDocument();
      expect(screen.queryByText('运维')).not.toBeInTheDocument();
    });

    test('renders Logout button', () => {
      renderLayout();

      expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
    });

    test('renders brand section', () => {
      renderLayout();

      expect(screen.getByText('HappyCompany')).toBeInTheDocument();
    });

    test('shows setup link when needsSetup is true', () => {
      renderLayout(true);

      expect(screen.getByText('模型配置')).toBeInTheDocument();
    });

    test('does not show setup link when needsSetup is false', () => {
      renderLayout(false);

      const setupLinks = screen.queryAllByText('模型配置');
      expect(setupLinks.length).toBe(0);
    });

    test('shows backend availability status when health check succeeds', async () => {
      renderLayout();

      await waitFor(() => expect(screen.getByLabelText('后端可用')).toBeInTheDocument());
      expect(fetch).toHaveBeenCalledWith('/api/health', { headers: { Accept: 'application/json' } });
    });

    test('shows backend unavailable status when health check fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
      renderLayout();

      await waitFor(() => expect(screen.getByLabelText('后端不可用')).toBeInTheDocument());
    });
  });
});
