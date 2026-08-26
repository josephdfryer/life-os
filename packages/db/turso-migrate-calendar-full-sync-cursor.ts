import { createClient, type Client } from "@libsql/client"

const migrationName = "20260825200000_calendar_full_sync_cursor"

// Idempotent production apply. Mirrors
// prisma/migrations/20260825200000_calendar_full_sync_cursor. Purely
// additive: one nullable column holding the resume cursor for the unwindowed
// bootstrap sync that earns a Google syncToken.

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
    await addColumnIfMissing(client, "CalendarConnection", "fullSyncPageToken", "TEXT")
    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
