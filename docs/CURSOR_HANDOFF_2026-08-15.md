# Cursor Handoff — Life OS + Persons iPhone Apps

**Date:** 2026-08-15 (America/Los_Angeles)  
**From:** Codex  
**To:** Cursor  
**Repository:** `/Users/josephfryer/life-os`  
**Branch:** `master`  
**HEAD when written:** `6a9dc8eb41fb7bc7784fd78987d2e0ffd940c7e0`

Hi Cursor — Codex here. Welcome to Joseph's Life OS. There is a lot of useful work in flight, but it crosses native iOS, Vercel, Turso, device authorization, and concurrent web-app changes, so please read this whole document before editing. The most important rule is: **preserve the current dirty worktree and the three recent Inbox commits. Do not reset, clean, or broadly rewrite anything.**

## Executive snapshot

Joseph wants two genuinely separate iPhone apps:

1. **Life OS** — the private device collector that syncs normalized HealthKit data, location data, and photo metadata into his Life OS graph. Raw health samples and photo bytes should remain local by default.
2. **Persons** — the standalone personal CRM that he eventually wants to sell. It must not be presented as merely a tab or skin inside the private collector.

Both native targets now exist in the Xcode project. The latest Life OS collector build is signed, installed, and launched on Joseph's physical iPhone. The production device authorization flow is working far enough that two device records now exist in Turso, including a newer `Persons on iPhone` record. Health ingestion is reaching production. The latest count observed was seven accepted HealthKit ingest items.

The takeover is **not yet complete** because these points still need live verification:

- Heartbeats were returning HTTP 400, and `DeviceSource` was still empty.
- The newly broadened HealthKit build has not been proven to contain sleep and dietary/nutrition keys in production. A seventh accepted health item appeared, but its payload still needs inspection.
- The post-deploy fixes for concurrent sync and duplicate ingestion have not been exercised and confirmed from a fresh phone sync.
- Location and photo-metadata ingestion have not yet been proven end to end from the current installed build.
- Persons authorization exists, but the saleable CRM's real People-loading experience still needs device verification.

## Read this before doing anything

Run the standard catch-up command from the repo root:

```bash
npm run agent:start -- --agent cursor
```

If the script does not recognize `cursor`, use the closest supported agent label and record that fact in the handoff. Then read:

- `AGENTS.md`
- `docs/MANIFESTO.md`
- `docs/LIFE_OS_VISION.md`
- `docs/AGENT_SYNC.md`
- `apps/persons/AGENTS.md` before editing Persons
- `docs/STILL_DESIGN_SYSTEM.md` before changing UI
- this document
- `docs/CLAUDE_HANDOFF_INBOX_2026-08-15.md` — Claude's handoff for the concurrent Inbox/review-spine
  track referenced throughout this document. It explains what those commits did and what is still
  open there; read it before touching `packages/domain`, `apps/home`, or `apps/api`.

Data safety is non-negotiable. Do not reset, truncate, bulk-delete, reseed, or force-push any core Life OS data. The current local `.env` files can point at the production Turso database even during local auth bypass.

## Current Git and concurrency state

The current branch is `master`, with HEAD and `origin/master` observed at:

```text
6a9dc8eb41fb7bc7784fd78987d2e0ffd940c7e0
```

Recent commits from concurrent work are legitimate and must remain intact:

```text
6a9dc8e feat(inbox): resolve a place once, not once per visit
54279a8 fix(inbox): confidence is stored on two scales, so state which one
a0bbfdf fix(inbox): stop canonical fetch deleting queues
```

The worktree was intentionally left dirty. Do not use `git reset --hard`, `git clean`, `git checkout --`, broad formatter rewrites, or any operation that discards changes. At handoff time the native/device worktree contained:

```text
 M apps/api/app/v1/device/heartbeat/route.ts
 M apps/api/lib/device-ingest.ts
 M apps/companion/Config/iOS-Info.plist
 M apps/companion/LifeOSCompanion.xcodeproj/project.pbxproj
 M apps/companion/LifeOSCompanionIOS/HealthConnector.swift
 M apps/companion/LifeOSCompanionIOS/IOSCompanionModel.swift
 M apps/companion/LifeOSCompanionIOS/IOSDashboard.swift
 M apps/companion/LifeOSCompanionIOS/LocationConnector.swift
 M apps/companion/README.md
 M apps/home/app/api/device/authorize/route.ts
 M apps/home/app/device/authorize/page.tsx
 M docs/COMPANION_ARCHITECTURE.md
 M docs/IOS_PLATFORM_PLAN.md
 M docs/PERSONS_ARCHITECTURE.md
 M packages/access/device.ts
 M packages/access/tests/device.test.ts
 M packages/contracts/tests/device.test.ts
?? apps/api/app/v1/device/auth/authorize/
?? apps/companion/Config/Persons-iOS-Info.plist
?? apps/companion/Config/Persons-iOS.entitlements
?? apps/companion/LifeOSCompanionIOS/PhotoConnector.swift
?? apps/companion/PersonsIOS/
?? packages/db/turso-migrate-device-companion.ts
?? docs/CURSOR_HANDOFF_2026-08-15.md
```

One subtle concurrency issue: `packages/contracts/index.ts` is clean because commit `6a9dc8e` included the new broad-health contract change while also committing unrelated Inbox work. The corresponding contract test is still dirty. In other words, the device slice currently spans both committed and uncommitted state. Inspect history and diffs before making commit slices; do not assume every device change is uncommitted.

Also preserve the existing unrelated `accuracyConfidence` work in `apps/api/lib/device-ingest.ts`. It was already present in the dirty file and is not part of the HealthKit change described here.

## What is live in production

### API

- Production deployment: `dpl_J9M8ep8JMiAqmA7fuT5mxLKERRZ9`
- Status observed: Ready
- Alias: `https://api.lacollecteur.com`
- Created at approximately 13:53 PDT
- Contains the broad health contract/server changes, device authorization endpoint, ingest duplicate handling, and heartbeat validation logging.

An earlier API authorization deployment, `dpl_H4j56JLeDwvR9g2FXfmy9J9dV6YU`, was superseded by the current API deployment.

### Home

- Production deployment: `dpl_2BMxZwPfz5qegHzvqGT5h34ZmiZt`
- Status observed: Ready
- Alias: `https://home.lacollecteur.com`
- Created at approximately 13:35 PDT
- Contains the Home-side device authorization proxy and authorization-page updates.

### Vercel project-link hygiene

After deploying API and Home, the repo-root Vercel link was restored to the Persons project. `vercel.json` again contained the Persons filter and `.vercel/project.json` pointed at Persons. There was no residual diff from that relinking step.

Do not deploy from the repo root without first checking which Vercel project is linked. This monorepo has multiple production apps and it is easy to deploy the correct code to the wrong project.

## Production database and migration state

The additive device-companion migration was applied to the Turso database named `persons`.

Existing Prisma migration:

```text
packages/db/prisma/migrations/20260811190000_device_companion_foundation/migration.sql
```

New idempotent Turso runner, currently untracked:

```text
packages/db/turso-migrate-device-companion.ts
```

The following tables were confirmed present:

- `Device`
- `DeviceSource`
- `DeviceCredential`
- `DeviceAuthorization`
- `DeviceIngestItem`

Before applying the migration, a full local Turso snapshot was created at:

```text
archive/db-snapshots/persons-pre-device-20260815-1345.db
archive/db-snapshots/persons-pre-device-20260815-1345.db-wal
archive/db-snapshots/persons-pre-device-20260815-1345.db-info
```

This backup is ignored/local and is not committed. It was approximately 58 MB, passed SQLite integrity checking, and contained these pre-migration core counts:

```text
Person       7376
Interaction  7455
```

After migration, `foreign_key_check` was clean and core counts were unchanged. The migration runner was tested twice locally to confirm idempotence. `npm run check:migrations` passed with 36/36 Turso scripts paired, 58 migrations, and 754 statements.

Do not restore the snapshot merely because a verification query fails. The migration is additive. Restoration is a disaster-recovery action and would require proving actual corruption and following the repository's data-safety process.

## Physical iPhone state

Device used for signed builds:

```text
Name:      Joseph's iPhone
Device ID: 50F85B7F-2FA2-5B55-ABDA-1279F934D999
Model:     iPhone 16 Pro
```

Life OS bundle identifier:

```text
com.lacollecteur.lifeos.companion.ios
```

Persons bundle identifier:

```text
com.lacollecteur.persons.ios
```

The latest signed Life OS build was installed and launched at approximately 13:55 PDT after the broad HealthKit changes.

Successful build command:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/companion/LifeOSCompanion.xcodeproj \
  -scheme 'Life OS Companion iOS' \
  -configuration Debug \
  -destination 'id=50F85B7F-2FA2-5B55-ABDA-1279F934D999' \
  -allowProvisioningUpdates build
```

Successful install and launch commands:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl device install app \
  --device 50F85B7F-2FA2-5B55-ABDA-1279F934D999 \
  '/Users/josephfryer/Library/Developer/Xcode/DerivedData/LifeOSCompanion-fapejkvqrnoaflcinqyoufwgoows/Build/Products/Debug-iphoneos/Life OS Companion.app'

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl device process launch \
  --device 50F85B7F-2FA2-5B55-ABDA-1279F934D999 \
  com.lacollecteur.lifeos.companion.ios
```

Do not assume the DerivedData path remains valid after Xcode rebuilds; locate the new `.app` if necessary.

## Production data actually observed

Two device records were seen in production:

```text
cmsuv8ltw000004l4v0gyv1ni  ios  Persons on iPhone  0.1.0  created 2026-08-15 21:06:10  lastSeen 21:06:58
cmsuufg7p000104jm68e5hr8s  ios  iPhone             0.1.0  created 2026-08-15 20:43:30  lastSeen 20:58:45
```

This is evidence that both authorization paths have reached the backend far enough to create device records. It is not yet evidence that both apps' complete user experiences work.

Seven accepted `healthkit` `DeviceIngestItem` rows were observed. Before the broad build, six were understood to represent three daily health summaries and three workouts. A seventh item appeared after the newer build/permission flow. **Do not claim sleep or nutrition sync is working until you inspect that newest Note and see the relevant keys.**

Earlier daily summaries contained keys such as:

- step count
- active energy
- resting energy
- Apple exercise time
- flights climbed
- walking/running distance
- resting heart rate
- heart-rate variability

`DeviceSource` returned no data rows at the last check. That aligns with heartbeats still failing validation.

## What changed in the in-flight device slice

### Broad HealthKit collection

`apps/companion/LifeOSCompanionIOS/HealthConnector.swift`

- Expanded collection from a fixed eight-metric list to standard HealthKit quantity and category identifiers available on the installed OS.
- Computes daily sums or averages in preferred units.
- Includes category counts, category duration/minutes, and category value totals where applicable.
- Includes sleep-stage hours and workouts.
- Uses content-hashed daily source IDs so materially changed daily aggregates can be ingested without blindly duplicating identical summaries.
- Registers observer/background delivery behavior.
- Leaves raw granular samples local; the server receives normalized summaries.

Important limitations and correctness questions:

- The current historical window is bounded to today plus the prior two calendar days. This is broad by type, not a complete lifetime backfill.
- It covers standard quantity/category types supported by the OS, not every possible HealthKit object. Clinical records need the separate Health Records capability; ECG waveforms and workout routes are not included.
- Sleep aggregation currently sums samples/stages and may double-count overlapping records from multiple sources. Verify against Health.app, then consider source precedence or interval unioning.
- Generic category summaries are intentionally lossy (`_count`, `_minutes`, `_value_total`). Preserve provenance if the model evolves.
- Apple still controls access per Health permission. The user must choose Turn On All/Allow for all desired read types. An unavailable or denied type cannot be synced by code.

### Sync UX and serialization

`apps/companion/LifeOSCompanionIOS/IOSCompanionModel.swift`

- Added serialized sync behavior and an `isSyncing` guard.
- Added visible `syncMessage` progress and result status.
- Collects HealthKit and photo metadata, batches uploads, and loops through up to five scheduler batches.
- Separates heartbeat errors from primary sync result messaging.

`apps/companion/LifeOSCompanionIOS/IOSDashboard.swift`

- Displays a progress spinner and status/result text so Sync Now no longer appears to do nothing.
- Updates health copy to describe broader collection.
- Uses the Still light visual direction to avoid white text on a light background.

One concurrency edge remains worth examining: an observer-triggered sync that arrives while `isSyncing` is true can be skipped. Confirm a later observer event or scheduled sync still catches the changed aggregate.

### Photo metadata

`apps/companion/LifeOSCompanionIOS/PhotoConnector.swift`

- New connector intended to sync metadata only, not photo bytes.
- New-only behavior is the current privacy-preserving default.
- Needs an end-to-end production proof from the installed app.

### Location

`apps/companion/LifeOSCompanionIOS/LocationConnector.swift`

- Contains the current location connector changes.
- Needs a real permission/background-event/ingest verification from the phone.

### API ingest and contracts

`packages/contracts/index.ts`

- Health metrics now accept dynamic HealthKit keys.
- Units are optional strings up to 64 characters.
- A health record can contain up to 512 metric entries.

`packages/contracts/tests/device.test.ts`

- Adds/updates test coverage for broader metric keys and units.
- The test file is still dirty even though the source contract landed inside concurrent commit `6a9dc8e`.

`apps/api/lib/device-ingest.ts`

- Removed rejection against a fixed server-side health taxonomy.
- Persists unit metadata.
- Treats libSQL's `DriverAdapterError` unique-constraint shape as a duplicate for `DeviceIngestItem` rather than surfacing an ingest failure.
- Contains unrelated concurrent `accuracyConfidence` work that must be preserved.

### Authorization and heartbeat

`apps/api/app/v1/device/auth/authorize/route.ts`

- New canonical API authorization endpoint.

`apps/home/app/api/device/authorize/route.ts`

- Home now proxies the device authorization flow to the canonical API, because the Home deployment did not own the required device tables.

`packages/access/device.ts`

- Exact redirect allowlist includes both Life OS and Persons native callback URLs.

`apps/api/app/v1/device/heartbeat/route.ts`

- Logs safe structured Zod validation issue paths, codes, and messages on HTTP 400 responses.
- This was deployed specifically to make the remaining heartbeat failure diagnosable without logging credentials.

## Verification completed

The following succeeded during this work:

- Generic iOS build with `CODE_SIGNING_ALLOWED=NO`.
- Signed physical-device build for Joseph's iPhone.
- Device installation and launch of the latest Life OS build.
- API typecheck.
- API production build.
- Contract tests: 19/19.
- Access tests earlier in the slice: 8/8.
- Local double-run of the Turso migration runner.
- Migration pairing check: 36/36 scripts paired, 58 migrations, 754 statements.
- API and Home production deployments reached Ready.
- Production device authorization created device records.
- Production HealthKit ingest accepted records.

A local scratch integration attempt did not reach application assertions because the local Prisma schema engine failed to create the scratch tables. Treat that as a tooling/environment failure, not proof that the integration behavior passed or failed.

## Failures observed before handoff

### 1. Heartbeat HTTP 400

Authorization exchange worked, but heartbeat requests returned 400. Because heartbeats did not persist, the `DeviceSource` table remained empty. The deployed API now logs validation issue paths/codes/messages, but those fresh logs were not inspected after launching the latest build.

### 2. Duplicate ingest surfaced as a libSQL driver error

Duplicate workout ingestion produced a libSQL `UNIQUE` `DriverAdapterError` rather than the Prisma error shape the duplicate handler expected. The API handler was broadened and deployed. Re-test to confirm duplicates now return the intended idempotent result.

### 3. Concurrent Health daily transaction contention

An overlapping `health.daily` ingest produced Prisma `P2028`: `Unable to start a transaction in the given time`. Native sync serialization was added to reduce overlap. Re-test from the current app and confirm no fresh P2028 in production logs.

## Priority takeover sequence

### P0 — Capture one fresh sync and diagnose heartbeat

1. Ask Joseph to open Life OS, leave it foregrounded, and tap **Sync Now** once.
2. Record the visible sync status shown by the app.
3. Immediately inspect API logs for the new heartbeat validation diagnostic.
4. Fix the request/contract mismatch at the narrowest correct layer.
5. Rebuild/install if the native request must change; redeploy API only if the server contract is wrong.
6. Confirm at least one `DeviceSource` row now exists with a recent success or honest error state.

### P0 — Prove broad HealthKit data, especially sleep and nutrition

1. Confirm Joseph approved the expanded Apple Health permission sheet.
2. Inspect the newest accepted health ingest result and corresponding Note metadata/content.
3. Look specifically for `sleep_` and `dietary_` keys.
4. Compare a sample day against Health.app to detect missing permission, source duplication, or unit errors.
5. Report exactly what is available, denied, absent in Health, or unsupported; do not collapse those into a generic success claim.

### P1 — Re-test dedupe and sync serialization

1. Tap Sync Now twice only after the first sync is visibly complete.
2. Confirm no new unique-constraint error and no P2028.
3. Confirm identical content is idempotent while changed daily content produces a new accepted hash when expected.

### P1 — Prove location and photo metadata separately

1. Check iOS permission states in the app and Settings.
2. Generate or wait for a valid location event and take/import a new photo after authorization.
3. Sync once.
4. Confirm separate `DeviceIngestItem` rows and their normalized graph results.
5. Confirm no photo binary left the phone.

### P1 — Verify the standalone Persons experience

1. Build/install the Persons scheme from the same Xcode project.
2. Confirm its branding, callback, device authorization, and credential storage are independent.
3. Confirm the People list loads real production Persons data.
4. Verify CRM navigation and error/empty states on the physical phone.

### P2 — Make coherent commits only after the live proof

The work spans native targets, API/auth, migration, contracts, and docs. Slice commits by coherent behavior, but first inspect how commit `6a9dc8e` absorbed `packages/contracts/index.ts`. Do not rewrite or force-push the concurrent Inbox history just to obtain aesthetically pure commits.

## Exact read-only verification commands

Run from `/Users/josephfryer/life-os` unless noted.

```bash
vercel logs api.lacollecteur.com --since 30m --no-follow --json
```

```bash
turso db shell persons "SELECT id,platform,displayName,appVersion,createdAt,lastSeenAt,revokedAt FROM Device ORDER BY createdAt DESC LIMIT 10;"
```

```bash
turso db shell persons "SELECT sourceId,recordType,status,observedAt,resultType,resultId,errorCode,createdAt FROM DeviceIngestItem ORDER BY createdAt DESC LIMIT 30;"
```

```bash
turso db shell persons "SELECT source,enabled,permissionStatus,healthStatus,lastSuccessAt,lastErrorCode FROM DeviceSource ORDER BY source;"
```

```bash
turso db shell persons "SELECT content,metadata FROM Note WHERE metadata LIKE '%healthkit%' ORDER BY createdAt DESC LIMIT 5;"
```

```bash
turso db shell persons "SELECT content FROM Note WHERE metadata LIKE '%healthkit%' AND (content LIKE '%sleep_%' OR content LIKE '%dietary_%') ORDER BY createdAt DESC LIMIT 10;"
```

Do not print bearer tokens, authorization codes, device secrets, or Keychain values into logs or handoffs.

## Suggested focused code inspection

```bash
git status --short
git log --oneline -10
git show --stat 6a9dc8e
git diff -- apps/api/lib/device-ingest.ts
git diff -- apps/api/app/v1/device/heartbeat/route.ts
git diff -- apps/companion/LifeOSCompanionIOS/HealthConnector.swift
git diff -- apps/companion/LifeOSCompanionIOS/IOSCompanionModel.swift
git diff -- packages/contracts/tests/device.test.ts
```

For untracked files, open them directly; `git diff` will not show their contents.

## Definition of done for the next session

The next session should not call this complete until all of the following are true:

- Sync Now visibly transitions through progress to a truthful success or actionable failure state.
- Heartbeat returns success and creates/updates `DeviceSource` state.
- A production health Note proves the actual types received, with sleep and nutrition called out explicitly.
- A repeat sync shows no duplicate driver error and no P2028 contention.
- Location and photo metadata are each verified end to end, or their precise permission/event blocker is documented.
- The standalone Persons app loads the real People experience on the physical phone.
- Tests/builds are rerun after the final fixes.
- Architecture docs remain aligned with the shipped runtime.
- Work is committed in safe, reviewable slices without discarding concurrent Inbox work.
- A fresh `npm run agent:finish` handoff records deployment IDs, device test results, database evidence, and the next honest blocker.

## User-facing posture

Joseph has already worked through multiple authorization attempts and wants the product to feel tangible. Lead with what the phone visibly does, then back it with logs/database evidence. Be specific about HealthKit: “all requested and authorized standard types supported by this build” is honest; “literally everything in Apple Health” is not yet true because clinical records, ECG waveforms, workout routes, denied permissions, and unavailable data remain outside the current slice.

Most importantly, keep the two-app product boundary clear:

- **Life OS** is Joseph's private collector and life graph client.
- **Persons** is the focused, saleable personal CRM.

Good luck, Cursor. The foundations are in place, the phone is connected, and the next win is a clean, evidence-backed Sync Now that proves each source independently.
