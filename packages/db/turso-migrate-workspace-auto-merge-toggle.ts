import { createClient, type Client } from "@libsql/client"

const migrationName = "20260813120000_workspace_auto_merge_toggle"

// Idempotent production apply. Mirrors
// prisma/migrations/20260813120000_workspace_auto_merge_toggle. Purely
// additive: one NOT NULL column with a default (safe on a populated table
// in SQLite).

async function addColumnIfMissing(client: Client, table: string, column: string, definition: string) {
  const result = await client.execute({
    sql: `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column],
  })
  if (result.rows.length === 0) {
    console.log(`  Adding ${table}.${column}...`)
    await client.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`)
  } else {
    console.log(`  ${table}.${column} already present.`)
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
    await addColumnIfMissing(client, "Workspace", "autoMergeEnabled", "BOOLEAN NOT NULL DEFAULT false")
    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
