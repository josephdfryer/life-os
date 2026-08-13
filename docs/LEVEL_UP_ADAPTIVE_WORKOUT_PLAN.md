# Level Up Adaptive Workout Plan

Status: decision-complete implementation plan  
Primary owner surface: Life OS Companion for iPhone  
Supporting surface: Level Up web app

## Product outcome

Build the primary in-gym experience as a native **Workout** tab inside the iPhone Companion. Preserve Level Up's web app for program management, combines, ratings, history, and deeper analysis.

The workout experience must:

- Work offline with one-handed set logging, persistent timers, previous-set recall, PR/RANK/BALANCE feedback, and crash-safe replay.
- Combine direct Oura readiness data, HealthKit measurements, recent training load, pain flags, and FoodNoms nutrition totals.
- Suggest an adapted workout while preserving the original prescription and providing a one-tap override.
- Initially optimize the existing vertical-jump, explosiveness, and fat-loss program.
- Save completed workouts to Apple Health without inventing calories or biometric measurements.

This is wellness guidance, not medical diagnosis. Readiness may suggest a change but must never prevent the user from training.

## Existing foundation to preserve

- `apps/level-up` already owns programs, exercises, sessions, sets, body metrics, combines, ratings, and the pure TypeScript rating engine.
- The existing `Current Form` engine already accepts HRV deviation, sleep debt, acute-to-chronic workload, and pain inputs. It currently receives neutral defaults and should be wired to real data rather than replaced.
- The native Companion already owns device authentication, an encrypted SQLite outbox, HealthKit collection, background retries, and normalized device ingestion.
- Health metrics already map to daily Person `State` records with provenance Notes; workouts map to `Event` records rather than `Interaction` records.
- Level Up's verified-ceiling rule remains unchanged: ordinary training evidence can move a rating within its proven range, but only a completed combine can raise the verified ceiling.
- Food continues to be logged exclusively in FoodNoms. Life OS will consume FoodNoms-written Apple Health nutrition data and will not build another food logger.
- Preserve concurrent work under `apps/api/app/v1/health/` and consolidate it onto shared health commands rather than creating a third ingestion pipeline.

## Architecture

### Native and web responsibilities

The iPhone Companion becomes the primary gym surface:

- Readiness explanation and freshness.
- Original versus suggested session.
- Knee and lumbar flare controls with existing substitutions.
- Large weight, repetitions, and duration controls.
- Session and rest timers with haptics.
- Previous-set defaults and immediate locally available feedback.
- Offline queue state, retry, session completion, and force-quit recovery.

Level Up web remains the source for:

- Program and exercise management.
- Combines and verified ceilings.
- Rating detail, career history, body trends, and readiness trends.
- A web workout logger retained as a fallback rather than developed as a second equal native implementation.

The TypeScript Level Up engine remains authoritative. The server prepares a versioned session bundle containing exercises, prescriptions, substitutions, history, readiness inputs, and the recommended adjustment. Swift renders and logs that bundle; it does not independently reinterpret the readiness science.

### Oura connection

Add Oura as a first-class account connection through Life OS Home's unified Connections hub:

- Use Oura API V2 authorization-code OAuth with CSRF state validation.
- Request only the `daily` scope for the first release. Do not request raw heart-rate, workout, session, tag, email, personal, or SpO2 scopes until a demonstrated feature needs them.
- Encrypt access and refresh tokens using the repository's existing credential encryption and never return them through APIs or diagnostics.
- Store connection status, expiry, granted scopes, last successful sync, safe error code, and cursor in the existing `Connection` model with `kind=oura` and `provider=oura`.
- Import 35 calendar days once to establish baselines, then consume signed Oura webhooks and fetch only the changed document/date.
- Support reconnect, token refresh/rotation, revoked access, expired Oura membership, disconnect, and webhook replay.
- Oura remains authoritative for Oura Readiness, Sleep, and Activity scores and their contributors. HealthKit remains authoritative for non-Oura Apple Health measurements.

Normalize Oura daily values into the existing health taxonomy as Person `State` records. Create one provenance Note per Oura day containing bounded normalized values and source document identifiers, not raw sensor streams. Reprocessing a day replaces only that source's derived States.

### HealthKit and FoodNoms

Extend Companion's HealthKit connector to use anchored incremental queries and source-aware aggregation for:

- Dietary energy consumed, kcal.
- Protein, carbohydrates, total fat, and fiber, grams.
- Sleep duration and stages.
- Resting heart rate and HRV.
- Workouts, active energy, steps, and body weight already in scope where applicable.

For nutrition:

- Include only samples whose source bundle is FoodNoms in the FoodNoms aggregate.
- Upload one `nutrition.daily` record per local calendar day with totals, source bundle, observed time, and a completeness marker.
- Never upload food names, individual meals, notes, photos, or FoodNoms library contents.
- Recompute the current day after changes; stable source IDs make the server replacement idempotent.
- Nutrition informs fueling context and weekly insights. It does not independently lower readiness or reduce workout intensity in v1.

For health-source reconciliation:

- Never average or silently merge competing providers.
- Direct Oura owns Oura scores and contributors.
- HealthKit daily aggregates retain source provenance; a deterministic source-priority rule selects the readiness input and the UI names that source.
- Companion-created HealthKit workouts must reconcile to their originating Level Up session rather than create a second workout Event.

## Readiness and workout adaptation

### Inputs

Compute a readiness snapshot when the user opens Workout or explicitly refreshes it. Freeze the snapshot when the session starts.

Inputs are:

- HRV deviation from a rolling 28-day personal baseline, expressed in standard deviations.
- Resting-heart-rate deviation from its rolling 28-day baseline.
- Seven-day sleep debt against an initial default target of 8 hours per night; make the target user-configurable later without changing historical snapshots.
- Oura Readiness score and named contributors as corroborating, explainable evidence.
- Acute-to-chronic training-load ratio: seven-day load divided by the weekly equivalent of 28-day load.
- Training load per completed session: duration in minutes multiplied by session RPE.
- Current knee and lumbar flare flags.
- Data freshness and completeness for every input.

Missing data is neutral, not bad. A recommendation may be made with partial data only if the UI explicitly identifies what is missing. Oura scores never become the sole opaque decision rule.

### Recommendation bands

Keep the existing pure `Current Form` engine and add a pure prescription-adjustment layer with a version identifier. Initial bands are:

- **Full:** preserve the original prescription.
- **Adjust:** recommend approximately 20% fewer working sets and 5% lower working loads; preserve warm-up structure and exercise order.
- **Recover:** recommend approximately 40% fewer working sets, 10% lower working loads, omit explosive jump work, and apply existing joint-specific substitutions.

Rules:

- Round set counts to at least one working set for retained movements.
- Round loads to the user's configured plate increment.
- Never raise load or volume because readiness is high in v1.
- Pain-triggered substitutions take precedence over readiness volume changes.
- The UI must show the original and adjusted values, the material contributing signals, their timestamps/sources, and an explanation in plain language.
- The user can accept the suggestion, restore the original workout, or edit individual exercises before and during the session.
- Record the chosen prescription and whether it was suggested, overridden, or manually edited.

### Readiness provenance

Add a `LevelUpReadinessSnapshot` infrastructure record linked to the Level Up session. Store:

- Snapshot timestamp and local day.
- Engine and rule-set versions.
- Bounded normalized input values, freshness, and sources.
- Resulting form signal and recommendation band.
- Original and suggested prescription hashes.
- Explanation/reason codes.
- User choice and override timestamp.

Daily readiness remains derived and should not become a mutable Life OS primitive. The snapshot exists only to audit what advice was shown when a workout began.

## Public interfaces and persistence

### Device protocol

Extend device sources with `level_up` and add versioned normalized records:

- `nutrition.daily`
  - `day`, calories, protein, carbohydrates, fat, fiber, source bundle, completeness.
- `training.session.started`
  - stable client session ID, program/day IDs, readiness snapshot ID, chosen prescription, flare flags, start time.
- `training.set.logged`
  - stable client set ID, session ID, exercise ID/key, set index, reps/load/duration/bodyweight/RPE fields, performed time.
- `training.session.completed`
  - session ID, end time, session RPE, optional note, HealthKit workout UUID when available.

Every record retains the device protocol invariants: device ID, source, stable source ID, schema version, observed time, bounded normalized content, and per-item accepted/duplicate/retryable/rejected results.

### Workout APIs

Add authenticated device endpoints:

- `GET /v1/device/workout/today`
  - Returns the active program day, profile units, plate increment, prepared exercises, substitutions, recent set defaults, readiness snapshot, original prescription, suggested prescription, and freshness.
  - Accepts the requested program-day ID and current flare flags; defaults to the next scheduled active-program day.
- Existing `POST /v1/device/ingest`
  - Accepts the new training and nutrition records and dispatches them through shared domain commands.

Web server actions and device ingestion must call the same Level Up commands for session start, set log, and completion. Do not maintain separate behavioral rules for Swift and web.

### Level Up persistence

Add only infrastructure needed by the capability:

- `source` and stable `sourceId` on sessions and sets, unique within workspace/source, for replay safety.
- `sessionRpe` on completed sessions.
- A relation from session to `LevelUpReadinessSnapshot`.
- An optional canonical workout Event ID on the session for reconciliation.

Use client-generated stable IDs for native sessions and sets. Logging the same ID and payload is a duplicate success; the same ID with different content is a conflict requiring explicit correction rather than silent overwrite.

### HealthKit workout write-back

At completion, Companion writes an `HKWorkout` using the real start/end time and an appropriate strength-training activity type.

- Do not estimate active energy, distance, route, or heart-rate samples.
- Include a stable Level Up session identifier in permitted metadata.
- If HealthKit write permission is denied, the Life OS session still completes normally and exposes a repair action.
- When HealthKit ingestion later sees that workout, match it by metadata/session ID and update the existing Event rather than create another one.

## Delivery sequence

### 1. Shared domain and offline workout vertical slice

- Extract the existing Level Up session/set write logic into shared workspace-scoped commands.
- Add idempotent source IDs, session RPE, readiness snapshot storage, and workout Event reconciliation.
- Add the device contracts and `workout/today` response.
- Build the native Workout tab with encrypted cached session bundles, offline logging, timers, and restart recovery using synthetic neutral readiness.
- Preserve the current web behavior and verified-ceiling invariants.

### 2. HealthKit and FoodNoms

- Replace fixed recent-day queries with anchored per-type checkpoints.
- Add sleep and FoodNoms nutrition types with source-aware daily aggregation.
- Feed real HealthKit values into the readiness input assembler.
- Add HealthKit workout write-back and duplicate reconciliation.

### 3. Direct Oura

- Register the Oura OAuth application and callback URLs.
- Add Home connect/reconnect/disconnect UI, encrypted credential handling, 35-day backfill, webhooks, and safe status reporting.
- Add Oura daily State ingestion and source-priority readiness assembly.
- Shadow the computed recommendation against neutral/original sessions before allowing it to pre-adjust the UI.

### 4. Coaching and hardening

- Enable suggested prescriptions with one-tap override after shadow comparison.
- Add readiness and nutrition trends to Level Up web.
- Run real-gym, offline, battery, permission-revocation, and multi-workspace acceptance.
- Defer a live Apple Watch workout app until the iPhone flow has passed repeated real-gym use.

## Test plan and acceptance criteria

### Pure engine tests

- Baseline computation with insufficient history, missing days, zero variance, outliers, and timezone boundaries.
- Readiness thresholds at exact boundaries and deterministic versioned outputs.
- Stale Oura/HealthKit data, missing inputs, conflicting sources, and neutral fallback.
- Full/Adjust/Recover prescription math, load rounding, minimum sets, explosive-work removal, and pain substitution precedence.
- Nutrition never changes the recommendation band in v1.
- Combine ceilings remain unaffected by ordinary workout logging.

### API and data tests

- Oura OAuth state, reduced scopes, encrypted refresh, rotation, revoked access, expired membership, disconnect, and workspace isolation.
- Webhook signature/authenticity, retry, replay, out-of-order delivery, and changed-document fetching.
- Initial 35-day backfill pagination and idempotent replacement by source/day.
- Native session/set replay, conflicting payload hashes, partial batch failures, and cross-device collisions.
- Web and device commands produce identical canonical rows and GraphEvents.
- FoodNoms source filtering, daily aggregation, edited/deleted samples, authorization changes, and no meal-level content in API requests or logs.

### Native acceptance

- Start and complete a session in airplane mode; force quit after several sets; reopen with timers, selection, and unsynced sets intact; reconnect and drain without duplicates.
- Deny, revoke, and restore HealthKit read/write permissions without losing the Life OS workout.
- Verify completed workout write-back and read-back reconciliation creates one Event.
- Verify accessible one-handed controls, Dynamic Type, VoiceOver labels, haptics, backgrounded rest timers, and no blocking network spinner between a set and rest.
- Verify no raw Oura streams, granular HealthKit samples, FoodNoms meals, local paths, secrets, or private diagnostics leave their approved boundary.

### Rollout gates

- Run three real gym sessions with the native offline logger before enabling adaptation.
- Run readiness in shadow mode for seven days, recording its recommendation without changing the workout, then inspect explanations and false reductions.
- Enable suggestions only after shadow review; retain one-tap override and versioned snapshots.
- Signed device testing remains blocked until Apple Developer Program activation, but server, engine, contracts, tests, and unsigned builds can proceed.
- Do not retire the Level Up web logger, Health Auto Export, or any legacy collector until the replacement has parity evidence and rollback instructions.

## Explicit defaults and deferred work

- Audience: Joseph first, with workspace and multi-device isolation preserved for future customers.
- Primary surface: native iPhone Companion; Level Up web is the analysis/control surface.
- Initial program: existing vertical jump, explosiveness, and fat-loss program.
- Adaptation authority: suggestion plus one-tap override; never mandatory.
- Nutrition source: FoodNoms through Apple Health; no new meal-entry UI.
- Oura integration: direct OAuth because Apple Health does not expose Oura's proprietary Readiness/Sleep/Activity scores.
- Apple Watch: deferred; iPhone writes completed workouts to HealthKit in v1.
- No new Life OS primitive. Health measurements use State/Note provenance, workouts use Event, and readiness snapshots are Level Up infrastructure.
- No automatic workout increases, medical claims, meal-level cloud storage, raw sensor upload, or AI-generated training decisions in the first release.

## External references

- [Oura API V2](https://cloud.ouraring.com/v2/docs)
- [Oura API overview and application limits](https://cloud.ouraring.com/docs/)
- [Oura Apple Health integration](https://support.ouraring.com/hc/en-us/articles/360025438734-Apple-Health-Integration)
- [FoodNoms and Apple Health](https://foodnoms.com/help/about-foodnoms/)
- [Apple HealthKit nutrition identifiers](https://developer.apple.com/documentation/healthkit/nutrition-type-identifiers)
