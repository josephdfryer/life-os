import { createClient } from "@libsql/client"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  formatSchemaGaps,
  parsePrismaModels,
  schemaGaps,
  type PrismaModelColumns,
} from "./prisma-models"

export async function readLiveColumns(url: string, authToken: string | undefined): Promise<PrismaModelColumns> {
  const client = createClient({ url, authToken })
  try {
    const tables = await client.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    const live: PrismaModelColumns = new Map()
    for (const row of tables.rows) {
      const name = String(row.name)
      const info = await client.execute(`PRAGMA table_info("${name.replaceAll('"', '""')}")`)
      live.set(
        name,
        info.rows.map(column => String(column.name)),
      )
    }
    return live
  } finally {
    client.close()
  }
}

export async function assertProdSchema(root: string): Promise<string> {
  const url = process.env.TURSO_DATABASE_URL
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set. Load .env / apps/persons/.env, or pass --skip-migrations.",
    )
  }
  const schema = readFileSync(join(root, "packages/db/prisma/schema.prisma"), "utf8")
  const models = parsePrismaModels(schema)
  const live = await readLiveColumns(url, process.env.TURSO_AUTH_TOKEN)
  const gap = schemaGaps(models, live)
  if (gap.missingTables.length || gap.missingColumns.length) {
    throw new Error(
      "Production Turso is missing schema the Prisma client would select. " +
      "Apply the matching turso-migrate-*.ts (or migration.sql) before deploying, " +
      "or the first query on that model 500s.\n" +
      formatSchemaGaps(gap),
    )
  }
  return `Production schema covers ${models.size} Prisma models.`
}
