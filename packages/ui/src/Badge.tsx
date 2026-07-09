import React from 'react';

export type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'muted';

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  default: { color: 'var(--cognac-deep, var(--accent))', background: 'var(--cognac-soft, var(--accent-soft))' },
  accent:  { color: '#7a6040', background: 'var(--camel-soft, var(--accent-soft))' },
  success: { color: 'var(--success)', background: 'var(--success-soft, var(--surface-2))' },
  warning: { color: 'var(--attention, var(--status-watch-text))', background: 'var(--attention-soft, var(--status-watch-bg))' },
  muted:   { color: 'var(--ink-3)', background: 'var(--surface-2, var(--status-pending-bg))' },
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
        fontFamily: 'var(--font-body)',
        fontSize: 11,
        padding: '3px 10px',
        borderRadius: 'var(--radius-pill)',
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 22,
        whiteSpace: 'nowrap',
        ...variantStyles[variant],
        ...style,
      }}
    >
      {label}
    </span>
  );
}
