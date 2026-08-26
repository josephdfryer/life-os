# Still — LifeOS design system

Still is a **token-driven** React design system. There is **no provider, no theme
context, and no CSS class system**. Every component styles itself with inline
styles that read CSS custom properties (design tokens). You build with it by
composing the components and, for your own layout glue, writing inline styles
that reference the same tokens.

## Setup

- **No wrapper needed.** Components render styled on their own as long as the
  design tokens are in scope — they ship in `styles.css` (loaded for you). Don't
  wrap the tree in any provider; there isn't one.
- **Fonts.** Two families are referenced by the tokens: `--font-body` (Inter,
  sans) and `--font-display` (Newsreader, a serif used for titles/large numbers).
  The host normally serves these; system sans/serif fallbacks are close, so text
  always renders.
- **Import** from `@life-os/ui` (bundled here as `window.Still.*`).

## Styling idiom — tokens + inline styles (no classes)

Style via the `style` prop with `var(--token)` values. Do **not** invent utility
classes or `className`s — Still has none. Use these real token names:

- **Surfaces:** `--bg`, `--surface`, `--surface-2`, `--surface-hover`,
  `--surface-raised`
- **Text (ink ramp, dark→light):** `--ink`, `--ink-2`, `--ink-3`, `--ink-4`
- **Lines:** `--border`, `--border-subtle`, `--separator`
- **Brand accents:** `--cognac`, `--cognac-deep`, `--cognac-soft` (the primary
  accent), plus `--camel`, `--camel-soft`, `--petrol`, `--petrol-soft`
- **Semantic:** `--success`/`--success-soft`, `--attention`/`--attention-soft`,
  `--accent`/`--accent-soft`
- **Type:** `--font-display`, `--font-body`, `--font-mono`
- **Radius:** `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill`
- **Spacing:** `--space-xs` … `--space-2xl`
- **Shadow:** `--shadow-sm`, `--shadow`, `--shadow-lg`

Component look is controlled by **props**, not classes. The main axis is
`variant` (e.g. Button `primary`/`ghost`/`danger`; Badge `default`/`accent`/
`success`/`warning`/`muted`).

**`size` is per-component, not a global scale** — Button is `sm`/`md` only,
Avatar is `sm`/`md`/`lg`, Spinner takes a number. There is no `size="lg"` on
Button. Boolean states are per-component too (`loading` on Button; `accent` and
`large` on StatBlock); **no component takes a `disabled` prop**. Read the
component's `<Name>.d.ts` for the exact union before using a size or a state.

## Where the truth lives

- **Tokens:** read the bound `styles.css` (and its `@import` of the Still tokens)
  for the authoritative values.
- **Per component:** `<Name>.d.ts` is the exact prop contract; `<Name>.prompt.md`
  has usage. Prefer reading those over guessing props.

## Idiomatic snippet

```tsx
import { Card, EntityRow, Badge, Button } from '@life-os/ui'

<Card
  title="People you owe a reply"
  footer={<Button size="sm" variant="primary">Review all</Button>}
>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
    <EntityRow
      initials="KL"
      title="Kenji Lee"
      meta="Last seen 3 days ago"
      badges={<Badge label="Close" variant="accent" />}
    />
    <EntityRow initials="ED" title="Emily Ding" meta="Coworker · San Francisco" />
  </div>
</Card>
```

Library components carry the design; your own wrapper markup uses inline styles
with the tokens above (here `--space-xs` for the row gap). Never reach for a
utility class — resolve layout with tokens and fl/grid inline styles.
