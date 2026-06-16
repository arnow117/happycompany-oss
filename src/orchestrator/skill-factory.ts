import fs from 'node:fs';
import path from 'node:path';
import { initWorkdir } from '../workdir.js';
import type { GeneratedSkill } from './types.js';

export class SkillFactory {
  constructor(private readonly corpDir: string) {}

  /** Ensure the tenant-level shared skills directory exists: corp/{tenant}/.claude/skills/ */
  ensureSkillDir(tenant: string): string {
    const dir = path.join(this.corpDir, tenant, '.claude', 'skills');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Resolve the shared skills directory path for a tenant. */
  private tenantSkillDir(tenant: string): string {
    return path.join(this.corpDir, tenant, '.claude', 'skills');
  }

  /**
   * Generate a Level 1 feishu Q&A fallback skill and write its SKILL.md
   * into the tenant's shared .claude/skills/ directory.
   */
  generateFeishuQASkill(
    tenant: string,
    params: { agentId: string; chatId: string; topic: string },
  ): GeneratedSkill {
    const name = `human:${params.topic.replace(/[^a-z0-9一-鿿-]/gi, '-').slice(0, 40)}`;
    const skillDir = path.join(this.tenantSkillDir(tenant), name);
    fs.mkdirSync(skillDir, { recursive: true });

    const content = [
      '---',
      `name: ${name}`,
      `description: 飞书人工问答 — ${params.topic}`,
      'type: fallback',
      '---',
      '',
      `# ${params.topic}`,
      '',
      `当 agent 需要「${params.topic}」相关信息但无对应工具时，通过飞书向 ${params.chatId} 发送消息并等待回复。`,
      '',
      '## 用法',
      '',
      '调用流程：',
      `1. 向飞书用户/群 ${params.chatId} 发送咨询消息`,
      '2. 等待回复（超时 30 分钟）',
      '3. 将回复内容作为结果返回给 agent',
      '',
      '## 注意事项',
      '',
      '- 消息应包含足够的上下文，让对方能快速理解需求',
      '- 超时后通知 agent 人工未响应，由 agent 决定后续策略',
    ].join('\n');

    const skillPath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(skillPath, content, 'utf-8');

    return {
      id: name,
      name,
      description: params.topic,
      source: 'generated',
      tenantSkillPath: skillDir,
      installedWorkdirs: [],
    };
  }

  /** Create a symlink from agent workdir's .claude/skills/ → tenant shared skill dir. */
  installSkillToAgent(
    tenant: string,
    skillName: string,
    agentWorkdir: string,
  ): void {
    const srcDir = path.join(this.tenantSkillDir(tenant), skillName);
    if (!fs.existsSync(srcDir)) {
      throw new Error(`Skill "${skillName}" not found in tenant ${tenant} shared pool`);
    }

    initWorkdir(agentWorkdir);
    const agentSkillsDir = path.join(agentWorkdir, '.claude', 'skills');
    const target = path.join(agentSkillsDir, skillName);

    if (fs.existsSync(target)) return;

    // Use relative symlink so the whole corp/ tree stays relocatable
    const relativeSrc = path.relative(agentSkillsDir, srcDir);
    fs.symlinkSync(relativeSrc, target, 'dir');
  }

  /** List all skills in the tenant shared pool. */
  listTenantSkills(tenant: string): GeneratedSkill[] {
    const dir = this.tenantSkillDir(tenant);
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => {
        const skillDir = path.join(dir, e.name);
        const skillMd = path.join(skillDir, 'SKILL.md');
        const exists = fs.existsSync(skillMd);

        return {
          id: e.name,
          name: e.name,
          description: exists ? 'Fallback skill' : '(no SKILL.md)',
          source: 'existing' as const,
          tenantSkillPath: skillDir,
          installedWorkdirs: [],
        };
      });
  }

  /** Remove a skill symlink from an agent workdir. */
  uninstallSkillFromAgent(_tenant: string, skillName: string, agentWorkdir: string): void {
    const skillLink = path.join(agentWorkdir, '.claude', 'skills', skillName);
    if (fs.existsSync(skillLink)) {
      fs.unlinkSync(skillLink);
    }
  }
}
