import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Config } from './config.js';
import { EnterprisePeopleStore, type EnterprisePerson } from './enterprise-people.js';
import type { LoadedEmployee } from './orchestrator/employee-loader.js';
import type {
  ActorBinding,
  ActorIdentity,
  EntryChannel,
  EntryEndpoint,
  RuntimeInstance,
  RuntimeMessageInput,
  RuntimeProfile,
  RuntimeTargetOption,
} from './runtime-profile.js';

export type RuntimeResolverConfig = Pick<Config, 'bots'>;

export type RuntimeResolveErrorCode =
  | 'tenant_not_found'
  | 'entry_not_found'
  | 'actor_not_found'
  | 'binding_required'
  | 'employee_not_found'
  | 'cross_tenant_employee'
  | 'unsafe_workdir';

export class RuntimeResolveError extends Error {
  constructor(
    public readonly code: RuntimeResolveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeResolveError';
  }
}

export interface RuntimeResolverDeps {
  corpDir: string;
  config: RuntimeResolverConfig;
  employeeManager?: RuntimeEmployeeDirectory;
  peopleStore?: EnterprisePeopleStore;
}

export interface RuntimeRegisteredEmployee {
  app: LoadedEmployee;
}

export interface RuntimeEmployeeDirectory {
  get(appId: string, tenantName?: string): RuntimeRegisteredEmployee | undefined;
}

function channelFromBot(channel: string): EntryChannel {
  if (channel === 'web' || channel === 'dingtalk' || channel === 'feishu') return channel;
  return 'web';
}

function isInside(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function safeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default';
}

function uniqueBindings(bindings: ActorBinding[]): ActorBinding[] {
  const seen = new Set<string>();
  const result: ActorBinding[] = [];
  for (const binding of bindings) {
    if (seen.has(binding.employeeId)) continue;
    seen.add(binding.employeeId);
    result.push(binding);
  }
  return result;
}

export class RuntimeResolver {
  private readonly peopleStore: EnterprisePeopleStore;

  constructor(private readonly deps: RuntimeResolverDeps) {
    this.peopleStore = deps.peopleStore ?? new EnterprisePeopleStore(deps.corpDir);
  }

  listEntries(tenant?: string): EntryEndpoint[] {
    const entries: EntryEndpoint[] = [];
    for (const [id, bot] of Object.entries(this.deps.config.bots)) {
      const entryTenant = bot.tenant;
      if (!entryTenant) continue;
      if (tenant && entryTenant !== tenant) continue;
      entries.push({
        id,
        tenant: entryTenant,
        channel: channelFromBot(bot.channel),
        displayName: bot.displayName || id,
        routingMode: bot.routingMode ?? 'direct',
        enabled: bot.hidden !== true,
        configRef: id,
      });
    }
    return entries;
  }

  getEntry(tenant: string, entryId: string): EntryEndpoint {
    const entry = this.listEntries(tenant).find((item) => item.id === entryId);
    if (!entry) {
      throw new RuntimeResolveError('entry_not_found', `Entry not found: ${tenant}/${entryId}`);
    }
    return entry;
  }

  listActors(tenant: string): ActorIdentity[] {
    this.assertTenant(tenant);
    return this.peopleStore
      .list(tenant)
      .filter((person) => person.status === 'active')
      .map((person) => this.actorFromPerson(tenant, person));
  }

  getActor(tenant: string, actorId: string): ActorIdentity {
    const actor = this.listActors(tenant).find((item) => item.actorId === actorId);
    if (!actor) {
      throw new RuntimeResolveError('actor_not_found', `Actor not found: ${tenant}/${actorId}`);
    }
    return actor;
  }

  listTargets(tenant: string, actorId: string): RuntimeTargetOption[] {
    const actor = this.getActor(tenant, actorId);
    const targets: RuntimeTargetOption[] = [];
    for (const binding of actor.bindings) {
      const registered = this.getEmployee(tenant, binding.employeeId);
      if (!registered) continue;
      targets.push({
        employeeId: registered.app.id,
        displayName: registered.app.displayName || registered.app.id,
        role: registered.app.role || undefined,
        oneLiner: registered.app.oneLiner,
        isDefault: binding.isDefault === true,
      });
    }
    return targets;
  }

  resolve(input: RuntimeMessageInput): RuntimeProfile {
    const entry = this.getEntry(input.tenant, input.entryId);
    const actor = this.getActor(input.tenant, input.actorId);
    const employeeId = input.target?.employeeId ?? actor.bindings.find((binding) => binding.isDefault)?.employeeId ?? actor.bindings[0]?.employeeId;

    if (!employeeId) {
      throw new RuntimeResolveError('binding_required', `Actor has no bound employee: ${input.actorId}`);
    }

    const registered = this.getEmployee(input.tenant, employeeId);
    if (!registered) {
      throw new RuntimeResolveError('employee_not_found', `Employee not found: ${input.tenant}/${employeeId}`);
    }
    if (registered.app.tenantName !== input.tenant) {
      throw new RuntimeResolveError('cross_tenant_employee', `Employee belongs to another tenant: ${employeeId}`);
    }

    const instance = this.buildInstance(input, registered);
    return {
      tenant: input.tenant,
      entry,
      actor,
      employee: registered.app,
      instance,
      instructions: {
        systemPrompt: registered.app.systemPrompt,
        rules: [],
        handoffConditions: [],
      },
      tools: {
        allowed: registered.app.tools,
        denied: [],
        riskWarnings: [],
      },
      skills: registered.app.skills,
      memory: {
        namespace: `${input.tenant}:${actor.actorId}:${registered.app.id}`,
        workdir: instance.workdir,
      },
    };
  }

  private buildInstance(input: RuntimeMessageInput, employee: RuntimeRegisteredEmployee): RuntimeInstance {
    const actorSegment = safeSegment(input.actorId);
    const employeeWorkspace = employee.app.workspace || `agents/${employee.app.id}`;
    const tenantDir = resolve(this.deps.corpDir, input.tenant);
    const workspaceBase = isAbsolute(employeeWorkspace)
      ? resolve(employeeWorkspace)
      : resolve(tenantDir, employeeWorkspace);
    const workdir = resolve(workspaceBase, actorSegment);

    if (!isInside(tenantDir, workspaceBase) || !isInside(tenantDir, workdir)) {
      throw new RuntimeResolveError('unsafe_workdir', 'Resolved workdir must stay inside tenant directory');
    }

    const instanceId = `${input.tenant}:${actorSegment}:${employee.app.id}`;
    const sdkSessionScope = `${input.tenant}:${input.entryId}:${actorSegment}:${employee.app.id}:${input.chatId}`;
    return {
      tenant: input.tenant,
      employeeId: employee.app.id,
      actorId: input.actorId,
      instanceId,
      workdir,
      sdkSessionScope,
      source: 'published_employee',
    };
  }

  private actorFromPerson(tenant: string, person: EnterprisePerson): ActorIdentity {
    const bindings: ActorBinding[] = [];
    if (person.entryEmployee) {
      bindings.push({ employeeId: person.entryEmployee, role: person.role, isDefault: true });
    }
    for (const binding of person.roleBindings ?? []) {
      bindings.push({
        employeeId: binding.assistantId,
        role: binding.role,
        isDefault: bindings.length === 0,
      });
    }
    for (const employeeId of person.visibleEmployees ?? []) {
      bindings.push({
        employeeId,
        role: person.role,
        isDefault: bindings.length === 0,
      });
    }

    return {
      tenant,
      actorId: person.userId,
      source: 'people',
      displayName: person.name,
      peopleUserId: person.userId,
      bindings: uniqueBindings(bindings),
    };
  }

  private getEmployee(tenant: string, employeeId: string): RuntimeRegisteredEmployee | undefined {
    return this.deps.employeeManager?.get(employeeId, tenant);
  }

  private assertTenant(tenant: string): void {
    if (!existsSync(join(this.deps.corpDir, tenant))) {
      throw new RuntimeResolveError('tenant_not_found', `Tenant not found: ${tenant}`);
    }
  }
}
