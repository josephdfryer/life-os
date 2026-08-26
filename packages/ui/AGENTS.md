# @life-os/ui — Agent Notes

## Design system: Still v2

Before building or restyling UI in any LifeOS app, read **`docs/STILL_DESIGN_SYSTEM.md`**.

That document is the canonical spec for colors, typography, spacing, components, and layout patterns. All apps should converge on it over time.

| Resource | Purpose |
|----------|---------|
| `docs/STILL_DESIGN_SYSTEM.md` | Full agent-facing design system |
| `packages/ui/still-tokens.css` | Approved CSS custom properties (reference) |
| `docs/ui-preview/still-direction-v2.html` | Visual preview — open in browser |
| `packages/ui/tokens.css` | Deprecated compatibility shim to Still |

## Migration status

**Still is migrated across production apps.** Production apps import `still-tokens.css`; the legacy `tokens.css` path is only a compatibility shim. When implementing new UI:

1. Follow Still tokens and patterns from the design system doc.
2. Use CSS variables from `still-tokens.css`; do not copy palette values into app-local themes.
3. Do **not** introduce new Warm Concrete patterns (terracotta accent, DM Mono body, square corners, uppercase buttons).

## Package contents

- `still-tokens.css` — Still v2 tokens (canonical)
- `tokens.css` — compatibility shim to Still (deprecated import path)
- `src/*` — shared Still-native React primitives

When adding shared components, match Still specs in the design system doc and export from `index.ts`.
