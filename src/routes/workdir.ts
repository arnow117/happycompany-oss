import type { Hono } from 'hono';
import path from 'node:path';
import { WorkdirScanner, type ScanResult } from '../workdir-scanner.js';
import { SkillValidator, type ValidationResult } from '../skill-validator.js';
import { WorkdirSyncService } from '../workdir-sync.js';

export interface WorkdirRouteDeps {
  // No deps needed — scanner and validator are stateless
}

export function registerWorkdirRoutes(app: Hono, _deps: WorkdirRouteDeps): void {
  const scanner = new WorkdirScanner();
  const validator = new SkillValidator();

  app.get('/api/admin/workdir/scan', (c) => {
    const query = c.req.query();
    const workdirPath = query.path;

    if (!workdirPath) {
      return c.json({ error: 'path query parameter is required' }, 400);
    }

    const resolvedPath = path.resolve(workdirPath);

    try {
      const result: ScanResult = scanner.scan(resolvedPath);
      return c.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  app.post('/api/admin/workdir/validate', async (c) => {
    try {
      const body = await c.req.json();
      const { workdir, skillPath } = body as Record<string, unknown>;

      if (typeof workdir !== 'string' || !workdir) {
        return c.json({ error: 'workdir is required' }, 400);
      }

      if (typeof skillPath !== 'string' || !skillPath) {
        return c.json({ error: 'skillPath is required' }, 400);
      }

      const resolvedWorkdir = path.resolve(workdir);

      const scanResult: ScanResult = scanner.scan(resolvedWorkdir);

      const skill = scanResult.skills.find(
        (s) => s.path === skillPath || path.relative(resolvedWorkdir, s.path) === skillPath
      );

      if (!skill) {
        return c.json({ error: 'Skill not found in workdir' }, 404);
      }

      const validationResult: ValidationResult = validator.validate(skill, resolvedWorkdir);

      return c.json(validationResult);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });

  app.post('/api/admin/workdir/sync', async (c) => {
    try {
      const body = await c.req.json();
      const { path: workdirPath, syncDir } = body as Record<string, unknown>;

      if (typeof workdirPath !== 'string' || !workdirPath) {
        return c.json({ error: 'path is required' }, 400);
      }

      const resolvedPath = path.resolve(workdirPath);
      const syncDirResolved = typeof syncDir === 'string' && syncDir
        ? syncDir
        : path.join(resolvedPath, '.workdir-sync');

      const syncService = new WorkdirSyncService(scanner, syncDirResolved);
      const result = syncService.sync(resolvedPath);

      return c.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });
}