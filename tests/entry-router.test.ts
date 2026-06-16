import { describe, expect, it } from 'vitest';
import {
  parseSlashCommand,
  resolveEnterpriseEntryAgent,
  buildSelectorResponse,
  type EmployeeDirectory,
  type VisibleEmployee,
} from '../src/entry-router.js';

function makeEmployeeDirectory(
  ids: string[],
  bindings: Record<string, { id: string; tenantName: string }> = {},
): EmployeeDirectory {
  return {
    has: (id: string) => ids.includes(id),
    findByHumanUserId: (tenant: string, userId: string) => {
      const employee = bindings[userId];
      return employee?.tenantName === tenant ? employee.id : null;
    },
  };
}

const visibleEmployees: VisibleEmployee[] = [
  { id: 'sales-zhangsan', displayName: '销售张三', oneLiner: '查医院、查设备、记录销售活动' },
  { id: 'finance-lisi', displayName: '财务李四', oneLiner: '开票、报销审批、合同审核' },
  { id: 'maintenance-wangwu', displayName: '维修王五', oneLiner: '设备报修、工单跟踪' },
];

describe('entry router', () => {
  describe('parseSlashCommand', () => {
    it('returns null for non-slash command text', () => {
      const result = parseSlashCommand('hello world', visibleEmployees);
      expect(result).toBeNull();
    });

    it('handles /list command', () => {
      const result = parseSlashCommand('/list', visibleEmployees);
      expect(result).toEqual({
        handled: true,
        response: `请选择对话对象：
1. 销售张三 — 查医院、查设备、记录销售活动
2. 财务李四 — 开票、报销审批、合同审核
3. 维修王五 — 设备报修、工单跟踪

回复数字或名字即可。`,
      });
    });

    it('handles /list with no employees', () => {
      const result = parseSlashCommand('/list', []);
      expect(result).toEqual({
        handled: true,
        response: '当前没有可用的数字员工。',
      });
    });

    it('handles fuzzy name match via slash', () => {
      const result = parseSlashCommand('/张三', visibleEmployees);
      expect(result).toEqual({
        handled: true,
        response: '已为您切换到 销售张三',
        targetEmployeeId: 'sales-zhangsan',
      });
    });

    it('handles fuzzy id match via slash', () => {
      const result = parseSlashCommand('/finance', visibleEmployees);
      expect(result).toEqual({
        handled: true,
        response: '已为您切换到 财务李四',
        targetEmployeeId: 'finance-lisi',
      });
    });

    it('handles numeric selector reply', () => {
      const result = parseSlashCommand('2', visibleEmployees);
      expect(result).toEqual({
        handled: true,
        response: '已为您切换到 财务李四',
        targetEmployeeId: 'finance-lisi',
      });
    });

    it('handles numeric selector reply with common punctuation', () => {
      expect(parseSlashCommand('1.', visibleEmployees)?.targetEmployeeId).toBe('sales-zhangsan');
      expect(parseSlashCommand('3、', visibleEmployees)?.targetEmployeeId).toBe('maintenance-wangwu');
      expect(parseSlashCommand('/2', visibleEmployees)?.targetEmployeeId).toBe('finance-lisi');
      expect(parseSlashCommand('２', visibleEmployees)?.targetEmployeeId).toBe('finance-lisi');
    });

    it('handles out-of-range numeric selector reply', () => {
      const result = parseSlashCommand('9', visibleEmployees);
      expect(result).toEqual({
        handled: true,
        response: '没有第 9 个数字员工，请回复 /list 查看可选对象。',
      });
    });

    it('returns null for unknown employee via slash', () => {
      const result = parseSlashCommand('/unknown', visibleEmployees);
      expect(result).toBeNull();
    });

    it('handles just slash', () => {
      const result = parseSlashCommand('/', visibleEmployees);
      expect(result).toBeNull();
    });

    it('is case-insensitive for matching', () => {
      const result = parseSlashCommand('/ZHANGSAN', visibleEmployees);
      expect(result?.targetEmployeeId).toBe('sales-zhangsan');
    });

    it('handles plain name match without slash', () => {
      const result = parseSlashCommand('财务', visibleEmployees);
      expect(result?.targetEmployeeId).toBe('finance-lisi');
    });
  });

  describe('resolveEnterpriseEntryAgent', () => {
    it('returns null for non-employee-director mode', () => {
      const employees = makeEmployeeDirectory(['sales-zhangsan']);
      const botConfig = { routingMode: 'direct', tenant: 'acme' };
      expect(resolveEnterpriseEntryAgent(botConfig, employees, 'user-1')).toBeNull();
    });

    it('returns null when routingMode is undefined', () => {
      const employees = makeEmployeeDirectory(['sales-zhangsan']);
      const botConfig = { tenant: 'acme' };
      expect(resolveEnterpriseEntryAgent(botConfig, employees, 'user-1')).toBeNull();
    });

    it('routes to bound employee', () => {
      const employees = makeEmployeeDirectory(
        ['sales-zhangsan'],
        { 'user-1': { id: 'sales-zhangsan', tenantName: 'acme' } },
      );
      const botConfig = { routingMode: 'employee-director', tenant: 'acme' };
      expect(resolveEnterpriseEntryAgent(botConfig, employees, 'user-1')).toBe('sales-zhangsan');
    });

    it('returns null for user with no binding', () => {
      const employees = makeEmployeeDirectory(['sales-zhangsan']);
      const botConfig = { routingMode: 'employee-director', tenant: 'acme' };
      expect(resolveEnterpriseEntryAgent(botConfig, employees, 'unbound-user')).toBeNull();
    });

    it('respects tenant when looking up bindings', () => {
      const employees = makeEmployeeDirectory(
        ['sales-zhangsan', 'finance-lisi'],
        { 'user-1': { id: 'sales-zhangsan', tenantName: 'tenant-a' } },
      );
      const botConfig = { routingMode: 'employee-director', tenant: 'tenant-b' };
      expect(resolveEnterpriseEntryAgent(botConfig, employees, 'user-1')).toBeNull();
    });

    it('passes prompt to findByHumanUserId', () => {
      const findByHumanUserIdCalls: Array<[string, string, string | undefined]> = [];
      const employees: EmployeeDirectory = {
        has: () => true,
        findByHumanUserId: (tenant, userId, prompt) => {
          findByHumanUserIdCalls.push([tenant, userId, prompt]);
          return prompt?.includes('维修') ? 'maintenance-wangwu' : null;
        },
      };
      const botConfig = { routingMode: 'employee-director', tenant: 'acme' };
      const result = resolveEnterpriseEntryAgent(botConfig, employees, 'user-1', '设备需要维修');
      expect(result).toBe('maintenance-wangwu');
      expect(findByHumanUserIdCalls).toEqual([['acme', 'user-1', '设备需要维修']]);
    });
  });

  describe('buildSelectorResponse', () => {
    it('builds formatted response with one-liners', () => {
      const response = buildSelectorResponse(visibleEmployees);
      expect(response).toContain('请选择对话对象：');
      expect(response).toContain('1. 销售张三 — 查医院、查设备、记录销售活动');
      expect(response).toContain('2. 财务李四 — 开票、报销审批、合同审核');
      expect(response).toContain('回复数字或名字即可。');
    });

    it('builds response without one-liners when missing', () => {
      const noOneLiner: VisibleEmployee[] = [
        { id: 'test-1', displayName: '测试员工1' },
        { id: 'test-2', displayName: '测试员工2' },
      ];
      const response = buildSelectorResponse(noOneLiner);
      expect(response).toContain('1. 测试员工1');
      expect(response).toContain('2. 测试员工2');
    });

    it('handles empty employee list', () => {
      const response = buildSelectorResponse([]);
      expect(response).toBe('当前没有可用的数字员工。');
    });
  });

  describe('pipeline integration', () => {
    const employees = makeEmployeeDirectory(
      ['sales-zhangsan', 'finance-lisi'],
      { 'user-1': { id: 'sales-zhangsan', tenantName: 'acme' } },
    );
    const botConfig = { routingMode: 'employee-director' as const, tenant: 'acme' };

    it('bound user sends plain message → routes to entryEmployee', () => {
      const result = resolveEnterpriseEntryAgent(botConfig, employees, 'user-1');
      expect(result).toBe('sales-zhangsan');
    });

    it('bound user sends slash command → parseSlashCommand handles it', () => {
      const slash = parseSlashCommand('/list', visibleEmployees);
      expect(slash?.handled).toBe(true);
      expect(slash?.response).toContain('销售张三');
    });

    it('unbound user sends message → resolveEnterpriseEntryAgent returns null', () => {
      const result = resolveEnterpriseEntryAgent(botConfig, employees, 'unbound-user');
      expect(result).toBeNull();
    });

    it('unbound user gets selector response', () => {
      const response = buildSelectorResponse(visibleEmployees);
      expect(response).toContain('请选择对话对象');
      expect(response).toContain('1. 销售张三');
      expect(response).toContain('3. 维修王五');
    });

    it('routingMode bound routes directly without slash', () => {
      const boundConfig = { routingMode: 'employee-director' as const, tenant: 'acme' };
      const result = resolveEnterpriseEntryAgent(boundConfig, employees, 'user-1');
      expect(result).toBe('sales-zhangsan');
    });

    it('slash command matches only within visibleEmployees', () => {
      const result = parseSlashCommand('/unknown-person', visibleEmployees);
      expect(result).toBeNull();
    });

    it('findByHumanUserId receives prompt for context-aware routing', () => {
      const contextEmployees: EmployeeDirectory = {
        has: (id: string) => ['maintenance-wangwu'].includes(id),
        findByHumanUserId: (_tenant: string, _userId: string, prompt?: string) =>
          prompt?.includes('维修') ? 'maintenance-wangwu' : null,
      };
      const result = resolveEnterpriseEntryAgent(
        { routingMode: 'employee-director', tenant: 'acme' },
        contextEmployees,
        'user-1',
        '设备需要维修',
      );
      expect(result).toBe('maintenance-wangwu');
    });
  });
});
