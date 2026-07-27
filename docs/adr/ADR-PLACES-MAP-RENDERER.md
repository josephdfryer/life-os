# ADR: Places map renderer

**Status:** Provisional — browser comparison required  
**Date:** July 27, 2026

## Context

Places currently renders OpenStreetMap raster tiles and HTML markers through a
small custom renderer. The product now needs stable selection, clustering,
keyboard controls, URL-restorable camera state, collision-aware labels, and
smooth interaction with materially more than the current 205 Places.

MapLibre GL JS is the leading replacement candidate. It would provide a mature
GPU-backed camera, touch handling, vector styling, symbol collision, and
clustering, but would also add a substantial rendering dependency and require a
visual migration. Existing custom-renderer investment is not a deciding factor.

## Evidence available

`npm run benchmark:map -w places` uses a deterministic 2,000-Place fixture and
120 moving-camera frames. On July 27, 2026, custom viewport projection plus
clustering measured:

| Metric | Result |
| --- | ---: |
| Median compute | 0.97 ms |
| p95 compute | 1.69 ms |
| Maximum compute | 10.80 ms |
| Frame compute budget | 16 ms |

The initial `/places` route references 680,279 uncompressed JavaScript bytes,
already below its 750,000-byte ceiling. Initial enrichment payloads now carry
only map-summary counts; details remain on the Place profile.

These measurements show that custom map mathematics are currently within the
frame compute budget. They do not measure DOM paint, tile loading, touch feel,
accessibility-tree cost, or mobile interaction.

## Provisional decision

Retain and harden the custom renderer until an instrumented browser comparison
is available. Do not add MapLibre to production based only on theoretical
advantages. Keep the domain payload and URL state renderer-neutral so MapLibre
remains a rendering substitution if it wins the visual benchmark.

The custom renderer must retain:

- deterministic cluster identity independent of input ordering;
- collision-aware labels with selected Places taking priority;
- viewport culling and bounded unresolved observations;
- one-frame camera scheduling;
- keyboard navigation and complete tile attribution;
- no detailed Interaction or financial records in the initial map payload.

## Required final comparison

At desktop, tablet, and mobile widths, compare the custom renderer and a
MapLibre proof using current data and the deterministic stress fixture:

- pan, wheel, pinch, and drag smoothness;
- touch behavior and accidental selection;
- clustering and label collision stability;
- keyboard and screen-reader behavior;
- tile failure and slow-network behavior;
- compressed bundle delta and hydration cost;
- ease of expressing Still styling;
- maintenance burden.

This ADR becomes Accepted only after those browser measurements are recorded.
