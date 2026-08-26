# Level Up — IRL Player

A sports-game ratings engine for one real human. A LifeOS module (spec:
`docs/` writeup "IRL PLAYER v2"). Supersedes STATLINE v1.

## Governing principle

**The user interacts with the abstraction. The engine interacts with the
science.** You see ranks, badges, builds, combines, and a career timeline. The
engine sees test protocols, raw measurements, population distributions, and
confidence intervals. Every number on the card is falsifiable and traceable to
a raw measurement (`LevelUpTestResult`) — you can always tap through — but you
never have to look at it to play.

## Architecture

- `lib/engine/` — a **pure, dependency-free, fully unit-tested** TypeScript
  ratings engine. No React, no DB, no Next. This is the credibility core; do not
  add I/O to it. `computeCard()` is the single entry point. Tests
  (`lib/engine/engine.test.ts`) reproduce the spec's worked examples — if they
  drift, the science broke. Run: `npm test` in this app.
- `lib/store.ts` / `lib/actions.ts` — the only place the engine meets the DB.
  Loads `LevelUpTestResult` etc., feeds the engine, persists snapshots.
- `app/` — the Warm Concrete UI. Dark, gridded, no gradients, one vermillion
  accent (`#C4522A`, reserved for deltas and locked-cap warnings only).

## Invariants

- Ratings are **derived, never stored** — except `LevelUpRatingSnapshot`, a
  frozen record of what the engine said on a date (career timeline + combine
  ceiling). That is provenance, not a live aggregate.
- **Only a combine raises an attribute's verified ceiling.** Typed training data
  moves you within your proven range (confidence band), never past it. This is
  also the anti-cheat: self-entered numbers are trivially gameable.
- **Never show a rank you can't defend.** For movements/attributes without a
  defensible norm, show the residual (Balance) only and suppress Rank.
- RANK is capability (slow, honest). CAREER is consistency (daily, generous).
  The two tracks must never contaminate each other.

## Data

Shares the one LifeOS Turso DB. Schema lives in
`packages/db/prisma/schema.prisma` (`LevelUp*` models). Prod schema changes are
applied manually and idempotently via
`packages/db/turso-migrate-level-up.ts` **before** deploying — see
`docs/DEPLOY_RUNBOOK.md`.

## Deploy

```bash
npm run deploy -- --only level-up
```

Vercel project `level-up`: Root Directory `.`, `turbo run build --filter=level-up`,
output `apps/level-up/.next`. See `docs/DEPLOY_RUNBOOK.md`.

Level Up uses Vercel's managed Next.js builder. Keep the monorepo `outputFileTracingRoot`, but do not set `output: "standalone"`; that mode is for self-hosted servers and breaks Vercel output finalization.
