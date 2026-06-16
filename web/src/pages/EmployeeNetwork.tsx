import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

/* ── Types ──────────────────────────────────────────────── */

type TemplateMeta = {
  id: string;
  name: string;
  description: string;
  employeeCount: number;
};

type TemplateEmployee = {
  template: string;
  role: string;
};

type TemplateLoadResult = {
  template: {
    id: string;
    name: string;
    description: string;
    version: string;
    employees: TemplateEmployee[];
  };
  employeeYamls: Record<string, string>;
  rolesJson?: Record<string, unknown>;
};

interface BootstrapStatus {
  configured: boolean;
  steps: {
    modelConfigured: boolean;
    employeeNetworkReady: boolean;
    peopleBound: boolean;
  };
}

interface EmployeeRow {
  id: string;
  displayName: string;
  role: string;
  source: 'template' | 'workdir';
  status: 'active' | 'pending';
}

interface ScanResult {
  path: string;
  skills: Array<{
    name: string;
    description: string;
    path: string;
    dependencies?: {
      runtime?: string;
      packages?: string[];
      scripts?: Array<{ path: string; access: 'read' | 'exec' }>;
    };
    hasWriteOps: boolean;
  }>;
  scripts: Array<{
    path: string;
    relativePath: string;
    executable: boolean;
  }>;
  runtimeDependencies: {
    hasPackageJson: boolean;
    hasRequirementsTxt: boolean;
    pythonPackages: string[];
    nodePackages: string[];
  };
}

interface ValidationIssue {
  path: string;
  severity: 'error' | 'warning';
  message: string;
}

interface SkillValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

interface WorkdirEmployeeDraft {
  id: string;
  displayName: string;
  role: string;
  description: string;
  skillNames: string[];
}

/* ── Component ───────────────────────────────────────────── */

export function EmployeeNetwork() {
  const navigate = useNavigate();
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus | null>(null);
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [tenantName, setTenantName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activePath, setActivePath] = useState<'template' | 'workdir'>('workdir');

  // Template flow state
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateMeta | null>(null);
  const [templateLoadResult, setTemplateLoadResult] = useState<TemplateLoadResult | null>(null);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);

  // Workdir flow state
  const [workdirPath, setWorkdirPath] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [showWorkdirPreview, setShowWorkdirPreview] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResults, setValidationResults] = useState<Record<string, SkillValidationResult> | null>(null);
  const [workdirDrafts, setWorkdirDrafts] = useState<WorkdirEmployeeDraft[]>([]);

  // IM Channel state
  const [channelType, setChannelType] = useState<'dingtalk' | 'feishu' | ''>('');
  const [channelConfig, setChannelConfig] = useState<Record<string, string>>({});

  const currentStep = 2;
  const isComplete = bootstrapStatus?.steps.employeeNetworkReady ?? false;

  useEffect(() => {
    Promise.all([
      api.getBootstrapStatus(),
      api.listTemplates(),
      api.listEmployees(),
    ])
      .then(([statusRes, templatesRes, employeesRes]) => {
        setBootstrapStatus(statusRes as BootstrapStatus);
        setTemplates(templatesRes.templates ?? []);
        if (employeesRes.employees) {
          setEmployees(
            employeesRes.employees.map((e) => ({
              id: e.id,
              displayName: e.displayName,
              role: e.role,
              source: e.source === 'generated' ? 'template' : 'workdir',
              status: 'active',
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  const handleSelectTemplate = (template: TemplateMeta) => {
    setSelectedTemplate(template);
    setShowTemplatePreview(true);

    // Initialize name map with role names as defaults
    // For now, we'll show a simple preview since we don't have detailed template loading
    // The actual employee details will be available after instantiation
    setNameMap({});
  };

  const handleScanWorkdir = async () => {
    if (!workdirPath.trim()) {
      setError('请输入工作目录路径');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await api.scanWorkdir(workdirPath.trim());
      setScanResult(data as ScanResult);
      setSelectedSkills(new Set(data.skills.map((s: { name: string }) => s.name)));
      setWorkdirDrafts(buildWorkdirDrafts(data as ScanResult));
      setShowWorkdirPreview(true);
      setValidationResults(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFromTemplate = async () => {
    if (!tenantName.trim()) {
      setError('请填写租户名称');
      return;
    }
    if (!selectedTemplate) return;

    const tenantRegex = /^[a-z][a-z0-9-]*$/;
    if (!tenantRegex.test(tenantName.trim())) {
      setError('租户名称必须以小写字母开头，只能包含小写字母、数字和连字符');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await api.instantiateTemplate(selectedTemplate.id, { tenantName: tenantName.trim(), nameMap });

      // Save channel config if provided
      if (channelType && Object.keys(channelConfig).length > 0) {
        await saveChannelConfig(tenantName.trim());
      }

      await refreshEmployees();
      navigate(`/people?tenant=${encodeURIComponent(tenantName.trim())}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFromWorkdir = async () => {
    if (!tenantName.trim()) {
      setError('请填写租户名称');
      return;
    }
    if (!scanResult) return;

    const validationOk = await validateSelectedSkills();
    if (!validationOk) return;

    const tenantRegex = /^[a-z][a-z0-9-]*$/;
    if (!tenantRegex.test(tenantName.trim())) {
      setError('租户名称必须以小写字母开头，只能包含小写字母、数字和连字符');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const employeeDrafts = workdirDrafts
        .map((draft) => ({
          ...draft,
          skillNames: draft.skillNames.filter((name) => selectedSkills.has(name)),
        }))
        .filter((draft) => draft.skillNames.length > 0);

      await api.importEmployees({
        sourcePath: scanResult.path,
        tenant: tenantName.trim(),
        employeeDrafts,
      });

      // Save channel config if provided
      if (channelType && Object.keys(channelConfig).length > 0) {
        await saveChannelConfig(tenantName.trim());
      }

      await refreshEmployees();
      navigate(`/people?tenant=${encodeURIComponent(tenantName.trim())}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setLoading(false);
    }
  };

  const validateSelectedSkills = async (): Promise<boolean> => {
    if (!scanResult) return false;
    const skillsToValidate = scanResult.skills.filter((skill) => selectedSkills.has(skill.name));
    if (skillsToValidate.length === 0) {
      setError('请至少选择一个技能');
      return false;
    }

    setValidating(true);
    setError('');
    try {
      const entries = await Promise.all(
        skillsToValidate.map(async (skill) => {
          const result = await api.validateWorkdirSkill({
            workdir: scanResult.path,
            skillPath: skill.path,
          });
          return [skill.name, result] as const;
        }),
      );
      const nextResults = Object.fromEntries(entries);
      setValidationResults(nextResults);
      const valid = entries.every(([, result]) => result.valid);
      if (!valid) {
        setError('部分技能校验未通过，请处理错误后再导入');
      }
      return valid;
    } catch (err) {
      setError(err instanceof Error ? err.message : '校验失败');
      return false;
    } finally {
      setValidating(false);
    }
  };

  const saveChannelConfig = async (tenant: string) => {
    const config: Record<string, unknown> = {
      ...(channelType === 'dingtalk' && {
        dingtalk: {
          clientId: channelConfig.clientId,
          clientSecret: channelConfig.clientSecret,
        },
      }),
      ...(channelType === 'feishu' && {
        feishu: {
          appId: channelConfig.appId,
          appSecret: channelConfig.appSecret,
        },
      }),
    };

    await api.saveAdminConfig({
      ...(channelType === 'dingtalk' && {
        bots: [{
          name: tenant,
          channel: 'dingtalk',
          credentials: {
            clientId: channelConfig.clientId,
            clientSecret: channelConfig.clientSecret,
          },
        }],
      }),
      ...(channelType === 'feishu' && {
        bots: [{
          name: tenant,
          channel: 'feishu',
          credentials: {
            appId: channelConfig.appId,
            appSecret: channelConfig.appSecret,
          },
        }],
      }),
    });
  };

  const refreshEmployees = async () => {
    const data = await api.listEmployees();
    if (data.employees) {
      setEmployees(
        data.employees.map((e) => ({
          id: e.id,
          displayName: e.displayName,
          role: e.role,
          source: e.source === 'generated' ? 'template' : 'workdir',
          status: 'active',
        })),
      );
    }
  };

  const canProceed = useMemo(() => {
    return Boolean(selectedTemplate || scanResult);
  }, [selectedTemplate, scanResult]);

  const updateWorkdirDraft = (id: string, patch: Partial<WorkdirEmployeeDraft>) => {
    setWorkdirDrafts((prev) => prev.map((draft) => (
      draft.id === id ? { ...draft, ...patch } : draft
    )));
  };

  return (
    <div style={page}>
      <div style={container}>
        {/* Header */}
        <div style={header}>
          {isComplete && <div style={statusBadgeStyle}>已完成</div>}
          <div style={stepIndicator}>第 {currentStep} 步，共 3 步</div>
          <h1 style={heading}>员工网络配置</h1>
          <p style={subheading}>
            选择行业模板或从工作目录导入，创建数字员工团队。
          </p>
        </div>

        {error && <div style={errorBanner}>{error}</div>}

        {/* Creation Paths */}
        <section style={section}>
          <div style={sectionHeader}>
            <h2 style={sectionTitle}>创建方式</h2>
          </div>
          <div style={cardsContainer}>
            {/* Template Card */}
            <div
              style={{
                ...card,
                ...(activePath === 'template' ? cardActive : {}),
              }}
              onClick={() => {
                setActivePath('template');
                setSelectedTemplate(null);
                setScanResult(null);
                setShowTemplatePreview(false);
                setShowWorkdirPreview(false);
              }}
            >
              <div style={cardIcon}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 21h18M5 21V7l8-4 8 4v14M8 21v-2a4 4 0 0 1 4-4 4 4 0 0 1 4 4v2" />
                </svg>
              </div>
              <h3 style={cardTitle}>从行业模板</h3>
              <p style={cardDescription}>
                选择预定义的行业模板，快速生成完整的员工团队。适合企业客户。
              </p>
            </div>

            {/* Workdir Card */}
            <div
              style={{
                ...card,
                ...(activePath === 'workdir' ? cardActive : {}),
              }}
              onClick={() => {
                setActivePath('workdir');
                setSelectedTemplate(null);
                setScanResult(null);
                setShowWorkdirPreview(false);
                setShowTemplatePreview(false);
              }}
            >
              <div style={cardIcon}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3 style={cardTitle}>导入工作目录</h3>
              <p style={cardDescription}>
                扫描现有工作目录，自动识别技能并生成员工配置。
              </p>
            </div>
          </div>
        </section>

        {/* Template Selection */}
        {activePath === 'template' && !showTemplatePreview && (
          <section style={section}>
            <div style={sectionHeader}>
              <h2 style={sectionTitle}>选择行业模板</h2>
            </div>
            <div style={templateGrid}>
              {templates.map((template) => (
                <div
                  key={template.id}
                  style={{
                    ...templateCard,
                    ...(selectedTemplate?.id === template.id ? templateCardActive : {}),
                  }}
                  onClick={() => handleSelectTemplate(template)}
                >
                  <h4 style={templateCardTitle}>{template.name}</h4>
                  <p style={templateCardDescription}>{template.description}</p>
                  <div style={templateCardMeta}>
                    <span>{template.employeeCount} 个员工</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Template Preview */}
        {showTemplatePreview && selectedTemplate && (
          <section style={section}>
            <div style={sectionHeader}>
              <h2 style={sectionTitle}>模板预览</h2>
              <button
                type="button"
                onClick={() => setShowTemplatePreview(false)}
                style={btnText}
              >
                返回
              </button>
            </div>
            <div style={templatePreviewContainer}>
              <h3 style={templatePreviewTitle}>{selectedTemplate.name}</h3>
              <p style={templatePreviewDescription}>{selectedTemplate.description}</p>
              <div style={templatePreviewMeta}>
                <span style={templatePreviewMetaItem}>
                  {selectedTemplate.employeeCount} 个员工
                </span>
              </div>
              <p style={hint}>
                选择此模板将创建 {selectedTemplate.employeeCount} 个预配置的数字员工。
                创建后可在员工管理页面查看和修改员工配置。
              </p>
            </div>
            <div style={sectionActions}>
              <button
                type="button"
                onClick={() => setShowTemplatePreview(false)}
                style={btnSecondary}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateFromTemplate}
                disabled={loading || !tenantName.trim()}
                style={btnPrimary}
              >
                {loading ? '创建中...' : '创建员工网络'}
              </button>
            </div>
          </section>
        )}

        {/* Workdir Scan */}
        {activePath === 'workdir' && !scanResult && !showWorkdirPreview && (
          <section style={section}>
            <div style={sectionHeader}>
              <h2 style={sectionTitle}>工作目录扫描</h2>
            </div>
            <div style={sectionContent}>
              <label style={label}>
                工作目录路径
                <input
                  type="text"
                  value={workdirPath}
                  onChange={(e) => setWorkdirPath(e.target.value)}
                  placeholder="/path/to/your/project"
                  style={input}
                />
              </label>
              <button
                type="button"
                onClick={handleScanWorkdir}
                disabled={loading || !workdirPath.trim()}
                style={{ ...btnPrimary, marginTop: '8px' }}
              >
                {loading ? '扫描中...' : '扫描'}
              </button>
            </div>
          </section>
        )}

        {/* Workdir Preview */}
        {showWorkdirPreview && scanResult && (
          <section style={section}>
            <div style={sectionHeader}>
              <h2 style={sectionTitle}>扫描结果</h2>
              <button
                type="button"
                onClick={() => setShowWorkdirPreview(false)}
                style={btnText}
              >
                返回
              </button>
            </div>
            <div style={scanResultContainer}>
              <div style={scanSummary}>
                <span style={scanSummaryItem}>发现 {scanResult.skills.length} 个技能</span>
                <span style={scanSummaryItem}>{scanResult.scripts.length} 个脚本</span>
                {scanResult.runtimeDependencies.hasPackageJson && (
                  <span style={scanSummaryItem}>Node.js 项目</span>
                )}
                {scanResult.runtimeDependencies.hasRequirementsTxt && (
                  <span style={scanSummaryItem}>Python 项目</span>
                )}
              </div>
              <div style={skillsList}>
                {scanResult.skills.map((skill) => {
                  const validation = validationResults?.[skill.name];
                  return (
                    <div key={skill.name} style={skillItem}>
                      <label style={skillCheckbox}>
                        <input
                          type="checkbox"
                          checked={selectedSkills.has(skill.name)}
                          onChange={(e) => {
                            const newSet = new Set(selectedSkills);
                            if (e.target.checked) {
                              newSet.add(skill.name);
                            } else {
                              newSet.delete(skill.name);
                            }
                            setSelectedSkills(newSet);
                            setValidationResults(null);
                          }}
                        />
                        <span style={skillName}>{skill.name}</span>
                      </label>
                      <p style={skillDescription}>{skill.description}</p>
                      {skill.hasWriteOps && (
                        <span style={writeOpsBadge}>有写权限</span>
                      )}
                      {validation && <ValidationSummary result={validation} />}
                    </div>
                  );
                })}
              </div>
              <div style={draftSection}>
                <div style={draftHeader}>
                  <h3 style={draftTitle}>员工拆分建议</h3>
                  <span style={scanSummaryItem}>可在导入前调整名称、角色和说明。</span>
                </div>
                {workdirDrafts
                  .filter((draft) => draft.skillNames.some((name) => selectedSkills.has(name)))
                  .map((draft) => (
                    <div key={draft.id} style={draftItem}>
                      <label style={draftField}>
                        员工名称
                        <input
                          value={draft.displayName}
                          onChange={(e) => updateWorkdirDraft(draft.id, { displayName: e.target.value })}
                          style={input}
                        />
                      </label>
                      <label style={draftField}>
                        角色 ID
                        <input
                          value={draft.role}
                          onChange={(e) => updateWorkdirDraft(draft.id, { role: toDraftId(e.target.value) })}
                          style={input}
                        />
                      </label>
                      <label style={draftFieldWide}>
                        说明
                        <textarea
                          value={draft.description}
                          onChange={(e) => updateWorkdirDraft(draft.id, { description: e.target.value })}
                          style={textarea}
                          rows={2}
                        />
                      </label>
                      <div style={draftSkills}>
                        {draft.skillNames.map((name) => (
                          <span key={name} style={draftSkillBadge}>{name}</span>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            <div style={sectionActions}>
              <button
                type="button"
                onClick={() => setShowWorkdirPreview(false)}
                style={btnSecondary}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => { void validateSelectedSkills(); }}
                disabled={validating || selectedSkills.size === 0}
                style={btnSecondary}
              >
                {validating ? '校验中...' : '校验所选技能'}
              </button>
              <button
                type="button"
                onClick={handleCreateFromWorkdir}
                disabled={loading || validating || selectedSkills.size === 0 || !tenantName.trim()}
                style={btnPrimary}
              >
                {loading ? '导入中...' : `导入 ${selectedSkills.size} 个技能`}
              </button>
            </div>
          </section>
        )}

        {/* Tenant Name */}
        {canProceed && (
          <section style={section}>
            <div style={sectionHeader}>
              <h2 style={sectionTitle}>租户配置</h2>
            </div>
            <div style={sectionContent}>
              <label style={label}>
                租户名称
                <input
                  type="text"
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  placeholder="my-company"
                  style={{ ...input, fontFamily: 'var(--font-mono, monospace)' }}
                />
                <p style={hint}>只能包含小写字母、数字和连字符，以字母开头。</p>
              </label>

              {/* IM Channel Config */}
              <div style={channelSection}>
                <label style={label}>
                  IM 渠道（可选）
                  <select
                    value={channelType}
                    onChange={(e) => setChannelType(e.target.value as typeof channelType)}
                    style={input}
                  >
                    <option value="">暂不配置</option>
                    <option value="dingtalk">钉钉</option>
                    <option value="feishu">飞书</option>
                  </select>
                </label>

                {channelType === 'dingtalk' && (
                  <>
                    <label style={label}>
                      Client ID
                      <input
                        type="text"
                        value={channelConfig.clientId ?? ''}
                        onChange={(e) => setChannelConfig({ ...channelConfig, clientId: e.target.value })}
                        placeholder="dingxxxxxxxx"
                        style={input}
                      />
                    </label>
                    <label style={label}>
                      Client Secret
                      <input
                        type="password"
                        value={channelConfig.clientSecret ?? ''}
                        onChange={(e) => setChannelConfig({ ...channelConfig, clientSecret: e.target.value })}
                        placeholder="钉钉应用 Secret"
                        style={input}
                      />
                    </label>
                  </>
                )}

                {channelType === 'feishu' && (
                  <>
                    <label style={label}>
                      App ID
                      <input
                        type="text"
                        value={channelConfig.appId ?? ''}
                        onChange={(e) => setChannelConfig({ ...channelConfig, appId: e.target.value })}
                        placeholder="cli_xxxxxxxxx"
                        style={input}
                      />
                    </label>
                    <label style={label}>
                      App Secret
                      <input
                        type="password"
                        value={channelConfig.appSecret ?? ''}
                        onChange={(e) => setChannelConfig({ ...channelConfig, appSecret: e.target.value })}
                        placeholder="飞书应用 Secret"
                        style={input}
                      />
                    </label>
                  </>
                )}
              </div>
            </div>
            <div style={sectionActions}>
              <button
                type="button"
                onClick={() => {
                  setSelectedTemplate(null);
                  setScanResult(null);
                  setActivePath('workdir');
                  setShowTemplatePreview(false);
                  setShowWorkdirPreview(false);
                  setChannelType('');
                  setChannelConfig({});
                }}
                style={btnSecondary}
              >
                重置
              </button>
            </div>
          </section>
        )}

        {/* Existing Employees */}
        {employees.length > 0 && (
          <section style={section}>
            <div style={sectionHeader}>
              <h2 style={sectionTitle}>已创建的员工</h2>
            </div>
            <div style={employeeTable}>
              <div style={tableHeader}>
                <div style={tableCell}>名称</div>
                <div style={tableCell}>角色</div>
                <div style={tableCell}>来源</div>
                <div style={tableCell}>状态</div>
              </div>
              {employees.map((emp) => (
                <div key={emp.id} style={tableRow}>
                  <div style={tableCell}>{emp.displayName}</div>
                  <div style={tableCell}>{emp.role}</div>
                  <div style={tableCell}>
                    <span style={sourceBadge(emp.source)}>
                      {emp.source === 'template' ? '模板' : '工作目录'}
                    </span>
                  </div>
                  <div style={tableCell}>
                    <span style={statusBadge(emp.status)}>
                      {emp.status === 'active' ? '活跃' : '待定'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ValidationSummary({ result }: { result: SkillValidationResult }) {
  const issueCount = result.errors.length + result.warnings.length;

  if (issueCount === 0) {
    return <div style={validationOk}>校验通过</div>;
  }

  return (
    <div style={validationBox(result.valid)}>
      {result.errors.map((issue) => (
        <div key={`error-${issue.path}-${issue.message}`} style={validationError}>
          {issue.path}: {issue.message}
        </div>
      ))}
      {result.warnings.map((issue) => (
        <div key={`warning-${issue.path}-${issue.message}`} style={validationWarning}>
          {issue.path}: {issue.message}
        </div>
      ))}
    </div>
  );
}

function toDraftId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || `employee-${Date.now()}`;
}

function buildWorkdirDrafts(scanResult: ScanResult): WorkdirEmployeeDraft[] {
  return scanResult.skills.map((skill) => ({
    id: toDraftId(skill.name),
    displayName: skill.name,
    role: toDraftId(skill.name),
    description: skill.description || `使用 ${skill.name} 技能处理业务任务。`,
    skillNames: [skill.name],
  }));
}

/* ── Layout Styles ───────────────────────────────────────── */

const page: React.CSSProperties = {
  padding: '24px 16px',
  display: 'flex',
  justifyContent: 'center',
};

const container: React.CSSProperties = {
  width: '100%',
  maxWidth: '800px',
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
};

const header: React.CSSProperties = {
  textAlign: 'center',
};

const statusBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '4px 12px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(74, 222, 128, 0.1)',
  border: '1px solid rgba(74, 222, 128, 0.25)',
  color: '#4ade80',
  fontSize: '12px',
  fontWeight: 500,
  marginBottom: '12px',
};

const stepIndicator: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--color-on-dark-soft)',
  marginBottom: '8px',
};

const heading: React.CSSProperties = {
  margin: 0,
  fontSize: '22px',
  fontWeight: 700,
  color: 'var(--color-on-dark)',
  marginBottom: '8px',
};

const subheading: React.CSSProperties = {
  margin: 0,
  fontSize: '14px',
  color: 'var(--color-on-dark-soft)',
  lineHeight: 1.5,
};

const errorBanner: React.CSSProperties = {
  padding: '12px 14px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(248, 113, 113, 0.08)',
  border: '1px solid rgba(248, 113, 113, 0.25)',
  color: '#f87171',
  fontSize: '13px',
};

const section: React.CSSProperties = {
  background: 'var(--color-surface-dark)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border, var(--color-surface-dark-elevated))',
  boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
};

const sectionHeader: React.CSSProperties = {
  padding: '20px 24px 12px',
  borderBottom: '1px solid var(--color-surface-dark-elevated)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--color-on-dark)',
};

const sectionContent: React.CSSProperties = {
  padding: '24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const sectionActions: React.CSSProperties = {
  padding: '16px 24px',
  borderTop: '1px solid var(--color-surface-dark-elevated)',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
};

/* ── Cards ────────────────────────────────────────────────── */

const cardsContainer: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: '16px',
  padding: '24px',
};

const card: React.CSSProperties = {
  padding: '20px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  background: 'var(--color-surface-dark-elevated)',
  cursor: 'pointer',
  transition: 'border-color 150ms, background 150ms',
};

const cardActive: React.CSSProperties = {
  borderColor: 'var(--color-accent)',
  background: 'rgba(249, 115, 22, 0.05)',
};

const cardIcon: React.CSSProperties = {
  width: '48px',
  height: '48px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-accent)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: '12px',
};

const cardTitle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--color-on-dark)',
};

const cardDescription: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  color: 'var(--color-on-dark-soft)',
  lineHeight: 1.5,
};

/* ── Template Grid ───────────────────────────────────────── */

const templateGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: '12px',
  padding: '24px',
};

const templateCard: React.CSSProperties = {
  padding: '16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  cursor: 'pointer',
  transition: 'border-color 150ms',
};

const templateCardActive: React.CSSProperties = {
  borderColor: 'var(--color-accent)',
};

const templateCardTitle: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--color-on-dark)',
};

const templateCardDescription: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: '12px',
  color: 'var(--color-on-dark-soft)',
  lineHeight: 1.4,
};

const templateCardMeta: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--color-on-dark-soft)',
};

const templatePreviewContainer: React.CSSProperties = {
  padding: '24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const templatePreviewTitle: React.CSSProperties = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 600,
  color: 'var(--color-on-dark)',
};

const templatePreviewDescription: React.CSSProperties = {
  margin: 0,
  fontSize: '14px',
  color: 'var(--color-on-dark-soft)',
  lineHeight: 1.5,
};

const templatePreviewMeta: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  padding: '12px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface-dark-elevated)',
};

const templatePreviewMetaItem: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--color-on-dark-soft)',
};

/* ── Employee Preview ───────────────────────────────────── */

const employeePreviewList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '0 24px 24px',
};

const employeePreviewItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '12px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface-dark-elevated)',
};

const employeePreviewRole: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--color-on-dark-soft)',
  minWidth: '80px',
};

const employeeNameInput: React.CSSProperties = {
  flex: 1,
  background: 'var(--color-surface-dark)',
  border: '1px solid var(--color-surface-dark-elevated)',
  borderRadius: 'var(--radius-sm)',
  padding: '8px 12px',
  fontSize: '14px',
  color: 'var(--color-on-dark)',
  outline: 'none',
};

/* ── Scan Result ───────────────────────────────────────── */

const scanResultContainer: React.CSSProperties = {
  padding: '0 24px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const scanSummary: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  padding: '12px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface-dark-elevated)',
};

const scanSummaryItem: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--color-on-dark-soft)',
};

const skillsList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const skillItem: React.CSSProperties = {
  padding: '12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  background: 'var(--color-surface-dark-elevated)',
};

const skillCheckbox: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const skillName: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--color-on-dark)',
};

const skillDescription: React.CSSProperties = {
  margin: '4px 0 0 24px',
  fontSize: '12px',
  color: 'var(--color-on-dark-soft)',
  lineHeight: 1.4,
};

const writeOpsBadge: React.CSSProperties = {
  display: 'inline-block',
  marginTop: '4px',
  marginLeft: '24px',
  padding: '2px 8px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(249, 115, 22, 0.1)',
  color: '#f97316',
  fontSize: '10px',
  fontWeight: 500,
};

const validationOk: React.CSSProperties = {
  marginTop: '8px',
  marginLeft: '24px',
  fontSize: '12px',
  color: '#4ade80',
};

const validationBox = (valid: boolean): React.CSSProperties => ({
  marginTop: '8px',
  marginLeft: '24px',
  padding: '8px 10px',
  borderRadius: 'var(--radius-sm)',
  border: valid ? '1px solid rgba(251, 191, 36, 0.22)' : '1px solid rgba(248, 113, 113, 0.25)',
  background: valid ? 'rgba(251, 191, 36, 0.06)' : 'rgba(248, 113, 113, 0.08)',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
});

const validationError: React.CSSProperties = {
  fontSize: '12px',
  color: '#f87171',
  lineHeight: 1.4,
};

const validationWarning: React.CSSProperties = {
  fontSize: '12px',
  color: '#fbbf24',
  lineHeight: 1.4,
};

const draftSection: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  paddingTop: '4px',
};

const draftHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '12px',
};

const draftTitle: React.CSSProperties = {
  margin: 0,
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--color-on-dark)',
};

const draftItem: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(140px, 1fr) minmax(120px, 0.8fr)',
  gap: '10px',
  padding: '12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  background: 'rgba(255, 255, 255, 0.02)',
};

const draftField: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '12px',
  color: 'var(--color-on-dark-soft)',
};

const draftFieldWide: React.CSSProperties = {
  ...draftField,
  gridColumn: '1 / -1',
};

const textarea: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  background: 'var(--color-surface-dark-elevated)',
  color: 'var(--color-on-dark)',
  fontSize: '14px',
  fontFamily: 'var(--font-body)',
  outline: 'none',
  resize: 'vertical',
  minHeight: '64px',
  lineHeight: 1.4,
};

const draftSkills: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  gap: '6px',
  flexWrap: 'wrap',
};

const draftSkillBadge: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(74, 222, 128, 0.08)',
  color: '#4ade80',
  fontSize: '11px',
};

/* ── Channel Section ─────────────────────────────────────── */

const channelSection: React.CSSProperties = {
  padding: '16px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface-dark-elevated)',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

/* ── Employee Table ─────────────────────────────────────── */

const employeeTable: React.CSSProperties = {
  padding: '0 24px 24px',
};

const tableHeader: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '2fr 1fr 1fr 1fr',
  gap: '12px',
  padding: '12px',
  borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
  background: 'var(--color-surface-dark-elevated)',
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--color-on-dark-soft)',
};

const tableRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '2fr 1fr 1fr 1fr',
  gap: '12px',
  padding: '12px',
  borderRadius: 0,
  borderBottom: '1px solid var(--color-surface-dark-elevated)',
  fontSize: '13px',
};

const tableRowLast = (): React.CSSProperties => ({
  borderBottom: 'none',
  borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
});

const tableCell: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
};

const sourceBadge = (source: 'template' | 'workdir'): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 'var(--radius-sm)',
  background: source === 'template'
    ? 'rgba(74, 222, 128, 0.1)'
    : 'rgba(59, 130, 246, 0.1)',
  color: source === 'template' ? '#4ade80' : '#3b82f6',
  fontSize: '11px',
});

const statusBadge = (status: 'active' | 'pending'): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 'var(--radius-sm)',
  background: status === 'active'
    ? 'rgba(74, 222, 128, 0.1)'
    : 'rgba(156, 163, 175, 0.1)',
  color: status === 'active' ? '#4ade80' : '#9ca3af',
  fontSize: '11px',
});

/* ── Form Elements ───────────────────────────────────────── */

const label: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--color-on-dark-soft)',
};

const input: React.CSSProperties = {
  background: 'var(--color-surface-dark-elevated)',
  border: '1px solid var(--color-surface-dark-elevated)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 12px',
  fontSize: '14px',
  color: 'var(--color-on-dark)',
  fontFamily: 'var(--font-body)',
  outline: 'none',
  boxSizing: 'border-box' as const,
  width: '100%',
};

const hint: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  color: 'var(--color-on-dark-soft)',
  lineHeight: 1.5,
};

/* ── Buttons ─────────────────────────────────────────────── */

const btnPrimary: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  background: 'var(--color-accent)',
  color: '#fff',
  fontSize: '14px',
  fontWeight: 500,
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
};

const btnSecondary: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-surface-dark-elevated)',
  background: 'transparent',
  color: 'var(--color-on-dark-soft)',
  fontSize: '14px',
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
};

const btnText: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  background: 'transparent',
  color: 'var(--color-on-dark-soft)',
  fontSize: '13px',
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
};

/* ── Responsive ─────────────────────────────────────────── */

const mobileStyles = `
  @media (max-width: 640px) {
    .cards-container {
      grid-template-columns: 1fr;
    }
    .template-grid {
      grid-template-columns: 1fr;
    }
    .table-header, .table-row {
      grid-template-columns: 1.5fr 1fr 1fr 0.8fr;
      font-size: 11px;
    }
  }
`;

const styleElement = document.createElement('style');
styleElement.textContent = mobileStyles;
document.head.appendChild(styleElement);
