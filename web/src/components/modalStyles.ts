export const modalOverlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(20, 20, 19, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
};

export const modalContainer: React.CSSProperties = {
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  width: '90vw',
  maxWidth: '720px',
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxShadow: 'var(--shadow-card-hover)',
};

export const modalHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 24px',
  borderBottom: '1px solid var(--color-border)',
};

export const modalTitle: React.CSSProperties = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 500,
  letterSpacing: '0',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-body)',
};

export const modalCloseBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--color-text-muted)',
  fontSize: '20px',
  cursor: 'pointer',
  padding: '4px 8px',
  lineHeight: 1,
};

export const modalBody: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '24px',
};

export const codeBlockStyle: React.CSSProperties = {
  background: 'var(--color-surface-dark)',
  borderRadius: 'var(--radius-md)',
  padding: '20px',
  fontFamily: 'var(--font-mono)',
  fontSize: '13px',
  lineHeight: 1.6,
  color: 'var(--color-on-dark)',
  overflow: 'auto',
};

export const mutedText: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  fontSize: '14px',
  textAlign: 'center',
  padding: '32px 0',
};

export const errorText: React.CSSProperties = {
  color: 'var(--color-danger)',
  fontSize: '14px',
  textAlign: 'center',
  padding: '32px 0',
};
