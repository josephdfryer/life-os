# Era Finance Integration

**Status:** Research / Pre-implementation — API shapes verified against live Era MCP  
**Last updated:** July 9, 2026  
**Author:** Claude (Cowork)  
**For:** Codex implementation agent

---

## Overview

Era (era.app) is an MCP-first personal finance platform — the closest thing to "Mint but agentic." Instead of a standalone finance app with a built-in AI, Era exposes your financial data through a standard MCP server called **Context**, which any MCP-compatible AI (Claude, ChatGPT, Cursor, etc.) can call. This is the right integration target for Life OS: it means financial data flows naturally into the same graph that already tracks people, places, events, and items.

**Why Era over Monarch:**  
Monarch is a traditional SaaS finance app — you log into it, use its dashboard, and its AI lives inside it. Era is the inverse: it gives your AI a permissioned, structured window into your financial life. Since Life OS is itself an AI-native system built on the graph + MCP pattern, Era is a philosophical fit. The integration described here would let Claude say "you've spent $340 at Trader Joe's this month" in the same conversation where it knows about your upcoming dinner party — because both facts live in the same graph.

---

## Era Context MCP Server Reference

**Server URL:** `https://context.era.app`  
**Explicit MCP path:** `https://context.era.app/mcp`  
**Transport:** Streamable HTTP  
**Authentication:** OAuth (default) or API key (developer tools)  
**Tool count:** 43 total; up to 41 visible to your assistant (plan/scope dependent)  
**Server card:** `https://era.app/.well-known/mcp/server-card.json`

### Complete Tool Inventory (as of May 6, 2026)

#### Knowledge and Memory (8 tools)
| Tool | R/W | Notes |
|------|-----|-------|
| `knowledge__get_financial_context_and_overview` | Read | Starting point — loads Era's summary of accounts, recent activity, goals |
| `knowledge__get_pending_questions` | Read | Questions Era wants the user to answer |
| `knowledge__recall_history` | Read | Retrieves previously remembered facts |
| `knowledge__remember` | Write | Stores an approved fact in Era memory |
| `knowledge__confirm_or_reject_inference` | Write | Approves or rejects an Era-inferred fact |
| `knowledge__defer_question` | Write | Snoozes a pending question |
| `knowledge__forget` | Write | **Destructive** — removes a remembered fact |
| `knowledge__show_question_ui` | Read | Renders a question form in Era UI |

#### Accounts (4 tools)
| Tool | R/W | Notes |
|------|-----|-------|
| `accounts__list_financial_accounts` | Read | Returns all connected accounts with type, institution, balance |
| `accounts__check_account_balance` | Read | Balance for a specific account |
| `accounts__set_account_visibility` | Write | Hide/show accounts from analysis |
| `accounts__manage_account_groups` | Read | **Organize plan required** |

#### Connections (2 tools)
| Tool | R/W | Notes |
|------|-----|-------|
| `connections__connect_bank_account` | Write | Opens Plaid/bank connection flow |
| `connections__disconnect_institution` | Write | **Destructive** — severs bank link |

#### Transactions and Automation (9 tools) — Core sync targets
| Tool | R/W | Notes |
|------|-----|-------|
| `transactions__list_transactions` | Read | Paginated transaction list with filters |
| `transactions__search_transactions` | Read | Full-text + filter search |
| `transactions__list_spending_categories` | Read | Era's category taxonomy |
| `transactions__list_recurring_charges` | Read | Detected subscriptions and recurring bills |
| `transactions__update_transactions` | Write | Patch category, tags, notes on transactions |
| `transactions__manage_automation_rules` | Write | CRUD on categorization/tagging rules |
| `transactions__manage_categories` | Write | Add/rename/delete categories |
| `transactions__manage_transaction_tags` | Write | Tag management |
| `transactions__manage_transfer_links` | Write | Link internal transfers to avoid double-counting |

#### Insights and Analysis (5 tools) — Computed, never stored
| Tool | R/W | Notes |
|------|-----|-------|
| `insights__analyze_spending` | Read | Breakdown by category, merchant, time |
| `insights__compare_spending_periods` | Read | Month-over-month or custom period deltas |
| `insights__get_cash_flow` | Read | Income vs. expenses, net flow |
| `insights__forecast_spending` | Read | Projected future spend based on history |
| `insights__get_daily_financial_summary` | Read | Daily digest for routines/scheduled tasks |

#### Billing (7 tools) — Not relevant to Life OS sync
`billing__get_current_plan`, `billing__list_plans`, `billing__preview_subscription_change`, `billing__confirm_subscription_change`, `billing__upgrade`, `billing__manage`, `billing__cancel_subscription`

#### Referrals (5 tools) — Not relevant to Life OS sync
`referral__get_referral_link`, `referral__get_referral_stats`, `referral__join_referral_program`, `referral__switch_referral_campaign`, `referral__get_dashboard_sso`

#### Help (1 tool)
`help__get_help`

---

## Life OS Schema Analysis

### What Already Exists

The schema is more finance-ready than it looks. Key facts:

**`Interaction` is the right home for a transaction.** It already has:
- `amount Float?` — the transaction dollar value
- `direction String?` — "paid" / "received" / "transfer"
- `billable Boolean` — expense reimbursement flag
- `timestamp DateTime` — transaction date
- `summary String?` — can hold merchant/description
- `notes String?` — memo or user annotation
- `personId String?` — links to the merchant as a Person node
- `placeId String?` — links to where the transaction occurred
- `eventId String?` — links to the occasion (dinner party, trip, etc.)
- `metadata String?` — JSON blob for era-specific fields that don't warrant first-class columns
- `itemInteractions ItemInteraction[]` — links to purchased physical Items

**The 5-primitive graph handles the conceptual mapping cleanly:**

| Financial Concept | Life OS Primitive | Example |
|-------------------|------------------|---------|
| Merchant / Payee | `Person` (company) | Trader Joe's, Delta Air Lines |
| Transaction location | `Place` | A specific store, airport, website |
| Occasion / purpose | `Event` | Birthday dinner, work trip, vacation |
| Purchased object | `Item` via `ItemInteraction` | MacBook, winter coat |
| Budget / financial goal | `Plan` | "Save $10k by Dec 2026" |
| Single transaction | `Interaction` | The $47 grocery run |

**`StagedInteraction` is already a review queue.** Every era transaction should land in `StagedInteraction` first (status: "pending"), be enriched, matched to a Person/Place/Event, then promoted to a canonical `Interaction`. This is exactly the Gmail sync pattern already implemented.

### What Is Missing

Four things need to be added to the schema:

**1. `EraConnection`** — Stores OAuth credentials and sync state per user. Models directly after `CalendarConnection` / `GmailConnection`.

**2. `EraTransactionLink`** — Maps an Era transaction ID to a Life OS `Interaction` ID (or `StagedInteraction` ID). The deduplication anchor. Without this, every sync run will create duplicate Interactions.

**3. `EraAccountLink`** — Tracks each connected financial account (checking, savings, credit card) so Life OS knows which account a transaction came from without storing balance as a derived fact.

**4. Optional: `category` field on `Interaction`** — Era has a rich category taxonomy (Groceries, Dining Out, Travel, etc.). This can be stored in `metadata` JSON now and promoted to a first-class column if queries against it become frequent. Start with `metadata`.

---

## Schema Additions (Prisma)

Add these to `packages/db/prisma/schema.prisma`. Follows the existing naming and field conventions exactly.

```prisma
// ─────────────────────────────────────────────
// INTEGRATIONS: Era Finance
// ─────────────────────────────────────────────

model EraConnection {
  id               String   @id @default(cuid())
  workspaceId      String   @default("default-workspace")
  workspace        Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  userId           String
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  status           String   @default("active")           // active | paused | error
  accountEmail     String?                               // Era account email
  accessToken      String?                               // OAuth access token (encrypted at rest)
  refreshToken     String?                               // OAuth refresh token (encrypted at rest)
  expiresAt        DateTime?                             // Token expiry
  scope            String?                               // Granted OAuth scopes
  lastSyncedAt     DateTime?
  lastError        String?
  syncCursor       String?                               // Pagination cursor for incremental sync
  transactionLinks EraTransactionLink[]
  accountLinks     EraAccountLink[]

  @@unique([workspaceId, userId])
  @@index([userId])
  @@index([workspaceId, status])
}

model EraAccountLink {
  id              String        @id @default(cuid())
  workspaceId     String        @default("default-workspace")
  workspace       Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  connectionId    String
  connection      EraConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  eraAccountId    String                               // Era's internal account ID
  institution     String?                              // "Chase", "Fidelity", etc.
  accountName     String?                              // "Checking ••4242"
  accountType     String?                              // checking | savings | credit | investment
  currency        String?       @default("USD")
  status          String        @default("active")     // active | hidden | disconnected
  lastSeenAt      DateTime?
  transactionLinks EraTransactionLink[]

  @@unique([workspaceId, eraAccountId])
  @@index([connectionId])
  @@index([workspaceId, status])
}

model EraTransactionLink {
  id               String         @id @default(cuid())
  workspaceId      String         @default("default-workspace")
  workspace        Workspace      @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  connectionId     String
  connection       EraConnection  @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  accountLinkId    String?
  accountLink      EraAccountLink? @relation(fields: [accountLinkId], references: [id], onDelete: SetNull)
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
  eraTransactionId String                              // Era's transaction ID (dedup key)
  interactionId    String?
  interaction      Interaction?   @relation(fields: [interactionId], references: [id], onDelete: SetNull)
  stagedItemId     String?
  stagedItem       StagedInteraction? @relation(fields: [stagedItemId], references: [id], onDelete: SetNull)
  status           String         @default("staged")   // staged | accepted | rejected | duplicate
  lastSeenAt       DateTime?

  @@unique([workspaceId, eraTransactionId])
  @@index([connectionId])
  @@index([interactionId])
  @@index([stagedItemId])
  @@index([workspaceId, status])
}
```

Also add back-relations to existing models:

```prisma
// In Workspace: add
eraConnections     EraConnection[]
eraTransactionLinks EraTransactionLink[]
eraAccountLinks    EraAccountLink[]

// In Interaction: add
eraLinks           EraTransactionLink[]

// In StagedInteraction: add
eraLinks           EraTransactionLink[]

// In User: add
eraConnections     EraConnection[]
```

---

## Transaction Data Mapping

### Era Transaction → Life OS StagedInteraction

When `transactions__list_transactions` or `transactions__search_transactions` returns a transaction, map it as follows before staging:

```typescript
// Era transaction shape (inferred from docs + typical Plaid/aggregator patterns)
interface EraTransaction {
  id: string                    // Era's stable transaction ID
  date: string                  // ISO date "2026-05-10"
  amount: number                // Positive = debit (money out), negative = credit (money in)
  description: string           // Raw bank description "WHOLEFDS #1234"
  merchantName: string?         // Cleaned "Whole Foods Market"
  category: string?             // "Groceries"
  subcategory: string?          // "Supermarkets"
  tags: string[]                // User-defined tags
  accountId: string             // Which account
  pending: boolean
  notes: string?                // User memo
  transferLinked: boolean       // Is this half of an internal transfer?
}

// → StagedInteraction
{
  source: "era",
  sourceId: eraTransaction.id,
  itemType: "interaction",
  status: "pending",
  type: "financial",
  timestamp: new Date(eraTransaction.date),
  // Merchant name for person matching
  contactName: eraTransaction.merchantName ?? eraTransaction.description,
  summary: eraTransaction.merchantName ?? eraTransaction.description,
  body: eraTransaction.description,   // raw description for audit
  direction: eraTransaction.amount > 0 ? "paid" : "received",
  metadata: JSON.stringify({
    eraTransactionId: eraTransaction.id,
    eraAccountId: eraTransaction.accountId,
    eraCategory: eraTransaction.category,
    eraSubcategory: eraTransaction.subcategory,
    eraTags: eraTransaction.tags,
    pending: eraTransaction.pending,
    transferLinked: eraTransaction.transferLinked,
    rawAmount: eraTransaction.amount,
    rawDescription: eraTransaction.description,
  })
}
```

### StagedInteraction → Canonical Interaction (on accept)

When a staged transaction is accepted (manually or via Rule), promote it:

```typescript
{
  workspaceId,
  type: "financial",
  timestamp: staged.timestamp,
  amount: Math.abs(parseFloat(meta.rawAmount)),  // always positive; direction field carries sign
  direction: staged.direction,                   // "paid" | "received" | "transfer"
  summary: staged.summary,                       // cleaned merchant name
  notes: staged.notes,                           // user-added memo
  personId: matchedMerchantPersonId ?? null,     // Person node for the merchant
  placeId: matchedPlaceId ?? null,               // Place if location is known
  eventId: matchedEventId ?? null,               // Event if user links it (trip, dinner, etc.)
  billable: false,                               // user can flip this
  metadata: JSON.stringify({
    eraCategory: meta.eraCategory,
    eraTags: meta.eraTags,
    eraAccountId: meta.eraAccountId,
    eraTransactionId: meta.eraTransactionId,
  })
}
```

### Merchant Person Matching

Every transaction has a merchant. The merchant should become a `Person` node (with `company` set) so the graph tracks your relationship with that business over time. This enables queries like "how much have I spent at Delta this year?" as a graph traversal.

Matching strategy (in order):
1. Exact match on `Person.company` (case-insensitive) within workspace
2. Fuzzy match on `Person.first` + `Person.last` if company is null
3. If no match found and merchant name is clean → create a new `Person` with `first: merchantName, company: merchantName, closeness: 5` (lowest closeness = weakest relationship)
4. Flag uncertain matches for user review via `StagedInteraction.confidence`

---

## Account Data Mapping

Financial accounts from `accounts__list_financial_accounts` should be stored in `EraAccountLink`. Balances are **never stored** — they're a derived/real-time value fetched from `accounts__check_account_balance` on demand. This respects the Life OS principle that computed values are never persisted.

```typescript
// Era account → EraAccountLink
{
  eraAccountId: account.id,
  institution: account.institutionName,   // "Chase"
  accountName: account.displayName,       // "Freedom Unlimited ••5678"
  accountType: account.type,              // "credit" | "checking" | "savings"
  currency: account.currency ?? "USD",
  status: account.hidden ? "hidden" : "active",
}
```

---

## What Can Be Derived (Never Stored)

The Life OS graph principles say derived values are computed, not stored. For finances, this means:

| Question | Derivation Method |
|----------|------------------|
| Current account balance | `accounts__check_account_balance` (live Era call) |
| Net worth | Sum balances across all `EraAccountLink` records (live call) |
| Monthly spend by category | `WHERE type="financial" AND direction="paid"` + group by `metadata.eraCategory` |
| Spend at a merchant | `WHERE personId = merchantId AND type="financial"` |
| Spend on a trip | `WHERE eventId = tripEventId AND type="financial"` |
| Total spent at a Place | `WHERE placeId = placeId AND type="financial"` |
| All financial interactions with a Person | `WHERE personId = personId AND type="financial"` |
| Cash flow for a month | Sum of all `amount` grouped by `direction` for the period |
| Recurring charges | `transactions__list_recurring_charges` (Era's detection is better than recomputing) |
| Spending forecast | `insights__forecast_spending` (live Era call — uses their model) |

The graph enables rich cross-domain queries that Era alone can't answer:
- "How much did I spend during my Seattle trip?" → `Event(name: "Seattle Trip") → Interaction[type=financial]`
- "What's my total spend with people from Acme Corp?" → `Person[company=Acme] → Interaction[type=financial]`
- "How much did I spend the week after each job interview?" → Calendar events → Interaction[type=financial, timestamp within window]

---

## Sync Architecture

### Connection Setup

```
User → stores an Era API key through Home Connections
     → EraConnection created (workspaceId, userId, encrypted key, scope)
     → unified Connection mirror created for Home health/status
     → Initial sync triggered
```

The current integration uses an encrypted Era API key rather than an OAuth
redirect. Home's Connections flow and the legacy CLI scripts retain
`EraConnection` for account/transaction-link foreign keys and transactionally
dual-write the unified `Connection` mirror. Key rotation, JSON import, and
watermark advancement therefore update the same health state shown in Home.

### Initial Sync

```
1. Call accounts__list_financial_accounts
   → Upsert EraAccountLink records

2. Call transactions__list_transactions (paginated, e.g., last 90 days)
   → For each transaction:
       a. Check EraTransactionLink.eraTransactionId (skip if exists)
       b. Create StagedInteraction (source: "era", sourceId: txn.id)
       c. Create EraTransactionLink (status: "staged")
       d. Run person-matching on merchantName
       e. Fire Rules engine (trigger: "staged_interaction.created")

3. Store final pagination cursor in EraConnection.syncCursor
```

### Incremental Sync (Ongoing)

```
Trigger: Scheduled (e.g., every 4 hours via Life OS Rules engine)
        OR on-demand (user asks "sync my transactions")

1. Call transactions__list_transactions with cursor from EraConnection.syncCursor
2. Process new transactions same as initial sync
3. Update EraConnection.lastSyncedAt + syncCursor
4. For pending transactions that cleared: update StagedInteraction.metadata.pending = false
```

### Transaction Accept Flow

```
User or Rule accepts a StagedInteraction:
1. Create canonical Interaction
2. Update EraTransactionLink: stagedItemId → interactionId, status: "accepted"
3. If merchant Person was created: mark as low-closeness company contact
4. If user adds eventId/placeId: write back tags to Era via transactions__update_transactions
   (keeps Era and Life OS in sync bidirectionally)
```

### Bidirectional Sync Consideration

Era is read-write. When a user enriches a transaction in Life OS (links it to an event, adds notes), we can optionally write tags back to Era using `transactions__update_transactions`. This keeps Era's categorization in sync and makes Era's own insights more useful. The implementation should:
1. Write Life OS event/place names as tags in Era ("Seattle Trip", "Birthday Dinner")
2. Write the Life OS Interaction ID as a tag for auditability ("life-os:clxxxxx")
3. Respect Era's write scope — only write if `mcp:write` scope is granted

---

## Rules Integration

Era has its own automation rules engine (`transactions__manage_automation_rules`). Life OS also has a Rules engine (`Rule` model). These are complementary:

| Rules Layer | Runs When | Does What |
|-------------|-----------|-----------|
| **Era rules** | Transaction arrives at Era (before Life OS sees it) | Categorize, tag, auto-link transfers |
| **Life OS rules** | `StagedInteraction.created` trigger | Auto-accept known merchants, create/link Person, assign to Event |

**Recommended division of responsibility:**
- Era handles raw data cleanliness: merchant normalization, category assignment, recurring detection, transfer linking
- Life OS handles relational enrichment: linking transactions to Events, Plans, Items; creating Person nodes for new merchants; routing to the right workspace

**Life OS Rule examples for finance:**

```json
// Auto-accept grocery transactions from known merchants
{
  "trigger": "staged_interaction.created",
  "conditions": [
    { "field": "source", "op": "eq", "value": "era" },
    { "field": "metadata.eraCategory", "op": "eq", "value": "Groceries" },
    { "field": "candidatePerson.company", "op": "in", "value": ["Trader Joe's", "Whole Foods Market"] }
  ],
  "actions": [
    { "type": "accept_staged", "linkPerson": true }
  ]
}

// Flag large transactions for review
{
  "trigger": "staged_interaction.created",
  "conditions": [
    { "field": "source", "op": "eq", "value": "era" },
    { "field": "metadata.rawAmount", "op": "gt", "value": 500 }
  ],
  "actions": [
    { "type": "add_tag", "value": "large-purchase" },
    { "type": "notify", "message": "Transaction over $500 needs review" }
  ]
}
```

---

## Era Memory → Life OS Plan

Era's `knowledge__remember` stores financial facts, goals, and preferences. These map naturally to Life OS `Plan` nodes:

| Era Memory | Life OS Plan |
|-----------|--------------|
| "Save $10k for emergency fund by December" | `Plan { text: "Save $10k emergency fund", timescale: "2026-12", successSignals: "EraAccountLink.savingsBalance >= 10000" }` |
| "Keep dining out under $400/month" | `Plan { text: "Dining budget ≤ $400/mo", timescale: "monthly" }` |
| "Pay off Chase card by March" | `Plan { text: "Pay off Chase Freedom ••5678", timescale: "2027-03" }` |

When Life OS syncs Era memory via `knowledge__recall_history`, goals with dollar amounts or timescales should be offered as Plan candidates.

---

## Primary Tools for Life OS Integration

These are the Era MCP tools Life OS will actually call — not the full 43:

### Must-Have (Core Sync)
1. `accounts__list_financial_accounts` — account discovery + EraAccountLink upsert
2. `transactions__list_transactions` — paginated sync
3. `transactions__search_transactions` — on-demand queries
4. `accounts__check_account_balance` — live balance lookups (never cached)
5. `knowledge__get_financial_context_and_overview` — initial context load

### Write Operations (Enrichment)
6. `transactions__update_transactions` — write Life OS tags/notes back to Era
7. `transactions__manage_automation_rules` — sync Era rules from Life OS rule definitions
8. `knowledge__remember` — persist financial goals as Era memory

### Analysis (On-Demand, Never Stored)
9. `insights__analyze_spending` — spending breakdown queries
10. `insights__compare_spending_periods` — month-over-month
11. `insights__get_cash_flow` — income vs. expense
12. `insights__forecast_spending` — forward projections
13. `transactions__list_recurring_charges` — subscription audit

---

## Implementation Phases

### Phase 1: Read-Only Sync (Foundation)

**Goal:** Transactions land in `StagedInteraction` without any data loss.

1. Add `EraConnection`, `EraAccountLink`, `EraTransactionLink` models to schema
2. Add Workspace back-relations
3. Run `prisma migrate dev`
4. Build `packages/sync/era/` module:
   - `connect.ts` — OAuth flow (follow CalendarConnection pattern)
   - `sync-accounts.ts` — upserts `EraAccountLink` records
   - `sync-transactions.ts` — pages through transactions, writes `StagedInteraction` + `EraTransactionLink`
   - `client.ts` — MCP client wrapper for `context.era.app`
5. Add API route: `POST /api/era/connect` and `POST /api/era/sync`
6. Add cron/scheduled task: incremental sync every 4 hours

**Deliverable:** Every Era transaction shows up in the review queue.

### Phase 2: Person Matching + Auto-Accept Rules

**Goal:** Known merchants are auto-linked; new merchants become Person nodes.

1. Build merchant matching logic (exact → fuzzy → create)
2. Add Life OS Rules for common categories (groceries, gas, utilities)
3. Add `candidatePersonId` + `confidence` population to Era staged items
4. UI: show era-staged transactions in the review queue with suggested Person links

**Deliverable:** ~60-70% of transactions auto-accepted; remainder in queue with good suggestions.

### Phase 3: Bidirectional Enrichment

**Goal:** Life OS graph context (events, places) flows back into Era.

1. On Interaction accept: write Life OS tags back to Era via `transactions__update_transactions`
2. Trip/event detection: when user has an Event, offer to link nearby transactions by date/place
3. Item linking: when a transaction looks like a purchase, offer to create/link an `Item`
4. Plan syncing: pull Era memory goals → offer as Life OS Plan candidates

**Deliverable:** Era reflects Life OS enrichment; spending-by-trip/event queries work.

### Phase 4: Insights + Scheduled Summaries

**Goal:** Financial intelligence in the Life OS agent experience.

1. Add `insights__get_daily_financial_summary` to morning briefing routine
2. Add spending queries to the Life OS agent tool set
3. Recurring charge audit workflow (monthly)
4. Net worth tracking (computed from live `accounts__check_account_balance` calls, never stored)

**Deliverable:** Full financial intelligence in Life OS with zero duplication of derived values.

---

## Security and Credential Handling

- OAuth tokens in `EraConnection` must be **encrypted at rest** (not plaintext in SQLite). Use the same encryption approach as any existing token storage in the codebase.
- The Era MCP server URL (`context.era.app`) requires the `Authorization: Bearer <token>` header on every call.
- **No bank credentials ever touch Life OS.** All bank auth goes through Era's own Plaid/institution connections. Life OS only ever holds an Era OAuth token.
- Scope the OAuth request to: `mcp:read` (minimum), `mcp:write` (for tag writeback), NOT `mcp:billing-write` (not needed).
- Token refresh: follow the same refresh-on-expiry pattern as `CalendarConnection`.

---

## Verified Shapes (July 9, 2026 — live MCP inspection)

Inspected via the live Era Context MCP connection. These supersede the inferred
shapes above where they differ.

**Transaction (actual):**

```json
{
  "transaction_id": "utgr_GlzxYv1Dkmh",          // stable — dedup key
  "account_group_key": "uagr_9pBYqjyRTzX",       // FK to account
  "account_name": "Platinum Card®",
  "amount": -20.00,                               // NEGATIVE = money out (opposite of inferred!)
  "is_cash_outflow": true,                        // explicit direction flag — use this
  "currency": "USD",
  "description": "Summerlin Tennis Clulas",       // cleaned merchant — primary matching signal
  "merchant_name": "Google Pay",                  // UNRELIABLE: often absent, or the payment rail
  "original_description": "SUMMERLIN TENNIS CLULAS VEGAS NV",  // raw — trailing "CITY ST"
  "transaction_date": "2026-07-08",               // DATE ONLY, no time component
  "posted_date": "2026-07-08",
  "is_pending": false,
  "category": "Dining out",
  "category_key": "fcat_42pmXjDBL44",
  "applied_rules": [], "applied_tags": [],
  "scope": "Owner"
}
```

Key corrections to the plan:

- **Sign convention:** negative amount = outflow. Map `direction` from `is_cash_outflow`, not the sign guess above.
- **Merchant matching:** use `description` (cleaned), not `merchant_name` (frequently the payment processor — "Google Pay", "Chase" — or missing). Keep `original_description` for audit and location parsing.
- **No structured location** — no lat/lng, no address. But `original_description` usually ends with `CITY ST` (card-processor format). See "Places Interface" below.
- **Pagination is page-based** (`page`/`page_size`, max 100; ~5,300 transactions ≈ 53 pages). No cursor. Incremental sync should use a **date watermark** (`from_date = lastSyncedAt − 5 days` to catch late postings) with `EraTransactionLink` dedup, not page state. `syncCursor` stores the watermark date.
- **Pending transactions are already excluded** by `list_transactions` (posted/settled only) — the pending-volatility concern below is moot.
- **Backfill volume:** ~5,300 transactions. The initial sync needs the same time-budgeted, resumable pattern as the Gmail sync (`server/domain/gmail.ts`), and auto-accept rules matter from day one — most grocery/gas/subscription rows should never hit the review inbox.

**Account (actual):** `account_group_key` (stable, `uagr_*`), `name`, `institution`
("Chase Bank", "American Express"), `provider_id` ("mx" — MX is the aggregator),
`type` (`Checking | Savings | CreditCard | LineOfCredit`), `balance.current` /
`balance.available`, `last_synced`. Maps cleanly onto `EraAccountLink`
(`eraAccountId` ← `account_group_key`). 11 accounts connected as of inspection.

---

## Places Interface

Places is already finance-ready on the read side: `PlaceProfile.stats.totalSpend`
is derived from `Interaction.amount` on Events at each Place, and the map has a
**finance layer stubbed** waiting for transactions to carry `placeId`
(see `docs/PLACES_ARCHITECTURE.md`). The entire Places integration reduces to one
problem: **resolving a transaction to a `placeId`**. Resolution ladder, strongest
signal first:

1. **Google Timeline join (highest confidence).** Places already imports Timeline
   visits as Events at Places with time windows. A transaction's
   `transaction_date` × fuzzy match of `description` against that day's visited
   place names → `placeId`. Date-only granularity is fine: few named commercial
   places are visited per day. This is the signature move — no finance app can
   do it because none of them have the location graph.
2. **Learned merchant→Place map.** Once a description→place link is confirmed
   (via timeline join or manual review), remember it (Rules engine or a mapping
   table) so every future "SPROUTS MARKELAS VEGAS NV" auto-links.
3. **City/state parse.** Extract trailing `CITY ST` from `original_description`.
   If exactly one existing Place matches name + city, link it; otherwise keep
   city/state in metadata for map region rollups.
4. **Stage for review.** Everything ambiguous lands in the (now fast) inbox with
   suggested candidates, same as Gmail and Timeline imports.

What lights up in Places once `placeId` is set — with **zero additional Places
work**: place-profile `totalSpend` becomes real, the map finance layer can render
spend-weighted pins/heat, and the cross-domain queries from
`FINANCE_FRAMEWORK.md` ("what did this trip cost", "spend at places with
person X") become graph traversals.

---

## Open Questions for Implementation

1. ~~**Era's exact transaction response shape**~~ — **Resolved.** See "Verified Shapes" above.

2. ~~**Pagination API**~~ — **Resolved.** Page-based; use date-watermark incremental sync.

3. ~~**Pending transaction handling**~~ — **Resolved.** `list_transactions` returns only posted/settled transactions; pending rows never reach Life OS.

4. **Transfer linking** — Era's `transactions__manage_transfer_links` handles internal transfers (e.g., savings → checking). These should map to `direction: "transfer"` in Life OS and get a special treatment in cash flow calculations to avoid double-counting.

5. **Multi-currency** — Era likely stores amounts in account-native currency. The `EraAccountLink.currency` field captures this, but Life OS currently has no currency field on `Interaction`. For Phase 1, assume USD and store raw currency in metadata. Promote to first-class in a later migration if needed.

6. **Investment accounts** — Era may expose investment/brokerage accounts. These are different from spending transactions (buy/sell orders, dividends). Treat these as a separate `type: "investment"` interaction subtype and skip auto-accept rules.

---

## References

- [Era Context MCP Documentation](https://era.app/help/mcp-server-era-context/)
- [Era vs Monarch Comparison](https://era.app/articles/era-vs-monarch-vs-copilot-vs-ynab/)
- [Connecting Claude to Era](https://era.app/articles/how-to-connect-claude-to-your-bank-account/)
- [Era Agent-Native Finance Vision](https://era.app/en-GB/articles/what-is-agent-native-finance/)
- [Era in Anthropic Claude Directory (May 6, 2026)](https://www.businesswire.com/news/home/20260506802708/en/Era-Becomes-the-First-Personal-Finance-Connector-in-Anthropics-Claude-Directory-and-Every-Other-MCP-Compatible-Agent)
- Life OS schema: `packages/db/prisma/schema.prisma`
- Existing integration pattern: `CalendarConnection` / `GmailConnection` models
