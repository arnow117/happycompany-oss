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
    workdir: undefined,
    skillDir: path.join(repoRoot, 'corp/acme/.claude/skills/med_crm'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--keep') args.keep = true;
    else if (item === '--output') args.output = path.resolve(argv[++i]);
    else if (item === '--workdir') args.workdir = path.resolve(argv[++i]);
    else if (item === '--skill-dir') args.skillDir = path.resolve(argv[++i]);
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
    '  node scripts/run-acme-ultimate-acceptance.mjs [--output report.json] [--keep]',
    '',
    'Runs Acme Flow A and Flow B through the real med_crm CLI against an isolated SQLite DB.',
    '',
  ].join('\n'));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf-8', ...options });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with status ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function kebab(value) {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function cliArgs(toolName, params) {
  const args = ['-m', 'med_crm.cli', toolName];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    args.push(`--${kebab(key)}`, String(value));
  }
  return args;
}

function runTool(skillDir, dbPath, toolName, params) {
  const stdout = run('python3', cliArgs(toolName, params), {
    cwd: skillDir,
    env: { ...process.env, DINGGUO_CRM_DB: dbPath },
  });
  return JSON.parse(stdout);
}

function setupDb(dbPath) {
  const schema = `
    CREATE TABLE hospitals (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT,
      province TEXT,
      city TEXT,
      district TEXT,
      level TEXT,
      bed_count INTEGER,
      annual_revenue REAL,
      channel TEXT,
      source_db TEXT,
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE devices (
      id INTEGER PRIMARY KEY,
      hospital_id INTEGER NOT NULL,
      ucmid TEXT NOT NULL,
      supplier TEXT,
      device_category TEXT,
      product_name TEXT,
      brand TEXT,
      product_tier TEXT,
      created_at TEXT,
      updated_at TEXT,
      source TEXT
    );
    CREATE TABLE maintenance_devices (
      id INTEGER PRIMARY KEY,
      hospital_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      brand TEXT,
      product_tier TEXT,
      contract_start TEXT,
      contract_end TEXT,
      planned_count INTEGER,
      completed_count INTEGER,
      next_maintenance_date TEXT,
      reminder_frequency TEXT,
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE bid_wins (
      id INTEGER PRIMARY KEY,
      hospital_id INTEGER NOT NULL,
      project_code TEXT NOT NULL,
      announcement_url TEXT,
      contract_url TEXT,
      contract_amount REAL,
      supplier TEXT,
      contract_no TEXT,
      publish_date TEXT,
      device_category TEXT,
      supplier_category TEXT,
      stage TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    INSERT INTO hospitals (id, name, normalized_name, province, city, district, level, channel)
      VALUES (6428, '乐清市第三人民医院', '乐清三院', '浙江省', '温州市', '乐清市', '二甲', 'bid');
    INSERT INTO hospitals (id, name, normalized_name, province, city, district, level, channel)
      VALUES (5401, '江山市人民医院', '江山人民医院', '浙江省', '衢州市', '江山市', '三级', 'direct');
    INSERT INTO devices (id, hospital_id, ucmid, supplier, device_category, product_name, brand, product_tier, source)
      VALUES (1, 5401, 'JSRM-GE16-001', '杭州示例医疗器械有限公司', 'CT', 'GE16排 CT', 'GE', 'A', 'acceptance');
    INSERT INTO maintenance_devices (id, hospital_id, product_name, brand, product_tier, contract_start, contract_end, planned_count, completed_count)
      VALUES (1, 5401, 'GE16排 CT', 'GE', 'A', '2024-09-03', '2027-09-02', 6, 0);
    INSERT INTO bid_wins (id, hospital_id, project_code, announcement_url, contract_url, contract_amount, supplier, contract_no, publish_date, device_category, supplier_category, stage)
      VALUES (6428, 6428, '330382263180160000008-WZLCZB-2026-03047', 'https://zfcg.czt.zj.gov.cn/site/detail?articleId=NdprtXoYFooHk00DeGoBHw==', NULL, 1618000, '杭州示例医疗器械有限公司', NULL, '2026-04-07', 'CT', 'self', 'result');
  `;
  run('sqlite3', [dbPath], { input: schema });
}

function countArtifacts(dbPath) {
  const sql = [
    'SELECT "contract_intakes", COUNT(*) FROM contract_intakes;',
    'SELECT "maintenance_schedules", COUNT(*) FROM maintenance_schedules;',
    'SELECT "service_incidents", COUNT(*) FROM service_incidents;',
    'SELECT "service_records", COUNT(*) FROM service_records;',
    'SELECT "finance_settlements", COUNT(*) FROM finance_settlements;',
  ].join('');
  const stdout = run('sqlite3', [dbPath, sql]);
  return Object.fromEntries(
    stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [name, count] = line.split('|');
      return [name, Number(count)];
    }),
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workdir = args.workdir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'acme-ultimate-'));
  fs.mkdirSync(workdir, { recursive: true });
  const dbPath = path.join(workdir, 'crm.db');
  setupDb(dbPath);

  const flowASteps = [];
  const bidSearch = runTool(args.skillDir, dbPath, 'search_bids', { keyword: '杭州示例医疗' });
  flowASteps.push({ tool: 'search_bids', result: bidSearch });
  const intake = runTool(args.skillDir, dbPath, 'contract_intake', {
    contractId: 'jsrm-540ct-full-service',
    customer: '江山市人民医院',
    deviceModel: 'GE16排 CT',
    servicePeriodStart: '2024-09-03',
    servicePeriodEnd: '2027-09-02',
    maintenanceCycle: 'half-yearly',
    paymentTerms: '每服务满半年并验收合格后付款',
  });
  flowASteps.push({ tool: 'contract_intake', result: intake });

  const flowBSteps = [];
  const incident = runTool(args.skillDir, dbPath, 'add_incident', {
    incidentId: 'incident-jsrm-540ct-001',
    hospital: '江山市人民医院',
    device: 'GE16排 CT',
    description: '半年维保任务触发，现场检查扫描床和高压系统',
  });
  flowBSteps.push({ tool: 'add_incident', result: incident });
  const serviceRecord = runTool(args.skillDir, dbPath, 'create_service_record', {
    recordId: 'sr-jsrm-540ct-001',
    contractId: 'jsrm-540ct-full-service',
    customer: '江山市人民医院',
    deviceModel: 'GE16排 CT',
    serviceDate: '2026-06-04',
    diagnosis: '完成半年维保，扫描床和高压系统检查正常',
    customerSigned: 'yes',
  });
  flowBSteps.push({ tool: 'create_service_record', result: serviceRecord });
  const settlement = runTool(args.skillDir, dbPath, 'finance_settlement', {
    settlementId: 'settlement-jsrm-540ct-sr-001',
    contractId: 'jsrm-540ct-full-service',
    serviceRecordId: 'sr-jsrm-540ct-001',
    billingAmount: '285000',
    archiveStatus: 'ready',
  });
  flowBSteps.push({ tool: 'finance_settlement', result: settlement });

  const report = {
    status: 'passed',
    generatedAt: new Date().toISOString(),
    skillDir: args.skillDir,
    dbPath: args.keep ? dbPath : undefined,
    flows: [
      {
        id: 'acme-bid-win-to-contract-intake',
        status: bidSearch.items?.length > 0 && intake.created ? 'passed' : 'failed',
        steps: flowASteps,
        artifacts: intake.artifacts ?? [],
      },
      {
        id: 'acme-maintenance-schedule-dispatch-to-receipt',
        status: incident.created && serviceRecord.created && settlement.created ? 'passed' : 'failed',
        steps: flowBSteps,
        artifacts: [incident.artifact, serviceRecord.artifact, settlement.artifact].filter(Boolean),
      },
    ],
    artifactCounts: countArtifacts(dbPath),
  };

  report.status = report.flows.every((flow) => flow.status === 'passed') ? 'passed' : 'failed';

  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');

  if (!args.keep && !args.workdir) {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
  if (report.status !== 'passed') process.exitCode = 1;
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
