# LifeOS Roadmap — consolidated plan of record

Status: **active** · Consolidated 2026-09-06 · Tracker: [Linear, team "Joseph Fryer"](https://linear.app/josephfryer)

This document replaces "which plan doc is current?" as a question. Every plan
in `docs/` is listed in §1 with a disposition. Everything that is actually
being worked is a Linear issue in one of the six `LifeOS ·` projects in §2.
The plan docs stay as the detailed specs; this file and Linear say what is
next, who owns it, and why.

Rules:

- **Linear is the queue.** No work starts without an issue. Agents (Claude,
  Codex, Cursor) are workers; each issue carries an `Agent/*` label naming who
  is doing it. See `docs/LINEAR_WORKFLOW.md`.
- **Plan docs are specs, not queues.** When a phase ships, tick it in the doc
  and close the Linear issue. When a plan is superseded, mark it here.
- **Ownership seam is unchanged.** Claude owns the spine (`packages/db`,
  `packages/domain`, `packages/automation`, `packages/intelligence`,
  `apps/api`, native Swift). Codex owns surfaces (`apps/home`, `apps/persons`
  UI, `packages/ui`, e2e). Cursor takes small, well-bounded UI fixes. Joseph
  owns decisions, accounts, and real-use gates.

---

## 1. Plan inventory and disposition

| Plan | Where it stands (verified against code, 2026-09-06) | Disposition | Linear project |
|---|---|---|---|
| `LEVEL_UP_SKILLS_WEB_PLAN.md` | Phase 0 locked. Phase 1 mostly shipped: Character home, Fitness + Communication skill pages, Journey. Nav still shows Train, no Plans entry; Plans are read-only. | **Active — top web priority** | Level Up Skills Web |
| `IOS_PLATFORM_PLAN.md` | Two signed shells on device + a third LevelUp shell. M2 backend done. M5 partially done (canonical `/v1` verticals exist). M1 LifeOSKit extraction, dark Still, local store, command queue not done. M0 Apple enrollment status unknown. | **Active** | Persons iOS Parity · iOS Platform |
| `PERSONS_MESH_PARITY_PLAN.md` | Planning only. Gap table and build order are still correct. | **Active — feeds Persons Web** | Persons Web & Daily Use |
| `SOCIAL_NEWS_MONITORING_PLAN.md` | Planning only. Depends on Persons having reliable social handles first. | **Parked until Social Scans P2 ships** | Social Scans (later phases) |
| `ASSISTANT_WRITE_CAPABILITIES_PLAN.md` | Steps 1–3 landed, `create_person` has the two-phase confirm. Steps 4–6 (generalize confirm, review tier, undo) open. | **Active** | Persons Web & Daily Use |
| `ACTION_SYSTEM_PLAN.md` | Phase 1 + core Phase 2 done (Focus queue live in Home). Phases 3–5 open. | **Active, low priority** | Persons Web & Daily Use |
| `DAILY_USE_PLAN.md` | Engineering complete through Phase 6. Open: retire old Persons Google sync path; real-use gates only Joseph can pass. | **Active — gates only** | Persons Web & Daily Use |
| `DEPLOYMENT_HARDENING_PLAN.md` | Phases 1, 3, 4 done. Remaining: staging DB, git-connect seven projects for previews, branch ruleset, env drift detector. | **Active** | Ops & Platform |
| `~/.claude/plans/please-plan-it-out-ancient-lecun.md` (Vercel Pro portability) | Not started: no `LEAVING_VERCEL.md`, `standalone` still off, Workflow DevKit still present, three crons still split across Actions + Vercel. Codex lane. | **Active — Codex** | Ops & Platform |
| `~/.claude/plans/humble-sniffing-honey.md` (Track C) | C1–C4 landed (Connection model, Home admin, automation across 8 primitives). C5 close-out (Claude integrate → Codex QA) never recorded. | **Close out** | Ops & Platform |
| `LEVEL_UP_MOBILE_TRANSITION_PLAN.md` | Shell exists on `DemoWorkoutDataSource`. Web role revised 2026-09-04; native deferred. | **Deferred behind Skills Web Phase 2** | iOS Platform |
| `LEVEL_UP_ADAPTIVE_WORKOUT_PLAN.md` | M2 done, Oura wired but readiness does not alter prescriptions. | **Deferred with the above** | iOS Platform |
| `FINANCE_INTERACTION_MODEL_PLAN.md` | Phases 1, 2 (partial), 4 in prod. Phase 3 stream API and Phase 5 reconciler pending. | **Parked** | — (re-open when needed) |
| `PLACES_WORLD_CLASS_PLAN.md` | Proposed. MapKit renderer landed 2026-08-30 (its Phase 5 decision). Phases 0–4, 6 not started. | **Parked** | — |
| `FILE_INTELLIGENCE_PLAN.md` | `FileChunk`, `TheoryAnalysisRun`, claim promotion exist. Treat as shipped; verify the nightly job runs on Neon. | **Verify then archive** | Ops & Platform (one verify issue) |
| `GRANOLA_EVENTS_INTEGRATION_PLAN.md` | Built; runbook exists; cron on Events. Production key rotation was the last open item. | **Verify then archive** | Ops & Platform (same verify issue) |
| `PHOTOS_PLACE_INTEGRATION_PLAN.md` | No `PhotoAsset` model. Nothing built. | **Parked** | — |
| `ADAPTIVE_DAY_PLAN.md` | Nothing built. | **Parked** | — |
| `TECHNICAL_DEBT_BACKLOG.md` | All 16 items done. | **Closed** | — |
| `DATABASE_MIGRATION_PLAN.md`, `DATABASE_CUTOVER_RUNBOOK.md` | P0–P7 done, Neon is prod. | **Archive (keep runbook)** | — |
| `STILL_MIGRATION_PLAN.md`, `STILL_UI_MIGRATION_PLAN.md` | Complete 2026-07-22. | **Archive** | — |
| `CODEX_TASK_*.md`, `CLAUDE_HANDOFF_INBOX_2026-08-15.md`, `CURSOR_HANDOFF_2026-08-15.md` | One-off task briefs, all executed. | **Archive** | — |
| `PRIME_TIME_READINESS_AUDIT_2026-07-12.md` | Historical audit. | **Archive** | — |

Architecture references (not plans, stay authoritative): `MANIFESTO.md`,
`PERSONS_ARCHITECTURE.md`, `PLACES_ARCHITECTURE.md`, `LIFE_OS_APP_ARCHITECTURE.md`,
`COMPANION_ARCHITECTURE.md`, `STILL_DESIGN_SYSTEM.md`, `ENGINEERING_STRATEGIES.md`,
`DEPLOY_RUNBOOK.md`, `adr/*`.

---

## 2. Workstreams (one Linear project each)

### 2.1 Ops & Platform — unblock first

The three things that have to happen before feature work gets full attention:

1. **Calendar auto-sync has failed every run since 2026-09-05** (GitHub issue #38,
   504 `FUNCTION_INVOCATION_TIMEOUT` at the 300s cap). Home's Today depends on
   it. Fix from the Vercel runtime logs for the events project and DB write
   counts, not from theory. Expected shape: per-run time budget + per-calendar
   cursor so one invocation is bounded and the next run resumes.
2. **Housekeeping.** PR 39 duplicates commit 7026718 → close. Untracked Level Up
   Replit design package → commit under `docs/design/` or delete. Revert the
   generated `apps/home/next-env.d.ts` churn.
3. **Track C Phase C5 close-out** was never recorded. Claude runs the
   integration pass, then Codex runs full QA, then `agent:finish` both.

Then, in Codex's lane and at its own pace: the Vercel Pro portability plan
(Phases 1–5) and the deployment-hardening remainder (staging DB before any
preview git-connects; branch ruleset; env drift detector).

### 2.2 Level Up Skills Web — top web feature priority

Phase 1 exit gate has two gaps: a **Plans** nav entry and **Plan create/link
from a skill**. Close both, then Phase 2 (Communication depth: draft
attributes + confidence copy, self-assessment as Note/State evidence, Journey
entries on change), then Phase 3 (Fitness as one skill panel, Train demoted).
Spec: `LEVEL_UP_SKILLS_WEB_PLAN.md` §7.

### 2.3 Persons iOS Parity — see §3

### 2.4 Social Scans (Facebook, Instagram, LinkedIn export) — see §4

### 2.5 Persons Web & Daily Use

Ordered by leverage, per `PERSONS_MESH_PARITY_PLAN.md` §5:

1. **Push the cadence data.** The needs-attention computation exists in
   `apps/persons/lib/person-list-presentation.ts` but is pull-only. Move the
   computation into `packages/domain`, expose `GET /v1/people/attention`, render
   it as a Home card and (later) a notification. This one endpoint also feeds
   the iOS Today deck in §3.
2. **Exact-match auto-merge tier** (shared normalized email or E.164 phone)
   above the manual queue. Designed in `IOS_PLATFORM_PLAN.md` §6.2, not built.
3. **Split Google consent** into contacts-only and Gmail so contact sync never
   pulls a customer into the restricted-scope CASA tier.
4. **Retire the old Persons-owned Google sync path** (Daily Use Phase 3's last
   open box). Pairs with the calendar-sync fix.
5. **Assistant writes**: generalize the two-phase confirmation harness beyond
   `create_person`, then the review tier, then undo.
6. **Daily Brief as a served surface** (currently `scripts/brief` writes a file).
7. Real-use gates (Joseph): one week at 80% Home use; four evening closeouts in
   seven days; five-item inbox timing.

### 2.6 iOS Platform (shared foundation, Level Up native)

Sequenced *after* Skills Web Phase 2 hits its exit gate, except M0 which is
Joseph's and can start any time:

- **M0 Apple Developer enrollment** — individual now, entity + D-U-N-S in
  parallel. Gates TestFlight, push, and everything saleable.
- **LifeOSKit extraction** from `LifeOSCompanionCore` with the local store
  decision (SwiftData vs GRDB, decided against force-quit recovery) and the
  command queue. Persons iOS §3 needs the local store too, so this moves up if
  Persons parity starts before Level Up native.
- **Level Up native on live data**: swap `DemoWorkoutDataSource` for
  `WorkoutClient` against `/v1/device/workout/*`.
- **Dark Still** palette for iOS.

---

## 3. Persons iOS — parity plan

### 3.1 Where it actually stands

Verified in `apps/companion/PersonsIOS` (10 files, ~1,700 lines) and
`Packages/PersonsFeature` (5 files, ~320 lines):

| Capability | Web Persons | Persons iOS today |
|---|---|---|
| People list + search | Filters on 17 fields, tags, groups, closeness tiers, needs-attention | Debounced server search, cursor pagination. No filters. |
| Person detail | Last touch, interaction count, closeness, Theory card, file evidence, Health, profile notes, Active Plans, communications timeline | Static fields only (contact, context, notes, tags). No timeline, no Plans, no closeness edit. |
| Create / edit person | Add + Edit modals, closeness, tags, all fields | None. Device tokens carry `people.read` only. |
| Quick capture (Note) | Home + LifeOS bar capture, assistant | None. |
| Inbox / review triage | Universal `ReviewItem` inbox, bulk accept/dismiss | None. |
| Today / attention | `/today`, needs-attention filter | None. |
| Merge / dedupe / clean | Full pair review, `/people/clean` | None. (Merge lives app-local in `apps/persons`, not in `apps/api`.) |
| Groups, Plans, Places, Notes | Full | None. |
| Public profile | `/profile/[slug]` | None. |
| Imports | vCard, CSV, XLSX, Google Contacts, Gmail, Instagram export | Phone Contacts (full re-enumerate each sync), Calendar attendees (90 days), Facebook scrape, Google Contacts OAuth (needs plist client ID). |
| Offline | n/a | Encrypted outbox for uploads only. No read cache; list is empty offline. |
| Onboarding | — | Shell hard-gates People behind Contacts sync: a user who declines Contacts can never see the People tab. |

What is genuinely good and should be kept: PKCE device auth, the encrypted
outbox with idempotent `sourceId`s, the `PersonsDataSource` protocol that
makes the feature package testable, Still colors already in Swift, and the
server-side `ingestContact` matcher that auto-applies only at ≥0.95.

### 3.2 API and scope work (Claude, `apps/api` + `packages/access`)

Everything below is server-only, no Apple dependency, and can run in parallel
with the Swift work by building against the documented `/v1` contracts.

- **P0-a Scopes.** Add `people.write`, `interactions.read`, `notes.read`,
  `notes.write`, `plans.read`, `plans.write`, `review.read`, `review.write` to
  `DEVICE_SCOPES`, granted per app: the Persons shell requests them, the LifeOS
  collector shell does not. Extend the isolation test that currently pins
  `people.write` absent to assert it is present only for Persons devices.
- **P0-b Person detail bundle.** `GET /v1/people/:id?include=interactions,plans,notes,stats`
  returning the same numbers the web page shows (last touch, count, closeness)
  so the phone does one request per detail open. Keep the flat resource for
  list callers.
- **P0-c Attention endpoint.** `GET /v1/people/attention` (shared with §2.5
  item 1). Cadence logic moves into `packages/domain/attention.ts`.
- **P0-d Merge + dedupe to `apps/api`.** `POST /v1/people/:id/merge` and
  `GET /v1/dedupe` move from `apps/persons/app/api/v1` with workspace-isolation
  tests, so the phone's one-pair-at-a-time merge has a canonical target.
- **P0-e Source badges.** Aggregate `sources` per Person (from
  `DeviceIngestItem` receipts + `Person.source`) into the resource so both web
  and iOS can render them.

### 3.3 Native phases (Claude, Swift)

| Phase | Scope | Exit gate |
|---|---|---|
| **P1 Read parity** | Detail = timeline (interactions), Active Plans, notes, closeness, last touch, source badges. List filters: closeness tier, needs attention, tag, group. **Local read cache** (SwiftData, the M1 decision) so search is instant and the list works offline. Remove the Contacts hard-gate: People shows immediately after sign-in; Contacts is an upsell card. | Open any person and see what the web shows; search with airplane mode on. |
| **P2 Write** | Add person, edit fields + closeness, log interaction, quick Note capture (text now, voice via `Speech` next), share-sheet extension that captures a Note against a person. Writes go through the outbox with idempotency keys; UI updates optimistically from the local cache. | Create a person on the phone, see it on the web inside one sync. |
| **P3 Triage decks** | Inbox as a swipe deck over `/v1/review-items` (accept / dismiss / bulk). Today deck over `/v1/people/attention` with one-tap "log a touch". Merge deck: one pair, swipe merge or keep-both. | Clear ten review items on the phone in dead time without opening a laptop. |
| **P4 Phone-only advantages** | Lock-screen / home widgets (today's birthdays, needs-attention count), App Intents ("Log that I called Sam"), push for the daily brief (needs APNs → M0). Google `syncToken` delta for background Contacts refresh. | Persons on iOS does something the web cannot. |
| **P5 Foundation** | Fold into LifeOSKit extraction; dark Still; TestFlight build (needs M0). | Same package powers the LifeOS People section and the standalone Persons shell. |

The phone-native merge deck (P3) is the single feature most worth doing well:
it is the answer to Mesh's loudest complaint and is better on a phone than on
the web.

---

## 4. Social Scans — Facebook, Instagram, LinkedIn

### 4.1 Where it actually stands

- **Facebook (iOS).** `FacebookConnector` + `FacebookWebView` load
  `m.facebook.com` in a non-persistent `WKWebView`, wait fixed 4s + 1s, scroll
  once, and regex the page's Relay script blobs and anchor tags for
  `id`/`name`/`birthdate`. No pagination beyond one scroll. Debug lines ship to
  `/v1/device/debug-log`, which only `console.log`s on Vercel, so nobody can
  see a run's outcome without opening Vercel logs. Every prior fix
  (2026-08-18) was a timing tweak. It is fragile by construction: it parses
  markup instead of the data the page itself fetches.
- **Facebook (server).** Records arrive as `contact.person` with
  `source: facebook`. `ingestContact` then applies the *phone address book*
  rule: **no match + a first name → auto-create a Person immediately** with
  `source: "ios_contacts"`. Facebook gives no email or phone, so nearly every
  friend is "no match". A successful scan of 800 friends would auto-create up
  to 800 identifier-less People. This is a data-quality bug waiting for the
  scraper to work.
- **Instagram (web only).** `/import/persons` accepts the Download-Your-
  Information JSON (`followers_N.json`, `following.json`). Export carries
  username only, so every row is a name-shaped guess routed to manual review.
  No iOS path. `Person.instagram` exists.
- **LinkedIn.** Export-CSV path designed (`IOS_PLATFORM_PLAN.md` §6.1 Tier 3),
  not built.
- **X / news monitoring.** `SOCIAL_NEWS_MONITORING_PLAN.md`, planning only.

### 4.2 The design: harvest the network's own API responses, never the DOM

One reusable on-device component replaces the Facebook one-off and gives
Instagram a real scan:

**`AuthenticatedWebHarvester`** (new package `Packages/SocialHarvest`, depends
on `LifeOSCompanionCore`):

1. A `WKWebView` whose `WKUserScript` (injected at document start, all frames)
   monkey-patches `window.fetch` and `XMLHttpRequest` so every response whose
   URL matches the recipe's patterns is forwarded, body and URL, to a
   `WKScriptMessageHandler`. The page keeps working normally; we read what it
   already fetched. No regexing markup.
2. A **`HarvestRecipe`** per network, versioned (`recipeVersion` travels with
   every record): login URL, signed-in detector, page sequence, URL patterns,
   and a Swift decoder from the intercepted JSON to `SocialProfileRecord`
   (`network`, `externalId`, `handle`, `displayName`, `profileUrl`,
   `avatarUrl`, `birthday?`, `location?`, `relationship` = friend | follower |
   following). When a network changes shape, one recipe changes.
3. A **scroll driver** that pages with human-like cadence and stops on idle
   (three scrolls yielding zero new records), with a hard cap and a visible
   "N found so far" pill. Persistent per-network `WKWebsiteDataStore` so a
   re-scan next month does not require logging in again.
4. Records enqueue to the existing encrypted outbox as a new record type
   **`social.profile`**, not `contact.person`, with `sourceId =
   "<network>:<externalId>"` so re-runs are idempotent.
5. Debug: keep the on-device log, and also write a **`DeviceHarvestRun`**
   summary (network, recipeVersion, found, enqueued, error) through
   `/v1/device/heartbeat` so the result is visible in Home's Connections page,
   not only in Vercel logs.

**Facebook recipe.** Friends: `www.facebook.com/<me>/friends` (or
`/friends/center/friends`) — intercept the GraphQL responses that carry the
friends collection; decode `id`, `name`, `url`, `profile_picture`. Birthdays:
`/events/birthdays` — intercept the birthdays query for `id`, `birthdate.day/month`.
Merge by `id`.

**Instagram recipe.** `instagram.com/<me>/following/` and `/followers/` —
intercept `api/v1/friendships/<id>/following?max_id=…` and `/followers`. The
JSON carries `username`, **`full_name`**, `pk`, `profile_pic_url`,
`is_verified`. That is strictly more than the export gives (real names), so
the iOS scan becomes the primary Instagram path and the export importer
becomes the fallback.

**LinkedIn.** Export CSV only (the plan's finding stands; scraping is off the
table). Build it as a first-class "request your export, then drop the file"
flow on web and via the iOS share sheet. It yields name, URL, company, position,
connected-on date.

### 4.3 Server side: a social candidate is never a Person by itself

New `ingestSocialProfile` in `apps/api/lib/device-ingest.ts` (Claude):

| Tier | Condition | Action |
|---|---|---|
| Link | An existing Person already has this `facebook` / `instagram` URL or handle | Refresh avatar/birthday/location if empty; receipt; done. Idempotent. |
| Auto-link | Exactly one Person whose normalized full name matches **and** one corroborating signal (birthday month/day, hometown/location, or a shared mutual-source record) | Set the social field, write a provenance Note, publish `person.update`. |
| Review — link | Name matches one or more People, no corroboration | `ReviewItem` (`source: "social_harvest"`, `itemType: "person"`, command `social.link`) with the candidate Person IDs. |
| Review — new | No name match | `ReviewItem` with command `social.create`. |

Two consequences the current code does not have:

- **Immediate fix, ship before anything else:** in `ingestContact`, gate the
  "no match → create" branch on `item.source` being a curated address-book
  source (`contacts`, `google_contacts`, `calendar`). `facebook` goes to
  review. One-line change plus a test.
- **Bulk review surface.** Hundreds of social candidates must not enter Home's
  five-item Focus inbox. Home already ranks "consequential" first; add an
  explicit exclusion for `social_harvest`, and give these their own surfaces:
  a bulk review page in Persons (`/import/social`, grouped by network, with
  "link to…" typeahead, accept-all-with-unique-name-match, dismiss-all) built by
  Codex, and the iOS swipe deck from §3 P3 built by Claude. Bulk endpoints
  (`/v1/review-items/bulk-accept`, `bulk-dismiss`) already exist.

### 4.4 Phases

| Phase | Deliverable | Owner |
|---|---|---|
| **S0** | `ingestContact` source gate + test. Heartbeat carries harvest-run summary; Home Connections shows last run per network. | Claude |
| **S1** | `SocialHarvest` package: harvester, recipe protocol, scroll driver, `social.profile` outbox record, contracts in `packages/contracts`. Facebook recipe rewritten on intercepted responses. `ingestSocialProfile` with the four tiers. | Claude |
| **S2** | Instagram recipe (following + followers). Web `/import/social` bulk review page. iOS deck reuses §3 P3. | Claude (iOS/API) · Codex (web) |
| **S3** | LinkedIn export import (web + share sheet). Source badges show network icons. | Codex (web) · Claude (iOS) |
| **S4** | ADR 0005: personal-only, own-session harvesting; never shipped in the saleable Persons.app; recipe-versioned; kill switch per network from Home. Then unpark `SOCIAL_NEWS_MONITORING_PLAN.md` — `MonitoredProfile` builds on the handles S1–S3 populated. | Claude |

Honest constraints: Facebook and Instagram harvesting reads data the signed-in
user can already see, but it is outside both platforms' third-party terms and
will break when their private APIs change. The recipe versioning and the
per-network kill switch are the mitigation; this stays a personal-instance
feature and is excluded from anything customer-facing (ADR 0004's vault
customers get the export-file paths only).

---

## 5. Suggested order for the next two weeks

1. Calendar sync fix (Claude, from logs). Housekeeping (Cursor closes PR 39;
   Joseph decides the Replit package). `ingestContact` source gate (Claude,
   same day).
2. Track C C5 close-out (Claude → Codex).
3. Level Up Phase 1 close: Plans nav + Plan create/link (Codex). Then Phase 2.
4. Persons iOS P0 API/scopes (Claude) in parallel with Level Up Phase 2 (Codex).
5. Social Scans S1 (Claude) once P0 lands, since both touch `device-ingest.ts`.
6. Persons Web items 1–3 (attention endpoint, auto-merge tier, OAuth split) —
   the attention endpoint is shared with iOS P0-c, so it goes first.
7. Persons iOS P1 → P2 → P3, with S2 Instagram slotted after P2.
8. iOS Platform items resume after Level Up Skills Web Phase 2 exits.

Decisions only Joseph can make, tracked as `Agent/Joseph` issues: Apple
Developer enrollment status; the Replit design package; GitHub secrets and
branch ruleset; whether a staging Neon branch is created before preview
git-connects; the real-use gates.
