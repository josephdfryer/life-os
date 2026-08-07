import { createClient } from "@libsql/client"

const migrationName = "20260807020000_life_model_snapshot"

// Idempotent production apply for packages/intelligence's whole-life
// synthesis (Track A6). Mirrors
// prisma/migrations/20260807020000_life_model_snapshot/migration.sql.
// Both tables are new — no existing table is altered.
//
//   cd packages/db && DB=persons; \
//     TURSO_DATABASE_URL="$(turso db show "$DB" --url)" \
//     TURSO_AUTH_TOKEN="$(turso db tokens create "$DB")" \
//     npx tsx turso-migrate-life-model-snapshot.ts

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "LifeModelSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "version" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'current',
    "modelId" TEXT,
    "promptVersion" TEXT,
    "synthesizedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LifeModelSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "LifeModelSnapshot_workspaceId_version_idx" ON "LifeModelSnapshot"("workspaceId", "version")`,
  `CREATE INDEX IF NOT EXISTS "LifeModelSnapshot_workspaceId_status_idx" ON "LifeModelSnapshot"("workspaceId", "status")`,

  `CREATE TABLE IF NOT EXISTS "LifeModelClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" REAL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "windowStart" DATETIME,
    "windowEnd" DATETIME,
    "evidence" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LifeModelClaim_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "LifeModelSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "LifeModelClaim_snapshotId_idx" ON "LifeModelClaim"("snapshotId")`,
  `CREATE INDEX IF NOT EXISTS "LifeModelClaim_kind_idx" ON "LifeModelClaim"("kind")`,
  `CREATE INDEX IF NOT EXISTS "LifeModelClaim_subjectType_subjectId_idx" ON "LifeModelClaim"("subjectType", "subjectId")`,
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
    for (const statement of STATEMENTS) {
      await client.execute(statement)
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
