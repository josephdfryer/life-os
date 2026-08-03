#!/usr/bin/env tsx
// Import Era transactions straight into canonical Interactions.
//
// This is the ingest path described in docs/FINANCE_INTERACTION_MODEL_PLAN.md §4:
// a transaction is already true, so it lands complete and queryable immediately.
// Nothing waits in a review queue; context attaches later via attachContext().
//
// Input: a directory of JSON files, each either an array of Era transactions or
// an object with a `transactions` array (i.e. raw list_transactions responses).
//
//   npx tsx scripts/era/import-transactions.ts <dir> [--dry-run]
//
// Idempotent: dedupes on Interaction(workspaceId, source, sourceId). Re-running
// over the same dump imports nothing. Bulk-inserts in batches, because every
// statement against Turso is an HTTP round trip.

import fs from "node:fs"
import path from "node:path"
import { mapEraTransaction, type EraTransaction } from "./lib/map-transaction"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
for (const candidate of [path.join(REPO_ROOT, ".env"), path.join(REPO_ROOT, "apps/persons/.env")]) {
  if (!fs.existsSync(candidate)) continue
  for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}
delete process.env.TURSO_SYNC_URL

const WORKSPACE_ID = "default-workspace"
const DRY_RUN = process.argv.includes("--dry-run")
const BATCH_SIZE = 200

async function main() {
  const dir = process.argv[2]
  if (!dir) {
    console.error("Usage: npx tsx scripts/era/import-transactions.ts <dir> [--dry-run]")
    process.exit(1)
  }

  const { db } = await import("@life-os/db")
  console.log(DRY_RUN ? "DRY RUN — no writes\n" : "LIVE RUN\n")

  // ── Collect + dedupe the dump ─────────────────────────────────────────
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json") && !f.startsWith("_") && f !== "accounts.json").sort()
  const seen = new Set<string>()
  const transactions: EraTransaction[] = []
  for (const file of files) {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))
    for (const txn of (parsed.transactions ?? parsed) as EraTransaction[]) {
      if (!txn?.transaction_id || seen.has(txn.transaction_id)) continue
      seen.add(txn.transaction_id)
      transactions.push(txn)
    }
  }
  console.log(`Transactions in dump: ${transactions.length} (${files.length} file(s))`)
  if (transactions.length === 0) return

  // ── Resolve accounts and their owners once ────────────────────────────
  const accountLinks = await db.eraAccountLink.findMany({
    where: { workspaceId: WORKSPACE_ID },
    select: { id: true, eraAccountId: true, ownerPersonId: true, isShared: true, householdGroupId: true },
  })
  const accountByEraId = new Map(accountLinks.map(a => [a.eraAccountId, a]))

  const unknownAccounts = new Set(
    transactions.map(t => t.account_group_key).filter(key => !accountByEraId.has(key)))
  if (unknownAccounts.size > 0) {
    console.warn(`\n  ! ${unknownAccounts.size} unknown account(s): ${[...unknownAccounts].join(", ")}`)
    console.warn(`    Run the account sync first, or those rows land without an account/actor.\n`)
  }

  // ── Skip anything already imported ────────────────────────────────────
  const ids = transactions.map(t => t.transaction_id)
  const existing = new Set<string>()
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db.interaction.findMany({
      where: { workspaceId: WORKSPACE_ID, source: "era", sourceId: { in: ids.slice(i, i + 500) } },
      select: { sourceId: true },
    })
    for (const row of rows) if (row.sourceId) existing.add(row.sourceId)
  }
  const fresh = transactions.filter(t => !existing.has(t.transaction_id))
  console.log(`Already imported: ${existing.size}   New: ${fresh.length}`)
  if (fresh.length === 0) {
    console.log("\nNothing to do.")
    return
  }

  const dates = fresh.map(t => t.transaction_date).sort()
  console.log(`Date range: ${dates[0]} -> ${dates.at(-1)}`)

  const rows = fresh.map(txn => {
    const mapped = mapEraTransaction(txn)
    const account = accountByEraId.get(txn.account_group_key)
    return {
      workspaceId: WORKSPACE_ID,
      ...mapped,
      accountLinkId: account?.id ?? null,
      // Attribution ladder: an owned account names a person; a shared account
      // deliberately names nobody and is attributed to the household instead.
      actorPersonId: account?.ownerPersonId ?? null,
    }
  })

  if (DRY_RUN) {
    for (const row of rows.slice(0, 5)) {
      console.log(`  would create: ${row.timestamp.toISOString().slice(0, 10)} ${row.merchantName} ` +
        `${row.direction} $${(row.amount / 100).toFixed(2)} [${row.category}]`)
    }
    console.log(`\n  ...and ${Math.max(0, rows.length - 5)} more`)
    return
  }

  // ── Bulk insert ───────────────────────────────────────────────────────
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const result = await db.interaction.createMany({ data: batch })
    inserted += result.count
    console.log(`  inserted ${inserted}/${rows.length}`)
  }

  // ── Household attribution for shared accounts ─────────────────────────
  // Done as a follow-up pass so the bulk insert stays a single statement.
  const sharedCount = rows.filter(r => {
    const account = accountLinks.find(a => a.id === r.accountLinkId)
    return account?.isShared && account.householdGroupId
  }).length
  if (sharedCount > 0) {
    console.log(`\n${sharedCount} row(s) on shared accounts need household attribution.`)
    console.log(`Run: npx tsx scripts/era/rederive-actor-attribution.ts`)
  }

  console.log(`\nDone. Imported ${inserted} transaction(s) as canonical Interactions.`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
