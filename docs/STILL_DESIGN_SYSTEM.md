# Still — Life OS Design System (v2)

**Status:** Migrated across production apps · **July 22, 2026**
**Audience:** Claude, Codex, and any agent building Life OS UI  
**Visual reference:** [`docs/ui-preview/still-direction-v2.html`](ui-preview/still-direction-v2.html)  
**Token source:** [`packages/ui/still-tokens.css`](../packages/ui/still-tokens.css)

---

## What is Still?

**Still** is the shared visual language for all Life OS apps. It replaces the earlier **Warm Concrete** system (Playfair + DM Mono + terracotta + square corners).

Still feels like a **well-made personal object** — warm linen, cognac leather, camel highlights, occasional petrol depth. Calm like Muji, breathable like Things, restrained like Aesop, colored like the owner's wardrobe (earth tones, not grey SaaS).

| Principle | Meaning |
|-----------|---------|
| Warm, never cold | Cream/oatmeal grounds. No zinc, no pure white, no blue accents. |
| Quiet hierarchy | Serif **only** for names and page greetings. Sans for everything else. |
| Soft elevation | Cards use subtle shadow, not heavy borders everywhere. |
| Gentle urgency | Attention states use warm amber (`--attention`), never red alarm. |
| Sentence case | No uppercase shouting on buttons or labels. |
| Depth as accent | Petrol (`--petrol`) is the "overcoat" — sidebars, inbox panels, not the whole app. |

---

## Agent rules (read before any UI work)

1. **Read this doc** when touching layout, styling, or shared components in any app.
2. **Use Still tokens** from `packages/ui/still-tokens.css` — not legacy `tokens.css` values.
3. **Do not extend Warm Concrete** — no terracotta `#c4572a`, no DM Mono body text, no square-corner buttons, no uppercase micro-labels on CTAs.
4. **Prefer CSS variables** over hard-coded hex in new code.
5. **Reuse patterns** below (nav, person row, sidebar card) instead of inventing per-app styles.
6. **One app shell shape** — same nav height, link style, and page padding across Persons, Places, Events, Stuff, Theory-of, Home (Home may keep a petrol-heavy dashboard variant).
7. **Living doc** — if you establish a new repeated pattern used in 2+ places, add it here in the same PR.

### Legacy vs Still

| | Warm Concrete (legacy) | Still v2 (use this) |
|---|------------------------|---------------------|
| Body font | DM Mono | Inter |
| Display font | Playfair Display | Newsreader |
| Primary accent | Terracotta `#c4572a` | Cognac `#8f6b4a` |
| Highlight | — | Camel `#c4a574` |
| Dark accent | — | Petrol `#1a2a35` |
| Button shape | Square | Pill (`border-radius: 100px`) |
| Button text | UPPERCASE | Sentence case |
| Card radius | 0px | 10px |

Production apps may still *look* legacy until migrated. **New UI should target Still.**

---

## Color system

### Surfaces

| Token | Hex | Use |
|-------|-----|-----|
| `--bg` | `#e9e3d8` | Page background |
| `--surface` | `#f7f4ee` | Cards, nav, inputs |
| `--surface-2` | `#efe9df` | Secondary panels, active nav bg |
| `--surface-hover` | `#e8e1d6` | Hover states |
| `--border` | `#d9d0c3` | Default borders |
| `--border-subtle` | `#e5dfd4` | Dividers inside cards |

### Text

| Token | Hex | Use |
|-------|-----|-----|
| `--ink` | `#2c2620` | Primary text |
| `--ink-2` | `#524a42` | Secondary body |
| `--ink-3` | `#7a7268` | Meta, captions |
| `--ink-4` | `#a69c90` | Placeholders, section labels |

### Fashion accents

| Token | Hex | Use |
|-------|-----|-----|
| `--cognac` | `#8f6b4a` | Primary buttons, active nav, key stats |
| `--cognac-deep` | `#6e5238` | Hover on cognac, active text |
| `--cognac-soft` | `#f0e6d8` | Active nav bg, badges, focus rings |
| `--camel` | `#c4a574` | Highlights ("3 birthdays this week") |
| `--camel-soft` | `#f5edd8` | Highlight badges |
| `--petrol` | `#1a2a35` | Dark panels (inbox card, optional Home) |
| `--petrol-soft` | `#e8edf0` | Petrol-tinted badges |

### Semantic

| Token | Hex | Use |
|-------|-----|-----|
| `--attention` | `#b07d4f` | "Needs outreach" — warm nudge |
| `--attention-soft` | `#f8ece0` | Attention badge background |
| `--success` | `#6b7a63` | Completed, cleared, done |

### Color rules

- **Primary CTA** → cognac background, white text.
- **Secondary CTA** → ghost: transparent bg, `--border` border, pill shape.
- **Dark CTA on petrol panels** → cognac button (not white).
- **Never** use Tailwind zinc/slate defaults, `#007aff`, or legacy terracotta for new work.
- **Petrol** is for structural depth (sidebar/inbox), not full-page dark mode (except Home dashboard variant).

---

## Typography

### Fonts

Load via `next/font/google` in each app's `layout.tsx`:

```ts
import { Inter, Newsreader } from "next/font/google"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
})

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
})
```

| Role | Font | CSS variable |
|------|------|--------------|
| Person names, page greetings, large stats | Newsreader | `--font-display` |
| Everything else | Inter | `--font-body` |

### Scale

| Element | Font | Size | Weight | Notes |
|---------|------|------|--------|-------|
| Page greeting | Newsreader | 28px | 400 | `letter-spacing: -0.02em` |
| Person name (list) | Newsreader | 17px | 400 | |
| Person name (detail) | Newsreader | 28px | 400 | |
| App nav brand | Newsreader | 17px | 400 | |
| Body | Inter | 14px | 400 | `line-height: 1.55` |
| Meta / caption | Inter | 12–13px | 400 | `color: var(--ink-3)` |
| Section label | Inter | 11px | 450 | `letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-4)` |
| Large stat | Newsreader | 40px | 400 | `color: var(--cognac)` on light; `var(--camel)` on petrol |
| Button | Inter | 13px | 450–500 | Sentence case |

### Typography don'ts

- No DM Mono for UI chrome.
- No Playfair Display in new work.
- No uppercase on button labels.
- Serif is **not** for nav links, form labels, or table headers.

---

## Spacing, radius, shadow

### Spacing scale

| Token | Value | Typical use |
|-------|-------|-------------|
| `--space-xs` | 4px | Tight gaps |
| `--space-sm` | 8px | Between list items |
| `--space-md` | 16px | Card padding, form gaps |
| `--space-lg` | 24px | Section gaps |
| `--space-xl` | 36px | Page body padding |
| `--space-2xl` | 48px | Major section breaks |

### Radius

| Token | Value | Use |
|-------|-------|-----|
| `--radius-sm` | 6px | Small chips, inputs |
| `--radius` | 10px | Cards, person rows |
| `--radius-lg` | 14px | Large panels |
| `--radius-pill` | 100px | Buttons, nav links, badges |

### Shadow

| Token | Use |
|-------|-----|
| `--shadow-sm` | List rows, resting cards |
| `--shadow` | Hover on rows |
| `--shadow-lg` | Modals, petrol sidebar cards |

---

## Layout

### App shell

```
┌─────────────────────────────────────────────────────────┐
│  Nav  52px  surface bg  border-bottom subtle            │
│  [App name]  [Today] [People] [Inbox]     [avatar]      │
├─────────────────────────────────────────────────────────┤
│  Main content (bg)          │  Sidebar (optional)        │
│  max-width ~1100px          │  petrol card for inbox     │
│  padding 36px 24px          │  or stats                  │
└─────────────────────────────────────────────────────────┘
```

| Property | Value |
|----------|-------|
| Nav height | `52px` (`--nav-height`) |
| Nav padding | `0 24px` |
| Nav background | `var(--surface)` |
| Content max width | `1100px` centered |
| Page padding | `36px 24px` (desktop), `24px 20px` (mobile) |

### Grid

- **Today / dashboard:** `1fr 280px` two-column when sidebar present.
- **List pages:** Single column, max `1100px`.
- **Mobile:** Collapse sidebar below main content (`< 720px`).

---

## Components

Use these recipes when building UI. Prefer adding to `@life-os/ui` when a pattern appears in 2+ apps.

### App nav

- Brand: Newsreader 17px, `var(--ink)`.
- Links: Inter 13px, pill padding `6px 14px`.
- Default link: `color: var(--ink-3)`.
- Active link: `color: var(--cognac-deep); background: var(--cognac-soft); font-weight: 450`.
- Hover: `background: var(--surface-hover); color: var(--ink)`.

### Cross-app shell and account menu

- Home is the control plane and keeps the full Life OS section navigation visible.
- Satellite apps show only `Life OS / [current app]` in the cross-app strip. Their own header is reserved for that app's local navigation.
- On satellite apps, put Home, Stream, Inbox, Intelligence, Automation, Connections, Admin, Capture, identity, and Sign out inside the shared avatar menu at the far right.
- Do not repeat an avatar or Sign out control in the app-local header.
- Provider integrations are children of a neutral **Connections** destination. Provider names such as Granola or Google Calendar should not become primary app navigation items.

### Button — primary (cognac)

```
background: var(--cognac)
color: #fff
border-radius: var(--radius-pill)
padding: 9px 18px
font-size: 13px
font-weight: 450
hover → background: var(--cognac-deep)
```

Label examples: "Log interaction", "Save changes", "Process inbox"

### Button — secondary (ghost)

```
background: transparent
color: var(--ink-3)
border: 1px solid var(--border)
border-radius: var(--radius-pill)
hover → background: var(--surface-hover); color: var(--ink)
```

### Button — on petrol panel

Same as primary cognac. Do not use white buttons on petrol.

### Input

```
background: var(--surface)
border: 1px solid var(--border)
border-radius: var(--radius)  /* 10px */
padding: 10px 14px
font: Inter 14px
focus → border-color: var(--cognac); box-shadow: 0 0 0 3px var(--cognac-soft)
```

### Person row (list item)

```
display: flex; align-items: center; gap: 14px
padding: 14px 16px
background: var(--surface)
border-radius: var(--radius)
box-shadow: var(--shadow-sm)
border: 1px solid transparent
hover → border-color: var(--cognac-soft); box-shadow: var(--shadow)
```

### Avatar

```
40×40px (list), 56×56px (detail)
border-radius: 50%
background: linear-gradient(135deg, var(--cognac-soft), var(--camel-soft))
color: var(--cognac-deep)
font: Inter 12px weight 500
```

### Badge

| Variant | Background | Text |
|---------|------------|------|
| Default | `var(--cognac-soft)` | `var(--cognac-deep)` |
| Highlight | `var(--camel-soft)` | `#7a6040` |
| Attention | `var(--attention-soft)` | `var(--attention)` |
| On petrol | `var(--petrol-soft)` | `var(--petrol)` |

```
font-size: 11px
padding: 3px 10px
border-radius: var(--radius-pill)
```

### Section label

```
font-size: 11px
letter-spacing: 0.1em
text-transform: uppercase
color: var(--ink-4)
margin-bottom: 12px
```

### Card (light)

```
background: var(--surface)
border: 1px solid var(--border-subtle)
border-radius: var(--radius)
padding: 22px 24px
box-shadow: var(--shadow-sm)
```

### Sidebar / inbox card (petrol)

Use for **one** high-priority dark panel per view (typically Inbox).

```
background: var(--petrol)
border: 1px solid #2a424c  /* petrol border */
border-radius: var(--radius)
padding: 22px
box-shadow: var(--shadow-lg)
color: #e8e4dc

Stat number → Newsreader 40px, color: var(--camel)
Labels → uppercase 11px, color: #6a858f
Row values → color: var(--camel) for counts
CTA → cognac pill button
```

### Empty state

```
Centered, padding 40px 24px
Icon/emoji: 24px, color: var(--ink-4)
Title: Inter 13px, color: var(--ink-3)
Subtitle: Inter 12px, color: var(--ink-4), max-width 320px
Optional action → ghost button
```

### Modal / dialog

```
Backdrop: rgba(44, 38, 32, 0.5)
Panel: var(--surface), border-radius: 12px, shadow-lg
Title: Newsreader 22px
Footer: ghost cancel + cognac primary, right-aligned
```

### Toast

```
background: var(--surface)
border: 1px solid var(--border)
border-left: 2px solid var(--cognac)  /* or --success for ok */
border-radius: var(--radius-sm)
padding: 10px 14px
```

---

## App-specific guidance

| App | Notes |
|-----|-------|
| **Persons** | Reference implementation target. Today view = greeting + person rows + petrol inbox sidebar. |
| **Places** | Same shell. Map UI can use petrol for layer panel chrome. |
| **Events** | Calendar cells stay light; use cognac for "today" marker. |
| **Stuff** | Simpler lists — person row pattern works for items. |
| **Theory-of** | Newsreader-forward — prose-heavy, extra whitespace. |
| **Home** | May use petrol-heavy dashboard (widgets on dark panels). Keep Newsreader greetings; align stat colors to camel on petrol. |
| **Assistant** | Minimal — apply tokens when UI expands. |

---

## Implementation checklist (per app migration)

When an app is ready to migrate (future work):

- [ ] Load Inter + Newsreader in `layout.tsx`
- [ ] Import `@life-os/ui/still-tokens.css` in `globals.css`
- [ ] Replace inline Warm Concrete hex with CSS variables
- [ ] Unify `Header.tsx` to shared nav pattern (or `TopNav` in `@life-os/ui`)
- [ ] Swap person/item rows to Still card pattern
- [ ] Point inbox/stats sidebar to petrol card pattern
- [ ] Remove DM Mono / Playfair / terracotta references
- [ ] Open `still-direction-v2.html` side-by-side and compare

---

## Preview files

| File | Purpose |
|------|---------|
| [`still-direction-v2.html`](ui-preview/still-direction-v2.html) | **Canonical** visual reference |
| [`still-direction-v3-linen.html`](ui-preview/still-direction-v3-linen.html) | Rejected variant (too light) |
| [`still-direction-v4-tailored.html`](ui-preview/still-direction-v4-tailored.html) | Rejected variant (too dark) |
| [`still-pick-one.html`](ui-preview/still-pick-one.html) | Comparison hub |
| [`still-people-page.html`](ui-preview/still-people-page.html) | Example People page using Still v2 |
| [`proposed-components.html`](ui-preview/proposed-components.html) | shadcn integration notes (future) |

---

## Future: component library

Still does not yet require shadcn/ui. When complex primitives are needed (Dialog, Dropdown, Table), follow [`proposed-components.html`](ui-preview/proposed-components.html) — theme shadcn to **Still tokens**, not default zinc.

Shared React primitives live in `packages/ui/src/`. They currently follow legacy Warm Concrete and will be updated in a dedicated migration pass. Until then, **match visual output** to this doc even if using inline styles.

---

## Quick reference card

```
Background:     #e9e3d8
Surface:        #f7f4ee
Text:           #2c2620
Meta:           #7a7268
Primary:        #8f6b4a  (cognac)
Highlight:      #c4a574  (camel)
Dark panel:     #1a2a35  (petrol)
Attention:      #b07d4f
Radius cards:   10px
Radius buttons: pill
Display font:   Newsreader (names only)
Body font:      Inter
```

*Still v2 — approved July 2026*
