import { createClient, type Client } from "@libsql/client"

const migrationName = "20260803000000_finance_interactions"

// Idempotent production apply for finance-as-interactions. Mirrors
// prisma/migrations/20260803000000_finance_interactions/migration.sql.
//
// Purely additive: ADD COLUMN + CREATE INDEX only. No table rebuild, no data
// movement, no column retyped. Safe to re-run; every statement is guarded.
//
// MUST run before deploying any app with the regenerated Prisma client. The
// client selects every scalar column of Interaction by default, so code that
// knows about `category` against a DB that does not have it fails EVERY
// Interaction query, not just the finance ones.
//
//   cd packages/db && DB=persons; \
//     TURSO_DATABASE_URL="$(turso db show "$DB" --url)" \
//     TURSO_AUTH_TOKEN="$(turso db tokens create "$DB")" \
//     npx tsx turso-migrate-finance-interactions.ts

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

const INTERACTION_COLUMNS: [string, string][] = [
  // Provenance / dedupe anchor
  ["source", "TEXT"],
  ["sourceId", "TEXT"],
  // Money
  ["subtype", "TEXT"],
  ["currency", "TEXT NOT NULL DEFAULT 'USD'"],
  ["category", "TEXT"],
  ["merchantName", "TEXT"],
  ["accountLinkId", `TEXT REFERENCES "EraAccountLink"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
  // Whose money moved (cache of EraAccountLink.ownerPersonId)
  ["actorPersonId", `TEXT REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
  // Structured source detail as JSON. `notes` is human prose — never both.
  ["metadata", "TEXT"],
  // Enrichment state
  ["enrichmentVersion", "INTEGER NOT NULL DEFAULT 0"],
  ["enrichedAt", "DATETIME"],
]

const PARTICIPANT_COLUMNS: [string, string][] = [
  ["confidence", "REAL"],
  ["band", "TEXT"],
  ["source", "TEXT"],
  ["evidence", "TEXT"],
  // Turso rejects a non-constant default (CURRENT_TIMESTAMP) on ADD COLUMN, so
  // these land with an epoch sentinel and are immediately backfilled below from
  // the parent Interaction. Prisma supplies both values on every write, so the
  // sentinel is only ever visible on rows that predate this migration.
  ["createdAt", `DATETIME NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'`],
  ["updatedAt", `DATETIME NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'`],
]

const ACCOUNT_COLUMNS: [string, string][] = [
  ["ownerPersonId", `TEXT REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
  ["householdGroupId", `TEXT REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
  ["isShared", "BOOLEAN NOT NULL DEFAULT false"],
]

const INDEXES = [
  // SQLite treats NULLs as distinct, so pre-existing rows with no source do not collide.
  `CREATE UNIQUE INDEX IF NOT EXISTS "Interaction_workspaceId_source_sourceId_key" ON "Interaction"("workspaceId", "source", "sourceId")`,
  `CREATE INDEX IF NOT EXISTS "Interaction_workspaceId_timestamp_id_idx" ON "Interaction"("workspaceId", "timestamp" DESC, "id")`,
  `CREATE INDEX IF NOT EXISTS "Interaction_workspaceId_type_timestamp_idx" ON "Interaction"("workspaceId", "type", "timestamp" DESC)`,
  `CREATE INDEX IF NOT EXISTS "Interaction_workspaceId_actorPersonId_timestamp_idx" ON "Interaction"("workspaceId", "actorPersonId", "timestamp" DESC)`,
  `CREATE INDEX IF NOT EXISTS "Interaction_workspaceId_category_timestamp_idx" ON "Interaction"("workspaceId", "category", "timestamp" DESC)`,
  `CREATE INDEX IF NOT EXISTS "Interaction_accountLinkId_idx" ON "Interaction"("accountLinkId")`,
  // Partial indexes for the hot slice — Prisma cannot express these.
  `CREATE INDEX IF NOT EXISTS "Interaction_financial_stream_idx" ON "Interaction"("workspaceId", "timestamp" DESC, "id") WHERE "type" = 'financial'`,
  `CREATE INDEX IF NOT EXISTS "Interaction_financial_category_idx" ON "Interaction"("workspaceId", "category", "timestamp" DESC) WHERE "type" = 'financial'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "InteractionParticipant_interactionId_entityType_entityId_role_key" ON "InteractionParticipant"("interactionId", "entityType", "entityId", "role")`,
  `CREATE INDEX IF NOT EXISTS "InteractionParticipant_entityType_entityId_interactionId_idx" ON "InteractionParticipant"("entityType", "entityId", "interactionId")`,
  `CREATE INDEX IF NOT EXISTS "InteractionParticipant_workspaceId_entityType_entityId_idx" ON "InteractionParticipant"("workspaceId", "entityType", "entityId")`,
  `CREATE INDEX IF NOT EXISTS "EraAccountLink_ownerPersonId_idx" ON "EraAccountLink"("ownerPersonId")`,
  `CREATE INDEX IF NOT EXISTS "EraAccountLink_householdGroupId_idx" ON "EraAccountLink"("householdGroupId")`,
]

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN")
    process.exit(1)
  }

  const client = createClient({ url, authToken })
  try {
    console.log("Interaction:")
    for (const [column, definition] of INTERACTION_COLUMNS) {
      await addColumnIfMissing(client, "Interaction", column, definition)
    }

    console.log("InteractionParticipant:")
    for (const [column, definition] of PARTICIPANT_COLUMNS) {
      await addColumnIfMissing(client, "InteractionParticipant", column, definition)
    }

    // Replace the epoch sentinel on rows that predate this migration with the
    // parent Interaction's createdAt — the honest answer for when that edge
    // came into existence.
    const backfilled = await client.execute(`
      UPDATE "InteractionParticipant"
         SET "createdAt" = COALESCE(
               (SELECT "createdAt" FROM "Interaction" WHERE "Interaction"."id" = "InteractionParticipant"."interactionId"),
               "createdAt"),
             "updatedAt" = COALESCE(
               (SELECT "createdAt" FROM "Interaction" WHERE "Interaction"."id" = "InteractionParticipant"."interactionId"),
               "updatedAt")
       WHERE "createdAt" = '1970-01-01T00:00:00.000Z'
    `)
    console.log(`  Backfilled timestamps on ${backfilled.rowsAffected} pre-existing participant row(s).`)

    console.log("EraAccountLink:")
    for (const [column, definition] of ACCOUNT_COLUMNS) {
      await addColumnIfMissing(client, "EraAccountLink", column, definition)
    }

    console.log("Indexes:")
    for (const statement of INDEXES) {
      await client.execute(statement)
    }
    console.log(`  ${INDEXES.length} index statements applied.`)

    // Verify every column landed before declaring success.
    const expected: [string, string[]][] = [
      ["Interaction", INTERACTION_COLUMNS.map(c => c[0])],
      ["InteractionParticipant", PARTICIPANT_COLUMNS.map(c => c[0])],
      ["EraAccountLink", ACCOUNT_COLUMNS.map(c => c[0])],
    ]
    for (const [table, columns] of expected) {
      const check = await client.execute({
        sql: `SELECT name FROM pragma_table_info(?)`,
        args: [table],
      })
      const present = new Set(check.rows.map(r => String(r.name)))
      const missing = columns.filter(c => !present.has(c))
      if (missing.length > 0) {
        throw new Error(`${table} is missing columns after migration: ${missing.join(", ")}`)
      }
    }

    const integrity = await client.execute("PRAGMA foreign_key_check")
    if (integrity.rows.length > 0) {
      throw new Error(`foreign_key_check reported ${integrity.rows.length} violation(s)`)
    }

    console.log(`\nMigration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
