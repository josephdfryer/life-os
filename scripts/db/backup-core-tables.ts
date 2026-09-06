#!/usr/bin/env tsx
// Full-database backup before a migration. Generalizes
// scripts/db/backup-finance-tables.ts (which stays as-is for its own
// narrower, still-referenced use) to every table rather than a curated list —
// "back up production first" should mean all data, not a guess at what a
// given change might touch.
//
// Dumps every real table to timestamped JSON. Read-only against the database.
//
// Usage:
//   npx tsx scripts/db/backup-core-tables.ts [outDir]
//   npx tsx scripts/db/backup-core-tables.ts --only Person,Interaction,Plan
//
// Default outDir: backups/core-<ISO timestamp>/

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

// Housekeeping tables that are never application data.
const SKIP = new Set(["sqlite_sequence", "_prisma_migrations"])

function parseArgs(argv: string[]) {
  const onlyFlag = argv.indexOf("--only")
  const only = onlyFlag >= 0 ? argv[onlyFlag + 1]?.split(",").map(s => s.trim()).filter(Boolean) : undefined
  const outDir = argv.find((arg, i) => !arg.startsWith("--") && argv[i - 1] !== "--only")
  return { only, outDir }
}

async function main() {
  const { db } = await import("@life-os/db")
  const { only, outDir: outDirArg } = parseArgs(process.argv.slice(2))

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outDir = outDirArg ?? path.join(REPO_ROOT, "backups", `core-${stamp}`)
  fs.mkdirSync(outDir, { recursive: true })

  const allTables = await db.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  )
  const tables = allTables
    .map(row => row.name)
    .filter(name => !SKIP.has(name))
    .filter(name => (only ? only.includes(name) : true))

  if (only) {
    const missing = only.filter(name => !tables.includes(name))
    if (missing.length) console.warn(`  ! requested but not found: ${missing.join(", ")}`)
  }

  console.log(`Backing up ${tables.length} table(s) to ${outDir}\n`)

  const counts: Record<string, number> = {}
  for (const table of tables) {
    // Raw SQL keeps the dump faithful to what is actually stored, independent
    // of whatever the Prisma client currently believes the schema looks like —
    // important right before a migration changes that shape.
    const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${table}"`)
    counts[table] = rows.length
    fs.writeFileSync(
      path.join(outDir, `${table}.json`),
      // BigInt shows up in raw SQLite reads for integer columns.
      JSON.stringify(rows, (_key, value) => (typeof value === "bigint" ? Number(value) : value), 1),
    )
    console.log(`  ${table.padEnd(28)} ${rows.length}`)
  }

  const schema = await db.$queryRawUnsafe<{ name: string; tbl_name: string; sql: string | null }[]>(
    `SELECT name, tbl_name, sql FROM sqlite_master WHERE type IN ('index','table')`,
  )
  fs.writeFileSync(path.join(outDir, "_schema.json"), JSON.stringify(schema, null, 1))

  const manifest = {
    createdAt: new Date().toISOString(),
    database: redactedTarget(),
    tableCount: tables.length,
    rowCount: Object.values(counts).reduce((sum, n) => sum + n, 0),
    counts,
  }
  fs.writeFileSync(path.join(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2))

  console.log(`\nBackup written to ${outDir}`)
  console.log(`Total rows: ${manifest.rowCount.toLocaleString()}`)
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
