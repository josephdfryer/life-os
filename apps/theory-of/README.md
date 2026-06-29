# Theory of Person

A derived **lens over the Life OS graph**. Given a `Person`, it synthesizes the current
best *living theory* of that person from data Life OS already stores.

> Person is the source entity. Theory is the derived interpretation.
> Life OS stores the life. Theory of Person interprets the life.

## This is not a new primitive

Life OS is eight primitives and one edge: **Person · Place · Item · Event · Plan · Group ·
State · Note**, connected by **Interaction**. Theory of Person does **not** add a ninth.

The canonical, stored truth stays in those primitives. A theory is *derived* from them.

`TheorySnapshot` and `TheorySnapshotSource` are **app-layer cache / versioning** — a
persisted, auditable, versioned answer to one question:

> Given everything Life OS knows about this person right now, what is the current best
> theory of them?

They are infrastructure, not life primitives. A theory is never the source of truth; it is
a reading of it.

## What it derives (never stored as primitives)

Current Best Model · Principles · Hypotheses · Patterns · Contradictions · Open Questions ·
Evidence Trail · Confidence · Changelog — all live inside the snapshot's markdown body (and,
later, structured JSON). They are **not** forced into `State`. A `State` remains a
timestamped real-world condition on an entity (e.g. "Joseph was tired on 2026-06-29"), never
a principle or hypothesis.

## How it works

- **Sources** (`@life-os/theory` → `getTheorySourcesForPerson`) collect the person's Notes,
  Events, Interactions, States, and Plans — read-only.
- **Synthesis** (`synthesizeTheoryOfPerson`) is currently a **stub**: it gathers the real
  evidence base and emits a scaffold that honestly marks everything *Unknown*. **AI
  generation is intentionally deferred.** Swapping in a model-backed synthesizer later does
  not change the `createTheorySnapshot` contract.
- **Snapshots are append-only.** Regenerating finds the max version, creates `version + 1` as
  the new `current`, and archives the prior `current`. Old snapshots are never overwritten.
- **Provenance:** every snapshot links back to the source records it was built from via
  `TheorySnapshotSource`.

## Routes

- `/` — people, with their current theory status.
- `/person/[personId]` — a person's current theory: body, confidence, last synthesized,
  source count, open questions, evidence trail, and prior versions.

## Actions

- **Regenerate Theory** — synthesizes a new versioned snapshot (stub for now).
- **Add Theory Note** — creates a **normal Life OS `Note`** (`type: "theory_observation"`,
  `metadata.subjectPersonId`), not a theory-specific record. It becomes a source on the next
  synthesis.

## Guardrails

The UI always states: *"This theory is not truth. It is the current best model based on
available evidence."* The system never asserts "Joseph is X." It prefers "current evidence
suggests…" or "high-confidence pattern: …tends to…".

## Seed

`npm run seed -w theory-of` seeds the first **Theory of Joseph** snapshot if a person named
Joseph exists and has no theory yet. Idempotent and additive.

## Dev

```bash
npm run dev -w theory-of   # http://localhost:3004
```
