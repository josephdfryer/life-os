# Codebase review — performance and structure (2026-09-06)

Scope: the whole monorepo as of commit `15049ac` plus the Turso removal
(JF-202). Every number below was measured, not estimated; the commands are
reproducible from the repo root. Linear issues for the actionable items are in
the **Codebase health** milestone of `LifeOS · Ops & Platform`.

## Verdict

The architecture is sound: modular monorepo, a real domain layer
(`packages/domain`), an append-only event spine, workspace scoping on 75 of 95
models, keyset pagination on the four hottest list routes, and a CI that
replays migrations and enforces bundle and query budgets. Three things are
holding it back, and they compound:

1. **Identity matching loads every Person into memory.** The iOS contact
   ingest, assistant person creation, Gmail sync, and import analysis each read
   all 7,625 People and run `findMatch` in JavaScript. That is O(people) per
   record, on the exact path Social Scans is about to push hundreds of records
   through.
2. **Copy-pasted app plumbing has started to drift.** Six apps carry their own
   `access.ts`, `auth.ts`, `db.ts`, `local-review.ts`; the shared packages that
   should own them already exist. Persons also duplicates 13 canonical API
   routes.
3. **Nothing is cached at the page level.** 71 routes are `force-dynamic`,
   four call sites use any cache API, and access resolution can cost up to 28
   queries per request before its own cache warms.

None of this is urgent in the "outage" sense. All of it is the difference
between an app that feels instant at 7,000 people and one that does not at
20,000.

## Measurements

| Metric | Value | Source |
|---|---:|---|
| Source lines (ts/tsx, excluding generated) | ~106k | `find … \| xargs cat \| wc -l` |
| Largest app / package | persons 26.6k · home 11.6k · domain 9.5k | same |
| Prisma models / indexes / migrations | 95 / 260 / 8 | `schema.prisma` |
| Models without `workspaceId` | 20 (join tables and global config) | script |
| Unbounded `findMany` (no `take`/`cursor`) | **191 of a 195 budget**; budget was 109 on 2026-07-17 | `npm run perf:check` |
| Unbounded reads on request paths, weighted by live rows | top: auditLog 40,914 · plan 18,575 · interaction 8,229 · person 7,625 ×15 sites | `scripts/db/audit-unbounded-queries.ts --serving` |
| Pages with `dynamic = "force-dynamic"` | 71 | grep |
| Cache API call sites (`unstable_cache`, `use cache`, `revalidate`) | 4 | grep |
| `<Suspense>` boundaries | 11 | grep |
| `"use client"` files | 98 of 226 tsx | grep |
| DB call sites inside apps/home | 77 (14 in `.tsx`) | grep |
| Duplicated plumbing files across apps | access.ts ×6 (events/places differ by 10 lines of 705), auth.ts ×6 identical, db.ts ×5 identical, local-review.ts ×3 identical + 2 drifted, respond.ts ×3 | md5 |
| Persons `/api/v1` routes duplicating `apps/api/v1` | 13 of 26 | `comm` |
| Modules over the 1,200-line hotspot budget | tools.ts 2,385 · google-calendar.ts 2,081 · gmail.ts 1,536 · inventory.ts 1,326 | wc |
| Generated Prisma client tracked in git | 103 files, 13 MB, the 12 largest tracked files | `git ls-files` |
| JSON stored as `String` | Person.emails/phones/tags/values + 20 metadata/payload columns; 2 real `Json` columns; 91 files call `JSON.parse` | schema + grep |
| Test files | persons 20 · home 12 · domain 10 · api 10 integration · automation 1 · assistant 2 · level-up 1 | find |
| ESLint | `no-unused-vars`, `no-explicit-any`, `no-unused-expressions` all **off** | `eslint.config.mjs` |
| CI wall time (last green) | lint 1m24s · check 8m45s · deploy 0m42s | `gh run view` |
| Toolchain pins | CI Node 22 · local Node 25 · Vercel default 24 · `turbo: "latest"` · next `^16.3.0` ×7 and `^16.3.1` ×1 | package.json |
| Git | 92 orphaned temp objects from the crashed session (cleaned this session) | `git count-objects` |

## Findings, ranked by leverage

### 1. Identity matching is O(people) per record on the hot ingest paths — fix first

`apps/api/lib/device-ingest.ts:149`, `apps/assistant/lib/person-creation.ts:81`,
`apps/persons/server/domain/gmail.ts:978`, and
`apps/persons/server/domain/import-analysis.ts:104` each do
`db.person.findMany({ where: { workspaceId }, select: {…emails, phones…} })`
and then run `findMatch` over the result. Person.emails and phones are JSON
strings, so nothing can be matched in SQL. A 2,000-contact iOS sync therefore
loads 7,625 People 2,000 times (15M row materializations) and JSON-parses all of
them each time. Social Scans (JF-181..184) will push another few thousand
records through the same function.

`Person.emailSearch` (lowercased emails, indexed) already exists from the
2026-06-30 perf pass and proves the pattern; it is only used by list search.

**Fix.** A `PersonContact` index table (`personId`, `kind` email|phone,
`normalized`, unique on `(workspaceId, kind, normalized)`), dual-written from
`createPerson`/`updatePerson` and backfilled once. `findMatch` becomes: exact
lookup by normalized email or E.164 phone (one indexed query), then a bounded
fuzzy pass only over candidates sharing a last name or company (a second
indexed query), never a full scan. `PERFORMANCE_BUDGETS.md` already names this
treatment ("Identity lookup"). This also unblocks the exact-match auto-merge
tier (JF-191) and Social Scans linking (JF-182) with the same table.
Owner: Claude. Size: two days including backfill and tests.

### 2. The other unbounded request-path reads

From the audit, weighted by live rows:

- `apps/persons/server/domain/merge.ts` loads **all 40,914 AuditLog rows**
  (lines 283, 595), all Plans, all Interactions, all StagedInteractions to
  reassign foreign keys during a merge. It should update by `where: { personId
  in losers }` without reading, or read only the loser's rows.
- `apps/persons/app/api/plans/route.ts:12` returns all 18,575 Plans. Keyset
  paginate like `/api/events` and `/api/interactions` already do.
- `apps/persons/app/api/persons/export/route.ts` and `data-cleaning/route.ts`
  load all People; export should stream in batches, cleaning should paginate.
- `apps/persons/server/domain/health.ts:53` loads 4,538 States for a person
  card; bound to the last N days.

The budget ratchet went the wrong way (109 → 195) and sits at 191. After the
fixes above, set it to ≤150 and keep lowering.
Owner: Claude (domain), Codex (any UI that needs continuation state). Size:
two to three days.

### 3. Duplicated app plumbing, already drifting

`apps/{events,places}/server/domain/access.ts` are 705 and 707 lines and differ
by 10 lines. `auth.ts` is byte-identical in six apps, `db.ts` in five,
`local-review.ts` identical in three and drifted in two, `respond.ts` in three.
Roughly 2,000 lines of copy-paste. `packages/access` (with a 60s cache),
`packages/auth`, and `packages/db` already exist and are what these files
wrap. Every bug fix has to be made six times; the LifeOSBar clipping incident
and the client-safe `lifeOsAppUrl` fix on 2026-09-03 were exactly this shape.

**Fix.** Promote the canonical versions into the packages (`@life-os/auth`
exports `auth`, `requireAccess`, `localReview`; `@life-os/db` already exports
`db`; a small `@life-os/http` for `respond`), make each app's file a one-line
re-export, then delete the re-exports app by app. The dependency-boundary
checker already permits app → package. Owner: Claude for the package side,
Codex for the app swaps. Size: two days.

### 4. Persons still serves 13 routes the canonical API also serves

`/audit-log`, `/events`, `/events/[id]`, `/files/[id]`, `/interactions`,
`/interactions/[id]`, `/people`, `/people/[id]`, `/plans`, `/plans/[id]`,
`/rules`, `/rules/[id]`, `/rules/[id]/test` exist under both
`apps/persons/app/api/v1` and `apps/api/app/v1`. Two implementations, two
sets of tests, two chances to diverge on pagination and scoping. The 13
persons-only routes (contacts, dedupe, gmail sync, imports, inbox, ingest,
merge) are legitimately app-local until JF-166 moves merge/dedupe.

**Fix.** Delete the 13 duplicates from persons and point its UI at the shared
route handlers (import the same `lib` functions from `apps/api` is not allowed
by the boundary rule, so the handlers move into `packages/domain` or persons
calls `api.lacollecteur.com` through its existing proxy). Owner: Claude.
Size: one day.

### 5. No page-level caching, and access resolution repeats per request

71 pages opt out of every cache. That is the right default for an
authenticated, cookie-driven app (Home already found `cacheComponents` broke
those pages), but it means each render pays for workspace/member/session
resolution and every widget's queries from cold. Home's Today page has 77 DB
call sites across its components with sequential top-level awaits.

**Fix, in order of cost.** (a) Wrap `getWorkspaceId`, `auth`, and
`requireAccess` in `React.cache()` so one request resolves them once no matter
how many components ask. (b) `Promise.all` the independent widget loads. (c)
`unstable_cache` with tags for the slow-changing widgets (schedule,
commitments, attention) invalidated from `publishGraphEvent`, which already
knows what changed. (d) Keep `force-dynamic`; do not reach for PPR.
Owner: Codex (Home), Claude (the `cache()` wrappers in packages). Size: two
days for Home, then a pattern the other apps copy.

### 6. JSON stored as strings

`Person.emails`, `phones`, `tags`, `values` are `String @default("[]")`, and
20 more `metadata`/`payload` columns are JSON in `String`. This was a SQLite
constraint; Postgres has `jsonb` with GIN indexes. The cost today is every
consumer parsing (91 files) and no ability to query inside the value, which is
what forces finding 1.

**Fix.** Do not mass-migrate. The `PersonContact` table in finding 1 handles
the two columns that matter for lookups. Convert `tags` and `values` to
`String[]` (Postgres arrays, indexable) in one migration when a tag filter is
next needed. Leave `metadata`/`payload` blobs as they are; they are written
once and read whole.
Owner: Claude. Size: folded into finding 1 plus one small migration later.

### 7. Generated Prisma client is committed

`packages/db/generated/prisma` is 103 tracked files and the 12 largest files
in the repo. CI already regenerates it and fails if it is stale, so the
committed copy is pure noise: every schema change produces a multi-thousand-
line diff and merge conflicts between agents. Gitignore it and generate in
`postinstall` (Vercel and CI both run `npm ci`).
Owner: Claude. Size: one hour. Note: the tsconfig path override for worktrees
(memory `feedback_worktree_tsconfig`) may need the generated path too.

### 8. Four modules are far over the 1,200-line hotspot budget

`apps/assistant/lib/tools.ts` (2,385 lines, 34 tools, 2 tests),
`apps/events/server/domain/google-calendar.ts` (2,081), `apps/persons/server/
domain/gmail.ts` (1,536), `apps/stuff/lib/inventory.ts` (1,326). The budget
says hotspots trend downward; these trend up. `tools.ts` in particular is
where the assistant write-safety work (JF-195, JF-196) lands, and a 2,400-line
file with two tests is where a fail-open guard hides.

**Fix.** Split by domain, no behavior change: `tools/people.ts`,
`tools/plans.ts`, `tools/notes.ts`, … with a registry; `google-calendar/`
into `sync.ts`, `links.ts`, `reconcile.ts`; `gmail/` into `oauth.ts`,
`sync.ts`, `contacts.ts`. Add the missing tests while the seams are fresh.
Owner: Claude (tools, calendar, gmail), Codex (inventory). Size: one day each.

### 9. CI does the work twice and builds everything every push

The `check` job runs `npm run lint` again after the `lint` job already passed,
then runs unit tests, e2e, a production build of all eight apps, and the bundle
budget, on every push, ~9 minutes. Turbo is installed but there is no remote
cache, so nothing is reused between the two jobs or between pushes.

**Fix.** Remove the duplicate lint step; enable Turbo remote cache (included
with Vercel Pro, one `turbo login && turbo link`); use
`--filter=...[origin/master]` for `build` and `type-check` on PRs and keep
the full build for master. Pin `turbo` (it is `"latest"`), and align Node:
CI 22, Vercel 24, local 25. Pick 22 or 24, set `engines` and `.nvmrc`
(portability plan 1.3 already asks for this).
Owner: Codex. Size: half a day.

### 10. Lint is permissive; dead code accumulates

`no-unused-vars` and `no-explicit-any` are off, so `tsc` is the only real
gate. This session deleted ~50 dead scripts that lint never flagged, and
`scripts/era/` still holds a dozen one-shot migrations that ran once in
August. `apps/theory-of` is an empty directory left after the app was folded
into Persons.

**Fix.** Turn on `@typescript-eslint/no-unused-vars` as a warning with
`--max-warnings` set to today's count, then ratchet down. Run `knip` once for
unused exports and files. Move one-shot scripts to `scripts/archive/` with a
one-line header saying when they ran. Delete `apps/theory-of`.
Owner: Codex. Size: half a day.

### 11. Smaller items

- **`sslmode`.** Every process prints the `pg` warning that `sslmode=require`
  will change meaning in pg v9. Change the Neon `DATABASE_URL` to
  `sslmode=verify-full` (Neon supports it) in `.env.shared`, GitHub, and Vercel.
- **Preview deployments are inconsistent.** PR #40 built a Vercel preview for
  `life-os-places` only, so one project is git-connected while the hardening
  plan says none should be until a staging database exists (JF-156). Either
  disconnect it or finish JF-156 and connect all eight.
- **Tenancy documentation.** 20 models have no `workspaceId`. Most are join
  tables scoped through a parent, which is fine, but nothing records that.
  Add a schema comment per model and a test that asserts every model is either
  workspace-scoped or in the documented parent-scoped list.
- **`apps/api` integration tests** use `*.integration.ts` naming and run with
  `--test-concurrency=1`; they are the best tests in the repo and should be
  the template for `packages/automation` (one test) and `apps/level-up` (one).

## Suggested sequence

1. Finding 1 (PersonContact + indexed matching), because Social Scans S1 and
   the auto-merge tier both depend on it and it is the worst scaling bug.
2. Finding 7 (stop tracking the generated client), one hour, removes
   merge-conflict noise for everything after it.
3. Finding 3 (plumbing to packages), then finding 4 (delete duplicate routes),
   because every later change to auth or access then happens once.
4. Finding 2 (merge.ts, plans route, budget ratchet down).
5. Finding 5 (Home caching pattern), then copy to Persons.
6. Findings 8, 9, 10, 11 as fill-in work.

## What was checked and found fine

- Middleware (`proxy.ts` in every app) imports no database code; it stays
  cheap.
- The `packages/access` service has a 60-second per-instance cache;
  events/places wrap it with their own. The cost is the copies, not the design.
- Dependency boundaries are enforced in CI and had zero violations.
- Migration integrity replays into a fresh Postgres on every push.
- Keyset pagination is in place on `/api/events`, `/api/interactions`,
  `/api/v1/contacts`, and the canonical `apps/api` list routes.
- Client bundles are within their budgets (4 entries checked).
