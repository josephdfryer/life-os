import { createClient, type Client } from "@libsql/client"

const migrationName = "20260724010000_add_wardrobe_support"

async function addColumnIfMissing(client: Client, table: string, column: string, definition: string) {
  const result = await client.execute({
    sql: `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column],
  })
  if (result.rows.length === 0) {
    console.log(`  Adding ${table}.${column}...`)
    await client.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`)
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
    await addColumnIfMissing(client, "ImportedFile", "storageProvider", "TEXT NOT NULL DEFAULT 'local'")
    await addColumnIfMissing(client, "ImportedFile", "storageKey", "TEXT")
    await addColumnIfMissing(client, "ImportedFile", "mimeType", "TEXT")
    await addColumnIfMissing(client, "ImportedFile", "checksum", "TEXT")
    await addColumnIfMissing(client, "ImportedFile", "capturedAt", "DATETIME")
    await addColumnIfMissing(
      client,
      "Item",
      "primaryImageFileId",
      'TEXT REFERENCES "ImportedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE',
    )
    await addColumnIfMissing(client, "Item", "attributes", "TEXT")

    await client.batch([
      `CREATE TABLE IF NOT EXISTS "AiProviderCredential" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "workspaceId" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        "provider" TEXT NOT NULL,
        "label" TEXT,
        "apiKeyEncrypted" TEXT NOT NULL,
        "modelId" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'active',
        "lastUsedAt" DATETIME,
        CONSTRAINT "AiProviderCredential_workspaceId_fkey"
          FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS "AiAnalysisRun" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "workspaceId" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "completedAt" DATETIME,
        "credentialId" TEXT,
        "sourceFileId" TEXT NOT NULL,
        "provider" TEXT NOT NULL,
        "modelId" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "promptVersion" TEXT NOT NULL,
        "output" TEXT,
        "error" TEXT,
        "inputTokens" INTEGER,
        "outputTokens" INTEGER,
        "estimatedCost" REAL,
        CONSTRAINT "AiAnalysisRun_workspaceId_fkey"
          FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "AiAnalysisRun_credentialId_fkey"
          FOREIGN KEY ("credentialId") REFERENCES "AiProviderCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "AiAnalysisRun_sourceFileId_fkey"
          FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "AiProviderCredential_workspaceId_provider_key"
        ON "AiProviderCredential"("workspaceId", "provider")`,
      `CREATE INDEX IF NOT EXISTS "AiProviderCredential_workspaceId_status_idx"
        ON "AiProviderCredential"("workspaceId", "status")`,
      `CREATE INDEX IF NOT EXISTS "AiAnalysisRun_workspaceId_createdAt_idx"
        ON "AiAnalysisRun"("workspaceId", "createdAt")`,
      `CREATE INDEX IF NOT EXISTS "AiAnalysisRun_sourceFileId_idx"
        ON "AiAnalysisRun"("sourceFileId")`,
      `CREATE INDEX IF NOT EXISTS "ImportedFile_workspaceId_checksum_idx"
        ON "ImportedFile"("workspaceId", "checksum")`,
      `CREATE INDEX IF NOT EXISTS "Item_primaryImageFileId_idx"
        ON "Item"("primaryImageFileId")`,
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
