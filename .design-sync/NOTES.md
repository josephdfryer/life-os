# design-sync notes — @life-os/ui ("Still")

Repo-specific gotchas for future syncs of the Still design system.

## Build / converter

- **No dist, no build script.** `@life-os/ui` exports TypeScript source directly
  (`main: ./index.ts` → `./src/index`). The converter runs in synth-entry mode
  straight from source — no `cfg.buildCmd` needed, no `--entry` override (main
  resolves).
- **`--node-modules ./node_modules` (repo ROOT).** `react`/`react-dom` are hoisted
  to the root, not present in `packages/ui/node_modules`. Point at root.
- **`cssEntry: still-tokens.css`** — the canonical Still v2 tokens (55 custom
  props). `tokens.css` is a 3-line legacy stub; do NOT use it.
- A **cssEntry wrapper that `@import`s the real tokens by relative path does NOT
  work** — the converter copies `cssEntry` verbatim into `_ds_bundle.css` and does
  not resolve its `@import`s (tried it; got 0-KB tokens + CSS_IMPORT_MISSING).
  Point `cssEntry` directly at the stylesheet that contains the rules.

## Source edit made by the sync

- `packages/ui/still-tokens.css`: removed a bare `@import "@life-os/ui/still-tokens.css";`
  that lived **inside a doc comment** ("Import (when an app is migrated): …").
  Browsers ignore it, but the converter's `@import` scan tripped on it
  (CSS_IMPORT_MISSING). Rewrote it as inline prose. Harmless, committed with the sync.

## Fonts

- `--font-body` (Inter) and `--font-display` (Newsreader, serif) are **served by
  the host apps at runtime via `next/font`** — they are NOT shipped by the package.
  Declared `runtimeFontPrefixes: ["Inter","Newsreader"]` to suppress FONT_MISSING.
  Previews render in system fallbacks (sans / serif); the serif fallback for
  Newsreader looks on-brand, so this was accepted.

## Preview authoring

- **Input/Textarea affordances read the CONTROLLED `value`.** The clearable "×"
  and the char counter only appear when you pass `value` + `onChange`, not
  `defaultValue`. Authored previews for these use controlled value.
- **11 core components authored** (rich previews, all graded good): Button, Card,
  Input, Badge, Chip, Avatar, EntityRow, PageHeader, ProgressBar, StatBlock,
  Textarea.
- **13 components ship the floor card** (fully importable, authorable on any
  re-sync): AppShell, BackLink, Divider, EmptyState, LifeOSBar, PetrolCard,
  SectionHeader, Select, Spinner, StillPage, Toast, ToastStack, TopNav.

## Known render warns

- None outstanding — render check is 24/24 clean (0 bad/thin/variantsIdentical).

## Re-sync risks (watch-list)

- **Fonts are system fallbacks in previews.** If exact Inter/Newsreader fidelity
  is wanted in the design tool, ship woff2 + `@font-face` via `cfg.extraFonts`
  (the apps serve them at runtime, so the bundle intentionally doesn't).
- **The `still-tokens.css` comment edit** is a real source change; if that file is
  regenerated upstream the bare-`@import` comment could return and re-trip the scan.
- **13 floor-card components** are the standing offer for incremental authoring —
  authored `.tsx` + grades carry forward, so a re-sync only needs the new ones.
