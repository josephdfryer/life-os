import React from 'react';

export interface CardProps {
  title?: string;
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
}

/**
 * Card — surface with border, optional header and footer
 * Usage:
 *   <Card title="Meridian Group" headerAction={<Button size="sm" variant="ghost">Edit</Button>}>
 *     <p>…</p>
 *   </Card>
 */
export function Card({ title, headerAction, footer, children, style, bodyStyle }: CardProps) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border-subtle, var(--border))',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {(title || headerAction) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px 0',
            gap: 12,
          }}
        >
          {title && (
            <span
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 11,
                letterSpacing: '0.1em',
                color: 'var(--ink-4)',
                textTransform: 'uppercase',
              }}
            >
              {title}
            </span>
          )}
          {headerAction && <div style={{ marginLeft: 'auto' }}>{headerAction}</div>}
        </div>
      )}

      <div style={{ padding: title || headerAction ? '14px 20px 20px' : '22px 24px', flex: 1, ...bodyStyle }}>{children}</div>

      {footer && (
        <div
          style={{
            borderTop: '1px solid var(--border-subtle, var(--border))',
            padding: '12px 20px',
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
