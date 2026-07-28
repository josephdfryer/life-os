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
- **Self-hosting the fonts via `cfg.extraFonts` did NOT work.** With `--node-modules`
  at the repo root, the package resolves through the workspace symlink
  (`node_modules/@life-os/ui` → `packages/ui`), and the converter normalizes any
  `extraFonts` path back to a package-relative form it then can't find (tried repo
  paths + absolute — all logged `not found — skipped`). To ship real woff2s you'd
  have to place them INSIDE `packages/ui/` (package-relative resolves) or fork the
  converter — judged not worth ~700KB of committed woff2 given the fallbacks read
  on-brand. Downloaded set + @font-face recipe is reproducible from Google Fonts if
  revisited (Inter 400/500/600/700, Newsreader 400/500/600 + italic 400, latin).

## Preview authoring

- **All 24 components have authored previews, all graded good.** No floor cards.
- **Input/Textarea affordances read the CONTROLLED `value`.** The clearable "×"
  and the char counter only appear when you pass `value` + `onChange`, not
  `defaultValue`. Their previews use controlled value.
- **Wide/layout components need `cardMode` overrides** (in `cfg.overrides`) or the
  product grid crops them (`[GRID_OVERFLOW]`): `column` for AppShell, Divider,
  EmptyState, EntityRow, LifeOSBar, PageHeader, PetrolCard, SectionHeader,
  StillPage, Textarea, TopNav; `single` (primaryStory "Stacked") for ToastStack
  (corner-anchored/positioned).

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
