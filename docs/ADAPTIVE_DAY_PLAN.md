# Adaptive Day and Closed-Loop Life OS Plan

## Summary

Build a Home-first Adaptive Day / Capacity Brief that converts existing Life OS
context into zero to three evidence-backed recommendations.

The first release will:

- Optimize capacity, schedule and workout choice.
- Generate recommendations through deterministic, versioned rules.
- Work without an AI provider; AI may optionally rewrite explanations but never
  select or alter actions.
- Appear only in Home, without notifications, in a fixed slot directly below
  Quick Capture and the day selector — not a `CustomizableWidgetGrid` slot.
- Apply changes only after explicit confirmation, routed through the existing
  `ReviewItem`/command-registry confirmation boundary rather than a new one.
- Reschedule Life OS Plans only; Google Calendar remains read-only.
- Absorb `scripts/brief`'s daily-assembly role rather than duplicating it —
  one served pipeline, not two that can drift.
- Learn mostly from observed follow-through, with at most one lightweight
  outcome question per day.
- Launch progressively with current data — including a new lightweight
  morning check-in — rather than wait for Oura, sleep and nutrition.
- Add supporting intervention records, not a ninth Life OS primitive.

This document was reviewed against the current codebase before implementation
(see `~/.claude/plans/luminous-wondering-tome.md` for the full review trail).
The review's two open scope calls were resolved with Joseph: **(1)** Capacity
Brief absorbs `scripts/brief`, **(2)** v1 ships a morning check-in alongside
the existing evening one. Both are reflected below.

## Implementation

### 1. Supporting records and contracts

Add three non-primitive infrastructure records — but route confirmation
through the **existing** `ReviewItem` machinery (`packages/domain/review.ts`),
not a parallel one. That file already implements exactly what an "actionable
intervention confirmation boundary" needs: `proposedCommand` (JSON
`{command, input}`), `evidence` (JSON audit trail), `riskTier`
(`observe|safe_auto|review|confirm`), and a `status` enum
(`pending|accepted|edited_accepted|dismissed|superseded|failed`) that already
**is** Accept/Edit/Dismiss. Every existing review source
(`StagedInteraction`, `NoteSuggestion`, `ImportStagedVisit`, calendar
reconciliation) keeps its own source-of-record table and dual-writes a
`ReviewItem` row that indexes it — Adaptive Day follows the same shape:

- **AdaptiveDayBrief**: workspace, local day/timezone, generation time, rules
  version, capacity band, bounded input snapshot, completeness/freshness, and
  supersession state. Persisted (not computed-on-read like
  `packages/alignment`'s `AlignmentSignal`) because it's the anchor row every
  `AdaptiveIntervention` and dual-written `ReviewItem` points at, it must
  survive the day as underlying primitives keep changing (audit/history
  value), and idempotent generation needs a physical row to upsert against.
  Keep it thin — a snapshot and pointers, not a second copy of the primitives
  it read. `@@unique([workspaceId, day, rulesVersion])`.

- **AdaptiveIntervention**: brief, rank, category, recommendation text, reason
  codes, evidence references, optional proposed command, risk tier, lifecycle
  status and linked ReviewItem/result. This is the source-of-record table
  `ReviewItem` indexes — same role `Plan` plays for calendar reconciliation.

- **AdaptiveInterventionOutcome**: append-only observation with source,
  outcome, confidence, evidence and timestamp. Genuinely new — no existing
  analog in the codebase.

Supported intervention categories for v1:

- `plan_schedule`
- `plan_reschedule`
- `workout_adjustment`
- `capacity_guidance`

**Confirmation mechanics**: each intervention category registers a command via
`registerReviewCommand` (`plan.schedule`, `plan.reschedule`,
`level_up.record_recommendation`), following
`packages/domain/calendar-reconciliation.ts`'s exact template — a plain
domain function (e.g. `scheduleAdaptivePlan`) called directly by a dedicated
Home route for the widget's own Accept/Edit/Dismiss controls, *and*
separately registered via `registerReviewCommand` so a future universal
review inbox picks it up for free. Brief generation dual-writes a
`ReviewItem` (`source: "adaptive_day_brief"`, `sourceId: intervention.id`)
alongside each `AdaptiveIntervention`. This reuses `ReviewItem.evidence` and
`ReviewItemRiskTier` directly — no new evidence JSON shape, no new resolve
API, no new status enum.

Expose shared contracts and domain operations for:

- Get or lazily generate today's brief.
- Explicitly refresh it.
- Accept, edit or dismiss an intervention (via the registered commands
  above).
- Append passive or user-reported outcomes.
- Retrieve historical briefs read-only.

Every accepted mutation publishes a GraphEvent. Stable workspace/day/
rules-version keys prevent duplicate brief generation, following the same
`publishGraphEvent` upsert-on-idempotencyKey mechanism already used for
day-bucketed actions (`interaction-append:${source}:${day}` in
`packages/domain/staged-interactions.ts`) — e.g.
`adaptive-brief:${workspaceId}:${day}:${rulesVersion}`. Refreshing supersedes
unresolved proposals without changing already-accepted actions.

### 2. Deterministic capacity engine

Build the engine as pure, versioned logic in the shared intelligence layer.

Inputs:

- Fixed calendar-backed Plans and confirmed Events.
- Flexible Life OS Plans and their estimated or scheduled duration.
- Current commitments and deadlines.
- Latest energy, mood and stress check-ins — **this data model already
  exists**: `State`/`StateDefinition` already stores exactly
  `energy`/`mood`/`stress` on a 1-5 scale, written today by
  `apps/home/components/EveningCheckIn.tsx` → `POST /api/check-in` →
  `recordStateInTransaction` (`packages/domain/states.ts`). Two additions
  needed: a `getLatestStates(entityId, types, workspaceId)` read helper in
  `packages/domain/states.ts` (only write helpers exist today), and a new
  **morning check-in** — reuse `EveningCheckIn`'s component shape, gate it to
  morning hours instead of `hourInTz >= 17`, write through the same
  `POST /api/check-in` path with a distinct source tag
  (`"home-morning-check-in"`) so outcome analysis can tell captures apart.
  Without this, a morning capacity read would otherwise be working off last
  night's numbers all day.
- Real Level Up readiness when available.
- Workout scheduled for the day.
- Health freshness/completeness metadata.

Until real readiness is connected, synthetic readiness and raw HRV values do
not independently change capacity. Confirmed accurate against current code:
every Level Up session gets `neutralReadinessSnapshot()` today
(`inputs: { synthetic: true }`, `band: "full"`, reasonCodes:
`["synthetic_neutral_v1"]`) until HealthKit/Oura wiring lands.

Initial capacity rules (band names aligned to the real
`LevelUpReadinessSnapshot.band` enum — `"full" | "adjust" | "recover"`, not
"normal"):

- **recover**: real Level Up band is `recover`, or energy is 2/5 or lower
  while stress is 4/5 or higher.
- **adjust**: real Level Up band is `adjust`, fixed commitments total at
  least five hours, four fixed blocks leave no uninterrupted 90-minute
  window, energy is 2/5 or lower, or stress is 4/5 or higher.
- **full**: none of the above.
- Missing data is neutral, never negative.

Proposal selection:

- Return at most three interventions.
- Return nothing rather than generic filler when evidence is insufficient.
- Prefer one schedule proposal and one workout proposal; use capacity
  guidance only when it adds a concrete decision.
- Never move calendar-imported Plans, confirmed Events, completed Plans or
  Plans with an external provider source. These map to real, already-used
  `Plan` fields: `externalSource` (literal `"google-calendar"` for
  calendar-origin Plans), `fulfilledBy` (set once a Plan is confirmed as an
  Event), `reconciliationStatus`, and `status === "completed"`.
- A rescheduled Plan keeps its duration, uses 15-minute buffers around fixed
  commitments and moves no later than three days ahead.
- Default candidate hours are 8:00 a.m.–8:00 p.m. in the workspace timezone.
- Never increase workout load or volume because recovery is high.
- Evidence, source, freshness and missing signals must be visible for every
  recommendation.

**New domain command needed**: `packages/domain/plans.ts`'s `updatePlan`
doesn't currently accept `scheduledStart`/`scheduledEnd` in its `PlanInput`
type at all. Add `reschedulePlan(id, {scheduledStart, scheduledEnd},
workspaceId, actor)`: validate the four exclusion fields above, `tx.plan.update`,
publish a `plan.reschedule` GraphEvent with an **id-keyed** idempotency key
(`plan-reschedule:${id}:${newStart.toISOString()}`, matching `plan-create`/
`plan-delete`'s style — not `plan-update`'s non-stable
`plan-update:${id}:${Date.now()}` key, which is the one existing command that
deliberately isn't idempotent).

### 3. Confirmation and action execution

Use `ReviewItem` as the confirmation boundary for actionable interventions,
per section 1 above — this is reuse, not new construction.

Add registered commands (`registerReviewCommand`) for:

- Scheduling an existing unscheduled Life OS Plan (`plan.schedule`).
- Rescheduling an eligible Life OS Plan (`plan.reschedule`, via the new
  `reschedulePlan` command above).
- Recording a chosen Level Up recommendation and handing the user into the
  existing workout flow (`level_up.record_recommendation`). Clarify at
  implementation time whether this **is** the same mechanism as
  `docs/LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md` phase 4's "suggested prescriptions
  with one-tap override" surfaced through Home, or a distinct wrapper around
  it — don't let the two initiatives independently build two ways to accept
  a workout recommendation.

Accepting or editing a proposal executes the stored command; it never
re-derives the action. Editing may change the proposed Plan time within the
validated candidate window.

Capacity guidance without a mutation may be acknowledged or dismissed
directly. Google Calendar events, outbound communications, purchases,
deletions and identity-sensitive changes remain unavailable.

### 4. Home experience

Add a Still v2 Capacity Brief in the **fixed slot** directly below Quick
Capture and the day selector — the same mechanism `ReconciliationWidget`
already occupies in `apps/home/app/page.tsx`, not a `CustomizableWidgetGrid`
slot (that grid is a separate, draggable, four-slot mechanism —
`["schedule", "prepare", "commitments", "nudges"]` — a different placement
model entirely). Real current render order:

```
<QuickCapture />
<DayReviewNavigation day={reviewDay} tz={tz} />
<ReconciliationWidget .../>   ← Capacity Brief goes here, same slot type
<CommunicationsReviewWidget .../>
<CustomizableWidgetGrid ...>  ← draggable grid, different mechanism
{hourInTz >= 17 && <EveningCheckIn/>}
<WeeklyReview .../>
```

Build from `ReconciliationWidget.tsx` + `ReconciliationCards.tsx` as the
concrete precedent: day-scoped props (`day`, `tz`), a card list with
per-item resolution (their `Happened/Changed/Cancelled/Skip` is the same
shape as Accept/Edit/Dismiss), local state that shrinks the list as items
resolve, each action calling a dedicated route.

**Absorb `scripts/brief`**: it already assembles the day's Events, standalone
Interactions, action items, and active Plans (`scripts/brief/generate.ts`),
and its execute step (`scripts/brief/execute.ts`) parses annotations back
into real writes (complete an action item, create a follow-up Plan, append a
note). Extract the data-assembly query into a shared function (`packages/domain`
or `apps/home/server`) that both the Capacity Brief widget and the CLI script
call — the CLI becomes a thin wrapper over shared logic, not a second
implementation. The Capacity Brief's ranked interventions sit on top of this
shared assembly. Port `execute.ts`'s three write actions as
`registerReviewCommand` handlers too, so the same actions are reachable from
both the markdown-annotation flow and the widget's Accept/Edit/Dismiss
controls instead of drifting into two ways to do the same three things.

The surface shows:

- Current capacity band with a calm explanation.
- Zero to three ranked recommendations.
- Original versus proposed time or workout choice.
- Evidence and freshness behind a "Why this?" disclosure (reuses
  `ReviewItem.evidence`).
- Accept, Edit and Dismiss controls.
- A visible missing-data state without pressuring the user to connect more
  sources.
- Manual Refresh when newer source data exists.

The current day is interactive. Historical days show their preserved brief
and outcomes read-only.

Page load performs no paid AI call. Optional AI explanation rewriting must be
separately invoked, receive only the bounded evidence already used by the
rule, preserve reason codes and commands exactly, and fall back to
deterministic copy.

### 5. Outcome learning

Record passive follow-through from the graph:

- A scheduled/rescheduled Plan completed or fulfilled inside its target
  window becomes `followed_through`.
- A linked Level Up session completed with the chosen prescription becomes
  `followed_through`.
- Lack of evidence becomes `unknown`, never `failed`.
- Edits and dismissals remain preference signals, not proof that an outcome
  was bad.

When an accepted intervention has reached its outcome window but cannot be
evaluated, Evening Check-In may ask one question: "Did this adjustment
help?" Responses are Helpful, Not helpful or Not sure, with an optional short
note. Never ask more than one intervention question per day.

Collect data before adapting rankings. After five resolved interventions of
the same discretionary category, use a transparent 90-day decayed preference
score to rank otherwise-equivalent proposals. Learning may affect rank and
wording only; it must never weaken risk tiers, alter health thresholds or
suppress safety-relevant readiness evidence.

### 6. Progressive health improvements

Do not block Adaptive Day on the full health stack. This work is **already
scoped and committed** — `docs/LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md`'s Delivery
Sequence phases 2-3, cross-referenced by `docs/IOS_PLATFORM_PLAN.md` M3/M4.
Reference those documents directly rather than restating the steps here, to
avoid the two docs drifting on numbering or scope. In short (see the linked
docs for full detail):

1. Replace fixed recent-day HealthKit reads with anchored per-type
   checkpoints — confirmed still real/undone:
   `HealthConnector.swift`'s `metricTypes` uses a fixed 2-day
   `HKStatisticsCollectionQuery` lookback today.
2. Add sleep duration/stages and source-aware FoodNoms nutrition aggregates —
   confirmed fully greenfield, zero FoodNoms code today.
3. Feed real HealthKit inputs into Level Up readiness.
4. Add direct Oura daily-score integration and shadow validation — confirmed
   fully greenfield, zero Oura connector code today.
5. Expose source freshness and missing permissions in Home and Level Up.

Keep raw samples, meals and GPS data local. Sync only approved daily
aggregates and provenance. Nutrition informs context but does not lower
workout readiness in v1.

### 7. Later expansion

After at least two weeks of reliable interventions and outcomes:

- Add deterministic personal-pattern experiments for meeting load versus
  energy, workout timing versus completion and schedule fragmentation versus
  stress.
- Require at least 14 observations spanning 28 days.
- Describe results as associations, never causation.
- Later add relationship, administrative and financial interventions through
  the same engine and ReviewItem boundary.
- Add draft-only message, shopping-list and schedule proposals before
  considering any outbound execution.

## Test and rollout plan

- Pure tests: capacity thresholds, missing/stale inputs, timezone and DST
  boundaries, proposal ranking, three-item cap, fixed-versus-flexible
  scheduling, buffers and three-day search.
- Integration tests: workspace isolation, idempotent generation, refresh
  supersession, ReviewItem acceptance/edit/dismissal, GraphEvent publication,
  duplicate-command replay, and idempotent replay through `COMMAND_REGISTRY`
  specifically (resolving the same `ReviewItem` twice returns the stored
  result, doesn't re-run the command).
- Shared-assembly test: the extracted `scripts/brief` data-assembly function
  returns identical data whether called from the CLI script or the Home
  widget's server code.
- Safety tests: no Google Calendar mutation, no external-source Plan
  movement, no action without confirmation and no AI-generated command
  changes.
- Outcome tests: passive completion matching, workout matching, unknown
  fallback, one-prompt-per-day limit and minimum-sample learning gate.
- State tests: `getLatestStates` returns neutral/unknown (not negative) when
  no row exists for a type, and correctly picks the most recent of a
  same-day morning + evening check-in pair.
- Plan-reschedule tests: `reschedulePlan` rejects all four exclusion cases
  (`externalSource` set, `fulfilledBy` set, `reconciliationStatus` !=
  pending, `status: completed`).
- Health tests: anchored replay, source filtering, permission loss,
  duplicate workout reconciliation and absence of granular health/meal data
  in requests or logs.
- UI tests: zero/one/three recommendation states, freshness and
  missing-data explanations, responsive Still presentation and accessible
  controls.
- Verification gate: lint (dependency boundaries + migration integrity),
  type-check, complete tests, builds and Home end-to-end tests — via the
  documented scratch-`DATABASE_URL` + `migrate:deploy` recipe used
  throughout this repo's other domain work.
- Rollout: run the engine in recorded shadow mode for seven days; inspect
  false or noisy proposals; then enable confirmation actions while retaining
  deterministic fallback and an immediate feature disable switch.

## Assumptions and explicit deferrals

- Joseph is the first audience; workspace isolation remains mandatory.
- Home is the control surface and focused apps remain domain lenses.
- Google Calendar remains read-only in v1. Calendar sync itself lives in
  `apps/events`, not `apps/home` — relevant for anyone touching
  calendar-adjacent code in this initiative.
- No notification delivery, dynamic alerts or unsolicited AI generation.
- No agent swarm, DNA interpretation, dedicated AI device, new calorie
  logger, giant health dashboard or ninth Task primitive.
- `apps/companion`, `docs/COMPANION_ARCHITECTURE.md`, and the device/health
  API routes are **settled, merged architecture** (already committed to
  `master`), not in-progress work to design around — treat as fixed
  reference points, not moving targets.
- Labs ingestion, Google Calendar writes, unified outbound messaging,
  grocery execution and raw Git/email correlation require separate future
  plans.

## Related documents

- `docs/LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md` — authoritative HealthKit/Oura/
  FoodNoms/readiness roadmap referenced by section 6.
- `docs/IOS_PLATFORM_PLAN.md` — M3/M4 milestones cross-referencing the same
  health work.
- `docs/PERSONS_MESH_PARITY_PLAN.md` — originated the "serve `scripts/brief`"
  recommendation absorbed into section 4.
- `docs/COMPANION_ARCHITECTURE.md` — device/HealthKit data-flow architecture.
- `~/.claude/plans/luminous-wondering-tome.md` — the full review trail this
  document's corrections were drawn from.
