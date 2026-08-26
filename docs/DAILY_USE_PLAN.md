# LifeOS Daily Use Plan

**Status:** Engineering pass complete through Phase 6 — deployment and real-use gates pending  
**Owner:** Joseph  
**Purpose:** Make LifeOS useful enough to open every morning, capture into throughout the day, and close out each evening.

## Execution record

### Phase 0 audit — 2026-07-26

- **Calendar:** Both active Google Calendar paths currently upsert occurrences directly into `Event` and create attendee `Interaction` rows. This predates the locked Plan/Event distinction. Phase 1 therefore labels provider-backed future records as **Scheduled** context without claiming the occurrence is confirmed. Migrating sync requires a separate idempotent compatibility design; historical production records will not be rewritten automatically.
- **Capture:** The Assistant already writes immutable `Note` records through `capture_note`, while Theory exposes another Note API. Phase 2 should extract one shared capture command before adding another entry point.
- **Action items:** `Interaction.actionItems` contains legacy string arrays and newer `{ description, completed }` objects. Phase 1 uses a tolerant parser and hides completed objects. Durable per-item mutation remains deferred until identity and audit semantics are designed.
- **Owner State:** Health sync requires an explicit self Person and refuses to guess. Evening State capture must reuse that explicit ownership rule.
- **Baseline:** Product telemetry is intentionally not added. Joseph's first week of real Home use is the baseline.

### Phase 1 implementation — 2026-07-26

- Home now uses a time-aware greeting and remains the cross-app daily doorway.
- Today distinguishes provider-backed calendar records with a **Scheduled** label and includes known Place context.
- Prepare shows the next people-centric occurrences plus each Person's latest meaningful context and first open action item.
- Commitments combines active/blocked unscheduled Plans with incomplete Interaction action items.
- Relationship guidance is intentionally limited to one primary nudge.
- Home's local-review bypass now works at both middleware and page level and remains double-gated off in production.
- Home queries use explicit field selections so pending additive provenance migrations do not break the daily read surface.
- The real-use acceptance gate remains open: Joseph should use Home on five of seven days before Phase 2 begins.

### Phase 2 Note-first implementation — 2026-07-26

- Added `@life-os/domain` as the canonical shared-command package and moved Assistant, Theory, and Home capture through one `captureNote` command.
- The command trims and validates content, normalizes Note types, records source metadata, and uses caller-provided idempotency keys so a lost response or retry cannot duplicate a Note.
- Home now has a fast typed capture surface for thoughts, observations, and declarations. `Command/Ctrl + Enter` saves; a failed request leaves the text in place.
- The shared LifeOS bar links directly to Home's capture surface from every app.
- Capture remains Note-first and does not call AI. Successful storage is therefore independent of model availability, credentials, pricing, or resolver quality.
- A full disposable-database integration test proves that one request plus one retry produces exactly one provenance-bearing Note.
- Production capture rejects unauthenticated requests; local review remains double-gated to non-production.
- A separate, explicit **Find structure** action can use the workspace's encrypted Vercel AI Gateway credential to suggest only Plans and Events. It is never part of the base Note write, so provider failure cannot lose a capture.
- Model calls are recorded in `NoteAnalysisRun`, including model, tokens, returned cost when available, prompt version, output, and failure state. `NoteSuggestion` stores the review workflow; neither is a ninth LifeOS primitive.
- Each suggestion is previewed with editable title and time, matched Person controls, confidence, and rationale. Accept creates a provenance-linked Plan or Event; dismiss creates nothing. Event acceptance also creates the approved Person Interactions.
- Analysis and acceptance are idempotent. A completed prompt version is reused, and accepting the same suggestion twice returns the first derived entity.
- Disposable-database integration coverage proves Event/Interaction and Plan creation, Note provenance, Person participation, dismissal, and acceptance retry behavior.
- Voice capture remains deliberately open. Browser speech APIs may send audio to a browser vendor, so LifeOS will not silently introduce them; the implementation should expose that tradeoff or use a selected local transcription path.

### Phase 3 calendar confirmation implementation — 2026-07-27

- Known attendees are stored as `PlanExpectedPerson` references, excluding people who declined the invitation; sync no longer creates participant `Interaction` records.
- `CalendarEventLink.planId` preserves provider identity across incremental sync, reschedules, recurring instances, reconnects, and cancellations. Provider cancellations abandon the Plan without creating an Event.
- Legacy provider Events are preserved. When sync encounters an older `CalendarEventLink.eventId`, it creates the corresponding Plan, marks it already fulfilled, and links the existing Event instead of duplicating history.
- Home surfaces at most three recently ended pending Plans. **Happened** is the one-tap path; **Changed** allows actual title, bounds, attendees, Place, outcome, emotional weight, follow-ups, and an optional Note; **Cancelled** and **Skip** create no Event.
- Confirmation creates exactly one `Event.sourcePlanId`. Only actual approved attendees receive Interactions, and each Interaction also receives typed Person, Event, and Plan participant links.
- Reconciliation is idempotent. The database uniquely constrains `Event.sourcePlanId`, and a repeated confirmation returns the already-created Event.
- The migration and confirmation flow pass against a disposable database containing all 38 migrations. Production data was not migrated or rewritten during implementation.

This plan turns LifeOS from a collection of capable lenses into one dependable daily loop:

> **Orient → remember → act → capture → reconcile → reflect**

The goal is not more dashboard content. The goal is to reduce what Joseph has to remember, reconstruct, and manually organize while producing trustworthy behavioral history for later insight.

## Product outcome

LifeOS should earn three recurring visits:

1. **Morning:** “What matters today, and what context should I remember?”
2. **During the day:** “Remember this for me.”
3. **Evening:** “What actually happened, and what remains open?”

After enough daily evidence accumulates, a weekly review should answer:

- Where did time and attention actually go?
- Which declared priorities received or missed attention?
- Which commitments remain open?
- Which people, work, places, or routines repeatedly affected energy and stress?
- What would likely have been missed without LifeOS?

## Product principles

1. **Home is the daily doorway.** Individual apps remain lenses; Home owns the cross-primitive daily experience.
2. **Capture first, structure second.** Raw input becomes an immutable `Note`. Suggested structure can be confirmed immediately or reviewed later.
3. **Plans are predictions; Events are records.** A future calendar entry is a `Plan`. Confirmation creates or links the `Event` that actually occurred.
4. **Most actions take one tap.** Rich detail is optional and reserved for meaningful moments.
5. **Inference reduces work but never invents truth.** High-confidence matches can be proposed; ambiguous matches enter review.
6. **Insight is derived and auditable.** Briefings, nudges, tension signals, and weekly summaries point back to the facts supporting them.
7. **Quiet by default.** LifeOS prioritizes a handful of useful prompts instead of displaying every available signal.
8. **No ninth primitive.** The daily loop uses the existing eight primitives and `Interaction`.

## Canonical daily experience

### Morning orientation

Home opens in a compact, prioritized order:

1. **Today:** chronological schedule, including calendar-backed Plans and confirmed Events.
2. **Prepare:** context for the next few meaningful appointments.
3. **Commitments:** due, overdue, or blocked Plans and unresolved action items.
4. **One worthwhile nudge:** the highest-value relationship, administrative, or alignment signal.
5. **Inbox health:** a small count and an invitation to process a bounded batch.

Meeting preparation should show only context that changes how Joseph enters the event:

- people and groups involved;
- last meaningful Interaction;
- unresolved action items or commitments;
- relevant recent Notes;
- known Place context;
- one concise relationship or work-context signal.

It should not become an exhaustive person dossier.

### Universal capture

A persistent capture control appears on Home and in the shared app shell. It accepts:

- typed natural language;
- pasted text;
- voice input when local transcription is available;
- optional file or photo attachment later.

Capture always succeeds quickly. The base write is:

```text
Note
  type: thought | observation | declaration | voice_transcript
  content: original input
  timestamp: when the described thing occurred, if known
  sourceFileId: raw audio/photo/file when applicable
```

The resolver may then suggest:

- `Plan` for a commitment or future intention;
- `Event` for something that happened;
- `Interaction` for the connection among participants;
- `State` for a timestamped condition;
- links to existing Person, Place, Item, Group, or Note records.

Derived records carry `sourceNoteId`. The original Note is never silently replaced by the structured interpretation.

The first release should support three outcomes:

- **Saved:** Note captured; no further action required.
- **Saved and structured:** high-confidence, low-risk suggestions accepted by the user.
- **Needs review:** Note saved and an ambiguity queued without blocking capture.

### Calendar reconciliation

Calendar ingestion and event history must preserve semantic honesty:

```text
External future calendar occurrence
  → calendar-backed Plan
  → expected people and place references
  → confirmation after scheduled end
  → Event linked through Event.sourcePlanId
  → one Interaction per personally meaningful participant/context
```

Past calendar entries must not automatically assert that an Event occurred merely because time passed.

The confirmation card offers:

- **Happened** — create/link the Event using the scheduled bounds as defaults.
- **Changed** — happened with corrected time, people, place, or title.
- **Cancelled** — mark the Plan abandoned; do not create an Event.
- **Skip** — dismiss this reconciliation request without fabricating history.
- **Add note** — capture outcome, emotional weight, action items, or anything worth remembering.

Defaults should make ordinary confirmations one tap. Reconciliation must be idempotent: confirming twice cannot create duplicate Events or Interactions.

### Evening closeout

Home shifts emphasis later in the day without becoming a separate application:

1. Reconcile a maximum of three recently ended Plans.
2. Surface detected or recorded commitments requiring a decision.
3. Offer an optional quick personal check-in: energy, mood, and stress.
4. Ask one open capture prompt: “Anything worth remembering?”

Personal check-ins become `State` facts against the workspace owner Person. They are not mutable profile fields. If a free-text explanation is added, it is stored as a Note and linked as provenance.

The closeout is complete when there are no urgent reconciliations—not when the entire inbox is empty.

### Weekly review

The weekly review is generated from canonical facts, not stored rollups. It contains:

- planned versus confirmed time;
- meaningful Interactions by Person and Group;
- open and completed commitments;
- relationship gaps grounded in declared closeness and actual contact;
- personal State patterns such as energy or stress;
- notable Places, spending, health, and Stuff activity when evidence exists;
- unresolved ambiguity and missing-data caveats;
- a short “what deserves attention next week” section.

Every claim must link to its supporting Plans, Events, Interactions, States, or Notes. Generated narrative may be persisted as an auditable report artifact, but its metrics are recomputed from the graph.

## Data model decisions

### Reuse without schema changes

The current model already supports most of the loop:

| Need | Existing model |
|---|---|
| Raw capture | `Note` |
| Raw audio/photo/file | `ImportedFile` linked from `Note` |
| Future calendar prediction | `Plan.scheduledStart`, `scheduledEnd`, `externalSource`, `externalInstanceId` |
| Expected attendees | `PlanExpectedPerson` |
| What occurred | `Event` |
| Plan fulfillment | `Event.sourcePlanId` |
| Personal meaning and outcomes | `Interaction` |
| Energy, mood, stress | `StateDefinition` + `State` |
| Imported ambiguity | `StagedInteraction` where it accurately represents an interaction candidate |
| Derived tension | `@life-os/alignment` queries |

### Required modeling audit before implementation

Calendar sync currently needs an explicit audit. If any provider-backed future entries are being written directly as `Event`, migrate the write path toward calendar-backed `Plan` without destructively rewriting historical data.

Do not force every kind of capture ambiguity into `StagedInteraction`; that table semantically represents a candidate Interaction. During Phase 2, decide whether unresolved Note-derived suggestions can be represented as Note metadata plus queryable processing status, or whether a small app-layer review record is justified. Such a record would be workflow state, not a ninth life primitive.

### Likely small schema additions

Add fields only after the implementation audit proves they are needed:

- an explicit reconciliation/dismissal timestamp or status for calendar-backed Plans, so “Skip” is durable;
- action-item completion identity if the current JSON list cannot support completing one item without rewriting historical Interaction evidence;
- capture processing state if metadata alone cannot provide safe idempotency and review.

Do not add stored scores, daily aggregates, or a generic “daily entry” primitive.

## Delivery sequence

Each phase must be usable on its own. Do not begin the next phase until Joseph has used the current one with real data and accepted the gate.

### Phase 0 — Baseline and semantic audit

**Purpose:** Avoid building a polished loop on contradictory calendar or capture behavior.

Work:

- document the current calendar import path from provider to database;
- determine whether future imports are Plans, Events, or both;
- inventory existing Note capture entry points, including the Assistant `capture_note` tool;
- inventory action-item creation and completion behavior;
- define the workspace owner Person used for personal States;
- record a seven-day baseline manually:
  - days Home opened;
  - useful schedule/context views;
  - Notes captured;
  - inbox items processed;
  - meaningful facts missed or entered elsewhere.

Gate:

- one documented canonical flow for calendar prediction and fulfillment;
- no unresolved disagreement about where quick capture lands;
- baseline recorded without adding telemetry infrastructure.

### Phase 1 — Make Home the daily doorway

**Purpose:** Deliver morning value before adding new input requirements.

Work:

- replace duplicate or competing “Today” concepts with Home as the cross-app daily surface;
- show both scheduled Plans and confirmed Events without presenting them as equivalent;
- add a prioritized “Prepare” section for upcoming people-centric events;
- make action items actionable rather than a read-only JSON list;
- rank nudges and display at most one primary nudge plus optional secondary signals;
- preserve the Still Home variant while using shared tokens and responsive patterns;
- add clear empty, loading, degraded-integration, and stale-data states.

Gate:

- Home answers today’s schedule, next-event context, open commitments, and highest-value nudge in under one minute;
- useful on mobile-width layouts;
- Joseph opens Home on at least five of seven days before Phase 2.

### Phase 2 — Universal capture

**Purpose:** Make LifeOS the easiest place to remember something.

Work:

- add the shared quick-capture control to Home and the common LifeOS bar;
- implement a workspace-scoped capture command/API that always writes the Note first;
- reuse the Assistant capture domain logic rather than creating a second interpretation path;
- provide immediate typed capture, then optional browser/local voice transcription;
- extract entity and primitive suggestions using structured output;
- show a preview before consequential graph writes;
- preserve the original text and provenance on every derived record;
- make retries idempotent and failures non-destructive.

Implementation state:

- [x] Shared quick-capture entry from Home and the LifeOS bar
- [x] Canonical workspace-scoped Note-first command
- [x] Assistant and Theory reuse the same command
- [x] Typed capture
- [x] Idempotent retry and non-destructive failure behavior
- [ ] Optional local/browser voice transcription
- [x] Structured entity and primitive suggestions
- [x] Preview, correction, acceptance, and review flow for suggestions

Gate:

- typed capture completes in under ten seconds;
- a failed AI or resolver call never loses the Note;
- user can correct or reject suggestions;
- Joseph captures at least ten real notes over seven days.

### Phase 3 — Calendar confirmation

**Purpose:** Convert planned time into truthful behavioral history with minimal effort.

Work:

- ingest future calendar occurrences as idempotent calendar-backed Plans;
- add recently ended reconciliation cards to Home;
- implement Happened, Changed, Cancelled, Skip, and Add note;
- create/link one Event per occurrence;
- create participant Interactions only after confirmation or explicit high-confidence policy;
- allow actual attendees, Place, outcome, emotional weight, and follow-ups to differ from the Plan;
- handle recurring-event identity, reschedules, provider deletions, and reconnects.

Implementation state:

- [x] Canonical Events sync writes calendar-backed Plans
- [x] Stable occurrence identity and additive legacy-Event compatibility
- [x] Recently ended Home reconciliation cards, bounded to three
- [x] Happened, Changed, Cancelled, Skip, and Add note
- [x] Actual attendees, Place, outcome, emotional weight, and follow-ups
- [x] Idempotent Event creation and post-confirmation Interactions
- [ ] Retire or redirect the older Persons-owned Google sync path
- [ ] One-week 80% real-use gate

Gate:

- one-tap Happened path;
- no duplicate Events after repeated sync or confirmation;
- cancellations create no Event;
- expected attendees remain references until occurrence is confirmed;
- Joseph reconciles at least 80% of meaningful past calendar Plans for one week.

### Phase 4 — Bounded review inbox

**Purpose:** Let automation help without turning data cleanup into a second job.

Work:

- unify entry into review while retaining source-specific semantics;
- group duplicate or related candidates;
- prioritize consequential ambiguity over bulk low-value imports;
- offer Accept, Correct, Dismiss, and “remember this mapping” where safe;
- default each review session to five items;
- explain what will be created or linked before acceptance;
- record provenance and audit log entries for promoted records.

Implementation state:

- [x] Home provides one cross-source entry point capped at five decisions
- [x] Note suggestions, communication staging, and Place visits retain their source-specific review semantics
- [x] Consequential Note proposals rank ahead of bulk imported ambiguity
- [x] Existing source review commands retain idempotency, dismissal, provenance, and auditing
- [ ] Validate five-item processing time with real data

Gate:

- five ordinary items can be processed in under two minutes;
- dismissals stay dismissed;
- accepting the same source twice is idempotent;
- Home reports actionable review burden, not a demoralizing raw count.

### Phase 5 — Evening closeout

**Purpose:** Close behavioral gaps while memory is fresh.

Work:

- time-shift Home emphasis based on local timezone;
- present no more than three reconciliation cards;
- add optional energy, mood, and stress State capture;
- surface unresolved commitments detected during the day;
- include the open “Anything worth remembering?” capture;
- support “Not tonight” without penalty or false incompleteness.

Implementation state:

- [x] Evening-only Home check-in after 5 PM local time
- [x] Reconciliation remains bounded to three recently ended Plans
- [x] Energy, mood, and stress become timestamped Person State facts
- [x] Optional explanation is a provenance Note
- [x] “Anything worth remembering?” and “Not tonight” are available without fabricating completion
- [ ] Complete four real closeouts in seven days

Gate:

- ordinary closeout takes two minutes or less;
- personal States are timestamped facts with correction/provenance behavior;
- Joseph completes at least four closeouts in seven days without feeling burdened.

### Phase 6 — Grounded weekly review

**Purpose:** Prove the accumulated context is useful.

Work:

- create deterministic weekly source queries first;
- explicitly report data coverage and uncertainty;
- generate a concise narrative from those bounded facts;
- link every insight to supporting records;
- allow “useful,” “not useful,” and correction feedback;
- carry chosen follow-ups into Plans rather than burying them in prose.

Implementation state:

- [x] Seven-day metrics derive live from Plans, Events, Interactions, States, and Notes
- [x] People, State averages, and record-level evidence remain visible
- [x] Useful/not-useful feedback persists as an auditable Note
- [x] Chosen follow-ups create ordinary active Plans
- [ ] Add bounded AI narrative only after the deterministic report proves useful
- [ ] Complete two consecutive real weekly-review usefulness gates

Gate:

- all metrics reproduce from source queries;
- unsupported AI claims are rejected by validation;
- at least one surfaced insight or prevented miss is judged genuinely useful by Joseph in two consecutive weekly reviews.

## Integration priorities

Integrations should be added according to daily truth contributed, not novelty:

1. **Calendar:** daily structure and Plan/Event tension.
2. **Messages and email:** relationships, promises, decisions, and communication gaps.
3. **Manual and voice capture:** observations no provider can supply.
4. **Location:** Place confirmation and reconstruction.
5. **Photos:** people, moments, outfits, Items, and trips.
6. **Finance:** resource flow connected to People and Places.
7. **Health and sleep:** personal States interpreted alongside life context.
8. **Stuff interactions:** purchase, movement, maintenance, use, dressing, and disposal.

An integration is not complete merely because it syncs. It is complete when it either improves a daily decision automatically or places a small, understandable ambiguity into review.

## Success measures

### Adoption

- Home opened on at least five days per week.
- Median useful capture time under ten seconds.
- Evening closeout completed voluntarily on at least four days per week.
- Weekly review opened and assessed.

### Usefulness

- At least one prevented miss, useful reminder, or meaningful insight per week.
- Most surfaced prompts are acted on, dismissed with a reason, or judged useful.
- Joseph reports less reconstruction effort before meetings and at week’s end.

### Trust

- Zero lost captures.
- Zero duplicate canonical Events from retries.
- Every derived record traces to its Note or imported source where applicable.
- Inferred participants and meanings are correctable.
- Uncertain evidence is labeled rather than presented as fact.

### Burden

- Morning orientation under one minute.
- Ordinary evening closeout under two minutes.
- Five-item inbox batch under two minutes.
- No requirement to reach “inbox zero.”

## Verification strategy

Each implementation phase should include:

- pure domain tests for ranking, reconciliation, idempotency, and derived queries;
- workspace-isolation and authorization tests for every read/write path;
- migration proof against a disposable database only;
- browser journeys for morning, capture, confirmation, correction, and evening flows;
- mobile-width visual verification;
- failure tests for unavailable calendar, AI, transcription, and database services;
- checks that production local-review bypass remains inert;
- updates to `docs/PERSONS_ARCHITECTURE.md` and other affected living architecture docs.

No implementation phase should write test data to the production Turso database.

## Explicit non-goals

- A new life primitive for journal entries, routines, tasks, or daily summaries.
- A dashboard containing every available metric.
- Autonomous creation of consequential Events or relationship meaning from ambiguous text.
- Mandatory journaling or emotional scoring.
- Inbox zero as a success condition.
- Storing alignment scores or weekly aggregates as canonical truth.
- Adding every possible integration before the core daily loop earns use.
- Replacing individual lens apps; Home orchestrates them.

## Recommended first build

Begin with **Phase 0**, then implement only **Phase 1**. Use the improved Home for one real week before committing to capture UI or schema additions.

That week should answer the most important product question:

> Does opening LifeOS change how Joseph approaches the day?

If not, improve relevance and prioritization before adding more input surfaces. If yes, universal capture is the next highest-leverage step because it turns LifeOS from something Joseph reads into the place his life is remembered.
