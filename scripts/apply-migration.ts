#!/usr/bin/env tsx
// Applies a SQL migration file to the Turso database configured in
// apps/persons/.env (or the current environment). The repo uses manual
// migrations: write SQL under packages/db/prisma/migrations/<name>/migration.sql
// and apply it with:
//
//   npx tsx scripts/apply-migration.ts packages/db/prisma/migrations/<name>/migration.sql

import fs from "node:fs"
import path from "node:path"
import { createClient } from "@libsql/client"

const REPO_ROOT = path.resolve(import.meta.dirname, "..")

for (const candidate of [
  path.join(REPO_ROOT, ".env"),
  path.join(REPO_ROOT, "apps/persons/.env"),
]) {
  if (!fs.existsSync(candidate)) continue
  for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error("Usage: npx tsx scripts/apply-migration.ts <path/to/migration.sql>")
    process.exit(1)
  }
  const sqlPath = path.resolve(REPO_ROOT, file)
  const sql = fs.readFileSync(sqlPath, "utf8")
  // Strip comment lines BEFORE splitting so semicolons inside comments
  // can't produce phantom statements.
  const statements = sql
    .split("\n").filter(l => !l.trim().startsWith("--")).join("\n")
    .split(";")
    .map(s => s.trim())
    .filter(Boolean)

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  console.log(`Applying ${statements.length} statements from ${path.relative(REPO_ROOT, sqlPath)}`)
  for (const stmt of statements) {
    await client.execute(stmt)
  }
  console.log("Done.")
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
