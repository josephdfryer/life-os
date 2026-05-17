# Places Architecture Map

Places is the standalone Life OS app for the Place primitive. It lives in `apps/places`, uses the shared database in `packages/db`, and does not live inside the Persons app.

## Flow

```mermaid
flowchart TD
  Browser["Browser"] --> App["apps/places Next.js app"]
  App --> Auth["NextAuth Google OAuth"]
  App --> API["/api/places/*"]
  API --> Domain["apps/places/server/domain/places.ts"]
  App --> ImportAPI["/api/import/*"]
  ImportAPI --> ImportDomain["apps/places/server/domain/import.ts"]
  App --> EnrichAPI["/api/enrich"]
  EnrichAPI --> EnrichmentDomain["apps/places/server/domain/enrichment.ts"]
  Domain --> DB["packages/db shared Prisma client"]
  ImportDomain --> DB
  EnrichmentDomain --> Claude["Claude API location enrichment"]
  EnrichmentDomain --> DB

  Domain --> Place["Place"]
  Domain --> PlaceNote["PlaceNote"]
  Domain --> Event["Event"]
  Domain --> Interaction["Interaction"]
  Domain --> Group["Group and PlaceGroup"]
  Domain --> Item["Item via ItemInteraction"]
  ImportDomain --> ImportJob["ImportJob"]
  ImportDomain --> ImportStagedVisit["ImportStagedVisit"]
  ImportStagedVisit --> AI["aiEnrichment JSON result"]
```

## Rules

- Place stats are derived, never stored.
- `stats.totalSpend` comes from `Interaction.amount` on Events at each Place.
- Low map zoom rolls up affiliated Groups, mid zoom clusters nearby Places, and max zoom resolves individual Place pins.
- Places uses the same Google OAuth env vars as Persons and Stuff.
- All reads and writes carry `workspaceId`.
- Google Maps imports create `ImportJob` records, auto-create high-confidence Place + Event records, and stage ambiguous visits in `ImportStagedVisit`.
- Import confidence is conservative: 70%+ can become graph data automatically, 30%-69% waits for review, and lower-confidence noise is discarded.
- Device Timeline exports may only contain Google place IDs. The importer does not call Google Places API by default; unnamed visits are staged for human review instead of creating noisy places.
- Newer flat Google Timeline exports are supported as `timeline_records`. Preview reads only `visit` records, ignores `activity`, `timelinePath`, and `timelineMemory`, and shows estimated auto-create/stage/skip counts before anything is written.
- Unnamed visits are staged even when they have coordinates. Auto-create is reserved for high-confidence visits with a usable name such as Home, Work, Searched Address, or future place-enrichment labels.
- The map has five URL-toggleable layers: location, finance, photos, interactions, and enrichment. Location includes resolved Places plus unresolved coordinate visits; finance and photos are stubs until those integrations exist; interactions are derived from the shared Event/Interaction graph.
- Claude location enrichment runs asynchronously after imports and through `POST /api/enrich`. It writes only to `ImportStagedVisit.aiEnrichment` and uses conservative batch processing so import uploads are not blocked.
