export type SkeletonType = 'card' | 'table-row' | 'text-line';

interface LoadingSkeletonProps {
  type: SkeletonType;
  count?: number;
  width?: string;
  height?: string;
}

export function LoadingSkeleton({
  type,
  count = 1,
  width,
  height,
}: LoadingSkeletonProps) {
  const skeletons = Array.from({ length: count }, (_, i) => (
    <LoadingSkeletonItem key={i} type={type} width={width} height={height} />
  ));

  return <>{skeletons}</>;
}

interface LoadingSkeletonItemProps {
  type: SkeletonType;
  width?: string;
  height?: string;
}

function LoadingSkeletonItem({ type, width, height }: LoadingSkeletonItemProps) {
  const baseStyle: React.CSSProperties = {
    background: 'var(--color-bg-deep)',
    borderRadius: 'var(--radius-sm)',
    position: 'relative',
    overflow: 'hidden',
  };

  const shimmerStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.05), transparent)',
    animation: 'shimmer 1.5s infinite',
  };

  switch (type) {
    case 'card':
      return (
        <div
          data-testid="skeleton-card"
          style={{
            ...baseStyle,
            width: '100%',
            minHeight: '120px',
            padding: '16px',
          }}
        >
          <div
            style={{
              ...skeletonLine,
              height: '24px',
              width: '60%',
              marginBottom: '12px',
            }}
          >
            <div style={shimmerStyle} />
          </div>
          <div
            style={{
              ...skeletonLine,
              height: '14px',
              width: '40%',
              marginBottom: '8px',
            }}
          >
            <div style={shimmerStyle} />
          </div>
          <div
            style={{
              ...skeletonLine,
              height: '14px',
              width: '80%',
            }}
          >
            <div style={shimmerStyle} />
          </div>
        </div>
      );

    case 'table-row':
      return (
        <div
          data-testid="skeleton-table-row"
          style={{
            ...baseStyle,
            display: 'flex',
            gap: '12px',
            padding: '12px 16px',
            width: '100%',
            height: '44px',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              ...skeletonLine,
              flex: 2,
              height: '14px',
            }}
          >
            <div style={shimmerStyle} />
          </div>
          <div
            style={{
              ...skeletonLine,
              flex: 1,
              height: '14px',
            }}
          >
            <div style={shimmerStyle} />
          </div>
          <div
            style={{
              ...skeletonLine,
              flex: 3,
              height: '14px',
            }}
          >
            <div style={shimmerStyle} />
          </div>
          <div
            style={{
              ...skeletonLine,
              width: '60px',
              height: '24px',
              borderRadius: 'var(--radius-pill)',
            }}
          >
            <div style={shimmerStyle} />
          </div>
        </div>
      );

    case 'text-line':
      return (
        <div
          data-testid="skeleton-text-line"
          className="skeleton-shimmer"
          style={{
            ...baseStyle,
            width: width || '100%',
            height: height || '14px',
          }}
        >
          <div style={shimmerStyle} />
        </div>
      );

    default:
      return null;
  }
}

const skeletonLine: React.CSSProperties = {
  position: 'relative',
  background: 'var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  overflow: 'hidden',
};

// Add CSS keyframes for shimmer animation
const style = document.createElement('style');
style.textContent = `
  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }
  .skeleton-shimmer::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08), transparent);
    animation: shimmer 1.5s infinite;
  }
`;
if (!document.head.querySelector('[data-skeleton-styles]')) {
  style.setAttribute('data-skeleton-styles', 'true');
  document.head.appendChild(style);
}
