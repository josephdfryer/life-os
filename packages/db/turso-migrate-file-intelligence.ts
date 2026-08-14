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
  // `filter(Boolean)` is not enough: splitting on `;\n` also yields chunks that
  // are only SQL comments — this migration has a two-line comment block above
  // the FileChunkFts virtual table, and its first line lands in a chunk of its
  // own. Those chunks are non-empty strings, so they survived the truthiness
  // filter and Turso rejected them with SQL_PARSE_ERROR ("SQL string does not
  // contain any statement"), aborting the run partway through. Keep only chunks
  // that carry at least one line of actual SQL.
  const hasExecutableSql = (chunk: string) =>
    chunk.split("\n").some(line => {
      const trimmed = line.trim()
      return trimmed.length > 0 && !trimmed.startsWith("--")
    })
  const statements = sql.split(/;\s*\n/).map(value => value.trim()).filter(hasExecutableSql)
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
