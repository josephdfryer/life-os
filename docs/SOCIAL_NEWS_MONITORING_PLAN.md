# Social + News Monitoring — architecture plan

Status: **planning output, nothing built.** This extends
`docs/PERSONS_MESH_PARITY_PLAN.md` §4 (the LinkedIn question) and §8 (news/
social monitoring, previously deferred pending a vendor decision) with a full
design for the three signal types Mesh calls "Social Changes," "Posts," and
"News." Input was a plan from Grok (pasted into chat 2026-08-16); this
document keeps Grok's vendor research where it's useful and replaces its
architecture, which invents a parallel schema (`people`,
`profile_snapshots`, `change_events`, `news_mentions`) that duplicates
`Person`, `Note`, and `State`. Life OS already has primitives shaped for
exactly this data — see `docs/MANIFESTO.md`. Nothing here proposes a ninth
primitive.

This is a plan only. No schema, code, or vendor account gets created until
it's explicitly greenlit.

---

## 1. What changed from Grok's plan, and why

| Grok's plan | This plan | Why |
|---|---|---|
| New `people` table | Existing `Person` | Already the canonical identity. A monitored person is a `Person`, not a parallel record — otherwise every "is this the same person" problem Persons already solved (dedupe, merge) gets solved twice. |
| New `profile_snapshots` table (full version history) | One new join table (`MonitoredProfile`) holding only the *last* snapshot, plus `State` rows for structured-field history | `State` already is "value of X for entity Y at time T," indexed for history queries. Storing a second parallel history table duplicates it. Only the raw last-fetched blob (needed to diff against the next fetch) has nowhere else to live. |
| New `change_events` table | `Note` (`type: "social_change"` / `"news_mention"`) | `Note` already carries `aboutPersonId`, timestamp, content, metadata, and a provenance chain — and every other Life OS feed (Home Inbox, Persons profile Communications stream) is already a query over existing primitives, not a bespoke events table. |
| New `news_mentions` table | Same `Note` model, `type: "news_mention"` | Same reasoning; a news mention *is* an observation about a Person, structurally identical to a social-change observation. |
| LinkedIn: Apify/Crustdata scraping as the recommended starting move | LinkedIn: user's own data export as the only default-recommended path; scraping documented but explicitly flagged, not defaulted | `docs/IOS_PLATFORM_PLAN.md` §6.1 already researched this and concluded scraping violates LinkedIn's ToS with real enforcement precedent (Proxycurl). Nothing about Grok's plan changes that finding — it just doesn't mention it. |
| n8n/Make orchestration | A cron-driven ingest module living beside the existing Oura/Gmail/Calendar sync pattern (`apps/api/lib/*-ingest.ts`, `Connection` rows, launchd/cron triggers) | Life OS already has a working, understood pattern for "poll an external source on a schedule, write structured data, stay idempotent." A third orchestration tool (n8n) would be a second system doing what `apps/api` + launchd already do for every other integration. |
| Generic "database (Postgres recommended)" | Existing Turso/SQLite via Prisma, same as everything else | Life OS is already on one database. Splitting monitoring data onto Postgres would mean a second connection, a second migration story, and joins across two databases to show a monitored person's profile next to their Interactions. |

What's kept from Grok's plan largely as-is: the phase sequencing logic
(foundations → one channel → next channel → unified feed → scale), the
tiered check-frequency idea, the diff-engine split (structured equality vs.
free-text diff), and the vendor short-list for X and News (evaluated below,
not accepted wholesale).

---

## 2. How this maps onto existing primitives

```
Person (existing)
  │
  ├── MonitoredProfile (NEW — one small join table)
  │     personId, network ("x"|"linkedin"|"news"), handle/URL,
  │     connectionId (which credential polls it), checkTier,
  │     lastSnapshotJson, lastCheckedAt, lastChangedAt, status
  │
  ├── State rows (existing model, new StateDefinitions)
  │     entityType="person", entityId=personId
  │     definition e.g. "x_bio_hash", "x_location", "x_display_name",
  │     "linkedin_title", "linkedin_company"
  │     → gives free history/diffing per field, same mechanism Oura uses
  │       for readiness/sleep/activity scores
  │
  ├── Note rows (existing model, new Note.type values)
  │     type="social_change": diff-rendered text (old → new), metadata
  │       carries {field, oldValue, newValue, network}, aboutPersonId=personId
  │     type="news_mention": article summary, metadata carries
  │       {url, publication, publishedAt, matchConfidence}, aboutPersonId=personId
  │     → same model that already backs the Persons profile "Communications"
  │       stream and Health digests; Home's feed becomes a query over Note,
  │       not a new endpoint concept
  │
  └── Connection rows (existing model)
        kind="x_monitor" | "news_monitor" | "linkedin_export"
        One Connection per credential (an X API app key, a News API key,
        or "the LinkedIn export importer," which needs no live credential)
```

`MonitoredProfile` is the one genuinely new table, and it's structurally the
same kind of thing as `GranolaNoteLink` or `CalendarEventLink` — a link
between a Life OS primitive (`Person`) and an external identity, owned by a
`Connection`. It is not a competing identity table.

```prisma
model MonitoredProfile {
  id               String    @id @default(cuid())
  workspaceId      String    @default("default-workspace")
  workspace        Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  personId         String
  person           Person    @relation(fields: [personId], references: [id], onDelete: Cascade)
  connectionId     String
  connection       Connection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  network          String    // "x" | "linkedin" | "news"
  handle           String?   // "@jack" for X; not applicable for news
  externalUrl      String?   // LinkedIn profile URL, if known (for the export-matching step)
  checkTier        String    @default("normal") // "vip" | "normal" | "low" — see §5
  lastSnapshotJson String?   // last raw fetch, for next-diff comparison only — not history
  lastCheckedAt    DateTime?
  lastChangedAt    DateTime?
  status           String    @default("active") // active | paused | error
  lastError        String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@unique([workspaceId, personId, network])
  @@index([workspaceId, network, status, checkTier])
  @@index([connectionId])
}
```

Everything downstream of ingestion (feed rendering, filtering by signal
type, notification routing) is then just: query `Note` where
`type in ("social_change", "news_mention", ...)`, workspace-scoped, ordered
by `timestamp`. Home already renders a chronological, filterable, federated
list this way for the Inbox — this is the same shape, read-only, no
accept/dismiss required (these are observations, not proposals to write
into the graph — the write already happened when the Note was created).
`captureNote` already publishes a `GraphEvent`, so the existing rules engine
(`packages/automation`) gets a `note.create` trigger for free — a Slack/email
webhook is a Rule action on that trigger, not new plumbing. This directly
satisfies Grok's "Delivery: Feed + Slack/email/Discord webhooks" requirement
without inventing a notification system.

---

## 3. Per-channel design

### 3a. X (Twitter) — lowest risk, build first

**Fields tracked**: bio, location, website URL, display name, profile image
hash (to detect a change without storing the image), pinned tweet id.
Optionally: N most recent post ids/text for "high-signal post" surfacing.

**Vendor**: official X API v2, not a scraper. `GET /2/users/by/username/:username`
with `user.fields=description,location,url,name,profile_image_url,pinned_tweet_id`
covers every structured field Mesh shows for "Social Changes." This is the
compliant option, matching this repo's existing preference for the
compliant path over the cheap-but-risky one (same call already made for
LinkedIn). X's Basic API tier is a paid monthly plan sized by request volume
— cost scales with number of monitored people × poll frequency, estimate in
§7. A scraper (Apify X actor) is materially cheaper but carries the same
ToS-risk shape as LinkedIn scraping; note it here as a fallback, don't
default to it.

**Ingest shape** (`apps/api/lib/x-ingest.ts`, mirrors `oura-ingest.ts`):
fetch profile → compute a stable hash of the full record → compare to
`MonitoredProfile.lastSnapshotJson` → for each changed field, write one
`State` row (structured) and, for bio/name (free text), one `Note` with a
rendered diff → update `MonitoredProfile.lastSnapshotJson`/`lastChangedAt`.

### 3b. News — cheapest, second priority

**Vendor**: start with **Google News RSS** per-person query
(`news.google.com/rss/search?q=...`) — free, no key, no rate-limit
negotiation, adequate relevance for a personal monitoring list. Graduate to
**NewsAPI.org** (structured JSON, better dedup, paid tiers past its free
100 req/day) once query volume or coverage gaps justify it. GDELT is
higher-volume but noisier and better suited to aggregate/trend analysis
than per-person mention tracking — not the right first tool here.

**Disambiguation** (the hard part, per Grok's plan and confirmed true):
build the query from name + company/title (`Person.company`,
`Person.title`, already-captured fields) rather than name alone; require at
least a company/title co-occurrence in the result for auto-acceptance,
otherwise stage the match at lower confidence. `Note.metadata` carries
`matchConfidence` so the feed can visually de-emphasize low-confidence
mentions rather than hiding them outright — same "surface uncertainty
instead of guessing silently" pattern the Inbox already uses for ambiguous
name matches.

**Ingest shape**: scheduled per-`MonitoredProfile` (network="news") query,
dedup by article URL against existing `Note.metadata.url` for that person,
create a `Note` per new match.

### 3c. LinkedIn — deferred by default, two paths documented

**Default (v1): the user's own data export**, exactly as already decided in
`docs/IOS_PLATFORM_PLAN.md` §6.1 and `docs/PERSONS_MESH_PARITY_PLAN.md` §4.
Settings → Data Privacy → Get a copy of your data → Connections, dropped
into an import flow (`/import/persons`-adjacent) that matches export rows
to existing `Person` records by name/email and creates
`linkedin_title`/`linkedin_company` `State` rows plus a `social_change`
`Note` when a re-export shows a change. Zero ToS risk, zero recurring cost,
but not real-time — freshness is bounded by how often the user manually
re-exports (worth a recurring reminder, not automation, since the export
itself requires the user's own LinkedIn session).

**Documented but not defaulted (v2, if ever wanted): live monitoring via
Apify/Crustdata-style scraping.** This is what Grok's plan recommends
starting with. It would give Mesh-equivalent real-time headline/job-change
detection, at real monthly cost and at the same enforcement risk already
researched and rejected for this product (LinkedIn's user agreement
prohibits it; Proxycurl is the cited precedent for what happens to
businesses built on it). If this is ever revisited, it needs an explicit,
separate risk conversation before any vendor account is created — it is not
something to slide into as "just another `MonitoredProfile.network` value"
alongside X and News, precisely because the other two carry no such risk.

---

## 4. Diff engine

Two cases, matching Grok's split (this part of the plan holds up well):

- **Structured fields** (location, company, title, website URL): equality
  check against the last `State` row for that `(entityId, definitionId)`.
  Changed → new `State` row + one `Note` summarizing "Location: San
  Francisco → New York."
- **Free text** (bio, headline): `diff-match-patch` (or equivalent) over
  old vs. new string, rendered as blue-addition/gray-strikethrough markup
  in `Note.content` (matches Mesh's visual treatment) with the raw
  old/new strings kept in `Note.metadata` for anything that wants
  unstyled access.

No new abstraction needed beyond this — it's a pure function
(`packages/domain/social-diff.ts`) called by each channel's ingest module,
not a shared "diff engine service."

---

## 5. Check-frequency tiers — reuse the existing closeness cadence

Persons already computes a per-person cadence from `closeness`
(`apps/persons/lib/person-list-presentation.ts`: closeness 4 → 10-day
touch cadence, 3 → 21 days, 2 → 90 days). Reuse the same signal instead of
inventing a separate "VIP" concept:

| `Person.closeness` | `MonitoredProfile.checkTier` | Poll frequency |
|---|---|---|
| 4 | `vip` | Daily |
| 3 | `normal` | Weekly |
| 1–2 | `low` | Monthly |

This directly answers Grok's Phase 5 "tiered checking frequency" item and
ties monitoring cost to the relationship-strength data Persons already
maintains, rather than a manually-curated separate VIP list.

---

## 6. Feed + delivery

- **Home feed**: a new bounded read view (`GET /api/signals` or folded into
  an existing feed surface) over `Note` where `type in
  ("social_change", "news_mention")`, `workspaceId` scoped, filterable by
  type and by person — the same keyset-cursor pattern (`timestamp`, `id`)
  every other bounded list in this codebase already uses
  (`docs/PERSONS_ARCHITECTURE.md` "API Plumbing").
- **Person profile**: a "Signals" card on `/persons/[id]`, same pattern as
  the existing Health card — only rendered when that Person has
  `MonitoredProfile` rows, showing the latest change plus an expandable log.
- **Push/webhook**: a `Rule` (existing `packages/automation`) on the
  `note.create` trigger, filtered to `type in ("social_change",
  "news_mention")`, with a Slack/email action — reuses the rules engine
  wholesale rather than building bespoke notification routing.
- **Daily/weekly digest**: naturally folds into the already-planned "wire
  `scripts/brief` into a real push surface" work in
  `PERSONS_MESH_PARITY_PLAN.md` §5 item 2 — signals become another section
  of that brief rather than a fourth separate digest mechanism.

---

## 7. Cost & risk reality check

| Channel | Recurring cost driver | Legal/ToS risk | Real-time? |
|---|---|---|---|
| X (official API) | Paid tier, scales with monitored-person count × poll frequency | None — compliant | Yes, within poll interval |
| News (Google News RSS → NewsAPI) | Free at pilot scale; NewsAPI paid tiers only past free-tier request volume | None | Yes, within poll interval |
| LinkedIn (data export, default) | $0 | None | No — manual re-export cadence |
| LinkedIn (scraping, documented not defaulted) | Apify/Crustdata monthly spend, scales with list size | Real — ToS violation, cited enforcement precedent | Yes |

At the pilot scale from the earlier scoping conversation (~20-50 people,
one channel first), X and News both stay in low-cost/free tiers. Cost only
becomes a real conversation if the monitored list grows into the
hundreds-to-thousands range Grok's plan sizes for — worth re-checking
vendor pricing at that point rather than provisioning for it now.

---

## 8. Phased build order

Adapted from Grok's phases, sequenced against what's cheapest given what
already exists (same logic `PERSONS_MESH_PARITY_PLAN.md` §5 uses):

1. **Schema + one ingest module.** Add `MonitoredProfile` +
   `StateDefinition` rows for X fields. Build `apps/api/lib/x-ingest.ts`
   following the Oura pattern exactly (Connection → fetch → diff → State +
   Note). Pilot list: ~20-50 people, manually flagged (e.g., a `Person` tag
   or explicit `MonitoredProfile` creation from the Person detail page).
2. **Signals feed + Person profile card.** Read-only surfaces over the
   `Note` rows Phase 1 now produces. This is where the work becomes
   *visible* and gets real user feedback before adding more channels.
3. **News channel.** Same ingest shape, Google News RSS first. Reuses the
   diff/feed work from Phases 1–2 almost unchanged since it's the same
   `Note`-shaped output.
4. **LinkedIn data-export import flow.** Self-contained, no dependency on
   the live-polling infrastructure above — could actually move earlier if
   it's higher-value sooner.
5. **Rule-based delivery (Slack/email digest).** Wire the `note.create`
   trigger once there's enough real signal volume to make notifications
   worth tuning rather than guessing thresholds upfront.
6. **Frequency tiering + scale hardening.** Apply the closeness-tier
   mapping from §5, add per-connection rate-limit backoff, expand the
   monitored list past the pilot size.
7. **(Deferred, separate decision) LinkedIn live monitoring** — only if
   revisited explicitly per §3c.

---

## 9. Open decisions for when this gets greenlit

- Exact pilot list (which ~20-50 people) and who curates it — manual `Person`
  flagging from the UI, or a bulk "monitor everyone with closeness ≥ 3" cut?
- X API tier/budget approval (this needs the `vercel:marketplace` flow /
  direct X developer portal signup — a real vendor account, not simulated).
- Whether the Signals feed lives inside Persons, inside Home, or both (Home
  already aggregates cross-app signals for the Inbox; Persons already owns
  the Person profile — likely both, feed in Home, card in Persons, same
  split as Communications review today).

## 10. Related documents

- `docs/PERSONS_MESH_PARITY_PLAN.md` — the parent gap analysis this extends.
- `docs/IOS_PLATFORM_PLAN.md` §6.1 — original LinkedIn ToS research.
- `docs/PERSONS_ARCHITECTURE.md` — Connection/Note/State/ReviewItem
  patterns this plan builds on; the Oura section (§3e) is the closest
  existing precedent for an ingest module.
- `docs/MANIFESTO.md` — the eight primitives; nothing here proposes a ninth.
