# Still UI Migration Plan

Still v2 is the approved visual language for Life OS. The canonical spec is
`docs/STILL_DESIGN_SYSTEM.md`; the token source is `packages/ui/still-tokens.css`.

## Current migration baseline

- Shared package primitives in `packages/ui/src/` have been aligned to Still.
- All app layouts load Inter + Newsreader through `next/font`.
- All app globals import `@life-os/ui/still-tokens.css`.
- The main app headers now use the 52px Still nav shape.
- First-pass page treatment has been applied to:
  - `apps/persons/app/people/PeopleClient.tsx`
  - `apps/home/app/page.tsx`
  - `apps/stuff/app/items/page.tsx`
  - `apps/events/app/events/page.tsx`
  - `apps/places/app/places/PlacesClient.tsx`
  - `apps/theory-of/app/page.tsx`
  - `apps/assistant/app/page.tsx`

## Remaining passes

1. Convert deeper detail/workflow pages: person detail, inbox, imports, admin,
   event detail/new, item detail/new, place detail/import, and theory detail.
2. Replace repeated inline button/input/card styles with shared `@life-os/ui`
   primitives.
3. Remove residual legacy references after each app has been visually checked:
   `Playfair`, `DM Mono`, `var(--font-dm-mono)`, `#c4572a`, square buttons,
   and uppercase CTA labels.
4. Keep app-specific domain behavior unchanged. UI migration PRs should not
   alter database writes, sync flows, imports, auth, or API behavior.
5. Verify each app with a build plus desktop/mobile browser pass before
   considering that app fully migrated.

## Rollout order

1. Persons core workflows: `/people`, `/people/[id]`, `/today`, `/inbox`.
2. Stuff list/detail/new.
3. Events timeline/calendar/detail/new.
4. Places map/detail/import review.
5. Theory list/detail.
6. Home dashboard widgets.
7. Assistant once the product surface expands.
