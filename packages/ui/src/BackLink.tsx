import React from 'react';

export interface BackLinkProps {
  label: string;
  href: string;
  /** Override the rendered element — pass `Link` from next/link for soft navigation */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: React.ElementType<any>;
  style?: React.CSSProperties;
}

/**
 * BackLink — "← label" navigation
 * Usage: <BackLink label="All Accounts" href="/crm/accounts" />
 *        <BackLink label="All Accounts" href="/crm/accounts" component={Link} />  // next/link
 */
export function BackLink({ label, href, component: Component = 'a', style }: BackLinkProps) {
  return (
    <Component
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
      onMouseEnter={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.color = 'var(--ink-2)')}
      onMouseLeave={(e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.color = 'var(--ink-4)')}
    >
      ←&nbsp;{label}
    </Component>
  );
}
