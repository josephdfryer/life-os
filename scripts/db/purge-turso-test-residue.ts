#!/usr/bin/env tsx
// One-shot cleanup for the Turso -> Postgres cutover (P8 prep).
//
// The `apps/api` integration suite used to run against production Turso, which
// does not enforce foreign keys, so it left rows behind whose `workspaceId`
// points at a Workspace that was never committed (or was deleted). SQLite
// tolerated the dangle; Postgres does not, so the ETL synthesizes placeholder
// "orphaned_test_fixture" Workspaces to keep those rows loadable.
//
// Running this against Turso during the write-freeze deletes the residue at the
// source instead, so production Neon comes up clean. It is deliberately
// conservative: it only touches rows whose workspaceId has NO matching
// Workspace row, and it prints the plan and requires --execute to act.
//
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... tsx scripts/db/purge-turso-test-residue.ts
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... tsx scripts/db/purge-turso-test-residue.ts --execute

import fs from "node:fs"
import path from "node:path"
import { createClient } from "@libsql/client"

const ROOT = path.resolve(import.meta.dirname, "../..")
for (const file of [path.join(ROOT, ".env"), path.join(ROOT, "apps/persons/.env")]) {
  if (!fs.existsSync(file)) continue
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

const EXECUTE = process.argv.includes("--execute")

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url) throw new Error("TURSO_DATABASE_URL is required")
  const db = createClient({ url, authToken })

  const tables = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'`,
  )
  const withWorkspace: string[] = []
  for (const row of tables.rows) {
    const name = String(row.name)
    const info = await db.execute(`PRAGMA table_info("${name}")`)
    if (info.rows.some((c) => c.name === "workspaceId")) withWorkspace.push(name)
  }

  const plan: Array<{ table: string; count: number }> = []
  for (const table of withWorkspace) {
    const r = await db.execute(
      `SELECT count(*) AS n FROM "${table}" WHERE workspaceId IS NOT NULL AND workspaceId NOT IN (SELECT id FROM "Workspace")`,
    )
    const n = Number(r.rows[0].n)
    if (n) plan.push({ table, count: n })
  }

  const total = plan.reduce((sum, p) => sum + p.count, 0)
  console.log(`Orphan rows (workspaceId with no Workspace): ${total} across ${plan.length} tables`)
  for (const p of plan) console.log(`  ${p.table.padEnd(24)} ${p.count}`)
  if (!total) return

  if (!EXECUTE) {
    console.log("\nDry run. Re-run with --execute to delete these rows.")
    return
  }

  // Delete children before parents is not required here — every row deleted has
  // a dangling parent already, so nothing valid references it. Deleting in
  // reverse-size order keeps the log readable.
  await db.execute("PRAGMA foreign_keys = OFF")
  let deleted = 0
  for (const { table } of plan) {
    const r = await db.execute(
      `DELETE FROM "${table}" WHERE workspaceId IS NOT NULL AND workspaceId NOT IN (SELECT id FROM "Workspace")`,
    )
    deleted += r.rowsAffected
    console.log(`  deleted ${r.rowsAffected} from ${table}`)
  }
  console.log(`\nDeleted ${deleted} orphan rows.`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
