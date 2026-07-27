# Places Performance Baseline

**Captured:** July 26, 2026  
**Purpose:** Starting point for `docs/PLACES_WORLD_CLASS_PLAN.md` Phase 0.

## Current measurements

| Measurement | Result | Context |
| --- | ---: | --- |
| Production build | Passed | Next.js 16.2.10, Turbopack |
| Places type-check | Passed | `tsc --noEmit` |
| Places tests | 21 passed | Pure explorer/map logic plus disposable-database domain tests |
| Local `/places` response | HTTP 200 | Local review mode, production-backed read only |
| Local server-rendered HTML | 308,090 bytes | Uncompressed development response |
| Local first request | 5.4 seconds | Development server: 1.434s framework/proxy, 3.8s application code |
| Places route JS after hardening | 680,279 bytes | Uncompressed production route chunks |
| Place profile route JS after memory redesign | 657,909 bytes | Uncompressed production route chunks |
| Ratcheted Places route JS ceiling | 700 KB | `docs/PERFORMANCE_BUDGETS.md` |
| `PlacesClient.tsx` authored source | 31,456 bytes | Ratcheted ceiling: 33,000 bytes |
| `PlaceProfileClient.tsx` authored source | 26,787 bytes | Ratcheted ceiling: 30,000 bytes |

The development request is not a production latency benchmark. It is useful as
evidence that the initial route performs substantial server/domain work and
serializes a large data set. Production navigation timing, compressed transfer,
hydration, input latency, pan/zoom frames, and mobile measurements remain open
until browser tooling is available.

The repo-wide `npm run perf:check` remains red because the current repository has
128 unbounded `findMany` calls against a historical budget of 109. The Places
client source and built route remain inside their existing individual budgets;
the global query-budget drift was not caused by this Places change and was not
papered over by raising the ceiling.

## Stress fixture target

Performance work should test at least:

- 2,000 trusted Places;
- 5,000 unresolved observations;
- 25,000 Place-linked Events;
- populated people, photo, and spending enrichments;
- dense urban clustering and geographically dispersed Places.

## Deterministic custom-renderer stress result

`npm run benchmark:map -w places` exercises 2,000 Places across 120 moving-camera
frames. On July 27, 2026, viewport projection plus stable clustering measured
0.97 ms median, 1.69 ms p95, and 10.80 ms maximum. This is inside the 16 ms compute
budget, but it excludes DOM paint, tile loading, touch feel, and hydration.
Those browser measurements remain required before accepting the renderer ADR.

## Metrics to ratchet

- server time for `getPlacesForMap` and `getMapLayerData`;
- `/api/places/map` response bytes;
- server-rendered HTML and RSC payload bytes;
- route JavaScript;
- time to usable search;
- search/filter response;
- selection response;
- sustained pan/zoom frame behavior;
- mobile bottom-sheet response.

No performance budget should be loosened merely to accommodate the redesign.
New ceilings should be set only after a measured implementation demonstrates a
better interaction story.
