/**
 * Warm Concrete — Design Tokens
 * CSS custom property names, typed as constants.
 * Reference these in React inline styles via `var(TOKEN.xxx)`.
 *
 * Apps must define these variables at :root (or on a top-level wrapper).
 * A reference theme is exported at the bottom as `warmConcreteTheme`.
 */

export const TOKEN = {
  // ── Surfaces ──────────────────────────────────────────────────────
  bg:          '--bg',           // outermost canvas      #1E1C18
  surface:     '--surface',      // panels / cards        #181612
  surfaceRaised:'--surface-raised', // slightly above bg  #232118

  // ── Borders ───────────────────────────────────────────────────────
  border:      '--border',       // standard border       #2E2C28
  separator:   '--separator',    // grid-gap / dividers   #2A2824

  // ── Text ──────────────────────────────────────────────────────────
  ink:         '--ink',          // primary text          #E2D9CC
  ink2:        '--ink-2',        // body text             #C8BFB2
  ink3:        '--ink-3',        // secondary / supporting #A09888
  ink4:        '--ink-4',        // muted / metadata      #6A6460

  // ── Accent ────────────────────────────────────────────────────────
  accent:      '--accent',       // vermillion            #C4522A
  accentSoft:  '--accent-soft',  // vermillion background #2A1510

  // ── Status ────────────────────────────────────────────────────────
  statusWatchText: '--status-watch-text',  // #9A9080
  statusWatchBg:   '--status-watch-bg',   // #252015
  statusPendingText:'--status-pending-text', // #6A6460
  statusPendingBg: '--status-pending-bg', // #201E1A
  statusDone:      '--status-done',       // #4A4840

  // ── Typography ────────────────────────────────────────────────────
  fontDisplay: '--font-display', // Cormorant Garamond, serif
  fontMono:    '--font-mono',    // IBM Plex Mono, monospace
  fontBody:    '--font-body',    // Inter, sans-serif
} as const;

export type TokenKey = keyof typeof TOKEN;
export type TokenValue = typeof TOKEN[TokenKey];

/** Helper: wrap a token name in var() for inline style usage */
export const v = (token: TokenValue) => `var(${token})`;

/**
 * Reference theme — paste into your app's global CSS or a <style> tag.
 * Maps every TOKEN to its Warm Concrete value.
 */
export const warmConcreteTheme: Record<string, string> = {
  [TOKEN.bg]:              '#1E1C18',
  [TOKEN.surface]:         '#181612',
  [TOKEN.surfaceRaised]:   '#232118',
  [TOKEN.border]:          '#2E2C28',
  [TOKEN.separator]:       '#2A2824',

  [TOKEN.ink]:             '#E2D9CC',
  [TOKEN.ink2]:            '#C8BFB2',
  [TOKEN.ink3]:            '#A09888',
  [TOKEN.ink4]:            '#6A6460',

  [TOKEN.accent]:          '#C4522A',
  [TOKEN.accentSoft]:      '#2A1510',

  [TOKEN.statusWatchText]: '#9A9080',
  [TOKEN.statusWatchBg]:   '#252015',
  [TOKEN.statusPendingText]:'#6A6460',
  [TOKEN.statusPendingBg]: '#201E1A',
  [TOKEN.statusDone]:      '#4A4840',

  [TOKEN.fontDisplay]:     "'Cormorant Garamond', serif",
  [TOKEN.fontMono]:        "'IBM Plex Mono', monospace",
  [TOKEN.fontBody]:        "'Inter', sans-serif",
};

/** Inject warmConcreteTheme as :root CSS variables (call once in _app.tsx or layout.tsx) */
export function injectTheme(theme = warmConcreteTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(theme).forEach(([k, val]) => root.style.setProperty(k, val));
}
