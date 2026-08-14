# Assistant Write Capabilities Plan

**Status:** Scoped, not started · August 14, 2026

## Bottom line

The API is not the blocker. **39 v1 routes already accept writes** and every primitive has a
domain module behind it. The assistant exposes **26 tools, of which only 2 write** — so the gap
is the tool surface, not the backend.

But do not start by adding tools. Three things are wrong today that are invisible at two write
tools and become serious at twenty. Fix them first; the tool surface is then mostly mechanical.

The receipt case is the perfect illustration: the assistant read a PDF, extracted every field
correctly, identified that the invoice names Qin rather than Joseph, and then could do nothing
with it because there is no `create_item`. It even proposed the right fallback on its own.

## Current state

| | |
| --- | --- |
| Assistant tools | 26 |
| …that write | **2** — `capture_note`, `log_interaction` |
| v1 API routes accepting POST/PATCH/DELETE | **39** |
| Domain modules with write functions | persons, items, plans, groups, events, states, interactions, place-notes, review |

Everything needed to write safely already exists — `publishGraphEvent` with idempotency keys,
provenance and actor; `createReviewItem` for the human-in-the-loop path; and
`promoteSafeFileClaim` / `undoSafeFileClaimPromotion` as a working reference implementation of
a guarded write with Undo.

## Fix these three first

### 1. The safety guard fails open — this is the important one

```ts
const CONSEQUENTIAL_ASSISTANT_TOOLS = new Set(["capture_note", "log_interaction"])
export function fileEvidenceAllowsAssistantTool(toolName: string, hasReturnedFileEvidence: boolean) {
  return !hasReturnedFileEvidence || !CONSEQUENTIAL_ASSISTANT_TOOLS.has(toolName)
}
```

This blocks writes once untrusted file content is in context — the defence against a document
talking the assistant into changing the graph. It works by **naming the two tools that exist**.
Any tool added later is permitted by default.

Today the assistant is safe largely because it can barely write. Add fifteen write tools against
this guard and a malicious or manipulated file could induce writes across the whole graph, which
is precisely the threat the file-intelligence design calls out.

**Invert it.** Capability belongs on the tool definition, not in a list that must be remembered:

```ts
export type AssistantToolDefinition = {
  name: string
  description: string
  input_schema: Record<string, unknown>
  capability: "read" | "write" | "destructive"   // required — no default
}
```

The guard then blocks anything that is not `read`, and a new tool is safe unless someone
deliberately marks it otherwise. Make `capability` non-optional so the type checker catches an
omission instead of failing open at runtime. Worth a test asserting every `write`/`destructive`
tool is refused when file evidence is present.

### 2. The one real write tool is unaudited

`log_interaction` calls `db.interaction.create()` directly, while
`packages/domain/interactions.ts` already exports `createInteraction(..., actor)` which publishes
a `GraphEvent`. So the assistant's only substantive write produces no audit trail, no actor
attribution, and nothing to undo — and it does so by bypassing a function that would have given
all three.

Route it through the domain function before adding anything alongside it, or the new tools will
copy the wrong pattern.

### 3. `GraphEventActor` has no assistant

```ts
type GraphEventActor = { type: "user" | "api_key" | "system" | "rule"; ... }
```

Assistant writes are currently indistinguishable from ones Joseph made by hand. Add
`"assistant"` and carry conversation provenance (message id, and the file ids in scope when the
turn was file-scoped). Without this you cannot answer "what did the assistant change last
Tuesday, and on what basis" — which is the question you will want the first time it gets
something wrong.

## Write architecture

One rule: **every assistant write goes through a registered domain command that publishes a
GraphEvent.** No raw `db.*` calls in `tools.ts`. That buys audit, idempotency, provenance and
Undo uniformly rather than per tool.

Three tiers, by blast radius:

| Tier | Examples | Behaviour |
| --- | --- | --- |
| **Safe** | `capture_note`, `log_interaction`, `create_item`, `create_place`, `add_place_note` | Execute directly. Additive, scoped to one new row, trivially reversible. |
| **Confirm** | `update_person`, `update_item`, `complete_plan`, `link_item_to_place` | Execute only after explicit user confirmation in the conversation. Mutating existing records. |
| **Review** | `delete_*`, `merge_persons`, anything sensitive | Never execute. Write a `ReviewItem` carrying the proposed command and evidence; Joseph approves in Home's inbox. |

The Review tier is free — `createReviewItem` already takes `{ command, commandInput, evidence }`
and the inbox already renders and executes them. Destructive intent becomes a proposal rather
than a special case.

**Confirmation must be enforced, not prompted.** Today the system prompt says to confirm before
`log_interaction`; that is a request, not a control. Make the tool itself two-phase: the first
call returns a preview of what would change and a token, and only a second call carrying that
token executes. The model cannot skip a step the harness owns.

## Tool surface to add

Mapped to what already exists — mostly wiring, not new backend:

| Tool | Tier | Backed by |
| --- | --- | --- |
| `create_item` | Safe | `packages/domain/items.ts` — **the receipt gap** |
| `create_place` / `add_place_note` | Safe | `place-notes.ts`, places domain |
| `create_event` | Safe | `events.ts`, `POST /v1/events` |
| `create_plan` / `complete_plan` | Safe / Confirm | `plans.ts`, `POST /v1/plans` |
| `create_person` | Confirm | `persons.ts`, `POST /v1/people` — dedupe risk |
| `update_person` / `update_item` | Confirm | existing PATCH routes |
| `record_state` | Safe | `states.ts` |
| `add_to_group` | Safe | `groups.ts` |
| `dismiss_review_item` | Confirm | `review.ts`, `POST /v1/review-items/[id]` |
| `merge_persons`, `delete_*` | Review | propose only |

## Undo

`undoSafeFileClaimPromotion` is the pattern: delete the created row and publish a compensating
`GraphEvent` correlated to the original. Generalize it to any assistant-authored write keyed by
GraphEvent id, then expose "undo that" as a tool. Since every write already carries an actor and
correlation id, this is a query plus the existing compensation shape.

## Phasing

1. **Guard inversion + `capability` field + test.** Nothing else lands first.
2. **Route `log_interaction` through the domain layer**; add `"assistant"` to `GraphEventActor`.
3. **Safe tier**, starting with `create_item` — it unblocks the receipt case immediately.
4. **Two-phase confirmation harness**, then the Confirm tier.
5. **Review tier** — proposals into the existing inbox.
6. **Undo**, generalized from the file-claim implementation.

Steps 1–3 are small and deliver most of the day-to-day value. Steps 4–6 are what make it safe to
leave running unattended.

## Open questions

1. **Should assistant writes be workspace-wide or scoped?** Everything is one workspace today, so
   this is theoretical now and load-bearing if Persons is ever sold.
2. **Does the two-phase confirmation survive WhatsApp?** The token round-trip is natural in web
   chat; over SMS it may need to degrade to a reply-to-confirm convention.
3. **Rate limiting.** A confused loop that creates 200 Items is currently only bounded by
   `MAX_TOOL_ROUNDS`. Worth a per-turn write cap.
