import React from 'react';
import { TopNav, type NavLink } from './TopNav';

export interface AppShellProps {
  appName: string;
  links?: NavLink[];
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
  brandHref?: string;
  mainStyle?: React.CSSProperties;
}

export function AppShell({ appName, links, rightSlot, children, brandHref, mainStyle }: AppShellProps) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <TopNav appName={appName} links={links} rightSlot={rightSlot} brandHref={brandHref} />
      <main style={{ flex: 1, overflowY: 'auto', ...mainStyle }}>{children}</main>
    </div>
  );
}
