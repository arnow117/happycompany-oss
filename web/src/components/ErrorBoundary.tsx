import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <section style={{ padding: '48px', textAlign: 'center' }}>
          <h2 style={{ fontSize: '20px', color: 'var(--color-danger)', marginBottom: '16px' }}>
            页面加载出错
          </h2>
          <pre style={{
            fontSize: '13px', color: 'var(--color-text-muted)', background: 'var(--color-bg-base)',
            padding: '16px', borderRadius: '8px', textAlign: 'left', maxWidth: '600px',
            margin: '0 auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: '16px', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer',
              border: '1px solid var(--color-border)', background: 'var(--color-bg-base)',
              color: 'var(--color-text-primary)', fontSize: '14px',
            }}
          >
            重试
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
