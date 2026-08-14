import { createClient } from "@libsql/client"
import { readFile } from "node:fs/promises"

const migrationName = "20260813232506_file_intelligence"

// Additive, idempotent production apply. The committed migration remains the
// single SQL source so the Turso path cannot silently drift from clean replay.
async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN")
  const migrationUrl = new URL(`./prisma/migrations/${migrationName}/migration.sql`, import.meta.url)
  const sql = await readFile(migrationUrl, "utf8")
  const statements = sql.split(/;\s*\n/).map(value => value.trim()).filter(Boolean)
  const client = createClient({ url, authToken })
  try {
    for (const statement of statements) {
      try { await client.execute(`${statement};`) }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/already exists|duplicate column/i.test(message)) continue
        throw error
      }
    }
    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally { client.close() }
}

main().catch(error => { console.error(error); process.exit(1) })
