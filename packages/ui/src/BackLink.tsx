import React from 'react';

export interface BackLinkProps {
  label: string;
  href: string;
  style?: React.CSSProperties;
}

/**
 * BackLink — "← label" navigation
 * Usage: <BackLink label="All Accounts" href="/crm/accounts" />
 */
export function BackLink({ label, href, style }: BackLinkProps) {
  return (
    <a
      href={href}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        letterSpacing: '0.10em',
        textTransform: 'uppercase',
        color: 'var(--ink-4)',
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        transition: 'color 0.12s',
        ...style,
      }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--ink-2)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--ink-4)')}
    >
      ←&nbsp;{label}
    </a>
  );
}
