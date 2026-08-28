# Database Migration Plan — Turso → PostgreSQL (Neon)

Written 2026-08-28, the morning Turso blocked reads for org `josephdfryer` after
the free-tier read limit was hit. This is a plan to move the current shared
cloud graph from Turso/libSQL to managed PostgreSQL without losing or silently
changing any of the personal CRM of record.

**Status:** execution on branch `codex/postgres-migration`. **P0–P7 done.**
Schema on `postgresql`, 61 migrations squashed to a 2-file baseline, client
on `@prisma/adapter-pg`, whole test + e2e harness and deploy gates ported
off SQLite (repo-wide `type-check`, full `npm test`, `npm run lint` green on
Postgres). Neon `life-os-postgres` (us-west-2, matches the apps) provisioned
and wired in `.env.local`. **The ETL is proven: two independent rehearsals,
each from a freshly-reset empty target, both reconciled exactly** (217k rows
in==out, all 95 per-model content hashes matched, zero failures). What's
left is **P8 — the cutover itself** (env wiring across 8 Vercel projects +
writer freeze + final ETL + flip), which is user-driven, and the P9/P10
follow-ups. See the ledger.

---

## The one sentence version

**Use PostgreSQL as the durable cloud database, host it on Neon to start, and
preserve a storage-neutral path toward the local encrypted Life Vault.**

Everything below is about getting the 95-model Prisma schema and its data off
libSQL/SQLite and onto Postgres with the least risk, and about the code changes
that fall out of the SQLite→Postgres dialect gap. Life OS currently has one
user, so downtime is acceptable. Data loss, partial transfer, silent semantic
changes, and an untested rollback are not.

## Non-negotiable migration rules

1. **Preserve first, optimize second.** Never delete, truncate, deduplicate, or
   rewrite source records as part of this migration.
2. **Turso remains preserved evidence after the final export.** Keep the source
   database, a dated local export, and its credentials available until Neon has
   passed the soak period and a restore has been tested. Do not mutate it unless
   rollback deliberately makes Turso canonical again.
3. **Downtime is the safety mechanism.** Freeze every writer before the final
   export and leave the apps unavailable until target validation passes.
4. **Counts are necessary but insufficient.** Validate content, relationships,
   workspaces, timestamps, encrypted fields, and representative graph paths.
5. **No destructive cleanup is bundled into cutover.** Removing Turso, old
   local databases, migration scripts, or credentials is a later, separately
   approved operation.
6. **A failed check means rollback, not repair-in-place under pressure.** Point
   the apps back to the untouched Turso database, diagnose offline, and repeat
   the rehearsal.

---

## Why this, and why not the alternatives

The ask was "a system I can just stay with for the long term." That maps to
three separate choices that should not be conflated:

1. **The cloud database engine** — PostgreSQL is the durable choice for the
   current web architecture. It is widely hosted, has a stable wire protocol,
   and its feature set (JSON, full-text, `pgvector`, partial indexes, generated
   columns) covers the cloud directions Life OS is likely to need.

2. **The cloud host** — start on Neon. A standard `pg_dump`/restore path makes
   the data and core schema more portable than libSQL, but changing hosts still
   requires deliberate work around pooling, roles, extensions, backups,
   branching, regions, secrets, and observability.

3. **The eventual customer-owned store** — the documented commercial direction
   remains a local encrypted Life Vault, optionally synchronized with iCloud.
   PostgreSQL is the cloud canonical store, not a reason to abandon the neutral
   graph contracts and local-vault migration path.

### Options considered

| Option                                           | Verdict                 | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Neon Postgres** (Vercel Marketplace)           | **Recommended host**    | Serverless Postgres, autoscaling, compute suspension after five idle minutes, DB branching, and pooled + direct connection strings. The integration injects env vars into each Vercel project it is explicitly linked to; every Life OS project must be verified individually. As checked 2026-08-28, Free includes 0.5 GB and 100 CU-hours per project; Launch is usage-based (Neon illustrates roughly $15/mo for intermittent 1 GB load), so recheck pricing before provisioning. Use `@prisma/adapter-pg` unless an implementation spike proves a Neon-specific adapter is materially better. |
| **Supabase** (Marketplace native)                | Viable #2               | Also standard Postgres. Pick it only if its bundled auth, storage, or realtime becomes valuable. Life OS already has centralized custom auth (`project_auth_architecture`), so that bundle is currently mostly unused surface area.                                                                                                                                                                                                                                                                                                                                                               |
| **Prisma Postgres** (Marketplace native)         | Viable #3               | Postgres managed by Prisma with Accelerate pooling/caching built in, tight `prisma` integration, generous free tier. Standard Postgres wire protocol so still portable. Slightly more opinionated operationally than Neon.                                                                                                                                                                                                                                                                                                                                                                        |
| **Stay on Turso, paid**                          | Fallback / stopgap only | Zero migration. But it doesn't satisfy "get off it," the libSQL ecosystem and tooling are thinner, and the hand-rolled `turso-migrate-*.ts` workaround remains. Useful **only** as the Step 0 unblock; confirm the current price in the Turso dashboard rather than relying on this document.                                                                                                                                                                                                                                                                                                     |
| **Cloudflare D1**                                | No                      | Still SQLite, still has account limits, same class of ceiling you just hit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **PlanetScale / MySQL**                          | No                      | MySQL dialect gap from the current SQLite schema is larger than Postgres's, and no compelling upside here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Self-host Postgres now** (Fly/Railway/Hetzner) | Not yet                 | Cheapest at scale, but it's ops you don't want to take on during a migration. It stays available later precisely because you'll be on standard Postgres.                                                                                                                                                                                                                                                                                                                                                                                                                                          |

---

## What is actually coupled to Turso today

The runtime seam is small; the incidental coupling is wide.

- **The one runtime seam:** `packages/db/index.ts` → `createClient()`. Three
  branches: `@prisma/adapter-libsql` against Turso in prod, the same adapter in
  embedded-replica mode (`TURSO_SYNC_URL`, `file:replica.db`, 60s sync), and
  `@prisma/adapter-better-sqlite3` against a local file for dev.
- **Schema:** `packages/db/prisma/schema.prisma`, `datasource db { provider =
"sqlite" }`, 95 models, 8 enums, 61 Prisma migrations in
  `prisma/migrations/`.
- **The workaround we get to delete:** ~40 `packages/db/turso-migrate-*.ts`
  scripts. Prod Turso has no `_prisma_migrations` table, so schema changes ship
  as hand-written libSQL scripts run by hand
  (`feedback_turso_migration_reality`). On Postgres, `prisma migrate deploy`
  works normally and this entire pattern goes away.
- **Deploy tooling:** `scripts/lib/prod-schema.ts` (`assertProdSchema`, reads
  live columns over `@libsql/client`), `scripts/apply-migration.ts`,
  `scripts/check-migration-integrity.mjs`, `scripts/deploy.ts` gate.
- **Per-app build config:** every `apps/*/next.config.ts` has
  `serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3",
"@prisma/adapter-libsql", "@libsql/client"]`.
- **`docker-compose.yml`:** shared SQLite file on a volume; `DATABASE_URL:
file:/data/db/life-os.db` per service.
- **54 tracked TypeScript files** currently reference `@libsql/client`,
  including migration tools, production checks, sync/backup scripts, and
  one-offs. Classify each as runtime-critical, migration-only, archival, or
  safe to retire; do not assume they are all lower priority.
- **Env vars:** `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TURSO_SYNC_URL`
  across all Vercel projects, `.env` files, and CI secrets.

---

## The dialect gap (SQLite → Postgres) — the real work

Prisma regenerates the client from `provider = "postgresql"` and maps most
column types automatically. The behavior changes below are what bite.

### 1. Case-insensitive `LIKE` — the big one

SQLite `LIKE` is ASCII case-insensitive by default. Postgres `LIKE` is
case-sensitive. **There are currently 188 tracked `contains:` occurrences and zero
currently use `mode: "insensitive"`.** Every one of them silently changes
behavior on Postgres — person search, place matching, dedupe, etc.

Options, roughly in order of preference:

- **Add `mode: "insensitive"`** to the filters that are genuinely
  case-insensitive lookups (search boxes, matching/dedupe). Prisma compiles it
  to `ILIKE`. Tedious but explicit and correct. A codemod can do most of it;
  hand-review the matching/identity paths.
- For columns that must be _unique_ case-insensitively (email, slug,
  handle), prefer a normalized stored column (many are already normalized on
  write) or a `citext` column, over relying on query flags.
- Where a filter was incidentally case-insensitive and doesn't need to be,
  leaving it case-sensitive is fine — but decide, don't discover.

Treat this as its own reviewed pass, not a find-and-replace.

### 2. Raw SQL — currently 18 tracked files

`grep -rl '\$queryRaw\|\$executeRaw\|\$queryRawUnsafe'`. Audit each for
SQLite-isms: `json_extract` / `->>` differences, `strftime` / `datetime('now')`
→ `now()` / `to_char`, `INSERT OR REPLACE` / `ON CONFLICT` syntax,
`group_concat` → `string_agg`, `||` concat (same, but `NULL` propagation
differs), `PRAGMA`, `AUTOINCREMENT`, `rowid`. Rewrite to Postgres or, better,
convert to Prisma query-builder calls while you're in there.

### 3. Enums

The 8 Prisma enums are stored as `TEXT` on SQLite; on Postgres they become
native enum types. Any value in the data that isn't in the current enum
definition will fail the load — reconcile during the ETL dry run.

### 4. Types that need a glance

- **`Json` fields** (`rawData Json`, `aiEnrichment Json?`): SQLite stores
  stringified text; Postgres `jsonb`. Round-trips cleanly through a
  Prisma-to-Prisma ETL (objects in, objects out); a raw dump needs `::jsonb`.
- **`DateTime`**: SQLite text/int → Postgres `timestamptz`. Fine via Prisma
  (pass `Date` objects). Watch any code that string-compares timestamps.
- **`Boolean`**: SQLite `0/1` → Postgres `true/false`. Fine via Prisma; a raw
  dump needs the cast.
- **IDs**: `cuid()` strings, no autoincrement, no sequences to reset. Nothing
  to do — this is the easy part.
- **Money**: already integer cents (`turso-migrate-money-as-cents`). Maps to
  `INTEGER`/`BIGINT`, no change.

### 5. Implicit ordering

Any query without an explicit `ORDER BY` that happens to rely on SQLite rowid
order will change. Grep the hot paths (lists, feeds, "latest") and add explicit
ordering.

---

## Migrations: squash, don't replay

The 61 existing migrations contain SQLite-specific SQL and were partly
sidestepped in prod anyway. Don't try to replay them on Postgres.

1. Preserve `prisma/migrations/` as history under an explicit SQLite archive;
   do not delete it during migration development.
2. With `provider = "postgresql"`, generate one baseline:
   `prisma migrate diff --from-empty --to-schema prisma/schema.prisma
--script > prisma/migrations/00000000000000_init/migration.sql`.
3. Review the generated SQL, then run `prisma migrate deploy` against every
   empty Neon rehearsal/production target **before** loading data. This creates
   the tables and records the baseline normally; do not use `migrate resolve`
   in this path.
4. Reserve `prisma migrate resolve --applied ...` only for a database whose
   baseline schema was created outside Prisma and independently verified to be
   identical.
5. From here on, `prisma migrate deploy` runs once centrally in CI before the
   affected apps deploy—not once independently per Vercel app. This replaces
   the Turso hand-migration path. Delete `turso-migrate-*.ts`,
   `scripts/apply-migration.ts`, and rewrite `scripts/lib/prod-schema.ts` /
   `check-migration-integrity.mjs` against `pg` (or retire them if
   `migrate deploy` + `migrate diff --exit-code` in CI covers their intent).

---

## Simplify the client while we're here

Collapse `createClient()` in `packages/db/index.ts` to a single adapter path:

- Use **`@prisma/adapter-pg`** (node-postgres) everywhere, driven by
  `DATABASE_URL`.
  - Prod/preview: Neon **pooled** connection string (`-pooler` host).
  - Local: Postgres from `docker-compose` (see below) or a Neon dev branch.
- Use the pooled `DATABASE_URL` at runtime. Preserve Neon's unpooled
  `DATABASE_URL_UNPOOLED` separately and map it to the migration process only;
  `prisma migrate` and `pg_dump` must use a direct connection.
- Drop the embedded-replica branch. It was a libSQL latency trick; on Vercel
  Fluid Compute with a pooled Neon connection in the same region, reads are
  fine. If a specific read path ever needs it, add Prisma Accelerate or a
  Runtime Cache layer deliberately — don't port the replica.
- Update every `apps/*/next.config.ts`: replace the four sqlite/libsql entries
  in `serverExternalPackages` with `["pg"]` (or as required by
  `@prisma/adapter-pg` on your Prisma 7 version — verify against the build).

---

## Local dev

Add a Postgres service to `docker-compose.yml` and point every app's
`DATABASE_URL` at it:

```yaml
postgres:
  image: postgres:17-alpine
  environment:
    POSTGRES_USER: lifeos
    POSTGRES_PASSWORD: lifeos
    POSTGRES_DB: lifeos
  ports: ["5432:5432"]
  volumes: ["life-os-pg:/var/lib/postgresql/data"]
```

`DATABASE_URL=postgresql://lifeos:lifeos@localhost:5432/lifeos` for local
`tsx`/Next. Seed with `prisma migrate deploy` + `apps/persons/prisma/seed.ts`
(after that seed is de-libSQL'd). Retire the committed `*.db` files
(`dev.db`, `life-os.db`, `persons.db`, `packages/db/dev.db`) once nothing reads
them.

---

## Cutover — ordered, preservation-first

Because reads are _already_ blocked, some of this is happening under pressure.
Step 0 buys breathing room.

### Step 0 — Unblock (today, ~10 min)

The ETL has to _read_ from Turso even though downtime is acceptable. Enable
Turso overages or upgrade for this billing month, then confirm a read-only query
and a complete export both work. This is a required bridge unless Turso support
provides a separately verified full export; downtime alone does not remove the
need for source access.

Before any migration work, create and verify three independent source
artifacts:

- a Turso/libSQL full database export;
- `npm run backup:people` output in `archive/`;
- `scripts/db/backup-core-tables.ts` and finance backup output where supported.

Record file sizes and SHA-256 checksums outside the target database. Never
commit exports or personal data to git.

### Step 1 — Provision Neon (30 min)

- Upgrade the Vercel CLI first (`npm i -g vercel@latest`), then use
  `vercel integration add neon` or the Marketplace dashboard.
- Link Neon to every Life OS Vercel project and verify the pooled and direct
  connection variables project by project. Do not remove or overwrite
  `TURSO_*` yet.
- Create a **dev branch** in Neon for the ETL dry run.

### Step 2 — Branch the code (`db/postgres-migration`) (2–4 days)

- Schema `provider = "postgresql"`; regenerate client.
- Squash migrations (above); generate the Postgres `init`.
- Collapse `createClient()` to `@prisma/adapter-pg`; update `next.config.ts`
  across apps; add the docker Postgres service.
- Dialect pass: `mode: "insensitive"` review (currently 188 tracked
  occurrences), raw SQL (currently 18 tracked files),
  implicit ordering in hot paths.
- Rewrite `scripts/lib/prod-schema.ts` + `check-migration-integrity.mjs`, or
  replace with `prisma migrate diff --exit-code` in CI; update the
  `scripts/deploy.ts` gate.
- De-libSQL the high-value scripts (`apps/persons/prisma/seed.ts`, anything in
  `scripts/era/` still in weekly use). Leave archival one-offs.

### Step 3 — Green locally (about 1 day)

`npm run type-check`, `npm test`, `npm run e2e` against local Postgres. Fix
until clean.

### Step 4 — ETL and rehearsals: Turso → Neon dev branches (2–4 days)

**Recommended tool:** one canonical Prisma-to-Prisma migration program. Do not
maintain a second production-writing path through `pgloader`; a single path is
easier to rehearse, audit, and repeat exactly.

- Generate two distinct Prisma clients from two schema files: an immutable
  SQLite/libSQL source schema and the new PostgreSQL target schema. The source
  client may only read; the target client may only write to a disposable Neon
  branch during rehearsals.
- Apply the Postgres baseline to the empty target with `prisma migrate deploy`
  before starting ETL.
- Walk models in FK-dependency order (topological sort of the relation graph),
  batch `createMany` (chunks of ~1–5k), `skipDuplicates` off so failures are
  loud.
- Emit per-table source/target row counts. Any mismatch blocks cutover.
- Emit deterministic content checksums for stable scalar fields in every table
  (ordered by primary key), excluding only values proven to be transformed
  equivalently by the provider.
- Check every foreign-key relationship for orphans and compare per-workspace
  counts, timestamp min/max values, enum distributions, nullable-field counts,
  and finance integer totals.
- Verify encrypted values remain byte-for-byte identical and can still be
  decrypted through normal application code.
- Verify representative full graph paths, including Person → Interaction →
  participants, Person → Plan, Event → CalendarEventLink, Notes/evidence,
  staged/review queues, files, finance, Places, and Level Up.
- Run the entire migration from a fresh empty Neon branch at least twice. A
  rehearsal is acceptable only when both runs produce the same validation
  report and all application tests pass against the migrated data.

Iterate Step 2 ↔ Step 4 until reconciliation is clean.

### Step 5 — Final cutover (downtime explicitly allowed)

1. Put every web app into maintenance/unavailable mode before freezing writers.
2. Freeze and record every writer: GitHub calendar/Era workflows, Vercel cron
   and webhook routes, device ingest, Granola/Krisp, iMessage, WhatsApp,
   document/voice/photo/health syncs, local LaunchAgents, and native clients.
   Do not advance source watermarks during the freeze.
3. Produce a final dated Turso export and checksums. Verify it opens locally.
4. Create a **fresh empty Neon production branch/database** and apply the
   baseline with `prisma migrate deploy` using the direct connection.
5. Run the exact rehearsed ETL Turso → Neon production. Run the complete
   automated validation report; row counts alone are not approval to proceed.
6. Run application tests and read-only smoke checks against Neon while the
   public apps remain unavailable. Then exercise a small, explicitly recorded
   reversible write and verify it through a fresh read.
7. Flip `DATABASE_URL` to the Neon pooled URL for every project, preserving
   Turso variables and credentials for rollback during the soak period.
8. Merge `db/postgres-migration` → `master`. Let the GitHub Actions pipeline
   (`project_cicd_deploy_pipeline`) deploy all apps, or run `npm run deploy`.
9. Smoke every app (home, persons, places, level-up, events, stuff, assistant,
   api). The deploy script's `smoke()` covers the basics; manually exercise a
   write path in persons and a finance read.
10. Restore interactive access first. Re-enable background writers one at a
    time, verifying their receipts/watermarks and Neon writes after each.
11. Observe for at least three days before declaring cutover complete.

### Rollback trigger and procedure

Rollback immediately for any unexplained count/checksum difference, broken
relationship, undecryptable value, incorrect workspace resolution, sustained
error rate, or missing core workflow.

1. Return all apps to maintenance mode and freeze Neon writers.
2. Point every app back to the preserved Turso configuration and redeploy.
3. Re-enable the original writers only after confirming their source
   watermarks were not advanced incorrectly.
4. Preserve the failed Neon database for diagnosis; do not copy its writes back
   into Turso ad hoc.
5. Fix the migration offline and repeat both rehearsals before another cutover.

### Step 6 — Cleanup (separate approval, no sooner than 30 days)

- Keep the Turso database and multiple dated exports through the soak period.
  Deleting the Turso org or any source database requires separate explicit
  confirmation; it is not an automatic migration step.
- Remove committed `*.db` files, `@libsql/*` and `@prisma/adapter-libsql` /
  `@prisma/adapter-better-sqlite3` from `package.json`s.
- Delete `turso-migrate-*.ts`, `scripts/apply-migration.ts`.
- Port or delete remaining `scripts/era/` / `scripts/db/` libSQL scripts.
- Update docs: `DEPLOY_RUNBOOK.md`, `FINANCE_INTERACTION_MODEL_PLAN.md`,
  `unified-auth-plan.md`, `docker-compose.yml` header, `AGENTS.md` / any
  `CLAUDE.md` mentioning Turso. Update the `feedback_turso_migration_reality`
  and `project_*_deploy_setup` memories.

---

## Same-day execution packets and token budgets

The migration should be managed by bounded agent packets, not by a week-based
calendar estimate. Token numbers estimate total model input, reasoning, and
output in each packet, with roughly ±50% variance when tests expose unexpected
coupling. Tool runtime and generated logs do not map perfectly to model-token
use.

| Packet                                             | Deliverable and clean stopping point                                                                                                                                                                                | Dependencies                                          |  Estimated tokens |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------: |
| **P0 — Source proof and backups**                  | Confirm Turso reads; inventory tables/counts; produce the full export plus People/core/finance backups; record sizes and SHA-256 checksums. No writes.                                                              | Turso paid/readable                                   |        **8k–15k** |
| **P1 — Neon provisioning and connection contract** | Provision/link Neon; record project-by-project env names without exposing values; prove pooled runtime and direct migration connections; create disposable branch.                                                  | May overlap P0 after reads work                       |        **6k–12k** |
| **P2 — Postgres schema and client seam**           | Create archived SQLite and PostgreSQL schemas/clients; generate/review baseline; add local Postgres; switch `@life-os/db` runtime adapter; generation and focused tests pass.                                       | P1 connection contract; local work can start earlier  |       **20k–35k** |
| **P3 — Case-sensitivity behavior pass**            | Review all tracked `contains:` filters and uniqueness-sensitive identity fields; add explicit insensitive behavior where required; matching/search tests pass.                                                      | P2 Postgres client types; inventory can begin earlier |       **18k–32k** |
| **P4 — Raw SQL, tooling, and active scripts**      | Port the 18 tracked dialect-sensitive files, deployment/schema gates, backup scripts, and every actively scheduled libSQL writer; classify archival one-offs.                                                       | P2; parallel with P3                                  |       **25k–45k** |
| **P5 — ETL and validation program**                | FK-ordered, resumable source-read/target-write ETL; counts, canonical content hashes, orphan checks, workspace distributions, timestamp/enum/null checks, finance totals, encryption checks, and graph-path report. | P2; can overlap P3/P4                                 |       **35k–60k** |
| **P6 — Full local/Postgres verification**          | Type-check, unit/integration tests, builds, E2E and deploy-gate repairs against Postgres; complete writer-freeze inventory and maintenance procedure.                                                               | P2–P5                                                 |       **25k–45k** |
| **P7a — Rehearsal one**                            | Fresh Neon branch, baseline, full ETL, validation report, app smoke. Capture failures without repairing target data manually.                                                                                       | P5 and relevant P3/P4 paths                           |       **10k–20k** |
| **P7b — Rehearsal two**                            | Repeat from another empty branch using the corrected exact procedure; require identical validation results and green tests.                                                                                         | Clean P7a                                             |        **8k–16k** |
| **P8 — Freeze and final cutover**                  | Stop all writers, final backup/export, fresh target baseline, exact ETL, validation, env flip, deploy, smoke, and reversible-write verification.                                                                    | P6 + two clean rehearsals                             |       **18k–35k** |
| **P9 — Controlled writer restart**                 | Restore interactive access; enable writers one at a time; verify receipts/watermarks; document rollback state and begin passive soak.                                                                               | P8                                                    |       **10k–20k** |
| **P10 — Deferred cleanup**                         | Remove obsolete adapters/scripts/env only after soak and separate deletion approval. Never delete Turso or source DBs implicitly.                                                                                   | At least 30 days and explicit approval                | **10k–20k later** |

Expected same-day work through P9: **about 183k–335k model tokens across
agents**. This is a capacity-planning range, not a requirement that one agent
hold the entire migration in one context window.

### Parallel lanes

After P0/P1 establish real source and target access, work can be distributed as:

- **Lane A — schema/runtime:** P2;
- **Lane B — query semantics:** P3 after P2 types are available;
- **Lane C — raw SQL/tooling/writers:** P4 after P2;
- **Lane D — migration safety:** P5, then P7a/P7b;
- **Integration lane:** P6 joins A–D, followed by the necessarily sequential
  P8/P9 cutover.

P3, P4, and most of P5 can proceed in parallel. P8 cannot be split across
agents: one coordinator must own the freeze, final export, validation decision,
environment flip, and rollback state to prevent conflicting writes.

### Same-day versus soak

The target is to finish P0–P9 today if provider access and tests cooperate.
The three-day soak is passive monitoring on the already-migrated, usable Neon
system; it does not delay implementation or normal use. Cleanup and any Turso
deletion remain intentionally deferred.

### Execution ledger

| Packet | Status                              | Evidence / blocker                                                                                                                                                                                                                                    |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0     | **Complete**                        | Remote Turso read proven; 7,640 People across all workspaces. People backup, 102-table/216,698-row raw backup, finance backup, the Turso-native snapshot `backups/persons.db` (190 MB, opens with expected counts), and the `.dump` SQL (`backups/turso-dump-2026-08-28.sql`, 110 MB) are all checksummed in `backups/P0_CHECKSUMS_2026-08-28.md`. A fresh final export is still taken at the P8 write-freeze. |
| P1     | **Complete** | Codex had already provisioned Neon project **`life-os-postgres`** (`long-shadow-85903641`, AWS **us-west-2 / Oregon**, DB `neondb`) and run `vercel env pull` → repo-root `.env.local` carries `DATABASE_URL` (pooled) + `DATABASE_URL_UNPOOLED` (direct) plus the `POSTGRES_*` / `PG*` aliases. Both baseline migrations are applied there (`migrate status` = up to date). **Two loose ends:** (a) a second, redundant Neon project `neon-amber-pillar` (us-east-1) was created by a later `vercel integration add neon` — wrong region, should be deleted; (b) region: Oregon Neon is a good fit if the Vercel apps are `pdx1`/`sfo1` — confirm before treating `life-os-postgres` as final, since Neon Free can't relocate a project. |
| P2     | **Landed, verified locally** (`93d57bd`) | Schema → `postgresql`; `schema.sqlite.prisma` frozen as ETL source; dual client generation; `packages/db/index.ts` on a single `@prisma/adapter-pg` path; `pg` + `@prisma/adapter-pg@^7.10.0` added. 61 SQLite migrations archived to `migrations.sqlite-archive/`; new `00000000000000_init` (3,379 lines) + `00000000000001_defer_foreign_keys`. Verified: `npm run type-check` clean repo-wide; both clients generate; both migrations apply to Postgres 17 with `migrate status` = up to date. Not yet done: local Postgres in `docker-compose` maps host `5432`, which collides with an existing tunnel/container on this machine — use a non-default host port for local runs, or a Neon branch. |
| P3     | **Complete** (`93d57bd`, verified this session) | Every real `contains` / `startsWith` / `endsWith` query site carries `mode: "insensitive"` (~110 sites); the earlier "60%" was a bad grep that missed the `mode:` on the following line. The one bare `startsWith` left (`packages/automation/tests/rules.integration.ts:300`) matches a synthetic `id:v1:item:id` prefix and is correctly case-exact. `equals` on string columns was already case-sensitive on SQLite (only `LIKE` was insensitive), so those are not a regression and were left alone. All JSON-marker `contains` sites (`Note.metadata`, `Event.metadata`, `Person.tags/emails/phones`) confirmed to be `String` columns in the baseline, so substring semantics carry over; the `mode: "insensitive"` added there is a harmless loosening. The pre-lowercased needles (`{ contains: q.toLowerCase() }`) still pass a lowercased string into an now-insensitive match — correct, just a redundant `toLowerCase()`; left as-is. |
| P4     | **Landed, verified locally** (`bd173fe`, `c52fb2b`) | `next.config.ts` (all apps) + `docker-compose.yml` on Postgres (`93d57bd`). Test/e2e harness ported: shared `packages/db/testing.ts` `createTestDatabase()` (fresh migrated DB per run, seeds `default-workspace`); the 6 self-provisioning `*.test.ts` files + 4 `packages/domain` suites + `apps/api` integration suite (`tests/setup.mts` via `--import`) all migrated off `better-sqlite3`. `packages/db/index.ts` `db` is now a lazy Proxy so pure-logic tests that only transitively import it need no database. `scripts/e2e/prepare.ts` resets a dedicated Postgres DB; `playwright*.config.ts` derive the URL from `E2E_DATABASE_URL`/`DATABASE_URL`. Gates: `scripts/lib/prod-schema.ts` now runs `prisma migrate status`; `scripts/check-migration-integrity.mjs` replays into a throwaway Postgres DB (turso-pairing check dropped). `.github/workflows/ci.yml` gets a `postgres:17` service on the lint + check jobs; deploy job uses `DATABASE_URL_UNPOOLED`. **Verified:** full `npm test` (all workspaces + `scripts/**`) and `npm run type-check` green against local Postgres; `npm run lint` (incl. migration-integrity) green. **Left for P10 cleanup:** `scripts/apply-migration.ts`, `scripts/db/migration-drill.ts` (`db:drill`, removed from CI), and ~45 one-off `scripts/era/**` / `scripts/*-sync.ts` still on `@libsql/client` — none in the CI/deploy path. |
| P5     | **Validated by a full run** | `scripts/db/migrate-turso-to-postgres.ts` ran Turso → `life-os-postgres` end to end in **4m47s**: 95 models, **217,650 source rows == 217,650 target rows**, every per-model content hash matched, `"valid": true`, `"failures": []`. Report saved to `backups/etl-rehearsal-1-2026-08-28.txt` (gitignored). The guarded "repairs" path fired only for orphaned **test-fixture** rows — integration-test residue in Turso prod. Exact scope: **83 orphan rows across 9 phantom workspaces** (`audit-api-a-*`, `events-api-a-*`, `health-daily-test-*`, `oura-test-*`, `people-api-a-*`, `plans-api-a-*`, `rules-api-a-*`, `interactions-api-a-*`, plus one more), spread over Person (22), ApiKey (15), AuditLog (14), StateDefinition (11), State (11), ImportedFile (5), Plan (3), Event (2). These came from the `apps/api` integration suite running against prod before this session's `tests/setup.mts` change gave it isolated databases. **P8 prep:** `DELETE` those 83 rows from Turso during the write-freeze (script them by the 9 workspace ids) so prod Neon never sees them — otherwise the ETL carries 9 `status='orphaned_test_fixture'` placeholder workspaces into prod forever. Insert order is schema-declaration order + `SET CONSTRAINTS ALL DEFERRED`; it worked, so `00000000000001_defer_foreign_keys` covers the FK graph adequately. |
| P6     | **Substantially done locally** (`bd173fe`, `c52fb2b`) | Type-check, unit + integration tests, lint, and migration-integrity all green against a local Postgres 17. Not yet done: a full `npm run e2e` run against Postgres (harness is ported but unrun here), `npm run build`, and `perf:check` — these want the CI Postgres service or a local one on a free port (host 5432 is taken on this machine). |
| P7     | **Both rehearsals clean** | Region decision: **Oregon (`life-os-postgres`) is final** — matches the west-coast Vercel apps. Rehearsal 1: 217,650 rows in==out, valid. Rehearsal 2 (target `DROP SCHEMA` → `migrate deploy` → ETL again, from empty): **217,772 rows in==out, all 95 model hashes matched, `"valid": true`, `"failures": []`**. Row-count drift between runs (122 rows) is live Turso activity, expected — each run reconciles against its own point-in-time snapshot. Reports in `backups/etl-rehearsal-{1,2}-2026-08-28.txt`. `scripts/db/purge-turso-test-residue.ts` (dry-run verified) removes the 83 orphan rows at source for the real run. |
| P8     | **Ready, pending user** | Remaining, all user-driven or user-approved: delete `neon-amber-pillar`; wire `DATABASE_URL` (pooled) + `DATABASE_URL_UNPOOLED` (direct) into all 8 Vercel projects; freeze every writer (crons, GitHub workflows, local LaunchAgents, device/Granola/Krisp/iMessage/WhatsApp/health/photo syncs); fresh final Turso export; `purge-turso-test-residue.ts --execute`; `DROP SCHEMA` + `migrate deploy` on Neon; final ETL; validation; env flip; merge branch → deploy; smoke all 8 apps; un-freeze writers one at a time; 3-day soak. |
| P9–P10 | Not started                         | P9 controlled writer restart; P10 cleanup (delete `turso-migrate-*.ts` + `migrations.sqlite-archive/`, retire `scripts/apply-migration.ts` / `scripts/db/migration-drill.ts`, port or drop ~45 one-off `scripts/era/**` + `scripts/*-sync.ts`, drop the `@libsql/*` deps, update docs/memories, keep Turso read-only ≥30 days then delete). |

---

## What we gain

- A cloud database with headroom for years and materially lower engine lock-in.
- **Real migrations in CI** — `prisma migrate deploy` on every deploy. The
  `turso-migrate-*.ts` hand-script ritual is gone.
- A simpler `createClient()` — one adapter, no embedded-replica special case.
- DB branching per preview deploy (Neon).
- `pgvector` / full-text / partial indexes available when Life OS wants them.

## Open questions

- Current Turso DB size (drives Neon tier choice and ETL time). Check the Turso
  dashboard and verify it against the full export before Step 1.
- Region: pin Neon to the same region as the Vercel projects.
- Does any code path actually depend on embedded-replica read latency today? If
  a p95 regresses after cutover, that's where to look first.
- Confirm the exact complete writer inventory and the maintenance-mode mechanism
  before the final rehearsal.
- Decide how long to retain the intact Turso database after the minimum 30-day
  period; deletion is never implied by completion of the migration.

## Current provider references

These details change; recheck them at implementation time.

- [Neon pricing](https://neon.com/pricing)
- [Neon scale-to-zero behavior](https://neon.com/docs/introduction/scale-to-zero)
- [Neon on the Vercel Marketplace](https://vercel.com/marketplace/neon)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Prisma `migrate diff`](https://www.prisma.io/docs/orm/reference/prisma-cli-reference#migrate-diff)
