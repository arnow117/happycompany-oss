import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorkdirScanner } from '../src/workdir-scanner.js';
import { SkillToolBuilder } from '../src/skill-tool-builder.js';

describe('SKILL.md to tool integration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'skill-int-'));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('scans and builds tools end-to-end', () => {
    const skillDir = path.join(testDir, '.claude', 'skills', 'crm');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: crm
description: CRM
tools:
  - name:search,description:Search,riskLevel:read,parameters:{"type":"object","properties":{"q":{"type":"string"}},"required":["q"]}
  - name:add,description:Add,riskLevel:internal_write,parameters:{"type":"object","properties":{"d":{"type":"string"}}}
---

# CRM`);

    const scan = new WorkdirScanner().scan(testDir);
    expect(scan.skills[0].toolDefs).toHaveLength(2);

    const tools = new SkillToolBuilder().buildToolsForSkill({ appName: 'crm', toolDefs: scan.skills[0].toolDefs });
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('crm:search');
    expect(tools[0].riskLevel).toBe('read');
    expect(tools[1].name).toBe('crm:add');
    expect(tools[1].riskLevel).toBe('internal_write');
  });

  it('handles SKILL.md without tools', () => {
    const skillDir = path.join(testDir, '.claude', 'skills', 'basic');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: basic
description: Basic
---

# Basic`);

    const scan = new WorkdirScanner().scan(testDir);
    expect(scan.skills[0].toolDefs).toBeUndefined();
    expect(new SkillToolBuilder().buildToolsForSkill({ appName: 'basic', toolDefs: scan.skills[0].toolDefs })).toEqual([]);
  });

  it('handles med_crm SKILL.md with all 9 tools', () => {
    const skillDir = path.join(testDir, '.claude', 'skills', 'med_crm');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: med_crm
description: Medical CRM
tools:
  - name:search_hospitals,description:按关键词搜索医院客户信息,riskLevel:read,parameters:{"type":"object","properties":{"keyword":{"type":"string"}},"required":["keyword"]}
  - name:search_devices,description:按医院、型号或系统编号搜索设备装机信息,riskLevel:read,parameters:{"type":"object","properties":{"keyword":{"type":"string"}},"required":["keyword"]}
  - name:list_maintenance,description:查询维保合同和服务周期,riskLevel:read,parameters:{"type":"object","properties":{"hospital":{"type":"string"},"contractId":{"type":"string"}}}
  - name:search_bids,description:查询招投标和中标信息,riskLevel:read,parameters:{"type":"object","properties":{"keyword":{"type":"string"}},"required":["keyword"]}
  - name:add_sales_activity,description:新增客户拜访、跟进或销售活动记录,riskLevel:internal_write,parameters:{"type":"object","properties":{"hospital":{"type":"string"},"summary":{"type":"string"}},"required":["hospital","summary"]}
  - name:add_contact,description:新增医院联系人,riskLevel:internal_write,parameters:{"type":"object","properties":{"hospital":{"type":"string"},"name":{"type":"string"},"phone":{"type":"string"}},"required":["hospital","name"]}
  - name:add_incident,description:新增维修工单或故障记录,riskLevel:internal_write,parameters:{"type":"object","properties":{"hospital":{"type":"string"},"device":{"type":"string"},"description":{"type":"string"}},"required":["hospital","description"]}
  - name:global_search,description:跨医院、设备、合同和维保记录全局搜索,riskLevel:read,parameters:{"type":"object","properties":{"keyword":{"type":"string"}},"required":["keyword"]}
  - name:hospital_info,description:读取医院客户详情和业务概况,riskLevel:read,parameters:{"type":"object","properties":{"hospital":{"type":"string"}},"required":["hospital"]}
---

# Medical CRM`);

    const scan = new WorkdirScanner().scan(testDir);
    expect(scan.skills).toHaveLength(1);
    expect(scan.skills[0].toolDefs).toHaveLength(9);

    const tools = new SkillToolBuilder().buildToolsForSkill({ appName: 'med_crm', toolDefs: scan.skills[0].toolDefs });
    expect(tools).toHaveLength(9);

    const readTools = tools.filter(t => t.riskLevel === 'read');
    const writeTools = tools.filter(t => t.riskLevel === 'internal_write');
    expect(readTools).toHaveLength(6);
    expect(writeTools).toHaveLength(3);

    // Verify namespacing
    expect(tools[0].name).toBe('med_crm:search_hospitals');
    expect(tools[4].name).toBe('med_crm:add_sales_activity');
  });
});
