import React from 'react';

export interface DividerProps {
  label?: string;
  style?: React.CSSProperties;
}

/**
 * Divider — horizontal rule with optional label
 * Usage: <Divider />
 *        <Divider label="THIS WEEK" />
 */
export function Divider({ label, style }: DividerProps) {
  if (!label) {
    return (
      <div
        style={{
          width: '100%',
          height: 1,
          background: 'var(--separator)',
          ...style,
        }}
      />
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        ...style,
      }}
    >
      <div style={{ flex: 1, height: 1, background: 'var(--separator)' }} />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 8,
          letterSpacing: '0.14em',
          color: 'var(--ink-4)',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--separator)' }} />
    </div>
  );
}
