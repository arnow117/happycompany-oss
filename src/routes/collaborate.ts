import type { Hono } from 'hono';
import type { EmployeeManager } from '../orchestrator/employee-colony.js';
import { CollaborateService } from '../collaborate.js';

export interface CollaborateRoutesDeps {
  employeeManager?: EmployeeManager;
}

export function registerCollaborateRoutes(app: Hono, deps: CollaborateRoutesDeps): void {
  app.post('/internal/collaborate', async (c) => {
    const body = await c.req.json();
    const { tenant, sourceEmployeeId, target, message, mode } = body as {
      tenant?: string;
      sourceEmployeeId?: string;
      target?: string;
      message?: string;
      mode?: 'sync' | 'async';
    };

    if (!tenant || !sourceEmployeeId || !target || !message) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    if (!deps.employeeManager) {
      return c.json({ success: false, error: 'Employee manager not available' }, 503);
    }

    const service = new CollaborateService({ employeeManager: deps.employeeManager });
    const result = await service.send({
      tenant,
      sourceEmployeeId,
      target,
      message,
      mode: mode ?? 'sync',
    });
    return c.json(result);
  });
}
