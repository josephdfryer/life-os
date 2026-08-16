# Handoff — Direct Oura connection

**Date:** 2026-08-15  
**Updated:** 2026-08-15 (implementation started)  
**From:** Cursor (this session)  
**For:** the next agent  
**Branch:** `master` (worktree is dirty; do not reset)
**Status:** Code is in the worktree. Joseph still must register the Oura API application and set env vars before a live connect works.

Joseph asked to leave this as the next slice. HealthKit phone sync is flowing. Sleep/background changes are in the worktree and are **not** this task. This task is the Oura API connection so readiness, sleep score, activity score, and stress can enter the graph.

## Why this exists

Apple Health does not receive Oura Readiness, Sleep Score, Activity Score, Stress, or Resilience. Some Oura sleep/activity *can* appear in HealthKit if Joseph enabled sharing; those proprietary scores cannot. Intelligence and Level Up need the scores as daily `State` rows.

Do **not** scrape Oura from the iPhone companion. Do **not** merge Oura and HealthKit into one number.

## Authoritative plan

Read first, then implement against it:

- `docs/LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md` — section **Oura connection** and milestone **3. Direct Oura**
- `docs/IOS_PLATFORM_PLAN.md` — M4
- `docs/ADAPTIVE_DAY_PLAN.md` — readiness still synthetic until this lands
- `docs/adr/0003-connection-model.md` — unified `Connection` row
- [Oura API V2](https://cloud.ouraring.com/v2/docs)

## Product rules (already decided)

- Home Connections hub, authorization-code OAuth, CSRF state.
- First release scope: **`daily` only**. No heartrate, workout, session, tag, email, personal, or SpO2 until a feature needs them.
- Encrypt tokens with the existing credential crypto (`packages/db/src/crypto.ts`). Never return tokens through APIs or diagnostics.
- `Connection.kind=oura`, `provider=oura`.
- 35-day backfill once, then signed webhooks + fetch the changed document/date.
- One provenance Note per Oura day. Reprocessing a day replaces only that source’s States (`source=oura`).
- Oura owns Oura scores and contributors. HealthKit owns Apple Health measurements. Never average competing providers.
- No new Life OS primitive.

## Endpoints to ingest (daily scope)

| Oura document | Suggested State keys | Notes |
|---|---|---|
| `/v2/usercollection/daily_readiness` | `oura_readiness_score` + contributor keys | Authoritative readiness |
| `/v2/usercollection/daily_sleep` | `oura_sleep_score` + contributors | Distinct from HealthKit `sleep_*_hours` |
| `/v2/usercollection/daily_activity` | `oura_activity_score` + contributors | Distinct from HealthKit steps/energy |
| `/v2/usercollection/daily_stress` | `oura_stress_high_seconds`, `oura_recovery_high_seconds`, `oura_stress_summary` | Confirm whether `daily` scope covers this; if not, stop and say so — do not silently widen scopes |

Reuse `recordHealthDailyDigestInTransaction` / `replaceStatesForSourceNoteInTransaction` with `source: "oura"` and marker `oura:day:YYYY-MM-DD`. Do not write into the HealthKit Note.

## Concrete starting surface

- Home card: `apps/home/app/connections/ConnectionsClient.tsx` (Gmail/calendar/Era/Granola live here; Oura is absent).
- Connection model: `packages/db/prisma/schema.prisma` `Connection` — `kind` is an open string; no migration needed to add `oura`.
- Mirror pattern: Era (`apps/api/app/v1/connections/era/route.ts`) and Gmail connect URLs on the Home card.
- Health write helper: `apps/api/lib/health-daily.ts`.
- Intelligence already reads Level Up readiness + energy/mood/stress check-ins (`packages/intelligence/src/adaptive-day-brief.ts`). After Oura States exist, wire readiness assembly — do not fake it from HealthKit sleep.

## Blocker the implementer cannot skip

Register an Oura API application at [cloud.ouraring.com/oauth/applications](https://cloud.ouraring.com/oauth/applications). Joseph must create it (or supply client id/secret). Callback belongs on Home, e.g. `https://home.lacollecteur.com/connections/oura/callback`. Apps are limited to 10 users until Oura approves production.

Store secrets in Vercel env for Home/API. Do not commit them.

## Out of scope for this slice

- Rebuilding or installing the iPhone app (sleep union + 11:50 PM `BGAppRefresh` + immediate sleep observers are already in the dirty companion files).
- FoodNoms / nutrition.
- Letting Oura change workout prescriptions (shadow mode first).
- Raw HR streams or sleep hypnograms.

## Data safety

Additive only. No deletes, truncates, or `db push --force-reset`. Local `.env` can point at production Turso.
