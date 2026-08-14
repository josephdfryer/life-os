# Photos ↔ Places Integration Plan

**Status:** Options explored · Apple Photos confirmed to be a partial library · August 13, 2026

## Bottom line

**Do not build a Google Photos API integration.** It cannot deliver what this feature needs,
for two independent reasons, either of which alone is fatal:

1. **Google Photos APIs have never exposed location.** Not the Library API, not the Picker API.
   A deliberate privacy decision, not a gap waiting to be filled. The Picker API returns
   dimensions, camera make/model, focal length, aperture, ISO, exposure time, and creation
   time — and no latitude, longitude, or `geoData` of any kind.
2. **The Library API stopped being able to read your library on March 31, 2025.** The
   `photoslibrary.readonly`, `photoslibrary.sharing`, and `photoslibrary` scopes were removed.
   Apps can now only see media *their own app uploaded*; old-scope calls return `403`.

Everything below routes around Google's API, not through it.

## The library is three eras, not one

Apple Photos is **not** a complete mirror of Google Photos. The history layers:

| Era | Lives in | GPS in the file? |
| --- | --- | --- |
| iPhone (recent) | Apple Photos **and** Google Photos | ✅ Yes |
| Android (middle) | Google Photos only | ✅ Yes — Android geotags |
| Digital camera (oldest) | Google Photos only | ❌ Almost certainly not |

This is the fact that shapes the whole plan. Two consequences:

- **osxphotos alone covers only the newest era.** It is still the right place to start — it is
  already built and already extracting coordinates — but it structurally cannot reach the
  Android or camera years.
- **The oldest era has no GPS to recover, at any price.** Consumer digital cameras did not
  geotag. No tool, export, or service can extract coordinates that were never written. Better
  Takeout tooling does not fix this; a different data source does (see Strategy 3).

## Options considered

| # | Option | Location data? | Verdict |
| --- | --- | --- | --- |
| A | Google Photos **Library API** | ❌ Never exposed | **Dead.** Also lost library read in March 2025 |
| B | Google Photos **Picker API** | ❌ Not in `mediaMetadata` | **Dead.** Also manual per-session picking — cannot enumerate a library |
| C | **Google Takeout** | ✅ `geoData` + `geoDataExif` | **The only path to the older eras.** Materially better than it used to be |
| D | **osxphotos** (Apple Photos) | ✅ Already extracting it | **Start here.** Already built — but iPhone era only |
| E | **iOS PhotoKit** | ✅ Full `CLLocation` | Live feed later; same era blind spot as D |
| F | **Immich** (self-hosted) | ✅ Real API with location | **The "another solution" answer.** v3.0 stable since July 2026 |
| G | **Maps Timeline correlation** | ⚠️ Inferred from timestamp | **The rescue for un-geotagged photos.** Uses data you already import |

## Two findings worth acting on

### Takeout now does scheduled *incremental* exports

This landed around June 2026 and changes Takeout from a painful one-off into a viable pipeline.
The first scheduled export is a full baseline; **subsequent exports contain only media uploaded,
backed up, created, or edited since the last one.** Archives run every two months for a year,
with delivery to a download link, Google Drive, Dropbox, Box, or OneDrive, and a 50 GB archive
size option for large libraries.

The old objection to Takeout — "no incremental sync, every refresh is a full re-download" — is
no longer true. It is now a reasonable ongoing feed for the non-Apple eras.

### `geoData` vs `geoDataExif` is the interesting field pair

Takeout sidecars carry both, and they are not the same thing:

- **`geoDataExif`** — what the camera actually wrote. Empty for the camera era.
- **`geoData`** — Google's working location, which **also includes locations Google estimated
  and locations you manually added.**

For the oldest photos, `geoDataExif` will be zeros while `geoData` may still hold something
usable. Read both, prefer `geoDataExif` when present, fall back to `geoData`, and record which
one you used — an estimate should not be presented with the same confidence as a camera fix.

Caveat: Google stopped using Location History to estimate locations for *new* photos and moved
to landmark recognition, so coverage here is uneven and skewed toward recognizable places.

## Recommended strategy

Four tracks. Track 1 ships alone; the rest are additive and independently useful.

### Strategy 1 — Apple Photos now (already built)

Promote the metadata `scripts/photos-sync.ts` already extracts from the per-day digest Note's
JSON blob into a real, queryable table. Covers the iPhone era, costs nothing, needs no export.

Full schema and resolution design in [Phases](#phases) below.

### Strategy 2 — Metadata-only Takeout for the back catalogue

Library reality: **20+ years, 2 TB+, and full ingestion is explicitly not the goal.** Only the
sidecar metadata matters. That reshapes this from a migration into a much smaller extraction job.

#### Export only the years that can pay off

Do not export 2 TB. Most of it cannot contribute to a place count:

| Era | Export it? | Why |
| --- | --- | --- |
| iPhone | ❌ No | Already covered free by osxphotos, today |
| Android | ✅ **Yes** | Real GPS, and Takeout is the only way to reach it |
| Digital camera | ⚠️ Marginal | No GPS was ever written; only `geoData` estimates, if any |

**The Android years are the entire value of this exercise.** That is likely 4–6 year-albums
rather than twenty, and it is the only slice where Takeout tells you something no other source can.

Takeout lets you select individual albums, and Google Photos auto-generates a **"Photos from
YYYY" album for every year**, which makes year-at-a-time export practical. There is a
[community JS snippet](https://github.com/kaedenbrinkman/google-takeout-photos-album-selector)
that auto-selects year albums in the Takeout UI. Watch the duplicate trap: checking both a named
album *and* its containing year exports those photos twice.

#### Download the sidecars, not the images

The sidecar JSON is ~1–2 KB per photo. Even at 200k photos that is a few hundred MB against a
2 TB archive — roughly **0.02%** of the bytes. ZIP's central directory makes it possible to fetch
only those entries via HTTP Range requests;
[`remotezip`](https://github.com/gtsystem/python-remotezip) subclasses `zipfile.ZipFile` and does
exactly this against any server that honours `Accept-Ranges`.

Two hard requirements:

- **Choose ZIP, not TGZ.** A `.tgz` is a single gzip stream with no random access — you would
  have to decompress all 2 TB sequentially to reach the JSONs. This choice is irreversible per
  export.
- **The numbered archives must be independently readable.** Sources conflict on whether Takeout's
  multi-part output is a set of standalone zips (`...-001.zip`, `-002.zip`) or a spanned archive
  (`.z01`, `.z02`) that must be concatenated first. Spanned archives would break per-file range
  extraction. **This is the one unresolved technical risk, and it is cheaply testable** — see
  "First step" below.

#### Storage constraint on the Drive route

Sending the export to Drive requires free Drive quota equal to the export size. Google Photos
already counts against that same Google One quota, so a full-library export to Drive would need
to *double* your storage. Year-chunking is therefore not just convenient, it is likely mandatory —
or skip Drive and range-read the download links directly.

**If Immich ever becomes the plan, download the images instead** — see Strategy 4.

### Strategy 3 — Timeline correlation for photos with no GPS

This is the one that rescues the camera era, and it needs no new data source.

You already import Google Maps Timeline into Places. `ImportStagedVisit` carries `startedAt`
and `endedAt`; high-confidence visits already become `Event`s with a `start`. A photo always has
a timestamp, even when it has no coordinates. So:

> photo taken at `T` → find the Timeline visit whose interval contains `T` → that visit's Place

This places a photo using **only its timestamp**, which is exactly the trick Google Photos itself
used before it switched to landmark recognition. It covers the Android era completely (Location
History was on by default) and reaches back as far as your Timeline data goes.

Confidence should be explicitly lower than a GPS fix — a `placeSource` of `gps` vs `timeline`
vs `google_estimate`, so a count can be filtered to "photos we actually know were here."

### Strategy 4 — Immich as the long-term answer

For "another solution in the future," Immich is now the credible one. It hit **v3.0.0 stable on
July 1, 2026** (following v2.0.0 in October 2025, which ended the years of "use at your own risk"
banners and committed to a stable schema with real upgrade paths). It is AGPL-3.0, free, has no
paid tier, runs face recognition and CLIP semantic search locally, has working location maps —
and, critically, **a real API that exposes location**.

The property that makes this cheap: **the Takeout export from Strategy 2 is the same artifact
that migrates you to Immich.** `immich-go` imports Google Takeout archives directly — it reads
ZIPs without unzipping, preserves GPS, capture date, albums, and favorites, and discards the
lower-resolution duplicates Takeout includes. Do the export once, use it twice.

That reframes Strategy 2: it is not throwaway gap-filling work, it is the first step of the exit
from Google Photos, whenever you decide to take it.

## Phases

### Phase 0 — Link out (hours)

"View in Google Photos" on the Place detail page → `https://photos.google.com/search/<place name>`.
Google Photos indexes place names, so its own search does the filtering. No schema, no sync, no API.

> ⚠️ **Undocumented URL form.** Widely used and works today, but Google could change it, and I
> could not verify it from here (needs a logged-in session). Check it in a browser before
> building the button, and treat it as a UI affordance, never a data dependency.

### Phase 1 — `PhotoAsset` table

A support table, not a ninth primitive — following the precedent stated explicitly in
[`FILE_INTELLIGENCE_PLAN.md`](FILE_INTELLIGENCE_PLAN.md). A photo is not a Person, Place, Item,
Event, Plan, Group, State, or Note.

```prisma
model PhotoAsset {
  id          String    @id @default(cuid())
  workspaceId String    @default("default-workspace")
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  source      String    // "osxphotos" | "photokit" | "takeout"
  sourceId    String    // osxphotos uuid / PHAsset.localIdentifier / takeout path
  filename    String?

  takenAt     DateTime?
  addedAt     DateTime?
  latitude    Float?
  longitude   Float?
  geoSource   String?   // "exif" | "google_estimate" | null

  placeId         String?
  place           Place?  @relation(fields: [placeId], references: [id])
  placeSource     String? // "gps" | "timeline" | "google_estimate"
  placeResolution String  @default("unresolved") // resolved | review | unresolved
  placeDistanceM  Float?

  favorite    Boolean @default(false)
  personNames String? // JSON array of face-recognition names, pre-resolution

  @@unique([workspaceId, source, sourceId])
  @@index([workspaceId, placeId])
  @@index([workspaceId, takenAt])
  @@index([workspaceId, latitude, longitude])
}
```

~30k photos ≈ 6 MB. Counts stay **derived** (`count({ where: { placeId } })`, index-backed),
honoring the standing rule in [`PLACES_ARCHITECTURE.md`](PLACES_ARCHITECTURE.md) that Place stats
are never stored. The day-digest Note behavior does not change — this is a second, additive
consumer of the same export.

The `source` / `sourceId` unique constraint is what lets osxphotos, Takeout, and PhotoKit all
write into one table without fighting. Expect iPhone-era photos to arrive from two sources;
dedupe on `(takenAt, filename)` when presenting counts.

### Phase 2 — Resolve photos to Places

Most of this exists. [`apps/places/server/domain/import.ts`](../apps/places/server/domain/import.ts)
already has `distanceMeters` (haversine, ~line 809), `findNearbyPlace` with a 50 m radius plus
name similarity, `coordinatesFromString` for the `{latitude, longitude}` JSON on
`Place.coordinates`, and a **confidence-tiered auto / stage / discard pattern** the Timeline
importer already uses for this exact shape of problem. Reuse it rather than inventing a second one.

| Signal | Action |
| --- | --- |
| GPS ≤ 25 m, single candidate | Resolve automatically |
| GPS 25–100 m, or multiple candidates | Stage for review |
| No GPS, but inside a Timeline visit interval | Resolve as `placeSource: "timeline"` |
| No GPS, no Timeline cover | Leave `unresolved` |

Three design points:

- **Match the most specific Place, not the nearest.** The hierarchy is Earth → Country → City →
  Home → Room. Every photo at home is also "in Las Vegas"; attaching it to the City is true and
  useless. Resolve to the deepest containing Place and let counts roll up.
- **Radius varies by Place type.** A Room is ~5 m, a Home ~30 m, a restaurant ~50 m, a City
  effectively unbounded. One global radius either misses rooms or swallows neighborhoods.
- **Keep unresolved photos and re-run resolution when Places change.** Resolution is a pure
  function of (photo, Place set, Timeline set). Adding a Place later should retroactively light
  up photos already sitting at those coordinates — which makes the unresolved pile an asset
  rather than a backlog.

**Bonus:** clusters of unresolved photos at a repeated coordinate are almost certainly places you
have not recorded. Feeding those into the existing `ImportStagedVisit` review flow turns the photo
library into a Place-discovery source, through UI that already exists.

### Phase 3 — iOS PhotoKit as the live feed

Once Phases 1–2 are proven against the Mac backfill, add a PhotoKit collector writing the same
`PhotoAsset` shape through the `LifeOSKit` outbox described in
[`IOS_PLATFORM_PLAN.md`](IOS_PLATFORM_PLAN.md). `PHAsset.location` is a full `CLLocation`;
`PHFetchOptions` enumerates incrementally.

Caveats: needs `NSPhotoLibraryUsageDescription` and **full** authorization (iOS 14+ limited
access would silently hand you a subset), and `location` is nil for screenshots and downloads.

Last, deliberately: it depends on in-flight iOS work and adds no era coverage that osxphotos
does not already have.

## How far this can actually be automated

**There is no API that creates a Google Photos export.** Verified across all three candidates:

- Library API — dead since March 2025, and never exposed location anyway.
- Picker API — manual per-session picking, no location.
- **Data Portability API** — Google's DMA-compliance export API does cover Chrome, Maps, Play,
  Search, Shopping, YouTube, Fitbit, Street View and more. **Google Photos is not among them.**
  The only "photos" scopes are for Maps contributions and Street View uploads.

So the boundary is fixed, and it falls in exactly one place:

| Step | Automatable? |
| --- | --- |
| Configure the export (albums, ZIP, size, destination) | ❌ Web UI only — **but scheduled exports mean once per year, not once per run** |
| Produce archives every 2 months, incrementally | ✅ Google does it |
| Deliver to Drive | ✅ Google does it |
| Detect new archives | ✅ Drive API |
| Extract sidecars, parse, load | ✅ Fully scriptable |
| Re-arm after the 1-year schedule lapses | ❌ Web UI, annually |

That is **one UI session per year** for a continuously-updating dataset. Good enough.

### Proposed job

`scripts/photos/takeout-metadata-sync.ts`, running on the existing scheduler beside `photos:sync`:

1. Drive API — list unprocessed archives in the Takeout folder.
2. Open each over HTTP Range (`remotezip`-style); read the central directory only.
3. Select `*.json` entries, range-fetch and inflate just those.
4. Parse `photoTakenTime`, `geoData`, `geoDataExif`, `people`, `favorited`.
5. Upsert `PhotoAsset` rows with `source: "takeout"`, preferring `geoDataExif` and marking
   `geoSource` when falling back to `geoData`.
6. Record the archive as processed; never re-read it.

Runtime cost is dominated by HTTP round-trips, not bytes. Idempotent by
`@@unique([workspaceId, source, sourceId])`, so a re-run is free.

### First step, before building any of it

Run **one small test export** — a single year album, ZIP format, smallest size option. It costs
minutes and settles the only real unknown:

- Are the numbered zips independently readable, or spanned?
- Do the download URLs (or Drive files) honour `Accept-Ranges: bytes`?
- What is the actual sidecar naming convention today (`*.supplemental-metadata.json` vs older
  forms), and does it truncate long filenames?
- How populated is `geoData` on genuinely old, un-geotagged photos?

If range-reading turns out to be blocked, the fallback is unglamorous but fine: download
year-chunks sequentially, extract sidecars, delete the archive, repeat. Slower and bandwidth-heavy,
same end state.

## Open questions

1. **How far back does your Google Maps Timeline go?** Sets the ceiling on Strategy 3 — the only
   thing that can place camera-era photos, which have no GPS to recover.
2. **Which years were the Android era?** Defines exactly which year-albums to export, and hence
   the whole size of this job.
3. **How many Places currently carry coordinates?** Places without `coordinates` can never match
   a photo; thin coverage caps Phase 2's yield until the Places themselves are enriched.
4. **Does `photos.google.com/search/<name>` work for your place names?** A ten-second check that
   decides whether Phase 0 is real.

To size the Apple-side coverage, run from a terminal with Full Disk Access:

```bash
python3 -c "
import osxphotos
p = osxphotos.PhotosDB().photos()
loc = [x for x in p if x.location and x.location[0] is not None]
print(f'total={len(p)} with_location={len(loc)} ({100*len(loc)/len(p):.1f}%)')
"
```
