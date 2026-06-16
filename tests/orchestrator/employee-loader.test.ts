import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EmployeeLoader, type LoadedEmployee } from '../../src/orchestrator/employee-loader.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'app-loader-test-'));
}

function writeYaml(dir: string, relativePath: string, content: string): string {
  const filePath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('EmployeeLoader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads valid YAML files from tenant employees directory', () => {
    writeYaml(tmpDir, 'tenant1/employees/employee1.yaml', `
id: employee1
displayName: "Employee One"
model: "claude-sonnet-4-6"
tools:
  - med_crm:search_hospitals
`);
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.load();
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe('employee1');
    expect(apps[0].displayName).toBe('Employee One');
    expect(apps[0].tenantName).toBe('tenant1');
    expect(apps[0].tools).toEqual(['med_crm:search_hospitals']);
  });

  it('loads .yml extension files too', () => {
    writeYaml(tmpDir, 'tenant1/employees/employee.yml', `
id: employee
displayName: "YML Employee"
`);
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.load();
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe('employee');
  });

  it('ignores legacy app agents from the tenant apps directory', () => {
    writeYaml(tmpDir, 'tenant1/employees/hr-onboarding.yaml', `
id: hr-onboarding
displayName: "HR Onboarding"
`);
    writeYaml(tmpDir, 'tenant1/apps/contract-agent.yaml', `
id: contract-agent
displayName: "Contract Agent"
`);
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.loadTenant('tenant1');
    expect(apps.map((app) => app.id)).toEqual(['hr-onboarding']);
  });

  it('returns empty array when no YAML files exist', () => {
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.load();
    expect(apps).toHaveLength(0);
  });

  it('returns empty array when corpDir does not exist', () => {
    const loader = new EmployeeLoader({ corpDir: '/nonexistent/path' });
    const apps = loader.load();
    expect(apps).toHaveLength(0);
  });

  it('skips invalid YAML files and logs warning', () => {
    writeYaml(tmpDir, 'tenant1/employees/broken.yaml', '{{invalid yaml');
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.load();
    expect(apps).toHaveLength(0);
  });

  it('skips files that fail Zod validation', () => {
    writeYaml(tmpDir, 'tenant1/employees/noid.yaml', `
displayName: "No ID"
`);
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.load();
    expect(apps).toHaveLength(0);
  });

  it('skips empty YAML files', () => {
    writeYaml(tmpDir, 'tenant1/employees/empty.yaml', '');
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.load();
    expect(apps).toHaveLength(0);
  });

  it('skips YAML files that parse to non-objects', () => {
    writeYaml(tmpDir, 'tenant1/employees/scalar.yaml', 'just a string');
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.load();
    expect(apps).toHaveLength(0);
  });

  it('loads from multiple tenants', () => {
    writeYaml(tmpDir, 'tenant1/employees/employee1.yaml', `
id: employee1
displayName: "Employee One"
`);
    writeYaml(tmpDir, 'tenant2/employees/employee2.yaml', `
id: employee2
displayName: "Employee Two"
`);
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.load();
    expect(apps).toHaveLength(2);
    const ids = apps.map((a) => a.id).sort();
    expect(ids).toEqual(['employee1', 'employee2']);
  });

  it('loadTenant returns only employees for specified tenant', () => {
    writeYaml(tmpDir, 'tenant1/employees/employee1.yaml', `
id: employee1
displayName: "Employee One"
`);
    writeYaml(tmpDir, 'tenant2/employees/employee2.yaml', `
id: employee2
displayName: "Employee Two"
`);
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.loadTenant('tenant2');
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe('employee2');
    expect(apps[0].tenantName).toBe('tenant2');
  });

  it('loadTenant returns empty for nonexistent tenant', () => {
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.loadTenant('nonexistent');
    expect(apps).toHaveLength(0);
  });

  it('loadTenant returns empty when employees dir does not exist', () => {
    fs.mkdirSync(path.join(tmpDir, 'tenant1'), { recursive: true });
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.loadTenant('tenant1');
    expect(apps).toHaveLength(0);
  });

  it('skips non-YAML files in employees directory', () => {
    writeYaml(tmpDir, 'tenant1/employees/employee1.yaml', `
id: employee1
displayName: "Employee One"
`);
    writeYaml(tmpDir, 'tenant1/employees/readme.txt', 'not a yaml file');
    writeYaml(tmpDir, 'tenant1/employees/tools.json', '{}');
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.load();
    expect(apps).toHaveLength(1);
  });

  it('includes filePath in LoadedEmployee', () => {
    const filePath = writeYaml(tmpDir, 'tenant1/employees/my-employee.yaml', `
id: my-employee
displayName: "My Employee"
`);
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const apps = loader.load();
    expect(apps[0].filePath).toBe(filePath);
  });

  it('reload detects added files', () => {
    writeYaml(tmpDir, 'tenant1/employees/employee1.yaml', `
id: employee1
displayName: "Employee One"
`);
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const initial = loader.load();
    expect(initial).toHaveLength(1);

    writeYaml(tmpDir, 'tenant1/employees/employee2.yaml', `
id: employee2
displayName: "Employee Two"
`);
    const result = loader.reload(initial);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].id).toBe('employee2');
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });

  it('reload detects removed files', () => {
    const filePath = writeYaml(tmpDir, 'tenant1/employees/employee1.yaml', `
id: employee1
displayName: "Employee One"
`);
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const initial = loader.load();
    expect(initial).toHaveLength(1);

    fs.unlinkSync(filePath);
    const result = loader.reload(initial);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].id).toBe('employee1');
    expect(result.added).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });

  it('reload detects changed files via mtime', () => {
    const filePath = writeYaml(tmpDir, 'tenant1/employees/employee1.yaml', `
id: employee1
displayName: "Employee One"
`);
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const initial = loader.load();

    // Touch the file to change mtime
    const { utimesSync } = fs;
    utimesSync(filePath, new Date(), new Date(Date.now() + 5000));

    const result = loader.reload(initial);
    expect(result.changed).toHaveLength(1);
    expect(result.unchanged).toHaveLength(0);
  });

  it('reload reports unchanged files', () => {
    writeYaml(tmpDir, 'tenant1/employees/employee1.yaml', `
id: employee1
displayName: "Employee One"
`);
    const loader = new EmployeeLoader({ corpDir: tmpDir });
    const initial = loader.load();

    const result = loader.reload(initial);
    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0].id).toBe('employee1');
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });
});
