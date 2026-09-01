// Test-database helper for the PostgreSQL era.
//
// Before the Turso → Postgres migration, tests provisioned a throwaway SQLite
// file with `better-sqlite3` and pointed `DATABASE_URL` at it. Postgres has no
// single-file equivalent, so each test run now gets its own freshly-created
// database on a base Postgres server, migrated from the committed baseline SQL.
//
// Requires a reachable Postgres. The local default is the docker-compose
// service on port 5433; `TEST_DATABASE_URL` (preferred) or `DATABASE_URL` can
// override it with any account that can run CREATE/DROP DATABASE. CI supplies
// its own `TEST_DATABASE_URL` for the Postgres service container.
//
// Usage (before importing `@life-os/db`):
//
//   const testDb = await createTestDatabase()
//   const { db } = await import("@life-os/db")
//   // ... run assertions ...
//   await testDb.drop()

import { randomBytes } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pg = require("pg") as typeof import("pg")

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "prisma/migrations",
)

// The default workspace used to be seeded by an early SQLite migration
// (20260505070000_add_workspaces). The squashed Postgres baseline only carries
// it as a column default, so fresh databases need the row created explicitly.
// The production cutover gets it for free by copying the real row from Turso,
// which is why this lives here and not in a migration — a seeded row would
// break the ETL's "target must be empty" guard.
const DEFAULT_WORKSPACE = {
  id: "default-workspace",
  name: "Joseph's Life OS",
  slug: "joseph-life-os",
  status: "active",
} as const

export type TestDatabase = {
  /** Connection URL for the created database. Also assigned to process.env.DATABASE_URL. */
  url: string
  /** Name of the created database. */
  name: string
  /** Drop the database. Safe to call more than once. */
  drop: () => Promise<void>
}

function baseUrl(): string {
  const localPort = process.env.LIFE_OS_POSTGRES_PORT ?? "5433"
  const url =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    `postgresql://lifeos:lifeos@localhost:${localPort}/lifeos`
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(
      "createTestDatabase() needs a PostgreSQL base server. Set TEST_DATABASE_URL " +
        "(or DATABASE_URL) to a postgresql:// URL, or start the local docker-compose " +
        "`postgres` service on LIFE_OS_POSTGRES_PORT (default 5433).",
    )
  }
  return url
}

function readBaselineStatements(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((entry) => entry !== "migration_lock.toml")
    .sort()
    .map((entry) => readFileSync(join(MIGRATIONS_DIR, entry, "migration.sql"), "utf8"))
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const base = baseUrl()
  const name = `lifeos_test_${process.pid}_${randomBytes(6).toString("hex")}`

  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
  } finally {
    await admin.end()
  }

  const target = new URL(base)
  target.pathname = `/${name}`
  const url = target.toString()

  const migrated = new pg.Client({ connectionString: url })
  await migrated.connect()
  try {
    for (const sql of readBaselineStatements()) {
      await migrated.query(sql)
    }
    await migrated.query(
      `INSERT INTO "Workspace" ("id", "createdAt", "updatedAt", "name", "slug", "status")
       VALUES ($1, now(), now(), $2, $3, $4)
       ON CONFLICT ("id") DO NOTHING`,
      [
        DEFAULT_WORKSPACE.id,
        DEFAULT_WORKSPACE.name,
        DEFAULT_WORKSPACE.slug,
        DEFAULT_WORKSPACE.status,
      ],
    )
  } finally {
    await migrated.end()
  }

  process.env.DATABASE_URL = url
  process.env.TURSO_DATABASE_URL = ""
  process.env.TURSO_AUTH_TOKEN = ""

  let dropped = false
  return {
    url,
    name,
    async drop() {
      if (dropped) return
      dropped = true
      const cleanup = new pg.Client({ connectionString: base })
      await cleanup.connect()
      try {
        await cleanup.query(
          `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
        )
      } finally {
        await cleanup.end()
      }
    },
  }
}
