import { createClient } from "@libsql/client"

const migrationName = "20260714140000_interaction_participants"

// One-time production migration: creates the InteractionParticipant table,
// matching packages/db/prisma/migrations/20260714140000_interaction_participants/migration.sql.
//
// Usage:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx turso-migrate-interaction-participants.ts
//
// Idempotent: checks for the table's existence first and skips if already created.

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1) }

  const client = createClient({ url, authToken })

  try {
    const existing = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='InteractionParticipant'`
    )
    if (existing.rows.length > 0) {
      console.log(`${migrationName}: already applied (InteractionParticipant exists). Skipping.`)
      return
    }

    console.log("Creating InteractionParticipant table...")
    await client.executeMultiple(MIGRATION_SQL)
    console.log(`${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

const MIGRATION_SQL = `
CREATE TABLE "InteractionParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "interactionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "role" TEXT,
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "InteractionParticipant_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "InteractionParticipant_interactionId_idx" ON "InteractionParticipant"("interactionId");
CREATE INDEX "InteractionParticipant_entityType_entityId_idx" ON "InteractionParticipant"("entityType", "entityId");
CREATE INDEX "InteractionParticipant_workspaceId_idx" ON "InteractionParticipant"("workspaceId");
`

main().catch(e => { console.error(e); process.exit(1) })
