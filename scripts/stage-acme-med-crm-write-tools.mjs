#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WRITE_TOOLS = [
  'contract_intake',
  'create_service_record',
  'finance_settlement',
];

function parseArgs(argv) {
  const args = {
    apply: false,
    sourceSkillDir: path.join(repoRoot, 'corp/acme/.claude/skills/med_crm'),
    targetSkillDir: path.resolve(repoRoot, '../corp/acme-happycompany/.claude/skills/med_crm'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--apply') args.apply = true;
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
    '  node scripts/stage-acme-med-crm-write-tools.mjs [--apply]',
    '',
    'Options:',
    '  --source-skill-dir <path>  Source med_crm skill package',
    '  --target-skill-dir <path>  Target tenant med_crm skill package',
    '  --apply                    Copy files after creating a timestamped backup',
    '',
    'Default mode is read-only: it reports whether the target has Acme write tools.',
    '',
  ].join('\n'));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function requireSkillPackage(skillDir, label) {
  const required = ['SKILL.md', 'tools.json', 'med_crm/cli.py'];
  for (const rel of required) {
    const filePath = path.join(skillDir, rel);
    if (!fs.existsSync(filePath)) {
      throw new Error(`${label} is missing ${rel}: ${filePath}`);
    }
  }
}

function toolNames(skillDir) {
  const manifest = readJson(path.join(skillDir, 'tools.json'));
  if (!Array.isArray(manifest.tools)) return [];
  return manifest.tools.map((tool) => tool.name).filter((name) => typeof name === 'string');
}

function copyPackageFiles(sourceSkillDir, targetSkillDir) {
  const files = [
    'SKILL.md',
    'tools.json',
    'med_crm/cli.py',
  ];
  for (const rel of files) {
    const source = path.join(sourceSkillDir, rel);
    const target = path.join(targetSkillDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function backupPackage(targetSkillDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(targetSkillDir, '.backups', `backup-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const rel of ['SKILL.md', 'tools.json', 'med_crm/cli.py']) {
    const source = path.join(targetSkillDir, rel);
    if (!fs.existsSync(source)) continue;
    const target = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  return backupDir;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  requireSkillPackage(args.sourceSkillDir, 'source skill package');
  requireSkillPackage(args.targetSkillDir, 'target skill package');

  const sourceTools = toolNames(args.sourceSkillDir);
  const targetTools = toolNames(args.targetSkillDir);
  const missingInSource = WRITE_TOOLS.filter((name) => !sourceTools.includes(name));
  const missingInTarget = WRITE_TOOLS.filter((name) => !targetTools.includes(name));

  const report = {
    apply: args.apply,
    sourceSkillDir: args.sourceSkillDir,
    targetSkillDir: args.targetSkillDir,
    writeTools: WRITE_TOOLS,
    sourceHasAllWriteTools: missingInSource.length === 0,
    targetHasAllWriteTools: missingInTarget.length === 0,
    missingInSource,
    missingInTarget,
    action: 'none',
  };

  if (missingInSource.length > 0) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = 2;
    return;
  }

  if (!args.apply) {
    report.action = missingInTarget.length === 0 ? 'already-ready' : 'dry-run-only';
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  const backupDir = backupPackage(args.targetSkillDir);
  copyPackageFiles(args.sourceSkillDir, args.targetSkillDir);
  report.action = 'applied';
  report.backupDir = backupDir;
  report.targetToolsAfter = toolNames(args.targetSkillDir);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
