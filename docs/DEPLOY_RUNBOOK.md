# Production deploy runbook

Production ships from **GitHub Actions on `master`**, after `lint` and `check`
pass. The job runs `npx tsx scripts/deploy.ts --ci --affected`. That is CI/CD
on Hobby: Vercel does not auto-deploy production from git (Hobby has no
Deployment Checks, so a git-push deploy would race CI).

Do not run `vercel --prod` from a working tree, and do not write a root
`vercel.json`.

## Solo fast lane

For a small, app-local fix, deploy the committed change directly while the
normal GitHub CI remains available as a later audit:

```bash
npm run ship:fast -- home
```

Replace `home` with one of the app names printed by `npm run deploy -- --list`.
The backend-only `api` project always uses the full lane.
The command:

1. Requires a clean commit ahead of `origin/master`; it never uploads an
   uncommitted working tree.
2. Refuses changes outside the selected app, except documentation.
3. Refuses database/Prisma, API route, server/domain, authentication/access,
   middleware, cron/import/sync, dependency, environment, and deploy-config
   changes. Use the full PR/CI lane for those.
4. Runs ESLint, type-check, and tests for the selected app.
5. Confirms production PostgreSQL has no pending migrations. It never applies
   migrations from the fast lane.
6. Uploads `git archive HEAD`, deploys only the selected Vercel project, runs
   its production smoke probes, and verifies its crons when applicable.

After a successful fast deploy, land that change on `master` immediately so Git
remains the source of truth. GitHub CI then runs as an asynchronous audit.
If that audit fails, roll production back and fix the failure through the full
lane.

The fast lane is appropriate for copy, CSS, layout, components, and contained
read/display fixes. Use the full lane for migrations, data writes, identity
matching, auth/permissions, collectors, scheduled work, shared packages,
dependency updates, or changes spanning multiple apps.

Laptop fallback (hotfix / first-time secret bootstrap):

```bash
npm run deploy                         # all eight apps
npm run deploy -- --dry-run
npm run deploy -- --only persons
npm run deploy -- --affected
npm run deploy -- --list
```

`--only` accepts the app directory (`persons`), the turbo filter (`events`), or
the Vercel project name (`life-os-events`). `--affected` deploys only apps
touched since `HEAD^` (or `--before <sha>`).

## GitHub Actions secrets

The `Deploy production` job uses the existing `Production` environment. It
needs these repository (or environment) secrets:

| Secret | Why |
|---|---|
| `VERCEL_TOKEN` | Account token that can deploy the eight LifeOS projects |
| `DATABASE_URL_UNPOOLED` | Direct Neon/PostgreSQL connection for migrations and schema status |

Create the Vercel token at [vercel.com/account/tokens](https://vercel.com/account/tokens).
Until `VERCEL_TOKEN` is set, the deploy job will fail closed — CI still
gates merges; production just will not update.

## What the script actually does

1. **Refuse a dirty tree** (laptop). `--ci` skips this because the Actions
   checkout is the commit. `--allow-dirty` is an emergency hatch.
2. **Refuse a commit origin/master does not have** (laptop). `--ci` skips
   this because the job only runs on `master` pushes.
3. **Refuse a commit whose GitHub Actions `CI` workflow is not green**
   (laptop). `--ci` skips the poll: this job `needs: [lint, check]`.
4. **Apply committed migrations and confirm production PostgreSQL is current.**
   All eight apps share one database and one Prisma client; deploying code
   ahead of its migration makes every query on that model 500. The fast lane
   only checks migration status and refuses to apply anything.
5. **Upload `git archive HEAD`** with `vercel deploy --prod --yes --project
   <name> --scope <team>`. It never swaps `.vercel/project.json` in the repo
   and never writes a root `vercel.json`.
6. **Smoke-curl** the production URLs (2xx/3xx pass; 4xx/5xx fail).
7. **Verify crons** on persons and events via the Vercel API.

## Project map

Source of truth: `scripts/lib/vercel-projects.ts`.

| App | Vercel project | Production URL | Root Directory | Crons |
|---|---|---|---|---|
| home | `life-os-home` | https://home.lacollecteur.com (apex https://lacollecteur.com) | `.` | |
| persons | `persons` | https://persons.lacollecteur.com | `apps/persons` | `/api/cron/theory-refresh` `0 10 * * *` |
| events | `life-os-events` | https://events.lacollecteur.com | `apps/events` | `/api/cron/granola-sync` `0 14 * * *`; `/api/cron/calendar-sync` `*/15 * * * *` |
| places | `life-os-places` | https://places.lacollecteur.com | `apps/places` | |
| stuff | `life-os-stuff` | https://stuff.lacollecteur.com | `.` | |
| assistant | `life-os-assistant` | https://assistant.lacollecteur.com | `.` | |
| api | `life-os-api` | https://api.lacollecteur.com | `.` | |
| level-up | `level-up` | https://level-up.lacollecteur.com | `.` | |

Two project shapes exist on purpose until Phase 2 of
`docs/DEPLOYMENT_HARDENING_PLAN.md`.

The unused `db` Vercel project is not in this map and must not be deployed.

## Git-triggered builds (Places today, others later)

`life-os-places` is Git-connected. Its **Ignored Build Step** is
`cd ../.. && node scripts/vercel-ignored-build.mjs`, which:

- **skips production / `master`** so git push cannot beat CI
- **skips preview** unless `apps/places` (or a shared package) changed

Do not connect the other seven projects to GitHub until you want PR preview
URLs. When you do, set the same ignored-build command (from repo root for
Root Directory `.` projects: `node scripts/vercel-ignored-build.mjs`; from
`apps/<app>`: `cd ../.. && node scripts/vercel-ignored-build.mjs`). Hobby has
one concurrent build — path filtering is what makes eight apps viable later
without a Pro upgrade.

## Config files that are allowed to exist

- `apps/persons/vercel.json` — crons only. Keep it.
- `apps/events/vercel.json` — crons only. Keep it.

Forbidden (`npm run lint` fails if they return):

- **Root `vercel.json`.**
- Any other `apps/*/vercel.json`.

## Migrations before code

Commit the PostgreSQL migration, then merge to `master`. The full deploy job
applies pending committed migrations before shipping code; the fast lane
refuses any migration change or pending production migration.

```bash
npm run migrate:deploy -w @life-os/db
npm run deploy -- --dry-run    # laptop check; CI does this too
```

See `docs/DATABASE_MIGRATION_AND_RECOVERY.md`.

## Env vars

Shared secrets are pushed with `npx tsx scripts/sync-vercel-env.ts`. Hobby has
no team-level shared env, so this script is the fan-out.

## Branch / collaborator hygiene

- Work on a branch or git worktree. Do not share a dirty `master`.
- Local `.env` files today often point at **production PostgreSQL**. That is unsafe
  the moment a second human or preview deploy exists. Stand up a staging
  PostgreSQL database before connecting more Vercel projects for PR previews.

Set this in GitHub when you are ready for a second collaborator (Settings →
Rules → Rulesets → New):

1. Target `master`.
2. Block force pushes and branch deletion.
3. Require status checks `lint` and `check` on pull requests.
4. Optionally require a pull request. Leave a **repository admin bypass** so
   a single operator is not locked out of direct pushes.

Until that ruleset exists, `master` is unprotected. The Actions deploy job
still only runs after CI on `master` pushes.

## Rollback

```bash
vercel rollback --project <vercel-name> --scope team_ftx6eq2s9NttYUc9WqQRwfa8
```

That re-points aliases. It does not undo a PostgreSQL migration.

## What not to do

- Do not `vercel --prod` from `apps/<name>` or the repo root.
- Do not copy `apps/*/.vercel/project.json` onto the repo-root `.vercel/`.
- Do not add a root `vercel.json` "just for this deploy".
- Do not git-connect the remaining apps with production auto-deploy on.
- Do not give PR previews the production database credentials.
