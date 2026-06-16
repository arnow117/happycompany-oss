import { render, screen } from '@testing-library/react';
import { LoadingSkeleton } from './LoadingSkeleton';

describe('LoadingSkeleton', () => {
  test('renders card skeleton by default', () => {
    render(<LoadingSkeleton type="card" />);
    expect(screen.getByTestId('skeleton-card')).toBeInTheDocument();
  });

  test('renders table row skeleton', () => {
    render(<LoadingSkeleton type="table-row" />);
    expect(screen.getByTestId('skeleton-table-row')).toBeInTheDocument();
  });

  test('renders text line skeleton', () => {
    render(<LoadingSkeleton type="text-line" />);
    expect(screen.getByTestId('skeleton-text-line')).toBeInTheDocument();
  });

  test('applies custom width to text line', () => {
    render(<LoadingSkeleton type="text-line" width="200px" />);
    const skeleton = screen.getByTestId('skeleton-text-line');
    expect(skeleton).toHaveStyle({ width: '200px' });
  });

  test('renders multiple items with count prop', () => {
    const { container } = render(<LoadingSkeleton type="table-row" count={3} />);
    const skeletons = container.querySelectorAll('[data-testid^="skeleton-"]');
    expect(skeletons.length).toBe(3);
  });

  test('card skeleton has proper structure', () => {
    const { container } = render(<LoadingSkeleton type="card" />);
    const card = screen.getByTestId('skeleton-card');
    expect(card).toBeInTheDocument();
    expect(card.children.length).toBeGreaterThan(0);
  });

  test('table row skeleton has proper structure', () => {
    const { container } = render(<LoadingSkeleton type="table-row" />);
    const row = screen.getByTestId('skeleton-table-row');
    expect(row).toBeInTheDocument();
    const cells = container.querySelectorAll('[data-testid^="skeleton-"]');
    expect(cells.length).toBeGreaterThan(0);
  });

  test('applies custom height', () => {
    render(<LoadingSkeleton type="text-line" height="40px" />);
    const skeleton = screen.getByTestId('skeleton-text-line');
    expect(skeleton).toHaveStyle({ height: '40px' });
  });

  test('has shimmer animation class', () => {
    render(<LoadingSkeleton type="text-line" />);
    const skeleton = screen.getByTestId('skeleton-text-line');
    expect(skeleton).toHaveClass('skeleton-shimmer');
  });
});
