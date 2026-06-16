import { useEffect, useRef } from 'react';

export type ConfirmDialogVariant = 'danger' | 'warning' | 'info';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: ConfirmDialogVariant;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  variant = 'danger',
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && confirmButtonRef.current) {
      confirmButtonRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  const variantStyles: Record<ConfirmDialogVariant, React.CSSProperties> = {
    danger: {
      borderColor: 'var(--color-danger)',
      color: 'var(--color-danger)',
    },
    warning: {
      borderColor: 'var(--color-warning)',
      color: 'var(--color-warning)',
    },
    info: {
      borderColor: 'var(--color-accent)',
      color: 'var(--color-accent)',
    },
  };

  const confirmButtonStyle: React.CSSProperties = {
    ...baseButtonStyle,
    ...variantStyles[variant],
    fontWeight: 500,
  };

  const cancelButtonStyle: React.CSSProperties = {
    ...baseButtonStyle,
    borderColor: 'var(--color-border)',
    color: 'var(--color-text-secondary)',
  };

  return (
    <div
      data-testid="confirm-dialog-backdrop"
      onClick={handleBackdropClick}
      style={modalOverlay}
    >
      <div
        data-testid="confirm-dialog-container"
        onClick={(e) => e.stopPropagation()}
        style={modalContainer}
        role="dialog"
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
      >
        <div style={modalHeader}>
          <h2 id="confirm-dialog-title" style={modalTitle}>
            {title}
          </h2>
          <button onClick={onCancel} style={closeButtonStyle} aria-label="Close">
            ×
          </button>
        </div>
        <div style={modalBody}>
          <p style={messageStyle}>{message}</p>
        </div>
        <div style={modalFooter}>
          <button onClick={onCancel} style={cancelButtonStyle}>
            {cancelText}
          </button>
          <button
            ref={confirmButtonRef}
            onClick={onConfirm}
            style={confirmButtonStyle}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

const modalOverlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(20, 20, 19, 0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
};

const modalContainer: React.CSSProperties = {
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  width: '90vw',
  maxWidth: '480px',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
};

const modalHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 20px',
  borderBottom: '1px solid var(--color-border)',
};

const modalTitle: React.CSSProperties = {
  margin: 0,
  fontSize: '16px',
  fontWeight: 500,
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-body)',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--color-text-muted)',
  fontSize: '24px',
  cursor: 'pointer',
  padding: '0',
  lineHeight: 1,
  width: '24px',
  height: '24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalBody: React.CSSProperties = {
  padding: '20px',
};

const messageStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '14px',
  color: 'var(--color-text-secondary)',
  lineHeight: 1.5,
};

const modalFooter: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  padding: '16px 20px',
  borderTop: '1px solid var(--color-border)',
  background: 'var(--color-bg-deep)',
};

const baseButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: '13px',
  fontFamily: 'var(--font-body)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid',
  background: 'transparent',
  cursor: 'pointer',
  transition: 'all var(--transition-fast)',
};
