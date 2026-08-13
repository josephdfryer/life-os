import { createClient, type Client } from "@libsql/client"

const migrationName = "20260812200000_level_up_readiness_and_idempotency"

// Idempotent production apply. Mirrors
// prisma/migrations/20260812200000_level_up_readiness_and_idempotency.
// Purely additive: nullable columns, two unique indexes, and one new table.

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
    await addColumnIfMissing(client, "LevelUpTrainingSet", "source", "TEXT")
    await addColumnIfMissing(client, "LevelUpTrainingSet", "sourceId", "TEXT")
    await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "LevelUpTrainingSet_workspaceId_source_sourceId_key" ON "LevelUpTrainingSet"("workspaceId", "source", "sourceId")`)

    await addColumnIfMissing(client, "LevelUpSession", "source", "TEXT")
    await addColumnIfMissing(client, "LevelUpSession", "sourceId", "TEXT")
    await addColumnIfMissing(client, "LevelUpSession", "sessionRpe", "REAL")
    await addColumnIfMissing(client, "LevelUpSession", "workoutEventId", "TEXT")
    await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "LevelUpSession_workspaceId_source_sourceId_key" ON "LevelUpSession"("workspaceId", "source", "sourceId")`)

    await client.execute(`
      CREATE TABLE IF NOT EXISTS "LevelUpReadinessSnapshot" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "workspaceId" TEXT NOT NULL,
        "sessionId" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "snapshotAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "localDay" TEXT NOT NULL,
        "engineVersion" TEXT NOT NULL DEFAULT 'v1',
        "ruleSetVersion" TEXT NOT NULL DEFAULT 'v1',
        "inputs" TEXT NOT NULL,
        "formSignal" TEXT,
        "band" TEXT NOT NULL DEFAULT 'full',
        "originalPrescriptionHash" TEXT,
        "suggestedPrescriptionHash" TEXT,
        "reasonCodes" TEXT NOT NULL DEFAULT '[]',
        "userChoice" TEXT,
        "overriddenAt" DATETIME,
        CONSTRAINT "LevelUpReadinessSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "LevelUpReadinessSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LevelUpSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `)
    await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "LevelUpReadinessSnapshot_sessionId_key" ON "LevelUpReadinessSnapshot"("sessionId")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "LevelUpReadinessSnapshot_workspaceId_snapshotAt_idx" ON "LevelUpReadinessSnapshot"("workspaceId", "snapshotAt")`)

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
