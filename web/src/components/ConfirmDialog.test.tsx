import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    title: 'Delete Item',
    message: 'Are you sure you want to delete this item?',
    confirmText: 'Delete',
    cancelText: 'Cancel',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    variant: 'danger' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders when open', () => {
    render(<ConfirmDialog {...defaultProps} />);
    expect(screen.getByText('Delete Item')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to delete this item?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  test('does not render when closed', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('Delete Item')).not.toBeInTheDocument();
  });

  test('calls onConfirm when confirm button is clicked', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  test('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  test('calls onCancel when ESC key is pressed', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} />);

    await user.keyboard('{Escape}');
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  test('calls onCancel when backdrop is clicked', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} />);

    const backdrop = screen.getByTestId('confirm-dialog-backdrop');
    await user.click(backdrop);
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  test('does not call onCancel when dialog content is clicked', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} />);

    const dialog = screen.getByTestId('confirm-dialog-container');
    await user.click(dialog);
    expect(defaultProps.onCancel).not.toHaveBeenCalled();
  });

  test('applies danger variant styling', () => {
    render(<ConfirmDialog {...defaultProps} variant="danger" />);
    const confirmBtn = screen.getByRole('button', { name: 'Delete' });
    expect(confirmBtn).toHaveAttribute('style');
    expect(confirmBtn.getAttribute('style')).toContain('border');
  });

  test('applies warning variant styling', () => {
    render(<ConfirmDialog {...defaultProps} variant="warning" />);
    const confirmBtn = screen.getByRole('button', { name: 'Delete' });
    expect(confirmBtn).toHaveAttribute('style');
    expect(confirmBtn.getAttribute('style')).toContain('border');
  });

  test('applies info variant styling', () => {
    render(<ConfirmDialog {...defaultProps} variant="info" />);
    const confirmBtn = screen.getByRole('button', { name: 'Delete' });
    expect(confirmBtn).toHaveAttribute('style');
    expect(confirmBtn.getAttribute('style')).toContain('border');
  });

  test('renders custom button text', () => {
    render(
      <ConfirmDialog
        {...defaultProps}
        confirmText="Yes, delete it"
        cancelText="No, keep it"
      />,
    );
    expect(screen.getByRole('button', { name: 'Yes, delete it' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No, keep it' })).toBeInTheDocument();
  });

  test('focuses confirm button on mount', () => {
    render(<ConfirmDialog {...defaultProps} />);
    const confirmBtn = screen.getByRole('button', { name: 'Delete' });
    expect(confirmBtn).toHaveFocus();
  });
});
