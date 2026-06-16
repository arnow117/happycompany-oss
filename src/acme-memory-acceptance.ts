import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryManager } from './memory.js';

export interface AcmeMemoryAcceptanceInput {
  dataDir: string;
  corpDir: string;
  tenant: string;
}

interface MemorySearchReport {
  query: string;
  results: Array<{ file: string; line: number; context: string }>;
}

interface EmployeeMemoryReport {
  employeeId: string;
  sources: Array<{ file: string; type: string; size: number }>;
  searches: MemorySearchReport[];
}

export interface AcmeMemoryAcceptanceReport {
  status: 'passed' | 'failed';
  mode: 'memory-acceptance';
  tenant: string;
  dataDir: string;
  corpDir: string;
  date: string;
  targetModified: false;
  employees: EmployeeMemoryReport[];
}

const MEMORY_DATE = '2026-06-04';

const memories = [
  {
    employeeId: 'finance-wangwu',
    content: [
      '# Acme Flow A contract memory',
      '客户: 江山市人民医院',
      '设备: GE16排 CT',
      '合同: jsrm-540ct-full-service',
      '维保周期: 每半年一次',
      '付款规则: 每服务满半年并验收合格后付款',
      '需要跟进: 杭州示例医疗中标项目 330382263180160000008-WZLCZB-2026-03047 合同链接缺失时由销售补齐。',
    ].join('\n'),
    queries: ['江山市人民医院', '每半年', '杭州示例医疗'],
  },
  {
    employeeId: 'maintenance-lisi',
    content: [
      '# Acme Flow B service memory',
      '维修任务: task-jsrm-ge16ct-2026h2',
      'SERVICE RECORD: sr-jsrm-540ct-001',
      '现场结论: GE16排 CT 半年维保完成，扫描床和高压系统检查正常。',
      '客户签字: yes',
      '财务回传: settlement-jsrm-540ct-sr-001 可按合同付款规则归档。',
    ].join('\n'),
    queries: ['SERVICE RECORD', '扫描床', 'settlement-jsrm-540ct-sr-001'],
  },
];

export function runAcmeMemoryAcceptance(input: AcmeMemoryAcceptanceInput): AcmeMemoryAcceptanceReport {
  mkdirSync(input.dataDir, { recursive: true });
  mkdirSync(input.corpDir, { recursive: true });

  const manager = new MemoryManager(input.dataDir, {
    subjectDirResolver: (subject, tenant) => {
      if (tenant !== input.tenant) return undefined;
      return join(input.corpDir, tenant, 'agents', subject);
    },
  });

  const employees = memories.map((memory) => {
    manager.appendMemory(memory.employeeId, memory.content, MEMORY_DATE, input.tenant);
    return {
      employeeId: memory.employeeId,
      sources: manager.listSources(memory.employeeId, input.tenant),
      searches: memory.queries.map((query) => ({
        query,
        results: manager.searchMemory(memory.employeeId, query, 5, input.tenant),
      })),
    };
  });

  return {
    status: employees.every((employee) => employee.sources.length > 0
      && employee.searches.every((search) => search.results.length > 0))
      ? 'passed'
      : 'failed',
    mode: 'memory-acceptance',
    tenant: input.tenant,
    dataDir: input.dataDir,
    corpDir: input.corpDir,
    date: MEMORY_DATE,
    targetModified: false,
    employees,
  };
}
