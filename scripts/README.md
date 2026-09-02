# Scripts

Operational tooling for LifeOS: CI checks, deploys, data sync, and one-off migrations. These are not app code — nothing here is imported by `apps/*` at runtime. Root `package.json` exposes the common ones as `npm run` scripts; run everything else with `tsx scripts/<path>`.

## Top-level scripts

| Script | Purpose |
|---|---|
| `agent-sync.mjs` | Cross-agent (Claude/Codex) handoff protocol — see root `AGENTS.md` |
| `deploy.ts` | Production deploy, invoked by CI (`.github/workflows/ci.yml`) — see `docs/DEPLOY_RUNBOOK.md` |
| `check-dependency-boundaries.mjs`, `check-migration-integrity.mjs`, `check-deploy-config.mjs`, `check-performance-budgets.mjs` | CI lint gates, run via `npm run lint` / `npm run perf:check` |
| `sync-vercel-env.ts` | Pushes shared secrets to Vercel projects |
| `vercel-ignored-build.mjs` | Vercel's per-app "ignored build step" — see `docs/DEPLOY_RUNBOOK.md` |
| `backup-people.ts` | Snapshots the Person table to `archive/` before a risky operation |
| `seed-persons-access.ts`, `create-api-key.ts` | Local/dev setup helpers |
| `imessage-sync.ts`, `whatsapp-sync.ts`, `health-sync.ts`, `voice-journal-sync.ts`, `photos-sync.ts`, `document-sync.ts` | Personal data ingestion — pull from source systems into the graph (own `npm run *:sync` scripts) |
| `photos_export.py` | One-off Photos library export helper (Python, no npm script) |
| `reconcile-calendar-backlog.ts` | One-off backlog reconciliation for calendar-sourced Events |
| `file-intelligence-backfill-preview.ts` | Dry-run preview for the file-intelligence backfill |

## Subdirectories

| Directory | Purpose |
|---|---|
| `brand/` | Brand asset generation (`build-icons.mjs`) |
| `brief/` | Daily brief generation and delivery (`npm run brief:generate` / `brief:execute`) |
| `capture/` | Manual capture entry points for WhatsApp/calls (`npm run capture:*`) |
| `db/` | Database audits, backups, and the cutover/migration-drill tooling (`npm run db:drill`) |
| `e2e/` | Playwright E2E environment prep (`npm run e2e:prepare`) |
| `era/` | Era finance integration sync and one-off data-repair scripts |
| `health/` | Health export parsing shared by `health-sync.ts` |
| `krisp/` | Krisp meeting sync (`npm run krisp:sync`) |
| `level-up/` | Level Up (fitness) content fetch helpers |
| `lib/` | Shared helpers used by the deploy/CI scripts (colors, deploy gates, env parsing) |
| `scheduler/` | Installs/uninstalls the local `launchd` scheduler (`npm run scheduler:install`) |
| `synthesis/` | Note-to-fact extraction and the synthesis pipeline (`npm run synthesis:run`, `notes:extract-facts`) |

`scripts/db/` and `scripts/era/` in particular contain a mix of recurring tooling and one-time migration/audit scripts (e.g. `db/audit-vcard-import-corruption.ts`, `era/copy-visits-to-prod.ts`). They're kept for provenance and because some may run again; if you're fairly sure one is fully obsolete, confirm with the repo owner before deleting rather than removing it silently.
