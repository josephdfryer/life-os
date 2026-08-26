# Google Maps Takeout Import — Spec

## Overview

This spec covers importing Google Maps Timeline location history into LifeOS as Place + Event nodes.

**Critical context:** Google deprecated cloud-synced Timeline in late 2024. Location data now lives on-device only, and Takeout no longer produces the rich Semantic Location History export for new data. We must handle both formats.

---

## Input Formats

### Format 1 — Legacy Takeout (historical, pre-2025)

Monthly JSON files from Google Takeout at:
`Takeout/Location History (Timeline)/Semantic Location History/YYYY/YYYY_MONTH.json`

Each file contains a `timelineObjects` array of `placeVisit` and `activitySegment` entries.

**`placeVisit` fields we use:**

```json
{
  "placeVisit": {
    "location": {
      "name": "Blue Bottle Coffee",
      "address": "315 Linden St, San Francisco, CA 94102",
      "latitudeE7": 376160000,
      "longitudeE7": -1223920000,
      "placeId": "ChIJ...",
      "locationConfidence": 83.4
    },
    "duration": {
      "startTimestamp": "2023-09-14T14:32:00Z",
      "endTimestamp": "2023-09-14T15:08:00Z"
    },
    "visitConfidence": 79.2,
    "placeConfidence": "HIGH_CONFIDENCE",
    "userActivityType": "IN_PASSENGER_VEHICLE"
  }
}
```

**Derived unified confidence score (0–100):**
- `placeConfidence` = `HIGH_CONFIDENCE` → base 90
- `placeConfidence` = `MEDIUM_CONFIDENCE` → base 60
- `placeConfidence` = `LOW_CONFIDENCE` → base 30
- If `userActivityType` == `WALKING` → +5 bonus
- Blend with `visitConfidence` (average)

### Format 2 — On-device Timeline.json (2025+)

Exported from Google Maps app on phone. Much leaner — no name, no address.

```json
{
  "semanticSegments": [
    {
      "timelinePath": [...],
      "visit": {
        "topCandidate": {
          "placeId": "ChIJ...",
          "probability": 0.87
        },
        "hierarchyLevel": 0,
        "probability": 0.87
      },
      "startTime": "2025-01-15T14:32:00Z",
      "endTime": "2025-01-15T15:08:00Z"
    }
  ]
}
```

Confidence = `probability × 100`. Place name and address must be fetched from Google Places API using `placeId`, or left blank for manual naming (flagged on the Place node).

---

## Confidence Routing

| Score | Action |
|-------|--------|
| ≥ 70 | Auto-create Place + Event |
| 30–69 | Stage for review in `ImportStagedVisit` |
| < 30 | Discard (do not stage) |

**Special rules:**
- `userActivityType == "WALKING"` with ≥ 60 confidence → always auto-create (high signal)
- Duration < 5 minutes → halve the confidence score (transit stop, not a visit)
- Duration > 24 hours → cap confidence at 50 (likely a data artifact)

---

## Deduplication

**Primary key:** `location.placeId` (Google's stable place identifier)

**Fallback (Format 2 or missing placeId):** Round lat/lng to 4 decimal places (~11m grid) + date

**Event dedup:** If a Place node already has an Event with `startedAt` within 2 hours of the import timestamp, skip creating a duplicate Event.

---

## Data Model Changes

Two new Prisma models:

```prisma
model ImportJob {
  id            String   @id @default(cuid())
  workspaceId   String
  status        ImportJobStatus  // pending | running | done | failed
  format        String           // "legacy_takeout" | "device_timeline"
  filename      String
  totalRows     Int      @default(0)
  processedRows Int      @default(0)
  createdRows   Int      @default(0)
  stagedRows    Int      @default(0)
  skippedRows   Int      @default(0)
  errorRows     Int      @default(0)
  startedAt     DateTime?
  finishedAt    DateTime?
  createdAt     DateTime @default(now())

  workspace     Workspace @relation(fields: [workspaceId], references: [id])
  stagedVisits  ImportStagedVisit[]
}

enum ImportJobStatus {
  pending
  running
  done
  failed
}

model ImportStagedVisit {
  id            String   @id @default(cuid())
  importJobId   String
  workspaceId   String
  rawData       Json     // original placeVisit JSON
  placeName     String?
  placeAddress  String?
  latitude      Float?
  longitude     Float?
  googlePlaceId String?
  startedAt     DateTime
  endedAt       DateTime?
  confidence    Float
  status        StagedVisitStatus  // pending | accepted | rejected
  resolvedPlaceId String?  // set when accepted
  resolvedEventId String?  // set when accepted
  createdAt     DateTime @default(now())

  importJob     ImportJob @relation(fields: [importJobId], references: [id])
  workspace     Workspace @relation(fields: [workspaceId], references: [id])
  resolvedPlace Place?    @relation(fields: [resolvedPlaceId], references: [id])
}

enum StagedVisitStatus {
  pending
  accepted
  rejected
}
```

---

## Import Pipeline (server-side)

```
parseFile(buffer) → RawVisit[]
  ↓
normalizeConfidence(visit) → score 0–100
  ↓
filterDuration(visit) → apply min/max duration rules
  ↓
dedup(visit, workspaceId) → skip if already exists
  ↓
if score ≥ 70:
  upsertPlace(visit) → find or create Place node
  createEvent(visit) → create Event linked to Place
else if score ≥ 30:
  createStagedVisit(visit) → queue for review
else:
  discard
```

**Place upsert logic:**
1. Check for existing Place where `googlePlaceId` matches
2. If not found, check for existing Place where name fuzzy-matches AND coordinates within ~50m
3. If not found, create new Place node
4. Always update `googlePlaceId` on existing Place if missing

---

## Import UX

### Entry Point

In `apps/places`, add an "Import" button in the top nav.

Route: `/places/import`

### Upload Page (`/places/import`)

- File drag-and-drop zone accepting `.json` and `.zip`
- Auto-detects format (Legacy Takeout vs Device Timeline) by sniffing JSON structure
- For `.zip`: extract all matching monthly files automatically
- Shows preview: "Found 847 place visits across 14 months"
- Options:
  - Date range filter (default: last 5 years)
  - Confidence threshold slider (default: 70 auto-create, 30 minimum)
  - "Import" button → starts `ImportJob`

### Progress Page (`/places/import/[jobId]`)

Live progress bar. Shows:
- `processedRows / totalRows`
- `createdRows` created | `stagedRows` staged for review | `skippedRows` skipped
- On completion: CTA to review staged visits or view map

### Review Queue (`/places/import/[jobId]/review`)

Card-per-staged-visit UI:

```
[Place Name]              [Confidence: 52%]
[Address]
[Date/time range]         [Duration: 36 min]

[Map thumbnail]

[ Accept ]  [ Reject ]  [ Skip ]
```

Keyboard shortcuts: `a` = accept, `r` = reject, `s` = skip, `j`/`k` = navigate

Batch actions: "Accept all with confidence > 60%"

---

## Flood Protection Defaults

- **Max per import:** 10,000 auto-created events. If exceeded, pause and show warning.
- **Rate:** Process in batches of 100, with 100ms delay between batches (prevent DB lock)
- **Dedup window:** Skip any Place+Event where a matching import already ran within 24h
- **Backfill only:** Never create future-dated Events from import data

---

## Format Detection Logic

```ts
function detectFormat(json: unknown): 'legacy_takeout' | 'device_timeline' | 'unknown' {
  if (json?.timelineObjects) return 'legacy_takeout'
  if (json?.semanticSegments) return 'device_timeline'
  return 'unknown'
}
```

---

## API Routes

```
POST   /api/places/import              → create ImportJob, start processing
GET    /api/places/import/[jobId]      → job status + progress
GET    /api/places/import/[jobId]/staged → list staged visits (paginated)
PATCH  /api/places/import/[jobId]/staged/[visitId] → accept/reject staged visit
POST   /api/places/import/[jobId]/staged/bulk → bulk accept/reject
```

---

## Getting Your Google Maps Data

### Legacy (pre-2025 history):

1. Go to [takeout.google.com](https://takeout.google.com)
2. Deselect all → select only "Location History (Timeline)"
3. Export as JSON, choose zip format
4. Download and upload the zip directly — the importer handles extraction

### Current data (2025+):

1. Open Google Maps on your phone
2. Tap your profile photo → Timeline
3. Tap the three-dot menu → Export Timeline data
4. Share the `Timeline.json` file to yourself and upload it

---

## Implementation Notes

- Do NOT use Google Places API for name resolution unless the user has connected their own API key (cost concern). For Format 2 visits with only placeId, flag as "unnamed" and surface in the review queue.
- The `googlePlaceId` field needs to be added to the existing `Place` model as an optional unique field.
- All import processing runs server-side. The file upload endpoint streams to disk, not memory, to handle large exports.
- For the initial ship, legacy Takeout format is priority 1. Device Timeline is priority 2.
