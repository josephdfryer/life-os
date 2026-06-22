# Life OS — Vision and Ethos

> **Start with `docs/MANIFESTO.md`.** That is the founding document — the authoritative statement of what this project is, the eight primitives, and every design principle. This file is a companion, not the source of truth.

*Based on "The Context Manifesto" by Joseph Fryer*

---

## The North Star

**Context is everything.**

Every AI tool, every app, every system we use starts from zero. It meets us as a stranger. It can be enormously capable in the abstract while being almost useless in the specific — because the specific is always about a person, and none of these tools have ever really known a person.

The difference between a capable assistant who just met you and a wise counsel who has known you for years is not ability. It is context.

Life OS is the foundation that makes context possible. Not another tool. Not another app. A living, connected graph of a person's life — their relationships, obligations, goals, health, history, and the values that give all of it meaning — that persists across time and makes every interaction with intelligence not just informed, but wise.

---

## Why This Is Personal

Joseph is 34. He has a one-year-old daughter, a wife who works from home, and a business that demands more than he sometimes has to give. He has goals he cares deeply about: being present with his family, building something that matters, maintaining friendships that sustain him.

And like most people, he is losing track of some of these things. Not because he doesn't care. Because there is no system in his life that holds all of them together and helps him see them clearly.

What he wants is not a smarter to-do list. He wants a system that can:
- Look at his sleep data and tell him he's running too hot
- Notice he hasn't called his best friend in six weeks and surface that — because he declared that relationship as one of the most important in his life
- See which clients cause the most stress and help him think about whether those relationships are worth what they cost
- Get ahead of administrative debt (the car registration, the leaking sink) before it accumulates into unconscious weight

All of that requires context. A system that holds a rich, connected model of his life and has access to it continuously. Not a snapshot. A living graph.

---

## The Five Primitives

Everything in Life OS is built on five first-class concepts:

1. **Person** — the humans in your life: their attributes, history, closeness, attention signals, plans
2. **Place** — locations at any scale: Earth → Country → City → Home → Room → Shelf
3. **Event** — things that happen in the world: meetings, trips, dinners, milestones. Events exist independently of any one person's participation.
4. **Item (Object)** — physical things you own: with acquisition cost, current value, location, warranty, assembly trees
5. **Plan** — declared intent: goals, commitments, the version of yourself you are trying to become

---

## The One Edge Type: Interaction

Every connection in the graph is an **Interaction**. This is the most important design decision in the entire model.

An Interaction is the universal event log. It connects any two or more nodes, carries its own metadata, and records the fact that two things in the graph touched each other at a moment in time.

```
Interaction
  — Nodes:           any two or more (Person ↔ Event, Person ↔ Item, etc.)
  — Timestamp:       when it happened
  — Type:            call | meeting | message | dinner | financial | other
  — Duration:        in minutes
  — Emotional weight: Energizing | Positive | Neutral | Draining | Stressful
  — Outcome:         Complete | Follow-up needed | Action required | Open
  — Summary:         AI-generated or manually written
  — Source file:     link to raw imported data
  — Financial meta:  amount, direction (paid / received)
```

**The critical distinction: Events vs Interactions.** An Event exists independently in the world. A meeting exists whether or not you attended. An Interaction is your personal relationship to that Event. If three people attend a meeting, there are three Interactions pointing at the same Event, each carrying its own personal metadata.

Notes and transcripts live on the Event, once. Emotional weight and personal outcomes live on the Interaction, separately for each participant. The same meeting can be energizing for one person and draining for another.

---

## What Falls Out of the Model (Derived, Never Stored)

The power of the model is not in what it stores — it is in what it derives. None of the following are ever stored as fields. They are all computed queries against the graph:

- **Net worth** — sum of current values across all Item nodes minus liabilities
- **Relationship health** — derived from the Interaction log: recency, frequency, emotional weight trend
- **Attention score** — gap between last interaction and expected cadence given closeness level
- **Tension** — gap between Plans (declared intent) and Interactions (actual behavior)
- **Life cycle report** — any time window queried against the Interaction log

Storing derived values would mean maintaining two sources of truth. Deriving them keeps the graph always internally consistent, always replayable, always honest.

---

## Core Principles

**AI import is primary. Manual entry is a fallback.**
The best data already exists — years of iMessages, emails, Slack, and calendar events. The system should make it trivially easy to import and parse these automatically. Manual entry is for things that don't already exist in digital form.

**The file is sacred. The summary is the interface.**
When a conversation is imported, the original file is stored permanently. The AI generates a summary that serves as the day-to-day interface. But the raw source is always accessible.

**Derived over stored.**
Net worth, relationship health, equity, attention score — never stored as fields, always computed fresh from the underlying graph. The graph knows what happened. What it means is a fresh computation.

**Absence is data.**
A 47-day silence between two people who have declared a close friendship is not nothing. It is a signal. The system reads gaps the way a doctor reads a missing symptom.

**The unit of analysis is a life, not a task.**
The smog test is not a task to complete. It is a signal that administrative debt is accumulating. The prompt to call a friend is not a reminder. It is an intervention on behalf of a value the person has declared but keeps deprioritizing.

**The model is yours.**
This data is the most personal data that exists about a human being. It should be owned by the person it describes and stored in infrastructure they control.

**Conservative by default.**
When pulling in data automatically, match only what's known. Don't create noise. Stage ambiguous items for review. Flood protection and "known people only" are features, not limitations.

---

## What's Built So Far

- **Persons app** — the People primitive: full CRM with closeness, interaction history, attention signals, rules engine, inbox, workspace tenancy, Gmail/iMessage/Google Calendar/Gmail sync, admin access management
- **Stuff app** — the Items primitive: physical object inventory with QR asset IDs, location, assembly trees, purchase/warranty history
- **Shared schema** — all 5 primitives are defined. Interaction already has `amount`, `billable`, `direction`. The data model is ahead of the UI.

---

## What's Next

The CRM is the first application. It is not the point.

The point is the foundation — the graph, populated with real data, continuously updated, available to any intelligence built on top of it.

Future applications pull from the same foundation:
- **Financial intelligence** — not just what was spent, but who with, where, and how it felt
- **Health intelligence** — not just sleep scores, but what was happening in life on the bad nights
- **Professional intelligence** — not just the calendar, but the relational context and stress history of every client relationship

None of these are novel in isolation. What is novel is the shared foundation. A single graph that connects all of them — so that a bad night of sleep can inform a recommendation about client communication, and a spending pattern can surface a question about whether time is actually going where values say it should.

---

## For Agents

When building features for Life OS, ask: **which primitives does this connect?**

A feature that links two or more primitives is almost always more valuable than one that deepens a single primitive in isolation. The goal is the connected picture, not the individual records.

The CRM (Persons) is the first application of the graph. Every decision made there should be consistent with a future where Places, Events, Items, and Plans are equally first-class — because that future is already planned, and the schema already reflects it.

Always design for automatic ingestion with conservative defaults. The absence of expected interactions is itself information. Build toward a system that can notice when behavior diverges from stated intent — because that tension is where the most useful intelligence lives.
