import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SkillFactory } from '../src/orchestrator/skill-factory.js';

const CORP_DIR = path.resolve(import.meta.dirname, '..', 'corp');
const TEST_TENANT = 'acme';

describe('SkillFactory', () => {
  let factory: SkillFactory;
  const generatedSkillDir = path.join(CORP_DIR, TEST_TENANT, '.claude', 'skills', 'human:测试发票');

  beforeAll(() => {
    factory = new SkillFactory(CORP_DIR);
  });

  afterAll(() => {
    fs.rmSync(generatedSkillDir, { recursive: true, force: true });
  });

  it('ensureSkillDir creates tenant shared skills directory', () => {
    const dir = factory.ensureSkillDir(TEST_TENANT);
    expect(fs.existsSync(dir)).toBe(true);
    expect(dir).toContain('.claude/skills');
  });

  it('generateFeishuQASkill writes SKILL.md and returns GeneratedSkill', () => {
    const skill = factory.generateFeishuQASkill(TEST_TENANT, {
      agentId: 'test-agent',
      chatId: 'test-chat',
      topic: '测试发票',
    });

    expect(skill.name).toContain('human:');
    expect(skill.source).toBe('generated');
    expect(fs.existsSync(path.join(skill.tenantSkillPath, 'SKILL.md'))).toBe(true);

    const content = fs.readFileSync(path.join(skill.tenantSkillPath, 'SKILL.md'), 'utf-8');
    expect(content).toContain('测试发票');
    expect(content).toContain('飞书');
    expect(content).toContain('test-chat');
  });

  it('listTenantSkills returns generated skills', () => {
    const skills = factory.listTenantSkills(TEST_TENANT);
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.some((s) => s.name.includes('human:'))).toBe(true);
  });

  it('installSkillToAgent creates symlink', () => {
    const agentDir = path.join(CORP_DIR, TEST_TENANT, 'agents', '__test-agent__');
    fs.mkdirSync(path.join(agentDir, '.claude', 'skills'), { recursive: true });

    const skills = factory.listTenantSkills(TEST_TENANT);
    const firstSkill = skills.find((s) => s.name.includes('human:'));
    if (!firstSkill) throw new Error('No skill to install');

    factory.installSkillToAgent(TEST_TENANT, firstSkill.name, agentDir);

    const symlinkPath = path.join(agentDir, '.claude', 'skills', firstSkill.name);
    expect(fs.existsSync(symlinkPath)).toBe(true);
    expect(fs.lstatSync(symlinkPath).isSymbolicLink()).toBe(true);

    // Cleanup
    fs.unlinkSync(symlinkPath);
    fs.rmSync(agentDir, { recursive: true, force: true });
  });
});

describe('Demo seed data', () => {
  it('sales-zhangsan.yaml exists and is valid', () => {
    const yamlPath = path.join(CORP_DIR, TEST_TENANT, 'employees', 'sales-zhangsan.yaml');
    expect(fs.existsSync(yamlPath)).toBe(true);

    const content = fs.readFileSync(yamlPath, 'utf-8');
    expect(content).toContain('id: sales-zhangsan');
    expect(content).toContain('销售张三');
    expect(content).toContain('role: sales');
    expect(content).toContain('med_crm:search_hospitals');
    expect(content).toContain('skills:');
    expect(content).toContain('med_crm');
    expect(content).toContain('maintenance-lisi');
  });

  it('maintenance-lisi.yaml exists and is valid', () => {
    const yamlPath = path.join(CORP_DIR, TEST_TENANT, 'employees', 'maintenance-lisi.yaml');
    expect(fs.existsSync(yamlPath)).toBe(true);

    const content = fs.readFileSync(yamlPath, 'utf-8');
    expect(content).toContain('id: maintenance-lisi');
    expect(content).toContain('维修李四');
    expect(content).toContain('role: maintenance');
    expect(content).toContain('add_incident');
    expect(content).toContain('skills:');
    expect(content).toContain('med_crm');
  });

  it('finance-wangwu.yaml exists and is valid', () => {
    const yamlPath = path.join(CORP_DIR, TEST_TENANT, 'employees', 'finance-wangwu.yaml');
    expect(fs.existsSync(yamlPath)).toBe(true);

    const content = fs.readFileSync(yamlPath, 'utf-8');
    expect(content).toContain('id: finance-wangwu');
    expect(content).toContain('财务王五');
    expect(content).toContain('role: finance');
    expect(content).toContain('合同管理');
  });

  it('shared fallback skills exist', () => {
    const invoicePath = path.join(CORP_DIR, TEST_TENANT, '.claude', 'skills', 'human-invoice', 'SKILL.md');
    expect(fs.existsSync(invoicePath)).toBe(true);

    const invoiceContent = fs.readFileSync(invoicePath, 'utf-8');
    expect(invoiceContent).toContain('发票处理');
    expect(invoiceContent).toContain('fallback');

    const acceptancePath = path.join(CORP_DIR, TEST_TENANT, '.claude', 'skills', 'human-acceptance', 'SKILL.md');
    expect(fs.existsSync(acceptancePath)).toBe(true);

    const acceptanceContent = fs.readFileSync(acceptancePath, 'utf-8');
    expect(acceptanceContent).toContain('维修验收');
  });

  it('three agents form a contract data flow', () => {
    const salesYaml = fs.readFileSync(
      path.join(CORP_DIR, TEST_TENANT, 'employees', 'sales-zhangsan.yaml'),
      'utf-8',
    );
    const maintYaml = fs.readFileSync(
      path.join(CORP_DIR, TEST_TENANT, 'employees', 'maintenance-lisi.yaml'),
      'utf-8',
    );
    const financeYaml = fs.readFileSync(
      path.join(CORP_DIR, TEST_TENANT, 'employees', 'finance-wangwu.yaml'),
      'utf-8',
    );

    // Sales → Maintenance handoff
    expect(salesYaml).toContain('maintenance-lisi');
    // Maintenance → Finance handoff
    expect(maintYaml).toContain('finance-wangwu');
    // All reference contract concepts
    expect(salesYaml).toContain('合同');
    expect(maintYaml).toContain('合同');
    expect(financeYaml).toContain('合同');
  });
});
