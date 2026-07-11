# Codex Task: Promote Resolved Visits to Places + Legend UX

**Status:** Ready for implementation
**Apps:** `apps/places`
**Author:** Claude (handoff)
**Date:** July 11, 2026

Run `npm run agent:start -- --agent codex` from the monorepo root first and read
the catch-up brief. Read root `AGENTS.md` — especially **DATA SAFETY** and
**Local Development: Always Bypass Auth** (`LIFE_OS_LOCAL_REVIEW=1`; never set up
localhost OAuth).

## Context — what exists right now

- Production Turso DB (creds in `apps/persons/.env`; `apps/places/.env.local`
  also points at prod now). **This is live data. Nothing here authorizes any
  bulk delete.** Schema drift with prod was fully reconciled on July 10 —
  `prisma/schema.prisma` matches prod exactly. New migrations follow the manual
  pattern: SQL file under `packages/db/prisma/migrations/<name>/migration.sql`,
  applied with `npx tsx scripts/apply-migration.ts <path>`.
- `ImportStagedVisit` holds **680 staged timeline visits** (Mar 31 → Jul 10,
  workspace `default-workspace`). Each has `startedAt/endedAt`,
  `latitude/longitude`, `googlePlaceId`, `confidence` (import confidence,
  0–100 scale), `status` (enum: pending/accepted/…), `resolvedPlaceId`,
  `resolvedEventId`, and `aiEnrichment` (JSON).
- **666 of them have an authoritative `placeName` + `placeAddress`** resolved
  from the Google Places API (script: `scripts/era/resolve-place-ids.ts`).
  For these, `aiEnrichment` looks like:
  `{ placeName, category: "<google types joined>", confidence: 0.98, reasoning: "Resolved via Google Places API…", googleTypes: [...], coordinateGuess: {...} }`.
  Visits *without* API resolution have only a coordinate-inferred
  `aiEnrichment` (low confidence) — do NOT promote those.
- `Place` has a **unique `googlePlaceId`** column. **20 Places already exist**
  with `googlePlaceId` set (created from finance matches by
  `scripts/era/create-matched-places.ts`). `Place.coordinates` is a JSON string:
  `{"latitude": …, "longitude": …}`. `type: "business"` was used for those 20.
- The accept pipeline lives in `apps/places/server/domain/import.ts`:
  `updateStagedVisit`, `bulkUpdateStagedVisits({ action, minConfidence, visitIds })`,
  and the create-place/create-event helpers used by `processImportJob`.
- The map UI is `apps/places/app/places/PlacesClient.tsx` (custom OSM-tile map,
  camera model with pan/zoom added July 10) and the legend is
  `apps/places/components/map/LayerPanel.tsx` (5 layers: location, finance,
  photos, interactions, enrichment). Active layers persist in the `layers=`
  URL param via `toggleLayer`/`layersFromParam` in PlacesClient.

## Task 1 — Promote Google-resolved visits into real Places

Goal: the map currently shows ~20 real pins and ~500 "?" dots. After this task
every Google-resolved visit should be a real, named `Place` with visits linked.

1. Promote every `ImportStagedVisit` in `default-workspace` where
   `status = pending` **and** `placeName` is set **and** `aiEnrichment.reasoning`
   indicates Google API resolution (or equivalently `aiEnrichment.confidence >= 0.9`):
   - **Dedupe by `googlePlaceId` first**: if a `Place` with that
     `googlePlaceId` exists (including the 20 finance ones), link the visit to
     it (`resolvedPlaceId`) instead of creating a duplicate.
   - Otherwise create the `Place` (name, `googlePlaceId`, coordinates JSON,
     address; pick `type` from the first meaningful `googleTypes` entry).
   - Reuse/extend the existing accept path in `server/domain/import.ts` if
     practical (it also creates the visit `Event` and sets
     `resolvedPlaceId`/`resolvedEventId`/`status = accepted`). A repo script
     under `scripts/places/` calling the domain functions is fine too — but do
     not bypass the domain's Event-creation semantics: each accepted visit
     should produce its visit Event like the normal review flow does.
   - Skip visits whose resolved name is a residential/complex catch-all you
     judge noise (e.g. plain apartment complexes the user merely parked near) —
     use `googleTypes` to decide; when unsure, promote. Do not promote visits
     that still have `placeName = null`.

2. **Fix the Home auto-create bug, then create Home.** During the July 10
   import, 5 visits with `semanticType: Home` failed auto-create (job
   `errorRows: 5`). The failure was in `server/domain/import.ts` around the
   event-creation helper (~line 520): `findDuplicateEvent(...)` /
   `db.event.create(...)` threw a Prisma error (see `logs/places-dev.log` from
   Jul 10 — `prisma:error` right after `findDuplicateEvent`). Reproduce with
   one of the failed Home visits, fix the root cause, and make Home exist:
   - Home's labeled location (from the user's Google export):
     name **"Home"**, address **451 Crestdale Ln, Las Vegas, NV 89144**,
     coordinates **lat 36.1772136, lng -115.3223031**, `type: "home"`.
   - The Home-semantic staged visits (aiEnrichment `category: "home"`,
     confidence 0.95) should link to that single Home place.

3. Verification (report these numbers in your handoff):
   - `Place` count before/after; staged visits still `pending` after.
   - No duplicate `googlePlaceId` rows (the unique index enforces it — zero
     constraint errors tolerated in the final run).
   - `places.lacollecteur.com/places` renders the new pins (deploy pattern:
     swap root `vercel.json` to the places variant, `vercel link --project
     life-os-places --yes`, `vercel --prod --yes`, then restore the persons
     variant — see git history of `vercel.json`).

## Task 2 — Legend toggle + solo/additive filtering

All in `LayerPanel.tsx` + `PlacesClient.tsx`. Current behavior: each legend
click independently toggles that layer.

1. **Collapsible legend**: add a small header/button to the panel that
   collapses it to a compact pill (and back). Persist collapsed state in a
   `legend=collapsed` URL param or localStorage — match the existing
   URL-param style used for `layers=`.
2. **Solo-then-additive filtering** (Google Maps layer behavior):
   - When **all layers are active** (the default), clicking one layer **solos
     it** — only that layer stays on.
   - When a subset is active, clicking an **inactive** layer **adds** it.
   - Clicking an **active** layer while a subset is active **removes** it;
     removing the last one restores **all** layers (never leave zero).
   - Add an explicit **"All"** affordance in the panel that restores every
     layer in one click.
   - Keep everything flowing through the existing `layers=` URL param so
     links stay shareable.
3. Visual affordance: inactive layers should look clearly dimmed; the panel
   should read as a legend (label + count) exactly as now.

## Constraints

- Do not touch `apps/persons` or the Era scripts beyond reading them.
- `npx turbo run build --filter=places` must pass typecheck.
- Test locally: `npm run dev` in `apps/places` (port 3002) with
  `LIFE_OS_LOCAL_REVIEW=1` already set in `.env.local` — it points at prod
  Turso, so writes are real; run any bulk promotion once and idempotently
  (re-runs must not duplicate).
- Finish with `npm run agent:finish -- --agent codex --summary "…" --next "…"`.
