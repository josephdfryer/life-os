import { createClient } from "@libsql/client"

const migrationName = "20260529034341_add_state_layer"

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1) }

  const client = createClient({ url, authToken })

  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS "StateDefinition" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "workspaceId" TEXT NOT NULL,
        "entityType" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "description" TEXT
      )
    `)

    await client.execute(`
      CREATE TABLE IF NOT EXISTS "State" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "workspaceId" TEXT NOT NULL,
        "entityType" TEXT NOT NULL,
        "entityId" TEXT NOT NULL,
        "definitionId" TEXT NOT NULL,
        "severity" REAL,
        "source" TEXT,
        "recordedAt" DATETIME NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("definitionId") REFERENCES "StateDefinition" ("id")
      )
    `)

    await client.execute(`CREATE INDEX IF NOT EXISTS "StateDefinition_workspaceId_entityType_idx" ON "StateDefinition"("workspaceId", "entityType")`)
    await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "StateDefinition_workspaceId_entityType_type_value_key" ON "StateDefinition"("workspaceId", "entityType", "type", "value")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "State_workspaceId_entityId_entityType_idx" ON "State"("workspaceId", "entityId", "entityType")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "State_workspaceId_entityId_entityType_recordedAt_idx" ON "State"("workspaceId", "entityId", "entityType", "recordedAt")`)

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
