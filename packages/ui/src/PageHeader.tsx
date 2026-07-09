import React from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
}

export function PageHeader({ title, subtitle, actions, style }: PageHeaderProps) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 24,
        marginBottom: 24,
        ...style,
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            color: 'var(--ink)',
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            fontWeight: 400,
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
          }}
        >
          {title}
        </h1>
        {subtitle && <div style={{ marginTop: 6, color: 'var(--ink-3)', fontSize: 13 }}>{subtitle}</div>}
      </div>
      {actions && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>{actions}</div>}
    </header>
  );
}
