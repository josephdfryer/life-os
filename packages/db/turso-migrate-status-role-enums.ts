import { createClient } from "@libsql/client"

const migrationName = "20260714150000_status_role_enums"

// One-time production migration: normalizes any legacy Plan.status or
// WorkspaceMember.role values that fall outside the new enum sets, matching
// packages/db/prisma/migrations/20260714150000_status_role_enums/migration.sql.
//
// Usage:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx turso-migrate-status-role-enums.ts
//
// Naturally idempotent: the UPDATE statements only touch rows already
// outside the allowed set, so re-running is a safe no-op.

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1) }

  const client = createClient({ url, authToken })

  try {
    const planResult = await client.execute(
      `UPDATE "Plan" SET "status" = 'active' WHERE "status" NOT IN ('draft', 'active', 'blocked', 'completed', 'abandoned')`
    )
    console.log(`Normalized ${planResult.rowsAffected} legacy Plan.status row(s).`)

    const memberResult = await client.execute(
      `UPDATE "WorkspaceMember" SET "role" = 'owner' WHERE "role" NOT IN ('owner', 'admin', 'member', 'viewer')`
    )
    console.log(`Normalized ${memberResult.rowsAffected} legacy WorkspaceMember.role row(s).`)

    console.log(`${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
