import { createClient } from "@libsql/client"

const migrationName = "20260817000000_lifeos_rename_backfill"

// Idempotent display-name backfill for the "Life OS" -> "LifeOS" rename.
//
// Data-only. Creates nothing, drops nothing, deletes nothing: it rewrites the
// `name` string on Workspace rows that still carry the old spelling. Code that
// creates NEW workspaces already writes "LifeOS" (packages/access/index.ts,
// apps/places/server/domain/access.ts), so without this pass prod keeps a
// permanent mix of "Joseph's Life OS" and "Joseph's LifeOS".
//
// `slug` is deliberately untouched — slugs are identifiers, they are joined on
// and appear in URLs, and 'joseph-life-os' must keep resolving.
//
//   cd packages/db && DB=persons; \
//     TURSO_DATABASE_URL="$(turso db show "$DB" --url)" \
//     TURSO_AUTH_TOKEN="$(turso db tokens create "$DB")" \
//     npx tsx turso-migrate-lifeos-rename.ts

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN")
    process.exit(1)
  }

  const client = createClient({ url, authToken })
  try {
    // Show what is about to change before changing it.
    const before = await client.execute(
      `SELECT "id", "name", "slug" FROM "Workspace" WHERE "name" LIKE '%Life OS%'`,
    )
    if (before.rows.length === 0) {
      console.log(`Migration ${migrationName}: nothing to do — no Workspace name contains "Life OS".`)
      return
    }

    console.log(`Rewriting ${before.rows.length} Workspace name(s):`)
    for (const row of before.rows) {
      const name = String(row.name)
      console.log(`  ${row.slug}: "${name}" -> "${name.replaceAll("Life OS", "LifeOS")}"`)
    }

    const result = await client.execute(
      `UPDATE "Workspace"
         SET "name" = REPLACE("name", 'Life OS', 'LifeOS')
       WHERE "name" LIKE '%Life OS%'`,
    )

    const remaining = await client.execute(
      `SELECT COUNT(*) AS n FROM "Workspace" WHERE "name" LIKE '%Life OS%'`,
    )
    console.log(
      `Migration ${migrationName} applied. Rows changed: ${result.rowsAffected}. Remaining with old spelling: ${remaining.rows[0].n}.`,
    )
  } finally {
    client.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
