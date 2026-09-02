# LifeOS

LifeOS is a personal graph of a life, not a task list. It models eight primitives — **Person, Place, Item, Event, Plan, Group, State, Note** — connected by one edge type, **Interaction**, and derives everything else (net worth, relationship health, attention signals) from those atomic facts on demand rather than storing aggregates that can drift out of sync.

Read **[`docs/MANIFESTO.md`](docs/MANIFESTO.md)** first. It's the founding document — what this is, why it's modeled this way, and the principles that break every tie when two implementation options compete. `docs/LIFE_OS_VISION.md` is a companion doc with supplementary context on the graph model.

## Repository layout

This is an npm-workspaces monorepo built with [Turborepo](https://turborepo.com).

```
apps/       Independently deployable Next.js apps (persons, places, events, stuff, home, assistant, api, level-up)
            + apps/companion, a native Swift/Xcode app outside the Node toolchain
packages/   Shared, published-internally packages (@life-os/*) — db, contracts, access, ui, domain, ...
scripts/    CI checks, deploys, and personal-data sync/migration tooling
docs/       Architecture docs, ADRs, runbooks, and planning docs
tests/      Playwright E2E specs
```

- **[`apps/README.md`](apps/README.md)** — what each app owns and its core invariants.
- **[`packages/README.md`](packages/README.md)** — what each package exposes and its invariants.
- **[`scripts/README.md`](scripts/README.md)** — index of operational tooling.
- **[`docs/PERSONS_ARCHITECTURE.md`](docs/PERSONS_ARCHITECTURE.md)** and sibling `*_ARCHITECTURE.md` files — living architecture docs, one per app/domain.
- **[`docs/adr/`](docs/adr)** — architecture decision records.
- **[`docs/runbooks/`](docs/runbooks)** — operational runbooks (secret rotation, stuck syncs, releases).

Apps communicate through shared package contracts or HTTP — never by importing another app's internals.

## Quickstart

```bash
npm ci
npm run dev        # turbo run dev — starts every app in parallel
```

To run a single app: `npm run dev -w persons` (or `places`, `events`, `stuff`, `home`, `assistant`, `api`, `level-up`).

Local dev servers skip Google OAuth via a built-in bypass — set `LIFE_OS_LOCAL_REVIEW=1` in the app's `.env`. **Local `.env` files typically point at the production database** even with auth bypassed, so local runs still touch real data; see [`docs/DEPLOY_RUNBOOK.md`](docs/DEPLOY_RUNBOOK.md) and the DATA SAFETY rules in [`AGENTS.md`](AGENTS.md) before running anything destructive.

### Verification loop

```bash
npm run lint          # eslint + dependency-boundary/migration/deploy-config checks
npm run type-check    # root tsc + turbo run type-check across workspaces
npm run test          # scripts/**/*.test.ts + each workspace's own tests
npm run e2e           # Playwright, against isolated throwaway databases — see tests/README.md
npm run db:drill      # migration drill, for schema changes
```

Never run `prisma db push --force-reset` or any bulk-delete against `Person`/`Interaction`/`Event`/`Plan`/etc. — see the DATA SAFETY section of `AGENTS.md`.

### Why the repo is ~50MB

`packages/db/generated/` (Prisma client output, two variants: Postgres and SQLite) is committed intentionally — CI diffs it against the schema on every run to guarantee they never drift. It's the largest thing in the repo by a wide margin; that's expected, not a sign something needs cleaning up.

## Where things live

| Concern | Look here |
|---|---|
| Primitive/modeling decisions | `docs/MANIFESTO.md`, `docs/LIFE_OS_VISION.md`, then `docs/adr/` |
| Request/persisted shapes | `@life-os/contracts` |
| Workspace permissions | `@life-os/access` + the app's domain layer |
| Database | `@life-os/db`, accessed only from server/domain code |
| UI | Still design system (`docs/STILL_DESIGN_SYSTEM.md`) + `@life-os/ui` |
| Cross-app behavior | A shared package or a versioned API — never an app-internal import |

## Contributing

See **[`CONTRIBUTING.md`](CONTRIBUTING.md)** for branch conventions, the deploy process, and how AI agents (Claude Code, Codex) collaborate in this repo. `AGENTS.md` holds the operating rules those agents follow, including non-negotiable data-safety rules — worth a read even for human contributors working near person/event data.
