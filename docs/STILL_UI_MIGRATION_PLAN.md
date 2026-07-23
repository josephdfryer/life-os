# Still UI Migration — Complete

**Full execution plan:** [`docs/STILL_MIGRATION_PLAN.md`](STILL_MIGRATION_PLAN.md)  
**Design system:** [`docs/STILL_DESIGN_SYSTEM.md`](STILL_DESIGN_SYSTEM.md)  
**Preview:** `docs/ui-preview/still-direction-v2.html`

## Completed July 22, 2026

- Still tokens: `packages/ui/still-tokens.css`
- Shared primitives Still-aligned (`packages/ui/src/*`), including the petrol dashboard panel pattern
- App layouts load Inter + Newsreader
- App globals import `@life-os/ui/still-tokens.css`
- Main headers use the shared 52px Still nav shape
- Deep and primary surfaces across Persons, Home, Stuff, Events, Places, Theory, and Assistant use Still tokens and typography
- Legacy `tokens.css` is a compatibility shim to `still-tokens.css`; external Playfair/DM Mono loading is removed
- Legacy grep, lint, and repository-wide type-check pass

## Ongoing rule

This migration is closed. New surfaces must follow `STILL_DESIGN_SYSTEM.md`; repeated patterns belong in `@life-os/ui`. Use the QA matrix in `STILL_MIGRATION_PLAN.md` whenever shared chrome or tokens change.
