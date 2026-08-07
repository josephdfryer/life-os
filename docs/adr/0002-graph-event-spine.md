# ADR 0002: A GraphEvent ledger as the automation and intelligence spine

- Status: accepted
- Date: 2026-08-07
- Owners: @josephdfryer

## Context

Life OS has one graph and eight apps, but no shared record of what happened to it. Automation
(`apps/persons/server/domain/rules.ts`) can only ever mutate `StagedInteraction` fields and
`Person.tags` — `applyRuleActions` returns `[]` for any other `targetType`. Production holds one
seeded `Rule` row and zero `RuleRun`s: there is no automation to speak of yet, only the scaffolding
for it. Whole-life synthesis (`packages/theory`) is an explicit stub with no model call. Neither
has anything durable to react to — every consumer that wants "what changed recently" has to poll a
table and guess, or re-derive state from scratch.

Four review queues (`StagedInteraction`, `NoteSuggestion`, `ImportStagedVisit`, calendar
reconciliation via `Plan.reconciliationStatus`) each have their own accept implementation, and Home
has a second, divergent copy of the `StagedInteraction` accept path
(`apps/home/app/api/communications/[id]/route.ts:60`) that does not call the Persons domain and
does not fire any rule trigger. Two implementations of one command already disagree.

## Decision

Add an immutable `GraphEvent` ledger, `GraphEventReceipt` for idempotent at-least-once consumption,
and `ReviewItem` as universal review workflow state. All three are additive tables in the existing
Turso database — no service extraction, no new datastore.

Every canonical domain command (living in `packages/domain`) writes its record changes and its
`GraphEvent` in one `db.$transaction`. If a command cannot do both atomically, it is not a command
yet. Consumers (automation, intelligence, future ones) record one `GraphEventReceipt` per
`(event, consumer)` — the unique constraint on that pair is the entire idempotency guarantee.
Failed work stays retryable via `attempts` / `lastError` / `nextRetryAt`.

Automation loop prevention is structural, not policy: `causationDepth` increments by one each time
an event is produced as the result of processing another event, and a hard cap (5) makes an
infinite automation loop mathematically impossible rather than merely discouraged.

Authority reuses the band vocabulary already proven in `packages/db/src/enrich.ts`
(`auto` / `suggested` / `adjudicated` / `manual`, where automation may only overwrite bands it
wrote itself and `manual` is immutable) — that rule already governs 3,146 live finance
`InteractionParticipant` edges in production. `ReviewItem.riskTier` extends the same idea to whole
proposed commands: `observe` (automatic, read-only) → `safe_auto` (automatic, reversible) →
`review` (goes to the Inbox) → `confirm` (never automatic — merges, deletes, access changes,
outbound messages, money).

The worker that drains `GraphEventReceipt` runs inside the existing Next.js deployments against the
one database. This is explicitly the "durable queue, one database owner" step that
`docs/SERVICE_EXTRACTION_CRITERIA.md`'s preferred evolution path already endorses — it is not a
service extraction and does not need to satisfy that document's extraction gate.

## Alternatives considered

- **External queue (SQS/Cloud Tasks/etc.):** rejected for the same reason ADR 0001 rejects
  microservices — no measured trigger yet, and it would add an operational dependency for a
  single-user system that a database-backed worker already satisfies.
- **Convert the existing rules engine in place:** rejected because there is nothing to convert.
  Zero `RuleRun` rows exist; the one seeded `Rule` only ever wrote `StagedInteraction.status`. A
  fresh, typed engine is strictly less work than migrating behavior that was never exercised.
- **Skip the event ledger; poll tables for automation triggers:** rejected because polling cannot
  express causation, cannot bound automation loops, and cannot give intelligence a stable notion of
  "what changed since the last synthesis" without re-scanning the whole graph.
- **Time-boxed shadow mode (e.g. "7 days"):** rejected for a single-user, single-workspace system —
  gate promotion on **events processed with zero divergence**, not calendar time.

## Consequences

Every future write path in `packages/domain` must be transactional with its event, which is a real
constraint on how commands are written but is also what makes replay, audit, and "what happened"
queries free once the command exists. Consumers must be idempotent by construction, which is more
upfront design than a fire-and-forget callback but removes an entire class of double-processing
bugs. The four existing review queues keep their own tables during migration (`ReviewItem` adapters
dual-write into them) — this is deliberate: `Shared-table dual ownership is forbidden`
(`SERVICE_EXTRACTION_CRITERIA.md`), so the legacy tables stay authoritative until each adapter is
individually proven, then `ReviewItem` takes over.

## Verification and rollback

- Contract tests in `packages/domain/tests/`: every command writes records + `GraphEvent` in one
  transaction; a failed transaction writes neither.
- Idempotency test: replaying the same event twice against a consumer produces one receipt and one
  effect.
- Loop-prevention test: a rule whose action produces an event matching its own trigger halts at
  `causationDepth` 5.
- `scripts/check-migration-integrity.mjs` (already in CI) verifies the migration pairs with
  `turso-migrate-graph-event-spine.ts` and that the full history replays into an empty database.
- Rollback: every consumer sits behind an independent flag. The tables are additive, so reverting
  application code leaves them present but unread — no data-shape rollback is required. Legacy
  review queues remain the source of truth until their `ReviewItem` adapter is individually
  promoted, so no migration is a one-way door.

## Extraction triggers (services only)

Not applicable. The event worker is a consumer of the existing Next.js deployments against the
existing database — not an extraction. See "Decision" above.
