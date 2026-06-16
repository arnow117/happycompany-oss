#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    keep: false,
    output: undefined,
    sourceSkillDir: path.join(repoRoot, 'corp/acme/.claude/skills/med_crm'),
    targetSkillDir: path.resolve(repoRoot, '../corp/acme-happycompany/.claude/skills/med_crm'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--keep') args.keep = true;
    else if (item === '--output') args.output = path.resolve(argv[++i]);
    else if (item === '--source-skill-dir') args.sourceSkillDir = path.resolve(argv[++i]);
    else if (item === '--target-skill-dir') args.targetSkillDir = path.resolve(argv[++i]);
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
    '  node scripts/run-acme-shadow-tenant-acceptance.mjs [--output report.json] [--keep]',
    '',
    'Creates a temporary copy of the target tenant med_crm package, overlays the',
    'verified write tools there, and runs Acme Flow A / Flow B acceptance.',
    'The real target tenant package is only read, never modified.',
    '',
  ].join('\n'));
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

function redactRemovedShadowPaths(report, keep) {
  if (keep) return report;
  return {
    ...report,
    targetSkillDir: '<temporary shadow skill package removed>',
    backupDir: report.backupDir ? '<temporary shadow backup removed>' : undefined,
  };
}

function redactAcceptancePaths(report, keep) {
  if (keep) return report;
  return {
    ...report,
    skillDir: '<temporary shadow skill package removed>',
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const shadowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acme-shadow-tenant-'));
  const shadowSkillDir = path.join(shadowRoot, 'med_crm');
  const acceptanceOutput = path.join(shadowRoot, 'acceptance.json');
  const acceptanceWorkdir = path.join(shadowRoot, 'acceptance-workdir');

  try {
    fs.cpSync(args.targetSkillDir, shadowSkillDir, { recursive: true });

    const stageReport = JSON.parse(runNode([
      'scripts/stage-acme-med-crm-write-tools.mjs',
      '--source-skill-dir',
      args.sourceSkillDir,
      '--target-skill-dir',
      shadowSkillDir,
      '--apply',
    ]));

    const acceptanceReport = JSON.parse(runNode([
      'scripts/run-acme-ultimate-acceptance.mjs',
      '--skill-dir',
      shadowSkillDir,
      '--workdir',
      acceptanceWorkdir,
      '--output',
      acceptanceOutput,
    ]));

    const report = {
      status: stageReport.action === 'applied' && acceptanceReport.status === 'passed' ? 'passed' : 'failed',
      mode: 'shadow-tenant',
      targetModified: false,
      sourceSkillDir: args.sourceSkillDir,
      targetSkillDir: args.targetSkillDir,
      shadowSkillDir: args.keep ? shadowSkillDir : undefined,
      stage: redactRemovedShadowPaths(stageReport, args.keep),
      acceptance: redactAcceptancePaths(acceptanceReport, args.keep),
    };

    if (args.output) {
      fs.mkdirSync(path.dirname(args.output), { recursive: true });
      fs.writeFileSync(args.output, JSON.stringify(report, null, 2) + '\n', 'utf-8');
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.status !== 'passed') process.exitCode = 1;
  } finally {
    if (!args.keep) {
      fs.rmSync(shadowRoot, { recursive: true, force: true });
    }
  }
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
