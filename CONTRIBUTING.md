# Contributing

## Before you start

1. `npm ci`, then read `docs/MANIFESTO.md`, `docs/LIFE_OS_VISION.md`, and the nearest `AGENTS.md` (root, then the app/package you're touching).
2. Confirm which database your `.env` targets — local dev auth is bypassed, but the data behind it is often the real production database. See "Local development" below.
3. Skim `docs/ROADMAP.md` and the relevant `docs/*_ARCHITECTURE.md` for known constraints before making structural changes.

## Branches and commits

- Work on a branch, never directly on `master`. Don't share a dirty `master` checkout across contributors or agents.
- Commit messages follow `type(scope): summary` (e.g. `feat(home): ...`, `fix(places): ...`, `chore(ci): ...`, `docs(db): ...`), matching `git log` history. Scope is usually an app or package name.
- Open a PR against `master`. CI (`.github/workflows/ci.yml`) runs `lint`, `check` (schema validation, generated-client drift check, migrations, type-check, unit tests, Playwright E2E, build), and `deploy` (on merge to `master`).

## Local development

Every app supports `LIFE_OS_LOCAL_REVIEW=1` (set in the app's `.env`) to skip the Google OAuth redirect during local dev — it's double-gated on `NODE_ENV !== "production"` so it's inert in deployed builds. Do not set up local OAuth credentials or debug redirect URIs for localhost; use the bypass instead. OAuth config only matters for production (Vercel).

**Data safety is non-negotiable.** Never bulk-delete or reset `Person`, `Interaction`, `Event`, `Plan`, `State`, `Group`, `Note`, or `Workspace` data without an explicit, current-conversation confirmation from the repo owner. Never run `prisma db push --force-reset`. Before any bulk operation, run `npm run backup:people` first. Full rules are in `AGENTS.md`.

## Verification before opening a PR

```bash
npm run lint
npm run type-check
npm run test
npm run e2e          # for UI-affecting changes
npm run db:drill      # for schema changes
```

## Environment variables

`turbo.json`'s `build` task allowlists every env var any app might need, grouped loosely by concern (auth/session, Google Calendar, Google Gmail, Twilio, Oura, S3/file storage, file intelligence). Not every app uses every variable — check the app's own `.env.example` or `lib/env.ts` (where present) for what it actually reads.

## Deploys

Production ships from GitHub Actions on push to `master`, via `npx tsx scripts/deploy.ts --ci --affected`. Do not run `vercel --prod` from a working tree and do not add a root `vercel.json`. Full process, including the laptop fallback and per-app Vercel project map: `docs/DEPLOY_RUNBOOK.md`.

## Architecture docs are part of the codebase

If a change affects an app's inputs, outputs, APIs, domain command flow, rules/automation behavior, data models, integrations, or deployment shape, update the matching living architecture doc in `docs/` in the same PR (for Persons, `docs/PERSONS_ARCHITECTURE.md`). Keep them readable by a non-code reader first — plain-English labels and diagrams, with implementation names as supporting detail only.

## AI agents in this repo

Claude Code and Codex both work in this repository and share a lightweight handoff protocol (`npm run agent:start` / `npm run agent:finish`, state in `.agent-sync/`, gitignored). If you're an AI agent, `AGENTS.md` is the source of truth for operating rules — read it before making changes. If you're a human, the parts of `AGENTS.md` worth knowing are the DATA SAFETY rules and the local-auth-bypass convention referenced above.

## Package/app conventions

- `packages/*` are npm-scoped (`@life-os/*`) since they're imported across workspaces; `apps/*` are bare names since they're runnable targets, not imports. This is deliberate, not accidental inconsistency.
- `@life-os/theory` is a compatibility re-export of `@life-os/intelligence` — import from `@life-os/intelligence` directly in new code.
- `apps/level-up` (the app) and `packages/level-up` (its shared domain logic) are intentionally distinct workspaces that happen to share a name — `npm run dev -w level-up` targets the app.
