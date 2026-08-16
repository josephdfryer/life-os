import { createClient } from "@libsql/client"
import { readFileSync } from "node:fs"

const migrationName = "20260811190000_device_companion_foundation"
const requiredTables = [
  "Device",
  "DeviceSource",
  "DeviceCredential",
  "DeviceAuthorization",
  "DeviceIngestItem",
] as const

// Idempotent production apply for the device companion foundation. The
// committed Prisma migration is additive: it creates five tables and their
// indexes without altering or deleting existing application data.
//
//   cd packages/db && DB=persons; \
//     TURSO_DATABASE_URL="$(turso db show "$DB" --url)" \
//     TURSO_AUTH_TOKEN="$(turso db tokens create "$DB")" \
//     npx tsx turso-migrate-device-companion.ts

function statements() {
  const sql = readFileSync(
    new URL(`./prisma/migrations/${migrationName}/migration.sql`, import.meta.url),
    "utf8",
  )

  return sql
    .split(/;\s*(?:\n|$)/)
    .map(statement => statement.trim())
    .filter(Boolean)
    .map(statement => statement
      .replace(/^CREATE TABLE /, "CREATE TABLE IF NOT EXISTS ")
      .replace(/^CREATE (UNIQUE )?INDEX /, (_match, unique = "") => `CREATE ${unique}INDEX IF NOT EXISTS `))
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN")
    process.exit(1)
  }

  const client = createClient({ url, authToken })
  try {
    for (const statement of statements()) {
      await client.execute(statement)
    }

    const placeholders = requiredTables.map(() => "?").join(",")
    const tables = await client.execute({
      sql: `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders}) ORDER BY name`,
      args: [...requiredTables],
    })
    if (tables.rows.length !== requiredTables.length) {
      throw new Error(`Expected ${requiredTables.length} device tables, found ${tables.rows.length}`)
    }

    const foreignKeys = await client.execute("PRAGMA foreign_key_check")
    if (foreignKeys.rows.length > 0) {
      throw new Error(`foreign_key_check reported ${foreignKeys.rows.length} violation(s)`)
    }

    const integrity = await client.execute("PRAGMA integrity_check")
    if (String(integrity.rows[0]?.integrity_check ?? "") !== "ok") {
      throw new Error(`integrity_check failed: ${JSON.stringify(integrity.rows)}`)
    }

    console.log(`Migration ${migrationName} applied and verified successfully.`)
  } finally {
    client.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
