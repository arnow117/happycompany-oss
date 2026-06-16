import fs from 'node:fs';
import path from 'node:path';

export interface SaveTemplateOptions {
  templateId: string;
  templateName: string;
  description?: string;
}

interface TemplateEmployee {
  template: string;
  role: string;
}

interface TemplateManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  employees: TemplateEmployee[];
}

export class TenantTemplateSaver {
  save(tenantDir: string, templatesDir: string, options: SaveTemplateOptions): void {
    const templateDir = path.join(templatesDir, options.templateId);
    const employeesDir = path.join(tenantDir, 'employees');

    fs.mkdirSync(path.join(templateDir, 'employees'), { recursive: true });

    const employeeFiles = fs
      .readdirSync(employeesDir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();

    const templateEmployees: TemplateEmployee[] = [];

    for (const file of employeeFiles) {
      const content = fs.readFileSync(path.join(employeesDir, file), 'utf-8');
      const role = this.extractRole(content);
      if (!role) continue;

      const cleaned = this.stripTenantSpecifics(content, role);
      const fileName = `${role}.yaml`;

      fs.writeFileSync(path.join(templateDir, 'employees', fileName), cleaned);
      templateEmployees.push({ template: `employees/${fileName}`, role });
    }

    // Generate template.json
    const template: TemplateManifest = {
      id: options.templateId,
      name: options.templateName,
      description: options.description ?? `从 ${path.basename(tenantDir)} 导出`,
      version: '1.0.0',
      employees: templateEmployees,
    };

    fs.writeFileSync(path.join(templateDir, 'template.json'), JSON.stringify(template, null, 2));
  }

  private extractRole(yaml: string): string | null {
    const match = yaml.match(/^role:\s*(.+)$/m);
    return match ? match[1].trim() : null;
  }

  private stripTenantSpecifics(content: string, role: string): string {
    return content
      .replace(/^id:.*$/m, `id: ${role}`)
      .replace(/^displayName:.*$/m, '')
      .replace(/\n{3,}/g, '\n\n');
  }
}
