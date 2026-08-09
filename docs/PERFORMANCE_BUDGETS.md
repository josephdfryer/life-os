# Performance and query budgets

These are regression ceilings, not claims that the current code is fully optimized. Tighten them after each decomposition or pagination pass; do not raise one without an ADR or a measured reason.

| Surface | Current authored bytes (2026-07-16) | Ceiling |
|---|---:|---:|
| Persons Admin client | 43,334 | 50,000 |
| People import client | 43,393 | 50,000 |
| Places map client | 31,456 | 33,000 |
| Place profile client | 26,787 | 30,000 |
| Person detail client | 18,575 | 24,000 |

Production route JavaScript baselines include 680,279 bytes for Places map and
657,909 bytes for the Place profile after the July 27 redesign. Their ceilings
are now 700 KB each, down from the prior 750 KB Places ceiling. CI measures
shared chunks referenced by each route after the production build. Browser
transfer sizes should be materially smaller due to compression, but uncompressed
bytes are deterministic and catch dependency growth.

The repository currently permits at most 109 Prisma `findMany` calls without an explicit `take` or `cursor`. This is a ratchet over legacy debt: new unbounded reads fail CI. Query endpoints that return user-growing collections should use cursor pagination with a default at or below 100 and an absolute maximum at or below 500. Small, workspace-scoped configuration vocabularies may remain unpaginated when documented.

Critical route targets:

- Server/API p95 under 500 ms for normal workspace reads and under 2 s for explicit sync/import commands.
- No list API returns more than 500 records in one response.
- No newly introduced authored TypeScript/TSX module exceeds 1,200 lines; hotspot modules should trend downward.
- Map rendering culls off-screen markers and must keep projection/clustering pure-test coverage.

Run `npm run perf:check` for source and query budgets. After `npm run build`, run `npm run perf:check:built` for route chunk budgets.

## Remaining query-debt classification (2026-08-08)

The current audit reports 133 unbounded `findMany` calls against the historical
109 ceiling; 87 are reachable from request paths. The count is a triage signal,
not permission to add arbitrary `take` caps. Every growing read must stay
complete through one of these treatments:

| Shape | Current examples | Proper treatment |
|---|---|---|
| Browsable lists | People data cleaning, merge review, plans | Cursor-paginate the response and migrate the UI to continuation state. |
| Complete bulk workflows | People export, import analysis, ingest, nickname migration, merge analysis | Process bounded batches until exhausted; export may stream, but must not silently omit rows. |
| Correctness-required summaries | Group event/financial rollups and Place membership/profile totals | Move counts and sums into SQL aggregates; do not cap the source rows. |
| Identity lookup | Gmail and Google Calendar build an email index by decoding every Person's JSON email list | Explore a normalized `PersonEmail` support table and backfill/dual-write migration in plan mode; preserve Person as the primitive and treat the table as a query index, not a new primitive. |
| Selective small reads | Health states for one person, group-place edges for one group | Measure cardinality and document the selective bound before deciding whether pagination adds value. |

The four high-volume list routes fixed in the August 8 pass (`/api/events`,
`/api/interactions`, `/api/v1/contacts`, and
`/api/v1/contacts/:id/interactions`) use keyset pagination rather than silent
caps. Continue ratcheting the global ceiling only after each classified slice
is implemented and verified.
