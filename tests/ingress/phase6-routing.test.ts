import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MessageStore } from '../../src/store.js';
import { MessageBus } from '../../src/bus.js';
import { MessageIngressRuntime } from '../../src/ingress/runtime.js';
import type { AgentFactory } from '../../src/bot.js';
import {
  loadCaseFromFile,
  runHarnessCase,
  formatResult,
} from '../../src/ingress/adapters/harness.js';

const FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'harness');

/**
 * Routing simulator stands in for the real `agentFactory.respond()` from
 * src/index.ts. It exercises the SAME RespondOptions hook surface
 * (onRoutingDecision / onToolStart / onMemoryOp / onHandoff) that the real
 * factory now emits — so this test proves the Runtime → Recorder wiring is
 * intact end-to-end, without needing to boot the full server.
 *
 * When the real agentFactory is later refactored into a standalone module,
 * swap this simulator for that module and the assertions stay the same.
 */
function buildRoutingSimulator(): AgentFactory {
  return {
    async respond(_prompt, chatId, _botName, opts) {
      switch (chatId) {
        case 'harness-bound-user': {
          opts?.onRoutingDecision?.({
            mode: 'employee-director',
            selectedEmployee: 'sales-zhangsan',
            boundEmployee: 'sales-zhangsan',
            selectorShown: false,
          });
          return '已检索浙一医院最近三份合同，下面给出摘要。';
        }
        case 'harness-selector-shown': {
          opts?.onRoutingDecision?.({
            mode: 'employee-director',
            selectorShown: true,
          });
          return '请选择数字员工';
        }
        case 'harness-selector-cmd': {
          opts?.onRoutingDecision?.({
            mode: 'employee-director',
            selectedEmployee: 'sales-zhangsan',
            boundEmployee: 'sales-zhangsan',
          });
          return '已切换数字员工 销售-张三，请继续发送业务问题。';
        }
        case 'harness-sales-tool': {
          opts?.onRoutingDecision?.({
            mode: 'employee-director',
            selectedEmployee: 'sales-zhangsan',
          });
          opts?.onToolStart?.({
            toolName: 'med_crm:global_search',
            toolUseId: 'sim-tool-1',
          });
          opts?.onToolEnd?.({
            toolName: 'med_crm:global_search',
            toolUseId: 'sim-tool-1',
            elapsedMs: 32,
          });
          return '已经为你查询浙一医院最近的维保合同，状态正常。';
        }
        case 'harness-memory': {
          opts?.onRoutingDecision?.({
            mode: 'employee-director',
            selectedEmployee: 'sales-zhangsan',
          });
          opts?.onMemoryOp?.({
            operation: 'append',
            subject: 'sales-zhangsan',
            workspace: 'corp/acme/agents/sales-zhangsan',
          });
          return '已记录到销售员工的记忆中。';
        }
        case 'harness-handoff': {
          opts?.onRoutingDecision?.({
            mode: 'employee-director',
            selectedEmployee: 'sales-zhangsan',
          });
          opts?.onHandoff?.({
            from: 'sales-zhangsan',
            to: 'service-li',
            reason: 'after-sale',
          });
          return '已将本工单移交给售后员工 服务-李四 处理。';
        }
        case 'harness-blocked': {
          opts?.onRoutingDecision?.({
            mode: 'employee-director',
            selectorShown: false,
          });
          return '您尚未绑定个人数字员工，请在企业员工页面完成绑定后重试。';
        }
        default:
          return '[simulator] no scripted response';
      }
    },
    clearSession: () => true,
    clearAllSessions: () => 0,
    listSessions: () => [],
  };
}

function setupRuntime(agent: AgentFactory) {
  const dir = mkdtempSync(join(tmpdir(), 'phase6-'));
  const store = new MessageStore(join(dir, 'h.db'));
  const bus = new MessageBus();
  const runtime = new MessageIngressRuntime({ agentFactory: agent, store, bus });
  return { runtime, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const PHASE6_CASES = [
  'bound-user-default-employee.yaml',
  'selector-visible-employees.yaml',
  'selector-command-selects-employee.yaml',
  'sales-query-uses-med-crm.yaml',
  'memory-scoped-to-employee.yaml',
  'handoff-records-trace.yaml',
  'unbound-user-blocked.yaml',
];

describe('Phase 6 routing fixtures', () => {
  it('all 7 spec §6 cases exist as YAML', () => {
    const files = new Set(readdirSync(FIXTURE_DIR));
    for (const f of PHASE6_CASES) {
      expect(files.has(f), `missing fixture: ${f}`).toBe(true);
    }
  });

  for (const file of PHASE6_CASES) {
    it(`passes case ${file} against the routing simulator`, async () => {
      const testCase = loadCaseFromFile(join(FIXTURE_DIR, file));
      const { runtime, cleanup } = setupRuntime(buildRoutingSimulator());
      try {
        const result = await runHarnessCase(runtime, testCase);
        if (result.status !== 'passed') {
          // Surface the diff so failures are debuggable in CI.
          throw new Error(`Case failed:\n${formatResult(result)}`);
        }
        expect(result.status).toBe('passed');
        expect(result.failures).toEqual([]);
      } finally {
        cleanup();
      }
    });
  }

  it('routing decisions land in IngressTrace.routing', async () => {
    const testCase = loadCaseFromFile(join(FIXTURE_DIR, 'bound-user-default-employee.yaml'));
    const { runtime, cleanup } = setupRuntime(buildRoutingSimulator());
    try {
      const result = await runHarnessCase(runtime, testCase);
      expect(result.ingress?.trace.routing).toMatchObject({
        mode: 'employee-director',
        selectedEmployee: 'sales-zhangsan',
        selectorShown: false,
      });
    } finally {
      cleanup();
    }
  });

  it('handoff hook lands in IngressTrace.handoffs', async () => {
    const testCase = loadCaseFromFile(join(FIXTURE_DIR, 'handoff-records-trace.yaml'));
    const { runtime, cleanup } = setupRuntime(buildRoutingSimulator());
    try {
      const result = await runHarnessCase(runtime, testCase);
      expect(result.ingress?.trace.handoffs).toHaveLength(1);
      expect(result.ingress?.trace.handoffs[0]).toMatchObject({
        from: 'sales-zhangsan',
        to: 'service-li',
      });
    } finally {
      cleanup();
    }
  });

  it('memory hook lands in IngressTrace.memory with workspace', async () => {
    const testCase = loadCaseFromFile(join(FIXTURE_DIR, 'memory-scoped-to-employee.yaml'));
    const { runtime, cleanup } = setupRuntime(buildRoutingSimulator());
    try {
      const result = await runHarnessCase(runtime, testCase);
      expect(result.ingress?.trace.memory).toHaveLength(1);
      expect(result.ingress?.trace.memory[0].workspace).toContain('sales-zhangsan');
    } finally {
      cleanup();
    }
  });
});
