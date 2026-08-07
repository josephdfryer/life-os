import { createClient } from "@libsql/client"

const migrationName = "20260807000000_graph_event_spine"

// Idempotent production apply for the control-plane foundation: GraphEvent,
// GraphEventReceipt, ReviewItem. Mirrors
// prisma/migrations/20260807000000_graph_event_spine/migration.sql.
//
// All three tables are new — no existing table is altered.
//
//   cd packages/db && DB=persons; \
//     TURSO_DATABASE_URL="$(turso db show "$DB" --url)" \
//     TURSO_AUTH_TOKEN="$(turso db tokens create "$DB")" \
//     npx tsx turso-migrate-graph-event-spine.ts

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "GraphEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "sourceConnector" TEXT,
    "correlationId" TEXT,
    "causationId" TEXT,
    "causationDepth" INTEGER NOT NULL DEFAULT 0,
    "ruleVersionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "provenance" TEXT,
    CONSTRAINT "GraphEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GraphEvent_causationId_fkey" FOREIGN KEY ("causationId") REFERENCES "GraphEvent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "GraphEvent_workspaceId_idempotencyKey_key" ON "GraphEvent"("workspaceId", "idempotencyKey")`,
  `CREATE INDEX IF NOT EXISTS "GraphEvent_workspaceId_occurredAt_idx" ON "GraphEvent"("workspaceId", "occurredAt" DESC)`,
  `CREATE INDEX IF NOT EXISTS "GraphEvent_workspaceId_subjectType_subjectId_idx" ON "GraphEvent"("workspaceId", "subjectType", "subjectId")`,
  `CREATE INDEX IF NOT EXISTS "GraphEvent_workspaceId_eventType_occurredAt_idx" ON "GraphEvent"("workspaceId", "eventType", "occurredAt" DESC)`,
  `CREATE INDEX IF NOT EXISTS "GraphEvent_correlationId_idx" ON "GraphEvent"("correlationId")`,
  `CREATE INDEX IF NOT EXISTS "GraphEvent_causationId_idx" ON "GraphEvent"("causationId")`,

  `CREATE TABLE IF NOT EXISTS "GraphEventReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRetryAt" DATETIME,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraphEventReceipt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "GraphEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "GraphEventReceipt_eventId_consumer_key" ON "GraphEventReceipt"("eventId", "consumer")`,
  `CREATE INDEX IF NOT EXISTS "GraphEventReceipt_consumer_status_nextRetryAt_idx" ON "GraphEventReceipt"("consumer", "status", "nextRetryAt")`,

  `CREATE TABLE IF NOT EXISTS "ReviewItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "proposedCommand" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "confidence" REAL,
    "evidence" TEXT,
    "riskTier" TEXT NOT NULL DEFAULT 'review',
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "resultType" TEXT,
    "resultId" TEXT,
    CONSTRAINT "ReviewItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ReviewItem_workspaceId_source_sourceId_key" ON "ReviewItem"("workspaceId", "source", "sourceId")`,
  `CREATE INDEX IF NOT EXISTS "ReviewItem_workspaceId_status_priority_createdAt_idx" ON "ReviewItem"("workspaceId", "status", "priority", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "ReviewItem_workspaceId_source_itemType_idx" ON "ReviewItem"("workspaceId", "source", "itemType")`,
  `CREATE INDEX IF NOT EXISTS "ReviewItem_workspaceId_targetType_targetId_idx" ON "ReviewItem"("workspaceId", "targetType", "targetId")`,
]

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN")
    process.exit(1)
  }

  const client = createClient({ url, authToken })
  try {
    for (const statement of STATEMENTS) {
      await client.execute(statement)
    }

    const tables = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('GraphEvent','GraphEventReceipt','ReviewItem')`,
    )
    if (tables.rows.length !== 3) {
      throw new Error(`Expected 3 new tables, found ${tables.rows.length}`)
    }

    const integrity = await client.execute("PRAGMA foreign_key_check")
    if (integrity.rows.length > 0) {
      throw new Error(`foreign_key_check reported ${integrity.rows.length} violation(s)`)
    }

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
