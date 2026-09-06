#!/usr/bin/env tsx
// Give every transaction a counterparty node.
//
// A merchant is a collective, not a human, so it is a Group — the manifesto is
// explicit that Person is for humans only. (docs/ERA_FINANCE_INTEGRATION.md
// proposed Person-with-company; that predates the Group primitive and is wrong.)
// The specific storefront is a Place, joined to the Group later via PlaceGroup
// `corporate_parent` — see scripts/era/resolve-merchant-places.ts.
//
// Usage:
//   npx tsx scripts/era/link-merchant-groups.ts --dry-run
//   npx tsx scripts/era/link-merchant-groups.ts
//   npx tsx scripts/era/link-merchant-groups.ts --min-count 1 --min-cents 0
//
// Idempotent: Groups are matched by name, and an interaction that already has a
// counterparty edge is left alone — which also means a hand-corrected edge
// (band "manual") is never overwritten.

import fs from "node:fs"
import path from "node:path"
import { merchantKey, isNonMerchant, preferredDisplayName } from "./lib/merchant"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
for (const candidate of [path.join(REPO_ROOT, ".env"), path.join(REPO_ROOT, "apps/persons/.env")]) {
  if (!fs.existsSync(candidate)) continue
  for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

const WORKSPACE_ID = "default-workspace"
const DRY_RUN = process.argv.includes("--dry-run")
// Remove merchant Groups that the current rules would no longer create.
const flagPrune = process.argv.includes("--prune")
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}
// A node earns its place by recurring, or by being material once. Everything
// below the bar keeps its merchantName column and stays queryable as text.
const MIN_COUNT = arg("min-count", 2)
const MIN_CENTS = arg("min-cents", 10_000)
const BATCH = 200

// "counterparty", not "merchant": the same edge has to describe the employer on
// an incoming paycheck as well as the shop on an outgoing charge. "payer" is
// already taken by the household Group on shared accounts.
const ROLE = "counterparty"

type Bucket = {
  key: string
  variants: Map<string, number>
  interactionIds: string[]
  cents: number
}

async function main() {
  const { db } = await import("@life-os/db")
  console.log(DRY_RUN ? "DRY RUN — no writes\n" : "LIVE RUN\n")

  // Tightening the non-merchant rules leaves behind Groups created under the
  // looser ones. Remove only corporation Groups this script would no longer
  // create, and only when nothing but its own counterparty edges reference
  // them — a Group a human has since used for anything else is left alone.
  if (flagPrune) {
    const corporations = await db.group.findMany({
      where: { workspaceId: WORKSPACE_ID, groupType: "corporation" },
      select: { id: true, name: true, personMembers: { select: { id: true } }, eraAccounts: { select: { id: true } } },
    })
    const stale = corporations.filter(g => isNonMerchant(g.name) && g.personMembers.length === 0 && g.eraAccounts.length === 0)
    console.log(`Prune: ${stale.length} corporation Group(s) no longer qualify as merchants`)
    for (const group of stale) console.log(`  - ${group.name}`)
    if (!DRY_RUN && stale.length > 0) {
      const ids = stale.map(g => g.id)
      const edges = await db.interactionParticipant.deleteMany({
        where: { entityType: "Group", role: ROLE, entityId: { in: ids } },
      })
      const groups = await db.group.deleteMany({ where: { id: { in: ids } } })
      console.log(`  removed ${edges.count} edge(s) and ${groups.count} group(s)`)
    }
    console.log("")
  }

  const rows = await db.interaction.findMany({
    where: { workspaceId: WORKSPACE_ID, type: "financial", merchantName: { not: null } },
    select: { id: true, merchantName: true, amount: true, subtype: true },
  })

  const buckets = new Map<string, Bucket>()
  let skippedTransfer = 0
  let skippedBankOps = 0

  for (const row of rows) {
    const name = row.merchantName!
    if (row.subtype === "transfer") { skippedTransfer += 1; continue }
    if (isNonMerchant(name)) { skippedBankOps += 1; continue }
    const key = merchantKey(name)
    if (!key) { skippedBankOps += 1; continue }

    const bucket: Bucket = buckets.get(key)
      ?? { key, variants: new Map<string, number>(), interactionIds: [], cents: 0 }
    bucket.variants.set(name, (bucket.variants.get(name) ?? 0) + 1)
    bucket.interactionIds.push(row.id)
    bucket.cents += row.amount ?? 0
    buckets.set(key, bucket)
  }

  const eligible = [...buckets.values()]
    .filter(b => b.interactionIds.length >= MIN_COUNT || b.cents >= MIN_CENTS)
    .sort((a, b) => b.interactionIds.length - a.interactionIds.length)

  const linkable = eligible.reduce((sum, b) => sum + b.interactionIds.length, 0)
  console.log(`financial rows with a merchant name: ${rows.length}`)
  console.log(`  skipped — transfers:               ${skippedTransfer}`)
  console.log(`  skipped — bank machinery:          ${skippedBankOps}`)
  console.log(`distinct merchants:                  ${buckets.size}`)
  console.log(`  meeting the bar (>=${MIN_COUNT} txns or >=$${MIN_CENTS / 100}): ${eligible.length}`)
  console.log(`  covering ${linkable} transactions\n`)

  if (DRY_RUN) {
    for (const bucket of eligible.slice(0, 12)) {
      const name = preferredDisplayName([...bucket.variants].map(([n, count]) => ({ name: n, count })))
      console.log(`  ${String(bucket.interactionIds.length).padStart(4)}x  $${(bucket.cents / 100).toFixed(2).padStart(10)}  ${name}`)
    }
    console.log(`  ...and ${Math.max(0, eligible.length - 12)} more`)
    return
  }

  // ── Groups ────────────────────────────────────────────────────────────
  const existingGroups = await db.group.findMany({
    where: { workspaceId: WORKSPACE_ID, groupType: "corporation" },
    select: { id: true, name: true },
  })
  const groupIdByKey = new Map(existingGroups.map(g => [merchantKey(g.name), g.id]))

  let createdGroups = 0
  for (const bucket of eligible) {
    if (groupIdByKey.has(bucket.key)) continue
    const name = preferredDisplayName([...bucket.variants].map(([n, count]) => ({ name: n, count })))
    const group = await db.group.create({
      data: {
        workspaceId: WORKSPACE_ID,
        name,
        groupType: "corporation",
        notes: `Merchant derived from ${bucket.interactionIds.length} transaction(s). Spellings seen: ${[...bucket.variants.keys()].slice(0, 5).join(" | ")}`,
      },
      select: { id: true },
    })
    groupIdByKey.set(bucket.key, group.id)
    createdGroups += 1
    if (createdGroups % 100 === 0) console.log(`  created ${createdGroups} groups…`)
  }
  console.log(`Groups created: ${createdGroups} (reused ${eligible.length - createdGroups})`)

  // ── Edges ─────────────────────────────────────────────────────────────
  // Bulk insert rather than attachContext per row: 4,000+ sequential round
  // trips to the database takes ~30 minutes. Existing edges are read first and
  // skipped, which preserves the manual-band guarantee exactly as
  // attachContext would — a hand-corrected edge is never touched.
  const alreadyLinked = new Set<string>()
  const allIds = eligible.flatMap(b => b.interactionIds)
  for (let i = 0; i < allIds.length; i += 500) {
    const existing = await db.interactionParticipant.findMany({
      where: { interactionId: { in: allIds.slice(i, i + 500) }, entityType: "Group", role: ROLE },
      select: { interactionId: true },
    })
    for (const row of existing) alreadyLinked.add(row.interactionId)
  }

  const pending: { interactionId: string; workspaceId: string; entityType: string; entityId: string; role: string; band: string; source: string; confidence: number; evidence: string }[] = []
  for (const bucket of eligible) {
    const groupId = groupIdByKey.get(bucket.key)
    if (!groupId) continue
    for (const interactionId of bucket.interactionIds) {
      if (alreadyLinked.has(interactionId)) continue
      pending.push({
        interactionId,
        workspaceId: WORKSPACE_ID,
        entityType: "Group",
        entityId: groupId,
        role: ROLE,
        band: "auto",
        source: "merchant-normalize",
        confidence: 1,
        evidence: JSON.stringify({ merchantKey: bucket.key }),
      })
    }
  }

  let written = 0
  for (let i = 0; i < pending.length; i += BATCH) {
    const result = await db.interactionParticipant.createMany({ data: pending.slice(i, i + BATCH) })
    written += result.count
    if (written % 1000 === 0 || i + BATCH >= pending.length) console.log(`  linked ${written}/${pending.length}`)
  }

  console.log(`\nDone. ${written} counterparty edge(s) written, ${alreadyLinked.size} already present.`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
