# Life OS Action System Plan

**Status:** Phase 1 and core Phase 2 inbox flow implemented  
**Owner:** Joseph  
**Purpose:** Reliably hold everything Joseph may need to do without turning Life OS into another guilt-producing task manager.

## Decision

Build the action system as a focused workflow over the existing `Plan` primitive. Do not add a `Task` primitive and do not create a separate task app.

The system has two intentionally different promises:

1. **Action inbox — “I may need to do this.”** A captured action candidate is a draft Plan. It is safely remembered but makes no claim about when Joseph will do it.
2. **Commitment — “I have chosen to do this.”** An active Plan has either a day (`dueOn`) or an actual calendar slot (`scheduledStart`). It belongs in Home's daily loop and must eventually be done, deliberately moved, scheduled, or dropped.

This distinction is the core of the product. Capturing everything should be nearly free; committing should remain scarce and honest.

## Why this fits Life OS

- A task is declared intent, so it is a `Plan`, not a ninth primitive.
- `Plan.status = draft` already represents an uncommitted candidate.
- `Plan.status = active`, `dueOn`, `scheduledStart`, `deferCount`, and `completedAt` already support chosen work.
- `Plan.personId`, `placeId`, `parentId`, and `sourceNoteId` connect actions to the rest of the life graph.
- Existing Home commitment controls already support Done, Today, Snooze, Schedule, and Drop.
- Existing Interaction action items already enter a bounded triage queue and can become Plans.
- Existing Note-first capture preserves provenance, but its paid “Find structure” review is too much ceremony for routine action capture.

The action system should therefore complete and unify the current design, not replace it.

## Product thesis

Traditional task managers fail by making capture feel like commitment, dates feel like predictions, and the backlog feel like judgment. Life OS should instead answer three small questions:

- **Capture:** What might I need to do?
- **Choose:** What am I honestly willing to move today?
- **Act:** What is the best next thing given my actual time, place, people, and energy?

The UI should never imply that an inbox of 100 possibilities means Joseph has 100 overdue promises.

## Canonical experience

### 1. Capture in one line

Add an **Action** mode to the existing Home quick capture and shared Life OS capture entry point.

Examples:

- “Call the dentist”
- “Send Connell the job article tomorrow”
- “Buy light bulbs when I’m near Home Depot”
- “Figure out summer childcare with Jilli”

Submitting must be one gesture. It writes:

```text
Note (original words and provenance)
  -> draft Plan (action candidate)
```

The draft Plan should be created immediately and deterministically. It must not require the paid AI structure flow. Lightweight parsing may propose a person or date, but ambiguity must not block capture and inference must remain editable.

Capture confirmation should say **“Added to action inbox”**, not “Task created” or “Due.”

### 2. Choose a tiny Today list

Home should show a single action surface near the top of the day:

```text
TODAY
1–3 chosen commitments

UP NEXT
one recommended action when useful

ACTION INBOX
bounded batch of uncommitted candidates
```

Today is deliberately scarce. Default to three chosen actions; scheduled calendar items remain visible in the schedule but do not consume all three slots. Joseph can pull in more, but the product should not encourage filling the day with an aspirational list.

For each draft action, offer only:

- **Today** — activate with today's `dueOn`.
- **Schedule** — activate with `scheduledStart`.
- **Later** — keep as a draft without pretending it is due.
- **Drop** — abandon it cleanly.

Review at most five inbox items at a time. Never render the whole backlog by default.

### 3. Make doing easier than organizing

Each chosen action should have one dominant control: **Done**. Secondary controls are **Move**, **Schedule**, and **Drop**.

When helpful, show context directly on the row:

- the Person waiting and how long;
- the parent Plan or goal;
- the relevant Place;
- the source conversation or Note;
- an honest time estimate, if Joseph supplied one.

Do not require projects, labels, priorities, quadrants, or recurring-task configuration for ordinary use.

### 4. Treat deferral as information, not failure

Keep the existing snooze ladder and three-deferral limit. After repeated movement, ask a better question:

- **Schedule it** — this is real and needs protected time.
- **Make it smaller** — edit it into a physically doable next action.
- **Drop it** — it is not an honest commitment.

“Blocked” should mean waiting on a named external condition, ideally a Person or another Plan. Blocked work should not occupy Today unless an unblock action is available.

### 5. Close the semantic loop

Completing a Plan is behavioral evidence, not just a status change. The durable version should create or link a lightweight `Event` through `Event.sourcePlanId`, while the user still experiences one-tap completion.

That preserves the founding distinction:

```text
Plan: I intended to call the dentist
Event: I called the dentist
Interaction: the call connected me to the office/person/place, if meaningful
```

This also makes weekly review able to compare what was intended with what actually happened.

## Information architecture

Do not create an Actions app initially.

- **Home:** capture, Today, next action, and bounded inbox triage.
- **Persons:** actions involving a Person, shown in that Person's context.
- **Events:** scheduled actions and time commitments.
- **Places:** actions that become relevant at a Place.
- **Stuff:** maintenance, purchase, warranty, and repair actions tied to Items.
- **Context/Theory:** parent Plans, goals, and declared priorities.
- **Assistant:** conversational capture, completion, rescheduling, and “what should I do next?”

Home owns the workflow; each lens shows the same Plans in context. There is one source of truth.

## Minimal data-model evolution

Phase 1 should reuse the current schema. Avoid adding fields until real use proves their need.

| Meaning | Existing representation |
|---|---|
| Action inbox item | `Plan.status = draft`, no date |
| Chosen for a day | `Plan.status = active` + `dueOn` |
| Protected time | `Plan.status = active` + `scheduledStart` |
| Waiting | `Plan.status = blocked` |
| Done | `Plan.status = completed` + `completedAt` |
| Intentionally removed | `Plan.status = abandoned` |
| Project / larger outcome | parent `Plan` with child Plans |
| Person context | `Plan.personId` / `PlanExpectedPerson` |
| Place context | `Plan.placeId` |
| Provenance | `Plan.sourceNoteId` |

Likely later additions, only after usage evidence:

- an explicit `estimatedMinutes` field, because time-fit can materially improve next-action selection;
- a typed blocking relation, if `blocked` is used often enough to warrant more than status;
- recurrence rules, only when repeated manual recreation becomes visible friction.

Do not add generic priority, tags, or a separate project model in the first pass.

## Recommendation logic

The system may recommend one next action, but it should explain the recommendation in human terms. Rank only among active, actionable Plans using signals already in the graph:

1. overdue promise to another Person;
2. action that unblocks another Plan;
3. action matched to an upcoming Event or current Place;
4. repeatedly deferred commitment requiring a decision;
5. small action that fits the available calendar gap;
6. alignment with a declared parent Plan or value.

Never silently reorder work based on opaque AI judgment. The user should be able to see “Connell has waited 5 days” or “fits the 20 minutes before your next event.”

## Implementation sequence

### Phase 1 — Direct action capture

- Add Action as a first-class capture type in Home.
- Create a Note and draft Plan in one idempotent command.
- Add direct Plan creation to the Assistant toolset using the same command.
- Preserve exact source text and provenance.
- Add tests for retry safety and workspace isolation.

**Acceptance:** an action can be captured from Home in under five seconds with no date, modal, or model call.

**Implemented:** Action mode, atomic/idempotent Note + draft Plan capture, Home route support, and integration coverage.

### Phase 2 — One unified action surface

- Evolve the Commitments widget into Today + Action Inbox.
- Include draft Plans and Interaction-derived action items in one bounded inbox.
- Keep Today capped visually at three chosen commitments.
- Add Today, Schedule, Later, and Drop triage actions.
- Keep existing Done, Snooze, Schedule, and Drop behavior for active commitments.

**Acceptance:** Home makes it obvious what is merely remembered versus actually promised.

**Implemented:** bounded draft Plan Action Inbox with Today, Schedule, and Drop promotion controls. Broader contextual surfacing remains in later phases.

### Phase 3 — Context everywhere

- Show open related Plans on Person, Place, and Item detail pages.
- Let those surfaces capture a pre-linked action in one line.
- Add source links back to the originating Note or Interaction.

**Acceptance:** Joseph never has to duplicate a follow-up just to see it in the relevant person's or object's context.

### Phase 4 — Honest completion and next-action help

- Create/link a lightweight Event when a Plan is completed.
- Add a single explainable “Up next” recommendation.
- Use calendar gaps and an optional time estimate only after the core loop is habitual.

**Acceptance:** weekly review can derive chosen, moved, dropped, and completed work from canonical facts.

### Phase 5 — Real-use tuning

Use the system for two weeks before adding recurrence, dependencies, tags, or richer project management. Review:

- capture-to-triage rate;
- number of chosen commitments per day;
- completion, move, and drop rates;
- items deferred three times;
- actions completed without ever being chosen;
- whether Person/Place/Item context actually helped action.

These are diagnostic queries, not permanent gamification scores.

## Explicit non-goals

- No ninth `Task` primitive.
- No separate task database or external task-service dependency.
- No giant default backlog.
- No mandatory due dates.
- No automatic conversion of every Note or message into a commitment.
- No streaks, red overdue counts, productivity scoring, or shame mechanics.
- No AI dependency in the critical capture path.
- No broad project-management feature set before the daily loop earns regular use.

## First build slice

The smallest meaningful release is:

1. Action mode in Quick Capture.
2. Idempotent `captureAction` domain command that writes Note + draft Plan.
3. Draft Plan batch in the Home commitments surface.
4. One-tap Today / Schedule / Drop decisions.
5. Clear separation between **Action inbox** and **Today**.

This slice changes the habit without changing the ontology. It is the recommended place to start.
