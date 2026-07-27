import { createClient, type Client } from "@libsql/client"

const migrationName = "20260727020000_add_calendar_plan_reconciliation"

// Idempotent production apply for calendar<->plan reconciliation. Mirrors
// prisma/migrations/20260727020000_add_calendar_plan_reconciliation. Additive:
// nullable columns + indexes. The one sharp edge is the UNIQUE index on
// Event.sourcePlanId — if legacy prod rows already share a sourcePlanId, a plain
// CREATE UNIQUE INDEX would fail the whole migration. We detect that first and
// fall back to a non-unique index (Prisma still enforces the relation in the
// client), surfacing the duplicates so they can be reconciled deliberately.

async function addColumnIfMissing(client: Client, table: string, column: string, definition: string) {
  const result = await client.execute({
    sql: `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column],
  })
  if (result.rows.length === 0) {
    console.log(`  Adding ${table}.${column}...`)
    await client.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`)
  }
}

async function indexExists(client: Client, name: string) {
  const result = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
    args: [name],
  })
  return result.rows.length > 0
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
    await addColumnIfMissing(client, "CalendarEventLink", "planId", "TEXT")
    await addColumnIfMissing(client, "Plan", "reconciliationStatus", "TEXT")
    await addColumnIfMissing(client, "Plan", "reconciledAt", "DATETIME")

    await client.execute(`CREATE INDEX IF NOT EXISTS "CalendarEventLink_planId_idx" ON "CalendarEventLink"("planId")`)

    if (!(await indexExists(client, "Event_sourcePlanId_key"))) {
      const dupes = await client.execute(
        `SELECT "sourcePlanId", COUNT(*) AS n FROM "Event" WHERE "sourcePlanId" IS NOT NULL GROUP BY "sourcePlanId" HAVING n > 1`,
      )
      if (dupes.rows.length > 0) {
        console.warn(`  ⚠ ${dupes.rows.length} sourcePlanId value(s) are shared by multiple Events; creating a NON-unique index instead.`)
        for (const row of dupes.rows) console.warn(`    sourcePlanId=${row.sourcePlanId} used by ${row.n} events`)
        await client.execute(`CREATE INDEX "Event_sourcePlanId_key" ON "Event"("sourcePlanId")`)
      } else {
        await client.execute(`CREATE UNIQUE INDEX "Event_sourcePlanId_key" ON "Event"("sourcePlanId")`)
      }
    }

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
