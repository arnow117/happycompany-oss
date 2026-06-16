#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE_TOOLS = ['contract_intake', 'create_service_record', 'finance_settlement'];

function parseArgs(argv) {
  const args = {
    tenant: 'acme-happycompany',
    corpDir: path.resolve(repoRoot, '../corp'),
    output: undefined,
    failOnNotReady: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--tenant') args.tenant = argv[++i];
    else if (item === '--corp-dir') args.corpDir = path.resolve(argv[++i]);
    else if (item === '--output') args.output = path.resolve(argv[++i]);
    else if (item === '--fail-on-not-ready') args.failOnNotReady = true;
    else if (item === '--help') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write([
    'Usage:',
    '  node scripts/verify-acme-tenant-acceptance.mjs [--output report.json]',
    '',
    'Read-only verifier for the real Acme tenant. If required med_crm write',
    'tools are present, it runs Flow A / Flow B acceptance against that tenant',
    'skill package using an isolated SQLite DB. It never modifies the tenant.',
    '',
  ].join('\n'));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function toolNames(skillDir) {
  const manifest = readJson(path.join(skillDir, 'tools.json'));
  return Array.isArray(manifest.tools)
    ? manifest.tools.map((tool) => tool.name).filter((name) => typeof name === 'string')
    : [];
}

function runNode(args) {
  const result = spawnSync('node', args, { cwd: repoRoot, encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error([
      `node ${args.join(' ')} failed with status ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function writeReport(output, report) {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tenantDir = path.join(args.corpDir, args.tenant);
  const skillDir = path.join(tenantDir, '.claude', 'skills', 'med_crm');
  const toolsPath = path.join(skillDir, 'tools.json');

  const baseReport = {
    mode: 'real-tenant-readiness',
    tenant: args.tenant,
    corpDir: args.corpDir,
    tenantDir,
    skillDir,
    targetModified: false,
    requiredWriteTools: WRITE_TOOLS,
  };

  if (!fs.existsSync(toolsPath)) {
    const report = {
      ...baseReport,
      status: 'not-ready',
      reason: 'missing-med-crm-tools-json',
      missingWriteTools: WRITE_TOOLS,
      toolCount: 0,
    };
    writeReport(args.output, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (args.failOnNotReady) process.exitCode = 2;
    return;
  }

  const tools = toolNames(skillDir);
  const missingWriteTools = WRITE_TOOLS.filter((tool) => !tools.includes(tool));
  if (missingWriteTools.length > 0) {
    const report = {
      ...baseReport,
      status: 'not-ready',
      reason: 'missing-write-tools',
      missingWriteTools,
      toolCount: tools.length,
    };
    writeReport(args.output, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (args.failOnNotReady) process.exitCode = 2;
    return;
  }

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'acme-real-tenant-acceptance-'));
  const acceptanceOutput = path.join(workdir, 'acceptance.json');
  try {
    const acceptance = JSON.parse(runNode([
      'scripts/run-acme-ultimate-acceptance.mjs',
      '--skill-dir',
      skillDir,
      '--workdir',
      workdir,
      '--output',
      acceptanceOutput,
    ]));
    const report = {
      ...baseReport,
      status: acceptance.status === 'passed' ? 'passed' : 'failed',
      reason: acceptance.status === 'passed' ? 'ready' : 'acceptance-failed',
      missingWriteTools: [],
      toolCount: tools.length,
      acceptance,
    };
    writeReport(args.output, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== 'passed') process.exitCode = 1;
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
