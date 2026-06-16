import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TenantTemplateSaver } from '../src/tenant-template-save.js';

describe('TenantTemplateSaver', () => {
  let testDir: string;
  let tenantDir: string;
  let templatesDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'template-save-'));
    tenantDir = path.join(testDir, 'corp', 'test-tenant');
    templatesDir = path.join(testDir, 'corp', 'templates', 'industries');

    fs.mkdirSync(path.join(tenantDir, 'employees'), { recursive: true });
    fs.mkdirSync(templatesDir, { recursive: true });

    fs.writeFileSync(path.join(tenantDir, 'app.json'), JSON.stringify({ displayName: 'Test Corp' }));
    fs.writeFileSync(
      path.join(tenantDir, 'employees', 'sales-zhangsan.yaml'),
      `id: sales-zhangsan\nrole: sales\ndisplayName: 销售小张`,
    );
    fs.writeFileSync(
      path.join(tenantDir, 'employees', 'finance-wangwu.yaml'),
      `id: finance-wangwu\nrole: finance\ndisplayName: 财务小王`,
    );
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('saves tenant as template', () => {
    new TenantTemplateSaver().save(tenantDir, templatesDir, {
      templateId: 'test-industry',
      templateName: '测试行业',
    });

    const dir = path.join(templatesDir, 'test-industry');
    expect(fs.existsSync(path.join(dir, 'template.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'roles.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'employees', 'sales.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'employees', 'finance.yaml'))).toBe(true);
  });

  it('generates valid template.json', () => {
    new TenantTemplateSaver().save(tenantDir, templatesDir, {
      templateId: 'test-industry',
      templateName: '测试行业',
    });

    const tpl = JSON.parse(
      fs.readFileSync(path.join(templatesDir, 'test-industry', 'template.json'), 'utf-8'),
    );
    expect(tpl.id).toBe('test-industry');
    expect(tpl.name).toBe('测试行业');
    expect(tpl.version).toBe('1.0.0');
    expect(tpl.employees).toHaveLength(2);
    const roles = tpl.employees.map((e: { role: string }) => e.role).sort();
    expect(roles).toEqual(['finance', 'sales']);
  });

  it('strips tenant-specific names', () => {
    new TenantTemplateSaver().save(tenantDir, templatesDir, {
      templateId: 'test-industry',
      templateName: '测试行业',
    });

    const sales = fs.readFileSync(
      path.join(templatesDir, 'test-industry', 'employees', 'sales.yaml'),
      'utf-8',
    );
    expect(sales).toContain('role: sales');
    expect(sales).not.toContain('zhangsan');
  });
});
