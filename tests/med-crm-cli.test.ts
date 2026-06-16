import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('acme med_crm CLI adapter', () => {
  const skillPackageDir = resolve(process.cwd(), 'corp/acme/.claude/skills/med_crm');

  function createCrmFixture(): string {
    const dir = mkdtempSync(join(tmpdir(), 'med-crm-'));
    const cdata = join(dir, 'cdata');
    mkdirSync(cdata);
    const dbPath = join(cdata, 'crm.db');
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
        VALUES (5116, '浙江大学医学院附属第一医院', '浙一医院', '浙江省', '杭州市', '上城区', '三甲', 'direct');
      INSERT INTO devices (id, hospital_id, ucmid, supplier, device_category, product_name, brand, product_tier, source)
        VALUES (1, 5116, 'UCM-001', '示例医疗', '内镜', '高清内镜系统', 'Olympus', 'A', 'fixture');
      INSERT INTO maintenance_devices (id, hospital_id, product_name, brand, product_tier, contract_start, contract_end, planned_count, completed_count)
        VALUES (1, 5116, '高清内镜系统', 'Olympus', 'A', '2026-01-01', '2026-12-31', 4, 1);
      INSERT INTO bid_wins (id, hospital_id, project_code, contract_amount, supplier, contract_no, publish_date, device_category, supplier_category, stage)
        VALUES (1, 5116, 'ZY-2026-NJ', 1280000, '示例医疗', 'HT-001', '2026-05-01', '内镜', '设备商', 'result');
    `;
    const setup = spawnSync('sqlite3', [dbPath], { input: schema, encoding: 'utf-8' });
    expect(setup.status).toBe(0);
    return dbPath;
  }

  it('runs namespaced tool commands from the skill package against crm.db', () => {
    const dbPath = createCrmFixture();
    const result = spawnSync(
      'python3',
      ['-m', 'med_crm.cli', 'search_hospitals', '--keyword', '浙一'],
      { cwd: skillPackageDir, encoding: 'utf-8', env: { ...process.env, DINGGUO_CRM_DB: dbPath } },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const payload = JSON.parse(result.stdout);
    expect(payload.items).toEqual([
      expect.objectContaining({
        id: 5116,
        name: '浙江大学医学院附属第一医院',
        normalized_name: '浙一医院',
      }),
    ]);
    expect(payload.query).toBe('浙一');
  });

  it('returns a hospital business overview with related records', () => {
    const dbPath = createCrmFixture();
    const result = spawnSync(
      'python3',
      ['-m', 'med_crm.cli', 'hospital_info', '--hospital-name', '浙一'],
      { cwd: skillPackageDir, encoding: 'utf-8', env: { ...process.env, DINGGUO_CRM_DB: dbPath } },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const payload = JSON.parse(result.stdout);
    expect(payload.found).toBe(true);
    expect(payload.hospital).toEqual(
      expect.objectContaining({ name: '浙江大学医学院附属第一医院' }),
    );
    expect(payload.counts).toEqual({ devices: 1, maintenance: 1, bids: 1 });
  });

  it('writes contract intake, maintenance schedule, service record, and settlement artifacts', () => {
    const dbPath = createCrmFixture();

    const bidSearch = spawnSync(
      'python3',
      ['-m', 'med_crm.cli', 'search_bids', '--keyword', '示例医疗'],
      { cwd: skillPackageDir, encoding: 'utf-8', env: { ...process.env, DINGGUO_CRM_DB: dbPath } },
    );

    expect(bidSearch.status).toBe(0);
    expect(JSON.parse(bidSearch.stdout).items).toEqual([
      expect.objectContaining({
        project_code: 'ZY-2026-NJ',
        supplier: '示例医疗',
      }),
    ]);

    const intake = spawnSync(
      'python3',
      [
        '-m', 'med_crm.cli', 'contract_intake',
        '--contract-id', 'jsrm-540ct-full-service',
        '--customer', '江山市人民医院',
        '--device-model', 'GE16排 CT',
        '--service-period-start', '2024-09-03',
        '--service-period-end', '2027-09-02',
        '--maintenance-cycle', 'half-yearly',
        '--payment-terms', '每服务满半年并验收合格后付款',
      ],
      { cwd: skillPackageDir, encoding: 'utf-8', env: { ...process.env, DINGGUO_CRM_DB: dbPath } },
    );

    expect(intake.status).toBe(0);
    const intakePayload = JSON.parse(intake.stdout);
    expect(intakePayload.artifacts).toEqual([
      { type: 'contract_intake', id: 'jsrm-540ct-full-service', status: 'created' },
      { type: 'maintenance_schedule', id: 'schedule-jsrm-540ct-full-service', status: 'created' },
    ]);

    const incident = spawnSync(
      'python3',
      [
        '-m', 'med_crm.cli', 'add_incident',
        '--incident-id', 'incident-jsrm-540ct-001',
        '--hospital', '江山市人民医院',
        '--device', 'GE16排 CT',
        '--description', '半年维保任务触发，现场检查扫描床和高压系统',
      ],
      { cwd: skillPackageDir, encoding: 'utf-8', env: { ...process.env, DINGGUO_CRM_DB: dbPath } },
    );

    expect(incident.status).toBe(0);
    expect(JSON.parse(incident.stdout).artifact).toEqual({
      type: 'service_incident',
      id: 'incident-jsrm-540ct-001',
      status: 'created',
    });

    const serviceRecord = spawnSync(
      'python3',
      [
        '-m', 'med_crm.cli', 'create_service_record',
        '--record-id', 'sr-jsrm-540ct-001',
        '--contract-id', 'jsrm-540ct-full-service',
        '--customer', '江山市人民医院',
        '--device-model', 'GE16排 CT',
        '--service-date', '2026-06-04',
        '--diagnosis', '完成半年维保，扫描床和高压系统检查正常',
        '--customer-signed', 'yes',
      ],
      { cwd: skillPackageDir, encoding: 'utf-8', env: { ...process.env, DINGGUO_CRM_DB: dbPath } },
    );

    expect(serviceRecord.status).toBe(0);
    expect(JSON.parse(serviceRecord.stdout).artifact).toEqual({
      type: 'service_record',
      id: 'sr-jsrm-540ct-001',
      status: 'created',
    });

    const settlement = spawnSync(
      'python3',
      [
        '-m', 'med_crm.cli', 'finance_settlement',
        '--settlement-id', 'settlement-jsrm-540ct-sr-001',
        '--contract-id', 'jsrm-540ct-full-service',
        '--service-record-id', 'sr-jsrm-540ct-001',
        '--billing-amount', '285000',
        '--archive-status', 'ready',
      ],
      { cwd: skillPackageDir, encoding: 'utf-8', env: { ...process.env, DINGGUO_CRM_DB: dbPath } },
    );

    expect(settlement.status).toBe(0);
    expect(JSON.parse(settlement.stdout).artifact).toEqual({
      type: 'finance_settlement',
      id: 'settlement-jsrm-540ct-sr-001',
      status: 'created',
    });

    const counts = spawnSync(
      'sqlite3',
      [
        dbPath,
        [
          'SELECT COUNT(*) FROM contract_intakes;',
          'SELECT COUNT(*) FROM maintenance_schedules;',
          'SELECT COUNT(*) FROM service_incidents;',
          'SELECT COUNT(*) FROM service_records;',
          'SELECT COUNT(*) FROM finance_settlements;',
        ].join(''),
      ],
      { encoding: 'utf-8' },
    );

    expect(counts.status).toBe(0);
    expect(counts.stdout.trim().split('\n')).toEqual(['1', '1', '1', '1', '1']);
  });
});
