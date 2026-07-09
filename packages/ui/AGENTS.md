# @life-os/ui — Agent Notes

## Design system: Still v2

Before building or restyling UI in any Life OS app, read **`docs/STILL_DESIGN_SYSTEM.md`**.

That document is the canonical spec for colors, typography, spacing, components, and layout patterns. All apps should converge on it over time.

| Resource | Purpose |
|----------|---------|
| `docs/STILL_DESIGN_SYSTEM.md` | Full agent-facing design system |
| `packages/ui/still-tokens.css` | Approved CSS custom properties (reference) |
| `docs/ui-preview/still-direction-v2.html` | Visual preview — open in browser |
| `packages/ui/tokens.css` | **Legacy** Warm Concrete — do not extend |

## Migration status

**Still is approved but not yet wired into apps.** Production apps still import legacy `tokens.css` values (Playfair + DM Mono + terracotta). When implementing new UI:

1. Follow Still tokens and patterns from the design system doc.
2. Use CSS variables from `still-tokens.css` (copy values or import when the app is migrated).
3. Do **not** introduce new Warm Concrete patterns (terracotta accent, DM Mono body, square corners, uppercase buttons).

## Package contents

- `still-tokens.css` — Still v2 tokens (canonical)
- `tokens.css` — legacy tokens (deprecated)
- `src/*` — shared React primitives (being aligned to Still in a future pass)

When adding shared components, match Still specs in the design system doc and export from `index.ts`.