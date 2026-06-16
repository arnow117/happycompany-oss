#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE_TOOLS = ['contract_intake', 'create_service_record', 'finance_settlement'];

function timestampProfileName() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `acme-ultimate-${stamp}`;
}

function parseArgs(argv) {
  const args = {
    profile: timestampProfileName(),
    runtimeRoot: path.join(repoRoot, '.runtime'),
    tenant: 'acme-happycompany',
    tenantSourceDir: path.resolve(repoRoot, '../corp/acme-happycompany'),
    sourceSkillDir: path.join(repoRoot, 'corp/acme/.claude/skills/med_crm'),
    output: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--profile') args.profile = argv[++i];
    else if (item === '--runtime-root') args.runtimeRoot = path.resolve(argv[++i]);
    else if (item === '--tenant') args.tenant = argv[++i];
    else if (item === '--tenant-source-dir') args.tenantSourceDir = path.resolve(argv[++i]);
    else if (item === '--source-skill-dir') args.sourceSkillDir = path.resolve(argv[++i]);
    else if (item === '--output') args.output = path.resolve(argv[++i]);
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
    '  node scripts/prepare-acme-runtime-profile.mjs [--profile name] [--output report.json]',
    '',
    'Creates an isolated .runtime profile by copying the real Acme tenant,',
    'applying the verified med_crm write tools inside the profile, and running',
    'Flow A / Flow B acceptance against the profile skill package.',
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function toolNames(skillDir) {
  const manifest = readJson(path.join(skillDir, 'tools.json'));
  return Array.isArray(manifest.tools)
    ? manifest.tools.map((tool) => tool.name).filter((name) => typeof name === 'string')
    : [];
}

function readRootConfig() {
  // Prefer a local config.json, but fall back to committed examples so the
  // script works on a clean checkout / CI where config.json is absent.
  for (const name of ['config.json', 'config.test.example.json', 'config.example.json']) {
    const p = path.join(repoRoot, name);
    if (fs.existsSync(p)) return readJson(p);
  }
  return {};
}

function writeProfileConfig(configPath, tenant) {
  const rootConfig = readRootConfig();
  const config = {
    bots: rootConfig.bots ?? {
      'web-bot': {
        channel: 'web',
        credentials: {},
        displayName: '示例医疗 Web 助手',
        agentDir: 'agents/web-bot',
        routingMode: 'employee-director',
        tenant,
      },
    },
    claude: {
      apiKey: 'sk-test',
      model: rootConfig.claude?.model ?? 'test-model',
      directorEnabled: rootConfig.claude?.directorEnabled ?? true,
      directorModel: rootConfig.claude?.directorModel,
    },
    web: {
      port: 3100,
    },
    webChat: rootConfig.webChat,
    dataDir: 'data',
    corpDir: 'corp',
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!/^[A-Za-z0-9_-]+$/.test(args.profile)) {
    throw new Error(`Invalid profile name: ${args.profile}`);
  }

  const profileRoot = path.join(args.runtimeRoot, args.profile);
  if (fs.existsSync(profileRoot)) {
    throw new Error(`Runtime profile already exists: ${profileRoot}`);
  }

  const corpDir = path.join(profileRoot, 'corp');
  const dataDir = path.join(profileRoot, 'data');
  const tenantDir = path.join(corpDir, args.tenant);
  const targetSkillDir = path.join(tenantDir, '.claude', 'skills', 'med_crm');
  const configPath = path.join(profileRoot, 'config.json');
  const acceptanceOutput = path.join(profileRoot, 'acme-ultimate-acceptance.json');
  const acceptanceWorkdir = path.join(profileRoot, 'acceptance-workdir');

  fs.mkdirSync(corpDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.cpSync(args.tenantSourceDir, tenantDir, { recursive: true });
  writeProfileConfig(configPath, args.tenant);

  const stageReport = JSON.parse(runNode([
    'scripts/stage-acme-med-crm-write-tools.mjs',
    '--source-skill-dir',
    args.sourceSkillDir,
    '--target-skill-dir',
    targetSkillDir,
    '--apply',
  ]));

  const acceptanceReport = JSON.parse(runNode([
    'scripts/run-acme-ultimate-acceptance.mjs',
    '--skill-dir',
    targetSkillDir,
    '--workdir',
    acceptanceWorkdir,
    '--output',
    acceptanceOutput,
  ]));

  const profileToolNames = toolNames(targetSkillDir);
  const missingWriteTools = WRITE_TOOLS.filter((name) => !profileToolNames.includes(name));
  const registryReport = {
    status: missingWriteTools.length === 0 ? 'passed' : 'failed',
    tenant: args.tenant,
    corpDir,
    toolCount: profileToolNames.length,
    tools: WRITE_TOOLS.map((tool) => ({
      name: `med_crm:${tool}`,
      found: profileToolNames.includes(tool),
    })),
  };
  const report = {
    status: stageReport.action === 'applied'
      && acceptanceReport.status === 'passed'
      && missingWriteTools.length === 0
      && registryReport.status === 'passed'
      ? 'passed'
      : 'failed',
    mode: 'runtime-profile',
    profile: args.profile,
    profileRoot,
    configPath,
    corpDir,
    dataDir,
    tenant: args.tenant,
    tenantSourceDir: args.tenantSourceDir,
    targetModified: false,
    profileTenantDir: tenantDir,
    profileSkillDir: targetSkillDir,
    writeTools: WRITE_TOOLS,
    missingWriteTools,
    toolCount: profileToolNames.length,
    stage: stageReport,
    acceptance: acceptanceReport,
    registry: registryReport,
  };

  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.status !== 'passed') process.exitCode = 1;
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
