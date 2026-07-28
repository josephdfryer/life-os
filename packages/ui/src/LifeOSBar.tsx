"use client"

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export type LifeOSAppKey =
  | 'home'
  | 'persons'
  | 'events'
  | 'places'
  | 'stuff'
  | 'context'
  | 'assistant'
  | 'levelUp';

export interface LifeOSAppEntry {
  key: LifeOSAppKey;
  label: string;
  url: string;
  dot: string;
  blurb: string;
}

// Self-contained registry (no server imports) so this stays a pure client
// component. URLs are the stable production subdomains; keep in sync with
// LIFE_OS_APP_URLS in packages/auth.
export const LIFE_OS_APPS: LifeOSAppEntry[] = [
  { key: 'home',      label: 'Home',      url: 'https://home.lacollecteur.com',      dot: '#8a7a66', blurb: 'Your daily overview' },
  { key: 'persons',   label: 'Persons',   url: 'https://persons.lacollecteur.com',   dot: '#b5835a', blurb: 'People & relationships' },
  { key: 'events',    label: 'Events',    url: 'https://events.lacollecteur.com',    dot: '#6a8caf', blurb: 'Calendar & plans' },
  { key: 'places',    label: 'Places',    url: 'https://places.lacollecteur.com',    dot: '#6f9a7b', blurb: 'Your map of memory' },
  { key: 'stuff',     label: 'Stuff',     url: 'https://stuff.lacollecteur.com',     dot: '#a98a5c', blurb: 'Everything you own' },
  { key: 'context',   label: 'Context',   url: 'https://context.lacollecteur.com',   dot: '#9a7ba0', blurb: 'Theory of a person' },
  { key: 'assistant', label: 'Assistant', url: 'https://assistant.lacollecteur.com', dot: '#c08b6f', blurb: 'Chat & actions' },
  { key: 'levelUp',   label: 'Level Up',   url: 'https://level-up.lacollecteur.com',  dot: '#c4522a', blurb: 'IRL player ratings' },
];

const HOME_URL = LIFE_OS_APPS[0].url;

export interface LifeOSBarProps {
  /** Which app is currently rendering the bar. */
  current: LifeOSAppKey;
  /** Optional content pinned to the right (e.g. an avatar). */
  rightSlot?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * LifeOSBar — the shared cross-app chrome strip.
 * Mounts above each app's own header. Gives every Life OS app a one-click
 * link back to Home plus an app switcher to jump anywhere. Hidden on /login.
 *
 *   <LifeOSBar current="persons" />
 */
export function LifeOSBar({ current, rightSlot, style }: LifeOSBarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Auth entry point — never show OS chrome there.
  if (pathname === '/login') return null;

  const currentApp = LIFE_OS_APPS.find(a => a.key === current) ?? LIFE_OS_APPS[0];
  const captureHref = current === 'home' ? '#quick-capture' : `${HOME_URL}/#quick-capture`;

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 60,
        height: 40,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-subtle, var(--border, rgba(0,0,0,0.08)))',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 10,
        fontFamily: 'var(--font-body, system-ui)',
        ...style,
      }}
    >
      {/* Brand → Home (the one-click "go home") */}
      <a
        href={HOME_URL}
        aria-label="Go to Life OS Home"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          textDecoration: 'none',
          color: 'var(--ink, #1a1814)',
          flexShrink: 0,
        }}
      >
        <span aria-hidden style={{ fontSize: 12, color: 'var(--cognac, var(--accent, #b5835a))', lineHeight: 1 }}>◇</span>
        <span style={{ fontFamily: 'var(--font-display, serif)', fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em' }}>
          Life OS
        </span>
      </a>

      <span aria-hidden style={{ color: 'var(--ink-4, #b8b2a8)', fontSize: 12 }}>/</span>

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
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: currentApp.dot, flexShrink: 0 }} />
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
              Life OS apps
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
                  <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: app.dot, flexShrink: 0 }} />
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

      <a
        href={captureHref}
        aria-label="Quick capture"
        style={{
          marginLeft: 'auto',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
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

      {rightSlot && <div style={{ display: 'flex', alignItems: 'center' }}>{rightSlot}</div>}
    </div>
  );
}
