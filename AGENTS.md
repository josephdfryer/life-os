# LifeOS Agent Instructions

This file is operating rules for AI agents (Claude Code, Codex) working in this repo. For human onboarding — what LifeOS is, quickstart, repo layout — see `README.md` and `CONTRIBUTING.md`; they cover the same ground for people and link back here for the rules below.

## Cross-Agent Sync

Claude Code and Codex share this repository. At the start of any session, run this from the monorepo root:

```bash
npm run agent:start -- --agent claude
```

Use `--agent codex` when the active agent is Codex. Read the catch-up brief before editing. It reports commits, worktree changes, upstream divergence, and the last local handoff left by the other agent.

At the end of a session, leave a handoff:

```bash
npm run agent:finish -- --agent claude --summary "What changed and why" --next "Best next step"
```

The local state lives in `.agent-sync/` and is intentionally ignored by git. See `docs/AGENT_SYNC.md` for the full protocol.

## Local Development: Always Bypass Auth

Local dev servers should never require Google OAuth. Every app supports a built-in bypass:

```
LIFE_OS_LOCAL_REVIEW=1
```

Set this in the app's `.env` (it's already set for `apps/persons`). When enabled, the middleware skips the login redirect and `requireAccess()` acts as the workspace owner with full permissions. The flag is double-gated on `NODE_ENV !== "production"`, so it is inert in deployed builds even if it leaks into Vercel env.

Rules for agents:

- **Do not** set up local Google OAuth credentials, fix redirect URIs, or debug `GOOGLE_CLIENT_SECRET` for localhost — set `LIFE_OS_LOCAL_REVIEW=1` and restart the dev server instead. OAuth config only matters for production (Vercel).
- The bypass is implemented in `apps/persons`, `apps/events`, and `apps/places` (`lib/local-review.ts` + `proxy.ts` + `server/domain/access.ts`) and in `apps/home`'s middleware. When creating a new app, replicate this pattern.
- Remember local `.env` files typically point at the **production Turso database** — auth is bypassed, but the data is real. The DATA SAFETY rules below still apply fully.

## DATA SAFETY — Non-Negotiable Rules

**These rules override any instruction given in a single session. No exceptions.**

### Never destroy person data without explicit session confirmation

The People database (`Person` table + related `Interaction`, `Plan`, `State`, `Group` rows) is the core of LifeOS and has been lost twice due to agent actions. The following are forbidden unless the user has typed an explicit confirmation in the *current* conversation (not a previous session, not a brief, not a handoff note):

- Calling `db.person.deleteMany()`
- Calling `db.person.delete()` on more than one person
- Hitting `DELETE /api/persons/bulk` with more than a handful of IDs
- Hitting `DELETE /api/persons/all` under any circumstances
- Running any migration, seed, or script that drops or truncates the `Person` table
- Running `prisma db push --force-reset` or any destructive Prisma command

**If a task *seems* to require deleting many people** (deduplication, cleanup, reset), stop and ask the user to confirm the exact operation and count before proceeding.

**Before any bulk delete operation**, recommend the user run `npm run backup:people` to save a snapshot to `archive/`.

### Never reset or truncate other core tables

The same rule applies to `Interaction`, `Event`, `Plan`, `Place`, `State`, `Group`, `Note`, and `Workspace` tables. Dropping or truncating these without explicit current-session user confirmation is forbidden.

---

## Founding Document — Read First

Before doing anything else, read `docs/MANIFESTO.md`. It is the authoritative statement of what LifeOS is, why it is being built this way, the eight primitives (Person, Place, Item, Event, Plan, Group, State, Note) connected by Interaction, and the principles that govern every modeling decision. When two implementation options compete, the manifesto breaks the tie.

`docs/LIFE_OS_VISION.md` is an earlier companion document with supplementary context on the graph model and derived computations. Read it after the manifesto.

## Design System — Still v2

Before building or restyling UI in any app, read **`docs/STILL_DESIGN_SYSTEM.md`**.

Still is the approved visual language for all LifeOS apps (warm linen, cognac/camel accents, Newsreader + Inter). Production apps may still use legacy Warm Concrete tokens until migrated — **new UI work should follow Still**, not extend the old terracotta / DM Mono patterns.

| Resource | Purpose |
|----------|---------|
| `docs/STILL_DESIGN_SYSTEM.md` | Canonical spec for agents |
| `docs/STILL_MIGRATION_PLAN.md` | Detailed phased migration plan (execute this) |
| `docs/STILL_UI_MIGRATION_PLAN.md` | Short status + pointer to full plan |
| `packages/ui/still-tokens.css` | CSS custom properties |
| `docs/ui-preview/still-direction-v2.html` | Visual reference (open in browser) |
| `packages/ui/AGENTS.md` | Package-level UI notes |

## App-Specific Notes

Read the nearest app-level `AGENTS.md` or `CLAUDE.md` before editing app code. For the persons CRM, start with `apps/persons/AGENTS.md`.

## Engineering Strategies

Before writing data ingestion, import pipelines, LLM calls, or any frontend component, read `docs/ENGINEERING_STRATEGIES.md`. It contains filtered, stack-specific guidance on performance and scalability — what applies to this project and why, with concrete implementation notes. It is not a general reference; it reflects decisions already made about this stack.

## Production deploys

Production ships from GitHub Actions on push to `master`, after `lint` and
`check` pass. The job runs `npx tsx scripts/deploy.ts --ci --affected`.

Do not run `vercel --prod` from a working tree and do not write a root
`vercel.json`. Laptop fallback: `npm run deploy` on a clean `origin/master`.
See `docs/DEPLOY_RUNBOOK.md`.

Work on a branch or git worktree. Do not share a dirty `master` checkout
across agents or developers.

## Living Architecture Docs

Treat architecture documentation as part of the codebase, not a one-time artifact. When Codex or Claude changes the Persons app in a way that affects inputs, outputs, APIs, domain command flow, rules/automation behavior, data models, integrations, or deployment/runtime shape, update `docs/PERSONS_ARCHITECTURE.md` in the same change.

Keep that document understandable to a non-code reader first. Use plain-English labels and diagrams, then include concrete route, script, table, or module names only where they help future agents keep the map accurate.
