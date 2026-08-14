import { createClient } from "@libsql/client"

const migrationName = "20260814190000_granola_event_sync"

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN")
    process.exit(1)
  }

  const client = createClient({ url, authToken })
  try {
    await client.executeMultiple(DDL_SQL)

    const table = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='GranolaNoteLink'`,
    )
    if (table.rows.length !== 1) throw new Error("GranolaNoteLink was not created")

    const foreignKeys = await client.execute(`PRAGMA foreign_key_check`)
    if (foreignKeys.rows.length > 0) {
      throw new Error(`Foreign key check failed with ${foreignKeys.rows.length} row(s)`)
    }
    console.log(`Migration ${migrationName} applied successfully.`)
  } finally {
    client.close()
  }
}

const DDL_SQL = `
CREATE TABLE IF NOT EXISTS "GranolaNoteLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "connectionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "externalNoteId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "calendarEventId" TEXT,
    "remoteCreatedAt" DATETIME,
    "remoteUpdatedAt" DATETIME,
    "contentHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'synced',
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("connectionId") REFERENCES "Connection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "GranolaNoteLink_workspaceId_externalNoteId_key" ON "GranolaNoteLink"("workspaceId", "externalNoteId");
CREATE INDEX IF NOT EXISTS "GranolaNoteLink_connectionId_status_idx" ON "GranolaNoteLink"("connectionId", "status");
CREATE INDEX IF NOT EXISTS "GranolaNoteLink_eventId_idx" ON "GranolaNoteLink"("eventId");
CREATE INDEX IF NOT EXISTS "GranolaNoteLink_workspaceId_remoteUpdatedAt_idx" ON "GranolaNoteLink"("workspaceId", "remoteUpdatedAt");
`

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
