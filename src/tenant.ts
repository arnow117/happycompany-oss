import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import { toolManifestSchema, appJsonSchema } from './tool-schemas.js';
import type { ToolManifest, AppJson } from './types.js';

export interface TenantInfo {
  name: string;
  dir: string;
  appJson?: AppJson;
}

export class TenantMgr {
  private readonly corpDir: string;
  private tenants = new Map<string, TenantInfo>();

  constructor(corpDir: string) {
    this.corpDir = corpDir;
  }

  scan(): void {
    this.tenants.clear();

    if (!fs.existsSync(this.corpDir)) {
      logger.warn({ corpDir: this.corpDir }, 'corp directory does not exist');
      return;
    }

    const entries = fs.readdirSync(this.corpDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const tenantName = entry.name;
      const tenantDir = path.join(this.corpDir, tenantName);

      // Must have app.json to be a valid tenant
      const appJsonPath = path.join(tenantDir, 'app.json');
      let appJson: AppJson | undefined;
      if (fs.existsSync(appJsonPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
          appJson = appJsonSchema.parse(raw);
        } catch (err) {
          logger.warn({ tenant: tenantName, err }, 'Failed to parse app.json');
        }
      } else {
        continue;
      }

      this.tenants.set(tenantName, { name: tenantName, dir: tenantDir, appJson });
    }

    logger.info(
      { count: this.tenants.size, names: Array.from(this.tenants.keys()) },
      'TenantMgr scan complete',
    );
  }

  getTenant(name: string): TenantInfo | undefined {
    return this.tenants.get(name);
  }

  getAllTenants(): TenantInfo[] {
    return Array.from(this.tenants.values());
  }

  getTenantNames(): string[] {
    return Array.from(this.tenants.keys());
  }

  /**
   * Resolve tenant name from a bot's agentDir.
   * Convention: agentDir contains "/corp/{tenantName}/" somewhere.
   */
  resolveFromAgentDir(agentDir: string): TenantInfo | undefined {
    const normalized = path.resolve(agentDir);
    for (const [, info] of this.tenants) {
      const tenantPath = path.resolve(info.dir);
      if (normalized.startsWith(tenantPath) || normalized === tenantPath) {
        return info;
      }
    }
    return undefined;
  }

  dataDir(tenantName: string): string {
    const info = this.tenants.get(tenantName);
    if (!info) throw new Error(`Unknown tenant: ${tenantName}`);
    const dir = path.join(info.dir, 'data');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  memoryDir(tenantName: string): string {
    return path.join(this.dataDir(tenantName), 'memory');
  }
}
