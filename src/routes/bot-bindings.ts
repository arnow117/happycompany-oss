import type { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import type { MutableRef } from '../web.js';
import { saveConfig as saveConfigEncrypted, type Config } from '../config.js';
import type { BotManager } from '../bot.js';

export interface BotBindingRoutesDeps {
  botManager: BotManager;
  configRef: MutableRef<Config>;
  configPath: string;
  keyPath: string;
  corpDir: string;
}

interface EmployeeOption {
  id: string;
  displayName: string;
  tenant: string;
  workspace: string;
}

function listEmployees(corpDir: string): EmployeeOption[] {
  if (!fs.existsSync(corpDir)) return [];
  const result: EmployeeOption[] = [];

  for (const tenantEntry of fs.readdirSync(corpDir, { withFileTypes: true })) {
    if (!tenantEntry.isDirectory() || tenantEntry.name === 'templates') continue;
    const employeesDir = path.join(corpDir, tenantEntry.name, 'employees');
    if (!fs.existsSync(employeesDir)) continue;
    for (const file of fs.readdirSync(employeesDir)) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      const raw = fs.readFileSync(path.join(employeesDir, file), 'utf-8');
      const id = raw.match(/^id:\s*(.+)$/m)?.[1]?.trim() || path.basename(file, path.extname(file));
      const displayName = raw.match(/^displayName:\s*(.+)$/m)?.[1]?.trim() || id;
      const workspace = raw.match(/^workspace:\s*(.+)$/m)?.[1]?.trim() || `agents/${id}`;
      result.push({
        id,
        displayName: displayName.replace(/^["']|["']$/g, ''),
        tenant: tenantEntry.name,
        workspace: path.isAbsolute(workspace) ? workspace : path.join(corpDir, tenantEntry.name, workspace),
      });
    }
  }

  return result;
}


export function registerBotBindingRoutes(app: Hono, deps: BotBindingRoutesDeps): void {
  app.get('/api/admin/bot-bindings', (c) => {
    const employees = listEmployees(deps.corpDir);
    const byWorkspace = new Map(employees.map((employee) => [path.resolve(employee.workspace), employee]));
    const bindings = deps.botManager.getBotInfos().map((bot) => {
      const employee = bot.routingMode === 'employee-director'
        ? null
        : byWorkspace.get(path.resolve(bot.workdir));
      return {
        botName: bot.name,
        botDisplayName: bot.displayName,
        channel: bot.channel,
        status: bot.status,
        workdir: bot.workdir,
        employeeId: employee?.id ?? null,
        employeeDisplayName: employee?.displayName ?? null,
        tenant: employee?.tenant ?? null,
      };
    });
    return c.json({ bindings, employees });
  });

  app.post('/api/admin/bot-bindings/:botName', async (c) => {
    const botName = c.req.param('botName');
    const body = (await c.req.json()) as { employeeId?: string | null };
    const config = deps.configRef.current;
    const bot = config.bots[botName];
    if (!bot) return c.json({ error: 'Bot not found' }, 404);

    if (!body.employeeId) {
      delete bot.cwd;
      saveConfigEncrypted(deps.configPath, config, deps.keyPath);
      return c.json({ binding: { botName, employeeId: null } });
    }

    const employee = listEmployees(deps.corpDir).find((item) => item.id === body.employeeId);
    if (!employee) return c.json({ error: 'Employee not found' }, 404);

    delete bot.cwd;
    bot.tenant = employee.tenant;
    bot.routingMode = 'employee-director';
    saveConfigEncrypted(deps.configPath, config, deps.keyPath);
    return c.json({
      binding: {
        botName,
        employeeId: employee.id,
        tenant: employee.tenant,
        employeeWorkspace: employee.workspace,
      },
    });
  });
}
