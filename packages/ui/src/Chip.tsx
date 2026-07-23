import React from 'react';

export type ChipVariant = 'default' | 'accent' | 'removable';

export interface ChipProps {
  label: string;
  variant?: ChipVariant;
  onClick?: () => void;
  onRemove?: () => void;
  style?: React.CSSProperties;
}

/**
 * Chip — clickable or static tag
 * Usage: <Chip label="decision lag" variant="accent" />
 *        <Chip label="owner: KL" variant="removable" onRemove={() => {}} />
 */
export function Chip({ label, variant = 'default', onClick, onRemove, style }: ChipProps) {
  const isAccent = variant === 'accent';
  const clickable = !!onClick || variant === 'removable';

  return (
    <span
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-body)',
        fontSize: 11,
        padding: '3px 9px',
        borderRadius: 'var(--radius-pill)',
        border: '1px solid var(--border)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        color: isAccent ? 'var(--accent)' : 'var(--ink-4)',
        background: isAccent ? 'var(--accent-soft)' : 'transparent',
        cursor: clickable ? 'pointer' : 'default',
        userSelect: 'none',
        transition: 'border-color 0.12s',
        ...style,
      }}
      onMouseEnter={e => clickable && ((e.currentTarget as HTMLElement).style.borderColor = 'var(--ink-4)')}
      onMouseLeave={e => clickable && ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border)')}
    >
      {label}
      {variant === 'removable' && (
        <span
          onClick={e => { e.stopPropagation(); onRemove?.(); }}
          style={{ color: 'var(--ink-4)', fontSize: 12, lineHeight: 1, cursor: 'pointer' }}
        >
          ×
        </span>
      )}
    </span>
  );
}
