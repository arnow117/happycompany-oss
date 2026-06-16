import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorkdirScanner, isValidPath } from '../src/workdir-scanner.js';

describe('WorkdirScanner', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'workdir-scanner-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('scan', () => {
    it('should throw error for non-existent path', () => {
      const scanner = new WorkdirScanner();
      const nonExistent = path.join(testDir, 'non-existent');

      expect(() => scanner.scan(nonExistent)).toThrow('Workdir does not exist');
    });

    it('should throw error for file instead of directory', () => {
      const scanner = new WorkdirScanner();
      const filePath = path.join(testDir, 'file.txt');
      fs.writeFileSync(filePath, 'test');

      expect(() => scanner.scan(filePath)).toThrow('Workdir is not a directory');
    });

    it('should scan skills from .claude/skills directory', () => {
      const scanner = new WorkdirScanner();
      const skillsDir = path.join(testDir, '.claude', 'skills');
      const skillDir = path.join(skillsDir, 'test-skill');
      fs.mkdirSync(skillDir, { recursive: true });

      const skillMdPath = path.join(skillDir, 'SKILL.md');
      fs.writeFileSync(skillMdPath, "---\nname: test-skill\ndescription: A test skill\nhas-write-ops: true\npackages: [pandas, requests]\nscripts:\n  - path:bin/run.sh,access:exec\n---\n\n# Test Skill\n\nThis is a test skill.");

      const result = scanner.scan(testDir);

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe('test-skill');
      expect(result.skills[0].description).toBe('A test skill');
      expect(result.skills[0].hasWriteOps).toBe(true);
      expect(result.skills[0].dependencies?.packages).toEqual(['pandas', 'requests']);
      expect(result.skills[0].dependencies?.scripts).toEqual([{ path: 'bin/run.sh', access: 'exec' }]);
    });

    it('should scan executable scripts from bin directory', () => {
      const scanner = new WorkdirScanner();
      const binDir = path.join(testDir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });

      const scriptPath = path.join(binDir, 'test.sh');
      fs.writeFileSync(scriptPath, "#!/bin/bash\necho \"test\"\n");

      // Make executable
      fs.chmodSync(scriptPath, 0o755);

      const result = scanner.scan(testDir);

      expect(result.scripts).toHaveLength(1);
      expect(result.scripts[0].relativePath).toBe(path.join('bin', 'test.sh'));
      expect(result.scripts[0].executable).toBe(true);
      expect(result.scripts[0].shebang).toBe("#!/bin/bash");
    });

    it('should read CLAUDE.md for project context', () => {
      const scanner = new WorkdirScanner();
      const claudeMdPath = path.join(testDir, 'CLAUDE.md');
      fs.writeFileSync(claudeMdPath, "# Project\n\nThis is a test project.");

      const result = scanner.scan(testDir);

      expect(result.projectContext).toContain("# Project");
    });

    it('should read AGENTS.md if CLAUDE.md not found', () => {
      const scanner = new WorkdirScanner();
      const agentsMdPath = path.join(testDir, 'AGENTS.md');
      fs.writeFileSync(agentsMdPath, "# Agents\n\nThis is the agents file.");

      const result = scanner.scan(testDir);

      expect(result.projectContext).toContain("# Agents");
    });

    it('should detect runtime dependencies', () => {
      const scanner = new WorkdirScanner();
      const packageJsonPath = path.join(testDir, 'package.json');
      fs.writeFileSync(packageJsonPath, JSON.stringify({
        dependencies: {
          express: "^4.18.0",
          lodash: "^4.17.0",
        },
      }));

      const result = scanner.scan(testDir);

      expect(result.runtimeDependencies.hasPackageJson).toBe(true);
      expect(result.runtimeDependencies.nodePackages).toContain("express");
      expect(result.runtimeDependencies.nodePackages).toContain("lodash");
    });

    it('should detect python requirements', () => {
      const scanner = new WorkdirScanner();
      const requirementsPath = path.join(testDir, "requirements.txt");
      fs.writeFileSync(requirementsPath, "pandas==2.0.0\nnumpy>=1.24.0\nrequests\n\n# Comment line\nflask==2.3.0");

      const result = scanner.scan(testDir);

      expect(result.runtimeDependencies.hasRequirementsTxt).toBe(true);
      expect(result.runtimeDependencies.pythonPackages).toEqual(expect.arrayContaining(['pandas', 'numpy', 'requests', 'flask']));
    });

    it('should scan tool definitions from SKILL.md frontmatter', () => {
      const scanner = new WorkdirScanner();
      const skillsDir = path.join(testDir, '.claude', 'skills');
      const skillDir = path.join(skillsDir, 'crm');
      fs.mkdirSync(skillDir, { recursive: true });

      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: crm
description: CRM operations
has-write-ops: true
packages: [pandas]
tools:
  - name:search_customers,description:Search customers,riskLevel:read,parameters:{"type":"object","properties":{"q":{"type":"string"}},"required":["q"]}
  - name:add_customer,description:Add customer,riskLevel:internal_write,parameters:{"type":"object","properties":{"name":{"type":"string"}}}
---

# CRM Skill`);

      const result = scanner.scan(testDir);

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].toolDefs).toHaveLength(2);
      expect(result.skills[0].toolDefs?.[0].name).toBe('search_customers');
      expect(result.skills[0].toolDefs?.[0].riskLevel).toBe('read');
      expect(result.skills[0].toolDefs?.[1].name).toBe('add_customer');
      expect(result.skills[0].toolDefs?.[1].riskLevel).toBe('internal_write');
    });
  });

  describe('isValidPath', () => {
    it('should return true for path within workdir', () => {
      expect(isValidPath('/home/user/project', '/home/user/project/src')).toBe(true);
    });

    it('should return false for path outside workdir', () => {
      expect(isValidPath('/home/user/project', '/home/user/other/src')).toBe(false);
      expect(isValidPath('/home/user/project', '/etc/passwd')).toBe(false);
    });

    it('should return false for path traversal attempts', () => {
      expect(isValidPath('/home/user/project', '/home/user/project/../etc')).toBe(false);
      expect(isValidPath('/home/user/project', '/home/user/project/sub/../../etc')).toBe(false);
    });
  });
});
