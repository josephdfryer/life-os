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
  brandHref?: string;
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
export function TopNav({ appName, links = [], rightSlot, style, brandHref }: TopNavProps) {
  const BrandTag = brandHref ? 'a' : 'span';

  return (
    <nav
      style={{
        height: 'var(--nav-height, 52px)',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-subtle, var(--separator))',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: 24,
        overflowX: 'auto',
        ...style,
      }}
    >
      <BrandTag
        href={brandHref as never}
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 17,
          fontWeight: 400,
          color: 'var(--ink)',
          flexShrink: 0,
          textDecoration: 'none',
        }}
      >
        {appName}
      </BrandTag>

      {links.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            minWidth: 0,
          }}
        >
          {links.map(link => (
            <a
              key={link.href}
              href={link.href}
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                color: link.active ? 'var(--cognac-deep, var(--accent))' : 'var(--ink-3)',
                background: link.active ? 'var(--cognac-soft, var(--accent-soft))' : 'transparent',
                textDecoration: 'none',
                padding: '6px 14px',
                borderRadius: 'var(--radius-pill)',
                display: 'flex',
                alignItems: 'center',
                whiteSpace: 'nowrap',
                fontWeight: link.active ? 450 : 400,
                transition: 'background 0.12s, color 0.12s',
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
