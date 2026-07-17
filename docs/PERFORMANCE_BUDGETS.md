# Performance and query budgets

These are regression ceilings, not claims that the current code is fully optimized. Tighten them after each decomposition or pagination pass; do not raise one without an ADR or a measured reason.

| Surface | Current authored bytes (2026-07-16) | Ceiling |
|---|---:|---:|
| Persons Admin client | 43,334 | 50,000 |
| People import client | 43,393 | 50,000 |
| Places map client | 30,213 | 36,000 |
| Person detail client | 18,575 | 24,000 |

Production route JavaScript baselines on 2026-07-16 were 118,792 bytes for Persons Admin, 113,599 bytes for People import, and 654,568 bytes for Places map. Ceilings include shared chunks referenced by each route: 180 KB, 180 KB, and 750 KB respectively, uncompressed. CI measures these after the production build. Browser transfer sizes should be materially smaller due to compression, but uncompressed bytes are deterministic and catch dependency growth.

The repository currently permits at most 109 Prisma `findMany` calls without an explicit `take` or `cursor`. This is a ratchet over legacy debt: new unbounded reads fail CI. Query endpoints that return user-growing collections should use cursor pagination with a default at or below 100 and an absolute maximum at or below 500. Small, workspace-scoped configuration vocabularies may remain unpaginated when documented.

Critical route targets:

- Server/API p95 under 500 ms for normal workspace reads and under 2 s for explicit sync/import commands.
- No list API returns more than 500 records in one response.
- No newly introduced authored TypeScript/TSX module exceeds 1,200 lines; hotspot modules should trend downward.
- Map rendering culls off-screen markers and must keep projection/clustering pure-test coverage.

Run `npm run perf:check` for source and query budgets. After `npm run build`, run `npm run perf:check:built` for route chunk budgets.
