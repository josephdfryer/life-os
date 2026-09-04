# Level Up — Skills Web + Workout iOS Split

Status: draft for joint iteration (not yet approved)

Date: 2026-09-04

Related:

- Supersedes the **“retire all authenticated Level Up web UI”** decision in
  [`LEVEL_UP_MOBILE_TRANSITION_PLAN.md`](./LEVEL_UP_MOBILE_TRANSITION_PLAN.md)
  §1 and §5 Phase 5. Fitness science, iOS workout loop, graph mapping, and
  “no Skill primitive yet” rules from that plan remain in force unless this
  document explicitly changes them.
- Product flows for native fitness remain in
  [`LEVEL_UP_NATIVE_PRODUCT_FLOWS.md`](./LEVEL_UP_NATIVE_PRODUCT_FLOWS.md).
- Graph principles: [`MANIFESTO.md`](./MANIFESTO.md). New web UI: Still
  ([`STILL_DESIGN_SYSTEM.md`](./STILL_DESIGN_SYSTEM.md)), not Warm Concrete.

---

## 1. Decision (proposed)

**Level Up is the LifeOS lens for deliberate growth across skills — not a
workout website.**

Split the product surfaces by job:

| Surface | Job | Owns |
|---|---|---|
| **Level Up web** | Library, ranking honesty, and improvement Plans | Skill catalog, capability ranks / confidence, related Plans, journey over time, settings that are better as a desk surface |
| **Level Up iOS** | Capture and practice in the real world | Workouts, set logging, readiness, HealthKit / Oura, combines when gym-side, offline session recovery |
| **Hidden service** | Authority | `@life-os/level-up`, `apps/api`, `LevelUp*` tables, graph projections |

Workouts leave the web app. The web app does **not** disappear — it stops
being a gym logger in Warm Concrete and becomes the skills / ranks / Plans
desk surface in Still.

Standalone still means product experience, not a data silo. Every Level Up
user resolves to a LifeOS workspace and graph. iOS writes evidence into that
graph; the web reads the same truth.

---

## 2. Why this split

The current web app (`apps/level-up`) is mostly Card / Train / Combine / Body
on the old Warm Concrete language. That matched an early “IRL Player” fitness
MVP. It is the wrong primary home for:

- browsing a **library of skills** across life domains
- seeing **honest ranks** (capability vs momentum, confidence visible)
- tying improvement to **Plans** (who I am trying to become) already in the graph

Gym logging wants one-handed offline UI, timers, haptics, Live Activity — that
belongs on iPhone. Desk work wants scanning a library, editing Plans, and
reading a career/journey narrative — that belongs on the web.

---

## 3. Product promise (unchanged loop, wider domain)

Same honest loop as the mobile plan, now explicit that the web owns steps
1–2 and 6, and iOS owns 3–5 for fitness:

1. Choose who you are trying to become → **Plan** (web + Home)
2. Select a skill / capability to develop → **Skills library** (web)
3. Get a small next action → Today (iOS for fitness; later web/home for desk skills)
4. Practice in the real world → domain capture (iOS workout first)
5. Capture evidence with low friction → iOS / connectors
6. See progress, uncertainty, consistency, what next → **web ranks + journey + related Plans**

Rules that stay non-negotiable:

- Capability is domain-specific and evidence-based. No universal fake XP.
- Momentum / career can be cross-domain; RANK cannot be contaminated by streaks.
- Confidence is visible when evidence is sparse or self-reported.
- Fitness keeps verified ceiling: training moves form inside range; combine
  raises ceiling.

---

## 4. LifeOS model (no ninth primitive)

A skill journey remains a **Level Up projection** over the eight primitives:

| Meaning in Level Up | LifeOS representation |
|---|---|
| Who I am trying to become / outcome | `Plan` |
| A practice, workout, lesson, test, performance | `Event` |
| Observed capability or condition at a time | `State` |
| Reflection, rubric, coach note | `Note` |
| Coach, partner, class | `Person` / `Group` + truthful `Interaction` |
| Where / with what | `Place` / `Item` |

Level Up may keep **infrastructure** tables for skill definitions, rubrics,
domain engines, and assessment protocols. Those support the lens; they are not
life primitives.

**Defer** a generalized skill schema until at least one non-fitness domain is
designed from real use and pressure-tested against this mapping (same gate as
the mobile plan §9). Fitness already has `LevelUp*` infrastructure; treat it
as the first domain adapter, not the product ceiling.

---

## 5. Target web information architecture

Replace Card / Train / Combine / Body as the primary nav with a skills-first
shell (names open to debate):

| Area | Purpose |
|---|---|
| **Skills** | Library of domains and tracks. Fitness first as a real domain card; other skills appear only when they have practice + evidence + assessment. |
| **Skill detail** | Rank / Balance / unranked honesty, confidence, related Plans, next evidence needed, links into domain history. |
| **Plans** | Improvement Plans tied to skills (and the person I am becoming). Create / focus / complete against graph `Plan`s — not a second goals database. |
| **Journey** | Chronological capability + consistency narrative (career / badges energy without gym chrome). |
| **You** | Profile, builds/goals for fitness, connections health, install iOS deep link. |

Explicitly **removed from web** (or reduced to read-only deep links into iOS):

- Active session / set logging (`/train`, `/train/session`)
- Workout start / program day runner
- One-handed gym chrome (wheel pickers, rest timers as primary UX)

**Maybe keep on web temporarily** (decide in Phase 0 triage):

- Combine entry (assessment desk vs gym) — prefer iOS long-term; web may stay
  read-only history until native combine ships
- Body metrics history — prefer HealthKit + iOS; web may show trends only
- Player card / builds — fold into Fitness skill detail + You, Still-restyled

---

## 6. What already exists (baseline)

| Piece | State |
|---|---|
| `apps/level-up` Next app | Live Warm Concrete; Card, Combine, Train, Body, Builds, Badges, Career |
| `packages/level-up` | Pure engine + workout/readiness/profile domain commands |
| `LevelUp*` Prisma models | Fitness infrastructure in shared Turso DB |
| Device workout API | Today / session / set / body under `apps/api` |
| `LevelUpFeature` + `LevelUpIOS` | Native shell + early Today / session slice; not full parity |
| Home / Focus / Plans | Graph Plans and Focus queue exist outside Level Up |

This plan does **not** delete workout tables or native work. It reassigns the
browser’s job and freezes web workout feature work.

---

## 7. Delivery sequence

### Phase 0 — Align and freeze (this doc)

Work together until these are written answers, not vibes:

1. Approve or amend the surface split in §1.
2. Inventory every current web route/action: **migrate to skills web**,
   **move to iOS only**, **keep temporarily**, or **retire**.
3. Name the first **non-fitness skill pilot** (or explicitly “fitness-only
   library shell first, second skill next”).
4. Decide how Skills relate to existing Home Focus / Plans UX (one Plan
   system, two lenses — or Level Up Plans tab is a filtered view of the same
   rows).
5. Mark `apps/level-up` workout writes as freeze: urgent fixes only; new
   behavior goes to `packages/level-up` + `apps/api` + iOS.

Exit gate: parity/retirement matrix checked in; this doc status → approved.

### Phase 1 — Deprecate workout UI on web (reversible)

- Remove Train (and session) from primary nav; show an install / open-in-iOS
  path instead of logging sets in the browser.
- Stop deploying new Warm Concrete gym chrome; leave legacy routes behind a
  soft “moved to iOS” banner if needed for rollback.
- Keep engine, combines history, and card readable so fitness skill detail
  still has evidence.
- Do **not** delete `LevelUpSession` / set data. Web retirement of logging ≠
  data reset.

Exit gate: no new sets can be written from the browser in production (or
writes are explicitly blocked); iOS path documented.

### Phase 2 — Skills web shell (Still)

- Restyle `apps/level-up` shell to Still (or replace route tree in place).
- Ship Skills index with Fitness as the first real domain card.
- Skill detail for Fitness: OVR / attributes / confidence folded from current
  Card; link related Plans; “practice on iOS” CTA.
- Plans view: workspace Plans filtered / tagged by skill or improvement
  intent — same `Plan` rows Home uses.
- Journey: migrate Career / Badges energy into one calm timeline.

Exit gate: desk user can browse Fitness as a skill, see ranks honestly, and
see related Plans without opening Train.

### Phase 3 — iOS workout ownership

Continue [`LEVEL_UP_MOBILE_TRANSITION_PLAN.md`](./LEVEL_UP_MOBILE_TRANSITION_PLAN.md)
Phases 1–3 for native fitness parity (session UI, offline queue, art,
combines, library). Web no longer blocks native cutover of logging.

Exit gate: three real gym sessions pass airplane / force-quit / no-duplicate
tests; web is not required for a workout week.

### Phase 4 — Second skill pilot

- Pick one real non-fitness skill from Joseph’s life.
- Pressure-test Plan / Event / State / Note mapping before any schema.
- Define practice capture (may be Note + Event, not a second gym UI).
- Add domain adapter boundary in `packages/level-up` (next action, evidence,
  assessment, progress) without a universal capability score.

Exit gate: second skill appears in the web library with honest unranked or
rubric progress — no fake XP, no fitness formula reuse.

### Phase 5 — Harden the split

- Redirect leftover web gym deep links to iOS Universal Links where possible.
- Drop dead workout components from `apps/level-up` once unused.
- Update deploy/smoke docs: Level Up web = skills desk; Level Up iOS = capture.
- Keep `packages/level-up` + API as shared authority forever.

Exit gate: docs, nav, and deploys match the split; rollback window documented.

---

## 8. Open questions (decide together)

These block Phase 0 exit. Prefer short written answers in this doc.

1. **First non-fitness skill?** Candidates only after real life use — e.g.
   language, music, cooking, public speaking, parenting craft — not a
   hypothetical catalog of fifty.
2. **Plans ownership:** Does Level Up web edit the same `Plan` records as
   Home/Persons, with a skill-scoped view? (Recommended: yes.)
3. **Combine on web:** Retire entry now, keep history, or keep full desk
   combine until native ships?
4. **Player card:** Die as a top-level page, or become the Fitness skill
   hero?
5. **Public install page:** Minimal LifeOS marketing page vs authenticated
   skills app only?
6. **Naming:** Keep “IRL Player” subtitle, or rebrand the web shell to
   “Skills” under Level Up?

---

## 9. Explicit non-goals (for now)

- Android
- Social leaderboards / public skill profiles
- Universal Skill primitive or cross-domain OVR
- AI skill prescriptions without deterministic evidence and provenance
- Deleting workout history or `LevelUp*` tables when web logging goes away
- Extending Warm Concrete for the new skills shell

---

## 10. Suggested first working session

Agenda for the next joint pass (no code required until Phase 0 answers land):

1. Amend or approve §1 and §5 IA.
2. Fill the route matrix (every link in current `Nav.tsx` + nested routes).
3. Answer §8 questions 1–4.
4. If approved: open Phase 1 PR — freeze/remove Train from web nav + iOS CTA
   banner — before any Still redesign of the library.

---

## Revision log

| Date | Change |
|---|---|
| 2026-09-04 | Initial draft: keep Level Up web as skills/ranks/Plans; workouts iOS-only; revise full web retirement from mobile transition plan. |
