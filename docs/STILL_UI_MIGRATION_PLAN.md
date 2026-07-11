# Still UI Migration — Status

**Full execution plan:** [`docs/STILL_MIGRATION_PLAN.md`](STILL_MIGRATION_PLAN.md)  
**Design system:** [`docs/STILL_DESIGN_SYSTEM.md`](STILL_DESIGN_SYSTEM.md)  
**Preview:** `docs/ui-preview/still-direction-v2.html`

## Done (foundation / first pass)

- Still tokens: `packages/ui/still-tokens.css`
- Shared primitives partially Still-aligned (`packages/ui/src/*`)
- App layouts load Inter + Newsreader
- App globals import `@life-os/ui/still-tokens.css`
- Main headers use 52px Still nav shape (per app)
- First-pass treatment on several list/home pages (Persons people, Home, Stuff items, Events list, Places list, Theory home, Assistant home)

## Remaining (see detailed plan for checklists)

1. **Persons deep:** Today, person detail, inbox, modals, merge/clean/admin, import  
2. **Stuff / Theory / Events / Places** detail, forms, calendar, map chrome, import  
3. **Home widgets** full petrol Still language  
4. **Replace repeated inline** button/input/card with `@life-os/ui`  
5. **Grep purge** Playfair, DM Mono, `#c4572a`, square CTAs, uppercase button labels  
6. **No domain/API changes** in UI PRs  

## Rollout order

1. Verify Phase 0–1 foundation  
2. Persons core workflows  
3. Stuff → Events → Places → Theory → Home → Assistant  
4. Cleanup + QA matrix in `STILL_MIGRATION_PLAN.md` Phase 8  

Agents executing work should follow **`STILL_MIGRATION_PLAN.md`**, not only this status page.
