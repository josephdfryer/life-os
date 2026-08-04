#!/usr/bin/env node

// Two invariants about how schema reaches production.
//
// Production has no _prisma_migrations table; schema changes get there through
// the hand-written packages/db/turso-migrate-*.ts scripts. The migration
// directory is the committed history. Nothing kept the two in step, and on
// 2026-08-03 that cost a day:
//
//   The Level Up tables only ever existed because turso-migrate-level-up.ts
//   created them. That script names the migration "20260726120000_add_level_up
//   _module", but no such directory was ever committed. Months later the
//   workout-layer migration began ALTERing those tables, and on a clean replay
//   failed with "no such table". The persons test harness builds its fixture by
//   replaying every migration, so the throw happened during setup and six
//   cross-workspace merge tests failed with a bare SQLITE_ERROR — a failure
//   that looked like a merge-logic bug and was not.
//
// Hence:
//   1. Every turso-migrate script names a migration that exists here.
//   2. The whole history replays into an empty database without error.
//
// Check 2 is the one that reproduces the incident directly. `npm run db:drill`
// does not: it starts partway through, at money_as_cents.

import { createRequire } from "node:module"
import { readFileSync, readdirSync, rmSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const dbPackage = join(root, "packages/db")
const migrationsRoot = join(dbPackage, "prisma/migrations")

const problems = []

// ── 1. Every turso-migrate script points at a real migration ────────────────

const migrationDirs = new Set(
  readdirSync(migrationsRoot).filter(name => name !== "migration_lock.toml"),
)

const scripts = readdirSync(dbPackage).filter(
  name => name.startsWith("turso-migrate") && name.endsWith(".ts"),
)

let paired = 0
for (const script of scripts) {
  const source = readFileSync(join(dbPackage, script), "utf8")
  const match = /const\s+migrationName\s*=\s*["'`]([^"'`]+)["'`]/.exec(source)
  if (!match) {
    problems.push(`${script}: no \`const migrationName = "..."\` — cannot tell which migration it applies`)
    continue
  }
  const name = match[1]
  if (!migrationDirs.has(name)) {
    problems.push(
      `${script}: names migration "${name}", but packages/db/prisma/migrations/${name}/ does not exist.\n` +
      `    Production would get this schema while a clean replay never does. Add the migration.sql.`,
    )
    continue
  }
  try {
    readFileSync(join(migrationsRoot, name, "migration.sql"), "utf8")
  } catch {
    problems.push(`${script}: migrations/${name}/ exists but has no migration.sql`)
    continue
  }
  paired += 1
}

// ── 2. The full history replays into an empty database ──────────────────────

let replayed = 0
let statements = 0
const workDir = mkdtempSync(join(tmpdir(), "life-os-migration-check-"))
const dbPath = join(workDir, "replay.db")

try {
  const Database = require("better-sqlite3")
  const sqlite = new Database(dbPath)
  // Migrations reference tables in any order; integrity is checked at the end.
  sqlite.pragma("foreign_keys = OFF")

  for (const name of [...migrationDirs].sort()) {
    const sql = readFileSync(join(migrationsRoot, name, "migration.sql"), "utf8")
    // Split the way the persons test harness does, so this check fails on
    // exactly what that harness would hit.
    for (const statement of sql.split(/;\s*\n/).map(s => s.trim()).filter(Boolean)) {
      statements += 1
      try {
        sqlite.exec(`${statement};`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Some historical migrations re-create objects an earlier one already
        // made; that is idempotency, not breakage.
        if (/already exists|duplicate column/i.test(message)) continue
        problems.push(
          `${name}: ${message}\n    statement: ${statement.slice(0, 120).replace(/\s+/g, " ")}…`,
        )
      }
    }
    replayed += 1
  }

  const violations = sqlite.prepare("PRAGMA foreign_key_check").all()
  if (violations.length > 0) {
    problems.push(`foreign_key_check reported ${violations.length} violation(s) after replay`)
  }
  sqlite.close()
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

// ── Report ──────────────────────────────────────────────────────────────────

if (problems.length) {
  console.error(`Migration integrity problems (${problems.length}):\n${problems.map(item => `- ${item}`).join("\n")}`)
  process.exitCode = 1
} else {
  console.log(
    `Migration integrity: ok (${paired}/${scripts.length} turso scripts paired, ` +
    `${replayed} migrations replayed, ${statements} statements)`,
  )
}
