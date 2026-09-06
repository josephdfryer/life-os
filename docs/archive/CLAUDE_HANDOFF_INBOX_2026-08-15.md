# Claude Handoff — Inbox / Review Spine

**Date:** 2026-08-15 (America/Los_Angeles)
**From:** Claude Code
**To:** Cursor
**Branch:** `master` · **HEAD when written:** `6a9dc8e`
**Companion doc:** `docs/CURSOR_HANDOFF_2026-08-15.md` (Codex → Cursor, iOS/device track). That
document treats this work as "concurrent Inbox commits — don't clobber." This one explains it.

**Track boundary.** I worked the spine: `packages/domain`, `packages/contracts`, `apps/api`,
`apps/home`. Codex worked native iOS + device auth. The one file we both touched is
`packages/contracts/index.ts` — commit `6a9dc8e` carries both my visit-group contract and Codex's
broad-health contract. Its test file is still dirty in Codex's worktree. Inspect before slicing
commits; don't rewrite that history to make it tidy.

---

## What shipped (4 commits, all deployed and live)

| Commit | What |
| --- | --- |
| `8741c37` | Every queue visible; dropdown replaced with a queue switcher carrying live counts |
| `a0bbfdf` | **Bug:** the canonical fetch was deleting the other queues |
| `54279a8` | **Bug:** confidence rendered as "7370%" |
| `6a9dc8e` | Place visits resolve per *place*, not per visit |

Deployed: `life-os-home` and `life-os-api`, both ● Ready. Gate at each commit: lint, type-check,
385/385 tests, 10/10 build.

### The two bugs, because the causes matter more than the fixes

**The canonical fetch was deleting queues.** `apps/home/app/inbox/page.tsx` server-renders every
queue; `FederatedInbox` then fetched `/api/review-items` and *replaced* its state with the response.
Only calendar reconciliation dual-writes into `ReviewItem` (43 rows, all calendar) — so about a
second after load, all 165 place visits and all 22 file-evidence items were discarded. Whichever tab
you were on went with them: the tab vanished from the switcher while the selection survived, leaving
a permanently empty list under a header still claiming 231 items.

Fixed by merging rather than swapping (`mergeQueues`). Canonical rows win where they exist, matched
on `sourceId` — the legacy row's own id — so a calendar decision is listed once, with buttons, never
twice. Everything the canonical feed says nothing about is kept, read-only.

**"7370% confidence."** `ImportStagedVisit.confidence` is scored **out of 100** — the Places importer
gates on `AUTO_CREATE_THRESHOLD = 70` / `STAGE_THRESHOLD = 30`. Everything else on the platform
stores a 0–1 fraction, and nothing had ever rendered that column as a percentage before, so the
inbox multiplied 73.7 by 100 again. The confidence *filter* was wrong for the same reason and more
quietly: every value above 1 cleared the `>= 0.8` test, so all 165 visits counted as high confidence
and Low returned nothing.

Fixed in `apps/home/lib/confidence.ts` — normalize at each read boundary, where the scale is known,
rather than guessing from magnitude.

### Place groups (the current shape of the biggest queue)

165 pending visits describe **three** places. 154 are one address the phone sees daily — Joseph's
home. The queue was asking the same question 154 times with no way to see where it was.

The inbox now groups place visits by place and shows name, address, visit count, date range, a Google
Maps link, and one action covering every pending visit there.

Accepting calls `POST /v1/staged-visits/resolve` → `resolveVisitGroup` in
`packages/domain/staged-visits.ts`, which creates the Place, creates one Event per visit (154 stays
are 154 events — collapsing the decision must not collapse the history), reuses any Event already
within two hours, and marks the staged rows accepted.

**The learning is a side effect, not a feature.** The Place carries the `googlePlaceId`, and the
importer's `upsertPlace` matches on `googlePlaceId` first — so future visits to that address resolve
there instead of being staged again. There is no rule to maintain.

---

## Production queue state at handoff

```
ReviewItem pending             43   ← calendar, shrinking on its own
ImportStagedVisit pending     165   ← three place groups, see below
EvidenceClaim unreviewed       15
FileEntityMention unresolved    7
StagedInteraction pending       0
NoteSuggestion pending          0
```

The three place groups:

| googlePlaceId | Name | Visits |
| --- | --- | --- |
| `ChIJT9ZLGc-_yIARq-q9j0YGmxc` | Red Rock Villas Apartments | **154** |
| `ChIJF_O0BVW-yIARbJTynA4pVBA` | *(unnamed)* | 7 |
| `ChIJ_aSJJ4uAhYARwjsz5CKXmTY` | Searched Address | 4 |

**These are still pending — Joseph has not clicked accept yet.** When he does, Red Rock writes 154
Events in one request. That is expected. `MAX_VISITS_PER_CALL = 400`, so it completes in one call;
above that the response reports `remaining` rather than silently doing half the job.

---

## Verification method — please keep using it

I shipped commit `8741c37` typechecked but never rendered, and Joseph found a bug in it within
minutes. Everything after that was verified by actually running the app. Both apps run locally
against a seeded scratch database; `LIFE_OS_LOCAL_REVIEW=1` is a **supported** non-production bypass
in `apps/home/lib/request-access.ts` — no auth hacking needed.

```bash
# 1. scratch DB
export DATABASE_URL="file:/tmp/inbox-demo.db"
npm run migrate:deploy -w @life-os/db     # note: the script lives in packages/db, not the root

# 2. seed a workspace + an API key (sha256 of the key into ApiKey.keyHash,
#    keyPrefix is required and @unique, scopes review.read + review.write)

# 3. both servers — home proxies to api, it does not query directly
DATABASE_URL=$DATABASE_URL AUTH_SECRET=local-only NEXTAUTH_SECRET=local-only \
  npm run dev --workspace api -- --port 3012
DATABASE_URL=$DATABASE_URL LIFE_OS_LOCAL_REVIEW=1 \
  LIFE_OS_API_URL=http://localhost:3012 PERSONS_API_KEY=<the key> \
  AUTH_SECRET=local-only NEXTAUTH_SECRET=local-only \
  npm run dev --workspace home -- --port 3011
```

Without `LIFE_OS_API_URL` + `PERSONS_API_KEY` the inbox falls back to legacy read-only mode and you
will **not** exercise the canonical path — which is exactly where the worst bug lived.

Seed data must match production's scale: `ImportStagedVisit.confidence` is 30–100, not 0–1.

One trap worth stating plainly: `unitConfidence` first lived in `FederatedInbox.tsx`, which is
`'use client'`. Typecheck passed, build passed, and the page threw at runtime — a Server Component
cannot call an export from a client module. Only running it catches that class of error.

---

## Open items, honestly ranked

1. **Places is still 165.** The mechanism is live but Joseph hasn't used it. If he reports it not
   working, get the browser network response from `/api/staged-visits/resolve` before theorizing.
2. **Per-source accept/dismiss ratios** (`docs/INBOX_TRIAGE_ANALYSIS.md` §6). `StagedInteraction`
   was historically dismissed 65% of the time — 1,780 of 2,744. That is a precision measurement and
   nothing consumes it. A source dismissed >30% of the time is a generator defect, not a triage
   problem.
3. **Keyboard triage mode** (§4) — `a`/`x`/`s`/`u`, optimistic advance, and **snooze**. The missing
   third option is why items rot: today the only choices are decide now or leave it pending forever.
4. **The legacy queue reads are capped at 500** (`apps/home/app/inbox/page.tsx`). Below that the tab
   counts are true; above it they under-report, which is the bug I just fixed at 100. If any queue
   approaches 500, count separately from what you render.
5. **The scale split is normalized at read, not resolved at rest.** `ImportStagedVisit.confidence`
   is still 0–100 in the database while the rest of the platform is 0–1. I fixed
   `apps/api/lib/device-ingest.ts`, which was about to write 0–1 into that same column (no rows had
   come through yet, so nothing to repair). Converting the column to 0–1 means touching the Places
   thresholds, enrichment, map-layers, the promote script, the era scripts, and 680 rows — worth
   doing, but it is a migration and should be its own decision, not a drive-by.
6. **11 `StagedInteraction` rows carry the wrong scale** (15–95, all `gmail`, all already dismissed).
   Cosmetic only; `unitConfidence` reads them correctly. Current writers all use 0–1.
7. **Calendar 43** clears itself as the 10-day window passes. `npm run inbox:reconcile-calendar`
   forces a pass.

## Worktree state — do not "clean" these

- `vercel.json` and `.vercel/project.json` are pointed at the **api** project from a config-swap. I
  restored them exactly as I found them rather than guessing which project Joseph wants linked.
  Deploys use the swap-then-restore method — see `project_multiapp_deploy` in Claude's memory.
- Everything else dirty is Codex's device/companion work. Read
  `docs/CURSOR_HANDOFF_2026-08-15.md` before touching it.
- `.claude/launch.json` is back to its committed state; my temporary local-server entries are gone.

## Files worth reading first

- `packages/domain/staged-visits.ts` — the visit-group resolver, with the reasoning in the header
- `apps/home/components/FederatedInbox.tsx` — `mergeQueues`, `queueTabs`, `groups`, `resolveGroup`
- `apps/home/app/inbox/page.tsx` — where each queue is read and normalized
- `apps/home/lib/confidence.ts` — why the scale has to be stated rather than inferred
- `docs/INBOX_TRIAGE_ANALYSIS.md` — the ranked plan these commits execute; items 1–3 are done

## The principle behind all of it

From the analysis doc, and it held up:

> The best inbox is the one you never have to open. Effort goes into not generating the item, then
> into deciding many at once, then into learning from the decision — and only last into making an
> individual decision prettier.

Filters were the only lever previously implemented, and they are the one lever that does not reduce
the work. If the queue fills faster than it clears, no interface makes answering pleasant.
