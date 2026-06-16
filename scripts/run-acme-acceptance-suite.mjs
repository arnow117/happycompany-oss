#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultReportDir = path.join(repoRoot, 'docs', 'reports');
const defaultOutput = path.join(defaultReportDir, '2026-06-04-acme-acceptance-suite-run.json');

function parseArgs(argv) {
  const args = {
    output: defaultOutput,
    reportDir: defaultReportDir,
    // Real-tenant readiness defaults to the private customer tenant
    // (../corp/acme-happycompany inside verify-acme-tenant-acceptance.mjs).
    // Tests and CI override these to target the in-repo demo fixture (corp/acme).
    corpDir: undefined,
    tenant: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--output') args.output = path.resolve(argv[++i]);
    else if (item === '--report-dir') args.reportDir = path.resolve(argv[++i]);
    else if (item === '--corp-dir') args.corpDir = path.resolve(argv[++i]);
    else if (item === '--tenant') args.tenant = argv[++i];
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
    '  node scripts/run-acme-acceptance-suite.mjs [--output report.json]',
    '',
    'Runs the non-destructive Acme ultimate acceptance evidence suite:',
    'CLI acceptance, shadow tenant acceptance, runtime profile acceptance,',
    'memory acceptance, and real tenant read-only readiness.',
    '',
  ].join('\n'));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with status ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function statusOf(report) {
  return typeof report.status === 'string' ? report.status : 'unknown';
}

function summarizeCli(report) {
  return {
    status: statusOf(report),
    artifactCounts: report.artifactCounts,
    flows: report.flows?.map((flow) => ({ id: flow.id, status: flow.status })) ?? [],
  };
}

function summarizeProfile(report) {
  return {
    status: statusOf(report),
    profile: report.profile,
    targetModified: report.targetModified,
    toolCount: report.toolCount,
    missingWriteTools: report.missingWriteTools,
    missingBeforeOverlay: report.missingBeforeOverlay,
    registry: report.registry,
    artifactCounts: report.acceptance?.artifactCounts,
  };
}

function summarizeMemory(report) {
  return {
    status: statusOf(report),
    targetModified: report.targetModified,
    employees: report.employees?.map((employee) => ({
      employeeId: employee.employeeId,
      sourceFiles: employee.sources?.map((source) => source.file) ?? [],
      searchQueries: employee.searches?.map((search) => search.query) ?? [],
    })) ?? [],
  };
}

function summarizeReadiness(report) {
  return {
    status: statusOf(report),
    reason: report.reason,
    targetModified: report.targetModified,
    toolCount: report.toolCount,
    missingWriteTools: report.missingWriteTools,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.reportDir, { recursive: true });

  const paths = {
    cliAcceptance: path.join(args.reportDir, '2026-06-04-acme-ultimate-acceptance-run.json'),
    shadowTenant: path.join(args.reportDir, '2026-06-04-acme-shadow-tenant-acceptance-run.json'),
    runtimeProfile: path.join(args.reportDir, '2026-06-04-acme-runtime-profile-acceptance-run.json'),
    memory: path.join(args.reportDir, '2026-06-04-acme-memory-acceptance-run.json'),
    realTenantReadiness: path.join(args.reportDir, '2026-06-04-acme-real-tenant-readiness-run.json'),
  };

  // When a corpDir + tenant are supplied (tests / CI), target that tenant's
  // skill package for every sub-script so the suite is self-contained against
  // the in-repo demo fixture instead of the private external customer tenant.
  const targetSkillDir = args.corpDir && args.tenant
    ? path.join(args.corpDir, args.tenant, '.claude', 'skills', 'med_crm')
    : undefined;
  const tenantArgs = args.tenant ? ['--tenant', args.tenant] : [];
  const corpArgs = args.corpDir ? ['--corp-dir', args.corpDir] : [];

  run('node', ['scripts/run-acme-ultimate-acceptance.mjs', '--output', paths.cliAcceptance]);
  run('node', [
    'scripts/run-acme-shadow-tenant-acceptance.mjs',
    '--output', paths.shadowTenant,
    ...(targetSkillDir ? ['--target-skill-dir', targetSkillDir] : []),
  ]);
  run('node', [
    'scripts/prepare-acme-runtime-profile.mjs',
    '--output', paths.runtimeProfile,
    ...tenantArgs,
    ...(args.corpDir && args.tenant ? ['--tenant-source-dir', path.join(args.corpDir, args.tenant)] : []),
  ]);
  // Memory acceptance writes employee memory under its corpDir; let it use the
  // isolated, gitignored .runtime/<profile> default so the suite never mutates
  // the tracked corp/acme fixture. (Only the tenant namespace is forwarded.)
  run('node', [
    '--import', 'tsx', 'scripts/run-acme-memory-acceptance.ts',
    '--output', paths.memory,
    ...tenantArgs,
  ]);
  run('node', [
    'scripts/verify-acme-tenant-acceptance.mjs',
    '--output', paths.realTenantReadiness,
    ...corpArgs,
    ...tenantArgs,
  ]);

  const reports = {
    cliAcceptance: readJson(paths.cliAcceptance),
    shadowTenant: readJson(paths.shadowTenant),
    runtimeProfile: readJson(paths.runtimeProfile),
    memory: readJson(paths.memory),
    realTenantReadiness: readJson(paths.realTenantReadiness),
  };

  const summary = {
    cliAcceptance: summarizeCli(reports.cliAcceptance),
    shadowTenant: summarizeProfile({
      ...reports.shadowTenant,
      profile: undefined,
      toolCount: reports.shadowTenant.stage?.targetToolsAfter?.length,
      missingWriteTools: [],
      missingBeforeOverlay: reports.shadowTenant.stage?.missingInTarget,
      acceptance: reports.shadowTenant.acceptance,
    }),
    runtimeProfile: summarizeProfile(reports.runtimeProfile),
    memory: summarizeMemory(reports.memory),
    realTenantReadiness: summarizeReadiness(reports.realTenantReadiness),
  };

  const evidenceReady = [
    summary.cliAcceptance.status,
    summary.shadowTenant.status,
    summary.runtimeProfile.status,
    summary.memory.status,
  ].every((status) => status === 'passed');
  const realTenantReady = summary.realTenantReadiness.status === 'passed';

  const suite = {
    status: evidenceReady && realTenantReady ? 'passed' : evidenceReady ? 'partial' : 'failed',
    generatedAt: new Date().toISOString(),
    targetModified: false,
    reports: paths,
    summary,
    nextGate: realTenantReady
      ? 'real-tenant-ready'
      : 'apply med_crm write tools to ../corp/acme-happycompany with explicit approval, then rerun this suite',
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(suite, null, 2)}\n`, 'utf-8');
  process.stdout.write(`${JSON.stringify(suite, null, 2)}\n`);
  if (suite.status === 'failed') process.exitCode = 1;
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
