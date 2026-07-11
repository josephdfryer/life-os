# Still Design System — Full App Migration Plan

**Status:** In progress (foundation + first-pass surfaces started)  
**Design source of truth:** [`docs/STILL_DESIGN_SYSTEM.md`](STILL_DESIGN_SYSTEM.md)  
**Visual reference:** open `docs/ui-preview/still-direction-v2.html` while working  
**Tokens:** `packages/ui/still-tokens.css`  
**Short status pointer:** [`docs/STILL_UI_MIGRATION_PLAN.md`](STILL_UI_MIGRATION_PLAN.md)

This is the **detailed execution plan** for migrating every Life OS app from legacy Warm Concrete (or partial Still) to full Still v2. Write it so Claude, Codex, or any agent can execute without re-deriving the design.

---

## Goals

1. Every app shares Still tokens, fonts, nav shell, buttons, cards, and list rows.
2. Legacy Warm Concrete is not extended; residual patterns are removed.
3. Shared patterns live in `@life-os/ui` so apps stop copy-pasting chrome and controls.
4. Visual/layout only — no data, API, auth, sync, or domain behavior changes.
5. Persons is the quality bar; other apps match its chrome.

## Non-goals

- No product-flow redesigns or route rewrites unless required for styling.
- No bulk data operations / destructive DB commands.
- No forcing full light theme on Home (petrol dashboard variant is valid Still).
- No mandatory shadcn install unless Dialog/Dropdown work needs it.
- Do not invent a second palette.

---

## Pre-flight (every agent session)

```bash
npm run agent:start -- --agent claude   # or --agent codex
```

Read in order:

1. `docs/STILL_DESIGN_SYSTEM.md`
2. This plan (and “Already done” below)
3. Nearest app `AGENTS.md`
4. Side-by-side: `docs/ui-preview/still-direction-v2.html`

Before finishing a phase: type-check touched workspaces; spot-check listed screens.

```bash
npm run agent:finish -- --agent <name> --summary "Still migration: <phase>" --next "<next phase>"
```

**Data safety:** UI-only. Never `deleteMany`, bulk person deletes, or `prisma db push --force-reset`.

---

## Already done (baseline — verify before redoing)

Confirm these before starting; skip if still true.

| Area | Status | Evidence |
|------|--------|----------|
| Still tokens package | Done | `packages/ui/still-tokens.css` |
| Design system doc | Done | `docs/STILL_DESIGN_SYSTEM.md` |
| Shared Button/etc. Still-aligned | Partially done | e.g. `packages/ui/src/Button.tsx` uses cognac/pill-ish styles |
| App fonts (Inter + Newsreader) | **Likely done across apps** | `apps/*/app/layout.tsx` use `next/font` Inter + Newsreader |
| App globals import still-tokens | **Likely done** | e.g. `apps/persons/app/globals.css` `@import "@life-os/ui/still-tokens.css"` |
| Nav height 52px / surface chrome | **Partially done** | e.g. Persons `Header.tsx` uses Still nav vars |
| First-pass list/home pages | **Partially done** | Per short plan: People list, Home page, Stuff items, Events list, Places list, Theory home, Assistant home |

**Agent rule:** At start of work, re-verify with:

```bash
# Fonts + tokens
grep -R "still-tokens\|Playfair\|DM_Mono\|Newsreader\|Inter" apps/*/app/layout.tsx apps/*/app/globals.css

# Legacy leftovers
grep -R "Playfair\|DM Mono\|font-playfair\|font-dm-mono\|#c4572a\|c4572a" apps --include='*.tsx' --include='*.css' | head -50
```

If foundation is complete, **start at Phase 2 remaining work** (deep Persons screens), not Phase 0 from scratch.

---

## Remaining work (execute in order)

```
Phase 0  Verify/finish foundation (@life-os/ui)     ← skip if verified complete
Phase 1  Shared AppShell (optional but high leverage)
Phase 2  Persons — deep workflows (priority)
Phase 3  Stuff + Theory-of — detail/new/notes
Phase 4  Events — calendar, detail, settings
Phase 5  Places — map chrome, profile, import
Phase 6  Home — widgets full Still petrol variant
Phase 7  Assistant — login + any new surfaces
Phase 8  Grep cleanup, docs status, QA matrix
```

---

## Phase 0 — Foundation verify / finish

**Goal:** `@life-os/ui` is Still-native; apps can import tokens + primitives safely.

### Checklist

- [ ] `still-tokens.css` matches design system hex values
- [ ] All primitives in `packages/ui/src/` use Still tokens (cognac primary, pill buttons, 10px cards, Newsreader only where design says display)
- [ ] Exports: `Button`, `Input`, `Textarea`, `Select`, `Card`, `Badge`, `Avatar`, `EmptyState`, `Spinner`, `Toast`, `BackLink`, `SectionHeader`, `Chip`, `TopNav` (or AppShell)
- [ ] No Warm Concrete defaults left inside primitives (uppercase tracking shout, square primary buttons, terracotta hard-codes without fallback)
- [ ] `package.json` exports `./still-tokens.css`

### New components (create if missing)

| Component | Spec |
|-----------|------|
| `AppShell` / nav styles | 52px, surface, pill NavLink, brand Newsreader 17px |
| `ListRow` | Person/item row: surface, shadow-sm, 10px radius, hover cognac-soft border |
| `PetrolCard` | Dark sidebar: petrol bg, camel stats, cognac CTA |

### Acceptance

- [ ] Grep `packages/ui` for `#c4572a` and uppercase `textTransform` on Button — gone or intentional danger only
- [ ] Type-check packages that import UI

**Effort if incomplete:** 0.5–1 day · **If complete:** 30 min verify only

---

## Phase 1 — Shared AppShell (recommended)

**Goal:** One nav pattern; stop four divergent `Header.tsx` implementations drifting.

### Spec

- Height `52px`, `background: var(--surface)`, `border-bottom: 1px solid var(--border-subtle)`
- Brand: `font-family: var(--font-display)`, 17px, weight 400
- Links: Inter 13px, pill `6px 14px`, active = `cognac-soft` bg + `cognac-deep` text
- Right slot: profile menu
- Hide on `/login`

### Implementation options (pick one and document)

1. **Presentational styles in `@life-os/ui`** + thin per-app Header wiring Next Link + session  
2. **Full AppShell in each app** copying the same style object constants from a shared `packages/ui/src/shellStyles.ts`

Prefer (1). Profile dropdowns stay app-local (auth differs).

### Acceptance

- [ ] Persons Header matches design system nav exactly  
- [ ] Other apps adopt same link/active styles when their phase runs  

**Effort:** 0.5 day

---

## Phase 2 — Persons (deep migration — priority)

**Goal:** Every major Persons surface matches Still v2, not just People list first-pass.

### 2.1 Already likely OK — re-check only

- `layout.tsx` fonts  
- `globals.css` still-tokens + body  
- `Header.tsx` 52px Still nav  
- `PeopleClient.tsx` first-pass  

### 2.2 Screens to finish (in order)

| Priority | Route / UI | What “done” looks like |
|----------|------------|------------------------|
| P0 | `/login` | Surface panel, Newsreader title, cognac pill CTA |
| P0 | `/today` | Greeting Newsreader; attention/birthday cards Still; soft rows |
| P0 | `/people` | List rows, filters, bulk bar Still; sentence-case buttons |
| P0 | `/people/[id]` | Newsreader name; gradient avatar; tabs; InteractionCard; modals |
| P0 | `/inbox` | List + actions; petrol accents for counts; cognac process CTAs |
| P1 | Modals: Edit/Add person, Log interaction, Add plan | 12px panel radius; cognac primary; ghost cancel; Still inputs |
| P1 | `/people/merge`, `/people/clean` | Cards + tables on Still surfaces |
| P1 | `/admin` | Dense admin UI on Still tokens (no terracotta) |
| P2 | `/import/*` | DropZone, ProcessingState, ResultCard — petrol processing shell OK |
| P2 | `/places/*` under persons | Match Places app Still OR redirect; no mixed themes |

### 2.3 Hard-coded sweep

```bash
grep -R "c4572a\|Playfair\|DM Mono\|font-playfair\|font-dm-mono\|textTransform: .uppercase\|textTransform: \"uppercase\"" apps/persons --include='*.tsx' --include='*.css'
```

| Legacy | Still |
|--------|-------|
| Terracotta hex | `var(--cognac)` |
| Square CTAs | `borderRadius: var(--radius-pill)` |
| Uppercase button labels | Sentence case |
| Mono body | `var(--font-body)` |
| Hard zinc (if any) | Still tokens |

### 2.4 Prefer shared primitives

Where `@life-os/ui` Button/Input/Card/Avatar/EmptyState/BackLink fit, use them (Person detail already imports some).

### 2.5 Acceptance (Persons)

- [ ] Today / People / Person detail / Inbox match `still-direction-v2.html` language  
- [ ] No Playfair/DM Mono/c4572a in persons app  
- [ ] Type-check persons clean  
- [ ] No API/domain changes  

**Effort:** 1.5–2.5 days remaining

---

## Phase 3 — Stuff + Theory-of

### Stuff

- [ ] Items list (verify first-pass)  
- [ ] `/items/[id]` detail  
- [ ] `/items/new` form  
- [ ] Login  
- [ ] Header = AppShell pattern  

### Theory-of

- [ ] Home (verify first-pass)  
- [ ] `/person/[personId]` theory page — Newsreader titles, Inter chrome  
- [ ] Notes surfaces  
- [ ] Regenerate / add note controls = cognac/ghost  

**Acceptance:** Detail/new pages match list chrome; no legacy fonts/accent.

**Effort:** 0.5–1 day

---

## Phase 4 — Events

- [ ] Event list (verify first-pass)  
- [ ] `/events/[id]`, `/events/new`  
- [ ] `CalendarView` — light grid; **today** marker cognac; headers Inter  
- [ ] Calendar settings forms  
- [ ] Log interaction form  
- [ ] Header AppShell pattern  

**Care:** Calendar density stays readable; Still is softer chrome, not fewer cells.

**Effort:** ~1 day

---

## Phase 5 — Places

- [ ] Places list (verify first-pass)  
- [ ] Place profile  
- [ ] Map + `LayerPanel` chrome → surface/petrol tokens (map canvas can stay)  
- [ ] Import upload / progress / review  
- [ ] Align with persons-embedded places if still duplicated  

**Effort:** 1–1.5 days

---

## Phase 6 — Home

Home = **Still petrol variant**, not forced oatmeal full page.

- [ ] Dashboard widgets (`Schedule`, `ActionItems`, `Inbox`, `Nudges`) use petrol panels + camel stats + cognac CTAs  
- [ ] Greeting Newsreader  
- [ ] App footer links Still hover language  
- [ ] Login: prefer light Still panel for family consistency  

**Do not** reintroduce raw `#0d0d0d` / zinc-only palette without mapping to `--petrol` / Still soft colors.

**Effort:** 0.5–1 day

---

## Phase 7 — Assistant

- [ ] Landing page Still surface card  
- [ ] Login Still  
- [ ] Health link styling  

**Effort:** 0.25 day

---

## Phase 8 — Cleanup & lock-in

### Grep zero (or justified exceptions)

```bash
grep -R "Playfair\|DM Mono\|font-playfair\|font-dm-mono\|#c4572a\|c4572a" apps packages/ui --include='*.tsx' --include='*.ts' --include='*.css'
```

### Legacy tokens

- [ ] No production app depends on Warm Concrete-only values  
- [ ] `packages/ui/tokens.css` shim to still-tokens or deleted with import updates  

### Docs

- [ ] `STILL_DESIGN_SYSTEM.md` status → **Migrated** (date)  
- [ ] Update this plan checkboxes / `STILL_UI_MIGRATION_PLAN.md` remaining list  
- [ ] Handoff note for next agent  

### QA matrix

| App | Must click |
|-----|------------|
| Persons | Login, Today, People, Person detail, Inbox, Import, Merge, Admin |
| Stuff | List, detail, new |
| Theory-of | Home, person theory, notes |
| Events | List, detail, new, calendar, settings |
| Places | List, profile, map layers, import |
| Home | Dashboard, login |
| Assistant | Landing, login |

Cross-app: same nav weight, button language, fonts.

### Build

```bash
npm run type-check
# Optional: per-app build for apps you touched
```

**Effort:** 0.5 day

---

## Implementation patterns

### A. Layout fonts (canonical)

```tsx
import { Inter, Newsreader } from "next/font/google"

const inter = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" })
const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
})
// <html className={`${inter.variable} ${newsreader.variable}`}>
```

### B. globals.css target

```css
@import "tailwindcss"; /* if used */
@import "@life-os/ui/still-tokens.css";

body {
  background-color: var(--bg);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.55;
}
```

### C. Inline styles strategy

Most UI is `style={{}}`. Do not require full Tailwind rewrite.

1. Hex → `var(--token)`  
2. Fonts → `var(--font-display)` / `var(--font-body)`  
3. Radius → `var(--radius)` / `var(--radius-pill)`  
4. Third duplicate → extract to `@life-os/ui`  

### D. Login pages

Clone the first finished Still login (Persons) across apps or extract a shared panel.

### E. Import dark shells

Prefer **petrol Still** for processing UIs, not arbitrary pure black.

---

## PR / commit strategy

| Unit | Scope |
|------|--------|
| PR0 | packages/ui finish Still primitives |
| PR1 | AppShell shared |
| PR2 | Persons deep screens |
| PR3 | Stuff + Theory detail |
| PR4 | Events calendar/detail |
| PR5 | Places detail/import/map chrome |
| PR6 | Home widgets |
| PR7 | Assistant |
| PR8 | Legacy purge + docs |

Messages: `style(persons): Still v2 person detail and modals`

---

## Effort remaining (estimate)

| Phase | Days |
|-------|------|
| 0 verify/finish | 0–1 |
| 1 AppShell | 0.5 |
| 2 Persons deep | 1.5–2.5 |
| 3 Stuff + Theory | 0.5–1 |
| 4 Events | 1 |
| 5 Places | 1–1.5 |
| 6 Home | 0.5–1 |
| 7 Assistant | 0.25 |
| 8 Cleanup | 0.5 |
| **Total remaining** | **~6–9 agent-days** (less if first-pass quality is high) |

Parallelize after Persons deep (Phase 2): Stuff / Theory / Events on separate branches carefully.

---

## Definition of done (program)

1. All apps: Inter + Newsreader + still-tokens.  
2. Nav, primary buttons, list rows, cards match Still v2.  
3. Grep-clean of Warm Concrete fonts/accent in `apps/`.  
4. `@life-os/ui` Still-native; legacy tokens gone or shimmed.  
5. Design system doc marked migrated; this plan’s remaining list empty.

---

## Hand-off prompt (paste for another agent)

```
Execute docs/STILL_MIGRATION_PLAN.md starting at Phase <N> (or "next incomplete phase").

Rules:
1. Read docs/STILL_DESIGN_SYSTEM.md and open docs/ui-preview/still-direction-v2.html.
2. Re-verify "Already done" baseline — do not redo completed foundation.
3. Visual/layout only — no data mutations, bulk deletes, or API behavior changes.
4. Prefer CSS variables from packages/ui/still-tokens.css and @life-os/ui primitives.
5. After work: type-check, update docs/STILL_UI_MIGRATION_PLAN.md remaining list, agent:finish with next phase.
```

---

*Still v2 · plan updated for partial migration baseline · July 2026*
