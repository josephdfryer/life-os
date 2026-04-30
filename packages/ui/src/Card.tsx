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
        border: '1px solid var(--border)',
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
            padding: '12px 16px',
            borderBottom: '1px solid var(--separator)',
            gap: 12,
          }}
        >
          {title && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.14em',
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

      <div style={{ padding: '16px', flex: 1, ...bodyStyle }}>{children}</div>

      {footer && (
        <div
          style={{
            borderTop: '1px solid var(--separator)',
            padding: '10px 16px',
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
