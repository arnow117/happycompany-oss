import fs from 'node:fs';
import path from 'node:path';
import { isValidPath } from './workdir-scanner.js';
import type { ScannedSkill } from './workdir-scanner.js';

// --- Types ---

export interface ValidationIssue {
  path: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

// --- Skill Validator ---

export class SkillValidator {
  validate(skill: ScannedSkill, workdir: string): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // Rule 1: Path traversal check
    if (!isValidPath(workdir, skill.path)) {
      errors.push({
        path: skill.path,
        severity: 'error',
        message: 'Skill path is outside workdir (path traversal detected)',
      });
    }

    // Rule 2: Exec permission and shebang check for scripts
    if (skill.dependencies?.scripts) {
      for (const script of skill.dependencies.scripts) {
        const scriptPath = path.join(workdir, script.path);

        // Path traversal check for script
        if (!isValidPath(workdir, scriptPath)) {
          errors.push({
            path: script.path,
            severity: 'error',
            message: 'Script path is outside workdir (path traversal detected)',
          });
          continue;
        }

        // Check file exists
        if (!fs.existsSync(scriptPath)) {
          warnings.push({
            path: script.path,
            severity: 'warning',
            message: 'Script file does not exist',
          });
          continue;
        }

        // Rule 2a: Exec permission check
        if (script.access === 'exec') {
          try {
            const stats = fs.statSync(scriptPath);
            const isExecutable = (stats.mode & fs.constants.S_IXUSR) !== 0;

            if (!isExecutable) {
              errors.push({
                path: script.path,
                severity: 'error',
                message: 'Script has access: exec but lacks execute permission',
              });
            }
          } catch {
            errors.push({
              path: script.path,
              severity: 'error',
              message: 'Script file cannot be accessed',
            });
          }

          // Rule 3: Shebang check for executable files
          try {
            const content = fs.readFileSync(scriptPath, 'utf-8');
            if (!content.startsWith('#!')) {
              warnings.push({
                path: script.path,
                severity: 'warning',
                message: 'Executable script is missing shebang',
              });
            }
          } catch {
            // Already handled above
          }
        }
      }
    }

    // Rule 4: Runtime dependency availability check
    if (skill.dependencies?.runtime) {
      const runtime = skill.dependencies.runtime;
      const isAvailable = this.checkRuntimeAvailability(runtime);

      if (!isAvailable) {
        warnings.push({
          path: skill.path,
          severity: 'warning',
          message: `Declared runtime '${runtime}' may not be available on this system`,
        });
      }
    }

    // Rule 5: Package check
    if (skill.dependencies?.packages && skill.dependencies.packages.length > 0) {
      const packageIssues = this.checkPackages(workdir, skill.dependencies.packages);
      warnings.push(...packageIssues);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private checkRuntimeAvailability(runtime: string): boolean {
    const commandMap: Record<string, string> = {
      'python3': 'python3',
      'python': 'python',
      'node': 'node',
      'nodejs': 'node',
    };

    const command = commandMap[runtime] || runtime;

    try {
      fs.accessSync(command, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private checkPackages(workdir: string, packages: string[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    const requirementsTxtPath = path.join(workdir, 'requirements.txt');
    const packageJsonPath = path.join(workdir, 'package.json');

    const hasRequirementsTxt = fs.existsSync(requirementsTxtPath);
    const hasPackageJson = fs.existsSync(packageJsonPath);

    // Check package.json first to track which packages are already resolved
    const foundInPackageJson = new Set<string>();

    if (hasPackageJson) {
      try {
        const content = fs.readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(content) as Record<string, unknown>;
        const deps = packageJson.dependencies as Record<string, string> | undefined;
        const devDeps = packageJson.devDependencies as Record<string, string> | undefined;

        const allDeps = new Set([...Object.keys(deps || {}), ...Object.keys(devDeps || {})]);

        for (const pkg of packages) {
          if (allDeps.has(pkg)) {
            foundInPackageJson.add(pkg);
          } else {
            issues.push({
              path: packageJsonPath,
              severity: 'warning',
              message: `Package '${pkg}' is declared but not found in package.json`,
            });
          }
        }
      } catch {
        // Skip if file cannot be parsed
      }
    }

    // Check requirements.txt for packages not already found in package.json
    const hasPythonStylePackages = packages.some(pkg => /^[a-z][a-z0-9_]*$/.test(pkg) && !pkg.includes('-'));

    if (hasRequirementsTxt) {
      try {
        const content = fs.readFileSync(requirementsTxtPath, 'utf-8');
        const lines = content
          .split('\n')
          .map((line: string) => line.trim())
          .filter((line: string) => line && !line.startsWith('#'))
          .map((line: string) => line.split('==')[0].split('>=')[0].split('<=')[0]);

        for (const pkg of packages) {
          if (!foundInPackageJson.has(pkg) && !lines.includes(pkg)) {
            issues.push({
              path: requirementsTxtPath,
              severity: 'warning',
              message: `Package '${pkg}' is declared but not found in requirements.txt`,
            });
          }
        }
      } catch {
        // Skip if file cannot be read
      }
    } else if (hasPythonStylePackages) {
      const unresolved = packages.filter(pkg => /^[a-z][a-z0-9_]*$/.test(pkg) && !pkg.includes('-') && !foundInPackageJson.has(pkg));
      if (unresolved.length > 0) {
        issues.push({
          path: workdir,
          severity: 'warning',
          message: 'Python packages declared but requirements.txt not found',
        });
      }
    }

    const hasNodeStylePackages = packages.some(pkg => pkg.startsWith('@') || pkg.includes('-'));
    if (hasNodeStylePackages && !hasPackageJson) {
      issues.push({
        path: workdir,
        severity: 'warning',
        message: 'Node packages declared but package.json not found',
      });
    }

    // Warn if no package file found at all
    if (!hasRequirementsTxt && !hasPackageJson && packages.length > 0) {
      issues.push({
        path: workdir,
        severity: 'warning',
        message: 'Packages declared but no requirements.txt or package.json found',
      });
    }

    return issues;
  }
}
