#!/usr/bin/env tsx
// One-time: copy ImportJob + ImportStagedVisit rows (with Claude enrichment)
// from the local dev SQLite file into production Turso. The places dev server
// wrote them locally because apps/places/.env.local pointed at dev.db.

import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { createClient } from "@libsql/client"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")

for (const line of fs.readFileSync(path.join(REPO_ROOT, "apps/persons/.env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}

async function main() {
  const local = new Database(path.join(REPO_ROOT, "packages/dev.db"), { readonly: true })
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  const jobs = local.prepare("SELECT * FROM ImportJob").all() as Record<string, unknown>[]
  const visits = local.prepare("SELECT * FROM ImportStagedVisit").all() as Record<string, unknown>[]
  console.log(`Local: ${jobs.length} jobs, ${visits.length} staged visits`)

  for (const job of jobs) {
    const cols = Object.keys(job)
    await turso.execute({
      sql: `INSERT OR IGNORE INTO ImportJob (${cols.map(c => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      args: cols.map(c => job[c] as never),
    })
  }
  console.log(`Jobs copied: ${jobs.length}`)

  let copied = 0
  for (const visit of visits) {
    const cols = Object.keys(visit)
    await turso.execute({
      sql: `INSERT OR IGNORE INTO ImportStagedVisit (${cols.map(c => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      args: cols.map(c => visit[c] as never),
    })
    copied += 1
    if (copied % 100 === 0) console.log(`  ${copied}…`)
  }

  const check = await turso.execute("SELECT COUNT(*) as n, SUM(CASE WHEN aiEnrichment IS NOT NULL THEN 1 ELSE 0 END) as enriched FROM ImportStagedVisit")
  console.log(`Turso now has ${check.rows[0].n} staged visits (${check.rows[0].enriched} enriched)`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
