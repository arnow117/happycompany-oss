import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SkillValidator } from '../src/skill-validator.js';
import type { ScannedSkill } from '../src/workdir-scanner.js';

describe('SkillValidator', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'skill-validator-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createTestSkill(overrides: Partial<ScannedSkill> = {}): ScannedSkill {
    return {
      name: 'test-skill',
      description: 'A test skill',
      path: path.join(testDir, '.claude', 'skills', 'test-skill'),
      hasWriteOps: false,
      ...overrides,
    };
  }

  describe('validate', () => {
    it('should pass validation for valid skill', () => {
      const validator = new SkillValidator();
      const skill = createTestSkill();

      const result = validator.validate(skill, testDir);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should detect path traversal in skill path', () => {
      const validator = new SkillValidator();
      const skill = createTestSkill({
        path: '/etc/passwd',
      });

      const result = validator.validate(skill, testDir);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].severity).toBe('error');
      expect(result.errors[0].message).toContain('path traversal');
    });

    it('should detect path traversal in script paths', () => {
      const validator = new SkillValidator();
      const skill = createTestSkill({
        dependencies: {
          scripts: [{ path: '../../../etc/passwd', access: 'read' }],
        },
      });

      const result = validator.validate(skill, testDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('path traversal'))).toBe(true);
    });

    it('should warn about missing script files', () => {
      const validator = new SkillValidator();
      const skill = createTestSkill({
        dependencies: {
          scripts: [{ path: 'bin/nonexistent.sh', access: 'read' }],
        },
      });

      const result = validator.validate(skill, testDir);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].severity).toBe('warning');
      expect(result.warnings[0].message).toContain('does not exist');
    });

    it('should detect missing exec permission', () => {
      const validator = new SkillValidator();
      const binDir = path.join(testDir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });

      const scriptPath = path.join(binDir, 'script.sh');
      fs.writeFileSync(scriptPath, "#!/bin/bash\necho test\n");
      // No exec permission (default 0o644)

      const skill = createTestSkill({
        dependencies: {
          scripts: [{ path: 'bin/script.sh', access: 'exec' }],
        },
      });

      const result = validator.validate(skill, testDir);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].severity).toBe('error');
      expect(result.errors[0].message).toContain('lacks execute permission');
    });

    it('should warn about missing shebang on executable files', () => {
      const validator = new SkillValidator();
      const binDir = path.join(testDir, 'bin');
      fs.mkdirSync(binDir, { recursive: true });

      const scriptPath = path.join(binDir, 'script.sh');
      fs.writeFileSync(scriptPath, "echo test\n");
      fs.chmodSync(scriptPath, 0o755);

      const skill = createTestSkill({
        dependencies: {
          scripts: [{ path: 'bin/script.sh', access: 'exec' }],
        },
      });

      const result = validator.validate(skill, testDir);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].severity).toBe('warning');
      expect(result.warnings[0].message).toContain('missing shebang');
    });

    it('should warn about unavailable runtime', () => {
      const validator = new SkillValidator();
      const skill = createTestSkill({
        dependencies: {
          runtime: 'nonexistent-runtime-xyz',
        },
      });

      const result = validator.validate(skill, testDir);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].severity).toBe('warning');
      expect(result.warnings[0].message).toContain('may not be available');
    });

    it('should warn about missing packages in requirements.txt', () => {
      const validator = new SkillValidator();
      const requirementsPath = path.join(testDir, 'requirements.txt');
      fs.writeFileSync(requirementsPath, "flask==2.3.0\nrequests==2.31.0\n");

      const skill = createTestSkill({
        dependencies: {
          packages: ['pandas', 'numpy'],
        },
      });

      const result = validator.validate(skill, testDir);

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
      expect(result.warnings.some(w => w.message.includes('pandas'))).toBe(true);
      expect(result.warnings.some(w => w.message.includes('numpy'))).toBe(true);
    });

    it('should warn about missing requirements.txt for python packages', () => {
      const validator = new SkillValidator();
      const skill = createTestSkill({
        dependencies: {
          packages: ['pandas'],
          runtime: 'python3',
        },
      });

      const result = validator.validate(skill, testDir);

      expect(result.valid).toBe(true);
      // runtime check + requirements.txt missing + no package file
      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
      expect(result.warnings.some(w => w.message.includes('requirements.txt'))).toBe(true);
    });

    it('should validate packages against package.json', () => {
      const validator = new SkillValidator();
      const packageJsonPath = path.join(testDir, 'package.json');
      fs.writeFileSync(packageJsonPath, JSON.stringify({
        dependencies: {
          express: "^4.18.0",
          lodash: "^4.17.0",
        },
      }));

      const skill = createTestSkill({
        dependencies: {
          packages: ['express', 'lodash'],
        },
      });

      const result = validator.validate(skill, testDir);

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBe(0);
    });

    it('should detect missing packages in package.json', () => {
      const validator = new SkillValidator();
      const packageJsonPath = path.join(testDir, 'package.json');
      fs.writeFileSync(packageJsonPath, JSON.stringify({
        dependencies: {
          express: "^4.18.0",
        },
      }));

      const skill = createTestSkill({
        dependencies: {
          packages: ['express', 'lodash', '@types/node'],
        },
      });

      const result = validator.validate(skill, testDir);

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
      expect(result.warnings.some(w => w.message.includes('lodash'))).toBe(true);
      expect(result.warnings.some(w => w.message.includes('@types/node'))).toBe(true);
    });
  });
});
