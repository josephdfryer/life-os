import { createClient } from "@libsql/client"

const migrationName = "20260523120000_inbox_enrich"

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1) }

  const client = createClient({ url, authToken })

  try {
    // Check which columns already exist
    const colCheck = await client.execute(
      `SELECT name FROM pragma_table_info('StagedInteraction') WHERE name IN ('priority', 'enrichedAt')`
    )
    const existingCols = new Set(colCheck.rows.map(r => String(r.name)))

    if (!existingCols.has("priority")) {
      console.log("  Adding priority column...")
      await client.execute(`ALTER TABLE "StagedInteraction" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 3`)
    }
    if (!existingCols.has("enrichedAt")) {
      console.log("  Adding enrichedAt column...")
      await client.execute(`ALTER TABLE "StagedInteraction" ADD COLUMN "enrichedAt" DATETIME`)
    }

    console.log("  Recreating index...")
    await client.execute(`DROP INDEX IF EXISTS "StagedInteraction_status_createdAt_idx"`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "StagedInteraction_status_priority_createdAt_idx" ON "StagedInteraction"("status", "priority", "createdAt")`)

    console.log("  Seeding auto-approve rule...")
    await client.execute({
      sql: `INSERT OR IGNORE INTO "Rule" ("id","workspaceId","name","description","trigger","status","priority","mode","conditions","actions","stopProcessing","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      args: [
        "seed-auto-approve-confidence",
        "default-workspace",
        "Auto-approve high-confidence matches",
        "Automatically accept inbox items where Claude matched with ≥90% confidence.",
        "inbox.stage",
        "active",
        1,
        "auto",
        '[{"field":"confidence","operator":"gte","value":90}]',
        '[{"type":"set","field":"status","value":"accepted"}]',
        1,
      ],
    })

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
