import { createClient } from "@libsql/client"

const migrationName = "20260808170000_add_list_keyset_indexes"

const STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS "Person_workspaceId_createdAt_id_idx" ON "Person"("workspaceId", "createdAt", "id")`,
  `CREATE INDEX IF NOT EXISTS "Event_workspaceId_timestamp_id_idx" ON "Event"("workspaceId", "timestamp" DESC, "id")`,
]

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN")

  const client = createClient({ url, authToken })
  try {
    for (const statement of STATEMENTS) await client.execute(statement)
    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
