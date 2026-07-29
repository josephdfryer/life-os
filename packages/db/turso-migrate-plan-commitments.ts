import { createClient, type Client } from "@libsql/client"

const migrationName = "20260728010000_add_plan_commitment_tracking"

// Idempotent production apply for Home's commitment tracking. Mirrors
// prisma/migrations/20260728010000_add_plan_commitment_tracking. Purely
// additive: two nullable columns, one NOT NULL column with a default (safe on a
// populated table in SQLite), and one index.
//
// MUST run before deploying Home. The regenerated Prisma client selects every
// scalar column of Plan by default, so code that knows about dueOn against a DB
// that does not have it fails EVERY Plan query, not just the new widget.
//
//   cd packages/db && DB=persons; \
//     TURSO_DATABASE_URL="$(turso db show "$DB" --url)" \
//     TURSO_AUTH_TOKEN="$(turso db tokens create "$DB")" \
//     npx tsx turso-migrate-plan-commitments.ts

async function addColumnIfMissing(client: Client, table: string, column: string, definition: string) {
  const result = await client.execute({
    sql: `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column],
  })
  if (result.rows.length === 0) {
    console.log(`  Adding ${table}.${column}...`)
    await client.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`)
  } else {
    console.log(`  ${table}.${column} already present.`)
  }
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
    await addColumnIfMissing(client, "Plan", "dueOn", "DATETIME")
    await addColumnIfMissing(client, "Plan", "deferCount", "INTEGER NOT NULL DEFAULT 0")
    await addColumnIfMissing(client, "Plan", "completedAt", "DATETIME")

    await client.execute(
      `CREATE INDEX IF NOT EXISTS "Plan_workspaceId_status_dueOn_idx" ON "Plan"("workspaceId", "status", "dueOn")`,
    )

    const check = await client.execute(
      `SELECT name FROM pragma_table_info('Plan') WHERE name IN ('dueOn', 'deferCount', 'completedAt')`,
    )
    if (check.rows.length !== 3) {
      throw new Error(`Expected 3 commitment columns on Plan, found ${check.rows.length}`)
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
