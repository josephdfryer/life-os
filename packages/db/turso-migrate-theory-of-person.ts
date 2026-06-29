import { createClient } from "@libsql/client"

const migrationName = "20260629120000_add_theory_of_person"

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1) }

  const client = createClient({ url, authToken })

  try {
    // ── TheorySnapshot table ────────────────────────────────────────────────
    const snapCheck = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='TheorySnapshot'`)
    if (snapCheck.rows.length === 0) {
      console.log("  Creating TheorySnapshot table...")
      await client.execute(`
        CREATE TABLE "TheorySnapshot" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
          "subjectPersonId" TEXT NOT NULL,
          "version" INTEGER NOT NULL,
          "title" TEXT NOT NULL,
          "summary" TEXT NOT NULL,
          "markdownBody" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'current',
          "confidence" REAL,
          "synthesizedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL,
          CONSTRAINT "TheorySnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "TheorySnapshot_subjectPersonId_fkey" FOREIGN KEY ("subjectPersonId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )
      `)
    }

    // ── TheorySnapshotSource table ──────────────────────────────────────────
    const srcCheck = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='TheorySnapshotSource'`)
    if (srcCheck.rows.length === 0) {
      console.log("  Creating TheorySnapshotSource table...")
      await client.execute(`
        CREATE TABLE "TheorySnapshotSource" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "snapshotId" TEXT NOT NULL,
          "sourceType" TEXT NOT NULL,
          "sourceId" TEXT NOT NULL,
          "contribution" TEXT,
          "weight" REAL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "TheorySnapshotSource_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "TheorySnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )
      `)
    }

    // ── Indexes ─────────────────────────────────────────────────────────────
    console.log("  Creating indexes...")
    await client.execute(`CREATE INDEX IF NOT EXISTS "TheorySnapshot_subjectPersonId_idx" ON "TheorySnapshot"("subjectPersonId")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "TheorySnapshot_subjectPersonId_version_idx" ON "TheorySnapshot"("subjectPersonId", "version")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "TheorySnapshot_status_idx" ON "TheorySnapshot"("status")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "TheorySnapshot_workspaceId_idx" ON "TheorySnapshot"("workspaceId")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "TheorySnapshotSource_snapshotId_idx" ON "TheorySnapshotSource"("snapshotId")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "TheorySnapshotSource_sourceType_sourceId_idx" ON "TheorySnapshotSource"("sourceType", "sourceId")`)

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
