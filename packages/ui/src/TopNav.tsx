import React from 'react';

export interface NavLink {
  label: string;
  href: string;
  active?: boolean;
}

export interface TopNavProps {
  appName: string;
  links?: NavLink[];
  rightSlot?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * TopNav — app name + nav links + right slot
 * Usage:
 *   <TopNav
 *     appName="LifeOS"
 *     links={[{ label: 'CRM', href: '/crm', active: true }, { label: 'Daily', href: '/daily' }]}
 *     rightSlot={<Avatar name="Kenji Lee" size="sm" />}
 *   />
 */
export function TopNav({ appName, links = [], rightSlot, style }: TopNavProps) {
  return (
    <nav
      style={{
        height: 44,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--separator)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 0,
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--ink)',
          letterSpacing: '0.02em',
          flexShrink: 0,
        }}
      >
        {appName}
      </span>

      {links.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginLeft: 24,
            gap: 0,
            height: '100%',
          }}
        >
          {links.map(link => (
            <a
              key={link.href}
              href={link.href}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                color: link.active ? 'var(--ink)' : 'var(--ink-4)',
                textDecoration: 'none',
                padding: '0 14px',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                borderBottom: link.active ? '1px solid var(--accent)' : '1px solid transparent',
                transition: 'color 0.12s',
              }}
            >
              {link.label}
            </a>
          ))}
        </div>
      )}

      {rightSlot && <div style={{ marginLeft: 'auto' }}>{rightSlot}</div>}
    </nav>
  );
}
