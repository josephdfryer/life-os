import React from 'react';

export interface PetrolCardProps {
  eyebrow?: string;
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

/** Still's structural dark panel for dashboard summaries and sidebars. */
export function PetrolCard({ eyebrow, title, action, children, style }: PetrolCardProps) {
  return (
    <section style={{ background: 'var(--petrol)', color: '#f7f4ee', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', padding: 24, ...style }}>
      {(eyebrow || title || action) && (
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
          <div>
            {eyebrow && <div style={{ color: 'var(--camel)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>{eyebrow}</div>}
            {title && <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400 }}>{title}</div>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
