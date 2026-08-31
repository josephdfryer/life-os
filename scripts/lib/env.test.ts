import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { test } from "node:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadPostgresCollectorEnv, resolvePostgresDatabaseUrl } from "./env"

test("prefers an explicitly inherited PostgreSQL URL", () => {
  assert.equal(
    resolvePostgresDatabaseUrl("postgresql://inherited", [
      "postgresql://persons",
      "file:./dev.db",
    ]),
    "postgresql://inherited",
  )
})

test("skips a stale SQLite URL and selects the available PostgreSQL URL", () => {
  assert.equal(
    resolvePostgresDatabaseUrl(undefined, [
      undefined,
      "postgresql://persons",
      "file:./dev.db",
    ]),
    "postgresql://persons",
  )
})

test("fails closed when only SQLite configuration is available", () => {
  assert.throws(
    () => resolvePostgresDatabaseUrl(undefined, ["file:./dev.db"]),
    /require a PostgreSQL DATABASE_URL/,
  )
})

test("collector env loads Persons PostgreSQL instead of an earlier package SQLite URL", t => {
  const root = mkdtempSync(join(tmpdir(), "life-os-collector-env-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "packages/db"), { recursive: true })
  mkdirSync(join(root, "apps/persons"), { recursive: true })
  writeFileSync(join(root, "packages/db/.env"), "DATABASE_URL=file:./dev.db\n")
  writeFileSync(join(root, "apps/persons/.env"), "DATABASE_URL=postgresql://canonical\n")

  const env: Record<string, string | undefined> = {}
  loadPostgresCollectorEnv(root, env)

  assert.equal(env.DATABASE_URL, "postgresql://canonical")
})
