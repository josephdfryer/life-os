import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * EmptyState — icon + title + subtitle + optional CTA
 * Usage:
 *   <EmptyState
 *     icon="○"
 *     title="No active risks"
 *     subtitle="New items appear here when a dependency gap or decision lag is detected."
 *     action={<Button variant="ghost" size="sm">Refresh</Button>}
 *   />
 */
export function EmptyState({ icon, title, subtitle, action, style }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: '40px 24px',
        textAlign: 'center',
        ...style,
      }}
    >
      {icon && (
        <span style={{ fontSize: 24, color: 'var(--ink-4)', lineHeight: 1 }}>{icon}</span>
      )}
      <span
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          fontWeight: 300,
          color: 'var(--ink-3)',
        }}
      >
        {title}
      </span>
      {subtitle && (
        <span
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            fontWeight: 300,
            color: 'var(--ink-4)',
            lineHeight: 1.7,
            maxWidth: 320,
          }}
        >
          {subtitle}
        </span>
      )}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}
