import React from 'react';

export interface SectionHeaderProps {
  label: string;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * SectionHeader — uppercase mono label + optional right action
 * Usage: <SectionHeader label="Accounts" action={<Button size="sm" variant="ghost">+ Add</Button>} />
 */
export function SectionHeader({ label, action, style }: SectionHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 18,
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          letterSpacing: '0.14em',
          color: '#8A8278',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--separator)' }} />
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
