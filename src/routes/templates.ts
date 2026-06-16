import type { Hono } from 'hono';
import path from 'node:path';
import { TemplateLoader, type ContractTemplate, type IndustryTemplate, type RoleTemplate } from '../template-loader.js';

export interface TemplateRoutesDeps {
  corpDir: string;
}

export function registerTemplateRoutes(app: Hono, deps: TemplateRoutesDeps): void {
  const templatesDir = path.join(deps.corpDir, 'templates');
  const loader = new TemplateLoader(templatesDir);

  app.get('/api/templates', (c) => {
    const templates = loader.list();
    return c.json({ templates });
  });

  app.get('/api/templates/:id', (c) => {
    const templateId = c.req.param('id');
    try {
      const detail = loader.loadDetailed(templateId);
      if (!detail) return c.json({ error: `Template not found: ${templateId}` }, 404);
      return c.json({
        template: detail.template,
        industry: detail.industry,
        roles: detail.roles,
        workflows: detail.workflows,
        contracts: detail.contracts,
        versions: detail.versions,
        employeeYamls: Object.fromEntries(detail.employeeYamls),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.post('/api/templates/:id/clone', async (c) => {
    try {
      const templateId = c.req.param('id');
      const body = await c.req.json() as { id?: string; name?: string; description?: string };
      if (!body.id || !body.name) return c.json({ error: 'id and name are required' }, 400);
      const template = loader.cloneTemplate(templateId, {
        id: body.id,
        name: body.name,
        description: body.description,
      });
      return c.json({ template });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.post('/api/templates/:id/versions', async (c) => {
    try {
      const templateId = c.req.param('id');
      const body = await c.req.json() as { label?: string };
      const version = loader.publishVersion(templateId, body.label ?? '');
      return c.json({ version });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.put('/api/templates/:id/industry', async (c) => {
    try {
      const templateId = c.req.param('id');
      const body = await c.req.json() as IndustryTemplate;
      loader.saveIndustryTemplate(templateId, body);
      return c.json({ industry: body });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.put('/api/templates/:id/roles/:roleId', async (c) => {
    try {
      const templateId = c.req.param('id');
      const roleId = c.req.param('roleId');
      const body = await c.req.json() as RoleTemplate;
      loader.saveRoleTemplate(templateId, roleId, body);
      return c.json({ role: body });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.put('/api/templates/:id/contracts/:contractId', async (c) => {
    try {
      const templateId = c.req.param('id');
      const contractId = c.req.param('contractId');
      const body = await c.req.json() as ContractTemplate;
      loader.saveContractTemplate(templateId, contractId, body);
      return c.json({ contract: body });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  app.post('/api/templates/:id/instantiate', async (c) => {
    const templateId = c.req.param('id');
    const body = await c.req.json() as {
      tenantName: string;
      nameMap?: Record<string, string>;
    };

    if (!body.tenantName) {
      return c.json({ error: 'tenantName is required' }, 400);
    }

    if (!/^[a-z][a-z0-9-]*$/.test(body.tenantName)) {
      return c.json({ error: 'tenantName must be lowercase alphanumeric (a-z, 0-9, -)' }, 400);
    }

    try {
      const createdFiles = await loader.instantiate(templateId, body.tenantName, deps.corpDir, {
        nameMap: body.nameMap,
      });
      return c.json({ tenant: body.tenantName, files: createdFiles });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 500);
    }
  });
}
