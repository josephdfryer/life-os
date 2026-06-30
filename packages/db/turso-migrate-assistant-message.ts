import { createClient } from "@libsql/client"

const migrationName = "20260630120000_add_assistant_message"

async function main() {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1) }

  const client = createClient({ url, authToken })

  try {
    const tableCheck = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='AssistantMessage'`
    )
    if (tableCheck.rows.length > 0) {
      console.log("AssistantMessage table already exists, skipping creation.")
    } else {
      console.log("Creating AssistantMessage table...")
      await client.execute(`
        CREATE TABLE "AssistantMessage" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "workspaceId" TEXT NOT NULL DEFAULT 'default-workspace',
          "channel" TEXT NOT NULL,
          "from" TEXT NOT NULL,
          "role" TEXT NOT NULL,
          "content" TEXT NOT NULL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "AssistantMessage_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id")
            ON DELETE CASCADE ON UPDATE CASCADE
        )
      `)
      await client.execute(
        `CREATE INDEX "AssistantMessage_workspaceId_from_createdAt_idx" ON "AssistantMessage"("workspaceId", "from", "createdAt")`
      )
      console.log("AssistantMessage table created.")
    }

    console.log(`Migration ${migrationName} complete.`)
  } finally {
    client.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
