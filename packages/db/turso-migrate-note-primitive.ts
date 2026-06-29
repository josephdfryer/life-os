import { createClient } from "@libsql/client"

const migrationName = "20260622120000_add_note_primitive"

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1) }

  const client = createClient({ url, authToken })

  try {
    // ── Note table ────────────────────────────────────────────────────────────
    const tableCheck = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='Note'`)
    if (tableCheck.rows.length === 0) {
      console.log("  Creating Note table...")
      await client.execute(`
        CREATE TABLE "Note" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "timestamp" DATETIME NOT NULL,
          "type" TEXT NOT NULL,
          "content" TEXT NOT NULL,
          "metadata" TEXT,
          "sourceFileId" TEXT,
          CONSTRAINT "Note_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "Note_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
        )
      `)
    }

    // ── sourceNoteId provenance columns ─────────────────────────────────────────
    const provenanceTargets = ["Event", "Interaction", "Plan", "Group", "State"]
    for (const table of provenanceTargets) {
      const cols = await client.execute(`SELECT name FROM pragma_table_info('${table}') WHERE name = 'sourceNoteId'`)
      if (cols.rows.length === 0) {
        console.log(`  ${table}: adding sourceNoteId column...`)
        await client.execute(`ALTER TABLE "${table}" ADD COLUMN "sourceNoteId" TEXT`)
      }
    }

    // ── Indexes ───────────────────────────────────────────────────────────────
    console.log("  Creating indexes...")
    await client.execute(`CREATE INDEX IF NOT EXISTS "Note_workspaceId_timestamp_idx" ON "Note"("workspaceId", "timestamp" DESC)`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "Note_sourceFileId_idx" ON "Note"("sourceFileId")`)

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
