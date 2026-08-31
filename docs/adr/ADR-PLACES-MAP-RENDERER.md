# ADR: Places map renderer

**Status:** Accepted — live token-backed QA required

**Date:** August 30, 2026

## Context

Places rendered OpenStreetMap raster tiles and HTML markers through a custom
React renderer. The renderer preserved LifeOS semantics, but it also made the
app responsible for map tiles, attribution, camera gestures, touch behavior,
projection, collision handling, clustering, and viewport lifecycle.

The earlier ADR kept that renderer provisionally while comparing it with
MapLibre. The product direction subsequently selected Apple Maps. MapKit JS 6
now supplies Apple's web map renderer and a typed first-party loader.

## Decision

Use Apple MapKit JS 6 as the Places renderer through
`@apple/mapkit-loader`, loading `full-map` and `annotations` with the official
`load({ token })` path. Rejected tokens surface an error overlay instead of
falling back to a second tile provider.

MapKit owns:

- basemap rendering and attribution;
- pan, wheel, pinch, zoom, and keyboard interaction;
- native map controls and camera lifecycle;
- annotation collision and geographic clustering.

LifeOS continues to own:

- the Place, visit, and enrichment payloads;
- trusted Places versus unresolved-review modes;
- semantic Still marker colors and derived badges;
- selection, result rows, preview drawer, and memory profile navigation;
- explicit “Search this area” filtering;
- the renderer-neutral `lat`, `lng`, and `z` URL contract.

The server supplies `APPLE_MAPS_TOKEN` to the client component. Maps tokens are
browser credentials by design, so the Apple Developer configuration must
restrict the token to the Places production domain and any intentional local
review domains. The env value must be the MapKit JS JWT itself; a Maps ID or
token name will not authorize tiles. There is no OpenStreetMap fallback:
configuration failure is shown explicitly so production cannot silently drift
between renderers.

## Consequences

- High-frequency camera rendering no longer rerenders the React marker tree.
- Apple owns tile availability, attribution, map-label collision, and gesture
  behavior.
- The existing data/query APIs and profile payload boundaries do not change.
- MapKit's remotely loaded code is not represented by the historical local
  bundle-size or projection benchmark; live performance must be measured in the
  browser.
- Running Places locally or in production now requires an Apple Maps token.

## Verification status

Type checking, lint, camera/region contract tests, the complete Places test
suite, and a production build verify the local integration. Final desktop,
tablet, mobile, slow-network, and assistive-technology checks remain open until
a domain-restricted token is configured. Record those results under `PL-501` in
`docs/PLACES_WORLD_CLASS_PLAN.md`.
