# Level Up Mobile Transition Plan

Status: implementation started; first native shell built; web retirement not started

Date: 2026-08-20

Primary product: a dedicated native Level Up app, beginning with iPhone

First complete domain: fitness and health

This plan supersedes the product-surface decisions in
`LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md` and `IOS_PLATFORM_PLAN.md` that keep a Level
Up web control surface or place Workout primarily inside the LifeOS app. Their
science, provenance, offline, HealthKit, Oura, FoodNoms, and acceptance rules
remain in force unless this document explicitly changes them.

The complete standalone account, onboarding, AI program-design, daily workout,
exercise-detail, and progress flows are specified in
`LEVEL_UP_NATIVE_PRODUCT_FLOWS.md`.

## 1. Decision

Level Up becomes a **mobile-only product**, beginning with a dedicated native
iPhone app. It is not a fitness app with unrelated features bolted on later. It
is the LifeOS lens for deliberate growth across any learnable capability.

Standalone describes the product experience, not its data architecture. Every
new authenticated Level Up user receives a private LifeOS workspace/graph and
canonical self Person automatically behind the scenes. An existing authenticated
user resolves to the existing graph automatically. There is no user-facing
“connect the graph” step and no separate Level Up data silo; provider permissions
and cross-domain context remain independently consented and provenance-aware.

Fitness and health ship first because they already have real evidence, a rating
engine, workout commands, HealthKit capture, Oura readiness, programs, combines,
and a clear daily loop. They are the first domain, not the product boundary.

The authenticated Next.js Level Up interface will be retired after the native
app reaches measured parity. The server, shared TypeScript domain package,
database tables, migrations, and API remain as hidden infrastructure. “No web
app” means no browser-based Level Up product surface; it does not mean putting
authoritative science, synchronization, secrets, or shared graph writes on the
phone.

## 2. Product promise

Level Up helps a person become better at things they care about by closing one
honest loop:

1. Choose who you are trying to become.
2. Select a skill or capability to develop.
3. Get a small, appropriate next action.
4. Practice or perform it in the real world.
5. Capture evidence with as little friction as possible.
6. See progress, uncertainty, consistency, and what to do next.

The product should feel simple even when the system behind it is not. The main
surface shows the next useful action and the evidence that progress is real.
Connections, source reconciliation, provenance, sync conflicts, confidence
math, background ingestion, and model versions live behind progressive detail
or Settings.

### Honest progression

The existing distinction becomes a product-wide rule:

- **Capability is domain-specific and evidence-based.** A strength rank, Spanish
  speaking level, and piano grade cannot be calculated by one universal formula.
- **Momentum is cross-domain.** Practice frequency, follow-through, streaks, and
  time invested can support a common career/journey layer.
- **Confidence is visible when it matters.** Sparse or self-reported evidence
  must not look as certain as a verified assessment.
- **No fake XP.** The product may celebrate consistency, but tapping buttons or
  logging weak evidence must never masquerade as increased capability.

Fitness preserves the current verified-ceiling rule: training may move current
form within a proven range, while only a completed combine raises the verified
ceiling.

## 3. Product structure

The initial iPhone navigation should be broad enough for the eventual product
while making fitness excellent now:

- **Today** — readiness, the most useful next action, active session, and a small
  number of relevant prompts.
- **Skills** — skill domains and tracks. Fitness is the only fully enabled domain
  at launch; future domains can appear only when they have a real evidence model
  and usable loop.
- **Journey** — capability changes, milestones, combines or assessments, badges,
  consistency, and reflections over time.
- **You** — identity, goals/builds, preferences, connections, privacy, sync health,
  and advanced diagnostics.

Inside Fitness, the first release includes:

- Today's workout and Full/Adjust/Recover recommendation.
- Offline, one-handed set logging with previous-set defaults.
- Session/rest timers, haptics, Live Activity, and force-quit recovery.
- Immediate PR, RANK, and BALANCE feedback where the science supports it.
- Body measurements and source-aware health context.
- Combines and the player card.
- Builds, career history, badges, and readiness explanation.
- HealthKit workout write-back without invented calories or measurements.

Program editing can initially be a native settings-style flow. There should be
no retained browser-only admin surface just because a table is easier to build
on the web.

### Liftoff reference review

The Liftoff screenshots reviewed on 2026-08-20 contain several useful product
patterns, but their visual tone is not the Level Up direction.

Adopt the underlying ideas:

- Make every exercise a first-class destination rather than only a row inside a
  workout.
- Put movement guidance, current rank or honest “unranked” state, progress to the
  next rank, statistics, personal records, and history in one exercise detail.
- Show an exercise's picture everywhere it helps recognition: the library,
  workout preview, active session, substitutions, and exercise detail.
- Keep previous values beside the current set and make completion a large,
  one-handed action.
- Keep the workout and rest timers persistent and directly adjustable.
- Summarize the muscles trained after a workout as context, not as a claim that
  muscle groups themselves gained capability.
- Let a user browse and search the complete exercise library when building or
  editing a workout.

Do not carry over:

- Cartoon avatars, emoji-heavy coaching, bright arcade colors, ornamental rank
  crests, currencies, stores, loot, or multiple competing progress systems.
- Global leaderboards or “world position.” Level Up compares evidence to a
  defensible reference population, not the user to an opaque app community.
- Muscle-group ranks derived from merely completing a set of exercises.
- Social posting, feeds, leagues, reactions, or friends in the first product.
- Tutorial modals that interrupt the workout. Use restrained inline guidance,
  empty states, and optional detail instead.
- Generated workouts that hide why the movements or loads were selected.

The native expression should follow Still: quiet hierarchy, clear numbers,
warm restrained color, semantic rank typography, and motion only when it
improves comprehension or confirms an action.

### Exercise library and individual rank

Build the exercise library as a product foundation, not a one-off list for the
current three-day program.

The native library needs:

- Search, favorites/recent, muscle group, movement pattern, equipment, modality,
  joint-load, and rankability filters.
- Exercise name plus aliases, setup, execution cues, common mistakes, range of
  motion, equipment, primary/secondary muscles, substitutions, default rest,
  and measurement protocol.
- A clear distinction between a global catalog definition and a workspace's
  program configuration. Personal targets, substitutions, notes, and history
  must not mutate the shared definition.
- Versioned content and source/license provenance for instructions, norms, and
  art.
- Offline availability for every exercise in the active program and recently
  viewed library entries.

The exercise-detail hierarchy should be:

1. Name, static movement image, and short form cues.
2. Current exercise rank when defensible; otherwise an explicit Balance-only or
   unranked explanation.
3. The next rank threshold expressed as a real performance target, such as a
   bodyweight-relative estimated 1RM—not a generic XP bar.
4. Confidence, evidence source, freshness, and whether the result is training
   evidence or combine-verified.
5. PRs and a small number of useful trends.
6. Session-grouped history and the current-program prescription.

Per-set ranks already exist for well-normed movements. Before promoting one to
the exercise's persistent headline rank, define and test a canonical derivation
from valid performances, bodyweight, freshness, and verified ceilings. Do not
silently equate “latest set,” “best-ever set,” and “current capability.” Exercises
without defensible population norms continue to show Balance or progress metrics
without a rank.

### Exercise art

The repository already vendors open exercise illustrations from Everkinetic
under CC BY-SA 4.0. There are two SVG frames for 13 movements, with explicit
`exact`, `close`, or `substitute` fidelity and attribution. Seven mappings are
exact, three are close, and three are substitute illustrations. The current
program still lacks art for jumps, carries, hip thrusts, planks other than side
plank, and dead bugs.

For the first native release:

- Ship one static frame per exercise from a native asset bundle.
- Show only exact or clearly labeled close art in instructional contexts.
- Do not use substitute art as if it teaches the prescribed movement; show the
  fidelity note or an honest no-image state.
- Keep attribution and share-alike metadata in the app's acknowledgements and
  in the asset manifest.
- Expand coverage systematically, prioritizing every movement in the active
  program before broad catalog quantity.

The existing web component already alternates the two Everkinetic frames as a
simple stretch/contract animation. Preserve both frames during migration, but
defer animation in native until the static library, accessibility labels, form
cues, and licensing audit are complete. Later animation should teach the
movement—not merely decorate the screen.

## 4. LifeOS model

This direction does **not** justify a ninth primitive.

A skill journey is a Level Up projection over the existing graph:

| Meaning in Level Up | LifeOS representation |
|---|---|
| The person I want to become or outcome I want | `Plan` |
| A practice, workout, lesson, test, or performance | `Event` |
| A timestamped observed capability or condition | `State` |
| A reflection, coach note, rubric, or raw observation | `Note` |
| A coach, partner, team, or class | `Person` / `Group` plus truthful `Interaction` edges |
| Where practice happened or what was used | `Place` / `Item` |

Level Up may maintain infrastructure records for skill definitions, rubrics,
domain engines, assessment protocols, source evidence, and UI configuration.
Those records support the lens; they do not become life primitives by default.
No generalized skill schema should be added until at least one non-fitness domain
has been designed from real use and pressure-tested against this mapping.

## 5. Technical architecture

### Native product

Add a dedicated `LevelUp iOS` target to the existing Xcode project and put the
screens in `apps/companion/Packages/LevelUpFeature`. Keep the app target thin.
The feature package should depend on protocols and models from the shared
companion core, not on app globals.

The dedicated shell is preferable to permanently burying Level Up in the
LifeOS collector because Level Up now has its own broad daily loop, navigation,
notification strategy, identity, and future distribution path. Shared packages
still prevent duplicated auth, networking, offline storage, and design work.

Grow `LifeOSCompanionCore` toward the already planned `LifeOSKit` responsibilities:

- Device authorization and Keychain credential storage.
- Versioned API client and typed contracts.
- Encrypted durable observation and command queues.
- Local cache for session bundles, journeys, and pending evidence.
- Connectivity, conflict, freshness, and sync-health state.
- Still design tokens, typography, accessibility helpers, and telemetry policy.

Use GRDB for Level Up's local command/cache store unless a focused prototype
proves SwiftData can meet the ordered replay, idempotency, conflict, migration,
and force-quit recovery tests. The existing encrypted outbox is a foundation,
not yet the complete workout command store.

### Hidden service layer

Keep these server-side:

- `packages/level-up`: authoritative rating, readiness, workout, and future
  domain-engine behavior.
- `apps/api`: device-authenticated reads and idempotent commands.
- `packages/contracts`: versioned request and response contracts shared by the
  API and native fixtures.
- `packages/db`: canonical records, graph linkage, provenance, migrations, and
  workspace isolation.
- Connection secrets and provider sync for Oura or future evidence sources.

The phone renders versioned decisions and records user choices. It may compute
clearly marked optimistic feedback for responsiveness, but the shared server
engine produces the canonical result. Any optimistic implementation needs
golden fixtures proving parity and a reconciliation state when versions differ.

### Current foundation already present

Verified on 2026-08-20:

- `@life-os/level-up` already contains the extracted engine and shared workout
  commands.
- Device-authenticated endpoints already exist for today's workout, session
  start/completion, set logging, and body metrics under
  `apps/api/app/v1/device/workout`.
- Those commands already support stable source IDs and idempotent replay.
- The native LifeOS app already has device authorization, Keychain storage, an
  encrypted outbox, HealthKit collection, background retries, and physical-device
  signing history.
- A dedicated `Level Up iOS` target and local `LevelUpFeature` Swift package now
  compile for the simulator and for a signed generic iOS device build.
- The native app has its own `levelup://auth/callback` device-authorization
  callback and isolated Keychain service. The Home authorization screen and
  shared callback allowlist recognize it without adding Google OAuth to native.
- The first Today screen reads the canonical workout/readiness bundle, applies
  knee and lumbar flare substitutions, renders the planned exercise list, and
  can create an idempotent server-backed workout session.
- Typed native commands exist for set logging and workout completion, but their
  one-handed session UI, persistent timers, local queue, and recovery behavior
  are not implemented yet.
- The current native workout API is only part of web parity; card, onboarding,
  profile/builds, combines, career/badges, program management, and full history
  still need mobile contracts and endpoints.

## 6. Web-to-native capability map

| Current web surface | Native destination | Service work before cutover |
|---|---|---|
| `/start` and login | Native onboarding and device authorization | Profile read/write contracts; safe first-workspace setup |
| `/` player card | Today summary and Fitness card | Card/readiness endpoint with engine and evidence versions |
| `/train` | Fitness workout session | Existing endpoints plus durable native queue and recovery |
| `/combine` | Fitness assessment flow | Combine catalog, draft, submission, reveal, and conflict APIs |
| `/builds` | You > Goals/Builds | Build list, target, and primary-build commands |
| `/career`, `/badges` | Journey | Keyset-paginated history and badge endpoints |
| `/body` | Fitness > Body | Existing write endpoint plus history and source-aware reads |
| Server actions | Shared domain commands behind `apps/api` | Remove any remaining rules that exist only in Next.js |
| Web navigation/PWA shell | Native tabs, deep links, widgets, App Intents | Universal Links and notification routing |

Every row needs an explicit parity test. “Available through the database” does
not count as mobile parity.

## 7. Delivery sequence

### Phase 0 — Freeze and baseline

- Stop adding new product capability only to `apps/level-up`; urgent fixes are
  allowed, but every new behavior belongs in `packages/level-up` and `apps/api`.
- Capture a page/action/data parity inventory and golden screenshots of the
  existing flows for behavioral reference, not visual copying.
- Run current engine, workout, API integration, type, and build checks to create
  the baseline.
- Record current production routes, project configuration, DNS, and rollback
  steps. Do not delete or modify user data.

Exit gate: every web behavior is classified as migrate, intentionally replace,
or explicitly retire.

### Phase 1 — Native foundation and shell

- Add `LevelUpFeature` Swift package and a dedicated `LevelUp iOS` target with
  its own bundle ID, icons, URL scheme, Keychain namespace, and entitlements.
- Reuse the shared device authorization flow rather than adding Google OAuth to
  the app.
- Implement the four-tab shell, local database migrations, encrypted command
  queue, API fixtures, offline/freshness states, and Still light/dark themes.
- Keep advanced sync and evidence details behind a disclosure in You/Settings.

Exit gate: a signed build installs on the physical iPhone, authenticates to the
correct workspace, survives credential refresh, and can operate from cached data.

### Phase 2 — Fitness vertical slice

- Ship Today and the complete native workout loop using the existing workout
  endpoints.
- Add native command replay, source-ID conflicts, rest/session timers, haptics,
  Live Activity, previous-set defaults, and local immediate feedback.
- Complete HealthKit workout write-back and reconciliation to exactly one LifeOS
  `Event`.
- Preserve readiness as a suggestion with an explanation and one-tap override.
- Bundle static art for every movement in the active program or render an honest
  no-image state; do not block a workout on remote media.

Exit gate: at least three real gym sessions pass the airplane-mode, force-quit,
reopen, reconnect, and no-duplicate acceptance test.

### Phase 3 — Full fitness parity

- Add the missing APIs and native flows for onboarding/profile, card, body
  history, combines, builds, programs, career, badges, and history.
- Ship the searchable exercise library and exercise detail with form cues,
  individual rank/Balance, next evidence-based threshold, PRs, trends, and
  session history.
- Define the canonical current-exercise-rank derivation and add boundary,
  freshness, bodyweight-change, sparse-evidence, and unranked-movement tests.
- Move any remaining behavioral rule out of Next.js server actions into the
  shared domain package.
- Run Oura readiness in shadow mode before enabling adjustments, following the
  existing adaptive-workout gates.
- Add accessibility, Dynamic Type, VoiceOver, reduced-motion, permission
  revocation, and multi-workspace acceptance.

Exit gate: the parity matrix has no browser-only required task, canonical rows
match between old web and native fixtures, and the web app has received no
unique writes for an agreed observation window.

### Phase 4 — General Level Up foundation

- Rename fitness-specific top-level concepts in the native shell where they
  would block additional domains, without weakening the fitness vocabulary
  inside Fitness.
- Implement a domain-adapter boundary for next action, evidence capture,
  assessment, progress display, and journey events.
- Design one real second-domain pilot from the user's life. Pressure-test it
  against the eight primitives before proposing schema.
- Keep the second domain private/experimental until its evidence and feedback
  loop is as honest as the fitness loop.

Exit gate: the shell can host a second domain without fitness conditionals in
shared navigation and without inventing a universal capability score.

### Phase 5 — Web cutover and retirement

- Announce the cutover in the old web UI and deep-link supported routes into the
  iOS app during a short rollback window.
- Make the authenticated web UI read-only, then disable its write paths.
- Remove Level Up from shared web app navigation and from deployment/smoke
  configuration.
- Remove `apps/level-up` only after verifying all reusable engine, assets,
  contracts, and commands live outside it.
- Retire the Vercel `level-up` project and authenticated domain last. A minimal
  public install/information page may live on the main LifeOS site, but it must
  not become a second Level Up application.
- Preserve all `LevelUp*` tables, migrations, provenance, API behavior needed by
  native, and backups. Web retirement is never a data reset.

Exit gate: production navigation has no web Level Up product, native deep links
and API telemetry are healthy, backups have been verified, and documented
rollback remains possible for the agreed window.

## 8. Retirement checklist

Do not delete `apps/level-up` or decommission its deployment until all are true:

- Native onboarding works for a fresh install and an existing workspace.
- All web-created historical data appears correctly in native views.
- Workout logging works offline and recovers after force quit without duplicates.
- Combines preserve verified ceilings and reveal the same canonical results.
- Profile, builds, programs, body history, career, and badges have native paths.
- Settings exposes provider health, privacy, sync errors, repair, and sign out.
- Universal Links, notification routing, and required support/install pages work.
- API authorization, workspace isolation, idempotency, pagination, and conflict
  tests pass.
- HealthKit denial/revocation and Oura disconnection degrade safely.
- The native app has completed real-device use and a rollback rehearsal.
- A data backup is verified immediately before final deployment retirement.

If any item fails, keep the web deployment available as a rollback surface but
do not resume feature development there.

## 9. What is deliberately deferred

- Android, until the iOS product loop is stable.
- Apple Watch workout capture, until repeated iPhone gym use proves the workflow.
- A generalized skill database schema, until a real second domain earns it.
- Social leaderboards, public profiles, competitive XP, or cross-person ranking.
- AI-generated training or skill prescriptions without deterministic evidence,
  provenance, explanation, and user control.
- App Store commercialization decisions; the architecture should not block them,
  but Joseph-first use remains the immediate scope.

## 10. First implementation slice after approval

The first executable slice should be narrow and reversible:

1. Add the `LevelUpFeature` package and dedicated iOS target.
2. Reuse device authorization and add a typed native client for the existing
   workout-today/session/set/body endpoints.
3. Persist one cached workout bundle and queued session locally.
4. Render Today plus a minimal start/log/complete workout loop.
5. Verify signed physical-device, airplane-mode, force-quit, replay, and
   workspace-isolation behavior.

Do not remove the web app during this slice. Removal starts only after the Phase
3 parity gate is evidenced.

### Progress on this slice — 2026-08-20

Completed:

- Dedicated native target, four-tab product shell, Still visual foundation,
  isolated Keychain credentials, and Level Up device callback.
- Typed decoding for today's canonical workout/readiness response and typed
  start, log-set, and complete-session commands.
- Today/readiness/flare/workout preview plus server-backed session start.
- Swift fixture tests, device-callback authorization tests, Home type-check,
  signed simulator launch, and signed generic-iOS build.

Still required before this slice reaches its exit gate:

- A real exercise session UI for set entry and completion.
- Encrypted local workout cache and ordered command queue with idempotent replay.
- Static exercise art in a native asset bundle, starting with exact active-program
  mappings and honest no-image states.
- Physical-iPhone authentication, workspace, offline, force-quit, reconnect, and
  no-duplicate validation. The currently paired iPhone was unavailable during
  this implementation pass, so a successful signed build is not an install/use
  claim.
