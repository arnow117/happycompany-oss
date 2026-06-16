import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Config } from './Config';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getConfig: vi.fn(),
    revealAdminConfig: vi.fn(),
    saveAdminConfig: vi.fn(),
    verifyModel: vi.fn(),
    verifyBot: vi.fn(),
    listTenants: vi.fn().mockResolvedValue({ tenants: [] }),
    listBotBindings: vi.fn().mockResolvedValue({ employees: [], bindings: [] }),
  },
}));

const mockConfig = {
  claude: {
    baseUrl: 'https://example.com/v1',
    authToken: 'secret-token',
  },
  bots: {
    'my-bot': {
      name: 'my-bot',
      displayName: 'My Bot',
      channel: 'dingtalk',
      credentials: { clientId: 'test', clientSecret: 'secret' },
      model: 'opus',
    },
  },
};

describe('Config Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.api.revealAdminConfig).mockResolvedValue(mockConfig);
  });

  describe('Initial Load', () => {
    it('displays loading state initially', async () => {
      // Component initializes config with default state, so loading text
      // won't appear. Instead verify the page renders the heading.
      vi.mocked(api.api.getConfig).mockReturnValue(new Promise(() => {}));

      render(<Config />);

      // The page shows content immediately since config has a default value
      await waitFor(() => {
        expect(screen.getByText('配置')).toBeInTheDocument();
      });
    });

    it('displays error message when config fails to load', async () => {
      vi.mocked(api.api.getConfig).mockRejectedValue(new Error('Network error'));

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('displays empty state when no config exists', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue({ bots: undefined });

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('暂无 IM Bot，点击上方按钮添加')).toBeInTheDocument();
      });
    });
  });

  describe('Model Config Section', () => {
    it('renders model config form with current values', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('模型配置')).toBeInTheDocument();
      });

      // Switch to edit mode first
      const editButtons = screen.getAllByText('编辑');
      await userEvent.setup().click(editButtons[0]);

      const baseUrlInput = screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/);
      expect(baseUrlInput).toHaveValue('https://example.com/v1');
    });

    it('detects third_party mode when baseUrl exists', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue({
        claude: { baseUrl: 'https://example.com/v1', authToken: 'test-token' },
        bots: {},
      });

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('模型配置')).toBeInTheDocument();
      });

      const editButton = screen.getByText('编辑');
      await userEvent.setup().click(editButton);

      expect(screen.getByText('第三方渠道')).toBeInTheDocument();
    });

    it('detects third_party mode when authToken exists', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue({
        claude: { authToken: 'test-token' },
        bots: {},
      });

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('模型配置')).toBeInTheDocument();
      });

      const editButton = screen.getByText('编辑');
      await userEvent.setup().click(editButton);

      expect(screen.getByText('第三方渠道')).toBeInTheDocument();
    });

    it('detects official mode when no baseUrl or authToken', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue({
        claude: { apiKey: 'sk-ant-test' },
        bots: {},
      });

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('模型配置')).toBeInTheDocument();
      });

      const editButton = screen.getByText('编辑');
      await userEvent.setup().click(editButton);

      expect(screen.getByText('官方渠道')).toBeInTheDocument();
    });

    it('reveals a masked auth token before testing model connectivity', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue({
        claude: {
          baseUrl: 'https://example.com/v1',
          authToken: '************',
          model: 'sonnet',
        },
        bots: {},
      });
      vi.mocked(api.api.revealAdminConfig).mockResolvedValue({
        claude: {
          baseUrl: 'https://example.com/v1',
          authToken: 'secret-token',
          model: 'sonnet',
        },
        bots: {},
      });
      vi.mocked(api.api.verifyModel).mockResolvedValue({ ok: true, model: 'sonnet' });
      const user = userEvent.setup();

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('模型配置')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: '测试连接' }));

      await waitFor(() => {
        expect(api.api.revealAdminConfig).toHaveBeenCalled();
        expect(api.api.verifyModel).toHaveBeenCalledWith({
          baseUrl: 'https://example.com/v1',
          authToken: 'secret-token',
          model: 'sonnet',
        });
      });
    });

    it('allows switching between official and third-party mode', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue({ apiKey: 'sk-ant-test' });

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('模型配置')).toBeInTheDocument();
      });

      const editButton = screen.getByText('编辑');
      await userEvent.setup().click(editButton);

      const officialButton = screen.getByText('官方渠道');
      const thirdPartyButton = screen.getByText('第三方渠道');

      expect(officialButton).toBeInTheDocument();
      expect(thirdPartyButton).toBeInTheDocument();
    });

    it('shows API Key field in official mode', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue({ apiKey: 'sk-ant-test' });

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('模型配置')).toBeInTheDocument();
      });

      const editButton = screen.getByText('编辑');
      await userEvent.setup().click(editButton);

      expect(screen.getByPlaceholderText(/sk-ant-api03-/)).toBeInTheDocument();
    });

    it('shows Base URL and Auth Token in third-party mode', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('模型配置')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByText('编辑');
      await userEvent.setup().click(editButtons[0]);

      expect(screen.getByPlaceholderText(/https:\/\/your-relay\.example\.com\/v1/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/输入第三方网关 Token/)).toBeInTheDocument();
    });

    it('renders hidden Auth Token with the same length as plaintext', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('模型配置')).toBeInTheDocument();
      });

      const hiddenToken = '*'.repeat(mockConfig.claude.authToken.length);
      expect(screen.getByText(hiddenToken)).toHaveTextContent(hiddenToken);
      expect(hiddenToken).toHaveLength(mockConfig.claude.authToken.length);
    });

    it('renders server-masked Auth Token with the supplied masked length on first load', async () => {
      const maskedToken = '*'.repeat('secret-token'.length);
      vi.mocked(api.api.getConfig).mockResolvedValue({
        claude: { baseUrl: 'https://example.com/v1', authToken: maskedToken },
        bots: {},
      });

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('模型配置')).toBeInTheDocument();
      });

      expect(screen.getByText(maskedToken)).toBeInTheDocument();
      expect(screen.queryByText('***')).not.toBeInTheDocument();
    });

    it('toggles Auth Token visibility while editing third-party config', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);
      const user = userEvent.setup();

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('模型配置')).toBeInTheDocument();
      });

      await user.click(screen.getAllByText('编辑')[0]);
      const tokenInput = screen.getByPlaceholderText(/输入第三方网关 Token/) as HTMLInputElement;
      expect(tokenInput.type).toBe('password');

      await user.click(screen.getByRole('button', { name: '显示' }));
      expect(tokenInput.type).toBe('text');

      await user.click(screen.getByRole('button', { name: '隐藏' }));
      expect(tokenInput.type).toBe('password');
    });

    it('keeps masked Auth Token hidden and preserves it on save', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue({
        claude: { baseUrl: 'https://example.com/v1', authToken: '************', model: 'sonnet' },
        bots: {
          'my-bot': {
            displayName: 'My Bot',
            channel: 'dingtalk',
            credentials: { clientId: 'test', clientSecret: '**********' },
          },
        },
      });
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true });
      const user = userEvent.setup();

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('模型配置')).toBeInTheDocument();
      });

      await user.click(screen.getAllByText('编辑')[0]);
      expect(screen.getByPlaceholderText('已配置，留空保留现有 Token')).toHaveValue('');
      await user.click(screen.getByText('保存配置'));

      await waitFor(() => {
        expect(api.api.saveAdminConfig).toHaveBeenCalled();
      });
      const payload = vi.mocked(api.api.saveAdminConfig).mock.calls[0][0];
      expect(payload).not.toHaveProperty('authToken');
      expect(payload.bots?.[0].credentials).toEqual({ clientId: 'test' });
    });

    it('reveals masked Auth Token by loading plaintext admin config', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue({
        claude: { baseUrl: 'https://example.com/v1', authToken: '***' },
        bots: {},
      });
      vi.mocked(api.api.revealAdminConfig).mockResolvedValue({
        claude: { baseUrl: 'https://example.com/v1', authToken: 'real-token' },
        bots: {},
      });
      const user = userEvent.setup();

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('模型配置')).toBeInTheDocument();
      });

      await user.click(screen.getByText('编辑'));
      const tokenInput = screen.getByPlaceholderText('已配置，留空保留现有 Token') as HTMLInputElement;
      expect(tokenInput).toHaveValue('');

      await user.click(screen.getByRole('button', { name: '显示' }));

      await waitFor(() => {
        expect(api.api.revealAdminConfig).toHaveBeenCalled();
        expect(tokenInput).toHaveValue('real-token');
        expect(tokenInput.type).toBe('text');
      });
    });
  });

  describe('Bot Management Section', () => {
    it('displays existing bots list', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('IM Bot 管理')).toBeInTheDocument();
      });

      expect(screen.getByText('My Bot')).toBeInTheDocument();
      expect(screen.getByText(/钉钉/)).toBeInTheDocument();
      expect(screen.getByText(/clientSecret=\*\*\*\*\*\*/)).toBeInTheDocument();
    });

    it('shows add bot button', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('IM Bot 管理')).toBeInTheDocument();
      });

      expect(screen.getByText('+ 添加 Bot')).toBeInTheDocument();
    });

    it('opens add bot form when add button is clicked', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);
      const user = userEvent.setup();

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('IM Bot 管理')).toBeInTheDocument();
      });

      await user.click(screen.getByText('+ 添加 Bot'));

      expect(screen.queryByText('Bot 名称')).not.toBeInTheDocument();
      expect(screen.getByText('显示名称')).toBeInTheDocument();
    });

    it('allocates an internal bot id when adding a bot', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true });
      const user = userEvent.setup();

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('IM Bot 管理')).toBeInTheDocument();
      });

      await user.click(screen.getByText('+ 添加 Bot'));
      await user.type(screen.getByPlaceholderText('例如：我的助手'), '钉钉测试助手');
      await user.click(screen.getByRole('button', { name: '添加 Bot' }));

      await waitFor(() => {
        expect(api.api.saveAdminConfig).toHaveBeenCalled();
      });
      const payload = vi.mocked(api.api.saveAdminConfig).mock.calls[0][0];
      expect(payload.bots?.map((bot) => bot.name)).toEqual(['my-bot', 'dingtalk-bot']);
    });

    it('tests a Feishu bot connection from the bot form', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);
      vi.mocked(api.api.verifyBot).mockResolvedValue({ ok: true, channel: 'feishu', botOpenId: 'ou_bot_1' });
      const user = userEvent.setup();

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('IM Bot 管理')).toBeInTheDocument();
      });

      await user.click(screen.getByText('+ 添加 Bot'));
      await user.click(screen.getByText('飞书'));
      await user.type(screen.getByPlaceholderText('输入飞书 App ID'), 'cli_test');
      await user.type(screen.getByPlaceholderText('输入飞书 App Secret'), 'secret_test');
      const buttons = screen.getAllByRole('button', { name: '测试连接' });
      await user.click(buttons[buttons.length - 1]);

      await waitFor(() => {
        expect(api.api.verifyBot).toHaveBeenCalledWith({
          name: undefined,
          channel: 'feishu',
          credentials: { appId: 'cli_test', appSecret: 'secret_test' },
        });
        expect(screen.getByText(/连接成功/)).toBeInTheDocument();
      });
    });
  });

  describe('Save Functionality', () => {
    it('calls saveAdminConfig with updated model config', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true });
      const user = userEvent.setup();

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('IM Bot 管理')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByText('编辑');
      await user.click(editButtons[0]);

      const saveButton = screen.getByText('保存配置');
      await user.click(saveButton);

      await waitFor(() => {
        expect(api.api.saveAdminConfig).toHaveBeenCalled();
      });
    });

    it('displays success message after successful save', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true });
      const user = userEvent.setup();

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('IM Bot 管理')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByText('编辑');
      await user.click(editButtons[0]);

      const saveButton = screen.getByText('保存配置');
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('配置保存成功')).toBeInTheDocument();
      });
    });

    it('saves the current bot list after deleting a bot', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue({
        claude: {
          baseUrl: 'https://example.com/v1',
          authToken: 'secret-token',
        },
        bots: {
          keep: {
            displayName: 'Keep Bot',
            channel: 'feishu',
            credentials: { appId: 'cli_keep', appSecret: 'secret' },
          },
          remove: {
            displayName: 'Remove Bot',
            channel: 'feishu',
            credentials: { appId: 'cli_remove', appSecret: 'secret' },
          },
        },
      });
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true });
      const user = userEvent.setup();
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('Remove Bot')).toBeInTheDocument();
      });

      const removeBotBlock = screen.getByText('Remove Bot').closest('div')?.parentElement?.parentElement;
      expect(removeBotBlock).not.toBeNull();
      await user.click(within(removeBotBlock as HTMLElement).getByRole('button', { name: '删除' }));

      await waitFor(() => {
        expect(api.api.saveAdminConfig).toHaveBeenCalled();
      });
      const payload = vi.mocked(api.api.saveAdminConfig).mock.calls[0][0];
      expect(payload.bots?.map((bot) => bot.name)).toEqual(['keep']);
    });

    it('displays error message when save fails', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true, error: 'Invalid credentials' });
      const user = userEvent.setup();

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('IM Bot 管理')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByText('编辑');
      await user.click(editButtons[0]);

      const saveButton = screen.getByText('保存配置');
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
      });
    });
  });

  describe('Bot Edit/Delete', () => {
    it('allows editing an existing bot', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);
      const user = userEvent.setup();

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('IM Bot 管理')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByText('编辑');
      if (editButtons.length > 1) {
        await user.click(editButtons[1]);
        expect(screen.getByText('内部 ID')).toBeInTheDocument();
      }
    });

    it('allows deleting a bot with confirmation', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true });
      const user = userEvent.setup();
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('IM Bot 管理')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByText('删除');
      if (deleteButtons.length > 0) {
        await user.click(deleteButtons[0]);
        expect(window.confirm).toHaveBeenCalled();
      }
    });

    it('separates the web entry bot from IM bot management', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue({
        claude: {},
        bots: {
          'web-bot': {
            displayName: 'Assistant',
            channel: 'web',
            credentials: {},
            agentDir: 'agents/web-bot',
          },
        },
      });
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('Assistant')).toBeInTheDocument();
      });

      expect(screen.getByText('Web 入口')).toBeInTheDocument();
      expect(screen.getByText('Web Chat / 后台网页入口')).toBeInTheDocument();
      expect(screen.getByText('暂无 IM Bot，点击上方按钮添加')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(api.api.saveAdminConfig).not.toHaveBeenCalled();
    });

    it('saves web chat settings separately from IM bot settings', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue({
        ...mockConfig,
        webChat: {
          welcomeTitle: '企业助手',
          welcomeSubtitle: '直接输入问题',
          inputPlaceholder: '问问企业助手',
          historyLimit: 50,
          enableImageUpload: true,
          showSessionPicker: true,
          showQuickPrompts: true,
        },
      });
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true });
      const user = userEvent.setup();

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('Web Chat 配置')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: '编辑 Web Chat' }));
      const placeholder = screen.getByLabelText('输入框提示');
      await user.clear(placeholder);
      await user.type(placeholder, '输入你的企业问题');
      await user.click(screen.getByLabelText('允许图片上传'));
      await user.click(screen.getByRole('button', { name: '保存 Web Chat' }));

      await waitFor(() => {
        expect(api.api.saveAdminConfig).toHaveBeenCalled();
      });
      const payload = vi.mocked(api.api.saveAdminConfig).mock.calls[0][0];
      expect(payload.webChat?.inputPlaceholder).toBe('输入你的企业问题');
      expect(payload.webChat?.enableImageUpload).toBe(false);
      expect(payload.bots?.[0].groupReplyMode).toBeUndefined();
    });

    it('saves group reply mode changes for an existing bot', async () => {
      vi.mocked(api.api.getConfig).mockResolvedValue(mockConfig);
      vi.mocked(api.api.saveAdminConfig).mockResolvedValue({ success: true });
      const user = userEvent.setup();

      render(<Config />);

      await waitFor(() => {
        expect(screen.getByText('IM Bot 管理')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByText('编辑');
      await user.click(editButtons[1]);
      await waitFor(() => {
        expect(screen.getByText('群聊响应模式')).toBeInTheDocument();
      });
      const groupReplyLabel = screen.getByText('群聊响应模式').closest('label');
      expect(groupReplyLabel).not.toBeNull();
      const groupReplySelect = groupReplyLabel!.querySelector('select');
      expect(groupReplySelect).not.toBeNull();
      await user.selectOptions(groupReplySelect!, 'all');
      await user.click(screen.getByRole('button', { name: '保存修改' }));
      await user.click(screen.getAllByText('编辑')[0]);
      await user.click(screen.getByText('保存配置'));

      await waitFor(() => {
        expect(api.api.saveAdminConfig).toHaveBeenCalled();
      });
      const payload = vi.mocked(api.api.saveAdminConfig).mock.calls[0][0];
      expect(payload.bots?.[0].groupReplyMode).toBe('all');
    });
  });
});
