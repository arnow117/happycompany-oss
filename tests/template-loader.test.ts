import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TemplateLoader } from '../src/template-loader.js';

describe('TemplateLoader', () => {
  const testCorpDir = path.join(process.cwd(), 'corp');
  const testTemplatesDir = path.join(testCorpDir, 'templates');
  let loader: TemplateLoader;
  let tempTenantDir: string;

  beforeEach(() => {
    loader = new TemplateLoader(testTemplatesDir);
    tempTenantDir = path.join(testCorpDir, `test-tenant-${Date.now()}`);
  });

  afterEach(() => {
    if (fs.existsSync(tempTenantDir)) {
      fs.rmSync(tempTenantDir, { recursive: true, force: true });
    }
  });

  describe('list', () => {
    it('returns empty array when industries directory does not exist', () => {
      const invalidLoader = new TemplateLoader('/nonexistent/path');
      const result = invalidLoader.list();
      expect(result).toEqual([]);
    });

    it('returns all available templates', () => {
      const result = loader.list();
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'general',
            name: '通用',
            employeeCount: 0,
          }),
          expect.objectContaining({
            id: 'med-device',
            name: '医疗器械',
            employeeCount: 3,
          }),
        ]),
      );
    });

    it('includes description for each template', () => {
      const result = loader.list();
      const medDevice = result.find((t) => t.id === 'med-device');
      expect(medDevice?.description).toBe(
        '适合医疗器械经销/生产企业，包含销售、财务、售后三个角色',
      );
    });
  });

  describe('load', () => {
    it('returns null for non-existent template', () => {
      const result = loader.load('nonexistent');
      expect(result).toBeNull();
    });

    it('loads general template with no employees', () => {
      const result = loader.load('general');
      expect(result).not.toBeNull();
      expect(result?.template.id).toBe('general');
      expect(result?.template.employees).toEqual([]);
      expect(result?.employeeYamls.size).toBe(0);
    });

    it('loads med-device template with employees', () => {
      const result = loader.load('med-device');
      expect(result).not.toBeNull();
      expect(result?.template.id).toBe('med-device');
      expect(result?.template.employees.length).toBe(3);
      expect(result?.employeeYamls.size).toBe(3);
    });

    it('contains employee YAML content for each employee', () => {
      const result = loader.load('med-device');
      expect(result?.employeeYamls.has('employees/sales.yaml')).toBe(true);
      expect(result?.employeeYamls.has('employees/finance.yaml')).toBe(true);
      expect(result?.employeeYamls.has('employees/maintenance.yaml')).toBe(true);

      const salesYaml = result?.employeeYamls.get('employees/sales.yaml');
      expect(salesYaml).toContain('id: sales-template');
      expect(salesYaml).toContain('role: sales');
    });
  });

  describe('loadDetailed', () => {
    it('loads structured role, workflow, and contract templates for med-device', () => {
      const result = loader.loadDetailed('med-device');
      expect(result).not.toBeNull();
      expect(Object.keys(result?.roles ?? {})).toEqual(expect.arrayContaining(['sales', 'maintenance', 'finance']));
      expect(Object.keys(result?.workflows ?? {})).toEqual(expect.arrayContaining(['bid-tracking']));
      expect(Object.keys(result?.contracts ?? {})).toEqual(expect.arrayContaining(['sales-to-maintenance']));
      expect(result?.roles.sales.renderedPrompt).toContain('contract_id');
      expect(result?.roles.sales.renderedPrompt).toContain('招投标跟进');
    });

    it('loads all migrated industry packs with structured roles', () => {
      const ecommerce = loader.loadDetailed('ecommerce');
      const professionalService = loader.loadDetailed('professional-service');
      const general = loader.loadDetailed('general');

      expect(Object.keys(ecommerce?.roles ?? {})).toEqual(expect.arrayContaining(['customer-service', 'operations', 'warehouse']));
      expect(Object.keys(ecommerce?.workflows ?? {})).toHaveLength(3);
      expect(Object.keys(professionalService?.roles ?? {})).toEqual(expect.arrayContaining(['project-manager', 'consultant', 'finance']));
      expect(Object.keys(professionalService?.contracts ?? {})).toHaveLength(2);
      expect(general?.industry?.id).toBe('general');
    });

    it('includes version metadata and published snapshots', () => {
      const result = loader.loadDetailed('med-device');
      expect(result?.industry?.version).toBe('1.1.0');
      expect(result?.versions).toEqual(expect.any(Array));
    });

    it('rejects unsafe template ids when saving structured templates', () => {
      const role = loader.loadDetailed('med-device')?.roles.sales;
      expect(role).toBeDefined();
      expect(() => loader.saveRoleTemplate('../bad', 'sales', role!)).toThrow('Invalid template');
      expect(() => loader.saveRoleTemplate('med-device', '../bad', role!)).toThrow('Invalid template');
    });
  });

  describe('template management', () => {
    it('clones a template into a new industry pack', () => {
      const cloneId = `test-clone-${Date.now()}`;
      const cloneDir = path.join(testTemplatesDir, 'industries', cloneId);
      try {
        const meta = loader.cloneTemplate('med-device', {
          id: cloneId,
          name: '测试复制模板',
          description: '复制出来的测试模板',
        });
        const detail = loader.loadDetailed(cloneId);
        expect(meta.id).toBe(cloneId);
        expect(detail?.industry?.id).toBe(cloneId);
        expect(detail?.roles.sales.displayName).toContain('医疗器械');
      } finally {
        if (fs.existsSync(cloneDir)) fs.rmSync(cloneDir, { recursive: true, force: true });
      }
    });

    it('publishes a version snapshot without changing current template', () => {
      const version = loader.publishVersion('general', `test-${Date.now()}`);
      const versionDir = path.join(testTemplatesDir, 'industries', 'general', version.path);
      try {
        expect(fs.existsSync(path.join(versionDir, 'version.json'))).toBe(true);
        expect(loader.loadDetailed('general')?.versions.map((item) => item.id)).toContain(version.id);
      } finally {
        if (fs.existsSync(versionDir)) fs.rmSync(versionDir, { recursive: true, force: true });
      }
    });
  });

  describe('instantiate', () => {
    it('throws error for non-existent template', async () => {
      await expect(
        loader.instantiate('nonexistent', 'test-tenant', testCorpDir),
      ).rejects.toThrow('Template not found: nonexistent');
    });

    it('throws error if tenant already exists', async () => {
      fs.mkdirSync(tempTenantDir, { recursive: true });
      await expect(
        loader.instantiate('general', path.basename(tempTenantDir), testCorpDir),
      ).rejects.toThrow('already exists');
    });

    it('creates tenant directory structure from general template', async () => {
      const tenantName = `test-${Date.now()}`;
      const tenantDir = path.join(testCorpDir, tenantName);
      const files = await loader.instantiate('general', tenantName, testCorpDir);

      expect(fs.existsSync(tenantDir)).toBe(true);
      expect(fs.existsSync(path.join(tenantDir, 'employees'))).toBe(true);
      expect(fs.existsSync(path.join(tenantDir, 'workflows'))).toBe(true);
      expect(fs.existsSync(path.join(tenantDir, 'processes'))).toBe(true);

      const appJsonPath = path.join(tenantDir, 'app.json');
      expect(fs.existsSync(appJsonPath)).toBe(true);
      const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
      expect(appJson.displayName).toBe('通用');

      fs.rmSync(tenantDir, { recursive: true, force: true });
    });

    it('creates employee files from med-device template', async () => {
      const tenantName = `test-${Date.now()}`;
      const tenantDir = path.join(testCorpDir, tenantName);
      const files = await loader.instantiate('med-device', tenantName, testCorpDir);

      const employeesDir = path.join(tenantDir, 'employees');
      const employeeFiles = fs.readdirSync(employeesDir);
      expect(employeeFiles.length).toBe(3);

      expect(fs.existsSync(path.join(tenantDir, 'roles.json'))).toBe(false);

      fs.rmSync(tenantDir, { recursive: true, force: true });
    });

    it('applies nameMap overrides to employee displayNames', async () => {
      const tenantName = `test-${Date.now()}`;
      const tenantDir = path.join(testCorpDir, tenantName);
      const nameMap = { sales: '销售-张三', finance: '财务-李四' };
      const files = await loader.instantiate('med-device', tenantName, testCorpDir, {
        nameMap,
      });

      const employeesDir = path.join(tenantDir, 'employees');
      const employeeFiles = fs.readdirSync(employeesDir);

      for (const file of employeeFiles) {
        const content = fs.readFileSync(path.join(employeesDir, file), 'utf-8');
        if (content.includes('role: sales')) {
          expect(content).toContain('displayName: 销售-张三');
        } else if (content.includes('role: finance')) {
          expect(content).toContain('displayName: 财务-李四');
        }
      }

      fs.rmSync(tenantDir, { recursive: true, force: true });
    });
  });
});
