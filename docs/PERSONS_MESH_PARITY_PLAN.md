# Persons vs. Mesh — feature parity plan

Source: 16 screenshots of Mesh for iOS (`me.sh`, by Automattic; internal build
strings still say "Clay," an earlier product name), reviewed 2026-08-13.
Cross-checked against the current state of `apps/persons` and shared packages
in this repo. This is a gap analysis and build plan, not a redesign — Persons
keeps the eight-primitive model (`docs/MANIFESTO.md`); nothing here proposes a
new primitive.

Status: planning output. Nothing in this document has been built yet except
where explicitly marked "already have."

---

## 1. What Mesh actually does

### Home feed
A single reverse-chronological feed, filterable by signal type: **Birthdays,
Events, New Members, News, Social Changes, Posts, Reconnect, Reminders,
Sharing**. Feed items observed: past meetings with attendee avatars, "reflect
on your relationship with X, Y, Z" prompts, LinkedIn headline-change diffs
(strikethrough old text, highlighted new text), birthday reminders, import
status notifications, duplicate-found notifications.

### Reconnect
The relationship-maintenance engine. A daily count of algorithmic "you should
reach out to this person" suggestions (default 3, tunable, settable to 0),
plus **per-person custom cadence** ("monthly," "quarterly," etc.) for people
who've earned an explicit reminder schedule. Feed items can group by day or
show one person at a time.

### Meeting lifecycle reminders
Three separate, calendar-triggered push notifications: **pre-meeting** (15
minutes before, "prepare for this"), **in-meeting** ("take notes now"),
**post-meeting** ("write down what happened before you forget"). Independent
toggles for each.

### Reports
**Daily Brief** — every morning, a curated summary of who you're meeting
today. **Weekly Digest** — every Sunday evening, a curated summary of the
week's activity. Both are opt-out push notifications / in-app reports, not
files.

### Duplicate resolution
A single "Resolve Duplicates" toggle: "enables intelligent contact
deduplication and merges your duplicate contacts across all your Mesh
integrations. It is turned on by default." Fully automatic and continuous,
not a queue the user works through — though a "Duplicates found! Go to the
Duplicates view" notification exists too, implying a review surface still
exists for cases it won't silently resolve.

### Public profile
A toggleable public page at `me.sh/profile/<username>` — a shareable digital
business card, viewable by anyone with the link, inside or outside Mesh.

### Integrations
Per-account, not per-provider: **each** connected email address gets a
separate mail-sync row *and* a separate calendar-sync row, so someone with
three inboxes sees six rows, independently toggleable. Observed connections:
Apple/Google sign-in, ChatGPT (with a "deep link out" affordance), Facebook,
iMessage, iOS Contacts (twice — evidently once per device), and multiple
Gmail/Outlook mail + calendar pairs.

### External enrichment / monitoring
**News**: "get notified when someone you know is mentioned in one of over
20,000 global publications." **Social Changes**: notified when a known
person updates a social profile. **Posts**: notified on "a significant
social media post." These clearly run on a licensed third-party
data-enrichment/monitoring feed — not something a contacts app builds from
scratch.

### People directory
9,797 contacts in the observed account. Each row shows a **source-provenance
badge** (a small icon: message bubble = iMessage-sourced, calendar icon =
calendar-derived, phone icon = phone contacts, `in` badge = LinkedIn,
envelope = email-sourced) plus a **separate reachability/signal-strength**
icon (a concentric-circle glyph, color-coded). Enriched contacts (LinkedIn
photo, resolved name) show a location line; unenriched ones (raw phone/CSV
imports like "william Mar 2010," "HMI 2026") show only an initial-letter
avatar — Mesh has the same messy-import problem Persons does, just with a
better default per-row treatment of it.

### Quick capture
A floating "+" expands into a radial menu: add person, scan (business
card/QR), set a reminder, and one more icon that looks like an AI/automation
action (unclear from the screenshot alone).

### Workspace / Teams / billing
"Mesh Pro" and "Mesh for Teams" paid tiers, a `PRO` badge on the profile,
workspace name + image, a Members list with role (`ADMIN`), unlimited team
members on the Teams tier, "manage your account at app.me.sh."

### Settings odds and ends
Multiple sign-in providers (Apple + Google simultaneously), default-app
routing ("View Moments in Browser," "Compose emails in Apple Mail"), full
data export ("get a copy of your data"), light/dark/system theme, nine
alternate app icons, a "Welcome Guide" / "What's New" / "Help Center" stack.

---

## 2. What Persons already has (verified against the current codebase, not assumed)

**Relationship cadence and "who needs attention" — already built, and
arguably ahead of Mesh's version.** `apps/persons/lib/person-list-presentation.ts`
(added 2026-08-11, `feat(persons): turn directory into relationship
snapshot`) computes a per-person `relationshipStatus` from a **closeness-tiered
default cadence** — closeness 4 → 10 days, 3 → 21 days, 2 → 90 days, closeness
1 tied to having an active `Plan` rather than a fixed interval — and exposes
an `attention` list-filter view ("Needs attention") plus tone-coded status
labels ("Due for a touch," "Xd past usual," "Follow-up due"). This is
Mesh's Reconnect logic, computed server-side, filter-driven rather than
feed-driven. What it lacks relative to Mesh: it's **pull** (you open Persons
and switch to the Attention filter), not **push** (a daily notification or
home-feed item telling you 3 people are due). No per-person *custom* cadence
override yet — the tiers are fixed to closeness, not independently settable
per person the way Mesh lets you say "remind me about this specific person
quarterly."

**A brief-generation script exists, but it isn't Mesh's Daily Brief.**
`scripts/brief/generate.ts` produces a **local markdown file** in `briefs/`
summarizing a day's events, interactions, action items, and upcoming plans —
paired with `scripts/brief/execute.ts`, which parses hand-edited annotations
back out of that file (`[x]` completes an action item, `[follow-up: Name]`
creates a Plan, `[note: Name]` appends a Note) and writes them back to the
graph. This is a genuinely more powerful pattern than Mesh's read-only
digest — it's a two-way, editable planning surface — but it's a manual
CLI/file workflow today, not a push notification or in-app "who am I meeting
today" card. No calendar-driven pre/in/post-meeting reminders exist at all.

**Duplicate detection is manual-only.** `apps/persons/server/domain/merge.ts`
and the `/people/merge`, `/people/clean`, `/api/v1/dedupe` surfaces are all
user-initiated review flows — swipe-to-merge, one pair at a time (already
documented in `docs/IOS_PLATFORM_PLAN.md` §5 as *better* than Mesh's wide
comparison table for the native build). There is no background job that
silently auto-merges obvious duplicates the way Mesh's "Resolve Duplicates"
toggle does. Confirmed: no scheduled/cron dedupe job exists anywhere in
`scripts/` or as a launchd job.

**No public shareable profile exists.** Confirmed by search — nothing in
`apps/persons` or `apps/home` implements a public-facing contact page. This
is a clean gap, and a genuinely good idea independent of Mesh (useful for
the founder's own networking, and later a natural free-tier hook for a
saleable Persons).

**Per-contact source provenance is tracked but under-surfaced.** The person
list only shows the *latest interaction's* source label (`WhatsApp`,
`iMessage`, `Email`, `Meeting`, `Call` — see `interactionSourceLabel` in the
same file), not a multi-badge "this person has data from Gmail *and*
iMessage *and* a CSV import" row the way Mesh shows. The underlying
provenance data mostly exists (every import/sync path already writes
source-tagged records), it just isn't aggregated and rendered as badges on
the list row.

**No news/social monitoring exists, and this is correctly out of scope for
now** — it requires a licensed third-party monitoring feed (the kind of
data broker relationship Mesh has, likely through Automattic's other
products or a data partner), not something to build from primitives. Treat
as a "maybe later, needs a vendor decision" item, not a backend task.

**No quick-capture affordance exists yet on mobile** — already correctly
identified and planned in `docs/IOS_PLATFORM_PLAN.md` §5 ("Capture: Voice,
share sheet, lock-screen widget, App Intent. Barely exists on web; the
phone's unique advantage"). Nothing new to add here; Mesh's radial
add/scan/remind menu is additional confirmation this is the right bet, not
new information.

**No billing, subscription tiers, or team workspace exist.** Confirmed
still true, matching the Prime-Time Readiness Audit's "commercial
operations: not built" finding. Out of scope for this document — that's a
StoreKit/Stripe integration decision, not a Persons feature.

**Groups already exceed anything shown in these Mesh screenshots.** Mesh's
screenshots show no group/household/team concept for organizing contacts
beyond the Members list (which is workspace access, not a life-graph
primitive). LifeOS's `Group` primitive — with subgroups, place-tagging, and
member management (`/api/groups/*`, already canonical-track candidate for a
future M5 slice) — has no Mesh equivalent shown here.

---

## 3. Gap table

| Feature | Mesh | Persons today | Gap | Priority |
|---|---|---|---|---|
| Relationship cadence / "needs attention" | Daily algorithmic count + per-person custom cadence, push-driven | Closeness-tiered cadence, computed, filter-driven (pull) | Make it push (home surface + notification); add per-person cadence override | High |
| Daily "who am I meeting today" | Push notification, auto-sent each morning | `scripts/brief` generates a local file, manually run | Wire existing brief data into a real push/in-app surface | High |
| Pre/in/post-meeting reminders | Three independent push toggles tied to calendar | None | New feature, calendar-triggered notifications | Medium |
| Automatic duplicate merge | Background, continuous, default-on | Manual review queue only | Add a conservative auto-merge tier (exact email/phone match) above the existing manual queue; already partially designed in §6.2 of `IOS_PLATFORM_PLAN.md` ("two confidence tiers... exact match auto-merges silently") | High — already planned, not yet built |
| Per-contact source badges | Icon per contributing source, per row | Only latest-interaction source shown | Aggregate known sources per Person, render as badges | Medium |
| Public shareable profile | `me.sh/profile/<user>` | None | New feature | Medium |
| Multi-account integration granularity | Per-account mail + calendar rows, independently toggleable | Bundled per-connection (see the `GMAIL_SCOPE` note in §6.1 of `IOS_PLATFORM_PLAN.md`) | Split mail/calendar/contacts consent per account | Medium — overlaps the already-planned OAuth consent split |
| News/social monitoring | 20,000+ publication feed, social post/profile-change alerts | None | Needs a vendor decision (data broker), not primitive engineering | Low / deferred |
| Quick capture (voice, share sheet, scan) | Radial add/scan/remind menu | None (planned) | Already scoped in `IOS_PLATFORM_PLAN.md` §5 | High (already on the roadmap) |
| Weekly digest | Sunday push notification | None | New feature, straightforward once Daily Brief is push-enabled | Low |
| Groups / households | Not shown in Mesh at all | Full primitive with subgroups | Persons already ahead | — |
| Dedupe/search/filtering UX | Named as Mesh's weakest points in public reviews | Already-built merge/dedupe commands, keyset-paginated filtering | Persons already ahead per the existing competitive note in `IOS_PLATFORM_PLAN.md` §7 | — |

---

## 4. The LinkedIn question

Already researched in depth in `docs/IOS_PLATFORM_PLAN.md` §6.1 — no crafty
legitimate path exists. Restating the finding: LinkedIn's open API access
ended in 2015; today's partner tiers gate connection-level data behind a
four-to-sixteen-week approval process and explicitly exclude non-personal
use cases; scraping violates LinkedIn's user agreement and would jeopardize
the product. The realistic, already-planned path is the user's own **data
export** (Settings → Data Privacy → Get a copy of your data → Connections),
built as a first-class "here's how to request your export, then drop the
file here" import flow — genuinely useful enrichment data, honestly
sourced. Nothing in the Mesh screenshots suggests they've solved this any
differently — Mesh's `in` badges on contact rows almost certainly come from
the same categories of legitimately-available signal (the user's own
LinkedIn data export or LinkedIn's public profile pages when a contact
shares one), not a live scraped connection graph.

---

## 5. Recommended build order

Sequenced by what's cheapest given what already exists, not by Mesh's own
priority:

1. **Push the existing Attention/cadence data instead of just filtering
   for it.** The hard part (per-person relationship-status computation) is
   done. Surface it as a Home-feed-equivalent or a daily notification. This
   is the single highest-leverage item — real logic already built, just not
   surfaced proactively.
2. **Turn `scripts/brief` into a served, push-notified Daily Brief.** The
   data model already matches Mesh's ("who are you meeting today, what's
   outstanding") and the annotation-driven write-back is more capable than
   Mesh's read-only digest — it just needs a delivery mechanism (push
   notification / in-app card) instead of a local file a human has to open.
3. **Add the auto-merge tier already designed but not built** — exact
   email/phone match auto-merges silently, everything fuzzier stays in the
   existing manual queue. This was already scoped in `IOS_PLATFORM_PLAN.md`
   §6.2 before this document existed; treat it as confirmed, not new.
4. **Ship the native quick-capture affordances** — already on the roadmap,
   Mesh's radial menu is just further evidence it's the right bet.
5. **Public profile page.** Self-contained, no dependency on other work,
   plausible early wedge for a saleable Persons' free tier later.
6. **Per-contact source badges.** Mostly a rendering task over data that's
   already captured at import/sync time.
7. **Pre/in/post-meeting reminders and Weekly Digest.** Real but lower
   priority — nice relationship-maintenance polish once the above lands.
8. **News/social monitoring, split OAuth consent, team workspace, billing.**
   Explicitly deferred — each needs either a vendor/data decision, product
   decision, or is out of scope for a personal-line rollout and belongs to
   the eventual saleable Persons track.

---

## 6. Related documents

- `docs/IOS_PLATFORM_PLAN.md` §5–7 — native Persons scope, contact
  ingestion, the saleable-Persons blockers this parity work feeds into.
- `docs/PERSONS_ARCHITECTURE.md` — current Persons app architecture.
- `docs/MANIFESTO.md` — the eight primitives; nothing in this plan proposes
  a ninth.
