import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CheckCircle2, Hammer, MessageCircle, Play, Plus, RefreshCw, Rocket, Save, Send, WandSparkles, XCircle } from 'lucide-react';
import {
  api,
  type AgentBuilderDraft,
  type AgentBuilderIssue,
  type AgentBuilderOptions,
  type Employee,
  type EmployeeCapabilityReport,
  type TemplateMeta,
  type TenantMeta,
} from '../lib/api';
import { useChatStore } from '../stores/chat';

type SourceMode = AgentBuilderDraft['source'];

const DEFAULT_BUILDER_PROMPT = '创建一个售后质检员工，检查维修工单质量，赔付问题转财务';

function pickBuilderTenant(args: {
  currentTenant: string;
  tenants: TenantMeta[];
  drafts: AgentBuilderDraft[];
  runtimeTenants: string[];
}): string {
  const tenantIds = new Set(args.tenants.map((item) => item.id));
  if (args.currentTenant && tenantIds.has(args.currentTenant)) return args.currentTenant;
  const runtimeTenant = args.runtimeTenants.find((id) => tenantIds.has(id));
  if (runtimeTenant) return runtimeTenant;
  const draftTenant = args.drafts.map((draft) => draft.tenant).find((id) => tenantIds.has(id));
  if (draftTenant) return draftTenant;
  return args.tenants[0]?.id || '';
}

function issueColor(issue: AgentBuilderIssue): string {
  return issue.severity === 'error' ? '#991b1b' : '#92400e';
}

function riskLabel(riskLevel: AgentBuilderOptions['tools'][number]['riskLevel']): string {
  if (riskLevel === 'read') return '只读';
  if (riskLevel === 'internal_write') return '内部写入';
  if (riskLevel === 'destructive') return '高风险';
  return '外部调用';
}

function statusTone(status: AgentBuilderDraft['status']): CSSProperties {
  if (status === 'published') return { background: '#dcfce7', color: '#166534', borderColor: '#86efac' };
  if (status === 'tested') return { background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' };
  if (status === 'validated') return { background: '#f0fdf4', color: '#15803d', borderColor: '#bbf7d0' };
  return { background: 'var(--color-bg-raised)', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' };
}

function employeePatch(employee: Employee, patch: Partial<Employee>): Employee {
  return { ...employee, ...patch };
}

function toggleList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function AgentBuilder() {
  const loadedOnce = useRef(false);
  const platformTenant = useChatStore((state) => state.selectedTenant);
  const setPlatformTenants = useChatStore((state) => state.setTenants);
  const [drafts, setDrafts] = useState<AgentBuilderDraft[]>([]);
  const [tenants, setTenants] = useState<TenantMeta[]>([]);
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [options, setOptions] = useState<AgentBuilderOptions | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fallbackTenant, setFallbackTenant] = useState('');
  const [source, setSource] = useState<SourceMode>('natural_language');
  const [prompt, setPrompt] = useState(DEFAULT_BUILDER_PROMPT);
  const [templateId, setTemplateId] = useState('');
  const [role, setRole] = useState('maintenance-qa');
  const [sourceEmployeeId, setSourceEmployeeId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [publishResult, setPublishResult] = useState<{ employeeId: string; tenant: string; yamlPath: string; workspacePath: string } | null>(null);
  const [scheduleText, setScheduleText] = useState('{\n  "triggers": []\n}');
  const [capability, setCapability] = useState<EmployeeCapabilityReport | null>(null);
  const [sandboxText, setSandboxText] = useState('帮我检查这张维修工单是否可以关闭');
  const [sandboxResult, setSandboxResult] = useState<{ reply: string; sessionId: string; workdir: string } | null>(null);
  const activeTenant = platformTenant || fallbackTenant;
  const activeTenantMeta = tenants.find((item) => item.id === activeTenant);
  const visibleDrafts = useMemo(
    () => (activeTenant ? drafts.filter((draft) => draft.tenant === activeTenant) : drafts),
    [activeTenant, drafts],
  );

  const selected = useMemo(
    () => (selectedId ? visibleDrafts.find((draft) => draft.id === selectedId) ?? null : null),
    [selectedId, visibleDrafts],
  );

  async function load() {
    setBusy('load');
    setError(null);
    try {
      const [draftRes, tenantRes, templateRes] = await Promise.all([
        api.listAgentBuilderDrafts(),
        api.listTenants(),
        api.listTemplates().catch(() => ({ templates: [] as TemplateMeta[] })),
      ]);
      const entryRes = await api.listRuntimeEntries().catch(() => ({ entries: [] }));
      const runtimeEntries = Array.isArray(entryRes.entries) ? entryRes.entries : [];
      setDrafts(draftRes.drafts);
      setTenants(tenantRes.tenants);
      if (tenantRes.tenants.length > 0) setPlatformTenants(tenantRes.tenants);
      setTemplates(templateRes.templates);
      const nextTenant = pickBuilderTenant({
        currentTenant: activeTenant,
        tenants: tenantRes.tenants,
        drafts: draftRes.drafts,
        runtimeTenants: runtimeEntries.map((entry) => entry.tenant),
      });
      setFallbackTenant(nextTenant);
      setTemplateId((current) => current || templateRes.templates[0]?.id || '');
      const nextDraft = draftRes.drafts.find((draft) => draft.tenant === nextTenant) ?? draftRes.drafts[0];
      if (!loadedOnce.current && !selectedId && nextDraft) setSelectedId(nextDraft.id);
      loadedOnce.current = true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载 Builder 失败');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!activeTenant) return;
    Promise.all([
      api.listEmployees(activeTenant),
      api.getAgentBuilderOptions(activeTenant).catch(() => null),
    ])
      .then(([employeeRes, optionRes]) => {
        setEmployees(employeeRes.employees);
        setOptions(optionRes);
        setSourceEmployeeId((current) => (
          employeeRes.employees.some((employee) => employee.id === current)
            ? current
            : employeeRes.employees[0]?.id || ''
        ));
      })
      .catch(() => {
        setEmployees([]);
        setOptions(null);
      });
  }, [activeTenant]);

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selected, selectedId]);

  useEffect(() => {
    setScheduleText(JSON.stringify(selected?.employee.schedule ?? { triggers: [] }, null, 2));
  }, [selected?.id, selected?.employee.schedule]);

  useEffect(() => {
    if (!selected) {
      setCapability(null);
      return;
    }
    let cancelled = false;
    api.getAgentBuilderDraftCapabilities(selected.id)
      .then((res) => {
        if (!cancelled) setCapability(res.capability);
      })
      .catch(() => {
        if (!cancelled) setCapability(null);
      });
    return () => { cancelled = true; };
  }, [selected?.id, selected?.updatedAt]);

  function replaceDraft(next: AgentBuilderDraft) {
    setDrafts((current) => {
      const exists = current.some((draft) => draft.id === next.id);
      if (!exists) return [next, ...current];
      return current.map((draft) => (draft.id === next.id ? next : draft));
    });
    setSelectedId(next.id);
  }

  function startNewBuild() {
    setSelectedId(null);
    setSource('natural_language');
    setPrompt('');
    setRole('maintenance-qa');
    setSandboxText('帮我检查这张维修工单是否可以关闭');
    setSandboxResult(null);
    setPublishResult(null);
    setConfirmingPublish(false);
    setError(null);
    setMessage('已新建一轮构建，请输入需求');
  }

  async function discardDraftChanges() {
    if (!selected) return;
    setSandboxResult(null);
    setPublishResult(null);
    await load();
    setMessage('已重新载入当前草稿');
  }

  async function returnToConfig() {
    if (!selected || selected.status === 'published') return;
    setBusy('save');
    setError(null);
    setMessage(null);
    try {
      const next: AgentBuilderDraft = {
        ...selected,
        status: 'draft',
        validation: { ok: false, issues: [] },
        harness: undefined,
        sandbox: undefined,
      };
      const { draft } = await api.updateAgentBuilderDraft(selected.id, next);
      replaceDraft(draft);
      setSandboxResult(null);
      setPublishResult(null);
      setMessage('已返回配置阶段');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '返回配置失败');
    } finally {
      setBusy(null);
    }
  }

  async function createDraft() {
    if (!activeTenant) return;
    setBusy('create');
    setError(null);
    setMessage(null);
    try {
      const body = source === 'natural_language'
        ? { tenant: activeTenant, source, prompt }
        : source === 'template'
          ? { tenant: activeTenant, source, templateId, role }
          : source === 'fork'
            ? { tenant: activeTenant, source, sourceEmployeeId }
            : { tenant: activeTenant, source };
      const { draft } = await api.createAgentBuilderDraft(body);
      replaceDraft(draft);
      setMessage('草稿已创建');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '创建草稿失败');
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!selected) return;
    setBusy('save');
    setError(null);
    setMessage(null);
    try {
      const { draft } = await api.updateAgentBuilderDraft(selected.id, selected);
      replaceDraft(draft);
      setMessage('结构化配置已保存');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存草稿失败');
    } finally {
      setBusy(null);
    }
  }

  async function runAction(action: 'validate' | 'test' | 'publish') {
    if (!selected) return;
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      const result = action === 'validate'
        ? await api.validateAgentBuilderDraft(selected.id)
        : action === 'test'
          ? await api.testAgentBuilderDraft(selected.id)
          : await api.publishAgentBuilderDraft(selected.id);
      replaceDraft(result.draft);
      if (action === 'publish' && 'yamlPath' in result) {
        setPublishResult({
          employeeId: result.draft.employee.id,
          tenant: result.draft.tenant,
          yamlPath: result.yamlPath,
          workspacePath: result.workspacePath,
        });
      }
      setMessage(action === 'validate' ? '校验完成' : action === 'test' ? '模拟 Harness 已通过' : '数字员工已发布');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `${action} 失败`);
    } finally {
      setBusy(null);
    }
  }

  async function runSandbox() {
    if (!selected || !sandboxText.trim()) return;
    setBusy('sandbox');
    setError(null);
    setMessage(null);
    try {
      const result = await api.sendAgentBuilderSandboxMessage(selected.id, {
        actorId: 'builder-web',
        chatId: `builder-${selected.id}`,
        text: sandboxText.trim(),
      });
      replaceDraft(result.draft);
      setSandboxResult({
        reply: result.reply,
        sessionId: result.session.id,
        workdir: result.session.workdir,
      });
      setMessage('沙盒试聊已写入 Runtime Session');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '沙盒试聊失败');
    } finally {
      setBusy(null);
    }
  }

  function updateEmployee(patch: Partial<Employee>) {
    if (!selected) return;
    replaceDraft({
      ...selected,
      status: selected.status === 'published' ? selected.status : 'draft',
      validation: { ok: false, issues: [] },
      harness: undefined,
      sandbox: undefined,
      employee: employeePatch(selected.employee, patch),
    });
    setPublishResult(null);
    setSandboxResult(null);
  }

  const issues = selected?.validation.issues ?? [];
  const hasErrors = issues.some((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const selectedTargets = selected?.employee.allowedTargets ?? [];
  const availableSkillNames = useMemo(() => new Set(options?.skills.map((skill) => skill.name) ?? []), [options]);
  const availableToolNames = useMemo(() => new Set(options?.tools.map((tool) => tool.name) ?? []), [options]);
  const unknownSkills = selected?.employee.skills.filter((skill) => !availableSkillNames.has(skill)) ?? [];
  const unknownTools = selected?.employee.tools.filter((tool) => !availableToolNames.has(tool)) ?? [];
  const sandboxPassed = selected?.sandbox?.lastResult === 'passed';
  const canPublish = Boolean(selected && selected.status === 'tested' && selected.harness?.lastResult === 'passed' && sandboxPassed && !hasErrors);
  const isPublished = selected?.status === 'published';
  const createDisabledReason = !activeTenant ? '当前平台企业未加载，无法创建草稿' : null;
  const testDisabledReason = !selected
    ? '选择草稿后才能测试'
    : isPublished
      ? '已发布草稿不能重复测试'
      : hasErrors
        ? '修复校验错误后才能测试'
        : null;
  const publishDisabledReason = !selected
    ? '选择草稿后才能发布'
    : isPublished
      ? '已发布'
      : hasErrors
        ? '修复校验错误后才能发布'
        : selected.status !== 'tested'
          ? '先完成校验和测试'
          : selected.harness?.lastResult !== 'passed'
            ? 'Harness 未通过'
            : !sandboxPassed
              ? '先完成 Runtime 沙盒试聊'
              : null;
  const progressSteps = [
    { label: '需求', done: Boolean(prompt.trim() || selected), active: !selected },
    { label: '草稿', done: Boolean(selected), active: Boolean(selected && selected.status === 'draft' && !selected.validation.ok) },
    { label: '配置', done: Boolean(selected && (selected.updatedAt || selected.employee.id)), active: Boolean(selected && selected.status === 'draft') },
    { label: '校验', done: Boolean(selected?.validation.ok), active: Boolean(selected && !selected.validation.ok) },
    { label: '测试', done: Boolean(selected?.harness?.lastResult === 'passed'), active: Boolean(selected?.validation.ok && selected?.harness?.lastResult !== 'passed') },
    { label: '沙盒', done: sandboxPassed, active: Boolean(selected?.harness?.lastResult === 'passed' && !sandboxPassed) },
    { label: '发布', done: isPublished, active: canPublish },
  ];
  const completedSteps = progressSteps.filter((step) => step.done).length;
  const progressPercent = Math.round((completedSteps / progressSteps.length) * 100);

  return (
    <section className="page-enter" style={s.page}>
      <div style={s.header}>
        <div>
          <h2 style={s.heading}>数字员工 Builder</h2>
          <p style={s.sub}>自然语言用于生成结构化草稿；发布前需要确认 Prompt、Skills、Tools 和可转交员工</p>
        </div>
        <div style={s.headerActions}>
          <button type="button" style={withDisabled(s.secondaryButton, busy !== null)} onClick={startNewBuild} disabled={busy !== null}>
            <Plus size={16} />
            新建构建
          </button>
          <button type="button" style={withDisabled(s.iconButton, busy !== null)} onClick={() => void load()} disabled={busy !== null} title="刷新">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {error && <div style={s.errorBanner}>{error}</div>}
      {message && <div style={s.successBanner}>{message}</div>}
      {publishResult && (
        <div style={s.successPanel}>
          <div>
            <strong>发布成功：{publishResult.employeeId}</strong>
            <p style={s.successMeta}>{publishResult.yamlPath}</p>
            <p style={s.successMeta}>{publishResult.workspacePath}</p>
          </div>
          <div style={s.successActions}>
            <a style={s.linkButton} href="/employees">查看员工</a>
            <a style={s.linkButton} href="/people">绑定人员</a>
            <a style={s.linkButton} href={`/chat/${publishResult.employeeId}`}>发起试聊</a>
          </div>
        </div>
      )}

      <div style={s.builderLayout}>
        <aside style={s.sessionPanel}>
          <div style={s.sessionHeader}>
            <div>
              <h3 style={s.panelTitle}>构建会话</h3>
              <p style={s.panelMeta}>{visibleDrafts.length} drafts</p>
            </div>
            <button type="button" style={withDisabled(s.iconButton, busy !== null)} onClick={startNewBuild} disabled={busy !== null} title="新建空白会话">
              <Plus size={16} />
            </button>
          </div>
          <div style={s.sessionList}>
            <button
              type="button"
              aria-label="新建空白构建会话"
              style={{ ...s.sessionButton, ...(!selected ? s.sessionButtonActive : {}) }}
              onClick={startNewBuild}
            >
              <span style={s.sessionPrimary}>
                <Plus size={15} />
                新建构建
              </span>
              <span style={s.sessionMeta}>从需求描述开始</span>
            </button>
            {visibleDrafts.length === 0 ? (
              <div style={s.sessionEmpty}>暂无历史构建</div>
            ) : visibleDrafts.map((draft) => (
              <button
                key={draft.id}
                type="button"
                style={{ ...s.sessionButton, ...(selected?.id === draft.id ? s.sessionButtonActive : {}) }}
                onClick={() => setSelectedId(draft.id)}
              >
                <span style={s.sessionPrimary}>
                  <span style={s.sessionName}>{draft.employee.displayName}</span>
                  <span style={{ ...s.statusBadge, ...statusTone(draft.status) }}>{draft.status}</span>
                </span>
                <span style={s.sessionMeta}>{draft.source}</span>
              </button>
            ))}
          </div>
        </aside>

        <section style={s.conversationPanel}>
          <div style={s.conversationHeader}>
            <div>
              <h3 style={s.panelTitle}>对话式组装员工</h3>
              <p style={s.panelMeta}>RuntimeProfileDraft guided flow</p>
            </div>
            <span style={{ ...s.statusBadge, ...statusTone(selected?.status ?? 'draft') }}>{selected?.status ?? 'new'}</span>
          </div>
          <div style={s.progressBox}>
            <div style={s.progressTop}>
              <span>{completedSteps} / {progressSteps.length}</span>
              <strong>{progressPercent}%</strong>
            </div>
            <div style={s.progressTrack}>
              <div style={{ ...s.progressFill, width: `${progressPercent}%` }} />
            </div>
            <div style={s.progressSteps}>
              {progressSteps.map((step) => (
                <span key={step.label} style={step.done ? s.progressStepDone : step.active ? s.progressStepActive : s.progressStep}>
                  {step.label}
                </span>
              ))}
            </div>
          </div>

          <div style={s.transcript}>
            <section style={s.chatBubble}>
              <div style={s.bubbleHeader}>
                <MessageCircle size={16} />
                <strong>引导员</strong>
              </div>
              <p style={s.bubbleText}>描述你要创建的数字员工。来源、模板或复制对象都在这条对话里确认；企业上下文跟随平台当前配置。</p>
              {!selected && visibleDrafts.length > 0 && (
                <div style={s.inlineInfo}>当前是新建构建流。左侧构建会话里仍然保留了历史草稿，可以随时切回继续。</div>
              )}
          <div style={s.form}>
            <div style={s.contextLine}>
              <span>当前企业</span>
              <strong>{activeTenantMeta?.displayName || activeTenant || '未加载'}</strong>
            </div>
            {!activeTenant && <div style={s.inlineWarn}>当前平台企业未加载。请确认后端在线，并且平台配置可读。</div>}
            <div style={s.segment}>
              {(['natural_language', 'template', 'fork', 'manual'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  style={{ ...s.segmentButton, ...(source === item ? s.segmentButtonActive : {}) }}
                  onClick={() => setSource(item)}
                >
                  {item === 'natural_language' ? '自然语言' : item === 'template' ? '模板' : item === 'fork' ? '复制' : '空白'}
                </button>
              ))}
            </div>

            {source === 'natural_language' && (
              <label style={s.label}>
                需求
                <textarea style={s.textarea} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
              </label>
            )}
            {source === 'template' && (
              <>
                <label style={s.label}>
                  模板
                  <select style={s.input} value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                    {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label style={s.label}>
                  角色
                  <input style={s.input} value={role} onChange={(event) => setRole(event.target.value)} />
                </label>
              </>
            )}
            {source === 'fork' && (
              <label style={s.label}>
                来源员工
                <select style={s.input} value={sourceEmployeeId} onChange={(event) => setSourceEmployeeId(event.target.value)}>
                  {employees.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
                </select>
              </label>
            )}

            <button
              type="button"
              style={withDisabled(s.primaryButton, busy !== null || !activeTenant)}
              onClick={() => void createDraft()}
              disabled={busy !== null || !activeTenant}
              title={createDisabledReason ?? '生成结构化草稿'}
            >
              <WandSparkles size={16} />
              {busy === 'create' ? '生成中...' : '生成草稿'}
            </button>
            {createDisabledReason && <div style={s.actionHint}>{createDisabledReason}</div>}
          </div>

          </section>

          <section style={s.chatBubble}>
            <div style={s.bubbleHeader}>
              <WandSparkles size={16} />
              <strong>草稿配置</strong>
            </div>
          {!selected ? (
            <div style={s.empty}>暂无草稿</div>
          ) : (
            <div style={s.form}>
              <label style={s.label}>
                名称
                <input style={s.input} value={selected.employee.displayName} onChange={(event) => updateEmployee({ displayName: event.target.value })} />
              </label>
              <div style={s.systemSummary}>
                <SystemItem label="ID" value={selected.employee.id} />
                <SystemItem label="角色" value={selected.employee.role || 'member'} />
                <SystemItem label="模型" value={selected.employee.model || '平台默认'} />
                <SystemItem label="工作目录" value={selected.employee.workspace || '-'} />
                <SystemItem label="绑定用户" value={selected.employee.humanUserId || '发布后在企业员工页绑定'} />
              </div>
              <label style={s.label}>
                描述
                <input style={s.input} value={selected.employee.description} onChange={(event) => updateEmployee({ description: event.target.value })} />
              </label>
              <label style={s.label}>
                Prompt
                <textarea style={s.promptArea} value={selected.employee.systemPrompt} onChange={(event) => updateEmployee({ systemPrompt: event.target.value })} />
              </label>
              {options && (
                <>
                  <div style={s.selectorBox}>
                    <div style={s.selectorHeader}>
                      <div>
                        <div style={s.selectorTitle}>Skills</div>
                        <div style={s.selectorHint}>选择员工可调用的业务能力包</div>
                      </div>
                      <span style={s.selectorCount}>{selected.employee.skills.length} 已选</span>
                    </div>
                    <div style={s.optionGrid}>
                    {options.skills.map((skill) => (
                      <label key={skill.name} style={selected.employee.skills.includes(skill.name) ? s.optionCardActive : s.optionCard}>
                        <input
                          style={s.optionCheckbox}
                          type="checkbox"
                          checked={selected.employee.skills.includes(skill.name)}
                          onChange={() => updateEmployee({ skills: toggleList(selected.employee.skills, skill.name) })}
                        />
                        <span style={s.optionContent}>
                          <span style={s.optionTitle}>{skill.displayName || skill.name}</span>
                          <span style={s.optionMeta}>{skill.name} · {skill.toolCount} tools</span>
                          <span style={s.optionDescription}>{skill.description || '暂无说明'}</span>
                        </span>
                      </label>
                    ))}
                    </div>
                    {unknownSkills.length > 0 && (
                      <div style={s.unknownBox}>
                        <div style={s.selectorTitle}>未知 Skills</div>
                        {unknownSkills.map((skill) => (
                          <button
                            key={skill}
                            type="button"
                            style={s.unknownPill}
                            onClick={() => updateEmployee({ skills: selected.employee.skills.filter((item) => item !== skill) })}
                          >
                            移除 {skill}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={s.selectorBox}>
                    <div style={s.selectorHeader}>
                      <div>
                        <div style={s.selectorTitle}>Tools</div>
                        <div style={s.selectorHint}>选择具体可执行工具；写入类工具发布前会提示风险</div>
                      </div>
                      <span style={s.selectorCount}>{selected.employee.tools.length} 已选</span>
                    </div>
                    <div style={s.optionGrid}>
                    {options.tools.map((tool) => (
                      <label key={tool.name} style={selected.employee.tools.includes(tool.name) ? s.optionCardActive : s.optionCard}>
                        <input
                          style={s.optionCheckbox}
                          type="checkbox"
                          checked={selected.employee.tools.includes(tool.name)}
                          onChange={() => updateEmployee({ tools: toggleList(selected.employee.tools, tool.name) })}
                        />
                        <span style={s.optionContent}>
                          <span style={s.optionTitle}>{tool.name}</span>
                          <span style={s.optionMeta}>{tool.appName}</span>
                          <span style={s.optionDescription}>{tool.description || '暂无说明'}</span>
                        </span>
                        <span style={tool.riskLevel === 'read' ? s.riskRead : s.riskWarn}>{riskLabel(tool.riskLevel)}</span>
                      </label>
                    ))}
                    </div>
                    {unknownTools.length > 0 && (
                      <div style={s.unknownBox}>
                        <div style={s.selectorTitle}>未知 Tools</div>
                        {unknownTools.map((tool) => (
                          <button
                            key={tool}
                            type="button"
                            style={s.unknownPill}
                            onClick={() => updateEmployee({ tools: selected.employee.tools.filter((item) => item !== tool) })}
                          >
                            移除 {tool}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              {!options && (
                <div style={s.inlineWarn}>未加载到 Skills/Tools 选项，请刷新或检查平台企业配置。</div>
              )}
              {options && (
                <div style={s.selectorBox}>
                  <div style={s.selectorHeader}>
                    <div>
                      <div style={s.selectorTitle}>可转交员工</div>
                      <div style={s.selectorHint}>控制运行时 handoff 候选</div>
                    </div>
                    <span style={s.selectorCount}>{selectedTargets.length} 已选</span>
                  </div>
                  <div style={s.choiceGrid}>
                    {options.employees
                      .filter((employee) => employee.id !== selected.employee.id)
                      .map((employee) => (
                        <label key={employee.id} style={s.checkboxRow}>
                          <input
                            type="checkbox"
                            checked={selectedTargets.includes(employee.id)}
                            onChange={() => updateEmployee({ allowedTargets: toggleList(selectedTargets, employee.id) })}
                          />
                          <span>{employee.displayName}</span>
                          <span style={s.mutedText}>{employee.role}</span>
                        </label>
                      ))}
                  </div>
                </div>
              )}
              <button type="button" style={withDisabled(s.secondaryButton, busy !== null || selected.status === 'published')} onClick={() => void saveDraft()} disabled={busy !== null || selected.status === 'published'}>
                <Save size={16} />
                保存配置
              </button>
              <button type="button" style={withDisabled(s.secondaryButton, busy !== null || selected.status === 'published')} onClick={() => void discardDraftChanges()} disabled={busy !== null || selected.status === 'published'}>
                <RefreshCw size={16} />
                放弃改动
              </button>
              <button type="button" style={withDisabled(s.secondaryButton, busy !== null || selected.status === 'published')} onClick={() => void returnToConfig()} disabled={busy !== null || selected.status === 'published'}>
                <Hammer size={16} />
                返回配置
              </button>
              <label style={s.label}>
                计划任务 JSON
                <textarea
                  style={s.listArea}
                  value={scheduleText}
                  onChange={(event) => setScheduleText(event.target.value)}
                  onBlur={() => {
                    try {
                      const parsed = JSON.parse(scheduleText) as unknown;
                      updateEmployee({ schedule: parsed });
                    } catch {
                      setError('计划任务 JSON 格式错误');
                    }
                  }}
                />
              </label>
            </div>
          )}
          </section>

          <section style={s.chatBubble}>
            <div style={s.bubbleHeader}>
              <CheckCircle2 size={16} />
              <strong>验收与发布</strong>
            {selected?.validation.ok ? <CheckCircle2 size={17} color="#15803d" /> : <XCircle size={17} color={hasErrors ? '#b91c1c' : '#64748b'} />}
          </div>
          {!selected ? (
            <div style={s.empty}>选择草稿后开始</div>
          ) : (
            <div style={s.review}>
              <div style={s.actionRow}>
                <button
                  type="button"
                  style={withDisabled(s.secondaryButton, busy !== null || isPublished)}
                  onClick={() => void runAction('validate')}
                  disabled={busy !== null || isPublished}
                  title={isPublished ? '已发布草稿不能重复校验' : '校验 YAML、权限和工具装配'}
                >
                  <CheckCircle2 size={16} />
                  {busy === 'validate' ? '校验中...' : '校验'}
                </button>
                <button
                  type="button"
                  style={withDisabled(s.secondaryButton, busy !== null || hasErrors || isPublished)}
                  onClick={() => void runAction('test')}
                  disabled={busy !== null || hasErrors || isPublished}
                  title={testDisabledReason ?? '运行发布前模拟 Harness'}
                >
                  <Play size={16} />
                  {busy === 'test' ? '测试中...' : '测试'}
                </button>
                <button
                  type="button"
                  style={withDisabled(s.primaryButton, busy !== null || !canPublish)}
                  onClick={() => setConfirmingPublish(true)}
                  disabled={busy !== null || !canPublish}
                  title={publishDisabledReason ?? '发布为正式数字员工'}
                >
                  <Rocket size={16} />
                  发布
                </button>
              </div>
              <div style={publishDisabledReason ? s.actionHint : s.readyHint}>
                {publishDisabledReason ?? '已满足发布条件，可以发布为正式数字员工'}
              </div>

              {capability && (
                <div style={s.capabilityBox}>
                  <div style={s.capabilityHeader}>
                    <strong>能力装配摘要</strong>
                    <span style={capability.summary.warningCount > 0 ? s.warnPill : s.okPill}>
                      {capability.summary.warningCount > 0 ? `${capability.summary.warningCount} 风险` : '可验收'}
                    </span>
                  </div>
                  <div style={s.capabilityGrid}>
                    <span>{capability.summary.skillCount} Skills</span>
                    <span>{capability.summary.toolCount} Tools</span>
                    <span>{capability.summary.handoffTargetCount} Targets</span>
                    <span>{capability.workspace.hasClaudeMd ? 'CLAUDE.md OK' : '发布时生成 CLAUDE.md'}</span>
                  </div>
                  <div style={s.capabilityTags}>
                    {capability.skills.map((skill) => (
                      <span key={skill.name} style={skill.installed ? s.capabilityTag : s.capabilityWarnTag}>{skill.displayName}</span>
                    ))}
                    {capability.tools.map((tool) => (
                      <span key={tool.name} style={tool.allowed ? s.capabilityTag : s.capabilityWarnTag}>{tool.name}</span>
                    ))}
                    {capability.handoffTargets.map((target) => (
                      <span key={target.employeeId} style={target.exists ? s.capabilityTag : s.capabilityWarnTag}>{target.displayName ?? target.employeeId}</span>
                    ))}
                  </div>
                  <p style={s.capabilityMeta}>
                    业务能力通过 run_skill 暴露；平台 MCP 保留 handoff、memory 和调度等协调能力。
                  </p>
                </div>
              )}

              <div style={s.issueList}>
                {issues.length === 0 ? (
                  <div style={s.emptyInline}>暂无校验结果</div>
                ) : issues.map((issue) => (
                  <div key={`${issue.field}-${issue.message}`} style={{ ...s.issue, color: issueColor(issue) }}>
                    <strong>{issue.severity}</strong>
                    <span>{issue.field}</span>
                    <p>{issue.message}</p>
                  </div>
                ))}
              </div>

              {selected.harness && (
                <div style={s.harnessBox}>
                  <div style={s.harnessHeader}>
                    <Hammer size={15} />
                    <strong>模拟 Harness {selected.harness.lastResult}</strong>
                  </div>
                  {(selected.harness.failures?.length ?? 0) > 0 && (
                    <p style={s.failureText}>{selected.harness.failures?.join(', ')}</p>
                  )}
                  <pre style={s.pre}>{selected.harness.yaml}</pre>
                </div>
              )}
            </div>
          )}
        </section>
          </div>
        </section>

        <aside style={s.previewPanel}>
          <div style={s.previewHeader}>
            <div>
              <h3 style={s.panelTitle}>Preview</h3>
              <p style={s.panelMeta}>builder_sandbox Runtime</p>
            </div>
            {sandboxPassed ? <span style={s.okPill}>沙盒通过</span> : <span style={s.warnPill}>待试聊</span>}
          </div>
          <div style={s.previewChat}>
            <div style={s.previewBotMessage}>
              <strong>{selected?.employee.displayName ?? '草稿员工'}</strong>
              <span>{selected ? '我会按当前草稿配置响应。' : '先在左侧生成草稿，再开始 Preview。'}</span>
            </div>
            {(sandboxResult || selected?.sandbox) && (
              <>
                <div style={s.previewUserMessage}>{sandboxText}</div>
                <div style={s.previewBotMessage}>
                  <strong>Runtime 回复</strong>
                  <span>{sandboxResult?.reply ?? selected?.sandbox?.reply ?? selected?.sandbox?.lastResult}</span>
                  <small style={s.sandboxSession}>{sandboxResult?.sessionId ?? selected?.sandbox?.lastSessionId}</small>
                  {sandboxResult?.workdir && <small style={s.sandboxSession}>{sandboxResult.workdir}</small>}
                </div>
              </>
            )}
          </div>
          <div style={s.previewComposer}>
            <textarea
              style={s.sandboxArea}
              value={sandboxText}
              aria-label="Preview 输入"
              onChange={(event) => setSandboxText(event.target.value)}
              disabled={busy !== null || isPublished || !selected}
            />
            <button
              type="button"
              style={withDisabled(s.primaryButton, busy !== null || isPublished || !selected || !sandboxText.trim())}
              onClick={() => void runSandbox()}
              disabled={busy !== null || isPublished || !selected || !sandboxText.trim()}
              title={isPublished ? '已发布草稿请到 Chat 中试聊' : '通过 Runtime Builder 沙盒发送一条消息'}
            >
              <Send size={16} />
              {busy === 'sandbox' ? '发送中...' : '沙盒试聊'}
            </button>
          </div>
        </aside>
      </div>

      {confirmingPublish && selected && (
        <div style={s.modalBackdrop} role="presentation" onClick={() => setConfirmingPublish(false)}>
          <div style={s.modal} role="dialog" aria-modal="true" aria-label="发布确认" onClick={(event) => event.stopPropagation()}>
            <h3 style={s.modalTitle}>确认发布</h3>
            <div style={s.modalBody}>
              <p><strong>{selected.employee.displayName}</strong> ({selected.employee.id})</p>
              <p>YAML：employees/{selected.employee.id}.yaml</p>
              <p>Workspace：{selected.employee.workspace}</p>
              <p>Skills：{selected.employee.skills.join(', ') || '-'}</p>
              <p>Tools：{selected.employee.tools.join(', ') || '-'}</p>
              {warnings.length > 0 && (
                <div style={s.warningBox}>
                  {warnings.map((warning) => (
                    <div key={`${warning.field}-${warning.message}`}>{warning.message}</div>
                  ))}
                </div>
              )}
            </div>
            <div style={s.modalActions}>
              <button type="button" style={s.secondaryButton} onClick={() => setConfirmingPublish(false)}>取消</button>
              <button
                type="button"
                style={s.primaryButton}
                onClick={() => {
                  setConfirmingPublish(false);
                  void runAction('publish');
                }}
              >
                {warnings.length > 0 ? '确认发布（含风险提示）' : '确认发布'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function withDisabled(style: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...style, opacity: 0.45, cursor: 'not-allowed' } : style;
}

function SystemItem(props: { label: string; value: string }) {
  return (
    <div style={s.systemItem}>
      <span style={s.systemLabel}>{props.label}</span>
      <strong style={s.systemValue}>{props.value}</strong>
    </div>
  );
}

const baseButton: CSSProperties = {
  height: 36,
  borderRadius: 'var(--radius-md)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '0 14px',
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
  whiteSpace: 'nowrap',
};

const s: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 18 },
  header: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  heading: { margin: 0, fontSize: 'var(--text-hero)', fontWeight: 400, fontFamily: 'var(--font-display)', letterSpacing: 'var(--tracking-tight)', color: 'var(--color-text-primary)' },
  sub: { margin: '8px 0 0', color: 'var(--color-text-muted)', fontSize: 'var(--text-lg)' },
  iconButton: { width: 36, height: 36, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', color: 'var(--color-text-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  errorBanner: { padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--color-danger-dim)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', fontSize: 'var(--text-base)' },
  successBanner: { padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--color-success-dim)', color: 'var(--color-success)', border: '1px solid var(--color-success)', fontSize: 'var(--text-base)' },
  successPanel: { padding: 14, borderRadius: 'var(--radius-md)', background: 'var(--color-success-dim)', color: 'var(--color-success)', border: '1px solid var(--color-success)', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  successMeta: { margin: '4px 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-success)' },
  successActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  linkButton: { ...baseButton, height: 32, border: '1px solid var(--color-success)', background: 'var(--color-bg-base)', color: 'var(--color-success)', textDecoration: 'none' },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(260px, 0.75fr) minmax(420px, 1.2fr) minmax(320px, 0.9fr)', gap: 16, alignItems: 'start' },
  builderLayout: { display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(520px, 1fr) minmax(320px, 400px)', gap: 16, alignItems: 'start' },
  sessionPanel: { border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-bg-base)', overflow: 'hidden', minWidth: 0, boxShadow: 'var(--shadow-card)', position: 'sticky', top: 16 },
  sessionHeader: { padding: '14px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  sessionList: { display: 'flex', flexDirection: 'column', maxHeight: 620, overflowY: 'auto' },
  sessionButton: { border: 0, borderBottom: '1px solid var(--color-border)', background: 'transparent', padding: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left', minWidth: 0 },
  sessionButtonActive: { background: 'var(--color-bg-raised)' },
  sessionPrimary: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0, color: 'var(--color-text-primary)', fontSize: 13, fontWeight: 700 },
  sessionName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  sessionMeta: { color: 'var(--color-text-muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sessionEmpty: { padding: 12, color: 'var(--color-text-secondary)', fontSize: 12, borderBottom: '1px solid var(--color-border)' },
  conversationPanel: { border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-bg-base)', overflow: 'hidden', minWidth: 0, boxShadow: 'var(--shadow-card)' },
  conversationHeader: { padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  progressBox: { padding: '12px 16px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-raised)', display: 'flex', flexDirection: 'column', gap: 8 },
  progressTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--color-text-secondary)', fontSize: 12 },
  progressTrack: { height: 8, borderRadius: 999, background: 'var(--color-border)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999, background: 'var(--color-accent)', transition: 'width 180ms var(--ease-out-expo)' },
  progressSteps: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 },
  progressStep: { borderRadius: 999, padding: '3px 6px', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  progressStepActive: { borderRadius: 999, padding: '3px 6px', textAlign: 'center', color: '#075985', background: '#e0f2fe', border: '1px solid #7dd3fc', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  progressStepDone: { borderRadius: 999, padding: '3px 6px', textAlign: 'center', color: '#166534', background: '#dcfce7', border: '1px solid #86efac', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  transcript: { padding: 16, display: 'flex', flexDirection: 'column', gap: 14 },
  chatBubble: { border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-bg-raised)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
  bubbleHeader: { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-primary)', fontSize: 14 },
  bubbleText: { margin: 0, color: 'var(--color-text-secondary)', fontSize: 13, lineHeight: 1.5 },
  previewPanel: { border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-bg-base)', minWidth: 0, boxShadow: 'var(--shadow-card)', overflow: 'hidden', position: 'sticky', top: 16 },
  previewHeader: { padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  previewChat: { minHeight: 420, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: 'linear-gradient(180deg, var(--color-bg-raised), var(--color-bg-base))' },
  previewBotMessage: { alignSelf: 'flex-start', maxWidth: '88%', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', padding: 12, color: 'var(--color-text-primary)', fontSize: 13, lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 4 },
  previewUserMessage: { alignSelf: 'flex-end', maxWidth: '88%', borderRadius: 8, background: 'var(--color-accent)', color: 'white', padding: 12, fontSize: 13, lineHeight: 1.5, overflowWrap: 'anywhere' },
  previewComposer: { borderTop: '1px solid var(--color-border)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 },
  panel: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-base)', overflow: 'hidden', minWidth: 0, boxShadow: 'var(--shadow-card)' },
  panelHeader: { padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  panelTitle: { margin: 0, fontSize: 'var(--text-lg)', fontWeight: 500, color: 'var(--color-text-primary)' },
  panelMeta: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '1px' },
  form: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-secondary)' },
  input: { height: 36, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', padding: '0 10px', fontSize: 'var(--text-base)', minWidth: 0 },
  systemSummary: { border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-bg-raised)', padding: 10, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 },
  systemItem: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  systemLabel: { color: 'var(--color-text-muted)', fontSize: 11 },
  systemValue: { color: 'var(--color-text-primary)', fontSize: 12, overflowWrap: 'anywhere' },
  textarea: { minHeight: 120, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', padding: 10, fontSize: 'var(--text-base)', lineHeight: 1.5, resize: 'vertical' },
  promptArea: { minHeight: 180, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', padding: 10, fontSize: 'var(--text-base)', lineHeight: 1.5, resize: 'vertical' },
  listArea: { minHeight: 110, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', padding: 10, fontSize: 'var(--text-base)', lineHeight: 1.5, resize: 'vertical' },
  segment: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 },
  segmentButton: { height: 32, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-raised)', color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', cursor: 'pointer' },
  segmentButtonActive: { borderColor: 'var(--color-accent)', background: 'var(--color-accent)', color: 'white' },
  primaryButton: { ...baseButton, border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: 'white' },
  secondaryButton: { ...baseButton, border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', color: 'var(--color-text-primary)' },
  selectorBox: { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--color-bg-raised)' },
  selectorHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  selectorTitle: { fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)' },
  selectorHint: { marginTop: 2, color: 'var(--color-text-secondary)', fontSize: 11, lineHeight: 1.4 },
  selectorCount: { borderRadius: 999, border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', color: 'var(--color-text-secondary)', padding: '2px 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
  optionGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 },
  optionCard: { minHeight: 74, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', padding: 10, display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) auto', gap: 8, alignItems: 'flex-start', cursor: 'pointer' },
  optionCardActive: { minHeight: 74, borderRadius: 8, border: '1px solid var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-base))', padding: 10, display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) auto', gap: 8, alignItems: 'flex-start', cursor: 'pointer' },
  optionCheckbox: { margin: '2px 0 0' },
  optionContent: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  optionTitle: { color: 'var(--color-text-primary)', fontSize: 12, fontWeight: 700, overflowWrap: 'anywhere' },
  optionMeta: { color: 'var(--color-text-muted)', fontSize: 11, overflowWrap: 'anywhere' },
  optionDescription: { color: 'var(--color-text-secondary)', fontSize: 11, lineHeight: 1.4, overflowWrap: 'anywhere' },
  unknownBox: { borderTop: '1px solid var(--color-border)', paddingTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  unknownPill: { borderRadius: 999, border: '1px solid #fcd34d', background: '#fffbeb', color: '#92400e', padding: '3px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', maxWidth: '100%', overflowWrap: 'anywhere' },
  choiceGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 },
  checkboxRow: { minHeight: 28, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-primary)', minWidth: 0 },
  mutedText: { color: 'var(--color-text-secondary)', fontSize: 11 },
  inlineWarn: { border: '1px solid #fcd34d', background: '#fffbeb', color: '#92400e', borderRadius: 6, padding: 10, fontSize: 12, lineHeight: 1.45 },
  inlineInfo: { border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', borderRadius: 6, padding: 10, fontSize: 12, lineHeight: 1.45 },
  contextLine: { minHeight: 34, borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', color: 'var(--color-text-secondary)', padding: '0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12 },
  actionHint: { color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1.45 },
  readyHint: { color: '#166534', fontSize: 12, lineHeight: 1.45 },
  riskRead: { marginLeft: 'auto', borderRadius: 999, padding: '1px 6px', background: '#e0f2fe', color: '#075985', fontSize: 10 },
  riskWarn: { marginLeft: 'auto', borderRadius: 999, padding: '1px 6px', background: '#fef3c7', color: '#92400e', fontSize: 10 },
  draftList: { borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' },
  draftButton: { border: 0, borderBottom: '1px solid var(--color-border)', background: 'transparent', padding: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textAlign: 'left' },
  draftButtonActive: { background: 'var(--color-bg-raised)' },
  draftName: { fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 700, overflowWrap: 'anywhere' },
  statusBadge: { border: '1px solid', borderRadius: 999, padding: '2px 7px', fontSize: 11, fontWeight: 700, flexShrink: 0 },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  empty: { padding: 16, color: 'var(--color-text-secondary)', fontSize: 13 },
  emptyInline: { color: 'var(--color-text-secondary)', fontSize: 13 },
  review: { padding: 16, display: 'flex', flexDirection: 'column', gap: 14 },
  actionRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  capabilityBox: { border: '1px solid var(--color-border)', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--color-bg-raised)' },
  capabilityHeader: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', color: 'var(--color-text-primary)', fontSize: 13 },
  capabilityGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, color: 'var(--color-text-secondary)', fontSize: 12 },
  capabilityTags: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  capabilityTag: { borderRadius: 999, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', padding: '2px 7px', fontSize: 11, maxWidth: '100%', overflowWrap: 'anywhere' },
  capabilityWarnTag: { borderRadius: 999, border: '1px solid #fcd34d', background: '#fffbeb', color: '#92400e', padding: '2px 7px', fontSize: 11, maxWidth: '100%', overflowWrap: 'anywhere' },
  capabilityMeta: { margin: 0, color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1.45 },
  okPill: { borderRadius: 999, background: '#dcfce7', color: '#166534', border: '1px solid #86efac', padding: '2px 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
  warnPill: { borderRadius: 999, background: '#fffbeb', color: '#92400e', border: '1px solid #fcd34d', padding: '2px 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
  issueList: { display: 'flex', flexDirection: 'column', gap: 8 },
  issue: { border: '1px solid currentColor', borderRadius: 6, padding: 10, background: 'var(--color-bg-raised)', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 },
  harnessBox: { border: '1px solid var(--color-border)', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 },
  harnessHeader: { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-primary)', fontSize: 13 },
  sandboxBox: { border: '1px solid var(--color-border)', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--color-bg-raised)' },
  sandboxArea: { minHeight: 76, borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', padding: 10, fontSize: 13, lineHeight: 1.5, resize: 'vertical' },
  sandboxResult: { border: '1px solid var(--color-border)', borderRadius: 6, padding: 10, background: 'var(--color-bg-base)', color: 'var(--color-text-primary)', fontSize: 13, lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 6 },
  sandboxSession: { color: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' },
  failureText: { margin: 0, color: '#991b1b', fontSize: 12 },
  pre: { margin: 0, padding: 12, borderRadius: 6, background: 'var(--color-bg-raised)', color: 'var(--color-text-primary)', overflow: 'auto', maxHeight: 320, fontSize: 12, lineHeight: 1.5 },
  modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 },
  modal: { width: 'min(560px, 100%)', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.25)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 },
  modalTitle: { margin: 0, fontSize: 18, color: 'var(--color-text-primary)' },
  modalBody: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--color-text-primary)' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  warningBox: { border: '1px solid #f59e0b', borderRadius: 6, padding: 10, background: '#fffbeb', color: '#92400e', display: 'flex', flexDirection: 'column', gap: 4 },
};
