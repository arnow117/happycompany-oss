import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  EnterprisePeopleStore,
  normalizeDingTalkMembers,
} from '../src/enterprise-people.js';

describe('EnterprisePeopleStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'enterprise-people-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('syncs DingTalk members idempotently and preserves assistant bindings', () => {
    const store = new EnterprisePeopleStore(dir);

    store.sync('acme', [
      { userId: 'u1', name: '赵六', departments: [{ id: '1', name: '示例医疗' }] },
      { userId: 'u2', name: '温瀚翔', departments: [{ id: '1', name: '示例医疗' }] },
    ]);
    store.bindAssistant('acme', 'u1', { entryEmployee: 'sales-zhaoliu', routingMode: 'bound', visibleEmployees: ['sales-zhaoliu'] });

    const result = store.sync('acme', [
      { userId: 'u1', name: '赵六', departments: [{ id: '1', name: '示例医疗' }] },
      { userId: 'u3', name: '沈杨', departments: [{ id: '1', name: '示例医疗' }] },
    ]);

    expect(result).toEqual({ created: 1, updated: 1, inactive: 1, total: 3 });
    expect(store.list('acme')).toEqual([
      expect.objectContaining({
        userId: 'u1',
        name: '赵六',
        entryEmployee: 'sales-zhaoliu',
        routingMode: 'bound',
        visibleEmployees: ['sales-zhaoliu'],
        status: 'active',
      }),
      expect.objectContaining({ userId: 'u2', status: 'inactive' }),
      expect.objectContaining({ userId: 'u3', status: 'active' }),
    ]);
  });

  it('can clear role and assistant bindings', () => {
    const store = new EnterprisePeopleStore(dir);

    store.sync('acme', [
      { userId: 'u1', name: '赵六', departments: [{ id: '1', name: '示例医疗' }] },
    ]);
    store.bindAssistant('acme', 'u1', { entryEmployee: 'sales-zhaoliu', routingMode: 'bound', visibleEmployees: ['sales-zhaoliu'] });
    const updated = store.bindAssistant('acme', 'u1', { entryEmployee: null });

    expect(updated?.userId).toBe('u1');
    expect(updated).not.toHaveProperty('entryEmployee');
    expect(updated).not.toHaveProperty('routingMode');
    expect(updated).not.toHaveProperty('visibleEmployees');

    const persisted = store.list('acme')[0];
    expect(persisted?.userId).toBe('u1');
    expect(persisted).not.toHaveProperty('entryEmployee');
    expect(persisted).not.toHaveProperty('routingMode');
    expect(persisted).not.toHaveProperty('visibleEmployees');
  });

  it('persists selector choice as the current entry employee', () => {
    const store = new EnterprisePeopleStore(dir);

    store.sync('acme', [
      { userId: 'u2', name: '温瀚翔', departments: [{ id: '1', name: '示例医疗' }] },
    ]);
    store.bindAssistant('acme', 'u2', {
      routingMode: 'selector',
      visibleEmployees: ['sales-zhangsan', 'finance-wangwu'],
    });
    store.bindAssistant('acme', 'u2', {
      entryEmployee: 'sales-zhangsan',
      routingMode: 'selector',
    });

    const reloaded = new EnterprisePeopleStore(dir).list('acme')[0];
    expect(reloaded).toEqual(expect.objectContaining({
      userId: 'u2',
      routingMode: 'selector',
      entryEmployee: 'sales-zhangsan',
      visibleEmployees: ['sales-zhangsan', 'finance-wangwu'],
    }));
  });

  it('can bind multiple role assistants to one person', () => {
    const store = new EnterprisePeopleStore(dir);

    store.sync('acme', [
      { userId: 'u2', name: '温瀚翔', departments: [{ id: '1', name: '示例医疗' }] },
    ]);
    const updated = store.bindRoleAssistants('acme', 'u2', [
      { role: 'sales', assistantId: 'sales-zhangsan' },
      { role: 'maintenance', assistantId: 'maintenance-lisi' },
      { role: 'finance', assistantId: 'finance-wangwu' },
    ]);

    expect(updated).toEqual(expect.objectContaining({
      userId: 'u2',
      roleBindings: [
        { role: 'sales', assistantId: 'sales-zhangsan' },
        { role: 'maintenance', assistantId: 'maintenance-lisi' },
        { role: 'finance', assistantId: 'finance-wangwu' },
      ],
    }));
    expect(store.list('acme')[0]?.roleBindings).toHaveLength(3);
  });

  it('migrates old format { role, assistantId } to new format { entryEmployee, routingMode, visibleEmployees }', () => {
    const store = new EnterprisePeopleStore(dir);

    // Write old format directly to people.json
    const peopleJsonPath = join(dir, 'acme', 'people.json');
    mkdirSync(dirname(peopleJsonPath), { recursive: true });
    writeFileSync(peopleJsonPath, JSON.stringify([
      { userId: 'u1', name: '张三', role: 'sales', assistantId: 'sales-zhangsan' },
    ], null, 2));

    // Read should trigger migration
    const people = store.list('acme');

    expect(people).toHaveLength(1);
    expect(people[0]).toEqual(expect.objectContaining({
      userId: 'u1',
      name: '张三',
      entryEmployee: 'sales-zhangsan',
      routingMode: 'bound',
      visibleEmployees: [],
    }));
    expect(people[0]).not.toHaveProperty('role');
    expect(people[0]).not.toHaveProperty('assistantId');

    // Verify migration persisted
    const peopleAfter = store.list('acme');
    expect(peopleAfter[0]).toEqual(expect.objectContaining({
      entryEmployee: 'sales-zhangsan',
      routingMode: 'bound',
      visibleEmployees: [],
    }));
  });
});

describe('normalizeDingTalkMembers', () => {
  it('normalizes dept list-members payload into enterprise people', () => {
    const people = normalizeDingTalkMembers({
      deptUserList: [
        { userInfo: { userId: 'u1', name: '赵六' } },
        { userInfo: { userId: 'u2', name: '温瀚翔' } },
      ],
    }, { id: '1', name: '杭州示例医疗器械有限公司' });

    expect(people).toEqual([
      { userId: 'u1', name: '赵六', departments: [{ id: '1', name: '杭州示例医疗器械有限公司' }] },
      { userId: 'u2', name: '温瀚翔', departments: [{ id: '1', name: '杭州示例医疗器械有限公司' }] },
    ]);
  });
});
