import { Check, Loader2 } from 'lucide-react';

interface TodoItem {
  id: string;
  content: string;
  status: string;
}

interface TodoProgressPanelProps {
  todos: TodoItem[];
}

export function TodoProgressPanel({ todos }: TodoProgressPanelProps) {
  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div
      className="rounded-lg p-3 mb-2"
      style={{
        background: 'rgba(204, 120, 92, 0.05)',
        border: '1px solid rgba(204, 120, 92, 0.15)',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-medium" style={{ color: 'var(--color-accent)' }}>
          {completed}/{total} 已完成
        </span>
        <span className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
          {Math.round(progress)}%
        </span>
      </div>
      <div
        className="h-1.5 rounded-full mb-2.5 overflow-hidden"
        style={{ background: 'rgba(204, 120, 92, 0.1)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${progress}%`, background: 'var(--color-accent)' }}
        />
      </div>
      <div className="space-y-1">
        {todos.map((todo) => (
          <div key={todo.id} className="flex items-start gap-2 text-[13px]">
            <span className="flex-shrink-0 mt-0.5">
              {todo.status === 'completed' ? (
                <Check className="w-3.5 h-3.5" style={{ color: 'var(--color-accent)' }} strokeWidth={3} />
              ) : todo.status === 'in_progress' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--color-accent)' }} />
              ) : (
                <svg className="w-3.5 h-3.5" style={{ color: 'var(--color-text-muted)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                </svg>
              )}
            </span>
            <span
              className="break-words"
              style={{
                color: todo.status === 'completed'
                  ? 'var(--color-text-muted)'
                  : todo.status === 'in_progress'
                    ? 'var(--color-accent)'
                    : 'var(--color-text-primary)',
                fontWeight: todo.status === 'in_progress' ? 500 : 400,
                textDecoration: todo.status === 'completed' ? 'line-through' : 'none',
              }}
            >
              {todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
