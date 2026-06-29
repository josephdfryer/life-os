import { createClient } from "@libsql/client"

const migrationName = "20260613120000_add_event_plan_primitives"

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1) }

  const client = createClient({ url, authToken })

  try {
    // ── Event columns ────────────────────────────────────────────────────────
    const eventCols = await client.execute(`SELECT name FROM pragma_table_info('Event') WHERE name IN ('start', 'end', 'sourcePlanId', 'parentEventId')`)
    const existingEventCols = new Set(eventCols.rows.map(r => String(r.name)))

    if (!existingEventCols.has("start")) {
      console.log("  Event: adding start column...")
      // Turso/libSQL rejects ADD COLUMN with a non-constant default (CURRENT_TIMESTAMP),
      // so seed with a constant placeholder, then immediately backfill from timestamp.
      await client.execute(`ALTER TABLE "Event" ADD COLUMN "start" DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00'`)
      console.log("  Event: backfilling start from timestamp...")
      await client.execute(`UPDATE "Event" SET "start" = "timestamp"`)
    }
    if (!existingEventCols.has("end")) {
      console.log("  Event: adding end column...")
      await client.execute(`ALTER TABLE "Event" ADD COLUMN "end" DATETIME`)
    }
    if (!existingEventCols.has("sourcePlanId")) {
      console.log("  Event: adding sourcePlanId column...")
      await client.execute(`ALTER TABLE "Event" ADD COLUMN "sourcePlanId" TEXT`)
    }
    if (!existingEventCols.has("parentEventId")) {
      console.log("  Event: adding parentEventId column...")
      await client.execute(`ALTER TABLE "Event" ADD COLUMN "parentEventId" TEXT`)
    }

    // ── Plan columns ─────────────────────────────────────────────────────────
    const planCols = await client.execute(`SELECT name FROM pragma_table_info('Plan') WHERE name IN ('scheduledStart', 'scheduledEnd', 'placeId', 'externalSource', 'externalInstanceId')`)
    const existingPlanCols = new Set(planCols.rows.map(r => String(r.name)))

    if (!existingPlanCols.has("scheduledStart")) {
      console.log("  Plan: adding scheduledStart column...")
      await client.execute(`ALTER TABLE "Plan" ADD COLUMN "scheduledStart" DATETIME`)
    }
    if (!existingPlanCols.has("scheduledEnd")) {
      console.log("  Plan: adding scheduledEnd column...")
      await client.execute(`ALTER TABLE "Plan" ADD COLUMN "scheduledEnd" DATETIME`)
    }
    if (!existingPlanCols.has("placeId")) {
      console.log("  Plan: adding placeId column...")
      await client.execute(`ALTER TABLE "Plan" ADD COLUMN "placeId" TEXT`)
    }
    if (!existingPlanCols.has("externalSource")) {
      console.log("  Plan: adding externalSource column...")
      await client.execute(`ALTER TABLE "Plan" ADD COLUMN "externalSource" TEXT`)
    }
    if (!existingPlanCols.has("externalInstanceId")) {
      console.log("  Plan: adding externalInstanceId column...")
      await client.execute(`ALTER TABLE "Plan" ADD COLUMN "externalInstanceId" TEXT`)
    }

    // ── PlanExpectedPerson table ──────────────────────────────────────────────
    const tableCheck = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='PlanExpectedPerson'`)
    if (tableCheck.rows.length === 0) {
      console.log("  Creating PlanExpectedPerson table...")
      await client.execute(`
        CREATE TABLE "PlanExpectedPerson" (
          "planId" TEXT NOT NULL,
          "personId" TEXT NOT NULL,
          "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
          PRIMARY KEY ("planId", "personId"),
          CONSTRAINT "PlanExpectedPerson_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "PlanExpectedPerson_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "PlanExpectedPerson_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )
      `)
    }

    // ── Indexes ───────────────────────────────────────────────────────────────
    console.log("  Creating indexes...")
    await client.execute(`CREATE INDEX IF NOT EXISTS "Event_workspaceId_start_idx" ON "Event"("workspaceId", "start")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "Event_sourcePlanId_idx" ON "Event"("sourcePlanId")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "Event_parentEventId_idx" ON "Event"("parentEventId")`)
    await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "Plan_externalInstanceId_key" ON "Plan"("externalInstanceId")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "Plan_workspaceId_scheduledStart_idx" ON "Plan"("workspaceId", "scheduledStart")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "Plan_externalInstanceId_idx" ON "Plan"("externalInstanceId")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "PlanExpectedPerson_personId_idx" ON "PlanExpectedPerson"("personId")`)
    await client.execute(`CREATE INDEX IF NOT EXISTS "PlanExpectedPerson_workspaceId_idx" ON "PlanExpectedPerson"("workspaceId")`)

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
