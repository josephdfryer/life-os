import { createClient } from "@libsql/client"
import { encrypt } from "./src/crypto"

const migrationName = "20260714120000_encrypt_integration_tokens"

// One-time production migration: encrypts existing plaintext OAuth tokens on
// Turso and moves them into the new *_encrypted columns used by the app
// (see packages/db/src/crypto.ts and prisma/schema.prisma).
//
// Usage:
//   ENCRYPTION_KEY=<64-char hex> TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
//     npx tsx turso-migrate-encrypt-tokens.ts
//
// Safe to re-run: each step is guarded (checks for existing columns, only
// encrypts rows whose *_encrypted column is still empty), so a partial or
// repeated run will not double-encrypt or clobber data.
//
// Steps per table:
//   1. Add nullable "<field>Encrypted" columns if they don't already exist.
//   2. For every row with a plaintext value and no encrypted value yet,
//      encrypt it and write it into the new column.
//   3. Drop the old plaintext columns once every row has been migrated.
// Step 3 is intentionally NOT run automatically — verify the encrypted
// values decrypt correctly in the app first, then run the DROP statements
// printed at the end (or re-run this script with DROP_PLAINTEXT_COLUMNS=1).

type TableSpec = {
  table: string
  columns: { plaintext: string; encrypted: string }[]
}

const TABLES: TableSpec[] = [
  {
    table: "CalendarConnection",
    columns: [
      { plaintext: "accessToken", encrypted: "accessTokenEncrypted" },
      { plaintext: "refreshToken", encrypted: "refreshTokenEncrypted" },
      { plaintext: "syncToken", encrypted: "syncTokenEncrypted" },
    ],
  },
  {
    table: "GmailConnection",
    columns: [
      { plaintext: "accessToken", encrypted: "accessTokenEncrypted" },
      { plaintext: "refreshToken", encrypted: "refreshTokenEncrypted" },
    ],
  },
  {
    table: "EraConnection",
    columns: [
      { plaintext: "accessToken", encrypted: "accessTokenEncrypted" },
      { plaintext: "refreshToken", encrypted: "refreshTokenEncrypted" },
    ],
  },
]

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1) }
  if (!process.env.ENCRYPTION_KEY) { console.error("Missing ENCRYPTION_KEY"); process.exit(1) }

  const client = createClient({ url, authToken })
  const dropPlaintext = process.env.DROP_PLAINTEXT_COLUMNS === "1"

  try {
    for (const { table, columns } of TABLES) {
      console.log(`\n${table}:`)
      const colCheck = await client.execute(
        `SELECT name FROM pragma_table_info('${table}')`
      )
      const existingCols = new Set(colCheck.rows.map(r => String(r.name)))

      for (const { encrypted } of columns) {
        if (!existingCols.has(encrypted)) {
          console.log(`  Adding ${encrypted} column...`)
          await client.execute(`ALTER TABLE "${table}" ADD COLUMN "${encrypted}" TEXT`)
        }
      }

      // Skip encryption for columns whose plaintext source no longer exists
      // (i.e. a previous run already completed step 3 for this table).
      const columnsToMigrate = columns.filter(c => existingCols.has(c.plaintext))
      if (columnsToMigrate.length > 0) {
        const selectCols = ["id", ...columnsToMigrate.map(c => c.plaintext), ...columnsToMigrate.map(c => c.encrypted)]
        const rows = await client.execute(`SELECT ${selectCols.map(c => `"${c}"`).join(", ")} FROM "${table}"`)

        let migrated = 0
        for (const row of rows.rows) {
          const id = row.id as string
          const updates: string[] = []
          const args: unknown[] = []
          for (const { plaintext, encrypted } of columnsToMigrate) {
            const plainValue = row[plaintext] as string | null
            const encryptedValue = row[encrypted] as string | null
            if (plainValue != null && encryptedValue == null) {
              updates.push(`"${encrypted}" = ?`)
              args.push(encrypt(plainValue))
            }
          }
          if (updates.length === 0) continue
          args.push(id)
          await client.execute({
            sql: `UPDATE "${table}" SET ${updates.join(", ")} WHERE "id" = ?`,
            args,
          })
          migrated += 1
        }
        console.log(`  Encrypted ${migrated} row(s).`)
      }

      if (dropPlaintext) {
        for (const { plaintext } of columns) {
          if (existingCols.has(plaintext)) {
            console.log(`  Dropping plaintext column ${plaintext}...`)
            await client.execute(`ALTER TABLE "${table}" DROP COLUMN "${plaintext}"`)
          }
        }
      } else {
        const stillPresent = columns.filter(c => existingCols.has(c.plaintext))
        if (stillPresent.length > 0) {
          console.log(`  Plaintext columns left in place for verification: ${stillPresent.map(c => c.plaintext).join(", ")}`)
          console.log(`  Re-run with DROP_PLAINTEXT_COLUMNS=1 once verified to drop them.`)
        }
      }
    }

    console.log(`\nMigration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
