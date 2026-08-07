import { createClient, type Client } from "@libsql/client"

const migrationName = "20260807010000_rule_versioning"

// Idempotent production apply for packages/automation's versioned rules
// (Track A5). Mirrors prisma/migrations/20260807010000_rule_versioning.
// Additive: three columns, all with defaults, no existing table rebuilt.
//
//   cd packages/db && DB=persons; \
//     TURSO_DATABASE_URL="$(turso db show "$DB" --url)" \
//     TURSO_AUTH_TOKEN="$(turso db tokens create "$DB")" \
//     npx tsx turso-migrate-rule-versioning.ts

async function addColumnIfMissing(client: Client, table: string, column: string, definition: string) {
  const result = await client.execute({
    sql: `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column],
  })
  if (result.rows.length === 0) {
    console.log(`  Adding ${table}.${column}...`)
    await client.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`)
  }
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
    await addColumnIfMissing(client, "Rule", "version", `INTEGER NOT NULL DEFAULT 1`)
    await addColumnIfMissing(client, "RuleRun", "ruleVersion", `INTEGER NOT NULL DEFAULT 1`)
    await addColumnIfMissing(client, "RuleRun", "causationDepth", `INTEGER NOT NULL DEFAULT 0`)

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
