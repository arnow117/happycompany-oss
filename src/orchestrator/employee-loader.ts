import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { logger } from '../logger.js';
import { employeeDefinitionSchema, type EmployeeDefinition } from './employee-schema.js';

export interface LoadedEmployee extends EmployeeDefinition {
  tenantName: string;
  filePath: string;
  loadedAtMs: number;
}

export interface EmployeeLoaderOptions {
  corpDir: string;
}

export interface ReloadResult {
  added: LoadedEmployee[];
  removed: LoadedEmployee[];
  changed: LoadedEmployee[];
  unchanged: LoadedEmployee[];
}

export class EmployeeLoader {
  constructor(private readonly options: EmployeeLoaderOptions) {}

  load(): LoadedEmployee[] {
    const { corpDir } = this.options;
    const results: LoadedEmployee[] = [];

    if (!fs.existsSync(corpDir)) {
      logger.warn({ corpDir }, 'corp directory does not exist');
      return results;
    }

    const tenants = fs.readdirSync(corpDir, { withFileTypes: true });
    for (const tenant of tenants) {
      if (!tenant.isDirectory()) continue;
      const tenantEmployees = this.loadTenant(tenant.name);
      results.push(...tenantEmployees);
    }

    logger.info({ employeeCount: results.length }, 'EmployeeLoader scan complete');
    return results;
  }

  loadTenant(tenantName: string): LoadedEmployee[] {
    const { corpDir } = this.options;
    const yamlDir = path.join(corpDir, tenantName, 'employees');

    const results: LoadedEmployee[] = [];
    const seenIds = new Set<string>();

    if (!fs.existsSync(yamlDir)) return results;
    const entries = fs.readdirSync(yamlDir);

    for (const entry of entries) {
      if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;
      const filePath = path.join(yamlDir, entry);
      if (!fs.statSync(filePath).isFile()) continue;

      const loaded = this.parseFile(filePath, tenantName);
      if (loaded && !seenIds.has(loaded.id)) {
        seenIds.add(loaded.id);
        results.push(loaded);
      }
    }

    return results;
  }

  reload(previous: LoadedEmployee[]): ReloadResult {
    const current = this.load();
    const previousMap = new Map(previous.map((emp) => [emp.filePath, emp]));
    const currentPaths = new Set(current.map((emp) => emp.filePath));

    const added: LoadedEmployee[] = [];
    const changed: LoadedEmployee[] = [];
    const unchanged: LoadedEmployee[] = [];
    const removed: LoadedEmployee[] = [];

    for (const emp of current) {
      const prev = previousMap.get(emp.filePath);
      if (!prev) {
        added.push(emp);
      } else {
        const curMtime = fs.statSync(emp.filePath).mtimeMs;
        if (prev.loadedAtMs !== curMtime) {
          changed.push(emp);
        } else {
          unchanged.push(prev);
        }
      }
    }

    for (const emp of previous) {
      if (!currentPaths.has(emp.filePath)) {
        removed.push(emp);
      }
    }

    return { added, removed, changed, unchanged };
  }

  private parseFile(filePath: string, tenantName: string): LoadedEmployee | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseYaml(raw);
      if (!parsed || typeof parsed !== 'object') {
        logger.warn({ filePath }, 'YAML file is empty or not an object, skipping');
        return null;
      }
      const validated = employeeDefinitionSchema.parse(parsed);
      const loadedAtMs = fs.statSync(filePath).mtimeMs;
      return {
        ...validated,
        tenantName,
        filePath,
        loadedAtMs,
      };
    } catch (err) {
      logger.warn({ filePath, err }, 'Failed to parse employee YAML config, skipping');
      return null;
    }
  }
}
