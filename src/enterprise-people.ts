import fs from 'node:fs';
import path from 'node:path';

export interface EnterpriseDepartment {
  id: string;
  name: string;
}

export interface EnterprisePersonInput {
  userId: string;
  name: string;
  departments: EnterpriseDepartment[];
}

export interface EnterprisePerson extends EnterprisePersonInput {
  role?: string;
  assistantId?: string;
  roleBindings?: EnterpriseRoleBinding[];
  status: 'active' | 'inactive';
  source: 'dingtalk' | 'manual';
  syncedAt: number;
  updatedAt: number;
  entryEmployee?: string;
  routingMode?: 'bound' | 'selector';
  visibleEmployees?: string[];
}

export interface EnterpriseRoleBinding {
  role: string;
  assistantId: string;
}

export interface EnterprisePersonBinding {
  role?: string | null;
  assistantId?: string | null;
  entryEmployee?: string;
  routingMode?: 'bound' | 'selector';
  visibleEmployees?: string[];
}

export interface SyncResult {
  created: number;
  updated: number;
  inactive: number;
  total: number;
}

export class EnterprisePeopleStore {
  constructor(private readonly corpDir: string) {}

  list(tenant: string): EnterprisePerson[] {
    return this.read(tenant).sort((a, b) => a.userId.localeCompare(b.userId));
  }

  sync(tenant: string, incoming: EnterprisePersonInput[]): SyncResult {
    const now = Date.now();
    const current = this.read(tenant);
    const byId = new Map(current.map((person) => [person.userId, person]));
    const seen = new Set<string>();
    let created = 0;
    let updated = 0;

    for (const item of incoming) {
      seen.add(item.userId);
      const existing = byId.get(item.userId);
      if (!existing) {
        byId.set(item.userId, {
          ...item,
          status: 'active',
          source: 'dingtalk',
          syncedAt: now,
          updatedAt: now,
        });
        created++;
        continue;
      }

      byId.set(item.userId, {
        ...existing,
        name: item.name,
        departments: item.departments,
        status: 'active',
        source: 'dingtalk',
        syncedAt: now,
        updatedAt: now,
      });
      updated++;
    }

    let inactive = 0;
    for (const [userId, person] of byId) {
      if (!seen.has(userId) && person.status !== 'inactive') {
        byId.set(userId, { ...person, status: 'inactive', updatedAt: now });
        inactive++;
      }
    }

    const people = Array.from(byId.values()).sort((a, b) => a.userId.localeCompare(b.userId));
    this.write(tenant, people);
    return { created, updated, inactive, total: people.length };
  }

  bindAssistant(
    tenant: string,
    userId: string,
    binding: EnterprisePersonBinding,
  ): EnterprisePerson | null {
    const people = this.read(tenant);
    const idx = people.findIndex((person) => person.userId === userId);
    if (idx < 0) return null;
    const existing = people[idx]!;
    const updated: EnterprisePerson = {
      ...existing,
      updatedAt: Date.now(),
    };
    if (binding.role !== undefined) {
      if (binding.role) updated.role = binding.role;
      else delete updated.role;
    }
    if (binding.assistantId !== undefined) {
      if (binding.assistantId && binding.entryEmployee === undefined) {
        updated.entryEmployee = binding.assistantId;
        updated.routingMode = 'bound';
        updated.visibleEmployees = [];
      } else if (!binding.assistantId && binding.entryEmployee === undefined) {
        delete updated.entryEmployee;
        delete updated.routingMode;
        delete updated.visibleEmployees;
      }
      delete updated.assistantId;
    }
    if (binding.entryEmployee !== undefined) {
      if (binding.entryEmployee) {
        updated.entryEmployee = binding.entryEmployee;
      } else {
        delete updated.entryEmployee;
        delete updated.routingMode;
        delete updated.visibleEmployees;
      }
    }
    if (binding.routingMode !== undefined && binding.routingMode) {
      updated.routingMode = binding.routingMode;
    }
    if (binding.visibleEmployees !== undefined && binding.visibleEmployees && binding.visibleEmployees.length > 0) {
      updated.visibleEmployees = binding.visibleEmployees;
    }
    people[idx] = updated;
    this.write(tenant, people);
    return updated;
  }

  bindRoleAssistants(
    tenant: string,
    userId: string,
    bindings: EnterpriseRoleBinding[],
  ): EnterprisePerson | null {
    const people = this.read(tenant);
    const idx = people.findIndex((person) => person.userId === userId);
    if (idx < 0) return null;

    const deduped = new Map<string, EnterpriseRoleBinding>();
    for (const binding of bindings) {
      if (!binding.role || !binding.assistantId) continue;
      deduped.set(binding.role, binding);
    }

    const existing = people[idx]!;
    const updated: EnterprisePerson = {
      ...existing,
      roleBindings: Array.from(deduped.values()),
      updatedAt: Date.now(),
    };

    people[idx] = updated;
    this.write(tenant, people);
    return updated;
  }

  private filePath(tenant: string): string {
    return path.join(this.corpDir, tenant, 'people.json');
  }

  private read(tenant: string): EnterprisePerson[] {
    const file = this.filePath(tenant);
    if (!fs.existsSync(file)) return [];
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    const people = Array.isArray(raw) ? raw as EnterprisePerson[] : [];

    // Migration: Convert old format { role, assistantId } to new format { entryEmployee, routingMode, visibleEmployees }
    let needsMigration = false;
    for (const person of people) {
      if ('assistantId' in person && !('entryEmployee' in person)) {
        person.entryEmployee = person.assistantId;
        person.routingMode = 'bound';
        person.visibleEmployees = [];
        delete person.assistantId;
        delete person.role;
        needsMigration = true;
      }
    }

    if (needsMigration) {
      this.write(tenant, people);
    }

    return people;
  }

  private write(tenant: string, people: EnterprisePerson[]): void {
    const file = this.filePath(tenant);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(people, null, 2), 'utf-8');
  }
}

export function normalizeDingTalkMembers(
  payload: unknown,
  department: EnterpriseDepartment,
): EnterprisePersonInput[] {
  const body = payload as { deptUserList?: Array<{ userInfo?: { userId?: string; name?: string } }> };
  return (body.deptUserList ?? [])
    .map((item) => item.userInfo)
    .filter((user): user is { userId: string; name: string } => Boolean(user?.userId && user?.name))
    .map((user) => ({
      userId: user.userId,
      name: user.name,
      departments: [department],
    }));
}
