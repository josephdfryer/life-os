import { createClient } from "@libsql/client"

const migrationName = "20260727010000_add_note_suggestions"

// Idempotent production apply for Note AI analysis/suggestions support. Mirrors
// prisma/migrations/20260727010000_add_note_suggestions. Additive only: new
// NoteAnalysisRun/NoteSuggestion tables + indexes. Safe to re-run.

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN")
    process.exit(1)
  }

  const client = createClient({ url, authToken })
  try {
    await client.batch([
      `CREATE TABLE IF NOT EXISTS "NoteAnalysisRun" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "workspaceId" TEXT NOT NULL,
        "noteId" TEXT NOT NULL,
        "credentialId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "completedAt" DATETIME,
        "provider" TEXT NOT NULL,
        "modelId" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "promptVersion" TEXT NOT NULL,
        "output" TEXT,
        "error" TEXT,
        "inputTokens" INTEGER,
        "outputTokens" INTEGER,
        "estimatedCost" REAL,
        CONSTRAINT "NoteAnalysisRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "NoteAnalysisRun_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "NoteAnalysisRun_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "AiProviderCredential" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS "NoteSuggestion" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "workspaceId" TEXT NOT NULL,
        "noteId" TEXT NOT NULL,
        "analysisRunId" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "reviewedAt" DATETIME,
        "kind" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "title" TEXT NOT NULL,
        "payload" TEXT NOT NULL,
        "confidence" REAL,
        "acceptedEntityType" TEXT,
        "acceptedEntityId" TEXT,
        CONSTRAINT "NoteSuggestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "NoteSuggestion_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "NoteSuggestion_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "NoteAnalysisRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "NoteAnalysisRun_noteId_promptVersion_key" ON "NoteAnalysisRun"("noteId", "promptVersion")`,
      `CREATE INDEX IF NOT EXISTS "NoteAnalysisRun_workspaceId_createdAt_idx" ON "NoteAnalysisRun"("workspaceId", "createdAt")`,
      `CREATE INDEX IF NOT EXISTS "NoteAnalysisRun_noteId_createdAt_idx" ON "NoteAnalysisRun"("noteId", "createdAt")`,
      `CREATE INDEX IF NOT EXISTS "NoteSuggestion_workspaceId_status_createdAt_idx" ON "NoteSuggestion"("workspaceId", "status", "createdAt")`,
      `CREATE INDEX IF NOT EXISTS "NoteSuggestion_noteId_status_idx" ON "NoteSuggestion"("noteId", "status")`,
      `CREATE INDEX IF NOT EXISTS "NoteSuggestion_analysisRunId_idx" ON "NoteSuggestion"("analysisRunId")`,
    ], "write")

    console.log(`Migration ${migrationName} applied to Turso successfully.`)
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
