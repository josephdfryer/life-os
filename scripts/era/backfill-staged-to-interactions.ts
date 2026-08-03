#!/usr/bin/env tsx
// Promote staged Era transactions into canonical Interactions.
// See docs/FINANCE_INTERACTION_MODEL_PLAN.md §1 and §4.
//
// A transaction is already true — it does not need permission to enter the
// graph. This moves every staged Era row into `Interaction` with real columns
// (amount, category, merchant, account, actor) so it is queryable in SQL, and
// carries any place-match evidence across as an `InteractionParticipant` edge
// so context can keep accruing later.
//
// Usage:
//   npx tsx scripts/era/backfill-staged-to-interactions.ts --dry-run
//   npx tsx scripts/era/backfill-staged-to-interactions.ts
//   npx tsx scripts/era/backfill-staged-to-interactions.ts --limit 50
//
// Idempotent and resumable: Interaction(workspaceId, source, sourceId) is
// unique, so re-runs update in place rather than duplicating. Safe to re-run
// after new transactions sync in.

import fs from "node:fs"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")

for (const candidate of [path.join(REPO_ROOT, ".env"), path.join(REPO_ROOT, "apps/persons/.env")]) {
  if (!fs.existsSync(candidate)) continue
  for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}
// Write through to the primary, never a local replica.
delete process.env.TURSO_SYNC_URL

const WORKSPACE_ID = "default-workspace"
const TZ = "America/Los_Angeles"
const DRY_RUN = process.argv.includes("--dry-run")
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit")
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity
})()

type EraMeta = {
  eraTransactionId?: string
  eraAccountId?: string
  accountName?: string
  eraCategory?: string
  eraCategoryKey?: string
  rawAmount?: number
  amount?: number
  currency?: string
  merchantName?: string | null
  rawDescription?: string | null
  postedDate?: string | null
  transfer?: boolean
  placeMatch?: {
    band?: string
    confidence?: number
    reasoning?: string
    evidence?: string[]
    googlePlaceId?: string | null
    placeName?: string | null
    visitId?: string | null
    merchantPlace?: { name?: string; googlePlaceId?: string | null } | null
  }
}

async function main() {
  const { db, attachContext } = await import("@life-os/db")

  console.log(DRY_RUN ? "DRY RUN — no writes\n" : "LIVE RUN\n")

  const staged = await db.stagedInteraction.findMany({
    where: { workspaceId: WORKSPACE_ID, source: "era" },
    orderBy: { timestamp: "asc" },
  })
  console.log(`Staged Era rows: ${staged.length}`)

  // Resolve the lookup tables once instead of per row.
  const accountLinks = await db.eraAccountLink.findMany({
    where: { workspaceId: WORKSPACE_ID },
    select: { id: true, eraAccountId: true, ownerPersonId: true, isShared: true, householdGroupId: true },
  })
  const accountByEraId = new Map(accountLinks.map(a => [a.eraAccountId, a]))

  const places = await db.place.findMany({
    where: { workspaceId: WORKSPACE_ID, googlePlaceId: { not: null } },
    select: { id: true, googlePlaceId: true },
  })
  const placeByGoogleId = new Map(places.map(p => [p.googlePlaceId!, p.id]))

  const stats = {
    created: 0,
    updated: 0,
    skippedNoAmount: 0,
    placesLinked: 0,
    placeMatchRecorded: 0,
    actorAttributed: 0,
    householdAttributed: 0,
    unattributed: 0,
  }

  let processed = 0
  for (const row of staged) {
    if (processed >= LIMIT) break
    processed += 1

    const meta = parseJson<EraMeta>(row.metadata) ?? {}
    const amountDollars = typeof meta.amount === "number" ? meta.amount : Math.abs(Number(meta.rawAmount ?? NaN))
    if (!Number.isFinite(amountDollars)) {
      stats.skippedNoAmount += 1
      console.warn(`  ! ${row.sourceId}: no usable amount, skipped`)
      continue
    }

    const account = meta.eraAccountId ? accountByEraId.get(meta.eraAccountId) : undefined
    const isTransfer = meta.transfer === true || row.direction === "transfer"

    // Attribution ladder (plan §3): owned account -> shared account -> unknown.
    const actorPersonId = account?.ownerPersonId ?? null
    if (actorPersonId) stats.actorAttributed += 1
    else if (account?.isShared) stats.householdAttributed += 1
    else stats.unattributed += 1

    const data = {
      workspaceId: WORKSPACE_ID,
      type: "financial",
      subtype: subtypeFor(row.direction, isTransfer, meta.eraCategory),
      // Era gives a date with no time. Anchor it to local midnight so
      // "what did I spend yesterday" doesn't fall a day short in Pacific.
      timestamp: localMidnightUtc(row.timestamp),
      amount: Math.round(amountDollars * 100), // integer cents
      direction: isTransfer ? "transfer" : (row.direction ?? "paid"),
      currency: meta.currency ?? "USD",
      category: meta.eraCategory ?? null,
      // `description` from Era, already cleaned. Never `merchant_name`, which is
      // frequently the payment rail ("Google Pay") or absent.
      merchantName: row.contactName ?? meta.rawDescription ?? null,
      summary: row.summary ?? row.contactName ?? null,
      accountLinkId: account?.id ?? null,
      actorPersonId,
      billable: false,
      metadata: JSON.stringify({
        eraAccountId: meta.eraAccountId ?? null,
        accountName: meta.accountName ?? null,
        eraCategoryKey: meta.eraCategoryKey ?? null,
        rawAmount: meta.rawAmount ?? null,
        rawDescription: meta.rawDescription ?? null,
        postedDate: meta.postedDate ?? null,
        transfer: isTransfer,
        // Era dates carry no clock time; the reconciler matches on the whole day.
        timePrecision: "day",
      }),
    }

    if (DRY_RUN) {
      if (stats.created < 3) {
        console.log(`  would create: ${data.timestamp.toISOString()} ${data.merchantName} ` +
          `${data.direction} $${(data.amount / 100).toFixed(2)} [${data.category}] actor=${actorPersonId ?? "—"}`)
      }
      stats.created += 1
      continue
    }

    // Idempotent on (workspaceId, source, sourceId). Re-running refreshes the
    // derived columns without ever creating a duplicate.
    const existing = await db.interaction.findUnique({
      where: { workspaceId_source_sourceId: { workspaceId: WORKSPACE_ID, source: "era", sourceId: row.sourceId } },
      select: { id: true },
    })

    const interaction = existing
      ? await db.interaction.update({ where: { id: existing.id }, data })
      : await db.interaction.create({ data: { ...data, source: "era", sourceId: row.sourceId } })

    if (existing) stats.updated += 1
    else stats.created += 1

    // Carry the existing place-match work across as a participant edge, with the
    // band it was originally decided at. The reconciler may revisit anything
    // that is not "manual"; nothing here is manual, so nothing is frozen.
    const match = meta.placeMatch
    const googlePlaceId = match?.googlePlaceId ?? match?.merchantPlace?.googlePlaceId ?? null
    const placeId = googlePlaceId ? placeByGoogleId.get(googlePlaceId) ?? null : null

    if (placeId) {
      await db.interaction.update({ where: { id: interaction.id }, data: { placeId } })
      await attachContext(db, {
        interactionId: interaction.id,
        workspaceId: WORKSPACE_ID,
        entityType: "Place",
        entityId: placeId,
        role: "location",
        confidence: match?.confidence ?? null,
        // "online"/"unmatched" are not trust bands — anything unrecognised is a
        // suggestion, not something to aggregate on.
        band: match?.band === "adjudicated" ? "adjudicated" : match?.band === "auto" ? "auto" : "suggested",
        source: "era-backfill",
        evidence: {
          googlePlaceId,
          placeName: match?.placeName ?? match?.merchantPlace?.name ?? null,
          visitId: match?.visitId ?? null,
          reasoning: match?.reasoning ?? null,
          matchEvidence: match?.evidence ?? null,
        },
      })
      stats.placesLinked += 1
    } else if (match?.band) {
      // No Place node yet, but the adjudication result is worth keeping so the
      // reconciler doesn't redo work it already paid an LLM for.
      stats.placeMatchRecorded += 1
    }

    // Joint accounts attribute to the household, not falsely to one spouse.
    if (!actorPersonId && account?.isShared && account.householdGroupId) {
      await attachContext(db, {
        interactionId: interaction.id,
        workspaceId: WORKSPACE_ID,
        entityType: "Group",
        entityId: account.householdGroupId,
        role: "payer",
        confidence: 1,
        band: "auto",
        source: "account-ownership",
        evidence: { reason: "shared account", eraAccountId: meta.eraAccountId },
      })
    }

    // The staged row has done its job — record that it was promoted.
    await db.stagedInteraction.update({
      where: { id: row.id },
      data: { status: "accepted", acceptedAt: row.acceptedAt ?? new Date(), interactionId: interaction.id },
    })

    await db.eraTransactionLink.updateMany({
      where: { workspaceId: WORKSPACE_ID, eraTransactionId: row.sourceId },
      data: { status: "accepted", interactionId: interaction.id },
    })

    if ((stats.created + stats.updated) % 100 === 0) {
      console.log(`  ...${stats.created + stats.updated} processed`)
    }
  }

  console.log("\nResult")
  console.log(`  created                ${stats.created}`)
  console.log(`  updated (re-run)       ${stats.updated}`)
  console.log(`  skipped (no amount)    ${stats.skippedNoAmount}`)
  console.log(`  place linked           ${stats.placesLinked}`)
  console.log(`  place match, no node   ${stats.placeMatchRecorded}`)
  console.log(`  actor attributed       ${stats.actorAttributed}`)
  console.log(`  household attributed   ${stats.householdAttributed}`)
  console.log(`  unattributed           ${stats.unattributed}`)
  if (stats.unattributed > 0 && !DRY_RUN) {
    console.log(`\n  ${stats.unattributed} rows have no actor — set EraAccountLink.ownerPersonId`)
    console.log(`  (npx tsx scripts/era/set-account-owners.ts), then re-run this script.`)
  }
}

// Era categories that mean money genuinely earned, rather than money coming
// back. A credit in a spending category ("Dining out", "Ride shares") is a
// refund or reversal; a credit in one of these is income.
const INCOME_CATEGORIES = new Set([
  "Paychecks",
  "Interest and dividends",
  "Side hustles and business",
])

function subtypeFor(direction: string | null, isTransfer: boolean, category?: string) {
  if (isTransfer) return "transfer"
  if (direction === "received") return category && INCOME_CATEGORIES.has(category) ? "income" : "refund"
  return "purchase"
}

// Era's transaction_date has no clock component. It was previously stored as
// UTC midnight, which renders as the PREVIOUS day in Pacific. Re-anchor to
// local midnight so day-boundary queries are correct.
function localMidnightUtc(stored: Date) {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(stored)
  const [year, month, day] = ymd.split("-").map(Number)
  let utc = Date.UTC(year, month - 1, day, 0, 0, 0)
  // Two passes converge on the correct offset across DST boundaries.
  for (let i = 0; i < 2; i += 1) {
    utc = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs(new Date(utc))
  }
  return new Date(utc)
}

function offsetMs(date: Date) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" })
    .formatToParts(date).find(p => p.type === "timeZoneName")?.value
  const m = part?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/)
  if (!m) return 0
  return (m[1] === "+" ? 1 : -1) * ((Number(m[2]) * 60) + Number(m[3] ?? 0)) * 60_000
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
