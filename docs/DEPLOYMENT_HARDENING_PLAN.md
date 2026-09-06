# Deployment Hardening Plan

Written 2026-08-17, after a full 8-app production deploy that hit three
avoidable failures. This is a diagnosis of *why* deploys keep breaking and an
ordered plan to fix it. Nothing in the diagnosis is speculative — every claim
was verified against the live projects during that deploy.

**Implementation status (same day):** Phase 1 and Phase 3 are in the repo.
`npm run deploy` is the supported path. Phase 2 (normalize Root Directory) and
the GitHub auto-deploy cutover are deliberately not done here — see
[Remaining](#remaining).

Operational how-to: [`docs/DEPLOY_RUNBOOK.md`](DEPLOY_RUNBOOK.md).

---

## The one sentence version

**The thing we deploy is never the thing CI tested.**

`vercel --prod` uploads the current working directory. CI runs on push to
`master`. Those two facts have no connection to each other, so every deploy is
an untested artifact by construction — and no amount of care during a deploy
can fix that.

---

## What actually went wrong (evidence, not theory)

### 1. Production is running code git has never seen

At deploy time the tree held **141 changed files / 27 untracked / +795 −504
lines**, none of it committed. The last commit was 12 hours old. Two agent
sessions were editing the same tree concurrently (a second session had `home`
running on port 3003 throughout).

CI is genuinely good — `lint`, dependency boundaries, migration integrity,
Prisma replay, `db:drill`, type-check, test, Playwright e2e, production build,
perf budgets. **It gated nothing.** It has never run on the bytes now in
production.

### 2. The config-swap ritual is the direct cause of deploy failures

The documented method mutates root `.vercel/project.json` **and** writes a root
`vercel.json`, eight times per full deploy. The root `vercel.json` is the
problem: the CLI reads it from the working directory and sends it as deployment
config, where it **overrides the project's own settings**.

That is exactly what broke `persons`:

```
The Next.js output directory "apps/persons/.next" was not found at
"/vercel/path0/apps/persons/apps/persons/.next"
```

Every project already carries correct build settings. The root `vercel.json`
was never load-bearing — it was the fault.

### 3. There is a live cron hazard hiding in this

`apps/persons/vercel.json` and `apps/events/vercel.json` are **not vestigial**
— they define production crons:

| App | Cron | Schedule |
|---|---|---|
| persons | `/api/cron/theory-refresh` | `0 10 * * *` |
| events | `/api/cron/granola-sync` | `0 14 * * *` |

Both apps have Root Directory `apps/<app>`, so Vercel reads those files. But a
CLI-supplied **root** `vercel.json` overrides deployment config wholesale. The
old runbook told us to write one containing no `crons` key.

**Verified 2026-08-17 after the incident deploy:** both crons are still
registered (`disabledAt` is null). The hazard did not fire this time. It is
still one root `vercel.json` away from firing, which is why `npm run lint` now
fails if that file exists and `deploy.ts` re-reads cron definitions after
every persons/events deploy.

### 4. Two divergent project shapes, no source of truth

| Root Directory `.` | Root Directory `apps/<app>` |
|---|---|
| home, stuff, assistant, api, level-up | persons, events, places |
| build `npx turbo run build --filter=<pkg>` | build `cd ../.. && npx turbo ...` |
| output `apps/<app>/.next` | output `.next` |

The runbook documented only the first shape. Half the fleet is the second.

### 5. The runbook lives outside the repo, so nothing tests it

Three of its claims were wrong on the day:

- "write a root `vercel.json`" → actively breaks 3 of 8 apps
- "level-up: project not yet created" → it exists and is live
- "I can't run production migrations, creds are Sensitive" → they were runnable
  directly the whole time

A runbook that only exists in agent memory is never linted, never reviewed, and
drifts silently until it causes an outage.

### 6. Migration integrity is enforced only in CI — which deploys skip

While writing the rename backfill I created a hand-written migration script with no
paired `prisma/migrations/` entry. `npm run lint` catches this:

> `Production would get this schema while a clean replay never does.`

It was caught only because lint was run by hand. Under the normal
deploy-from-working-tree flow, that check never runs, and prod drifts from a
clean replay permanently. (Now fixed — 38/38 scripts paired.)

---

## Refinements vs the first draft of this plan

The original Phase 1/3 sketch was right about the failure mode and wrong about
a few tactics. These are the changes that landed with the implementation.

1. **Do not re-run `lint && type-check && test && build` inside `deploy.ts`.**
   That suite is what GitHub Actions already is. Re-running it locally would
   make deploys so slow the flags would get skipped. The invariant is: the
   artifact is a git SHA, and that SHA has a green `CI` run. `--skip-ci` falls
   back to local `lint` only.
2. **Do not swap `.vercel/project.json` either.** `vercel deploy --project
   <name> --scope <team>` is enough. The script writes a link file only inside
   a temp `git archive` directory, never in the repo.
3. **Upload `git archive HEAD`, not the working directory.** A "clean" tree can
   still contain gitignored files the CLI would send. The archive is the
   commit. `--allow-dirty` is the explicit exception, and it disables the CI
   gate because that gate no longer describes the bytes.
4. **The migration gate is "would Prisma 500?", not "was this script run?".**
   Production has no `_prisma_migrations` table, so there is no ledger of
   applied hand-written migration scripts. Comparing `schema.prisma` scalar columns
   to the live table info was the actual footgun. Read-only.
5. **Smoke accepts 2xx and 3xx, fails 4xx/5xx.** Hitting `/` on an authed app
   always 302s; that is not a health signal. Probes use `/login` (or the API
   root, or the apex marketing site).
6. **Cron verification is an API call, not a dashboard visit.**
7. **Git-connect is not an either/or with the CLI script.** Places is already
   Git-connected to `josephdfryer/life-os` on `master`. The other seven are
   not. Flipping them all to auto-deploy-on-push while dirty CLI deploys still
   exist would split-brain the fleet. Connect them as a cutover after
   `npm run deploy` is the only CLI path. Do not silent-flip.
8. **Do not normalize Root Directory in the same change as the deploy tool.**
   Phase 2 remains one-app-at-a-time with a cron check after each. `events`'s
   old in-repo `buildCommand` was stripped down to crons-only so it cannot
   fight a future Root Directory change.
9. **CI now fails if a root `vercel.json` (or a vestigial per-app one) returns.**
   The runbook is linted by existing as files the pipeline reads.

---

## The plan

Ordered by errors-prevented per unit of effort.

### Phase 1 — Make the deploy artifact trustworthy — done

**1.1 Stop deploying dirty trees.** `scripts/deploy.ts` (`npm run deploy`)
owns the project map in `scripts/lib/vercel-projects.ts` and refuses a dirty
tree unless `--allow-dirty`. Preferred long-term still: connect the remaining
seven Vercel projects to GitHub (see Remaining). The CLI path is what stops
the bleeding without changing the deploy trigger.

**1.2 Delete the root `vercel.json` step from every path.** Done. The script
never writes one. Lint fails if the file exists. AGENTS.md and the per-app
deploy notes no longer describe the swap ritual.

**1.3 Delete the two genuinely vestigial per-app configs** —
`apps/home/vercel.json` and `apps/assistant/vercel.json`. Done. **Kept
`persons` and `events`** — they hold the crons above. Events was reduced to
crons-only (dashboard already has the build/install commands).

**1.4 Move the runbook into the repo** as `docs/DEPLOY_RUNBOOK.md`, with the
real project map and both project shapes.

### Phase 2 — Remove the shape divergence — not in this change

**2.1 Normalize all eight projects to Root Directory `.`** with
`buildCommand: npx turbo run build --filter=<pkg>` and
`outputDirectory: apps/<app>/.next`. One shape, one mental model, one way to be
wrong instead of two.

**2.2 Move the persons/events crons** into whatever config the normalized shape
reads, and verify each cron re-registers after the first deploy. This is the
step most likely to silently break something — do it one app at a time and
check `npm run deploy -- --only <app>` (the script re-reads cron definitions)
after each.

Do not bundle this with a feature deploy.

### Phase 3 — Gate the deploy — done

**3.1 Pre-deploy gate.** `deploy.ts` requires a green GitHub Actions `CI` run
for `HEAD`. Migration-integrity and the new deploy-config check come free
inside `lint`, which CI already runs.

**3.2 Production schema check.** Read-only column/table comparison against
production. Fails the deploy when `schema.prisma` is ahead of production.

**3.3 Post-deploy smoke check.** Curl the production URLs; fail on 4xx/5xx.
Would have caught a bad deploy in seconds.

### Phase 4 — CI/CD on Hobby (no Vercel upgrade) — done in repo

Production deploys from GitHub Actions after `lint`+`check` on `master`
(`--ci --affected`). Git-triggered production builds are skipped via
`scripts/vercel-ignored-build.mjs`. Laptop `npm run deploy` remains the
hotfix path.

---

## Remaining

- **GitHub Actions secrets.** The deploy job fails closed until `VERCEL_TOKEN`,
  `DATABASE_URL_UNPOOLED` exist as GitHub secrets.
- **GitHub branch ruleset.** Block force-push to `master`; collaborators PR.
  Repo-admin bypass keeps a single operator unblocked.
- **Staging database.** Required before PR previews or a second developer. Local
  `.env` files today point at production. Do not git-connect the remaining
  seven apps until preview env cannot see prod.
- **Git-connect the remaining seven for previews only**, using
  `scripts/vercel-ignored-build.mjs` so Hobby's one concurrent build is not
  wasted on unrelated apps. Production stays Actions-owned.
- **Phase 2 shape normalization.** See above.
- **Concurrent agents sharing one working tree.** Isolate parallel work in a
  git worktree.
- **Env var drift detector.** `scripts/sync-vercel-env.ts` is the fan-out;
  Hobby cannot read Sensitive values back.

---

## Suggested first move

Add the three GitHub secrets, merge this, and confirm the next `master` push
runs `Deploy production` after CI. Then set the master ruleset (no force-push).
Do not git-connect more Vercel projects until a staging database exists.
