#!/usr/bin/env tsx
// Pre-migration backup for the finance-as-interactions change.
//
// Dumps every table the migration or backfill touches to timestamped JSON so a
// bad run can be reconstructed. Read-only against the database.
//
// Usage:
//   npx tsx scripts/db/backup-finance-tables.ts [outDir]
//
// Default outDir: backups/finance-<ISO timestamp>/

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

const TABLES = [
  "Interaction",
  "InteractionParticipant",
  "StagedInteraction",
  "EraTransactionLink",
  "EraAccountLink",
  "EraConnection",
  "Group",
  "PersonGroup",
] as const

async function main() {
  const { db } = await import("@life-os/db")

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outDir = process.argv[2] ?? path.join(REPO_ROOT, "backups", `finance-${stamp}`)
  fs.mkdirSync(outDir, { recursive: true })

  const counts: Record<string, number> = {}

  for (const table of TABLES) {
    // Raw SQL keeps the dump faithful to what is actually stored, independent of
    // whatever the Prisma client currently believes the schema looks like.
    const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${table}"`)
    counts[table] = rows.length
    fs.writeFileSync(
      path.join(outDir, `${table}.json`),
      // BigInt shows up in raw SQLite reads for integer columns.
      JSON.stringify(rows, (_key, value) => (typeof value === "bigint" ? Number(value) : value), 1),
    )
    console.log(`${table.padEnd(24)} ${rows.length}`)
  }

  const indexes = await db.$queryRawUnsafe<{ name: string; sql: string | null }[]>(
    `SELECT name, tbl_name, sql FROM sqlite_master WHERE type IN ('index','table')`,
  )
  fs.writeFileSync(path.join(outDir, "_schema.json"), JSON.stringify(indexes, null, 1))

  const manifest = { createdAt: new Date().toISOString(), database: redactedTarget(), counts }
  fs.writeFileSync(path.join(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2))

  console.log(`\nBackup written to ${outDir}`)
}

// Hostname only — the auth token must never reach a file on disk.
function redactedTarget() {
  const url = process.env.DATABASE_URL
  if (!url) return "unknown"
  try {
    return new URL(url).hostname
  } catch {
    return "unknown"
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
