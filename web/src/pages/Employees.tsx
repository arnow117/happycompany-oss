import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, BrainCircuit, Network, UserRoundCheck, UsersRound, Wrench } from 'lucide-react';
import { api, type Employee, type EnterprisePerson } from '../lib/api';
import { useChatStore } from '../stores/chat';

const ROLE_LABELS: Record<string, string> = {
  sales: '销售',
  finance: '财务',
  maintenance: '维修',
  'maintenance-qa': '售后质检',
  customer_service: '客服',
  hr: '人事',
  admin: '管理',
  readonly: '只读',
  member: '成员',
};

interface BindingSummary {
  defaultPeople: EnterprisePerson[];
  visiblePeople: EnterprisePerson[];
  yamlUserId?: string;
}

interface EmployeeSummary {
  totalEmployees: number;
  totalBoundPeople: number;
  totalTools: number;
  totalSkills: number;
  selectorPeople: number;
  unboundActivePeople: number;
  roleCounts: Array<{ role: string; count: number }>;
}

function labelRole(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

function shortPrompt(prompt: string): string {
  const compact = (prompt || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '还没有写入 PM / Prompt。';
  return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
}

function formatList(items: string[], empty = '未配置'): string {
  return items.length > 0 ? items.join('、') : empty;
}

function toolAppName(tool: string): string | null {
  const [app] = tool.split(':');
  return app && app !== tool ? app : null;
}

function bindingNames(binding: BindingSummary): string[] {
  return [
    ...binding.defaultPeople.map((person) => `${person.name} · ${person.userId}`),
    ...(binding.yamlUserId ? [`YAML 绑定 · ${binding.yamlUserId}`] : []),
  ];
}

interface ContextPreviewSection {
  tone: 'static' | 'platform' | 'dynamic';
  title: string;
  note: string;
  body: string;
}

function buildContextPreview(
  employee: Employee,
  binding: BindingSummary,
  employeeById: Map<string, Employee>,
): ContextPreviewSection[] {
  const targets = employee.allowedTargets ?? [];
  const collaboration = targets.length > 0
    ? targets.map((id) => employeeById.get(id)?.displayName ?? id)
    : binding.visiblePeople.map((person) => `${person.name} · ${person.userId}`);
  const bound = bindingNames(binding);

  return [
    {
      tone: 'static',
      title: '基础 PM',
      note: '来自员工配置，通常会进入模型上下文',
      body: employee.systemPrompt || '未配置 PM / Prompt。',
    },
    {
      tone: 'static',
      title: '员工身份',
      note: '来自展示名和职责说明',
      body: [`岗位：${employee.displayName}`, `职责说明：${employee.description || '当前没有额外业务说明。'}`].join('\n'),
    },
    {
      tone: 'platform',
      title: '路由角色键',
      note: '平台用来分组/绑定/路由，不一定逐字进入模型 Prompt',
      body: employee.role || '未配置',
    },
    {
      tone: 'platform',
      title: '路由标签',
      note: '平台用来解释和筛选员工能力，不一定逐字进入模型 Prompt',
      body: formatList(employee.capabilities ?? []),
    },
    {
      tone: 'static',
      title: '技能声明',
      note: '声明员工可使用的技能',
      body: formatList(employee.skills ?? []),
    },
    {
      tone: 'static',
      title: '工具声明',
      note: '声明员工可调用的工具',
      body: formatList(employee.tools ?? []),
    },
    {
      tone: 'dynamic',
      title: '当前人员与协作上下文',
      note: '运行时会根据入口用户、绑定关系和会话动态变化',
      body: [`默认绑定：${formatList(bound, '暂无')}`, `协作目标：${formatList(collaboration, '暂无')}`].join('\n'),
    },
  ];
}

function buildBindingMap(employees: Employee[], people: EnterprisePerson[]): Map<string, BindingSummary> {
  const map = new Map<string, BindingSummary>();
  for (const employee of employees) {
    map.set(employee.id, { defaultPeople: [], visiblePeople: [] });
  }

  for (const person of people) {
    const defaultEmployeeId = person.entryEmployee || person.assistantId || '';
    const defaultSummary = map.get(defaultEmployeeId);
    if (defaultSummary) {
      defaultSummary.defaultPeople.push(person);
    }

    for (const employeeId of person.visibleEmployees ?? []) {
      if (employeeId === defaultEmployeeId) continue;
      const visibleSummary = map.get(employeeId);
      if (visibleSummary) visibleSummary.visiblePeople.push(person);
    }
  }

  for (const employee of employees) {
    const summary = map.get(employee.id);
    if (!summary || !employee.humanUserId) continue;
    const alreadyListed = summary.defaultPeople.some((person) => person.userId === employee.humanUserId);
    if (!alreadyListed) summary.yamlUserId = employee.humanUserId;
  }

  return map;
}

function buildSummary(employees: Employee[], people: EnterprisePerson[], bindings: Map<string, BindingSummary>): EmployeeSummary {
  const tools = new Set<string>();
  const skills = new Set<string>();
  const roles = new Map<string, number>();
  let totalBoundPeople = 0;

  for (const employee of employees) {
    for (const tool of employee.tools ?? []) tools.add(tool);
    for (const skill of employee.skills ?? []) skills.add(skill);
    roles.set(employee.role, (roles.get(employee.role) ?? 0) + 1);

    const binding = bindings.get(employee.id);
    if (binding) totalBoundPeople += binding.defaultPeople.length + (binding.yamlUserId ? 1 : 0);
  }

  const activePeople = people.filter((person) => person.status === 'active');
  const boundPeopleIds = new Set(
    people
      .filter((person) => Boolean(person.entryEmployee || person.assistantId))
      .map((person) => person.userId),
  );

  return {
    totalEmployees: employees.length,
    totalBoundPeople,
    totalTools: tools.size,
    totalSkills: skills.size,
    selectorPeople: people.filter((person) => person.routingMode === 'selector').length,
    unboundActivePeople: activePeople.filter((person) => !boundPeopleIds.has(person.userId)).length,
    roleCounts: Array.from(roles.entries())
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role)),
  };
}

export function Employees() {
  const [searchParams] = useSearchParams();
  const selectedTenant = useChatStore((state) => state.selectedTenant);
  const tenants = useChatStore((state) => state.tenants);
  const tenant = selectedTenant || tenants[0]?.id || 'acme';
  const capabilityFilter = searchParams.get('capability')?.trim() || '';
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [people, setPeople] = useState<EnterprisePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [employeeRes, peopleRes] = await Promise.all([
        api.listEmployees(tenant),
        api.listEnterprisePeople(tenant),
      ]);
      setEmployees(employeeRes.employees);
      setPeople(peopleRes.people);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载数字员工失败');
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => {
    void load();
  }, [load]);

  const bindingMap = useMemo(() => buildBindingMap(employees, people), [employees, people]);
  const summary = useMemo(() => buildSummary(employees, people, bindingMap), [employees, people, bindingMap]);
  const employeeById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const visibleEmployees = useMemo(
    () => capabilityFilter
      ? employees.filter((employee) => (employee.capabilities ?? []).includes(capabilityFilter))
      : employees,
    [capabilityFilter, employees],
  );

  return (
    <section>
      <div style={s.header}>
        <div style={s.headerCopy}>
          <span style={s.eyebrow}>当前企业 · {tenant}</span>
          <h2 style={s.heading}>数字员工</h2>
          <p style={s.sub}>
            只读查看企业里的数字员工网络：每个员工负责什么、PM / Prompt 如何约束、注入了哪些技能和工具，以及它和企业员工、技能市场的互通关系。
          </p>
        </div>
        <a href="/agent-builder" style={s.primaryLink}>
          <Bot size={18} />
          去 Builder 构造
        </a>
      </div>

      {error && <div style={s.errorBanner}>{error}</div>}

      {loading ? (
        <div style={s.loadingState}>加载数字员工...</div>
      ) : (
        <>
          <div style={s.metrics}>
            <Metric icon={<UsersRound size={18} />} label="数字员工" value={summary.totalEmployees} />
            <Metric icon={<UserRoundCheck size={18} />} label="绑定人数" value={summary.totalBoundPeople} />
            <Metric icon={<Wrench size={18} />} label="工具" value={summary.totalTools} />
            <Metric icon={<BrainCircuit size={18} />} label="技能" value={summary.totalSkills} />
          </div>

          <div style={s.workspace}>
            <main style={s.mainColumn}>
              <div style={s.sectionToolbar}>
                <h3 style={s.sectionTitle}>员工能力目录</h3>
                <span style={s.sectionMeta}>构造和修改已迁移到员工 Builder</span>
              </div>
              {capabilityFilter && (
                <div style={s.filterNotice}>
                  正在查看能力「{capabilityFilter}」相关员工
                  <a href="/employees" style={s.clearFilterLink}>清除筛选</a>
                </div>
              )}

              {visibleEmployees.length === 0 ? (
                <div style={s.emptyState}>
                  <strong style={s.emptyTitle}>{capabilityFilter ? '没有匹配的数字员工' : '还没有数字员工'}</strong>
                  <span>{capabilityFilter ? '可以清除筛选查看全部员工。' : '可以从员工 Builder 创建第一个员工，发布后会出现在这里。'}</span>
                </div>
              ) : (
                <div style={s.employeeGrid}>
                  {visibleEmployees.map((employee) => (
                    <EmployeeCard
                      key={employee.id}
                      employee={employee}
                      binding={bindingMap.get(employee.id) ?? { defaultPeople: [], visiblePeople: [] }}
                      employeeById={employeeById}
                    />
                  ))}
                </div>
              )}
            </main>

            <aside style={s.sidePanel}>
              <div style={s.sidePanelHeader}>
                <Network size={18} />
                <div>
                  <h3 style={s.sidePanelTitle}>网络摘要</h3>
                  <p style={s.sidePanelSub}>从员工 YAML 和人员绑定关系汇总。</p>
                </div>
              </div>

              <div style={s.sideBlock}>
                <span style={s.sideLabel}>角色分布</span>
                {summary.roleCounts.length === 0 ? (
                  <span style={s.mutedText}>暂无角色</span>
                ) : (
                  <div style={s.roleList}>
                    {summary.roleCounts.map((item) => (
                      <div key={item.role} style={s.roleRow}>
                        <span>{labelRole(item.role)}</span>
                        <strong>{item.count}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={s.sideBlock}>
                <span style={s.sideLabel}>人员路由</span>
                <InfoRow label="选择器模式" value={`${summary.selectorPeople} 人`} />
                <InfoRow label="未绑定在职员工" value={`${summary.unboundActivePeople} 人`} />
              </div>

              <div style={s.sideHint}>
                这个页面现在只展示已经发布的员工资产。新增、复制、修改、测试和发布都在员工 Builder 内完成。
              </div>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

function EmployeeCard(props: {
  employee: Employee;
  binding: BindingSummary;
  employeeById: Map<string, Employee>;
}) {
  const boundCount = props.binding.defaultPeople.length + (props.binding.yamlUserId ? 1 : 0);
  const visibleCount = props.binding.visiblePeople.length;

  return (
    <article id={`employee-${props.employee.id}`} style={s.employeeCard}>
      <div style={s.cardHeader}>
        <div style={s.identity}>
          <div style={s.avatar}>{props.employee.displayName.slice(0, 1)}</div>
          <div style={s.identityText}>
            <h4 style={s.cardTitle}>{props.employee.displayName}</h4>
            <span style={s.employeeId}>员工编号 · {props.employee.id}</span>
          </div>
        </div>
        <div style={s.badgeRow}>
          <span style={s.roleBadge}>{labelRole(props.employee.role)}</span>
        </div>
      </div>

      <p style={s.description}>{props.employee.description || '未填写员工说明。'}</p>

      <div style={s.cardMetrics}>
        <MiniMetric label="绑定" value={boundCount} />
        <MiniMetric label="可见" value={visibleCount} />
        <MiniMetric label="工具" value={props.employee.tools?.length ?? props.employee.toolCount} />
        <MiniMetric label="技能" value={props.employee.skills?.length ?? props.employee.skillCount} />
      </div>

      <PromptComposition
        employee={props.employee}
        binding={props.binding}
        employeeById={props.employeeById}
      />
    </article>
  );
}

function PromptComposition(props: {
  employee: Employee;
  binding: BindingSummary;
  employeeById: Map<string, Employee>;
}) {
  const targets = props.employee.allowedTargets ?? [];
  const bound = bindingNames(props.binding);
  const collaboration = targets.length > 0
    ? targets.map((id) => props.employeeById.get(id)?.displayName ?? id)
    : props.binding.visiblePeople.map((person) => `${person.name} · ${person.userId}`);
  const contextPreview = buildContextPreview(props.employee, props.binding, props.employeeById);

  return (
    <section style={s.promptComposer} aria-label={`${props.employee.displayName} 的 Prompt 组成视图`}>
      <div style={s.promptHeader}>
        <strong style={s.promptTitle}>Prompt 组成视图</strong>
        <span style={s.promptHint}>静态配置 + 动态上下文注入</span>
      </div>
      <div style={s.promptLegend}>
        <LegendDot label="PM" styleKey="identity" />
        <LegendDot label="技能" styleKey="skill" />
        <LegendDot label="工具" styleKey="tool" />
        <LegendDot label="事项" styleKey="capability" />
        <LegendDot label="动态" styleKey="routing" />
      </div>
      <div style={s.promptCanvas}>
        <PromptLine styleKey="identity" label="员工身份">
          {`岗位：${props.employee.displayName}。职责说明：${props.employee.description || '当前没有额外业务说明。'}`}
        </PromptLine>
        <PromptLine styleKey="identity" label="基础 PM">
          {shortPrompt(props.employee.systemPrompt)}
        </PromptLine>
        {(props.employee.capabilities ?? []).length > 0 && (
          <PromptLine styleKey="capability" label="可处理事项">
            <RelationNodes
              kind="capability"
              items={props.employee.capabilities ?? []}
              empty="未配置"
              hrefFor={(capability) => `/employees?capability=${encodeURIComponent(capability)}`}
            />
          </PromptLine>
        )}
        <PromptLine styleKey="skill" label="注入技能">
          <RelationNodes
            kind="skill"
            items={props.employee.skills ?? []}
            empty="未配置"
            hrefFor={(skill) => `/skills-marketplace?skill=${encodeURIComponent(skill)}`}
          />
        </PromptLine>
        <PromptLine styleKey="tool" label="可用工具">
          <RelationNodes
            kind="tool"
            items={props.employee.tools ?? []}
            empty="未配置"
            hrefFor={(tool) => {
              const app = toolAppName(tool);
              return app ? `/skills-marketplace?app=${encodeURIComponent(app)}` : undefined;
            }}
          />
        </PromptLine>
        <PromptLine styleKey="routing" label="动态上下文">
          <span style={s.inlineGroup}>
            <span>默认绑定：</span>
            <RelationNodes kind="person" items={bound} empty="暂无" hrefFor={() => '/people'} />
            <span>协作目标：</span>
            <RelationNodes
              kind="employee"
              items={collaboration}
              empty="暂无"
              hrefFor={(label) => {
                const targetId = targets.find((id) => (props.employeeById.get(id)?.displayName ?? id) === label);
                return targetId ? `#employee-${targetId}` : '/people';
              }}
            />
          </span>
        </PromptLine>
      </div>
      <div style={s.finalPromptBox}>
        <div style={s.finalPromptHeader}>
          <strong>运行上下文预览</strong>
          <span>解释基础 PM、工具/技能声明、平台标签和动态上下文的关系</span>
        </div>
        <div style={s.contextSectionList}>
          {contextPreview.map((section) => (
            <div key={section.title} style={s.contextSection}>
              <div style={s.contextSectionHeader}>
                <span style={{ ...s.contextTone, ...contextTone(section.tone) }}>{section.tone === 'static' ? '静态' : section.tone === 'platform' ? '平台' : '动态'}</span>
                <strong>{section.title}</strong>
              </div>
              <span style={s.contextNote}>{section.note}</span>
              <pre style={s.contextBody}>{section.body}</pre>
            </div>
          ))}
        </div>
      </div>
      <details style={s.rawPrompt}>
        <summary style={s.rawPromptSummary}>原始 PM / Prompt</summary>
        <pre style={s.rawPromptText}>{props.employee.systemPrompt || '未配置 PM / Prompt。'}</pre>
      </details>
    </section>
  );
}

function RelationNodes(props: {
  kind: 'skill' | 'tool' | 'capability' | 'person' | 'employee';
  items: string[];
  empty: string;
  hrefFor?: (item: string) => string | undefined;
}) {
  if (props.items.length === 0) {
    return <span style={s.emptyNode}>{props.empty}</span>;
  }
  return (
    <span style={s.nodeList}>
      {props.items.map((item) => (
        <RelationNode
          key={`${props.kind}-${item}`}
          kind={props.kind}
          label={item}
          href={props.hrefFor?.(item)}
        />
      ))}
    </span>
  );
}

function RelationNode({ kind, label, href }: { kind: string; label: string; href?: string }) {
  const node = (
    <>
      <span style={s.nodeDot} />
      <span style={s.nodeText}>{label}</span>
      {href && <span style={s.nodeJump}>{kind === 'capability' ? '筛选' : '跳转'}</span>}
    </>
  );

  if (href) {
    return (
      <a href={href} aria-label={label} style={{ ...s.relationNode, ...s.relationNodeLink, ...nodeTone(kind) }} title={`${label} · 可跳转`}>
        {node}
      </a>
    );
  }

  return (
    <span style={{ ...s.relationNode, ...nodeTone(kind) }} title={label}>
      {node}
    </span>
  );
}

function nodeTone(kind: string): CSSProperties {
  if (kind === 'skill') return {
    background: 'rgba(232, 165, 90, 0.18)',
    borderColor: 'rgba(232, 165, 90, 0.5)',
    color: '#7a4b13',
  };
  if (kind === 'tool') return {
    background: 'rgba(93, 184, 166, 0.18)',
    borderColor: 'rgba(93, 184, 166, 0.55)',
    color: '#1f6d61',
  };
  if (kind === 'capability') return {
    background: 'rgba(204, 120, 92, 0.16)',
    borderColor: 'rgba(204, 120, 92, 0.5)',
    color: '#7b3f2c',
  };
  if (kind === 'person') return {
    background: 'rgba(118, 150, 92, 0.16)',
    borderColor: 'rgba(118, 150, 92, 0.5)',
    color: '#445d2f',
  };
  return {
    background: 'var(--color-bg-raised)',
    borderColor: 'var(--color-border)',
    color: 'var(--color-text-secondary)',
  };
}

function PromptLine({ styleKey, label, children }: { styleKey: string; label: string; children: ReactNode }) {
  return (
    <p style={{ ...s.promptLine, ...promptTone(styleKey) }}>
      <span style={s.promptLineLabel}>{label}</span>
      <span style={s.promptLineText}>{children}</span>
    </p>
  );
}

function LegendDot({ label, styleKey }: { label: string; styleKey: string }) {
  return (
    <span style={s.legendItem}>
      <span style={{ ...s.legendDot, ...promptTone(styleKey) }} />
      {label}
    </span>
  );
}

function promptTone(styleKey: string): CSSProperties {
  if (styleKey === 'skill') return {
    background: 'rgba(232, 165, 90, 0.16)',
    borderColor: 'rgba(232, 165, 90, 0.45)',
  };
  if (styleKey === 'tool') return {
    background: 'rgba(93, 184, 166, 0.16)',
    borderColor: 'rgba(93, 184, 166, 0.5)',
  };
  if (styleKey === 'capability') return {
    background: 'rgba(204, 120, 92, 0.14)',
    borderColor: 'rgba(204, 120, 92, 0.45)',
  };
  if (styleKey === 'routing') return {
    background: 'rgba(118, 150, 92, 0.14)',
    borderColor: 'rgba(118, 150, 92, 0.45)',
  };
  return {
    background: 'var(--color-bg-raised)',
    borderColor: 'var(--color-border-soft)',
  };
}

function contextTone(tone: ContextPreviewSection['tone']): CSSProperties {
  if (tone === 'dynamic') return {
    background: 'rgba(118, 150, 92, 0.16)',
    color: '#445d2f',
    borderColor: 'rgba(118, 150, 92, 0.45)',
  };
  if (tone === 'platform') return {
    background: 'rgba(204, 120, 92, 0.14)',
    color: '#7b3f2c',
    borderColor: 'rgba(204, 120, 92, 0.45)',
  };
  return {
    background: 'rgba(93, 184, 166, 0.14)',
    color: '#1f6d61',
    borderColor: 'rgba(93, 184, 166, 0.45)',
  };
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div style={s.metricCard}>
      <span style={s.metricIcon}>{icon}</span>
      <strong style={s.metricValue}>{value}</strong>
      <span style={s.metricLabel}>{label}</span>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div style={s.miniMetric}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.infoRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 'var(--space-lg)',
    marginBottom: 'var(--space-lg)',
  },
  headerCopy: { display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 780 },
  eyebrow: {
    color: 'var(--color-accent)',
    fontSize: 'var(--text-xs)',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  heading: {
    fontSize: 'var(--text-hero)',
    fontWeight: 400,
    fontFamily: 'var(--font-display)',
    margin: 0,
    color: 'var(--color-text-primary)',
  },
  sub: {
    fontSize: 'var(--text-lg)',
    color: 'var(--color-text-muted)',
    margin: 0,
    lineHeight: 1.7,
  },
  primaryLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-accent)',
    background: 'var(--color-accent)',
    color: '#fff',
    textDecoration: 'none',
    fontSize: 'var(--text-sm)',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  errorBanner: {
    marginBottom: 'var(--space-md)',
    padding: '12px 20px',
    background: 'var(--color-danger-dim)',
    border: '1px solid var(--color-danger)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-danger)',
    fontSize: 'var(--text-base)',
  },
  loadingState: {
    padding: 'var(--space-2xl)',
    textAlign: 'center',
    color: 'var(--color-text-muted)',
  },
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    gap: 'var(--space-sm)',
    marginBottom: 'var(--space-lg)',
  },
  metricCard: {
    minHeight: 112,
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-base)',
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gridTemplateRows: 'auto auto',
    columnGap: 'var(--space-sm)',
    alignItems: 'center',
  },
  metricIcon: {
    gridRow: '1 / span 2',
    width: 38,
    height: 38,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-accent)',
    background: 'var(--color-accent-dim)',
  },
  metricValue: {
    color: 'var(--color-text-primary)',
    fontSize: 32,
    lineHeight: 1,
    fontFamily: 'var(--font-display)',
    fontWeight: 600,
  },
  metricLabel: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-sm)',
  },
  workspace: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
    gap: 'var(--space-lg)',
    alignItems: 'start',
  },
  mainColumn: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' },
  sectionToolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  sectionTitle: {
    margin: 0,
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-xl)',
    fontFamily: 'var(--font-display)',
    fontWeight: 400,
  },
  sectionMeta: { color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' },
  filterNotice: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
    padding: '10px 12px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-accent)',
    background: 'var(--color-accent-dim)',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--text-sm)',
  },
  clearFilterLink: {
    color: 'var(--color-accent-active)',
    fontWeight: 800,
    textDecoration: 'none',
  },
  employeeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
    gap: 'var(--space-sm)',
  },
  employeeCard: {
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-base)',
    padding: 'var(--space-md)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-sm)',
    minWidth: 0,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    alignItems: 'flex-start',
  },
  identity: { display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', minWidth: 0 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-accent-dim)',
    color: 'var(--color-accent-active)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    flexShrink: 0,
  },
  identityText: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  cardTitle: {
    margin: 0,
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-lg)',
    fontWeight: 700,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  employeeId: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-xs)',
    fontFamily: 'var(--font-mono)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  badgeRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    flexWrap: 'wrap',
  },
  roleBadge: {
    padding: '3px 8px',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-accent)',
    background: 'var(--color-accent-dim)',
    fontSize: 'var(--text-xs)',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  description: {
    margin: 0,
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
    fontSize: 'var(--text-sm)',
  },
  cardMetrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    border: '1px solid var(--color-border-soft)',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
  },
  miniMetric: {
    minHeight: 58,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-xs)',
    borderRight: '1px solid var(--color-border-soft)',
  },
  promptComposer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xs)',
    borderTop: '1px solid var(--color-border-soft)',
    paddingTop: 'var(--space-sm)',
  },
  promptHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  },
  promptTitle: {
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-sm)',
    fontWeight: 800,
  },
  promptHint: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-xs)',
  },
  promptLegend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px 12px',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-xs)',
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    whiteSpace: 'nowrap',
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    border: '1px solid',
  },
  promptCanvas: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    padding: 'var(--space-sm)',
    background: 'rgba(255, 255, 255, 0.42)',
    border: '1px solid var(--color-border-soft)',
    borderRadius: 'var(--radius-md)',
  },
  promptLine: {
    margin: 0,
    display: 'grid',
    gridTemplateColumns: '88px minmax(0, 1fr)',
    gap: 'var(--space-xs)',
    padding: '8px 10px',
    border: '1px solid',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-secondary)',
    lineHeight: 1.65,
  },
  promptLineLabel: {
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-xs)',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  promptLineText: {
    minWidth: 0,
    overflowWrap: 'anywhere',
    fontSize: 'var(--text-sm)',
  },
  inlineGroup: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '6px 8px',
  },
  nodeList: {
    display: 'inline-flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  relationNode: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
    maxWidth: '100%',
    padding: '3px 8px',
    borderRadius: 'var(--radius-pill)',
    border: '1px solid',
    textDecoration: 'none',
    fontSize: 'var(--text-xs)',
    fontWeight: 700,
    lineHeight: 1.4,
    verticalAlign: 'middle',
  },
  relationNodeLink: {
    boxShadow: 'inset 0 -1px 0 currentColor',
    cursor: 'pointer',
  },
  nodeDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    background: 'currentColor',
    flexShrink: 0,
  },
  nodeText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  nodeJump: {
    paddingLeft: 5,
    borderLeft: '1px solid currentColor',
    opacity: 0.72,
    fontSize: 10,
    fontWeight: 800,
  },
  emptyNode: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-sm)',
  },
  rawPrompt: {
    paddingTop: 2,
  },
  finalPromptBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 'var(--space-sm)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border-soft)',
    background: 'var(--color-bg-raised)',
  },
  finalPromptHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-sm)',
  },
  contextSectionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxHeight: 360,
    overflow: 'auto',
  },
  contextSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border-soft)',
    background: 'var(--color-bg-base)',
  },
  contextSectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-sm)',
  },
  contextTone: {
    padding: '2px 7px',
    borderRadius: 'var(--radius-pill)',
    border: '1px solid',
    fontSize: 10,
    fontWeight: 800,
    lineHeight: 1.4,
  },
  contextNote: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-xs)',
    lineHeight: 1.5,
  },
  contextBody: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-xs)',
    lineHeight: 1.65,
    color: 'var(--color-text-secondary)',
  },
  rawPromptSummary: {
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    fontSize: 'var(--text-xs)',
    fontWeight: 700,
  },
  rawPromptText: {
    margin: '8px 0 0',
    maxHeight: 240,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-xs)',
    lineHeight: 1.6,
    color: 'var(--color-text-secondary)',
    background: 'var(--color-bg-raised)',
    border: '1px solid var(--color-border-soft)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-sm)',
  },
  sidePanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-sm)',
    padding: 'var(--space-md)',
    background: 'var(--color-bg-base)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    position: 'sticky',
    top: 'var(--space-md)',
    minWidth: 0,
  },
  sidePanelHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 'var(--space-sm)',
    color: 'var(--color-accent-active)',
  },
  sidePanelTitle: {
    margin: 0,
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-base)',
    fontWeight: 700,
  },
  sidePanelSub: {
    margin: '4px 0 0',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-xs)',
    lineHeight: 1.5,
  },
  sideBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xs)',
    paddingTop: 'var(--space-sm)',
    borderTop: '1px solid var(--color-border-soft)',
  },
  sideLabel: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-xs)',
    fontWeight: 700,
  },
  roleList: { display: 'flex', flexDirection: 'column', gap: 8 },
  roleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--text-sm)',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--text-sm)',
  },
  sideHint: {
    padding: 'var(--space-sm)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-bg-raised)',
    border: '1px solid var(--color-border-soft)',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.6,
  },
  mutedText: { color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' },
  emptyState: {
    padding: 'var(--space-xl)',
    textAlign: 'center',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-base)',
    background: 'var(--color-bg-base)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  emptyTitle: {
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-lg)',
  },
};
