import React from 'react';

export interface EntityRowProps {
  initials?: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  badges?: React.ReactNode;
  href?: string;
  style?: React.CSSProperties;
}

export function EntityRow({ initials, title, meta, badges, href, style }: EntityRowProps) {
  const content = (
    <>
      {initials && (
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, var(--cognac-soft, var(--accent-soft)), var(--camel-soft, var(--surface-2)))',
            color: 'var(--cognac-deep, var(--accent))',
            fontSize: 12,
            fontWeight: 550,
            flexShrink: 0,
          }}
        >
          {initials}
        </span>
      )}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', color: 'var(--ink)', fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 400, lineHeight: 1.2 }}>
          {title}
        </span>
        {meta && <span style={{ display: 'block', marginTop: 5, color: 'var(--ink-3)', fontSize: 12 }}>{meta}</span>}
      </span>
      {badges && <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' }}>{badges}</span>}
    </>
  );

  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 16px',
    background: 'var(--surface)',
    border: '1px solid transparent',
    borderRadius: 'var(--radius)',
    boxShadow: 'var(--shadow-sm)',
    color: 'inherit',
    textDecoration: 'none',
    ...style,
  };

  if (href) {
    return <a href={href} style={baseStyle}>{content}</a>;
  }

  return <div style={baseStyle}>{content}</div>;
}
