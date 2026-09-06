# Finance as Interactions — Storage & Access Plan

**Status:** Phases 1, 2 (partial) and 4 shipped to production (Aug 3, 2026).
933 of 5,568 transactions are canonical Interactions; the assistant reads them
via SQL. Phase 3 (stream API) and Phase 5 (reconciler) pending.
**Date:** August 2, 2026
**Supersedes the storage sections of:** `docs/ERA_FINANCE_INTEGRATION.md` (Phase 1 as built)
**Related:** `docs/FINANCE_FRAMEWORK.md`, `docs/MANIFESTO.md`, `docs/PLACES_ARCHITECTURE.md`

---

## 0. Diagnosis — why the assistant can't see the money

This is not a permissions or tooling problem. It's a storage problem. Measured against the live database on Aug 2, 2026:

| Check | Result |
|---|---|
| `Interaction` rows with `type = "financial"` | **0** |
| `StagedInteraction` rows with `source = "era"` | **683, all `status = "pending"`** |
| `EraTransactionLink` rows | 683, **all `status = "staged"`** |
| `EraAccountLink` rows | 11 accounts, **none attributed to a person** |
| `Group` rows | **0** — no family unit exists |
| `InteractionParticipant` rows | 8 total (Event/Person/Plan), effectively unused |
| Transactions in Era | ~5,300 — so **~87% were never even imported** |

Every financial fact in LifeOS is sitting in the **review queue**, not the graph. And the amount isn't even a column — it's a string inside `StagedInteraction.metadata` JSON:

```json
{"eraTransactionId":"utgr_GlzxYv1Dkmh","eraCategory":"Dining out","rawAmount":-20,"amount":20,...}
```

Four consequences follow directly, and they're exactly the symptoms:

1. **Nothing is queryable in SQL.** `apps/assistant/lib/finance.ts` has to `findMany` up to 2,000 staged rows, `JSON.parse` each one, and filter/sum in JavaScript (`finance.ts:58-136`). No `WHERE amount > x`, no `GROUP BY category`, no index. It works today only because 683 rows is small.
2. **Two sources of truth.** `finance.ts` reads *both* `StagedInteraction` and `Interaction`, then de-dupes by hand (`finance.ts:104`, `finance.ts:115`). That branch exists purely to paper over the fact that promotion never happens.
3. **No stream to query.** `/api/v1/interactions` exists but only filters by `personId` and pages by offset. There is no "all my interactions, newest first, keep going" endpoint — which is precisely what you asked for.
4. **No owner.** A transaction has no concept of *whose money moved*. `Interaction.personId` is reserved for the counterparty (the merchant). There is nowhere to say "this was on Qin's card."

The architecture in `ERA_FINANCE_INTEGRATION.md` said: stage everything → human reviews → promote to `Interaction`. That gate was never opened, and it never will be at 5,300 rows/backlog + ~200/month. **The gate is the bug.**

---

## 1. The core inversion

> **A transaction is already true. It does not need permission to enter the graph.**

The staging model treats an Era transaction as a *proposal*. It isn't. The $20 at Summerlin Tennis Club **happened**. What's uncertain is only the *context* — which Place, which Event, which Person, which Plan. Holding a certain fact hostage to uncertain context is what broke this.

So the pipeline inverts:

```
BEFORE:  Era → StagedInteraction → [human gate] → Interaction
                                    ↑ never opened

AFTER:   Era → Interaction (immediately, standalone, complete)
                    ↓
              Enrichment reconciler (idempotent, re-runnable, forever)
                    ↓
         participants: Place, Event, Person, Item, Plan — attached whenever
         the evidence arrives (today, or when Timeline syncs next month)
```

This is the "stand alone with the ability to add context later" property you asked for, stated as an invariant:

> **Every financial Interaction is valid and queryable the moment it lands. Context is monotonically additive and never blocks ingestion.**

`StagedInteraction` doesn't disappear — it keeps its real job (unmatched *communications*, ambiguous *identities*). It stops being a holding pen for settled facts.

This is consistent with the manifesto, not a departure from it. "Inference first, manual override available" — inference should *write*, and review is how you correct it, not how you authorize it. What must never be silently created is a **new Person node** for an unknown merchant; that stays gated (§4.3).

---

## 2. Schema changes

Money already stores correctly as integer cents (`Interaction.amount Int?` — good, keep). Everything below is additive; no column is dropped or retyped, so the migration is `ALTER TABLE ADD COLUMN` + `CREATE INDEX` only.

### 2.1 `Interaction` — make a transaction self-sufficient

```prisma
model Interaction {
  // ... existing fields unchanged ...

  // ── Provenance: dedupe anchor at the canonical level ──────────────
  source          String?   // "era" | "manual" | "imessage" | "gmail" | "calendar"
  sourceId        String?   // Era transaction_id, Gmail message id, etc.

  // ── Money ─────────────────────────────────────────────────────────
  // amount Int? (cents) and direction String? already exist
  subtype         String?   // purchase | payment | transfer | refund | income | fee | subscription
  currency        String    @default("USD")
  category        String?   // Era's category, promoted from JSON — usage earned it
  merchantName    String?   // cleaned descriptor; survives even with no Person match
  accountLinkId   String?   // → EraAccountLink. WHICH card. The ownership anchor.
  accountLink     EraAccountLink? @relation(fields: [accountLinkId], references: [id], onDelete: SetNull)

  // ── Whose money moved (see §3) ────────────────────────────────────
  actorPersonId   String?
  actorPerson     Person?   @relation("InteractionActor", fields: [actorPersonId], references: [id], onDelete: SetNull)

  // ── Enrichment state (see §5) ─────────────────────────────────────
  enrichmentVersion Int     @default(0)  // bump to force reconciler re-run
  enrichedAt        DateTime?

  @@unique([workspaceId, source, sourceId])          // idempotent ingest
  @@index([workspaceId, timestamp(sort: Desc), id])  // keyset stream (§6)
  @@index([workspaceId, type, timestamp(sort: Desc)])
  @@index([workspaceId, actorPersonId, timestamp(sort: Desc)])
  @@index([workspaceId, category, timestamp(sort: Desc)])
  @@index([accountLinkId])
}
```

Notes on the judgment calls:

- **`category` promoted to a column.** `ERA_FINANCE_INTEGRATION.md` said "start with `metadata`, promote if queries get frequent." Queries are frequent — `get_spend_breakdown` groups by it on every call. It's earned.
- **`merchantName` is a column, not only a Person link.** A merchant is not always worth a Person node (one-off parking meter). The string is always true; the node is optional. This is what stops ingestion from ever blocking on entity resolution.
- **`source`/`sourceId` + unique index** makes `Interaction` self-deduping. `EraTransactionLink` stays as Era-specific bookkeeping (account link, last-seen, write-back state), but it is no longer load-bearing for correctness.
- **`amount` stays positive; `direction` carries the sign.** Already the convention. Era's `is_cash_outflow` maps to it — never the sign of `amount` (verified quirk, `ERA_FINANCE_INTEGRATION.md:604`).

### 2.2 `InteractionParticipant` — carry provenance for late-bound context

This table already exists and is the right home for "context attached later." It just needs to record *how confident* and *why*, so the reconciler can re-run and safely overwrite its own weaker guesses without ever clobbering your manual edits.

```prisma
model InteractionParticipant {
  // ... existing: id, interactionId, entityType, entityId, role, workspaceId ...

  confidence  Float?    // 0–1
  band        String?   // "auto" | "suggested" | "adjudicated" | "manual"
  source      String?   // "era" | "timeline-join" | "merchant-map" | "rule" | "manual"
  evidence    String?   // JSON: what matched, why (audit trail)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@unique([interactionId, entityType, entityId, role])
  @@index([entityType, entityId, interactionId])
  @@index([workspaceId, entityType, entityId])
}
```

**Rule: the reconciler may only overwrite rows whose `band` it wrote itself. `band = "manual"` is immutable to automation.** That single rule is what makes enrichment safe to run forever, on a cron, retroactively, without ever undoing your corrections.

Roles for finance: `payer`, `payee`, `merchant`, `occasion`, `location`, `beneficiary`, `household`.

### 2.3 `EraAccountLink` — the ownership anchor

```prisma
model EraAccountLink {
  // ... existing ...
  ownerPersonId String?   // Joseph's Amex vs Qin's card. Set ONCE, per account.
  ownerPerson   Person?   @relation(fields: [ownerPersonId], references: [id], onDelete: SetNull)
  householdGroupId String? // → Group(family). Joint accounts point here.
  householdGroup   Group?  @relation(fields: [householdGroupId], references: [id], onDelete: SetNull)
  isShared      Boolean   @default(false)  // joint checking

  @@index([ownerPersonId])
}
```

Ownership is declared **once per account (11 rows)**, not per transaction (5,300 and counting). That's the whole trick.

### 2.4 `Group` gets interactions

`Group` currently has no interaction edge — it can only be reached via `PersonGroup`. Add the back-relation so a Group can be a first-class participant (`InteractionParticipant.entityType = "Group"` already supports it structurally; this just makes it navigable in Prisma):

```prisma
model Group {
  // ... existing ...
  eraAccounts EraAccountLink[]
}
```

---

## 3. Whose money is it — the two-ended edge

A social interaction has one obvious other end. A financial one has **two**, and the current schema only has one Person slot. That's the modeling gap behind "charges on Qin's card should go against her."

| End | Field | Semantics |
|---|---|---|
| **Who paid** | `actorPersonId` | Joseph, or Qin. Derived from the account. |
| **Who was paid** | `personId` *(existing)* | The merchant/counterparty, when it warrants a Person node. |

**`actorPersonId` is derived from `accountLinkId`, then denormalized onto the row.**

This is a deliberate, narrow exception to *derived over stored*, and it's worth stating why it doesn't violate the principle. The manifesto forbids storing **aggregates** — values that go stale when underlying facts change. `actorPersonId` is not an aggregate; it's a **stable foreign key** whose source of truth (`EraAccountLink.ownerPersonId`) changes approximately never. Denormalizing it turns "all of Qin's spending" from a three-table join into a single indexed scan. If an account's owner is ever corrected, one repair script re-derives the column — and because the source of truth still lives on the account, it can never silently disagree with itself for long.

The guardrail: **`EraAccountLink.ownerPersonId` is authoritative. `Interaction.actorPersonId` is a cache.** A `verify-actor-attribution` check runs in the nightly reconciler and reports drift.

### Attribution ladder

1. Account has `ownerPersonId` → that person is `actor`.
2. Account has `isShared = true` → `actorPersonId = null`, and an `InteractionParticipant(entityType: "Group", role: "payer")` row points at the family Group. Joint spend is honestly attributed to the household, not falsely to one spouse.
3. No mapping yet → `actorPersonId = null`, flagged for one-time account setup. Still fully ingested and queryable.

### Family aggregation

Create one `Group { groupType: family, name: "Fryer household" }` with `PersonGroup` rows for Joseph, Qin, and the kids. Family spend is then a derived query, never a stored total:

```sql
SELECT SUM(i.amount) / 100.0
FROM Interaction i
LEFT JOIN PersonGroup pg ON pg.personId = i.actorPersonId AND pg.groupId = :familyGroupId
LEFT JOIN InteractionParticipant ip
       ON ip.interactionId = i.id AND ip.entityType = 'Group' AND ip.entityId = :familyGroupId
WHERE i.type = 'financial' AND i.direction = 'paid'
  AND i.timestamp >= :start AND i.timestamp < :end
  AND (pg.id IS NOT NULL OR ip.id IS NOT NULL)   -- personal-by-member OR joint-by-household
```

Three views fall out of the same data with no extra storage: **mine** (`actorPersonId = joseph`), **hers** (`actorPersonId = qin`), **ours** (the query above). Scoping is a `WHERE` clause, exactly as it should be.

> **To verify during implementation:** Era's transaction payload carries `"scope": "Owner"`, which suggests Era already distinguishes account holders. If Qin's card is on your Era connection it'll appear as its own `account_group_key` and just needs `ownerPersonId` set. If it's on a separate Era login, that's a second `EraConnection` — the schema already supports it (`@@unique([workspaceId, userId])`); confirm before building.

---

## 4. Ingestion

### 4.1 Replace the JSON-dump importer with a live sync

`scripts/era/import-from-json.ts` reads hand-saved MCP output from disk. That's why only 683 of ~5,300 transactions exist. Build `packages/sync/era/` properly:

- `client.ts` — MCP client for `https://context.era.app/mcp`, bearer token from `EraConnection.accessTokenEncrypted` (crypto helper already exists: `packages/db/src/crypto.ts`).
- `sync-accounts.ts` — upsert `EraAccountLink`; **preserve `ownerPersonId` on update** (never overwrite a human decision).
- `sync-transactions.ts` — date-watermark sync, `from_date = lastSyncedAt − 5 days` to catch late postings; page-based (`page`/`page_size` max 100); idempotent via `Interaction(workspaceId, source, sourceId)` unique.
- Time-budgeted and resumable, same as the Gmail backfill in `apps/persons/server/domain/gmail.ts` — 5,300 rows won't finish in one function invocation.

Schedule: every 4 hours via the existing scheduler (`scripts/scheduler/`).

### 4.2 Ingest maps straight to `Interaction`

```ts
{
  workspaceId,
  type: "financial",
  subtype: isTransfer ? "transfer" : (txn.is_cash_outflow === false ? "income" : "purchase"),
  source: "era",
  sourceId: txn.transaction_id,          // ← unique; re-runs are no-ops
  timestamp: new Date(txn.transaction_date),   // date-only; see §4.4
  amount: Math.round(Math.abs(txn.amount) * 100),   // cents
  direction: isTransfer ? "transfer" : (txn.is_cash_outflow === false ? "received" : "paid"),
  currency: txn.currency ?? "USD",
  category: txn.category ?? null,
  merchantName: txn.description,          // cleaned; NOT merchant_name (often "Google Pay")
  summary: txn.description,
  notes: null,                            // reserved for human text — see §4.5
  accountLinkId: accountLinkFor(txn.account_group_key),
  actorPersonId: ownerOf(txn.account_group_key),    // §3 ladder
  personId: null,                         // filled by reconciler only on confident match
  metadata: JSON.stringify({ rawDescription: txn.original_description, postedDate: txn.posted_date, categoryKey: txn.category_key }),
}
```

Everything Era gives us that we don't model becomes `metadata` — but nothing we *query* lives there anymore.

### 4.3 What still gets staged

Only genuine ambiguity, and only the part that's ambiguous:

- **A merchant that would require creating a new Person node.** Creating 800 low-value company Persons silently would wreck a 7,369-person graph. The Interaction lands regardless with `merchantName` set; only the *Person link* waits.
- **Transactions on an account with no `ownerPersonId`.** One row per account, not per transaction.

Everything else: straight in.

### 4.4 Date-only timestamps

Era gives `transaction_date` with no time component. Two consequences to honor:

- Store as **local midnight in `America/Los_Angeles`**, not UTC midnight. The current importer does `new Date("2026-07-08")` → UTC midnight → renders as *July 7, 5pm* Pacific. Every "what did I spend yesterday" query is off by one for late-evening boundaries. Fix in the same migration (`packages/db` helper, matching the `zonedTimeToUtc` logic already in `finance.ts:327`).
- Set a `metadata.timePrecision: "day"` marker so the Event-join reconciler knows to match on the whole day, not a time window.

### 4.5 One correctness bug to fix while we're here

`apps/assistant/lib/finance.ts:116` reads `JSON.parse(row.notes)` on `Interaction` and treats it as a metadata object. `notes` is human-written free text; `metadata` is the JSON column. It silently returns `null` today (parse fails → catch), so `eraCategory` and `transfer` are always undefined on the `Interaction` branch — meaning **transfers are not currently excluded from any interaction-sourced spend total**. It's harmless right now only because that branch matches zero rows. It becomes a real double-counting bug the moment §7 lands.

---

## 5. The enrichment reconciler — context, added later

A single idempotent job, safe to run any number of times, over any time range. This is the piece that makes late-binding context work.

```
for each financial Interaction in scope:
  for each dimension (place, event, person, item, plan):
    if a participant row exists with band = "manual": skip forever
    else: run the resolution ladder, upsert with confidence + evidence
```

### Resolution ladders

**Place** (per `ERA_FINANCE_INTEGRATION.md` §Places Interface — the signature move):
1. **Google Timeline join** — transaction date × fuzzy match of `merchantName` against that day's visited Places. No finance app can do this; you have the location graph.
2. **Learned merchant→Place map** — once confirmed, every future "SPROUTS MARKELAS VEGAS NV" auto-links.
3. **City/state parse** — trailing `CITY ST` from `metadata.rawDescription` → region rollup.
4. Leave unset. Not an error, just not known yet.

**Event** — Events overlapping the transaction's day, ranked by Place agreement then by attendee/merchant plausibility.
**Person (merchant)** — exact `Person.company` → fuzzy → *stage a Person-creation proposal* (never auto-create).
**Person (beneficiary)** — attendees of a matched Event become `role: "beneficiary"`. This is what finally makes "what did that relationship cost me" real.
**Plan** — category/merchant → active Plans, as `suggested` only.

### The append API

Adding context later is a one-call operation, and it is the *only* supported way
to do it — so every source obeys the manual-band rule automatically:

```ts
import { db, attachContext } from "@life-os/db"

// Months later, a Timeline import finally covers April. Attach the Place.
await attachContext(db, {
  interactionId, workspaceId,
  entityType: "Place", entityId: placeId, role: "location",
  band: "auto", source: "timeline-join", confidence: 0.92,
  evidence: { visitId, matchedName: "Sprouts Farmers Market" },
})
// → { status: "created" | "updated" | "unchanged" | "protected" }
```

`protected` means a human had already answered and automation left it alone.
Roles are free strings, so a new kind of context never needs a migration:
`location`, `occasion`, `beneficiary`, `merchant`, `payer`, `household`, …

Implementation: `packages/db/src/enrich.ts`. Behaviour pinned by
`scripts/era/enrich.test.ts` — idempotency and manual-immutability are the two
properties everything else depends on, so they are tested directly.

### Why it must be re-runnable

You import Google Timeline next month covering April. The April transactions are already in the graph, un-placed. The reconciler runs, sees new visit Events, and back-fills `placeId` on 200 old transactions — **without a human touching anything and without disturbing a single manual correction.** That is the whole design goal, and it's only possible because ingestion never waited.

Triggers: after each Era sync (new rows only) · after each Timeline/Places import (affected date range) · nightly (anything with `enrichedAt` older than the current `enrichmentVersion`) · on demand.

### Reuse what exists

`scripts/era/match-places.ts` (607 lines) already implements a Timeline-join place matcher with confidence bands (`auto`/`adjudicated`) and LLM adjudication — visible in the sample row's `placeMatch` metadata. **Don't rewrite it.** Refactor it into `packages/sync/era/reconcile-place.ts` operating on `Interaction` + `InteractionParticipant` instead of staged-row JSON. That's the single largest chunk of existing value to preserve.

---

## 6. The continuous interaction stream API

What you asked for: one endpoint, every interaction, no per-person walk.

### `GET /api/v1/interactions`

**Keyset pagination, not offset.** Offset pagination re-scans from the top on every page — it's already the wrong choice at 2,400 interactions and actively bad at 10,000+. Keyset is O(1) per page regardless of depth.

```
GET /api/v1/interactions
  ?cursor=<opaque>            # base64 of "<timestamp>|<id>" — the previous page's last row
  &limit=100                  # max 500
  &order=desc                 # desc (default) | asc — asc + cursor = tail-following a live feed

  # filters (all optional, all AND-ed, all index-backed)
  &type=financial             # comma-separated
  &subtype=purchase,refund
  &since=2026-07-01&until=2026-08-01
  &actorPersonId=<id>         # whose money — Joseph, or Qin
  &groupId=<id>               # family unit: members' personal spend + joint household spend
  &personId=<id>              # counterparty
  &placeId=<id>  &eventId=<id>  &planId=<id>
  &category=Dining%20out  &direction=paid  &source=era
  &minAmount=5000 &maxAmount=  # cents, inclusive
  &q=trader                    # substring over merchantName/summary

  &include=participants,place,event,person,account   # opt-in expansion, default none
```

```jsonc
{
  "data": [{
    "id": "cm...", "type": "financial", "subtype": "purchase",
    "timestamp": "2026-07-08T07:00:00.000Z", "date": "2026-07-08", "timePrecision": "day",
    "amount": 2000, "amountFormatted": "$20.00", "currency": "USD", "direction": "paid",
    "category": "Dining out", "merchantName": "Summerlin Tennis Club",
    "actor": { "personId": "...", "name": "Joseph Fryer" },
    "account": { "id": "...", "institution": "American Express", "name": "Platinum Card®" },
    "participants": [
      { "entityType": "Place", "entityId": "...", "role": "location",
        "confidence": 0.92, "band": "auto", "source": "timeline-join" }
    ],
    "source": "era", "sourceId": "utgr_GlzxYv1Dkmh"
  }],
  "nextCursor": "MTc1...",     // null = end of stream
  "hasMore": true
}
```

Deliberately **no `total`**. Counting the full filtered set on every page is the expensive part of the current route (`route.ts:26`) and nobody reads it. Ask for it explicitly via `?withTotal=1` if you ever need it.

`amount` is returned in **cents** (integer) with a formatted string alongside — never a float. That's what keeps sums honest end to end.

### `GET /api/v1/interactions/aggregate`

The performance answer, and the endpoint the assistant should actually be calling.

```
GET /api/v1/interactions/aggregate
  ?groupBy=category           # category | merchant | actor | place | event | account | month | day | direction
  &metric=sum                 # sum | count | avg | max
  &<all the same filters>
  &limit=25
```

```jsonc
{
  "groupBy": "category", "metric": "sum",
  "range": { "since": "2026-07-01", "until": "2026-08-01" },
  "total": 482391, "count": 214,
  "groups": [ { "key": "Dining out", "label": "Dining out", "value": 128400, "count": 41 } ]
}
```

This is a single SQL `GROUP BY` over indexed columns. It replaces "fetch 2,000 rows, `JSON.parse` each, reduce in JS." At 5,300 rows the difference is ~50ms vs ~800ms plus the JSON churn; at 50,000 rows the current approach simply stops working.

### `GET /api/v1/interactions/{id}` — unchanged, plus full participant expansion.

### Auth & scoping

Reuse `authorizeApiRequest(req, "interactions.read")` exactly as the existing route does — no new auth surface. Add scope `interactions.finance.read` so a token can be granted the stream *without* money, since financial rows are the most sensitive thing in the graph.

### Where it lives

`apps/persons/app/api/v1/interactions/` — extend, don't fork. It's the canonical `/api/v1` host and already carries the auth, DTO (`server/domain/dto.ts`), and error helpers. Every other app and the assistant consume it from there.

---

## 7. Rewire the assistant

`apps/assistant/lib/finance.ts` shrinks by roughly 80%. Delete: the dual-source read, the JSON parsing, the in-memory grouping, the 2,000-row caps, the hand-rolled dedupe. Keep: `resolveDateRange` (the natural-language period parser is good and has no equivalent server-side) and the formatting.

```ts
export async function getSpendBreakdown(input: SpendBreakdownInput, workspaceId: string) {
  const range = resolveDateRange(input)              // keep — this part is good
  const filters = { type: "financial", direction: "paid", since: range.startDate, until: range.endDate, ...input }
  const [byCategory, byMerchant, byPlace, largest] = await Promise.all([
    aggregate({ ...filters, groupBy: "category" }),
    aggregate({ ...filters, groupBy: "merchant" }),
    aggregate({ ...filters, groupBy: "place" }),
    stream({ ...filters, order: "amount_desc", limit }),
  ])
  // ...
}
```

Then add the tools that only become possible once the data is modeled properly:

| Tool | What it answers |
|---|---|
| `get_spend_breakdown` *(existing, rewritten)* | now with `actorPersonId` / `groupId` scope |
| `get_family_spend` | "what did we spend as a family in July" |
| `compare_spend` | Joseph vs Qin vs joint; period over period |
| `get_interaction_stream` | "walk everything that happened, newest first" — the raw feed, all types |
| `get_relationship_cost` | spend where a Person is `beneficiary` — the `FINANCE_FRAMEWORK.md` §3.1 query, finally real |

---

## 8. Performance

Current scale (2,400 interactions, 5,300 transactions inbound) is small; the goal is that nothing here needs redesigning at 100×.

1. **Keyset pagination** — page depth stops mattering. The single biggest structural win.
2. **Aggregate in SQL, never in JS** — `GROUP BY` over an indexed `category`/`actorPersonId`/`timestamp`, not `JSON.parse` × N.
3. **Composite indexes ordered for the actual access pattern** — `(workspaceId, timestamp DESC, id)` serves the unfiltered stream; `(workspaceId, type, timestamp DESC)` serves every finance query. SQLite will use the leading columns for the `WHERE` and the trailing `timestamp` for the `ORDER BY`, so no filesort.
4. **Partial indexes for the hot slice.** Prisma can't express these; add them in the raw SQL migration:
   ```sql
   CREATE INDEX "Interaction_financial_stream_idx"
     ON "Interaction"("workspaceId", "timestamp" DESC, "id") WHERE "type" = 'financial';
   CREATE INDEX "Interaction_financial_category_idx"
     ON "Interaction"("workspaceId", "category", "timestamp" DESC) WHERE "type" = 'financial';
   ```
   Roughly 1/3 the index size and the planner picks them automatically for finance queries.
5. **`include=` is opt-in.** The default stream response does zero joins. The current route unconditionally `include`s `event` and `sourceFile` on every row (`route.ts:22`) — that's two joins nobody asked for, on every page.
6. **(Historical, SQLite era)** An embedded read replica was configured for ~8ms local reads; superseded by Postgres on Neon.
7. **Cheap materialization, only if measured.** Monthly rollups per (actor, category, month) as a *cache with a rebuild command*, never as the source of truth. Don't build it until an aggregate query is provably slow — the manifesto is right that stored aggregates start lying immediately, and at this data size they'd be premature.

---

## 9. Migration & rollout

At the time this shipped, migrations used the manual SQLite-era script pattern (since retired for `prisma migrate deploy`). All changes are additive → no table rebuild, no downtime.

### Phase 1 as built (Aug 3, 2026)

Shipped to the live database. Differences from the plan as written above:

- **`Interaction.metadata` was added.** The mapping in §4.2 writes to a `metadata`
  column that did not exist — which is exactly why `finance.ts` was abusing
  `notes` for structured JSON. Added alongside the rest.
- **SQLite rejected non-constant defaults on `ADD COLUMN`.** The new
  `InteractionParticipant.createdAt`/`updatedAt` land with an epoch sentinel and
  are backfilled from the parent Interaction in the same migration.
- **Production has no `_prisma_migrations` table** — it has never been managed by
  `prisma migrate`, despite what `DATABASE_MIGRATION_AND_RECOVERY.md` prescribes.
  The real path was the hand-written idempotent SQLite-era migration scripts, and
  this change follows it. That doc and reality need reconciling.
- **`mergePersons` did not know about the new Person references.** Merging two
  people would have silently nulled `Interaction.actorPersonId` and
  `EraAccountLink.ownerPersonId` (both `ON DELETE SET NULL`). Fixed in
  `apps/persons/server/domain/merge.ts`.
- **Refund vs. income is derivable after all.** §4.2 guessed a nonexistent
  "Income" category. Credits in `Paychecks` / `Interest and dividends` /
  `Side hustles and business` are income; credits in a spending category are
  refunds. 23 of the 104 credits are genuine income.
- **`attachContext()` is the supported append path** (`packages/db/src/enrich.ts`),
  not ad-hoc participant writes. It enforces the manual-band rule and is covered
  by `scripts/era/enrich.test.ts`.

### Two bugs the rewrite exposed (Phase 4)

Both produced plausible-looking wrong numbers rather than errors, which is the
dangerous kind. Both are now pinned by tests.

- **Date binding.** SQLite stored DateTime as `…T07:00:00.000+00:00`;
  `Date.toISOString()` ends in `Z`. Same instant, different string — and SQLite
  compares TEXT lexicographically, where `'+' < 'Z'`. A raw query binding an ISO
  *string* therefore dropped every row at exactly the range start and admitted
  every row at exactly the range end. Because Era transactions are date-only and
  land on local midnight, "the first instant of the range" is a whole day of
  spending: "what did I spend yesterday" answered **$0.00** with 225 transactions
  loaded. Bind `Date` objects, never strings. See `scripts/era/date-binding.test.ts`.
- **Column shadowing in GROUP BY.** `SELECT <expr> AS name … LEFT JOIN "Place" pl
  … GROUP BY name` binds `name` to `Place."name"`, not the alias. Every category
  collapsed into one bucket labelled by whichever row SQLite saw first — reporting
  96% of July's spend as "Cash, checks, and misc" ($16,695 instead of $4,473).
  Aggregates now use ordinals (`GROUP BY 1`) and aliases that cannot collide with
  a joined column.

### The ingest runbook (as built)

Order matters: accounts carry ownership, and ownership is what attributes money.

```bash
# 0. Always back up first — raw dump of every table these steps touch.
npx tsx scripts/db/backup-finance-tables.ts

# 1. Accounts. Never overwrites ownerPersonId/isShared/householdGroupId.
npx tsx scripts/era/sync-accounts.ts <accounts.json>

# 2. Ownership + household (idempotent; edit the map inside for new accounts).
cd apps/persons && npx tsx scripts/setup-household-finance.ts && cd ../..

# 3. Transactions -> canonical Interactions. Bulk-insert, dedupes on sourceId.
npx tsx scripts/era/import-transactions.ts <dump-dir> [--dry-run]

# 4. Attribute. One SQL UPDATE for owned accounts + household edges for shared.
npx tsx scripts/era/rederive-actor-attribution.ts     # --check to report only

# 5. Prove it.
npx tsx scripts/era/verify-finance-model.ts
```

Every step is idempotent and safe to re-run. Step 4 doubles as the drift detector
promised in §3: `--check` exits non-zero if any row's `actorPersonId` disagrees
with its account's owner.

### The remaining history — a transport problem, not a modelling one

5,568 transactions exist in Era; 933 are in the graph. The rest predate June 11,
2026. They are not blocked by anything in this design — the importer handles
them at ~250 rows/second — but by **how the bytes get out of Era**.

Era's MCP server is reachable in a Claude session, but paging 5,568 rows through
a conversation is the wrong transport: roughly a third of responses land in the
model's context rather than on disk, and ~48 remaining pages would exhaust it.
The fix is a direct HTTP client to `https://context.era.app/mcp` authenticated
with an Era **API key** (Era supports these for developer tools), run headless:

1. Add `ERA_API_KEY` to `.env`, encrypted into `EraConnection.accessTokenEncrypted`
   via `packages/db/src/crypto.ts` (the schema field already exists).
2. `scripts/era/sync-from-era.ts` — page `transactions__list_transactions` with a
   date watermark (`from_date = lastSyncedAt − 5 days` for late postings), writing
   each page to a dump dir, then invoke the existing importer. No new mapping
   logic: `scripts/era/lib/map-transaction.ts` is already the single definition.
3. Schedule it every 4 hours via `scripts/scheduler/`.

Until then the graph holds a complete and correct Jun 11 → Aug 1 window, and
every number derived from it is honest for that window.

**Phase 1 — Schema + backfill** *(the unblock; everything else depends on it)*
1. Schema changes §2.1–2.4 → `prisma migrate dev` locally.
2. The finance-interactions migration (SQLite era; since folded into the Postgres baseline) — idempotent `ADD COLUMN` + `CREATE INDEX` (incl. the partial indexes).
3. `scripts/era/backfill-staged-to-interactions.ts` — convert all 683 pending staged rows into canonical `Interaction`s: parse `metadata` once, write real columns, carry `placeMatch` results into `InteractionParticipant` with their existing bands, set `EraTransactionLink.status = "accepted"` + `interactionId`. Dry-run flag, resumable, idempotent.
4. One-time: create the family `Group`, add `PersonGroup` rows, set `ownerPersonId` on all 11 accounts (a `scripts/era/set-account-owners.ts` prompt or a small admin UI — 11 decisions, once).

*Exit check:* `SELECT COUNT(*) FROM Interaction WHERE type='financial'` returns 683, and Joseph/Qin/family splits all sum correctly.

**Phase 2 — Live sync** — `packages/sync/era/` per §4.1; backfill the missing ~4,600 transactions; schedule every 4h. *Exit: the graph matches Era's transaction count.*

**Phase 3 — Stream API** — keyset stream + aggregate endpoint per §6. *Exit: `curl /api/v1/interactions?type=financial&limit=100` walks the whole history by cursor.*

**Phase 4 — Assistant rewrite** — §7. *Exit: "what did we spend as a family last month" and "how much did Qin spend on groceries in July" both answer correctly.*

**Phase 5 — Reconciler** — refactor `match-places.ts` into the re-runnable reconciler per §5; wire the Timeline and Event ladders. *Exit: re-importing Timeline back-fills Places on old transactions with no manual work.*

Phases 1–2 are the ones that fix the reported problem. 3–5 are what make it good.

---

## 10. Open questions

1. **Is Qin's card on your Era connection, or hers?** Determines one `EraConnection` vs two. Check `accounts__list_financial_accounts` for a card that isn't yours — the `scope` field in the transaction payload may already answer it.
2. **Family group membership** — Joseph + Qin only, or the kids as Persons too? Kids as members costs nothing now and makes "what do the kids cost us" answerable later.
3. **Privacy inside the household.** The family Group makes joint aggregation trivial — and also makes Qin's individual spend visible to any agent with `interactions.read`. Worth deciding *now* whether `actorPersonId != joseph` needs a separate scope, before tokens get issued.
4. **Refunds and transfers in totals.** Transfers are already flagged and excluded. Refunds (`direction: "received"` against a purchase category) should probably *net against* the original spend rather than count as income — needs a linking rule, mirroring Era's `manage_transfer_links`.
5. **Multi-currency.** `currency` is now a column but all math assumes USD. Fine until it isn't; the column means the migration won't have to move twice.
6. **Write-back to Era.** Once Interactions carry Place/Event context, `transactions__update_transactions` can push those back as Era tags (`ERA_FINANCE_INTEGRATION.md` Phase 3). Nice-to-have, not on the critical path — and it requires `mcp:write`.

---

## Appendix — files touched

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | §2 additive fields + indexes |
| finance-interactions migration (now in the Postgres baseline) | **new** — production migration |
| `scripts/era/backfill-staged-to-interactions.ts` | **new** — 683-row promotion |
| `scripts/era/set-account-owners.ts` | **new** — one-time ownership mapping |
| `packages/sync/era/{client,sync-accounts,sync-transactions,reconcile-*}.ts` | **new** — live sync + reconciler |
| `scripts/era/match-places.ts` | refactor → `packages/sync/era/reconcile-place.ts` |
| `scripts/era/import-from-json.ts` | retire once live sync lands |
| `apps/persons/app/api/v1/interactions/route.ts` | keyset + filters + `include` |
| `apps/persons/app/api/v1/interactions/aggregate/route.ts` | **new** |
| `apps/persons/server/domain/interactions.ts` / `dto.ts` | finance fields, participant expansion |
| `apps/assistant/lib/finance.ts` | ~80% deletion; call the aggregate API |
| `apps/assistant/lib/tools.ts` | new finance/stream tools |
| `docs/ERA_FINANCE_INTEGRATION.md` | note that storage sections are superseded here |
