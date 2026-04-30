import React from 'react';

export interface StatBlockProps {
  label: string;
  value: string | number;
  accent?: boolean;   // render value in var(--accent)
  large?: boolean;    // use display font at 48px
  style?: React.CSSProperties;
}

/**
 * StatBlock — label + value pair
 * Usage: <StatBlock label="Pipeline Value" value="$1.89M" large accent />
 */
export function StatBlock({ label, value, accent = false, large = false, style }: StatBlockProps) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          letterSpacing: '0.10em',
          color: 'var(--ink-4)',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: large ? 52 : 28,
          fontWeight: 400,
          color: accent ? 'var(--accent)' : 'var(--ink)',
          lineHeight: 1,
        }}
      >
        {value}
      </span>
    </div>
  );
}
