# Places V1 — Product Spec

## Product Thesis

Places is the spatial interface for LifeOS. A Place is not a map pin. It is a living memory page.

The V1 goal: **make a place feel alive.**

A Place should answer:
- When was I here?
- What happened here?
- Who was I with?
- What groups connect to this place?
- What did I spend here?
- Why does this place matter?

Do NOT build a generic map app. The emotional center is the Place Profile. The map is just the entry point.

---

## Context

LifeOS is a personal graph OS built on 6 primitives: Person, Group, Place, Object, Event, Plan. The core edge is Interaction (Person → Event with personal metadata). Read `docs/LIFE_OS_VISION.md` for the full philosophical foundation.

The Group primitive was recently added. Schema includes: Group, PlaceGroup, PersonGroup, GroupGroup. Person represents humans ONLY — groups/organizations/merchants are Group nodes, not Person nodes.

---

## Where to Build

Build Places as a standalone app at `apps/places`. It should follow the same monorepo pattern as `apps/persons` and `apps/stuff`: its own Next.js app, its own `auth.ts` and login route, its own `/api/places/*` routes, and the shared database through `packages/db`.

Do not put Places routes or Places domain code inside `apps/persons`. Persons remains the People/CRM app.

---

## Step 1: Inspect Before Coding

Read:
- `docs/LIFE_OS_VISION.md`
- `packages/db/prisma/schema.prisma`
- `apps/persons/AGENTS.md` for shared auth/workspace patterns
- `apps/stuff/` structure for standalone sibling-app layout
- `apps/places/AGENTS.md` once it exists
- Run `npm run agent:start -- --agent codex`

---

## Step 2: Schema Addition

Add `PlaceNote` model:

```prisma
model PlaceNote {
  id          String    @id @default(cuid())
  placeId     String
  workspaceId String
  body        String
  eventId     String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  place       Place     @relation(fields: [placeId], references: [id])
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  event       Event?    @relation(fields: [eventId], references: [id])
}
```

Run `prisma migrate dev --name add_place_notes`.

---

## Step 3: Data Query Layer

All stats are **derived**. Never store visitCount, personCount, etc. as fields. Always compute from the graph.

### `getPlacesForMap(workspaceId)`

Returns `PlaceMapItem[]`:

```ts
type PlaceMapItem = {
  id: string
  name: string
  latitude?: number
  longitude?: number
  address?: string
  placeType?: string
  favorite?: boolean
  stats: {
    visitCount: number       // Events at this Place
    photoCount: number       // Objects with media type linked to Events at this Place
    personCount: number      // distinct Persons with Interactions on Events at this Place
    groupCount: number       // PlaceGroup count + distinct activity groups
    noteCount: number        // PlaceNote count
    planCount: number        // Plans linked to this Place
    lastVisitAt?: string
  }
  weight: number             // visitCount*3 + photoCount*1 + personCount*5 + groupCount*4 + noteCount*8 + planCount*6
  thumbnailUrl?: string
}
```

### `getPlaceProfile(placeId, workspaceId)`

Returns `PlaceProfile`:

```ts
type PlaceProfile = {
  place: Place
  stats: {
    visitCount: number
    photoCount: number
    personCount: number
    groupCount: number
    noteCount: number
    planCount: number
    firstVisitAt?: string
    lastVisitAt?: string
    totalSpend?: number      // sum of Interaction.amount on Events at this Place
  }
  timeline: PlaceTimelineItem[]
  people: PlacePersonSummary[]
  groups: {
    affiliated: PlaceGroupSummary[]   // from PlaceGroup
    activity: PlaceGroupSummary[]     // from Event groupTags OR membership inference
  }
  photos: PlacePhotoSummary[]
  notes: PlaceNote[]
  plans: PlacePlanSummary[]
}

type PlaceTimelineItem = {
  eventId: string
  title: string              // event title or fallback: "Visit to [place name]"
  startedAt: string
  endedAt?: string
  people: { id: string; name: string }[]
  groups: { id: string; name: string; associationType: "explicit_tag" | "inferred" | "place_affiliation" }[]
  photoCount: number
  spendAmount?: number
  notePreview?: string
}

type PlacePersonSummary = {
  personId: string
  name: string
  sharedEventCount: number
  lastSharedEventAt?: string
}

type PlaceGroupSummary = {
  groupId: string
  name: string
  groupType: string
  relationshipType?: string  // for affiliated groups
  eventCount?: number        // for activity groups
}
```

**Group logic:**
- Affiliated groups: `PlaceGroup` where `placeId` matches
- Activity groups: Events at this Place where EITHER (a) the Event has the group in `groupTags`, OR (b) ≥50% of currently-active group members had Interactions on that Event

### Notes CRUD

```ts
createPlaceNote(placeId, workspaceId, body, opts?: { eventId? })
updatePlaceNote(noteId, workspaceId, body)
deletePlaceNote(noteId, workspaceId)
```

---

## Step 4: Map Page `/places`

Layout:
- Map canvas showing Place markers
- If an existing map library is in the project, use it
- If no map library exists, stub a clean leaflet/mapbox-ready shell component (don't block on this)
- Marker visual weight based on `weight` score
- Click marker → Place Preview card

Place Preview card:
- Place name
- Address / general location
- Visit count, photo count, person count
- Last visit date
- Primary thumbnail if available
- "Open" button → navigates to Place Profile

Basic filters (top of page):
- All / Favorites / Has photos / Has people / Has notes

Empty state (no places):
> No places yet. Import location history or create your first place to start building your private map.

---

## Step 5: Place Profile `/places/:placeId`

**This is the product.** Make it feel like a living memory page, not a database record.

Sections:

### Header
- Place name
- Address or general location
- Place type if available
- Favorite toggle (star)
- First visit date / Last visit date
- Visit count · Photo count · Person count · Group count

### Summary Card
Deterministic text only. Examples:
- "You've visited 7 times since March 2020."
- "Most visits were with Qin."
- "142 photos connected to this place."
- "You haven't visited since October 2024."

**Never hallucinate emotional meaning.** Do not write "This is one of your most meaningful places" unless the user explicitly tagged it that way.

### Timeline
- Chronological list of Events at this Place
- Newest first
- Each item: event title (or fallback "Visit to [place name]"), date, people, groups, photo count, spend if available
- Empty state: "No events connected to this place yet."

### Photos
- Thumbnails of Objects with media type linked to Events at this Place
- Grouped by event/visit if possible
- Empty state: "No photos connected to this place yet."

### People
- Persons who had Interactions at Events at this Place
- Each: name, shared visit count, last seen here
- Empty state: "No people connected to this place yet."

### Groups
Two subsections:
- **Affiliated** (from PlaceGroup): e.g., Starbucks Corp, Toyota Industries
- **Activity** (from Event groupTags or inference): e.g., Fryer Family, Sight Machine
- Empty state: "No groups connected to this place yet."

### Spending
- Total spend (derived from sum of Interaction.amount on Events at this Place)
- Breakdown by event if available
- Placeholder if no Era integration yet: "Connect Era Finance to see spending at this place."

### Notes
- List of PlaceNote records
- Add note form (textarea + save button)
- Edit inline or on click
- Delete with confirmation
- Empty state: "No memories added yet. Add a note to remember why this place matters."

### Plans
- Future Plans connected to this Place
- Each: title, planned date if available
- Empty state: "No plans connected to this place yet."

---

## Step 6: API Routes

Follow existing REST pattern in `apps/persons/app/api/`.

```
GET    /api/places/map           → getPlacesForMap
GET    /api/places/[id]/profile  → getPlaceProfile
POST   /api/places/[id]/notes    → createPlaceNote
PATCH  /api/places/[id]/notes/[noteId] → updatePlaceNote
DELETE /api/places/[id]/notes/[noteId] → deletePlaceNote
POST   /api/places/[id]/favorite  → toggle favorite
```

All routes filter by authenticated workspaceId. Follow existing auth middleware pattern.

---

## Step 7: Tests

- `getPlacesForMap` returns places with correct derived stats
- `getPlaceProfile` returns correct visitCount, personCount, totalSpend
- Timeline includes Events at the selected Place, newest first
- People summary counts shared Events correctly
- Affiliated groups come from PlaceGroup
- Activity groups come from Event groupTags (explicit) and membership inference (inferred)
- Notes: create → appears on profile; update → body changes; delete → removed
- Empty states render when sections have no data

---

## Key Constraints

1. **Follow existing repo patterns** — routing, API style, auth, Prisma conventions. No parallel architecture.
2. **Groups ≠ Persons.** Person = humans only. Use Group/PlaceGroup for companies, families, teams.
3. **No groupId on Interaction.** Group rollups are derived through Person membership + Event participation.
4. **No stored aggregates.** All stats computed fresh from the graph.
5. **Workspace isolation** on every query.
6. **Deterministic summaries only** — no inferred emotional meaning without user confirmation.
7. **Clear empty states** on every section.
8. **The Place Profile is the product.** Prioritize making it feel alive over map features.

---

## Acceptance Criteria

**Map:**
- `/places` loads with map showing Place markers
- Clicking a marker shows preview card
- Preview shows name, stats, last visit, open action
- User can navigate to Place Profile from preview

**Place Profile:**
- `/places/:placeId` loads the full profile
- Header shows name, location, derived stats
- Deterministic summary card
- Timeline with Events at the Place
- People with shared visit counts
- Affiliated and Activity groups shown separately
- Notes with add/edit/delete
- Empty states on every empty section

**Data integrity:**
- All stats derived, none stored
- Existing Person/Event/Interaction/Place data unchanged
- No groupId on Interaction

**Validation:**
- `npm run lint` passes
- `npm run typecheck` passes
- Tests pass

---

## After Finishing

Summarize:
- Files changed
- Assumptions made
- Validation results
- Anything intentionally deferred

Leave handoff:
```
npm run agent:finish -- --agent codex --summary "Places V1: [what was built]" --next "Integrations that can now attach: Google Location History → Places/Events, Google Photos → Objects, Calendar → Events/Plans, Era transactions → spend on Interactions at Events at Places"
```
