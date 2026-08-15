#!/usr/bin/env tsx
// Clears the standing calendar-reconciliation backlog by resolving what the
// evidence already answers and retiring what has gone stale. Safe to re-run —
// it only ever touches Plans that are still unreconciled.
//
//   npx tsx scripts/reconcile-calendar-backlog.ts [--dry-run]

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const dotenv = require("dotenv") as { config(o: { path: string; quiet?: boolean }): void }
for (const file of [".env.local", ".env"]) dotenv.config({ path: file, quiet: true })

const workspaceId = process.env.LIFE_OS_WORKSPACE_ID ?? "default-workspace"

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const { db } = await import("@life-os/db")
  const before = await db.reviewItem.count({ where: { workspaceId, source: "calendar_reconciliation", status: "pending" } })
  console.log(`[reconcile] ${before} pending calendar review item(s) before`)

  if (dryRun) {
    console.log("[reconcile] --dry-run: nothing written.")
    await db.$disconnect()
    return
  }

  const { matchCalendarOutcomes } = await import("@life-os/domain")
  const results = await matchCalendarOutcomes(workspaceId)
  const happened = results.filter(r => r.outcome === "happened").length
  const skipped = results.filter(r => r.outcome === "skipped").length
  const after = await db.reviewItem.count({ where: { workspaceId, source: "calendar_reconciliation", status: "pending" } })

  console.log(`[reconcile] resolved from evidence: ${happened}`)
  console.log(`[reconcile] retired as unresolved:  ${skipped}`)
  console.log(`[reconcile] ${after} pending remaining (needs a real decision)`)
  await db.$disconnect()
}

main().catch(error => { console.error(error); process.exit(1) })
