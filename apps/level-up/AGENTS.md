# Level Up

LifeOS character sheet for deliberate growth across skills. Fitness remains the
first evidence-backed domain; Communication is the first non-athletic skill
(public speaking + written communication). Web owns the character / skills /
Plans desk (Still). Workout logging stays available under legacy Warm Concrete
routes and will move to iOS later.

## Governing principle

**The user interacts with the abstraction. The engine interacts with the
science.** Fitness ranks stay falsifiable and traceable to measurements.
Communication starts provisional / unranked until a real rubric earns numbers.
No fake XP. No cross-domain OVR.

## Architecture

- `@life-os/level-up` — pure ratings engine + workout domain commands.
- `apps/level-up/app` — Character (Still) + skill pages; legacy gym UI under
  `.warm-concrete`.
- Graph `Plan` rows are shared with Home — Level Up is a lens, not a fork.

See `docs/LEVEL_UP_SKILLS_WEB_PLAN.md`.

## Deploy

```bash
npm run deploy -- --only level-up
```

Vercel project `level-up`: Root Directory `.`, `turbo run build --filter=level-up`,
output `apps/level-up/.next`. See `docs/DEPLOY_RUNBOOK.md`.

Level Up uses Vercel's managed Next.js builder. Keep the monorepo
`outputFileTracingRoot`, but do not set `output: "standalone"`.
