import React from 'react';

export type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'muted';

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  default: { color: 'var(--ink-4)',  background: 'var(--surface)' },
  accent:  { color: 'var(--accent)', background: 'var(--accent-soft)' },
  success: { color: 'var(--status-done)', background: '#1A1916' },
  warning: { color: 'var(--status-watch-text)', background: 'var(--status-watch-bg)' },
  muted:   { color: 'var(--ink-4)', background: 'var(--status-pending-bg)' },
};

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: React.CSSProperties;
}

/**
 * Badge — small status label
 * Usage: <Badge label="blocked" variant="accent" />
 */
export function Badge({ label, variant = 'default', style }: BadgeProps) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 8,
        letterSpacing: '0.06em',
        padding: '3px 8px',
        display: 'inline-block',
        whiteSpace: 'nowrap',
        textTransform: 'lowercase',
        ...variantStyles[variant],
        ...style,
      }}
    >
      {label}
    </span>
  );
}
