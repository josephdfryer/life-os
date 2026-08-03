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

- **All 25 synced components have authored previews, all graded good.** No floor
  cards. Keep it that way — when the package gains a component, author its
  preview in the same run rather than letting a floor card land.
- **`TimezoneDetector` is deliberately excluded** via `componentSrcMap:
  {"TimezoneDetector": null}`. It `return`s `null` (mount-once side effect that
  seeds the shared `tz` cookie), so it can never have a meaningful preview and a
  card for it would just read "preview not yet authored". **It is still exported
  by the bundle** (`window.Still` has 40 exports vs 25 component folders) — the
  exclusion only removes the picker card and the docs folder, not the import.
  Don't "fix" this by deleting the componentSrcMap entry.
- **`TimezonePicker` previews only the resting state.** The input + Save/Cancel
  state is behind internal `editing` state with no prop to force it, so it isn't
  a story. Its `CustomLabel` cell doubles as the "detected zone differs" case —
  the third affordance appears only when `current` ≠ the browser's zone, which
  is why that cell uses Europe/London.
- **Input/Textarea affordances read the CONTROLLED `value`.** The clearable "×"
  and the char counter only appear when you pass `value` + `onChange`, not
  `defaultValue`. Their previews use controlled value.
- **Wide/layout components need `cardMode` overrides** (in `cfg.overrides`) or the
  product grid crops them (`[GRID_OVERFLOW]`): `column` for AppShell, Divider,
  EmptyState, EntityRow, LifeOSBar, PageHeader, PetrolCard, SectionHeader,
  StillPage, Textarea, TopNav; `single` (primaryStory "Stacked") for ToastStack
  (corner-anchored/positioned).

## Known render warns

- None outstanding — render check is 25/25 clean (0 bad/thin/variantsIdentical).

## Conventions-header drift caught (2026-07-29 re-sync)

The `conventions.md` validation pass found two claims that no longer verified
against the build. Both were corrected in place:

- **`size` (`sm`/`md`/`lg`) as a global scale** — false. It's per-component:
  Button `sm`/`md`, Avatar `sm`/`md`/`lg`, Spinner `number`. An agent reading
  the old text would write `<Button size="lg">`.
- **`disabled` listed as a common boolean state** — false. `ButtonProps` is a
  closed interface (no native `button` prop spread), and NO component in the
  build declares `disabled?: boolean`. `accent`/`large` are real but belong to
  StatBlock alone.

Lesson for future syncs: the header's per-component prop claims drift as the DS
evolves. Re-run the enum/prop grep against `components/*/*/*.d.ts` every sync,
not just the token grep — tokens were 41/41 clean while props had two errors.

## Re-sync risks (watch-list)

- **Fonts are system fallbacks in previews.** If exact Inter/Newsreader fidelity
  is wanted in the design tool, ship woff2 + `@font-face` via `cfg.extraFonts`
  (the apps serve them at runtime, so the bundle intentionally doesn't).
- **The `still-tokens.css` comment edit** is a real source change; if that file is
  regenerated upstream the bare-`@import` comment could return and re-trip the scan.
- **No floor cards remain** (that line used to say 13; the backlog was cleared in
  the 2026-07-28 run). A re-sync only needs to author previews for genuinely new
  exports — authored `.tsx` + grades carry forward, and the 2026-07-29 run
  confirmed 25/25 `carried forward`, 0 `grade cleared`.
- **New `packages/ui` exports arrive silently.** `TimezonePicker` and
  `TimezoneDetector` appeared between the two syncs with nothing flagging them.
  The driver's `added` partition is the only signal — read it before assuming a
  re-sync is a no-op.
- **The conventions header drifts faster than the tokens do.** See the drift
  section above: tokens were 41/41 clean while two prop-level claims had gone
  false. Grep the `.d.ts` unions every sync, not just the token names.
