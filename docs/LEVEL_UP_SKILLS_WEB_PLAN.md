# Level Up — Skills Web + Character Window

Status: **Phase 0 decisions locked** (2026-09-04) — ready for first implementation slice

Date: 2026-09-04

Related:

- Supersedes the **“retire all authenticated Level Up web UI”** decision in
  [`LEVEL_UP_MOBILE_TRANSITION_PLAN.md`](./LEVEL_UP_MOBILE_TRANSITION_PLAN.md).
  Native fitness work remains valid but is **deferred** relative to the web
  character / skills profile (see §7).
- Graph principles: [`MANIFESTO.md`](./MANIFESTO.md). New web UI: Still
  ([`STILL_DESIGN_SYSTEM.md`](./STILL_DESIGN_SYSTEM.md)), not Warm Concrete.

---

## 1. Decision (locked)

**Level Up is the LifeOS lens for deliberate growth across skills — an RPG-style
character window over a real life, not a workout website.**

| Surface | Job | Priority now |
|---|---|---|
| **Level Up web** | Character window, skills library, ranks, related Plans | **Primary** |
| **Level Up iOS** | Workout capture into the graph | Later — do not block web |
| **Hidden service** | Authority (`@life-os/level-up`, API, tables, graph) | Ongoing |

Workouts are not the product identity. The web app becomes a **character sheet**:
who I am becoming, which skills I have, how honestly they are ranked, and which
`Plan`s are attached to getting better.

Same LifeOS workspace/graph. Same `Plan` primitive Home already uses. No second
goals database. No ninth life primitive for “Skill.”

---

## 2. Locked Phase 0 answers

| # | Question | Decision |
|---|---|---|
| 1 | First non-athletic skill | **Communication** |
| 2 | Plans ownership | **Same graph `Plan` rows** as Home / Persons — Level Up is a lens, not a fork |
| 3 | iOS / combine urgency | **Web skill profiles first.** Worry about iOS workout ownership later |
| 4 | Player card fate | **Evolves into an RPG-style character window** — all skills, attributes, builds energy — not a fitness-only OVR page |

Remaining soft questions (do not block first slice):

- Keep “IRL Player” subtitle vs drop it as the shell becomes multi-skill.
- Public install/marketing page vs authenticated-only.

---

## 3. Product north star — character window

Think classic RPG character screen, LifeOS-honest:

- **Identity** — who I am trying to become (active / focused Plans), not a cartoon avatar.
- **Skills** — domains on the sheet (Fitness, Communication, …). Each opens into
  attributes / tracks when the domain has a real model.
- **Attributes** — domain-specific ratings. Fitness already has the ten athletic
  attributes + OVR/builds. Communication gets its own rubric (not Strength reused).
- **Confidence / evidence** — sparse or self-rated skills look provisional; verified
  assessments look solid. No fake XP from tapping buttons.
- **Related Plans** — every skill surface shows the `Plan`s that declare intent to
  improve that skill (and can create / focus / complete them).
- **Journey** — career/timeline energy: milestones, assessments, consistency —
  capability and momentum stay separate tracks.

Fitness is one skill on the sheet. Communication is the first non-athletic skill
that earns a second panel. More skills appear only when they have practice,
evidence, and an honest progression story.

### What “RPG style” means here

Adopt:

- One composition that reads as **my character**, not a dashboard of widgets.
- Clear skill list + drill-in detail (attributes, rank honesty, Plans).
- Builds / archetypes as *weights on what I am optimizing*, not loot.

Reject:

- Fake global XP, currencies, loot, leaderboards, emoji crests.
- One universal OVR across Fitness + Communication.
- Warm Concrete gym chrome as the long-term visual language (Still for new UI).

---

## 4. LifeOS model (no ninth primitive)

| Meaning in Level Up | LifeOS representation |
|---|---|
| Who I am trying to become / skill improvement intent | `Plan` (same table as Home) |
| A practice, workout, talk, writing session, performance | `Event` |
| Observed capability or condition at a time | `State` |
| Reflection, rubric score note, coach feedback | `Note` |
| Coach, partner, audience, team | `Person` / `Group` + truthful `Interaction` |
| Where / with what | `Place` / `Item` |

Level Up may keep **infrastructure** for skill definitions, rubrics, and domain
engines. Fitness already has `LevelUp*`. Communication will need a small
infrastructure shape only after the rubric is pressure-tested in UI with real
Plans — not a premature schema dump.

---

## 5. Target web information architecture

Primary nav evolves toward:

| Area | Purpose |
|---|---|
| **Character** (home) | RPG window: identity, skill summary ranks, primary build/intent, confidence |
| **Skills** | Library — Fitness + Communication first; stubs only if explicitly useful |
| **Skill detail** | Domain attributes, evidence honesty, related Plans, next practice/evidence |
| **Plans** | Filtered view of graph `Plan`s tied to skills / becoming |
| **Journey** | Timeline (ex-Career / Badges energy) |

Gym logging routes (`/train`, session) are deprioritized on web. They may stay
reachable briefly for rollback but are not the product. No requirement to finish
iOS before shipping Character + Communication profile.

### Route triage (current → target)

| Current | Disposition |
|---|---|
| `/` Card | **Migrate** → Character window |
| `/builds` | **Fold** into Character / Fitness skill (weights / archetype) |
| `/career`, `/badges` | **Migrate** → Journey |
| `/attributes/[key]`, `/exercise/[key]` | **Fold** into Fitness skill detail |
| `/combine`, `/body` | **Keep readable for now**; not the first redesign focus |
| `/train`, `/train/session` | **Deprioritize / soft-retire** when convenient; iOS later |
| `/start` | Keep cold-start / profile until Character onboarding replaces it |

---

## 6. Communication skill — first cut

Communication is the pilot that proves the sheet is multi-domain.

### Intent

Joseph’s life already stresses interpersonal clarity, written follow-through,
client-facing EQ, and live case-style thinking. The skill should model **that**,
not a generic Toastmasters checklist copied from the internet.

### v1 shape (deliberately thin)

1. **Skill appears on Character** — Communication card beside Fitness.
2. **Skill detail page** — provisional attributes (draft list below), confidence
   band (mostly self-declared / Note-backed at first), related Plans.
3. **Plans** — create and link graph `Plan`s such as “improve written
   follow-through” or “practice hard conversations” — same Focus/Plan system.
4. **Evidence later** — Events/Notes/Interactions that support a rating; do not
   invent a combine engine on day one.

### Draft attribute axes (to pressure-test, not ship as science)

Working labels — rename freely in the next pass:

| Axis | Rough meaning |
|---|---|
| Clarity | Can I make the point land simply? |
| Listening | Do I understand before advocating? |
| Written follow-through | Do commitments get closed in writing? |
| Presence | Live rooms / meetings / hard conversations |
| Persuasion | Moving someone without coercion or fog |
| Relational care | Tone and trust with people who matter |

These are **not** fitness norms. Early ranks should show as provisional /
self-assessed until a real rubric + evidence loop exists. Prefer honest
“unranked / drafting” over fake 78s.

### What not to do in v1

- No Communication OVR blended into athletic OVR.
- No copying Strength/Power math.
- No large schema until one week of real Plan + reflection use says we need it.

---

## 7. Delivery sequence (reordered)

### Phase 0 — Align — **done**

Decisions in §2 locked. Soft questions can wait.

### Phase 1 — Character window shell (Still) — **next**

- Restyle Level Up web shell toward Still.
- Replace Card-as-home with **Character**: skill roster (Fitness from existing
  engine card; Communication as provisional).
- Fold Builds into Character / Fitness.
- Plans panel or tab: same `Plan` primitive, skill-scoped where tagged/linked.
- Leave Train alone or demote in nav; do not spend the slice on iOS.

Exit gate: authenticated web opens on a character sheet that shows Fitness +
Communication; Fitness still shows real engine numbers; Communication is honest
about being provisional; at least one related Plan can be created/linked.

### Phase 2 — Communication skill profile depth

- Skill detail for Communication with draft attributes + confidence copy.
- Rubric / self-assessment capture as Note- or State-backed evidence (minimal).
- Related Plans list and “add Plan for this skill” using existing Plan APIs.
- Journey entries when assessments or Plans change meaningfully.

Exit gate: Communication feels like a first-class skill on the sheet, not a
placeholder tile, without pretending athletic-grade science.

### Phase 3 — Fitness as a skill panel

- Move athletic attributes / combine history / body under Fitness skill detail.
- Character home shows Fitness summary only (OVR + primary build + link).
- Soft-retire Train from primary nav when Character is stable.

Exit gate: gym chrome is no longer the top-level IA; Fitness is one skill.

### Phase 4 — iOS workout ownership (deferred)

Resume [`LEVEL_UP_MOBILE_TRANSITION_PLAN.md`](./LEVEL_UP_MOBILE_TRANSITION_PLAN.md)
when ready. Web Character does not wait on it.

### Phase 5 — Harden

- Drop dead workout-only UI once unused.
- Domain-adapter boundary in `packages/level-up` for multiple skills.
- Docs / deploy language: Level Up web = character / skills desk.

---

## 8. Explicit non-goals (for now)

- Blocking on iOS workout parity
- Android
- Social leaderboards / public profiles
- Universal Skill primitive or cross-domain OVR
- Fake XP / loot / currencies
- AI skill prescriptions without evidence + provenance
- Deleting `LevelUp*` workout history
- Extending Warm Concrete for the new shell

---

## 9. First implementation slice (after this doc)

Narrow and reversible:

1. Character home route (Still) with Fitness summary + Communication provisional card.
2. Communication skill detail stub + related Plans using existing `Plan` APIs.
3. Nav: Character / Skills / Plans / Journey (Journey can wrap career for now).
4. Demote Train in nav (optional in same PR).

Do not: remove engine, delete workout data, or build iOS features in this slice.

---

## Revision log

| Date | Change |
|---|---|
| 2026-09-04 | Initial draft: skills web + iOS workout split. |
| 2026-09-04 | Locked: Communication first; same Plans; web profiles before iOS; Card → RPG character window. Reordered delivery. |
