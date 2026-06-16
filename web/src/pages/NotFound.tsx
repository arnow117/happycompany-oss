import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div style={{ textAlign: 'center', paddingTop: '120px' }}>
      <h1 style={{ fontSize: '72px', fontWeight: 600, fontFamily: 'var(--font-display)', color: 'var(--color-on-dark-soft)', margin: 0 }}>404</h1>
      <p style={{ fontSize: '16px', color: 'var(--color-on-dark-soft)', marginTop: '16px' }}>页面未找到</p>
      <Link to="/" style={{ display: 'inline-block', marginTop: '24px', color: 'var(--color-accent)', fontSize: '14px', textDecoration: 'none' }}>返回首页</Link>
    </div>
  );
}
