"use client"

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { LIFE_OS_APPS, type LifeOSAppKey } from './app-registry';
import { AppMark, LifeOSMarkSmall } from './marks';

const COMPACT_CHROME_QUERY = '(max-width: 640px)';

function subscribeCompactChrome(onStoreChange: () => void) {
  const media = window.matchMedia(COMPACT_CHROME_QUERY);
  media.addEventListener('change', onStoreChange);
  return () => media.removeEventListener('change', onStoreChange);
}

function getCompactChromeSnapshot() {
  return window.matchMedia(COMPACT_CHROME_QUERY).matches;
}

function getCompactChromeServerSnapshot() {
  return false;
}

function useCompactChrome() {
  return useSyncExternalStore(
    subscribeCompactChrome,
    getCompactChromeSnapshot,
    getCompactChromeServerSnapshot,
  );
}

const HOME_URL = LIFE_OS_APPS[0].url;
const SHELL_NAV = [
  { label: 'Today', path: '/' },
  { label: 'Inbox', path: '/inbox' },
  { label: 'Intelligence', path: '/intelligence' },
  { label: 'Admin', path: '/admin' },
] as const;

export interface LifeOSBarProps {
  /** Which app is currently rendering the bar. */
  current: LifeOSAppKey;
  /** Optional content pinned to the right (e.g. an avatar). */
  rightSlot?: React.ReactNode;
  /** Signed-in identity shown in the satellite account menu. */
  account?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  /** Satellite sign-out action. Supplied by the shared auth client wrapper. */
  onSignOut?: () => void | Promise<void>;
  /** Home can defer compact-width shell links to a bottom tab bar instead. */
  deferCompactShellNav?: boolean;
  style?: React.CSSProperties;
}

/**
 * LifeOSBar — the shared cross-app chrome strip.
 * Mounts above each app's own header. Home exposes the full control plane;
 * satellite apps collapse those links into one account menu. Hidden on /login.
 *
 *   <LifeOSBar current="persons" />
 */
export function LifeOSBar({ current, rightSlot, account, onSignOut, deferCompactShellNav = false, style }: LifeOSBarProps) {
  const pathname = usePathname();
  const compact = useCompactChrome();
  const [open, setOpen] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
      if (sectionsRef.current && !sectionsRef.current.contains(e.target as Node)) setSectionsOpen(false);
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setSectionsOpen(false);
        setAccountOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Auth entry point, and public shareable profile pages viewed by people
  // outside LifeOS entirely — never show internal OS chrome there.
  if (pathname === '/login' || pathname?.startsWith('/profile/')) return null;

  const currentApp = LIFE_OS_APPS.find(a => a.key === current) ?? LIFE_OS_APPS[0];
  const isHome = current === 'home';
  const captureHref = current === 'home' ? '/#assistant' : `${HOME_URL}/#assistant`;
  const shellHref = (path: string) => current === 'home' ? path : `${HOME_URL}${path}`;
  const collapseHomeNav = isHome && compact && !deferCompactShellNav;
  const activeSection = SHELL_NAV.find(item =>
    item.path === '/' ? pathname === '/' : pathname.startsWith(item.path),
  );

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 60,
        minHeight: 40,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-subtle, var(--border, rgba(0,0,0,0.08)))',
        display: 'flex',
        alignItems: 'center',
        padding: compact ? '0 12px' : '0 16px',
        gap: compact ? 8 : 10,
        fontFamily: 'var(--font-body, system-ui)',
        ...style,
      }}
    >
      {/* Brand → Home (the one-click "go home") */}
      <a
        href={HOME_URL}
        aria-label="Go to LifeOS Home"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          textDecoration: 'none',
          color: 'var(--ink, #1a1814)',
          flexShrink: 0,
        }}
      >
        <LifeOSMarkSmall size={15} style={{ color: 'var(--cognac, var(--accent, #8f6b4a))', display: 'block', flexShrink: 0 }} />
        {!compact && (
          <span style={{ fontFamily: 'var(--font-display, serif)', fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em' }}>
            LifeOS
          </span>
        )}
      </a>

      <span
        aria-hidden
        style={{
          color: 'var(--ink-4, #b8b2a8)',
          fontSize: 12,
          flexShrink: 0,
          display: compact ? 'none' : 'inline',
        }}
      >
        /
      </span>

      {/* App switcher */}
      <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => setOpen(o => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '4px 9px',
            borderRadius: 'var(--radius-pill, 999px)',
            border: '1px solid transparent',
            background: open ? 'var(--cognac-soft, var(--accent-soft, rgba(181,131,90,0.12)))' : 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 13,
            color: 'var(--ink-2, var(--ink, #1a1814))',
            transition: 'background 0.12s',
          }}
          onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.03))'; }}
          onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent'; }}
        >
          <AppMark app={currentApp.key} size={13} style={{ color: currentApp.accent, display: 'block', flexShrink: 0 }} />
          <span style={{ fontWeight: 500 }}>{currentApp.label}</span>
          <span aria-hidden style={{ fontSize: 9, opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
        </button>

        {open && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              minWidth: 232,
              background: 'var(--surface, #fff)',
              border: '1px solid var(--border-subtle, var(--border, rgba(0,0,0,0.08)))',
              borderRadius: 12,
              padding: 6,
              boxShadow: '0 8px 28px rgba(26,24,20,0.14)',
              zIndex: 100,
            }}
          >
            <div style={{ padding: '4px 8px 6px', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4, #b8b2a8)' }}>
              LifeOS apps
            </div>
            {LIFE_OS_APPS.map(app => {
              const active = app.key === current;
              return (
                <a
                  key={app.key}
                  href={app.url}
                  role="menuitem"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 8px',
                    borderRadius: 8,
                    textDecoration: 'none',
                    background: active ? 'var(--cognac-soft, var(--accent-soft, rgba(181,131,90,0.12)))' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.03))'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <AppMark app={app.key} size={17} style={{ color: app.accent, display: 'block', flexShrink: 0 }} />
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: active ? 'var(--cognac-deep, var(--accent, #8a5a2f))' : 'var(--ink, #1a1814)' }}>
                      {app.label}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--ink-4, #b8b2a8)' }}>{app.blurb}</span>
                  </span>
                  {active && (
                    <span aria-hidden style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--cognac, var(--accent, #b5835a))' }}>●</span>
                  )}
                </a>
              );
            })}
          </div>
        )}
      </div>

      {isHome && collapseHomeNav && (
        <div ref={sectionsRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            aria-label="Open LifeOS sections"
            aria-haspopup="menu"
            aria-expanded={sectionsOpen}
            onClick={() => setSectionsOpen(value => !value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 'var(--radius-pill, 999px)',
              border: sectionsOpen
                ? '1px solid var(--cognac-soft, rgba(181,131,90,0.35))'
                : '1px solid var(--border-subtle, var(--border, rgba(0,0,0,0.08)))',
              background: sectionsOpen ? 'var(--cognac-soft, rgba(181,131,90,0.12))' : 'transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 12,
              color: 'var(--ink-2, #524a42)',
              maxWidth: 132,
            }}
          >
            <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>☰</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeSection?.label ?? 'Sections'}
            </span>
          </button>

          {sectionsOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: 0,
                minWidth: 220,
                background: 'var(--surface, #fff)',
                border: '1px solid var(--border-subtle, var(--border, rgba(0,0,0,0.08)))',
                borderRadius: 12,
                padding: 6,
                boxShadow: '0 8px 28px rgba(26,24,20,0.14)',
                zIndex: 100,
              }}
            >
              {SHELL_NAV.map(item => {
                const active = item.path === '/' ? pathname === '/' : pathname.startsWith(item.path);
                return (
                  <a
                    key={item.path}
                    href={shellHref(item.path)}
                    role="menuitem"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setSectionsOpen(false)}
                    style={{
                      ...accountLinkStyle,
                      borderRadius: 8,
                      color: active ? 'var(--cognac-deep, #8a5a2f)' : accountLinkStyle.color,
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {item.label}
                  </a>
                );
              })}
              <a
                href={captureHref}
                role="menuitem"
                onClick={() => setSectionsOpen(false)}
                style={{ ...accountLinkStyle, borderRadius: 8, marginTop: 4, borderTop: '1px solid var(--border-subtle, rgba(0,0,0,0.08))', paddingTop: 10 }}
              >
                Capture
              </a>
            </div>
          )}
        </div>
      )}

      {isHome && !collapseHomeNav && (
        <>
          <nav
            aria-label="LifeOS sections"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              flex: 1,
              minWidth: 0,
              overflowX: 'auto',
              scrollbarWidth: 'none',
            }}
          >
            {SHELL_NAV.map(item => {
              const active = item.path === '/' ? pathname === '/' : pathname.startsWith(item.path);
              return (
                <a
                  key={item.path}
                  href={shellHref(item.path)}
                  aria-current={active ? 'page' : undefined}
                  style={{
                    flexShrink: 0,
                    padding: '5px 9px',
                    borderRadius: 'var(--radius-pill, 999px)',
                    background: active ? 'var(--cognac-soft, rgba(181,131,90,0.12))' : 'transparent',
                    color: active ? 'var(--cognac-deep, var(--ink-2, #524a42))' : 'var(--ink-3, #7a7268)',
                    fontSize: 12,
                    fontWeight: active ? 500 : 400,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>

          <a
            href={captureHref}
            aria-label="Quick capture"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
              padding: '4px 10px',
              border: '1px solid var(--border-subtle, var(--border, rgba(0,0,0,0.08)))',
              borderRadius: 'var(--radius-pill, 999px)',
              color: 'var(--cognac-deep, var(--accent, #8a5a2f))',
              fontSize: 12,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            <span aria-hidden>＋</span>
            <span>Capture</span>
          </a>
        </>
      )}

      <div ref={accountRef} style={{ marginLeft: 'auto', position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            aria-label="Open LifeOS account menu"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen(value => !value)}
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              padding: 2,
              border: accountOpen ? '1px solid var(--cognac, #8f6b4a)' : '1px solid var(--border-subtle, var(--border, rgba(0,0,0,0.08)))',
              background: 'var(--surface-2, #efe9df)',
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
              overflow: 'hidden',
            }}
          >
            {account?.image ? (
              // Plain <img>, not next/image: packages/ui is shared across apps and
              // must not take a Next runtime dependency. No eslint-disable needed —
              // @next/next is only registered for apps/** and no-img-element is off.
              <img src={account.image} alt="" width={24} height={24} style={{ borderRadius: '50%', display: 'block' }} />
            ) : (
              <span aria-hidden style={{ fontSize: 11, color: 'var(--ink-3, #7a7268)', fontWeight: 500 }}>
                {(account?.name?.trim() || account?.email?.trim() || 'You').slice(0, 1).toUpperCase()}
              </span>
            )}
          </button>

          {accountOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 7px)',
                right: 0,
                width: 244,
                background: 'var(--surface, #fff)',
                border: '1px solid var(--border-subtle, var(--border, rgba(0,0,0,0.08)))',
                borderRadius: 12,
                padding: 6,
                boxShadow: '0 8px 28px rgba(26,24,20,0.14)',
                zIndex: 100,
              }}
            >
              {(account?.name || account?.email) && (
                <div style={{ padding: '7px 9px 8px', borderBottom: '1px solid var(--border-subtle, rgba(0,0,0,0.08))', marginBottom: 5 }}>
                  {account?.name && <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink, #2c2620)' }}>{account.name}</div>}
                  {account?.email && <div style={{ fontSize: 10, color: 'var(--ink-4, #a69c90)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.email}</div>}
                </div>
              )}

              {/* Home already shows these as top-level nav links — only the
                  satellite apps collapse them into this menu instead. */}
              {!isHome && (
                <>
                  {SHELL_NAV.map(item => (
                    <a key={item.path} href={shellHref(item.path)} role="menuitem" onClick={() => setAccountOpen(false)} style={accountLinkStyle}>
                      {item.label}
                    </a>
                  ))}
                  <a href={captureHref} role="menuitem" onClick={() => setAccountOpen(false)} style={accountLinkStyle}>Capture</a>
                </>
              )}

              {onSignOut && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onSignOut()}
                  style={{ ...accountLinkStyle, width: '100%', border: 'none', borderTop: '1px solid var(--border-subtle, rgba(0,0,0,0.08))', borderRadius: 0, marginTop: 5, paddingTop: 10, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Sign out
                </button>
              )}
            </div>
          )}
      </div>

      {rightSlot && <div style={{ display: 'flex', alignItems: 'center' }}>{rightSlot}</div>}
    </div>
  );
}

const accountLinkStyle: React.CSSProperties = {
  display: 'block',
  padding: '8px 9px',
  borderRadius: 7,
  background: 'transparent',
  color: 'var(--ink-2, #524a42)',
  fontSize: 12,
  textAlign: 'left',
  textDecoration: 'none',
};
