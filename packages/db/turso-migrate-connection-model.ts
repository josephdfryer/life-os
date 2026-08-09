import { createClient } from "@libsql/client"
import { randomUUID } from "node:crypto"

const migrationName = "20260809000000_connection_model"

// One-time production migration: creates the unified Connection table (see
// packages/db/prisma/schema.prisma's "INTEGRATIONS: unified Connection"
// section) and backfills a mirror row for every existing CalendarConnection/
// GmailConnection/EraConnection row. Additive — no existing table is
// altered or dropped. CalendarConnection/GmailConnection remain the real
// OAuth write path (their link tables still reference them); this table is
// a read-side unification for the Connections hub. Era has no legacy write
// path, so future Era connections write here directly.
//
// Usage:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx turso-migrate-connection-model.ts
//
// Idempotent: DDL is skipped if the table already exists; backfill only
// inserts a mirror row for a source row that doesn't already have one
// (matched by sourceTable+sourceId), so a partial or repeated run is safe.

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1) }

  const client = createClient({ url, authToken })

  try {
    const existing = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='Connection'`,
    )
    if (existing.rows.length === 0) {
      console.log("Creating Connection table...")
      await client.executeMultiple(DDL_SQL)
    } else {
      console.log("Connection table already exists, skipping DDL.")
    }

    await backfillCalendar(client)
    await backfillGmail(client)
    await backfillEra(client)

    console.log(`\nMigration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

async function backfillCalendar(client: ReturnType<typeof createClient>) {
  const rows = await client.execute(
    `SELECT "id","workspaceId","userId","provider","status","accountEmail","calendarId","calendarSummary",
            "accessTokenEncrypted","refreshTokenEncrypted","expiresAt","scope","syncTokenEncrypted",
            "lastSyncedAt","lastError" FROM "CalendarConnection"`,
  )
  let inserted = 0
  for (const row of rows.rows) {
    const already = await client.execute({
      sql: `SELECT id FROM "Connection" WHERE "sourceTable" = 'CalendarConnection' AND "sourceId" = ?`,
      args: [row.id as string],
    })
    if (already.rows.length > 0) continue

    const metadata = JSON.stringify({
      calendarId: row.calendarId,
      calendarSummary: row.calendarSummary,
      syncTokenEncrypted: row.syncTokenEncrypted,
    })
    await client.execute({
      sql: `INSERT INTO "Connection"
        ("id","workspaceId","userId","createdAt","updatedAt","kind","provider","status","accountEmail",
         "accessTokenEncrypted","refreshTokenEncrypted","expiresAt","scope","lastSyncedAt","lastError",
         "metadata","sourceTable","sourceId")
        VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'calendar',?,?,?,?,?,?,?,?,?,?, 'CalendarConnection',?)`,
      args: [
        randomUUID(), row.workspaceId as string, row.userId as string,
        row.provider as string, row.status as string, row.accountEmail as string | null,
        row.accessTokenEncrypted as string | null, row.refreshTokenEncrypted as string | null,
        row.expiresAt as string | null, row.scope as string | null,
        row.lastSyncedAt as string | null, row.lastError as string | null,
        metadata, row.id as string,
      ],
    })
    inserted += 1
  }
  console.log(`CalendarConnection -> Connection: ${inserted} mirrored (of ${rows.rows.length} total).`)
}

async function backfillGmail(client: ReturnType<typeof createClient>) {
  const rows = await client.execute(
    `SELECT "id","workspaceId","userId","provider","status","accountEmail","mailboxId","historyId",
            "accessTokenEncrypted","refreshTokenEncrypted","expiresAt","scope",
            "lastSyncedAt","lastError" FROM "GmailConnection"`,
  )
  let inserted = 0
  for (const row of rows.rows) {
    const already = await client.execute({
      sql: `SELECT id FROM "Connection" WHERE "sourceTable" = 'GmailConnection' AND "sourceId" = ?`,
      args: [row.id as string],
    })
    if (already.rows.length > 0) continue

    const metadata = JSON.stringify({ mailboxId: row.mailboxId, historyId: row.historyId })
    await client.execute({
      sql: `INSERT INTO "Connection"
        ("id","workspaceId","userId","createdAt","updatedAt","kind","provider","status","accountEmail",
         "accessTokenEncrypted","refreshTokenEncrypted","expiresAt","scope","lastSyncedAt","lastError",
         "metadata","sourceTable","sourceId")
        VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'gmail',?,?,?,?,?,?,?,?,?,?, 'GmailConnection',?)`,
      args: [
        randomUUID(), row.workspaceId as string, row.userId as string,
        row.provider as string, row.status as string, row.accountEmail as string | null,
        row.accessTokenEncrypted as string | null, row.refreshTokenEncrypted as string | null,
        row.expiresAt as string | null, row.scope as string | null,
        row.lastSyncedAt as string | null, row.lastError as string | null,
        metadata, row.id as string,
      ],
    })
    inserted += 1
  }
  console.log(`GmailConnection -> Connection: ${inserted} mirrored (of ${rows.rows.length} total).`)
}

async function backfillEra(client: ReturnType<typeof createClient>) {
  const rows = await client.execute(
    `SELECT "id","workspaceId","userId","status","accountEmail","syncCursor",
            "accessTokenEncrypted","refreshTokenEncrypted","expiresAt","scope",
            "lastSyncedAt","lastError" FROM "EraConnection"`,
  )
  let inserted = 0
  for (const row of rows.rows) {
    const already = await client.execute({
      sql: `SELECT id FROM "Connection" WHERE "sourceTable" = 'EraConnection' AND "sourceId" = ?`,
      args: [row.id as string],
    })
    if (already.rows.length > 0) continue

    const metadata = JSON.stringify({ syncCursor: row.syncCursor })
    await client.execute({
      sql: `INSERT INTO "Connection"
        ("id","workspaceId","userId","createdAt","updatedAt","kind","provider","status","accountEmail",
         "accessTokenEncrypted","refreshTokenEncrypted","expiresAt","scope","lastSyncedAt","lastError",
         "metadata","sourceTable","sourceId")
        VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'era','era',?,?,?,?,?,?,?,?,?, 'EraConnection',?)`,
      args: [
        randomUUID(), row.workspaceId as string, row.userId as string,
        row.status as string, row.accountEmail as string | null,
        row.accessTokenEncrypted as string | null, row.refreshTokenEncrypted as string | null,
        row.expiresAt as string | null, row.scope as string | null,
        row.lastSyncedAt as string | null, row.lastError as string | null,
        metadata, row.id as string,
      ],
    })
    inserted += 1
  }
  console.log(`EraConnection -> Connection: ${inserted} mirrored (of ${rows.rows.length} total).`)
}

const DDL_SQL = `
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "status" TEXT NOT NULL DEFAULT 'active',
    "accountEmail" TEXT,
    "label" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "expiresAt" DATETIME,
    "scope" TEXT,
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "metadata" TEXT,
    "sourceTable" TEXT,
    "sourceId" TEXT,
    CONSTRAINT "Connection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Connection_workspaceId_kind_status_idx" ON "Connection"("workspaceId", "kind", "status");
CREATE INDEX "Connection_sourceTable_sourceId_idx" ON "Connection"("sourceTable", "sourceId");
CREATE INDEX "Connection_userId_idx" ON "Connection"("userId");
`

main().catch(e => { console.error(e); process.exit(1) })
