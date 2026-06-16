import { describe, it, expect, vi } from 'vitest';
import { CollaborateService } from '../src/collaborate.js';

describe('CollaborateService', () => {
  describe('send', () => {
    it('resolves target by employee ID and returns response', async () => {
      const mockProtocol = {
        name: 'finance-agent',
        execute: vi.fn().mockResolvedValue({ text: '发票已开具', done: true, handoff: null }),
      };
      const employeeManager = {
        get: vi.fn().mockReturnValue({ app: { id: 'finance-agent', tenantName: 'acme' }, protocol: mockProtocol }),
        findByRole: vi.fn().mockReturnValue(undefined),
      };

      const service = new CollaborateService({ employeeManager } as any);
      const result = await service.send({
        tenant: 'acme',
        sourceEmployeeId: 'sales-zhangsan',
        target: 'finance-agent',
        message: '客户要开票',
        mode: 'sync',
      });

      expect(result.success).toBe(true);
      expect(result.reply).toBe('发票已开具');
      expect(employeeManager.get).toHaveBeenCalledWith('finance-agent');
      expect(mockProtocol.execute).toHaveBeenCalledWith(
        '客户要开票',
        expect.objectContaining({ chatId: expect.stringContaining('collab:') }),
      );
    });

    it('returns error when target not found', async () => {
      const employeeManager = {
        get: vi.fn().mockReturnValue(undefined),
        findByRole: vi.fn().mockReturnValue(undefined),
      };

      const service = new CollaborateService({ employeeManager } as any);
      const result = await service.send({
        tenant: 'acme',
        sourceEmployeeId: 'sales',
        target: 'nonexistent',
        message: 'help',
        mode: 'sync',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('resolves target by role name', async () => {
      const mockProtocol = {
        name: 'finance-wangwu',
        execute: vi.fn().mockResolvedValue({ text: 'done', done: true, handoff: null }),
      };
      const employeeManager = {
        get: vi.fn().mockReturnValue(undefined),
        findByRole: vi.fn().mockReturnValue({
          app: { id: 'finance-wangwu', tenantName: 'acme', role: 'finance' },
          protocol: mockProtocol,
        }),
      };

      const service = new CollaborateService({ employeeManager } as any);
      const result = await service.send({
        tenant: 'acme',
        sourceEmployeeId: 'sales-zhangsan',
        target: 'finance',
        message: '审批合同',
        mode: 'sync',
      });

      expect(result.success).toBe(true);
      expect(employeeManager.findByRole).toHaveBeenCalledWith('finance');
    });
  });
});
