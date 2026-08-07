import { createClient } from "@libsql/client"

const migrationName = "20260807030000_theory_analysis_run"

// Idempotent production apply for Theory of Person's AI-run tracking
// (packages/intelligence/src/synthesize.ts). Mirrors
// prisma/migrations/20260807030000_theory_analysis_run/migration.sql. New
// table only — no existing table is altered.
//
//   cd packages/db && DB=persons; \
//     TURSO_DATABASE_URL="$(turso db show "$DB" --url)" \
//     TURSO_AUTH_TOKEN="$(turso db tokens create "$DB")" \
//     npx tsx turso-migrate-theory-analysis-run.ts

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "TheoryAnalysisRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
    "subjectPersonId" TEXT NOT NULL,
    "credentialId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "snapshotId" TEXT,
    "output" TEXT,
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCost" REAL,
    CONSTRAINT "TheoryAnalysisRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TheoryAnalysisRun_subjectPersonId_fkey" FOREIGN KEY ("subjectPersonId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TheoryAnalysisRun_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "AiProviderCredential" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "TheoryAnalysisRun_workspaceId_createdAt_idx" ON "TheoryAnalysisRun"("workspaceId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "TheoryAnalysisRun_subjectPersonId_createdAt_idx" ON "TheoryAnalysisRun"("subjectPersonId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "TheoryAnalysisRun_subjectPersonId_status_idx" ON "TheoryAnalysisRun"("subjectPersonId", "status")`,
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
