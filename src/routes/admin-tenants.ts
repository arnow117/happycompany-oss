import type { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { TenantExporter } from '../tenant-export.js';
import { TenantTemplateSaver } from '../tenant-template-save.js';

export interface TenantRoutesDeps {
  corpDir: string;
}

function isTenantId(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value);
}

export function registerTenantRoutes(app: Hono, deps: TenantRoutesDeps): void {
  // POST /api/tenants — create a new enterprise tenant
  app.post('/api/tenants', async (c) => {
    const body = await c.req.json() as {
      name: string;
      displayName: string;
      description?: string;
    };
    if (!body.name || !body.displayName) {
      return c.json({ error: 'name and displayName are required' }, 400);
    }

    // Validate name: lowercase, no spaces, alphanumeric + hyphens
    if (!isTenantId(body.name)) {
      return c.json({ error: 'name must be lowercase alphanumeric (a-z, 0-9, -)' }, 400);
    }

    const tenantDir = path.join(deps.corpDir, body.name);
    if (fs.existsSync(tenantDir)) {
      return c.json({ error: 'Tenant already exists' }, 409);
    }

    // Create directory structure
    fs.mkdirSync(path.join(tenantDir, 'employees'), { recursive: true });

    const appJson = {
      displayName: body.displayName,
      description: body.description || '',
    };
    fs.writeFileSync(path.join(tenantDir, 'app.json'), JSON.stringify(appJson, null, 2));

    return c.json({ tenant: body.name, displayName: body.displayName, dir: tenantDir });
  });

  // GET /api/tenants — list all tenants
  app.get('/api/tenants', (c) => {
    if (!fs.existsSync(deps.corpDir)) return c.json({ tenants: [] });
    const entries = fs.readdirSync(deps.corpDir, { withFileTypes: true });
    const tenants = entries
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(deps.corpDir, e.name, 'app.json')))
      .map((e) => {
        const appJson = JSON.parse(fs.readFileSync(path.join(deps.corpDir, e.name, 'app.json'), 'utf-8'));
        return { id: e.name, displayName: appJson.displayName, description: appJson.description || '' };
      });
    return c.json({ tenants });
  });

  // GET /api/tenants/:id/export — export tenant as zip download
  app.get('/api/tenants/:id/export', async (c) => {
    const tenantId = c.req.param('id');
    if (!isTenantId(tenantId)) {
      return c.json({ error: 'Invalid tenant id' }, 400);
    }
    const tenantDir = path.join(deps.corpDir, tenantId);

    if (!fs.existsSync(tenantDir)) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    const zipBuffer = await new TenantExporter().exportTenant(tenantDir);
    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${tenantId}-export.zip"`,
      },
    });
  });

  // POST /api/tenants/:id/save-as-template — save tenant as industry template
  app.post('/api/tenants/:id/save-as-template', async (c) => {
    const tenantId = c.req.param('id');
    if (!isTenantId(tenantId)) {
      return c.json({ error: 'Invalid tenant id' }, 400);
    }
    const body = await c.req.json() as {
      templateId?: string;
      templateName?: string;
      description?: string;
    };

    if (!body.templateId || !body.templateName) {
      return c.json({ error: 'templateId and templateName required' }, 400);
    }

    const tenantDir = path.join(deps.corpDir, tenantId);
    if (!fs.existsSync(tenantDir)) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    const templatesDir = path.join(deps.corpDir, 'templates', 'industries');
    new TenantTemplateSaver().save(tenantDir, templatesDir, {
      templateId: body.templateId,
      templateName: body.templateName,
      description: body.description,
    });

    return c.json({ success: true, templateId: body.templateId });
  });
}
