import React from 'react';

export interface StillPageProps {
  children: React.ReactNode;
  sidebar?: React.ReactNode;
  style?: React.CSSProperties;
}

export function StillPage({ children, sidebar, style }: StillPageProps) {
  return (
    <div
      style={{
        width: 'min(100%, var(--content-max, 1100px))',
        margin: '0 auto',
        padding: '36px 24px 48px',
        ...style,
      }}
    >
      {sidebar ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 288px', gap: 32, alignItems: 'start' }}>
          <section>{children}</section>
          <aside style={{ display: 'grid', gap: 14 }}>{sidebar}</aside>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
