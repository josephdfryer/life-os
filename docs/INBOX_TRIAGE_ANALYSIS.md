# Inbox Triage: Analysis and Redesign

**Status:** Analysis · August 15, 2026

## Diagnosis

The inbox is not badly designed. It is solving the wrong problem.

| Measure | Value |
| --- | --- |
| Pending review items | **59** |
| …from `calendar_reconciliation` | **59 — all of them** |
| Distinct command shapes among them | **1** |
| `riskTier` / `priority` spread | none — all `review`, all `2` |
| `confidence` | **NULL on all 59** |
| Review items ever accepted | **3** |
| Inflow | ~6–21/day, every day |
| Pending `ImportStagedVisit` — not in this inbox | **166** |
| `StagedInteraction`, historic | 964 accepted, **1,780 dismissed (65%)** |

Read together: **the inbox asks you the same question 59 times, one at a time, with nothing
indicating which to answer first, and no way to answer them together.** Inflow is roughly ten a
day and outflow is approximately zero. It is not a queue you are behind on; it is a queue that
cannot be cleared by hand at the rate it fills.

The question being asked is `calendar_reconciliation.reconcile` with `{ action: "happened" }` —
*"did this scheduled thing actually occur?"* Asked once, that is reasonable. Asked 59 times about
events up to five days old, it is unanswerable from memory and worth almost nothing.

### What the UI does

`FederatedInbox.tsx` offers four filters — source, age, confidence, primitive — over a flat list,
resolving one item per request with `pendingId` blocking the next action until the round-trip
returns.

Every one of those filters is currently a no-op: one source, one primitive, one tier, and
confidence is null everywhere. **Filters help you find things. They do not help you decide.** With
59 identical items, there is nothing to find — only decisions to make, and the interface makes
each one cost a full round-trip.

`POST /v1/review-items/bulk-dismiss` already exists. The UI does not call it.

## The principle

Across every system that does this well — transaction categorisation in Monarch and Copilot,
Linear's triage mode, Gmail's bundling, Superhuman, spaced repetition — the same ordering holds:

> **The best inbox is the one you never have to open.** Effort should go into not generating the
> item, then into deciding many at once, then into learning from the decision — and only last into
> making an individual decision prettier.

Ranked by leverage:

| | Lever | Effect on 59 items |
| --- | --- | --- |
| 1 | **Don't create the item** — infer it, or let it expire | 59 → ~5 |
| 2 | **Batch identical decisions** | 5 decisions → 1 |
| 3 | **Learn a rule from the decision** | next month → 0 |
| 4 | **Make one decision fast** — keyboard, optimistic, no blocking | 2s → 0.2s |
| 5 | **Filter and sort** | no change to the work |

The current implementation does only #5, which is the only one that does not reduce the work.

## You already built #1 — for a different queue

`packages/intelligence/src/adaptive-day-outcomes.ts` implements exactly the pattern this needs:

- `matchPassiveOutcomes` looks for **positive evidence that something happened** and resolves it
  without asking.
- `OUTCOME_WINDOW_DAYS` — do not even consider it until the day has passed.
- `UNKNOWN_FALLBACK_DAYS = 7` — if nothing has resolved it by then, record `unknown` **so it stops
  being offered forever**.
- An explicit rule in the comments: *"lack of evidence becomes unknown, never failed."*

Calendar reconciliation asks the same shape of question — *did this happen?* — with no evidence
check, no expiry, and no auto-resolution. The technique is already written, tested, and running.
It is applied to one queue and not the other.

**This is the single highest-value change**, and it is mostly porting existing code.

The evidence is available. An event "happened" if, in its window, there is a financial
interaction, another interaction, a calendar acceptance, or a photo with a timestamp inside it.
Where none of that exists, the honest answer after a week is `unknown`, not a question that sits
there forever.

## The redesign

### 1. Passive resolution and expiry (kills most of the queue)

Port `matchPassiveOutcomes` to calendar reconciliation. Do not create a review item at sync time
at all — create it only if the day has passed *and* no corroborating evidence exists. Expire
unresolved items to `unknown` after a week.

An item older than about ten days is not a decision, it is a guess. Expiring it is more honest
than keeping it.

### 2. Confidence is mandatory at the generator

All 59 items have `confidence: NULL`, which is why nothing can be ranked, batched by certainty, or
auto-accepted. A generator that cannot say how sure it is has not finished thinking. Make
`confidence` required on the create path — a proposal without one is a bug, not a default.

This also unlocks the existing rule *"Auto-approve high-confidence matches"*, which currently has
nothing to act on.

### 3. Group by decision, not by source

59 items, one command shape. Present them as **one group with a count**:

> **59 calendar events — did these happen?**
> Accept all · Review individually · Not now

This is Gmail bundling, and it is the correct primitive here because the underlying decisions are
genuinely identical. Source filters are the wrong axis; group by *the question being asked*.

### 4. Triage mode, not a filtered list

For items that genuinely need individual judgement: one card at a time, keyboard-driven
(`a` accept, `x` dismiss, `s` snooze, `u` undo), **optimistic advance** — move to the next card
immediately and reconcile the request in the background. The current `pendingId` block makes 59
decisions take 59 sequential round-trips.

Add **snooze**. The missing third option is why items rot: today the only choices are decide now
or leave it pending forever.

### 5. Learn from the decision

Already agreed for merchants. Same shape here: accepting a class of proposal should be able to
write a rule so it is not asked again. The infrastructure exists — `Rule`, `RuleRun`, and the
`suggest`→`auto` graduation.

### 6. Treat dismissal rate as a generator defect

`StagedInteraction` was dismissed **65% of the time** — 1,780 of 2,744. That is not a triage
statistic, it is a precision measurement, and nothing consumes it. Any source dismissed more than
~30% of the time should be tuned or suppressed rather than reviewed harder. Surface per-source
accept/dismiss ratios so a noisy generator is visible as a defect.

### 7. Actually federate

166 pending `ImportStagedVisit` records sit outside the inbox even though `import_staged_visit` is
a declared `sourceKey`. Either adapt them in or drop the claim — a "federated" inbox that omits
the largest pending queue trains you not to trust it.

## Order of work

1. **Passive resolution + expiry for calendar reconciliation.** Biggest reduction, mostly a port.
2. **Require `confidence` at creation.** Everything downstream needs it.
3. **Group-by-decision with bulk accept**, using the `bulk-dismiss` endpoint that already exists.
4. **Triage mode** — keyboard, optimistic advance, snooze.
5. **Per-source accept/dismiss ratios**, so noise is visible.
6. **Adapt `ImportStagedVisit`** in, or stop calling the inbox federated.

Steps 1–3 should take the queue from 59 to roughly zero and keep it there. Steps 4–6 are what stop
it coming back.

## The thing to resist

The tempting fix is a better list — nicer rows, more filters, sorting, a dashboard. That is
step 5, the only lever that does not reduce the number of decisions. **If the queue is full
because the system asks too many questions, no interface makes it pleasant to answer them.**
