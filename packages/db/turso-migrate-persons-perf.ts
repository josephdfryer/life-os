import { createClient } from "@libsql/client"

const migrationName = "20260630140000_persons_perf_indexes"

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1) }

  const client = createClient({ url, authToken })

  try {
    // ── emailSearch column ────────────────────────────────────────────────────
    const personCols = await client.execute(`SELECT name FROM pragma_table_info('Person') WHERE name = 'emailSearch'`)
    if (personCols.rows.length === 0) {
      console.log("  Person: adding emailSearch column...")
      await client.execute(`ALTER TABLE "Person" ADD COLUMN "emailSearch" TEXT`)
      console.log("  Person: backfilling emailSearch from emails...")
      await client.execute(`UPDATE "Person" SET "emailSearch" = lower("emails")`)
    } else {
      console.log("  Person: emailSearch column already exists, skipping.")
    }

    // ── Indexes ───────────────────────────────────────────────────────────────
    console.log("  Creating indexes...")
    await client.execute(`CREATE INDEX IF NOT EXISTS "Person_workspaceId_company_idx" ON "Person"("workspaceId", "company")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "Person_workspaceId_headline_idx" ON "Person"("workspaceId", "headline")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "Person_workspaceId_emailSearch_idx" ON "Person"("workspaceId", "emailSearch")`)

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
