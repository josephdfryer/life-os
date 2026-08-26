# ADR 0003: A unified Connection model for third-party account integrations

- Status: accepted
- Date: 2026-08-09
- Owners: @josephdfryer

## Context

LifeOS has three third-party account integrations — Google Calendar, Gmail, and Era (finance) —
each modeled by its own near-identical Prisma table: `CalendarConnection`, `GmailConnection`,
`EraConnection`. All three share the same real shape: `accessTokenEncrypted`/
`refreshTokenEncrypted` (via `packages/db/src/crypto.ts`), `expiresAt`, `scope`, `status`,
`lastSyncedAt`/`lastError`, `workspaceId`+`userId` scoping. `docs/ERA_FINANCE_INTEGRATION.md`
explicitly says `EraConnection` "models directly after `CalendarConnection`/`GmailConnection`" —
this ad hoc per-integration pattern was already the de facto template, just never generalized.

Two concrete problems follow from never generalizing it:

1. **No single place to see or manage every connection.** Each integration's status/reconnect UI
   lives in a different app (Calendar in `apps/events`, Gmail in Persons' Admin, Era nowhere at
   all — it's CLI-only via `scripts/era/*.ts`, invisible day-to-day).
2. **Google Calendar's OAuth/refresh logic is duplicated near-identically in two apps** —
   `apps/events/server/domain/google-calendar.ts` (1235 lines, canonical, cron-driven) and
   `apps/persons/server/domain/google-calendar.ts` (703 lines, a near-copy whose own sync endpoint
   is already a documented dead-end). Two implementations of the same refresh logic is exactly the
   kind of drift this project has hit before (see ADR 0002's four divergent review-queue accepts) —
   and it's the direct cause of not knowing where token refresh actually happens.

This ADR is part of Track C (`~/.claude/plans/humble-sniffing-honey.md`), which also builds a
single Connections hub in Home and deletes the duplicate Calendar code — this ADR covers only the
schema decision underneath that hub.

## Decision

Add one additive `Connection` model (`packages/db/prisma/schema.prisma`) with a `kind` field
(`"calendar"` | `"gmail"` | `"era"`, an open string not an enum, matching this schema's existing
convention for `Interaction.type`/`Rule.trigger`/etc.) covering the shared shape, plus a
`metadata: String?` JSON column for kind-specific fields that don't earn their own column
(`calendarId`/`calendarSummary` for calendar, `mailboxId`/`historyId` for gmail, `syncCursor` for
era).

This is explicitly **not a cutover** in this phase. `CalendarConnection`/`GmailConnection`'s
downstream link tables (`CalendarEventLink`, `GmailMessageLink`) still reference *those* tables'
ids — repointing live foreign keys used by production event/message reconciliation is a separate,
riskier migration than this one, and nothing forces it to happen at the same time as unifying the
read side. So:

- **Calendar and Gmail** keep their real OAuth write path on their existing tables. Their
  `Connection` row is a **dual-written mirror** (`sourceTable`/`sourceId` point back to the row of
  truth) kept in sync purely so the unified Connections hub has one place to read from. Whichever
  app owns the real OAuth flow (Events for Calendar; Persons for Gmail, unchanged) writes to both
  tables on every refresh/status change.
- **Era** does have a real, working CLI pipeline against `EraConnection`
  (`scripts/era/{import-from-json,sync-from-era,sync-accounts,store-api-key}.ts`) — this was
  under-researched when this ADR was first drafted; Era is not actually a clean slate. Rather than
  risk that pipeline by migrating four interdependent scripts onto a new table in the same phase as
  building its first-ever web UI, Era follows the **same dual-write mirror pattern as Calendar and
  Gmail**: the real API-key credential and sync state stay on `EraConnection` (unlike Calendar/
  Gmail, this is a static API key, not an OAuth token, so there is no refresh flow to duplicate —
  Era's "connect" is a straightforward key-paste-and-store, closer to `AiProviderCredential`'s
  upsert than to Calendar/Gmail's OAuth dance), and the new web route dual-writes a `Connection`
  mirror row purely for the unified hub. Migrating the CLI scripts onto `Connection` fully is a
  follow-up, not part of this phase.

`packages/db/turso-migrate-connection-model.ts` creates the table and backfills one mirror row per
existing `CalendarConnection`/`GmailConnection`/`EraConnection` row, matched idempotently by
`sourceTable`+`sourceId` (not by the unique business key, since `accountEmail` can be null and
SQLite treats distinct `NULL`s as non-colliding in a unique index — an `INSERT OR IGNORE` on the
business key would silently re-insert on every re-run).

## Alternatives considered

- **Repoint `CalendarEventLink`/`GmailMessageLink` onto the new table now (full cutover):**
  rejected for this phase. That's two additional live-FK migrations stacked on top of the schema
  unification, each independently risky (in-flight sync jobs, encrypted token round-tripping) —
  bundling them multiplies the blast radius of one deploy for no immediate user-facing gain beyond
  what the mirror already provides (a single readable list). Worth doing later once the mirror has
  proven itself in production; tracked as a follow-up, not blocking this ADR.
- **Keep three separate tables, no unification, just a UI that fans out to all three:** this is
  what an earlier design pass ("C2a hub-only") proposed. Rejected per Joseph's explicit choice —
  "also unify the schema now" — over the incremental alternative, on the reasoning that three
  structurally-identical tables are exactly the kind of drift this project keeps having to clean up
  after the fact (see the Calendar OAuth duplication itself), and the schema-only piece is
  additive/low-risk on its own even before any UI depends on it.
- **A generic `provider`+`kind` model from day one for Calendar/Gmail too (no dual-write mirror,
  immediate full cutover):** rejected as higher risk than the value it adds this phase — see first
  alternative above.

## Consequences

Every future integration (a fourth OAuth provider, say) gets a home in `Connection` with zero
schema change. The dual-write requirement is a real, ongoing cost on all three integrations' write
paths (two writes instead of one on every credential change) until the follow-up cutover happens —
this is the deliberate, documented interim state, not an oversight. Every `Connection` row in this
phase carries a non-null `sourceTable`/`sourceId` back to its row of truth; callers reading
`Connection` should treat it purely as a read/status projection, not assume they can write back to
it directly (writes still go through the owning app's or script's existing route/pipeline).

## Verification and rollback

- `scripts/check-migration-integrity.mjs` (already in CI) verifies the migration pairs with
  `turso-migrate-connection-model.ts` and that the full history replays into an empty database.
- Backfill row-count parity check before considering the mirror trustworthy: count of `Connection`
  rows per `sourceTable` should equal the source table's row count.
- Rollback: the table is additive and nothing writes to it as the sole source of truth for
  Calendar/Gmail in this phase, so reverting application code that reads `Connection` leaves every
  existing integration fully functional off the old tables — no data-shape rollback required.

## Extraction triggers (services only)

Not applicable — this is a schema unification inside the existing single database, not a service
extraction.
