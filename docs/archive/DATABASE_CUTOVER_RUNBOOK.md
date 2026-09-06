# Database Cutover Runbook — Turso → Neon (P8)

The step-by-step for the migration window. Companion to
[`DATABASE_MIGRATION_PLAN.md`](DATABASE_MIGRATION_PLAN.md) — that has the *why*,
this has the *do*. Everything before P8 is done and verified; the ETL has passed
two clean rehearsals.

**Legend:** `[you]` = you run it (destructive or account-level, an agent can't).
`[claude]` = an agent can run it alongside you. `[gate]` = stop, check, decide.

Estimated window: **60–90 min**, most of it the ETL (~5 min) and smoke tests.
Downtime is expected and fine — Life OS has one user.

---

## The one-screen version

```
preflight  →  freeze writers  →  final Turso export  →  purge residue
   →  reset Neon  →  final ETL  →  verify  →  flip env  →  merge → deploy
   →  smoke 8 apps  →  unfreeze writers  →  3-day soak
```

Rollback at any red check: point env back at Turso, redeploy, unfreeze. Turso is
untouched by everything except the residue purge (83 test rows), so it stays a
complete, current fallback until the soak passes.

---

## T-24h — Pre-flight (do the day before)

1. `[you]` **Delete `neon-amber-pillar`** (the accidental us-east-1 duplicate).
   Neon console → select it → Settings → Delete. Then check
   `vercel integration list` — if a second Neon integration entry exists,
   remove it. Keep `life-os-postgres`.

2. `[you]` **Build `.env.shared`** at the repo root (gitignored). This is what
   `scripts/sync-vercel-env.ts` fans out to all 8 Vercel projects. Start from
   whatever shared vars are already there, then:
   - **add** `DATABASE_URL` = the Neon **pooled** string (host has `-pooler`)
   - **add** `DATABASE_URL_UNPOOLED` = the Neon **direct** string
   - **remove** `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TURSO_SYNC_URL`
   Values come from repo-root `.env.local` (already pulled) or the Neon dashboard.

3. `[claude]` **Preflight check:**
   ```bash
   npx tsx scripts/db/cutover.ts preflight
   ```
   Must end `Ready.` — it checks branch, `.env.shared` (Neon in, Turso out),
   Neon reachability, Turso reachability, and residue count. Resolve any `FAIL`.

4. `[claude]` **Full test suite against Postgres**, to be certain nothing rotted:
   ```bash
   # LifeOS defaults to 5433 so it can coexist with another local Postgres.
   export LIFE_OS_POSTGRES_PORT=${LIFE_OS_POSTGRES_PORT:-5433}
   docker compose up -d postgres
   TEST_DATABASE_URL=postgresql://lifeos:lifeos@localhost:${LIFE_OS_POSTGRES_PORT:-5433}/lifeos \
     npm run type-check && npm test && npm run lint
   ```

---

## The window

### 1. Freeze every writer  `[you]`

Nothing may write to Turso after this point. In any order:

| Writer | How to stop |
| --- | --- |
| **GitHub: Calendar auto-sync** (`*/30`) | Actions tab → *Calendar auto-sync* → ••• → **Disable workflow** |
| **GitHub: Era finance auto-sync** (`0 */6`) | Actions tab → *Era finance auto-sync* → ••• → **Disable workflow** |
| **Vercel cron: `persons` `/api/cron/theory-refresh`** (`0 10`) | Vercel → persons → Settings → Crons → pause; or it's harmless if the window isn't near 10:00 UTC |
| **Vercel cron: `life-os-events` `/api/cron/granola-sync`** (`0 14`) | same, events project |
| **Local LaunchAgents** (12: capture, krisp, synthesis, brief, backup, gmailsync, locationsync, voicejournal, photossync, documentsync, notefacts, whatsappsync) | `npm run scheduler:uninstall` |
| **Manual syncs** (`imessage:sync`, `whatsapp:sync`, `health:sync`, `krisp:sync`, `capture:*`, `synthesis:run`, `brief:*`, the `era/*` scripts) | just don't run them |

Confirm nothing is mid-flight, then continue.

### 2. Final Turso export  `[you]`

A fresh restorable snapshot taken *after* the freeze:
```bash
cd backups && turso db export persons && cd ..
turso db shell persons ".dump" > backups/turso-final-$(date +%Y%m%d).sql
```
Record sizes + `shasum -a 256`. Append them to `backups/P0_CHECKSUMS_2026-08-28.md`.

### 3. Purge test residue from Turso  `[you]`

The 83 orphan rows (9 phantom `*-api-*` / `*-test-*` workspaces). Dry-run first:
```bash
npx tsx scripts/db/purge-turso-test-residue.ts
npx tsx scripts/db/purge-turso-test-residue.ts --execute
```
It only deletes rows whose `workspaceId` has no `Workspace` row — it cannot
touch real data.

### 4. Reset the Neon database  `[you]`

`life-os-postgres` / `neondb` still holds rehearsal-2 data. Wipe it to empty:
```bash
set -a; . ./.env.local; set +a
node -e '
const {Client}=require("pg");
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL_UNPOOLED});
await c.connect();await c.query("drop schema public cascade");await c.query("create schema public");
console.log("Neon public schema reset");await c.end();})()'
```
Then apply the baseline:
```bash
( cd packages/db && DATABASE_URL="$DATABASE_URL_UNPOOLED" npx prisma migrate deploy )
```
Expect: `2 migrations ... successfully applied`.

### 5. Final ETL  `[claude]`

```bash
npx tsx scripts/db/migrate-turso-to-postgres.ts            # preview: prints source/target counts
npx tsx scripts/db/migrate-turso-to-postgres.ts --execute  # ~5 min
```
The run ends with a JSON report. Require **`"valid": true`, `"failures": []`,
and `sourceRows === targetRows`**. With writers frozen and the residue purged,
the `migrationRepairs` arrays should now be **empty**.

### 6. `[gate]` Verify Neon against Turso

```bash
npx tsx scripts/db/cutover.ts verify
```
Must end **`Clean. Safe to flip`**. It re-counts all 95 models independently of
the ETL's own tally, deep-compares a Person sample, checks `default-workspace`,
checks for leftover `orphaned_test_fixture` workspaces, and checks FK validation.

> During the rehearsals this reports count drift and ~26 synthetic workspaces —
> both are because the rehearsal DB is stale and was loaded without the purge.
> In the real window, run immediately after step 5, it must be clean. If it
> isn't: **do not proceed — go to Rollback.**

### 7. Flip the connection string  `[you]`

```bash
npx tsx scripts/sync-vercel-env.ts                # dry run — lists vars × 8 projects
npx tsx scripts/sync-vercel-env.ts --apply        # writes DATABASE_URL(+UNPOOLED), drops TURSO_*
```
This writes `.env.shared` to production on all 8 projects: `life-os-home`,
`persons`, `life-os-events`, `life-os-places`, `life-os-stuff`,
`life-os-assistant`, `life-os-api`, `level-up`.

### 8. Ship it  `[you]` + `[claude]`

```bash
git checkout master && git merge --no-ff codex/postgres-migration
git push origin master
```
`[claude]` watches the GitHub Actions `deploy` job (the `check` job runs the full
suite against its own Postgres service first). Or run `npm run deploy` locally.

### 9. `[gate]` Smoke all 8 apps  `[claude]`

The deploy script's `smoke()` hits every `productionUrl`. Then by hand:
- `persons.lacollecteur.com` — open a person, **edit a field, save**, reload
- `home.lacollecteur.com` — dashboard renders, assistant history loads
- one finance read (an Interaction with spend) in persons or home
- `api.lacollecteur.com/` — health 200

Watch `vercel logs` / the Vercel dashboard for any `P1001` / `ECONNREFUSED` /
Prisma errors for ~15 min.

### 10. Unfreeze writers  `[you]`

Re-enable **one at a time**, checking each one's next run writes to Neon:
1. `npm run scheduler:install` (local agents)
2. Re-enable *Calendar auto-sync*, wait for a green run
3. Re-enable *Era finance auto-sync*, wait for a green run
4. Un-pause the two Vercel crons

### 11. Soak — 3 days

Passive. The system is fully migrated and in use. Watch for latency regressions
(us-west-2 Neon ↔ pdx1 apps should be single-digit ms) and any timestamp-looking
bugs. Keep Turso and the final export untouched.

---

## Rollback

Trigger on any unexplained count/hash diff, a broken relationship, a wrong
workspace resolution, a sustained error rate, or a missing core workflow.

1. `[you]` Put apps back on Turso:
   ```bash
   # restore TURSO_* and the Turso DATABASE_URL in .env.shared, remove the Neon ones
   npx tsx scripts/sync-vercel-env.ts --apply
   ```
2. `[you]` `git revert` the merge (or redeploy the pre-merge SHA) and push.
3. `[claude]` Smoke the 8 apps against Turso.
4. `[you]` Unfreeze the original writers **only after** confirming their source
   watermarks (`EraConnection.syncCursor`, calendar syncTokens) were not
   advanced during the window.
5. Keep the failed Neon database for diagnosis. Do not copy its writes back into
   Turso. Fix, re-rehearse twice, pick a new window.

Rollback is safe because: Turso was read-only throughout except the 83-row
residue purge (test data, recoverable from the final `.dump`), and no schema
change was made to Turso.

---

## After the soak — P9 / P10 (separate, not urgent)

- Delete `packages/db/turso-migrate-*.ts` and `packages/db/prisma/migrations.sqlite-archive/`
- Retire `scripts/apply-migration.ts`, `scripts/db/migration-drill.ts`
- Port or delete the ~45 one-off `scripts/era/**` and `scripts/*-sync.ts` still on `@libsql/client`
- Drop `@libsql/client`, `@prisma/adapter-libsql`, `@prisma/adapter-better-sqlite3`, `better-sqlite3` from the `package.json`s
- Remove committed `*.db` files
- Update `DEPLOY_RUNBOOK.md`, `docker-compose.yml` header, `AGENTS.md`, and the `feedback_turso_migration_reality` / `project_*_deploy_setup` memories
- Keep Turso read-only **≥ 30 days**, then delete the org
