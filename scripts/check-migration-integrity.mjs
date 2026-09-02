#!/usr/bin/env node

// One invariant about how schema reaches production: the committed migration
// history replays into an empty Postgres database without error.
//
// History (SQLite / Turso era): production had no _prisma_migrations table and
// schema changes shipped through hand-written packages/db/turso-migrate-*.ts
// scripts. Nothing kept those in step with the committed migration directory,
// and on 2026-08-03 that cost a day — a turso-migrate script created tables
// under a migration name that was never committed, a later migration ALTERed
// them, and a clean replay failed with "no such table". Six unrelated tests
// failed with a bare SQL error because the persons test harness replays every
// migration to build its fixture.
//
// Post-Postgres: `prisma migrate deploy` tracks applied migrations properly and
// the turso-migrate scripts are retired, so the script-pairing check is gone.
// What stays worth guarding is the clean replay — now against a throwaway
// Postgres database instead of an in-memory SQLite file. Drift (schema.prisma
// edited without a matching migration) is caught by the `check` CI job, which
// runs `prisma migrate deploy` against a fresh database.

import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const dbPackage = join(root, "packages/db")
const migrationsRoot = join(dbPackage, "prisma/migrations")

const problems = []

const migrationDirs = readdirSync(migrationsRoot)
  .filter((name) => name !== "migration_lock.toml")
  .sort()

const localPort = process.env.LIFE_OS_POSTGRES_PORT ?? "5433"
const baseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  `postgresql://lifeos:lifeos@localhost:${localPort}/lifeos`
if (!baseUrl || !/^postgres(ql)?:\/\//.test(baseUrl)) {
  console.error(
    "check-migration-integrity needs a PostgreSQL server. Set TEST_DATABASE_URL " +
      "(or DATABASE_URL) to a postgresql:// URL, or start the local docker-compose " +
      "`postgres` service on LIFE_OS_POSTGRES_PORT (default 5433).",
  )
  process.exit(1)
}

const { Client } = require("pg")
const scratchName = `lifeos_migrate_check_${randomBytes(6).toString("hex")}`

const admin = new Client({ connectionString: baseUrl })
await admin.connect()
await admin.query(`CREATE DATABASE "${scratchName}"`)
await admin.end()

const scratchUrl = new URL(baseUrl)
scratchUrl.pathname = `/${scratchName}`

// ── The full history replays into an empty Postgres database ──────────────

let replayed = 0
const target = new Client({ connectionString: scratchUrl.toString() })
await target.connect()
try {
  for (const name of migrationDirs) {
    const sql = readFileSync(join(migrationsRoot, name, "migration.sql"), "utf8")
    try {
      await target.query(sql)
      replayed += 1
    } catch (error) {
      problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
} finally {
  await target.end()
}

// ── Cleanup ──────────────────────────────────────────────────────────────

const cleanup = new Client({ connectionString: baseUrl })
await cleanup.connect()
await cleanup.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`)
await cleanup.end()

// ── Report ───────────────────────────────────────────────────────────────

if (problems.length) {
  console.error(
    `Migration integrity problems (${problems.length}):\n${problems.map((item) => `- ${item}`).join("\n")}`,
  )
  process.exitCode = 1
} else {
  console.log(
    `Migration integrity: ok (${replayed}/${migrationDirs.length} migrations replayed ` +
      `into a fresh Postgres database)`,
  )
}
