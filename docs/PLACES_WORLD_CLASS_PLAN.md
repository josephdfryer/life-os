# Places — World-Class Product Plan

**Status:** Proposed  
**Created:** July 26, 2026  
**Scope:** `apps/places`, its Places APIs/domain layer, shared UI patterns used by
Places, and `docs/PLACES_ARCHITECTURE.md` when implementation changes the runtime
or product flow.

## North star

Places is the spatial memory interface for LifeOS.

> A Place is not a map pin. It is a living memory page.

The map helps someone find a Place. The Place profile helps them understand
their life there.

The finished product should make it effortless to:

- find a known Place;
- see where life has happened;
- understand when and how often a Place was visited;
- review unresolved location history without polluting the trusted map;
- move predictably between map, results, preview, and full memory page;
- connect visits to people, events, photos, spending, plans, and notes as those
  signals become available.

## Product principles

1. **Design for current data.** Do not give empty future integrations the same
   prominence as useful signals that exist now.
2. **Trusted Places and unresolved observations are different modes.** A pending
   location-history observation is not a Place until it has been resolved.
3. **One click, one predictable effect.** Clusters zoom, Places select, and the
   explicit open action navigates.
4. **The base map never disappears accidentally.** Enrichments decorate Places;
   they are not independent replacements for Places.
5. **Selection is durable.** Filters, map camera, selected Place, result ordering,
   and mode survive navigation where practical.
6. **Profiles organize memory, not database fields.** Visit chronology is primary;
   supporting graph signals appear in context.
7. **Empty states teach or get out of the way.** A section with no useful action
   should not dominate the page.
8. **Semantic honesty is non-negotiable.** Summaries remain deterministic unless
   the user explicitly records meaning.
9. **Mobile is a first-class interaction model.** Desktop sidebars become a
   bottom sheet, not content hidden below a tall map.
10. **Accessibility and performance are release criteria, not cleanup work.**

## Current baseline

Read-only production sizing on July 26, 2026:

| Signal | Current value |
| --- | ---: |
| Places | 205 |
| Places with coordinates | 205 |
| Place-linked Events | 399 |
| Pending unresolved visits | 166 |
| Favorites | 0 |
| Places with photos | 0 |
| Places with notes | 0 |
| Places with people | 1 |
| Financial Interactions at Places | 0 |

The Places test suite passes 18 of 18 tests. This means the primary problem is
product and interaction design, not failing domain logic.

### Known experience failures

- The first click on a layer solos it, but Finance, Photos, Interactions, and AI
  Enrichment are rendered as decorations on Location markers. Soloing one can
  therefore produce an apparently blank map.
- Four of the five primary filters currently return zero or one Place.
- Filter, selection, camera, and layer state use inconsistent persistence.
- A cluster click both changes the camera and selects an arbitrary first Place.
- The preview and full results list compete for the same sidebar.
- Raw pointer and wheel events can trigger repeated React camera updates and map
  recomputation.
- On mobile, selection feedback appears below a map that is at least 620px tall.
- Unexpected server errors can be presented as an empty map or “Place not found.”
- The profile gives substantial space to decorative or empty sections while the
  real visit history remains a conventional card list.
- The map client is still a large, interaction-dense component despite its earlier
  pure-computation extraction.

## Target information architecture

Places has three primary modes.

### Explore

The default trusted-Places experience:

- Search by Place name and address.
- Map/List/Split view on desktop.
- Map/List view toggle on mobile.
- Sort by Recent, Most visited, and A–Z.
- Filter by Place type, visit date, and visit count.
- Select a Place into a drawer or bottom sheet.
- Open the Place memory page explicitly.

### Review

A dedicated workflow for unresolved location history:

- Clear queue count and progress.
- Suggested Place identity and confidence.
- Nearby trusted Places.
- Merge into an existing Place.
- Create a new Place.
- Dismiss as noise.
- Safe batch actions only where confidence and domain rules permit.

### Memory

The Place profile:

- Place identity, address, favorite, and compact location map.
- Fact-grounded summary.
- Visit history grouped by time.
- People, groups, photos, spending, notes, and plans embedded where they explain
  a visit, plus compact rollups where useful.
- Explicit user-authored meaning.

## Control model

### Filters

Primary filters must be useful with current data:

- Search
- Place type
- Visit date or recency
- Visit count
- Map bounds (“Search this area”)

Filters that depend on sparse enrichments may appear under **More filters** only
when their result count is greater than zero:

- Favorites
- Has people
- Has photos
- Has notes
- Has spending
- Has plans

Every filter displays its prospective result count where practical. A user
should know that a filter will return zero before selecting it.

### Map views and enrichments

**Views** change the base visualization:

- Places
- Visit density
- Unresolved visits

**Enrichments** decorate the active trusted-Places view:

- People
- Photos
- Spending

Rules:

- Enrichments never hide the base Place markers.
- Controls with no data are hidden or disabled with an explanation.
- Unresolved visits are off by default in Explore and primary in Review.
- Layer/view state is represented in the URL.

### Click behavior

| Target | Result |
| --- | --- |
| Cluster | Zoom to cluster bounds; do not select an arbitrary Place |
| Place marker | Select Place and open preview |
| Result row | Select Place, reveal marker, and open preview |
| Selected Place | Stay selected through reclustering and minor map movement |
| Open memory | Navigate to Place profile |
| Close / Escape | Clear selection |
| Browser Back | Restore prior Explore state |

## Delivery roadmap

Work proceeds in order. A phase is complete only after its acceptance criteria
and verification gates pass.

### Phase 0 — Baseline, observability, and safety

**Goal:** Make improvements measurable and prevent regressions.

- [ ] `PL-000` Record desktop and mobile walkthroughs of the current production
  experience once browser automation is available.
- [ ] `PL-001` Add product-level interaction tests for layer/view behavior,
  selection, filter changes, cluster clicks, navigation return, and error states.
- [ ] `PL-002` Capture performance baselines for initial render, map interaction,
  filter response, selection response, route JavaScript, and `/api/places/map`
  payload size.
- [x] `PL-003` Add lightweight client measurements for slow map operations and
  failed Places requests without recording sensitive location contents.
- [x] `PL-004` Document the URL state contract for mode, filters, sort, view,
  selection, and camera.
- [ ] `PL-005` Define disposable test fixtures covering dense Places, sparse
  enrichments, unresolved visits, empty data, and server failures. Never use
  destructive cleanup against the configured production database.

**Acceptance criteria**

- The current interaction story can be replayed automatically at desktop and
  mobile widths.
- Performance and payload baselines are recorded in the repo.
- Test data can be created and discarded without touching real person, event,
  interaction, place, state, group, note, plan, or workspace data.

### Phase 1 — Fix broken and misleading interactions

**Goal:** Remove the highest-confidence sources of jank without redesigning the
entire product.

- [x] `PL-100` Replace soloable dependent layers with base Views and optional
  Enrichments.
- [x] `PL-101` Ensure no valid control combination produces a blank map unless
  there truly are no matching Places.
- [x] `PL-102` Make cluster clicks zoom only.
- [x] `PL-103` Establish an explicit no-selection state; do not silently treat the
  first result as selected.
- [x] `PL-104` Preserve selected Place through reclustering and map movement.
- [x] `PL-105` Add explicit loading, empty, authorization, not-found, and unexpected
  error states.
- [x] `PL-106` Remove or demote filters that currently have no useful results.
- [x] `PL-107` Add result counts to filter controls.
- [x] `PL-108` Throttle pan, wheel, pinch, resize, and camera updates through
  `requestAnimationFrame` or an equivalent single-frame scheduler.
- [x] `PL-109` Correct nested or simulated interactive elements, including the
  photo action rendered inside a marker button.
- [x] `PL-110` Add complete map attribution and keyboard-accessible map controls.

**Acceptance criteria**

- Every visible view/enrichment/filter control has predictable, useful output.
- No cluster click selects a Place.
- Selecting a Place takes one action and clearing it is explicit.
- Server failures cannot masquerade as legitimate empty data.
- Keyboard and pointer users can operate all non-spatial controls.
- Rapid map input does not schedule unbounded React updates.

### Phase 2 — Build the Explore experience

**Goal:** Make finding and comparing 205+ Places fast and calm.

- [x] `PL-200` Add debounced name/address search with immediate local feedback.
- [x] `PL-201` Add Recent, Most visited, and A–Z sorting.
- [x] `PL-202` Add current-data facets: Place type, last-visit range, first-visit
  range, and visit-count range.
- [x] `PL-203` Introduce Map, List, and Split views on desktop.
- [x] `PL-204` Build a result row showing name, type/location, last visit, visit
  count, and only the enrichment signals that exist.
- [x] `PL-205` Make map bounds and list results cooperate through an explicit
  “Search this area” action rather than surprising automatic filtering.
- [x] `PL-206` Add a selected-Place drawer on desktop.
- [x] `PL-207` Add a selected-Place bottom sheet on mobile.
- [x] `PL-208` Store mode, view, search, filters, sort, selected Place, and suitable
  camera state in the URL with a documented serialization format.
- [x] `PL-209` Restore Explore context when returning from a Place profile.
- [x] `PL-210` Add clear-all and individual removable filter chips.
- [x] `PL-211` Add purposeful empty results that explain which filters caused the
  empty set.

**Acceptance criteria**

- A Place can be found by name in one search interaction.
- A Place can be selected from either map or list with identical preview behavior.
- Opening a profile and returning restores the Explore context.
- Mobile selection feedback appears within the current viewport.
- Search, sort, and filtering remain responsive at a fixture size materially
  larger than current production data.

### Phase 3 — Turn unresolved visits into a review workflow

**Goal:** Convert 166 unresolved observations from visual noise into actionable
provenance-aware work.

- [x] `PL-300` Add Review as a first-class mode with pending count and progress.
- [x] `PL-301` Group nearby or repeated unresolved visits to reduce duplicate work.
- [x] `PL-302` Show date/time, duration when available, coordinates/address,
  import confidence, enrichment suggestion, and reasoning.
- [x] `PL-303` Show nearby trusted Places and the consequences of merging.
- [x] `PL-304` Support merge into existing Place.
- [x] `PL-305` Support creation of a new Place through the existing conservative
  domain flow.
- [x] `PL-306` Support dismissal as noise with a clear, recoverable status where
  the schema permits.
- [x] `PL-307` Add safe batch actions with preview, exact count, and confidence
  criteria. Never infer permission to delete core data.
- [x] `PL-308` Preserve import provenance from observation to accepted Event and
  Place.
- [x] `PL-309` Add optimistic progress only after API success is confirmed, with
  retryable failure handling.
- [x] `PL-310` Remove unresolved question-mark markers from the default Explore
  view; expose a restrained summary affordance instead.

**Acceptance criteria**

- Every pending observation has a visible path to merge, create, dismiss, or defer.
- Review actions cannot create duplicate Places or duplicate visit Events.
- Batch actions show the exact affected count before mutation.
- Accepted visits remain traceable to their import source.
- Explore remains focused on trusted Places.

### Phase 4 — Make the Place profile the product

**Goal:** Make a Place feel like a living, trustworthy memory page.

- [x] `PL-400` Replace the generic decorative hero with a compact identity header:
  name, address, type, favorite, and location map. Use real media only when real
  media exists.
- [x] `PL-401` Promote visit count, first visit, last visit, and visit cadence into
  the primary narrative.
- [x] `PL-402` Rebuild Memory thread as a chronological timeline grouped by year
  and month, with useful dense and sparse states.
- [x] `PL-403` Show visit duration and gaps when reliable source data permits.
- [x] `PL-404` Embed people, groups, photos, notes, and spending in the visit where
  they occurred.
- [x] `PL-405` Make linked Persons and Events navigable to their owning LifeOS
  surfaces.
- [x] `PL-406` Support adding a note to the Place or to a specific visit.
- [x] `PL-407` Add an explicit user-authored “Why this place matters” field or
  equivalent Note-backed interaction without AI-authored emotional claims.
- [x] `PL-408` Collapse or omit empty secondary sections; offer a compact
  “Add context” path where an action is possible.
- [x] `PL-409` Add compact rollups for people, groups, photos, spending, and plans
  only when populated.
- [x] `PL-410` Add previous/next navigation when the profile was opened from a
  filtered result set.
- [x] `PL-411` Improve note mutation feedback, validation, error recovery, and
  unsaved-edit protection.

**Acceptance criteria**

- A populated Place answers the six V1 questions without requiring the user to
  mentally assemble separate cards.
- Visit chronology is the dominant content.
- Empty integrations do not dominate the page.
- Every generated sentence is deterministically supported by stored facts.
- A user can author meaning without changing the semantic role of Place or Event.

### Phase 5 — Map foundation and performance decision

**Goal:** Choose and implement a map architecture that can remain world-class as
data and interaction complexity grow.

- [x] `PL-500` Replace the custom OpenStreetMap renderer with the selected Apple
  MapKit JS renderer while preserving the existing explorer contract.
- [ ] `PL-501` Verify pan/zoom smoothness, touch behavior, clustering, marker
  collision, accessibility, bundle cost, tile handling, maintenance burden, and
  visual integration with Still on the token-backed production domain.
- [x] `PL-502` Record the Apple MapKit JS decision in an ADR.
- [x] `PL-503` Remove high-frequency camera transforms from React and delegate
  them to MapKit's renderer.
- [x] `PL-504` Preserve the domain API, selection behavior, explicit area search,
  and URL camera contract so the change remains a rendering substitution.
- [x] `PL-505` Implement marker collision/label strategy and stable clustering.
- [x] `PL-506` Load or paginate expensive enrichment details on demand instead of
  sending every detail with the initial map.
- [x] `PL-507` Ratchet the existing Places performance budgets after the new
  baseline is proven.

**Decision rule**

Prefer the option that delivers demonstrably smoother desktop and mobile
interaction with the lower long-term maintenance burden. Existing investment in
custom computation is not, by itself, a reason to retain the renderer.

**Acceptance criteria**

- The chosen renderer meets recorded interaction and payload budgets.
- Map movement remains smooth at the stress-test fixture size.
- Selection and cluster identity remain stable across pan and zoom.
- The decision and tradeoffs are documented.

### Phase 6 — Visual refinement and release hardening

**Goal:** Turn the coherent product into a polished Still experience.

- [ ] `PL-600` Consolidate repeated inline styles into named Places components and
  Still-token-backed styles.
- [x] `PL-601` Establish a restrained Place marker, result row, drawer, bottom
  sheet, filter, timeline, and review-card visual system.
- [x] `PL-602` Remove legacy or arbitrary map colors where they do not encode a
  documented semantic distinction.
- [x] `PL-603` Add hover, pressed, focus, selected, loading, disabled, and error
  states for every interactive pattern.
- [ ] `PL-604` Perform visual QA at representative desktop, tablet, and mobile
  widths.
- [ ] `PL-605` Test keyboard-only use, screen-reader naming, reduced motion,
  contrast, touch target size, and zoomed text.
- [ ] `PL-606` Test slow network, tile failure, API failure, empty graph, sparse
  graph, dense urban graph, and long Place names/addresses.
- [ ] `PL-607` Update `docs/STILL_DESIGN_SYSTEM.md` if Places establishes a pattern
  that should be reused across two or more apps.
- [ ] `PL-608` Update `docs/PLACES_ARCHITECTURE.md` to match the final product and
  runtime flow.

**Acceptance criteria**

- Visual QA is completed, not inferred from code.
- All core flows are usable by keyboard and touch.
- Reduced-motion and error scenarios remain coherent.
- Architecture and design-system documentation match production.

## Verification matrix

Every implementation phase runs checks proportional to its scope.

| Area | Required verification |
| --- | --- |
| Pure map/filter logic | Focused unit tests |
| Places domain/API changes | Places domain tests and workspace-isolation tests |
| Client interactions | Browser tests at desktop and mobile widths |
| URL state | Direct-link, refresh, Back, Forward, invalid-param tests |
| Review mutations | Disposable-database integration tests, idempotency checks, exact affected counts |
| Accessibility | Keyboard walkthrough, automated checks, manual screen-reader spot check |
| Performance | Interaction trace, initial payload, route JS, API payload, stress fixture |
| Visual design | Screenshots and manual comparison against Still |
| Final phase gate | Lint, type-check, Places tests, production build, performance budgets |

No phase may claim visual completion when browser verification is unavailable.

## Suggested implementation boundaries

The current `PlacesClient.tsx` should become an orchestration shell rather than
the home for all map, URL, filtering, selection, and presentation logic.
Likely boundaries:

- `PlacesExplorer`
- `PlacesToolbar`
- `PlacesSearch`
- `PlacesFilters`
- `PlacesResults`
- `PlaceResultRow`
- `PlacesMap`
- `PlacePreviewDrawer`
- `PlacePreviewSheet`
- `PlacesReviewQueue`
- `usePlacesUrlState`
- pure search/filter/sort functions
- renderer adapter boundary for custom map versus MapLibre

These are suggested responsibilities, not mandatory filenames. Avoid premature
shared abstractions until a pattern is stable.

## Documentation obligations

Update these documents as implementation changes their subject:

- `docs/PLACES_ARCHITECTURE.md`
- `docs/PLACES_V1_SPEC.md` only when clarifying evolved product behavior rather
  than rewriting historical intent
- `docs/STILL_DESIGN_SYSTEM.md` for reusable cross-app patterns
- `docs/PERFORMANCE_BUDGETS.md`
- this plan's checkboxes and decision notes

## Definition of world-class

Places is ready when:

- search and selection feel immediate;
- every control has a clear purpose and truthful result;
- the map, list, preview, and profile behave as one continuous flow;
- unresolved imports are a calm review workflow, not map noise;
- returning from a profile restores context;
- mobile selection is as clear as desktop selection;
- Place profiles make visit history legible and personal without inventing
  meaning;
- sparse integrations stay quiet while rich integrations enhance the experience;
- interaction performance is measured and smooth;
- error, accessibility, and edge states feel designed rather than appended.
