import type { Hono } from 'hono';
import { CapabilityRegistry } from '../capability-registry.js';
import type { EmployeeManager } from '../orchestrator/employee-colony.js';
import { EmployeeLoader } from '../orchestrator/employee-loader.js';
import type { ToolRegistry } from '../tool-registry.js';

export interface CapabilityRoutesDeps {
  corpDir: string;
  toolRegistry: ToolRegistry;
  employeeManager?: EmployeeManager;
}

function safeTenant(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!/^[a-z][a-z0-9-]*$/.test(raw)) throw new Error('tenant must be lowercase alphanumeric');
  return raw;
}

function safeEmployeeId(raw: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(raw)) throw new Error('employee id must be lowercase alphanumeric');
  return raw;
}

export function registerCapabilityRoutes(app: Hono, deps: CapabilityRoutesDeps): void {
  function registry(): CapabilityRegistry {
    const runtimeEmployees = deps.employeeManager?.getEmployees().map((employee) => employee.app);
    const employees = runtimeEmployees && runtimeEmployees.length > 0
      ? runtimeEmployees
      : new EmployeeLoader({ corpDir: deps.corpDir }).load();
    return new CapabilityRegistry({
      corpDir: deps.corpDir,
      toolRegistry: deps.toolRegistry,
      employees,
    });
  }

  app.get('/api/admin/capabilities', (c) => {
    try {
      const tenant = safeTenant(c.req.query('tenant'));
      return c.json({ employees: registry().list(tenant) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.get('/api/admin/capabilities/:tenant/:employeeId', (c) => {
    try {
      const tenant = safeTenant(c.req.param('tenant'));
      const employeeId = safeEmployeeId(c.req.param('employeeId'));
      if (!tenant) return c.json({ error: 'tenant is required' }, 400);
      const report = registry().get(tenant, employeeId);
      if (!report) return c.json({ error: 'Employee capability report not found' }, 404);
      return c.json({ employee: report });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });
}
