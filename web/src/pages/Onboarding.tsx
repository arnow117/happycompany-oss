import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken } from '../lib/auth';

const STEPS = ['企业信息', '角色预览', '首个员工'];

interface FormState {
  name: string;
  displayName: string;
  description: string;
  employeeDescription: string;
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({
    name: '',
    displayName: '',
    description: '',
    employeeDescription: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const updateField = useCallback((field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const validateStep1 = useCallback((): string | null => {
    if (!form.name.trim()) return '企业标识不能为空';
    if (!/^[a-z][a-z0-9-]*$/.test(form.name.trim())) return '企业标识只能包含小写字母、数字和连字符，且必须以字母开头';
    if (!form.displayName.trim()) return '企业名称不能为空';
    return null;
  }, [form.name, form.displayName]);

  const handleNext = useCallback(() => {
    setError(null);
    if (step === 0) {
      const err = validateStep1();
      if (err) { setError(err); return; }
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }, [step, validateStep1]);

  const handleBack = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          name: form.name.trim(),
          displayName: form.displayName.trim(),
          description: form.description.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || '创建企业失败');
      }

      if (form.employeeDescription.trim()) {
        try {
          await fetch('/api/employees/generate', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
              description: form.employeeDescription.trim(),
              tenant: form.name.trim(),
            }),
          });
        } catch {
          // Employee generation is optional; don't block the flow
        }
      }

      navigate('/employees');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }, [form, navigate]);

  return (
    <section style={s.section}>
      <h2 style={s.heading}>新建企业</h2>
      <p style={s.sub}>创建一个新的企业租户，并配置首个数字员工</p>

      {/* Progress indicator */}
      <div style={s.progressBar}>
        {STEPS.map((label, i) => (
          <div key={label} style={s.stepItem}>
            <div
              style={{
                ...s.stepDot,
                background: i <= step ? 'var(--color-accent)' : 'var(--color-border)',
                color: i <= step ? 'white' : 'var(--color-text-muted)',
              }}
            >
              {i + 1}
            </div>
            <span
              style={{
                ...s.stepLabel,
                color: i <= step ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                fontWeight: i === step ? 500 : 400,
              }}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                style={{
                  ...s.stepLine,
                  background: i < step ? 'var(--color-accent)' : 'var(--color-border)',
                }}
              />
            )}
          </div>
        ))}
      </div>

      {error && <div style={s.errorBanner}>{error}</div>}

      <div style={s.card}>
        {/* Step 1: Enterprise Info */}
        {step === 0 && (
          <div style={s.formGroup}>
            <div style={s.field}>
              <label htmlFor="tenant-name" style={s.label}>企业标识 *</label>
              <input
                id="tenant-name"
                style={s.input}
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="例：mycompany（英文，小写字母+数字+连字符）"
              />
              <span style={s.hint}>用于系统标识，创建后不可修改</span>
            </div>
            <div style={s.field}>
              <label htmlFor="tenant-display-name" style={s.label}>企业名称 *</label>
              <input
                id="tenant-display-name"
                style={s.input}
                value={form.displayName}
                onChange={(e) => updateField('displayName', e.target.value)}
                placeholder="例：我的公司"
              />
            </div>
            <div style={s.field}>
              <label htmlFor="tenant-description" style={s.label}>企业描述</label>
              <textarea
                id="tenant-description"
                style={s.textarea}
                rows={3}
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="可选：简单描述这家企业的业务范围"
              />
            </div>
          </div>
        )}

        {/* Step 2: Role Setup Preview */}
        {step === 1 && (
          <div style={s.formGroup}>
            <p style={s.infoText}>以下默认角色将在创建后自动生成：</p>
            <div style={s.roleList}>
              <div style={s.roleCard}>
                <div style={s.roleName}>管理员 (admin)</div>
                <div style={s.rolePerm}>全部工具权限</div>
              </div>
              <div style={s.roleCard}>
                <div style={s.roleName}>员工 (member)</div>
                <div style={s.rolePerm}>可配置工具权限</div>
              </div>
              <div style={s.roleCard}>
                <div style={s.roleName}>只读 (readonly)</div>
                <div style={s.rolePerm}>仅查看权限</div>
              </div>
            </div>
            <span style={s.hint}>可在设置中修改</span>
          </div>
        )}

        {/* Step 3: First Employee */}
        {step === 2 && (
          <div style={s.formGroup}>
            <p style={s.infoText}>描述你的第一个数字员工——系统将根据描述尝试生成：</p>
            <div style={s.field}>
              <label htmlFor="employee-description" style={s.label}>数字员工描述</label>
              <textarea
                id="employee-description"
                style={s.textarea}
                rows={4}
                value={form.employeeDescription}
                onChange={(e) => updateField('employeeDescription', e.target.value)}
                placeholder='例：负责销售跟进的助手，能查CRM、发合同'
              />
            </div>
            <span style={s.hint}>生成失败不影响企业创建，可在员工管理页面重新生成</span>
          </div>
        )}

        {/* Navigation buttons */}
        <div style={s.buttonRow}>
          {step > 0 && (
            <button style={s.secondaryBtn} onClick={handleBack} disabled={submitting}>
              上一步
            </button>
          )}
          <div style={{ flex: 1 }} />
          {step < STEPS.length - 1 ? (
            <button style={s.primaryBtn} onClick={handleNext}>
              下一步
            </button>
          ) : (
            <button style={s.primaryBtn} onClick={handleSubmit} disabled={submitting}>
              {submitting ? '创建中…' : '完成创建'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

const s = {
  section: {
    maxWidth: '600px',
    margin: '0 auto',
  } as React.CSSProperties,

  heading: {
    fontSize: 'var(--text-hero)',
    fontWeight: 400,
    fontFamily: 'var(--font-display)',
    letterSpacing: 'var(--tracking-tight)',
    margin: 0,
    color: 'var(--color-text-primary)',
  } as React.CSSProperties,

  sub: {
    fontSize: 'var(--text-lg)',
    color: 'var(--color-text-muted)',
    margin: '8px 0 0',
  } as React.CSSProperties,

  progressBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: 'var(--space-xl)',
    marginBottom: 'var(--space-xl)',
  } as React.CSSProperties,

  stepItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
  } as React.CSSProperties,

  stepDot: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'var(--font-body)',
    flexShrink: 0,
    transition: 'all var(--transition-fast)',
  } as React.CSSProperties,

  stepLabel: {
    fontSize: '12px',
    fontFamily: 'var(--font-body)',
    whiteSpace: 'nowrap',
    transition: 'color var(--transition-fast)',
  } as React.CSSProperties,

  stepLine: {
    flex: 1,
    height: '2px',
    borderRadius: '1px',
    transition: 'background var(--transition-fast)',
  } as React.CSSProperties,

  errorBanner: {
    padding: '12px 20px',
    background: 'var(--color-danger-dim)',
    border: '1px solid var(--color-danger)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-danger)',
    fontSize: 'var(--text-base)',
    marginBottom: 'var(--space-md)',
  } as React.CSSProperties,

  card: {
    padding: 'var(--space-xl)',
    background: 'var(--color-bg-base)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
  } as React.CSSProperties,

  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-md)',
  } as React.CSSProperties,

  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  } as React.CSSProperties,

  label: {
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    color: 'var(--color-text-secondary)',
    fontFamily: 'var(--font-body)',
  } as React.CSSProperties,

  input: {
    padding: '10px 12px',
    fontSize: 'var(--text-base)',
    fontFamily: 'var(--font-body)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-input)',
    color: 'var(--color-text-primary)',
    outline: 'none',
    transition: 'border-color var(--transition-fast)',
    boxSizing: 'border-box',
  } as React.CSSProperties,

  textarea: {
    width: '100%',
    padding: '10px 12px',
    fontSize: 'var(--text-base)',
    fontFamily: 'var(--font-body)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-input)',
    color: 'var(--color-text-primary)',
    resize: 'vertical',
    lineHeight: 'var(--leading-normal)',
    boxSizing: 'border-box',
  } as React.CSSProperties,

  hint: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-body)',
  } as React.CSSProperties,

  infoText: {
    fontSize: 'var(--text-base)',
    color: 'var(--color-text-secondary)',
    margin: 0,
    fontFamily: 'var(--font-body)',
  } as React.CSSProperties,

  roleList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-sm)',
  } as React.CSSProperties,

  roleCard: {
    padding: '12px 16px',
    background: 'var(--color-bg-deep)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  } as React.CSSProperties,

  roleName: {
    fontSize: 'var(--text-base)',
    fontWeight: 500,
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-body)',
  } as React.CSSProperties,

  rolePerm: {
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-body)',
  } as React.CSSProperties,

  buttonRow: {
    display: 'flex',
    gap: 'var(--space-sm)',
    marginTop: 'var(--space-lg)',
    alignItems: 'center',
  } as React.CSSProperties,

  primaryBtn: {
    padding: '10px 24px',
    fontSize: 'var(--text-sm)',
    fontFamily: 'var(--font-body)',
    fontWeight: 500,
    borderRadius: 'var(--radius-md)',
    border: 'none',
    background: 'var(--color-accent)',
    color: 'white',
    cursor: 'pointer',
    transition: 'background var(--transition-fast)',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,

  secondaryBtn: {
    padding: '10px 24px',
    fontSize: 'var(--text-sm)',
    fontFamily: 'var(--font-body)',
    fontWeight: 500,
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
};
