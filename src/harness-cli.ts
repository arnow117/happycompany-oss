#!/usr/bin/env node
/**
 * Harness CLI — drives MessageIngressRuntime with YAML cases and asserts
 * structured IngressTrace. Modes:
 *
 *   --case <file>       Run a single fixture file.
 *   --suite <dir>       Run every *.yaml fixture in a directory.
 *   --fake              Stub the agent. No LLM calls; recommended for CI.
 *   --server-url <url>  Real mode target backend (default http://127.0.0.1:3100).
 *   --admin-token <tok> Bearer token for protected admin API.
 *   --output <file>     Write JSON report to a file.
 *   --json              Emit structured JSON instead of human text.
 *
 * Usage:
 *   npx tsx src/harness-cli.ts --case tests/fixtures/harness/<case>.yaml --fake
 *   npx tsx src/harness-cli.ts --suite tests/fixtures/harness --fake --json
 *   npx tsx src/harness-cli.ts --case tests/fixtures/harness/<case>.yaml --server-url http://127.0.0.1:3100
 */
import { readdirSync, statSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { MessageBus } from './bus.js';
import { MessageStore } from './store.js';
import { MessageIngressRuntime } from './ingress/runtime.js';
import {
  type HarnessCase,
  type HarnessCaseResult,
  formatResult,
  loadCaseFromFile,
  runHarnessCase,
} from './ingress/adapters/harness.js';
import type { AgentFactory } from './bot.js';

interface CliArgs {
  case?: string;
  suite?: string;
  fake: boolean;
  json: boolean;
  storeDb?: string;
  serverUrl: string;
  adminToken?: string;
  output?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    fake: false,
    json: false,
    serverUrl: process.env.HAPPYCOMPANY_HARNESS_SERVER_URL ?? 'http://127.0.0.1:3100',
    adminToken: process.env.HAPPYCOMPANY_ADMIN_TOKEN,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--case') args.case = argv[++i];
    else if (a === '--suite') args.suite = argv[++i];
    else if (a === '--fake') args.fake = true;
    else if (a === '--json') args.json = true;
    else if (a === '--store-db') args.storeDb = argv[++i];
    else if (a === '--server-url') args.serverUrl = argv[++i];
    else if (a === '--admin-token') args.adminToken = argv[++i];
    else if (a === '--output') args.output = argv[++i];
  }
  return args;
}

function collectCaseFiles(target: string): string[] {
  const stat = statSync(target);
  if (stat.isFile()) return [target];
  const out: string[] = [];
  for (const entry of readdirSync(target)) {
    if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      out.push(join(target, entry));
    }
  }
  return out.sort();
}

interface SimulatedTrace {
  routing?: {
    mode?: string;
    selectedEmployee?: string;
    boundEmployee?: string;
    selectorShown?: boolean;
  };
  toolCalls?: Array<{ name: string; elapsedMs: number }>;
  memory?: Array<{
    operation: 'append' | 'search' | 'read' | 'write';
    subject: string;
    workspace?: string;
  }>;
  handoffs?: Array<{ from: string; to: string; reason?: string }>;
  businessArtifacts?: Array<{
    type: string;
    id?: string;
    status?: 'created' | 'updated' | 'triggered';
  }>;
}

interface FakeMarkers {
  reply: string;
  simulated?: SimulatedTrace;
}

function extractMarkers(prompt: string): FakeMarkers {
  const replyMatch = prompt.match(/<<FAKE_REPLY:(.*?)>>/s);
  const reply = replyMatch ? replyMatch[1].trim() : `[fake-reply] ${prompt.slice(0, 80)}`;
  const simMatch = prompt.match(/<<FAKE_SIM:(.*?)>>/s);
  let simulated: SimulatedTrace | undefined;
  if (simMatch) {
    try {
      simulated = JSON.parse(simMatch[1]) as SimulatedTrace;
    } catch {
      // Ignore malformed simulation block — the user will see assertion
      // failures pointing at the missing trace fields.
    }
  }
  return { reply, simulated };
}

function buildFakeAgent(): AgentFactory {
  let toolSeq = 0;
  return {
    async respond(prompt, _chatId, _botName, opts) {
      const { reply, simulated } = extractMarkers(prompt);
      if (simulated?.routing) opts?.onRoutingDecision?.(simulated.routing);
      if (simulated?.toolCalls) {
        for (const t of simulated.toolCalls) {
          const id = `sim-${++toolSeq}`;
          opts?.onToolStart?.({ toolName: t.name, toolUseId: id });
          opts?.onToolEnd?.({ toolName: t.name, toolUseId: id, elapsedMs: t.elapsedMs });
        }
      }
      if (simulated?.memory) {
        for (const m of simulated.memory) opts?.onMemoryOp?.({ ...m });
      }
      if (simulated?.handoffs) {
        for (const h of simulated.handoffs) opts?.onHandoff?.({ ...h });
      }
      if (simulated?.businessArtifacts) {
        for (const a of simulated.businessArtifacts) opts?.onBusinessArtifact?.({ ...a });
      }
      return reply;
    },
    clearSession: () => true,
    clearAllSessions: () => 0,
    listSessions: () => [],
  };
}

interface FakeCaseExtension {
  fakeReply?: string;
}

function injectFakeReplyIntoText(caseFile: string, baseCase: HarnessCase): HarnessCase {
  const raw = parseYaml(readFileSync(caseFile, 'utf-8')) as FakeCaseExtension | undefined;
  const fakeReply = raw?.fakeReply;
  let text = baseCase.input.text;
  if (fakeReply) {
    text += `\n<<FAKE_REPLY:${fakeReply}>>`;
  }
  if (baseCase.simulated) {
    text += `\n<<FAKE_SIM:${JSON.stringify(baseCase.simulated)}>>`;
  }
  if (text === baseCase.input.text) return baseCase;
  return {
    ...baseCase,
    input: { ...baseCase.input, text },
  };
}

function toJsonReport(
  mode: 'fake' | 'real',
  results: HarnessCaseResult[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const failed = results.filter((r) => r.status !== 'passed').length;
  const passed = results.length - failed;
  return {
    summary: { passed, failed, total: results.length },
    mode,
    ...extra,
    cases: results.map((r) => ({
      id: r.case.id,
      status: r.status,
      failures: r.failures,
      error: r.error,
      trace: r.ingress?.trace,
    })),
  };
}

function maybeWriteReport(args: CliArgs, report: Record<string, unknown>): void {
  if (!args.output) return;
  writeFileSync(args.output, JSON.stringify(report, null, 2) + '\n', 'utf-8');
}

interface RuntimeBundle {
  runtime: MessageIngressRuntime;
  cleanup: () => Promise<void>;
}

function buildFakeRuntime(args: CliArgs): RuntimeBundle {
  const agent = buildFakeAgent();
  let storeDbPath = args.storeDb;
  let tempDir: string | undefined;
  if (!storeDbPath) {
    tempDir = mkdtempSync(join(tmpdir(), 'harness-cli-'));
    storeDbPath = join(tempDir, 'harness.db');
  }
  const store = new MessageStore(storeDbPath);
  const bus = new MessageBus();
  const runtime = new MessageIngressRuntime({ agentFactory: agent, store, bus });

  return {
    runtime,
    cleanup: () => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      return Promise.resolve();
    },
  };
}

async function runFakeCases(args: CliArgs, runtime: MessageIngressRuntime): Promise<number> {
  const target = args.case ?? args.suite!;
  const files = collectCaseFiles(resolve(target));
  if (files.length === 0) {
    process.stderr.write(`No .yaml cases found at ${target}\n`);
    return 2;
  }

  const results: HarnessCaseResult[] = [];
  for (const file of files) {
    let testCase = loadCaseFromFile(file);
    if (args.fake) testCase = injectFakeReplyIntoText(file, testCase);
    const result = await runHarnessCase(runtime, testCase);
    results.push(result);
    if (!args.json) process.stdout.write(formatResult(result) + '\n');
  }

  const failed = results.filter((r) => r.status !== 'passed').length;
  const passed = results.length - failed;
  const report = toJsonReport('fake', results);
  maybeWriteReport(args, report);
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(`\n${passed} passed, ${failed} failed (${results.length} total)\n`);
  }
  return failed > 0 ? 1 : 0;
}

async function runServerCase(args: CliArgs, caseFile: string): Promise<HarnessCaseResult> {
  const url = new URL('/api/admin/harness/run', args.serverUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (args.adminToken) headers.Authorization = `Bearer ${args.adminToken}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      yaml: readFileSync(caseFile, 'utf-8'),
      sourcePath: basename(caseFile),
    }),
  });
  const body = await response.json() as unknown;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      ? String((body as Record<string, unknown>).error)
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  if (!body || typeof body !== 'object' || !('result' in body)) {
    throw new Error('Invalid harness server response: missing result');
  }
  return (body as { result: HarnessCaseResult }).result;
}

async function runServerCases(args: CliArgs): Promise<number> {
  const target = args.case ?? args.suite!;
  const files = collectCaseFiles(resolve(target));
  if (files.length === 0) {
    process.stderr.write(`No .yaml cases found at ${target}\n`);
    return 2;
  }

  const results: HarnessCaseResult[] = [];
  for (const file of files) {
    try {
      const result = await runServerCase(args, file);
      results.push(result);
      if (!args.json) process.stdout.write(formatResult(result) + '\n');
    } catch (err: unknown) {
      const testCase = loadCaseFromFile(file);
      const result: HarnessCaseResult = {
        case: testCase,
        status: 'error',
        failures: [],
        error: err instanceof Error ? err.message : String(err),
      };
      results.push(result);
      if (!args.json) process.stdout.write(formatResult(result) + '\n');
    }
  }

  const failed = results.filter((r) => r.status !== 'passed').length;
  const passed = results.length - failed;
  const report = toJsonReport('real', results, { serverUrl: args.serverUrl });
  maybeWriteReport(args, report);
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(`\n${passed} passed, ${failed} failed (${results.length} total)\n`);
  }
  return failed > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.case && !args.suite) {
    process.stderr.write(
      'Usage: harness-cli --case <file> | --suite <dir> [--fake] [--json]\n',
    );
    process.exit(2);
  }

  if (!args.fake) {
    const code = await runServerCases(args);
    process.exit(code);
  }

  const bundle = buildFakeRuntime(args);
  let code = 1;
  try {
    code = await runFakeCases(args, bundle.runtime);
  } finally {
    await bundle.cleanup();
  }
  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(`harness-cli fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
